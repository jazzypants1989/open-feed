// Derived item URLs: can an individually-addressable item rescue §9.3's withholding verdict,
// and if so, addressed by what?
//
// The problem is live in shipped code. §9.3 scopes withholding to "an item it requested and did
// not get: the permalink, or the page the item's position implies, or a complete pass over the
// feed it chose to make". `src/reader.js` passes `partial: feed.nextUrl !== null` — but the
// absence of `next_url` is not knowledge that a complete pass was made, and §13.4 budgets
// nothing for walking pagination to its end. So today an ordinary publisher serving a 50-item
// window over 10,000 committed items has every older item reported as **withheld**: a false
// accusation of the one attack the manifest exists to detect. The state is nearly dead on the
// pull path, and `HANDOFF.md` §3 item 1 names this as the top open defect.
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

scene(1, 'The baseline — following pagination to the end, priced against §13.4');

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

// What the reader reports today, with the real reconcile logic.
const onePage = feedItems.slice(0, PAGE);
const todayPartialFlagUnset = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: false });
const todayPartialFlagSet = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: true });
const falseWithheld = todayPartialFlagUnset.states.filter((s) => s.state === 'withheld').length;
const withFlag = todayPartialFlagSet.states.filter((s) => s.state === 'withheld').length;

say(`  reconcile one ${PAGE}-item page against a ${liveCount}-item manifest:`);
say(`    partial:false (what a feed with no next_url yields today) → ${falseWithheld} withheld`);
say(`    partial:true                                              → ${withFlag} withheld`);
say(`  Every one of those ${falseWithheld} is a false accusation. `
  + `The flag is load-bearing and the reader sets it`);
say(`  from \`next_url\`, which a publisher on its last page does not carry.`);

verdict(
  `Following pagination is not a fix, it is a ${mb(scaledBytes)} poll. And the state it would rescue is\n`
  + 'one a consumer asserts about a handful of items it cares about, not about ten thousand it has\n'
  + 'never looked at — so the mechanism wanted here is "ask for one item", not "read everything".',
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
  // The one thing §5.4 asks of a derived path is that it stay under the reserved prefix. A
  // surviving '/' makes it a different subtree; a resolver that swallowed the base loses it.
  const traversal = [...distinct].some((p) => p.includes('/'));
  if (traversal) escapes++;
  say(`  ${id.padEnd(52)} ${distinct.size}${traversal ? '   ← leaves the path segment' : ''}`);
  for (const [name, got] of results) say(`      ${name.padEnd(18)} ${base}/${got}.json`);
}
say();
say(`  ${ambiguous} of ${IDS.length} ids derive a different URL depending on which encoder the implementation uses.`);
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
if (falseWithheld === 0 || ambiguous === 0 || !allSafe || !selfVerifies || !agree) {
  console.error('PROTOTYPE FAILED — a claim above did not hold');
  process.exit(1);
}
say('VERDICT — adopt HASH-ADDRESSED derived item URLs, OPTIONAL and additive');
say(`  - The withholding verdict is dead on the pull path without them: the only honest way to`);
say(`    assert it today is a ${mb(scaledBytes)} complete pass, and a consumer that skips it reports`);
say(`    ${falseWithheld} false accusations against an honest publisher on a single page.`);
say('  - ID-addressed is the obvious encoding and is wrong for the reason §3.1 already gives:');
say(`    it needs a percent-encoding normalizer, ${ambiguous} of ${IDS.length} sampled ids derive differently across`);
say(`    ordinary encoders, and ${escapes} escape the reserved path segment entirely.`);
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
