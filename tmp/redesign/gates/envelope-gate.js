// envelope-gate: HANDOFF-final-review.md §2.A — the envelope, commissioned three times and never run.
// Today's src/enc.js construction (JWE: ECDH-ES+A256KW per slot, A256GCM, Concat KDF, a blinded
// 8-byte slot tag, the audience sealed inside, carrier binding checked at the decrypting client)
// against an HPKE/NIP-44-shaped one: one X25519 ephemeral, HKDF-SHA256, ChaCha20-Poly1305, a
// blinded tag per slot, the audience inside, padding with a floor. Standard library only.
// Then the half nobody has checked on this substrate: a sealed post read by the UNCHANGED
// weekend-reader.js over a socket, and the carrier-binding attack §15.2.1 existed for, staged with
// the binding as AAD and with no binding at all.
// Kill criteria: a vector that does not round-trip or is not reproducible; a non-recipient who
// opens; an observer who derives a tag; a recipient whose tags link across posts; the unchanged
// reader needing to know the field exists; a lifted envelope that opens under the bound shape; a
// DM distinguishable from a family post by size under the floor.
import http from 'node:http';
import crypto from 'node:crypto';
import { read } from './weekend-reader.js';
import * as pub from './weekend-publisher.js';
import { seal as oldSeal } from '../../../src/enc.js';

// ---- deterministic keys, so every number on the card reproduces ----
// The envelope itself now lives in envelope.js: the construction stopped being on trial when the
// owner ruled (spec-2 §7.2 MUST, §7.4 SHOULD), and one implementation is what keeps tmp/regen2.js's
// vectors from drifting away from the gate that proved them.
import { seal as sealNew, open as openNew, bucket, xKey, xPub, b64, unb64, INFO } from './envelope.js';
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const seed = (name) => crypto.createHash('sha256').update(`envelope:${name}`).digest();
const edKey = (name) => {
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed(`ed:${name}`)]), format: 'der', type: 'pkcs8' });
  return { privateKey, x: crypto.createPublicKey(privateKey).export({ format: 'jwk' }).x };
};

const size = (env) => Buffer.byteLength(JSON.stringify(env));

// ---- the people ----
const alice = { ed: edKey('alice'), x: xKey('alice') }, thief = { ed: edKey('thief'), x: xKey('thief') };
const fam = ['mum', 'sis', 'cousin', 'gran'].map(xKey);
const host = xKey('host');
const FAMILY = fam.map((k) => k.x);

// ---- 1. test vectors: fixed keys, fixed ephemeral, fixed content key, fixed plaintext ----
const vectors = [
  { name: 'DM, floor',      audience: [fam[0].x],        content: { text: 'call me when you can' }, carrier: `${alice.ed.x}:5`, policy: 'floor', eph: 'v1', ck: 'k1' },
  { name: 'family, floor',  audience: FAMILY,            content: { text: 'the divorce is final' }, carrier: `${alice.ed.x}:6`, policy: 'floor', eph: 'v2', ck: 'k2' },
  { name: 'family, pow2',   audience: FAMILY.slice(0, 3), content: { text: 'x'.repeat(200) },        carrier: '',                policy: 'pow2',  eph: 'v3', ck: 'k3' },
];
const vecOut = vectors.map((v) => {
  const mk = () => sealNew({ ...v, ephemeral: xKey(`eph:${v.eph}`), ck: seed(`ck:${v.ck}`) });
  const a = JSON.stringify(mk()), b = JSON.stringify(mk());
  const env = JSON.parse(a);
  const opened = openNew(env, fam[0].privateKey, v.carrier);
  return { ...v, bytes: Buffer.from(a, 'utf8'), reproducible: a === b, roundTrips: opened?.text === v.content.text && JSON.stringify(opened.audience) === JSON.stringify(v.audience) };
});

