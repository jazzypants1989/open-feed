// Derived item URLs: can an individually-addressable item make §9.3's withholding verdict
// reachable at all, and if so, addressed by what?
//
// The problem is live in shipped code, and it is the *opposite* of what this file's first draft
// assumed. That draft argued §7.6's case from false accusations — an ordinary publisher serving
// a 50-item window having every older item reported as `withheld`. Commit 932404c then rewrote
// `src/manifest.js` so that `withheld` is asserted only for ids the caller **requested** at a
// §7.6 URL and did not get; everything else committed-but-not-yielded is `absent`, which
// accuses nobody (`src/manifest.js:327-352`). That is the correct reading of §9.3 — a page with
// no `next_url` may be a complete catalog or a recency window, and the two are indistinguishable
// from the bytes — so the false accusations are gone and this prototype's old headline number no
// longer reproduces.
//
// What replaces it is a stronger argument, not a weaker one. A reader with no §7.6 available now
// never reports withholding against anybody: safe, and also **blind**. The one attack the
// manifest exists to detect on the pull path — commit the bytes, refuse to serve them — has no
// verdict behind it. §9.3 says exactly this ("close to unreachable on the pull path unless the
// publisher offers §7.6"), which makes §7.6 the load-bearing half of a Level 1 MUST rather than
// a convenience. Q1 below measures both halves: what the blind reader reports, and what the
// alternative — a complete pass over the catalog — actually costs.
//
// §5.4 already solved the shape of this problem once — a chained document's prior versions are
// individually addressable at a *derived* URL, so a consumer can ask for one thing instead of
// re-reading everything. This asks whether items want the same treatment, and settles the
// addressing question by measurement rather than taste:
//
//   Q1  The baseline: what does "walk `next_url` to the end" actually cost, and does it fit
//       §13.4? That is the do-nothing fix, and it has to be priced before anything is added.
//   Q2  ID-ADDRESSED — `{feed minus .json}/{item_id}.json`. Human-meaningful and mutable. It
//       needs a percent-encoding rule, which §3.1 deliberately declines to give. How ambiguous
//       is that in practice?
//   Q3  HASH-ADDRESSED — `{feed minus .json}/items/{hash}.json`, the §5.1 value the manifest
//       already commits. No encoding rule, immutable, and self-verifying on arrival.
//   Q4  What each scheme can and cannot answer, and what a standalone item body does to §6.3's
//       "an item has no byte range of its own".
//
// Imports src/: the hashing rule, the canonicalization, and the reconcile logic under test are
// the shipped ones.

import {
  Publisher,
  reconcileFeed,
  documentHash,
  canonicalBytes,
  sha256,
  b64u,
  parseIJSON,
  assertCanonicalBytes,
} from '../src/index.js';

import crypto from 'node:crypto';

