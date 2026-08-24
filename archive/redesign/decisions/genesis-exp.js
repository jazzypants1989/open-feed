// Review finding A2 — ruling 1 says the link carries "the key"; ruling 6 says a restore changes
// the key. The cousin finds last year's Christmas card with Alice's link on it, after Alice has
// lost her phone and been restored. Does the link still work?
import crypto from 'node:crypto';

const mk = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k.name = n; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const sha = (s) => crypto.createHash('sha256').update(s).digest('base64url').slice(0, 22);
const sign = (o, k) => ({ ...o, stamp: crypto.sign(null, Buffer.from(JSON.stringify(o)), k.privateKey).toString('base64url') });
const verify = (doc, x) => { const { stamp, ...body } = doc; try { return crypto.verify(null, Buffer.from(JSON.stringify(body)), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }), Buffer.from(stamp, 'base64url')); } catch { return false; } };

const G = mk('Alice, genesis key'), N = mk('Alice, after the restore'), mum = mk('mum');
const recoveryList = [pub(mum)];

// A profile carries its genesis and the chain of keys from genesis to now. Each hop is either
// signed by the previous key (rotation) or vouched by someone on the list (restore).
const profileBefore = sign({ genesis: pub(G), chain: [{ key: pub(G) }], current: pub(G) }, G);
const restoreHop = { key: pub(N), restore: { vouchers: [{ key: pub(mum), stamp: crypto.sign(null, Buffer.from(`${pub(G)}->${pub(N)}`), mum.privateKey).toString('base64url') }] } };
const profileAfter = sign({ genesis: pub(G), chain: [{ key: pub(G) }, restoreHop], current: pub(N) }, N);

// Walk the chain: does this profile legitimately descend from the genesis the link names?
function chainHolds(p) {
  if (!verify(p, p.current)) return false;
  if (p.chain[0].key !== p.genesis) return false;
  for (let i = 1; i < p.chain.length; i++) {
    const hop = p.chain[i], prev = p.chain[i - 1].key;
    const msg = Buffer.from(`${prev}->${hop.key}`);
    const vouched = hop.restore?.vouchers.some((v) => recoveryList.includes(v.key) && crypto.verify(null, msg, crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: v.key }, format: 'jwk' }), Buffer.from(v.stamp, 'base64url')));
    const rotated = hop.rotation && verify({ ...hop, stamp: hop.rotation }, prev);
    if (!vouched && !rotated) return false;
  }
  return p.chain[p.chain.length - 1].key === p.current;
}

// Two things a link (or a spoken code, or ruling 7's gossip field) could carry.
const links = {
  'the current key (ruling 1 as written)': { carries: pub(G), check: (p, c) => p.current === c && verify(p, c) },
  'the genesis id (hash of the first key)': { carries: sha(pub(G)), check: (p, c) => sha(p.genesis) === c && chainHolds(p) },
};

console.log('\nThe cousin scans last year\'s link\n');
console.log('  what the link carries                       before the restore      after the restore');
for (const [name, l] of Object.entries(links)) {
  const before = l.check(profileBefore, l.carries) ? 'accept' : 'REFUSE';
  const after = l.check(profileAfter, l.carries) ? 'accept' : 'REFUSE';
  console.log(`  ${name.padEnd(43)} ${before.padEnd(23)} ${after}`);
}
// And the forgery the link exists to stop, under the genesis shape:
const ex = mk('the ex');
const forged = sign({ genesis: pub(ex), chain: [{ key: pub(ex) }], current: pub(ex) }, ex);
const smuggled = sign({ genesis: pub(G), chain: [{ key: pub(G) }, { key: pub(ex), restore: { vouchers: [{ key: pub(ex), stamp: 'x' }] } }], current: pub(ex) }, ex);
console.log(`\n  the ex's own profile under the genesis link       ${links['the genesis id (hash of the first key)'].check(forged, sha(pub(G))) ? 'accept' : 'REFUSE'}`);
console.log(`  the ex claiming a restore nobody named vouched    ${links['the genesis id (hash of the first key)'].check(smuggled, sha(pub(G))) ? 'accept' : 'REFUSE'}`);

console.log(`
  Reading: under ruling 1 as written, every link Alice ever sent, every code anyone wrote down,
  and the key ruling 7 puts in Mom's replies all stop matching the day she is restored. The fix
  is the one CANDIDATES.md's LOG+KEY candidate already had: the identity is the GENESIS key (or
  its hash); the profile carries the succession chain; the link, the spoken code, and the gossip
  field all name the genesis, and a reader walks the chain to the current key. One sentence,
  but three rulings currently assume three different things about what "the key" means.
`);
