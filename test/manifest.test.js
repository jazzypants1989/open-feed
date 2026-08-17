// §9.3's five invariants, and the three states §13.13 says never to collapse.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertManifestShape,
  assertManifestBinding,
  assertInvariantsAcrossHop,
  assertHistoryInvariants,
  reconcileFeed,
  assertRelocationCarriesForward,
  ManifestError,
  InvariantViolation,
  LAG_CEILING_SECONDS,
  freshness,
  documentHash,
  sign,
} from '../src/index.js';

import { makeKey } from './helpers/chain-fixture.js';

const IDENTITY = 'https://owner.example/';
const FEED = 'https://owner.example/feed.json';
const MANIFEST = 'https://owner.example/manifest.json';
const DAY = 86400;
const T0 = 1736899200;

const owner = makeKey('key-1');

/** A signed item, so invariant 4's hash is over bytes something actually produced. */
function item({ id, version = 1, at = T0, text = 'hello', deleted = false } = {}) {
  const doc = deleted
    ? {
      id,
      authors: [{ url: IDENTITY }],
      date_published: new Date(at * 1000).toISOString().replace('.000', ''),
      date_modified: new Date(at * 1000).toISOString().replace('.000', ''),
      _version: version,
      _deleted: true,
      _feed_url: FEED,
      content_text: '',
    }
    : {
      id,
      authors: [{ url: IDENTITY }],
      _feed_url: FEED,
      _version: version,
      content_text: text,
      date_published: new Date(at * 1000).toISOString().replace('.000', ''),
      ...(version > 1 ? { date_modified: new Date(at * 1000).toISOString().replace('.000', '') } : {}),
    };
  doc._sig = sign(doc, owner.privateKey, `${IDENTITY}#key-1`);
  return doc;
}

const commit = (i) => [i._version, documentHash(i)];

function manifest({ seq = 1, updated = T0, items = [], deleted = [], ...rest } = {}) {
  const doc = {
    url: IDENTITY,
    feed_url: FEED,
    seq,
    updated,
    items: Object.fromEntries(items.map((i) => [i.id, commit(i)])),
    ...rest,
  };
  if (deleted.length) doc.deleted = Object.fromEntries(deleted.map((i) => [i.id, commit(i)]));
  return doc;
}

// ---- §9.3 invariant 3: the lag ceiling ----

test('the consumer ceiling bounds the pending state, first contact included', () => {
  // §9.3 invariant 3: the ceiling is the consumer's own and needs no observed history, so an
  // uncommitted item is pending inside it and a violation beyond it — from the first fetch.
  const m = manifest({ seq: 3, updated: T0 });
  const fresh = item({ id: 'a', at: T0 + 60 });

  const inside = reconcileFeed(m, [fresh], { now: T0 + 60 + LAG_CEILING_SECONDS - 1 });
  assert.equal(inside.violations.length, 0);
  assert.equal(inside.states[0].state, 'pending');

  const beyond = reconcileFeed(m, [fresh], { now: T0 + 60 + LAG_CEILING_SECONDS + 1 });
  assert.equal(beyond.violations.length, 1);
  assert.equal(beyond.violations[0].invariant, 3);
  assert.match(beyond.violations[0].message, /ceiling/);

  // The ceiling is the consumer's, so a stricter one is honored as given.
  const strict = reconcileFeed(m, [fresh], { now: T0 + 60 + 7200, ceiling: 3600 });
  assert.equal(strict.violations.length, 1);
});

test('an advance that demonstrably happened converts lag into a violation, before any ceiling', () => {
  // §9.3: a manifest whose `updated` is later than the item's signing time has demonstrably
  // advanced past it. The manifest's own `updated` is the evidence, so this needs no cadence.
  const passedOver = item({ id: 'a', at: T0 });
  const advanced = manifest({ seq: 4, updated: T0 + 60 });
  const { violations } = reconcileFeed(advanced, [passedOver], { now: T0 + 120 });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, 3);
  assert.match(violations[0].message, /advanced at/);

  // The same item against a manifest that has not advanced since is ordinary lag.
  const notYet = manifest({ seq: 4, updated: T0 - 60 });
  assert.equal(reconcileFeed(notYet, [passedOver], { now: T0 + 120 }).violations.length, 0);
});

