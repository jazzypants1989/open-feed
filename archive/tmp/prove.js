// Prove each spec rule from the code, by breaking the code and requiring the test to notice.
//
//   node tmp/prove.js          run every proof, report, exit 1 if any rule is unproven
//   node tmp/prove.js --list   what is proven and what is not, no mutation, no exit code
//
// WHY THIS AND NOT THE GATE. `rules.js --gate` asks whether a section is *cited* by `src/` and
// `test/`. That is a wire being connected. It passes just as happily when the comment sits beside
// code that violates the rule it names — which is exactly the state §3.3.1 was in for the life of
// the reader, except there the comment was missing too. This asks whether current flows: neutralize
// the guard, and if every test still passes, the specification is claiming something the
// implementation does not do.
//
// It is the mechanical form of a discipline this repo already performs by hand and records in prose
// — "each gate revert-checked", "a test that fails without it". Those are claims. `git log` is full
// of them and no later run can falsify one. This is the same act, re-run on demand.
//
// SAFETY. Mutations are applied to the working tree and reverted with `git checkout --` after each
// one. The tree must be clean to start, and the run refuses otherwise, because a dirty tree means
// the revert would destroy work. If this is ever interrupted mid-proof, `git status` shows exactly
// one modified file and `git checkout -- <file>` restores it.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { proofs } from './proofs.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const listOnly = process.argv.includes('--list');

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

if (!listOnly) {
  // Only *tracked* modifications matter: the revert is `git checkout -- <file>`, which cannot
  // touch an untracked file. Scoped to the files this run will actually edit, so an unrelated
  // work-in-progress elsewhere is not a reason to refuse.
  const targets = [...new Set(proofs.map((p) => p.file))];
  const dirty = git('status', '--porcelain', '--', ...targets)
    .split('\n').filter((l) => l.trim() && !l.startsWith('??'));
  if (dirty.length) {
    console.error('refusing to run: a file this would mutate has uncommitted changes, and every');
    console.error('proof reverts with `git checkout --`, which would destroy them:');
    for (const l of dirty) console.error(`  ${l}`);
    process.exit(2);
  }
}

/** Apply one edit, requiring the target text to appear exactly once. */
function edit(file, { from, to }) {
  const full = path.join(root, file);
  const before = fs.readFileSync(full, 'utf8');
  const occurrences = before.split(from).length - 1;
  if (occurrences !== 1) {
    throw new Error(`\`from\` matched ${occurrences} times in ${file}; a proof must name one site`);
  }
  fs.writeFileSync(full, before.replace(from, to));
}

/**
 * Run exactly the named test. Returns 'pass' | 'fail'.
 *
 * The obvious version of this function is wrong, and the first run of this file proved it by
 * reporting four rules "proven" that were nothing of the kind. `--test-name-pattern` matching
 * NOTHING still exits non-zero — node fails the file itself — so "the process failed" reads
 * identically whether the test caught the mutation or never ran. Hence `namedTestExists` below,
 * and hence the baseline: a proof asserts a transition from pass to fail, and a test that cannot
 * pass on clean code cannot demonstrate one.
 */
function runNamed(name, file) {
  const r = spawnSync(
    process.execPath,
    ['--test', '--test-name-pattern', name, file],
    { cwd: root, encoding: 'utf8' },
  );
  const out = `${r.stdout}${r.stderr}`;
  const failed = /^\s*(?:ℹ\s*)?fail (\d+)/m.exec(out);
  if (failed) return Number(failed[1]) > 0 ? 'fail' : 'pass';
  return r.status === 0 ? 'pass' : 'fail';
}

/**
 * Which test file declares this exact name, if any.
 *
 * Two jobs. A proof naming a test that was renamed away proves nothing, and would otherwise read
 * as a pass — that is one of the two bugs the first run of this file had. And running only the
 * one file that declares the test is what keeps a proof cheap: a whole-suite run per proof would
 * make this too slow to run often, and a check nobody runs is the thing we are trying to stop
 * building.
 */
function fileDeclaring(name) {
  const dir = path.join(root, 'test');
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    if (typeof f !== 'string' || !f.endsWith('.test.js')) continue;
    const rel = path.join('test', f);
    if (fs.readFileSync(path.join(root, rel), 'utf8').includes(`test('${name}'`)
      || fs.readFileSync(path.join(root, rel), 'utf8').includes(`test("${name}"`)) return rel;
  }
  return null;
}

if (listOnly) {
  console.log(`${proofs.length} proofs:\n`);
  for (const p of proofs) console.log(`  §${p.section.padEnd(8)} ${p.what}\n${' '.repeat(13)}${p.file} → "${p.test}"`);
  process.exit(0);
}

console.log(`Proving ${proofs.length} rules by breaking the code that enforces them.\n`);

const results = [];
for (const p of proofs) {
  let verdict;
  try {
    const testFile = fileDeclaring(p.test);
    if (!testFile) {
      verdict = 'NO SUCH TEST';
    } else if (runNamed(p.test, testFile) !== 'pass') {
      verdict = 'TEST ALREADY FAILING';
    } else {
      if (p.prelude) edit(p.file, p.prelude);
      edit(p.file, p);
      verdict = runNamed(p.test, testFile) === 'fail' ? 'proven' : 'UNPROVEN';
    }
  } catch (e) {
    verdict = `BROKEN PROOF: ${e.message}`;
  } finally {
    git('checkout', '--', p.file);
  }
  results.push({ ...p, verdict });
  const mark = verdict === 'proven' ? '  ok  ' : '  ??  ';
  console.log(`${mark}§${p.section.padEnd(8)} ${verdict === 'proven' ? '' : `${verdict} — `}${p.what}`);
}

const unproven = results.filter((r) => r.verdict !== 'proven');
console.log();
if (unproven.length) {
  console.log(`${unproven.length} of ${proofs.length} rules are NOT proven by this suite:`);
  for (const r of unproven) {
    console.log(`  §${r.section} — ${r.verdict}`);
    console.log(`    broke ${r.file} and "${r.test}" did not notice.`);
  }
  console.log();
  console.log('Either the rule is unenforced, or the test does not test it. Both are findings.');
  process.exit(1);
}
console.log(`all ${proofs.length} rules proven — each one, broken, is caught by a named test`);
