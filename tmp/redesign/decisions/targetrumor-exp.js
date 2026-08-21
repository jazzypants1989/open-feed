// Experiment E — drop the carried pin; let a reply's own target be the rumor.
// Every reply must already name what it answers: (author key, post number, hash). A reader that
// sees a reply to a number ABOVE the top of the head it holds for that author re-fetches, and if
// the host still will not show it, raises a rumor naming the replier — never an accusation. A
// missing number at or below the top is a withdrawal (the host cannot edit a signed head), so a
// reply to a withdrawn or superseded post raises nothing. Same hub, caps, and strategy
// enumeration as ../gates/splitview-gate.js, in-process, with the naive pin rule alongside.
//
//   node tmp/redesign/decisions/targetrumor-exp.js
import { makeKey, sign, split, verify, address, H, makeHead, entry } from '../gates/lastline.js';

const keys = Object.fromEntries(['alice', 'mom', 'cousin', 'jesse', 'ex'].map((n) => [n, makeKey(n)]));
const hseqOf = (head) => JSON.parse(split(head).body).hseq;

// A hub with a per-(reader, author) cap on the head version it serves; posts only if listed.
class Hub {
  constructor() { this.authors = new Map(); this.view = new Map(); }
  author(a) { if (!this.authors.has(a)) this.authors.set(a, { heads: [], posts: new Map() }); return this.authors.get(a); }
  cap(reader, author, hseq) { this.view.set(`${reader}|${author}`, hseq); }
  put(author, kind, n, body, ifMatch) {
    const A = this.author(author);
    if (kind === 'head') { const cur = A.heads.at(-1); if ((cur ? H(cur) : null) !== ifMatch) return { status: 412 }; A.heads.push(body); return { status: 200 }; }
    if (A.posts.has(n)) return { status: 409 }; A.posts.set(n, body); return { status: 201 };
  }
  get(reader, author, kind, n) {
    const A = this.author(author), cap = this.view.get(`${reader}|${author}`) ?? Infinity;
    const head = A.heads.filter((h) => hseqOf(h) <= cap).at(-1);
    if (!head) return null;
    if (kind === 'head') return head;
    return JSON.parse(split(head).body).entries.some(([m]) => m === n) && A.posts.has(n) ? A.posts.get(n) : null;
  }
}
function publish(hub, author, hseq, posts, withdraw = []) {
  const key = keys[author], A = hub.author(author);
  for (const p of posts) hub.put(author, 'post', p.n, sign({ n: p.n, ...p }, key));
  const entries = [...A.posts.entries()].filter(([n]) => !withdraw.includes(n)).sort(([a], [b]) => a - b).map(([n, f]) => entry(n, f));
  const cur = A.heads.at(-1);
  hub.put(author, 'head', null, makeHead({ hseq, prev: cur ? address(cur) : null, entries }, key), cur ? H(cur) : null);
}

// The reader. mode 'pin' is the gate's naive rule; mode 'target' is the one on trial.
function reader(name, home, mode) {
  const known = new Map(), verdicts = []; const say = (v) => { if (!verdicts.includes(v)) verdicts.push(v); };
  function head(author) {
    const f = home[author].get(name, author, 'head');
    if (!f || !verify(f, keys[author].x)) return null;
    const obj = JSON.parse(split(f).body), hash = address(f), cur = known.get(author);
    if (cur && obj.hseq < cur.hseq) say(`ROLLBACK:${author}`);
    else if (cur && obj.hseq === cur.hseq && hash !== cur.hash) say(`FORK:${author}`);
    else known.set(author, { hseq: obj.hseq, hash, top: Math.max(0, ...obj.entries.map(([n]) => n)), entries: obj.entries });
    return obj;
  }
  function check(about, t, from) {
    const k = known.get(about);
    if (mode === 'pin') {
      if (k && t.pin.hseq < k.hseq) return;
      if (k && t.pin.hseq === k.hseq && t.pin.hash === k.hash) return;
      head(about); const now = known.get(about);
      if (!now || now.hseq < t.pin.hseq) say(`WITHHELD:${about}`);
      else if (now.hseq === t.pin.hseq && now.hash !== t.pin.hash) say(`FORK:${about}`);
      return;
    }
    if (k && t.n <= k.top) return;                      // listed, or withdrawn: nothing to say
    head(about); const now = known.get(about);
    if (!now || t.n > now.top) say(`RUMOR:${about} via ${from}`);
  }
  function poll(author) {
    const h = head(author); if (!h) return;
    const best = new Map();
    for (const [n] of h.entries) {
      const f = home[author].get(name, author, 'post', n);
      if (!f || !verify(f, keys[author].x)) continue;
      const t = JSON.parse(split(f).body).target;
      if (t && (!best.has(t.who) || (mode === 'pin' ? t.pin.hseq > best.get(t.who).pin.hseq : t.n > best.get(t.who).n))) best.set(t.who, t);
    }
    for (const [about, t] of best) check(about, t, author);
  }
  return { name, known, verdicts, poll, head };
}
// A reply to the latest post the replier has seen from its target, carrying a pin only in pin mode.
const replyTo = (r, who, n, mode) => { const k = r.known.get(who) ?? { top: 0, entries: [], hseq: 0, hash: '' }; const e = k.entries.find(([m]) => m === k.top); return { n, body: 'so proud', target: { who, n: k.top, hash: e?.[1] ?? '', ...(mode === 'pin' ? { pin: { hseq: k.hseq, hash: k.hash } } : {}) } }; };

