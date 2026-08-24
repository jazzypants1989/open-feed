// §7 — the whole reader in one file, with nothing but the standard library. It was written from
// the protocol's text alone, before `src/` existed, as `GOALS.md` scenario 6's measurement: if it
// needs a thing the text does not say, the text is wrong, not this file. It imports NOTHING from
// `src/` and nothing from the weekend publisher, and that is the point — `tools/regen.js` verifies
// every vector in Appendix B with this reader and with `src/reader.js`, and two independent
// readers agreeing is the interop check the spec exists for.
//
// Run it: `node examples/weekend-reader/weekend-reader.js`. See `weekend-reader.md`.
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
    if (index.obj.version < pin.indexVersion) return bad('host', 'an index older than the one this reader saw');
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

// ============================================================================================
// The measurement stops here. Everything below runs only when this file is run directly, and is
// the narration `npm run examples` checks — it is not part of the reader.
// ============================================================================================
const isMain = process.argv[1] === (await import('node:url')).fileURLToPath(import.meta.url);
if (isMain) {
  const fs = await import('node:fs');
  const assert = (await import('node:assert/strict')).default;
  // The publisher is imported HERE, below the marker, so the file above it still imports nothing
  // but node:crypto — which is the measurement this pair exists to make.
  const P = await import('../weekend-publisher/weekend-publisher.js');
  const srcLines = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  const impl = srcLines.slice(0, srcLines.findIndex((l) => l.startsWith('// ====')));
  const measured = impl.filter((l) => l.trim() && !l.trim().startsWith('//')).length;

  const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
  const seeded = (label) => {
    const seed = crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
    const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: 'der', type: 'pkcs8' });
    return { privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
  };
  const A1 = seeded('alice/anchor'), A2 = seeded('alice/rotated'), THIEF = seeded('thief');
  const MUM = { key: seeded('mum'), salt: 'saltmum' }, SIS = { key: seeded('sis'), salt: 'saltsis' }, BRO = { key: seeded('bro'), salt: 'saltbro' };
  const REC = P.commit(2, [MUM, SIS, BRO]);
  const at = 'https://alice.example/alice';
  const NOW = Date.parse('2026-09-01T00:00:00Z');                   // §3.4's seven-day flag needs a clock

  const files = new Map();
  const get = async (p) => files.get(p) ?? null;
  const posts = [1, 2, 3].map((n) => P.post(n, { at: `2026-07-0${n}T10:00:00Z`, text: `post ${n}` }, A1));
  posts.forEach((f, i) => files.set(`${at}/posts/${i + 1}`, f));
  const base = { anchor: A1.x, name: 'Alice', recovery: REC, locations: [at] };
  files.set(`${at}/profile`, P.profile({ ...base, version: 1, chain: [{ key: A1.x }] }, A1));
  files.set(`${at}/index`, P.index({ entries: posts.map((f, i) => [i + 1, P.address(f)]), version: 1, top: 3 }, A1));

  console.log('weekend-reader — §7, written from the text alone\n');
  console.log(`  ${measured} non-blank, non-comment lines above the marker, standard library only.`);
  console.log('  About a quarter of it is the strict JSON scan, which exists because JSON.parse');
  console.log('  cannot see a duplicate member (§2.4). It imports nothing from the publisher.\n');
  assert.ok(measured < 200, 'the kill criterion was 200 lines');

  console.log('§7 — an honest read\n');
  const ok = await read(get, { learned: A1.x, at, now: NOW });
  console.log(`  verdict  ${ok.verdict}`);
  console.log(`  posts    ${[...ok.posts.keys()].join(', ')}`);
  console.log(`  notes    ${ok.note.length ? ok.note.join('; ') : '(none)'}\n`);
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.posts.size, 3);
  const pin = ok.pin;

  console.log('§7.3 — the hostile moves, and the verdict each one earns\n');
  const moves = [];
  const restore = new Map(files);
  const move = async (what, stage, opts = {}) => {
    const saved = new Map(files);
    await stage();
    const r = await read(get, { learned: A1.x, at, now: NOW, ...opts });
    files.clear(); saved.forEach((v, k) => files.set(k, v));
    moves.push([what, r.verdict]);
    console.log(`  ${what.padEnd(48)} ${r.verdict}${r.why ? ` — ${r.why}` : ''}`);
    return r;
  };
  await move('nothing wrong', () => {}, { pin });
  await move('a listed post withheld', () => files.delete(`${at}/posts/2`), { pin });
  await move('post 2 served at the path for post 3', () => files.set(`${at}/posts/3`, files.get(`${at}/posts/2`)), { pin });
  await move('an older index served', () => files.set(`${at}/index`, P.index({ entries: [[1, P.address(posts[0])]], version: 1, top: 1 }, A1)), { pin });
  await move('a post signed by a key that was never hers', () => files.set(`${at}/posts/2`, P.post(2, { at: '2026-07-02T10:00:00Z', text: 'not hers' }, THIEF)), { pin });
  await move('a whole other identity at this address', () => files.set(`${at}/profile`, P.profile({ ...base, anchor: THIEF.x, version: 1, chain: [{ key: THIEF.x }] }, THIEF)), { pin });
  await move('a thief\'s branch, vouched by nobody on the list', () => files.set(`${at}/profile`, P.profile({ ...base, version: 2, chain: [{ key: A1.x }, P.restore(A1, THIEF, [{ key: THIEF, salt: 'x' }], REC)] }, THIEF)), { pin });
  await move('an index signed by a rotated-out key (cold)', () => files.set(`${at}/index`, P.index({ entries: [], version: 2, top: 3 }, THIEF)));
  const verdicts = new Set(moves.map(([, v]) => v));
  console.log(`\n  ${moves.length} moves, ${verdicts.size} distinct verdicts: ${[...verdicts].sort().join(', ')}`);
  console.log('  §7.3 allows exactly three, and a reader that invents a fourth cries wolf.\n');
  assert.equal(verdicts.size, 3);
  files.clear(); restore.forEach((v, k) => files.set(k, v));

  console.log('§7.2 — an index it cannot verify is not an accusation\n');
  files.set(`${at}/profile`, P.profile({ ...base, version: 2, chain: [{ key: A1.x }, P.rotation(A1, A2, REC)] }, A2));
  const mid = await read(get, { learned: A1.x, at, now: NOW, pin });
  console.log(`  mid-rotation, pinned   ${mid.verdict}  notes: ${mid.note.join('; ')}`);
  const cold = await read(get, { learned: A1.x, at, now: NOW });
  console.log(`  mid-rotation, cold     ${cold.verdict} — ${cold.why}`);
  console.log('\n  The honest host is between its two writes (§3.5). A reader holding an index it');
  console.log('  verified itself keeps that one and says nothing; only a reader with none reports.\n');
  assert.equal(mid.verdict, 'ok');
  assert.ok(mid.note.some((n) => n.includes('no index I can verify')));
  assert.equal(cold.verdict, 'host');

  console.log('Every line above is asserted.');
}
