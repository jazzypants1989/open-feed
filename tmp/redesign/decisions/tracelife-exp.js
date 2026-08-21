// Experiment — if the append-only head wins (RULINGS §11.2), which compaction policy?
// The owner accepted "a temporary trace" in advance. This prices how temporary, in the currency
// that matters: how many DAYS a withdrawn post's lines stay in the file a late reader downloads,
// against what compaction costs every reader in bytes. The size argument turns out not to be the
// argument at all — retraction lines are ~1% of the head — so compaction is a privacy policy and
// nothing else, and its whole cost is a full re-read for every reader every time.
//
//   node tmp/redesign/decisions/tracelife-exp.js

const SIG = 87, HASH32 = 43;
const digits = (n) => String(n).length;
const entryLen = (n) => 1 + digits(n) + 2 + HASH32 + 2;                      // [n,"hash"]
const retractLen = (n) => 1 + digits(n) + 6;                                 // [n,null]
const frame = (hseq, top) => '{"entries":['.length + `],"hseq":${hseq},"top":${top},"prev":"${'x'.repeat(HASH32)}"}`.length;
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// One ten-year history, replayed once per policy. A version appends (prob 1-e) or withdraws a live
// post (prob e) whose age is exponential with a one-day half-life — headage-exp.js's middle case,
// which is the one that killed the flat list. A withdrawal appends [n, null]; the two lines for
// that post stay in the file until the next compaction, which is when its trace ends.
function run(N, e, postsPerDay, policy, seed = 7) {
  const rand = rng(seed), versionsPerDay = postsPerDay / (1 - e), halfLife = 1;
  const live = [];
  let next = 1, hseq = 0, top = 0, liveBytes = 0, deadBytes = 0, retractions = 0;
  const open = [], lives = [], versions = [];
  let compactions = 0, sinceCompact = 0;
  while (next <= N) {
    hseq++; sinceCompact++;
    let compacted = false;
    if (live.length > 1 && rand() < e) {
      const ageV = (-Math.log(1 - rand()) * halfLife / Math.LN2) * versionsPerDay;
      const i = Math.max(0, live.length - 1 - Math.round(ageV));
      const n = live[i]; live.splice(i, 1);
      liveBytes -= entryLen(n) + 1;
      deadBytes += entryLen(n) + retractLen(n) + 2;                          // the admission line stays too
      retractions++; open.push({ n, at: hseq });
    } else { live.push(next); liveBytes += entryLen(next) + 1; top = next; next++; }
    const days = sinceCompact / versionsPerDay;
    if ((policy.every && days >= policy.every) || (policy.noisy && retractions > policy.noisy * live.length)) {
      for (const w of open) lives.push((hseq - w.at) / versionsPerDay);
      open.length = 0; deadBytes = 0; retractions = 0; sinceCompact = 0; compactions++; compacted = true;
    }
    versions.push({ hseq, bytes: frame(hseq, top) + liveBytes + deadBytes + SIG, compacted });
  }
  const endHseq = hseq;
  for (const w of open) lives.push((endHseq - w.at) / versionsPerDay);        // still visible at year 10
  return { versions, versionsPerDay, compactions, lives, final: versions.at(-1).bytes, liveOnly: frame(endHseq, top) + liveBytes + SIG };
}

// A reader polling daily through year 10: the tail every day, the whole file after a compaction.
function daily(h) {
  const { versions, versionsPerDay } = h;
  let bytes = 0, fulls = 0, polls = 0, last = null;
  for (let i = Math.floor((versions.length * 0.9) / versionsPerDay) * versionsPerDay; i < versions.length; i += versionsPerDay) {
    const cur = versions[Math.min(versions.length - 1, Math.floor(i))];
    if (last === null) { last = cur; continue; }
    const group = versions.slice(versions.indexOf(last) + 1, versions.indexOf(cur) + 1);
    polls++;
    if (group.some((v) => v.compacted)) { bytes += cur.bytes; fulls++; } else bytes += cur.bytes - last.bytes;
    last = cur;
  }
  return { bytes, fulls, polls };
}

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const days = (d) => (d >= 365 ? `${(d / 365).toFixed(1)} yr` : d >= 1 ? `${d.toFixed(0)} d` : `${(d * 24).toFixed(0)} h`).padStart(7);
const MB = (b) => (b / 1e6).toFixed(b < 1e5 ? 3 : 1).padStart(8);
const KB = (b) => `${(b / 1e3).toFixed(0)} KB`.padStart(9);

