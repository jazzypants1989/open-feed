// §6 — encrypted content. One X25519 ephemeral per message; per recipient a blinded tag, a wrapped
// content key; the content under a single-use key with the carrier bound as associated data; the
// audience inside, naming people; padding to a bucket with random dummies. And §4.4's encrypted media file.
import crypto from 'node:crypto';

export const INFO = 'openfeed/v1/slot';
const ZERO12 = Buffer.alloc(12);
export const MAX_PLAIN = 65535;
const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');

export const readingPublicKey = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });
export const newReadingKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519'); return { privateKey, x: publicKey.export({ format: 'jwk' }).x }; };
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
export const readingKeyFromSeed = (seed) => { const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' }); return { privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x }; };

const aead = (key, nonce, data, aad) => { const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: data.length }); return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]); };
const unaead = (key, nonce, data, aad) => { const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); d.setAAD(aad, { plaintextLength: data.length - 16 }); d.setAuthTag(data.subarray(-16)); return Buffer.concat([d.update(data.subarray(0, -16)), d.final()]); };
const slotKeys = (z, epk) => { const k = Buffer.from(crypto.hkdfSync('sha256', z, epk, INFO, 52)); return { tag: k.subarray(0, 8), kek: k.subarray(8, 40), knonce: k.subarray(40, 52) }; };
// §6.2: the content's associated data is the ephemeral key and the carrier — the author's anchor
// key and the post number — so an envelope lifted into another post does not open there.
const bindAAD = (epk, carrier) => Buffer.concat([epk, Buffer.from(carrier, 'ascii')]);
export const carrierOf = (anchor, n) => `${anchor}:${n}`;
export const bucket = (n, floor) => Math.max(floor, 1 << Math.ceil(Math.log2(Math.max(n, 1))));
export const FLOOR = { slots: 8, body: 512 };

/**
 * Encrypt `content` to `audience` — entries `{ key, read, loc }` (§6.5) — for the post at `carrier`.
 * `policy` is `'floor'` (§6.4's SHOULD) or `'pow2'`; `random`, `ephemeral`, `contentKey` are seams
 * for reproducible vectors and nothing else.
 */
export function encrypt({ content, audience, carrier, policy = 'floor', random = crypto.randomBytes, ephemeral, contentKey }) {
  if (typeof carrier !== 'string' || !carrier) throw new TypeError('a carrier is required (§6.2)');
  if (!Array.isArray(audience) || !audience.every((a) => a && typeof a.key === 'string' && typeof a.read === 'string' && typeof a.loc === 'string')) throw new TypeError('audience entries are {key, read, loc} (§6.5)');
  const { slots: slotFloor, body: bodyFloor } = policy === 'floor' ? FLOOR : { slots: 1, body: 32 };
  const eph = ephemeral ?? newReadingKey();
  const epk = unb64(eph.x);
  const ck = contentKey ?? random(32);
  const plain = Buffer.from(JSON.stringify({ audience, ...content }), 'utf8');
  if (plain.length > MAX_PLAIN) throw new RangeError(`encrypted plaintext is limited to ${MAX_PLAIN} bytes (§6.1)`);
  const padded = Buffer.alloc(bucket(plain.length + 2, bodyFloor));
  padded.writeUInt16BE(plain.length, 0); plain.copy(padded, 2);
  const slots = audience.map((a) => {
    const { tag, kek, knonce } = slotKeys(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: readingPublicKey(a.read) }), epk);
    return [b64(tag), b64(aead(kek, knonce, ck, epk))];
  });
  for (let i = slots.length; i < bucket(slots.length, slotFloor); i++) { const d = random(56); slots.push([b64(d.subarray(0, 8)), b64(d.subarray(8))]); }
  return { epk: eph.x, slots, ct: b64(aead(ck, ZERO12, padded, bindAAD(epk, carrier))) };
}

/** Open an envelope with a reading key for the post at `carrier`. Null when it is not for us. */
export function decrypt(env, privateKey, carrier) {
  if (!env || typeof env.epk !== 'string' || !Array.isArray(env.slots) || typeof env.ct !== 'string') return null;
  let epk, tag, kek, knonce;
  try { epk = unb64(env.epk); ({ tag, kek, knonce } = slotKeys(crypto.diffieHellman({ privateKey, publicKey: readingPublicKey(env.epk) }), epk)); } catch { return null; }
  for (const slot of env.slots) {
    if (!Array.isArray(slot) || typeof slot[0] !== 'string' || typeof slot[1] !== 'string') continue;
    const t = unb64(slot[0]);
    if (t.length !== tag.length || !crypto.timingSafeEqual(t, tag)) continue;    // a tag is a hint: a malformed or colliding one is a slot to skip
    let ck; try { ck = unaead(kek, knonce, unb64(slot[1]), epk); } catch { continue; }
    let padded; try { padded = unaead(ck, ZERO12, unb64(env.ct), bindAAD(epk, carrier)); } catch { return null; }
    const len = padded.readUInt16BE(0);
    if (len + 2 > padded.length) return null;
    try { return JSON.parse(padded.subarray(2, 2 + len).toString('utf8')); } catch { return null; }
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
