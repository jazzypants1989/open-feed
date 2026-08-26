// Independent re-derivation of §6.4's numbers. Formula side uses only the spec's stated sizes;
// the measured side calls src/envelope.js. No code from examples/padding is reused.
import crypto from 'node:crypto';
import { encrypt, bucket, carrierOf, readingKeyFromSeed, FLOOR } from '../../src/envelope.js';
import { signFile, signingKeyFromSeed } from '../../src/file.js';

const b64len = (bytes) => Math.ceil(bytes * 4 / 3);            // unpadded base64url
// ---- formula, from the spec's stated sizes ----
const KEY = 43;                                                // 32 bytes base64url
const SLOT = 2 + b64len(8) + 3 + b64len(48) + 2 + 1;   // ["tag","wrapped"] and its comma = 83
const entry = (loc) => `{"key":"${'k'.repeat(KEY)}","read":"${'r'.repeat(KEY)}","loc":"${loc}"}`.length;
const plainLen = (locs, text) => `{"audience":[${locs.map(() => '').join(',')}],"text":"${text}"}`.length + locs.reduce((s, l) => s + entry(l), 0);
const bodyLen = (n, slots, padded) => `{"n":${n},"at":"2026-08-18T21:40:00Z","encrypted":{"epk":"${'e'.repeat(KEY)}","slots":[`.length + slots * (SLOT) - 1 + `],"ct":"`.length + b64len(padded + 16) + `"}}`.length;
const wire = (n, slots, padded) => bodyLen(n, slots, padded) + 1 + 86;   // body, "\n", 86-char signature
const post = (n, k, locs, text, floor) => { const p = plainLen(locs, text); const s = floor ? bucket(k, 8) : bucket(k, 1); const b = floor ? bucket(p + 2, 512) : bucket(p + 2, 32); return { plain: p, slots: s, body: b, wire: wire(n, s, b) }; };

// ---- measured, from src/envelope.js ----
const ed = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const xk = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${l}`).digest());
const alice = ed('alice/anchor');
const who = (n, loc) => ({ key: ed(n).x, read: xk(n).x, loc });
const SELF = who('alice', 'https://alice.example/alice');
const MUM = who('mum', 'https://mum.example/mum'), SIS = who('sis', 'https://sis.example/sis');
const OTHERS = ['bro', 'gran', 'cousin', 'aunt', 'uncle', 'nan', 'pop', 'niece', 'nephew', 'twin', 'inlaw', 'kid'].map((n) => who(n, `https://${n}.example/${n}`));
const TEXT = 'I am leaving him on Friday';
const measure = (n, audience, policy, text = TEXT) => { const env = encrypt({ content: { text }, audience, carrier: carrierOf(alice.x, n), policy }); const f = signFile({ n, at: '2026-08-18T21:40:00Z', encrypted: env }, alice); return { slots: env.slots.length, body: Buffer.from(env.ct, 'base64url').length - 16, wire: f.length }; };

const DM = [SELF, MUM], SMALL = [SELF, MUM, SIS], FAM6 = [SELF, MUM, SIS, ...OTHERS.slice(0, 3)];
console.log('== formula vs measured (floor on) ==');
for (const [name, aud, n] of [['DM (2)', DM, 5], ['small (3)', SMALL, 6], ['family (6)', FAM6, 7]]) {
  const f = post(n, aud.length, aud.map((a) => a.loc), TEXT, true), m = measure(n, aud, 'floor');
  console.log(name.padEnd(12), 'formula', JSON.stringify(f), ' measured', JSON.stringify(m), f.wire === m.wire && f.slots === m.slots && f.body === m.body ? 'AGREE' : 'DISAGREE');
}
console.log('\n== floor cost on a DM ==');
{ const on = post(5, 2, DM.map((a) => a.loc), TEXT, true), off = post(5, 2, DM.map((a) => a.loc), TEXT, false);
  const mOn = measure(5, DM, 'floor'), mOff = measure(5, DM, 'pow2');
  console.log('formula: on', on.wire, 'off', off.wire, 'cost', on.wire - off.wire, '=', (on.slots - off.slots), 'dummies x', SLOT, '+ body', b64len(on.body + 16) - b64len(off.body + 16));
  console.log('measured: on', mOn.wire, 'off', mOff.wire, 'cost', mOn.wire - mOff.wire); }
