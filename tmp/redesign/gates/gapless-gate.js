// gapless-gate: numbering under failure. Numbering is load-bearing three times over — create-once
// (ruling 3), "above the top" (§11.1), the reclaim rule (§12.5) — and nothing had stressed it. Over
// a real socket, with the UNCHANGED weekend reader and publisher: a device that crashes between the
// post write and the head write; two devices and a crash; a griefer holding numbers the owner then
// reclaims; an abandoned draft; and the pending entry's lifecycle across a rewrite and across the
// fallback a rotation forces — the two paths HANDOFF-final-review.md §3 said nothing checks.
// Kill criteria: a gap that reads to any reader as a withdrawal or an accusation; a `top` that
// lies; a reclaim the griefer can use; a pending post fetched before its device released it; a
// late listing or a backdated insertion that a pinned reader does not catch.
import http from 'node:http';
import crypto from 'node:crypto';
import { read, rumors } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';

// ---- the hub, as §12.5 rules it: checks nothing on the ordinary path, resolves a collision ----
const pubKey = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
const body = (f) => f.subarray(0, f.lastIndexOf(0x0a));
const signedBy = (f, x) => { try { return crypto.verify(null, body(f), pubKey(x), Buffer.from(f.subarray(f.lastIndexOf(0x0a) + 1).toString('latin1'), 'base64url')); } catch { return false; } };
class Hub {
  constructor() { this.files = new Map(); this.hold = new Set(); this.log = []; }
  tag(k) { const f = this.files.get(k); return f ? crypto.createHash('sha256').update(f).digest('base64url') : null; }
  // "The owner's file for this number": signed by a key in her chain AND declaring that number.
  owners(name, f, n) {
    const p = this.files.get(`${name}/profile`);
    if (!p) return false;
    try { return JSON.parse(body(p)).chain.some((h) => signedBy(f, h.key)) && JSON.parse(body(f)).n === n; } catch { return false; }
  }
  handle(method, url, b, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|head|posts\/(\d+))$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    this.log.push(`${method} ${key}`);
    if (method === 'GET') {
      if (this.hold.has(key)) return { status: 404 };
      return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: this.tag(key) } : { status: 404 };
    }
    if (m[2] === 'head' || m[2] === 'profile') {
      if (this.tag(key) !== ifMatch) return { status: 412 };
      this.files.set(key, b); return { status: 200, etag: this.tag(key) };
    }
    if (this.files.has(key)) {
      const n = +m[3];
      if (this.owners(m[1], this.files.get(key), n) || !this.owners(m[1], b, n)) return { status: 409 };
      this.files.set(key, b); return { status: 200 };                     // reclaimed
    }
    this.files.set(key, b); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const c = [];
      req.on('data', (x) => c.push(x));
      req.on('end', () => { const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null); res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body); });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
