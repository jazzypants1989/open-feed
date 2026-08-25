// §8 — the publish interface as the pure handler: CAS, verified writes, create-once, the owner's
// reclaim, the media file twin, CORS, views, and §8.8's collection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../src/hub.js';
import { signFile, address, sha256 } from '../src/file.js';
import { rotation, signProfile } from '../src/profile.js';
import { memIo, person, list, claim, readerOver } from './helpers/site.js';

const put = (hub, path, body, ifMatch = null) => hub.handle({ method: 'PUT', path, headers: ifMatch ? { 'if-match': ifMatch } : {}, body });
const get = (hub, path) => hub.handle({ method: 'GET', path });

async function scene() {
  const hub = createHub(), io = memIo(hub), alice = person('alice'), mum = person('mum'), sis = person('sis'), ex = person('ex');
  const REC = list(mum, sis, ex), AT = 'https://x/alice';
  const pub = await claim(io, alice, AT, { recovery: REC });
  for (let n = 1; n <= 3; n++) await pub.publish(n, { at: 'x', text: `post ${n}` });
  return { hub, io, alice, REC, AT, pub };
}

test('§8.1 compare-and-swap: a stale tag is 412, and an overwrite with no If-Match at all is refused', async () => {
  const s = await scene();
  const etag = get(s.hub, '/alice/index').headers.etag;
  const K = s.alice.key;
  const stale = put(s.hub, '/alice/index', s.hub.store.get('alice/index'), '"stale"');
  assert.equal(stale.status, 412);
  assert.equal(stale.headers.etag, etag, 'the 412 carries the tag the hub is serving');
  assert.equal(put(s.hub, '/alice/index', s.hub.store.get('alice/index')).status, 412, 'no If-Match on an existing file');
});

test('§8.4 a hub that accepts writes verifies: a stranger with the public tag cannot clobber the profile or the index', async () => {
  const s = await scene();
  const S = person('stranger');
  const tag = get(s.hub, '/alice/profile').headers.etag;
  const forged = signProfile({ anchor: s.alice.key.x, version: 9, chain: [{ key: s.alice.key.x }], recovery: s.REC, locations: [] }, S.key);
  assert.equal(put(s.hub, '/alice/profile', forged, tag).status, 403);
  const otherGenesis = signProfile({ anchor: S.key.x, version: 9, chain: [{ key: S.key.x }], recovery: s.REC, locations: [] }, S.key);
  assert.equal(put(s.hub, '/alice/profile', otherGenesis, tag).status, 409, 'the name is taken, by someone else');
  const rollback = signProfile({ anchor: s.alice.key.x, version: 1, chain: [{ key: s.alice.key.x }], recovery: s.REC, locations: [] }, s.alice.key);
  assert.equal(put(s.hub, '/alice/profile', rollback, tag).status, 409, 'version must advance');
  const htag = get(s.hub, '/alice/index').headers.etag;
  assert.equal(put(s.hub, '/alice/index', signFile({ entries: [], version: 99, top: 0 }, S.key), htag).status, 403);
  // The honest case the checks must not break: a real rotation, then the index under the new key.
  const K2 = person('k2');
  const rotated = signProfile({ anchor: s.alice.key.x, version: 2, name: 'alice', chain: [{ key: s.alice.key.x }, rotation(s.alice.key, K2.key, s.REC)], recovery: s.REC, locations: [s.AT] }, K2.key);
  assert.equal(put(s.hub, '/alice/profile', rotated, tag).status, 200);
  assert.equal(put(s.hub, '/alice/index', signFile({ entries: [], version: 99, top: 3 }, s.alice.key), htag).status, 403, 'the old key no longer signs the index');
  assert.equal(put(s.hub, '/alice/index', signFile({ entries: [], version: 99, top: 3 }, K2.key), htag).status, 200);
});

