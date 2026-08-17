// The Level 1 consumer (§12): point it at an identity URL and it checks everything.
//
// Every rule this applies lives in another module — `fetch.js` opens the sockets, `chain.js`
// walks and pins, `manifest.js` reconciles, `jws.js` verifies. What is here is the *order*,
// and the order is where a verifier goes wrong: §12 makes pinning a MUST because a verifier
// that checks signatures and keeps no pin re-establishes trust at every fetch, and a host
// holding the signing key can then hand it any history it likes, forever, without forking
// anything. So the identity chain is walked and pinned before a feed is read, the manifest
// chain before its items are judged, and nothing is admitted from a chain that is frozen.
//
// Three rules nothing else in this repository exercises end to end land here:
//
//   §7.5  the canonical/copy test — an item is canonical only in the feed its `_feed_url`
//         names, and a copy is verifiable as *authored* while carrying no liveness at all
//   §4.4  the pull-path revocation analog — check revocation against when *you* first saw
//         the id committed by a signed manifest, not against what the item says about itself
//   §12   the transient-failure ladder — a fetch that failed once is not a rejection

import {
  createFetcher,
  identityDocumentUrl,
  ByteBudget,
  FetchError,
  HISTORY_BYTES_PER_UPDATE,
} from './fetch.js';
import {
  PinStore,
  walkToPin,
  derivedVersionUrl,
  derivedItemUrl,
  identityChainPolicy,
  manifestChainPolicy,
  verifyRecoverySignature,
  EquivocationError,
} from './chain.js';
import {
  assertManifestBinding,
  assertHistoryInvariants,
  assertRelocationCarriesForward,
  reconcileFeed,
  entryOf,
  LAG_CEILING_SECONDS,
  freshness,
} from './manifest.js';
import { verifyDocument, normalizeIdentityUrl, normalizeUrlForCompare, VerifyError } from './jws.js';
import { sha256, b64u, documentHash } from './hash.js';
import { MigrationStore, CompetingMigrations } from './migration.js';

export class ReaderError extends Error {
  constructor(message, { url, code = 'unreadable' } = {}) {
    super(message);
    this.name = 'ReaderError';
    this.url = url;
    this.code = code;
  }
}

/**
 * §4.4's pull-path receipt time: when this consumer **first observed** an item id committed by
 * a signed manifest. A thief can backdate an item's `date_published`; they cannot backdate when
 * somebody else's polling loop first saw a manifest commit to it.
 *
 * Two scoping rules from §4.4 are the entire value of the record, and both are easy to get
 * backwards:
 *
 *  - **Key on `(author, id)`, never `(feed_url, id)`.** A consumer that followed a predecessor
 *    across a migration (§3.4) keeps its earlier — and therefore stronger — observation. Key on
 *    the feed and the move silently resets every clock to the day of the migration.
 *  - **Only items canonical by the *ordinary* `_feed_url` test are checked against it.** An item
 *    canonical here only by §7.5's predecessor exception arrived byte-verbatim from a migration,
 *    so its signing necessarily predates that event and the self-reported check governs. That
 *    filter is applied by the caller; this store just refuses to invent a time it never saw.
 *
 * A consumer with no history for an identity falls back to the self-reported check throughout —
 * first contact is TOFU here as everywhere (§5.3).
 */
export class ObservationStore {
  constructor({ now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.now = now;
    this.firstSeen = new Map();      // `${author}\n${id}` -> unix seconds
    this.feedManifests = new Map();  // feed url -> { manifestUrl, manifest } (§9.3 invariant 5)
  }

  static #key(author, id) {
    return `${normalizeIdentityUrl(author)}\n${id}`;
  }

  /**
   * Record every id a verified manifest commits, and report which ones were **new**.
   *
   * First observation wins; a later commitment of the same id does not move it. The returned
   * set is what keeps the check honest on first contact: an id recorded a moment ago has no
   * observation *history*, and §4.4 is explicit that a consumer without history falls back to
   * the self-reported check. Skip that and a consumer meeting a feed for the first time rejects
   * every item ever signed by a since-revoked key — using a timestamp it invented itself.
   */
  recordManifest(author, manifest) {
    return this.recordIds(author, [...Object.keys(manifest.items ?? {}), ...Object.keys(manifest.deleted ?? {})]);
  }

  /**
   * Record ids under an author and report which were **new**. The generic half of
   * `recordManifest`, and the one a multi-author board needs: a manifest is keyed by the feed
   * *owner*, but §4.4's record is keyed by the item *author*, and a contributor's items can
   * only be recorded once an item has been read and its author is known.
   */
  recordIds(author, ids) {
    const at = this.now();
    const fresh = new Set();
    for (const id of ids) {
      const key = ObservationStore.#key(author, id);
      if (this.firstSeen.has(key)) continue;
      this.firstSeen.set(key, at);
      fresh.add(id);
    }
    return fresh;
  }

