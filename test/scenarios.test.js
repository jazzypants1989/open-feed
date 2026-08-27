// The scenarios of docs/GOALS.md, end to end over src/: the divorce, Grandma onboards, two hubs one
// thread, the domain goes, the stranger, the big lazy hub. Code defends scenarios, not rules.
// The weekend is the seventh, and it is staged by examples/weekend-publisher/ and
// examples/weekend-reader/ rather than here — the second reader that verifies test-vectors.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { signFile } from '../src/file.js';
import { signProfile } from '../src/profile.js';
import { rotation, restore, vouched } from '../src/profile.js';
import { encrypt, decrypt, postBinding, newReadingKey, spokenCode } from '../src/openfeed.js';
import * as views from '../src/views.js';
import { memIo, readerOver, person, list, members, claim } from './helpers/site.js';

test('the divorce: he cannot post as her, read what is encrypted past him, alter or backdate her words, keep her, or keep her identity', async () => {
  const hub = createHub(), io = memIo(hub);                                  // the ex runs this hub
  const alice = person('alice'), mum = person('mum'), sis = person('sis'), ex = person('ex');
  const REC = list(mum, sis, ex), AT = 'https://ex.example/alice';
  const aliceRead = newReadingKey(), mumRead = newReadingKey();
  const pub = await claim(io, alice, AT, { recovery: REC, read: aliceRead.x });
  const audience = [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: mum.key.x, read: mumRead.x, location: 'https://mum.example/mum' }];
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', encrypted: encrypt({ content: { text: 'I am leaving him on Friday' }, audience, binding: postBinding(alice.key.x, 1) }) });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'a public post' });
  const reader = readerOver(io);
  const momPin = (await reader.read({ learned: alice.key.x, at: AT })).checkpoint;

  // He cannot read it, and he cannot re-parent her encrypted words under his own name.
  const encrypted = (await reader.read({ learned: alice.key.x, at: AT })).posts.get(1).encrypted;
  assert.equal(decrypt(encrypted, newReadingKey().privateKey, postBinding(alice.key.x, 1)), null);
  assert.equal(decrypt(encrypted, mumRead.privateKey, postBinding(ex.key.x, 1)), null, 'lifted into his post it does not open');
  assert.equal(decrypt(encrypted, mumRead.privateKey, postBinding(alice.key.x, 1)).text, 'I am leaving him on Friday');

  // He cannot alter or backdate: he owns the disk, not her key.
  hub.store.set('alice/posts/2', signFile({ number: 2, at: '2026-01-01T00:00:00Z', text: 'she never wrote this' }, ex.key));
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, checkpoint: momPin })).why, 'post 2 is not what the index lists');
  hub.store.set('alice/posts/2', signFile({ number: 2, at: '2026-08-02T00:00:00Z', text: 'a public post' }, alice.key));
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, checkpoint: momPin })).verdict, 'ok', '§2.2: the identical body re-signed IS the post — the address is the hash of the body');
  hub.store.set('alice/posts/2', signFile({ number: 2, at: '2026-08-02T00:00:00Z', text: 'a public post.' }, alice.key));
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, checkpoint: momPin })).why, 'post 2 is not what the index lists', 'one changed byte, even under her own key, is not');
  hub.store.set('alice/posts/2', signFile({ number: 2, at: '2026-08-02T00:00:00Z', text: 'a public post' }, alice.key));

  // He steals her key; she restores; the index is re-signed and what he withdrew comes back.
  const K2 = person('k2');
  const thiefPub = createPublisher({ io, key: alice.key, at: AT });           // him, with her stolen key
  await thiefPub.withdraw(2);
  const restored = signProfile({ anchor: alice.key.x, version: 2, name: 'alice', chain: [{ key: alice.key.x }, restore(alice.key, K2.key, members(mum, sis), REC)], recovery: REC, locations: [AT], read: aliceRead.x }, K2.key);
  hub.store.set('alice/profile', restored);                                  // his hub would refuse her PUT; her people carry the bytes
  const pub2 = createPublisher({ io, key: K2.key, at: AT });
  await pub2.resignIndex();
  await pub2.relist(2, momPin.live.get(2));
  const after = await reader.read({ learned: alice.key.x, at: AT, checkpoint: momPin });
  assert.equal(after.verdict, 'ok', after.why);
  assert.ok(after.note.includes('recently restored') && after.posts.has(2));
  // His fork from the stolen key, after the fact, loses to the recovery — and her mother can check
  // the six words of the branch she was handed out of band.
  const fork = signProfile({ anchor: alice.key.x, version: 3, chain: [{ key: alice.key.x }, rotation(alice.key, ex.key, REC)], recovery: REC, locations: [AT] }, ex.key);
  hub.store.set('alice/profile', fork);
  await createPublisher({ io, key: ex.key, at: AT }).resignIndex();
  assert.equal((await reader.read({ learned: alice.key.x, at: AT, checkpoint: after.checkpoint })).why, 'serves a branch the recovery rejected');
  assert.notEqual(spokenCode(K2.key.x).join(' '), spokenCode(ex.key.x).join(' '));

  // She leaves: her copy is hers, and writing the same files elsewhere is the whole exit.
  const home = createHub(), homeIo = memIo(home);
  for (const [path, bytes] of pub.copy) if (path !== '/index' && path !== '/profile') await homeIo.put(`https://alice.example/alice${path}`, bytes);
  const pubHome = createPublisher({ io: homeIo, key: K2.key, at: 'https://alice.example/alice' });
  await homeIo.put('https://alice.example/alice/profile', signProfile({ anchor: alice.key.x, version: 3, name: 'alice', chain: [{ key: alice.key.x }, restore(alice.key, K2.key, members(mum, sis), REC)], recovery: REC, locations: ['https://alice.example/alice'] }, K2.key));
  await pubHome.amendIndex((h) => ({ entries: [[1, momPin.live.get(1)], [2, momPin.live.get(2)]], version: 9, highest: 2 }));
  const home1 = await readerOver(homeIo).read({ learned: alice.key.x, at: 'https://alice.example/alice', checkpoint: after.checkpoint });
  assert.equal(home1.verdict, 'ok', home1.why);
  assert.deepEqual([...home1.posts.keys()].sort(), [1, 2]);
});