test('§8.2 / §8.5 create-once, and the owner\'s reclaim under the ruled rule', async () => {
  const s = await scene();
  // A rotated-out key: the chain is [G, K2], the current key is K2, posts 1–3 are G-signed and listed.
  const K2 = person('k2');
  const tag = get(s.hub, '/alice/profile').headers.etag;
  put(s.hub, '/alice/profile', signProfile({ anchor: s.alice.key.x, version: 2, name: 'alice', chain: [{ key: s.alice.key.x }, rotation(s.alice.key, K2.key, s.REC)], recovery: s.REC, locations: [s.AT] }, K2.key), tag);
  // The thief holds G and squats 4–8; each PUT lands (nothing checked on the ordinary path)…
  for (let n = 4; n <= 8; n++) assert.equal(put(s.hub, `/alice/posts/${n}`, signFile({ n, text: 'squat' }, s.alice.key)).status, 201);
  // …and every one is reclaimed by the current key, one PUT each.
  for (let n = 4; n <= 8; n++) assert.equal(put(s.hub, `/alice/posts/${n}`, signFile({ n, at: 'x', text: `post ${n}` }, K2.key)).status, 200);
  // The rule does not turn around: the thief cannot take her unlisted current-key post,
  const unlisted = signFile({ n: 9, at: 'x', text: 'mine' }, K2.key);
  assert.equal(put(s.hub, '/alice/posts/9', unlisted).status, 201);
  assert.equal(put(s.hub, '/alice/posts/9', signFile({ n: 9, text: 'squat' }, s.alice.key)).status, 409);
  // …nor a listed old-key post, and she cannot overwrite her own.
  assert.equal(put(s.hub, '/alice/posts/1', signFile({ n: 1, text: 'squat' }, s.alice.key)).status, 409, 'listed, so the owner\'s');
  assert.equal(put(s.hub, '/alice/posts/1', signFile({ n: 1, text: 'rewrite' }, K2.key)).status, 409);
  // A file declaring another number is nobody's file for this one (§5.1: half of the reclaim rule).
  assert.equal(put(s.hub, '/alice/posts/10', signFile({ n: 4, at: 'x', text: 'replayed' }, K2.key)).status, 201, 'stored — nothing checked on the ordinary path');
  assert.equal(put(s.hub, '/alice/posts/10', signFile({ n: 10, at: 'x', text: 'post 10' }, K2.key)).status, 200, 'and reclaimed: a replayed genuine post does not hold a number');
});

test('§8.6 the media file twin: junk at her hash is replaced by bytes that match, and never the reverse', async () => {
  const s = await scene();
  const png = Buffer.from('a tiny png'), h = sha256(png);
  assert.equal(put(s.hub, `/alice/media/${h}`, Buffer.from('junk')).status, 400, 'junk at a name it does not hash to');
  s.hub.store.set(`alice/media/${h}`, Buffer.from('junk'));                       // however it got there
  assert.equal(put(s.hub, `/alice/media/${h}`, png).status, 200, 'replaced by the bytes that hash to the name');
  assert.equal(put(s.hub, `/alice/media/${h}`, Buffer.from('junk')).status, 409);
  assert.equal(put(s.hub, `/alice/media/${h}`, png).status, 409, 'the same bytes again is a collision, not a write');
});

test('§8.7 CORS on everything, and the preflight a browser publisher needs', async () => {
  const s = await scene();
  assert.equal(get(s.hub, '/alice/profile').headers['access-control-allow-origin'], '*');
  assert.equal(get(s.hub, '/alice/profile').headers['access-control-expose-headers'], 'ETag');
  const pre = s.hub.handle({ method: 'OPTIONS', path: '/alice/index' });
  assert.equal(pre.status, 204);
  assert.match(pre.headers['access-control-allow-methods'], /PUT/);
  assert.match(pre.headers['access-control-allow-headers'], /If-Match/);
});

test('§11 views are unsigned overwritable files at conventional paths, and never evidence', async () => {
  const s = await scene();
  assert.equal(put(s.hub, '/alice/feed.json', Buffer.from('{"version":"https://jsonfeed.org/version/1.1","items":[]}')).status, 200);
  assert.equal(get(s.hub, '/alice/feed.json').headers['content-type'], 'application/feed+json');
  const r = await readerOver(s.io).read({ learned: s.alice.key.x, at: s.AT });
  assert.equal(r.verdict, 'ok', 'the reader never looked at the view');
});

test('§8.8 a hub may drop what the index does not list, and nothing the index lists', async () => {
  const s = await scene();
  await s.pub.withdraw(2);
  await s.pub.rewrite();
  const gone = s.hub.collect('alice');
  assert.deepEqual(gone, ['alice/posts/2']);
  assert.equal(readerOver(s.io) && (await readerOver(s.io).read({ learned: s.alice.key.x, at: s.AT })).verdict, 'ok');
});