  /** `null` where there is no history — the caller falls back to the self-reported time. */
  firstObserved(author, id) {
    return this.firstSeen.get(ObservationStore.#key(author, id)) ?? null;
  }

  /**
   * §9.3 invariant 5: which manifest chain a feed was last committed by, and what it committed.
   *
   * "§5.3.1 is keyed on a document URL, so a *new* manifest URL is a new chain and a fresh
   * trust-on-first-observation — which would let a publisher discard content by renaming a
   * file." The invariant is checkable only against what a consumer *observed* before the
   * rename, so this is the observation, and a consumer that keeps none has nothing to carry
   * across and treats the new chain as ordinary first contact.
   *
   * Reduced to what the check reads — the `items` map and the shape fields around it — because
   * retaining a whole 1 MB manifest per feed forever, to answer a question about ids, is the
   * same trade §4.5's recovery pin declines.
   */
  /**
   * What `recordFeedManifest` would replace, without replacing it. The invariant-5 check MUST
   * run against this *before* the record is overwritten: write first and a violation that
   * throws is forgotten by its own detection — the next run compares the new chain against
   * itself and passes.
   */
  priorFeedManifest(feedUrl) {
    return this.feedManifests.get(feedUrl) ?? null;
  }

  recordFeedManifest(feedUrl, manifestUrl, manifest) {
    const previous = this.feedManifests.get(feedUrl) ?? null;
    this.feedManifests.set(feedUrl, {
      manifestUrl,
      manifest: {
        url: manifest.url,
        feed_url: manifest.feed_url,
        seq: manifest.seq,
        updated: manifest.updated,
        items: { ...manifest.items },
      },
    });
    return previous;
  }

  toJSON() {
    return {
      version: 1,
      firstSeen: Object.fromEntries(this.firstSeen),
      feedManifests: Object.fromEntries(this.feedManifests),
    };
  }

  static fromJSON(raw, options) {
    const store = new ObservationStore(options);
    if (!raw) return store;
    // Version 0 was a bare `{key: seconds}` map with no envelope. Read either, because a pin
    // file is exactly the state §12 makes conformance depend on, and silently starting over
    // looks identical to a verifier that is working.
    const legacy = raw.version === undefined;
    for (const [k, v] of Object.entries((legacy ? raw : raw.firstSeen) ?? {})) store.firstSeen.set(k, v);
    for (const [k, v] of Object.entries(raw.feedManifests ?? {})) store.feedManifests.set(k, v);
    return store;
  }
}

/**
 * A Level 1 reader.
 *
 * `pins` and `observations` are the persistent state, and a caller that supplies neither gets
 * §12's narrow exception rather than an error: a consumer with no persistent storage cannot
 * pin, is still useful, and MUST NOT be presented as providing the §13.2 guarantees. `read`
 * reports that as `tofu` on every result so the caller can say so out loud.
 */
export function createReader({
  fetcher = createFetcher(),
  pins = new PinStore(),
  observations = new ObservationStore(),
  migrations = new MigrationStore({ now: () => now() }),
  now = () => Math.floor(Date.now() / 1000),
  lagCeiling = LAG_CEILING_SECONDS,
  useSkipLinks = true,
  // §7.4: follow `next_url`. Bounded, because §13.4 budgets nothing for pagination and an
  // unbounded follow is a publisher-controlled fetch loop. Stopping early is not a failure —
  // it makes the read `partial`, which is the state that accuses nobody.
  maxPages = 10,
  // §7.6: how many committed-but-not-served ids to probe at their derived item URLs before
  // giving up. Zero disables probing entirely. The cap matters because a windowing publisher
  // can commit ten thousand items the reader is not holding, and probing all of them is a
  // fetch storm to answer a question nobody asked.
  maxItemProbes = 16,
  // §12 Level 1 SHOULD: cache identity documents for at most an hour. It reads like tuning and
  // is not, because of who pays. A family board (§7.1) carries items from several authors and
  // every one of them needs that author's own document to resolve a key — so without a cache
  // spanning reads, one poll of a thousand-item board is one fetch per distinct author, at every
  // author's origin, forever. The ceiling is what keeps it a cache rather than a second pin:
  // revocation has to become visible, and an hour is the bound §12 names.
  identityCacheSeconds = 3600,
  // §13.4's fan-out caps. The per-document caps bound what one fetch can cost; these bound what
  // one *document* can make a consumer fetch. A conformant 100 KB identity document can list
  // hundreds of feeds, and a single feed page can name a distinct author per item — each
  // costing an identity fetch, a chain walk, and a permanent pin. Without these, one hostile
  // document converts one read into thousands of fetches at attacker-chosen origins.
  maxFeedEntries = 20,
  maxAuthorResolutions = 50,
  identityCacheEntries = 256,
} = {}) {
  // author -> { document, at }. Deliberately not a pin store: this holds no verdict, and every
  // document taken from it has already been walked and pinned by the code that put it here.
  const identityCache = new Map();
  /**
   * §13.4's history budget: "the greater of 10 MB and 20× the current version's size", decoded.
   * It scales with the document because a fixed budget does not survive its own ceiling — a
   * skip jump costs two full versions, so a flat 10 MB against a 1 MB manifest reconnects a pin
   * about sixteen versions back.
   */
  const budgetFor = (bytes) => new ByteBudget(Math.max(HISTORY_BYTES_PER_UPDATE, 20 * bytes));

  /**
   * §12's transient-failure ladder — which is the fetcher's `NegativeCache`, already keyed to
   * the 1 h / 4 h / 24 h schedule §12 names and already consulted on every fetch. A second
   * ladder here would be a second answer to one question, and the two would drift.
   *
   * What this adds is the verdict a caller needs and a `FetchError` does not carry: whether the
   * failure is one to come back from (`transient`, `deferred`) or one §12 finally permits
   * rejecting on (`rejected`). Losing that distinction is how a consumer either hammers a dead
   * host or drops a live identity over one bad minute.
   */
  async function laddered(url, thunk) {
    try {
      return await thunk();
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      if (e.code === 'negatively_cached') {
        throw new ReaderError(e.message, { url, code: e.transient ? 'deferred' : 'rejected' });
      }
      if (e.transient) {
        throw new ReaderError(`${url} failed transiently: ${e.message}`, { url, code: 'transient' });
      }
      throw e;
    }
  }

  /**
   * §5.5: does the offered branch carry a valid recovery co-signature?
   *
   * Only the identity chain can answer yes — a manifest holds no keys, carries no
   * `_recovery_sig`, and its signer is resolved in an identity chain that was pinned before it
   * was read, so a manifest divergence is never the post-theft fork §5.5 adjudicates.
   *
   * The co-signature resolves in a **pinned ancestor** and never in the document making the
   * claim, which is the self-blessing §4.2 rules out. That is the retained recovery pin (§4.5),
   * and a consumer holding none cannot run this at all — which is the honest outcome, since
   * without one it has no committed recovery key to check against and §5.5's whole premise is
   * that the key was committed before the theft.
   */
  function resolveDivergence(url, tip) {
    if (typeof tip?._recovery_sig !== 'string' || typeof tip?.url !== 'string') return false;
    if (url !== identityDocumentUrl(tip.url)) return false;
    const ancestor = migrations.pinnedAncestorFor(tip.url);
    if (!ancestor) return false;
    return verifyRecoverySignature(tip, { pinnedAncestor: ancestor }).valid === true;
  }

  /**
   * `fetchVersion(url, seq)` over §5.4's derived URLs, charged against one walk's budget.
   * Returns `{ doc, bytes }` so the walk hashes the served bytes — already proven canonical by
   * the fetch layer (§6.3) — instead of re-canonicalizing every version it visits.
   */
  const versionFetcher = (kind, budget) => async (url, seq) => {
    const at = derivedVersionUrl(url, seq);
    const { doc, bytes } = await fetcher.fetchDocument(at, { kind, budget });
    return { doc, bytes };
  };

  /**
   * Walk a chain and either advance the pin or leave it exactly where it was.
   *
   * The refusal to advance on divergence is §5.3.1's "what follows surfacing": retain the pin,
   * accept no further version, keep rendering what was already verified. An equivocation
   * impeaches a chain's future, not the bytes already checked against it.
   */
  async function walkAndPin({ url, tip, kind, policy, tipBytes, validate }) {
    // §3.4: a verified migration **retires** the predecessor's chains. The pin is kept as
    // history — it is what a peer's older pin is checked against (§5.3.1, §16.1) and what a
    // recovery co-signature resolves in (§4.5) — but it stops advancing, and publication state
    // stops being read out of it. Nothing else implies this: §5.3.1 is keyed on a document URL,
    // so the departed-from host continuing to advance its chain is not equivocation, and a
    // consumer that kept walking would inherit whatever that host says next — including
    // tombstones over a back catalog it no longer owns.
    if (migrations.retiredChainUrls().has(url)) {
      throw new ReaderError(
        `${url} belongs to an identity that has migrated; its chain is retired and no longer advances (§3.4)`,
        { url, code: 'retired' },
      );
    }
    if (pins.isFrozen(url)) {
      throw new EquivocationError(`${url} is frozen by an unresolved divergence; a human must re-pin (§5.3.1)`, {
        url, seq: pins.frozen.get(url).seq, held: pins.frozen.get(url).held, seen: pins.frozen.get(url).seen,
      });
    }
    const budget = budgetFor(tipBytes.length);
    // A fork this walk resolved by §5.5, travelling with the result that produced it rather than
    // accumulating in reader-wide state. Preferring a branch is a consequential act even when
    // the specification asks for it, so it is reported — but two concurrent `read()` calls must
    // not be able to report each other's, and a caller using `readIdentity` directly must not
    // lose it into whichever `read()` happens to drain next.
    let forkResolved = null;
    let walk;
    try {
      walk = await walkToPin({
        url,
        tip,
        tipBytes,
        pin: pins.pin(url),
        fetchVersion: versionFetcher(kind, budget),
        policy,
        pins,
        useSkipLinks,
      });
    } catch (e) {
      // §5.3.1: "Run §5.5 resolution before treating a divergence as unresolved compromise."
      // A fork is what key theft looks like from outside — both branches carry valid continuity
      // signatures, so detection says *that* a chain forked and never *which* branch is honest.
      // §5.5 answers it with the one thing a thief of an online key cannot produce: a
      // co-signature by an offline recovery key committed in a pinned ancestor.
      if (!(e instanceof EquivocationError) || !resolveDivergence(url, tip)) throw e;
      // The tip's bytes are in hand and already proven canonical by the fetch layer, so hash
      // them once rather than re-canonicalizing the parsed value twice — which is the whole
      // reason `tipBytes` is threaded down here.
      const hash = b64u(sha256(tipBytes));
      pins.rePin(url, tip.seq, hash);
      forkResolved = { url, seq: tip.seq };
      walk = { versions: [tip], hops: 0, tofu: false, contiguous: true, hash };
    }
    // Everything the caller checks about the *contents* of the walked range runs here, before
    // the pin moves. §9.3 says an invariant violation is treated like chain equivocation, and
    // advancing through one would discard the only thing the next read could compare against —
    // the pin below the violation. A verifier that reports the violation and then re-pins past
    // it has detected an attack and destroyed its own evidence.
    validate?.(walk);
    pins.advance(url, tip.seq, walk.hash);
    return { ...walk, budget, forkResolved };
  }

  /**
   * §3.2 + §5.3. Fetch the identity document at its fixed path, connect it to the pin, pin it.
   *
   * The fixed path is why this takes an identity URL and not a document URL: §13.9 requires
   * fetching only the claimed author's conventional document, never an arbitrary URL out of a
   * `kid`, and the path convention makes that structural rather than a check anyone can forget.
   */
  async function readIdentity(rawIdentity, { verifyMigration = true } = {}) {
    const identity = normalizeIdentityUrl(rawIdentity);
    const url = identityDocumentUrl(identity);
    const fetched = await laddered(url, () =>
      fetcher.fetchIdentityDocument(identity, { budget: null }));
    const walk = await walkAndPin({
      url,
      tip: fetched.doc,
      kind: 'identity',
      policy: identityChainPolicy,
      tipBytes: fetched.bytes,
    });
    // Recorded only after the walk: the chains this identity owns and the version itself are
    // what §7.5's exception and §4.5's co-signature resolve against later, so an unverified
    // document has no business in that record.
    migrations.noteIdentity(fetched.doc);
    return {
      identity,
      url,
      document: fetched.doc,
      cors: fetched.cors,
      pin: pins.pin(url),
      tofu: walk.tofu,
      hops: walk.hops,
      forkResolved: walk.forkResolved,
      migration: verifyMigration ? await reconcileMigration(identity, fetched.doc) : null,
    };
  }

  /**
   * §3.4, from whichever end the consumer arrived at.
   *
   * A consumer meets a migration two ways and both must work, because the second is the one an
   * uncooperative departure produces. Reading the **successor** first, it finds `predecessor`
   * and has to reach backwards for the chain the co-signature resolves in — which it can only
   * do from a record it kept before the move. Reading the **predecessor** first, it finds
   * `successor` and follows forward, which needs a fetch it can make.
   *
   * Neither direction is attempted without something already trusted at the far end: a
   * successor's claim is checked against the predecessor version this consumer verified, never
   * against a fresh fetch of a document the claim itself points at.
   */
  async function reconcileMigration(identity, document) {
    try {
      if (typeof document.predecessor === 'string') {
        const predecessor = normalizeIdentityUrl(document.predecessor);
        // Only for a predecessor this consumer already tracks. A `predecessor` field is an
        // unverified claim by a document that may belong to anyone, so dereferencing an unknown
        // one would make every identity read a fetch-amplification oracle — the same rule §16.1
        // states for pins, for the same reason. A stranger's claim about a stranger is simply
        // not checkable, and §3.4 already says such a consumer sees only an unverified claim.
        if (!migrations.pinnedAncestorFor(predecessor)) {
          return {
            direction: 'from-successor',
            predecessor,
            verified: false,
            via: null,
            reason: 'no verified version of the predecessor chain to resolve the recovery key against (§4.5)',
          };
        }
        // The cooperative path needs the predecessor's *current* version — the `successor` link
        // was published after this consumer last read it, so the retained copy cannot carry it.
        // The recovery path needs the retained one, because in the domain-loss case there is
        // nothing left at the other end to fetch. So: try forward, fall back to what is held.
        let predecessorDocument = migrations.pinnedAncestorFor(predecessor);
        if (!migrations.isRetired(predecessor)) {
          try {
            predecessorDocument = (await readIdentity(predecessor, { verifyMigration: false })).document;
          } catch {
            // Unreachable, or its chain no longer connects. Says nothing about the claim —
            // §4.5 is explicit that a host declining to participate is not grounds for
            // rejection — so the recovery path takes over with the version already verified.
          }
        }
        const verdict = migrations.record({
          predecessorDocument,
          successorDocument: document,
          // §4.5's "not a free choice": the most recent version of the predecessor chain this
          // consumer has *verified*, which the refetch above may just have advanced.
          pinnedAncestor: migrations.pinnedAncestorFor(predecessor),
        });
        return { direction: 'from-successor', predecessor, ...verdict };
      }
      if (typeof document.successor === 'string') {
        const successor = normalizeIdentityUrl(document.successor);
        // Reading forward costs one fetch, and it is a fetch of a fixed-path document at a URL
        // named inside signed bytes this consumer just verified (§13.9). `verifyMigration:
        // false` stops the pair from chasing each other back and forth.
        const onward = await readIdentity(successor, { verifyMigration: false });
        const verdict = migrations.record({
          predecessorDocument: document,
          successorDocument: onward.document,
          pinnedAncestor: migrations.pinnedAncestorFor(identity),
        });
        return { direction: 'from-predecessor', successor, ...verdict };
      }
    } catch (e) {
      if (e instanceof CompetingMigrations) {
        // §3.4: unresolvable, and a consumer MUST NOT follow either without out-of-band
        // confirmation. Surfaced, never guessed at — the same shape as §5.5's unresolvable fork.
        return { direction: 'contested', verified: false, via: null, reason: e.message, claims: e.claims };
      }
      if (e instanceof ReaderError || e instanceof FetchError) {
        // The successor is unreachable. That says nothing about the claim, so it stays
        // unverified rather than becoming a finding against either party.
        return { direction: 'from-predecessor', verified: false, via: null, reason: e.message };
      }
      throw e;
    }
    return null;
  }

  /**
   * §9 + §9.1. Walk and pin a manifest chain, then check the invariants down the walked range.
   *
   * `contiguous` is not decoration. A skipping walk (§9.1.1) jumps over versions it never
   * fetched, so the pairwise invariant check has gaps in it — an id could have been added and
   * removed inside one without this consumer seeing either. `assertHistoryInvariants` is told
   * so rather than being handed the array and left to assume, which is exactly what §9.1.1
   * means by a skipping consumer being a weaker witness.
   */
  async function readManifest(manifestUrl, { identityDocument, feedUrl }) {
    const fetched = await laddered(manifestUrl, () =>
      fetcher.fetchDocument(manifestUrl, { kind: 'manifest' }));
    const manifest = fetched.doc;
    // The expected `feed_url` comes from the `feeds` entry that named this manifest, never from
    // the manifest itself — checking a document against its own claim checks nothing, and §9's
    // "one manifest never commits two feeds" is exactly what would slip through.
    assertManifestBinding(manifest, {
      identityUrl: normalizeIdentityUrl(identityDocument.url),
      feedUrl: feedUrl ?? manifest.feed_url,
    });
    const walk = await walkAndPin({
      url: manifestUrl,
      tip: manifest,
      kind: 'manifest',
      policy: manifestChainPolicy(identityDocument, { now }),
      tipBytes: fetched.bytes,
      validate: (walk) =>
        assertHistoryInvariants(walk.versions, { url: manifestUrl, contiguous: walk.contiguous }),
    });
    const firstSeenHere = observations.recordManifest(identityDocument.url, manifest);
    return {
      url: manifestUrl,
      manifest,
      cors: fetched.cors,
      pin: pins.pin(manifestUrl),
      tofu: walk.tofu,
      hops: walk.hops,
      contiguous: walk.contiguous,
      forkResolved: walk.forkResolved,
      firstSeenHere,
    };
  }

  /**
   * §7.1 + §6.5 + §7.5. Fetch a feed and verify every item in it.
   *
   * Items are returned **verbatim** — invariant 4 hashes the bytes as served, so a
   * re-serialized copy reconciles against nothing.
   *
   * The canonical/copy split is a classification, never a rejection. A copy is still verifiable
   * as *authored* by its signer; what it lacks is liveness and manifest standing (§7.5), and a
   * consumer that threw one away would be discarding the ingredient that lets a follower serve
   * a cached feed when its origin is down.
   */
  async function readFeed(feedUrl, { identityDocument, resolveIdentity, firstSeenHere = new Set(), owner, manifest = null, itemUrlsDeclared = false }) {
    const fetched = await laddered(feedUrl, () => fetcher.fetchDocument(feedUrl, { kind: 'feed' }));
    const feed = fetched.doc;
    if (!Array.isArray(feed?.items)) {
      throw new ReaderError(`${feedUrl} is not a JSON Feed: no items array`, { url: feedUrl, code: 'not_a_feed' });
    }

    // §7.4's `next_url`, followed under a bound. Two rules make this safe to do at all.
    //
    // Same origin, because `next_url` is unsigned like everything else at feed level (§7.5) —
    // whoever controls the serving path writes it, so an off-origin one is a stranger asking a
    // verifier to fetch a URL of their choosing (§13.9), and it is never needed: a feed's pages
    // are its publisher's own files.
    //
    // And bounded, because §13.4 budgets nothing here and an unbounded follow is a fetch loop
    // the publisher controls. Stopping early sets `partial`, which is the honest outcome — a
    // reader that has not seen the whole feed asserts nothing about what is missing from it.
    const pages = [feed];
    const visited = new Set([feedUrl]);
    let cursor = feed;
    let partial = false;
    while (typeof cursor.next_url === 'string') {
      if (pages.length >= maxPages) { partial = true; break; }
      let next;
      try {
        next = new URL(cursor.next_url, feedUrl).href;
      } catch { partial = true; break; }
      if (new URL(next).origin !== new URL(feedUrl).origin || visited.has(next)) { partial = true; break; }
      visited.add(next);
      const page = await laddered(next, () => fetcher.fetchDocument(next, { kind: 'feed' }));
      if (!Array.isArray(page.doc?.items)) { partial = true; break; }
      pages.push(page.doc);
      cursor = page.doc;
    }
    const allItems = pages.flatMap((p) => p.items);

    // §7.6: ask for the exact revisions the manifest commits and no page yielded. Probing is a
    // way of *reading more of the feed*, one item at a time, so anything it obtains joins the
    // list below and is verified exactly like a page item — the URL guarantees the bytes, never
    // the authorship, and §6.5 is still the only thing that says who wrote them.
    const probe = manifest
      ? await probeItems(feedUrl, manifest, new Set(allItems.map((i) => i?.id)), { declared: itemUrlsDeclared })
      : null;
    if (probe) allItems.push(...probe.obtained);

    const canonicalUrl = normalizeUrlForCompare(feedUrl);
    // §7.5's exception: "One mismatch is not a copy." Where an item's signed `_feed_url` names
    // a feed of a **predecessor** identity of the one owning this feed, and the consumer has
    // verified that migration, the item is canonical here — §3.4 requires a migrated back
    // catalog to be republished byte-verbatim, so those items keep the old URL forever and
    // nothing can re-sign them. Without this the reference verifier reads an entire migrated
    // back catalog as copies, excludes it from the manifest reconciliation, and then reports
    // every item of it as **withheld**: an accusation of hiding, aimed at the one act the
    // protocol exists to make possible.
    const inherited = new Set(
      [...migrations.predecessorFeedUrls(owner ?? identityDocument.url)]
        .map((u) => { try { return normalizeUrlForCompare(u); } catch { return null; } })
        .filter(Boolean),
    );

    const canonical = [];
    const copies = [];
    const rejected = [];
    const unhashedAttachments = [];
    // §13.4's fan-out cap: distinct author identities resolved for one feed read. Each
    // resolution is a fetch at an author-chosen origin, a chain walk, and a permanent pin, so
    // a hostile feed naming a fresh author per item converts one poll into an unbounded sweep.
    const resolvedAuthors = new Set();

    for (const item of allItems) {
      const author = String(item?.authors?.[0]?.url ?? '');
      let authorDocument = identityDocument;
      if (author && normalizeIdentityUrl(author) !== normalizeIdentityUrl(identityDocument.url)) {
        // A migrated back catalog is signed by the **predecessor** identity — §3.4 forbids
        // re-signing it, so `authors[0].url` names the identity that has since moved, and §6.6
        // resolves the key there. The consumer holds that document from before the move, which
        // is the only place it can come from once the old domain is gone.
        const retained = migrations.pinnedAncestorFor(author);
        if (retained && migrations.equivalent(author, owner ?? identityDocument.url)) {
          authorDocument = retained;
        } else if (!resolveIdentity) {
          // A multi-author feed (§7.1): every item names its own single author, so the key is
          // resolved in *that* identity's document, not the feed owner's. Without a resolver
          // the item is unverifiable rather than invalid — nothing about it is known to be wrong.
          rejected.push({ item, reason: `authored by ${author}, whose identity document was not resolved` });
          continue;
        } else {
          const key = normalizeIdentityUrl(author);
          if (!resolvedAuthors.has(key) && resolvedAuthors.size >= maxAuthorResolutions) {
            rejected.push({ item, reason: `authored by ${author}, past this read's cap of ${maxAuthorResolutions} distinct authors (§13.4)` });
            continue;
          }
          resolvedAuthors.add(key);
          try {
            authorDocument = (await resolveIdentity(author)).document;
          } catch (e) {
            rejected.push({ item, reason: `could not resolve ${author}: ${e.message}` });
            continue;
          }
        }
      }

      let declared = null;
      if (typeof item?._feed_url === 'string') {
        try { declared = normalizeUrlForCompare(item._feed_url); } catch { declared = null; }
      }
      // Three outcomes, not two. `own` is the ordinary test; `predecessor` is §7.5's exception
      // and is canonical but scoped differently below; `null` is a copy.
      const via = declared === canonicalUrl ? 'own' : (declared && inherited.has(declared) ? 'predecessor' : null);

      // §4.4: check revocation against first-observation time, under two scoping rules that
      // are the whole value of the record. Only items canonical by the **ordinary** `_feed_url`
      // test — one canonical here by §7.5's predecessor exception arrived byte-verbatim from a
      // migration, so its signing necessarily predates that event and the self-reported check
      // governs. And only ids this consumer observed on an *earlier* pass: an id first recorded
      // moments ago in this same read is a consumer with no history, which §4.4 sends back to
      // the self-reported check.
      //
      // The record is keyed on `(author, id)` and the manifest-time recording is keyed on the
      // feed *owner*, so on a multi-author board (§7.1) a contributor's items are recorded
      // here, at read time, when the author is first known — otherwise the lookup below misses
      // on every contributor forever and §4.4 silently degrades to the self-reported check.
      //
      // **The lookup happens now; the write waits for the signature** — §10.3's discipline,
      // here for the same reason and against a cheaper attack. Until `verifyDocument` returns,
      // this item's claim to be by this author is the *feed's* word: a board owner, or anyone
      // on the serving path, can drop in an unsigned item claiming `(victim, id)`. A store
      // written first would then record a first-observation time the victim never earned — and
      // that time is §4.4's whole defence, so planting an early one for an id a victim has not
      // published yet restores the backdating §4.4 exists to prevent. The forgery is rejected
      // either way, which is what makes the damage invisible: nothing is logged, and the store
      // is the only thing that changed. §13.9's sentence, about a different store.
      let observed = null;
      let recordUnder = null;
      if (via === 'own' && typeof item?.id === 'string' && !firstSeenHere.has(item.id)) {
        const authorUrl = authorDocument.url;
        // A contributor on someone else's board: the manifest recorded ids under the feed
        // *owner*, so this author's ids have never been recorded and must be, once verified.
        if (normalizeIdentityUrl(authorUrl) !== normalizeIdentityUrl(identityDocument.url)) {
          recordUnder = authorUrl;
        }
        // Either way the lookup is a read. `null` means no history, which §4.4 sends back to
        // the self-reported check — including for an id being recorded for the first time
        // below, since a record created a moment ago is not history.
        observed = observations.firstObserved(authorUrl, item.id);
      }

      try {
        const info = verifyDocument(item, {
          identityDocument: authorDocument,
          kind: 'item',
          ...(observed !== null ? { signedAt: observed } : {}),
        });
        if (recordUnder) observations.recordIds(recordUnder, [item.id]);
        (via ? canonical : copies).push({ item, info, via, revocationCheckedAt: observed ?? info.signedAt });
        unhashedAttachments.push(...unhashed(item));
      } catch (e) {
        if (!(e instanceof VerifyError)) throw e;
        rejected.push({ item, reason: e.message });
      }
    }

    return {
      url: feedUrl,
      feed,
      pages,
      cors: fetched.cors,
      canonical,
      copies,
      rejected,
      unhashedAttachments,
      partial,
      probe,
      nextUrl: cursor.next_url ?? null,
    };
  }

  /**
   * §7.6: ask for the exact revisions the manifest commits and the feed did not yield.
   *
   * The control probe is what makes this usable without a capability flag, and without it the
   * whole mechanism inverts. A publisher that simply does not implement §7.6 answers `404` to
   * every derived item URL, so probing would report its entire back catalog as withheld — the
   * same false accusation, arrived at by a new route. So: probe one revision the feed **did**
   * yield first. If that fails, this publisher offers no item URLs and nothing here is
   * evidence of anything; if it succeeds, a `404` on another item is the publisher declining to
   * serve bytes it commits, at a URL whose whole content is that one item.
   *
   * A returned body is checked against the hash that named it before it counts as obtained.
   * That check needs no signature, no manifest lookup, and no identity: the URL *is* the hash.
   */
  async function probeItems(feedUrl, manifest, servedIds, { declared = false } = {}) {
    const idle = { unobtainable: new Set(), obtained: [], offered: false, probed: 0, missing: 0 };
    if (maxItemProbes <= 0) return idle;

    const missing = Object.keys(manifest.items).filter((id) => !servedIds.has(id));
    if (missing.length === 0) return idle;

    const control = Object.keys(manifest.items).find((id) => servedIds.has(id));
    const controlServed = !!control && !!await fetchItem(feedUrl, manifest.items, control);
    // §3.2.1's `items: true`, and this is the case the declaration exists for. Without it a
    // failed control probe is ambiguous — a static host that never heard of §7.6 and a hostile
    // one that 404s the tree on purpose look identical — so the reader gives the benefit of the
    // doubt and stops, which would otherwise hand the adversary an off switch for §9.3's only
    // pull-path verdict. With it, the publisher has signed a statement that these revisions are
    // individually addressable, so a refusal below is not an unexplained absence.
    if (!controlServed && !declared) return idle;

    // The declaration decides whose absence is *accusable*, never which requests were made:
    // §9.3 scopes withholding to bytes this consumer actually asked for, so even against a
    // declaring publisher whose control failed, every id marked unobtainable below was refused
    // at its own URL — not presumed refused because a sibling was.
    const unobtainable = new Set();
    const obtained = [];
    for (const id of missing.slice(0, maxItemProbes)) {
      const got = await fetchItem(feedUrl, manifest.items, id);
      if (got) obtained.push(got);
      else unobtainable.add(id);
    }
    return {
      unobtainable, obtained, offered: true,
      ...(controlServed ? {} : { declined: true }),
      probed: Math.min(missing.length, maxItemProbes), missing: missing.length,
    };
  }

  /**
   * One item at its §7.6 URL, or `null`.
   *
   * The returned body is checked against the hash that named it before it counts as obtained,
   * and that check needs no signature, no manifest lookup, and no identity document: the URL
   * *is* the hash. What it does not establish is authorship, which is why the caller puts the
   * result through the same §6.5 pass as anything read out of a page.
   */
  async function fetchItem(feedUrl, map, id) {
    // Read through `manifest.js`'s own accessor, so there is one answer to "what is an entry".
    const hash = entryOf(map, id)?.hash;
    let url;
    try { url = derivedItemUrl(feedUrl, hash); } catch { return null; }
    try {
      // §7.6: "The body MUST be byte-identical to the bytes the manifest commits", and this is
      // the one place an item has a byte range of its own. `requireCanonical` enforces the
      // arrival half, and the hash is computed over the served bytes — comparing a
      // re-canonicalization instead is exactly the weaker check §7.6 says this replaces, since
      // it would silently pass a body this parser reads differently than the publisher wrote.
      const got = await fetcher.fetchDocument(url, { kind: 'json', requireCanonical: true });
      return b64u(sha256(got.bytes)) === hash ? got.doc : null;
    } catch {
      return null;
    }
  }

  /**
   * §7.4: every attachment entry MUST carry `_sha256`, and a consumer MUST treat one lacking it
   * as unverified content (§10.5) rather than as part of the signed record.
   *
   * This is the whole of the check, and it is worth being clear about why so little buys so
   * much. An attachment's *metadata* — the URL, the type, the alt text — is inside the signed
   * bytes; the bytes it points at are not. So for a media-first deployment an attachment
   * without `_sha256` is the largest integrity gap available: whoever controls those bytes,
   * the host included, swaps the photo under a signed item and no signature notices. §13.2
   * claims full integrity against a serving-path compromise, and that claim holds only for
   * what the signature covers.
   *
   * Fetching the bytes to *confirm* a hash is a separate and much more expensive act — §13.4
   * budgets nothing for it — so it is not done here. Classifying costs one field lookup and is
   * what tells a client which attachments it may present as part of the record.
   */
  function unhashed(item) {
    const attachments = item?.attachments;
    if (!Array.isArray(attachments)) return [];
    return attachments
      .filter((a) => typeof a?._sha256 !== 'string' || a._sha256.length === 0)
      .map((a) => ({ id: item.id, url: typeof a?.url === 'string' ? a.url : null }));
  }

  /**
   * One `feeds` entry: its manifest chain, its feed, and the reconciliation between them.
   *
   * The order inside is the whole point — manifest before feed, because the manifest is what an
   * item is judged against, what supplies §4.4's first-observation time, and (since §7.6) the
   * list of exact revisions a reader may ask for by name.
   */
  async function readOneFeed(identity, entry) {
    const manifest = await readManifest(entry.manifest, {
      identityDocument: identity.document,
      feedUrl: entry.url,
    });

    // §9.3 invariant 5, and it has to be checked *here* because nothing else can see it. A new
    // manifest URL is a new chain, so it gets a fresh pin and a fresh trust-on-first-observation
    // — every check inside `readManifest` passes, and a publisher that renamed the file to shed
    // content produces no fork, no tombstone, and nothing for a pinned consumer to notice. The
    // only evidence is what this consumer observed under the *old* URL — which is why the check
    // runs **before** the record is overwritten: a violation throws, and a store already
    // updated would compare the new chain against itself on the next run and pass, the exact
    // report-then-destroy-the-evidence failure `walkAndPin` refuses for pins.
    const previous = observations.priorFeedManifest(entry.url);
    if (previous && previous.manifestUrl !== entry.manifest) {
      assertRelocationCarriesForward(previous.manifest, manifest.manifest, {
        fromUrl: previous.manifestUrl,
        toUrl: entry.manifest,
      });
    }
    observations.recordFeedManifest(entry.url, entry.manifest, manifest.manifest);
    const feed = await readFeed(entry.url, {
      identityDocument: identity.document,
      firstSeenHere: manifest.firstSeenHere,
      owner: identity.identity,
      manifest: manifest.manifest,
      // §3.2.1 / §7.6. Read out of the *signed* identity document, never out of the feed or a
      // header: it is the publisher's own statement that this feed's revisions are individually
      // addressable, and a statement taken from anywhere the serving path can write is a
      // statement the serving path can withdraw.
      itemUrlsDeclared: entry.items === true,
      // §7.1: a feed MAY contain items from multiple authors — a family board — since every item
      // is independently signed and attributed by its own single-entry `authors`. Without a
      // resolver every such item is unverifiable, which reads as a defect in an ordinary
      // arrangement the specification explicitly permits. One fetch per distinct author,
      // memoized for the read, of that author's own fixed-path document (§13.9).
      resolveIdentity: cachedIdentity,
    });

    // §9.3's withholding verdict is scoped to bytes this consumer actually tried to obtain, and
    // there are exactly two ways to have tried. Following `next_url` to its end is one, and
    // `partial` says whether that happened. Asking for a specific revision at its §7.6 URL is
    // the other, and it is the one that works against a publisher serving a window: `probe`
    // returns only ids whose own URL declined to yield them, on an origin that either
    // demonstrably serves item URLs or signed a declaration that it does (§3.2.1).
    const reconciled = reconcileFeed(manifest.manifest, feed.canonical.map((c) => c.item), {
      now: now(),
      ceiling: lagCeiling,
      url: entry.url,
      partial: feed.partial,
      unobtainable: feed.probe?.unobtainable ?? new Set(),
    });
    const byState = (state) => reconciled.states.filter((s) => s.state === state);
    // §9.1.2, and it is deliberately computed here rather than inside `readManifest`: a chain
    // that has stopped advancing is not a fact about the walk, which succeeds, but about the
    // clock — so it is recomputed on every read against `now()` and never cached with the pin.
    const stale = freshness(manifest.manifest, { now: now(), ceiling: lagCeiling });

    return {
      entry,
      manifest,
      feed,
      reconciled,
      stale,
      byState,
      items: {
        live: byState('live'),
        deleted: byState('deleted'),
        pending: byState('pending'),
        withheld: byState('withheld'),
        absent: byState('absent'),
        copies: feed.copies,
      },
      findings: [
        ...reconciled.violations.map((v) => ({ kind: 'invariant', invariant: v.invariant, message: v.message })),
        // §9.1.2. A separate kind from `invariant` on purpose: staleness is unverified, not
        // equivocation, and collapsing the two would have an honest publisher's holiday read
        // like an attack. It is listed first among the non-violations because it colors every
        // verdict below it — a chain nobody has advanced in months is one whose `live` set is a
        // statement about the past.
        ...(stale ? [{
          kind: 'stale',
          message: `${stale.url}: manifest seq ${stale.seq} undertook to advance by ${stale.deadline}${stale.declared ? ' (declared)' : ' (this reader\'s ceiling)'} and has not; ${Math.floor(stale.overdueSeconds / 86400)} day(s) overdue`,
        }] : []),
        ...byState('withheld').map((s) => ({ kind: 'withheld', id: s.id, message: `${s.id}: ${s.reason}` })),
        ...feed.rejected.map((r) => ({ kind: 'unverifiable', id: r.item?.id, message: r.reason })),
        // §7.4: the signature covers the reference, never the bytes. An attachment with no
        // `_sha256` is unverified content (§10.5) inside an otherwise-verified item, which is
        // the one finding a client cannot derive from the item's own verdict.
        ...feed.unhashedAttachments.map((a) => ({
          kind: 'unhashed_attachment',
          id: a.id,
          message: `${a.id}: attachment ${a.url ?? '(no url)'} carries no _sha256, so its bytes are unverified (§7.4)`,
        })),
      ],
    };
  }

  /**
   * §12's positive identity-document cache, shared across reads rather than scoped to one.
   *
   * The entry is discarded once it is older than the ceiling, so a revocation published after it
   * was stored becomes visible within the hour §12 allows. A caller wanting none passes
   * `identityCacheSeconds: 0`.
   */
  async function cachedIdentity(author) {
    const key = normalizeIdentityUrl(author);
    const held = identityCache.get(key);
    if (held && now() - held.at < identityCacheSeconds) return held.result;
    const result = await readIdentity(key, { verifyMigration: false });
    // Bounded (§13.4): the keys arrive from other people's feeds, so an unbounded map is a
    // memory lever a hostile feed pulls one author at a time. Insertion-order eviction is
    // enough — an evicted entry costs one refetch, exactly as expiry does.
    identityCache.delete(key);
    identityCache.set(key, { result, at: now() });
    while (identityCache.size > identityCacheEntries) {
      identityCache.delete(identityCache.keys().next().value);
    }
    return result;
  }

  /**
   * §16.1: resolve one pin entry carried on a peer's item against this consumer's own records.
   *
   * "An entry is a claim, never an observation." So nothing here writes the store on the
   * entry's word: an `untracked` chain is ignored outright (dereferencing it would make every
   * inbox a fetch-amplification oracle, §13.9), a matching entry corroborates, and a
   * *disagreeing* entry at a seq this consumer can check is a reason to fetch that seq from
   * its derived URL — what the consumer then holds is its **own** observation, and §5.3.1
   * applies to that. An `EquivocationError` thrown from here is the compare rule firing on
   * evidence a peer's pin led this consumer to collect, which is the entire point of §16.1.
   *
   * An entry naming a seq **above** the consumer's pin is the recovery-propagation signal
   * (§16.1 property 2): the answer is a fresh `read()` — a walk that anchors — never an
   * observation recorded off one fetch, which is the same buffered-commit discipline the walk
   * itself keeps (§5.3.1).
   */
  async function resolvePeerPin(entry) {
    const { url, seq, hash } = entry ?? {};
    if (typeof url !== 'string' || !Number.isInteger(seq) || seq < 1 || typeof hash !== 'string') {
      return { verdict: 'malformed', resolved: false };
    }
    const local = pins.reconcilePeerPin(url, seq, hash);
    if (local.verdict === 'untracked' || local.verdict === 'corroborates') {
      return { ...local, resolved: local.verdict === 'corroborates' };
    }
    const pin = pins.pin(url);
    if (local.verdict === 'unknown' && (!pin || seq > pin.seq)) {
      return { ...local, resolved: false, rewalk: true };
    }
    // The two gates `walkAndPin` applies before it touches the network, for the same reasons.
    // A **retired** chain is one a verified migration stopped advancing (§3.4), so fetching it
    // reads publication state out of the very chain that rule retires — and a departed-from host
    // would get to answer. A **frozen** chain is one §5.3.1 already caught equivocating, where
    // the stated response is to accept no further version until a human re-pins; observing more
    // of it is collecting evidence for a verdict already reached. Without these, this path is a
    // way to keep feeding a store the walk itself refuses to feed.
    if (migrations.retiredChainUrls().has(url)) {
      return { ...local, resolved: false, verdict: 'retired' };
    }
    if (pins.isFrozen(url)) {
      return { ...local, resolved: false, verdict: 'frozen' };
    }
    // The kind selects a §13.4 size cap, and it is taken from the chain's *role* in this
    // consumer's own records rather than sniffed from the URL's spelling — §3.2.1 constrains a
    // manifest URL only to end in `.json`, so the suffix does not carry it. `untracked` was
    // already returned above, so a chain that reaches here is one this consumer walked and can
    // classify; `?? 'manifest'` is the conservative default, since the manifest cap is larger
    // and misclassifying downward would reject a legitimate document.
    const kind = migrations.chainKind(url) ?? 'manifest';
    const derived = derivedVersionUrl(url, seq);
    // The ladder is keyed on the URL actually fetched, not on the chain it belongs to, or a
    // failing derived version poisons the backoff state of the tip and vice versa.
    const got = await laddered(derived, () => fetcher.fetchDocument(derived, { kind }));
    const observedHash = b64u(sha256(got.bytes));
    // Fires §5.3.1 where this contradicts what the store holds — equivocation, frozen chain —
    // and otherwise records an ordinary observation of a version this consumer had not fetched.
    pins.observe(url, seq, observedHash, { provenance: 'peer-pin resolution (§16.1)' });
    return {
      verdict: observedHash === hash ? 'witness_confirmed' : 'witness_refuted',
      held: observedHash,
      seq,
      resolved: true,
    };
  }

  /**
   * The whole Level 1 pipeline over one identity.
   *
   * Order matters and is the reason this function exists: identity chain first, because the
   * manifest's signing key is resolved in it; manifest before items, because the manifest is
   * what an item is judged against and what supplies §4.4's first-observation time.
   */
  async function read(rawIdentity, { rel = 'primary', followMigrations = true, followed = [] } = {}) {
    // §3.4: "Consumers follow `successor`." Asked *before* the read, because a retired chain is
    // one this consumer has already stopped advancing — walking it to discover what it already
    // knows would be reading publication state out of the very chain the rule retires, and the
    // walk would refuse anyway. Asked of the store rather than of a verdict, because arriving
    // at the *successor* verifies a migration too and its verdict names a successor — itself.
    const known = migrations.resolve(rawIdentity);
    if (followMigrations && known !== normalizeIdentityUrl(rawIdentity)) {
      if (followed.length >= 8) {
        throw new ReaderError(`${rawIdentity} migrates through more than 8 hops`, {
          url: rawIdentity, code: 'migration_loop',
        });
      }
      return read(known, { rel, followMigrations, followed: [...followed, normalizeIdentityUrl(rawIdentity)] });
    }

    const identity = await readIdentity(rawIdentity);

    // The same question again, because *this* read may be what discovered the move: an identity
    // whose document carries `successor` and whose predecessor half now verifies.
    const continues = migrations.resolve(identity.identity);
    if (followMigrations && continues !== identity.identity) {
      if (followed.length >= 8) {
        throw new ReaderError(`${identity.identity} migrates through more than 8 hops`, {
          url: identity.url, code: 'migration_loop',
        });
      }
      return read(continues, { rel, followMigrations, followed: [...followed, identity.identity] });
    }
    const entries = Array.isArray(identity.document.feeds) ? identity.document.feeds : [];
    const entry = entries.find((f) => (f?.rel ?? 'primary') === rel) ?? entries[0] ?? null;
    if (!entry) {
      throw new ReaderError(`${identity.identity} lists no feeds (§3.2.1)`, {
        url: identity.url, code: 'no_feed',
      });
    }

    // §3.2.1: "a consumer wanting the whole catalog reads every entry." Reading only the
    // `primary` one makes a publisher that took §9.2's advice — rotate to a new feed and leave
    // the old listed as `rel: "archive"` — invisible from the moment they rotate, which is the
    // wrong reward for following the one growth strategy the spec recommends. Each entry is its
    // own feed with its own manifest chain and its own pin (§3.2.1: "one manifest never commits
    // two feeds"), so this is the same pipeline run N times, not a new one.
    //
    // The named `rel` entry stays the headline result, because a caller that asked for one
    // identity is usually asking "what is this person publishing now".
    const listed = entries.filter((f) => f && f !== entry && typeof f.url === 'string');
    // §13.4's fan-out cap: `feeds` entries processed per read. Each entry is a manifest chain
    // walk plus a feed read, so a document listing hundreds converts one read into an
    // unbounded sweep. Entries past the cap are reported, not silently dropped.
    const others = listed.slice(0, Math.max(0, maxFeedEntries - 1));
    const skippedEntries = listed.slice(others.length);
    const primary = await readOneFeed(identity, entry);
    const rest = [];
    for (const other of others) {
      try {
        rest.push(await readOneFeed(identity, other));
      } catch (e) {
        // One unreadable archive does not make an identity unreadable. The finding says which.
        rest.push({ entry: other, error: e });
      }
    }

    const { manifest, feed, reconciled, byState } = primary;
    return {
      identity,
      manifest,
      feed,
      entry,
      // Every entry in `feeds`, the headline one first, each with its own manifest, pin, and
      // item states. A caller wanting the whole catalog reads this rather than `items`.
      feeds: [primary, ...rest],
      items: {
        live: byState('live'),
        deleted: byState('deleted'),
        pending: byState('pending'),
        withheld: byState('withheld'),
        absent: byState('absent'),
        copies: feed.copies,
      },
      findings: [
        ...primary.findings,
        ...rest.flatMap((r) => (r.error
          ? [{ kind: 'unreadable_feed', message: `${r.entry.url} (rel ${r.entry.rel ?? 'primary'}): ${r.error.message}` }]
          : r.findings)),
        ...skippedEntries.map((f) => ({
          kind: 'unread_feed',
          message: `${f.url} (rel ${f.rel ?? 'primary'}) was not read: past this read's cap of ${maxFeedEntries} feeds entries (§13.4)`,
        })),
        // Gathered from the results that produced them, never from reader-wide state. An
        // earlier shape accumulated these in a closure and drained it here with `.splice(0)`,
        // which is correct for exactly one read at a time: two concurrent `read()` calls steal
        // each other's findings, and a caller using `readIdentity` or `readManifest` directly
        // loses its own into whichever `read()` drains next. A finding about one chain belongs
        // to the walk of that chain.
        ...[identity.forkResolved, ...[primary, ...rest].map((r) => r?.manifest?.forkResolved)]
          .filter(Boolean)
          .map((f) => ({
            kind: 'fork_resolved',
            message: `${f.url} forked at seq ${f.seq}; §5.5 preferred the branch carrying a valid recovery co-signature`,
          })),
        ...(identity.cors ? [] : [{ kind: 'conformance', message: `${identity.url} is served without Access-Control-Allow-Origin: * (§3.3)` }]),
        // A migration claim that did not verify is a finding rather than a failure: §3.4 says a
        // consumer with no prior pin of the old identity can only treat one as unverified, and
        // a contested pair is unresolvable by design. Either way the reader says so instead of
        // picking.
        ...(identity.migration && !identity.migration.verified
          ? [{ kind: 'migration', message: `unverified migration claim: ${identity.migration.reason}` }]
          : []),
      ],
      migration: identity.migration,
      // The identities walked through to get here, oldest first. Empty for the ordinary read;
      // a caller that asked for one URL and got another's content is entitled to know.
      followed,
      tofu: identity.tofu || manifest.tofu,
    };
  }

  return { readIdentity, readManifest, readFeed, read, resolvePeerPin, pins, observations, migrations, fetcher };
}


// §7.5's comparison for feed and manifest URLs lives in jws.js beside §3.1's identity
// normalizer — one comparator for the reader and the inbox both. Re-exported here because this
// module is where its callers historically found it.
export { normalizeUrlForCompare } from './jws.js';
