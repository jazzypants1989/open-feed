// oldkey-gate: what a key she rotated away from can still do. §4.3 says a stolen old key is closed
// "without any revocation mechanism" because the head is signed by the current key. Two places
// the text does not reach: §9.5's reclaim rule calls a file "the owner's" when ANY chain key
// signed it, so an old key can hold every number she has not reached yet and she cannot take them
// back; and §5.2 forbids re-listing a withdrawn number at any hash, so what a thief withdrew while
// he held the current key stays withdrawn after her restore. Finding A2 and A5 of the 2026-08-23
// review. Kill criteria: the squat refused under §9.5 as written; a re-listing rule that lets a
// host resurrect a post the author withdrew, or lets a number carry two hashes.
import crypto from 'node:crypto';
import { read } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';
import { Hub, io } from './hub.js';

const claims = [];
const claim = (what, ok) => { claims.push([what, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };
const H = (b) => crypto.createHash('sha256').update(b).digest('base64url');

const G = pub.newKey(), K2 = pub.newKey(), K3 = pub.newKey();
const mum = { key: pub.newKey(), salt: 's-mum' }, sis = { key: pub.newKey(), salt: 's-sis' }, ex = { key: pub.newKey(), salt: 's-ex' };
const REC = pub.commit(2, [mum, sis, ex]);
const AT = '/alice';
const prof = (pseq, chain, key) => pub.profile({ genesis: G.x, pseq, chain, recovery: REC, locations: ['https://alice.example'] }, key);
const c2 = [{ key: G.x }, pub.rotation(G, K2, REC)];

// ---- A2: the rotated-out key squats her numbers ----
async function squat(reclaim) {
  const hub = await new Hub({ reclaim }).listen(), net = io(hub);
  await net.put(`${AT}/profile`, prof(2, c2, K2), null);
  for (let n = 1; n <= 3; n++) await pub.publish(net, AT, K2, n, { at: '2026-08-01', text: `post ${n}` });
  // The thief holds G — her first phone's key, rotated away from — and PUTs five posts signed by it,
  // each declaring its number, at the numbers she has not reached.
  const thief = [];
  for (let n = 4; n <= 8; n++) thief.push(await net.put(`${AT}/posts/${n}`, pub.post(n, { at: 'x', text: 'squat' }, G)));
  // Alice's next post: her publisher walks past every 409.
  const landed = await pub.publish(net, AT, K2, 4, { at: '2026-08-02', text: 'post 4' });
  // The rule must not turn around: the thief cannot take a post she wrote but has not listed yet
  // (K2-signed, unlisted), nor a listed post signed by the old key, and she cannot overwrite her own.
  const unlisted = pub.post(9, { at: 'x', text: 'mine, not yet listed' }, K2);
  await net.put(`${AT}/posts/9`, unlisted);
  const thiefOnUnlisted = await net.put(`${AT}/posts/9`, pub.post(9, { at: 'x', text: 'squat' }, G));
  const oldListed = pub.post(10, { at: 'x', text: 'signed by G back when G was current' }, G);
  await net.put(`${AT}/posts/10`, oldListed);
  await pub.amendHead(net, AT, K2, (h) => ({ ...h, entries: [...h.entries, [10, pub.address(oldListed)]], top: 10 }));
  const thiefOnListed = await net.put(`${AT}/posts/10`, pub.post(10, { at: 'x', text: 'squat' }, G));
  const selfOverwrite = await net.put(`${AT}/posts/10`, pub.post(10, { at: 'x', text: 'rewritten' }, K2));
  const r = await read(net.get, { learned: G.x, at: AT });
  hub.close();
  return { thief, landed, thiefOnUnlisted, thiefOnListed, selfOverwrite, verdict: r.verdict, lost: landed - 4 };
}
console.log('\nA2. Five posts signed by a rotated-out key, at the numbers she has not reached.\n');
const asWritten = await squat('chain'), repaired = await squat('current');
claim(`as written: the thief gets ${asWritten.thief.join(' ')}; her post 4 lands at ${asWritten.landed} — ${asWritten.lost} numbers lost to her for good`, asWritten.thief.every((s) => s === 201) && asWritten.lost === 5);
claim('as written: readers see nothing wrong — the squats are unlisted, so the read is ok', asWritten.verdict === 'ok');
claim(`repaired ("the owner's file" is signed by the CURRENT key, or listed): her post 4 lands at ${repaired.landed}`, repaired.lost === 0);
claim('repaired: the thief cannot take her unlisted current-key post (409), nor her listed old-key post (409)', repaired.thiefOnUnlisted === 409 && repaired.thiefOnListed === 409);
claim('repaired: she still cannot overwrite her own listed post (409)', repaired.selfOverwrite === 409);
claim('as written, the same three refusals hold — the repair loses nothing', asWritten.thiefOnUnlisted === 409 && asWritten.thiefOnListed === 409 && asWritten.selfOverwrite === 409);

// ---- A5: what a thief withdrew while he held the current key ----
console.log('\nA5. The thief held K2, withdrew everything, rewrote the head. Alice restores to K3.\n');
const relistScene = async (thiefRewrites) => {
  const hub = await new Hub().listen(), net = io(hub);
  await net.put(`${AT}/profile`, prof(2, c2, K2), null);
  for (let n = 1; n <= 3; n++) await pub.publish(net, AT, K2, n, { at: '2026-08-01', text: `post ${n}` });
  const before = await read(net.get, { learned: G.x, at: AT });
  const hashes = new Map(before.pin.live);
  for (let n = 1; n <= 3; n++) await pub.withdraw(net, AT, K2, n);
  if (thiefRewrites) await pub.rewrite(net, AT, K2);
  const during = await read(net.get, { learned: G.x, at: AT, pin: before.pin });
  // Alice restores and re-lists the same three posts at their identical hashes.
  hub.files.set('alice/profile', prof(3, [...c2, pub.restore(K2, K3, [mum, sis], REC)], K3));
  for (let n = 1; n <= 3; n++) await pub.relist(net, AT, K3, n, hashes.get(n));
  const rs = await Promise.all([read(net.get, { learned: G.x, at: AT, pin: before.pin }), read(net.get, { learned: G.x, at: AT, pin: during.pin }), read(net.get, { learned: G.x, at: AT })]);
  // And a number that comes back as something else.
  const other = pub.post(2, { at: 'x', text: 'not what she wrote' }, K3);
  hub.files.set('alice/posts/2', other);
  await pub.withdraw(net, AT, K3, 2);
  await pub.rewrite(net, AT, K3);                                  // the lines for 2 are gone from this head
  await pub.amendHead(net, AT, K3, (h) => ({ ...h, entries: [...h.entries, [2, pub.address(other)]] }));
  const swapped = await Promise.all([read(net.get, { learned: G.x, at: AT, pin: rs[1].pin }), read(net.get, { learned: G.x, at: AT })]);
  hub.close();
  return { during, rs: rs.map((r) => (r.verdict === 'ok' ? `ok${r.note.some((n) => n.startsWith('withdrawn')) ? ' (withdrawn noted)' : ''}` : `${r.verdict}: ${r.why}`)), posts: rs.map((r) => r.posts?.size), swapped: swapped.map((r) => `${r.verdict}${r.why ? ': ' + r.why : ''}`) };
};
for (const rewrites of [true, false]) {
  const r = await relistScene(rewrites);
  claim(`${rewrites ? 'after his rewrite' : 'with his withdrawal lines still in the head'}: a reader pinned before ${r.rs[0]} · pinned during ${r.rs[1]} · cold ${r.rs[2]} — all three hold the three posts`, r.rs.every((v) => v === 'ok') && r.posts.every((n) => n === 3));
  claim(`  and post 2 coming back at another hash: pinned ${r.swapped[0]} · cold ${r.swapped[1]}`, r.swapped[0] === 'host: post 2 changed after the reader saw it' && r.swapped[1] === 'ok');
}
console.log('        a cold reader cannot see a swap across a rewrite — it never held the hash; a pinned reader can, and that is what a pin is');
// Within one head, the fold itself refuses a second hash for a number, for every reader.
const hub3 = await new Hub().listen(), net3 = io(hub3);
await net3.put(`${AT}/profile`, prof(2, c2, K2), null);
await pub.publish(net3, AT, K2, 1, { at: '2026-08-01', text: 'post 1' });
await pub.withdraw(net3, AT, K2, 1);
await pub.amendHead(net3, AT, K2, (h) => ({ ...h, entries: [...h.entries, [1, 'another-hash']] }));
const twoHashes = await read(net3.get, { learned: G.x, at: AT });
hub3.close();
claim(`within one head, a number re-listed at another hash: cold reader ${twoHashes.verdict}: ${twoHashes.why}`, twoHashes.why === 'the head does not fold');
claim('a host cannot do any of this: the head is signed, and only the current key signs it', (() => { const f = pub.head({ entries: [[1, 'x']], hseq: 99, top: 1 }, K2); const i = f.lastIndexOf(0x0a); try { return !crypto.verify(null, f.subarray(0, i), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: K3.x }, format: 'jwk' }), Buffer.from(f.subarray(i + 1).toString(), 'base64url')); } catch { return false; } })());

const failed = claims.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} claim(s) did not hold` : `\nall ${claims.length} claims hold`);
process.exit(failed.length ? 1 : 0);
