// Prices snapshot+delta manifest versions (B) against today's full-map-per-version (A) — see the card.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const canon = (v) => Array.isArray(v) ? '[' + v.map(canon).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  : JSON.stringify(v);
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const bytesOf = (obj) => Buffer.byteLength(canon(obj), 'utf8');
const SIG_BYTES = 128;

const ID = 'https://mom.pence.family/';
const FEED = ID + 'feed.json';
const itemId = (n) => `urn:uuid:${crypto.createHash('sha256').update('item-' + n).digest('hex').slice(0, 8)}-7dec-11d0-a765-00a0c91e6bf6`;
const itemHash = (n, v) => b64u(sha256(Buffer.from(`${n}/${v}`)));

// §9.1.1 anchors: for each k, the largest multiple of 2^k strictly below seq.
function skipAnchors(seq) {
  const out = new Set();
  for (let k = 0; ; k++) {
    const anchor = Math.floor((seq - 1) / 2 ** k) * 2 ** k;
    if (anchor < 1) break;
    out.add(anchor);
  }
  return [...out].sort((a, b) => b - a);
}

// Canonical bytes of one `"<id>":[<version>,"<hash>"]` entry.
const entryBytes = (id, v, hash) => JSON.stringify(id).length + 1 + `[${v},${JSON.stringify(hash)}]`.length;
// `"<name>":{...}` with its leading comma; nothing when the map is empty.
const mapBytes = (name, entrySum, count) =>
  (count === 0 ? 0 : 1 + JSON.stringify(name).length + 1 + 2 + entrySum + (count - 1));

// Sizes both models over one workload from running byte totals; only sizes survive the loop.
function measure({ versions, addsPerVersion, editRate = 0.05, deleteRate = 0.01, snapshotEvery }) {
  const live = new Map(), deleted = new Map();
  let itemsBytes = 0, deletedBytes = 0, next = 0;
  const a = [], aNoSkip = [], b = [];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let seq = 1; seq <= versions; seq++) {
    const added = [], edited = [], removed = [];
    for (let i = 0; i < addsPerVersion; i++) {
      const id = itemId(next++);
      live.set(id, 1);
      itemsBytes += entryBytes(id, 1, itemHash(id, 1));
      added.push(id);
    }
    // Churn is per-version and drawn from a recent window, so it does not scale with the catalog.
    const recent = (n) => itemId(Math.max(0, next - 1 - Math.floor(rnd() * Math.min(next, n))));
    for (let i = 0; i < addsPerVersion; i++) {
      if (!live.size) break;
      if (rnd() < editRate) {
        const id = recent(500);
        if (live.has(id)) {
          const was = live.get(id);
          itemsBytes += entryBytes(id, was + 1, itemHash(id, was + 1)) - entryBytes(id, was, itemHash(id, was));
          live.set(id, was + 1);
          edited.push(id);
        }
      }
      if (rnd() < deleteRate) {
        const id = recent(500);
        if (live.has(id)) {
          const was = live.get(id);
          itemsBytes -= entryBytes(id, was, itemHash(id, was));
          live.delete(id);
          deleted.set(id, was + 1);
          deletedBytes += entryBytes(id, was + 1, itemHash(id, was + 1));
          removed.push(id);
        }
      }
    }

    const base = { url: ID, feed_url: FEED, seq, updated: 1736899200 + seq * 86400 };
    if (seq > 1) base.prev = b64u(sha256(Buffer.from('prev' + seq)));
    const envelope = bytesOf(base) + SIG_BYTES;

    const skip = {};
    for (const anchor of skipAnchors(seq)) skip[String(anchor)] = b64u(sha256(Buffer.from('anchor' + anchor)));
    const skipBytes = Object.keys(skip).length ? bytesOf({ _skip: skip }) - 2 : 0;
    const sizeA = envelope + mapBytes('items', itemsBytes, live.size) + mapBytes('deleted', deletedBytes, deleted.size);
    aNoSkip.push({ seq, size: sizeA });
    a.push({ seq, size: sizeA + skipBytes });

    const isSnapshot = seq === 1 || seq % snapshotEvery === 0;
    let sizeB;
    if (isSnapshot) {
      sizeB = envelope + mapBytes('items', itemsBytes, live.size) + mapBytes('deleted', deletedBytes, deleted.size);
    } else {
      const changes = {};
      const put = [...new Set([...added, ...edited])].filter((id) => live.has(id));
      if (put.length) changes.put = Object.fromEntries(put.map((id) => [id, [live.get(id), itemHash(id, live.get(id))]]));
      if (removed.length) changes.tombstone = Object.fromEntries(removed.map((id) => [id, [deleted.get(id), itemHash(id, deleted.get(id))]]));
      sizeB = envelope + bytesOf({ changes, snapshot_at: Math.max(1, Math.floor(seq / snapshotEvery) * snapshotEvery) }) - 2;
    }
    b.push({ seq, size: sizeB, snapshot: isSnapshot });
  }
  return { a, aNoSkip, b, liveCount: live.size };
}

