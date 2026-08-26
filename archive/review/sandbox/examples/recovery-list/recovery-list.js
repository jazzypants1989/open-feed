// §3.4 — the recovery list: one salted leaf per member, so a voucher reveals only itself, and `k` is
// the threshold the author set for a restore. Run: node examples/recovery-list/recovery-list.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signingKeyFromSeed, sha256 } from '../../src/file.js';
import { commit, leaf, restore, rotation, vouches, walk, adoptRecoveryLists, signProfile, verifyProfile } from '../../src/profile.js';

// Appendix B's keys and salts, so every hash printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const alice = key('alice/anchor'), rotated = key('alice/rotated'), restoredKey = key('alice/restored');
const mum = { who: 'mum', key: key('mum'), salt: 'saltmum' };
const sis = { who: 'sis', key: key('sis'), salt: 'saltsis' };
const bro = { who: 'bro', key: key('bro'), salt: 'saltbro' };
const family = [mum, sis, bro];
const list = commit(2, family);
const who = (x) => family.find((m) => m.key.x === x).who;
// What a cold reader does: adopt the list every link carries, then walk (§3.3).
const walks = (links, rec) => walk({ chain: links }, adoptRecoveryLists({}, { chain: links, recovery: rec }, 0));

console.log('§3.4 — one leaf per member, each under its own salt\n');
console.log(`  ${'member'.padEnd(8)}${'salt'.padEnd(10)}${'member key'.padEnd(45)}SHA-256(salt|key)`);
for (const m of family) console.log(`  ${m.who.padEnd(8)}${m.salt.padEnd(10)}${m.key.x}  ${leaf(m.salt, m.key.x)}`);
console.log(`\n  committed  ${JSON.stringify(list)}`);
console.log('\n  That is Appendix B.2 of the spec, byte for byte.\n');
assert.deepEqual(list.leaves, ['WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4', 'wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc', 'frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ']);
assert.equal(JSON.stringify(list), '{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]}');
for (const m of family) assert.equal(leaf(m.salt, m.key.x), sha256(Buffer.from(`${m.salt}|${m.key.x}`, 'utf8')));

// Alice lost her rotated key. sis vouches for a move to a key alice made herself.
const sisOnly = restore(rotated, restoredKey, [sis], list);
const wire = JSON.stringify(sisOnly);
// An attacker holding the leaves scans the family, whose keys are public in their own profiles.
const scan = (salts) => family.filter((m) => salts.some((s) => list.leaves.includes(leaf(s, m.key.x)))).map((m) => m.who);
const unsalted = family.map((m) => sha256(Buffer.from(m.key.x, 'utf8')));
const scanBare = () => family.filter((m) => unsalted.includes(sha256(Buffer.from(m.key.x, 'utf8')))).map((m) => m.who);

console.log('§3.4 — a voucher reveals only itself\n');
console.log(`  on the wire  ${JSON.stringify(sisOnly.vouchers[0])}\n`);
console.log('  A leaf is the hash of a salt AND a key, so testing a candidate key needs that');
console.log("  member's salt. The published link carries sis's salt and no other:\n");
console.log(`  salted leaves, saltsis revealed   identifies ${scan(['saltsis']).join(', ') || 'nobody'}`);
console.log(`  salted leaves, no salt revealed   identifies ${scan([]).join(', ') || 'nobody'}`);
console.log(`  if a leaf were SHA-256(key)       identifies ${scanBare().join(', ')}`);
console.log('\n  Three family keys is a guessable space, and a bare hash of the key falls to that\n  scan in a second. The salt is what keeps the rest of the list unreadable.\n');
assert.ok(wire.includes(sis.salt) && wire.includes(sis.key.x));
for (const m of [mum, bro]) assert.ok(!wire.includes(m.salt) && !wire.includes(m.key.x), 'nothing of mum or bro is published');
assert.deepEqual([scan(['saltsis']), scan([]), scanBare()], [['sis'], [], ['mum', 'sis', 'bro']]);

console.log('§3.4 — the count of leaves is public, and MUST be\n');
console.log(`  leaves anyone can count   ${list.leaves.length}`);
console.log(`  vouchers that count       ${vouches(rotated.x, sisOnly, list)}  (sis)`);
console.log(`  more than half of 3       ${Math.floor(list.leaves.length / 2) + 1}`);
console.log('\n  A contest is settled by a majority of the recovery list at the split (§3.6). Hiding\n  the count would leave that majority with no denominator, and a forger could call his\n  one voucher a majority of a list only he can count. See examples/contest/.\n');
assert.equal(list.leaves.length, 3);
assert.equal(vouches(rotated.x, sisOnly, list), 1);
assert.ok(1 * 2 <= 3 && 2 * 2 > 3, 'one of three is not a majority; two is');

