// Review finding B2 — the attack index-exp.js did not stage. A key of Alice's was stolen last
// year; she has since rotated to a new one. Her old posts are still valid under the old key — they
// must be, or every rotation would orphan the archive. The host (the ex) swaps post #5 for a #5 the
// thief stamped with the old key. Declared number 5, below top, stamp genuine. Who notices?
import crypto from 'node:crypto';

const oldKey = crypto.generateKeyPairSync('ed25519');   // stolen, then rotated away
const newKey = crypto.generateKeyPairSync('ed25519');   // what she stamps with now
const keysEverHers = [oldKey, newKey];
const H = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const sign = (o, k) => { const b = Buffer.from(JSON.stringify(o)); return { n: o.n, body: o, bytes: b, stamp: crypto.sign(null, b, k.privateKey).toString('base64url') }; };
const genuine = (f) => keysEverHers.some((k) => { try { return crypto.verify(null, f.bytes, k.publicKey, Buffer.from(f.stamp, 'base64url')); } catch { return false; } });

// Seven posts. 1-4 under the old key (before rotation), 5-7 under the new one.
// In the "prev" shape each post also carries the hash of the post before it.
const build = (withPrev) => {
  const posts = new Map(); let prev = null;
  for (let n = 1; n <= 7; n++) {
    const p = sign({ n, body: `post ${n}`, ...(withPrev ? { prev } : {}) }, n <= 4 ? oldKey : newKey);
    posts.set(n, p); prev = H(p.bytes);
  }
  return posts;
};

const heads = {
  'tiny counter':       (posts) => sign({ n: 'head', seq: 12, top: 7, withdrawn: [] }, newKey),
  'counter + [n,hash]': (posts) => sign({ n: 'head', seq: 12, top: 7, withdrawn: [], entries: [...posts.values()].map((p) => [p.n, H(p.bytes)]) }, newKey),
  'per-post prev + top hash': (posts) => sign({ n: 'head', seq: 12, top: 7, withdrawn: [], top_hash: H(posts.get(7).bytes) }, newKey),
};

function verdict(shape, head, served, kept) {
  const out = [];
  for (const [n, f] of served) {
    if (!genuine(f)) { out.push(`#${n}: not Alice's stamp`); continue; }
    if (f.body.n !== n) { out.push(`#${n}: declares #${f.body.n}`); continue; }
    if (n > head.body.top) { out.push(`#${n}: above top`); continue; }
    if (kept?.has(n) && !kept.get(n).bytes.equals(f.bytes)) out.push(`#${n}: not the bytes I kept`);
    if (shape === 'counter + [n,hash]') {
      const listed = head.body.entries.find(([m]) => m === n)?.[1];
      if (listed !== H(f.bytes)) out.push(`#${n}: not the bytes the head lists`);
    }
  }
  if (shape === 'per-post prev + top hash') {
    let expect = head.body.top_hash;
    for (let n = head.body.top; n >= 1; n--) {
      const f = served.get(n); if (!f) break;
      if (H(f.bytes) !== expect) { out.push(`#${n}: chain breaks here`); break; }
      expect = f.body.prev;
    }
  }
  return out.length ? out.join('; ') : 'accepted as Alice\'s';
}

console.log('\nThe host swaps #5 for a forgery stamped with a key that WAS Alice\'s\n');
console.log('  head shape                  cold reader (first visit)            warm reader (kept #5 last year)');
for (const [shape, mk] of Object.entries(heads)) {
  const withPrev = shape.startsWith('per-post');
  const honest = build(withPrev);
  const head = mk(honest);
  const forged = new Map(honest);
  forged.set(5, sign({ n: 5, body: 'vote for me', ...(withPrev ? { prev: honest.get(5).body.prev } : {}) }, oldKey));
  const cold = verdict(shape, head, forged, null);
  const warm = verdict(shape, head, forged, new Map([[5, honest.get(5)]]));
  console.log(`  ${shape.padEnd(27)} ${cold.padEnd(36)} ${warm}`);
}

console.log(`
  The tiny counter's defence against a stolen key ("every number at or below the top is taken")
  is a rule for HONEST hosts. This host is the adversary; it overwrites whatever it likes. The
  counter commits to nothing about the bytes, so a cold reader — the cousin, the new app after a
  restore, the family handing the archive back — takes the forgery. Only a reader that already
  held #5 notices, and only because it kept the bytes.

  Both other shapes catch it. Their prices, after ten years at three posts a week:
`);
const many = Array.from({ length: 1560 }, (_, i) => i + 1);
const fakeHash = 'x'.repeat(43);
const sizes = {
  'tiny counter':             JSON.stringify({ seq: 412, top: 1560, withdrawn: many.filter((n) => n % 78 === 0) }).length,
  'counter + [n,hash]':       JSON.stringify({ seq: 412, top: 1560, withdrawn: many.filter((n) => n % 78 === 0), entries: many.map((n) => [n, fakeHash]) }).length,
  'per-post prev + top hash': JSON.stringify({ seq: 412, top: 1560, withdrawn: many.filter((n) => n % 78 === 0), top_hash: fakeHash }).length,
};
console.log('  head shape                  head bytes   fetched per poll (ETag)   fetched per CHANGE   per-post cost');
for (const [k, v] of Object.entries(sizes)) {
  const perPost = k.startsWith('per-post') ? '+51 B ("prev")' : '0';
  console.log(`  ${k.padEnd(27)} ${String(v).padStart(10)}   ${'0 if unchanged'.padEnd(25)} ${String(v).padStart(18)}   ${perPost}`);
}
const kb = (b) => `${Math.round(b / 1024)} KB`;
console.log(`
  Ruling 4 rejected the [n,hash] shape as "33 KB against 138 bytes, re-fetched every time a reader
  checks in" (index-exp.js used 12-character fingerprints; full 32-byte hashes make it ${kb(sizes['counter + [n,hash]'])}).
  With ETag / If-None-Match a head is fetched only when it changed — once per post, not once per
  poll — so the real comparison is ${kb(sizes['counter + [n,hash]'])} per post against ${sizes['tiny counter']} bytes per post, for readers who
  are about to fetch the post anyway. The per-post prev is cheaper still (${sizes['per-post prev + top hash']}-byte head, 51 bytes
  per post) and makes an archive the family hands back self-verifying in order and content; but it
  means every post must know the hash of the one before it, which is the end of host-released
  scheduled posts (see scheduled-exp.js).

  The question the ruling has to answer first: after a restore, do posts stamped by the old key
  stay valid? If yes — and they must — a key once stolen is a forgery tool against cold readers
  forever unless the head commits to bytes.
`);