const sum = (xs) => xs.reduce((x, y) => x + y, 0);
const mb = (n) => (n / (1024 * 1024)).toFixed(1) + 'M';
const kb = (n) => (n / 1024).toFixed(1) + 'K';
// §13.4: the greater of 10 MB and 20x the current version's size, decoded.
const budgetFor = (tipSize) => Math.max(10 * 1024 * 1024, 20 * tipSize);

// Linear walk, either model: every version from the pin to the tip.
const walkChain = (versions, pinSeq) => sum(versions.slice(pinSeq - 1).map((v) => v.size));

// `_skip` walk: each jump costs the landing plus its seq+1 companion (§9.1.1 requires both).
function walkSkipping(versions, pinSeq) {
  let at = versions.length, bytes = versions[at - 1].size;
  while (at > pinSeq) {
    const anchor = skipAnchors(at).filter((x) => x >= pinSeq).pop();
    if (anchor === undefined || anchor === at) { bytes += versions[at - 2].size; at -= 1; continue; }
    bytes += versions[anchor - 1].size;
    if (versions[anchor]) bytes += versions[anchor].size;
    at = anchor;
  }
  return bytes;
}

// First contact under B: the tip, back to its snapshot, replay forward.
function firstContactB(versions) {
  let at = versions.length, bytes = versions[at - 1].size;
  while (at >= 2 && !versions[at - 1].snapshot) { bytes += versions[at - 2].size; at -= 1; }
  return bytes;
}

// The byte arithmetic must match real serialization or nothing below is trustworthy.
function selfCheck() {
  const live = new Map();
  let s = 0;
  for (let i = 0; i < 37; i++) {
    const id = itemId(i), v = 1 + (i % 12);
    live.set(id, v);
    s += entryBytes(id, v, itemHash(id, v));
  }
  const base = { url: ID, feed_url: FEED, seq: 9, updated: 1736899200, prev: b64u(sha256(Buffer.from('p'))) };
  const real = bytesOf({ ...base, items: Object.fromEntries([...live].map(([id, v]) => [id, [v, itemHash(id, v)]])) });
  if (real !== bytesOf(base) + mapBytes('items', s, live.size)) { console.error('self-check FAILED: byte arithmetic drifted'); process.exit(1); }
  if (mapBytes('items', 0, 0) !== 0) { console.error('self-check FAILED: empty map must contribute nothing'); process.exit(1); }
  return real;
}
const CHECKED = selfCheck();

const SNAPSHOT_EVERY = 64;
const SCENARIOS = [
  { name: '10y daily, no rotation (§9.2 example)', versions: 3650, addsPerVersion: 3, days: 3650 },
  { name: '1y daily (§9.2 annual rotation)', versions: 365, addsPerVersion: 3, days: 365 },
  { name: '1y hourly, 30 items/day', versions: 8760, addsPerVersion: 1.25, days: 365 },
];

console.log(`=== deltamanifest measure: full-map (A) vs snapshot+delta (B, snapshot every ${SNAPSHOT_EVERY}) ===`);
console.log(`(byte arithmetic self-checked against real serialization: ${CHECKED} bytes, exact)\n`);

const captured = {};
const rows = [];
for (const s of SCENARIOS) {
  const { a, aNoSkip, b, liveCount } = measure({ ...s, addsPerVersion: Math.round(s.addsPerVersion), snapshotEvery: SNAPSHOT_EVERY });
  const tipA = a[a.length - 1], tipB = b[b.length - 1];
  const retainedA = sum(a.map((v) => v.size)), retainedB = sum(b.map((v) => v.size));
  captured[s.name] = { ratio: retainedA / retainedB };
  console.log(`--- ${s.name}: ${s.versions} versions, ${liveCount} live items ---`);
  console.log(`  retained history  A ${mb(retainedA)}  B ${mb(retainedB)}  (${(retainedA / retainedB).toFixed(1)}x smaller)`);
  console.log(`  tip size          A ${kb(tipA.size)}  B ${kb(tipB.size)}`);
  console.log(`  first contact     A ${kb(tipA.size)}  B ${kb(firstContactB(b))}`);
  const budgetA = budgetFor(tipA.size), budgetB = budgetFor(tipB.size);
  console.log(`  pin walk vs own §13.4 budget (A ${mb(budgetA)} / B ${mb(budgetB)}); * = over budget`);
  console.log('    lapse      A linear    A _skip     B delta     B delta+_skip');
  const perDay = s.versions / s.days;
  for (const [label, days] of [['1 day', 1], ['1 month', 30], ['1 year', 365]]) {
    const back = Math.min(s.versions - 1, Math.max(1, Math.round(perDay * days)));
    const pin = Math.max(1, s.versions - back);
    const r = { lin: walkChain(aNoSkip, pin), skip: walkSkipping(a, pin), delta: walkChain(b, pin), deltaSkip: walkSkipping(b, pin), budgetA, budgetB };
    const cell = (n, budget) => (mb(n) + (n > budget ? '*' : ' ')).padEnd(11);
    console.log(`    ${label.padEnd(10)} ${cell(r.lin, budgetA)} ${cell(r.skip, budgetA)} ${cell(r.delta, budgetB)} ${cell(r.deltaSkip, budgetB)}`);
    captured[`${s.name}|${label}`] = r;
  }
  console.log();
}

