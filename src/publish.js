// A Level 2 publisher (§12): serve an identity document, a feed, and a manifest, each signed,
// the two chained ones retaining every prior version at its derived URL (§5.4).
//
// Every artifact is a file and signing happens at build time, which is what §12 means by
// "fully static-hostable" — and it is what puts a real identity on a real domain with no
// custody obligations at all, since §12's MUSTs attach to hosting *other people*.
//
// The retention rule falls out rather than being implemented. A published document is the
// canonical bytes of the document with its `_sig` in place (§5.1), so writing `canonicalBytes`
// is simultaneously the serialization, the thing that was signed, and the thing `prev` hashes.
// There is no separate "keep the original bytes" step to get wrong.

import { canonicalBytes } from './canonical.js';
import { documentHash } from './hash.js';
import { sign, normalizeIdentityUrl } from './jws.js';
import { derivedVersionUrl, derivedItemUrl, skipAnchors, pinsForRecipients } from './chain.js';
import { assertManifestShape } from './manifest.js';

export class PublishError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

/** ISO 8601 for content fields; Unix seconds are for key and chain fields (§4.1). */
const iso = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * A publisher for one identity and one feed.
 *
 * `signer` is `{ kid, privateKey, jwk }`. The private key never leaves the caller — this class
 * calls `sign` with it and stores nothing, which is what lets a §12 hosting deployment keep
 * signing behind a narrower boundary than serving (§13.2).
 *
 * `cadence` is §9.2's first mechanism: the manifest advances on a schedule rather than once per
 * publication, so version count tracks time rather than activity. It is expressed here as an
 * explicit `advanceManifest()` call rather than a timer, because the cost §9.2 names is real —
 * uncommitted content is content a host can serve to one reader and not another — and a
 * publisher should have to decide when to pay it.
 */
export class Publisher {
  constructor({
    identity,
    feedUrl,
    manifestUrl,
    title = 'Feed',
    signer,
    profile = {},
    recoveryKeys = [],
    now = () => Math.floor(Date.now() / 1000),
    skipLinks = true,
    itemUrls = true,
    // §9.1.2's freshness cadence, in seconds, or `null` for a publisher that declares none.
    // A number here is a promise every reader can hold this identity to, so it is opt-in.
    nextUpdate = null,
    // §16.1's emission half, a Level 3 MUST. Held on the publisher rather than passed per call
    // so that a deployment which tracks its correspondents emits by construction: an obligation
    // a caller has to remember at every send is one a deployment satisfies until the day it
    // adds a code path, and the failure is invisible because nothing about the item looks wrong.
    pins = null,
    // §10.6 / §3.4: both halves of the pair key are subject to predecessor equivalence, and this
    // is the *recipient* half — a correspondent who migrates is not a new stream. Without it the
    // sender restarts them at seq 1, which their receiver rightly reports as a replay.
    equivalent = (a, b) => normalizeIdentityUrl(a) === normalizeIdentityUrl(b),
  }) {
    this.identity = normalizeIdentityUrl(identity);
    this.feedUrl = feedUrl ?? `${this.identity}feed.json`;
    this.manifestUrl = manifestUrl ?? `${this.identity}manifest.json`;
    if (!this.manifestUrl.endsWith('.json')) {
      throw new PublishError(`a manifest URL must end in .json (§5.4): ${this.manifestUrl}`);
    }
    this.identityUrl = `${this.identity}openfeed.json`;
    this.title = title;
    // One signer signs everything here, identity-chain versions included, so it cannot be a
    // recovery or delegated key (§4.5, §4.6). A delegated deployment (§12) splits signers —
    // root on the member's device, delegated at the hub — which this single-signer publisher
    // does not model; failing here beats emitting versions every verifier must reject.
    if (signer?.jwk?.use === 'recovery' || signer?.jwk?.use === 'delegated') {
      throw new PublishError(`a ${signer.jwk.use} key cannot sign identity-document versions (§4.5, §4.6)`);
    }
    this.signer = signer;
    this.now = now;
    this.skipLinks = skipLinks;
    this.itemUrls = itemUrls;
    this.nextUpdate = nextUpdate;
    this.pinStore = pins;
    // §10.6: recipient identity URL -> { seq, hash } of the last item delivered to them.
    this.deliveries = new Map();
    this.equivalent = equivalent;

    this.identityVersions = [];
    this.manifestVersions = [];
    this.items = new Map();     // id -> the latest signed revision
    this.committed = new Map(); // id -> the version the manifest last committed

    this.#genesisIdentity({ profile, recoveryKeys });
  }

