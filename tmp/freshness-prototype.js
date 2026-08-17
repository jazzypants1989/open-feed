// Freshness: what does a conforming consumer say about a host that simply STOPS?
//
// STATUS: ADOPTED. §9.1.2 and §13 item 17 now carry this verdict, and `src/manifest.js`'s
// `freshness()` implements it. The counterfactual below is therefore measured rather than
// remembered — `lagCeiling: Infinity` switches the rule off, which is what the protocol looked
// like before this landed, and the same scene is run with it on. A prototype whose premise has
// been fixed either becomes a regression test or becomes a story; this is the first.
//
// Every attack the two chains detect is a *mutation*. Drop an item and §9.3 invariant 1 fires;
// roll back and `seq` decreases; rewrite and a hash mismatches; equivocate and §5.3.1 compares.
// There is one mutation left, and it is the null one: serve the last honest version forever.
//
// Before §9.1.2, nothing in the specification obliged a chained document to keep advancing: no
// `expires`, no `next_update`, no staleness bound anywhere, and §3.2.1's only claim on the
// subject ran the other way ("Content freshness is proven by the manifest's own signature and
// chain"). So a host that froze a member's manifest and served a consistent frozen feed passed
// every invariant, every pin check, and every signature, and the reader produced no verdict at
// all. To the reader it was indistinguishable from the member having nothing to say — which,
// for §13.2's hostile custodian, is precisely the impression they want to give the family.
//
// This is TUF's freeze/slowdown attack. It is well known, it is cheap, and the specification
// does not name it.
//
// Six questions:
//
//   Q1  Against the SHIPPED reader: freeze a chain for ninety days. What is reported?
//   Q2  Contrast — the same host mutating instead of freezing. Is "stop" uniquely silent?
//   Q3  Does §9.3 invariant 3's lag ceiling reach it? (It fires on uncommitted items; a frozen
//       host serves none.)
//   Q4  A publisher-declared deadline inside the signed bytes. Does it fire on the freeze, and
//       does it stay quiet against an honest publisher on a slow but declared cadence?
//   Q5  §9.3 rejected a *derived* bound because "a derived bound catches only a publisher
//       deviating from its rhythm, never one that simply declares a slow one." Does a
//       *declared* bound inherit that defect, or does the consumer's own ceiling cap it?
//   Q6  The honest limit. A key custodian can advance an EMPTY manifest — same items, fresh
//       `updated`. Does the bound catch that? (It must not be claimed to.)
//
// Like migration/export/inbox, this imports src/ rather than re-deriving canon and sign: the
// question is what the shipped verifier says, and a second verifier written here would be
// answering about itself.

import crypto from 'node:crypto';

import {
  Publisher,
  PinStore,
  ObservationStore,
  MigrationStore,
  createReader,
  canonicalBytes,
  normalizeIdentityUrl,
  derivedVersionUrl,
  FetchError,
} from '../src/index.js';

const DAY = 86400;
const T0 = 1736899200;
const say = (s = '') => console.log(s);

function makeSigner(kid = 'key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { kid, kty: 'OKP', crv: 'Ed25519', x: jwk.x, iat: T0 - DAY } };
}

// ---- a host that serves whatever it is told to serve -------------------------------------
//
// The reader's whole fetch surface is two methods, so a host is a Map plus those two. Nothing
// reaches the consumer except through here, which is what keeps "what could the host do?"
// honest — a scene below serves a *snapshot* of the publisher rather than the publisher, and
// that is the entire mechanism of the freeze.

function host(documents) {
  const byUrl = new Map(documents);
  async function fetchDocument(rawUrl, { budget = null } = {}) {
    const doc = byUrl.get(String(rawUrl));
    if (doc === undefined) {
      throw new FetchError(`${rawUrl} not served`, { code: 'bad_status', url: String(rawUrl), status: 404 });
    }
    const bytes = canonicalBytes(doc);
    budget?.charge(bytes.length, String(rawUrl));
    return { url: String(rawUrl), requestedUrl: String(rawUrl), redirects: 0, doc, bytes, contentType: 'application/json', cors: true };
  }
  async function fetchIdentityDocument(identityUrl, options) {
    const url = `${normalizeIdentityUrl(identityUrl)}openfeed.json`;
    return { ...(await fetchDocument(url, options)), identity: normalizeIdentityUrl(identityUrl) };
  }
  return { fetchDocument, fetchIdentityDocument, urls: byUrl, negativeCache: null, close: () => {} };
}

