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
 * The identity document's URL, derived from the identity URL and never taken from input.
 * §13.9: fetch only the fixed-path document of the claimed author, never an arbitrary URL
 * out of a `kid`. The path convention is what makes that structural rather than a check.
 *
 * It lives here rather than in `fetch.js` — which re-exports it — because it is the *naming*
 * half of §3.2's fixed path, and the walk needs it to bind each version it fetches to the
 * chain it is walking without importing the module that opens sockets.
 */
export function identityDocumentUrl(identityUrl) {
  return `${normalizeIdentityUrl(identityUrl)}openfeed.json`;
}

/**
 * §3.1's comparison for every URL that is not an identity: feeds, manifests, the feed half of a
 * `_openfeed.rel` target, and the URLs a pin is keyed on. §3.1's normalization minus its last two rules —
 * no trailing slash, because these name files and `feed.json/` names nothing; query kept, because
 * a feed may legitimately live behind one. One comparator, used by the reader and the inbox both,
 * because two normalizers that must agree on hosts and disagree on paths is exactly the
 * divergence §3.1 warns about.
 *
 * Userinfo is stripped for §3.1's reason, which is not identity-specific: a credential in a URL
 * makes one feed two, and both halves of the comparison are attacker-influenced.
 */
export function normalizeUrlForCompare(raw) {
  const url = new URL(raw);
  url.hash = '';
  url.username = '';
  url.password = '';
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

/**
 * §6.2's `typ`, per kind. RFC 7515 §4.1.9 values are media types, and that section recommends
 * omitting the `application/` prefix — so these are exactly what appears in a header, and the
 * full types are in Appendix A.
 *
 * `kind` is this codebase's word for the same three things throughout (`effectiveSigningTime`,
 * `claimedAuthor`, `fetchDocument`), so the map is keyed on it rather than on a fourth spelling.
 */
export const TYP = {
  identity: 'openfeed-identity+json',
  manifest: 'openfeed-manifest+json',
  item: 'openfeed-item+json',
};
const KNOWN_TYP = new Set(Object.values(TYP));

/**
 * The three kinds, and the one vocabulary for them.
 *
 * It used to be two — `'item'` and `'document'`, the latter covering identity documents and
 * manifests together, which was enough because the only question `kind` answered was *which
 * field carries the author and the signing time* and both chained kinds answer that the same
 * way (`url`, `updated`). §6.2's `typ` asks a question they answer differently, so the union
 * had to be split rather than kept beside a second vocabulary.
 */
export const KINDS = ['identity', 'manifest', 'item'];
/** True for the two chained kinds, whose author carrier is `url` and whose clock is `updated`. */
export const isChainedKind = (kind) => kind === 'identity' || kind === 'manifest';

function assertKind(kind, where) {
  if (!KINDS.includes(kind)) {
    throw new VerifyError(`caller must say what kind of document this is — ${KINDS.map((k) => `'${k}'`).join(', ')} (${where}), got ${JSON.stringify(kind)}`);
  }
}

export function buildHeader(kid, kind) {
  const typ = TYP[kind];
  if (!typ) throw new VerifyError(`buildHeader needs a document kind (§6.2), got ${JSON.stringify(kind)}`);
  return { alg: 'EdDSA', b64: false, crit: ['b64'], kid, typ };
}

/**
 * `kind`, when supplied, is the kind the *caller* took from context, and `typ` is checked to
 * agree with it (§6.5 step 3). The direction matters and §6.6 states it: context decides, `typ`
 * confirms. Letting the header select the kind would hand that choice to whoever wrote it, which
 * is the confusion the field exists to close.
 */
function enforceHeader(header, kind) {
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
  if (!KNOWN_TYP.has(header.typ)) throw new VerifyError(`unrecognized typ: ${JSON.stringify(header.typ)} (§6.2)`);
  if (kind !== undefined && header.typ !== TYP[kind]) {
    throw new VerifyError(`typ ${header.typ} is not the ${kind} this verifier is reading (§6.5 step 3)`);
  }
  return header;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Decode a base64url segment, rejecting every spelling but the one canonical one.
 *
 * `Buffer.from(s, 'base64url')` is a *lenient* decoder: it accepts `=` padding, accepts the
 * standard `+`/`/` alphabet, ignores non-alphabet bytes outright, and ignores non-canonical
 * trailing bits. That leniency makes a `_sig` string **malleable** — `sig`, `sig=`, `sig!!!`,
 * and `sig` with `-_` swapped for `+/` all decode to the same signature and all verify.
 *
 * A malleable `_sig` is not cosmetic here, because §5.1 makes a document's identity its full
 * published bytes, `_sig` included. Feeds are exempt from §6.3's arrival-canonicality rule
 * (they are neither signed nor chained), so item `_sig` strings inside a feed page are the one
 * signed-document bytes nothing byte-checks. A serving-path attacker holding **no key** flips
 * one character: the item still verifies, so it lands in the canonical set, and then its
 * `documentHash` no longer matches what the manifest committed — §9.3 invariant 4, which §9.3
 * says "MUST be treated like chain equivocation." An honest publisher is convicted of the one
 * thing the chains exist to detect, by an attacker who forged nothing.
 *
 * So: alphabet, length class, and a re-encode round-trip. The round-trip is what closes the
 * trailing-bits case, which the first two checks cannot see.
 */
export function decodeBase64url(segment, what) {
  if (!BASE64URL.test(segment)) {
    throw new VerifyError(`${what} is not canonical base64url`);
  }
  if (segment.length % 4 === 1) {
    throw new VerifyError(`${what} has an impossible base64url length`);
  }
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) {
    throw new VerifyError(`${what} is not canonical base64url`);
  }
  return bytes;
}

/**
 * Split `header-b64 || '..' || sig-b64` and enforce §6.2 on the header.
 *
 * `kind` is optional here and required at `verifyDocument`: this function is also how a caller
 * *reads* a signature it has not yet decided the kind of (`parseKid` on an unopened document),
 * and imposing the check at both ends would make that impossible while adding nothing — §6.5's
 * step 3 belongs to verification.
 */
export function parseDetachedSig(sig, { kind } = {}) {
  if (typeof sig !== 'string') throw new VerifyError('signature must be a string');
  const parts = sig.split('.');
  if (parts.length !== 3 || parts[1] !== '') {
    throw new VerifyError('signature is not a detached JWS (expected `header..signature`)');
  }
  const [headerB64, , signatureB64] = parts;
  const headerBytes = decodeBase64url(headerB64, 'signature header');
  const signature = decodeBase64url(signatureB64, 'signature');
  let header;
  try {
    // The strict parser, not `JSON.parse`. The protected header is signed bytes like any other
    // document, so §6.3's duplicate-member rule governs it: `{"kid":"A","kid":"B"}` resolves
    // last-wins under `JSON.parse`, first-wins under some parsers, and rejected under this one.
    // Two verifiers disagreeing about which key a signature names is the whole of signature
    // confusion, and the header is the one place in this codebase the strict parser was skipped.
    header = parseIJSON(headerBytes.toString('utf8'));
  } catch {
    throw new VerifyError('signature header is not valid I-JSON');
  }
  return { headerB64, header: enforceHeader(header, kind), signature };
}

// ---- signing input (spec §6.1, §6.4) ----

/** Strip signature fields and canonicalize: the detached payload. */
export function signingPayload(doc, { recovery = false } = {}) {
  // §6.3 step 1. `_sig` always goes; `_recovery_sig` goes only when the payload being built is
  // the *co-signature's*, which is what makes `_sig` cover `_recovery_sig`.
  //
  // The asymmetry is the point and it is worth its clause. Strip both for both signatures and
  // neither covers the other — so a serving-path attacker holding no key can DELETE a
  // `_recovery_sig`, and `_sig` still verifies over bytes that never mentioned it. On a
  // successor's genesis identity document (§3.4 path 3) that is the exit being denied in
  // silence: the consumer sees a `predecessor` with no co-signature, which §3.4 says MUST NOT
  // be treated as a migration, and the message is identical to an honest document that simply
  // offered none. It is not permanent — the successor's `seq: 2` names the unstripped genesis
  // in its `prev`, and a peer's pin (§16.1) disagrees at once — but an identity chain advances
  // 5-20 times in a lifetime (§3.2.1), so "until seq 2" is a window measured in months, and it
  // opens exactly when the exit is being exercised.
  //
  // Order follows: co-sign first, then sign. A `_recovery_sig` added after the fact invalidates
  // the `_sig` over it, which is the same rule as any other member and needs no exception.
  const strip = recovery ? SIGNATURE_FIELDS : ['_sig'];
  const rest = {};
  for (const [k, v] of Object.entries(doc)) {
    if (!strip.includes(k)) rest[k] = v;
  }
  return canonicalBytes(rest);
}

/**
 * ASCII(BASE64URL(UTF8(header)) || '.') || canonical-json-bytes.
 * The signature covers header AND payload: signing the payload alone would leave `alg`
 * and `kid` unauthenticated, letting an attacker swap the referenced key.
 *
 * The alphabet check is that claim's other half rather than a belt on a brace. `Buffer.from(s,
 * 'ascii')` does not reject a non-ASCII code unit, it *truncates* it mod 256 — so `X` and
 * `String.fromCharCode('X' + 256)` produce identical signing input, and the header half of the
 * signature stops distinguishing them. `parseDetachedSig` already refuses such a segment on the
 * verify path; enforcing it here too means the function is sound on its own terms, for the
 * callers that reach it directly.
 */
export function signingInput(headerB64, payload) {
  if (typeof headerB64 !== 'string' || !BASE64URL.test(headerB64)) {
    throw new VerifyError('signature header segment is not canonical base64url');
  }
  return Buffer.concat([Buffer.from(headerB64 + '.', 'ascii'), payload]);
}

export function publicKeyFromJwk(jwk) {
  if (jwk?.kty !== 'OKP' || jwk?.crv !== 'Ed25519') {
    // The alg alone does not fix the curve (spec §6.2).
    throw new VerifyError(`not an Ed25519 signing key: kty=${jwk?.kty} crv=${jwk?.crv}`);
  }
  // §5.1's one-spelling rule names key `x` explicitly, and Node's JWK import is lenient — it
  // accepts padding and the standard alphabet — so the strictness lives here, not in the import.
  const raw = decodeBase64url(String(jwk?.x ?? ''), `key ${jwk?.kid ?? '(unnamed)'} x`);
  if (raw.length !== 32) {
    throw new VerifyError(`key ${jwk?.kid ?? '(unnamed)'} x is not a 32-byte Ed25519 point`);
  }
  try {
    return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
  } catch (e) {
    throw new VerifyError(`unusable key ${jwk.kid}: ${e.message}`);
  }
}

/**
 * Sign a document, returning the `_sig` value. Present so tests can build negative vectors.
 *
 * `kind` is required (§6.2's `typ`) and deliberately has no default: a default would be a guess
 * about what is being signed, made in the one place that is supposed to be asserting it.
 */
export function sign(doc, privateKey, kid, { recovery = false, kind } = {}) {
  const headerB64 = Buffer.from(JSON.stringify(buildHeader(kid, kind)), 'utf8').toString('base64url');
  const sig = crypto.sign(null, signingInput(headerB64, signingPayload(doc, { recovery })), privateKey);
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
  assertKind(kind, '§6.6');
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

// §7.2's time profile: RFC 3339 `date-time`, with `Z` or a numeric offset and no other form.
// Fractional seconds are permitted and discarded — this protocol's comparisons are in seconds.
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;

const daysInMonth = (y, m) =>
  [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

/**
 * Parse a content timestamp to Unix seconds under §7.2's profile, rejecting everything else.
 *
 * Written out rather than delegated to `Date.parse`, which is the wrong tool at a security
 * boundary in three separate ways — and this value drives revocation (§6.5), §9.3 invariant 3,
 * and §10.2's window, so a disagreement between two verifiers is a disagreement about whether
 * a signature is valid. `Date.parse` accepts `2025-02-30` and rolls it forward to March 2;
 * accepts `24:00:00` and rolls it to the next day, which ISO 8601 permits and RFC 3339 does
 * not; and, for anything outside the format the ECMAScript specification pins, falls back to
 * an **implementation-defined** reading — `Jan 15 2025` parses as *local* time, so two honest
 * consumers in two timezones compute different effective signing times for one item.
 *
 * A leap second (`:60`) is accepted and rolls into the following minute, which is the ordinary
 * reading and the only one available without a leap-second table.
 */
export function parseTimestamp(stamp) {
  if (typeof stamp !== 'string') throw new VerifyError('timestamp must be a string (§7.2)');
  const m = RFC3339.exec(stamp);
  if (!m) throw new VerifyError(`not an RFC 3339 date-time with Z or a numeric offset: ${stamp}`);
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number);
  if (month < 1 || month > 12) throw new VerifyError(`month out of range: ${stamp}`);
  if (day < 1 || day > daysInMonth(year, month)) throw new VerifyError(`day out of range: ${stamp}`);
  // Hour 24 is ISO 8601's end-of-day and is not RFC 3339; second 60 is RFC 3339's leap second.
  if (hour > 23 || minute > 59 || second > 60) throw new VerifyError(`time out of range: ${stamp}`);
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) : 0;
  if (Number(oh ?? 0) > 23 || Number(om ?? 0) > 59) throw new VerifyError(`offset out of range: ${stamp}`);
  return Math.floor(Date.UTC(year, month - 1, day, hour, minute, second) / 1000) - offset * 60;
}

/**
 * Effective signing time in Unix seconds (spec §6.5 step 7): `updated` for manifests and
 * identity documents, `date_modified` else `date_published` for items. Chain fields are
 * Unix seconds (JOSE), content fields RFC 3339 (§7.2).
 *
 * §6.5 selects the carrier by **document kind**, and the caller MUST say which — the same rule,
 * for the same reason, as `claimedAuthor` above. There is deliberately no field-presence
 * sniffing: §7.2 obliges consumers to preserve unknown members, so an *item* carrying a numeric
 * `updated` is conformant data — and a verifier that read the time out of it would hand the
 * revocation clock to the signer. A holder of a key revoked at `T` signs an item dated after
 * `T` plus `"updated": T - 1`, and the sniffing verifier reads `T - 1` and passes it.
 */
export function effectiveSigningTime(doc, { kind } = {}) {
  assertKind(kind, '§6.5');
  if (isChainedKind(kind)) {
    if (typeof doc.updated !== 'number') throw new VerifyError('chained document carries no updated');
    return doc.updated;
  }
  const stamp = doc.date_modified ?? doc.date_published;
  if (typeof stamp !== 'string') throw new VerifyError('item carries no effective signing time');
  return parseTimestamp(stamp);
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
 * `signedAt` **bounds** the effective signing time for revocation purposes — receipt time
 * for inbox items, per-revision first-observation time on the pull path (spec §4.4), neither
 * of which a key thief can backdate. The check runs against the *later* of the bound and the
 * self-reported claim: substituting the bound for the claim is the inversion §4.4 warns
 * about, where an old observation of an id stands in for a fresh revision's claim and the
 * record makes revocation weaker instead of stronger.
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

  // §6.5 step 3, and it runs before anything is fetched because every step below reads a
  // different field depending on the kind. `claimedAuthor` and `effectiveSigningTime` already
  // demand an explicit `kind`; this is what stops the *signer's* idea of it from differing.
  const { headerB64, header, signature } = parseDetachedSig(sig, { kind });
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

  const claimed = effectiveSigningTime(doc, { kind });
  const when = typeof signedAt === 'number' ? Math.max(signedAt, claimed) : claimed;
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
