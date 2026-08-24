// Gate for tmp/prototypes/threshold.md — §4.5's k-of-n scope, run against the shipped verifier.
import {
  verifyMigration,
  verifyRecoverySignature,
  recoveryPin,
  signingPayload,
  signingInput,
  buildHeader,
  sign,
} from '../../src/index.js';
import crypto from 'node:crypto';

const T0 = 1736899200;
const DAY = 86400;
const OLD = 'https://old.example/~mom/';
const NEW = 'https://mom.example/';
const THIEF = 'https://not-mom.example/';

function makeKey(kid, use) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { crv: 'Ed25519', iat: T0 - DAY, kid, kty: 'OKP', x, ...(use ? { use } : {}) } };
}

// A detached co-signature over §6.3's co-signing bytes, by `key`, naming `identity`.
function coSign(doc, key, identity) {
  const headerB64 = Buffer.from(JSON.stringify(buildHeader(`${identity}#${key.kid}`, 'identity')), 'utf8').toString('base64url');
  const sig = crypto.sign(null, signingInput(headerB64, signingPayload(doc)), key.privateKey);
  return `${headerB64}..${Buffer.from(sig).toString('base64url')}`;
}

const root = makeKey('root-1');
const newRoot = makeKey('new-root-1');
const thiefRoot = makeKey('thief-1');

// Shape 1 (fail-open): threshold declared outside the key entries, signatures reuse _recovery_sig.
const openKeys = [makeKey('rec-a', 'recovery'), makeKey('rec-b', 'recovery'), makeKey('rec-c', 'recovery')];
const predecessorOpen = {
  url: OLD, seq: 4, updated: T0,
  keys: [root.jwk, ...openKeys.map((k) => k.jwk)],
  _recovery_threshold: 2,
};
predecessorOpen._sig = sign(predecessorOpen, root.privateKey, `${OLD}#root-1`, { kind: 'identity' });

const stolenOne = { url: THIEF, seq: 1, updated: T0 + 30 * DAY, predecessor: OLD, keys: [thiefRoot.jwk] };
stolenOne._sig = sign(stolenOne, thiefRoot.privateKey, `${THIEF}#thief-1`, { kind: 'identity' });
stolenOne._recovery_sig = coSign(stolenOne, openKeys[0], OLD);

const openResult = verifyMigration({
  predecessorDocument: predecessorOpen,
  successorDocument: stolenOne,
  pinnedAncestor: recoveryPin(predecessorOpen),
});

// Shape 2 (fail-closed): keys carry a `use` token §4.1 hides; signatures live in _recovery_sigs.
const USE = 'recovery-threshold';
const closedKeys = [makeKey('rec-a', USE), makeKey('rec-b', USE), makeKey('rec-c', USE)];
const predecessorClosed = {
  url: OLD, seq: 4, updated: T0,
  keys: [root.jwk, ...closedKeys.map((k) => k.jwk)],
  _recovery_threshold: 2,
};
predecessorClosed._sig = sign(predecessorClosed, root.privateKey, `${OLD}#root-1`, { kind: 'identity' });
const pinClosed = recoveryPin(predecessorClosed);

const stolenClosed = { url: THIEF, seq: 1, updated: T0 + 30 * DAY, predecessor: OLD, keys: [thiefRoot.jwk] };
stolenClosed._sig = sign(stolenClosed, thiefRoot.privateKey, `${THIEF}#thief-1`, { kind: 'identity' });
stolenClosed._recovery_sigs = [coSign(stolenClosed, closedKeys[0], OLD)];
const thiefClosed = verifyMigration({
  predecessorDocument: predecessorClosed, successorDocument: stolenClosed, pinnedAncestor: pinClosed,
});

const genuine = { url: NEW, seq: 1, updated: T0 + 30 * DAY, predecessor: OLD, keys: [newRoot.jwk] };
genuine._sig = sign(genuine, newRoot.privateKey, `${NEW}#new-root-1`, { kind: 'identity' });
genuine._recovery_sigs = [coSign(genuine, closedKeys[0], OLD), coSign(genuine, closedKeys[1], OLD)];
const genuineOld = verifyMigration({
  predecessorDocument: predecessorClosed, successorDocument: genuine, pinnedAncestor: pinClosed,
});

// A genuine closed-shape signature smuggled into the field an old verifier does read.
const smuggled = { url: THIEF, seq: 1, updated: T0 + 30 * DAY, predecessor: OLD, keys: [thiefRoot.jwk] };
smuggled._sig = sign(smuggled, thiefRoot.privateKey, `${THIEF}#thief-1`, { kind: 'identity' });
smuggled._recovery_sig = coSign(smuggled, closedKeys[0], OLD);
const smuggledResult = verifyMigration({
  predecessorDocument: predecessorClosed, successorDocument: smuggled, pinnedAncestor: pinClosed,
});
const smuggledCo = verifyRecoverySignature(smuggled, { pinnedAncestor: pinClosed });

// An extension-aware verifier, modelled: count distinct valid co-signers, require the threshold.
function verifyThreshold(doc, { pinnedAncestor, threshold, use }) {
  const keys = (pinnedAncestor.keys ?? []).filter((k) => k?.use === use);
  const seen = new Set();
  for (const s of Array.isArray(doc._recovery_sigs) ? doc._recovery_sigs : []) {
    for (const jwk of keys) {
      const probe = { ...doc, _recovery_sig: s };
      delete probe._recovery_sigs;
      const r = verifyRecoverySignature(probe, {
        pinnedAncestor: { ...pinnedAncestor, keys: [{ ...jwk, use: 'recovery' }] },
      });
      if (r.valid) { seen.add(jwk.kid); break; }
    }
  }
  return { valid: seen.size >= threshold, count: seen.size, threshold };
}

const newOnGenuine = verifyThreshold(genuine, { pinnedAncestor: pinClosed, threshold: 2, use: USE });
const newOnThief = verifyThreshold(stolenClosed, { pinnedAncestor: pinClosed, threshold: 2, use: USE });

const gate = [
  ['the fail-open shape is accepted by the shipped verifier (Q1 confirmed)', openResult.verified === true],
  ['a `_recovery_sigs` document is refused by the shipped verifier', genuineOld.verified === false],
  ["a thief's single signature is refused under the closed shape", thiefClosed.verified === false],
  ['smuggling a valid signature into the old field does not help', smuggledResult.verified === false],
  ['the smuggled co-signature resolves against no key at all', smuggledCo.valid === false],
  ['an extension-aware verifier accepts 2-of-3 and refuses 1-of-3',
    newOnGenuine.valid === true && newOnThief.valid === false],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('threshold: all claims hold');
