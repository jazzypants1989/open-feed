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
import crypto from 'node:crypto';

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
  MigrationStore,
  buildHeader,
  signingInput,
  signingPayload,
} from '../src/index.js';

/** Six days of posting, one edit, two identity-chain versions. */
function familyPublisher(origin, signer, { days = 6, ...rest } = {}) {
  const p = new Publisher({
    identity: origin,
    feedUrl: `${origin}feed.json`,
    manifestUrl: `${origin}manifest.json`,
    title: 'Mom',
    signer,
    profile: { name: 'Mom', bio: 'Grandmother, gardener, cat enthusiast.' },
    now: () => T0,
    ...rest,
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

  // Drop one item from every surface that could yield it — the feed page and its §7.6 item URL —
  // while the manifest keeps committing it. No invariant is broken and nothing is forged: the
  // consumer knows an exact revision exists, knows its hash, and cannot get the bytes. §9.3
  // requires that be named rather than held as perpetually-pending.
  const gone = p.feed.items.find((i) => i.id === 'urn:uuid:day-4');
  site.replace('feed.json', { ...p.feed, items: p.feed.items.filter((i) => i !== gone) });
  site.remove(`feed/items/${documentHash(gone)}.json`);

  const result = await reader(me).read(site.url);
  assert.equal(result.items.withheld.length, 1);
  assert.equal(result.items.withheld[0].id, 'urn:uuid:day-4');
  assert.match(result.items.withheld[0].reason, /item URL did not yield it/);
  assert.equal(result.items.live.length, 5);
  assert.equal(result.findings.filter((f) => f.kind === 'withheld').length, 1);
});

test('an item missing from the page but served at its §7.6 URL is obtained, not accused', async (t) => {
  // The false accusation §7.6 exists to retire. A publisher serving a window — or paginating
  // past this reader's page bound — commits more than any one page yields, and before §7.6 the
  // only honest verdict available was "I did not try", because there was nothing to try. Now
  // there is: the reader asks for the exact revision the manifest names, gets it, verifies it
  // like any page item, and reports it live.
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);

  site.replace('feed.json', { ...p.feed, items: p.feed.items.filter((i) => i.id !== 'urn:uuid:day-4') });

  const result = await reader(me).read(site.url);
  assert.deepEqual(result.items.withheld, [], 'obtainable is not withheld');
  assert.equal(result.items.live.length, 6, 'the probed revision joins the live set');
  assert.ok(result.items.live.some((s) => s.id === 'urn:uuid:day-4'));
  assert.deepEqual(result.findings, []);
});

test('probing is inert against a publisher that offers no item URLs', async (t) => {
  // The consumer half of §7.6's asymmetry — producers MUST serve item URLs, consumers MUST NOT
  // require them — and the reason the control probe is not optional. A publisher that predates
  // the rule answers 404 to every derived item URL, so probing without a control would
  // report its whole back catalog as withheld — the same false accusation by a new route. So
  // the reader asks for one revision the feed *did* yield first, and when that fails it stays
  // silent entirely: the committed-but-unserved item is `absent`, the state that accuses
  // nobody, because a feed with no further pages may be a complete catalog or a recency
  // window and §9.3 scopes withholding to bytes actually tried for.
  //
  // `itemUrls: false` from construction, not swapped in at serve time: a publisher that
  // predates the rule serves no tree AND declares none (§3.2.1), and the two together are what
  // earn it the benefit of the doubt. One that declares and then declines is the next test.
  const site = await newSite(t);
  const p = familyPublisher(site.url, makeSigner(), { itemUrls: false });
  site.serve(p);
  const me = consumer(t);

  assert.equal(p.identityDocument.feeds[0].items, undefined, 'and it claims nothing');
  site.replace('feed.json', { ...p.feed, items: p.feed.items.filter((i) => i.id !== 'urn:uuid:day-4') });

  const result = await reader(me).read(site.url);
  assert.equal(result.feed.probe.offered, false, 'the control probe found no §7.6 support');
  assert.deepEqual(result.items.withheld, [], 'no probe, no accusation');
  assert.deepEqual(result.items.absent.map((s) => s.id), ['urn:uuid:day-4']);
  assert.match(result.items.absent[0].reason, /not yielded by the pages read/);
});

test('a publisher that declared item URLs and then serves none is withholding', async (t) => {
  // §3.2.1's `items: true` and the reason it exists. The previous test's publisher and this one
  // are byte-identical on the wire except for one boolean inside signed bytes — same manifest
  // commitment, same missing item, same 404 beneath /items/ — and they get opposite verdicts,
  // which is the point. Without the declaration a hostile host suppresses §9.3's only pull-path
  // verdict by declining to serve a directory, and is indistinguishable from a static host.
  const site = await newSite(t);
  const p = familyPublisher(site.url, makeSigner());
  site.serve(p);
  const me = consumer(t);

  assert.equal(p.identityDocument.feeds[0].items, true, 'a Level 2 publisher declares it');
  // Now behave like the host that would rather the verdict were unreachable: the whole tree
  // goes, including the control the reader probes first.
  for (const path of [...site.files.keys()]) if (path.startsWith('feed/items/')) site.remove(path);
  site.replace('feed.json', { ...p.feed, items: p.feed.items.filter((i) => i.id !== 'urn:uuid:day-4') });

  const result = await reader(me).read(site.url);
  assert.deepEqual(result.items.absent, [], 'the benefit of the doubt was spent by the declaration');
  assert.deepEqual(result.items.withheld.map((s) => s.id), ['urn:uuid:day-4']);
  assert.equal(result.findings.filter((f) => f.kind === 'withheld').length, 1);
});

