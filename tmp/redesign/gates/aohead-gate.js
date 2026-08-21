// aohead-gate: the append-only head. A withdrawal is an appended [n, null] line and the author
// rewrites the file occasionally (a compaction). RULINGS §11.2 is open on this shape; the handoff
// asks for the live set as a fold, admission under the fold, a reader-relative tail, a compaction
// that is a visible full rewrite and still verifies, the prev chain across it, and what a hostile
// host can do to a retraction line.
// Kill criteria: a fold that disagrees with the flat list of the same history; a re-admitted number
// accepted; a tail reconstruction that verifies after a rewrite; a compaction that changes a live
// entry's hash and is accepted by a reader that held the previous head; a retraction line removable
// without breaking the signature; a reply to a withdrawn top post reading as a rumor.
import { makeKey, sign, split, verify, address, entriesEnd, parseStrict, GateError } from './lastline.js';

const alice = makeKey('alice'), thief = makeKey('thief');
const post = (n, by = alice) => sign({ n, text: `post ${n}` }, by);

// ---- the head on trial ----
// entries first so an append leaves every earlier byte where it was. `top` is the highest number
// ever issued; it never decreases, which is what keeps ruling 11.1's "above the top" rule honest
// once a compaction has removed the newest post's retraction line (claim 9).
const aoBody = ({ entries, hseq, top, prev }) => JSON.stringify({ entries, hseq, top, ...(prev ? { prev } : {}) });
const aoHead = (fields, key = alice) => sign(null, key, { bodyText: aoBody(fields) });

// The fold. [n, hash] admits, [n, hash, 'pending'] admits provisionally (RULINGS §11.5),
// [n, null] withdraws. A number is issued once (ruling 3), so the only legal second line for n is
// a pending entry confirmed with the identical hash, or its withdrawal.
function fold(entries) {
  const live = new Map(), issued = new Map();
  for (const [n, hash, flag] of entries) {
    if (hash === null) {
      if (!live.has(n)) throw new GateError(`withdrawal of ${n}, which is not live`);
      live.delete(n);
    } else if (issued.has(n)) {
      const e = issued.get(n);
      if (!e.pending) throw new GateError(`number ${n} listed twice`);
      if (e.hash !== hash) throw new GateError(`pending ${n} confirmed with a different hash`);
      issued.set(n, { hash, pending: false }); live.set(n, { hash, pending: false });
    } else {
      const e = { hash, pending: flag === 'pending' };
      issued.set(n, e); live.set(n, e);
    }
  }
  return { live, issued };
}

// Reading a head: signature, strict JSON, the fold, and — against whatever the reader last held —
// hseq forward and top never backwards. `prev` is only checkable by a reader that saw the version
// immediately before this one; across a gap, hseq and the rewrite check are what carry it.
function readHead(file, { x = alice.x, held = null } = {}) {
  if (!verify(file, x)) throw new GateError('head: signature invalid');
  const body = split(file).body, obj = parseStrict(body.toString('utf8'));
  const { live, issued } = fold(obj.entries);
  if (obj.top < Math.max(0, ...obj.entries.map(([n]) => n))) throw new GateError('head: top below a listed number');
  if (held) {
    const p = readHead(held, { x });
    if (obj.hseq <= p.obj.hseq) throw new GateError('head: hseq did not advance');
    if (obj.top < p.obj.top) throw new GateError('head: top went backwards');
    const adjacent = obj.hseq === p.obj.hseq + 1;
    if (adjacent && obj.prev !== address(held)) throw new GateError('head: prev does not chain');
  }
  return { obj, live, issued, body, chained: obj.prev === address(held ?? file) };
}
const admits = (h, n, file) => h.live.get(n)?.hash === address(file);

// A rewrite (the entries array is not an extension of the one the reader holds) is checked against
// what the reader already verified: every live entry either survived unchanged or is a number
// above the old top. What vanished is reported as a withdrawal, which is all a compaction may hide.
function rewriteOK(prev, cur) {
  const withdrawn = [];
  for (const [n, e] of cur.live) {
    if (n > prev.obj.top) continue;
    const was = prev.live.get(n);
    if (!was) return { ok: false, why: `${n} is live now and was not before`, withdrawn };
    if (was.hash !== e.hash) return { ok: false, why: `${n} changed hash across the rewrite`, withdrawn };
  }
  for (const n of prev.live.keys()) if (!cur.live.has(n)) withdrawn.push(n);
  return { ok: true, withdrawn };
}

