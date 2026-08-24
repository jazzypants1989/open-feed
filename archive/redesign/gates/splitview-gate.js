// splitview-gate: does "the host cannot show two people different histories without their replies
// colliding" hold? A hostile hub over real sockets serving per-reader stale heads, readers whose
// replies carry the pin (hseq, hash), every captive-family strategy enumerated with and without an
// outsider, a forged pin against an honest host, and the two repairs.
// Kill criteria: a strategy with one interacting outsider and a social path that neither the
// reader rule nor the author echo flags; a forged pin that either repair fails to neutralize.
import http from 'node:http';
import { makeKey, sign, split, verify, address, H, makeHead, open, entry, rawSign, rawOK } from './lastline.js';

const keys = Object.fromEntries(['alice', 'mom', 'cousin', 'jesse', 'ex'].map((n) => [n, makeKey(n)]));
const hseqOf = (head) => JSON.parse(split(head).body).hseq;

// ---- a hub: authors' heads and posts, a per-(reader, author) cap on the head it serves, a log ----
class Hub {
  constructor(name) { this.name = name; this.authors = new Map(); this.view = new Map(); this.log = []; }
  author(a) { if (!this.authors.has(a)) this.authors.set(a, { heads: [], posts: new Map() }); return this.authors.get(a); }
  cap(reader, author, hseq) { this.view.set(`${reader}|${author}`, hseq); }
  handle(reader, method, path, body, ifMatch) {
    this.log.push({ reader, method, path });
    const m = path.match(/^\/([^/]+)\/(head|posts\/(\d+))$/);
    if (!m) return { status: 404 };
    const [, a, kind, n] = m; const A = this.author(a);
    if (method === 'PUT') {
      if (reader !== a) return { status: 403 };
      if (kind === 'head') { const cur = A.heads.at(-1); if ((cur ? H(cur) : null) !== ifMatch) return { status: 412 }; A.heads.push(Buffer.from(body)); return { status: 200 }; }
      if (A.posts.has(+n)) return { status: 409 }; A.posts.set(+n, Buffer.from(body)); return { status: 201 };
    }
    const cap = this.view.get(`${reader}|${a}`) ?? Infinity;
    const head = A.heads.filter((h) => hseqOf(h) <= cap).at(-1);
    if (!head) return { status: 404 };
    if (kind === 'head') return { status: 200, body: head };
    const listed = JSON.parse(split(head).body).entries.some(([m]) => m === +n);
    return listed && A.posts.has(+n) ? { status: 200, body: A.posts.get(+n) } : { status: 404 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => { const r = this.handle(req.headers['x-reader'], req.method, req.url, Buffer.concat(chunks), req.headers['if-match'] ?? null); res.writeHead(r.status); res.end(r.body); });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
const overSocket = async (hub, reader, method, path, body, ifMatch) => {
  const r = await fetch(hub.url + path, { method, body, headers: { 'x-reader': reader, ...(ifMatch ? { 'if-match': ifMatch } : {}) } });
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
};
const inProcess = async (hub, reader, method, path, body, ifMatch) => hub.handle(reader, method, path, body, ifMatch);

// ---- fix B's head: the signature covers "hseq\nH(body)", so (hseq, hash, sig) verifies alone ----
const makeHeadB = (fields, key) => { const body = split(makeHead(fields, key)).body; return Buffer.concat([body, Buffer.from('\n'), Buffer.from(rawSign(`${fields.hseq}\n${H(body)}`, key))]); };
const verifyHeadB = (file, x) => { try { const { body, sigText } = split(file); return rawOK(`${JSON.parse(body).hseq}\n${H(body)}`, sigText, x); } catch { return false; } };
const pinOK = (pin, x) => rawOK(`${pin.hseq}\n${pin.hash}`, pin.sig ?? '', x);

// ---- an author publishes posts and a new head under CAS ----
async function publish(transport, hub, author, hseq, posts, { b = false } = {}) {
  const key = keys[author], A = hub.author(author);
  for (const p of posts) { const f = sign({ n: p.n, ...p }, key); await transport(hub, author, 'PUT', `/${author}/posts/${p.n}`, f); }
  const entries = [...A.posts.entries()].sort(([a], [c]) => a - c).map(([n, f]) => entry(n, f));
  const cur = A.heads.at(-1);
  const head = (b ? makeHeadB : makeHead)({ hseq, prev: cur ? address(cur) : null, entries }, key);
  const r = await transport(hub, author, 'PUT', `/${author}/head`, head, cur ? H(cur) : null);
  return { status: r.status, hseq, hash: address(head), sig: split(head).sigText };
}

// ---- a reader: pins from verified heads, replies' pins checked once per poll, three rules ----
// The echo is scored against the author's hseq BEFORE the reply round, which a simulation knows
// and a real reader does not: to a real author a low pin is indistinguishable from honest lag.
function reader(name, home, transport, baseline, { mode = 'naive' } = {}) {
  const pins = new Map(), verdicts = [], echoes = [];
  const verifyHead = (f, x) => (mode === 'b' ? verifyHeadB(f, x) : verify(f, x));
  async function head(author) {
    const r = await transport(home[author], name, 'GET', `/${author}/head`);
    if (r.status !== 200 || !verifyHead(r.body, keys[author].x)) return null;
    const obj = JSON.parse(split(r.body).body), hash = address(r.body), cur = pins.get(author);
    if (cur && obj.hseq < cur.hseq) verdicts.push(`ROLLBACK:${author}`);
    else if (cur && obj.hseq === cur.hseq && hash !== cur.hash) verdicts.push(`FORK:${author}`);
    else pins.set(author, { hseq: obj.hseq, hash, sig: split(r.body).sigText });
    return obj;
  }
  async function checkPin(about, pin, from) {
    if (about === name) { if (pin.hseq < baseline[name]) echoes.push(`${from} saw me at ${pin.hseq}`); return; }
    if (mode === 'b' && !pinOK(pin, keys[about].x)) { verdicts.push(`REPLIER-LIED:${from}`); return; }
    const known = pins.get(about);
    if (known && pin.hseq < known.hseq) return;
    if (known && pin.hseq === known.hseq && pin.hash === known.hash) return;
    await head(about);
    const now = pins.get(about);
    const hint = mode === 'hint';
    if (!now || now.hseq < pin.hseq) verdicts.push(hint ? `UNVERIFIED-CLAIM:${about}` : `WITHHELD:${about}`);
    else if (now.hseq === pin.hseq && now.hash !== pin.hash) verdicts.push(hint ? `UNVERIFIED-CLAIM:${about}` : `FORK:${about}`);
  }
  async function poll(author) {
    const h = await head(author);
    if (!h) return;
    const best = new Map();
    for (const [n] of h.entries) {
      const r = await transport(home[author], name, 'GET', `/${author}/posts/${n}`);
      if (r.status !== 200 || !verify(r.body, keys[author].x)) continue;
      const t = JSON.parse(split(r.body).body).target;
      if (t?.pin && (!best.has(t.who) || t.pin.hseq > best.get(t.who).hseq)) best.set(t.who, t.pin);
    }
    for (const [about, pin] of best) await checkPin(about, pin, author);
  }
  return { name, pins, verdicts, echoes, poll, head };
}

// ---- one run: Alice at 47, everyone else at 1; caps; each participant polls what it follows and
// replies to every author it follows carrying the pin it holds; the ex forges; a final poll ----
async function run({ transport, hubs, home, caps = [], follows, forged = null, mode = 'naive', b = false }) {
  for (const h of Object.values(hubs)) { h.authors.clear(); h.view.clear(); h.log.length = 0; }
  await publish(transport, home.alice, 'alice', 40, [1, 2, 3, 4, 5].map((n) => ({ n, body: `post ${n}` })), { b });
  for (let s = 41; s <= 47; s++) await publish(transport, home.alice, 'alice', s, [{ n: s - 35, body: `post ${s - 35}` }], { b });
  const a47 = { hseq: 47, hash: address(home.alice.author('alice').heads.at(-1)), sig: split(home.alice.author('alice').heads.at(-1)).sigText };
  const others = Object.keys(follows).filter((n) => n !== 'alice');
  for (const n of others) { await publish(transport, home[n], n, 1, [{ n: 1, body: 'hello' }], { b }); await publish(transport, home[n], n, 2, [{ n: 2, body: 'a real post' }], { b }); }
  const baseline = { alice: 47, ...Object.fromEntries(others.map((n) => [n, 2])) };
  for (const [r, a, hseq] of caps) home[a].cap(r, a, hseq);
  const readers = Object.fromEntries(Object.keys(follows).map((n) => [n, reader(n, home, transport, baseline, { mode })]));
  const reply = (who, n, pin) => ({ n, body: 'so proud', target: { who, n: 1, pin: { hseq: pin.hseq, hash: pin.hash, ...(b ? { sig: pin.sig } : {}) } } });
  for (const n of Object.keys(follows)) {
    await readers[n].head(n);
    for (const a of follows[n]) await readers[n].poll(a);
    const posts = follows[n].map((a, i) => reply(a, (n === 'alice' ? 20 : 10) + i, readers[n].pins.get(a) ?? { hseq: 0, hash: '' }));
    await publish(transport, home[n], n, n === 'alice' ? 48 : 3, posts, { b });
  }
  if (forged) await publish(transport, home.ex, 'ex', 1, [reply('alice', 1, forged)], { b });
  for (const [n, list] of Object.entries(follows)) for (const a of list) await readers[n].poll(a);
  return { readers, a47 };
}
const hostile = new Hub('HOSTILE'), outside = new Hub('OUTSIDE'), honest = new Hub('HONEST');
await Promise.all([hostile.listen(), outside.listen(), honest.listen()]);
const hubs = { hostile, outside, honest };
const captive = { alice: hostile, mom: hostile, cousin: hostile, jesse: outside, ex: outside };
const gate = [];

// 1. Honest hub: mom and cousin converge, no verdicts.
{
  const { readers } = await run({ transport: overSocket, hubs, home: captive, follows: { mom: ['alice'], cousin: ['alice', 'mom'] } });
  gate.push(['honest hub over sockets: mom and cousin pin the same (hseq, hash) and raise no verdict', readers.mom.pins.get('alice').hseq === 47 && readers.cousin.pins.get('alice').hash === readers.mom.pins.get('alice').hash && !readers.mom.verdicts.length && !readers.cousin.verdicts.length]);
}
// 2. F1 over sockets: cousin capped at 40; mom, hosted OUTSIDE, replies with 47; cousin reads it there.
{
  const home = { ...captive, mom: outside };
  const { readers } = await run({ transport: overSocket, hubs, home, caps: [['cousin', 'alice', 40]], follows: { mom: ['alice'], cousin: ['alice', 'mom'] } });
  const viaOutside = outside.log.some((l) => l.reader === 'cousin' && l.path === '/mom/posts/10');
  gate.push(['F1 over sockets: the capped cousin reads mom\'s pin from OUTSIDE, re-fetches HOSTILE, and names WITHHELD', readers.cousin.verdicts.includes('WITHHELD:alice') && viaOutside]);
}
// 3. Uniform stale: everyone but Alice capped at 40; her CAS writes all land; nobody raises anything.
{
  const caps = ['mom', 'cousin', 'jesse'].map((r) => [r, 'alice', 40]);
  const { readers } = await run({ transport: overSocket, hubs, home: captive, caps, follows: { alice: ['jesse'], mom: ['alice', 'jesse'], cousin: ['alice', 'mom', 'jesse'], jesse: ['alice'] } });
  const allAt40 = ['mom', 'cousin', 'jesse'].every((r) => readers[r].pins.get('alice').hseq === 40);
  const quiet = ['mom', 'cousin', 'jesse'].every((r) => !readers[r].verdicts.length);
  const echoed = readers.alice.echoes.length > 0 && outside.log.some((l) => l.reader === 'alice' && l.path === '/jesse/posts/1');
  gate.push(['uniform stale: all three readers agree at 40, no verdict anywhere, Alice\'s writes all landed', allAt40 && quiet && hostile.author('alice').heads.length === 9]);
  gate.push(['uniform stale: the only signal is the author echo — Alice reading jesse\'s pin about her from OUTSIDE', echoed]);
}
// 4-5. Every captive-family strategy, without and with an interacting outsider.
async function enumerate(pairs, follows, home) {
  let undetected = 0, undetectedByReaders = 0; const survivors = [];
  for (let mask = 1; mask < 1 << pairs.length; mask++) {
    const caps = pairs.filter((_, i) => mask & (1 << i)).map(([r, a]) => [r, a, a === 'alice' ? 40 : 1]);
    const { readers } = await run({ transport: inProcess, hubs, home, caps, follows });
    const byReaders = Object.values(readers).some((r) => r.verdicts.length);
    const byEcho = Object.values(readers).some((r) => r.echoes.length);
    if (!byReaders) undetectedByReaders++;
    if (!byReaders && !byEcho) { undetected++; survivors.push(caps.map(([r, a]) => `${r}<${a}`).join(' ')); }
  }
  return { total: (1 << pairs.length) - 1, undetected, undetectedByReaders, survivors };
}
const family = [['mom', 'alice'], ['cousin', 'alice'], ['alice', 'mom'], ['cousin', 'mom'], ['alice', 'cousin'], ['mom', 'cousin']];
const noOutsider = await enumerate(family, { alice: ['mom', 'cousin'], mom: ['alice', 'cousin'], cousin: ['alice', 'mom'] }, captive);
const withJesse = [...family, ['jesse', 'alice'], ['jesse', 'mom'], ['jesse', 'cousin']];
const outsiderPath = await enumerate(withJesse, { alice: ['mom', 'cousin', 'jesse'], mom: ['alice', 'cousin', 'jesse'], cousin: ['alice', 'mom', 'jesse'], jesse: ['alice', 'mom', 'cousin'] }, captive);
const outsiderNoPath = await enumerate(withJesse, { alice: ['mom', 'cousin', 'jesse'], mom: ['alice', 'cousin', 'jesse'], cousin: ['alice', 'mom'], jesse: ['alice', 'mom', 'cousin'] }, captive);
const named = 'cousin<alice cousin<mom alice<cousin mom<cousin';
console.log(`  captive family, no outsider:       ${noOutsider.undetected} of ${noOutsider.total} strategies undetected (${noOutsider.undetectedByReaders} by readers alone)`);
console.log(`    surviving: ${noOutsider.survivors.join(' | ')}`);
console.log(`  one outsider, cousin follows him:  ${outsiderPath.undetected} of ${outsiderPath.total} undetected (${outsiderPath.undetectedByReaders} by readers alone)`);
console.log(`  one outsider, cousin does not:     ${outsiderNoPath.undetected} of ${outsiderNoPath.total} undetected (${outsiderNoPath.undetectedByReaders} by readers alone)`);
if (outsiderPath.undetected) console.log(`    surviving with the outsider: ${outsiderPath.survivors.slice(0, 6).join(' | ')}${outsiderPath.survivors.length > 6 ? ' | …' : ''}`);
gate.push([`captive family: ${noOutsider.undetected} strategies escape readers and echo, including the cousin isolated both ways`, noOutsider.undetected > 0 && noOutsider.survivors.includes(named)]);
gate.push(['one interacting outsider with a social path to the stale reader: every strategy is caught by readers or echo', outsiderPath.undetected === 0]);
gate.push(['the same outsider without the social path: strategies escape again — the path, not the pin, does the work', outsiderNoPath.undetected > outsiderPath.undetected]);
// 6-8. A forged pin against an honest host, under the naive rule and the two repairs.
const honestHome = { ...captive, alice: honest };
const forgedRun = (forged, mode, b) => run({ transport: inProcess, hubs, home: honestHome, follows: { cousin: ['alice', 'ex'] }, forged, mode, b });
const naive999 = (await forgedRun({ hseq: 999, hash: 'junk' }, 'naive')).readers.cousin.verdicts;
const naive47 = (await forgedRun({ hseq: 47, hash: 'junk' }, 'naive')).readers.cousin.verdicts;
const hint999 = (await forgedRun({ hseq: 999, hash: 'junk' }, 'hint')).readers.cousin.verdicts;
const hint47 = (await forgedRun({ hseq: 47, hash: 'junk' }, 'hint')).readers.cousin.verdicts;
const hintF1 = (await run({ transport: inProcess, hubs, home: { ...captive, mom: outside }, caps: [['cousin', 'alice', 40]], follows: { mom: ['alice'], cousin: ['alice', 'mom'] }, mode: 'hint' })).readers.cousin.verdicts;
const b999 = (await forgedRun({ hseq: 999, hash: 'junk', sig: 'x'.repeat(86) }, 'b', true)).readers.cousin.verdicts;
const bF1 = (await run({ transport: inProcess, hubs, home: { ...captive, mom: outside }, caps: [['cousin', 'alice', 40]], follows: { mom: ['alice'], cousin: ['alice', 'mom'] }, mode: 'b', b: true })).readers.cousin.verdicts;
const realB = await run({ transport: inProcess, hubs, home: honestHome, follows: { cousin: ['alice'] }, mode: 'b', b: true });
const bodyOnlySig = rawSign(realB.a47.hash, keys.alice);
const bodyOnlyForged = { hseq: 999, hash: realB.a47.hash, sig: bodyOnlySig };
const bodyOnlyVerifies = rawOK(bodyOnlyForged.hash, bodyOnlyForged.sig, keys.alice.x) && !pinOK(bodyOnlyForged, keys.alice.x);
gate.push(['forged pin (999, junk) about an honest host: the naive rule convicts the honest host of WITHHELD', naive999.includes('WITHHELD:alice')]);
gate.push(['forged pin (47, junk): the naive rule reports a FORK — an honest Alice reads as compromised', naive47.includes('FORK:alice')]);
gate.push(['repair A (pin is a hint): both forgeries become UNVERIFIED-CLAIM, no accusation', hint999.includes('UNVERIFIED-CLAIM:alice') && hint47.includes('UNVERIFIED-CLAIM:alice') && !hint999.some((v) => /WITHHELD|FORK/.test(v))]);
gate.push(['repair A\'s price: the genuine F1 case also degrades to UNVERIFIED-CLAIM — nobody can hand cousin head 47', hintF1.includes('UNVERIFIED-CLAIM:alice') && !hintF1.includes('WITHHELD:alice')]);
gate.push(['repair B (head signs "hseq\\nhash"): the forgery names the replier, and F1 convicts HOSTILE again', b999.includes('REPLIER-LIED:ex') && bF1.includes('WITHHELD:alice')]);
gate.push(['repair B needs hseq inside the signed summary: a signature over the hash alone verifies for (999, h47)', bodyOnlyVerifies]);
// 9. Griefing: a thousand pins above the known hseq cost one re-fetch per poll.
{
  for (const h of Object.values(hubs)) { h.authors.clear(); h.view.clear(); h.log.length = 0; }
  await publish(inProcess, honest, 'alice', 47, [{ n: 1, body: 'x' }]);
  const ps = Array.from({ length: 1000 }, (_, i) => ({ n: i + 1, body: 'g', target: { who: 'alice', n: 1, pin: { hseq: 1000 + i, hash: 'junk' } } }));
  await publish(inProcess, outside, 'ex', 1, ps);
  const c = reader('cousin', honestHome, inProcess, { cousin: 1 });
  await c.poll('alice'); honest.log.length = 0; await c.poll('ex');
  gate.push(['griefing: 1,000 pins above the known hseq in one poll cost one re-fetch of the head, not 1,000', honest.log.filter((l) => l.path === '/alice/head').length === 1]);
}
// 10. Sealed replies: withholding one is the same cap entry as withholding any reply.
{
  const sealed = await run({ transport: inProcess, hubs, home: captive, caps: [['cousin', 'alice', 40], ['cousin', 'mom', 1]], follows: { mom: ['alice'], cousin: ['alice', 'mom'] } });
  gate.push(['withholding mom\'s reply (sealed or not) is the cap on mom\'s head — no new fork class, and cousin stays undetected', !sealed.readers.cousin.verdicts.length && sealed.readers.cousin.pins.get('mom').hseq === 1]);
}
// Detection latency: alice posts daily, cousin frozen, jesse replies every D days, cousin polls him daily.
const latency = [1, 3, 7, 30].map((D) => [D, (Array.from({ length: D }, (_, phase) => (phase === 0 ? D : D - phase)).reduce((a, b) => a + b) / D).toFixed(1)]);
console.log(`  detection latency in days, jesse replying every D days (mean over phase): ${latency.map(([D, d]) => `D=${D}: ${d}`).join('  ')}; all-captive: never\n`);

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const h of Object.values(hubs)) h.server.close();
if (failed.length) process.exit(1);
console.log('splitview-gate: all claims hold');
