// §8 — publishing: the interface, compare-and-swap, create-once, write order, claiming a name,
// reclaiming, media, what a hub must do, withdrawal, your copy. Run: node examples/publishing/publishing.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signFile, splitFile, parseBody, verifyFile, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { signProfile, rotation, commit } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createHub } from '../../src/hub.js';
import { createPublisher } from '../../src/publish.js';
import { createReader } from '../../src/reader.js';

const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const alice = key('alice/anchor'), next = key('alice/rotated'), mum = key('mum'), sis = key('sis'), bro = key('bro'), thief = key('squatter');
const REC = commit([{ key: mum, salt: 'saltmum' }, { key: sis, salt: 'saltsis' }, { key: bro, salt: 'saltbro' }]);
const hub = createHub(), AT = 'https://hub.example/alice', BRO = 'https://hub.example/bro';
const call = (method, path, { body = Buffer.alloc(0), ifMatch = null, expect = null } = {}) => {
  const r = hub.handle({ method, path, headers: ifMatch ? { 'if-match': ifMatch } : {}, body });
  if (expect !== null) assert.equal(r.status, expect, `${method} ${path}`);
  return r;
};
const io = {
  get: async (u) => { const r = call('GET', new URL(u).pathname); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; },
  put: async (u, b, { ifMatch = null } = {}) => { const r = call('PUT', new URL(u).pathname, { body: b, ifMatch }); return { status: r.status, etag: r.headers?.etag ?? null }; },
};
const reader = createReader({ get: io.get });
let checkpoint = null;
const see = async (p = checkpoint, at = AT, learned = alice.x) => reader.read({ learned, at, checkpoint: p });
const nums = (r) => [...r.posts.keys()].join(', '), etag = () => call('GET', '/alice/index').headers.etag;
const served = () => parseBody(splitFile(hub.store.get('alice/index')).body), snap = () => new Map(hub.store);
const restore = (s) => { hub.store.clear(); for (const [k, v] of s) hub.store.set(k, v); };

