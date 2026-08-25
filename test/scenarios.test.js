// The scenarios of GOALS.md, end to end over src/: the divorce, Grandma onboards, two hubs one
// thread, the domain goes, the stranger. Code defends scenarios, not rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { signFile } from '../src/file.js';
import { signProfile } from '../src/profile.js';
import { rotation, restore, vouched } from '../src/profile.js';
import { encrypt, decrypt, carrierOf, newReadingKey, spokenCode } from '../src/openfeed.js';
import * as views from '../src/views.js';
import { memIo, readerOver, person, list, members, claim } from './helpers/site.js';

test('the divorce: he cannot post as her, read what is encrypted past him, alter or backdate her words, keep her, or keep her identity', async () => {
  const hub = createHub(), io = memIo(hub);                                  // the ex runs this hub
  const alice = person('alice'), mum = person('mum'), sis = person('sis'), ex = person('ex');
  const REC = list(mum, sis, ex), AT = 'https://ex.example/alice';
  const aliceRead = newReadingKey(), mumRead = newReadingKey();
  const pub = await claim(io, alice, AT, { recovery: REC, read: aliceRead.x });
  const audience = [{ key: alice.key.x, read: aliceRead.x, loc: AT }, { key: mum.key.x, read: mumRead.x, loc: 'https://mum.example/mum' }];
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', encrypted: encrypt({ content: { text: 'I am leaving him on Friday' }, audience, carrier: carrierOf(alice.key.x, 1) }) });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'a public post' });
  const reader = readerOver(io);
  const momPin = (await reader.read({ learned: alice.key.x, at: AT })).pin;

  // He cannot read it, and he cannot re-parent her encrypted words under his own name.
  const encrypted = (await reader.read({ learned: alice.key.x, at: AT })).posts.get(1).encrypted;
  assert.equal(decrypt(encrypted, newReadingKey().privateKey, carrierOf(alice.key.x, 1)), null);
  assert.equal(decrypt(encrypted, mumRead.privateKey, carrierOf(ex.key.x, 1)), null, 'lifted into his post it does not open');
  assert.equal(decrypt(encrypted, mumRead.privateKey, carrierOf(alice.key.x, 1)).text, 'I am leaving him on Friday');

  // He cannot alter or backdate: he owns the disk, not her key.
  hub.store.set('alice/posts/2', signFile({ n: 2, at: '2026-01-01T00:00:00Z', text: 'she never wrote this' }, ex.key));
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, pin: momPin })).why, 'post 2 is not what the index lists');
  hub.store.set('alice/posts/2', signFile({ n: 2, at: '2026-08-02T00:00:00Z', text: 'a public post' }, alice.key));
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, pin: momPin })).verdict, 'ok', '§2.2: the identical body re-signed IS the post — the address is the hash of the body');
  hub.store.set('alice/posts/2', signFile({ n: 2, at: '2026-08-02T00:00:00Z', text: 'a public post.' }, alice.key));
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, pin: momPin })).why, 'post 2 is not what the index lists', 'one changed byte, even under her own key, is not');
  hub.store.set('alice/posts/2', signFile({ n: 2, at: '2026-08-02T00:00:00Z', text: 'a public post' }, alice.key));

  // He steals her key; she restores; the index is re-signed and what he withdrew comes back.
  const K2 = person('k2');
  const thiefPub = createPublisher({ io, key: alice.key, at: AT });           // him, with her stolen key
  await thiefPub.withdraw(2);
  const restored = signProfile({ anchor: alice.key.x, version: 2, name: 'alice', chain: [{ key: alice.key.x }, restore(alice.key, K2.key, members(mum, sis), REC)], recovery: REC, locations: [AT], read: aliceRead.x }, K2.key);
  hub.store.set('alice/profile', restored);                                  // his hub would refuse her PUT; her people carry the bytes
  const pub2 = createPublisher({ io, key: K2.key, at: AT });
  await pub2.resignIndex();
  await pub2.relist(2, momPin.live.get(2));
  const after = await reader.read({ learned: alice.key.x, at: AT, pin: momPin });
  assert.equal(after.verdict, 'ok', after.why);
  assert.ok(after.note.includes('recently restored') && after.posts.has(2));
  // His fork from the stolen key, after the fact, loses to the recovery — and her mother can check
  // the six words of the branch she was handed out of band.
  const fork = signProfile({ anchor: alice.key.x, version: 3, chain: [{ key: alice.key.x }, rotation(alice.key, ex.key, REC)], recovery: REC, locations: [AT] }, ex.key);
  hub.store.set('alice/profile', fork);
  await createPublisher({ io, key: ex.key, at: AT }).resignIndex();
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, pin: after.pin })).why, 'serves a branch the recovery rejected');
  assert.notEqual(spokenCode(K2.key.x).join(' '), spokenCode(ex.key.x).join(' '));

  // She leaves: her copy is hers, and writing the same files elsewhere is the whole exit.
  const home = createHub(), homeIo = memIo(home);
  for (const [path, bytes] of pub.copy) if (path !== '/index' && path !== '/profile') await homeIo.put(`https://alice.example/alice${path}`, bytes);
  const pubHome = createPublisher({ io: homeIo, key: K2.key, at: 'https://alice.example/alice' });
  await homeIo.put('https://alice.example/alice/profile', signProfile({ anchor: alice.key.x, version: 3, name: 'alice', chain: [{ key: alice.key.x }, restore(alice.key, K2.key, members(mum, sis), REC)], recovery: REC, locations: ['https://alice.example/alice'] }, K2.key));
  await pubHome.amendIndex((h) => ({ entries: [[1, momPin.live.get(1)], [2, momPin.live.get(2)]], version: 9, top: 2 }));
  const home1 = await readerOver(homeIo).read({ learned: alice.key.x, at: 'https://alice.example/alice', pin: after.pin });
  assert.equal(home1.verdict, 'ok', home1.why);
  assert.deepEqual([...home1.posts.keys()].sort(), [1, 2]);
});

