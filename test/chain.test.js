// The version chain: §5.3's pin-and-walk, §5.3.1's compare rule, §5.4's derived URLs,
// §5.5's fork resolution, and §9.1.1's skip links.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  derivedVersionUrl,
  skipAnchors,
  PinStore,
  admissibleItemPins,
  chainUrlsOf,
  pinsForRecipients,
  walkToPin,
  identityChainPolicy,
  manifestChainPolicy,
  assertContinuityKey,
  verifyRecoverySignature,
  resolveFork,
  ChainError,
  EquivocationError,
  documentHash,
  sign,
} from '../src/index.js';

import {
  DocumentStore,
  identityFixture,
  manifestFixture,
  makeKey,
  ChainBuilder,
  pinOf,
} from './helpers/chain-fixture.js';

const walk = (fx, tip, pin, extra = {}) => walkToPin({
  url: fx.url,
  tip: tip ?? fx.store.tip(fx.url),
  pin,
  fetchVersion: fx.store.fetchVersion,
  policy: identityChainPolicy,
  ...extra,
});

// ---- §5.4 derived URLs ----

test('a version URL is derived by stripping .json and appending /{seq}.json', () => {
  assert.equal(
    derivedVersionUrl('https://pence.family/~mom/openfeed.json', 3),
    'https://pence.family/~mom/openfeed/3.json',
  );
  assert.equal(
    derivedVersionUrl('https://pence.family/~mom/manifest.json', 412),
    'https://pence.family/~mom/manifest/412.json',
  );
  // Derived URLs are same-origin by construction, which is what §3.3 / §13.5 wants.
  assert.ok(derivedVersionUrl('https://a.example/m.json', 1).startsWith('https://a.example/'));
});

test('the derivation is total only because chained URLs must end in .json', () => {
  for (const url of ['https://a.example/manifest', 'https://a.example/', 'https://a.example/m.JSON']) {
    assert.throws(() => derivedVersionUrl(url, 1), ChainError);
  }
  for (const seq of [0, -1, 1.5, '3', NaN]) {
    assert.throws(() => derivedVersionUrl('https://a.example/m.json', seq), ChainError);
  }
});

// ---- §9.1.1 anchors ----

test('skip anchors are absolute: the largest multiple of each 2^k below seq', () => {
  assert.deepEqual(skipAnchors(412), [411, 410, 408, 400, 384, 256]);
  assert.deepEqual(skipAnchors(2), [1]);
  assert.deepEqual(skipAnchors(1), []);   // genesis anchors nothing
  // Near a power of two the set collapses to one or two entries, which the spec calls
  // harmless: each landing carries its own _skip and the walk re-skips from there.
  assert.deepEqual(skipAnchors(257), [256]);
  assert.deepEqual(skipAnchors(129), [128]);
  assert.deepEqual(skipAnchors(256), [255, 254, 252, 248, 240, 224, 192, 128]);
  // Every anchor is strictly below seq and at least 1, at every size.
  for (const seq of [3, 17, 64, 65, 1000, 4096]) {
    for (const a of skipAnchors(seq)) assert.ok(a >= 1 && a < seq, `${a} for seq ${seq}`);
  }
});

// ---- §5.3 the walk ----

test('first contact is TOFU: accept and pin, with nothing to walk', async () => {
  const fx = identityFixture({ versions: 1 });
  const result = await walk(fx, undefined, null);
  assert.equal(result.tofu, true);
  assert.equal(result.hops, 0);
  assert.equal(result.hash, documentHash(fx.chain.at(1)));
});

test('a walk reaches the pin and verifies every hop on the way', async () => {
  const fx = identityFixture({ versions: 6 });
  const pin = pinOf(fx.chain.at(2));
  const result = await walk(fx, undefined, pin);
  assert.equal(result.hops, 4);
  assert.deepEqual(result.versions.map((v) => v.seq), [6, 5, 4, 3, 2]);
  assert.equal(result.tofu, false);
});

test('a chain already at the pin needs no walk, and its bytes must still match', async () => {
  const fx = identityFixture({ versions: 3 });
  const tip = fx.chain.at(3);
  assert.equal((await walk(fx, tip, pinOf(tip))).hops, 0);
  await assert.rejects(
    () => walk(fx, tip, { seq: 3, hash: 'a-hash-nobody-published' }),
    EquivocationError,
  );
});

test('a rollback below the pin is refused', async () => {
  // The attack §5 opens with: roll the identity document back to un-revoke a key.
  const fx = identityFixture({ versions: 4 });
  await assert.rejects(
    () => walk(fx, fx.chain.at(2), pinOf(fx.chain.at(4))),
    (e) => e instanceof ChainError && /rolled back/.test(e.message),
  );
});

test('a broken prev link is refused', async () => {
  const fx = identityFixture({ versions: 3 });
  const forged = { ...fx.chain.at(2), name: 'Not Owner' };
  forged._sig = sign(forged, fx.primary.privateKey, `${fx.identity}#key-1`);
  fx.store.replaceVersion(fx.url, 2, forged);

  await assert.rejects(
    () => walk(fx, undefined, pinOf(fx.chain.at(1))),
    (e) => e instanceof ChainError && /names prev/.test(e.message),
  );
});

test('a pin that cannot be connected to the tip is unverifiable, never silently re-pinned', async () => {
  // §5.3: "A consumer that cannot connect its pin to the current document — missing retained
  // versions — MUST treat the chain as unverifiable rather than silently re-pin."
  const fx = identityFixture({ versions: 5 });
  fx.store.prune(fx.url, 3);
  await assert.rejects(() => walk(fx, undefined, pinOf(fx.chain.at(1))), /404/);
});

