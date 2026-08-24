// court-gate: the contest rule inside the composed reader. RULINGS §11.3 settles a fork by a
// majority of the recovery list as it stood at the split, and says only a reader that pinned the
// pre-fork profile can run it. decisions/forkcold-exp.js shows the rule alone; weekend-reader.js
// said "contested" and stopped — and, as written, it contested only two profiles at ONE pseq, so a
// thief holding a rotated-out key who simply picked a higher number was followed by every reader.
// This gate puts the court into the reader, over a socket, and asks what it must have kept.
// Kill criteria: a thief followed by a reader that pinned the pre-fork profile; a listed adversary
// who wins alone; an honest author whose own chain breaks when she edits her list; a fork settled
// by the wrong list; the reader over 200 lines.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sloc = (f) => fs.readFileSync(path.join(here, f), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;

class Hub {
  constructor() { this.files = new Map(); }
  tag(k) { const f = this.files.get(k); return f ? crypto.createHash('sha256').update(f).digest('base64url') : null; }
  handle(method, url, b, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|head|posts\/\d+)$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: this.tag(key) } : { status: 404 };
    if (m[2] === 'head' || m[2] === 'profile') { if (this.tag(key) !== ifMatch) return { status: 412 }; this.files.set(key, b); return { status: 200 }; }
    if (this.files.has(key)) return { status: 409 };
    this.files.set(key, b); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => { const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null); res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body); }); });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
