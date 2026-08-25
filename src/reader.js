// §7 — the reader. Given the anchor key it learned out of band, a location, and optionally the pin
// it kept from last time, it performs §7's steps in order and returns exactly one of three
// verdicts: `ok`, `host` (this host is misbehaving), `identity` (who this is cannot be settled).
// `recently restored`, `withdrawn: n` and `no index I can verify` are notes on an ok read.
//
// The fetcher is injected: `get(url) → { bytes, etag } | null` for a 404, and it throws for a
// transport failure — which is no verdict at all (§9), so the throw propagates.
import { sha256, verifyFile } from './file.js';
import { verifyProfile } from './profile.js';
import { fold, checkIndex, checkAgainstPin, verifyIndex } from './index.js';

const WEEK = 7 * 86400e3;
/** §9: how many identities one pass will look again at. Past it a target is unchecked, which is no verdict. */
export const MAX_IDENTITIES_PER_PASS = 200;

export function createReader({ get, maxIdentities = MAX_IDENTITIES_PER_PASS }) {
  async function read({ learned, at, pin = null, now = Date.now() }) {
    const note = [], say = (v) => note.includes(v) || note.push(v);
    const bad = (verdict, why) => ({ verdict, why, note });

    // §7.1 — profile, chain, recovery.
    const pf = await get(`${at}/profile`);
    if (!pf) return bad('host', 'no profile served');
    const id = verifyProfile(pf.bytes, { learned, pin });
    if (id.verdict !== 'ok') return bad(id.verdict, id.why);
    const { raw, chain, profile, recoveryLists, fields } = id;
    const restoredAt = chain.restored ? (pin?.restoredAt?.[raw.chain.length] ?? now) : null;
    if (restoredAt !== null && now - restoredAt < WEEK) say('recently restored');

    // §7.2 — the index, under the current key. An unverifiable index is not an accusation.
    const hf = await get(`${at}/index`);
    let index = hf && verifyIndex(hf.bytes, chain.current);
    let set = index && fold(index.obj.entries);
    if (index) { const why = !set ? 'the index does not fold' : checkIndex(index.obj, set); if (why) return bad('host', why === 'the index does not fold' ? why : `the index does not fold: ${why}`); }
    if (!index) {
      if (!pin) return bad('host', hf ? 'the index is not signed by the key the profile ends on' : 'no index served');
      say('no index I can verify');
      set = { live: new Map([...pin.live].map(([n, h]) => [n, { hash: h }])), top: pin.top };
      index = { obj: { version: pin.indexVersion, top: pin.top }, address: pin.indexHash };
    }
    let withdrawn = new Map(pin?.withdrawn ?? []);
    if (pin) {
      const r = checkAgainstPin(index, set, pin);
      if (r.verdict) return bad(r.verdict, r.why);
      r.notes.forEach(say);
      withdrawn = r.withdrawn;
    }

    // §7.4 — the posts and media the index lists.
    const posts = new Map(), media = new Map();
    for (const [n, e] of set.live) {
      const isMedia = typeof n === 'string';
      const f = await get(isMedia ? `${at}/media/${n}` : `${at}/posts/${n}`);
      if (!f) return bad('host', `${isMedia ? 'media file' : 'post'} ${n} is listed and not served`);
      if (isMedia) { if (sha256(f.bytes) !== n) return bad('host', `media file ${n} is not what the index lists`); media.set(n, f.bytes); continue; }
      const post = verifyFile(f.bytes, chain.keys);
      if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);
      posts.set(n, post.obj);
    }

    return {
      verdict: 'ok', note, posts, media, chain, locations: raw.locations, name: raw.name, read: raw.read, anchor: raw.anchor,
      pin: {
        profileVersion: raw.version, profileHash: profile.address, chain: raw.chain, recoveryLists, fields,
        restoredAt: { ...(pin?.restoredAt ?? {}), ...(restoredAt !== null ? { [raw.chain.length]: restoredAt } : {}) },
        locations: [...new Set([...(pin?.locations ?? []), ...raw.locations])],      // §3.7: every location ever named
        indexVersion: index.obj.version, indexHash: index.address, top: index.obj.top,
        live: new Map([...set.live].map(([n, e]) => [n, e.hash])), withdrawn,
      },
    };
  }

  /**
   * §7.5 — targets and the rumor rule, over the posts of one replier. `seen` maps anchor keys to
   * pins and is updated in place when a look-again succeeds. A reply whose target hash is not
   * what that author's index lists — now, or when it was withdrawn — is marked unresolved and says
   * nothing. Returns the rumor lines: one per replier, however many replies.
   */
  async function rumors(seen, posts, replier, { now = Date.now() } = {}) {
    const out = [], refreshed = new Set();
    for (const p of posts.values()) {
      const t = p.target;
      if (!t || typeof t.key !== 'string' || !seen.has(t.key)) continue;
      const s = seen.get(t.key), listed = s.live.get(t.n) ?? s.withdrawn?.get(t.n);
      if (listed !== undefined && listed !== t.hash) { t.unresolved = true; continue; }
      if (t.n <= s.top) continue;                                    // withdrawn or superseded: quiet
      if (!refreshed.has(t.key)) {                                   // look again, once per identity per pass
        if (refreshed.size >= maxIdentities) continue;               // §9's cap: unchecked, so no line — no verdict
        refreshed.add(t.key);
        // The locations already held are tried before the address in the reply (§7.5): the reply's
        // `loc` is both the relocation mechanism and a beacon, and it is hit last.
        for (const where of [...new Set([...(s.locations ?? []), t.loc])]) {
          if (typeof where !== 'string') continue;
          let again = null;
          try { again = await read({ learned: t.key, at: where, pin: seen.get(t.key), now }); } catch { /* no verdict: try the next */ }
          if (again?.verdict === 'ok') { seen.set(t.key, again.pin); if (again.pin.top >= t.n) break; }
        }
      }
      const line = `${replier} replied to something I cannot see`;
      if (t.n > seen.get(t.key).top && !out.includes(line)) out.push(line);
    }
    return out;
  }

  return { read, rumors };
}
