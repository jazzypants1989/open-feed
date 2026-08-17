// Migration (§3.4) through the composed reader, over sockets.
//
// `tmp/migration-prototype.js` established that the mechanisms compose into an exit and found
// what the text was missing; the text has since been fixed. This is the other half — whether
// the *shipped verifier* acts on any of it — and the answer before `src/migration.js` was no.
// A reader that knows nothing about migration does not merely miss a feature: it reads a
// migrated back catalog as a pile of copies, excludes it from the manifest reconciliation, and
// reports every item as **withheld**. That is an accusation of hiding aimed at the one act the
// protocol exists to make possible, and the regression test at the bottom holds it in place.
//
// Two sites, two origins. The port is part of the origin and therefore part of the identity
// URL, so a second `newSite` is a genuinely different identity to every rule in the protocol.

import test from 'node:test';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

import { DAY, T0, newSite, consumer, makeSigner } from './helpers/site.js';

import {
  Publisher,
  createReader,
  ObservationStore,
  MigrationStore,
  CompetingMigrations,
  verifyMigration,
  sign,
  signingPayload,
  signingInput,
  buildHeader,
  documentHash,
} from '../src/index.js';

const CATALOG = ['urn:uuid:0001-cookies', 'urn:uuid:0002-garden', 'urn:uuid:0003-birthday'];

/** An identity with a back catalog worth carrying and an offline recovery key. */
function established(origin, signer, recovery, { start = T0 } = {}) {
  const p = new Publisher({
    identity: origin,
    title: "Mom's Journal",
    signer,
    profile: { name: 'Mom' },
    recoveryKeys: [recovery.jwk],
    now: () => start,
  });
  CATALOG.forEach((id, i) => {
    p.publishItem({ id, content_text: `entry ${id}` }, { at: start + i * DAY });
    p.advanceManifest({ updated: start + i * DAY + 60 });
  });
  return p;
}

/**
 * The successor: same recovery key, a **fresh** signing key — the old host held the previous
 * one, and stopping it signing is most of the point — and the back catalog carried across
 * byte-verbatim. Not a loop over `publishItem`: that would re-sign, bump `_version`, and
 * rewrite `_feed_url`, invalidating every hash any consumer ever pinned (§3.4).
 */
function successorOf(predecessorOrigin, origin, signer, recovery, catalog, { start }) {
  const p = new Publisher({
    identity: origin,
    title: "Mom's Journal",
    signer,
    profile: { name: 'Mom', predecessor: predecessorOrigin },
    recoveryKeys: [recovery.jwk],
    now: () => start,
  });
  for (const [id, item] of catalog) p.items.set(id, item);
  p.advanceManifest({ updated: start + 60 });
  return p;
}

/**
 * §3.4 path 3: co-sign the successor's genesis with the recovery key, whose `kid` names the
 * **predecessor** — that is where the key is committed and where §4.5 resolves it. A `kid`
 * naming the successor would send a verifier to resolve the key in the very document making
 * the claim, which is the self-blessing §4.2 rules out.
 *
 * `_sig` covers `_recovery_sig` (§6.3): the co-signature's payload strips both signature fields
 * while `_sig` strips only its own, so the co-signature has to go on first and the document is
 * re-signed over it. That is what stops a serving-path attacker with no key from deleting the
 * co-signature and denying the exit in silence, and `coSignIdentity` is the publisher doing it.
 */
function coSign(publisher, recovery, predecessorOrigin) {
  return publisher.coSignIdentity(recovery, { kidIdentity: predecessorOrigin });
}

function reader(me, { migrations, now = () => T0 + 30 * DAY, ...rest } = {}) {
  return createReader({
    fetcher: me.fetcher,
    pins: me.pins,
    observations: new ObservationStore({ now }),
    migrations,
    now,
    ...rest,
  });
}

// ---- the cooperative path ----

