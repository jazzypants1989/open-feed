// §8 — the publish interface: four paths, two verbs, one conditional header, and no account at all.
// Run: node examples/publish-interface/publish-interface.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, splitFile, parseBody, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { signProfile, rotation, commit } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createHub } from '../../src/hub.js';
import { createPublisher } from '../../src/publish.js';
import { createReader } from '../../src/reader.js';

// Appendix B's seeded keys, plus one for the squatter, so every byte below reproduces.
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const alice = key('alice/anchor'), next = key('alice/rotated'), mum = key('mum'), sis = key('sis'), bro = key('bro'), thief = key('squatter');
const REC = commit([{ key: mum, salt: 'saltmum' }, { key: sis, salt: 'saltsis' }, { key: bro, salt: 'saltbro' }]);
const hub = createHub(), AT = 'https://hub.example/alice', BRO = 'https://hub.example/bro';
let trace = true, pin = null;
const cut = (t) => (t.length > 12 ? `${t.slice(0, 9)}…"` : t), brief = (p) => p.replace(/[A-Za-z0-9_-]{43}/, (h) => `${h.slice(0, 6)}…`);
// Every request in this file goes through here: it prints the wire line and asserts the status.
const call = (method, path, { body = Buffer.alloc(0), ifMatch = null, note = '', expect = null } = {}) => {
  const r = hub.handle({ method, path, headers: ifMatch ? { 'if-match': ifMatch } : {}, body });
  if (trace) console.log(`  ${method} ${brief(path)}`.padEnd(27) + `${ifMatch ? `If-Match: ${cut(ifMatch)}` : ''}`.padEnd(22) + `→ ${r.status}${note && `   ${note}`}`);
  if (expect !== null) assert.equal(r.status, expect, `${method} ${path}`);
  return r;
};
const quiet = (...a) => { trace = false; const r = call(...a); trace = true; return r; };
const io = {
  get: async (u) => { const r = call('GET', new URL(u).pathname); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (u, b, { ifMatch = null } = {}) => { const r = call('PUT', new URL(u).pathname, { body: b, ifMatch }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get });
const see = async (p = pin, at = AT, learned = alice.x) => { trace = false; const r = await reader.read({ learned, at, pin: p }); trace = true; return r; };
const nums = (r) => [...r.posts.keys()].join(', '), etag = () => quiet('GET', '/alice/index').headers.etag;
const served = () => parseBody(splitFile(hub.store.get('alice/index')).body), snap = () => new Map(hub.store);
const restore = (s) => { hub.store.clear(); for (const [k, v] of s) hub.store.set(k, v); };

console.log(`§8 — the whole interface, on one screen

  PUT /<name>/profile        If-Match: <etag>   → 200 | 412
  PUT /<name>/index          If-Match: <etag>   → 200 | 412
  PUT /<name>/posts/<n>                         → 201 | 200 (reclaimed) | 409
  PUT /<name>/media/<hash>                      → 201 | 200 (replaced)  | 409
  PUT /<name>/feed.json | feed.xml | index.html  If-Match: <etag>  → 200 | 412   (views, §11)
  GET any of the above                          → 200 | 404

  There is no account, no token, and no session: the request is the signed file. Anyone's client
  can write to anyone's hub — a security property, not a convenience, because a hub that ships
  the app is a hub that can take the key. Alice claims a name with three requests:
`);
const pub = createPublisher({ io, key: alice, at: AT });
const fields = { anchor: alice.x, version: 1, name: 'alice', chain: [{ key: alice.x }], recovery: REC, locations: [AT] };
await pub.claim(fields);
assert.ok(hub.store.has('alice/profile') && hub.store.has('alice/index'), 'a claim writes both');
console.log('\n  Nothing else was sent. No header this hub reads says who alice is; her signature does.\n');
console.log('§8.1 — the two overwritable files move only from the version you read\n');
await pub.publish(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' });
const h1 = served().entries[0][1], E = etag();
call('PUT', '/alice/index', { body: hub.store.get('alice/index'), expect: 412, note: 'no If-Match at all, on a file that exists' });
const stale = call('PUT', '/alice/index', { body: hub.store.get('alice/index'), ifMatch: '"stale"', expect: 412, note: 'a tag that is not the one being served' });
call('PUT', '/alice/feed.json', { body: Buffer.from('{"version":"https://jsonfeed.org/version/1.1","items":[]}'), expect: 200, note: 'a view is unsigned and rides the same rule (§11)' });
assert.equal(stale.headers.etag, E);
console.log(`
  The 412 hands back the tag the hub is serving: ${cut(E)}  A writer reads that from the ETag header
  and never computes it: it is strong, opaque, and compared byte for byte. Two devices hold it now.
`);
const p2 = signFile({ n: 2, at: '2026-07-05T09:00:00Z', text: 'jam day' }, alice);
call('PUT', '/alice/posts/2', { body: p2, expect: 201, note: 'the phone gets there first' });
call('PUT', '/alice/index', { body: signIndex({ entries: [[1, h1], [2, address(p2)]], version: 3, top: 2 }, alice), ifMatch: E, expect: 200 });
pin = (await see(null)).pin;
const p3 = signFile({ n: 3, at: '2026-07-05T18:20:00Z', text: 'and the beans' }, alice), laptop = { entries: [[1, h1], [3, address(p3)]], top: 3 };
const before = snap();
call('PUT', '/alice/posts/3', { body: p3, expect: 201 });
call('PUT', '/alice/index', { body: signIndex({ ...laptop, version: 3 }, alice), ifMatch: E, expect: 412, note: 'the laptop lost the race' });
call('PUT', '/alice/index', { body: signIndex({ ...laptop, version: 4 }, alice), ifMatch: etag(), expect: 200, note: 'the naive retry: its own entries, the hub\'s new tag' });
const lost = await see();
assert.equal(lost.verdict, 'ok'); assert.deepEqual(lost.note, ['withdrawn: 2']); assert.equal(lost.posts.has(2), false);
console.log(`
  A pinned reader now says  ${lost.verdict} ${JSON.stringify(lost.note)}  — post 2 is gone, and no reader can tell the loss
  from alice withdrawing it. A writer that loses MUST re-read and fold into what it is served:
`);
restore(before);
call('PUT', '/alice/posts/3', { body: p3, expect: 201 });
call('PUT', '/alice/index', { body: signIndex({ ...laptop, version: 3 }, alice), ifMatch: E, expect: 412, note: 'lost again' });
await pub.amendIndex((h) => ({ ...h, entries: [...h.entries, [3, address(p3)]], top: 3 }));
const won = await see();
assert.deepEqual([...won.posts.keys()], [1, 2, 3]); assert.deepEqual(won.note, []);
console.log(`\n  posts ${nums(won)}, verdict ${won.verdict}, notes ${JSON.stringify(won.note)} — both devices' work survives.\n`);
console.log('§8.2 — a number is created once, and numbering need not be gapless\n');
const p4 = signFile({ n: 4, at: '2026-07-06T08:00:00Z', text: 'half a thought' }, alice);
call('PUT', '/alice/posts/4', { body: p4, expect: 201, note: '…and now the device crashes' });
console.log(`\n  A reader sees posts ${nums(await see())}: a number nobody lists is nothing. The device comes back, and
  it cannot prove it listed 4, so it MUST abandon it:\n`);
assert.equal(await pub.publish(4, { at: '2026-07-07T11:00:00Z', text: 'jam, again' }), 5);
pin = (await see()).pin;
console.log(`\n  live numbers ${nums(await see())} — the gap is permanent and costs nobody anything. Listing 4 late is
  the one thing it MUST NOT do, and §7.2 is where that lands:\n`);
const late = snap(), s2 = served();
call('PUT', '/alice/index', { body: signIndex({ entries: [...s2.entries, [4, address(p4)]], version: s2.version + 1, top: 5 }, alice), ifMatch: etag(), expect: 200, note: 'the hub cannot tell' });
const caught = await see();
assert.equal(caught.verdict, 'host');
console.log(`\n  the hub stored it; the pinned reader says  ${caught.verdict}: ${caught.why}
  The same check catches a host backdating a post into someone's history.\n`);
restore(late);
console.log('§8.3 — the post is written before the index that lists it\n');
const p6 = signFile({ n: 6, at: '2026-07-08T07:30:00Z', text: 'rain all day' }, alice), back = snap(), s3 = served();
call('PUT', '/alice/index', { body: signIndex({ entries: [...s3.entries, [6, address(p6)]], version: s3.version + 1, top: 6 }, alice), ifMatch: etag(), expect: 200, note: 'the index first — the wrong way round' });
const early = await see();
assert.equal(early.verdict, 'host');
console.log(`\n  every reader, until the bytes land:  ${early.verdict}: ${early.why}\n\n  the right way round instead:\n`);
restore(back);
call('PUT', '/alice/posts/6', { body: p6, expect: 201 });
const mid = await see();
assert.equal(mid.verdict, 'ok'); assert.equal(mid.posts.has(6), false);
console.log(`\n  a reader caught between the two writes:  ${mid.verdict}, posts ${nums(mid)} — post 6 is not there yet\n`);
await pub.amendIndex((h) => ({ ...h, entries: [...h.entries, [6, address(p6)]], top: 6 }));
pin = (await see()).pin;

console.log('\n§8.4 — claiming a name: first come, with the profile as the proof\n');
call('PUT', '/bro/profile', { body: signProfile({ anchor: bro.x, version: 1, chain: [{ key: bro.x }], recovery: REC, locations: [BRO] }, bro), expect: 200, note: 'a second name on the same hub, profile only' });
const cold = await see(null, BRO, bro.x);
call('PUT', '/bro/index', { body: signIndex({ entries: [], version: 1, top: 0 }, bro), expect: 200, note: 'and now one empty index' });
const warm = await see(null, BRO, bro.x);
assert.equal(cold.verdict, 'host'); assert.equal(warm.verdict, 'ok');
console.log(`
  read cold, before that empty index:  ${cold.verdict}: ${cold.why}
  read cold, after it:                 ${warm.verdict}   — so a publisher MUST write one, even empty

  A hub that accepts writes MUST check the proof. The entity tag is no part of it:
`);
const ptag = quiet('GET', '/alice/profile').headers.etag;
call('PUT', '/alice/profile', { body: signProfile({ ...fields, version: 2 }, thief), ifMatch: ptag, expect: 403, note: 'not signed by the key the chain ends on' });
call('PUT', '/alice/profile', { body: signProfile({ ...fields, version: 2, chain: [{ key: alice.x }, { key: next.x, recovery: REC }] }, next), ifMatch: ptag, expect: 403, note: 'the chain does not walk' });
call('PUT', '/alice/profile', { body: signProfile({ anchor: thief.x, version: 2, chain: [{ key: thief.x }], recovery: REC, locations: [AT] }, thief), ifMatch: ptag, expect: 409, note: 'the name is taken, by someone else' });
call('PUT', '/alice/profile', { body: signProfile({ ...fields, name: 'alice again' }, alice), ifMatch: ptag, expect: 409, note: 'a version that has not advanced' });
call('PUT', '/alice/index', { body: signIndex({ entries: [], version: 99, top: 6 }, thief), ifMatch: etag(), expect: 403, note: 'not the key alice\'s profile ends on' });
console.log('\n  and the honest case those checks must not break — a rotation, then the index re-signed:\n');
call('PUT', '/alice/profile', { body: signProfile({ ...fields, version: 2, chain: [{ key: alice.x }, rotation(alice, next, REC)] }, next), ifMatch: ptag, expect: 200 });
call('PUT', '/alice/index', { body: signIndex({ ...served(), version: 99 }, alice), ifMatch: etag(), expect: 403, note: 'the rotated-away key no longer signs it' });
const pub2 = createPublisher({ io, key: next, at: AT });
await pub2.resignIndex();                                            // the index, re-signed under the new key
pin = (await see()).pin;
console.log(`\n  a reader across the rotation: ${(await see()).verdict}, posts ${nums(await see())}\n`);
console.log('§8.5 — a number held by a file that is not the owner\'s, reclaimed by the owner and nobody else\n');
const junk = (n, k) => signFile({ n, at: '2026-07-09T00:00:00Z', text: 'buy cheap watches' }, k);
const mine = (n, text) => signFile({ n, at: '2026-07-10T09:00:00Z', text }, next);
call('PUT', '/alice/posts/7', { body: junk(7, thief), expect: 201, note: 'a stranger: nothing is checked on the ordinary path' });
call('PUT', '/alice/posts/8', { body: junk(8, alice), expect: 201, note: 'a thief holding the key alice rotated away from' });
call('PUT', '/alice/posts/7', { body: mine(7, 'the figs are early'), expect: 200, note: 'declares 7, signed by the key the chain ends on' });
call('PUT', '/alice/posts/8', { body: mine(8, 'and the quinces'), expect: 200, note: 'one PUT reclaims each number he took' });
call('PUT', '/alice/posts/8', { body: junk(8, alice), expect: 409, note: 'and it does not turn around' });
call('PUT', '/alice/posts/1', { body: junk(1, thief), expect: 409, note: 'listed at that number and address: hers' });
call('PUT', '/alice/posts/1', { body: mine(1, 'a second thought'), expect: 409, note: 'and she cannot overwrite her own' });
console.log(`
  Posts 1 and 8 were both signed by the anchor key, which is still in the chain. Post 1 is hers
  because the index lists it at that number and address; post 8 was nobody's, because the other half
  of the rule asks for the key the chain *currently* ends on — if any chain key counted, a thief who
  once held one could squat five numbers and hold them forever.
`);
console.log('§8.6 — the same rule for media, by the hash instead of the number\n');
const png = Buffer.from('\x89PNG the peonies'), ph = sha256(png);
call('PUT', `/alice/media/${ph}`, { body: Buffer.from('buy cheap watches'), expect: 400, note: 'bytes that do not hash to the name' });
hub.store.set(`alice/media/${ph}`, Buffer.from('buy cheap watches'));   // a hub MAY check nothing: assume a dumber one let it in
console.log('\n  …and now assume a hub that checks nothing on the ordinary path let the junk in anyway:\n');
call('PUT', `/alice/media/${ph}`, { body: png, expect: 200, note: 'replaced by bytes that do hash to it' });
call('PUT', `/alice/media/${ph}`, { body: Buffer.from('buy cheap watches'), expect: 409, note: 'and never the reverse' });
call('PUT', `/alice/media/${ph}`, { body: png, expect: 409, note: 'the same bytes twice is a collision, not a write' });

console.log('\n§8.7 — what a hub MUST do, and the ceiling on what it can do\n');
const g = quiet('GET', '/alice/profile'), pre = hub.handle({ method: 'OPTIONS', path: '/alice/index' });
assert.equal(g.headers['access-control-allow-origin'], '*'); assert.equal(g.headers['access-control-expose-headers'], 'ETag'); assert.equal(pre.status, 204);
assert.match(pre.headers['access-control-allow-methods'], /PUT/); assert.match(pre.headers['access-control-allow-headers'], /If-Match/); assert.ok(g.body.equals(hub.store.get('alice/profile')));
const kept = snap();
hub.store.set('alice/index', Buffer.concat([Buffer.from('{"entries":[],"version":99,"top":9}\n'), Buffer.from('A'.repeat(86))]));
const [c1, c2] = [await see(null), await see()];
assert.equal(c1.verdict, 'host'); assert.equal(c2.verdict, 'ok'); assert.deepEqual(c2.note, ['no index I can verify']);
console.log(`  GET     /alice/profile   → ${g.status}   Access-Control-Allow-Origin: ${g.headers['access-control-allow-origin']}   exposes ${g.headers['access-control-expose-headers']}
  OPTIONS /alice/index     → ${pre.status}   Allow-Methods: ${pre.headers['access-control-allow-methods']}   Allow-Headers: ${pre.headers['access-control-allow-headers']}
  served bytes are the stored bytes: ${g.body.equals(hub.store.get('alice/profile'))}   (examples/no-canonicalization/ owns that rule)

  A hub MAY require a pass, an account, a rate limit, a bill. Here it does the worst it has, and
  overwrites her index in its own store:
    a reader who never met her   ${c1.verdict}: ${c1.why}
    a reader holding a pin       ${c2.verdict} ${JSON.stringify(c2.note)}, posts ${nums(c2)}
  Whatever a hub does, it can never write as you, because it cannot make your signature. The worst
  it can do is refuse you or delete things.
`);
restore(kept);
console.log('§8.8 — withdrawal removes a line, not a file\n');
call('DELETE', '/alice/posts/2', { expect: 405, note: 'there is no DELETE verb' });
await pub2.withdraw(2);
call('GET', '/alice/posts/2', { expect: 200, note: 'the bytes are still there' });
const after = await see(), gone = hub.collect('alice'), end = await see();
assert.deepEqual(gone, ['alice/posts/2', 'alice/posts/4', 'alice/posts/7', 'alice/posts/8', `alice/media/${ph}`]);
assert.equal(end.verdict, 'ok'); assert.deepEqual(after.note, ['withdrawn: 2']);
console.log(`
  a pinned reader:  ${after.verdict} ${JSON.stringify(after.note)}  — the same note the lost race produced in §8.1
  a hub MAY then drop what the current index does not list, after a grace window covering §8.3:
    ${gone.map(brief).join(', ')}
  and the reader is unmoved: ${end.verdict}, posts ${nums(end)}. An app MUST NOT tell a user that withdrawing
  erased anything — everyone who already read post 2 still holds it; examples/rewrite/ argues it.
`);
console.log('Every line above is asserted.');
