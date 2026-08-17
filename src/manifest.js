// The manifest (§9): what a feed's contents are, committed by a separately-signed chain.
//
// §9.1's chain mechanics are `chain.js` — one walk, two policies — so what is here is the
// part that is manifest-specific: §9.3's five invariants, and the distinction §13.13 says
// never to collapse. Lag, withholding, and violation are three states, not three names for
// one. The second and third are attacks; the first is not.
//
// Nothing here opens a socket or fetches anything. It is given documents and returns verdicts.

import { documentHash, timingSafeEqualString } from './hash.js';
import { claimedAuthor, effectiveSigningTime, normalizeIdentityUrl, normalizeUrlForCompare, VerifyError } from './jws.js';

export class ManifestError extends Error {
  constructor(message, { url, seq, id } = {}) {
    super(message);
    this.name = new.target.name;
    this.url = url;
    this.seq = seq;
    this.id = id;
  }
}

/**
 * A §9.3 invariant violation. Its own type because §9.3 opens with "violations MUST be treated
 * like chain equivocation" — the response is to stop trusting the chain's future, not to
 * report a bad fetch.
 */
export class InvariantViolation extends ManifestError {
  constructor(message, { invariant, url, seq, id, retryable = false } = {}) {
    super(message, { url, seq, id });
    this.invariant = invariant;
    // §9.3's graded response. A violation that compares signed bytes the consumer holds is
    // conclusive; one that compares two objects fetched at two moments is not, because nothing
    // makes those reads atomic. The second kind is surfaced and re-read, never frozen on.
    this.retryable = retryable;
  }
}

// ---- §9.3 invariant 3: the lag ceiling ----

/**
 * The RECOMMENDED absolute ceiling on the unverified-pending state (§9.3 invariant 3): 7 days,
 * matching §10.2's staleness bound. The ceiling is the consumer's own, never derived from the
 * publisher's observed cadence — a derived bound catches only a publisher deviating from its
 * rhythm, never one that declares a slow one, and gives a first-contact consumer no deadline
 * at all.
 */
export const LAG_CEILING_SECONDS = 7 * 24 * 3600;

/**
 * The other end of the same bound (§9.3 invariant 3): how far ahead of this consumer's clock an
 * item's effective signing time may sit before it is a violation rather than lag. 24 hours, the
 * figure §10.2 applies to a delivered item, because it answers the same question about the same
 * self-reported number.
 *
 * Both of invariant 3's other tests **invert** under a future-dated item, which is why this one
 * is not redundant with them: a manifest's `updated` cannot have advanced past a moment that has
 * not arrived, and the item's age against the ceiling is negative. So without this a publisher
 * stamping next year holds its entire feed in permanent `pending` — the standing window in which
 * it may serve an item to one reader and not another with no evidence produced anywhere, which is
 * exactly what the ceiling exists to close, obtained for free and for as long as it likes.
 */
export const FUTURE_SKEW_SECONDS = 24 * 3600;

/**
 * §9.1.2. Is this chain stale — has its publisher missed the deadline it undertook to meet?
 *
 * The one attack on a chain that produces no other verdict is doing nothing to it. Every check
 * in this module and in `chain.js` compares a version against its predecessor or against a pin,
 * so all of them pass on a host serving the last honest version forever, and "this host stopped
 * publishing you" reads exactly like "you had nothing to say".
 *
 * The deadline is `min(declared, updated + ceiling)` and the asymmetry is the whole design. A
 * publisher may promise to be *faster* than the consumer's ceiling and be held to it; it may not
 * promise to be slower. That is what separates this from the derived bound §9.3 refuses — a
 * bound read off observed cadence catches only a publisher deviating from its rhythm, never one
 * that simply declares a slow one, and a declaration the consumer caps cannot be used that way.
 * A first-contact consumer gets the ceiling, so it has a deadline on its first read.
 *
 * Returns `null` when fresh. Note what the verdict is NOT: staleness is unverified, never
 * equivocation. The caller holds its pin without advancing it and goes on rendering what it
 * already verified — an honest publisher on holiday trips this, and must not be convicted by it.
 */
