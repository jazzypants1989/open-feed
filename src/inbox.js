// The inbox (§10). Level 3.
//
// This is a *function*, not a server: bytes and a clock in, a §10.4 status out. §10.1 says the
// endpoint is `POST {inbox}` with CORS headers and leaves everything about how one authenticates
// to one's own hub out of scope, so binding a socket here would be inventing the uninteresting
// half and hiding the interesting one.
//
// The interesting half is the **order**, and §10.2 is the only numbered list in this
// specification whose numbering is normative. Two rules run in opposite directions:
//
//   §10.2  "Cheap local checks run **before** any outbound fetch; the sender is unauthenticated
//          until step 7." An inbox that verifies first is a fetch-amplification oracle: anyone
//          who can POST chooses which URL it dials, and does so for free (§13.9).
//   §10.3  The dedup store is **read** at step 5 and MUST NOT be **written** until verification
//          succeeds. The `author` is attacker-controlled until then, so an early write pins
//          `(victim, id)` at a version the victim will never reach and every genuine revision
//          they sign afterwards is rejected as stale, forever.
//
// Both are invisible in the output of a correct implementation and invisible in the output of a
// wrong one — the forgery is rejected either way, which is exactly what makes the damage silent.
// So `deliver` reports `fetches` and `fetchesBeforeVerify`, and the tests assert on them.
//
// `tmp/inbox-prototype.js` is where this shape was settled, with the fetch stubbed to a counter.

import { parseIJSON } from './canonical.js';
import {
  verifyDocument, normalizeIdentityUrl, normalizeUrlForCompare, effectiveSigningTime, VerifyError,
} from './jws.js';
import { SIZE_CAPS, createFetcher, FetchError } from './fetch.js';
import { admissibleItemPins } from './chain.js';
import { documentHash, timingSafeEqualString } from './hash.js';

/** §10.4's table, as the only place a status and a code are paired. */
export const RESPONSES = {
  accepted: { status: 202, error: null },
  invalid_json: { status: 400, error: 'invalid_json' },
  missing_field: { status: 400, error: 'missing_field' },
  not_relevant: { status: 400, error: 'not_relevant' },
  invalid_signature: { status: 401, error: 'invalid_signature' },
  key_revoked: { status: 401, error: 'key_revoked' },
  target_not_found: { status: 404, error: 'target_not_found' },
  stale_version: { status: 409, error: 'stale_version' },
  rate_limited: { status: 429, error: 'rate_limited' },
};

/**
 * §10.3's replay store: `(author, id) → version`.
 *
 * Keyed by the pair and **matched on the id half**, which is §3.4's predecessor equivalence
 * obtained with no recorded state at all. A reply written before a migration names the old feed
 * inside its author's signed bytes and nobody can re-sign it; more sharply, §6.6 binds a
 * tombstone's author to the identity now signing it, so an author who migrated and then retracts
 * something they *delivered* beforehand arrives under a new pair. Match the pair alone and the
 * retraction files as a brand-new item, the original stays live, and the sender gets a `202`
 * telling them it landed.
 *
 * **The id-half match is bounded by authorship, and the bound is the security half of it.** Ids
 * are globally unique by convention and published in the clear, so without it anyone can copy a
 * public item's `id`, sign their own item at a higher `_version`, and have a receiver file it as
 * a revision of somebody else's. Two different authors are one record only across a *verified*
 * migration; otherwise they are two items, and the collision is worth surfacing because it is
 * either a uniqueness failure or an attempt.
 */
