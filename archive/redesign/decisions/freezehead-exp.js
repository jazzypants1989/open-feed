// freezehead-exp: HANDOFF-final-review.md §2.F. RULINGS §12.7 says a head that will not verify
// under the current key is not an accusation — a reader holding a head it verified itself keeps
// that one and says nothing. So a hostile host can serve an unverifiable head forever and freeze
// every pinned reader where it stands. The handoff's unmeasured claim: that is no worse than
// ordinary withholding, which splitview-gate already accepts as undetectable without a social path.
// This stages the freeze against the UNCHANGED weekend-reader.js under four observers and maps
// each row onto splitview-gate's strategy space, which is "serve reader R the newest verifiable
// head with hseq <= cap(R)". Then the thing the claim ignored: a cold reader arriving during an
// honest rotation, and whether any write ordering closes that window.
// Illustration, not a gate: exits 1 only if its own reading is false.
import http from 'node:http';
import crypto from 'node:crypto';
import { read, rumors } from '../gates/weekend-reader.js';
import * as pub from '../gates/weekend-publisher.js';

// ---- the hub from weekend-gate.js, plus a per-path override so the host can serve what it likes ----
class Hub {
  constructor() { this.files = new Map(); this.swap = new Map(); this.log = []; }
  tag(k) { const f = this.files.get(k); return f ? crypto.createHash('sha256').update(f).digest('base64url') : null; }
  handle(method, url, body, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|head|posts\/\d+)$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') {
      this.log.push(key);
      if (this.swap.has(key)) return this.swap.get(key) ? { status: 200, body: this.swap.get(key) } : { status: 404 };
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
// Two hubs: Alice's (the one under suspicion) and mom's (honest, elsewhere). A reader fetches from
// whichever hub the path names, which is how the social path crosses hubs.
const hubA = await new Hub().listen(), hubM = await new Hub().listen();
const netA = io(hubA), netM = io(hubM);
const route = (p) => (p.startsWith('/mom') ? netM : netA).get(p);

const A = pub.newKey(), A2 = pub.newKey(), M = pub.newKey();
const mum = { key: M, salt: 's-mum' };
const REC = pub.commit(1, [mum]);
const AT = '/alice', MAT = '/mom';
const chain0 = [{ key: A.x }];
const p1 = pub.profile({ genesis: A.x, pseq: 1, chain: chain0, recovery: REC, locations: ['https://alice.example'] }, A);
await netA.put(`${AT}/profile`, p1, null);
for (const n of [1, 2, 3]) await pub.publish(netA, AT, A, n, { at: '2026-08-01', text: `post ${n}` });
const head3 = hubA.files.get('alice/head');                                  // hseq 3, top 3, under A
const head2 = pub.head({ entries: [[1, 0], [2, 0]].map(([n]) => [n, JSON.parse(head3.subarray(0, head3.lastIndexOf(10))).entries[n - 1][1]]), hseq: 2, top: 2 }, A);

// The pinned reader: cousin, who verified hseq 3 herself.
const cousinPin = (await read(route, { learned: A.x, at: AT })).pin;

// Alice keeps publishing: 4 and 5. Mom reads her fresh, and replies to 5 on her own hub.
for (const n of [4, 5]) await pub.publish(netA, AT, A, n, { at: '2026-08-02', text: `post ${n}` });
const head5 = hubA.files.get('alice/head');                                  // hseq 5, top 5, under A
const momPin = (await read(route, { learned: A.x, at: AT })).pin;
await netM.put(`${MAT}/profile`, pub.profile({ genesis: M.x, pseq: 1, chain: [{ key: M.x }], recovery: pub.commit(1, []), locations: ['https://mom.example'] }, M), null);
await pub.publish(netM, MAT, M, 1, { at: '2026-08-03', rel: 'reply', target: { key: A.x, n: 5, hash: momPin.live.get(5), at: AT }, text: 'lovely' });
const momFeed = await read(route, { learned: M.x, at: MAT });

// ---- the strategies, each a thing the host serves at /alice/head ----
const garbled = Buffer.concat([head5.subarray(0, head5.lastIndexOf(10) + 1), Buffer.from('A'.repeat(86))]);   // a signature line that is not one
const strategies = [
  ['honest (hseq 5)', null, 'cap = ∞'],
  ['stops updating (serves hseq 3, verifiable)', head3, 'cap = 3 for everyone'],
  ['older head (hseq 2, verifiable)', head2, 'cap below what cousin pinned'],
  ['garbled head (bad signature line)', garbled, 'not in the enumeration'],
  ['no head at all (404)', false, 'not in the enumeration'],
];

// Four observers: cousin pinned at 3; a cold reader; mom pinned at 5; and cousin after reading
// mom's reply to post 5 — the social path, through rumors() and its one re-fetch.
async function observe(serve) {
  if (serve === null) hubA.swap.delete('alice/head'); else hubA.swap.set('alice/head', serve);
  const cell = (r) => `${r.verdict}${r.note.length ? ` [${r.note.join('; ')}]` : ''}${r.verdict !== 'ok' ? ` — ${r.why}` : ''}`;
  const cousin = await read(route, { learned: A.x, at: AT, pin: cousinPin });
  const cold = await read(route, { learned: A.x, at: AT });
  const mom = await read(route, { learned: A.x, at: AT, pin: momPin });
  const seen = new Map([[A.x, cousinPin]]);
  hubA.log.length = 0;
  const raised = await rumors(route, seen, momFeed.posts, 'mom');
  const social = `${raised.length ? raised[0] : 'nothing raised'} (${hubA.log.filter((k) => k === 'alice/head').length} re-fetch, cousin now at top ${seen.get(A.x).top})`;
  hubA.swap.delete('alice/head');
  return { cousin: cell(cousin), cold: cell(cold), mom: cell(mom), social, raw: { cousin, cold, mom, raised, top: seen.get(A.x).top } };
}
const rows = [];
for (const [name, serve, maps] of strategies) rows.push({ name, maps, ...(await observe(serve)) });

// The old-key freeze needs a rotation to exist. Alice rotates to A2 and re-signs; the host then
// serves the hseq-5 head still signed by A. That is the honest mid-rotation file, served forever.
const p2 = pub.profile({ genesis: A.x, pseq: 2, prev: pub.address(p1), chain: [...chain0, pub.rotation(A, A2)], recovery: REC, locations: ['https://alice.example'] }, A2);
await netA.put(`${AT}/profile`, p2, hubA.tag('alice/profile'));
await pub.resignHead(netA, AT, A2);                                           // hseq 6 under A2
rows.push({ name: 'after rotation, honest (hseq 6 under A2)', maps: 'cap = ∞', ...(await observe(null)) });
rows.push({ name: 'after rotation, serves the hseq-5 head under the old key', maps: 'not in the enumeration', ...(await observe(head5)) });

// Does the fallback let the host choose WHICH head the reader keeps? Serve every head it ever
// held, garbled or not, and see whether cousin's pin ever moves to something cousin did not verify.
let pinMoved = false;
for (const f of [head2, head3, head5, garbled]) {
  hubA.swap.set('alice/head', f);
  const r = await read(route, { learned: A.x, at: AT, pin: cousinPin });
  if (r.verdict === 'ok' && r.pin.hhash !== cousinPin.hhash) pinMoved = true;
}
hubA.swap.delete('alice/head');

// ---- the cold reader arriving mid-rotation, under both write orders ----
async function rotationWindow(order) {
  const hub = await new Hub().listen(), net = io(hub);
  const K = pub.newKey(), K2 = pub.newKey();
  const pr = pub.profile({ genesis: K.x, pseq: 1, chain: [{ key: K.x }], recovery: pub.commit(1, []), locations: [] }, K);
  await net.put('/bob/profile', pr, null);
  await pub.publish(net, '/bob', K, 1, { at: '2026-08-01', text: 'hi' });
  const pr2 = pub.profile({ genesis: K.x, pseq: 2, prev: pub.address(pr), chain: [{ key: K.x }, pub.rotation(K, K2)], recovery: pub.commit(1, []), locations: [] }, K2);
  const writes = {
    'profile first, then the head': [() => net.put('/bob/profile', pr2, hub.tag('bob/profile')), () => pub.resignHead(net, '/bob', K2)],
    'head first, then the profile': [() => pub.resignHead(net, '/bob', K2), () => net.put('/bob/profile', pr2, hub.tag('bob/profile'))],
  }[order];
  await writes[0]();
  const between = await read(net.get, { learned: K.x, at: '/bob' });          // the cold reader, between the two writes
  // The reader-side repair: a cold reader that cannot verify the head re-reads once from the top.
  const retry = between.verdict === 'host' ? await read(net.get, { learned: K.x, at: '/bob' }) : between;
  await writes[1]();
  const after = await read(net.get, { learned: K.x, at: '/bob' });
  const retryAfter = await read(net.get, { learned: K.x, at: '/bob' });
  hub.server.close();
  return { between: `${between.verdict} — ${between.why ?? 'ok'}`, retryBefore: retry.verdict, after: after.verdict, retryAfter: retryAfter.verdict };
}
const orders = {};
for (const o of ['profile first, then the head', 'head first, then the profile']) orders[o] = await rotationWindow(o);

// ---- print ----
console.log('\n  what /alice/head serves            →  cousin (pinned at 3)                                  cold reader                                      mom (pinned at 5)                                    social path: cousin reads mom\'s reply to 5');
for (const r of rows) {
  console.log(`\n  ${r.name}`);
  console.log(`    splitview maps to: ${r.maps}`);
  console.log(`    cousin  ${r.cousin}`);
  console.log(`    cold    ${r.cold}`);
  console.log(`    mom     ${r.mom}`);
  console.log(`    social  ${r.social}`);
}
console.log(`\n  can the host pick which head the frozen reader keeps?  ${pinMoved ? 'YES — the pin moved' : 'no — cousin\'s pin never moved off the head she verified herself'}`);
console.log('\n  a cold reader arriving between the two writes of an honest rotation');
for (const [o, r] of Object.entries(orders)) console.log(`    ${o.padEnd(30)} between: ${r.between.padEnd(70)} one cold retry before the second write: ${r.retryBefore}; after both writes: ${r.after}`);

const by = Object.fromEntries(rows.map((r) => [r.name, r.raw]));
const freezeRows = ['garbled head (bad signature line)', 'no head at all (404)', 'after rotation, serves the hseq-5 head under the old key'].map((n) => by[n]);
const stop = by['stops updating (serves hseq 3, verifiable)'];
const reading = [
  ['every freeze leaves cousin ok at her own pin with the note, and never moves her pin', freezeRows.every((r) => r.cousin.verdict === 'ok' && r.cousin.note.includes('no head newer than the one this reader holds')) && !pinMoved],
  ['every freeze is a `host` verdict to a cold reader — which ordinary withholding is not', freezeRows.every((r) => r.cold.verdict === 'host') && stop.cold.verdict === 'ok'],
  ['ordinary withholding leaves no note at all, so the two are distinguishable to the reader', stop.cousin.verdict === 'ok' && stop.cousin.note.length === 0],
  ['the social path breaks every freeze the way it breaks withholding: mom\'s reply to 5 raises the rumor after one re-fetch', [...freezeRows, stop].every((r) => r.raised.length === 1 && r.top === 3) && by['honest (hseq 5)'].raised.length === 0],
  ['an older verifiable head is caught by the pin, so the freeze cannot be used to roll a pinned reader back', by['older head (hseq 2, verifiable)'].cousin.verdict === 'host'],
  ['a cold reader between the two writes of an honest rotation is told `host` under either order, and one retry after both writes is ok', Object.values(orders).every((r) => r.between.startsWith('host') && r.retryAfter === 'ok')],
];
console.log('');
for (const [what, ok] of reading) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
console.log(`
  Reading. splitview-gate's whole strategy space is "serve reader R a verifiable head no newer
  than cap(R)". Against the weekend reader a pinned reader refuses any verifiable head older than
  its pin, so the only cap a host can apply to a pinned reader is the reader's own pin — i.e.
  "stop updating", per reader. The freeze is exactly that cap, applied to every pinned reader at
  once WITHOUT the host having to know who any of them is or what they hold: one garbled file does
  per-reader capping for free — note that "stops updating" with ONE old file is caught by mom, who
  had seen further, while the freeze is caught by nobody pinned. splitview priced per-reader caps
  as available to the host (it identifies readers by header), so this is a priced strategy with
  its identification cost removed, and two differences in the reader's favour: the frozen reader
  carries a note that the stalled one does not, and every cold reader is told \`host\`, which no
  cap strategy ever produces. The social path catches it on the
  same terms as withholding. §12.7 holds — but the spec should say the note is "no head I can
  verify", not "no newer head", because the same note is also what an honest mid-rotation host
  produces, and a cold reader in that window is told \`host\` under either write order: the window
  is one request wide and only a reader-side retry closes it, not the publisher's ordering.`);
hubA.server.close(); hubM.server.close();
if (reading.some(([, ok]) => !ok)) process.exit(1);
