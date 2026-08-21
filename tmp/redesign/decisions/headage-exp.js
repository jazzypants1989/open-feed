// Experiment A — does the list head's range-fetch story survive a realistic edit model?
// tmp/measure/headrange.js edits a uniformly random entry from anywhere in ten years, and its
// reader pays a full fetch whenever ANY version since its last poll touched the middle — even when
// the touched entry was appended after the reader's last visit, which the tail fetch covers.
// Here the touched entry's age is drawn from an exponential with a chosen half-life, and the
// reader pays full price only when a touched post is one it had already cached (n <= its last top).
// An edit is "post new + withdraw old" (the owner's ruling), so every touch is a withdrawal.
//
//   node tmp/redesign/decisions/headage-exp.js

const SIG = 87, HASH32 = 43, HASH16 = 22;
const digits = (n) => String(n).length;
const entryLen = (n, hash) => 1 + digits(n) + 2 + hash + 2;               // [n,"hash"]
const retractLen = (n) => 1 + digits(n) + 6;                                // [n,null]
const frame = (hseq) => '{"entries":['.length + `],"hseq":${hseq},"prev":"${'x'.repeat(HASH32)}"}`.length;
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// One history. Each version appends (prob 1-e) or withdraws a live post (prob e) whose age in days
// is exponential with the given half-life (null = uniform over the whole list, the review's model).
// For the append-only shape a withdrawal appends [n,null]; the author compacts when retractions
// exceed 10% of live entries. Per version we record what each shape's file looks like.
function history(N, e, halfLifeDays, postsPerDay, seed) {
  const rand = rng(seed);
  const versionsPerDay = postsPerDay / (1 - e);
  const live = [];                 // post numbers, ascending
  let next = 1, hseq = 0, sum32 = 0, sum16 = 0;
  let aoLen = 0, aoRetractions = 0, aoCompactions = 0, aoM = 0, sinceCompact = 0;
  const versions = [];
  while (next <= N) {
    hseq++;
    let touched = null, compacted = false, compactedM = false;
    sinceCompact++;
    if (live.length > 1 && rand() < e) {
      let i;
      if (halfLifeDays == null) i = Math.floor(rand() * live.length);
      else { const ageV = (-Math.log(1 - rand()) * halfLifeDays / Math.LN2) * versionsPerDay; i = Math.max(0, live.length - 1 - Math.round(ageV)); }
      touched = live[i]; live.splice(i, 1);
      sum32 -= entryLen(touched, HASH32); sum16 -= entryLen(touched, HASH16);
      aoLen += retractLen(touched) + 1; aoRetractions++; aoM += retractLen(touched) + 1;
      if (aoRetractions > 0.1 * live.length) { aoLen = sum32 + Math.max(0, live.length - 1); aoRetractions = 0; aoCompactions++; compacted = true; }
    } else {
      live.push(next); sum32 += entryLen(next, HASH32); sum16 += entryLen(next, HASH16); aoLen += entryLen(next, HASH32) + 1; aoM += entryLen(next, HASH32) + 1; next++;
    }
    if (sinceCompact >= 30 * versionsPerDay) { aoM = sum32 + Math.max(0, live.length - 1); sinceCompact = 0; compactedM = true; }
    const commas = Math.max(0, live.length - 1);
    versions.push({
      hseq, top: live.at(-1), n: live.length, touched, compacted,
      flat32: frame(hseq) + sum32 + commas + SIG, stable32: '{"entries":['.length + sum32 + commas,
      flat16: frame(hseq) + sum16 + commas + SIG, stable16: '{"entries":['.length + sum16 + commas,
      ao: frame(hseq) + aoLen + SIG, compactedM, aoM: frame(hseq) + aoM + SIG,
    });
  }
  return { versions, versionsPerDay, compactions: aoCompactions };
}

// A daily reader over year 10. Flat shapes: tail first, full on top if a cached post was touched
// (reader-relative) — or if anything was touched at all (the review's global rule, for the revert
// check). Append-only: tail always, full after a compaction. Paged: head + touched pages.
function read(h, { shape, global = false }) {
  const { versions, versionsPerDay } = h;
  const start = Math.floor(versions.length * 0.9);
  let bytes = 0, tails = 0, fulls = 0, last = null, lastTop = 0;
  for (let i = Math.floor(start / versionsPerDay) * versionsPerDay; i < versions.length; i += versionsPerDay) {
    const idx = Math.min(versions.length - 1, Math.floor(i));
    const cur = versions[idx];
    if (last === null) { last = cur; lastTop = cur.top; continue; }
    const group = versions.slice(versions.indexOf(last) + 1, idx + 1);
    const touchedCached = group.some((v) => v.touched !== null && (global || v.touched <= lastTop));
    if (shape === 'full') { bytes += cur.flat32; fulls++; }
    else if (shape === 'flat32' || shape === 'flat16') {
      const tail = cur[shape] - last[shape === 'flat32' ? 'stable32' : 'stable16'];
      if (touchedCached) { bytes += tail + cur[shape]; fulls++; } else { bytes += tail; tails++; }
    } else if (shape === 'ao') {
      if (group.some((v) => v.compacted)) { bytes += cur.ao; fulls++; } else { bytes += cur.ao - last.ao; tails++; }
    } else if (shape === 'aoM') {
      if (group.some((v) => v.compactedM)) { bytes += cur.aoM; fulls++; } else { bytes += cur.aoM - last.aoM; tails++; }
    } else if (shape === 'paged') {
      const PAGE = 1000, pages = Math.ceil(cur.n / PAGE);
      const touchedPages = new Set(group.filter((v) => v.touched !== null && (global || v.touched <= lastTop)).map((v) => Math.floor(v.touched / PAGE)));
      bytes += 20 + pages * 52 + SIG + (1 + touchedPages.size) * PAGE * 52;
    }
    last = cur; lastTop = cur.top;
  }
  return { bytes, ok: tails + fulls ? Math.round((100 * tails) / (tails + fulls)) : 100 };
}

