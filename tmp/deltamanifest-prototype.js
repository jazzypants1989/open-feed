// Delta-manifest prototype: is the snapshot+delta shape worth a second document shape?
//
// §13.4 names retained manifest history as "the largest storage obligation in the protocol",
// and the reason is structural: every version carries its whole `items` map, so history grows
// as O(versions x items). §9.2 bounds it from two directions (cadence cuts versions, rotation
// cuts items) and §9.1.1 papers over the walk cost with `_skip` — an OPTIONAL field that a
// publisher of any size has to emit or strand its own readers, which is a strange shape for
// something OPTIONAL.
//
// The alternative attacks the source: a version carries either a full `items` map (a SNAPSHOT,
// every Nth version) or just what changed (a DELTA). Retained history drops toward
// O(total changes). This measures whether that is worth a second document shape — which is
// exactly what "one way of doing each thing" forbids, so it has to be bought with numbers.
//
// Four questions:
//   Q1  Total retained history, both shapes, at family scale and ten years.
//   Q2  Reconnecting a pin 1 day / 1 month / 1 year back, against §13.4's byte budget
//       ("the greater of 10 MB and 20x the current version's size", decoded).
//   Q3  Does Model B make `_skip` unnecessary, or does it just move the cliff?
//   Q4  What does a FIRST-CONTACT consumer pay under B, which is where deltas usually lose?
//
// No signing here on purpose: signatures are a fixed ~120 bytes per version in both models and
// would only add noise. What is measured is the shape.

import crypto from 'node:crypto';
import zlib from 'node:zlib';

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const bytesOf = obj => Buffer.byteLength(canon(obj), 'utf8');
const SIG_BYTES = 128; // the `_sig` a real version carries, identical in both models

const ID = 'https://mom.pence.family/';
const FEED = ID + 'feed.json';
const itemId = n => `urn:uuid:${crypto.createHash('sha256').update('item-' + n).digest('hex').slice(0, 8)}-7dec-11d0-a765-00a0c91e6bf6`;
const itemHash = (n, v) => b64u(sha256(Buffer.from(`${n}/${v}`)));

