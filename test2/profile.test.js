// §4 — the chain, the recovery list, the court, contests, the spoken code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newSigningKey } from '../src2/file.js';
import { rotation, restore, vouched, commit, walk, adoptCourts, verifyProfile, signProfile, vouches } from '../src2/profile.js';
import { spokenIndices, spokenCode } from '../src2/spoken.js';

const G = newSigningKey(), K2 = newSigningKey(), K3 = newSigningKey(), T = newSigningKey();
const mum = { key: newSigningKey(), salt: 's-mum' }, sis = { key: newSigningKey(), salt: 's-sis' }, ex = { key: newSigningKey(), salt: 's-ex' };
const REC = commit(2, [mum, sis, ex]), HIS = commit(1, [ex]);
const prof = (pseq, chain, key, extra = {}) => signProfile({ genesis: G.x, pseq, chain, recovery: REC, locations: ['https://a.example/a'], ...extra }, key);
const honest = [{ key: G.x }, rotation(G, K2, REC), rotation(K2, K3, REC)];
const verify = (bytes, pin = null) => verifyProfile(bytes, { learned: G.x, pin });

test('§4.3 one hop shape: a rotation by signature, a restore by vouchers, both judged by the held court', () => {
  assert.ok(walk({ genesis: G.x, chain: honest, recovery: REC }, adoptCourts({}, { chain: honest, recovery: REC }, 0)));
  const restored = [...honest, restore(K3, T, [mum, sis], REC)];
  const c = walk({ chain: restored, recovery: REC }, adoptCourts({}, { chain: restored, recovery: REC }, 0));
  assert.equal(c.current, T.x); assert.equal(c.restored, true);
  const oneVoucher = [...honest, restore(K3, T, [mum], REC)];
  assert.equal(walk({ chain: oneVoucher }, adoptCourts({}, { chain: oneVoucher, recovery: REC }, 0)), null, 'one of three is below k');
  const unsigned = [{ key: G.x }, { key: K2.x, court: REC }];
  assert.equal(walk({ chain: unsigned }, adoptCourts({}, { chain: unsigned, recovery: REC }, 0)), null, 'neither evidence');
  const dup = [...honest, restore(K3, T, [mum, mum], REC)];
  assert.equal(vouches(K3.x, dup[3], REC), 1, 'distinct voucher keys');
});

test('§4.3 a hop without its court is malformed; the first hop must be the genesis', () => {
  assert.equal(verify(prof(1, [{ key: G.x }, rotation(G, K2)], K2)).verdict, 'identity');
  assert.equal(verify(prof(1, [{ key: K2.x }], K2)).verdict, 'identity');
  assert.equal(verify(prof(1, [{ key: G.x }], G)).verdict, 'ok');
});

test('§4.1 a profile whose genesis is not the key learned is refused before anything is verified', () => {
  assert.equal(verifyProfile(prof(1, [{ key: G.x }], G), { learned: K2.x }).why, 'not the identity this reader learned');
});

test('§4.6 rule 1: a served chain must extend the pin key for key; a prefix at a higher pseq is a split', () => {
  const pinned = pinOf(prof(3, [honest[0], honest[1], vouched(honest[2], K2, [mum, sis])], K3));
  const forgotten = verify(prof(9, honest.slice(0, 2), K2), pinned);
  assert.equal(forgotten.why, 'serves a branch the court rejected', 'her vouched hop at 2 out-votes a branch that pretends it never happened');
  const bare = pinOf(prof(3, honest, K3));
  assert.match(verify(prof(9, honest.slice(0, 2), K2), bare).why, /contested/, 'with a bare rotation there, nobody has a majority');
});

function pinOf(bytes, pin = null) {
  const r = verifyProfile(bytes, { learned: G.x, pin });
  assert.equal(r.verdict, 'ok', r.why);
  return { pseq: r.raw.pseq, phash: r.profile.address, chain: r.raw.chain, courts: r.courts, fields: r.fields };
}

