// ADOPTED (§15.2). Read the framing below as history, and the gate at the bottom as the part
// that is still live.
//
// **What this file argued against no longer exists.** It was written against a §15.2 that gave
// every recipient its own ephemeral and left the slots untagged, and against a §15.5.7 that
// bounded the resulting cost with a trial-decryption cap (RECOMMENDED 1024) and a
// "SHOULD attempt keys newest-`iat` first". Scheme C below was adopted wholesale: §15.2 now
// specifies one shared `epk` in the JWE protected header and a blinded per-recipient `_tag`,
// and §15.5.7 was deleted along with its magic number. Nothing here proposes anything.
//
// **Why it is kept rather than retired.** The measurement is the reason the two halves are
// welded together, and that reason is not visible from the shipped construction: a shared
// ephemeral *alone* is not a win (it forces keys-outer/slots-inner, so a wrong key costs a full
// sweep of unwraps), and tags *alone* cannot be computed without the per-slot ECDH they were
// meant to replace. So the three schemes are still measured — A as originally specified, B to
// isolate the ephemeral change, C as shipped — because "why not just do one of them" is the
// question a later editor will ask, and the answer is a table rather than an argument.
//
//   A  the original §15.2  — per-recipient epk, untagged, trial decrypt
//   B  shared epk          — untagged, trial decrypt (isolates the ephemeral change)
//   C  shared epk + tags   — what §15.2 now specifies
//
// **And it exercises `src/enc.js`.** It did not, which meant the shipped §15 had no prototype
// behind it and this file could go on measuring a scheme C that had drifted from the one in the
// repository. The section before the verdict runs `seal`/`open` and gates on the shipped
// envelope actually being C: one shared `epk`, a per-recipient `_tag`, no `kid` anywhere, and a
// tag a recipient reproduces from its own private half.

import crypto from 'node:crypto';

import { seal, open, slotTag, TAG_LABEL, encryptionKeyFor, EncError } from '../../src/enc.js';

const say = (s = '') => console.log(s);
const rule = (t) => { say(); say('='.repeat(78)); say(t); say('='.repeat(78)); };
const b64u = (b) => Buffer.from(b).toString('base64url');

// ---- keys (RFC 8037 X25519) --------------------------------------------------------------

function encKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  return { priv: privateKey, pub: publicKey, x: publicKey.export({ format: 'jwk' }).x };
}

// JOSE Concat KDF, enough of it to be honest about the cost (§15.2's ECDH-ES+A256KW).
function concatKdf(Z, algId, keyLen = 32) {
  const lp = (b) => Buffer.concat([Buffer.alloc(4).fill(0).map((_, i) => (i === 3 ? b.length : 0)), b]);
  const h = crypto.createHash('sha256');
  h.update(Buffer.from([0, 0, 0, 1]));
  h.update(Z);
  h.update(lp(Buffer.from(algId, 'ascii')));
  h.update(Buffer.from([0, 0, 0, 0]));                       // apu
  h.update(Buffer.from([0, 0, 0, 0]));                       // apv
  h.update(Buffer.from([0, 0, 0, keyLen * 8]));
  return h.digest().subarray(0, keyLen);
}

const wrap = (kek, cek) => {
  const c = crypto.createCipheriv('aes256-wrap', kek, Buffer.alloc(8, 0xa6));
  return Buffer.concat([c.update(cek), c.final()]);
};
const unwrap = (kek, wrapped) => {
  const d = crypto.createDecipheriv('aes256-wrap', kek, Buffer.alloc(8, 0xa6));
  return Buffer.concat([d.update(wrapped), d.final()]);
};

// ---- the three envelopes -------------------------------------------------------------------

function encrypt(plaintext, recipientPubs, { scheme }) {
  const cek = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const prot = b64u(JSON.stringify({ enc: 'A256GCM' }));
  const c = crypto.createCipheriv('aes-256-gcm', cek, iv);
  c.setAAD(Buffer.from(prot, 'ascii'));
  const ciphertext = Buffer.concat([c.update(Buffer.from(plaintext, 'utf8')), c.final()]);

  const shared = scheme === 'A' ? null : encKeypair();
  const recipients = recipientPubs.map((pub) => {
    const eph = shared ?? encKeypair();
    const Z = crypto.diffieHellman({ privateKey: eph.priv, publicKey: pub });
    const kek = concatKdf(Z, 'ECDH-ES+A256KW');
    const header = { alg: 'ECDH-ES+A256KW' };
    if (scheme === 'A') header.epk = { kty: 'OKP', crv: 'X25519', x: eph.x };
    // The tag. Domain-separated from the KEK so possessing one never yields the other.
    if (scheme === 'C') header._tag = b64u(crypto.createHash('sha256').update('openfeed-slot-tag').update(Z).digest().subarray(0, 8));
    return { header, encrypted_key: b64u(wrap(kek, cek)) };
  });

  const jwe = { protected: prot, recipients, iv: b64u(iv), ciphertext: b64u(ciphertext), tag: b64u(c.getAuthTag()) };
  if (shared) jwe.epk = { kty: 'OKP', crv: 'X25519', x: shared.x };
  return jwe;
}

