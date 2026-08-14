// The outbound fetch layer. Nothing else in `src/` opens a socket.
//
// Spec §13.5 states the rule in one line — "HTTPS only, ≤5 redirects, 10 s timeout, size
// limits, reject private/loopback/link-local addresses, dedicated restrictive HTTP client"
// — and this module is that client. §3.3 adds the identity-document rules, §13.4 the caps,
// §12 the negative-caching schedule, and Appendix A the content types.
//
// Two decisions worth stating, because both are easy to get subtly wrong:
//
// 1. The address check runs in two places, and needs both. A custom `lookup` filters
//    resolved addresses before the socket connects, so the socket connects to exactly the
//    address that was checked — validating and then letting the stack resolve again would
//    leave a DNS-rebinding window between the two lookups. But Node never calls `lookup`
//    when the host is already an IP literal, so `https://169.254.169.254/` would sail past
//    a guard that only hooks DNS. Literals are therefore checked on the URL as well.
// 2. Redirects are followed by hand. Node would follow them for us, but §3.3's rule that an
//    identity document MUST NOT follow a cross-origin redirect can only be enforced at each
//    hop, and each hop also has to be re-checked for scheme and address.

import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { isPublicAddress } from './addresses.js';
import { parseIJSON } from './canonical.js';
import { normalizeIdentityUrl } from './jws.js';

export class FetchError extends Error {
  constructor(message, { code = 'fetch_failed', url, status, transient = false } = {}) {
    super(message);
    this.code = code;
    this.url = url;
    this.status = status;
    // Transient failures are the ones §12 says to cache and retry rather than reject
    // permanently: connection trouble and 5xx, never a policy refusal.
    this.transient = transient;
  }
}

// ---- §13.4 resource limits ----

export const SIZE_CAPS = {
  identity: 100 * 1024,
  manifest: 1024 * 1024,
  feed: 10 * 1024 * 1024,
  inbox: 100 * 1024,
  json: 1024 * 1024,
};

export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;
export const MAX_SOCKETS_PER_ORIGIN = 10;
export const HISTORY_BYTES_PER_UPDATE = 10 * 1024 * 1024;

/**
 * The §13.4 budget on total history bytes fetched per update. The chain layer walks an
 * unknown number of versions, so the bound has to be carried across fetches rather than
 * applied to any one of them.
 */
export class ByteBudget {
  constructor(limit = HISTORY_BYTES_PER_UPDATE) {
    this.limit = limit;
    this.spent = 0;
  }
  get remaining() {
    return Math.max(0, this.limit - this.spent);
  }
  charge(bytes, url) {
    this.spent += bytes;
    if (this.spent > this.limit) {
      throw new FetchError(`history byte budget exhausted: ${this.spent} > ${this.limit}`, {
        code: 'budget_exhausted', url,
      });
    }
  }
}

// ---- Appendix A content types ----

/** The media type alone, lowercased — parameters and casing carry no meaning here. */
export function mediaType(contentTypeHeader) {
  if (typeof contentTypeHeader !== 'string') return '';
  return contentTypeHeader.split(';')[0].trim().toLowerCase();
}

/**
 * Appendix A: identity documents, manifests, and the rest accept any JSON; feeds accept
 * `application/feed+json` or `application/json`. Both collapse to one rule, because
 * `application/feed+json` is JSON by the `+json` structured suffix.
 *
 * §7.1 is explicit that this check exists to avoid parsing HTML error pages, not to police
 * vendor types — a static host serving `application/json` MUST be accepted.
 */
export function isJsonMediaType(type) {
  return type === 'application/json' || /^application\/[a-z0-9.\-+]*\+json$/.test(type);
}

// ---- §12 negative caching ----

/**
 * "If an identity-document or manifest fetch fails transiently, cache the failure and retry
 * (1 h, 4 h, 24 h) before permanent rejection." Four attempts total: the original and three
 * retries at widening intervals, then the URL is rejected without a fetch.
 */
export const MAX_NEGATIVE_CACHE_ENTRIES = 4096;

