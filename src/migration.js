// Migration (§3.4): *this identity continues over there*.
//
// §13.2 ends every adversary tier at the same place — what the protocol offers is **exit**, and
// exit is §3.4, §4.5, and §14 holding at once. `chain.js` already had the cryptography
// (`verifyRecoverySignature`, `resolveFork`) and `manifest.js` already had invariant 5, but
// nothing composed them, so the load-bearing claim was the one no consumer could act on.
//
// What is here is the composition and the *state* a consumer has to keep afterwards, which is
// the part §3.4 spends most of its length on. **Predecessor equivalence** is one named rule —
// "for a consumer that has verified the migration, the predecessor's identity and feed URLs are
// equivalent to the successor's own, transitively" — and its sites (§4.4, §7.5, §9, §9.3
// invariant 5, §10.2, §10.3) are consequences rather than independent rules. So this module
// holds the rule once and every site asks it, rather than six sites each reimplementing a
// URL comparison and drifting.
//
// Two of those sites deliberately need **no** state and are not served from here: inbox
// relevance (§10.2) and inbox dedup (§10.3) match on an item id's globally-unique half, because
// the state this module keeps is exactly the state whose failure window is the exit itself —
// in an uncooperative departure the predecessor may be unreachable afterwards, which is the
// reason you migrated. `inbox.js` matches ids; nothing there consults a MigrationStore.

import { normalizeIdentityUrl, VerifyError } from './jws.js';
import { documentHash } from './hash.js';
import { verifyRecoverySignature } from './chain.js';

export class MigrationError extends Error {
  constructor(message, { predecessor, successor } = {}) {
    super(message);
    this.name = new.target.name;
    this.predecessor = predecessor;
    this.successor = successor;
  }
}

/**
 * Two migrations claiming one predecessor (§3.4).
 *
 * Its own type because the required response is neither "reject" nor "accept": a recovery key
 * cannot sign a chain version (§5.2 step 3), so whoever steals one cannot take the identity in
 * place — what they can do is mint a *competing* successor at a URL they control, co-signed by
 * the same committed key, and both claims then verify identically. §3.4 is explicit that this
 * is unresolvable and that a consumer MUST NOT follow either without out-of-band confirmation.
 * A store that silently kept the first claim it saw would resolve it by arrival order, which is
 * to say by whichever URL a reader happened to find.
 */
export class CompetingMigrations extends MigrationError {
  constructor(predecessor, claims) {
    super(
      `${predecessor} is claimed by ${claims.length} migrations (${claims.map((c) => c.successor).join(', ')}): ` +
        'unresolvable without out-of-band confirmation (§3.4)',
      { predecessor },
    );
    this.claims = claims;
  }
}

const MAX_CHAIN = 32; // A lifetime of moves is a handful; this only bounds a malicious cycle.

/**
 * §4.5's recovery pin: `(url, seq, hash)` plus the keys committed there.
 *
 * Deliberately identity-document-shaped so `verifyDocument`, `findKey`, and
 * `verifyRecoverySignature` take it with no special case — a reduction, not a second type.
 * `feedUrls` live beside it in the chain record rather than in here, because they are a set
 * accumulated across versions while this is one version's key state.
 */
export function recoveryPin(document) {
  return {
    url: document.url,
    seq: document.seq,
    hash: documentHash(document),
    keys: Array.isArray(document.keys) ? document.keys.map((k) => ({ ...k })) : [],
  };
}

/**
 * Verify one migration link (§3.4). Returns a verdict rather than throwing, because "not a
 * migration" is the ordinary answer for most identity documents and not an error.
 *
 * Both documents MUST already have been verified and their chains walked by the caller — this
 * checks the *claim*, not the signatures. `pinnedAncestor` is the most recent version of the
 * predecessor chain the consumer has verified (§4.5's "not a free choice": reading recovery
 * state out of an older ancestor it happens to retain would undo every revocation published
 * since, so a key retired years ago would still verify).
 *
 * The two paths differ only in which key attests:
 *
 *  - **Cooperative** — the old identity published a `successor` and the new one carries a
 *    matching `predecessor`. Each link sits inside signed bytes, so the pair is a cryptographic
 *    cross-signature verifiable against the old identity's pinned chain.
 *  - **Recovery** — the old domain is gone or its host declines, so no `successor` is coming.
 *    The new document carries `_recovery_sig` by a recovery key committed in a pinned ancestor.
 */
