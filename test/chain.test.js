// The version chain: §5.3's pin-and-walk, §5.3.1's compare rule, §5.4's derived URLs,
// §5.5's fork resolution, and §9.1.1's skip links.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  derivedVersionUrl,
  skipAnchors,
  PinStore,
  walkToPin,
  identityChainPolicy,
  manifestChainPolicy,
  assertContinuityKey,
  verifyRecoverySignatures,
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
  // §4.5: recovery keys MUST NOT sign regular content or manifests, and co-sign only.
  const fx = identityFixture({ versions: 2 });
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: fx.keys }, signer: fx.recovery[0] });
  await assert.rejects(
    () => walk(fx, undefined, pinOf(fx.chain.at(1))),
    (e) => e instanceof ChainError && /recovery key/.test(e.message),
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
  // only kids passes an identity takeover. See HANDOFF: the spec does not spell this out.
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
  // would be available to anyone who can publish a file, and through §16.5's item-carried pins
  // to any stranger who can reach an inbox.
  const fx = identityFixture({ versions: 2 });
  const pins = new PinStore();
  const hash = documentHash(fx.chain.at(2));
  pins.advance(fx.url, 2, hash);

  assert.deepEqual(pins.reconcilePeerPin(fx.url, 2, 'a-hash-the-peer-invented'), {
    verdict: 'check', held: hash, seq: 2,
  });
  assert.equal(pins.isFrozen(fx.url), false, 'a claim resolves to "go look", never to a freeze');
  assert.equal(pins.reconcilePeerPin(fx.url, 2, hash).verdict, 'corroborates');
  assert.equal(pins.reconcilePeerPin(fx.url, 9, 'whatever').verdict, 'unknown');

  // And the consumer is still able to advance, which is the property the old behavior lost.
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: fx.keys.map((k) => ({ ...k })) }, signer: fx.primary });
  assert.equal(pins.advance(fx.url, 3, documentHash(fx.chain.at(3))).seq, 3);
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

function coSign(doc, keys) {
  const { _sig, _recovery_sig, ...rest } = doc;
  const out = { ...doc };
  out._recovery_sig = keys.map((k) => sign(rest, k.privateKey, `${k.identity}#${k.kid}`));
  return out;
}

test('recovery co-signatures verify against the keys committed in the pinned ancestor', async () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 3, recoveryThreshold: 2 });
  const ancestor = fx.chain.at(1);
  const claim = coSign({ ...ancestor, seq: 2, updated: ancestor.updated + 86400 }, fx.recovery.slice(0, 2));

  const result = verifyRecoverySignatures(claim, { pinnedAncestor: ancestor });
  assert.equal(result.met, true);
  assert.equal(result.threshold, 2);
  assert.deepEqual(result.signers.sort(), ['recovery-1', 'recovery-2']);
});

test('the threshold is read from the pinned ancestor, never from the document claiming it', () => {
  // §4.5: otherwise a thief holding one key declares a threshold of one and the mechanism
  // defeats itself. This is the whole reason the rule is stated as a MUST.
  const fx = identityFixture({ versions: 1, recoveryKeys: 3, recoveryThreshold: 3 });
  const ancestor = fx.chain.at(1);
  const claim = coSign(
    { ...ancestor, seq: 2, updated: ancestor.updated + 86400, recovery_threshold: 1 },
    [fx.recovery[0]],
  );
  const result = verifyRecoverySignatures(claim, { pinnedAncestor: ancestor });
  assert.equal(result.threshold, 3, 'the claiming document must not set the threshold');
  assert.equal(result.met, false);
});

test('co-signatures must be by distinct keys, and must name this identity', () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 2, recoveryThreshold: 2 });
  const ancestor = fx.chain.at(1);

  // One key co-signing twice is one co-signature.
  const doubled = coSign(
    { ...ancestor, seq: 2, updated: ancestor.updated + 86400 },
    [fx.recovery[0], fx.recovery[0]],
  );
  assert.equal(verifyRecoverySignatures(doubled, { pinnedAncestor: ancestor }).met, false);

  // Author binding holds for co-signatures: every kid names *this* identity.
  const foreign = makeKey('recovery-1', { use: 'recovery' });
  foreign.identity = 'https://elsewhere.example/';
  const outside = coSign({ ...ancestor, seq: 2, updated: ancestor.updated + 86400 }, [fx.recovery[0], foreign]);
  const result = verifyRecoverySignatures(outside, { pinnedAncestor: ancestor });
  assert.equal(result.met, false);
  assert.match(result.rejected.join(' '), /elsewhere\.example/);

  // A key that is not a recovery key does not count toward the threshold either.
  const withPrimary = coSign({ ...ancestor, seq: 2, updated: ancestor.updated + 86400 }, [fx.recovery[0], fx.primary]);
  assert.equal(verifyRecoverySignatures(withPrimary, { pinnedAncestor: ancestor }).met, false);
});

test('a fork resolves to the branch meeting the threshold, and otherwise does not resolve', () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 2, recoveryThreshold: 2 });
  const ancestor = fx.chain.at(1);
  const at2 = (extra) => ({ ...ancestor, seq: 2, updated: ancestor.updated + 86400, ...extra });

  // The thief holds the online key, so their branch signs but cannot co-sign: recovery keys
  // are offline, which is the entire basis for preferring the other branch.
  const stolen = at2({ name: 'Thief' });
  const honest = coSign(at2({ name: 'Owner' }), fx.recovery);

  const resolved = resolveFork([stolen, honest], { pinnedAncestor: ancestor });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.preferred.name, 'Owner');

  // Neither branch co-signed: unresolvable, and flagged rather than guessed at.
  const neither = resolveFork([stolen, at2({ name: 'Other' })], { pinnedAncestor: ancestor });
  assert.equal(neither.resolved, false);
  assert.match(neither.reason, /no branch meets/);

  // Both co-signed, which means the recovery keys are themselves in question.
  const both = resolveFork([honest, coSign(at2({ name: 'Also' }), fx.recovery)], { pinnedAncestor: ancestor });
  assert.equal(both.resolved, false);
  assert.match(both.reason, /themselves in question/);
});

test('recovery_threshold defaults to 1 when the pinned ancestor sets none', () => {
  const fx = identityFixture({ versions: 1, recoveryKeys: 1 });
  const ancestor = fx.chain.at(1);
  const claim = coSign({ ...ancestor, seq: 2, updated: ancestor.updated + 86400 }, fx.recovery);
  const result = verifyRecoverySignatures(claim, { pinnedAncestor: ancestor });
  assert.equal(result.threshold, 1);
  assert.equal(result.met, true);
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
  // But `observed` is per version, because that is what §16.1 publishes. Carrying the
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
