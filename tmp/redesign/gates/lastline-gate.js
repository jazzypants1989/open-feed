// lastline-gate: is last-line signing as safe as compact-JWS? Every byte of body, separator and
// signature mutated under a strict and a lenient decoder; the helpful-host transforms; the
// spelling variants; the parse-divergence hygiene the format does not remove.
// Kill criteria: a body or separator mutation that verifies under either decoder; a signature
// mutation that verifies under strict; a lenient survivor whose address changes; a host
// transform that verifies.
import crypto from 'node:crypto';
import { makeKey, sign, split, verify, address, H, open, parseStrict, decodeLenient, keyObj } from './lastline.js';

const alice = makeKey('alice'), mallory = makeKey('mallory');
const payload = { n: 7, body: 'we found a house', at: '2026-08-21T10:00:00Z' };
const file = sign(payload, alice);
const { body, sigText } = split(file);
const sep = body.length;
const strict = (f) => verify(f, alice.x);
const lenient = (f) => verify(f, alice.x, { decode: decodeLenient });

// ---- the sweep: replace / insert / delete at every byte of a region ----
const REPL = ['A', 'z', '9', '_', '-', '=', '+', '/', ' ', '\n', '\r', '\t'].map((c) => Buffer.from(c));
const replaceAt = (i, b) => Buffer.concat([file.subarray(0, i), b, file.subarray(i + 1)]);
const insertAt = (i, b) => Buffer.concat([file.subarray(0, i), b, file.subarray(i)]);
const deleteAt = (i) => Buffer.concat([file.subarray(0, i), file.subarray(i + 1)]);
function* sweep(lo, hi) {
  for (let i = lo; i < hi; i++) {
    for (const r of REPL) if (r[0] !== file[i]) yield replaceAt(i, r);
    for (const r of REPL) yield insertAt(i, r);
    yield deleteAt(i);
  }
}
const count = (gen) => { let n = 0, s = 0, l = 0; const hits = []; for (const m of gen) { n++; if (strict(m)) s++; if (lenient(m)) { l++; hits.push(m); } } return { n, s, l, hits }; };
const bodySweep = count(sweep(0, sep));
const sepSweep = count(sweep(sep, sep + 1));

// Signature region: the sweep, every byte value appended and inserted mid-signature, the
// whitespace/padding forms, and the 15 other spellings of the last character's unused bits.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function* sigVariants() {
  yield* sweep(sep + 1, file.length);
  for (let b = 1; b < 256; b++) if (b !== 0x0a) { yield Buffer.concat([file, Buffer.from([b])]); yield insertAt(sep + 1 + 43, Buffer.from([b])); }
  for (const t of [' ', '\r', '\t', '=', '==', '=zzz']) yield Buffer.concat([file, Buffer.from(t)]);
  const last = ALPHA.indexOf(sigText[85]);
  for (let k = 0; k < 64; k++) if (k !== last && (k & 0x3c) === (last & 0x3c)) yield Buffer.concat([body, Buffer.from('\n'), Buffer.from(sigText.slice(0, 85) + ALPHA[k])]);
  const std = Buffer.from(sigText, 'base64url').toString('base64');
  yield Buffer.concat([body, Buffer.from('\n'), Buffer.from(std)]);
}
const sigSweep = count(sigVariants());
const survivors = [...new Map(sigSweep.hits.map((m) => [H(m), m])).values()];
const sameAddress = survivors.every((m) => address(m) === address(file));
const distinctFiles = survivors.every((m) => H(m) !== H(file));

// ---- two serializations of one object are two files ----
const pretty = sign(payload, alice, { bodyText: JSON.stringify(payload, null, 2) });