test('a future-dated item is a violation, not a permanently pending one (§9.3 invariant 3)', () => {
  // Both of invariant 3's other tests invert under a future-dated item, so a publisher stamping
  // next year escapes both at once: the manifest's `updated` cannot have advanced past a moment
  // that has not arrived, and the age against the ceiling is negative. What it buys is precisely
  // the standing window the ceiling exists to close — serve this item to one reader and not
  // another, indefinitely, with nothing forged and no verdict produced anywhere.
  const m = manifest({ seq: 3, updated: T0 });
  const nextYear = item({ id: 'a', at: T0 + 365 * DAY });

  // The control: the two older tests, run against this item, both say "lag".
  assert.equal(m.updated > T0 + 365 * DAY, false, 'the manifest cannot have advanced past it');
  assert.ok(T0 + 120 - (T0 + 365 * DAY) < LAG_CEILING_SECONDS, 'and its age is negative, not stale');

  const { violations, states } = reconcileFeed(m, [nextYear], { now: T0 + 120 });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, 3);
  assert.match(violations[0].message, /ahead of this consumer's clock/);
  assert.equal(states.length, 1);
  assert.notEqual(states[0].state, 'pending');

  // The allowance is real, and it is the consumer's own like the ceiling: an item a few minutes
  // ahead is ordinary clock skew between two honest machines, not an attack.
  const skewed = item({ id: 'b', at: T0 + 600 });
  assert.equal(reconcileFeed(m, [skewed], { now: T0 + 120 }).violations.length, 0);
  assert.equal(reconcileFeed(m, [skewed], { now: T0 + 120, futureSkew: 60 }).violations.length, 1);
});

// ---- §9.3 invariants 1 and 2 ----

test('content cannot silently vanish: removal requires a signed tombstone', () => {
  const a = item({ id: 'a' });
  const b = item({ id: 'b' });
  const earlier = manifest({ seq: 1, items: [a, b] });

  // Dropped outright.
  assert.throws(
    () => assertInvariantsAcrossHop(earlier, manifest({ seq: 2, updated: T0 + DAY, items: [a] })),
    (e) => e instanceof InvariantViolation && e.invariant === 1 && e.id === 'b',
  );
  // Tombstoned: fine, and that is the whole point of the escape.
  const bGone = item({ id: 'b', version: 2, at: T0 + DAY, deleted: true });
  assert.ok(assertInvariantsAcrossHop(earlier, manifest({ seq: 2, updated: T0 + DAY, items: [a], deleted: [bGone] })));
});

test('versions never decrease, and one revision has one hash', () => {
  const a1 = item({ id: 'a', version: 1 });
  const a2 = item({ id: 'a', version: 2, at: T0 + DAY });
  const earlier = manifest({ seq: 5, items: [a2] });

  assert.throws(
    () => assertInvariantsAcrossHop(earlier, manifest({ seq: 6, updated: T0 + DAY, items: [a1] })),
    (e) => e instanceof InvariantViolation && e.invariant === 2,
  );
  assert.throws(
    () => assertInvariantsAcrossHop(manifest({ seq: 5, items: [a1] }), manifest({ seq: 4, updated: T0 + DAY, items: [a1] })),
    (e) => e instanceof InvariantViolation && e.invariant === 2 && /does not advance/.test(e.message),
  );

  // The key-custodian attack §9 spends a paragraph on: same id, same version, different bytes.
  // A version-only manifest would show two readers identical files and no fork.
  const forked = manifest({ seq: 6, updated: T0 + DAY, items: [item({ id: 'a', version: 2, at: T0 + DAY, text: 'something else' })] });
  assert.throws(
    () => assertInvariantsAcrossHop(earlier, forked),
    (e) => e instanceof InvariantViolation && e.invariant === 4,
  );
});

test('a tombstone cannot be undone by resurrecting the id at the same version', () => {
  const gone = item({ id: 'a', version: 2, at: T0 + DAY, deleted: true });
  const earlier = manifest({ seq: 5, items: [], deleted: [gone] });
  assert.throws(
    () => assertInvariantsAcrossHop(earlier, manifest({ seq: 6, updated: T0 + DAY, items: [item({ id: 'a', version: 2, at: T0 + DAY })] })),
    (e) => e instanceof InvariantViolation && /live again/.test(e.message),
  );
  // A genuine later revision is not a resurrection: §7.3's higher `_version` wins.
  assert.ok(assertInvariantsAcrossHop(
    earlier,
    manifest({ seq: 6, updated: T0 + DAY, items: [item({ id: 'a', version: 3, at: T0 + 2 * DAY })] }),
  ));
});

