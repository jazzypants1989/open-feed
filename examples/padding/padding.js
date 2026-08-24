// §6.4 — bucket(n, floor), dummy slots, and a body padded to a bucket, so that a message to one
// person is the size of a message to the family. §6.1–6.3 build the envelope this pads; that is
// examples/envelope/. Run: node examples/padding/padding.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { bucket, FLOOR, encrypt, decrypt, carrierOf, readingKeyFromSeed } from '../../src/envelope.js';
import { signFile, signingKeyFromSeed, splitFile, parseBody } from '../../src/file.js';

// A real publisher draws the ephemeral, the content key and every dummy byte at random. Seeded
// here exactly as tools/regen.js seeds Appendix B, so that every number below reproduces.
const ed = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const xk = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${l}`).digest());
const stream = (ikm) => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', ikm, '', String(i++), n)); };

const alice = ed('alice/anchor'), mum = xk('mum'), host = xk('host');
const who = (n) => ({ key: ed(n).x, read: xk(n).x, loc: `https://${n}.example/${n}` });
const SELF = { key: alice.x, read: xk('alice/read').x, loc: 'https://alice.example/alice' };
const DM = [SELF, who('mum')], SMALL = [...DM, who('sis')];
const FAMILY = [...SMALL, who('bro'), who('gran'), who('cousin')];
const TEXT = { text: 'I am leaving him on Friday' };

const ckOf = (label) => crypto.createHash('sha256').update(`ck:${label}`).digest();
const seal = (label, audience, n, { policy = 'floor', content = TEXT, random } = {}) => encrypt({
  content, audience, carrier: carrierOf(alice.x, n), policy, ephemeral: xk(`eph:${label}`),
  contentKey: ckOf(label), random: random ?? stream(`dummies:${label}`),
});
const post = (n, env) => signFile({ n, at: '2026-08-18T21:40:00Z', encrypted: env }, alice);
const plainOf = (audience, content = TEXT) => Buffer.byteLength(JSON.stringify({ audience, ...content }), 'utf8');
const bodyOf = (env) => Buffer.from(env.ct, 'base64url').length - 16;      // the padded plaintext, less the 16-byte AEAD tag

console.log('§6.4 — bucket(n, floor) is the greater of floor and the next power of two at or above n\n');
const rows = [[1, 8], [6, 8], [8, 8], [9, 8], [17, 8], [100, 512], [512, 512], [513, 512]];
for (const [n, f] of rows) console.log(`  bucket(${String(n).padStart(3)}, ${String(f).padStart(3)})  = ${String(bucket(n, f)).padStart(4)}`);
assert.deepEqual(rows.map(([n, f]) => bucket(n, f)), [8, 8, 8, 16, 32, 512, 512, 1024]);
console.log(`\n  8 is a power of two and it is the floor, so it stays 8; 9 is one over, so it doubles.\n  Anything below the floor is the floor. The recommended floors are ${FLOOR.slots} slots and ${FLOOR.body} bytes.\n`);
assert.deepEqual(FLOOR, { slots: 8, body: 512 });

const dm = seal('dm', DM, 5), small = seal('small', SMALL, 6), family = seal('family', FAMILY, 7);
console.log('§6.4 — slots are padded to bucket(slot count, slot floor) with dummies\n');
for (const [name, aud, env] of [['a direct message', DM, dm], ['the whole family', FAMILY, family]])
  console.log(`  ${name.padEnd(18)}${aud.length} recipients + ${env.slots.length - aud.length} dummies = ${env.slots.length} slots`);
console.log('\n  Two recipients and six come out of the envelope at the same width.\n');
assert.deepEqual([dm.slots.length, family.slots.length], [FLOOR.slots, FLOOR.slots]);

const widths = new Set([...dm.slots, ...family.slots].map(([t, w]) => `${Buffer.from(t, 'base64url').length}/${Buffer.from(w, 'base64url').length}`));
const opened = decrypt(dm, mum.privateKey, carrierOf(alice.x, 5));
console.log('§6.4 — a dummy MUST be indistinguishable in width from a real slot\n');
console.log(`  every slot, real or dummy   ${[...widths][0]} bytes  (tag / wrapped content key)
  as base64url in the file    ${dm.slots[0][0].length} / ${dm.slots[0][1].length} characters
  distinct widths, ${dm.slots.length + family.slots.length} slots   ${widths.size}`);
console.log(`\n  Mum scans, finds her own, and opens it: ${JSON.stringify(opened.text)}
  What the padding tells her about the rest: nothing. She sees ${dm.slots.length} slots and learns the
  audience — ${opened.audience.length} people — from §6.5's list inside, not by counting.\n`);
assert.deepEqual([...widths], ['8/48']);
assert.equal(opened.audience.length, DM.length);

// A dummy derived from a seed somebody else holds is a dummy somebody else can subtract.
const recomputable = (env, ikm) => { const s = stream(ikm), have = new Set(env.slots.map((p) => p.join(''))); let hit = 0;
  for (let i = 0; i < env.slots.length; i++) { const d = s(56); if (have.has(`${d.subarray(0, 8).toString('base64url')}${d.subarray(8).toString('base64url')}`)) hit++; } return hit; };
const fromCk = seal('leak-ck', DM, 5, { random: stream(ckOf('leak-ck')) });
const epk = Buffer.from(xk('eph:leak-epk').x, 'base64url');
const fromEpk = seal('leak-epk', DM, 5, { random: stream(epk) });
console.log('§6.4 — and it MUST NOT be derived from anything a recipient holds\n');
console.log('  Mum holds the content key: it is what her slot wraps (§6.1). Ask how many of the\n  eight slots she can regenerate for herself:\n');
console.log(`  random bytes, as §6.4 requires   ${recomputable(dm, ckOf('dm'))} of 8   she can subtract nothing
  derived from the content key     ${recomputable(fromCk, ckOf('leak-ck'))} of 8   8 − 6 = 2: she has counted the true audience
  derived from epk, which is public in the post: ${recomputable(fromEpk, epk)} of 8 for the host as well.`);