test('a cooperative migration verifies, and the back catalog stays canonical', async (t) => {
  const oldSite = await newSite(t);
  const newSite_ = await newSite(t);
  const recovery = makeSigner('recovery-1', { use: 'recovery' });

  const hub = established(oldSite.url, makeSigner('hub-1'), recovery);
  oldSite.serve(hub);

  // Gran has read Mom for a month and holds pins of both chains. Every §13.2 guarantee is a
  // statement about what a *pinned* consumer detects, so the pin has to predate the move.
  const gran = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + 30 * DAY });
  const before = await reader(gran, { migrations }).read(oldSite.url);
  assert.equal(before.items.live.length, 3);
  const heldHashes = new Map(before.items.live.map((s) => [s.id, s.hash]));

  // Mom moves. The old side cooperates with one more chain version naming where she went.
  const own = successorOf(oldSite.url, newSite_.url, makeSigner('own-1'), recovery, hub.items, {
    start: T0 + 10 * DAY,
  });
  newSite_.serve(own);
  hub.advanceIdentity({ successor: newSite_.url }, { updated: T0 + 11 * DAY });
  oldSite.serve(hub);

  const after = await reader(gran, { migrations }).read(newSite_.url);

  assert.equal(after.migration.verified, true);
  assert.equal(after.migration.via, 'cooperative');
  assert.equal(migrations.resolve(oldSite.url), newSite_.url, 'predecessor equivalence, §3.4');

  // The whole point of the byte-verbatim rule: every hash Gran accumulated survives the move.
  assert.equal(after.items.live.length, 3, 'the back catalog is canonical at the new feed');
  assert.equal(after.items.withheld.length, 0, 'and is not reported as withheld');
  assert.equal(after.items.copies.length, 0, 'nor demoted to copies');
  for (const state of after.items.live) {
    assert.equal(state.hash, heldHashes.get(state.id), `${state.id} kept the hash Gran pinned`);
  }

  // Each carried item still names the OLD feed inside its signed bytes. Nothing re-signed them,
  // so §7.5's id/feed binding is never breached and needs no exception (§3.4).
  const carried = after.feed.canonical.filter((c) => c.via === 'predecessor');
  assert.equal(carried.length, 3);
  for (const c of carried) assert.equal(c.item._feed_url, `${oldSite.url}feed.json`);
});

test('a verified migration retires the predecessor chain', async (t) => {
  const oldSite = await newSite(t);
  const newSite_ = await newSite(t);
  const recovery = makeSigner('recovery-1', { use: 'recovery' });
  const hub = established(oldSite.url, makeSigner('hub-1'), recovery);
  oldSite.serve(hub);

  const gran = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + 30 * DAY });
  await reader(gran, { migrations }).read(oldSite.url);

  const own = successorOf(oldSite.url, newSite_.url, makeSigner('own-1'), recovery, hub.items, {
    start: T0 + 10 * DAY,
  });
  newSite_.serve(own);
  hub.advanceIdentity({ successor: newSite_.url }, { updated: T0 + 11 * DAY });
  oldSite.serve(hub);
  await reader(gran, { migrations }).read(newSite_.url);

  // The abandoned host now tombstones the whole back catalog it no longer owns. §9.3 invariant
  // 1 is satisfied — the ids are in `deleted` under signed tombstones — and §5.3.1 sees no
  // equivocation, one branch, one hash per seq. Nothing is forged. The only thing that stops a
  // pinned consumer inheriting it is that the chain is retired.
  for (const id of CATALOG) hub.tombstone(id, { at: T0 + 12 * DAY });
  hub.advanceManifest({ updated: T0 + 12 * DAY + 60 });
  oldSite.serve(hub);

  // The chain itself refuses to advance...
  await assert.rejects(
    () => reader(gran, { migrations }).readIdentity(oldSite.url),
    (e) => e.code === 'retired' && /retired and no longer advances/.test(e.message),
  );

  // ...and a caller who asks for the old URL is taken to the successor instead of being handed
  // an error, which is what §3.4's "consumers follow `successor`" actually asks for. The
  // tombstones the abandoned host published are never seen, let alone honored.
  const now = await reader(gran, { migrations }).read(oldSite.url);
  assert.deepEqual(now.followed, [oldSite.url]);
  assert.equal(now.items.live.length, 3, 'the back catalog is live at its new home');
  assert.equal(now.items.deleted.length, 0, "the old host's tombstones carry no authority");

  // And the pin is kept as history rather than discarded: it is what a peer's older pin is
  // checked against (§5.3.1, §16.1) and what a recovery co-signature resolves in (§4.5).
  assert.ok(gran.pins.pin(`${oldSite.url}openfeed.json`), 'the pin survives its chain retiring');
});

// ---- the path that has to work against a host that will not help ----

test('a recovery migration verifies with no cooperation from the old host', async (t) => {
  const oldSite = await newSite(t);
  const newSite_ = await newSite(t);
  const recovery = makeSigner('recovery-1', { use: 'recovery' });
  const hub = established(oldSite.url, makeSigner('hub-1'), recovery);
  oldSite.serve(hub);

  const gran = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + 30 * DAY });
  await reader(gran, { migrations }).read(oldSite.url);

  const own = successorOf(oldSite.url, newSite_.url, makeSigner('own-1'), recovery, hub.items, {
    start: T0 + 10 * DAY,
  });
  coSign(own, recovery, oldSite.url);
  newSite_.serve(own);

  // The hub publishes nothing. It is still up, still serving its unchanged chain, and simply
  // declines to acknowledge the move — which §4.5 is explicit is not grounds for rejection,
  // because treating "still reachable" that way hands a hostile custodian a veto over their
  // user's exit by doing nothing at all.
  const after = await reader(gran, { migrations }).read(newSite_.url);
  assert.equal(after.migration.verified, true);
  assert.equal(after.migration.via, 'recovery');
  assert.equal(after.migration.signer, 'recovery-1');
  assert.equal(after.items.live.length, 3);
  assert.equal(after.items.withheld.length, 0);
});