export class NegativeCache {
  /**
   * `maxEntries` bounds the map because §13.9 makes it attacker-driven: the `author` in a
   * delivered item is attacker-controlled until verification succeeds, and every failed
   * lookup of a claimed author's identity document lands here. Eviction is oldest-failure
   * first, which loses only backoff state — the URL is refetched rather than wrongly trusted.
   */
  constructor({
    schedule = [3600, 4 * 3600, 24 * 3600],
    now = () => Math.floor(Date.now() / 1000),
    maxEntries = MAX_NEGATIVE_CACHE_ENTRIES,
  } = {}) {
    this.schedule = schedule;
    this.now = now;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  #evict() {
    while (this.entries.size > this.maxEntries) {
      let oldestUrl = null;
      let oldest = Infinity;
      for (const [url, entry] of this.entries) {
        if (entry.lastFailure < oldest) { oldest = entry.lastFailure; oldestUrl = url; }
      }
      this.entries.delete(oldestUrl);
    }
  }

  /** Throws if this URL is inside a backoff window or has exhausted the schedule. */
  assertFetchable(url) {
    const entry = this.entries.get(url);
    if (!entry) return;
    if (entry.failures > this.schedule.length) {
      throw new FetchError(`${url} failed ${entry.failures} times and is permanently rejected`, {
        code: 'negatively_cached', url,
      });
    }
    const waitFor = this.schedule[entry.failures - 1];
    const readyAt = entry.lastFailure + waitFor;
    if (this.now() < readyAt) {
      throw new FetchError(`${url} failed recently; not retrying until ${readyAt}`, {
        code: 'negatively_cached', url, transient: true,
      });
    }
  }

  recordFailure(url) {
    const entry = this.entries.get(url) ?? { failures: 0, lastFailure: 0 };
    entry.failures += 1;
    entry.lastFailure = this.now();
    this.entries.set(url, entry);
    this.#evict();
    return entry;
  }

  recordSuccess(url) {
    this.entries.delete(url);
  }
}

// ---- identity documents (§3.2, §13.9) ----

/**
 * The identity document's URL, derived from the identity URL and never taken from input.
 * §13.9: fetch only the fixed-path document of the claimed author, never an arbitrary URL
 * out of a `kid`. The path convention is what makes that structural rather than a check.
 */
export function identityDocumentUrl(identityUrl) {
  return `${normalizeIdentityUrl(identityUrl)}openfeed.json`;
}

/**
 * §3.2: an identity document's `url` MUST match the URL it was fetched under, after
 * normalization. It is the document's own author binding, so a mismatch is a trust failure
 * and not a formatting problem.
 */
export function assertIdentityMatches(doc, identity, fetchedUrl = identityDocumentUrl(identity)) {
  const expected = normalizeIdentityUrl(identity);
  let claimed;
  try {
    claimed = normalizeIdentityUrl(doc?.url);
  } catch {
    throw new FetchError(`${fetchedUrl} has no usable \`url\` field`, {
      code: 'identity_mismatch', url: fetchedUrl,
    });
  }
  if (claimed !== expected) {
    throw new FetchError(`${fetchedUrl} claims to be ${claimed}, not ${expected}`, {
      code: 'identity_mismatch', url: fetchedUrl,
    });
  }
  return expected;
}

// ---- the fetcher ----

/**
 * The DNS half of the address guard: resolve, drop every address the policy refuses, and hand
 * the socket only what survived. This is the path that matters — a hostname tells you nothing,
 * since `localtest.me` resolves to 127.0.0.1 and an attacker controls their own zone.
 *
 * `resolve` is a parameter so the filter can be tested without a resolver that answers
 * differently on every machine. Nothing in `src/` passes anything but the default.
 */
