// Revert-check the fresh-start candidate gates: apply each recorded mutation, require the gate to
// FAIL, restore the file. Same table shape as tmp/revert-gates.js, which hardcodes tmp/prototypes/
// and restores with git; these files are untracked while the design is on trial, so the original
// bytes are held in memory and written back. A gate already red on the clean tree is not credited.
//
//   node tmp/redesign/gates/revert.js
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..', '..');

const M = [
  ['lastline-gate', 'tmp/redesign/gates/lastline.js',
    "if (buf.toString('base64url') !== s) throw new GateError('signature: non-canonical spelling');",
    "if (false) throw new GateError('signature: non-canonical spelling');"],
  ['lastline-gate', 'tmp/redesign/gates/lastline.js',
    'export function verify(file, x, { decode = decodeStrict } = {}) {',
    'export function verify(file, x, { decode = decodeLenient } = {}) {'],
  ['lastline-gate', 'tmp/redesign/gates/lastline.js',
    'export const address = (file) => H(split(file).body);',
    'export const address = (file) => H(file);'],
  ['lastline-gate', 'tmp/redesign/gates/lastline.js',
    "if (keys.has(str)) throw new GateError(`json: duplicate member \"${str}\"`);",
    "if (false) throw new GateError(`json: duplicate member \"${str}\"`);"],
  ['headrange-gate', 'tmp/redesign/gates/lastline.js',
    "const o = order === 'entries-first' ? { entries, hseq, ...tail } : { hseq, ...tail, entries };",
    'const o = { hseq, ...tail, entries };'],
  ['headrange-gate', 'tmp/redesign/gates/headrange-gate.js',
    'const accept = (file) => verify(file, alice.x);',
    'const accept = () => true;'],
  ['persig-gate', 'tmp/redesign/gates/lastline.js',
    'return !!e && e[1] === address(postFile);',
    'return true;'],
  ['persig-gate', 'tmp/redesign/gates/persig-gate.js',
    'const signedByChain = (f) => chainKeys.some((x) => verify(f, x));',
    'const signedByChain = (f) => false;'],
  ['salt-custody-gate', 'tmp/redesign/gates/lastline.js',
    'commit(hop.salt, hop.members) === rec.commit && hop.vouchers.length >= rec.k',
    'true && hop.vouchers.length >= rec.k'],
  ['salt-custody-gate', 'tmp/redesign/gates/salt-custody-gate.js',
    'const leaf = (s, x) => H(Buffer.from(`${s}|${x}`));',
    'const leaf = (s, x) => H(Buffer.from(`${x}`));'],
  ['scheduled-gate', 'tmp/redesign/gates/scheduled-gate.js',
    "if (obj.hseq === pin.hseq && hash !== pin.hash) return 'FORK (two signed heads at one hseq)';",
    "if (false) return 'FORK (two signed heads at one hseq)';"],
  ['splitview-gate', 'tmp/redesign/gates/splitview-gate.js',
    'const cap = this.view.get(`${reader}|${a}`) ?? Infinity;',
    'const cap = Infinity;'],
  ['splitview-gate', 'tmp/redesign/gates/splitview-gate.js',
    "if (mode === 'b' && !pinOK(pin, keys[about].x)) { verdicts.push(`REPLIER-LIED:${from}`); return; }",
    "if (false) { verdicts.push(`REPLIER-LIED:${from}`); return; }"],
  ['splitview-gate', 'tmp/redesign/gates/splitview-gate.js',
    "const hint = mode === 'hint';",
    'const hint = false;'],
  ['forkcourt-gate', 'tmp/redesign/gates/forkcourt-gate.js',
    "if (new Set(atTop.map(({ file }) => address(file))).size > 1) return 'contested';",
    "if (false) return 'contested';"],
  ['forkcourt-gate', 'tmp/redesign/gates/forkcourt-gate.js',
    'const forkPointCourt = court(aliceList, [',
    'const forkPointCourt = court(thiefList, ['],
  ['kinds-gate', 'tmp/redesign/gates/kinds-gate.js',
    "const write = (f) => (overwrite ? store.put('posts/8', f, store.etag('posts/8')) : store.create('posts/8', f));",
    "const write = (f) => store.create('posts/8', f);"],
  ['kinds-gate', 'tmp/redesign/gates/kinds-gate.js',
    "if (byHash && e[1] !== t.hash) return 'withdrawn';",
    "if (false) return 'withdrawn';"],
  ['aohead-gate', 'tmp/redesign/gates/aohead-gate.js',
    'if (!e.pending) throw new GateError(`number ${n} listed twice`);',
    'if (false) throw new GateError(`number ${n} listed twice`);'],
  ['aohead-gate', 'tmp/redesign/gates/aohead-gate.js',
    "if (was.hash !== e.hash) return { ok: false, why: `${n} changed hash across the rewrite`, withdrawn };",
    'if (false) return { ok: false, why: `${n} changed hash across the rewrite`, withdrawn };'],
  ['aohead-gate', 'tmp/redesign/gates/aohead-gate.js',
    'const reconstruct = (cached, served) =>\n  Buffer.concat([split(cached).body.subarray(0, stableEnd(cached)), served.subarray(stableEnd(cached))]);',
    'const reconstruct = (cached, served) => served;'],
  ['aohead-gate', 'tmp/redesign/gates/aohead-gate.js',
    "const rumorTop = (head, n) => { const h = readHead(head); return n > h.obj.top ? 'rumor' : 'quiet'; };",
    "const rumorTop = (head, n) => rumor(head, n);"],
  ['aohead-gate', 'tmp/redesign/gates/aohead-gate.js',
    'const adjacent = obj.hseq === p.obj.hseq + 1;',
    'const adjacent = true;'],
  ['pubif-gate', 'tmp/redesign/gates/pubif-gate.js',
    'if ((cur ? H(cur) : null) !== ifMatch) return { status: 412, etag: cur ? H(cur) : null };',
    'if (false) return { status: 412, etag: cur ? H(cur) : null };'],
  ['pubif-gate', 'tmp/redesign/gates/pubif-gate.js',
    'if (this.files.has(key)) {                                          // create-once, with one exit',
    'if (false) {                                          // create-once, with one exit'],
  ['pubif-gate', 'tmp/redesign/gates/pubif-gate.js',
    'if (obj.pseq <= old.pseq) return { status: 409 };             // and a rollback is not an update',
    'if (false) return { status: 409 };             // and a rollback is not an update'],
  ['pubif-gate', 'tmp/redesign/gates/pubif-gate.js',
    "else if (!this.ownersFile(name, body, num)) return { status: 403 };  // signed by her chain AND for this number",
    'else if (false) return { status: 403 };'],
  ['pubif-gate', 'tmp/redesign/gates/pubif-gate.js',
    "      if (this.ownersFile(name, this.files.get(key), num) || !this.ownersFile(name, body, num)) return { status: 409 };",
    '      return { status: 409 };'],
  ['pubif-gate', 'tmp/redesign/gates/pubif-gate.js',
    "    try { return parseStrict(split(file).body.toString('utf8')).n === n; } catch { return false; }",
    '    return true;'],
  ['weekend-gate', 'tmp/redesign/gates/weekend-reader.js',
    "if (!raw || raw.genesis !== learned) return bad('identity', 'not the identity this reader learned');",
    "if (!raw) return bad('identity', 'not the identity this reader learned');"],
  ['weekend-gate', 'tmp/redesign/gates/weekend-reader.js',
    'let head = hf && openFile(hf, chain.current);',
    'let head = hf && openFile(hf, chain.keys);'],
  ['weekend-gate', 'tmp/redesign/gates/weekend-reader.js',
    "if (!post || post.address !== e.hash || post.obj.n !== n) return bad('host', `post ${n} is not what the head lists`);",
    "if (!post) return bad('host', `post ${n} is not what the head lists`);"],
  ['weekend-gate', 'tmp/redesign/gates/weekend-reader.js',
    'if (t.n > seen.get(t.key).top && !out.includes(line)) out.push(line);',
    'out.push(line);'],
  ['weekend-gate', 'tmp/redesign/gates/weekend-reader.js',
    'if (t.n <= seen.get(t.key).top) continue;                         // withdrawn, or superseded — quiet',
    'if (false) continue;'],
  ['weekend-gate', 'tmp/redesign/gates/weekend-reader.js',
    'if (!refreshed.has(t.key)) {',
    'if (true) {'],
  ['gapless-gate', 'tmp/redesign/gates/weekend-publisher.js',
    "m.set(n, typeof n === 'string' ? [n] : m.has(n) ? [n, h] : [n, h, ...(f === 'pending' ? ['pending'] : [])])",
    "m.set(n, typeof n === 'string' ? [n] : [n, h])"],
  ['gapless-gate', 'tmp/redesign/gates/weekend-reader.js',
    'pending: pin.pending.has(n) }])), top: pin.top };',
    'pending: false }])), top: pin.top };'],
  ['gapless-gate', 'tmp/redesign/gates/weekend-reader.js',
    "if (typeof n !== 'number' || n > pin.top) continue;",
    'if (true) continue;'],
  ['gapless-gate', 'tmp/redesign/gates/weekend-reader.js',
    'if (e.pending) { say(`pending: ${n}`); continue; }',
    'if (false) { say(`pending: ${n}`); continue; }'],
  ['gapless-gate', 'tmp/redesign/gates/gapless-gate.js',
    'if (this.owners(m[1], this.files.get(key), n) || !this.owners(m[1], b, n)) return { status: 409 };',
    'if (!this.owners(m[1], b, n)) return { status: 409 };'],
  ['court-gate', 'tmp/redesign/gates/weekend-reader.js',
    'let i = raw.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);',
    'let i = -1;'],
  ['court-gate', 'tmp/redesign/gates/weekend-reader.js',
    'if (i < 0 && raw.chain.length < pin.chain.length && raw.pseq > pin.pseq) i = raw.chain.length;',
    'if (false) i = raw.chain.length;'],
  ['court-gate', 'tmp/redesign/gates/weekend-reader.js',
    'raw.chain.forEach((h, j) => { if (h.court && !(j in courts)) courts[j] = h.court; });',
    'raw.chain.forEach((h, j) => { if (h.court) courts[j] = h.court; });'],
  ['court-gate', 'tmp/redesign/gates/weekend-reader.js',
    'courts[raw.chain.length] ??= raw.recovery;',
    'courts[raw.chain.length] = raw.recovery;'],
  ['court-gate', 'tmp/redesign/gates/weekend-reader.js',
    'if (vouches(from, hop, hop.court) < hop.court.k) return null;',
    'if (vouches(from, hop, p.recovery) < p.recovery.k) return null;'],
  ['court-gate', 'tmp/redesign/gates/weekend-reader.js',
    'const majority = (c) => vouches(c[i - 1].key, c[i], courts[i]) * 2 > (courts[i]?.leaves.length ?? Infinity);',
    'const majority = (c) => vouches(c[i - 1].key, c[i], courts[i]) >= 1;'],
  // The envelope moved to gates/envelope.js when the construction stopped being on trial; these
  // three rows follow it. They are the reason the move is safe: turn each rule off in its new home
  // and the gate that proved it still goes red.
  ['envelope-gate', 'tmp/redesign/gates/envelope.js',
    'const bindAAD = (epk, carrier) => Buffer.concat([epk, Buffer.from(carrier)]);',
    'const bindAAD = (epk, carrier) => epk;'],
  ['envelope-gate', 'tmp/redesign/gates/envelope.js',
    "export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 8, bodyFloor: 512 } };",
    "export const POLICY = { pow2: { slotFloor: 1, bodyFloor: 32 }, floor: { slotFloor: 1, bodyFloor: 32 } };"],
  ['envelope-gate', 'tmp/redesign/gates/envelope.js',
    'const eph = ephemeral ?? xKey(`eph:${b64(crypto.randomBytes(8))}`);',
    "const eph = ephemeral ?? xKey('eph:fixed');"],
  ['twohubs-gate', 'tmp/redesign/gates/twohubs-gate.js',
    'p.target.n === 1 && p.target.hash === momRead.pin.live.get(1)',
    'p.target.n === 1'],
  ['twohubs-gate', 'tmp/redesign/gates/twohubs-gate.js',
    'checkedKey = await readKeyOf(mom, momAfter.pin);',
    'checkedKey = await naiveReadKeyOf(mom);'],
  ['twohubs-gate', 'tmp/redesign/gates/twohubs-gate.js',
    'rumorFetches.M === 3 && rumorFetches.J === 0',
    'rumorFetches.J === 3 && rumorFetches.M === 0'],
  ['twohubs-gate', 'tmp/redesign/gates/twohubs-gate.js',
    "at: momNew }, text: 'welcome home' }",
    "at: mom.at }, text: 'welcome home' }"],
  ['media-gate', 'tmp/redesign/gates/weekend-reader.js',
    "if (typeof n === 'string') { if (sha256(f) !== n) return bad('host', `photo ${n} is not what the head lists`); media.set(n, f); continue; }",
    "if (typeof n === 'string') { media.set(n, f); continue; }"],
  ['media-gate', 'tmp/redesign/gates/weekend-reader.js',
    "if (typeof n !== 'number' || n > pin.top) continue;",
    'if (n > pin.top) continue;'],
  ['media-gate', 'tmp/redesign/gates/media-gate.js',
    'if (m[3] && this.contentCheck && sha(this.files.get(key)) !== m[3] && sha(b) === m[3]) { this.files.set(key, b); return { status: 200 }; }',
    'if (false) { this.files.set(key, b); return { status: 200 }; }'],
];

