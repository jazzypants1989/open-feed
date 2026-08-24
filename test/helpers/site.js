// The test origin for the spec: `src/hub.js` behind a TLS socket with the hand-encoded certificate
// (§2.1 of the old spec made HTTPS part of the identity; §9 of this one makes it the only
// transport), and an in-memory io over `hub.handle` for the tests that need no socket at all.
import { selfSignedCertificate } from './tls.js';
import { isPublicOrLoopbackAddress } from '../../src/addresses.js';
import { createFetcher } from '../../src/fetch.js';
import { createHub, listen } from '../../src/hub.js';
import { createReader } from '../../src/reader.js';
import { createPublisher } from '../../src/publish.js';
import * as file from '../../src/file.js';
import * as profile from '../../src/profile.js';

export const HOSTNAME = 'hub.example';
export const TLS = selfSignedCertificate([HOSTNAME, '127.0.0.1']);

/** An io over the handler: no socket, same rules. `base` lets several names share one hub. */
export function memIo(hub) {
  return {
    get: async (url) => { const r = hub.handle({ method: 'GET', path: new URL(url, 'https://x').pathname }); return r.status === 404 ? null : r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : (() => { throw new Error(`GET ${url}: ${r.status}`); })(); },
    put: async (url, bytes, { ifMatch = null } = {}) => { const r = hub.handle({ method: 'PUT', path: new URL(url, 'https://x').pathname, headers: ifMatch ? { 'if-match': ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
  };
}

/** A hub over TLS on loopback, closed when the test ends. */
export async function tlsHub(t, opts) {
  const hub = createHub(opts);
  const srv = await listen(hub, { tls: { key: TLS.key, cert: TLS.cert } });
  t.after(() => srv.close());
  return { hub, url: `https://${HOSTNAME}:${new URL(srv.url).port}`, raw: srv.url };
}

/** A consumer's fetcher: pinned CA, loopback allowed, a resolver that knows one name. */
export function consumerFetcher(extra = {}) {
  return createFetcher({
    isAddressAllowed: isPublicOrLoopbackAddress,
    tls: { ca: [TLS.cert] },
    resolve: (hostname, options, callback) => (hostname === HOSTNAME
      ? callback(null, [{ address: '127.0.0.1', family: 4 }])
      : callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }))),
    ...extra,
  });
}

// ---- people ----
export const person = (name, { salt = `salt-${name}` } = {}) => ({ name, key: file.newSigningKey(), salt });
export const members = (...ps) => ps.map((p) => ({ key: p.key, salt: p.salt }));
export const list = (k, ...ps) => profile.commit(k, members(...ps));

/** Claim a name on a hub for `p`: profile at version 1, an empty index. Returns the publisher. */
export async function claim(io, p, at, { recovery, read, extra = {} } = {}) {
  const pub = createPublisher({ io, key: p.key, at });
  await pub.claim({ anchor: p.key.x, version: 1, ...(p.name ? { name: p.name } : {}), chain: [{ key: p.key.x }], recovery: recovery ?? { k: 0, leaves: [] }, locations: [at], ...(read ? { read } : {}), ...extra });
  return pub;
}
export const readerOver = (io) => createReader({ get: io.get });
export { file, profile };
