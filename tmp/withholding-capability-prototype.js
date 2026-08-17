// §7.6 and the withholding verdict: does the mechanism reach the adversary it was built for?
//
// §9.3's withholding state is the one pull-path attack the manifest exists to detect — "the
// consumer knows an exact revision exists, knows its hash, and cannot obtain the bytes." §12
// makes §7.6 a Level 2 MUST specifically to make that verdict reachable, because a paginated
// reader learning an item is "not in the page I hold" has evidence of nothing.
//
// Then §7.6 says: "Producers MUST serve it; consumers MUST NOT require it." And §9.3 says that
// against a publisher who declines, "a consumer that cannot obtain an item reports it as not yet
// seen: the safe reading, the one that accuses nobody."
//
// A hostile host reads those two sentences and declines. It is then non-conformant at Level 2 in
// a way no consumer is permitted to notice, and indistinguishable from a static host that has
// never heard of §7.6. The Level 2 MUST, the reserved path namespace, and the whole hash-vs-id
// design argument buy a verdict the adversary switches off for free.
//
// `tmp/itemurls-prototype.js` measured the case where the publisher SERVES §7.6 and refuses three
// items. That is the cooperative case and its verdict stands. Nobody has measured the adversary.
//
//   Q1  Hostile host, no `/items/` tree, withholding an item. What is reported?
//   Q2  The same withholding from a host that does serve the tree. (The contrast.)
//   Q3  A declared capability, in the signed identity document. Does the verdict come back?
//   Q4  Can the host take the declaration back quietly?
//   Q5  Cost.

import crypto from 'node:crypto';

import {
  Publisher,
  PinStore,
  ObservationStore,
  MigrationStore,
  createReader,
  canonicalBytes,
  documentHash,
  normalizeIdentityUrl,
  derivedItemUrl,
  sign,
  verifyDocument,
  FetchError,
  VerifyError,
} from '../src/index.js';

const DAY = 86400;
const T0 = 1736899200;
const ORIGIN = 'https://mom.example/';
const say = (s = '') => console.log(s);

function makeSigner(kid = 'key-1') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { kid, kty: 'OKP', crv: 'Ed25519', x: jwk.x, iat: T0 - DAY } };
}

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

const signer = makeSigner();

function hub({ itemUrls }) {
  const p = new Publisher({
    identity: ORIGIN,
    feedUrl: `${ORIGIN}feed.json`,
    manifestUrl: `${ORIGIN}manifest.json`,
    title: 'Mom', signer, profile: { name: 'Mom' }, now: () => T0, itemUrls,
  });
  for (let d = 0; d < 6; d++) {
    p.publishItem({ id: `urn:uuid:day-${d}`, content_text: `day ${d}` }, { at: T0 + d * DAY });
  }
  p.advanceManifest({ updated: T0 + 6 * DAY });
  return p;
}

/** Withhold one committed item: gone from the feed page, and gone from `/items/` if served. */
function withholdOne(documents, feedUrl) {
  const out = new Map(documents);
  const feed = out.get(feedUrl);
  const victim = feed.items[0];
  out.set(feedUrl, { ...feed, items: feed.items.slice(1) });
  out.delete(derivedItemUrl(feedUrl, documentHash(victim)));
  return { documents: out, victim };
}

