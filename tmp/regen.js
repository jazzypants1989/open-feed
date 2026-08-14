// Regenerates Appendix B and checks the published spec against it.
//
// Canonicalization, hashing, signing, and verification all come from `src/`. There is no
// second implementation here: a private canonicalizer in this file would drift from the
// one verifiers use, and the external anchor below (B.2's known SHA-256, computed outside
// any code in this repo) is what actually guards the canonicalizer against itself.
//
// Verification goes through `verifyDocument` against each author's CURRENT identity
// document, which is what a conforming verifier resolves (§6.5 step 5). An earlier version
// checked raw Ed25519 signatures only, and so did not notice that a vector was signed by a
// key the current identity document had already revoked.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalize,
  documentHash,
  sha256,
  b64u,
  canonicalBytes,
  sign,
  verifyDocument,
  claimedAuthor,
  buildHeader,
} from '../src/index.js';

// ---- deterministic test keys ----
function keyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 '+label).digest(); // 32 bytes
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const spki = crypto.createPublicKey(priv).export({format:'der', type:'spki'});
  const raw = spki.subarray(spki.length-32);
  return {priv, x:b64u(raw)};
}
const k1 = keyFromLabel('test-key-1');
const kR = keyFromLabel('recovery-1');
const k2 = keyFromLabel('test-key-2');

const ID = 'https://test.example/';
const KID1 = ID + '#test-key-1';

// Collected (label -> exact string) pairs that MUST appear verbatim in the docs.
const embedded = [];
const embed = (label, str, file) => { embedded.push({label, str, file}); return str; };

// ---- validate canonicalizer against known item hash ----
const item = {
  _feed_url:'https://test.example/feed.json', _version:1,
  authors:[{url:'https://test.example/'}],
  content_text:'Hello, wörld! 👋',
  date_published:'2025-01-15T12:00:00Z',
  id:'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6'
};
const itemCanon = canonicalize(item);
const itemHashHex = sha256(canonicalBytes(item)).toString('hex');
console.log('CANONICALIZER CHECK (must equal 7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168):');
console.log('  item sha256 =', itemHashHex, itemHashHex==='7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168' ? 'OK' : 'MISMATCH');
console.log();
embed('B.2 item canonical bytes', itemCanon, 'spec');
embed('B.2 item sha256 (hex)', itemHashHex, 'spec');

const headerB64 = b64u(Buffer.from(JSON.stringify(buildHeader(KID1)),'utf8'));

console.log('== B.1 keys (x, base64url) ==');
console.log('  test-key-1 :', k1.x);
console.log('  recovery-1 :', kR.x);
console.log('  test-key-2 :', k2.x);
console.log('  header b64 :', headerB64);
console.log();
embed('B.1 test-key-1 x', k1.x, 'spec');
embed('B.1 recovery-1 x', kR.x, 'spec');
embed('B.1 test-key-2 x', k2.x, 'spec');
embed('B.1 header b64', headerB64, 'spec');

// ---- B.2 item ----
item._sig = sign(item, k1.priv, KID1);
const itemFullBytes = canonicalize(item);
const itemFullHash = documentHash(item);   // what the manifest commits to (spec §9)
console.log('== B.2 item _sig ==');
console.log(' ', item._sig);
console.log('== B.2 item full published bytes hash (manifest commitment) ==');
console.log(' ', itemFullHash);
console.log();
embed('B.2 item _sig', item._sig, 'spec');
embed('B.2 item full bytes', itemFullBytes, 'spec');
embed('B.2 item full hash', itemFullHash, 'spec');

// ---- B.2b relation item (a reply) ----
// Exercises the _rel array (§8), and gives the seq:2 manifest a real second item to
// commit to rather than a phantom id.
//
// date_published sits BEFORE test-key-1's revocation at 1739577600 (B.5). It has to:
// §6.5 step 5 resolves a kid against the current identity document, so a reply signed by
// test-key-1 after that instant is one a conforming verifier must reject (§4.4).
const item2 = {
  _feed_url:'https://test.example/feed.json', _version:1,
  _rel:[{to:'https://gran.example/~gran/feed.json#urn:uuid:00112233-4455-6677-8899-aabbccddeeff', type:'reply'}],
  authors:[{url:'https://test.example/'}],
  content_text:'Thanks, Gran!',
  date_published:'2025-02-10T09:00:00Z',
  id:'urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8'
};
item2._sig = sign(item2, k1.priv, KID1);
const item2FullBytes = canonicalize(item2);
const item2FullHash = documentHash(item2);
console.log('== B.2b relation item (full published canonical bytes) ==');
console.log(' ', item2FullBytes);
console.log('  hash:', item2FullHash);
console.log();
embed('B.2b item full bytes', item2FullBytes, 'spec');
embed('B.2b item full hash', item2FullHash, 'spec');