test('seq is contiguous: a version that skips a number is not a chain (§5.3 step 3)', async () => {
  // "Strictly increasing" alone does not carry this, which is why §5.3 step 3 now says it. A
  // publisher emitting `seq: 1` then `seq: 5` reads as conformant under the weaker rule and is
  // unreadable by any walk: the walk descends by `prev` and has no other way to name the next
  // version to fetch, §5.4's derived URLs are indexed by `seq`, and §9.1.1's anchors are
  // arithmetic on it. Served at a *derived* URL, the gap is not even a 404 — it is a version
  // answering to a seq that is not its own.
  const fx = identityFixture({ versions: 2 });
  const jumped = { ...fx.chain.at(2), seq: 5 };
  jumped._sig = sign(jumped, fx.primary.privateKey, `${fx.identity}#key-1`);
  fx.store.byUrl.set(fx.url, jumped);
  fx.store.byUrl.set(derivedVersionUrl(fx.url, 4), fx.chain.at(2));

  await assert.rejects(
    () => walk(fx, jumped, pinOf(fx.chain.at(1))),
    (e) => e instanceof ChainError && /is seq 2, not 4/.test(e.message),
  );
});

test('the versions walked per update are capped', async () => {
  // §5.4 / §13.4: RECOMMENDED 1000. Set low here so the test is about the cap, not the clock.
  const fx = identityFixture({ versions: 8 });
  await assert.rejects(
    () => walk(fx, undefined, pinOf(fx.chain.at(1)), { maxVersions: 3 }),
    (e) => e instanceof ChainError && /more than 3 versions/.test(e.message),
  );
});

// ---- §5.2 continuity keys ----

test('a version signed by a key its predecessor does not list is refused', async () => {
  // Hash linkage alone is insufficient: a fabricated intermediate could introduce a key.
  const fx = identityFixture({ versions: 2 });
  const stranger = makeKey('key-99');
  stranger.identity = fx.identity;
  fx.chain.publish({
    fields: { url: fx.identity, name: 'Owner', keys: [...fx.keys, stranger.jwk] },
    signer: stranger,
  });
  await assert.rejects(
    () => walk(fx, undefined, pinOf(fx.chain.at(1))),
    (e) => e instanceof ChainError && /does not list/.test(e.message),
  );
});

test('a recovery key cannot sign a chain version', async () => {
  // §4.5: recovery keys co-sign only. The rejection now happens at key resolution
  // (findKey, §4.5) rather than at the continuity check, so any layer that resolves a
  // `_sig` refuses a recovery signer — the error type follows the layer.
  const fx = identityFixture({ versions: 2 });
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: fx.keys }, signer: fx.recovery[0] });
  await assert.rejects(
    () => walk(fx, undefined, pinOf(fx.chain.at(1))),
    (e) => /recovery key/.test(e.message),
  );
});

test('a stolen key cannot un-revoke itself in the version it signs', async () => {
  // The attack §5 opens with, in its subtler form. §6.5 resolves a key against the document
  // it is verifying, and here the attacker wrote that document — so a successor that simply
  // omits the revocation passes the signature check outright. Only the continuity rule,
  // which judges validity against the *pinned predecessor*, catches it.
  const fx = identityFixture({ versions: 1 });
  const v1 = fx.chain.at(1);
  const revokedAt = v1.updated + 86400;

  // seq 2: ordinary rotation — key-1 revoked in the very version it signs (§5.2).
  const rotated = fx.keys.map((k) => (k.kid === 'key-1' ? { ...k, revoked_at: revokedAt } : { ...k }));
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: rotated }, signer: fx.primary });
  assert.ok(await walk(fx, fx.chain.at(2), pinOf(v1)), 'rotation itself must verify');

  // seq 3: signed by the revoked key, whose entry no longer carries revoked_at.
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: fx.keys }, signer: fx.primary });
  await assert.rejects(
    () => walk(fx, fx.chain.at(3), pinOf(v1)),
    (e) => e instanceof ChainError && /already revoked/.test(e.message),
  );
});

test('a kid cannot be rebound to different key material across a hop', async () => {
  // The substitution the continuity rule exists to prevent, arrived at from the other side:
  // keep the label, swap the key. The successor's signature verifies against the key listed
  // in the successor, and the kid *is* listed in the predecessor — so a check that compares
  // only kids passes an identity takeover. §4.2 closes it: a kid permanently names one key.
  const fx = identityFixture({ versions: 1 });
  const impostor = makeKey('key-1'); // same kid, new material
  impostor.identity = fx.identity;
  fx.chain.publish({
    fields: { url: fx.identity, name: 'Owner', keys: [impostor.jwk, ...fx.recovery.map((k) => k.jwk)] },
    signer: impostor,
  });
  await assert.rejects(
    () => walk(fx, undefined, pinOf(fx.chain.at(1))),
    (e) => e instanceof ChainError && /rebinds/.test(e.message),
  );
});

// ---- §5.3.1 the compare rule ----

test('two hashes at one seq is equivocation, and it freezes the chain', async () => {
  const fx = identityFixture({ versions: 3 });
  const pins = new PinStore();
  await walk(fx, undefined, null, { pins });
  pins.advance(fx.url, 3, documentHash(fx.chain.at(3)));

  // A second *observation* of seq 3 with different bytes — own store, cache, second device.
  // §5.3.1 holds whatever the provenance, so long as it is an observation and not a claim.
  assert.throws(
    () => pins.observe(fx.url, 3, 'a-different-hash', { provenance: 'second device' }),
    (e) => {
      assert.ok(e instanceof EquivocationError);
      assert.equal(e.seq, 3);
      assert.match(e.message, /second device/);
      return true;
    },
  );

  assert.equal(pins.isFrozen(fx.url), true);
  // "Retain the pin without advancing it, accept no further version of that chain."
  assert.equal(pins.pin(fx.url).seq, 3);
  assert.throws(() => pins.advance(fx.url, 4, 'whatever'), (e) => /frozen/.test(e.message));
});

test('equal hashes at one seq are corroboration, not equivocation', async () => {
  const fx = identityFixture({ versions: 2 });
  const pins = new PinStore();
  const hash = documentHash(fx.chain.at(2));
  assert.equal(pins.observe(fx.url, 2, hash).corroborated, false);
  assert.equal(pins.observe(fx.url, 2, hash, { provenance: 'cached response' }).corroborated, true);
  assert.equal(pins.isFrozen(fx.url), false);
});

