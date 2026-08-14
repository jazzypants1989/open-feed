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
  identityChainPolicy,
  manifestChainPolicy,
  EquivocationError,
} from './chain.js';
import {
  assertManifestBinding,
  assertHistoryInvariants,
  reconcileFeed,
  LAG_CEILING_SECONDS,
} from './manifest.js';
import { verifyDocument, normalizeIdentityUrl, VerifyError } from './jws.js';

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
    this.firstSeen = new Map(); // `${author}\n${id}` -> unix seconds
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
    const ids = [...Object.keys(manifest.items ?? {}), ...Object.keys(manifest.deleted ?? {})];
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

  toJSON() {
    return Object.fromEntries(this.firstSeen);
  }

  static fromJSON(raw, options) {
    const store = new ObservationStore(options);
    for (const [k, v] of Object.entries(raw ?? {})) store.firstSeen.set(k, v);
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
  now = () => Math.floor(Date.now() / 1000),
  lagCeiling = LAG_CEILING_SECONDS,
  useSkipLinks = true,
} = {}) {
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

  /** `fetchVersion(url, seq)` over §5.4's derived URLs, charged against one walk's budget. */
  const versionFetcher = (kind, budget) => async (url, seq) => {
    const at = derivedVersionUrl(url, seq);
    const { doc } = await fetcher.fetchDocument(at, { kind, budget });
    return doc;
  };

  /**
   * Walk a chain and either advance the pin or leave it exactly where it was.
   *
   * The refusal to advance on divergence is §5.3.1's "what follows surfacing": retain the pin,
   * accept no further version, keep rendering what was already verified. An equivocation
   * impeaches a chain's future, not the bytes already checked against it.
   */
  async function walkAndPin({ url, tip, kind, policy, bytes, validate }) {
    if (pins.isFrozen(url)) {
      throw new EquivocationError(`${url} is frozen by an unresolved divergence; a human must re-pin (§5.3.1)`, {
        url, seq: pins.frozen.get(url).seq, held: pins.frozen.get(url).held, seen: pins.frozen.get(url).seen,
      });
    }
    const budget = budgetFor(bytes);
    const walk = await walkToPin({
      url,
      tip,
      pin: pins.pin(url),
      fetchVersion: versionFetcher(kind, budget),
      policy,
      pins,
      useSkipLinks,
    });
    // Everything the caller checks about the *contents* of the walked range runs here, before
    // the pin moves. §9.3 says an invariant violation is treated like chain equivocation, and
    // advancing through one would discard the only thing the next read could compare against —
    // the pin below the violation. A verifier that reports the violation and then re-pins past
    // it has detected an attack and destroyed its own evidence.
    validate?.(walk);
    pins.advance(url, tip.seq, walk.hash);
    return { ...walk, budget };
  }

  /**
   * §3.2 + §5.3. Fetch the identity document at its fixed path, connect it to the pin, pin it.
   *
   * The fixed path is why this takes an identity URL and not a document URL: §13.9 requires
   * fetching only the claimed author's conventional document, never an arbitrary URL out of a
   * `kid`, and the path convention makes that structural rather than a check anyone can forget.
   */
  async function readIdentity(rawIdentity) {
    const identity = normalizeIdentityUrl(rawIdentity);
    const url = identityDocumentUrl(identity);
    const fetched = await laddered(url, () =>
      fetcher.fetchIdentityDocument(identity, { budget: null }));
    const walk = await walkAndPin({
      url,
      tip: fetched.doc,
      kind: 'identity',
      policy: identityChainPolicy,
      bytes: fetched.bytes.length,
    });
    return {
      identity,
      url,
      document: fetched.doc,
      cors: fetched.cors,
      pin: pins.pin(url),
      tofu: walk.tofu,
      hops: walk.hops,
    };
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
      policy: manifestChainPolicy(identityDocument),
      bytes: fetched.bytes.length,
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
  async function readFeed(feedUrl, { identityDocument, resolveIdentity, firstSeenHere = new Set() }) {
    const fetched = await laddered(feedUrl, () => fetcher.fetchDocument(feedUrl, { kind: 'feed' }));
    const feed = fetched.doc;
    if (!Array.isArray(feed?.items)) {
      throw new ReaderError(`${feedUrl} is not a JSON Feed: no items array`, { url: feedUrl, code: 'not_a_feed' });
    }
    const canonicalUrl = normalizeUrlForCompare(feedUrl);

    const canonical = [];
    const copies = [];
    const rejected = [];

    for (const item of feed.items) {
      const owner = String(item?.authors?.[0]?.url ?? '');
      let authorDocument = identityDocument;
      if (owner && normalizeIdentityUrl(owner) !== normalizeIdentityUrl(identityDocument.url)) {
        // A multi-author feed (§7.1): every item names its own single author, so the key is
        // resolved in *that* identity's document, not the feed owner's. Without a resolver the
        // item is unverifiable rather than invalid — nothing about it is known to be wrong.
        if (!resolveIdentity) {
          rejected.push({ item, reason: `authored by ${owner}, whose identity document was not resolved` });
          continue;
        }
        try {
          authorDocument = (await resolveIdentity(owner)).document;
        } catch (e) {
          rejected.push({ item, reason: `could not resolve ${owner}: ${e.message}` });
          continue;
        }
      }

      const isCanonical = typeof item?._feed_url === 'string'
        && normalizeUrlForCompare(item._feed_url) === canonicalUrl;

      // §4.4: check revocation against first-observation time, under two scoping rules that
      // are the whole value of the record. Only items canonical by the **ordinary** `_feed_url`
      // test — one canonical here by §7.5's predecessor exception arrived byte-verbatim from a
      // migration, so its signing necessarily predates that event. And only ids this consumer
      // observed on an *earlier* pass: an id first recorded moments ago in this same read is a
      // consumer with no history, which §4.4 sends back to the self-reported check.
      const observed = isCanonical && !firstSeenHere.has(item?.id)
        ? observations.firstObserved(authorDocument.url, item?.id)
        : null;

      try {
        const info = verifyDocument(item, {
          identityDocument: authorDocument,
          kind: 'item',
          ...(observed !== null ? { signedAt: observed } : {}),
        });
        (isCanonical ? canonical : copies).push({ item, info, revocationCheckedAt: observed ?? info.signedAt });
      } catch (e) {
        if (!(e instanceof VerifyError)) throw e;
        rejected.push({ item, reason: e.message });
      }
    }

    return { url: feedUrl, feed, cors: fetched.cors, canonical, copies, rejected, nextUrl: feed.next_url ?? null };
  }

  /**
   * The whole Level 1 pipeline over one identity's primary feed.
   *
   * Order matters and is the reason this function exists: identity chain first, because the
   * manifest's signing key is resolved in it; manifest before items, because the manifest is
   * what an item is judged against and what supplies §4.4's first-observation time.
   */
  async function read(rawIdentity, { rel = 'primary' } = {}) {
    const identity = await readIdentity(rawIdentity);
    const entries = Array.isArray(identity.document.feeds) ? identity.document.feeds : [];
    const entry = entries.find((f) => (f?.rel ?? 'primary') === rel) ?? entries[0] ?? null;
    if (!entry) {
      throw new ReaderError(`${identity.identity} lists no feeds (§3.2.1)`, {
        url: identity.url, code: 'no_feed',
      });
    }

    const manifest = await readManifest(entry.manifest, {
      identityDocument: identity.document,
      feedUrl: entry.url,
    });
    const feed = await readFeed(entry.url, {
      identityDocument: identity.document,
      firstSeenHere: manifest.firstSeenHere,
    });

    // The feed is read to the end or it is not read at all, as far as §9.3's withholding
    // verdict goes: `partial` is the difference between "the host is hiding this" and "this is
    // on the next page", and asserting the first from one page would be a false accusation.
    const reconciled = reconcileFeed(manifest.manifest, feed.canonical.map((c) => c.item), {
      now: now(),
      ceiling: lagCeiling,
      url: entry.url,
      partial: feed.nextUrl !== null,
    });

    const byState = (state) => reconciled.states.filter((s) => s.state === state);
    return {
      identity,
      manifest,
      feed,
      entry,
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
        ...byState('withheld').map((s) => ({ kind: 'withheld', id: s.id, message: `${s.id}: ${s.reason}` })),
        ...feed.rejected.map((r) => ({ kind: 'unverifiable', id: r.item?.id, message: r.reason })),
        ...(identity.cors ? [] : [{ kind: 'conformance', message: `${identity.url} is served without Access-Control-Allow-Origin: * (§3.3)` }]),
      ],
      tofu: identity.tofu || manifest.tofu,
    };
  }

  return { readIdentity, readManifest, readFeed, read, pins, observations, fetcher };
}

/**
 * §7.5's comparison for feed URLs. Feeds are not identities — no trailing slash is appended,
 * because a feed URL names a file — so this is §3.1's normalization minus the path rules:
 * scheme and host folded, default port and fragment dropped, path and query left alone.
 */
export function normalizeUrlForCompare(raw) {
  const url = new URL(raw);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  return url.href;
}