test('a skipping walk checks the endpoints and says so', () => {
  // §9.1.1: skipping observes fewer versions. An id added and removed inside a gap is invisible
  // to this consumer, which is what makes it a weaker witness — stated, not quietly not checked.
  const a = item({ id: 'a' });
  const history = [manifest({ seq: 1, items: [a] }), manifest({ seq: 12, updated: T0 + DAY, items: [a] })];

  const skipped = assertHistoryInvariants(history, { url: MANIFEST, contiguous: false });
  assert.equal(skipped.checked, 'endpoints');
  assert.equal(skipped.skippedGaps, true);

  const walked = assertHistoryInvariants(
    [manifest({ seq: 1, items: [a] }), manifest({ seq: 2, updated: T0 + DAY, items: [a] })],
    { url: MANIFEST },
  );
  assert.equal(walked.checked, 'every-hop');
  assert.equal(walked.hops, 1);
});

// ---- the three states ----

test('lag, withholding, and violation are three states, not three names for one', () => {
  // §13.13: do not collapse them. The second and third are attacks and the first is not.
  const live = item({ id: 'live' });
  const withheld = item({ id: 'withheld' });
  const stale = item({ id: 'stale', version: 2, at: T0 + DAY });
  const m = manifest({ seq: 12, updated: T0 + DAY, items: [live, withheld, stale] });

  const served = [
    live,                                            // agrees, hash included
    item({ id: 'stale', version: 1 }),               // feed behind the manifest: violation
    item({ id: 'ahead', at: T0 + DAY + 60 }),        // feed ahead, no advance since: lag
    // 'withheld' is committed, not yielded, and — the part that makes it *withheld* rather
    // than merely absent — was requested at its §7.6 URL and refused (`unobtainable`).
  ];
  const tried = { now: T0 + DAY + 120, ceiling: 2 * DAY, unobtainable: new Set(['withheld']) };
  const { byId, violations } = reconcileFeed(m, served, tried);

  assert.equal(byId.get('live').state, 'live');
  assert.equal(byId.get('withheld').state, 'withheld');
  assert.equal(byId.get('ahead').state, 'pending');
  assert.equal(byId.get('stale').state, 'violation');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, 3);

  // Without the probe the same absence is `absent`, whatever `partial` says: §9.3 scopes
  // withholding to bytes the consumer actually tried to obtain, and a feed read alone never
  // establishes that — a page with no next_url may be a complete catalog or a recency window,
  // and the two are indistinguishable from the bytes.
  const untried = reconcileFeed(m, served, { now: T0 + DAY + 120, ceiling: 2 * DAY });
  assert.equal(untried.byId.get('withheld').state, 'absent');

  // Withholding is not an invariant violation. Nothing is forged: the consumer knows an exact
  // revision exists, knows its hash, and cannot obtain the bytes.
  assert.equal(violations.filter((v) => v.id === 'withheld').length, 0);
});

test('invariant 4 is checked over the bytes, so a re-serialized copy does not reconcile', () => {
  const a = item({ id: 'a' });
  const m = manifest({ seq: 2, updated: T0 + DAY, items: [a] });

  assert.equal(reconcileFeed(m, [a], { now: T0 + DAY }).byId.get('a').state, 'live');

  // Same id, same version, one character different — the revision the manifest names is not
  // the revision being served.
  const tampered = { ...a, content_text: 'hello!' };
  const { violations } = reconcileFeed(m, [tampered], { now: T0 + DAY });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].invariant, 4);
});

test('a tombstone served as live content is a violation, and one aged out of the feed is not', () => {
  const gone = item({ id: 'a', version: 2, at: T0 + DAY, deleted: true });
  const m = manifest({ seq: 3, updated: T0 + DAY, items: [], deleted: [gone] });

  assert.equal(reconcileFeed(m, [gone], { now: T0 + DAY }).byId.get('a').state, 'deleted');

  // §7.3: tombstones SHOULD stay in the feed for ≥30 days, then age out. The manifest is where
  // deletion is permanent, so an absent tombstone is not withholding.
  const aged = reconcileFeed(m, [], { now: T0 + 60 * DAY });
  assert.equal(aged.byId.get('a').state, 'deleted');
  assert.equal(aged.violations.length, 0);

  // Resurrection at the committed version, though, is the manifest being contradicted.
  const resurrected = { ...gone };
  delete resurrected._deleted;
  resurrected._sig = gone._sig; // bytes differ, so this trips invariant 4 first — as it should
  assert.equal(reconcileFeed(m, [resurrected], { now: T0 + DAY }).violations[0].invariant, 4);
});

// ---- §9.3 invariant 5 ----

