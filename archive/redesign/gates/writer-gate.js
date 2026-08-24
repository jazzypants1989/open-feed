// writer-gate: one log means one writer — can CAS-append serialize racing devices, and does
// the offline + delegated-hub corner have a path that needs no re-signing?
// Kill criteria: any interleaving that serves a fork without producing the equivocation alarm;
// an offline/delegated corner with no publish path.
import assert from 'node:assert/strict';
import { makeKey, signEvent, eventId, verifyEvent } from './lib.js';

const root = makeKey('of2:mom#root');     // the member's device key
const hub = makeKey('of2:mom#hub');       // the hub's delegated key
const byKid = new Map([[root.kid, root], [hub.kid, hub]]);
const resolve = (kid) => byKid.get(kid)?.publicKey ?? null;

// The serving layout has ONE writer surface: the tip. Appends are compare-and-swap against the
// tip's event id (HTTP: If-Match on the tip locator). A CAS store refuses a stale prev.
function casStore() {
  const events = new Map();
  let tip = null;
  return {
    tip: () => tip,
    events,
    append(token) {
      const { payload } = verifyEvent(token, resolve);
      if ((payload.prev ?? null) !== (tip ?? null)) return { ok: false, conflict: true, tip };
      events.set(eventId(token), token);
      tip = eventId(token);
      return { ok: true, tip };
    },
  };
}
// A NAIVE store (no CAS) — what a fork looks like when nothing serializes.
function naiveStore() {
  const bySeq = new Map();
  return {
    bySeq,
    append(token) {
      const { payload } = verifyEvent(token, resolve);
      const at = bySeq.get(payload.seq) ?? [];
      at.push(token);
      bySeq.set(payload.seq, at);
      return { ok: true };
    },
  };
}

const post = (seq, prev, id, signer) =>
  signEvent({ seq, ts: 1736899200 + seq, ...(prev ? { prev } : {}), type: 'post', id, blob: 'b'.repeat(43) }, { privateKey: signer.privateKey, kid: signer.kid });

// 1. Two devices race on one tip. Loser rebases and re-signs; the store never holds a fork.
{
  const store = casStore();
  assert.equal(store.append(post(1, null, 'p1', root)).ok, true);
  const tip = store.tip();
  const a = post(2, tip, 'phone', root);   // phone, read tip T
  const b = post(2, tip, 'laptop', root);  // laptop, read the same tip T
  assert.equal(store.append(a).ok, true);
  const lost = store.append(b);
  assert.equal(lost.ok, false, 'KILL: the second writer landed on a spent tip');
  // The losing device rebases: same content, new seq/prev, re-signed — it holds its own key.
  const rebased = post(3, store.tip(), 'laptop', root);
  assert.equal(store.append(rebased).ok, true);
  // No two events share a seq anywhere in the store:
  const seqs = [...store.events.values()].map((t) => verifyEvent(t, resolve).payload.seq);
  assert.equal(new Set(seqs).size, seqs.length, 'KILL: the CAS store holds a fork');
}

// 2. Without CAS the same race IS a fork — and the reader's compare rule fires on it.
{
  const store = naiveStore();
  store.append(post(1, null, 'p1', root));
  const tip = eventId(post(1, null, 'p1', root)); // both devices believe this is the tip
  store.append(post(2, tip, 'phone', root));
  store.append(post(2, tip, 'laptop', root));
  const atTwo = store.bySeq.get(2);
  assert.equal(atTwo.length, 2);
  assert.notEqual(eventId(atTwo[0]), eventId(atTwo[1]));
  // Two observations of one seq with different ids = the §5.3.1 verdict, unchanged in kind.
  const equivocation = eventId(atTwo[0]) !== eventId(atTwo[1]);
  assert.ok(equivocation, 'the fork was not even visible');
}

// 3. The offline + delegated-hub corner, resolved WITHOUT re-signing: authorship lives in the
// BLOB (member-signed), ordering in the ENTRY (hub-signed, delegated). The member composes
// offline; the hub commits on reconnect; nobody re-signs anything.
{
  const store = casStore();
  assert.equal(store.append(post(1, null, 'seed', hub)).ok, true);
  // Offline: the member's device signs the content blob. No seq, no prev — it is not an event.
  const blobToken = signEvent({ type: 'of2-blob', id: 'urn:uuid:offline-1', content_text: 'written on a plane' }, { privateKey: root.privateKey, kid: root.kid });
  // Reconnect: the hub, holding only the delegated key, commits an entry NAMING the blob.
  const entry = signEvent({ seq: 2, ts: 1736899300, prev: store.tip(), type: 'post', id: 'urn:uuid:offline-1', blob: eventId(blobToken) }, { privateKey: hub.privateKey, kid: hub.kid });
  assert.equal(store.append(entry).ok, true);
  // A reader verifies both signatures independently: ordering by the hub, words by the member.
  const e = verifyEvent(entry, resolve);
  const b = verifyEvent(blobToken, resolve);
  assert.equal(e.header.kid, hub.kid);
  assert.equal(b.header.kid, root.kid);
  assert.equal(e.payload.blob, eventId(blobToken), 'the entry does not commit the member\'s bytes');
}

// 4. The window is real but bounded: N writers, one tip, every append lands exactly once.
{
  const store = casStore();
  store.append(post(1, null, 'p1', root));
  let landed = 1, retries = 0;
  const writers = ['a', 'b', 'c', 'd', 'e'];
  for (const w of writers) {
    for (;;) {
      const attempt = post(landed + 1, store.tip(), `item-${w}`, root);
      const r = store.append(attempt);
      if (r.ok) { landed++; break; }
      retries++;
      assert.ok(retries < 100, 'livelock');
    }
  }
  assert.equal(landed, 1 + writers.length);
}

console.log('writer-gate: ok');
console.log('  CAS store: racing writers serialized, loser rebases with its own key, no fork held');
console.log('  naive store: the same race is a fork, visible to the compare rule (two ids, one seq)');
console.log('  offline member + delegated hub: blob signed by member, entry by hub — no re-sign path needed');
console.log('  5 writers, one tip: every append landed exactly once (retries bounded)');