// ---- the reader-relative tail ----
const stableEnd = (file) => entriesEnd(split(file).body) - 1;                  // just before the closing ']'
const tailBytes = (cached, served) => served.length - stableEnd(cached);
const reconstruct = (cached, served) =>
  Buffer.concat([split(cached).body.subarray(0, stableEnd(cached)), served.subarray(stableEnd(cached))]);

// ---- a history: 1..6 published, 4 withdrawn, 7 appended ----
const posts = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, post(n)]));
const E = (n) => [n, address(posts[n])];
const v1 = aoHead({ entries: [1, 2, 3, 4, 5, 6].map(E), hseq: 1, top: 6 });
const v2 = aoHead({ entries: [...[1, 2, 3, 4, 5, 6].map(E), [4, null]], hseq: 2, top: 6, prev: address(v1) });
const v3 = aoHead({ entries: [...[1, 2, 3, 4, 5, 6].map(E), [4, null], E(7)], hseq: 3, top: 7, prev: address(v2) });
const r1 = readHead(v1), r2 = readHead(v2, { held: v1 }), r3 = readHead(v3, { held: v2 });

// The same three states as a flat list, for the contrast in claim 5.
const f1 = aoHead({ entries: [1, 2, 3, 4, 5, 6].map(E), hseq: 1, top: 6 });
const f2 = aoHead({ entries: [1, 2, 3, 5, 6].map(E), hseq: 2, top: 6, prev: address(f1) });

// A compaction at hseq 4: the live set, written out flat, chained to v3.
const c4 = aoHead({ entries: [1, 2, 3, 5, 6, 7].map(E), hseq: 4, top: 7, prev: address(v3) });
const r4 = readHead(c4, { held: v3 });
const bad = (entries, note) => { try { const c = readHead(aoHead({ entries, hseq: 4, top: 7, prev: address(v3) }), { held: v3 }); return rewriteOK(r3, c); } catch (e) { return { ok: false, why: `${note}: ${e.message}` }; } };

// ---- what a hostile host can do to the retraction line ----
// Every contiguous deletion of 1..8 bytes, plus the surgical removal of the whole `,[4,null]`.
let mutations = 0, verified = 0;
for (let i = 0; i < v2.length; i++) for (let len = 1; len <= 8 && i + len <= v2.length; len++) {
  mutations++;
  if (verify(Buffer.concat([v2.subarray(0, i), v2.subarray(i + len)]), alice.x)) verified++;
}
const surgical = Buffer.from(v2.toString('latin1').replace(',[4,null]', ''), 'latin1');
// The one thing it CAN do: serve the older head that still lists 4. A pinned reader sees hseq fall.
const rollbackCaught = readHead(v1).obj.hseq < r2.obj.hseq;

// ---- claim 9: a reply to the withdrawn TOP post ----
// 7 is withdrawn at hseq 5; append-only still lists the number, so max-of-entries is fine. After
// the compaction at hseq 6 the line is gone and only the declared top keeps the verdict honest.
const v5 = aoHead({ entries: [...[1, 2, 3, 4, 5, 6].map(E), [4, null], E(7), [7, null]], hseq: 5, top: 7, prev: address(v3) });
const c6 = aoHead({ entries: [1, 2, 3, 5, 6].map(E), hseq: 6, top: 7, prev: address(v5) });
const rumor = (head, n) => { const h = readHead(head); return n > Math.max(0, ...h.obj.entries.map(([m]) => m)) ? 'rumor' : 'quiet'; };
const rumorTop = (head, n) => { const h = readHead(head); return n > h.obj.top ? 'rumor' : 'quiet'; };

// A reader that last saw hseq 1 and comes back at hseq 6 — two rewrites, two withdrawals and an
// append it never saw. This is what makes the rewrite cadence the publisher's business.
const skipped = readHead(c6, { held: v1 });
const skipRewrite = rewriteOK(r1, skipped);

const tries = [
  ['re-admit a withdrawn number', [...JSON.parse(split(v3).body).entries, E(4)]],
  ['confirm a pending entry with another hash', [[8, address(posts[1]), 'pending'], [8, address(posts[2])]]],
  ['withdraw a number never listed', [E(1), [99, null]]],
];

