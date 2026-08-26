// §2 — the file format, addresses, no canonicalization, JSON hygiene.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signFile, verifyFile, address, decodeStrict, parseStrict, parseBody, newSigningKey, sha256, splitFile } from '../src/file.js';

const k = newSigningKey();
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

test('§2.1 a file is body, one newline, an 86-character signature over the body', () => {
  const f = signFile({ number: 1, text: 'hi' }, k);
  const { body, sigLine } = splitFile(f);
  assert.equal(body.toString(), '{"number":1,"text":"hi"}');
  assert.equal(sigLine.length, 86);
  assert.ok(verifyFile(f, k.x));
  assert.equal(verifyFile(f, newSigningKey().x), null);
});

test('§2.1 the signature line must re-encode to itself — a second spelling of the same bytes is refused', () => {
  const f = signFile({ a: 1 }, k);
  const { body, sigLine } = splitFile(f);
  // The last character carries two unused bits; another character with the same top bits decodes
  // to the same 64 bytes under a lenient decoder and is a different file.
  const i = ALPHABET.indexOf(sigLine.at(-1)), alt = ALPHABET[i ^ 1];
  const spelled = sigLine.slice(0, -1) + alt;
  assert.equal(Buffer.from(spelled, 'base64url').compare(Buffer.from(sigLine, 'base64url')), 0, 'same bytes under the lenient decoder');
  assert.equal(verifyFile(Buffer.concat([body, Buffer.from('\n'), Buffer.from(spelled)]), k.x), null);
  assert.equal(decodeStrict(spelled, 64), null);
  assert.equal(decodeStrict('A'.repeat(85), 64), null);
});

test('§2.2 the address is the hash of the body, never of the file', () => {
  const f = signFile({ a: 1 }, k);
  assert.equal(address(f), sha256(splitFile(f).body));
  assert.notEqual(address(f), sha256(f));
});

test('§2.3 a host that pretty-prints, reorders, or appends a newline makes the file read as forged', () => {
  const f = signFile({ a: 1, b: 2 }, k);
  const { sigLine } = splitFile(f);
  for (const body of ['{"a": 1, "b": 2}', '{"b":2,"a":1}', '{"a":1,"b":2}\n']) {
    assert.equal(verifyFile(Buffer.concat([Buffer.from(body), Buffer.from('\n'), Buffer.from(sigLine)]), k.x), null, body);
  }
});

test('§2.4 the parser rejects duplicate members, __proto__, integers past 2^53, lone surrogates, raw controls', () => {
  assert.throws(() => parseStrict('{"a":1,"a":2}'), /duplicate/);
  assert.throws(() => parseStrict('{"__proto__":{"x":1}}'), /reserved/);
  assert.throws(() => parseStrict('{"number":9007199254740993}'), /outside/);
  assert.throws(() => parseStrict('{"s":"\\ud800"}'), /surrogate/);
  assert.throws(() => parseStrict('{"s":"a\tb"}'), /control/);
  assert.deepEqual(parseStrict('{"number":9007199254740991,"f":1.5e3,"s":"\\ud83d\\ude00"}'), { number: 9007199254740991, f: 1500, s: '😀' });
  assert.equal(JSON.parse('{"a":1,"a":2}').a, 2);           // JSON.parse sees none of the first three
});

test('§2.1 a body with a BOM, a newline, invalid UTF-8, or a non-object is not a body', () => {
  assert.throws(() => parseBody(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}')])), /byte-order/);
  assert.throws(() => parseBody(Buffer.from('{"a":\n1}')), /newline/);
  assert.throws(() => parseBody(Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d])), /UTF-8/);
  assert.throws(() => parseBody(Buffer.from('[1]')), /object/);
  assert.deepEqual(parseBody(Buffer.from('{"t":"a\\nb"}')), { t: 'a\nb' });      // escaped is fine
  assert.ok(signFile({ t: 'a\nb' }, k), 'a serializer escapes it, so a producer never emits a raw newline');
});

test('§2.5 unknown members survive: they are inside the signature and the verifier hands them back', () => {
  const f = signFile({ number: 1, _mood: 'sunny' }, k);
  assert.equal(verifyFile(f, k.x).obj._mood, 'sunny');
});
