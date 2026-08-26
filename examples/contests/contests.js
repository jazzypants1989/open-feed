// §3.4–3.5 — contests: two profiles claiming one identity, and the four rules that settle it; and
// locations: where an identity is served from, and moving. Run: node examples/contests/contests.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signingKeyFromSeed, createHub, createPublisher, createReader } from '../../src/openfeed.js';
import { commit, rotation, restore, vouched, signProfile, verifyProfile, vouches, walk, adoptRecoveryLists } from '../../src/profile.js';

// The test vectors' keys. The ex is on her recovery list — he is family — and he is the thief.
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const A = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored'), EX = key('ex');
const mum = { key: key('mum'), salt: 'saltmum' }, sis = { key: key('sis'), salt: 'saltsis' }, ex = { key: EX, salt: 'saltex' };
const family = commit([mum, sis, ex]), his = commit([ex]);
const LOC = ['https://alice.example/alice'], anchor = { key: A.x };
const prof = (version, chain, recovery, name = 'Alice') => ({ anchor: A.x, version, name, chain, recovery, locations: LOC });
const read = (o, signer, pin = null) => verifyProfile(signProfile(o, signer), { learned: A.x, pin });
const pinOf = (r) => ({ profileVersion: r.raw.version, profileHash: r.profile.address, chain: r.raw.chain, recoveryLists: r.recoveryLists, fields: r.fields });
const pinTo = (o, signer, pin = null) => { const r = read(o, signer, pin); assert.equal(r.verdict, 'ok', r.why); return pinOf(r); };
const got = (r) => [r.verdict, r.why], say = (r) => (r.verdict === 'ok' ? 'ok' : `${r.verdict}: ${r.why}`);
const HOST = ['host', 'serves a branch the recovery rejected'], TIE = ['identity', 'contested: two histories, and no majority settles it'];
const NOHOLD = ['identity', 'the chain of key changes does not hold'];
const split = (pin, o) => { const i = o.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key); return i < 0 && o.chain.length < pin.chain.length && o.version > pin.profileVersion ? o.chain.length : i; };

const L1 = rotation(A, A2, family);                    // she rotated once, alone
const rotA3 = rotation(A2, A3, family);                // and again, alone
const restA3 = restore(A2, A3, [mum, sis], family);    // or: two of her three moved her
const exRot = rotation(A2, EX, family);                // the thief holds A2 and moves it to his own key
const exRest = restore(A2, EX, [ex], his);             // the ex, on the list, vouching for himself

// ---- §3.4 rule 1: the split ----
const alice = prof(3, [anchor, L1, restA3], family), pinned = pinTo(alice, A3);
const branch = prof(4, [anchor, L1, exRot], family), forgotten = prof(9, [anchor, L1], family);
console.log('§3.4 — the pin holds the chain\n');
console.log(`  pinned      version 3   anchor → A2 → A3 (restored by mum and sis)`);
console.log(`  he serves   version 4   anchor → A2 → his key     split at ${split(pinned, branch)}: ${say(read(branch, EX, pinned))}`);
console.log(`  he serves   version 9   anchor → A2               split at ${split(pinned, forgotten)}: ${say(read(forgotten, A2, pinned))}\n`);
assert.ok(walk(branch, adoptRecoveryLists({}, branch, 0)));                                   // his chain walks; walking is no test
assert.deepEqual([split(pinned, branch), split(pinned, forgotten), got(read(branch, EX, pinned)), got(read(forgotten, A2, pinned))], [2, 2, HOST, HOST]);

// ---- rule 2: a list per length, never overwritten ----
const early = pinTo(prof(2, [anchor, L1], family), A2);
const rw = read(prof(3, [anchor, L1], his), A2, early), rwPin = pinOf(rw);
const r2a = read(prof(4, [anchor, L1, restA3], family), A3, rwPin), r2 = read(prof(5, [anchor, L1, exRest], his), EX, pinOf(r2a));
console.log('§3.4 — a recovery list is never overwritten\n');
console.log(`  pinned at version 2, holding 3 leaves at length 2; he republishes with a list of one: ${say(rw)}`);
console.log(`  the reader still holds ${rwPin.recoveryLists[2].leaves.length} leaves at length 2; his self-vouched restore: ${say(r2)}\n`);
assert.deepEqual([got(rw), rwPin.recoveryLists, r2a.verdict, got(r2)], [['ok', undefined], early.recoveryLists, 'ok', NOHOLD]);

