// §6 — the envelope: post binding, blinded tags, §2.4 inside, the audience inside; §4.4 encrypted media.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encrypt, decrypt, postBinding, newReadingKey, encryptMedia, decryptMedia } from '../src/envelope.js';
import { newSigningKey } from '../src/file.js';

const alice = { key: newSigningKey(), read: newReadingKey() }, mum = { key: newSigningKey(), read: newReadingKey() }, host = newReadingKey();
const entry = (p, location) => ({ key: p.key.x, read: p.read.x, location });
const fam = [entry(alice, 'https://a.example/a'), entry(mum, 'https://m.example/m')];
const binding = postBinding(alice.key.x, 5);

test('§6.1 a encrypted post opens for each recipient, with the audience naming people inside', () => {
  const env = encrypt({ content: { text: 'leaving on friday', rel: 'root' }, audience: fam,  binding });
  const inner = decrypt(env, mum.read.privateKey,  binding);
  assert.equal(inner.text, 'leaving on friday');
  assert.deepEqual(inner.audience, fam);
  assert.equal(decrypt(env, alice.read.privateKey,  binding).rel, 'root');
  assert.equal(decrypt(env, host.privateKey,  binding), null, 'the host opens nothing');
});

test('§6.2 post binding: the envelope lifted into another post does not open', () => {
  const env = encrypt({ content: { text: 'x' }, audience: fam,  binding });
  assert.equal(decrypt(env, mum.read.privateKey, postBinding(newSigningKey().x, 1)), null);
  assert.equal(decrypt(env, mum.read.privateKey, postBinding(alice.key.x, 6)), null);
  assert.throws(() => encrypt({ content: {}, audience: fam, binding: '' }), /binding/);
});

test('§6.3 a tag is a hint: a malformed or colliding slot is skipped, never a crash', () => {
  const env = encrypt({ content: { text: 'x' }, audience: fam,  binding });
  const hostile = { ...env, slots: [['AAAA', 'junk'], ['', ''], [null, 1], ...env.slots] };
  assert.equal(decrypt(hostile, mum.read.privateKey,  binding).text, 'x');
  assert.equal(decrypt({ ephemeral: 'nonsense', slots: [], ciphertext: '' }, mum.read.privateKey,  binding), null);
  assert.equal(decrypt(null, mum.read.privateKey,  binding), null);
});

test('§6.3 tags are blinded per message: the same recipient\'s tag differs on every post', () => {
  const a = encrypt({ content: { text: 'x' }, audience: fam,  binding }), b = encrypt({ content: { text: 'x' }, audience: fam,  binding });
  assert.equal(new Set([...a.slots, ...b.slots].map(([t]) => t)).size, 4);
});

test('§6.1 one slot per recipient, all the same width, and the ciphertext is the plaintext\'s length plus the tag', () => {
  const dm = encrypt({ content: { text: 'call me' }, audience: [fam[1]],  binding }), family = encrypt({ content: { text: 'call me' }, audience: fam,  binding });
  assert.equal(dm.slots.length, 1); assert.equal(family.slots.length, 2);
  assert.equal(new Set(family.slots.map(([t, w]) => `${t.length}/${w.length}`)).size, 1);
  const plain = Buffer.from(JSON.stringify({ audience: [fam[1]], text: 'call me' }));
  assert.equal(Buffer.from(dm.ciphertext, 'base64url').length, plain.length + 16);
});

test('§6.1 / §2.4 the rules for a body hold inside the envelope: a producer refuses to emit them, a reader refuses to open them', () => {
  assert.throws(() => encrypt({ content: { number: 2 ** 53 }, audience: fam,  binding }), /2\^53/);
  assert.throws(() => encrypt({ content: { text: '\ud800' }, audience: fam,  binding }), /surrogate/);
  assert.throws(() => encrypt({ content: { ['__proto__']: { text: 'x' } }, audience: fam,  binding }), /__proto__/);
  const env = encrypt({ content: { text: 'x' }, audience: fam,  binding });
  assert.equal(decrypt(env, mum.read.privateKey,  binding).text, 'x');
});

test('§6.4 the audience must name people, and the publisher includes itself', () => {
  assert.throws(() => encrypt({ content: {}, audience: [mum.read.x],  binding }), /audience entries/);
  const env = encrypt({ content: { text: 'to mum only' }, audience: [fam[1]],  binding });
  assert.equal(decrypt(env, alice.read.privateKey,  binding), null, 'a publisher that leaves itself out cannot read its own outbox');
});

test('§4.4 a encrypted media file: random key, the listed hash is the ciphertext\'s, the key travels in the envelope', () => {
  const png = Buffer.from('\x89PNG a tiny png');
  const { bytes, hash, key } = encryptMedia(png);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('base64url'), hash);
  assert.equal(decryptMedia(bytes, key).compare(png), 0);
  assert.equal(decryptMedia(bytes, encryptMedia(png).key), null);
  const env = encrypt({ content: { text: 'look', media: [{ hash, key }] }, audience: fam,  binding });
  assert.equal(decrypt(env, mum.read.privateKey,  binding).media[0].key, key);
});
