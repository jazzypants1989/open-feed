// §7 — the envelope: carrier binding, blinded tags, padding, the audience inside; §5.4 sealed photos.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { seal, open, carrierOf, newReadingKey, sealPhoto, openPhoto, bucket, MAX_PLAIN } from '../src2/envelope.js';
import { newSigningKey } from '../src2/file.js';

const alice = { key: newSigningKey(), read: newReadingKey() }, mum = { key: newSigningKey(), read: newReadingKey() }, host = newReadingKey();
const entry = (p, loc) => ({ key: p.key.x, read: p.read.x, loc });
const fam = [entry(alice, 'https://a.example/a'), entry(mum, 'https://m.example/m')];
const carrier = carrierOf(alice.key.x, 5);

test('§7.1 a sealed post opens for each recipient, with the audience naming people inside', () => {
  const env = seal({ content: { text: 'leaving on friday', rel: 'root' }, audience: fam, carrier });
  const inner = open(env, mum.read.privateKey, carrier);
  assert.equal(inner.text, 'leaving on friday');
  assert.deepEqual(inner.audience, fam);
  assert.equal(open(env, alice.read.privateKey, carrier).rel, 'root');
  assert.equal(open(env, host.privateKey, carrier), null, 'the host opens nothing');
});

test('§7.2 carrier binding: the envelope lifted into another post does not open', () => {
  const env = seal({ content: { text: 'x' }, audience: fam, carrier });
  assert.equal(open(env, mum.read.privateKey, carrierOf(newSigningKey().x, 1)), null);
  assert.equal(open(env, mum.read.privateKey, carrierOf(alice.key.x, 6)), null);
  assert.throws(() => seal({ content: {}, audience: fam, carrier: '' }), /carrier/);
});

test('§7.3 a tag is a hint: a malformed or colliding slot is skipped, never a crash', () => {
  const env = seal({ content: { text: 'x' }, audience: fam, carrier });
  const hostile = { ...env, slots: [['AAAA', 'junk'], ['', ''], [null, 1], ...env.slots] };
  assert.equal(open(hostile, mum.read.privateKey, carrier).text, 'x');
  assert.equal(open({ epk: 'nonsense', slots: [], ct: '' }, mum.read.privateKey, carrier), null);
  assert.equal(open(null, mum.read.privateKey, carrier), null);
});

test('§7.3 tags are blinded per message: the same recipient\'s tag differs on every post', () => {
  const a = seal({ content: { text: 'x' }, audience: fam, carrier }), b = seal({ content: { text: 'x' }, audience: fam, carrier });
  assert.equal(new Set([...a.slots, ...b.slots].map(([t]) => t)).size, 16);
});

test('§7.4 padding: a DM is the size of a family post under the floor; dummies are random and uniform in width', () => {
  const dm = seal({ content: { text: 'call me' }, audience: [fam[1]], carrier }), family = seal({ content: { text: 'the scan came back clear, and more words here to make it longer' }, audience: fam, carrier });
  assert.equal(dm.slots.length, 8); assert.equal(family.slots.length, 8);
  assert.equal(dm.ct.length, family.ct.length);
  assert.equal(new Set(dm.slots.map(([t, w]) => `${t.length}/${w.length}`)).size, 1);
  const again = seal({ content: { text: 'call me' }, audience: [fam[1]], carrier });
  assert.notDeepEqual(dm.slots.slice(1), again.slots.slice(1), 'dummies differ between two seals — nothing derives them');
  assert.equal(seal({ content: { text: 'x' }, audience: fam, carrier, policy: 'pow2' }).slots.length, 2);
  assert.equal(bucket(513, 512), 1024); assert.equal(bucket(3, 8), 8);
});

test('§7.1 the two-byte length caps the plaintext at 65,535 bytes, and a length past the body does not open', () => {
  assert.throws(() => seal({ content: { text: 'x'.repeat(70000) }, audience: fam, carrier }), RangeError);
  const room = MAX_PLAIN - JSON.stringify({ audience: fam, text: '' }).length;
  assert.ok(seal({ content: { text: 'x'.repeat(room) }, audience: fam, carrier }));
  const env = seal({ content: { text: 'x' }, audience: fam, carrier, policy: 'pow2' });
  assert.equal(open(env, mum.read.privateKey, carrier).text, 'x');
});

test('§7.5 the audience must name people, and the publisher includes itself', () => {
  assert.throws(() => seal({ content: {}, audience: [mum.read.x], carrier }), /audience entries/);
  const env = seal({ content: { text: 'to mum only' }, audience: [fam[1]], carrier });
  assert.equal(open(env, alice.read.privateKey, carrier), null, 'a publisher that leaves itself out cannot read its own outbox');
});

test('§5.4 a sealed photo: random key, the listed hash is the ciphertext\'s, the key travels in the envelope', () => {
  const photo = Buffer.from('\x89PNG a tiny photo');
  const { bytes, hash, key } = sealPhoto(photo);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('base64url'), hash);
  assert.equal(openPhoto(bytes, key).compare(photo), 0);
  assert.equal(openPhoto(bytes, sealPhoto(photo).key), null);
  const env = seal({ content: { text: 'look', media: [{ hash, key }] }, audience: fam, carrier });
  assert.equal(open(env, mum.read.privateKey, carrier).media[0].key, key);
});
