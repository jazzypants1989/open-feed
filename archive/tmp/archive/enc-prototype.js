// enc-prototype.js — Option E feasibility probe (NOT a committed vector yet)
//
// Goal: prove an "encrypted item" is just an ordinary Open Feed signed item whose
// content is a JWE envelope, and that it flows through the EXISTING construction
// unchanged:
//   (1) signs with construction #1 (same sign() as items/manifests/identity docs)
//   (2) verifies with the same verifier (the signer never sees plaintext)
//   (3) is committed by an ordinary manifest (host serves ciphertext it can't read)
//   (4) decrypts for each intended recipient — and ONLY them (blinded slot tags, §15.2)
//
// Crypto: JWE JSON Serialization, alg=ECDH-ES+A256KW, enc=A256GCM, X25519 (RFC 8037).
// All randomness (CEK, IV, ephemeral keys) is derived deterministically from labels so
// the probe is reproducible; a real deployment uses a CSPRNG for each.

import crypto from 'node:crypto';

// ---- shared helpers, identical to tmp/regen.js ----
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();

// Ed25519 signing key from label (as in regen.js)
function edKeyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const spki = crypto.createPublicKey(priv).export({format:'der', type:'spki'});
  return {priv, x:b64u(spki.subarray(spki.length-32))};
}

// X25519 enc keypair from label (RFC 8037). OID 1.3.101.110 -> ...2b656e...
function xKeyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-enc '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const pub  = crypto.createPublicKey(priv);
  const spki = pub.export({format:'der', type:'spki'});
  return {priv, pub, x:b64u(spki.subarray(spki.length-32))};
}
function xPubFromJwkX(xB64u){
  const spki = Buffer.concat([Buffer.from('302a300506032b656e032100','hex'), Buffer.from(xB64u,'base64url')]);
  return crypto.createPublicKey({key:spki, format:'der', type:'spki'});
}

// ---- construction #1 sign/verify, identical to regen.js ----
function header(kid){ return {alg:'EdDSA', b64:false, crit:['b64'], kid}; }
function sign(obj, priv, kid){
  const {_sig, _recovery_sig, ...rest} = obj;
  const payload = Buffer.from(canon(rest),'utf8');
  const hb = b64u(Buffer.from(JSON.stringify(header(kid)),'utf8'));
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), payload]);
  return hb + '..' + b64u(crypto.sign(null, input, priv));
}
function verify(obj, xPub){
  const {_sig} = obj; const {_sig:_a, _recovery_sig:_b, ...rest} = obj;
  const [hb,,sb] = _sig.split('.');
  const payload = Buffer.from(canon(rest),'utf8');
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), payload]);
  const pub = crypto.createPublicKey({key:{kty:'OKP',crv:'Ed25519',x:xPub}, format:'jwk'});
  return crypto.verify(null, input, pub, Buffer.from(sb,'base64url'));
}

// ---- JOSE ECDH-ES helpers ----
const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n>>>0); return b; };
function concatKDF(Z, keydatalenBits, algId){
  const lp = buf => Buffer.concat([be32(buf.length), buf]);
  const otherInfo = Buffer.concat([
    lp(Buffer.from(algId,'ascii')),  // AlgorithmID = the wrap alg for ECDH-ES+A256KW
    lp(Buffer.alloc(0)),             // PartyUInfo (apu) — empty
    lp(Buffer.alloc(0)),             // PartyVInfo (apv) — empty
    be32(keydatalenBits),            // SuppPubInfo = keydatalen
  ]);
  return sha256(Buffer.concat([be32(1), Z, otherInfo])).subarray(0, keydatalenBits/8);
}
const WRAP_IV = Buffer.from('A6A6A6A6A6A6A6A6','hex');
function aesWrap(kek, cek){
  const c = crypto.createCipheriv('id-aes256-wrap', kek, WRAP_IV);
  return Buffer.concat([c.update(cek), c.final()]);
}
function aesUnwrap(kek, wrapped){
  const d = crypto.createDecipheriv('id-aes256-wrap', kek, WRAP_IV);
  return Buffer.concat([d.update(wrapped), d.final()]);
}