test('Grandma onboards: an app, a name, no key ever shown; back by calling her daughter', async () => {
  const hub = createHub(), io = memIo(hub);
  const grandma = person('grandma'), daughter = person('daughter'), backup = person('backup');
  // Two members, because one is one person who can take her identity whenever he likes (§3.2). The
  // second is a key her own app made at setup and never showed her: she is still never told to keep
  // a file outside the house, and she is still back by calling her daughter.
  const REC = list(daughter, backup), AT = 'https://family.example/grandma';
  const pub = await claim(io, grandma, AT, { recovery: REC });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello from the garden' });
  const reader = readerOver(io);
  const checkpoint = (await reader.read({ learned: grandma.key.x, at: AT })).checkpoint;
  // The phone is gone. One call: the daughter vouches, the new phone's app vouches with the backup
  // key it has held all along, and two of two carries her over.
  const newPhone = person('new');
  const alone = signProfile({ anchor: grandma.key.x, version: 2, name: 'grandma', chain: [{ key: grandma.key.x }, restore(grandma.key, newPhone.key, members(daughter), REC)], recovery: REC, locations: [AT] }, newPhone.key);
  assert.equal((await reader.read({ learned: grandma.key.x, at: AT, checkpoint })).verdict, 'ok', 'the hub still serves her own profile');
  assert.notEqual(createHub().handle({ method: 'PUT', path: '/grandma/profile', body: alone }).status, 200, 'the daughter alone is 1 of 2 and gets nowhere');
  hub.store.set('grandma/profile', signProfile({ anchor: grandma.key.x, version: 2, name: 'grandma', chain: [{ key: grandma.key.x }, restore(grandma.key, newPhone.key, members(daughter, backup), REC)], recovery: REC, locations: [AT] }, newPhone.key));
  await createPublisher({ io, key: newPhone.key, at: AT }).resignIndex();
  const back = await reader.read({ learned: grandma.key.x, at: AT, checkpoint });
  assert.equal(back.verdict, 'ok');
  assert.ok(back.note.includes('recently restored'));
  await createPublisher({ io, key: newPhone.key, at: AT }).publish(2, { at: '2026-09-01T00:00:00Z', text: 'back' });
  assert.equal((await reader.read({ learned: grandma.key.x, at: AT, checkpoint: back.checkpoint })).posts.size, 2);
});