export function freshness(manifest, { now = Math.floor(Date.now() / 1000), ceiling = LAG_CEILING_SECONDS } = {}) {
  if (!manifest || typeof manifest.updated !== 'number') return null;
  const declared = typeof manifest._next_update === 'number' ? manifest._next_update : Infinity;
  const deadline = Math.min(declared, manifest.updated + ceiling);
  if (now <= deadline) return null;
  return {
    url: manifest.feed_url,
    seq: manifest.seq,
    deadline,
    declared: Number.isFinite(declared) ? declared : null,
    overdueSeconds: now - deadline,
  };
}

// ---- shape ----

/**
 * One `items` / `deleted` entry, read as `{ version, hash }`, or `null` if it is not §9's
 * `[version, hash]` shape.
 *
 * Exported because it is the *only* reading of that wire shape in this implementation, and a
 * second one is a divergence waiting to happen: a reader that also accepted, say, an object with
 * a `hash` member would follow a manifest this module's own shape check rejects, and the two
 * would disagree about what a conformant manifest is while both looked reasonable in isolation.
 */
export const entryOf = (map, id) => {
  const e = map?.[id];
  return Array.isArray(e) && e.length === 2 && Number.isInteger(e[0]) && typeof e[1] === 'string'
    ? { version: e[0], hash: e[1] }
    : null;
};

/**
 * The manifest's own shape (§9). Checked before any invariant, because an invariant compared
 * against a malformed map reports the wrong thing: a missing `items` object would look like
 * every item being withheld.
 */
export function assertManifestShape(doc, url, { tip = true } = {}) {
  if (!doc || typeof doc !== 'object') throw new ManifestError(`${url} did not yield a manifest`, { url });
  for (const field of ['url', 'feed_url']) {
    if (typeof doc[field] !== 'string') throw new ManifestError(`${url} has no usable ${field}`, { url, seq: doc.seq });
  }
  if (!Number.isInteger(doc.seq) || doc.seq < 1) throw new ManifestError(`${url} has no usable seq`, { url });
  if (typeof doc.updated !== 'number') throw new ManifestError(`${url} has no usable updated`, { url, seq: doc.seq });
  // §9.1.2: a freshness deadline that does not postdate the version it rides on is either a
  // typo or a publisher declaring itself perpetually stale. Refusing the shape beats computing
  // a verdict from it — but only at the **tip**, which the publisher can correct by advancing.
  // Retained versions are immutable, freshness is only ever computed at the tip, and a walk
  // that failed on an old typo would convert a MAY field into a permanent hole in the back
  // catalog for exactly the strictest readers — so in history the field is read as absent.
  if (tip && doc._next_update !== undefined) {
    if (!Number.isInteger(doc._next_update) || doc._next_update <= doc.updated) {
      throw new ManifestError(`${url} has a _next_update that does not postdate updated`, { url, seq: doc.seq });
    }
  }
  if (doc.items === undefined || doc.items === null || typeof doc.items !== 'object' || Array.isArray(doc.items)) {
    throw new ManifestError(`${url} has no items map`, { url, seq: doc.seq });
  }
  if (doc.deleted !== undefined && (typeof doc.deleted !== 'object' || doc.deleted === null || Array.isArray(doc.deleted))) {
    throw new ManifestError(`${url} has a deleted field that is not a map`, { url, seq: doc.seq });
  }
  for (const [map, name] of [[doc.items, 'items'], [doc.deleted ?? {}, 'deleted']]) {
    for (const id of Object.keys(map)) {
      if (!entryOf(map, id)) {
        throw new ManifestError(`${url} ${name}[${id}] is not [version, hash]`, { url, seq: doc.seq, id });
      }
      // §7.2: ids appear as URI fragments in relation references, so they never contain `#`.
      if (id.includes('#')) throw new ManifestError(`${url} commits an id containing #: ${id}`, { url, seq: doc.seq, id });
    }
  }
  const both = Object.keys(doc.items).filter((id) => doc.deleted && id in doc.deleted);
  if (both.length) {
    throw new ManifestError(`${url} lists ${both[0]} as both live and deleted`, { url, seq: doc.seq, id: both[0] });
  }
  return doc;
}