// ---- encrypt: produce a JWE JSON Serialization to N X25519 recipients ----
function encryptJWE(plaintext, recipientsXpub, {cek, iv, ephFor}){
  const prot = { enc:'A256GCM' };
  const protB64 = b64u(Buffer.from(JSON.stringify(prot),'utf8'));
  const aad = Buffer.from(protB64,'ascii');

  const cipher = crypto.createCipheriv('aes-256-gcm', cek, iv, {authTagLength:16});
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext,'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();

  // ONE ephemeral for the whole envelope (§15.2). Per-recipient ephemerals were the earlier
  // shape and are what made recipient count a cost; tmp/enctags-prototype.js has the numbers.
  const eph = ephFor(0);
  const recipients = recipientsXpub.map((rx) => {
    const Z = crypto.diffieHellman({privateKey: eph.priv, publicKey: xPubFromJwkX(rx)});
    const kek = concatKDF(Z, 256, 'A256KW');
    return {
      // No "kid" — the blinded tag identifies the slot to its recipient and to nobody else.
      header: { alg:'ECDH-ES+A256KW', _tag: slotTag(Z) },
      encrypted_key: b64u(aesWrap(kek, cek)),
    };
  });

  return {
    protected: protB64, epk: { kty:'OKP', crv:'X25519', x: eph.x },
    recipients, iv: b64u(iv), ciphertext: b64u(ct), tag: b64u(tag),
  };
}

// §15.2's blinded slot tag: the first 8 bytes of SHA-256("openfeed-slot-tag" || Z). Computing
// it needs one of the two private halves, so an observer holding every published encryption
// key and the ephemeral learns nothing; and the ephemeral is per-item, so no recipient is
// linkable across two items — the property that rules out `kid` here.
function slotTag(Z){
  return b64u(crypto.createHash('sha256').update('openfeed-slot-tag').update(Z).digest().subarray(0,8));
}

// ---- decrypt: one key agreement, then a comparison per slot ----
function decryptJWE(jwe, myXpriv){
  const aad = Buffer.from(jwe.protected,'ascii');
  const Z = crypto.diffieHellman({privateKey: myXpriv, publicKey: xPubFromJwkX(jwe.epk.x)});
  const want = slotTag(Z);
  const mine = jwe.recipients.find(r => r.header._tag === want);
  if (!mine) return null;                                   // not in the audience, and cheaply so
  const kek = concatKDF(Z, 256, 'A256KW');
  const cek = aesUnwrap(kek, Buffer.from(mine.encrypted_key,'base64url'));
  const dec = crypto.createDecipheriv('aes-256-gcm', cek, Buffer.from(jwe.iv,'base64url'), {authTagLength:16});
  dec.setAAD(aad);
  dec.setAuthTag(Buffer.from(jwe.tag,'base64url'));
  return Buffer.concat([dec.update(Buffer.from(jwe.ciphertext,'base64url')), dec.final()]).toString('utf8');
}

// =====================================================================
// Scenario: Mom writes a family-only journal entry for Dad and Kid.
// =====================================================================
const author  = edKeyFromLabel('test-key-1');       // Mom's signing key (same as regen.js test-key-1)
const KID = 'https://test.example/#test-key-1';

const dadEnc  = xKeyFromLabel('dad');               // recipients' published X25519 enc keys
const kidEnc  = xKeyFromLabel('kid');
const strangerEnc = xKeyFromLabel('stranger');      // NOT in the audience

// deterministic "randomness" for a reproducible probe (real: crypto.randomBytes)
const cek = sha256(Buffer.from('probe-cek')).subarray(0,32);
const iv  = sha256(Buffer.from('probe-iv')).subarray(0,12);
const ephFor = i => xKeyFromLabel('eph-'+i);

// CARRIER BINDING (the fix for the ciphertext-relay defect found in review):
// the sealed plaintext names the item it belongs to. Without this, the envelope is
// context-free — anyone can lift `_openfeed.enc` out of Mom's item, drop it into their own
// freshly-signed item, and have an audience member render Mom's private words
// attributed to the attacker. Note the attacker need not be able to READ it.
const ITEM_ID = 'urn:uuid:aaaaaaaa-7dec-11d0-a765-00a0c91e6bf6';
const DAD = 'https://dad.example/';
const KID_URL = 'https://kid.example/';

// THE DECLARED AUDIENCE (§15.2.2): the identities Mom wrapped to, named inside the sealed
// plaintext. Not in a JWE per-recipient header — those stay untagged so an *observer* learns
// nothing. Readers learning the audience is the entire point: without it a recipient cannot
// wrap a reply to the other recipients, so every reply collapses into a DM back to the author
// and the family thread only works inside one hub.
const plaintext = JSON.stringify({
  id: ITEM_ID,
  authors: [{ url: 'https://test.example/' }],
  _openfeed: { feed_url: 'https://test.example/feed.json' },
  audience: [DAD, KID_URL],
  content_text: 'Kid took her first steps today 🥹',
  mood: 'overjoyed',
});

// A decrypting client MUST check the sealed binding fields against the outer item and
// reject on any mismatch. This lives at the decrypting client, not the core verifier.
function openBound(item, myXpriv){
  const pt = decryptJWE(item._openfeed?.enc, myXpriv);
  if (pt === null) return null;                      // not in the audience
  const inner = JSON.parse(pt);
  const outerAuthor = item.authors && item.authors[0] && item.authors[0].url;
  const innerAuthor = inner.authors && inner.authors[0] && inner.authors[0].url;
  if (inner.id !== item.id || innerAuthor !== outerAuthor || inner._openfeed?.feed_url !== item._openfeed?.feed_url){
    return { rejected: 'carrier-binding mismatch' };  // relayed ciphertext
  }
  return inner;
}

