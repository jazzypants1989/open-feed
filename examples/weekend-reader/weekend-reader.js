// The whole reader, written from TLDR-new.md and the rulings, in one file, with nothing but the
// standard library. This is HANDOFF-to-spec.md §1.H's minimality measure: if it needs a thing the
// TL;DR does not say, the TL;DR is wrong, not this file. It deliberately imports NOTHING from
// lastline.js — the point is what a second implementer can write from the text alone.
//
// Measured by weekend-gate.js, which also drives it against a real hub over a socket.
import crypto from 'node:crypto';

// ---- bytes ----
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const pub = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });

// A signature line is exactly 86 base64url characters that re-encode to themselves.
function sigBytes(line) {
  if (!/^[A-Za-z0-9_-]{86}$/.test(line)) return null;
  const b = Buffer.from(line, 'base64url');
  return b.toString('base64url') === line ? b : null;
}

// A file is body bytes, one newline, then the signature over the body. Its address is the hash of
// the body, never of the whole file: two honest signers of the same bytes can differ in the line.
function openFile(bytes, keys) {
  const i = bytes.lastIndexOf(0x0a);
  if (i < 0) return null;
  const body = bytes.subarray(0, i), sig = sigBytes(bytes.subarray(i + 1).toString('latin1'));
  if (!sig) return null;
  const by = [keys].flat().find((x) => { try { return crypto.verify(null, body, pub(x), sig); } catch { return false; } });
  if (!by) return null;
  const obj = parse(body.toString('utf8'));
  return obj === undefined ? null : { obj, by, address: sha256(body), body };
}

// JSON.parse cannot see a duplicate member, treats __proto__ as an own property, silently rounds
// integers past 2^53 and keeps a lone surrogate — four ways two readers disagree about signed
// bytes. Scan for them first, then parse.
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/;
function parse(text) {
  if (text.charCodeAt(0) === 0xfeff) return undefined;
  const stack = [];
  let expectKey = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      let str; try { str = JSON.parse(text.slice(i, j + 1)); } catch { return undefined; }
      if (LONE.test(str)) return undefined;
      if (expectKey) {
        const seen = stack[stack.length - 1];
        if (str === '__proto__' || seen.has(str)) return undefined;
        seen.add(str); expectKey = false;
      }
      i = j;
    } else if (c === '{') { stack.push(new Set()); expectKey = true; }
    else if (c === '[') { stack.push(null); expectKey = false; }
    else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') expectKey = stack[stack.length - 1] instanceof Set;
    else if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
      if (m && !m[1] && !m[2] && (BigInt(m[0]) > 9007199254740991n || BigInt(m[0]) < -9007199254740991n)) return undefined;
      i += (m?.[0].length ?? 1) - 1;
    }
  }
  try { return JSON.parse(text); } catch { return undefined; }
}

// ---- the profile's chain of key changes ----
// One link shape. Every link carries the list that stood before it; a link is valid when the previous
// key signed it (a rotation) or enough distinct listed members vouched for it (a restore), and it
// may carry both. The reader judges a link by the recovery IT holds at that length — the carried copy
// is only for a reader that holds none. `vouches` counts distinct listed members.
const linkSig = (from, to, x, s) => { const b = sigBytes(s ?? ''); try { return !!b && crypto.verify(null, Buffer.from(`${from}->${to}`), pub(x), b); } catch { return false; } };
function vouches(from, link, recovery) {
  const leaves = new Set(recovery?.leaves ?? []);
  return new Set((link?.vouchers ?? []).filter((v) => linkSig(from, link.key, v.key, v.sig) && leaves.has(sha256(Buffer.from(`${v.salt}|${v.key}`)))).map((v) => v.key)).size;
}
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function walk(p, recoveryLists) {
  for (let i = 1; i < p.chain.length; i++) {
    const link = p.chain[i], from = p.chain[i - 1].key, recovery = recoveryLists[i];
    if (!Array.isArray(link?.recovery?.leaves) || !recovery) return null;
    if (!linkSig(from, link.key, from, link.sig) && vouches(from, link, recovery) < recovery.k) return null;
  }
  return { keys: p.chain.map((h) => h.key), current: p.chain[p.chain.length - 1].key, restored: p.chain.length > 1 && p.chain.at(-1).sig === undefined };
}