/**
 * §9's binding of a manifest to the identity and feed it claims. Separate from the chain
 * policy's signature check because it is about *which* manifest this is, not whether it was
 * signed: `url` must be the identity whose `feeds` entry names this manifest, and `feed_url`
 * must be the feed that entry points at.
 *
 * What this deliberately does **not** check is which feed the committed *items* name. §3.4
 * requires a migrated back catalog to be republished byte-verbatim, so those items keep the
 * predecessor's feed URL forever and the successor's manifest is the only place they can be
 * committed — a verifier MUST NOT reject a manifest for committing them (§9). That check
 * belongs to the reader's canonical/copy classification (§7.5), which holds the verified
 * migration this one knows nothing about.
 *
 * Both halves are compared **normalized**. The identity half always was; the feed half was
 * raw string equality, one line apart, which made a publisher who wrote `:443` in the `feeds`
 * entry and not in the manifest — or differed in host case between them — unreadable over a
 * difference §3.1 says is not one. `normalizeUrlForCompare` is the same comparator §7.5 uses
 * on this exact pair of URLs in the reader, and one comparator is the point.
 */
export function assertManifestBinding(doc, { identityUrl, feedUrl }) {
  if (normalizeIdentityUrl(doc.url) !== normalizeIdentityUrl(identityUrl)) {
    throw new ManifestError(`manifest claims ${doc.url}, not ${identityUrl}`, { seq: doc.seq });
  }
  const compare = (u) => { try { return normalizeUrlForCompare(u); } catch { return String(u); } };
  if (compare(doc.feed_url) !== compare(feedUrl)) {
    throw new ManifestError(`manifest commits ${doc.feed_url}, not the feed it was named for (${feedUrl})`, { seq: doc.seq });
  }
  return doc;
}

// ---- §9.3 invariants 1 and 2, plus same-version byte stability: across a hop ----

/**
 * Applied to one adjacent pair of manifest versions.
 *
 * 1. An `id`, once present in `items`, MUST appear in every later manifest — in `items` at the
 *    same or a higher version, or in `deleted`. Content cannot silently vanish; removal
 *    requires a signed tombstone.
 * 2. `seq`, `updated`, and per-item versions never decrease.
 * — and one rule that is not a numbered invariant, which is why this heading names it: **an
 *    entry at the same version MUST name the same bytes.** §9.3 invariant 4 states the
 *    feed-against-manifest form of "the manifest names an exact revision"; this is the
 *    manifest-against-manifest form, and it is what §9's paragraph on committing bytes rather
 *    than versions is actually for — a key custodian signing item `X` version 1 as one thing
 *    for you and another for your sister produces two manifests that differ *only* here.
 *    Violations are reported under `invariant: 4` because it is the same rule about the same
 *    exactness, seen from the other side.
 */
