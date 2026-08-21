// Ruling 8's cost, re-measured under rulings 3 and 4. The first version of this file said the ex
// sees each private file "fetched exactly once by the same address in Leeds" and that withholding
// "looks like she went quiet". Both were written before numbered files and the index were ruled.
// Under those rulings every follower fetches every numbered file, and a missing number is caught.
import crypto from 'node:crypto';
import { seal } from '../../../src/enc.js';

const person = (name) => {
  const s = crypto.generateKeyPairSync('x25519');
  return { name, url: `https://${name}.example/me`, doc: { url: `https://${name}.example/me`, keys: [{ kty: 'OKP', crv: 'X25519', use: 'enc', kid: name, iat: 1, x: s.publicKey.export({ format: 'jwk' }).x }] } };
};
const [alice, mum, sister, cousin, gran] = ['alice', 'mum', 'sister', 'cousin', 'gran'].map(person);
const followers = { mum: '81.2.x.x (Kent)', sister: '92.7.x.x (Leeds)', cousin: '5.64.x.x (Bristol)', gran: '86.1.x.x (Kent)' };
const item = (n) => ({ id: `urn:post:${n}`, authors: [{ url: alice.url }] });
const size = (env) => Buffer.byteLength(JSON.stringify(env));
const padTo = (rs, floor) => { const junk = Array.from({ length: Math.max(floor, 1 << Math.ceil(Math.log2(rs.length))) - rs.length }, (_, i) => person(`pad${i}`)); return [...rs, ...junk]; };

// --- 1. What the host's access log shows for a family post and for a DM, when readers fetch every number.
console.log('\n--- 1. The access log under rulings 3+4: every follower fetches every numbered file ---\n');
const posts = [
  { n: 411, label: 'family post (4 recipients)', recipients: [mum, sister, cousin, gran] },
  { n: 412, label: 'DM to her sister',           recipients: [sister] },
];
console.log('  file   fetched by                                                  what the ex can tell');
for (const p of posts) {
  const fetchedBy = Object.keys(followers).join(', ');
  console.log(`  #${p.n}   ${fetchedBy.padEnd(59)} ${p.label.includes('DM') ? 'nothing that distinguishes it from #411 by WHO fetched' : 'an encrypted file, fetched by the whole family'}`);
}
console.log(`
  A reader cannot know which numbered file is for it until it tries its slot tag, so it fetches
  them all. The "one address in Leeds" in the old version of this file does not happen: the
  correspondent is not in the log. What is left is SIZE and RHYTHM.

--- 2. Size: unpadded, padded to a power of two (ruling 9), padded to a floor of 8 ---
`);
console.log('  post                          unpadded   power of 2   floor of 8');
for (const p of posts) {
  const plain = size(seal({ item: item(p.n), content: { body: 'x'.repeat(400) }, recipients: p.recipients.map((r) => r.doc) }));
  const pow2 = size(seal({ item: item(p.n), content: { body: 'x'.repeat(400) }, recipients: padTo(p.recipients, 1).map((r) => r.doc) }));
  const floor8 = size(seal({ item: item(p.n), content: { body: 'x'.repeat(400) }, recipients: padTo(p.recipients, 8).map((r) => r.doc) }));
  console.log(`  ${p.label.padEnd(29)} ${String(plain).padStart(8)}   ${String(pow2).padStart(10)}   ${String(floor8).padStart(10)}`);
}
console.log(`
  Power-of-two padding alone still tells a DM (1 slot) from a family post (4 slots). Padding to a
  floor of eight slots makes them the same size, for about 900 bytes on the DM. After that the ex
  learns "she posted something encrypted", which he learns from every family post anyway.

--- 3. The off switch: he withholds #412 ---
`);
const index = { seq: 130, top: 412, withdrawn: [] };
const served = new Set([410, 411]);   // he declines to serve 412
const missing = Array.from({ length: index.top }, (_, i) => i + 1).filter((n) => n > 409 && !served.has(n) && !index.withdrawn.includes(n));
console.log(`  sister's app: index says top=${index.top}; #${missing.join(', #')} missing and never withdrawn  ->  "this host is withholding"`);
console.log(`  (the old version of this file said this "looks like she went quiet" — not under ruling 4)`);

// --- 4. What remains: the rhythm.
const byWeek = {}; let leaving = false;
for (let w = 1; w <= 52; w++) { if (w === 34) leaving = true; byWeek[w] = leaving ? 4 + (w % 3) : 1; }
console.log('\n--- 4. What remains: rhythm — encrypted files per week, whoever they were for ---\n');
for (let w = 1; w <= 52; w += 3) console.log(`   week ${String(w).padStart(2)}   ${'#'.repeat(byWeek[w])}`);
console.log(`
  He still sees that something changed in week 34. He cannot see that it was her sister, cannot
  tell a DM from a family post, and cannot withhold one without the sister's app naming the
  number he withheld. That is what ruling 8 actually costs under rulings 3, 4 and a padding floor
  — and it is less than the ruling's own text concedes.
`);
