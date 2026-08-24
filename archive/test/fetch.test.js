// The fetch layer: §13.5's SSRF rule, §3.3's redirect and content-type discipline, §13.4's
// caps, §12's negative caching.
//
// The transport tests run against loopback HTTP servers through a fetcher built with an
// explicitly permissive policy. The shipping default refuses both loopback and `http:`, and
// the first two tests here assert exactly that — so the permissive policy used below cannot
// quietly become the default without those failing.
//
// One gap, stated rather than hidden: `fetchIdentityDocument` cannot be driven end to end,
// because §3.1 identity URLs are HTTPS and minting a certificate at test time needs a
// dependency this repo does not have. Its two distinctive behaviors — URL derivation and
// the §3.2 `url` match — are exported and tested directly; what remains uncovered is one
// delegating call with two literal options.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  createFetcher,
  fetchDocument,
  identityDocumentUrl,
  assertIdentityMatches,
  guardedLookup,
  isJsonMediaType,
  mediaType,
  NegativeCache,
  ByteBudget,
  FetchError,
  SIZE_CAPS,
  MAX_NEGATIVE_CACHE_ENTRIES,
} from '../src/fetch.js';
import { isPublicAddress, isPublicOrLoopbackAddress } from '../src/addresses.js';

/** A fetcher that may talk to loopback over plain HTTP. Never the default; see the header. */
function testFetcher(options = {}) {
  return createFetcher({
    protocols: ['http:', 'https:'],
    isAddressAllowed: isPublicOrLoopbackAddress,
    negativeCache: new NegativeCache(),
    ...options,
  });
}

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