console.log('\n== the most the floor can cost: a note to self, one-entry audience, empty text ==');
{ const on = post(5, 1, [SELF.loc], '', true), off = post(5, 1, [SELF.loc], '', false);
  const mOn = measure(5, [SELF], 'floor', ''), mOff = measure(5, [SELF], 'pow2', '');
  console.log('formula: plain', on.plain, 'on', on.wire, 'off', off.wire, 'cost', on.wire - off.wire, '| body part', b64len(on.body + 16) - b64len(off.body + 16), 'slot part', (on.slots - off.slots) * SLOT);
  console.log('measured: on', mOn.wire, 'off', mOff.wire, 'cost', mOn.wire - mOff.wire); }
console.log('\n== headline claim: for which audience sizes k (author included) does the post equal the DM on the wire? ==');
const dmWire = measure(5, DM, 'floor').wire;
for (let k = 1; k <= 9; k++) {
  const aud = [SELF, MUM, SIS, ...OTHERS].slice(0, k);
  const f = post(5, k, aud.map((a) => a.loc), TEXT, true), m = measure(5, aud, 'floor');
  console.log(`k=${k}`, 'plain+2', f.plain + 2, 'body', f.body, 'slots', f.slots, 'wire', m.wire, m.wire === dmWire ? 'same as DM' : `differs by ${m.wire - dmWire}`, f.wire === m.wire ? '' : 'FORMULA MISMATCH');
}
console.log('\n== can four entries ever fit 512? minimum: empty text, shortest loc "https://a.b/c" (13) ==');
console.log('plain+2 for k=4 =', plainLen(Array(4).fill('https://a.b/c'), '') + 2, ' (bytes of keys+punctuation alone per entry:', entry(''), ')');
console.log('\n== 2048-byte body floor: max k with these locs and text ==');
for (let k = 10; k <= 16; k++) { const aud = [SELF, MUM, SIS, ...OTHERS].slice(0, k); if (aud.length < k) break; const p = plainLen(aud.map((a) => a.loc), TEXT); console.log(`k=${k} plain+2=${p + 2}`, p + 2 <= 2048 ? 'fits 2048' : 'does not'); }

// ---- probe 1: ephemeral reuse collapses the wrap nonce ----
console.log('\n== probe: same ephemeral, two messages, one recipient ==');
{ const eph = xk('reuse'), cka = crypto.randomBytes(32), ckb = crypto.randomBytes(32);
  const a = encrypt({ content: { text: 'one' }, audience: DM, carrier: carrierOf(alice.x, 1), ephemeral: eph, contentKey: cka });
  const b = encrypt({ content: { text: 'two' }, audience: DM, carrier: carrierOf(alice.x, 2), ephemeral: eph, contentKey: ckb });
  const xor = (u, v) => Buffer.from(u.map((x, i) => x ^ v[i]));
  const wa = Buffer.from(a.slots[1][1], 'base64url'), wb = Buffer.from(b.slots[1][1], 'base64url');
  console.log('mum tag equal across posts:', a.slots[1][0] === b.slots[1][0]);
  console.log('wrapped_a XOR wrapped_b (32 bytes) === ck_a XOR ck_b:', xor(wa.subarray(0, 32), wb.subarray(0, 32)).equals(xor(cka, ckb)), '— a two-time pad over the content keys, and one Poly1305 key for both tags'); }
// ---- probe 2: what examples/envelope's "unbound" ciphertext shares with the real one ----
console.log('\n== probe: envelope.js line 78 — same ck, same zero nonce, different AAD ==');
{ const ck = crypto.randomBytes(32), padded = crypto.randomBytes(512), epk = crypto.randomBytes(32);
  const seal = (aad) => { const c = crypto.createCipheriv('chacha20-poly1305', ck, Buffer.alloc(12), { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: 512 }); return Buffer.concat([c.update(padded), c.final(), c.getAuthTag()]); };
  const x = seal(epk), y = seal(Buffer.concat([epk, Buffer.from('carrier')]));
  console.log('ciphertext bodies identical:', x.subarray(0, 512).equals(y.subarray(0, 512)), ' tags identical:', x.subarray(512).equals(y.subarray(512))); }
