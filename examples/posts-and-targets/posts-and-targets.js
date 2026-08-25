// §5 — a post: the number inside its signed bytes, an `at` that decides nothing, one `rel` for every
// kind of post, and a target naming the full hash of what it answers.
// Run: node examples/posts-and-targets/posts-and-targets.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, splitFile, verifyFile, parseBody, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { signProfile, rotation, commit } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createHub } from '../../src/hub.js';
import { createReader } from '../../src/reader.js';
import { encrypt, decrypt, carrierOf, readingKeyFromSeed } from '../../src/envelope.js';

// Appendix B's keys, so every byte printed here is the spec's own.
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), MUM = key('mum'), SIS = key('sis'), BRO = key('bro');
const xk = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${l}`).digest());
const AT = 'https://alice.example/alice', MUMAT = 'https://mom.example/mom';

// One hub as a pure handler (§8): the publisher's PUTs and the reader's fetches are both `handle`.
const hub = createHub(), say = (...lines) => console.log(lines.join('\n'));
const GET = (path) => hub.handle({ method: 'GET', path });
const put = (path, bytes) => hub.handle({ method: 'PUT', path, body: bytes, headers: { 'if-match': GET(path).headers?.etag ?? null } });
const get = async (url) => { const r = GET(new URL(url).pathname); return r.status === 200 ? { bytes: r.body, etag: r.headers.etag } : null; };
const reader = createReader({ get });
const post = (n, fields, k) => signFile({ n, ...fields }, k);
const obj = (f) => parseBody(splitFile(f).body), text = (f) => splitFile(f).body.toString();
const member = (k, salt) => ({ key: k, salt }), REC = commit([member(MUM, 'saltmum'), member(SIS, 'saltsis'), member(BRO, 'saltbro')]);

// Two identities: alice, with one rotation in her chain, and mum, who has two files saying "post 12".
put('/alice/profile', signProfile({ anchor: A1.x, name: 'Alice', version: 2, chain: [{ key: A1.x }, rotation(A1, A2, REC)], recovery: REC, locations: [AT], read: xk('vector:alice-read').x }, A2));
put('/mom/profile', signProfile({ anchor: MUM.x, name: 'Mum', version: 1, chain: [{ key: MUM.x }], recovery: commit([member(SIS, 'saltsis')]), locations: [MUMAT], read: xk('vector:mum-read').x }, MUM));
const twelveA = post(12, { at: '2026-07-18T20:00:00Z', text: 'we set a date' }, MUM);
const twelveB = post(12, { at: '2026-07-18T20:00:00Z', text: 'we called it off' }, MUM);
put('/mom/posts/12', twelveA);
put('/mom/index', signIndex({ entries: [[12, address(twelveA)]], version: 1, top: 12 }, MUM));

const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1'), pngHash = sha256(png);
const seeded = (l) => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', `openfeed/v1/vector:${l}`, '', String(i++), n)); };
const dm = encrypt({                                          // §6, seeded throughout so it reproduces
  content: { text: 'I am leaving him on Friday', rel: 'root' },
  audience: [{ key: A1.x, read: xk('vector:alice-read').x, loc: AT }, { key: MUM.x, read: xk('vector:mum-read').x, loc: MUMAT }],
  carrier: carrierOf(A1.x, 4), ephemeral: xk('vector:ephemeral/4'), contentKey: seeded('contentkey/4')(32), random: seeded('dummies/4'),
});
const p = {
  1: post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1),
  2: post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1),
  3: post(3, { at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [pngHash] }, A2),
  4: post(4, { at: '2026-08-18T21:40:00Z', encrypted: dm }, A2),                      // a message to mum
  5: post(5, { at: '1970-01-01T00:00:00Z', text: 'written before the protocol existed' }, A2),
  6: post(6, { at: '3026-01-01T00:00:00Z', text: 'written a thousand years from now' }, A2),
};
for (const n of [1, 2, 3, 4, 5, 6]) put(`/alice/posts/${n}`, p[n]);
put(`/alice/media/${pngHash}`, png);
const entries = [1, 2, 3, 4].map((n) => [n, address(p[n])]).concat([[pngHash], [5, address(p[5])], [6, address(p[6])]]);
put('/alice/index', signIndex({ entries, version: 1, top: 6 }, A2));
const first = await reader.read({ learned: A1.x, at: AT }), mumPin = (await reader.read({ learned: MUM.x, at: MUMAT })).pin;

say('§5 — a post is immutable, created once, and signed by any key in its author\'s chain\n',
  `  ${text(p[1])}`, `  ${splitFile(p[1]).sigLine}\n`,
  '  n       1                      the number this post is published at (§5.1)',
  '  at      2026-07-04T10:15:00Z   content time, and never a verdict (§5.2)',
  '  text    the peonies came back  the content; rel, target and media join it below\n',
  `  post 1 verifies under  her anchor key          ${verifyFile(p[1], first.chain.keys).by}`,
  `  post 3 verifies under  the key she rotated to  ${verifyFile(p[3], first.chain.keys).by}`,
  `  a second, different file PUT at /alice/posts/1 → ${put('/alice/posts/1', p[2]).status}, created once (§8.2)\n`);
assert.deepEqual([first.verdict, text(p[1]), splitFile(p[1]).sigLine], ['ok', '{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}', 'Pe6ZO_mwGsToFUaNh1sRuPI7kTastKn7qJ3KpXyPBupKLLJzuoZiAnfwUbXTxnULHkLkqevKxmU3q3xPj1ehDQ']);   // B.6
assert.deepEqual([verifyFile(p[1], first.chain.keys).by, verifyFile(p[3], first.chain.keys).by, put('/alice/posts/1', p[2]).status], [A1.x, A2.x, 409]);

// §5.1: the number is in the bytes, so it is in the address, so post 2 is not post 6 at any hash.
const same = { at: '2026-07-11T18:02:00Z', text: 'deleted this one' };            // post 2's at and text
const stripN = ({ n, ...rest }) => sha256(Buffer.from(JSON.stringify(rest), 'utf8'));
hub.store.set('alice/posts/6', p[2]);                                // a host serving post 2 at 6
const swapped = await reader.read({ learned: A1.x, at: AT, pin: first.pin });
hub.store.set('alice/posts/6', p[6]);
say('§5.1 — the number is inside the signed bytes\n',
  `  post 2's address                       ${address(p[2])}`,
  `  the same at and text signed at 6       ${address(post(6, same, A1))}`,
  `  with n taken out of the body, both     ${stripN(obj(p[2]))}\n`,
  '  Without the number one file is every number, and a host serves it wherever it likes. With it,\n  the host has to swap whole files — and the reader is looking:\n',
  `  genuine post 2 served at /alice/posts/6 → ${swapped.verdict}: ${swapped.why}`,
  '  Its signature is alice\'s and its bytes are untouched. It is simply not post 6 (§7.4).\n');