// ---- 2. who can open, what an observer gets, whether tags link ----
const famPost = sealNew({ content: { text: 'the divorce is final' }, audience: FAMILY, carrier: `${alice.ed.x}:6` });
const opens = (k) => openNew(famPost, k.privateKey, `${alice.ed.x}:6`)?.text === 'the divorce is final';
const everyRecipient = fam.every(opens), hostOpens = opens(host), thiefOpens = opens(thief.x);
// An observer holding the ephemeral public key and every recipient's public key tries the obvious
// public-only derivations of a tag; none matches any slot.
const epkB = unb64(famPost.epk), tagSet = new Set(famPost.slots.map(([t]) => t));
const guesses = FAMILY.flatMap((x) => [
  crypto.createHash('sha256').update(Buffer.concat([epkB, unb64(x)])).digest().subarray(0, 8),
  crypto.createHash('sha256').update(Buffer.concat([unb64(x), epkB])).digest().subarray(0, 8),
  Buffer.from(crypto.hkdfSync('sha256', unb64(x), epkB, INFO, 8)),
  Buffer.from(crypto.hkdfSync('sha256', epkB, unb64(x), INFO, 8)),
  unb64(x).subarray(0, 8), epkB.subarray(0, 8),
]);
const observerHits = guesses.filter((g) => tagSet.has(b64(g))).length;
const second = sealNew({ content: { text: 'another' }, audience: FAMILY, carrier: `${alice.ed.x}:7` });
const linked = famPost.slots.filter(([t]) => second.slots.some(([u]) => u === t)).length;
// A dummy slot and a real one are the same width.
const widths = new Set(famPost.slots.map(([t, w]) => `${unb64(t).length}/${unb64(w).length}`));

// ---- 3. sizes: today's src/enc.js against the candidate, 200-byte plaintext ----
const oldDoc = (k) => ({ url: `https://${k.name}.example/`, keys: [{ kty: 'OKP', crv: 'X25519', use: 'enc', kid: k.name, iat: 1, x: k.x }] });
const strangers = Array.from({ length: 32 }, (_, i) => xKey(`stranger${i}`));
const body200 = 'x'.repeat(200);
const sizeRows = [1, 2, 5, 20].map((n) => {
  const rs = [...fam, ...strangers].slice(0, n);
  const item = { id: `urn:post:${n}`, authors: [{ url: 'https://alice.example/' }] };
  const old = size(oldSeal({ item, content: { body: body200 }, recipients: rs.map(oldDoc), audience: rs.map((r) => `https://${r.name}.example/`) }));
  const oldPow2 = size(oldSeal({ item, content: { body: body200 }, recipients: [...rs, ...strangers.slice(20, 20 + bucket(n, 1) - n)].map(oldDoc), audience: rs.map((r) => `https://${r.name}.example/`) }));
  const pow2 = size(sealNew({ content: { text: body200 }, audience: rs.map((r) => r.x), policy: 'pow2' }));
  const floor = size(sealNew({ content: { text: body200 }, audience: rs.map((r) => r.x), policy: 'floor' }));
  return { n, old, oldPow2, pow2, floor };
});
// What a slot costs, each way: the difference between two and one recipients, nothing else moving.
const perSlotOld = sizeRows[1].old - sizeRows[0].old, perSlotNew = sizeRows[1].pow2 - sizeRows[0].pow2;
const dmFloor = size(sealNew({ content: { text: 'call me' }, audience: [fam[0].x], policy: 'floor' }));
const famFloor = size(sealNew({ content: { text: 'the divorce is final, come for dinner' }, audience: FAMILY, policy: 'floor' }));
const dmPow2 = size(sealNew({ content: { text: 'call me' }, audience: [fam[0].x], policy: 'pow2' }));
const famPow2 = size(sealNew({ content: { text: 'the divorce is final, come for dinner' }, audience: FAMILY, policy: 'pow2' }));