/** Six days of family posting, one item a day, manifest advanced each evening. */
function familyHub(origin = 'https://mom.example/', { days = 6, signer = makeSigner() } = {}) {
  const p = new Publisher({
    identity: origin,
    feedUrl: `${origin}feed.json`,
    manifestUrl: `${origin}manifest.json`,
    title: 'Mom',
    signer,
    profile: { name: 'Mom' },
    now: () => T0,
  });
  for (let d = 0; d < days; d++) {
    p.publishItem({ id: `urn:uuid:day-${d}`, content_text: `day ${d}` }, { at: T0 + d * DAY });
    p.advanceManifest({ updated: T0 + d * DAY + 3600 });
  }
  return p;
}

/**
 * Read once, at `at`, against `documents`, reusing a consumer's stores across reads.
 *
 * `rule: false` sets the consumer's ceiling to Infinity, which switches §9.1.2 off and is
 * exactly the reader this protocol had before that section existed. Every counterfactual below
 * is run rather than recalled.
 */
async function readAt(me, documents, at, { rule = true } = {}) {
  const reader = createReader({
    fetcher: host(documents),
    pins: me.pins,
    observations: me.observations,
    migrations: me.migrations,
    now: () => at,
    ...(rule ? {} : { lagCeiling: Infinity }),
  });
  return reader.read(me.origin);
}

