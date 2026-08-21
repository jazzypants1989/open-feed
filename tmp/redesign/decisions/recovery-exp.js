// Decision 6 — Grandma loses her phone. Who is allowed to say "this new key is her now"?
import crypto from 'node:crypto';
import { seal, open } from '../../../src/enc.js';

const mk = (name) => { const k = crypto.generateKeyPairSync('ed25519'); k.name = name; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const sign = (o, k) => crypto.sign(null, Buffer.from(JSON.stringify(o)), k.privateKey).toString('base64url');

const aliceOld = mk('Alice (lost phone)'), aliceNew = mk('Alice (new phone)'), bobsKey = mk('a key Bob controls');
const bob = mk('Bob, the ex'), mum = mk('her mother'), sister = mk('her sister'),
      familyKey = mk('the shared family key, which lives on Bob\'s hub'), bobsBrother = mk('Bob\'s brother');

// The claim is the same shape either way: "this new key is Alice now", plus who put their name to it.
const claim = (replacing, withKey, whoSigns) => ({
  what: { replacing: pub(replacing), withKey: pub(withKey) },
  signedBy: whoSigns.map((s) => ({ key: pub(s), name: s.name, stamp: sign({ replacing: pub(replacing), withKey: pub(withKey) }, s) })),
});

// During the marriage they set up five people who could vouch, any three of whom suffice.
// After the separation Bob controls three of the five.
const takeover = claim(aliceOld, bobsKey, [bob, familyKey, bobsBrother]);
const genuine  = claim(aliceOld, aliceNew, [mum, sister]);

// Alice, back when she still had her key, named exactly two people who may ever vouch for her.
const namedInAdvance = [pub(mum), pub(sister)];

const rules = {
  'people the reader happens to trust': (c, reader) => c.signedBy.filter((s) => reader.trusts.includes(s.key)).length >= 3,
  'people Alice named in advance':      (c) => c.signedBy.some((s) => namedInAdvance.includes(s.key)),
  'people Alice named, plus "are you sure?"': (c, reader) => c.signedBy.some((s) => namedInAdvance.includes(s.key)) && reader.gotAPhoneCall,
};

// Mum has known Bob for fifteen years and follows him. Her sister never did.
const mumPhone    = { who: 'her mother', trusts: [bob, mum, sister, familyKey, bobsBrother].map(pub), gotAPhoneCall: true };
const sisterPhone = { who: 'her sister', trusts: [mum, sister].map(pub),                              gotAPhoneCall: false };

console.log('\nThe same signed claim arrives on two phones\n');
console.log('  rule                                        the claim        mother     sister     same answer?');
for (const [name, rule] of Object.entries(rules)) {
  for (const [label, c] of [['Bob\'s takeover', takeover], ['Alice\'s real one', genuine]]) {
    const m = rule(c, mumPhone), s = rule(c, sisterPhone);
    console.log(`  ${name.padEnd(43)} ${label.padEnd(16)} ${(m ? 'accepts' : 'refuses').padEnd(10)} ${(s ? 'accepts' : 'refuses').padEnd(10)} ${m === s ? 'yes' : 'NO'}`);
  }
}

console.log(`
Row 1 is what your notes say today, and it fails in both directions at once.

  It lets Bob in. He is a peer her mother already trusts — he was family for fifteen years, and
  that is the whole point of the phrase. Her mother's phone accepts his three signatures without
  asking anyone, and from that moment Bob posts as Alice to her own mother.

  And it keeps Alice out. Her real recovery, vouched for by her mother and her sister, is refused
  by everybody — two honest signatures do not reach a bar that Bob clears with three captured ones.

  Worst of all it does not fail loudly. Her mother and her sister now disagree about who Alice is,
  both are certain, neither gets a warning, and the bytes are identical on both phones. Nothing in
  your design looks for that, because everything that looks for a split assumes the two sides are
  holding different bytes.

Rows 2 and 3 agree with each other because the question stopped being "who does the reader trust"
and became "who did Alice name" — a fact about Alice, the same on every phone.
`);

// --- naming people in advance without telling the world who they are
const commit = (keys) => crypto.createHash('sha256').update([...keys].sort().join('|')).digest('base64url');
console.log('Can she name them without publishing the list?\n');
console.log(`  in her profile:            "recovery": "${commit(namedInAdvance).slice(0, 16)}…"   (a fingerprint of the list)`);
console.log(`  at recovery, mum + sister: ${commit(namedInAdvance) === commit(namedInAdvance) ? 'the list matches the fingerprint, so it is the real list' : ''}`);
console.log(`  if Bob offers his own list: ${commit([pub(bob), pub(bobsBrother)]) === commit(namedInAdvance) ? 'matches' : 'does not match the fingerprint — refused before any signature is even read'}`);

// --- what a new key cannot do
const x = (n) => { const k = crypto.generateKeyPairSync('x25519'); k.name = n; return k; };
const oldEnc = x('old'), newEnc = x('new');
const doc = (k) => ({ url: 'https://alice.example/me', keys: [{ kty: 'OKP', crv: 'X25519', use: 'enc', kid: k.name, iat: 1, x: k.publicKey.export({ format: 'jwk' }).x }] });
const item = { id: 'urn:old:1', authors: [{ url: 'https://mum.example/me' }] };
const env = seal({ item, content: { body: 'photos of the kids' }, recipients: [doc(oldEnc)] });
const tryRead = (k) => { try { open({ ...item, _openfeed: { enc: env } }, { privateKeys: [k.privateKey] }); return 'she can read it'; } catch { return 'GONE — nothing can recover it'; } };

console.log(`\nWhat getting her identity back does NOT get back\n`);
console.log(`  private posts sent to her, with only the new key:            ${tryRead(newEnc)}`);
console.log(`  ...if the old reading key was tucked into the backup too:    ${tryRead(oldEnc)}`);
console.log(`
  Two different keys do two different jobs: one stamps what she writes, one unlocks what others
  sealed to her. Every rule above is about the stamping one. If the reading key is not carried
  along somehow, "Grandma is back" means back with an empty history, and no amount of vouching
  fixes it — the words are simply unreadable by anyone alive.
`);
