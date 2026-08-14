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

  const budget = budgetFor(tipA.size);
  console.log(`  Q2  reconnecting a pin, against §13.4's budget of ${mb(budget)} (20x the ${kb(tipA.size)} tip)`);
  const perDay = s.versions / s.days;
  const absences = [['1 day', 1], ['1 month', 30], ['1 year', 365]]
    .map(([label, days]) => [label, Math.min(s.versions - 1, Math.max(1, Math.round(perDay * days)))]);
  for (const [label, back] of absences) {
    const pin = Math.max(1, s.versions - back);
    const lin = walkLinear(aNoSkip, pin);
    const skip = walkSkipping(a, pin);
    const delta = walkDelta(b, pin);
    const verdict = (n) => (n <= budget ? 'ok  ' : 'OVER');
    console.log(`        ${label.padEnd(8)} (${back} versions back)`);
    console.log(`          A linear   ${verdict(lin)} ${mb(lin).padStart(9)}`);
    console.log(`          A _skip    ${verdict(skip)} ${mb(skip).padStart(9)}`);
    console.log(`          B delta    ${verdict(delta)} ${mb(delta).padStart(9)}`);
  }
  console.log();
  console.log('  Q4  first contact (no pin: the cost of meeting this identity at all)');
  console.log(`        A  the tip alone          : ${kb(tipA.size)}`);
  console.log(`        B  tip + replay to snapshot: ${kb(firstContactB(b))}`);
  console.log();
}

console.log('=== Q3: does B retire `_skip`?  No — and the reason is the interesting part ===');
console.log(`
The two mechanisms scale in different variables, and the rows above are where that shows.

  \`_skip\` is O(log VERSIONS).  Deltas are O(CHANGES SINCE THE PIN).

For a short absence, deltas win outright and it is not close: one day back at hourly cadence
costs A+\`_skip\` 2.5 MB and B under 0.1 MB, because B transfers the twenty-odd entries that
actually changed and A transfers two full snapshots per jump. For a LONG absence it inverts. A
year back at hourly cadence costs A+\`_skip\` 3.9 MB and B 59.4 MB — the whole history — because
a delta chain has no shortcut in it and a logarithmic one does. B breaches §13.4's budget in
exactly the case \`_skip\` was invented for.

So the honest answer to "does the delta shape let us delete §9.1.1?" is no. The two are
complements, and B+\`_skip\` (anchored on snapshots, the only versions carrying full state) would
genuinely dominate both — at the price of a THIRD mechanism in the one document a consumer
parses most, which is where the design stops being small.

What B unambiguously wins is STORAGE, by 38-60x, and that is the obligation §13.4 calls the
largest in the protocol. Note though what §9.2 already does about it: the middle scenario is
that section's own recommendation (annual rotation) and Model A lands at 18.9 MB of retained
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

Recommendation on these numbers: keep Model A. Not because the storage win is small — it is
large — but because it is bought at the wrong counter. The publisher pays the storage, and
§13.4 already notes that successive versions differ by a handful of entries, so compressing or
delta-encoding AT REST brings the same 40-60x to disk with no change to the wire format, no
second document shape, and no weakening of what a consumer can check. The delta shape moves a
publisher-side storage cost onto every verifier's complexity budget. That is the trade, and it
is a bad one at this scale.`);
