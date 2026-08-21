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
