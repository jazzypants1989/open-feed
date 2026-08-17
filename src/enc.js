// Encrypted content (§15). Required by no core conformance level, and REQUIRED in full of any
// deployment offering audience-restricted content — there is no partial adoption and no
// access-control substitute (§15's conformance statement, §11.1's missing fifth cell).
//
// The layer defines **no new signing construction** (§6.1): an encrypted item is an ordinary
// signed item whose content is an opaque payload in `_enc`. Nothing in `src/` outside this file
// knows the field exists, and nothing here touches `jws.js` — the core commits to ciphertext
// exactly as it commits to cleartext, and the host serves bytes it cannot read.
//
// The guarantee is §11.3's and implementations MUST convey it rather than bury it: **encrypted
// content is exactly as private as the recipient's key custody**, so this is not a defence
// against your own host. What stays cleartext regardless is §11.4's list — who posted, when, how
// often, and who replied to whom.
//
// Two things here are not ordinary JWE and both were settled by measurement in
// `tmp/enctags-prototype.js`:
//
//   - **One shared ephemeral, and per-recipient slots found by a blinded `_tag`** rather than a
//     `kid`. A `kid` would name the audience to every observer forever; a tag computed from the
//     ECDH shared secret needs one of the two private halves, so an observer holding every
//     recipient's published key and the ephemeral public key derives nothing. Sharing the
//     ephemeral is what makes the tag *useful* — with one ephemeral per recipient a reader must
//     perform the key agreement before it could compute any tag, so cost stays linear in slots
//     however they are labelled. Neither works alone; the prototype found that both hypotheses
//     going in were wrong about which change mattered.
//   - **Carrier binding** (§15.2.1), which is a MUST and is checked at the decrypting client
//     rather than at the core verifier. Without it an envelope is context-free and can be lifted
//     into somebody else's signed item — see `open` below for why that is worse than ordinary
//     misattribution.
//
// Node's crypto has X25519, AES key wrap, and AES-GCM natively, so the zero-dependency rule
// holds here too.

import crypto from 'node:crypto';

import { canonicalBytes, parseIJSON } from './canonical.js';
import { b64u, sha256, timingSafeEqualString } from './hash.js';
import { normalizeIdentityUrl } from './jws.js';

export class EncError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

export const ALG = 'ECDH-ES+A256KW';
export const ENC = 'A256GCM';
/** §15.2's domain separator. Fixed, and part of the wire format. */
export const TAG_LABEL = 'openfeed-slot-tag';
const TAG_BYTES = 8;
const KW_IV = Buffer.from('A6A6A6A6A6A6A6A6', 'hex');   // RFC 3394's default
// A bound on slots per envelope, opened or sealed. §15.5.7 is right that cost per slot is
// flat, but a bound is not about asymptotics: it is what stops one malformed or hostile
// envelope from being a million-entry loop a caller never chose.
export const MAX_RECIPIENT_SLOTS = 4096;

/**
 * §15.1: a recipient's encryption key, resolved from **that recipient's own identity document**
 * and never from any third party.
 *
 * This is the check that stops an intermediary — a host, or whoever assembles an audience list —
 * substituting a key it controls. Because the identity document is chained and pinned (§5),
 * *substituting* a published encryption key is as detectable as substituting a signing key. What
 * it does not cover is whether the sender wrapped to the right people, which is a client-side act
 * that is never published and which §15.5 says no observer can check.
 *
 * A declared `audience` (§15.2.2) names identities and is never a source of keys, which is why
 * this takes a document rather than a list.
 */