// A reader holding K private encryption keys. §15.1 makes K grow monotonically and never
// shrink — "a rotated-out encryption key MUST be retained by its owner indefinitely" — so K is
// a decade of rotations, and the cost the deleted §15.5.7 capped is the PRODUCT with slot count.
function decrypt(jwe, myKeys, { scheme }) {
  let ecdh = 0, unwraps = 0, compares = 0;

  if (scheme === 'A') {
    for (const r of jwe.recipients) {
      const epk = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: r.header.epk.x }, format: 'jwk' });
      for (const k of myKeys) {
        ecdh++;
        const kek = concatKdf(crypto.diffieHellman({ privateKey: k.priv, publicKey: epk }), 'ECDH-ES+A256KW');
        unwraps++;
        try { return { cek: unwrap(kek, Buffer.from(r.encrypted_key, 'base64url')), ecdh, unwraps, compares }; }
        catch { /* not this slot */ }
      }
    }
    return { cek: null, ecdh, unwraps, compares };
  }

  const epk = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: jwe.epk.x }, format: 'jwk' });
  for (const k of myKeys) {
    ecdh++;                                                  // ONE per key, not per key per slot
    const Z = crypto.diffieHellman({ privateKey: k.priv, publicKey: epk });
    const kek = concatKdf(Z, 'ECDH-ES+A256KW');
    if (scheme === 'C') {
      const want = b64u(crypto.createHash('sha256').update('openfeed-slot-tag').update(Z).digest().subarray(0, 8));
      for (const r of jwe.recipients) {
        compares++;
        if (r.header._tag === want) {
          unwraps++;
          return { cek: unwrap(kek, Buffer.from(r.encrypted_key, 'base64url')), ecdh, unwraps, compares };
        }
      }
    } else {
      for (const r of jwe.recipients) {
        unwraps++;
        try { return { cek: unwrap(kek, Buffer.from(r.encrypted_key, 'base64url')), ecdh, unwraps, compares }; }
        catch { /* not this slot */ }
      }
    }
  }
  return { cek: null, ecdh, unwraps, compares };
}

// ---- correctness before speed ---------------------------------------------------------------

rule('Correctness — every scheme must open for a recipient and stay shut for everyone else');

const PLAINTEXT = JSON.stringify({ id: 'urn:uuid:0001', content_text: 'The grandkids came over.' });
const audience = Array.from({ length: 12 }, () => encKeypair());
const stranger = encKeypair();

// Recorded rather than only printed. This loop used to print the word LEAK as data and exit 0,
// so a regression that opened an envelope for a stranger reported "ok" like everything else.
const correctness = {};
for (const scheme of ['A', 'B', 'C']) {
  const jwe = encrypt(PLAINTEXT, audience.map((k) => k.pub), { scheme });
  const first = decrypt(jwe, [audience[0]], { scheme });
  const last = decrypt(jwe, [audience[audience.length - 1]], { scheme });
  const out = decrypt(jwe, [stranger], { scheme });
  const opens = (r) => {
    if (!r.cek) return false;
    const d = crypto.createDecipheriv('aes-256-gcm', r.cek, Buffer.from(jwe.iv, 'base64url'));
    d.setAAD(Buffer.from(jwe.protected, 'ascii'));
    d.setAuthTag(Buffer.from(jwe.tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(jwe.ciphertext, 'base64url')), d.final()]).toString() === PLAINTEXT;
  };
  correctness[scheme] = { first: opens(first), last: opens(last), lockedOut: out.cek === null };
  say(`  ${scheme}: first recipient ${correctness[scheme].first ? 'opens' : 'FAILS'}, ` +
      `last recipient ${correctness[scheme].last ? 'opens' : 'FAILS'}, ` +
      `stranger ${correctness[scheme].lockedOut ? 'locked out' : 'LEAK'}`);
}