// ---- §8 the interface ----
const pub = createPublisher({ io, key: alice, at: AT });
const fields = { anchor: alice.x, version: 1, name: 'alice', chain: [{ key: alice.x }], recovery: REC, locations: [AT] };
await pub.claim(fields);
await pub.publish(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' });
console.log('§8 — a claim and a post: PUT profile, PUT index, PUT posts/1, PUT index\n');
assert.ok(hub.store.has('alice/profile') && hub.store.has('alice/index') && hub.store.has('alice/posts/1'));
assert.equal(call('GET', '/alice/posts/1').status, 200);
assert.equal(call('GET', '/alice/posts/2').status, 404);
assert.equal(call('PUT', '/alice/feed.json', { body: Buffer.from('{"version":"https://jsonfeed.org/version/1.1","items":[]}') }).status, 200);
const ptag = call('GET', '/alice/profile').headers.etag;
call('PUT', '/alice/profile', { body: signProfile({ ...fields, version: 2 }, thief), ifMatch: ptag, expect: 403 });
call('PUT', '/alice/profile', { body: signProfile({ anchor: thief.x, version: 2, chain: [{ key: thief.x }], recovery: REC, locations: [AT] }, thief), ifMatch: ptag, expect: 409 });
rule('8', `\`\`\`
PUT /<name>/profile        If-Match: <etag>   → 200 | 412
PUT /<name>/index          If-Match: <etag>   → 200 | 412
PUT /<name>/posts/<number>                         → 201 | 200 (reclaimed) | 409
PUT /<name>/media/<hash>                      → 201 | 200 (replaced) | 409 | 400
PUT /<name>/feed.json | feed.xml | index.html  If-Match: <etag>  → 200 | 412   (§10)
GET any of the above                          → 200 | 404
\`\`\`

There is no account, token, or session: the request is the signed file. A hub that checks the proof (§8.4)
answers 403 for a profile or index that does not verify and 409 for a name held under another anchor or a
\`version\` that has not advanced. A hub MAY require more of its own publishers — a pass, an account, a
rate limit, a bill.`);

// ---- §8.1 compare-and-swap ----
const h1 = served().entries[0][1], E = etag();
call('PUT', '/alice/index', { body: hub.store.get('alice/index'), expect: 412 });                     // no If-Match on a file that exists
const stale = call('PUT', '/alice/index', { body: hub.store.get('alice/index'), ifMatch: '"stale"', expect: 412 });
assert.equal(stale.headers.etag, E);
assert.equal(E, `"${sha256(hub.store.get('alice/index'))}"`);
const p2 = signFile({ number: 2, at: '2026-07-05T09:00:00Z', text: 'jam day' }, alice);
call('PUT', '/alice/posts/2', { body: p2, expect: 201 });
call('PUT', '/alice/index', { body: signIndex({ entries: [[1, h1], [2, address(p2)]], version: 3, highest: 2 }, alice), ifMatch: E, expect: 200 });
checkpoint = (await see(null)).checkpoint;
const p3 = signFile({ number: 3, at: '2026-07-05T18:20:00Z', text: 'and the beans' }, alice), laptop = { entries: [[1, h1], [3, address(p3)]], highest: 3 };
const before = snap();
call('PUT', '/alice/posts/3', { body: p3, expect: 201 });
call('PUT', '/alice/index', { body: signIndex({ ...laptop, version: 3 }, alice), ifMatch: E, expect: 412 });          // the laptop lost the race
call('PUT', '/alice/index', { body: signIndex({ ...laptop, version: 4 }, alice), ifMatch: etag(), expect: 200 });     // the naive retry
const lost = await see();
assert.deepEqual([lost.verdict, lost.note, lost.posts.has(2)], ['ok', ['withdrawn: 2'], false]);
restore(before);
call('PUT', '/alice/posts/3', { body: p3, expect: 201 });
await pub.amendIndex((h) => ({ ...h, entries: [...h.entries, [3, address(p3)]], highest: 3 }));                            // re-read and merge
const won = await see();
console.log(`§8.1 — the phone and the laptop both write: naive retry loses post 2; re-read and merge keeps posts ${nums(won)}\n`);
assert.deepEqual([[...won.posts.keys()], won.note], [[1, 2, 3], []]);
rule('8.1', `A publisher MUST send \`If-Match\` with the entity tag of the version it read, and a hub MUST answer 412 if the
file has changed since, or if the file exists and the request carries no \`If-Match\`. The tag is strong,
opaque to the publisher, and compared byte for byte; a hub MAY use the SHA-256 of the bytes it serves. A
writer that loses MUST re-read the file the hub now serves and merge its own line into that file's
\`entries\`.`);

// ---- §8.2 create-once ----
const p4 = signFile({ number: 4, at: '2026-07-06T08:00:00Z', text: 'half a thought' }, alice);
call('PUT', '/alice/posts/4', { body: p4, expect: 201 });                                              // …and the device crashes
call('PUT', '/alice/posts/4', { body: signFile({ number: 4, text: 'another' }, alice), expect: 409 });
assert.equal(await pub.publish(4, { at: '2026-07-07T11:00:00Z', text: 'jam, again' }), 5);             // it abandons 4 and takes 5
checkpoint = (await see()).checkpoint;
const late = snap(), s2 = served();
call('PUT', '/alice/index', { body: signIndex({ entries: [...s2.entries, [4, address(p4)]], version: s2.version + 1, highest: 5 }, alice), ifMatch: etag(), expect: 200 });
const caught = await see();
console.log(`§8.2 — a crash between post 4 and its index: the next post is 5; listing 4 late reads ${caught.verdict}: ${caught.why}\n`);
assert.deepEqual([caught.verdict, caught.why], ['tampered', 'post 4 is listed now and was not before']);
restore(late);
rule('8.2', `A hub MUST refuse a write to a number already held, except under §8.5. Numbering need not be gapless: a
device that comes back MUST abandon a number it cannot prove it listed, and MUST NOT list one late.`);

// ---- §8.3 write order ----
const p6 = signFile({ number: 6, at: '2026-07-08T07:30:00Z', text: 'rain all day' }, alice), back = snap(), s3 = served();
call('PUT', '/alice/index', { body: signIndex({ entries: [...s3.entries, [6, address(p6)]], version: s3.version + 1, highest: 6 }, alice), ifMatch: etag(), expect: 200 });
const early = await see();
restore(back);
call('PUT', '/alice/posts/6', { body: p6, expect: 201 });
const mid = await see();
await pub.amendIndex((h) => ({ ...h, entries: [...h.entries, [6, address(p6)]], highest: 6 }));
checkpoint = (await see()).checkpoint;
console.log(`§8.3 — index first: ${early.verdict}; post first, read between the writes: ${mid.verdict}\n`);
assert.deepEqual([early.verdict, mid.verdict, mid.posts.has(6)], ['tampered', 'ok', false]);
rule('8.3', 'The post is written before the index that lists it.');

// ---- §8.4 claiming a name ----
call('PUT', '/bro/profile', { body: signProfile({ anchor: bro.x, version: 1, chain: [{ key: bro.x }], recovery: REC, locations: [BRO] }, bro), expect: 200 });
const cold = await see(null, BRO, bro.x);
call('PUT', '/bro/index', { body: signIndex({ entries: [], version: 1, highest: 0 }, bro), expect: 200 });
const warm = await see(null, BRO, bro.x);
assert.deepEqual([cold.verdict, cold.why, warm.verdict], ['tampered', 'no index served', 'ok']);
call('PUT', '/alice/profile', { body: signProfile({ ...fields, version: 2, chain: [{ key: alice.x }, { key: next.x, recovery: REC }] }, next), ifMatch: ptag, expect: 403 });   // the chain does not walk
call('PUT', '/alice/profile', { body: signProfile({ ...fields, name: 'alice again' }, alice), ifMatch: ptag, expect: 409 });                                                 // version not advanced
call('PUT', '/alice/index', { body: signIndex({ entries: [], version: 99, highest: 6 }, thief), ifMatch: etag(), expect: 403 });
call('PUT', '/alice/profile', { body: signProfile({ ...fields, version: 2, chain: [{ key: alice.x }, rotation(alice, next, REC)] }, next), ifMatch: ptag, expect: 200 });
call('PUT', '/alice/index', { body: signIndex({ ...served(), version: 99 }, alice), ifMatch: etag(), expect: 403 });                                                          // the rotated-away key
const pub2 = createPublisher({ io, key: next, at: AT });
await pub2.resignIndex();
checkpoint = (await see()).checkpoint;
console.log(`§8.4 — bro's name before its empty index: ${cold.verdict}; after: ${warm.verdict}. alice rotates and re-signs: ${(await see()).verdict}\n`);
rule('8.4', `First come, with the profile as the proof. Later writes under that name MUST carry the same \`anchor\` and a
\`version\` that has advanced. A hub that accepts writes MUST refuse a profile whose chain does not walk or
whose signature does not verify under the key the chain ends on, and an index that does not verify under
the key the profile it holds ends on. A publisher MUST write an index when it claims a name, even an
empty one.`);

// ---- §8.5 reclaiming ----
const junk = (number, k) => signFile({ number, at: '2026-07-09T00:00:00Z', text: 'buy cheap watches' }, k);
const mine = (number, text) => signFile({ number, at: '2026-07-10T09:00:00Z', text }, next);
call('PUT', '/alice/posts/7', { body: junk(7, thief), expect: 201 });          // a stranger; nothing checked on the ordinary path
call('PUT', '/alice/posts/8', { body: junk(8, alice), expect: 201 });          // a thief holding the rotated-away key
call('PUT', '/alice/posts/7', { body: mine(7, 'the figs are early'), expect: 200 });
call('PUT', '/alice/posts/8', { body: mine(8, 'and the quinces'), expect: 200 });
call('PUT', '/alice/posts/8', { body: junk(8, alice), expect: 409 });           // it does not turn around
call('PUT', '/alice/posts/1', { body: junk(1, thief), expect: 409 });           // listed at that number and address: hers
call('PUT', '/alice/posts/1', { body: mine(1, 'a second thought'), expect: 409 });   // she cannot overwrite her own
console.log('§8.5 — a squatter takes 7 and 8; alice reclaims both; nobody overwrites post 1\n');
rule('8.5', `A number held by a file that is not the owner's MAY be overwritten by the owner, and by nobody else. The
owner's file declares that number in its body and is either signed by the key the profile's chain
currently ends on or listed at that number and address in the index. A hub MAY check nothing on the
ordinary path of a post or a media file; it MUST NOT ignore a collision.`);

// ---- §8.6 media ----
const png = Buffer.from('\x89PNG the peonies'), ph = sha256(png);
call('PUT', `/alice/media/${ph}`, { body: Buffer.from('buy cheap watches'), expect: 400 });
hub.store.set(`alice/media/${ph}`, Buffer.from('buy cheap watches'));          // a hub that checked nothing let it in
call('PUT', `/alice/media/${ph}`, { body: png, expect: 200 });
call('PUT', `/alice/media/${ph}`, { body: Buffer.from('buy cheap watches'), expect: 409 });
call('PUT', `/alice/media/${ph}`, { body: png, expect: 409 });
console.log('§8.6 — junk at a media address is replaced by the bytes that hash to it, never the reverse\n');
rule('8.6', `A hub MUST replace a file at \`/<name>/media/<hash>\` whose bytes do not hash to that name when offered
bytes that do, and MAY refuse bytes that do not hash to the name.`);

// ---- §8.7 what a hub must do ----
const g = call('GET', '/alice/profile'), pre = hub.handle({ method: 'OPTIONS', path: '/alice/index' });
assert.ok(g.body.equals(hub.store.get('alice/profile')));
assert.deepEqual([g.headers['access-control-allow-origin'], g.headers['access-control-expose-headers'], pre.status], ['*', 'ETag', 204]);
assert.match(pre.headers['access-control-allow-methods'], /PUT/); assert.match(pre.headers['access-control-allow-headers'], /If-Match/);
console.log(`§8.7 — GET serves the stored bytes; Access-Control-Allow-Origin ${g.headers['access-control-allow-origin']}; OPTIONS → ${pre.status}\n`);
rule('8.7', `Serve back the exact bytes it was given (§2.3). Allow cross-origin reads with
\`Access-Control-Allow-Origin: *\`; a hub that accepts writes MUST answer the preflight for a cross-origin
\`PUT\` with \`If-Match\` and expose \`ETag\`.`);

// ---- §8.8 withdrawal ----
call('DELETE', '/alice/posts/2', { expect: 405 });
await pub2.withdraw(2);
call('GET', '/alice/posts/2', { expect: 200 });
const after = await see(), gone = hub.collect('alice'), end = await see();
console.log(`§8.8 — no DELETE; after withdrawing 2 the bytes are still served; the hub then drops ${gone.length} unlisted files and a reader is unmoved: ${end.verdict}\n`);
assert.deepEqual([after.note, gone, end.verdict], [['withdrawn: 2'], ['alice/posts/2', 'alice/posts/4', 'alice/posts/7', 'alice/posts/8', `alice/media/${ph}`], 'ok']);
rule('8.8', `There is no \`DELETE\`. Withdrawing removes a line from the index, not a file. A hub MAY remove a file the
current index does not list, after a grace window covering §8.3. A publisher MUST NOT tell a user that
withdrawing erased anything.`);

// ---- §8.9 your copy ----
console.log(`§8.9 — the publisher kept ${pub2.copy.size + pub.copy.size} files it wrote, every one a signed file that verifies with no hub\n`);
for (const [path, bytes] of [...pub.copy, ...pub2.copy]) if (!path.startsWith('/media/') && !path.startsWith('/feed')) assert.ok(verifyFile(bytes, [alice.x, next.x]), path);
assert.ok(pub.copy.has('/posts/1') && pub2.copy.has('/index'));
rule('8.9', 'A publisher MUST keep the signed bytes of everything it publishes.');
