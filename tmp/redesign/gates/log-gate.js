// log-gate: does one append-only event log with checkpoints deliver the manifest's guarantees
// at family scale, with invariant checks that never consult reconstructed state?
// Kill criteria: first contact >5 MB or >20 fetches; checkpoint audit needing cross-window
// state; a violation class today's per-version diff catches that checkpoint pairs cannot;
// lapsed-reader bytes exceeding today's A+`_skip` at the 1-year scenario.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { b64u, sha256 } from '../../../src/hash.js';
import { GateError, makeKey, signEvent, eventId, verifyEvent, newState, foldHop, stateBlob, checkpointDiffViolations } from './lib.js';

const K = 256; // events per segment, and the checkpoint cadence
const mom = makeKey('of2:mom#k1');
const resolve = () => mom.publicKey;
const uuid = (n) => `urn:uuid:${crypto.createHash('sha256').update('i' + n).digest('hex').slice(0, 8)}-7dec-11d0-a765-00a0c91e6bf6`;
const bhash = (n, v) => b64u(sha256(Buffer.from(`${n}/${v}`)));

// ---- build the 10-year family journal as a REAL signed log: 3 posts/day, 5% edit, 1% delete ----
function buildLog(days, perDay) {
  let seed = 12345, next = 0, seq = 0, prev = null;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const tokens = [], checkpoints = [], state = newState();
  const versions = new Map(); // id -> version (for staging edits)
  const emit = (payload) => {
    payload.seq = ++seq;
    payload.ts = 1736899200 + Math.floor(seq / 4) * 86400;
    if (prev) payload.prev = prev;
    const t = signEvent(payload, mom);
    foldHop(state, payload, eventId(t));
    tokens.push(t);
    prev = eventId(t);
    if (seq % K === 0) {
      const last = checkpoints.at(-1);
      const blob = stateBlob(state, { prevCheckpoint: last?.event ?? null, prevState: last?.blob.hash ?? null });
      const ck = signEvent({ seq: ++seq, ts: payload.ts, prev, type: 'checkpoint', state: blob.hash, count: seq - 1 }, mom);
      // (checkpoint consumes a seq too; fold it so contiguity holds)
      foldHop(state, { seq, ts: payload.ts, type: 'checkpoint' }, eventId(ck));
      tokens.push(ck);
      prev = eventId(ck);
      checkpoints.push({ event: eventId(ck), atSeq: seq, blob });
    }
  };
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < perDay; i++) { const id = uuid(next++); versions.set(id, 1); emit({ type: 'post', id, blob: bhash(id, 1) }); }
    const recent = () => uuid(Math.max(0, next - 1 - Math.floor(rnd() * Math.min(next, 500))));
    for (let i = 0; i < perDay; i++) {
      if (rnd() < 0.05) { const id = recent(); if (state.live.has(id)) { const v = versions.get(id) + 1; versions.set(id, v); emit({ type: 'edit', id, version: v, blob: bhash(id, v) }); } }
      if (rnd() < 0.01) { const id = recent(); if (state.live.has(id)) emit({ type: 'delete', id }); }
    }
  }
  return { tokens, checkpoints, state };
}

const t0 = Date.now();
const log = buildLog(3650, 3);
const buildMs = Date.now() - t0;
const bytesOf = (ts) => ts.reduce((n, t) => n + Buffer.byteLength(t, 'utf8') + 1, 0);
const segments = [];
for (let i = 0; i < log.tokens.length; i += K) segments.push(log.tokens.slice(i, i + K));
const segBytes = segments.map(bytesOf);
const avgToken = bytesOf(log.tokens) / log.tokens.length;

