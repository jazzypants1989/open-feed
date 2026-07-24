import crypto from 'node:crypto';

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

const headerB64 = b64u(Buffer.from(JSON.stringify(header(KID1)),'utf8'));

console.log('== D.1 keys (x, base64url) ==');
console.log('  test-key-1 :', k1.x);
console.log('  recovery-1 :', kR.x);
console.log('  test-key-2 :', k2.x);
console.log('  header b64 :', headerB64);
console.log();

// ---- D.2 item ----
item._sig = sign(item, k1.priv, KID1);
const itemSig = item._sig;
console.log('== D.2 item _sig ==');
console.log(' ', itemSig);
console.log();

// ---- D.3 manifest ----
const manifest = {
  url: ID, feed_url:'https://test.example/feed.json', seq:1, updated:1736899200,
  items:{'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6':1}
};
manifest._sig = sign(manifest, k1.priv, KID1);
console.log('== D.3 manifest (full published canonical bytes) ==');
console.log(' ', canon(manifest));
console.log();

// ---- D.3b manifest seq 2 (chained) ----
const manifestBytes1 = canon(manifest);
const manifestHash1 = b64u(sha256(Buffer.from(manifestBytes1,'utf8')));
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

// ---- D.4 identity seq 1 ----
const id1 = {
  feed:'https://test.example/feed.json', history:'https://test.example/history.json',
  inbox:'https://test.example/inbox',
  keys:[
    {crv:'Ed25519', iat:1736899200, kid:'test-key-1', kty:'OKP', x:k1.x},
    {crv:'Ed25519', iat:1736899200, kid:'recovery-1', kty:'OKP', use:'recovery', x:kR.x}
  ],
  manifest:'https://test.example/manifest.json', name:'Test Identity',
  seq:1, updated:1736899200, url:ID
};
id1._sig = sign(id1, k1.priv, KID1);
const id1Bytes = canon(id1);
const id1Hash = b64u(sha256(Buffer.from(id1Bytes,'utf8')));
console.log('== D.4 identity seq 1 (full published canonical bytes) ==');
console.log(' ', id1Bytes);
console.log('  hash (= seq 2 prev):', id1Hash);
console.log();

// ---- D.5 identity seq 2 ----
const id2 = {
  feed:'https://test.example/feed.json', history:'https://test.example/history.json',
  inbox:'https://test.example/inbox',
  keys:[
    {crv:'Ed25519', iat:1736899200, kid:'test-key-1', kty:'OKP', revoked_at:1739577600, x:k1.x},
    {crv:'Ed25519', iat:1739577600, kid:'test-key-2', kty:'OKP', x:k2.x},
    {crv:'Ed25519', iat:1736899200, kid:'recovery-1', kty:'OKP', use:'recovery', x:kR.x}
  ],
  manifest:'https://test.example/manifest.json', name:'Test Identity',
  prev:id1Hash, seq:2, updated:1739577600, url:ID
};
id2._sig = sign(id2, k1.priv, KID1);
console.log('== D.5 identity seq 2 (full published canonical bytes) ==');
console.log(' ', canon(id2));
console.log();

// ==== Restricted-feeds extension vectors (open-feed-restricted-feeds.md) ====
// Reader identity + key (distinct from the feed owner, https://test.example/).
const kReader = keyFromLabel('reader-key-1');
const READER = 'https://reader.example/';
const READER_KID = READER + '#reader-key-1';
const RFEED = 'https://test.example/family/feed.json';       // owner's restricted feed
const RMANIFEST = 'https://test.example/family/manifest.json';

// ---- Encoded-JWT helpers (construction #2 — the ONLY sanctioned second construction) ----
// Standard JWS compact with ENCODED payload (RFC 7519), NOT the core's detached b64:false JWS.
function signJWT(headerObj, claims, priv){
  const h = b64u(Buffer.from(JSON.stringify(headerObj),'utf8'));
  const p = b64u(Buffer.from(JSON.stringify(claims),'utf8'));
  const sig = crypto.sign(null, Buffer.from(h+'.'+p,'ascii'), priv);
  return h+'.'+p+'.'+b64u(sig);
}
function verifyJWT(jwt, xPub){
  const [h,p,s] = jwt.split('.');
  const pub = crypto.createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:xPub}, format:'jwk'});
  return crypto.verify(null, Buffer.from(h+'.'+p,'ascii'), pub, Buffer.from(s,'base64url'));
}

