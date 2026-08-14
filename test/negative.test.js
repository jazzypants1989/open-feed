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
  // Userinfo is stripped: an identity is a place, not a credential. Left in it would make one
  // identity two, and the derived openfeed.json URL would carry it onto the wire as basic auth.
  assert.equal(normalizeIdentityUrl('https://bob@example.com/~alice/'), 'https://example.com/~alice/');
  assert.equal(normalizeIdentityUrl('https://bob:pw@example.com/'), 'https://example.com/');
  assert.equal(parseKid('https://bob@example.com/#key-1').identityUrl, 'https://example.com/');
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
  // lives in the same array and must never verify a signature. It is stopped one gate
  // earlier than it used to be — §4.1's use-allowlist hides it before the curve check —
  // and the curve check still catches a key with a recognized use but the wrong crv.
  const item = signedItem();
  assert.throws(
    () => verifyDocument(item, {
      identityDocument: { ...identity, keys: [{ kid: 'test-key-1', kty: 'OKP', crv: 'X25519', x: k1.x, use: 'enc' }] },
    }),
    throwsVerify(/unrecognized use/),
  );
  assert.throws(
    () => verifyDocument(item, {
      identityDocument: { ...identity, keys: [{ kid: 'test-key-1', kty: 'EC', crv: 'P-256', x: k1.x }] },
    }),
    throwsVerify(/not an Ed25519 signing key/),
  );
});

test('a key absent from the identity document is rejected', () => {
  const item = signedItem();
  assert.throws(() => verifyDocument(item, { identityDocument: { ...identity, keys: [] } }), throwsVerify(/lists no key/));
});

// ---- §6.6: the carrier is chosen by document kind, not by field presence ----

test('an authors field on a chained document does not displace its url binding', () => {
  // §6.6: "For manifests and identity documents the carrier is the `url` field. For items it
  // is the item-level `authors` array." §3.2 says unknown fields are preserved and *ignored*,
  // and ignoring one must not mean letting it stand in for the binding the document has. A
  // caller that knows the kind says so; the fallback only guesses for callers that do not.
  const manifest = {
    url: ID,
    feed_url: 'https://test.example/feed.json',
    items: {},
    seq: 1,
    updated: 1736899200,
    // An extension field a publisher is entitled to carry, naming somebody else.
    authors: [{ url: 'https://impostor.example/' }],
  };
  manifest._sig = sign(manifest, k1.priv, KID);

  assert.equal(claimedAuthor(manifest, { kind: 'document' }), ID);
  assert.equal(claimedAuthor(manifest), 'https://impostor.example/', 'the guess is what the kind overrides');

  // Told the kind, the manifest verifies against its own `url`.
  assert.ok(verifyDocument(manifest, { identityDocument: identity, kind: 'document' }));
  // Left to guess, author binding fails — safely, but for the wrong reason, and a document
  // whose `authors` happened to name its own identity would have skipped the check entirely.
  assert.throws(
    () => verifyDocument(manifest, { identityDocument: identity }),
    throwsVerify(/author binding failed/),
  );

  // An item is unaffected: its permalink `url` still carries no authority.
  const item = signedItem({ url: 'https://test.example/posts/1' });
  assert.equal(claimedAuthor(item, { kind: 'item' }), ID);
  assert.ok(verifyDocument(item, { identityDocument: identity, kind: 'item' }));
});

// ---- §5.3.1: what may fire the compare rule, and what may not ----
//
// The rule's response is to accept no further version of a chain until a human deliberately
// re-pins. That is the right answer to a publisher who equivocated and much too much authority
// to hand to anyone who can answer one request — so what counts as an *observation* is the
// whole safety property, not a detail.

import { identityFixture, makeKey, pinOf } from './helpers/chain-fixture.js';
import { walkToPin, PinStore, identityChainPolicy, ChainError, EquivocationError } from '../src/index.js';

/** An identity walked once and pinned at its tip — the starting state for both cases below. */
async function pinnedAtTip(versions = 5) {
  const fx = identityFixture({ versions });
  const pins = new PinStore();
  const walk = (tip, pin) =>
    walkToPin({ url: fx.url, tip, pin, fetchVersion: fx.store.fetchVersion, policy: identityChainPolicy, pins });
  const first = await walk(fx.chain.at(versions), pinOf(fx.chain.at(1)));
  pins.advance(fx.url, versions, first.hash);
  return { fx, pins, walk };
}

test('a forged tip does not freeze the chain against its own owner', async () => {
  const { fx, pins, walk } = await pinnedAtTip();

  // An identity document is its own key source (§5.3 step 1), so a serving-path attacker
  // holding **no key at all** mints one, lists it, and self-signs a document at the pinned seq.
  // It cannot survive a walk — but before this was fixed it was recorded as an observation
  // first, which tripped §5.3.1 and locked the consumer out of the identity permanently.
  const evil = makeKey('evil-1');
  evil.identity = fx.identity;
  const forged = { url: fx.identity, name: 'Owner', keys: [evil.jwk], seq: 5, updated: 1737000000, prev: 'AAAA' };
  forged._sig = sign(forged, evil.privateKey, `${fx.identity}#evil-1`);

  await assert.rejects(
    () => walk(forged, pins.pin(fx.url)),
    (e) => e instanceof ChainError && !(e instanceof EquivocationError),
    'a document the publisher’s own retained copy contradicts is noise, not equivocation',
  );
  assert.equal(pins.isFrozen(fx.url), false, 'one bad response must not cost the owner their identity');

  // The attacker goes away. Everything must keep working: the honest tip verifies, and the
  // owner can still publish.
  assert.ok(await walk(fx.chain.at(5), pins.pin(fx.url)));
  fx.chain.publish({ fields: { url: fx.identity, name: 'Owner', keys: fx.keys.map((k) => ({ ...k })) }, signer: fx.primary });
  const next = await walk(fx.chain.at(6), pins.pin(fx.url));
  pins.advance(fx.url, 6, next.hash);
  assert.equal(pins.pin(fx.url).seq, 6, 'the consumer follows the honest chain forward');
});