export function assertInvariantsAcrossHop(earlier, later, { url } = {}) {
  if (later.seq <= earlier.seq) {
    throw new InvariantViolation(
      `${url ?? 'manifest'} seq ${later.seq} does not advance on seq ${earlier.seq}`,
      { invariant: 2, url, seq: later.seq },
    );
  }
  // §5.2, and invariant 2 restates it: `updated` never goes backward. Equal is fine — `seq`
  // orders the chain and a burst of versions in one second shares a clock reading. Invariant 3
  // below still reads a manifest's `updated` as proof the chain moved past a given item's
  // signing time, which it remains: that test asks whether `updated` has *passed* the item, not
  // whether it changed on this hop. A publisher parking its clock outright is caught by the
  // consumer's own ceiling and §9.1.2's deadline, not here.
  if (later.updated < earlier.updated) {
    throw new InvariantViolation(
      `${url ?? 'manifest'} seq ${later.seq} is dated ${later.updated}, before seq ${earlier.seq}'s ${earlier.updated}`,
      { invariant: 2, url, seq: later.seq },
    );
  }

  for (const id of Object.keys(earlier.items)) {
    const was = entryOf(earlier.items, id);
    const live = entryOf(later.items, id);
    const gone = entryOf(later.deleted, id);

    if (!live && !gone) {
      throw new InvariantViolation(
        `${id} was live at seq ${earlier.seq} and appears nowhere in seq ${later.seq}: removal requires a signed tombstone`,
        { invariant: 1, url, seq: later.seq, id },
      );
    }
    const now = live ?? gone;
    if (now.version < was.version) {
      throw new InvariantViolation(
        `${id} went from version ${was.version} at seq ${earlier.seq} to ${now.version} at seq ${later.seq}`,
        { invariant: 2, url, seq: later.seq, id },
      );
    }
    // A same-version entry naming different bytes is the key-custodian attack §9 spends a
    // paragraph on: the manifest names an exact revision, so one revision has one hash.
    if (now.version === was.version && now.hash !== was.hash && live) {
      throw new InvariantViolation(
        `${id} version ${was.version} hashes to ${was.hash} at seq ${earlier.seq} and ${now.hash} at seq ${later.seq}`,
        { invariant: 4, url, seq: later.seq, id },
      );
    }
  }

  for (const id of Object.keys(earlier.deleted ?? {})) {
    const was = entryOf(earlier.deleted, id);
    const live = entryOf(later.items, id);
    const gone = entryOf(later.deleted, id);
    if (live && live.version <= was.version) {
      throw new InvariantViolation(
        `${id} was tombstoned at version ${was.version} and is live again at version ${live.version}`,
        { invariant: 1, url, seq: later.seq, id },
      );
    }
    if (!live && !gone) {
      throw new InvariantViolation(
        `${id} was tombstoned at seq ${earlier.seq} and its deletion is not recorded at seq ${later.seq}`,
        { invariant: 1, url, seq: later.seq, id },
      );
    }
  }
  return true;
}

/**
 * Apply invariants 1 and 2 down a walked history.
 *
 * `versions` comes from `walkToPin` and is newest-first. A **skipping** walk (§9.1.1) returns
 * versions with gaps, so pass `contiguous: false` and the pairwise hop check is skipped: the
 * invariants still hold between the pin and the tip, which are adjacent in that array's sense,
 * but a gap means an id could have been added and removed inside it without this consumer ever
 * seeing either. That is exactly what §9.1.1 means by a skipping consumer being a weaker
 * witness, and it is stated here rather than quietly not checked.
 *
 * **Cost, because it looks alarming and is already bounded.** This is O(hops x ids): every hop
 * iterates every id the earlier version held. It cannot be less — invariant 1 is the statement
 * that *no* id vanished, and answering it needs every id. What bounds it is that a version's
 * ids are proportional to its bytes, and §13.4 caps the bytes a walk may fetch (the greater of
 * 10 MB and 20x the tip). So the work is proportional to bytes this consumer already parsed,
 * not to the chain's true length: a walk that would exceed it is refused by the budget before
 * this function sees it. The shape that would make it cheaper is a delta manifest, and
 * `tmp/deltamanifest-prototype.js` measures why that trade is refused — under deltas this
 * check stops being a map read between adjacent versions and becomes a fold over a range, so
 * the work does not go away, it moves into every consumer and takes invariant 1's per-hop
 * checkability with it.
 */
export function assertHistoryInvariants(versions, { url, contiguous = true } = {}) {
  const ordered = [...versions].sort((a, b) => a.seq - b.seq);
  // §9.1.2: `_next_update` strictness binds the tip only; see `assertManifestShape`.
  for (const v of ordered) assertManifestShape(v, url ?? v.url, { tip: v === ordered[ordered.length - 1] });

  if (!contiguous) {
    // Endpoints only: content cannot vanish between the pin and the tip even across a skip.
    if (ordered.length >= 2) {
      assertInvariantsAcrossHop(ordered[0], ordered[ordered.length - 1], { url });
    }
    return { checked: 'endpoints', hops: 0, skippedGaps: true };
  }

  let hops = 0;
  for (let i = 1; i < ordered.length; i++) {
    assertInvariantsAcrossHop(ordered[i - 1], ordered[i], { url });
    hops++;
  }
  return { checked: 'every-hop', hops, skippedGaps: false };
}

// ---- §9.3 invariants 3 and 4, plus withholding: the feed against its manifest ----

