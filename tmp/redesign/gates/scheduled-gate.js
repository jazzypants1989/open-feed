// scheduled-gate: ruling 10 (the host releases a pre-stamped post) under an author-only head
// with admission. Alice pre-stamps #8 on Monday for Friday and posts #9 from her phone on
// Tuesday; the host and Alice are both honest. Four ways to do it, and what each reader says.
// Kill criteria: an option that is admissible before the device wakes, collides with no
// interim post, shows early release without a clock, and gives a clock-free verdict.
import { makeKey, sign, verify, address, makeHead, open, entry } from './lastline.js';

const alice = makeKey('alice');
const DAY = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5 };
const post = (n, extra = {}) => sign({ n, body: `post ${n}`, ...extra }, alice);
const posts = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, post(n)]));
const eight = post(8, { release: DAY.FRI }), nine = post(9);
const head = (hseq, ns, extra = []) => makeHead({ hseq, entries: [...ns.map((n) => entry(n, posts[n] ?? { 8: eight, 9: nine }[n])), ...extra] }, alice);
const ent = (n, f, release) => [n, address(f), release];

// The reader: a pinned (hseq, hash); rollback below the pin, fork at the pin, then per entry:
// served at the listed hash, pending if the entry says so and the clock agrees, else withheld.
function verdict(headFile, served, pin, now = null) {
  const { obj, body } = open(headFile, alice.x);
  const hash = address(headFile);
  if (obj.hseq < pin.hseq) return `ROLLBACK (hseq ${obj.hseq} after ${pin.hseq})`;
  if (obj.hseq === pin.hseq && hash !== pin.hash) return 'FORK (two signed heads at one hseq)';
  const out = [];
  for (const [n, h, release] of obj.entries) {
    const f = served.get(n);
    if (f && address(f) === h) continue;
    if (f) { out.push(`SUBSTITUTED #${n}`); continue; }
    if (release != null && now != null && now < release) { out.push(`pending #${n}`); continue; }
    out.push(`WITHHELD #${n}`);
  }
  return out.length ? out.join(', ') : 'fine';
}
const pinOf = (h) => ({ hseq: open(h, alice.x).obj.hseq, hash: address(h) });
const serves = (day, extra = []) => { const m = new Map(Object.entries(posts).map(([n, f]) => [+n, f])); m.set(9, nine); if (day >= DAY.FRI) m.set(8, eight); for (const [n, f] of extra) m.set(n, f); return m; };

// Option 1 — the host releases the post file only; the head never mentions #8.
const h11 = head(11, [1, 2, 3, 4, 5, 6, 7, 9]);
const opt1Friday = verdict(h11, serves(DAY.FRI), pinOf(h11));
const opt1Admitted = open(h11, alice.x).obj.entries.some(([n]) => n === 8);

// Option 2 — the device pre-signs the Friday head. (a) it reuses hseq 11 on Tuesday: a fork.
// (b) it skips to 12 on Tuesday: Friday's swap is a rollback that also drops #9.
const preSigned11 = head(11, [1, 2, 3, 4, 5, 6, 7, 8]);
const tuesday11 = head(11, [1, 2, 3, 4, 5, 6, 7, 9]);
const opt2aFriday = verdict(preSigned11, serves(DAY.FRI), pinOf(tuesday11));
const tuesday12 = head(12, [1, 2, 3, 4, 5, 6, 7, 9]);
const opt2bFriday = verdict(preSigned11, serves(DAY.FRI), pinOf(tuesday12));
const bothValid = verify(preSigned11, alice.x) && verify(tuesday11, alice.x) && address(preSigned11) !== address(tuesday11);

// Option 3 — the head lists #8 with its release day (scheduled-exp.js's `pending`, ported).
const pending = head(11, [1, 2, 3, 4, 5, 6, 7, 9], [ent(8, eight, DAY.FRI)]);
const opt3Wed = verdict(pending, serves(DAY.WED), pinOf(pending), DAY.WED);
const opt3Fri = verdict(pending, serves(DAY.FRI), pinOf(pending), DAY.FRI);
const opt3FastClock = verdict(pending, serves(DAY.THU), pinOf(pending), DAY.FRI);
const opt3Early = verdict(pending, serves(DAY.WED, [[8, eight]]), pinOf(pending), DAY.WED);
const earlyVisible = open(eight, alice.x).obj.release > DAY.WED;

// Option 4 — no host release: the device posts #8 itself on Friday (or late), with the head.
const h12 = head(12, [1, 2, 3, 4, 5, 6, 7, 9, 8]);
const opt4Friday = verdict(h12, serves(DAY.FRI), pinOf(h12));

const table = [
  ['1 host releases the file only', false, true, false, true, `Friday: ${opt1Friday}; #8 admitted: ${opt1Admitted}`],
  ['2 device pre-signs the head', true, false, false, true, `(a) ${opt2aFriday}  (b) ${opt2bFriday}`],
  ['3 head lists #8 as pending', true, true, true, false, `Wed: ${opt3Wed}; Fri: ${opt3Fri}; fast clock Thu: ${opt3FastClock}`],
  ['4 no host release', false, true, true, true, `Friday: ${opt4Friday} (feature dropped)`],
];
console.log('  option                          admissible before   no collision   early release   verdict       what the reader says');
console.log('                                  the device wakes    with #9        visible         clock-free');
for (const [name, a, b, c, d, note] of table) console.log(`  ${name.padEnd(31)} ${String(a).padEnd(19)} ${String(b).padEnd(14)} ${String(c).padEnd(15)} ${String(d).padEnd(13)} ${note}`);
const passesAll = table.filter(([, a, b, c, d]) => a && b && c && d).length;
console.log();

const gate = [
  ['option 1: the released file is never admitted — the head does not list it, so release releases nothing', !opt1Admitted && opt1Friday === 'fine'],
  ['option 2a: the pre-signed head and Tuesday\'s head are two valid heads at hseq 11', bothValid],
  ['option 2a: a pinned reader sees Friday\'s swap as a FORK — an honest Alice reads as compromised', opt2aFriday.startsWith('FORK')],
  ['option 2b: if the device skips to 12, Friday\'s swap reads as a ROLLBACK', opt2bFriday.startsWith('ROLLBACK')],
  ['option 3: an honest host and an honest Alice read fine on Wednesday and Friday', opt3Wed === 'pending #8' && opt3Fri === 'fine'],
  ['option 3: a reader whose clock runs a day fast convicts the honest host of withholding', opt3FastClock === 'WITHHELD #8'],
  ['option 3: early release is visible, but only by comparing the post\'s release day to a clock', opt3Early === 'fine' && earlyVisible],
  ['option 4: the device posting on Friday is an ordinary post', opt4Friday === 'fine'],
  ['no option is admissible before the device wakes, collision-free, early-visible, and clock-free at once', passesAll === 0],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('scheduled-gate: all claims hold');
