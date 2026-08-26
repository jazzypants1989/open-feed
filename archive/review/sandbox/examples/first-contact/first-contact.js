// §3.1 — first contact: the two routes that carry an anchor key past the host, and the `anchor`
// check that makes them matter. Run: node examples/first-contact/first-contact.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { decodeStrict, signingKeyFromSeed, verifyFile } from '../../src/file.js';
import { commit, restore, rotation, signProfile, verifyProfile } from '../../src/profile.js';
import { spokenCode, spokenIndices } from '../../src/spoken.js';
import { WORDS } from '../../src/wordlist.js';

// Appendix B's keys, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const alice = key('alice/anchor'), rotated = key('alice/rotated'), restored = key('alice/restored');
const mum = key('mum'), sis = key('sis'), bro = key('bro');
// B.1, verbatim: the six printed keys of the spec's own test vectors.
assert.deepEqual([alice.x, rotated.x, restored.x, mum.x, sis.x, bro.x], ['pukq6VMQM9Sbp4ae71bJjcKbLLpFuWi47cDS60xH7CY', 'kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs', '17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M', '5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU', 'lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ', 'Tt-buDzctWsjDmOG9DDd3IPy-4grdRXTB1VJTds1a5Q']);

const LOC = 'https://alice.example/alice';
const MEMBERS = [{ key: mum, salt: 'saltmum' }, { key: sis, salt: 'saltsis' }, { key: bro, salt: 'saltbro' }];
const REC = commit(2, MEMBERS);                                                 // B.2, two of three
const sign = (anchor, version, chain, signer, rec = REC) => signProfile({ anchor, version, chain, recovery: rec, locations: [LOC], name: 'Alice' }, signer);
const v1 = sign(alice.x, 1, [{ key: alice.x }], alice);
const branch = [{ key: alice.x }, rotation(alice, rotated, REC), restore(rotated, restored, MEMBERS.slice(0, 2), REC)];
const v3 = sign(alice.x, 3, branch, restored);

// A key the host generated for itself. Everything it signs is well formed; none of it is alice.
const impostor = key('hostile-host');
const hostile = sign(impostor.x, 7, [{ key: impostor.x }], impostor, commit(1, [{ key: bro, salt: 'salthost' }]));
const read = (bytes, learned) => verifyProfile(bytes, { learned });

console.log('§3.1 — a reader that learns your key from the host has learned nothing\n');
console.log(`  the host serves this at ${LOC}/profile:`);
console.log(`    name    "Alice"     — signed, so no hub chose it, and no reader may match on it (§3.2)`);
console.log(`    anchor  ${impostor.x}`);
console.log('  and it is a perfectly good file: signed by the key its chain ends on, chain walks.\n');
console.log(`  learned from the profile itself   ${read(hostile, impostor.x).verdict}          ← trust on first use`);
console.log(`  learned out of band (§3.1)        ${read(hostile, alice.x).verdict} — ${read(hostile, alice.x).why}`);
console.log(`  the same check on alice's own     ${read(v3, alice.x).verdict}\n`);
assert.ok(verifyFile(hostile, impostor.x), 'the hostile profile is a valid signed file');
assert.equal(read(hostile, impostor.x).verdict, 'ok');
assert.equal(read(hostile, alice.x).verdict, 'identity');
assert.equal(read(hostile, alice.x).why, 'not the identity this reader learned');
assert.equal(read(v3, alice.x).verdict, 'ok');

// Route one: the location with the key in its fragment. A fragment is never put on the wire.
const link = `${LOC}#${alice.x}`;
const url = new URL(link);
const target = url.pathname + url.search;
console.log('§3.1 — the link: the key rides in the fragment, so the server never sees it\n');
console.log(`  link            ${link}`);
console.log(`  the server gets GET ${target} — a fragment is not part of a request (RFC 3986 §3.5)`);
console.log(`  location        ${url.origin}${url.pathname}   where to fetch`);
console.log(`  key learned     ${url.hash.slice(1)}   43 characters, 32 bytes`);
console.log('  a plain browser follows the same link to the same page and ignores the fragment.\n');
console.log(`  the reader compares it with the profile's \`anchor\`, and on mismatch refuses:`);
console.log(`  host serves its own profile here → ${read(hostile, url.hash.slice(1)).verdict}: ${read(hostile, url.hash.slice(1)).why}\n`);
assert.equal(url.hash.slice(1), alice.x);
assert.equal(decodeStrict(url.hash.slice(1), 32).length, 32);
assert.ok(!target.includes('#') && !target.includes(alice.x), 'the key is not in what the server receives');
assert.equal(`${url.origin}${url.pathname}`, LOC);
assert.equal(read(hostile, url.hash.slice(1)).verdict, 'identity');

