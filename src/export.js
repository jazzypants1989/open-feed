// The export bundle (§14): move the content, where §3.4 moves the identity.
//
// §13.2 resolves every adversary tier to the same answer — what the protocol offers is **exit**,
// and exit is §3.4, §4.5, and §14 holding at once. Two of the three had code; this is the third.
//
// The property that decides whether a bundle is an exit or a courtesy is stated in §14 and is
// easy to write past: "A consumer restores from a bundle by verifying it exactly as it would
// verify live documents. Nothing about verification changes because the bytes arrived in a file."
// `tmp/export-prototype.js` found that literally true — the restorer needed only a different
// fetch function — so that is what `restoreFetcher` is, and `verifyBundle` is `createReader`
// with nothing else changed. There is no bundle-specific verifier here and there must not be
// one: a second verifier is a second set of rules to drift, and the whole point of a bundle you
// can check without trusting its exporter is that it is checked by the code you already trust.
//
// The requirement that makes this work is byte-verbatim carriage (§14, §6.3): a document nests
// as a JSON *value* and re-canonicalizes to the bytes that were signed, which holds only because
// §6.3 makes a chained document's published bytes its own canonicalization. Decomposing a
// document into columns and rebuilding it does not survive one unknown field.

import { canonicalBytes } from './canonical.js';
import { documentHash, b64u, sha256 } from './hash.js';
import { normalizeIdentityUrl } from './jws.js';
import { derivedVersionUrl, derivedItemUrl } from './chain.js';
import { FetchError } from './fetch.js';
import { createReader } from './reader.js';

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

export const BUNDLE_VERSION = 'openfeed-export/1';
export const BUNDLE_ENTRY = 'openfeed-export.json';

/**
 * Assemble a §14 bundle.
 *
 * Every document goes in **as the value that was signed**, never re-serialized from parts. The
 * caller therefore hands over the objects it verified or produced, and this does no
 * transformation at all — which is the only way "byte-verbatim as published" survives, since a
 * bundle whose contents have been rebuilt from columns will not chain.
 *
 * `predecessorHistory` is a MUST rather than a nicety where this identity carries a
 * `predecessor` (§14, §4.5): the co-signature that makes it a *successor's* bundle resolves in
 * the predecessor's chain, and a successor listing the same recovery key in its own document
 * proves nothing (§4.2). Those bytes exist under §5.4's retention and their owner is entitled to
 * them — and the case where they are hard to get is exactly the case that matters, because the
 * host holding them is the one being left.
 */
export function buildBundle({
  identity,
  identityHistory = [],
  predecessorHistory = [],
  feeds = [],
  delivered = [],
  received = [],
  unpublished = [],
  attachments = [],
  exportedAt,
} = {}) {
  if (!identity || typeof identity.url !== 'string') {
    throw new ExportError('a bundle needs the current identity document');
  }
  if (typeof exportedAt !== 'number') throw new ExportError('exported_at must be Unix seconds');

  const history = [...predecessorHistory, ...identityHistory]
    .slice()
    .sort((a, b) => (a.url === b.url ? a.seq - b.seq : String(a.url).localeCompare(String(b.url))));

  if (typeof identity.predecessor === 'string') {
    const wanted = normalizeIdentityUrl(identity.predecessor);
    const carried = history.some((v) => {
      try { return normalizeIdentityUrl(v.url) === wanted; } catch { return false; }
    });
    if (!carried) {
      throw new ExportError(
        `${identity.url} names predecessor ${identity.predecessor}, so §14 requires the predecessor's `
        + 'retained versions — at minimum the one committing the recovery key its _recovery_sig resolves against',
      );
    }
  }

  const bundle = {
    version: BUNDLE_VERSION,
    url: normalizeIdentityUrl(identity.url),
    exported_at: exportedAt,
    identity: { current: identity, history },
    feeds: feeds.map(({ feed, manifest, manifestHistory = [] }) => ({
      feed,
      manifest,
      manifest_history: [...manifestHistory].sort((a, b) => a.seq - b.seq),
    })),
  };
  // Omitted when empty rather than present and empty, because an empty array and an absent one
  // say different things about a host that has just been asked for everything it holds.
  if (delivered.length) bundle.delivered = delivered;
  if (received.length) bundle.received = received;
  if (unpublished.length) bundle.unpublished = unpublished;
  if (attachments.length) bundle.attachments = attachments;
  return bundle;
}

