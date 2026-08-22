// The publisher, written from TLDR-new.md and the rulings, in one file, standard library only —
// the other half of HANDOFF-to-spec.md §2.H. It imports nothing from lastline.js either.
// Measured and driven by weekend-gate.js.
import crypto from 'node:crypto';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
export const newKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519'); return { privateKey, x: publicKey.export({ format: 'jwk' }).x }; };

// A file is its body bytes, one newline, then the signature over the body. Serialize once: the
// bytes signed are the bytes served, so nothing may re-format them afterwards.
export function file(obj, key) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  return Buffer.concat([body, Buffer.from('\n'), Buffer.from(crypto.sign(null, body, key.privateKey).toString('base64url'), 'ascii')]);
}
export const address = (f) => sha256(f.subarray(0, f.lastIndexOf(0x0a)));
const hop = (msg, key) => crypto.sign(null, Buffer.from(msg), key.privateKey).toString('base64url');

// ---- the three kinds ----
export const rotation = (from, to) => ({ key: to.x, by: 'rotation', sig: hop(`${from.x}->${to.x}`, from) });
// A restore carries the list it satisfied — the one that stood before it — because the profile's
// own list is for the next one, and a reader that holds no list needs this to walk the chain.
export const restore = (from, to, vouchers, court) => ({
  key: to.x, by: 'restore', court,
  vouchers: vouchers.map(({ key, salt }) => ({ key: key.x, salt, sig: hop(`${from.x}->${to.x}`, key) })),
});
// The recovery list is committed one member at a time, so a voucher reveals only its own salt and
// the leaf count says how many there are — which is what a majority is counted against.
export const commit = (k, members) => ({ k, leaves: members.map(({ key, salt }) => sha256(Buffer.from(`${salt}|${key.x}`))) });

export const profile = ({ genesis, pseq, prev, chain, recovery, locations, read }, key) =>
  file({ genesis, pseq, ...(prev ? { prev } : {}), chain, recovery, locations, ...(read ? { read } : {}) }, key);

export const post = (n, fields, key) => file({ n, ...fields }, key);

// entries first, so appending leaves every earlier byte where it was and a reader that cached the
// file can fetch only the tail. `top` is the highest number ever issued and never goes down.
export const head = ({ entries, hseq, top, prev }, key) =>
  file({ entries, hseq, top, ...(prev ? { prev } : {}) }, key);

// ---- publishing ----
// Take the next free number, then fold the new line into the head the host is actually serving.
// Both retries matter: the first keeps two devices from overwriting each other's posts, the second
// keeps the loser of a head race from dropping the winner's post out of the list.
export async function publishPost(io, at, key, n, fields) {
  let num = n;
  for (;;) {
    const f = post(num, fields, key);
    const r = await io.put(`${at}/posts/${num}`, f);
    if (r === 201 || r === 200) return { n: num, entry: [num, address(f)] };
    if (r !== 409) throw new Error(`publishing post ${num}: ${r}`);
    num++;
  }
}
export async function amendHead(io, at, key, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await io.get(`${at}/head`);
    const obj = cur ? JSON.parse(cur.subarray(0, cur.lastIndexOf(0x0a)).toString('utf8')) : { entries: [], hseq: 0, top: 0 };
    const next = change({ entries: obj.entries, hseq: obj.hseq + 1, top: obj.top, prev: cur ? address(cur) : null });
    if (await io.put(`${at}/head`, head(next, key), cur ? sha256(cur) : null) === 200) return next;
  }
  throw new Error('head: gave up retrying');
}

export const publish = (io, at, key, n, fields) =>
  publishPost(io, at, key, n, fields).then(({ n: num, entry }) =>
    amendHead(io, at, key, (h) => ({ ...h, entries: [...h.entries, entry], top: Math.max(h.top, num) })).then(() => num));

// A photo: put the bytes at their hash, then list the hash. Unsigned — the head's line admits it.
export const publishMedia = (io, at, key, bytes) => {
  const h = sha256(bytes);
  return io.put(`${at}/media/${h}`, bytes).then((r) => { if (r !== 201 && r !== 200) throw new Error(`media: ${r}`); return amendHead(io, at, key, (hd) => ({ ...hd, entries: [...hd.entries, [h]] })).then(() => h); });
};
export const withdraw = (io, at, key, n) =>
  amendHead(io, at, key, (h) => ({ ...h, entries: [...h.entries, [n, null]] }));

// Rotating or restoring changes who signs the head, so the head is written again under the new key.
// Until it is, readers who already hold one keep it and readers who do not cannot read at all.
export const resignHead = (io, at, key) => amendHead(io, at, key, (h) => h);

// A rewrite drops the lines a withdrawal left behind. How often is the publisher's business — the
// reader is indifferent — so this is a setting, not a rule. Once a month is the suggested default.
// The publisher needs the fold too: what survives a rewrite is what is live, and a pending entry
// survives still pending — confirm it with a bare line, never by rewriting the file.
const live = (entries) => { const m = new Map(); for (const [n, h, f] of entries) h === null ? m.delete(n) : m.set(n, typeof n === 'string' ? [n] : m.has(n) ? [n, h] : [n, h, ...(f === 'pending' ? ['pending'] : [])]); return [...m.values()]; };
export const rewrite = (io, at, key) => amendHead(io, at, key, (h) => ({ ...h, entries: live(h.entries) }));
