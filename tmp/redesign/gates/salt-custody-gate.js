// salt-custody-gate: the recovery list is committed as H(salt || members) and a restore reveals
// {salt, members}. Who holds the salt? Three custody models of the same scheme, each tried
// against Grandma (lost her only phone), the ex (still listed, k=1), and the enumerating attacker.
// Kill criteria: a custody model under which Grandma restores with no backup AND a listed member
// cannot restore alone; an enumeration that recovers a salted list.
import { makeKey, H, rawSign, rawOK, commit, mkRec, walkChain } from './lastline.js';

const G = makeKey('genesis'), A = makeKey('A, lost with the phone'), B = makeKey('B, the new phone'), X = makeKey('X, the ex\'s new key');
const names = ['mum', 'dad', 'sister', 'brother', 'gran', 'grandad', 'aunt jo', 'uncle pete', 'cousin a', 'cousin b', 'cousin c', 'niece', 'nephew', 'in-law 1', 'in-law 2', 'best friend', 'neighbour', 'godmother', 'the ex', 'the ex\'s brother'];
const family = names.map((n) => makeKey(n));
const mum = family[0], ex = family[18];
const hopMsg = (from, to) => `${from.x}->${to.x}`;
const base = (recovery, hop) => ({ genesis: G.x, pseq: 4, recovery, chain: [{ key: G.x, by: 'genesis' }, { key: A.x, by: 'rotation', sig: rawSign(hopMsg(G, A), G) }, hop] });

// ---- model 1: the salt is the owner's alone (what inventory-keys-exp.js Issue 4 assumes) ----
const salt = 'owner-salt-on-the-lost-phone';
const recOwner = mkRec(1, salt, [mum.x, ex.x]);
const ownerHop = (to, voucher, s) => ({ key: to.x, by: 'restore', salt: s, members: [mum.x, ex.x], vouchers: [{ key: voucher.x, sig: rawSign(hopMsg(A, to), voucher) }] });
const grandmaOwnerOnly = walkChain(base(recOwner, ownerHop(B, mum, 'whatever the new phone guesses'))).ok;
const exOwnerOnly = walkChain(base(recOwner, ownerHop(X, ex, 'whatever the ex guesses'))).ok;

// ---- model 2: every member is given the salt so any of them can restore ----
const grandmaShared = walkChain(base(recOwner, ownerHop(B, mum, salt))).ok;
const exShared = walkChain(base(recOwner, ownerHop(X, ex, salt))).ok;

// ---- model 3: one leaf per member, H(salt_i || key_i); a voucher reveals only its own salt ----
const leaf = (s, x) => H(Buffer.from(`${s}|${x}`));
const leafCommit = (k, leaves) => H(Buffer.from(`${k}|${[...leaves].sort().join('|')}`));
const salts = new Map(family.map((m) => [m.x, `salt-for-${m.name}`]));
const leafRec = (k, members) => ({ k, commit: leafCommit(k, members.map((m) => leaf(salts.get(m.x), m.x))), leaves: members.map((m) => leaf(salts.get(m.x), m.x)) });
const leafHop = (to, vouchers) => ({ key: to.x, by: 'restore', vouchers: vouchers.map((v) => ({ key: v.x, salt: salts.get(v.x), sig: rawSign(hopMsg(A, to), v) })) });
const leafOK = (rec, hop, from) => leafCommit(rec.k, rec.leaves) === rec.commit && hop.vouchers.length >= rec.k
  && hop.vouchers.every((v) => rec.leaves.includes(leaf(v.salt, v.key)) && rawOK(hopMsg(from, { x: hop.key }), v.sig, v.key));
const recV3 = leafRec(1, [mum, ex]), recV4 = leafRec(1, [mum]);
const grandmaLeaf = leafOK(recV3, leafHop(B, [mum]), A);
const exLeafV3 = leafOK(recV3, leafHop(X, [ex]), A);
const exLeafV4 = leafOK(recV4, leafHop(X, [ex]), A);
const revealedLeaf = leafHop(B, [mum]).vouchers.length, revealedShared = ownerHop(B, mum, salt).members.length;

// ---- the enumerating attacker: every subset of up to four known keys ----
function* subsets(arr, maxSize) {
  for (let size = 1; size <= maxSize; size++) {
    const idx = Array.from({ length: size }, (_, i) => i);
    for (;;) {
      yield idx.map((i) => arr[i]);
      let i = size - 1; while (i >= 0 && idx[i] === arr.length - size + i) i--;
      if (i < 0) break;
      idx[i]++; for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
    }
  }
}
const crack = (target, fn) => { let tried = 0; for (const s of subsets(family, 4)) { tried++; if (fn(s) === target) return { found: s.map((m) => m.name), tried }; } return { found: null, tried }; };
const unsaltedTarget = commit('', [mum.x, ex.x]);
const cUnsalted = crack(unsaltedTarget, (s) => commit('', s.map((m) => m.x)));
const cShared = crack(recOwner.commit, (s) => commit('', s.map((m) => m.x)));
const cLeaf = crack(recV3.commit, (s) => leafCommit(1, s.map((m) => leaf('', m.x))));

const models = [
  ['owner-only salt', grandmaOwnerOnly, !exOwnerOnly],
  ['salt shared with members', grandmaShared, !exShared],
  ['per-member leaf', grandmaLeaf, !exLeafV3],
];
console.log('  custody model              Grandma restores (no backup)   listed ex blocked (k=1)   revealed on restore');
for (const [name, g, blocked] of models) console.log(`  ${name.padEnd(26)} ${String(g).padEnd(30)} ${String(blocked).padEnd(25)} ${name.startsWith('per') ? revealedLeaf : revealedShared} member(s)`);
console.log(`  enumeration over ${family.length} known keys, subsets of up to 4: unsalted found in ${cUnsalted.tried} guesses; shared-salt ${cShared.found ? 'FOUND' : 'not found'} in ${cShared.tried.toLocaleString()}; leaf ${cLeaf.found ? 'FOUND' : 'not found'} in ${cLeaf.tried.toLocaleString()}\n`);

const gate = [
  ['owner-only salt: Grandma, who lost the phone the salt was on, cannot be restored even by mum', !grandmaOwnerOnly],
  ['owner-only salt: the listed ex cannot restore either — but only because nobody can', !exOwnerOnly],
  ['shared salt: Grandma is restored by mum', grandmaShared],
  ['shared salt: the listed ex restores himself with no prior leak — Issue 4 Case 1\'s premise is false', exShared],
  ['per-member leaf: Grandma is restored by mum revealing only her own salt', grandmaLeaf],
  ['per-member leaf: the ex removed in v4 cannot restore against v4', !exLeafV4],
  ['per-member leaf: a listed member with k=1 still restores alone — nothing can stop that', exLeafV3],
  ['a restore reveals one member under the leaf model and the whole list under the shared one', revealedLeaf === 1 && revealedShared === 2],
  ['no custody model gives both "Grandma restores with no backup" and "a listed member cannot restore alone"', models.every(([, g, blocked]) => !(g && blocked))],
  [`the unsalted commitment is enumerated in ${cUnsalted.tried} guesses; the shared-salt and leaf commitments are not`, cUnsalted.found !== null && cShared.found === null && cLeaf.found === null],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('salt-custody-gate: all claims hold');
