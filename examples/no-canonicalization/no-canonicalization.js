// §2.3 — the bytes served are the bytes signed. A host that pretty-prints, sorts members, or adds
// a trailing newline makes every file it touches read as forged.
// Run: node examples/no-canonicalization/no-canonicalization.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { signFile, splitFile, verifyFile, parseBody, signingKeyFromSeed } from '../../src/file.js';

const alice = signingKeyFromSeed(crypto.createHash('sha256').update('openfeed/v1/vector:alice/anchor').digest());
const post = { n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' };
const file = signFile(post, alice);
const { body, sigLine } = splitFile(file);
const refile = (text) => Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from('\n'), Buffer.from(sigLine)]);

// Three things an ordinary server, proxy, or template does without being asked.
const helpful = {
  'pretty-printed': JSON.stringify(post, null, 2).replace(/\n/g, ' '),
  'members sorted': JSON.stringify(Object.fromEntries(Object.keys(post).sort().map((k) => [k, post[k]]))),
  're-serialized': JSON.stringify(parseBody(body)),
};

console.log('§2.3 — the same object, three re-spellings\n');
console.log(`  as signed        ${body}\n`);
for (const [what, text] of Object.entries(helpful)) {
  const equal = isDeepStrictEqual(parseBody(Buffer.from(text)), post);
  const verifies = verifyFile(refile(text), alice.x) !== null;
  console.log(`  ${what.padEnd(16)}${text}`);
  console.log(`  ${''.padEnd(16)}same object: ${String(equal).padEnd(6)} verifies: ${verifies}\n`);
  assert.equal(equal, true, 'every re-spelling parses to the same object');
}
assert.equal(verifyFile(refile(helpful['pretty-printed']), alice.x), null);
assert.equal(verifyFile(refile(helpful['members sorted']), alice.x), null);
assert.ok(verifyFile(refile(helpful['re-serialized']), alice.x), 'this producer happens to round-trip');
console.log('  All three parse to the object alice signed. Two of them are not her file.');
console.log('  The third verifies only because this serializer happens to reproduce these bytes —');
console.log('  which is luck, not a rule, and the next case shows how thin the luck is.\n');

// A verifier that re-serialized would have to agree with every producer about spellings JSON
// leaves open. These parse equal to what they claim and come back different.
console.log('§2.3 — what a canonicalizing verifier would have to agree about\n');
for (const written of ['{"n":1.0}', '{"n":1e3}', '{"t":"caf\\u00e9"}', '{"t":"\\u0041"}']) {
  const round = JSON.stringify(parseBody(Buffer.from(written)));
  console.log(`  served ${written.padEnd(20)} re-serialized ${round.padEnd(12)} ${round === written ? 'same' : 'DIFFERENT'}`);
  assert.notEqual(round, written);
  assert.equal(verifyFile(refile(written), alice.x), null);
}
console.log('\n  Trailing zeros, exponents, escapes, and which characters get escaped at all: four');
console.log('  places two honest implementations diverge. Open Feed never re-serializes, so none');
console.log('  of them is a question it has to answer.\n');

// The trailing newline is worse than a changed byte: it moves the split.
const withNewline = Buffer.concat([file, Buffer.from('\n')]);
const split = splitFile(withNewline);
console.log('§2.3 — a trailing newline does not corrupt the file, it re-cuts it\n');
console.log('  one \\n appended, then split at the last \\n:');
console.log(`  body      ${split.body.length} bytes — the old body, the separator, and the signature`);
console.log(`  signature "${split.sigLine}" — empty`);
console.log(`  verifies  ${verifyFile(withNewline, alice.x) !== null}\n`);
assert.equal(split.body.length, body.length + 1 + sigLine.length);
assert.equal(split.sigLine, '');
assert.equal(verifyFile(withNewline, alice.x), null);

// The rule this puts on a hub (§8.7): serve back exactly what was written.
const proxies = {
  'byte-for-byte': (b) => b,
  'adds a newline': (b) => Buffer.concat([b, Buffer.from('\n')]),
  'pretty-prints': (b) => refile(JSON.stringify(parseBody(splitFile(b).body), null, 1).replace(/\n/g, ' ')),
};
console.log('§8.7 — the same rule, seen from the hub\n');
for (const [name, proxy] of Object.entries(proxies)) {
  const read = verifyFile(proxy(file), alice.x);
  console.log(`  a hub that ${name.padEnd(16)} → the reader sees ${read ? "alice's post" : 'a file signed by nobody'}`);
  assert.equal(read !== null, name === 'byte-for-byte');
}
console.log('\n  A hub cannot regenerate a file from a database row. It stores bytes and returns them.');
console.log('  That is the whole cost of having no canonicalizer, and the hub pays it once.\n');

console.log('Every line above is asserted.');
