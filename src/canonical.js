// RFC 8785 canonicalization and RFC 7493 (I-JSON) strict parsing.
//
// Spec §6.3 makes both a MUST: documents are signed as canonical bytes, and a parser
// that silently accepts duplicate member names lets one set of bytes verify under two
// readings. `JSON.parse` keeps the last duplicate without complaint, so the parser here
// is hand-written rather than delegated.

export class CanonicalError extends Error {}
export class JsonError extends Error {}

// ---- canonicalization (RFC 8785) ----

function serializeString(s, where) {
  // Reject lone surrogates: RFC 8785 canonicalizes well-formed Unicode only, and
  // JSON.stringify would otherwise escape them into bytes no other implementation
  // would reproduce from the same source text.
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalError(`lone high surrogate at index ${i}${where}`);
      }
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      throw new CanonicalError(`lone low surrogate at index ${i}${where}`);
    }
  }
  // V8's JSON.stringify already matches RFC 8785 §3.2.2.2: shortest escape for the
  // control characters that have one, lowercase \u00xx for the rest, non-ASCII raw.
  return JSON.stringify(s);
}

/**
 * §6.3's interoperable-range rule, stated once so the producer and the parser cannot drift.
 *
 * The test is on the form the value **canonicalizes to**, never on the source token. Those are
 * different things and testing the token gets it wrong in both directions: `1e17` and
 * `100000000000000000` are one value that canonicalizes to one byte string, so they must be
 * accepted or rejected together, and a token test accepts the first and rejects the second.
 * Canonical bytes are the signature payload; the token a publisher happened to type is not.
 *
 * What is being excluded is an **integer-form** canonical token beyond ±(2⁵³−1). A wider
 * integer type preserves such a token exactly while a double implementation silently rounds it,
 * so two conforming-looking verifiers hash different payloads from one document, and the fork
 * has no other symptom. Values large enough that RFC 8785 emits them in exponent form (≥1e21)
 * are unambiguous under any reading and pass — as does every fraction.
 */
function outsideInteroperableRange(n, canonical) {
  return !/[.eE]/.test(canonical) && (n > Number.MAX_SAFE_INTEGER || n < -Number.MAX_SAFE_INTEGER);
}

function serializeNumber(n) {
  if (!Number.isFinite(n)) throw new CanonicalError(`non-finite number: ${n}`);
  // RFC 8785 §3.2.2.3 defers to ECMAScript Number::toString, which is what
  // JSON.stringify applies; -0 renders as "0" under that rule.
  const out = JSON.stringify(n);
  if (outsideInteroperableRange(n, out)) {
    throw new CanonicalError(`integer ${out} is outside I-JSON's interoperable range (§6.3)`);
  }
  return out;
}

/** Serialize a value to RFC 8785 canonical JSON text. */
export function canonicalize(value, path = '') {
  const where = path ? ` (at ${path})` : '';
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number') return serializeNumber(value);
  if (t === 'string') return serializeString(value, where);
  if (t === 'bigint') throw new CanonicalError(`BigInt is not representable in I-JSON${where}`);
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new CanonicalError(`${t} is not representable in JSON${where}`);
  }

  if (Array.isArray(value)) {
    return '[' + value.map((v, i) => canonicalize(v, `${path}[${i}]`)).join(',') + ']';
  }

  if (t === 'object') {
    // RFC 8785 §3.2.3 sorts by UTF-16 code unit, which is what the default
    // string comparison in Array.prototype.sort already does.
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => {
      // The producer half of the parser's rejection below. A document can acquire an own
      // `__proto__` member without going through this parser — `JSON.parse` creates one — and
      // serializing it would emit bytes this implementation cannot read back, while any copy
      // loop that rebuilds the object with `out[k] = v` would silently drop it. Refusing in
      // both directions keeps one answer instead of two that disagree.
      if (k === '__proto__') throw new CanonicalError(`reserved member name "__proto__"${where}`);
      const v = value[k];
      if (v === undefined) throw new CanonicalError(`undefined value at key ${JSON.stringify(k)}${where}`);
      return serializeString(k, where) + ':' + canonicalize(v, path ? `${path}.${k}` : k);
    });
    return '{' + parts.join(',') + '}';
  }

  throw new CanonicalError(`not representable: ${t}${where}`);
}

/** Canonical bytes, the form everything in this protocol is signed and hashed over. */
export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

/**
 * A chained document MUST arrive as its own canonicalization (§6.3).
 *
 * §5.1 says every hash in this protocol is over "full published canonical bytes", and §5.4
 * requires retained versions served byte-identically — but a consumer that re-canonicalizes
 * whatever it parsed never checks either. That leniency is not neutral: it is the difference
 * between a pin committing *the bytes this consumer was served* and a pin committing a
 * normalization of them, and every parser divergence between two implementations lives in the
 * gap. One byte compare closes it, and it costs a comparison a consumer has already paid for.
 *
 * Items are the deliberate exception, and cannot be otherwise: an item is a member of an array
 * inside a feed document and has no byte range of its own, so its "published bytes" are
 * necessarily this function's *output* rather than something to compare against. That is why
 * parser equivalence is load-bearing rather than a tidiness argument (§6.3).
 */
export function assertCanonicalBytes(doc, bytes, where = 'document') {
  const expected = canonicalBytes(doc);
  const served = Buffer.from(bytes);
  if (!served.equals(expected)) {
    let at = 0;
    while (at < served.length && at < expected.length && served[at] === expected[at]) at++;
    throw new CanonicalError(
      `${where} is not served as canonical JSON (§6.3): ${served.length} bytes served, ` +
        `${expected.length} canonical, first difference at byte ${at} ` +
        `(${JSON.stringify(served.subarray(at, at + 24).toString('utf8'))} vs ` +
        `${JSON.stringify(expected.subarray(at, at + 24).toString('utf8'))})`,
    );
  }
  return expected;
}

