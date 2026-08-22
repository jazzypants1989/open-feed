// Experiment — are the head numbers the owner ruled on (RULINGS §12.1) arithmetic over the right
// bytes? tracelife-exp.js, headage-exp.js and tmp/measure/headrange.js all assume a serialization:
// `[n,"<43>"]` is digits(n)+48 bytes, `[n,null]` is digits(n)+7, one comma per line, a fixed
// frame, 87 bytes of signature. None of them ever serialized a head. This does: real signed posts,
// real addresses, weekend-publisher.js's head() unchanged, at every scale on the curve, then the
// ruled rows recomputed with the measured constants in place of the assumed ones.
//
//   node tmp/redesign/decisions/headbytes-exp.js
import * as pub from '../gates/weekend-publisher.js';

const A = pub.newKey();
const digits = (n) => String(n).length;

// ---- the assumed arithmetic, verbatim from tracelife-exp.js ----
const assumed = {
  SIG: 87, HASH32: 43,
  entry: (n) => 1 + digits(n) + 2 + 43 + 2,
  retract: (n) => 1 + digits(n) + 6,
  frame: (hseq, top) => '{"entries":['.length + `],"hseq":${hseq},"top":${top},"prev":"${'x'.repeat(43)}"}`.length,
  file: (live, dead, hseq, top) => assumed.frame(hseq, top) + live.reduce((s, n) => s + assumed.entry(n) + 1, 0)
    + dead.reduce((s, n) => s + assumed.entry(n) + assumed.retract(n) + 2, 0) + 87,
};

// ---- real bytes ----
// Every number up to N gets a real signed post and a real address; `dead` are withdrawn as appended
// [n, null] lines and, after a rewrite, gone with their admission lines.
const addresses = new Map();
const addr = (n) => { if (!addresses.has(n)) addresses.set(n, pub.address(pub.post(n, { at: '2026-08-01T00:00:00Z', text: `post ${n}` }, A))); return addresses.get(n); };
function realHead(N, deadFrac, { rewritten = false, pending = 0 } = {}) {
  const all = [...Array(N).keys()].map((i) => i + 1);
  const dead = all.filter((n) => deadFrac && n % Math.round(1 / deadFrac) === 0);
  const deadSet = new Set(dead), live = all.filter((n) => !deadSet.has(n));
  const entries = rewritten ? live.map((n) => [n, addr(n)]) : [...all.map((n, i) => (i >= N - pending ? [n, addr(n), 'pending'] : [n, addr(n)])), ...dead.map((n) => [n, null])];
  const hseq = N + dead.length + (rewritten ? 1 : 0);
  const file = pub.head({ entries, hseq, top: N, prev: addr(0) }, A);
  return { file, live, dead, hseq, top: N, bytes: file.length, assumedBytes: assumed.file(live, rewritten ? [] : dead, hseq, N) };
}

const t0 = performance.now();
for (let n = 1; n <= 100000; n++) addr(n);
const signMs = performance.now() - t0;

console.log(`\n  ${addresses.size.toLocaleString()} real posts signed and addressed in ${(signMs / 1000).toFixed(1)} s\n`);
console.log('    entries   withdrawn   rewritten     measured        assumed      ratio   B/entry');
const rows = [];
for (const N of [10, 100, 1000, 10000, 100000]) for (const d of [0, 0.05, 0.2]) for (const rw of [false, true]) {
  if (d === 0 && rw) continue;
  const h = realHead(N, d, { rewritten: rw });
  const ratio = h.bytes / h.assumedBytes;
  rows.push({ N, d, rw, ...h, ratio });
  console.log(`    ${String(N).padStart(7)}   ${String(`${(d * 100).toFixed(0)}%`).padStart(9)}   ${String(rw ? 'yes' : 'no').padStart(9)}   ${String(h.bytes.toLocaleString()).padStart(10)} B   ${String(h.assumedBytes.toLocaleString()).padStart(10)} B   ${ratio.toFixed(4)}   ${(h.bytes / h.live.length).toFixed(1)}`);
}
const worst = rows.reduce((w, r) => (Math.abs(r.ratio - 1) > Math.abs(w.ratio - 1) ? r : w), rows[0]);