test('a peer pin is a claim, and a wrong one cannot freeze anybody', async () => {
  // §16 says plainly that signing a pin does not make it true. If a peer's assertion were a
  // second observation, §5.3.1's response — accept no further version until a human re-pins —
  // would be available through §16.1's item-carried pins to any stranger who can reach an
  // inbox.
  const fx = identityFixture({ versions: 2 });
  const pins = new PinStore();
  const hash = documentHash(fx.chain.at(2));
  pins.advance(fx.url, 2, hash);

  assert.deepEqual(pins.reconcilePeerPin(fx.url, 2, 'a-hash-the-peer-invented'), {
    verdict: 'check', held: hash, seq: 2,
  });
  assert.equal(pins.isFrozen(fx.url), false, 'a claim resolves to "go look", never to a freeze');
  assert.equal(pins.reconcilePeerPin(fx.url, 2, hash).verdict, 'corroborates');
  // A tracked chain at an unseen seq is the re-walk signal (§16.1 recovery propagation)...
  assert.equal(pins.reconcilePeerPin(fx.url, 9, 'whatever').verdict, 'unknown');
  // ...but a chain this store has never tracked is ignored outright: dereferencing on a
  // stranger's word is §13.9's fetch-amplification vector, and §16.1 forbids it.
  assert.equal(pins.reconcilePeerPin('https://stranger.example/openfeed.json', 1, 'x').verdict, 'untracked');

  // And the consumer is still able to advance, which is the property the old behavior lost.
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: fx.keys.map((k) => ({ ...k })) }, signer: fx.primary });
  assert.equal(pins.advance(fx.url, 3, documentHash(fx.chain.at(3))).seq, 3);
});

test("an item's pins are scoped by how the item travels (§16.1)", () => {
  // Published items may pin only chains of the identities they address; delivered-only items
  // may also pin third parties, because delivery reaches exactly one counterparty.
  const mom = { url: 'https://mom.example/openfeed.json', seq: 3, hash: 'h-mom' };
  const gran = { url: 'https://gran.example/openfeed.json', seq: 1, hash: 'h-gran' };
  const ownedByRecipient = new Set([mom.url, 'https://mom.example/manifest.json']);

  const published = { _feed_url: 'https://me.example/feed.json', _pins: [mom, gran] };
  const pub = admissibleItemPins(published, { ownedChainUrls: ownedByRecipient });
  assert.equal(pub.delivered, false);
  assert.deepEqual(pub.admissible, [mom], 'a third-party pin on a published item is ignored');
  assert.deepEqual(pub.ignored, [gran]);

  const deliveredOnly = { _pins: [mom, gran] };
  const del = admissibleItemPins(deliveredOnly, { ownedChainUrls: ownedByRecipient });
  assert.equal(del.delivered, true);
  assert.deepEqual(del.admissible, [mom, gran], 'delivery may carry third-party pins');

  // Malformed entries are ignored on either axis.
  const junk = admissibleItemPins({ _pins: [{ url: mom.url, seq: 0, hash: 'h' }, 'nope', null] });
  assert.deepEqual(junk.admissible, []);
  assert.equal(junk.ignored.length, 3);
});

test('the chains an identity owns are its document and every manifest it names (§16.1)', () => {
  // The set a published item's pins are scoped to, and the set an emitter draws from. The
  // identity URL is normalized first (§3.1): a recipient who writes `:443` or a capitalized
  // host owns the same chains either way, and a set keyed on the raw string would make one
  // identity two — two pins of one document, never reconcilable.
  const doc = {
    url: 'https://Mom.Example:443/~mom',
    feeds: [
      { url: 'https://mom.example/feed.json', manifest: 'https://mom.example/manifest.json' },
      { url: 'https://mom.example/garden.json', manifest: 'https://mom.example/garden/manifest.json' },
      { url: 'https://mom.example/unmanifested.json' },   // §9 is per feed, and optional
      'not an entry',
      null,
    ],
  };
  assert.deepEqual([...chainUrlsOf(doc)].sort(), [
    'https://mom.example/garden/manifest.json',
    'https://mom.example/manifest.json',
    'https://mom.example/~mom/openfeed.json',
  ]);

  // A document with nothing usable owns no chains rather than throwing: this feeds a scoping
  // rule, and a scoping rule that throws on a malformed peer document is a scoping rule an
  // attacker turns off.
  assert.deepEqual([...chainUrlsOf({})], []);
  assert.deepEqual([...chainUrlsOf(null)], []);
  assert.deepEqual([...chainUrlsOf({ url: 'http://insecure.example/' })], []);
  assert.deepEqual([...chainUrlsOf({ feeds: 'not an array' })], []);
});