// ---- B.3 manifest (genesis) ----
// items maps id -> [version, hash]: the version names the revision, the hash binds its
// exact bytes, so content equivocation forks the manifest chain (spec §9, §14.2).
const manifest = {
  url: ID, feed_url:'https://test.example/feed.json', seq:1, updated:1736899200,
  items:{'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6':[1, itemFullHash]}
};
manifest._sig = sign(manifest, k1.priv, KID1);
const manifestBytes1 = canonicalize(manifest);
const manifestHash1 = documentHash(manifest);
console.log('== B.3 manifest (full published canonical bytes) ==');
console.log(' ', manifestBytes1);
console.log();
embed('B.3 manifest bytes', manifestBytes1, 'spec');
embed('B.3 manifest hash', manifestHash1, 'spec');

// ---- B.3b manifest seq 2 (chained) ----
// No `history` field: prior versions live at a derived URL (spec §5.4), so there is no
// index document to name.
const manifest2 = {
  url: ID, feed_url:'https://test.example/feed.json', seq:2,
  prev: manifestHash1,
  updated:1739577600,
  items:{
    'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6':[1, itemFullHash],
    'urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8':[1, item2FullHash]
  }
};
manifest2._sig = sign(manifest2, k1.priv, KID1);
console.log('== B.3b manifest seq 1 hash (= seq 2 prev) ==');
console.log(' ', manifestHash1);
console.log('== B.3b manifest seq 2 (full published canonical bytes) ==');
console.log(' ', canonicalize(manifest2));
console.log();
embed('B.3b manifest seq2 bytes', canonicalize(manifest2), 'spec');

// ---- B.4 identity seq 1 ----
// One `feeds` array (spec §3.2.1), each entry {url, manifest, rel}. No `history` field.
const FEEDS = [{url:'https://test.example/feed.json', manifest:'https://test.example/manifest.json', rel:'primary'}];
const id1 = {
  feeds: FEEDS,
  inbox:'https://test.example/inbox',
  keys:[
    {crv:'Ed25519', iat:1736899200, kid:'test-key-1', kty:'OKP', x:k1.x},
    {crv:'Ed25519', iat:1736899200, kid:'recovery-1', kty:'OKP', use:'recovery', x:kR.x}
  ],
  name:'Test Identity',
  seq:1, updated:1736899200, url:ID
};
id1._sig = sign(id1, k1.priv, KID1);
const id1Bytes = canonicalize(id1);
const id1Hash = documentHash(id1);
console.log('== B.4 identity seq 1 (full published canonical bytes) ==');
console.log(' ', id1Bytes);
console.log('  hash (= seq 2 prev):', id1Hash);
console.log();
embed('B.4 identity seq1 bytes', id1Bytes, 'spec');
embed('B.4 identity seq1 hash', id1Hash, 'spec');

// ---- B.5 identity seq 2 (rotation) ----
const id2 = {
  feeds: FEEDS,
  inbox:'https://test.example/inbox',
  keys:[
    {crv:'Ed25519', iat:1736899200, kid:'test-key-1', kty:'OKP', revoked_at:1739577600, x:k1.x},
    {crv:'Ed25519', iat:1739577600, kid:'test-key-2', kty:'OKP', x:k2.x},
    {crv:'Ed25519', iat:1736899200, kid:'recovery-1', kty:'OKP', use:'recovery', x:kR.x}
  ],
  name:'Test Identity',
  prev:id1Hash, seq:2, updated:1739577600, url:ID
};
id2._sig = sign(id2, k1.priv, KID1);
const id2Bytes = canonicalize(id2);
console.log('== B.5 identity seq 2 (full published canonical bytes) ==');
console.log(' ', id2Bytes);
console.log('  retained seq 1 is served at: https://test.example/openfeed/1.json  (§5.4)');
console.log();
embed('B.5 identity seq2 bytes', id2Bytes, 'spec');

// ==== Conventions vectors (spec Appendix B.6-B.8) ====
const kReader = keyFromLabel('reader-key-1');
const READER = 'https://reader.example/';
const READER_KID = READER + '#reader-key-1';

// ---- B.6 reader identity document ----
// Published so B.7 and B.8 are verifiable from the spec alone: without a document listing
// reader-key-1, their signatures name a key no third party can resolve (§4.2).
// A Level 1 consumer, so no `feeds` and no `inbox` — the follows document is all it
// publishes, referenced the way §3.2 says to.
const idReader = {
  follows:'https://reader.example/follows.json',
  keys:[ {crv:'Ed25519', iat:1736899200, kid:'reader-key-1', kty:'OKP', x:kReader.x} ],
  name:'Reader',
  seq:1, updated:1739577600, url:READER
};
idReader._sig = sign(idReader, kReader.priv, READER_KID);
console.log('== B.6 reader identity document (full published canonical bytes) ==');
console.log(' ', canonicalize(idReader));
console.log();
embed('B.6 reader identity bytes', canonicalize(idReader), 'spec');

