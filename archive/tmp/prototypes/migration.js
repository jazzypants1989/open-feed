// Gate for tmp/prototypes/migration.md — §3.4's exit composed from the shipped mechanisms.
import {
  Publisher,
  verifyRecoverySignature,
  resolveFork,
  assertRelocationCarriesForward,
  InvariantViolation,
  recoveryPin,
  verifyDocument,
} from '../../src/index.js';
import crypto from 'node:crypto';

const T0 = 1736899200;
const HUB = 'https://mom.hub.example/';
const OWN = 'https://mom.example/';
const EVE = 'https://mom-archive.example/';

let clock = T0;
const tick = (s = 3600) => (clock += s);
const now = () => clock;

function makeSigner(kid, use) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { crv: 'Ed25519', iat: T0 - 86400, kid, kty: 'OKP', x, ...(use ? { use } : {}) } };
}

// The hub holds Mom's root signing key; her recovery key is committed at genesis, held offline.
const recovery = makeSigner('recovery-1', 'recovery');
const hub = new Publisher({
  identity: HUB, title: "Mom's Journal", signer: makeSigner('hub-1'),
  profile: { name: 'Mom' }, recoveryKeys: [recovery.jwk], now,
});
const IDS = ['urn:uuid:0001-cookies', 'urn:uuid:0002-garden', 'urn:uuid:0003-birthday'];
for (const id of IDS) {
  tick();
  hub.publishItem({ id, content_text: `entry ${id}` });
  hub.advanceManifest({ updated: tick() });
}

// §4.5's pin of the predecessor: (url, seq, hash) plus the keys committed there.
const pinned = recoveryPin(hub.identityDocument);
const oldManifest = hub.manifest;
const held = new Map(Object.entries(oldManifest.items).map(([id, [, hash]]) => [id, hash]));

// The relocation: fresh signing key, same recovery key, back catalog carried byte-verbatim (§3.4).
tick();
const own = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: makeSigner('own-1'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now,
});
for (const [id, item] of hub.items) own.items.set(id, item);
own.advanceManifest({ updated: tick() });

let intact = 0;
for (const [id, hash] of held) if (own.manifest.items[id]?.[1] === hash) intact++;
const carried = assertRelocationCarriesForward(oldManifest, own.manifest, {
  fromUrl: `${HUB}manifest.json`, toUrl: `${OWN}manifest.json`,
});

// A dishonest relocation: a successor genesis manifest that quietly drops one id.
tick();
const partial = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: makeSigner('own-2'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now,
});
for (const [id, item] of hub.items) if (id !== IDS[0]) partial.items.set(id, item);
partial.advanceManifest({ updated: tick() });
let dropVerdict = null;
try {
  assertRelocationCarriesForward(oldManifest, partial.manifest, {
    fromUrl: `${HUB}manifest.json`, toUrl: `${OWN}manifest.json`,
  });
  dropVerdict = 'ACCEPTED';
} catch (e) {
  dropVerdict = e instanceof InvariantViolation && e.invariant === 5 ? 'invariant 5' : `wrong error: ${e.message}`;
}

// §3.4 path 3: the hub declines, so the genesis carries a recovery co-signature; kid names HUB.
const ownGenesis = own.coSignIdentity(recovery, { kidIdentity: HUB });
const momClaim = verifyRecoverySignature(ownGenesis, { pinnedAncestor: pinned });

// The other reading — a kid naming the document making the claim.
tick();
const selfNaming = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: makeSigner('own-3'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now,
});
const selfClaim = verifyRecoverySignature(
  selfNaming.coSignIdentity(recovery, { kidIdentity: OWN }), { pinnedAncestor: pinned },
);

// The competing migration: a stolen recovery key minting a second successor at Eve's URL.
tick();
const eve = new Publisher({
  identity: EVE, title: "Mom's Journal", signer: makeSigner('eve-1'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now,
});
const eveGenesis = eve.coSignIdentity(recovery, { kidIdentity: HUB });
const eveClaim = verifyRecoverySignature(eveGenesis, { pinnedAncestor: pinned });
const fork = resolveFork([ownGenesis, eveGenesis], { pinnedAncestor: pinned });

// §6.3's asymmetry: `_sig` covers `_recovery_sig`, so a keyless strip breaks the document.
let intactVerdict = 'ACCEPTED';
try { verifyDocument(ownGenesis, { identityDocument: ownGenesis, kind: 'identity' }); }
catch (e) { intactVerdict = `REJECTED — ${e.message}`; }
const stripped = { ...ownGenesis };
delete stripped._recovery_sig;
let stripVerdict = 'ACCEPTED';
try { verifyDocument(stripped, { identityDocument: ownGenesis, kind: 'identity' }); }
catch { stripVerdict = 'REJECTED'; }

const gate = [
  ['every hash held from the predecessor survives the byte-verbatim move', intact === IDS.length],
  ['§9.3 invariant 5 carries every id across the relocation', carried.carried === IDS.length && carried.firstContact === false],
  ['a successor manifest that drops one id trips invariant 5', dropVerdict === 'invariant 5'],
  ['a recovery migration verifies against a host that declines', momClaim.valid === true && momClaim.signer === recovery.kid],
  ['a kid naming the successor is refused — the key resolves in the pin, never the claim', selfClaim.valid === false],
  ['a stolen recovery key mints a competing claim that verifies exactly as well', eveClaim.valid === true],
  ['resolveFork refuses both: the recovery key is itself in question',
    fork.resolved === false && /in question/.test(fork.reason)],
  ['`_sig` covers `_recovery_sig`, so stripping the co-signature breaks the document',
    intactVerdict === 'ACCEPTED' && stripVerdict === 'REJECTED'],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('migration: all claims hold');
