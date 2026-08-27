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

test('§2.3 a hub that pretty-prints, reorders, or appends a newline makes the file read as forged', () => {
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

// ---- §2.4: the strict parser against JSON.parse, differentially ----
//
// docs/COMPARISON.md cites parser differentials as a known authorization-bypass class (Bishop Fox,
// 2021): two services reading one document and disagreeing about what it says. This parser exists
// because `JSON.parse` cannot express §2.4 — so the property that matters is not "it parses JSON",
// it is that it accepts a STRICT SUBSET of what `JSON.parse` accepts and agrees on the value wherever
// both accept. Anything it takes that `JSON.parse` refuses is a differential of our own making.
//
// Seeded, so a failure reproduces exactly. No Math.random.
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// The characters that decide a parse, over-weighted towards the ones that end one.
const SPICY = [...'{}[],:"\\/ \t\n\r0123456789.eE+-truefalsnul é😀', '\\u', '\\ud800', '\\udc00', '\\uD83D\\uDE00', '__proto__', '1e999', '9007199254740993', '-0'];

const shape = (r, depth = 0) => {
  const pick = r();
  if (depth > 3 || pick < 0.30) return [null, true, false, 0, -1, 1.5, 1e-7, 'x', '', 'é😀', 9007199254740991][Math.floor(r() * 11)];
  if (pick < 0.65) return Array.from({ length: Math.floor(r() * 4) }, () => shape(r, depth + 1));
  const o = {};
  for (let i = Math.floor(r() * 4); i > 0; i--) o[`k${Math.floor(r() * 6)}`] = shape(r, depth + 1);
  return o;
};

test('§2.4 fuzz: the strict parser accepts a subset of JSON.parse and never disagrees on a value', () => {
  const r = rng(20260827);
  let bothAccepted = 0, strictRefused = 0;
  for (let i = 0; i < 30_000; i++) {
    let s = JSON.stringify(shape(r));
    // Mutate: splice a spicy token in, cut a piece out, or duplicate a run.
    for (let edits = 1 + Math.floor(r() * 3); edits > 0; edits--) {
      const at = Math.floor(r() * (s.length + 1)), how = r();
      if (how < 0.55) s = s.slice(0, at) + SPICY[Math.floor(r() * SPICY.length)] + s.slice(at);
      else if (how < 0.85) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(r() * 3));
      else s = s.slice(0, at) + s.slice(at, at + 1 + Math.floor(r() * 6)) + s.slice(at);
    }

    let mine, mineThrew = false, theirs, theyThrew = false;
    try { mine = parseStrict(s); } catch { mineThrew = true; }
    try { theirs = JSON.parse(s); } catch { theyThrew = true; }

    if (!mineThrew && theyThrew) assert.fail(`the strict parser accepted what JSON.parse rejected: ${JSON.stringify(s)}`);
    if (!mineThrew && !theyThrew) {
      bothAccepted++;
      assert.deepStrictEqual(mine, theirs, `same bytes, two values: ${JSON.stringify(s)}`);
    }
    if (mineThrew && !theyThrew) strictRefused++;
  }
  // The run is only evidence if it exercised both sides of the boundary.
  assert.ok(bothAccepted > 1000, `only ${bothAccepted} inputs both parsers accepted`);
  assert.ok(strictRefused > 100, `only ${strictRefused} inputs JSON.parse took and §2.4 refused`);
});

test('§2.4 the four hazards, each rejected exactly where JSON.parse takes it', () => {
  for (const [text, why] of [
    ['{"a":1,"a":2}', 'duplicate member name'],
    ['{"__proto__":{"x":1}}', 'reserved member name'],
    ['{"n":9007199254740993}', 'outside'],
    ['{"s":"\\ud800"}', 'unpaired surrogate'],
  ]) {
    assert.doesNotThrow(() => JSON.parse(text), `${text} — JSON.parse is supposed to take this`);
    assert.throws(() => parseStrict(text), new RegExp(why), text);
  }
  // The near-misses, so the rules are not just "refuse anything interesting".
  for (const ok of ['{"a":1,"b":2}', '{"_proto_":1}', '{"n":9007199254740991}', '{"n":-9007199254740991}', '{"s":"\\ud83d\\ude00"}', '{"n":-0}', '{"n":1e-7}']) {
    assert.deepStrictEqual(parseStrict(ok), JSON.parse(ok), ok);
  }
});