const jwe = encryptJWE(plaintext, [dadEnc.x, kidEnc.x], {cek, iv, ephFor});

// The encrypted ITEM: an ordinary signed item. content_text:"" keeps it JSON-Feed-valid.
const item = {
  authors: [{ url: 'https://test.example/' }],
  content_text: '',
  date_published: '2025-01-15T12:00:00Z',
  id: ITEM_ID,
  _openfeed: { feed_url: 'https://test.example/feed.json', version: 1, enc: jwe },
};
item._sig = sign(item, author.priv, KID, { kind: 'item' });

// ---- CLAIM 1 & 2: signs and verifies with the UNCHANGED construction ----
const sigOk = verify(item, author.x);

// ---- CLAIM 3: an ordinary manifest commits the ciphertext (host reads nothing) ----
const manifest = {
  url: 'https://test.example/',
  feed_url: 'https://test.example/feed.json',
  seq: 1,
  updated: 1739577600,
  items: { [item.id]: item._openfeed?.version },
};
manifest._sig = sign(manifest, author.priv, KID, { kind: 'manifest' });
const manOk = verify(manifest, author.x) && manifest.items[item.id] === item._openfeed?.version;

// ---- CLAIM 4: recipients decrypt; stranger does not ----
const dadReads     = openBound(item, dadEnc.priv);
const kidReads     = openBound(item, kidEnc.priv);
const strangerReads= openBound(item, strangerEnc.priv);

// ---- CLAIM 5: ciphertext relay is REJECTED ----
// Eve cannot read the entry. She does not need to: she copies the opaque `_openfeed.enc` blob
// verbatim into her own item, with a fresh id and her own authorship, and signs it
// with her own key. Every core check passes — signature valid, author binding valid,
// _feed_url consistent, fresh id so §7.5 exclusivity is not triggered, and an ordinary
// manifest will commit it. Only the carrier binding inside the envelope stops it.
const eve = edKeyFromLabel('eve');
const EVE_KID = 'https://eve.example/#eve-key-1';
const relayed = {
  authors: [{ url: 'https://eve.example/' }],
  content_text: '',
  date_published: '2025-01-16T09:00:00Z',
  id: 'urn:uuid:eeeeeeee-7dec-11d0-a765-00a0c91e6bf6',
  _openfeed: {
    feed_url: 'https://eve.example/feed.json',
    version: 1,
    rel: [{ type: 'reply', to: 'https://gran.example/~gran/feed.json#urn:uuid:1234' }],
    enc: item._openfeed.enc,                     // Mom's sealed bytes, verbatim
  },
};
relayed._sig = sign(relayed, eve.priv, EVE_KID, { kind: 'item' });
const relaySigValid = verify(relayed, eve.x);        // the forgery is a VALID signed item
const relayOpened   = openBound(relayed, dadEnc.priv);
const relayRejected = relayOpened && relayOpened.rejected === 'carrier-binding mismatch';

// ---- CLAIM 6: a recipient replies to the SAME audience (§15.2.2) ----
// The case a published roster was thought to be needed for. Dad decrypts Mom's entry, reads
// the audience out of the sealed plaintext, and wraps his reply to the same identities —
// resolving each one's X25519 key from that identity's own document (§15.1: the audience names
// people and holds no keys). Nothing is published, nothing is chained, no roster exists, and
// Kid — who is not the author of anything here — can read it.
const publishedEncKeys = {                    // stands in for each identity's own openfeed.json
  [DAD]: dadEnc,
  [KID_URL]: kidEnc,
  'https://test.example/': xKeyFromLabel('mom'),
};
const momEnc = publishedEncKeys['https://test.example/'];

const REPLY_ID = 'urn:uuid:bbbbbbbb-7dec-11d0-a765-00a0c91e6bf6';
// Dad replies to everyone who could read the parent: the declared audience, plus its author,
// minus himself. Leaving the author out would be the one mistake that makes the thread useless.
const replyAudience = [...new Set([...dadReads.audience, 'https://test.example/'])].filter(u => u !== DAD);
const replyPlaintext = JSON.stringify({
  id: REPLY_ID,
  authors: [{ url: DAD }],
  audience: replyAudience,
  content_text: 'I cried. Do not tell anyone I cried.',
});
const replyJwe = encryptJWE(
  replyPlaintext,
  replyAudience.map(u => publishedEncKeys[u].x),
  { cek: sha256(Buffer.from('probe-cek-reply')).subarray(0,32),
    iv: sha256(Buffer.from('probe-iv-reply')).subarray(0,12),
    ephFor: i => xKeyFromLabel('eph-reply-'+i) },
);
// Delivered, not published: no `_openfeed.feed_url` (§15.4), so `_rel[].to` never lands in a
// world-readable file. That is the other half of the design and it is why the reply is
// POSTed to each audience member's inbox rather than appearing in Dad's feed.
const reply = {
  _openfeed: { version: 1 },
  authors: [{ url: DAD }],
  content_text: '',
  date_published: '2025-01-15T13:00:00Z',
  id: REPLY_ID,
  _openfeed: { rel: [{ type: 'reply', to: 'https://test.example/feed.json#' + ITEM_ID }], enc: replyJwe },
};
const dadSigner = edKeyFromLabel('dad-sig');
reply._sig = sign(reply, dadSigner.priv, DAD + '#dad-key-1', { kind: 'item' });