test('a declaration never substitutes for a request: an empty page over a serving tree is not withheld', async (t) => {
  // §9.3 scopes withholding to bytes the consumer actually tried to obtain — "for an item it
  // *requested* and did not get" — and the declaration decides whose absence is *accusable*,
  // never which requests were made. The sharp case: the feed page yields no committed item at
  // all, so there is no control to probe, but the /items/ tree is intact and serving. A reader
  // that let `items: true` stand in for the requests would convict this publisher after zero
  // item fetches; the honest reader asks, is answered, and finds everything obtainable.
  const site = await newSite(t);
  const p = familyPublisher(site.url, makeSigner());
  site.serve(p);
  const me = consumer(t);

  assert.equal(p.identityDocument.feeds[0].items, true);
  // Every committed item vanishes from the page; the tree stays. A CDN serving a stale-empty
  // page in front of a healthy origin is this exact shape.
  site.replace('feed.json', { ...p.feed, items: [] });

  const result = await reader(me).read(site.url);
  assert.deepEqual(result.items.withheld, [], 'every probe was answered, so nothing is withheld');
  assert.equal(result.items.live.length > 0, true, 'probed revisions join the live set');
  assert.deepEqual(result.findings.filter((f) => f.kind === 'withheld'), []);
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

// ---- §6.3 over the wire: a chained document arrives as its own canonicalization ----

test('a chained document served non-canonically is refused', async (t) => {
  // §5.1 hashes "full published canonical bytes" and §5.4 requires retained versions served
  // byte-identically, but a consumer that re-canonicalizes whatever it parsed checks neither:
  // its pin then commits a *normalization* of what it was served rather than the bytes, and
  // every parser divergence between two implementations lives in that gap. One byte compare
  // closes it, and it is the check that would have caught a `__proto__` injection from the
  // outside even if the parser had let one through.
  const site = await newSite(t);
  site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);

  // Byte-identical content, keys out of RFC 8785 order. The signature still verifies — the
  // verifier canonicalizes before checking — so nothing but this rule rejects it.
  const canonical = site.files.get('manifest.json').toString('utf8');
  const doc = JSON.parse(canonical);
  const reordered = JSON.stringify(
    Object.fromEntries(Object.keys(doc).reverse().map((k) => [k, doc[k]])),
  );
  assert.notEqual(reordered, canonical);
  site.replaceRaw('manifest.json', reordered);

  await assert.rejects(
    () => reader(me).read(site.url),
    (e) => /not served as canonical JSON/.test(e.message),
  );

  // Whitespace alone is enough; it changes no value and no signature.
  site.replaceRaw('manifest.json', canonical + '\n');
  await assert.rejects(
    () => reader(consumer(t)).read(site.url),
    (e) => /not served as canonical JSON/.test(e.message),
  );

  // A feed is neither chained nor signed — its items are, and an item has no byte range of its
  // own inside the array that carries it — so the rule binds the two chained kinds and stops.
  site.replaceRaw('manifest.json', canonical);
  const feed = site.files.get('feed.json').toString('utf8');
  site.replaceRaw('feed.json', feed + '\n');
  const result = await reader(consumer(t)).read(site.url);
  assert.equal(result.items.live.length, 6, 'the feed is read normally');
});

test('an attachment with no _sha256 is unverified content inside a verified item', async (t) => {
  // §7.4. The signature covers the *reference*, never the bytes it points at, so an attachment
  // without a hash sits outside the envelope: the item verifies, the manifest commits it, the
  // chain checks out, and whoever serves the photo can swap it undetectably. §13.2's "full
  // integrity against a serving-path compromise" holds only for what the signature covers, and
  // for a media-first deployment this is the largest gap available.
  const site = await newSite(t);
  const signer = makeSigner('key-1');
  const p = new Publisher({ identity: site.url, signer, profile: { name: 'Mom' }, now: () => T0 });

  // A publisher cannot reach this state through the reference implementation, which refuses.
  assert.throws(
    () => p.publishItem({
      id: 'urn:uuid:refused',
      content_text: 'cookies',
      attachments: [{ url: `${site.url}cookies.jpg`, mime_type: 'image/jpeg' }],
    }, { at: T0 }),
    /_sha256/,
  );

  // So build the item honestly, then strip the hash the way a non-conforming publisher would:
  // after signing, the manifest commits these exact bytes, so nothing downstream objects.
  p.publishItem({
    id: 'urn:uuid:photo',
    content_text: 'cookies',
    attachments: [{ url: `${site.url}cookies.jpg`, mime_type: 'image/jpeg', _sha256: 'x'.repeat(43) }],
  }, { at: T0 });
  const hashless = p.publishItem({
    id: 'urn:uuid:hashless',
    content_text: 'more cookies',
    attachments: [{ url: `${site.url}more.jpg`, mime_type: 'image/jpeg', _sha256: 'y'.repeat(43) }],
  }, { at: T0 + 60 });
  delete hashless.attachments[0]._sha256;
  hashless._sig = sign(hashless, signer.privateKey, `${site.url}#key-1`);
  p.items.set('urn:uuid:hashless', hashless);
  p.advanceManifest({ updated: T0 + 3600 });
  site.serve(p);

  const result = await reader(consumer(t), { now: () => T0 + DAY }).read(site.url);

  assert.equal(result.items.live.length, 2, 'both items verify and both are committed');
  assert.deepEqual(result.findings.filter((f) => f.kind === 'invariant'), []);

  const flagged = result.findings.filter((f) => f.kind === 'unhashed_attachment');
  assert.equal(flagged.length, 1, 'exactly the one whose bytes nothing commits');
  assert.equal(flagged[0].id, 'urn:uuid:hashless');
  assert.match(flagged[0].message, /more\.jpg/);
});

test('pagination is followed to the end, and stopping early is partial rather than an accusation', async (t) => {
  // §7.4. Before this the reader read one page and took the absence of `next_url` as proof it
  // had seen everything — which it is only if the publisher never paginated. §13.4 budgets
  // nothing for the walk, so it is bounded, and hitting the bound sets `partial`: a reader that
  // has not seen the whole feed asserts nothing about what is missing from it.
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, makeSigner()));

  // Re-serve the same six committed items as three pages of two.
  const all = p.feed.items;
  const page = (n, items, next) => site.replace(n === 0 ? 'feed.json' : `feed/p${n}.json`, {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Mom',
    feed_url: `${site.url}feed.json`,
    items,
    ...(next ? { next_url: next } : {}),
  });
  page(0, all.slice(0, 2), `${site.url}feed/p1.json`);
  page(1, all.slice(2, 4), `${site.url}feed/p2.json`);
  page(2, all.slice(4, 6), null);

  const whole = await reader(consumer(t)).read(site.url);
  assert.equal(whole.feed.pages.length, 3, 'all three pages were followed');
  assert.equal(whole.feed.partial, false);
  assert.equal(whole.items.live.length, 6);
  assert.deepEqual(whole.findings, []);

  // Bounded at one page: five items are on pages this reader never fetched. It says so by
  // saying nothing — no withholding, because it did not try.
  const clipped = await reader(consumer(t), { maxPages: 1, maxItemProbes: 0 }).read(site.url);
  assert.equal(clipped.feed.partial, true);
  assert.equal(clipped.items.live.length, 2);
  assert.equal(clipped.items.withheld.length, 0, 'a partial read accuses nobody');
  assert.equal(clipped.items.absent.length, 4);
});

