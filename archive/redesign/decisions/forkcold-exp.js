// Experiment C — the fork court from cold. Ruling: a contest between two branches of one identity
// is settled by a majority of the recovery list AS IT STOOD AT THE SPLIT. Who can actually run
// that rule? A reader holding only the two competing profiles; a reader who also fetches the
// history each host serves; a reader who PINNED the pre-fork profile. The thief holds key A, so
// he can re-sign every profile version back to A's first.
//
//   node tmp/redesign/decisions/forkcold-exp.js
import { makeKey, sign, open, address, rawSign, rawOK, rotHop } from '../gates/lastline.js';

const G = makeKey('genesis'), A = makeKey('A, on the stolen phone'), B = makeKey('B, Alice\'s new key'), C = makeKey('C, the thief\'s new key');
const mum = makeKey('mum'), sister = makeKey('sister'), dad = makeKey('dad'), ex = makeKey('the ex');
const H = (s) => address(sign({ s }, G));   // any stable hash helper
const hashOf = (file) => address(file);

// Per-member recovery leaves (ruling 4): leaf = H(salt_i | key_i); a voucher reveals only its own salt.
const salts = new Map([mum, sister, dad, ex].map((m) => [m.x, `salt-for-${m.name}`]));
const leaf = (m) => address(sign({ l: `${salts.get(m.x)}|${m.x}` }, G));
const list = (members) => ({ k: 1, leaves: members.map(leaf).sort() });
const vouch = (to, m) => ({ key: m.x, salt: salts.get(m.x), sig: rawSign(`${A.x}->${to.x}`, m) });
const counts = (rec, to, vouchers) => vouchers.filter((v) => rec.leaves.includes(address(sign({ l: `${v.salt}|${v.key}` }, G))) && rawOK(`${A.x}->${to.x}`, v.sig, v.key)).length;
// Majority of the list: more than half of its N leaves vouch. N is public — the leaf array's length.
const majority = (rec, branches) => branches.filter(({ to, vs }) => counts(rec, to, vs) * 2 > rec.leaves.length).map(({ to }) => to.name);

const chain = [{ key: G.x, by: 'genesis' }, rotHop(G, A)];
const profile = (pseq, prev, recovery, extra, key) => sign({ genesis: G.x, pseq, prev, recovery, chain, ...extra }, key);
// Real history, all signed by A while Alice held it: p1 (marriage era: mum + ex), p2, p3 (ex removed).
const p1 = profile(1, null, list([mum, ex]), {}, A);
const p2 = profile(2, hashOf(p1), list([mum, ex]), {}, A);
const p3 = profile(3, hashOf(p2), list([mum, sister, dad]), {}, A);
// The split at p3. Alice (phone stolen) is restored by mum + sister; the thief rotates and rewrites the list.
const restore = { to: B, vs: [vouch(B, mum), vouch(B, sister)] };
const rot = { to: C, vs: [vouch(C, ex)] };
const pR = profile(4, hashOf(p3), list([mum, sister, dad]), { chain: [...chain, { key: B.x, by: 'restore', vouchers: restore.vs }] }, B);
const pT = profile(4, hashOf(p3), list([ex]), { chain: [...chain, rotHop(A, C)] }, C);
// The thief's rewind: he re-signs p2' and p3' with A, listing himself, and hangs his pseq 4 off p3'.
const p2x = profile(2, hashOf(p1), list([ex]), {}, A);
const p3x = profile(3, hashOf(p2x), list([ex]), {}, A);
const pTx = profile(4, hashOf(p3x), list([ex]), { chain: [...chain, rotHop(A, C)] }, C);

const rec = (f, x) => open(f, x).obj.recovery;
const branches = [restore, rot];
const verdictOf = (w) => (w.length === 1 ? `${w[0]} wins` : w.length ? 'both win' : 'nobody — contested');

// (1) Cold, two profiles only: each branch carries a different list; no way to know which stood at the split.
const eachOwn = [...majority(rec(pR, B.x), [restore]), ...majority(rec(pT, C.x), [rot])];
// (2) Cold, fetching history: Alice's host serves p3, p2, p1; the thief's host serves p3', p2', p1.
const aliceHost = [p1, p2, p3], thiefHost = [p1, p2x, p3x];
const firstShared = aliceHost.findLast((f) => thiefHost.some((g) => hashOf(g) === hashOf(f)));
const byEarliest = majority(rec(firstShared, A.x), branches);
// (3) Warm: a reader that pinned p3 judges by p3's list, and rejects p3' as a fork at pseq 3.
const byPinned = majority(rec(p3, A.x), branches);
const p3xIsFork = open(p3x, A.x).obj.pseq === 3 && hashOf(p3x) !== hashOf(p3);
// Revert-check: judge each branch by its own list.
console.log('\n  reader                                         the list it can judge by        verdict');
console.log(`  cold, holding only the two pseq-4 profiles     differs per branch              ${verdictOf(eachOwn)} (each by its own list)`);
console.log(`  cold, walking history from both hosts          last version both serve: pseq ${open(firstShared, A.x).obj.pseq}  ${verdictOf(byEarliest)} (marriage-era list: mum + ex)`);
console.log(`  warm, pinned p3 before the split               p3's list: mum, sister, dad     ${verdictOf(byPinned)}; p3' is a fork at pseq 3: ${p3xIsFork}`);
console.log(`\n  revert-check (each branch judged by its own list): ${verdictOf(eachOwn)}`);
console.log(`  majority needs N: p3 has ${rec(p3, A.x).leaves.length} leaves, so 2 vouchers carry it and the ex's 1 does not; N is public in the leaf array.`);
console.log(`
  Reading. The rule works exactly for the reader who was watching. From cold, the two profiles
  disagree about the list and nothing in either says which list stood at the split; fetching
  history does not help, because the thief holds A and has re-signed every version back to the
  one he likes, so the last version both hosts agree on is the marriage-era list — and under it
  mum and the ex cancel out. Only the reader who pinned p3 (or can ask one who did) names Alice.
  The spec owes one sentence: a fork is resolved by readers who remember; a cold reader shows
  "contested" and the name of a reader who can answer is a social question, not a protocol one.
`);
