// §7 — the composed reader over the in-memory hub: the order, the three verdicts, the notes, the
// rumor rule. Most scenarios run twice — cold and checkpointed — because checkpointing is what §7 is about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { signFile, address, splitFile } from '../src/file.js';
import { rotation, restore, signProfile } from '../src/profile.js';
import { signIndex } from '../src/index.js';
import { createReader } from '../src/reader.js';
import { memIo, readerOver, person, list, claim } from './helpers/site.js';

async function scene() {
  const hub = createHub(), io = memIo(hub), alice = person('alice'), mum = person('mum'), sis = person('sis'), ex = person('ex');
  const REC = list(mum, sis, ex), AT = 'https://x/alice';
  const pub = await claim(io, alice, AT, { recovery: REC });
  for (let number = 1; number <= 3; number++) await pub.publish(number, { at: '2026-08-01T00:00:00Z', text: `post ${number}` });
  const reader = readerOver(io);
  const read = (checkpoint = null, opts = {}) => reader.read({ learned: alice.key.x, at: AT, checkpoint, ...opts });
  return { hub, io, alice, mum, sis, ex, REC, AT, pub, reader, read, files: hub.store };
}
const view = (r) => (r.verdict === 'ok' ? `ok [${[...r.posts.keys()].sort((a, b) => a - b).join(',')}]${r.note.length ? ' ' + r.note.join(';') : ''}` : `${r.verdict}: ${r.why}`);

test('§7 a cold read, a checkpointed read, a withdrawal, a rewrite, a re-listing', async () => {
  const s = await scene();
  const cold = await s.read();
  assert.equal(view(cold), 'ok [1,2,3]');
  const h2 = cold.checkpoint.live.get(2);
  await s.pub.withdraw(2);
  const checkpointed = await s.read(cold.checkpoint);
  assert.equal(view(checkpointed), 'ok [1,3] withdrawn: 2');
  await s.pub.rewrite();
  const rewritten = await s.read(checkpointed.checkpoint);
  assert.equal(view(rewritten), 'ok [1,3]');
  await s.pub.relist(2, h2);
  assert.equal(view(await s.read(rewritten.checkpoint)), 'ok [1,2,3]');
  assert.equal(view(await s.read()), 'ok [1,2,3]');
});

test('§7.1 what a missing, garbled, substituted or unsigned profile reads as', async () => {
  const s = await scene();
  const good = s.files.get('alice/profile');
  s.files.delete('alice/profile'); assert.equal(view(await s.read()), 'tampered: no profile served');
  s.files.set('alice/profile', Buffer.from('not a file')); assert.equal((await s.read()).verdict, 'contested');
  const other = person('other');
  s.files.set('alice/profile', signProfile({ anchor: other.key.x, version: 9, chain: [{ key: other.key.x }], recovery: { leaves: [] }, locations: [] }, other.key));
  assert.equal(view(await s.read()), 'contested: not the identity this reader learned');
  s.files.set('alice/profile', signProfile({ anchor: s.alice.key.x, version: 9, chain: [{ key: s.alice.key.x }], recovery: s.REC, locations: [] }, other.key));
  assert.equal(view(await s.read()), 'contested: the profile is not signed by the key it ends on');
  s.files.set('alice/profile', good);
  assert.equal((await s.read()).verdict, 'ok');
});

test('§7.1 the index: withholding, a rollback, a swap, and the rotation window', async () => {
  const s = await scene();
  const good = await s.read();
  const headBytes = s.files.get('alice/index');
  s.files.delete('alice/index');
  assert.equal(view(await s.read()), 'tampered: no index served');
  assert.equal(view(await s.read(good.checkpoint)), 'ok [1,2,3] no index I can verify', 'a checkpointed reader keeps the index it verified');
  s.files.set('alice/index', headBytes);
  // A rollback: the host serves an earlier index again.
  await s.pub.withdraw(3);
  const later = await s.read(good.checkpoint);
  s.files.set('alice/index', headBytes);
  assert.equal(view(await s.read(later.checkpoint)), 'tampered: an index older than the one this reader saw');
  assert.equal(view(await s.read()), 'ok [1,2,3]', 'a cold reader cannot see the rollback');
  // A swapped post.
  s.files.set('alice/posts/1', signFile({ number: 1, at: 'x', text: 'not what she wrote' }, s.alice.key));
  assert.equal(view(await s.read()), 'tampered: post 1 is not what the index lists');
  // Genuine post 2 served at the name 1.
  s.files.set('alice/posts/1', s.files.get('alice/posts/2'));
  assert.equal(view(await s.read()), 'tampered: post 1 is not what the index lists');
});

