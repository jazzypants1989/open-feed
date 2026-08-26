// §7 — reading: the steps in order, the three verdicts, the checkpoint, targets and the rumor rule.
// Run: node examples/reading/reading.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { createHub } from '../../src/hub.js';
import { createPublisher } from '../../src/publish.js';
import { createReader } from '../../src/reader.js';
import { signFile, verifyFile, splitFile, parseBody, sha256, signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, signProfile, verifyProfile } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { encrypt, postBinding, readingKeyFromSeed } from '../../src/envelope.js';

const seed = (label) => crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
const key = (label) => signingKeyFromSeed(seed(label));
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored'), THIEF = key('thief'), mum = key('mum'), griefer = key('griefer');
const MUM = { key: mum, salt: 'saltmum' }, SIS = { key: key('sis'), salt: 'saltsis' }, BRO = { key: key('bro'), salt: 'saltbro' };
const REC = commit([MUM, SIS, BRO]), NONE = { leaves: [] };
const AT = 'https://hub.example/alice', MUMAT = 'https://hub.example/mum', GRIEF = 'https://hub.example/griefer';
const T0 = Date.parse('2026-08-01T00:00:00Z'), LATER = T0 + 8 * 86400e3;

// src/hub.js as a pure handler; every GET is counted.
const hub = createHub(), store = hub.store;
let gets = 0;
const io = {
  get: async (url) => { gets++; const r = hub.handle({ method: 'GET', path: new URL(url).pathname }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (url, bytes, { ifMatch = null } = {}) => { const r = hub.handle({ method: 'PUT', path: new URL(url).pathname, headers: ifMatch ? { 'if-match': ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get }), read = (checkpoint, now = T0) => reader.read({ learned: A1.x, at: AT, checkpoint, now });
const cost = async (fn) => { const before = gets, out = await fn(); return { out, gets: gets - before }; };
const claim = async (k, name, loc, recovery = NONE) => { const pub = createPublisher({ io, key: k, at: loc }); await pub.claim({ anchor: k.x, version: 1, name, chain: [{ key: k.x }], recovery, locations: [loc] }); return pub; };

// ---- §7 / §7.1 the steps ----
const F = { anchor: A1.x, name: 'alice', chain: [{ key: A1.x }], recovery: REC, locations: [AT] };
const pub1 = await claim(A1, 'alice', AT, REC);
for (const number of [1, 2, 3]) await pub1.publish(number, { at: '2026-08-01T10:15:00Z', text: `post ${number}` });
const PHOTO = await pub1.publishMedia(Buffer.from('a photograph of the peonies'));
const v1 = { profile: store.get('alice/profile'), index: store.get('alice/index') };
const cold = await read(null);
console.log('§7 — a cold read\n');
console.log(`  verdict ${cold.verdict}; ${cold.posts.size} posts, ${cold.media.size} media file\n`);
assert.deepEqual([cold.verdict, cold.posts.size, cold.media.size, cold.checkpoint.highest], ['ok', 3, 1, 3]);
rule('7', `A reader is given the anchor key it learned (§3), a location, and optionally the checkpoint it kept from last time.
The steps are in order; each supplies what the next checks.`);

// Steps 1–2: nothing served; a garbled profile; another identity.
store.delete('alice/profile');
const none = await read(null);
store.set('alice/profile', Buffer.from('{"anchor":1,"anchor":2}\nsig'));
const garbled = await read(null);
const imp = signProfile({ anchor: THIEF.x, version: 9, chain: [{ key: THIEF.x }, rotation(THIEF, A2, REC)], recovery: REC, locations: [AT] }, A2);
store.set('alice/profile', imp);
const other = await read(null);
store.set('alice/profile', v1.profile);
assert.deepEqual([none.verdict, none.why, garbled.verdict, other.verdict, other.why], ['tampered', 'no profile served', 'contested', 'contested', 'not the identity this reader learned']);
assert.equal(verifyProfile(imp, { learned: THIEF.x }).verdict, 'ok');                      // step 2 before step 4
// Steps 4–5: a chain that does not hold; a signature by the wrong key.
const rot = { ...F, version: 2, chain: [{ key: A1.x }, rotation(A1, A2, REC)] };
store.set('alice/profile', signProfile({ ...rot, chain: [{ key: A1.x }, restore(A1, A2, [SIS], REC)] }, A2));
const noHold = await read(null);
store.set('alice/profile', signProfile(rot, A1));
const wrongKey = await read(null);
store.set('alice/profile', v1.profile);
assert.deepEqual([noHold.verdict, noHold.why, wrongKey.verdict, wrongKey.why], ['contested', 'the chain of key changes does not hold', 'contested', 'the profile is not signed by the key it ends on']);
// Steps 7–8: a withdrawal; a rotation caught between its two writes; a restore.
await pub1.withdraw(2);
const afterWithdraw = await read(cold.checkpoint);
const pub2 = createPublisher({ io, key: A2, at: AT });
await pub2.updateProfile(rot);
const midRotation = await read(afterWithdraw.checkpoint), midCold = await read(null);
await pub2.resignIndex();
const chain3 = [{ key: A1.x }, rotation(A1, A2, REC), restore(A2, A3, [MUM, SIS], REC)];
const pub3 = createPublisher({ io, key: A3, at: AT });
await pub3.updateProfile({ ...F, version: 3, chain: chain3 });
await pub3.resignIndex();
const afterRestore = await read(midRotation.checkpoint), oldIndex = store.get('alice/index');
console.log('§7.1 — three ok reads with notes\n');
for (const [what, r] of [['after a withdrawal', afterWithdraw], ['mid-rotation, checkpointed', midRotation], ['after a restore', afterRestore]]) console.log(`  ${what.padEnd(24)} ${r.verdict}   ${r.note.join('; ')}`);
console.log(`  mid-rotation, cold       ${midCold.verdict}: ${midCold.why}\n`);
assert.deepEqual([afterWithdraw.note, midRotation.note, afterRestore.note, afterWithdraw.checkpoint.withdrawn.get(2)], [['withdrawn: 2'], ['no index I can verify'], ['recently restored'], cold.checkpoint.live.get(2)]);
assert.deepEqual([midCold.verdict, midCold.why, midRotation.posts.size], ['tampered', 'the index is not signed by the key the profile ends on', 2]);
// Step 9: an encrypted post comes back opaque; then the battery of hostile moves against the checkpoint.
const env = encrypt({ content: { text: 'the peonies came back' }, binding: postBinding(A1.x, 4), audience: [{ key: mum.x, read: readingKeyFromSeed(seed('mum-read')).x, location: MUMAT }], ephemeral: readingKeyFromSeed(seed('alice/eph')), contentKey: seed('alice/contentkey') });
await pub3.publish(4, { at: '2026-08-08T09:00:00Z', encrypted: env });
const full = await read(afterRestore.checkpoint, LATER), post1 = verifyFile(store.get('alice/posts/1'), full.chain.keys);
assert.deepEqual([sha256(full.media.get(PHOTO)), post1.by, post1.address, post1.obj.number, full.posts.get(4).encrypted, full.posts.get(4).text], [PHOTO, A1.x, full.checkpoint.live.get(1), 1, env, undefined]);
const good = full.checkpoint, cur = parseBody(splitFile(store.get('alice/index')).body);
const move = async (what, k, v) => { const saved = store.get(k); v === null ? store.delete(k) : store.set(k, v); const r = await read(good, LATER); saved === undefined ? store.delete(k) : store.set(k, saved); return [what, r]; };
const battery = [
  await move('withholds a listed post', 'alice/posts/3', null),
  await move('serves an older index', 'alice/index', oldIndex),
  await move('rolls the index back, keeping top', 'alice/index', signIndex({ ...cur, version: cur.version - 1 }, A3)),
  await move('serves a second index at one version', 'alice/index', signIndex({ ...cur, entries: [...cur.entries, [sha256(Buffer.from('a blob nobody listed'))]] }, A3)),
  await move('drops post 4 and lowers top', 'alice/index', signIndex({ entries: cur.entries.filter((e) => e[0] !== 4), version: cur.version + 1, highest: 3 }, A3)),
  await move('swaps a post for another she signed', 'alice/posts/1', signFile({ number: 1, at: '2026-08-09T00:00:00Z', text: 'not what she wrote' }, A3)),
  await move('serves genuine post 3 at number 1', 'alice/posts/1', store.get('alice/posts/3')),
  await move('serves a post signed by a key that was never hers', 'alice/posts/3', signFile({ number: 3, at: '2026-08-01T10:15:00Z', text: 'post 3' }, THIEF)),
  await move('withholds a listed media file', `alice/media/${PHOTO}`, null),
  await move('alters the media bytes', `alice/media/${PHOTO}`, Buffer.from('a different photograph')),
  await move('substitutes a whole other identity', 'alice/profile', imp),
  await move('serves a second profile at one version', 'alice/profile', signProfile({ ...F, name: 'alicia', version: 3, chain: chain3 }, A3)),
  await move('serves no profile at all', 'alice/profile', null),
  await move('smuggles in an unlisted post signed by a key that was hers', 'alice/posts/9', signFile({ number: 9, at: '2026-08-09T00:00:00Z', text: 'smuggled' }, A2)),
];
console.log(`§7.1 — ${battery.length} moves against a checkpointed reader\n`);
for (const [what, r] of battery) console.log(`  ${what.padEnd(58)} ${r.verdict}`);
console.log();
assert.equal(battery.map(([, r]) => r.verdict).join(), 'tampered,tampered,tampered,tampered,tampered,tampered,tampered,tampered,tampered,tampered,contested,contested,tampered,ok');
assert.deepEqual(battery.slice(1, 5).map(([, r]) => r.why), ['an index older than the one this reader saw', 'an index older than the one this reader saw', 'two indexes at one version', 'the highest number used went backwards']);
assert.equal(battery.at(-1)[1].posts.has(9), false);
rule('7.1', `1. Fetch \`<location>/profile\`. Not served: **tampered**. Does not parse under §2.4: **contested**.
2. \`anchor\` is not the key learned: **contested**.
3. Adopt a recovery list for every chain length beyond those the checkpointed chain reaches, from the links'
   \`recovery\` and the profile's, keeping any list already held.
4. Walk the chain (§3.2), judging each link by the list held at its length. A link that fails, or a link
   without \`sig\` beside a change it may not make: **contested**.
5. Verify the signature under the key the chain ends on. Failure: **contested**.
6. Against a checkpoint, apply §3.4.
7. Fetch \`<location>/index\`, verify it under the current key (§4.4), replay it (§4.1). An index that does
   not verify: a reader holding one it verified before keeps that one and notes \`no index I can verify\`;
   a reader holding none: **tampered**.
8. Against a checkpoint: \`version\` and \`top\` MUST NOT go backwards, else **tampered**.
9. Against a checkpoint: the same \`version\` at a different address is **tampered**.
10. Against a checkpoint: every live number at or below the checkpointed \`top\` MUST have been live or
    withdrawn before at the identical hash, else **tampered**. Media files are exempt.
11. Against a checkpoint: numbers the checkpoint held that are no longer live are noted \`withdrawn: n\`
    and their hashes kept.
12. For each live entry, fetch it. A media file's bytes MUST hash to the listed address. A post MUST verify
    under a key in the chain, its address MUST equal the listed hash, and its \`n\` MUST equal the number it
    was served at. A failure, or a listed file not served: **tampered**.
13. For each post naming a target whose author the reader holds a checkpoint for: if \`target.hash\` is not what
    that author's index lists for \`target.number\`, now or when it was withdrawn, mark the target unresolved
    (§5.4); otherwise, if \`target.number\` is above that author's \`top\`, look again (§7.4).`);

// ---- §7.2 verdicts ----
const verdicts = new Set([...battery.map(([, r]) => r.verdict), cold.verdict, none.verdict, garbled.verdict]);
console.log(`§7.2 — distinct verdicts across everything above: ${[...verdicts].sort().join(', ')}\n`);
assert.deepEqual([...verdicts].sort(), ['contested', 'ok', 'tampered']);
for (const r of [afterWithdraw, midRotation, afterRestore]) assert.equal(r.verdict, 'ok');
rule('7.2', `A read returns exactly one of **ok**, **tampered** (this host is misbehaving), or **contested** (this identity
is contested), and a reader MUST NOT invent a fourth. \`recently restored\`, \`withdrawn: n\`, and \`no index I
can verify\` are notes on an ok read.`);

// ---- §7.3 the checkpoint ----
console.log(`§7.3 — the checkpoint: ${Object.keys(good).join(', ')}\n`);
assert.deepEqual(Object.keys(good).sort(), ['chain', 'fields', 'indexHash', 'indexVersion', 'live', 'locations', 'profileHash', 'profileVersion', 'recoveryLists', 'restoredAt', 'highest', 'withdrawn'].sort());
assert.deepEqual([good.profileVersion, good.chain.length, Object.keys(good.recoveryLists), good.locations, good.highest, [...good.live.keys()].length, [...good.withdrawn.keys()]], [3, 3, ['1', '2', '3'], [AT], 4, 4, [2]]);
rule('7.3', `What a reader keeps from an ok read: the profile's \`version\` and address, the chain, the recovery list at
each chain length, every location ever named, the index's \`version\` and address, \`top\`, the live set with
its hashes, and the hash of every number it saw withdrawn.`);

// ---- §7.4 targets and the rumor rule ----
const mpub = await claim(mum, 'mum', MUMAT);
const target = (number, h = good.live.get(number)) => ({ key: A1.x, number, hash: h, location: AT });
for (const number of [1, 3]) await mpub.publish(number, { at: '2026-08-04T09:00:00Z', rel: 'reply', target: target(number), text: `about post ${number}` });
await mpub.publish(4, { at: '2026-08-04T09:00:00Z', rel: 'reply', target: target(2, afterWithdraw.checkpoint.withdrawn.get(2)), text: 'about the withdrawn one' });
const mumRead = await reader.read({ learned: mum.x, at: MUMAT });
const quiet = await cost(() => reader.rumors(new Map([[A1.x, good]]), mumRead.posts, 'mum', { now: LATER }));
assert.deepEqual([quiet.out, quiet.gets], [[], 0]);                                       // at or below top, or withdrawn at that hash: quiet
// A stale checkpoint: alice publishes 5; a reader checkpointed at top 4 sees mum's reply to 5 and looks again, once.
await pub3.publish(5, { at: '2026-08-10T09:00:00Z', text: 'post 5' });
const nowPin = (await read(good, LATER)).checkpoint;
await mpub.publish(5, { at: '2026-08-11T09:00:00Z', rel: 'reply', target: target(5, nowPin.live.get(5)), text: 'about post 5' });
const mumAgain = await reader.read({ learned: mum.x, at: MUMAT });
const seen = new Map([[A1.x, good]]);
const looked = await cost(() => reader.rumors(seen, mumAgain.posts, 'mum', { now: LATER }));
console.log(`§7.4 — mum replies to post 5, which the reader's checkpoint does not reach: look-again fetched ${looked.gets}, checkpoint now top ${seen.get(A1.x).highest}, said ${JSON.stringify(looked.out)}`);
assert.deepEqual([looked.out, seen.get(A1.x).highest, looked.gets > 0], [[], 5, true]);
// A thousand replies naming numbers never issued: one look-again, one line.
const gpub = await claim(griefer, 'griefer', GRIEF);
await gpub.publish(1, { at: '2026-08-05T09:00:00Z', rel: 'reply', target: target(500, 'x'.repeat(43)), text: 'about post 500' });
const bulk = new Map([...Array(1000).keys()].map((i) => [i, { target: target(500 + i, 'x'.repeat(43)) }]));
const perRead = (await cost(() => read(null, LATER))).gets;
const G = await cost(() => reader.rumors(new Map([[A1.x, nowPin]]), bulk, 'griefer', { now: LATER }));
console.log(`  a thousand replies naming numbers never issued: fetches ${G.gets} (one read is ${perRead}), lines ${G.out.length}: "${G.out[0]}"\n`);
assert.deepEqual([G.gets, G.out], [perRead, ['griefer replied to something I cannot see']]);
rule('7.4', `A look-again re-reads the target's author at the locations the reader holds (§3.5) and then at the reply's
\`loc\`, and updates the checkpoint on an ok read. Two bounds are REQUIRED: look again at most once per identity
per pass, and say one line per replier — *"X replied to something I cannot see"* — however many replies
they wrote. A reader MAY try the locations it already holds before the address in the reply.`);
