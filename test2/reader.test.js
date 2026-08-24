// §8 — the composed reader over the in-memory hub: the order, the three verdicts, the notes, the
// rumor rule. Most scenarios run twice — cold and pinned — because pinning is what §8 is about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src2/hub.js';
import { createPublisher } from '../src2/publish.js';
import { signFile, address, splitFile } from '../src2/file.js';
import { rotation, restore, signProfile } from '../src2/profile.js';
import { signHead } from '../src2/head.js';
import { memIo, readerOver, person, list, claim } from './helpers/site2.js';

async function scene() {
  const hub = createHub(), io = memIo(hub), alice = person('alice'), mum = person('mum'), sis = person('sis'), ex = person('ex');
  const REC = list(2, mum, sis, ex), AT = 'https://x/alice';
  const pub = await claim(io, alice, AT, { recovery: REC });
  for (let n = 1; n <= 3; n++) await pub.publish(n, { at: '2026-08-01T00:00:00Z', text: `post ${n}` });
  const reader = readerOver(io);
  const read = (pin = null, opts = {}) => reader.read({ learned: alice.key.x, at: AT, pin, ...opts });
  return { hub, io, alice, mum, sis, ex, REC, AT, pub, reader, read, files: hub.store };
}
const view = (r) => (r.verdict === 'ok' ? `ok [${[...r.posts.keys()].sort((a, b) => a - b).join(',')}]${r.note.length ? ' ' + r.note.join(';') : ''}` : `${r.verdict}: ${r.why}`);

test('§8 a cold read, a pinned read, a withdrawal, a rewrite, a re-listing', async () => {
  const s = await scene();
  const cold = await s.read();
  assert.equal(view(cold), 'ok [1,2,3]');
  const h2 = cold.pin.live.get(2);
  await s.pub.withdraw(2);
  const pinned = await s.read(cold.pin);
  assert.equal(view(pinned), 'ok [1,3] withdrawn: 2');
  await s.pub.rewrite();
  const rewritten = await s.read(pinned.pin);
  assert.equal(view(rewritten), 'ok [1,3]');
  await s.pub.relist(2, h2);
  assert.equal(view(await s.read(rewritten.pin)), 'ok [1,2,3]');
  assert.equal(view(await s.read()), 'ok [1,2,3]');
});

test('§8.1 what a missing, garbled, substituted or unsigned profile reads as', async () => {
  const s = await scene();
  const good = s.files.get('alice/profile');
  s.files.delete('alice/profile'); assert.equal(view(await s.read()), 'host: no profile served');
  s.files.set('alice/profile', Buffer.from('not a file')); assert.equal((await s.read()).verdict, 'identity');
  const other = person('other');
  s.files.set('alice/profile', signProfile({ genesis: other.key.x, pseq: 9, chain: [{ key: other.key.x }], recovery: { k: 0, leaves: [] }, locations: [] }, other.key));
  assert.equal(view(await s.read()), 'identity: not the identity this reader learned');
  s.files.set('alice/profile', signProfile({ genesis: s.alice.key.x, pseq: 9, chain: [{ key: s.alice.key.x }], recovery: s.REC, locations: [] }, other.key));
  assert.equal(view(await s.read()), 'identity: the profile is not signed by the key it ends on');
  s.files.set('alice/profile', good);
  assert.equal((await s.read()).verdict, 'ok');
});

test('§8.2 the head: withholding, a rollback, a swap, and the rotation window', async () => {
  const s = await scene();
  const good = await s.read();
  const headBytes = s.files.get('alice/head');
  s.files.delete('alice/head');
  assert.equal(view(await s.read()), 'host: no head served');
  assert.equal(view(await s.read(good.pin)), 'ok [1,2,3] no head I can verify', 'a pinned reader keeps the head it verified');
  s.files.set('alice/head', headBytes);
  // A rollback: the host serves an earlier head again.
  await s.pub.withdraw(3);
  const later = await s.read(good.pin);
  s.files.set('alice/head', headBytes);
  assert.equal(view(await s.read(later.pin)), 'host: a head older than the one this reader saw');
  assert.equal(view(await s.read()), 'ok [1,2,3]', 'a cold reader cannot see the rollback');
  // A swapped post.
  s.files.set('alice/posts/1', signFile({ n: 1, at: 'x', text: 'not what she wrote' }, s.alice.key));
  assert.equal(view(await s.read()), 'host: post 1 is not what the head lists');
  // Genuine post 2 served at the name 1.
  s.files.set('alice/posts/1', s.files.get('alice/posts/2'));
  assert.equal(view(await s.read()), 'host: post 1 is not what the head lists');
});

test('§5.6 / §8.2 a rotation: the head is re-signed under the new key; in between, a pinned reader notes and a cold one retries', async () => {
  const s = await scene();
  const before = await s.read();
  const K2 = person('k2');
  const pub2 = createPublisher({ io: s.io, key: K2.key, at: s.AT });
  await pub2.updateProfile({ genesis: s.alice.key.x, pseq: 2, name: 'alice', chain: [{ key: s.alice.key.x }, rotation(s.alice.key, K2.key, s.REC)], recovery: s.REC, locations: [s.AT] });
  assert.equal(view(await s.read(before.pin)), 'ok [1,2,3] no head I can verify');
  assert.equal(view(await s.read()), 'host: the head is not signed by the key the profile ends on');
  await pub2.resignHead();
  assert.equal(view(await s.read(before.pin)), 'ok [1,2,3]');
  // A head signed by the rotated-out key is not a head.
  await (createPublisher({ io: s.io, key: s.alice.key, at: s.AT })).amendHead((h) => h).catch(() => {});
  assert.equal(view(await s.read()), 'ok [1,2,3]', 'the hub refused it (§9.4), so the K2 head still stands');
});

