// Skip-link prototype: does an OPTIONAL anchor field on the MANIFEST chain (§9) rescue
// the lapsed reader that §5.3 pin-and-walk currently strands?
//
// The problem: pin-and-walk is linear in versions, every manifest version carries its whole
// `items` map, and §13.4 caps total history bytes fetched per update at 10 MB. So the cost of
// reconnecting a pin is O(versions x items). Cadence and rotation bound what a publisher
// stores; neither shortens a consumer's walk forward from a live pin.
//
// Candidate: `_skip`, a map of {seq: hash} naming earlier versions of the same chain, so a
// walk is O(log) fetches instead of O(V). Three questions this settles with real bytes:
//
//   Q1  Where does the linear walk actually breach §13.4's 10 MB cap? (the lapsed-reader cliff)
//   Q2  ABSOLUTE anchors (multiples of powers of two) vs RELATIVE offsets (head-2, head-4, ...).
//       Relative is the obvious encoding; does it fragment the §5.3.1 comparison network?
//   Q3  What does a skipping consumer give up, and can it be bought back cheaply?
//
// Manifest chain only, per the scoping decision: the identity chain runs 5-20 versions over a
// lifetime (§3.2.1), where a skip field is pure cost in the most-parsed document in the protocol.

import crypto from 'node:crypto';

