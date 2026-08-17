// A normative inventory of the specification. Reports; changes nothing.
//
// The spec is dense and the register's Stage 4 asks for its rules to be "extractable". Every
// mechanism proposed for that — an index appendix, a per-rule table — makes the document
// *bigger*, which is the wrong direction: CLAUDE.md says the real target is the shortest spec
// that still covers its bases, and "the lever that actually moves it is design, not
// compression. Removing an equivocation between two sections is worth more than removing fifty
// lines."
//
// So this is the instrument for that lever rather than another surface to maintain. It answers
// four questions about the text as it stands:
//
//   1  WEIGHT      which sections carry the normative load, and how it is distributed
//   2  ECHOES      which rules are stated in more than one section — the equivocation
//                  candidates, since two statements of one rule can drift apart and one of
//                  them is then wrong
//   3  UNBACKED    which normative sections nothing in `src/` and nothing in `test/` cites —
//                  a rule with no implementation and no test is either unimplemented or
//                  unimplementable, and both are findings
//   4  ORPHANS     which sections nothing else in the document cross-references, which is
//                  what a candidate for a Stage 3 cut looks like from the outside
//
// Everything here is a heuristic over prose. It does not decide anything; it produces a
// shortlist a human argues with. Deliberately no assertion gate and no exit code: this is a
// measuring instrument, not a claim, so there is nothing here for a later run to falsify.
//
//   node tmp/rules.js            report to stdout
//   node tmp/rules.js --json     the same data, for another tool to read

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const spec = fs.readFileSync(path.join(root, 'open-feed-spec.md'), 'utf8');

const KEYWORDS = ['MUST NOT', 'MUST', 'SHOULD NOT', 'SHOULD', 'MAY', 'REQUIRED', 'RECOMMENDED', 'OPTIONAL'];

// ---- sectioning ---------------------------------------------------------------------------
// Appendix B is excluded throughout: it is a vector corpus, its prose is instructions for
// reproducing bytes, and counting "MUST" there would put the test fixtures at the top of the
// weight table.

function sections(text) {
  const out = [];
  let current = null;
  let inFence = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) { inFence = !inFence; current?.lines.push(line); continue; }
    const heading = !inFence && /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading) {
      const title = heading[2].trim();
      const number = /^(?:§\s*)?([\d.]+|Appendix [A-Z])\b/.exec(title.replace(/^(\d+(?:\.\d+)*)\./, '$1'));
      current = {
        title,
        depth: heading[1].length,
        id: sectionId(title),
        lines: [],
      };
      out.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return out.filter((s) => !s.id.startsWith('B'));
}

/** `### 9.1.2. Freshness, ...` -> `9.1.2`; `## Appendix C: ...` -> `C`. */
function sectionId(title) {
  const appendix = /^Appendix ([A-Z])\b/.exec(title);
  if (appendix) return appendix[1];
  const numbered = /^(\d+(?:\.\d+)*)\./.exec(title);
  return numbered ? numbered[1] : title;
}

/** Body prose with fenced blocks and tables removed — a table row is not a sentence. */
function prose(section) {
  const out = [];
  let inFence = false;
  for (const line of section.lines) {
    if (line.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^\s*\|/.test(line)) { out.push(line.replace(/\|/g, ' ')); continue; }
    out.push(line);
  }
  return out.join('\n');
}

// ---- rule sentences -----------------------------------------------------------------------

/**
 * Split on sentence enders, keeping `§9.1.2`, `RFC 3339`, `e.g.` and decimals intact. Prose
 * splitting is approximate by nature; the consumers below are counts and overlaps, both of
 * which tolerate a sentence landing one clause short.
 */