test('a consumer with no prior pin sees a recovery migration as unverified, not as a fork', async (t) => {
  const oldSite = await newSite(t);
  const newSite_ = await newSite(t);
  const recovery = makeSigner('recovery-1', { use: 'recovery' });
  const hub = established(oldSite.url, makeSigner('hub-1'), recovery);
  oldSite.serve(hub);
  const own = successorOf(oldSite.url, newSite_.url, makeSigner('own-1'), recovery, hub.items, {
    start: T0 + 10 * DAY,
  });
  coSign(own, recovery, oldSite.url);
  newSite_.serve(own);

  // A stranger arriving after the move has nothing to resolve the co-signature against — the
  // key is committed in the predecessor's chain, and a successor listing the same key in its
  // own document proves nothing (§4.2). §3.4: they can only treat it as unverified.
  const stranger = consumer(t);
  const result = await reader(stranger, { migrations: new MigrationStore() }).read(newSite_.url);
  assert.equal(result.migration.verified, false);
  assert.match(result.migration.reason, /no verified version of the predecessor chain/);
  assert.ok(result.findings.some((f) => f.kind === 'migration'));

  // The back catalog is correctly read as copies, which is the safe reading: verifiable as
  // *authored*, carrying no liveness. Reported as not-yet-canonical rather than as an attack.
  assert.equal(result.items.live.length, 0);
  assert.equal(result.items.copies.length, 3);
});

// ---- the thing a stolen recovery key can actually do ----

test('two migrations claiming one predecessor are unresolvable, and neither is followed', async (t) => {
  const oldSite = await newSite(t);
  const honestSite = await newSite(t);
  const thiefSite = await newSite(t);
  const recovery = makeSigner('recovery-1', { use: 'recovery' });
  const hub = established(oldSite.url, makeSigner('hub-1'), recovery);
  oldSite.serve(hub);

  const gran = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + 30 * DAY });
  await reader(gran, { migrations }).read(oldSite.url);

  // A recovery key cannot sign a chain version (§5.2 step 3), so a thief cannot take the
  // identity in place. What they can do is mint a *competing* successor at a URL they control,
  // co-signed by the same committed key — and both claims then verify identically.
  for (const [site, kid] of [[honestSite, 'own-1'], [thiefSite, 'eve-1']]) {
    const p = successorOf(oldSite.url, site.url, makeSigner(kid), recovery, hub.items, {
      start: T0 + 10 * DAY,
    });
    coSign(p, recovery, oldSite.url);
    site.serve(p);
  }

  const first = await reader(gran, { migrations }).read(honestSite.url);
  assert.equal(first.migration.verified, true);

  const second = await reader(gran, { migrations }).read(thiefSite.url);
  assert.equal(second.migration.verified, false);
  assert.equal(second.migration.direction, 'contested');
  assert.match(second.migration.reason, /unresolvable without out-of-band confirmation/);

  // Both claims are void, not "first one wins". Keeping the earlier would resolve the contest
  // by arrival order — which is to say, in the thief's favour as often as not.
  assert.equal(migrations.successorOf(oldSite.url), null);
  assert.ok(migrations.isContested(oldSite.url));

  // And it stays void until a human says otherwise. §3.4 requires "out-of-band confirmation"
  // and nothing in the protocol can supply it, so the store needs a way to take one — otherwise
  // the correct verdict is also a permanent dead end. Named for the decision, like `rePin`.
  assert.throws(() => migrations.settle(oldSite.url, 'https://nobody.example/'), /not one of the competing claims/);
  const settled = migrations.settle(oldSite.url, honestSite.url);
  assert.equal(settled.successor, migrations.successorOf(oldSite.url));
  assert.equal(migrations.isContested(oldSite.url), false);

  // The reader now follows the settled claim, and the thief's is simply another identity.
  const followed = await reader(gran, { migrations }).read(oldSite.url);
  assert.equal(followed.identity.identity, honestSite.url);
});