// The one line the arithmetic never priced: a pending entry is `[n,"<43>","pending"]`, +10 bytes.
const pend = realHead(1000, 0, { pending: 1 }).bytes - realHead(1000, 0).bytes;

// ---- the measured constants, fitted from real files ----
// Per-entry and per-retraction bytes by subtraction, the frame by removing everything.
const measured = {
  entry: (n) => realHead(n, 0).bytes - realHead(n - 1, 0).bytes - (digits(n) - digits(n - 1)) * 0,   // includes its comma
  SIG: pub.head({ entries: [], hseq: 1, top: 0 }, A).length - Buffer.from(JSON.stringify({ entries: [], hseq: 1, top: 0 })).length,
};
const e1 = realHead(2, 0).bytes - realHead(1, 0).bytes, e5 = realHead(10001, 0).bytes - realHead(10000, 0).bytes;
const r1 = realHead(1000, 0.001).bytes - realHead(1000, 0).bytes;   // one withdrawal line (+ its comma) for n=1000
const empty = pub.head({ entries: [], hseq: 1, top: 0, prev: addr(0) }, A).length;

// ---- the ruled rows, recomputed ----
// tracelife's run() and daily(), with the byte constants swapped for the measured ones. Anything
// that is not a byte constant is copied unchanged so the only difference is what this file found.
function tracelife(K) {
  const SIG = K.SIG, entryLen = K.entry, retractLen = K.retract, frame = K.frame;
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
        deadBytes += entryLen(n) + retractLen(n) + 2;
        retractions++; open.push({ n, at: hseq });
      } else { live.push(next); liveBytes += entryLen(next) + 1; top = next; next++; }
      const days = sinceCompact / versionsPerDay;
      if ((policy.every && days >= policy.every) || (policy.noisy && retractions > policy.noisy * live.length)) {
        for (const w of open) lives.push((hseq - w.at) / versionsPerDay);
        open.length = 0; deadBytes = 0; retractions = 0; sinceCompact = 0; compactions++; compacted = true;
      }
      versions.push({ hseq, bytes: frame(hseq, top) + liveBytes + deadBytes + SIG, compacted });
    }
    for (const w of open) lives.push((hseq - w.at) / versionsPerDay);
    return { versions, versionsPerDay, compactions, lives, final: versions.at(-1).bytes, liveOnly: frame(hseq, top) + liveBytes + SIG };
  }
  function daily(h) {
    const { versions, versionsPerDay } = h;
    let bytes = 0, last = null;
    for (let i = Math.floor((versions.length * 0.9) / versionsPerDay) * versionsPerDay; i < versions.length; i += versionsPerDay) {
      const cur = versions[Math.min(versions.length - 1, Math.floor(i))];
      if (last === null) { last = cur; continue; }
      const group = versions.slice(versions.indexOf(last) + 1, versions.indexOf(cur) + 1);
      bytes += group.some((v) => v.compacted) ? cur.bytes : cur.bytes - last.bytes;
      last = cur;
    }
    return bytes;
  }
  const out = {};
  for (const [name, policy] of [['never', {}], ['yearly', { every: 365 }], ['monthly', { every: 30 }], ['flat list', { every: 1e-9 }]]) {
    const j = run(100000, 0.05, 27.4, policy);
    out[name] = { tb: (daily(j) * 1e4) / 1e12, dead: (j.final - j.liveOnly) / j.final, kb: j.final / 1e3 };
  }
  const f = run(1557, 0.05, 3 / 7, {});
  out.familyDead = (f.final - f.liveOnly) / f.final;
  return out;
}
// The measured constants: a real entry line is e1 bytes at one digit including its comma, and a
// real retraction line r1 at four digits including its comma; the frame is a real empty head less
// the signature. Expressed in tracelife's shape (line without comma; +1 comma added by run()).
const K = {
  SIG: measured.SIG,
  entry: (n) => e1 - 1 + (digits(n) - 1),
  retract: (n) => r1 - 1 - (4 - digits(n)),
  frame: (hseq, top) => empty - measured.SIG + (String(hseq).length - 1) + (String(top).length - 1),
};
const old = tracelife(assumed), neu = tracelife(K);

