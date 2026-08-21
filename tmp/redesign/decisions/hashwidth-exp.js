// Experiment B — may the head list a 16-byte prefix of a post's hash instead of all 32?
// It takes 38% off every column headage-exp.js prints. The handoff asks for one row: that no two live
// posts collide by accident at any scale tried, and that a stolen old key cannot mint a collision.
// The interesting cost is the third case nobody commissioned — the AUTHOR grinding a collision to
// show two readers different posts under one head entry — which is why the reply's target carries
// the whole 32 bytes while the head carries the prefix.
//
//   node tmp/redesign/decisions/hashwidth-exp.js
import crypto from 'node:crypto';
import { makeKey, sign, address } from '../gates/lastline.js';

const alice = makeKey('alice');
const raw = (b) => crypto.createHash('sha256').update(b).digest();
const pre = (buf, w) => buf.subarray(0, w).toString('hex');

// ---- 1. accidental collisions, searched for rather than assumed ----
// The same search at widths where a collision MUST turn up, so "none found at 16 bytes" is a
// result and not a description of a search that never looks.
const M = 400_000;
const bodies = Array.from({ length: M }, (_, i) => Buffer.from(`{"n":${i},"text":"post ${i}"}`));
const digests = bodies.map(raw);
const found = {};
for (const w of [3, 4, 5, 6, 8, 16]) {
  const seen = new Map(); let hits = 0, example = null;
  for (let i = 0; i < M; i++) {
    const k = pre(digests[i], w);
    if (seen.has(k)) { hits++; example ??= [seen.get(k), i]; } else seen.set(k, i);
  }
  found[w] = { hits, example, expected: (M * M) / 2 / 2 ** (8 * w) };
}

console.log(`\n  1. accidental collisions among ${M.toLocaleString()} real post hashes\n`);
console.log('    prefix width   expected pairs   found   an example');
for (const w of [3, 4, 5, 6, 8, 16]) {
  const f = found[w];
  console.log(`    ${String(w + ' bytes').padEnd(14)} ${f.expected.toExponential(1).padStart(14)} ${String(f.hits).padStart(7)}   ${f.example ? `n=${f.example[0]} and n=${f.example[1]} share ${pre(digests[f.example[0]], w)}` : '—'}`);
}

// Birthday arithmetic at the scales the design has ever named, for the two candidate widths.
console.log('\n    live posts     P(any collision) at 16 bytes    at 32 bytes');
for (const L of [1557, 100_000, 10_000_000, 1_000_000_000]) {
  const p = (w) => (L * L) / 2 / 2 ** (8 * w);
  console.log(`    ${L.toLocaleString().padStart(13)}  ${p(16).toExponential(1).padStart(24)}   ${p(32).toExponential(1).padStart(12)}`);
}

// ---- 2. what an attacker has to grind ----
const t0 = process.hrtime.bigint();
for (let i = 0; i < 200_000; i++) raw(Buffer.from(`{"n":7,"text":"post 7","nonce":${i}}`));
const rate = 200_000 / (Number(process.hrtime.bigint() - t0) / 1e9);
const yrs = (work, r) => { const y = work / r / 31_557_600; return y < 1 ? `${(y * 365).toFixed(1)} days` : `${y.toExponential(1)} yr`; };
const FARM = 2 ** 40;                                       // ~1.1e12 h/s: a serious ASIC-class effort

console.log(`\n  2. the work, at ${(rate / 1e6).toFixed(2)}M hashes/s measured here and at a 2^40 h/s farm\n`);
console.log('    attack                                             width   work        this machine        a 2^40 h/s farm');
for (const [what, exp16, exp32] of [
  ['second preimage: land on a LISTED post\'s entry', 128, 256],
  ['birthday: two bodies of your own that collide', 64, 128],
]) {
  for (const [w, e] of [[16, exp16], [32, exp32]]) {
    console.log(`    ${what.padEnd(48)} ${String(w + ' B').padEnd(7)} 2^${String(e).padEnd(6)} ${yrs(2 ** e, rate).padStart(14)}      ${yrs(2 ** e, FARM).padStart(14)}`);
  }
}