// ---- R.1 Fetch assertion (encoded EdDSA JWT, modeled on DPoP) ----
const assertHeader = {alg:'EdDSA', typ:'openfeed-fetch+jwt', kid:READER_KID};
const assertClaims = {
  iss: READER, htm:'GET', htu: RFEED,
  iat:1739577600, exp:1739577900, jti:'urn:uuid:6b3a...c0ffee'
};
const assertion = signJWT(assertHeader, assertClaims, kReader.priv);
console.log('== R.1 fetch assertion (compact JWT) ==');
console.log('  reader-key-1 x :', kReader.x);
console.log('  header  :', JSON.stringify(assertHeader));
console.log('  claims  :', JSON.stringify(assertClaims), '(exp-iat =', assertClaims.exp-assertClaims.iat, 's)');
console.log('  Authorization: OpenFeed-Sig', assertion);
console.log();

// ---- R.2 Capability grant (detached JWS — construction #1, reused unchanged) ----
// Owner (https://test.example/, test-key-1) authorizes READER to fetch RFEED.
// `manifest` names the restricted feed's manifest explicitly (MUST on every grant,
// F2 fix): the reader learns the gated-manifest URL from the grant, and the host
// authorizes it without depending on the public identity document — which an
// existence-private feed (§9) omits.
const grant = {
  url: ID,             // grantor / author binding (§6.6): kid identity MUST equal this
  grant: READER,       // the authorized reader identity
  feed: RFEED,         // resource this grant covers
  manifest: RMANIFEST, // the feed's gated manifest this grant also authorizes (F2)
  iat: 1739577600,
  exp: 1742169600      // iat + 30 days
};
grant._sig = sign(grant, k1.priv, KID1);
const grantBytes = canon(grant);
console.log('== R.2 capability grant (full published canonical bytes) ==');
console.log(' ', grantBytes);
console.log('  OpenFeed-Grant:', b64u(Buffer.from(grantBytes,'utf8')));
console.log();

// ---- R.3 Gated restricted manifest (same §9 mechanics, own chain) ----
const rmanifest = {
  url: ID, feed_url: RFEED, seq:1, updated:1739577600,
  items:{'urn:uuid:aabbccdd-eeff-0011-2233-445566778899':1}
};
rmanifest._sig = sign(rmanifest, k1.priv, KID1);
const rmanifestBytes1 = canon(rmanifest);
const rmanifestHash1 = b64u(sha256(Buffer.from(rmanifestBytes1,'utf8')));
console.log('== R.3 restricted manifest seq 1 (full published canonical bytes) ==');
console.log(' ', rmanifestBytes1);
console.log('  (fetched with an assertion whose htu =', RMANIFEST + ')');
console.log();

// ---- R.3b Gated restricted manifest seq 2 (chained) ----
// Adds a second restricted item and chains to R.3 via prev — the restricted
// feed's manifest advances exactly like a public one (core §9.1).
const rmanifest2 = {
  url: ID, feed_url: RFEED, seq:2,
  prev: rmanifestHash1,
  history:'https://test.example/family/manifest-history.json',
  updated:1742169600,
  items:{'urn:uuid:aabbccdd-eeff-0011-2233-445566778899':1,'urn:uuid:bbccddee-ff00-1122-3344-556677889900':1}
};
rmanifest2._sig = sign(rmanifest2, k1.priv, KID1);
const rmanifestBytes2 = canon(rmanifest2);
const rmanifestHash2 = b64u(sha256(Buffer.from(rmanifestBytes2,'utf8')));
console.log('== R.3b restricted manifest seq 1 hash (= seq 2 prev) ==');
console.log(' ', rmanifestHash1);
console.log('== R.3b restricted manifest seq 2 (full published canonical bytes) ==');
console.log(' ', rmanifestBytes2);
console.log();

