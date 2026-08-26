// AP bridge server: serves Actor, outbox, followers, handles inbox, extends WebFinger.
// One Open Feed identity → one AP Actor. The bridge reads the identity and translates.
import http from 'node:http';
import { actor, newBridgeKey } from './actor.js';
import { outbox } from './outbox.js';
import { webfinger } from './webfinger.js';
import { createInbox } from './inbox.js';
import { createReader } from '../src/reader.js';
import { createFetcher } from '../src/fetch.js';

export function createBridge({ bridgeOrigin, feeds, bridgeKey, get }) {
  bridgeKey ??= newBridgeKey();
  const inbox = createInbox(bridgeOrigin, bridgeKey);
  const reader = createReader({ get: get ?? createFetcher().get });

  async function readFeed(name) {
    const feed = feeds.get(name);
    if (!feed) return null;
    try { return await reader.read(feed); } catch { return null; }
  }

  async function handle(req) {
    const url = new URL(req.url, bridgeOrigin);
    const accept = req.headers.accept ?? '';
    const isAP = accept.includes('application/activity+json') || accept.includes('application/ld+json');

    // WebFinger
    if (url.pathname === '/.well-known/webfinger') {
      const resource = url.searchParams.get('resource');
      if (!resource) return { status: 400, body: 'missing resource' };
      const match = resource.match(/^acct:([^@]+)@/);
      if (!match) return { status: 400, body: 'bad resource' };
      const name = match[1];
      const feed = feeds.get(name);
      if (!feed) return { status: 404, body: 'not found' };
      return { status: 200, headers: { 'content-type': 'application/jrd+json' }, body: webfinger(name, feed.at, bridgeOrigin) };
    }

    // Actor
    const userMatch = url.pathname.match(/^\/users\/([^/]+)$/);
    if (userMatch) {
      const read = await readFeed(userMatch[1]);
      if (!read || read.verdict !== 'ok') return { status: 404, body: 'not found' };
      return { status: 200, headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify(actor(read, bridgeOrigin, bridgeKey)) };
    }

    // Outbox
    const outboxMatch = url.pathname.match(/^\/users\/([^/]+)\/outbox$/);
    if (outboxMatch) {
      const feed = feeds.get(outboxMatch[1]);
      if (!feed) return { status: 404, body: 'not found' };
      const read = await readFeed(outboxMatch[1]);
      if (!read || read.verdict !== 'ok') return { status: 404, body: 'not found' };
      return { status: 200, headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify(outbox(read, bridgeOrigin, feed.at)) };
    }

    // Followers
    const followersMatch = url.pathname.match(/^\/users\/([^/]+)\/followers$/);
    if (followersMatch) {
      return { status: 200, headers: { 'content-type': 'application/activity+json' }, body: JSON.stringify(inbox.getFollowers(followersMatch[1])) };
    }

    // Inbox
    const inboxMatch = url.pathname.match(/^\/users\/([^/]+)\/inbox$/);
    if (inboxMatch && req.method === 'POST') {
      const body = await readBody(req);
      const activity = JSON.parse(body);
      const deliverFn = async (url, body, headers) => fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/activity+json' }, body });
      const result = await inbox.handle(inboxMatch[1], activity, { deliver: deliverFn });
      return { status: result.status, headers: { 'content-type': 'application/activity+json' }, body: result.body ? JSON.stringify(result.body) : '' };
    }

    return { status: 404, body: 'not found' };
  }

  function listen(port = 0) {
    const server = http.createServer(async (req, res) => {
      try {
        const result = await handle(req);
        res.writeHead(result.status, result.headers ?? {});
        res.end(result.body ?? '');
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return new Promise(resolve => server.listen(port, () => resolve({
      server,
      url: `http://localhost:${server.address().port}`,
      close: () => server.close(),
    })));
  }

  return { handle, listen, inbox, bridgeKey };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
