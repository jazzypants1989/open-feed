// Regenerates test-vectors.md and checks the committed file against it.
//
//   node tools/regen.js           verify the vectors and check test-vectors.md carries them verbatim
//   node tools/regen.js --write   regenerate test-vectors.md
//
// NO SECOND IMPLEMENTATION LIVES HERE. The files are produced by the weekend publisher
// (examples/weekend-publisher) and the envelope by src/envelope.js. Verification runs TWO readers
// over an in-memory fetcher, in the order §7 states: the weekend reader (examples/weekend-reader,
// written from the text alone) and src/reader.js. Two independent readers agreeing on every vector
// is the interop check the spec exists for.
import crypto from 'node:crypto';
import fs from 'node:fs';

import * as pub from '../examples/weekend-publisher/weekend-publisher.js';
import { read } from '../examples/weekend-reader/weekend-reader.js';
import { createReader } from '../src/reader.js';
import { spokenIndices as spokenIndicesRef, spokenCode } from '../src/spoken.js';
import { encrypt, decrypt as unseal, carrierOf, readingKeyFromSeed } from '../src/envelope.js';

// A deterministic X25519 key from a label — for vectors only, never for a real identity.
const xKey = (label) => ({ label, ...readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${label}`).digest()) });

const OUT = new URL('../test-vectors.md', import.meta.url);
const write = process.argv.includes('--write');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const body = (f) => f.subarray(0, f.lastIndexOf(0x0a));
const sigLine = (f) => f.subarray(f.lastIndexOf(0x0a) + 1).toString('latin1');

// ---- deterministic keys, so every byte below reproduces on any machine ----
// Ed25519 signing is deterministic (RFC 8032), so a fixed seed fixes the whole file. §2.2 exists
// because a library MAY randomize it; a verifier that hashes the body is unaffected either way.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const edKey = (label) => {
  const seed = crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  return { label, privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
};

// ---- §3.1's spoken code ----
export function spokenIndices(keyX) {
  const bits = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(keyX, 'base64url'), Buffer.alloc(0), 'openfeed/v1/spoken', 9));
  let acc = 0n;
  for (const b of bits) acc = (acc << 8n) | BigInt(b);      // 72 bits
  return Array.from({ length: 6 }, (_, i) => Number((acc >> BigInt(72 - 11 * (i + 1))) & 0x7ffn));
}

// ---- the identity ----
const A1 = edKey('alice/anchor'), A2 = edKey('alice/rotated'), A3 = edKey('alice/restored');
const MUM = { key: edKey('mum'), salt: 'saltmum' };
const SIS = { key: edKey('sis'), salt: 'saltsis' };
const BRO = { key: edKey('bro'), salt: 'saltbro' };
const REC = pub.commit([MUM, SIS, BRO]);
const AT = 'https://alice.example/alice';

const READ_ALICE = xKey('vector:alice-read');
const READ_MUM = xKey('vector:mum-read');

const chain1 = [{ key: A1.x }];
// Every link carries the list that stood BEFORE it (§3.3); Alice never changed hers, so it is REC throughout.
const chain2 = [...chain1, pub.rotation(A1, A2, REC)];
const chain3 = [...chain2, pub.restore(A2, A3, [MUM, SIS], REC)];

const base = { anchor: A1.x, name: 'Alice', recovery: REC, locations: [AT], read: READ_ALICE.x };
const p1 = pub.profile({ ...base, version: 1, chain: chain1 }, A1);
const p2 = pub.profile({ ...base, version: 2, chain: chain2 }, A2);
const p3 = pub.profile({ ...base, version: 3, chain: chain3 }, A3);

// ---- the posts ----
const post1 = pub.post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const post2 = pub.post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1);
const post3 = pub.post(3, {
  at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you',
  rel: 'reply',
  target: { key: edKey('mum').x, number: 12, hash: sha256(Buffer.from('a post of mum\'s')), location: 'https://mom.example/mom' },
}, A2);
const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1');
const pngHash = sha256(png);
const post4 = pub.post(4, { at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [pngHash] }, A3);
// A encrypted post: number and at in the clear, everything else — text, rel, target, media — inside (§6.5).
const envelope = encrypt({
  content: { text: 'I am leaving him on Friday', rel: 'root' },
  audience: [{ key: A1.x, read: READ_ALICE.x, location: AT }, { key: MUM.key.x, read: READ_MUM.x, location: 'https://mom.example/mom' }],
  carrier: carrierOf(A1.x, 5),
  ephemeral: xKey('vector:ephemeral/5'),
  contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/5').digest(),
});
const post5 = pub.post(5, { at: '2026-08-18T21:40:00Z', encrypted: envelope }, A3);

const H = (f) => pub.address(f);
const h1 = H(post1), h2 = H(post2), h3 = H(post3), h4 = H(post4), h5 = H(post5);

// ---- the indexes: three versions of one file ----
const head1 = pub.index({ entries: [[1, h1], [2, h2], [3, h3]], version: 1, highest: 3 }, A3);
const head2 = pub.index({ entries: [[1, h1], [2, h2], [3, h3], [2, null], [4, h4], [5, h5], [pngHash]], version: 2, highest: 5 }, A3);
// The rewrite drops the lines the withdrawal left behind (§4.5), and post 2 comes back at the hash
// it had (§4.1).
const head3 = pub.index({ entries: [[1, h1], [3, h3], [4, h4], [5, h5], [pngHash], [2, h2]], version: 3, highest: 5 }, A3);

// ---- verification: the composed reader over an in-memory fetcher, no socket ----
const files = new Map([
  [`${AT}/posts/1`, post1], [`${AT}/posts/2`, post2], [`${AT}/posts/3`, post3],
  [`${AT}/posts/4`, post4], [`${AT}/posts/5`, post5],
  [`${AT}/media/${pngHash}`, png], [`${AT}/profile`, p3],
]);
const get = async (p) => files.get(p) ?? null;
const serveIndex = (h) => files.set(`${AT}/index`, h);

const fail = [];
const check = (what, ok) => { if (!ok) fail.push(what); return ok; };

for (const [name, f] of [['profile version 1', p1], ['profile version 2', p2], ['profile version 3', p3],
  ['post 1', post1], ['post 2', post2], ['post 3', post3], ['post 4', post4], ['post 5', post5],
  ['index version 1', head1], ['index version 2', head2], ['index version 3', head3]]) {
  const line = sigLine(f);
  check(`${name}: the signature line is 86 base64url characters that re-encode to themselves`,
    /^[A-Za-z0-9_-]{86}$/.test(line) && Buffer.from(line, 'base64url').toString('base64url') === line);
  check(`${name}: the address is the hash of the body, not of the file`,
    pub.address(f) === sha256(body(f)) && pub.address(f) !== sha256(f));
  check(`${name}: the body is one line of UTF-8 JSON`, !body(f).includes(0x0a) && typeof JSON.parse(body(f)) === 'object');
}

serveIndex(head1);
const cold = await read(get, { learned: A1.x, at: AT });
check('a cold read of version 1 is ok, with three posts and "recently restored" as a note',
  cold.verdict === 'ok' && cold.posts.size === 3 && cold.note.includes('recently restored'));

serveIndex(head2);
const pinned = await read(get, { learned: A1.x, at: AT, pin: cold.pin });
check('a pinned read of version 2 is ok, notes the withdrawal, and holds posts 4 and 5 and the media file',
  pinned.verdict === 'ok' && pinned.note.includes('withdrawn: 2') && pinned.posts.has(4) && pinned.posts.has(5) && pinned.media.has(pngHash));

serveIndex(head3);
const rewritten = await read(get, { learned: A1.x, at: AT, pin: pinned.pin });
check('the rewrite is accepted by a reader that held the index before it, and post 2 is back at the hash it had',
  rewritten.verdict === 'ok' && [...rewritten.posts.keys()].sort().join(',') === '1,2,3,4,5' && !rewritten.note.some((n) => n.startsWith('withdrawn')));
check('a number that came back at another hash would be host', (await read(get, { learned: A1.x, at: AT, pin: { ...pinned.pin, withdrawn: new Map([[2, 'x']]) } })).verdict === 'host');
check('the reader hands back the verified profile\'s reading key', rewritten.read === READ_ALICE.x);

const sealedField = JSON.parse(body(post5)).encrypted;
const post5FieldOf = () => sealedField;
const opened = unseal(sealedField, READ_MUM.privateKey, carrierOf(A1.x, 5));
check('the encrypted post opens for a recipient, with the audience inside',
  opened?.text === 'I am leaving him on Friday' && opened.audience.length === 2 && opened.audience.some((a) => a.read === READ_MUM.x && a.key === MUM.key.x));
check('lifted into another post, the same envelope does not open — the carrier is associated data',
  unseal(post5FieldOf(), READ_MUM.privateKey, carrierOf(edKey('thief').x, 1)) === null
  && unseal(post5FieldOf(), READ_MUM.privateKey, '') === null);
check('a non-recipient cannot open it', unseal(post5FieldOf(), xKey('vector:host-read').privateKey, carrierOf(A1.x, 5)) === null);
check('one slot per recipient, every slot the same width',
  envelope.slots.length === 2 && new Set(envelope.slots.map(([t, w]) => `${t.length}/${w.length}`)).size === 1);

const idx = spokenIndices(A1.x);
check('the spoken code is six 11-bit indices', idx.length === 6 && idx.every((i) => Number.isInteger(i) && i >= 0 && i < 2048));

// ---- the second reader: src/ must read the same bytes to the same verdicts ----
{
  const r2 = createReader({ get: async (p) => (files.has(p) ? { bytes: files.get(p), etag: '"t"' } : null) });
  serveIndex(head1);
  const c2 = await r2.read({ learned: A1.x, at: AT });
  check('src: the cold read agrees', c2.verdict === 'ok' && [...c2.posts.keys()].sort().join() === [...cold.posts.keys()].sort().join() && c2.note.includes('recently restored'));
  serveIndex(head2);
  const p2r = await r2.read({ learned: A1.x, at: AT, pin: c2.pin });
  check('src: the pinned read agrees', p2r.verdict === 'ok' && p2r.note.includes('withdrawn: 2') && p2r.posts.has(4) && p2r.posts.has(5));
  serveIndex(head3);
  const w2 = await r2.read({ learned: A1.x, at: AT, pin: p2r.pin });
  check('src: the rewrite and the re-listing agree', w2.verdict === 'ok' && [...w2.posts.keys()].sort().join(',') === '1,2,3,4,5' && w2.read === READ_ALICE.x);
  check("src: the spoken code agrees", spokenIndicesRef(A1.x).join() === idx.join());
  check('src: the six words are the BIP-39 words at those indices', spokenCode(A1.x).length === 6 && spokenCode(A1.x).every((w) => /^[a-z]+$/.test(w)));
}
serveIndex(head3);

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
    `Only \`n\` and \`at\` are in the clear; the text, the relation, the target and the media references are\ninside the envelope (§6.5), and so is the audience, naming each recipient by anchor key, reading key and\nlocation (§6.4): one slot per recipient. The carrier bound into the associated data is\n\`${A1.x}:5\`.`, f(post5)),
  vec('9. Index, `version` 1', 'Three posts live.', f(head1)),
  vec('10. Index, `version` 2 — a withdrawal, a media file',
    `Post 2 is withdrawn by an appended line, post 5 is the encrypted one, and the media file is listed by its\naddress alone. The media file's bytes are ${png.length} bytes hashing to \`${pngHash}\`.`, f(head2)),
  vec('11. Index, `version` 3 — the rewrite, and a number that comes back',
    'The lines the withdrawal left behind are gone (§4.5), and post 2 is re-listed at the hash it had\n(§4.1). A reader holding `version` 2 accepts this: it remembers the withdrawn hash, and the same bytes\ncoming back are not a change.', f(head3)),
  '## 12. The spoken code (§3.1)',
  '',
  'Six 11-bit indices into the BIP-39 English list, and the words they select, from the anchor key above — or from any key (§3.1).',
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
console.log(`all ${11 * 3 + 16} vector checks hold`);
