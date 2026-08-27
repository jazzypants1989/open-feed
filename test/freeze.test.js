// kimi's challenge, staged: "the chain defends the archive; the push channel defends the person."
//
// A hub that freezes — serving the last index she ever wrote, unchanged, forever — passes every
// rule in §7, because every rule asks what was *served*, not whether it is *current*.
// docs/RETROSPECTIVE.md says §7.4 is the answer and its precondition is in the rule. This measures
// the precondition: exactly what it takes to break a freeze, and what a reader has when it fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { signFile } from '../src/file.js';
import { memIo, readerOver, person, claim } from './helpers/site.js';
import * as weekend from '../examples/weekend-reader/weekend-reader.js';

const HIS = 'https://ex.example', BOBS = 'https://bob.example', HERS = 'https://alice.example';
const AT = `${HIS}/alice`, BAT = `${BOBS}/bob`, NEW = `${HERS}/alice`;
const DAY = 86400e3;
const bytesOver = (io) => async (url) => (await io.get(url))?.bytes ?? null;

/**
 * Three origins, because he controls one of them. Reads route by origin; `freeze()` swaps his for a
 * snapshot of itself, so he serves what she wrote up to that moment and her later PUTs land unseen.
 */
function world() {
  const hubs = { [HIS]: createHub(), [BOBS]: createHub(), [HERS]: createHub() };
  const ios = Object.fromEntries(Object.entries(hubs).map(([o, h]) => [o, memIo(h)]));
  const origin = (url) => new URL(url).origin;
  let get = (url) => ios[origin(url)].get(url);
  const freeze = () => {
    const snap = memIo(createHub({ store: new Map(hubs[HIS].store) })), live = get;
    get = (url) => (origin(url) === HIS ? snap.get(url) : live(url));
  };
  const put = (url, b, o) => ios[origin(url)].put(url, b, o);
  // Publishers keep the live io: the freeze is what her readers are served, not a refusal to store.
  return { hubs, freeze, live: { get: (url) => ios[origin(url)].get(url), put }, io: { get: (url) => get(url), put } };
}

/** Alice on his hub, three posts, and her mother's checkpoint over them. */
async function scene() {
  const w = world();
  const alice = person('alice');
  const pub = await claim(w.live, alice, AT);
  for (const n of [1, 2, 3]) await pub.publish(n, { at: `2026-0${n}-01T09:00:00Z`, text: `entry ${n}` });
  const mum = (await readerOver(w.io).read({ learned: alice.key.x, at: AT })).checkpoint;
  return { ...w, alice, pub, mum };
}

test('§7.4: a frozen hub passes every rule in §7, cold or checkpointed, for as long as it likes', async () => {
  const s = await scene();
  s.freeze();
  const cold = s.io;

  // She keeps writing. He keeps serving February.
  await s.pub.publish(4, { at: '2026-04-01T09:00:00Z', text: 'I have somewhere to go' });
  await s.pub.publish(5, { at: '2026-04-02T09:00:00Z', text: 'the address is below' });

  const later = Date.parse('2027-04-01T00:00:00Z');
  const pinned = await readerOver(cold).read({ learned: s.alice.key.x, at: AT, checkpoint: s.mum, now: later });
  assert.equal(pinned.verdict, 'ok', pinned.why);
  assert.deepEqual([...pinned.posts.keys()], [1, 2, 3], 'a year on, her mother sees February');
  assert.deepEqual(pinned.note, [], 'and there is no note to read — nothing in §7 is even suspicious');

  // A reader arriving for the first time is no better off: every rule asks what was served.
  const fresh = await readerOver(cold).read({ learned: s.alice.key.x, at: AT, now: later });
  assert.equal(fresh.verdict, 'ok');
  assert.equal(fresh.checkpoint.highest, 3);

  // Not an artefact of one implementation. The second reader reads the freeze the same way.
  const w = await weekend.read(bytesOver(cold), { learned: s.alice.key.x, at: AT });
  assert.deepEqual([w.verdict, [...w.posts.keys()]], ['ok', [1, 2, 3]]);

  // Time is not a mechanism: no rule in §7 consults the clock, so waiting changes nothing.
  const decade = await readerOver(cold).read({ learned: s.alice.key.x, at: AT, checkpoint: pinned.checkpoint, now: later + 3650 * DAY });
  assert.deepEqual([decade.verdict, decade.note], ['ok', []]);
});

