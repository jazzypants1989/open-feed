// Regenerates Appendix B of open-feed-spec-2.md and checks the published spec against it.
//
//   node tmp/regen2.js           verify the vectors and check the spec carries them verbatim
//   node tmp/regen2.js --write   regenerate Appendix B into open-feed-spec-2.md
//
// WHY NOT tmp/regen.js. That one canonicalizes: it builds bytes through src/canonical.js, which the
// new format does not have and does not want (§3.3). There is nothing to reuse.
//
// NO SECOND IMPLEMENTATION LIVES HERE. The files are produced by tmp/redesign/gates/
// weekend-publisher.js and the envelope by gates/envelope.js — the same code the gates drive over
// real sockets. Verification runs the *composed reader* (gates/weekend-reader.js) over an in-memory
// fetcher, so what checks these vectors is the reader a second implementer is being asked to write,
// in the order §8 states, rather than a signature check written here to agree with them.
import crypto from 'node:crypto';
import fs from 'node:fs';

import * as pub from './redesign/gates/weekend-publisher.js';
import { read } from './redesign/gates/weekend-reader.js';
import { seal, open as unseal, carrierOf, xKey } from './redesign/gates/envelope.js';

const SPEC = new URL('../open-feed-spec-2.md', import.meta.url);
const MARKER = '## Appendix B: Test Vectors';
const write = process.argv.includes('--write');

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const body = (f) => f.subarray(0, f.lastIndexOf(0x0a));
const sigLine = (f) => f.subarray(f.lastIndexOf(0x0a) + 1).toString('latin1');

// ---- deterministic keys, so every byte below reproduces on any machine ----
// Ed25519 signing is deterministic (RFC 8032), so a fixed seed fixes the whole file. §3.2 exists
// because a library MAY randomize it; a verifier that hashes the body is unaffected either way.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const edKey = (label) => {
  const seed = crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  return { label, privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
};

// ---- §4.1's spoken code ----
export function spokenIndices(genesisX) {
  const bits = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(genesisX, 'base64url'), Buffer.alloc(0), 'openfeed/v1/spoken', 9));
  let acc = 0n;
  for (const b of bits) acc = (acc << 8n) | BigInt(b);      // 72 bits
  return Array.from({ length: 6 }, (_, i) => Number((acc >> BigInt(72 - 11 * (i + 1))) & 0x7ffn));
}

// ---- the identity ----
const A1 = edKey('alice/genesis'), A2 = edKey('alice/rotated'), A3 = edKey('alice/restored');
const MUM = { key: edKey('mum'), salt: 'saltmum' };
const SIS = { key: edKey('sis'), salt: 'saltsis' };
const BRO = { key: edKey('bro'), salt: 'saltbro' };
const REC = pub.commit(2, [MUM, SIS, BRO]);
const AT = 'https://alice.example/alice';

const READ_ALICE = xKey('vector:alice-read');
const READ_MUM = xKey('vector:mum-read');

const chain1 = [{ key: A1.x }];
const chain2 = [...chain1, pub.rotation(A1, A2)];
// A restore hop carries the list it satisfied — the one that stood BEFORE the hop (§4.3).
const chain3 = [...chain2, pub.restore(A2, A3, [MUM, SIS], REC)];

const base = { genesis: A1.x, name: 'Alice', recovery: REC, locations: [AT], read: READ_ALICE.x };
const p1 = pub.profile({ ...base, pseq: 1, chain: chain1 }, A1);
const p2 = pub.profile({ ...base, pseq: 2, chain: chain2 }, A2);
const p3 = pub.profile({ ...base, pseq: 3, chain: chain3 }, A3);

// ---- the posts ----
const post1 = pub.post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const post2 = pub.post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1);
const post3 = pub.post(3, {
  at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you',
  rel: 'reply',
  target: { key: edKey('mum').x, n: 12, hash: sha256(Buffer.from('a post of mum\'s')), at: 'https://mom.example/mom' },
}, A2);
const photo = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1');
const photoHash = sha256(photo);
const post4 = pub.post(4, { at: '2026-08-15T07:00:00Z', text: 'scheduled for the morning', media: [photoHash] }, A3);
// A sealed post: n and at in the clear, everything else — text, rel, target, media — inside (§7.6).
const envelope = seal({
  content: { text: 'I am leaving him on Friday', rel: 'root' },
  audience: [READ_ALICE.x, READ_MUM.x],
  carrier: carrierOf(A1.x, 5),
  ephemeral: xKey('vector:ephemeral/5'),
  ck: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/5').digest(),
});
const post5 = pub.post(5, { at: '2026-08-18T21:40:00Z', sealed: envelope }, A3);

const H = (f) => pub.address(f);
const h1 = H(post1), h2 = H(post2), h3 = H(post3), h4 = H(post4), h5 = H(post5);

