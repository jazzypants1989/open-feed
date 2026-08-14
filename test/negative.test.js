// Negative cases. Appendix D is entirely positive — nine signatures that verify, two
// chains that link — so nothing in the published spec distinguishes a real verifier from
// one that returns true. These are the cases that MUST fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  parseIJSON,
  canonicalize,
  normalizeIdentityUrl,
  parseKid,
  sign,
  verifyDocument,
  claimedAuthor,
  VerifyError,
} from '../src/index.js';

// Deterministic test keys, same derivation as tmp/regen.js.
function keyFromLabel(label) {
  const seed = crypto.createHash('sha256').update('open-feed-v0.6 ' + label).digest();
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]);
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const spki = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  return { priv, x: Buffer.from(spki.subarray(spki.length - 32)).toString('base64url') };
}

const k1 = keyFromLabel('test-key-1');
const ID = 'https://test.example/';
const KID = ID + '#test-key-1';

const identity = {
  url: ID,
  keys: [{ kid: 'test-key-1', kty: 'OKP', crv: 'Ed25519', x: k1.x, iat: 1736899200 }],
  seq: 1,
  updated: 1736899200,
};

function signedItem(overrides = {}) {
  const item = {
    id: 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
    authors: [{ url: ID }],
    _feed_url: 'https://test.example/feed.json',
    _version: 1,
    content_text: 'hello',
    date_published: '2025-01-15T12:00:00Z',
    ...overrides,
  };
  item._sig = sign(item, k1.priv, KID);
  return item;
}

const throwsVerify = (re) => (e) => e instanceof VerifyError && re.test(e.message);

// ---- I-JSON (spec §6.3, RFC 7493) ----

test('duplicate member names are rejected', () => {
  // The whole reason the parser is hand-written: JSON.parse keeps the last silently, so
  // one set of bytes would verify under two readings.
  assert.deepEqual(JSON.parse('{"a":1,"a":2}'), { a: 2 }, 'JSON.parse still accepts these');
  assert.throws(() => parseIJSON('{"a":1,"a":2}'), /duplicate member name/);
  assert.throws(() => parseIJSON('{"x":{"a":1,"a":2}}'), /duplicate member name/);
  assert.throws(() => parseIJSON('{"_sig":"x","_sig":"y"}'), /duplicate member name/);
});

test('malformed JSON is rejected', () => {
  assert.throws(() => parseIJSON('{"a":1} trailing'), /trailing content/);
  // Leading zeros: `0` parses, then `1` is unexpected — rejected either way.
  assert.throws(() => parseIJSON('{"a":01}'), /expected/);
  assert.throws(() => parseIJSON('{"a":"unterminated'), /unterminated string/);
  assert.throws(() => parseIJSON('{"a":"rawcontrol"}'), /control character/);
  assert.throws(() => parseIJSON("{'a':1}"), /expected member name/);
  assert.throws(() => parseIJSON('{"a":}'), /invalid value/);
});

test('lone surrogates are rejected', () => {
  assert.throws(() => parseIJSON('{"a":"\\ud800"}'), /surrogate/);
  assert.throws(() => canonicalize({ a: '\ud800' }), /surrogate/);
  assert.doesNotThrow(() => parseIJSON('{"a":"\\ud83d\\udc4b"}')); // valid pair
});

test('keys sort by UTF-16 code unit, and non-ASCII stays raw', () => {
  assert.equal(canonicalize({ b: 1, a: 2, A: 3 }), '{"A":3,"a":2,"b":1}');
  assert.equal(canonicalize({ 'ö': 1, z: 2 }), '{"z":2,"ö":1}');
  assert.equal(canonicalize({ a: 'wörld 👋' }), '{"a":"wörld 👋"}');
});

test('non-representable values are rejected', () => {
  assert.throws(() => canonicalize({ a: NaN }), /non-finite/);
  assert.throws(() => canonicalize({ a: Infinity }), /non-finite/);
  assert.throws(() => canonicalize({ a: undefined }), /undefined/);
  assert.throws(() => canonicalize({ a: 1n }), /BigInt/);
});

// ---- identity URLs (spec §3.1) ----

test('identity URL normalization matches the spec table', () => {
  assert.equal(normalizeIdentityUrl('https://Alice.Example/~mom'), 'https://alice.example/~mom/');
  assert.equal(normalizeIdentityUrl('https://example.com:443/~alice/'), 'https://example.com/~alice/');
  assert.equal(normalizeIdentityUrl('https://example.com/~alice?ref=x#about'), 'https://example.com/~alice/');
  assert.throws(() => normalizeIdentityUrl('http://example.com/'), /must be https/);
});

