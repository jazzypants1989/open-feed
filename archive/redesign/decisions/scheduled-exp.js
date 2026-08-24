// Review finding A1 — ruling 10 (host-released scheduled posts) against rulings 3 and 4
// (gapless numbers, author-only index). Alice pre-stamps #8 on Monday for Friday, then posts #9
// from her phone on Tuesday. What does a ruling-4 reader say on Tuesday, Wednesday and Friday?
import crypto from 'node:crypto';

const alice = crypto.generateKeyPairSync('ed25519');
const sign = (o) => { const b = Buffer.from(JSON.stringify(o)); return { body: o, bytes: b, stamp: crypto.sign(null, b, alice.privateKey).toString('base64url') }; };
const ok = (f) => crypto.verify(null, f.bytes, alice.publicKey, Buffer.from(f.stamp, 'base64url'));

const DAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 };
const post = (n, extra = {}) => sign({ n, body: `post ${n}`, ...extra });
const index = (seq, top, extra = {}) => sign({ seq, top, withdrawn: [], ...extra });

// The ruling-4 reader, exactly as index-exp.js has it: pinned seq, gapless expectation, top bound.
function verdict(idx, served, pinned, { now = null } = {}) {
  if (!ok(idx)) return ['index not stamped by Alice'];
  const b = idx.body, out = [];
  if (b.seq < pinned) out.push(`ROLLBACK: index ${b.seq} after ${pinned}`);
  for (let n = 1; n <= b.top; n++) {
    if (b.withdrawn.includes(n) || served.has(n)) continue;
    const pend = (b.pending ?? []).find(([m]) => m === n);
    if (pend && now !== null && now < pend[1]) { out.push(`pending: #${n} due ${Object.keys(DAY)[pend[1] - 1]}`); continue; }
    out.push(`WITHHELD: #${n} missing, never withdrawn`);
  }
  for (const n of served.keys()) if (n > b.top) out.push(`SMUGGLED: #${n} above declared top ${b.top}`);
  return out.length ? out : ['fine'];
}

// Monday: seven posts, index seq 10. She pre-stamps #8 (release Friday) and hands it to the host.
const base = new Map([1, 2, 3, 4, 5, 6, 7].map((n) => [n, post(n)]));
const eight = post(8, { release: DAY.FRI });
const nine = post(9);

// Three things her app could do with the index on Tuesday, when she posts #9.
const strategies = {
  '(a) index says top=9 on Tuesday': {
    index: { [DAY.TUE]: index(11, 9), [DAY.WED]: index(11, 9), [DAY.FRI]: index(11, 9) },
  },
  '(b) hold top at 7 until Friday': {
    index: { [DAY.TUE]: index(11, 7), [DAY.WED]: index(11, 7), [DAY.FRI]: index(12, 9) },
  },
  '(c) pre-stamp a Friday index too': {
    // Monday she pre-stamped seq 11 / top 8 for Friday release; Tuesday's live index is seq 12 / top 9.
    index: { [DAY.TUE]: index(12, 9), [DAY.WED]: index(12, 9), [DAY.FRI]: index(11, 8) },
  },
};

const hostServes = (day) => { const s = new Map(base); s.set(9, nine); if (day >= DAY.FRI) s.set(8, eight); return s; };

console.log('\nRuling 10 against rulings 3+4 — an honest host, an honest Alice, and what the reader says\n');
for (const [name, st] of Object.entries(strategies)) {
  console.log(`  ${name}`);
  let pinned = 10;
  for (const day of [DAY.TUE, DAY.WED, DAY.FRI]) {
    const idx = st.index[day];
    const v = verdict(idx, hostServes(day), pinned);
    pinned = Math.max(pinned, idx.body.seq);
    console.log(`     ${Object.keys(DAY)[day - 1]}  ${v.join('; ')}`);
  }
  console.log();
}

console.log(`  Nobody here is hostile. (a) accuses the host of withholding #8 for three days. (b) calls
  her own Tuesday post smuggled. (c) reads Friday's release as the host rolling the index back.
  Gapless numbering, an index only Alice can stamp, and a post the host releases later cannot all
  hold at once: the index has to say something about #8 before Friday, and only Alice can say it.

--- The fix that keeps the feature: the index carries a "pending" list ---
`);
const withPending = index(11, 9, { pending: [[8, DAY.FRI]] });
for (const [label, readerClock, hostDay] of [
  ['reader on Wednesday, host honest',            DAY.WED, DAY.WED],
  ['reader on Friday, host honest',               DAY.FRI, DAY.FRI],
  ['reader on Wednesday, host releases #8 EARLY', DAY.WED, DAY.FRI],
  ['reader whose clock is a day fast, Thursday',  DAY.FRI, DAY.THU],
]) {
  const served = hostServes(hostDay);
  const v = verdict(withPending, served, 10, { now: readerClock });
  const early = served.has(8) && readerClock < eight.body.release ? '  (and #8 carries release=FRI, so early release is visible)' : '';
  console.log(`  ${label.padEnd(46)} ${v.join('; ')}${early}`);
}
console.log(`
  It works, and look at what it cost: a new index field, a new reader state ("pending"), and a
  withholding verdict that now depends on the reader's wall clock — the last row is an honest host
  convicted by a reader whose clock runs fast. That is the one thing glm's time-discipline rule
  says never to do. The alternative is qwen's: the device posts at the scheduled time, or late.
`);
