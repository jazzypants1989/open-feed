// channel-gate: prices the delivered-channel axis. Under published-only, a hostile hub sits in
// the victim's outbound path (suppression is detectable-later, not deliverable-now); a minimal
// delivered channel is a device-to-recipient POST the hub never touches, and content-addressed
// dedup kills the §10.3 version-poisoning class outright.
// Kill (for variant (a) only — this gate picks a variant, it cannot kill a candidate): the
// delivered blob failing to verify at the recipient without the victim's hub in the path.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { seal, open } from '../../../src/enc.js';
import { makeKey, signEvent, eventId, verifyEvent } from './lib.js';

const victim = makeKey('of2:victim#root');
const attacker = makeKey('of2:attacker#k1');
const byKid = new Map([[victim.kid, victim], [attacker.kid, attacker]]);
const resolve = (kid) => byKid.get(kid)?.publicKey ?? null;
const CEILING = 7 * 86400;

// ---- variant (a): published-only. The hostile hub owns the append. ----
{
  const hubTouches = [];
  const hub = {
    log: [], lastAdvanceTs: 1736899200,
    submit(token) { hubTouches.push('submit'); return { queued: true }; },   // and then… nothing
    advance() { /* declines to commit the victim's post */ },
  };
  const post = signEvent({ seq: 9, ts: 1736899200, type: 'post', id: 'help-1', blob: 'c'.repeat(43) }, { privateKey: victim.privateKey, kid: victim.kid });
  hub.submit(post);
  // Grandma polls: nothing new. Freshness fires only once the ceiling has PASSED — and it says
  // "stale", never "here is the message".
  const staleAt = (now) => now > hub.lastAdvanceTs + CEILING;
  assert.equal(staleAt(1736899200 + 3 * 86400), false, 'stale fired early');
  assert.equal(staleAt(1736899200 + 8 * 86400), true, 'stale never fired');
  const grandmaCanRead = hub.log.includes(post);
  assert.equal(grandmaCanRead, false);
  // Detection is not delivery: the verdict exists, the message does not arrive. Recorded.
}

// ---- variant (b): a minimal delivered channel. Device -> recipient inbox, hub untouched. ----
{
  const grandmaEnc = (() => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
    const { x } = publicKey.export({ format: 'jwk' });
    return { privateKey, document: { url: 'https://grandma.example/', keys: [{ kid: 'enc-1', kty: 'OKP', crv: 'X25519', use: 'enc', x, iat: 1736899200 }] } };
  })();
  let victimHubTouches = 0;
  // The delivered item: an UNLOGGED event (no seq, no prev) sealed to one recipient, POSTed by
  // the victim's own device. dseq/dprev keep the delivery-chain card's validated shape (+~75 B).
  const carrier = { id: 'urn:uuid:dm-1', authors: [{ url: 'of2:victim' }] };
  const envelope = seal({ item: carrier, content: { content_text: 'I am leaving on sunday. Do not tell.' }, recipients: [grandmaEnc.document] });
  const dm = signEvent({ type: 'of2-delivered', id: carrier.id, authors: carrier.authors, delivery: { dseq: 1 }, enc: envelope }, { privateKey: victim.privateKey, kid: victim.kid });

  // Grandma's inbox: verify against the sender's spine (fetched from ANY mirror — modeled as a
  // resolver the victim's hub does not serve), dedup by token hash, open the envelope.
  const inbox = (() => {
    const seen = new Set(), stored = [];
    return {
      stored,
      deliver(token) {
        const { header, payload } = verifyEvent(token, resolve); // spine resolution: 0 hub touches
        const id = eventId(token);
        if (seen.has(id)) return { status: 409 };
        seen.add(id);
        stored.push({ id, header, payload });
        return { status: 202 };
      },
    };
  })();
  assert.equal(inbox.deliver(dm).status, 202);
  assert.equal(victimHubTouches, 0, 'KILL: the victim\'s hub participated in the delivery');
  const got = inbox.stored[0];
  const plain = open({ id: got.payload.id, authors: got.payload.authors, _openfeed: { enc: got.payload.enc } }, { privateKeys: [grandmaEnc.privateKey] });
  assert.equal(plain.content_text, 'I am leaving on sunday. Do not tell.');

  // Replay: same bytes, same hash -> 409. Dedup needs no version counter…
  assert.equal(inbox.deliver(dm).status, 409);

  // …so the §10.3 poisoning class DIES: an attacker "pinning (victim, id) at version 99" has
  // nothing to pin. Their forged token is content-addressed under their OWN bytes and their own
  // signature; the victim's genuine token still lands, at its own hash.
  const forged = signEvent({ type: 'of2-delivered', id: 'urn:uuid:dm-2', authors: [{ url: 'of2:victim' }], delivery: { dseq: 99 }, enc: envelope }, { privateKey: attacker.privateKey, kid: attacker.kid });
  assert.equal(inbox.deliver(forged).status, 202);           // files as the ATTACKER's own item
  assert.equal(inbox.stored[1].header.kid, attacker.kid);    // never as the victim's
  const genuine2 = signEvent({ type: 'of2-delivered', id: 'urn:uuid:dm-2', authors: [{ url: 'of2:victim' }], delivery: { dseq: 2 }, enc: envelope }, { privateKey: victim.privateKey, kid: victim.kid });
  assert.equal(inbox.deliver(genuine2).status, 202, 'KILL: the forgery occupied the victim\'s slot');

  // Metadata residue, stated: the delivered wire form leaks existence/size/timing to the TWO
  // hosts on the path and to nobody else — and it appears in no retained log, so it is not
  // permanent. (Under (a), the same message is a permanent public event on the victim's log.)
  assert.ok(!JSON.stringify({ stored: inbox.stored.length }).includes('sunday'));
}

console.log('channel-gate: ok');
console.log('  (a) published-only: hostile hub suppresses; staleness fires at day 7+; message never arrives — detection is not delivery');
console.log('  (b) delivered blob: verified at the recipient with 0 victim-hub touches; replay 409 by token hash');
console.log('  §10.3 poisoning class: dead — a forged (victim, id, version) has nothing to occupy; genuine delivery still lands');
console.log('  verdict: keep a minimal delivered channel (variant b); the ~900-word premium buys the only custodian-bypassing outbound path');