const io = (hub) => ({
  get: async (p) => { const r = await fetch(hub.url + p); return r.status === 200 ? Object.assign(Buffer.from(await r.arrayBuffer()), { etag: r.headers.get('etag') }) : null; },
  put: async (p, b, ifMatch) => (await fetch(hub.url + p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status,
});

// ---- the family: Alice, her keys, and a list of three with the ex on it ----
const A = pub.newKey(), A2 = pub.newKey(), A3 = pub.newKey(), T = pub.newKey();
const mum = { key: pub.newKey(), salt: 's-mum' }, sis = { key: pub.newKey(), salt: 's-sis' }, ex = { key: pub.newKey(), salt: 's-ex' }, baby = { key: pub.newKey(), salt: 's-baby' };
const AT = '/alice', LOC = ['https://alice.example'];
const c0 = [{ key: A.x }], c2of = (rec) => [...c0, pub.rotation(A, A2, rec)];   // every hop carries the list that stood before it
const prof = (pseq, chain, recovery, key) => pub.profile({ genesis: A.x, pseq, chain, recovery, locations: LOC }, key);
const hubs = [];
// Alice at chain length 2 (one rotation), a reader pinned there — the pre-fork profile.
async function scene(recovery) {
  const hub = await new Hub().listen(); hubs.push(hub);
  const net = io(hub);
  await net.put(`${AT}/profile`, prof(1, c0, recovery, A), null);
  await pub.publish(net, AT, A, 1, { at: '2026-08-01', text: 'post 1' });
  await net.put(`${AT}/profile`, prof(2, c2of(recovery), recovery, A2), hub.tag('alice/profile'));
  await pub.resignHead(net, AT, A2);
  const pin = (await read(net.get, { learned: A.x, at: AT })).pin;
  const serve = async (p, key) => { hub.files.set('alice/profile', p); await pub.resignHead(net, AT, key); };
  const see = (pin) => read(net.get, { learned: A.x, at: AT, pin });
  return { hub, net, pin, serve, see, cold: () => read(net.get, { learned: A.x, at: AT }) };
}
const who = (r) => (r.verdict !== 'ok' ? `${r.verdict}: ${r.why}` : r.chain.current === T.x ? 'FOLLOWS THE THIEF' : r.chain.current === A3.x ? 'follows Alice' : 'ok');
// Both orders: the reader meets the thief's branch first and then Alice's, and the reverse.
async function bothOrders(s, alice, aliceKey, thief, thiefKey) {
  await s.serve(thief, thiefKey); const t1 = await s.see(s.pin);
  await s.serve(alice, aliceKey); const a2 = await s.see(t1.verdict === 'ok' ? t1.pin : s.pin);
  await s.serve(alice, aliceKey); const a1 = await s.see(s.pin);
  await s.serve(thief, thiefKey); const t2 = await s.see(a1.verdict === 'ok' ? a1.pin : s.pin);
  return { thiefFirst: [who(t1), who(a2)], aliceFirst: [who(a1), who(t2)] };
}

// 1. the thief holds A2 and picks a higher pseq: a plain rotation to his key at pseq 4. Alice restores
//    to A3 at pseq 3, vouched by mum and sis — two of three.
const REC3 = pub.commit(2, [mum, sis, ex]);
const s1 = await scene(REC3);
const thiefRot = prof(4, [...c2of(REC3), pub.rotation(A2, T, REC3)], REC3, T);
const aliceRestore = prof(3, [...c2of(REC3), pub.restore(A2, A3, [mum, sis], REC3)], REC3, A3);
const higherPseq = await bothOrders(s1, aliceRestore, A3, thiefRot, T);
await s1.serve(thiefRot, T); const coldThief = await s1.cold();

// 2. the thief IS the ex, on the list: his branch is a restore vouched by himself — one of three,
//    which the honest list's k=2 refuses, so he carries a court of his own making (k=1, himself).
const s2 = await scene(REC3);
const HIS = pub.commit(1, [ex]);
const exRestore = prof(4, [...c2of(REC3), pub.restore(A2, T, [ex], HIS)], HIS, T);
const listedEx = await bothOrders(s2, aliceRestore, A3, exRestore, T);

// 3. the tie weekend-gate stages: a list of two, one voucher each.
const REC2 = pub.commit(1, [mum, sis]);
const s3 = await scene(REC2);
const tie = await bothOrders(s3, prof(3, [...c2of(REC2), pub.restore(A2, A3, [mum], REC2)], REC2, A3), A3, prof(4, [...c2of(REC2), pub.restore(A2, T, [sis], REC2)], REC2, T), T);

// 4. a bare rotation by the thief against a one-of-two restore: not a majority, so contested — the
//    price of the majority rule, stated. With both of two it is settled.
const s4 = await scene(REC2);
const oneOfTwo = await bothOrders(s4, prof(3, [...c2of(REC2), pub.restore(A2, A3, [mum], REC2)], REC2, A3), A3, prof(4, [...c2of(REC2), pub.rotation(A2, T, REC2)], REC2, T), T);
const s4b = await scene(REC2);
const twoOfTwo = await bothOrders(s4b, prof(3, [...c2of(REC2), pub.restore(A2, A3, [mum, sis], REC2)], REC2, A3), A3, prof(4, [...c2of(REC2), pub.rotation(A2, T, REC2)], REC2, T), T);

// 5. the thief edits the list FIRST — same chain, his own list, a higher pseq — and then forks with a
//    restore that satisfies the list he wrote. The court is the first list the reader saw there.
const s5 = await scene(REC3);
await s5.serve(prof(3, c2of(REC3), HIS, A2), A2);
const afterEdit = await s5.see(s5.pin);
const editThenFork = await bothOrders({ ...s5, pin: afterEdit.pin }, prof(4, [...c2of(REC3), pub.restore(A2, A3, [mum, sis], REC3)], REC3, A3), A3, prof(5, [...c2of(REC3), pub.restore(A2, T, [ex], HIS)], HIS, T), T);

// 6. the thief forgets her restore: a higher pseq with the SHORTER chain, still ending on the key he holds.
const s6 = await scene(REC3);
await s6.serve(aliceRestore, A3); const onAlice = await s6.see(s6.pin);
await s6.serve(prof(9, c2of(REC3), REC3, A2), A2); const forgotten = await s6.see(onAlice.pin);

// 7. what a cold reader has: the court it was handed. Cold on Alice's branch, her restore hop carries
//    the list; then the thief's branch. Cold on the thief's branch, whose restore carries a forged list
//    of one; then Alice's.
const s7 = await scene(REC3);
await s7.serve(aliceRestore, A3); const coldAlice = await s7.cold();
await s7.serve(prof(4, [...c2of(REC3), pub.restore(A2, T, [ex], HIS)], HIS, T), T); const coldAliceThenThief = await s7.see(coldAlice.pin);
const s7b = await scene(REC3);
await s7b.serve(prof(4, [...c2of(REC3), pub.restore(A2, T, [ex], HIS)], HIS, T), T); const coldOnThief = await s7b.cold();
await s7b.serve(aliceRestore, A3); const coldThiefThenAlice = await s7b.see(coldOnThief.pin);

// 8. Alice edits her list after a restore — drops sis, who vouched for it — and a cold reader walks
//    her chain, because the restore hop carries the list it satisfied.
const s8 = await scene(REC3);
await s8.serve(aliceRestore, A3);
await s8.serve(prof(4, aliceRestore && [...c2of(REC3), pub.restore(A2, A3, [mum, sis], REC3)], pub.commit(2, [mum, ex, baby]), A3), A3);
const editedAfterRestore = await s8.cold();

// 9. the same rule, as a pure function, under the three candidate rules — for the owner's table.
const rules = {
  'majority of the list': (a, b, n) => (a * 2 > n) === (b * 2 > n) ? 'contested' : a * 2 > n ? 'Alice' : 'thief',
  'at least k (forkcourt)': (a, b, n, k) => (a >= k) === (b >= k) ? 'contested' : a >= k ? 'Alice' : 'thief',
  'strictly more': (a, b) => a === b ? 'contested' : a > b ? 'Alice' : 'thief',
};
const rows = [
  ['thief rotates; Alice restores 2 of 3 (k=2)', 2, 0, 3, 2],
  ['the ex vouches himself 1 of 3; Alice 2 of 3 (k=2)', 2, 1, 3, 2],
  ['the ex vouches himself 1 of 3; Alice merely ROTATES (k=1)', 0, 1, 3, 1],
  ['one voucher each of 2 (k=1)', 1, 1, 2, 1],
  ['thief rotates; Alice restores 1 of 2 (k=1)', 1, 0, 2, 1],
];
const table = rows.map(([what, a, b, n, k]) => [what, ...Object.values(rules).map((f) => f(a, b, n, k))]);

const readerLines = sloc('weekend-reader.js');
console.log(`\n  the reader is ${readerLines} lines with the court in it (141 before this review)\n`);
const show = (what, r) => console.log(`    ${what.padEnd(58)} thief first: ${r.thiefFirst.join(' → ').padEnd(60)} Alice first: ${r.aliceFirst.join(' → ')}`);
show('1. thief picks pseq 4, plain rotation; Alice 2 of 3', higherPseq);
console.log(`       cold, thief served: ${who(coldThief)}`);
show('2. the ex, listed, vouches himself; Alice 2 of 3', listedEx);
show('3. one voucher each of two', tie);
show('4. thief rotates; Alice 1 of 2', oneOfTwo);
show('   thief rotates; Alice 2 of 2', twoOfTwo);
show('5. thief rewrites the list first, then forks', editThenFork);
console.log(`       his list edit at the same length read: ${who(afterEdit)} [${afterEdit.note}]`);
console.log(`    6. thief serves pseq 9 with the chain from before her restore: ${who(forgotten)}`);
console.log(`    7. cold on Alice, then the thief: ${who(coldAliceThenThief)};  cold on the thief (forged court of one), then Alice: ${who(coldThiefThenAlice)}`);
console.log(`    8. Alice drops a voucher from her list after the restore; cold reader: ${who(editedAfterRestore)}\n`);
console.log('    the rule, three ways'.padEnd(62) + Object.keys(rules).map((k) => k.padEnd(24)).join(''));
for (const [what, ...v] of table) console.log(`      ${what.padEnd(58)} ${v.map((x) => x.padEnd(24)).join('')}`);
console.log();

const gate = [
  ['a thief holding a rotated-out key who picks a higher pseq is not followed by a reader that pinned the pre-fork profile — in either order',
    higherPseq.thiefFirst[1] === 'follows Alice' && higherPseq.aliceFirst[1].startsWith('host')],
  ['but a cold reader follows whichever branch it is served — the stated limit of §11.3',
    coldThief.verdict === 'ok' && coldThief.chain.current === T.x],
  ['a listed adversary who vouches for himself alone is refused outright by a reader holding the real court — his hop is not even valid under it — in either order',
    listedEx.thiefFirst[0].startsWith('identity') && listedEx.thiefFirst[1] === 'follows Alice' && listedEx.aliceFirst[1].startsWith('identity')],
  ['one voucher each is contested, in either order',
    tie.thiefFirst[1].startsWith('identity') && tie.aliceFirst[1].startsWith('identity')],
  ['a bare rotation against a one-of-two restore is contested — the majority rule\'s price — and settled at two of two',
    oneOfTwo.thiefFirst[1].startsWith('identity') && twoOfTwo.thiefFirst[1] === 'follows Alice' && twoOfTwo.aliceFirst[1].startsWith('host')],
  ['rewriting the list before forking buys the thief nothing: the court is the first list the reader saw at that length',
    afterEdit.verdict === 'ok' && editThenFork.thiefFirst[0].startsWith('identity') && editThenFork.thiefFirst[1] === 'follows Alice' && editThenFork.aliceFirst[1].startsWith('identity')],
  ['a newer profile that forgets her restore is a fork, and loses it',
    forgotten.verdict === 'host'],
  ['a cold reader\'s court is whatever its first profile carried: handed Alice\'s it later rejects the thief, handed the thief\'s it later rejects Alice',
    coldAliceThenThief.verdict === 'identity' && coldThiefThenAlice.verdict === 'identity'],
  ['an author who edits her list after a restore does not break her own chain — the hop carries the list it satisfied',
    editedAfterRestore.verdict === 'ok' && editedAfterRestore.chain.current === A3.x],
  ['under the majority rule a listed adversary never wins alone; under the other two he does',
    table[2][1] === 'contested' && table[2][2] === 'thief' && table[2][3] === 'thief'],
  ['the reader with the court in it is still one file under 200 lines', readerLines < 200],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const h of hubs) h.server.close();
if (failed.length) process.exit(1);
console.log('court-gate: all claims hold');
