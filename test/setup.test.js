// glm's root-of-trust gap, staged: whoever sets up her phone is her undeclared root of trust.
//
// §3.2's floor — "a list of fewer than 2 leaves cannot restore" — closed the list-of-one defect
// docs/RETROSPECTIVE.md prices. This is the same defect one level up: two leaves, one hand. The
// leaves are salted hashes (§3.3), so nothing in the list says who holds what, and the honest
// rescue and the takeover are the same bytes in every respect a reader checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { restore, signProfile } from '../src/profile.js';
import { splitFile, parseBody } from '../src/file.js';
import { memIo, readerOver, person, list, members, claim } from './helpers/site.js';
import * as weekend from '../examples/weekend-reader/weekend-reader.js';

const AT = 'https://pence.example/gran';
const bytesOver = (io) => async (url) => (await io.get(url))?.bytes ?? null;

/** Grandma onboards, with the recovery list §3.3 recommends. Returns the hub and her first read. */
async function onboard(recovery) {
  const hub = createHub(), io = memIo(hub);
  const gran = person('gran');
  const pub = await claim(io, gran, AT, { recovery });
  await pub.publish(1, { at: '2026-01-04T10:00:00Z', text: 'the grandchildren came for lunch' });
  const first = await readerOver(io).read({ learned: gran.key.x, at: AT });
  assert.equal(first.verdict, 'ok', first.why);
  return { hub, io, gran, first };
}

/** A restore to `to`, vouched by `by`, published under the new key and the index re-signed (§4.4). */
async function takeOver(io, gran, to, by, recovery) {
  const chain = [{ key: gran.key.x }, restore(gran.key, to.key, members(...by), recovery)];
  const owner = createPublisher({ io, key: to.key, at: AT });
  await owner.updateProfile({ anchor: gran.key.x, version: 2, name: 'gran', chain, recovery, locations: [AT] });
  await owner.resignIndex();
  return owner;
}

test('§3.3: the recommended minimum is a list of one when one person holds both leaves', async () => {
  // He sets up her phone. The app does exactly what §3.3 recommends — "a backup key at setup, so
  // that one other person plus that key restores" — and he is the other person who is there. The
  // backup key was generated on the device in his hands, so both leaves are his.
  const inlaw = person('inlaw'), backup = person('backup');
  const REC = list(inlaw, backup);
  const { io, gran, first } = await onboard(REC);

  // A year later he mints a restore to a key of his own. Two vouchers against two leaves is a
  // majority, so the link is valid, and §3.2 asked nothing of her.
  const his = person('his-key');
  await takeOver(io, gran, his, [inlaw, backup], REC);

  const after = await readerOver(io).read({ learned: gran.key.x, at: AT, checkpoint: first.checkpoint });
  assert.equal(after.verdict, 'ok', after.why);
  assert.equal(after.chain.current, his.key.x, 'the identity is now his, and every reader agrees');
  assert.ok(after.note.includes('recently restored'), 'the only signal is the note an honest rescue also shows');

  // The second reader reads it exactly the same way: this is the protocol, not one implementation.
  const w = await weekend.read(bytesOver(io), { learned: gran.key.x, at: AT });
  assert.equal(w.verdict, 'ok');

  // And he can now speak as her — the thing the floor's first item promises he cannot.
  await createPublisher({ io, key: his.key, at: AT }).publish(2, { at: '2027-02-01T09:00:00Z', text: 'I have moved into a home and I am very happy here' });
  const spoken = await readerOver(io).read({ learned: gran.key.x, at: AT, checkpoint: first.checkpoint });
  assert.equal(spoken.posts.get(2).text, 'I have moved into a home and I am very happy here');
});

