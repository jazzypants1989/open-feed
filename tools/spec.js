// Generates open-feed-spec.md from the examples, and checks the published spec against it.
//
//   node tools/spec.js           run every example; fail if the spec is not what they print
//   node tools/spec.js --write   run every example; write the spec
//
// Every rule in the spec is a line an example printed with rule() (tools/rule.js) after the
// assertion that proves it. What is hand-held here: the title, §1, and the section headings. A
// section no example prints a rule for is omitted, heading and all.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const SPEC = new URL('../open-feed-spec.md', import.meta.url);
const EXAMPLES = new URL('../examples/', import.meta.url);
const write = process.argv.includes('--write');

// Reading order (examples/README.md), capstones last.
const ORDER = [
  'files', 'identity', 'contests',
  'the-index', 'posts', 'envelope', 'reading', 'publish-interface',
  'fetching', 'your-copy', 'views',
  'weekend-reader', 'weekend-publisher',
];

const SECTIONS = [
  ['2', 'Files'], ['2.1', 'The format'], ['2.2', 'The address'], ['2.3', 'No canonicalization'],
  ['2.4', 'JSON hygiene'], ['2.5', 'Unknown members'],
  ['3', 'Identity'], ['3.1', 'The profile'], ['3.2', 'The chain'], ['3.3', 'The recovery list'],
  ['3.4', 'Contests'], ['3.5', 'Locations'], ['3.6', 'The reading key'], ['3.7', 'First contact'],
  ['4', 'The index'], ['4.1', 'Entries and the fold'], ['4.2', '`top`'], ['4.3', 'Media'],
  ['4.4', 'Who signs the index'], ['4.5', 'Rewriting'],
  ['5', 'Posts'], ['5.1', '`n`'], ['5.2', '`at`'], ['5.3', '`rel`'], ['5.4', '`target`'], ['5.5', '`media`'],
  ['5.6', 'Private messages'],
  ['6', 'Encrypted content'], ['6.1', 'The envelope'], ['6.2', 'Carrier binding'], ['6.3', 'Slots and tags'],
  ['6.4', 'The audience'], ['6.5', 'An encrypted post\'s target'],
  ['7', 'Reading'], ['7.1', 'The steps'], ['7.2', 'Verdicts'], ['7.3', 'The pin'], ['7.4', 'Targets and the rumor rule'],
  ['8', 'Publishing'], ['8.1', 'Compare-and-swap'], ['8.2', 'Create-once'], ['8.3', 'Write order'],
  ['8.4', 'Claiming a name'], ['8.5', 'Reclaiming a number'], ['8.6', 'Media'], ['8.7', 'What a hub must do'],
  ['8.8', 'Withdrawal and deletion'], ['8.9', 'Your copy'],
  ['9', 'Fetching'], ['10', 'Views'],
];

const PREAMBLE = `# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.**

## Summary

Open Feed is a protocol for publishing from your own domain with an identity you control. Your
identity is a cryptographic key — not a URL, not an account — so it travels with you if you move.
Everything you publish is a signed file at a stable URL, and readers can verify it without trusting
your host. The entire protocol is built from primitives found in most languages' standard libraries.

Your host is just storage — a static file server is a fully conforming host. People on different
hosts reply, react, and share encrypted content with each other as easily as people on the same one.
The protocol is designed for the case where your host operator can look at everything, refuse to
cooperate, and may not be on your side — and content for chosen people is encrypted to their keys.

## 1. Terms

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in
RFC 2119 and RFC 8174.

**base64url** is base64url without padding (RFC 4648 §5). An Ed25519 or X25519 public key is 43
characters, a SHA-256 hash is 43, an Ed25519 signature is 86.

| term | meaning |
|---|---|
| **profile** | the signed file naming your keys, locations, and recovery list |
| **index** | the signed list of what is currently published — which posts and media exist, and the highest number used |
| **post** | one immutable signed file; replies, reactions, and private messages are all posts |
| **anchor key** | your first signing key — it *is* your identity. A link or scanned code carries it, and readers follow the chain from it |
| **chain** | the links from the anchor key to the key in use now, each signed by the previous key or vouched by the recovery list |
| **recovery list** | the people or keys you named in advance to restore you, committed privately |
| **pin** | what a reader verified and remembers about an identity — the profile, the chain, the recovery lists at each chain length, and the index |
| **withdraw** | remove a post from the live set by appending a line to the index |
| **hub** | anything that stores and serves the files. It holds no key of yours and makes no decision about who you are |

A **publisher** writes files, a **reader** verifies them, a **hub** stores and serves them. Known-good
files for every construction below are in \`test-vectors.md\`.
`;

// Run the examples, collect the rules.
const rules = new Map(SECTIONS.map(([n]) => [n, []]));
for (const slug of ORDER) {
  const file = new URL(`${slug}/${slug}.js`, EXAMPLES);
  const r = spawnSync(process.execPath, [file.pathname], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`${slug} exited ${r.status}; nothing written.\n${r.stderr.trim().split('\n').slice(-12).join('\n')}`);
    process.exit(1);
  }
  let current = null;
  for (const line of r.stdout.split('\n')) {
    const start = line.match(/^¶ §(\S+) (.*)$/), more = line.match(/^¶ \+ (.*)$/);
    if (start) {
      const [, section, text] = start;
      if (!rules.has(section)) { console.error(`${slug} prints a rule for §${section}, which is not a section.`); process.exit(1); }
      current = { section, text };
      rules.get(section).push(current);
    } else if (more) {
      if (!current) { console.error(`${slug}: a continuation line with nothing to continue.`); process.exit(1); }
      current.text += `\n${more[1]}`;
    } else current = null;
  }
}

// Assemble.
const level = (n) => (n.includes('.') ? `### ${n}. ` : `## ${n}. `);
const has = (n) => rules.get(n).length > 0 || [...rules.keys()].some((k) => k.startsWith(`${n}.`) && rules.get(k).length > 0);
let out = PREAMBLE;
for (const [n, title] of SECTIONS) {
  if (!has(n)) continue;
  out += `\n${level(n)}${title}\n`;
  const seen = new Set();
  for (const { text } of rules.get(n)) {
    if (seen.has(text)) continue;
    seen.add(text);
    out += `\n${text}\n`;
  }
}

const current = fs.existsSync(SPEC) ? fs.readFileSync(SPEC, 'utf8') : '';
const next = out;

if (write) {
  fs.writeFileSync(SPEC, next);
  console.log(`open-feed-spec.md written: ${[...rules.values()].flat().length} rules from ${ORDER.length} examples.`);
} else if (current !== next) {
  const a = current.split('\n'), b = next.split('\n');
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  console.error(`DRIFT: open-feed-spec.md is not what the examples print. First difference at line ${k + 1}:`);
  console.error(`  spec:     ${a[k] ?? '<end>'}\n  examples: ${b[k] ?? '<end>'}\nRun with --write.`);
  process.exit(1);
} else {
  console.log(`open-feed-spec.md is what the examples print: ${[...rules.values()].flat().length} rules.`);
}
