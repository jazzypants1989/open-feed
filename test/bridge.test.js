// Bridge: AP Actor, outbox, WebFinger extension, HTTP Signatures, server integration, Webmention.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actor, publicKeyPem, newBridgeKey } from '../bridge/actor.js';
import { outbox, activitiesForDelivery } from '../bridge/outbox.js';
import { webfinger } from '../bridge/webfinger.js';
import { sign, verify } from '../bridge/signatures.js';
import { createBridge } from '../bridge/server.js';
import { discoverEndpoint, send, sendForPost } from '../bridge/webmention.js';
import { createHub } from '../src/hub.js';
import { encrypt, postBinding, newReadingKey } from '../src/openfeed.js';
import { memIo, readerOver, person, list, claim } from './helpers/site.js';
import { rotation } from '../src/profile.js';
import { signProfile } from '../src/profile.js';
import { createPublisher } from '../src/publish.js';

const AT = 'https://hub.example/alice';
const BRIDGE = 'https://bridge.example';

async function setup(posts = []) {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  const pub = await claim(io, alice, AT, { recovery: list() });
  for (const [n, body] of posts) await pub.publish(n, body);
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  assert.equal(read.verdict, 'ok', read.why);
  const bridgeKey = newBridgeKey();
  return { hub, io, alice, pub, read, bridgeKey };
}

// ---- Actor ----

test('Actor: valid AP Actor document with required fields', async () => {
  const { read, bridgeKey } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'hello' }]]);
  const a = actor(read, BRIDGE, bridgeKey);
  assert.deepEqual(a['@context'], ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1']);
  assert.equal(a.id, `${BRIDGE}/users/alice`);
  assert.equal(a.type, 'Person');
  assert.equal(a.preferredUsername, 'alice');
  assert.equal(a.name, 'alice');
  assert.equal(a.inbox, `${BRIDGE}/users/alice/inbox`);
  assert.equal(a.outbox, `${BRIDGE}/users/alice/outbox`);
  assert.equal(a.followers, `${BRIDGE}/users/alice/followers`);
});

test('Actor: publicKey uses the bridge key, not the identity key', async () => {
  const { read, bridgeKey } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]]);
  const a = actor(read, BRIDGE, bridgeKey);
  assert.equal(a.publicKey.id, `${BRIDGE}/users/alice#main-key`);
  assert.equal(a.publicKey.owner, `${BRIDGE}/users/alice`);
  assert.ok(a.publicKey.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----'));
  assert.ok(a.publicKey.publicKeyPem.includes('-----END PUBLIC KEY-----'));
  assert.equal(a.publicKey.publicKeyPem, publicKeyPem(bridgeKey));
});

test('Actor: key rotation does not change the Actor publicKey', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), k2 = person('k2');
  const rec = list();
  const pub = await claim(io, alice, AT, { recovery: rec });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'before rotation' });
  const bridgeKey = newBridgeKey();
  const reader = readerOver(io);
  const before = await reader.read({ learned: alice.key.x, at: AT });
  const actorBefore = actor(before, BRIDGE, bridgeKey);

  hub.store.set('alice/profile', signProfile({
    anchor: alice.key.x, version: 2, name: 'alice',
    chain: [{ key: alice.key.x }, rotation(alice.key, k2.key, rec)],
    recovery: rec, locations: [AT],
  }, k2.key));
  const pub2 = createPublisher({ io, key: k2.key, at: AT });
  await pub2.resignIndex();
  const after = await reader.read({ learned: alice.key.x, at: AT });
  const actorAfter = actor(after, BRIDGE, bridgeKey);

  assert.equal(actorBefore.publicKey.publicKeyPem, actorAfter.publicKey.publicKeyPem);
  assert.equal(actorBefore.id, actorAfter.id);
});

// ---- Outbox ----

