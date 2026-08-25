// §3 — identity: the anchor key, the profile, the chain, the recovery list, the reading key, and
// first contact. Contests and locations are examples/contests. Run: node examples/identity/identity.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signFile, verifyFile, decodeStrict, sha256, signingKeyFromSeed } from '../../src/file.js';
import { commit, leaf, rotation, restore, vouched, vouches, walk, wellFormed, adoptRecoveryLists, signProfile, verifyProfile, MAX_LINKS, MAX_LEAVES } from '../../src/profile.js';
import { spokenCode, spokenIndices } from '../../src/spoken.js';
import { WORDS } from '../../src/wordlist.js';

// The test vectors' keys and salts.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored');
const MUM = { key: key('mum'), salt: 'saltmum' }, SIS = { key: key('sis'), salt: 'saltsis' }, BRO = { key: key('bro'), salt: 'saltbro' };
const REC = commit([MUM, SIS, BRO]);
const LOC = 'https://alice.example/alice', READ = 'cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc';
const base = { anchor: A1.x, name: 'Alice', recovery: REC, locations: [LOC], read: READ };
const signOver = (text, k) => crypto.sign(null, Buffer.from(text, 'ascii'), k.privateKey).toString('base64url');
const holds = (chain, lists) => !!walk({ chain }, lists);
const read = (o, signer, pin = null) => verifyProfile(signProfile(o, signer), { learned: A1.x, pin });
const pinOf = (r) => ({ profileVersion: r.raw.version, profileHash: r.profile.address, chain: r.raw.chain, recoveryLists: r.recoveryLists, fields: r.fields });

const rot = rotation(A1, A2, REC), res = restore(A2, A3, [MUM, SIS], REC);
const chain1 = [{ key: A1.x }], chain2 = [...chain1, rot], chain3 = [...chain2, res];
const v3 = { ...base, version: 3, chain: chain3 };

// ---- §3 the anchor key ----
// A host serves a perfectly good profile under a key of its own. A reader that learned alice's key
// out of band refuses it; one that learned the key from the page accepts it.
const impostor = key('hostile-host');
const hostile = signProfile({ anchor: impostor.x, version: 7, name: 'Alice', chain: [{ key: impostor.x }], recovery: commit([]), locations: [LOC] }, impostor);
console.log('§3 — the host serves a valid profile under its own key\n');
console.log(`  learned from the page   ${verifyProfile(hostile, { learned: impostor.x }).verdict}`);
console.log(`  learned out of band     ${verifyProfile(hostile, { learned: A1.x }).verdict}\n`);
assert.ok(verifyFile(hostile, impostor.x));
assert.equal(verifyProfile(hostile, { learned: impostor.x }).verdict, 'ok');
assert.deepEqual([verifyProfile(hostile, { learned: A1.x }).verdict, verifyProfile(hostile, { learned: A1.x }).why], ['identity', 'not the identity this reader learned']);
assert.equal(decodeStrict(A1.x, 32).length, 32);
rule('3', `Your identity is your anchor key: a 32-byte Ed25519 public key. A reader MUST obtain it by a route the
host does not control (§3.7) and MUST refuse a profile whose \`anchor\` differs from it.`);

// ---- §3.1 the profile ----
console.log('§3.1 — the profile\n');
const ok = read(v3, A3);
console.log(`  ${JSON.stringify({ ...v3, chain: '…' })}`);
console.log(`  signed by the key the chain ends on   ${ok.verdict}`);
console.log(`  signed by the key it rotated from     ${read(v3, A2).why}`);
console.log(`  version -1                            ${read({ ...v3, version: -1 }, A3).why}\n`);
assert.equal(ok.verdict, 'ok');
assert.deepEqual([read(v3, A2).verdict, read(v3, A2).why], ['identity', 'the profile is not signed by the key it ends on']);
for (const bad of [{ version: -1 }, { chain: undefined }, { recovery: undefined }, { locations: undefined }]) assert.equal(read({ ...v3, ...bad }, A3).verdict, 'identity');
assert.equal(read({ ...v3, read: undefined, name: undefined }, A3).verdict, 'ok');
assert.equal(read({ ...v3, version: 2 }, A3, pinOf(ok)).why, 'an older profile than the one this reader saw');
rule('3.1', `\`\`\`json
{"anchor":"<key>","version":3,"name":"Alice",
 "chain":[{"key":"<anchor>"},{"key":"<key2>","recovery":{"leaves":["<hash>","<hash>","<hash>"]},"sig":"<86 chars>"}],
 "recovery":{"leaves":["<hash>","<hash>","<hash>"]},
 "locations":["https://alice.example/alice"],
 "read":"<x25519 key>"}
\`\`\`

| member | | meaning |
|---|---|---|
| \`anchor\` | MUST | the identity |
| \`version\` | MUST | a non-negative integer; MUST NOT go backwards |
| \`chain\` | MUST | the links from the anchor key to the key in use now (§3.2) |
| \`recovery\` | MUST | the recovery list (§3.3); MAY be empty |
| \`locations\` | MUST | every place this identity is served from (§3.5) |
| \`read\` | SHOULD | the X25519 key others encrypt to (§3.6) |
| \`name\` | MAY | a display name; MUST NOT be used to resolve or match an identity |

The profile MUST be signed by the key its chain ends on.`);