function run({ hubs, home, caps = [], follows, mode, extra = null }) {
  for (const h of hubs) { h.authors.clear(); h.view.clear(); }
  publish(home.alice, 'alice', 40, [1, 2, 3, 4, 5].map((n) => ({ n, body: `post ${n}` })));
  for (let s = 41; s <= 47; s++) publish(home.alice, 'alice', s, [{ n: s - 35, body: `post ${s - 35}` }]);
  const others = Object.keys(follows).filter((n) => n !== 'alice');
  for (const n of others) { publish(home[n], n, 1, [{ n: 1, body: 'hello' }]); publish(home[n], n, 2, [{ n: 2, body: 'a real post' }]); }
  for (const [r, a, hseq] of caps) home[a].cap(r, a, hseq);
  const readers = Object.fromEntries(Object.keys(follows).map((n) => [n, reader(n, home, mode)]));
  for (const n of Object.keys(follows)) {
    readers[n].head(n);
    for (const a of follows[n]) readers[n].poll(a);
    publish(home[n], n, n === 'alice' ? 48 : 3, follows[n].map((a, i) => replyTo(readers[n], a, (n === 'alice' ? 20 : 10) + i, mode)));
  }
  if (extra) extra(readers);
  for (const [n, list] of Object.entries(follows)) for (const a of list) readers[n].poll(a);
  return readers;
}
const hostile = new Hub(), outside = new Hub(), honest = new Hub();
const hubs = [hostile, outside, honest];
const captive = { alice: hostile, mom: hostile, cousin: hostile, jesse: outside, ex: outside };
const fam = { mom: ['alice'], cousin: ['alice', 'mom'] };

function enumerate(pairs, follows, home, mode) {
  let undetected = 0;
  for (let mask = 1; mask < 1 << pairs.length; mask++) {
    const caps = pairs.filter((_, i) => mask & (1 << i)).map(([r, a]) => [r, a, a === 'alice' ? 40 : 1]);
    const readers = run({ hubs, home, caps, follows, mode });
    if (!Object.values(readers).some((r) => r.verdicts.length)) undetected++;
  }
  return { total: (1 << pairs.length) - 1, undetected };
}
const family = [['mom', 'alice'], ['cousin', 'alice'], ['alice', 'mom'], ['cousin', 'mom'], ['alice', 'cousin'], ['mom', 'cousin']];
const withJesse = [...family, ['jesse', 'alice'], ['jesse', 'mom'], ['jesse', 'cousin']];
const f3 = { alice: ['mom', 'cousin'], mom: ['alice', 'cousin'], cousin: ['alice', 'mom'] };
const f4 = { alice: ['mom', 'cousin', 'jesse'], mom: ['alice', 'cousin', 'jesse'], cousin: ['alice', 'mom', 'jesse'], jesse: ['alice', 'mom', 'cousin'] };
const f4np = { ...f4, cousin: ['alice', 'mom'] };

