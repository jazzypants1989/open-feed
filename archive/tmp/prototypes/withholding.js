// Gate for tmp/prototypes/withholding.md — §3.2.1's `items` declaration, run against the shipped reader.
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
} from '../../src/index.js';

const DAY = 86400;
const T0 = 1736899200;
const ORIGIN = 'https://mom.example/';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const signer = {
  kid: 'key-1', privateKey,
  jwk: { kid: 'key-1', kty: 'OKP', crv: 'Ed25519', x: publicKey.export({ format: 'jwk' }).x, iat: T0 - DAY },
};

// An in-memory host: whatever is not in the map is a 404.
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

function hub({ itemUrls }) {
  const p = new Publisher({
    identity: ORIGIN, feedUrl: `${ORIGIN}feed.json`, manifestUrl: `${ORIGIN}manifest.json`,
    title: 'Mom', signer, profile: { name: 'Mom' }, now: () => T0, itemUrls,
  });
  for (let d = 0; d < 6; d++) {
    p.publishItem({ id: `urn:uuid:day-${d}`, content_text: `day ${d}` }, { at: T0 + d * DAY });
  }
  p.advanceManifest({ updated: T0 + 6 * DAY });
  return new Map(p.documents());
}

// Withhold one committed item: gone from the feed page, and gone from `/items/` if served.
function withholdOne(documents) {
  const out = new Map(documents);
  const feedUrl = `${ORIGIN}feed.json`;
  const feed = out.get(feedUrl);
  out.set(feedUrl, { ...feed, items: feed.items.slice(1) });
  out.delete(derivedItemUrl(feedUrl, documentHash(feed.items[0])));
  return out;
}

// Re-sign the identity document with `items: true` on its primary feed entry.
function declareItemUrls(documents) {
  const out = new Map(documents);
  const url = `${ORIGIN}openfeed.json`;
  const next = {
    ...out.get(url),
    feeds: out.get(url).feeds.map((f) => (f.url === `${ORIGIN}feed.json` ? { ...f, items: true } : f)),
  };
  delete next._sig;
  next._sig = sign(next, signer.privateKey, `${ORIGIN}#${signer.kid}`, { kind: 'identity' });
  out.set(url, next);
  return out;
}

async function read(documents) {
  const now = () => T0 + 7 * DAY;
  const reader = createReader({
    fetcher: host(documents),
    pins: new PinStore({ now }), observations: new ObservationStore({ now }), migrations: new MigrationStore({ now }),
    now,
  });
  return reader.read(ORIGIN);
}
const withholdingFindings = (r) => r.findings.filter((f) => f.kind === 'withheld').length;

// Q2: a declaring host serving the tree withholds one committed item.
const serving = await read(withholdOne(hub({ itemUrls: true })));

// Q1: the identical withholding from a host that genuinely declares nothing and serves no tree.
const decliningDocs = withholdOne(hub({ itemUrls: false }));
const declining = await read(decliningDocs);

// Q3: the same declining host, but its signed identity document declares `items: true`.
const declared = declareItemUrls(decliningDocs);
const caught = await read(declared);

// Q3 counterfactual: the undeclared publisher, read again by the shipped reader.
const honest = await read(decliningDocs);

// Q4: a serving-path attacker strips the declaration from the served bytes.
const idUrl = `${ORIGIN}openfeed.json`;
const idDoc = declared.get(idUrl);
const stripped = { ...idDoc, feeds: idDoc.feeds.map(({ items, ...rest }) => rest) };
let stripRejected = false;
try {
  verifyDocument(stripped, { identityDocument: idDoc, kind: 'identity' });
} catch (e) {
  stripRejected = e instanceof VerifyError;
}

const gate = [
  ['a serving, declaring host cannot hide a committed item (reported withheld)',
    serving.items.withheld.length === 1],
  ['a declining, undeclared host suppresses the verdict (absent, accusing nobody)',
    declining.items.withheld.length === 0 && declining.items.absent.length === 1],
  ['the signed declaration makes the verdict reachable against the declining host',
    withholdingFindings(caught) === 1 && caught.items.withheld.length === 1],
  ['an undeclared publisher is still read exactly as before',
    withholdingFindings(honest) === 0 && honest.items.absent.length === 1],
  ['the declaration cannot be stripped by a party that cannot sign', stripRejected],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('withholding: all claims hold');
