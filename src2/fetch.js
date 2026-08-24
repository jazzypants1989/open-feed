// §10 — the outbound fetch layer. Nothing else in `src2/` opens a socket.
//
// Two decisions worth stating, because both are easy to get subtly wrong:
//
// 1. The address check runs in two places, and needs both. A custom `lookup` filters resolved
//    addresses before the socket connects, so the socket connects to exactly the address that was
//    checked — validating and then letting the stack resolve again would leave a DNS-rebinding
//    window. But Node never calls `lookup` when the host is already an IP literal, so a literal is
//    checked on the URL as well.
// 2. Redirects are followed by hand, because §10's rule — never to a different origin, each hop
//    re-checked for scheme and address — can only be enforced at each hop.
//
// A fetch returns bytes and the hub's entity tag; it never parses, never looks at the media type
// (Appendix A: the signature covers the bytes and no type is inside it), and never decides a
// verdict: a transport failure throws a `FetchError`, which §10 says is no verdict at all.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { isPublicAddress } from './addresses.js';

export class FetchError extends Error {
  constructor(message, { code = 'fetch_failed', url, status, transient = false } = {}) {
    super(message); this.name = 'FetchError'; this.code = code; this.url = url; this.status = status; this.transient = transient;
  }
}

export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;
export const MAX_SOCKETS_PER_ORIGIN = 10;
export const MAX_BYTES = { profile: 1024 * 1024, head: 1024 * 1024, post: 1024 * 1024, media: 50 * 1024 * 1024 };
export const MAX_IDENTITIES_PER_PASS = 200;

