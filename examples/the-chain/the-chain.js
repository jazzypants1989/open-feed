// §3.3 — the chain: one link shape carrying the identity from the anchor key to the key in use now.
// A rotation is signed by the key it replaces; a restore is vouched by the recovery list.
// Run: node examples/the-chain/the-chain.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, verifyFile, signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, vouched, vouches, walk, adoptRecoveryLists, verifyProfile, signProfile } from '../../src/profile.js';

// Appendix B's keys and salts, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored');
const MUM = { key: key('mum'), salt: 'saltmum' }, SIS = { key: key('sis'), salt: 'saltsis' }, BRO = { key: key('bro'), salt: 'saltbro' };
const REC = commit([MUM, SIS, BRO]);
const base = { anchor: A1.x, name: 'Alice', recovery: REC, locations: ['https://alice.example/alice'], read: 'cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc' };

// The only cryptography here: Ed25519 over ASCII bytes. Everything else is bookkeeping.
const signOver = (text, k) => crypto.sign(null, Buffer.from(text, 'ascii'), k.privateKey).toString('base64url');
const holds = (chain, lists) => !!walk({ chain }, lists);
const brief = (h) => (`key ${h.key.slice(0, 8)}…  ` + (h.recovery ? `recovery {${h.recovery.leaves.length} leaves}  ` : '').padEnd(30)
  + (h.sig ? `sig ${h.sig.slice(0, 8)}…  ` : '').padEnd(16) + (h.vouchers ? `vouchers ${h.vouchers.map((v) => v.salt.slice(4)).join(', ')}` : '')).trimEnd();

const rot = rotation(A1, A2, REC);                          // a rotation: the owner moved
const res = restore(A2, A3, [MUM, SIS], REC);               // a restore: the owner's people moved them
const chain1 = [{ key: A1.x }], chain2 = [...chain1, rot], chain3 = [...chain2, res];

console.log('§3.3 — the chain runs from the anchor key to the key in use now\n');
console.log(`  length 1   ${brief(chain1[0])}`);
console.log(`  length 2   ${brief(chain2[1])}`);
console.log(`  length 3   ${brief(chain3[2])}`);
console.log('\n  The first link MUST be {"key": <anchor>} and its key MUST equal `anchor`. Every later');
console.log('  link has one shape and differs only in whether it carries `sig`, `vouchers`, or both.\n');
assert.deepEqual([chain1[0].key, Object.keys(chain1[0]), chain2[1].sig !== undefined, chain2[1].vouchers, chain3[2].sig, chain3[2].vouchers.length],
  [base.anchor, ['key'], true, undefined, undefined, 2]);
assert.ok(holds(chain1, {}) && holds(chain2, { 1: REC }) && holds(chain3, { 1: REC, 2: REC }));

// §3.3: the signed bytes are the two keys and an arrow, in ASCII, in that order.
const moved = `${A1.x}->${A2.x}`;
const backwards = [...chain1, { ...rot, sig: signOver(`${A2.x}->${A1.x}`, A1) }];
const elsewhere = [...chain1, { ...rot, sig: signOver(`${A3.x}->${A2.x}`, A3) }];
console.log('§3.3 — a rotation is signed by the key it replaces\n');
console.log(`  the bytes signed   ${moved}`);
console.log(`  sig                ${rot.sig}`);
console.log(`\n  ${moved.length} ASCII bytes — the previous key, "->", the new key, both base64url — signed by alice's`);
console.log('  anchor key, the one this link moves AWAY from. That is the link in Appendix B.4, and its');
console.log('  signature line is read by §2.1\'s rule: 86 characters that re-encode to themselves.\n');
console.log(`  chain holds?              ${holds(chain2, { 1: REC })}`);
console.log(`  bytes the other way       ${holds(backwards, { 1: REC })}   a signature over "<new>-><previous>" is not this link`);
console.log(`  a different previous key  ${holds(elsewhere, { 1: REC })}   a good signature, over a move the chain does not make\n`);
assert.equal(rot.sig, 'nWLFgpsi0aH7-kK-6p8OCOOlIRmI5VMRdOq0oiE3WuDjVxet2prcYFdQMLcmDI-r74mZGEnYxLe3k0Fi3rBUDA');
assert.deepEqual([rot.sig, rot.sig.length, holds(backwards, { 1: REC }), holds(elsewhere, { 1: REC })], [signOver(moved, A1), 86, false, false]);