/**
 * The three states, and they are three. §13.13: "Do not collapse them: the second and third
 * are attacks and the first is not."
 *
 * - `live` / `deleted` — the feed and the manifest agree, and the bytes hash to what was
 *   committed.
 * - `pending` — manifest lag (§9.3 invariant 3). The feed carries content newer than the
 *   manifest commits. Not a violation, and not evidence of anything either: uncommitted
 *   content is content a host can serve to one reader and not another without forking.
 * - `withheld` — the manifest commits an exact revision the consumer **asked for and was
 *   refused**: a §7.6 item URL that did not yield it, on an origin that demonstrably serves
 *   item URLs. No invariant is broken and nothing is forged; the consumer knows the bytes
 *   exist and cannot obtain them. That is the manifest doing its job, and it MUST be surfaced
 *   as withholding rather than held as perpetually-pending. §9.3 scopes it to bytes actually
 *   tried for, which a feed read alone never establishes — a page with no `next_url` may be a
 *   complete catalog or a recency window, and the two are indistinguishable from the bytes.
 * - `absent` — committed, and not in the pages this consumer holds (§7.4). The same evidence
 *   as `withheld` with an honest explanation still open, so it is a separate state rather
 *   than a softer word for the same thing, and it accuses nobody.
 * - `violation` — §9.3. Treated like chain equivocation.
 */
export const ITEM_STATES = ['live', 'deleted', 'pending', 'withheld', 'absent', 'violation'];

/**
 * Reconcile a served feed against the manifest that commits it.
 *
 * `items` are the feed's items as fetched, verbatim — their bytes are what invariant 4 hashes,
 * so a re-serialized copy will not reconcile. `now` and `ceiling` come from the caller;
 * `ceiling` defaults to the RECOMMENDED `LAG_CEILING_SECONDS` and is the consumer's own
 * absolute deadline on the pending state (§9.3 invariant 3).
 *
 * `partial` says the caller stopped before following `next_url` to its end (§7.4). It only
 * colors the `absent` reason: even a caller that read every page to the end holds no evidence
 * of withholding, because a feed with no further pages may be a complete catalog or a recency
 * window and the two are indistinguishable from the bytes — §7.4's "at least the 50 most
 * recent items" makes the window the ordinary conformant shape.
 *
 * `unobtainable` is the reading §9.3 actually asks for, and the only one that asserts
 * withholding here: ids the caller **requested** at their §7.6 derived URL and did not get.
 * Pagination cannot explain a `404` on a URL that names one item. A caller with no §7.6
 * available passes nothing and gets `absent` throughout — which is why §9.3 says the verdict
 * is close to unreachable on the pull path without it.
 */
