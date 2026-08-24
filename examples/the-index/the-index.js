// §4 — the index: the one signed file that answers "what exists now". The live set is the fold of
// its entries in order, and a number has one hash, ever.
// Run: node examples/the-index/the-index.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, splitFile, address, sha256, signingKeyFromSeed } from '../../src/file.js';
import { commit, rotation, restore, signProfile } from '../../src/profile.js';
import { fold, checkIndex, signIndex, verifyIndex } from '../../src/index.js';
import { createReader } from '../../src/reader.js';

// Appendix B's keys and posts, so every byte printed here is the spec's own.
const key = (label) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest());
const [A1, A2, A3] = ['alice/anchor', 'alice/rotated', 'alice/restored'].map(key);
const [MUM, SIS] = ['mum', 'sis'].map((l) => ({ key: key(l), salt: `salt${l}` }));
const REC = commit(2, [MUM, SIS, { key: key('bro'), salt: 'saltbro' }]);
const AT = 'https://alice.example/alice';
const chain = [{ key: A1.x }, rotation(A1, A2, REC), restore(A2, A3, [MUM, SIS], REC)];
const profile = signProfile({ anchor: A1.x, version: 3, name: 'Alice', chain, recovery: REC, locations: [AT], read: 'cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc' }, A3);
const post1 = signFile({ n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
const post2 = signFile({ n: 2, at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1);
const post3 = signFile({ n: 3, at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you', rel: 'reply', target: { key: MUM.key.x, n: 12, hash: sha256(Buffer.from("a post of mum's")), loc: 'https://mom.example/mom' } }, A2);
const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1');
const post4 = signFile({ n: 4, at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [sha256(png)] }, A3);
const [h1, h2, h3, h4, hp] = [address(post1), address(post2), address(post3), address(post4), sha256(png)];
const h5 = '52zvhtC1WqYWvwKJqqqfxkzXBNSyrGMHFCGNLBEhhcM';        // the encrypted post of B.10; §6 builds it
const hAlt = address(signFile({ n: 2, at: '2026-07-11T18:02:00Z', text: 'rewritten by somebody' }, A3));

const body = (f) => splitFile(f).body, sig = (f) => splitFile(f).sigLine;
const abbr = (s) => s.replace(/"([\w-]{6})[\w-]{37}"/g, '"$1…"');
const shown = (s) => (s === null ? 'DOES NOT FOLD' : [...s.live.keys()].map((k) => (typeof k === 'string' ? `media ${k.slice(0, 6)}…` : k)).join('  ') || '(nothing live)');
const entries2 = [[1, h1], [2, h2], [3, h3], [2, null], [4, h4], [5, h5], [hp]];
const v1 = signIndex({ entries: [[1, h1], [2, h2], [3, h3]], version: 1, top: 3 }, A3);
const v2 = signIndex({ entries: entries2, version: 2, top: 5 }, A3);
const v3 = signIndex({ entries: [[1, h1], [3, h3], [4, h4], [5, h5], [hp], [2, h2]], version: 3, top: 5 }, A3);

// Appendix B.9–B.11 are these three files; the example is pinned to their bytes.
const vector = (f, b, s) => { assert.equal(body(f).toString(), b); assert.equal(sig(f), s); };
assert.deepEqual([h1, h2, h3, h4, hp], ['hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY', 'AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs', 'i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4', '3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo', 'fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g']);
vector(v1, `{"entries":[[1,"${h1}"],[2,"${h2}"],[3,"${h3}"]],"version":1,"top":3}`, 'XnVqNxHU5m3eu4qelsg77HFs7tngexX7YLv-y7MgxX00DH61GdGr9Lhms_65vxnCMHLYDYKiA5C_lQF7-10qDQ');
vector(v2, `{"entries":[[1,"${h1}"],[2,"${h2}"],[3,"${h3}"],[2,null],[4,"${h4}"],[5,"${h5}"],["${hp}"]],"version":2,"top":5}`, 'fkGSeMiVg9ZPdliEnWNU-Y-2bORoaQwmljSVg5HhV4xKGMc-w6K9VJ21cbqGXUMYCUU_om7dyBjz8bXMamruBQ');
vector(v3, `{"entries":[[1,"${h1}"],[3,"${h3}"],[4,"${h4}"],[5,"${h5}"],["${hp}"],[2,"${h2}"]],"version":3,"top":5}`, 'Fwobld26DKwmaKgtZ66wlfAvzDEeH9DrODnh6O2aIuLtZ1MoHiy5i2FyJhGHBEumf2aDn6l0obMsV3Ab7CDJCw');

console.log('§4 — one signed file, at /<name>/index, saying what exists now\n');
console.log(`  ${body(v1)}\n  ${sig(v1)}\n`);
console.log('  entries   the lines, in order — the live set is the fold of them (§4.2)\n  version   a non-negative integer that MUST NOT go backwards\n  top       the highest post number ever issued, which never decreases (§4.3)\n');
console.log('  That is Appendix B.9 byte for byte. With the profile it is one of the two files that are\n  legitimately overwritten (§8.1); a numbered post is written once and never again.\n');

console.log('§4.1 — four line shapes, and nothing else\n');
console.log('  [n, hash]      post number n exists, and its address is hash');
console.log('  [n, null]      post n is withdrawn');
console.log('  [hash]         the media file with that address exists — examples/media/ (§4.4)');
console.log('  [hash, null]   that media file is withdrawn\n');
console.log(`  Appendix B.10 carries the first three: post 2 withdrawn by an appended line, post 5\n  encrypted, and one media file listed by its address alone.\n\n  ${body(v2)}\n  ${sig(v2)}\n`);

console.log('§4.2 — the live set is the fold of the entries, in order\n');
for (let i = 0; i < entries2.length; i++) console.log(`  ${abbr(JSON.stringify(entries2[i])).padEnd(20)} → ${shown(fold(entries2.slice(0, i + 1)))}`);
console.log(`\n  and the fourth shape takes the media back out: ${shown(fold([...entries2, [hp, null]]))}\n`);
console.log('  Nothing here is a diff or a patch: the answer is recomputed from line one every time,\n  so two readers who joined at different versions agree about what exists today.\n');
assert.deepEqual([...fold(entries2).live.keys()], [1, 3, 4, 5, hp]);
assert.deepEqual([fold(entries2).live.get(1).hash, fold(entries2).top, fold([...entries2, [hp, null]]).live.has(hp)], [h1, 5, false]);

const files = new Map([[`${AT}/profile`, profile], [`${AT}/posts/1`, post1], [`${AT}/posts/2`, post2], [`${AT}/posts/3`, post3]]);
const reader = createReader({ get: async (p) => (files.has(p) ? { bytes: files.get(p) } : null) });
const serve = async (index, pin = null) => { files.set(`${AT}/index`, index); return reader.read({ learned: A1.x, at: AT, pin }); };

console.log('§4.2 — an index that does not fold is invalid, and the verdict is `host`\n');
for (const [what, e] of [['a number listed twice', [[1, h1], [2, h2], [2, h3]]], ['a withdrawal of nothing', [[1, h1], [9, null]]],
  ['a number below 1', [[0, h1]]], ['a media file listed twice', [[hp], [hp]]], ['a media withdrawal of nothing', [[1, h1], [hp, null]]]]) {
  console.log(`  ${what.padEnd(30)} ${abbr(JSON.stringify(e)).padEnd(46)} ${shown(fold(e))}`);
  assert.equal(fold(e), null, what);
}
const wont = await serve(signIndex({ entries: [[1, h1], [2, h2], [2, h3]], version: 4, top: 3 }, A3));
console.log(`\n  served to a reader with no pin   ${wont.verdict} — ${wont.why}\n  top has a floor of its own       ${checkIndex({ entries: [], version: 1, top: 2 }, { top: 3 })}\n  a feed that has issued nothing   top ${fold([]).top}, and ${checkIndex({ entries: [], version: 1, top: 0 }, fold([])) ?? 'valid'} (§4.3, examples/top-and-rumors/)\n`);
console.log("  `host` names the wrong party, and the spec says so: it verified, so it came from the\n  author's own key, not from a misbehaving hub. A fourth reader state was not worth the\n  complexity, and an app SHOULD word it as *the files at this address do not make sense*.\n");
assert.deepEqual([wont.verdict, wont.why], ['host', 'the index does not fold']);
assert.equal(checkIndex({ entries: [], version: 1, top: 2 }, { top: 3 }), 'top is below the highest number issued');
assert.equal(checkIndex({ entries: [], version: 1, top: 0 }, fold([])), null);

console.log('§4.2, §7.2 — a number has one hash, ever\n');
console.log(`  ${body(v3)}\n  ${sig(v3)}\n`);
console.log(`  Appendix B.11: the lines the withdrawal left behind are gone (§4.7) and post 2 is back\n  at the hash it had. It folds — ${shown(fold([[1, h1], [3, h3], [4, h4], [5, h5], [hp], [2, h2]]))}\n`);
console.log(`  withdrawn, re-listed at the identical hash  ${shown(fold([[1, h1], [2, h2], [2, null], [2, h2]]))}`);
console.log(`  withdrawn, re-listed at another hash        ${shown(fold([[1, h1], [2, h2], [2, null], [2, hAlt]]))}`);
console.log(`  after the rewrite, at another hash          ${shown(fold([[1, h1], [3, h3], [2, hAlt]]))}   ← the fold cannot see it\n`);
console.log("  Once the withdrawal line is rewritten away this index has never heard of post 2, so the\n  rule that reaches across versions is the reader's own: it keeps the hash of every number\n  it saw withdrawn (§7.2). Here is that reader, four reads deep.\n");
assert.equal(fold([[1, h1], [2, h2], [2, null], [2, h2]]).live.get(2).hash, h2);
assert.deepEqual([fold([[1, h1], [2, h2], [2, null], [2, hAlt]]), fold([[1, h1], [3, h3], [2, hAlt]]) !== null], [null, true]);

const cold = await serve(v1);
const gone = await serve(signIndex({ entries: [[1, h1], [2, h2], [3, h3], [2, null]], version: 2, top: 3 }, A3), cold.pin);
const back = await serve(signIndex({ entries: [[1, h1], [3, h3], [2, h2]], version: 3, top: 3 }, A3), gone.pin);
const swap = await serve(signIndex({ entries: [[1, h1], [3, h3], [2, hAlt]], version: 3, top: 3 }, A3), gone.pin);
for (const [what, r] of [['version 1, no pin', cold], ['version 2, [2, null] appended', gone],
  [`version 3, 2 back at ${h2.slice(0, 6)}…`, back], [`version 3, 2 back at ${hAlt.slice(0, 6)}…`, swap]]) {
  console.log(`  ${what.padEnd(31)} ${r.verdict.padEnd(5)} ${r.why ?? JSON.stringify(r.note)}`);
}
console.log(`\n  The pin kept the withdrawn hash (${gone.pin.withdrawn.get(2).slice(0, 6)}…), so the same bytes coming back are not a`);
console.log("  change. That is allowed because it is harmless — and because it is the way back from a\n  thief who held the current key and withdrew everything the owner wrote: she restores and\n  re-lists the same bytes, and readers who watched him delete them accept it in silence.\n  (`recently restored` is §3.5's note on a chain ending in a restore, not §4's business.)\n");
assert.deepEqual([cold.verdict, gone.verdict, back.verdict, swap.verdict], ['ok', 'ok', 'ok', 'host']);
assert.deepEqual([gone.note.includes('withdrawn: 2'), gone.pin.withdrawn.get(2), swap.why], [true, h2, 'post 2 changed after the reader saw it']);

const prefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const shared = prefix(body(v1), body(v2));
const last9 = JSON.stringify({ version: 9, top: 3, entries: [[1, h1], [2, h2], [3, h3]] });
const last10 = JSON.stringify({ version: 10, top: 4, entries: [[1, h1], [2, h2], [3, h3], [4, h4]] });
console.log('§4 — `entries` MUST come first, and that is not canonicalization\n');
console.log(`  version 1 body   ${body(v1).length} bytes\n  version 2 body   ${body(v2).length} bytes`);
console.log(`  shared prefix    ${shared} bytes — every entry of version 1, at the byte it was at`);
console.log(`  version 1 ends   ${body(v1).subarray(shared)}`);
console.log(`  version 2 tail   ${body(v2).length - shared} bytes, so a reader holding version 1 MAY ask for bytes ${shared}– alone:\n                   a range request conditioned on the entity tag it holds (If-Range).\n`);
console.log(`  entries last, version 9 → 10, one line appended: shared prefix ${prefix(last9, last10)} bytes — everything\n  moved, which is why a reader refuses that shape outright: ${checkIndex(JSON.parse(last9), fold(JSON.parse(last9).entries))}.\n`);
console.log('  It buys the range request and nothing else. Nobody re-serializes anything, and a verifier\n  that never heard of the rule still checks the signature correctly — §2.3, and\n  examples/no-canonicalization/.\n');
assert.ok(body(v2).subarray(0, shared).equals(body(v1).subarray(0, shared)));
assert.equal(body(v1).subarray(shared).toString(), '],"version":1,"top":3}');
assert.deepEqual([prefix(last9, last10), checkIndex(JSON.parse(last9), fold(JSON.parse(last9).entries))], [11, 'entries is not the first member']);

const thief = signIndex({ entries: [[1, h1]], version: 9, top: 3 }, A2);
const nopin = await serve(thief), held = await serve(thief, cold.pin);
console.log('§4.6 — the index MUST be signed by the key the chain currently ends on\n');
console.log(`  the chain                ${chain.map((l) => `${l.key.slice(0, 6)}…`).join(' → ')}   anchor, rotated, restored`);
console.log(`  index by the last key    ${verifyIndex(v1, A3.x) ? 'verifies' : 'no'}\n  index by the middle key  ${verifyIndex(thief, A3.x) ?? 'null'} — a key that is still in the chain\n`);
console.log(`  that index, to a reader with no pin   ${nopin.verdict} — ${nopin.why}\n  that index, to a reader holding one   ${held.verdict}   notes ${JSON.stringify(held.note)}\n`);
console.log('  The index is what admits posts. If a reader took one from any key in the chain, a thief\n  holding a rotated-out key would go on deciding what counts as hers, and a restore would\n  take nothing back. Re-signing the index is what a restore actually restores.\n');
console.log('  The honest cost is a window: between the two writes a rotation takes, a truthful host\n  serves an index signed by a key the profile no longer ends on. §7.2 answers it — an\n  unverifiable index is not an accusation, and a reader holding one it verified keeps it.\n');
assert.deepEqual([verifyIndex(thief, A3.x), verifyIndex(v1, A3.x) !== null], [null, true]);
assert.deepEqual([nopin.verdict, nopin.why], ['host', 'the index is not signed by the key the profile ends on']);
assert.deepEqual([held.verdict, held.note.includes('no index I can verify')], ['ok', true]);

console.log('Every line above is asserted.');
