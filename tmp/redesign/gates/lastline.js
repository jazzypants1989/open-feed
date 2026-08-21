// Shared model for the fresh-start candidate gates (HANDOFF-fresh-start.md): last-line signed
// files, the [n, hash] head, the profile succession chain, the recovery commitment, a CAS store.
// CANDIDATE code — it tests a design on trial and imports nothing from src/, because the design
// shares no construction with the shipped spec. Every new gate imports from here so a rule
// (strict spelling, hash-of-body, the separator check) lives in exactly one place.
import crypto from 'node:crypto';

export class GateError extends Error {}

// Keys are derived from a name so every number on a card reproduces byte-for-byte.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
export function makeKey(name) {
  const seed = crypto.createHash('sha256').update(`lastline:${name}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  return { name, x: publicKey.export({ format: 'jwk' }).x, privateKey, publicKey };
}
export const keyObj = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
export const H = (bytes) => crypto.createHash('sha256').update(bytes).digest('base64url');

// ---- the signature line ----
// Strict: exactly 86 base64url characters whose canonical re-encoding is themselves. Lenient is
// what every decisions/*-exp.js does, kept here only so a gate can measure the difference.
export const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
export function decodeStrict(s) {
  if (typeof s !== 'string' || !SIG_RE.test(s)) throw new GateError('signature: not 86 base64url characters');
  const buf = Buffer.from(s, 'base64url');
  if (buf.toString('base64url') !== s) throw new GateError('signature: non-canonical spelling');
  return buf;
}
export const decodeLenient = (s) => Buffer.from(s, 'base64url');

// ---- the file ----
// A signed file is its body bytes, one 0x0a, then the signature over the body. The producer
// serializes once; bodyText lets a gate hand in bytes it wrote by hand.
export function sign(obj, key, { bodyText } = {}) {
  const body = Buffer.from(bodyText ?? JSON.stringify(obj), 'utf8');
  const sig = crypto.sign(null, body, key.privateKey).toString('base64url');
  return Buffer.concat([body, Buffer.from('\n'), Buffer.from(sig, 'ascii')]);
}
export function split(file) {
  const s = file.lastIndexOf(0x0a);
  if (s < 0) throw new GateError('file: no separator');
  return { body: file.subarray(0, s), sigText: file.subarray(s + 1).toString('latin1') };
}
export function verify(file, x, { decode = decodeStrict } = {}) {
  try {
    const { body, sigText } = split(file);
    return crypto.verify(null, body, keyObj(x), decode(sigText));
  } catch { return false; }
}
// The one hashing rule: a file's address is the hash of its BODY, never of the whole file.
export const address = (file) => H(split(file).body);

// ---- reading the body ----
// JSON.parse cannot see a duplicate member, accepts __proto__ as an own property, rounds integers
// past 2^53 silently, and keeps a lone surrogate — all places two conforming readers can disagree
// about signed bytes. This scanner rejects each of them, plus a leading BOM.
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
const MAX = 9007199254740991n;
export function parseStrict(text) {
  if (text.charCodeAt(0) === 0xfeff) throw new GateError('json: leading BOM');
  const stack = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      const str = JSON.parse(text.slice(i, j + 1));
      if (LONE.test(str)) throw new GateError('json: lone surrogate');
      if (expectKey) {
        const keys = stack[stack.length - 1];
        if (str === '__proto__') throw new GateError('json: __proto__ member');
        if (keys.has(str)) throw new GateError(`json: duplicate member "${str}"`);
        keys.add(str);
        expectKey = false;
      }
      i = j;
    } else if (c === '{') { stack.push(new Set()); expectKey = true; }
    else if (c === '[') { stack.push(null); expectKey = false; }
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') expectKey = stack[stack.length - 1] instanceof Set;
    else if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      if (m && !m[1] && !m[2]) { const n = BigInt(m[0]); if (n > MAX || n < -MAX) throw new GateError('json: integer beyond ±(2^53−1)'); }
      i += (m?.[0].length ?? 1) - 1;
    }
  }
  return JSON.parse(text);
}
export function open(file, x, opts) {
  if (!verify(file, x, opts)) throw new GateError('file: signature invalid');
  const { body, sigText } = split(file);
  return { body, obj: parseStrict(body.toString('utf8')), sigText };
}

// ---- the head ----
// {hseq, prev, entries:[[n, hash]]}; 'entries-first' is the field order claim 2 measures.
export function headBody({ hseq, prev = null, entries }, order = 'prefix') {
  const tail = prev ? { prev } : {};
  const o = order === 'entries-first' ? { entries, hseq, ...tail } : { hseq, ...tail, entries };
  return Buffer.from(JSON.stringify(o), 'utf8');
}
export const makeHead = (fields, key, order) => sign(null, key, { bodyText: headBody(fields, order).toString('utf8') });
// Byte offset just past the ']' that closes the entries array — what a range reader caches.
export function entriesEnd(body) {
  const text = body.toString('latin1');
  let i = text.indexOf('"entries":[');
  if (i < 0) throw new GateError('head: no entries');
  i += '"entries":'.length;
  for (let depth = 0; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']' && --depth === 0) return i + 1;
  }
  throw new GateError('head: entries never close');
}
export const entry = (n, file) => [n, address(file)];
export function admitted(headFile, n, postFile, x) {
  const { obj } = open(headFile, x);
  const e = obj.entries.find(([m]) => m === n);
  return !!e && e[1] === address(postFile);
}

// ---- the profile's succession chain ----
// Hop messages are signed as bare strings because hops are fields, not files.
export const rawSign = (msg, key) => crypto.sign(null, Buffer.from(msg), key.privateKey).toString('base64url');
export const rawOK = (msg, sig, x) => { try { return crypto.verify(null, Buffer.from(msg), keyObj(x), decodeStrict(sig)); } catch { return false; } };
export const commit = (salt, members) => H(Buffer.from(salt + '|' + [...members].sort().join('|')));
export const mkRec = (k, salt, members) => ({ k, commit: commit(salt, members) });
export const rotHop = (from, to) => ({ key: to.x, by: 'rotation', sig: rawSign(`${from.x}->${to.x}`, from) });
export const restoreHop = (from, to, members, vouchers, salt) => ({
  key: to.x, by: 'restore', salt, members: members.map((m) => m.x),
  vouchers: vouchers.map((v) => ({ key: v.x, sig: rawSign(`${from.x}->${to.x}`, v) })),
});
export const recoveryOK = (rec, hop) =>
  commit(hop.salt, hop.members) === rec.commit && hop.vouchers.length >= rec.k && hop.vouchers.every((v) => hop.members.includes(v.key));
export function walkChain(p, { enforceRecovery = true } = {}) {
  if (p.chain[0].key !== p.genesis) return { ok: false, why: 'chain does not start at the genesis' };
  for (let i = 1; i < p.chain.length; i++) {
    const hop = p.chain[i], prev = p.chain[i - 1].key, msg = `${prev}->${hop.key}`;
    if (hop.by === 'rotation') {
      if (!rawOK(msg, hop.sig, prev)) return { ok: false, why: `rotation hop ${i} not signed by the previous key` };
    } else if (hop.by === 'restore') {
      if (!hop.vouchers.every((v) => rawOK(msg, v.sig, v.key))) return { ok: false, why: `restore hop ${i}: a voucher signature is bad` };
      if (enforceRecovery && !recoveryOK(p.recovery, hop)) return { ok: false, why: `restore hop ${i}: does not satisfy the committed list` };
    } else return { ok: false, why: `hop ${i}: unknown kind` };
  }
  return { ok: true, current: p.chain[p.chain.length - 1].key, chainKeys: p.chain.map((h) => h.key) };
}

// ---- the host's store ----
// Fixed-path files (profile, head) are overwritten under compare-and-swap on the served bytes'
// hash; numbered files are created once and never overwritten (ruling 3).
export function casStore() {
  const files = new Map();
  return {
    files,
    get: (path) => files.get(path) ?? null,
    etag: (path) => (files.has(path) ? H(files.get(path)) : null),
    put(path, bytes, ifMatch = null) {
      const cur = files.has(path) ? H(files.get(path)) : null;
      if (cur !== ifMatch) return { ok: false, conflict: true, etag: cur };
      files.set(path, Buffer.from(bytes));
      return { ok: true, etag: H(bytes) };
    },
    create(path, bytes) {
      if (files.has(path)) return { ok: false, exists: true };
      files.set(path, Buffer.from(bytes));
      return { ok: true };
    },
  };
}