const json = (res, body, { type = 'application/json', status = 200, cors = true, headers = {} } = {}) => {
  res.writeHead(status, {
    'content-type': type,
    ...(cors ? { 'access-control-allow-origin': '*' } : {}),
    ...headers,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const rejects = (fn, code) => assert.rejects(fn, (e) => {
  assert.ok(e instanceof FetchError, `expected FetchError, got ${e?.constructor?.name}: ${e?.message}`);
  assert.equal(e.code, code, `expected code ${code}, got ${e.code} (${e.message})`);
  return true;
});

// ---- the default policy ----

test('the default fetcher refuses plaintext HTTP', async () => {
  // §13.5: HTTPS only. Refused on the URL, before any lookup or socket.
  await rejects(() => fetchDocument('http://example.com/openfeed.json'), 'bad_scheme');
  await rejects(() => fetchDocument('ftp://example.com/x.json'), 'bad_scheme');
  await rejects(() => fetchDocument('file:///etc/passwd'), 'bad_scheme');
});

test('the default fetcher refuses addresses it must not connect to', async () => {
  // Resolution happens (it is local for literals and /etc/hosts) but the connection does not.
  await rejects(() => fetchDocument('https://127.0.0.1/openfeed.json'), 'blocked_address');
  await rejects(() => fetchDocument('https://[::1]/openfeed.json'), 'blocked_address');
  await rejects(() => fetchDocument('https://169.254.169.254/latest/meta-data/'), 'blocked_address');
  await rejects(() => fetchDocument('https://10.0.0.1/openfeed.json'), 'blocked_address');
});

// ---- happy path and content types ----

test('a JSON document is fetched, parsed, and reported with its CORS state', async (t) => {
  const base = await serve(t, (req, res) => {
    if (req.url === '/cors.json') return json(res, { url: 'https://a.example/', seq: 1 });
    return json(res, { seq: 2 }, { cors: false });
  });
  const f = testFetcher();
  t.after(() => f.close());

  const ok = await f.fetchDocument(`${base}/cors.json`);
  assert.deepEqual(ok.doc, { url: 'https://a.example/', seq: 1 });
  assert.equal(ok.cors, true);
  assert.equal(ok.redirects, 0);
  assert.equal(ok.contentType, 'application/json');

  // A missing ACAO is a publisher defect only a browser can enforce, so it is reported
  // rather than raised — a CLI can call the document non-conforming without refusing it.
  const noCors = await f.fetchDocument(`${base}/plain.json`);
  assert.equal(noCors.cors, false);
});

test('non-JSON content types are refused', async (t) => {
  // §7.1: the check exists to avoid parsing HTML error pages.
  const base = await serve(t, (req, res) => {
    if (req.url === '/html') return json(res, '<html>404</html>', { type: 'text/html' });
    if (req.url === '/none') { res.writeHead(200); return res.end('{}'); }
    if (req.url === '/text') return json(res, '{}', { type: 'text/plain' });
    if (req.url === '/feed') return json(res, { version: 'https://jsonfeed.org/version/1.1' }, { type: 'application/feed+json' });
    return json(res, {}, { type: 'application/json; charset=utf-8' });
  });
  const f = testFetcher();
  t.after(() => f.close());

  await rejects(() => f.fetchDocument(`${base}/html`), 'bad_content_type');
  await rejects(() => f.fetchDocument(`${base}/none`), 'bad_content_type');
  await rejects(() => f.fetchDocument(`${base}/text`), 'bad_content_type');

  // Appendix A: a feed may be either type, and a parameter on the header changes nothing.
  assert.ok(await f.fetchDocument(`${base}/feed`, { kind: 'feed' }));
  assert.ok(await f.fetchDocument(`${base}/params`));
});

test('the media type rule matches Appendix A', () => {
  for (const t of ['application/json', 'application/feed+json', 'application/activity+json']) {
    assert.equal(isJsonMediaType(t), true, t);
  }
  for (const t of ['text/html', 'text/json', 'application/xml', 'application/jsonx', '', 'json']) {
    assert.equal(isJsonMediaType(t), false, t);
  }
  assert.equal(mediaType('Application/JSON; charset=UTF-8'), 'application/json');
  assert.equal(mediaType(undefined), '');
});

test('a document that is not I-JSON is refused by the fetch path', async (t) => {
  // §6.3's duplicate-member rule has to hold at ingest, not only at verification: a
  // document that parses two ways has already defeated the signature by the time anyone
  // checks one.
  const base = await serve(t, (req, res) => json(res, '{"seq":1,"seq":2}'));
  const f = testFetcher();
  t.after(() => f.close());
  await rejects(() => f.fetchDocument(`${base}/dup.json`), 'bad_json');
});

// ---- §13.4 caps ----

test('a body over its cap is refused, declared or not', async (t) => {
  const big = 'x'.repeat(4096);
  const base = await serve(t, (req, res) => {
    if (req.url === '/declared') {
      // Content-length present: refused before a byte of body is read.
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(big.length + 20) });
      return res.end(JSON.stringify({ pad: big }));
    }
    // Chunked, so the cap has to be enforced while streaming.
    res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' });
    res.write('{"pad":"');
    res.write(big);
    res.end('"}');
  });
  const f = testFetcher();
  t.after(() => f.close());

  await rejects(() => f.fetchDocument(`${base}/declared`, { maxBytes: 1024 }), 'too_large');
  await rejects(() => f.fetchDocument(`${base}/chunked`, { maxBytes: 1024 }), 'too_large');
  assert.ok(await f.fetchDocument(`${base}/chunked`, { maxBytes: 65536 }));
});

test('each document kind carries its own §13.4 cap', () => {
  assert.equal(SIZE_CAPS.identity, 100 * 1024);
  assert.equal(SIZE_CAPS.manifest, 1024 * 1024);
  assert.equal(SIZE_CAPS.feed, 10 * 1024 * 1024);
  assert.equal(SIZE_CAPS.inbox, 100 * 1024);
});

test('the history byte budget bounds a walk rather than any one fetch', async (t) => {
  const base = await serve(t, (req, res) => json(res, { pad: 'x'.repeat(2000) }));
  const f = testFetcher();
  t.after(() => f.close());

  const budget = new ByteBudget(5000);
  await f.fetchDocument(`${base}/1.json`, { budget });
  await f.fetchDocument(`${base}/2.json`, { budget });
  assert.ok(budget.spent > 4000 && budget.remaining < 1000);
  await rejects(() => f.fetchDocument(`${base}/3.json`, { budget }), 'budget_exhausted');
});

// ---- §3.3 redirects ----

test('same-origin redirects are followed, up to the cap', async (t) => {
  const base = await serve(t, (req, res) => {
    const hop = Number(req.url.slice(1).split('.')[0]);
    if (hop > 0) {
      res.writeHead(302, { location: `/${hop - 1}.json` });
      return res.end();
    }
    return json(res, { arrived: true });
  });
  const f = testFetcher();
  t.after(() => f.close());

  const ok = await f.fetchDocument(`${base}/5.json`);
  assert.deepEqual(ok.doc, { arrived: true });
  assert.equal(ok.redirects, 5);
  assert.equal(ok.url, `${base}/0.json`);
  assert.equal(ok.requestedUrl, `${base}/5.json`);

  await rejects(() => f.fetchDocument(`${base}/6.json`), 'too_many_redirects');
});

test('nothing this protocol defines follows a cross-origin redirect', async (t) => {
  // §3.3: a cross-origin redirect is never identity equivalence — migration is expressed
  // in-band (§3.4). Two loopback servers differ only by port, which is enough.
  const other = await serve(t, (req, res) => json(res, { url: 'https://evil.example/' }));
  const base = await serve(t, (req, res) => {
    res.writeHead(302, { location: `${other}/openfeed.json` });
    res.end();
  });
  const f = testFetcher();
  t.after(() => f.close());

  await rejects(
    () => f.fetchDocument(`${base}/openfeed.json`, { sameOriginRedirectsOnly: true }),
    'cross_origin_redirect',
  );
  // The rule is not identity-specific, and reading it as though it were left the two chained
  // documents a pin is *keyed on* redirectable. §5.3.1 compares observations of one URL, so
  // letting that URL's bytes come from another origin is the substitution a pin exists to catch,
  // arranged by the party being watched.
  await rejects(() => f.fetchDocument(`${base}/feed.json`, { kind: 'feed' }), 'cross_origin_redirect');
  await rejects(() => f.fetchDocument(`${base}/manifest.json`, { kind: 'manifest' }), 'cross_origin_redirect');

  // `kind: 'json'` is the unclassified default — a URL this protocol does not define — where
  // inventing a rule for somebody else's fetch would be overreach.
  const loose = await f.fetchDocument(`${base}/whatever.json`);
  assert.equal(loose.url, `${other}/openfeed.json`);
});

test('a redirect cannot escape the scheme or address policy', async (t) => {
  // The check is re-applied per hop: a redirect is a fresh outbound fetch, and this is the
  // classic way an SSRF guard that only validates the first URL is defeated.
  const base = await serve(t, (req, res) => {
    const to = req.url === '/scheme' ? 'file:///etc/passwd' : 'http://169.254.169.254/latest/';
    res.writeHead(302, { location: to });
    res.end();
  });
  const f = testFetcher();
  t.after(() => f.close());

  await rejects(() => f.fetchDocument(`${base}/scheme`), 'bad_scheme');
  await rejects(() => f.fetchDocument(`${base}/address`), 'blocked_address');
});

// ---- status, timeout, negative caching ----

test('a non-200 response is refused, and 5xx is marked transient', async (t) => {
  const base = await serve(t, (req, res) => {
    res.writeHead(Number(req.url.slice(1)), { 'content-type': 'application/json' });
    res.end('{}');
  });
  const f = testFetcher();
  t.after(() => f.close());

  await assert.rejects(() => f.fetchDocument(`${base}/404`), (e) => {
    assert.equal(e.code, 'bad_status');
    assert.equal(e.status, 404);
    // §12's retry schedule is for transient failures; a 404 is an answer, not a failure.
    assert.equal(e.transient, false);
    return true;
  });
  await assert.rejects(() => f.fetchDocument(`${base}/503`), (e) => {
    assert.equal(e.transient, true);
    return true;
  });
});

test('a response that never arrives hits the deadline', async (t) => {
  const base = await serve(t, () => { /* deliberately never responds */ });
  const f = testFetcher({ timeoutMs: 200 });
  t.after(() => f.close());
  await rejects(() => f.fetchDocument(`${base}/hang.json`), 'timeout');
});

test('the negative cache follows §12: 1 h, 4 h, 24 h, then permanent', () => {
  let clock = 1_000_000;
  const cache = new NegativeCache({ now: () => clock });
  const url = 'https://a.example/openfeed.json';

  cache.assertFetchable(url); // unknown URL: always fetchable

  cache.recordFailure(url);
  assert.throws(() => cache.assertFetchable(url), (e) => e.code === 'negatively_cached');
  clock += 3600;
  cache.assertFetchable(url); // 1 h later, retry

  cache.recordFailure(url);
  clock += 3600;
  assert.throws(() => cache.assertFetchable(url)); // 4 h window, not 1 h
  clock += 3 * 3600;
  cache.assertFetchable(url);

  cache.recordFailure(url);
  clock += 24 * 3600;
  cache.assertFetchable(url);

  cache.recordFailure(url); // fourth failure exhausts the schedule
  clock += 365 * 24 * 3600;
  assert.throws(() => cache.assertFetchable(url), (e) => {
    assert.equal(e.code, 'negatively_cached');
    assert.equal(e.transient, false, 'a permanently rejected URL is not a transient failure');
    return true;
  });

  cache.recordSuccess(url);
  cache.assertFetchable(url); // success clears the record
});

test('transient failures reach the negative cache and policy refusals do not', async (t) => {
  const base = await serve(t, (req, res) => {
    res.writeHead(req.url === '/503.json' ? 503 : 404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  const cache = new NegativeCache();
  const f = testFetcher({ negativeCache: cache });
  t.after(() => f.close());

  await rejects(() => f.fetchDocument(`${base}/503.json`), 'bad_status');
  assert.throws(() => cache.assertFetchable(`${base}/503.json`), (e) => e.code === 'negatively_cached');

  // A 404 is a definite answer; caching it as a transient failure would suppress retries
  // that are not the caller's to lose.
  await rejects(() => f.fetchDocument(`${base}/404.json`), 'bad_status');
  cache.assertFetchable(`${base}/404.json`);
});

// ---- §3.2 / §13.9 identity documents ----

test('the identity document URL is derived, never taken from input', () => {
  // §13.9: fetch only the fixed-path document of the claimed author.
  assert.equal(identityDocumentUrl('https://a.example/'), 'https://a.example/openfeed.json');
  assert.equal(identityDocumentUrl('https://a.example'), 'https://a.example/openfeed.json');
  assert.equal(identityDocumentUrl('https://A.Example/~mom'), 'https://a.example/~mom/openfeed.json');
  assert.equal(identityDocumentUrl('https://a.example/?x=1#k'), 'https://a.example/openfeed.json');
  // A kid naming somewhere else cannot steer the fetch: only the identity URL is used.
  assert.equal(identityDocumentUrl('https://a.example/#key-1'), 'https://a.example/openfeed.json');
  assert.throws(() => identityDocumentUrl('http://a.example/'));
});

test('an identity document must claim the identity it was fetched under', () => {
  const at = 'https://a.example/';
  assert.equal(assertIdentityMatches({ url: 'https://a.example/' }, at), at);
  assert.equal(assertIdentityMatches({ url: 'https://A.example' }, at), at);
  for (const doc of [{ url: 'https://b.example/' }, { url: 'https://a.example/~mom/' }, {}, { url: 5 }, null]) {
    assert.throws(() => assertIdentityMatches(doc, at), (e) => e.code === 'identity_mismatch');
  }
});

// ---- §13.5, the DNS half of the address guard ----
//
// Every transport test above uses a `127.0.0.1` literal, which Node resolves not at all — so
// it takes `assertUrlAllowed`'s `net.isIP` branch and never reaches the `lookup` hook. That
// leaves the hostname path, which is the one that matters, exercised by nothing. These drive
// it directly with a stub resolver, because a real one answers differently on every machine.

/** A `dns.lookup`-shaped stub. Records how it was called so the option pass-through is checked. */
function stubResolver(byName) {
  const calls = [];
  const resolve = (hostname, options, callback) => {
    calls.push({ hostname, options });
    const found = byName[hostname];
    if (!found) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }));
    callback(null, found);
  };
  return { resolve, calls };
}

test('the DNS guard drops non-public addresses before the socket connects', () => {
  // A hostname tells you nothing: an attacker controls their own zone, so the check is on
  // what came back. Here one name resolves to both a public and a private address.
  const { resolve, calls } = stubResolver({
    'split.example': [{ address: '169.254.169.254', family: 4 }, { address: '93.184.216.34', family: 4 }],
  });
  const lookup = guardedLookup(isPublicAddress, resolve);

  let got;
  lookup('split.example', {}, (err, address, family) => { got = { err, address, family }; });
  assert.equal(got.err, null);
  assert.equal(got.address, '93.184.216.34', 'the link-local address must not reach the socket');
  assert.equal(got.family, 4);

  // The hook always resolves with `all`, whatever the caller asked, because it has to see
  // every answer to filter any of them.
  assert.equal(calls[0].options.all, true);
  assert.equal(calls[0].options.verbatim, true);
});

test('a name resolving only to non-public addresses is refused, not silently emptied', () => {
  const { resolve } = stubResolver({
    'localtest.me': [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }],
  });
  const lookup = guardedLookup(isPublicAddress, resolve);

  let err;
  lookup('localtest.me', {}, (e) => { err = e; });
  assert.ok(err instanceof FetchError);
  assert.equal(err.code, 'blocked_address');
  // The refused addresses are named, because "DNS failed" and "DNS answered something you may
  // not connect to" are different diagnoses and a CLI has to be able to say which.
  assert.match(err.message, /127\.0\.0\.1/);
  assert.match(err.message, /::1/);
});

