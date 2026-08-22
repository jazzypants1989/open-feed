// weekend-gate: HANDOFF-to-spec.md §2.H, the minimality measure that has never been taken on this
// substrate. Write the WHOLE reader and the WHOLE publisher from TLDR-new.md and the rulings, with
// nothing but the standard library, then run them against a hub over a real socket and count the
// lines. If either needed a thing the TL;DR does not say, that is a finding about the TL;DR.
// Kill criteria: a hostile move that the reader does not catch; a reader state beyond the three
// the design allows; a rumor raised over a post the author withdrew; either file over 200 lines.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read, rumors } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sloc = (f) => fs.readFileSync(path.join(here, f), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;

// ---- the hub a third implementer writes: three paths, two verbs, one conditional header ----
class Hub {
  constructor() { this.files = new Map(); this.hold = new Set(); this.swap = new Map(); }
  tag(k) { const f = this.files.get(k); return f ? crypto.createHash('sha256').update(f).digest('base64url') : null; }
  handle(method, url, body, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|head|posts\/\d+)$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') {
      if (this.hold.has(key)) return { status: 404 };                       // withholding
      if (this.swap.has(key)) return { status: 200, body: this.swap.get(key) };
      return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: this.tag(key) } : { status: 404 };
    }
    if (m[2] === 'head' || m[2] === 'profile') {
      if (this.tag(key) !== ifMatch) return { status: 412 };
      this.files.set(key, body); return { status: 200, etag: this.tag(key) };
    }
    if (this.files.has(key)) return { status: 409 };
    this.files.set(key, body); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const c = [];
      req.on('data', (x) => c.push(x));
      req.on('end', () => {
        const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null);
        res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body);
      });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