async function read(documents, { at = T0 + 7 * DAY } = {}) {
  const now = () => at;
  const reader = createReader({
    fetcher: host(documents),
    pins: new PinStore({ now }), observations: new ObservationStore({ now }), migrations: new MigrationStore({ now }),
    now,
  });
  return reader.read(ORIGIN);
}

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok });
  say(`  ${ok ? 'HOLDS' : 'FAILS'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

// ==========================================================================================
say('Q1  A hostile host that simply declines §7.6');
say();

const declining = hub({ itemUrls: false });
const q1 = withholdOne(new Map(declining.documents()), `${ORIGIN}feed.json`);
const q1read = await read(q1.documents);
say(`  serves: identity, feed, manifest. No /items/ tree at all.`);
say(`  withholds ${q1.victim.id}, which its own manifest still commits.`);
say(`  reader says: ${q1read.items.withheld.length} withheld, ${q1read.items.absent.length} absent, ${q1read.findings.filter((f) => f.kind === 'withheld').length} withholding findings`);
say(`  absent reason: ${q1read.items.absent[0]?.reason ?? '(none)'}`);
say();
say('  "Not yet seen." The consumer holds the hash of a revision it was refused, and the');
say('  rule tells it to accuse nobody. That is the correct reading of §9.3 as written, and');
say('  it is the adversary\'s preferred outcome.');
check('Q1 a declining host suppresses the withholding verdict entirely',
  q1read.items.withheld.length === 0 && q1read.items.absent.length === 1);

// ==========================================================================================
say();
say('Q2  The contrast: the same withholding, from a host that serves the tree');
say();

const serving = hub({ itemUrls: true });
const q2 = withholdOne(new Map(serving.documents()), `${ORIGIN}feed.json`);
const q2read = await read(q2.documents);
say(`  reader says: ${q2read.items.withheld.length} withheld, ${q2read.items.absent.length} absent`);
say(`  withheld reason: ${q2read.items.withheld[0]?.reason ?? '(none)'}`);
say();
say('  So the verdict works exactly when the publisher cooperates with it, and the whole of');
say('  the difference between Q1 and Q2 is one directory the host chose not to serve.');
check('Q2 a serving host cannot hide the same withholding', q2read.items.withheld.length === 1);

// ==========================================================================================
say();
say('Q3  A declared capability, inside the signed identity document');
say();
say('    Model: a `feeds` entry carries `items: true`, meaning "this feed serves §7.6 URLs."');
say('    It is a producer\'s own signed statement about its own conformance. A consumer that');
say('    finds the declaration and cannot obtain the tree has been told, by the publisher, to');
say('    expect what it did not get — which is the definition of withholding and needs no new');
say('    verdict, only a way to reach the one that already exists.');
say();

/** Re-sign the identity document with `items: true` on its primary feed entry. */
function declareItemUrls(documents) {
  const out = new Map(documents);
  const url = `${ORIGIN}openfeed.json`;
  const doc = out.get(url);
  const next = {
    ...doc,
    feeds: doc.feeds.map((f) => (f.url === `${ORIGIN}feed.json` ? { ...f, items: true } : f)),
  };
  delete next._sig;
  next._sig = sign(next, signer.privateKey, `${ORIGIN}#${signer.kid}`);
  out.set(url, next);
  return out;
}

// The consumer half: with a declaration in hand, a control probe that fails is the finding.
// `probeItems` already refuses to accuse when a control item cannot be fetched; the declaration
// is what turns that refusal into evidence rather than into silence.
async function readWithDeclaration(documents) {
  const result = await read(documents);
  const entry = result.identity.document.feeds.find((f) => f.url === result.entry.url);
  if (entry?.items !== true) return result;
  const committed = Object.keys(result.manifest.manifest.items);
  const control = committed[committed.length - 1];
  const hash = result.manifest.manifest.items[control][1];
  let served = true;
  try {
    await host(documents).fetchDocument(derivedItemUrl(result.entry.url, hash));
  } catch { served = false; }
  if (served) return result;
  return {
    ...result,
    findings: [...result.findings, {
      kind: 'withheld',
      message: `${result.entry.url}: the identity document declares §7.6 item URLs for this feed and none are served; ${result.items.absent.length} committed revision(s) this reader could not obtain are withheld, not merely unseen`,
    }],
  };
}