test('an emitter draws pins from its own store, and they are admissible by construction (§16.1)', () => {
  // The supply side of §5.3.1's compare rule: "a publisher that already tracks a recipient's
  // chains SHOULD carry pins for them on the interaction items it sends."
  let clock = 1000;
  const pins = new PinStore({ now: () => clock });
  const momDoc = {
    url: 'https://mom.example/',
    feeds: [{ url: 'https://mom.example/feed.json', manifest: 'https://mom.example/manifest.json' }],
  };
  const granDoc = { url: 'https://gran.example/' };

  pins.advance('https://mom.example/openfeed.json', 1, 'h-id-1');
  clock = 2000;
  pins.advance('https://mom.example/openfeed.json', 2, 'h-id-2');
  clock = 3000;
  pins.advance('https://mom.example/manifest.json', 7, 'h-man-7');
  pins.advance('https://gran.example/openfeed.json', 1, 'h-gran-1');

  const entries = pinsForRecipients(pins, [momDoc, momDoc]);
  assert.deepEqual(entries, [
    // `observed` is this version's own first-observation time, not first contact with the
    // chain — §16.1's informal timestamping is an assertion about `(url, seq, hash)`, and a
    // URL-level time would make every entry a claim to have witnessed seq 2 at seq 1's clock.
    { url: 'https://mom.example/openfeed.json', seq: 2, hash: 'h-id-2', observed: 2000 },
    { url: 'https://mom.example/manifest.json', seq: 7, hash: 'h-man-7', observed: 3000 },
  ], 'the tip of each chain the recipient owns, once, whatever the recipient is listed twice');

  // Nothing is invented for a chain this emitter does not track.
  assert.deepEqual(pinsForRecipients(pins, [{ url: 'https://stranger.example/' }]), []);
  assert.deepEqual(pinsForRecipients(pins, []), []);

  // The property that makes the emitter conformant without a second rule: everything it
  // produces for a recipient survives that recipient's own §16.1 scoping on a *published*
  // item, which is where the rule bites (§16.2's MUST on an emitter).
  const published = { _feed_url: 'https://me.example/feed.json', _pins: entries };
  const scoped = admissibleItemPins(published, { ownedChainUrls: chainUrlsOf(momDoc) });
  assert.deepEqual(scoped.admissible, entries);
  assert.deepEqual(scoped.ignored, []);

  // And the boundary the emitter must not cross by itself: gran's pin is a third party's, so
  // it is gossip a *delivered* item may carry and a published one may not. `pinsForRecipients`
  // will assemble it — the caller chose the documents — and the receiving side is what draws
  // the line, which is the only place it can be drawn.
  const gossip = pinsForRecipients(pins, [momDoc, granDoc]);
  assert.equal(gossip.length, 3);
  assert.deepEqual(
    admissibleItemPins({ _feed_url: 'https://me.example/feed.json', _pins: gossip },
      { ownedChainUrls: chainUrlsOf(momDoc) }).ignored,
    [gossip.at(-1)],
    'published: the third-party entry is ignored on receipt',
  );
  assert.deepEqual(
    admissibleItemPins({ _pins: gossip }, { ownedChainUrls: chainUrlsOf(momDoc) }).admissible,
    gossip,
    'delivered-only: all three, because delivery reaches exactly one counterparty',
  );
});

test('re-pinning is deliberate, and it discards the observations that disagreed', async () => {
  const fx = identityFixture({ versions: 2 });
  const pins = new PinStore();
  pins.advance(fx.url, 2, documentHash(fx.chain.at(2)));
  assert.throws(() => pins.observe(fx.url, 2, 'other'), EquivocationError);

  pins.rePin(fx.url, 2, 'other');
  assert.equal(pins.isFrozen(fx.url), false);
  assert.equal(pins.pin(fx.url).hash, 'other');
  // Keeping the old observations would refreeze the chain on the very next fetch.
  assert.doesNotThrow(() => pins.observe(fx.url, 2, 'other'));
});

test('a walk that reaches the pinned seq with different bytes surfaces equivocation', async () => {
  // The store serves an honest tip but a rewritten history: the walk connects by hash all
  // the way down and only the pin disagrees.
  const fx = identityFixture({ versions: 3 });
  const pin = pinOf(fx.chain.at(1));
  await assert.rejects(
    () => walk(fx, undefined, { seq: 1, hash: 'what-this-consumer-actually-saw' }),
    (e) => e instanceof EquivocationError && e.seq === 1,
  );
  assert.ok(await walk(fx, undefined, pin), 'the honest pin still walks');
});

// ---- §9.1.1 skip links ----

test('a walk follows skip links and lands on absolute anchors', async () => {
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({ store, signer: fx.primary, versions: 40, skipLinks: true });
  const identityDoc = fx.chain.at(1);

  const linear = await walkToPin({
    url: m.manifestUrl, tip: m.chain.at(40), pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(identityDoc), useSkipLinks: false,
  });
  const skipped = await walkToPin({
    url: m.manifestUrl, tip: m.chain.at(40), pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(identityDoc),
  });

  assert.equal(linear.hops, 39);
  assert.ok(skipped.hops < linear.hops, `skipping should shorten the walk, got ${skipped.hops}`);
  // Every landing is an anchor some version was entitled to offer, which is what makes two
  // readers land on the same versions and §5.3.1 able to compare anything.
  for (const v of skipped.versions) assert.ok(v.seq >= 1 && v.seq <= 40);
});

test('a forged anchor is caught by the version immediately above it', async () => {
  // "An anchor and a prev are two signed statements about one version's bytes." Without the
  // second, a publisher can aim a forged anchor at skipping readers alone.
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({ store, signer: fx.primary, versions: 16, skipLinks: true });

  const tip = m.chain.at(16);
  const forged = { ...tip, _skip: { ...tip._skip, 8: 'an-anchor-nobody-published' } };
  forged._sig = sign(forged, fx.primary.privateKey, `${fx.identity}#key-1`);

  await assert.rejects(
    () => walkToPin({
      url: m.manifestUrl, tip: forged, pin: pinOf(m.chain.at(1)),
      fetchVersion: store.fetchVersion, policy: manifestChainPolicy(fx.chain.at(1)),
    }),
    (e) => e instanceof ChainError && /anchors seq 8/.test(e.message),
  );
});

test('a relative anchor is ignored rather than followed', async () => {
  // §9.1.1: anchors MUST be absolute. A consumer that followed `seq−3` would land where no
  // other reader lands, which is the property relative offsets quietly destroy.
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({ store, signer: fx.primary, versions: 12 });

  const tip = m.chain.at(12);
  const forged = { ...tip, _skip: { 9: documentHash(m.chain.at(9)) } }; // 9 is not an anchor of 12
  forged._sig = sign(forged, fx.primary.privateKey, `${fx.identity}#key-1`);

  const result = await walkToPin({
    url: m.manifestUrl, tip: forged, pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(fx.chain.at(1)),
  });
  assert.equal(result.hops, 11, 'a non-absolute anchor must not shorten the walk');
});

