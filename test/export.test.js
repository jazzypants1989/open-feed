// The export bundle (§14), and the one claim it stands on.
//
// §14 says "a consumer restores from a bundle by verifying it exactly as it would verify live
// documents. Nothing about verification changes because the bytes arrived in a file." That is a
// falsifiable claim about this repository, not a description: if `verifyBundle` needed one rule
// `createReader` does not have, the bundle would be a backup with an exit's vocabulary. So these
// tests restore with no network and no bundle-specific verifier, and the ones that matter most
// are about what a *hostile* exporter can do — §14's requirements were written for the case
// where the host holding the bytes is the one being left.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { DAY, T0, makeSigner } from './helpers/site.js';
import {
  Publisher,
  PinStore,
  buildBundle,
  containerEntries,
  completeness,
  degraded,
  verifyBundle,
  restoreFetcher,
  ExportError,
  BUNDLE_ENTRY,
  documentHash,
  canonicalBytes,
  b64u,
  sha256,
  sign,
  buildHeader,
  signingInput,
  signingPayload,
} from '../src/index.js';

const HUB = 'https://mom.hub.example/';

/** A publisher with a few days of content and a recovery key, ready to be exported. */
function published(identity = HUB, { signer = makeSigner('key-1'), recovery } = {}) {
  const p = new Publisher({
    identity,
    signer,
    profile: { name: 'Mom' },
    recoveryKeys: recovery ? [recovery.jwk] : [],
    now: () => T0,
  });
  for (let day = 0; day < 3; day++) {
    p.publishItem({ id: `urn:uuid:day-${day}`, content_text: `day ${day}` }, { at: T0 + day * DAY });
    p.advanceManifest({ updated: T0 + day * DAY + 3600 });
  }
  return p;
}

function bundleOf(p, extra = {}) {
  return buildBundle({
    identity: p.identityDocument,
    identityHistory: p.identityVersions,
    feeds: [{ feed: p.feed, manifest: p.manifest, manifestHistory: p.manifestVersions }],
    exportedAt: T0 + 4 * DAY,
    ...extra,
  });
}

const reading = { now: () => T0 + 5 * DAY, maxItemProbes: 4 };

// ---- §14's central claim ----

test('a bundle verifies with no network and no bundle-specific verifier', async () => {
  const bundle = bundleOf(published());
  const result = await verifyBundle(bundle, reading);

  assert.equal(result.identity.identity, HUB);
  assert.equal(result.identity.pin.seq, 1);
  assert.equal(result.manifest.pin.seq, 3, 'the manifest chain walked inside the file');
  assert.equal(result.items.live.length, 3);
  assert.deepEqual(result.findings, []);
});

test('a bundle survives serialization and dies on decomposition', async () => {
  // §14: "Every document MUST appear byte-verbatim as published. A bundle whose contents have
  // been re-serialized is worthless, because the hashes will not chain." The first half is
  // safe and the second is fatal, and the difference is one unknown field.
  const p = published();
  const bundle = bundleOf(p);

  const roundTripped = JSON.parse(canonicalBytes(bundle).toString('utf8'));
  const ok = await verifyBundle(roundTripped, reading);
  assert.equal(ok.items.live.length, 3, 'JSON in and out of JSON is not the hazard');

  // Decomposition is. Rebuilding an item from the columns a schema happens to have drops
  // anything it has never heard of — and `received` items are other people's bytes, carrying
  // extension fields no exporter's schema knows.
  const decomposed = JSON.parse(canonicalBytes(bundle).toString('utf8'));
  decomposed.feeds[0].feed.items = decomposed.feeds[0].feed.items.map((i) => ({
    id: i.id, authors: i.authors, content_text: i.content_text,
    date_published: i.date_published, _openfeed: { feed_url: i._openfeed?.feed_url }, _version: i._openfeed?.version, _sig: i._sig,
  }));
  decomposed.feeds[0].feed.items[0].content_text += '';
  delete decomposed.feeds[0].feed.items[0]._openfeed?.feed_url;   // one field, gone
  const broken = await verifyBundle(decomposed, reading);
  assert.ok(
    broken.findings.some((f) => f.kind === 'withheld' || f.kind === 'unverifiable' || f.kind === 'invariant'),
    JSON.stringify(broken.findings),
  );
});