export function encryptionKeyFor(identityDocument, { kid, now = Math.floor(Date.now() / 1000) } = {}) {
  const keys = Array.isArray(identityDocument?.keys) ? identityDocument.keys : [];
  // §15.1: for an encryption key `revoked_at` is an instruction to encryptors — senders MUST
  // NOT wrap *new* content to it — and §15.1 also makes encryption keys cumulative, so the
  // array reliably contains retired ones. Filtered here rather than left to the caller,
  // because "pick one from the array" was exactly how a revoked key kept getting selected.
  const usable = keys.filter((k) => k?.use === 'enc' && k?.crv === 'X25519' && k?.kty === 'OKP' && typeof k.x === 'string'
    && !(typeof k.revoked_at === 'number' && k.revoked_at <= now));
  // Newest `iat` wins; entries without one sort oldest, and array order breaks ties.
  const newest = [...usable].sort((a, b) => (a.iat ?? 0) - (b.iat ?? 0)).at(-1);
  const found = kid ? usable.find((k) => k.kid === kid) : newest;
  if (!found) {
    throw new EncError(`${identityDocument?.url ?? 'identity'} publishes no unrevoked X25519 key with use "enc" (§15.1)`);
  }
  return found;
}

const publicFromJwk = (jwk) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: jwk.x }, format: 'jwk' });

/** RFC 7518 §4.6.2's Concat KDF, one SHA-256 round because keydatalen is 256 bits. */
function concatKdf(z, algorithm) {
  const lenPrefixed = (buf) => {
    const out = Buffer.alloc(4 + buf.length);
    out.writeUInt32BE(buf.length, 0);
    buf.copy(out, 4);
    return out;
  };
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(1, 0);
  const suppPubInfo = Buffer.alloc(4);
  suppPubInfo.writeUInt32BE(256, 0);
  return crypto.createHash('sha256').update(Buffer.concat([
    counter,
    z,
    lenPrefixed(Buffer.from(algorithm, 'ascii')),
    lenPrefixed(Buffer.alloc(0)),   // apu
    lenPrefixed(Buffer.alloc(0)),   // apv
    suppPubInfo,
  ])).digest();
}

/**
 * §15.2's blinded slot tag: the first 8 bytes of `SHA-256("openfeed-slot-tag" || Z)`.
 *
 * Computing it requires one of the two private halves, which is the whole privacy claim — and it
 * is unlinkable across items because the ephemeral is fresh per item, which is also why a `kid`
 * is forbidden in a per-recipient header.
 */
export function slotTag(z) {
  return b64u(sha256(Buffer.concat([Buffer.from(TAG_LABEL, 'ascii'), z])).subarray(0, TAG_BYTES));
}

/**
 * Seal an item's content to a set of recipients, returning the `_enc` value.
 *
 * `recipients` are identity documents, not keys: §15.1 requires resolving each recipient's key
 * from their own document, and taking documents here is what makes that structural rather than a
 * rule a caller is asked to remember.
 *
 * The sealed plaintext carries the carrier binding §15.2.1 makes a MUST — the item's `id`, its
 * author, and its `_feed_url` if it has one — plus the OPTIONAL declared `audience` (§15.2.2),
 * which lives inside the sealed bytes and MUST NOT appear in any per-recipient header: readers
 * learning the audience is the point, observers learning it is the leak the tags exist to prevent.
 *
 * `ephemeral`, `cek`, and `iv` exist so a test vector can be reproduced, and for no other reason.
 */