// ---- helpful hosts (writing-exp.js's list, plus CRLF and BOM) ----
const hosts = {
  'trailing newline': Buffer.concat([file, Buffer.from('\n')]),
  'CRLF separator': Buffer.concat([body, Buffer.from('\r\n'), Buffer.from(sigText)]),
  'BOM prefix': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), file]),
  'pretty-printed body': Buffer.concat([Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2)), Buffer.from('\n'), Buffer.from(sigText)]),
  'sorted keys': Buffer.concat([Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(body.toString())).sort()))), Buffer.from('\n'), Buffer.from(sigText)]),
  'tab-indented body': Buffer.concat([Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, '\t')), Buffer.from('\n'), Buffer.from(sigText)]),
};
const hostSurvivors = Object.entries(hosts).filter(([, f]) => strict(f) || lenient(f)).map(([k]) => k);

// ---- S + L: the group-order malleation Ed25519 verifiers are supposed to refuse ----
const L = BigInt('0x1000000000000000000000000000000014def9dea2f79cd65812631a5cf5d3ed');
const raw = Buffer.from(sigText, 'base64url');
const S = BigInt('0x' + Buffer.from(raw.subarray(32)).reverse().toString('hex')) + L;
const malleated = Buffer.concat([raw.subarray(0, 32), Buffer.from(S.toString(16).padStart(64, '0'), 'hex').reverse()]);
const malleationRejected = !crypto.verify(null, body, keyObj(alice.x), malleated);

// ---- hygiene: where two readers of the same signed bytes can disagree ----
const divergent = { 'duplicate member': '{"n":1,"n":2}', '__proto__ member': '{"__proto__":{"x":1}}', 'integer past 2^53': '{"n":9007199254740993}', 'lone surrogate': '{"s":"\\ud800"}', 'leading BOM': '﻿{}' };
const accepts = (fn, t) => { try { fn(t); return true; } catch { return false; } };
const strictAccepts = Object.values(divergent).filter((t) => accepts(parseStrict, t)).length;
const jsonAccepts = Object.values(divergent).filter((t) => accepts(JSON.parse, t)).length;

console.log(`  file ${file.length} B = body ${body.length} + 1 + signature ${sigText.length}`);
console.log('  region      mutations   verify (strict)   verify (lenient)');
for (const [name, r] of [['body', bodySweep], ['separator', sepSweep], ['signature', sigSweep]]) {
  console.log(`  ${name.padEnd(11)} ${String(r.n).padStart(9)}   ${String(r.s).padStart(15)}   ${String(r.l).padStart(16)}`);
}
console.log(`  hygiene: parseStrict accepts ${strictAccepts} of 5 divergent texts; JSON.parse accepts ${jsonAccepts} of 5\n`);

const gate = [
  ['a signed file verifies under strict and opens to its payload', strict(file) && JSON.stringify(open(file, alice.x).obj) === JSON.stringify(payload)],
  ['two serializations of one object are two files with two addresses (bytes are the identity)', strict(pretty) && address(pretty) !== address(file)],
  [`body sweep: 0 of ${bodySweep.n} mutations verify under either decoder`, bodySweep.s === 0 && bodySweep.l === 0],
  [`separator sweep: 0 of ${sepSweep.n} mutations verify under either decoder`, sepSweep.s === 0 && sepSweep.l === 0],
  [`signature sweep: 0 of ${sigSweep.n} mutations verify under strict`, sigSweep.s === 0],
  [`signature sweep: ${survivors.length} distinct files verify under the lenient decoder every -exp.js uses — the finding`, survivors.length > 0],
  [`all ${survivors.length} lenient survivors keep the address (hash of body) and differ from the file by hash`, sameAddress && distinctFiles],
  [`helpful-host transforms fail closed under both decoders${hostSurvivors.length ? ' — SURVIVED: ' + hostSurvivors.join(', ') : ''}`, hostSurvivors.length === 0],
  ['the S+L malleated signature is rejected by the verifier', malleationRejected],
  ['hygiene: parseStrict rejects all 5 divergence cases; JSON.parse accepts 4 of them', strictAccepts === 0 && jsonAccepts === 4],
  ['a key that did not sign does not verify', !verify(file, mallory.x)],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('lastline-gate: all claims hold');
