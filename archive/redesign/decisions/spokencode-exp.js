// Review finding B1 — how strong is the spoken code in firstcontact-exp.js, and what would be?
// The ex's job: make a key whose code matches the one Alice read out, then serve a profile under
// that key. Each try is one keygen and one hash. This file measures how many he can do.
import crypto from 'node:crypto';

const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const words = ['marble', 'violet', 'ember', 'cedar', 'quartz', 'harbor', 'lantern', 'thistle', 'copper', 'meadow'];
// Exactly the code from firstcontact-exp.js: two words from ten, plus one byte as digits.
const code = (x) => { const h = crypto.createHash('sha256').update(Buffer.from(x, 'base64url')).digest(); return `${words[h[0] % 10]}-${words[h[1] % 10]}-${String(h[2]).padStart(2, '0')}`; };

const alice = crypto.generateKeyPairSync('ed25519');
const target = code(pub(alice));
const t0 = process.hrtime.bigint(); let tries = 0;
for (;;) { tries++; if (code(pub(crypto.generateKeyPairSync('ed25519'))) === target) break; }
const secs = Number(process.hrtime.bigint() - t0) / 1e9;
const rate = tries / secs;

console.log(`\nThe code in firstcontact-exp.js: "${target}"\n`);
console.log(`  possible codes      10 × 10 × 256 = 25,600  (~${Math.log2(25600).toFixed(1)} bits)`);
console.log(`  ex's collision      after ${tries.toLocaleString()} keygens in ${secs.toFixed(2)} s  (${Math.round(rate).toLocaleString()} tries/s, one laptop core)\n`);

console.log('  If the code carried more bits, at the same rate (single core; a GPU is ~1,000× faster):\n');
console.log('  bits   shape                                     expected time, one core      one GPU');
const fmt = (days) => days * 86400 < 60 ? `${(days * 86400).toFixed(1)} seconds` : days < 1 ? `${(days * 24).toFixed(1)} hours` : days < 3650 ? `${Math.round(days).toLocaleString()} days` : `${(days / 365).toExponential(1)} years`;
for (const [bits, shape] of [[14.6, 'firstcontact-exp.js as written'], [40, 'glm: eight digits / three words'], [55, 'five words from a 2,048-word list'], [66, 'six words from a 2,048-word list']]) {
  const days = 2 ** bits / rate / 86400;
  console.log(`  ${String(bits).padEnd(6)} ${shape.padEnd(41)} ${fmt(days).padEnd(28)} ${fmt(days / 1000)}`);
}

// The other lever: make each guess expensive with a slow hash from the standard library.
const salt = Buffer.from('openfeed-spoken-code');
const slow = (x) => crypto.scryptSync(Buffer.from(x, 'base64url'), salt, 8, { N: 2 ** 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const s0 = process.hrtime.bigint(); slow(pub(alice)); const slowSecs = Number(process.hrtime.bigint() - s0) / 1e9;
console.log(`\n  Or keep 40 bits and derive the code with scrypt (N=2^14, in node:crypto and Python's hashlib):`);
console.log(`     honest verifier pays   ${(slowSecs * 1000).toFixed(0)} ms, once, on the phone call`);
console.log(`     the ex pays            2^40 × ${(slowSecs * 1000).toFixed(0)} ms = ${fmt(2 ** 40 * slowSecs / 86400)} on one core (GPUs help far less with scrypt)`);

console.log(`
  Reading: the experiment's code was a toy and the ruling inherited it as "five syllables" with no
  bit count. glm's 40 bits is not enough against the adversary this protocol is named for — a
  family member with a gaming PC and a grudge. Either say "five or six words from a 2,048-word
  list" (no new primitive; still something a person can read down a phone) or keep a short code
  and make each guess cost a second. The first is simpler; the ruling should pick one and state
  the number.
`);
