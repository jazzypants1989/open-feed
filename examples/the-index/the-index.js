// §4 — the index: entries and the fold, `highest`, media, who signs it, rewriting.
// Run: node examples/the-index/the-index.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signFile, splitFile, verifyFile, parseBody, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, signProfile } from '../../src/profile.js';
import { fold, checkIndex, checkAgainstPin, liveEntries, signIndex, verifyIndex } from '../../src/index.js';
import { createReader } from '../../src/reader.js';
import { encrypt, decrypt, carrierOf, readingKeyFromSeed, encryptMedia, decryptMedia } from '../../src/envelope.js';

// The test vectors' keys, posts and photograph.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const xkey = (label) => readingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const [A1, A2, A3, mum] = ['alice/anchor', 'alice/rotated', 'alice/restored', 'mum'].map(key);
const MUM = { key: mum, salt: 'saltmum' }, SIS = { key: key('sis'), salt: 'saltsis' };
const REC = commit([MUM, SIS, { key: key('bro'), salt: 'saltbro' }]);
const AT = 'https://alice.example/alice';
const chain = [{ key: A1.x }, rotation(A1, A2, REC), restore(A2, A3, [MUM, SIS], REC)];
const profile = signProfile({ anchor: A1.x, version: 3, name: 'Alice', chain, recovery: REC, locations: [AT], read: 'cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc' }, A3);
const post = (number, fields, k) => signFile({ number, ...fields }, k);
const photo = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1'), hp = sha256(photo);
const p1 = post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const p2 = post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1);
const p3 = post(3, { at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you' }, A2);
const p4 = post(4, { at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [hp] }, A3);
const [h1, h2, h3, h4] = [p1, p2, p3, p4].map(address);
const hAlt = address(post(2, { at: '2026-07-11T18:02:00Z', text: 'rewritten by somebody' }, A3));
const body = (f) => splitFile(f).body.toString();
const shown = (s) => (s === null ? 'does not fold' : [...s.live.keys()].map((k) => (typeof k === 'string' ? 'media' : k)).join(' ') || 'nothing live');

const files = new Map([[`${AT}/profile`, profile], [`${AT}/posts/1`, p1], [`${AT}/posts/2`, p2], [`${AT}/posts/3`, p3], [`${AT}/posts/4`, p4], [`${AT}/media/${hp}`, photo]]);
const reader = createReader({ get: async (p) => (files.has(p) ? { bytes: files.get(p), etag: '"t"' } : null) });
const serve = async (index, pin = null, now) => { files.set(`${AT}/index`, index); return reader.read({ learned: A1.x, at: AT, pin, now }); };
const idx = (entries, version, highest, k = A3) => signIndex({ entries, version, highest }, k);

// ---- §4 the file ----
const v1 = idx([[1, h1], [2, h2], [3, h3]], 1, 3);
console.log('§4 — the index\n');
console.log(`  ${body(v1)}\n`);
const cold = await serve(v1);
assert.equal(cold.verdict, 'ok');
assert.equal(checkIndex({ version: 1, highest: 3, entries: [] }, fold([])), 'entries is not the first member');
assert.equal(checkIndex({ entries: [], version: -1, highest: 0 }, fold([])), 'version is not a non-negative integer');
assert.equal(checkAgainstPin({ obj: { version: 0, highest: 3 }, address: 'x' }, fold([]), cold.pin).why, 'an index older than the one this reader saw');
const v2 = idx([[1, h1], [2, h2], [3, h3], [4, h4]], 2, 4), shared = body(v1).indexOf('],"version"');
assert.equal(body(v2).slice(0, shared), body(v1).slice(0, shared));                       // an append leaves the prefix in place
rule('4', `\`\`\`json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>"],["<media hash>"]],"version":9,"highest":3}
\`\`\`

| member | meaning |
|---|---|
| \`entries\` | the lines, in order; the live set is their fold (§4.1) |
| \`version\` | a non-negative integer that MUST NOT go backwards |
| \`highest\` | the highest post number ever issued, \`0\` when none has been (§4.2) |

\`entries\` MUST come first in the body, so that appending a line leaves every earlier byte in place and a
reader MAY fetch only the tail.`);

// ---- §4.1 entries and the fold ----
const e2 = [[1, h1], [2, h2], [3, h3], [2, null], [4, h4], [hp]];
console.log('§4.1 — the fold\n');
for (let i = 1; i <= e2.length; i++) console.log(`  ${JSON.stringify(e2.slice(0, i).at(-1)).replace(/"[\w-]{43}"/, '"…"').padEnd(14)} → ${shown(fold(e2.slice(0, i)))}`);
assert.deepEqual([[...fold(e2).live.keys()], fold(e2).highest, fold([...e2, [hp, null]]).live.has(hp)], [[1, 3, 4, hp], 4, false]);
for (const [what, e] of [['a number listed twice', [[1, h1], [2, h2], [2, h3]]], ['a withdrawal of nothing', [[1, h1], [9, null]]], ['a number below 1', [[0, h1]]],
  ['a media file listed twice', [[hp], [hp]]], ['a media withdrawal of nothing', [[1, h1], [hp, null]]], ['re-listed at another hash', [[1, h1], [2, h2], [2, null], [2, hAlt]]]]) assert.equal(fold(e), null, what);
assert.equal(fold([[1, h1], [2, h2], [2, null], [2, h2]]).live.get(2).hash, h2);           // re-listed at the identical hash
assert.equal(checkIndex({ entries: [], version: 1, highest: 2 }, { highest: 3 }), 'highest is below the highest number issued');
const wont = await serve(idx([[1, h1], [2, h2], [2, h3]], 4, 3));
assert.deepEqual([wont.verdict, wont.why], ['host', 'the index does not fold']);
// Across indexes, the pin remembers the withdrawn hash.
const gone = await serve(idx([[1, h1], [2, h2], [3, h3], [2, null]], 2, 3), cold.pin);
const back = await serve(idx([[1, h1], [3, h3], [2, h2]], 3, 3), gone.pin);
const swap = await serve(idx([[1, h1], [3, h3], [2, hAlt]], 3, 3), gone.pin);
console.log(`\n  withdrawn, then back at the same hash   ${back.verdict}`);
console.log(`  withdrawn, then back at another hash    ${swap.verdict}: ${swap.why}\n`);
assert.deepEqual([gone.verdict, gone.pin.withdrawn.get(2), back.verdict, swap.verdict, swap.why], ['ok', h2, 'ok', 'host', 'post 2 changed after the reader saw it']);
rule('4.1', `| line | means |
|---|---|
| \`[number, hash]\` | post \`number\` exists at address \`hash\` |
| \`[number, null]\` | post \`number\` is withdrawn |
| \`[hash]\` | the media file at address \`hash\` exists (§4.3) |
| \`[hash, null]\` | that media file is withdrawn |

A reader computes the live set by folding the entries in order. \`number\` is a positive integer. A number has
one hash, ever: a line for an \`number\` already seen is legal only if it withdraws a live \`number\` or re-lists a
withdrawn \`number\` at the identical hash. A withdrawal MUST refer to something live. \`[hash]\` for a media file
already live is illegal. \`highest\` MUST be at least the highest number in \`entries\`. An index that verifies
but does not fold is invalid, and a reader reports **host** (§7.2). A pinned reader remembers the hash of
every number it saw withdrawn, and a number that comes back at another hash is **host**.`);

// ---- §4.2 highest ----
const dropped = await serve(idx([[1, h1], [2, h2]], 4, 2), gone.pin);
console.log('§4.2 — highest\n');
console.log(`  post 3 withdrawn: highest ${fold([[1, h1], [2, h2], [3, h3], [3, null]]).highest}; an index with highest 2 after it: ${dropped.verdict}: ${dropped.why}\n`);
assert.equal(fold([[1, h1], [2, h2], [3, h3], [3, null]]).highest, 3);
assert.deepEqual([dropped.verdict, dropped.why], ['host', 'the highest number used went backwards']);
rule('4.2', '`highest` MUST NOT decrease, even when the post holding that number is withdrawn.');

// ---- §4.3 media ----
console.log('§4.3 — media\n');
const good = await serve(idx([[4, h4], [hp]], 5, 4));
files.set(`${AT}/media/${hp}`, Buffer.from('\x89PNG\r\n\x1a\n other photograph', 'latin1'));
const swapped = await serve(idx([[4, h4], [hp]], 5, 4));
files.set(`${AT}/media/${hp}`, photo);
const stray = Buffer.from('\x89PNG\r\n\x1a\n a photograph nobody listed', 'latin1'), hs = sha256(stray);
const p6 = post(6, { at: '2026-08-16T07:00:00Z', text: 'and one more', media: [hs] }, A3);
files.set(`${AT}/posts/6`, p6).set(`${AT}/media/${hs}`, stray);
const unlisted = await serve(idx([[4, h4], [hp], [6, address(p6)]], 6, 6));
console.log(`  listed and served      ${good.verdict}, ${good.media.get(hp).length} bytes back`);
console.log(`  bytes swapped          ${swapped.verdict}`);
console.log(`  referenced, unlisted   ${unlisted.verdict}; post 6 present ${unlisted.posts.has(6)}, its media present ${unlisted.media.has(hs)}`);
assert.ok(good.verdict === 'ok' && good.media.get(hp).equals(photo));
assert.deepEqual([swapped.verdict, swapped.why], ['host', `media file ${hp} is not what the index lists`]);
assert.deepEqual([unlisted.verdict, unlisted.posts.has(6), unlisted.media.has(hs)], ['ok', true, false]);
// Encrypted media: ciphertext listed, key in the envelope.
const mediaKey = crypto.createHash('sha256').update('openfeed/v1/vector:media-key').digest();
const sealed = encryptMedia(photo, () => mediaKey);
const env = encrypt({ content: { text: 'the morning after', rel: 'root', media: [{ hash: sealed.hash, key: sealed.key }] }, audience: [{ key: mum.x, read: xkey('mum-read').x, location: 'https://mom.example/mom' }],
  carrier: carrierOf(A1.x, 7), ephemeral: xkey('ephemeral/7'), contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/7').digest() });
const p7 = post(7, { at: '2026-08-18T21:40:00Z', encrypted: env }, A3);
files.set(`${AT}/posts/7`, p7).set(`${AT}/media/${sealed.hash}`, sealed.bytes);
const withSealed = await serve(idx([[4, h4], [hp], [7, address(p7)], [sealed.hash]], 7, 7));
const opened = decrypt(env, xkey('mum-read').privateKey, carrierOf(A1.x, 7));
assert.equal(withSealed.verdict, 'ok');
assert.deepEqual(Object.keys(parseBody(splitFile(p7).body)), ['number', 'at', 'encrypted']);
assert.deepEqual([sealed.hash, sealed.bytes.length, opened.media], [sha256(sealed.bytes), photo.length + 16, [{ hash: sealed.hash, key: sealed.key }]]);
assert.ok(decryptMedia(withSealed.media.get(sealed.hash), opened.media[0].key).equals(photo));
// One key, two files, one nonce: the XOR of the ciphertexts is the XOR of the photographs.
const other = Buffer.from('\x89PNG\r\n\x1a\n the same evening!', 'latin1'), reused = encryptMedia(other, () => mediaKey);
assert.ok(Buffer.from(sealed.bytes.subarray(0, photo.length).map((b, i) => b ^ reused.bytes[i])).equals(Buffer.from(photo.map((b, i) => b ^ other[i]))));
console.log(`  encrypted media        ${sealed.bytes.length} bytes of ciphertext listed at ${sealed.hash.slice(0, 8)}…; mum opens it: ${decryptMedia(withSealed.media.get(sealed.hash), opened.media[0].key).equals(photo)}\n`);
rule('4.3', `A media file is listed by \`[hash]\` and served at \`/<name>/media/<hash>\`; a reader MUST verify that the bytes
hash to the name it fetched them under. A media file referenced by a post but not listed in the index is
absent. A media file attached to an encrypted post is encrypted: \`ChaCha20-Poly1305(key, nonce = 12 zero
bytes, plaintext = the bytes, aad = "")\` under a random 32-byte key; the ciphertext is what is listed and
served, and the key is carried as \`{"hash": <listed hash>, "key": <base64url>}\` in the envelope's \`media\`
(§6.5). A key MUST NOT be reused for a second media file.`);

// ---- §4.4 who signs ----
const thief = idx([[1, h1]], 9, 3, A2), nopin = await serve(thief), held = await serve(thief, cold.pin);
console.log('§4.4 — who signs\n');
console.log(`  an index signed by the rotated-away key   no pin: ${nopin.verdict}: ${nopin.why};   pinned: ${held.verdict}, ${held.note.join('; ')}\n`);
assert.deepEqual([verifyIndex(thief, A3.x), verifyIndex(v1, A3.x) !== null, nopin.verdict, nopin.why, held.verdict], [null, true, 'host', 'the index is not signed by the key the profile ends on', 'ok']);
rule('4.4', `The index MUST be signed by the key the profile's chain currently ends on, not by any earlier key in the
chain.`);

// ---- §4.5 rewriting ----
const e4 = [[1, h1], [2, h2], [3, h3], [2, null], [4, h4], [hp], [3, null]], kept = liveEntries(e4);
const T0 = Date.parse('2026-07-05T00:00:00Z'), T1 = Date.parse('2026-09-03T00:00:00Z');
const at1 = await serve(v1, null, T0);
const at6 = await serve(idx(kept, 6, 4), at1.pin, T1);
console.log('§4.5 — rewriting\n');
console.log(`  ${JSON.stringify(e4).replace(/"[\w-]{43}"/g, '"…"')}\n  rewritten as ${JSON.stringify(kept).replace(/"[\w-]{43}"/g, '"…"')}`);
console.log(`  a reader that last saw version 1, at version 6: ${at6.verdict}, ${at6.note.join('; ')}\n`);
assert.deepEqual([[...fold(e4).live.keys()], fold(e4).highest], [[...fold(kept).live.keys()], fold(kept).highest]);
assert.deepEqual([at6.verdict, at6.note, [...at6.posts.keys()].sort()], ['ok', ['withdrawn: 2', 'withdrawn: 3'], [1, 4]]);
rule('4.5', `A publisher MAY replace the index with the fold of its entries, at a higher \`version\`. A reader accepts a
rewritten index exactly as it accepts an appended one.`);
