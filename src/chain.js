// The version chain (§5), applied to both chained documents: the identity document and the
// manifest. §9.1 is explicit that they are one mechanism with substitutions, not two, so
// there is one walk here and two policies.
//
// Nothing in this module opens a socket. The walk takes a `fetchVersion(url, seq)` callback,
// which keeps `src/fetch.js` the only place an outbound request happens and lets the whole
// chain be exercised against an in-memory store.

import { documentHash } from './hash.js';
import {
  verifyDocument,
  parseDetachedSig,
  parseKid,
  signingInput,
  signingPayload,
  publicKeyFromJwk,
  normalizeIdentityUrl,
  VerifyError,
} from './jws.js';
import crypto from 'node:crypto';

export class ChainError extends Error {
  constructor(message, { url, seq } = {}) {
    super(message);
    this.url = url;
    this.seq = seq;
  }
}

/**
 * The §5.3.1 compare rule fired: two observations of one URL at one `seq` with different
 * hashes. Its own type because the required response is different in kind — not "this fetch
 * failed" but "this chain is under attack, stop advancing and surface it."
 */
export class EquivocationError extends ChainError {
  constructor(message, { url, seq, held, seen }) {
    super(message, { url, seq });
    this.held = held;
    this.seen = seen;
  }
}

export const MAX_VERSIONS_PER_UPDATE = 1000; // §5.4, §13.4

// ---- §5.4 derived URLs ----

/**
 * "Take the document's own URL, strip the trailing `.json`, and append `/{seq}.json`."
 *
 * Derived rather than named in a signed `prev_url` field because signed bytes are immutable:
 * a publisher who moved hosts would retroactively break the walk for every consumer whose
 * pin predates the move.
 */
export function derivedVersionUrl(documentUrl, seq) {
  const url = String(documentUrl);
  if (!url.endsWith('.json')) {
    throw new ChainError(`a chained document URL must end in .json: ${url}`, { url });
  }
  if (!Number.isInteger(seq) || seq < 1) {
    throw new ChainError(`seq must be a positive integer, got ${seq}`, { url, seq });
  }
  return `${url.slice(0, -'.json'.length)}/${seq}.json`;
}

// ---- §9.1.1 skip links ----

/**
 * The anchors a manifest at `seq` may legitimately offer: for each `k ≥ 0`, the largest
 * multiple of `2^k` strictly below `seq`, keeping distinct values of at least 1.
 *
 * Absolute, never relative. Relative offsets shorten a walk equally well and are wrong,
 * because every reader would then land on a different set of versions and §5.3.1 needs two
 * observers at the *same* `seq` to compare anything.
 */
export function skipAnchors(seq) {
  if (!Number.isInteger(seq) || seq < 1) return [];
  const out = new Set();
  for (let k = 0; ; k++) {
    const step = 2 ** k;
    const anchor = Math.floor((seq - 1) / step) * step;
    if (anchor < 1) break;
    out.add(anchor);
  }
  return [...out].sort((a, b) => b - a);
}

// ---- pins and the compare rule (§5.3, §5.3.1) ----

/**
 * Pin storage plus the compare rule.
 *
 * §12 makes pinning a Level 1 MUST because it is what §13.2's guarantees are made of: a
 * verifier that checks signatures but keeps no pin re-establishes trust on first use at
 * every fetch. §5.3.1 adds the other half — a verifier that pins but never compares has
 * built the evidence and thrown it away — so observing is where the comparison happens,
 * and it is not optional or deferred.
 *
 * Observations are kept per `seq` rather than only at the pin, because that is what makes a
 * peer's pin at an *older* `seq` (§16.2) checkable. The map is bounded by chain length.
 */