// ---- B.7 item carrying pins (§16.1) ----
// A delivered-only reply (no _feed_url) from the reader to the owner of B.2's item, carrying
// pins of the recipient's identity document (B.4) and manifest (B.3). Recipient-scoped, so it
// is valid on either axis of §16.1's publication rule.
const pinItem = {
  _pins: [
    { url:'https://test.example/openfeed.json', seq:1, hash:id1Hash,       observed:1739577600 },
    { url:'https://test.example/manifest.json', seq:1, hash:manifestHash1, observed:1739577600 }
  ],
  _rel: [ { type:'reply', to:'https://test.example/feed.json#urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6' } ],
  _version: 1,
  authors: [ { url: READER } ],
  content_text: 'Lovely!',
  date_published: '2025-02-15T12:00:00Z',
  id: 'urn:uuid:7c9e6679-7425-40de-944b-e07fc1f90ae7'
};
pinItem._sig = sign(pinItem, kReader.priv, READER_KID);
console.log('== B.7 item carrying pins (full published canonical bytes) ==');
console.log(' ', canonicalize(pinItem));
console.log();
embed('B.7 item-carried pins bytes', canonicalize(pinItem), 'spec');

// ---- B.8 follows document ----
const follows = {
  url: READER,
  follows: [ ID, 'https://gran.example/~gran/' ],
  updated: 1739577600
};
follows._sig = sign(follows, kReader.priv, READER_KID);
console.log('== B.8 follows document (full published canonical bytes) ==');
console.log(' ', canonicalize(follows));
console.log();
embed('B.8 follows bytes', canonicalize(follows), 'spec');

// ---- B.9 identity document with extension fields (§3.2) ----
// Standalone third identity so B.4/B.5's hashes (and everything chained to them) never move.
// `_accounts` is a README convention the core does not define: the vector exercises the
// normative rule that unknown `_` fields are preserved inside the signed bytes and ignored
// by every core check, with both entry shapes (string and object) present.
const kPosse = keyFromLabel('posse-key-1');
const POSSE = 'https://posse.example/';
const POSSE_KID = POSSE + '#posse-key-1';
const id3 = {
  _accounts: [
    'https://mastodon.social/@posse',
    { handle:'posse.example', id:'did:plc:ewvi7nxzyoun6zhxrhs64oiz', proof:'atproto-handle' }
  ],
  keys:[ {crv:'Ed25519', iat:1739577600, kid:'posse-key-1', kty:'OKP', x:kPosse.x} ],
  name:'POSSE Identity',
  seq:1, updated:1739577600, url:POSSE
};
id3._sig = sign(id3, kPosse.priv, POSSE_KID);
console.log('== B.9 identity with extension fields (full published canonical bytes) ==');
console.log(' ', canonicalize(id3));
console.log();
embed('B.9 extension identity bytes', canonicalize(id3), 'spec');

// ---- B.10 delegated custody (§4.6) ----
// A fourth identity whose identity document is signed by the member's root key while its
// item and manifest are signed by the hub's delegated key — the split §4.6 defines.
// Standalone so nothing chained to B.4/B.5 moves. The rejection half (a delegated key
// signing an identity-document version) lives in test/negative.test.js, since Appendix B
// is positive-only.
const kRoot = keyFromLabel('member-root-1');
const kDel  = keyFromLabel('hub-key-1');
const MEMBER = 'https://member.example/';
const MEMBER_ROOT_KID = MEMBER + '#member-root-1';
const MEMBER_DEL_KID  = MEMBER + '#hub-key-1';

const idMember = {
  feeds:[{url:'https://member.example/feed.json', manifest:'https://member.example/manifest.json', rel:'primary'}],
  keys:[
    {crv:'Ed25519', iat:1736899200, kid:'member-root-1', kty:'OKP', x:kRoot.x},
    {crv:'Ed25519', iat:1736899200, kid:'hub-key-1', kty:'OKP', use:'delegated', x:kDel.x}
  ],
  name:'Delegated Member',
  seq:1, updated:1736899200, url:MEMBER
};
idMember._sig = sign(idMember, kRoot.priv, MEMBER_ROOT_KID);
console.log('== B.10 member identity document (full published canonical bytes) ==');
console.log(' ', canonicalize(idMember));
console.log();
embed('B.10 member identity bytes', canonicalize(idMember), 'spec');

