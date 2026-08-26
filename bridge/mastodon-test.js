// Mastodon live test: unified bridge behind ngrok
// Usage: BRIDGE_ORIGIN=https://xxxx.ngrok-free.app node tmp/mastodon-test.js
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { newSigningKey } from '../src/file.js';
import { signProfile } from '../src/profile.js';
import { createReader } from '../src/reader.js';
import { jsonFeed, atom, hcard } from '../src/views.js';
import { createUnifiedBridge } from '../bridge/unified.js';

const BRIDGE_ORIGIN = process.env.BRIDGE_ORIGIN;
if (!BRIDGE_ORIGIN) { console.error('Set BRIDGE_ORIGIN=https://xxxx.ngrok-free.app'); process.exit(1); }

const hub = createHub();
const key = newSigningKey();
const HUB_AT = `${BRIDGE_ORIGIN}/alice`;

const io = {
  get: async (url) => { const p = new URL(url).pathname; const r = hub.handle({ method: 'GET', path: p }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (url, bytes, opts = {}) => { const p = new URL(url).pathname; const r = hub.handle({ method: 'PUT', path: p, headers: opts.ifMatch ? { 'if-match': opts.ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};

const pub = createPublisher({ io, key, at: HUB_AT });
await pub.claim({ anchor: key.x, version: 1, name: 'alice', chain: [{ key: key.x }], recovery: { leaves: [] }, locations: [HUB_AT] });
await pub.publish(1, { at: '2026-08-01T09:00:00Z', text: 'First day of the holidays. The kids are feral already.' });
await pub.publish(2, { at: '2026-08-02T20:30:00Z', text: 'Rain all day. Board games. The six-year-old is unstoppable at Monopoly.' });
await pub.publish(3, { at: '2026-08-03T08:15:00Z', text: 'Peonies are back. Every year I forget how good they smell.' });

const reader = createReader({ get: io.get });
const read = await reader.read({ learned: key.x, at: HUB_AT });
await pub.putView('feed.json', jsonFeed(read, HUB_AT), 'application/feed+json');
await pub.putView('feed.xml', atom(read, HUB_AT), 'application/atom+xml');
await pub.putView('index.html', hcard(read, HUB_AT), 'text/html');

// The unified bridge serves AP, Nostr, IndieWeb all at once.
// It also serves the hub's files (feeds, posts) since the hub data is in-memory.
const bridge = createUnifiedBridge({
  bridgeOrigin: BRIDGE_ORIGIN,
  feeds: new Map([['alice', { learned: key.x, at: HUB_AT }]]),
  get: io.get,
});

// Wrap bridge.handle to also serve hub files (posts, feeds, profile, index)
const origHandle = bridge.handle;
const wrappedHandle = async (req) => {
  // Try bridge first (AP endpoints, WebFinger, NIP-05, per-post HTML)
  const bridgeRes = await origHandle(req);
  if (bridgeRes.status !== 404) return bridgeRes;
  // Fall through to hub for signed files and views
  const url = new URL(req.url, BRIDGE_ORIGIN);
  const hubRes = hub.handle({ method: req.method ?? 'GET', path: url.pathname, headers: req.headers ?? {} });
  if (hubRes.status === 404) return { status: 404, body: 'not found' };
  return { status: hubRes.status, headers: { ...hubRes.headers }, body: hubRes.body };
};

const { createServer } = await import('node:http');
const server = createServer(async (req, res) => {
  try {
    const [pathname, query] = req.url.split('?');
    const url = query ? `${pathname}?${query}` : pathname;
    const result = await wrappedHandle({ url, method: req.method, headers: req.headers, body: req });
    const headers = result.headers ?? {};
    if (Buffer.isBuffer(result.body)) {
      res.writeHead(result.status, headers);
      res.end(result.body);
    } else {
      res.writeHead(result.status, headers);
      res.end(typeof result.body === 'object' ? JSON.stringify(result.body) : (result.body ?? ''));
    }
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(err.message);
  }
});

server.listen(4568, () => {
  console.log(`Bridge running at http://localhost:4568`);
  console.log(`Public origin: ${BRIDGE_ORIGIN}`);
  console.log('');
  console.log(`AP Actor:    ${BRIDGE_ORIGIN}/users/alice`);
  console.log(`WebFinger:   ${BRIDGE_ORIGIN}/.well-known/webfinger?resource=acct:alice@${new URL(BRIDGE_ORIGIN).host}`);
  console.log(`Outbox:      ${BRIDGE_ORIGIN}/users/alice/outbox`);
  console.log(`Followers:   ${BRIDGE_ORIGIN}/users/alice/followers`);
  console.log(`h-card:      ${BRIDGE_ORIGIN}/alice/`);
  console.log(`JSON Feed:   ${BRIDGE_ORIGIN}/alice/feed.json`);
  console.log('');
  console.log('Search for @alice@' + new URL(BRIDGE_ORIGIN).host + ' on Mastodon');
  console.log('Press Ctrl+C to stop');
});