export function verifyMigration({ predecessorDocument, successorDocument, pinnedAncestor } = {}) {
  const no = (reason) => ({ verified: false, via: null, reason });
  if (!successorDocument || typeof successorDocument !== 'object') return no('no successor document');

  let successor;
  let claimedPredecessor;
  try {
    successor = normalizeIdentityUrl(successorDocument.url);
    if (typeof successorDocument.predecessor !== 'string') {
      return no('the successor names no predecessor');
    }
    claimedPredecessor = normalizeIdentityUrl(successorDocument.predecessor);
  } catch (e) {
    if (e instanceof VerifyError) return no(e.message);
    throw e;
  }

  if (!predecessorDocument || typeof predecessorDocument !== 'object') {
    return no(`the predecessor ${claimedPredecessor} was not resolved`);
  }
  let predecessor;
  try {
    predecessor = normalizeIdentityUrl(predecessorDocument.url);
  } catch (e) {
    if (e instanceof VerifyError) return no(e.message);
    throw e;
  }
  if (predecessor !== claimedPredecessor) {
    return no(`the successor names ${claimedPredecessor}, but the document supplied is ${predecessor}`);
  }
  if (predecessor === successor) return no('an identity cannot succeed itself');

  // Path 2. §3.4: consumers follow `successor` when both links exist and agree. A claim in one
  // direction alone is not a migration — that is the rule's whole content.
  if (typeof predecessorDocument.successor === 'string') {
    let claimedSuccessor = null;
    try {
      claimedSuccessor = normalizeIdentityUrl(predecessorDocument.successor);
    } catch { /* an unparseable claim is simply not a matching one */ }
    if (claimedSuccessor === successor) {
      return { verified: true, via: 'cooperative', predecessor, successor, reason: null };
    }
    // The old side is advancing a *different* successor. §4.5 lets a verifier reject a
    // recovery-based migration while the original serves a conflicting chain, and this is that
    // case — surfaced by name rather than folded into "no valid co-signature".
    if (claimedSuccessor) {
      return {
        verified: false,
        via: null,
        predecessor,
        successor,
        conflicting: claimedSuccessor,
        reason: `${predecessor} advances its own successor ${claimedSuccessor}, contradicting this claim (§4.5)`,
      };
    }
  }

  // Path 3. The recovery co-signature, resolved in the predecessor's chain — never in the
  // document making the claim, which is the self-blessing §4.2 rules out.
  if (typeof successorDocument._recovery_sig !== 'string') {
    return no(
      `${predecessor} publishes no matching successor and ${successor} carries no recovery co-signature`,
    );
  }
  if (!pinnedAncestor) {
    // §3.4: a consumer with no prior pin of the old identity can only treat a recovery-based
    // migration as unverified. That is the honest answer, not a failure.
    return no('no verified version of the predecessor chain to resolve the recovery key against (§4.5)');
  }
  const co = verifyRecoverySignature(successorDocument, { pinnedAncestor });
  if (!co.valid) return no(`recovery co-signature does not verify: ${co.reason}`);
  return { verified: true, via: 'recovery', predecessor, successor, signer: co.signer, reason: null };
}

/**
 * What a consumer knows about who continued as whom, and which chains each identity owns.
 *
 * The chain inventory is not incidental to the migration record: §7.5's canonical exception
 * asks whether an item's `_openfeed.feed_url` names a feed of a *predecessor*, which a consumer can only
 * answer if it wrote down the predecessor's feeds while it could still read them. In an
 * uncooperative departure that is before the move, and there is no second chance.
 */
/** Identity chains retained in a `MigrationStore` before `compact` runs. */
export const MAX_TRACKED_CHAINS = 512;

export class MigrationStore {
  constructor({
    now = () => Math.floor(Date.now() / 1000),
    maxTrackedChains = MAX_TRACKED_CHAINS,
  } = {}) {
    this.now = now;
    this.maxTrackedChains = maxTrackedChains;
    this.chains = new Map();   // identity -> { feeds:Set, manifests:Set, identityDocument:string }
    this.forward = new Map();  // predecessor -> { successor, via, at }
    this.backward = new Map(); // successor -> predecessor
    this.contested = new Map(); // predecessor -> [{successor, via, at}, ...]
  }