// ---- §3.2 the chain ----
console.log('§3.2 — the chain\n');
console.log(`  link 1   ${JSON.stringify(chain1[0])}`);
console.log(`  link 2   a rotation: sig by the anchor key over "${A1.x.slice(0, 6)}…->${A2.x.slice(0, 6)}…"`);
console.log(`  link 3   a restore: vouchers by ${res.vouchers.map((v) => v.salt.slice(4)).join(' and ')} over "${A2.x.slice(0, 6)}…->${A3.x.slice(0, 6)}…"\n`);
assert.ok(holds(chain1, {}) && holds(chain2, { 1: REC }) && holds(chain3, { 1: REC, 2: REC }));
assert.equal(wellFormed({ ...v3, chain: [{ key: A2.x }, ...chain3.slice(1)] }), false);              // the first link is the anchor
assert.equal(rot.sig, signOver(`${A1.x}->${A2.x}`, A1));
assert.equal(holds([...chain1, { ...rot, sig: signOver(`${A2.x}->${A1.x}`, A1) }], { 1: REC }), false);   // the other way round
assert.equal(holds([...chain1, { ...rot, sig: signOver(`${A3.x}->${A2.x}`, A3) }], { 1: REC }), false);   // a different previous key
for (const v of res.vouchers) assert.ok(REC.leaves.includes(leaf(v.salt, v.key)) && v.sig === signOver(`${A2.x}->${A3.x}`, [MUM, SIS].find((m) => m.key.x === v.key).key));
const bro = (salt) => ({ key: BRO.key.x, salt, sig: signOver(`${A2.x}->${A3.x}`, BRO.key) });
assert.equal(vouches(A2.x, { key: A3.x, vouchers: [bro('notmysalt')] }, REC), 0);                      // a good signature under the wrong salt
rule('3.2', `The chain is an array of links. The first MUST be \`{"key": <anchor>}\`. Every later link is
\`{"key", "recovery", "sig"?, "vouchers"?}\`: \`key\` is the key this link moves to; \`recovery\` is the recovery
list as it stood before this link; \`sig\` is an Ed25519 signature by the previous link's key over the ASCII
bytes \`<previous key>-><new key>\`, checked as §2.1 checks a signature line — a **rotation**; \`vouchers\`
are \`{key, salt, sig}\` signatures over the same bytes by recovery-list members, and one counts when its
signature verifies and \`SHA-256(salt ‖ "|" ‖ key)\` in base64url is one of \`recovery.leaves\` — a
**restore**.`);

// Validity: signed, or more than half. Distinct keys; an empty list never restores.
const twice = [...chain2, { ...res, vouchers: [res.vouchers[0], res.vouchers[0]] }];
const sisOnly = [...chain2, restore(A2, A3, [SIS], REC)];
console.log(`  mum and sis, 2 of 3        holds ${holds(chain3, { 1: REC, 2: REC })}`);
console.log(`  sis alone, 1 of 3          holds ${holds(sisOnly, { 1: REC, 2: REC })}`);
console.log(`  mum listed twice, 1 of 3   holds ${holds(twice, { 1: REC, 2: REC })}`);
console.log(`  an empty list, 2 vouch     holds ${holds([...chain1, restore(A1, A3, [MUM, SIS], commit([]))], { 1: commit([]) })}\n`);
assert.equal(holds(sisOnly, { 1: REC, 2: REC }), false);
assert.equal(holds(twice, { 1: REC, 2: REC }), false);
assert.equal(holds([...chain1, restore(A1, A3, [MUM, SIS], commit([]))], { 1: commit([]) }), false);
assert.equal(read({ ...v3, chain: sisOnly }, A3).why, 'the chain of key changes does not hold');
const backed = vouched(rot, A1, [MUM, SIS]);
assert.deepEqual([backed.key, backed.sig, vouches(A1.x, backed, REC)], [rot.key, rot.sig, 2]);
rule('3.2', `A link is valid when \`sig\` verifies, or when the distinct voucher keys that count are more than half of
\`recovery.leaves\`. A reader MUST reject a profile whose chain contains a link that is neither. An empty
list cannot restore. Vouchers MAY be added to a link after it was made.`);

