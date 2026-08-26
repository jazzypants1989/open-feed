// §4 — the index: the signed list saying what exists now. The live set is a replay of the entries;
// a number has one hash, ever; a media file is listed by its hash alone; `highest` never decreases.
import { signFile, verifyFile } from './file.js';

/** §4.2: replay. Returns `{ live: Map, highest }` or null when the index is invalid. */
export function replay(entries) {
  if (!Array.isArray(entries)) return null;
  const live = new Map(), issued = new Map();
  for (const e of entries) {
    if (!Array.isArray(e) || e.length < 1 || e.length > 2) return null;
    const [a, b] = e;
    if (typeof a === 'string') {                                          // a media file: [hash] or [hash, null]
      if (e.length === 1) { if (live.has(a)) return null; live.set(a, { hash: a }); continue; }
      if (b !== null || !live.delete(a)) return null;
      continue;
    }
    if (!Number.isInteger(a) || a < 1) return null;
    if (e.length !== 2) return null;
    if (b === null) { if (!live.has(a)) return null; live.delete(a); continue; }
    if (typeof b !== 'string') return null;
    const had = issued.get(a);
    if (had !== undefined && (had !== b || live.has(a))) return null;     // one hash per number, ever
    issued.set(a, b); live.set(a, { hash: b });
  }
  return { live, highest: Math.max(0, ...issued.keys()) };
}

/** A index's shape: entries first (§4), a non-negative `version`, a `highest` at or above the highest number. */
export function checkIndex(obj, set) {
  if (Object.keys(obj)[0] !== 'entries') return 'entries is not the first member';
  if (!Number.isInteger(obj.version) || obj.version < 0) return 'version is not a non-negative integer';
  if (!Number.isInteger(obj.highest) || obj.highest < set.highest) return 'highest is below the highest number issued';
  return null;
}

/**
 * §7.2 step 9: a served index against the checkpoint. Returns `{ verdict, why }` on a refusal, else
 * `{ notes, withdrawn }` where `withdrawn` is the map of withdrawn numbers to the hash they had.
 */
export function checkAgainstCheckpoint(index, set, checkpoint) {
  const bad = (why) => ({ verdict: 'tampered', why });
  if (index.obj.version < checkpoint.indexVersion) return bad('an index older than the one this reader saw');
  if (index.obj.version === checkpoint.indexVersion && index.address !== checkpoint.indexHash) return bad('two indexes at one version');
  if (index.obj.highest < checkpoint.highest) return bad('the highest number used went backwards');
  const withdrawn = new Map(checkpoint.withdrawn ?? []);
  for (const [number, e] of set.live) {
    if (typeof number !== 'number' || number > checkpoint.highest) continue;
    const was = checkpoint.live.get(number) ?? withdrawn.get(number);
    if (was === undefined) return bad(`post ${number} is listed now and was not before`);
    if (was !== e.hash) return bad(`post ${number} changed after the reader saw it`);
  }
  const notes = [];
  for (const [number, h] of checkpoint.live) if (!set.live.has(number)) { notes.push(`withdrawn: ${number}`); withdrawn.set(number, h); }
  for (const number of withdrawn.keys()) if (set.live.has(number)) withdrawn.delete(number);
  return { notes, withdrawn };
}

/** The publisher's side: the entries a rewrite keeps (§4.5) — the live set, in order. */
export function liveEntries(entries) {
  const m = new Map();
  for (const e of entries) { const [a, b] = e; if (e.length === 2 && b === null) m.delete(a); else m.set(a, typeof a === 'string' ? [a] : [a, b]); }
  return [...m.values()];
}

export const signIndex = ({ entries, version, highest }, key) => signFile({ entries, version, highest }, key);
export const verifyIndex = (bytes, currentKey) => verifyFile(bytes, currentKey);