export function seal({ item, content, recipients, audience, ephemeral, cek, iv } = {}) {
  if (!item || typeof item.id !== 'string') throw new EncError('seal needs the carrier item');
  const author = item?.authors?.[0]?.url;
  if (typeof author !== 'string') throw new EncError('the carrier item has no author binding (§6.6)');
  if (!Array.isArray(recipients) || recipients.length === 0) throw new EncError('seal needs at least one recipient');
  if (recipients.length > MAX_RECIPIENT_SLOTS) {
    throw new EncError(`seal was handed ${recipients.length} recipients; refusing past ${MAX_RECIPIENT_SLOTS}`);
  }

  const plaintext = {
    id: item.id,
    authors: [{ url: author }],
    ...(item._feed_url !== undefined ? { _feed_url: item._feed_url } : {}),
    ...(audience ? { audience: audience.map((u) => normalizeIdentityUrl(u)) } : {}),
    ...content,
  };

  const epk = ephemeral ?? crypto.generateKeyPairSync('x25519');
  const epkJwk = epk.publicKey.export({ format: 'jwk' });
  const contentKey = cek ?? crypto.randomBytes(32);
  const nonce = iv ?? crypto.randomBytes(12);

  // One protected header for the whole envelope, carrying the single shared `epk`. `alg` sits in
  // each per-recipient header because that is where RFC 7516 puts it for a multi-recipient JWE.
  const protectedHeader = { enc: ENC, epk: { crv: 'X25519', kty: 'OKP', x: epkJwk.x } };
  const protectedB64 = canonicalBytes(protectedHeader).toString('base64url');

  const slots = recipients.map((document) => {
    const jwk = encryptionKeyFor(document);
    const z = crypto.diffieHellman({ privateKey: epk.privateKey, publicKey: publicFromJwk(jwk) });
    const kek = concatKdf(z, ALG);
    const wrap = crypto.createCipheriv('id-aes256-wrap', kek, KW_IV);
    const wrapped = Buffer.concat([wrap.update(contentKey), wrap.final()]);
    // §15.2: a per-recipient header MUST NOT carry `kid`. The tag is what a reader matches on.
    return { header: { alg: ALG, _tag: slotTag(z) }, encrypted_key: wrapped.toString('base64url') };
  });

  const cipher = crypto.createCipheriv('aes-256-gcm', contentKey, nonce);
  cipher.setAAD(Buffer.from(protectedB64, 'ascii'));
  const ciphertext = Buffer.concat([cipher.update(canonicalBytes(plaintext)), cipher.final()]);

  return {
    protected: protectedB64,
    recipients: slots,
    iv: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
}

/**
 * Open an item's `_enc` with whatever private encryption keys the reader holds.
 *
 * **Carrier binding (§15.2.1) is enforced here and is a MUST.** Without it the following works:
 * Eve fetches an encrypted item from a world-readable feed, cannot read it, copies the `_enc`
 * blob verbatim into a new item with a fresh `id`, her own `authors`, her own `_feed_url`, and
 * any `_rel` she likes, and signs it with her own key. Every core check passes — valid signature,
 * valid author binding, `_feed_url` matching the feed it is served from, fresh `id` so §7.5's
 * exclusivity rule is not triggered, and an ordinary manifest commits it. Any audience member's
 * client then renders the original author's private words attributed to Eve, in a context Eve
 * chose. What makes it worse than ordinary misattribution: **Eve does not need to be in the
 * audience.** In a cleartext world a copier can only misattribute what they could already read.
 *
 * The tag is a **hint and never an authorization**. Eight bytes collide, so a match whose unwrap
 * fails is an ordinary event rather than an attack: the reader keeps scanning the remaining
 * slots and fails closed at the end. Treating a tag match as a decision would let anyone who
 * could grind one deny a recipient their own item.
 */
export function open(item, { privateKeys = [] } = {}) {
  const envelope = item?._enc;
  if (!envelope || typeof envelope !== 'object') throw new EncError('no _enc envelope on this item');
  const header = parseIJSON(Buffer.from(String(envelope.protected ?? ''), 'base64url').toString('utf8'));
  if (header.enc !== ENC) throw new EncError(`unsupported enc ${header.enc}`);
  if (header.epk?.crv !== 'X25519') throw new EncError('the protected header carries no X25519 epk (§15.2)');
  const epk = publicFromJwk(header.epk);

  const slots = Array.isArray(envelope.recipients) ? envelope.recipients : [];
  // A hostile envelope's slot count is otherwise bounded only by the document caps upstream of
  // this call, and a library function has no way to know its caller enforced them. Far above
  // any real audience, far below a grind.
  if (slots.length > MAX_RECIPIENT_SLOTS) {
    throw new EncError(`envelope carries ${slots.length} recipient slots; refusing past ${MAX_RECIPIENT_SLOTS}`);
  }
  for (const key of privateKeys) {
    const z = crypto.diffieHellman({ privateKey: key, publicKey: epk });
    const mine = slotTag(z);
    const kek = concatKdf(z, ALG);
    for (const slot of slots) {
      // One key agreement per key the reader holds, then byte comparisons — so work does not
      // grow with the audience, and the case that would otherwise be worst (a non-recipient,
      // which on a world-readable encrypted feed is anyone at all) is the cheapest (§15.5.7).
      // Constant-time (§13.7): the tag derives from the shared secret, and this module keeps
      // the same comparison discipline `chain.js` and `manifest.js` apply to hashes.
      if (!timingSafeEqualString(String(slot?.header?._tag ?? ''), mine)) continue;
      if (slot.header.kid !== undefined) throw new EncError('a per-recipient header MUST NOT carry kid (§15.2)');
      let contentKey;
      try {
        const unwrap = crypto.createDecipheriv('id-aes256-wrap', kek, KW_IV);
        contentKey = Buffer.concat([
          unwrap.update(Buffer.from(slot.encrypted_key, 'base64url')),
          unwrap.final(),
        ]);
      } catch {
        continue;   // an 8-byte tag collides; keep scanning rather than deciding
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', contentKey, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAAD(Buffer.from(String(envelope.protected), 'ascii'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      let plaintextBytes;
      try {
        plaintextBytes = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
          decipher.final(),
        ]);
      } catch {
        continue;
      }
      const plaintext = parseIJSON(plaintextBytes.toString('utf8'));
      assertCarrierBinding(plaintext, item);
      return plaintext;
    }
  }
  throw new EncError('no slot in this envelope opens with the keys supplied');
}

