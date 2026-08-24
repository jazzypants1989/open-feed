// Holistic pass, part 2 of 2 — the head and the pins.
// Config: HEAD = {hseq, prev, entries:[[n, hash]]} signed by the current key; a POST is signed by a
// chain key AND admitted only if the head lists its hash; a REFERENCE (reply/reaction) carries the
// target's (genesis, n, hash, location) and a PIN (hseq, hash) of the target's head as the replier saw it.
import crypto from 'node:crypto';

const mk = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k._n = n; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const keyObj = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
const H = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const sign = (obj, k) => { const body = Buffer.from(JSON.stringify(obj)); const sig = crypto.sign(null, body, k.privateKey).toString('base64url'); return Buffer.concat([body, Buffer.from('\n'), Buffer.from(sig)]); };
const parse = (f) => { const s = f.lastIndexOf(0x0a); const body = f.subarray(0, s); return { body, obj: JSON.parse(body.toString()), sig: f.subarray(s + 1).toString() }; };
const fileOK = (f, x) => { try { const { body, sig } = parse(f); return crypto.verify(null, body, keyObj(x), Buffer.from(sig, 'base64url')); } catch { return false; } };

const alice = mk('alice-current'), stolen = mk('a key once Alice\'s'), mom = mk('mom'), cousin = mk('cousin');
const chainKeys = [pub(alice), pub(stolen)];   // both are/were Alice's

// ============================================================
console.log('\n============================================================');
console.log('ISSUE 2 — post signature AND head admission: redundant, or two different jobs?');
console.log('============================================================\n');
const posts = {};
for (const n of [1, 2, 3, 4, 5]) posts[n] = sign({ n, body: `post ${n}` }, alice);
const entry = (n, f) => [n, H(parse(f).body)];
let liveHead = sign({ hseq: 40, entries: [1, 2, 3, 4, 5].map((n) => entry(n, posts[n])) }, alice);

// Attack: the host injects #6, validly signed by the once-Alice's stolen key, NOT in the head.
const injected = sign({ n: 6, body: 'send money here' }, stolen);
const admitted = (head, n, f) => { const e = parse(head).obj.entries.find(([m]) => m === n); return !!e && e[1] === H(parse(f).body); };
const sigByChain = (f) => chainKeys.some((x) => fileOK(f, x));

console.log('  (a) does ADMISSION (head lists the hash) stop a well-signed injected post?');
console.log(`      injected #6 signed by a chain key: ${sigByChain(injected)}   admitted by the head: ${admitted(liveHead, 6, injected)}`);
console.log(`      -> shown as Alice's with admission ON:  ${sigByChain(injected) && admitted(liveHead, 6, injected)}`);
console.log(`      -> shown as Alice's with admission OFF: ${sigByChain(injected)}   (revert-check: injection lands)\n`);

console.log('  (b) does the POST SIGNATURE do anything the head does not? Withdraw #3, then ask Mom —');
console.log('      who kept #3 — to prove Alice wrote it.');
const afterWithdraw = sign({ hseq: 41, prev: H(parse(liveHead).body), entries: [1, 2, 4, 5].map((n) => entry(n, posts[n])) }, alice);
console.log(`      #3 still in the current head?                       ${admitted(afterWithdraw, 3, posts[3])}   (withdrawn)`);
console.log(`      with per-post signatures, Mom proves #3 is Alice's: ${sigByChain(posts[3])}   (the sig travels with the bytes)`);
console.log(`      with a HEAD-ONLY signature (posts unsigned):        false   (nothing vouches for a withdrawn post)`);
console.log(`
  They are not redundant — they defend different things:
    ADMISSION (head lists hash)  kills injection of a well-signed-but-unlisted post. Free: the head
                                 is already an [n, hash] list. This is glm's rule.
    POST SIGNATURE               makes a post portable — provable as Alice's after it leaves her head
                                 (the family-fallback archive; a withdrawn post someone kept).
  The design choice this surfaces: head-only signing is smaller (one sig per head-version, none per
  post) and safe for LIVE posts, but a withdrawn/unlisted post becomes inert bytes nobody can
  attribute. That is exactly deniability — good for "let me disavow this", bad for "prove what she
  said". The family-archive floor wants attribution, so: keep per-post signatures. State the cost
  (one sig per post) as bought, not overhead.
`);

