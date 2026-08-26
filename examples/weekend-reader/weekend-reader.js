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
// key signed it (a rotation) or more than half of the listed members vouched for it (a restore), and
// it may carry both. The reader judges a link by the recovery IT holds at that length — the carried copy
// is only for a reader that holds none. `vouches` counts distinct listed members.
const linkSig = (from, to, x, s) => { const b = sigBytes(s ?? ''); try { return !!b && crypto.verify(null, Buffer.from(`${from}->${to}`), pub(x), b); } catch { return false; } };
function vouches(from, link, recovery) {
  const leaves = new Set(recovery?.leaves ?? []);
  return new Set((link?.vouchers ?? []).filter((v) => linkSig(from, link.key, v.key, v.signature) && leaves.has(sha256(Buffer.from(`${v.salt}|${v.key}`)))).map((v) => v.key)).size;
}
const majority = (from, link, recovery) => vouches(from, link, recovery) * 2 > (recovery?.leaves?.length ?? Infinity);
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function walk(p, recoveryLists) {
  for (let i = 1; i < p.chain.length; i++) {
    const link = p.chain[i], from = p.chain[i - 1].key, recovery = recoveryLists[i];
    if (!Array.isArray(link?.recovery?.leaves) || !recovery) return null;
    if (!linkSig(from, link.key, from, link.signature) && !majority(from, link, recovery)) return null;
  }
  return { keys: p.chain.map((h) => h.key), current: p.chain[p.chain.length - 1].key, restored: p.chain.length > 1 && p.chain.at(-1).signature === undefined };
}

// ---- the index ----
// The live set is a replay of the entries in order: [number, hash] admits, [number, null] takes one back. A
// number has one hash, ever: the only legal second line for it is its withdrawal, or its return at
// the identical hash. A media file is listed by its hash alone — [hash] admits it, [hash, null] takes it
// back — and is the one unsigned thing: what admits it is being listed, and what checks it is the hash.
function replay(entries) {
  if (!Array.isArray(entries)) return null;
  const live = new Map(), issued = new Map();
  for (const e of entries) {
    if (!Array.isArray(e) || e.length > 2 || (typeof e[0] !== 'number' && typeof e[0] !== 'string')) return null;
    if (typeof e[0] === 'string') { if (e[1] === null ? !live.delete(e[0]) : (e.length !== 1 || live.has(e[0]))) return null; if (e.length === 1) live.set(e[0], { hash: e[0] }); continue; }
    const [number, hash] = e;
    if (!(Number.isInteger(number) && number >= 1)) return null;
    if (hash === null) { if (!live.has(number)) return null; live.delete(number); continue; }
    if (typeof hash !== 'string') return null;
    const had = issued.get(number);
    if (had && (had !== hash || live.has(number))) return null;
    issued.set(number, hash); live.set(number, { hash });
  }
  return { live, highest: Math.max(0, ...issued.keys()) };
}

