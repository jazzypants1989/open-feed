// The composed Level 1 consumer, over a socket.
//
// `e2e.test.js` proves the layers agree when a test drives them in the right order. This proves
// `createReader` *is* that order — which is the part a real consumer gets wrong. §12 makes
// pinning a MUST for a reason that only shows up across two runs: a verifier that checks
// signatures and keeps no pin re-establishes trust at every fetch, so a host holding the
// signing key can hand it any history it likes, forever, without ever forking anything.
//
// So most of these tests run the reader **twice** against the same origin, with something
// changed in between. One run proves nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY, T0, newSite, consumer, makeSigner } from './helpers/site.js';

import {
  Publisher,
  createReader,
  ObservationStore,
  ReaderError,
  normalizeUrlForCompare,
  documentHash,
  sign,
  derivedVersionUrl,
  EquivocationError,
  InvariantViolation,
  PinStore,
} from '../src/index.js';

/** Six days of posting, one edit, two identity-chain versions. */
function familyPublisher(origin, signer, { days = 6 } = {}) {
  const p = new Publisher({
    identity: origin,
    feedUrl: `${origin}feed.json`,
    manifestUrl: `${origin}manifest.json`,
    title: 'Mom',
    signer,
    profile: { name: 'Mom', bio: 'Grandmother, gardener, cat enthusiast.' },
    now: () => T0,
  });
  for (let day = 0; day < days; day++) {
    p.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
    p.advanceManifest({ updated: T0 + day * DAY + 3600 });
  }
  p.advanceIdentity({ name: 'Mom (Ellen)' }, { updated: T0 + 3 * DAY });
  return p;
}

/**
 * A reader sharing one consumer's fetch policy and pin store.
 *
 * `observations` is passed in rather than defaulted so a test can carry it across two reads —
 * §4.4's record is only worth anything across runs, since an id first seen in *this* read is a
 * consumer with no history and falls back to the self-reported check.
 */
function reader(me, { now = () => T0 + 6 * DAY, observations = new ObservationStore({ now }), ...rest } = {}) {
  return createReader({ fetcher: me.fetcher, pins: me.pins, observations, now, ...rest });
}

// ---- the happy path, and then the same path again ----

test('read() verifies an identity end to end and pins both chains', async (t) => {
  const site = await newSite(t);
  site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);
  const r = reader(me);

  const result = await r.read(site.url);

  assert.equal(result.tofu, true, 'first contact is TOFU (§5.3)');
  assert.equal(result.identity.document.name, 'Mom (Ellen)');
  assert.equal(result.identity.pin.seq, 2, 'the identity chain is pinned at its tip');
  assert.equal(result.manifest.pin.seq, 6, 'and so is the manifest chain — two chains, one discipline');
  assert.equal(result.items.live.length, 6);
  assert.equal(result.items.withheld.length, 0);
  assert.deepEqual(result.findings, []);

  // The second run is where pinning starts meaning something: nothing has changed, so the walk
  // is a zero-hop corroboration of the pin rather than a fresh trust-on-first-use.
  const again = await r.read(site.url);
  assert.equal(again.tofu, false);
  assert.equal(again.identity.hops, 0);
  assert.deepEqual(again.findings, []);
});

test('the reader follows an honest publisher forward across new versions', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);
  const r = reader(me);

  await r.read(site.url);
  assert.equal(me.pins.pin(`${site.url}manifest.json`).seq, 6);

  p.publishItem({ id: 'urn:uuid:day-6', content_text: 'day 6' }, { at: T0 + 6 * DAY });
  p.advanceManifest({ updated: T0 + 6 * DAY + 3600 });
  site.serve(p);

  const after = await reader(me, { now: () => T0 + 7 * DAY }).read(site.url);
  assert.equal(after.manifest.pin.seq, 7);
  assert.equal(after.items.live.length, 7);
  assert.deepEqual(after.findings, []);
});

// ---- what a pinned reader is supposed to catch ----