/**
 * §10.6: the per-`(sender, recipient)` delivery chain, from the receiving side.
 *
 * A published item is committed by a manifest, so a consumer can learn that something it never
 * saw exists. A delivered item is committed by nothing — no feed, no manifest, no §7.6 URL, and
 * §14 says the `delivered` and `received` slots carry no completeness proof. So the receiving
 * host can drop any delivery and the only signal anywhere is the sender's retry timeout, and
 * under §13.2's hostile-custodian tier that host is the adversary.
 *
 * A counter catches the **selective** drop, which is the shape isolation actually takes: one
 * message, or one person, suppressed while the stream keeps flowing. The `prev` hash is what
 * makes the catch worth anything to somebody else — item 4 carries the *sender's signature* over
 * the exact bytes of an item this receiver does not hold, which is checkable by anyone with the
 * sender's identity document and survives into §14's bundle. A bare counter yields "I am missing
 * one", indistinguishable from a recipient who deleted it themselves.
 *
 * The pair key is the author, subject to predecessor equivalence exactly as `DedupStore`'s is
 * (§3.4) — a migration is not a new stream — so this takes the same `equivalent` predicate and
 * for the same reason.
 *
 * What it cannot do is in §10.6 beside the rule: a host dropping an entire *suffix* leaves
 * silence, and silence from a sender is not evidence. This does not make delivery reliable.
 */
export class DeliveryStore {
  constructor({ equivalent = (a, b) => normalizeIdentityUrl(a) === normalizeIdentityUrl(b) } = {}) {
    // normalized author -> { seq, hash, missing: Map<seq, claimedHash|null>, held: Map<seq, hash> }
    //
    // `missing` is the receiver's open findings: seqs the stream has jumped over, each holding
    // the sender's own claim of that item's hash where a later item's `prev` supplied one.
    // `held` is one 43-character hash per accepted delivery, kept so a late arrival's linkage is
    // checkable — smaller than the dedup record and the item bytes a receiver already retains,
    // and prunable under the same local policy (§13.4).
    this.bySender = new Map();
    this.equivalent = equivalent;
  }

