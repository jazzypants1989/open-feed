// §5 — posts: the number in the bytes, `at`, `rel`, `target`, `media`, private messages.
// Run: node examples/posts/posts.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signFile, splitFile, verifyFile, parseBody, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { signProfile, rotation, commit } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createHub } from '../../src/hub.js';
import { createReader } from '../../src/reader.js';
import { encrypt, decrypt, postBinding, readingKeyFromSeed } from '../../src/envelope.js';

// The test vectors' keys.
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), MUM = key('mum'), SIS = key('sis'), BRO = key('bro');
const xk = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${l}`).digest());
const AT = 'https://alice.example/alice', MUMAT = 'https://mom.example/mom';
const hub = createHub();
const GET = (path) => hub.handle({ method: 'GET', path });
const put = (path, bytes) => hub.handle({ method: 'PUT', path, body: bytes, headers: { 'if-match': GET(path).headers?.etag ?? null } });
const reader = createReader({ get: async (url) => { const r = GET(new URL(url).pathname); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; } });
const post = (number, fields, k) => signFile({ number, ...fields }, k);
const obj = (f) => parseBody(splitFile(f).body), text = (f) => splitFile(f).body.toString();
const member = (k, salt) => ({ key: k, salt }), REC = commit([member(MUM, 'saltmum'), member(SIS, 'saltsis'), member(BRO, 'saltbro')]);

put('/alice/profile', signProfile({ anchor: A1.x, name: 'Alice', version: 2, chain: [{ key: A1.x }, rotation(A1, A2, REC)], recovery: REC, locations: [AT], read: xk('vector:alice-read').x }, A2));
put('/mom/profile', signProfile({ anchor: MUM.x, name: 'Mum', version: 1, chain: [{ key: MUM.x }], recovery: commit([member(SIS, 'saltsis')]), locations: [MUMAT], read: xk('vector:mum-read').x }, MUM));
const twelveA = post(12, { at: '2026-07-18T20:00:00Z', text: 'we set a date' }, MUM), twelveB = post(12, { at: '2026-07-18T20:00:00Z', text: 'we called it off' }, MUM);
put('/mom/posts/12', twelveA);
put('/mom/index', signIndex({ entries: [[12, address(twelveA)]], version: 1, highest: 12 }, MUM));

const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1'), pngHash = sha256(png);
const seeded = (l) => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', `openfeed/v1/vector:${l}`, '', String(i++), n)); };
const dm = encrypt({ content: { text: 'I am leaving him on Friday', rel: 'root' }, audience: [{ key: A1.x, read: xk('vector:alice-read').x, location: AT }, { key: MUM.x, read: xk('vector:mum-read').x, location: MUMAT }],
  binding: postBinding(A1.x, 4), ephemeral: xk('vector:ephemeral/4'), contentKey: seeded('contentkey/4')(32), random: seeded('dummies/4') });
const p = {
  1: post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1),
  2: post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1),
  3: post(3, { at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [pngHash] }, A2),
  4: post(4, { at: '2026-08-18T21:40:00Z', encrypted: dm }, A2),
  5: post(5, { text: 'no at at all' }, A2),
  6: post(6, { at: 'last tuesday', text: 'a malformed at' }, A2),
};
for (const number of Object.keys(p)) put(`/alice/posts/${number}`, p[number]);
put(`/alice/media/${pngHash}`, png);
const entries = [1, 2, 3, 4, 5, 6].map((number) => [number, address(p[number])]).concat([[pngHash]]);
put('/alice/index', signIndex({ entries, version: 1, highest: 6 }, A2));
const first = await reader.read({ learned: A1.x, at: AT }), mumPin = (await reader.read({ learned: MUM.x, at: MUMAT })).checkpoint;

// ---- §5 a post ----
console.log('§5 — a post\n');
console.log(`  ${text(p[1])}\n`);
assert.deepEqual([first.verdict, text(p[1])], ['ok', '{"number":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}']);
assert.deepEqual([verifyFile(p[1], first.chain.keys).by, verifyFile(p[3], first.chain.keys).by, put('/alice/posts/1', p[2]).status], [A1.x, A2.x, 409]);
rule('5', `\`\`\`json
{"number":7,"at":"2026-08-01T09:00:00Z","text":"the divorce is final",
 "rel":"reply",
 "target":{"key":"<anchor>","number":3,"hash":"<hash>","location":"https://mom.example/mom"},
 "media":["<media hash>"]}
\`\`\`

A post is immutable, created once (§8.2), and signed by any key in its author's chain.`);