test('the retained predecessor state is a recovery pin, not the document', async (t) => {
  // §4.5 asks for `(url, seq, hash)` plus the keys and feed URLs, and that is all anything
  // consumes: the recovery keys for the co-signature, the *signing* keys because a migrated
  // back catalog is signed by the predecessor and §3.4 forbids re-signing it, and the feed URLs
  // for §7.5's exception. Keeping the whole document instead is up to §13.4's 100 KB held
  // forever per identity, for a question a few hundred bytes answers.
  const store = new MigrationStore({ now: () => T0 });
  const document = {
    url: 'https://old.example/',
    seq: 4,
    updated: T0,
    name: 'Mom',
    bio: 'x'.repeat(4096),
    avatar: 'https://old.example/avatar.jpg',
    _accounts: ['https://mastodon.social/@mom'],
    feeds: [{ url: 'https://old.example/feed.json', manifest: 'https://old.example/manifest.json' }],
    keys: [{ crv: 'Ed25519', kid: 'key-1', kty: 'OKP', x: 'a'.repeat(43) }],
    _sig: 'zzz',
  };

  store.noteIdentity(document);
  const held = store.pinnedAncestorFor('https://old.example/');

  assert.deepEqual(Object.keys(held).sort(), ['hash', 'keys', 'seq', 'url']);
  assert.equal(held.hash, documentHash(document), 'the pin half is still a real §5.1 hash');
  assert.deepEqual(held.keys, document.keys, 'and every key it committed survives');
  assert.ok(JSON.stringify(held).length * 4 < JSON.stringify(document).length);

  // The feed URLs live beside it, because they accumulate across versions.
  assert.ok(store.predecessorFeedUrls('https://old.example/') !== undefined);
});

// ---- the claim shapes that are not migrations ----

test('a one-sided claim is not a migration', () => {
  const A = 'https://a.example/';
  const B = 'https://b.example/';
  const predecessor = { url: A, seq: 1, updated: T0, keys: [] };
  const successor = { url: B, seq: 1, updated: T0, keys: [], predecessor: A };

  // §3.4: "A `successor` claim without a matching `predecessor` (or vice versa), unaccompanied
  // by a valid recovery co-signature, MUST NOT be treated as migration."
  assert.equal(verifyMigration({ predecessorDocument: predecessor, successorDocument: successor }).verified, false);
  assert.equal(verifyMigration({ successorDocument: { ...successor, predecessor: undefined } }).verified, false);
  assert.equal(verifyMigration({ successorDocument: { ...successor, url: A } }).verified, false);

  // Both links, agreeing.
  assert.equal(
    verifyMigration({
      predecessorDocument: { ...predecessor, successor: B },
      successorDocument: successor,
    }).via,
    'cooperative',
  );

  // The old side advancing a *different* successor is §4.5's conflicting chain, named as such
  // rather than folded into "no valid co-signature".
  const conflicted = verifyMigration({
    predecessorDocument: { ...predecessor, successor: 'https://c.example/' },
    successorDocument: successor,
  });
  assert.equal(conflicted.verified, false);
  assert.equal(conflicted.conflicting, 'https://c.example/');
});

// ---- the regression this whole module exists for ----

test('without the migration record, a carried back catalog reads as withheld', async (t) => {
  const oldSite = await newSite(t);
  const newSite_ = await newSite(t);
  const recovery = makeSigner('recovery-1', { use: 'recovery' });
  const hub = established(oldSite.url, makeSigner('hub-1'), recovery);
  oldSite.serve(hub);
  const own = successorOf(oldSite.url, newSite_.url, makeSigner('own-1'), recovery, hub.items, {
    start: T0 + 10 * DAY,
  });
  newSite_.serve(own);
  hub.advanceIdentity({ successor: newSite_.url }, { updated: T0 + 11 * DAY });
  oldSite.serve(hub);

  // A consumer that never read the predecessor holds no record of its feeds, so §7.5's
  // exception cannot fire: the items are copies, and the manifest commits ids no *canonical*
  // item answers to. What that reads as is `absent` — §9.3 scopes withholding to bytes the
  // consumer actually tried for and was refused, and these bytes were served, just as copies —
  // so the stranger sees a back catalog it cannot credit rather than one it accuses the host
  // of hiding. The migration record is still the only thing that turns those copies into the
  // live back catalog, which is why it is kept before the move rather than loosened at read
  // time.
  const stranger = consumer(t);
  const result = await reader(stranger, { migrations: new MigrationStore() }).read(newSite_.url);
  assert.equal(result.items.copies.length, 3);
  assert.equal(result.items.withheld.length, 0, 'served-as-copies is not withholding');
  assert.equal(result.items.absent.length, 3, 'and uncredited is not live either');
  assert.equal(result.items.live.length, 0);

  // And with the record — one prior read of the predecessor — the same bytes read correctly.
  // Reading the OLD url now follows the move rather than reading a feed that is no longer this
  // identity's publication state (§3.4), so one call does both.
  const gran = consumer(t);
  const migrations = new MigrationStore({ now: () => T0 + 30 * DAY });
  const fixed = await reader(gran, { migrations }).read(oldSite.url);
  assert.deepEqual(fixed.followed, [oldSite.url], 'the read re-targeted to the successor');
  assert.equal(fixed.identity.identity, newSite_.url);
  assert.equal(fixed.items.withheld.length, 0);
  assert.equal(fixed.items.live.length, 3);
});
