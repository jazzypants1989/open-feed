// pubif-gate: the publish interface, over real sockets. Signed PUT at conventional paths;
// compare-and-swap on the two files that are overwritten (profile, head); create-once on numbered
// files; first-come naming with the profile as the proof; a host that checks stamps and a host that
// does not, and one that checks only when a number is already taken. Two devices race on the head
// and on a number. This is GOALS scenario 6's dumb hub, and writer-gate proved the CAS convention
// on the OLD substrate — nothing here imports that one.
// Kill criteria: a race that loses a post or a head entry; a replayed PUT that lands; an outsider
// who takes over a name or writes as Alice; a reader whose verdict depends on which host it was.
import http from 'node:http';
import { makeKey, sign, split, verify, address, H, parseStrict, walkChain, rotHop, mkRec } from './lastline.js';

const A = makeKey('alice-genesis'), A2 = makeKey('alice-rotated'), ex = makeKey('ex');
const REC = mkRec(1, 'salt', [makeKey('mum').x]);
const genesis = [{ key: A.x }];
const profile = (fields, key) => sign({ genesis: A.x, recovery: REC, locations: ['https://alice.example'], ...fields }, key);
const p1 = profile({ pseq: 1, chain: genesis }, A);
const p2 = profile({ pseq: 2, prev: address(p1), chain: [...genesis, rotHop(A, A2)] }, A2);
const post = (n, key = A) => sign({ n, text: `post ${n}` }, key);

// ---- the hub ----
// Everything it knows about identity comes from the profile file sitting at the name. There are no
// accounts, no tokens and no sessions: the request IS the signed file, which is why a replay is
// harmless (below) and why `checkStamps: false` leaves it with no idea who is writing.
class Hub {
  constructor({ checkStamps, reclaim = false }) { this.checkStamps = checkStamps; this.reclaim = reclaim; this.files = new Map(); }
  // "Alice's file for THIS number" — a signature by her chain is not enough. A post declares its
  // own number inside its signed bytes (ruling 3), and without checking that here, a stranger can
  // replay a genuine post of hers into a number she has not reached and lock her out of it.
  ownersFile(name, file, n) {
    const w = this.chainOf(name);
    if (!w || !w.chainKeys.some((x) => verify(file, x))) return false;
    try { return parseStrict(split(file).body.toString('utf8')).n === n; } catch { return false; }
  }
  chainOf(name) {
    const f = this.files.get(`${name}/profile`);
    if (!f) return null;
    const w = walkChain(parseStrict(split(f).body.toString('utf8')));
    return w.ok ? w : null;
  }
  handle(method, path, body, ifMatch) {
    const m = path.match(/^\/([a-z]+)\/(profile|head|posts\/\d+)$/);
    if (!m) return { status: 404 };
    const [, name, kind] = m, key = `${name}/${kind}`, num = +(kind.split('/')[1] ?? NaN);
    if (method === 'GET') return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: H(this.files.get(key)) } : { status: 404 };
    if (method !== 'PUT') return { status: 405 };

    if (kind === 'profile') {
      let obj;
      try { obj = parseStrict(split(body).body.toString('utf8')); } catch { return { status: 400 }; }
      const cur = this.files.get(key);
      if (this.checkStamps) {
        const w = walkChain(obj);
        if (!w.ok || !verify(body, w.current)) return { status: 403 };
        if (cur) {
          const old = parseStrict(split(cur).body.toString('utf8'));
          if (old.genesis !== obj.genesis) return { status: 409 };      // the name is taken, by someone else
          if (obj.pseq <= old.pseq) return { status: 409 };             // and a rollback is not an update
        }
      } else if (cur) return { status: 409 };                           // first come, and nothing else known
      this.files.set(key, body);
      return { status: cur ? 200 : 201 };
    }

