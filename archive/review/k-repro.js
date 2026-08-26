// Independent reproduction of FINDINGS.md §1.1 (a) and (b) against src/ only, plus the same two
// cases against the second reader (examples/weekend-reader/weekend-reader.js), plus a probe of
// the proposed fix's edge cases. Read-only: touches nothing tracked.
import { newSigningKey } from '../../src/file.js';
import { commit, restore, rotation, vouched, signProfile, verifyProfile, vouches } from '../../src/profile.js';
import { read as weekendRead } from '../../examples/weekend-reader/weekend-reader.js';
import { signIndex } from '../../src/index.js';

const AT = 'https://alice.example/alice';
const person = (n) => ({ key: newSigningKey(), salt: `salt-${n}` });
const prof = (fields, key) => signProfile({ locations: [AT], ...fields }, key);
const short = (x) => x.slice(0, 8);
const say = (r) => (r.verdict === 'ok' ? `ok  current=${short(r.chain.current)}` : `${r.verdict}: ${r.why}`);

// Both readers, same bytes: src/ takes bytes directly; the weekend reader takes a `get`.
async function bothReaders(label, alice, v1bytes, v2bytes, forgerKey) {
  // src/
  const pin1 = verifyProfile(v1bytes, { learned: alice.x });
  const srcPin = { chain: pin1.raw.chain, recoveryLists: pin1.recoveryLists, profileVersion: pin1.raw.version, profileHash: pin1.profile.address, fields: pin1.fields };
  const src2 = verifyProfile(v2bytes, { learned: alice.x, pin: srcPin });
  // weekend reader: profile only; an absent index is a note, not a verdict
  const files = new Map([[`${AT}/profile`, v1bytes], [`${AT}/index`, signIndex({ entries: [], version: 1, top: 0 }, alice)]]);
  const get = async (p) => files.get(p) ?? null;
  const w1 = await weekendRead(get, { learned: alice.x, at: AT });
  files.set(`${AT}/profile`, v2bytes);
  files.set(`${AT}/index`, signIndex({ entries: [], version: 2, top: 0 }, forgerKey));   // the forger re-signs the index under his key (§4.6)
  const w2 = await weekendRead(get, { learned: alice.x, at: AT, pin: w1.pin });
  console.log(`${label}`);
  console.log(`  src/profile.js   pinned v1 -> ${pin1.verdict}; served forged v2 -> ${say(src2)}`);
  console.log(`  weekend-reader   pinned v1 -> ${w1.verdict}; served forged v2 -> ${w2.verdict === 'ok' ? `ok  current=${short(w2.chain.current)}` : `${w2.verdict}: ${w2.why}`}`);
  return { src2, w2 };
}

// ---------------- (a) k = 0 ----------------
{
  const alice = newSigningKey(), thief = newSigningKey();
  const REC = { k: 0, leaves: [] };
  const v1 = prof({ anchor: alice.x, version: 1, name: 'Alice', chain: [{ key: alice.x }], recovery: REC }, alice);
  // The thief holds NO key of Alice's. He appends his own key: no sig, no vouchers.
  const v2 = prof({ anchor: alice.x, version: 2, name: 'Alice', chain: [{ key: alice.x }, { key: thief.x, recovery: REC }], recovery: REC }, thief);
  const { src2, w2 } = await bothReaders('(a) k = 0, leaves = []; thief appends an unsigned, unvouched link', alice, v1, v2, thief);
  console.log(`  thief key = ${short(thief.x)}; src follows thief: ${src2.verdict === 'ok' && src2.chain.current === thief.x}; weekend follows thief: ${w2.verdict === 'ok' && w2.chain.current === thief.x}`);
  // Cold reader too
  const cold = verifyProfile(v2, { learned: alice.x });
  console.log(`  cold src reader on forged v2 -> ${say(cold)}\n`);
}

// ---------------- (b) k = 1 of 3 ----------------
{
  const alice = newSigningKey(), mum = person('mum'), sis = person('sis'), ex = person('ex');
  const REC = commit(1, [mum, sis, ex]);
  const v1 = prof({ anchor: alice.x, version: 1, name: 'Alice', chain: [{ key: alice.x }], recovery: REC }, alice);
  // The ex holds no key of Alice's; his own key is `ex.key`. He restores to it, vouched by himself.
  const v2 = prof({ anchor: alice.x, version: 2, name: 'Alice', chain: [{ key: alice.x }, restore(alice, ex.key, [ex], REC)], recovery: REC }, ex.key);
  const { src2, w2 } = await bothReaders('(b) k = 1 of [mum, sis, ex]; the ex restores to his own key, vouched only by himself', alice, v1, v2, ex.key);
  console.log(`  ex key = ${short(ex.key.x)}; src follows ex: ${src2.verdict === 'ok' && src2.chain.current === ex.key.x}; weekend follows ex: ${w2.verdict === 'ok' && w2.chain.current === ex.key.x}`);
  console.log(`  vouches counted at the link: ${vouches(alice.x, v2 && restore(alice, ex.key, [ex], REC), REC)} of ${REC.leaves.length} leaves, k = ${REC.k}\n`);

  // The same list, but Alice rotated first so there IS a split: does §3.6 catch it there?
  const A2 = newSigningKey();
  const herV2 = prof({ anchor: alice.x, version: 2, name: 'Alice', chain: [{ key: alice.x }, rotation(alice, A2, REC)], recovery: REC }, A2);
  const pin1 = verifyProfile(v1, { learned: alice.x });
  const pinObj = { chain: pin1.raw.chain, recoveryLists: pin1.recoveryLists, profileVersion: 1, profileHash: pin1.profile.address, fields: pin1.fields };
  const her = verifyProfile(herV2, { learned: alice.x, pin: pinObj });
  const pin2 = { chain: her.raw.chain, recoveryLists: her.recoveryLists, profileVersion: 2, profileHash: her.profile.address, fields: her.fields };
  const his = verifyProfile(prof({ anchor: alice.x, version: 3, name: 'Alice', chain: [{ key: alice.x }, restore(alice, ex.key, [ex], REC)], recovery: REC }, ex.key), { learned: alice.x, pin: pin2 });
  console.log(`  contrast: reader pinned AFTER her rotation, then served his self-vouched branch -> ${say(his)}`);
  console.log(`  (so the majority rule works at a split; the defect is that no split is needed)\n`);
}