test('§4.4 / §7.1 a rotation: the index is re-signed under the new key; in between, a checkpointed reader notes and a cold one retries', async () => {
  const s = await scene();
  const before = await s.read();
  const K2 = person('k2');
  const pub2 = createPublisher({ io: s.io, key: K2.key, at: s.AT });
  await pub2.updateProfile({ anchor: s.alice.key.x, version: 2, name: 'alice', chain: [{ key: s.alice.key.x }, rotation(s.alice.key, K2.key, s.REC)], recovery: s.REC, locations: [s.AT] });
  assert.equal(view(await s.read(before.checkpoint)), 'ok [1,2,3] no index I can verify');
  assert.equal(view(await s.read()), 'tampered: the index is not signed by the key the profile ends on');
  await pub2.resignIndex();
  assert.equal(view(await s.read(before.checkpoint)), 'ok [1,2,3]');
  // An index signed by the rotated-out key is not an index.
  await (createPublisher({ io: s.io, key: s.alice.key, at: s.AT })).amendIndex((h) => h).catch(() => {});
  assert.equal(view(await s.read()), 'ok [1,2,3]', 'the hub refused it (§8.4), so the K2 index still stands');
});

test('§3.3 / §7.2 a restore: "recently restored" is a note for seven days of the reader\'s clock, never a verdict', async () => {
  const s = await scene();
  const before = await s.read();
  const K2 = person('k2');
  s.files.set('alice/profile', signProfile({ anchor: s.alice.key.x, version: 2, name: 'alice', chain: [{ key: s.alice.key.x }, restore(s.alice.key, K2.key, [{ key: s.mum.key, salt: s.mum.salt }, { key: s.sis.key, salt: s.sis.salt }], s.REC)], recovery: s.REC, locations: [s.AT] }, K2.key));   
  await createPublisher({ io: s.io, key: K2.key, at: s.AT }).resignIndex();
  const t0 = Date.parse('2026-08-23T00:00:00Z');
  const r1 = await s.read(before.checkpoint, { now: t0 });
  assert.equal(view(r1), 'ok [1,2,3] recently restored');
  assert.equal(view(await s.read(r1.checkpoint, { now: t0 + 6 * 86400e3 })), 'ok [1,2,3] recently restored');
  assert.equal(view(await s.read(r1.checkpoint, { now: t0 + 8 * 86400e3 })), 'ok [1,2,3]');
  assert.equal(view(await s.read(null, { now: t0 + 30 * 86400e3 })), 'ok [1,2,3] recently restored', 'a cold reader starts its own seven days');
  // §3.3: a restore that also drops her name, or her location, is refused by a checkpointed reader.
  s.files.set('alice/profile', signProfile({ anchor: s.alice.key.x, version: 2, chain: [{ key: s.alice.key.x }, restore(s.alice.key, K2.key, [{ key: s.mum.key, salt: s.mum.salt }, { key: s.sis.key, salt: s.sis.salt }], s.REC)], recovery: s.REC, locations: [s.AT] }, K2.key));
  assert.equal(view(await s.read(before.checkpoint, { now: t0 })), 'contested: a restore changed more than the key');
});

test('§7.2 a frozen copy reads as contested to a reader that saw the newer profile, never as tampered', async () => {
  const s = await scene();
  const checkpoint = (await s.read()).checkpoint;
  const frozen = { profile: s.files.get('alice/profile'), index: s.files.get('alice/index') };
  await s.pub.updateProfile({ anchor: s.alice.key.x, version: 2, name: 'alice', chain: [{ key: s.alice.key.x }], recovery: s.REC, locations: [s.AT, 'https://new.example/alice'] });
  const moved = await s.read(checkpoint);
  assert.equal(moved.verdict, 'ok');
  assert.deepEqual(moved.checkpoint.locations, [s.AT, 'https://new.example/alice'], 'the checkpoint remembers every location ever named');
  s.files.set('alice/profile', frozen.profile); s.files.set('alice/index', frozen.index);
  assert.equal(view(await s.read(moved.checkpoint)), 'contested: an older profile than the one this reader saw');
  assert.equal(view(await s.read()), 'ok [1,2,3]', 'a reader with no social path sees an unmarked page');
});

test('§7.4 the rumor rule: quiet below highest, one look per identity per pass, one line per person, target hash checked', async () => {
  const s = await scene();
  const seen = new Map([[s.alice.key.x, (await s.read()).checkpoint]]);
  const bob = person('bob'), BAT = 'https://x/bob';
  const bpub = await claim(s.io, bob, BAT);
  const target = (number, hash = seen.get(s.alice.key.x).live.get(number) ?? 'x') => ({ key: s.alice.key.x, number, hash, location: s.AT });
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
  // §9's cap on identities per pass: past it a target is not looked at, and an unchecked target is no verdict — no line.
  gets = 0;
  assert.deepEqual(await createReader({ get: counting.get, maxIdentities: 0 }).rumors(seen, noisy, 'griefer'), []);
  assert.equal(gets, 0, 'nothing fetched past the cap');
  // Alice actually publishes 4: the look-again finds it and the rumor goes quiet.
  await s.pub.publish(4, { at: 'x', text: 'post 4' });
  assert.deepEqual(await r.rumors(seen, new Map([[0, { target: target(4, 'x') }]]), 'bob'), [], 'the look-again updated the checkpoint; the hash mismatch then makes it unresolved');
  assert.equal(seen.get(s.alice.key.x).highest, 4);
});