/**
 * What a bundle can and cannot prove about its own completeness (§14).
 *
 * Worth computing rather than asserting, because the answer is uncomfortable and a caller
 * should see it. `feeds` is checkable against its own manifests, so a short export of published
 * content is detectable. `delivered`, `received`, and `unpublished` are committed by nothing —
 * that is what makes them the slots they are — so their contents verify individually and their
 * *absence* verifies as nothing at all. A hostile operator degrading an export degrades exactly
 * there, and item-carried pins do not help: a pin names a chain, and none of these are on one.
 */
export function completeness(bundle) {
  const committed = new Set();
  for (const entry of bundle.feeds ?? []) {
    for (const id of Object.keys(entry.manifest?.items ?? {})) committed.add(id);
    for (const id of Object.keys(entry.manifest?.deleted ?? {})) committed.add(id);
  }
  return {
    provable: { published: committed.size },
    unprovable: {
      delivered: (bundle.delivered ?? []).length,
      received: (bundle.received ?? []).length,
      unpublished: (bundle.unpublished ?? []).length,
    },
    note: 'the published half is checkable against its manifests; the other three slots are '
      + 'committed by nothing, so a trimmed export of them is indistinguishable from a complete one',
  };
}

/**
 * §14's archive container: entry `openfeed-export.json` plus the attachment bytes, each named by
 * its `_openfeed.sha256`.
 *
 * "That is still one bundle and still self-verifying with nothing added, because the hash naming
 * each file is the one inside the signed item that references it." Returns a `Map` of entry name
 * to bytes, which any archive format can take — the format is deliberately not fixed, since
 * nothing here depends on it.
 *
 * Inlining base64 in the JSON is the small-bundle case and SHOULD NOT be the default: it
 * inflates media by a third and forces the whole archive through a single parse, so a decade of
 * photographs becomes several gigabytes neither side can stream.
 */
export function containerEntries(bundle, blobs = new Map()) {
  const entries = new Map();
  const document = { ...bundle };
  let externalized = 0;
  for (const attachment of bundle.attachments ?? []) {
    const hash = attachment?._openfeed?.sha256;
    const bytes = blobs.get(hash);
    if (!hash) throw new ExportError('an attachment entry with no _openfeed.sha256 cannot be named in a container (§7.4)');
    if (bytes === undefined) continue;   // a degraded export, named as such by `degraded` below
    if (b64u(sha256(bytes)) !== hash) {
      throw new ExportError(`attachment bytes do not hash to ${hash}: the container would lie about itself`);
    }
    entries.set(hash, bytes);
    externalized++;
  }
  // The JSON entry sheds only inlined `bytes` whose blob now rides as a container file, and
  // keeps every other member of every attachment entry — and a bundle carrying a `_sig` (an
  // extension; §14 defines no bundle signature) is not touched at all: rewriting a document out
  // from under a signature field falsifies whatever that field was claiming.
  if (externalized && typeof bundle._sig !== 'string') {
    document.attachments = (bundle.attachments ?? []).map((a) => {
      if (typeof a?.bytes !== 'string' || !entries.has(a?._openfeed?.sha256)) return a;
      const { bytes: _inlined, ...rest } = a;
      return rest;
    });
  }
  entries.set(BUNDLE_ENTRY, canonicalBytes(document));
  return entries;
}

/**
 * True where the bundle carries attachment *references* and not their bytes.
 *
 * §14 allows this only where neither other form is possible, and calls it degraded rather than
 * equivalent — "that fallback points at the host being left". A caller that hands this to a
 * departing user without saying so has exported a family archive without the photographs.
 */