test('two hubs, one thread: a encrypted post, a encrypted reply and a reaction cross hubs with no access control anywhere', async () => {
  const M = createHub(), J = createHub();                                     // Mom's hub (the ex runs it), Jesse's own
  const mio = memIo(M), jio = memIo(J);
  const io = { get: (u) => (u.includes('//j.example') ? jio.get(u) : mio.get(u)), put: (u, b, o) => (u.includes('//j.example') ? jio.put(u, b, o) : mio.put(u, b, o)) };
  const mom = person('mom'), jesse = person('jesse'), sis = person('sis'), aunt = person('aunt');
  const reads = { mom: newReadingKey(), jesse: newReadingKey(), sis: newReadingKey(), aunt: newReadingKey() };
  const at = { mom: 'https://m.example/mom', jesse: 'https://j.example/jesse', sis: 'https://m.example/sis', aunt: 'https://j.example/aunt' };
  const mpub = await claim(io, mom, at.mom, { recovery: list(jesse, sis), read: reads.mom.x });
  const jpub = await claim(io, jesse, at.jesse, { recovery: list(mom, sis), read: reads.jesse.x });
  await claim(io, sis, at.sis, { recovery: list(mom, jesse), read: reads.sis.x });
  await claim(io, aunt, at.aunt, { recovery: list(mom, jesse), read: reads.aunt.x });   // Jesse has never read her
  const reader = readerOver(io);
  const seen = new Map();
  for (const [who, p] of [['mom', mom], ['jesse', jesse], ['sis', sis]]) seen.set(p.key.x, (await reader.read({ learned: p.key.x, at: at[who] })).checkpoint);
  // Mom encrypts to the family, the audience naming each of them.
  const fam = [{ key: mom.key.x, read: reads.mom.x, location: at.mom }, { key: jesse.key.x, read: reads.jesse.x, location: at.jesse }, { key: sis.key.x, read: reads.sis.x, location: at.sis }, { key: aunt.key.x, read: reads.aunt.x, location: at.aunt }];
  await mpub.publish(1, { at: '2026-08-10T09:00:00Z', encrypted: encrypt({ content: { text: 'the scan came back clear' }, audience: fam, binding: postBinding(mom.key.x, 1) }) });
  const momRead = await reader.read({ learned: mom.key.x, at: at.mom, checkpoint: seen.get(mom.key.x) });
  seen.set(mom.key.x, momRead.checkpoint);
  const inner = decrypt(momRead.posts.get(1).encrypted, reads.jesse.privateKey, postBinding(mom.key.x, 1));
  assert.equal(inner.text, 'the scan came back clear');
  // Jesse replies encrypted, resolving the member he does not follow from the audience entry (§6.4).
  // The entry is {key, read, location} for exactly this: a replier who meets someone only inside an
  // envelope holds a key to verify by, a key to encrypt to, and somewhere to go and read them.
  const unknown = inner.audience.find((a) => !seen.has(a.key));
  assert.equal(unknown.key, aunt.key.x, 'jesse has never read the aunt');
  const met = await reader.read({ learned: unknown.key, at: unknown.location });
  assert.equal(met.verdict, 'ok', 'the audience entry is enough to find and verify her');
  assert.equal(met.read, unknown.read, 'and the reading key it carried is the one her profile names');
  seen.set(unknown.key, met.checkpoint);
  await jpub.publish(1, { at: '2026-08-10T11:00:00Z', encrypted: encrypt({ content: { rel: 'reply', target: { key: mom.key.x, number: 1, hash: momRead.checkpoint.live.get(1), location: at.mom }, text: 'best news all year' }, audience: inner.audience, binding: postBinding(jesse.key.x, 1) }) });
  const jRead = await reader.read({ learned: jesse.key.x, at: at.jesse, checkpoint: seen.get(jesse.key.x) });
  const reply = decrypt(jRead.posts.get(1).encrypted, reads.sis.privateKey, postBinding(jesse.key.x, 1));
  assert.equal(reply.text, 'best news all year', 'sis, on mom\'s hub, reads jesse\'s reply from his');
  assert.equal(decrypt(jRead.posts.get(1).encrypted, reads.aunt.privateKey, postBinding(jesse.key.x, 1)).text, 'best news all year',
    'and so does the aunt, whom he reached only through the audience he was handed');
  // Neither operator reads any of it, and the public files name no recipient.
  assert.equal(decrypt(momRead.posts.get(1).encrypted, newReadingKey().privateKey, postBinding(mom.key.x, 1)), null);
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
  const checkpoint = (await reader.read({ learned: a.key.x, at: AT })).checkpoint;
  await pub.updateProfile({ anchor: a.key.x, version: 2, name: 'alice', chain: [{ key: a.key.x }], recovery: list(), locations: [AT, NEW] });
  const moved = await reader.read({ learned: a.key.x, at: AT, checkpoint });
  // Move the files, then the old domain dies. The new name continues from her own last index (§8.9):
  // a fresh index at version 1 would meet every checkpointed reader as a second index at a version it holds.
  const pubNew = createPublisher({ io, key: a.key, at: NEW, last: pub.copy.get('/index') });
  await pubNew.claim({ anchor: a.key.x, version: 3, name: 'alice', chain: [{ key: a.key.x }], recovery: list(), locations: [NEW] });
  for (const [path, bytes] of pub.copy) if (path.startsWith('/posts/')) await io.put(`${NEW}${path}`, bytes);
  old.store.clear();
  // The reader tries the locations it holds.
  let found = null;
  for (const location of moved.checkpoint.locations) { try { const r = await reader.read({ learned: a.key.x, at: location, checkpoint: moved.checkpoint }); if (r.verdict === 'ok') { found = { location, r }; break; } } catch { /* keep trying */ } }
  assert.equal(found?.location, NEW);
  assert.ok(found.r.posts.has(1) && found.r.posts.has(2));
  assert.equal(found.r.checkpoint.indexVersion, moved.checkpoint.indexVersion + 1, 'the index version carried across the move');
});

