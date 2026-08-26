// Enforce the README's opening budgets: ≤200 words how, ≤100 words guarantees, ≤10 glossary terms.
// These three sections are the whole protocol in a page; they stay short or they stop being read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

function section(title) {
  const m = text.split(`## ${title}\n`)[1];
  if (!m) { console.error(`README.md is missing section "## ${title}"`); process.exit(1); }
  return m.split('\n## ')[0];
}

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const checks = [
  ['How it works', words(section('How it works')), 200],
  ['What it guarantees', words(section('What it guarantees')), 100],
  ['Glossary', section('Glossary').split('\n').filter((l) => l.startsWith('- **')).length, 10],
];

let over = 0;
for (const [name, n, budget] of checks) {
  const ok = n <= budget;
  if (!ok) over++;
  console.log(`  ${ok ? 'ok  ' : 'OVER'}  ${name.padEnd(20)} ${n} / ${budget}`);
}
process.exit(over ? 1 : 0);
