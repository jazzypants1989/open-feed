import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const root = path.resolve('tmp/review/sandbox');
const src = fs.readFileSync('tools/revert.js','utf8');
const M = eval('[' + src.match(/const M = \[([\s\S]*?)\n\];/)[1] + ']');
const [lo, hi] = [66, 129];
for (let i = lo - 1; i < hi; i++) {
  const [gate, file, from, to] = M[i];
  const full = path.join(root, file), before = fs.readFileSync(full, 'utf8');
  const n = before.split(from).length - 1;
  let out = '';
  if (n !== 1) out = `FROM MATCHES ${n}`;
  else { fs.writeFileSync(full, before.replace(from, to));
    const r = spawnSync(process.execPath, [path.join(root, 'examples', gate, `${gate}.js`)], { cwd: root, encoding: 'utf8' });
    fs.writeFileSync(full, before);
    const err = (r.stderr || '').split('\n');
    const at = err.find((l) => /examples\/[^/]+\/[^:]+\.js:\d+/.test(l)) || '';
    const msg = err.find((l) => /AssertionError|Error|TypeError|RangeError/.test(l)) || '';
    out = r.status === 0 ? 'NOT CAUGHT' : `status ${r.status} | ${msg.slice(0,140)} | ${(at.match(/examples\/[^)]+/)||[''])[0]}`;
  }
  console.log(`${i + 1}\t${gate}\t${file}\t${out}`);
}