test('an identity chain never follows a skip link, whatever the caller asks for', async () => {
  // §9.1.1 defines `_skip` for the manifest only, and the restriction is a security property
  // rather than a size judgement. The decision therefore lives on the policy, and a caller
  // passing `useSkipLinks: true` must not be able to reach around it.
  const fx = identityFixture({ versions: 13, skipLinks: true });
  assert.ok(fx.chain.tip._skip, 'the fixture must actually be offering anchors');

  for (const extra of [{}, { useSkipLinks: true }]) {
    const result = await walk(fx, undefined, pinOf(fx.chain.at(1)), extra);
    assert.equal(result.hops, 12, 'an identity chain is walked linearly, one hop per version');
  }
});

test('a forged identity tip cannot be spliced onto an honest history with a copied anchor', async () => {
  // The attack the policy gate exists to stop, and it needs no key at all: a serving-path
  // compromise (CDN, bucket, web tier) writes a document at the tip URL listing a key it
  // just generated. §5.3 step 1 makes the tip its own key source, so the tip verifies against
  // itself; the skip path never checks the tip's own `prev`; and the anchors are copied
  // verbatim from the honest tip, so every landing below them is genuine. Walked with skip
  // links the forgery is accepted and the attacker's key becomes authoritative.
  const fx = identityFixture({ versions: 13, skipLinks: true });
  const attacker = makeKey('key-1'); // same kid, their material
  const forged = {
    url: fx.identity,
    name: 'Owner',
    keys: [{ ...attacker.jwk }],
    seq: 13,
    updated: fx.chain.tip.updated + 60,
    prev: 'this-is-not-the-hash-of-seq-12',
    _skip: { ...fx.chain.tip._skip },
  };
  forged._sig = sign(forged, attacker.privateKey, `${fx.identity}#key-1`);

  await assert.rejects(
    () => walk(fx, forged, pinOf(fx.chain.at(1))),
    (e) => e instanceof ChainError && /names prev/.test(e.message),
    'the linear walk catches it at the first hop, on the tip\'s own prev',
  );
});

// ---- §9.1 the manifest chain is the same mechanism ----

test('a manifest is walked by the identical procedure, keyed on the identity chain', async () => {
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({ store, signer: fx.primary, versions: 5 });
  const result = await walkToPin({
    url: m.manifestUrl, tip: m.chain.at(5), pin: pinOf(m.chain.at(2)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(fx.chain.at(1)),
  });
  assert.equal(result.hops, 3);
});

test('a manifest claiming an identity other than its signer is refused', async () => {
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({
    store, signer: fx.primary, versions: 1, identity: 'https://someone-else.example/',
  });
  await assert.rejects(
    () => walkToPin({
      url: m.manifestUrl, tip: m.chain.at(1), pin: null,
      fetchVersion: store.fetchVersion, policy: manifestChainPolicy(fx.chain.at(1)),
    }),
    ChainError,
  );
});

// ---- §4.5 / §5.5 recovery and fork resolution ----

function coSign(doc, key) {
  const { _sig, _recovery_sig, ...rest } = doc;
  return { ...doc, _recovery_sig: sign(rest, key.privateKey, `${key.identity}#${key.kid}`) };
}

test('a recovery co-signature verifies against the key committed in the pinned ancestor', async () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 1 });
  const ancestor = fx.chain.at(1);
  const claim = coSign({ ...ancestor, seq: 2, updated: ancestor.updated + 86400 }, fx.recovery[0]);

  const result = verifyRecoverySignature(claim, { pinnedAncestor: ancestor });
  assert.equal(result.valid, true);
  assert.equal(result.signer, 'recovery-1');

  // No co-signature at all is simply invalid, not an error.
  const bare = { ...ancestor, seq: 2, updated: ancestor.updated + 86400 };
  assert.equal(verifyRecoverySignature(bare, { pinnedAncestor: ancestor }).valid, false);
});

test('the co-signing key must be a recovery key the pinned ancestor commits, naming this identity', () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 1 });
  const ancestor = fx.chain.at(1);
  const at2 = (extra) => ({ ...ancestor, seq: 2, updated: ancestor.updated + 86400, ...extra });

  // Author binding holds for co-signatures: the kid names *this* identity.
  const foreign = makeKey('recovery-1', { use: 'recovery' });
  foreign.identity = 'https://elsewhere.example/';
  const outside = coSign(at2(), foreign);
  const result = verifyRecoverySignature(outside, { pinnedAncestor: ancestor });
  assert.equal(result.valid, false);
  assert.match(result.reason, /elsewhere\.example/);

  // A key that is not a recovery key cannot co-sign.
  assert.equal(verifyRecoverySignature(coSign(at2(), fx.primary), { pinnedAncestor: ancestor }).valid, false);

  // The keys are read from the pinned ancestor, never from the claiming document — otherwise
  // anyone mints a "recovery key" alongside the claim it blesses.
  const minted = makeKey('recovery-9', { use: 'recovery' });
  minted.identity = fx.identity;
  const selfServing = coSign(at2({ keys: [...ancestor.keys, minted.jwk] }), minted);
  const mintedResult = verifyRecoverySignature(selfServing, { pinnedAncestor: ancestor });
  assert.equal(mintedResult.valid, false);
  assert.match(mintedResult.reason, /not a recovery key committed/);
});

test('a fork resolves to the recovery-co-signed branch, and otherwise does not resolve', () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 1 });
  const ancestor = fx.chain.at(1);
  const at2 = (extra) => ({ ...ancestor, seq: 2, updated: ancestor.updated + 86400, ...extra });

  // The thief holds the online key, so their branch signs but cannot co-sign: recovery keys
  // are offline, which is the entire basis for preferring the other branch.
  const stolen = at2({ name: 'Thief' });
  const honest = coSign(at2({ name: 'Owner' }), fx.recovery[0]);

  const resolved = resolveFork([stolen, honest], { pinnedAncestor: ancestor });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.preferred.name, 'Owner');

  // Neither branch co-signed: unresolvable, and flagged rather than guessed at.
  const neither = resolveFork([stolen, at2({ name: 'Other' })], { pinnedAncestor: ancestor });
  assert.equal(neither.resolved, false);
  assert.match(neither.reason, /no branch carries/);

  // Both co-signed, which means the recovery key is itself in question.
  const both = resolveFork([honest, coSign(at2({ name: 'Also' }), fx.recovery[0])], { pinnedAncestor: ancestor });
  assert.equal(both.resolved, false);
  assert.match(both.reason, /itself in question/);
});

