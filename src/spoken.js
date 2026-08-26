// §3.7 — the spoken code: six words derived from a key, for the phone call. It distinguishes
// identities; it cannot distinguish two branches of one, which is why it is defined over any key.
import crypto from 'node:crypto';
import { decodeStrict } from './file.js';
import { WORDS } from './wordlist.js';

export function spokenIndices(x) {
  const key = decodeStrict(x, 32);
  if (!key) throw new TypeError('not a 43-character base64url key');
  const bits = Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), 'openfeed/v1/spoken', 9));
  let acc = 0n;
  for (const b of bits) acc = (acc << 8n) | BigInt(b);
  return Array.from({ length: 6 }, (_, i) => Number((acc >> BigInt(72 - 11 * (i + 1))) & 0x7ffn));
}
export const spokenCode = (x) => spokenIndices(x).map((i) => WORDS[i]);
