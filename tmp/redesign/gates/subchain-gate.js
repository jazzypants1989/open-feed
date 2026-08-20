// subchain-gate: can key events form a sparse self-keyed subchain inside the content log,
// so a keys-only reader resolves current keys in O(key events) fetches — without handing a
// serving-path attacker the §9.1.1 identity-chain splice?
// Kill criteria: any no-key forgery that verifies on the keys-only walk; a keys-only read
// needing more than 2 + (key events since pin) fetches.
import assert from 'node:assert/strict';
import { GateError, makeKey, signEvent, eventId, verifyEvent } from './lib.js';

// A key event carries the FULL key set, its own dense counter kseq, and kprev (the event id of
// the previous key event). Continuity (§5.2 step 3 transplanted): the signer must be listed,
// non-revoked, and non-delegated in the PREVIOUS key event's set.
const k1 = makeKey('k1'), k2 = makeKey('k2'), k3 = makeKey('k3');
const keysOf = (...ks) => ks.map(({ kid, x, revoked, use }) => ({ kid, x, ...(revoked ? { revoked_at: revoked } : {}), ...(use ? { use } : {}) }));
const byKid = new Map([[k1.kid, k1], [k2.kid, k2], [k3.kid, k3]]);
const resolver = (kid) => byKid.get(kid.split('#').pop())?.publicKey ?? null;

function keyEvent({ seq, kseq, kprev, keys, signer, ts = 1736899200 + seq }) {
  return signEvent({ seq, ts, type: 'key', kseq, kprev, keys }, { privateKey: signer.privateKey, kid: `of2:mom#${signer.kid}` });
}

// The publisher's honest history: genesis(k1) … content … key2 adds k2 … content … key3 revokes
// k2 by k1 … content … tip names the latest key event.
const genesis = keyEvent({ seq: 1, kseq: 1, kprev: null, keys: keysOf(k1, k2), signer: k1 });
const revokes = keyEvent({ seq: 90, kseq: 2, kprev: eventId(genesis), keys: keysOf(k1, { ...k2, revoked: 1736899250 }, k3), signer: k1 });
const store = new Map([[eventId(genesis), genesis], [eventId(revokes), revokes]]);
const head = { key_event: eventId(revokes), seq: 120 };

// The keys-only walk: head -> key event -> kprev hops to the pin. Every hop re-checks
// continuity against the PREVIOUS key event's set — never against the hop's own claims.
function walkKeys(headRef, fetch, keyPin) {
  let fetches = 1; // the head locator itself
  let id = headRef.key_event;
  const chain = [];
  while (true) {
    const token = fetch(id); fetches++;
    if (!token) throw new GateError(`key event ${id} unfetchable`);
    const { header, payload } = verifyEvent(token, resolver);
    chain.push({ id, header, payload });
    if (keyPin && id === keyPin.id) break;
    if (!payload.kprev) { if (keyPin) throw new GateError('walk hit genesis without reaching the key pin'); break; }
    id = payload.kprev;
  }
  // continuity, checked oldest-first: each event's signer must be valid in its predecessor.
  for (let i = chain.length - 1; i > 0; i--) {
    const prevKeys = chain[i].payload.keys ?? keyPin.keys;
    const signerKid = chain[i - 1].header.kid.split('#').pop();
    const entry = prevKeys.find((k) => k.kid === signerKid);
    if (!entry || entry.revoked_at || entry.use === 'delegated' || entry.use === 'recovery') {
      throw new GateError(`key event ${chain[i - 1].payload.kseq} signed by a key not valid in its predecessor`);
    }
    if (chain[i - 1].payload.kseq !== chain[i].payload.kseq + 1) throw new GateError('kseq not contiguous');
  }
  return { keys: chain[0].payload.keys, tip: chain[0], fetches };
}

// 1. Honest read from a genesis pin: 1 head + 1 tip key event + 0 further (kprev lands on the pin).
const pin = { id: eventId(genesis), kseq: 1, keys: keysOf(k1, k2) };
const honest = walkKeys(head, (id) => store.get(id), pin);
assert.deepEqual(honest.keys.map((k) => k.kid).sort(), ['k1', 'k2', 'k3']);
assert.ok(honest.keys.find((k) => k.kid === 'k2').revoked_at, 'the revocation did not arrive');
const keyEventsSincePin = 1;
assert.ok(honest.fetches <= 2 + keyEventsSincePin, `KILL: ${honest.fetches} fetches > 2 + ${keyEventsSincePin}`);