export class PinStore {
  constructor({ now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.now = now;
    this.pins = new Map();          // url -> { seq, hash, observed, firstPinned }
    // url -> Map(seq -> { hash, observed }). The time is per `seq`, not per URL, because
    // §16.1's `observed` is "when this `(url, seq, hash)` was **first** observed" — publish a
    // URL-level first-contact time in that field and every entry becomes a signed assertion
    // that you witnessed a version before it existed, which is what §16.2.3 rests on.
    this.observations = new Map();
    this.frozen = new Map();        // url -> { seq, held, seen, reason }
  }

  pin(url) {
    return this.pins.get(url) ?? null;
  }

  isFrozen(url) {
    return this.frozen.has(url);
  }

  /**
   * Record an observation of `(url, seq, hash)` and apply the compare rule.
   *
   * Equal hashes at the same `seq` are corroboration; different hashes are equivocation and
   * the chain is frozen. `provenance` is carried only so a caller can say where the second
   * observation came from — own store, cache, second device — since §5.3.1 holds whatever it is.
   *
   * **Only verified observations belong here.** §5.3.1 defines one as a version obtained from
   * that `seq`'s derived URL or connected to the pin by a walk. Anything else is a claim, and
   * freezing on a claim hands a permanent veto over an identity to whoever made it — see
   * `reconcilePeerPin` for the path a peer's assertion takes instead.
   */
  observe(url, seq, hash, { provenance = 'self' } = {}) {
    const seen = this.observations.get(url) ?? new Map();
    const held = seen.get(seq);
    if (held !== undefined && held.hash !== hash) {
      const err = new EquivocationError(
        `${url} served two different versions at seq ${seq}: ${held.hash} and ${hash} (${provenance})`,
        { url, seq, held: held.hash, seen: hash },
      );
      this.freeze(url, err);
      throw err;
    }
    // First observation wins the timestamp; a later corroborating fetch does not move it.
    if (held === undefined) seen.set(seq, { hash, observed: this.now() });
    this.observations.set(url, seen);
    return { corroborated: held !== undefined };
  }

  /**
   * This store's observations of one chained document, in the shape §16.1 publishes.
   *
   * Whether to publish them is a privacy decision (§16 is emphatic that a pins document
   * discloses who you read *and when*), so this returns entries and does not sign or emit
   * anything.
   */
  observationsFor(url) {
    return [...(this.observations.get(url) ?? new Map())]
      .sort(([a], [b]) => a - b)
      .map(([seq, { hash, observed }]) => ({ url, seq, hash, observed }));
  }

  /**
   * Advance the pin after a successful walk. Refuses while the chain is frozen: §5.3.1 says
   * to retain the pin without advancing and accept no further version until the divergence
   * resolves or the consumer deliberately re-pins.
   */
  advance(url, seq, hash) {
    const frozen = this.frozen.get(url);
    if (frozen) {
      throw new ChainError(
        `${url} is frozen by an unresolved equivocation at seq ${frozen.seq}; re-pin deliberately to continue`,
        { url, seq },
      );
    }
    const held = this.pins.get(url);
    if (held && seq < held.seq) {
      throw new ChainError(`${url} went backwards: pinned at seq ${held.seq}, offered ${seq}`, { url, seq });
    }
    this.observe(url, seq, hash);
    this.pins.set(url, {
      seq,
      hash,
      // When *this version* was first seen — §16.1's `observed`, and the value a pins document
      // may carry. Distinct from `firstPinned`, which is how long this identity has been known
      // at all and is what TOFU age means (§5.3).
      observed: this.observations.get(url).get(seq).observed,
      firstPinned: held?.firstPinned ?? this.now(),
    });
    return this.pins.get(url);
  }

  /**
   * Take in a peer's published pin (§16.1) or one carried on an item (§16.5) — **without**
   * letting it touch the store.
   *
   * A pin proves its author asserts something, not that the assertion is true (§16), so it is
   * a claim rather than an observation (§5.3.1). Routing one into `observe` would mean any
   * peer could freeze any chain for any reader by publishing one wrong entry, and via §16.5
   * any stranger who can reach an inbox could do the same.
   *
   * So this decides nothing and mutates nothing. `check` is the interesting verdict: fetch that
   * `seq` from its derived URL (§5.4) and let the result be your own observation.
   */
  reconcilePeerPin(url, seq, hash) {
    const held = this.observations.get(url)?.get(seq);
    if (held === undefined) return { verdict: 'unknown', held: null, seq };
    return { verdict: held.hash === hash ? 'corroborates' : 'check', held: held.hash, seq };
  }

  freeze(url, error) {
    this.frozen.set(url, { seq: error.seq, held: error.held, seen: error.seen, reason: error.message });
  }

  /**
   * The deliberate act §5.3.1 leaves to the consumer. Named `rePin` rather than `unfreeze`
   * because it is a decision about trust, and it discards the observations that disagreed —
   * keeping them would refreeze the chain on the next fetch.
   */
  rePin(url, seq, hash) {
    this.frozen.delete(url);
    this.observations.delete(url);
    this.pins.delete(url);
    return this.advance(url, seq, hash);
  }
}

// ---- chain policies ----

function signingKeyId(doc) {
  return parseKid(parseDetachedSig(doc._sig).header.kid).keyId;
}

/**
 * §5.2 step 3: a version is signed by a **continuity key** — one that was valid
 * (non-revoked, non-recovery) in the *previous* version. Hash linkage alone is insufficient,
 * since a fabricated intermediate could otherwise introduce an attacker's key.
 *
 * The key **material** is compared, not just the `kid`, because §4.2 binds `(identity, kid)` to
 * one key permanently. A successor that keeps the label and swaps `x` would satisfy both
 * "listed in the predecessor" and §5.3 step 1's "listed in the document itself" while being an
 * entirely different key — the substitution this check exists to prevent, reached by relabelling
 * rather than by forgery.
 */
export function assertContinuityKey(successor, predecessor) {
  const keyId = signingKeyId(successor);
  const inSuccessor = successor.keys?.find((k) => k?.kid === keyId);
  const key = predecessor.keys?.find((k) => k?.kid === keyId);
  if (!key) {
    throw new ChainError(
      `seq ${successor.seq} is signed by ${keyId}, which seq ${predecessor.seq} does not list`,
      { seq: successor.seq },
    );
  }
  if (key.use === 'recovery') {
    throw new ChainError(
      `seq ${successor.seq} is signed by the recovery key ${keyId}, which MUST NOT sign chain versions (§4.5)`,
      { seq: successor.seq },
    );
  }
  // Revocation is judged against the predecessor's state. A key revoked *in* the version it
  // signs is normal rotation (§5.2) and stays valid there — but it cannot then sign the next
  // one, which is why equality counts as revoked here and as valid in §6.5.
  if (typeof key.revoked_at === 'number' && key.revoked_at <= predecessor.updated) {
    throw new ChainError(
      `seq ${successor.seq} is signed by ${keyId}, already revoked at ${key.revoked_at} in seq ${predecessor.seq}`,
      { seq: successor.seq },
    );
  }
  if (inSuccessor && (inSuccessor.x !== key.x || inSuccessor.crv !== key.crv || inSuccessor.kty !== key.kty)) {
    throw new ChainError(
      `seq ${successor.seq} rebinds ${keyId} to different key material than seq ${predecessor.seq} committed`,
      { seq: successor.seq },
    );
  }
  return key;
}

/**
 * The identity chain. §5.3 step 1: the signing key named by the `kid` MUST be listed in the
 * document itself, so the document is its own key source.
 *
 * `allowSkipLinks: false` is a security property, not a spec-compliance detail, and it lives
 * on the policy rather than in a caller's options so no caller can turn it on. Because the
 * document is its own key source, a freshly-fetched tip is **unauthenticated** until the walk
 * connects it to the pin — anyone who can write to the tip URL can mint a keypair, list it,
 * and self-sign. A `_skip` anchor is a statement by that same unauthenticated tip, and the
 * skip path never checks the tip's own `prev`, so following one lets a serving-path attacker
 * holding no key at all splice a forged tip onto an honest history.
 */
export const identityChainPolicy = {
  kind: 'identity',
  allowSkipLinks: false,
  verifySignature(doc) {
    return verifyDocument(doc, { identityDocument: doc, kind: 'document' });
  },
  verifyContinuity(successor, predecessor) {
    return assertContinuityKey(successor, predecessor);
  },
};

/**
 * The manifest chain. §9.1's table substitutes the key source: a manifest carries no keys,
 * so its signing key is resolved in the identity chain of its `url`, out of that identity's
 * pinned document. There is no per-hop continuity rule, because there is no key state in the
 * manifest to be continuous with.
 *
 * That substitution is also what makes §9.1.1 skip links safe here and nowhere else. The key
 * source is external and already trusted — the identity chain was walked and pinned first —
 * so a manifest tip is authenticated before its `_skip` is read, and an anchor it offers is a
 * statement by a key the consumer has already verified. An identity document has no such
 * external anchor, which is why `identityChainPolicy` refuses skip links outright.
 */
export function manifestChainPolicy(identityDocument) {
  const identity = normalizeIdentityUrl(identityDocument.url);
  return {
    kind: 'manifest',
    allowSkipLinks: true,
    verifySignature(doc) {
      if (normalizeIdentityUrl(doc.url) !== identity) {
        throw new ChainError(`manifest at seq ${doc.seq} claims ${doc.url}, not ${identity}`, { seq: doc.seq });
      }
      return verifyDocument(doc, { identityDocument, kind: 'document' });
    },
    verifyContinuity() {},
  };
}

// ---- the walk (§5.3 step 2) ----

function assertVersionShape(doc, url) {
  if (!doc || typeof doc !== 'object') throw new ChainError(`${url} did not yield a document`, { url });
  if (!Number.isInteger(doc.seq) || doc.seq < 1) {
    throw new ChainError(`${url} has no usable seq`, { url });
  }
  if (typeof doc.updated !== 'number') throw new ChainError(`${url} has no usable updated`, { url, seq: doc.seq });
  if (doc.seq > 1 && typeof doc.prev !== 'string') {
    throw new ChainError(`${url} is at seq ${doc.seq} with no prev`, { url, seq: doc.seq });
  }
  if (doc.seq === 1 && 'prev' in doc) {
    throw new ChainError(`${url} is genesis and MUST omit prev`, { url, seq: 1 });
  }
}

/**
 * Decide whether a conflict at the pinned `seq` is the publisher equivocating or somebody
 * serving one bad response.
 *
 * The two URLs are not the same thing, and that is what settles it. The tip URL serves
 * whatever the publisher currently claims; the copy of a *particular* `seq` lives at its
 * derived URL and MUST be served byte-identically forever (§5.4). So when a tip claims a seq
 * the consumer has pinned, with different bytes, the publisher's own retained record is the
 * tiebreak — and it is one fetch.
 *
 * - Retained copy still matches the pin → the tip contradicts its own publisher. That is a
 *   forgery, and `ChainError` says so: noise, answered by §12's transient-failure ladder.
 * - Retained copy has changed too → the retained history itself was rewritten, which §5.4
 *   forbids outright. That is equivocation and §5.3.1 fires.
 *
 * The distinction matters because §5.3.1's response — accept no further version until a human
 * deliberately re-pins — is far too much authority to hand to anyone who can answer a single
 * request. An identity document is its own key source (§5.3 step 1), so a serving-path
 * attacker holding no key at all can mint one, list it, and self-sign a tip.
 */
async function classifyConflictAtPin({ url, tip, pin, fetchVersion, policy }) {
  const retained = await fetchVersion(url, pin.seq);
  assertVersionShape(retained, derivedVersionUrl(url, pin.seq));
  if (retained.seq !== pin.seq) {
    throw new ChainError(
      `${derivedVersionUrl(url, pin.seq)} is seq ${retained.seq}, not ${pin.seq}`,
      { url, seq: retained.seq },
    );
  }
  const hash = documentHash(retained);
  if (hash === pin.hash) {
    throw new ChainError(
      `${url} served a version at seq ${pin.seq} that the publisher's own retained copy contradicts: ` +
        `the tip hashes to ${documentHash(tip)}, ${derivedVersionUrl(url, pin.seq)} still hashes to ${pin.hash}`,
      { url, seq: pin.seq },
    );
  }
  // The retained copy moved. Only the publisher serves that URL, and §5.4 makes changing it a
  // violation on its own, so this is evidence about the chain rather than about one response.
  policy.verifySignature(retained);
  return retained;
}

/**
 * Walk `prev` links from a freshly-fetched tip back to a stored pin, verifying every hop.
 *
 * Returns the versions observed, newest first. Throws `EquivocationError` when the compare
 * rule fires and `ChainError` for every other failure — including the one §5.3 is emphatic
 * about, a pin that cannot be connected to the current document, which MUST be treated as
 * unverifiable rather than silently re-pinned.
 *
 * **Observations are buffered and only committed once the walk anchors at the pin.** A range
 * of versions is internally consistent whenever one party forged all of it, so an unanchored
 * range proves nothing about this chain — and recording one would let anybody who can serve a
 * single response poison the store with a hash the honest publisher will never produce, which
 * freezes the chain against its own owner on the next honest fetch. Evidence for §5.3.1 is a
 * version tied to something the consumer already trusts, not a version that merely parses.
 *
 * `contiguous` says whether `versions` is every version between the pin and the tip or has
 * gaps. A skipping walk jumps over versions it never fetches (§9.1.1), so a caller checking
 * anything *per version* — §9.3's invariants across a manifest's history, say — must not read
 * this array as a complete range. It is also what makes a skipping consumer a weaker witness
 * for others.
 */
export async function walkToPin({
  url,
  tip,
  pin,
  fetchVersion,
  policy,
  pins = null,
  maxVersions = MAX_VERSIONS_PER_UPDATE,
  useSkipLinks = true,
}) {
  assertVersionShape(tip, url);
  policy.verifySignature(tip);

  const tipHash = documentHash(tip);
  // Buffered, not committed. See the note above: nothing here is evidence until the walk
  // anchors at the pin, so the store is written once at the end rather than as we go.
  const pending = [];
  const record = (doc, hash) => pending.push([doc.seq, hash ?? documentHash(doc)]);
  const commit = () => {
    for (const [seq, hash] of pending) pins?.observe(url, seq, hash);
  };
  record(tip, tipHash);

  // First contact is TOFU (§5.3): accept and pin, with nothing to walk back to.
  if (!pin) {
    commit();
    return { versions: [tip], hops: 0, tofu: true, contiguous: true, hash: tipHash };
  }

  if (tip.seq < pin.seq) {
    throw new ChainError(`${url} rolled back: pinned at seq ${pin.seq}, served ${tip.seq}`, { url, seq: tip.seq });
  }
  if (tip.seq === pin.seq) {
    if (tipHash === pin.hash) {
      commit(); // corroboration of the pin by a second fetch
      return { versions: [tip], hops: 0, tofu: false, contiguous: true, hash: tipHash };
    }
    // Different bytes at the pinned seq, and the walk is zero-length here so nothing has
    // authenticated them. Ask the publisher's own retained copy which version is theirs before
    // firing a rule whose response is to stop accepting this chain until a human intervenes.
    await classifyConflictAtPin({ url, tip, pin, fetchVersion, policy });
    commit();
    throw new EquivocationError(
      `${url} served a different version at the pinned seq ${pin.seq}`,
      { url, seq: pin.seq, held: pin.hash, seen: tipHash },
    );
  }

  const versions = [tip];
  let current = tip;
  let hops = 0;
  let contiguous = true;

  while (current.seq > pin.seq) {
    if (++hops > maxVersions) {
      throw new ChainError(
        `${url} needs more than ${maxVersions} versions to reach the pin at seq ${pin.seq}`,
        { url, seq: current.seq },
      );
    }

    // The policy decides whether skipping is sound at all; the caller may only decline it
    // further. A policy that says nothing gets no skipping, which is the fail-closed default
    // for anything defined outside this module.
    const skipping = useSkipLinks && policy.allowSkipLinks === true;
    const anchor = skipping ? chooseSkipAnchor(current, pin.seq) : null;
    if (anchor) {
      const landing = await followSkipAnchor({ url, current, anchor, fetchVersion, policy, record });
      versions.push(...landing.versions);
      contiguous = false;
      current = landing.landed;
      continue;
    }

    const predecessor = await fetchVersion(url, current.seq - 1);
    assertVersionShape(predecessor, derivedVersionUrl(url, current.seq - 1));
    if (predecessor.seq !== current.seq - 1) {
      throw new ChainError(
        `${derivedVersionUrl(url, current.seq - 1)} is seq ${predecessor.seq}, not ${current.seq - 1}`,
        { url, seq: predecessor.seq },
      );
    }
    const hash = documentHash(predecessor);
    if (hash !== current.prev) {
      throw new ChainError(
        `${url} seq ${current.seq} names prev ${current.prev}, but seq ${predecessor.seq} hashes to ${hash}`,
        { url, seq: predecessor.seq },
      );
    }
    policy.verifySignature(predecessor);
    policy.verifyContinuity(current, predecessor);
    record(predecessor, hash);
    versions.push(predecessor);
    current = predecessor;
  }

  const reachedHash = documentHash(current);
  if (reachedHash !== pin.hash) {
    // Unlike the zero-hop case above, this version came from its **derived** URL, which only
    // the publisher serves and which §5.4 requires to be byte-identical forever. So a mismatch
    // here is the retained history having been rewritten, and no tiebreak fetch is needed.
    // Commit just this one observation — the rest of the walked range hangs off an unanchored
    // tip and proves nothing — and let the store fire the compare rule.
    pins?.observe(url, pin.seq, reachedHash);
    throw new EquivocationError(
      `${url} walked back to seq ${pin.seq} with hash ${reachedHash}, but the pin holds ${pin.hash}`,
      { url, seq: pin.seq, held: pin.hash, seen: reachedHash },
    );
  }

  commit();
  return { versions, hops, tofu: false, contiguous, hash: tipHash };
}

/** The smallest legitimate anchor not below the pin — the furthest single jump available. */
function chooseSkipAnchor(current, pinSeq) {
  const skip = current._skip;
  if (!skip || typeof skip !== 'object') return null;
  const legitimate = new Set(skipAnchors(current.seq));
  const candidates = Object.keys(skip)
    // Only a canonical decimal key names a seq. `"0256"` and `"1e3"` parse to numbers whose
    // `String()` does not round-trip, so the hash lookup below would silently miss and the
    // failure would surface later as an unrelated `prev` mismatch.
    .filter((k) => String(Number(k)) === k)
    .map(Number)
    .filter((s) => Number.isInteger(s) && s >= pinSeq && s < current.seq && legitimate.has(s))
    .sort((a, b) => a - b);
  if (candidates.length === 0) return null;
  const seq = candidates[0];
  // A jump of one hop is the linear walk with extra steps, and it skips the continuity check.
  if (seq === current.seq - 1) return null;
  return { seq, hash: skip[String(seq)] };
}

/**
 * Land on a skip anchor and corroborate it.
 *
 * An anchor and a `prev` are two signed statements about one version's bytes. Checking only
 * the anchor lets a publisher aim a forged one at skipping readers alone; checking the
 * version immediately above it too means forging one anchor requires forging every version
 * above it, which is forging the whole chain.
 */
async function followSkipAnchor({ url, current, anchor, fetchVersion, policy, record }) {
  const versions = [];

  const above = await fetchVersion(url, anchor.seq + 1);
  assertVersionShape(above, derivedVersionUrl(url, anchor.seq + 1));
  if (above.seq !== anchor.seq + 1) {
    throw new ChainError(`${derivedVersionUrl(url, anchor.seq + 1)} is seq ${above.seq}`, { url, seq: above.seq });
  }
  if (above.prev !== anchor.hash) {
    throw new ChainError(
      `${url} seq ${current.seq} anchors seq ${anchor.seq} at ${anchor.hash}, but seq ${above.seq} names prev ${above.prev}`,
      { url, seq: anchor.seq },
    );
  }
  policy.verifySignature(above);
  record(above, documentHash(above));
  versions.push(above);

  const landed = await fetchVersion(url, anchor.seq);
  assertVersionShape(landed, derivedVersionUrl(url, anchor.seq));
  if (landed.seq !== anchor.seq) {
    throw new ChainError(`${derivedVersionUrl(url, anchor.seq)} is seq ${landed.seq}`, { url, seq: landed.seq });
  }
  const hash = documentHash(landed);
  if (hash !== anchor.hash) {
    throw new ChainError(
      `${url} anchors seq ${anchor.seq} at ${anchor.hash}, but that version hashes to ${hash}`,
      { url, seq: anchor.seq },
    );
  }
  policy.verifySignature(landed);
  policy.verifyContinuity(above, landed);
  record(landed, hash);
  versions.push(landed);

  return { versions, landed };
}

// ---- §5.5 fork resolution ----

/**
 * Verify a version's `_recovery_sig` array against the recovery keys and threshold committed
 * in a **pinned ancestor**.
 *
 * §4.5 is emphatic about where the threshold is read from: the pinned ancestor that commits
 * the keys, never the document making the claim. Otherwise a thief holding one key declares
 * a threshold of one and the mechanism defeats itself.
 *
 * `pinnedAncestor` MUST be the **most recent** version of the predecessor chain the caller has
 * verified, not any older one it retains (§4.5). A `PinStore` keeps observations at every
 * `seq` so a peer's older pin stays checkable, and reaching into that history here would undo
 * every revocation published since — a recovery key retired years ago would still count.
 *
 * Every co-signature is computed over the canonical document with **both** signature fields
 * removed, which `signingPayload` already does — so all co-signers sign identical bytes and
 * their order carries no meaning.
 */
export function verifyRecoverySignatures(doc, { pinnedAncestor }) {
  const threshold = Number.isInteger(pinnedAncestor?.recovery_threshold)
    ? pinnedAncestor.recovery_threshold
    : 1;
  if (threshold < 1) throw new ChainError(`recovery_threshold must be at least 1, got ${threshold}`);

  const identity = normalizeIdentityUrl(pinnedAncestor.url);
  const recoveryKeys = (pinnedAncestor.keys ?? []).filter((k) => k?.use === 'recovery');
  const entries = Array.isArray(doc._recovery_sig) ? doc._recovery_sig : [];
  const payload = signingPayload(doc);
  const when = doc.updated;

  const signers = new Set();
  const rejected = [];
  for (const entry of entries) {
    try {
      const { headerB64, header, signature } = parseDetachedSig(entry);
      const { identityUrl, keyId } = parseKid(header.kid);
      // Author binding holds for co-signatures too: every kid names *this* identity, even
      // when a relative holds the private half (§4.5).
      if (identityUrl !== identity) throw new VerifyError(`kid names ${identityUrl}, not ${identity}`);
      const jwk = recoveryKeys.find((k) => k.kid === keyId);
      if (!jwk) throw new VerifyError(`${keyId} is not a recovery key committed at seq ${pinnedAncestor.seq}`);
      if (typeof jwk.iat === 'number' && jwk.iat > when) throw new VerifyError(`${keyId} was issued after ${when}`);
      if (typeof jwk.revoked_at === 'number' && when > jwk.revoked_at) throw new VerifyError(`${keyId} was revoked`);
      if (!crypto.verify(null, signingInput(headerB64, payload), publicKeyFromJwk(jwk), signature)) {
        throw new VerifyError('signature does not verify');
      }
      // Distinct keys: k co-signatures by one key is one co-signature (§4.5).
      signers.add(keyId);
    } catch (e) {
      rejected.push(e.message);
    }
  }

  return { met: signers.size >= threshold, threshold, signers: [...signers], rejected };
}

/**
 * Pick the honest branch of a fork (§5.5).
 *
 * Equivocation detection reveals *that* a chain forked, not which branch is honest: after key
 * theft both branches carry valid continuity signatures. A thief of the online key cannot
 * produce recovery co-signatures, since recovery keys are offline, so the branch meeting the
 * pinned ancestor's threshold is preferred. A fork where neither branch does — or where both
 * do, which means the recovery keys themselves are compromised — is unresolvable and is
 * flagged for manual review rather than guessed at.
 */
export function resolveFork(branches, { pinnedAncestor }) {
  const assessed = branches.map((branch) => ({
    branch,
    recovery: verifyRecoverySignatures(branch, { pinnedAncestor }),
  }));
  const preferred = assessed.filter((a) => a.recovery.met);
  if (preferred.length === 1) {
    return { resolved: true, preferred: preferred[0].branch, assessed };
  }
  return {
    resolved: false,
    preferred: null,
    assessed,
    reason: preferred.length === 0
      ? 'no branch meets the recovery threshold committed in the pinned ancestor'
      : `${preferred.length} branches meet the threshold, so the recovery keys are themselves in question`,
  };
}