const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`Q${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

let clock = 1736899200;
const DAY = 86400;
const now = () => clock;

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: 1736899200 - DAY, kid, kty: 'OKP', x }, privateKey };
}

const ID = 'https://mom.pence.family/';
const FEED = `${ID}feed.json`;

// ---------------------------------------------------------------------------------------
// A ten-year family journal, at the cadence DISTRIBUTION-MODEL describes: 3 items a day, some
// edited, a few tombstoned. Built with the real Publisher so every hash is the real one.
// ---------------------------------------------------------------------------------------

const YEARS = 10;
const PER_DAY = 3;
const TOTAL = YEARS * 365 * PER_DAY;

const mom = new Publisher({ identity: ID, title: "Mom's Journal", signer: makeSigner('key-1'), now });

// Building 10,950 signed items with real Ed25519 is ~20s; build a representative 1/10th and
// scale the counts, keeping every *measured* byte real.
const SAMPLE = Math.floor(TOTAL / 10);
const idOf = (n) => `urn:uuid:${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

for (let n = 0; n < SAMPLE; n++) {
  clock += DAY / PER_DAY;
  mom.publishItem({ id: idOf(n), title: `Day ${Math.floor(n / PER_DAY)}`, content_text: 'x'.repeat(280) });
}
// 20% edited once, 5% edited a second time, 3% tombstoned — the revision history that decides
// how many files a hash-addressed scheme accumulates.
let revisions = SAMPLE;
for (let n = 0; n < SAMPLE; n++) {
  clock += 60;
  if (n % 5 === 0) { mom.publishItem({ id: idOf(n), content_text: 'y'.repeat(280) }); revisions++; }
  if (n % 20 === 0) { mom.publishItem({ id: idOf(n), content_text: 'z'.repeat(280) }); revisions++; }
  if (n % 33 === 0) { mom.tombstone(idOf(n)); revisions++; }
}
mom.advanceManifest();

const manifest = mom.manifest;
const feedItems = mom.feed.items;
const liveCount = Object.keys(manifest.items).length;
const deletedCount = Object.keys(manifest.deleted ?? {}).length;

say(`Ten-year family journal, measured on a 1/10 sample and scaled where noted.`);
say(`  items published      : ${SAMPLE} sampled  (${TOTAL} over ${YEARS} years at ${PER_DAY}/day)`);
say(`  revisions signed     : ${revisions}  (edits + tombstones)`);
say(`  manifest commits     : ${liveCount} live, ${deletedCount} deleted`);
say(`  manifest bytes       : ${kb(canonicalBytes(manifest).length)}`);
say(`  feed bytes (all)     : ${mb(canonicalBytes(mom.feed).length)}`);

// ---------------------------------------------------------------------------------------
// Q1 — the do-nothing fix: walk next_url to the end
// ---------------------------------------------------------------------------------------

scene(1, 'The baseline — what a reader without §7.6 can say, and what the alternative costs');

const PAGE = 50;                          // §7.4: feeds SHOULD carry at least 50 recent items
const FEED_PAGE_CAP = 10 * 1048576;       // §13.4 feed page cap
const HISTORY_CAP = 10 * 1048576;         // §13.4 total history bytes per update

// Real page bytes: slice the real feed into real JSON Feed pages.
function pagesOf(items, per) {
  const out = [];
  for (let i = 0; i < items.length; i += per) {
    const page = {
      version: 'https://jsonfeed.org/version/1.1',
      title: mom.title,
      feed_url: FEED,
      items: items.slice(i, i + per),
      ...(i + per < items.length ? { next_url: `${ID}feed/${i / per + 1}.json` } : {}),
    };
    out.push(canonicalBytes(page));
  }
  return out;
}

const pages = pagesOf(feedItems, PAGE);
const sampledBytes = pages.reduce((a, b) => a + b.length, 0);
const scaledPages = pages.length * 10;
const scaledBytes = sampledBytes * 10;

say(`  page size ${PAGE} items`);
say(`  sampled : ${pages.length} pages, ${mb(sampledBytes)} to make one complete pass`);
say(`  scaled  : ${scaledPages} pages, ${mb(scaledBytes)} for the full ${TOTAL}-item catalog`);
say(`  §13.4 budgets nothing for this — the feed page cap is per page (${mb(FEED_PAGE_CAP)}), and the`);
say(`  history budget (${mb(HISTORY_CAP)}) is for CHAIN versions. A complete pass is ${scaledPages} fetches`);
say(`  and ${mb(scaledBytes)} on every poll, to assert a verdict about items nobody suspects.`);
say();

// What the reader reports today, with the real reconcile logic. The `partial` flag is the one
// an earlier draft thought was load-bearing; measure both settings and show it is not.
const onePage = feedItems.slice(0, PAGE);
const blindUnflagged = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: false });
const blindFlagged = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: true });
const count = (r, state) => r.states.filter((s) => s.state === state).length;

const falseWithheld = count(blindUnflagged, 'withheld');
const withFlag = count(blindFlagged, 'withheld');
const absentCount = count(blindUnflagged, 'absent');

say(`  reconcile one ${PAGE}-item page against a ${liveCount}-item manifest, no §7.6 available:`);
say(`    partial:false → ${String(falseWithheld).padStart(5)} withheld, ${String(absentCount).padStart(5)} absent`);
say(`    partial:true  → ${String(withFlag).padStart(5)} withheld, ${String(count(blindFlagged, 'absent')).padStart(5)} absent`);
say(`  Zero accusations either way, and the flag only colors a reason string. That is the`);
say(`  shipped behavior being *correct* — and it is also the reader saying nothing at all about`);
say(`  ${absentCount} committed revisions it cannot obtain.`);
say();