console.log('\n  the append-only head — one history, 1..6 published, 4 withdrawn, 7 appended\n');
console.log(`  hseq 1  ${v1.length} B   live ${[...r1.live.keys()].join(',')}`);
console.log(`  hseq 2  ${v2.length} B   live ${[...r2.live.keys()].join(',')}   (withdrawal is an appended line, +${v2.length - v1.length} B)`);
console.log(`  hseq 3  ${v3.length} B   live ${[...r3.live.keys()].join(',')}   tail after two versions: ${tailBytes(v1, v3)} of ${v3.length} B`);
console.log(`  hseq 4  ${c4.length} B   live ${[...r4.live.keys()].join(',')}   compaction: −${v3.length - c4.length} B, full re-read, prev chains\n`);
console.log('  a hostile host against the retraction line');
console.log(`    ${mutations} contiguous deletions of 1..8 bytes: ${verified} verify`);
console.log(`    removing ",[4,null]" outright: verifies = ${verify(surgical, alice.x)}`);
console.log(`    serving hseq 1 instead (4 still live): a pinned reader sees hseq fall = ${rollbackCaught}, a cold reader does not\n`);
console.log('  a reply naming 7, after 7 is withdrawn');
console.log(`    max-of-entries    append-only: ${rumor(v5, 7)}   after compaction: ${rumor(c6, 7)}`);
console.log(`    declared top      append-only: ${rumorTop(v5, 7)}   after compaction: ${rumorTop(c6, 7)}\n`);

console.log('  a reader that last saw hseq 1, coming back at hseq 6');
console.log(`    accepts: true   live ${[...skipped.live.keys()].join(',')}   withdrawals it is told about: ${skipRewrite.withdrawn.join(',')}`);
console.log(`    prev chains to what it holds: ${skipped.chained}   a reply naming 7 (a post it never saw): ${rumorTop(c6, 7)}\n`);

const gate = [
  ['the fold over appended lines gives the same live set as the flat list of the same history',
    JSON.stringify([...r2.live.keys()].sort()) === JSON.stringify([...readHead(f2).live.keys()].sort())],
  ['every illegal second line for a number is rejected: re-admission, a pending hash change, a withdrawal of nothing',
    tries.every(([, entries]) => { try { fold(entries); return false; } catch { return true; } })],
  ['a pending entry becomes ordinary when confirmed with the identical hash, and stops being pending',
    (() => { const { live } = fold([[8, address(posts[1]), 'pending'], [8, address(posts[1])]]); return live.get(8).pending === false; })()],
  ['admission runs off the fold: a listed post is admitted, a withdrawn one is not, an unlisted post signed by a stolen key is not',
    admits(r3, 7, posts[7]) && !admits(r3, 4, posts[4]) && !admits(r3, 8, post(8, thief))],
  ['a reader-relative tail survives a withdrawal — byte-identical and verifying, where the flat list is forced to a full re-read',
    reconstruct(v1, v3).equals(v3) && verify(reconstruct(v1, v3), alice.x) && tailBytes(v1, v3) < v3.length
    && !verify(reconstruct(f1, f2), alice.x)],
  ['a compaction verifies, chains by prev to the head before it, and preserves the fold',
    verify(c4, alice.x) && r4.obj.prev === address(v3) && rewriteOK(r3, r4).ok && rewriteOK(r3, r4).withdrawn.length === 0],
  ['the tail reconstruction across a compaction does not verify — the rewrite is always visible, never silently wrong',
    !verify(reconstruct(v3, c4), alice.x)],
  ['a reader holding the previous head refuses a compaction that changes a live hash or re-admits a withdrawn number',
    !bad([[1, address(posts[2])], ...[2, 3, 5, 6, 7].map(E)], 'hash swap').ok && !bad([1, 2, 3, 4, 5, 6, 7].map(E), 're-admit').ok],
  ['a compaction that drops a live post is accepted only as a withdrawal, and named as one',
    (() => { const c = readHead(aoHead({ entries: [1, 2, 3, 5, 6].map(E), hseq: 4, top: 7, prev: address(v3) }), { held: v3 }); const r = rewriteOK(r3, c); return r.ok && r.withdrawn.join() === '7'; })()],
  ['no deletion from a signed head removes a retraction line: every mutation fails to verify',
    verified === 0 && !verify(surgical, alice.x)],
  ['a rollback to the head before the withdrawal is caught by hseq, and only by a reader that kept one',
    rollbackCaught && verify(v1, alice.x)],
  ['a reader that skipped every version in between still checks the rewrite and is told what was withdrawn',
    skipRewrite.ok && skipRewrite.withdrawn.join() === '4' && [...skipped.live.keys()].join() === '1,2,3,5,6'],
  ['prev does not chain across a gap, so hseq and the rewrite check are what carry a reader that polls slowly',
    skipped.chained === false && skipped.obj.hseq > readHead(v1).obj.hseq],
  ['the declared top keeps a reply to a withdrawn TOP post quiet across a compaction, where max-of-entries raises a false rumor',
    rumorTop(v5, 7) === 'quiet' && rumorTop(c6, 7) === 'quiet' && rumor(c6, 7) === 'rumor'],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('aohead-gate: all claims hold');