export function reconcileFeed(manifest, items, { now = Math.floor(Date.now() / 1000), ceiling = LAG_CEILING_SECONDS, futureSkew = FUTURE_SKEW_SECONDS, url, partial = false, unobtainable = new Set() } = {}) {
  assertManifestShape(manifest, url ?? manifest.url);

  const states = new Map();
  const violations = [];
  const seen = new Set();
  const record = (id, state, detail) => states.set(id, { id, state, ...detail });
  const violate = (message, meta) => {
    const v = new InvariantViolation(message, { url, seq: manifest.seq, ...meta });
    violations.push(v);
    record(meta.id, 'violation', { reason: v.message, invariant: v.invariant });
  };

  for (const item of items) {
    const id = item?.id;
    if (typeof id !== 'string') {
      violations.push(new InvariantViolation('a served item has no id', { invariant: 3, url, seq: manifest.seq }));
      continue;
    }
    seen.add(id);

    const version = item._version;
    const live = entryOf(manifest.items, id);
    const gone = entryOf(manifest.deleted, id);
    const committed = live ?? gone;

    if (!committed) {
      // Absent from the manifest entirely: lag, or the manifest passed it over.
      const passedOver = describeLag(item, manifest, { now, ceiling, futureSkew });
      if (passedOver) violate(`${id} is served live but absent from seq ${manifest.seq}: ${passedOver}`, { invariant: 3, id });
      else record(id, 'pending', { reason: 'newer than the manifest commits (§9.3 invariant 3)' });
      continue;
    }

    if (!Number.isInteger(version)) {
      violate(`${id} is committed at version ${committed.version} but the served item has no _version`, { invariant: 3, id });
      continue;
    }
    if (version < committed.version) {
      // Invariant 3, first clause. Not lag — lag is the feed being *ahead*.
      //
      // `retryable`, and it is the only violation here that is. Every other one compares signed
      // bytes the consumer holds — two versions of a chain, or an item against the entry that
      // commits it — and is conclusive from them. This one compares **two objects fetched at two
      // moments**, and nothing makes those reads atomic: a publisher writes the feed and the
      // manifest separately, and any cache between them may hold one and not the other, which
      // mid-publish on a multi-POP CDN is the ordinary steady state rather than an attack. The
      // finding is real and must be surfaced; freezing a chain on one observation of it is a
      // verdict that misfires against honest publishers, and §9.3 is explicit that such a verdict
      // is one nobody keeps running. The caller re-reads before convicting (§9.3).
      violate(
        `${id} is served at version ${version} but seq ${manifest.seq} commits version ${committed.version}`,
        { invariant: 3, id, retryable: true },
      );
      continue;
    }
    if (version > committed.version) {
      const passedOver = describeLag(item, manifest, { now, ceiling, futureSkew });
      if (passedOver) violate(`${id} version ${version} is uncommitted at seq ${manifest.seq}: ${passedOver}`, { invariant: 3, id });
      else record(id, 'pending', { reason: `committed at version ${committed.version}, served at ${version}` });
      continue;
    }

    // Versions match, so invariant 4 governs: the manifest names an exact revision.
    const hash = documentHash(item);
    if (!timingSafeEqualString(hash, committed.hash)) {
      violate(
        `${id} version ${version} hashes to ${hash}, but seq ${manifest.seq} commits ${committed.hash}`,
        { invariant: 4, id },
      );
      continue;
    }
    if (gone && item._deleted !== true) {
      violate(`${id} is committed as deleted at seq ${manifest.seq} but served as live content`, { invariant: 1, id });
      continue;
    }
    record(id, gone ? 'deleted' : 'live', { version, hash });
  }

  // Anything the manifest commits that the feed did not yield. §9.3 scopes withholding to
  // "bytes the consumer actually tried to obtain", and from a feed read alone that bar is
  // never met: a feed with no `next_url` may be a complete catalog or a recency window, the
  // two are indistinguishable from the bytes, and §7.4's "SHOULD carry at least the 50 most
  // recent items" makes the window the ordinary conformant shape. So `unobtainable` — ids the
  // caller **requested** at their §7.6 URL and did not get, on an origin that demonstrably
  // serves item URLs — is the only reading here that asserts withholding, and everything else
  // is `absent`, the state that accuses nobody. This is what §9.3 means by the verdict being
  // "close to unreachable on the pull path unless the publisher offers §7.6": a caller that
  // *knows* it holds the complete catalog is making a judgement this function cannot, and may
  // make it downstream of the `absent` state.
  for (const id of Object.keys(manifest.items)) {
    if (!seen.has(id)) {
      const e = entryOf(manifest.items, id);
      const probed = unobtainable.has(id);
      record(id, probed ? 'withheld' : 'absent', {
        version: e.version,
        hash: e.hash,
        reason: probed
          ? 'committed by the manifest, and its §7.6 item URL did not yield it'
          : partial
            ? 'committed by the manifest, not on this page (§7.4)'
            : 'committed by the manifest, not yielded by the pages read (§7.4: a window and a complete catalog are indistinguishable)',
      });
    }
  }
  for (const id of Object.keys(manifest.deleted ?? {})) {
    if (!seen.has(id)) {
      const e = entryOf(manifest.deleted, id);
      // A tombstone that has aged out of the feed (§7.3 says ≥30 days) is ordinary, not
      // withholding: the manifest is where deletion is permanent, and the feed is not.
      record(id, 'deleted', { version: e.version, hash: e.hash, reason: 'tombstoned; no longer served in the feed' });
    }
  }

  return { states: [...states.values()], violations, byId: states };
}