// ---- R.4 / R.4b Grant-revocation list (chained side-document, F3) ----
// Faster-than-`exp` revocation for existence-public restricted feeds. Same manifest
// discipline (core §9): its own seq/prev/history, pinned and walked, signed by the
// owner (construction #1 unchanged). Referenced from the identity document via a
// `grant_revocations` URL field — so adding a revocation advances THIS chain, not the
// identity chain (which stays short, core §5/§3.2). A revocation entry names
// (grant, feed, iat), uniquely identifying an issued grant (§6.2.2); the host rejects
// any presented grant matching an entry at verification step 7.
const GRANT_REVS_HISTORY = 'https://test.example/family/grant-revocations-history.json';
const grantRevs1 = {
  url: ID,
  revocations: [
    { grant:'https://gran.example/~gran/', feed:RFEED, iat:1739577600 }
  ],
  seq:1, updated:1739577600
};
grantRevs1._sig = sign(grantRevs1, k1.priv, KID1);
const grantRevs1Bytes = canon(grantRevs1);
const grantRevs1Hash = b64u(sha256(Buffer.from(grantRevs1Bytes,'utf8')));
const grantRevs2 = {
  url: ID,
  revocations: [
    { grant:'https://gran.example/~gran/',   feed:RFEED, iat:1739577600 },
    { grant:'https://old-friend.example/',   feed:RFEED, iat:1739577600 }
  ],
  seq:2, prev:grantRevs1Hash,
  history:GRANT_REVS_HISTORY,
  updated:1742169600
};
grantRevs2._sig = sign(grantRevs2, k1.priv, KID1);
console.log('== R.4 grant-revocation list seq 1 (full published canonical bytes) ==');
console.log(' ', grantRevs1Bytes);
console.log('  seq 1 hash (= seq 2 prev):', grantRevs1Hash);
console.log('== R.4b grant-revocation list seq 2 (full published canonical bytes) ==');
console.log(' ', canon(grantRevs2));
console.log();

// ==== Conventions extension vectors (open-feed-conventions.md) ====
// Pins + follows: signed when published (construction #1, reused unchanged).
const IDENTITY_DOC = ID + 'openfeed.json';        // https://test.example/openfeed.json
const PUB_MANIFEST = 'https://test.example/manifest.json';

// ---- C.1 Pins document (observer witnesses the OWNER's public chains) ----
// The reader (https://reader.example/) pins what it has observed of the owner's
// identity doc (D.4, seq 1) and public manifest (D.3, seq 1). `hash` = base64url
// SHA-256 of each pinned version's full published bytes (the same value its own
// `prev` successor hashes). Signed => a peer can trust these came from the reader.
const pins = {
  url: READER,
  pins: [
    { url: IDENTITY_DOC, seq:1, hash:id1Hash,       observed:1739577600 },
    { url: PUB_MANIFEST, seq:1, hash:manifestHash1, observed:1739577600 }
  ],
  updated: 1739577600
};
pins._sig = sign(pins, kReader.priv, READER_KID);
console.log('== C.1 pins document (observer, full published canonical bytes) ==');
console.log(' ', canon(pins));
console.log();

// ---- C.2 Self-commitment (F1: restricted-manifest transparency) ----
// The OWNER publicly pins its OWN restricted manifest (R.3). Because url==owner and
// the pinned chain is the owner's, this is a *commitment*, not a witness: a reader
// served R.3 checks sha256(R.3 bytes) == this hash; a key-custodian host that wants
// to equivocate must now fork THIS public, gossipable log. Leaks existence+cadence,
// never content (hash is preimage-resistant).
const rmanifestHash = b64u(sha256(Buffer.from(canon(rmanifest),'utf8')));
const commit = {
  url: ID,
  pins: [
    { url: RMANIFEST, seq:1, hash:rmanifestHash, observed:1739577600 }
  ],
  updated: 1739577600
};
commit._sig = sign(commit, k1.priv, KID1);
console.log('== C.2 self-commitment / F1 (owner pins own restricted manifest) ==');
console.log('  R.3 restricted-manifest hash :', rmanifestHash);
console.log(' ', canon(commit));
console.log();

