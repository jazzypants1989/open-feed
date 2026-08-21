// persig-gate: admission plus a per-post signature, or a head-only signature? What each one
// stops, what a withdrawn post is worth under each, and what the per-post signature costs
// against the traffic it is weighed against.
// Kill criteria: a well-signed unlisted post admitted; a withdrawn post unattributable with its
// own signature; a per-post signature costing other than 87 bytes; a Merkle proof cheaper than it.
import { makeKey, sign, split, verify, address, makeHead, admitted, entry } from './lastline.js';

const alice = makeKey('alice'), stolen = makeKey('a key once Alice\'s');
const chainKeys = [alice.x, stolen.x];
const signedByChain = (f) => chainKeys.some((x) => verify(f, x));

const posts = Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, sign({ n, body: `post ${n}` }, alice)]));
const head40 = makeHead({ hseq: 40, entries: [1, 2, 3, 4, 5].map((n) => entry(n, posts[n])) }, alice);
const injected = sign({ n: 6, body: 'send money here' }, stolen);
const head41 = makeHead({ hseq: 41, prev: address(head40), entries: [1, 2, 4, 5].map((n) => entry(n, posts[n])) }, alice);

// Head-only signing, modelled: posts are bare bodies, the head is the only signature, and the
// keeper of a withdrawn post holds its bytes but no superseded head.
const headOnlyAttributable = (postFile, currentHead) => admitted(currentHead, split(postFile).body.length && JSON.parse(split(postFile).body).n, postFile, alice.x);

// The price, at the scales headrange.js uses. Head egress figures are that script's year-10,
// daily, e=5% numbers; re-run it before quoting them.
const SIG_BYTES = posts[1].length - split(posts[1]).body.length;
const scales = [
  ['family  1,557 posts', 1557, 1, 1.0e6],
  ['active  100k posts', 100000, 1, 1.43e9],
  ['journal 100k posts, 10k followers', 100000, 10000, 14.32e12],
];
const merkleProof = (N) => Math.ceil(Math.log2(N)) * 43;

const fmt = (b) => (b >= 1e12 ? `${(b / 1e12).toFixed(2)} TB` : b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(3)} MB`).padStart(11);
console.log('  scale                               all sigs, whole archive   head egress, one year (e=5%, daily)   sig share');
for (const [name, N, followers, headEgress] of scales) {
  const sigs = N * SIG_BYTES * followers;
  console.log(`  ${name.padEnd(35)} ${fmt(sigs)}               ${fmt(headEgress)}                          ${(100 * sigs / headEgress).toFixed(2).padStart(6)}%`);
}
console.log(`  Merkle inclusion proof for one withdrawn post: ${merkleProof(1557)} B at 1,557, ${merkleProof(100000)} B at 100k — plus the retained signed head\n`);

const gate = [
  ['a well-signed post the head does not list is refused (admission on)', signedByChain(injected) && !admitted(head40, 6, injected, alice.x)],
  ['the same post is shown as Alice\'s with admission off — the signature alone admits it', signedByChain(injected)],
  ['a withdrawn post stays attributable to Alice by its own signature', !admitted(head41, 3, posts[3], alice.x) && verify(posts[3], alice.x)],
  ['under head-only signing the same withdrawn post is inert — nothing vouches for it', !headOnlyAttributable(posts[3], head41)],
  [`a per-post signature costs exactly 87 bytes (86 + separator)`, SIG_BYTES === 87],
  ['a Merkle inclusion proof for a withdrawn post costs more than its own signature at every scale', merkleProof(1557) > SIG_BYTES && merkleProof(100000) > SIG_BYTES],
  ['the whole archive\'s per-post signatures cost less than one year of head egress at every scale', scales.every(([, N, f, egress]) => N * SIG_BYTES * f < egress)],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('persig-gate: all claims hold');
console.log('  note: a per-post signature on a DM makes it non-repudiable; head-only signing would make it deniable. The design chooses the first without saying so.');