// ---- 4. over a socket, through the UNCHANGED reader ----
class Hub {
  constructor() { this.files = new Map(); }
  tag(k) { const f = this.files.get(k); return f ? crypto.createHash('sha256').update(f).digest('base64url') : null; }
  handle(method, url, body, ifMatch) {
    const m = url.match(/^\/([a-z]+)\/(profile|head|posts\/\d+)$/);
    if (!m) return { status: 404 };
    const key = `${m[1]}/${m[2]}`;
    if (method === 'GET') return this.files.has(key) ? { status: 200, body: this.files.get(key), etag: this.tag(key) } : { status: 404 };
    if (m[2] === 'head' || m[2] === 'profile') {
      if (this.tag(key) !== ifMatch) return { status: 412 };
      this.files.set(key, body); return { status: 200, etag: this.tag(key) };
    }
    if (this.files.has(key)) return { status: 409 };
    this.files.set(key, body); return { status: 201 };
  }
  listen() {
    this.server = http.createServer((req, res) => {
      const c = [];
      req.on('data', (x) => c.push(x));
      req.on('end', () => { const r = this.handle(req.method, req.url, Buffer.concat(c), req.headers['if-match'] ?? null); res.writeHead(r.status, r.etag ? { etag: r.etag } : {}); res.end(r.body); });
    });
    return new Promise((ok) => this.server.listen(0, '127.0.0.1', () => { this.url = `http://127.0.0.1:${this.server.address().port}`; ok(this); }));
  }
}
const io = (hub) => ({
  get: async (p) => { const r = await fetch(hub.url + p); return r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null; },
  put: async (p, b, ifMatch) => (await fetch(hub.url + p, { method: 'PUT', body: b, headers: ifMatch ? { 'if-match': ifMatch } : {} })).status,
});
const hubA = await new Hub().listen(), hubT = await new Hub().listen();
const netA = io(hubA), netT = io(hubT);
const REC = pub.commit(1, [{ key: pub.newKey(), salt: 's' }]);
await netA.put('/alice/profile', pub.profile({ genesis: alice.ed.x, pseq: 1, chain: [{ key: alice.ed.x }], recovery: REC, locations: ['https://alice.example'], read: alice.x.x }, alice.ed), null);
await netT.put('/thief/profile', pub.profile({ genesis: thief.ed.x, pseq: 1, chain: [{ key: thief.ed.x }], recovery: REC, locations: ['https://thief.example'], read: thief.x.x }, thief.ed), null);

// Alice's post 5 is sealed two ways: bound to its carrier (her genesis key and the number), and not.
const carrierOf = (genesis, n) => `${genesis}:${n}`;
const bound = sealNew({ content: { text: 'I am leaving him on Friday' }, audience: FAMILY, carrier: carrierOf(alice.ed.x, 5) });
const unbound = sealNew({ content: { text: 'I am leaving him on Friday' }, audience: FAMILY, carrier: '' });
await pub.publish(netA, '/alice', alice.ed, 5, { at: '2026-08-01T09:00:00Z', sealed: bound });
await pub.publish(netA, '/alice', alice.ed, 6, { at: '2026-08-01T09:01:00Z', sealed: unbound });
const aliceRead = await read(netA.get, { learned: alice.ed.x, at: '/alice' });
const sealedOpaque = aliceRead.verdict === 'ok' && aliceRead.posts.size === 2 && typeof aliceRead.posts.get(5).sealed?.ct === 'string';
const mumAfter = openNew(aliceRead.posts.get(5).sealed, fam[0].privateKey, carrierOf(alice.ed.x, 5))?.text;
const hostAfter = openNew(aliceRead.posts.get(5).sealed, host.privateKey, carrierOf(alice.ed.x, 5));
// Signing did not change: the sealed post's file is the same bytes-then-signature shape as a cleartext one.
const rawFile = await netA.get('/alice/posts/5');
const sigLine = rawFile.subarray(rawFile.lastIndexOf(0x0a) + 1).toString('latin1');
const sameShape = /^[A-Za-z0-9_-]{86}$/.test(sigLine) && crypto.verify(null, rawFile.subarray(0, rawFile.lastIndexOf(0x0a)), crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: alice.ed.x }, format: 'jwk' }), unb64(sigLine));

// The thief cannot read either envelope. He lifts both out of her posts into posts of his own, signed
// by his key, listed in his head, served from his hub. Mum's reader accepts his posts — they ARE his.
await pub.publish(netT, '/thief', thief.ed, 1, { at: '2026-08-02T09:00:00Z', text: 'she told me this herself:', sealed: aliceRead.posts.get(5).sealed });
await pub.publish(netT, '/thief', thief.ed, 2, { at: '2026-08-02T09:00:00Z', text: 'she told me this herself:', sealed: aliceRead.posts.get(6).sealed });
const thiefRead = await read(netT.get, { learned: thief.ed.x, at: '/thief' });
const thiefVerifies = thiefRead.verdict === 'ok' && thiefRead.posts.size === 2;
// Mum's client opens each against the carrier it was served in — the thief's key and number.
const liftedBound = openNew(thiefRead.posts.get(1).sealed, fam[0].privateKey, carrierOf(thief.ed.x, 1));
const liftedUnbound = openNew(thiefRead.posts.get(2).sealed, fam[0].privateKey, '');   // an unbound client passes nothing
// A client that forgot to pass the carrier at all would open the unbound one too: that is the bug
// the binding exists to make impossible, and with AAD there is no "forgot" — the key is the same, the AAD is not.
const forgetful = openNew(thiefRead.posts.get(1).sealed, fam[0].privateKey, '');
hubA.server.close(); hubT.server.close();

