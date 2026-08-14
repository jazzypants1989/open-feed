// Open Feed reference verifier. Zero dependencies: Node's crypto has Ed25519 natively,
// and RFC 8785 / I-JSON are implemented here because the strictness the spec requires
// (duplicate member rejection, §6.3) is not something a stock JSON parser provides.

export { canonicalize, canonicalBytes, parseIJSON, CanonicalError, JsonError } from './canonical.js';
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