test('Grandma onboards: an app, a name, no key ever shown; back by calling her daughter', async () => {
  const hub = createHub(), io = memIo(hub);
  const grandma = person('grandma'), daughter = person('daughter');
  const REC = list(daughter), AT = 'https://family.example/grandma';
  const pub = await claim(io, grandma, AT, { recovery: REC });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello from the garden' });
  const reader = readerOver(io);
  const pin = (await reader.read({ learned: grandma.key.x, at: AT })).pin;
  // The phone is gone. One call: the daughter vouches, and a majority of a list of one is one.
  const newPhone = person('new');
  hub.store.set('grandma/profile', signProfile({ anchor: grandma.key.x, version: 2, name: 'grandma', chain: [{ key: grandma.key.x }, restore(grandma.key, newPhone.key, members(daughter), REC)], recovery: REC, locations: [AT] }, newPhone.key));
  await createPublisher({ io, key: newPhone.key, at: AT }).resignIndex();
  const back = await reader.read({ learned: grandma.key.x, at: AT, pin });
  assert.equal(back.verdict, 'ok');
  assert.ok(back.note.includes('recently restored'));
  await createPublisher({ io, key: newPhone.key, at: AT }).publish(2, { at: '2026-09-01T00:00:00Z', text: 'back' });
  assert.equal((await reader.read({ learned: grandma.key.x, at: AT, pin: back.pin })).posts.size, 2);
});

test('two hubs, one thread: a encrypted post, a encrypted reply and a reaction cross hubs with no access control anywhere', async () => {
  const M = createHub(), J = createHub();                                     // Mom's hub (the ex runs it), Jesse's own
  const mio = memIo(M), jio = memIo(J);
  const io = { get: (u) => (u.includes('//j.example') ? jio.get(u) : mio.get(u)), put: (u, b, o) => (u.includes('//j.example') ? jio.put(u, b, o) : mio.put(u, b, o)) };
  const mom = person('mom'), jesse = person('jesse'), sis = person('sis');
  const reads = { mom: newReadingKey(), jesse: newReadingKey(), sis: newReadingKey() };
  const at = { mom: 'https://m.example/mom', jesse: 'https://j.example/jesse', sis: 'https://m.example/sis' };
  const mpub = await claim(io, mom, at.mom, { recovery: list(jesse), read: reads.mom.x });
  const jpub = await claim(io, jesse, at.jesse, { recovery: list(mom), read: reads.jesse.x });
  await claim(io, sis, at.sis, { recovery: list(mom), read: reads.sis.x });
  const reader = readerOver(io);
  const seen = new Map();
  for (const [who, p] of [['mom', mom], ['jesse', jesse], ['sis', sis]]) seen.set(p.key.x, (await reader.read({ learned: p.key.x, at: at[who] })).pin);
  // Mom seals to the family, the audience naming each of them.
  const fam = [{ key: mom.key.x, read: reads.mom.x, loc: at.mom }, { key: jesse.key.x, read: reads.jesse.x, loc: at.jesse }, { key: sis.key.x, read: reads.sis.x, loc: at.sis }];
  await mpub.publish(1, { at: '2026-08-10T09:00:00Z', encrypted: encrypt({ content: { text: 'the scan came back clear' }, audience: fam, carrier: carrierOf(mom.key.x, 1) }) });
  const momRead = await reader.read({ learned: mom.key.x, at: at.mom, pin: seen.get(mom.key.x) });
  seen.set(mom.key.x, momRead.pin);
  const inner = decrypt(momRead.posts.get(1).encrypted, reads.jesse.privateKey, carrierOf(mom.key.x, 1));
  assert.equal(inner.text, 'the scan came back clear');
  // Jesse replies encrypted, resolving the member he does not follow from the audience entry (§6.5).
  const unknown = inner.audience.find((a) => !seen.has(a.key));
  assert.equal(unknown, undefined, 'jesse holds pins for all three here');
  await jpub.publish(1, { at: '2026-08-10T11:00:00Z', encrypted: encrypt({ content: { rel: 'reply', target: { key: mom.key.x, n: 1, hash: momRead.pin.live.get(1), loc: at.mom }, text: 'best news all year' }, audience: inner.audience, carrier: carrierOf(jesse.key.x, 1) }) });
  const jRead = await reader.read({ learned: jesse.key.x, at: at.jesse, pin: seen.get(jesse.key.x) });
  const reply = decrypt(jRead.posts.get(1).encrypted, reads.sis.privateKey, carrierOf(jesse.key.x, 1));
  assert.equal(reply.text, 'best news all year', 'sis, on mom\'s hub, reads jesse\'s reply from his');
  // Neither operator reads any of it, and the public files name no recipient.
  assert.equal(decrypt(momRead.posts.get(1).encrypted, newReadingKey().privateKey, carrierOf(mom.key.x, 1)), null);
  assert.ok(!JSON.stringify([...M.store.keys(), ...(M.store.get('mom/posts/1') ?? '').toString()]).includes(reads.sis.x.slice(0, 10)));
});