test('relocation does not reset the chain', () => {
  const a = item({ id: 'a' });
  const b = item({ id: 'b' });
  const lastObserved = manifest({ seq: 40, items: [a, b] });

  // A new manifest URL is a new chain and a fresh TOFU (§5.3.1 is keyed on the URL), which
  // without this rule would let a publisher discard content by renaming a file.
  assert.throws(
    () => assertRelocationCarriesForward(lastObserved, manifest({ seq: 1, items: [a] }), { fromUrl: MANIFEST, toUrl: 'https://owner.example/m2.json' }),
    (e) => e instanceof InvariantViolation && e.invariant === 5 && e.id === 'b',
  );

  // Honest deletion is unaffected: it goes in `deleted`.
  const bGone = item({ id: 'b', version: 2, at: T0 + DAY, deleted: true });
  assert.equal(assertRelocationCarriesForward(lastObserved, manifest({ seq: 1, items: [a], deleted: [bGone] })).carried, 2);

  // A consumer holding no prior pin has nothing to carry across.
  const first = assertRelocationCarriesForward(null, manifest({ seq: 1, items: [] }));
  assert.equal(first.firstContact, true);
});

// ---- shape and binding ----

test('a malformed manifest is refused before any invariant is evaluated', () => {
  // An invariant compared against a malformed map reports the wrong thing: a missing `items`
  // would look like every item being withheld.
  const bad = [
    [{}, /no usable url/],
    [{ url: IDENTITY }, /no usable feed_url/],
    [{ url: IDENTITY, feed_url: FEED }, /no usable seq/],
    [{ url: IDENTITY, feed_url: FEED, seq: 1 }, /no usable updated/],
    [{ url: IDENTITY, feed_url: FEED, seq: 1, updated: T0 }, /no items map/],
    [{ url: IDENTITY, feed_url: FEED, seq: 1, updated: T0, items: [] }, /no items map/],
    [{ url: IDENTITY, feed_url: FEED, seq: 1, updated: T0, items: { a: 'x' } }, /is not \[version, hash\]/],
    [{ url: IDENTITY, feed_url: FEED, seq: 1, updated: T0, items: { a: [1] } }, /is not \[version, hash\]/],
    // §7.2: ids appear as URI fragments in relation references, so they never contain `#`.
    [{ url: IDENTITY, feed_url: FEED, seq: 1, updated: T0, items: { 'a#b': [1, 'h'] } }, /containing #/],
    // Live and deleted at once is not a state a consumer should have to pick a side on.
    [{ url: IDENTITY, feed_url: FEED, seq: 1, updated: T0, items: { a: [1, 'h'] }, deleted: { a: [2, 'h'] } }, /both live and deleted/],
  ];
  for (const [doc, expected] of bad) {
    assert.throws(() => assertManifestShape(doc, MANIFEST), (e) => e instanceof ManifestError && expected.test(e.message), expected.source);
  }
});

test('a manifest is bound to the identity and feed that named it', () => {
  const m = manifest({ seq: 1 });
  assert.ok(assertManifestBinding(m, { identityUrl: IDENTITY, feedUrl: FEED }));
  assert.throws(
    () => assertManifestBinding(m, { identityUrl: 'https://someone.else/', feedUrl: FEED }),
    (e) => e instanceof ManifestError && /claims/.test(e.message),
  );
  assert.throws(
    () => assertManifestBinding(m, { identityUrl: IDENTITY, feedUrl: 'https://owner.example/other.json' }),
    (e) => e instanceof ManifestError && /commits/.test(e.message),
  );
});

// ---- §9.2: there is no partial advance ----

test('a tombstone-only advance turns the morning\'s honest posts into invariant-3 violations', () => {
  // §9.2 says advance immediately for a tombstone. §9.3 invariant 3 says an item uncommitted by
  // an advance whose `updated` has passed its signing time has been *passed over* — a violation,
  // not lag. Compose them naively and a daily-cadence publisher that advances at 2pm carrying
  // only the tombstone accuses itself, at every consumer, by obeying the text. §9.2 now says
  // every version commits the whole live set, and this holds the failure it rules out in place.
  const morning = [item({ id: 'a', at: T0 }), item({ id: 'b', at: T0 + 60 })];
  const doomed = item({ id: 'c', at: T0 - DAY });
  const yesterday = manifest({ seq: 4, updated: T0 - 3600, items: [doomed] });
  const stone = item({ id: 'c', version: 2, at: T0 + 7200, deleted: true });

  // The partial advance: the tombstone lands, this morning's two posts do not.
  const partial = manifest({ seq: 5, updated: T0 + 7200, items: [], deleted: [stone] });
  const bad = reconcileFeed(partial, [...morning, stone], { now: T0 + 7200, url: FEED });
  assert.equal(bad.violations.length, 2, 'both honest posts are reported as passed over');
  for (const v of bad.violations) {
    assert.equal(v.invariant, 3);
    assert.match(v.message, /the manifest advanced at/);
  }

  // The sweeping advance: same seq, same `updated`, same tombstone, plus the live set.
  const swept = manifest({ seq: 5, updated: T0 + 7200, items: morning, deleted: [stone] });
  const good = reconcileFeed(swept, [...morning, stone], { now: T0 + 7200, url: FEED });
  assert.deepEqual(good.violations, [], 'committing the live set costs nothing and accuses nobody');
  assert.deepEqual(
    good.states.map((s) => s.state).sort(),
    ['deleted', 'live', 'live'],
  );

  // And the two are the same chain hop, so nothing else in §9.3 tells them apart.
  assert.doesNotThrow(() => assertInvariantsAcrossHop(yesterday, partial, { url: MANIFEST }));
  assert.doesNotThrow(() => assertInvariantsAcrossHop(yesterday, swept, { url: MANIFEST }));
});

// ---- §9.1.2: freshness, and the attack of doing nothing ----

test('a chain that simply stops advancing becomes stale, and only then', () => {
  // The one mutation of a chain that produced no verdict at all. Every other check in this
  // module compares a version against its predecessor or a pin, so all of them pass on a host
  // serving the last honest version forever — and "this host stopped publishing you" reads
  // exactly like "you had nothing to say".
  const m = manifest({ seq: 4, updated: T0, items: [item({ id: 'a', at: T0 })] });

  assert.equal(freshness(m, { now: T0 + DAY }), null, 'inside the ceiling, fresh');
  assert.equal(freshness(m, { now: T0 + 7 * DAY }), null, 'at the ceiling, still fresh');
  const late = freshness(m, { now: T0 + 30 * DAY });
  assert.ok(late, 'past the ceiling, stale');
  assert.equal(late.seq, 4);
  assert.equal(late.declared, null, 'no declaration: the deadline is this reader\'s own ceiling');
  assert.equal(late.overdueSeconds, 23 * DAY);
});

test('a declaration can only tighten a consumer\'s ceiling, never loosen it', () => {
  // This is what separates a *declared* bound from the *derived* one §9.3 refuses. A derived
  // bound "catches only a publisher deviating from its rhythm, never one that simply declares a
  // slow one" — so the declaration is capped, and a greedy one buys its publisher nothing.
  const tight = manifest({ seq: 1, updated: T0, items: [], _next_update: T0 + DAY });
  assert.equal(freshness(tight, { now: T0 + 12 * 3600 }), null, 'inside the declared day');
  const missed = freshness(tight, { now: T0 + 2 * DAY });
  assert.ok(missed, 'a publisher promising daily is held to daily, well inside the 7-day ceiling');
  assert.equal(missed.declared, T0 + DAY);

  const greedy = manifest({ seq: 1, updated: T0, items: [], _next_update: T0 + 3650 * DAY });
  assert.equal(freshness(greedy, { now: T0 + 6 * DAY }), null);
  assert.ok(freshness(greedy, { now: T0 + 8 * DAY }), 'a ten-year promise is stale in seven days');
});

test('a _next_update that does not postdate its own version is refused as a shape', () => {
  // Not computed-around: the field's whole value is that a reader can act on it, and one that
  // declares the chain overdue at the moment of publication is a typo or a lie.
  for (const bad of [T0, T0 - 1, 'soon', 1.5]) {
    assert.throws(
      () => assertManifestShape({ ...manifest({ seq: 1, updated: T0, items: [] }), _next_update: bad }, MANIFEST),
      /_next_update/,
    );
  }
});

test('a malformed _next_update in retained history does not brick the walk (§9.1.2)', () => {
  // The strictness above binds the tip, which its publisher can correct by advancing. Retained
  // versions are immutable and freshness is only ever computed at the tip, so a walk that
  // failed on an old typo — say, a float written by some earlier tool — would convert a MAY
  // field into a permanent hole in the back catalog, and only for the strictest readers: the
  // exact divergence one-spelling rules exist to prevent, manufactured by a shape check.
  const a = { ...manifest({ seq: 1, updated: T0, items: [item({ id: 'a', at: T0 })] }), _next_update: T0 + 1.5 };
  const b = manifest({ seq: 2, updated: T0 + DAY, items: [item({ id: 'a', at: T0 })], prev: a });

  assert.doesNotThrow(() => assertHistoryInvariants([a, b], { url: MANIFEST }),
    'the old typo is read as absent');
  assert.throws(() => assertHistoryInvariants([a], { url: MANIFEST }), /_next_update/,
    'the same version at the tip is still refused');
});
