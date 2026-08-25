// §3.7 — `locations` names every place an identity is served from; moving is writing your files
// somewhere else and publishing a higher `version` naming it. Run: node examples/moving/moving.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signingKeyFromSeed, createHub, createPublisher, createReader } from '../../src/openfeed.js';
import { signProfile } from '../../src/profile.js';
import { readingKeyFromSeed } from '../../src/envelope.js';

// Appendix B's keys, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const xkey = (label) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:vector:${label}`).digest());
const alice = key('alice/anchor'), mum = key('mum'), bro = key('bro');
const aliceRead = xkey('alice-read'), mumRead = xkey('mum-read');
const OLD = 'https://pence.family/alice', NEW = 'https://alice.example/alice';
const MUM = 'https://mom.example/mom', BRO = 'https://bro.example/bro', BEACON = 'https://bro.example/alice';

// Four origins, each `src/hub.js` behind a function call: nothing here opens a socket. An origin
// that has stopped answering throws, which is no verdict at all (§9).
const sites = new Map(), trace = [];
for (const u of [OLD, NEW, MUM, BRO]) sites.set(new URL(u).origin, { hub: createHub(), up: true });
const io = {
  get: async (u) => { const { origin, host, pathname } = new URL(u), s = sites.get(origin); trace.push(`${host}${pathname}`); if (!s.up) throw new Error('ENOTFOUND'); const r = s.hub.handle({ method: 'GET', path: pathname }); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (u, bytes, { ifMatch = null } = {}) => { const { origin, pathname } = new URL(u); const r = sites.get(origin).hub.handle({ method: 'PUT', path: pathname, headers: ifMatch ? { 'if-match': ifMatch } : {}, body: bytes }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get }), REC = { leaves: [] };
const profileOf = (version, locations) => ({ anchor: alice.x, version, name: 'Alice', chain: [{ key: alice.x }], recovery: REC, locations, read: aliceRead.x });
const hosts = (locs) => locs.map((l) => new URL(l).host).join(', ');
const show = (r) => (r.verdict === 'ok' ? `ok — version ${r.pin.profileVersion}, top ${r.pin.top}` : `${r.verdict} — ${r.why}`);
const held = (p) => `version ${p.profileVersion}, top ${p.top}, locations [${hosts(p.locations)}]`;

// alice on pence.family: a profile naming it, one post, and the pin her readers take there.
const old = createPublisher({ io, key: alice, at: OLD });
await old.claim(profileOf(1, [OLD]));
await old.publish(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' });
const first = await reader.read({ learned: alice.x, at: OLD }), cold = first.pin;

// The domain becomes unaffordable (GOALS scenario 4). She writes the same files elsewhere and
// publishes a profile at a higher version naming the new place. Nobody's cooperation is required.
const home = createPublisher({ io, key: alice, at: NEW });
await home.claim(profileOf(2, [OLD, NEW]));
for (const [path, bytes] of old.copy) if (path.startsWith('/posts/')) await io.put(`${NEW}${path}`, bytes);
await home.amendIndex(() => ({ entries: [[1, cold.live.get(1)]], version: 3, top: 1 }));
const after = await reader.read({ learned: alice.x, at: NEW, pin: cold });
console.log('§3.7 — where she is hosted changed; who she is did not\n');
console.log(`  before   version ${first.pin.profileVersion}   locations ${JSON.stringify(first.locations)}`);
console.log(`  after    version ${after.pin.profileVersion}   locations ${JSON.stringify(after.locations)}`);
console.log(`  anchor   ${after.anchor}   — the same key signed both files, and it is the identity`);
console.log(`  the link she sends her people: ${NEW}#${alice.x}  (§3.1, examples/first-contact/)\n`);
assert.deepEqual([first.anchor, after.anchor, first.pin.profileVersion, first.locations, after.pin.profileVersion, after.locations], [alice.x, alice.x, 1, [OLD], 2, [OLD, NEW]]);

// She keeps publishing at the new place, and her next profile names only it.
await home.publish(2, { at: '2026-08-20T09:00:00Z', text: 'moved, and safe' });
await home.updateProfile(profileOf(3, [NEW]));
const now = await reader.read({ learned: alice.x, at: NEW, pin: after.pin });

console.log('§3.7 — a reader remembers every location a verified profile has ever named\n');
for (const [where, r] of [[OLD, first], [NEW, after], [NEW, now]]) console.log(`  read at ${new URL(where).host.padEnd(14)} the profile names ${hosts(r.locations).padEnd(28)} remembered: ${hosts(r.pin.locations)}`);
console.log('\n  Version 3 dropped pence.family. The reader did not: the remembered set only grows.\n');
assert.deepEqual([now.locations, first.pin.locations, after.pin.locations, now.pin.locations], [[NEW], [OLD], [OLD, NEW], [OLD, NEW]]);

// pence.family still serves the last bytes alice wrote there, and can go on doing so forever.
const frozen = await reader.read({ learned: alice.x, at: OLD, pin: cold });
const past = await reader.read({ learned: alice.x, at: OLD, pin: now.pin });
console.log('§13.3 — the reader who never learns the new location is the honest limit\n');
console.log(`  sis, who only ever knew pence.family:  ${show(frozen)}, notes: ${frozen.note.length ? frozen.note.join('; ') : 'none'}`);
console.log(`    the posts she sees: ${[...frozen.posts.keys()].join(', ')}  — post 2 does not exist for her, and nothing on the page says so`);
console.log(`  mum, whose pin followed alice:         ${show(past)}\n`);
console.log('  Not an error and not a redirect: an unmarked page. Only a reader that has been\n  somewhere else can read the frozen copy as old.\n');
assert.deepEqual([frozen.verdict, frozen.note, [...frozen.posts.keys()], past.verdict, past.why], ['ok', [], [1], 'identity', 'an older profile than the one this reader saw']);

// The domain lapses: nothing answers there at all, and mum's app is pointed at it.
sites.get(new URL(OLD).origin).up = false;
const tries = []; let found = null;
for (const loc of now.pin.locations) {
  const r = await reader.read({ learned: alice.x, at: loc, pin: now.pin }).catch(() => null);   // a throw is no verdict
  tries.push([loc, r ? show(r) : 'no verdict — the name does not resolve (§9)']);
  if (r?.verdict === 'ok') { found = r; break; }
}
console.log('§3.7 — when one location stops answering, the reader tries the others\n');
for (const [loc, what] of tries) console.log(`  ${new URL(loc).host.padEnd(15)} ${what}`);
console.log('\n  She found alice again without asking anybody, and without the old host doing a thing.\n');
assert.deepEqual([tries.map(([l]) => l), tries[0][1].startsWith('no verdict'), found.pin.profileVersion], [[OLD, NEW], true, 3]);

// mum replies to the post alice made after the move. The reply carries alice's location as mum
// currently knows it (§5.4), and that is how a reader with no other path is reached.
const mumPub = createPublisher({ io, key: mum, at: MUM });
await mumPub.claim({ anchor: mum.x, version: 1, name: 'Mum', chain: [{ key: mum.x }], recovery: REC, locations: [MUM], read: mumRead.x });
const target = { key: alice.x, n: 2, hash: found.pin.live.get(2), loc: NEW };
await mumPub.publish(1, { at: '2026-08-20T11:00:00Z', rel: 'reply', target, text: 'welcome home' });
const mumFeed = await reader.read({ learned: mum.x, at: MUM });
const seen = new Map([[alice.x, cold]]);                        // sis: the pin she took at pence.family, and nothing else
trace.length = 0;
const quiet = await reader.rumors(seen, mumFeed.posts, 'mum');
console.log('§5.4 — the address rides along in other people\'s posts\n');
console.log(`  mum's reply, target:  ${JSON.stringify(target)}`);
console.log(`  sis held for alice:   ${held(cold)}`);
console.log(`  what her reader fetched, in order:\n${trace.map((t) => `    ${t}`).join('\n')}`);
console.log(`  sis holds for alice:  ${held(seen.get(alice.x))}`);
console.log(`  rumors raised:        ${quiet.length ? quiet.join('; ') : 'none — she can see the post now'}\n`);
assert.deepEqual([quiet, trace.length, held(seen.get(alice.x))], [[], 5, 'version 3, top 2, locations [pence.family, alice.example]']);

// bro's own post names alice at an address he controls. It verifies — as his — and he also serves
// a profile there carrying alice's anchor and his own signature. (A post that does not verify never
// reaches the rumor step at all: §7.4, examples/the-reader/.)
const griefTarget = { key: alice.x, n: 99, hash: 'x'.repeat(43), loc: BEACON };
const broPub = createPublisher({ io, key: bro, at: BRO });
await broPub.claim({ anchor: bro.x, version: 1, name: 'Bro', chain: [{ key: bro.x }], recovery: REC, locations: [BRO] });
await broPub.publish(1, { at: '2026-08-21T08:00:00Z', rel: 'reply', target: griefTarget, text: 'she is over here now' });
sites.get(new URL(BEACON).origin).hub.store.set('alice/profile', signProfile(profileOf(9, [BEACON]), bro));
const broFeed = await reader.read({ learned: bro.x, at: BRO });
const seenAgain = new Map([[alice.x, seen.get(alice.x)]]); trace.length = 0;
const loud = await reader.rumors(seenAgain, broFeed.posts, 'bro');
const walked = [...trace], beaconHits = walked.filter((t) => t.startsWith('bro.example/alice')).length;
const atBeacon = await reader.read({ learned: alice.x, at: BEACON, pin: seenAgain.get(alice.x) });
const notes = { 0: 'the locations she already holds are tried first (§7.5)', [walked.length - 1]: 'the address in his reply, tried last' };

console.log('§5.4 — a `loc` aims a fetch, and only what verifies there moves anybody\n');
console.log(`  bro's own post, which verifies as his. What her reader fetched, in order:`);
console.log(walked.map((t, i) => `    ${(t.padEnd(30) + (notes[i] ?? '')).trimEnd()}`).join('\n'));
console.log(`    what bro.example served for her: ${show(atBeacon)}`);
console.log(`    sis still holds for alice:       ${held(seenAgain.get(alice.x))}`);
console.log(`    rumors raised: ${loud.join('; ')}  — the replier is the only party there is evidence about\n`);
console.log('  What is served at a `loc` must verify under the anchor key the reader learned (§3.1, §7.1),\n  or the pin does not move. An encrypted reply carries its target inside the envelope (§6.5,\n  examples/envelope/), so relocation rides along in public replies only.\n');
assert.deepEqual([atBeacon.verdict, atBeacon.why], ['identity', 'the profile is not signed by the key it ends on']);
assert.deepEqual([loud, beaconHits, held(seenAgain.get(alice.x))], [['bro replied to something I cannot see'], 1, 'version 3, top 2, locations [pence.family, alice.example]']);

console.log('Every line above is asserted.');