// ---- §14's requirements, which exist for the hostile case ----

test('a successor\'s bundle without the predecessor\'s chain is refused at assembly', async () => {
  // §14, and the gap `tmp/export-prototype.js` found: a migrated identity's bundle can verify
  // every signature, both chains, and every item, and still not demonstrate the one claim that
  // makes it a *successor's* bundle. The co-signature resolves in the predecessor's chain
  // (§4.5), and a successor listing the same recovery key in its own document proves nothing
  // (§4.2). Those bytes exist under §5.4 and the case where they are hard to get — the host
  // being left is the one holding them — is exactly the case that matters.
  const recovery = makeSigner('recovery-1');
  recovery.jwk.use = 'recovery';
  const old = published('https://old.example/', { recovery });
  const successor = published('https://new.example/', { recovery });
  successor.advanceIdentity({ predecessor: 'https://old.example/' }, { updated: T0 + 5 * DAY });

  assert.throws(
    () => bundleOf(successor),
    (e) => e instanceof ExportError && /predecessor's/.test(e.message),
  );

  const complete = bundleOf(successor, { predecessorHistory: old.identityVersions });
  assert.ok(complete.identity.history.some((v) => v.url === 'https://old.example/'));

  // And the restorer can reach the predecessor's chain, which is what the requirement buys.
  const urls = [...restoreFetcher(complete).urls.keys()];
  assert.ok(urls.some((u) => u.startsWith('https://old.example/')), urls.join(' '));
});

test('the bundle says which of its halves it cannot prove complete', async () => {
  // The honest disclosure §14 gained. `feeds` is checkable against its own manifests, so a short
  // export of published content is detectable. The other three slots are committed by nothing —
  // that is what makes them the slots they are — so a trimmed export of them is indistinguishable
  // from a complete one, and that is exactly where a hostile operator degrades.
  const p = published();
  const gran = makeSigner('gran-1');
  const inbound = {
    id: 'urn:uuid:from-gran',
    authors: [{ url: 'https://gran.example/' }],
    content_text: 'lovely',
    date_published: new Date((T0 + DAY) * 1000).toISOString().replace('.000', ''),
    _openfeed: { version: 1 },
  };
  inbound._sig = sign(inbound, gran.privateKey, 'https://gran.example/#gran-1', { kind: 'item' });

  const full = bundleOf(p, { received: [inbound], delivered: [], unpublished: [{ draft: 'unsent' }] });
  const trimmed = bundleOf(p, { received: [], delivered: [], unpublished: [] });

  assert.equal(completeness(full).provable.published, 3);
  assert.equal(completeness(full).unprovable.received, 1);
  assert.equal(completeness(trimmed).unprovable.received, 0);

  // Both verify identically, which is the uncomfortable part and the reason it is reported.
  const a = await verifyBundle(full, reading);
  const b = await verifyBundle(trimmed, reading);
  assert.deepEqual(a.findings, []);
  assert.deepEqual(b.findings, []);
  assert.equal(a.completeness.provable.published, b.completeness.provable.published);
});

test('received items are carried verbatim, extension fields and all', async () => {
  // §14: "They are other people's signed bytes; the exporter is a custodian, not an author."
  // The exporter has never heard of the fields on somebody else's item, which is why the slot
  // cannot be rebuilt from a schema.
  const gran = makeSigner('gran-1');
  const foreign = {
    id: 'urn:uuid:foreign',
    authors: [{ url: 'https://gran.example/' }],
    content_text: 'hi',
    date_published: new Date(T0 * 1000).toISOString().replace('.000', ''),
    _openfeed: { version: 1 },
    _some_future_field: { nested: [1, 2, 3] },
    _openfeed: { pins: [{ url: `${HUB}openfeed.json`, seq: 1, hash: 'x'.repeat(43), observed: T0 }] },
  };
  foreign._sig = sign(foreign, gran.privateKey, 'https://gran.example/#gran-1', { kind: 'item' });

  const bundle = bundleOf(published(), { received: [foreign] });
  const roundTripped = JSON.parse(canonicalBytes(bundle).toString('utf8'));
  assert.deepEqual(roundTripped.received[0], foreign);
  assert.equal(documentHash(roundTripped.received[0]), documentHash(foreign));
});

