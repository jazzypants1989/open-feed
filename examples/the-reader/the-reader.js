// §7 — the reader: given the anchor key it learned, a location, and the pin it kept from last
// time, it performs eleven steps in a normative order and returns one of exactly three verdicts.
// Run: node examples/the-reader/the-reader.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createHub } from '../../src/hub.js';
import { createPublisher } from '../../src/publish.js';
import { createReader } from '../../src/reader.js';
import { signFile, verifyFile, splitFile, parseBody, sha256, signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, signProfile, verifyProfile } from '../../src/profile.js';
import { fold, signIndex, verifyIndex } from '../../src/index.js';
import { encrypt, carrierOf, readingKeyFromSeed } from '../../src/envelope.js';

// Appendix B's seeds, so every byte printed here is the spec's own.
const seed = (label) => crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
const key = (label) => signingKeyFromSeed(seed(label));
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored'), THIEF = key('thief');
const MUM = { key: key('mum'), salt: 'saltmum' }, SIS = { key: key('sis'), salt: 'saltsis' }, BRO = { key: key('bro'), salt: 'saltbro' };
const REC = commit(2, [MUM, SIS, BRO]), AT = 'https://alice.example/alice';
const T0 = Date.parse('2026-08-01T00:00:00Z'), LATER = T0 + 8 * 86400e3;