test('§4.4 / §8.3 a restore: "recently restored" is a note for seven days of the reader\'s clock, never a verdict', async () => {
  const s = await scene();
  const before = await s.read();
  const K2 = person('k2');
  s.files.set('alice/profile', signProfile({ genesis: s.alice.key.x, pseq: 2, name: 'alice', chain: [{ key: s.alice.key.x }, restore(s.alice.key, K2.key, [{ key: s.mum.key, salt: s.mum.salt }, { key: s.sis.key, salt: s.sis.salt }], s.REC)], recovery: s.REC, locations: [s.AT] }, K2.key));   
  await createPublisher({ io: s.io, key: K2.key, at: s.AT }).resignHead();
  const t0 = Date.parse('2026-08-23T00:00:00Z');
  const r1 = await s.read(before.pin, { now: t0 });
  assert.equal(view(r1), 'ok [1,2,3] recently restored');
  assert.equal(view(await s.read(r1.pin, { now: t0 + 6 * 86400e3 })), 'ok [1,2,3] recently restored');
  assert.equal(view(await s.read(r1.pin, { now: t0 + 8 * 86400e3 })), 'ok [1,2,3]');
  assert.equal(view(await s.read(null, { now: t0 + 30 * 86400e3 })), 'ok [1,2,3] recently restored', 'a cold reader starts its own seven days');
  // §4.3: a restore that also drops her name, or her location, is refused by a pinned reader.
  s.files.set('alice/profile', signProfile({ genesis: s.alice.key.x, pseq: 2, chain: [{ key: s.alice.key.x }, restore(s.alice.key, K2.key, [{ key: s.mum.key, salt: s.mum.salt }, { key: s.sis.key, salt: s.sis.salt }], s.REC)], recovery: s.REC, locations: [s.AT] }, K2.key));
  assert.equal(view(await s.read(before.pin, { now: t0 })), 'identity: a restore changed more than the key');
});

test('§8.3 a frozen copy reads as identity to a reader that saw the newer profile, never as host', async () => {
  const s = await scene();
  const pin = (await s.read()).pin;
  const frozen = { profile: s.files.get('alice/profile'), head: s.files.get('alice/head') };
  await s.pub.updateProfile({ genesis: s.alice.key.x, pseq: 2, name: 'alice', chain: [{ key: s.alice.key.x }], recovery: s.REC, locations: [s.AT, 'https://new.example/alice'] });
  const moved = await s.read(pin);
  assert.equal(moved.verdict, 'ok');
  assert.deepEqual(moved.pin.locations, [s.AT, 'https://new.example/alice'], 'the pin remembers every location ever named');
  s.files.set('alice/profile', frozen.profile); s.files.set('alice/head', frozen.head);
  assert.equal(view(await s.read(moved.pin)), 'identity: an older profile than the one this reader saw');
  assert.equal(view(await s.read()), 'ok [1,2,3]', 'a reader with no social path sees an unmarked page (§14.3)');
});

test('§8.5 the rumor rule: quiet below top, one look per identity per pass, one line per person, target hash checked', async () => {
  const s = await scene();
  const seen = new Map([[s.alice.key.x, (await s.read()).pin]]);
  const bob = person('bob'), BAT = 'https://x/bob';
  const bpub = await claim(s.io, bob, BAT);
  const target = (n, hash = seen.get(s.alice.key.x).live.get(n) ?? 'x') => ({ key: s.alice.key.x, n, hash, loc: s.AT });
  await bpub.publish(1, { at: 'x', rel: 'reply', target: target(1), text: 'to a post I can see' });
  await bpub.publish(2, { at: 'x', rel: 'reply', target: target(2, 'not-the-hash'), text: 'names the number, not the post' });
  await bpub.publish(3, { at: 'x', rel: 'reply', target: target(99), text: 'to one the host hides' });
  const bobRead = await s.reader.read({ learned: bob.key.x, at: BAT });
  let gets = 0; const counting = { get: async (u) => { gets++; return s.io.get(u); } };
  const r = readerOver(counting);
  const lines = await r.rumors(seen, bobRead.posts, 'bob');
  assert.deepEqual(lines, ['bob replied to something I cannot see']);
  assert.equal(bobRead.posts.get(2).target.unresolved, true, 'a reply whose hash does not match is a reply to something else');
  assert.equal(bobRead.posts.get(1).target.unresolved, undefined);
  // A thousand replies naming numbers that do not exist: one look, one line.
  const noisy = new Map([...Array(1000).keys()].map((i) => [i, { target: target(500 + i) }]));
  gets = 0;
  assert.deepEqual(await r.rumors(seen, noisy, 'griefer'), ['griefer replied to something I cannot see']);
  assert.ok(gets <= 6, `${gets} fetches for 1,000 replies`);
  // Alice actually publishes 4: the look-again finds it and the rumor goes quiet.
  await s.pub.publish(4, { at: 'x', text: 'post 4' });
  assert.deepEqual(await r.rumors(seen, new Map([[0, { target: target(4, 'x') }]]), 'bob'), [], 'the look-again updated the pin; the hash mismatch then makes it unresolved');
  assert.equal(seen.get(s.alice.key.x).top, 4);
});