// ---- §14's archive container ----

test('the container is self-verifying because the hash naming each file is the signed one', () => {
  const photo = crypto.randomBytes(4096);
  const hash = b64u(sha256(photo));
  const p = published();
  p.publishItem({
    id: 'urn:uuid:with-photo',
    content_text: 'cookies',
    attachments: [{ url: `${HUB}cookies.jpg`, mime_type: 'image/jpeg', _openfeed: { sha256: hash  }}],
  }, { at: T0 + 4 * DAY });
  p.advanceManifest({ updated: T0 + 4 * DAY + 60 });

  const bundle = bundleOf(p, { attachments: [{ url: `${HUB}cookies.jpg`, _openfeed: { sha256: hash  }}] });
  const entries = containerEntries(bundle, new Map([[hash, photo]]));

  assert.ok(entries.has(BUNDLE_ENTRY));
  assert.ok(entries.has(hash), 'the blob is named by the hash inside the signed item');
  assert.deepEqual(entries.get(hash), photo);
  assert.equal(b64u(sha256(entries.get(hash))), hash, 'so nothing beyond the container is needed to check it');

  // A container that lied about its own contents cannot be produced.
  assert.throws(
    () => containerEntries(bundle, new Map([[hash, crypto.randomBytes(64)]])),
    /would lie about itself/,
  );

  // And the URL-only fallback is named as degraded rather than shipped as equivalent: it
  // verifies perfectly and contains nothing, pointing back at the host being left.
  assert.deepEqual(degraded(bundle, new Map([[hash, photo]])), { degraded: false, missing: [] });
  const empty = degraded(bundle, new Map());
  assert.equal(empty.degraded, true);
  assert.deepEqual(empty.missing, [`${HUB}cookies.jpg`]);
});

// ---- exit, end to end ----

test('exit: migrate by recovery co-signature, export, restore, with the host refusing to help', async () => {
  // §13.2: "What the protocol offers this user is exit: §3.4, §4.5, §14, real only if all three
  // hold at once." This is the three of them in one test, with nothing served over a socket and
  // no cooperation from the identity being left.
  const recovery = makeSigner('recovery-1');
  recovery.jwk.use = 'recovery';
  const hub = published('https://mom.hub.example/', { recovery });

  // The member re-establishes somewhere they control, carrying `predecessor` and co-signing with
  // the recovery key the hub never held.
  const away = new Publisher({
    identity: 'https://mom.example/',
    signer: makeSigner('own-1'),
    profile: { name: 'Mom', predecessor: 'https://mom.hub.example/' },
    recoveryKeys: [recovery.jwk],
    now: () => T0 + 10 * DAY,
  });
  // The back catalog moves byte-verbatim; §3.4 forbids re-signing it.
  for (const item of hub.items.values()) away.items.set(item.id, item);
  away.advanceManifest({ updated: T0 + 10 * DAY + 60 });

  // §3.4 path 3: the `kid` names the PREDECESSOR, because that is where the key is committed
  // and where §4.5 resolves it. `_sig` covers `_recovery_sig` (§6.3), so the publisher co-signs
  // and re-signs in one step rather than the field being appended to a finished document.
  away.coSignIdentity(recovery, { kidIdentity: 'https://mom.hub.example/' });

  // The bundle the member carries. It must include the predecessor's chain, which is where the
  // co-signature resolves — and the hub is the one holding those bytes.
  const bundle = buildBundle({
    identity: away.identityDocument,
    identityHistory: away.identityVersions,
    predecessorHistory: hub.identityVersions,
    feeds: [{ feed: away.feed, manifest: away.manifest, manifestHistory: away.manifestVersions }],
    exportedAt: T0 + 11 * DAY,
  });

  // Cold restore, no prior pin of the hub: everything reads, the back catalog is credited,
  // and the migration verdict is exactly as strong as §3.4 allows it to be — unverified,
  // because the only history anchoring it came from inside the file being judged.
  const restored = await verifyBundle(bundle, { now: () => T0 + 12 * DAY, maxItemProbes: 4 });
  assert.equal(restored.identity.identity, 'https://mom.example/');
  assert.equal(restored.items.live.length, 3, 'the back catalog arrived byte-verbatim');
  assert.deepEqual(
    restored.items.live.map((s) => s.id).sort(),
    ['urn:uuid:day-0', 'urn:uuid:day-1', 'urn:uuid:day-2'],
  );
  assert.equal(restored.predecessorTofu, true);
  assert.notEqual(restored.migration?.verified, true, 'no outside pin, no verified migration');

  // A consumer who had pinned the hub before the exit — Gran, or the member's own second
  // device — brings the outside anchor, and the same bundle demonstrates the migration.
  const pins = new PinStore({ now: () => T0 + 9 * DAY });
  pins.advance(`${HUB}openfeed.json`, hub.identityDocument.seq, documentHash(hub.identityDocument));
  const witnessed = await verifyBundle(bundle, { now: () => T0 + 12 * DAY, maxItemProbes: 4, pins });
  assert.equal(witnessed.predecessorTofu, false);
  assert.equal(witnessed.migration?.verified, true);
  assert.equal(witnessed.migration?.via, 'recovery');

  // The carried items still name the *old* feed in their signed bytes, which is §3.4's whole
  // point: nothing was re-signed, so every hash any consumer or peer pinned survives.
  const carried = [...away.items.values()][0];
  assert.equal(carried._openfeed?.feed_url, 'https://mom.hub.example/feed.json');
  assert.equal(documentHash(carried), documentHash([...hub.items.values()][0]));
});

