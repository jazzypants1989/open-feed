// §4.7 — a withdrawal is an appended line, and the lines it leaves behind go when the author next
// rewrites the whole file. Run: node examples/rewrite/rewrite.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, splitFile, address, sha256, verifyFile, signingKeyFromSeed } from '../../src/file.js';
import { signIndex, fold, liveEntries } from '../../src/index.js';
import { signProfile, commit, rotation, restore } from '../../src/profile.js';
import { encrypt, carrierOf, readingKeyFromSeed } from '../../src/envelope.js';
import { createReader } from '../../src/reader.js';

// Appendix B's keys and Appendix B's identity, so the indexes below are the spec's own bytes.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const xkey = (label) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${label}`).digest());
const A1 = key('alice/anchor'), A2 = key('alice/rotated'), A3 = key('alice/restored'), AT = 'https://alice.example/alice';
const mum = { key: key('mum'), salt: 'saltmum' }, sis = { key: key('sis'), salt: 'saltsis' }, bro = { key: key('bro'), salt: 'saltbro' };
const REC = commit(2, [mum, sis, bro]), chain = [{ key: A1.x }, rotation(A1, A2, REC), restore(A2, A3, [mum, sis], REC)];
const profile = signProfile({ anchor: A1.x, version: 3, name: 'Alice', chain, recovery: REC, locations: [AT], read: xkey('vector:alice-read').x }, A3);