test('§3.3: the honest rescue and the takeover are indistinguishable to every reader', async () => {
  // The same identity, the same floor satisfied, the same number of leaves — the only difference is
  // whose hands the two keys are in, which is a social fact and not a fact about the bytes.
  const inlaw = person('inlaw'), backup = person('backup');
  const daughter = person('daughter'), sister = person('sister');

  const hostile = await onboard(list(inlaw, backup));
  const honest = await onboard(list(daughter, sister));
  const newPhone = person('new-phone'), hisKey = person('his-key');
  await takeOver(hostile.io, hostile.gran, hisKey, [inlaw, backup], list(inlaw, backup));
  await takeOver(honest.io, honest.gran, newPhone, [daughter, sister], list(daughter, sister));

  const a = await readerOver(hostile.io).read({ learned: hostile.gran.key.x, at: AT, checkpoint: hostile.first.checkpoint });
  const b = await readerOver(honest.io).read({ learned: honest.gran.key.x, at: AT, checkpoint: honest.first.checkpoint });
  assert.deepEqual([a.verdict, a.note], [b.verdict, b.note], 'same verdict, same note');
  assert.deepEqual([a.chain.restored, b.chain.restored], [true, true]);

  // The vouchers ARE on the wire (§3.2): a link carries `{key, salt, signature}` per voucher, and
  // the keys are in the served bytes. It is the reader that throws them away.
  const served = parseBody(splitFile((await hostile.io.get(`${AT}/profile`)).bytes).body);
  assert.deepEqual(served.chain[1].vouchers.map((v) => v.key), [inlaw.key.x, backup.key.x], 'who vouched is public the moment they vouch');

  // So the reader keeps them. It is the one question that separates the two cases — whose keys were
  // these? — and the answer was in the bytes all along.
  assert.deepEqual(a.chain.restoredBy, [inlaw.key.x, backup.key.x], 'both leaves are his, and now that is visible');
  assert.deepEqual(b.chain.restoredBy, [daughter.key.x, sister.key.x], 'two people she can name');

  // It stays a fact, not a verdict (§7.2): the protocol cannot know which keys share a hand, so it
  // reports who vouched and leaves the judgement to someone who knows the family.
  assert.equal(a.verdict, b.verdict);
  assert.equal(a.chain.restoredBy.length, b.chain.restoredBy.length, 'the arithmetic cannot tell them apart');
});

test('§3.3: a backup key plus two relatives still hands him a majority', async () => {
  // The careful version of the same setup: he lists himself, her daughter, and the backup key the
  // app made on the phone he was holding. Three leaves, two people — and 2 of 3 is a majority, so
  // the arithmetic is unchanged. A member holding the backup key and one leaf of their own carries
  // any list of three or fewer.
  const inlaw = person('inlaw'), daughter = person('daughter'), backup = person('backup');
  const REC = list(inlaw, daughter, backup);
  const { io, gran, first } = await onboard(REC);

  const his = person('his-key');
  await takeOver(io, gran, his, [inlaw, backup], REC);                // the daughter is not asked
  const after = await readerOver(io).read({ learned: gran.key.x, at: AT, checkpoint: first.checkpoint });
  assert.equal(after.verdict, 'ok', after.why);
  assert.equal(after.chain.current, his.key.x, 'two of three, and the daughter never heard about it');

  // Four leaves is the first shape that holds: he has two, and a majority of four is three.
  const sister = person('sister');
  const FOUR = list(inlaw, daughter, sister, backup);
  const wide = await onboard(FOUR);
  const hisAgain = person('his-other-key');
  const chain = [{ key: wide.gran.key.x }, restore(wide.gran.key, hisAgain.key, members(inlaw, backup), FOUR)];
  const forged = signProfile({ anchor: wide.gran.key.x, version: 2, name: 'gran', chain, recovery: FOUR, locations: [AT] }, hisAgain.key);
  wide.hub.store.set('gran/profile', forged);                        // the hub would refuse this PUT (§8.4); he owns the disk
  const held = await readerOver(wide.io).read({ learned: wide.gran.key.x, at: AT, checkpoint: wide.first.checkpoint });
  assert.equal(held.verdict, 'contested', 'two of four is not a majority, and the chain does not hold');
});
