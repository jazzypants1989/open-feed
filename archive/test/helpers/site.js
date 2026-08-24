// A real origin, over a real socket, for the tests that need one.
//
// Extracted from `e2e.test.js` when the reader suite needed the same thing. It runs over HTTPS
// against a real hostname because §3.1 makes the scheme part of the identity and every layer
// enforces it — a `kid` naming a plaintext URL does not parse, so an http harness would be
// testing a protocol this is not. The certificate is handed to the fetcher as a **pinned CA**
// rather than by disabling validation, so §13.3 stays in force, and the hostname resolves
// through `createFetcher`'s `resolve` seam, which is the honest way to say `mom.example`
// exists in this test and nowhere else.

import https from 'node:https';
import crypto from 'node:crypto';

import { selfSignedCertificate } from './tls.js';
import { canonicalBytes, createFetcher, NegativeCache, PinStore, isPublicOrLoopbackAddress } from '../../src/index.js';

export const DAY = 86400;
export const T0 = 1736899200;
export const HOSTNAME = 'mom.example';
export const TLS = selfSignedCertificate([HOSTNAME, '127.0.0.1']);

export function makeSigner(kid = 'key-1', { use, iat = T0 - DAY } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat, kid, kty: 'OKP', x };
  if (use) jwk.use = use;
  return { kid, jwk, privateKey };
}

/**
 * Bind a server first, so the identity URL — which carries the port and is inside every signed
 * byte (§7.5) — is known before anything is signed. An identity URL is not a deployment detail
 * that can be rewritten afterwards, and this is that constraint showing up in a test harness.
 */
export async function newSite(t) {
  const files = new Map();
  const requested = [];
  const failures = new Map(); // path -> { status, times }
  const server = https.createServer({ key: TLS.key, cert: TLS.cert }, (req, res) => {
    const path = decodeURIComponent(req.url.replace(/^\//, ''));
    requested.push(path);

    // A staged transient failure, consumed once per scheduled occurrence: what §12's retry
    // ladder is for, and the only way to test it without waiting an hour.
    const fail = failures.get(path);
    if (fail && fail.times > 0) {
      fail.times -= 1;
      res.writeHead(fail.status, { 'content-type': 'application/json' });
      return res.end('{"error":"unavailable"}');
    }

    const body = files.get(path);
    if (!body) {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end('{"error":"not_found"}');
    }
    res.writeHead(200, {
      // Appendix A, and §3.3's ACAO on every publicly-readable document.
      'content-type': path.endsWith('feed.json') ? 'application/feed+json' : 'application/json',
      'access-control-allow-origin': '*',
      'content-length': String(body.length),
    });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  return {
    url: `https://${HOSTNAME}:${server.address().port}/`,
    files,
    requested,
    /** Publish a publisher's whole output. The server holds bytes, never the publisher. */
    serve(publisher) {
      for (const [path, bytes] of publisher.files()) files.set(path, bytes);
      return publisher;
    },
    /**
     * Overwrite one served path with a document. How rollback and equivocation are staged.
     *
     * Canonical bytes, not `JSON.stringify`: §6.3 is what a conformant producer emits and what
     * a consumer now insists on for a chained document, so a helper that serialized by
     * insertion order would stage every attack behind a conformance failure and prove nothing
     * about the attack. Staging *non*-canonical bytes is a different test — `replaceRaw`.
     */
    replace: (path, doc) => files.set(path, canonicalBytes(doc)),
    /** Overwrite one served path with exact bytes, conformant or not. */
    replaceRaw: (path, bytes) => files.set(path, Buffer.from(bytes)),
    remove: (path) => files.delete(path),
    /** Make the next `times` requests for `path` fail with `status`. */
    failNext: (path, { times = 1, status = 503 } = {}) => failures.set(path, { status, times }),
  };
}

/**
 * A consumer's fetch policy and pin store, and nothing else.
 *
 * `now` drives the negative cache as well as the pin store, because the negative cache *is*
 * §12's transient-failure ladder — 1 h / 4 h / 24 h — and no test is going to wait an hour.
 */
export function consumer(t, { now = () => T0 } = {}) {
  const fetcher = createFetcher({
    isAddressAllowed: isPublicOrLoopbackAddress,
    negativeCache: new NegativeCache({ now }),
    tls: { ca: [TLS.cert] },
    resolve: (hostname, options, callback) => (
      hostname === HOSTNAME
        ? callback(null, [{ address: '127.0.0.1', family: 4 }])
        : callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }))
    ),
  });
  t.after(() => fetcher.close());
  return { fetcher, pins: new PinStore({ now }), negativeCache: fetcher.negativeCache };
}
