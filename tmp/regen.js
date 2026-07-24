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
console.log('== D.2 item _sig ==');
console.log(' ', item._sig);
console.log();
embed('D.2 item _sig', item._sig, 'spec');

// ---- D.3 manifest (genesis) ----
const manifest = {
  url: ID, feed_url:'https://test.example/feed.json', seq:1, updated:1736899200,
  items:{'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6':1}
};
manifest._sig = sign(manifest, k1.priv, KID1);
const manifestBytes1 = canon(manifest);
const manifestHash1 = b64u(sha256(Buffer.from(manifestBytes1,'utf8')));
console.log('== D.3 manifest (full published canonical bytes) ==');
console.log(' ', manifestBytes1);
console.log();
embed('D.3 manifest bytes', manifestBytes1, 'spec');
embed('D.3 manifest hash', manifestHash1, 'spec');

// ---- D.3b manifest seq 2 (chained) ----
// history now names an INDEX of retained prior versions (spec §5.4, §9.2), not a
// container of their full text.
const manifest2 = {
  url: ID, feed_url:'https://test.example/feed.json', seq:2,
  prev: manifestHash1,
  history:'https://test.example/manifest-history.json',
  updated:1739577600,
  items:{'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6':1,'urn:uuid:00112233-4455-6677-8899-aabbccddeeff':1}
};
manifest2._sig = sign(manifest2, k1.priv, KID1);
console.log('== D.3b manifest seq 1 hash (= seq 2 prev) ==');
console.log(' ', manifestHash1);
console.log('== D.3b manifest seq 2 (full published canonical bytes) ==');
console.log(' ', canon(manifest2));
console.log();
embed('D.3b manifest seq2 bytes', canon(manifest2), 'spec');

// ---- D.4 identity seq 1 ----
// v0.2.0: `feed` + `manifest` collapsed into the single `feeds` array (spec §3.2.1),
// each entry {url, manifest?, rel}.
const FEEDS = [{url:'https://test.example/feed.json', manifest:'https://test.example/manifest.json', rel:'primary'}];
const id1 = {
  feeds: FEEDS,
  history:'https://test.example/history.json',
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
const id1Hash = b64u(sha256(Buffer.from(id1Bytes,'utf8')));
console.log('== D.4 identity seq 1 (full published canonical bytes) ==');
console.log(' ', id1Bytes);
console.log('  hash (= seq 2 prev):', id1Hash);
console.log();
embed('D.4 identity seq1 bytes', id1Bytes, 'spec');
embed('D.4 identity seq1 hash', id1Hash, 'spec');

// ---- D.5 identity seq 2 (rotation) ----
const id2 = {
  feeds: FEEDS,
  history:'https://test.example/history.json',
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
console.log();
embed('D.5 identity seq2 bytes', id2Bytes, 'spec');

// ---- D.6 history index (§5.4) ----
// Unsigned: every entry it points at is signed, and every hash is checked against the
// chain the consumer is already walking. A lying index cannot forge a version.
const historyIndex = {
  url: 'https://test.example/openfeed.json',
  versions: [
    { seq:1, hash:id1Hash, url:'https://test.example/openfeed/1.json' }
  ]
};
const historyIndexBytes = canon(historyIndex);
console.log('== D.6 identity history index (canonical bytes) ==');
console.log(' ', historyIndexBytes);
console.log();
embed('D.6 history index bytes', historyIndexBytes, 'spec');

// ==== Conventions extension vectors (open-feed-conventions.md) ====
const kReader = keyFromLabel('reader-key-1');
const READER = 'https://reader.example/';
const READER_KID = READER + '#reader-key-1';

// ---- C.1 pins document (observer) ----
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
embed('C.1 pins bytes', canon(pins), 'conventions');

// ---- C.2 follows document ----
const follows = {
  url: READER,
  follows: [ ID, 'https://gran.example/~gran/' ],
  updated: 1739577600
};
follows._sig = sign(follows, kReader.priv, READER_KID);
console.log('== C.2 follows document (full published canonical bytes) ==');
console.log(' ', canon(follows));
console.log();
embed('C.2 follows bytes', canon(follows), 'conventions');

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

const checks = [
  ['D.2 item',        verify(item, KID1)],
  ['D.3 manifest',    verify(manifest, KID1)],
  ['D.3b manifest2',  verify(manifest2, KID1) && manifest2.prev===manifestHash1],
  ['D.4 id seq1',     verify(id1, KID1)],
  ['D.5 id seq2',     verify(id2, KID1) && id2.prev===id1Hash],
  ['D.6 index hash',  historyIndex.versions[0].hash===id1Hash],
  ['C.1 pins',        verify(pins, READER_KID, kReader.x)
                        && pins.pins[0].hash===id1Hash && pins.pins[1].hash===manifestHash1],
  ['C.2 follows',     verify(follows, READER_KID, kReader.x)],
];

console.log('SELF-VERIFY:');
let ok = true;
for (const [name, pass] of checks){
  console.log('  ' + name.padEnd(16) + ':', pass);
  if (!pass) ok = false;
}
console.log();

// ---- doc cross-check: every emitted vector MUST appear verbatim in the docs ----
// regen.js used to only self-verify signatures, leaving "does the doc actually contain
// these bytes?" as a manual step. It no longer is.
const here = path.dirname(fileURLToPath(import.meta.url));
const docs = {
  spec:        fs.readFileSync(path.join(here, '..', 'open-feed-spec.md'), 'utf8'),
  conventions: fs.readFileSync(path.join(here, '..', 'open-feed-conventions.md'), 'utf8'),
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