assert.notEqual(address(p[2]), address(post(6, same, A1)));
assert.equal(stripN(obj(p[2])), stripN(obj(post(6, same, A1))));
assert.deepEqual([swapped.verdict, swapped.why], ['host', 'post 6 is not what the index lists']);

say('§5.1 — at the hub, the number is the other half of the reclaim rule\n',
  `  a stranger replays alice's genuine post 3 into /alice/posts/9:  ${put('/alice/posts/9', p[3]).status}`,
  `  that file is signed by the key her chain ends on:               ${verifyFile(p[3], first.chain.current) !== null}`,
  `  that file declares the number 9:                                ${obj(p[3]).n === 9}`,
  `  alice then publishes her own post 9:                            ${put('/alice/posts/9', post(9, { at: '2026-08-20T10:00:00Z', text: 'mine' }, A2)).status}   reclaimed\n`,
  '  Without the number in the bytes the replay is indistinguishable from her own file for 9, and the\n  hub would have to keep it and refuse her forever. §8.5, and examples/publish-interface/.\n');
assert.deepEqual([verifyFile(p[3], first.chain.current) !== null, obj(p[3]).n, obj(GET('/alice/posts/9').body).text], [true, 3, 'mine']);

const byN = [...first.posts.keys()].sort((a, b) => a - b);
const byAt = [...first.posts.entries()].sort((a, b) => a[1].at.localeCompare(b[1].at)).map(([n]) => n);
say('§5.2 — `at` is content time, and is never a verdict\n',
  `  post 5   at 1970-01-01T00:00:00Z   ${first.posts.get(5).text}`,
  `  post 6   at 3026-01-01T00:00:00Z   ${first.posts.get(6).text}`,
  `  the read that returned both:       ${first.verdict}, notes [${first.note}]\n`,
  `  an app ordering by at   ${byAt.join(' ')}      what the index orders by (§4.2)   ${byN.join(' ')}\n`,
  '  No clock was consulted to reach that verdict, and none decides precedence: a number has one hash\n  ever (§4.2) and the index saying so is signed. §13.2 is the whole list of clocks in the protocol —\n  `at`, "recently restored", the rewrite cadence — and not one gates anything. An adversary who runs\n  the server also sets its clock.\n');
