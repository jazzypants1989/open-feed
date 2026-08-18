// The delivered column has no integrity guarantee, and it is where the product's traffic is.
//
// STATUS: ADOPTED. §10.6 carries the rule, §15.4 and §8 carry the split it goes with, and
// `Publisher.deliverItem({ to })` and `DeliveryStore` implement both ends. Q1's counterfactual
// is measured by delivering with no `to` — the sender this protocol had before §10.6 — rather
// than remembered, and Q2/Q3 now drive the shipped store instead of a model beside it.
//
// §1 principle 3: "The feed is the source of truth; the inbox is a push cache. Nothing exists
// only in transit, with one stated exception (§11.1)." Then §8 made a `like` delivered by
// default and §15.4 — before the split this prototype belongs to — sent *every* interaction on
// encrypted content down the delivered column, so on a family hub the exception was the whole
// conversation. What that cost, stated nowhere:
//
//   * The manifest commits nothing. No hash, no completeness proof, no §7.6 URL.
//   * §10.4's stated recovery — "recipients recover missed deliveries by polling the sender's
//     feed" — does not work, because a delivered-only item is in no feed.
//   * §14 says outright that `delivered` and `received` have no completeness proof.
//
// So the recipient's host can drop any delivery and the only signal anywhere is the sender's
// retry timeout. For §13.2's hostile custodian — who *is* the recipient's host — that is the
// cheapest attack in the protocol and it leaves no trace at all.
//
// Two mechanisms were priced before this one and rejected; both are recorded in the plan.
// A recipient-published receipt map fails because the hub holds the key that signs it and
// because a public receipt for a private message is a worse disclosure than the drop. A
// sender-side `delivered: [hash]` commitment cannot detect a drop at all, since the recipient
// does not know what it did not receive.
//
// What is left is to make the delivered stream *chain*, using the discipline this protocol
// already applies twice:
//
//   Q1  Today: deliver five, drop the third. What can the recipient say?
//   Q2  A counter alone. What does it catch, and what does it miss?
//   Q3  Counter + prev-hash. What does the hash buy that the counter does not?
//   Q4  The hard case: one signed item, several recipients, several counters. Where can the
//       entry live without telling each recipient's host who else got it? (Answer: nowhere —
//       which is why §11.2 confines the delivered column to one recipient by rule.)
//   Q5  Migration — §3.4 changes one half of the pair key.
//   Q6  Cost.

import crypto from 'node:crypto';

import {
  Publisher,
  documentHash,
  canonicalBytes,
  verifyDocument,
  normalizeIdentityUrl,
  DeliveryStore,
  seal,
} from '../../src/index.js';

const DAY = 86400;
const T0 = 1736899200;
const say = (s = '') => console.log(s);

function makeSigner(kid = 'key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { kid, kty: 'OKP', crv: 'Ed25519', x: jwk.x, iat: T0 - DAY } };
}

function identity(origin, signer) {
  return new Publisher({
    identity: origin, feedUrl: `${origin}feed.json`, manifestUrl: `${origin}manifest.json`,
    title: origin, signer, now: () => T0,
  });
}