test('a next_url pointing off-origin is not followed', async (t) => {
  // `next_url` is unsigned like everything else at feed level (§7.5), so whoever controls the
  // serving path writes it. Following one off-origin is a stranger choosing a verifier's next
  // fetch (§13.9), and a feed's own pages are never anywhere else.
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, makeSigner()));
  site.replace('feed.json', { ...p.feed, next_url: 'https://elsewhere.example/feed.json' });

  const result = await reader(consumer(t), { maxItemProbes: 0 }).read(site.url);
  assert.equal(result.feed.pages.length, 1);
  assert.equal(result.feed.partial, true, 'declining to follow leaves the read partial');
  assert.equal(result.items.withheld.length, 0);
});

test('every feeds entry is read, so a rotated archive does not vanish', async (t) => {
  // §3.2.1: "a consumer wanting the whole catalog reads every entry", and §9.2 makes rotation —
  // open a new feed, mark the old one `rel: "archive"`, leave it listed — the recommended way to
  // bound a manifest's growth. A reader that follows only `primary` makes the back catalog
  // invisible from the moment a publisher takes that advice, which is the wrong reward for it.
  const site = await newSite(t);
  const signer = makeSigner('key-1');

  const archive = new Publisher({
    identity: site.url,
    feedUrl: `${site.url}archive.json`,
    manifestUrl: `${site.url}archive-manifest.json`,
    signer, profile: { name: 'Mom' }, now: () => T0,
  });
  archive.publishItem({ id: 'urn:uuid:old-1', content_text: 'the early years' }, { at: T0 });
  archive.publishItem({ id: 'urn:uuid:old-2', content_text: 'more early years' }, { at: T0 + 60 });
  archive.advanceManifest({ updated: T0 + 120 });

  const p = familyPublisher(site.url, signer);
  p.advanceIdentity({
    feeds: [
      { url: p.feedUrl, manifest: p.manifestUrl, rel: 'primary' },
      { url: archive.feedUrl, manifest: archive.manifestUrl, rel: 'archive' },
    ],
  }, { updated: T0 + 4 * DAY });

  site.serve(archive);   // its own openfeed.json is overwritten by the next line
  site.serve(p);

  const result = await reader(consumer(t)).read(site.url);

  assert.equal(result.feeds.length, 2);
  assert.equal(result.entry.rel, 'primary', 'the named rel is still the headline result');
  assert.equal(result.items.live.length, 6, 'and `items` still means the primary feed');

  const back = result.feeds.find((f) => f.entry.rel === 'archive');
  assert.equal(back.items.live.length, 2);
  assert.equal(back.manifest.pin.seq, 1, 'the archive chain gets its own pin, not the primary\'s');
  assert.notEqual(back.manifest.url, result.manifest.url);
  assert.deepEqual(result.findings, [], 'reading two feeds finds nothing wrong with either');
});

