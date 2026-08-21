// Prices the [n, hash] list head's "cheaply range-fetchable" claim (HANDOFF-fresh-start.md §3
// claim 2). A reader that caches the last head and fetches only the tail succeeds only when no
// version since its last poll touched the middle of the list; otherwise it pays the tail AND the
// full fetch. Sizes are arithmetic over the real serializer's layout, checked against
// JSON.stringify at checkpoints; gzip is measured on real-entropy hashes because placeholder
// hashes compress 14x better than the real thing and would flatter every number.
//
//   node tmp/measure/headrange.js
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const SIG = 86 + 1, HASH = 43;
const digits = (n) => String(n).length;
const entryLen = (n) => 1 + digits(n) + 2 + HASH + 2;            // [n,"hash"]
const prefixLen = (hseq, order) => (order === 'entries-first' ? '{"entries":['.length : `{"hseq":${hseq},"prev":"${'x'.repeat(HASH)}","entries":[`.length);
const suffixLen = (hseq, order) => (order === 'entries-first' ? `],"hseq":${hseq},"prev":"${'x'.repeat(HASH)}"}`.length : ']}'.length);

// Seeded PRNG so the table reproduces.
const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hashOf = (n) => crypto.createHash('sha256').update(`headrange:${n}`).digest('base64url');

// One history: versions until N posts exist. Each version appends, or (with prob e) withdraws or
// edits a uniformly chosen live entry. Records per version: file length, stable-prefix end, and
// whether the middle moved. Checkpoints compare the arithmetic against the real serializer.
function history(N, e, seed) {
  const rand = rng(seed);
  const live = [];
  const versions = [];
  let next = 1, hseq = 0, withdrawn = 0, withdrawnLen = 0, sum = 0;
  const checks = [];
  while (next <= N) {
    hseq++;
    let middle = false;
    if (live.length > 1 && rand() < e) {
      const i = Math.floor(rand() * live.length);
      if (rand() < 0.5) { const n = live[i]; live.splice(i, 1); sum -= entryLen(n); withdrawn++; withdrawnLen += digits(n) + 1; }
      middle = i < live.length;   // a change at the very end is still an append-shaped tail
    } else { live.push(next); sum += entryLen(next); next++; }
    const commas = Math.max(0, live.length - 1);
    const v = { hseq, n: live.length, middle, withdrawn };
    for (const order of ['prefix', 'entries-first']) {
      v[order] = { file: prefixLen(hseq, order) + sum + commas + suffixLen(hseq, order) + SIG, stable: prefixLen(hseq, order) + sum + commas };
    }
    v.counter = `{"seq":${hseq},"top":${next - 1},"withdrawn":[],"prev":"${'x'.repeat(HASH)}"}`.length + Math.max(0, withdrawnLen - 1) + SIG;
    versions.push(v);
    if ([1, 100, 1000, 10000].includes(hseq) || next > N) {
      const entries = live.map((n) => [n, hashOf(n)]);
      const prev = hashOf('prev');
      const real = Buffer.from(JSON.stringify({ hseq, prev, entries }));
      const realEF = Buffer.from(JSON.stringify({ entries, hseq, prev }));
      checks.push({ hseq, n: live.length, ok: real.length + SIG === v.prefix.file && realEF.length + SIG === v['entries-first'].file, raw: real.length, gz: zlib.gzipSync(real).length });
    }
  }
  return { versions, checks, live: live.length };
}

// A reader on a cadence: polls every `interval` years; versions arrive at `perYear`. Per poll it
// tries the tail first (one range entries-first, prefix re-read + range prefix-first) and falls
// back to a full fetch when the reconstruction would not verify — paying both.
function reader(versions, perYear, interval, order, yearFrom) {
  let bytes = 0, polls = 0, tails = 0, fulls = 0, reqs = 0;
  let lastIdx = -1;
  const polls_ = Math.ceil((versions.length / perYear) / interval);
  for (let p = 1; p <= polls_; p++) {
    const upto = Math.min(versions.length, Math.floor(p * interval * perYear)) - 1;
    const t = upto / perYear;
    const inYear = t >= yearFrom;
    if (upto <= lastIdx) { if (inYear) { polls++; reqs++; } continue; }
    const group = versions.slice(lastIdx + 1, upto + 1);
    const cur = versions[upto];
    const moved = lastIdx < 0 || group.some((v) => v.middle);
    if (inYear) {
      polls++;
      if (lastIdx < 0) { bytes += cur[order].file; reqs += 1; fulls++; }
      else {
        const tail = cur[order].file - versions[lastIdx][order].stable + (order === 'prefix' ? 80 : 0);
        reqs += order === 'prefix' ? 2 : 1;
        if (moved) { bytes += tail + cur[order].file; reqs += 1; fulls++; } else { bytes += tail; tails++; }
      }
    }
    lastIdx = upto;
  }
  return { bytes, polls, tails, fulls, reqs };
}
const fullReader = (versions, perYear, interval, yearFrom, key = 'prefix') => {
  let bytes = 0, last = -1;
  const polls = Math.ceil((versions.length / perYear) / interval);
  for (let p = 1; p <= polls; p++) {
    const upto = Math.min(versions.length, Math.floor(p * interval * perYear)) - 1;
    if (upto <= last) continue;
    if (upto / perYear >= yearFrom) bytes += key === 'counter' ? versions[upto].counter : versions[upto][key].file;
    last = upto;
  }
  return bytes;
};
// Paged head: 1,000-entry pages as their own files, the head listing [page, hash]. A poll fetches
// the head plus every page whose contents changed; an append touches only the last page.
const pagedReader = (versions, perYear, interval, yearFrom) => {
  let bytes = 0, last = -1;
  const PAGE = 1000, pageBytes = PAGE * 52;
  const polls = Math.ceil((versions.length / perYear) / interval);
  for (let p = 1; p <= polls; p++) {
    const upto = Math.min(versions.length, Math.floor(p * interval * perYear)) - 1;
    if (upto <= last) continue;
    if (upto / perYear >= yearFrom) {
      const cur = versions[upto];
      const pages = Math.ceil(cur.n / PAGE);
      const head = 20 + pages * 52 + SIG;
      const group = versions.slice(last + 1, upto + 1);
      const touched = Math.min(pages, 1 + group.filter((v) => v.middle).length);
      bytes += head + touched * pageBytes;
    }
    last = upto;
  }
  return bytes;
};

