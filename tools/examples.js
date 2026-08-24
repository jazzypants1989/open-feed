// Runs every example and checks it against its committed output.
//
//   node tools/examples.js            # every example
//   node tools/examples.js the-chain  # one
//
// An example is `examples/<dir>/<dir>.js`: it prints a narration and asserts every claim it makes,
// exiting non-zero on surprise. `<dir>.out.txt` beside it is the stdout it produced last time; the
// diff is the check. An example with no `.out.txt` yet is reported as pending and does not fail the
// run. An empty set fails: a run over nothing proves nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'examples');
const only = process.argv.slice(2);
const names = fs.readdirSync(dir).filter((d) => !d.startsWith('_') && fs.existsSync(path.join(dir, d, `${d}.js`))).filter((d) => !only.length || only.includes(d)).sort();
if (!names.length) { console.log('no examples found — an empty run proves nothing'); process.exit(1); }

let bad = 0, pending = 0;
for (const name of names) {
  const script = path.join(dir, name, `${name}.js`), expected = path.join(dir, name, `${name}.out.txt`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  let verdict = 'ok';
  if (r.status !== 0) verdict = `FAIL exit ${r.status}`;
  else if (!fs.existsSync(expected)) { verdict = 'pending — no .out.txt yet'; pending++; }
  else if (fs.readFileSync(expected, 'utf8') !== r.stdout) verdict = 'FAIL output differs from .out.txt';
  if (verdict.startsWith('FAIL')) { bad++; console.log(`  FAIL  ${name.padEnd(24)} ${secs}s  ${verdict}\n${(r.stderr || r.stdout).trim().split('\n').slice(-12).map((l) => `        ${l}`).join('\n')}`); }
  else console.log(`  ${verdict === 'ok' ? 'ok  ' : 'wait'}  ${name.padEnd(24)} ${secs}s  ${verdict === 'ok' ? '' : verdict}`);
}
console.log();
if (bad) { console.log(`${bad} example(s) failed`); process.exit(1); }
console.log(`${names.length - pending} example(s) match their output${pending ? `; ${pending} pending` : ''}`);