// ---- the heads: three versions of one file ----
const head1 = pub.head({ entries: [[1, h1], [2, h2], [3, h3]], hseq: 1, top: 3 }, A3);
const head2 = pub.head({ entries: [[1, h1], [2, h2], [3, h3], [2, null], [4, h4, 'pending'], [5, h5], [photoHash]], hseq: 2, top: 5 }, A3);
// The rewrite drops the lines the withdrawal left behind, and carries the pending entry through
// still pending (§5.5, §5.7).
const head3 = pub.head({ entries: [[1, h1], [3, h3], [4, h4, 'pending'], [5, h5], [photoHash]], hseq: 3, top: 5 }, A3);

// ---- verification: the composed reader over an in-memory fetcher, no socket ----
const files = new Map([
  [`${AT}/posts/1`, post1], [`${AT}/posts/2`, post2], [`${AT}/posts/3`, post3],
  [`${AT}/posts/4`, post4], [`${AT}/posts/5`, post5],
  [`${AT}/media/${photoHash}`, photo], [`${AT}/profile`, p3],
]);
const get = async (p) => files.get(p) ?? null;
const serveHead = (h) => files.set(`${AT}/head`, h);

const fail = [];
const check = (what, ok) => { if (!ok) fail.push(what); return ok; };

for (const [name, f] of [['profile pseq 1', p1], ['profile pseq 2', p2], ['profile pseq 3', p3],
  ['post 1', post1], ['post 2', post2], ['post 3', post3], ['post 4', post4], ['post 5', post5],
  ['head hseq 1', head1], ['head hseq 2', head2], ['head hseq 3', head3]]) {
  const line = sigLine(f);
  check(`${name}: the signature line is 86 base64url characters that re-encode to themselves`,
    /^[A-Za-z0-9_-]{86}$/.test(line) && Buffer.from(line, 'base64url').toString('base64url') === line);
  check(`${name}: the address is the hash of the body, not of the file`,
    pub.address(f) === sha256(body(f)) && pub.address(f) !== sha256(f));
  check(`${name}: the body is one line of UTF-8 JSON`, !body(f).includes(0x0a) && typeof JSON.parse(body(f)) === 'object');
}

serveHead(head1);
const cold = await read(get, { learned: A1.x, at: AT });
check('a cold read of hseq 1 is ok, with three posts and "recently restored" as a note',
  cold.verdict === 'ok' && cold.posts.size === 3 && cold.note.includes('recently restored'));

serveHead(head2);
const pinned = await read(get, { learned: A1.x, at: AT, pin: cold.pin });
check('a pinned read of hseq 2 is ok, notes the withdrawal and the pending entry, and never fetches the pending post',
  pinned.verdict === 'ok' && pinned.note.includes('withdrawn: 2') && pinned.note.includes('pending: 4')
  && !pinned.posts.has(4) && pinned.posts.has(5) && pinned.media.has(photoHash));

serveHead(head3);
const rewritten = await read(get, { learned: A1.x, at: AT, pin: pinned.pin });
check('the rewrite is accepted by a reader that held the head before it, with the same live set and the pending entry still pending',
  rewritten.verdict === 'ok' && [...rewritten.posts.keys()].join(',') === '1,3,5' && rewritten.note.includes('pending: 4'));
check('the reader hands back the verified profile\'s reading key', rewritten.read === READ_ALICE.x);

const sealedField = JSON.parse(body(post5)).sealed;
const post5FieldOf = () => sealedField;
const opened = unseal(sealedField, READ_MUM.privateKey, carrierOf(A1.x, 5));
check('the sealed post opens for a recipient, with the audience inside',
  opened?.text === 'I am leaving him on Friday' && opened.audience.length === 2 && opened.audience.includes(READ_MUM.x));
check('lifted into another post, the same envelope does not open — the carrier is associated data',
  unseal(post5FieldOf(), READ_MUM.privateKey, carrierOf(edKey('thief').x, 1)) === null
  && unseal(post5FieldOf(), READ_MUM.privateKey, '') === null);
check('a non-recipient cannot open it', unseal(post5FieldOf(), xKey('vector:host-read').privateKey, carrierOf(A1.x, 5)) === null);
check('every slot is the same width, real or dummy, and the audience is padded to the floor of eight',
  envelope.slots.length === 8 && new Set(envelope.slots.map(([t, w]) => `${t.length}/${w.length}`)).size === 1);

const idx = spokenIndices(A1.x);
check('the spoken code is six 11-bit indices', idx.length === 6 && idx.every((i) => Number.isInteger(i) && i >= 0 && i < 2048));

// ---- render ----
const f = (bytes) => bytes.toString('utf8');
const vec = (title, note, text) => `### ${title}\n\n${note}\n\n\`\`\`\n${text}\n\`\`\`\n`;