const post = (n, fields, k) => signFile({ n, ...fields }, k);
const p1 = post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const p2 = post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1);
const p3 = post(3, { at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you', rel: 'reply', target: { key: mum.key.x, n: 12, hash: sha256(Buffer.from("a post of mum's")), loc: 'https://mom.example/mom' } }, A2);
const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1'), pngHash = sha256(png);
const p4 = post(4, { at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [pngHash] }, A3);
// Post 5 is Appendix B.8's encrypted post, reproduced only so the indexes below are the spec's exact bytes.
const p5 = post(5, { at: '2026-08-18T21:40:00Z', encrypted: encrypt({ content: { text: 'I am leaving him on Friday', rel: 'root' }, carrier: carrierOf(A1.x, 5), ephemeral: xkey('vector:ephemeral/5'), contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/5').digest(),
  audience: [{ key: A1.x, read: xkey('vector:alice-read').x, loc: AT }, { key: mum.key.x, read: xkey('vector:mum-read').x, loc: 'https://mom.example/mom' }],
  random: (() => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', 'openfeed/v1/vector:dummies/5', '', String(i++), n)); })() }) }, A3);
const p6 = post(6, { at: '2026-09-02T08:00:00Z', text: 'the first cold morning' }, A3);
const h = Object.fromEntries([p1, p2, p3, p4, p5, p6].map((f, i) => [i + 1, address(f)]));

// Six versions of one file: an append, a rewrite, an append, a rewrite, an append.
const idx = (entries, version, top) => signIndex({ entries, version, top }, A3);
const line = (e) => JSON.stringify(e), bodyOf = (f) => splitFile(f).body.toString();
const bytes = (es) => es.reduce((t, e) => t + line(e).length + 1, 0);
const e1 = [[1, h[1]], [2, h[2]], [3, h[3]]], e2 = [...e1, [2, null], [4, h[4]], [5, h[5]], [pngHash]], kept = liveEntries(e2);
const e3 = [...kept, [2, h[2]]], e4 = [...e3, [3, null]], e5 = liveEntries(e4), e6 = [...e5, [6, h[6]]];
const v = [null, idx(e1, 1, 3), idx(e2, 2, 5), idx(e3, 3, 5), idx(e4, 4, 5), idx(e5, 5, 5), idx(e6, 6, 6)];

const keptSet = new Set(kept.map(line)), orphaned = e2.filter((e) => !keptSet.has(line(e)));
console.log('§4.7 — a withdrawal is an appended line, and a rewrite is what takes it away\n');
console.log('  version 2 — post 2 withdrawn, then a post, a post and a media file appended');
for (const e of e2) console.log(`    ${line(e).padEnd(50)}${keptSet.has(line(e)) ? '' : '  ← left behind by the withdrawal'}`.trimEnd());
console.log('\n  version 3 — the same file, written out again from the fold');
for (const e of e3) console.log(`    ${line(e).padEnd(50)}${line(e) === line([2, h[2]]) ? '  ← §4.2\'s one legal repeat, below' : ''}`.trimEnd());
console.log('\n  both files  Appendix B.10 and B.11 of the spec, byte for byte');
console.log(`\n  ${bodyOf(v[2]).length} bytes of body, ${bytes(orphaned)} of them the two lines about post 2; the rewrite drops both, and`);
console.log(`  version 3 is ${bodyOf(v[3]).length} because it re-lists post 2. How often is the publisher's setting (§4.7),`);
console.log('  and a suggested default is once a month.\n');
assert.equal(orphaned.length, 2);
assert.equal(bodyOf(v[2]), '{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"],[2,null],[4,"3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo"],[5,"52zvhtC1WqYWvwKJqqqfxkzXBNSyrGMHFCGNLBEhhcM"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"]],"version":2,"top":5}');
assert.equal(bodyOf(v[3]), '{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"],[4,"3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo"],[5,"52zvhtC1WqYWvwKJqqqfxkzXBNSyrGMHFCGNLBEhhcM"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"]],"version":3,"top":5}');
assert.equal(splitFile(v[2]).sigLine, 'fkGSeMiVg9ZPdliEnWNU-Y-2bORoaQwmljSVg5HhV4xKGMc-w6K9VJ21cbqGXUMYCUU_om7dyBjz8bXMamruBQ');
assert.equal(splitFile(v[3]).sigLine, 'Fwobld26DKwmaKgtZ66wlfAvzDEeH9DrODnh6O2aIuLtZ1MoHiy5i2FyJhGHBEumf2aDn6l0obMsV3Ab7CDJCw');

// The rewrite is a re-spelling of the fold's answer (§4.2), which is what makes it safe to do at all.
const shown = (s) => `posts ${[...s.live.keys()].filter(Number.isInteger).sort((a, b) => a - b).join(', ')} and ${[...s.live.keys()].filter((k) => typeof k === 'string').length} media file`;
const [f2, fk] = [fold(e2), fold(kept)];
console.log('§4.7 — the rewrite changes the file and never the live set\n');
console.log(`  version 2, folded            ${shown(f2)}, top ${f2.top}`);
console.log(`  the lines it keeps, folded   ${shown(fk)}, top ${fk.top}   identical`);
console.log('\n  The live set is what a rewrite must not touch, and that identity is its whole safety');
console.log('  argument. Version 3 also re-lists post 2, and that is a second act, not part of rewriting.\n');
assert.deepEqual([...f2.live.keys()], [...fk.live.keys()]); assert.equal(f2.top, fk.top);

const files = new Map([[`${AT}/profile`, profile], [`${AT}/media/${pngHash}`, png], ...[p1, p2, p3, p4, p5, p6].map((f, i) => [`${AT}/posts/${i + 1}`, f])]);
const reader = createReader({ get: async (p) => (files.has(p) ? { bytes: files.get(p), etag: '"t"' } : null) });
const serve = (n) => files.set(`${AT}/index`, v[n]);
const T0 = Date.parse('2026-07-05T00:00:00Z'), T1 = Date.parse('2026-09-03T00:00:00Z');

serve(1); const at1 = await reader.read({ learned: A1.x, at: AT, now: T0 });
serve(6); const at6 = await reader.read({ learned: A1.x, at: AT, pin: at1.pin, now: T1 });
console.log('§7.2 — a reader that last saw version 1 returns at version 6\n');
console.log('  in between   2 an append, 3 a rewrite, 4 an append, 5 a rewrite, 6 an append — none of them seen');
console.log(`  verdict      ${at6.verdict}`);
console.log(`  notes        ${at6.note.join(', ')}`);
console.log(`  live         ${shown(fold(e6))}`);
console.log(`  its pin now remembers post 3 withdrawn at ${at6.pin.withdrawn.get(3)}`);
console.log('\n  Four of those six versions this reader never saw, and it is indifferent to all of them. The');
console.log('  one thing it is owed — a post it held is gone — is a note on an ok read, never a verdict.\n');
assert.equal(at1.verdict, 'ok'); assert.equal(at6.verdict, 'ok'); assert.deepEqual(at6.note, ['withdrawn: 3']);
assert.deepEqual([...at6.posts.keys()].sort((a, b) => a - b), [1, 2, 4, 5, 6]); assert.equal(at6.pin.withdrawn.get(3), h[3]);

// §4.2: a number may come back only at the hash it had, and the pin is what remembers.
serve(2); const at2 = await reader.read({ learned: A1.x, at: AT, pin: at1.pin, now: T0 });
serve(3); const legal = await reader.read({ learned: A1.x, at: AT, pin: at2.pin, now: T1 });
files.set(`${AT}/index`, idx([...kept, [2, sha256(Buffer.from('some other post'))]], 3, 5));
const twin = await reader.read({ learned: A1.x, at: AT, pin: at2.pin, now: T1 });
console.log('§4.2 — a number that comes back, and its illegal twin\n');
console.log(`  a reader pinned at version 2 remembers  post 2 withdrawn at ${at2.pin.withdrawn.get(2)}`);
console.log(`  version 3 re-lists 2 at that same hash  ${legal.verdict}     the same bytes coming back are no change`);
console.log(`  a twin re-lists 2 at another hash       ${twin.verdict}   ${twin.why}`);
console.log('\n  Re-listing at the identical hash is the way back from a thief who held the current key and');
console.log('  withdrew everything. The other half of the rule — one hash per number inside a single index');
console.log('  — is examples/the-index/.\n');
assert.equal(at2.pin.withdrawn.get(2), h[2]); assert.equal(legal.verdict, 'ok');
assert.equal(twin.verdict, 'host'); assert.equal(twin.why, 'post 2 changed after the reader saw it');

// A year of a family feed: 150 posts, one in twenty withdrawn some weeks after it was published.
const gone = new Set([20, 40, 60, 80, 100, 120, 140]), year = [];
for (let n = 1; n <= 150; n++) { year.push([n, sha256(Buffer.from(`post ${n}`))]); if (gone.has(n - 6)) year.push([n - 6, null]); }
const yearKept = new Set(liveEntries(year).map(line)), leftover = year.filter((e) => !yearKept.has(line(e)));
const whole = idx(year, 12, 150).length, share = (100 * bytes(leftover)) / whole;
console.log('§4.7 — a privacy decision, and never a size one\n');
console.log(`  a year of a family feed   150 posts, ${gone.size} of them withdrawn`);
console.log(`  the whole index file      ${whole} bytes`);
console.log(`  the lines a rewrite drops ${bytes(leftover)} bytes`);
console.log(`  which is                  ${share.toFixed(1)}% of the file   — the spec says "about 6%"\n`);
console.log('  Half a kilobyte off an eight-kilobyte file. A publisher who rewrites to save bandwidth has');
console.log('  misread what it is for: the reason to do it is that a withdrawn line stops being public.\n');
assert.equal(leftover.length, 2 * gone.size); assert.equal(share.toFixed(1), '5.5');

serve(6); const later = await reader.read({ learned: A1.x, at: AT, now: T1 });
console.log('§8.8, §13.1 — what rewriting buys, and what it does not\n');
console.log(`  a reader arriving now sees, of post 3     ${bodyOf(v[6]).includes('[3,') ? 'a line' : 'nothing at all'}`);
console.log(`  post 3's bytes, still at /posts/3         served, and still verify: ${verifyFile(files.get(`${AT}/posts/3`), chain.map((l) => l.key)) !== null}`);
console.log(`  the operator's own archive, version 4     ${line(e4.find((e) => e[1] === null))} — the line, and the hour he served it`);
console.log('\n  Rewriting buys one thing: a withdrawn post\'s line stops being visible to later readers and');
console.log('  to the public. Against a host operator who kept every version he served it buys nothing');
console.log('  (§13.1). A hub MAY drop a file the current index does not list, and an app MUST NOT tell a');
console.log('  user that withdrawing erased anything (§8.8).\n');
assert.equal(bodyOf(v[6]).includes('[3,'), false); assert.ok(bodyOf(v[4]).includes('[3,null]'));
assert.equal(later.verdict, 'ok'); assert.equal(later.posts.has(3), false);
assert.ok(verifyFile(files.get(`${AT}/posts/3`), chain.map((l) => l.key)));

console.log('Every line above is asserted.');