test('the stranger: a public journal reaches a plain feed reader through the generated views, which are never evidence', async () => {
  const hub = createHub(), io = memIo(hub);
  const a = person('alice'), AT = 'https://a.example/alice';
  const pub = await claim(io, a, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'First day of the holidays.\nThe kids are feral already.' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'Rain. Board games. <b>Not</b> HTML & such.' });
  await pub.publish(3, { at: '2026-08-03T00:00:00Z', encrypted: { ephemeral: 'x', slots: [], ciphertext: 'y' } });
  const photo = await pub.publishMedia(Buffer.from('a photograph'));
  await pub.publish(4, { at: '2026-08-04T00:00:00Z', media: [photo] });
  const r = await readerOver(io).read({ learned: a.key.x, at: AT });
  const feed = JSON.parse(views.jsonFeed(r, AT));
  assert.equal(feed.items.length, 3, 'encrypted posts are omitted from views; a post with media and no text is listed (§4.3)');
  assert.equal(feed.items[2].content_text, '');
  assert.equal(feed.items[0].id, `urn:openfeed:${a.key.x}:1`, 'ids survive a relocation');
  assert.ok(views.atom(r, AT).includes('&lt;b&gt;'), 'text is escaped, never trusted');
  assert.ok(views.hcard(r, AT).includes(`#${a.key.x}`), 'the h-card link carries the anchor key in its fragment');
  await pub.putView('feed.json', views.jsonFeed(r, AT), 'application/feed+json');
  assert.equal(hub.handle({ method: 'GET', path: '/alice/feed.json' }).status, 200);
  assert.ok(!views.jsonFeed(r, AT).includes('"ciphertext"'), 'a view never carries ciphertext');
});

