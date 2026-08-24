// §4 — identity. The genesis key is the identity; the profile names the keys, the locations and
// the recovery list; the chain is one hop shape carrying its court; a reader keeps a court per
// chain length and judges every hop by the court it holds there (§4.6).
import crypto from 'node:crypto';
import { sha256, decodeStrict, publicKey, verifyFile, signFile, splitFile, parseBody } from './file.js';

const hopBytes = (from, to) => Buffer.from(`${from}->${to}`, 'ascii');
const hopSignature = (from, to, key) => crypto.sign(null, hopBytes(from, to), key.privateKey).toString('base64url');
const hopVerifies = (from, to, x, sig) => {
  const b = decodeStrict(sig, 64);
  try { return !!b && crypto.verify(null, hopBytes(from, to), publicKey(x), b); } catch { return false; }
};

// ---- building (§4.3, §4.4) ----
/** A rotation: the previous key signs the move. `court` is the list in force before the hop. */
export const rotation = (from, to, court) => ({ key: to.x, court, sig: hopSignature(from.x, to.x, from) });
/** A restore: listed members vouch for the move. Each voucher reveals only its own salt. */
export const restore = (from, to, members, court) => ({ key: to.x, court, vouchers: members.map(({ key, salt }) => ({ key: key.x, salt, sig: hopSignature(from.x, to.x, key) })) });
/** Vouchers added to an existing hop — how a rotation made alone is later backed by the court. */
export const vouched = (hop, from, members) => ({ ...hop, vouchers: [...(hop.vouchers ?? []), ...restore(from, { x: hop.key }, members, hop.court).vouchers] });
/** §4.4: one leaf per member, each under its own salt, so a voucher reveals nobody else. */
export const commit = (k, members) => ({ k, leaves: members.map(({ key, salt }) => leaf(salt, key.x)) });
export const leaf = (salt, x) => sha256(Buffer.from(`${salt}|${x}`, 'utf8'));
export const signProfile = (fields, key) => signFile(fields, key);

// ---- verifying (§4.3, §4.6) ----
const isList = (c) => c && Number.isInteger(c.k) && c.k >= 0 && Array.isArray(c.leaves) && c.leaves.every((l) => typeof l === 'string');
/** Distinct voucher keys whose signatures verify and whose leaves are in `court`. */
export function vouches(from, hop, court) {
  const leaves = new Set(court?.leaves ?? []);
  const ok = new Set();
  for (const v of hop?.vouchers ?? []) {
    if (v && typeof v.key === 'string' && typeof v.salt === 'string' && hopVerifies(from, hop.key, v.key, v.sig) && leaves.has(leaf(v.salt, v.key))) ok.add(v.key);
  }
  return ok.size;
}
const majority = (from, hop, court) => vouches(from, hop, court) * 2 > (court?.leaves.length ?? Infinity);

/** Shape checks a profile must pass before anything is verified. */
export function wellFormed(p) {
  return p && typeof p === 'object' && typeof p.genesis === 'string' && Number.isInteger(p.pseq) && p.pseq >= 0
    && Array.isArray(p.chain) && p.chain.length >= 1 && p.chain[0]?.key === p.genesis && p.chain.every((h) => h && typeof h.key === 'string')
    && p.chain.slice(1).every((h) => isList(h.court)) && isList(p.recovery) && Array.isArray(p.locations) && p.locations.every((l) => typeof l === 'string')
    && (p.read === undefined || typeof p.read === 'string') && (p.name === undefined || typeof p.name === 'string');
}

/**
 * §4.6 rule 2 and 3: the courts a reader holds, extended by what the served chain carries at
 * lengths the pinned chain does not reach. `from` is the first index a carried court may fill.
 */
export function adoptCourts(courts, p, from) {
  p.chain.forEach((h, j) => { if (j >= from && j >= 1 && isList(h.court) && !(j in courts)) courts[j] = h.court; });
  if (p.chain.length >= from && !(p.chain.length in courts)) courts[p.chain.length] = p.recovery;
  return courts;
}

/** §4.3: walk the chain, judging each hop by the court held at its length. */
export function walk(p, courts) {
  for (let i = 1; i < p.chain.length; i++) {
    const hop = p.chain[i], from = p.chain[i - 1].key, court = courts[i];
    if (!court) return null;
    if (!hopVerifies(from, hop.key, from, hop.sig) && vouches(from, hop, court) < court.k) return null;
  }
  return { keys: p.chain.map((h) => h.key), current: p.chain.at(-1).key, restored: p.chain.length > 1 && p.chain.at(-1).sig === undefined };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * §8.1 steps 1–6 over profile bytes. `pin` is what the reader verified last time (or null).
 * Returns `{ verdict, why }` or `{ verdict: 'ok', raw, chain, profile, courts, fields, switched }`.
 */
export function verifyProfile(bytes, { learned, pin = null }) {
  const bad = (verdict, why) => ({ verdict, why });
  // Parse before any key is known: the genesis check needs the body, and which key signs is the
  // chain's last word.
  let parsedRaw;
  try { const s = splitFile(bytes); parsedRaw = s && parseBody(s.body); } catch { parsedRaw = null; }
  if (!parsedRaw || parsedRaw.genesis !== learned) return bad('identity', 'not the identity this reader learned');
  const p = parsedRaw;
  if (!wellFormed(p)) return bad('identity', 'the profile is malformed');
  const courts = { ...(pin?.courts ?? {}) };
  adoptCourts(courts, p, pin ? pin.chain.length : 0);
  let chain = walk(p, courts);
  if (!chain) return bad('identity', 'the chain of key changes does not hold');
  const profile = verifyFile(bytes, chain.current);
  if (!profile) return bad('identity', 'the profile is not signed by the key it ends on');
  const fields = [p.recovery, p.locations, p.name, p.read];
  if (pin) {
    let i = p.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);
    if (i < 0 && p.chain.length < pin.chain.length && p.pseq > pin.pseq) i = p.chain.length;   // forgetting a hop is a fork too
    if (i > 0) {
      const mine = majority(pin.chain[i - 1].key, pin.chain[i], courts[i]), theirs = majority(p.chain[i - 1].key, p.chain[i], courts[i]);
      if (mine === theirs) return bad('identity', 'contested: two histories, and no majority settles it');
      if (mine) return bad('host', 'serves a branch the court rejected');
      for (const j of Object.keys(courts)) if (+j > i) delete courts[j];
      adoptCourts(courts, p, i + 1);
      if (!(chain = walk(p, courts))) return bad('identity', 'the chain of key changes does not hold');
    } else if (p.pseq < pin.pseq) return bad('identity', 'an older profile than the one this reader saw');
    else if (p.pseq === pin.pseq && profile.address !== pin.phash) return bad('identity', 'contested: two profiles at one version');
    else if (chain.restored && p.chain.length === pin.chain.length + 1 && !sameJson(fields, [courts[pin.chain.length], ...pin.fields.slice(1)])) return bad('identity', 'a restore changed more than the key');
  }
  return { verdict: 'ok', raw: p, chain, profile, courts, fields };
}