const policies = [
  ['never', {}], ['weekly', { every: 7 }], ['monthly', { every: 30 }],
  ['yearly', { every: 365 }], ['when retractions > 10% of live', { noisy: 0.1 }],
];
const scales = [['family     1,557 posts (3/week)', 1557, 3 / 7], ['journal  100,000 posts (27/day)', 100000, 27.4]];

for (const [label, N, ppd] of scales) {
  console.log(`\n  ${label}, withdrawal rate 5%\n`);
  console.log('    compaction policy                 compactions   trace: median    p90      max   head at yr 10   dead lines   MB/reader-yr   full re-reads   10k followers');
  for (const [name, policy] of policies) {
    const h = run(N, 0.05, ppd, policy), d = daily(h);
    const tb = ((d.bytes * 1e4) / 1e12).toFixed(3);
    console.log(`    ${name.padEnd(32)} ${String(h.compactions).padStart(6)}      ${days(pct(h.lives, 0.5))} ${days(pct(h.lives, 0.9))} ${days(Math.max(0, ...h.lives))}     ${KB(h.final)}        ${String(((h.final - h.liveOnly) / h.final * 100).toFixed(1) + '%').padStart(5)}     ${MB(d.bytes)}      ${String(`${d.fulls}/${d.polls}`).padStart(8)}       ${tb} TB/yr`);
  }
}

// What the trace is, and who it is hidden from. The host kept every version it ever served, so
// compaction hides a withdrawal from LATE readers and the public, never from the custodian.
const j = run(100000, 0.05, 27.4, {}), jm = run(100000, 0.05, 27.4, { every: 30 });
const f = run(1557, 0.05, 3 / 7, {}), fm = run(1557, 0.05, 3 / 7, { every: 30 });
console.log(`
  Reading. Two things this settles and one it does not.

  1. Compaction is not a size decision. Never compacting at journal scale leaves the head at
     ${(j.final / 1e3).toFixed(0)} KB against ${(j.liveOnly / 1e3).toFixed(0)} KB of live entries — the retraction lines and the admission lines
     they retire are ${((j.final - j.liveOnly) / j.final * 100).toFixed(1)}% of the file, and at family scale ${((f.final - f.liveOnly) / f.final * 100).toFixed(1)}%. Nobody needs to compact to keep the
     head small. The whole reason to compact is to stop publishing a permanent record of what was
     deleted, which GOALS.md's "the publisher forgets; readers remember" says the design does not do.

  2. The price is exact and it is paid by readers, not by the author. Every compaction costs every
     reader one full head instead of one tail: at journal scale, ${((daily(j).bytes * 1e4) / 1e12).toFixed(3)} TB/yr never compacting against
     ${((daily(jm).bytes * 1e4) / 1e12).toFixed(3)} TB/yr monthly across 10,000 followers — ${Math.round(daily(jm).bytes / daily(j).bytes)}x — to cap the trace at ${days(Math.max(0, ...jm.lives)).trim()}.
     At family scale it is ${(daily(fm).bytes / 1e6).toFixed(2)} MB per reader-year against ${(daily(f).bytes / 1e6).toFixed(3)} MB, which is noise; a family hub
     can compact as often as it likes, and the journal is where the choice bites.

  3. What it does NOT buy: anything against the custodian of §13.2. The ex's hub served and kept
     every version of the head, so he holds the retraction line whatever the author does afterwards,
     and the post itself is self-signed in whatever copies exist. Compaction hides a withdrawal from
     readers who arrive after it and from anyone who did not archive — which is the public, and is
     the case "no permanent deletion record" was written about. It is worth what it is worth.
`);
