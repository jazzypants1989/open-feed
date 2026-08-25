// Generates open-feed-spec.md from the examples, and checks the published spec against it.
//
//   node tools/spec.js           run every example; fail if the spec is not what they print
//   node tools/spec.js --write   run every example; write the spec
//
// Every rule in the spec is a line an example printed with rule() (tools/rule.js) after the
// assertion that proves it. What is hand-held here: the title, §1, and the section headings. A
// section no example prints a rule for is omitted, heading and all. Everything from Appendix B's
// heading down belongs to tools/regen.js and is carried over untouched.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const SPEC = new URL('../open-feed-spec.md', import.meta.url);
const EXAMPLES = new URL('../examples/', import.meta.url);
const MARKER = '## Appendix B: Test Vectors';
const write = process.argv.includes('--write');

// Reading order (examples/README.md), capstones last.
const ORDER = [
  'signed-file', 'no-canonicalization', 'json-hygiene',
  'first-contact', 'the-chain', 'recovery-list', 'contest', 'moving',
  'the-index', 'top-and-rumors', 'media', 'rewrite',
  'posts-and-targets', 'envelope', 'the-reader', 'publish-interface',
  'fetching', 'your-copy', 'views',
  'weekend-reader', 'weekend-publisher',
];

const SECTIONS = [
  ['2', 'Files'], ['2.1', 'The file format'], ['2.2', 'Addresses'], ['2.3', 'No canonicalization'],
  ['2.4', 'JSON hygiene'], ['2.5', 'Extension fields'],
  ['3', 'Identity'], ['3.1', 'First contact'], ['3.2', 'The profile'], ['3.3', 'The chain'],
  ['3.4', 'The recovery list'], ['3.5', 'Rotating and restoring in practice'],
  ['3.6', 'Contests: two profiles claiming one identity'], ['3.7', 'Locations and moving'],
  ['3.8', 'The reading key'],
  ['4', 'The index'], ['4.1', 'What the entries mean'], ['4.2', 'The fold'], ['4.3', '`top`'],
  ['4.4', 'Media and attachments'], ['4.6', 'The index is signed by the current key'], ['4.7', 'Rewriting'],
  ['5', 'Posts'], ['5.1', '`n` — the post\'s own number'], ['5.2', '`at` — content time'],
  ['5.3', '`rel` — what kind of post this is'], ['5.4', '`target` — what this post answers'],
  ['5.5', '`media`'], ['5.6', 'Private messages are posts'],
  ['6', 'Encrypted content'], ['6.1', 'The envelope'], ['6.2', 'Carrier binding'],
  ['6.3', 'Slots, and what a tag is'], ['6.4', 'The audience is inside'], ['6.5', 'An encrypted post\'s target'],
  ['7', 'The reader'], ['7.1', 'Profile, chain, recovery list'], ['7.2', 'The index'],
  ['7.3', 'Three verdicts, and notes'], ['7.4', 'Posts'], ['7.5', 'Targets, and the rumor rule'],
  ['8', 'The publish interface'], ['8.1', 'Compare-and-swap on the two overwritable files'],
  ['8.2', 'Create-once on numbered posts'], ['8.3', 'Write order'], ['8.4', 'Claiming a name'],
  ['8.5', 'Reclaiming a squatted number'], ['8.6', 'The same rule for media'], ['8.7', 'What a hub MUST do'],
  ['8.8', 'Withdrawal, and whether anything is ever deleted'],
  ['9', 'Fetching'], ['10', 'Your copy'], ['11', 'Generated views'], ['12', 'Conformance'],
  ['13', 'Security considerations'], ['13.1', 'The adversary this is built against'],
  ['13.2', 'Where a clock appears — the whole list'], ['13.3', 'What is not defended, stated plainly'],
  ['A', 'Media types'],
];

const PREAMBLE = `# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.**

## 1. Conventions and terminology

Open Feed is a protocol for publishing from a place you control with an identity that is a key.
Everything on the wire is a signed file at a stable path, verified by the reader without trusting the
host, built from primitives found in most languages' standard libraries: Ed25519, X25519, SHA-256,
ChaCha20-Poly1305, HKDF, JSON, HTTP.

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and
OPTIONAL are to be interpreted as described in RFC 2119 and RFC 8174.

**base64url** means base64url encoding without padding (RFC 4648 §5). Every key, hash, and signature
in this document is a base64url string: an Ed25519 or X25519 public key is 43 characters, a SHA-256
hash is 43 characters, an Ed25519 signature is 86 characters.

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

**Roles.** A **publisher** writes files. A **reader** verifies them. A **hub** stores and serves
them. None is more of the protocol than another (§12).

Every rule below is printed by the example in \`examples/\` that proves it, after the assertion that
proves it; this document is assembled from that output by \`tools/spec.js\`.
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
const level = (n) => (n === 'A' ? '## Appendix A: ' : n.includes('.') ? `### ${n}. ` : `## ${n}. `);
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
const i = current.indexOf(MARKER);
const appendix = i < 0 ? '' : current.slice(i);
const next = appendix ? `${out}\n${appendix}` : out;

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