// At-rest check: serialize one year honestly and compress the retained series for real.
const q5 = {};
{
  const V = 365, ADDS = 3;
  const live = new Map(), deleted = new Map();
  let seed = 12345, next = 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const files = [];
  for (let seq = 1; seq <= V; seq++) {
    for (let i = 0; i < ADDS; i++) live.set(itemId(next++), 1);
    const recent = (n) => itemId(Math.max(0, next - 1 - Math.floor(rnd() * Math.min(next, n))));
    for (let i = 0; i < ADDS; i++) {
      if (rnd() < 0.05) { const id = recent(500); if (live.has(id)) live.set(id, live.get(id) + 1); }
      if (rnd() < 0.01) { const id = recent(500); if (live.has(id)) { deleted.set(id, live.get(id) + 1); live.delete(id); } }
    }
    files.push(Buffer.from(JSON.stringify({
      url: ID, feed_url: FEED, seq, updated: 1736899200 + seq * 86400,
      ...(seq > 1 ? { prev: b64u(sha256(Buffer.from('prev' + seq))) } : {}),
      items: Object.fromEntries([...live].map(([id, v]) => [id, [v, itemHash(id, v)]])),
      ...(deleted.size ? { deleted: Object.fromEntries([...deleted].map(([id, v]) => [id, [v, itemHash(id, v)]])) } : {}),
    }), 'utf8'));
  }
  const concat = Buffer.concat(files);
  q5.raw = sum(files.map((f) => f.length));
  q5.perFileGzip = sum(files.map((f) => zlib.gzipSync(f, { level: 9 }).length));
  q5.wholeGzip = zlib.gzipSync(concat, { level: 9 }).length;
  q5.wholeBrotli = zlib.brotliCompressSync(concat).length;
  q5.wholeZstd = typeof zlib.zstdCompressSync === 'function' ? zlib.zstdCompressSync(concat).length : null;
  q5.deltaTotal = sum(measure({ versions: V, addsPerVersion: ADDS, snapshotEvery: SNAPSHOT_EVERY }).b.map((v) => v.size));

  console.log(`--- at rest: 1 year serialized for real (${V} versions) ---`);
  const line = (label, n) => n && console.log(`  ${label.padEnd(24)} ${mb(n).padStart(7)}   ${(q5.raw / n).toFixed(1)}x`);
  line('raw on disk', q5.raw);
  line('per-file gzip -9', q5.perFileGzip);
  line('whole-set gzip -9', q5.wholeGzip);
  line('whole-set brotli', q5.wholeBrotli);
  line('whole-set zstd', q5.wholeZstd);
  line('delta encoding (B)', q5.deltaTotal);
  console.log();
}

// Directional claims only: magnitudes drift with the scenario table, directions carry the verdict.
const ratios = SCENARIOS.map((s) => captured[s.name].ratio);
const day = captured['1y hourly, 30 items/day|1 day'];
const year = captured['1y hourly, 30 items/day|1 year'];
const claims = [
  ['B wins retained storage by >=10x in every scenario', Math.min(...ratios) >= 10],
  ['short absence: a delta chain beats A + `_skip`', day.delta < day.skip],
  ['long absence: it inverts — a delta chain has no shortcut', year.delta > year.skip],
  ['and inverts past §13.4\'s budget, `_skip`\'s own case', year.delta > year.budgetB && year.skip <= year.budgetA],
  ['B + `_skip` dominates both on transfer', year.deltaSkip < year.skip && year.deltaSkip < year.delta],
  ['at rest, a large-window compressor reaches a delta encoding (§13.4\'s claim)', q5.wholeBrotli <= q5.deltaTotal],
  ['plain gzip does NOT, whole-set or not: 32 KB window < one version', q5.wholeGzip > q5.deltaTotal * 2 && q5.wholeGzip > q5.wholeBrotli],
  ['a static host precompressing per file gets the worse column', q5.perFileGzip > q5.wholeBrotli],
];
const broken = claims.filter(([, ok]) => !ok);
if (broken.length) {
  console.log('FAIL — these directional claims no longer hold:');
  for (const [label] of broken) console.log(`  ${label}`);
  console.log('Either this measure is stale or the card\'s verdict is. Both are findings.');
  process.exit(1);
}
console.log(`all ${claims.length} directional claims hold`);