export function degraded(bundle, blobs = new Map()) {
  const missing = (bundle.attachments ?? []).filter(
    (a) => blobs.get(a?._openfeed?.sha256) === undefined && typeof a?.bytes !== 'string',
  );
  return { degraded: missing.length > 0, missing: missing.map((a) => a.url ?? a._openfeed?.sha256) };
}

/**
 * A `fetcher` over a bundle's contents, shaped exactly like `createFetcher`'s.
 *
 * This is the whole of what §14 means by "nothing about verification changes because the bytes
 * arrived in a file". Everything the reader asks for is here at the URL it would have used on
 * the live web — the identity tip and its §5.4 derived versions, each feed and its manifest
 * chain, and each committed revision at its §7.6 item URL — so `createReader` runs unmodified.
 *
 * Bytes are produced by canonicalizing the nested value, which reproduces exactly what was
 * published only because §6.3 requires a chained document to be its own canonicalization. That
 * dependency is the reason §6.3's rule cannot be relaxed at the tip.
 */
export function restoreFetcher(bundle) {
  const byUrl = new Map();
  const put = (url, doc) => byUrl.set(String(url), doc);

  const identityUrl = `${normalizeIdentityUrl(bundle.url)}openfeed.json`;
  put(identityUrl, bundle.identity.current);
  for (const version of bundle.identity.history ?? []) {
    try {
      put(derivedVersionUrl(`${normalizeIdentityUrl(version.url)}openfeed.json`, version.seq), version);
    } catch { /* a version whose url will not normalize is not addressable; it is still in the bundle */ }
  }
  // A predecessor's *tip* as well as its retained versions: the cooperative path reads a
  // `successor` link that postdates any retained copy, so a bundle carrying only history cannot
  // demonstrate the cooperative half of its own migration.
  for (const version of bundle.identity.history ?? []) {
    const tip = `${normalizeIdentityUrl(version.url)}openfeed.json`;
    const held = byUrl.get(tip);
    if (!held || held.seq < version.seq) put(tip, version);
  }
  put(identityUrl, bundle.identity.current);

  for (const entry of bundle.feeds ?? []) {
    if (entry.feed?.feed_url) put(entry.feed.feed_url, entry.feed);
    if (entry.manifest) {
      const url = manifestUrlFor(bundle, entry);
      if (url) {
        put(url, entry.manifest);
        for (const version of entry.manifest_history ?? []) put(derivedVersionUrl(url, version.seq), version);
        put(derivedVersionUrl(url, entry.manifest.seq), entry.manifest);
      }
      // §7.6: each committed revision at its own URL, so a restored read can ask for one item
      // and the withholding verdict means what it means on the live web.
      for (const item of entry.feed?.items ?? []) {
        try { put(derivedItemUrl(entry.feed.feed_url, documentHash(item)), item); } catch { /* not addressable */ }
      }
    }
  }

  async function fetchDocument(rawUrl, { budget = null } = {}) {
    const doc = byUrl.get(String(rawUrl));
    if (doc === undefined) {
      throw new FetchError(`${rawUrl} is not in this bundle`, { code: 'bad_status', url: String(rawUrl) });
    }
    const bytes = canonicalBytes(doc);
    // §13.4's history budget binds here too, and it is not ceremony: "verification does not
    // change because the bytes arrived in a file" (§14) cuts both ways, and a bundle is the one
    // artifact a consumer accepts from a party it has explicitly decided not to trust. Ignoring
    // the budget on this path leaves a hostile export's chain bounded only by the hop cap, so a
    // restore can be made to read gigabytes that a live read of the same chain would refuse.
    // There is no socket to be slow about it, which makes it cheaper here, not safer.
    budget?.charge(bytes.length, String(rawUrl));
    // `cors: true` because a bundle is not served and the header is a property of serving. A
    // restorer that reported the bundle non-conforming for lacking one would be reporting on a
    // socket nobody opened.
    //
    // `requireCanonical` is deliberately not honored: these bytes are produced by canonicalizing
    // the parsed value a moment ago, so the check would compare a string with itself. §6.3's
    // arrival rule is about what a producer *served*, and §14 keeps that testable by requiring
    // bundle contents byte-verbatim — which `buildBundle` enforces on the way in.
    return { url: String(rawUrl), requestedUrl: String(rawUrl), redirects: 0, doc, bytes, contentType: 'application/json', cors: true };
  }

  async function fetchIdentityDocument(identityUrl_, options) {
    const url = `${normalizeIdentityUrl(identityUrl_)}openfeed.json`;
    const result = await fetchDocument(url, options);
    return { ...result, identity: normalizeIdentityUrl(identityUrl_) };
  }

  return { fetchDocument, fetchIdentityDocument, urls: byUrl, negativeCache: null, close: () => {} };
}