  // ---- §3.2, §5.2: the identity chain ----

  #signDocument(doc) {
    const signed = { ...doc };
    delete signed._sig;
    signed._sig = sign(signed, this.signer.privateKey, `${this.identity}#${this.signer.kid}`);
    return signed;
  }

  /**
   * §5.2 step 2: a version is never dated before its predecessor — so the producer raises a
   * clock reading that would regress, rather than refusing to publish.
   *
   * Clamping rather than throwing is the rule, not a leniency. A chain whose `updated` drifts
   * backward passes every signature check and quietly disables §9.3 invariant 3, and the
   * producer is the only party positioned to notice — but the two ways that happens in
   * practice are a burst inside one second (§9.2 wants a tombstone committed *now*, and
   * `rotateKey` emits three versions in a row) and an NTP step backward. Refusing either
   * converts a clock problem into an inability to publish, which is the failure §5.2 declines
   * to trade for a strict inequality it argues buys nothing.
   */
  #dated(updated, previous) {
    return previous ? Math.max(updated, previous.updated) : updated;
  }

  #genesisIdentity({ profile, recoveryKeys }) {
    const doc = {
      url: this.identity,
      ...profile,
      // §3.2.1's `items`, a Level 2 MUST alongside actually serving the tree (§7.6). Serving
      // the URLs while declaring nothing leaves a reader unable to tell this publisher from
      // one that never served them, which is the whole of what the declaration is for — so
      // the flag tracks `itemUrls` rather than being separately settable.
      feeds: [{ url: this.feedUrl, manifest: this.manifestUrl, rel: 'primary', ...(this.itemUrls ? { items: true } : {}) }],
      seq: 1,
      updated: this.now(),
      keys: [this.signer.jwk, ...recoveryKeys],
    };
    // Genesis omits `prev` — it names nothing, and a walk that accepted one would hold a
    // seq 1 it believes is linked to something.
    this.identityVersions.push(this.#signDocument(doc));
  }

  get identityDocument() {
    return this.identityVersions.at(-1);
  }

  get manifest() {
    return this.manifestVersions.at(-1) ?? null;
  }

  /**
   * Advance the identity chain (§5.2). `changes` is merged over the current version; `seq`,
   * `prev`, and `updated` are set here.
   *
   * The signing key is whatever `this.signer` currently is, and §5.2 step 3 requires it to
   * have been valid in the *previous* version — so `rotateKey` adds the new key in one version
   * and only then makes it the signer.
   */
  advanceIdentity(changes = {}, { updated, recoverySigner = null, kidIdentity = this.identity } = {}) {
    const previous = this.identityDocument;
    const next = { ...previous, ...changes };
    delete next._sig;
    delete next._recovery_sig;
    next.seq = previous.seq + 1;
    next.prev = documentHash(previous);
    next.updated = this.#dated(updated ?? this.now(), previous);
    // A version that needs a co-signature gets it *here*, before the version exists to serve —
    // the safe path. `coSignIdentity` can retrofit one, but only until the tip's bytes have
    // been served to anyone (see its warning).
    const signed = recoverySigner
      ? this.#coSigned(next, recoverySigner, kidIdentity)
      : this.#signDocument(next);
    this.identityVersions.push(signed);
    return signed;
  }

  /** §6.3's order made structural: co-sign the unsigned version, then sign over the result. */
  #coSigned(version, recoverySigner, kidIdentity) {
    if (recoverySigner?.jwk?.use !== 'recovery') {
      throw new PublishError(`${recoverySigner?.kid} is not a recovery key (§4.5)`);
    }
    version._recovery_sig = sign(
      version, recoverySigner.privateKey, `${normalizeIdentityUrl(kidIdentity)}#${recoverySigner.kid}`,
      { recovery: true },
    );
    return this.#signDocument(version);
  }

  /**
   * §3.4 path 3 and §5.5: attach a recovery co-signature to the identity chain's current tip.
   *
   * Without this the reference publisher could not perform the only exit path that works against
   * a host which declines to cooperate — the one §13.2 ends every adversary tier at — and every
   * test of it had to hand-assemble a detached JWS outside the library, which is a gap that
   * looks like coverage.
   *
   * `kidIdentity` is the identity whose chain commits the recovery key, and it defaults to this
   * one because that is the fork-resolution case (§5.5). A **migration** passes the
   * *predecessor*: §3.4 requires the `kid` to name where the key is committed and where §4.5
   * resolves it, and a `kid` naming the successor would send a verifier to resolve the key in
   * the very document making the claim.
   *
   * Order is not a style choice. §6.3 has the co-signature's payload strip both signature fields
   * while `_sig` strips only its own, so `_sig` covers `_recovery_sig` — which is what stops a
   * serving-path attacker holding no key from deleting the co-signature and denying the exit in
   * silence. Co-sign first, then sign. Adding a co-signature afterwards invalidates the `_sig`
   * over it, exactly as adding any other member would.
   *
   * The tip is replaced rather than appended: a co-signature changes the version's bytes, so
   * doing this to anything but the newest version would break the `prev` of everything above it.
   * **And the replacement MUST happen before the tip's bytes are first served.** Two documents
   * at one `(url, seq)` is §5.3.1's definition of equivocation, and a pinned reader who saw the
   * un-co-signed spelling will freeze this chain on its honest author. For any version after
   * genesis, prefer `advanceIdentity(changes, { recoverySigner })`, which co-signs before the
   * version exists to serve; this method is for the genesis, which the constructor builds
   * before a migration's co-signer is necessarily at hand.
   */
  coSignIdentity(recoverySigner, { kidIdentity = this.identity } = {}) {
    const version = { ...this.identityDocument };
    delete version._sig;
    delete version._recovery_sig;
    const signed = this.#coSigned(version, recoverySigner, kidIdentity);
    this.identityVersions[this.identityVersions.length - 1] = signed;
    return signed;
  }

  /**
   * §4.3 rotation: publish a version adding the new key, then sign with it from the next
   * version on. Two versions rather than one, because §5.2's continuity rule judges the
   * signing key against the *previous* version's key list — a key introduced and used in the
   * same version has no standing there.
   *
   * The old key is revoked in the version the new key first signs, which is §5.2's "the
   * continuity key is often revoked in the very version it signs". It stays listed: §4.3 makes
   * that a MUST while any artifact it signed is still served, which retention makes permanent.
   */
  rotateKey(newSigner, { updated } = {}) {
    const keys = [...this.identityDocument.keys, newSigner.jwk];
    this.advanceIdentity({ keys }, { updated });

    const at = updated !== undefined ? updated + 1 : this.now();
    const previousKid = this.signer.kid;
    this.signer = newSigner;
    const rotated = this.advanceIdentity({
      keys: this.identityDocument.keys.map((k) => (k.kid === previousKid ? { ...k, revoked_at: at } : k)),
    }, { updated: at });

    // §9.1: a manifest tip signed by a revoked key is rejected whatever its `updated` says, so
    // revoking a key that has signed manifests is two artifacts and not one. Doing it here is
    // the difference between a rotation and a rotation that strands every reader: the identity
    // chain would advance, the old manifest tip would stop verifying, and the publisher would
    // have no signal at all — its own files are still on disk and still internally consistent.
    if (this.manifest) this.advanceManifest({ updated: at + 1 });
    return rotated;
  }

  // ---- §7: items ----

  /**
   * Sign and hold an item. It is servable in the feed immediately and uncommitted until the
   * next `advanceManifest()` — which is manifest lag (§9.3 invariant 3), the normal state of
   * freshly-published content under a cadence, and not a violation.
   */
  publishItem(fields, { at, recipients = [], pins = null } = {}) {
    const id = fields.id;
    if (typeof id !== 'string' || id.includes('#')) {
      throw new PublishError(`an item id must be a string without '#' (§7.2): ${id}`);
    }
    const previous = this.items.get(id);
    if (previous?._deleted) throw new PublishError(`${id} is tombstoned; a new item needs a fresh id (§8.2)`);
    // §7.3: only `tombstone()` marks deletion, because a tombstone is an allowlist and this is
    // not. Let `_deleted` ride in on the spread and the result is a signed "tombstone" carrying
    // a title, tags, or any content field — exactly what the allowlist exists to rule out.
    // Signature fields are computed, never supplied.
    for (const reserved of ['_deleted', '_sig', '_recovery_sig']) {
      if (reserved in fields) {
        throw new PublishError(`${id} supplies ${reserved}, which publishItem never accepts (§7.3, §6.4)`);
      }
    }

    const when = at ?? this.now();
    const version = (previous?._version ?? 0) + 1;
    const item = {
      id,
      authors: [{ url: this.identity }],   // §6.6: exactly one entry, and it is the binding
      _feed_url: this.feedUrl,
      _version: version,
      date_published: previous?.date_published ?? iso(when),
      ...fields,
      ...(version > 1 ? { date_modified: iso(when) } : {}),
    };
    item.id = id;
    item.authors = [{ url: this.identity }];
    item._version = version;
    item._feed_url = this.feedUrl;
    if (item.content_text === undefined && item.content_html === undefined) {
      throw new PublishError(`${id} carries neither content_text nor content_html (§7.2)`);
    }
    // §7.4: `_sha256` on an attachment entry is a MUST, and refusing here is the only place a
    // publisher finds out. A consumer's remedy is to mark the bytes unverified (§10.5), which
    // is a downgrade the author never asked for and cannot see — the item still verifies, the
    // photo under it is simply outside the envelope, and whoever serves those bytes can swap
    // them undetectably.
    if (item.attachments !== undefined) {
      if (!Array.isArray(item.attachments)) {
        throw new PublishError(`${id} has an attachments member that is not an array (§7.4)`);
      }
      for (const [i, a] of item.attachments.entries()) {
        if (typeof a?._sha256 !== 'string' || a._sha256.length === 0) {
          throw new PublishError(`${id} attachment ${i} (${a?.url ?? 'no url'}) has no _sha256 (§7.4)`);
        }
      }
    }
    const signed = this.#signDocument(
      this.#withPins(item, { recipients, pins, _pins: fields._pins }),
    );
    this.items.set(id, signed);
    return signed;
  }

  /**
   * A **delivered-only** item (§8, §11.1): signed exactly like a published one and carrying no
   * `_feed_url`, which is the whole of the distinction. It enters no feed and no manifest, so
   * it is not stored here — the caller POSTs it to an inbox (§10.1) and keeps it for §14's
   * `delivered` slot, which is the only artifact it ever appears in.
   *
   * This exists because the column is not optional in the design: §8 makes a `like` delivered by
   * default, §15.4 keeps content-free reactions delivered, and a publisher that
   * can only publish cannot express either. `_feed_url` is refused rather than ignored — adding
   * one is the author promoting a delivered item to a published one at a new `_version` (§7.5),
   * which is `publishItem`'s job and needs to look like a decision.
   */
  deliverItem(fields, { at, to = null, recipients = [], pins = null } = {}) {
    const id = fields.id;
    if (typeof id !== 'string' || id.includes('#')) {
      throw new PublishError(`an item id must be a string without '#' (§7.2): ${id}`);
    }
    if ('_feed_url' in fields) {
      throw new PublishError(`${id} supplies _feed_url; a delivered item has none (§8, §11.1.1)`);
    }
    for (const reserved of ['_deleted', '_sig', '_recovery_sig']) {
      if (reserved in fields) {
        throw new PublishError(`${id} supplies ${reserved}, which deliverItem never accepts (§7.3, §6.4)`);
      }
    }
    const when = at ?? this.now();
    const item = {
      id,
      authors: [{ url: this.identity }],
      _version: fields._version ?? 1,
      date_published: iso(when),
      ...fields,
    };
    item.id = id;
    item.authors = [{ url: this.identity }];
    if (item.content_text === undefined && item.content_html === undefined) {
      throw new PublishError(`${id} carries neither content_text nor content_html (§7.2)`);
    }
    const signed = this.#signDocument(
      this.#withDelivery(this.#withPins(item, { recipients, pins, _pins: fields._pins }), to),
    );
    // Advance the stream only once the bytes exist, because what the *next* delivery commits to
    // is this item's full published bytes (§5.1) — signature included, like every other hash in
    // this protocol.
    if (to && signed._delivery) {
      this.deliveries.set(this.#deliveryKey(to), { seq: signed._delivery.seq, hash: documentHash(signed) });
    }
    return signed;
  }

  /**
   * §10.6's delivery chain: a counter and the hash of the previous item this sender delivered to
   * this recipient, both inside the signed bytes.
   *
   * The state lives here because only the sender has it. A delivered item is committed by
   * nothing — no feed, no manifest, no §7.6 URL — so a receiving host can drop one and leave no
   * trace anywhere, and under §13.2's hostile-custodian tier that host is the adversary. The
   * counter makes a *selective* drop visible to its victim; the hash is what makes the victim's
   * observation checkable by a third party, since the carrier item is the sender's signature over
   * the exact bytes of something the recipient does not hold.
   *
   * `to` is the recipient's identity URL, and it is a separate argument from `recipients` (which
   * is §16.1's pin scoping) because they answer different questions: pins may be drawn for
   * several parties an item is *about*, while a delivery stream is one pair — and §11.2 makes
   * one pair the whole of the delivered column: a delivered-only item goes to exactly one
   * recipient, which is why a single top-level entry naming nobody is never ambiguous.
   *
   * No `to`, no field: §10.6 is a SHOULD and a sender that does not track streams emits nothing
   * rather than a counter that restarts at 1 and means nothing.
   */
  /** The stream a recipient URL resolves to, honoring predecessor equivalence (§3.4, §10.6). */
  #deliveryKey(to) {
    const me = normalizeIdentityUrl(to);
    if (this.deliveries.has(me)) return me;
    for (const held of this.deliveries.keys()) if (this.equivalent(held, me)) return held;
    return me;
  }

  #withDelivery(item, to) {
    if (!to) return item;
    const last = this.deliveries.get(this.#deliveryKey(to)) ?? null;
    const entry = { seq: (last?.seq ?? 0) + 1 };
    if (last) entry.prev = last.hash;
    const withEntry = { ...item, _delivery: entry };
    // The hash committed to the *next* delivery is of the signed item, which does not exist
    // until the caller signs it — so the stream is advanced by `deliverItem` after signing,
    // never here. Returning the unsigned shape keeps this function honest about that.
    return withEntry;
  }

  /**
   * §16.1's **emission** half, which is the side nothing else in this repository supplies.
   *
   * §12 makes this a **Level 3 MUST**: a sender that already tracks a recipient's chains carries
   * pins for them on the items it sends them. The asymmetry is why. A consumer's own comparisons
   * cover only what it fetched itself, so a host serving each reader a consistent private branch
   * is caught by no reader alone — §5.3.1's compare rule is a Level 1 MUST that the core gives a
   * consumer nothing to compare against, and emission is the only thing in the protocol that
   * supplies the second observation. A `PinStore` and the identity documents of whoever this item
   * is addressed to are exactly what that needs, and a publisher that verifies the people it
   * talks to already holds both.
   *
   * Scoping is by construction rather than by check. `pinsForRecipients` draws only from chains
   * the recipients own, so every entry satisfies §16.1's publication rule even on a published
   * item — which is the rule that matters, since a published item is world-readable forever and
   * a third-party pin there would broadcast its author's reading graph to everyone. A caller
   * wanting to gossip about a third party may pass that party's document, and it is admissible
   * only on a delivered item; that judgement is the receiver's (`admissibleItemPins`).
   *
   * An explicit `_pins` in `fields` wins, and nothing is emitted when there is nothing to say:
   * the MUST binds a sender that *already* holds the recipient's pins, so a publisher with no
   * store, no named recipients, or no tracked chain among them owes nothing, and an empty array
   * would be noise inside signed bytes.
   */
  #withPins(item, { recipients = [], pins, _pins } = {}) {
    if (_pins !== undefined) return item;
    // `??` rather than a default parameter: the callers pass `pins` through explicitly and its
    // own default is `null`, which is not `undefined` and would therefore shadow the store.
    const store = pins ?? this.pinStore;
    if (!store || !recipients.length) return item;
    const entries = pinsForRecipients(store, recipients);
    return entries.length ? { ...item, _pins: entries } : item;
  }

  /**
   * §7.3: a tombstone MUST contain exactly these fields and no others. The allowlist is the
   * point — a denylist naming today's content fields would let a conformant tombstone keep a
   * title, a tag, or an extension payload carrying the very thing the author deleted.
   */
  tombstone(id, { at } = {}) {
    const previous = this.items.get(id);
    if (!previous) throw new PublishError(`nothing to tombstone at ${id}`);
    const when = at ?? this.now();
    const doc = {
      id,
      authors: [{ url: this.identity }],
      date_published: previous.date_published,
      date_modified: iso(when),
      _version: previous._version + 1,
      _deleted: true,
      content_text: '',
    };
    if (previous._feed_url !== undefined) doc._feed_url = previous._feed_url;
    if (previous._rel !== undefined) doc._rel = previous._rel; // retained for routing (§8.2)
    if (previous._unverified !== undefined) doc._unverified = previous._unverified; // travels with the item (§7.5)
    const signed = this.#signDocument(doc);
    this.items.set(id, signed);
    return signed;
  }

  /**
   * §8.2's retraction for the delivered column: a tombstone, delivered to the same inbox.
   *
   * `tombstone()` cannot reach a delivered-only item, because `deliverItem` stores nothing —
   * the caller keeps the signed bytes for §14's `delivered` slot — so retraction takes those
   * bytes back as its argument. The shape is §7.3's allowlist, and the `_delivery` entry is
   * this tombstone's own position in the pair's stream (§10.6), never a field carried over
   * from the original: a retraction that had to shed its stream entry would break the sender's
   * own chain at the exact moment it is exercised.
   */
  retractDelivered(original, { at, to = null } = {}) {
    if (typeof original?.id !== 'string') {
      throw new PublishError('retractDelivered needs the delivered item it is retracting');
    }
    if (original._feed_url !== undefined) {
      throw new PublishError(`${original.id} is published; tombstone() governs the feed (§7.3)`);
    }
    const when = at ?? this.now();
    const doc = {
      id: original.id,
      authors: [{ url: this.identity }],
      date_published: original.date_published,
      date_modified: iso(when),
      _version: (original._version ?? 1) + 1,
      _deleted: true,
      content_text: '',
    };
    if (original._rel !== undefined) doc._rel = original._rel; // retained for routing (§8.2)
    if (original._unverified !== undefined) doc._unverified = original._unverified; // §7.5
    const signed = this.#signDocument(this.#withDelivery(doc, to));
    if (to && signed._delivery) {
      this.deliveries.set(this.#deliveryKey(to), { seq: signed._delivery.seq, hash: documentHash(signed) });
    }
    return signed;
  }

  // ---- §7.1: the feed ----

  /** JSON Feed 1.1. Not signed and not chained: every item carries its own signature. */
  get feed() {
    const items = [...this.items.values()]
      .sort((a, b) => (a.date_modified ?? a.date_published) < (b.date_modified ?? b.date_published) ? 1 : -1);
    return {
      version: 'https://jsonfeed.org/version/1.1',
      title: this.title,
      feed_url: this.feedUrl,
      items,
    };
  }

  // ---- §9: the manifest chain ----

  /**
   * Advance the manifest chain, committing everything currently held (§9.2's cadence: publish
   * items as they are written, advance on a schedule).
   *
   * Invariant 1 is satisfied structurally rather than checked afterwards: `items` and `deleted`
   * are rebuilt from the full live set every time, so an id can only leave `items` by acquiring
   * a tombstone, which puts it in `deleted`.
   */
  advanceManifest({ updated, nextUpdate = this.nextUpdate } = {}) {
    const previous = this.manifest;
    const live = {};
    const deleted = {};
    for (const [id, item] of this.items) {
      (item._deleted ? deleted : live)[id] = [item._version, documentHash(item)];
      this.committed.set(id, item._version);
    }

    const doc = {
      url: this.identity,
      feed_url: this.feedUrl,
      seq: (previous?.seq ?? 0) + 1,
      updated: this.#dated(updated ?? this.now(), previous),
      items: live,
    };
    // §9.1.2: the freshness deadline. `nextUpdate` is a *cadence in seconds* rather than an
    // absolute time, because that is the thing a publisher actually knows about itself and the
    // absolute form has to be recomputed correctly on every advance or it silently declares the
    // chain perpetually overdue. Off unless asked for: a publisher that cannot keep a rhythm
    // should not declare one, and §9.1.2 makes the field a MAY for that reason.
    if (nextUpdate) doc._next_update = doc.updated + nextUpdate;
    if (Object.keys(deleted).length) doc.deleted = deleted;
    if (previous) doc.prev = documentHash(previous);
    if (this.skipLinks) {
      const skip = {};
      for (const anchor of skipAnchors(doc.seq)) {
        const version = this.manifestVersions[anchor - 1];
        if (version) skip[String(anchor)] = documentHash(version);
      }
      if (Object.keys(skip).length) doc._skip = skip;
    }

    const signed = this.#signDocument(doc);
    assertManifestShape(signed, this.manifestUrl);
    this.manifestVersions.push(signed);
    return signed;
  }

  // ---- serving ----

  /**
   * Every document this identity serves, keyed by URL: the two tips, the feed, and every
   * retained prior version at its §5.4 derived URL.
   *
   * Prior versions are the same objects that were signed, so "served byte-identically to how
   * they were published" is not a discipline anyone has to keep — it is the only thing this
   * can do.
   */
  documents() {
    const out = new Map();
    out.set(this.identityUrl, this.identityDocument);
    out.set(this.feedUrl, this.feed);
    for (const version of this.identityVersions) {
      out.set(derivedVersionUrl(this.identityUrl, version.seq), version);
    }
    if (this.manifest) {
      out.set(this.manifestUrl, this.manifest);
      for (const version of this.manifestVersions) {
        out.set(derivedVersionUrl(this.manifestUrl, version.seq), version);
      }
    }
    // §7.6, a Level 2 MUST: each committed revision at its own derived URL. Same shape as the
    // retention above and the same reason it needs no discipline — the file's name is the hash
    // of its bytes, so it cannot drift from what the manifest commits without ceasing to be
    // the file the manifest names. What it buys a reader is the ability to ask for one item,
    // which is what makes §9.3's withholding verdict assertable at all.
    //
    // `itemUrls: false` is retained so a test can build the pre-rule publisher a consumer must
    // still be able to read (§7.6: producers MUST serve, consumers MUST NOT require). It is not
    // a conformant configuration.
    if (this.itemUrls) {
      for (const item of this.items.values()) {
        out.set(derivedItemUrl(this.feedUrl, documentHash(item)), item);
      }
    }
    return out;
  }

  /**
   * The same set as paths relative to the identity URL, with their bytes. This is the whole of
   * "static hosting": copy the result into a directory and the identity is live.
   */
  files() {
    const out = new Map();
    for (const [url, doc] of this.documents()) {
      if (!url.startsWith(this.identity)) {
        throw new PublishError(`${url} is outside ${this.identity}; a static publisher cannot serve it`);
      }
      out.set(url.slice(this.identity.length), canonicalBytes(doc));
    }
    return out;
  }
}