test('the domain goes: everyone relocates, nobody\'s identity changes, readers find them from the locations they hold', async () => {
  const old = createHub(), fresh = createHub();
  const oio = memIo(old), fio = memIo(fresh);
  const io = { get: async (u) => (u.includes('//new.example') ? fio.get(u) : oio.get(u)), put: (u, b, o) => (u.includes('//new.example') ? fio.put(u, b, o) : oio.put(u, b, o)) };
  const a = person('alice'), AT = 'https://pence.family/alice', NEW = 'https://new.example/alice';
  const pub = await claim(io, a, AT, { recovery: list() });
  await pub.publish(1, { at: 'x', text: 'before the move' });
  await pub.publish(2, { at: 'x', text: 'also before the move' });
  const reader = readerOver(io);
  const pin = (await reader.read({ learned: a.key.x, at: AT })).pin;
  await pub.updateProfile({ anchor: a.key.x, version: 2, name: 'alice', chain: [{ key: a.key.x }], recovery: list(), locations: [AT, NEW] });
  const moved = await reader.read({ learned: a.key.x, at: AT, pin });
  // Move the files, then the old domain dies. The new name continues from her own last index (§10):
  // a fresh index at version 1 would meet every pinned reader as a second index at a version it holds.
  const pubNew = createPublisher({ io, key: a.key, at: NEW, last: pub.copy.get('/index') });
  await pubNew.claim({ anchor: a.key.x, version: 3, name: 'alice', chain: [{ key: a.key.x }], recovery: list(), locations: [NEW] });
  for (const [path, bytes] of pub.copy) if (path.startsWith('/posts/')) await io.put(`${NEW}${path}`, bytes);
  old.store.clear();
  // The reader tries the locations it holds.
  let found = null;
  for (const loc of moved.pin.locations) { try { const r = await reader.read({ learned: a.key.x, at: loc, pin: moved.pin }); if (r.verdict === 'ok') { found = { loc, r }; break; } } catch { /* keep trying */ } }
  assert.equal(found?.loc, NEW);
  assert.ok(found.r.posts.has(1) && found.r.posts.has(2));
  assert.equal(found.r.pin.indexVersion, moved.pin.indexVersion + 1, 'the index version carried across the move');
});

test('the stranger: a public journal reaches a plain feed reader through the generated views, which are never evidence', async () => {
  const hub = createHub(), io = memIo(hub);
  const a = person('alice'), AT = 'https://a.example/alice';
  const pub = await claim(io, a, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'First day of the holidays.\nThe kids are feral already.' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'Rain. Board games. <b>Not</b> HTML & such.' });
  await pub.publish(3, { at: '2026-08-03T00:00:00Z', encrypted: { epk: 'x', slots: [], ct: 'y' } });
  const photo = await pub.publishMedia(Buffer.from('a photograph'));
  await pub.publish(4, { at: '2026-08-04T00:00:00Z', media: [photo] });
  const r = await readerOver(io).read({ learned: a.key.x, at: AT });
  const feed = JSON.parse(views.jsonFeed(r, AT));
  assert.equal(feed.items.length, 3, 'encrypted posts are omitted from views; a post with media and no text is listed (§4.4)');
  assert.equal(feed.items[2].content_text, '');
  assert.equal(feed.items[0].id, `urn:openfeed:${a.key.x}:1`, 'ids survive a relocation');
  assert.ok(views.atom(r, AT).includes('&lt;b&gt;'), 'text is escaped, never trusted');
  assert.ok(views.hcard(r, AT).includes(`#${a.key.x}`), 'the h-card link carries the anchor key in its fragment');
  await pub.putView('feed.json', views.jsonFeed(r, AT), 'application/feed+json');
  assert.equal(hub.handle({ method: 'GET', path: '/alice/feed.json' }).status, 200);
  assert.ok(!views.jsonFeed(r, AT).includes('"ct"'), 'a view never carries ciphertext');
});
