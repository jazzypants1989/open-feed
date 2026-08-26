// §3 — the chain, the recovery list, the recovery, contests, the spoken code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSigningKey } from '../src/file.js';
import { rotation, restore, vouched, commit, walk, adoptRecoveryLists, verifyProfile, signProfile, vouches, wellFormed, MAX_LINKS, MAX_LEAVES } from '../src/profile.js';
import { spokenIndices, spokenCode } from '../src/spoken.js';

const G = newSigningKey(), K2 = newSigningKey(), K3 = newSigningKey(), T = newSigningKey();
const mum = { key: newSigningKey(), salt: 's-mum' }, sis = { key: newSigningKey(), salt: 's-sis' }, ex = { key: newSigningKey(), salt: 's-ex' };
const REC = commit([mum, sis, ex]), HIS = commit([ex]);
const prof = (version, chain, key, extra = {}) => signProfile({ anchor: G.x, version, chain, recovery: REC, locations: ['https://a.example/a'], ...extra }, key);
const honest = [{ key: G.x }, rotation(G, K2, REC), rotation(K2, K3, REC)];
const verify = (bytes, checkpoint = null) => verifyProfile(bytes, { learned: G.x, checkpoint });

test('§3.3 one link shape: a rotation by signature, a restore by vouchers, both judged by the held recovery', () => {
  assert.ok(walk({ anchor: G.x, chain: honest, recovery: REC }, adoptRecoveryLists({}, { chain: honest, recovery: REC }, 0)));
  const restored = [...honest, restore(K3, T, [mum, sis], REC)];
  const c = walk({ chain: restored, recovery: REC }, adoptRecoveryLists({}, { chain: restored, recovery: REC }, 0));
  assert.equal(c.current, T.x); assert.equal(c.restored, true);
  const oneVoucher = [...honest, restore(K3, T, [mum], REC)];
  assert.equal(walk({ chain: oneVoucher }, adoptRecoveryLists({}, { chain: oneVoucher, recovery: REC }, 0)), null, 'one of three is not a majority');
  const none = [...honest, restore(K3, T, [], commit([]))];
  assert.equal(walk({ chain: none }, adoptRecoveryLists({}, { chain: none, recovery: commit([]) }, 0)), null, 'an empty list can never restore');
  const unsigned = [{ key: G.x }, { key: K2.x, recovery: REC }];
  assert.equal(walk({ chain: unsigned }, adoptRecoveryLists({}, { chain: unsigned, recovery: REC }, 0)), null, 'neither evidence');
  const dup = [...honest, restore(K3, T, [mum, mum], REC)];
  assert.equal(vouches(K3.x, dup[3], REC), 1, 'distinct voucher keys');
});

test('§3.3 a link without its recovery is malformed; the first link must be the anchor', () => {
  assert.equal(verify(prof(1, [{ key: G.x }, rotation(G, K2)], K2)).verdict, 'contested');
  assert.equal(verify(prof(1, [{ key: K2.x }], K2)).verdict, 'contested');
  assert.equal(verify(prof(1, [{ key: G.x }], G)).verdict, 'ok');
});

test('§3.1 a profile whose anchor is not the key learned is refused before anything is verified', () => {
  assert.equal(verifyProfile(prof(1, [{ key: G.x }], G), { learned: K2.x }).why, 'not the identity this reader learned');
});

test('§3.4 rule 1: a served chain must extend the checkpoint key for key; a prefix at a higher version is a divergence', () => {
  const checkpointed = cpOf(prof(3, [honest[0], honest[1], vouched(honest[2], K2, [mum, sis])], K3));
  const forgotten = verify(prof(9, honest.slice(0, 2), K2), checkpointed);
  assert.equal(forgotten.why, 'serves a branch the recovery rejected', 'her vouched link at 2 out-votes a branch that pretends it never happened');
  const bare = cpOf(prof(3, honest, K3));
  assert.match(verify(prof(9, honest.slice(0, 2), K2), bare).why, /no majority/, 'with a bare rotation there, nobody has a majority');
});