test('§7.4: one reply, from one person she already reads, is the whole push channel', async () => {
  const s = await scene();
  s.freeze();
  const cold = s.io;
  await s.pub.publish(4, { at: '2026-04-01T09:00:00Z', text: 'I have somewhere to go' });

  // Bob is on another hub and is not frozen. He replies to a post her mother cannot see.
  const bob = person('bob');
  const bpub = await claim(s.live, bob, BAT);
  await bpub.publish(1, { at: '2026-04-03T10:00:00Z', rel: 'reply', text: 'good for you', target: { key: s.alice.key.x, number: 4, hash: 'not-what-he-serves', location: AT } });

  const reader = readerOver(cold);
  const seen = new Map([[s.alice.key.x, s.mum]]);

  // She does not read Bob: nothing is called, and nothing is learned. This is the precondition.
  assert.equal(seen.has(bob.key.x), false);
  assert.deepEqual(await reader.rumors(seen, new Map(), 'nobody'), [], 'no replier she reads, no signal');
  assert.equal(seen.get(s.alice.key.x).highest, 3);

  // She adds Bob — one person, on any hub, replying once. The look-again re-reads Alice at the
  // location she holds and then at the reply's, finds the freeze at both, and says so.
  const bobRead = await reader.read({ learned: bob.key.x, at: BAT });
  seen.set(bob.key.x, bobRead.checkpoint);
  assert.deepEqual(await reader.rumors(seen, bobRead.posts, 'bob'), ['bob replied to something I cannot see']);
  assert.equal(seen.get(s.alice.key.x).highest, 3, 'the look-again found nothing — the hub is frozen at both addresses');

  // That line is the entire rescue, and it is enough to act on: it is the difference between a
  // quiet feed and a feed being held from her. Where Alice has moved, the reply's location carries
  // her mother to the new one and the freeze ends outright.
  // Moving is her copy at a new address and a profile at a higher version naming it (§3.5, §8.9).
  // Nothing is re-signed and nothing is re-numbered: the export IS the move, and his hub is not asked.
  const moved = createPublisher({ io: s.live, key: s.alice.key, at: NEW });
  await moved.updateProfile({ anchor: s.alice.key.x, version: 2, name: 'alice', chain: [{ key: s.alice.key.x }], recovery: { leaves: [] }, locations: [NEW, AT] });
  for (const [path, bytes] of s.pub.copy) if (path.startsWith('/posts/')) await s.live.put(`${NEW}${path}`, bytes, {});
  await s.live.put(`${NEW}/index`, s.pub.copy.get('/index'), { ifMatch: null });
  await bpub.publish(2, { at: '2026-04-04T10:00:00Z', rel: 'reply', text: 'still here', target: { key: s.alice.key.x, number: 4, hash: 'x', location: NEW } });
  const again = await reader.read({ learned: bob.key.x, at: BAT });
  await reader.rumors(seen, again.posts, 'bob');
  assert.equal(seen.get(s.alice.key.x).highest, 4, 'the reply named where she went, and her mother followed');
});

test('§7.4: a signed freshness claim detects the freeze and cannot tell it from a quiet feed', async () => {
  // The mechanism Gen 2 carried and the redesign cut, priced rather than dismissed: the publisher
  // signs a horizon into her index (§2.5 — an extension member, inside the signature) and a reader
  // refuses to call a lapsed index current. It is three lines, and it works.
  const honours = (index, now) => (typeof index._expires === 'string' && now > Date.parse(index._expires) ? 'not confirmed current' : null);

  const withHorizon = async (io, who, days, at) => {
    const cur = await io.get(`${at}/index`);
    const { obj } = { obj: JSON.parse(cur.bytes.subarray(0, cur.bytes.lastIndexOf(0x0a)).toString('utf8')) };
    const bytes = signFile({ entries: obj.entries, version: obj.version + 1, highest: obj.highest, _expires: new Date(Date.parse('2026-03-01T09:00:00Z') + days * DAY).toISOString() }, who.key);
    await io.put(`${at}/index`, bytes, { ifMatch: cur.etag });
    return JSON.parse(bytes.subarray(0, bytes.lastIndexOf(0x0a)).toString('utf8'));
  };

  // Alice, on his hub, promises an update within 30 days. He freezes. Sixty days later a reader
  // who honours the claim knows — with no replier anywhere, which is what §7.4 cannot do.
  const s = await scene();
  const claimed = await withHorizon(s.live, s.alice, 30, AT);
  s.freeze();
  const cold = s.io;
  await s.pub.publish(4, { at: '2026-04-01T09:00:00Z', text: 'I have somewhere to go' });
  const at60 = Date.parse('2026-03-01T09:00:00Z') + 60 * DAY;
  const held = await readerOver(cold).read({ learned: s.alice.key.x, at: AT, checkpoint: s.mum, now: at60 });
  assert.equal(held.verdict, 'ok', 'still ok — the claim is presentation, not a fourth verdict');
  assert.equal(honours(claimed, at60), 'not confirmed current', 'and the freeze is visible to a lone reader');

  // The price. Grandma is on an honest hub and has nothing to say for two months. Same horizon,
  // same silence, same signal — an accusation against a hub that did nothing wrong.
  const g = await scene();
  const grandma = await withHorizon(g.live, g.alice, 30, AT);
  const quiet = await readerOver(g.io).read({ learned: g.alice.key.x, at: AT, checkpoint: g.mum, now: at60 });
  assert.equal(quiet.verdict, 'ok');
  assert.equal(honours(grandma, at60), honours(claimed, at60), 'the honest quiet feed and the frozen one are the same signal');

  // The only way she clears it is a write she has no other reason to make: republish the index, on
  // a cadence, from a device that has to be awake to do it. That is the heartbeat the design does
  // not have, bought to distinguish two states the reader still cannot tell apart.
  const beat = await withHorizon(g.live, g.alice, 90, AT);
  assert.equal(honours(beat, at60), null);
  assert.deepEqual((await readerOver(g.io).read({ learned: g.alice.key.x, at: AT, checkpoint: g.mum, now: at60 })).note, [], 'and it is a new index version every time, for no new post');
});
