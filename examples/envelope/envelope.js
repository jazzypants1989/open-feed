// §6 — encrypted content: the envelope, post binding, slots and tags, the audience inside,
// what goes inside. Run: node examples/envelope/envelope.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signFile, splitFile, verifyFile, address, signingKeyFromSeed } from '../../src/file.js';
import { encrypt, decrypt, postBinding, readingKeyFromSeed, readingPublicKey, INFO } from '../../src/envelope.js';

// The test vectors' keys and seeded randomness; a real publisher draws the ephemeral and the content key at random.
const ed = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const xk = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${l}`).digest());
const ck = (l) => crypto.createHash('sha256').update(l).digest();
const seeded = (l) => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', l, '', String(i++), n)); };
const b64 = (b) => Buffer.from(b).toString('base64url'), unb64 = (s) => Buffer.from(s, 'base64url');
const aead = (k, iv, d, aad) => { const c = crypto.createCipheriv('chacha20-poly1305', k, iv, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: d.length }); return Buffer.concat([c.update(d), c.final(), c.getAuthTag()]); };
const unaead = (k, iv, d, aad) => { const c = crypto.createDecipheriv('chacha20-poly1305', k, iv, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: d.length - 16 }); c.setAuthTag(d.subarray(-16)); return Buffer.concat([c.update(d.subarray(0, -16)), c.final()]); };
const Z12 = Buffer.alloc(12);

const AT = 'https://alice.example/alice';
const alice = { ed: ed('alice/anchor'), read: xk('vector:alice-read'), location: AT };
const mum = { ed: ed('mum'), read: xk('vector:mum-read'), location: 'https://mom.example/mom' };
const sis = { ed: ed('sis'), read: xk('vector:sis-read'), location: 'https://sis.example/sis' };
const bro = { ed: ed('bro'), read: xk('vector:bro-read'), location: 'https://bro.example/bro' };
const who = (p) => ({ key: p.ed.x, read: p.read.x, location: p.location });
const A3 = ed('alice/restored'), thief = ed('thief');
const c5 = postBinding(alice.ed.x, 5), c6 = postBinding(alice.ed.x, 6);
const dm = encrypt({ content: { text: 'I am leaving him on Friday', rel: 'root' }, audience: [who(alice), who(mum)], binding: c5, ephemeral: xk('vector:ephemeral/5'), contentKey: ck('openfeed/v1/vector:contentkey/5') });
const fam = encrypt({ content: { text: 'the divorce is final, come for dinner', rel: 'root' }, audience: [who(alice), who(mum), who(sis), who(bro)], binding: c6, ephemeral: xk('example:ephemeral/6'), contentKey: ck('example:contentkey/6') });
const post5 = signFile({ number: 5, at: '2026-08-18T21:40:00Z', encrypted: dm }, A3);
const post6 = signFile({ number: 6, at: '2026-08-19T08:05:00Z', encrypted: fam }, A3);

// ---- §6 ----
console.log('§6 — an encrypted post\n');
console.log(`  ${splitFile(post5).body.toString().slice(0, 70)}…\n`);
assert.equal(splitFile(post5).sigLine.length, 86);
assert.deepEqual(Object.keys(JSON.parse(splitFile(post5).body)), ['number', 'at', 'encrypted']);
assert.deepEqual(Object.keys(dm), ['ephemeral', 'slots', 'ciphertext']);
assert.equal(address(post5), 'jPXhIAtS7czC2KidAM1Uad5mbt0_ghFDJxsj6da1hEU');
assert.equal(decrypt(dm, xk('example:hub-read').privateKey, c5), null);
// A hub whose reading key is in the audience opens the post like any other member.
const hubRead = xk('example:hub-read'), toHub = encrypt({ content: { text: 'for the family' }, audience: [who(alice), { key: thief.x, read: hubRead.x, location: 'https://hub.example/op' }], binding: c6, ephemeral: xk('example:ephemeral/9'), contentKey: ck('example:contentkey/9') });
assert.equal(decrypt(toHub, hubRead.privateKey, c6).text, 'for the family');
rule('6', `An encrypted post is a post whose content is inside an \`encrypted\` member:

\`\`\`json
{"number":5,"at":"2026-08-01T09:00:00Z",
 "encrypted":{"ephemeral":"<x25519 key>","slots":[["<tag>","<wrapped>"],...],"ciphertext":"<ciphertext>"}}
\`\`\`

It is signed, addressed, and listed exactly as any other post, and a reader that cannot open it verifies
it and returns it with \`encrypted\` opaque (§7.1). A reader MUST NOT present encryption or audience
control as protection from a hub that is in the audience.`);