export function guardedLookup(isAddressAllowed, resolve = dns.lookup) {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      const allowed = addresses.filter((a) => isAddressAllowed(a.address));
      if (allowed.length === 0) {
        const seen = addresses.map((a) => a.address).join(', ');
        return callback(new FetchError(
          `refusing to connect to ${hostname}: resolves only to non-public addresses (${seen})`,
          { code: 'blocked_address' },
        ));
      }
      if (options.all) return callback(null, allowed);
      return callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

/**
 * A fetcher with an explicit security policy.
 *
 * `protocols` and `isAddressAllowed` are parameters rather than flags so the defaults sit in
 * one visible place and a caller that wants something weaker has to say so by name. Nothing
 * in `src/` passes anything but the defaults.
 */
export function createFetcher({
  protocols = ['https:'],
  isAddressAllowed = isPublicAddress,
  timeoutMs = TIMEOUT_MS,
  maxRedirects = MAX_REDIRECTS,
  negativeCache = new NegativeCache(),
  userAgent = 'open-feed-verifier/0.1',
  resolve,
  tls = {},
} = {}) {
  // `resolve` and `tls` are the two seams a caller may need and must not fake by other means:
  // a resolver for a name that does not exist outside the caller's world, and TLS options for
  // pinning a CA. Neither weakens anything by default — `tls` is empty, so §13.3's certificate
  // validation is Node's, and an unset `resolve` is `dns.lookup`.
  const lookup = guardedLookup(isAddressAllowed, resolve);
  // A dedicated agent: §13.5's "dedicated restrictive HTTP client". maxSockets is per
  // origin in Node's agent, which is exactly §13.4's "concurrent fetches per origin 10".
  const agents = {
    'https:': new https.Agent({ keepAlive: false, maxSockets: MAX_SOCKETS_PER_ORIGIN }),
    'http:': new http.Agent({ keepAlive: false, maxSockets: MAX_SOCKETS_PER_ORIGIN }),
  };

  function assertUrlAllowed(url, { from } = {}) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new FetchError(`not a URL: ${url}`, { code: 'bad_url', url });
    }
    if (!protocols.includes(parsed.protocol)) {
      const via = from ? ` (redirected from ${from})` : '';
      throw new FetchError(`refusing ${parsed.protocol} URL${via}: ${url}`, { code: 'bad_scheme', url });
    }
    // A literal IP host never reaches the `lookup` hook — Node's net.connect resolves
    // nothing when it already has an address — so the guard has to be applied here too.
    // Without this, `https://169.254.169.254/` connects, and the DNS hook below looks like
    // it is protecting something it never sees.
    const literal = parsed.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(literal) && !isAddressAllowed(literal)) {
      const via = from ? ` (redirected from ${from})` : '';
      throw new FetchError(`refusing to connect to ${literal}${via}: not a public address`, {
        code: 'blocked_address', url,
      });
    }
    return parsed;
  }

  function requestOnce(parsed, { accept, deadlineAt, register }) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      throw new FetchError(`timed out before requesting ${parsed.href}`, {
        code: 'timeout', url: parsed.href, transient: true,
      });
    }
    return new Promise((resolve, reject) => {
      const mod = parsed.protocol === 'http:' ? http : https;
      const req = mod.request(parsed, {
        method: 'GET',
        agent: agents[parsed.protocol],
        lookup,
        ...(parsed.protocol === 'https:' ? tls : {}),
        headers: { accept, 'accept-encoding': 'identity', 'user-agent': userAgent },
      }, (res) => resolve({ res, req }));
      // The caller's single deadline covers connect, redirects, and body read together.
      // A per-socket inactivity timeout would add nothing and would miss the case it looks
      // like it catches: a server dribbling one byte at a time resets it forever.
      register(req);
      req.on('error', (err) => {
        reject(err instanceof FetchError ? err : new FetchError(
          `${parsed.href}: ${err.message}`,
          { code: err.code === 'blocked_address' ? 'blocked_address' : 'connect_failed',
            url: parsed.href,
            transient: err.code !== 'blocked_address' },
        ));
      });
      req.end();
    });
  }

  /** Read a response body, aborting the moment it exceeds `maxBytes` (§13.4). */
  function readCapped(res, req, { maxBytes, url }) {
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.destroy();
      throw new FetchError(`${url} declares ${declared} bytes, over the ${maxBytes} byte cap`, {
        code: 'too_large', url,
      });
    }
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          // Destroying the request rather than the response stops the transfer at the
          // socket; a cap that only refuses the parsed result has already paid the cost.
          req.destroy();
          reject(new FetchError(`${url} exceeds the ${maxBytes} byte cap`, { code: 'too_large', url }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', (err) => reject(new FetchError(`${url}: ${err.message}`, {
        code: 'read_failed', url, transient: true,
      })));
      res.on('end', () => resolve(Buffer.concat(chunks, total)));
    });
  }

  /**
   * Fetch and parse one JSON document.
   *
   * `sameOriginRedirectsOnly` implements §3.3 for identity documents: a cross-origin
   * redirect is never identity equivalence, because migration is expressed in-band (§3.4).
   */
  async function fetchDocument(rawUrl, {
    kind = 'json',
    maxBytes = SIZE_CAPS[kind] ?? SIZE_CAPS.json,
    sameOriginRedirectsOnly = false,
    budget = null,
    cache = negativeCache,
  } = {}) {
    const accept = kind === 'feed' ? 'application/feed+json, application/json' : 'application/json';
    const startUrl = assertUrlAllowed(rawUrl);
    cache?.assertFetchable(startUrl.href);

    const deadlineAt = Date.now() + timeoutMs;
    let parsed = startUrl;
    let hops = 0;

    // One hard ceiling over the whole operation, redirects and body read included. Per-hop
    // timeouts alone let a chain of slow-but-active responses run indefinitely.
    let current = null;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      current?.destroy();
    }, timeoutMs);
    const timeoutError = () => new FetchError(`timed out after ${timeoutMs} ms: ${startUrl.href}`, {
      code: 'timeout', url: startUrl.href, transient: true,
    });

    try {
      for (;;) {
        const { res, req } = await requestOnce(parsed, {
          accept, deadlineAt, register: (r) => { current = r; },
        });

        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          if (++hops > maxRedirects) {
            throw new FetchError(`more than ${maxRedirects} redirects from ${startUrl.href}`, {
              code: 'too_many_redirects', url: startUrl.href,
            });
          }
          const next = assertUrlAllowed(new URL(res.headers.location, parsed).href, { from: parsed.href });
          if (sameOriginRedirectsOnly && next.origin !== parsed.origin) {
            throw new FetchError(
              `refusing cross-origin redirect ${parsed.origin} -> ${next.origin}: a redirect is not identity equivalence (§3.3)`,
              { code: 'cross_origin_redirect', url: startUrl.href },
            );
          }
          parsed = next;
          continue;
        }

        if (res.statusCode !== 200) {
          req.destroy();
          throw new FetchError(`${parsed.href} returned HTTP ${res.statusCode}`, {
            code: 'bad_status', url: parsed.href, status: res.statusCode,
            transient: res.statusCode >= 500 || res.statusCode === 429,
          });
        }

        const type = mediaType(res.headers['content-type']);
        if (!isJsonMediaType(type)) {
          req.destroy();
          throw new FetchError(`${parsed.href} served ${type || 'no content type'}, not JSON`, {
            code: 'bad_content_type', url: parsed.href,
          });
        }

        const body = await readCapped(res, req, { maxBytes, url: parsed.href });
        budget?.charge(body.length, parsed.href);

        let doc;
        try {
          doc = parseIJSON(body.toString('utf8'));
        } catch (e) {
          throw new FetchError(`${parsed.href} is not I-JSON: ${e.message}`, {
            code: 'bad_json', url: parsed.href,
          });
        }

        cache?.recordSuccess(startUrl.href);
        return {
          url: parsed.href,
          requestedUrl: startUrl.href,
          redirects: hops,
          doc,
          bytes: body,
          contentType: type,
          // §3.3 and §13.3 require this header on every publicly-readable document, but it
          // is a publisher obligation that only a browser can enforce. Reported rather than
          // enforced, so a CLI can say the document is non-conforming without refusing it.
          cors: res.headers['access-control-allow-origin'] === '*',
        };
      }
    } catch (err) {
      const error = timedOut ? timeoutError() : err;
      if (error instanceof FetchError && error.transient) cache?.recordFailure(startUrl.href);
      throw error;
    } finally {
      clearTimeout(deadline);
    }
  }

  /**
   * Fetch an identity document by identity URL (§3.2, §13.9).
   *
   * The URL is *derived*, never taken from a caller-supplied string: §13.9 requires fetching
   * only the fixed-path document of the claimed author, never an arbitrary URL out of a
   * `kid`, and the path convention is what makes that structural rather than a check.
   */
  async function fetchIdentityDocument(identityUrl, options = {}) {
    const result = await fetchDocument(identityDocumentUrl(identityUrl), {
      ...options,
      kind: 'identity',
      sameOriginRedirectsOnly: true,
    });
    const identity = assertIdentityMatches(result.doc, identityUrl, result.url);
    return { ...result, identity };
  }

  return { fetchDocument, fetchIdentityDocument, negativeCache, close: () => {
    for (const agent of Object.values(agents)) agent.destroy();
  } };
}

const defaultFetcher = createFetcher();

export const fetchDocument = (...args) => defaultFetcher.fetchDocument(...args);
export const fetchIdentityDocument = (...args) => defaultFetcher.fetchIdentityDocument(...args);
