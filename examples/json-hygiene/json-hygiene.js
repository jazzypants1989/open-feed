// §2.4 — the four things `JSON.parse` cannot see, each of them a way two readers disagree about
// what one signed body says. Run: node examples/json-hygiene/json-hygiene.js
import assert from 'node:assert/strict';
import { rule } from '../../tools/rule.js';
import crypto from 'node:crypto';
import { signFile, verifyFile, parseStrict, parseBody, signingKeyFromSeed, FileError } from '../../src/file.js';

const alice = signingKeyFromSeed(crypto.createHash('sha256').update('openfeed/v1/vector:alice/anchor').digest());
const strict = (text) => { try { return `parsed ${JSON.stringify(parseStrict(text))}`; } catch (e) { return `rejected: ${e.message.replace(/ at offset \d+$/, '')}`; } };

const cases = [
  ['a duplicate member', '{"n":1,"n":2}', 'which post is this?'],
  ['__proto__ as a member', '{"__proto__":{"n":9}}', 'a member that is not data'],
  ['an integer past 2^53', '{"n":9007199254740993}', 'a number that is not the number'],
  ['a lone surrogate', '{"text":"\\ud800"}', 'a string that is not the string'],
];

console.log('§2.4 — four bodies `JSON.parse` accepts\n');
for (const [what, text, why] of cases) {
  console.log(`  ${what}  — ${why}`);
  console.log(`    body          ${text}`);
  console.log(`    JSON.parse    ${JSON.stringify(JSON.parse(text))}`);
  console.log(`    §2.4 parser   ${strict(text)}\n`);
  assert.throws(() => parseStrict(text), FileError, what);
}

// Each one is a disagreement, not an untidiness. The body is signed: every reader gets these bytes.
console.log('  Nothing in JSON says which duplicate wins — this parser keeps the last, others keep');
console.log('  the first — so one signed body can be post 1 to you and post 2 to me. The integer is');
console.log('  worse: no reader is even given the choice.\n');
assert.equal(JSON.parse('{"n":1,"n":2}').n, 2);
assert.equal(JSON.parse('{"n":9007199254740993}').n, 9007199254740992);
console.log(`  served 9007199254740993 → JSON.parse gives ${JSON.parse('{"n":9007199254740993}').n}, silently, and a post`);
console.log('  number is what the index admits and what a reply targets (§4.1, §5.1).\n');

// A lone surrogate is a string no encoder can round-trip: re-encoding replaces it.
const lone = JSON.parse('{"text":"\\ud800"}').text;
console.log('§2.4 — the lone surrogate, in bytes\n');
console.log('  parsed string   1 UTF-16 unit, 0xd800, half of a pair');
console.log(`  re-encoded      ${Buffer.from(lone, 'utf8').toString('hex')}  (U+FFFD — the replacement character)`);
console.log('  Two readers that display, index, or re-encode it hold different text.\n');
assert.equal(Buffer.from(lone, 'utf8').toString('hex'), 'efbfbd');
assert.equal(lone.length, 1);

// The rule is asymmetric: only the author can sign, so a producer that never emits one of these
// closes the question. `signFile` parses its own serialization before signing it (§2.4's producer half).
console.log('§2.4 — the producer half: a signer refuses to emit what a reader would reject\n');
for (const [what, obj] of [['__proto__', { ['__proto__']: 1 }], ['an integer past 2^53', { n: 2 ** 53 }], ['a lone surrogate', { text: '\ud800' }]]) {
  let refused = null;
  try { signFile(obj, alice); } catch (e) { refused = e.message.replace(/ at offset \d+$/, ''); }
  console.log(`  ${what.padEnd(21)} ${refused}`);
  assert.ok(refused, what);
}
rule('2.4', 'A producer MUST NOT emit a body containing a duplicate member name, a member named `__proto__`, an\ninteger outside ±(2^53 − 1), or an unpaired UTF-16 surrogate. `JSON.parse` and its equivalents cannot\nsee the first, treat the second as data, silently round the third, and accept the fourth — four ways\ntwo readers can disagree about what one signed body says. A reader SHOULD reject a body containing any\nof them.');
console.log('\n  A duplicate member has no fourth line here: a JavaScript object cannot hold one, and');
console.log('  no serializer emits one. That is the shape of all four — unreachable by accident,');
console.log('  reachable on purpose, which is why the reader checks anyway.\n');

// `__proto__` is the exception, because a rejecting reader is not the only safe reader.
const parsed = JSON.parse('{"__proto__":{"n":9}}');
const copied = Object.assign({}, parsed);
console.log('§2.4 — why `__proto__` is called out separately\n');
console.log(`  JSON.parse gives an own member named __proto__, harmless until something copies it:`);
console.log(`  Object.assign({}, parsed).n   ${copied.n}   — inherited, with no own member named n`);
console.log(`  own member?                   ${Object.hasOwn(copied, 'n')}`);
console.log(`  §2.4 parser                   ${strict('{"__proto__":{"n":9}}')}`);
console.log('  A reader that does not reject it MUST at least parse into an object it does not');
console.log('  inherit from — Object.create(null) — so a member never arrives from a prototype.\n');
assert.equal(copied.n, 9);
assert.equal(Object.hasOwn(copied, 'n'), false);
assert.equal(Object.create(null).n, undefined);
rule('2.4', 'A reader that does not reject `__proto__` MUST at least parse into an object it does not inherit from.');

// What survives: everything JSON legitimately says — including the largest safe integer, and an
// emoji spelled either way. Which spelling is signed is settled by §2.3: whichever one was served.
const escaped = '{"n":9007199254740991,"text":"the peonies \\ud83d\\udc90 came back"}';
const literal = JSON.stringify(parseBody(Buffer.from(escaped)));
console.log('§2.4 — and everything else is ordinary JSON\n');
console.log(`  escaped   ${escaped}`);
console.log(`  literal   ${literal}`);
console.log(`  same object: ${parseStrict(escaped).text === parseStrict(literal).text}   same file: false — §2.3 signs the bytes, not the object\n`);
assert.equal(parseStrict(escaped).n, 9007199254740991);
assert.equal(parseStrict(escaped).text, 'the peonies \u{1f490} came back');
assert.equal(parseStrict(escaped).text, parseStrict(literal).text);
assert.notEqual(escaped, literal);
assert.equal(verifyFile(Buffer.concat([Buffer.from(escaped), Buffer.from('\n'), signFile(parseStrict(literal), alice).subarray(-86)]), alice.x), null);

console.log('Every line above is asserted.');