// ---- §6.1 the envelope, derived from node:crypto alone ----
const eph = xk('vector:ephemeral/5'), epk = unb64(eph.x), key5 = ck('openfeed/v1/vector:contentkey/5');
const Z = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: readingPublicKey(mum.read.x) });
const k52 = Buffer.from(crypto.hkdfSync('sha256', Z, epk, 'openfeed/v1/slot', 52));
const [tag, kek, knonce] = [k52.subarray(0, 8), k52.subarray(8, 40), k52.subarray(40, 52)];
const plain = Buffer.from(JSON.stringify({ audience: [who(alice), who(mum)], text: 'I am leaving him on Friday', rel: 'root' }), 'utf8');
console.log('§6.1 — the envelope\n');
console.log(`  ephemeral ${eph.x}\n  mum's slot: tag ${b64(tag)}, wrapped ${b64(aead(kek, knonce, key5, epk)).slice(0, 20)}…\n`);
assert.deepEqual([b64(tag), b64(aead(kek, knonce, key5, epk))], dm.slots[1]);
assert.equal(b64(aead(key5, Z12, plain, Buffer.concat([epk, Buffer.from(c5, 'ascii')]))), dm.ciphertext);
assert.equal(INFO, 'openfeed/v1/slot');
assert.equal(epk.length, 32);
// An all-zero Z: the low-order point is refused at derivation, on both sides.
const zeroPub = Buffer.alloc(32).toString('base64url');
assert.equal(decrypt({ ...dm, ephemeral: zeroPub }, mum.read.privateKey, c5), null);
assert.throws(() => encrypt({ content: { text: 'x' }, audience: [{ key: mum.ed.x, read: zeroPub, location: mum.location }], binding: c5, ephemeral: eph, contentKey: key5 }));
// The content key and the ephemeral are per message.
assert.notEqual(dm.ephemeral, fam.ephemeral);
assert.throws(() => JSON.parse('{"a":1,"a":2}', (k, v) => { if (k === 'a' && v === 2) throw new Error('dup'); return v; }));   // §2.4 applies inside too
rule('6.1', `One X25519 ephemeral key pair per message. For each recipient reading key \`R\`:

\`\`\`
Z                               = X25519(ephemeral private, R)
tag(8) || kek(32) || knonce(12) = HKDF-SHA256(ikm = Z, salt = ephemeral, info = "openfeed/v1/slot", 52 bytes)
wrapped                         = ChaCha20-Poly1305(key = kek, nonce = knonce, plaintext = content key, aad = ephemeral)
\`\`\`

and the content, once:

\`\`\`
plain      = UTF-8 JSON of {"audience": [...], ...the post's content members...}
ciphertext = ChaCha20-Poly1305(key = content key, nonce = 12 zero bytes, plaintext = plain, aad = ephemeral || <anchor>:<number>)
\`\`\`

\`ephemeral\` is the ephemeral public key in base64url; wherever it is used as bytes it is the 32 raw key bytes.
Each slot is a \`[tag, wrapped]\` pair of base64url strings. A reader MUST reject an all-zero \`Z\`.
The content key MUST be 32 random bytes and MUST NOT be reused across messages. \`plain\` is a JSON object
body and §2.4 applies to it.`);