// The privacy property, stated as what an observer can actually compute.
const probe = encrypt(PLAINTEXT, audience.map((k) => k.pub), { scheme: 'C' });
say();
say(`  An observer holds every recipient's PUBLIC key — §15.1 publishes them in identity`);
say(`  documents — and the ephemeral public key from the envelope. To test membership they`);
say(`  need ECDH(esk, pk_i), which requires one of the two private halves. They have neither.`);
say(`  Tags are unlinkable across items because esk is fresh per item:`);
const again = encrypt(PLAINTEXT, audience.map((k) => k.pub), { scheme: 'C' });
const tagsRelink = probe.recipients.some((r) => again.recipients.some((s) => s.header._tag === r.header._tag));
say(`    same audience, two items — any tag repeated: ${tagsRelink}`);

// ---- size ------------------------------------------------------------------------------------

rule('Size — bytes on the wire, which the manifest then commits and retains forever');

const sizes = {};
say(`  N     A (per-recipient epk)   B (shared epk)      C (shared epk + tag)`);
for (const N of [10, 30, 1024]) {
  const pubs = Array.from({ length: N }, () => encKeypair().pub);
  const [a, b, c] = ['A', 'B', 'C'].map((s) => Buffer.byteLength(JSON.stringify(encrypt(PLAINTEXT, pubs, { scheme: s }))));
  sizes[N] = { a, b, c };
  const fmt = (n) => `${(n / 1024).toFixed(1)} KB`.padEnd(20);
  say(`  ${String(N).padEnd(6)}${fmt(a)}${fmt(b)}${fmt(c)}`);
  if (N === 30) {
    say(`        per slot: ${Math.round(a / N)} B          ${Math.round(b / N)} B` +
        `             ${Math.round(c / N)} B`);
  }
}
say();
say(`  The proposal is SMALLER than what §15.2 specifies. A shared ephemeral removes a 43-char`);
say(`  X25519 public key from every slot (~60 B of JSON); an 8-byte tag costs ~20 B back.`);

// ---- speed -----------------------------------------------------------------------------------

rule('Speed — operations and wall clock, at the sizes §15.2 and the old §15.5.7 named');

function bench(fn, iterations) {
  const t = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) fn();
  return Number(process.hrtime.bigint() - t) / 1e6 / iterations;
}

// §15.1: encryption keys are cumulative and never dropped, so a long-lived reader holds many.
for (const K of [1, 10]) {
  say();
  say(`  reader holding K = ${K} encryption key${K > 1 ? 's' : ''} (§15.1 makes K grow and never shrink)`);
  say(`    N     case            A ops / ms            B ops / ms            C ops / ms`);
  for (const N of [10, 30, 1024]) {
    const aud = Array.from({ length: N }, () => encKeypair());
    const history = Array.from({ length: K - 1 }, () => encKeypair());
    const cases = {
      'recipient@1': [...history, aud[0]],
      [`recipient@${N}`]: [...history, aud[N - 1]],
      'non-recipient': [...history, encKeypair()],
    };
    for (const [label, keys] of Object.entries(cases)) {
      const cols = ['A', 'B', 'C'].map((scheme) => {
        const jwe = encrypt(PLAINTEXT, aud.map((k) => k.pub), { scheme });
        const counts = decrypt(jwe, keys, { scheme });
        const iters = N >= 1024 ? 3 : 30;
        const ms = bench(() => decrypt(jwe, keys, { scheme }), iters);
        return `${counts.ecdh} ECDH / ${ms.toFixed(2)}`.padEnd(22);
      });
      say(`    ${String(N).padEnd(6)}${label.padEnd(16)}${cols.join('')}`);
    }
  }
}

// ---- the shipped implementation -----------------------------------------------------------
//
// Everything above is this file's own re-derivation of three envelopes. That is what a
// prototype is for, and it is also how a prototype goes on holding after the thing it
// describes has moved: scheme C here could drift from scheme C in `src/enc.js` and nothing
// would say so. So this section runs the shipped code and checks it *is* C.

rule('The shipped §15 — is `src/enc.js` scheme C, or only described as it?');

function encIdentity(url, key) {
  return {
    url,
    seq: 1,
    updated: 1739577600,
    keys: [{ crv: 'X25519', iat: 1736899200, kid: 'enc-1', kty: 'OKP', use: 'enc', x: key.x }],
  };
}