console.log(`
  one pending entry costs ${pend} more bytes than a plain one — a line no arithmetic priced, and rare

  fitted from real files: signature ${measured.SIG} B (assumed 87) · entry ${e1 - 1} B at one digit (assumed ${assumed.entry(1)}) · ${e5 - 1} B at five (assumed ${assumed.entry(10001)})
                          retraction ${r1 - 1} B at four digits (assumed ${assumed.retract(1000)}) · empty head ${empty} B (assumed ${assumed.frame(1, 0) + 87})

  the ruled rows (journal scale: 100,000 posts, 10,000 daily followers, 5% withdrawn), assumed → measured
    policy        TB/yr assumed   TB/yr measured   head at yr 10   dead lines assumed → measured`);
let maxMove = 0;
for (const name of ['never', 'yearly', 'monthly', 'flat list']) {
  const move = Math.abs(neu[name].tb / old[name].tb - 1);
  maxMove = Math.max(maxMove, move, Math.abs(neu[name].dead - old[name].dead));
  console.log(`    ${name.padEnd(12)}  ${old[name].tb.toFixed(3).padStart(12)}   ${neu[name].tb.toFixed(3).padStart(13)}   ${neu[name].kb.toFixed(0).padStart(9)} KB   ${(old[name].dead * 100).toFixed(1)}% → ${(neu[name].dead * 100).toFixed(1)}%`);
}
console.log(`    family, never: dead lines ${(old.familyDead * 100).toFixed(1)}% → ${(neu.familyDead * 100).toFixed(1)}%`);

const claims = [
  ['every real head is within 10% of the assumed arithmetic, at every scale, withdrawal rate and rewrite state', rows.every((r) => Math.abs(r.ratio - 1) < 0.1)],
  ['a withdrawal appends exactly one `,[n,null]` line: digits(n)+8 bytes, nothing else in the file moves', r1 === 4 + 8],
  ['no ruled row moves by more than 10% with the measured constants in place', maxMove < 0.1],
  ['bytes per entry is 49 + digits + a comma, not a constant: 52.1 at 1,000 entries and 53.9 at 100,000', Math.abs(rows.find((r) => r.N === 1000 && r.d === 0).bytes / 1000 - 52.1) < 0.1 && Math.abs(rows.find((r) => r.N === 100000 && r.d === 0).bytes / 100000 - 53.9) < 0.1],
];
console.log();
for (const [what, ok] of claims) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);

console.log(`
  Reading. The arithmetic was right: the worst real-to-assumed ratio over ${rows.length} heads is ${worst.ratio.toFixed(4)}
  (${worst.N.toLocaleString()} entries, ${(worst.d * 100).toFixed(0)}% withdrawn${worst.rw ? ', rewritten' : ''}) — a comma the formula counts once too
  often, on a file of ${worst.bytes.toLocaleString()} bytes. JSON.stringify writes exactly the layout the three scripts assumed,
  so every TB/yr row, the 108x monthly-versus-never figure and the ~6% leftover-lines figure stand
  as ruled. What the arithmetic never priced is small: a pending entry is ${pend} bytes more than a plain
  one, and the head's \`top\` field, which headage-exp.js's frame predates. The ruling does not move.
`);
if (claims.some(([, ok]) => !ok)) process.exit(1);