test('an unreadable archive is a finding about that feed, not a dead identity', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner('key-1');
  const p = familyPublisher(site.url, signer);
  p.advanceIdentity({
    feeds: [
      { url: p.feedUrl, manifest: p.manifestUrl, rel: 'primary' },
      { url: `${site.url}gone.json`, manifest: `${site.url}gone-manifest.json`, rel: 'archive' },
    ],
  }, { updated: T0 + 4 * DAY });
  site.serve(p);

  const result = await reader(consumer(t)).read(site.url);
  assert.equal(result.items.live.length, 6, 'the primary feed reads normally');
  const finding = result.findings.find((f) => f.kind === 'unreadable_feed');
  assert.ok(finding, JSON.stringify(result.findings));
  assert.match(finding.message, /gone\.json/);
});

test('renaming a manifest URL cannot shed content', async (t) => {
  // §9.3 invariant 5, and the reason it has to be checked at the reader rather than inside the
  // manifest layer: §5.3.1 is keyed on a document URL, so a *new* manifest URL is a new chain
  // with a fresh pin and a fresh trust-on-first-observation. Every check inside the walk passes.
  // A publisher that renamed the file to drop an item produces no fork, no tombstone, and
  // nothing a pinned consumer could notice — the only evidence is what this consumer saw under
  // the old URL, which is why the observation is persisted.
  const site = await newSite(t);
  const signer = makeSigner('key-1');
  const p = site.serve(familyPublisher(site.url, signer));

  const me = consumer(t);
  const observations = new ObservationStore({ now: () => T0 + 6 * DAY });
  const first = await reader(me, { observations }).read(site.url);
  assert.equal(first.items.live.length, 6);

  // Rename the manifest, and let the new chain quietly forget day 2.
  const relocated = new Publisher({
    identity: site.url,
    feedUrl: `${site.url}feed.json`,
    manifestUrl: `${site.url}manifest-v2.json`,
    title: 'Mom', signer, profile: { name: 'Mom' }, now: () => T0,
  });
  for (let day = 0; day < 6; day++) {
    if (day === 2) continue;
    relocated.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
  }
  relocated.advanceManifest({ updated: T0 + 7 * DAY });
  site.serve(relocated);
  p.advanceIdentity({
    feeds: [{ url: p.feedUrl, manifest: `${site.url}manifest-v2.json`, rel: 'primary' }],
  }, { updated: T0 + 7 * DAY });
  site.serve(p);

  await assert.rejects(
    () => reader(me, { observations, now: () => T0 + 8 * DAY }).read(site.url),
    (e) => e instanceof InvariantViolation && e.invariant === 5 && /urn:uuid:day-2/.test(e.message),
    'the id live under the old URL and absent from the new chain is the violation',
  );
});

test('a forked identity chain is resolved by the recovery co-signature, not frozen', async (t) => {
  // §5.3.1 says run §5.5 before calling a divergence unresolved compromise, and §5.5 says prefer
  // the branch carrying a valid recovery co-signature. After key theft both branches carry valid
  // continuity signatures — detection reports *that* a chain forked and never *which* branch is
  // honest — and the one artifact a thief of an online key cannot produce is a co-signature by an
  // offline recovery key committed in a pinned ancestor.
  const site = await newSite(t);
  const signer = makeSigner('key-1');
  const recovery = makeSigner('recovery-1');
  recovery.jwk.use = 'recovery';

  const build = (name, versions) => {
    const p = new Publisher({
      identity: site.url, signer, profile: { name }, recoveryKeys: [recovery.jwk], now: () => T0,
    });
    p.publishItem({ id: 'urn:uuid:a', content_text: 'hello' }, { at: T0 });
    p.advanceManifest({ updated: T0 + 60 });
    for (let i = 2; i <= versions; i++) p.advanceIdentity({ bio: `v${i}` }, { updated: T0 + i * DAY });
    return p;
  };

  const me = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + DAY });
  site.serve(build('Mom', 2));
  const first = await reader(me, { migrations, now: () => T0 + 3 * DAY }).read(site.url);
  assert.equal(first.identity.pin.seq, 2);

  // The other branch. Different bytes at seq 2 — a genuine fork, not a continuation — and a
  // seq 3 above it that the recovery key co-signs. §6.3 has `_sig` cover `_recovery_sig`, so the
  // co-signature goes on first and the version is re-signed over it; `coSignIdentity` is that
  // order, and it replaces the tip because a co-signature changes the version's bytes.
  const rival = build('Mom (recovered)', 3);
  rival.coSignIdentity(recovery);
  site.serve(rival);

  const resolved = await reader(me, { migrations, now: () => T0 + 5 * DAY }).read(site.url);
  assert.equal(resolved.identity.pin.seq, 3, 'the co-signed branch is preferred and re-pinned');
  assert.equal(me.pins.isFrozen(`${site.url}openfeed.json`), false);
  const finding = resolved.findings.find((f) => f.kind === 'fork_resolved');
  assert.ok(finding, JSON.stringify(resolved.findings));
  assert.match(finding.message, /recovery co-signature/);

  // The finding belongs to the walk that produced it, and to nothing else. Two properties,
  // and both were violated by an earlier shape that accumulated resolutions in reader-wide
  // state and drained them here with `.splice(0)`:
  //
  //   1. It reaches a caller who used `readIdentity` directly, instead of being stranded until
  //      some later `read()` drained it and misattributed it to whatever that read was about.
  const direct = await reader(me, { migrations: new MigrationStore({ now: () => T0 + DAY }), now: () => T0 + 5 * DAY })
    .readIdentity(site.url);
  assert.equal(direct.forkResolved, null, 'an already-pinned branch re-read fresh is TOFU, not a fork');
  //   2. A second read that resolved nothing reports nothing — the finding is not re-emitted,
  //      and just as importantly it is not *drained* from a concurrent reader's results.
  const again = await reader(me, { migrations, now: () => T0 + 6 * DAY }).read(site.url);
  assert.equal(again.findings.filter((f) => f.kind === 'fork_resolved').length, 0,
    'a read that resolved no fork reports no fork');
});