test('the big lazy hub: ten thousand on one commercial hub, the operator is the ex at scale, and per-identity cost stays flat', async () => {
  const POSTS = 3;
  const alice = person('alice'), mum = person('mum'), ex = person('ex');
  const aliceRead = newReadingKey(), mumRead = newReadingKey();
  const REC = list(mum), AT = 'https://big.example/alice';

  // One hub, `tenants` other identities beside her. Her own bytes are identical in every staging,
  // which is what lets the counts below be compared exactly rather than approximately.
  const stage = async (tenants) => {
    const hub = createHub(), io = memIo(hub);
    const pub = await claim(io, alice, AT, { recovery: REC, read: aliceRead.x });
    for (let n = 1; n <= POSTS; n++) await pub.publish(n, { at: '2026-08-01T00:00:00Z', text: `alice ${n}` });
    const neighbours = [];
    for (let i = 0; i < tenants; i++) {
      const who = person(`n${i}`);
      const neighbour = await claim(io, who, `https://big.example/n${i}`, { recovery: REC });
      await neighbour.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello' });
      neighbours.push(who);
    }
    return { hub, io, pub, neighbours };
  };

  // Read her on a hub with five neighbours, and on one with three hundred. The reader's work is
  // the same work: the same files, in the same order, for the same bytes. Nothing in a read is
  // indexed by how many people the operator has.
  const meter = (io) => { const seen = { paths: [], bytes: 0 }; return [seen, readerOver({ get: async (u) => { seen.paths.push(new URL(u).pathname); const r = await io.get(u); if (r) seen.bytes += r.bytes.length; return r; } })]; };
  const small = await stage(5), big = await stage(300);
  const [sSeen, sReader] = meter(small.io), [bSeen, bReader] = meter(big.io);
  const sRead = await sReader.read({ learned: alice.key.x, at: AT });
  const bRead = await bReader.read({ learned: alice.key.x, at: AT });
  assert.equal(sRead.verdict, 'ok', sRead.why);
  assert.equal(bRead.verdict, 'ok', bRead.why);
  assert.deepEqual(bSeen.paths, sSeen.paths, 'sixty times the tenancy, the same fetches');
  assert.equal(bSeen.bytes, sSeen.bytes, 'and the same bytes');
  assert.equal(bSeen.paths.length, 2 + POSTS, 'profile, index, and one fetch per live post');

  // And the hub's own cost is a constant per identity, not a structure that grows with the crowd:
  // there is no shared file, no roster, nothing a tenant is a row in.
  const files = (tenants) => 2 + POSTS + tenants * 3;                       // hers, then profile+index+post each
  assert.equal(small.hub.store.size, files(5));
  assert.equal(big.hub.store.size, files(300));

  // Floor 1 at scale: he owns three hundred people's disks and still cannot write one word as her —
  // and the forgery does not hide in the crowd, nor does it touch anyone standing next to her.
  const neighbourBefore = big.hub.store.get('n7/index');
  big.hub.store.set('alice/posts/2', signFile({ number: 2, at: '2026-01-01T00:00:00Z', text: 'she never wrote this' }, ex.key));
  const forged = await bReader.read({ learned: alice.key.x, at: AT });
  assert.equal(forged.verdict, 'tampered');
  assert.equal(forged.why, 'post 2 is not what the index lists');
  const bystander = await readerOver(big.io).read({ learned: big.neighbours[7].key.x, at: 'https://big.example/n7' });
  assert.equal(bystander.verdict, 'ok', bystander.why);                     // the lie is scoped to her name
  assert.equal(big.hub.store.get('n7/index'), neighbourBefore, 'and no neighbour\'s files moved');
  big.hub.store.set('alice/posts/2', small.hub.store.get('alice/posts/2'));

  // Floor 2 at scale: he holds every byte of three hundred journals and opens none of the encrypted ones.
  await big.pub.publish(POSTS + 1, { at: '2026-08-09T00:00:00Z', encrypted: encrypt({ content: { text: 'the lawyer called' }, audience: [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: mum.key.x, read: mumRead.x, location: 'https://mum.example/mum' }], binding: postBinding(alice.key.x, POSTS + 1) }) });
  const encrypted = (await bReader.read({ learned: alice.key.x, at: AT })).posts.get(POSTS + 1).encrypted;
  assert.equal(decrypt(encrypted, newReadingKey().privateKey, postBinding(alice.key.x, POSTS + 1)), null, 'the operator, holding the disk');
  assert.equal(decrypt(encrypted, mumRead.privateKey, postBinding(alice.key.x, POSTS + 1)).text, 'the lawyer called');

  // Floor 3 at scale: leaving is still copying her own files somewhere else. The crowd is irrelevant
  // to it — she is not a row in his database, she is a directory of signed bytes she already had.
  const home = createHub(), homeIo = memIo(home);
  for (const [path, bytes] of big.pub.copy) await homeIo.put(`https://alice.example/alice${path}`, bytes);
  await homeIo.put('https://alice.example/alice/profile', signProfile({ anchor: alice.key.x, version: 2, name: 'alice', chain: [{ key: alice.key.x }], recovery: REC, locations: [AT, 'https://alice.example/alice'], read: aliceRead.x }, alice.key));
  const home1 = await readerOver(homeIo).read({ learned: alice.key.x, at: 'https://alice.example/alice' });
  assert.equal(home1.verdict, 'ok', home1.why);
  assert.equal(home1.posts.size, POSTS + 1);
  assert.equal(home.store.size, files(0) + 1, 'her whole identity, on a hub with one tenant');
});
