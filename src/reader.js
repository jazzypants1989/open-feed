// §7 — the reader. Given the anchor key it learned out of band, a location, and optionally the checkpoint
// it kept from last time, it performs §7's steps in order and returns exactly one of three
// verdicts: `ok`, `tampered` (this hub is misbehaving), `contested` (who this is cannot be settled).
// `recently restored`, `withdrawn: <number>` and `no index I can verify` are notes on an ok read.
//
// The fetcher is injected: `get(url) → { bytes, etag } | null` for a 404, and it throws for a
// transport failure — which is no verdict at all (§9), so the throw propagates.
import { sha256, verifyFile } from './file.js';
import { verifyProfile } from './profile.js';
import { replay, checkIndex, checkAgainstCheckpoint, verifyIndex } from './index.js';

const WEEK = 7 * 86400e3;
/** §9: how many identities one pass will look again at. Past it a target is unchecked, which is no verdict. */
export const MAX_IDENTITIES_PER_PASS = 200;

export function createReader({ get, maxIdentities = MAX_IDENTITIES_PER_PASS }) {
  async function read({ learned, at, checkpoint = null, now = Date.now() }) {
    const note = [], say = (v) => note.includes(v) || note.push(v);
    const bad = (verdict, why) => ({ verdict, why, note });

    // §7.1 — profile, chain, recovery.
    const pf = await get(`${at}/profile`);
    if (!pf) return bad('tampered', 'no profile served');
    const id = verifyProfile(pf.bytes, { learned, checkpoint });
    if (id.verdict !== 'ok') return bad(id.verdict, id.why);
    const { raw, chain, profile, recoveryLists, fields } = id;
    const restoredAt = chain.restored ? (checkpoint?.restoredAt?.[raw.chain.length] ?? now) : null;
    if (restoredAt !== null && now - restoredAt < WEEK) say('recently restored');

    // §7.1 — the index, under the current key. An unverifiable index is not an accusation.
    const hf = await get(`${at}/index`);
    let index = hf && verifyIndex(hf.bytes, chain.current);
    let set = index && replay(index.obj.entries);
    if (index) { const why = !set ? 'the index entries are invalid' : checkIndex(index.obj, set); if (why) return bad('tampered', why); }   // §4.2 replay, then §4 shape
    if (!index) {
      if (!checkpoint) return bad('tampered', hf ? 'the index is not signed by the key the profile ends on' : 'no index served');
      say('no index I can verify');
      set = { live: new Map([...checkpoint.live].map(([number, h]) => [number, { hash: h }])), highest: checkpoint.highest };
      index = { obj: { version: checkpoint.indexVersion, highest: checkpoint.highest }, address: checkpoint.indexHash };
    }
    let withdrawn = new Map(checkpoint?.withdrawn ?? []);
    if (checkpoint) {
      const r = checkAgainstCheckpoint(index, set, checkpoint);
      if (r.verdict) return bad(r.verdict, r.why);
      r.notes.forEach(say);
      withdrawn = r.withdrawn;
    }

    // §7.4 — the posts and media the index lists.
    const posts = new Map(), media = new Map();
    for (const [number, e] of set.live) {
      const isMedia = typeof number === 'string';
      const f = await get(isMedia ? `${at}/media/${number}` : `${at}/posts/${number}`);
      if (!f) return bad('tampered', `${isMedia ? 'media file' : 'post'} ${number} is listed and not served`);
      if (isMedia) { if (sha256(f.bytes) !== number) return bad('tampered', `media file ${number} is not what the index lists`); media.set(number, f.bytes); continue; }
      const post = verifyFile(f.bytes, chain.keys);
      if (!post || post.address !== e.hash || post.obj.number !== number) return bad('tampered', `post ${number} is not what the index lists`);
      posts.set(number, post.obj);
    }

    return {
      verdict: 'ok', note, posts, media, chain, locations: raw.locations, name: raw.name, read: raw.read, anchor: raw.anchor,
      checkpoint: {
        profileVersion: raw.version, profileHash: profile.address, chain: raw.chain, recoveryLists, fields,
        restoredAt: { ...(checkpoint?.restoredAt ?? {}), ...(restoredAt !== null ? { [raw.chain.length]: restoredAt } : {}) },
        locations: [...new Set([...(checkpoint?.locations ?? []), ...raw.locations])],      // §3.5: every location ever named
        indexVersion: index.obj.version, indexHash: index.address, highest: index.obj.highest,
        live: new Map([...set.live].map(([number, e]) => [number, e.hash])), withdrawn,
      },
    };
  }

  /**
   * §7.4 — targets and the rumor rule, over the posts of one replier. `seen` maps anchor keys to
   * checkpoints and is updated in place when a look-again succeeds. A reply whose target hash is not
   * what that author's index lists — now, or when it was withdrawn — is marked unresolved and says
   * nothing. Returns the rumor lines: one per replier, however many replies.
   */
  async function rumors(seen, posts, replier, { now = Date.now() } = {}) {
    const out = [], refreshed = new Set();
    // The address tried last, per author: the one named by this replier's highest-numbered reply.
    // Taking it from whichever reply is met first makes the beacon order-dependent — somebody who
    // replied both before and after a move would strand the reader at the address they gave first.
    const beacon = new Map();
    for (const [number, p] of posts) {
      const t = p?.target;
      if (t && typeof t.key === 'string' && typeof t.location === 'string' && !(beacon.get(t.key)?.number > number)) beacon.set(t.key, { number, location: t.location });
    }
    for (const p of posts.values()) {
      const t = p.target;
      if (!t || typeof t.key !== 'string' || !seen.has(t.key)) continue;
      const s = seen.get(t.key), listed = s.live.get(t.number) ?? s.withdrawn?.get(t.number);
      if (listed !== undefined && listed !== t.hash) { t.unresolved = true; continue; }
      if (t.number <= s.highest) continue;                                    // withdrawn or superseded: quiet
      if (!refreshed.has(t.key)) {                                   // look again, once per identity per pass
        if (refreshed.size >= maxIdentities) continue;               // §9's cap: unchecked, so no line — no verdict
        refreshed.add(t.key);
        // The locations already held are tried before the address in the reply (§7.4): the reply's
        // `location` is both the relocation mechanism and a beacon, and it is hit last.
        for (const where of [...new Set([...(s.locations ?? []), beacon.get(t.key)?.location])]) {
          if (typeof where !== 'string') continue;
          let again = null;
          try { again = await read({ learned: t.key, at: where, checkpoint: seen.get(t.key), now }); } catch { /* no verdict: try the next */ }
          if (again?.verdict === 'ok') { seen.set(t.key, again.checkpoint); if (again.checkpoint.highest >= t.number) break; }
        }
      }
      const line = `${replier} replied to something I cannot see`;
      if (t.number > seen.get(t.key).highest && !out.includes(line)) out.push(line);
    }
    return out;
  }

  return { read, rumors };
}
