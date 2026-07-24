// circles-prototype.js — Option E, part 2: encrypted INTERACTION (the hard part)
//
// Broadcast (enc-prototype.js) proved a single author can encrypt to a known audience.
// This probes what broadcast could NOT: a *reader* replying to an encrypted item must
// wrap the reply to the SAME audience, but (with untagged recipients) doesn't know it.
//
// The proposed answer: the owner is the roster authority for its own audience and
// publishes an ENCRYPTED, CHAINED "circle roster" — the member list, wrapped to each
// member's published X25519 key, versioned with seq/prev so rollback is detectable by
// the same pin-and-walk discipline as the identity/manifest chains.
//
// Claims tested (happy path AND the awkward cases):
//   1. The roster is itself just an encrypted signed doc — members decrypt it, others can't.
//   2. A reader uses the decrypted roster to encrypt a reply the WHOLE audience can read.
//   3. Churn is coherent: a member added at vN can't read vN-1 content (no history);
//      a member removed at vN keeps vN-1 content already fetched (no retroactive revoke)
//      but can't read vN content.
//   4. Roster rollback is DETECTABLE because the roster is a chain (seq/prev walk).

import crypto from 'node:crypto';

// ---------- helpers (identical to enc-prototype.js) ----------
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();

function edKeyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const spki = crypto.createPublicKey(priv).export({format:'der', type:'spki'});
  return {priv, x:b64u(spki.subarray(spki.length-32))};
}
function xKeyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-enc '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const spki = crypto.createPublicKey(priv).export({format:'der', type:'spki'});
  return {priv, x:b64u(spki.subarray(spki.length-32))};
}
const xPubFromJwkX = x => crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b656e032100','hex'), Buffer.from(x,'base64url')]), format:'der', type:'spki'});

function header(kid){ return {alg:'EdDSA', b64:false, crit:['b64'], kid}; }
function sign(obj, priv, kid){
  const {_sig, _recovery_sig, ...rest} = obj;
  const hb = b64u(Buffer.from(JSON.stringify(header(kid)),'utf8'));
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  return hb + '..' + b64u(crypto.sign(null, input, priv));
}
function verify(obj, xPub){
  const {_sig:_a, _recovery_sig:_b, ...rest} = obj;
  const [hb,,sb] = obj._sig.split('.');
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  const pub = crypto.createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:xPub}, format:'jwk'});
  return crypto.verify(null, input, pub, Buffer.from(sb,'base64url'));
}

const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n>>>0); return b; };
function concatKDF(Z, bits, algId){
  const lp = b => Buffer.concat([be32(b.length), b]);
  const oi = Buffer.concat([lp(Buffer.from(algId,'ascii')), lp(Buffer.alloc(0)), lp(Buffer.alloc(0)), be32(bits)]);
  return sha256(Buffer.concat([be32(1), Z, oi])).subarray(0, bits/8);
}
const WRAP_IV = Buffer.from('A6A6A6A6A6A6A6A6','hex');
const aesWrap   = (kek,cek) => { const c = crypto.createCipheriv('id-aes256-wrap',kek,WRAP_IV); return Buffer.concat([c.update(cek),c.final()]); };
const aesUnwrap = (kek,w)   => { const d = crypto.createDecipheriv('id-aes256-wrap',kek,WRAP_IV); return Buffer.concat([d.update(w),d.final()]); };

// deterministic per-encryption material keyed by a label (real: CSPRNG)
function encryptJWE(plaintext, recipientXpubs, label){
  const cek = sha256(Buffer.from('cek '+label)).subarray(0,32);
  const iv  = sha256(Buffer.from('iv '+label)).subarray(0,12);
  const protB64 = b64u(Buffer.from(JSON.stringify({enc:'A256GCM'}),'utf8'));
  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv, {authTagLength:16});
  cipher.setAAD(Buffer.from(protB64,'ascii'));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext,'utf8')), cipher.final()]);
  const recipients = recipientXpubs.map((rx,i) => {
    const eph = xKeyFromLabel('eph '+label+' '+i);
    const Z = crypto.diffieHellman({privateKey:eph.priv, publicKey:xPubFromJwkX(rx)});
    return { header:{alg:'ECDH-ES+A256KW', epk:{kty:'OKP',crv:'X25519',x:eph.x}}, encrypted_key:b64u(aesWrap(concatKDF(Z,256,'A256KW'), cek)) };
  });
  return { protected:protB64, recipients, iv:b64u(iv), ciphertext:b64u(ct), tag:b64u(cipher.getAuthTag()) };
}
function decryptJWE(jwe, myXpriv){
  for (const r of jwe.recipients){
    try {
      const Z = crypto.diffieHellman({privateKey:myXpriv, publicKey:xPubFromJwkX(r.header.epk.x)});
      const cek = aesUnwrap(concatKDF(Z,256,'A256KW'), Buffer.from(r.encrypted_key,'base64url'));
      const dec = crypto.createDecipheriv('aes-256-gcm', cek, Buffer.from(jwe.iv,'base64url'), {authTagLength:16});
      dec.setAAD(Buffer.from(jwe.protected,'ascii'));
      dec.setAuthTag(Buffer.from(jwe.tag,'base64url'));
      return Buffer.concat([dec.update(Buffer.from(jwe.ciphertext,'base64url')), dec.final()]).toString('utf8');
    } catch { /* not my slot */ }
  }
  return null;
}

