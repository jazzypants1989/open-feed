// §8 (the client side) and §10 — a publisher: a device holding the key, writing signed files to any
// hub, and keeping every byte it writes. `io` is `{ get(url) → {bytes, etag} | null, put(url, bytes,
// {ifMatch}) → {status, etag} }` — `fetch.js` over a socket, or anything shaped like it in a test.
import { signFile, address, splitFile, parseBody } from './file.js';
import { signProfile } from './profile.js';
import { signIndex, liveEntries } from './index.js';
import { sha256 } from './file.js';

export class PublishError extends Error { constructor(message, status) { super(message); this.name = 'PublishError'; this.status = status; } }

/**
 * `keep(path, bytes)` is §10: the app MUST keep the signed bytes of everything it publishes. The
 * default keeps them in memory; an app passes its own store.
 */
export function createPublisher({ io, key, at, keep = null }) {
  const copy = new Map();
  const kept = keep ?? ((path, bytes) => copy.set(path, bytes));
  const putKept = async (path, bytes, opts) => { const r = await io.put(`${at}${path}`, bytes, opts); if (r.status === 200 || r.status === 201) kept(path, bytes); return r; };

  /** §8.4: claim a name — the profile, then an empty index, so a brand-new identity never reads as a misbehaving host. */
  async function claim(fields) {
    const p = signProfile(fields, key);
    const r = await putKept('/profile', p, { ifMatch: null });
    if (r.status !== 200) throw new PublishError(`claiming ${at}: ${r.status}`, r.status);
    await amendIndex((h) => h);
    return p;
  }
  /** Overwrite the profile under compare-and-swap; the caller supplies the new fields. */
  async function updateProfile(fields) {
    const cur = await io.get(`${at}/profile`);
    const p = signProfile(fields, key);
    const r = await putKept('/profile', p, { ifMatch: cur?.etag ?? null });
    if (r.status !== 200) throw new PublishError(`profile: ${r.status}`, r.status);
    return p;
  }

  /** §8.2: take the next free number at or above `n`. */
  async function publishPost(n, fields) {
    for (let num = n; ; num++) {
      const f = signFile({ n: num, ...fields }, key);
      const r = await putKept(`/posts/${num}`, f);
      if (r.status === 201 || r.status === 200) return { n: num, entry: [num, address(f)], file: f };
      if (r.status !== 409) throw new PublishError(`post ${num}: ${r.status}`, r.status);
    }
  }
  /** §8.1: re-read the index the hub is serving and fold the change into that; the tag is the hub's. */
  async function amendIndex(change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await io.get(`${at}/index`);
      if (cur && !cur.etag) throw new PublishError('the hub sent no ETag', 0);
      let obj = { entries: [], version: 0, top: 0 };
      if (cur) { try { obj = parseBody(splitFile(cur.bytes).body); } catch { throw new PublishError('the served index does not parse', 0); } }
      const next = change({ entries: obj.entries, version: obj.version + 1, top: obj.top });
      const r = await putKept('/index', signIndex(next, key), { ifMatch: cur?.etag ?? null });
      if (r.status === 200) return next;
      if (r.status !== 412) throw new PublishError(`index: ${r.status}`, r.status);
    }
    throw new PublishError('index: gave up after five races', 412);
  }
  /** §8.3: the post, then the index that lists it. */
  const publish = async (n, fields) => { const { n: num, entry } = await publishPost(n, fields); await amendIndex((h) => ({ ...h, entries: [...h.entries, entry], top: Math.max(h.top, num) })); return num; };
  const publishMedia = async (bytes) => { const h = sha256(bytes); const r = await putKept(`/media/${h}`, bytes, { contentType: 'application/octet-stream' }); if (r.status !== 201 && r.status !== 200) throw new PublishError(`media: ${r.status}`, r.status); await amendIndex((hd) => ({ ...hd, entries: [...hd.entries, [h]] })); return h; };
  const withdraw = (n) => amendIndex((h) => ({ ...h, entries: [...h.entries, [n, null]] }));
  const relist = (n, hash) => amendIndex((h) => ({ ...h, entries: [...h.entries, [n, hash]] }));
  const resignIndex = () => amendIndex((h) => h);
  const rewrite = () => amendIndex((h) => ({ ...h, entries: liveEntries(h.entries) }));
  /** §11: the views are unsigned overwritable files at conventional paths. */
  async function putView(name, text, contentType) {
    const path = `/${name}`, cur = await io.get(`${at}${path}`);
    const r = await io.put(`${at}${path}`, Buffer.from(text, 'utf8'), { ifMatch: cur?.etag ?? null, contentType });
    if (r.status !== 200) throw new PublishError(`${name}: ${r.status}`, r.status);
  }
  return { claim, updateProfile, publishPost, amendIndex, publish, publishMedia, withdraw, relist, resignIndex, rewrite, putView, copy };
}
