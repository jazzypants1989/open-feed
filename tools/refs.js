// The prose gate. `npm run spec` checks the generated spec against the examples and `npm run tldr`
// checks the README's three budgets; everything else in this repository is ungated prose beside a
// generated document, which is exactly where this project's renames and renumberings have gone to
// die. Each check below is a defect class that has already cost a commit:
//
//   §refs      ~100 stale cross-references after §3/§4/§7/§10 were restructured (996697f)
//   appendix   19 pointers to appendices deleted when the vectors moved out (fbebc2e)
//   paths      16 dead example directories, 14 unrunnable `Run:` lines (996667f), and a shim
//              src/cli.js documented for months without it existing
//   version    package.json said 0.0.0 while everything else said 0.1.0
//   size       the spec's value is how little of it there is
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = 'open-feed-spec.md';
const SKIP = new Set(['.git', 'node_modules', 'archive', 'tmp', 'deploy']);
const SPEC_WORD_CEILING = 4500;

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (SKIP.has(e.name)) return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : /\.(md|js)$/.test(e.name) ? [full] : [];
});

const files = walk(root).map((f) => ({ rel: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }));
const spec = fs.readFileSync(path.join(root, SPEC), 'utf8');
const headings = new Set([...spec.matchAll(/^#{2,4} (\d+(?:\.\d+)?)\./gm)].map((m) => m[1]));

// docs/GOALS.md and docs/DISTRIBUTION-MODEL.md are the owner's documents (CLAUDE.md). Drift in them
// is reported and never fails the build, because fixing it is not an agent's call to make unasked.
const OWNED = /^docs\/(GOALS|DISTRIBUTION-MODEL)\.md$/;
const problems = [], notices = [];
const flag = (rel, line, message) => (OWNED.test(rel) ? notices : problems).push(`${rel}:${line}  ${message}`);
const lines = ({ rel, text }) => text.split('\n').map((l, i) => [rel, i + 1, l]);

for (const f of files) {
  for (const [rel, n, line] of lines(f)) {
    for (const m of line.matchAll(/§(\d+(?:\.\d+)?)/g)) {
      if (!headings.has(m[1])) flag(rel, n, `§${m[1]} is not a section of ${SPEC}`);
    }
    for (const m of line.matchAll(/\bAppendix [A-Z]\b/g)) {
      flag(rel, n, `"${m[0]}" — the spec has no appendices; the vectors are test-vectors.md`);
    }
    // A path named in backticks, in prose or in a source comment. `bin/openfeed.js` was documented
    // in src/cli.js's header without existing, because only Run: lines and markdown links were checked.
    for (const m of line.matchAll(/`([.\w][\w./-]*\/[\w.-]+\.(?:js|md))`/g)) {
      const target = m[1].replace(/^\.\//, '');
      const from = path.dirname(path.join(root, rel));
      if (!fs.existsSync(path.resolve(from, target)) && !fs.existsSync(path.join(root, target))) {
        flag(rel, n, `names ${target}, which does not exist`);
      }
    }
    for (const m of line.matchAll(/(?:^\s*(?:\/\/\s*)?Run:\s*|\]\()([.\w][\w./-]*\.(?:js|md))\)?/g)) {
      const target = m[1].replace(/^\.\//, '');
      const from = path.dirname(path.join(root, rel));
      if (!fs.existsSync(path.resolve(from, target)) && !fs.existsSync(path.join(root, target))) {
        flag(rel, n, `points at ${target}, which does not exist`);
      }
    }
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const declared = spec.match(/\*\*Version (\d+\.\d+\.\d+)/)?.[1];
if (pkg.version !== declared) problems.push(`package.json:  version ${pkg.version} but ${SPEC} declares ${declared}`);

const words = spec.split(/\s+/).filter(Boolean).length;
if (words > SPEC_WORD_CEILING) problems.push(`${SPEC}:  ${words} words, over the ${SPEC_WORD_CEILING} ceiling`);

for (const p of problems) console.error(`  ${p}`);
for (const n of notices) console.log(`  note  ${n}`);
if (notices.length) console.log(`  ${notices.length} in the owner's documents — reported, not failed.`);
console.log(problems.length
  ? `\n${problems.length} prose defect${problems.length === 1 ? '' : 's'}. Nothing else in this repository catches these.`
  : `prose is current: every §ref resolves, every path exists, ${words}/${SPEC_WORD_CEILING} words.`);
process.exit(problems.length ? 1 : 0);