test('outbox: OrderedCollection with Create/Note activities', async () => {
  const { read } = await setup([
    [1, { at: '2026-08-01T00:00:00Z', text: 'first' }],
    [2, { at: '2026-08-02T00:00:00Z', text: 'second' }],
  ]);
  const ob = outbox(read, BRIDGE, AT);
  assert.equal(ob['@context'], 'https://www.w3.org/ns/activitystreams');
  assert.equal(ob.type, 'OrderedCollection');
  assert.equal(ob.totalItems, 2);
  assert.equal(ob.orderedItems.length, 2);
  for (const item of ob.orderedItems) {
    assert.equal(item.type, 'Create');
    assert.equal(item.object.type, 'Note');
    assert.equal(item.object.attributedTo, `${BRIDGE}/users/alice`);
    assert.ok(item.object.to.includes('https://www.w3.org/ns/activitystreams#Public'));
  }
});

test('outbox: encrypted posts are omitted', async () => {
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
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  const ob = outbox(read, BRIDGE, AT);
  assert.equal(ob.totalItems, 1);
  assert.equal(ob.orderedItems[0].object.content, 'public');
});

test('outbox: post with target becomes inReplyTo', async () => {
  const { read } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'reply', rel: 'reply',
    target: { key: 'somekey', number: 5, hash: 'somehash', location: 'https://other.example/bob' } }]]);
  const ob = outbox(read, BRIDGE, AT);
  assert.equal(ob.orderedItems[0].object.inReplyTo, 'https://other.example/bob/posts/5');
});

test('outbox: items sorted by number', async () => {
  const { read } = await setup([
    [3, { at: '2026-08-03T00:00:00Z', text: 'third' }],
    [1, { at: '2026-08-01T00:00:00Z', text: 'first' }],
  ]);
  const ob = outbox(read, BRIDGE, AT);
  assert.equal(ob.orderedItems[0].object.content, 'first');
  assert.equal(ob.orderedItems[1].object.content, 'third');
});

test('outbox: Note url points to the feed location, not the bridge', async () => {
  const { read } = await setup([[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]]);
  const ob = outbox(read, BRIDGE, AT);
  assert.equal(ob.orderedItems[0].object.url, `${AT}/posts/1`);
});

// ---- WebFinger extension ----

test('WebFinger: includes AP actor link alongside Open Feed links', async () => {
  const wf = JSON.parse(webfinger('alice', AT, BRIDGE));
  assert.equal(wf.subject, 'acct:alice@hub.example');
  const apSelf = wf.links.find(l => l.rel === 'self' && l.type === 'application/activity+json');
  assert.ok(apSelf, 'must include AP actor link');
  assert.equal(apSelf.href, `${BRIDGE}/users/alice`);
  const ofSelf = wf.links.find(l => l.rel === 'self' && l.type === 'application/openfeed+json');
  assert.ok(ofSelf, 'must still include Open Feed profile link');
});

// ---- HTTP Signatures ----

test('HTTP Signatures: sign and verify round-trip', () => {
  const key = newBridgeKey();
  const request = { method: 'POST', url: 'https://remote.example/inbox', headers: {}, body: '{"type":"Follow"}' };
  const signed = sign(request, `${BRIDGE}/users/alice#main-key`, key.privateKey);
  assert.ok(signed.signature);
  assert.ok(signed.date);
  assert.ok(signed.digest);
  assert.ok(verify({ method: 'POST', url: request.url, headers: signed }, key.publicKeyPem));
});

test('HTTP Signatures: wrong key fails verification', () => {
  const key = newBridgeKey(), wrong = newBridgeKey();
  const request = { method: 'POST', url: 'https://remote.example/inbox', headers: {}, body: '{"hello":"world"}' };
  const signed = sign(request, `${BRIDGE}/users/alice#main-key`, key.privateKey);
  assert.equal(verify({ method: 'POST', url: request.url, headers: signed }, wrong.publicKeyPem), false);
});