test('§4.6 rule 2–3: courts are held at every length from the first read, and a carried court at a held length is ignored', () => {
  const pin = pinOf(prof(3, honest, K3));
  assert.deepEqual(Object.keys(pin.courts), ['1', '2', '3']);
  // A forger with no key of hers: a self-vouched restore at index 2 carrying a court of one.
  const forged = prof(4, [honest[0], honest[1], restore(K2, T, [ex], HIS)], T, { recovery: HIS });
  assert.equal(verify(forged, pin).why, 'the chain of key changes does not hold');
  assert.equal(verify(prof(4, [honest[0], restore(G, T, [ex], HIS)], T, { recovery: HIS }), pin).why, 'the chain of key changes does not hold');
  // The same at the current length — an extension, not a split — is judged by the held court too.
  assert.equal(verify(prof(4, [...honest, restore(K3, T, [ex], HIS)], T, { recovery: HIS }), pin).why, 'the chain of key changes does not hold');
  // A cold reader has only the carried copy, and follows it: the stated limit.
  assert.equal(verify(forged).verdict, 'ok');
});

test('§4.6 rule 4: a majority at the split wins; a signature is not a vote; Alice repairs a rotation with vouchers', () => {
  const pin = pinOf(prof(3, honest, K3));
  const thief = prof(4, [honest[0], honest[1], rotation(K2, T, REC)], T);   // he really holds K2
  assert.match(verify(thief, pin).why, /contested/);
  const repaired = prof(5, [honest[0], honest[1], vouched(honest[2], K2, [mum, sis])], K3);
  const after = pinOf(repaired, pin);
  assert.equal(verify(thief, after).why, 'serves a branch the court rejected');
  // The reverse order: the reader met the thief's branch first (it extends nothing it knows: cold).
  const coldOnThief = pinOf(thief);
  assert.equal(verify(repaired, coldOnThief).verdict, 'ok', 'two of three out-votes a bare rotation even for a reader that pinned the thief');
  // The ex, listed, vouches for himself against her bare rotation: one of three is not a majority.
  const exAlone = prof(4, [honest[0], honest[1], restore(K2, T, [ex], REC)], T);
  assert.match(verify(exAlone, pin).why, /does not hold/, 'one voucher is below k=2 under the held court');
});

test('§4.6: a one-member list is a court of one', () => {
  const ONE = commit(1, [ex]);
  const chain = [{ key: G.x }, rotation(G, K2, ONE)];
  const pin = pinOf(signProfile({ genesis: G.x, pseq: 2, chain, recovery: ONE, locations: [] }, K2));
  const takeover = signProfile({ genesis: G.x, pseq: 3, chain: [chain[0], restore(G, T, [ex], ONE)], recovery: ONE, locations: [] }, T);
  assert.equal(verify(takeover, pin).verdict, 'ok', 'the one listed member takes the identity at that length');
});

test('§4.3 a restore changes the key and nothing else — checked by a pinned reader', () => {
  const pin = pinOf(prof(3, honest, K3));
  const moved = signProfile({ genesis: G.x, pseq: 4, chain: [...honest, restore(K3, T, [mum, sis], REC)], recovery: REC, locations: ['https://elsewhere.example/a'] }, T);
  assert.equal(verify(moved, pin).why, 'a restore changed more than the key');
  const listChanged = signProfile({ genesis: G.x, pseq: 4, chain: [...honest, restore(K3, T, [mum, sis], REC)], recovery: HIS, locations: ['https://a.example/a'] }, T);
  assert.equal(verify(listChanged, pin).why, 'a restore changed more than the key');
  const clean = signProfile({ genesis: G.x, pseq: 4, chain: [...honest, restore(K3, T, [mum, sis], REC)], recovery: REC, locations: ['https://a.example/a'] }, T);
  assert.equal(verify(clean, pin).verdict, 'ok');
});

test('§4.6 outside a split: pseq never goes backwards, and the same pseq at another address is contested', () => {
  const pin = pinOf(prof(3, honest, K3));
  assert.equal(verify(prof(2, honest, K3), pin).why, 'an older profile than the one this reader saw');
  assert.match(verify(prof(3, honest, K3, { name: 'Alice' }), pin).why, /two profiles at one version/);
});

test('§4.1 the spoken code: six 11-bit indices, B.12 reproduces, and two branches of one identity share it', () => {
  assert.deepEqual(spokenIndices('KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y'), [1991, 1056, 613, 530, 955, 1997]);
  assert.equal(spokenCode('KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y').join(' '), 'wedding lottery erosion drastic jazz whale');
  assert.deepEqual(spokenIndices(G.x), spokenIndices(G.x));
  assert.notDeepEqual(spokenIndices(K3.x), spokenIndices(T.x), 'over the current keys the branches differ');
});