function cpOf(bytes, checkpoint = null) {
  const r = verifyProfile(bytes, { learned: G.x, checkpoint });
  assert.equal(r.verdict, 'ok', r.why);
  return { profileVersion: r.raw.version, profileHash: r.profile.address, chain: r.raw.chain, recoveryLists: r.recoveryLists, fields: r.fields };
}

test('§3.4 rule 2–3: recoveryLists are held at every length from the first read, and a carried recovery at a held length is ignored', () => {
  const checkpoint = cpOf(prof(3, honest, K3));
  assert.deepEqual(Object.keys(checkpoint.recoveryLists), ['1', '2', '3']);
  // A forger with no key of hers: a self-vouched restore at index 2 carrying a recovery of one.
  const forged = prof(4, [honest[0], honest[1], restore(K2, T, [ex], HIS)], T, { recovery: HIS });
  assert.equal(verify(forged, checkpoint).why, 'the chain of key changes does not hold');
  assert.equal(verify(prof(4, [honest[0], restore(G, T, [ex], HIS)], T, { recovery: HIS }), checkpoint).why, 'the chain of key changes does not hold');
  // The same at the current length — an extension, not a divergence — is judged by the held recovery too.
  assert.equal(verify(prof(4, [...honest, restore(K3, T, [ex], HIS)], T, { recovery: HIS }), checkpoint).why, 'the chain of key changes does not hold');
  // A cold reader has only the carried copy, and follows it: the stated limit.
  assert.equal(verify(forged).verdict, 'ok');
});

test('§3.4 rule 4: a majority at the divergence point wins; a signature is not a vote; Alice repairs a rotation with vouchers', () => {
  const checkpoint = cpOf(prof(3, honest, K3));
  const thief = prof(4, [honest[0], honest[1], rotation(K2, T, REC)], T);   // he really holds K2
  assert.match(verify(thief, checkpoint).why, /no majority/);
  const repaired = prof(5, [honest[0], honest[1], vouched(honest[2], K2, [mum, sis])], K3);
  const after = cpOf(repaired, checkpoint);
  assert.equal(verify(thief, after).why, 'serves a branch the recovery rejected');
  // The reverse order: the reader met the thief's branch first (it extends nothing it knows: cold).
  const coldOnThief = cpOf(thief);
  assert.equal(verify(repaired, coldOnThief).verdict, 'ok', 'two of three out-votes a bare rotation even for a reader that checkpointed the thief');
  // The ex, listed, vouches for himself against her bare rotation: one of three is not a majority.
  const exAlone = prof(4, [honest[0], honest[1], restore(K2, T, [ex], REC)], T);
  assert.match(verify(exAlone, checkpoint).why, /does not hold/, 'one of three is not a majority under the held recovery');
  // The same self-vouched restore as an EXTENSION of the checkpointed chain — no divergence, so only §3.3 stands between him and the identity.
  assert.match(verify(prof(4, [...honest, restore(K3, T, [ex], REC)], T), checkpoint).why, /does not hold/, 'a listed member alone cannot extend the chain to his own key');
});

test('§3.4: a one-member list is a recovery of one', () => {
  const ONE = commit([ex]);
  const chain = [{ key: G.x }, rotation(G, K2, ONE)];
  const checkpoint = cpOf(signProfile({ anchor: G.x, version: 2, chain, recovery: ONE, locations: [] }, K2));
  const takeover = signProfile({ anchor: G.x, version: 3, chain: [chain[0], restore(G, T, [ex], ONE)], recovery: ONE, locations: [] }, T);
  assert.equal(verify(takeover, checkpoint).verdict, 'ok', 'the one listed member takes the identity at that length');
});