const rows = [];
for (const mode of ['pin', 'target']) {
  const honestRun = run({ hubs, home: captive, follows: fam, mode });
  const f1 = run({ hubs, home: { ...captive, mom: outside }, caps: [['cousin', 'alice', 40]], follows: fam, mode });
  rows.push([mode, 'honest hub', honestRun.cousin.verdicts.join(', ') || 'quiet']);
  rows.push([mode, 'F1: cousin held at 40, mom outside', f1.cousin.verdicts.join(', ') || 'quiet']);
  for (const [label, pairs, follows, home] of [['captive family (readers only)', family, f3, captive], ['one outsider, cousin follows him', withJesse, f4, captive], ['one outsider, cousin does not', withJesse, f4np, captive]]) {
    const r = enumerate(pairs, follows, home, mode); rows.push([mode, label, `${r.undetected} of ${r.total} undetected`]);
  }
}
console.log('\n  rule     scenario                              what the reader says');
for (const [m, s, v] of rows) console.log(`  ${m.padEnd(8)} ${s.padEnd(37)} ${v}`);

// The edit: Alice supersedes #7 with #13 and withdraws #7; mom had replied to #7. Honest host.
const honestHome = { ...captive, alice: honest, mom: honest };
const edit = run({ hubs, home: honestHome, follows: { mom: ['alice'], cousin: ['alice', 'mom'] }, mode: 'target', extra: (readers) => {
  publish(honest, 'mom', 4, [{ n: 11, body: 'lovely', target: { who: 'alice', n: 7, hash: address(honest.author('alice').posts.get(7)) } }]);
  publish(honest, 'alice', 48, [{ n: 13, body: 'post 7, corrected', _rel: [{ type: 'supersedes', n: 7, hash: address(honest.author('alice').posts.get(7)) }] }], [7]);
} });
const editQuiet = !edit.cousin.verdicts.length && !edit.cousin.known.get('alice').entries.some(([n]) => n === 7);
// The forged target: the ex, whom cousin follows, replies to Alice's "#999".
const forged = run({ hubs, home: honestHome, follows: { cousin: ['alice', 'ex'] }, mode: 'target', extra: () => publish(outside, 'ex', 1, [{ n: 1, body: 'lies', target: { who: 'alice', n: 999, hash: 'junk' } }]) });
console.log(`\n  edit (#13 supersedes #7, #7 withdrawn, mom's old reply to #7): cousin says ${edit.cousin.verdicts.join(', ') || 'nothing'}`);
console.log(`  forged target (999, junk) from the ex on an honest host:       cousin says ${forged.cousin.verdicts.join(', ')}`);
// Revert-check: rumor on any missing number (no "above the top" rule) turns the edit into a false rumor.
const naive = run({ hubs, home: honestHome, follows: { mom: ['alice'], cousin: ['alice', 'mom'] }, mode: 'target', extra: (readers) => {
  publish(honest, 'mom', 4, [{ n: 11, body: 'lovely', target: { who: 'alice', n: 7, hash: 'h' } }]);
  publish(honest, 'alice', 48, [{ n: 13, body: 'post 7, corrected' }], [7]);
  for (const r of Object.values(readers)) { const k = r.known; r.known.get = (a) => { const v = Map.prototype.get.call(k, a); return v && { ...v, top: -1 }; }; }
} });
console.log(`  revert-check (rumor on any unlisted number): cousin says ${naive.cousin.verdicts.join(', ') || 'nothing'} — a false rumor against an honest host`);

const pinRows = rows.filter(([m]) => m === 'pin').map(([, , v]) => v), tgtRows = rows.filter(([m]) => m === 'target').map(([, , v]) => v);
console.log(`
  Reading. The target catches exactly what the pin caught, strategy for strategy: F1 (${tgtRows[1]}),
  the captive family (${tgtRows[2]} under both rules), one outsider on the social path (${tgtRows[3]}
  under both — the gate's "0 of 511" counted the author echo, which is a freshness guess and is
  moot once replies name posts rather than head versions). The "above the top" rule keeps an edit
  quiet (${editQuiet ? 'no rumor' : 'RUMOR — wrong'}) and turns a forgery into a rumor that names its source. The pin bought
  two fields, a glossary term, and a forgery surface for nothing the reply was not already carrying.
`);