test('an item dropped from the manifest without a tombstone is an invariant violation', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  await reader(me).read(site.url);

  // The host quietly forgets a post. §9.3 invariant 1: an id, once live, appears in every later
  // manifest — in `items` at the same or a higher version, or in `deleted`. Nowhere is not an
  // option, and the walk from the pin is what makes the omission visible at all.
  const seq7 = {
    url: site.url,
    feed_url: `${site.url}feed.json`,
    seq: 7,
    updated: T0 + 6 * DAY + 7200,
    prev: documentHash(p.manifest),
    items: Object.fromEntries(Object.entries(p.manifest.items).filter(([id]) => id !== 'urn:uuid:day-2')),
  };
  seq7._sig = sign(seq7, signer.privateKey, `${site.url}#${signer.kid}`);
  site.replace('manifest.json', seq7);
  site.replace('manifest/7.json', seq7);

  await assert.rejects(
    () => reader(me, { now: () => T0 + 7 * DAY }).read(site.url),
    (e) => e instanceof InvariantViolation && e.invariant === 1 && /day-2/.test(e.message),
  );
  assert.equal(me.pins.pin(`${site.url}manifest.json`).seq, 6, 'the pin does not advance through a violation');
});

test('a rolled-back manifest is refused, and the pin stays where it was', async (t) => {
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);

  await reader(me).read(site.url);

  // Roll the tip back to seq 3 — every byte of it genuine, which is the point: nothing here is
  // forged, and only the pin makes it detectable.
  site.replace('manifest.json', p.manifestVersions[2]);

  await assert.rejects(
    () => reader(me, { now: () => T0 + 7 * DAY }).read(site.url),
    (e) => /rolled back|below its pin|went backwards/.test(e.message),
  );
  assert.equal(me.pins.pin(`${site.url}manifest.json`).seq, 6);
});

test('a rewritten identity history is equivocation, and freezes the chain against further reads', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);
  const identityUrl = `${site.url}openfeed.json`;

  await reader(me).read(site.url);
  assert.equal(me.pins.pin(identityUrl).seq, 2);

  // The host rewrites history below the pin and republishes everything above it so the hashes
  // chain. Every signature is valid — it holds the key — and every §5.4 retained version is
  // present and internally consistent. Only the pin catches it, which is the entire reason §12
  // makes pinning a MUST rather than a SHOULD.
  const rebuilt = new Publisher({
    identity: site.url,
    feedUrl: `${site.url}feed.json`,
    manifestUrl: `${site.url}manifest.json`,
    signer,
    profile: { name: 'Mom', bio: 'a bio she never wrote' },
    now: () => T0,
  });
  rebuilt.advanceIdentity({ name: 'Mom (Ellen)' }, { updated: T0 + 3 * DAY });
  rebuilt.advanceIdentity({ name: 'Mom (Ellen)' }, { updated: T0 + 5 * DAY });
  for (const [path, bytes] of rebuilt.files()) {
    if (path.startsWith('openfeed')) site.replace(path, JSON.parse(bytes.toString('utf8')));
  }

  await assert.rejects(() => reader(me, { now: () => T0 + 7 * DAY }).read(site.url), EquivocationError);
  assert.equal(me.pins.isFrozen(identityUrl), true);

  // §5.3.1's "what follows surfacing": accept no further version until a human deliberately
  // re-pins. Restoring the honest bytes does not silently unfreeze it — that decision is the
  // consumer's, and an equivocation impeaches a chain's future, not the bytes already checked.
  site.serve(p);
  await assert.rejects(() => reader(me, { now: () => T0 + 8 * DAY }).read(site.url), EquivocationError);
  assert.equal(me.pins.pin(identityUrl).seq, 2, 'and what was already verified stays verified');
});

test('an item the manifest commits but the feed never yields is withholding, not pending', async (t) => {
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);

  // Drop one item from the served feed while the manifest keeps committing it. No invariant is
  // broken and nothing is forged: the consumer knows an exact revision exists, knows its hash,
  // and cannot get the bytes. §9.3 requires that be named rather than held as perpetually-pending.
  const feed = { ...p.feed, items: p.feed.items.filter((i) => i.id !== 'urn:uuid:day-4') };
  site.replace('feed.json', feed);

  const result = await reader(me).read(site.url);
  assert.equal(result.items.withheld.length, 1);
  assert.equal(result.items.withheld[0].id, 'urn:uuid:day-4');
  assert.equal(result.items.live.length, 5);
  assert.equal(result.findings.filter((f) => f.kind === 'withheld').length, 1);
});