// ---- the reader ----
// `learned` is the anchor key the reader got off the hub's path — a link, a scanned code. `checkpoint`
// is what it remembers from the last time it verified this identity itself. Three verdicts:
// ok, tampered (this hub is misbehaving), contested (who this is is in question).
const WEEK = 7 * 86400e3;
export async function read(get, { learned, at, checkpoint = null, now = Date.now() } = {}) {
  const note = [], say = (v) => note.includes(v) || note.push(v);
  const bad = (verdict, why) => ({ verdict, why, note });

  const pf = await get(`${at}/profile`);
  if (!pf) return bad('tampered', 'no profile served');
  const raw = pf.lastIndexOf(0x0a) < 0 ? null : parse(pf.subarray(0, pf.lastIndexOf(0x0a)).toString('utf8'));
  if (!raw || raw.anchor !== learned) return bad('contested', 'not the identity this reader learned');
  if (!Array.isArray(raw.chain) || raw.chain[0]?.key !== raw.anchor) return bad('contested', 'the chain does not start at the anchor');
  // The recovery. A reader keeps, for every chain length it has seen, the FIRST recovery list it saw
  // there — from the link that carried it, or from the profile. A checkpointed reader adopts nothing at a
  // length its checkpointed chain already reaches. A served chain that does not extend the checkpointed one is
  // a divergence; the list that stood at the divergence point judges it, and the branch whose link there has a
  // majority of that list wins. No majority on exactly one side: contested.
  const recoveryLists = { ...(checkpoint?.recoveryLists ?? {}) };
  const adopt = (from) => { raw.chain.forEach((h, j) => { if (j >= from && h.recovery && !(j in recoveryLists)) recoveryLists[j] = h.recovery; }); if (raw.chain.length >= from) recoveryLists[raw.chain.length] ??= raw.recovery; };
  adopt(checkpoint ? checkpoint.chain.length : 0);
  let chain = walk(raw, recoveryLists);
  if (!chain) return bad('contested', 'the chain of key changes does not hold');
  const profile = openFile(pf, chain.current);
  if (!profile) return bad('contested', 'the profile is not signed by the key it ends on');
  if (checkpoint) {
    let i = raw.chain.findIndex((h, j) => j < checkpoint.chain.length && checkpoint.chain[j].key !== h.key);
    if (i < 0 && raw.chain.length < checkpoint.chain.length && raw.version > checkpoint.profileVersion) i = raw.chain.length;   // a newer profile that forgets a link is a fork too
    if (i > 0) {
      const mine = majority(checkpoint.chain[i - 1].key, checkpoint.chain[i], recoveryLists[i]), theirs = majority(raw.chain[i - 1].key, raw.chain[i], recoveryLists[i]);
      if (mine === theirs) return bad('contested', 'two histories, and no majority settles it');
      if (mine) return bad('tampered', 'serves a branch the recovery rejected');
      for (const j of Object.keys(recoveryLists)) if (j > i) delete recoveryLists[j];
      adopt(i + 1);
      if (!(chain = walk(raw, recoveryLists))) return bad('contested', 'the chain of key changes does not hold');
    } else if (raw.version < checkpoint.profileVersion) return bad('contested', 'an older profile than the one this reader saw');
    else if (raw.version === checkpoint.profileVersion && profile.address !== checkpoint.profileHash) return bad('contested', 'two profiles at one version');
    // A version that added any unsigned link since the checkpoint changed the key and nothing else — only a checkpointed reader can tell.
    else if (raw.chain.slice(checkpoint.chain.length).some((h) => h.signature === undefined) && !sameList([raw.recovery, raw.locations, raw.name, raw.read], [recoveryLists[checkpoint.chain.length], ...checkpoint.fields])) return bad('contested', 'a restore changed more than the key');
  }
  // "Recently restored" is a flag beside a name for seven days of this reader's clock, never a verdict.
  const restoredAt = chain.restored ? (checkpoint?.restoredAt?.[raw.chain.length] ?? now) : null;
  if (restoredAt !== null && now - restoredAt < WEEK) say('recently restored');

  // The index must be signed by the key that is current NOW — that is what takes the list away from
  // a thief holding an old one. So a rotation means writing the index again, and in the moment
  // between those two writes there is no index this reader can verify. That is not an accusation:
  // a reader holding one it verified itself keeps it and says nothing. Only a reader with none
  // has anything to report.
  const hf = await get(`${at}/index`);
  let index = hf && openFile(hf, chain.current);
  let set = index && replay(index.obj.entries);
  // §4.1 is replay; `entries` first, a non-negative `version` and `highest`'s floor are §4's shape.
  const shape = index && (!set ? 'the index entries are invalid' : Object.keys(index.obj)[0] !== 'entries' ? 'entries is not the first member' : !(Number.isInteger(index.obj.version) && index.obj.version >= 0) ? 'version is not a non-negative integer' : !(Number.isInteger(index.obj.highest) && index.obj.highest >= set.highest) ? 'highest is below the highest number issued' : null);
  if (shape) return bad('tampered', shape);
  if (!index) {
    if (!checkpoint) return bad('tampered', hf ? 'the index is not signed by the key the profile ends on' : 'no index served');
    say('no index I can verify');
    set = { live: new Map([...checkpoint.live].map(([number, h]) => [number, { hash: h }])), highest: checkpoint.highest };
    index = { obj: { version: checkpoint.indexVersion, highest: checkpoint.highest }, address: checkpoint.indexHash };
  }
  const withdrawn = new Map(checkpoint?.withdrawn ?? []);
  if (checkpoint) {
    if (index.obj.version < checkpoint.indexVersion) return bad('tampered', 'an index older than the one this reader saw');
    if (index.obj.version === checkpoint.indexVersion && index.address !== checkpoint.indexHash) return bad('tampered', 'two indexes at one version');
    if (index.obj.highest < checkpoint.highest) return bad('tampered', 'the highest number used went backwards');
    // Whatever was rewritten since, a post the reader saw either survived unchanged, was withdrawn,
    // or came back at the hash it had; a number at or below the old highest cannot appear that was
    // never there, and cannot come back as something else.
    for (const [number, e] of set.live) {
      if (typeof number !== 'number' || number > checkpoint.highest) continue;
      const was = checkpoint.live.get(number) ?? withdrawn.get(number);
      if (!was) return bad('tampered', `post ${number} is listed now and was not before`);
      if (was !== e.hash) return bad('tampered', `post ${number} changed after the reader saw it`);
    }
    for (const [number, h] of checkpoint.live) if (!set.live.has(number)) { say(`withdrawn: ${number}`); withdrawn.set(number, h); }
    for (const number of withdrawn.keys()) if (set.live.has(number)) withdrawn.delete(number);
  }

  const posts = new Map(), media = new Map();
  for (const [number, e] of set.live) {
    const f = await get(typeof number === 'string' ? `${at}/media/${number}` : `${at}/posts/${number}`);
    if (!f) return bad('tampered', `${typeof number === 'string' ? 'media file' : 'post'} ${number} is listed and not served`);
    if (typeof number === 'string') { if (sha256(f) !== number) return bad('tampered', `media file ${number} is not what the index lists`); media.set(number, f); continue; }
    const post = openFile(f, chain.keys);
    // Signed by a key that was hers, listed by the index, and declaring the number it was served at.
    if (!post || post.address !== e.hash || post.obj.number !== number) return bad('tampered', `post ${number} is not what the index lists`);
    posts.set(number, post.obj);
  }

  return {
    verdict: 'ok', note, posts, media, chain, locations: raw.locations ?? [], read: raw.read,
    checkpoint: { profileVersion: raw.version, profileHash: profile.address, chain: raw.chain, recoveryLists, fields: [raw.locations, raw.name, raw.read],
      restoredAt: { ...(checkpoint?.restoredAt ?? {}), ...(restoredAt !== null ? { [raw.chain.length]: restoredAt } : {}) },
      indexVersion: index.obj.version, indexHash: index.address, highest: index.obj.highest,
      live: new Map([...set.live].map(([number, e]) => [number, e.hash])), withdrawn },
  };
}

