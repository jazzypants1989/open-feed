// BIP-340 Schnorr signatures over secp256k1, sign-only, stdlib-only.
// Uses crypto.createECDH('secp256k1') for point multiplication and native BigInt for field math.
import crypto from 'node:crypto';

const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const mod = (a, m = N) => ((a % m) + m) % m;
const b2n = (b) => BigInt('0x' + Buffer.from(b).toString('hex'));
const n2b = (n) => { const h = n.toString(16).padStart(64, '0'); return Buffer.from(h, 'hex'); };

function pointMul(scalar) {
  const ec = crypto.createECDH('secp256k1');
  ec.setPrivateKey(n2b(scalar));
  return ec.getPublicKey(null, 'compressed');
}

function taggedHash(tag, ...data) {
  const th = crypto.createHash('sha256').update(tag).digest();
  const h = crypto.createHash('sha256').update(th).update(th);
  for (const d of data) h.update(d);
  return h.digest();
}

export function schnorrSign(message, privateKey) {
  let d = b2n(privateKey);
  const P = pointMul(d);
  if (P[0] !== 0x02) d = mod(N - d);
  const px = P.subarray(1);
  const a = taggedHash('BIP0340/aux', crypto.randomBytes(32));
  const t = Buffer.from(px);
  for (let i = 0; i < 32; i++) t[i] ^= a[i];
  const rand = taggedHash('BIP0340/nonce', t, px, message);
  let k = mod(b2n(rand));
  if (k === 0n) throw new Error('k is zero');
  const R = pointMul(k);
  if (R[0] !== 0x02) k = mod(N - k);
  const rx = R.subarray(1);
  const e = mod(b2n(taggedHash('BIP0340/challenge', rx, px, message)));
  const sig = Buffer.concat([rx, n2b(mod(k + e * d))]);
  return sig;
}

export function schnorrPubkey(privateKey) {
  const P = pointMul(b2n(privateKey));
  return P.subarray(1);
}

export function newNostrKey() {
  const priv = crypto.randomBytes(32);
  const pub = schnorrPubkey(priv);
  return { privateKey: priv, pubkey: pub.toString('hex') };
}