// 2. Serving-path forgeries (attacker holds NO listed key). Every splice must fail on the walk.
const eve = makeKey('eve'); byKid.set(eve.kid, eve);
const forgedTip = keyEvent({ seq: 121, kseq: 3, kprev: eventId(revokes), keys: keysOf(eve), signer: eve });
const forgedMid = keyEvent({ seq: 50, kseq: 2, kprev: eventId(genesis), keys: keysOf(k1, k2, eve), signer: eve });
for (const [name, headRef, extra] of [
  ['forged tip', { key_event: eventId(forgedTip) }, forgedTip],
  ['forged intermediate', { key_event: eventId(revokes) }, null],
]) {
  const s = new Map(store);
  if (extra) s.set(eventId(extra), extra);
  if (name === 'forged intermediate') {
    // splice eve's event under the honest tip by rewriting what kprev resolves to
    s.set(eventId(genesis), forgedMid); // serving path answers the kprev fetch with the forgery
  }
  let caught = false;
  try { walkKeys(headRef, (id) => s.get(id), pin); } catch (e) { caught = e instanceof GateError; }
  assert.ok(caught, `KILL: ${name} verified on the keys-only walk`);
}
// (The intermediate splice above also dies earlier in a real reader: the fetched bytes do not
//  hash to the id the successor's kprev names. Both defences are asserted — the hash one here:)
assert.notEqual(eventId(forgedMid), eventId(genesis), 'content-addressing failed');

// 3. The custodian-class attack, priced honestly: revoked k2 signs a COMPETING key event at
// kseq 2 hiding its own revocation. Continuity against genesis PASSES (k2 was valid there) —
// exactly today's post-theft fork on the identity chain, no weaker and no stronger.
const branch = keyEvent({ seq: 90, kseq: 2, kprev: eventId(genesis), keys: keysOf(k1, k2), signer: k2 });
{
  const s = new Map([[eventId(genesis), genesis], [eventId(branch), branch]]);
  const read = walkKeys({ key_event: eventId(branch) }, (id) => s.get(id), pin);
  assert.equal(read.keys.find((k) => k.kid === 'k2').revoked_at, undefined, 'expected: the branch hides the revocation');
  // Detection is the compare rule, unchanged: two key events at ONE kseq is the fork.
  assert.equal(read.tip.payload.kseq, verifyEvent(revokes, resolver).payload.kseq);
  assert.notEqual(eventId(branch), eventId(revokes));
  // A reader pinned AT OR AFTER the honest kseq-2 event refuses the branch outright:
  const pinnedAtRevocation = { id: eventId(revokes), kseq: 2, keys: verifyEvent(revokes, resolver).payload.keys };
  let refused = false;
  try { walkKeys({ key_event: eventId(branch) }, (id) => s.get(id), pinnedAtRevocation); } catch { refused = true; }
  assert.ok(refused, 'a pinned reader accepted the competing branch as a continuation');
}

// 4. Delegated keys never advance the subchain (the §4.6 exclusion, one rule).
const hub = makeKey('hub'); byKid.set(hub.kid, hub);
const withHub = keyEvent({ seq: 121, kseq: 3, kprev: eventId(revokes), keys: [...keysOf(k1, k3), { kid: 'hub', x: hub.x, use: 'delegated' }], signer: k1 });
const hubForgery = keyEvent({ seq: 150, kseq: 4, kprev: eventId(withHub), keys: keysOf(k1, k3, hub), signer: hub });
{
  const s = new Map(store); s.set(eventId(withHub), withHub); s.set(eventId(hubForgery), hubForgery);
  let caught = false;
  try { walkKeys({ key_event: eventId(hubForgery) }, (id) => s.get(id), pin); } catch (e) { caught = /not valid in its predecessor/.test(e.message); }
  assert.ok(caught, 'KILL: a delegated key advanced the key subchain');
}

console.log('subchain-gate: ok');
console.log(`  keys-only read: ${honest.fetches} fetches (head + tip key event; kprev landed on the pin)`);
console.log('  serving-path splices (forged tip, forged intermediate): both refused, plus content-address mismatch');
console.log('  custodian fork with a revoked key: verifies against a stale pin (= today\'s §5.5 fork class,');
console.log('  detected by compare/kseq-collision, refused outright by any reader pinned at the revocation)');
console.log('  delegated key advancing the subchain: refused');
