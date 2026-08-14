// The single signing construction (spec §6.1): detached JWS Compact Serialization with
// unencoded payload (RFC 7515 + RFC 7797), Ed25519, over RFC 8785 canonical bytes.
// There is no second construction anywhere in this protocol, including its optional layers.

import crypto from 'node:crypto';
import { canonicalBytes } from './canonical.js';

export class VerifyError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

export const SIGNATURE_FIELDS = ['_sig', '_recovery_sig'];

// ---- identity URLs (spec §3.1) ----

/** Normalize an identity URL. Applied whenever identity URLs are stored or compared. */
export function normalizeIdentityUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch {
    throw new VerifyError(`not a URL: ${input}`);
  }
  if (u.protocol !== 'https:') throw new VerifyError(`identity URL must be https: ${input}`);
  // `new URL` already lowercases the host and drops the default :443 for https.
  u.hash = '';
  u.search = '';
  // An identity is a place, not a credential. Left in, userinfo makes one identity two —
  // and `identityDocumentUrl` would put it on the wire as basic auth.
  u.username = '';
  u.password = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/'; // path stays case-sensitive
  return u.toString();
}

/**
 * Split a JWS `kid` into its identity URL and key id (spec §4.2). Split at the LAST `#`:
 * ids and kids never contain one, and normalization strips fragments, so the split
 * happens first.
 */
export function parseKid(kid) {
  if (typeof kid !== 'string') throw new VerifyError('kid must be a string');
  const at = kid.lastIndexOf('#');
  if (at < 0) throw new VerifyError(`kid has no fragment: ${kid}`);
  const identityUrl = normalizeIdentityUrl(kid.slice(0, at));
  const keyId = kid.slice(at + 1);
  if (!keyId) throw new VerifyError(`kid has an empty key id: ${kid}`);
  return { identityUrl, keyId };
}

// ---- header (spec §6.2) ----

export function buildHeader(kid) {
  return { alg: 'EdDSA', b64: false, crit: ['b64'], kid };
}

function enforceHeader(header) {
  if (header.alg !== 'EdDSA') throw new VerifyError(`unrecognized alg: ${header.alg}`);
  if (header.b64 !== false) throw new VerifyError('b64 must be false');
  if (!Array.isArray(header.crit) || header.crit.length !== 1 || header.crit[0] !== 'b64') {
    // "Verifiers MUST reject ... crit entries they do not understand" — b64 is the only one.
    throw new VerifyError(`unsupported crit: ${JSON.stringify(header.crit)}`);
  }
  if (typeof header.kid !== 'string' || !header.kid) throw new VerifyError('kid missing');
  return header;
}

/** Split `header-b64 || '..' || sig-b64` and enforce §6.2 on the header. */
export function parseDetachedSig(sig) {
  if (typeof sig !== 'string') throw new VerifyError('signature must be a string');
  const parts = sig.split('.');
  if (parts.length !== 3 || parts[1] !== '') {
    throw new VerifyError('signature is not a detached JWS (expected `header..signature`)');
  }
  const [headerB64, , signatureB64] = parts;
  let header;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    throw new VerifyError('signature header is not valid JSON');
  }
  return { headerB64, header: enforceHeader(header), signature: Buffer.from(signatureB64, 'base64url') };
}

// ---- signing input (spec §6.1, §6.4) ----

/** Strip signature fields and canonicalize: the detached payload. */
export function signingPayload(doc) {
  const rest = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!SIGNATURE_FIELDS.includes(k)) rest[k] = v;
  }
  return canonicalBytes(rest);
}

/**
 * ASCII(BASE64URL(UTF8(header)) || '.') || canonical-json-bytes.
 * The signature covers header AND payload: signing the payload alone would leave `alg`
 * and `kid` unauthenticated, letting an attacker swap the referenced key.
 */
export function signingInput(headerB64, payload) {
  return Buffer.concat([Buffer.from(headerB64 + '.', 'ascii'), payload]);
}

export function publicKeyFromJwk(jwk) {
  if (jwk?.kty !== 'OKP' || jwk?.crv !== 'Ed25519') {
    // The alg alone does not fix the curve (spec §6.2).
    throw new VerifyError(`not an Ed25519 signing key: kty=${jwk?.kty} crv=${jwk?.crv}`);
  }
  try {
    return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  } catch (e) {
    throw new VerifyError(`unusable key ${jwk.kid}: ${e.message}`);
  }
}

/** Sign a document, returning the `_sig` value. Present so tests can build negative vectors. */
export function sign(doc, privateKey, kid) {
  const headerB64 = Buffer.from(JSON.stringify(buildHeader(kid)), 'utf8').toString('base64url');
  const sig = crypto.sign(null, signingInput(headerB64, signingPayload(doc)), privateKey);
  return `${headerB64}..${Buffer.from(sig).toString('base64url')}`;
}

// ---- document-level checks (spec §6.5, §6.6) ----

/**
 * The author named inside the signed bytes (spec §6.6). For items the carrier is the
 * item-level `authors` array, which MUST hold exactly one entry; for manifests and identity
 * documents it is `url`.
 *
 * §6.6 selects the carrier by **document kind**, so callers that know the kind say so. The
 * fallback for callers that do not is presence of `authors`, which is right for an item — a
 * JSON Feed item may also carry a `url`, its permalink, which carries no authority — but is
 * wrong for a chained document that happens to carry an `authors` extension field: §3.2 says
 * unknown fields are preserved and *ignored*, and ignoring one must not mean letting it
 * displace the binding the document actually has.
 */
