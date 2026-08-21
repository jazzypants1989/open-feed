// kinds-gate: do three signed kinds cover every operation? Edit in place against a host swap and
// a compromised-key rewrite; what edit-in-place breaks in ruling 3's host rule, the family archive,
// and old replies; the unsigned blob; follow / mute / board and where a contact list could live.
// Kill criteria: edit-in-place indistinguishable from a host swap; edit-as-new-number failing any
// row edit-in-place fails; a blob injection or swap that a reader accepts.
import { makeKey, sign, split, verify, address, H, makeHead, open, entry, casStore } from './lastline.js';

const alice = makeKey('alice'), thief = makeKey('the thief, holding the current key'), mom = makeKey('mom');
const post = (n, body, extra = {}, key = alice) => sign({ n, body, ...extra }, key);
const posts = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, post(n, `post ${n}`)]));
const head = (hseq, files, prev) => makeHead({ hseq, prev, entries: Object.entries(files).map(([n, f]) => entry(+n, f)).sort(([a], [b]) => a - b) }, alice);
const h10 = head(10, posts);

// A reader that kept the bytes it verified: what it can say when #7 changes under it.
function evidence(keptPost, servedPost, oldHead, newHead) {
  const at7 = (h) => open(h, alice.x).obj.entries.find(([n]) => n === 7)?.[1];
  return { servedDiffersFromKept: address(servedPost) !== address(keptPost), headChangedAt7: at7(oldHead) !== at7(newHead), bothHeadsSigned: verify(oldHead, alice.x) && verify(newHead, alice.x), servedMatchesHead: address(servedPost) === at7(newHead) };
}
// ---- edit in place: the same number, new bytes, the head updated ----
const edited7 = post(7, 'post 7, corrected');
const h11 = head(11, { ...posts, 7: edited7 }, address(h10));
const editEvidence = evidence(posts[7], edited7, h10, h11);
// ---- a host swap: the head says one thing, the file another ----
const swapEvidence = evidence(posts[7], posts[6], h10, h10);
// ---- a compromised current key rewriting #7 ----
const rewritten7 = post(7, 'post 7, the thief\'s version', {}, alice);
const h11x = head(11, { ...posts, 7: rewritten7 }, address(h10));
const rewriteEvidence = evidence(posts[7], rewritten7, h10, h11x);
// ---- what edit-in-place costs ruling 3: the host must overwrite, and the two-device race returns ----
function race(overwrite) {
  const store = casStore();
  const write = (f) => (overwrite ? store.put('posts/8', f, store.etag('posts/8')) : store.create('posts/8', f));
  const phone = write(post(8, 'we found a house')), laptop = write(post(8, 'call your sister'));
  return { landed: [phone.ok, laptop.ok].filter(Boolean).length, survived: store.files.size, lost: [phone.ok, laptop.ok].filter(Boolean).length - store.files.size };
}
// ---- the family archive: two valid files both declaring n: 7 ----
const orderable = (a, b) => { const A = open(a, alice.x).obj, B = open(b, alice.x).obj; return !!(A.supersedes?.[0] === B.n && A.supersedes?.[1] === address(b)) || !!(B.supersedes?.[0] === A.n && B.supersedes?.[1] === address(a)); };
const twelve = post(12, 'post 7, corrected', { supersedes: [7, address(posts[7])] });
// ---- mom's old reply to #7 ----
const reply = sign({ n: 1, body: 'lovely', target: { who: alice.x, n: 7, hash: address(posts[7]) } }, mom);
const resolve = (headFile, served, t, { byHash }) => { const e = open(headFile, alice.x).obj.entries.find(([n]) => n === t.n); if (!e) return 'withdrawn'; if (byHash && e[1] !== t.hash) return 'withdrawn'; return open(served[t.n], alice.x).obj.body; };
const t = open(reply, mom.x).obj.target;
const h11new = head(11, { ...posts, 12: twelve }, address(h10));