test('an item uncommitted past the consumer ceiling stops being lag', async (t) => {
  const site = await newSite(t);
  const p = familyPublisher(site.url, makeSigner());
  // Published and never committed: manifest lag at first, a violation once the consumer's own
  // absolute ceiling passes (§9.3 invariant 3). The ceiling is deliberately the consumer's,
  // because a bound derived from the publisher's observed cadence catches only a publisher
  // *deviating* from its rhythm and never one that simply declares a slow one.
  p.publishItem({ id: 'urn:uuid:uncommitted', content_text: 'never committed' }, { at: T0 + 6 * DAY });
  site.serve(p);
  const me = consumer(t);

  const soon = await reader(me, { now: () => T0 + 6 * DAY + 60 }).read(site.url);
  assert.equal(soon.items.pending.length, 1, 'inside the window this is ordinary manifest lag');
  assert.deepEqual(soon.findings, []);

  const later = await reader(me, { now: () => T0 + 20 * DAY }).read(site.url);
  assert.equal(later.items.pending.length, 0);
  assert.ok(
    later.findings.some((f) => f.kind === 'invariant' && /uncommitted/.test(f.message)),
    JSON.stringify(later.findings),
  );
});

// ---- §7.5: a copy is not a violation ----

test('an item whose _feed_url names another feed is a copy, verified and unrejected', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  const p = familyPublisher(site.url, signer);

  // The same signer's item, signed for a *different* feed, then served here. This is what an
  // aggregate feed, a cache, or a follower's mirror looks like — the signature travels with the
  // bytes, so it is verifiable as *authored*; what it lacks is liveness and manifest standing.
  const copy = {
    id: 'urn:uuid:elsewhere',
    authors: [{ url: site.url }],
    _feed_url: `${site.url}other-feed.json`,
    _version: 1,
    content_text: 'canonical somewhere else',
    date_published: new Date((T0 + 2 * DAY) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  copy._sig = sign(copy, signer.privateKey, `${site.url}#${signer.kid}`);
  site.serve(p);
  site.replace('feed.json', { ...p.feed, items: [copy, ...p.feed.items] });

  const result = await reader(await Promise.resolve(consumer(t))).read(site.url);
  assert.equal(result.items.copies.length, 1);
  assert.equal(result.items.copies[0].item.id, 'urn:uuid:elsewhere');
  assert.equal(result.items.live.length, 6, 'a copy is not reconciled against this feed’s manifest');
  assert.deepEqual(result.findings, [], 'and it is not an invariant violation either');
});

// ---- §12: a transient failure is not a rejection ----

test('a transient failure defers rather than rejecting, and clears on success', async (t) => {
  const site = await newSite(t);
  site.serve(familyPublisher(site.url, makeSigner()));
  let clock = T0 + 6 * DAY;
  const me = consumer(t, { now: () => clock });
  const r = reader(me, { now: () => clock });

  // §12: cache the failure and retry at 1 h, 4 h, 24 h before rejecting permanently. One 503 is
  // not a verdict about an identity — it is a bad minute at a web tier.
  site.failNext('manifest.json', { times: 1, status: 503 });
  await assert.rejects(
    () => r.read(site.url),
    (e) => e instanceof ReaderError && e.code === 'transient',
  );

  // Immediately after, the fetch is *deferred* rather than retried — the distinction a caller
  // needs and a raw fetch error does not carry.
  await assert.rejects(
    () => r.read(site.url),
    (e) => e instanceof ReaderError && e.code === 'deferred',
  );

  clock += 3600 + 1; // the first rung
  const result = await r.read(site.url);
  assert.equal(result.items.live.length, 6);
  assert.deepEqual(result.findings, []);
});

test('a host that never comes back is rejected, but only after every rung', async (t) => {
  const site = await newSite(t);
  site.serve(familyPublisher(site.url, makeSigner()));
  let clock = T0 + 6 * DAY;
  const me = consumer(t, { now: () => clock });
  const r = reader(me, { now: () => clock });

  site.failNext('manifest.json', { times: 99, status: 503 });
  for (const wait of [3600, 4 * 3600, 24 * 3600]) {
    await assert.rejects(() => r.read(site.url), (e) => e instanceof ReaderError && e.code === 'transient');
    await assert.rejects(() => r.read(site.url), (e) => e instanceof ReaderError && e.code === 'deferred');
    clock += wait + 1;
  }
  // The rung after the last one: the fetch is attempted, fails a fourth time, and only *then*
  // is the schedule spent. Rejecting on the third failure would be rejecting before the 24-hour
  // rung has actually been tried.
  await assert.rejects(() => r.read(site.url), (e) => e instanceof ReaderError && e.code === 'transient');
  await assert.rejects(
    () => r.read(site.url),
    (e) => e instanceof ReaderError && e.code === 'rejected',
    '§12 finally permits a permanent rejection',
  );
});

// ---- §4.4: the pull-path revocation analog ----

test('first-observation time is keyed on (author, id) so a migration cannot reset it', () => {
  let clock = T0;
  const store = new ObservationStore({ now: () => clock });
  const author = 'https://mom.example/';

  store.recordManifest(author, { items: { 'urn:uuid:a': [1, 'H'] } });
  assert.equal(store.firstObserved(author, 'urn:uuid:a'), T0);

  // The same id committed again, later and from a different feed. A thief can backdate an
  // item's `date_published`; they cannot backdate when this consumer first saw a manifest
  // commit to it — so the *first* observation is the one that must survive, and keying on the
  // feed URL rather than the author is what would quietly discard it at a migration (§3.4).
  clock = T0 + 365 * DAY;
  store.recordManifest(author, { items: { 'urn:uuid:a': [2, 'H2'], 'urn:uuid:b': [1, 'H3'] } });
  assert.equal(store.firstObserved(author, 'urn:uuid:a'), T0, 'the earlier and stronger observation stands');
  assert.equal(store.firstObserved(author, 'urn:uuid:b'), T0 + 365 * DAY);

  assert.equal(store.firstObserved('https://someone.else/', 'urn:uuid:a'), null, 'no history: fall back to TOFU');
  assert.equal(store.firstObserved(author, 'urn:uuid:unknown'), null);
});

test('an item whose key was revoked before this consumer first saw it committed is rejected', async (t) => {
  const site = await newSite(t);
  const first = makeSigner('key-1');
  const second = makeSigner('key-2');
  const p = new Publisher({
    identity: site.url,
    signer: first,
    profile: { name: 'Mom' },
    now: () => T0,
  });
  p.publishItem({ id: 'urn:uuid:old', content_text: 'signed by key-1' }, { at: T0 });
  p.advanceManifest({ updated: T0 + 60 });
  p.rotateKey(second, { updated: T0 + DAY });
  site.serve(p);

  const me = consumer(t);
  // The key was revoked at T0 + DAY + 1, and the item honestly predates it, so it verifies.
  const honest = await reader(me, { now: () => T0 + 2 * DAY }).read(site.url);
  assert.equal(honest.items.live.length, 1);
  assert.deepEqual(honest.findings, []);

  // Now a fresh consumer meets the same feed for the first time long after the revocation, with
  // a doctored observation store saying it first saw the id well after the key died. §4.4's
  // whole point: the self-reported timestamp is not what the check runs against.
  const stranger = consumer(t);
  const late = createReader({
    fetcher: stranger.fetcher,
    pins: new PinStore({ now: () => T0 + 400 * DAY }),
    observations: ObservationStore.fromJSON({ [`${site.url}\nurn:uuid:old`]: T0 + 400 * DAY }),
    now: () => T0 + 400 * DAY,
  });
  const result = await late.read(site.url);
  assert.equal(result.items.live.length, 0);
  assert.ok(
    result.findings.some((f) => f.kind === 'unverifiable' && /revoked/.test(f.message)),
    JSON.stringify(result.findings),
  );
});

// ---- odds and ends the pipeline depends on ----

test('feed URLs compare without the identity rules that do not apply to them', () => {
  // §7.5 compares a feed URL, and a feed URL names a file — so no trailing slash is appended,
  // and the path is left exactly as published. What does fold is what folds everywhere:
  // scheme, host, default port, fragment.
  assert.equal(
    normalizeUrlForCompare('https://Mom.Example:443/feed.json#x'),
    normalizeUrlForCompare('https://mom.example/feed.json'),
  );
  assert.notEqual(
    normalizeUrlForCompare('https://mom.example/feed.json'),
    normalizeUrlForCompare('https://mom.example/feed.json/'),
  );
});

test('an identity listing no feeds is unreadable rather than empty', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  const doc = { url: site.url, name: 'Mom', keys: [signer.jwk], seq: 1, updated: T0 };
  doc._sig = sign(doc, signer.privateKey, `${site.url}#${signer.kid}`);
  site.replace('openfeed.json', doc);
  site.replace('openfeed/1.json', doc);

  const r = reader(consumer(t));
  await assert.rejects(
    () => r.read(site.url),
    (e) => e instanceof ReaderError && e.code === 'no_feed',
  );
  // The identity itself still read and pinned — a Level 1 consumer that publishes nothing is
  // conformant (Appendix B's reader identity is exactly this), so "no feeds" is a fact about
  // what can be read next, not a defect in the document.
  const identity = await r.readIdentity(site.url);
  assert.equal(identity.document.name, 'Mom');
  assert.equal(identity.pin.seq, 1);
  assert.equal(derivedVersionUrl(identity.url, 1), `${site.url}openfeed/1.json`);
});