// §3.3: `vouchers` are signatures over the SAME bytes, counted against the recovery list.
const bro = (salt) => ({ key: BRO.key.x, salt, sig: signOver(`${A2.x}->${A3.x}`, BRO.key) });
const counts = (vouchers) => vouches(A2.x, { key: A3.x, vouchers }, REC);
const twice = [...chain2, { ...res, vouchers: [res.vouchers[0], res.vouchers[0]] }];
console.log('§3.3 — a restore carries vouchers over the same bytes\n');
console.log(`  the bytes signed   ${A2.x.slice(0, 8)}…->${A3.x.slice(0, 8)}…   the same shape, one link further on`);
for (const [m, v] of [[MUM, res.vouchers[0]], [SIS, res.vouchers[1]]]) {
  const leaf = crypto.createHash('sha256').update(`${v.salt}|${v.key}`).digest('base64url');
  console.log(`  ${v.salt.slice(4)}   salt ${v.salt}   sig ${v.sig.slice(0, 12)}…   SHA-256(salt|key) ${leaf.slice(0, 8)}… on the list: ${REC.leaves.includes(leaf)}`);
  assert.deepEqual([v.key, REC.leaves.includes(leaf)], [m.key.x, true]);
}
console.log(`  distinct voucher keys that count: ${counts(res.vouchers)} of ${REC.leaves.length} — more than half, so the link is valid.\n`);
console.log(`  bro, good signature, wrong salt    ${counts([bro('notmysalt')])}   SHA-256("notmysalt|<bro>") is not in recovery.leaves`);
console.log(`  bro, good signature, his own salt  ${counts([bro('saltbro')])}   the signature was never the question`);
console.log(`  mum's voucher, listed twice        ${counts([res.vouchers[0], res.vouchers[0]])}   DISTINCT keys — so the chain holds? ${holds(twice, { 1: REC, 2: REC })}\n`);
assert.deepEqual([res.vouchers[0].sig, res.vouchers[1].sig, REC.leaves[0]],                      // Appendix B.5 and B.2
  ['zlSag21icaKQIgVI-iopptghcCruIYne8uv1aI9P94VOSm-CoFQ3e44Ajp5zR0DPmvCwl3KJNKbJgCyFi-ZxBg',
    'ttyqfT-I4auqFG0udf45r76o5gavmZEnStB0E5oAcQAKIAYNpkJRz9LjIqJfu8ZiolEB9Gtabq9w-RYtVOIHDw',
    'WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4']);
assert.deepEqual([counts(res.vouchers), counts([bro('notmysalt')]), counts([bro('saltbro')]), holds(twice, { 1: REC, 2: REC })], [2, 0, 1, false]);

// §3.3: `recovery` is REQUIRED on every link, because a cold reader has no other copy of it.
const cold = adoptRecoveryLists({}, { chain: chain3, recovery: REC }, 0);
console.log('§3.3 — every link carries the recovery list as it stood before it\n');
console.log('  a reader meeting alice for the first time at chain length 3 holds no list at 1 or 2:');
console.log(`  walk with a list at length 1 only   ${walk({ chain: chain3 }, { 1: REC })}   nothing to judge the restore by`);
console.log(`  lists adopted from the chain        lengths ${Object.keys(cold).join(', ')}, all the same list`);
console.log(`  walk again                          current key ${walk({ chain: chain3 }, cold).current.slice(0, 8)}…`);
console.log('\n  The carried copy is what a reader with NO list at that length adopts; a reader already');
console.log('  holding one ignores it (§3.6 rule 3). The list itself is `examples/recovery-list/`;');
console.log('  what happens when two chains disagree is `examples/contest/`.\n');
assert.deepEqual([walk({ chain: chain3 }, { 1: REC }), Object.keys(cold)], [null, ['1', '2', '3']]);
assert.ok(Object.values(cold).every((l) => JSON.stringify(l) === JSON.stringify(REC)));