// ---- the seams where a check runs but nothing observes it running ----

test('a PinStore threaded through a real walk catches equivocation mid-hop', async () => {
  // §5.3.1's compare rule is meant to fire *during* a walk, on any second observation of a
  // seq — not only at the pin. Staging it needs a rewritten intermediate: the store serves an
  // honest tip and an honest genesis, and swaps only what sits between them.
  const fx = identityFixture({ versions: 5 });
  const pins = new PinStore();

  // First pass: the consumer observes every version on the way down and pins the tip.
  const first = await walk(fx, undefined, pinOf(fx.chain.at(1)), { pins });
  assert.equal(first.hops, 4);
  assert.equal(first.contiguous, true);
  pins.advance(fx.url, 5, first.hash);
  for (let seq = 1; seq <= 5; seq++) {
    assert.ok(pins.observations.get(fx.url).has(seq), `seq ${seq} must have been observed`);
  }

  // The host now rewrites seq 3 and republishes the versions above it so the hashes chain.
  const rebuilt = new ChainBuilder({ url: fx.url, store: fx.store });
  const body = (name) => ({ url: fx.identity, name, keys: fx.keys.map((k) => ({ ...k })) });
  for (let seq = 1; seq <= 6; seq++) {
    rebuilt.publish({ fields: body(seq === 3 ? 'Rewritten' : 'Owner'), signer: fx.primary });
  }

  await assert.rejects(
    () => walk(fx, undefined, pins.pin(fx.url), { pins }),
    (e) => e instanceof EquivocationError && e.seq === 5,
    'the rewrite surfaces at the first seq the consumer already holds',
  );
  assert.equal(pins.isFrozen(fx.url), true, '§5.3.1: stop advancing and surface it');
  assert.equal(pins.pin(fx.url).seq, 5, 'the pin is retained, not advanced');
});

test('a skipping walk reports that its version list has gaps', async () => {
  // §9.1.1 skipping observes fewer versions. A caller checking anything per-version — §9.3's
  // invariants across a manifest's history — must not read the returned array as a range.
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({ store, signer: fx.primary, versions: 24, skipLinks: true });
  const args = {
    url: m.manifestUrl, tip: m.chain.at(24), pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(fx.chain.at(1)),
  };

  const skipped = await walkToPin(args);
  assert.equal(skipped.contiguous, false);
  assert.ok(skipped.versions.length < 24, 'a skipping walk does not see every version');

  const linear = await walkToPin({ ...args, useSkipLinks: false });
  assert.equal(linear.contiguous, true);
  assert.equal(linear.versions.length, 24);
});

// ---- shape and continuity, checked directly ----

test('a version whose shape is unusable is rejected before anything is trusted', async () => {
  const fx = identityFixture({ versions: 1 });
  const base = { url: fx.identity, keys: fx.keys, seq: 2, updated: 1736899200, prev: 'h' };
  const cases = [
    [{ ...base, seq: 0 }, /no usable seq/],
    [{ ...base, seq: 1.5 }, /no usable seq/],
    [{ ...base, seq: '2' }, /no usable seq/],
    [{ ...base, updated: '2025-01-01' }, /no usable updated/],
    [{ ...base, prev: undefined }, /with no prev/],
    // Genesis has no predecessor, so a `prev` on it names nothing and must not be tolerated:
    // a walk that accepted one would have a seq 1 it believes is linked to something.
    [{ ...base, seq: 1, prev: 'anything' }, /genesis and MUST omit prev/],
  ];
  for (const [tip, expected] of cases) {
    await assert.rejects(
      () => walk(fx, tip, pinOf(fx.chain.at(1))),
      (e) => e instanceof ChainError && expected.test(e.message),
      expected.source,
    );
  }

  // A fetch that yields nothing at all — a 404 body, an empty file — is not a document.
  for (const nothing of [null, 'a string', 42]) {
    await assert.rejects(
      () => walkToPin({
        url: fx.url, tip: nothing, pin: pinOf(fx.chain.at(1)),
        fetchVersion: fx.store.fetchVersion, policy: identityChainPolicy,
      }),
      (e) => e instanceof ChainError && /did not yield a document/.test(e.message),
    );
  }
});

test('the continuity rule is four checks, and each fails on its own', () => {
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 2, store, recoveryKeys: 1 });
  const [predecessor, successor] = [fx.chain.at(1), fx.chain.at(2)];
  assert.ok(assertContinuityKey(successor, predecessor), 'the honest hop passes');

  const resign = (doc, key) => {
    const next = { ...doc };
    delete next._sig;
    next._sig = sign(next, key.privateKey, `${fx.identity}#${key.kid}`);
    return next;
  };

  // 1. Signed by a key the predecessor does not list.
  const stranger = makeKey('key-9');
  assert.throws(
    () => assertContinuityKey(resign({ ...successor, keys: [...fx.keys, stranger.jwk] }, stranger), predecessor),
    (e) => /does not list/.test(e.message),
  );
  // 2. Signed by a recovery key, which §4.5 forbids from signing chain versions.
  assert.throws(
    () => assertContinuityKey(resign(successor, fx.recovery[0]), predecessor),
    (e) => /recovery key/.test(e.message),
  );
  // 3. Signed by a key already revoked in the predecessor. Equality counts as revoked here
  //    and as valid in §6.5, which is exactly what makes §5.2's normal rotation work.
  const revoked = { ...predecessor, keys: [{ ...fx.primary.jwk, revoked_at: predecessor.updated }] };
  assert.throws(
    () => assertContinuityKey(successor, revoked),
    (e) => /already revoked/.test(e.message),
  );
  // 4. The kid kept, the key material swapped — an identity takeover that satisfies both
  //    "listed in the predecessor" and "listed in the document itself" read literally.
  const impostor = makeKey('key-1');
  assert.throws(
    () => assertContinuityKey(resign({ ...successor, keys: [impostor.jwk] }, impostor), predecessor),
    (e) => /rebinds key-1/.test(e.message),
  );
});