test('rewriting a retained version still freezes the chain', async () => {
  const { fx, pins, walk } = await pinnedAtTip();

  // The other half, and the reason the check above is a tiebreak rather than a blanket
  // exemption. §5.4 requires a retained version to be served byte-identically forever, so when
  // the copy at the **derived** URL moves it is the publisher's own record that changed — which
  // only the publisher serves. That is equivocation and §5.3.1 fires.
  const rewritten = { ...fx.chain.at(5), name: 'Rewritten' };
  rewritten._sig = sign(rewritten, fx.primary.privateKey, `${fx.identity}#key-1`);
  fx.store.replaceVersion(fx.url, 5, rewritten);

  await assert.rejects(
    () => walk(rewritten, pins.pin(fx.url)),
    (e) => e instanceof EquivocationError && e.seq === 5,
  );
  assert.equal(pins.isFrozen(fx.url), true, '§5.3.1: stop advancing and surface it');
  assert.equal(pins.pin(fx.url).seq, 5, 'the pin is retained, not advanced');
});

// ---- delegated keys (spec §4.6) and the §4.1 use allowlist ----
// The fail-closed argument for `use: "delegated"` rests on §4.1's rule that a key with an
// unrecognized `use` cannot be found at all. A verifier that resolves by `kid` alone has
// silently deleted that property — which is exactly what this file's verifier did before
// these tests existed.

import { assertContinuityKey } from '../src/index.js';

const kRoot = keyFromLabel('member-root-1');
const kDel = keyFromLabel('hub-key-1');
const kRec = keyFromLabel('recovery-1');
const MEMBER = 'https://member.example/';

const memberKeys = [
  { kid: 'member-root-1', kty: 'OKP', crv: 'Ed25519', x: kRoot.x, iat: 1736899200 },
  { kid: 'hub-key-1', kty: 'OKP', crv: 'Ed25519', x: kDel.x, use: 'delegated', iat: 1736899200 },
  { kid: 'recovery-1', kty: 'OKP', crv: 'Ed25519', x: kRec.x, use: 'recovery', iat: 1736899200 },
];
const memberIdentity = { url: MEMBER, keys: memberKeys, seq: 1, updated: 1736899200 };

function memberItem(signer, kid) {
  const item = {
    id: 'urn:uuid:0e37c1d6-5f7a-4b28-9c41-8d2e6a90f5b2',
    authors: [{ url: MEMBER }],
    _feed_url: 'https://member.example/feed.json',
    _version: 1,
    content_text: 'hello',
    date_published: '2025-02-20T10:00:00Z',
  };
  item._sig = sign(item, signer.priv, MEMBER + '#' + kid);
  return item;
}

test('a delegated key signs items; recovery and unrecognized-use keys cannot', () => {
  // Positive control: the delegated key is a real signing key for content.
  assert.doesNotThrow(() => verifyDocument(memberItem(kDel, 'hub-key-1'), { identityDocument: memberIdentity }));

  // A recovery key never signs content or manifests (§4.5).
  assert.throws(
    () => verifyDocument(memberItem(kRec, 'recovery-1'), { identityDocument: memberIdentity }),
    throwsVerify(/recovery key/),
  );

  // §4.1: an unrecognized `use` hides the key — the fail-closed direction §4.6 depends on.
  const extIdentity = {
    url: MEMBER,
    keys: [{ kid: 'hub-key-1', kty: 'OKP', crv: 'Ed25519', x: kDel.x, use: 'frobnicate', iat: 1736899200 }],
    seq: 1,
    updated: 1736899200,
  };
  assert.throws(
    () => verifyDocument(memberItem(kDel, 'hub-key-1'), { identityDocument: extIdentity }),
    throwsVerify(/unrecognized use/),
  );
});

test('a delegated key MUST NOT sign an identity-document version', () => {
  // At genesis / a fresh tip, where there is no predecessor to judge continuity against:
  const genesis = { url: MEMBER, keys: memberKeys, seq: 1, updated: 1736899200 };
  genesis._sig = sign(genesis, kDel.priv, MEMBER + '#hub-key-1');
  assert.throws(
    () => identityChainPolicy.verifySignature(genesis),
    (e) => e instanceof ChainError && /delegated key .* MUST NOT sign identity-document versions/.test(e.message),
  );

  // And as a continuity key across a hop (§5.2 step 3):
  const successor = { url: MEMBER, keys: memberKeys, seq: 2, updated: 1739577600, prev: 'AAAA' };
  successor._sig = sign(successor, kDel.priv, MEMBER + '#hub-key-1');
  assert.throws(
    () => assertContinuityKey(successor, memberIdentity),
    (e) => e instanceof ChainError && /delegated key/.test(e.message),
  );

  // The root key signing the same version is fine — the exclusion is the delegation, not the hop.
  const honest = { url: MEMBER, keys: memberKeys, seq: 2, updated: 1739577600, prev: 'AAAA' };
  honest._sig = sign(honest, kRoot.priv, MEMBER + '#member-root-1');
  assert.doesNotThrow(() => assertContinuityKey(honest, memberIdentity));
});