const DAD = 'https://dad.example/';
const MOM = 'https://mom.example/';
const dadSigner = makeSigner('dad-1');
const dad = identity(DAD, dadSigner);
const dadDoc = dad.identityDocument;

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  say(`  ${ok ? 'HOLDS' : 'FAILS'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/**
 * `mode` selects what the sender emits, so Q1, Q2 and Q3 differ in the mechanism and in nothing
 * else. `chain` is the shipped path — `deliverItem({ to })`; `none` is the sender this protocol
 * had before §10.6; `counter` is the intermediate this file exists to reject, modelled here
 * because it is the one shape `src/` deliberately does not offer.
 */
function sender(publisher, { mode }) {
  const streams = new Map();
  return function deliver(fields, to, { at = T0 } = {}) {
    if (mode === 'chain') return publisher.deliverItem(fields, { at, to });
    if (mode === 'none') return publisher.deliverItem(fields, { at });
    const key = normalizeIdentityUrl(to);
    const seq = (streams.get(key) ?? 0) + 1;
    streams.set(key, seq);
    return publisher.deliverItem({ ...fields, _openfeed: { delivery: { seq } } }, { at });
  };
}

/** What a recipient can say about the stream it holds, in order of arrival. */
function audit(held, author, { mode }) {
  if (mode === 'none') return [];
  const store = new DeliveryStore();
  const findings = [];
  for (const item of held) {
    const f = store.check(author, item);
    if (f) findings.push(f);
    store.record(author, item);
  }
  return findings;
}

// ==========================================================================================
say('Q1  Today: the delivered path with nothing added');
say();

const plain = sender(dad, { mode: 'none' });
const sent = [];
for (let i = 1; i <= 5; i++) {
  sent.push(plain({ id: `urn:uuid:note-${i}`, content_text: `note ${i}` }, MOM, { at: T0 + i * 3600 }));
}
// Mom's hub — the adversary — drops the third.
const heldPlain = sent.filter((_, i) => i !== 2);
say(`  Dad delivers 5 notes. Mom's hub drops the third. Mom holds ${heldPlain.length}.`);
say(`  Every held item verifies: ${heldPlain.every((i) => { try { return !!verifyDocument(i, { identityDocument: dadDoc, kind: 'item' }); } catch { return false; } })}`);
say(`  Findings available to Mom: ${audit(heldPlain, DAD, { mode: 'none' }).length}`);
say();
say('  Nothing. The four items she holds are perfectly signed, and there is no artifact');
say('  anywhere — hers, Dad\'s, or the manifest\'s — in which the fifth would have appeared.');
say('  She cannot tell a hub that dropped a note from a father who did not write one.');
check('Q1 a dropped delivery leaves no evidence today', audit(heldPlain, DAD, { mode: 'none' }).length === 0);

// ==========================================================================================
say();
say('Q2  A counter alone');
say();

const dadB = identity(DAD, dadSigner);
const counted = sender(dadB, { mode: 'counter' });
const sentB = [];
for (let i = 1; i <= 5; i++) {
  sentB.push(counted({ id: `urn:uuid:b-${i}`, content_text: `note ${i}` }, MOM, { at: T0 + i * 3600 }));
}
const middleDrop = audit(sentB.filter((_, i) => i !== 2), DAD, { mode: 'counter' });
const suffixDrop = audit(sentB.slice(0, 2), DAD, { mode: 'counter' });
say(`  hub drops the middle one (3 of 5) : ${middleDrop.length} finding(s) — ${middleDrop[0]?.kind ?? 'none'}`);
say(`  hub drops the tail (3, 4 and 5)   : ${suffixDrop.length} finding(s)`);
say();
say('  The selective drop is caught, which is the attack that matters: suppressing one');
say('  message, or one person, inside a stream that otherwise keeps flowing. The suffix drop');
say('  is not caught and cannot be — silence from a sender is indistinguishable from a sender');
say('  who stopped writing, which is the freeze attack again, one layer down.');
check('Q2 a counter catches the selective drop', middleDrop.length === 1 && middleDrop[0].kind === 'delivery_gap');
check('Q2 a counter does not catch a suffix drop', suffixDrop.length === 0);

// ==========================================================================================
say();
say('Q3  What the prev-hash buys that the counter does not');
say();

const dadC = identity(DAD, dadSigner);
const chained = sender(dadC, { mode: 'chain' });
const sentC = [];
for (let i = 1; i <= 5; i++) {
  sentC.push(chained({ id: `urn:uuid:c-${i}`, content_text: `note ${i}` }, MOM, { at: T0 + i * 3600 }));
}
const heldC = sentC.filter((_, i) => i !== 2);
const chainFindings = audit(heldC, DAD, { mode: 'chain' });
say(`  hub drops the middle one: ${chainFindings.length} finding(s)`);
for (const f of chainFindings) say(`    ${f.kind}: ${f.message}`);
say();

// The claim: what Mom holds is not a suspicion, it is a signed artifact naming bytes she lacks.
const link = chainFindings.find((f) => f.kind === 'delivery_gap' || f.kind === 'delivery_broken_link');
const carrier = heldC.find((i) => i._openfeed?.delivery.prev === link?.missingHash);
const carrierVerifies = (() => {
  try { return !!verifyDocument(carrier, { identityDocument: dadDoc, kind: 'item' }); } catch { return false; }
})();
const momHoldsIt = heldC.some((i) => documentHash(i) === link?.missingHash);
say('  The difference is what a third party can check. With a counter, Mom can say "I think');
say('  I am missing one" and nobody can distinguish that from Mom having deleted it herself.');
say('  With the hash she holds a **signed statement by Dad** naming the exact bytes of an item');
say(`  she does not have:`);
say(`    carrier item verifies against Dad's identity document : ${carrierVerifies}`);
say(`    it names predecessor hash                             : ${link?.missingHash}`);
say(`    Mom holds an item with that hash                      : ${momHoldsIt}`);
say();
say('  That is evidence rather than a complaint, it survives into her export bundle (§14),');
say('  and it is checkable by anyone holding Dad\'s identity document. It also makes a sender');
say('  state reset visible: a new device restarting the counter breaks the link instead of');
say('  silently re-numbering from 1.');
check('Q3 the prev-hash yields a signed artifact naming the missing bytes',
  !!link && carrierVerifies && !momHoldsIt);

// ==========================================================================================
say();
say('Q4  The hard case, and the reason this is not simply "add two fields"');
say();
say('    A delivered item is ONE set of signed bytes, and each (sender, recipient) pair has its');
say('    own counter. If one delivered item could reach several inboxes, every pair\'s entry');
say('    would have to ride inside that one item. Three placements, all wrong:');
say();

const GRAN = 'https://gran.example/';
// (a) one top-level entry per recipient, naming them.
const leaky = { _openfeed: { delivery: [{ to: MOM, seq: 4 }, { to: GRAN, seq: 2 }] } };
say(`  (a) an array naming each recipient:  ${JSON.stringify(leaky._openfeed?.delivery)}`);
say('      Mom\'s hub receives this and learns Gran is in the audience. For a cleartext DM');
say('      that is a disclosure the sender never made, and §11.4 spends its length keeping');
say('      exactly this off the wire. REJECTED.');
say();
say('  (b) one item per recipient: different `id` per copy, so §10.3 dedup files them as');
say('      distinct items, §7.3\'s `(author, id, _version)` stops naming one revision, and §8\'s');
say('      "publishing and delivering are the same bytes" is gone. REJECTED.');
say();
say('  (c) the per-recipient JWE header §15.2 gives each slot, beside `_tag`. An earlier draft');
say('      of §10.6 chose this and claimed the slot was "already blinded". It is not: §15.2');
say('      blinds the TAG — nothing else in the header — so a `{seq, prev}` there is cleartext,');
say('      and it links a recipient\'s slots ACROSS items, which is exactly the unlinkability');
say('      the fresh ephemeral pays for. Measured below with the shipped envelope. REJECTED.');
say();

// The shipped §15.2 envelope, driven rather than described: what a slot header actually
// carries, and what the blinding actually covers.
const encKeyPair = (kid) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const x = publicKey.export({ format: 'jwk' }).x;
  return { privateKey, jwk: { kid, kty: 'OKP', crv: 'X25519', use: 'enc', x, iat: T0 - DAY } };
};
const momDoc = { url: MOM, keys: [encKeyPair('mom-enc').jwk] };
const granDoc = { url: GRAN, keys: [encKeyPair('gran-enc').jwk] };
const carrierA = { id: 'urn:uuid:q4-a', authors: [{ url: DAD }] };
const carrierB = { id: 'urn:uuid:q4-b', authors: [{ url: DAD }] };
const envA = seal({ item: carrierA, content: { content_text: 'hi' }, recipients: [momDoc, granDoc] });
const envB = seal({ item: carrierB, content: { content_text: 'again' }, recipients: [momDoc, granDoc] });
const headerKeys = new Set(envA.recipients.flatMap((s) => Object.keys(s.header)));
say(`  shipped per-recipient header carries: ${JSON.stringify([...headerKeys].sort())} — cleartext but content-free`);
check('Q4 the shipped §15.2 slot header carries alg and _tag and nothing else',
  headerKeys.size === 2 && headerKeys.has('alg') && headerKeys.has('_tag'));