const replySigOk = verify(reply, dadSigner.x);
const kidReadsReply = openBound(reply, kidEnc.priv);      // the whole point: a non-author reads it
const momReadsReply = openBound(reply, momEnc.priv);
const strangerReadsReply = openBound(reply, strangerEnc.priv);
const replyReaches =
  kidReadsReply && !kidReadsReply.rejected &&
  momReadsReply && !momReadsReply.rejected &&
  strangerReadsReply === null;

// ---- what does a passive host / non-recipient learn from the item bytes? ----
const hostVisible = Object.keys(item).filter(k => k !== '_enc' && k !== '_sig');

console.log('=== Option E prototype — encrypted item ===\n');
console.log('recipients (published X25519 x):');
console.log('  dad     :', dadEnc.x);
console.log('  kid     :', kidEnc.x);
console.log('item.id   :', item.id);
console.log('item bytes:', Buffer.byteLength(canon(item)), 'bytes  (JWE recipients:', item._openfeed?.enc.recipients.length + ')');
console.log();
console.log('CLAIM 1 — signs with construction #1 (Ed25519 detached JWS) :', item._sig.slice(0,24)+'…');
console.log('CLAIM 2 — verifies with the UNCHANGED verifier             :', sigOk ? 'PASS' : 'FAIL');
console.log('CLAIM 3 — ordinary manifest commits the ciphertext         :', manOk ? 'PASS' : 'FAIL');
console.log('CLAIM 4 — intended recipients decrypt:');
console.log('           dad     :', dadReads && !dadReads.rejected ? 'PASS ('+dadReads.mood+')' : 'FAIL');
console.log('           kid     :', kidReads && !kidReads.rejected ? 'PASS' : 'FAIL');
console.log('           stranger:', strangerReads === null ? 'PASS (locked out)' : 'FAIL (LEAK!)');
console.log('           round-trip plaintext intact:', JSON.stringify(dadReads) === plaintext ? 'PASS' : 'FAIL');
console.log('CLAIM 5 — ciphertext RELAY is rejected by carrier binding:');
console.log('           Eve\'s relayed item is a validly signed item :', relaySigValid ? 'yes (as expected)' : 'no');
console.log('           audience member rejects it on decrypt       :', relayRejected ? 'PASS' : 'FAIL (MISATTRIBUTION!)');
console.log('CLAIM 6 — a recipient replies to the SAME audience (§15.2.2):');
console.log('           audience Dad read out of the sealed payload :', dadReads.audience.join(', '));
console.log('           Dad wraps his reply to                      :', replyAudience.join(', '));
console.log('           reply signs and verifies (construction #1)  :', replySigOk ? 'PASS' : 'FAIL');
console.log('           Kid — not the author of either — reads it   :', kidReadsReply && !kidReadsReply.rejected ? 'PASS' : 'FAIL');
console.log('           Mom reads it                                :', momReadsReply && !momReadsReply.rejected ? 'PASS' : 'FAIL');
console.log('           stranger still locked out                   :', strangerReadsReply === null ? 'PASS' : 'FAIL (LEAK!)');
console.log('           reply is DELIVERED, not published (_feed_url):', reply._openfeed?.feed_url === undefined ? 'PASS (absent, §15.4)' : 'FAIL');
console.log('           documents published to make this work       :', 0);
console.log();
console.log('What the serving host / a non-recipient sees in cleartext (metadata leak surface):');
console.log('  ', hostVisible.join(', '));
console.log('  → content is opaque; id/date/_feed_url/author remain public. (blinded slot tags: audience hidden)');
console.log('  → the declared audience is inside the ciphertext, so readers learn it and observers do not.');

const allPass = sigOk && manOk && JSON.stringify(dadReads)===plaintext && kidReads && !kidReads.rejected
  && strangerReads===null && relaySigValid && relayRejected && replySigOk && replyReaches;
console.log('\n=== '+(allPass ? 'ALL CLAIMS PASS' : 'FAILURE')+' ===');
process.exit(allPass ? 0 : 1);