const appendix = [
  MARKER,
  '',
  'Every vector below is produced by `tmp/regen2.js`, which signs them with the reference publisher,',
  'verifies them by running the reference **reader** over them in the order §8 states, and then checks',
  'that this document carries them verbatim. Run `node tmp/regen2.js` after any change to a schema, to',
  'the signing format, or to the envelope; it exits non-zero on drift.',
  '',
  'Keys are deterministic so the bytes reproduce. Note that a *different* signature line for the same',
  'body is equally valid (§3.2): a verifier hashes the body and checks the signature, and never compares',
  'files byte for byte.',
  '',
  '### B.1. Keys',
  '',
  '```',
  `alice genesis   (Ed25519 public)  ${A1.x}`,
  `alice rotated   (Ed25519 public)  ${A2.x}`,
  `alice restored  (Ed25519 public)  ${A3.x}`,
  `mum             (Ed25519 public)  ${MUM.key.x}`,
  `sis             (Ed25519 public)  ${SIS.key.x}`,
  `bro             (Ed25519 public)  ${BRO.key.x}`,
  `alice reading   (X25519 public)   ${READ_ALICE.x}`,
  `mum reading     (X25519 public)   ${READ_MUM.x}`,
  '```',
  '',
  '### B.2. The recovery commitment (§4.4)',
  '',
  'Two of three, committed one member at a time. `sis` vouching reveals `saltsis` and her key, and',
  'nothing about `mum` or `bro`.',
  '',
  '```',
  `salts             mum "${MUM.salt}"  sis "${SIS.salt}"  bro "${BRO.salt}"`,
  `SHA-256(salt|key) ${REC.leaves.join('\n                  ')}`,
  `committed         ${JSON.stringify(REC)}`,
  '```',
  '',
  vec('B.3. Profile, `pseq` 1 (genesis)', 'The chain is one hop long and the file is signed by the genesis key.', f(p1)),
  vec('B.4. Profile, `pseq` 2 (a rotation)', 'The hop is signed by the key it replaces, over the ASCII bytes `<previous>-><new>`.', f(p2)),
  vec('B.5. Profile, `pseq` 3 (a restore)',
    'Two of three vouchers, each revealing only its own salt. The hop carries `court` — the list it\nsatisfied — because a reader meeting this identity for the first time has no other copy of it (§4.3).', f(p3)),
  vec('B.6. Post', 'The number is inside the signed bytes (§6.1).', f(post1)),
  vec('B.7. Post — a reply', 'The target names the author\'s genesis key, the number, all 43 characters of the address, and where\nthe replier last knew that author to live (§6.4).', f(post3)),
  vec('B.8. Post — sealed',
    `Only \`n\` and \`at\` are in the clear; the text, the relation, the target and the media references are\ninside the envelope (§7.6). The audience is padded to eight slots (§7.4). The carrier bound into the\nassociated data is \`${A1.x}:5\`.`, f(post5)),
  vec('B.9. Head, `hseq` 1', 'Three posts live.', f(head1)),
  vec('B.10. Head, `hseq` 2 — a withdrawal, a pending post, a photo',
    `Post 2 is withdrawn by an appended line, post 4 is listed but not released, post 5 is the sealed one,\nand the photo is listed by its address alone. The photo's bytes are ${photo.length} bytes hashing to\n\`${photoHash}\`.`, f(head2)),
  vec('B.11. Head, `hseq` 3 — the rewrite',
    'The lines the withdrawal left behind are gone and the pending entry is carried through **still\npending** (§5.5). A reader holding `hseq` 2 accepts this, reports nothing, and its live set is\nunchanged.', f(head3)),
  '### B.12. The spoken code (§4.1)',
  '',
  'Six 11-bit indices into a 2,048-word list, from the genesis key above.',
  '',
  '```',
  `HKDF-SHA256(ikm = genesis key, salt = "", info = "openfeed/v1/spoken", 9 bytes)`,
  `indices  ${idx.join(' ')}`,
  '```',
  '',
].join('\n');

if (fail.length) {
  console.error('VECTORS DO NOT HOLD:');
  for (const w of fail) console.error(`  FAIL  ${w}`);
  process.exit(1);
}

const spec = fs.readFileSync(SPEC, 'utf8');
if (write) {
  const i = spec.indexOf(MARKER);
  fs.writeFileSync(SPEC, (i < 0 ? `${spec.trimEnd()}\n\n` : spec.slice(0, i)) + appendix);
  console.log(`wrote ${appendix.split('\n').length} lines of Appendix B into open-feed-spec-2.md`);
} else if (!spec.includes(appendix.trimEnd())) {
  console.error('DRIFT: open-feed-spec-2.md does not carry Appendix B verbatim. Run with --write.');
  process.exit(1);
} else {
  console.log('Appendix B is in the spec verbatim.');
}
console.log(`all ${11 * 3 + 9} vector checks hold`);