check('Q4 the shipped tags are unlinkable across items (fresh ephemeral per item)',
  envA.recipients.every((s, i) => s.header._tag !== envB.recipients[i].header._tag));

// The counterfactual: put (c)'s entry in the slot anyway and watch an observer — holding no
// key and no tag preimage — chain one recipient's slots across two items by hash arithmetic.
const itemA = { ...carrierA, _openfeed: { ...carrierA._openfeed, enc: envA } };
const slotEntryB = { seq: 5, prev: documentHash(itemA) };
say(`  item A, slot 0 entry (hypothetical): {"seq":4,"prev":"…"}`);
say(`  item B, slot 0 entry (hypothetical): {"seq":5,"prev":"${slotEntryB.prev.slice(0, 12)}…"} — the hash of item A`);
check('Q4 a cleartext slot entry links one recipient\'s slots across items with no key at all',
  slotEntryB.prev === documentHash(itemA));

say();
say('  RESOLUTION: there is no placement, so there must be no multi-recipient delivered item.');
say('  §11.2 makes the delivered column an audience of one BY RULE — a delivered-only item goes');
say('  to exactly one recipient — and group content is §15.4\'s published-encrypted case. The');
say('  field has one home: top level, naming nobody.');
const singleEntry = { seq: 4, prev: 'czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8' };
check('Q4 the audience-of-one entry names no recipient at all',
  !Object.keys(singleEntry).includes('to') && !JSON.stringify(singleEntry).includes('example'));