// ---------------- (c) k >= 1 alone is not enough: k = 1 of 2 ----------------
{
  const alice = newSigningKey(), mum = person('mum'), ex = person('ex');
  const REC = commit(1, [mum, ex]);
  const v1 = prof({ anchor: alice.x, version: 1, name: 'Alice', chain: [{ key: alice.x }], recovery: REC }, alice);
  const v2 = prof({ anchor: alice.x, version: 2, name: 'Alice', chain: [{ key: alice.x }, restore(alice, ex.key, [ex], REC)], recovery: REC }, ex.key);
  await bothReaders('(c) k = 1 of [mum, ex] (so "MUST k >= 1" alone would not close it)', alice, v1, v2, ex.key);
  console.log();
}

// ---------------- (d) proposed fix, edge-case table (pure arithmetic) ----------------
console.log('(d) proposed rule "valid iff vouches >= k AND vouches*2 > leaves.length" — edge cases');
const rule = (v, k, n) => v >= k && v * 2 > n;
const cur = (v, k, n) => v >= k;
const rows = [
  ['k=0, leaves=0, 0 vouch', 0, 0, 0], ['k=1, leaves=0, 0 vouch', 0, 1, 0], ['k=1, leaves=1, 1 vouch', 1, 1, 1],
  ['k=1, leaves=2, 1 vouch', 1, 1, 2], ['k=1, leaves=2, 2 vouch', 2, 1, 2], ['k=1, leaves=3, 1 vouch', 1, 1, 3],
  ['k=1, leaves=3, 2 vouch', 2, 1, 3], ['k=2, leaves=3, 2 vouch (B.5)', 2, 2, 3], ['k=2, leaves=4, 2 vouch', 2, 2, 4],
  ['k=3, leaves=4, 3 vouch', 3, 3, 4], ['k=5, leaves=3, 3 vouch (k > n)', 3, 5, 3], ['k=0, leaves=3, 2 vouch', 2, 0, 3],
];
for (const [l, v, k, n] of rows) console.log(`  ${l.padEnd(34)} today: ${String(cur(v, k, n)).padEnd(5)}  proposed: ${rule(v, k, n)}`);

// ---------------- (e) a leaf that is the current key itself ----------------
{
  const alice = newSigningKey(), mum = person('mum');
  const self = { key: alice, salt: 'salt-self' };
  const REC = commit(2, [mum, self]);       // owner lists herself — §3.4 allows "a backup key you keep yourself"
  const A2 = newSigningKey();
  // A restore vouched by mum and by the anchor key itself (the key being moved AWAY from)
  const link = restore(alice, A2, [mum, self], REC);
  console.log(`\n(e) owner's own current key on the list, restoring away from it: vouches = ${vouches(alice.x, link, REC)} of ${REC.leaves.length}; proposed rule -> ${rule(vouches(alice.x, link, REC), REC.k, REC.leaves.length)}`);
  // ... and the same when the thief holds that key: his stolen key vouches for himself
  const thief2 = newSigningKey();
  const stolen = vouched(rotation(alice, thief2, REC), alice, [self]);
  console.log(`    a thief holding that key: rotation + self-voucher -> vouches ${vouches(alice.x, stolen, REC)} of ${REC.leaves.length}; majority at a split? ${vouches(alice.x, stolen, REC) * 2 > REC.leaves.length}`);
}

// ---------------- (f) does a verifying hub (§8.4) stop the forged profile on PUT? ----------------
{
  const { createHub } = await import('../../src/hub.js');
  const alice = newSigningKey(), thief = newSigningKey();
  const REC = { k: 0, leaves: [] };
  const hub = createHub();
  const v1 = prof({ anchor: alice.x, version: 1, chain: [{ key: alice.x }], recovery: REC }, alice);
  const v2 = prof({ anchor: alice.x, version: 2, chain: [{ key: alice.x }, { key: thief.x, recovery: REC }], recovery: REC }, thief);
  const r1 = hub.handle({ method: 'PUT', path: '/alice/profile', headers: {}, body: v1 });
  const r2 = hub.handle({ method: 'PUT', path: '/alice/profile', headers: { 'if-match': r1.headers.etag }, body: v2 });
  console.log(`\n(f) verifying hub: PUT honest v1 -> ${r1.status}; PUT thief's unsigned-link v2 with the etag -> ${r2.status} (200 = stored)`);
}
