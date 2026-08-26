// Base58btc encoding (Bitcoin alphabet), used for did:key multibase encoding.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = '';
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s || '1';
}

export function decode(str) {
  let n = 0n;
  for (const c of str) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`invalid base58 character: ${c}`);
    n = n * 58n + BigInt(i);
  }
  const hex = n.toString(16);
  const bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  let leading = 0;
  for (const c of str) { if (c !== '1') break; leading++; }
  return Buffer.concat([Buffer.alloc(leading), bytes]);
}