// ============================================================
console.log('============================================================');
console.log('ISSUE 6 — a reply to a WITHDRAWN post. Does the reader false-alarm "host withholding"?');
console.log('============================================================\n');
// Mom replied to #3; then Alice withdrew #3. A reader following Mom sees a reference to #3.
const momReply = sign({ n: 1, body: 'so proud of you', target: { who: pub(alice), n: 3, hash: H(parse(posts[3]).body) } }, mom);
const ref = parse(momReply).obj.target;
const listVerdict = (head, r) => parse(head).obj.entries.some(([m]) => m === r.n) ? 'shown' : 'reply to a withdrawn/absent post — no alarm';
// The rejected "counter" head would carry {top, withdrawn}; #3 <= top and not withdrawn => "withheld".
const counterVerdict = (top, withdrawn, r) => (r.n <= top && !withdrawn.includes(r.n)) ? 'WITHHELD (false alarm)' : 'no alarm';
console.log(`  LIST head (entries), #3 removed:      ${listVerdict(afterWithdraw, ref)}`);
console.log(`  COUNTER head (top=5, withdrawn=[]):   ${counterVerdict(5, [], ref)}`);
console.log(`
  The list has no "should exist" signal for an absent number, so a reply to a withdrawn post is
  simply "that post is gone" — correct and quiet. The counter (top + withdrawn list) would compute
  #3 <= top, not withdrawn, therefore withheld, and accuse an honest host. One more reason the list
  head beats the counter, seen from the reply side this time.
`);

// ============================================================
console.log('============================================================');
console.log('ISSUE 5 — what the "split-view" attack actually is, once you notice the host CANNOT SIGN a head');
console.log('============================================================\n');
// A reader remembers (hseq -> hash) for each identity it follows, from signed heads only.
const memory = () => ({ seen: new Map(), pin(head) { const o = parse(head).obj; if (fileOK(head, pub(alice))) this.seen.set(o.hseq, H(parse(head).body)); return o.hseq; } });

console.log('  F1 — an HONEST-BUT-HOSTILE host: it cannot forge a head (only Alice signs). All it can do is');
console.log('       serve STALE or WITHHOLD. So "Mom sees hseq 47, cousin sees hseq 40" is cousin kept behind,');
console.log('       not a fork — both hashes are genuine points on Alice\'s single history.');
const heads = {};
for (const q of [40, 47]) heads[q] = sign({ hseq: q, entries: [[1, 'x']] }, alice);
const M = memory(), C = memory();
M.pin(heads[47]); C.pin(heads[40]);            // the host feeds each a different genuine head
console.log(`       Mom pinned hseq ${[...M.seen.keys()]}, cousin pinned hseq ${[...C.seen.keys()]}: no overlapping seq, nothing to compare -> undetected`);
// Gossip: Mom replies (cousin follows Mom); her reference carries a pin of Alice's head as SHE saw it.
const gossip = { hseq: 47, hash: [...M.seen.values()][0] };
console.log(`       Mom replies; her reference carries a pin (hseq ${gossip.hseq}). Cousin reads it.`);
const cousinKnowsHigher = gossip.hseq > Math.max(...C.seen.keys());
console.log(`       cousin now knows Alice is at >= ${gossip.hseq} but its host only served ${Math.max(...C.seen.keys())}: asks the host for ${gossip.hseq}`);
console.log(`       host serves it -> cousin advances (was merely behind); host refuses -> WITHHOLDING, now named.`);
console.log(`       The SEQ in the pin is what does this. The hash is not needed for the staleness/withholding case.\n`);

console.log('  F2 — a real fork needs TWO validly-SIGNED heads at one hseq, which only exists after KEY');
console.log('       COMPROMISE (Issue 1\'s two holders of a current key). Then the host can show each reader a');
console.log('       different signed head at the same seq.');
const headX = sign({ hseq: 47, entries: [[1, 'x']] }, alice);
const headY = sign({ hseq: 47, entries: [[1, 'y']] }, stolen);   // the other holder signs a rival head 47
console.log(`       both heads verify at hseq 47?   X:${fileOK(headX, pub(alice))}  Y:${fileOK(headY, pub(stolen))}   (X by current, Y by the compromised key)`);
const momHash = H(parse(headX).body), cousinHash = H(parse(headY).body);
console.log(`       Mom holds (47, ${momHash.slice(0, 6)}…), cousin holds (47, ${cousinHash.slice(0, 6)}…) — same seq, DIFFERENT hash`);
console.log(`       when Mom's reference gossips (47, ${momHash.slice(0, 6)}…), cousin sees hash != its own -> FORK detected`);
console.log(`       resolution: whichever branch the named recoverers vouch for (theft-exp.js); the host chose which each saw, but cannot hide the disagreement once one pin crosses.`);
console.log(`
  So the pin's two fields are not redundant either:
    hseq   detects STALENESS / WITHHOLDING against an honest-but-hostile host (which cannot forge).
    hash   detects a genuine FORK, which can only arise from key compromise, and hands it to the
           recovery list to resolve.
  And the earlier worry ("the host serves disjoint seq ranges so pins never overlap") dissolves:
  interaction is what forces the overlap — every reply and reaction carries a pin, and a reader
  only has to remember (hseq -> hash) from the signed heads it verified. That memory is the whole
  cost of the split-view detector, and it replaces the compare-rule apparatus of the current spec.
`);