const MB = (b) => (b / 1e6).toFixed(b < 1e5 ? 3 : 1).padStart(7);
const scales = [['family  1,557 posts (3/week)', 1557, 3 / 7], ['active 100,000 posts (27/day)', 100000, 27.4]];
const halfLives = [['1 hour', 1 / 24], ['1 day', 1], ['1 week', 7], ['uniform (review)', null]];
const rates = [0.005, 0.05];
const journal = {};

console.log('\nMB per daily reader in year 10, by edit rate e and the age of the post an edit touches\n');
for (const [name, N, ppd] of scales) {
  console.log(`  ${name}`);
  console.log('    e      edit age          always-full   flat list   tail-ok%   16-byte hashes   append-only@10% (compactions)   append-only monthly   paged');
  for (const e of rates) for (const [hl, days] of halfLives) {
    const h = history(N, e, days, ppd, 7);
    const full = read(h, { shape: 'full' }), f32 = read(h, { shape: 'flat32' }), f16 = read(h, { shape: 'flat16' }), ao = read(h, { shape: 'ao' }), aoM = read(h, { shape: 'aoM' }), pg = read(h, { shape: 'paged' });
    console.log(`    ${(e * 100).toFixed(1)}%   ${hl.padEnd(17)} ${MB(full.bytes)}      ${MB(f32.bytes)}   ${String(f32.ok).padStart(5)}%     ${MB(f16.bytes)}          ${MB(ao.bytes)} (${String(h.compactions).padStart(3)})                 ${MB(aoM.bytes)}            ${MB(pg.bytes)}`);
    if (N === 100000) journal[`${e}|${hl}`] = { full: full.bytes, f32: f32.bytes, f16: f16.bytes, ao: ao.bytes, aoM: aoM.bytes, pg: pg.bytes, ok: f32.ok };
  }
  console.log();
}

const J = (k) => journal[k], TB = (b) => (b * 1e4 / 1e12).toFixed(2).padStart(6);
console.log('  Public journal — 100,000 posts, 10,000 daily followers, e = 5%: egress per year by edit age');
console.log('    edit age          always-full   flat list   16-byte   append-only@10%   append-only monthly   paged');
for (const [hl] of halfLives) { const j = J(`0.05|${hl}`); console.log(`    ${hl.padEnd(17)} ${TB(j.full)} TB   ${TB(j.f32)} TB   ${TB(j.f16)} TB   ${TB(j.ao)} TB        ${TB(j.aoM)} TB          ${TB(j.pg)} TB`); }

// Revert-check: put both of the review's assumptions back — uniform ages AND the global
// "anything touched" rule — and the review's number should reappear.
const reviewModel = read(history(100000, 0.05, null, 27.4, 7), { shape: 'flat32', global: true });
const reviewFull = read(history(100000, 0.05, null, 27.4, 7), { shape: 'full' });
const hour = J('0.05|1 hour'), day = J('0.05|1 day'), week = J('0.05|1 week');
console.log(`
  Reading. The review's 79% needs both of its assumptions — edits landing anywhere in ten years and
  a reader that re-downloads everything whenever anything at all was touched — and with both put
  back it reproduces here (${Math.round(100 * reviewModel.bytes / reviewFull.bytes)}%, revert-check). But fixing them does NOT rescue the flat list:
  at the journal scale, e = 5%, daily polling, it costs ${Math.round(100 * hour.f32 / hour.full)}% of always-full only when edits land within
  the hour; at a one-day half-life it is ${Math.round(100 * day.f32 / day.full)}% (${day.ok}% of polls tail-only), at a week ${Math.round(100 * week.f32 / week.full)}%. The
  prediction that edit age would flip the verdict was wrong — with 27 versions a day, one
  withdrawal of yesterday's post per day is enough to spoil most tails. What flips it is the head's
  SHAPE: an append-only head where a withdrawal is an appended [n, null] line costs ${TB(day.ao).trim()} TB a year
  at the journal scale whatever the edit age, against ${TB(day.full).trim()} TB — with the trace of a withdrawn post
  lingering until the author compacts (once in ten years at a 10% threshold; ${TB(day.aoM).trim()} TB a year
  compacting monthly, so the trace lives at most a month). 16-byte hashes halve every column.
  At family scale every shape is noise. The paged head is never needed.
`);
