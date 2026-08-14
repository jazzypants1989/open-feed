import crypto from 'node:crypto';
import { canonicalBytes } from './canonical.js';

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
export const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * The one hashing rule in this protocol (spec §5.1): base64url SHA-256 of a document's
 * full published canonical bytes, signature fields included. Same value in `prev`, in a
 * manifest's item commitments, in `checkpoint_hash`, and in a pin.
 */
export function documentHash(doc) {
  return b64u(sha256(canonicalBytes(doc)));
}

/** Constant-time compare for hashes and signatures (spec §13.7). */
export function timingSafeEqualString(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