// Now the same corpus with §7.6 available: probe the ids the page did not yield, and let a
// hostile publisher refuse a handful of them. This is the only path that reaches `withheld`.
const committedIds = Object.keys(manifest.items);
const servedIds = new Set(onePage.map((i) => i.id));
const notYielded = committedIds.filter((id) => !servedIds.has(id));
// A publisher that commits the bytes and answers 404 at the item URL: the attack itself.
const REFUSED = 3;
const unobtainable = new Set(notYielded.slice(0, REFUSED));
const probed = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: true, unobtainable });
const withheldWithProbe = count(probed, 'withheld');

say(`  the same read with §7.6 probes, against a publisher refusing ${REFUSED} committed revisions:`);
say(`    → ${withheldWithProbe} withheld, ${count(probed, 'absent')} absent`);
const probeBytes = canonicalBytes(mom.items.get([...unobtainable][0])).length;
say(`  ${withheldWithProbe} fetches of ${probeBytes} B each reach a verdict the ${mb(scaledBytes)} pass above`);
say('  reaches for every id at once and no consumer can afford on every poll.');

verdict(
  `Without §7.6 the withholding verdict is not weak, it is unreachable: ${falseWithheld} withheld out of\n`
  + `${absentCount} committed-and-unobtainable revisions, at any \`partial\` setting. The only alternative the\n`
  + `core offers is a ${mb(scaledBytes)} complete pass on every poll, which §13.4 budgets nothing for. With\n`
  + '§7.6 it is one fetch per item a consumer actually cares about — so the mechanism wanted here\n'
  + 'is "ask for one item", not "read everything", and it is the difference between a MUST that\n'
  + 'can be honored and one that cannot.',
);

// ---------------------------------------------------------------------------------------
// Q2 — id-addressed
// ---------------------------------------------------------------------------------------

scene(2, 'ID-addressed — and the percent-encoding rule §3.1 refuses to write');

const base = FEED.replace(/\.json$/, '');

// Item ids in the wild. §7.2 requires global uniqueness and forbids '#'; it recommends UUID
// URNs and tag URIs, and constrains nothing else.
const IDS = [
  'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  'tag:example.com,2025-12-07:hospital',
  'tag:example.com,2025:posts/1',            // a '/' — an ordinary tag URI, and a path segment
  'urn:uuid:AB%2FCD-0000-4000-8000-000000000000', // '%2F' as published; §3.1 never decodes it
  'https://mom.pence.family/2025/12/07/',    // ids may be URLs, and often are
];

const encoders = {
  encodeURIComponent,
  encodeURI,
  // What an implementer reaches for first: resolve the id as a relative reference. An id that
  // carries its own scheme (`urn:`, `tag:`, `https:`) is not relative at all, so this swallows
  // the base — a derived URL pointing anywhere, including off-origin.
  'new URL(id, base)': (s) => new URL(s, base + '/').href.slice((base + '/').length),
};

say('  item id                                              distinct derived paths');
let ambiguous = 0;
let ambiguousEncodersOnly = 0;   // excluding the resolver, which is a mistake rather than a choice
let escapes = 0;
for (const id of IDS) {
  const results = new Map();
  for (const [name, fn] of Object.entries(encoders)) {
    let got;
    try { got = fn(id); } catch { got = '<throws>'; }
    results.set(name, got);
  }
  const distinct = new Set(results.values());
  if (distinct.size > 1) ambiguous++;
  if (new Set([encodeURIComponent(id), encodeURI(id)]).size > 1) ambiguousEncodersOnly++;
  // The one thing §5.4 asks of a derived path is that it stay under the reserved prefix. A
  // surviving '/' makes it a different subtree; a resolver that swallowed the base loses it.
  const traversal = [...distinct].some((p) => p.includes('/'));
  if (traversal) escapes++;
  say(`  ${id.padEnd(52)} ${distinct.size}${traversal ? '   ← leaves the path segment' : ''}`);
  for (const [name, got] of results) say(`      ${name.padEnd(18)} ${base}/${got}.json`);
}
say();
say(`  ${ambiguous} of ${IDS.length} ids derive a different URL depending on which of the three the implementation uses.`);
say(`  ${ambiguousEncodersOnly} of ${IDS.length} still do with the resolver excluded — and that is the number the argument`);
say('  rests on. `new URL(id, base)` is a *resolver*, not an encoder: an id carrying its own');
say('  scheme is not a relative reference, so it swallows the base and produces garbage. Counting');
say('  it inflates the case. The honest comparison is encodeURIComponent vs encodeURI, and they');
say(`  already disagree on ${ambiguousEncodersOnly} of ${IDS.length} — two encoders every implementer has to hand.`);
say(`  ${escapes} of ${IDS.length} escape their path segment under at least one encoder — a derived URL that is`);
say('  no longer under the reserved prefix, which is the one thing §5.4 asks of a derived path.');
say();
say('  This is not an oversight to patch. §3.1 states the reason: "percent-encoding in it is');
say('  compared as published — never decoded, never re-encoded", because "a normalizer is not');
say('  implementable identically twice". An id-addressed scheme needs exactly the normalizer that');
say('  section declined to specify, and it needs it at a place where getting it wrong is a 404');
say('  that reads as withholding — the verdict this whole mechanism exists to make honest.');

