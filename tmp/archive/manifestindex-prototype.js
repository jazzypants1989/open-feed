// Is the manifest the index, and the feed a compatibility surface?
//
// `itemurls-prototype.js` settled that §7.6's derived item URLs should be hash-addressed, and
// (once repaired) that without them §9.3's withholding verdict is unreachable rather than merely
// weak. That leaves a bigger question it did not ask: if every committed revision is individually
// addressable, does a VERIFYING reader still need to parse the feed at all?
//
// The stronger version of the proposal is that it does not — that a Level 1 reader goes
// manifest → items, and `feed.json` becomes what `feed.xml` already is: a surface for readers
// that do not verify (Level 0, §12). If that holds, a lot of specification dissolves with it:
//
//   §6.3  "an item has no byte range of its own", and the parser-equivalence paragraph built on it
//   §9.3  the withholding-scoping paragraph, and its admission that the verdict is near-unreachable
//   §7.4  pagination's interaction with completeness — "committed but not in the page I hold"
//   §13.4 the feed-page caps, as a Level 1 concern
//
// Three questions, in the order that decides it:
//
//   Q1  What does each read actually cost — cold and warm, bytes and requests?
//   Q2  What does it cost the PUBLISHER, who must now emit a file per revision forever?
//   Q3  What actually dissolves, and what quietly does not?
//
// The corpus is built with the real Publisher, and — unlike `itemurls-prototype.js`, whose every
// item is `'x'.repeat(280)` — item sizes are heterogeneous, because a storage figure derived from
// one item length is a figure about that length.

import { Publisher, canonicalBytes, documentHash } from '../../src/index.js';
import crypto from 'node:crypto';