  #holder(author) {
    const me = normalizeIdentityUrl(author);
    if (this.bySender.has(me)) return me;
    for (const held of this.bySender.keys()) if (this.equivalent(held, me)) return held;
    return null;
  }

  /**
   * What this delivery says about the ones before it. Read-only, and safe to run before
   * verification because it writes nothing — §10.3's write-before-verify rule governs the
   * companion `record` below for the same reason it governs the dedup store.
   *
   * `null` means nothing to report: no `_delivery` (the field is a SHOULD), a first delivery
   * from this sender, an unbroken continuation — or a late arrival that fills a recorded gap,
   * which §10.4's 24-hour retry window makes an ordinary event rather than a replay.
   */
  check(author, item) {
    const d = item?._delivery;
    if (!d || !Number.isInteger(d.seq) || d.seq < 1) return null;
    // §10.6: a published item may be pushed to any number of inboxes, so no single counter could
    // be true of them all — receivers MUST ignore `_delivery` where `_feed_url` is present.
    if (typeof item._feed_url === 'string') return null;
    const holder = this.#holder(author);
    if (holder === null) {
      // First contact at seq 1 is the ordinary genesis. First contact deeper into a stream is
      // a gap like any other: either this receiver lost its state or a prefix was dropped, and
      // §10.6 has no third reading for "the stream began mid-way".
      if (d.seq === 1) return null;
      return {
        kind: 'delivery_gap', expected: 1, got: d.seq,
        missingHash: typeof d.prev === 'string' ? d.prev : null,
      };
    }
    const st = this.bySender.get(holder);
    if (d.seq <= st.seq) {
      if (st.missing.has(d.seq)) {
        // A gap-filler. Two linkage checks, both against the sender's own signed claims: the
        // later item that revealed the gap may have named this seq's hash in its `prev`, and
        // this item's `prev` must match the neighbor the receiver holds.
        const claimed = st.missing.get(d.seq);
        if (claimed && !timingSafeEqualString(claimed, documentHash(item))) {
          return { kind: 'delivery_broken_link', expected: d.seq, got: d.seq, missingHash: claimed };
        }
        const neighbor = st.held.get(d.seq - 1);
        if (typeof d.prev === 'string' && neighbor && !timingSafeEqualString(d.prev, neighbor)) {
          return { kind: 'delivery_broken_link', expected: d.seq, got: d.seq, missingHash: d.prev };
        }
        return null;
      }
      return { kind: 'delivery_replay', expected: st.seq + 1, got: d.seq, missingHash: null };
    }
    if (d.seq > st.seq + 1) {
      return {
        kind: 'delivery_gap', expected: st.seq + 1, got: d.seq,
        // The hash the sender named is the bytes of the item immediately before this one. Where
        // more than one is missing it names only the last of them, which is still a signed claim
        // about bytes this receiver does not hold.
        missingHash: typeof d.prev === 'string' ? d.prev : null,
      };
    }
    if (typeof d.prev === 'string' && !timingSafeEqualString(d.prev, st.hash)) {
      return { kind: 'delivery_broken_link', expected: st.seq + 1, got: d.seq, missingHash: d.prev };
    }
    return null;
  }

  /** Only after verification succeeds (§10.3's rule, same reasoning). */
  record(author, item) {
    const d = item?._delivery;
    if (!d || !Number.isInteger(d.seq) || d.seq < 1) return null;
    if (typeof item._feed_url === 'string') return null; // same §10.6 rule as `check`

    const holder = this.#holder(author) ?? normalizeIdentityUrl(author);
    const st = this.bySender.get(holder);
    const hash = documentHash(item);
    const prevClaim = typeof d.prev === 'string' ? d.prev : null;

    if (!st) {
      const fresh = { seq: d.seq, hash, missing: new Map(), held: new Map([[d.seq, hash]]) };
      for (let k = 1; k < d.seq; k++) fresh.missing.set(k, k === d.seq - 1 ? prevClaim : null);
      this.bySender.set(holder, fresh);
      return fresh;
    }
    if (d.seq <= st.seq) {
      if (st.missing.has(d.seq)) {           // a late arrival closes its finding
        st.missing.delete(d.seq);
        st.held.set(d.seq, hash);
      }
      return st;                             // a replay never moves the stream
    }
    for (let k = st.seq + 1; k < d.seq; k++) st.missing.set(k, k === d.seq - 1 ? prevClaim : null);
    st.held.set(d.seq, hash);
    st.seq = d.seq;
    st.hash = hash;
    return st;
  }

  /** Streams outlive processes: a receiver restart that forgot them would read every sender as
   * first contact and every dropped prefix as nothing (same shape as `DedupStore`'s pair). */
  toJSON() {
    return Object.fromEntries([...this.bySender].map(([sender, st]) => [sender, {
      seq: st.seq,
      hash: st.hash,
      missing: Object.fromEntries(st.missing),
      held: Object.fromEntries(st.held),
    }]));
  }

  static fromJSON(raw, options) {
    const store = new DeliveryStore(options);
    for (const [sender, st] of Object.entries(raw ?? {})) {
      store.bySender.set(sender, {
        seq: st.seq,
        hash: st.hash,
        missing: new Map(Object.entries(st.missing ?? {}).map(([k, v]) => [Number(k), v])),
        held: new Map(Object.entries(st.held ?? {}).map(([k, v]) => [Number(k), v])),
      });
    }
    return store;
  }
}

export class DedupStore {
  constructor({ equivalent = (a, b) => normalizeIdentityUrl(a) === normalizeIdentityUrl(b) } = {}) {
    this.byId = new Map();   // id -> Map<normalized author, version>
    this.equivalent = equivalent;
  }

  /**
   * What this store holds for `(author, id)`, honoring predecessor equivalence.
   *
   * Returns `{ author, version, collision }`. `collision` names an author that holds this id and
   * is *not* equivalent to the one asking — not a match, and not nothing either.
   */
  read(author, id) {
    const holders = this.byId.get(id);
    if (!holders) return null;
    const me = normalizeIdentityUrl(author);
    if (holders.has(me)) return { author: me, version: holders.get(me), collision: null };
    for (const [held, version] of holders) {
      if (this.equivalent(held, me)) return { author: held, version, collision: null };
    }
    return { author: null, version: null, collision: [...holders.keys()][0] };
  }

