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
import { derivedVersionUrl, skipAnchors } from './chain.js';
import { assertManifestShape } from './manifest.js';

export class PublishError extends Error {}

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
    recoveryThreshold,
    now = () => Math.floor(Date.now() / 1000),
    skipLinks = true,
  }) {
    this.identity = normalizeIdentityUrl(identity);
    this.feedUrl = feedUrl ?? `${this.identity}feed.json`;
    this.manifestUrl = manifestUrl ?? `${this.identity}manifest.json`;
    if (!this.manifestUrl.endsWith('.json')) {
      throw new PublishError(`a manifest URL must end in .json (§5.4): ${this.manifestUrl}`);
    }
    this.identityUrl = `${this.identity}openfeed.json`;
    this.title = title;
    this.signer = signer;
    this.now = now;
    this.skipLinks = skipLinks;

    this.identityVersions = [];
    this.manifestVersions = [];
    this.items = new Map();     // id -> the latest signed revision
    this.committed = new Map(); // id -> the version the manifest last committed

    this.#genesisIdentity({ profile, recoveryKeys, recoveryThreshold });
  }

  // ---- §3.2, §5.2: the identity chain ----

  #signDocument(doc) {
    const signed = { ...doc };
    delete signed._sig;
    signed._sig = sign(signed, this.signer.privateKey, `${this.identity}#${this.signer.kid}`);
    return signed;
  }

  #genesisIdentity({ profile, recoveryKeys, recoveryThreshold }) {
    const doc = {
      url: this.identity,
      ...profile,
      feeds: [{ url: this.feedUrl, manifest: this.manifestUrl, rel: 'primary' }],
      seq: 1,
      updated: this.now(),
      keys: [this.signer.jwk, ...recoveryKeys],
    };
    if (recoveryThreshold !== undefined) doc.recovery_threshold = recoveryThreshold;
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
  advanceIdentity(changes = {}, { updated } = {}) {
    const previous = this.identityDocument;
    const next = { ...previous, ...changes };
    delete next._sig;
    delete next._recovery_sig;
    next.seq = previous.seq + 1;
    next.prev = documentHash(previous);
    next.updated = updated ?? this.now();
    const signed = this.#signDocument(next);
    this.identityVersions.push(signed);
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
    return this.advanceIdentity({
      keys: this.identityDocument.keys.map((k) => (k.kid === previousKid ? { ...k, revoked_at: at } : k)),
    }, { updated: at });
  }

  // ---- §7: items ----

  /**
   * Sign and hold an item. It is servable in the feed immediately and uncommitted until the
   * next `advanceManifest()` — which is manifest lag (§9.4 invariant 3), the normal state of
   * freshly-published content under a cadence, and not a violation.
   */
  publishItem(fields, { at } = {}) {
    const id = fields.id;
    if (typeof id !== 'string' || id.includes('#')) {
      throw new PublishError(`an item id must be a string without '#' (§7.2): ${id}`);
    }
    const previous = this.items.get(id);
    if (previous?._deleted) throw new PublishError(`${id} is tombstoned; a new item needs a fresh id (§8.2)`);

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
    const signed = this.#signDocument(item);
    this.items.set(id, signed);
    return signed;
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
    const signed = this.#signDocument(doc);
    this.items.set(id, signed);
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
  advanceManifest({ updated } = {}) {
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
      updated: updated ?? this.now(),
      items: live,
    };
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