/** The DNS half of the address guard: resolve, drop what the policy refuses, connect only to what survived. */
export function guardedLookup(isAddressAllowed, resolve = dns.lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const allowed = addresses.filter((a) => isAddressAllowed(a.address));
      if (allowed.length === 0) {
        return callback(new FetchError(`refusing to connect to ${hostname}: resolves only to non-public addresses (${addresses.map((a) => a.address).join(', ')})`, { code: 'blocked_address' }));
      }
      if (options.all) return callback(null, allowed);
      return callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

/**
 * A fetcher with an explicit security policy. `resolve` and `tls` are the two seams a test needs
 * (a name that exists only in the test, a pinned CA); neither weakens anything by default.
 */
export function createFetcher({
  protocols = ['https:'],
  isAddressAllowed = isPublicAddress,
  timeoutMs = TIMEOUT_MS,
  maxRedirects = MAX_REDIRECTS,
  maxBytes = MAX_BYTES,
  userAgent = 'open-feed/0.1',
  resolve,
  tls = {},
} = {}) {
  const lookup = guardedLookup(isAddressAllowed, resolve);
  const agents = {
    'https:': new https.Agent({ keepAlive: false, maxSockets: MAX_SOCKETS_PER_ORIGIN }),
    'http:': new http.Agent({ keepAlive: false, maxSockets: MAX_SOCKETS_PER_ORIGIN }),
  };

  function assertUrlAllowed(url, { from } = {}) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new FetchError(`not a URL: ${url}`, { code: 'bad_url', url }); }
    const via = from ? ` (redirected from ${from})` : '';
    if (!protocols.includes(parsed.protocol)) throw new FetchError(`refusing ${parsed.protocol} URL${via}: ${url}`, { code: 'bad_scheme', url });
    const literal = parsed.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && !isAddressAllowed(literal)) throw new FetchError(`refusing to connect to ${literal}${via}: not a public address`, { code: 'blocked_address', url });
    return parsed;
  }

  const capFor = (parsed) => (/\/media\//.test(parsed.pathname) ? maxBytes.media : /\/posts\//.test(parsed.pathname) ? maxBytes.post : maxBytes.profile);

  function requestOnce(parsed, { method, headers, body, deadlineAt, register }) {
    if (deadlineAt - Date.now() <= 0) throw new FetchError(`timed out before requesting ${parsed.href}`, { code: 'timeout', url: parsed.href, transient: true });
    return new Promise((resolvePromise, reject) => {
      const mod = parsed.protocol === 'http:' ? http : https;
      const req = mod.request(parsed, { method, agent: agents[parsed.protocol], lookup, ...(parsed.protocol === 'https:' ? tls : {}), headers: { 'accept-encoding': 'identity', 'user-agent': userAgent, ...headers } }, (res) => resolvePromise({ res, req }));
      register(req);
      req.on('error', (err) => reject(err instanceof FetchError ? err : new FetchError(`${parsed.href}: ${err.message}`, { code: err.code === 'blocked_address' ? 'blocked_address' : 'connect_failed', url: parsed.href, transient: err.code !== 'blocked_address' })));
      req.end(body);
    });
  }

  function readCapped(res, req, { max, url }) {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > max) { req.destroy(); throw new FetchError(`${url} declares ${declared} bytes, over the ${max} byte cap`, { code: 'too_large', url }); }
    return new Promise((resolvePromise, reject) => {
      const chunks = []; let total = 0;
      res.on('data', (chunk) => { total += chunk.length; if (total > max) { req.destroy(); reject(new FetchError(`${url} exceeds the ${max} byte cap`, { code: 'too_large', url })); return; } chunks.push(chunk); });
      res.on('error', (err) => reject(new FetchError(`${url}: ${err.message}`, { code: 'read_failed', url, transient: true })));
      res.on('end', () => resolvePromise(Buffer.concat(chunks, total)));
    });
  }

  /** One request under one deadline covering connect, redirects and body together. */
  async function request(rawUrl, { method = 'GET', headers = {}, body, followRedirects = method === 'GET', max } = {}) {
    const startUrl = assertUrlAllowed(rawUrl);
    const deadlineAt = Date.now() + timeoutMs;
    let parsed = startUrl, hops = 0, current = null, timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; current?.destroy(); }, timeoutMs);
    try {
      for (;;) {
        const { res, req } = await requestOnce(parsed, { method, headers, body, deadlineAt, register: (r) => { current = r; } });
        if (followRedirects && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          if (++hops > maxRedirects) throw new FetchError(`more than ${maxRedirects} redirects from ${startUrl.href}`, { code: 'too_many_redirects', url: startUrl.href });
          const next = assertUrlAllowed(new URL(res.headers.location, parsed).href, { from: parsed.href });
          if (next.origin !== parsed.origin) throw new FetchError(`refusing cross-origin redirect ${parsed.origin} -> ${next.origin}: moving is expressed in the profile, not a Location header (§10)`, { code: 'cross_origin_redirect', url: startUrl.href });
          parsed = next; continue;
        }
        const bytes = await readCapped(res, req, { max: max ?? capFor(parsed), url: parsed.href });
        return { status: res.statusCode, headers: res.headers, bytes, url: parsed.href };
      }
    } catch (e) {
      if (timedOut) throw new FetchError(`timed out after ${timeoutMs} ms: ${startUrl.href}`, { code: 'timeout', url: startUrl.href, transient: true });
      throw e;
    } finally { clearTimeout(deadline); }
  }

  /** GET: `{ bytes, etag }`, null for a 404; a FetchError for anything else (no verdict). */
  async function get(url, opts) {
    const r = await request(url, opts);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new FetchError(`${r.url} returned HTTP ${r.status}`, { code: 'bad_status', url: r.url, status: r.status, transient: r.status >= 500 || r.status === 429 });
    return { bytes: r.bytes, etag: r.headers.etag ?? null };
  }
  /** PUT: `{ status, etag }` — the publish interface's answer, never interpreted here. */
  async function put(url, bytes, { ifMatch = null, contentType = 'application/openfeed+json' } = {}) {
    const r = await request(url, { method: 'PUT', body: bytes, headers: { 'content-type': contentType, 'content-length': String(bytes.length), ...(ifMatch ? { 'if-match': ifMatch } : {}) }, followRedirects: false });
    return { status: r.status, etag: r.headers.etag ?? null };
  }
  return { get, put, request, assertUrlAllowed };
}