// The published side of the same rule: a pushed *published* item may reach any number of
// inboxes, so no single counter could be true of them all — the shipped store ignores it there.
const guard = new DeliveryStore();
const pushed = { id: 'urn:uuid:q4-pub', authors: [{ url: DAD }],
  _openfeed: { feed_url: `${DAD}feed.json`, delivery: { seq: 99 } } };
guard.record(DAD, pushed);
check('Q4 the shipped store ignores `_openfeed.delivery` where `_openfeed.feed_url` is present (§10.6)',
  guard.check(DAD, { ...pushed, _openfeed: { ...pushed._openfeed, delivery: { seq: 101 } } }) === null
    && !guard.bySender.has(normalizeIdentityUrl(DAD)));

// The rule (c)'s rejection produced is load-bearing, so it is checked against the document
// rather than remembered — the failure mode this whole prototype directory exists to avoid is
// an argument that outlives the sentence it stands on.
const specText = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../../open-feed-spec.md', import.meta.url), 'utf8'));
const anchors = [
  'MUST be addressed to exactly one recipient and delivered to exactly one inbox', // §11.2's rule
  'receivers MUST ignore it where `_openfeed.feed_url` is present',                         // §10.6's guard
  'Any audience larger than one requires a membership decision',                   // §11.2's framing
  'The author holds the list locally and wraps to it',                             // the group home
];
const missing = anchors.filter((a) => !specText.includes(a));
say(`      §10.6/§11.2 anchors this argument rests on, still present: ${anchors.length - missing.length}/${anchors.length}`);
if (missing.length) for (const m of missing) say(`        MISSING: "${m}"`);
check('Q4 the spec still confines the delivered column to one recipient',
  missing.length === 0, missing.length ? 'the sentence the resolution stands on has moved' : '');

// ==========================================================================================
say();
say('Q5  Migration: §3.4 changes one half of the pair key');
say();