const MB = (b) => (b / 1e6).toFixed(b < 1e5 ? 3 : 1).padStart(8);
const YEARS = 10;
const scales = [
  { name: 'family   1,557 posts (3/week, 10 years)', N: 1557 },
  { name: 'active 100,000 posts (27/day, 10 years)', N: 100000 },
];
const cadences = [['hourly', 1 / 8760], ['daily', 1 / 365], ['weekly', 1 / 52]];
const rates = [0, 0.005, 0.05];
const verdicts = [];

console.log('\nThe list head under range-fetch — MB per reader in year 10, by edit rate e and poll cadence\n');
for (const { name, N } of scales) {
  console.log(`  ${name}`);
  for (const e of rates) {
    const h = history(N, e, 7);
    const perYear = h.versions.length / YEARS;
    const last = h.versions.at(-1);
    const bad = h.checks.filter((c) => !c.ok);
    console.log(`    e = ${(e * 100).toFixed(1)}%   versions ${h.versions.length.toLocaleString()}   live ${last.n.toLocaleString()}   head ${(last.prefix.file / 1e3).toFixed(1)} KB (${(last.prefix.file / last.n).toFixed(1)} B/entry)   counter ${last.counter} B   serializer check ${bad.length ? 'MISMATCH' : 'ok'}`);
    console.log('      cadence   always-full   list(prefix)   list(entries-first)   tail-ok%    paged   counter');
    for (const [cname, interval] of cadences) {
      const full = fullReader(h.versions, perYear, interval, YEARS - 1);
      const rp = reader(h.versions, perYear, interval, 'prefix', YEARS - 1);
      const re = reader(h.versions, perYear, interval, 'entries-first', YEARS - 1);
      const paged = pagedReader(h.versions, perYear, interval, YEARS - 1);
      const counter = fullReader(h.versions, perYear, interval, YEARS - 1, 'counter');
      const okPct = re.tails + re.fulls ? Math.round((100 * re.tails) / (re.tails + re.fulls)) : 100;
      console.log(`      ${cname.padEnd(8)} ${MB(full)}     ${MB(rp.bytes)}     ${MB(re.bytes)}            ${String(okPct).padStart(3)}%  ${MB(paged)}  ${MB(counter)}`);
      verdicts.push({ N, e, cname, full, range: re.bytes, paged, counter });
    }
  }
  const c = history(N, 0, 7).checks.at(-1);
  console.log(`    gzip of the full head at ${c.n.toLocaleString()} real-entropy entries: ${(c.raw / 1e3).toFixed(1)} KB raw -> ${(c.gz / 1e3).toFixed(1)} KB (${(100 * c.gz / c.raw).toFixed(0)}%); Range over Content-Encoding: gzip addresses compressed bytes, so the two do not compose\n`);
}

const journal = verdicts.filter((v) => v.N === 100000 && v.cname === 'daily');
console.log('  Public journal: 100,000 posts, 10,000 followers polling daily — egress per year');
console.log('    e        always-full      list(range)        paged      counter');
for (const v of journal) console.log(`    ${(v.e * 100).toFixed(1).padStart(3)}%   ${(v.full * 1e4 / 1e12).toFixed(2).padStart(8)} TB   ${(v.range * 1e4 / 1e12).toFixed(2).padStart(8)} TB   ${(v.paged * 1e4 / 1e12).toFixed(2).padStart(8)} TB   ${(v.counter * 1e4 / 1e12).toFixed(3).padStart(8)} TB`);

const worst = journal.find((v) => v.e === 0.05);
const ratio = worst.range / worst.full;
const flip = journal.find((v) => v.range / v.full > 0.5);
console.log(`
  Verdict: at journal scale, daily polling, e = 5%, the range reader spends ${(100 * ratio).toFixed(0)}% of always-full —
  ${ratio > 0.5 ? 'COLLAPSE' : 'HOLDS'}. ${flip ? `It first exceeds 50% at e = ${(flip.e * 100).toFixed(1)}%.` : 'It stays under 50% at every rate tried.'}
  The story rests on the edit/withdrawal rate, which no ruling states; field order is worth one
  request per poll, not bytes. The paged head is the shape that survives edits.
`);
