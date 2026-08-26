// Minimal DAG-CBOR encoder for AT Protocol. Covers: unsigned integers, negative integers,
// strings, bytes, arrays, maps (keys sorted lexically), null, booleans.
// Maps always have string keys sorted by byte value (DAG-CBOR determinism).

function encodeLength(major, n) {
  const m = major << 5;
  if (n < 24) return Buffer.from([m | n]);
  if (n < 0x100) return Buffer.from([m | 24, n]);
  if (n < 0x10000) { const b = Buffer.alloc(3); b[0] = m | 25; b.writeUInt16BE(n, 1); return b; }
  if (n < 0x100000000) { const b = Buffer.alloc(5); b[0] = m | 26; b.writeUInt32BE(n, 1); return b; }
  const b = Buffer.alloc(9); b[0] = m | 27; b.writeBigUInt64BE(BigInt(n), 1); return b;
}

export function encode(value) {
  if (value === null) return Buffer.from([0xf6]);
  if (value === true) return Buffer.from([0xf5]);
  if (value === false) return Buffer.from([0xf4]);

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      const b = Buffer.alloc(9);
      b[0] = 0xfb;
      b.writeDoubleBE(value, 1);
      return b;
    }
    if (value >= 0) return encodeLength(0, value);
    return encodeLength(1, -value - 1);
  }

  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([encodeLength(3, bytes.length), bytes]);
  }

  if (Buffer.isBuffer(value)) {
    return Buffer.concat([encodeLength(2, value.length), value]);
  }

  if (Array.isArray(value)) {
    const items = value.map(encode);
    return Buffer.concat([encodeLength(4, value.length), ...items]);
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => {
      const ab = Buffer.from(a, 'utf8'), bb = Buffer.from(b, 'utf8');
      const len = Math.min(ab.length, bb.length);
      for (let i = 0; i < len; i++) { if (ab[i] !== bb[i]) return ab[i] - bb[i]; }
      return ab.length - bb.length;
    });
    const pairs = keys.map(k => Buffer.concat([encode(k), encode(value[k])]));
    return Buffer.concat([encodeLength(5, keys.length), ...pairs]);
  }

  throw new Error(`unsupported type: ${typeof value}`);
}
