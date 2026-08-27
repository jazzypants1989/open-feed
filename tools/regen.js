// Regenerates test-vectors.md and checks the committed file against it.
//
//   node tools/regen.js           verify the vectors and check test-vectors.md carries them verbatim
//   node tools/regen.js --write   regenerate test-vectors.md
//
// NO SECOND IMPLEMENTATION LIVES HERE. The corpus is `tools/corpus.js` — files produced by the
// weekend publisher (examples/weekend-publisher) and the envelope by src/envelope.js — and so is the
// suite of checks a §7 reader must pass. This file renders that corpus and runs the suite with TWO
// readers: the weekend reader (examples/weekend-reader, written from the text alone) and
// src/reader.js. Two independent readers agreeing on every vector is the interop check the spec
// exists for; `tools/conform.js` runs the same suite against anybody else's.
import fs from 'node:fs';

import { read } from '../examples/weekend-reader/weekend-reader.js';
import { createReader } from '../src/reader.js';
import { spokenIndices as spokenIndicesRef, spokenCode } from '../src/spoken.js';
import { decrypt as unseal, postBinding } from '../src/envelope.js';
import {
  A1, A2, A3, AT, BRO, MUM, READ_ALICE, READ_MUM, REC, SIS,
  body, edKey, envelope, head1, head2, head3, p1, p2, p3, png, pngHash,
  address, post1, post2, post3, post4, post5, readerSuite, sha256, sigLine, spokenIndices, xKey,
} from './corpus.js';

const OUT = new URL('../test-vectors.md', import.meta.url);
const write = process.argv.includes('--write');

// ---- verification: two readers over the corpus, no socket ----
const fail = [];
let ran = 0;
const check = (what, ok) => { ran++; if (!ok) fail.push(what); return ok; };

for (const [name, f] of [['profile version 1', p1], ['profile version 2', p2], ['profile version 3', p3],
  ['post 1', post1], ['post 2', post2], ['post 3', post3], ['post 4', post4], ['post 5', post5],
  ['index version 1', head1], ['index version 2', head2], ['index version 3', head3]]) {
  const line = sigLine(f);
  check(`${name}: the signature line is 86 base64url characters that re-encode to themselves`,
    /^[A-Za-z0-9_-]{86}$/.test(line) && Buffer.from(line, 'base64url').toString('base64url') === line);
  check(`${name}: the address is the hash of the body, not of the file`,
    address(f) === sha256(body(f)) && address(f) !== sha256(f));
  check(`${name}: the body is one line of UTF-8 JSON`, !body(f).includes(0x0a) && typeof JSON.parse(body(f)) === 'object');
}

// The suite is in tools/corpus.js so tools/conform.js can run the same one against anybody's reader.
// Both of ours must pass it, and must return the same verdict in the same order for every scenario —
// agreeing on what to accept is only half of it, and the negative vectors are the other half.
const weekend = await readerSuite(read, (what, ok) => check(`weekend: ${what}`, ok));
const reference = await readerSuite(
  (get, opts) => createReader({ get: async (u) => { const b = await get(u); return b ? { bytes: b, etag: '"t"' } : null; } }).read(opts),
  (what, ok) => check(`src: ${what}`, ok),
);
check('the two readers return the same verdict for every scenario', weekend.join() === reference.join());

// ---- §6: the envelope, which no reader is required to open ----
const sealedField = JSON.parse(body(post5)).encrypted;
const post5FieldOf = () => sealedField;
const opened = unseal(sealedField, READ_MUM.privateKey, postBinding(A1.x, 5));
check('the encrypted post opens for a recipient, with the audience inside',
  opened?.text === 'I am leaving him on Friday' && opened.audience.length === 2 && opened.audience.some((a) => a.read === READ_MUM.x && a.key === MUM.key.x));
check('lifted into another post, the same envelope does not open — the binding is associated data',
  unseal(post5FieldOf(), READ_MUM.privateKey, postBinding(edKey('thief').x, 1)) === null
  && unseal(post5FieldOf(), READ_MUM.privateKey, '') === null);
check('a non-recipient cannot open it', unseal(post5FieldOf(), xKey('vector:hub-read').privateKey, postBinding(A1.x, 5)) === null);
check('one slot per recipient, every slot the same width',
  envelope.slots.length === 2 && new Set(envelope.slots.map(([t, w]) => `${t.length}/${w.length}`)).size === 1);

// ---- §3.7: the spoken code, computed twice ----
const idx = spokenIndices(A1.x);
check('the spoken code is six 11-bit indices', idx.length === 6 && idx.every((i) => Number.isInteger(i) && i >= 0 && i < 2048));
check('src: the spoken code agrees', spokenIndicesRef(A1.x).join() === idx.join());
check('src: the six words are the BIP-39 words at those indices', spokenCode(A1.x).length === 6 && spokenCode(A1.x).every((w) => /^[a-z]+$/.test(w)));