assert.deepEqual([byN, byAt], [[1, 2, 3, 4, 5, 6], [5, 1, 2, 3, 4, 6]]);

// §5.3: one object with a `rel`, so a reaction and a reply are one code path and one retention rule.
const t1 = { key: A1.x, n: 1, hash: address(p[1]), loc: AT };
const like = post(1, { at: '2026-07-05T08:00:00Z', rel: 'like', target: t1 }, SIS);
const reply = post(2, { at: '2026-07-05T08:01:00Z', text: 'they always do', rel: 'reply', target: t1 }, SIS);
say('§5.3 — a reply, a reaction, and a private message are the same kind of object\n',
  `  a reaction   ${text(like)}`, `  a reply      ${text(reply)}`,
  `  a message    ${text(p[4]).slice(0, 48)}…}}   (§5.6, below)\n`,
  '  rel is reply, root, like, repost, quote, mention or supersedes, or an absolute URL for anything\n  else. There is no reaction endpoint, no inbox, and no second verifier.\n');
assert.deepEqual([Object.keys(obj(like)), Object.keys(obj(reply))], [['n', 'at', 'rel', 'target'], ['n', 'at', 'text', 'rel', 'target']]);
assert.deepEqual([obj(like).rel, obj(reply).rel, decrypt(dm, xk('vector:mum-read').privateKey, carrierOf(A1.x, 4)).rel], ['like', 'reply', 'root']);

// §5.3: an edit is a new post that withdraws the old one — no in-place revision, no version history.
const p7 = post(7, { at: '2026-08-15T07:20:00Z', text: 'the morning after — it was thursday', rel: 'supersedes', target: { key: A1.x, n: 3, hash: address(p[3]), loc: AT } }, A2);
put('/alice/posts/7', p7);
put('/alice/index', signIndex({ entries: [...entries, [3, null], [7, address(p7)]], version: 2, top: 7 }, A2));
const edited = await reader.read({ learned: A1.x, at: AT, pin: first.pin });
const onOld = obj(post(4, { at: '2026-08-15T09:00:00Z', text: 'lovely', rel: 'reply', target: { key: A1.x, n: 3, hash: address(p[3]), loc: AT } }, SIS));
const quiet = await reader.rumors(new Map([[A1.x, edited.pin]]), new Map([[4, onOld]]), 'sis');
say('§5.3 — an edit is a new post that withdraws the old one\n', `  post 7   ${text(p7)}\n`,
  `  the read after it        ${edited.verdict}, notes [${edited.note}] — 3 is out of the live set`,
  `  the pin keeps its hash   3 → ${edited.pin.withdrawn.get(3)}`,
  `  so sis's older reply to (3, that hash) still resolves: unresolved? ${onOld.target.unresolved === true}, said [${quiet}]\n`,
  '  A reader holding post 7 SHOULD show replies targeting the superseded (n, hash) under it, or every\n  edit orphans its thread. Post 3 is withdrawn, not revised, and there is no version history.\n');
assert.deepEqual([edited.verdict, edited.note, edited.posts.has(3)], ['ok', ['withdrawn: 3'], false]);
assert.deepEqual([edited.pin.withdrawn.get(3), onOld.target.unresolved, quiet], [address(p[3]), undefined, []]);

