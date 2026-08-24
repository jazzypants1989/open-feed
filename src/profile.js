// §3 — identity. The anchor key is the identity; the profile names the keys, the locations and
// the recovery list; the chain is one link shape carrying its recovery; a reader keeps a recovery per
// chain length and judges every link by the recovery it holds there (§3.6).
import crypto from 'node:crypto';
import { sha256, decodeStrict, publicKey, verifyFile, signFile, splitFile, parseBody } from './file.js';

const linkBytes = (from, to) => Buffer.from(`${from}->${to}`, 'ascii');
const linkSignature = (from, to, key) => crypto.sign(null, linkBytes(from, to), key.privateKey).toString('base64url');
const linkVerifies = (from, to, x, sig) => {
  const b = decodeStrict(sig, 64);
  try { return !!b && crypto.verify(null, linkBytes(from, to), publicKey(x), b); } catch { return false; }
};

// ---- building (§3.3, §3.4) ----
/** A rotation: the previous key signs the move. `recovery` is the list in force before the link. */
export const rotation = (from, to, recovery) => ({ key: to.x, recovery, sig: linkSignature(from.x, to.x, from) });
/** A restore: listed members vouch for the move. Each voucher reveals only its own salt. */
export const restore = (from, to, members, recovery) => ({ key: to.x, recovery, vouchers: members.map(({ key, salt }) => ({ key: key.x, salt, sig: linkSignature(from.x, to.x, key) })) });
/** Vouchers added to an existing link — how a rotation made alone is later backed by the recovery. */
export const vouched = (link, from, members) => ({ ...link, vouchers: [...(link.vouchers ?? []), ...restore(from, { x: link.key }, members, link.recovery).vouchers] });
/** §3.4: one leaf per member, each under its own salt, so a voucher reveals nobody else. */
export const commit = (k, members) => ({ k, leaves: members.map(({ key, salt }) => leaf(salt, key.x)) });
export const leaf = (salt, x) => sha256(Buffer.from(`${salt}|${x}`, 'utf8'));
export const signProfile = (fields, key) => signFile(fields, key);

// ---- verifying (§3.3, §3.6) ----
const isList = (c) => c && Number.isInteger(c.k) && c.k >= 0 && Array.isArray(c.leaves) && c.leaves.every((l) => typeof l === 'string');
/** Distinct voucher keys whose signatures verify and whose leaves are in `recovery`. */
export function vouches(from, link, recovery) {
  const leaves = new Set(recovery?.leaves ?? []);
  const ok = new Set();
  for (const v of link?.vouchers ?? []) {
    if (v && typeof v.key === 'string' && typeof v.salt === 'string' && linkVerifies(from, link.key, v.key, v.sig) && leaves.has(leaf(v.salt, v.key))) ok.add(v.key);
  }
  return ok.size;
}
const majority = (from, link, recovery) => vouches(from, link, recovery) * 2 > (recovery?.leaves.length ?? Infinity);

/** Shape checks a profile must pass before anything is verified. */
export function wellFormed(p) {
  return p && typeof p === 'object' && typeof p.anchor === 'string' && Number.isInteger(p.version) && p.version >= 0
    && Array.isArray(p.chain) && p.chain.length >= 1 && p.chain[0]?.key === p.anchor && p.chain.every((h) => h && typeof h.key === 'string')
    && p.chain.slice(1).every((h) => isList(h.recovery)) && isList(p.recovery) && Array.isArray(p.locations) && p.locations.every((l) => typeof l === 'string')
    && (p.read === undefined || typeof p.read === 'string') && (p.name === undefined || typeof p.name === 'string');
}

/**
 * §3.6 rule 2 and 3: the recoveryLists a reader holds, extended by what the served chain carries at
 * lengths the pinned chain does not reach. `from` is the first index a carried recovery may fill.
 */
export function adoptRecoveryLists(recoveryLists, p, from) {
  p.chain.forEach((h, j) => { if (j >= from && j >= 1 && isList(h.recovery) && !(j in recoveryLists)) recoveryLists[j] = h.recovery; });
  if (p.chain.length >= from && !(p.chain.length in recoveryLists)) recoveryLists[p.chain.length] = p.recovery;
  return recoveryLists;
}

/** §3.3: walk the chain, judging each link by the recovery held at its length. */
export function walk(p, recoveryLists) {
  for (let i = 1; i < p.chain.length; i++) {
    const link = p.chain[i], from = p.chain[i - 1].key, recovery = recoveryLists[i];
    if (!recovery) return null;
    if (!linkVerifies(from, link.key, from, link.sig) && vouches(from, link, recovery) < recovery.k) return null;
  }
  return { keys: p.chain.map((h) => h.key), current: p.chain.at(-1).key, restored: p.chain.length > 1 && p.chain.at(-1).sig === undefined };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * §7.1 steps 1–6 over profile bytes. `pin` is what the reader verified last time (or null).
 * Returns `{ verdict, why }` or `{ verdict: 'ok', raw, chain, profile, recoveryLists, fields }`.
 */
export function verifyProfile(bytes, { learned, pin = null }) {
  const bad = (verdict, why) => ({ verdict, why });
  // Parse before any key is known: the anchor check needs the body, and which key signs is the
  // chain's last word.
  let parsedRaw;
  try { const s = splitFile(bytes); parsedRaw = s && parseBody(s.body); } catch { parsedRaw = null; }
  if (!parsedRaw || parsedRaw.anchor !== learned) return bad('identity', 'not the identity this reader learned');
  const p = parsedRaw;
  if (!wellFormed(p)) return bad('identity', 'the profile is malformed');
  const recoveryLists = { ...(pin?.recoveryLists ?? {}) };
  adoptRecoveryLists(recoveryLists, p, pin ? pin.chain.length : 0);
  let chain = walk(p, recoveryLists);
  if (!chain) return bad('identity', 'the chain of key changes does not hold');
  const profile = verifyFile(bytes, chain.current);
  if (!profile) return bad('identity', 'the profile is not signed by the key it ends on');
  const fields = [p.recovery, p.locations, p.name, p.read];
  if (pin) {
    let i = p.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);
    if (i < 0 && p.chain.length < pin.chain.length && p.version > pin.profileVersion) i = p.chain.length;   // forgetting a link is a fork too
    if (i > 0) {
      const mine = majority(pin.chain[i - 1].key, pin.chain[i], recoveryLists[i]), theirs = majority(p.chain[i - 1].key, p.chain[i], recoveryLists[i]);
      if (mine === theirs) return bad('identity', 'contested: two histories, and no majority settles it');
      if (mine) return bad('host', 'serves a branch the recovery rejected');
      for (const j of Object.keys(recoveryLists)) if (+j > i) delete recoveryLists[j];
      adoptRecoveryLists(recoveryLists, p, i + 1);
      if (!(chain = walk(p, recoveryLists))) return bad('identity', 'the chain of key changes does not hold');
    } else if (p.version < pin.profileVersion) return bad('identity', 'an older profile than the one this reader saw');
    else if (p.version === pin.profileVersion && profile.address !== pin.profileHash) return bad('identity', 'contested: two profiles at one version');
    else if (chain.restored && p.chain.length === pin.chain.length + 1 && !sameJson(fields, [recoveryLists[pin.chain.length], ...pin.fields.slice(1)])) return bad('identity', 'a restore changed more than the key');
  }
  return { verdict: 'ok', raw: p, chain, profile, recoveryLists, fields };
}