test('a fork with no co-signature on either branch stays frozen', async (t) => {
  // §5.5: "a fork where neither branch carries one — or both do — is unresolvable and SHOULD be
  // flagged for manual review." The resolution path must not become a way to accept any second
  // branch that shows up.
  const site = await newSite(t);
  const signer = makeSigner('key-1');
  const recovery = makeSigner('recovery-1');
  recovery.jwk.use = 'recovery';

  const build = (name, versions) => {
    const p = new Publisher({
      identity: site.url, signer, profile: { name }, recoveryKeys: [recovery.jwk], now: () => T0,
    });
    p.publishItem({ id: 'urn:uuid:a', content_text: 'hello' }, { at: T0 });
    p.advanceManifest({ updated: T0 + 60 });
    for (let i = 2; i <= versions; i++) p.advanceIdentity({ bio: `v${i}` }, { updated: T0 + i * DAY });
    return p;
  };

  const me = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + DAY });
  site.serve(build('Mom', 2));
  await reader(me, { migrations, now: () => T0 + 3 * DAY }).read(site.url);

  site.serve(build('Thief', 3));   // no co-signature anywhere on this branch
  await assert.rejects(
    () => reader(me, { migrations, now: () => T0 + 5 * DAY }).read(site.url),
    EquivocationError,
  );
  assert.equal(me.pins.isFrozen(`${site.url}openfeed.json`), true);
  assert.equal(me.pins.pin(`${site.url}openfeed.json`).seq, 2, 'the pin is retained, not advanced');
});

test('an identity document is cached across reads, and the cache expires', async (t) => {
  // §12 Level 1 SHOULD, and who pays is the reason it is not tuning. A family board (§7.1)
  // carries items from several authors and every one needs that author's own document to
  // resolve a key, so without a cache spanning reads one poll of a shared board is one fetch per
  // distinct author, at every author's origin, forever. The ceiling is what keeps it a cache
  // rather than a second pin: a revocation published afterwards has to become visible.
  const site = await newSite(t);
  const board = await newSite(t);
  const signer = makeSigner('key-1');
  const guest = makeSigner('guest-1');

  const owner = familyPublisher(site.url, signer, { days: 1 });
  const contributor = new Publisher({
    identity: board.url, signer: guest, profile: { name: 'Gran' }, now: () => T0,
  });
  contributor.publishItem({ id: 'urn:uuid:gran-1', content_text: 'from Gran' }, { at: T0 });
  contributor.advanceManifest({ updated: T0 + 60 });
  board.serve(contributor);

  // A copy of Gran's item on Mom's board: verified as authored, and resolving its key needs
  // Gran's document (§7.1, §6.6).
  const copy = [...contributor.items.values()][0];
  site.serve(owner);
  site.replace('feed.json', { ...owner.feed, items: [...owner.feed.items, copy] });

  const me = consumer(t);
  const clock = { at: T0 + DAY };
  const r = () => createReader({
    fetcher: me.fetcher, pins: me.pins, observations: new ObservationStore({ now: () => clock.at }),
    now: () => clock.at,
  });
  const shared = r();

  const before = board.requested.length;
  await shared.read(site.url);
  const afterFirst = board.requested.length;
  assert.ok(afterFirst > before, 'the first read resolves the foreign author');

  await shared.read(site.url);
  assert.equal(board.requested.length, afterFirst, 'the second asks that origin for nothing');

  clock.at = T0 + DAY + 3601;
  await shared.read(site.url);
  assert.ok(board.requested.length > afterFirst, 'and past the ceiling it asks again');
});

