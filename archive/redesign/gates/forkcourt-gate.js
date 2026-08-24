// forkcourt-gate: is the recovery list a coherent court for forks? The objection ruling 6 promises,
// staged as the only thing it can be on the wire; the restorer who relocates inside the window;
// the two-devices-one-key fork against an empty list, a rewritten list, and the fork-point court.
// Kill criteria: a contest the code settles by a rule the owner has not written; a window that
// protects against a key-holding thief for more than zero days.
import { makeKey, sign, open, address, rawSign, rawOK, mkRec, rotHop, restoreHop, walkChain } from './lastline.js';

const G = makeKey('genesis'), A = makeKey('A'), B = makeKey('B, Alice\'s next key'), C = makeKey('C, the thief\'s key'), X = makeKey('X, the ex\'s restore key');
const mum = makeKey('mum'), sister = makeKey('sister'), ex = makeKey('the ex');
const HOME = 'home.example', EXHOST = 'exhost.example', SAFE = 'newhub.net';
const salt = 'shared-with-members';
const L = mkRec(1, salt, [mum.x, sister.x, ex.x]);
const genesis = [{ key: G.x, by: 'genesis' }, rotHop(G, A)];
const profile = (fields, key) => sign({ genesis: G.x, ...fields }, key);
const p3 = profile({ pseq: 3, prev: 'p2', recovery: L, locations: [HOME], chain: genesis }, A);
const valid = (file, x) => { try { const { obj } = open(file, x); return walkChain(obj).ok && obj.chain.at(-1).key === x; } catch { return false; } };

// A reader: a pinned (pseq, hash, prev) and whatever each location it knows serves it.
function verdict(served, pinned) {
  const ok = served.filter(({ file, by }) => valid(file, by));
  if (!ok.length) return 'unreachable';
  const top = Math.max(...ok.map(({ file, by }) => open(file, by).obj.pseq));
  const atTop = ok.filter(({ file, by }) => open(file, by).obj.pseq === top);
  if (new Set(atTop.map(({ file }) => address(file))).size > 1) return 'contested';
  if (pinned && top === pinned.pseq && address(atTop[0].file) !== pinned.hash) return 'contested';
  if (pinned && top < pinned.pseq) return 'rollback';
  const o = open(atTop[0].file, atTop[0].by).obj;
  return o.chain.at(-1).by === 'restore' ? 'fine (recently restored)' : 'fine';
}
const pin = (file, x) => ({ pseq: open(file, x).obj.pseq, hash: address(file) });

// ---- (b) the objection: a competing profile at the same pseq, same prev, by the key Alice kept ----
const restoreP = profile({ pseq: 4, prev: address(p3), recovery: L, locations: [HOME], chain: [...genesis, restoreHop(A, X, [mum, sister, ex], [ex], salt)] }, X);
const objectP = profile({ pseq: 4, prev: address(p3), recovery: L, locations: [SAFE], chain: [...genesis, rotHop(A, B)] }, B);
const warm = verdict([{ file: restoreP, by: X.x }, { file: objectP, by: B.x }], pin(p3, A.x));
const coldAtHostile = verdict([{ file: restoreP, by: X.x }], null);
const coldAtSafe = verdict([{ file: objectP, by: B.x }], null);
const afterAWeek = Array.from({ length: 7 }, () => verdict([{ file: restoreP, by: X.x }, { file: objectP, by: B.x }], pin(p3, A.x))).every((v) => v === 'contested');
// The only tie-break inside the design: k members of the committed list vouch for a branch.
const vouchFor = (to, members) => members.map((m) => ({ key: m.x, sig: rawSign(`${A.x}->${to.x}`, m) }));
const vouched = (to, vs) => vs.filter((v) => [mum.x, sister.x, ex.x].includes(v.key) && rawOK(`${A.x}->${to.x}`, v.sig, v.key)).length >= L.k;
const bothVouched = vouched(X, vouchFor(X, [ex])) && vouched(B, vouchFor(B, [mum]));