test('kid splits at the LAST hash', () => {
  assert.deepEqual(parseKid('https://test.example/#key-1'), {
    identityUrl: 'https://test.example/',
    keyId: 'key-1',
  });
  // A path containing a fragment-looking segment must not confuse the split.
  assert.equal(parseKid('https://test.example/a#b#key-1').keyId, 'key-1');
  assert.throws(() => parseKid('https://test.example/'), /no fragment/);
  assert.throws(() => parseKid('https://test.example/#'), /empty key id/);
});

// ---- header (spec §6.2) ----

test('header deviations are rejected', () => {
  const item = signedItem();
  const [h, , s] = item._sig.split('.');
  const rewrite = (patch) => {
    const header = { ...JSON.parse(Buffer.from(h, 'base64url').toString('utf8')), ...patch };
    const nh = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
    return { ...item, _sig: `${nh}..${s}` };
  };

  assert.throws(() => verifyDocument(rewrite({ alg: 'HS256' }), { identityDocument: identity }), throwsVerify(/unrecognized alg/));
  assert.throws(() => verifyDocument(rewrite({ alg: 'none' }), { identityDocument: identity }), throwsVerify(/unrecognized alg/));
  assert.throws(() => verifyDocument(rewrite({ b64: true }), { identityDocument: identity }), throwsVerify(/b64 must be false/));
  assert.throws(() => verifyDocument(rewrite({ crit: [] }), { identityDocument: identity }), throwsVerify(/unsupported crit/));
  assert.throws(() => verifyDocument(rewrite({ crit: ['b64', 'x'] }), { identityDocument: identity }), throwsVerify(/unsupported crit/));
});

test('a rewritten header does not verify even when well-formed', () => {
  // The signature covers header AND payload (spec §6.1): swapping the referenced key in
  // the header must break the signature, not merely be caught by a field check.
  const item = signedItem();
  const [h, , s] = item._sig.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  header.kid = ID + '#other-key';
  const nh = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
  assert.throws(
    () => verifyDocument({ ...item, _sig: `${nh}..${s}` }, { identityDocument: identity }),
    throwsVerify(/lists no key/),
  );
});

test('malformed signatures are rejected', () => {
  const item = signedItem();
  assert.throws(() => verifyDocument({ ...item, _sig: 'not-a-jws' }, { identityDocument: identity }), throwsVerify(/detached JWS/));
  // An attached (non-detached) JWS has a payload in the middle segment.
  const [h, , s] = item._sig.split('.');
  assert.throws(() => verifyDocument({ ...item, _sig: `${h}.cGF5bG9hZA.${s}` }, { identityDocument: identity }), throwsVerify(/detached JWS/));
  assert.throws(() => verifyDocument({ ...item, _sig: undefined }, { identityDocument: identity }), throwsVerify(/has no _sig/));
});

// ---- author binding (spec §6.6) ----

test('author binding failures are rejected', () => {
  // Republishing someone's signed item under a different name.
  const item = signedItem();
  const stolen = { ...item, authors: [{ url: 'https://eve.example/' }] };
  assert.throws(() => verifyDocument(stolen, { identityDocument: identity }), throwsVerify(/author binding failed/));

  // Multi-entry authors: exactly one entry, or there is no binding.
  assert.throws(() => claimedAuthor({ authors: [{ url: ID }, { url: 'https://eve.example/' }] }), /exactly one entry/);
  assert.throws(() => claimedAuthor({ authors: [] }), /exactly one entry/);
  assert.throws(() => claimedAuthor({}), /no author binding/);
});

test('an item permalink is not an author binding', () => {
  // JSON Feed items carry their own `url`; it must never be mistaken for the author.
  const item = signedItem({ url: 'https://test.example/2025/01/15/' });
  assert.equal(claimedAuthor(item), ID);
  assert.ok(verifyDocument(item, { identityDocument: identity }));
});

test('the identity document must be the one the kid names', () => {
  const item = signedItem();
  const wrong = { ...identity, url: 'https://other.example/' };
  assert.throws(() => verifyDocument(item, { identityDocument: wrong }), throwsVerify(/wrong identity document/));
});