export function claimedAuthor(doc, { kind } = {}) {
  const carrier = kind ?? ('authors' in doc ? 'item' : 'document');
  if (carrier === 'item') {
    const authors = doc.authors;
    if (!Array.isArray(authors) || authors.length !== 1) {
      throw new VerifyError(`item authors must hold exactly one entry, found ${Array.isArray(authors) ? authors.length : typeof authors}`);
    }
    if (typeof authors[0]?.url !== 'string') throw new VerifyError('item author entry has no url');
    return normalizeIdentityUrl(authors[0].url);
  }
  if (typeof doc.url === 'string') return normalizeIdentityUrl(doc.url);
  throw new VerifyError('document carries no author binding');
}

/**
 * Effective signing time in Unix seconds (spec §6.5 step 6): `updated` for manifests and
 * identity documents, `date_modified` else `date_published` for items. Chain fields are
 * Unix seconds (JOSE), content fields ISO 8601 (JSON Feed).
 */
export function effectiveSigningTime(doc) {
  if (typeof doc.updated === 'number') return doc.updated;
  const stamp = doc.date_modified ?? doc.date_published;
  if (typeof stamp !== 'string') throw new VerifyError('document carries no effective signing time');
  const ms = Date.parse(stamp);
  if (Number.isNaN(ms)) throw new VerifyError(`unparseable timestamp: ${stamp}`);
  return Math.floor(ms / 1000);
}

// The `use` tokens a `_sig` may resolve against. `recovery` is recognized but is not a
// `_sig` signer (§4.5 — it only ever produces `_recovery_sig`, resolved by §5.5's own
// rule); anything else unrecognized hides the key entirely (§4.1). That ignore rule is
// what makes §4.6's delegation marker fail closed at pre-§4.6 verifiers, so resolving by
// `kid` alone here would quietly delete the property the design leans on.
const SIG_USES = new Set([undefined, 'sig', 'delegated']);

/** Find a `_sig` signing key by kid in an identity document. Ownership is structural (spec §4.2). */
export function findKey(identityDocument, keyId) {
  const keys = identityDocument?.keys;
  if (!Array.isArray(keys)) throw new VerifyError('identity document has no keys array');
  const key = keys.find((k) => k?.kid === keyId);
  if (!key) throw new VerifyError(`identity ${identityDocument.url} lists no key ${keyId}`);
  if (key.use === 'recovery') {
    throw new VerifyError(`key ${keyId} is a recovery key, which MUST NOT sign content or manifests (§4.5)`);
  }
  if (!SIG_USES.has(key.use)) {
    throw new VerifyError(
      `identity ${identityDocument.url} lists no signing key ${keyId} (unrecognized use "${key.use}" is ignored, §4.1)`,
    );
  }
  return key;
}

/**
 * Verify a detached signature over a document.
 *
 * Covers spec §6.5 steps 1-4 and 6-8. Step 5's fetch-and-pin is the caller's: this takes
 * the already-resolved identity document, so the chain layer stays separable and this
 * stays usable offline against an export bundle.
 *
 * `signedAt` overrides the effective signing time for revocation purposes — receipt time
 * for inbox items, manifest first-observation time on the pull path (spec §4.4), neither
 * of which a key thief can backdate.
 */
export function verifyDocument(doc, { identityDocument, sigField = '_sig', signedAt, kind } = {}) {
  const sig = doc[sigField];
  if (typeof sig !== 'string') throw new VerifyError(`document has no ${sigField}`);

  const { headerB64, header, signature } = parseDetachedSig(sig);
  const { identityUrl, keyId } = parseKid(header.kid);

  // Author binding: the kid's identity MUST equal the author named in the signed bytes.
  const author = claimedAuthor(doc, { kind });
  if (identityUrl !== author) {
    throw new VerifyError(`author binding failed: kid names ${identityUrl}, document claims ${author}`);
  }

  if (identityDocument) {
    const identity = normalizeIdentityUrl(identityDocument.url);
    if (identity !== identityUrl) {
      throw new VerifyError(`wrong identity document: holds ${identity}, kid names ${identityUrl}`);
    }
  }

  const jwk = identityDocument ? findKey(identityDocument, keyId) : null;
  if (!jwk) throw new VerifyError('no identity document supplied to resolve the key');

  const when = signedAt ?? effectiveSigningTime(doc);
  if (typeof jwk.iat === 'number' && jwk.iat > when) {
    throw new VerifyError(`key ${keyId} was issued at ${jwk.iat}, after the signing time ${when}`);
  }
  // Spec §4.4: reject signatures whose effective signing time is *after* revoked_at;
  // before, they remain valid. Equality is valid, which is what makes §5.2's normal
  // rotation work — the continuity key is often revoked in the very version it signs.
  if (typeof jwk.revoked_at === 'number' && when > jwk.revoked_at) {
    throw new VerifyError(`key ${keyId} was revoked at ${jwk.revoked_at}, before the signing time ${when}`);
  }

  const publicKey = publicKeyFromJwk(jwk);
  const ok = crypto.verify(null, signingInput(headerB64, signingPayload(doc)), publicKey, signature);
  if (!ok) throw new VerifyError('signature does not verify');

  return { author, identityUrl, keyId, key: jwk, signedAt: when };
}