// ---- §5.1 number ----
hub.store.set('alice/posts/6', p[2]);                                // genuine post 2, served at 6
const swapped = await reader.read({ learned: A1.x, at: AT, checkpoint: first.checkpoint });
hub.store.set('alice/posts/6', p[6]);
console.log(`§5.1 — genuine post 2 served at /posts/6: ${swapped.verdict}: ${swapped.why}\n`);
assert.notEqual(address(p[2]), address(post(6, { at: obj(p[2]).at, text: obj(p[2]).text }, A1)));
assert.deepEqual([swapped.verdict, swapped.why], ['tampered', 'post 6 is not what the index lists']);
rule('5.1', `A post MUST declare the number it is published at inside its signed bytes. A file served at \`/posts/<number>\`
whose \`number\` is another number is not that post (§7.1).`);

// ---- §5.2 at ----
console.log(`§5.2 — post 5 has no at, post 6 a malformed one: ${first.verdict}, both present: ${first.posts.has(5) && first.posts.has(6)}\n`);
assert.deepEqual([first.posts.get(5).at, first.posts.get(6).at, first.note], [undefined, 'last tuesday', []]);
rule('5.2', `\`at\` is an RFC 3339 timestamp. It is what apps display and order by, and it decides nothing else: no
verdict in this protocol is reached from a clock. A reader MUST NOT reject a post for a missing or
malformed \`at\`.`);

// ---- §5.3 rel ----
const t1 = { key: A1.x, number: 1, hash: address(p[1]), location: AT };
const like = post(1, { at: '2026-07-05T08:00:00Z', rel: 'like', target: t1 }, SIS);
assert.deepEqual([obj(like).rel, decrypt(dm, xk('vector:mum-read').privateKey, postBinding(A1.x, 4)).rel], ['like', 'root']);
// An edit: post 7 supersedes post 3, and 3 is withdrawn; a reply to (3, hash) still resolves under the checkpoint.
const p7 = post(7, { at: '2026-08-15T07:20:00Z', text: 'the morning after — it was thursday', rel: 'supersedes', target: { key: A1.x, number: 3, hash: address(p[3]), location: AT } }, A2);
put('/alice/posts/7', p7);
put('/alice/index', signIndex({ entries: [...entries, [3, null], [7, address(p7)]], version: 2, highest: 7 }, A2));
const edited = await reader.read({ learned: A1.x, at: AT, checkpoint: first.checkpoint });
const onOld = obj(post(4, { at: '2026-08-15T09:00:00Z', text: 'lovely', rel: 'reply', target: { key: A1.x, number: 3, hash: address(p[3]), location: AT } }, SIS));
const quiet = await reader.rumors(new Map([[A1.x, edited.checkpoint]]), new Map([[4, onOld]]), 'sis');
console.log(`§5.3 — post 7 supersedes 3: ${edited.verdict}, ${edited.note.join('; ')}; a reply to (3, its hash) still resolves: ${onOld.target.unresolved !== true}\n`);
assert.deepEqual([edited.verdict, edited.note, edited.posts.has(3), edited.checkpoint.withdrawn.get(3), onOld.target.unresolved, quiet], ['ok', ['withdrawn: 3'], false, address(p[3]), undefined, []]);
rule('5.3', `\`rel\` is \`reply\`, \`root\`, \`like\`, \`repost\`, \`quote\`, \`mention\`, or \`supersedes\`, or an absolute URL for anything
else. An edit is a new post with \`rel: "supersedes"\` naming the old one, which is withdrawn; a reader
holding the superseding post SHOULD show replies that target the superseded \`(number, hash)\` under it.`);