test('§3.3 a restore changes the key and nothing else — checked by a checkpointed reader', () => {
  const checkpoint = cpOf(prof(3, honest, K3));
  const moved = signProfile({ anchor: G.x, version: 4, chain: [...honest, restore(K3, T, [mum, sis], REC)], recovery: REC, locations: ['https://elsewhere.example/a'] }, T);
  assert.equal(verify(moved, checkpoint).why, 'a restore changed more than the key');
  const listChanged = signProfile({ anchor: G.x, version: 4, chain: [...honest, restore(K3, T, [mum, sis], REC)], recovery: HIS, locations: ['https://a.example/a'] }, T);
  assert.equal(verify(listChanged, checkpoint).why, 'a restore changed more than the key');
  const clean = signProfile({ anchor: G.x, version: 4, chain: [...honest, restore(K3, T, [mum, sis], REC)], recovery: REC, locations: ['https://a.example/a'] }, T);
  assert.equal(verify(clean, checkpoint).verdict, 'ok');
});

test('§3.3 a restore alongside a rotation in one version is still a restore: the fields may not change', () => {
  const checkpoint = cpOf(prof(3, honest, K3));
  const T2 = newSigningKey();
  const twoLinks = [...honest, restore(K3, T, [mum, sis], REC), rotation(T, T2, REC)];
  assert.equal(verify(signProfile({ anchor: G.x, version: 4, chain: twoLinks, recovery: REC, locations: ['https://elsewhere.example/a'] }, T2), checkpoint).why, 'a restore changed more than the key');
  assert.equal(verify(signProfile({ anchor: G.x, version: 4, chain: twoLinks, recovery: REC, locations: ['https://a.example/a'] }, T2), checkpoint).verdict, 'ok');
  const rotatedOnly = signProfile({ anchor: G.x, version: 4, chain: [...honest, rotation(K3, T, REC)], recovery: REC, locations: ['https://elsewhere.example/a'] }, T);
  assert.equal(verify(rotatedOnly, checkpoint).verdict, 'ok', 'a rotation may change anything');
});

test('§3.3 / §3.4 bounds: a chain past MAX_LINKS or a list past MAX_LEAVES is malformed', () => {
  const base = { anchor: G.x, version: 1, chain: [{ key: G.x }], recovery: REC, locations: [] };
  assert.ok(wellFormed(base));
  assert.equal(wellFormed({ ...base, recovery: { leaves: Array(MAX_LEAVES + 1).fill('x') } }), false);
  assert.ok(wellFormed({ ...base, recovery: { leaves: Array(MAX_LEAVES).fill('x') } }));
  let chain = [{ key: G.x }], from = G;
  while (chain.length <= MAX_LINKS) { const to = newSigningKey(); chain.push(rotation(from, to, REC)); from = to; }
  assert.equal(chain.length, MAX_LINKS + 1);
  assert.equal(wellFormed({ ...base, chain }), false);
  assert.ok(wellFormed({ ...base, chain: chain.slice(0, MAX_LINKS) }));
  assert.equal(verify(prof(1, [{ key: G.x }], G, { recovery: { k: 2, leaves: [] } })).verdict, 'ok', 'an unknown member on the list is ignored (§2.5)');
});

test('§3.4 outside a divergence: version never goes backwards, and the same version at another address is contested', () => {
  const checkpoint = cpOf(prof(3, honest, K3));
  assert.equal(verify(prof(2, honest, K3), checkpoint).why, 'an older profile than the one this reader saw');
  assert.match(verify(prof(3, honest, K3, { name: 'Alice' }), checkpoint).why, /two profiles at one version/);
});

test('§3.7 the spoken code: six 11-bit indices, B.12 reproduces, and two branches of one identity share it', () => {
  assert.deepEqual(spokenIndices('KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y'), [1991, 1056, 613, 530, 955, 1997]);
  assert.equal(spokenCode('KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y').join(' '), 'wedding lottery erosion drastic jazz whale');
  assert.deepEqual(spokenIndices(G.x), spokenIndices(G.x));
  assert.notDeepEqual(spokenIndices(K3.x), spokenIndices(T.x), 'over the current keys the branches differ');
});