// §3.3: vouchers MAY be added to a link after it was made.
const backed = vouched(rot, A1, [MUM, SIS]);
console.log('§3.3 — vouchers may be added to a link after it was made\n');
console.log(`  the rotation alice made alone   ${brief(rot)}`);
console.log(`  backed later by her people      ${brief(backed)}`);
console.log(`  same key moved to: ${backed.key === rot.key}, same sig: ${backed.sig === rot.sig}, vouchers that now count: ${vouches(A1.x, backed, REC)}`);
console.log('\n  Nothing after this link is disturbed. That is what lets her win a contest AT that link');
console.log('  (§3.6) without restoring again and abandoning every key and post that came after it.\n');
assert.deepEqual([backed.key, backed.sig, vouches(A1.x, backed, REC)], [rot.key, rot.sig, 2]);
assert.ok(holds([...chain1, backed], { 1: REC }));

// §3.3: a link with no `sig` MUST NOT arrive with a change to locations, recovery, name or read.
const v2 = verifyProfile(signProfile({ ...base, version: 2, chain: chain2 }, A2), { learned: A1.x, pin: null });
const pin = { profileVersion: v2.raw.version, profileHash: v2.profile.address, chain: v2.raw.chain, recoveryLists: v2.recoveryLists, fields: v2.fields };
const served = (fields) => verifyProfile(signProfile({ ...base, ...fields, version: 3, chain: chain3 }, A3), { learned: A1.x, pin });
const moveHome = served({ locations: ['https://elsewhere.example/alice'] });
console.log('§3.3 — a restore changes the key and nothing else\n');
console.log(`  pinned at version 2   chain length ${pin.chain.length}, locations ${JSON.stringify(base.locations)}`);
console.log('  served version 3      chain length 3, the new link unsigned — a restore');
console.log(`    locations unchanged                    ${served({}).verdict}`);
console.log(`    locations changed in the same version  ${moveHome.verdict}   ${moveHome.why}`);
console.log('\n  Whoever vouched moved the key. They did not move the identity to a hub of their own.\n');
assert.equal(served({}).verdict, 'ok');
for (const f of [{ locations: ['https://elsewhere.example/alice'] }, { name: 'Alise' }, { read: A2.x }, { recovery: commit([MUM, SIS]) }])
  assert.deepEqual([served(f).verdict, served(f).why], ['identity', 'a restore changed more than the key']);

// §3.3: the old key is closed by what it may no longer do, not by an announcement.
const post1 = signFile({ n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const stale = signFile({ entries: [], version: 4, top: 0 }, A2);
const now = walk({ chain: chain3 }, cold);
console.log('§3.3 — a key rotated away from keeps its posts valid\n');
console.log(`  post 1, signed by the anchor key, verified under the chain's keys:  by ${verifyFile(post1, now.keys).by.slice(0, 8)}…`);
console.log(`  the chain now ends on ${now.current.slice(0, 8)}…, and the anchor is still in it: ${now.keys.includes(A1.x)}`);
console.log('\n  There is no revocation message anywhere in Open Feed. The old key is closed by what it may');
console.log('  no longer do: it cannot sign an index (§4.6 — the index MUST be signed by the key the chain');
console.log('  currently ends on; `examples/the-index/`) and it cannot hold a number against the owner (§8.5).\n');
assert.equal(verifyFile(post1, now.keys).by, A1.x);
assert.deepEqual([now.current, now.restored], [A3.x, true]);

// §3.5: the two writes, in order.
console.log('§3.5 — changing the key means writing the profile and the index again, in that order\n');
console.log(`  an index signed by the key alice just left, verified under the current key: ${verifyFile(stale, now.current)}`);
console.log('\n  The index MUST be signed by the current key (§4.6), and a hub that verifies writes checks the');
console.log('  index against the profile it holds (§8.4) — so the profile goes first. Between the two writes');
console.log('  an honest host serves an index its own profile disowns; §7.2 answers that (not an accusation).\n');
assert.equal(verifyFile(stale, now.current), null);

console.log('Every line above is asserted.');