// ---- 3. the author's own collision, staged at a width where it is findable ----
// Alice grinds two DIFFERENT posts sharing a prefix, lists one entry, and hands each reader a
// different body. Both verify (she signed both) and both are admitted (the prefix matches).
const W = 4;
const grind = () => {
  const seen = new Map();
  for (let i = 0; ; i++) {
    const body = `{"n":7,"text":"the version for reader ${i}"}`;
    const k = pre(raw(Buffer.from(body)), W);
    if (seen.has(k) && seen.get(k) !== body) return [seen.get(k), body];
    seen.set(k, body);
  }
};
const [bodyA, bodyB] = grind();
const fileA = sign(null, alice, { bodyText: bodyA }), fileB = sign(null, alice, { bodyText: bodyB });
const listed = pre(Buffer.from(address(fileA), 'base64url'), W);
const admitted = (file) => pre(Buffer.from(address(file), 'base64url'), W) === listed;

// Mom holds A. The cousin, who was served B, replies. Two shapes for what a reply names.
const replyTarget = (file, width) => pre(Buffer.from(address(file), 'base64url'), width);
const momSees = (width) => (replyTarget(fileB, width) === replyTarget(fileA, width) ? 'agrees — equivocation invisible' : 'MISMATCH — the two readers hold different posts at n=7');

console.log(`\n  3. the author equivocating under one head entry (staged at ${W} bytes, where the grind is seconds)\n`);
console.log(`    two bodies she signed:   ${bodyA}\n                             ${bodyB}`);
console.log(`    head lists n=7 as ${listed}…   both admitted: ${admitted(fileA)} / ${admitted(fileB)}`);
console.log(`    the cousin's reply names the target by a ${W}-byte prefix:  ${momSees(W)}`);
console.log(`    the cousin's reply names the target by all 32 bytes:  ${momSees(32)}`);

// ---- 4. what the prefix buys ----
const entry = (w) => `[100000,"${'x'.repeat(Math.ceil((w * 4) / 3))}"],`.length;
console.log('\n  4. what it buys\n');
console.log('    live posts        head at 32 bytes   at 16 bytes   saved');
for (const [label, L] of [['family    1,557', 1557], ['journal 100,000', 100_000]]) {
  const a = L * entry(32), b = L * entry(16);
  console.log(`    ${label}   ${String((a / 1e3).toFixed(0) + ' KB').padStart(16)}   ${String((b / 1e3).toFixed(0) + ' KB').padStart(11)}   ${((1 - b / a) * 100).toFixed(0)}%`);
}

console.log(`
  Reading. The prefix is safe against both attackers the handoff named, and weaker against a third
  it did not. A search that finds ${found[4].hits} collisions at 4 bytes and ${found[5].hits} at 5 finds ${found[16].hits} at 16 across ${M.toLocaleString()} real hashes,
  and the arithmetic says a billion live posts sit at ${((1e9 * 1e9) / 2 / 2 ** 128).toExponential(1)} — accidental collision is not a
  scale question, it is a non-event. A thief holding a rotated-out key gains nothing either: to get
  a forged post admitted he needs a SECOND PREIMAGE on a listed entry, 2^128 even at 16 bytes,
  which is ${yrs(2 ** 128, FARM).trim()} on a farm that does 2^40 hashes a second. Cutting to 16 bytes takes that
  from absurd to absurd.

  What it does move is the AUTHOR's own attack, from 2^128 to 2^64 — grinding two of her own posts
  that share an entry, then showing one to her mother and the other to her cousin. That is a real
  reduction, and 2^64 is not a joke for a determined adversary. It is also already answered by a
  rule the design has for another reason: a reply names its target by the whole 32-byte hash, so
  the cousin's reply and the mother's copy disagree the moment they meet — exactly the collision
  that RULINGS §11.1 says is the split-view detector. Staged above at 4 bytes with a real found
  collision: prefix-width targets say "agrees", full-width targets say "MISMATCH". So the rule to
  write is not a width, it is a PAIR: the head may carry ${16} bytes, the target MUST carry 32.
  The saving is ${((1 - entry(16) / entry(32)) * 100).toFixed(0)}%, not the half headage-exp.js rounds it to — the brackets, the number and the
  quotes do not shrink — and it costs nothing else, provided that pair holds together.
`);
