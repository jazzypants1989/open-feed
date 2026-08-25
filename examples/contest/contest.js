// §3.6 — two profiles claiming one identity. Anyone can produce a chain that walks from the anchor,
// so walking is no test; four rules settle it, and the fourth is a majority of the recovery list at
// the split — not `k`, because the abuser is on the list. Run: node examples/contest/contest.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, verifyFile, signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, vouched, signProfile, verifyProfile, vouches, walk, adoptRecoveryLists } from '../../src/profile.js';

// Appendix B's keys and salts. The ex is on her recovery list — he is family — and he is the thief.
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const A = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored'), EX = key('ex');
const mum = { key: key('mum'), salt: 'saltmum' }, sis = { key: key('sis'), salt: 'saltsis' };
const bro = { key: key('bro'), salt: 'saltbro' }, ex = { key: EX, salt: 'saltex' };
const family = commit(1, [mum, sis, ex]), his = commit(1, [ex]), pair = commit(1, [mum, sis]);
const LOC = ['https://alice.example/alice'], anchor = { key: A.x };

const prof = (version, chain, recovery, name = 'Alice') => ({ anchor: A.x, version, name, chain, recovery, locations: LOC });
const read = (o, signer, pin = null) => verifyProfile(signProfile(o, signer), { learned: A.x, pin });
const pinOf = (r) => ({ profileVersion: r.raw.version, profileHash: r.profile.address, chain: r.raw.chain, recoveryLists: r.recoveryLists, fields: r.fields });
const pinTo = (o, signer, pin = null) => { const r = read(o, signer, pin); assert.equal(r.verdict, 'ok', say(r)); return pinOf(r); };
const say = (r) => (r.verdict === 'ok' ? 'ok' : `${r.verdict}: ${r.why}`), got = (r) => [r.verdict, r.why];
const HOST = ['host', 'serves a branch the recovery rejected'], TIE = ['identity', 'contested: two histories, and no majority settles it'];
const label = { [A.x]: 'anchor', [A2.x]: 'A2', [A3.x]: 'A3', [EX.x]: 'his key' };
const chainOf = (o) => o.chain.map((h) => label[h.key]).join(' → ').padEnd(22);
const size = (l) => `k=${l.k} of ${l.leaves.length}`;
// The split: the first index at which a served chain differs, or the end of a shorter one (rule 1).
const split = (pin, o) => { const i = o.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key); return i < 0 && o.chain.length < pin.chain.length && o.version > pin.profileVersion ? o.chain.length : i; };

const L1 = rotation(A, A2, family);                    // she rotated once, alone
const rotA3 = rotation(A2, A3, family);                // and again, alone
const restA3 = restore(A2, A3, [mum, sis], family);    // or: two of her three moved her (Appendix B.5)
const exRot = rotation(A2, EX, family);                // the thief holds A2 and moves it to his own key
const exRest = restore(A2, EX, [ex], his);             // the ex, on the list, vouching for himself

// Rule 1, both halves, and the two plain rules that hold against a pin outside a split.
const alice = prof(3, [anchor, L1, restA3], family), pinned = pinTo(alice, A3);
const branch = prof(4, [anchor, L1, exRot], family), forgotten = prof(9, [anchor, L1], family);
const r1 = read(branch, EX, pinned), r1b = read(forgotten, A2, pinned), older = read(prof(2, [anchor, L1], family), A2, pinned);
const twin = read(prof(3, [anchor, L1, restA3], family, 'Alice P.'), A3, pinned);
console.log('§3.6 — the pin holds the chain, and a served chain must extend it key for key\n');
console.log(`  pinned         version 3   ${chainOf(alice)}   a rotation, then a restore`);
console.log(`  the ex serves  version 4   ${chainOf(branch)}   he holds A2, the key she rotated away from`);
console.log(`  his chain walks from the anchor: ${walk(branch, adoptRecoveryLists({}, branch, 0)) !== null} — which is why walking is no test of anything`);
console.log(`  split at index ${split(pinned, branch)}, and the verdict is  ${say(r1)}\n`);
console.log(`  the ex serves  version 9   ${chainOf(forgotten)}   a strict prefix: her restore left out`);
console.log(`  split at index ${split(pinned, forgotten)} — the end of the prefix — and the verdict is  ${say(r1b)}`);
console.log('\n  outside a split, two plain rules against the same pin:');
console.log(`  version 2 after version 3      ${say(older)}`);
console.log(`  version 3, a different body    ${say(twin)}\n`);
assert.ok(walk(branch, adoptRecoveryLists({}, branch, 0)));
assert.deepEqual([split(pinned, branch), split(pinned, forgotten), got(r1), got(r1b), got(older), got(twin)],
  [2, 2, HOST, HOST, ['identity', 'an older profile than the one this reader saw'], ['identity', 'contested: two profiles at one version']]);
