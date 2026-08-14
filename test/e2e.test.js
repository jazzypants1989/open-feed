// The whole thing, over a socket.
//
// Everything else in this suite runs a layer against fixtures. This runs the layers against
// each other: a Level 2 publisher emits files, an HTTP server serves them, and a Level 1
// consumer fetches, walks, pins, and reconciles with no shared objects between the two sides —
// only bytes. Until this existed, nothing in the repo had ever made a network request, and
// every §5.4 publishing claim (retention, derived URLs, byte-identical serving) was
// paper-verified.
//
// It runs over real HTTPS against a real hostname, because §3.1 makes the scheme part of the
// identity and every layer enforces it: a `kid` naming a plaintext URL does not parse, so an
// http harness would be testing a protocol this is not. The certificate is generated in
// `helpers/tls.js` and handed to the fetcher as a **pinned CA** rather than by disabling
// validation, so §13.3 stays in force. The name resolves through `createFetcher`'s `resolve`
// seam, which means this is also the only test in the suite that drives `guardedLookup` down
// a real socket rather than as a unit.

import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import crypto from 'node:crypto';

import { selfSignedCertificate } from './helpers/tls.js';

import {
  Publisher,
  createFetcher,
  NegativeCache,
  ByteBudget,
  isPublicOrLoopbackAddress,
  walkToPin,
  PinStore,
  identityChainPolicy,
  manifestChainPolicy,
  derivedVersionUrl,
  documentHash,
  reconcileFeed,
  assertHistoryInvariants,
  assertManifestBinding,
  verifyDocument,
  EquivocationError,
  InvariantViolation,
} from '../src/index.js';

const DAY = 86400;
const T0 = 1736899200;

function makeSigner(kid = 'key-1', { use } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat: T0 - DAY, kid, kty: 'OKP', x };
  if (use) jwk.use = use;
  return { kid, jwk, privateKey };
}

const HOSTNAME = 'mom.example';
const TLS = selfSignedCertificate([HOSTNAME, '127.0.0.1']);

/**
 * Bind a server first, so the identity URL — which carries the port and is inside every signed
 * byte (§7.5) — is known before anything is signed. An identity URL is not a deployment detail
 * that can be rewritten afterwards, and this is that constraint showing up in a test harness.
 */