// §5.4: the spec's own reply, Appendix B.7 byte for byte.
const b7 = post(3, { at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you', rel: 'reply', target: { key: MUM.x, n: 12, hash: sha256(Buffer.from("a post of mum's")), loc: MUMAT } }, A2);
say('§5.4 — target: an anchor key, a number, all 43 characters of the hash, and a location\n',
  `  ${text(b7)}`, `  ${splitFile(b7).sigLine}\n`,
  `  key    ${MUM.x}   mum's anchor key, never a URL`,
  `  n      ${'12'.padEnd(43)}   the number she published it at`,
  `  hash   ${obj(b7).target.hash}   all 43 characters, never a prefix`,
  `  loc    ${MUMAT.padEnd(43)}   where the replier last knew her to live (§3.7)\n`,
  '  The URL can change and the identity cannot, so the key is the identity and `loc` is only a hint.\n  All four members are REQUIRED once `rel` names another post.\n');
assert.equal(text(b7), `{"n":3,"at":"2026-07-19T09:30:00Z","text":"congratulations, both of you","rel":"reply","target":{"key":"${MUM.x}","n":12,"hash":"_wcb5V3yCD3C6KmN7mOmNw3DKJcRdBJItfW0Z-Ic_kc","loc":"https://mom.example/mom"}}`);
assert.deepEqual([splitFile(b7).sigLine, obj(b7).target.hash.length], ['S4mRckyGslGrhS5n9O6KmD0qqweGXOzu784PMH3sUHgrDqD5SliKvKiecBa6JWbIm9y1hkFTzor1_Bzqd433Dw', 43]);

// §5.4: mum has two files that each say "post 12"; her signed index lists one of them.
const onA = obj(post(3, { at: '2026-07-19T09:00:00Z', text: 'wonderful news', rel: 'reply', target: { key: MUM.x, n: 12, hash: address(twelveA), loc: MUMAT } }, SIS));
const onB = obj(post(4, { at: '2026-07-19T09:05:00Z', text: 'wonderful news', rel: 'reply', target: { key: MUM.x, n: 12, hash: address(twelveB), loc: MUMAT } }, SIS));
const onC = obj(post(5, { at: '2026-07-19T09:06:00Z', text: 'wonderful news', rel: 'reply', target: { key: MUM.x, n: 12, hash: address(twelveA).slice(0, 16), loc: MUMAT } }, SIS));
const said = await reader.rumors(new Map([[MUM.x, mumPin]]), new Map([[3, onA], [4, onB], [5, onC]]), 'sis');
say('§5.4 — a reply whose target hash the index does not list is a reply to something else\n',
  `  ${`"${obj(twelveA).text}"`.padEnd(20)}${address(twelveA)}   ← what mum's index lists`,
  `  ${`"${obj(twelveB).text}"`.padEnd(20)}${address(twelveB)}   ← what she showed somebody else\n`,
  `  sis's reply to the first    threads; unresolved? ${onA.target.unresolved === true}`,
  `  sis's reply to the second   unresolved? ${onB.target.unresolved === true}, and the reader says [${said}]`,
  `  a 16-character prefix       unresolved? ${onC.target.unresolved === true} — all 43 characters, or it is another post\n`,
  '  Both replies are genuine, signed, and name post 12. Threading on the number alone would show two\n  coherent threads under one post; the hash makes the second land nowhere at all.\n');
assert.notEqual(address(twelveA), address(twelveB));
assert.deepEqual([onA.target.unresolved, onB.target.unresolved, onC.target.unresolved, said], [undefined, true, true, []]);

say('§5.5 — media is a list of addresses, and an encrypted post carries none\n', `  post 3   ${text(p[3])}\n`,
  `  the index lists that file by its address alone and the reader checks the bytes: ${sha256(edited.media.get(pngHash)) === pngHash}`,
  `  post 4's public members:  ${Object.keys(obj(p[4])).join(', ')}  — no media, no rel, no target\n`,
  '  On an encrypted post media, rel and target are inside the envelope, and each media entry is\n  {hash, key} rather than a bare hash (§6.5). See examples/media/ and examples/envelope/.\n');
assert.deepEqual([obj(p[3]).media, sha256(edited.media.get(pngHash))], [[pngHash], pngHash]);
assert.deepEqual(Object.keys(obj(p[4])), ['n', 'at', 'encrypted']);

// §5.6: a message to one person is post 4, on alice's own host, listed in her own index.
say('§5.6 — a private message is a post\n',
  `  it lives at /alice/posts/4, listed by alice's index, and there is no inbox: PUT /mom/inbox → ${hub.handle({ method: 'PUT', path: '/mom/inbox', body: Buffer.from('hi') }).status}`,
  `  a non-recipient's reading key opens ${decrypt(obj(p[4]).encrypted, xk('vector:host-read').privateKey, carrierOf(A1.x, 4))}; mum's opens "${decrypt(obj(p[4]).encrypted, xk('vector:mum-read').privateKey, carrierOf(A1.x, 4)).text}"\n`,
  '  What the host learns and can withhold is examples/envelope/ and examples/the-reader/; that mum can\n  prove it forever, and keeps her copy, is examples/your-copy/.\n');
assert.deepEqual([hub.handle({ method: 'PUT', path: '/mom/inbox', body: Buffer.from('hi') }).status, decrypt(obj(p[4]).encrypted, xk('vector:host-read').privateKey, carrierOf(A1.x, 4))], [404, null]);

console.log('Every line above is asserted.');
