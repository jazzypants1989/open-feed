// The known-good corpus, and every check a §7 reader must pass over it.
//
// NO IMPLEMENTATION LIVES HERE. The files are produced by the weekend publisher
// (examples/weekend-publisher) and the envelope by src/envelope.js; this module composes them into
// scenarios and states what a reader must say about each. Two things import it:
//
//   tools/regen.js    renders the files into test-vectors.md and runs the suite with both readers
//   tools/conform.js  runs the suite against anybody's reader
//
// Keys are deterministic so the bytes reproduce on any machine. Ed25519 signing is deterministic
// (RFC 8032), so a fixed seed fixes the whole file.
import crypto from 'node:crypto';

import * as pub from '../examples/weekend-publisher/weekend-publisher.js';
import { encrypt, postBinding, readingKeyFromSeed } from '../src/envelope.js';

export const address = (f) => pub.address(f);
export const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
export const body = (f) => f.subarray(0, f.lastIndexOf(0x0a));
export const sigLine = (f) => f.subarray(f.lastIndexOf(0x0a) + 1).toString('latin1');

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
export const edKey = (label) => {
  const seed = crypto.createHash('sha256').update(`openfeed/v1/vector:${label}`).digest();
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  return { label, privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
};
/** A deterministic X25519 key from a label — for vectors only, never for a real identity. */
export const xKey = (label) => ({ label, ...readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${label}`).digest()) });

/** §3.7, computed here rather than imported: the vectors' second implementation of the spoken code. */
export function spokenIndices(keyX) {
  const bits = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(keyX, 'base64url'), Buffer.alloc(0), 'openfeed/v1/spoken', 9));
  let acc = 0n;
  for (const b of bits) acc = (acc << 8n) | BigInt(b);      // 72 bits
  return Array.from({ length: 6 }, (_, i) => Number((acc >> BigInt(72 - 11 * (i + 1))) & 0x7ffn));
}

// ---- the identity ----
export const A1 = edKey('alice/anchor'), A2 = edKey('alice/rotated'), A3 = edKey('alice/restored');
export const MUM = { key: edKey('mum'), salt: 'saltmum' };
export const SIS = { key: edKey('sis'), salt: 'saltsis' };
export const BRO = { key: edKey('bro'), salt: 'saltbro' };
export const REC = pub.commit([MUM, SIS, BRO]);
export const AT = 'https://alice.example/alice';

export const READ_ALICE = xKey('vector:alice-read');
export const READ_MUM = xKey('vector:mum-read');

const chain1 = [{ key: A1.x }];
const chain2 = [...chain1, pub.rotation(A1, A2, REC)];
const chain3 = [...chain2, pub.restore(A2, A3, [MUM, SIS], REC)];

const base = { anchor: A1.x, name: 'Alice', recovery: REC, locations: [AT], read: READ_ALICE.x };
export const p1 = pub.profile({ ...base, version: 1, chain: chain1 }, A1);
export const p2 = pub.profile({ ...base, version: 2, chain: chain2 }, A2);
export const p3 = pub.profile({ ...base, version: 3, chain: chain3 }, A3);

// ---- what she published ----
export const post1 = pub.post(1, { at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, A1);
export const post2 = pub.post(2, { at: '2026-07-11T18:02:00Z', text: 'deleted this one' }, A1);
export const post3 = pub.post(3, {
  at: '2026-07-19T09:30:00Z', text: 'congratulations, both of you',
  rel: 'reply',
  target: { key: edKey('mum').x, number: 12, hash: sha256(Buffer.from('a post of mum\'s')), location: 'https://mom.example/mom' },
}, A2);
export const png = Buffer.from('\x89PNG\r\n\x1a\n a tiny photograph', 'latin1');
export const pngHash = sha256(png);
export const post4 = pub.post(4, { at: '2026-08-15T07:00:00Z', text: 'the morning after', media: [pngHash] }, A3);
// An encrypted post: number and at in the clear, everything else — text, rel, target, media — inside (§6.5).
export const envelope = encrypt({
  content: { text: 'I am leaving him on Friday', rel: 'root' },
  audience: [{ key: A1.x, read: READ_ALICE.x, location: AT }, { key: MUM.key.x, read: READ_MUM.x, location: 'https://mom.example/mom' }],
  binding: postBinding(A1.x, 5),
  ephemeral: xKey('vector:ephemeral/5'),
  contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/5').digest(),
});
export const post5 = pub.post(5, { at: '2026-08-18T21:40:00Z', encrypted: envelope }, A3);

const H = (f) => pub.address(f);
export const h1 = H(post1), h2 = H(post2), h3 = H(post3), h4 = H(post4), h5 = H(post5);

export const head1 = pub.index({ entries: [[1, h1], [2, h2], [3, h3]], version: 1, highest: 3 }, A3);
export const head2 = pub.index({ entries: [[1, h1], [2, h2], [3, h3], [2, null], [4, h4], [5, h5], [pngHash]], version: 2, highest: 5 }, A3);
export const head3 = pub.index({ entries: [[1, h1], [3, h3], [4, h4], [5, h5], [pngHash], [2, h2]], version: 3, highest: 5 }, A3);

/** Everything but the index, which each scenario chooses. */
export const baseFiles = () => new Map([
  [`${AT}/posts/1`, post1], [`${AT}/posts/2`, post2], [`${AT}/posts/3`, post3],
  [`${AT}/posts/4`, post4], [`${AT}/posts/5`, post5],
  [`${AT}/media/${pngHash}`, png], [`${AT}/profile`, p3],
]);

// ---- the suite ----
//
// Each check names the § it comes from. Nothing here is a new rule: every one of them is a `rule()`
// an example already prints, and a check with no rule behind it would be a spec proposal wearing a
// conformance test.
const T = edKey('vector:thief');
const ONE = pub.commit([MUM]);
const WIDE = pub.commit(Array.from({ length: 33 }, (_, i) => ({ key: edKey(`vector:leaf${i}`), salt: `s${i}` })));
const flip = (f, needle, to) => { const i = f.indexOf(Buffer.from(needle)); const c = Buffer.from(f); c[i] = to.charCodeAt(0); return c; };

/** The nine ways a hostile or broken hub is refused, and the verdict §7.2 requires for each. */
export const negatives = () => {
  const soloProfile = pub.profile({ anchor: A1.x, version: 4, name: 'Alice', chain: [{ key: A1.x }, pub.restore(A1, T, [MUM], ONE)], recovery: ONE, locations: [AT] }, T);
  const wideProfile = pub.profile({ anchor: A1.x, version: 4, name: 'Alice', chain: [{ key: A1.x }, pub.restore(A1, T, [MUM, SIS], WIDE)], recovery: WIDE, locations: [AT] }, T);
  return [
    ['a flipped byte in a post body (§2.1)', (m) => m.set(`${AT}/posts/1`, flip(post1, 'text', 'T')), 'tampered'],
    ['a post whose `number` is not the number it is served at (§5.1)', (m) => m.set(`${AT}/posts/3`, post4), 'tampered'],
    ['a listed post that is not served (§7.1)', (m) => m.delete(`${AT}/posts/3`), 'tampered'],
    ['media bytes that do not hash to the listed address (§4.3)', (m) => m.set(`${AT}/media/${pngHash}`, Buffer.from('not the picture')), 'tampered'],
    ['a signature line that decodes but does not re-encode (§2.1)', (m) => m.set(`${AT}/profile`, Buffer.concat([body(p3), Buffer.from(`\n${sigLine(p3).slice(0, 85)}=`)])), 'contested'],
    ['a duplicate member in the profile body (§2.4)', (m) => m.set(`${AT}/profile`, Buffer.concat([Buffer.from(body(p3).toString('utf8').replace('{"anchor"', '{"anchor":"x","anchor"')), Buffer.from(`\n${sigLine(p3)}`)])), 'contested'],
    ['a restore vouched by a recovery list of one (§3.2)', (m) => m.set(`${AT}/profile`, soloProfile), 'contested'],
    ['a recovery list past 32 leaves (§3.3)', (m) => m.set(`${AT}/profile`, wideProfile), 'contested'],
    ['an index signed by a key the chain has rotated away from (§4.4)', (m) => m.set(`${AT}/index`, pub.index(JSON.parse(body(head3)), A1)), 'tampered'],
  ];
};

/** The positive twin of §3.2's bar: a restore the recovery actually carries, extending the real chain. */
export const twoOfTwo = () => {
  const realChain = JSON.parse(body(p3)).chain;
  return {
    profile: pub.profile({ anchor: A1.x, version: 4, name: 'Alice', chain: [...realChain, pub.restore(A3, T, [MUM, SIS], REC)], recovery: REC, locations: [AT] }, T),
    index: pub.index(JSON.parse(body(head3)), T),                        // §4.4: the key the chain now ends on
  };
};

/**
 * Every check a §7 reader must pass. `read(get, { learned, at, checkpoint })` is the adapter, where
 * `get(url)` answers bytes or null; `check(what, ok)` records one result. Returns the verdicts seen,
 * in order, so two readers can be compared directly rather than only against the expectations.
 */
export async function readerSuite(read, check) {
  const files = baseFiles();
  const get = async (p) => files.get(p) ?? null;
  const verdicts = [];
  const saw = (r) => { verdicts.push(r.verdict); return r; };

  files.set(`${AT}/index`, head1);
  const cold = saw(await read(get, { learned: A1.x, at: AT }));
  check('§7.1 a cold read of version 1 is ok, with three posts and "recently restored" as a note',
    cold.verdict === 'ok' && cold.posts.size === 3 && cold.note.includes('recently restored'));

  files.set(`${AT}/index`, head2);
  const checkpointed = saw(await read(get, { learned: A1.x, at: AT, checkpoint: cold.checkpoint }));
  check('§7.3 a checkpointed read of version 2 is ok, notes the withdrawal, and holds posts 4 and 5 and the media file',
    checkpointed.verdict === 'ok' && checkpointed.note.includes('withdrawn: 2') && checkpointed.posts.has(4) && checkpointed.posts.has(5) && checkpointed.media.has(pngHash));

  files.set(`${AT}/index`, head3);
  const rewritten = saw(await read(get, { learned: A1.x, at: AT, checkpoint: checkpointed.checkpoint }));
  check('§4.5 the rewrite is accepted by a reader that held the index before it, and post 2 is back at the hash it had',
    rewritten.verdict === 'ok' && [...rewritten.posts.keys()].sort().join(',') === '1,2,3,4,5' && !rewritten.note.some((n) => n.startsWith('withdrawn')));
  check('§7.1 a number that came back at another hash is tampered',
    saw(await read(get, { learned: A1.x, at: AT, checkpoint: { ...checkpointed.checkpoint, withdrawn: new Map([[2, 'x']]) } })).verdict === 'tampered');
  check('§3.6 the reader hands back the verified profile\'s reading key', rewritten.read === READ_ALICE.x);

  // §7.2: agreeing on what to accept says nothing about what to refuse.
  for (const [what, mutate, want] of negatives()) {
    const bad = baseFiles();
    bad.set(`${AT}/index`, head3);
    mutate(bad);
    const r = saw(await read(async (p) => bad.get(p) ?? null, { learned: A1.x, at: AT }));
    check(`refuses ${what} — ${want}`, r.verdict === want);
  }

  const good = baseFiles();
  const twin = twoOfTwo();
  good.set(`${AT}/profile`, twin.profile);
  good.set(`${AT}/index`, twin.index);
  check('§3.2 two of two restores, and the read is ok — the bar proved from both sides',
    saw(await read(async (p) => good.get(p) ?? null, { learned: A1.x, at: AT })).verdict === 'ok');

  return verdicts;
}
