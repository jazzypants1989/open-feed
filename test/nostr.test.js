// Nostr bridge: BIP-340 Schnorr signatures, NIP-01 events, NIP-48 proxy tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { schnorrSign, schnorrPubkey, newNostrKey } from '../bridge/schnorr.js';
import { createEvent, profileEvent, noteEvent, eventsFromRead, relayMessage } from '../bridge/nostr.js';
import { createHub } from '../src/hub.js';
import { encrypt, postBinding, newReadingKey } from '../src/openfeed.js';
import { memIo, readerOver, person, list, claim } from './helpers/site.js';

// ---- BIP-340 test vectors ----

test('BIP-340: test vector 0 — signing produces correct R and s', () => {
  const privkey = Buffer.from('0000000000000000000000000000000000000000000000000000000000000003', 'hex');
  const pubkey = schnorrPubkey(privkey);
  assert.equal(pubkey.toString('hex'), 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9');
});

test('BIP-340: pubkey derivation for known private keys', () => {
  const priv1 = Buffer.from('0000000000000000000000000000000000000000000000000000000000000001', 'hex');
  const pub1 = schnorrPubkey(priv1);
  assert.equal(pub1.toString('hex'), '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
});

test('BIP-340: sign and verify round-trip', () => {
  const key = newNostrKey();
  const msg = crypto.createHash('sha256').update('test message').digest();
  const sig = schnorrSign(msg, key.privateKey);
  assert.equal(sig.length, 64);
  assert.equal(key.pubkey.length, 64);
});

test('BIP-340: different messages produce different signatures', () => {
  const key = newNostrKey();
  const msg1 = crypto.createHash('sha256').update('message 1').digest();
  const msg2 = crypto.createHash('sha256').update('message 2').digest();
  const sig1 = schnorrSign(msg1, key.privateKey);
  const sig2 = schnorrSign(msg2, key.privateKey);
  assert.notDeepEqual(sig1, sig2);
});

// ---- NIP-01 events ----

const AT = 'https://hub.example/alice';

async function setup(posts = []) {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  const pub = await claim(io, alice, AT, { recovery: list() });
  for (const [n, body] of posts) await pub.publish(n, body);
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  assert.equal(read.verdict, 'ok', read.why);
  return { hub, io, alice, pub, read };
}

test('NIP-01: event has required fields', () => {
  const key = newNostrKey();
  const event = createEvent(1, 'hello', [], { privateKey: key.privateKey });
  assert.equal(typeof event.id, 'string');
  assert.equal(event.id.length, 64);
  assert.equal(typeof event.pubkey, 'string');
  assert.equal(event.pubkey.length, 64);
  assert.equal(typeof event.created_at, 'number');
  assert.equal(event.kind, 1);
  assert.deepEqual(event.tags, []);
  assert.equal(event.content, 'hello');
  assert.equal(typeof event.sig, 'string');
  assert.equal(event.sig.length, 128);
});

test('NIP-01: event id is SHA256 of serialized [0, pubkey, created_at, kind, tags, content]', () => {
  const key = newNostrKey();
  const event = createEvent(1, 'test', [['t', 'hello']], { privateKey: key.privateKey });
  const expected = crypto.createHash('sha256')
    .update(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]))
    .digest('hex');
  assert.equal(event.id, expected);
});

test('NIP-48: note events include proxy tag', async () => {
  const { read } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'hello' }]]);
  const key = newNostrKey();
  const event = noteEvent(read.posts.get(1), 1, read, AT, { privateKey: key.privateKey });
  const proxy = event.tags.find(t => t[0] === 'proxy');
  assert.ok(proxy);
  assert.equal(proxy[1], `${AT}/posts/1`);
  assert.equal(proxy[2], 'openfeed');
});

test('NIP-01: reply post includes e and p tags from target', async () => {
  const { read } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'nice', rel: 'reply',
    target: { key: 'targetkey', number: 5, hash: 'h', location: 'https://bob.example/bob' } }]]);
  const key = newNostrKey();
  const event = noteEvent(read.posts.get(1), 1, read, AT, { privateKey: key.privateKey });
  assert.ok(event.tags.some(t => t[0] === 'e'));
  assert.ok(event.tags.some(t => t[0] === 'p' && t[1] === 'targetkey'));
});

test('eventsFromRead: profile + public posts, encrypted omitted', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), bob = person('bob');
  const aliceRead = newReadingKey(), bobRead = newReadingKey();
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'public' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', encrypted: encrypt({
    content: { text: 'secret' },
    audience: [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: bob.key.x, read: bobRead.x, location: 'https://bob.example/bob' }],
    binding: postBinding(alice.key.x, 2),
  }) });
  await pub.publish(3, { at: '2026-08-03T00:00:00Z', text: 'also public' });
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  const key = newNostrKey();
  const events = eventsFromRead(read, AT, { privateKey: key.privateKey });
  assert.equal(events.length, 3, 'profile + 2 public posts');
  assert.equal(events[0].kind, 0, 'first event is profile');
  assert.equal(events[1].kind, 1);
  assert.equal(events[2].kind, 1);
  assert.equal(events[1].content, 'public');
  assert.equal(events[2].content, 'also public');
});

test('relayMessage: wraps event in NIP-01 EVENT array', () => {
  const key = newNostrKey();
  const event = createEvent(1, 'hi', [], { privateKey: key.privateKey });
  const msg = relayMessage(event);
  const parsed = JSON.parse(msg);
  assert.equal(parsed[0], 'EVENT');
  assert.equal(parsed[1].content, 'hi');
});

test('profileEvent: kind 0 with name from read', async () => {
  const { read } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]]);
  const key = newNostrKey();
  const event = profileEvent(read, AT, { privateKey: key.privateKey });
  assert.equal(event.kind, 0);
  const profile = JSON.parse(event.content);
  assert.equal(profile.name, 'alice');
  assert.ok(profile.about.includes(AT));
});