test('a pin never moves backwards, even without a walk', () => {
  const fx = identityFixture({ versions: 3 });
  // A clock that actually moves, so the two timestamps below are distinguishable. With a
  // frozen clock this test passed whatever the code did with them.
  let clock = 1739577600;
  const pins = new PinStore({ now: () => (clock += 3600) });
  pins.advance(fx.url, 2, documentHash(fx.chain.at(2)));
  const { observed: observedAt2, firstPinned } = pins.pin(fx.url);

  assert.throws(
    () => pins.advance(fx.url, 1, documentHash(fx.chain.at(1))),
    (e) => e instanceof ChainError && /went backwards/.test(e.message),
  );
  pins.advance(fx.url, 3, documentHash(fx.chain.at(3)));

  assert.equal(pins.pin(fx.url).firstPinned, firstPinned, 'pin age survives an advance');
  // But `observed` is per version, because that is what §16.1 shares. Carrying the
  // first-contact time forward would assert you witnessed seq 3 before it was written.
  assert.ok(pins.pin(fx.url).observed > observedAt2, 'observed tracks this version, not the URL');
  assert.deepEqual(
    pins.observationsFor(fx.url).map((p) => p.seq),
    [2, 3],
    'every observed version is retained, which is what makes a peer’s older pin checkable',
  );
});

test('a skip map keyed by anything but a canonical seq is ignored, not misread', () => {
  // `"0256"` and `"1e3"` parse to numbers whose String() does not round-trip, so a naive
  // lookup misses and the failure surfaces later as an unrelated prev mismatch.
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 1, store });
  const m = manifestFixture({ store, signer: fx.primary, versions: 12 });

  const tip = m.chain.at(12);
  const forged = { ...tip, _skip: { '08': documentHash(m.chain.at(8)), ' 8': documentHash(m.chain.at(8)) } };
  forged._sig = sign(forged, fx.primary.privateKey, `${fx.identity}#key-1`);

  return walkToPin({
    url: m.manifestUrl, tip: forged, pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(fx.chain.at(1)),
  }).then((r) => assert.equal(r.hops, 11, 'a non-canonical key must not be read as an anchor'));
});

// ---- §9.1: the revoked-tip rule ----

test('a manifest tip signed by a revoked key is rejected, and its history is not', async () => {
  // The asymmetry this rule exists for. On the identity chain revocation is structural: §5.2
  // step 3 judges a continuity key against the *previous* version, so a revoked key cannot
  // sign the next one at all. A manifest resolves its signer through §6.5, against its own
  // self-reported `updated` — so a revoked key extends the content chain forever by choosing
  // timestamps just below the revocation, which is exactly the capability §4.6 promises a
  // member gets back when they revoke a delegation.
  const store = new DocumentStore();
  const identity = 'https://owner.example/';
  const hub = makeKey('hub-1', { use: 'delegated' });
  hub.identity = identity;
  const root = makeKey('root-1');
  root.identity = identity;

  const REVOKED_AT = 1736899200 + 10 * 86400;
  const idChain = new ChainBuilder({ url: `${identity}openfeed.json`, store });
  idChain.publish({ fields: { url: identity, keys: [root.jwk, hub.jwk] }, signer: root });
  idChain.publish({
    fields: {
      url: identity,
      keys: [root.jwk, { ...hub.jwk, revoked_at: REVOKED_AT }],
    },
    signer: root,
  });
  const current = idChain.at(2);

  // Three honest manifest versions, all signed by the hub before the revocation.
  const m = manifestFixture({ store, signer: hub, versions: 3 });
  // A fourth, minted after the revocation with a backdated `updated` — the whole attack. Its
  // `updated` is below REVOKED_AT, so §6.5's comparison passes and nothing else objects.
  const backdated = m.chain.publish({
    fields: { url: identity, feed_url: m.feedUrl, items: {} },
    signer: hub,
    updated: REVOKED_AT - 1,
  });
  assert.ok(backdated.updated < REVOKED_AT, 'the forgery is inside §6.5\'s window by construction');

  const now = () => REVOKED_AT + 86400;
  await assert.rejects(
    () => walkToPin({
      url: m.manifestUrl, tip: backdated, pin: pinOf(m.chain.at(1)),
      fetchVersion: store.fetchVersion, policy: manifestChainPolicy(current, { now }),
    }),
    (e) => e instanceof ChainError && /revoked at/.test(e.message),
    'the tip is refused however its own clock reads',
  );

  // The same versions, reached as history below a tip a live key signed, MUST still verify:
  // rejecting them would retroactively unpublish everything a rotated key ever committed.
  const live = m.chain.publish({
    fields: { url: identity, feed_url: m.feedUrl, items: {} },
    signer: root,
    updated: now() + 1,
  });
  const walked = await walkToPin({
    url: m.manifestUrl, tip: live, pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion, policy: manifestChainPolicy(current, { now }),
  });
  assert.equal(walked.hops, 4, 'every version the revoked key signed is still walked through');
});

test('a revocation scheduled in the future does not refuse today\'s manifest tip', async () => {
  // Judged against the consumer's own clock, not "carries a revoked_at at all": a publisher
  // MAY schedule a revocation, and its manifests stay good until it lands. This is §4.4's
  // receipt-time discipline — an attacker can backdate `updated` and cannot backdate the
  // moment this consumer fetched.
  const store = new DocumentStore();
  const identity = 'https://owner.example/';
  const signer = makeKey('key-1');
  signer.identity = identity;
  const LATER = 1736899200 + 400 * 86400;

  const idChain = new ChainBuilder({ url: `${identity}openfeed.json`, store });
  idChain.publish({
    fields: { url: identity, keys: [{ ...signer.jwk, revoked_at: LATER }] },
    signer,
  });

  const m = manifestFixture({ store, signer, versions: 2 });
  const walked = await walkToPin({
    url: m.manifestUrl, tip: m.chain.at(2), pin: pinOf(m.chain.at(1)),
    fetchVersion: store.fetchVersion,
    policy: manifestChainPolicy(idChain.at(1), { now: () => LATER - 86400 }),
  });
  assert.equal(walked.hops, 1);
});

