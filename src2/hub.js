// §9 — a hub that accepts writes, as a pure handler over a store: (request) → (response). It holds
// no key, decides nothing about who anyone is, and serves back the exact bytes it was given. The
// socket adapter is `listen()` at the bottom and is the only thing here that knows about HTTP.
//
// What it checks, and where: compare-and-swap on the two overwritable files (§9.1); the profile's
// chain and signature and the head's signature before storing them (§9.4); create-once with the
// owner's reclaim on numbered posts (§9.2, §9.5); the content-addressed twin on photos (§9.6);
// cross-origin reads and a browser publisher's preflight (§9.7). Nothing on the ordinary path of a
// post or a photo.
import http from 'node:http';
import https from 'node:https';
import { sha256, splitFile, parseBody, verifyFile } from './file.js';
import { wellFormed, walk, adoptCourts } from './profile.js';
import { fold } from './head.js';

const PATH = /^\/([A-Za-z0-9_-]{1,64})\/(profile|head|posts\/([1-9][0-9]*)|media\/([A-Za-z0-9_-]{43})|feed\.json|feed\.xml|index\.html)$/;
const TYPES = { profile: 'application/openfeed+json', head: 'application/openfeed+json', post: 'application/openfeed+json', 'feed.json': 'application/feed+json', 'feed.xml': 'application/atom+xml', 'index.html': 'text/html; charset=utf-8' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag' };

/** A store is a Map-like of path → Buffer. `createHub({ store })` accepts anything with get/set/has/delete. */
export function createHub({ store = new Map(), mediaTypeOf = () => 'application/octet-stream' } = {}) {
  const etag = (bytes) => `"${sha256(bytes)}"`;
  const body = (bytes) => { try { const s = splitFile(bytes); return s && parseBody(s.body); } catch { return null; } };
  // The chain of the profile held at a name, walked under the courts the chain itself carries —
  // the hub has no pin and keeps none; it checks that the file hangs together, not who she is.
  const chainOf = (name) => { const p = body(store.get(`${name}/profile`) ?? Buffer.alloc(0)); return p && wellFormed(p) ? walk(p, adoptCourts({}, p, 0)) : null; };
  const listed = (name, n, hash) => { const h = body(store.get(`${name}/head`) ?? Buffer.alloc(0)); const set = h && fold(h.entries); return !!set && set.live.get(n)?.hash === hash; };
  // §9.5: "the owner's file for this number" declares the number in its signed bytes, and is signed
  // by the key the chain currently ends on or is what the head lists there.
  const ownersFile = (name, bytes, n) => {
    const chain = chainOf(name); if (!chain) return false;
    const s = splitFile(bytes); const o = s && body(bytes); if (!o || o.n !== n) return false;
    return listed(name, n, sha256(s.body)) || !!verifyFile(bytes, chain.current);
  };

  function handle({ method, path, headers = {}, body: bytes = Buffer.alloc(0) }) {
    const m = PATH.exec(path);
    if (method === 'OPTIONS') return { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'If-Match, Content-Type', 'access-control-max-age': '86400' } };
    if (!m) return { status: 404, headers: CORS };
    const [, name, kind, num, hash] = m, key = `${name}/${kind}`, cur = store.get(key) ?? null;
    const type = hash ? mediaTypeOf(key) : TYPES[kind] ?? TYPES.post;
    if (method === 'GET' || method === 'HEAD') {
      if (!cur) return { status: 404, headers: CORS };
      return { status: 200, headers: { ...CORS, etag: etag(cur), 'content-type': type, 'content-length': String(cur.length) }, body: method === 'GET' ? cur : undefined };
    }
    if (method !== 'PUT') return { status: 405, headers: { ...CORS, allow: 'GET, HEAD, PUT, OPTIONS' } };
    const ifMatch = headers['if-match'] ?? null;
    const overwritable = kind === 'profile' || kind === 'head' || kind.startsWith('feed') || kind === 'index.html';
    if (overwritable) {                                                   // §9.1 compare-and-swap
      if ((cur ? etag(cur) : null) !== ifMatch) return { status: 412, headers: { ...CORS, ...(cur ? { etag: etag(cur) } : {}) } };
      if (kind === 'profile') {                                           // §9.4: first come, same genesis, pseq advanced, and it must verify
        const o = body(bytes), old = cur && body(cur);
        if (!o || !wellFormed(o)) return { status: 400, headers: CORS };
        if (old && (old.genesis !== o.genesis || !(o.pseq > old.pseq))) return { status: 409, headers: CORS };
        const chain = walk(o, adoptCourts({}, o, 0));
        if (!chain || !verifyFile(bytes, chain.current)) return { status: 403, headers: CORS };
      } else if (kind === 'head') {
        const chain = chainOf(name);
        if (!chain) return { status: 404, headers: CORS };                // claim the name first
        const h = verifyFile(bytes, chain.current);
        if (!h) return { status: 403, headers: CORS };
      }
      store.set(key, bytes);
      return { status: 200, headers: { ...CORS, etag: etag(bytes) } };
    }
    if (hash) {                                                           // §9.6: the content-addressed twin
      if (cur && sha256(cur) === hash) return { status: 409, headers: CORS };
      if (sha256(bytes) !== hash) return { status: cur ? 409 : 400, headers: CORS };
      store.set(key, bytes);
      return { status: cur ? 200 : 201, headers: CORS };
    }
    const n = Number(num);                                                // §9.2 create-once, §9.5 reclaim
    if (cur) {
      if (ownersFile(name, cur, n) || !ownersFile(name, bytes, n)) return { status: 409, headers: CORS };
      store.set(key, bytes);
      return { status: 200, headers: CORS };
    }
    store.set(key, bytes);
    return { status: 201, headers: CORS };
  }

  /** §9.8: drop files the current head does not list, after the caller's grace window. */
  function collect(name, { keep = () => false } = {}) {
    const h = body(store.get(`${name}/head`) ?? Buffer.alloc(0)); const set = h && fold(h.entries);
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
      const r = hub.handle({ method: req.method, path: req.url.split('?')[0], headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(r.status, r.headers ?? {});
      res.end(r.body);
    });
  };
  const server = tls ? https.createServer(tls, onRequest) : http.createServer(onRequest);
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, url: `${tls ? 'https' : 'http'}://${host}:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}