// ---- helpers lifted from regen.js (same canonicalization + signing construction, §6) ----
function canon(v){
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
const b64u = b => Buffer.from(b).toString('base64url');
const sha256 = b => crypto.createHash('sha256').update(b).digest();
function keyFromLabel(label){
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 '+label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), seed]);
  const priv = crypto.createPrivateKey({key:pkcs8, format:'der', type:'pkcs8'});
  const spki = crypto.createPublicKey(priv).export({format:'der', type:'spki'});
  return {priv, pub: crypto.createPublicKey(priv), x:b64u(spki.subarray(spki.length-32))};
}
function sign(obj, priv, kid){
  const {_sig, _recovery_sig, ...rest} = obj;
  const hb = b64u(Buffer.from(JSON.stringify({alg:'EdDSA', b64:false, crit:['b64'], kid}),'utf8'));
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  return hb + '..' + b64u(crypto.sign(null, input, priv));
}
function verify(obj, pub){
  const {_sig, _recovery_sig, ...rest} = obj;
  const [hb,,sig] = _sig.split('.');
  const input = Buffer.concat([Buffer.from(hb+'.','ascii'), Buffer.from(canon(rest),'utf8')]);
  return crypto.verify(null, input, pub, Buffer.from(sig,'base64url'));
}
const bytesOf = obj => Buffer.from(canon(obj), 'utf8');
const hashOf  = obj => b64u(sha256(bytesOf(obj)));

const ID = 'https://mom.pence.family/';
const FEED = ID + 'feed.json';
const KID = ID + '#key-1';
const k = keyFromLabel('skip-key-1');

// ---- the two anchor schemes -------------------------------------------------------------
// ABSOLUTE: for each level k, the largest multiple of 2^k strictly below N. Every walker
// passing through a region lands on the SAME seqs, whatever their pin or the current head.
function anchorsAbsolute(N, K = 20){
  const out = new Set();
  for (let i = 1; i <= K; i++){
    const step = 2 ** i;
    const a = Math.floor((N - 1) / step) * step;
    if (a > 0 && a < N) out.add(a);
  }
  return [...out].sort((a,b) => b - a);
}
// RELATIVE: N-2, N-4, N-8, ... Anchors depend on where you are, so two walkers at different
// heads visit disjoint seqs.
function anchorsRelative(N, K = 20){
  const out = new Set();
  for (let i = 1; i <= K; i++){
    const a = N - 2 ** i;
    if (a > 0) out.add(a);
  }
  return [...out].sort((a,b) => b - a);
}

// ---- build a real manifest chain ---------------------------------------------------------
// One year at the cadence §9.2 recommends (daily), 3 items/day. Family scale, not a stress test.
const VERSIONS = 365, ITEMS_PER_VERSION = 3;
const T0 = 1736899200, DAY = 86400;

function buildChain(anchorFn){
  const chain = [];             // chain[seq-1] = { obj, bytes, hash }
  const items = {};
  let prev = null;
  for (let seq = 1; seq <= VERSIONS; seq++){
    for (let j = 0; j < ITEMS_PER_VERSION; j++){
      const n = (seq - 1) * ITEMS_PER_VERSION + j;
      // ids are opaque UUID-shaped, per the §13.8 guidance; hash stands in for real item bytes
      items[`urn:uuid:${n.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`] =
        [1, b64u(sha256(Buffer.from('item'+n)))];
    }
    const m = { url: ID, feed_url: FEED, seq, updated: T0 + seq * DAY, items: {...items} };
    if (prev) m.prev = prev;
    if (anchorFn){
      const sk = {};
      for (const a of anchorFn(seq)) sk[String(a)] = chain[a-1].hash;
      if (Object.keys(sk).length) m._skip = sk;
    }
    m._sig = sign(m, k.priv, KID, { kind: 'manifest' });
    const bytes = bytesOf(m);
    const hash = b64u(sha256(bytes));
    chain.push({ obj: m, bytes, hash });
    prev = hash;
  }
  return chain;
}

// ---- walkers -----------------------------------------------------------------------------
// Both enforce §5.3: verify each fetched version's _sig, confirm its bytes hash to the value
// the document that pointed at it named, reject on seq decrease. Returns fetch + byte cost.
function walkLinear(chain, pinSeq, pinHash){
  if (pinSeq > chain.length) return { ok:false, rollback:true, fetches:0, bytes:0, visited:[] };
  let fetches = 0, bytes = 0, cur = chain.length, expect = chain[cur-1].hash, visited = [];
  while (cur >= pinSeq){
    const v = chain[cur-1];
    fetches++; bytes += v.bytes.length; visited.push(cur);
    if (v.hash !== expect) throw new Error(`hash mismatch at seq ${cur}`);
    if (!verify(v.obj, k.pub)) throw new Error(`bad _sig at seq ${cur}`);
    if (cur === pinSeq) return { ok: v.hash === pinHash, fetches, bytes, visited };
    expect = v.obj.prev; cur--;
  }
  return { ok:false, fetches, bytes, visited };
}

function walkSkip(chain, pinSeq, pinHash, { spotCheck = false } = {}){
  // §5.3: a head below the consumer's pin is a rollback, rejected before anything is fetched.
  if (pinSeq > chain.length) return { ok:false, rollback:true, fetches:0, bytes:0, visited:[] };
  let fetches = 0, bytes = 0, cur = chain.length, expect = chain[cur-1].hash, visited = [];
  while (true){
    const v = chain[cur-1];
    fetches++; bytes += v.bytes.length; visited.push(cur);
    if (v.hash !== expect) throw new Error(`hash mismatch at seq ${cur}`);
    if (!verify(v.obj, k.pub)) throw new Error(`bad _sig at seq ${cur}`);
    if (cur === pinSeq) return { ok: v.hash === pinHash, fetches, bytes, visited };
    // furthest jump that does not overshoot the pin: the smallest reachable seq still >= pin
    const reachable = [cur - 1, ...Object.keys(v.obj._skip || {}).map(Number)].filter(s => s >= pinSeq);
    const next = Math.min(...reachable);
    expect = next === cur - 1 ? v.obj.prev : v.obj._skip[String(next)];
    // Q3: one prev link into the landing region costs +1 fetch and forces any fabricated
    // anchor to cascade into fabricating the whole chain above it.
    if (spotCheck && next !== cur - 1){
      const above = chain[next];   // seq next+1
      fetches++; bytes += above.bytes.length;
      if (above.obj.prev !== expect)
        throw new Error(`FABRICATED ANCHOR: seq ${next+1}.prev disagrees with the anchor in seq ${cur}`);
    }
    cur = next;
  }
}

const MB = 1024 * 1024;
const fmt = b => (b / MB).toFixed(2) + ' MB';
const CAP = 10 * MB;   // §13.4 total history bytes fetched per update

console.log('Skip-link prototype — manifest chain, %d versions, %d items/version (%d items)',
  VERSIONS, ITEMS_PER_VERSION, VERSIONS * ITEMS_PER_VERSION);

const plain = buildChain(null);
const abs   = buildChain(anchorsAbsolute);
const head  = VERSIONS;

console.log('\nhead manifest: %d bytes plain, %d bytes with _skip (+%d B, +%s%%)',
  plain[head-1].bytes.length, abs[head-1].bytes.length,
  abs[head-1].bytes.length - plain[head-1].bytes.length,
  ((abs[head-1].bytes.length / plain[head-1].bytes.length - 1) * 100).toFixed(1));
const retainedPlain = plain.reduce((a,v) => a + v.bytes.length, 0);
const retainedAbs   = abs.reduce((a,v) => a + v.bytes.length, 0);
console.log('retained history: %s plain, %s with _skip (publisher storage cost of anchors: %s)',
  fmt(retainedPlain), fmt(retainedAbs), fmt(retainedAbs - retainedPlain));

// ---- Q1: where does the linear walk breach the cap? --------------------------------------
const row = (a,b,c,d,e,f,g,h) => '  ' + String(a).padEnd(19) + String(b).padStart(7) +
  String(c).padStart(10) + String(d).padStart(8) + '  ' + String(e).padStart(6) +
  String(f).padStart(10) + '  ' + String(g).padStart(6) + String(h).padStart(10);

// The spot-check is NOT optional in the shipped spec, and this prototype's first draft priced
// the walk as though it were. §9.1.1 says a consumer "SHOULD then fetch the version immediately
// above that anchor and confirm its `prev` names the same hash", and §9.1 hardened the
// companion's own `_sig` verification to a MUST — "so MUST the `_sig` ... of the `seq+1`
// companion that confirms the anchor". §13.4 prices a jump at "two full versions" accordingly.
// So the column that sold this mechanism is the wrong column; both are shown, and the verdict
// is judged on the right-hand one.
console.log('\nCLAIM 1 — the lapsed-reader cliff (§13.4 cap = ' + fmt(CAP) + ')');
console.log('  (skip-unchecked is what this file measured before §9.1 made the companion a MUST)');
console.log(row('lapse', 'linear', 'bytes', 'cap?', 'unchk', 'bytes', 'skip+', 'bytes'));
let cliff = null;
let worstChecked = 0;
for (const days of [7, 30, 90, 150, 240, 364]){
  const pin = head - days;
  const L = walkLinear(plain, pin, plain[pin-1].hash);
  const S = walkSkip(abs, pin, abs[pin-1].hash);
  const C = walkSkip(abs, pin, abs[pin-1].hash, { spotCheck: true });
  if (!L.ok || !S.ok || !C.ok) throw new Error('walk failed to reconnect the pin');
  if (cliff === null && L.bytes > CAP) cliff = days;
  worstChecked = Math.max(worstChecked, C.bytes);
  console.log(row(`${days} d (pin ${pin})`, L.fetches, fmt(L.bytes),
    L.bytes > CAP ? 'BREACH' : 'ok', S.fetches, fmt(S.bytes),
    C.fetches, fmt(C.bytes) + (C.bytes > CAP ? ' BREACH' : '')));
}
console.log('  → linear walking breaches the cap after ~%d days away; §5.3 then requires the', cliff);
console.log('    consumer to treat the chain as UNVERIFIABLE.');
console.log('  → the companion fetch roughly doubles the skip walk, exactly as §13.4 says it does.');
console.log('    Worst checked lapse is %s against a %s cap — still an order of magnitude', fmt(worstChecked), fmt(CAP));
console.log('    of headroom, so the verdict survives being priced correctly. It is the SPEC\'s');
console.log('    extrapolations that need care: §9.1.1 and §13.4 both reason from "a skip jump');
console.log('    costs two full versions", and that is the number measured here, not the one');
console.log('    this file originally reported.');

// ---- Q2: absolute vs relative anchors, and the comparison network --------------------------
// §5.3.1 needs two observers to land on the SAME seq to compare hashes. Anchors decide that.
console.log('\nCLAIM 2 — relative offsets fragment the §5.3.1 comparison network');
function visitedSet(anchorFn, headSeq, pinSeq){
  const seen = new Set(); let cur = headSeq;
  while (cur > pinSeq){
    seen.add(cur);
    const reachable = [cur - 1, ...anchorFn(cur)].filter(s => s >= pinSeq);
    cur = Math.min(...reachable);
  }
  seen.add(pinSeq); return seen;
}
for (const [name, fn] of [['absolute', anchorsAbsolute], ['relative', anchorsRelative]]){
  // three readers, different pins, polling at slightly different heads — the ordinary case
  const readers = [[365, 20], [364, 55], [363, 101]].map(([h,p]) => visitedSet(fn, h, p));
  const shared = [...readers[0]].filter(s => readers[1].has(s) && readers[2].has(s));
  const union = new Set(readers.flatMap(r => [...r]));
  console.log('  ' + name.padEnd(9) + ' 3 readers visit ' + union.size +
    ' distinct seqs; all three share ' + shared.length +
    '  (' + ((shared.length / union.size) * 100).toFixed(0) + '% overlap)' +
    (shared.length ? '  → ' + shared.slice(0,6).join(', ') : ''));
}
console.log('  → absolute anchors are the load-bearing choice. Relative offsets give a walk that is');
console.log('    just as fast and a comparison network that barely intersects.');

// ---- Q3: what a skipping consumer gives up, and the spot-check that buys it back ----------
console.log('\nCLAIM 3 — a fabricated anchor is invisible to a skipper and caught by one extra fetch');
// The attack: the publisher serves an honest LINEAR chain (so full walkers see nothing wrong)
// and forges one anchor in the head, aimed only at consumers who skip.
const forged = buildChain(anchorsAbsolute);
const victimSeq = 256;
const fake = { ...forged[victimSeq-1].obj,
  items: { 'urn:uuid:deadbeef-0000-4000-8000-000000000000': [1, b64u(sha256(Buffer.from('forged')))] } };
delete fake._sig; fake._sig = sign(fake, k.priv, KID, { kind: 'manifest' });
const fakeHash = hashOf(fake);
forged[victimSeq-1] = { obj: fake, bytes: bytesOf(fake), hash: fakeHash };
const headV = forged[VERSIONS-1];                       // point the head's anchor at the fake
headV.obj._skip[String(victimSeq)] = fakeHash;
delete headV.obj._sig; headV.obj._sig = sign(headV.obj, k.priv, KID, { kind: 'manifest' });
headV.bytes = bytesOf(headV.obj); headV.hash = b64u(sha256(headV.bytes));
// seq 257 is untouched: its `prev` still names the REAL seq 256. That is the contradiction.

let skipperAccepted = false, spotCheckCaught = null;
try { skipperAccepted = walkSkip(forged, 20, forged[19].hash).ok; } catch { skipperAccepted = false; }
try { walkSkip(forged, 20, forged[19].hash, { spotCheck: true }); }
catch (e) { spotCheckCaught = e.message; }
console.log('  plain skip walk accepts the forged anchor : ' + (skipperAccepted ? 'YES (undetected)' : 'no'));
console.log('  with one prev spot-check per hop          : ' + (spotCheckCaught ? 'CAUGHT — ' + spotCheckCaught : 'missed'));
const without   = walkSkip(abs, head - 150, abs[head-151].hash);
const withCheck = walkSkip(abs, head - 150, abs[head-151].hash, { spotCheck: true });
console.log('  cost of the spot-check (150-day lapse)    : ' + without.fetches + ' → ' +
  withCheck.fetches + ' fetches, ' + fmt(without.bytes) + ' → ' + fmt(withCheck.bytes) +
  '   (linear was 151 fetches / ' + fmt(walkLinear(plain, head-150, plain[head-151].hash).bytes) + ')');
console.log('  → the forged anchor and seq 257\'s `prev` are two signed statements about the same');
console.log('    bytes, so fabricating it undetectably means fabricating every version above it —');
console.log('    "forge the whole chain", already available to a key custodian (§13.2) and impossible');
console.log('    for a serving-path attacker. Skipping costs nothing against either tier. What it');
console.log('    does cost is WITNESS breadth: you observe fewer versions, so you can corroborate less.');

// ---- rollback and comparison-point properties survive skipping -----------------------------
const rollback = walkSkip(abs, head + 5, 'whatever');
const rollbackRejected = rollback.ok === false && rollback.rollback === true;
const readerA = walkSkip(abs, 100, abs[99].hash);
const readerB = walkSkip(abs, 37,  abs[36].hash);
const monotonic = readerA.visited.every((s,i,a) => i === 0 || s < a[i-1]);
const sharedPoints = readerA.visited.filter(s => readerB.visited.includes(s));
console.log('\n  head below the pin is rejected as rollback  : ' + (rollbackRejected ? 'ok' : 'FAIL'));
console.log('  visited seqs strictly decrease              : ' + (monotonic ? 'ok' : 'FAIL'));
console.log('  two readers, different pins, shared anchors : ' + sharedPoints.join(', '));

if (!skipperAccepted || !spotCheckCaught || !rollbackRejected || !monotonic || sharedPoints.length < 2){
  console.error('\nPROTOTYPE FAILED — a claim above did not hold'); process.exit(1);
}
console.log('\nVERDICT');
console.log('  Adopt for the MANIFEST chain, OPTIONAL and additive:');
console.log('   - the only thing that keeps a lapsed reader inside §13.4. Cadence and rotation bound');
console.log('     storage for the publisher; neither shortens a walk from a live pin.');
console.log('   - anchors MUST be absolute (multiples of powers of two), or the §5.3.1 comparison');
console.log('     network dissolves — relative offsets walk just as fast and witness nothing shared.');
console.log('   - a skipping consumer MUST spot-check one `prev` per hop: ~2x fetches, still');
console.log('     logarithmic, and it restores full-walk security exactly. This file first reported');
console.log('     the UNCHECKED cost and recommended the check as a SHOULD; the spec correctly');
console.log('     hardened it (§9.1, §9.1.1) and §13.4 now prices a jump at two full versions.');
console.log('     Measured at the right price the worst lapse is ' + fmt(worstChecked) + ' against a ' + fmt(CAP) + ' cap,');
console.log('     so the conclusion holds — but the number it holds by is half what was reported.');
console.log('   - publisher cost: ' + (abs[head-1].bytes.length - plain[head-1].bytes.length) +
  ' B on the head manifest, ' + fmt(retainedAbs - retainedPlain) + ' of retained history.');
console.log('  NOT the identity chain: 5-20 lifetime versions (§3.2.1) never repay the field.');
console.log('\nALL CLAIMS HOLD');