    const w = this.chainOf(name);
    if (this.checkStamps) {
      if (!w) return { status: 404 };                                   // claim the name first
      if (kind === 'head') { if (!verify(body, w.current)) return { status: 403 }; }
      else if (!this.ownersFile(name, body, num)) return { status: 403 };  // signed by her chain AND for this number
    }
    if (kind === 'head') {                                              // overwritten, so compare-and-swap
      const cur = this.files.get(key) ?? null;
      if ((cur ? H(cur) : null) !== ifMatch) return { status: 412, etag: cur ? H(cur) : null };
      this.files.set(key, body);
      return { status: 200, etag: H(body) };
    }
    if (this.files.has(key)) {                                          // create-once, with one exit
      // A number held by a file that is not the owner's may be reclaimed by the owner, and by
      // nobody else. Without this a hub that checks nothing on the normal path lets a stranger
      // burn every number Alice has not reached yet (the two runs below).
      if (!this.reclaim) return { status: 409 };
      if (this.ownersFile(name, this.files.get(key), num) || !this.ownersFile(name, body, num)) return { status: 409 };
      this.files.set(key, body);
      return { status: 200 };
    }
    this.files.set(key, body);
    return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const r = this.handle(req.method, req.url, Buffer.concat(chunks), req.headers['if-match'] ?? null);
        res.writeHead(r.status, r.etag ? { etag: r.etag } : {});
        res.end(r.body);
      });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
async function req(hub, method, path, body, ifMatch) {
  const r = await fetch(hub.url + path, { method, body, headers: ifMatch ? { 'if-match': ifMatch } : {} });
  return { status: r.status, etag: r.headers.get('etag'), body: Buffer.from(await r.arrayBuffer()) };
}

// ---- the head, as aohead-gate rules it: entries first, a fold, a declared top ----
const headBody = (entries, hseq, top, prev) => JSON.stringify({ entries, hseq, top, ...(prev ? { prev } : {}) });
const readEntries = (file) => (file?.length ? parseStrict(split(file).body.toString('utf8')) : { entries: [], hseq: 0, top: 0 });

// A device publishing one post: take the next free number, then fold its line into the head the
// host is actually serving — not into the device's own idea of it. Retries on 409 and on 412.
async function publish(hub, name, key, wanted, log, barrier = null) {
  let n = wanted;
  for (;;) {
    const r = await req(hub, 'PUT', `/${name}/posts/${n}`, post(n, key));
    log.push(`posts/${n} ${r.status}`);
    if (r.status === 201) break;
    if (r.status !== 409) return { ok: false, n, status: r.status };
    n++;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await req(hub, 'GET', `/${name}/head`);
    if (attempt === 0 && barrier) await barrier();          // both devices hold the same etag before either writes
    const h = readEntries(cur.status === 200 ? cur.body : null);
    const body = headBody([...h.entries, [n, address(post(n, key))]], h.hseq + 1, Math.max(h.top, n), cur.status === 200 ? address(cur.body) : null);
    const r = await req(hub, 'PUT', `/${name}/head`, sign(null, key, { bodyText: body }), cur.status === 200 ? cur.etag : null);
    log.push(`head ${r.status}`);
    if (r.status === 200) return { ok: true, n };
  }
  return { ok: false, n, status: 'gave up' };
}

// ---- the runs ----
const strict = await new Hub({ checkStamps: true }).listen();
const dumb = await new Hub({ checkStamps: false }).listen();
const lazy = await new Hub({ checkStamps: false, reclaim: true }).listen();
for (const h of [strict, dumb, lazy]) await req(h, 'PUT', '/alice/profile', p1);

// 1. two devices, one number, and a forced collision on the head: neither writes until both have
// read the same etag, so the loser really does take the 412 path and re-fold onto the winner's file.
const phoneLog = [], laptopLog = [];
let waiting = 0, release; const held = new Promise((ok) => { release = ok; });
const barrier = () => { if (++waiting === 2) release(); return held; };
const raced = await Promise.all([
  publish(strict, 'alice', A, 7, phoneLog, barrier),
  publish(strict, 'alice', A, 7, laptopLog, barrier),
]);
const afterRace = readEntries((await req(strict, 'GET', '/alice/head')).body);

