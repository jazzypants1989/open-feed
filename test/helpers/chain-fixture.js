// The test substrate for the chain layer: an in-memory document store implementing §5.4's
// derived-URL convention, and builders that produce well-formed chains so a test can spend
// its lines on the one thing it is breaking.
//
// Keys here are freshly generated rather than derived from labels. Determinism matters for
// Appendix D's published vectors and nowhere else; borrowing that machinery would couple the
// chain tests to the vector generator for no benefit.

import crypto from 'node:crypto';
import { documentHash, sign, derivedVersionUrl, skipAnchors } from '../../src/index.js';

export function makeKey(kid, { use, iat = 1736899200, revoked_at } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat, kid, kty: 'OKP', x };
  if (use) jwk.use = use;
  if (revoked_at !== undefined) jwk.revoked_at = revoked_at;
  return { kid, jwk, privateKey, publicKey, x };
}

/**
 * Documents addressed the way §5.4 addresses them: the tip at its own URL, every prior
 * version at `{url-without-.json}/{seq}.json`, byte-identically.
 */
export class DocumentStore {
  constructor() {
    this.byUrl = new Map();
    this.fetches = [];
  }

  publish(url, doc) {
    this.byUrl.set(url, doc);
    this.byUrl.set(derivedVersionUrl(url, doc.seq), doc);
    return doc;
  }

  /** Overwrite one retained version without touching the tip — how equivocation is staged. */
  replaceVersion(url, seq, doc) {
    this.byUrl.set(derivedVersionUrl(url, seq), doc);
  }

  prune(url, seq) {
    this.byUrl.delete(derivedVersionUrl(url, seq));
  }

  tip(url) {
    return this.byUrl.get(url) ?? null;
  }

  /** The `fetchVersion(url, seq)` callback `walkToPin` takes. Records what a walk asked for. */
  fetchVersion = async (url, seq) => {
    const at = derivedVersionUrl(url, seq);
    this.fetches.push(at);
    const doc = this.byUrl.get(at);
    if (!doc) throw new Error(`404 ${at}`);
    // A copy, so a test mutating what it got back cannot reach into the store.
    return JSON.parse(JSON.stringify(doc));
  };
}

/** Builds successive versions of one chained document, handling seq, prev, and signing. */
export class ChainBuilder {
  constructor({ url, store, updatedStart = 1736899200, interval = 86400 }) {
    this.url = url;
    this.store = store;
    this.versions = [];
    this.updatedStart = updatedStart;
    this.interval = interval;
  }

  get tip() {
    return this.versions.at(-1) ?? null;
  }

  at(seq) {
    return this.versions[seq - 1];
  }

  /**
   * Publish the next version. `signer` is a key from `makeKey`; `fields` are the document
   * body. `mutate` runs after seq/prev/updated are set and before signing, which is how a
   * test forges an anchor or a shape.
   */
  publish({ fields, signer, updated, mutate } = {}) {
    const seq = this.versions.length + 1;
    const doc = { ...fields, seq, updated: updated ?? this.updatedStart + (seq - 1) * this.interval };
    if (seq > 1) doc.prev = documentHash(this.tip);
    mutate?.(doc, this);
    doc._sig = sign(doc, signer.privateKey, `${signer.identity}#${signer.kid}`);
    this.versions.push(doc);
    this.store.publish(this.url, doc);
    return doc;
  }

  /** Attach the §9.1.1 anchors this seq is entitled to offer. Called from `mutate`. */
  addSkipLinks(doc) {
    const skip = {};
    for (const anchor of skipAnchors(doc.seq)) {
      const version = this.at(anchor);
      if (version) skip[String(anchor)] = documentHash(version);
    }
    if (Object.keys(skip).length) doc._skip = skip;
    return doc;
  }
}

/**
 * A whole identity: genesis plus however many versions asked for, each signed by a continuity
 * key valid in its predecessor. Returns the builder so a test can keep publishing.
 */
export function identityFixture({
  identity = 'https://owner.example/',
  store = new DocumentStore(),
  versions = 1,
  recoveryKeys = 1,
  recoveryThreshold,
  skipLinks = false,
} = {}) {
  const url = `${identity}openfeed.json`;
  const primary = makeKey('key-1');
  primary.identity = identity;
  const recovery = Array.from({ length: recoveryKeys }, (_, i) => {
    const k = makeKey(`recovery-${i + 1}`, { use: 'recovery' });
    k.identity = identity;
    return k;
  });

  const chain = new ChainBuilder({ url, store });
  const keys = [primary.jwk, ...recovery.map((k) => k.jwk)];
  const body = () => {
    const fields = { url: identity, name: 'Owner', keys: keys.map((k) => ({ ...k })) };
    if (recoveryThreshold !== undefined) fields.recovery_threshold = recoveryThreshold;
    return fields;
  };

  // An identity chain MUST NOT be walked by skip links (§9.1.1), but a publisher can still
  // put `_skip` in one — it is an ordinary extension field — so a fixture that can produce
  // one is what lets a test prove the walk ignores it.
  for (let i = 0; i < versions; i++) {
    chain.publish({
      fields: body(),
      signer: primary,
      mutate: skipLinks ? (doc, c) => c.addSkipLinks(doc) : undefined,
    });
  }

  return { identity, url, store, chain, primary, recovery, keys };
}

/** A manifest chain for a feed owned by `identity`, signed by that identity's key. */
export function manifestFixture({
  identity = 'https://owner.example/',
  feedUrl = 'https://owner.example/feed.json',
  manifestUrl = 'https://owner.example/manifest.json',
  store = new DocumentStore(),
  signer,
  versions = 1,
  skipLinks = false,
} = {}) {
  const chain = new ChainBuilder({ url: manifestUrl, store });
  for (let i = 0; i < versions; i++) {
    chain.publish({
      fields: { url: identity, feed_url: feedUrl, items: {} },
      signer,
      mutate: skipLinks ? (doc, c) => c.addSkipLinks(doc) : undefined,
    });
  }
  return { chain, store, manifestUrl, feedUrl };
}

/** The `(seq, hash)` pin for a version. */
export const pinOf = (doc) => ({ seq: doc.seq, hash: documentHash(doc) });