  /**
   * Record the chains an identity owns, and retain the document itself, from a version the
   * caller has already verified.
   *
   * Called on every identity read rather than only at migration time, because the whole value
   * of the record is that it predates the event. `feeds` may legitimately vanish from a later
   * version (§3.2.1: delisting is archival, not deletion), so entries accumulate and are never
   * removed — §7.5's exception asks about a *predecessor's* feeds, which by then may be listed
   * nowhere a consumer can still reach.
   *
   * **A pin alone cannot do it, which is why anything is retained here at all.** §4.5's
   * co-signature resolves against the recovery keys committed at the pinned `(seq, hash)` — but
   * a pin is a `(seq, hash)` and the keys are in the *bytes*. A consumer holding only pins would
   * have to fetch that version from its derived URL to read them, and the case recovery exists
   * for is precisely the one where that fetch fails: the domain is gone. So it is recorded while
   * the predecessor is still readable, and there is no second chance.
   *
   * **What is recorded is a recovery pin, not the document.** §4.5 asks for `(url, seq, hash)`
   * plus the keys and the feed URLs, and that is all anything consumes: the recovery keys for
   * the co-signature, the *signing* keys because a migrated back catalog is signed by the
   * predecessor and §3.4 forbids re-signing it, and the feed URLs for §7.5's exception. The rest
   * of an identity document — profile, endpoints, extension fields, up to §13.4's 100 KB — is
   * dead weight held forever for every identity this consumer has ever read, and a hub polling a
   * few thousand members would carry hundreds of megabytes to answer a question a few kilobytes
   * answers. The reduction keeps the shape of an identity document precisely so every verifier
   * downstream takes it unchanged.
   */
  noteIdentity(document) {
    const identity = normalizeIdentityUrl(document.url);
    const held = this.chains.get(identity) ?? {
      feeds: new Set(),
      manifests: new Set(),
      identityDocument: `${identity}openfeed.json`,
      document: null,
    };
    for (const entry of Array.isArray(document.feeds) ? document.feeds : []) {
      if (typeof entry?.url === 'string') held.feeds.add(entry.url);
      if (typeof entry?.manifest === 'string') held.manifests.add(entry.manifest);
    }
    // §4.5's "not a free choice": the *most recent* version verified, never an older ancestor
    // still retained. Reading recovery state out of one would undo every revocation published
    // since, so a key retired and replaced years ago would still verify.
    if (!held.document || (document.seq ?? 0) >= (held.document.seq ?? 0)) {
      held.document = recoveryPin(document);
    }
    this.chains.set(identity, held);
    // Amortized at twice the cap, and retaining the identity just noted: `pinnedAncestorFor`
    // is read immediately after this call, so evicting it here would make the record depend on
    // whether the cap happened to be crossed on this read.
    if (this.chains.size > this.maxTrackedChains * 2) this.compact({ retain: [identity] });
    return held;
  }

  /**
   * Bound the chain inventory by dropping **whole identities**, and never a party to a migration.
   *
   * §13.4 sanctions the eviction; what it costs here is sharper than for a pin, because this
   * record's whole value is that it **predates the event** — it is written while the
   * predecessor is still readable, and §4.5 says outright there is no second chance. So the
   * rule is not "keep it long enough" (nothing here knows how long that is) but "never drop a
   * record something already refers to":
   *
   *  - Every party to a recorded migration — either side of `forward`, `backward`, or a
   *    `contested` claim — is retained. That record is what `verifyMigration` resolves a
   *    recovery co-signature against and what §7.5's canonical exception asks about, and it is
   *    unreconstructible once the predecessor's host is gone.
   *  - Identities the caller names in `retain`, since only the caller knows what it follows.
   *
   * Among the rest, the ones naming the fewest chains go first. A record listing no feeds and
   * no manifests answers §7.5's exception with nothing — it is an identity seen once as an item
   * author, which is exactly the class §13.4 describes — while one naming several is a
   * publisher this consumer has actually read.
   *
   * Returns the number of chains evicted.
   */
  compact({ max = this.maxTrackedChains, retain = [] } = {}) {
    if (this.chains.size <= max) return 0;
    const keep = new Set();
    for (const url of retain) keep.add(normalizeIdentityUrl(url));
    for (const [predecessor, held] of this.forward) {
      keep.add(normalizeIdentityUrl(predecessor));
      if (held?.successor) keep.add(normalizeIdentityUrl(held.successor));
    }
    for (const [successor, predecessor] of this.backward) {
      keep.add(normalizeIdentityUrl(successor));
      if (predecessor) keep.add(normalizeIdentityUrl(predecessor));
    }
    for (const [predecessor, claims] of this.contested) {
      keep.add(normalizeIdentityUrl(predecessor));
      for (const claim of claims ?? []) {
        if (claim?.successor) keep.add(normalizeIdentityUrl(claim.successor));
      }
    }
    const evictable = [...this.chains.entries()]
      .filter(([identity]) => !keep.has(identity))
      .sort(([aId, a], [bId, b]) =>
        (a.feeds.size + a.manifests.size) - (b.feeds.size + b.manifests.size)
          || (aId < bId ? -1 : aId > bId ? 1 : 0));
    let evicted = 0;
    for (const [identity] of evictable) {
      if (this.chains.size <= max) break;
      this.chains.delete(identity);
      evicted++;
    }
    return evicted;
  }