// `src/hub.js`'s pure handler behind the fetcher shape §7 is given — no socket, since `src/fetch.js`
// is the only module in this repo that opens one.
const hub = createHub(), store = hub.store;
const io = {
  get: async (url) => { const r = hub.handle({ method: 'GET', path: new URL(url).pathname }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (url, bytes, { ifMatch = null } = {}) => { const r = hub.handle({ method: 'PUT', path: new URL(url).pathname, headers: ifMatch ? { 'if-match': ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get }), read = (pin, now = T0) => reader.read({ learned: A1.x, at: AT, pin, now });
const say = (r) => (r.why ?? r.note.join('; ')).replace(/[A-Za-z0-9_-]{43}/g, (h) => `${h.slice(0, 6)}…`);
const row = (what, r, w = 44) => console.log(`  ${what.padEnd(w)}${r.verdict.padEnd(10)}${say(r)}`.trimEnd());

// Alice claims a name and publishes three posts and a photograph.
const F = { anchor: A1.x, name: 'alice', chain: [{ key: A1.x }], recovery: REC, locations: [AT] };
const pub1 = createPublisher({ io, key: A1, at: AT });
await pub1.claim({ ...F, version: 1 });
for (const n of [1, 2, 3]) await pub1.publish(n, { at: '2026-08-01T10:15:00Z', text: `post ${n}` });
const PHOTO = await pub1.publishMedia(Buffer.from('a photograph of the peonies'));
const v1 = { profile: store.get('alice/profile'), index: store.get('alice/index') };

const pf = await io.get(`${AT}/profile`), id = verifyProfile(pf.bytes, { learned: A1.x });
const ix = verifyIndex((await io.get(`${AT}/index`)).bytes, id.chain.current), set = fold(ix.obj.entries);
const cold = await read(null);
console.log('§7 — a reader is given three things\n');
console.log(`  the anchor key it learned   ${A1.x}   (§3.1, out of band)`);
console.log(`  a location to read from     ${AT}`);
console.log('  the pin it kept last time   none — this is a cold read\n');

const step = (n, what, saw) => console.log(`  ${String(n).padStart(2)}  ${what.padEnd(38)}${saw}`);
console.log('§7 — the order of operations is normative\n');
step(1, 'fetch the profile', `${pf.bytes.length} bytes, parsed under §2.4's rules`);
step(2, 'is `anchor` the key I learned?', `${id.raw.anchor.slice(0, 10)}… — yes`);
step(3, 'record a recovery list per length', `length ${Object.keys(id.recoveryLists)[0]}: k = ${REC.k} of ${REC.leaves.length} leaves`);
step(4, 'walk the chain', `${id.raw.chain.length - 1} links yet: the chain is the anchor key alone`);
step(5, "verify the profile's own signature", 'under the key step 4 ended on');
step(6, 'compare the profile against the pin', 'no pin: nothing to compare');
step(7, 'fetch the index, verify, fold', `version ${ix.obj.version}, top ${set.top}, ${set.live.size} live entries`);
step(8, 'an index that will not verify…', 'it verified, so there is nothing to note');
step(9, 'compare the index against the pin', 'no pin');
step(10, 'fetch every live entry (§7.4)', `${cold.posts.size} posts and ${cold.media.size} media file`);
step(11, 'targets above a pinned top (§7.5)', 'no pin for anyone else: nothing to look at');
console.log(`\n  verdict  ${cold.verdict}\n`);
assert.deepEqual([cold.verdict, id.raw.anchor, id.chain.current], ['ok', A1.x, A1.x]);
assert.deepEqual([set.live.size, set.top, ix.obj.version, cold.posts.size, cold.media.size], [4, 3, 5, 3, 1]);

// A whole other identity, whose chain of key changes holds perfectly well — it is just not hers.
const imp = signProfile({ anchor: THIEF.x, version: 9, chain: [{ key: THIEF.x }, rotation(THIEF, A2, REC)], recovery: REC, locations: [AT] }, A2);
const rot = signProfile({ ...F, version: 2, chain: [{ key: A1.x }, rotation(A1, A2, REC)] }, A2);
const asRead = (learned) => verifyProfile(imp, { learned });
console.log('§7.1 — each step supplies what the next one checks\n');
console.log("  step 2 before step 4 — the impostor's profile, read by two readers:");
console.log(`    one that learned the thief's key   ${asRead(THIEF.x).verdict} — the chain walks, the file verifies`);
console.log(`    one that learned hers              ${asRead(A1.x).verdict}: ${asRead(A1.x).why}`);
console.log('    Step 4 asks whether a history hangs together. Only step 2 asks whose it is.\n');
console.log("  step 4 before step 5 — which key to verify under is the chain's last word:");
console.log(`    her rotated profile, under the anchor key   ${verifyFile(rot, A1.x)}`);
console.log(`    under the key the chain ends on             ${verifyFile(rot, A2.x) ? 'verifies' : 'no'}`);
console.log('    A reader that verified first would have to guess, and its only guess is the anchor —');
console.log('    which stops working the first time she rotates.\n');
assert.deepEqual([asRead(THIEF.x).verdict, asRead(A1.x).why], ['ok', 'not the identity this reader learned']);
assert.deepEqual([verifyFile(rot, A1.x), verifyFile(rot, A2.x)?.by], [null, A2.x]);

// A withdrawal, a rotation caught between its two writes, and a restore two of three vouch for.
await pub1.withdraw(2);
const afterWithdraw = await read(cold.pin);
const pub2 = createPublisher({ io, key: A2, at: AT });
await pub2.updateProfile({ ...F, version: 2, chain: [{ key: A1.x }, rotation(A1, A2, REC)] });
const midRotation = await read(afterWithdraw.pin), midCold = await read(null);
await pub2.resignIndex();
const chain3 = [{ key: A1.x }, rotation(A1, A2, REC), restore(A2, A3, [MUM, SIS], REC)];
const pub3 = createPublisher({ io, key: A3, at: AT });
await pub3.updateProfile({ ...F, version: 3, chain: chain3 });
await pub3.resignIndex();
const afterRestore = await read(midRotation.pin), oldIndex = store.get('alice/index');

console.log('§7.3 — the notes are not verdicts\n');
console.log(`  ${'read'.padEnd(44)}${'verdict'.padEnd(10)}note`);
row('after she withdraws post 2', afterWithdraw);
row('mid-rotation: profile moved, index has not', midRotation);
row('after two of the three vouch her back in', afterRestore);
console.log('\n  Three notes, three ok reads. Promote one to a state and the reader has four states, and');
console.log('  the fourth fires on an honest withdrawal, an honest rotation, an honest recovery.\n');
assert.deepEqual([afterWithdraw.verdict, midRotation.verdict, afterRestore.verdict], ['ok', 'ok', 'ok']);
assert.deepEqual([afterWithdraw.note, midRotation.note, afterRestore.note], [['withdrawn: 2'], ['no index I can verify'], ['recently restored']]);

console.log('§7.2 — an index that will not verify is not an accusation (step 8)\n');
console.log('  the same hub, caught mid-rotation, read two ways:');
row('  holding an index it verified itself', midRotation, 42);
row('  holding none', midCold, 42);
console.log(`\n  The pinned reader keeps its own index and hands back its ${midRotation.posts.size} posts. A garbled file, a 404, an`);
console.log('  index signed by a rotated-out key, and an honest host between a rotation\'s two writes are');
console.log('  all this, and no reader can tell them apart — so §7.2 asks a cold reader to retry the');
console.log('  whole read once before it reports `host`.\n');
assert.deepEqual([midCold.verdict, midCold.why, midRotation.posts.size], ['host', 'the index is not signed by the key the profile ends on', 2]);

// An encrypted post, published by the restored key. Its content key and padding are seeded too.
const dummies = (() => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', 'openfeed/v1/vector:dummies', '', String(i++), n)); })();
const env = encrypt({ content: { text: 'the peonies came back' }, carrier: carrierOf(A1.x, 4), random: dummies,
  audience: [{ key: MUM.key.x, read: readingKeyFromSeed(seed('mum-read')).x, loc: 'https://mum.example/mum' }],
  ephemeral: readingKeyFromSeed(seed('alice/eph')), contentKey: seed('alice/contentkey') });
await pub3.publish(4, { at: '2026-08-08T09:00:00Z', encrypted: env });
const full = await read(afterRestore.pin, LATER), post1 = verifyFile(store.get('alice/posts/1'), full.chain.keys);
const check = (who, what, saw) => console.log(`  ${who.padEnd(18)}${what.padEnd(52)}${saw}`);
console.log('§7.4 — every live entry is checked before it is handed back\n');
check(`media ${PHOTO.slice(0, 8)}…`, 'the bytes hash to the address the index lists', sha256(full.media.get(PHOTO)) === PHOTO);
check('post 1', 'the signature verifies under a key in the chain', `${post1.by === A1.x ? 'the anchor key' : '?'}, two links back`);
check('', 'its address, and its n, are what index and path say', post1.address === full.pin.live.get(1) && post1.obj.n === 1);
check('post 4', `the same three checks, and ${env.slots.length} opaque slots`, `text: ${full.posts.get(4).text}`);
console.log('\n  This reader holds no reading key and never looked for one: `encrypted` comes back whole');
console.log("  and unopened, because opening it is the client's business (§6). Any failure is `host`.\n");
assert.deepEqual([sha256(full.media.get(PHOTO)), post1.by, post1.address, post1.obj.n], [PHOTO, A1.x, full.pin.live.get(1), 1]);
assert.deepEqual([full.posts.get(4).encrypted, full.posts.get(4).text, full.note], [env, undefined, []]);

// A host the author has left, serving the profile and the index it had, forever.
const live = { profile: store.get('alice/profile'), index: store.get('alice/index') };
store.set('alice/profile', v1.profile); store.set('alice/index', v1.index);
const frozenPinned = await read(full.pin, LATER), frozenCold = await read(null, LATER);
store.set('alice/profile', live.profile); store.set('alice/index', live.index);
console.log('§7.3 — a frozen copy is about the identity, not the host\n');
row('  a reader that saw the newer profile', frozenPinned, 42);
row('  a reader arriving cold', frozenCold, 42);
console.log('\n  Not `host`: this host is serving exactly what it has. Two claims about one identity are in');
console.log('  play and this reader saw the newer one, so the question is which of them is her. A cold');
console.log('  reader has no second claim, and sees an unmarked page (§13.3).\n');
assert.deepEqual([frozenPinned.verdict, frozenPinned.why, frozenCold.verdict], ['identity', 'an older profile than the one this reader saw', 'ok']);

// The battery: each move is made against the pinned reader, read, and undone.
const good = full.pin;
const move = async (what, k, v) => {
  const saved = store.get(k);
  v === null ? store.delete(k) : store.set(k, v);
  const r = await read(good, LATER);
  saved === undefined ? store.delete(k) : store.set(k, saved);
  return [what, r];
};
const swap1 = signFile({ n: 1, at: '2026-08-09T00:00:00Z', text: 'not what she wrote' }, A3);
const cur = parseBody(splitFile(store.get('alice/index')).body);         // the index the pin holds
const battery = [
  await move('withholds a listed post', 'alice/posts/3', null),
  await move('serves an older index', 'alice/index', oldIndex),
  await move('rolls the index back, keeping top', 'alice/index', signIndex({ ...cur, version: cur.version - 1 }, A3)),
  await move('serves a second index at one version', 'alice/index', signIndex({ ...cur, entries: [...cur.entries, [sha256(Buffer.from('a blob nobody listed'))]] }, A3)),
  await move('swaps a post for another she signed', 'alice/posts/1', swap1),
  await move('serves genuine post 3 at number 1', 'alice/posts/1', store.get('alice/posts/3')),
  await move('serves a post signed by a key that was never hers', 'alice/posts/3', signFile({ n: 3, at: '2026-08-01T10:15:00Z', text: 'post 3' }, THIEF)),
  await move('withholds a listed media file', `alice/media/${PHOTO}`, null),
  await move('alters the media bytes', `alice/media/${PHOTO}`, Buffer.from('a different photograph')),
  await move('substitutes a whole other identity', 'alice/profile', imp),
  await move('serves a second profile at one version', 'alice/profile', signProfile({ ...F, name: 'alicia', version: 3, chain: chain3 }, A3)),
  await move('serves no profile at all', 'alice/profile', null),
  await move('smuggles in a post signed by a key that was hers', 'alice/posts/9', signFile({ n: 9, at: '2026-08-09T00:00:00Z', text: 'smuggled' }, A2)),
];
const verdicts = new Set(battery.map(([, r]) => r.verdict));
console.log(`§7.3 — ${battery.length} hostile moves, ${verdicts.size} verdicts\n`);
console.log(`  ${'move'.padEnd(52)}${'verdict'.padEnd(10)}what the reader said`);
for (const [what, r] of battery) row(what, r, 52);
console.log(`\n  distinct verdicts across the battery: ${verdicts.size}  (${[...verdicts].sort().join(', ')})\n`);
console.log('  The last row is why the third verdict is `ok`. A file signed by a key that was hers is not');
console.log('  a post: the index admits posts (§4), it does not list 9, and the read is ordinary. Nothing');
console.log('  is left over for a fourth verdict to be, and a conforming reader MUST NOT invent one.\n');
assert.deepEqual([battery.length, verdicts.size, [...verdicts].sort()], [13, 3, ['host', 'identity', 'ok']]);
assert.equal(battery.map(([, r]) => r.verdict).join(), 'host,host,host,host,host,host,host,host,host,identity,identity,host,ok');
assert.deepEqual(battery.slice(2, 4).map(([, r]) => r.why), ['an index older than the one this reader saw', 'two indexes at one version']);
assert.equal(battery.at(-1)[1].posts.has(9), false);

console.log('§7.5 — step 11, the one place a read reaches past this identity\n');
console.log("  A post naming a target above that author's pinned `top` makes the reader look again —");
console.log('  at most once per identity per pass, saying one line per person: examples/top-and-rumors/.\n');

console.log('Every line above is asserted.');