// ---- print ----
console.log('\n  test vectors (fixed keys, ephemeral, content key, plaintext → exact bytes as served, base64url)\n');
for (const v of vecOut) console.log(`    ${v.name.padEnd(15)} ${v.bytes.length} B  reproducible ${v.reproducible}  round-trips ${v.roundTrips}\n      ${b64(v.bytes)}\n`);
console.log('  who opens the family post: every recipient ' + everyRecipient + ', the host ' + hostOpens + ', the thief ' + thiefOpens);
console.log(`  an observer with the ephemeral and every recipient key, trying ${guesses.length} public-only tag derivations: ${observerHits} matches`);
console.log(`  the same four recipients across two posts: ${linked} tags shared; slot widths: ${[...widths].join(', ')} (tag/wrap bytes, real and dummy alike)\n`);
console.log('  bytes, 200-byte plaintext, as served');
console.log('    recipients   today (enc.js)   today + pow2 slots   candidate pow2   candidate floor(8 slots, 512 B body)');
for (const r of sizeRows) console.log(`    ${String(r.n).padStart(10)}   ${String(r.old).padStart(14)}   ${String(r.oldPow2).padStart(18)}   ${String(r.pow2).padStart(14)}   ${String(r.floor).padStart(15)}`);
console.log(`    one slot costs ${perSlotOld} B today and ${perSlotNew} B in the candidate; the body is padded to a bucket in the candidate and not at all today`);
console.log(`    a DM and a family post: pow2 ${dmPow2} vs ${famPow2} (${dmPow2 === famPow2 ? 'same' : 'told apart'}); floor ${dmFloor} vs ${famFloor} (${dmFloor === famFloor ? 'same' : 'told apart'})\n`);
console.log(`  over the socket, the unchanged reader: alice ${aliceRead.verdict}, sealed field opaque ${sealedOpaque}; mum opens → "${mumAfter}"; the host opens → ${hostAfter}`);
console.log(`  the thief's copies: his posts read ${thiefRead.verdict} (they are his); mum opens the bound one → ${JSON.stringify(liftedBound)}; the unbound one → ${JSON.stringify(liftedUnbound?.text)}`);
console.log(`  a client that passes no carrier at all opens the bound one → ${JSON.stringify(forgetful)}\n`);

const gate = [
  ['three vectors reproduce byte-for-byte from fixed inputs and round-trip, audience included', vecOut.every((v) => v.reproducible && v.roundTrips)],
  ['every recipient opens the family post; the host and a stranger cannot', everyRecipient && !hostOpens && !thiefOpens],
  ['an observer holding the ephemeral and every recipient\'s public key derives no slot tag', observerHits === 0],
  ['a recipient\'s tag does not link across two posts, and a dummy slot is the width of a real one', linked === 0 && widths.size === 1],
  ['a slot costs about half in the candidate, so padding the audience is cheaper than it is today', perSlotNew * 2 <= perSlotOld + 10],
  ['power-of-two padding alone tells a DM from a family post; the floor does not', dmPow2 !== famPow2 && dmFloor === famFloor],
  ['the unchanged reader returns a sealed post as ok with the field opaque — no new signing construction', sealedOpaque && sameShape],
  ['decrypting after the reader returned: a recipient reads it, the host does not', mumAfter === 'I am leaving him on Friday' && hostAfter === null],
  ['the thief\'s posts carrying her envelopes verify as his — the reader is right to accept them', thiefVerifies],
  ['bound to its carrier as AAD, the lifted envelope does not open in his post, and there is no carrier-less way to open it either', liftedBound === null && forgetful === null],
  ['with no binding, the lifted envelope opens and her words render under his name — the attack §15.2.1 was for is alive on this substrate', liftedUnbound?.text === 'I am leaving him on Friday'],
];
const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('envelope-gate: all claims hold');