console.log('\n  Padding that anyone can recompute is not padding; it is a longer file.\n');
assert.equal(recomputable(dm, ckOf('dm')), 0);
assert.equal(recomputable(dm, Buffer.from(dm.epk, 'base64url')), 0);
assert.equal(fromCk.slots.length - recomputable(fromCk, ckOf('leak-ck')), DM.length);
assert.equal(fromEpk.slots.length - recomputable(fromEpk, epk), DM.length);

console.log('§6.4 — the body is padded to bucket(length + 2, body floor)\n');
const filler = (n) => ({ text: 'x'.repeat(n - plainOf(DM, { text: '' })) });
const bodies = [['a direct message', DM, TEXT], ['the same to mum and sis', SMALL, TEXT],
  ['the last plaintext that fits', DM, filler(510)], ['one byte more', DM, filler(511)]];
console.log(`  ${'what'.padEnd(30)}${'plain'.padStart(5)}${'+2'.padStart(5)}${'bucket'.padStart(9)}`);
for (const [name, aud, content] of bodies) {
  const p = plainOf(aud, content), env = seal(`body:${p}`, aud, 5, { content });
  console.log(`  ${name.padEnd(30)}${String(p).padStart(5)}${String(p + 2).padStart(5)}${String(bodyOf(env)).padStart(9)}`);
  assert.equal(bodyOf(env), bucket(p + 2, FLOOR.body));
}
console.log('\n  The 2 is §6.1\'s two-byte big-endian length prefix, which is padded along with the\n  plaintext — so 510 bytes of content still fits the 512-byte bucket and 511 does not.\n');
assert.deepEqual([bodyOf(dm), bodyOf(small)], [FLOOR.body, FLOOR.body]);

const files = { dm: post(5, dm), small: post(6, small), family: post(7, family) };
const flat = { dm: seal('dm', DM, 5, { policy: 'pow2' }), small: seal('small', SMALL, 6, { policy: 'pow2' }) };
const bare = { dm: post(5, flat.dm), small: post(6, flat.small) };
console.log('§6.4 — a message to one person is the same size as a message to the family\n');
console.log('  SHOULD: a floor of 8 slots and 512 bytes');
console.log(`    post 5, to mum alone        ${files.dm.length} bytes   ${dm.slots.length} slots, ${bodyOf(dm)}-byte body
    post 6, to mum and sis      ${files.small.length} bytes   ${small.slots.length} slots, ${bodyOf(small)}-byte body
    the same file size: ${files.dm.length === files.small.length}

  the floor off, power of two alone
    post 5, to mum alone        ${bare.dm.length} bytes   ${bucket(DM.length, 1)} slots
    post 6, to mum and sis      ${bare.small.length} bytes   ${bucket(SMALL.length, 1)} slots
    the same file size: ${bare.dm.length === bare.small.length} — the host reads the audience size off the file size.\n`);
assert.equal(files.dm.length, files.small.length);
assert.notEqual(bare.dm.length, bare.small.length);

console.log(`  The floor hides the audience size for as long as §6.5's audience list fits under it:
    post 7, to five others      ${files.family.length} bytes   ${family.slots.length} slots, ${bodyOf(family)}-byte body
    the audience list alone is ${JSON.stringify(FAMILY).length} bytes, so this body lands in the next bucket.\n`);
assert.equal(bodyOf(family), 1024);
assert.ok(JSON.stringify(FAMILY).length > FLOOR.body);

console.log('§6.4 — it is a SHOULD and not a MUST, and the reason is a number\n');
const perSlot = dm.slots[0][0].length + dm.slots[0][1].length + 8;   // ["<tag>","<wrapped>"], and its comma
console.log(`  a direct message with the floor      ${files.dm.length} bytes
  the same message without it          ${bare.dm.length} bytes
  what the floor costs                  ${files.dm.length - bare.dm.length} bytes — six dummy slots, at ${perSlot} bytes each`);
console.log('\n  A minimal implementation that skips it is still conformant: nothing about opening the\n  envelope depends on the padding, and a reader cannot tell whether a publisher paid.\n');
assert.equal(files.dm.length - bare.dm.length, 6 * perSlot);
assert.deepEqual(decrypt(flat.dm, mum.privateKey, carrierOf(alice.x, 5)).audience, DM);

const inTheClear = parseBody(splitFile(files.dm).body);
console.log('§6.4 — what padding does not hide\n');
console.log(`  the host holds no key, and reads off the file anyway:
    that an encrypted post exists   the "encrypted" member is right there
    when it appeared                ${inTheClear.at}
    which bucket it is in           ${bodyOf(dm)}-byte body, ${dm.slots.length} slots
    who fetched it, and when        not in the file at all — it is in his logs
  and cannot read: ${decrypt(dm, host.privateKey, carrierOf(alice.x, 5))} — the text, the audience, one recipient or six.`);
console.log('\n  Padding takes size away from him. It leaves existence, timing, frequency, and fetches (§13.3).\n');
assert.ok(inTheClear.at === '2026-08-18T21:40:00Z' && inTheClear.encrypted && inTheClear.text === undefined);
assert.equal(decrypt(dm, host.privateKey, carrierOf(alice.x, 5)), null);

console.log('Every line above is asserted.');
