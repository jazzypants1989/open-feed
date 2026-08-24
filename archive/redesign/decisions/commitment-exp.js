// Review findings B4 and B5 — ruling 6 commits the recovery list as a fingerprint "revealed only
// when a restore happens". The ex knows every key in the family. Can he read the list anyway?
// And how many of the named people does it take to restore her?
import crypto from 'node:crypto';

const mk = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k.name = n; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64url');

// Twenty people in the family, all of whose public keys the ex has — they are published in profiles.
const family = ['mum', 'dad', 'sister', 'brother', 'gran', 'grandad', 'aunt jo', 'uncle pete', 'cousin a', 'cousin b',
  'cousin c', 'niece', 'nephew', 'in-law 1', 'in-law 2', 'best friend', 'neighbour', 'godmother', 'ex (Bob)', 'Bob\'s brother'].map(mk);
const alicesList = [family[0], family[2]];   // mum and sister

// As in recovery-exp.js: the fingerprint is sha256 of the sorted keys.
const unsalted = (keys) => sha([...keys.map(pub)].sort().join('|'));
// With a salt Alice's app chose at random and keeps beside the list:
const salt = crypto.randomBytes(16).toString('base64url');
const salted = (keys, s) => sha(s + '|' + [...keys.map(pub)].sort().join('|'));

function* subsets(arr, maxSize) {
  const n = arr.length;
  for (let size = 1; size <= maxSize; size++) {
    const idx = Array.from({ length: size }, (_, i) => i);
    for (;;) {
      yield idx.map((i) => arr[i]);
      let i = size - 1; while (i >= 0 && idx[i] === n - size + i) i--;
      if (i < 0) break;
      idx[i]++; for (let j = i + 1; j < size; j++) idx[j] = idx[j - 1] + 1;
    }
  }
}

const crack = (target, fn) => {
  let tried = 0; const t0 = process.hrtime.bigint();
  for (const s of subsets(family, 4)) { tried++; if (fn(s) === target) return { found: s.map((k) => k.name), tried, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; }
  return { found: null, tried, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
};

console.log('\nB4 — can the ex read the committed recovery list?\n');
const u = crack(unsalted(alicesList), unsalted);
console.log(`  unsalted fingerprint   ${u.found ? `RECOVERED: [${u.found.join(', ')}]` : 'not found'}   after ${u.tried.toLocaleString()} subsets of ≤4, ${u.ms.toFixed(0)} ms`);
const s = crack(salted(alicesList, salt), (keys) => salted(keys, ''));   // he does not know the salt
console.log(`  salted fingerprint     ${s.found ? `RECOVERED: [${s.found.join(', ')}]` : 'not found'}   after ${s.tried.toLocaleString()} subsets, ${s.ms.toFixed(0)} ms — he would need the salt`);
console.log(`
  The list is drawn from keys he already holds, so an unsalted fingerprint hides nothing from the
  one adversary the design is about. Sixteen random bytes beside the list fix it; neither recovery
  experiment included them.

B5 — how many of the named people does a restore take?
`);
// recovery-exp.js's rule, verbatim in spirit: profileList.some((k) => signers.includes(k))
const some = (list, signers) => list.some((k) => signers.includes(k));
const atLeast = (k) => (list, signers) => list.filter((x) => signers.includes(x)).length >= k;
const mum = family[0], sister = family[2], thief = mk('whoever has mum\'s phone');
const cases = [
  ['mum alone vouches',                       [mum]],
  ['mum\'s phone is stolen; the thief vouches', [mum]],   // the thief signs with mum's key
  ['mum and sister vouch',                     [mum, sister]],
];
console.log('  who signs                                   ".some" (as staged)   k = 2');
for (const [label, signers] of cases) {
  const keys = signers.map(pub), list = alicesList.map(pub);
  console.log(`  ${label.padEnd(43)} ${(some(list, keys) ? 'restored' : 'refused').padEnd(20)} ${atLeast(2)(list, keys) ? 'restored' : 'refused'}`);
}
const commitBody = { k: 2, salt, keys: alicesList.map(pub) };
console.log(`
  recovery-exp.js's rule is ".some" — one of N. Anyone holding any named person's phone can
  restore Alice, and the 7-day flag is the only thing between that and a takeover. Making k
  explicit costs one integer inside the commitment (${JSON.stringify(commitBody).length} bytes for {k, salt, keys} with two
  names) and lets the ruling say "default 1" as a choice rather than an accident.
`);
