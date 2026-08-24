// Decision 3 — how an app writes to a host. Two things that go wrong.
import crypto from 'node:crypto';

const alice = crypto.generateKeyPairSync('ed25519');
const stampBytes = (bytes) => crypto.sign(null, bytes, alice.privateKey).toString('base64url');
const checkBytes = (bytes, s) => { try { return crypto.verify(null, bytes, alice.publicKey, Buffer.from(s, 'base64url')); } catch { return false; } };

// Alice's app builds a post and stamps THE EXACT BYTES it is about to upload.
const bodyBytes = Buffer.from('{"n":4,"body":"her first word"}');
const stamp = stampBytes(bodyBytes);

console.log('\n--- 1. The host that tries to be helpful ---\n');
const hosts = {
  'stores the bytes as given':      (b) => b,
  'pretty-prints the JSON':         (b) => Buffer.from(JSON.stringify(JSON.parse(b.toString()), null, 2)),
  'adds a newline at the end':      (b) => Buffer.concat([b, Buffer.from('\n')]),
  'sorts the keys "for tidiness"':  (b) => { const o = JSON.parse(b.toString()); return Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]])))); },
};
for (const [what, transform] of Object.entries(hosts)) {
  const served = transform(bodyBytes);
  console.log(`  host ${what.padEnd(32)} reader says: ${checkBytes(served, stamp) ? 'fine' : 'STAMP DOES NOT CHECK OUT — reads as forgery'}`);
}

console.log(`
  None of these hosts is hostile. Every one of them is a normal thing a web server or a framework
  does without being asked. Three of the four make every post Alice ever wrote look forged.

--- 2. Her phone and her laptop post at the same moment ---
`);

const post = (n, body) => { const b = Buffer.from(JSON.stringify({ n, body })); return { n, bytes: b, stamp: stampBytes(b) }; };

const schemes = {
  'one file, overwritten':   { path: () => '/alice/latest.json',           rejectIfExists: false },
  'a number that goes up':   { path: (p) => `/alice/posts/${p.n}`,          rejectIfExists: true  },
  'named by its fingerprint':{ path: (p) => `/alice/objects/${crypto.createHash('sha256').update(p.bytes).digest('hex').slice(0, 12)}`, rejectIfExists: true },
};

for (const [name, scheme] of Object.entries(schemes)) {
  const disk = new Map();
  const write = (p) => {
    const at = scheme.path(p);
    if (scheme.rejectIfExists && disk.has(at)) return `refused (${at} already exists)`;
    disk.set(at, p);
    return `wrote ${at}`;
  };
  const fromPhone = write(post(7, 'we found a house'));
  const fromLaptop = write(post(7, 'call your sister'));
  const survived = [...disk.values()].map((p) => `"${JSON.parse(p.bytes.toString()).body}"`);
  console.log(`  ${name.padEnd(27)} phone: ${fromPhone.padEnd(34)}`);
  console.log(`  ${''.padEnd(27)} laptop: ${fromLaptop.padEnd(34)}`);
  console.log(`  ${''.padEnd(27)} still on the host afterwards: ${survived.join(', ')}\n`);
}

console.log(`  Row 1 loses a post silently: the second write lands on top of the first and there is no
  trace it existed. Rows 2 and 3 cannot lose one, because the second write has nowhere to go —
  the host refuses it and the laptop tries again as post 8.

  The difference between rows 2 and 3: with a fingerprint name, nothing can ever be swapped out
  from under a name, because the name IS the content. The cost is that the names are unguessable,
  so a reader can only find your posts through a list — which makes the little signed index
  (the next decision) mandatory rather than optional.
`);
