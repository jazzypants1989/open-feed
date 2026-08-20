// sealed-pins-gate: can pins ride INSIDE encrypted content, so per-consumer equivocation is
// detected between families while zero public bytes name who reads whom? (This is the candidate
// answer to §16.1's aggregator foreclosure — the reading graph is never published because the
// pins are never cleartext.)
// Kill criterion: detection requires a published (cleartext) pin naming an identity the carrying
// item does not already publicly address.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { seal, open, EncError } from '../../../src/enc.js';

const T = 1736899200;
function encIdentity(url) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { privateKey, document: { url, keys: [{ kid: 'enc-1', kty: 'OKP', crv: 'X25519', use: 'enc', x, iat: T }] } };
}
const famA = encIdentity('https://a.example/');   // sender (family A's hub reader)
const famB = encIdentity('https://b.example/');   // recipient (family B)

// The custodian hosts mom's log and serves each family a consistent private branch: at seq 5,
// A has observed event X and B has observed event Y. No single reader can see both.
const MOM = 'of2:9hXVQpJmGr4dTf2ay0S6c1yL8wUq3nZoBkNvE5RiAxM';
const X = 'Xx'.repeat(21) + 'X';
const Y = 'Yy'.repeat(21) + 'Y';

// A's ordinary encrypted reply to B carries A's pins for the chains B also reads — sealed.
const item = { id: 'urn:uuid:reply-1', authors: [{ url: 'https://a.example/' }] };
const envelope = seal({
  item,
  content: { content_text: 'see you sunday', pins: [{ id: MOM, seq: 5, event: X, observed: T + 5 }] },
  recipients: [famB.document],
});
const wireItem = { ...item, _openfeed: { version: 1, enc: envelope } };

// 1. ZERO public reading-graph bytes: the wire form names neither mom's identity nor either
//    branch, and carries no cleartext "pins" member at all.
const wire = JSON.stringify(wireItem);
for (const secret of [MOM, X, Y, '"pins"', 'b.example']) {
  assert.ok(!wire.includes(secret), `KILL: the wire bytes leak ${secret.slice(0, 16)}…`);
}

// 2. B opens it (carrier binding enforced by src/enc.js) and compares the sealed pin with its
//    own observation of mom's chain — a mismatch at one seq.
const plaintext = open(wireItem, { privateKeys: [famB.privateKey] });
assert.equal(plaintext.content_text, 'see you sunday');
const claim = plaintext.pins[0];
const bRecord = { id: MOM, seq: 5, event: Y };
assert.equal(claim.seq, bRecord.seq);
assert.notEqual(claim.event, bRecord.event, 'the staged equivocation vanished');

// 3. A claim is never an observation (§5.3.1 transplanted): B resolves it at the derived URL.
//    The custodian must answer that fetch with ONE byte string — and whichever branch it picks,
//    somebody now holds two verified observations of one seq.
const custodianServes = (branch) => branch; // the derived-URL fetch, answering one token id
for (const answer of [X, Y]) {
  const fetched = custodianServes(answer);
  const observations = new Set([fetched, bRecord.event, ...(fetched === claim.event ? [] : [claim.event])]);
  const twoAtOneSeq = fetched !== bRecord.event || claim.event !== bRecord.event;
  assert.ok(twoAtOneSeq, 'no divergence surfaced');
  if (fetched !== bRecord.event) {
    // B itself now holds two observations at seq 5 -> equivocation verdict, no third party.
    assert.equal(observations.has(X) && observations.has(Y), true);
  }
  // (fetched === Y): B's own record is corroborated; A's claim remains a disagreeing WITNESS,
  // which B reports back to A — A then re-runs this same resolution and reaches the verdict.
}

// 4. A non-recipient (the custodian included) gets nothing from the sealed bytes.
const custodian = encIdentity('https://mom-hub.example/');
assert.throws(() => open(wireItem, { privateKeys: [custodian.privateKey] }), EncError);

// 5. Relay/misattribution (§15.2.1): Eve re-carries the envelope under her own item — every
//    audience member's client refuses it, so sealed pins cannot be replayed under a new author.
const evesItem = { id: 'urn:uuid:eve-1', authors: [{ url: 'https://eve.example/' }], _openfeed: { version: 1, enc: envelope } };
assert.throws(() => open(evesItem, { privateKeys: [famB.privateKey] }), EncError);

console.log('sealed-pins-gate: ok');
console.log('  wire bytes: no pin member, no pinned identity, no branch id, no recipient name');
console.log('  detection: sealed pin vs own record -> derived-URL fetch -> two observations at one seq');
console.log('  custodian (non-recipient) opens nothing; relayed envelope refused by carrier binding');