// A reply names its target by key, number, hash and location. A target whose hash is not what that
// author's index lists — now, or when it was withdrawn — is a reply to something else, and says
// nothing. A number above the highest of the index the reader holds for that author is the only thing
// worth raising, and it is a rumor naming the replier, never an accusation: re-fetch, and if the
// hub still will not show it, say so.
export async function rumors(get, seen, posts, replier) {
  const out = [], refreshed = new Set();
  for (const p of posts.values()) {
    const t = p.target;
    if (!t || !seen.has(t.key)) continue;
    const listed = () => { const s = seen.get(t.key); return s.live.get(t.number) ?? s.withdrawn.get(t.number); };
    if (listed() !== undefined && listed() !== t.hash) { t.unresolved = true; continue; }
    if (t.number <= seen.get(t.key).highest) continue;                         // withdrawn, or superseded — quiet
    // Look again, but once per identity per pass: a thousand replies naming a number that does not
    // exist must not turn into a thousand fetches aimed at somebody else's hub.
    if (!refreshed.has(t.key)) {
      refreshed.add(t.key);
      const again = await read(get, { learned: t.key, at: t.location, checkpoint: seen.get(t.key) });
      if (again.verdict === 'ok') seen.set(t.key, again.checkpoint);
    }
    // One line per person, however many replies they wrote: the rumor names who, not how often.
    const line = `${replier} replied to something I cannot see`;
    if (t.number > seen.get(t.key).highest && !out.includes(line)) out.push(line);
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
  const A1 = seeded('alice/anchor'), A2 = seeded('alice/rotated'), A3 = seeded('alice/restored'), THIEF = seeded('ex');
  const MUM = { key: seeded('mum'), salt: 'saltmum' }, SIS = { key: seeded('sis'), salt: 'saltsis' }, BRO = { key: seeded('bro'), salt: 'saltbro' };
  const EX = { key: THIEF, salt: 'saltex' };
  const REC = P.commit([MUM, SIS, BRO]);
  const at = 'https://alice.example/alice', mumAt = 'https://mom.example/mom';
  const NOW = Date.parse('2026-09-01T00:00:00Z');                   // §3.4's seven-day flag needs a clock

  let fetches = 0;
  const files = new Map();
  const get = async (p) => { fetches++; return files.get(p) ?? null; };
  const put = (p, b) => files.set(p, b);

  // Alice: three posts and a photograph, but only 1 and 3 are listed. Post 2's bytes exist and
  // nobody listed them — a number nobody lists is nothing (§8.2), and it is also the bait for
  // a hub that would like to backdate one into her history.
  const posts = [1, 2, 3].map((number) => P.post(number, { at: `2026-07-0${number}T10:00:00Z`, text: `post ${number}` }, A1));
  posts.forEach((f, i) => put(`${at}/posts/${i + 1}`, f));
  const photo = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1');
  const mediaHash = crypto.createHash('sha256').update(photo).digest('base64url');
  put(`${at}/media/${mediaHash}`, photo);
  const listing = [[1, P.address(posts[0])], [3, P.address(posts[2])], [mediaHash]];
  const base = { anchor: A1.x, name: 'Alice', recovery: REC, locations: [at] };
  const anchored = P.profile({ ...base, version: 1, chain: [{ key: A1.x }] }, A1);
  put(`${at}/profile`, anchored);
  put(`${at}/index`, P.index({ entries: listing, version: 1, highest: 3 }, A1));

  console.log('weekend-reader — §7, written from the text alone\n');
  console.log(`  ${measured} non-blank, non-comment lines above the marker, standard library only.`);
  console.log('  About a sixth of it is the strict JSON scan, which exists because JSON.parse');
  console.log('  cannot see a duplicate member (§2.4). It imports nothing from the publisher.\n');
  assert.ok(measured < 200, 'the kill criterion was 200 lines');

  console.log('§7 — an honest read\n');
  const ok = await read(get, { learned: A1.x, at, now: NOW });
  console.log(`  verdict  ${ok.verdict}`);
  console.log(`  posts    ${[...ok.posts.keys()].join(', ')}   media 1   highest ${ok.checkpoint.highest}`);
  console.log(`  notes    ${ok.note.length ? ok.note.join('; ') : '(none)'}\n`);
  assert.equal(ok.verdict, 'ok');
  assert.deepEqual([...ok.posts.keys()], [1, 3]);
  const checkpoint = ok.checkpoint;

  // A second checkpoint, taken from the restored chain, so a profile that "forgets" the restore is a
  // strict prefix at a higher version — a divergence at the end of the prefix (§3.4 rule 1).
  const restoredChain = [{ key: A1.x }, P.rotation(A1, A2, REC), P.restore(A2, A3, [MUM, SIS], REC)];
  const keep = new Map(files);
  put(`${at}/profile`, P.profile({ ...base, version: 3, chain: restoredChain }, A3));
  put(`${at}/index`, P.index({ entries: listing, version: 1, highest: 3 }, A3));
  const restoredRead = await read(get, { learned: A1.x, at, now: NOW });
  const pinRestored = restoredRead.checkpoint;
  assert.equal(restoredRead.verdict, 'ok');
  files.clear(); keep.forEach((v, k) => files.set(k, v));

  console.log('§7.2 — the hostile moves, and the verdict each one earns\n');
  const moves = [];
  const clean = new Map(files);
  // Each move names the verdict it must earn. Counting three at the end is not enough by itself:
  // a check that stopped working would move one row to another verdict and leave the count at three.
  const move = async (what, want, stage, opts = { checkpoint }) => {
    const saved = new Map(files);
    await stage();
    const r = await read(get, { learned: A1.x, at, now: NOW, ...opts });
    files.clear(); saved.forEach((v, k) => files.set(k, v));
    moves.push([what, r.verdict]);
    console.log(`  ${what.padEnd(50)} ${r.verdict}${r.why ? ` — ${r.why}` : ''}`);
    assert.equal(r.verdict, want, what);
    return r;
  };
  const reindex = (entries, version, highest, key = A1) => put(`${at}/index`, P.index({ entries, version, highest }, key));
  const other2 = P.post(2, { at: '2026-07-02T10:00:00Z', text: 'not the post you saw' }, A1);

  await move('nothing wrong', 'ok', () => {});
  await move('a listed post withheld', 'tampered', () => files.delete(`${at}/posts/3`));
  await move('post 1 served at the path for post 3', 'tampered', () => put(`${at}/posts/3`, posts[0]));
  await move('a post signed by a key that was never hers', 'tampered', () => put(`${at}/posts/3`, P.post(3, { at: '2026-07-03T10:00:00Z', text: 'not hers' }, THIEF)));
  await move('an older index served', 'tampered', () => reindex([[1, P.address(posts[0])]], 1, 3));
  await move('a listed media file withheld', 'tampered', () => files.delete(`${at}/media/${mediaHash}`));
  await move('a media file that is not its own hash', 'tampered', () => put(`${at}/media/${mediaHash}`, Buffer.from('other bytes entirely')));
  await move('a number below the highest that was never there', 'tampered', () => reindex([...listing, [2, P.address(posts[1])]], 2, 3));
  await move('a number re-listed at another hash', 'tampered', () => reindex([...listing, [2, P.address(posts[1])], [2, null], [2, P.address(other2)]], 2, 3));
  await move('a whole other identity at this address', 'contested', () => put(`${at}/profile`, P.profile({ ...base, anchor: THIEF.x, version: 1, chain: [{ key: THIEF.x }] }, THIEF)));
  await move("a branch vouched only by a list the link brought", 'contested', () => put(`${at}/profile`,
    P.profile({ ...base, version: 2, chain: [{ key: A1.x }, P.restore(A1, THIEF, [EX], P.commit([EX])) ] }, THIEF)));
  await move('a newer profile that forgets her restore', 'contested',
    () => put(`${at}/profile`, P.profile({ ...base, version: 9, chain: [{ key: A1.x }] }, A1)), { checkpoint: pinRestored });
  await move('an index signed by a rotated-out key, to a cold reader', 'tampered',
    () => reindex([], 2, 3, THIEF), { checkpoint: null });
  await move('a genuine post listed at another number, to a cold reader', 'tampered',
    () => { put(`${at}/posts/3`, posts[1]); reindex([[1, P.address(posts[0])], [3, P.address(posts[1])], [mediaHash]], 1, 3); }, { checkpoint: null });
  await move('an index with `entries` not first', 'tampered', () => put(`${at}/index`, P.file({ version: 2, highest: 3, entries: listing }, A1)));
  const verdicts = new Set(moves.map(([, v]) => v));
  console.log(`\n  ${moves.length} moves, ${verdicts.size} distinct verdicts: ${[...verdicts].sort().join(', ')}`);
  console.log('  §7.2 allows exactly three, and a reader that invents a fourth cries wolf.\n');
  assert.equal(verdicts.size, 3);
  files.clear(); clean.forEach((v, k) => files.set(k, v));

  console.log('§7.1 — an index it cannot verify is not an accusation\n');
  const midway = new Map(files);
  put(`${at}/profile`, P.profile({ ...base, version: 2, chain: [{ key: A1.x }, P.rotation(A1, A2, REC)] }, A2));
  const mid = await read(get, { learned: A1.x, at, now: NOW, checkpoint });
  console.log(`  mid-rotation, checkpointed   ${mid.verdict}  notes: ${mid.note.join('; ')}`);
  const cold = await read(get, { learned: A1.x, at, now: NOW });
  console.log(`  mid-rotation, cold     ${cold.verdict} — ${cold.why}`);
  console.log('\n  The honest hub is between its two writes (§4.4). A reader holding an index it');
  console.log('  verified itself keeps that one and says nothing; only a reader with none reports.\n');
  assert.equal(mid.verdict, 'ok');
  assert.ok(mid.note.some((n) => n.includes('no index I can verify')));
  assert.equal(cold.verdict, 'tampered');
  files.clear(); midway.forEach((v, k) => files.set(k, v));

  // §7.4 — mum replies from her own hub, and a griefer replies a thousand times.
  console.log('§7.4 — the rumor rule, and what it costs\n');
  const target = (number) => ({ key: A1.x, number, hash: number === 1 ? P.address(posts[0]) : 'x'.repeat(43), location: at });
  const speak = (who, key, where, reps) => {
    const made = reps.map(([n, num]) => P.post(num, { at: '2026-08-01T00:00:00Z', text: 'saying something', rel: 'reply', target: target(n) }, key));
    made.forEach((f, i) => put(`${where}/posts/${reps[i][1]}`, f));
    put(`${where}/profile`, P.profile({ anchor: key.x, version: 1, name: who, chain: [{ key: key.x }], recovery: P.commit([]), locations: [where] }, key));
    put(`${where}/index`, P.index({ entries: made.map((f, i) => [reps[i][1], P.address(f)]), version: 1, highest: reps.length }, key));
    return made;
  };
  const body = (f) => JSON.parse(f.subarray(0, f.lastIndexOf(0x0a)).toString('utf8'));
  const asPosts = (made) => new Map(made.map((f, i) => [i + 1, body(f)]));
  const seen = new Map([[A1.x, { ...checkpoint }]]);
  const quiet = speak('Mum', MUM.key, mumAt, [[1, 1], [2, 2]]);          // 1 exists; 2 is at or below highest
  let before = fetches;
  const noRumor = await rumors(get, seen, asPosts(quiet), 'Mum');
  console.log(`  two replies at or below alice's highest   ${noRumor.length} lines, ${fetches - before} extra fetches`);
  assert.deepEqual(noRumor, []);
  assert.equal(fetches - before, 0);

  const N = 1000;
  const loud = speak('a griefer', BRO.key, 'https://loud.example/loud', Array.from({ length: N }, (_, i) => [9000 + i, i + 1]));
  before = fetches;
  const raised = await rumors(get, seen, asPosts(loud), 'a griefer');
  const looks = fetches - before;
  console.log(`  ${N} replies naming numbers above it   ${raised.length} line, ${looks} fetches — one look at alice, not ${N}`);
  console.log(`  the line                              ${JSON.stringify(raised[0])}`);
  console.log('\n  Both bounds are required: look again at most once per identity per pass, and say');
  console.log('  one line per person. Without them a thousand cheap replies buy a thousand fetches');
  console.log("  aimed at somebody else's hub, and a thousand messages. See examples/reading/.\n");
  assert.equal(raised.length, 1);
  assert.ok(looks <= 8, 'one look at that identity, not one per reply');

  console.log('Every line above is asserted.');
}
