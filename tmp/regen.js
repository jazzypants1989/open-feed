import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- RFC 8785-ish canonicalizer (sufficient for string/int-only docs; validated below) ----
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();
// One hashing rule everywhere in the protocol: base64url SHA-256 of a document's
// full published canonical bytes, including its signature fields (spec §5.1, §9).
const docHash = obj => b64u(sha256(Buffer.from(canon(obj), 'utf8')));

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

function header(kid){ return {alg:'EdDSA', b64:false, crit:['b64'], kid}; }
function sign(obj, priv, kid){
  const {_sig, _recovery_sig, ...rest} = obj;
  const payload = Buffer.from(canon(rest), 'utf8');
  const hb = b64u(Buffer.from(JSON.stringify(header(kid)),'utf8'));
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), payload]);
  const sig = crypto.sign(null, input, priv);
  return hb + '..' + b64u(sig);
}
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
const itemCanon = canon(item);
const itemHashHex = sha256(Buffer.from(itemCanon,'utf8')).toString('hex');
console.log('CANONICALIZER CHECK (must equal 7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168):');
console.log('  item sha256 =', itemHashHex, itemHashHex==='7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168' ? 'OK' : 'MISMATCH');
console.log();
embed('D.2 item canonical bytes', itemCanon, 'spec');
embed('D.2 item sha256 (hex)', itemHashHex, 'spec');

const headerB64 = b64u(Buffer.from(JSON.stringify(header(KID1)),'utf8'));

console.log('== D.1 keys (x, base64url) ==');
console.log('  test-key-1 :', k1.x);
console.log('  recovery-1 :', kR.x);
console.log('  test-key-2 :', k2.x);
console.log('  header b64 :', headerB64);
console.log();
embed('D.1 test-key-1 x', k1.x, 'spec');
embed('D.1 recovery-1 x', kR.x, 'spec');
embed('D.1 test-key-2 x', k2.x, 'spec');
embed('D.1 header b64', headerB64, 'spec');

// ---- D.2 item ----
item._sig = sign(item, k1.priv, KID1);
const itemFullBytes = canon(item);
const itemFullHash = docHash(item);   // what the manifest commits to (spec §9)
console.log('== D.2 item _sig ==');
console.log(' ', item._sig);
console.log('== D.2 item full published bytes hash (manifest commitment) ==');
console.log(' ', itemFullHash);
console.log();
embed('D.2 item _sig', item._sig, 'spec');
embed('D.2 item full bytes', itemFullBytes, 'spec');
embed('D.2 item full hash', itemFullHash, 'spec');

// ---- D.2b relation item (a reply) ----
// Exercises the _rel array (§8), and gives the seq:2 manifest a real second item to
// commit to rather than a phantom id.
const item2 = {
  _feed_url:'https://test.example/feed.json', _version:1,
  _rel:[{to:'https://gran.example/~gran/feed.json#urn:uuid:00112233-4455-6677-8899-aabbccddeeff', type:'reply'}],
  authors:[{url:'https://test.example/'}],
  content_text:'Thanks, Gran!',
  date_published:'2025-02-15T09:00:00Z',
  id:'urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8'
};
item2._sig = sign(item2, k1.priv, KID1);
const item2FullBytes = canon(item2);
const item2FullHash = docHash(item2);
console.log('== D.2b relation item (full published canonical bytes) ==');
console.log(' ', item2FullBytes);
console.log('  hash:', item2FullHash);
console.log();
embed('D.2b item full bytes', item2FullBytes, 'spec');
embed('D.2b item full hash', item2FullHash, 'spec');

// ---- D.3 manifest (genesis) ----
// items maps id -> [version, hash]: the version names the revision, the hash binds its
// exact bytes, so content equivocation forks the manifest chain (spec §9, §14.2).
const manifest = {
  url: ID, feed_url:'https://test.example/feed.json', seq:1, updated:1736899200,
  items:{'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6':[1, itemFullHash]}
};
manifest._sig = sign(manifest, k1.priv, KID1);
const manifestBytes1 = canon(manifest);
const manifestHash1 = docHash(manifest);
console.log('== D.3 manifest (full published canonical bytes) ==');
console.log(' ', manifestBytes1);
console.log();
embed('D.3 manifest bytes', manifestBytes1, 'spec');
embed('D.3 manifest hash', manifestHash1, 'spec');

// ---- D.3b manifest seq 2 (chained) ----
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
console.log('== D.3b manifest seq 1 hash (= seq 2 prev) ==');
console.log(' ', manifestHash1);
console.log('== D.3b manifest seq 2 (full published canonical bytes) ==');
console.log(' ', canon(manifest2));
console.log();
embed('D.3b manifest seq2 bytes', canon(manifest2), 'spec');

// ---- D.4 identity seq 1 ----
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
const id1Bytes = canon(id1);
const id1Hash = docHash(id1);
console.log('== D.4 identity seq 1 (full published canonical bytes) ==');
console.log(' ', id1Bytes);
console.log('  hash (= seq 2 prev):', id1Hash);
console.log();
embed('D.4 identity seq1 bytes', id1Bytes, 'spec');
embed('D.4 identity seq1 hash', id1Hash, 'spec');

