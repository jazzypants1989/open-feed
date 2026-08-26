// A live bridge: one Open Feed identity served to Mastodon, Nostr, and the IndieWeb at a real origin.
//
//   BRIDGE_ORIGIN=https://bridge.example node bridge/mastodon-test.js            # ephemeral, for a tunnel
//   BRIDGE_ORIGIN=https://bridge.example BRIDGE_DATA=./data node bridge/...      # keys and posts survive a restart
//
// Without BRIDGE_DATA every restart mints a new identity and a new AP key, which is fine behind a
// throwaway tunnel and wrong anywhere a remote instance has cached the Actor. See bridge/state.js.
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { newSigningKey } from '../src/file.js';
import { createReader } from '../src/reader.js';
import { jsonFeed, atom, hcard } from '../src/views.js';
import { createUnifiedBridge } from '../bridge/unified.js';
import { newBridgeKey } from '../bridge/actor.js';
import { newNostrKey } from '../bridge/schnorr.js';
import { fileStore, loadKeys, loadFollowers, saveFollowers } from '../bridge/state.js';

const BRIDGE_ORIGIN = process.env.BRIDGE_ORIGIN;
if (!BRIDGE_ORIGIN) { console.error('Set BRIDGE_ORIGIN=https://bridge.example'); process.exit(1); }
const DATA = process.env.BRIDGE_DATA ?? null;
const PORT = Number(process.env.BRIDGE_PORT ?? 4568);
const NAME = process.env.BRIDGE_NAME ?? 'alice';

const { key, bridgeKey, nostrKey } = DATA
  ? loadKeys(DATA)
  : { key: newSigningKey(), bridgeKey: newBridgeKey(), nostrKey: newNostrKey() };

const hub = createHub({ store: DATA ? fileStore(DATA) : new Map() });
const HUB_AT = `${BRIDGE_ORIGIN}/${NAME}`;

const io = {
  get: async (url) => { const p = new URL(url).pathname; const r = hub.handle({ method: 'GET', path: p }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (url, bytes, opts = {}) => { const p = new URL(url).pathname; const r = hub.handle({ method: 'PUT', path: p, headers: opts.ifMatch ? { 'if-match': opts.ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};

const pub = createPublisher({ io, key, at: HUB_AT });

// Seed once. On a persisted store the name is already claimed, and re-running `publish` here would
// take the next free numbers (§8.2) and quietly duplicate every post on every boot.
if (!hub.store.has(`${NAME}/profile`)) {
  await pub.claim({ anchor: key.x, version: 1, name: NAME, chain: [{ key: key.x }], recovery: { leaves: [] }, locations: [HUB_AT] });
  await pub.publish(1, { at: '2026-08-01T09:00:00Z', text: 'First day of the holidays. The kids are feral already.' });
  await pub.publish(2, { at: '2026-08-02T20:30:00Z', text: 'Rain all day. Board games. The six-year-old is unstoppable at Monopoly.' });
  await pub.publish(3, { at: '2026-08-03T08:15:00Z', text: 'Peonies are back. Every year I forget how good they smell.' });
  console.log(`claimed ${NAME} and published 3 posts`);
} else {
  console.log(`resuming ${NAME} from ${DATA}`);
}

// The views are overwritable and `putView` re-reads the hub's ETag first (§10), so this is safe to
// repeat on every boot — and it picks up any change to the view code.
const reader = createReader({ get: io.get });
const read = await reader.read({ learned: key.x, at: HUB_AT });
if (read.verdict !== 'ok') { console.error(`the identity does not read back: ${read.verdict} — ${read.why}`); process.exit(1); }
await pub.putView('feed.json', jsonFeed(read, HUB_AT), 'application/feed+json');
await pub.putView('feed.xml', atom(read, HUB_AT), 'application/atom+xml');
await pub.putView('index.html', hcard(read, HUB_AT), 'text/html');

// The unified bridge serves AP, Nostr, and IndieWeb at once. It also falls through to the hub's own
// files (posts, feeds, profile, index), since the hub is in this process.
const bridge = createUnifiedBridge({
  bridgeOrigin: BRIDGE_ORIGIN,
  feeds: new Map([[NAME, { learned: key.x, at: HUB_AT }]]),
  bridgeKey,
  nostrKey,
  get: io.get,
});

if (DATA) {
  const stored = loadFollowers(DATA);
  for (const [name, actors] of Object.entries(stored)) for (const a of actors) bridge.apInbox.followersFor(name).add(a);
  const total = Object.values(stored).reduce((n, a) => n + a.length, 0);
  if (total) console.log(`restored ${total} follower(s)`);
}

const origHandle = bridge.handle;
const wrappedHandle = async (req) => {
  const bridgeRes = await origHandle(req);
  const inbox = req.method === 'POST' && new URL(req.url, BRIDGE_ORIGIN).pathname.match(/^\/users\/([^/]+)\/inbox$/);
  if (inbox && DATA) saveFollowers(DATA, { [inbox[1]]: [...bridge.apInbox.followersFor(inbox[1])] });
  if (bridgeRes.status !== 404) return bridgeRes;
  // Fall through to the hub for the signed files and the views.
  const url = new URL(req.url, BRIDGE_ORIGIN);
  const hubRes = hub.handle({ method: req.method ?? 'GET', path: url.pathname, headers: req.headers ?? {} });
  if (hubRes.status === 404) return { status: 404, body: 'not found' };
  return { status: hubRes.status, headers: { ...hubRes.headers }, body: hubRes.body };
};

const { createServer } = await import('node:http');
const server = createServer(async (req, res) => {
  const started = Date.now();
  try {
    const [pathname, query] = req.url.split('?');
    const url = query ? `${pathname}?${query}` : pathname;
    const result = await wrappedHandle({ url, method: req.method, headers: req.headers, body: req });
    const headers = result.headers ?? {};
    res.writeHead(result.status, headers);
    if (Buffer.isBuffer(result.body)) res.end(result.body);
    else res.end(typeof result.body === 'object' ? JSON.stringify(result.body) : (result.body ?? ''));
    console.log(`${req.method} ${req.url} → ${result.status} (${Date.now() - started}ms) ${req.headers['user-agent'] ?? ''}`);
  } catch (err) {
    console.error(`${req.method} ${req.url} → 500`, err);
    res.writeHead(500);
    res.end(err.message);
  }
});

// 0.0.0.0, not the default: in a container the proxy reaches this from another address.
server.listen(PORT, '0.0.0.0', () => {
  const host = new URL(BRIDGE_ORIGIN).host;
  console.log(`Bridge listening on 0.0.0.0:${PORT}${DATA ? `, state in ${DATA}` : ', ephemeral (no BRIDGE_DATA)'}`);
  console.log(`Public origin: ${BRIDGE_ORIGIN}`);
  console.log('');
  console.log(`AP Actor:    ${BRIDGE_ORIGIN}/users/${NAME}`);
  console.log(`WebFinger:   ${BRIDGE_ORIGIN}/.well-known/webfinger?resource=acct:${NAME}@${host}`);
  console.log(`Outbox:      ${BRIDGE_ORIGIN}/users/${NAME}/outbox`);
  console.log(`Followers:   ${BRIDGE_ORIGIN}/users/${NAME}/followers`);
  console.log(`h-card:      ${BRIDGE_ORIGIN}/${NAME}/`);
  console.log(`JSON Feed:   ${BRIDGE_ORIGIN}/${NAME}/feed.json`);
  console.log('');
  console.log(`Search for @${NAME}@${host} on Mastodon`);
});

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