// mum joins sis, and the restore reaches k. A leaf binds both halves: mum's key under sis's salt
// hashes to nothing in the list, however good mum's signature is.
const link = restore(rotated, restoredKey, [mum, sis], list);
const mixed = restore(rotated, restoredKey, [{ key: mum.key, salt: sis.salt }], list);
const chain = [{ key: alice.x }, rotation(alice, rotated, list), link];
const profile = { anchor: alice.x, version: 3, name: 'Alice', chain, recovery: list, locations: ['https://alice.example/alice'] };
const cold = verifyProfile(signProfile(profile, restoredKey), { learned: alice.x });

console.log('§3.4 — `k` is the threshold the author set for a restore to be valid\n');
console.log(`  k                       ${list.k} of ${list.leaves.length}`);
console.log(`  sis alone               ${vouches(rotated.x, sisOnly, list)} counted — below k, so the link is not valid`);
console.log(`  mum and sis             ${vouches(rotated.x, link, list)} counted — the link is valid`);
console.log(`  mum's key, sis's salt   ${vouches(rotated.x, mixed, list)} counted — a leaf binds the salt and the key together`);
console.log(`\n  a reader over the whole profile: ${cold.verdict}, chain ending on ${cold.chain.current}\n`);
console.log('  A *contested* identity is settled not by `k` but by a majority of the list (§3.6).\n');
assert.equal(vouches(rotated.x, mixed, list), 0);
assert.equal(walks([chain[0], chain[1], sisOnly], list), null, 'one of three is below k');
assert.equal(walks(chain, list).current, restoredKey.x);
assert.ok(cold.verdict === 'ok' && cold.chain.current === restoredKey.x);

const empty = commit(1, []);
const noHope = restore(alice, restoredKey, [mum, sis], empty);
console.log('§3.4 — the list MAY be empty\n');
console.log(`  committed                 ${JSON.stringify(empty)}`);
console.log(`  mum and sis vouch anyway  ${vouches(alice.x, noHope, empty)} counted — no leaf can match an empty list`);
console.log(`  the chain walks?          ${walks([{ key: alice.x }, noHope], empty) !== null}`);
console.log('\n  The cost is exact: no restore is possible, and a lost key is a lost identity. Where\n  the list is not empty, a member can be a person, a backup key you keep yourself, or your\n  host — a leaf does not say which, and nothing outside your app knows.\n');
assert.equal(vouches(alice.x, noHope, empty), 0);
assert.equal(walks([{ key: alice.x }, noHope], empty), null);

const one = commit(1, [bro]);
const takeover = restore(alice, bro.key, [bro], one);
const held = adoptRecoveryLists({}, { chain: [{ key: alice.x }], recovery: one }, 0);
// She replaces the list with the three and rotates, so the change reaches readers (§3.5).
const later = { chain: [{ key: alice.x }, rotation(alice, rotated, list)], recovery: list };
adoptRecoveryLists(held, later, 1);
console.log('§3.4 — a list with one other person hands that person the identity\n');
console.log(`  Alice lists bro, nobody else  ${JSON.stringify(one)}`);
console.log(`  bro restores to his own key   ${vouches(alice.x, takeover, one)} of 1 counted, and k is 1`);
console.log(`  the chain walks, ending on    ${walks([{ key: alice.x }, takeover], one).current}  (bro's key)`);
console.log('\n  Now Alice replaces the list with the three and rotates so the change reaches readers\n  (§3.5). Her new link at chain length 1 carries the new list — and a reader that saw the\n  list of one there keeps it, because a list is never overwritten (§3.6 rule 2):\n');
console.log(`  her link at length 1 carries  ${JSON.stringify(later.chain[1].recovery)}`);
console.log(`  the reader still holds        ${JSON.stringify(held[1])}`);
console.log(`  at length 2, new to it        ${JSON.stringify(held[2])}`);
console.log('\n  So bro can still restore at length 1, against a list only he is on, for as long as\n  that reader exists. An app SHOULD require two or more members, or the owner alone: a\n  majority of one is one.\n');
assert.equal(vouches(alice.x, takeover, one), 1);
assert.equal(walks([{ key: alice.x }, takeover], one).current, bro.key.x);
assert.deepEqual(later.chain[1].recovery, list);
assert.deepEqual(held[1], one);
assert.deepEqual(held[2], list);

console.log('§3.4 — "recently restored" is presentation, not a verdict\n');
console.log(`  the read's verdict   ${cold.verdict}`);
console.log(`  restored             ${cold.chain.restored}   — reading apps SHOULD flag this for seven days`);
console.log('\n  who vouched, still in the chain and readable a year later:');
for (const v of cold.raw.chain[2].vouchers) console.log(`    ${who(v.key)}  salt ${v.salt}  sig ${v.sig.slice(0, 16)}...`);
console.log('\n  The three verdicts (§7.3) are ok, this host is misbehaving, and this identity is in\n  question. "Recently restored" is a note on an ok read, not a fourth verdict.\n');
assert.equal(cold.chain.restored, true);
assert.deepEqual(cold.raw.chain[2].vouchers.map((v) => v.key), [mum.key.x, sis.key.x]);
assert.equal(['ok', 'host', 'identity'].includes('recently restored'), false);

console.log('Every line above is asserted.');
