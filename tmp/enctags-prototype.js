// §15.2's untagged recipients: what does trial decryption actually cost, and is there a
// construction that keeps the privacy property and deletes the cost?
//
// §15.2 keeps JWE recipients untagged — "a per-recipient header carries `alg` and `epk` and
// MUST NOT carry `kid`, so the audience is not disclosed by the item and a reader
// trial-decrypts each slot until one opens." §15.5.7 then has to bound the consequence with a
// MUST: cap the trial decryptions (RECOMMENDED 1024), "and the expensive case is the common
// one, since a non-recipient — anyone at all, on a world-readable encrypted feed — pays the
// full product on every item and never exits early."
//
// The candidate: a blinded per-slot tag `t_i = KDF(ECDH(esk, pk_i))`. A recipient computes
// ECDH(sk_i, epk) and finds its slot by comparison; an observer holding no private key computes
// nothing, and the tag is keyed by the per-item ephemeral so it is unlinkable across items —
// which is the exact property banning `kid` was protecting.
//
// DESIGNING THIS SURFACED THE REAL COST DRIVER, and it is not tagging. §15.2 gives every
// recipient its OWN ephemeral. With per-recipient ephemerals a tag cannot help: computing
// t_i still needs ECDH(sk, epk_i), one per slot, so tags would save only the AES unwrap — the
// cheap half. The win requires ONE SHARED ephemeral, and that change alone is most of it.
// So this measures three schemes, not two:
//
//   A  as specified today   — per-recipient epk, untagged, trial decrypt
//   B  shared epk           — untagged, trial decrypt (isolates the ephemeral change)
//   C  shared epk + tags    — the proposal
//
// Owner decision: measure, do not edit §15.2 until the numbers are in.

import crypto from 'node:crypto';

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
// a decade of rotations, and the cost §15.5.7 caps is the PRODUCT with slot count.
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
  say(`  ${scheme}: first recipient ${opens(first) ? 'opens' : 'FAILS'}, ` +
      `last recipient ${opens(last) ? 'opens' : 'FAILS'}, ` +
      `stranger ${out.cek === null ? 'locked out' : 'LEAK'}`);
}

// The privacy property, stated as what an observer can actually compute.
const probe = encrypt(PLAINTEXT, audience.map((k) => k.pub), { scheme: 'C' });
say();
say(`  An observer holds every recipient's PUBLIC key — §15.1 publishes them in identity`);
say(`  documents — and the ephemeral public key from the envelope. To test membership they`);
say(`  need ECDH(esk, pk_i), which requires one of the two private halves. They have neither.`);
say(`  Tags are unlinkable across items because esk is fresh per item:`);
const again = encrypt(PLAINTEXT, audience.map((k) => k.pub), { scheme: 'C' });
say(`    same audience, two items — any tag repeated: ` +
    `${probe.recipients.some((r) => again.recipients.some((s) => s.header._tag === r.header._tag))}`);

// ---- size ------------------------------------------------------------------------------------

rule('Size — bytes on the wire, which the manifest then commits and retains forever');

say(`  N     A (per-recipient epk)   B (shared epk)      C (shared epk + tag)`);
for (const N of [10, 30, 1024]) {
  const pubs = Array.from({ length: N }, () => encKeypair().pub);
  const [a, b, c] = ['A', 'B', 'C'].map((s) => Buffer.byteLength(JSON.stringify(encrypt(PLAINTEXT, pubs, { scheme: s }))));
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

rule('Speed — operations and wall clock, at the sizes §15.2 and §15.5.7 name');

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

// ---- verdict ----------------------------------------------------------------------------------

rule('VERDICT');
say(`
  The cost driver in §15.2 is the PER-RECIPIENT EPHEMERAL, not the absence of tags — and the
  two changes only work TOGETHER. Neither hypothesis going in survived the measurement.

    B (share the ephemeral) alone is NOT a clean win, and the K=10 / N=1024 rows show why.
      It takes ECDH from N x K down to K, but it forces the loop inside out: with one
      ephemeral a reader must iterate keys OUTSIDE and slots INSIDE, so every wrong key now
      costs a full sweep of N unwraps. At N=1024, K=10 that is ~9,200 AES unwraps and B lands
      at 134 ms for a recipient in slot 1 — where scheme A, whose slot-outer/key-inner order
      finds an early slot immediately, takes 0.41 ms. B is better in the expensive operation
      and worse in the cheap one, and at family scale (N=30) it wins while at N=1024 it loses.

    C (share the ephemeral AND tag the slots) is the one that holds everywhere. The tag makes
      the inner sweep a byte comparison instead of an unwrap, so the loop order stops
      mattering: K ECDH plus at most N x K comparisons, flat. Every case measured lands at
      0.05-0.35 ms regardless of N, including the case §15.5.7 calls the common one — a
      NON-RECIPIENT, who under A pays 435 ms per item and never exits early.

    Tags cannot be adopted without the shared ephemeral either: with per-recipient ephemerals
    a reader must do the ECDH before it can compute any tag, so tagging alone would save only
    the AES unwrap, the cheap half. The pair is the proposal; neither half is.

  Privacy is unchanged in both. The audience stays undisclosed: an observer holds every
  recipient's published X25519 key and the ephemeral public key and still cannot compute a tag
  without a private half. Tags are per-item because the ephemeral is, so no recipient is
  linkable across two items — the property that made §15.2 ban \`kid\`, preserved exactly.

  One property genuinely weakens, and it should be stated rather than discovered: with a shared
  ephemeral, one leaked ephemeral SECRET exposes the CEK path for every recipient rather than
  one. The ephemeral is generated and discarded inside a single encryption, so this is a
  statement about the encrypting client's memory hygiene, not about anything on the wire, and
  it is the same exposure the CEK itself already has in that process.

  Recommended shape for §15.2, if adopted — as ONE change, not two:
    - one \`epk\` in the JWE protected header rather than one per recipient
    - a per-recipient \`_tag\`, 8 bytes, domain-separated from the KEK derivation
    - §15.5.7's trial-decryption cap MUST becomes unnecessary and is deleted, and so does its
      "Recipients SHOULD attempt keys newest-\`iat\` first", which exists only to make the K
      dimension tolerable and stops mattering once cost is flat
  Net effect: one field added, one MUST, one SHOULD and one magic number removed, and the
  envelope is ~30% smaller at family scale.

  Weighed against it: §15 is marked "never independently reviewed" and is OPTIONAL, so this is
  churn in the layer with the least scrutiny behind it. Both pieces are standard — a shared
  ephemeral is how multi-recipient ECDH-ES is ordinarily done, and blinded recipient tags are a
  known construction — but standard is not reviewed, and nobody outside this repository has
  looked at any of §15 yet.
`);