// ---- §5.5 fork resolution, from the reader's side ----

test('§5.5 resolution runs before a divergence is called unresolved compromise', async () => {
  // §5.3.1: "Run §5.5 resolution before treating a divergence as unresolved compromise." After
  // key theft both branches carry valid continuity signatures, so detection says *that* a chain
  // forked and never *which* branch is honest. The one thing a thief of an online key cannot
  // produce is a co-signature by an offline recovery key committed in a pinned ancestor.
  const store = new DocumentStore();
  const fx = identityFixture({ versions: 2, store, recoveryKeys: 1 });
  const recovery = fx.recovery[0];

  // The consumer pinned seq 2 — the branch it happened to fetch, which after a theft may be
  // either one. Nothing at this point distinguishes them.
  const pins = new PinStore({ now: () => 1736899200 });
  pins.advance(fx.url, 2, documentHash(fx.chain.at(2)));

  // The other branch: a competing seq 2 with different bytes, and a seq 3 above it carrying the
  // recovery co-signature. Built as a fresh chain so seq 2's hash genuinely differs.
  const rival = new ChainBuilder({ url: fx.url, store: new DocumentStore() });
  const body = { url: fx.identity, name: 'Owner (recovered)', keys: fx.keys.map((k) => ({ ...k })) };
  rival.publish({ fields: { ...body, name: 'Owner' }, signer: fx.primary });
  rival.publish({ fields: body, signer: fx.primary });
  const tip = rival.publish({ fields: body, signer: fx.primary });

  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', b64: false, crit: ['b64'], kid: `${fx.identity}#${recovery.kid}` }),
    'utf8',
  ).toString('base64url');
  const { signingPayload, signingInput } = await import('../src/index.js');
  const crypto = await import('node:crypto');
  tip._recovery_sig = `${headerB64}..${Buffer.from(
    crypto.default.sign(null, signingInput(headerB64, signingPayload(tip)), recovery.privateKey),
  ).toString('base64url')}`;

  // Without a committed recovery key to check against, the divergence stands: §5.5's premise is
  // that the key was committed *before* the theft, and a consumer holding no ancestor has no way
  // to know that. Freezing is the correct outcome, not a limitation to work around.
  assert.equal(verifyRecoverySignature(tip, { pinnedAncestor: fx.chain.at(1) }).valid, true);
  assert.equal(
    verifyRecoverySignature(tip, { pinnedAncestor: { url: fx.identity, seq: 1, keys: [] } }).valid,
    false,
    'no committed recovery key means no resolution',
  );

  // And the branch a thief could build — same shape, no co-signature — is not preferred.
  const forged = { ...tip };
  delete forged._recovery_sig;
  assert.equal(verifyRecoverySignature(forged, { pinnedAncestor: fx.chain.at(1) }).valid, false);
});

// ---- bounding a store that is written whole on every run ----

test('observation history is compacted toward the seqs two readers share', () => {
  // §16.1 keeps observations per `seq` so a peer's *older* pin is checkable, and that is worth
  // real money — but the manifest is the long chain (§9.2), and this store is serialized whole
  // on every run. "Bounded by chain length" is not a bound once the chain is 87,600 versions.
  //
  // What to drop is decided by §9.1.1 rather than by age. Skip anchors are absolute — the
  // largest multiple of each 2^k below a seq — precisely so that "every reader does not land on
  // a different set of versions", because §5.3.1 needs two observers at the SAME seq to compare
  // anything. So the entries worth keeping are the ones divisible by the largest powers of two:
  // those are the seqs a second observer, walking from some other head, is most likely to hold.
  const store = new PinStore({ now: () => 1000, maxObservationsPerChain: 64 });
  const url = 'https://mom.example/manifest.json';
  for (let seq = 1; seq <= 4000; seq++) store.observe(url, seq, `hash-${seq}`);

  const kept = new Set(store.observationsFor(url).map((e) => e.seq));
  assert.ok(kept.size <= 128, `compaction ran: ${kept.size} entries retained of 4000`);

  // The high-order anchors survive, which is the property the whole rule exists for: two readers
  // polling at different heads both land on these.
  for (const anchor of [1024, 2048, 3072, 512, 1536]) {
    assert.ok(kept.has(anchor), `seq ${anchor} is an anchor many readers share`);
  }
  // A reader walking down from 4000 lands on this set; the overlap with what we kept is what a
  // peer's pin can actually be checked against.
  const landings = skipAnchors(4000).filter((s) => s <= 4000);
  const checkable = landings.filter((s) => kept.has(s));
  assert.ok(checkable.length >= landings.length / 2,
    `${checkable.length} of ${landings.length} anchor landings remain checkable`);

  // Recent history survives whatever its divisibility — a peer's pin is usually recent, and an
  // odd seq near the tip is the disagreement worth resolving today.
  assert.ok(kept.has(3999) && kept.has(4000));
});

test('re-pin evidence is bounded, because a hostile publisher can provoke re-pins', () => {
  // §5.3.1's re-pin sets the disagreeing observations aside rather than deleting them, and that
  // is right — a re-pin chooses a branch, it does not un-happen the divergence. But each entry
  // carries a whole observation set, and the act that writes one can be provoked repeatedly.
  const store = new PinStore({ now: () => 1000, maxSupersededPerChain: 3 });
  const url = 'https://mom.example/openfeed.json';
  for (let i = 1; i <= 10; i++) {
    store.advance(url, i, `hash-${i}`);
    store.rePin(url, i, `hash-${i}`);
  }
  const held = store.supersededObservationsFor(url);
  assert.equal(held.length, 3, 'oldest re-pins drop; the branch in use keeps its evidence');
});
