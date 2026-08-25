// coldcourt-gate: the recovery (§3.6) at a chain length the reader never observed. A reader keeps a
// recovery per chain length, but a rotation link carries no list, so a reader that first met Alice
// after her rotations holds a recovery only at the length it met her. A restore link is signed by its
// vouchers and never by the key it replaces — so anyone holding her PUBLIC chain can fork below
// that length with a self-vouched restore carrying a recovery of one, and §7.1 step 5 records that
// recovery because the reader has none there. This gate stages it through the unchanged reader, then
// prices the repairs as a pure function for the owner.
// Kill criteria: the forger refused by the reader as written (the finding is false); a repair under
// which Alice cannot recover a reader; a repair that re-opens recovery-gate's rows.
import { read } from '../weekend-reader/weekend-reader.js';
import * as pub from '../weekend-publisher/weekend-publisher.js';
import crypto from 'node:crypto';
import { Hub, io } from './hub.js';

const claims = [];
const claim = (what, ok) => { claims.push([what, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };
const who = (r, T) => (r.verdict !== 'ok' ? `${r.verdict}: ${r.why}` : r.chain.current === T.x ? 'FOLLOWS THE FORGER' : 'follows Alice');

// Alice: anchor G, rotated to K2, then to K3; list of three with the ex on it. The forger is the
// ex: he holds his own key and nothing of hers.
const G = pub.newKey(), K2 = pub.newKey(), K3 = pub.newKey(), T = pub.newKey();
const mum = { key: pub.newKey(), salt: 's-mum' }, sis = { key: pub.newKey(), salt: 's-sis' }, ex = { key: pub.newKey(), salt: 's-ex' };
const REC = pub.commit([mum, sis, ex]), HIS = pub.commit([ex]);
const AT = '/alice';
// The chain as the text was written (no list on a rotation link) and as ruled (every link carries it).
const bare = [{ key: G.x }, pub.rotation(G, K2), pub.rotation(K2, K3)];
const honest = [{ key: G.x }, pub.rotation(G, K2, REC), pub.rotation(K2, K3, REC)];
const prof = (version, chain, recovery, key) => pub.profile({ anchor: G.x, version, chain, recovery, locations: ['https://alice.example'], read: 'x' }, key);

async function scene(chain) {
  const hub = await new Hub().listen(), net = io(hub);
  await net.put(`${AT}/profile`, prof(3, chain, REC, K3), null);
  await pub.publish(net, AT, K3, 1, { at: '2026-08-01', text: 'post 1' });
  const first = await read(net.get, { learned: G.x, at: AT });
  // Serving a branch means its index too: the forger lists nothing of hers (he signs the index).
  const serve = async (p, key, own = false) => { hub.files.set('alice/profile', p); await pub.amendIndex(net, AT, key, (h) => ({ ...h, entries: own ? [] : h.entries })); };
  return { hub, net, pin: first.pin, first, serve, see: (pin) => read(net.get, { learned: G.x, at: AT, pin }), cold: () => read(net.get, { learned: G.x, at: AT }) };
}

console.log('\n1. The reader as ruled (2026-08-23): every link carries its list; one link shape.\n');
const s = await scene(honest);
claim(`the reader pinned Alice ok and holds a recovery at every length: ${Object.keys(s.pin.recoveryLists).join(' ')}`, s.first.verdict === 'ok' && Object.keys(s.pin.recoveryLists).join() === '1,2,3');
// The forger copies her public rotation to K2 and forks at index 2 with a restore to his own key,
// vouched by himself, carrying a recovery of one. He signs nothing with any key of hers.
const forkAt2 = prof(4, [honest[0], honest[1], pub.restore(K2, T, [ex], HIS)], HIS, T);
await s.serve(forkAt2, T, true);
const r1 = await s.see(s.pin);
claim(`forger at index 2, no key of Alice's: ${who(r1, T)} — his link is judged by the recovery the reader holds there`, r1.why === 'the chain of key changes does not hold');
await s.serve(prof(3, honest, REC, K3), K3);
const r2 = await s.see(s.pin);
claim(`Alice's real profile still reads ${r2.verdict}`, r2.verdict === 'ok');
const s1 = await scene(honest);
await s1.serve(prof(4, [honest[0], pub.restore(G, T, [ex], HIS)], HIS, T), T, true);
const r4 = await s1.see(s1.pin);
claim(`forger at index 1 (from the anchor itself): ${who(r4, T)}`, r4.why === 'the chain of key changes does not hold');
const s2 = await scene(honest);
await s2.serve(prof(4, [...honest, pub.restore(K3, T, [ex], HIS)], HIS, T), T, true);
const r5 = await s2.see(s2.pin);
claim(`a self-vouched restore at index 3 — an extension, not a split — is judged by the held recovery too: ${who(r5, T)}`, r5.why === 'the chain of key changes does not hold');

// The thief who really holds K2 forks with a rotation. Both links are valid; neither has a vote.
// Alice's remedy under the unified link: her people add their vouchers to the K2→K3 link she
// already made, and K3 and every post it signed stand.
const s3 = await scene(honest);
const thief = prof(4, [honest[0], honest[1], pub.rotation(K2, T, REC)], REC, T);
await s3.serve(thief, T, true);
const t1 = await s3.see(s3.pin);
claim(`a thief holding K2 forks with a rotation: ${who(t1, T)}`, t1.verdict === 'identity' && /contested/.test(t1.why));
const vouchedChain = [honest[0], honest[1], pub.vouched(honest[2], K2, [mum, sis])];
await s3.serve(prof(5, vouchedChain, REC, K3), K3);
await pub.relist(s3.net, AT, K3, 1, s3.pin.live.get(1));          // her index again, on her own hub
const a1 = await s3.see(s3.pin);
claim(`Alice republishes with mum's and sis's vouchers on her existing K2→K3 link: ${who(a1, T)}, and her post 1 is still there`, a1.verdict === 'ok' && a1.posts.has(1));
await s3.serve(thief, T, true);
const t2 = await s3.see(a1.pin);
claim(`the thief's branch against the vouched pin: ${t2.verdict}: ${t2.why}`, t2.verdict === 'host');
await s3.serve(thief, T, true); const coldOnThief = await s3.cold();
claim(`a cold reader handed the thief's branch follows it — the stated limit: ${who(coldOnThief, T)}`, coldOnThief.verdict === 'ok' && coldOnThief.chain.current === T.x);

// 2. The rule as a pure function — the reader's lines 131-146 with the repairs switchable — over
//    the same forks, and Alice's remedies under each.
console.log('\n2. The repairs, priced (the rule as a pure function over the text as it was written).\n');
const H = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const linkSig = (from, to, x, sig) => { try { return crypto.verify(null, Buffer.from(`${from}->${to}`), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }), Buffer.from(sig, 'base64url')); } catch { return false; } };
const vouches = (from, link, recovery) => { const leaves = new Set(recovery?.leaves ?? []); return new Set((link?.vouchers ?? []).filter((v) => linkSig(from, link.key, v.key, v.sig) && leaves.has(H(Buffer.from(`${v.salt}|${v.key}`)))).map((v) => v.key)).size; };
// mode: 'written' (§3.6 + §7.1 as written); 'guard' (a pinned reader takes no recovery at a length
// its chain already reaches); 'everyhop' (every link carries the list in force before it — the
// profile shape changes, the reader does not); 'unified' (every link carries its list, and a link
// may carry both a rotation signature and vouchers, so vouchers can be added to a link later).
function contest(pin, served, mode) {
  const recoveryLists = { ...pin.recoveryLists };
  served.chain.forEach((h, j) => { if (h.recovery && !(j in recoveryLists) && !(mode === 'guard' && j < pin.chain.length)) recoveryLists[j] = h.recovery; });
  const i = served.chain.findIndex((h, j) => j < pin.chain.length && pin.chain[j].key !== h.key);
  if (i < 0) return { verdict: 'no split — accepted', pin: { chain: served.chain, recoveryLists } };
  const majority = (c) => vouches(c[i - 1].key, c[i], recoveryLists[i]) * 2 > (recoveryLists[i]?.leaves.length ?? Infinity);
  const mine = majority(pin.chain), theirs = majority(served.chain);
  if (mine === theirs) return { verdict: 'contested', pin };
  return mine ? { verdict: 'host (branch rejected)', pin } : { verdict: 'FOLLOWS SERVED', pin: { chain: served.chain, recoveryLists } };
}
const withCourts = (chain, list) => chain.map((h, j) => (j === 0 ? h : { ...h, recovery: list }));
const voucherSigs = (from, to, members) => members.map(({ key, salt }) => ({ key: key.x, salt, sig: crypto.sign(null, Buffer.from(`${from.x}->${to.x}`), key.privateKey).toString('base64url') }));
const K4 = pub.newKey();
const rows = [];
for (const mode of ['written', 'guard', 'everyhop', 'unified']) {
  const carried = mode === 'everyhop' || mode === 'unified';
  const chain = carried ? withCourts(bare, REC) : bare;
  const pin = { chain, recoveryLists: carried ? { 1: REC, 2: REC, 3: REC } : { 3: REC } };
  const forger = { chain: [chain[0], chain[1], pub.restore(K2, T, [ex], HIS)] };
  const forgerG = { chain: [chain[0], pub.restore(G, T, [ex], HIS)] };
  // Alice's remedies at index 2: a restore K2→K4 vouched by mum and sis (it abandons K3 and every
  // post K3 signed), or — unified only — mum's and sis's vouchers added to her existing K2→K3 link.
  const restore = { chain: [chain[0], chain[1], { ...pub.restore(K2, K4, [mum, sis], REC), ...(carried ? { recovery: REC } : {}) }] };
  const unified = { chain: [chain[0], chain[1], { ...chain[2], vouchers: voucherSigs(K2, K3, [mum, sis]) }] };
  const afterRestore = contest(pin, restore, mode), afterUnified = contest(pin, unified, mode);
  const f2 = contest(pin, forger, mode);
  rows.push({
    mode,
    'forger @2': f2.verdict,
    'forger @1': contest(pin, forgerG, mode).verdict,
    'her restore @2, then the forger': `${afterRestore.verdict} → ${contest(afterRestore.pin, forger, mode).verdict}`,
    'vouchers added to her K2→K3 link, then the forger': mode === 'unified' ? `${afterUnified.verdict} → ${contest(afterUnified.pin, forger, mode).verdict}` : '(no such link)',
    'her restore after a reader was hijacked': f2.verdict === 'FOLLOWS SERVED' ? contest(f2.pin, restore, mode).verdict : '(no hijack)',
    'rotation link bytes': JSON.stringify(chain[1]).length,
  });
}
console.table(rows);
const by = Object.fromEntries(rows.map((r) => [r.mode, r]));
claim('as written: the forger is followed at index 2 and at index 1', by.written['forger @2'] === 'FOLLOWS SERVED' && by.written['forger @1'] === 'FOLLOWS SERVED');
claim('as written: a reader he hijacked rejects her two-of-three restore forever', by.written['her restore after a reader was hijacked'] === 'host (branch rejected)');
claim('guard alone: the forger is contested — and so is Alice, who cannot recover that reader', by.guard['forger @2'] === 'contested' && by.guard['her restore @2, then the forger'].startsWith('contested'));
claim('every link carries its list: the forger is contested at both indices; her restore is accepted and the forger then rejected', by.everyhop['forger @2'] === 'contested' && by.everyhop['forger @1'] === 'contested' && by.everyhop['her restore @2, then the forger'] === 'FOLLOWS SERVED → host (branch rejected)');
claim('unified link: vouchers added to the rotation she already made do the same, and K3 and its posts survive', by.unified['vouchers added to her K2→K3 link, then the forger'] === 'no split — accepted → host (branch rejected)');
console.log(`\n  carrying the list on a rotation link costs ${by.everyhop['rotation link bytes'] - by.written['rotation link bytes']} bytes per link (three leaves)`);

for (const h of [s, s1, s2, s3]) h.hub.close();
const failed = claims.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} claim(s) did not hold` : `\nall ${claims.length} claims hold`);
process.exit(failed.length ? 1 : 0);