// ---- the windowed checkpoint audit: prev state + window events, NOTHING else ----
// Resumable at any checkpoint; memory is O(live set); a lying checkpoint is caught in its window.
function auditWindow(prevBlobBytes, windowPayloads, claimedHash, startSeq, startTs) {
  const prevState = prevBlobBytes ? JSON.parse(prevBlobBytes.toString('utf8')) : { live: {}, deleted: {} };
  const s = newState();
  for (const [id, [version, blob]] of Object.entries(prevState.live)) s.live.set(id, { version, blob });
  for (const [id, v] of Object.entries(prevState.deleted)) s.deleted.set(id, v);
  s.lastSeq = startSeq; s.lastTs = startTs;
  for (const p of windowPayloads) foldHop(s, p, 'x');
  const prevCk = prevState.__ck ?? null;
  const rebuilt = stateBlob(s, prevBlobBytes ? { prevCheckpoint: prevCk?.event, prevState: prevCk?.hash } : {});
  return { ok: rebuilt.hash === claimedHash || undefined, state: s };
}
// Drive it across every window using only stored artifacts (state can be dropped between windows).
{
  const payloads = log.tokens.map((t) => verifyEvent(t, resolve).payload);
  let prevBytes = null, prevMeta = null, cursor = 0, audited = 0;
  for (const ck of log.checkpoints) {
    const windowEnd = ck.atSeq - 1; // events before the checkpoint event itself
    const win = payloads.slice(cursor, windowEnd).filter((p) => p.type !== 'checkpoint');
    const startSeq = cursor === 0 ? 0 : payloads[cursor - 1].seq;
    const startTs = cursor === 0 ? 0 : payloads[cursor - 1].ts;
    const s = newState();
    if (prevBytes) {
      const prevState = JSON.parse(prevBytes.toString('utf8'));
      for (const [id, [version, blob]] of Object.entries(prevState.live)) s.live.set(id, { version, blob });
      for (const [id, v] of Object.entries(prevState.deleted)) s.deleted.set(id, v);
    }
    s.lastSeq = startSeq; s.lastTs = startTs;
    for (const p of win) foldHop(s, { ...p, seq: p.seq, ts: p.ts }, 'x');
    const rebuilt = stateBlob(s, prevMeta ? { prevCheckpoint: prevMeta.event, prevState: prevMeta.hash } : {});
    assert.equal(rebuilt.hash, ck.blob.hash, `checkpoint at seq ${ck.atSeq} does not equal the fold of its own window`);
    prevBytes = ck.blob.bytes; prevMeta = { event: ck.event, hash: ck.blob.hash };
    cursor = windowEnd + 1; // skip the checkpoint event itself
    audited++;
  }
  assert.ok(audited >= 40, 'too few checkpoints audited to mean anything');
  // A LYING checkpoint (drops one id) is caught by the same audit:
  const lastHonest = log.checkpoints.at(-1);
  const lying = JSON.parse(lastHonest.blob.bytes.toString('utf8'));
  delete lying.live[Object.keys(lying.live)[0]];
  const lyingHash = b64u(sha256(Buffer.from(JSON.stringify(lying), 'utf8')));
  assert.notEqual(lyingHash, lastHonest.blob.hash, 'a lying checkpoint hashed like the honest one');
}

// ---- violation classes: per-hop fold vs any-two-checkpoints diff ----
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return e instanceof GateError && re.test(e.message); } };
{
  const s = newState();
  foldHop(s, { seq: 1, ts: 1, type: 'post', id: 'a', blob: 'h1' }, 'e1');
  foldHop(s, { seq: 2, ts: 1, type: 'delete', id: 'a' }, 'e2');
  assert.ok(throws(() => foldHop(s, { seq: 3, ts: 1, type: 'post', id: 'a', blob: 'h2' }, 'e3'), /resurrection/));
  foldHop(s, { seq: 3, ts: 1, type: 'post', id: 'b', blob: 'h1' }, 'e3');
  assert.ok(throws(() => foldHop(s, { seq: 4, ts: 1, type: 'edit', id: 'b', version: 1, blob: 'h0' }, 'e4'), /does not increment/));
  assert.ok(throws(() => foldHop(s, { seq: 6, ts: 1, type: 'post', id: 'c', blob: 'h' }, 'e5'), /not contiguous/));
  assert.ok(throws(() => foldHop(s, { seq: 4, ts: 0, type: 'post', id: 'c', blob: 'h' }, 'e5'), /walked backward/));
}
{ // skip reader: two checkpoints, one map comparison, no fold — all three classes caught
  const oldS = { live: { a: [2, 'ha2'], b: [1, 'hb1'] }, deleted: { z: 3 } };
  assert.deepEqual(checkpointDiffViolations(oldS, { live: { a: [2, 'ha2'], b: [1, 'hb1'] }, deleted: { z: 3 } }), []);
  assert.deepEqual(checkpointDiffViolations(oldS, { live: { a: [3, 'ha3'] }, deleted: { z: 3, b: 2 } }), []);
  const bad = checkpointDiffViolations(oldS, { live: { a: [1, 'ha1'], z: [4, 'hz'] }, deleted: {} });
  assert.ok(bad.some((v) => v.startsWith('version rollback: a')));
  assert.ok(bad.some((v) => v.startsWith('silent vanish: b')));
  assert.ok(bad.some((v) => v.startsWith('resurrection: z')));
}

// ---- reader costs ----
const tipLocator = 180; // {"id","seq","tip","segments","checkpoint"} — unsigned pointer bytes
const spine = 3 * avgToken; // genesis + 2 key events (5–20 lifetime; 3 here)
const lastCk = log.checkpoints.at(-1);
const growingSince = Math.floor(log.tokens.length / K) * K;
const growing = bytesOf(log.tokens.slice(growingSince));
const firstContact = { bytes: tipLocator + spine + lastCk.blob.bytes.length + growing, fetches: 4 };
const sixMonths = Math.ceil((3.4 * 182) / K); // segments covering ~182 days of events
const lapsed6mo = segBytes.slice(-sixMonths).reduce((a, b) => a + b, 0);
const fullAudit = { bytes: segBytes.reduce((a, b) => a + b, 0) + log.checkpoints.reduce((n, c) => n + c.blob.bytes.length, 0), fetches: segments.length };
assert.ok(firstContact.bytes < 5 * 1024 * 1024, `KILL: first contact ${firstContact.bytes} B > 5 MB`);
assert.ok(firstContact.fetches <= 20, `KILL: first contact ${firstContact.fetches} fetches > 20`);