  /**
   * The most recent version of this identity's chain the consumer has verified — §4.5's
   * `pinnedAncestor`, and the only place a recovery co-signature may be resolved.
   */
  pinnedAncestorFor(identity) {
    return this.chains.get(normalizeIdentityUrl(identity))?.document ?? null;
  }

  /**
   * What kind of chained document a URL names — `'identity'`, `'manifest'`, or `null` for a
   * chain this consumer does not track.
   *
   * Answered out of the inventory this store already keeps, because the alternative is sniffing
   * the URL's spelling, and the spelling does not carry it. §3.2 fixes `openfeed.json` for an
   * identity document, but §3.2.1 constrains a `manifest` URL only to end in `.json` — so a
   * manifest may legitimately be served at a path ending `openfeed.json`, and a consumer
   * choosing a §13.4 size cap by suffix would cap it at the identity document's 100 KB. The
   * kind is a fact about a document's role in this consumer's records, exactly as §6.6 says the
   * document kind is a fact of the verification context and never of the bytes.
   */
  chainKind(url) {
    const wanted = String(url);
    for (const held of this.chains.values()) {
      if (held.identityDocument === wanted) return 'identity';
      if (held.manifests.has(wanted)) return 'manifest';
    }
    return null;
  }

  /**
   * Verify a migration and record it. Returns the verdict; throws only for a competing claim,
   * which is a state the consumer must not resolve on its own (§3.4).
   */
  record({ predecessorDocument, successorDocument, pinnedAncestor }) {
    const verdict = verifyMigration({ predecessorDocument, successorDocument, pinnedAncestor });
    if (!verdict.verified) return verdict;
    const { predecessor, successor, via } = verdict;

    const held = this.forward.get(predecessor);
    if (held && held.successor !== successor) {
      const claims = [held, { successor, via, at: this.now() }];
      this.contested.set(predecessor, claims);
      // Both claims are void until a human settles it. Keeping the first would resolve by
      // arrival order — which is to say, in the thief's favour as often as not.
      this.forward.delete(predecessor);
      this.backward.delete(held.successor);
      throw new CompetingMigrations(predecessor, claims);
    }
    if (this.contested.has(predecessor)) {
      throw new CompetingMigrations(predecessor, this.contested.get(predecessor));
    }

    this.forward.set(predecessor, { successor, via, at: this.now() });
    this.backward.set(successor, predecessor);
    if (predecessorDocument) this.noteIdentity(predecessorDocument);
    this.noteIdentity(successorDocument);
    return verdict;
  }

  /**
   * §3.4's "out-of-band confirmation", which the specification requires and which nothing here
   * could otherwise supply. Two recovery-based migrations claiming one predecessor verify
   * identically, so `record` voids both and keeps voiding them — correct, and a dead end
   * without a way for a human who has *checked* to say which one is real.
   *
   * Named for the decision rather than for the data structure, as `PinStore.rePin` is: this is
   * a person asserting something the protocol cannot, and a consumer should have to mean it.
   */
  settle(predecessor, successor) {
    const from = normalizeIdentityUrl(predecessor);
    const to = normalizeIdentityUrl(successor);
    const claims = this.contested.get(from);
    if (!claims) throw new MigrationError(`${from} has no contested migration to settle`);
    if (!claims.some((c) => c.successor === to)) {
      throw new MigrationError(`${to} is not one of the competing claims on ${from}`);
    }
    this.contested.delete(from);
    this.forward.set(from, { ...claims.find((c) => c.successor === to), settled: this.now() });
    this.backward.set(to, from);
    return this.forward.get(from);
  }

  isContested(identity) {
    return this.contested.has(normalizeIdentityUrl(identity));
  }

