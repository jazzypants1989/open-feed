// §2 — files: body + `\n` + signature; the address; the four paths; bytes served are bytes signed;
// the four JSON hazards; unknown members. Run: node examples/files/files.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { rule } from '../../tools/rule.js';
import { signFile, splitFile, verifyFile, address, sha256, decodeStrict, parseStrict, parseBody, signingKeyFromSeed, FileError } from '../../src/file.js';
import { signProfile, commit } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createReader } from '../../src/reader.js';

// The test vectors' keys, so every byte printed here is one an implementer can check against.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const alice = key('alice/anchor'), mum = key('mum');
const post = { n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' };
const file = signFile(post, alice);
const { body, sigLine } = splitFile(file);
const refile = (text, sig = sigLine) => Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from('\n'), Buffer.from(sig)]);

// ---- §2.1 the format ----
console.log('§2.1 — three parts\n');
console.log(`  body       ${body}`);
console.log('  separator  one \\n byte');
console.log(`  signature  ${sigLine}\n`);
assert.equal(file.length, body.length + 1 + 86);
assert.equal(body.toString(), '{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}');
assert.equal(verifyFile(file, alice.x).by, alice.x);
assert.equal(verifyFile(file, mum.x), null);

// A newline inside a string is the two characters `\n`; compact JSON never holds the raw byte, so
// splitting the file at its last raw `\n` is unambiguous.
const newsy = signFile({ n: 2, text: 'line one\nline two' }, alice);
assert.equal(splitFile(newsy).body.includes(0x0a), false);
assert.equal(verifyFile(newsy, alice.x).obj.text, 'line one\nline two');

// The last of the 86 characters carries two unused bits, so a second spelling decodes to the same
// 64 bytes. It must not verify: it is not the file the author signed.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const respelled = sigLine.slice(0, -1) + ALPHABET[ALPHABET.indexOf(sigLine.at(-1)) ^ 1];
assert.equal(Buffer.from(respelled, 'base64url').compare(Buffer.from(sigLine, 'base64url')), 0);
assert.equal(decodeStrict(respelled, 64), null);
assert.equal(verifyFile(refile(body, respelled), alice.x), null);
console.log(`  respelled   ...${respelled.slice(-4)} decodes to the same bytes as ...${sigLine.slice(-4)} and does not verify\n`);
rule('2.1', `A signed file is its body, one \`\\n\` byte, then the signature. The body MUST be a JSON object encoded as
UTF-8 and serialized without whitespace, so it contains no raw \`\\n\` (a newline inside a string is the
two characters \`\\n\`); a verifier splits the file at its last \`\\n\`. The signature MUST be Ed25519 over
the body bytes, encoded as exactly 86 base64url characters that decode to 64 bytes and re-encode to
the same 86 characters.`);

// ---- §2.2 the address ----
const mumsCopy = signFile(post, mum);
const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1');
console.log('§2.2 — the address\n');
console.log(`  SHA-256(body)   ${address(file)}`);
console.log(`  same body, signed by mum: a different file at the same address\n`);
assert.equal(address(file), sha256(body));
assert.ok(!mumsCopy.equals(file));
assert.equal(address(mumsCopy), address(file));
rule('2.2', `A file's address is the base64url SHA-256 of its body. A media file's address is the SHA-256 of its
bytes.`);

// ---- §2 the four paths ----
// A reader given a location asks for exactly these, and nothing else.
const AT = 'https://alice.example/alice';
const REC = commit([{ key: mum, salt: 'saltmum' }]);
const profile = signProfile({ anchor: alice.x, version: 1, name: 'Alice', chain: [{ key: alice.x }], recovery: REC, locations: [AT] }, alice);
const index = signIndex({ entries: [[1, address(file)], [sha256(png)]], version: 1, top: 1 }, alice);
const served = new Map([[`${AT}/profile`, profile], [`${AT}/index`, index], [`${AT}/posts/1`, file], [`${AT}/media/${sha256(png)}`, png]]);
const asked = [];
const reader = createReader({ get: async (u) => { asked.push(u); return served.has(u) ? { bytes: served.get(u) } : null; } });
const r = await reader.read({ learned: alice.x, at: AT });
console.log('§2 — what a read asks for\n');
for (const u of asked) console.log(`  GET ${u}`);
console.log();
assert.equal(r.verdict, 'ok');
assert.deepEqual(asked, [...served.keys()]);
rule('2', `Everything on the wire is one of four kinds of file, under a name the writer claims (§8.4):

| kind | path | overwritten? | signed by |
|---|---|---|---|
| profile | \`/<name>/profile\` | yes, compare-and-swap | the current key — the key the chain ends on |
| index | \`/<name>/index\` | yes, compare-and-swap | the current key |
| post | \`/<name>/posts/<n>\` | no, created once | any key in the chain |
| media | \`/<name>/media/<hash>\` | no | not signed; admitted by being listed in the index |`);