test('the DNS guard returns the shape its caller asked for', () => {
  const { resolve } = stubResolver({
    'many.example': [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }],
  });
  const lookup = guardedLookup(isPublicAddress, resolve);

  // `all: true` — Node's happy-eyeballs path — gets the filtered list, not the first survivor.
  let list;
  lookup('many.example', { all: true }, (err, addresses) => { list = addresses; });
  assert.deepEqual(list, [{ address: '93.184.216.34', family: 4 }]);

  // A resolver error passes through untouched: it is not a policy refusal.
  let err;
  lookup('nope.example', {}, (e) => { err = e; });
  assert.equal(err.code, 'ENOTFOUND');
});

test('the loopback escape hatch weakens exactly one thing', () => {
  // `isPublicOrLoopbackAddress` exists so the transport tests above can talk to a local
  // server. It is the one function whose job is to weaken the policy, so what it does *not*
  // permit is the part worth asserting.
  for (const allowed of ['127.0.0.1', '::1', '127.255.255.254']) {
    assert.equal(isPublicOrLoopbackAddress(allowed), true, allowed);
  }
  for (const blocked of ['10.0.0.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', 'fe80::1', 'fc00::1']) {
    assert.equal(isPublicOrLoopbackAddress(blocked), false, blocked);
  }
});