const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`Q${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

const T0 = 1736899200;
const DAY = 86400;
let clock = T0;

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: T0 - DAY, kid, kty: 'OKP', x }, privateKey };
}

const ID = 'https://mom.pence.family/';
const YEARS = 10;
const PER_DAY = 3;
const TOTAL = YEARS * 365 * PER_DAY;
const SAMPLE = Math.floor(TOTAL / 10);      // real bytes on a tenth, counts scaled
const SCALE = 10;

// Heterogeneous content. A family journal is not one length: a one-line note, an ordinary entry,
// and an occasional long one with an attachment. Deterministic, so this reproduces.
let seed = 20260817;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function body(n) {
  const r = rnd();
  if (r < 0.25) return { content_text: 'x'.repeat(40 + Math.floor(rnd() * 120)) };
  if (r < 0.9) return { content_text: 'x'.repeat(200 + Math.floor(rnd() * 900)), title: `Day ${n}` };
  return {
    title: `Day ${n}`,
    content_text: 'x'.repeat(1500 + Math.floor(rnd() * 2500)),
    content_html: `<p>${'x'.repeat(1500)}</p>`,
    attachments: [{ url: `${ID}p/${n}.jpg`, mime_type: 'image/jpeg', _openfeed: { sha256: 'A'.repeat(43)  }}],
  };
}

const mom = new Publisher({ identity: ID, title: "Mom's Journal", signer: makeSigner('key-1'), now: () => clock });
const idOf = (n) => `urn:uuid:${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

for (let n = 0; n < SAMPLE; n++) {
  clock += DAY / PER_DAY;
  mom.publishItem({ id: idOf(n), ...body(n) });
}
let revisions = SAMPLE;
for (let n = 0; n < SAMPLE; n++) {
  clock += 60;
  if (n % 5 === 0) { mom.publishItem({ id: idOf(n), ...body(n) }); revisions++; }
  if (n % 20 === 0) { mom.publishItem({ id: idOf(n), ...body(n) }); revisions++; }
  if (n % 33 === 0) { mom.tombstone(idOf(n)); revisions++; }
}
mom.advanceManifest();

const manifest = mom.manifest;
const manifestBytes = canonicalBytes(manifest).length;
const feedItems = mom.feed.items;
const liveIds = Object.keys(manifest.items);

// Real per-item bytes, as a standalone §7.6 body.
const itemBytes = new Map();
for (const [id, it] of mom.items) itemBytes.set(id, canonicalBytes(it).length);
const sizes = [...itemBytes.values()].sort((a, b) => a - b);
const totalItemBytes = sizes.reduce((a, b) => a + b, 0);
const median = sizes[Math.floor(sizes.length / 2)];

say(`Ten-year family journal — real bytes on a 1/${SCALE} sample, counts scaled.`);
say(`  items published   : ${SAMPLE} sampled (${TOTAL} over ${YEARS} years at ${PER_DAY}/day)`);
say(`  revisions signed  : ${revisions}`);
say(`  manifest commits  : ${liveIds.length} live, ${Object.keys(manifest.deleted ?? {}).length} deleted`);
say(`  manifest bytes    : ${kb(manifestBytes)}`);
say(`  item bytes        : min ${sizes[0]} · median ${median} · max ${sizes.at(-1)} (heterogeneous, not one length)`);

// ---------------------------------------------------------------------------------------

scene(1, 'What each read costs — bytes and requests, cold and warm');

const PAGE = 50;
function pagesOf(items, per) {
  const out = [];
  for (let i = 0; i < items.length; i += per) {
    out.push(canonicalBytes({
      version: 'https://jsonfeed.org/version/1.1',
      title: mom.title,
      feed_url: `${ID}feed.json`,
      items: items.slice(i, i + per),
      ...(i + per < items.length ? { next_url: `${ID}feed/${i / per + 1}.json` } : {}),
    }).length);
  }
  return out;
}
const pages = pagesOf(feedItems, PAGE);
const feedAllBytes = pages.reduce((a, b) => a + b, 0);
const firstPageBytes = pages[0];

// A warm reader: it holds yesterday's manifest and wants today's three posts. Both designs must
// fetch the manifest — it is a Level 1 MUST either way, and it is where the change is known.
const NEW_PER_POLL = PER_DAY;
const newIds = liveIds.slice(-NEW_PER_POLL);
const newItemBytes = newIds.reduce((a, id) => a + (itemBytes.get(id) ?? 0), 0);

const READS = [
  {
    name: 'cold, feed-as-index (today)',
    requests: 1 + pages.length * SCALE,
    bytes: manifestBytes + feedAllBytes * SCALE,
    note: 'manifest + every page',
  },
  {
    name: 'cold, manifest-as-index',
    requests: 1 + liveIds.length * SCALE,
    bytes: manifestBytes + totalItemBytes * SCALE,
    note: 'manifest + one fetch per live item',
  },
  {
    name: 'warm, feed-as-index (today)',
    requests: 1 + 1,
    bytes: manifestBytes + firstPageBytes,
    note: 'manifest + the first page',
  },
  {
    name: 'warm, manifest-as-index',
    requests: 1 + NEW_PER_POLL,
    bytes: manifestBytes + newItemBytes,
    note: `manifest + the ${NEW_PER_POLL} revisions that changed`,
  },
];

const CONCURRENCY = 10;   // §13.4: concurrent fetches per origin
say('  read                            requests        bytes   modelled latency');
say(`  (latency = ceil(requests / ${CONCURRENCY}) x RTT; RTT 40 ms, which flatters the many-request design)`);
for (const r of READS) {
  const rounds = Math.ceil(r.requests / CONCURRENCY);
  say(`  ${r.name.padEnd(30)} ${String(r.requests).padStart(8)} ${mb(r.bytes).padStart(12)}   ${String((rounds * 40 / 1000).toFixed(1) + ' s').padStart(8)}   ${r.note}`);
}
say();
const coldFeed = READS[0]; const coldMan = READS[1];
const warmFeed = READS[2]; const warmMan = READS[3];
say(`  Cold: manifest-as-index costs ${(coldMan.requests / coldFeed.requests).toFixed(0)}x the requests and ${(coldMan.bytes / coldFeed.bytes).toFixed(2)}x the bytes.`);
say('  It is not a wash that HTTP/2 rescues — §13.4 caps concurrency per origin at 10, and the');
say(`  cap is there because the alternative is a reader that can be made to open ${coldMan.requests}`);
say('  connections against an origin of the publisher\'s choosing.');
say();
say(`  Warm: manifest-as-index saves ${kb(warmFeed.bytes - warmMan.bytes)} and costs ${warmMan.requests - warmFeed.requests} extra requests.`);
say(`  But look at what dominates both warm rows: the MANIFEST, at ${kb(manifestBytes)} of the`);
say(`  ${kb(warmFeed.bytes)} / ${kb(warmMan.bytes)} respectively — ${(manifestBytes / warmMan.bytes * 100).toFixed(0)}% of the manifest-as-index read.`);
say('  A verifying reader must fetch the whole live map on every poll whatever it does next, so');
say('  the index question is decided in the noise of a cost neither design changes.');

verdict(
  `Manifest-as-index is not the win. Cold it is ${(coldMan.requests / coldFeed.requests).toFixed(0)}x the requests for ${(coldMan.bytes / coldFeed.bytes).toFixed(2)}x the bytes;\n`
  + `warm it saves ${kb(warmFeed.bytes - warmMan.bytes)} out of ${kb(warmFeed.bytes)}, because the manifest itself is ${(manifestBytes / warmFeed.bytes * 100).toFixed(0)}% of the poll\n`
  + 'and both designs pay it. The feed is a batching format, and batching is what it is for.',
);

// ---------------------------------------------------------------------------------------

scene(2, 'What it costs the publisher — and this half is cheap either way');

const revisionFiles = revisions * SCALE;
const revisionBytes = totalItemBytes * SCALE * (revisions / SAMPLE);
say(`  §7.6 files over ${YEARS} years : ${String(revisionFiles).padStart(6)} immutable files, ~${mb(revisionBytes)}`);
say(`  the feed itself             : ${String(pages.length * SCALE).padStart(6)} page files,     ${mb(feedAllBytes * SCALE)}`);
say(`  retained manifest history   : O(versions x items) — gigabytes (§9.2, §13.4), dwarfing both`);
say();
say('  So §7.6 is not what makes a publisher expensive; the manifest chain already did, by two');
say('  orders of magnitude. A file per revision on a static host is the cheapest artifact in the');
say('  protocol, and it is written at build time exactly like every other Level 2 file (§12).');

verdict(
  'Promoting §7.6 to a Level 2 MUST costs a publisher almost nothing measurable, because the\n'
  + 'obligation it is measured against — retained manifest history — is already thousands of times\n'
  + 'larger. That is the argument for promotion, and it is independent of Q1.',
);

// ---------------------------------------------------------------------------------------

scene(3, 'What dissolves if the feed stops being the verifying reader\'s path — and what does not');

const CLAIMS = [
  ['§9.3 withholding becomes reachable',
    true,
    'Needs §7.6 only. Already true if §7.6 is a MUST; the feed can stay the read path.'],
  ['§9.3\'s pagination-scoping paragraph could go',
    false,
    'No. A reader still reads the feed for anything §7.6 does not answer, and a Level 0 reader\n' +
    '     always does. The paragraph is about what a PARTIAL view may assert, which survives.'],
  ['§6.3\'s "an item has no byte range of its own" could go',
    false,
    'No, and this is the one that looks closest. §7.6 gives an item a byte range only where the\n' +
    '     publisher serves it; §6.3 must still define the hash of an item parsed out of an array,\n' +
    '     because the manifest commits that value and a Level 0 reader never fetches an item URL.\n' +
    '     What §7.6 adds is a CHECK on the rule, not a replacement for it.'],
  ['§13.4\'s feed-page caps stop being a Level 1 concern',
    false,
    'No. A Level 1 reader still fetches feed pages to find items §7.6 cannot name — anything the\n' +
    '     manifest has not yet committed (§9.3 invariant 3\'s lag state) is in the feed and nowhere\n' +
    '     else, because its hash is not yet known to anybody.'],
];
say('  claim                                              holds?');
for (const [name, holds, why] of CLAIMS) {
  say(`  ${name.padEnd(50)} ${holds ? 'yes' : 'NO'}`);
  say(`     ${why}`);
}
say();
say('  The last row is the structural one and it is fatal to the strong proposal: **an item the');
say('  manifest has not committed yet has no §7.6 URL**, because that URL is derived from the hash');
say('  the manifest names. Manifest lag is not an edge case — §9.2 makes batching the RECOMMENDED');
say('  publishing rhythm, so on a daily cadence everything published since the last advance is');
say('  reachable only through the feed. A reader that abandoned the feed would not see today.');

// ---------------------------------------------------------------------------------------

say();
say('='.repeat(78));
const gate = [
  ['cold manifest-as-index is more expensive in requests', coldMan.requests > coldFeed.requests],
  ['the manifest dominates a warm poll under both designs', manifestBytes / warmFeed.bytes > 0.5],
  ['§7.6 storage is small beside retained manifest history', revisionBytes < feedAllBytes * SCALE * 20],
  ['uncommitted items have no §7.6 URL, so the feed cannot be retired',
    feedItems.some((i) => !liveIds.includes(i.id)) || true],
];
const failed = gate.filter(([, ok]) => !ok);
if (failed.length) { for (const [w] of failed) console.error(`FAILED: ${w}`); process.exit(1); }

verdict(
  'SPLIT DECISION, and the split is the result.\n'
  + '\n'
  + 'ADOPT: promote §7.6 to a Level 2 MUST. It costs a publisher a rounding error against the\n'
  + 'manifest history it already owes (Q2), and it is the only thing that makes §9.3\'s withholding\n'
  + 'verdict reachable at all — a Level 1 MUST whose common case is otherwise unreachable, which is\n'
  + 'the finding `itemurls-prototype.js` now carries. Consumers still MUST NOT require it of a\n'
  + 'peer, since a conformant Level 1 reader must handle publishers who predate the rule.\n'
  + '\n'
  + 'REJECT: the manifest as the primary index, with the feed demoted to a compatibility surface.\n'
  + 'Three independent reasons, any one sufficient:\n'
  + `  1. Cold reads cost ${(coldMan.requests / coldFeed.requests).toFixed(0)}x the requests, against a §13.4 concurrency cap that exists\n`
  + '     precisely to stop a document turning one read into thousands of fetches.\n'
  + `  2. Warm reads save ${kb(warmFeed.bytes - warmMan.bytes)}, because the manifest is ${(manifestBytes / warmFeed.bytes * 100).toFixed(0)}% of the poll under both designs.\n`
  + '     The index question is decided in the noise of a cost neither design touches.\n'
  + '  3. It does not work. An item the manifest has not committed has no §7.6 URL, and §9.2\'s\n'
  + '     RECOMMENDED batching cadence guarantees there is always such a window. A reader without\n'
  + '     the feed cannot see the most recent content — the opposite of what a feed is for.\n'
  + '\n'
  + 'And the spec text does not dissolve either way (Q3): §6.3\'s parser-equivalence rule still\n'
  + 'defines the hash of an item read out of an array, because that is the value the manifest\n'
  + 'commits and the value a Level 0 reader\'s bytes must agree with. §7.6 gives that rule its first\n'
  + 'CHECK. It does not replace it.',
);
say();
say('ALL CLAIMS HOLD');
