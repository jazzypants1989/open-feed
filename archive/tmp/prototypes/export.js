// Gate for tmp/prototypes/export.md — §14's bundle as an exit, run against the shipped code.
import {
  Publisher,
  PinStore,
  walkToPin,
  identityChainPolicy,
  manifestChainPolicy,
  assertHistoryInvariants,
  reconcileFeed,
  verifyRecoverySignature,
  buildBundle,
  documentHash,
  canonicalBytes,
} from '../../src/index.js';
import crypto from 'node:crypto';

const T0 = 1736899200;
const DAY = 86400;
const HUB = 'https://mom.hub.example/';
const OWN = 'https://mom.example/';

let clock = T0;
const tick = (s = 3600) => (clock += s);
const now = () => clock;

function makeSigner(kid, use) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { crv: 'Ed25519', iat: T0 - DAY, kid, kty: 'OKP', x, ...(use ? { use } : {}) } };
}

const hubSigner = makeSigner('hub-1');
const recovery = makeSigner('recovery-1', 'recovery');
const mom = new Publisher({
  identity: HUB, title: "Mom's Journal", signer: hubSigner,
  profile: { name: 'Mom' }, recoveryKeys: [recovery.jwk], now,
});

// An extension field with no column anywhere — §7.2 makes it a signature dependency.
mom.publishItem({ id: 'urn:uuid:0001-cookies', content_text: 'We made cookies.', _ai_assisted: true }, { at: tick() });
mom.advanceManifest({ updated: tick() });
mom.publishItem({ id: 'urn:uuid:0002-garden', content_text: 'Tomatoes finally in.' }, { at: tick() });
mom.publishItem({ id: 'urn:uuid:0003-typo', content_text: 'Wrong on purpose.' }, { at: tick() });
mom.tombstone('urn:uuid:0003-typo', { at: tick() });
mom.advanceManifest({ updated: tick() });
mom.advanceIdentity({ bio: 'Grandmother, gardener.' }, { updated: tick() });

const bundle = buildBundle({
  identity: mom.identityDocument,
  identityHistory: mom.identityVersions,
  feeds: [{ feed: mom.feed, manifest: mom.manifest, manifestHistory: mom.manifestVersions }],
  exportedAt: tick(),
});

// The whole restorer: shipped chain/manifest verification, with an array standing in for the net.
async function restore(bundle) {
  const fromBundle = (versions) => async (_url, seq) => versions.find((v) => v.seq === seq);
  const withTip = (history, tip) => (history.some((v) => v.seq === tip.seq) ? history : [...history, tip]);
  const pins = new PinStore({ now });
  const chains = [];
  let items = null;

  const identityUrl = `${bundle.url}openfeed.json`;
  const identityVersions = withTip(bundle.identity.history, bundle.identity.current);
  await walkToPin({
    url: identityUrl, tip: bundle.identity.current,
    pin: { seq: 1, hash: documentHash(identityVersions[0]) },
    fetchVersion: fromBundle(identityVersions), policy: identityChainPolicy, pins,
  });
  chains.push(identityVersions.length);

  for (const entry of bundle.feeds) {
    const manifestUrl = `${bundle.url}manifest.json`;
    const versions = withTip(entry.manifest_history, entry.manifest);
    await walkToPin({
      url: manifestUrl, tip: entry.manifest,
      pin: { seq: 1, hash: documentHash(versions[0]) },
      fetchVersion: fromBundle(versions), policy: manifestChainPolicy(bundle.identity.current, { now }), pins,
    });
    assertHistoryInvariants(versions, { url: manifestUrl });
    items = reconcileFeed(entry.manifest, entry.feed.items, { url: manifestUrl, now: now(), partial: false });
    chains.push(versions.length);
  }
  return { chains, items };
}

const report = await restore(bundle);
const count = (r, s) => r.items.states.filter((x) => x.state === s).length;

// The round trip §14 warns about: serialize, parse, verify again from the bytes on disk.
const reloaded = JSON.parse(Buffer.from(JSON.stringify(bundle), 'utf8').toString('utf8'));
const afterTrip = await restore(reloaded);
const tripped = reloaded.feeds[0].feed.items.find((i) => i.id === 'urn:uuid:0001-cookies');
const original = mom.items.get('urn:uuid:0001-cookies');

// E1: exit to an owned domain — back catalog byte-verbatim, genesis co-signed by the recovery key.
const own = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: makeSigner('own-1'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now,
});
for (const [id, item] of mom.items) own.items.set(id, item);
own.advanceManifest({ updated: tick() });
const migrated = own.coSignIdentity(recovery, { kidIdentity: HUB });

// The co-signature against what the successor's bundle holds vs the predecessor's chain (§4.5).
const withoutAncestor = verifyRecoverySignature(migrated, {
  pinnedAncestor: { url: OWN, seq: 1, keys: migrated.keys },
});
const withAncestor = verifyRecoverySignature(migrated, { pinnedAncestor: mom.identityDocument });

const gate = [
  ['a bundle verifies with no bundle-specific verifier and no network',
    report.items.violations.length === 0 && count(report, 'live') === 2 && count(report, 'deleted') === 1],
  ['both chains walk from genesis out of the bundle alone', report.chains.length === 2],
  ['the bundle survives a serialize/parse round trip byte-verbatim',
    afterTrip.items.violations.length === 0 && tripped._ai_assisted === true
    && canonicalBytes(tripped).equals(canonicalBytes(original))],
  ["a successor's own keys cannot verify its own recovery co-signature (E1)", withoutAncestor.valid === false],
  ["the predecessor's retained chain can (E1)", withAncestor.valid === true],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('export: all claims hold');
