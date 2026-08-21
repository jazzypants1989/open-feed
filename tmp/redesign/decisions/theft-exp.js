// Review finding A6 — ruling 5 puts one key on both devices; ruling 6 lets the old key "object".
// So "lost phone" usually means someone else HAS the key. Alice rotates from her laptop; the thief
// rotates from her phone. Both successions are signed by A. Which one is Alice?
import crypto from 'node:crypto';

const mk = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k.name = n; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const sign = (msg, k) => crypto.sign(null, Buffer.from(msg), k.privateKey).toString('base64url');
const ok = (msg, sig, x) => crypto.verify(null, Buffer.from(msg), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }), Buffer.from(sig, 'base64url'));

const A = mk('A, on phone and laptop'), B = mk('B, Alice\'s new key'), C = mk('C, the thief\'s new key'), mum = mk('mum');
const succession = (to, signer) => ({ from: pub(A), to: pub(to), by: signer.name, sig: sign(`${pub(A)}->${pub(to)}`, signer) });
const objection = (against, signer) => ({ against: pub(against), by: signer.name, sig: sign(`object:${pub(against)}`, signer) });

const alices = succession(B, A);     // laptop: "B succeeds A", signed by A
const thiefs = succession(C, A);     // phone:  "C succeeds A", signed by A

console.log('\nTwo successions from the same key\n');
for (const s of [alices, thiefs]) console.log(`  ${s.by.padEnd(24)} "${s.to.slice(0, 8)}… succeeds A"   valid under "signed by A": ${ok(`${s.from}->${s.to}`, s.sig, pub(A))}`);

// The host — the ex — holds the head under CAS. Whichever write he accepts first is "the" profile.
console.log(`\n  the host's CAS picks the winner: he accepts the thief's first, refuses Alice's as stale.`);
console.log(`  a reader fetching the head sees C, correctly signed by A, and has no reason to doubt it.`);

// Ruling 6's objection: "the real owner still holds their key and objects". Both do.
console.log('\n  objections, per ruling 6:');
for (const o of [objection(C, A), objection(B, A)]) {
  console.log(`     against ${o.against.slice(0, 8)}…  signed by A   valid: ${ok(`object:${o.against}`, o.sig, pub(A))}   (raised by ${o.against === pub(C) ? 'Alice' : 'the thief'})`);
}
console.log(`
  Both objections verify. Both successions verify. The reader holds identical evidence for two
  stories, and the host chose which one it saw first. "Signed by A" decides nothing once A is in
  two hands — which, under ruling 5, is what every lost phone looks like.

--- The tie-break the design already has ---
`);
const recoveryList = [pub(mum)];
const vouch = (to) => ({ to: pub(to), sig: sign(`vouch:${pub(A)}->${pub(to)}`, mum) });
const mumVouches = vouch(B);
const decide = (candidates, vouchers) => candidates.filter((s) => vouchers.some((v) => v.to === s.to && recoveryList.includes(pub(mum)) && ok(`vouch:${s.from}->${s.to}`, v.sig, pub(mum))));
const winner = decide([alices, thiefs], [mumVouches]);
console.log(`  rule: a succession signed by A alone is final only while uncontested; two of them are a`);
console.log(`        contest, and the contest goes to whichever the NAMED RECOVERERS vouch for.`);
console.log(`  mum vouches for B  ->  reader follows ${winner.length === 1 && winner[0].to === pub(B) ? 'B (Alice)' : 'nobody'}; C is shown as a contested branch.`);
console.log(`
  This unifies rotation and restore — the recovery list is the court for both — and it costs a
  reader state the rulings have not counted yet: "contested". GOALS.md:69 retires fork resolution;
  ruling 5 quietly brings the fork back, and something has to rule on it.
`);