const io = (hub) => ({
  get: async (p) => { const r = await fetch(hub.url + p); return r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null; },
  put: async (p, b, ifMatch) => (await fetch(hub.url + p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status,
});

// ---- an identity, published for real ----
const hub = await (new Hub()).listen();
const net = io(hub);
const A = pub.newKey(), A2 = pub.newKey(), A3 = pub.newKey();
const mum = { key: pub.newKey(), salt: 's-mum' }, sis = { key: pub.newKey(), salt: 's-sis' };
const REC = pub.commit(1, [mum, sis]);
const AT = '/alice', LOC = ['https://alice.example'];
const chain0 = [{ key: A.x }];
const p1 = pub.profile({ genesis: A.x, pseq: 1, chain: chain0, recovery: REC, locations: LOC }, A);
await net.put(`${AT}/profile`, p1, null);
for (const n of [1, 2, 3]) await pub.publish(net, AT, A, n, { at: '2026-08-01', text: `post ${n}` });
const seen = new Map();
const first = await read(net.get, { learned: A.x, at: AT });
seen.set(A.x, first.pin);

// a withdrawal, then a rewrite that clears its lines
await pub.withdraw(net, AT, A, 2);
const afterWithdraw = await read(net.get, { learned: A.x, at: AT, pin: first.pin });
await pub.rewrite(net, AT, A);
const afterRewrite = await read(net.get, { learned: A.x, at: AT, pin: afterWithdraw.pin });

// a rotation, then a restore vouched by one listed member
const p2 = pub.profile({ genesis: A.x, pseq: 2, prev: pub.address(p1), chain: [...chain0, pub.rotation(A, A2)], recovery: REC, locations: LOC }, A2);
await net.put(`${AT}/profile`, p2, hub.tag('alice/profile'));
const midRotation = await read(net.get, { learned: A.x, at: AT, pin: afterRewrite.pin });   // head still under the old key
await pub.resignHead(net, AT, A2);
const afterRotate = await read(net.get, { learned: A.x, at: AT, pin: afterRewrite.pin });
const p3 = pub.profile({ genesis: A.x, pseq: 3, prev: pub.address(p2), chain: [...chain0, pub.rotation(A, A2), pub.restore(A2, A3, [mum], REC)], recovery: REC, locations: LOC }, A3);
await net.put(`${AT}/profile`, p3, hub.tag('alice/profile'));
await pub.resignHead(net, AT, A3);
const afterRestore = await read(net.get, { learned: A.x, at: AT, pin: afterRotate.pin });
await pub.publish(net, AT, A3, 4, { at: '2026-08-05', text: 'back' });   // the restored key publishes
const afterBack = await read(net.get, { learned: A.x, at: AT, pin: afterRestore.pin });

// ---- what a hostile host and a hostile stranger can try ----
const good = afterBack.pin;
hub.hold.add('alice/posts/3');
const withheld = await read(net.get, { learned: A.x, at: AT, pin: good });
hub.hold.delete('alice/posts/3');

const rolled = pub.head({ entries: [[1, good.live.get(1)]], hseq: 1, top: 1 }, A3);
hub.swap.set('alice/head', rolled);
const rollback = await read(net.get, { learned: A.x, at: AT, pin: good });
hub.swap.delete('alice/head');

const other = pub.post(1, { at: '2026-08-01', text: 'not what she wrote' }, A3);
hub.swap.set('alice/posts/1', other);
const swapped = await read(net.get, { learned: A.x, at: AT, pin: good });
hub.swap.delete('alice/posts/1');

const ex = pub.newKey();
const fake = pub.profile({ genesis: ex.x, pseq: 9, chain: [{ key: ex.x }], recovery: REC, locations: LOC }, ex);
hub.swap.set('alice/profile', fake);
const substituted = await read(net.get, { learned: A.x, at: AT, pin: good });
hub.swap.delete('alice/profile');

const forked = pub.profile({ genesis: A.x, pseq: 3, prev: pub.address(p2), chain: [...chain0, pub.rotation(A, A2), pub.restore(A2, ex, [sis], REC)], recovery: REC, locations: LOC }, ex);
hub.swap.set('alice/profile', forked);
const contested = await read(net.get, { learned: A.x, at: AT, pin: good });
hub.swap.delete('alice/profile');

const stolenKeyPost = pub.post(9, { at: '2026-08-09', text: 'smuggled' }, A2);
await net.put(`${AT}/posts/9`, stolenKeyPost);                            // lands, and is never listed
const smuggled = await read(net.get, { learned: A.x, at: AT, pin: good });

// ---- the rumor, over a second identity on the same hub ----
const B = pub.newKey(), BAT = '/bob';
await net.put(`${BAT}/profile`, pub.profile({ genesis: B.x, pseq: 1, chain: [{ key: B.x }], recovery: pub.commit(1, [mum]), locations: ['https://bob.example'] }, B), null);
const target = (n) => ({ key: A.x, n, hash: good.live.get(n) ?? 'unknown', at: AT });
await pub.publish(net, BAT, B, 1, { at: '2026-08-06', rel: 'reply', target: target(1), text: 'to a post I can see' });
await pub.publish(net, BAT, B, 2, { at: '2026-08-06', rel: 'reply', target: { ...target(2), n: 2 }, text: 'to one she withdrew' });
await pub.publish(net, BAT, B, 3, { at: '2026-08-06', rel: 'reply', target: { key: A.x, n: 99, hash: 'x', at: AT }, text: 'to one the host hides' });
const bob = await read(net.get, { learned: B.x, at: BAT });
seen.set(A.x, good);
let fetches = 0;
const counted = (p) => { fetches++; return net.get(p); };
const raised = await rumors(counted, seen, bob.posts, 'bob');

// the same rule under a griefer: a thousand replies naming numbers that do not exist
const quiet = new Map([...Array(1000).keys()].map((i) => [i, { n: i, target: { key: A.x, n: 1, hash: good.live.get(1), at: AT } }]));
const noisy = new Map([...Array(1000).keys()].map((i) => [i, { n: i, target: { key: A.x, n: 500 + i, hash: 'x', at: AT } }]));
let quietFetches = 0, noisyFetches = 0;
const grief = await rumors((p) => { noisyFetches++; return net.get(p); }, new Map([[A.x, good]]), noisy, 'a griefer');
await rumors((p) => { quietFetches++; return net.get(p); }, new Map([[A.x, good]]), quiet, 'a friend');

const states = new Set([first, afterWithdraw, afterRewrite, midRotation, afterRotate, afterRestore, afterBack, withheld, rollback, swapped, substituted, contested, smuggled, bob].map((r) => r.verdict));
const readerLines = sloc('weekend-reader.js'), pubLines = sloc('weekend-publisher.js');

console.log(`\n  the reader is ${readerLines} lines and the publisher ${pubLines} — standard library only, nothing shared\n`);
console.log('    moment                                    verdict     what it said');
const row = (what, r) => console.log(`    ${what.padEnd(41)} ${r.verdict.padEnd(11)} ${r.why ?? r.note.join('; ') ?? ''}`);
row('first read, three posts', first);
row('after she withdraws post 2', afterWithdraw);
row('after she rewrites the file', afterRewrite);
row('mid-rotation: profile moved, head has not', midRotation);
row('after she rotates her key', afterRotate);
row('after mum vouches her back in', afterRestore);
row('after the restored key publishes', afterBack);
row('host withholds a listed post', withheld);
row('host serves an older head', rollback);
row('host swaps a post for another she signed', swapped);
row('host substitutes a whole other identity', substituted);
row('a second profile at the same version', contested);
row('a post signed by her old key, never listed', smuggled);
console.log(`\n    bob's three replies raise: ${raised.length ? raised.join(', ') : 'nothing'} — at a cost of ${fetches} fetches`);
console.log(`    1,000 replies to posts that exist: ${quietFetches} fetches. 1,000 naming numbers that do not: ${noisyFetches} fetches, and ${grief.length} thing said\n`);

const gate = [
  ['the whole reader is one file under 200 lines, standard library only', readerLines < 200],
  ['the whole publisher is one file under 200 lines, standard library only', pubLines < 200],
  ['an honest identity reads ok, and the posts come back', first.verdict === 'ok' && first.posts.size === 3],
  ['a withdrawal is named, not alarmed at, and survives the rewrite that clears its lines',
    afterWithdraw.verdict === 'ok' && afterWithdraw.note.includes('withdrawn: 2') && afterRewrite.verdict === 'ok' && !afterRewrite.pin.live.has(2)],
  ['a rotation is followed from the genesis key the reader learned, with no new trust',
    afterRotate.verdict === 'ok' && afterRotate.chain.current !== afterRotate.chain.keys[0]],
  ['between the two writes a rotation takes, an honest host is not accused — the reader keeps the head it verified',
    midRotation.verdict === 'ok' && midRotation.note.includes('no head newer than the one this reader holds') && midRotation.posts.size === 2],
  ['a restore vouched by a listed member is followed, and flagged',
    afterRestore.verdict === 'ok' && afterRestore.note.includes('recently restored') && afterBack.posts.size === 3],
  ['withholding a listed post is the host\'s fault, and says so', withheld.verdict === 'host'],
  ['an older head, a swapped post, and a post that is not what the head lists are all the host',
    rollback.verdict === 'host' && swapped.verdict === 'host'],
  ['a substituted identity and a second profile at one version are both about the identity, not the host',
    substituted.verdict === 'identity' && contested.verdict === 'identity'],
  ['a post signed by a key that was hers, that the head does not list, is simply not there',
    smuggled.verdict === 'ok' && !smuggled.posts.has(9)],
  ['a reply to a post she withdrew raises nothing, and a reply to one the host is hiding names the replier',
    raised.length === 1 && raised[0] === 'bob replied to something I cannot see'],
  ['a reply at or below the top costs no fetch at all, and a thousand replies naming numbers that do not exist cost one look, not a thousand',
    quietFetches === 0 && noisyFetches === 5 && grief.length === 1],
  ['there are exactly three reader states in every run above', states.size === 3 && [...states].sort().join() === 'host,identity,ok'],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
hub.server.close();
if (failed.length) process.exit(1);
console.log('weekend-gate: all claims hold');