// ---- the blob: fingerprint-named, unsigned, referenced by hash ----
const photo = Buffer.from('JPEG bytes of the house'), other = Buffer.from('a different photo');
const eight = post(8, 'the house', { attachments: [H(photo)] });
const blobOK = (ref, bytes) => H(bytes) === ref;
const headWithBlobs = makeHead({ hseq: 12, entries: [...open(h11new, alice.x).obj.entries, [8, address(eight)], ['blob', H(photo)]] }, alice);
const perPhoto = headWithBlobs.length - makeHead({ hseq: 12, entries: [...open(h11new, alice.x).obj.entries, [8, address(eight)]] }, alice).length;

// ---- follow / mute / board: reader-local or generated; the contact list's two homes ----
const follows = new Set([alice.x, mom.x]); follows.delete(mom.x);
const board = [open(h11new, alice.x).obj.entries].flatMap((e) => e.map(([n]) => n)).sort((a, b) => b - a);
const changes = 100;
const asPosts = { numbersConsumed: changes, headVersions: changes, hostSeesRhythm: true };
const asProfileBlob = { numbersConsumed: 0, pseqVersions: changes, hostSeesRhythm: true };

console.log('  evidence at #7              served≠kept   head changed at 7   both heads signed   served matches head');
for (const [name, e] of [['edit in place', editEvidence], ['host swap', swapEvidence], ['compromised-key rewrite', rewriteEvidence]]) console.log(`  ${name.padEnd(27)} ${String(e.servedDiffersFromKept).padEnd(13)} ${String(e.headChangedAt7).padEnd(19)} ${String(e.bothHeadsSigned).padEnd(19)} ${e.servedMatchesHead}`);
console.log(`  two-device race on #8: overwrite allowed -> ${race(true).lost} post lost; create-once -> ${race(false).lost} lost`);
console.log(`  archive orders two n:7 files from bytes: in-place ${orderable(posts[7], edited7)}; supersedes-pointer ${orderable(posts[7], twelve)}`);
console.log(`  mom's reply to (7, old hash): in-place, n-only check -> "${resolve(h11, { 7: edited7 }, t, { byHash: false })}"; in-place, hash check -> ${resolve(h11, { 7: edited7 }, t, { byHash: true })}; new-number -> "${resolve(h11new, posts, t, { byHash: true })}"`);
console.log(`  blob listed in the head costs ${perPhoto} B per photo (${((perPhoto * 1557) / 1e3).toFixed(0)} KB at one per post over 1,557 posts)`);
console.log(`  contact list surviving phone loss, 100 changes: as sealed posts ${asPosts.numbersConsumed} numbers + ${asPosts.headVersions} head versions; as a profile blob ${asProfileBlob.pseqVersions} pseq versions\n`);

const gate = [
  ['edit in place is distinguishable from a host swap: after an edit the head and the file agree, after a swap they do not', editEvidence.servedMatchesHead && !swapEvidence.servedMatchesHead],
  ['edit in place is indistinguishable from a rewrite by a compromised current key — identical evidence', JSON.stringify(editEvidence) === JSON.stringify(rewriteEvidence)],
  ['edit in place needs the host to overwrite a number, and the two-device race then loses a post', race(true).lost === 1 && race(false).lost === 0],
  ['two valid files declaring n:7 cannot be ordered from their bytes; a supersedes pointer orders them', !orderable(posts[7], edited7) && orderable(posts[7], twelve)],
  ['under edit in place an old reply is shown over the new text (n-only) or reads as withdrawn (by hash)', resolve(h11, { 7: edited7 }, t, { byHash: false }) === 'post 7, corrected' && resolve(h11, { 7: edited7 }, t, { byHash: true }) === 'withdrawn'],
  ['edit as a new number keeps the old reply on the text it answered', resolve(h11new, posts, t, { byHash: true }) === 'post 7'],
  ['a swapped blob is caught by its hash; an unreferenced or injected blob is inert', blobOK(H(photo), photo) && !blobOK(H(photo), other) && !open(eight, alice.x).obj.attachments.includes(H(other))],
  ['follow and mute are reader-local sets; a board is a generated view over heads — none is a kind', !follows.has(mom.x) && board[0] === 12],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('kinds-gate: all claims hold');
