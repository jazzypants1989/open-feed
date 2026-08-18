// Gate for tmp/prototypes/delivery-chain.md — §10.6's delivery chain, run against the shipped sender and store.
import {
  Publisher,
  DeliveryStore,
  documentHash,
  verifyDocument,
  normalizeIdentityUrl,
  seal,
} from '../../src/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const T0 = 1736899200;
const DAY = 86400;
const DAD = 'https://dad.example/';
const NEWDAD = 'https://dad.new/';
const MOM = 'https://mom.example/';
const GRAN = 'https://gran.example/';

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { kid, kty: 'OKP', crv: 'Ed25519', x, iat: T0 - DAY } };
}

function identity(origin, signer, options = {}) {
  return new Publisher({
    identity: origin, feedUrl: `${origin}feed.json`, manifestUrl: `${origin}manifest.json`,
    title: origin, signer, now: () => T0, ...options,
  });
}

const dadSigner = makeSigner('dad-1');
const dadDoc = identity(DAD, dadSigner).identityDocument;

function verifies(item, identityDocument = dadDoc) {
  try { return !!verifyDocument(item, { identityDocument, kind: 'item' }); } catch { return false; }
}

// Run a stream of (author, item) pairs through the shipped store in arrival order.
function audit(pairs, options = {}) {
  const store = new DeliveryStore(options);
  const findings = [];
  for (const [author, item] of pairs) {
    const f = store.check(author, item);
    if (f) findings.push(f);
    store.record(author, item);
  }
  return findings;
}

// Q1 counterfactual: the sender this protocol had before §10.6 — deliverItem with no `to`.
const dadA = identity(DAD, dadSigner);
const plain = [1, 2, 3, 4, 5].map((i) =>
  dadA.deliverItem({ id: `urn:uuid:p-${i}`, content_text: `note ${i}` }, { at: T0 + i * 3600 }));
const heldPlain = plain.filter((_, i) => i !== 2);
const plainFindings = audit(heldPlain.map((item) => [DAD, item]));

// Q2: a counter alone — the intermediate shape src/ deliberately does not offer, supplied by hand.
const dadB = identity(DAD, dadSigner);
const counted = [1, 2, 3, 4, 5].map((i) =>
  dadB.deliverItem({ id: `urn:uuid:b-${i}`, content_text: `note ${i}`, _openfeed: { delivery: { seq: i } } }, { at: T0 + i * 3600 }));
const middleDrop = audit(counted.filter((_, i) => i !== 2).map((item) => [DAD, item]));
const suffixDrop = audit(counted.slice(0, 2).map((item) => [DAD, item]));

// Q3: the shipped path — deliverItem({ to }) — with the middle delivery dropped by the hub.
const dadC = identity(DAD, dadSigner);
const chained = [1, 2, 3, 4, 5].map((i) =>
  dadC.deliverItem({ id: `urn:uuid:c-${i}`, content_text: `note ${i}` }, { at: T0 + i * 3600, to: MOM }));
const heldC = chained.filter((_, i) => i !== 2);
const chainFindings = audit(heldC.map((item) => [DAD, item]));
const link = chainFindings.find((f) => f.kind === 'delivery_gap' || f.kind === 'delivery_broken_link');
const carrier = heldC.find((i) => i._openfeed?.delivery.prev === link?.missingHash);
const momHoldsIt = heldC.some((i) => documentHash(i) === link?.missingHash);

// Q4: the shipped §15.2 envelope — what a per-recipient slot header actually carries.
const encKey = (kid) => {
  const { publicKey } = crypto.generateKeyPairSync('x25519');
  return { kid, kty: 'OKP', crv: 'X25519', use: 'enc', x: publicKey.export({ format: 'jwk' }).x, iat: T0 - DAY };
};
const momDoc = { url: MOM, keys: [encKey('mom-enc')] };
const granDoc = { url: GRAN, keys: [encKey('gran-enc')] };
const carrierA = { id: 'urn:uuid:q4-a', authors: [{ url: DAD }] };
const envA = seal({ item: carrierA, content: { content_text: 'hi' }, recipients: [momDoc, granDoc] });
const envB = seal({ item: { id: 'urn:uuid:q4-b', authors: [{ url: DAD }] }, content: { content_text: 'again' }, recipients: [momDoc, granDoc] });
const headerKeys = new Set(envA.recipients.flatMap((s) => Object.keys(s.header)));

// The rejected placement (c): a `{seq, prev}` in that cleartext slot, chained by a keyless observer.
const itemA = { ...carrierA, _openfeed: { enc: envA } };
const observerPrev = documentHash(itemA);

// The shipped entry itself: top level, naming nobody.
const shippedEntry = chained[3]._openfeed.delivery;