const DEL_ITEM_ID = 'urn:uuid:2f1e8c4a-9b3d-4e5f-8a71-6c2d9e0b4f13';
const delItem = {
  _feed_url:'https://member.example/feed.json', _version:1,
  authors:[{url:MEMBER}],
  content_text:'Posted by the hub on my behalf.',
  date_published:'2025-02-20T10:00:00Z',
  id: DEL_ITEM_ID
};
delItem._sig = sign(delItem, kDel.priv, MEMBER_DEL_KID);
console.log('== B.10 delegated-signed item (full published canonical bytes) ==');
console.log(' ', canonicalize(delItem));
console.log();
embed('B.10 delegated item bytes', canonicalize(delItem), 'spec');

const delManifest = {
  url: MEMBER, feed_url:'https://member.example/feed.json', seq:1, updated:1740045600,
  items:{ [DEL_ITEM_ID]:[1, documentHash(delItem)] }
};
delManifest._sig = sign(delManifest, kDel.priv, MEMBER_DEL_KID);
console.log('== B.10 delegated-signed manifest (full published canonical bytes) ==');
console.log(' ', canonicalize(delManifest));
console.log();
embed('B.10 delegated manifest bytes', canonicalize(delManifest), 'spec');

// ---- self-verify everything, the way a verifier does ----
// Each vector resolves its key out of its author's CURRENT identity document — the tip of
// that identity's chain — so revocation, `iat`, and author binding are all in scope, not
// just the raw Ed25519 check.
const CURRENT = { [ID]: id2, [READER]: idReader, [POSSE]: id3, [MEMBER]: idMember };

function verifies(doc){
  const author = claimedAuthor(doc);
  const identityDocument = CURRENT[author];
  if (!identityDocument) { console.log('    no identity document published for ' + author); return false; }
  try {
    verifyDocument(doc, { identityDocument });
    return true;
  } catch (e) {
    console.log('    ' + e.message);
    return false;
  }
}

const ITEM_ID  = 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
const ITEM2_ID = 'urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const checks = [
  ['B.2 item',        verifies(item)],
  ['B.2b rel item',   verifies(item2)],
  ['B.3 manifest',    verifies(manifest)],
  // the manifest entry must name the item's exact published bytes, not merely its version
  ['B.3 item commit', manifest.items[ITEM_ID][0]===item._version
                        && manifest.items[ITEM_ID][1]===documentHash(item)],
  ['B.3b manifest2',  verifies(manifest2) && manifest2.prev===manifestHash1],
  ['B.3b commits',    manifest2.items[ITEM_ID][1]===documentHash(item)
                        && manifest2.items[ITEM2_ID][1]===documentHash(item2)],
  ['B.4 id seq1',     verifies(id1)],
  ['B.5 id seq2',     verifies(id2) && id2.prev===id1Hash],
  ['no history field', !('history' in id1) && !('history' in id2) && !('history' in manifest2)],
  ['B.6 reader id',   verifies(idReader)],
  ['B.7 item pins',   verifies(pinItem)
                        && pinItem._pins[0].hash===id1Hash && pinItem._pins[1].hash===manifestHash1
                        && !('_feed_url' in pinItem)],
  ['B.8 follows',     verifies(follows)],
  // an unknown `_` field carries no authority: verification must succeed with it treated as
  // opaque, and both entry forms (string, object) must be present in the signed bytes.
  ['B.9 extension id', verifies(id3)
                        && typeof id3._accounts[0]==='string' && typeof id3._accounts[1]==='object'],
  ['B.10 member id',  verifies(idMember)],
  // the delegated key resolves for an item and a manifest — the half of §4.6 a positive
  // vector can show; the identity-document rejection is in test/negative.test.js
  ['B.10 del item',   verifies(delItem)],
  ['B.10 del manifest', verifies(delManifest)
                        && delManifest.items[DEL_ITEM_ID][1]===documentHash(delItem)],
];

console.log('SELF-VERIFY (against each author\'s current identity document):');
let ok = true;
for (const [name, pass] of checks){
  console.log('  ' + name.padEnd(18) + ':', pass);
  if (!pass) ok = false;
}
console.log();

// ---- doc cross-check: every emitted vector MUST appear verbatim in the docs ----
// regen.js used to only self-verify signatures, leaving "does the doc actually contain
// these bytes?" as a manual step. It no longer is.
const here = path.dirname(fileURLToPath(import.meta.url));
const docs = {
  spec:        fs.readFileSync(path.join(here, '..', 'open-feed-spec.md'), 'utf8'),
};
console.log('DOC CROSS-CHECK (vector strings present verbatim in the published docs):');
for (const {label, str, file} of embedded){
  const present = docs[file].includes(str);
  console.log('  ' + label.padEnd(26) + ':', present ? 'ok' : 'MISSING from ' + file);
  if (!present) ok = false;
}
console.log();
console.log(ok ? 'ALL CHECKS PASS' : 'FAILURES PRESENT');
process.exit(ok ? 0 : 1);