// ---- the index ----
// The live set is a fold over the entries in order: [n, hash] admits, [n, null] takes one back. A
// number has one hash, ever: the only legal second line for it is its withdrawal, or its return at
// the identical hash. A media file is listed by its hash alone — [hash] admits it, [hash, null] takes it
// back — and is the one unsigned thing: what admits it is being listed, and what checks it is the hash.
function fold(entries) {
  if (!Array.isArray(entries)) return null;
  const live = new Map(), issued = new Map();
  for (const e of entries) {
    if (!Array.isArray(e) || e.length > 2 || (typeof e[0] !== 'number' && typeof e[0] !== 'string')) return null;
    if (typeof e[0] === 'string') { if (e[1] === null ? !live.delete(e[0]) : (e.length !== 1 || live.has(e[0]))) return null; if (e.length === 1) live.set(e[0], { hash: e[0] }); continue; }
    const [n, hash] = e;
    if (!(Number.isInteger(n) && n >= 1)) return null;
    if (hash === null) { if (!live.has(n)) return null; live.delete(n); continue; }
    if (typeof hash !== 'string') return null;
    const had = issued.get(n);
    if (had && (had !== hash || live.has(n))) return null;
    issued.set(n, hash); live.set(n, { hash });
  }
  return { live, top: Math.max(0, ...issued.keys()) };
}