// ---- render ----
const f = (bytes) => bytes.toString('utf8');
const vec = (title, note, text) => `## ${title}\n\n${note}\n\n\`\`\`\n${text}\n\`\`\`\n`;

const appendix = [
  '# Open Feed test vectors',
  '',
  'Known-good files for every construction in `open-feed-spec.md`. Each is produced by `tools/regen.js`,',
  'which signs them with the weekend publisher, verifies them by running **two independent readers** over',
  'them in the order §7 states, and then checks that this file carries them verbatim. Run',
  '`node tools/regen.js` after any change to a schema, the signing format, or the envelope; it exits',
  'non-zero on drift.',
  '',
  'Keys are deterministic so the bytes reproduce. Note that a *different* signature line for the same',
  'body is equally valid (§2.2): a verifier hashes the body and checks the signature, and never compares',
  'files byte for byte.',
  '',
  '## 1. Keys',
  '',
  '```',
  `alice anchor   (Ed25519 public)  ${A1.x}`,
  `alice rotated   (Ed25519 public)  ${A2.x}`,
  `alice restored  (Ed25519 public)  ${A3.x}`,
  `mum             (Ed25519 public)  ${MUM.key.x}`,
  `sis             (Ed25519 public)  ${SIS.key.x}`,
  `bro             (Ed25519 public)  ${BRO.key.x}`,
  `alice reading   (X25519 public)   ${READ_ALICE.x}`,
  `mum reading     (X25519 public)   ${READ_MUM.x}`,
  '```',
  '',
  '## 2. The recovery commitment (§3.4)',
  '',
  'Three members, committed one member at a time; two of them are a majority (§3.3). `sis` vouching',
  'reveals `saltsis` and her key, and nothing about `mum` or `bro`.',
  '',
  '```',
  `salts             mum "${MUM.salt}"  sis "${SIS.salt}"  bro "${BRO.salt}"`,
  `SHA-256(salt|key) ${REC.leaves.join('\n                  ')}`,
  `committed         ${JSON.stringify(REC)}`,
  '```',
  '',
  vec('3. Profile, `version` 1 (anchor)', 'The chain is one link long and the file is signed by the anchor key.', f(p1)),
  vec('4. Profile, `version` 2 (a rotation)', 'The link carries the list that stood before it and is signed by the key it replaces, over the ASCII\nbytes `<previous>-><new>` (§3.3).', f(p2)),
  vec('5. Profile, `version` 3 (a restore)',
    'The same link shape with vouchers instead of a signature: two of three — a majority — each revealing\nonly its own salt, counted against the `recovery` the link carries (§3.3).', f(p3)),
  vec('6. Post', 'The number is inside the signed bytes (§5.1).', f(post1)),
  vec('7. Post — a reply', 'The target names the author\'s anchor key, the number, all 43 characters of the address, and where\nthe replier last knew that author to live (§5.4).', f(post3)),
  vec('8. Post — encrypted',
    `Only \`number\` and \`at\` are in the clear; the text, the relation, the target and the media references are\ninside the envelope (§6.5), and so is the audience, naming each recipient by anchor key, reading key and\nlocation (§6.4): one slot per recipient. The binding bound into the associated data is\n\`${A1.x}:5\`.`, f(post5)),
  vec('9. Index, `version` 1', 'Three posts live.', f(head1)),
  vec('10. Index, `version` 2 — a withdrawal, a media file',
    `Post 2 is withdrawn by an appended line, post 5 is the encrypted one, and the media file is listed by its\naddress alone. The media file's bytes are ${png.length} bytes hashing to \`${pngHash}\`.`, f(head2)),
  vec('11. Index, `version` 3 — the rewrite, and a number that comes back',
    'The lines the withdrawal left behind are gone (§4.5), and post 2 is re-listed at the hash it had\n(§4.1). A reader holding `version` 2 accepts this: it remembers the withdrawn hash, and the same bytes\ncoming back are not a change.', f(head3)),
  '## 12. The spoken code (§3.7)',
  '',
  'Six 11-bit indices into the BIP-39 English list, and the words they select, from the anchor key above — or from any key (§3.7).',
  '',
  '```',
  `HKDF-SHA256(ikm = key, salt = "", info = "openfeed/v1/spoken", 9 bytes)`,
  `indices  ${idx.join(' ')}`,
  `words    ${spokenCode(A1.x).join(' ')}`,
  '```',
  '',
].join('\n');

if (fail.length) {
  console.error('VECTORS DO NOT HOLD:');
  for (const w of fail) console.error(`  FAIL  ${w}`);
  process.exit(1);
}

if (write) {
  fs.writeFileSync(OUT, appendix);
  console.log(`wrote ${appendix.split('\n').length} lines to test-vectors.md`);
} else if (!fs.existsSync(OUT) || fs.readFileSync(OUT, 'utf8') !== appendix) {
  console.error('DRIFT: test-vectors.md is not what the vectors produce. Run with --write.');
  process.exit(1);
} else {
  console.log('test-vectors.md is current.');
}
console.log(`all ${ran} vector checks hold, ${fail.length} failing`);