  /**
   * Only after verification succeeds (§10.3).
   *
   * Lands on the *equivalent* holder's record where one exists — the predecessor, across a
   * verified migration (§3.4) — so a successor's tombstone retires the predecessor's delivery
   * rather than filing as a stranger's new item. A collision (a non-equivalent holder) is left
   * alone: the pipeline surfaced it, and this write files the new author's record next to it.
   */
  write(author, id, version) {
    const me = normalizeIdentityUrl(author);
    const holders = this.byId.get(id) ?? new Map();
    const existing = this.read(me, id);
    holders.set(existing?.author ?? me, version);
    this.byId.set(id, holders);
    return version;
  }

  has(id) {
    return this.byId.has(id);
  }

  toJSON() {
    return Object.fromEntries([...this.byId].map(([id, m]) => [id, Object.fromEntries(m)]));
  }

  static fromJSON(raw, options) {
    const store = new DedupStore(options);
    for (const [id, holders] of Object.entries(raw ?? {})) {
      store.byId.set(id, new Map(Object.entries(holders)));
    }
    return store;
  }
}

/**
 * Split a `_rel` entry's `to` at the **last** `#` (§8).
 *
 * Unambiguous because ids never contain one (§7.2), which is the entire reason §7.2 forbids it.
 */
export function splitTarget(to) {
  const s = String(to ?? '');
  const cut = s.lastIndexOf('#');
  return cut === -1 ? { feed: s, id: null } : { feed: s.slice(0, cut), id: s.slice(cut + 1) };
}

/**
 * §10.5: content from anyone but the local user is untrusted, whether it arrived here or came
 * out of a stranger's feed.
 *
 * A classifier and an escaper, not a renderer. The specification offers two conformant answers —
 * render only `content_text`, escaped, or put `content_html` through an allowlist — and the
 * second needs a real HTML parser, which is the one place this repository's zero-dependency rule
 * costs something honest. So this supplies the first and says plainly that the second is the
 * caller's, rather than shipping a regex that looks like a sanitizer.
 */
