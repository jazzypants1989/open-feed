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
 * asks whether an item's `_feed_url` names a feed of a *predecessor*, which a consumer can only
 * answer if it wrote down the predecessor's feeds while it could still read them. In an
 * uncooperative departure that is before the move, and there is no second chance.
 */
export class MigrationStore {
  constructor({ now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.now = now;
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
   * **Retaining the document, not just its pin, is what makes recovery work at all.** §4.5 says
   * "any consumer holding a pin can verify a later recovery-based migration against the recovery
   * keys present at that pinned `(seq, hash)`" — but a pin is a `(seq, hash)` and the recovery
   * key is in the *bytes*. A consumer that stored only pins would have to fetch the pinned
   * version from its derived URL to read the key, and the case recovery exists for is precisely
   * the one where that fetch fails: the domain is gone. So the bytes are kept when they can be,
   * which is while the predecessor is still readable, and there is no second chance.
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
    if (!held.document || (document.seq ?? 0) >= (held.document.seq ?? 0)) held.document = document;
    this.chains.set(identity, held);
    return held;
  }

  /**
   * The most recent version of this identity's chain the consumer has verified — §4.5's
   * `pinnedAncestor`, and the only place a recovery co-signature may be resolved.
   */
  pinnedAncestorFor(identity) {
    return this.chains.get(normalizeIdentityUrl(identity))?.document ?? null;
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
   * An item whose signed `_feed_url` names one of these is **canonical** at this identity's feed
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
