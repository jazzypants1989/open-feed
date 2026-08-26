// §8 — a hub that accepts writes, as a pure handler over a store: (request) → (response). It holds
// no key, decides nothing about who anyone is, and serves back the exact bytes it was given. The
// socket adapter is `listen()` at the bottom and is the only thing here that knows about HTTP.
//
// What it checks, and where: compare-and-swap on the two overwritable files (§8.1); the profile's
// chain and signature and the index's signature before storing them (§8.4); create-once with the
// owner's reclaim on numbered posts (§8.2, §8.5); the content-addressed twin on media (§8.6);
// cross-origin reads and a browser publisher's preflight (§8.7). Nothing on the ordinary path of a
// post or a media file.
import http from 'node:http';
import https from 'node:https';
import { sha256, splitFile, parseBody, verifyFile } from './file.js';
import { wellFormed, walk, adoptRecoveryLists } from './profile.js';
import { replay } from './index.js';
import { webfinger } from './views.js';

const PATH = /^\/([A-Za-z0-9_-]{1,64})\/(profile|index|posts\/([1-9][0-9]*)|media\/([A-Za-z0-9_-]{43})|feed\.json|feed\.xml|index\.html)$/;
const TYPES = { profile: 'application/openfeed+json', index: 'application/openfeed+json', post: 'application/openfeed+json', 'feed.json': 'application/feed+json', 'feed.xml': 'application/atom+xml', 'index.html': 'text/html; charset=utf-8' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' };

/** A store is a Map-like of path → Buffer. `createHub({ store })` accepts anything with get/set/has/delete. `origin` enables WebFinger (`https://hub.example`). */
export function createHub({ store = new Map(), mediaTypeOf = () => 'application/octet-stream', origin = null } = {}) {
  const etag = (bytes) => `"${sha256(bytes)}"`;
  const body = (bytes) => { try { const s = splitFile(bytes); return s && parseBody(s.body); } catch { return null; } };
  // The chain of the profile held at a name, walked under the recoveryLists the chain itself carries —
  // the hub has no checkpoint and keeps none; it checks that the file hangs together, not who she is.
  const chainOf = (name) => { const p = body(store.get(`${name}/profile`) ?? Buffer.alloc(0)); return p && wellFormed(p) ? walk(p, adoptRecoveryLists({}, p, 0)) : null; };
  const listed = (name, number, hash) => { const h = body(store.get(`${name}/index`) ?? Buffer.alloc(0)); const set = h && replay(h.entries); return !!set && set.live.get(number)?.hash === hash; };
  // §8.5: "the owner's file for this number" declares the number in its signed bytes, and is signed
  // by the key the chain currently ends on or is what the index lists there.
  const ownersFile = (name, bytes, number) => {
    const chain = chainOf(name); if (!chain) return false;
    const s = splitFile(bytes); const o = s && body(bytes); if (!o || o.number !== number) return false;
    return listed(name, number, sha256(s.body)) || !!verifyFile(bytes, chain.current);
  };

  function handle({ method, path, query = '', headers = {}, body: bytes = Buffer.alloc(0) }) {
    if (method === 'OPTIONS') return { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'If-Match, Content-Type', 'access-control-max-age': '86400' } };
    if (origin && method === 'GET' && path === '/.well-known/webfinger') {
      const params = new URLSearchParams(query);
      const resource = params.get('resource');
      if (!resource) return { status: 400, headers: CORS };
      const acct = resource.match(/^acct:([A-Za-z0-9_-]{1,64})@(.+)$/);
      if (!acct || !store.has(`${acct[1]}/profile`)) return { status: 404, headers: CORS };
      const jrd = Buffer.from(webfinger(acct[1], `${origin}/${acct[1]}`), 'utf8');
      return { status: 200, headers: { ...CORS, 'content-type': 'application/jrd+json', 'content-length': String(jrd.length) }, body: jrd };
    }
    const m = PATH.exec(path);
    if (!m) return { status: 404, headers: CORS };
    const [, name, kind, num, hash] = m, key = `${name}/${kind}`, cur = store.get(key) ?? null;
    const type = hash ? mediaTypeOf(key) : TYPES[kind] ?? TYPES.post;
    if (method === 'GET' || method === 'HEAD') {
      if (!cur) return { status: 404, headers: CORS };
      return { status: 200, headers: { ...CORS, etag: etag(cur), 'content-type': type, 'content-length': String(cur.length) }, body: method === 'GET' ? cur : undefined };
    }
    if (method !== 'PUT') return { status: 405, headers: { ...CORS, allow: 'GET, HEAD, PUT, OPTIONS' } };
    const ifMatch = headers['if-match'] ?? null;
    const overwritable = kind === 'profile' || kind === 'index' || kind.startsWith('feed') || kind === 'index.html';
    if (overwritable) {                                                   // §8.1 compare-and-swap
      if ((cur ? etag(cur) : null) !== ifMatch) return { status: 412, headers: { ...CORS, ...(cur ? { etag: etag(cur) } : {}) } };
      if (kind === 'profile') {                                           // §8.4: first come, same anchor, version advanced, and it must verify
        const o = body(bytes), old = cur && body(cur);
        if (!o || !wellFormed(o)) return { status: 400, headers: CORS };
        if (old && (old.anchor !== o.anchor || !(o.version > old.version))) return { status: 409, headers: CORS };
        const chain = walk(o, adoptRecoveryLists({}, o, 0));
        if (!chain || !verifyFile(bytes, chain.current)) return { status: 403, headers: CORS };
      } else if (kind === 'index') {
        const chain = chainOf(name);
        if (!chain) return { status: 404, headers: CORS };                // claim the name first
        const h = verifyFile(bytes, chain.current);
        if (!h) return { status: 403, headers: CORS };
      }
      store.set(key, bytes);
      return { status: 200, headers: { ...CORS, etag: etag(bytes) } };
    }
    if (hash) {                                                           // §8.6: the content-addressed twin
      if (cur && sha256(cur) === hash) return { status: 409, headers: CORS };
      if (sha256(bytes) !== hash) return { status: cur ? 409 : 400, headers: CORS };
      store.set(key, bytes);
      return { status: cur ? 200 : 201, headers: CORS };
    }
    const number = Number(num);                                                // §8.2 create-once, §8.5 reclaim
    if (cur) {
      if (ownersFile(name, cur, number) || !ownersFile(name, bytes, number)) return { status: 409, headers: CORS };
      store.set(key, bytes);
      return { status: 200, headers: CORS };
    }
    store.set(key, bytes);
    return { status: 201, headers: CORS };
  }

  /** §8.8: drop files the current index does not list, after the caller's grace window. */
  function collect(name, { keep = () => false } = {}) {
    const h = body(store.get(`${name}/index`) ?? Buffer.alloc(0)); const set = h && replay(h.entries);
    if (!set) return [];
    const gone = [];
    for (const key of [...store.keys()]) {
      const m = /^([^/]+)\/(posts\/([1-9][0-9]*)|media\/([A-Za-z0-9_-]{43}))$/.exec(key);
      if (!m || m[1] !== name) continue;
      const id = m[3] ? Number(m[3]) : m[4];
      if (!set.live.has(id) && !keep(key)) { store.delete(key); gone.push(key); }
    }
    return gone;
  }

  return { handle, store, collect };
}

/** The socket adapter: an http or https server (pass `tls: { key, cert }`) in front of `handle`. */
export function listen(hub, { port = 0, host = '127.0.0.1', tls = null } = {}) {
  const onRequest = (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const [p, q] = req.url.split('?');
      const r = hub.handle({ method: req.method, path: p, query: q ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(r.status, r.headers ?? {});
      res.end(r.body);
    });
  };
  const server = tls ? https.createServer(tls, onRequest) : http.createServer(onRequest);
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, url: `${tls ? 'https' : 'http'}://${host}:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}