// ---- §5.4 target ----
const b7 = post(3, { at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you', rel: 'reply', target: { key: MUM.x, number: 12, hash: sha256(Buffer.from("a post of mum's")), location: MUMAT } }, A2);
assert.deepEqual([Object.keys(obj(b7).target), obj(b7).target.hash.length], [['key', 'number', 'hash', 'location'], 43]);
const onA = obj(post(3, { at: '2026-07-19T09:00:00Z', text: 'wonderful news', rel: 'reply', target: { key: MUM.x, number: 12, hash: address(twelveA), location: MUMAT } }, SIS));
const onB = obj(post(4, { at: '2026-07-19T09:05:00Z', text: 'wonderful news', rel: 'reply', target: { key: MUM.x, number: 12, hash: address(twelveB), location: MUMAT } }, SIS));
const onC = obj(post(5, { at: '2026-07-19T09:06:00Z', text: 'wonderful news', rel: 'reply', target: { key: MUM.x, number: 12, hash: address(twelveA).slice(0, 16), location: MUMAT } }, SIS));
const said = await reader.rumors(new Map([[MUM.x, mumPin]]), new Map([[3, onA], [4, onB], [5, onC]]), 'sis');
console.log(`§5.4 — mum's index lists one post 12; a reply to it resolves, a reply to her other "post 12" does not, a 16-character prefix does not\n`);
assert.notEqual(address(twelveA), address(twelveB));
assert.deepEqual([onA.target.unresolved, onB.target.unresolved, onC.target.unresolved, said], [undefined, true, true, []]);
rule('5.4', `\`\`\`json
"target": {"key":"<author anchor>","number":3,"hash":"<43 chars>","location":"https://mom.example/mom"}
\`\`\`

All four members are REQUIRED on a post whose \`rel\` names another post: \`key\` is the target author's
anchor key, \`number\` the target's number, \`hash\` the full 43-character address of the target post,
and \`location\` where the replier last knew that author to be served (§3.5). A reader MUST treat a
reply whose \`hash\` is not what the target's index lists for \`number\` — now, or when it was
withdrawn — as a reply to something else.`);

// ---- §5.5 media ----
console.log(`§5.5 — post 3 lists ${JSON.stringify(obj(p[3]).media).replace(/"[\w-]{43}"/, '"…"')}; encrypted post 4's public members are ${Object.keys(obj(p[4])).join(', ')}\n`);
assert.deepEqual([obj(p[3]).media, sha256(edited.media.get(pngHash)), Object.keys(obj(p[4]))], [[pngHash], pngHash, ['number', 'at', 'encrypted']]);
rule('5.5', `An array of media addresses (§4.3). On an encrypted post, \`rel\`, \`target\` and \`media\` are inside the
envelope (§6.5); the public file carries only \`number\`, \`at\`, and \`encrypted\`.`);

// ---- §5.6 private messages ----
console.log(`§5.6 — post 4 is a message to mum on alice's hub; PUT /mom/inbox → ${hub.handle({ method: 'PUT', path: '/mom/inbox', body: Buffer.from('hi') }).status}\n`);
assert.ok(edited.posts.has(4));
assert.deepEqual([hub.handle({ method: 'PUT', path: '/mom/inbox', body: Buffer.from('hi') }).status, decrypt(obj(p[4]).encrypted, xk('vector:hub-read').privateKey, postBinding(A1.x, 4)), decrypt(obj(p[4]).encrypted, xk('vector:mum-read').privateKey, postBinding(A1.x, 4)).text], [404, null, 'I am leaving him on Friday']);
rule('5.6', `A private message is a post encrypted to its recipients (§6), listed in the sender's own index. There is
no inbox.`);