test('HTTP Signatures: tampered body fails verification', () => {
  const key = newBridgeKey();
  const request = { method: 'POST', url: 'https://remote.example/inbox', headers: {}, body: '{"type":"Follow"}' };
  const signed = sign(request, `${BRIDGE}/users/alice#main-key`, key.privateKey);
  signed.digest = 'SHA-256=tampered';
  assert.equal(verify({ method: 'POST', url: request.url, headers: signed }, key.publicKeyPem), false);
});

test('HTTP Signatures: GET without body omits digest', () => {
  const key = newBridgeKey();
  const request = { method: 'GET', url: 'https://remote.example/users/bob', headers: {} };
  const signed = sign(request, `${BRIDGE}/users/alice#main-key`, key.privateKey);
  assert.equal(signed.digest, undefined);
  assert.ok(!signed.signature.includes('digest'));
  assert.ok(verify({ method: 'GET', url: request.url, headers: signed }, key.publicKeyPem));
});

// ---- Server integration ----

test('bridge server: Actor, outbox, followers, WebFinger end-to-end', async (t) => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello fediverse' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'second post' });

  const bridgeKey = newBridgeKey();
  const bridge = createBridge({
    bridgeOrigin: 'http://localhost:0',
    feeds: new Map([['alice', { learned: alice.key.x, at: AT }]]),
    bridgeKey,
    get: io.get,
  });

  // Actor endpoint
  const actorRes = await bridge.handle({ url: '/users/alice', method: 'GET', headers: { accept: 'application/activity+json' } });
  assert.equal(actorRes.status, 200);
  const actorDoc = JSON.parse(actorRes.body);
  assert.equal(actorDoc.type, 'Person');
  assert.equal(actorDoc.preferredUsername, 'alice');

  // Outbox
  const outboxRes = await bridge.handle({ url: '/users/alice/outbox', method: 'GET', headers: {} });
  assert.equal(outboxRes.status, 200);
  const outboxDoc = JSON.parse(outboxRes.body);
  assert.equal(outboxDoc.type, 'OrderedCollection');
  assert.equal(outboxDoc.totalItems, 2);

  // Followers (empty initially)
  const followersRes = await bridge.handle({ url: '/users/alice/followers', method: 'GET', headers: {} });
  assert.equal(followersRes.status, 200);
  const followersDoc = JSON.parse(followersRes.body);
  assert.equal(followersDoc.totalItems, 0);

  // WebFinger
  const wfRes = await bridge.handle({ url: '/.well-known/webfinger?resource=acct:alice@hub.example', method: 'GET', headers: {} });
  assert.equal(wfRes.status, 200);
  const wfDoc = JSON.parse(wfRes.body);
  assert.equal(wfDoc.subject, 'acct:alice@hub.example');
  assert.ok(wfDoc.links.some(l => l.type === 'application/activity+json'));

  // Unknown user → 404
  const notFound = await bridge.handle({ url: '/users/nobody', method: 'GET', headers: { accept: 'application/activity+json' } });
  assert.equal(notFound.status, 404);
});

test('bridge inbox: Follow adds to followers, Undo removes', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  await claim(io, alice, AT, { recovery: list() });
  const bridgeKey = newBridgeKey();
  const bridge = createBridge({
    bridgeOrigin: BRIDGE,
    feeds: new Map([['alice', { learned: alice.key.x, at: AT }]]),
    bridgeKey,
  });

  const followActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://mastodon.social/activities/follow/1',
    type: 'Follow',
    actor: 'https://mastodon.social/users/bob',
    object: `${BRIDGE}/users/alice`,
  };

  const deliveries = [];
  const deliverFn = async (url, body, headers) => { deliveries.push({ url, body, headers }); };

  const followResult = await bridge.inbox.handle('alice', followActivity, { deliver: deliverFn });
  assert.equal(followResult.status, 202);
  assert.equal(bridge.inbox.followersFor('alice').size, 1);
  assert.ok(bridge.inbox.followersFor('alice').has('https://mastodon.social/users/bob'));

  const undoActivity = {
    type: 'Undo',
    actor: 'https://mastodon.social/users/bob',
    object: { type: 'Follow', actor: 'https://mastodon.social/users/bob', object: `${BRIDGE}/users/alice` },
  };
  const undoResult = await bridge.inbox.handle('alice', undoActivity, { deliver: deliverFn });
  assert.equal(undoResult.status, 200);
  assert.equal(bridge.inbox.followersFor('alice').size, 0);
});

