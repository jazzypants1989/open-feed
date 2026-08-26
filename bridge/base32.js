// Base32 encoding (RFC 4648, lowercase), used for did:plc hash encoding.
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function encode(bytes) {
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    out += ALPHABET[parseInt(chunk, 2)];
  }
  return out;
}