/**
 * §15.2.1: the sealed plaintext MUST name the item it belongs to, and a decrypting client MUST
 * discard the payload on any mismatch — rendering nothing, attributing nothing.
 */
export function assertCarrierBinding(plaintext, item) {
  const sealedAuthor = plaintext?.authors?.[0]?.url;
  const outerAuthor = item?.authors?.[0]?.url;
  const same = (a, b) => {
    if (a === undefined && b === undefined) return true;
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    return a === b;
  };
  if (!same(plaintext?.id, item?.id)) {
    throw new EncError(`carrier binding: sealed id ${plaintext?.id} is not ${item?.id} (§15.2.1)`);
  }
  if (!same(sealedAuthor, outerAuthor)) {
    throw new EncError(`carrier binding: sealed author ${sealedAuthor} is not ${outerAuthor} (§15.2.1)`);
  }
  if (!same(plaintext?._feed_url, item?._feed_url)) {
    throw new EncError(
      `carrier binding: sealed _feed_url ${plaintext?._feed_url} is not ${item?._feed_url} (§15.2.1)`,
    );
  }
  return plaintext;
}

/**
 * §15.2.2's declared audience, read out of an opened plaintext.
 *
 * "It carries no authority and grants no one anything. It is the author's statement about who
 * they wrapped to, and §15.5.1 already establishes that no such statement is checkable by
 * anyone." A client wrapping a reply to it is trusting a list it cannot check — the author may
 * name someone they did not wrap to, or wrap to someone they did not name — and §15.6 makes
 * disclosing that a MUST for any client that does.
 */
export function declaredAudience(plaintext) {
  const audience = plaintext?.audience;
  if (!Array.isArray(audience)) return null;
  return audience.filter((u) => typeof u === 'string').map((u) => {
    try { return normalizeIdentityUrl(u); } catch { return u; }
  });
}

/**
 * §15.3: an encrypted attachment's `_sha256` is the hash **of the ciphertext**.
 *
 * So integrity is verifiable by anyone, without any key, from a signed item: a host that swaps
 * bytes is caught by a party who cannot read either version, and AEAD gives plaintext integrity
 * on top. The per-blob key travels inside the item's already-encrypted content, so whoever can
 * read the caption can decrypt the photo — no second audience, no second key list, nothing new
 * to revoke.
 */
export function sealAttachment(bytes, { key = crypto.randomBytes(32), iv = crypto.randomBytes(12) } = {}) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final(), cipher.getAuthTag()]);
  return { ciphertext, key: b64u(key), iv: b64u(iv), _sha256: b64u(sha256(ciphertext)) };
}

export function openAttachment(ciphertext, { key, iv }) {
  const raw = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64url'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]);
}
