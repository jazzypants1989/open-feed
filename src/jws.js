// The single signing construction (spec §6.1): detached JWS Compact Serialization with
// unencoded payload (RFC 7515 + RFC 7797), Ed25519, over RFC 8785 canonical bytes.
// There is no second construction anywhere in this protocol, including its optional layers.

import crypto from 'node:crypto';
import { canonicalBytes, canonicalize, parseIJSON } from './canonical.js';

export class VerifyError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

export const SIGNATURE_FIELDS = ['_sig', '_recovery_sig'];

// ---- identity URLs (spec §3.1) ----

/**
 * Normalize an identity URL. Applied whenever identity URLs are stored or compared.
 *
 * §3.1 states normalization as string operations because a general-purpose URL parser cannot
 * implement its path rule: WHATWG `URL` re-encodes characters it considers encodable
 * (`/a^b/` → `/a%5Eb/`) and removes dot-segments, each library re-encodes a different set,
 * and an identity round-tripped through two of them becomes two identities. So the parser is
 * used for the half it is genuinely good at — host lowercasing, A-label form, default-port
 * removal — and the path is taken from the input string as published, byte-for-byte.
 */
export function normalizeIdentityUrl(input) {
  const s = String(input);
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new VerifyError(`not a URL: ${input}`);
  }
  if (u.protocol !== 'https:') throw new VerifyError(`identity URL must be https: ${input}`);
  // The path as published. Everything from the first `/` after the authority to the first
  // `?` or `#` — query and fragment stripped, userinfo stripped by never being copied,
  // percent-encoding and dot-segments left exactly as written (§3.1).
  let path = '/';
  const schemeEnd = s.indexOf('//');
  if (schemeEnd !== -1) {
    const afterAuthority = s.slice(schemeEnd + 2);
    const pathStart = afterAuthority.search(/[/?#]/);
    if (pathStart !== -1 && afterAuthority[pathStart] === '/') {
      const rest = afterAuthority.slice(pathStart);
      const pathEnd = rest.search(/[?#]/);
      path = pathEnd === -1 ? rest : rest.slice(0, pathEnd);
    }
  } else {
    // A non-canonical spelling (`https:example.com/…`). The parser's reading is the only one
    // available; producers are obliged to publish the canonical form (§3.1).
    path = u.pathname;
  }
  if (!path.endsWith('/')) path += '/'; // path stays case-sensitive
  // `u.hostname` is lowercased and punycoded; `u.port` is '' for the default :443.
  return `https://${u.hostname}${u.port ? `:${u.port}` : ''}${path}`;
}

/**
 * §7.5's comparison for feed and manifest URLs. These are not identities — no trailing slash
 * is appended, because they name files — so this is §3.1's normalization minus the path rules:
 * scheme and host folded, default port and fragment dropped, path and query left alone. One
 * comparator, used by the reader and the inbox both, because two normalizers that must agree
 * on hosts and disagree on paths is exactly the divergence §3.1 warns about.
 */
export function normalizeUrlForCompare(raw) {
  const url = new URL(raw);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
    url.port = '';
  }
  return url.href;
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
  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new VerifyError('signature header is not a JSON object');
  }
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
    // The strict parser, not `JSON.parse`. The protected header is signed bytes like any other
    // document, so §6.3's duplicate-member rule governs it: `{"kid":"A","kid":"B"}` resolves
    // last-wins under `JSON.parse`, first-wins under some parsers, and rejected under this one.
    // Two verifiers disagreeing about which key a signature names is the whole of signature
    // confusion, and the header is the one place in this codebase the strict parser was skipped.
    header = parseIJSON(Buffer.from(headerB64, 'base64url').toString('utf8'));
  } catch {
    throw new VerifyError('signature header is not valid I-JSON');
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
 * §6.6 selects the carrier by **document kind**, which is a fact of the verification context
 * and never of the bytes, so the caller MUST say which it is verifying. There is deliberately
 * no field-presence fallback: §3.2 obliges a chained document to carry unknown members intact,
 * so an `authors` extension member on an identity document is conformant data — and a verifier
 * that sniffed for it would read its author binding out of a field the signer chose freely,
 * which is the confusion §6.2's fixed header exists to prevent about keys.
 */
export function claimedAuthor(doc, { kind } = {}) {
  if (kind !== 'item' && kind !== 'document') {
    throw new VerifyError(`caller must say what kind of document this is — 'item' or 'document' (§6.6), got ${kind}`);
  }
  if (kind === 'item') {
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
 *
 * `timeChecks: false` skips the `iat` and `revoked_at` comparisons while still verifying the
 * signature, the header, and the author binding. It exists for one caller: §9.1 makes the
 * `_sig` check on a prev-hop manifest version OPTIONAL and says those versions MUST remain
 * valid whatever later happened to their key — a backdated `revoked_at` must not make retained
 * history unwalkable, or revoking a key retroactively unpublishes everything it ever committed.
 */
export function verifyDocument(doc, { identityDocument, sigField = '_sig', signedAt, kind, timeChecks = true } = {}) {
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
  if (timeChecks) {
    if (typeof jwk.iat === 'number' && jwk.iat > when) {
      throw new VerifyError(`key ${keyId} was issued at ${jwk.iat}, after the signing time ${when}`);
    }
    // Spec §4.4: reject signatures whose effective signing time is *after* revoked_at;
    // before, they remain valid. Equality is valid, which is what makes §5.2's normal
    // rotation work — the continuity key is often revoked in the very version it signs.
    if (typeof jwk.revoked_at === 'number' && when > jwk.revoked_at) {
      throw new VerifyError(`key ${keyId} was revoked at ${jwk.revoked_at}, before the signing time ${when}`);
    }
  }

  const publicKey = publicKeyFromJwk(jwk);
  const ok = crypto.verify(null, signingInput(headerB64, signingPayload(doc)), publicKey, signature);
  if (!ok) throw new VerifyError('signature does not verify');

  return { author, identityUrl, keyId, key: jwk, signedAt: when };
}