// 2. the head race without CAS: both read the same head, both write, last one wins.
const nocas = await new Hub({ checkStamps: true }).listen();
await req(nocas, 'PUT', '/alice/profile', p1);
await req(nocas, 'PUT', '/alice/posts/7', post(7));
await req(nocas, 'PUT', '/alice/posts/8', post(8));
const h7 = sign(null, A, { bodyText: headBody([[7, address(post(7))]], 1, 7, null) });
const h8 = sign(null, A, { bodyText: headBody([[8, address(post(8))]], 1, 8, null) });
await req(nocas, 'PUT', '/alice/head', h7, null);
const clobber = await req(nocas, 'PUT', '/alice/head', h8, null);                   // no If-Match: refused
const lww = readEntries(h8);                                                        // what it WOULD have been
const lostReadsAs = 7 <= lww.top ? 'a withdrawal — silent' : 'above the top — a rumor';

// 3. replay. A captured PUT, resent, lands nowhere.
const replayPost = await req(strict, 'PUT', '/alice/posts/7', post(7));
const cur = await req(strict, 'GET', '/alice/head');
const replayHead = await req(strict, 'PUT', '/alice/head', cur.body, null);

// 4. the name. An outsider cannot take it, cannot rotate it, and Alice's own rotation lands.
const steal = await req(strict, 'PUT', '/alice/profile', profile({ pseq: 9, genesis: ex.x, chain: [{ key: ex.x }] }, ex));
const rotate = await req(strict, 'PUT', '/alice/profile', p2);
const rollback = await req(strict, 'PUT', '/alice/profile', p1);
const writeAsAlice = await req(strict, 'PUT', '/alice/posts/20', post(20, ex));
const dumbWriteAsAlice = await req(dumb, 'PUT', '/alice/posts/20', post(20, ex));
const readerRefuses = (file) => !parseStrict(split(p2).body.toString('utf8')).chain.some((h) => verify(file, h.key));

// 5. the griefer, against create-once, on each host.
const burn = async (hub) => { const out = []; for (let n = 30; n < 35; n++) out.push((await req(hub, 'PUT', `/alice/posts/${n}`, post(n, ex))).status); return out; };
const burnedStrict = await burn(strict), burnedDumb = await burn(dumb), burnedLazy = await burn(lazy);
const aliceAfterStrict = await req(strict, 'PUT', '/alice/posts/30', post(30));
const aliceAfterDumb = await req(dumb, 'PUT', '/alice/posts/30', post(30));
const reclaimed = []; for (let n = 30; n < 35; n++) reclaimed.push((await req(lazy, 'PUT', `/alice/posts/${n}`, post(n))).status);
const served = (await req(lazy, 'GET', '/alice/posts/30')).body;

// 6a. the replay that the number-in-the-file rule closes: he takes a genuine post of hers and puts
// it at a number she has not reached. It is signed by her chain, so a signature test alone calls it
// hers and locks her out of that number forever.
const replayedInto = await req(lazy, 'PUT', '/alice/posts/50', post(7));
const aliceReclaims50 = await req(lazy, 'PUT', '/alice/posts/50', post(50));

// 6. the reclaim rule turned around: it must work for the owner and for nobody else.
const griefAgain = await req(lazy, 'PUT', '/alice/posts/30', post(30, ex));          // after she reclaimed it
await req(lazy, 'PUT', '/alice/posts/40', post(40));                                 // a genuine post of hers
const griefGenuine = await req(lazy, 'PUT', '/alice/posts/40', post(40, ex));
const aliceOverwritesHerself = await req(lazy, 'PUT', '/alice/posts/40', sign({ n: 40, text: 'rewritten' }, A));

const hubLines = Hub.toString().split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;