test('the negative cache is bounded, because §13.9 makes it attacker-driven', () => {
  // The `author` in a delivered item is attacker-controlled until verification succeeds, and
  // every failed lookup of a claimed author's identity document lands here.
  const cache = new NegativeCache({ maxEntries: 3, now: () => 1000 });
  for (let i = 0; i < 10; i++) cache.recordFailure(`https://a${i}.example/openfeed.json`);
  assert.equal(cache.entries.size, 3);
  assert.ok(MAX_NEGATIVE_CACHE_ENTRIES > 0);
  // Eviction loses backoff state, never trust: an evicted URL is refetched, not believed.
  assert.doesNotThrow(() => cache.assertFetchable('https://a0.example/openfeed.json'));

  // Oldest failure first, and the *survivors* are what says so. Eviction is O(1) — it deletes
  // the first key, relying on `recordFailure` re-inserting so that insertion order tracks
  // `lastFailure`. Get that re-insertion wrong and the cache silently starts evicting the
  // freshest entries, which is invisible in a size check and wrong in exactly the case §12's
  // ladder is for: a host that is down while a consumer walks a chain records one failure per
  // derived-version URL, and the entries worth keeping are the recent ones.
  assert.deepEqual(
    [...cache.entries.keys()],
    ['https://a7.example/openfeed.json', 'https://a8.example/openfeed.json', 'https://a9.example/openfeed.json'],
  );

  // A URL failing again moves to the back of the queue rather than staying where it was, so a
  // repeatedly-failing host is not evicted ahead of one that failed once and went quiet.
  const clock = { at: 2000 };
  const c2 = new NegativeCache({ maxEntries: 2, now: () => clock.at });
  c2.recordFailure('https://old.example/openfeed.json');
  c2.recordFailure('https://mid.example/openfeed.json');
  clock.at = 3000;
  c2.recordFailure('https://old.example/openfeed.json');   // now the freshest
  c2.recordFailure('https://new.example/openfeed.json');   // evicts `mid`, not `old`
  assert.deepEqual(
    [...c2.entries.keys()],
    ['https://old.example/openfeed.json', 'https://new.example/openfeed.json'],
  );
});