// ---- (c) the restorer relocates one version later, inside the window ----
const relocate = profile({ pseq: 5, prev: address(restoreP), recovery: L, locations: [EXHOST], chain: open(restoreP, X.x).obj.chain }, X);
const objectionAtHome = profile({ pseq: 5, prev: address(restoreP), recovery: L, locations: [SAFE], chain: [...genesis, rotHop(A, B)] }, B);
const hosts = { [HOME]: [{ file: relocate, by: X.x }, { file: objectionAtHome, by: B.x }], [EXHOST]: [{ file: relocate, by: X.x }] };
function follower({ pollPreRestoreWhileFlagged }) {
  const known = [HOME];
  const first = verdict(hosts[HOME].slice(0, 1), pin(restoreP, X.x));
  if (first.startsWith('fine')) known.unshift(EXHOST);
  const polled = pollPreRestoreWhileFlagged ? known : known.slice(0, 1);
  return verdict(polled.flatMap((h) => hosts[h]), pin(restoreP, X.x));
}
const N = 5;
const seeObjectionNaive = Array.from({ length: N }, () => follower({ pollPreRestoreWhileFlagged: false })).filter((v) => v === 'contested').length;
const seeObjectionPolling = Array.from({ length: N }, () => follower({ pollPreRestoreWhileFlagged: true })).filter((v) => v === 'contested').length;

// ---- (d) two devices, one key: the thief holds A too ----
const empty = mkRec(1, salt, []);
const p3empty = profile({ pseq: 3, prev: 'p2', recovery: empty, locations: [HOME], chain: genesis }, A);
const thiefRot = (rec) => profile({ pseq: 4, prev: address(p3empty), recovery: rec, locations: [HOME], chain: [...genesis, rotHop(A, C)] }, C);
const aliceRot = (rec, prev) => profile({ pseq: 4, prev, recovery: rec, locations: [HOME], chain: [...genesis, rotHop(A, B)] }, B);
const court = (rec, branches) => branches.filter(({ to, vs }) => vs.filter((v) => rec.members.includes(v.key) && rawOK(`${A.x}->${to.x}`, v.sig, v.key)).length >= rec.k).map(({ to }) => to.name);
const members = (ms) => ({ k: 1, members: ms.map((m) => m.x) });
const emptyWinner = court(members([]), [{ to: C, vs: [] }, { to: B, vs: vouchFor(B, [mum]) }]);
const thiefList = members([ex]), aliceList = members([mum, sister]);
const naiveCourt = [...court(thiefList, [{ to: C, vs: vouchFor(C, [ex]) }]), ...court(aliceList, [{ to: B, vs: vouchFor(B, [mum]) }])];
const forkPointCourt = court(aliceList, [{ to: C, vs: vouchFor(C, [ex]) }, { to: B, vs: vouchFor(B, [mum]) }]);
const thiefAlone = verdict([{ file: thiefRot(mkRec(1, salt, [ex.x])), by: C.x }], pin(p3empty, A.x));

console.log(`  (b) warm reader: ${warm}; cold at the ex's host: ${coldAtHostile}; cold at Alice's new host: ${coldAtSafe}; after 7 days: ${afterAWeek ? 'still contested' : 'settled'}; both branches vouched under k=1: ${bothVouched}`);
console.log(`  (c) readers who see the objection after the restorer relocates: ${seeObjectionNaive} of ${N} following the relocation; ${seeObjectionPolling} of ${N} still polling the pre-restore location while flagged`);
console.log(`  (d) empty list: winners [${emptyWinner}]; naive court (each branch's own list): [${naiveCourt}]; fork-point court (the list both branches share): [${forkPointCourt}]; thief's rotation alone reads: ${thiefAlone}\n`);

const gate = [
  ['the restore and the objection are both valid profiles at pseq 4 with the same prev', valid(restoreP, X.x) && valid(objectP, B.x)],
  ['a warm reader sees them as contested; a cold reader at either host accepts whichever it is served', warm === 'contested' && coldAtHostile === 'fine (recently restored)' && coldAtSafe === 'fine'],
  ['the contest never settles — seven days of polling change nothing', afterAWeek],
  ['the only in-design tie-break (k members vouch) is met on both branches under k=1', bothVouched],
  ['a relocation by the restorer inside the window is valid and readers who follow it never see the objection', valid(relocate, X.x) && seeObjectionNaive === 0],
  ['a reader rule "poll the pre-restore location while flagged" lets every reader see it', seeObjectionPolling === N],
  ['with an empty recovery list a two-device fork has no court: nobody wins', emptyWinner.length === 0],
  ['judging each branch by its own list, the thief who rewrote the list on rotation wins his branch too', naiveCourt.includes('C, the thief\'s key') && naiveCourt.includes('B, Alice\'s next key')],
  ['the fork-point court — the list in the last profile both branches share — picks Alice alone', forkPointCourt.length === 1 && forkPointCourt[0] === 'B, Alice\'s next key'],
  ['a key-holding thief\'s rotation is "proving it yourself": no flag, reader state fine, window protection zero days', thiefAlone === 'fine'],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('forkcourt-gate: all claims hold');
