// Unified bridge: one Open Feed identity across AP, Nostr, IndieWeb, and AT Protocol.
// Serves WebFinger (with AP actor link), NIP-05, AP endpoints, per-post HTML pages,
// and can generate Nostr events and sync to AT Protocol.
import http from 'node:http';
import { actor, newBridgeKey } from './actor.js';
import { outbox } from './outbox.js';
import { webfinger } from './webfinger.js';
import { createInbox } from './inbox.js';
import { postPage, hcard } from '../src/views.js';
import { newNostrKey } from './schnorr.js';
import { eventsFromRead, relayMessage } from './nostr.js';
import { createReader } from '../src/reader.js';

export function createUnifiedBridge({ bridgeOrigin, feeds, bridgeKey, nostrKey, get }) {
  bridgeKey ??= newBridgeKey();
  nostrKey ??= newNostrKey();
  const apInbox = createInbox(bridgeOrigin, bridgeKey);
  const reader = createReader({ get });

  async function readFeed(name) {
    const feed = feeds.get(name);
    if (!feed) return null;
    try { return await reader.read(feed); } catch { return null; }
  }

  async function handle(req) {
    const url = new URL(req.url, bridgeOrigin);

    // WebFinger (with AP actor link)
    if (url.pathname === '/.well-known/webfinger') {
      const resource = url.searchParams.get('resource');
      if (!resource) return json(400, { error: 'missing resource' });
      const match = resource.match(/^acct:([^@]+)@/);
      if (!match || !feeds.has(match[1])) return json(404, { error: 'not found' });
      const name = match[1], feed = feeds.get(name);
      return { status: 200, headers: { 'content-type': 'application/jrd+json' }, body: webfinger(name, feed.at, bridgeOrigin) };
    }

    // NIP-05 (Nostr address verification)
    if (url.pathname === '/.well-known/nostr.json') {
      const name = url.searchParams.get('name');
      if (!name || !feeds.has(name)) return json(404, { error: 'not found' });
      return json(200, { names: { [name]: nostrKey.pubkey } });
    }

    // AP Actor
    const userMatch = url.pathname.match(/^\/users\/([^/]+)$/);
    if (userMatch) {
      const read = await readFeed(userMatch[1]);
      if (!read || read.verdict !== 'ok') return json(404, { error: 'not found' });
      return json(200, actor(read, bridgeOrigin, bridgeKey), 'application/activity+json');
    }

    // AP Outbox
    const outboxMatch = url.pathname.match(/^\/users\/([^/]+)\/outbox$/);
    if (outboxMatch) {
      const feed = feeds.get(outboxMatch[1]);
      if (!feed) return json(404, { error: 'not found' });
      const read = await readFeed(outboxMatch[1]);
      if (!read || read.verdict !== 'ok') return json(404, { error: 'not found' });
      return json(200, outbox(read, bridgeOrigin, feed.at), 'application/activity+json');
    }

    // AP Followers
    const followersMatch = url.pathname.match(/^\/users\/([^/]+)\/followers$/);
    if (followersMatch) {
      return json(200, apInbox.getFollowers(followersMatch[1]), 'application/activity+json');
    }

    // AP Inbox
    const inboxMatch = url.pathname.match(/^\/users\/([^/]+)\/inbox$/);
    if (inboxMatch && req.method === 'POST') {
      const body = typeof req.body === 'string' ? req.body : await readBody(req.body ?? req);
      const activity = JSON.parse(body);
      const deliverFn = async (url, body, headers) => fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/activity+json' }, body });
      const result = await apInbox.handle(inboxMatch[1], activity, { deliver: deliverFn });
      return json(result.status, result.body ?? {});
    }

    // Per-post HTML page
    const postMatch = url.pathname.match(/^\/([^/]+)\/posts\/([1-9][0-9]*)$/);
    if (postMatch && req.headers?.accept?.includes('text/html')) {
      const read = await readFeed(postMatch[1]);
      if (!read || read.verdict !== 'ok') return { status: 404, body: 'not found' };
      const feed = feeds.get(postMatch[1]);
      const html = postPage(read, feed.at, Number(postMatch[2]));
      if (!html) return { status: 404, body: 'not found' };
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: html };
    }

    // h-card page
    const hcardMatch = url.pathname.match(/^\/([^/]+)\/?$/);
    if (hcardMatch && feeds.has(hcardMatch[1])) {
      const read = await readFeed(hcardMatch[1]);
      if (!read || read.verdict !== 'ok') return { status: 404, body: 'not found' };
      const feed = feeds.get(hcardMatch[1]);
      return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: hcard(read, feed.at) };
    }

    return json(404, { error: 'not found' });
  }

  function nostrEvents(name) {
    return async () => {
      const read = await readFeed(name);
      if (!read || read.verdict !== 'ok') return [];
      const feed = feeds.get(name);
      return eventsFromRead(read, feed.at, { privateKey: nostrKey.privateKey });
    };
  }

  function listen(port = 0) {
    const server = http.createServer(async (req, res) => {
      try {
        const [pathname, query] = req.url.split('?');
        const result = await handle({
          url: query ? `${pathname}?${query}` : pathname,
          method: req.method,
          headers: req.headers,
          body: req,
        });
        res.writeHead(result.status, result.headers ?? {});
        res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body ?? ''));
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
      }
    });
    return new Promise(resolve => server.listen(port, () => resolve({
      server, url: `http://localhost:${server.address().port}`,
      close: () => server.close(),
    })));
  }

  return { handle, listen, apInbox, nostrEvents, bridgeKey, nostrKey };
}

function json(status, data, contentType = 'application/json') {
  return { status, headers: { 'content-type': contentType }, body: JSON.stringify(data) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
