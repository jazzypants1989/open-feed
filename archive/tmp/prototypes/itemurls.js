// Gate for tmp/prototypes/itemurls.md — §7.6 hash-addressed item URLs, run against the shipped code.
import {
  Publisher,
  reconcileFeed,
  derivedItemUrl,
  documentHash,
  canonicalBytes,
  assertCanonicalBytes,
  parseIJSON,
  sha256,
  b64u,
} from '../../src/index.js';
import crypto from 'node:crypto';

let clock = 1736899200;
const DAY = 86400;
const ID = 'https://mom.pence.family/';
const FEED = `${ID}feed.json`;

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: clock - DAY, kid, kty: 'OKP', x }, privateKey };
}

// A journal larger than one §7.4 page, with edits and tombstones, built by the shipped Publisher.
const mom = new Publisher({ identity: ID, title: "Mom's Journal", signer: makeSigner('key-1'), now: () => clock });
const idOf = (n) => `urn:uuid:${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const N = 90;
for (let n = 0; n < N; n++) {
  clock += DAY / 3;
  mom.publishItem({ id: idOf(n), title: `Day ${n}`, content_text: 'x'.repeat(280) });
}
for (let n = 0; n < N; n++) {
  clock += 60;
  if (n % 5 === 0) mom.publishItem({ id: idOf(n), content_text: 'y'.repeat(280) });
  if (n % 33 === 0) mom.tombstone(idOf(n));
}
mom.advanceManifest();
const manifest = mom.manifest;

// One §7.4 page — the 50 most recent items, which is all a feed-only reader holds.
const PAGE = 50;
const onePage = mom.feed.items.slice(0, PAGE);
const count = (r, s) => r.states.filter((x) => x.state === s).length;

// The count read out of shipped src/manifest.js: committed-but-not-yielded is `absent`, never `withheld`.
const blindOff = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: false });
const blindOn = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: true });
const absentCount = count(blindOff, 'absent');

// The same read with §7.6 probes, against a publisher refusing 3 committed revisions at their item URLs.
const served = new Set(onePage.map((i) => i.id));
const notYielded = Object.keys(manifest.items).filter((id) => !served.has(id));
const REFUSED = 3;
const unobtainable = new Set(notYielded.slice(0, REFUSED));
const probed = reconcileFeed(manifest, onePage, { now: clock, url: FEED, partial: true, unobtainable });

// §7.2-shaped ids in the wild, derived by the two encoders every implementer has to hand.
const IDS = [
  'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  'tag:example.com,2025-12-07:hospital',
  'tag:example.com,2025:posts/1',
  'urn:uuid:AB%2FCD-0000-4000-8000-000000000000',
  'https://mom.pence.family/2025/12/07/',
];
const diverge = IDS.filter((id) => encodeURIComponent(id) !== encodeURI(id)).length;
const escapes = IDS.filter((id) => [encodeURIComponent(id), encodeURI(id)].some((p) => p.includes('/'))).length;

// Hash-addressed: the value the manifest already commits, derived by the shipped §7.6 rule.
const allSafe = Object.values(manifest.items).every(([, h]) => /^[A-Za-z0-9_-]{43}$/.test(h));
const someId = Object.keys(manifest.items)[7];
const [, someHash] = manifest.items[someId];
const urlOk = derivedItemUrl(FEED, someHash) === `${ID}feed/items/${someHash}.json`;

// §6.3 under a standalone body: round-trip the served bytes, then check they ARE the URL's hash.
const body = canonicalBytes(mom.items.get(someId));
assertCanonicalBytes(parseIJSON(body.toString('utf8')), body, 'item');
const selfVerifies = b64u(sha256(body)) === someHash;

// Parser equivalence: the same item parsed out of the feed's byte stream hashes identically.
const feedParse = parseIJSON(canonicalBytes(mom.feed).toString('utf8')).items.find((i) => i.id === someId);
const agree = documentHash(feedParse) === b64u(sha256(body));

const gate = [
  ['a feed read alone never asserts withholding, at either `partial` setting',
    count(blindOff, 'withheld') === 0 && count(blindOn, 'withheld') === 0],
  ['and it therefore says nothing about revisions it cannot obtain', absentCount > 0],
  ['a refused §7.6 probe is the only path to the withholding verdict', count(probed, 'withheld') === REFUSED],
  [`the two ordinary encoders disagree on ${IDS.length} of ${IDS.length} id-addressed derivations`, diverge === IDS.length],
  ['at least one id escapes its path segment under an ordinary encoder', escapes >= 2],
  ['every committed hash is URL-safe and fixed-length', allSafe],
  ['the shipped §7.6 derivation stays under /items/ with no encoding step', urlOk],
  ['a standalone body round-trips §6.3 and self-verifies against its URL', selfVerifies],
  ['a feed-parsed item and a standalone body hash identically', agree],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('itemurls: all claims hold');
