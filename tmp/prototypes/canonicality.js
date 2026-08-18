// Gate for tmp/prototypes/canonicality.md — §6.3's wire rule, run against the shipped canon.
import {
  canonicalBytes,
  assertCanonicalBytes,
  parseIJSON,
  documentHash,
  sha256,
  b64u,
  Publisher,
  CanonicalError,
} from '../../src/index.js';
import crypto from 'node:crypto';

const T0 = 1736899200;
let clock = T0;
const now = () => clock;

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: T0 - 86400, kid, kty: 'OKP', x }, privateKey };
}

const ID = 'https://mom.pence.family/';

// Two identity versions, so there is both a tip and a retained copy of seq 1.
const mom = new Publisher({
  identity: ID, title: "Mom's Journal", signer: makeSigner('key-1'), profile: { name: 'Mom' }, now,
});
clock += 3600;
mom.advanceIdentity({ bio: 'Gardener.' });
const [v1, v2] = mom.identityVersions;
const canonV1 = canonicalBytes(v1);

// Regime B's tip allowance: seq 1 published pretty-printed, signature still valid (§6.3 step 2).
const prettyV1 = Buffer.from(JSON.stringify(v1, null, 2), 'utf8');
const prettyHash = b64u(sha256(prettyV1));

// B-canon: a producer that consistently hashes what it published breaks the walk.
const bCanonBreaks = v2.prev === documentHash(v1) && prettyHash !== documentHash(v1);

// B-bytes: shipped code accepts the canonical retained copy §5.4 requires, hash contradicts the tip pin.
let retainedAccepted = false;
try { assertCanonicalBytes(v1, canonV1, 'retained version'); retainedAccepted = true; } catch {}
const bBytesEquivocates = retainedAccepted && b64u(sha256(canonV1)) !== prettyHash;

// Regime A: the shipped assertCanonicalBytes refuses both realistic non-canonical bodies.
function refused(bytes) {
  try { assertCanonicalBytes(parseIJSON(bytes.toString('utf8')), bytes, 'document'); return false; }
  catch (e) { return e instanceof CanonicalError; }
}
const refusesPretty = refused(prettyV1);
const refusesNewline = refused(Buffer.concat([canonV1, Buffer.from('\n')]));

// §14's bundle shape: whole chained documents nested as JSON *values*, needed back byte-verbatim.
const bundle = { version: 'openfeed-export/1', url: ID, identity: { current: v1, history: [] } };
const restored = parseIJSON(canonicalBytes(bundle).toString('utf8')).identity.current;
const aReproduces = canonicalBytes(restored).equals(canonV1);

// Under C the published bytes were pretty; no serializer of the restored value reproduces them.
const cCannotReproduce =
  !canonicalBytes(restored).equals(prettyV1) &&
  !Buffer.from(JSON.stringify(restored), 'utf8').equals(prettyV1) &&
  b64u(sha256(canonicalBytes(restored))) !== prettyHash;

// A's cost: the reference publisher already holds canonical bytes, having computed them to sign.
const docs = [...mom.documents().values()];
const allCanonical = [...mom.files().values()].every((b, i) => b.equals(canonicalBytes(docs[i])));

const gate = [
  ['B-canon: a producer hashing its own published bytes breaks the walk against its own prev', bCanonBreaks],
  ['B-bytes: shipped assertCanonicalBytes accepts the retained copy whose hash contradicts the tip pin — one seq, two hashes, §5.3.1 equivocation', bBytesEquivocates],
  ['the shipped code refuses a pretty-printed body outright (CanonicalError)', refusesPretty],
  ['the shipped code refuses canonical bytes plus a trailing newline', refusesNewline],
  ['regime A: a §14-nested value reproduces the published bytes exactly', aReproduces],
  ['regime C: no serializer of a §14-nested value reproduces the published bytes, so the restored chain cannot link', cCannotReproduce],
  ['every file the reference publisher emits is already canonical — A costs no second serialization', allCanonical],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('canonicality: all claims hold');
