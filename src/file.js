// §2 — the file format. A signed file is its body bytes, one `\n`, then an Ed25519 signature over
// the body; its address is the SHA-256 of the body. There is no canonical form anywhere: a producer
// serializes once and signs what it serialized, and a verifier hashes and verifies what it received.
//
// This module is the only place the format is known. Everything above it handles `{ obj, body,
// address, by }` records and never splits bytes itself.
import crypto from 'node:crypto';

export class FileError extends Error {
  constructor(message, code) { super(message); this.name = 'FileError'; this.code = code; }
}

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('base64url');

// §2.1: an 86-character base64url line that re-encodes to itself. Both halves are needed — base64
// admits several spellings of one 64-byte value, and a verifier accepting more than one accepts a
// file that is not byte-identical to the one signed. The same rule reads every 43-character key.
export function decodeStrict(text, bytes) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const b = Buffer.from(text, 'base64url');
  if (b.length !== bytes || b.toString('base64url') !== text) return null;
  return b;
}

// ---- keys ----
export const publicKey = (x) => {
  if (!decodeStrict(x, 32)) throw new FileError('not a 43-character base64url key', 'bad_key');
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
};
export const newSigningKey = () => {
  const { privateKey, publicKey: pk } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, x: pk.export({ format: 'jwk' }).x };
};
// A deterministic key from a label — for tests and vectors, never for a real identity.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
export const signingKeyFromSeed = (seed) => {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  return { privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
};

// ---- §2.4 JSON hygiene: the parser ----
// JSON.parse cannot see a duplicate member, treats `__proto__` as an ordinary member, silently rounds
// an integer past 2^53, and keeps a lone surrogate. This parser rejects all four, and the body-level
// rules of §2.1 (UTF-8, no BOM, no `\n`, a JSON object) sit in `parseBody` around it.
const NUMBER_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
class Parser {
  constructor(text) { this.s = text; this.i = 0; }
  error(msg) { return new FileError(`${msg} at offset ${this.i}`, 'bad_json'); }
  skipWs() { while (this.i < this.s.length && ' \t\n\r'.includes(this.s[this.i])) this.i++; }
  expect(ch) { if (this.s[this.i] !== ch) throw this.error(`expected ${JSON.stringify(ch)}`); this.i++; }
  value(depth = 0) {
    if (depth > 200) throw this.error('nesting too deep');
    this.skipWs();
    if (this.i >= this.s.length) throw this.error('unexpected end of input');
    const c = this.s[this.i];
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"') return this.string();
    if (this.s.startsWith('true', this.i)) return (this.i += 4), true;
    if (this.s.startsWith('false', this.i)) return (this.i += 5), false;
    if (this.s.startsWith('null', this.i)) return (this.i += 4), null;
    return this.number();
  }
  object(depth) {
    this.expect('{');
    const out = {}, seen = new Set();
    this.skipWs();
    if (this.s[this.i] === '}') return this.i++, out;
    for (;;) {
      this.skipWs();
      if (this.s[this.i] !== '"') throw this.error('expected member name');
      const key = this.string();
      if (seen.has(key)) throw this.error(`duplicate member name ${JSON.stringify(key)}`);
      if (key === '__proto__') throw this.error('reserved member name "__proto__"');
      seen.add(key);
      this.skipWs(); this.expect(':');
      out[key] = this.value(depth + 1);
      this.skipWs();
      const c = this.s[this.i];
      if (c === ',') { this.i++; continue; }
      if (c === '}') { this.i++; return out; }
      throw this.error('expected "," or "}"');
    }
  }
  array(depth) {
    this.expect('[');
    const out = [];
    this.skipWs();
    if (this.s[this.i] === ']') return this.i++, out;
    for (;;) {
      out.push(this.value(depth + 1));
      this.skipWs();
      const c = this.s[this.i];
      if (c === ',') { this.i++; continue; }
      if (c === ']') { this.i++; return out; }
      throw this.error('expected "," or "]"');
    }
  }
  string() {
    this.expect('"');
    let out = '';
    for (;;) {
      if (this.i >= this.s.length) throw this.error('unterminated string');
      const c = this.s[this.i];
      if (c === '"') { this.i++; break; }
      if (c === '\\') {
        this.i++;
        const e = this.s[this.i];
        if (e === 'u') {
          const hex = this.s.slice(this.i + 1, this.i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.error('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 5;
        } else if (e in ESCAPES) { out += ESCAPES[e]; this.i++; } else throw this.error(`bad escape \\${e}`);
        continue;
      }
      if (this.s.charCodeAt(this.i) < 0x20) throw this.error('unescaped control character in string');
      out += c; this.i++;
    }
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(out)) throw this.error('unpaired surrogate in string');
    return out;
  }
  number() {
    const m = NUMBER_RE.exec(this.s.slice(this.i));
    if (!m) throw this.error('invalid value');
    const token = m[0];
    this.i += token.length;
    // The integer rule is on the source token, since there is no canonical form to compare to.
    if (/^-?\d+$/.test(token) && (BigInt(token) > 9007199254740991n || BigInt(token) < -9007199254740991n)) throw this.error(`integer ${token} outside ±(2^53 − 1)`);
    const n = Number(token);
    if (!Number.isFinite(n)) throw this.error('non-finite number');
    return n;
  }
}
export function parseStrict(text) {
  const p = new Parser(text);
  const v = p.value();
  p.skipWs();
  if (p.i < p.s.length) throw p.error('trailing content after top-level value');
  return v;
}

/** §2.1's body rules plus §2.4's parser: a UTF-8 JSON object, no BOM, no `\n`. */
export function parseBody(body) {
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) throw new FileError('body starts with a byte-order mark', 'bad_body');
  if (body.includes(0x0a)) throw new FileError('body contains a newline', 'bad_body');
  const text = body.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(body) !== 0) throw new FileError('body is not valid UTF-8', 'bad_body');
  const obj = parseStrict(text);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new FileError('body is not a JSON object', 'bad_body');
  return obj;
}

// ---- files ----
/** Body, one newline, signature line. The body is serialized exactly once, here. */
export function signFile(obj, key) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  if (body.includes(0x0a)) throw new FileError('serialized body contains a newline', 'bad_body');
  parseBody(body);                                                   // §2.4's producer half: never emit what a reader rejects
  const sig = crypto.sign(null, body, key.privateKey).toString('base64url');
  return Buffer.concat([body, Buffer.from('\n'), Buffer.from(sig, 'ascii')]);
}

export function splitFile(bytes) {
  const i = bytes.lastIndexOf(0x0a);
  if (i < 0) return null;
  return { body: bytes.subarray(0, i), sigLine: bytes.subarray(i + 1).toString('latin1') };
}

/** The address of a file is the hash of its body — never of the whole file (§2.2). */
export const address = (bytes) => { const s = splitFile(bytes); return s ? sha256(s.body) : null; };

/**
 * Verify a file under one key or a list of keys. Returns `{ obj, body, address, by }` or null;
 * never throws on hostile input — a file that does not verify is simply not a file.
 */
export function verifyFile(bytes, keys) {
  const s = splitFile(bytes);
  if (!s) return null;
  const sig = decodeStrict(s.sigLine, 64);
  if (!sig) return null;
  let by = null;
  for (const x of [keys].flat()) {
    try { if (crypto.verify(null, s.body, publicKey(x), sig)) { by = x; break; } } catch { /* a malformed key verifies nothing */ }
  }
  if (!by) return null;
  let obj;
  try { obj = parseBody(s.body); } catch { return null; }
  return { obj, body: s.body, address: sha256(s.body), by };
}