// =====================================================================
// Cast: Mom owns the circle. Members have published X25519 enc keys.
// =====================================================================
const mom = edKeyFromLabel('test-key-1'); const MOMKID = 'https://test.example/#test-key-1';
const enc = { mom: xKeyFromLabel('mom'), dad: xKeyFromLabel('dad'), kid: xKeyFromLabel('kid'),
              gran: xKeyFromLabel('gran'), stranger: xKeyFromLabel('stranger') };
const CIRCLE_URL = 'https://test.example/circle-family.json';

// A roster VERSION: a chained signed doc whose _enc wraps the member list to each member.
function makeRoster(members, seq, prevHash){
  const list = members.map(m => ({ identity:'https://test.example/~'+m+'/', x: enc[m].x }));
  const doc = {
    url:'https://test.example/', circle:CIRCLE_URL, seq, updated:1739577600+seq,
    _enc: encryptJWE(JSON.stringify(list), members.map(m=>enc[m].x), 'roster'+seq),
    ...(prevHash ? {prev:prevHash} : {}),
  };
  doc._sig = sign(doc, mom.priv, MOMKID);
  return doc;
}
const hashOf = doc => b64u(sha256(Buffer.from(canon(doc)+doc._sig,'utf8'))); // full published bytes

// Membership timeline (each version chained to the previous)
const v1 = makeRoster(['mom','dad','kid'], 1, null);
const v2 = makeRoster(['mom','dad','kid','gran'], 2, hashOf(v1));   // + grandma
const v3 = makeRoster(['mom','kid','gran'], 3, hashOf(v2));         // - dad
const history = [v1, v2, v3];

// A reader opens a roster version it's a member of, and learns the audience.
function readRoster(rosterDoc, myXpriv){
  const pt = decryptJWE(rosterDoc._enc, myXpriv);
  return pt ? JSON.parse(pt) : null;
}

console.log('=== Circles prototype — encrypted interaction ===\n');

// ---- CLAIM 1: roster is an encrypted signed doc; members decrypt, others cannot ----
const momSeesV1 = readRoster(v1, enc.mom.priv);
const stgSeesV1 = readRoster(v1, enc.stranger.priv);
const rosterSig = verify(v1, mom.x);
console.log('CLAIM 1 — encrypted roster:');
console.log('  roster v1 signature valid            :', rosterSig ? 'PASS':'FAIL');
console.log('  member (mom) reads member list       :', momSeesV1 ? 'PASS ('+momSeesV1.map(m=>m.identity.split('~')[1].replace('/','')).join(',')+')' : 'FAIL');
console.log('  non-member (stranger) locked out     :', stgSeesV1===null ? 'PASS':'FAIL (LEAK!)');
console.log('  (no chicken-and-egg: same trial-decrypt as a post; owner wraps to published keys)');

// ---- CLAIM 2: a READER replies, wrapping to the audience it learned from the roster ----
// Mom posts an encrypted item to circle v1; Kid (a reader) replies to the whole audience.
const post = { _feed_url:'https://test.example/feed.json', _version:1, authors:[{url:'https://test.example/'}],
  content_text:'', id:'urn:uuid:post-0001', date_published:'2025-01-15T12:00:00Z', _circle:CIRCLE_URL,
  _enc: encryptJWE(JSON.stringify({content_text:'First steps today 🥹'}), ['mom','dad','kid'].map(m=>enc[m].x), 'post1') };
post._sig = sign(post, mom.priv, MOMKID);

