// §4.3, §7.5 — `top` is the highest post number ever issued and never comes down, because §7.5 reads
// a reply naming a number above it as a post being withheld. The rumor that raises is bounded twice:
// look again at most once per identity per pass, and say one line per person.
// Run: node examples/top-and-rumors/top-and-rumors.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signingKeyFromSeed, splitFile, parseBody } from '../../src/file.js';
import { signIndex } from '../../src/index.js';
import { createHub } from '../../src/hub.js';
import { createPublisher } from '../../src/publish.js';
import { createReader } from '../../src/reader.js';

// Appendix B's keys, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const alice = key('alice/anchor'), mum = key('mum'), griefer = key('griefer');

// `src/hub.js` as a pure handler over a Map: this example opens no socket, and every GET is counted.
const store = new Map(), hub = createHub({ store });
let gets = 0;
const at = (url) => new URL(url).pathname;
const io = {
  get: async (url) => { gets++; const r = hub.handle({ method: 'GET', path: at(url) }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (url, bytes, { ifMatch = null } = {}) => { const r = hub.handle({ method: 'PUT', path: at(url), headers: ifMatch ? { 'if-match': ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get });
const ALICE = 'https://hub.example/alice', MUM = 'https://hub.example/mum', GRIEF = 'https://hub.example/griefer';
// Every measurement below is "what did this cost at somebody else's host".
const cost = async (fn) => { const before = gets, out = await fn(); return { out, gets: gets - before }; };
const claim = async (k, name, loc) => { const pub = createPublisher({ io, key: k, at: loc });
  await pub.claim({ anchor: k.x, version: 1, name, chain: [{ key: k.x }], recovery: { leaves: [] }, locations: [loc] }); return pub; };
const index = () => parseBody(splitFile(store.get('alice/index')).body);
const show = (e) => e.map(([a, b]) => `[${a},${b === null ? 'null' : `"${b.slice(0, 6)}…"`}]`).join(' ');
const live = (pin) => [...pin.live.keys()].join(', ');

const apub = await claim(alice, 'alice', ALICE);
for (const n of [1, 2, 3]) await apub.publish(n, { at: `2026-08-0${n}T09:00:00Z`, text: `post ${n}` });
const pin0 = (await reader.read({ learned: alice.x, at: ALICE })).pin;
const hash = (n) => pin0.live.get(n);

// Mum replies to all three, including the one alice is about to withdraw.
const mpub = await claim(mum, 'mum', MUM);
const target = (n, h = hash(n)) => ({ key: alice.x, n, hash: h, loc: ALICE });
for (const n of [1, 2, 3]) await mpub.publish(n, { at: '2026-08-04T09:00:00Z', rel: 'reply', target: target(n), text: `about post ${n}` });
const mumRead = await reader.read({ learned: mum.x, at: MUM });

await apub.withdraw(3);
const readW = await reader.read({ learned: alice.x, at: ALICE, pin: pin0 });
console.log('§4.3 — the highest number ever issued, not the highest number listed\n');
console.log(`  entries  ${show(index().entries)}`);
console.log(`  live     ${live(readW.pin)}`);
console.log(`  top      ${index().top}   — post 3 is withdrawn and its number is never handed back\n`);
assert.equal(index().top, 3); assert.equal(live(readW.pin), '1, 2');
assert.deepEqual(readW.note, ['withdrawn: 3']);

await apub.rewrite();
console.log('  a rewrite (§4.7) clears both lines about 3, and only `top` still remembers it:\n');
console.log(`  entries  ${show(index().entries)}`);
console.log(`  top      ${index().top}\n`);
assert.ok(!index().entries.some(([n]) => n === 3)); assert.equal(index().top, 3);

// World A: `top` as §4.3 requires. World B: a publisher that let it fall to the highest number listed.
const pinA = (await reader.read({ learned: alice.x, at: ALICE })).pin;
const A = await cost(() => reader.rumors(new Map([[alice.x, pinA]]), mumRead.posts, 'mum'));
const kept = store.get('alice/index'), obj = index();
store.set('alice/index', signIndex({ entries: obj.entries, version: obj.version + 1, top: 2 }, alice));
const coldB = await reader.read({ learned: alice.x, at: ALICE });
const B = await cost(() => reader.rumors(new Map([[alice.x, coldB.pin]]), mumRead.posts, 'mum'));
const pinnedB = await reader.read({ learned: alice.x, at: ALICE, pin: pinA });
store.set('alice/index', kept);
console.log('§4.3 — why `top` outlives its post\n');
console.log("  mum's third reply targets post 3 — the one alice withdrew on purpose.\n");
console.log(`  with top = 3, as §4.3 requires    3 is at or below the top, so there is nothing to look into`);
console.log(`    rumors                         ${A.out.length ? A.out.join('; ') : '(none)'}`);
console.log(`    fetches at alice's host        ${A.gets}\n`);
console.log(`  with top allowed to fall to 2    3 is above the top, so it is worth looking into`);
console.log(`    rumors                         ${B.out.join('; ')}`);
console.log(`    fetches at alice's host        ${B.gets}   — one whole read: profile, index, posts 1 and 2\n`);
console.log(`  a reader that already knew top was 3 catches the drop instead of believing it:`);
console.log(`    pinned read                    ${pinnedB.verdict}: ${pinnedB.why}\n`);
console.log('  The cold reader is right about the bytes and wrong about the world: every reply to a');
console.log('  post its author deleted has become a rumor that her host is withholding it.\n');
assert.deepEqual(A.out, []); assert.equal(A.gets, 0); assert.equal(B.gets, 4);
assert.deepEqual(B.out, ['mum replied to something I cannot see']);
assert.equal(coldB.verdict, 'ok'); assert.equal(coldB.pin.top, 2);
assert.equal(pinnedB.verdict, 'host'); assert.equal(pinnedB.why, 'the highest number used went backwards');

// The measurement: what a pass over N replies costs the reader, and a third party's host. The
// griefer's first reply is a real signed post on his own hub; the rest are the same shape, in bulk.
const N = 1000;
const gpub = await claim(griefer, 'griefer', GRIEF);
await gpub.publish(1, { at: '2026-08-05T09:00:00Z', rel: 'reply', target: target(500, 'x'), text: 'about post 500' });
const griefRead = await reader.read({ learned: griefer.x, at: GRIEF });
const bulk = (f) => new Map([...Array(N).keys()].map((i) => [i, { target: f(i) }]));
const E = await cost(() => reader.rumors(new Map([[alice.x, pinA]]), bulk((i) => target(1 + (i % 2))), 'mum'));
const G = await cost(() => reader.rumors(new Map([[alice.x, pinA]]), bulk((i) => target(500 + i, 'x')), 'griefer'));
const perRead = (await cost(() => reader.read({ learned: alice.x, at: ALICE }))).gets;
const row = (what, looks, f, lines) => `  ${what.padEnd(40)}look-agains ${String(looks).padEnd(6)}fetches ${String(f).padEnd(6)}lines ${lines}`;
console.log(`§7.5 — ${N.toLocaleString('en-US')} replies, and what the reader pays for them\n`);
console.log(row('replies to posts alice has listed', 0, E.gets, E.out.length));
console.log(row(`replies naming 500…${499 + N}, never issued`, 1, G.gets, G.out.length));
console.log(row('the same replies, looked at per reply', N, N * perRead, N) + '   — the naive rule\n');
console.log(`  the one line said:  ${G.out[0]}\n`);
console.log(`  Both bounds are REQUIRED (§7.5): look again at most once per identity per pass, and say`);
console.log(`  one line per person. The rumor names who, not how often. Without them a reader is a`);
console.log(`  request amplifier, aimed at a third party by whoever writes the most replies.\n`);
assert.equal(E.gets, 0); assert.deepEqual(E.out, []); assert.equal(perRead, 4);
assert.equal(G.gets, perRead); assert.equal(griefRead.posts.get(1).target.n, 500);
assert.deepEqual(G.out, ['griefer replied to something I cannot see']);

// A reader that watched the withdrawal holds the number and its hash, and stays quiet.
const W = await cost(() => reader.rumors(new Map([[alice.x, readW.pin]]), mumRead.posts, 'mum'));
console.log('§7.5 — a rumor is never raised over a post the author withdrew\n');
console.log(`  the pin of the reader that watched it:  live ${live(readW.pin)}   withdrawn 3 → "${readW.pin.withdrawn.get(3).slice(0, 6)}…"   top ${readW.pin.top}`);
console.log(`  mum's reply names that exact hash, and 3 is at or below the top:`);
console.log(`    rumors                         ${W.out.length ? W.out.join('; ') : '(none)'}`);
console.log(`    fetches at alice's host        ${W.gets}\n`);
assert.deepEqual(W.out, []); assert.equal(W.gets, 0); assert.equal(readW.pin.withdrawn.get(3), hash(3));

const now = await reader.read({ learned: alice.x, at: ALICE });
console.log('§7.3 — a rumor is a note on an ok read, not a fourth state\n');
console.log(`  the read of mum, whose replies these are   ${mumRead.verdict}   ${mumRead.posts.size} posts, notes: ${mumRead.note.length ? mumRead.note.join('; ') : '(none)'}`);
console.log(`  the read of alice, while a rumor stands    ${now.verdict}   notes: ${now.note.length ? now.note.join('; ') : '(none)'}`);
console.log(`  the read of the griefer's own feed         ${griefRead.verdict}   nothing he wrote is a verdict against him`);
console.log(`  the earlier read that saw the withdrawal   ${readW.verdict}   notes: ${readW.note.join('; ')}`);
console.log(`  the rumor                                 ${G.out[0]}\n`);
console.log('  A read returns exactly one of three verdicts — ok, this host is misbehaving, this');
console.log('  identity is in question — and a conforming reader MUST NOT invent a fourth. The rumor is');
console.log('  said beside an ok read and names the replier, the only party the reader has evidence about.\n');
assert.equal(mumRead.verdict, 'ok'); assert.deepEqual(mumRead.note, []); assert.equal(mumRead.posts.size, 3);
assert.equal(now.verdict, 'ok'); assert.deepEqual(now.note, []); assert.equal(readW.verdict, 'ok');
assert.equal(griefRead.verdict, 'ok');

console.log('Every line above is asserted.');
