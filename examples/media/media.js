// §4.4 — a media file is the one unsigned file: the index admits it, its own hash checks it, and an
// encrypted post's media is ciphertext at a listed hash. Run: node examples/media/media.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, splitFile, verifyFile, parseBody, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { signProfile } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createReader } from '../../src/reader.js';
import { encrypt, decrypt, carrierOf, readingKeyFromSeed, encryptMedia, decryptMedia } from '../../src/envelope.js';

// Appendix B's keys and Appendix B's photograph, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const xkey = (label) => readingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const alice = key('alice/anchor'), mum = key('mum');
const AT = 'https://alice.example/alice';
const photo = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1'), photoHash = sha256(photo);
const short = (h) => `${h.slice(0, 8)}…`;

console.log('§4.4 — a media file is the one unsigned file\n');
console.log(`  bytes             ${photo.length} — a PNG signature and some text, standing in for a photograph`);
console.log(`  address           ${photoHash}`);
console.log(`  which is          base64url SHA-256 of those ${photo.length} bytes, and the whole of its verification`);
console.log(`  path              /alice/media/${photoHash}`);
console.log(`  read as a file    ${verifyFile(photo, alice.x)} — no body, no separator, no signature\n`);
console.log('  That is Appendix B.10\'s media file, byte for byte. Everything else on the wire is signed;\n  this one is named by its content instead, so there is nothing left for a signature to add.\n');
assert.equal(photoHash, 'fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g');
assert.equal(verifyFile(photo, alice.x), null);

// One identity, one chain link: enough for a reader to check an index and every file it lists.
const profile = signProfile({ anchor: alice.x, version: 1, chain: [{ key: alice.x }], recovery: { leaves: [] }, locations: [AT] }, alice);
const post4 = signFile({ n: 4, at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [photoHash] }, alice);
const hub = new Map([[`${AT}/profile`, profile], [`${AT}/posts/4`, post4], [`${AT}/media/${photoHash}`, photo]]);
const reader = createReader({ get: async (p) => (hub.has(p) ? { bytes: hub.get(p), etag: '"t"' } : null) });
const list = (entries, version, top) => hub.set(`${AT}/index`, signIndex({ entries, version, top }, alice));
const now = () => reader.read({ learned: alice.x, at: AT });
assert.equal(address(post4), '3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo');

list([[4, address(post4)], [photoHash]], 1, 4);
const good = await now();
hub.set(`${AT}/media/${photoHash}`, Buffer.from('\x89PNG\r\n\x1a\n other photograph', 'latin1'));
const swapped = await now();
hub.delete(`${AT}/media/${photoHash}`);
const withheld = await now();
hub.set(`${AT}/media/${photoHash}`, photo);
console.log('§4.4 — what admits it is being listed in the index; what checks it is its hash\n');
console.log(`  the index line    ["${photoHash}"]  — the address alone`);
console.log(`  listed, served    ${good.verdict}, and the reader hands back ${good.media.get(photoHash).length} bytes: the original ${good.media.get(photoHash).equals(photo)}`);
console.log(`  bytes swapped     this host is misbehaving — ${swapped.why.replace(photoHash, short(photoHash))}`);
console.log(`  bytes withheld    this host is misbehaving — ${withheld.why.replace(photoHash, short(photoHash))}\n`);
console.log('  A reader MUST verify that the bytes it fetched hash to the name it fetched them under.\n  That check is why nothing signs the blob, and why swapping it is caught anyway.\n');
assert.equal(good.verdict, 'ok'); assert.ok(good.media.get(photoHash).equals(photo));
assert.equal(swapped.verdict, 'host'); assert.equal(swapped.why, `media file ${photoHash} is not what the index lists`);
assert.equal(withheld.verdict, 'host'); assert.equal(withheld.why, `media file ${photoHash} is listed and not served`);

// A post naming a media file the index does not list — with the bytes sitting on the hub, served.
const stray = Buffer.from('\x89PNG\r\n\x1a\n a photograph nobody listed', 'latin1'), strayHash = sha256(stray);
const post6 = signFile({ n: 6, at: '2026-08-16T07:00:00Z', text: 'and one more', media: [strayHash] }, alice);
hub.set(`${AT}/posts/6`, post6).set(`${AT}/media/${strayHash}`, stray);
list([[4, address(post4)], [photoHash], [6, address(post6)]], 2, 6);
const unlisted = await now();
console.log('§4.4 — a media file the index does not list is simply not there\n');
console.log(`  post 6 says       "media":["${strayHash}"]`);
console.log(`  the hub serves    /alice/media/${short(strayHash)} — ${stray.length} bytes, right where the post points`);
console.log('  the index says    nothing about it');
console.log(`  the read          ${unlisted.verdict}; post 6 present ${unlisted.posts.has(6)}; media present ${unlisted.media.has(strayHash)}\n`);
console.log('  The post is not broken by it and the reader says nothing. Being served is not being\n  there; being listed is.\n');
assert.equal(unlisted.verdict, 'ok'); assert.ok(unlisted.posts.has(6));
assert.equal(unlisted.media.has(strayHash), false);

