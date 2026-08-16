// §6.3's wire rule, three ways: what does "a chained document MUST arrive as its own
// canonicalization" actually buy, and what would relaxing it cost?
//
// `60d36f0` added the rule and `HANDOFF.md` §1.2 immediately argued against its own decision:
// nine lines of `assertCanonicalBytes` raise the conformance bar for every publisher in the
// protocol, and a middle setting was never considered before it shipped. Three regimes are on
// the table:
//
//   A  MUST everywhere        — what shipped. Tip and retained versions alike must be
//                               byte-identical to the canonicalization of what they parse to.
//   B  MUST retained,         — HANDOFF's middle setting. Keeps the strict guarantee where a
//      SHOULD tip              chain is walked; tolerant of ordinary infrastructure at first
//                               contact.
//   C  hash what you were     — drop the canonicality requirement on the body entirely; require
//      served                  instead that pins and `prev` hash the served bytes verbatim.
//
// The publisher-friction argument is the one HANDOFF frames it on, and it is the least
// interesting of the three questions. What this measures instead:
//
//   Q1  Does B name one regime or two? A pin records a hash; a `prev` names a hash. If the tip
//       may be non-canonical, those two are computed from different byte strings unless B also
//       says which. It has to pick, so run both picks.
//   Q2  §14 nests whole chained documents as JSON *values* and requires them byte-verbatim as
//       published (`tmp/export-prototype.js` S2). Which regimes can reproduce published bytes
//       from a nested value?
//   Q3  What does A actually cost a publisher, enumerated as serialization paths rather than
//       asserted as a bar?
//   Q4  The free perf fix HANDOFF names: once a body is *proven* canonical, `documentHash` is
//       `sha256(bytes)` and the second canonicalization is waste. Measure it.
//
// Imports src/ rather than re-deriving canon: the question is about the shipped rule, and a
// second canonicalizer would answer it about a different implementation.

import {
  canonicalBytes,
  assertCanonicalBytes,
  parseIJSON,
  documentHash,
  sha256,
  b64u,
  Publisher,
  derivedVersionUrl,
  CanonicalError,
} from '../src/index.js';

import crypto from 'node:crypto';