/**
 * Why an uncommitted item is a violation rather than lag, or `null` if it is still lag.
 *
 * Three tests, and none needs history (§9.3 invariant 3). An item dated ahead of this consumer's
 * clock by more than the skew allowance is not lag at all — see `FUTURE_SKEW_SECONDS` for why
 * that one has to be checked *first*, since the other two invert underneath it. A manifest whose
 * `updated` is later than the item's own signing time has demonstrably advanced past it, **where
 * the item's signer and the manifest's owner are the same identity**. And otherwise the
 * consumer's own absolute ceiling applies, regardless of the publisher's rhythm.
 *
 * That scope on the middle test is the load-bearing part. Effective signing time is self-reported
 * *by the item's author* (§13.1), and a feed may carry several authors (§7.1) — so unscoped, the
 * test convicts the manifest's publisher on a number somebody else chose. A contributor backdates
 * an item, hands it to the board owner, and the owner's *already published* manifest tip is
 * dated after it the moment it is served: a violation, at every consumer, treated like chain
 * equivocation, against a publisher who has done nothing and could have done nothing. Where the
 * signer owns the manifest that framing is impossible, because they are asserting the time
 * themselves. For everyone else's items the ceiling below governs, which is the bound that does
 * not depend on trusting an author about a publisher.
 */
function describeLag(item, manifest, { now, ceiling, futureSkew = FUTURE_SKEW_SECONDS }) {
  let signedAt;
  try {
    signedAt = effectiveSigningTime(item, { kind: 'item' });
  } catch (e) {
    if (e instanceof VerifyError) return 'the item carries no usable timestamp';
    throw e;
  }
  if (signedAt > now + futureSkew) {
    return `it is dated ${signedAt}, more than ${futureSkew}s ahead of this consumer's clock`;
  }
  if (manifest.updated > signedAt && selfAuthored(item, manifest)) {
    return `the manifest advanced at ${manifest.updated}, after its own publisher signed the item at ${signedAt}`;
  }
  const age = now - signedAt;
  if (age > ceiling) return `uncommitted for ${age}s, past the consumer's ceiling of ${ceiling}s`;
  return null;
}

/** Did the identity that owns this manifest (§9's `url`) sign this item (§6.6)? */
function selfAuthored(item, manifest) {
  try {
    return claimedAuthor(item, { kind: 'item' }) === normalizeIdentityUrl(manifest.url);
  } catch {
    return false; // an item whose author binding does not resolve is nobody's evidence
  }
}

// ---- §9.3 invariant 5: relocation does not reset the chain ----

/**
 * "Where a `feeds` entry's `manifest` URL changes, or a verified migration (§3.4) moves the
 * feed to a successor identity, every `id` live in the last manifest the consumer observed for
 * that feed MUST appear in the new chain's manifest."
 *
 * §5.3.1 is keyed on a document URL, so a new manifest URL is a new chain and a fresh
 * trust-on-first-observation — which without this rule would let a publisher discard content by
 * renaming a file, and would let a key custodian holding both halves of a cooperative migration
 * emit a genesis manifest committing whatever subset it liked.
 *
 * `lastObserved` is the last manifest the consumer holds for the *old* URL. Passing `null` is
 * the ordinary first-contact case: a consumer with no prior pin has nothing to carry across.
 */
export function assertRelocationCarriesForward(lastObserved, replacement, { fromUrl, toUrl } = {}) {
  if (!lastObserved) return { carried: 0, firstContact: true };
  assertManifestShape(lastObserved, fromUrl ?? lastObserved.url);
  assertManifestShape(replacement, toUrl ?? replacement.url);

  let carried = 0;
  for (const id of Object.keys(lastObserved.items)) {
    const was = entryOf(lastObserved.items, id);
    const live = entryOf(replacement.items, id);
    const gone = entryOf(replacement.deleted, id);
    const now = live ?? gone;
    if (!now) {
      throw new InvariantViolation(
        `${id} was live in the last manifest observed at ${fromUrl ?? lastObserved.url} and appears nowhere in the chain at ${toUrl ?? replacement.url}: relocation does not reset the chain`,
        { invariant: 5, url: toUrl, seq: replacement.seq, id },
      );
    }
    if (now.version < was.version) {
      throw new InvariantViolation(
        `${id} carried across at version ${now.version}, below the ${was.version} last observed`,
        { invariant: 5, url: toUrl, seq: replacement.seq, id },
      );
    }
    carried++;
  }
  return { carried, firstContact: false };
}