// ---------------------------------------------------------------------------------------
// Q3 — hash-addressed
// ---------------------------------------------------------------------------------------

scene(3, 'HASH-ADDRESSED — the manifest already names the thing you want to ask for');

const someId = Object.keys(manifest.items)[7];
const [someVersion, someHash] = manifest.items[someId];
const hashUrl = `${base}/items/${someHash}.json`;

say(`  manifest entry : "${someId}": [${someVersion}, "${someHash}"]`);
say(`  derived URL    : ${hashUrl}`);
say();
say('  Three properties fall out with nothing added:');

// 1. URL-safe by construction.
const allSafe = Object.values(manifest.items).every(([, h]) => /^[A-Za-z0-9_-]{43}$/.test(h));
say(`  1. base64url is already URL-safe and fixed-length — no encoding rule, no ambiguity : ${allSafe ? 'yes' : 'NO'}`);

// 2. Self-verifying on arrival: the URL names its own content hash. This only closes because
//    regime A makes a document's published bytes its canonicalization (canonicality-prototype).
const item = mom.items.get(someId);
const served = canonicalBytes(item);
const reparsed = parseIJSON(served.toString('utf8'));
assertCanonicalBytes(reparsed, served, 'item');
const selfVerifies = b64u(sha256(served)) === someHash;
say(`  2. self-verifying: sha256(body) IS the URL, so a fetch needs no trust in the server  : ${selfVerifies ? 'yes' : 'NO'}`);
say('     — and no manifest lookup, no signature check, no identity fetch, to know you got');
say('     the bytes you asked for. Verification of *authorship* is unchanged and still §6.5.');

// 3. Immutable → cacheable forever, and old revisions stay fetchable.
say('  3. immutable: a revision\'s URL never changes content, so it is cacheable forever and an');
say('     older revision stays retrievable — which nothing else in the protocol offers. §7.3 says');
say('     "feeds carry only the latest version", so today a superseded revision is unreachable');
say('     even though the manifest chain still names its exact bytes.');
say();

// Storage.
const revisionFiles = revisions * 10;      // hash-addressed: one file per revision, forever
const idFiles = TOTAL;                     // id-addressed: one file per id, overwritten
const avgItem = canonicalBytes(item).length;
say(`  static-host cost over ${YEARS} years (scaled from the sample):`);
say(`    id-addressed    ${String(idFiles).padStart(6)} files, ${mb(idFiles * avgItem)}  (mutable; a revision overwrites)`);
say(`    hash-addressed  ${String(revisionFiles).padStart(6)} files, ${mb(revisionFiles * avgItem)}  (immutable; revisions accumulate)`);
say(`    the feed itself ${String(scaledPages).padStart(6)} files, ${mb(scaledBytes)}`);
say(`    retained manifest history is O(versions x items) and dwarfs both (§9.2, §13.4).`);

// The withholding probe, priced.
say();
say('  asserting withholding, hash-addressed: one fetch of one item, ' + `${avgItem} B.`);
say(`  Against the ${mb(scaledBytes)} complete pass in Q1, that is the difference between a verdict a`);
say('  consumer can afford about anything it cares about and one it can afford about nothing.');

// ---------------------------------------------------------------------------------------
// Q4 — what each answers, and the byte-range question
// ---------------------------------------------------------------------------------------

scene(4, 'What each scheme answers, and what a standalone body does to §6.3');