// Kid fetches the roster referenced by the post, decrypts it, and wraps a reply to those members.
const audience = readRoster(v1, enc.kid.priv);                 // Kid learns [mom,dad,kid]
const kidEd = edKeyFromLabel('kid-signing');                   // Kid signs with her own key (own identity in real life)
const reply = { _feed_url:'https://test.example/~kid/feed.json', _version:1, authors:[{url:'https://test.example/~kid/'}],
  content_text:'', id:'urn:uuid:reply-0001', date_published:'2025-01-15T13:00:00Z', _circle:CIRCLE_URL,
  _rel:[{type:'reply', to:'https://test.example/feed.json#urn:uuid:post-0001'}],
  _enc: encryptJWE(JSON.stringify({content_text:'So proud of her!'}), audience.map(m=>m.x), 'reply1') };
reply._sig = sign(reply, kidEd.priv, 'https://test.example/~kid/#kid-signing');

const momReadsReply = decryptJWE(reply._enc, enc.mom.priv);
const dadReadsReply = decryptJWE(reply._enc, enc.dad.priv);
const kidReadsReply = decryptJWE(reply._enc, enc.kid.priv);
console.log('\nCLAIM 2 — reader replies to the full audience (the thing broadcast could NOT do):');
console.log('  Kid learned audience from roster     :', audience ? 'PASS ('+audience.length+' members)':'FAIL');
console.log('  owner (mom) reads the reply          :', momReadsReply ? 'PASS':'FAIL');
console.log('  other member (dad) reads the reply   :', dadReadsReply ? 'PASS':'FAIL');
console.log('  author (kid) reads own reply         :', kidReadsReply ? 'PASS':'FAIL');

// ---- CLAIM 3: churn semantics ----
// grandma joined at v2 → cannot read the v1-wrapped reply (no history access).
const granReadsV1reply = decryptJWE(reply._enc, enc.gran.priv);
// dad removed at v3 → a NEW post wrapped to v3 audience is unreadable by dad,
// but the OLD v1 reply he already fetched stays readable (no retroactive revoke).
const v3aud = readRoster(v3, enc.mom.priv);
const postV3 = encryptJWE(JSON.stringify({content_text:'later, dad-free circle'}), v3aud.map(m=>m.x), 'postv3');
const dadReadsNewPost = decryptJWE(postV3, enc.dad.priv);
const dadStillReadsOldReply = decryptJWE(reply._enc, enc.dad.priv);
console.log('\nCLAIM 3 — churn semantics (honest, no-PFS group):');
console.log('  gran (joined v2) can\'t read v1 reply :', granReadsV1reply===null ? 'PASS (no history access)':'FAIL');
console.log('  dad (removed v3) can\'t read v3 post  :', dadReadsNewPost===null ? 'PASS (forward-excluded)':'FAIL');
console.log('  dad still reads v1 reply he had      :', dadStillReadsOldReply ? 'PASS (no retroactive revoke — same as §2 re-share concession)':'FAIL');

// ---- CLAIM 4: roster rollback is detectable via the chain ----
function walkToPin(served, historyById, pin){
  // served: the roster a host presents as current. pin: {seq,hash} the reader trusts.
  if (served.seq < pin.seq) return 'REJECT: seq below pin (rollback)';
  let cur = served;
  while (cur.seq > pin.seq){
    const prevDoc = historyById[cur.prev];
    if (!prevDoc) return 'REJECT: prev not found in history';
    if (hashOf(prevDoc) !== cur.prev) return 'REJECT: prev hash mismatch';
    cur = prevDoc;
  }
  return (hashOf(cur) === pin.hash) ? 'OK: walks back to pin' : 'REJECT: diverges from pin';
}
const byHash = Object.fromEntries(history.map(d => [hashOf(d), d]));
const pinAtV3 = { seq:3, hash:hashOf(v3) };
const honest  = walkToPin(v3, byHash, pinAtV3);                     // host serves current v3
const rolledBack = walkToPin(v2, byHash, pinAtV3);                  // host serves stale v2 to re-include dad
console.log('\nCLAIM 4 — roster is a chain → rollback detectable:');
console.log('  honest current (v3) vs pin@v3        :', honest.startsWith('OK') ? 'PASS ('+honest+')':'FAIL');
console.log('  host rolls back to v2 (re-adds dad)  :', rolledBack.startsWith('REJECT') ? 'PASS ('+rolledBack+')':'FAIL (rollback undetected!)');

const pass = rosterSig && momSeesV1 && stgSeesV1===null && audience && momReadsReply && dadReadsReply && kidReadsReply
  && granReadsV1reply===null && dadReadsNewPost===null && dadStillReadsOldReply
  && honest.startsWith('OK') && rolledBack.startsWith('REJECT');
console.log('\n=== '+(pass?'ALL CLAIMS PASS':'FAILURE')+' ===');
process.exit(pass?0:1);