const q3read = await readWithDeclaration(declareItemUrls(q1.documents));
const q3findings = q3read.findings.filter((f) => f.kind === 'withheld');
say(`  same declining host, now declaring \`items: true\`: ${q3findings.length} withholding finding(s)`);
say(`    ${q3findings[0]?.message ?? '(none)'}`);
say();
const q3honest = await readWithDeclaration(q1.documents);
say(`  a publisher that never declares (the static host, the pre-rule publisher): ${q3honest.findings.filter((f) => f.kind === 'withheld').length} findings`);
say('  — read exactly as before, accusing nobody. The asymmetry §7.6 wanted is preserved;');
say('  what changes is that declining is now a thing a publisher does rather than a thing');
say('  a consumer cannot distinguish from silence.');
check('Q3 the declaration makes the verdict reachable against the adversary', q3findings.length === 1);
check('Q3 and an undeclared publisher is still read as before', q3honest.findings.filter((f) => f.kind === 'withheld').length === 0);

// ==========================================================================================
say();
say('Q4  Can the host take the declaration back quietly?');
say();

const declared = declareItemUrls(q1.documents);
const tampered = new Map(declared);
const idDoc = tampered.get(`${ORIGIN}openfeed.json`);
tampered.set(`${ORIGIN}openfeed.json`, {
  ...idDoc,
  feeds: idDoc.feeds.map((f) => { const { items, ...rest } = f; return rest; }),
});
let stripVerdict = 'accepted — the declaration is strippable';
try {
  verifyDocument(tampered.get(`${ORIGIN}openfeed.json`), {
    identityDocument: idDoc, kind: 'document',
  });
} catch (e) {
  stripVerdict = e instanceof VerifyError ? 'REJECTED (signature)' : `REJECTED (${e.constructor.name})`;
}
say(`  serving-path attacker deletes \`items: true\` from the served bytes: ${stripVerdict}`);
say();
say('  A key custodian can of course publish a new identity-chain version without it. That is');
say('  the point rather than a hole: withdrawing the declaration costs an identity-chain');
say('  advance, which is a signed, retained, pinned event every reader walks past (§5.3). The');
say('  capability is not made unrevocable — it is made *revocable only on the record*, which');
say('  is the same move §4.6 makes for a delegation and §9 makes for a deletion.');
check('Q4 the declaration cannot be stripped by a party that cannot sign', stripVerdict.startsWith('REJECTED'));

// ==========================================================================================
say();
say('Q5  Cost');
const before = canonicalBytes(q1.documents.get(`${ORIGIN}openfeed.json`)).length;
const after = canonicalBytes(declared.get(`${ORIGIN}openfeed.json`)).length;
say(`  identity document: ${before} -> ${after} bytes (+${after - before} per declaring feed entry)`);
say(`  Paid once per feed, on a chain §3.2.1 says runs 5-20 versions over a lifetime.`);

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
  ADD a signed per-feed declaration that this feed serves §7.6 item URLs, and let a consumer
  that finds one treat an unobtainable committed revision as WITHHELD rather than absent.

  The case for it is that §7.6 currently fails open against the only adversary it was built
  for. A host that serves a manifest and no \`/items/\` tree suppresses the verdict entirely
  (Q1), while the identical withholding from a serving host is caught (Q2) — so the whole
  mechanism turns on a choice the attacker makes. §7.6's "consumers MUST NOT require it" is
  right and must stay: a static host and a pre-rule publisher have to remain readable. What
  was missing is any way for a publisher to say which of those it is.

  The declaration says it, and says it where it cannot be walked back off the record (Q4):
  inside the signed identity document, so a serving-path attacker cannot strip it and a
  custodian can only withdraw it by advancing the identity chain in front of every pinned
  reader. An undeclared publisher is read exactly as today (Q3), so nothing that reads now
  stops reading.

  ${after - before} bytes, once per feed, on the short chain.

  One thing this does NOT do, worth stating in §9.3 beside the rule: it does not make
  withholding *impossible*, and a host that never declares still cannot be accused. It moves
  the verdict from unreachable-against-an-adversary to reachable-unless-the-publisher-never
  -claimed-conformance — and that second thing is itself a signal a reader can show a user.
`);