// ---- rule 3: judged by the held list, never the carried copy ----
const rotPin = pinTo(prof(3, [anchor, L1, rotA3], family), A3);
const served = prof(4, [anchor, L1, exRest], his), r3 = read(served, EX, rotPin);
const heldList = rotPin.recoveryLists[2], carried = served.chain[2].recovery;
const adopted = adoptRecoveryLists({ ...rotPin.recoveryLists }, served, rotPin.chain.length);
const both = vouched(rotation(A2, EX, his), A2, [ex]);
const r3b = read(prof(4, [anchor, L1, both], his), EX, pinTo(prof(3, [anchor, L1, restA3], family), A3));
console.log('§3.4 — judged by the list held\n');
console.log(`  his link: 1 of ${carried.leaves.length} by the copy it carries, ${vouches(A2.x, exRest, heldList)} of ${heldList.leaves.length} by the list held   ${say(r3)}`);
console.log(`  a valid link of his (signed with A2) against her restore by two of three   ${say(r3b)}\n`);
assert.deepEqual([vouches(A2.x, exRest, heldList), vouches(A2.x, exRest, carried), adopted[2], got(r3), got(r3b)], [1, 1, family, NOHOLD, HOST]);

// ---- rule 4: a majority on exactly one side ----
const coerced = restore(A2, EX, [mum, ex], family);
console.log('§3.4 — a majority at the split, on exactly one side\n');
for (const [mine, link, what] of [[restA3, exRot, 'her restore (2) vs his rotation (0)'], [rotA3, exRot, 'her rotation (0) vs his rotation (0)'], [restA3, coerced, 'her restore (2) vs his restore, mum coerced (2)']]) {
  const r = read(prof(4, [anchor, L1, link], family), EX, pinTo(prof(3, [anchor, L1, mine], family), A3));
  console.log(`  ${what.padEnd(48)} ${say(r)}`);
  const [a, b] = [vouches(A2.x, mine, family) * 2 > 3, vouches(A2.x, link, family) * 2 > 3];
  assert.deepEqual(got(r), a === b ? TIE : HOST);
}
console.log();
// Outside a split: version backwards, and the same version with a different body.
const older = read(prof(2, [anchor, L1], family), A2, pinned), twin = read(prof(3, [anchor, L1, restA3], family, 'Alice P.'), A3, pinned);
assert.deepEqual([got(older), got(twin)], [['identity', 'an older profile than the one this reader saw'], ['identity', 'contested: two profiles at one version']]);
rule('3.4', `A reader MUST apply four rules to a served profile:

1. The pin holds the chain, and a served chain MUST extend it key for key. The first index at which they
   differ is the **split**; a higher \`version\` whose chain is a strict prefix of the pinned chain is a
   split at the end of the prefix.
2. A recovery list is kept per chain length — the first one the reader saw at that length — and MUST NOT
   be overwritten.
3. A link is judged by the list the reader holds at that length, never by the copy the link carries. A
   pinned reader MUST NOT adopt a carried list at any length its chain already reaches.
4. More than half of the recovery list at the split, vouching on exactly one side, wins. \`sig\` is not a
   vote. If both sides reach a majority, or neither, the identity is **contested** (§7.2) and the reader
   follows no branch until handed the current key (§3.7).

Outside a split, \`version\` MUST NOT go backwards, and the same \`version\` at a different address is
contested.`);

