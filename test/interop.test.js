// Integration: one Open Feed identity across AP, Nostr, IndieWeb, and AT Protocol.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedBridge } from '../bridge/unified.js';
import { createClient } from '../bridge/atproto.js';
import { sendForPost } from '../bridge/webmention.js';
import { createHub } from '../src/hub.js';
import { encrypt, postBinding, newReadingKey } from '../src/openfeed.js';
import { memIo, readerOver, person, list, claim } from './helpers/site.js';
import http from 'node:http';

const AT = 'https://hub.example/alice';

async function fullSetup() {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), bob = person('bob');
  const aliceRead = newReadingKey(), bobRead = newReadingKey();
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'Hello, world!' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'A reply to Bob', rel: 'reply',
    target: { key: bob.key.x, number: 5, hash: 'somehash', location: 'https://bob.example/bob' } });
  await pub.publish(3, { at: '2026-08-03T00:00:00Z', encrypted: encrypt({
    content: { text: 'family only' },
    audience: [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: bob.key.x, read: bobRead.x, location: 'https://bob.example/bob' }],
    binding: postBinding(alice.key.x, 3),
  }) });
  await pub.publish(4, { at: '2026-08-04T00:00:00Z', text: 'Another public post' });

  const bridge = createUnifiedBridge({
    bridgeOrigin: 'https://bridge.example',
    feeds: new Map([['alice', { learned: alice.key.x, at: AT }]]),
    get: io.get,
  });

  return { hub, io, alice, bob, pub, bridge };
}

// ---- The unified story: one identity, four protocols ----

test('interop: WebFinger returns Open Feed profile, AP actor, and feed links', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/.well-known/webfinger?resource=acct:alice@hub.example', method: 'GET', headers: {} });
  assert.equal(res.status, 200);
  const wf = JSON.parse(res.body);
  assert.equal(wf.subject, 'acct:alice@hub.example');
  const rels = wf.links.map(l => `${l.rel}:${l.type}`);
  assert.ok(rels.some(r => r.includes('application/openfeed+json')), 'Open Feed profile link');
  assert.ok(rels.some(r => r.includes('application/activity+json')), 'AP actor link');
  assert.ok(rels.some(r => r.includes('application/feed+json')), 'JSON Feed link');
  assert.ok(rels.some(r => r.includes('application/atom+xml')), 'Atom link');
});

test('interop: NIP-05 returns Nostr pubkey for the name', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/.well-known/nostr.json?name=alice', method: 'GET', headers: {} });
  assert.equal(res.status, 200);
  const nip05 = JSON.parse(res.body);
  assert.equal(typeof nip05.names.alice, 'string');
  assert.equal(nip05.names.alice.length, 64, 'hex pubkey');
  assert.equal(nip05.names.alice, bridge.nostrKey.pubkey);
});

test('interop: AP Actor serves correct document', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/users/alice', method: 'GET', headers: { accept: 'application/activity+json' } });
  assert.equal(res.status, 200);
  const actor = JSON.parse(res.body);
  assert.equal(actor.type, 'Person');
  assert.equal(actor.preferredUsername, 'alice');
  assert.ok(actor.publicKey.publicKeyPem.includes('BEGIN PUBLIC KEY'));
});

test('interop: AP Outbox contains only public posts', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/users/alice/outbox', method: 'GET', headers: {} });
  assert.equal(res.status, 200);
  const ob = JSON.parse(res.body);
  assert.equal(ob.totalItems, 3, 'encrypted post omitted');
  assert.equal(ob.orderedItems[0].object.content, 'Hello, world!');
  assert.equal(ob.orderedItems[1].object.content, 'A reply to Bob');
  assert.ok(ob.orderedItems[1].object.inReplyTo, 'reply has inReplyTo');
  assert.equal(ob.orderedItems[2].object.content, 'Another public post');
});

test('interop: Nostr events generated with NIP-48 proxy tags', async () => {
  const { bridge } = await fullSetup();
  const getEvents = bridge.nostrEvents('alice');
  const events = await getEvents();
  assert.equal(events[0].kind, 0, 'profile event');
  const notes = events.filter(e => e.kind === 1);
  assert.equal(notes.length, 3, 'encrypted post omitted');
  for (const note of notes) {
    assert.ok(note.tags.some(t => t[0] === 'proxy' && t[2] === 'openfeed'));
    assert.equal(note.sig.length, 128, 'valid Schnorr signature');
    assert.equal(note.pubkey, bridge.nostrKey.pubkey);
  }
  const reply = notes.find(n => n.tags.some(t => t[0] === 'e'));
  assert.ok(reply, 'reply has e tag');
  assert.ok(reply.tags.some(t => t[0] === 'p'), 'reply has p tag');
});

test('interop: per-post HTML page has full h-entry microformats', async () => {
  const { bridge, alice } = await fullSetup();
  const res = await bridge.handle({ url: '/alice/posts/1', method: 'GET', headers: { accept: 'text/html' } });
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('text/html'));
  assert.ok(res.body.includes('class="h-entry"'));
  assert.ok(res.body.includes('class="p-author h-card"'));
  assert.ok(res.body.includes('class="e-content"'));
  assert.ok(res.body.includes('Hello, world!'));
  assert.ok(res.body.includes(`urn:openfeed:${alice.key.x}:1`));
});

test('interop: per-post HTML for reply has u-in-reply-to', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/alice/posts/2', method: 'GET', headers: { accept: 'text/html' } });
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('class="u-in-reply-to"'));
  assert.ok(res.body.includes('https://bob.example/bob/posts/5'));
});

test('interop: encrypted post returns 404 for HTML page', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/alice/posts/3', method: 'GET', headers: { accept: 'text/html' } });
  assert.equal(res.status, 404);
});

