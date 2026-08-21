// Decision 2, reopened now that the index exists. Alice's app forgot; her host is gone.
// How much can she rebuild from her family, and can she tell what is still missing?
import crypto from 'node:crypto';

const alice = crypto.generateKeyPairSync('ed25519');
const sign = (o) => { const b = Buffer.from(JSON.stringify(o)); return { n: o.n, bytes: b, stamp: crypto.sign(null, b, alice.privateKey).toString('base64url') }; };
const ok = (f) => crypto.verify(null, f.bytes, alice.publicKey, Buffer.from(f.stamp, 'base64url'));

const TOP = 1560, WITHDRAWN = [78, 156, 234];
const everything = Array.from({ length: TOP }, (_, i) => i + 1).filter((n) => !WITHDRAWN.includes(n)).map((n) => sign({ n, body: `post ${n}` }));

// The last index Alice stamped. She has this because it is 138 bytes and her app keeps it.
const index = sign({ n: 'index', seq: 412, top: TOP, withdrawn: WITHDRAWN });

// Who kept what. Nobody kept everything, and the family-only posts only reached the family.
const held = {
  'her mother (reads everything)': everything.filter((p) => p.n % 1 === 0 && p.n > 200),
  'her sister (joined in 2021)':   everything.filter((p) => p.n > 700),
  'a cousin (public posts only)':  everything.filter((p) => p.n % 3 === 0),
};

const recovered = new Map();
console.log('\nAlice arrives at a new host with her key, her index, and nothing else.\n');
for (const [who, posts] of Object.entries(held)) {
  const before = recovered.size;
  for (const p of posts) if (ok(p)) recovered.set(p.n, p);          // the stamp still checks out
  console.log(`  ${who.padEnd(32)} +${String(recovered.size - before).padStart(4)} posts   (running total ${recovered.size})`);
}

const expected = Array.from({ length: TOP }, (_, i) => i + 1).filter((n) => !WITHDRAWN.includes(n));
const missing = expected.filter((n) => !recovered.has(n));
console.log(`\n  her own stamped index says there should be ${expected.length} posts.`);
console.log(`  she has ${recovered.size}. she is missing ${missing.length}, and she knows exactly which:`);
console.log(`    ${missing.slice(0, 12).map((n) => '#' + n).join(', ')}${missing.length > 12 ? ', ...' : ''}`);
console.log(`
This is the part the 138-byte index buys that was not obvious when we ruled on it. Handing the
archive back was already possible — a stamp travels with the bytes. What the index adds is that
Alice can tell when the handing-back is DONE, and can go ask a specific relative for a specific
list of numbers instead of hoping.

It also means her own app can say, on a settings screen, "you are holding 1,204 of your 1,557
posts on this device" — so "keep what you publish" stops being a rule nobody can check and becomes
a number Alice can look at.
`);