// ---- the reader ----
// `learned` is the anchor key the reader got off the host's path — a link, a scanned code. `pin`
// is what it remembers from the last time it verified this identity itself. Three verdicts:
// ok, host (this host is misbehaving), identity (who this is is in question).
const WEEK = 7 * 86400e3;
export async function read(get, { learned, at, pin = null, now = Date.now() } = {}) {
  const note = [], say = (v) => note.includes(v) || note.push(v);
  const bad = (verdict, why) => ({ verdict, why, note });

  const pf = await get(`${at}/profile`);
  if (!pf) return bad('host', 'no profile served');
  const raw = pf.lastIndexOf(0x0a) < 0 ? null : parse(pf.subarray(0, pf.lastIndexOf(0x0a)).toString('utf8'));
  if (!raw || raw.anchor !== learned) return bad('identity', 'not the identity this reader learned');
  if (!Array.isArray(raw.chain) || raw.chain[0]?.key !== raw.anchor) return bad('identity', 'the chain does not start at the anchor');
  // The recovery. A reader keeps, for every chain length it has seen, the FIRST recovery list it saw
  // there — from the link that carried it, or from the profile. A pinned reader adopts nothing at a
  // length its pinned chain already reaches. A served chain that does not extend the pinned one is
  // a split; the list that stood at the split judges it, and the branch whose link there has a
  // majority of that list wins. No majority on exactly one side: contested.
  const recoveryLists = { ...(pin?.recoveryLists ?? {}) };
  const adopt = (from) => { raw.chain.forEach((h, j) => { if (j >= from && h.recovery && !(j in recoveryLists)) recoveryLists[j] = h.recovery; }); if (raw.chain.length >= from) recoveryLists[raw.chain.length] ??= raw.recovery; };
  adopt(pin ? pin.chain.length : 0);
  let chain = walk(raw, recoveryLists);
  if (!chain) return bad('identity', 'the chain of key changes does not hold');
  const profile = openFile(pf, chain.current);
  if (!profile) return bad('identity', 'the profile is not signed by the key it ends on');
  if (pin) {
    let i = raw.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);
    if (i < 0 && raw.chain.length < pin.chain.length && raw.version > pin.profileVersion) i = raw.chain.length;   // a newer profile that forgets a link is a fork too
    if (i > 0) {
      const majority = (c) => vouches(c[i - 1].key, c[i], recoveryLists[i]) * 2 > (recoveryLists[i]?.leaves.length ?? Infinity);
      const mine = majority(pin.chain), theirs = majority(raw.chain);
      if (mine === theirs) return bad('identity', 'contested: two histories, and no majority settles it');
      if (mine) return bad('host', 'serves a branch the recovery rejected');
      for (const j of Object.keys(recoveryLists)) if (j > i) delete recoveryLists[j];
      adopt(i + 1);
      if (!(chain = walk(raw, recoveryLists))) return bad('identity', 'the chain of key changes does not hold');
    } else if (raw.version < pin.profileVersion) return bad('identity', 'an older profile than the one this reader saw');
    else if (raw.version === pin.profileVersion && profile.address !== pin.profileHash) return bad('identity', 'contested: two profiles at one version');
    // A restore that arrived since the pin changed the key and nothing else — only a pinned reader can tell.
    else if (chain.restored && raw.chain.length === pin.chain.length + 1 && !sameList([raw.recovery, raw.locations, raw.name, raw.read], [recoveryLists[pin.chain.length], ...pin.fields])) return bad('identity', 'a restore changed more than the key');
  }
  // "Recently restored" is a flag beside a name for seven days of this reader's clock, never a verdict.
  const restoredAt = chain.restored ? (pin?.restoredAt?.[raw.chain.length] ?? now) : null;
  if (restoredAt !== null && now - restoredAt < WEEK) say('recently restored');

  // The index must be signed by the key that is current NOW — that is what takes the list away from
  // a thief holding an old one. So a rotation means writing the index again, and in the moment
  // between those two writes there is no index this reader can verify. That is not an accusation:
  // a reader holding one it verified itself keeps it and says nothing. Only a reader with none
  // has anything to report.
  const hf = await get(`${at}/index`);
  let index = hf && openFile(hf, chain.current);
  let set = index && fold(index.obj.entries);
  if (index && (!set || !(Number.isInteger(index.obj.top) && index.obj.top >= set.top))) return bad('host', 'the index does not fold');
  if (!index) {
    if (!pin) return bad('host', hf ? 'the index is not signed by the key the profile ends on' : 'no index served');
    say('no index I can verify');
    set = { live: new Map([...pin.live].map(([n, h]) => [n, { hash: h }])), top: pin.top };
    index = { obj: { version: pin.indexVersion, top: pin.top }, address: pin.indexHash };
  }
  const withdrawn = new Map(pin?.withdrawn ?? []);
  if (pin) {
    if (index.obj.version < pin.indexVersion) return bad('host', 'a index older than the one this reader saw');
    if (index.obj.version === pin.indexVersion && index.address !== pin.indexHash) return bad('host', 'two indexes at one version');
    if (index.obj.top < pin.top) return bad('host', 'the highest number used went backwards');
    // Whatever was rewritten since, a post the reader saw either survived unchanged, was withdrawn,
    // or came back at the hash it had; a number at or below the old top cannot appear that was
    // never there, and cannot come back as something else.
    for (const [n, e] of set.live) {
      if (typeof n !== 'number' || n > pin.top) continue;
      const was = pin.live.get(n) ?? withdrawn.get(n);
      if (!was) return bad('host', `post ${n} is listed now and was not before`);
      if (was !== e.hash) return bad('host', `post ${n} changed after the reader saw it`);
    }
    for (const [n, h] of pin.live) if (!set.live.has(n)) { say(`withdrawn: ${n}`); withdrawn.set(n, h); }
    for (const n of withdrawn.keys()) if (set.live.has(n)) withdrawn.delete(n);
  }

  const posts = new Map(), media = new Map();
  for (const [n, e] of set.live) {
    const f = await get(typeof n === 'string' ? `${at}/media/${n}` : `${at}/posts/${n}`);
    if (!f) return bad('host', `${typeof n === 'string' ? 'media file' : 'post'} ${n} is listed and not served`);
    if (typeof n === 'string') { if (sha256(f) !== n) return bad('host', `media file ${n} is not what the index lists`); media.set(n, f); continue; }
    const post = openFile(f, chain.keys);
    // Signed by a key that was hers, listed by the index, and declaring the number it was served at.
    if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the index lists`);
    posts.set(n, post.obj);
  }

  return {
    verdict: 'ok', note, posts, media, chain, locations: raw.locations ?? [], read: raw.read,
    pin: { profileVersion: raw.version, profileHash: profile.address, chain: raw.chain, recoveryLists, fields: [raw.locations, raw.name, raw.read],
      restoredAt: { ...(pin?.restoredAt ?? {}), ...(restoredAt !== null ? { [raw.chain.length]: restoredAt } : {}) },
      indexVersion: index.obj.version, indexHash: index.address, top: index.obj.top,
      live: new Map([...set.live].map(([n, e]) => [n, e.hash])), withdrawn },
  };
}

// A reply names its target by key, number, hash and location. A target whose hash is not what that
// author's index lists — now, or when it was withdrawn — is a reply to something else, and says
// nothing. A number above the top of the index the reader holds for that author is the only thing
// worth raising, and it is a rumor naming the replier, never an accusation: re-fetch, and if the
// host still will not show it, say so.
export async function rumors(get, seen, posts, replier) {
  const out = [], refreshed = new Set();
  for (const p of posts.values()) {
    const t = p.target;
    if (!t || !seen.has(t.key)) continue;
    const listed = () => { const s = seen.get(t.key); return s.live.get(t.n) ?? s.withdrawn.get(t.n); };
    if (listed() !== undefined && listed() !== t.hash) { t.unresolved = true; continue; }
    if (t.n <= seen.get(t.key).top) continue;                         // withdrawn, or superseded — quiet
    // Look again, but once per identity per pass: a thousand replies naming a number that does not
    // exist must not turn into a thousand fetches aimed at somebody else's host.
    if (!refreshed.has(t.key)) {
      refreshed.add(t.key);
      const again = await read(get, { learned: t.key, at: t.loc, pin: seen.get(t.key) });
      if (again.verdict === 'ok') seen.set(t.key, again.pin);
    }
    // One line per person, however many replies they wrote: the rumor names who, not how often.
    const line = `${replier} replied to something I cannot see`;
    if (t.n > seen.get(t.key).top && !out.includes(line)) out.push(line);
  }
  return out;
}