// ---- §6.2 post binding ----
const lifted = signFile({ number: 1, at: '2026-08-19T02:00:00Z', encrypted: dm }, thief);
console.log(`§6.2 — the thief's post 1 carrying alice's envelope verifies as his; mum opens it there: ${decrypt(dm, mum.read.privateKey, postBinding(thief.x, 1))}; at post 5: "${decrypt(dm, mum.read.privateKey, c5).text}"\n`);
assert.ok(verifyFile(lifted, thief.x));
assert.equal(decrypt(dm, mum.read.privateKey, postBinding(thief.x, 1)), null);
assert.equal(decrypt(dm, mum.read.privateKey, ''), null);
assert.equal(decrypt(dm, mum.read.privateKey, c5).text, 'I am leaving him on Friday');
assert.equal(c5, `${alice.ed.x}:5`);
rule('6.2', `The associated data of \`ciphertext\` is the ephemeral public key followed by the ASCII bytes
\`<author anchor key>:<post number>\` of the post the envelope is published in. This binding MUST
be present; an envelope lifted into another post does not open there.`);

// ---- §6.3 slots and tags ----
const collided = { ...dm, slots: [[dm.slots[1][0], b64(seeded('collision')(48))], ...dm.slots] };
const mumTag = (env) => b64(Buffer.from(crypto.hkdfSync('sha256', crypto.diffieHellman({ privateKey: mum.read.privateKey, publicKey: readingPublicKey(env.ephemeral) }), unb64(env.ephemeral), INFO, 8)));
console.log(`§6.3 — a slot with mum's tag and a bad wrap placed first; she still opens: "${decrypt(collided, mum.read.privateKey, c5).text}"\n`);
assert.ok(dm.slots.some(([t]) => t === mumTag(dm)));
assert.equal(decrypt(collided, mum.read.privateKey, c5).text, 'I am leaving him on Friday');
assert.notEqual(mumTag(dm), mumTag(fam));
rule('6.3', `A recipient derives its own tag from its own \`Z\` and scans the slots for it. A tag is a hint: a match
whose unwrap fails is a collision, and the reader MUST keep scanning.`);

// ---- §6.4 the audience ----
const inside = decrypt(fam, mum.read.privateKey, c6);
console.log(`§6.4 — mum opens post 6 and finds ${inside.audience.length} entries, alice's own among them\n`);
assert.equal(inside.audience.length, 4);
assert.ok(inside.audience.some((a) => a.key === alice.ed.x));
for (const a of inside.audience) assert.deepEqual(Object.keys(a), ['key', 'read', 'location']);
assert.equal(decrypt(fam, alice.read.privateKey, c6).text, inside.text);
rule('6.4', `\`audience\` MUST be an array of the recipients inside the plaintext, each
\`{"key": <anchor>, "read": <x25519 key>, "location": <location>}\`, and a publisher MUST include itself.`);

// ---- §6.5 inside ----
const c13 = postBinding(mum.ed.x, 13);
const reply = encrypt({ content: { text: 'we are with you', rel: 'reply', target: { key: alice.ed.x, number: 6, hash: address(post6), location: AT }, media: [{ hash: 'h'.repeat(43), key: 'k'.repeat(43) }] }, audience: inside.audience, binding: c13, ephemeral: xk('example:ephemeral/13'), contentKey: ck('example:contentkey/13') });
const b13 = splitFile(signFile({ number: 13, at: '2026-08-19T19:00:00Z', encrypted: reply }, mum.ed)).body.toString();
const opened = decrypt(reply, alice.read.privateKey, c13);
console.log(`§6.5 — mum's reply: "reply" in the public bytes? ${b13.includes('reply')}; inside: rel ${opened.rel}, target n ${opened.target.number}, media ${JSON.stringify(Object.keys(opened.media[0]))}\n`);
assert.ok(!b13.includes('reply') && !b13.includes(alice.ed.x));
assert.deepEqual([opened.rel, Object.keys(opened.target), opened.target.hash, Object.keys(opened.media[0])], ['reply', ['key', 'number', 'hash', 'location'], address(post6), ['hash', 'key']]);
rule('6.5', `Inside the envelope, \`rel\` and \`target\` are as in §5, and each \`media\` entry is
\`{"hash": <listed hash>, "key": <base64url>}\` (§4.3).`);
