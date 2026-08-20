// Every `file:line` citation in the outside-perspective write-ups must resolve to a real line, and
// every quotation written as “…” (`file:line`) must actually occur within ±3 lines of that line.
// This exists because the campaign's documented failure mode is a claim written from memory and
// never re-derived. The first draft of SYNTHESIS.md did that twice; the second draft's errors all
// passed a line-exists check, which is why this one reads the text.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const DOCS = ['SYNTHESIS.md', 'PROMPT-pass1-DEFECT.md', 'README.md'];
const SEARCH = ['', 'tmp/redesign/', 'tmp/redesign/outside/', 'tmp/prototypes/', 'tmp/redesign/gates/'];
const WINDOW = 3;
const MIN_FRAGMENT = 12;

const CITE = /`((?:[\w./-]+\/)?[\w.-]+\.(?:md|js)):(\d+)`/g;
const QUOTE = /“([^”]+)”\s*\(`((?:[\w./-]+\/)?[\w.-]+\.(?:md|js)):(\d+)`\)/g;

// Emphasis, code spans, and curly punctuation are presentation; the words are the claim.
const norm = (s) => s
  .replace(/[*`]/g, '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ').trim();

const fileCache = new Map();
function lines(file) {
  if (!fileCache.has(file)) {
    const target = SEARCH.map((p) => join(ROOT, p, file)).find(existsSync);
    fileCache.set(file, target ? readFileSync(target, 'utf8').split('\n') : null);
  }
  return fileCache.get(file);
}

let checked = 0, quotes = 0, bad = 0;
const fail = (msg) => { console.error(msg); bad++; };

for (const doc of DOCS) {
  const path = join(HERE, doc);
  if (!existsSync(path)) continue;
  const text = readFileSync(path, 'utf8');

  const seen = new Set();
  for (const [full, file, lineStr] of text.matchAll(CITE)) {
    if (seen.has(full)) continue;
    seen.add(full);
    checked++;
    const ls = lines(file);
    if (!ls) { fail(`${doc}: no such file for ${full}`); continue; }
    const n = Number(lineStr);
    if (n > ls.length || !ls[n - 1].trim()) fail(`${doc}: ${full} is past the end or blank`);
  }

  for (const [, quoted, file, lineStr] of text.matchAll(QUOTE)) {
    quotes++;
    const ls = lines(file);
    if (!ls) continue; // already reported above
    const n = Number(lineStr);
    const window = norm(ls.slice(Math.max(0, n - 1 - WINDOW), n + WINDOW).join(' '));
    for (const frag of norm(quoted).split(/\s*(?:…|\[…\]|\.\.\.)\s*/)) {
      if (frag.length < MIN_FRAGMENT) continue;
      if (!window.includes(frag)) fail(`${doc}: quote not found near ${file}:${n}: "${frag.slice(0, 70)}…"`);
    }
  }
}
console.log(`${checked} citations checked, ${quotes} quotations checked, ${bad} broken`);
process.exit(bad ? 1 : 0);