const rows = [
  ['assert withholding for a named item', 'complete pass only', 'yes, 1 fetch', 'yes, 1 fetch'],
  ['needs an encoding rule §3.1 refuses', '—', 'YES', 'no'],
  ['self-verifying without the manifest', 'no', 'no', 'yes'],
  ['fetch "current revision of id X"', 'yes', 'yes', 'no — the manifest answers it'],
  ['fetch a superseded revision', 'no', 'no', 'yes'],
  ['immutable / cacheable forever', 'no', 'no', 'yes'],
  ['files accumulate with revisions', '—', 'no', 'yes'],
];
say('  ' + 'property'.padEnd(38) + 'baseline'.padEnd(20) + 'id-addressed'.padEnd(16) + 'hash-addressed');
for (const r of rows) say('  ' + r[0].padEnd(38) + r[1].padEnd(20) + r[2].padEnd(16) + r[3]);

say();
say('  On §6.3\'s "an item has no byte range of its own" — the sentence that made parser');
say('  equivalence part of the signing construction, and the reason `__proto__` had to be');
say('  reserved. A standalone item body gives it one, but does NOT retire the rule: a consumer');
say('  reading the feed still parses the item out of an array, so the divergence class is');
say('  unchanged there. What it adds is a CHECK that today has none —');

// Demonstrate: a feed-parse and a standalone body that disagree are now detectable.
const feedParse = parseIJSON(canonicalBytes(mom.feed).toString('utf8')).items.find((i) => i.id === someId);
const agree = documentHash(feedParse) === b64u(sha256(served));
say(`    hash(item parsed out of the feed) === hash(standalone body) : ${agree ? 'yes' : 'NO'}`);
say('    so a verifier whose parser disagrees with the publisher\'s serializer now fails a byte');
say('    comparison instead of silently pinning a different hash than everybody else.');

// ---------------------------------------------------------------------------------------

say();
say('='.repeat(78));
const claims = [
  ['a feed read alone never asserts withholding, at either `partial` setting', falseWithheld === 0 && withFlag === 0],
  ['and it therefore says nothing about revisions it cannot obtain', absentCount > 0],
  ['a §7.6 probe is the only path that reaches the verdict', withheldWithProbe === REFUSED],
  ['the two ordinary encoders disagree about an id-addressed derivation', ambiguousEncodersOnly > 0],
  ['every committed hash is URL-safe and fixed-length', allSafe],
  ['a hash-addressed body is self-verifying on arrival', selfVerifies],
  ['a feed-parsed item and a standalone body hash identically', agree],
];
const failed = claims.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [what] of failed) console.error(`FAILED: ${what}`);
  console.error('PROTOTYPE FAILED — a claim above did not hold');
  process.exit(1);
}
say('VERDICT — adopt HASH-ADDRESSED derived item URLs');
say(`  - Without them the withholding verdict is unreachable, not merely weak: ${falseWithheld} withheld`);
say(`    against ${absentCount} committed revisions a one-page reader cannot obtain, at either \`partial\``);
say(`    setting. The only alternative the core offers is a ${mb(scaledBytes)} complete pass per poll.`);
say(`  - With them it is ${withheldWithProbe} fetches of ~${probeBytes} B to convict a publisher that commits bytes`);
say('    and refuses to serve them — the one pull-path attack the manifest exists to detect.');
say('  - That is the honest case for §7.6, and it is a stronger one than the false-accusation');
say('    argument this file made before 932404c: the reader is not wrong today, it is blind.');
say('  - ID-addressed is the obvious encoding and is wrong for the reason §3.1 already gives:');
say(`    it needs a percent-encoding normalizer, ${ambiguousEncodersOnly} of ${IDS.length} sampled ids derive differently across the`);
say(`    two ordinary encoders alone, and ${escapes} escape the reserved path segment entirely.`);
say('  - Hash-addressed needs no encoding rule, is self-verifying on arrival, and is the value');
say('    the manifest already commits — so the spec adds a URL derivation and nothing else. No');
say('    new field, no new construction, no new hashing rule.');
say('  - It also buys something unasked for: a superseded revision stays fetchable, which §7.3');
say('    otherwise makes impossible even though the chain still names its bytes.');
say('  - Cost: one immutable file per revision on a static host, and a producer that must serve');
say('    the standalone body byte-identically to what it committed — which is the bytes it');
say('    already hashed, exactly as §5.4 retention "falls out" for chained documents.');
say();
say('ALL CLAIMS HOLD');