async function newSite(t) {
  const files = new Map();
  const requested = [];
  const server = https.createServer({ key: TLS.key, cert: TLS.cert }, (req, res) => {
    const path = decodeURIComponent(req.url.replace(/^\//, ''));
    requested.push(path);
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
    /** Overwrite one served path. How rollback and equivocation are staged. */
    replace: (path, doc) => files.set(path, Buffer.from(JSON.stringify(doc))),
    remove: (path) => files.delete(path),
  };
}

/**
 * A consumer: the fetch policy, a pin store, and nothing else.
 *
 * The certificate is pinned as a CA, not waved through — turning validation off would quietly
 * stop testing §13.3 in the one place it can be tested. The resolver is the only other seam,
 * and it is the honest one: `mom.example` exists in this test and nowhere else.
 */
function consumer(t) {
  const fetcher = createFetcher({
    isAddressAllowed: isPublicOrLoopbackAddress,
    negativeCache: new NegativeCache(),
    tls: { ca: [TLS.cert] },
    resolve: (hostname, options, callback) => (
      hostname === HOSTNAME
        ? callback(null, [{ address: '127.0.0.1', family: 4 }])
        : callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' }))
    ),
  });
  t.after(() => fetcher.close());
  return { fetcher, pins: new PinStore({ now: () => T0 }) };
}

/**
 * The §5.3 loop a Level 1 reader actually runs: fetch the tip, walk it to the pin, advance.
 * `fetchVersion` derives its URL by §5.4 rather than being told one, which is the property
 * that lets the walk work at all against a publisher who moved hosts.
 */
async function walkChain({ fetcher, pins }, url, policy, { kind = 'json', budget } = {}) {
  const tip = await fetcher.fetchDocument(url, { kind, budget });
  const fetchVersion = async (documentUrl, seq) => {
    const at = derivedVersionUrl(documentUrl, seq);
    const { doc } = await fetcher.fetchDocument(at, { kind, budget });
    return doc;
  };
  const result = await walkToPin({
    url, tip: tip.doc, pin: pins.pin(url), fetchVersion, policy, pins,
  });
  pins.advance(url, tip.doc.seq, result.hash);
  return { ...result, tip: tip.doc, cors: tip.cors };
}

/** A publisher with a short history: three identity versions, six manifest versions, one edit. */
function familyPublisher(origin, signer) {
  const p = new Publisher({
    identity: origin,
    feedUrl: `${origin}feed.json`,
    manifestUrl: `${origin}manifest.json`,
    title: 'Mom',
    signer,
    profile: { name: 'Mom', bio: 'Grandmother, gardener, cat enthusiast.' },
    now: () => T0,
  });

  for (let day = 0; day < 6; day++) {
    p.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
    p.advanceManifest({ updated: T0 + day * DAY + 3600 });
  }
  p.advanceIdentity({ bio: 'Grandmother, gardener, cat enthusiast, beekeeper.' }, { updated: T0 + 3 * DAY });
  p.advanceIdentity({ name: 'Mom (Ellen)' }, { updated: T0 + 4 * DAY });
  return p;
}

// ---- the happy path ----

test('a published identity verifies end to end over the wire', async (t) => {
  const signer = makeSigner();
  const site = await newSite(t);
  const origin = site.url;
  site.serve(familyPublisher(origin, signer));
  const me = consumer(t);

  // 1. The identity chain. TOFU on first contact, then walked to the pin on every later fetch.
  const identity = await walkChain(me, `${origin}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  assert.equal(identity.tofu, true);
  assert.equal(identity.tip.seq, 3);
  assert.equal(identity.cors, true, '§3.3: every publicly-readable document carries ACAO');
  assert.equal(me.pins.pin(`${origin}openfeed.json`).seq, 3);

  // 2. The manifest chain, keyed on the identity document just verified (§9.1).
  const feedEntry = identity.tip.feeds[0];
  const manifest = await walkChain(me, feedEntry.manifest, manifestChainPolicy(identity.tip), { kind: 'manifest' });
  assert.equal(manifest.tip.seq, 6);
  assertManifestBinding(manifest.tip, { identityUrl: origin, feedUrl: feedEntry.url });

  // 3. The feed, reconciled against the manifest that commits it (§9.3).
  const feed = await me.fetcher.fetchDocument(feedEntry.url, { kind: 'feed' });
  assert.equal(feed.contentType, 'application/feed+json');
  for (const item of feed.doc.items) {
    assert.ok(verifyDocument(item, { identityDocument: identity.tip, kind: 'item' }));
  }
  const { states, violations } = reconcileFeed(manifest.tip, feed.doc.items, {
    now: T0 + 6 * DAY, url: feedEntry.url,
  });
  assert.deepEqual(violations, []);
  assert.equal(states.length, 6);
  assert.ok(states.every((s) => s.state === 'live'), JSON.stringify(states.filter((s) => s.state !== 'live')));
});

test('retained versions are served byte-identically, which is what makes prev hash', async (t) => {
  // §5.4's requirement, checked the only way that means anything: the bytes on the wire, not
  // the objects in memory.
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  for (let seq = 1; seq <= 6; seq++) {
    const at = derivedVersionUrl(`${site.url}manifest.json`, seq);
    const { doc, bytes } = await me.fetcher.fetchDocument(at, { kind: 'manifest' });
    assert.equal(doc.seq, seq);
    // The successor's `prev` names these exact bytes, so a re-serialization anywhere in the
    // pipeline breaks every walk.
    if (seq < 6) {
      const next = await me.fetcher.fetchDocument(derivedVersionUrl(`${site.url}manifest.json`, seq + 1), { kind: 'manifest' });
      assert.equal(next.doc.prev, documentHash(doc));
    }
    assert.equal(documentHash(doc), documentHash(JSON.parse(bytes.toString('utf8'))));
  }
});

// ---- the attacks, staged on the served copy ----

test('a rollback served to a pinned consumer is refused over the wire', async (t) => {
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  await walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' });

  // The attack §5 opens with: serve an older version at the tip to un-revoke a key.
  site.replace('openfeed.json', p.identityVersions[0]);
  await assert.rejects(
    () => walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' }),
    (e) => /rolled back/.test(e.message),
  );
});

test('a rewritten retained version surfaces as equivocation, and freezes the chain', async (t) => {
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);
  const url = `${site.url}manifest.json`;

  const identity = await walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  const policy = manifestChainPolicy(identity.tip);
  await walkChain(me, url, policy, { kind: 'manifest' });

  // The host now rewrites history below the pin and republishes everything above it so the
  // hashes chain. Every signature is valid — it holds the key — and the pin is what catches it.
  const rebuilt = new Publisher({
    identity: site.url, feedUrl: `${site.url}feed.json`, manifestUrl: url, signer, now: () => T0,
  });
  for (let day = 0; day < 7; day++) {
    if (day !== 2) rebuilt.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
    rebuilt.advanceManifest({ updated: T0 + day * DAY + 3600 });
  }
  for (const [path, bytes] of rebuilt.files()) site.replace(path, JSON.parse(bytes.toString('utf8')));

  await assert.rejects(
    () => walkChain(me, url, policy, { kind: 'manifest' }),
    (e) => e instanceof EquivocationError,
  );
  assert.equal(me.pins.isFrozen(url), true, '§5.3.1: retain the pin, accept no further version');
  assert.equal(me.pins.pin(url).seq, 6, 'and keep rendering what was already verified');
});

test('a pruned intermediate makes the chain unverifiable, never silently re-pinned', async (t) => {
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);
  const url = `${site.url}manifest.json`;

  const identity = await walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  const policy = manifestChainPolicy(identity.tip);
  await walkChain(me, url, policy, { kind: 'manifest' });

  p.publishItem({ id: 'urn:uuid:day-6', content_text: 'day 6' }, { at: T0 + 6 * DAY });
  p.advanceManifest({ updated: T0 + 6 * DAY + 3600 });
  for (const [path, bytes] of p.files()) site.replace(path, JSON.parse(bytes.toString('utf8')));
  site.remove('manifest/6.json'); // a retained version gone missing (§5.4)

  await assert.rejects(
    () => walkChain(me, url, policy, { kind: 'manifest' }),
    (e) => e.code === 'bad_status' && e.status === 404,
  );
  assert.equal(me.pins.pin(url).seq, 6, 'the pin is retained, not advanced past a gap');
});

test('withholding is surfaced as withholding, not as content that never existed', async (t) => {
  // §9.3's third state. No invariant is broken and nothing is forged: the consumer knows an
  // exact revision exists, knows its hash, and cannot obtain the bytes.
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  const identity = await walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  const manifest = await walkChain(me, `${site.url}manifest.json`, manifestChainPolicy(identity.tip), { kind: 'manifest' });

  // The host serves a feed missing one committed item. Its own manifest is the evidence.
  const feed = p.feed;
  site.replace('feed.json', { ...feed, items: feed.items.filter((i) => i.id !== 'urn:uuid:day-2') });

  const served = await me.fetcher.fetchDocument(`${site.url}feed.json`, { kind: 'feed' });
  const { byId, violations } = reconcileFeed(manifest.tip, served.doc.items, {
    now: T0 + 6 * DAY,
  });
  assert.equal(byId.get('urn:uuid:day-2').state, 'withheld');
  assert.equal(byId.get('urn:uuid:day-2').hash, documentHash(p.items.get('urn:uuid:day-2')));
  assert.deepEqual(violations, [], 'withholding is not an invariant violation');
});

test('a swapped item body is caught by the manifest, not by its signature', async (t) => {
  // The distinction §9 turns on. A serving-path attacker cannot re-sign, so a swapped body
  // fails verification — but a *key custodian* can, and then only the committed hash catches
  // it. Staged here as the custodian: correctly signed, and still a violation.
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  const identity = await walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  const manifest = await walkChain(me, `${site.url}manifest.json`, manifestChainPolicy(identity.tip), { kind: 'manifest' });

  const rewritten = new Publisher({
    identity: site.url, feedUrl: `${site.url}feed.json`, manifestUrl: `${site.url}manifest.json`, signer, now: () => T0,
  });
  rewritten.publishItem({ id: 'urn:uuid:day-2', content_text: 'something she never said' }, { at: T0 + 2 * DAY });
  const forgedItem = rewritten.items.get('urn:uuid:day-2');
  assert.ok(verifyDocument(forgedItem, { identityDocument: identity.tip, kind: 'item' }), 'it verifies; that is the point');

  const feed = p.feed;
  site.replace('feed.json', { ...feed, items: feed.items.map((i) => (i.id === 'urn:uuid:day-2' ? forgedItem : i)) });

  const served = await me.fetcher.fetchDocument(`${site.url}feed.json`, { kind: 'feed' });
  const { violations } = reconcileFeed(manifest.tip, served.doc.items, {
    now: T0 + 6 * DAY,
  });
  assert.equal(violations.length, 1);
  assert.ok(violations[0] instanceof InvariantViolation);
  assert.equal(violations[0].invariant, 4, 'the manifest names an exact revision, and this is not it');
});

// ---- §13.4 ----

test('the history-byte budget is carried across a walk, not applied per fetch', async (t) => {
  const signer = makeSigner();
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  const identity = await walkChain(me, `${site.url}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  // A budget too small to reach the pin. §13.4 bounds the whole update, so no single fetch
  // exceeding a cap is what stops it — the running total is.
  await assert.rejects(
    () => walkChain(me, `${site.url}manifest.json`, manifestChainPolicy(identity.tip), {
      kind: 'manifest', budget: new ByteBudget(600),
    }),
    (e) => e.code === 'budget_exhausted',
  );

  // And the same walk inside a realistic budget completes.
  const ok = await walkChain(me, `${site.url}manifest.json`, manifestChainPolicy(identity.tip), {
    kind: 'manifest', budget: new ByteBudget(10 * 1024 * 1024),
  });
  assert.equal(ok.tip.seq, 6);
});

// ---- §4.3 rotation, over the wire ----

test('a rotated key keeps the back catalog verifiable', async (t) => {
  // §4.3: revocation ends a key's authority, delisting ends verifiability, and §6.5 resolves
  // a kid against the *current* document — so the old key stays listed forever, and the
  // effective-signing-time rule is what keeps its old signatures valid.
  const first = makeSigner('key-1');
  const second = makeSigner('key-2');
  const site = await newSite(t);
  const origin = site.url;

  const p = new Publisher({ identity: origin, signer: first, title: 'Mom', now: () => T0 });
  p.publishItem({ id: 'urn:uuid:old', content_text: 'before the rotation' }, { at: T0 });
  p.advanceManifest({ updated: T0 + 60 });
  p.rotateKey(second, { updated: T0 + DAY });
  p.publishItem({ id: 'urn:uuid:new', content_text: 'after the rotation' }, { at: T0 + 2 * DAY });
  p.advanceManifest({ updated: T0 + 2 * DAY });

  site.serve(p);
  const me = consumer(t);
  const identity = await walkChain(me, `${origin}openfeed.json`, identityChainPolicy, { kind: 'identity' });
  assert.equal(identity.tip.seq, 3);
  assert.equal(identity.tip.keys.length, 2, 'the old key stays listed (§4.3)');
  assert.ok(identity.tip.keys.find((k) => k.kid === 'key-1').revoked_at, 'and is revoked');

  const feed = await me.fetcher.fetchDocument(`${origin}feed.json`, { kind: 'feed' });
  for (const item of feed.doc.items) {
    assert.ok(
      verifyDocument(item, { identityDocument: identity.tip, kind: 'item' }),
      `${item.id} must still verify against the current identity document`,
    );
  }
  const manifest = await walkChain(me, `${origin}manifest.json`, manifestChainPolicy(identity.tip), { kind: 'manifest' });
  assert.deepEqual(assertHistoryInvariants(manifest.versions, { url: `${origin}manifest.json`, contiguous: manifest.contiguous }).checked, 'every-hop');
});