test('an item that fails verification writes nothing into the first-observation record', async (t) => {
  // The reader's half of §10.3's write-before-verify rule, against the same shape of attack and
  // a cheaper one. §4.4's pull-path record is what makes "this item entered a manifest after the
  // key was revoked" checkable, and it is only worth anything because a publisher cannot choose
  // it. On a shared board (§7.1) an item's `authors` entry is the *feed's* word until the
  // signature checks out — so a board owner, or anyone on the serving path, can drop in an
  // unsigned item claiming `(victim, some-id)` and, if the store is written first, plant an
  // early observation for an id the victim has not published yet. Every later genuine revision
  // of that id is then checked against a timestamp an attacker chose.
  //
  // The forgery is rejected either way. Only the store shows the difference, so that is what
  // this asserts — status codes and verdicts are identical in both worlds.
  const site = await newSite(t);
  const board = await newSite(t);
  const signer = makeSigner('key-1');
  const guest = makeSigner('guest-1');

  const owner = familyPublisher(site.url, signer, { days: 1 });
  const gran = new Publisher({
    identity: board.url, signer: guest, profile: { name: 'Gran' }, now: () => T0,
  });
  gran.publishItem({ id: 'urn:uuid:gran-real', content_text: 'from Gran' }, { at: T0 });
  gran.advanceManifest({ updated: T0 + 60 });
  board.serve(gran);
  site.serve(owner);

  // Two items claiming Gran, both `_feed_url`-canonical on Mom's feed so both reach the record
  // path. One is signed by Gran's key; the other is signed by nobody who matters.
  const asGran = (id, content) => ({
    id,
    authors: [{ url: board.url }],
    _feed_url: `${site.url}feed.json`,
    _version: 1,
    content_text: content,
    date_published: new Date(T0 * 1000).toISOString(),
  });
  const genuine = asGran('urn:uuid:gran-contributed', 'a real contribution');
  genuine._sig = sign(genuine, guest.privateKey, `${board.url}#guest-1`);
  const forged = asGran('urn:uuid:gran-never-published', 'she never wrote this');
  forged._sig = sign(forged, signer.privateKey, `${board.url}#guest-1`);   // Mom's key, Gran's kid

  site.replace('feed.json', { ...owner.feed, items: [...owner.feed.items, genuine, forged] });

  const observations = new ObservationStore({ now: () => T0 + DAY });
  const me = consumer(t);
  const result = await createReader({
    fetcher: me.fetcher, pins: me.pins, observations, now: () => T0 + DAY,
  }).read(site.url);

  // The forgery is rejected, as it would be either way.
  assert.ok(
    result.feed.rejected.some((r) => r.item.id === 'urn:uuid:gran-never-published'),
    'the forged item is rejected',
  );
  // …and left no trace. This is the assertion the fix is about.
  assert.equal(
    observations.firstObserved(board.url, 'urn:uuid:gran-never-published'), null,
    'a rejected item must not seed an observation an attacker chose the time of',
  );
  // The verified contribution *is* recorded, or §4.4 silently degrades to the self-reported
  // check for every contributor on every board — which is the reason this record exists.
  assert.equal(
    observations.firstObserved(board.url, 'urn:uuid:gran-contributed'), T0 + DAY,
    'a verified contributor item is recorded under its own author',
  );
});

// ---- §16.1: a peer's pin, resolved rather than believed ----

test('a peer pin resolves locally where it can, and dials nobody on a stranger\'s word', async (t) => {
  // §16.1: "An entry is a claim, never an observation." Three of the four verdicts are settled
  // out of the store alone, and the fourth — an unknown chain — is the one §13.9 cares about:
  // acting on it would make every inbox a fetch-amplification oracle pointed wherever the
  // sender likes. So the assertion that matters here is the request count.
  const site = await newSite(t);
  site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);
  const r = reader(me);

  const result = await r.read(site.url);
  const idUrl = `${site.url}openfeed.json`;
  const quiet = site.requested.length;

  assert.deepEqual(await r.resolvePeerPin({ url: idUrl, seq: 2, hash: result.identity.pin.hash }), {
    verdict: 'corroborates', held: result.identity.pin.hash, seq: 2, resolved: true,
  }, 'the same bytes at a seq this consumer fetched itself');

  assert.deepEqual(await r.resolvePeerPin({ url: idUrl, seq: 9, hash: 'later-than-anything-here' }), {
    verdict: 'unknown', held: null, seq: 9, resolved: false, rewalk: true,
  }, 'a seq above the pin is §16.1 property 2: re-walk, never record off one fetch');

  assert.deepEqual(await r.resolvePeerPin({ url: 'https://stranger.example/openfeed.json', seq: 1, hash: 'x' }), {
    verdict: 'untracked', held: null, seq: 1, resolved: false,
  }, 'an untracked chain is ignored outright');

  for (const junk of [null, {}, { url: idUrl, seq: 0, hash: 'h' }, { url: idUrl, seq: 1 }, { url: 7, seq: 1, hash: 'h' }]) {
    assert.deepEqual(await r.resolvePeerPin(junk), { verdict: 'malformed', resolved: false });
  }

  assert.equal(site.requested.length, quiet, 'not one of those cost a request');
  assert.equal(me.pins.isFrozen(idUrl), false, 'and no claim moved the store');
});