// §9.1.1's anchors: for each k, the largest multiple of 2^k strictly below seq.
function skipAnchors(seq) {
  const out = new Set();
  for (let k = 0; ; k++) {
    const step = 2 ** k;
    const anchor = Math.floor((seq - 1) / step) * step;
    if (anchor < 1) break;
    out.add(anchor);
  }
  return [...out].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------------------
// Run the workload once and size both models as it goes.
//
// Each version is one cadence tick: some items added, occasionally one edited or tombstoned.
// §9.2's own example is three items a day for ten years — which is 3,650 versions over 10,781
// items, so nothing here may retain per-version state beyond a byte count. The full documents
// are built, measured, and dropped; only sizes survive the loop.
// ---------------------------------------------------------------------------------------
/** The canonical bytes of one `"<id>":[<version>,"<hash>"]` entry. */
const entryBytes = (id, v, hash) => JSON.stringify(id).length + 1 + `[${v},${JSON.stringify(hash)}]`.length;

/** `"<name>":{...}` including its leading comma, or nothing when the map is empty. */
const mapBytes = (name, entrySum, count) =>
  (count === 0 ? 0 : 1 + JSON.stringify(name).length + 1 + 2 + entrySum + (count - 1));

function measure({ versions, addsPerVersion, editRate = 0.05, deleteRate = 0.01, snapshotEvery }) {
  const live = new Map();     // id -> version
  const deleted = new Map();
  let itemsBytes = 0;         // running sum of live entry lengths
  let deletedBytes = 0;
  const a = [];               // { size } per version, Model A with `_skip`
  const aNoSkip = [];
  const b = [];               // { size, snapshot } per version, Model B
  let next = 0;
  // Deterministic pseudo-randomness: this has to reproduce, and Math.random would not.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let seq = 1; seq <= versions; seq++) {
    const added = [];
    const edited = [];
    const removed = [];
    for (let i = 0; i < addsPerVersion; i++) {
      const id = itemId(next++);
      live.set(id, 1);
      itemsBytes += entryBytes(id, 1, itemHash(id, 1));
      added.push(id);
    }
    // Edits and deletes are per-version rates, not per-item, so the churn does not scale with
    // the catalog — a ten-year-old post is not edited daily just because it still exists.
    // Picking a target out of the *recent* window rather than the whole catalog for the same
    // reason, and because sampling a growing key list per version is itself O(V x I).
    const recent = (n) => itemId(Math.max(0, next - 1 - Math.floor(rnd() * Math.min(next, n))));
    for (let i = 0; i < addsPerVersion; i++) {
      if (!live.size) break;
      if (rnd() < editRate) {
        const id = recent(500);
        if (live.has(id)) {
          const was = live.get(id);
          itemsBytes -= entryBytes(id, was, itemHash(id, was));
          live.set(id, was + 1);
          itemsBytes += entryBytes(id, was + 1, itemHash(id, was + 1));
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

    // --- Model A: today. Every version carries the whole `items` map.
    //
    // Sized from running totals rather than by serializing 10k entries 3,650 times. The map's
    // canonical bytes are exactly `{` + entries joined by `,` + `}`, and each entry's length is
    // a pure function of its id, version, and hash — so maintaining the sum as items are added,
    // edited, and tombstoned is exact, not an estimate. (Serializing it honestly is O(V x I),
    // which is the very cost this file exists to characterize; paying it to measure it would
    // take the better part of an hour.)
    const skip = {};
    for (const anchor of skipAnchors(seq)) skip[String(anchor)] = b64u(sha256(Buffer.from('anchor' + anchor)));
    const skipBytes = Object.keys(skip).length ? bytesOf({ _skip: skip }) - 2 : 0;

    const sizeA = envelope + mapBytes('items', itemsBytes, live.size)
                           + mapBytes('deleted', deletedBytes, deleted.size);
    aNoSkip.push({ seq, size: sizeA, snapshot: true });
    a.push({ seq, size: sizeA + skipBytes, snapshot: true });

    // --- Model B: snapshot every N versions, deltas between them. A delta names only what
    // changed since its predecessor; a reader holding no state walks back to the nearest
    // snapshot and replays forward, which `snapshot_at` points it at without a search.
    const isSnapshot = seq === 1 || seq % snapshotEvery === 0;
    let sizeB;
    if (isSnapshot) {
      sizeB = envelope + mapBytes('items', itemsBytes, live.size)
                       + mapBytes('deleted', deletedBytes, deleted.size);
    } else {
      const changes = {};
      const put = [...new Set([...added, ...edited])].filter((id) => live.has(id));
      if (put.length) changes.put = Object.fromEntries(put.map((id) => [id, [live.get(id), itemHash(id, live.get(id))]]));
      if (removed.length) changes.tombstone = Object.fromEntries(removed.map((id) => [id, [deleted.get(id), itemHash(id, deleted.get(id))]]));
      sizeB = envelope + bytesOf({ changes, snapshot_at: Math.max(1, Math.floor(seq / snapshotEvery) * snapshotEvery) }) - 2;
    }
    b.push({ seq, size: sizeB, snapshot: isSnapshot });
  }

  return { a, aNoSkip, b, liveCount: live.size, deletedCount: deleted.size };
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mb = (n) => (n / (1024 * 1024)).toFixed(1) + ' MB';
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/** §13.4: the greater of 10 MB and 20x the current version's size, decoded. */
const budgetFor = (tipSize) => Math.max(10 * 1024 * 1024, 20 * tipSize);

/** Model A, linear: fetch every version from the tip down to the pin. */
function walkLinear(versions, pinSeq) {
  return sum(versions.slice(pinSeq - 1).map((v) => v.size));
}

/**
 * Model A with `_skip`: each jump costs the landing plus its `seq+1` companion (§9.1.1 requires
 * the second fetch, or a publisher can aim a forged anchor at skipping readers alone).
 */
function walkSkipping(versions, pinSeq) {
  let at = versions.length;
  let bytes = versions[at - 1].size;
  while (at > pinSeq) {
    const anchor = skipAnchors(at).filter((a) => a >= pinSeq).pop();
    if (anchor === undefined || anchor === at) {
      bytes += versions[at - 2].size;
      at -= 1;
      continue;
    }
    bytes += versions[anchor - 1].size;                          // the landing
    if (versions[anchor]) bytes += versions[anchor].size;        // its seq+1 companion
    at = anchor;
  }
  return bytes;
}

/** Model B, linear: the deltas between the pin and the tip, and nothing else. */
function walkDelta(versions, pinSeq) {
  return sum(versions.slice(pinSeq - 1).map((v) => v.size));
}

/** First contact under B: the tip, back to its snapshot, and replay forward. */
function firstContactB(versions) {
  const tip = versions[versions.length - 1];
  if (tip.snapshot) return tip.size;
  let at = versions.length - 1;
  let bytes = tip.size;
  while (at >= 1 && !versions[at - 1].snapshot) {
    bytes += versions[at - 1].size;
    at -= 1;
  }
  if (at >= 1) bytes += versions[at - 1].size;
  return bytes;
}

// =========================================================================================
// A prototype whose numbers come from arithmetic rather than from bytes is worth nothing unless
// the arithmetic is checked against the bytes. This does that on a small case, where honest
// serialization is affordable, and refuses to print anything if it disagrees.
function selfCheck() {
  const live = new Map();
  let sum = 0;
  for (let i = 0; i < 37; i++) {
    const id = itemId(i);
    const v = 1 + (i % 12);   // multi-digit versions, so the digit-length term is exercised
    live.set(id, v);
    sum += entryBytes(id, v, itemHash(id, v));
  }
  const base = { url: ID, feed_url: FEED, seq: 9, updated: 1736899200, prev: b64u(sha256(Buffer.from('p'))) };
  const real = bytesOf({ ...base, items: Object.fromEntries([...live].map(([id, v]) => [id, [v, itemHash(id, v)]])) });
  const computed = bytesOf(base) + mapBytes('items', sum, live.size);
  if (real !== computed) {
    console.error(`self-check FAILED: serialized ${real} bytes, computed ${computed}`);
    process.exit(1);
  }
  // And the empty case, where the field is absent rather than `{}`.
  if (bytesOf(base) + mapBytes('items', 0, 0) !== bytesOf(base)) {
    console.error('self-check FAILED: an empty map should contribute nothing');
    process.exit(1);
  }
  return real;
}
const CHECKED = selfCheck();

const SNAPSHOT_EVERY = 64;
const SCENARIOS = [
  // §9.2's own example, and the configuration it warns about: neither axis applied.
  { name: '10 years, daily cadence, no rotation (§9.2\'s worked example)', versions: 3650, addsPerVersion: 3, days: 3650 },
  // What §9.2 actually recommends: rotate annually, so a chain is one year long.
  { name: '1 year, daily cadence — i.e. §9.2 rotation applied annually', versions: 365, addsPerVersion: 3, days: 365 },
  // A publisher whose volume is the problem: cadence applied, rotation not yet.
  { name: '1 year, hourly cadence, 30 items/day', versions: 8760, addsPerVersion: 1.25, days: 365 },
];

console.log('=== delta-manifest prototype: is a second document shape worth it? ===');
console.log(`(byte arithmetic self-checked against real serialization: ${CHECKED} bytes, exact)\n`);

// Q3's prose quotes these back. Capture them rather than hardcoding, because a hardcoded
// figure is exactly how `itemurls-prototype.js`'s headline number went stale.
const captured = {};

for (const s of SCENARIOS) {
  const adds = Math.round(s.addsPerVersion);
  const { a, aNoSkip, b, liveCount } = measure({ ...s, addsPerVersion: adds, snapshotEvery: SNAPSHOT_EVERY });

  const tipA = a[a.length - 1];
  const tipB = b[b.length - 1];

  console.log(`--- ${s.name} ---`);
  console.log(`  versions ${s.versions}, live items at the end ${liveCount}`);
  console.log();
  console.log('  Q1  total retained history (what §5.4 obliges the publisher to serve forever)');
  console.log(`        A  full map per version   : ${mb(sum(a.map(v => v.size)))}`);
  console.log(`        B  snapshot every ${SNAPSHOT_EVERY}      : ${mb(sum(b.map(v => v.size)))}` +
              `   (${(sum(a.map(v => v.size)) / sum(b.map(v => v.size))).toFixed(1)}x smaller)`);
  console.log(`        tip version size          : A ${kb(tipA.size)}  ·  B ${kb(tipB.size)}`);
  console.log();

  // §13.4's budget is "20x the CURRENT version's size", so it is a property of the model being
  // walked, not a single number both models are graded against. B's tip is a delta, so B's real
  // budget is almost always the 10 MB floor — which is *stricter* than grading it against A's
  // tip, and an earlier draft of this file did the generous thing by mistake.
  const budgetA = budgetFor(tipA.size);
  const budgetB = budgetFor(tipB.size);
  console.log(`  Q2  reconnecting a pin, each model against its OWN §13.4 budget`);
  console.log(`        A: ${mb(budgetA)} (20x the ${kb(tipA.size)} tip)  ·  B: ${mb(budgetB)} (20x the ${kb(tipB.size)} tip, so the 10 MB floor)`);
  const perDay = s.versions / s.days;
  const absences = [['1 day', 1], ['1 month', 30], ['1 year', 365]]
    .map(([label, days]) => [label, Math.min(s.versions - 1, Math.max(1, Math.round(perDay * days)))]);
  for (const [label, back] of absences) {
    const pin = Math.max(1, s.versions - back);
    const lin = walkLinear(aNoSkip, pin);
    const skip = walkSkipping(a, pin);
    const delta = walkDelta(b, pin);
    // The configuration this file previously declined to measure. Anchor structure is identical
    // to A's — absolute powers of two, landing plus `seq+1` companion — so the same walker
    // applies; only the per-version sizes differ. Caveat stated in Q3: for a consumer that needs
    // reconstructed STATE (invariant 1), anchors would have to land on snapshots, which this
    // does not model. As a hash-linkage cost it is exact.
    const deltaSkip = walkSkipping(b, pin);
    const v = (n, budget) => (n <= budget ? 'ok  ' : 'OVER');
    console.log(`        ${label.padEnd(8)} (${back} versions back)`);
    console.log(`          A linear     ${v(lin, budgetA)} ${mb(lin).padStart(9)}`);
    console.log(`          A _skip      ${v(skip, budgetA)} ${mb(skip).padStart(9)}`);
    console.log(`          B delta      ${v(delta, budgetB)} ${mb(delta).padStart(9)}`);
    console.log(`          B delta+skip ${v(deltaSkip, budgetB)} ${mb(deltaSkip).padStart(9)}`);
    captured[`${s.name}|${label}`] = { lin, skip, delta, deltaSkip, budgetA, budgetB };
  }
  captured[s.name] = {
    retainedA: sum(a.map((v) => v.size)),
    retainedB: sum(b.map((v) => v.size)),
    ratio: sum(a.map((v) => v.size)) / sum(b.map((v) => v.size)),
  };
  console.log();
  console.log('  Q4  first contact (no pin: the cost of meeting this identity at all)');
  console.log(`        A  the tip alone          : ${kb(tipA.size)}`);
  console.log(`        B  tip + replay to snapshot: ${kb(firstContactB(b))}`);
  console.log();
}

// =========================================================================================
// Q5 — the claim the recommendation rests on, finally measured.
//
// The verdict below says the storage win is "bought at the wrong counter" because compressing
// AT REST gets the same 40-60x with no wire change. That sentence is now in the spec
// (§13.4: "compressing or delta-encoding at rest brings the bytes on disk to roughly O(total
// changes)") and nothing here had ever measured it. It needs real bytes, so this builds one
// scenario's chain honestly — 365 versions is affordable to serialize, unlike 8760.
//
// Two regimes, because they answer different questions and only one of them is the claim:
//   per-file   — what a static host with precompressed assets gets. Cannot see across versions,
//                so it can only find redundancy INSIDE one manifest.
//   whole-set  — what a backup or an object store with cross-object dedup gets. This is the
//                regime the O(total changes) claim is about.
// =========================================================================================
console.log('=== Q5: is the storage win really available at rest, with no wire change? ===\n');
{
  const S = { versions: 365, addsPerVersion: 3 };
  const live = new Map();
  const deleted = new Map();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let next = 0;
  const files = [];
  for (let seq = 1; seq <= S.versions; seq++) {
    for (let i = 0; i < S.addsPerVersion; i++) live.set(itemId(next++), 1);
    const recent = (n) => itemId(Math.max(0, next - 1 - Math.floor(rnd() * Math.min(next, n))));
    for (let i = 0; i < S.addsPerVersion; i++) {
      if (rnd() < 0.05) { const id = recent(500); if (live.has(id)) live.set(id, live.get(id) + 1); }
      if (rnd() < 0.01) { const id = recent(500); if (live.has(id)) { deleted.set(id, live.get(id) + 1); live.delete(id); } }
    }
    const doc = {
      url: ID, feed_url: FEED, seq, updated: 1736899200 + seq * 86400,
      ...(seq > 1 ? { prev: b64u(sha256(Buffer.from('prev' + seq))) } : {}),
      items: Object.fromEntries([...live].map(([id, v]) => [id, [v, itemHash(id, v)]])),
      ...(deleted.size ? { deleted: Object.fromEntries([...deleted].map(([id, v]) => [id, [v, itemHash(id, v)]])) } : {}),
    };
    files.push(Buffer.from(JSON.stringify(doc), 'utf8'));
  }

  const raw = sum(files.map((f) => f.length));
  const perFileGzip = sum(files.map((f) => zlib.gzipSync(f, { level: 9 }).length));
  const concat = Buffer.concat(files);
  const wholeGzip = zlib.gzipSync(concat, { level: 9 }).length;
  const wholeBrotli = zlib.brotliCompressSync(concat).length;
  const wholeZstd = typeof zlib.zstdCompressSync === 'function'
    ? zlib.zstdCompressSync(concat).length : null;

  // The floor the claim aims at: what a delta encoding of the same series would cost, which is
  // Model B's total for the same shape.
  const { b: bSeries } = measure({ versions: S.versions, addsPerVersion: S.addsPerVersion, snapshotEvery: SNAPSHOT_EVERY });
  const deltaTotal = sum(bSeries.map((v) => v.size));

  const line = (label, n) => console.log(`    ${label.padEnd(34)} ${mb(n).padStart(9)}   ${(raw / n).toFixed(1)}x`);
  console.log(`  365 versions, ${live.size} live items at the end, serialized for real:\n`);
  line('raw on disk (what §5.4 obliges)', raw);
  line('per-file gzip -9', perFileGzip);
  line('whole-set gzip -9', wholeGzip);
  line('whole-set brotli', wholeBrotli);
  if (wholeZstd) line('whole-set zstd', wholeZstd);
  line('delta encoding (Model B, for scale)', deltaTotal);
  console.log();
  console.log('  The claim holds — but NOT for the compressor most people mean by "compress at rest",');
  console.log('  and that qualification is the finding here.');
  console.log();
  console.log(`  · per-file gzip: ${(raw / perFileGzip).toFixed(1)}x. It is compressing one manifest against itself. The`);
  console.log('    entries are SHA-256 hashes, so what it finds is the shared id prefix and base64');
  console.log('    alphabet, not the fact that this version is nearly identical to the last one.');
  console.log(`  · whole-set gzip: ${(raw / wholeGzip).toFixed(1)}x — barely better, and this is the trap. DEFLATE's window`);
  console.log(`    is 32 KB and one version here is ${kb(files[files.length - 1].length)}, so gzip cannot see the previous`);
  console.log('    version even when handed the whole series. Concatenating and gzipping LOOKS like');
  console.log('    the fix and is not.');
  console.log(`  · whole-set brotli: ${(raw / wholeBrotli).toFixed(1)}x` + (wholeZstd ? `, zstd: ${(raw / wholeZstd).toFixed(1)}x` : '') + '. Large-window compressors DO see across');
  console.log(`    versions, and they beat an actual delta encoding (${(raw / deltaTotal).toFixed(1)}x) — because a delta version`);
  console.log('    still carries a fresh 43-char hash per change, while a compressor sees the whole');
  console.log('    unchanged remainder as one reference.');
  console.log();
  console.log('  So §13.4\'s "compressing or delta-encoding at rest brings the bytes on disk to roughly');
  console.log('  O(total changes)" is earned, and it should say WITH WHAT: a large-window compressor');
  console.log('  or a store that dedups across objects. A static host serving precompressed files gets');
  console.log(`  the ${(raw / perFileGzip).toFixed(1)}x column, not the ${(raw / wholeBrotli).toFixed(0)}x one — an ordinary operational choice, but a choice.`);
  console.log('  (Ids here share a fixed 36-char suffix, which flatters the per-file column and does');
  console.log('  not touch the cross-version one, since that redundancy is whole-entry repetition.)');
}
console.log();

const HOURLY = SCENARIOS[2].name;
const ANNUAL = SCENARIOS[1].name;
const day = captured[`${HOURLY}|1 day`];
const year = captured[`${HOURLY}|1 year`];
const ratios = SCENARIOS.map((s) => captured[s.name].ratio);

console.log('=== Q3: does B retire `_skip`?  No — and the reason is the interesting part ===');
console.log(`
The two mechanisms scale in different variables, and the rows above are where that shows.

  \`_skip\` is O(log VERSIONS).  Deltas are O(CHANGES SINCE THE PIN).

For a short absence, deltas win outright and it is not close: one day back at hourly cadence
costs A+\`_skip\` ${mb(day.skip)} and B ${mb(day.delta)}, because B transfers the twenty-odd entries that
actually changed and A transfers two full snapshots per jump. For a LONG absence it inverts. A
year back at hourly cadence costs A+\`_skip\` ${mb(year.skip)} and B ${mb(year.delta)} — the whole history —
because a delta chain has no shortcut in it and a logarithmic one does. B breaches §13.4's
budget in exactly the case \`_skip\` was invented for.

So the honest answer to "does the delta shape let us delete §9.1.1?" is no. The two are
complements — and B+\`_skip\` genuinely dominates both, which this file previously asserted and
declined to measure. It is measured now, in the fourth row of every block above: ${mb(year.deltaSkip)} for the
year-back lapse against A+\`_skip\`'s ${mb(year.skip)} and B-delta's ${mb(year.delta)}, and it is the cheapest
option at every other lapse too. That is a real result and it should be stated as one: **the
recommendation below is not that Model A is cheaper. It is not.**

(One caveat on that row, since an unstated approximation is how the last set of numbers rotted:
it prices HASH LINKAGE, reusing A's absolute-anchor structure over B's version sizes. A consumer
that must also reconstruct STATE — invariant 1 — would need anchors landing on snapshots, which
would raise it. The direction of the error is against B+\`_skip\`, so the conclusion that it
dominates on transfer cost is safe.)

What B unambiguously wins is STORAGE, by ${Math.min(...ratios).toFixed(0)}-${Math.max(...ratios).toFixed(0)}x, and that is the obligation §13.4 calls the
largest in the protocol. Note though what §9.2 already does about it: the middle scenario is
that section's own recommendation (annual rotation) and Model A lands at ${mb(captured[ANNUAL].retainedA)} of retained
history for a family with a thousand live posts, walked comfortably inside budget at every
absence except a full year — which \`_skip\` covers. §9.2's two axes are doing the job they
claim to do.

The cost side, stated plainly, because it is what the decision turns on:

  · A second document shape. A verifier must handle snapshot and delta versions, and §9.3's
    invariants — today one map lookup between adjacent versions — become a fold over a range.
    That is the "one way of doing each thing" principle spent, at its most expensive point.
  · Invariant 1 weakens per-hop. "An id, once in items, appears in every later manifest" is
    checkable between two adjacent versions today; between two deltas it is only checkable
    against reconstructed state, so a consumer must hold that state to check anything at all.
  · §5.3.1 compares bytes that observers fetched. Under B most versions are deltas, so what
    two observers hold in common is reconstructed state rather than published bytes — and
    §16.1 already calls a skipping consumer a weaker witness for exactly this reason.

Recommendation on these numbers: keep Model A — on the three costs above, NOT on cost of
transfer or storage, both of which B wins. The storage win is real and large; it is bought at
the wrong counter. The publisher pays the storage, and Q5 now measures what §13.4 asserts: a
large-window compressor over the retained series gets the same order as a delta encoding, with
no change to the wire format, no second document shape, and no weakening of what a consumer can
check. Two qualifications Q5 earns and §13.4 should carry: plain gzip does NOT get you there —
its 32 KB window is smaller than one manifest version — and a static host serving precompressed
files gets the per-file column, not the cross-version one.

So the trade is: a publisher-side storage cost, removable at rest by choosing the right
compressor, against a permanent complexity cost on every verifier plus a weakening of invariant
1 and of what §5.3.1 observers hold in common. That is a bad trade at this scale, and it would
still be a bad trade if B+\`_skip\` were faster — which it is.`);