/** The manifest URL a `feeds` entry names, resolved out of the identity document. */
function manifestUrlFor(bundle, entry) {
  const listed = (bundle.identity.current.feeds ?? []).find((f) => f?.url === entry.feed?.feed_url);
  return listed?.manifest ?? null;
}

/**
 * Verify a bundle by reading it, with no network and no help from whoever made it.
 *
 * `createReader` unmodified, over `restoreFetcher`. That is the assertion, not the mechanism:
 * if this needed a single rule the live reader does not have, §14's claim would be false and the
 * bundle would be a backup with an exit's vocabulary.
 */
export async function verifyBundle(bundle, options = {}) {
  if (bundle?.version !== BUNDLE_VERSION) {
    throw new ExportError(`unknown bundle version ${bundle?.version}`);
  }
  const reader = createReader({ fetcher: restoreFetcher(bundle), ...options });

  // Read the predecessor's chain *first* where the bundle carries one. On the live web a reader
  // that chased a stranger's `predecessor:` claim would turn every identity read into a
  // fetch-amplification oracle (§13.9) — that half of the restriction is about the network and
  // is genuinely wrong here, since the retained versions are inside the file. Without this read
  // a successor's own bundle reads its byte-verbatim back catalog as copies and then reports
  // every item of it as withheld — the accusation §3.4 exists to avoid.
  //
  // What the read MUST NOT do is launder authority. §3.4 is explicit that a consumer with no
  // prior pin of the predecessor can only treat a recovery-based migration as unverified, and
  // that sentence is about *authority*, not network availability: a walk over history the
  // bundle itself supplied establishes a pin whose every byte the bundle's author chose,
  // including the recovery key the co-signature then resolves against. Fabricate a predecessor
  // history around your own recovery key, name the victim's URL in `predecessor`, co-sign, and
  // a verifier that trusted its own bundle-fed pin would return `verified: true, via:
  // 'recovery'` for an identity you never were. So: the migration verdict stands only where the
  // caller brought a pin of the predecessor from *outside* the bundle; otherwise the read still
  // happens — the back catalog stays readable, attributed to its signers — and the verdict is
  // downgraded to unverified with `predecessorTofu` saying exactly why.
  const predecessor = bundle.identity?.current?.predecessor;
  let predecessorTofu = false;
  if (typeof predecessor === 'string') {
    const pinUrl = `${normalizeIdentityUrl(predecessor)}openfeed.json`;
    predecessorTofu = !options.pins?.pin?.(pinUrl);
    try {
      await reader.readIdentity(predecessor, { verifyMigration: false });
    } catch {
      // A bundle that does not carry it is already refused at assembly; one that arrived
      // without it verifies everything else and simply cannot demonstrate the migration.
    }
  }

  const result = await reader.read(bundle.url);
  const migration = result.migration?.verified && predecessorTofu
    ? {
      ...result.migration,
      verified: false,
      predecessorTofu: true,
      reason: `the predecessor history anchoring this migration came from inside the bundle itself; `
        + `a consumer with no prior pin of ${predecessor} can only treat it as unverified (§3.4)`,
    }
    : result.migration;
  return { ...result, migration, predecessorTofu, completeness: completeness(bundle) };
}