console.log('\n  two devices publishing at once, against a host that checks stamps\n');
console.log(`    phone   ${phoneLog.join('  ')}`);
console.log(`    laptop  ${laptopLog.join('  ')}`);
console.log(`    landed at ${raced.map((r) => r.n).sort().join(' and ')}; the head lists ${afterRace.entries.map(([n]) => n).join(',')} at top ${afterRace.top}\n`);
console.log('  the same race on the head with no compare-and-swap');
console.log(`    the second write is refused (${clobber.status}); had it landed, the head would list ${lww.entries.map(([n]) => n).join(',')} at top ${lww.top},`);
console.log(`    and post 7 — which exists and verifies — would read to every reader as ${lostReadsAs}\n`);
console.log('  no accounts: what a captured request buys');
console.log(`    replaying the PUT of post 7:  ${replayPost.status} (create-once)      replaying the PUT of the head:  ${replayHead.status} (stale etag)\n`);
console.log('  the name, with the profile as the only proof');
console.log(`    outsider claims it: ${steal.status}   Alice rotates: ${rotate.status}   an older profile: ${rollback.status}   outsider posts as Alice: ${writeAsAlice.status}\n`);
console.log('  a griefer burning numbers 30-34, on three hubs');
console.log(`    checks every write:      ${burnedStrict.join(' ')}  →  Alice publishes 30: ${aliceAfterStrict.status}`);
console.log(`    checks nothing, ever:    ${burnedDumb.join(' ')}  →  Alice publishes 30: ${aliceAfterDumb.status}`);
console.log(`    checks on a collision:   ${burnedLazy.join(' ')}  →  Alice reclaims 30-34: ${reclaimed.join(' ')}`);
console.log(`    his replay of her genuine post 7 into the empty slot 50: ${replayedInto.status}, and she takes 50 back: ${aliceReclaims50.status}`);
console.log(`    and the reclaim rule the other way round — his write over what she reclaimed: ${griefAgain.status},`);
console.log(`    his write over a genuine post of hers: ${griefGenuine.status}, her own overwrite of her own post: ${aliceOverwritesHerself.status}\n`);
console.log(`  the whole hub is ${hubLines} lines\n`);

const gate = [
  ['two devices racing for one number: one 201, one 409, and the loser lands on the next number',
    raced.every((r) => r.ok) && raced.map((r) => r.n).sort().join() === '7,8'],
  ['the head collision really happened: one writer took a 412 and retried, and it is the retry that saved the entry',
    [phoneLog, laptopLog].filter((l) => l.includes('head 412')).length === 1],
  ['neither device loses its entry from the head — the loser re-reads what the host serves and folds its own line into that',
    afterRace.entries.map(([n]) => n).sort().join() === '7,8' && afterRace.top === 8],
  ['a head write without the etag the writer read is refused',
    clobber.status === 412],
  ['and the post it would have dropped reads as a withdrawal, so last-write-wins loses a post silently',
    lostReadsAs.startsWith('a withdrawal')],
  ['a replayed PUT lands nothing: create-once refuses the post, the stale etag refuses the head — no token, session or account anywhere',
    replayPost.status === 409 && replayHead.status === 412],
  ['an outsider cannot claim a name that has a profile, and cannot rotate someone else\'s',
    steal.status === 409],
  ['Alice\'s own rotation is accepted at the same name, and her older profile is refused as a rollback',
    rotate.status === 200 && rollback.status === 409],
  ['a host that checks stamps refuses a post signed by anyone outside the chain',
    writeAsAlice.status === 403],
  ['a host that does not check stamps stores it — and the reader refuses it either way, so the floor does not depend on the host',
    dumbWriteAsAlice.status === 201 && readerRefuses(post(20, ex))],
  ['but create-once and unchecked stamps do not compose: a griefer burns every number on the dumb hub and none on the strict one',
    burnedStrict.every((s) => s === 403) && burnedDumb.every((s) => s === 201)],
  ['and the burn is not a nuisance, it is a stop: Alice cannot publish at that number on the dumb hub, and can on the strict one',
    aliceAfterStrict.status === 201 && aliceAfterDumb.status === 409],
  ['the ruled repair: a hub that checks only on a collision lets Alice reclaim every number he took, and serves her bytes',
    burnedLazy.every((s) => s === 201) && reclaimed.every((s) => s === 200) && served.equals(post(30))],
  ['and reclaiming is the owner\'s alone — he cannot take back what she reclaimed, nor overwrite a genuine post of hers',
    griefAgain.status === 409 && griefGenuine.status === 409],
  ['create-once survives it: Alice cannot overwrite her own post either, so the exit opens only for a file that is not hers',
    aliceOverwritesHerself.status === 409],
  ['a post declaring its own number is what stops him replaying a genuine post of hers into a number she has not reached',
    replayedInto.status === 201 && aliceReclaims50.status === 200],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const h of [strict, dumb, lazy, nocas]) h.server.close();
if (failed.length) process.exit(1);
console.log('pubif-gate: all claims hold');