// ---- C.2b Chained self-commitment LOG (§3.3, §5.2) ----
// The RECOMMENDED shape for commitments: a walkable chain (core §9 mechanics) so a
// host cannot serve a reader an older commitment set that omits a version. Genesis
// (seq 1) commits R.3; seq 2 chains via prev and commits both R.3 and R.3b. A reader
// pins this commitment chain and walks it exactly like a manifest (core §9.1).
const commitLog1 = {
  url: ID,
  pins: [ { url: RMANIFEST, seq:1, hash:rmanifestHash1, observed:1739577600 } ],
  seq:1, updated:1739577600
};
commitLog1._sig = sign(commitLog1, k1.priv, KID1);
const commitLog1Bytes = canon(commitLog1);
const commitLog1Hash = b64u(sha256(Buffer.from(commitLog1Bytes,'utf8')));
const commitLog2 = {
  url: ID,
  pins: [
    { url: RMANIFEST, seq:1, hash:rmanifestHash1, observed:1739577600 },
    { url: RMANIFEST, seq:2, hash:rmanifestHash2, observed:1742169600 }
  ],
  seq:2, prev:commitLog1Hash,
  history:'https://test.example/family/commitments-history.json',
  updated:1742169600
};
commitLog2._sig = sign(commitLog2, k1.priv, KID1);
console.log('== C.2b chained self-commitment log ==');
console.log('  seq 1 (full published canonical bytes):');
console.log('   ', commitLog1Bytes);
console.log('  seq 1 hash (= seq 2 prev):', commitLog1Hash);
console.log('  seq 2 (full published canonical bytes):');
console.log('   ', canon(commitLog2));
console.log();

// ---- C.3 Follows document ----
const follows = {
  url: READER,
  follows: [ ID, 'https://gran.example/~gran/' ],
  updated: 1739577600
};
follows._sig = sign(follows, kReader.priv, READER_KID);
console.log('== C.3 follows document (full published canonical bytes) ==');
console.log(' ', canon(follows));
console.log();

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
console.log('SELF-VERIFY:');
console.log('  item     :', verify(item, KID1));
console.log('  manifest :', verify(manifest, KID1));
console.log('  manifest2:', verify(manifest2, KID1), '(prev chains seq1->seq2:', manifest2.prev===manifestHash1, ')');
console.log('  id seq1  :', verify(id1, KID1));
console.log('  id seq2  :', verify(id2, KID1));
console.log('  R.1 assertion :', verifyJWT(assertion, kReader.x), '(bound htu=RFEED, exp-iat<=300:', assertClaims.exp-assertClaims.iat<=300, ')');
console.log('  R.2 grant     :', verify(grant, KID1), '(grantor url==kid identity:', grant.url===KID1.slice(0,KID1.lastIndexOf('#')), ')');
console.log('  R.3 rmanifest :', verify(rmanifest, KID1));
console.log('  R.3b rmanifest2:', verify(rmanifest2, KID1), '(prev chains seq1->seq2:', rmanifest2.prev===rmanifestHash1, ')');
console.log('  R.4 grantRevs :', verify(grantRevs1, KID1));
console.log('  R.4b grantRevs2:', verify(grantRevs2, KID1), '(prev chains seq1->seq2:', grantRevs2.prev===grantRevs1Hash, ')');
console.log('  C.1 pins      :', verify(pins, READER_KID, kReader.x),
  '(pinned hashes match D.4/D.3:', pins.pins[0].hash===id1Hash && pins.pins[1].hash===manifestHash1, ')');
console.log('  C.2 commit    :', verify(commit, KID1),
  '(reader-side check sha256(R.3)==commit hash:', commit.pins[0].hash===rmanifestHash, ')');
console.log('  C.2b log seq1 :', verify(commitLog1, KID1));
console.log('  C.2b log seq2 :', verify(commitLog2, KID1),
  '(prev chains seq1->seq2:', commitLog2.prev===commitLog1Hash,
  '; commits R.3b hash:', commitLog2.pins[1].hash===rmanifestHash2, ')');
console.log('  C.3 follows   :', verify(follows, READER_KID, kReader.x));