export function renderable(item, { trusted = false } = {}) {
  const escaped = String(item?.content_text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  return {
    text: escaped,
    // §7.5: bridged content is never natively authentic, and §10.5 makes distinct display a MUST.
    unverified: item?._unverified === true,
    // Present but deliberately not sanitized here — a caller that renders it owes it an
    // allowlist-based sanitizer, and one that cannot supply one renders `text`.
    html: trusted ? item?.content_html ?? null : null,
    requiresSanitizer: typeof item?.content_html === 'string' && !trusted,
  };
}

/**
 * A Level 3 inbox for one identity.
 *
 * `owner` is the identity URL this inbox belongs to; `feedUrls` are that identity's feeds, both
 * used only by the relevance check. `holdsItem(id)` answers whether this receiver holds an item
 * with that id — §10.2's id-half rule, which is what makes a pre-migration reply relevant with no
 * state that has to survive the move.
 */
export function createInbox({
  owner,
  feedUrls = [],
  holdsItem = () => false,
  dedup = new DedupStore(),
  fetcher = createFetcher(),
  now = () => Math.floor(Date.now() / 1000),
  blocked = new Set(),
  maxBodyBytes = SIZE_CAPS.inbox,
  // §10.2 step 9, OPTIONAL. Off by default: it is an existence oracle for `(author, id)` pairs
  // and §13.8 asks implementations to obscure exactly that. Safe where ids are unguessable
  // UUIDs, which a deployment knows about itself and this module does not.
  confirmTarget = false,
  // §10.2 step 6. Always by source IP, because it is the only thing known before step 7.
  // The default is a real limiter rather than a pass-through: step 6 is a MUST, and a
  // library whose default quietly skips it ships the omission to every caller who did not
  // read this far. Callers with infrastructure of their own pass their own function.
  rateLimit = null,
  rateLimitPerMinute = 60,
  // Bucket keys are attacker-chosen exactly as the identity cache's are (§13.9), so the map is
  // bounded — but by its own number, not by the identity cache's. Tying the two meant that
  // shrinking the cache to save memory silently shrank the rate limiter's reach, and a limiter
  // whose oldest buckets are evicted under load has forgotten precisely the sources it was
  // counting.
  rateLimitBuckets = 8192,
  // §13.9: the identity cache is keyed by attacker-chosen author URLs, so it is sized,
  // evicting, and expiring — an unbounded cache is a memory lever, and a non-expiring one
  // quietly defeats the receipt-time revocation check below, which reads whatever the cache
  // holds. The ceiling is §12's hour.
  identityCacheSeconds = 3600,
  identityCacheEntries = 4096,
  // §7.3's allowlist, checked on receipt. A producer MUST emit exactly those fields; a receiver
  // is deliberately more lenient about `_rel` (§8.2) and has no reason to be lenient about a
  // tombstone that kept its title.
  strictTombstones = true,
  // §16.1's heed side, OPTIONAL like the facility itself. Given the owner's `PinStore`, an
  // accepted delivery's admissible `_pins` entries are judged against it and reported — local
  // verdicts only, no fetch, because §10.2's fetch discipline governs this pipeline and §16.1
  // forbids dereferencing on a stranger's word anyway. An entry whose verdict is `check` is
  // the caller's cue to run the reader's `resolvePeerPin`, whose fetch is scoped to chains
  // this receiver already tracks.
  pins = null,
  // §10.6's delivery chain, receiving side. Optional like the pin store above and for the same
  // reason: a deployment that keeps no per-sender state cannot report a gap, and reporting one
  // is a service to the recipient rather than a conformance check on the sender.
  deliveries = null,
  // The chained-document URLs the owner publishes — identity document plus each feed's
  // manifest — which is what a *published* item's pins may name (§16.1's publication rule).
  // Defaults to the identity document alone; a deployment that knows its manifest URLs passes
  // them (`chainUrlsOf(ownIdentityDocument)` builds the set).
  ownedChainUrls = null,
} = {}) {
  const ownerUrl = normalizeIdentityUrl(owner);
  const ownChains = ownedChainUrls ?? new Set([`${ownerUrl}openfeed.json`]);
  // Compared normalized (§7.5's comparator), so a sender writing `:443` or a differently-cased
  // host is not bounced as `not_relevant` over a string mismatch.
  const ownFeeds = new Set(feedUrls.map((u) => {
    try { return normalizeUrlForCompare(u); } catch { return String(u); }
  }));
  const identityCache = new Map();   // author url -> { doc, at }

  /**
   * The default §10.2 step 6 limiter: a sliding one-minute window per source IP, and per
   * author once known. Deliberately simple — the point is that the step exists and returns
   * `429` under load, not that it is clever. Buckets are bounded, since their keys are
   * attacker-chosen too.
   *
   * Called twice per delivery, with exactly one axis populated each time: by IP before
   * verification, by author after it. Whichever axis is `null` is not charged, so one request
   * costs one hit in each bucket rather than two in the IP bucket.
   */
  const buckets = new Map();   // key -> [unix seconds]
  function defaultRateLimit({ sourceIp, author }) {
    const at = now();
    for (const key of [sourceIp && `ip:${sourceIp}`, author && `author:${author}`]) {
      if (!key) continue;
      const hits = (buckets.get(key) ?? []).filter((t) => at - t < 60);
      if (hits.length >= rateLimitPerMinute) { buckets.set(key, hits); return false; }
      hits.push(at);
      buckets.delete(key);
      buckets.set(key, hits);
      while (buckets.size > rateLimitBuckets) buckets.delete(buckets.keys().next().value);
    }
    return true;
  }
  const limit = rateLimit ?? defaultRateLimit;

  const TOMBSTONE_FIELDS = new Set([
    'id', 'authors', 'date_published', 'date_modified',
    '_version', '_deleted', '_sig', 'content_text', '_feed_url', '_rel',
    // §7.3's two later admissions: the gateway marker travels with the item wherever it goes
    // (§7.5), and a delivered tombstone holds its own place in its pair's stream (§10.6).
    '_unverified', '_delivery',
  ]);

  /**
   * §10.2 step 3. One lookup over `_rel`, type-agnostic so an interaction of a type this
   * receiver has never heard of still reaches its subject (§8.1's `root` entry is the case that
   * matters: it is honored by receivers that predate it).
   */
  function relevant(item) {
    if (!Array.isArray(item._rel)) return false;
    for (const rel of item._rel) {
      const { feed, id } = splitTarget(rel?.to);
      // An entry whose **id half** names an item this receiver holds is relevant whatever its
      // feed half says (§10.2). Ids are globally unique and contain no `#`, so the id half alone
      // is unambiguous — and that is predecessor equivalence with nothing recorded.
      if (id && holdsItem(id)) return true;
      if (!feed) continue;
      let asIdentity = null;
      try { asIdentity = normalizeIdentityUrl(feed); } catch { /* a feed URL is not an identity */ }
      let asFeed = feed;
      try { asFeed = normalizeUrlForCompare(feed); } catch { /* not a URL at all; compared raw */ }
      if (asIdentity === ownerUrl || ownFeeds.has(asFeed)) return true;
    }
    return false;
  }

  /**
   * §6.5 step 6's effective signing time, as a verdict rather than a throw.
   *
   * Delegates to `jws.js` rather than recomputing it. A second implementation of one comparison
   * is two answers that must agree, and these two did not: the local one read
   * `date_modified ?? date_published` and ignored `updated`, so an item carrying an `updated`
   * member — conformant data, since §7.2 obliges a consumer to preserve unknown members — was
   * bounded here on one timestamp and revocation-checked in `verifyDocument` on another. The
   * inbox wants a `400` where the verifier wants an exception, and that is the only difference
   * that should exist between them.
   */
  function effectiveSigningSeconds(item) {
    try { return effectiveSigningTime(item); } catch { return null; }
  }

  /**
   * The one outbound fetch (§10.2 step 7), at the claimed author's **fixed path** and never at a
   * URL taken from the `kid` — the path convention is what makes that structural (§13.9).
   *
   * Failures are cached alongside successes. A stream of POSTs naming identities that do not
   * exist is otherwise a fetch per request, which is the amplification §13.9 is about.
   */
  async function identityFor(url) {
    const held = identityCache.get(url);
    if (held && now() - held.at < identityCacheSeconds) return { doc: held.doc, fetched: false };
    let doc = null;
    try {
      doc = (await fetcher.fetchIdentityDocument(url)).doc;
    } catch (e) {
      if (!(e instanceof FetchError)) throw e;
      doc = null;
    }
    identityCache.delete(url);
    identityCache.set(url, { doc, at: now() });
    while (identityCache.size > identityCacheEntries) {
      identityCache.delete(identityCache.keys().next().value);
    }
    return { doc, fetched: true };
  }

  /**
   * Deliver one POST body. Returns `{ status, error, message, item, fetches, fetchesBeforeVerify }`.
   *
   * `fetches` and `fetchesBeforeVerify` are not diagnostics. §10.2's ordering is the security
   * property and it has no other observable consequence, so the numbers are the interface a test
   * asserts on.
   */
  async function deliver(body, { sourceIp = null, at = now() } = {}) {
    let fetches = 0;
    let fetchesBeforeVerify = 0;

    const out = (name, message) => ({
      ...RESPONSES[name], message: message ?? null, item: null, fetches, fetchesBeforeVerify,
    });

    // ---- 1: size, parse, I-JSON ----
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
    if (bytes.length > maxBodyBytes) return out('invalid_json', `body exceeds ${maxBodyBytes} bytes`);
    let item;
    try {
      item = parseIJSON(bytes.toString('utf8'));
    } catch (e) {
      return out('invalid_json', e.message);
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return out('invalid_json', 'not an object');

    // ---- 2: required fields (§7.2) ----
    const author = item?.authors?.[0]?.url;
    if (typeof item.id !== 'string' || item.id.length === 0 || item.id.includes('#')) {
      return out('missing_field', 'id (§7.2: present, and no #)');
    }
    if (typeof author !== 'string' || !Array.isArray(item.authors) || item.authors.length !== 1) {
      return out('missing_field', 'authors (§6.6: exactly one entry)');
    }
    if (!Number.isInteger(item._version) || item._version < 1) return out('missing_field', '_version');
    if (typeof item.date_published !== 'string') return out('missing_field', 'date_published');
    if (typeof item._sig !== 'string') return out('missing_field', '_sig');
    if (item.content_text === undefined && item.content_html === undefined) {
      return out('missing_field', 'content_text or content_html (§7.2)');
    }
    let normalizedAuthor;
    try {
      normalizedAuthor = normalizeIdentityUrl(author);
    } catch (e) {
      return out('missing_field', `authors[0].url: ${e.message}`);
    }
    // §7.3: a tombstone MUST contain exactly the listed fields and no others. An allowlist on
    // purpose — a denylist naming today's content fields would let a conformant tombstone keep a
    // title, a tag, or an extension payload carrying the very thing the author deleted.
    if (strictTombstones && item._deleted === true) {
      const extra = Object.keys(item).filter((k) => !TOMBSTONE_FIELDS.has(k));
      if (extra.length) return out('missing_field', `tombstone carries ${extra.join(', ')} (§7.3)`);
    }

    // ---- 3: relevance ----
    // This reads the dedup store, before any signature has been checked, and §10.4 names the
    // consequence: a garbage-signed tombstone draws 401 where the pair is stored and 400 where
    // it is not, which is the same existence oracle as `404`/`409`. Safe where ids are
    // unguessable UUIDs, and the reason `confirmTarget` defaults off.
    const stored = dedup.read(normalizedAuthor, item.id);
    const tombstoneOfStored = item._deleted === true && stored?.version !== undefined && stored.version !== null;
    if (!relevant(item) && !tombstoneOfStored) return out('not_relevant');

    // ---- 4: timestamp bounds ----
    const signedAt = effectiveSigningSeconds(item);
    if (signedAt === null) return out('missing_field', 'date_published is not a timestamp');
    if (signedAt < at - 7 * 86400) return out('missing_field', 'effective signing time more than 7 days past');
    if (signedAt > at + 86400) return out('missing_field', 'effective signing time more than 24 hours future');

    // ---- 5: dedup, read only ----
    // A collision — an id held by an author no verified migration links to this one — is neither
    // stale nor an update. It is a different item that happens to share a globally-unique id,
    // which is a uniqueness failure or an attempt; it is filed as its own record and named in
    // the result rather than resolved here.
    if (!stored?.collision && typeof stored?.version === 'number' && item._version <= stored.version) {
      return out('stale_version', `held at version ${stored.version}`);
    }

    // ---- 6: rate limit by source IP (by author only once known, which is step 7) ----
    if (!limit({ sourceIp, author: null })) return out('rate_limited');

    // ---- 7: verify. Everything above ran on attacker-controlled bytes. ----
    fetchesBeforeVerify = fetches;
    const { doc: identityDocument, fetched } = await identityFor(normalizedAuthor);
    if (fetched) fetches += 1;
    if (!identityDocument) return out('invalid_signature', `could not resolve ${normalizedAuthor}`);

    let info;
    try {
      info = verifyDocument(item, { identityDocument, kind: 'item' });
    } catch (e) {
      if (!(e instanceof VerifyError)) throw e;
      return out('invalid_signature', e.message);
    }

    // ---- 8: revocation against RECEIPT time (§4.4) ----
    // Content timestamps are self-reported, so a key thief can backdate; receipt time is the one
    // bound a sender does not control.
    if (typeof info.key.revoked_at === 'number' && at > info.key.revoked_at) {
      return out('key_revoked', `${info.keyId} was revoked at ${info.key.revoked_at}`);
    }

    // §10.2 step 6's second half: "by author (once known)", and *only* by author. The source IP
    // was already charged above, and charging it twice for one request is worse than untidy —
    // it makes the effective IP budget half the configured one for well-formed traffic and the
    // full one for garbage that never reaches here, which is the ladder pointing the wrong way.
    // The two calls therefore charge disjoint axes, and a custom `rateLimit` is called twice per
    // delivery with exactly one of them populated.
    if (!limit({ sourceIp: null, author: normalizedAuthor })) return out('rate_limited');

    // §10.6, read before the write below and computed here so an accepted delivery carries the
    // verdict about its predecessors. Reading a store is free and unauthenticated-safe; writing
    // one is not (§10.3).
    const deliveryChain = deliveries ? deliveries.check(normalizedAuthor, item) : null;

    // ---- 9: OPTIONAL target existence, after step 7 and never before ----
    if (confirmTarget) {
      const targets = (item._rel ?? []).map((r) => splitTarget(r?.to).id).filter(Boolean);
      if (targets.length && !targets.some((id) => holdsItem(id))) return out('target_not_found');
    }

    // ---- accepted: only now is any store written (§10.3) ----
    dedup.write(normalizedAuthor, item.id, item._version);
    // §10.6. The verdict was computed before verification because reading is free and this
    // pipeline reads the dedup store there too; the *write* waits, for §10.3's reason exactly —
    // the author is attacker-controlled until step 7, and a forged delivery that advanced this
    // stream would let anyone break a real sender's chain for this receiver permanently.
    if (deliveries) deliveries.record(normalizedAuthor, item);

    // §16.1, heeded after verification like everything else that trusts the item's contents.
    // Scoping first (`admissibleItemPins` — a published item's third-party entries are ignored
    // outright), then each admissible entry judged against the owner's own records. A verdict
    // is local and free: `corroborates` and `untracked` are terminal, and `check` or `unknown`
    // hand the caller §16.1's next move without this pipeline making a single fetch for it.
    let peerPins = null;
    if (pins && Array.isArray(item._pins)) {
      const { admissible, ignored } = admissibleItemPins(item, { ownedChainUrls: ownChains });
      peerPins = {
        entries: admissible.map((e) => ({ ...e, ...pins.reconcilePeerPin(e.url, e.seq, e.hash) })),
        ignored: ignored.length,
        // Which chains were dropped, not just how many. `ownedChainUrls` defaults to the
        // identity document alone (above), so a deployment that has not declared its manifest
        // URLs drops every legitimate pin naming one — correctly, per §16.1's publication rule,
        // and indistinguishably from dropping a stranger's. Naming them is the difference
        // between a scoping rule doing its job and a deployment quietly configured wrong.
        ignoredUrls: [...new Set(ignored.map((e) => e?.url).filter((u) => typeof u === 'string'))],
      };
    }

    // §10.4: a blocked author gets `202` with the content discarded. A distinct status tells a
    // harasser to make a new identity and confirms the account exists.
    const discard = blocked.has(normalizedAuthor);
    return {
      ...RESPONSES.accepted,
      message: null,
      item: discard ? null : item,
      discarded: discard,
      collision: stored?.collision ?? null,
      // §11.1.1: an item with no `_feed_url` was delivered, not published. The receiver holds it
      // as a custodian, and this flag is the one field every public projection must consult.
      delivered: item._feed_url === undefined,
      // §10.6: a gap or a broken link in this sender's delivery stream. A finding and never a
      // rejection — the item in hand is genuine, and what it reports is about the ones that
      // never arrived. The receiver is the party being harmed and the only one positioned to
      // notice, which is why the verdict lands here rather than anywhere the sender can see it.
      deliveryChain,
      peerPins,
      fetches,
      fetchesBeforeVerify,
    };
  }

  /** §10.1's headers, so a caller mounting this cannot forget them. */
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  return { deliver, dedup, cors: CORS, owner: ownerUrl };
}

/**
 * §11.1.1, as the one-field check it is.
 *
 * "A receiver MUST NOT place a delivered-only item into any publicly-readable artifact: not a
 * feed, not a manifest, not the response of any query surface it invents, and not a gateway
 * emission." §13.14 calls this the failure mode most likely to be introduced by an implementer
 * being *helpful* — republishing what arrived looks like completeness and is a disclosure the
 * author declined. The rule binds artifact *classes*, so the check belongs at every projection
 * rather than at a list of today's surfaces, and it costs one lookup.
 */
export function publishable(item) {
  return typeof item?._feed_url === 'string';
}