test('a disagreeing peer pin is resolved at the derived URL, and what is kept is the fetch', async (t) => {
  // The other half of §16.1's compare: an entry at a seq this consumer never fetched is a
  // reason to go look. What it holds afterwards is its **own** observation of the derived URL
  // (§5.4) — the peer's hash is the question, never the answer — so a lying witness is refuted
  // rather than believed, and refuting one leaves the chain usable.
  const site = await newSite(t);
  const p = site.serve(familyPublisher(site.url, makeSigner()));
  const me = consumer(t);
  const r = reader(me);
  await r.read(site.url);

  const idUrl = `${site.url}openfeed.json`;
  const trueSeq1 = documentHash(p.identityVersions[0]);
  const before = site.requested.length;

  const refuted = await r.resolvePeerPin({ url: idUrl, seq: 1, hash: 'a-hash-the-peer-invented' });
  assert.deepEqual(refuted, { verdict: 'witness_refuted', held: trueSeq1, seq: 1, resolved: true });
  assert.ok(site.requested.includes('openfeed/1.json'), 'fetched from §5.4\'s derived URL');
  assert.equal(site.requested.length, before + 1, 'one version, not a walk');

  // The observation now in the store is the publisher's bytes, so the peer's claim is what a
  // later comparison disagrees with — not the other way round.
  assert.equal(me.pins.reconcilePeerPin(idUrl, 1, trueSeq1).verdict, 'corroborates');
  assert.equal(me.pins.reconcilePeerPin(idUrl, 1, 'a-hash-the-peer-invented').verdict, 'check');
  assert.equal(me.pins.isFrozen(idUrl), false, 'a wrong witness does not freeze anything');

  // A second, honest witness of the same version is now answered without a fetch at all.
  const settled = site.requested.length;
  assert.equal((await r.resolvePeerPin({ url: idUrl, seq: 1, hash: trueSeq1 })).verdict, 'corroborates');
  assert.equal(site.requested.length, settled);

  // And a manifest chain resolves the same way, at its own derived URL: the entry's `url` is
  // what disambiguates all of an identity's chains, and the reader takes the document's *kind*
  // from its own chain inventory rather than from the URL's spelling (§3.2.1 constrains a
  // manifest URL only to end in `.json`, so the suffix does not carry it).
  const manifestUrl = `${site.url}manifest.json`;
  const confirmed = await r.resolvePeerPin({
    url: manifestUrl, seq: 3, hash: documentHash(p.manifestVersions[2]),
  });
  assert.deepEqual(confirmed, {
    verdict: 'witness_confirmed', held: documentHash(p.manifestVersions[2]), seq: 3, resolved: true,
  });
  assert.ok(site.requested.includes('manifest/3.json'));

  // A frozen chain is not fetched at all. §5.3.1's stated response to an unresolved divergence
  // is to accept no further version until a human re-pins, and this path must not be the way
  // around it — observing more of a chain whose future is already impeached is collecting
  // evidence for a verdict already reached. `walkAndPin` gates on exactly this; so must the
  // path a stranger's item can reach.
  assert.throws(
    () => me.pins.observe(idUrl, 1, 'a-hash-that-is-not-the-one-held'),
    EquivocationError,
    'a second observation at a pinned seq with different bytes is the compare rule firing',
  );
  assert.equal(me.pins.isFrozen(idUrl), true);
  const beforeFrozen = site.requested.length;
  const onFrozen = await r.resolvePeerPin({ url: idUrl, seq: 1, hash: 'anything-at-all' });
  assert.equal(onFrozen.verdict, 'frozen');
  assert.equal(onFrozen.resolved, false);
  assert.equal(site.requested.length, beforeFrozen, 'a frozen chain costs no fetch');
});

test('a peer pin can fire §5.3.1 on evidence the consumer collected itself', async (t) => {
  // What §16.1 is *for*. A host serving each reader a consistent private branch is never caught
  // by any one reader alone; the pin riding somebody else's item is how two readers' views
  // meet. The freeze still comes from this consumer's own fetch of the derived URL — §5.4 makes
  // rewriting a retained version a violation on its own, and that is what the fetch finds.
  const site = await newSite(t);
  const signer = makeSigner();
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);
  const r = reader(me);

  const first = await r.read(site.url);
  const idUrl = `${site.url}openfeed.json`;
  assert.equal(first.identity.pin.seq, 2);

  // The branch a relative was served: same seq, same signer, different bytes. Only the
  // *retained* copy is swapped, so the tip a fresh read sees is unchanged and nothing about
  // this identity looks wrong until two observations of seq 2 are put side by side.
  const branch = { ...p.identityDocument, name: 'Mom (for you only)' };
  delete branch._sig;
  branch._sig = sign(branch, signer.privateKey, `${site.url}#${signer.kid}`);
  site.replace('openfeed/2.json', branch);

  await assert.rejects(
    () => r.resolvePeerPin({ url: idUrl, seq: 2, hash: documentHash(branch) }),
    (e) => e instanceof EquivocationError && e.seq === 2 && /peer-pin resolution/.test(e.message),
  );
  assert.equal(me.pins.isFrozen(idUrl), true, '§5.3.1: accept no further version until a human re-pins');
  assert.equal(me.pins.pin(idUrl).hash, first.identity.pin.hash, 'and the pin does not move');

  // The freeze is the whole response: an ordinary read of the same identity is refused now,
  // which is what makes the detection worth anything.
  await assert.rejects(() => reader(me, { now: () => T0 + 7 * DAY }).read(site.url), /frozen/);
});

