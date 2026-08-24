// Brief G.2 (kimi's reply-to-all bug) and G.1 (slot padding cost), against the SHIPPED src/enc.js.
// Scenario 3 of GOALS.md: Alice posts family-only; Mom replies; does the reply reach the family?
import crypto from 'node:crypto';
import { seal, open, declaredAudience } from '../../../src/enc.js';

const person = (name) => {
  const s = crypto.generateKeyPairSync('x25519');
  return { name, url: `https://${name}.example/me`, priv: s.privateKey,
    doc: { url: `https://${name}.example/me`, keys: [{ kty: 'OKP', crv: 'X25519', use: 'enc', kid: `${name}-1`, iat: 1, x: s.publicKey.export({ format: 'jwk' }).x }] } };
};
const [alice, mom, sister, cousin, grandma] = ['alice', 'mom', 'sister', 'cousin', 'grandma'].map(person);
const family = [mom, sister, cousin, grandma];

const carrier = (id, author) => ({ id, authors: [{ url: author.url }], _openfeed: { feed_url: `${author.url}/feed.json` } });

// --- Alice's family-only post, sealed to four relatives. Two variants: audience declared or not.
const post = carrier('urn:post:1', alice);
const withAud = seal({ item: post, content: { body: 'the divorce is final' }, recipients: family.map((p) => p.doc), audience: family.map((p) => p.url) });
const noAud   = seal({ item: post, content: { body: 'the divorce is final' }, recipients: family.map((p) => p.doc) });

// --- Mom opens it and now wants to reply "to everyone who saw that".
const reach = (envelope, label) => {
  const plaintext = open({ ...post, _openfeed: { ...post._openfeed, enc: envelope } }, { privateKeys: [mom.priv] });
  const audience = declaredAudience(plaintext) ?? null;
  // Whom can Mom's client name? Only the author, unless the audience travelled inside the seal.
  const targets = audience ? [alice, ...family.filter((p) => p !== mom && audience.some((u) => u.replace(/\/$/, '') === p.url))] : [alice];
  const reply = carrier('urn:reply:1', mom);
  const env = seal({ item: reply, content: { body: 'I am so glad you are out' }, recipients: targets.map((t) => t.doc), audience: targets.map((t) => t.url) });
  const who = [alice, ...family].map((p) => {
    try { open({ ...reply, _openfeed: { ...reply._openfeed, enc: env } }, { privateKeys: [p.priv] }); return `${p.name}✓`; }
    catch { return `${p.name}✗`; }
  });
  console.log(`  ${label.padEnd(26)} audience Mom can see: ${audience ? audience.length : 0}   reply reaches: ${who.join(' ')}`);
};

console.log('\nBrief G.2 — does a reply to a family-only post reach the family?\n');
reach(noAud, 'no declared audience');
reach(withAud, 'audience inside ciphertext');
console.log(`
  Reading: with no audience in the sealed bytes, Mom's client knows exactly one other key — Alice's,
  because the carrier binding names the author. Her reply is a DM to Alice. Sister, cousin and
  grandma never see it and are never told it exists; the thread silently splits. Nothing errors.
  (mom✗ in both rows is a second, smaller gotcha: a client must seal to ITSELF or it cannot read
  its own outbox.) This is GOALS.md scenario 3 failing at the reply, and src/enc.js already has the fix (§15.2.2) —
  the sketch has to keep it, because "the names sealed inside" (GOALS.md:87) does not say WHOSE
  names or that readers get them.
`);

// --- Brief G.1: what does hiding the recipient count actually cost?
console.log('Brief G.1 — slot padding cost (real envelopes, bytes of JSON as served)\n');
const size = (e) => Buffer.byteLength(JSON.stringify(e));
const pad = (n) => 1 << Math.ceil(Math.log2(Math.max(n, 1)));
const strangers = Array.from({ length: 64 }, (_, i) => person(`x${i}`));
console.log('   real recipients | unpadded | padded to 2^k | added bytes | what the hub learns');
for (const n of [1, 2, 3, 5, 9, 12]) {
  const rs = [mom, sister, cousin, grandma, ...strangers].slice(0, n);
  const item = carrier(`urn:n:${n}`, alice);
  const plain = seal({ item, content: { body: 'x' }, recipients: rs.map((p) => p.doc) });
  const padded = seal({ item, content: { body: 'x' }, recipients: [...rs, ...strangers.slice(0, pad(n) - n)].map((p) => p.doc) });
  console.log(`   ${String(n).padStart(15)} | ${String(size(plain)).padStart(8)} | ${String(size(padded)).padStart(13)} | ${String(size(padded) - size(plain)).padStart(11)} | "between ${pad(n) === 1 ? 1 : pad(n) / 2 + 1} and ${pad(n)}"`);
}
console.log(`
  Reading: ~130 bytes per garbage slot. Padding to the next power of two costs at most (n-1) slots
  and converts an exact recipient count into a range. For a family of five that is one bucket:
  "between 5 and 8". Note the padded slots here are real keys held by nobody in the audience —
  random bytes work identically, since a non-recipient's cost is a tag miss either way.
`);