const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`Q${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };

let clock = 1736899200;
const now = () => clock;
const tick = (s = 3600) => (clock += s);

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: 1736899200 - 86400, kid, kty: 'OKP', x }, privateKey };
}

const ID = 'https://mom.pence.family/';
const signer = makeSigner('key-1');

// ---------------------------------------------------------------------------------------
// The three regimes, as consumers.
//
// A regime is exactly two decisions: does this body get accepted, and what hash goes in the
// pin. Everything else about verification is identical across all three, which is the point —
// signatures already resolve against `canonicalize(parse(body))` under §6.3 step 2 whatever
// the body looks like, so this rule is not about signature validity at all.
// ---------------------------------------------------------------------------------------

const REGIMES = {
  A: {
    label: 'A  MUST everywhere',
    accept: (bytes, doc) => { assertCanonicalBytes(doc, bytes, 'document'); return true; },
    hash: (bytes, doc) => documentHash(doc),
  },
  'B-canon': {
    label: 'B  MUST retained / SHOULD tip, pin the canonicalization',
    accept: (bytes, doc, { retained }) => {
      if (retained) assertCanonicalBytes(doc, bytes, 'retained version');
      return true;
    },
    hash: (bytes, doc) => documentHash(doc),
  },
  'B-bytes': {
    label: 'B  MUST retained / SHOULD tip, pin the served bytes',
    accept: (bytes, doc, { retained }) => {
      if (retained) assertCanonicalBytes(doc, bytes, 'retained version');
      return true;
    },
    hash: (bytes) => b64u(sha256(bytes)),
  },
  C: {
    label: 'C  hash what you were served',
    accept: () => true,
    hash: (bytes) => b64u(sha256(bytes)),
  },
};

/** Fetch one URL under one regime. Returns {ok, hash} or {ok:false, reason}. */
function consume(server, url, regime, { retained = false } = {}) {
  const bytes = server.get(url);
  if (!bytes) return { ok: false, reason: `${url} not served` };
  let doc;
  try {
    doc = parseIJSON(bytes.toString('utf8'));
  } catch (e) {
    return { ok: false, reason: `parse: ${e.message}` };
  }
  try {
    REGIMES[regime].accept(bytes, doc, { retained });
  } catch (e) {
    return { ok: false, reason: e instanceof CanonicalError ? 'non-canonical body refused' : e.message };
  }
  return { ok: true, doc, hash: REGIMES[regime].hash(bytes, doc) };
}

// ---------------------------------------------------------------------------------------
// Serialization paths a real publisher might take. Only the first is canonical.
// ---------------------------------------------------------------------------------------

const SERIALIZERS = {
  canonical: (doc) => canonicalBytes(doc),
  'canonical + trailing \\n': (doc) => Buffer.concat([canonicalBytes(doc), Buffer.from('\n')]),
  'JSON.stringify(o)': (doc) => Buffer.from(JSON.stringify(doc), 'utf8'),
  'JSON.stringify(o, null, 2)': (doc) => Buffer.from(JSON.stringify(doc, null, 2), 'utf8'),
};

// ---------------------------------------------------------------------------------------
// Q1 — does B name one regime or two?
// ---------------------------------------------------------------------------------------

scene(1, 'B has to pick which byte string the tip hashes to, and both picks break');

// An honest publisher. Two identity-chain versions, so there is both a tip and a retained copy.
const mom = new Publisher({ identity: ID, title: "Mom's Journal", signer, profile: { name: 'Mom' }, now });
tick();
mom.advanceIdentity({ bio: 'Gardener.' });
const v1 = mom.identityVersions[0];
const v2 = mom.identityVersions[1];
const IDENTITY_URL = `${ID}openfeed.json`;
const V1_URL = derivedVersionUrl(IDENTITY_URL, 1);

// The producer publishes seq 1 pretty-printed — a static-site generator writing
// `JSON.stringify(obj, null, 2)`, the exact case HANDOFF names. It signs correctly: §6.3's
// payload is the canonicalization either way, so the signature is valid on both byte strings.
const prettyV1 = SERIALIZERS['JSON.stringify(o, null, 2)'](v1);
const canonV1 = canonicalBytes(v1);

say(`  seq 1 published pretty : ${prettyV1.length} B, sha256 ${b64u(sha256(prettyV1)).slice(0, 12)}…`);
say(`  seq 1 canonicalized    : ${canonV1.length} B, sha256 ${b64u(sha256(canonV1)).slice(0, 12)}…`);
say(`  seq 2's prev names     : ${v2.prev.slice(0, 12)}…  (the producer hashed its own canonical form)`);
say();

// Regime B-canon: the consumer pins hash(canonicalize(parse(tip))). It reconnects to `prev`
// fine — but only because the producer computed `prev` canonically. If the producer is
// consistent and hashes what it published, `prev` names the pretty bytes and the walk breaks.
const inconsistentPrev = b64u(sha256(prettyV1));
say('  B-canon: consumer pins hash(canonicalize(parse(body))).');
say(`    - producer hashes canonically  → prev ${v2.prev.slice(0, 12)}… matches the pin. ok,`);
say('      but the producer is then serving bytes it does not itself hash, and §5.1 says');
say('      "full published canonical bytes" — so this only works while the producer pretends');
say('      its own published bytes are the canonical ones it never served.');
say(`    - producer hashes what it published → prev ${inconsistentPrev.slice(0, 12)}…, pin`);
say(`      ${documentHash(v1).slice(0, 12)}…  → WALK BREAKS against an honest publisher.`);
const bCanonBreaks = inconsistentPrev !== documentHash(v1);
say();

// Regime B-bytes: the consumer pins sha256(served bytes). Coherent at the tip. But B still
// requires the RETAINED copy to be canonical, and §5.4 requires it to be byte-identical to
// how it was published. Those two rules cannot both hold for a publisher that pretty-printed.
const server = new Map();
server.set(IDENTITY_URL, canonicalBytes(v2));
server.set(V1_URL, canonV1);            // retained copy, canonical as B requires