// ---- §9.1.2: the freeze, over a socket ----

test('a host that stops advancing a chain is reported stale, and it takes two reads to matter', async (t) => {
  // The attack with no verdict until now. Every check the reader runs compares a document
  // against its predecessor or against a pin, so a host serving the last honest version forever
  // passes all of them — and the family sees exactly what they saw the week Mom stopped being
  // able to post. Two reads, because one proves nothing: the same bytes are fresh on the first
  // and stale on the second, and the only thing that changed is the clock.
  const site = await newSite(t);
  const signer = makeSigner();
  site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  const fresh = await reader(me, { now: () => T0 + 6 * DAY }).read(site.url);
  assert.deepEqual(fresh.findings.filter((f) => f.kind === 'stale'), [], 'a chain advanced this week is fresh');

  // Nothing about the site changes. Nobody signs anything. Only the clock moves.
  const observations = new ObservationStore({ now: () => T0 });
  const later = await reader(me, { now: () => T0 + 90 * DAY, observations }).read(site.url);
  const stale = later.findings.filter((f) => f.kind === 'stale');
  assert.equal(stale.length, 1, 'ninety days of a host answering every request with the same bytes');
  assert.match(stale[0].message, /undertook to advance by .*ceiling.* and has not; 7[0-9] day\(s\) overdue/);

  // Stale is unverified, never equivocation: the pin still stands, the chain is not frozen, and
  // everything already verified still reads. An honest publisher on holiday trips this.
  assert.equal(me.pins.isFrozen(`${site.url}manifest.json`), false);
  assert.equal(later.items.live.length, fresh.items.live.length);
  assert.equal(later.findings.filter((f) => f.kind === 'invariant').length, 0);
});

test('a declared cadence is a promise the publisher is held to, well inside the ceiling', async (t) => {
  const site = await newSite(t);
  const signer = makeSigner();
  const p = new Publisher({
    identity: site.url, feedUrl: `${site.url}feed.json`, manifestUrl: `${site.url}manifest.json`,
    title: 'Mom', signer, profile: { name: 'Mom' }, now: () => T0,
    nextUpdate: DAY, // "I advance this every day"
  });
  p.publishItem({ id: 'urn:uuid:one', content_text: 'hello' }, { at: T0 });
  p.advanceManifest({ updated: T0 + 3600 });
  site.serve(p);
  const me = consumer(t);

  const ok = await reader(me, { now: () => T0 + 3600 * 2 }).read(site.url);
  assert.deepEqual(ok.findings.filter((f) => f.kind === 'stale'), []);

  // Two days later — still four days inside the consumer's own 7-day ceiling, and stale anyway,
  // because this publisher said daily. That is the whole asymmetry: a declaration tightens.
  const observations = new ObservationStore({ now: () => T0 });
  const missed = await reader(me, { now: () => T0 + 2 * DAY, observations }).read(site.url);
  const stale = missed.findings.filter((f) => f.kind === 'stale');
  assert.equal(stale.length, 1);
  assert.match(stale[0].message, /\(declared\)/);
});

test('one malformed author URL is one rejected item, not a dead read (§7.1)', async (t) => {
  // `authors[0].url` is normalized per item, and a feed is unsigned at feed level, so any
  // co-author on a §7.1 board — or the serving path — can drop in an item whose author URL does
  // not parse. Thrown, that aborts the whole read and hands whoever injects one item a veto over
  // everyone else's; classified, it is one entry in `rejected` and the rest of the feed reads.
  const site = await newSite(t);
  const signer = makeSigner();
  const p = site.serve(familyPublisher(site.url, signer));
  const me = consumer(t);

  // Splice a poisoned item into the served page: a non-https author URL, which normalizeIdentityUrl
  // refuses (§3.1). Signed by nobody — it never reaches verification, which is the point.
  const poisoned = {
    id: 'urn:uuid:poison', authors: [{ url: 'http://x/' }], _version: 1,
    content_text: 'malformed', date_published: new Date(T0 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  site.replace('feed.json', { ...p.feed, items: [poisoned, ...p.feed.items] });

  const result = await reader(me).read(site.url);
  assert.equal(result.items.live.length, 6, 'every honest item still read');
  assert.ok(result.feed.rejected.some((r) => r.item?.id === 'urn:uuid:poison' && /author url/.test(r.reason)),
    'the poisoned item is classified, not thrown');
});
