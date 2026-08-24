// §9 — the fetch layer over a real TLS socket: HTTPS only, the resolved-address guard, literals,
// same-origin redirects, caps, and PUT with If-Match. The certificate is hand-encoded (helpers).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { isPublicAddress } from '../src/addresses.js';
import { createFetcher, guardedLookup, FetchError } from '../src/fetch.js';
import { tlsHub, consumerFetcher, HOSTNAME, person, list, claim, memIo } from './helpers/site.js';
import { createReader } from '../src/reader.js';

test('§9 the whole read path works over TLS with a validated (pinned) certificate', async (t) => {
  const { hub, url } = await tlsHub(t);
  const alice = person('alice');
  await claim(memIo(hub), alice, `${url}/alice`, { recovery: list(0) });
  const f = consumerFetcher();
  const reader = createReader({ get: (u) => f.get(u) });
  const r = await reader.read({ learned: alice.key.x, at: `${url}/alice` });
  assert.equal(r.verdict, 'ok');
  // PUT through the fetcher, with the hub's tag.
  const cur = await f.get(`${url}/alice/index`);
  assert.ok(cur.etag);
  const put = await f.put(`${url}/alice/index`, cur.bytes, { ifMatch: cur.etag });
  assert.equal(put.status, 200);
  assert.equal((await f.put(`${url}/alice/index`, cur.bytes, { ifMatch: '"stale"' })).status, 412);
  assert.equal(await f.get(`${url}/alice/posts/1`), null, 'a 404 is null, not an error');
});

test('§9 HTTPS only, and non-public addresses refused as literals and through DNS', async () => {
  const f = consumerFetcher();
  await assert.rejects(f.get('http://example.com/x'), (e) => e.code === 'bad_scheme');
  await assert.rejects(f.get('https://169.254.169.254/latest/meta-data'), (e) => e.code === 'blocked_address');
  await assert.rejects(f.get('https://[::ffff:127.0.0.1]/x'), (e) => e.code === 'blocked_address');
  await assert.rejects(f.get('https://0177.0.0.1/x'), (e) => e.code === 'blocked_address' || e.code === 'connect_failed');
  // The DNS half: a hostname resolving only to loopback is refused before the socket connects.
  const strict = createFetcher({ resolve: (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]) });
  await assert.rejects(strict.get('https://innocent.example/x'), (e) => e.code === 'blocked_address');
  await new Promise((r) => guardedLookup(isPublicAddress, (h, o, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 }]))('x', {}, (err, addr) => { assert.equal(addr, '93.184.216.34'); r(); }));
});

test('§9 redirects: never cross-origin, at most five, each link re-checked', async (t) => {
  let links = 0;
  const server = http.createServer((req, res) => {
    links++;
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); res.end(); return; }
    if (req.url === '/away') { res.writeHead(302, { location: 'http://elsewhere.example/x' }); res.end(); return; }
    if (req.url === '/meta') { res.writeHead(302, { location: 'http://169.254.169.254/x' }); res.end(); return; }
    if (req.url === '/one') { res.writeHead(302, { location: '/final' }); res.end(); return; }
    res.writeHead(200, { etag: '"t"' }); res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const f = createFetcher({ protocols: ['http:'], isAddressAllowed: () => true });
  assert.equal((await f.get(`${url}/one`)).bytes.toString(), 'ok', 'a same-origin redirect is followed');
  await assert.rejects(f.get(`${url}/away`), (e) => e.code === 'cross_origin_redirect');
  await assert.rejects(f.get(`${url}/loop`), (e) => e.code === 'too_many_redirects');
  const g = createFetcher({ protocols: ['http:'], isAddressAllowed: (a) => a !== '169.254.169.254' });
  await assert.rejects(g.get(`${url}/meta`), (e) => e.code === 'blocked_address', 'each link is re-checked');
});

test('§9 the byte cap stops the transfer; a failure is a FetchError, never a verdict', async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(Buffer.alloc(64 * 1024)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const f = createFetcher({ protocols: ['http:'], isAddressAllowed: () => true, maxBytes: { profile: 1024, index: 1024, post: 1024, media: 1024 } });
  await assert.rejects(f.get(`http://127.0.0.1:${server.address().port}/x`), (e) => e instanceof FetchError && e.code === 'too_large');
});