const tipPin = REGIMES['B-bytes'].hash(prettyV1, v1);          // pinned when seq 1 was the tip
const retained = consume(server, V1_URL, 'B-bytes', { retained: true });
const bBytesEquivocates = retained.ok && retained.hash !== tipPin;
say('  B-bytes: consumer pins sha256(served bytes) at the tip.');
say(`    - pinned at seq 1 (tip, pretty)   : ${tipPin.slice(0, 12)}…`);
say(`    - retained copy at ${V1_URL.slice(ID.length)} : ${retained.hash.slice(0, 12)}… (canonical, as B requires)`);
say(`    - same seq, two hashes            : ${bBytesEquivocates ? '§5.3.1 EQUIVOCATION fires' : 'no conflict'}`);
say('      against an honest publisher, and §5.3.1\'s response is to accept no further version');
say('      of that chain until a human deliberately re-pins.');

verdict(
  'B is not a middle setting. §5.4 binds a version\'s tip bytes and its retained bytes to be the\n'
  + 'same string, so exempting the tip forces a publisher to serve two strings for one seq. Whichever\n'
  + 'hash B picks, an honest publisher is either unwalkable (B-canon) or reported as equivocating\n'
  + '(B-bytes). The relaxation is not smaller than A — it forks §5.4.',
);

// ---------------------------------------------------------------------------------------
// Q2 — §14 nesting
// ---------------------------------------------------------------------------------------

scene(2, '§14 nests chained documents as JSON values and needs their published bytes back');

// The bundle shape from §14: documents nested as values, not as strings.
function bundleAndReturn(doc) {
  const bundle = { version: 'openfeed-export/1', url: ID, identity: { current: doc, history: [] } };
  const wire = canonicalBytes(bundle);                     // the bundle is itself a document
  const back = parseIJSON(wire.toString('utf8'));
  return back.identity.current;
}

const roundTripped = bundleAndReturn(v1);
const reproducedA = canonicalBytes(roundTripped);
say(`  A: nested value → canonicalBytes  reproduces published bytes : ${reproducedA.equals(canonV1) ? 'YES' : 'no'}`);

// Under C the published bytes were the pretty ones. Nesting the parsed value discards the
// formatting, so nothing downstream can reproduce them — and the chain does not link, because
// C's `prev` named the pretty bytes.
const reproducedC = canonicalBytes(roundTripped);
const cReproduces = reproducedC.equals(prettyV1);
say(`  C: nested value → any serializer   reproduces published bytes : ${cReproduces ? 'YES' : 'NO'}`);
say(`     C\'s prev named ${inconsistentPrev.slice(0, 12)}…; the restorer can only produce ${b64u(sha256(reproducedC)).slice(0, 12)}…`);
say('     so the restored chain does not link and §14\'s "byte-verbatim as published" is unmet.');

// The only fix available to C is to stop nesting values and carry bytes — base64, +33%.
const inflated = Buffer.from(prettyV1.toString('base64url'), 'ascii').length;
say(`  C\'s repair: carry each document base64-wrapped instead of nested — ${prettyV1.length} B → ${inflated} B `
  + `(+${(((inflated / prettyV1.length) - 1) * 100).toFixed(0)}%),`);
say('     and every §14 consumer needs a second representation for documents it already parses.');
say(`  B: the tip fails exactly as C does; identity.history (retained, canonical) survives. Half a bundle.`);

verdict(
  '§14 is the decider and neither HANDOFF nor the §6.3 text names it. A bundle nests whole signed\n'
  + 'documents as JSON *values* and requires them byte-verbatim; that only closes when a document\'s\n'
  + 'published bytes ARE its canonicalization. `tmp/export-prototype.js` S2 found round-tripping safe\n'
  + 'and decomposition fatal — the first half of that finding silently depended on regime A.',
);

// ---------------------------------------------------------------------------------------
// Q3 — what A costs a publisher
// ---------------------------------------------------------------------------------------

scene(3, 'A\'s breakage surface, enumerated');