// The published side of §11.2's rule: the shipped store refuses to run a counter over a feed item.
const guard = new DeliveryStore();
const pushed = { id: 'urn:uuid:q4-pub', authors: [{ url: DAD }],
  _openfeed: { feed_url: `${DAD}feed.json`, delivery: { seq: 99 } } };
guard.record(DAD, pushed);
const guardFinding = guard.check(DAD, { ...pushed, _openfeed: { ...pushed._openfeed, delivery: { seq: 101 } } });

// The sentences the Q4 resolution stands on, checked against the document rather than remembered.
const specText = fs.readFileSync(new URL('../../open-feed-spec.md', import.meta.url), 'utf8');
const anchors = [
  'MUST be addressed to exactly one recipient and delivered to exactly one inbox', // §11.2's rule
  'receivers MUST ignore it where `_openfeed.feed_url` is present',                // §10.6's guard
  'Any audience larger than one requires a membership decision',                   // §11.2's framing
  'The author holds the list locally and wraps to it',                             // the group home
];
const missingAnchors = anchors.filter((a) => !specText.includes(a));

// Q5: §3.4 changes one half of the pair key — both shipped ends, with and without equivalence.
const N = normalizeIdentityUrl;
const equivalent = (a, b) => N(a) === N(b) || ([N(a), N(b)].every((u) => u === N(DAD) || u === N(NEWDAD)));
const dadOld = identity(DAD, dadSigner);
const m1 = dadOld.deliverItem({ id: 'urn:uuid:m-1', content_text: 'x' }, { at: T0, to: MOM });
const m2 = dadOld.deliverItem({ id: 'urn:uuid:m-2', content_text: 'x' }, { at: T0 + 3600, to: MOM });
const dadNew = identity(NEWDAD, makeSigner('dad-2'), { equivalent });
dadNew.deliveries = new Map(dadOld.deliveries);
const m3 = dadNew.deliverItem({ id: 'urn:uuid:m-3', content_text: 'x' }, { at: T0 + 7200, to: MOM });
const stream = [[DAD, m1], [DAD, m2], [NEWDAD, m3]];
const withEquiv = audit(stream, { equivalent });
const withoutEquiv = audit(stream);

const gate = [
  ['Q1 with no `to`, the shipped sender emits no delivery field at all',
    plain.every((i) => i._openfeed?.delivery === undefined)],
  ['Q1 a dropped delivery leaves no evidence today — held items verify, zero findings',
    heldPlain.every((i) => verifies(i)) && plainFindings.length === 0],
  ['Q2 a counter alone catches the selective drop',
    middleDrop.length === 1 && middleDrop[0].kind === 'delivery_gap'],
  ['Q2 a counter alone does not catch a suffix drop', suffixDrop.length === 0],
  ['Q3 the shipped chain reports the middle drop as a gap naming a hash',
    !!link && link.kind === 'delivery_gap' && typeof link.missingHash === 'string'],
  ['Q3 the prev-hash yields a signed artifact naming bytes the recipient lacks',
    !!carrier && verifies(carrier) && !momHoldsIt],
  ['Q4 the shipped §15.2 slot header carries alg and _tag and nothing else',
    headerKeys.size === 2 && headerKeys.has('alg') && headerKeys.has('_tag')],
  ['Q4 the shipped tags are unlinkable across items (fresh ephemeral per item)',
    envA.recipients.every((s, i) => s.header._tag !== envB.recipients[i].header._tag)],
  ['Q4 a cleartext slot entry links one recipient across items with no key at all',
    observerPrev === documentHash(itemA)],
  ['Q4 the shipped audience-of-one entry names no recipient at all',
    Object.keys(shippedEntry).every((k) => k === 'seq' || k === 'prev')
      && !JSON.stringify(shippedEntry).includes('example')],
  ['Q4 the shipped store ignores `_openfeed.delivery` where `_openfeed.feed_url` is present (§10.6)',
    guardFinding === null && !guard.bySender.has(N(DAD))],
  ['Q4 the spec still confines the delivered column to one recipient',
    missingAnchors.length === 0],
  ['Q5 a migrated sender continues one stream — seq 3 linking the predecessor item',
    m3._openfeed?.delivery.seq === 3 && m3._openfeed?.delivery.prev === documentHash(m2)],
  ['Q5 the pair key resolves through predecessor equivalence, or the exit reads as an attack',
    withEquiv.length === 0 && withoutEquiv.length === 1 && withoutEquiv[0].kind === 'delivery_gap'],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
for (const a of missingAnchors) console.log(`        missing spec sentence: "${a}"`);
if (failed.length) process.exit(1);
console.log('delivery-chain: all claims hold');