// ---- payload integrity ----

test('tampering with any signed field breaks the signature', () => {
  const item = signedItem();
  for (const patch of [
    { content_text: 'goodbye' },
    { _version: 2 },
    { _feed_url: 'https://elsewhere.example/feed.json' },
    { id: 'urn:uuid:00000000-0000-0000-0000-000000000000' },
    { date_published: '2025-01-16T12:00:00Z' },
    { _rel: [{ type: 'like', to: 'https://x.example/feed.json#y' }] }, // adding a field
  ]) {
    assert.throws(
      () => verifyDocument({ ...item, ...patch }, { identityDocument: identity }),
      throwsVerify(/does not verify/),
      `tampering with ${Object.keys(patch)[0]} was not caught`,
    );
  }
});

test('unknown extension fields are covered by the signature', () => {
  // Spec §7.2: unknown `_` fields MUST survive re-serialization because signatures
  // depend on it. Dropping one must therefore break verification.
  const item = signedItem({ _ai_assisted: true });
  assert.ok(verifyDocument(item, { identityDocument: identity }));
  const { _ai_assisted, ...stripped } = item;
  assert.throws(() => verifyDocument(stripped, { identityDocument: identity }), throwsVerify(/does not verify/));
});

// ---- key state (spec §4.4, §6.5) ----

test('a key revoked before the signing time is rejected', () => {
  const item = signedItem(); // signed 2025-01-15T12:00:00Z = 1736942400
  const revoked = { ...identity, keys: [{ ...identity.keys[0], revoked_at: 1736942399 }] };
  assert.throws(() => verifyDocument(item, { identityDocument: revoked }), throwsVerify(/revoked/));

  // Equal is still valid — normal rotation revokes the continuity key in the version it
  // signs (spec §5.2), so an off-by-one here would break every rotation.
  const atSigningTime = { ...identity, keys: [{ ...identity.keys[0], revoked_at: 1736942400 }] };
  assert.ok(verifyDocument(item, { identityDocument: atSigningTime }));
});

test('receipt time overrides self-reported time for revocation', () => {
  // Spec §4.4: a thief can backdate date_published but cannot backdate when a receiver
  // took delivery, so inbox items check revocation against receipt time.
  //
  // The backdate has to land between the key's iat and its revoked_at to be interesting.
  // Backdating past the iat is already caught by §6.5 step 6 (next test), so `iat` is
  // itself a partial backdating defence — it bounds how far a thief can reach back.
  const backdated = signedItem({ date_published: '2025-01-20T00:00:00Z' }); // 1737331200
  const revoked = { ...identity, keys: [{ ...identity.keys[0], revoked_at: 1739577600 }] };
  assert.ok(verifyDocument(backdated, { identityDocument: revoked }), 'self-reported time slips past');
  assert.throws(
    () => verifyDocument(backdated, { identityDocument: revoked, signedAt: 1739700000 }),
    throwsVerify(/revoked/),
    'receipt time must catch it',
  );
});

test('backdating before the key existed is rejected', () => {
  const backdated = signedItem({ date_published: '2020-01-01T00:00:00Z' });
  assert.throws(() => verifyDocument(backdated, { identityDocument: identity }), throwsVerify(/issued at/));
});

test('a key issued after the signing time is rejected', () => {
  const item = signedItem();
  const future = { ...identity, keys: [{ ...identity.keys[0], iat: 1900000000 }] };
  assert.throws(() => verifyDocument(item, { identityDocument: future }), throwsVerify(/issued at/));
});

test('non-Ed25519 keys cannot be pressed into service', () => {
  // Spec §6.2: the alg alone does not fix the curve. An X25519 encryption key (§15.1)
  // lives in the same array and must never verify a signature.
  const item = signedItem();
  for (const bad of [
    { kid: 'test-key-1', kty: 'OKP', crv: 'X25519', x: k1.x, use: 'enc' },
    { kid: 'test-key-1', kty: 'EC', crv: 'P-256', x: k1.x },
  ]) {
    assert.throws(
      () => verifyDocument(item, { identityDocument: { ...identity, keys: [bad] } }),
      throwsVerify(/not an Ed25519 signing key/),
    );
  }
});

test('a key absent from the identity document is rejected', () => {
  const item = signedItem();
  assert.throws(() => verifyDocument(item, { identityDocument: { ...identity, keys: [] } }), throwsVerify(/lists no key/));
});