// ---- Webmention ----

function mockFetch(responses) {
  return async (url, opts = {}) => {
    const r = responses[url];
    if (!r) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
    return { ok: true, status: r.status ?? 200, headers: { get: (h) => r.headers?.[h] ?? null }, text: async () => r.body ?? '' };
  };
}

test('Webmention: discover endpoint from Link header', async () => {
  const fetcher = mockFetch({ 'https://bob.example/posts/1': { headers: { link: '<https://bob.example/webmention>; rel="webmention"' } } });
  const endpoint = await discoverEndpoint('https://bob.example/posts/1', fetcher);
  assert.equal(endpoint, 'https://bob.example/webmention');
});

test('Webmention: discover endpoint from HTML link tag', async () => {
  const fetcher = mockFetch({ 'https://bob.example/posts/1': { body: '<html><head><link rel="webmention" href="/webmention"></head></html>' } });
  const endpoint = await discoverEndpoint('https://bob.example/posts/1', fetcher);
  assert.equal(endpoint, 'https://bob.example/webmention');
});

test('Webmention: discover endpoint from HTML a tag', async () => {
  const fetcher = mockFetch({ 'https://bob.example/posts/1': { body: '<html><body><a rel="webmention" href="https://bob.example/wm">webmention</a></body></html>' } });
  const endpoint = await discoverEndpoint('https://bob.example/posts/1', fetcher);
  assert.equal(endpoint, 'https://bob.example/wm');
});

test('Webmention: no endpoint returns null', async () => {
  const fetcher = mockFetch({ 'https://bob.example/posts/1': { body: '<html><body>no webmention here</body></html>' } });
  assert.equal(await discoverEndpoint('https://bob.example/posts/1', fetcher), null);
});

test('Webmention: send POSTs source and target to endpoint', async () => {
  const posts = [];
  const fetcher = async (url, opts = {}) => {
    if (opts.method === 'POST') { posts.push({ url, body: opts.body }); return { ok: true, status: 202 }; }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<link rel="webmention" href="https://bob.example/webmention">' };
  };
  const result = await send('https://alice.example/posts/1', 'https://bob.example/posts/5', fetcher);
  assert.equal(result.sent, true);
  assert.equal(result.endpoint, 'https://bob.example/webmention');
  assert.equal(posts.length, 1);
  assert.ok(posts[0].body.includes('source='));
  assert.ok(posts[0].body.includes('target='));
});

test('Webmention: send returns sent:false when no endpoint', async () => {
  const fetcher = mockFetch({ 'https://bob.example/posts/1': { body: '<html></html>' } });
  const result = await send('https://alice.example/posts/1', 'https://bob.example/posts/1', fetcher);
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no endpoint');
});

test('Webmention: sendForPost skips posts without target', async () => {
  const result = await sendForPost({ at: '2026-08-01T00:00:00Z', text: 'no target' }, 'https://alice.example/posts/1');
  assert.equal(result, null);
});

test('Webmention: sendForPost sends for reply posts', async () => {
  const posts = [];
  const fetcher = async (url, opts = {}) => {
    if (opts.method === 'POST') { posts.push({ url }); return { ok: true, status: 202 }; }
    return { ok: true, status: 200, headers: { get: () => '<https://bob.example/wm>; rel="webmention"' }, text: async () => '' };
  };
  const post = { at: '2026-08-01T00:00:00Z', text: 'great post', rel: 'reply', target: { key: 'k', number: 5, hash: 'h', location: 'https://bob.example/bob' } };
  const result = await sendForPost(post, 'https://alice.example/posts/1', fetcher);
  assert.equal(result.sent, true);
  assert.equal(posts[0].url, 'https://bob.example/wm');
});
