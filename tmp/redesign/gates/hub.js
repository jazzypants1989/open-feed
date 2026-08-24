// A hub per open-feed-spec-2.md §9, shared by the review gates so three of them do not each carry
// one. It stores bytes and serves them back exactly; it holds no key. Two knobs exist so a gate can
// stage the text as written beside the repair it proposes:
//   reclaim      'chain'   — §9.5 as first written: "the owner's file" is signed by ANY key in the chain
//                'current' — §9.5 as ruled 2026-08-23 (default): signed by the current key, or listed
//   verifyWrites false     — §9.5's "MAY check nothing on the ordinary path", applied to every file (as first written)
//                true      — §9.4 as ruled (default): refuse a profile whose chain does not walk or whose
//                            signature fails under its tip, and a head not signed by the current key
// The entity tag is the SHA-256 of the bytes served (§9.1 says a hub MAY do that; this one does).
import http from 'node:http';
import crypto from 'node:crypto';

const H = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const pub = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
const split = (f) => { const i = f.lastIndexOf(0x0a); return i < 0 ? null : { body: f.subarray(0, i), sig: f.subarray(i + 1).toString('latin1') }; };
const sigBytes = (s) => { if (!/^[A-Za-z0-9_-]{86}$/.test(s)) return null; const b = Buffer.from(s, 'base64url'); return b.toString('base64url') === s ? b : null; };
export const verify = (f, x) => { const p = split(f), b = p && sigBytes(p.sig); try { return !!b && crypto.verify(null, p.body, pub(x), b); } catch { return false; } };
export const bodyOf = (f) => { try { return JSON.parse(split(f).body.toString('utf8')); } catch { return null; } };
const hopSig = (from, to, x, s) => { const b = sigBytes(s ?? ''); try { return !!b && crypto.verify(null, Buffer.from(`${from}->${to}`), pub(x), b); } catch { return false; } };
// §4.3 as a hub would walk it: one hop shape, every hop carrying its court; valid by the previous
// key's signature or by enough distinct listed vouchers. Returns the chain keys or null.
export function walk(p) {
  if (!p || !Array.isArray(p.chain) || p.chain[0]?.key !== p.genesis) return null;
  for (let i = 1; i < p.chain.length; i++) {
    const hop = p.chain[i], from = p.chain[i - 1].key;
    if (!Array.isArray(hop?.court?.leaves)) return null;
    if (hopSig(from, hop.key, from, hop.sig)) continue;
    const leaves = new Set(hop.court.leaves);
    const ok = new Set((hop.vouchers ?? []).filter((v) => hopSig(from, hop.key, v.key, v.sig) && leaves.has(H(Buffer.from(`${v.salt}|${v.key}`)))).map((v) => v.key));
    if (ok.size < hop.court.k) return null;
  }
  return p.chain.map((h) => h.key);
}

export class Hub {
  constructor({ reclaim = 'current', verifyWrites = true } = {}) { this.reclaim = reclaim; this.verifyWrites = verifyWrites; this.files = new Map(); this.log = []; }
  tag(k) { return this.files.has(k) ? H(this.files.get(k)) : null; }
  chainOf(name) { return walk(bodyOf(this.files.get(`${name}/profile`) ?? Buffer.alloc(0))); }
  // "The owner's file for this number": declares n in its signed bytes, and is signed by a chain
  // key (as written) — or by the current key, or is what the head lists there (proposed).
  ownersFile(name, f, n) {
    const keys = this.chainOf(name); if (!keys || !f) return false;
    const o = bodyOf(f); if (!o || o.n !== n) return false;
    if (this.reclaim === 'chain') return keys.some((x) => verify(f, x));
    const head = bodyOf(this.files.get(`${name}/head`) ?? Buffer.alloc(0));
    const listed = head?.entries?.some((e) => e[0] === n && e[1] === H(split(f).body));
    return listed || verify(f, keys.at(-1));
  }
  handle(method, url, b, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|head|posts\/(\d+)|media\/([A-Za-z0-9_-]{43}))$/);
    if (!m) return { status: 404 };
    const [, name, kind, num, hash] = m, key = `${name}/${kind}`, cur = this.files.get(key) ?? null;
    this.log.push([method, url]);
    if (method === 'GET') return cur ? { status: 200, body: cur, etag: H(cur) } : { status: 404 };
    if (method !== 'PUT') return { status: 405 };
    if (kind === 'profile' || kind === 'head') {                       // §9.1 compare-and-swap
      if (this.tag(key) !== ifMatch) return { status: 412, etag: this.tag(key) };
      if (kind === 'profile') {
        const o = bodyOf(b), old = cur && bodyOf(cur);
        if (!o) return { status: 400 };
        if (old && (old.genesis !== o.genesis || !(o.pseq > old.pseq))) return { status: 409 };   // §9.4
        if (this.verifyWrites) { const keys = walk(o); if (!keys || !verify(b, keys.at(-1))) return { status: 403 }; }
      } else if (this.verifyWrites) { const keys = this.chainOf(name); if (!keys || !verify(b, keys.at(-1))) return { status: 403 }; }
      this.files.set(key, b); return { status: 200, etag: H(b) };   // §9: 200 · 412, never 201
    }
    if (hash) {                                                         // §9.6 content-addressed twin
      if (cur && H(cur) === hash) return { status: 409 };
      if (cur && H(b) !== hash) return { status: 409 };
      this.files.set(key, b); return { status: cur ? 200 : 201 };
    }
    const n = +num;                                                     // §9.2 create-once, §9.5 reclaim
    if (cur) {
      if (this.ownersFile(name, cur, n) || !this.ownersFile(name, b, n)) return { status: 409 };
      this.files.set(key, b); return { status: 200 };
    }
    this.files.set(key, b); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const c = []; req.on('data', (x) => c.push(x));
      req.on('end', () => { const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null); res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body); });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
  close() { this.server?.close(); }
}
// The io the weekend publisher expects: get → bytes (carrying the hub's ETag) or null, put → status.
export const io = (hub) => ({
  get: async (p) => { const r = await fetch(hub.url + p); return r.status === 200 ? Object.assign(Buffer.from(await r.arrayBuffer()), { etag: r.headers.get('etag') }) : null; },
  put: async (p, b, ifMatch) => (await fetch(hub.url + p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status,
});