function toSentences(text) {
  const flat = text
    .replace(/`[^`]*`/g, (m) => m.replace(/[.!?]/g, ''))   // protect code spans
    .replace(/§\s*(\d)/g, '§$1')
    .replace(/(\d)\.(\d)/g, '$1$2')
    .replace(/\b([A-Z])\.(\s)/g, '$1$2')
    .replace(/\n{2,}/g, '')
    .replace(/\n/g, ' ');
  return flat
    .split(/(?<=[.!?:])\s+|/)
    .map((s) => s.replace(//g, '.').replace(//g, '.').trim())
    .filter(Boolean);
}

const keywordsIn = (sentence) => {
  const found = [];
  let rest = sentence;
  for (const k of KEYWORDS) {
    const re = new RegExp(`(^|[^A-Za-z])${k}([^A-Za-z]|$)`, 'g');
    let n = 0;
    rest = rest.replace(re, (m, a, b) => { n++; return `${a}${b}`; });
    for (let i = 0; i < n; i++) found.push(k);
  }
  return found;
};

const inventory = [];
for (const section of sections(spec)) {
  for (const sentence of toSentences(prose(section))) {
    const found = keywordsIn(sentence);
    if (found.length) inventory.push({ section: section.id, title: section.title, sentence, keywords: found });
  }
}

// ---- 1. weight ----------------------------------------------------------------------------

const bySection = new Map();
for (const rule of inventory) {
  const held = bySection.get(rule.section) ?? { section: rule.section, title: rule.title, sentences: 0, keywords: 0, binding: 0 };
  held.sentences += 1;
  held.keywords += rule.keywords.length;
  held.binding += rule.keywords.filter((k) => k === 'MUST' || k === 'MUST NOT').length;
  bySection.set(rule.section, held);
}

// ---- 2. echoes ----------------------------------------------------------------------------
// Two sentences in DIFFERENT sections whose content words overlap heavily are one rule stated
// twice. That is not automatically a defect — a cross-reference restating what it points at is
// often the kind thing to do — but it is where drift happens, and every pair below is a place
// two sections can come to disagree without either one changing.

const STOP = new Set(('a an the and or of to in on at is are be by it its this that for from with as not '
  + 'if then than so no nor but which who whom whose what when where why how any all each every one two '
  + 'their they them there here has have had do does did can could would should may might must will shall '
  + 'never always other another same such only also both either neither more most less least own').split(' '));

function contentWords(sentence) {
  return new Set(
    sentence
      .toLowerCase()
      .replace(/`[^`]*`/g, ' ')
      .replace(/§\s*[\d.]+/g, ' ')
      .replace(/[^a-z\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

const jaccard = (a, b) => {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
};

const ECHO_THRESHOLD = 0.42;
const MIN_WORDS = 6;
const enriched = inventory.map((r) => ({ ...r, words: contentWords(r.sentence) }));
const echoes = [];
for (let i = 0; i < enriched.length; i++) {
  for (let j = i + 1; j < enriched.length; j++) {
    const a = enriched[i];
    const b = enriched[j];
    if (a.section === b.section) continue;
    if (a.words.size < MIN_WORDS || b.words.size < MIN_WORDS) continue;
    const score = jaccard(a.words, b.words);
    if (score >= ECHO_THRESHOLD) echoes.push({ score, a, b });
  }
}
echoes.sort((x, y) => y.score - x.score);

// ---- 3. unbacked --------------------------------------------------------------------------
// A section carrying MUSTs that nothing in `src/` and nothing in `test/` names. `src/` is a
// complete implementation of the core, so a normative section it never cites is either
// implemented without saying so, or not implemented, or not implementable — and this cannot
// tell which. It can only say where to look.

function citations(dir) {
  const cited = new Set();
  for (const name of fs.readdirSync(path.join(root, dir))) {
    const full = path.join(root, dir, name);
    if (fs.statSync(full).isDirectory()) {
      for (const inner of fs.readdirSync(full)) {
        if (inner.endsWith('.js')) collect(fs.readFileSync(path.join(full, inner), 'utf8'), cited);
      }
      continue;
    }
    if (name.endsWith('.js')) collect(fs.readFileSync(full, 'utf8'), cited);
  }
  return cited;
}

function collect(text, into) {
  for (const m of text.matchAll(/§\s*(\d+(?:\.\d+)*)/g)) {
    into.add(m[1]);
    // A citation of §9.1.2 backs §9.1 and §9 as well: the rule it names lives inside them.
    const parts = m[1].split('.');
    for (let i = 1; i < parts.length; i++) into.add(parts.slice(0, i).join('.'));
  }
  for (const m of text.matchAll(/Appendix ([A-Z])/g)) into.add(m[1]);
}

const inSrc = citations('src');
const inTest = citations('test');
const unbacked = [...bySection.values()]
  .filter((s) => s.binding > 0 && !inSrc.has(s.section) && !inTest.has(s.section))
  .sort((a, b) => b.binding - a.binding);

// ---- 4. orphans ---------------------------------------------------------------------------
// Sections nothing else in the specification points at. A section with normative weight and no
// inbound reference is doing its work alone, which is what a removable mechanism looks like
// from outside: cut it, and by construction no other section's argument loses a premise.

const inbound = new Map();
const note = (target, from) => {
  if (target === from) return;
  const held = inbound.get(target) ?? new Set();
  held.add(from);
  inbound.set(target, held);
};
for (const section of sections(spec)) {
  const body = prose(section);
  for (const m of body.matchAll(/§\s*(\d+(?:\.\d+)*)/g)) {
    // A reference to §13.4 is inbound for §13 as well — it names a rule that lives inside it,
    // so treating the parent as unreferenced would make every section with subsections read as
    // an orphan. That bug put §13 on this list, which is where it was caught.
    const parts = m[1].split('.');
    for (let i = parts.length; i > 0; i--) note(parts.slice(0, i).join('.'), section.id);
  }
  // Appendices are cited by name, never with a §.
  for (const m of body.matchAll(/Appendix ([A-Z])/g)) note(m[1], section.id);
}
const orphans = [...bySection.values()]
  .filter((s) => s.binding > 0 && (inbound.get(s.section)?.size ?? 0) === 0)
  .sort((a, b) => b.binding - a.binding);

// ---- report -------------------------------------------------------------------------------

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({
    total: {
      sentences: inventory.length,
      keywords: inventory.reduce((n, r) => n + r.keywords.length, 0),
    },
    weight: [...bySection.values()].sort((a, b) => b.binding - a.binding),
    echoes: echoes.map(({ score, a, b }) => ({
      score: Number(score.toFixed(3)),
      a: { section: a.section, sentence: a.sentence },
      b: { section: b.section, sentence: b.sentence },
    })),
    unbacked,
    orphans: orphans.map((s) => ({ ...s, inbound: 0 })),
  }, null, 2));
  process.exit(0);
}

const say = (s = '') => console.log(s);
const rule = (t) => { say(); say('='.repeat(78)); say(t); say('='.repeat(78)); };
const clip = (s, n = 96) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

const totalKeywords = inventory.reduce((n, r) => n + r.keywords.length, 0);
say(`Normative inventory of open-feed-spec.md (Appendix B excluded — it is a vector corpus)`);
say(`${inventory.length} rule-bearing sentences, ${totalKeywords} RFC 2119 keywords, across ${bySection.size} sections`);

rule('1. WEIGHT — where the normative load sits');
const weight = [...bySection.values()].sort((a, b) => b.binding - a.binding || b.keywords - a.keywords);
say(`  §        MUST  all  sentences  section`);
for (const s of weight.slice(0, 18)) {
  say(`  ${s.section.padEnd(8)} ${String(s.binding).padStart(4)} ${String(s.keywords).padStart(4)} ${String(s.sentences).padStart(10)}  ${clip(s.title, 52)}`);
}
const tail = weight.slice(18);
say(`  ... and ${tail.length} further sections carrying ${tail.reduce((n, s) => n + s.binding, 0)} MUSTs between them`);

rule(`2. ECHOES — one rule stated in two sections (overlap >= ${ECHO_THRESHOLD})`);
say(`  Not automatically a defect. It is where two sections can come to disagree without`);
say(`  either one being edited, and the register's own corrections list is made of exactly`);
say(`  that. ${echoes.length} pair${echoes.length === 1 ? '' : 's'}:`);
say();
for (const { score, a, b } of echoes.slice(0, 25)) {
  say(`  ${score.toFixed(2)}  §${a.section} <-> §${b.section}`);
  say(`        §${a.section}: ${clip(a.sentence, 104)}`);
  say(`        §${b.section}: ${clip(b.sentence, 104)}`);
  say();
}
if (echoes.length > 25) say(`  ... and ${echoes.length - 25} more (use --json)`);

rule('3. UNBACKED — binding sections nothing in src/ or test/ cites');
if (!unbacked.length) {
  say('  none — every section carrying a MUST is named somewhere in the implementation or its tests');
} else {
  for (const s of unbacked) say(`  §${s.section.padEnd(7)} ${String(s.binding).padStart(3)} MUST  ${clip(s.title, 56)}`);
  say();
  say('  This does not say the rule is unimplemented. It says the implementation never claims');
  say('  to be implementing it, so nothing connects the two and a change to either is silent');
  say('  at the other.');
}

rule('4. ORPHANS — binding sections no other section points at');
if (!orphans.length) {
  say('  none');
} else {
  for (const s of orphans) say(`  §${s.section.padEnd(7)} ${String(s.binding).padStart(3)} MUST  ${clip(s.title, 56)}`);
  say();
  say('  A mechanism nothing else depends on is what a removable one looks like from outside:');
  say('  cut it and no other section loses a premise. That is a shortlist for the argument,');
  say('  never the argument — §9.1.1 is OPTIONAL, self-contained, and load-bearing anyway,');
  say('  because §13.4\'s budget is what makes a long walk fail without it.');
}

say();
