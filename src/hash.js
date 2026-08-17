import crypto from 'node:crypto';
import { canonicalBytes } from './canonical.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
export const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * The one hashing rule in this protocol (spec §5.1): base64url SHA-256 of a document's
 * full published canonical bytes, signature fields included. Same value in `prev`, in a
 * manifest's item commitments, and in a pin.
 */
export function documentHash(doc) {
  return b64u(sha256(canonicalBytes(doc)));
}

/**
 * Constant-time compare for hashes and signatures (spec §13.7).
 *
 * Non-strings are unequal to everything, including each other. Coercing them was a latent
 * fail-open: `String(undefined)` is `"undefined"` twice over, so a comparison of two absent
 * fields returned **true** — and every caller here is asking "does this hash match", where the
 * honest answer about two things that are not hashes is no. Every current caller happens to be
 * guarded by a shape check upstream, which is exactly the kind of protection that survives until
 * somebody adds a caller.
 */
export function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
