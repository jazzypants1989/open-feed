// §2.1–2.2, §2.5 — a signed file is its body bytes, one `\n`, and an Ed25519 signature over the
// body; its address is the SHA-256 of the body alone. Run: node examples/signed-file/signed-file.js
import assert from 'node:assert/strict';
import { rule } from '../../tools/rule.js';
import crypto from 'node:crypto';
import { signFile, splitFile, verifyFile, address, sha256, decodeStrict, signingKeyFromSeed } from '../../src/file.js';

// Appendix B's keys, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const alice = key('alice/anchor'), mum = key('mum');

const post = { n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' };
const file = signFile(post, alice);
const { body, sigLine } = splitFile(file);

console.log('§2.1 — three parts, and nothing else\n');
console.log(`  body       ${body}`);
console.log('  separator  one \\n byte');
console.log(`  signature  ${sigLine}`);
console.log(`\n  ${body.length} body bytes + 1 + ${sigLine.length} signature characters = ${file.length} bytes on the wire.`);
console.log('  That is Appendix B.6 of the spec, byte for byte.\n');
assert.equal(file.length, body.length + 1 + 86);
assert.equal(sigLine.length, 86);
assert.equal(body.toString(), '{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}');
assert.equal(sigLine, 'Pe6ZO_mwGsToFUaNh1sRuPI7kTastKn7qJ3KpXyPBupKLLJzuoZiAnfwUbXTxnULHkLkqevKxmU3q3xPj1ehDQ');
rule('2.1', 'A signed file is **its body bytes, one `\\n`, then the signature over the body**. The body MUST be a JSON\nobject encoded as UTF-8.');

// A verifier hands back the parsed object, the bytes it verified, the address, and which key signed.
const ok = verifyFile(file, [alice.x, mum.x]);
console.log('§2.1 — the signature says who, and nothing else does\n');
console.log(`  verified under  ${ok.by}  (alice's anchor key)`);
console.log(`  under mum       ${verifyFile(file, mum.x)}   — not a file, as far as mum's key is concerned`);
console.log('\n  A file is not "from alice" because of where it was served or what it claims.\n');
assert.equal(ok.by, alice.x);
assert.deepEqual(ok.obj, post);
assert.equal(verifyFile(file, mum.x), null);
rule('2.1', 'The signature MUST be Ed25519 (RFC 8032) over the body bytes exactly as served. A file is from the key\nthat verifies it, and from nothing else — not where it was served, not what it claims.');

// §2.1: the line must decode to 64 bytes AND re-encode to itself. The last character carries two
// unused bits, so a second spelling of the same 64 bytes exists — and is a different file.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const respelled = sigLine.slice(0, -1) + ALPHABET[ALPHABET.indexOf(sigLine.at(-1)) ^ 1];
const respelledFile = Buffer.concat([body, Buffer.from('\n'), Buffer.from(respelled)]);
console.log('§2.1 — 86 characters that re-encode to themselves\n');
console.log(`  signed      ...${sigLine.slice(-8)}`);
console.log(`  respelled   ...${respelled.slice(-8)}   same 64 bytes under a lenient decoder`);
console.log(`  verifies?   ${verifyFile(respelledFile, alice.x) !== null}\n`);
assert.equal(Buffer.from(respelled, 'base64url').compare(Buffer.from(sigLine, 'base64url')), 0);
assert.equal(decodeStrict(respelled, 64), null);
assert.equal(verifyFile(respelledFile, alice.x), null);
rule('2.1', 'The signature line MUST be exactly 86 base64url characters that round-trip: decoding to 64 bytes and\nre-encoding MUST produce the same characters. Base64 admits a second spelling of the same bytes, and\naccepting it means accepting a file that is not byte-identical to what the author signed.');

// §2.1: the split is at the LAST newline, which is unambiguous only because the body has none.
const newsy = signFile({ n: 2, text: 'line one\nline two' }, alice);
console.log('§2.1 — the body carries no raw newline, so "the last line" and "the line after the body" agree\n');
console.log(`  text            ${JSON.stringify('line one\nline two')}`);
console.log(`  body bytes      ${splitFile(newsy).body}`);
console.log(`  raw \\n in body? ${splitFile(newsy).body.includes(0x0a)}   the serializer escaped it\n`);
assert.equal(splitFile(newsy).body.includes(0x0a), false);
assert.equal(verifyFile(newsy, alice.x).obj.text, 'line one\nline two');
rule('2.1', 'The body MUST NOT contain a `\\n` byte. A verifier splits at the **last** `\\n` in the file, and this rule\nmakes "the line after the body" and "the last line" the same thing for every implementation.');

// §2.2: the address is the hash of the body, never of the file. mum signing the same body produces
// a different file at the same address — the address does not depend on who signed it, or how.
const mumsCopy = signFile(post, mum);
console.log('§2.2 — the address is the hash of the body\n');
console.log(`  SHA-256(body)   ${address(file)}`);
console.log(`  SHA-256(file)   ${sha256(file)}   not an address of anything`);
console.log(`\n  the same body signed by mum instead:`);
console.log(`  file bytes      differ (${sigLine.slice(0, 6)}... becomes ${splitFile(mumsCopy).sigLine.slice(0, 6)}...)`);
console.log(`  address         ${address(mumsCopy)}   identical`);
console.log('\n  Some standard libraries randomize Ed25519, so two honest signings of one body differ.');
console.log('  Hashing the whole file would make the address depend on which library signed it.\n');
assert.equal(address(file), sha256(body));
assert.notEqual(address(file), sha256(file));
assert.ok(!mumsCopy.equals(file));
assert.equal(address(mumsCopy), address(file));
rule('2.2', '**A file\'s address is the base64url SHA-256 of its body, never of the whole file.** Some standard\nlibraries produce randomized Ed25519 signatures, so two honest signings of one body are two files at\none address; hashing the whole file would make the address depend on which library signed it.');

// §2.5: unknown members are inside the signature, so they cannot be dropped without breaking it.
const extended = signFile({ ...post, _mood: 'sunny' }, alice);
const stripped = Buffer.concat([Buffer.from(JSON.stringify(post)), Buffer.from('\n'), Buffer.from(splitFile(extended).sigLine)]);
console.log('§2.5 — an unknown member is not yours to drop\n');
console.log(`  handed back     ${JSON.stringify(verifyFile(extended, alice.x).obj._mood)}`);
console.log(`  dropped by a store, then verified: ${verifyFile(stripped, alice.x)}\n`);
assert.equal(verifyFile(extended, alice.x).obj._mood, 'sunny');
assert.equal(verifyFile(stripped, alice.x), null);
rule('2.5', 'Unknown members MUST be preserved by anything that stores or forwards a file: they are inside the\nsignature, and a file without them is a file signed by nobody. Extension members SHOULD be prefixed\nwith `_`.');

console.log('Every line above is asserted.');