  successorOf(identity) {
    return this.forward.get(normalizeIdentityUrl(identity))?.successor ?? null;
  }

  predecessorOf(identity) {
    return this.backward.get(normalizeIdentityUrl(identity)) ?? null;
  }

  /**
   * The identity this one continues as, following verified migrations to the end.
   *
   * Transitive because §3.4 says so, and cycle-guarded because a `predecessor`/`successor` pair
   * is two publishers' claims about each other and two cooperating publishers can point them in
   * a ring. A ring is not an error worth a type — it is simply not a chain of continuations —
   * so the walk stops rather than throwing.
   */
  resolve(identity) {
    let at = normalizeIdentityUrl(identity);
    const seen = new Set([at]);
    for (let i = 0; i < MAX_CHAIN; i++) {
      const next = this.forward.get(at)?.successor;
      if (!next || seen.has(next)) return at;
      seen.add(next);
      at = next;
    }
    return at;
  }

  /** Every identity this one continues *from*, transitively — newest predecessor first. */
  ancestors(identity) {
    const out = [];
    let at = normalizeIdentityUrl(identity);
    const seen = new Set([at]);
    for (let i = 0; i < MAX_CHAIN; i++) {
      const prev = this.backward.get(at);
      if (!prev || seen.has(prev)) break;
      seen.add(prev);
      out.push(prev);
      at = prev;
    }
    return out;
  }

  /** §3.4's rule itself: two URLs naming one identity, across verified migrations. */
  equivalent(a, b) {
    return this.resolve(a) === this.resolve(b);
  }

  /**
   * §7.5's exception, as a set: the feed URLs of every transitive predecessor of this identity.
   *
   * An item whose signed `_openfeed.feed_url` names one of these is **canonical** at this identity's feed
   * despite the mismatch, because §3.4 requires a migrated back catalog to be republished
   * byte-verbatim — those items keep the old URL forever, and nothing can re-sign them.
   */
  predecessorFeedUrls(identity) {
    const out = new Set();
    for (const ancestor of this.ancestors(identity)) {
      for (const feed of this.chains.get(ancestor)?.feeds ?? []) out.add(feed);
    }
    return out;
  }

  /**
   * §3.4: "A verified migration retires the predecessor's chains." The consumer keeps its pins
   * on them as history — they are what a peer's older pin is checked against (§5.3.1, §16.1)
   * and what a recovery co-signature resolves in (§4.5) — but stops advancing them and stops
   * reading publication state out of them.
   *
   * Nothing above implies this. §5.3.1 is keyed on a document URL, so the predecessor's chain
   * continuing to advance is not equivocation, and a consumer that keeps walking it inherits
   * whatever the departed-from host says next — including tombstones over the whole back
   * catalog it no longer owns.
   */
  isRetired(identity) {
    return this.forward.has(normalizeIdentityUrl(identity));
  }

  /** Every chained-document URL belonging to a retired identity, for the pin layer to refuse. */
  retiredChainUrls() {
    const out = new Set();
    for (const predecessor of this.forward.keys()) {
      const held = this.chains.get(predecessor);
      out.add(held?.identityDocument ?? `${predecessor}openfeed.json`);
      for (const manifest of held?.manifests ?? []) out.add(manifest);
    }
    return out;
  }

  toJSON() {
    return {
      version: 1,
      chains: Object.fromEntries([...this.chains].map(([k, v]) => [k, {
        feeds: [...v.feeds],
        manifests: [...v.manifests],
        identityDocument: v.identityDocument,
        document: v.document,
      }])),
      forward: Object.fromEntries(this.forward),
      contested: Object.fromEntries(this.contested),
    };
  }

  static fromJSON(raw, options) {
    const store = new MigrationStore(options);
    if (!raw) return store;
    for (const [k, v] of Object.entries(raw.chains ?? {})) {
      store.chains.set(k, {
        feeds: new Set(v.feeds ?? []),
        manifests: new Set(v.manifests ?? []),
        identityDocument: v.identityDocument ?? `${k}openfeed.json`,
        document: v.document ?? null,
      });
    }
    for (const [predecessor, link] of Object.entries(raw.forward ?? {})) {
      store.forward.set(predecessor, link);
      store.backward.set(link.successor, predecessor);
    }
    for (const [k, v] of Object.entries(raw.contested ?? {})) store.contested.set(k, v);
    return store;
  }
}