// A real publisher draws these 32 bytes at random; a fixed label stands in so the output reproduces.
const mediaKey = crypto.createHash('sha256').update('openfeed/v1/vector:media-key').digest();
const sealed = encryptMedia(photo, () => mediaKey);
const env = encrypt({
  content: { text: 'the morning after', rel: 'root', media: [{ hash: sealed.hash, key: sealed.key }] },
  audience: [{ key: mum.x, read: xkey('mum-read').x, loc: 'https://mom.example/mom' }],
  carrier: carrierOf(alice.x, 7), ephemeral: xkey('ephemeral/7'),
  contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/7').digest(),
});
const post7 = signFile({ n: 7, at: '2026-08-18T21:40:00Z', encrypted: env }, alice);
hub.set(`${AT}/posts/7`, post7).set(`${AT}/media/${sealed.hash}`, sealed.bytes);
list([[4, address(post4)], [photoHash], [6, address(post6)], [7, address(post7)], [sealed.hash]], 3, 7);
const withSealed = await now();
const clear = parseBody(splitFile(post7).body);
console.log('§4.4 — listed in the index, so retention is one rule that reaches encrypted posts\n');
console.log(`  post 7 in the clear   members: ${Object.keys(clear).join(', ')}`);
console.log(`  a media reference?    ${'media' in clear} — on an encrypted post it is inside the envelope (§5.5, §6.5)`);
console.log(`  the index line        ["${sealed.hash}"]`);
console.log('\n  The host cannot read post 7 and so cannot know which blobs it needs. The index line tells\n  it anyway: keep this one. That is the whole argument for listing media in the index rather\n  than leaving retention to the posts that reference it.\n');
assert.deepEqual(Object.keys(clear), ['n', 'at', 'encrypted']); assert.equal('media' in clear, false);

const opened = decrypt(env, xkey('mum-read').privateKey, carrierOf(alice.x, 7));
const back = decryptMedia(withSealed.media.get(sealed.hash), opened.media[0].key);
console.log('§4.4 — encrypted media: the listed hash is the hash of the ciphertext\n');
console.log('  ChaCha20-Poly1305(key, nonce = 12 zero bytes, plaintext = the media bytes, aad = "")\n');
console.log(`  ciphertext        ${sealed.bytes.length} bytes — ${photo.length} plus a 16-byte tag`);
console.log(`  listed and served ${sealed.hash}   = SHA-256 of the ciphertext`);
console.log(`  not               ${photoHash}   = SHA-256 of the photograph`);
console.log(`  in the envelope   {"hash":"${short(sealed.hash)}","key":"${short(sealed.key)}"}`);
console.log(`  mum opens it, checks the hash, decrypts: back to the original ${back.equals(photo)}\n`);
assert.equal(sealed.hash, sha256(sealed.bytes)); assert.notEqual(sealed.hash, photoHash);
assert.equal(sealed.bytes.length, photo.length + 16);
assert.deepEqual(opened.media, [{ hash: sealed.hash, key: sealed.key }]); assert.ok(back.equals(photo));

// The rule, shown rather than asserted: one key, two files, the same all-zero nonce.
const other = Buffer.from('\x89PNG\r\n\x1a\n the same evening!', 'latin1'), reused = encryptMedia(other, () => mediaKey);
const xorCt = Buffer.from(sealed.bytes.subarray(0, photo.length).map((b, i) => b ^ reused.bytes[i]));
const xorPt = Buffer.from(photo.map((b, i) => b ^ other[i]));
console.log('§4.4 — the key MUST NOT be reused for a second media file\n');
console.log(`  ciphertext1 XOR ciphertext2   ${xorCt.toString('hex')}`);
console.log(`  photograph1 XOR photograph2   ${xorPt.toString('hex')}`);
console.log(`  identical: ${xorCt.equals(xorPt)} — the nonce is fixed at 12 zero bytes, so one key is one keystream`);
console.log('\n  Anyone holding both blobs recovers the XOR of the two photographs without holding the key,\n  and the repeated Poly1305 one-time key lets them forge tags. Draw a fresh key per media file.\n');
assert.ok(xorCt.equals(xorPt));

console.log('§4.4 — what the hub learns\n');
for (const [p, b] of [...hub].filter(([p]) => p.includes('/media/'))) console.log(`  /media/${short(p.split('/media/')[1])}   ${String(b.length).padStart(2)} bytes`);
console.log('\n  That a blob of some size exists, and nothing else. Appendix A gives media no type of its\n  own — "whatever the bytes are" — and nothing the protocol checks reads that header: the hash\n  covers the bytes, and the header is not among them.\n');
assert.equal([...hub.keys()].filter((p) => p.includes('/media/')).length, 3);

console.log('Every line above is asserted.');