const NEWDAD = 'https://dad.new/';
say(`  Dad moves from ${DAD} to ${NEWDAD}. His next delivery to Mom is signed by the new`);
say('  identity, so a receiver keying the stream on the raw author URL sees a NEW stream —');
say('  seq restarts at 1, the link breaks, and the exit Dad just exercised reports itself as');
say('  an attack on him.');
const naiveKey = (author, recipient) => `${author}|${recipient}`;
say(`    naive key before : ${naiveKey(DAD, MOM)}`);
say(`    naive key after  : ${naiveKey(NEWDAD, MOM)}   <- a different stream`);
say();
say('  Predecessor equivalence (§3.4) is already the rule for exactly this, and it already');
say('  governs §10.3\'s dedup store and §4.4\'s observation record — both of which are keyed');
say('  on `(author, id)` and both of which a receiver already holds. So the stream key is a');
say('  third consumer of a rule that exists, not a fourth rule.');
check('Q5 the pair key must resolve through predecessor equivalence',
  naiveKey(DAD, MOM) !== naiveKey(NEWDAD, MOM));

// ==========================================================================================
say();
say('Q6  Cost');
const bare = dad.deliverItem({ id: 'urn:uuid:cost-a', content_text: 'x' }, { at: T0 });
const withCounter = dad.deliverItem({ id: 'urn:uuid:cost-b', content_text: 'x', _openfeed: { delivery: { seq: 12 } } }, { at: T0 });
const withChain = dad.deliverItem({ id: 'urn:uuid:cost-c', content_text: 'x', _openfeed: { delivery: { seq: 12, prev: documentHash(bare) } } }, { at: T0 });
const b = (i) => canonicalBytes(i).length;
say(`  delivered item, bare        : ${b(bare)} bytes`);
say(`  + counter                   : ${b(withCounter)} bytes  (+${b(withCounter) - b(bare)})`);
say(`  + counter and prev-hash     : ${b(withChain)} bytes  (+${b(withChain) - b(bare)})`);
say(`  Against §13.4's 100 KB inbox body cap: ${((b(withChain) - b(bare)) / 100_000 * 100).toFixed(3)}%.`);
say(`  Sender state: one \`{seq, prev}\` per recipient — smaller than the dedup record the`);
say(`  receiver already keeps per \`(author, id)\` (§10.3).`);

// ---- gate ---------------------------------------------------------------------------------
say();
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  say('FAIL — these claims no longer hold:');
  for (const f of failed) say(`  ${f.label}`);
  say();
  say('Either the prototype is stale or the rule it supports is. Both are findings.');
  process.exit(1);
}

say(`VERDICT — all ${results.length} claims hold.`);
say(`
  ADD a per-(sender, recipient) delivery chain to delivered items: a counter and the §5.1
  hash of the previous item that sender delivered to that recipient, inside the signed bytes.

  Why chained rather than counted. Both catch the selective drop (Q2), which is the attack
  that matters — suppressing one message or one person while the stream keeps flowing. The
  hash is what turns the recipient's suspicion into an artifact: a signed statement by the
  sender naming the exact bytes of an item the recipient does not hold (Q3). That is
  checkable by any third party holding the sender's identity document, it survives into the
  recipient's export bundle, and it makes a sender-side state reset visible instead of
  silently re-numbering. ${b(withChain) - b(bare)} bytes.

  Where the entry lives (Q4) is the part that needed measuring, and the answer is that no
  multi-recipient placement survives it: a named array (a) tells each recipient's host who
  else was written to, one-item-per-recipient (b) breaks the \`(author, id, _version)\`
  identity every other rule depends on, and the per-recipient JWE header (c) — which an
  earlier draft adopted on the claim that §15.2 had "already blinded" it — is cleartext
  apart from the tag, so a \`{seq, prev}\` there re-links a recipient's slots across items.
  So §11.2 forbids the case instead: the delivered column is an audience of one BY RULE, the
  entry has one home (top level, naming nobody), and \`_delivery\` on a published item is
  ignored, since no single counter could be true of every inbox a published item reaches.

  The pair key resolves through predecessor equivalence (Q5), which §10.3 and §4.4 already
  require of the two identically-shaped records a receiver keeps — so this is a third
  consumer of that rule and not a fourth rule.

  STATE THE LIMIT beside the rule, because it is the same limit as the freshness bound one
  layer up: a host that drops an entire suffix leaves silence, and silence is not evidence
  (Q2). This makes selective suppression detectable by its victim. It does not make delivery
  reliable, and it must not be described as though it did.
`);