const runGate = (gate) => spawnSync(process.execPath, [path.join(here, `${gate}.js`)], { cwd: root, encoding: 'utf8' }).status;
const red = new Set([...new Set(M.map(([g]) => g))].filter((g) => runGate(g) !== 0));

let bad = 0;
for (const [gate, file, from, to] of M) {
  if (red.has(gate)) {
    bad++;
    console.log(`  FAIL  ${gate.padEnd(16)} ${file.padEnd(34)} GATE ALREADY RED — a failing gate proves nothing`);
    continue;
  }
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  const n = before.split(from).length - 1;
  let verdict;
  try {
    if (n !== 1) {
      verdict = `FROM-TEXT MATCHES ${n} TIMES`;
    } else {
      fs.writeFileSync(full, before.replace(from, to));
      verdict = runGate(gate) !== 0 ? 'caught' : 'NOT CAUGHT — gate stayed green';
    }
  } finally {
    fs.writeFileSync(full, before);
  }
  if (verdict !== 'caught') bad++;
  console.log(`  ${verdict === 'caught' ? 'ok  ' : 'FAIL'}  ${gate.padEnd(16)} ${file.padEnd(34)} ${verdict}`);
}
console.log();
if (bad) { console.log(`${bad} mutation(s) NOT caught — those gates or proposals need work`); process.exit(1); }
console.log(`all ${M.length} mutations caught by their gates`);