// Rule 2: the thief holds the key, rewrites the list at the pinned length, and then splits.
const early = pinTo(prof(2, [anchor, L1], family), A2), rw = read(prof(3, [anchor, L1], his), A2, early), after = pinOf(rw);
const r2a = read(prof(4, [anchor, L1, restA3], family), A3, after), r2 = read(prof(5, [anchor, L1, exRest], his), EX, pinOf(r2a));
console.log('§3.6 — a recovery list is kept per chain length, and is never overwritten\n');
console.log(`  a reader pinned at version 2 holds   length 1: ${size(early.recoveryLists[1])}   length 2: ${size(early.recoveryLists[2])}`);
console.log(`  the ex, holding A2, republishes at version 3 with a list of one — himself:  ${say(rw)}`);
console.log(`  nothing tells his edit from hers, and yet the reader holds   length 2: ${size(after.recoveryLists[2])}   unchanged`);
console.log(`  alice restores to A3, two of three:  ${say(r2a)}`);
console.log(`  he splits the chain at index 2 with the restore his own list would have blessed:  ${say(r2)}\n`);
assert.deepEqual([got(rw), after.recoveryLists, r2a.verdict, got(r2)], [['ok', undefined], early.recoveryLists, 'ok', HOST]);
// Rule 3: the same split, counted against the held list and against the copy he sent.
const rotPin = pinTo(prof(3, [anchor, L1, rotA3], family), A3);
const served = prof(4, [anchor, L1, exRest], his), r3 = read(served, EX, rotPin);
const held = rotPin.recoveryLists[2], carried = served.chain[2].recovery;
const counts = [vouches(A2.x, rotA3, held), vouches(A2.x, exRest, held), vouches(A2.x, exRest, carried)], adopted = adoptRecoveryLists({ ...rotPin.recoveryLists }, served, rotPin.chain.length);
console.log('§3.6 — a link is judged by the list the reader holds, never by the copy it carries\n');
console.log(`  the list the reader holds at index 2   ${size(held)}   mum, sis, and the ex`);
console.log(`  the list his link carries there        ${size(carried)}   himself`);
console.log(`  against the list held      her link ${counts[0]} of 3   his link ${counts[1]} of 3   no majority on either side`);
console.log(`  against the copy he sent   her link 0 of 1   his link ${counts[2]} of 1   a majority for him`);
console.log(`  a pinned reader adopts no carried list at a length its chain reaches: still ${size(adopted[2])}`);
console.log(`  verdict  ${say(r3)}\n`);
assert.deepEqual([counts, adopted[2], got(r3)], [[0, 1, 1], family, TIE]);
// Rule 4: a majority on exactly one side, or the reader follows nobody.
const coerced = restore(A2, EX, [mum, ex], family);
const desc = new Map([[restA3, 'a restore, mum and sis'], [rotA3, 'a rotation she signed herself'], [exRot, 'a rotation with the key he holds'], [exRest, 'a restore he vouched for himself'], [coerced, 'a restore mum was made to sign too']]);
console.log('§3.6 — a majority of the list at the split wins, on exactly one side\n');
console.log('  her link at the split          hers his  his link at the split               verdict');
for (const [mine, link] of [[restA3, exRot], [rotA3, exRot], [rotA3, exRest], [restA3, exRest], [restA3, coerced]]) {
  const r = read(prof(4, [anchor, L1, link], family), EX, pinTo(prof(3, [anchor, L1, mine], family), A3));
  const [a, b] = [vouches(A2.x, mine, family), vouches(A2.x, link, family)];
  console.log(`  ${desc.get(mine).padEnd(30)} ${a}    ${b}    ${desc.get(link).padEnd(35)} ${r.verdict === 'host' ? 'host — his branch rejected' : 'identity — contested'}`);
  assert.deepEqual(got(r), (a * 2 > 3) === (b * 2 > 3) ? TIE : HOST);
}
console.log('\n  A `sig` is not a vote: row 2 is two signed rotations, and each proves only that whoever');
console.log('  held A2 moved. He held it too. Row 5 is a majority on both sides — mum vouched for him.\n');
// Rule 4's other arm, in the order the threat model gives him: first move, holding her LIVE key.
const grabbed = read(prof(3, [anchor, L1, exRot], family), EX, early), pulled = read(prof(4, [anchor, L1, restA3], family), A3, pinOf(grabbed));
console.log('§3.6 — he moves first: the key he holds is her live key, and he rotates it to his own\n');
console.log(`  a reader pinned at version 2, whose chain ends on A2   he rotates A2 → his key:  ${say(grabbed)} — no split, and it follows him`);
console.log(`  her restore, mum and sis, reaches it at version 4       ${say(pulled)} — a split at 2, hers has the majority, it follows her: ${label[pulled.chain.current]}`);
console.log('  On his hub her restore may never arrive. Withholding is the move no rule here answers (§13.3).\n');
assert.deepEqual([got(grabbed), grabbed.chain.current, got(pulled), pulled.chain.current], [['ok', undefined], EX.x, ['ok', undefined], A3.x]);
// The case the protocol exists for, staged under both candidate rules over the same counts.
const byK = (a, b, k) => ((a >= k) === (b >= k) ? 'contested' : a >= k ? 'alice' : 'the ex');
const byMajority = (a, b, n) => ((a * 2 > n) === (b * 2 > n) ? 'contested' : a * 2 > n ? 'alice' : 'the ex');   // more than half
console.log('§3.6 — majority, and not `k`: the case the protocol exists for\n');
console.log(`  the list at the split     ${size(family)} — mum, sis, and the ex. any one of them can bring her back`);
console.log('  her link                  a rotation she signed herself      0 vouchers');
console.log('  his link                  a restore he vouched for himself   1 voucher, his own');
console.log(`  settled by a threshold k  his 1 >= 1 and her 0 < 1           → ${byK(0, 1, family.k)}: he is Alice now`);
console.log(`  settled by a majority     1 of 3 is not more than half       → ${byMajority(0, 1, 3)}: he is nobody`);
console.log(`  the reader's verdict      ${say(r3)}\n`);
console.log('  Under a threshold of `k`, one listed adversary hands himself her identity while she is');
console.log('  merely rotating a key. Under a majority he cannot, alone — at a split. And that is the open');
console.log('  defect (FINDINGS.md §1.1(b)): a link that EXTENDS the pin is judged by §3.3, which is `k`:\n');
const grab = read(prof(4, [anchor, L1, rotA3, restore(A3, EX, [ex], family)], family), EX, rotPin);
console.log(`  he appends A3 → his key, vouched by himself alone, 1 of 3 with k=1   ${say(grab)}, now following ${label[grab.chain.current]}`);
console.log('  No split, so rule 4 never runs. The fix under review makes a restore need k AND a majority.\n');
assert.deepEqual([byK(0, 1, family.k), byMajority(0, 1, 3), got(r3), got(grab), grab.chain.current], ['the ex', 'contested', TIE, ['ok', undefined], EX.x]);
// The price of that, and the repair the single link shape buys.
const L1p = rotation(A, A2, pair), hers = restore(A2, A3, [mum], pair), hisRot = rotation(A2, EX, pair), mended = vouched(hers, A2, [sis]);
const post = signFile({ n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A3);   // signed by A3 before the split
const p6 = pinTo(prof(3, [anchor, L1p, hers], pair), A3), c6 = read(prof(4, [anchor, L1p, hisRot], pair), EX, p6);
const p6b = pinTo(prof(5, [anchor, L1p, mended], pair), A3, p6), c6b = read(prof(4, [anchor, L1p, hisRot], pair), EX, p6b), keys = p6b.chain.map((h) => h.key);
console.log('§3.6 — the price of the majority rule, and the repair the single link shape buys\n');
console.log(`  a list of two, ${size(pair)} — mum and sis; the ex is not on this one`);
console.log(`  her link at the split   a restore mum vouched alone   ${vouches(A2.x, hers, pair)} of 2 — enough for k, not a majority`);
console.log(`  his link at the split   a rotation with her old key   ${vouches(A2.x, hisRot, pair)} of 2`);
console.log(`  verdict                 ${say(c6)}`);
console.log('  She is stuck until a second member vouches. That is what the majority rule costs.\n');
console.log('  sis adds her voucher to the link alice already made (§3.3) and republishes at version 5:\n');
console.log(`  chain                   ${chainOf(prof(5, [anchor, L1p, mended], pair))}   unchanged, key for key`);
console.log(`  her link at the split   ${vouches(A2.x, mended, pair)} of 2 — a majority, and his branch now reads\n                          ${say(c6b)}`);
console.log(`  she never restored again: post 1, signed by A3 before all this, still verifies: ${verifyFile(post, keys) !== null}\n`);
assert.deepEqual([got(c6), keys, got(c6b), verifyFile(post, keys) !== null], [TIE, p6.chain.map((h) => h.key), HOST, true]);
// The two limits, and the exit that runs through a person.
const coldRead = read(served, EX), cold = pinOf(coldRead), c7 = read(alice, A3, cold), wider = commit(1, [mum, sis, ex, bro]);
const edited = pinTo(prof(3, [anchor, L1], wider), A2, early), onward = pinTo(prof(4, [anchor, L1, rotation(A2, A3, wider)], wider), A3, edited);
console.log('§3.6 — two limits a reader cannot escape, and the only exit\n');
console.log(`  a cold reader meets his branch first  ${say(coldRead)} — it follows him, adopting ${size(cold.recoveryLists[2])} at index 2`);
console.log(`  alice's real profile then reads       ${say(c7)}`);
console.log('  The real Alice is the one it rejects, and nothing in the protocol repairs that.\n');
console.log('  a list change reaches other readers only through a link (§3.5):');
console.log(`  alice adds bro at the same chain length   the pinned reader still holds ${size(edited.recoveryLists[2])} at length 2`);
console.log(`  she rotates, and the new length carries it   now ${size(onward.recoveryLists[3])} at length 3\n`);
console.log('  the exit (§3.1): a person hands the reader the key her chain currently ends on — A3 — and');
console.log(`  it MUST follow the branch whose chain contains it. hers does: ${alice.chain.some((h) => h.key === A3.x)}; his does not: ${served.chain.some((h) => h.key === A3.x)}.`);
console.log('  Through a person, never through the host. See examples/first-contact/. (src/reader.js has no\n  such path yet; this line checks only which chain contains the key.)\n');
assert.deepEqual([cold.recoveryLists[2], got(c7), edited.recoveryLists[2], onward.recoveryLists[3]], [his, ['identity', 'the chain of key changes does not hold'], family, wider]);
assert.ok(alice.chain.some((h) => h.key === A3.x) && !served.chain.some((h) => h.key === A3.x));

console.log('Every line above is asserted.');