test('a bundle cannot vouch for its own predecessor (§3.4)', async () => {
  // The attack the previous test's cold path is guarding: fabricate a predecessor history at
  // the victim's URL around YOUR recovery key, name it in `predecessor`, co-sign, and carry a
  // "back catalog". Every byte is self-consistent, because every byte is yours. A verifier
  // that walked that history and treated the result as a pin would then resolve the
  // co-signature against the key the same file supplied — `verified: true, via: 'recovery'`
  // for an identity the attacker never was, on the bundle's own say-so.
  const evesRecovery = makeSigner('eve-recovery-1');
  evesRecovery.jwk.use = 'recovery';
  const fabricated = published(HUB, { signer: makeSigner('eve-hub-1'), recovery: evesRecovery });
  const eve = new Publisher({
    identity: 'https://eve.example/',
    signer: makeSigner('eve-1'),
    profile: { name: 'Mom', predecessor: HUB },
    recoveryKeys: [evesRecovery.jwk],
    now: () => T0 + 10 * DAY,
  });
  for (const item of fabricated.items.values()) eve.items.set(item.id, item);
  eve.advanceManifest({ updated: T0 + 10 * DAY + 60 });
  eve.coSignIdentity(evesRecovery, { kidIdentity: HUB });

  const bundle = buildBundle({
    identity: eve.identityDocument,
    identityHistory: eve.identityVersions,
    predecessorHistory: fabricated.identityVersions,
    feeds: [{ feed: eve.feed, manifest: eve.manifest, manifestHistory: eve.manifestVersions }],
    exportedAt: T0 + 11 * DAY,
  });

  // Cold: the claim is labeled as what it is — the bundle's own word.
  const cold = await verifyBundle(bundle, { now: () => T0 + 12 * DAY });
  assert.equal(cold.predecessorTofu, true);
  assert.notEqual(cold.migration?.verified, true);
  assert.match(cold.migration?.reason ?? '', /inside the bundle/);

  // Warm: a consumer who really followed Mom's hub holds a pin the fabricated history cannot
  // reproduce, so the walk fails against it and the migration stays unverified.
  const realHub = published(HUB, { signer: makeSigner('key-1') });
  const pins = new PinStore({ now: () => T0 + 5 * DAY });
  pins.advance(`${HUB}openfeed.json`, realHub.identityDocument.seq, documentHash(realHub.identityDocument));
  const warm = await verifyBundle(bundle, { now: () => T0 + 12 * DAY, pins });
  assert.notEqual(warm.migration?.verified, true, 'a real pin exposes the fabrication');
});