function consumer(origin) {
  const now = () => T0;
  return {
    origin,
    pins: new PinStore({ now }),
    observations: new ObservationStore({ now }),
    migrations: new MigrationStore({ now }),
  };
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  say(`  ${ok ? 'HOLDS' : 'FAILS'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// ==========================================================================================
say('Q1  The freeze, against the shipped reader');
say('    Mom posts for six days. Her family pins both chains. Then the hub stops advancing');
say('    her manifest and serves that exact frozen view forever.');
say();

const ORIGIN = 'https://mom.example/';
const hub = familyHub(ORIGIN);
const frozen = new Map(hub.documents()); // a snapshot: the host serves these bytes forever

const family = consumer(ORIGIN);
const first = await readAt(family, frozen, T0 + 6 * DAY);
say(`  day 6   : ${first.items.live.length} live items, ${first.findings.length} findings, manifest seq ${first.manifest.manifest.seq}`);

// The protocol as it stood before §9.1.2: every other check, and no freshness rule.
const without = await readAt(consumer(ORIGIN), frozen, T0 + 96 * DAY, { rule: false });
say(`  day 96, rule OFF : ${without.items.live.length} live items, ${without.findings.length} findings, manifest seq ${without.manifest.manifest.seq}`);
say();
say('  Ninety days of silence from a host that is answering every request, and the reader');
say('  reports what it reported on day six. Every signature verifies, every invariant holds,');
say('  the pin matches. There was no verdict for this because there was no rule for it.');
check('Q1 without §9.1.2 the freeze produces no finding at all', without.findings.length === 0,
  without.findings.length ? `${without.findings.length} unexpected findings` : 'silent, as the attack requires');

const later = await readAt(family, frozen, T0 + 96 * DAY);
const freezeFindings = later.findings.filter((f) => f.kind === 'stale');
say(`  day 96, rule ON  : ${freezeFindings.length} stale finding(s)`);
for (const f of freezeFindings) say(`            ${f.kind}: ${f.message}`);
check('Q1 with §9.1.2 the same scene is reported', freezeFindings.length === 1);

// ==========================================================================================
say();
say('Q2  Is "stop" uniquely silent? The same host, mutating instead.');
say();

// (a) withhold an item: gone from the feed page AND from its §7.6 derived URL, while the
// manifest still commits it. Dropping it from the feed *alone* is not withholding and the
// reader is right to say nothing — it fetches the item at the URL its hash names and gets it,
// which is exactly the verdict §7.6 exists to make reachable.
const dropped = new Map(frozen);
const feedDoc = dropped.get(`${ORIGIN}feed.json`);
const gone = feedDoc.items[0];
dropped.set(`${ORIGIN}feed.json`, { ...feedDoc, items: feedDoc.items.slice(1) });
for (const [url, doc] of dropped) if (doc === gone) dropped.delete(url);
const droppedRead = await readAt(consumer(ORIGIN), dropped, T0 + 6 * DAY, { rule: false });
const dropVerdict = droppedRead.items.withheld.length + droppedRead.findings.filter((f) => f.kind === 'withheld' || f.kind === 'invariant').length;
say(`  drop an item  : ${dropVerdict} withheld/invariant verdicts  -> ${dropVerdict ? 'CAUGHT' : 'silent'}`);

// (b) roll the manifest back to an earlier version at the tip.
const rolled = new Map(frozen);
rolled.set(`${ORIGIN}manifest.json`, hub.manifestVersions[2]);
let rollVerdict = 'silent';
try {
  await readAt({ ...family, pins: family.pins }, rolled, T0 + 7 * DAY);
} catch (e) {
  rollVerdict = `CAUGHT (${e.constructor.name})`;
}
say(`  roll back     : ${rollVerdict}`);
say(`  freeze        : ${without.findings.length} verdicts  -> ${without.findings.length ? 'CAUGHT' : 'silent'}`);
say();
say('  Every mutation had a verdict. The null mutation did not. That asymmetry is the finding:');
say('  the chains detect *changes to the past* and said nothing about *absence of a future*,');
say('  and a host that wants to isolate someone needs only the second.');
check('Q2 mutations were caught and the freeze was not',
  dropVerdict > 0 && rollVerdict !== 'silent' && without.findings.length === 0);

// ==========================================================================================
say();
say('Q3  Does §9.3 invariant 3\'s lag ceiling reach it?');
say();
say('    Invariant 3 bounds *uncommitted* content: an item the feed serves that the manifest');
say('    has not committed becomes unverified past the ceiling. A frozen host serves no');
say('    uncommitted item — it serves nothing new at all — so there is nothing for the');
say('    ceiling to bound.');
const tight = createReader({
  fetcher: host(frozen), pins: consumer(ORIGIN).pins,
  observations: new ObservationStore({ now: () => T0 }), now: () => T0 + 96 * DAY, lagCeiling: DAY,
});
const tightRead = await tight.read(ORIGIN);
const pendingVerdicts = tightRead.items.pending.length + tightRead.findings.filter((f) => f.kind !== 'stale').length;
say(`  lagCeiling = 1 day, read 90 days into the freeze: ${tightRead.items.pending.length} pending, ${pendingVerdicts} non-freshness findings`);
say(`  (the ${tightRead.findings.filter((f) => f.kind === 'stale').length} finding it does produce is §9.1.2's, which is this file's own verdict and not invariant 3's)`);
check('Q3 the lag ceiling does not reach a freeze', pendingVerdicts === 0);

// ==========================================================================================
say();
say('Q4  A declared deadline inside the signed bytes.');
say();
say('    Model: a manifest carries `_next_update`, a Unix-seconds deadline by which its');
say('    publisher undertakes to have advanced. It is inside the signed payload, so a host');
say('    that cannot sign cannot extend it, and a pinned consumer already holds the bytes.');
say('    A consumer treats the chain as STALE once `min(declared, own ceiling)` has passed.');
say();

const CONSUMER_CEILING = 7 * DAY; // §9.3's RECOMMENDED figure, reused

/** The check a consumer would run. Returns null (fresh) or a finding. */
function freshness(manifest, at, { ceiling = CONSUMER_CEILING } = {}) {
  const declared = typeof manifest._next_update === 'number' ? manifest._next_update : null;
  // The consumer's own ceiling is the cap, not the floor: a publisher may promise to be
  // *faster* than the ceiling and be held to it, and may not promise to be slower.
  const deadline = Math.min(declared ?? manifest.updated + ceiling, manifest.updated + ceiling);
  if (at <= deadline) return null;
  return {
    kind: 'stale',
    message: `${manifest.feed_url}: manifest seq ${manifest.seq} undertook to advance by ${deadline}; it is ${at} and it has not (${Math.floor((at - deadline) / DAY)} days past)`,
  };
}

// A hub that declares a daily rhythm, then freezes.
const declaring = familyHub(ORIGIN);
const declared = new Map(declaring.documents());
const tipManifest = { ...declaring.manifest, _next_update: T0 + 6 * DAY + DAY };

say(`  frozen hub declaring a 1-day rhythm, checked on day 6 : ${freshness(tipManifest, T0 + 6 * DAY) ? 'STALE' : 'fresh'}`);
say(`                                        checked on day 8 : ${freshness(tipManifest, T0 + 8 * DAY) ? 'STALE' : 'fresh'}`);
say(`                                        checked on day 96: ${freshness(tipManifest, T0 + 96 * DAY)?.message ?? 'fresh'}`);
say();

// An honest publisher on a genuinely slow cadence, who declares it.
const slow = { ...declaring.manifest, updated: T0 + 6 * DAY, _next_update: T0 + 6 * DAY + 5 * DAY };
let falsePositives = 0;
for (let d = 0; d <= 5; d++) if (freshness(slow, T0 + 6 * DAY + d * DAY)) falsePositives++;
say(`  honest publisher declaring a 5-day rhythm, checked daily across its whole window:`);
say(`    ${falsePositives} false positives in 6 checks`);

check('Q4 the declared bound fires on the freeze',
  freshness(tipManifest, T0 + 6 * DAY) === null && freshness(tipManifest, T0 + 96 * DAY) !== null);
check('Q4 and stays quiet inside an honest declared window', falsePositives === 0);

// ==========================================================================================
say();
say('Q5  Does a declared bound inherit §9.3\'s objection to a derived one?');
say();
say('    §9.3 refused a bound derived from observed cadence because it "catches only a');
say('    publisher deviating from its rhythm, never one that simply declares a slow one."');
say('    A declared bound would inherit that defect exactly — if the consumer honored the');
say('    declaration. It does not: the declaration can only shorten the consumer\'s own');
say('    ceiling, never lengthen it.');
say();

const greedy = { ...declaring.manifest, updated: T0 + 6 * DAY, _next_update: T0 + 6 * DAY + 3650 * DAY };
const greedyAt30 = freshness(greedy, T0 + 36 * DAY);
say(`  a hub declaring a TEN-YEAR rhythm, checked 30 days later: ${greedyAt30 ? 'STALE' : 'fresh'}`);
say(`    ${greedyAt30?.message ?? ''}`);
say(`  ...because the consumer's own ${CONSUMER_CEILING / DAY}-day ceiling caps the declaration.`);
say();
say('  So the declaration buys the publisher the ability to be held to a TIGHTER promise than');
say('  the default, and buys a hostile one nothing. A first-contact consumer, which §9.3');
say('  correctly notes a derived bound gives no deadline at all, gets the ceiling — a real');
say('  deadline on the first read.');
check('Q5 a greedy declaration cannot outrun the consumer ceiling', greedyAt30 !== null);

// ==========================================================================================
say();
say('Q6  The honest limit, which must be stated and not claimed away.');
say();
say('    §13.2\'s hostile custodian HOLDS THE SIGNING KEY. It does not have to freeze; it can');
say('    advance an empty manifest — the same `items` map, a fresh `updated`, a fresh');
say('    `_next_update` — and look perfectly punctual while suppressing every new post the');
say('    member writes.');
say();

const custodial = familyHub(ORIGIN);
const beforeIds = Object.keys(custodial.manifest.items).length;
// The member writes three more posts. The hub keeps advancing — and commits none of them.
for (let d = 6; d < 9; d++) {
  custodial.advanceManifest({ updated: T0 + d * DAY + 3600 });
}
const afterIds = Object.keys(custodial.manifest.items).length;
const punctual = { ...custodial.manifest, _next_update: T0 + 9 * DAY };
say(`  hub advances seq ${custodial.manifest.seq} on schedule, live set unchanged: ${beforeIds} -> ${afterIds} items`);
say(`  freshness check on day 9: ${freshness(punctual, T0 + 9 * DAY) ? 'STALE' : 'fresh'}`);
say();
say('  Fresh. The bound is satisfied and nothing was published. So the declared deadline');
say('  closes the freeze against a SERVING-PATH attacker and against a merely passive host,');
say('  and does not close it against a key custodian — who was never going to be stopped by');
say('  a rule about timestamps they sign themselves. What reaches that adversary is the');
say('  member\'s own record of what they published (§5.2 step 5) and other readers\' pins');
say('  (§16.1), which is where §13.2 already says the teeth are.');
say();
say('  This has to go in the text beside the rule. A freshness bound described as "closes the');
say('  freeze attack" would be the third overclaim this review found.');
check('Q6 a key custodian evades the bound by advancing an empty manifest',
  freshness(punctual, T0 + 9 * DAY) === null && beforeIds === afterIds);

// ==========================================================================================
say();
say('Cost');
const withField = canonicalBytes(tipManifest).length;
const bare = canonicalBytes(declaring.manifest).length;
say(`  manifest with \`_next_update\`: ${withField} bytes; without: ${bare} bytes; delta ${withField - bare}`);
say(`  Retained forever, per version. Against §13.4's 1 MB manifest ceiling that is ${((withField - bare) / 1_000_000 * 100).toFixed(4)}%.`);

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
  ADD a publisher-declared freshness deadline to the manifest, inside the signed bytes,
  capped by the consumer's own ceiling.

  What it buys, precisely, because the precision is the point:

    * It gives the null mutation a verdict. Today "the host stopped answering for you" and
      "you had nothing to say" are the same observation to every conforming reader (Q1), and
      every other attack on the chain has a name (Q2).
    * It is not reachable through §9.3 invariant 3, which bounds uncommitted items and a
      frozen host serves none (Q3).
    * It does not inherit §9.3's objection to a *derived* bound, because the declaration can
      only tighten the consumer's ceiling and never loosen it (Q5) — and it hands a
      first-contact consumer a deadline, which §9.3 notes a derived bound cannot.
    * It costs ${withField - bare} bytes per manifest version.

  What it does NOT buy, to be stated beside the rule rather than discovered later:

    * Nothing against a key custodian, who advances an empty manifest and stays punctual
      (Q6). The freshness bound is a defence against a host that cannot sign, or one that
      is not trying. §13.2's terminal adversary is neither.
    * The verdict is STALE — unverified, the pin held and not advanced — and never
      equivocation. An honest publisher on holiday trips it, and must not be convicted by it.

  The consumer ceiling should be the same ${CONSUMER_CEILING / DAY}-day figure §9.3 already
  RECOMMENDS, so this adds a rule and not a second number.
`);