const shippedKeys = Array.from({ length: 6 }, () => encKeypair());
const shippedDocs = shippedKeys.map((k, i) => encIdentity(`https://r${i}.example/`, k));
const outsiderKey = encKeypair();

const carrier = {
  id: 'urn:uuid:9d1f0a2b-3c4d-4e5f-8091-a2b3c4d5e6f7',
  authors: [{ url: 'https://author.example/' }],
  _openfeed: { feed_url: 'https://author.example/feed.json', version: 1 },
  content_text: '',
  date_published: '2025-02-20T12:00:00Z',
};
const envelope = seal({
  item: carrier,
  content: { content_text: 'The grandkids came over.' },
  recipients: shippedDocs,
});
const sealed = { ...carrier, _openfeed: { ...carrier._openfeed, enc: envelope } };

const protectedHeader = JSON.parse(Buffer.from(envelope.protected, 'base64url').toString('utf8'));
const sharedEpk = typeof protectedHeader?.epk?.x === 'string';
const slotEpks = envelope.recipients.filter((r) => r.header.epk !== undefined).length;
const slotTags = envelope.recipients.filter((r) => typeof r.header._tag === 'string').length;
const slotKids = envelope.recipients.filter((r) => r.header.kid !== undefined).length;

say(`  one shared \`epk\` in the protected header : ${sharedEpk}`);
say(`  per-recipient \`epk\` slots (scheme A's shape): ${slotEpks} of ${envelope.recipients.length}`);
say(`  per-recipient \`_tag\` slots                 : ${slotTags} of ${envelope.recipients.length}`);
say(`  per-recipient \`kid\` slots (§15.2 MUST NOT) : ${slotKids}`);
say(`  the recipient list appears nowhere on the wire: ` +
    `${!JSON.stringify(envelope).includes('r0.example')}`);

// A recipient reproduces its own tag from its own private half, which is the whole privacy
// claim — and it is checked against `slotTag` rather than against a re-derivation here, so a
// change to the label or the truncation is a failure rather than a divergence nobody notices.
const epkPub = crypto.createPublicKey({
  key: { kty: 'OKP', crv: 'X25519', x: protectedHeader.epk.x }, format: 'jwk',
});
const mine = slotTag(crypto.diffieHellman({ privateKey: shippedKeys[3].priv, publicKey: epkPub }));
const tagFound = envelope.recipients.some((r) => r.header._tag === mine);
say(`  recipient 3 finds its slot by computing its own tag: ${tagFound}`);
say(`  the tag's domain separator is ${JSON.stringify(TAG_LABEL)}`);

// Caught rather than allowed to propagate: a broken construction should come out of the gate
// below as a named claim, not as a stack trace whose reader has to work out which claim it was.
let shippedOpens = false;
let openError = null;
try {
  shippedOpens = open(sealed, { privateKeys: [shippedKeys[3].priv] }).content_text === 'The grandkids came over.';
} catch (e) { openError = e.message; }
let shippedShuts = false;
try { open(sealed, { privateKeys: [outsiderKey.priv] }); }
catch (e) { shippedShuts = e instanceof EncError; }
say(`  a recipient opens it: ${shippedOpens}${openError ? ` (${openError})` : ''}` +
    `    an outsider is refused: ${shippedShuts}`);

// §15.1's resolution rule, exercised because this file's own `encrypt` takes raw public keys
// and therefore cannot show it: the shipped seal takes identity *documents*, so "resolve the
// key from the recipient's own document" is structural rather than a rule a caller remembers.
let revokedRefused = false;
try {
  encryptionKeyFor({
    url: 'https://retired.example/',
    keys: [{ ...shippedDocs[0].keys[0], revoked_at: 1739577600 }],
  }, { now: 1740000000 });
} catch (e) { revokedRefused = e instanceof EncError; }
say(`  a revoked encryption key is refused to a new sender (§15.1): ${revokedRefused}`);