const io = (hub) => ({
  get: async (p) => { const r = await fetch(hub.url + p); return r.status === 200 ? Object.assign(Buffer.from(await r.arrayBuffer()), { etag: r.headers.get('etag') }) : null; },
  put: async (p, b, ifMatch) => (await fetch(hub.url + p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status,
});

// ---- one identity, seven posts, 3 withdrawn and the file rewritten, on a fresh hub each time ----
const A = pub.newKey(), A2 = pub.newKey(), ex = pub.newKey(), B = pub.newKey();
const mum = { key: pub.newKey(), salt: 's-mum' };
const REC = pub.commit(1, [mum]);
const AT = '/alice', BAT = '/bob', LOC = ['https://alice.example'];
const hubs = [];
async function fresh() {
  const hub = await new Hub().listen(); hubs.push(hub);
  const net = io(hub);
  await net.put(`${AT}/profile`, pub.profile({ genesis: A.x, pseq: 1, chain: [{ key: A.x }], recovery: REC, locations: LOC }, A), null);
  for (const n of [1, 2, 3, 4, 5, 6, 7]) await pub.publish(net, AT, A, n, { at: '2026-08-01', text: `post ${n}` });
  await pub.withdraw(net, AT, A, 3);
  await pub.rewrite(net, AT, A);
  const r = await read(net.get, { learned: A.x, at: AT });
  return { hub, net, pin: r.pin };
}
const at = (s) => read(s.net.get, { learned: A.x, at: AT, pin: s.pin });
const cold = (s) => read(s.net.get, { learned: A.x, at: AT });
const quiet = (r) => r.verdict === 'ok' && r.note.length === 0;
const bobReplies = async (s, targets) => {
  await s.net.put(`${BAT}/profile`, pub.profile({ genesis: B.x, pseq: 1, chain: [{ key: B.x }], recovery: REC, locations: ['https://bob.example'] }, B), null);
  let n = 1;
  for (const t of targets) await pub.publish(s.net, BAT, B, n++, { at: '2026-08-02', rel: 'reply', target: { key: A.x, loc: AT, ...t }, text: 'reply' });
  const bob = await read(s.net.get, { learned: B.x, at: BAT });
  return rumors(s.net.get, new Map([[A.x, s.pin]]), bob.posts, 'bob');
};

// 1. the crash: the post write lands, the head write never happens, and the device comes back with
// no memory of it. The publisher takes the next free number — 8 is taken by her own file, so 9.
const s1 = await fresh();
const orphan = await pub.publishPost(s1.net, AT, A, 8, { at: '2026-08-02', text: 'lost in the crash' });
const afterCrash = await pub.publish(s1.net, AT, A, 8, { at: '2026-08-03', text: 'after the restart' });
const crashPinned = await at(s1), crashCold = await cold(s1);
const orphanServed = await s1.net.get(`${AT}/posts/8`);
const orphanRetaken = await s1.net.put(`${AT}/posts/8`, pub.post(8, { at: '2026-08-03', text: 'take 8 back' }, A));
const orphanWithdrawn = await s1.net.put(`${AT}/head`, pub.head({ ...JSON.parse(body(await s1.net.get(`${AT}/head`))), entries: [...JSON.parse(body(await s1.net.get(`${AT}/head`))).entries, [8, null]], hseq: 99 }, A), s1.hub.tag('alice/head'));
const orphanWithdrawnRead = await at(s1);
await s1.net.put(`${AT}/head`, pub.head({ ...JSON.parse(body(await s1.net.get(`${AT}/head`))), entries: JSON.parse(body(await s1.net.get(`${AT}/head`))).entries.slice(0, -1), hseq: 100 }, A), s1.hub.tag('alice/head'));
const replyToOrphan = await bobReplies(s1, [{ n: 8, hash: orphan.entry[1] }]);

// 2. the crash, and the device comes back REMEMBERING: it lists 8 late, after 9 is already listed.
const s2 = await fresh();
const lost = await pub.publishPost(s2.net, AT, A, 8, { at: '2026-08-02', text: 'lost in the crash' });
await pub.publish(s2.net, AT, A, 9, { at: '2026-08-03', text: 'from the other device' });
const beforeLate = await at(s2);
await pub.amendHead(s2.net, AT, A, (h) => ({ ...h, entries: [...h.entries, lost.entry] }));
const lateListed = await read(s2.net.get, { learned: A.x, at: AT, pin: beforeLate.pin });
const lateCold = await cold(s2);
// ...and the attack the same reader rule exists for: the custodian of §13.2, holding her current key
// AND the disk, puts a post at 3 — a number she withdrew long ago — signed by her key, declaring 3,
// and lists it. (The key alone is not enough: create-once refuses him, since her own file holds 3.)
const s3 = await fresh();
const backdated = pub.post(3, { at: '2026-01-01', text: 'she never wrote this' }, A);
const keyAlone = await s3.net.put(`${AT}/posts/3`, backdated);
s3.hub.files.set('alice/posts/3', backdated);                                      // the disk is his
await pub.amendHead(s3.net, AT, A, (h) => ({ ...h, entries: [...h.entries, [3, pub.address(backdated)]] }));
const backdatePinned = await at(s3), backdateCold = await cold(s3);

// 3. two devices: one writes 8 and dies; the other publishes; the first comes back forgetting.
const s4 = await fresh();
await pub.publishPost(s4.net, AT, A, 8, { at: '2026-08-02', text: 'phone, then crash' });
const laptop = await pub.publish(s4.net, AT, A, 8, { at: '2026-08-02', text: 'laptop' });
const phoneAgain = await pub.publish(s4.net, AT, A, 8, { at: '2026-08-03', text: 'phone, restarted' });
const twoDevices = await at(s4);

// 4. a griefer holds 8–12 on a hub that checks nothing on the ordinary path; she reclaims in order.
const s5 = await fresh();
const burned = []; for (let n = 8; n <= 12; n++) burned.push(await s5.net.put(`${AT}/posts/${n}`, pub.post(n, { at: '2026-08-02', text: 'burn' }, ex)));
const griefRumorBefore = await bobReplies(s5, [{ n: 11, hash: 'x' }]);
const tops = [];
for (let n = 8; n <= 12; n++) {
  const got = await pub.publish(s5.net, AT, A, n, { at: '2026-08-03', text: `reclaimed ${n}` });
  const r = await at(s5); s5.pin = r.pin;
  tops.push([got, r.verdict, r.pin.top, Math.max(...r.pin.live.keys())]);
}
const reclaimedAll = await cold(s5);

// 5. scheduled posts (the `pending` line was cut 2026-08-23 — pending-gate.md). A head carrying the
// old three-element line does not fold; the scheduled post is signed at release time at the next
// number; and a number reserved in advance and listed late, below a top a reader saw, is host.
const s6 = await fresh();
const draft = pub.post(8, { at: '2026-09-01', text: 'scheduled' }, A);
s6.pin = (await at(s6)).pin;
await pub.amendHead(s6.net, AT, A, (h) => ({ ...h, entries: [...h.entries, [8, pub.address(draft), 'pending']], top: 8 }));
const oldLine = await at(s6);
await pub.amendHead(s6.net, AT, A, (h) => ({ ...h, entries: h.entries.filter((e) => e.length < 3) }));
await pub.publish(s6.net, AT, A, 8, { at: '2026-08-03', text: 'meanwhile' });
s6.pin = (await at(s6)).pin;
const released = await pub.publish(s6.net, AT, A, 9, { at: '2026-09-01', text: 'scheduled' });
const releasedRead = await at(s6);
const s7 = await fresh();
s7.pin = (await at(s7)).pin;
await pub.publish(s7.net, AT, A, 9, { at: '2026-08-03', text: 'meanwhile' });
s7.pin = (await at(s7)).pin;
await s7.net.put(`${AT}/posts/8`, draft);
await pub.amendHead(s7.net, AT, A, (h) => ({ ...h, entries: [...h.entries, [8, pub.address(draft)]] }));
const late = await at(s7);

// 6. the write order: the head that lists a post must come after the post's bytes, or a reader in
// between accuses an honest host.
const s8 = await fresh();
const early = pub.post(8, { at: '2026-08-02', text: 'listed first' }, A);
await pub.amendHead(s8.net, AT, A, (h) => ({ ...h, entries: [...h.entries, [8, pub.address(early)]], top: 8 }));
const headFirst = await at(s8);
await s8.net.put(`${AT}/posts/8`, early);
const thenPost = await at(s8);

console.log('\n  numbering under failure, over a socket, with the unchanged reader and publisher\n');
console.log(`    crash after post 8, before the head; restart forgetting:   next post lands at ${afterCrash}; pinned ${crashPinned.verdict} [${crashPinned.note}]; cold ${crashCold.verdict} [${crashCold.note}]`);
console.log(`      the orphan: served ${orphanServed ? 'yes' : 'no'}; her retake of 8: ${orphanRetaken}; a head withdrawing it: ${orphanWithdrawn} and reads ${orphanWithdrawnRead.verdict} (${orphanWithdrawnRead.why ?? 'ok'}); bob's reply to it raises: ${replyToOrphan.length ? replyToOrphan : 'nothing'}`);
console.log(`    restart remembering — 8 listed after 9:                    pinned ${lateListed.verdict} (${lateListed.why ?? 'ok'}); cold ${lateCold.verdict}`);
console.log(`    the custodian, key and disk, backdates a post into 3:       his PUT alone ${keyAlone}; pinned ${backdatePinned.verdict} (${backdatePinned.why ?? 'ok'}); cold ${backdateCold.verdict}`);
console.log(`    two devices, one crash:                                     laptop at ${laptop}, phone restarted at ${phoneAgain}; ${twoDevices.verdict} [${twoDevices.note}]`);
console.log(`    griefer holds 8–12 (${burned.join(' ')}); his reply naming 11 before she gets there: ${griefRumorBefore}`);
for (const [n, v, top, max] of tops) console.log(`      she publishes ${n}: ${v}, top ${top}, highest listed ${max}`);
console.log(`    the old pending line: ${oldLine.verdict} (${oldLine.why}); the scheduled post lands at ${released} (${releasedRead.verdict}); a reserved number listed late: ${late.verdict} (${late.why})`);
console.log(`    head written before the post: ${headFirst.verdict} (${headFirst.why ?? 'ok'}); then the post lands: ${thenPost.verdict}\n`);

const gate = [
  ['a crash between the two writes burns one number and nothing else: the next post lands at 9, and both a pinned and a cold reader read ok with no note',
    afterCrash === 9 && quiet(crashPinned) && quiet(crashCold)],
  ['the gap reads as nothing — not as a withdrawal of a post that never existed, and a reply naming it is quiet',
    !crashPinned.note.some((n) => n.startsWith('withdrawn')) && replyToOrphan.length === 0],
  ['but the orphan is served forever: it is her file, so she cannot retake the number, and she cannot withdraw what was never listed',
    !!orphanServed && orphanRetaken === 409 && orphanWithdrawnRead.verdict === 'host'],
  ['listing the orphan LATE, below a top the reader has seen, accuses the host — so a device that comes back must abandon, never resume',
    lateListed.verdict === 'host' && lateCold.verdict === 'ok'],
  ['and that is the same rule that catches the custodian — her key and his disk — backdating a post into a withdrawn number; cold, nobody can',
    keyAlone === 409 && backdatePinned.verdict === 'host' && backdateCold.verdict === 'ok'],
  ['two devices and a crash: the survivor takes 9, the restarted device 10, and the reader is told nothing',
    laptop === 9 && phoneAgain === 10 && quiet(twoDevices)],
  ['a griefer holding five numbers is reclaimed one at a time, and top tells the truth at every step',
    burned.every((s) => s === 201) && tops.every(([n, v, top, max]) => v === 'ok' && top === n && max === n) && reclaimedAll.posts.size === 11],
  ['his reply naming a number she has not reached names him, not her',
    griefRumorBefore.length === 1],
  ['a head carrying the retired pending line does not fold', oldLine.verdict === 'host' && oldLine.why === 'the head does not fold'],
  ['a scheduled post is signed at release time at the next number, and reads as an ordinary post',
    released === 9 && releasedRead.verdict === 'ok' && releasedRead.posts.has(9)],
  ['a number reserved in advance and listed late, below a top the reader saw, is host — the check that made the pending line exist',
    late.verdict === 'host' && late.why === 'post 8 is listed now and was not before'],
  ['a head that lists a post before its bytes land accuses an honest host — the post is written first',
    headFirst.verdict === 'host' && thenPost.verdict === 'ok'],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const h of hubs) h.server.close();
if (failed.length) process.exit(1);
console.log('gapless-gate: all claims hold');