// ---- §3.5 locations ----
// Three origins, each src/hub.js behind a function call; nothing here opens a socket.
const OLD = 'https://pence.family/alice', NEW = 'https://alice.example/alice', MUM = 'https://mom.example/mom';
const sites = new Map(), trace = [];
for (const u of [OLD, NEW, MUM]) sites.set(new URL(u).origin, { hub: createHub(), up: true });
const io = {
  get: async (u) => { const { origin, host, pathname } = new URL(u), s = sites.get(origin); trace.push(`${host}${pathname}`); if (!s.up) throw new Error('ENOTFOUND'); const r = s.hub.handle({ method: 'GET', path: pathname }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (u, bytes, { ifMatch = null } = {}) => { const { origin, pathname } = new URL(u); const r = sites.get(origin).hub.handle({ method: 'PUT', path: pathname, headers: ifMatch ? { 'if-match': ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get }), NONE = { leaves: [] };
const profileOf = (version, locations) => ({ anchor: A.x, version, name: 'Alice', chain: [anchor], recovery: NONE, locations });
const hosts = (locs) => locs.map((l) => new URL(l).host).join(', ');

const old = createPublisher({ io, key: A, at: OLD });
await old.claim(profileOf(1, [OLD]));
await old.publish(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' });
const first = await reader.read({ learned: A.x, at: OLD }), cold = first.pin;
// She writes the same files elsewhere and publishes a higher version naming the new place.
const home = createPublisher({ io, key: A, at: NEW });
await home.claim(profileOf(2, [OLD, NEW]));
for (const [path, bytes] of old.copy) if (path.startsWith('/posts/')) await io.put(`${NEW}${path}`, bytes);
await home.amendIndex(() => ({ entries: [[1, cold.live.get(1)]], version: 3, highest: 1 }));
const after = await reader.read({ learned: A.x, at: NEW, pin: cold });
await home.publish(2, { at: '2026-08-20T09:00:00Z', text: 'moved, and safe' });
await home.updateProfile(profileOf(3, [NEW]));
const now = await reader.read({ learned: A.x, at: NEW, pin: after.pin });
console.log('§3.5 — locations\n');
for (const [where, r] of [[OLD, first], [NEW, after], [NEW, now]]) console.log(`  read at ${new URL(where).host.padEnd(14)} version ${r.pin.profileVersion}, names ${hosts(r.locations).padEnd(28)} remembered: ${hosts(r.pin.locations)}`);
assert.deepEqual([first.anchor, after.anchor, now.locations, first.pin.locations, after.pin.locations, now.pin.locations], [A.x, A.x, [NEW], [OLD], [OLD, NEW], [OLD, NEW]]);
assert.equal(`${new URL(NEW).origin}${new URL(NEW).pathname}`, NEW);
assert.ok(trace.includes('alice.example/alice/profile') && trace.includes('alice.example/alice/posts/2'));

// Mum replies to the post alice made after the move; her reply carries alice's location as mum knows it.
const mumPub = createPublisher({ io, key: mum.key, at: MUM });
await mumPub.claim({ anchor: mum.key.x, version: 1, name: 'Mum', chain: [{ key: mum.key.x }], recovery: NONE, locations: [MUM] });
await mumPub.publish(1, { at: '2026-08-20T11:00:00Z', rel: 'reply', target: { key: A.x, number: 2, hash: now.pin.live.get(2), location: NEW }, text: 'welcome home' });
const mumFeed = await reader.read({ learned: mum.key.x, at: MUM });
const seen = new Map([[A.x, cold]]);                                    // sis: the pin she took at pence.family, and nothing else
const raised = await reader.rumors(seen, mumFeed.posts, 'mum');
console.log(`\n  sis held version 1 at pence.family; mum's reply names alice.example; sis now holds version ${seen.get(A.x).profileVersion}, locations [${hosts(seen.get(A.x).locations)}]\n`);
assert.deepEqual([raised, seen.get(A.x).profileVersion, seen.get(A.x).locations], [[], 3, [OLD, NEW]]);
rule('3.5', `\`locations\` lists every base the paths of §2 hang off. A reader MUST remember every location a verified
profile has ever named. Moving is publishing a profile with a higher \`version\` naming the new place. A
reply carries its target's location as the replier knows it (§5.4), and a reader that sees a newer
location in a verified post follows it.`);