// ---- D.5 identity seq 2 (rotation) ----
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
const id2Bytes = canon(id2);
console.log('== D.5 identity seq 2 (full published canonical bytes) ==');
console.log(' ', id2Bytes);
console.log('  retained seq 1 is served at: https://test.example/openfeed/1.json  (§5.4)');
console.log();
embed('D.5 identity seq2 bytes', id2Bytes, 'spec');

// ==== Conventions vectors (spec Appendix D.6-D.7) ====
const kReader = keyFromLabel('reader-key-1');
const READER = 'https://reader.example/';
const READER_KID = READER + '#reader-key-1';

// ---- D.6 pins document (observer) ----
const pins = {
  url: READER,
  pins: [
    { url:'https://test.example/openfeed.json', seq:1, hash:id1Hash,       observed:1739577600 },
    { url:'https://test.example/manifest.json', seq:1, hash:manifestHash1, observed:1739577600 }
  ],
  updated: 1739577600
};
pins._sig = sign(pins, kReader.priv, READER_KID);
console.log('== C.1 pins document (full published canonical bytes) ==');
console.log(' ', canon(pins));
console.log();
embed('D.6 pins bytes', canon(pins), 'spec');

// ---- D.7 follows document ----
const follows = {
  url: READER,
  follows: [ ID, 'https://gran.example/~gran/' ],
  updated: 1739577600
};
follows._sig = sign(follows, kReader.priv, READER_KID);
console.log('== C.2 follows document (full published canonical bytes) ==');
console.log(' ', canon(follows));
console.log();
embed('D.7 follows bytes', canon(follows), 'spec');

// ---- D.8 identity document with foreign accounts (Appendix B.2) ----
// Standalone third identity so D.4/D.5's hashes (and everything chained to them) never move.
// Exercises both entry forms: a bare string and an object with proof/handle.
const kPosse = keyFromLabel('posse-key-1');
const POSSE = 'https://posse.example/';
const POSSE_KID = POSSE + '#posse-key-1';
const id3 = {
  accounts: [
    'https://mastodon.social/@posse',
    { handle:'posse.example', id:'did:plc:ewvi7nxzyoun6zhxrhs64oiz', proof:'atproto-handle' }
  ],
  keys:[ {crv:'Ed25519', iat:1739577600, kid:'posse-key-1', kty:'OKP', x:kPosse.x} ],
  name:'POSSE Identity',
  seq:1, updated:1739577600, url:POSSE
};
id3._sig = sign(id3, kPosse.priv, POSSE_KID);
console.log('== D.8 identity with accounts (full published canonical bytes) ==');
console.log(' ', canon(id3));
console.log();
embed('D.8 accounts identity bytes', canon(id3), 'spec');

// ---- self-verify everything ----
function verify(obj, kid, xPub){
  const {_sig, _recovery_sig, ...rest} = obj;
  const [hb,,sb] = _sig.split('.');
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  const kidName = kid.slice(kid.lastIndexOf('#')+1);
  const x = xPub !== undefined ? xPub : (obj.keys ? obj.keys.find(k=>k.kid===kidName).x : k1.x);
  const pub = crypto.createPublicKey({key:{kty:'OKP',crv:'Ed25519',x}, format:'jwk'});
  return crypto.verify(null, input, pub, Buffer.from(sb,'base64url'));
}

const ITEM_ID  = 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6';
const ITEM2_ID = 'urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const checks = [
  ['D.2 item',        verify(item, KID1)],
  ['D.2b rel item',   verify(item2, KID1)],
  ['D.3 manifest',    verify(manifest, KID1)],
  // the manifest entry must name the item's exact published bytes, not merely its version
  ['D.3 item commit', manifest.items[ITEM_ID][0]===item._version
                        && manifest.items[ITEM_ID][1]===docHash(item)],
  ['D.3b manifest2',  verify(manifest2, KID1) && manifest2.prev===manifestHash1],
  ['D.3b commits',    manifest2.items[ITEM_ID][1]===docHash(item)
                        && manifest2.items[ITEM2_ID][1]===docHash(item2)],
  ['D.4 id seq1',     verify(id1, KID1)],
  ['D.5 id seq2',     verify(id2, KID1) && id2.prev===id1Hash],
  ['no history field', !('history' in id1) && !('history' in id2) && !('history' in manifest2)],
  ['D.6 pins',        verify(pins, READER_KID, kReader.x)
                        && pins.pins[0].hash===id1Hash && pins.pins[1].hash===manifestHash1],
  ['D.7 follows',     verify(follows, READER_KID, kReader.x)],
  // accounts carries no authority: verification must succeed with the field treated as opaque,
  // and both entry forms (string, object) must be present in the signed bytes.
  ['D.8 accounts id', verify(id3, POSSE_KID, kPosse.x)
                        && typeof id3.accounts[0]==='string' && typeof id3.accounts[1]==='object'],
];

console.log('SELF-VERIFY:');
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