// A restore changes the key and nothing else.
const pin2 = pinOf(read({ ...base, version: 2, chain: chain2 }, A2));
const served = (fields) => read({ ...v3, ...fields }, A3, pin2);
console.log(`  pinned at version 2; version 3 adds an unsigned link`);
console.log(`    nothing else changed      ${served({}).verdict}`);
console.log(`    locations changed too     ${served({ locations: ['https://elsewhere.example/alice'] }).why}\n`);
assert.equal(served({}).verdict, 'ok');
for (const f of [{ locations: ['https://elsewhere.example/alice'] }, { name: 'Alise' }, { read: A2.x }, { recovery: commit([MUM, SIS]) }])
  assert.deepEqual([served(f).verdict, served(f).why], ['identity', 'a restore changed more than the key']);
rule('3.2', `A restore changes the key and nothing else: a pinned reader MUST report **identity** for a profile whose
chain has grown by any link without \`sig\` and whose \`recovery\`, \`locations\`, \`name\`, or \`read\` differ from
the pin.`);

// The cap, and what a rotated-away key keeps.
let long = [...chain1]; let k = A1;
for (let i = 1; i <= MAX_LINKS; i++) { const nk = key(`long/${i}`); long.push(rotation(k, nk, REC)); k = nk; }
assert.equal(long.length, MAX_LINKS + 1);
assert.equal(wellFormed({ ...v3, chain: long }), false);
assert.equal(wellFormed({ ...v3, chain: long.slice(0, MAX_LINKS) }), true);
const post1 = signFile({ n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const now = walk({ chain: chain3 }, { 1: REC, 2: REC });
assert.equal(verifyFile(post1, now.keys).by, A1.x);
assert.equal(verifyFile(signFile({ entries: [], version: 4, top: 0 }, A2), now.current), null);
console.log(`  ${MAX_LINKS + 1} links   well-formed ${wellFormed({ ...v3, chain: long })}`);
console.log(`  post 1, signed by the anchor key, after two key changes   verifies under the chain: ${verifyFile(post1, now.keys) !== null}\n`);
rule('3.2', `A chain MUST NOT exceed ${MAX_LINKS} links, and a reader MUST reject a longer one. A key rotated away from keeps its
posts valid but cannot sign an index (§4.4) or hold a number against the owner (§8.5).`);

// ---- §3.3 the recovery list ----
console.log('§3.3 — the recovery list\n');
for (const m of [MUM, SIS, BRO]) console.log(`  ${m.salt.slice(4).padEnd(5)} SHA-256("${m.salt}|${m.key.x.slice(0, 6)}…") = ${leaf(m.salt, m.key.x)}`);
console.log(`  committed  ${JSON.stringify(REC)}\n`);
for (const m of [MUM, SIS, BRO]) assert.equal(leaf(m.salt, m.key.x), sha256(Buffer.from(`${m.salt}|${m.key.x}`, 'utf8')));
const wire = JSON.stringify(restore(A2, A3, [SIS], REC));
assert.ok(wire.includes(SIS.salt) && !wire.includes(MUM.salt) && !wire.includes(MUM.key.x));
const many = commit(Array.from({ length: MAX_LEAVES + 1 }, (_, i) => ({ key: key(`m/${i}`), salt: `s${i}` })));
assert.equal(wellFormed({ ...v3, recovery: many }), false);
assert.equal(wellFormed({ ...v3, recovery: commit(many.leaves.slice(0, MAX_LEAVES).map((_, i) => ({ key: key(`m/${i}`), salt: `s${i}` }))) }), true);
assert.equal(read({ ...base, version: 1, chain: chain1, recovery: commit([]) }, A1).verdict, 'ok');
rule('3.3', `\`{"leaves": ["<hash>", …]}\`. Each leaf is \`SHA-256(salt ‖ "|" ‖ member key)\` in base64url with a distinct
random salt per member, so a member vouching reveals only itself. The list MUST NOT exceed ${MAX_LEAVES} leaves. It
MAY be empty, and an empty list means the identity cannot be restored.`);

// Starting alone: a backup key on paper restores. A list of one other person hands them the identity.
const paper = { key: key('alice/backup'), salt: 'saltpaper' }, solo = commit([paper]), fresh = key('alice/new-phone');
assert.equal(walk({ chain: [...chain1, restore(A1, fresh, [paper], solo)] }, { 1: solo }).current, fresh.x);
const one = commit([BRO]);
assert.equal(walk({ chain: [...chain1, restore(A1, BRO.key, [BRO], one)] }, { 1: one }).current, BRO.key.x);
// A changed list reaches a pinned reader only through a link: the held list at length 1 stays.
const held = adoptRecoveryLists({}, { chain: chain1, recovery: one }, 0);
adoptRecoveryLists(held, { chain: [...chain1, rotation(A1, A2, REC)], recovery: REC }, 1);
assert.deepEqual([held[1], held[2]], [one, REC]);
// Restored is a note, not a verdict; the profile goes before the index (§4.4).
assert.deepEqual([ok.verdict, ok.chain.restored], ['ok', true]);
console.log(`  a backup key on paper   ${spokenCode(paper.key.x).join(' ')}   1 of 1 vouches — she is back`);
console.log(`  a list of bro alone     bro restores to his own key: 1 of 1`);
console.log(`  after she lists three and rotates, a reader that saw the list of one keeps it at length 1\n`);
rule('3.3', `An app SHOULD create and list a backup key at setup, and SHOULD require two or more members beyond the
owner's own keys. An app SHOULD rotate when the list changes, because a changed list reaches readers only
through a new link; changing the key means writing the profile and then the index (§4.4). A reading app
SHOULD flag a restored identity "recently restored" for seven days; the flag is presentation, not a
verdict (§7.2).`);

// ---- §3.6 the reading key ----
const unread = read({ ...v3, read: undefined }, A3);
console.log('§3.6 — the reading key\n');
console.log(`  read   ${ok.raw.read}   32-byte X25519 public key, from a profile that verified\n`);
assert.equal(decodeStrict(ok.raw.read, 32).length, 32);
assert.equal(unread.raw.read, undefined);
assert.equal(verifyProfile(hostile, { learned: A1.x }).raw, undefined);                     // nothing to encrypt to from a failed read
rule('3.6', `\`read\` is an X25519 public key; it is what others encrypt to (§6). A publisher MUST encrypt only to a
\`read\` taken from a profile it verified. A restore does not recover it.`);

// ---- §3.7 first contact ----
const link = `${LOC}#${A1.x}`, url = new URL(link);
const okm = Buffer.from(crypto.hkdfSync('sha256', decodeStrict(A1.x, 32), Buffer.alloc(0), 'openfeed/v1/spoken', 9));
let acc = 0n; for (const b of okm) acc = (acc << 8n) | BigInt(b);
const fields = Array.from({ length: 6 }, (_, i) => Number((acc >> BigInt(72 - 11 * (i + 1))) & 0x7ffn));
console.log('§3.7 — first contact\n');
console.log(`  link          ${link}`);
console.log(`  the server sees  GET ${url.pathname}   — no fragment, no key`);
console.log(`  spoken code   ${spokenCode(A1.x).join(' ')}   indices ${fields.join(' ')}\n`);
assert.equal(url.hash.slice(1), A1.x);
assert.equal(`${url.origin}${url.pathname}`, LOC);
assert.deepEqual(spokenIndices(A1.x), fields);
assert.equal(WORDS.length, 2048);
assert.equal(spokenCode(A1.x).join(' '), 'inflict view trash better source icon');
assert.equal(verifyProfile(hostile, { learned: url.hash.slice(1) }).verdict, 'identity');
// The exit from contested: the same routes carry the key the chain currently ends on.
const rival = [{ key: A1.x }, rotation(A1, BRO.key, REC)];
assert.equal(spokenCode(A1.x).join(' '), spokenCode(read({ ...base, version: 1, chain: chain1 }, A1).raw.anchor).join(' '));
assert.notEqual(spokenCode(A3.x).join(' '), spokenCode(BRO.key.x).join(' '));
assert.ok(chain3.some((l) => l.key === A3.x) && !rival.some((l) => l.key === A3.x));
rule('3.7', `A link is the location with the anchor key in its fragment, \`https://alice.example/alice#<anchor key>\`;
the app compares and refuses on mismatch. A spoken code is six words: \`HKDF-SHA256(ikm = key, salt = "",
info = "openfeed/v1/spoken", 9 bytes)\`, the first 66 bits read as six 11-bit big-endian indices into the
BIP-39 English wordlist, which implementations MUST use. When a reader is contested, either route MAY carry
the key the owner's chain currently ends on; a reader given that key MUST follow the branch containing it
and pin there.`);