// ---- I-JSON parsing (RFC 7493) ----

const NUMBER_RE = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
  }

  error(msg) {
    return new JsonError(`${msg} at offset ${this.i}`);
  }

  skipWs() {
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') this.i++;
      else break;
    }
  }

  expect(ch) {
    if (this.s[this.i] !== ch) throw this.error(`expected ${JSON.stringify(ch)}`);
    this.i++;
  }

  parseValue(depth = 0) {
    if (depth > 200) throw this.error('nesting too deep');
    this.skipWs();
    if (this.i >= this.s.length) throw this.error('unexpected end of input');
    const c = this.s[this.i];
    if (c === '{') return this.parseObject(depth);
    if (c === '[') return this.parseArray(depth);
    if (c === '"') return this.parseString();
    if (this.s.startsWith('true', this.i)) return (this.i += 4), true;
    if (this.s.startsWith('false', this.i)) return (this.i += 5), false;
    if (this.s.startsWith('null', this.i)) return (this.i += 4), null;
    return this.parseNumber();
  }

  parseObject(depth) {
    this.expect('{');
    const out = {};
    const seen = new Set();
    this.skipWs();
    if (this.s[this.i] === '}') return this.i++, out;
    for (;;) {
      this.skipWs();
      if (this.s[this.i] !== '"') throw this.error('expected member name');
      const key = this.parseString();
      // The rule this whole parser exists for (spec §6.3, RFC 7493).
      if (seen.has(key)) throw this.error(`duplicate member name ${JSON.stringify(key)}`);
      // §6.3's second rejection, and it is a security rule rather than a taste one. In
      // JavaScript `out[key] = v` for the member name `__proto__` invokes the prototype setter
      // instead of creating a member: the value vanishes from `Object.keys` and therefore from
      // `canonicalize`, while every property read downstream still sees it. Append
      // `"__proto__":{"_openfeed":{"deleted":true}}` to somebody else's signed item and the signature, the
      // manifest hash, and the pin all still check out while the item reads as tombstoned.
      // `JSON.parse` disagrees — it defines an own property — so the same source text
      // canonicalizes two ways in two conforming verifiers, which is exactly the signature
      // confusion I-JSON strictness exists to close, arriving through a member name RFC 7493
      // says nothing about. Rejecting is the fail-closed answer and needs no care anywhere
      // else: a name with no legitimate use here cannot be mishandled if it never parses.
      if (key === '__proto__') throw this.error('reserved member name "__proto__"');
      seen.add(key);
      this.skipWs();
      this.expect(':');
      out[key] = this.parseValue(depth + 1);
      this.skipWs();
      const c = this.s[this.i];
      if (c === ',') { this.i++; continue; }
      if (c === '}') { this.i++; return out; }
      throw this.error('expected "," or "}"');
    }
  }

  parseArray(depth) {
    this.expect('[');
    const out = [];
    this.skipWs();
    if (this.s[this.i] === ']') return this.i++, out;
    for (;;) {
      out.push(this.parseValue(depth + 1));
      this.skipWs();
      const c = this.s[this.i];
      if (c === ',') { this.i++; continue; }
      if (c === ']') { this.i++; return out; }
      throw this.error('expected "," or "]"');
    }
  }

  parseString() {
    this.expect('"');
    let out = '';
    for (;;) {
      if (this.i >= this.s.length) throw this.error('unterminated string');
      const c = this.s[this.i];
      if (c === '"') { this.i++; return out; }
      if (c === '\\') {
        this.i++;
        const e = this.s[this.i];
        if (e === 'u') {
          const hex = this.s.slice(this.i + 1, this.i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.error('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 5;
        } else if (e in ESCAPES) {
          out += ESCAPES[e];
          this.i++;
        } else {
          throw this.error(`bad escape \\${e}`);
        }
        continue;
      }
      const code = this.s.charCodeAt(this.i);
      if (code < 0x20) throw this.error('unescaped control character in string');
      out += c;
      this.i++;
    }
  }

  parseNumber() {
    const m = NUMBER_RE.exec(this.s.slice(this.i));
    if (!m) throw this.error('invalid value');
    const token = m[0];
    this.i += token.length;
    const n = Number(token);
    if (!Number.isFinite(n)) throw this.error('non-finite number');
    // §6.3, the consumer half — the *same* predicate the producer applies, against the same
    // canonical form, because a parser and a serializer that disagree about one rule accept
    // documents they cannot round-trip. The error names both forms: `1e17` is rejected not
    // because the token is out of range but because it canonicalizes to one that is, and a
    // publisher told only "1e17 is invalid" would reasonably disbelieve it.
    const canonical = JSON.stringify(n);
    if (outsideInteroperableRange(n, canonical)) {
      throw this.error(
        `number ${token} canonicalizes to ${canonical}, outside I-JSON's interoperable range (§6.3)`,
      );
    }
    return n;
  }
}

/**
 * Parse JSON with I-JSON strictness: duplicate member names are rejected rather than
 * silently collapsed, and lone surrogates are rejected so parse/canonicalize round-trips.
 */
export function parseIJSON(text) {
  const p = new Parser(text);
  const value = p.parseValue();
  p.skipWs();
  if (p.i < p.s.length) throw p.error('trailing content after top-level value');
  // Surfaces lone surrogates introduced by \u escapes at parse time rather than later.
  canonicalize(value);
  return value;
}
