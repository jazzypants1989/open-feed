// Gate for tmp/prototypes/freshness.md — §9.1.2's freshness rule, run against the shipped reader.
import crypto from 'node:crypto';
import {
  Publisher,
  PinStore,
  ObservationStore,
  MigrationStore,
  createReader,
  canonicalBytes,
  normalizeIdentityUrl,
  freshness,
  FetchError,
} from '../../src/index.js';

const DAY = 86400;
const T0 = 1736899200;
const ORIGIN = 'https://mom.example/';

function makeSigner(kid = 'key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { kid, kty: 'OKP', crv: 'Ed25519', x, iat: T0 - DAY } };
}

// The reader's whole fetch surface is two methods, so a host is a Map plus those two.
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
  return { fetchDocument, fetchIdentityDocument, negativeCache: null, close: () => {} };
}

// Six days of posting, one item a day, manifest advanced each evening.
function familyHub({ nextUpdate = null, days = 6 } = {}) {
  const p = new Publisher({
    identity: ORIGIN,
    feedUrl: `${ORIGIN}feed.json`,
    manifestUrl: `${ORIGIN}manifest.json`,
    title: 'Mom',
    signer: makeSigner(),
    profile: { name: 'Mom' },
    now: () => T0,
    nextUpdate,
  });
  for (let d = 0; d < days; d++) {
    p.publishItem({ id: `urn:uuid:day-${d}`, content_text: `day ${d}` }, { at: T0 + d * DAY });
    p.advanceManifest({ updated: T0 + d * DAY + 3600 });
  }
  return p;
}

function consumer() {
  const now = () => T0;
  return { pins: new PinStore({ now }), observations: new ObservationStore({ now }), migrations: new MigrationStore({ now }) };
}

// `ceiling: Infinity` is the pre-§9.1.2 reader; the counterfactual is run, not recalled.
async function readAt(me, documents, at, { ceiling } = {}) {
  const reader = createReader({
    fetcher: host(documents),
    pins: me.pins,
    observations: me.observations,
    migrations: me.migrations,
    now: () => at,
    ...(ceiling !== undefined ? { lagCeiling: ceiling } : {}),
  });
  return reader.read(ORIGIN);
}

// Q1: the hub serves a day-6 snapshot forever; the family pinned both chains on day 6.
const hub = familyHub();
const frozen = new Map(hub.documents());
const family = consumer();
await readAt(family, frozen, T0 + 6 * DAY);
const without = await readAt(consumer(), frozen, T0 + 96 * DAY, { ceiling: Infinity });
const later = await readAt(family, frozen, T0 + 96 * DAY);
const staleFindings = later.findings.filter((f) => f.kind === 'stale');

// Q2a: withhold an item from the feed AND its §7.6 URL while the manifest still commits it.
const dropped = new Map(frozen);
const feedDoc = dropped.get(`${ORIGIN}feed.json`);
const gone = feedDoc.items[0];
dropped.set(`${ORIGIN}feed.json`, { ...feedDoc, items: feedDoc.items.slice(1) });
for (const [url, doc] of dropped) if (doc === gone) dropped.delete(url);
const droppedRead = await readAt(consumer(), dropped, T0 + 6 * DAY, { ceiling: Infinity });
const dropVerdict = droppedRead.items.withheld.length
  + droppedRead.findings.filter((f) => f.kind === 'withheld' || f.kind === 'invariant').length;

// Q2b: roll the manifest back to seq 3 against the family's seq-6 pin.
const rolled = new Map(frozen);
rolled.set(`${ORIGIN}manifest.json`, hub.manifestVersions[2]);
let rollbackCaught = false;
try {
  await readAt(family, rolled, T0 + 7 * DAY);
} catch {
  rollbackCaught = true;
}

// Q3: invariant 3 bounds uncommitted items and a frozen host serves none.
const tightRead = await readAt(consumer(), frozen, T0 + 96 * DAY, { ceiling: DAY });
const nonStaleVerdicts = tightRead.items.pending.length
  + tightRead.findings.filter((f) => f.kind !== 'stale').length;

// Q4: a hub declaring a 1-day rhythm inside the signed bytes, then freezing.
const daily = familyHub({ nextUpdate: DAY });
const declaredFrozen = new Map(daily.documents());
const day8Declared = await readAt(consumer(), declaredFrozen, T0 + 8 * DAY);
const day8Bare = await readAt(consumer(), frozen, T0 + 8 * DAY);

// Q4: an honest publisher on a declared 5-day rhythm, checked daily across its whole window.
const slowTip = familyHub({ nextUpdate: 5 * DAY }).manifest;
let falsePositives = 0;
for (let d = 0; d <= 5; d++) if (freshness(slowTip, { now: slowTip.updated + d * DAY })) falsePositives++;

// Q5: a hub declaring a TEN-YEAR rhythm, checked 30 days after its last advance.
const greedyTip = familyHub({ nextUpdate: 3650 * DAY }).manifest;
const greedy = freshness(greedyTip, { now: greedyTip.updated + 30 * DAY });

// Q6: a key custodian advances the manifest on schedule and commits nothing new.
const custodial = familyHub({ nextUpdate: DAY });
const beforeIds = Object.keys(custodial.manifest.items).length;
for (let d = 6; d < 9; d++) custodial.advanceManifest({ updated: T0 + d * DAY + 3600 });
const afterIds = Object.keys(custodial.manifest.items).length;
const punctual = await readAt(consumer(), new Map(custodial.documents()), T0 + 9 * DAY);

const gate = [
  ['without §9.1.2 (ceiling Infinity) a 90-day freeze produces no finding at all',
    without.findings.length === 0],
  ['with §9.1.2 the same frozen scene yields exactly one stale finding',
    staleFindings.length === 1 && later.feeds[0].stale !== null],
  ['the mutations are caught — drop and rollback — while the freeze alone was silent',
    dropVerdict > 0 && rollbackCaught && without.findings.length === 0],
  ["invariant 3's lag ceiling does not reach a freeze: no pending, no non-stale verdicts",
    nonStaleVerdicts === 0],
  ['a declared deadline fires on the freeze before the consumer ceiling would',
    day8Declared.feeds[0].stale !== null && day8Declared.feeds[0].stale.declared !== null && day8Bare.feeds[0].stale === null],
  ['and stays quiet inside an honest declared window',
    falsePositives === 0],
  ["a greedy ten-year declaration is capped by the consumer's own ceiling (Q5)",
    greedy !== null && greedy.deadline === greedyTip.updated + 7 * DAY],
  ['a key custodian advancing an EMPTY manifest stays punctual and evades the rule (Q6)',
    punctual.feeds[0].stale === null && punctual.findings.length === 0 && beforeIds === afterIds],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('freshness: all claims hold');
