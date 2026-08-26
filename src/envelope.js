// §6 — encrypted content. One X25519 ephemeral per message; per recipient a blinded tag, a wrapped
// content key; the content under a single-use key with the post binding as associated data; the
// audience inside, naming people. And §4.4's encrypted media file.
import crypto from 'node:crypto';
import { parseBody } from './file.js';

export const INFO = 'openfeed/v1/slot';
const ZERO12 = Buffer.alloc(12);
const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

export const readingPublicKey = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });
export const newReadingKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519'); return { privateKey, x: publicKey.export({ format: 'jwk' }).x }; };
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
export const readingKeyFromSeed = (seed) => { const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' }); return { privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x }; };

const aead = (key, nonce, data, aad) => { const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: data.length }); return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]); };
const unaead = (key, nonce, data, aad) => { const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); d.setAAD(aad, { plaintextLength: data.length - 16 }); d.setAuthTag(data.subarray(-16)); return Buffer.concat([d.update(data.subarray(0, -16)), d.final()]); };
const slotKeys = (z, epk) => { const k = Buffer.from(crypto.hkdfSync('sha256', z, epk, INFO, 52)); return { tag: k.subarray(0, 8), kek: k.subarray(8, 40), knonce: k.subarray(40, 52) }; };
// §6.2: the content's associated data is the ephemeral key and the post binding — the author's
// anchor key and the post number — so an envelope lifted into another post does not open there.
const bindAAD = (epk, binding) => Buffer.concat([epk, Buffer.from(binding, 'ascii')]);
export const postBinding = (anchor, number) => `${anchor}:${number}`;

/**
 * Encrypt `content` to `audience` — entries `{ key, read, location }` (§6.4) — for the post at `binding`.
 * `random`, `ephemeral`, `contentKey` are seams for reproducible vectors and nothing else.
 */
export function encrypt({ content, audience, binding, random = crypto.randomBytes, ephemeral, contentKey }) {
  if (typeof binding !== 'string' || !binding) throw new TypeError('a binding is required (§6.2)');
  if (!Array.isArray(audience) || !audience.every((a) => a && typeof a.key === 'string' && typeof a.read === 'string' && typeof a.location === 'string')) throw new TypeError('audience entries are {key, read, location} (§6.4)');
  const eph = ephemeral ?? newReadingKey();
  const epk = unb64(eph.x);
  const ck = contentKey ?? random(32);
  const plain = Buffer.from(JSON.stringify({ audience, ...content }), 'utf8');
  parseBody(plain);                                                 // §2.4 holds inside the envelope: refuse to emit what a reader rejects
  const slots = audience.map((a) => {
    const { tag, kek, knonce } = slotKeys(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: readingPublicKey(a.read) }), epk);
    return [b64(tag), b64(aead(kek, knonce, ck, epk))];
  });
  return { ephemeral: eph.x, slots, ciphertext: b64(aead(ck, ZERO12, plain, bindAAD(epk, binding))) };
}

/** Open an envelope with a reading key for the post at `binding`. Null when it is not for us. */
export function decrypt(env, privateKey, binding) {
  if (!env || typeof env.ephemeral !== 'string' || !Array.isArray(env.slots) || typeof env.ciphertext !== 'string') return null;
  let epk, tag, kek, knonce;
  try { epk = unb64(env.ephemeral); ({ tag, kek, knonce } = slotKeys(crypto.diffieHellman({ privateKey, publicKey: readingPublicKey(env.ephemeral) }), epk)); } catch { return null; }
  for (const slot of env.slots) {
    if (!Array.isArray(slot) || typeof slot[0] !== 'string' || typeof slot[1] !== 'string') continue;
    const t = unb64(slot[0]);
    if (t.length !== tag.length || !crypto.timingSafeEqual(t, tag)) continue;    // a tag is a hint: a malformed or colliding one is a slot to skip
    let ck; try { ck = unaead(kek, knonce, unb64(slot[1]), epk); } catch { continue; }
    let plain; try { plain = unaead(ck, ZERO12, unb64(env.ciphertext), bindAAD(epk, binding)); } catch { return null; }
    try { return parseBody(plain); } catch { return null; }              // §2.4 applies to the plaintext too
  }
  return null;
}

// ---- §4.4: a encrypted media file ----
/** Returns `{ bytes, hash, key }`: the ciphertext to list and serve, its address, and the key for the envelope. */
export function encryptMedia(plain, random = crypto.randomBytes) {
  const key = random(32);
  const bytes = aead(key, ZERO12, plain, Buffer.alloc(0));
  return { bytes, hash: crypto.createHash('sha256').update(bytes).digest('base64url'), key: b64(key) };
}
export function decryptMedia(bytes, key) { try { return unaead(unb64(key), ZERO12, bytes, Buffer.alloc(0)); } catch { return null; } }