// ---- §2.3 no canonicalization ----
// Pretty-printing, sorting members, re-serializing, a trailing newline: the same object, not the file.
console.log('§2.3 — re-spellings of the signed object\n');
const respellings = {
  'pretty-printed': JSON.stringify(post, null, 2).replace(/\n/g, ' '),
  'members sorted': JSON.stringify(Object.fromEntries(Object.keys(post).sort().map((k) => [k, post[k]]))),
  'number spelled 1.0': body.toString().replace('"n":1', '"n":1.0'),
};
for (const [what, text] of Object.entries(respellings)) {
  assert.ok(isDeepStrictEqual(parseBody(Buffer.from(text)), post));
  assert.equal(verifyFile(refile(text), alice.x), null);
  console.log(`  ${what.padEnd(20)} same object, does not verify`);
}
const withNewline = Buffer.concat([file, Buffer.from('\n')]);
assert.equal(splitFile(withNewline).sigLine, '');
assert.equal(verifyFile(withNewline, alice.x), null);
console.log(`  trailing newline     re-cuts the file: the signature line is empty\n`);
rule('2.3', `The bytes served are the bytes signed. A producer signs what it serialized; a verifier verifies what it
received; neither re-serializes.`);

// ---- §2.4 JSON hygiene ----
console.log('§2.4 — four bodies JSON.parse accepts and a §2.4 parser rejects\n');
const hazards = [
  ['a duplicate member', '{"n":1,"n":2}'],
  ['__proto__ as a member', '{"__proto__":{"n":9}}'],
  ['an integer past 2^53', '{"n":9007199254740993}'],
  ['a lone surrogate', '{"text":"\\ud800"}'],
];
for (const [what, text] of hazards) {
  JSON.parse(text);
  assert.throws(() => parseStrict(text), FileError, what);
  console.log(`  ${what.padEnd(24)} ${text}`);
}
assert.equal(JSON.parse('{"n":1,"n":2}').n, 2);                            // another parser keeps the first
assert.equal(JSON.parse('{"n":9007199254740993}').n, 9007199254740992);    // rounded, silently
for (const obj of [{ ['__proto__']: 1 }, { n: 2 ** 53 }, { text: '\ud800' }]) assert.throws(() => signFile(obj, alice));
console.log('\n  a §2.4 producer refuses to sign any of them\n');
const copied = Object.assign({}, JSON.parse('{"__proto__":{"n":9}}'));
assert.equal(copied.n, 9);
assert.equal(Object.hasOwn(copied, 'n'), false);
assert.equal(Object.create(null).n, undefined);
rule('2.4', `A producer MUST NOT emit a duplicate member name, a member named \`__proto__\`, an integer outside
±(2^53 − 1), or an unpaired UTF-16 surrogate. A reader SHOULD reject a body containing any of them, and
one that accepts \`__proto__\` MUST parse into an object that does not inherit from it.`);

// ---- §2.5 unknown members ----
const extended = signFile({ ...post, _mood: 'sunny' }, alice);
const stripped = refile(JSON.stringify(post), splitFile(extended).sigLine);
console.log('§2.5 — an unknown member, dropped by a store\n');
assert.equal(verifyFile(extended, alice.x).obj._mood, 'sunny');
assert.equal(verifyFile(stripped, alice.x), null);
console.log(`  with _mood: verifies   without: signed by nobody\n`);
rule('2.5', `Unknown members MUST be preserved; they are inside the signature. Extension members SHOULD begin
with \`_\`.`);