say('  serialization path                published bytes    regime A accepts');
for (const [name, fn] of Object.entries(SERIALIZERS)) {
  const bytes = fn(v1);
  const got = consume(new Map([[IDENTITY_URL, bytes]]), IDENTITY_URL, 'A');
  say(`  ${name.padEnd(30)} ${String(bytes.length).padStart(8)} B      ${got.ok ? 'yes' : 'NO  — ' + got.reason}`);
}
say();
say('  What a Level 2 publisher already holds: `Publisher.files()` returns canonicalBytes of every');
say('  document, because signing computed that string. The failure mode is serializing TWICE —');
say('  signing the bytes, then writing JSON.stringify of the object. A publisher can only reach it');
say('  by discarding the string it just produced.');
const files = mom.files();
const allCanonical = [...files.values()].every((b, i) => b.equals(canonicalBytes([...mom.documents().values()][i])));
say(`  every file the reference publisher emits is already canonical : ${allCanonical ? 'yes' : 'NO'}`);
say();
say('  The residual is INFRASTRUCTURE, not the publisher: a build step or editor appending a');
say('  trailing newline is the one realistic external break, and it is the first row above.');
say('  §6.3 should name it, because "byte-identical" does not read as "and no trailing newline".');

// ---------------------------------------------------------------------------------------
// Q4 — the double-canonicalization cost HANDOFF names
// ---------------------------------------------------------------------------------------

scene(4, 'Once a body is proven canonical, the second canonicalization is waste');

// A manifest at family scale, then at §13.4's ceiling.
function manifestOf(itemCount) {
  const items = {};
  for (let i = 0; i < itemCount; i++) {
    items[`urn:uuid:${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`] =
      [1, b64u(sha256(Buffer.from(`item${i}`)))];
  }
  return { url: ID, feed_url: `${ID}feed.json`, items, seq: 1, updated: 1736899200, _sig: 'x'.repeat(120) };
}

say('  items   manifest KB   walk   canonicalize-twice   sha256(proven bytes)   saved');
for (const [count, versions] of [[100, 1000], [1000, 1000], [10000, 100]]) {
  const doc = manifestOf(count);
  const bytes = canonicalBytes(doc);

  let t0 = process.hrtime.bigint();
  for (let i = 0; i < versions; i++) { assertCanonicalBytes(doc, bytes, 'm'); documentHash(doc); }
  const twice = Number(process.hrtime.bigint() - t0) / 1e6;

  t0 = process.hrtime.bigint();
  for (let i = 0; i < versions; i++) { assertCanonicalBytes(doc, bytes, 'm'); b64u(sha256(bytes)); }
  const once = Number(process.hrtime.bigint() - t0) / 1e6;

  say(`  ${String(count).padStart(5)}   ${(bytes.length / 1024).toFixed(0).padStart(9)} KB  `
    + `${String(versions).padStart(5)}   ${twice.toFixed(0).padStart(15)} ms   ${once.toFixed(0).padStart(19)} ms   `
    + `${(100 - (once / twice) * 100).toFixed(0).padStart(4)}%`);
}
say();
say('  §13.4 allows 1000 versions per update, so the right-hand column is what a returning');
say('  reader pays. The saving is free: `assertCanonicalBytes` has already proven the two');
say('  byte strings equal, so hashing either is the same value. It needs the fetched bytes');
say('  threaded into `walkToPin`, which today takes parsed documents only.');

// ---------------------------------------------------------------------------------------

say();
say('='.repeat(78));
if (!bCanonBreaks || !bBytesEquivocates || !reproducedA.equals(canonV1) || cReproduces || !allCanonical) {
  console.error('PROTOTYPE FAILED — a claim above did not hold');
  process.exit(1);
}
say('VERDICT — keep regime A, and say two more things about it');
say('  1. §14 rules out C outright: a bundle nests documents as values, so published bytes must BE');
say('     the canonicalization or nothing downstream can reproduce them. C also splits §5.1\'s one');
say('     hashing rule in two, since an item has no byte range and must still hash its parse.');
say('  2. B is not a relaxation of A but a fork of §5.4: exempting the tip forces two byte strings');
say('     for one seq, and an honest publisher then reads as equivocating or as unwalkable.');
say('  3. A\'s cost is not the bar HANDOFF feared. A publisher already computes the exact bytes in');
say('     order to sign; the reachable failure is serializing twice. §6.3 should name the trailing');
say('     newline explicitly, and §12 Level 1 should name the rule — it is a consumer MUST that is');
say('     not a signature check, so "verify signatures (§6)" does not carry it.');
say('  4. Take the free fix: hash the proven-canonical bytes instead of canonicalizing again.');
say();
say('ALL CLAIMS HOLD');
