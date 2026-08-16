// Open Feed reference verifier. Zero dependencies: Node's crypto has Ed25519 natively,
// and RFC 8785 / I-JSON are implemented here because the strictness the spec requires
// (duplicate member rejection, §6.3) is not something a stock JSON parser provides.

export { canonicalize, canonicalBytes, assertCanonicalBytes, parseIJSON, CanonicalError, JsonError } from './canonical.js';
export { sha256, b64u, documentHash, timingSafeEqualString } from './hash.js';
export {
  normalizeIdentityUrl,
  parseKid,
  buildHeader,
  parseDetachedSig,
  signingPayload,
  signingInput,
  publicKeyFromJwk,
  sign,
  claimedAuthor,
  effectiveSigningTime,
  findKey,
  verifyDocument,
  VerifyError,
  SIGNATURE_FIELDS,
} from './jws.js';
export {
  isPublicAddress,
  isPublicIPv4,
  isPublicIPv6,
  isPublicOrLoopbackAddress,
  parseIPv4,
  parseIPv6,
} from './addresses.js';
export {
  createFetcher,
  fetchDocument,
  fetchIdentityDocument,
  identityDocumentUrl,
  assertIdentityMatches,
  guardedLookup,
  mediaType,
  isJsonMediaType,
  NegativeCache,
  ByteBudget,
  FetchError,
  SIZE_CAPS,
  TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_SOCKETS_PER_ORIGIN,
  MAX_NEGATIVE_CACHE_ENTRIES,
  HISTORY_BYTES_PER_UPDATE,
} from './fetch.js';
export {
  derivedVersionUrl,
  derivedItemUrl,
  skipAnchors,
  PinStore,
  admissibleItemPins,
  walkToPin,
  identityChainPolicy,
  manifestChainPolicy,
  assertContinuityKey,
  verifyRecoverySignature,
  resolveFork,
  ChainError,
  EquivocationError,
  MAX_VERSIONS_PER_UPDATE,
} from './chain.js';
export {
  assertManifestShape,
  assertManifestBinding,
  assertInvariantsAcrossHop,
  assertHistoryInvariants,
  reconcileFeed,
  assertRelocationCarriesForward,
  ManifestError,
  InvariantViolation,
  ITEM_STATES,
  LAG_CEILING_SECONDS,
} from './manifest.js';
export {
  MigrationStore,
  recoveryPin,
  verifyMigration,
  MigrationError,
  CompetingMigrations,
} from './migration.js';
export { Publisher, PublishError } from './publish.js';
export { createReader, ObservationStore, normalizeUrlForCompare, ReaderError } from './reader.js';
export {
  buildBundle,
  containerEntries,
  completeness,
  degraded,
  restoreFetcher,
  verifyBundle,
  ExportError,
  BUNDLE_VERSION,
  BUNDLE_ENTRY,
} from './export.js';
export {
  createInbox,
  DedupStore,
  splitTarget,
  renderable,
  publishable,
  RESPONSES,
} from './inbox.js';