// Route two: six words, for a phone call. §3.1's derivation, spelled out.
const ikm = decodeStrict(alice.x, 32);
const okm = Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), 'openfeed/v1/spoken', 9));
let acc = 0n; for (const b of okm) acc = (acc << 8n) | BigInt(b);
const fields = Array.from({ length: 6 }, (_, i) => Number((acc >> BigInt(72 - 11 * (i + 1))) & 0x7ffn));
console.log('§3.1 — the spoken code: six words, for a phone call\n');
console.log(`  ikm    the 32 key bytes of ${alice.x}`);
console.log('  salt   "" (empty)          info   "openfeed/v1/spoken"          L   9 bytes');
console.log(`  okm    ${okm.toString('hex')}   72 bits, of which the first 66 are used\n`);
console.log('  field   bits         index   word');
fields.forEach((n, i) => console.log(`  ${i}       ${n.toString(2).padStart(11, '0')}  ${String(n).padStart(6)}   ${WORDS[n]}`));
console.log(`\n  indices        ${fields.join(' ')}   — Appendix B.12, verbatim`);
console.log(`  spoken code    ${spokenCode(alice.x).join(' ')}\n`);
console.log('  That is what alice reads down the phone, and what her daughter types into the app.');
console.log('  Nobody says the 43 characters out loud, and no user is ever shown them (§3.1).\n');
assert.deepEqual(fields, [923, 1951, 1851, 172, 1664, 898]);
assert.deepEqual(spokenIndices(alice.x), fields);
assert.equal(spokenCode(alice.x).join(' '), 'inflict view trash better source icon');

console.log('§3.1 — 66 bits, and why not 55\n');
console.log(`  the wordlist   ${WORDS.length} words = 2^11, so one word carries 11 bits`);
console.log(`  six words      66 bits, ${String(2n ** 66n).padStart(20)} keys to search`);
console.log(`  five words     55 bits, ${String(2n ** 55n).padStart(20)} — ${2 ** 11}x less work`);
console.log('  §3.1 puts the difference plainly: at 66 bits grinding a colliding key is centuries');
console.log('  of GPU time; at 55 it is not. The extra word costs one second on a phone call.\n');
assert.equal(WORDS.length, 2048);
assert.equal(BigInt(WORDS.length) ** 6n, 2n ** 66n);
assert.equal(BigInt(WORDS.length) ** 5n, 2n ** 55n);
assert.equal(2n ** 66n / 2n ** 55n, 2048n);

console.log('§3.1 — the code distinguishes identities, not versions\n');
const shown = [['alice, version 1', v1, alice.x], ['alice, version 3', v3, alice.x], ['the host above', hostile, impostor.x]];
for (const [what, bytes, learned] of shown) {
  const r = read(bytes, learned);
  console.log(`  ${what.padEnd(18)} chain ends on ${r.chain.current.slice(0, 8)}…   ${spokenCode(r.raw.anchor).join(' ')}`);
}
console.log('\n  Two versions of one identity share the anchor key, so they speak the same six words —');
console.log('  even though the second has rotated once and been restored once. The code tells alice');
console.log('  from a stranger; it cannot tell one branch of alice from another. Hence §3.6.\n');
assert.equal(spokenCode(read(v1, alice.x).raw.anchor).join(' '), spokenCode(read(v3, alice.x).raw.anchor).join(' '));
assert.notEqual(read(v1, alice.x).chain.current, read(v3, alice.x).chain.current);
assert.notEqual(spokenCode(impostor.x).join(' '), spokenCode(alice.x).join(' '));

// §3.6's only exit, in one block. `examples/contest/` owns the contest itself.
const rival = [{ key: alice.x }, rotation(alice, bro, REC)];
console.log('§3.6 — the exit from contested: the same routes MAY carry the key the chain ends on now\n');
console.log(`  alice's branch  anchor → alice/rotated → alice/restored   ends on ${restored.x.slice(0, 8)}…`);
console.log(`  a thief's       anchor → a key of his own                 ends on ${bro.x.slice(0, 8)}…`);
console.log(`  over the anchor        both say  ${spokenCode(alice.x).join(' ')}`);
console.log(`  over alice's current   ${spokenCode(restored.x).join(' ')}`);
console.log(`  over the thief's       ${spokenCode(bro.x).join(' ')}`);
console.log('\n  A reader stuck at contested and handed the middle line MUST follow the branch whose');
console.log('  chain contains that key, and pin there. Six words over a *key*, not over an identity,');
console.log('  is what makes that possible. `examples/contest/` has §3.6 itself.\n');
assert.notEqual(spokenCode(restored.x).join(' '), spokenCode(bro.x).join(' '));
assert.ok(branch.some((l) => l.key === restored.x) && !rival.some((l) => l.key === restored.x));
assert.equal(rival[0].key, branch[0].key, 'the two branches share the anchor');

console.log('Every line above is asserted.');