// ---- gate ---------------------------------------------------------------------------------
// This file had no assertion gate: the correctness line printed the word LEAK as data and the
// process exited 0, so a regression breaking the blinded-tag scheme reported exactly what a
// working one did. `npm run prototypes` was checking that this file still ran.
const claims = [
  ['C opens for its recipients and locks out a stranger',
    correctness.C.first && correctness.C.last && correctness.C.lockedOut],
  ['A and B do too — the comparison is between working schemes',
    correctness.A.first && correctness.A.lockedOut && correctness.B.first && correctness.B.lockedOut],
  ['tags do not relink a recipient across two items (the property banning `kid` protected)',
    tagsRelink === false],
  ['C is no larger than A on the wire at family scale', sizes[30].c <= sizes[30].a],
  ['the shipped envelope carries one shared `epk`, not one per slot', sharedEpk && slotEpks === 0],
  ['every shipped slot carries a `_tag` and no slot carries a `kid`',
    slotTags === envelope.recipients.length && slotKids === 0],
  ['a recipient finds its shipped slot by computing `slotTag` from its own private half', tagFound],
  ['the shipped envelope opens for a recipient and refuses an outsider', shippedOpens && shippedShuts],
  ['§15.1: a revoked encryption key is refused to a new sender', revokedRefused],
];
const broken = claims.filter(([, ok]) => !ok);
if (broken.length) {
  say();
  say('FAIL — these claims no longer hold:');
  for (const [label] of broken) say(`  ${label}`);
  say('Either the prototype is stale or the construction it measures is. Both are findings.');
  process.exit(1);
}

// ---- verdict ----------------------------------------------------------------------------------

rule('VERDICT (adopted — §15.2)');
say(`
  The cost driver in §15.2 is the PER-RECIPIENT EPHEMERAL, not the absence of tags — and the
  two changes only work TOGETHER. Neither hypothesis going in survived the measurement.

    B (share the ephemeral) alone is NOT a clean win, and the K=10 / N=1024 rows show why.
      It takes ECDH from N x K down to K, but it forces the loop inside out: with one
      ephemeral a reader must iterate keys OUTSIDE and slots INSIDE, so every wrong key now
      costs a full sweep of N unwraps. At N=1024, K=10 that is ~9,200 AES unwraps and B lands
      in the hundreds of milliseconds for a recipient in slot 1 — where scheme A, whose
      slot-outer/key-inner order finds an early slot immediately, stays under a millisecond.
      (Exact figures are in the table above, from THIS run — they drift with hardware, which
      is why this prose no longer quotes them.) B is better in the expensive operation
      and worse in the cheap one, and at family scale (N=30) it wins while at N=1024 it loses.

    C (share the ephemeral AND tag the slots) is the one that holds everywhere. The tag makes
      the inner sweep a byte comparison instead of an unwrap, so the loop order stops
      mattering: K ECDH plus at most N x K comparisons, flat. Every case measured stays under
      a millisecond regardless of N, including the case the old §15.5.7 called the common one — a
      NON-RECIPIENT, who under A pays hundreds of milliseconds per item and never exits early.

    Tags cannot be adopted without the shared ephemeral either: with per-recipient ephemerals
    a reader must do the ECDH before it can compute any tag, so tagging alone would save only
    the AES unwrap, the cheap half. The pair was the proposal; neither half was.

  Privacy is unchanged in both. The audience stays undisclosed: an observer holds every
  recipient's published X25519 key and the ephemeral public key and still cannot compute a tag
  without a private half. Tags are per-item because the ephemeral is, so no recipient is
  linkable across two items — the property that made §15.2 ban \`kid\`, preserved exactly.

  One property genuinely weakens, and it should be stated rather than discovered: with a shared
  ephemeral, one leaked ephemeral SECRET exposes the CEK path for every recipient rather than
  one. The ephemeral is generated and discarded inside a single encryption, so this is a
  statement about the encrypting client's memory hygiene, not about anything on the wire, and
  it is the same exposure the CEK itself already has in that process.

  Adopted as ONE change rather than two, and this is what §15.2 now says — confirmed against
  \`src/enc.js\` in the section above rather than assumed:
    - one \`epk\` in the JWE protected header rather than one per recipient
    - a per-recipient \`_tag\`, 8 bytes, domain-separated from the KEK derivation
    - §15.5.7 is gone, and with it both the trial-decryption cap MUST and the "Recipients
      SHOULD attempt keys newest-\`iat\` first" that existed only to make K tolerable
  Net effect: one field added, one MUST, one SHOULD and one magic number removed, and the
  envelope is ~30% smaller at family scale.

  The caveat weighed against adopting it has not gone away, and §15 has since been *promoted* —
  required of any deployment offering audience-restricted content — which raises what is riding
  on it rather than settling anything. Both pieces are standard: a shared ephemeral is how
  multi-recipient ECDH-ES is ordinarily done, and blinded recipient tags are a known
  construction. But standard is not reviewed, and nobody outside this repository has looked at
  any of §15. Everything above is a measurement, and no quantity of measurement substitutes for
  a cryptographer.
`);
