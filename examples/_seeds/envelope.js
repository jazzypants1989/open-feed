// The envelope, §6 of open-feed-spec.md. Extracted from envelope-gate.js once the construction
// stopped being on trial (the gate proved it; the owner ruled the floor a SHOULD and the carrier
// binding a MUST), so that the gate and tools/regen.js share ONE implementation and a vector cannot
// drift from the thing it is a vector for.
//
// Shape: {epk, slots:[[tag, wrapped]...], ct}. One X25519 ephemeral per message. Per slot:
// Z = X25519(eph, recipient); tag(8) || kek(32) || knonce(12) = HKDF-SHA256(Z, salt = epk,
// info = 'openfeed/v1/slot'); wrapped = ChaCha20-Poly1305(kek, knonce, content key, aad = epk).
// Content: ChaCha20-Poly1305(content key, nonce = 12 zero bytes — the key is single-use, as in
// HPKE — padded plaintext, aad = epk || carrier). The audience is the first thing in the plaintext.
// Padding: a 2-byte length, then zeros to a bucket.
import crypto from 'node:crypto';

export const INFO = 'openfeed/v1/slot';
const ZERO12 = Buffer.alloc(12);
export const b64 = (b) => Buffer.from(b).toString('base64url');
export const unb64 = (s) => Buffer.from(s, 'base64url');
export const xPub = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });

const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
// A deterministic X25519 key from a label — for vectors and gates, never for a real identity.
export const xKey = (label) => {
  const seed = crypto.createHash('sha256').update(`envelope:${label}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  return { label, privateKey, publicKey, x: publicKey.export({ format: 'jwk' }).x };
};

const aead = (key, nonce, data, aad) => { const c = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: data.length }); return Buffer.concat([c.update(data), c.final(), c.getAuthTag()]); };
const unaead = (key, nonce, data, aad) => { const d = crypto.createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }); d.setAAD(aad, { plaintextLength: data.length - 16 }); d.setAuthTag(data.subarray(-16)); return Buffer.concat([d.update(data.subarray(0, -16)), d.final()]); };
const slotKeys = (z, epk) => { const k = Buffer.from(crypto.hkdfSync('sha256', z, epk, INFO, 52)); return { tag: k.subarray(0, 8), kek: k.subarray(8, 40), knonce: k.subarray(40, 52) }; };
// The carrier binding (§6.2): the content AEAD's associated data is the ephemeral key and the
// carrier's author key and number, so an envelope lifted into another post will not open there.
const bindAAD = (epk, carrier) => Buffer.concat([epk, Buffer.from(carrier)]);
export const carrierOf = (anchor, n) => `${anchor}:${n}`;
export const bucket = (n, floor) => Math.max(floor, 1 << Math.ceil(Math.log2(Math.max(n, 1))));
export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 8, bodyFloor: 512 } };

export function encrypt({ content, audience, carrier = '', policy = 'floor', ephemeral, ck, random = crypto.randomBytes }) {
  const { slotFloor, bodyFloor } = POLICY[policy];
  const eph = ephemeral ?? xKey(`eph:${b64(crypto.randomBytes(8))}`);
  const epk = unb64(eph.x);
  const contentKey = ck ?? crypto.randomBytes(32);
  // The audience is encrypted inside the content, first, so a recipient learns who else can reply.
  const plain = Buffer.from(JSON.stringify({ audience, ...content }), 'utf8');
  if (plain.length > 65535) throw new RangeError('encrypted plaintext is limited to 65,535 bytes (§6.1)');
  const padded = Buffer.alloc(bucket(plain.length + 2, bodyFloor));
  padded.writeUInt16BE(plain.length, 0); plain.copy(padded, 2);
  const slots = audience.map((a) => a.read ?? a).map((x) => {          // an entry may be a key or {key, read, at}
    const { tag, kek, knonce } = slotKeys(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: xPub(x) }), epk);
    return [b64(tag), b64(aead(kek, knonce, contentKey, epk))];
  });
  // Dummy slots to the bucket: random bytes — a tag nobody can derive and a wrap nobody can open,
  // and nothing a recipient holds regenerates them (or a recipient counts the true audience).
  // `random` is injectable so a test vector reproduces; production leaves it alone.
  for (let i = slots.length; i < bucket(slots.length, slotFloor); i++) {
    const d = random(56);
    slots.push([b64(d.subarray(0, 8)), b64(d.subarray(8))]);
  }
  return { epk: eph.x, slots, ct: b64(aead(contentKey, ZERO12, padded, bindAAD(epk, carrier))) };
}

// The tag is a hint, never a decision: a matching tag whose unwrap fails is a collision, keep scanning.
export function decrypt(env, privateKey, carrier = '') {
  const epk = unb64(env.epk);
  const { tag, kek, knonce } = slotKeys(crypto.diffieHellman({ privateKey, publicKey: xPub(env.epk) }), epk);
  for (const [t, w] of env.slots) {
    const tb = unb64(t);
    if (tb.length !== tag.length || !crypto.timingSafeEqual(tb, tag)) continue;   // a malformed tag is a slot to skip, not a crash
    let contentKey; try { contentKey = unaead(kek, knonce, unb64(w), epk); } catch { continue; }
    // The slot opened, so the key is right; if the content does not, the envelope is not for this
    // carrier. That is the binding refusing, and it is the only way this function says no after a match.
    let padded; try { padded = unaead(contentKey, ZERO12, unb64(env.ct), bindAAD(epk, carrier)); } catch { return null; }
    const len = padded.readUInt16BE(0);
    if (len + 2 > padded.length) return null;                                      // a length past the body is a forgery of the author's own making
    return JSON.parse(padded.subarray(2, 2 + len).toString('utf8'));
  }
  return null;
}