test('interop: h-card page served at /<name>/', async () => {
  const { bridge } = await fullSetup();
  const res = await bridge.handle({ url: '/alice/', method: 'GET', headers: {} });
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('class="h-card"'));
  assert.ok(res.body.includes('class="h-feed"'));
  assert.ok(res.body.includes('class="p-author h-card"'));
});

test('interop: AT Protocol client can sync public posts', async () => {
  const { bridge } = await fullSetup();
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello bsky' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'second post' });
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });

  const records = [];
  const fetcher = async (url, opts) => {
    if (url.includes('createSession')) return { ok: true, status: 200, text: async () => JSON.stringify({ accessJwt: 'tok', refreshJwt: 'ref', did: 'did:plc:test' }) };
    records.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ uri: 'at://test/post/1', cid: 'cid' }) };
  };
  const client = createClient({ fetchFn: fetcher });
  await client.login({ identifier: 'test', password: 'pass' });
  const results = await client.syncFromRead(read, AT);
  assert.equal(results.length, 2);
  assert.equal(records[0].record.text, 'hello bsky');
  assert.equal(records[0].record.$type, 'app.bsky.feed.post');
});

test('interop: Webmention sends for reply posts via bridge URL', async () => {
  const posts = [];
  const fetcher = async (url, opts = {}) => {
    if (opts.method === 'POST') { posts.push({ url }); return { ok: true, status: 202 }; }
    return { ok: true, status: 200, headers: { get: () => '<https://bob.example/wm>; rel="webmention"' }, text: async () => '' };
  };
  const post = { at: '2026-08-02T00:00:00Z', text: 'nice post', rel: 'reply',
    target: { key: 'k', number: 5, hash: 'h', location: 'https://bob.example/bob' } };
  const result = await sendForPost(post, 'https://bridge.example/alice/posts/2', fetcher);
  assert.equal(result.sent, true);
});

// ---- Cross-protocol consistency ----

test('interop: all protocols see the same public posts, none see encrypted', async () => {
  const { bridge } = await fullSetup();

  // AP outbox
  const apRes = await bridge.handle({ url: '/users/alice/outbox', method: 'GET', headers: {} });
  const apPosts = JSON.parse(apRes.body).orderedItems.map(i => i.object.content);

  // Nostr events
  const nostrEvents = await bridge.nostrEvents('alice')();
  const nostrPosts = nostrEvents.filter(e => e.kind === 1).map(e => e.content);

  // Both see the same 3 public posts
  assert.deepEqual(apPosts, nostrPosts);
  assert.equal(apPosts.length, 3);
  assert.ok(!apPosts.includes('family only'), 'no encrypted content in AP');
  assert.ok(!nostrPosts.includes('family only'), 'no encrypted content in Nostr');
});

test('interop: unknown name returns 404 across all endpoints', async () => {
  const { bridge } = await fullSetup();
  const endpoints = [
    '/.well-known/webfinger?resource=acct:nobody@hub.example',
    '/.well-known/nostr.json?name=nobody',
    '/users/nobody',
    '/users/nobody/outbox',
    '/nobody/posts/1',
  ];
  for (const url of endpoints) {
    const res = await bridge.handle({ url, method: 'GET', headers: { accept: 'text/html, application/activity+json' } });
    assert.equal(res.status, 404, `${url} should be 404`);
  }
});

// ---- The HTTP path into the inbox ----
// Every other inbox test calls `apInbox.handle()` with an already-parsed activity. This one drives a
// real socket, which is the only way the body-reading code in `handle()` runs at all — and the only
// way a Follow from a real instance arrives.

/** A stand-in for the remote instance: serves its Actor so `resolveInbox` finds an inbox, records what lands there. */
function remoteInstance() {
  const delivered = [];
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    if (req.method === 'GET' && req.url === '/users/bob') {
      res.writeHead(200, { 'content-type': 'application/activity+json' });
      return res.end(JSON.stringify({ id: `${base}/users/bob`, type: 'Person', inbox: `${base}/users/bob/inbox` }));
    }
    if (req.method === 'POST' && req.url === '/users/bob/inbox') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { delivered.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString()) }); res.writeHead(202); res.end(); });
      return;
    }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    delivered, actorId: `http://127.0.0.1:${server.address().port}/users/bob`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

test('interop: a Follow POSTed over HTTP is accepted and answered', async () => {
  const { bridge } = await fullSetup();
  const remote = await remoteInstance();
  const srv = await bridge.listen(0);
  // try/finally, or a failure here leaks two listening sockets and hangs the whole suite
  // instead of reporting itself.
  try {
    const res = await fetch(`${srv.url}/users/alice/inbox`, {
      method: 'POST',
      headers: { 'content-type': 'application/activity+json' },
      body: JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: `${remote.actorId}/follows/1`,
        type: 'Follow',
        actor: remote.actorId,
        object: 'https://bridge.example/users/alice',
      }),
    });

    assert.equal(res.status, 202, 'the inbox must read the request body off the socket');
    assert.equal(bridge.apInbox.followersFor('alice').size, 1);

    // The Accept goes back to the follower's inbox, signed with the bridge key.
    assert.equal(remote.delivered.length, 1);
    assert.equal(remote.delivered[0].body.type, 'Accept');
    assert.equal(remote.delivered[0].body.object.type, 'Follow');
    assert.match(remote.delivered[0].headers.signature, /keyId="https:\/\/bridge\.example\/users\/alice#main-key"/);
    assert.ok(remote.delivered[0].headers.digest, 'the delivery carries a body digest');

    const followers = await bridge.handle({ url: '/users/alice/followers', method: 'GET', headers: {} });
    assert.equal(JSON.parse(followers.body).totalItems, 1);
  } finally {
    srv.close();
    await remote.close();
  }
});
