// Experiment B — scheduled posts, option 5: the head lists the post as pending, a reader never
// convicts a pending entry on its own clock, and the entry becomes ordinary when the device next
// publishes a head that lists it plainly. Only then can withholding be called. Staged beside the
// gate's option 3 (pending judged by the reader's clock) with the gate's own verdict function.
//
//   node tmp/redesign/decisions/scheduled5-exp.js
import { makeKey, sign, address, makeHead, open, entry } from '../gates/lastline.js';

const alice = makeKey('alice');
const DAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const post = (n, extra = {}) => sign({ n, body: `post ${n}`, ...extra }, alice);
const posts = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, post(n)]));
const eight = post(8, { release: DAY.FRI }), nine = post(9);
const files = { ...posts, 8: eight, 9: nine };
const head = (hseq, ns, pendingNs = [], { withRelease = false } = {}) =>
  makeHead({ hseq, entries: [...ns.map((n) => entry(n, files[n])), ...pendingNs.map((n) => [n, address(files[n]), withRelease ? DAY.FRI : 'pending'])] }, alice);

// The gate's verdict, plus one rule: a 'pending' entry that is not served is skipped whatever the
// clock says. clockJudges=true is the revert-check — it lets the clock convict a pending entry.
function verdict(headFile, served, now, { clockJudges = false } = {}) {
  const { obj } = open(headFile, alice.x);
  const out = [];
  for (const [n, h, flag] of obj.entries) {
    const f = served.get(n);
    if (f && address(f) === h) { if (flag === 'pending' && open(f, alice.x).obj.release > now) out.push(`#${n} served early (its own stamp says day ${open(f, alice.x).obj.release})`); continue; }
    if (f) { out.push(`SUBSTITUTED #${n}`); continue; }
    if (flag === 'pending' && !clockJudges) { out.push(`pending #${n}`); continue; }
    if (typeof flag === 'number' && now < flag) { out.push(`pending #${n}`); continue; }
    if (flag === 'pending' && clockJudges && now < open(files[n], alice.x).obj.release) { out.push(`pending #${n}`); continue; }
    out.push(`WITHHELD #${n}`);
  }
  return out.length ? out.join(', ') : 'fine';
}
const serves = (day, early = false) => { const m = new Map(Object.entries(posts).map(([n, f]) => [+n, f])); if (day >= DAY.TUE) m.set(9, nine); if (day >= DAY.FRI || early) m.set(8, eight); return m; };
const withholds = (day) => { const m = serves(day); m.delete(8); return m; };

const h11 = head(11, [1, 2, 3, 4, 5, 6, 7], [8]);                 // Monday: device lists #8 pending
const h12 = head(12, [1, 2, 3, 4, 5, 6, 7, 9], [8]);              // Tuesday: device posts #9, #8 still pending
const h13 = head(13, [1, 2, 3, 4, 5, 6, 7, 8, 9]);                // Saturday: device wakes, lists #8 plainly
const h12clock = head(12, [1, 2, 3, 4, 5, 6, 7, 9], [8], { withRelease: true });   // option 3 for comparison

const rows = [
  ['Mon: listed pending, host holds it',        verdict(h11, serves(DAY.MON), DAY.MON)],
  ['Tue: device posts #9 beside pending #8',    verdict(h12, serves(DAY.TUE), DAY.TUE)],
  ['Thu, reader clock a day fast — option 3',   verdict(h12clock, serves(DAY.THU), DAY.FRI)],
  ['Thu, reader clock a day fast — option 5',   verdict(h12, serves(DAY.THU), DAY.FRI)],
  ['Fri: host releases #8',                     verdict(h12, serves(DAY.FRI), DAY.FRI)],
  ['Wed: host releases #8 early',               verdict(h12, serves(DAY.WED, true), DAY.WED)],
  ['Sat: host still holds #8, device asleep',   verdict(h12, withholds(DAY.SAT), DAY.SAT)],
  ['Sat: device wakes, head 13 lists #8 plainly', verdict(h13, withholds(DAY.SAT), DAY.SAT)],
];
console.log('\n  scenario                                       what the reader says');
for (const [s, v] of rows) console.log(`  ${s.padEnd(46)} ${v}`);
const revert = verdict(h12, serves(DAY.THU), DAY.FRI, { clockJudges: true });
console.log(`\n  revert-check (let the clock judge a pending entry): fast-clock Thursday reads "${revert}" — an honest host convicted`);

const table = [
  ['3 pending with a release day, clock-judged', true, true, true, false],
  ['5 pending, never clock-judged',            true, true, true, true],
];
console.log('\n  option                                        admissible before   no collision   early release   verdict');
console.log('                                                the device wakes    with #9        visible         clock-free');
for (const [name, a, b, c, d] of table) console.log(`  ${name.padEnd(45)} ${String(a).padEnd(19)} ${String(b).padEnd(14)} ${String(c).padEnd(15)} ${d}`);
const ok = rows[3][1] === 'pending #8' && rows[1][1] === 'pending #8' && rows[4][1] === 'fine' && rows[6][1] === 'pending #8' && rows[7][1] === 'WITHHELD #8' && revert.startsWith('WITHHELD');
console.log(`
  Reading. Option 5 ${ok ? 'passes every column' : 'FAILS a column'}: #8 is Alice's from Monday because her device listed it; #9
  sits beside it with no collision; an early release is visible from the post's own stamp (a
  heads-up, not a verdict); and no clock ever convicts anyone — the fast-clock reader says
  "pending", where option 3 says "WITHHELD". The cost is in the last two rows: a host sitting on
  #8 after Friday is uncalled until Alice's device next publishes, and if it never does (she has
  left, or died), the withholding is never called. That is ruling 10's "released after the author
  has left" case, made undetectable rather than bounded.
`);