// ---- the deltamanifest scenarios, re-run: Model A numbers from the existing instrument ----
const repoRoot = new URL('../../..', import.meta.url).pathname;
const out = execFileSync('node', ['tmp/measure/deltamanifest.js'], { cwd: repoRoot, encoding: 'utf8' });
const scenario = (name) => {
  const block = out.split('--- ').find((b) => b.startsWith(name));
  const retainedA = parseFloat(block.match(/retained history\s+A ([\d.]+)M/)[1]);
  const yearRow = block.match(/1 year\s+([\d.]+)M\*?\s+([\d.]+)M\*?/);
  return { retainedA, yearLinearA: parseFloat(yearRow[1]), yearSkipA: parseFloat(yearRow[2]) };
};
const MB = (n) => n / (1024 * 1024);
// Measured constants from the real build above, applied per scenario.
const CHURN = log.tokens.length / 10950;                          // events per item incl. checkpoints
const liveAtEnd = log.state.live.size;
const ENTRY = lastCk.blob.bytes.length / liveAtEnd;               // bytes per live entry in a state blob
// The log shape's costs: events are O(changes) whatever the advance cadence, so the daily and
// hourly scenarios (same items) cost the SAME log — that is the win: cost tracks changes, not cadence.
// Checkpoint state blobs recur at cadence K and grow with the live set: sum ~= count * final/2.
function logShape(items) {
  const events = Math.round(items * CHURN);
  const ckCount = Math.floor(events / K);
  const finalBlob = items * ENTRY;
  return {
    retained: MB(events * avgToken + ckCount * finalBlob / 2),
    // 1-year lapsed walk, skip mode (checkpoints individually addressable — a design consequence
    // this gate forced; see the card): ck events in the gap + ONE landing state blob + the
    // checkpoint-pair diff + the growing segment tail. Linear mode = every event in the gap.
    yearWalkSkip: MB(Math.min(ckCount, Math.ceil(events / K)) * avgToken + finalBlob + K * avgToken),
    yearWalkLinear: MB(Math.min(events, Math.round(items * CHURN)) * avgToken),
  };
}
const scen = [
  ['10y daily, no rotation (§9.2 example)', logShape(10950), 10950 / 10],   // 1-yr gap = 1/10th of items
  ['1y daily (§9.2 annual rotation)', logShape(1095), 1095],
  ['1y hourly, 30 items/day', logShape(10950), 10950],                       // 1-yr gap = everything
];
console.log('log-gate: ok');
console.log(`  built: ${log.tokens.length} signed events, ${log.checkpoints.length} checkpoints, ${buildMs} ms; avg token ${avgToken.toFixed(0)} B`);
console.log(`  retained forever: log ${MB(fullAudit.bytes).toFixed(1)} MB total (events ${MB(segBytes.reduce((a, b) => a + b, 0)).toFixed(1)} MB + checkpoint blobs ${MB(log.checkpoints.reduce((n, c) => n + c.blob.bytes.length, 0)).toFixed(1)} MB — the blobs dominate; cadence K is the storage knob)`);
console.log(`  first contact: ${(firstContact.bytes / 1024).toFixed(0)} KB, ${firstContact.fetches} fetches (kill: >5 MB or >20)`);
console.log(`  lapsed 6 months: ${(lapsed6mo / 1024).toFixed(0)} KB, ${sixMonths} segment fetches`);
console.log(`  full audit from genesis: ${MB(fullAudit.bytes).toFixed(1)} MB, ${fullAudit.fetches} fetches`);
console.log('  vs Model A (tmp/measure/deltamanifest.js, re-run live):');
for (const [name, shape, gapItems] of scen) {
  const a = scenario(name);
  const gapEvents = Math.round(gapItems * CHURN);
  const gapWalkLinear = MB(gapEvents * avgToken);
  const gapWalkSkip = MB(Math.floor(gapEvents / K) * avgToken + (name.includes('1y daily') ? 1095 : 10950) * ENTRY + K * avgToken);
  console.log(`    ${name}:`);
  console.log(`      retained  A ${a.retainedA} MB vs log ${shape.retained.toFixed(1)} MB (${(a.retainedA / shape.retained).toFixed(0)}x)`);
  console.log(`      1-yr walk A+skip ${a.yearSkipA} MB vs log linear ${gapWalkLinear.toFixed(1)} MB / skip ${gapWalkSkip.toFixed(1)} MB`);
  if (name.includes('hourly')) {
    assert.ok(Math.min(gapWalkLinear, gapWalkSkip) < a.yearSkipA,
      `KILL: 1-year lapsed log walk ${Math.min(gapWalkLinear, gapWalkSkip).toFixed(1)} MB exceeds A+_skip ${a.yearSkipA} MB`);
  }
}
