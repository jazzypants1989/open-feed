// bytes-gate: does encoded-payload signing actually delete canonicalization?
// Kill criterion: any two distinct byte strings that verify as one event, or any
// verification step that must re-serialize a parsed value to check any hash.
import assert from 'node:assert/strict';
import { b64u } from '../../../src/hash.js';
import { GateError, b64uStrict, makeKey, signEvent, eventId, verifyEvent } from './lib.js';

const mom = makeKey('of2:mom#k1');
const resolve = (kid) => (kid === mom.kid ? mom.publicKey : null);
const fails = (fn) => { try { fn(); return false; } catch (e) { if (e instanceof GateError) return true; throw e; } };

// 1. An ordinary event verifies, and its id is a pure function of the token's bytes.
const payload = { seq: 1, ts: 1736899200, type: 'post', id: 'p1', blob: 'x'.repeat(43) };
const token = signEvent(payload, mom);
const { payload: read } = verifyEvent(token, resolve);
assert.deepEqual(read, payload);
assert.equal(eventId(token), eventId(token));

// 2. No canonicalization exists: two encodings of ONE logical object are TWO events.
//    Equality of meaning is never consulted — the bytes are the identity, which is the whole
//    economy under test. Both verify; both have distinct ids; neither impersonates the other.
const weird = signEvent(null, mom, { payloadText: '{"type":"post","seq":1,  "ts":1736899200,\n"id":"p1","blob":"' + 'x'.repeat(43) + '"}' });
const { payload: weirdRead } = verifyEvent(weird, resolve);
assert.deepEqual(weirdRead, payload);
assert.notEqual(eventId(weird), eventId(token));

// 3. THE KILL SWEEP: no mutation of the token's bytes may still verify. Every byte position,
//    every replacement class. A mutation that verifies is the framing attack — a keyless
//    serving path minting a second byte string for one seq, convicting an honest publisher.
const replacements = ['A', 'z', '9', '_', '-', '=', '+', '/', ' '];
let mutations = 0;
for (let i = 0; i < token.length; i++) {
  for (const c of replacements) {
    if (token[i] === c) continue;
    const mutated = token.slice(0, i) + c + token.slice(i + 1);
    mutations++;
    let ok = false;
    try { verifyEvent(mutated, resolve); ok = true; } catch { /* expected */ }
    assert.equal(ok, false, `mutation at ${i} ('${token[i]}'->'${c}') still verifies`);
  }
}
// Appends and truncations: padding, whitespace, an extra segment, a dropped char.
for (const mutated of [token + '=', token + '\n', token + '.x', token.slice(0, -1), '=' + token]) {
  mutations++;
  assert.equal(fails(() => verifyEvent(mutated, resolve)), true, 'appended/truncated token verifies');
}

// 4. Canonical-spelling attack: a lenient decoder reads trailing-bit variants as one signature.
//    Find a final-char variant of the signature segment that DECODES identically, and assert
//    the strict rule rejects the variant while a lenient decode would have accepted it.
const sig = token.split('.')[2];
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let variantFound = null;
for (const c of alphabet) {
  if (c === sig.at(-1)) continue;
  const variant = sig.slice(0, -1) + c;
  if (Buffer.from(variant, 'base64url').equals(Buffer.from(sig, 'base64url'))) { variantFound = variant; break; }
}
assert.ok(variantFound, 'no trailing-bit variant exists (segment length made all bits significant)');
assert.equal(fails(() => b64uStrict(variantFound)), true, 'non-canonical spelling accepted');
assert.equal(fails(() => verifyEvent(token.split('.').slice(0, 2).join('.') + '.' + variantFound, resolve)), true);

// 5. The payload-hygiene residue — the ONLY parse rules that survive from §6.3, and each is
//    semantic-divergence hygiene (two readers of one VERIFIED payload), not signature integrity.
const hygiene = [
  ['duplicate members', '{"seq":1,"seq":2,"ts":1,"type":"post","id":"a","blob":"b"}'],
  ['__proto__', '{"__proto__":{"x":1},"seq":1,"ts":1,"type":"post","id":"a","blob":"b"}'],
  ['integer beyond 2^53', '{"seq":1,"ts":100000000000000000,"type":"post","id":"a","blob":"b"}'],
  ['lone surrogate', '{"seq":1,"ts":1,"type":"post","id":"a","blob":"\\ud800"}'],
];
for (const [name, text] of hygiene) {
  const t = signEvent(null, mom, { payloadText: text });
  let rejected = false;
  try { verifyEvent(t, resolve); } catch { rejected = true; }
  assert.equal(rejected, true, `${name}: accepted`);
}
// ...and the same texts DIFFERING ONLY in those pathologies never alias an honest event:
// they are distinct bytes, hence distinct ids, and they fail parse anyway (asserted above).

// 6. Cross-key and cross-kid: a signature only verifies against the key its kid names.
const eve = makeKey('of2:eve#k1');
assert.equal(fails(() => verifyEvent(token, () => eve.publicKey)), true, 'wrong key verifies');
assert.equal(fails(() => verifyEvent(signEvent(payload, { privateKey: eve.privateKey, kid: mom.kid }), resolve)), true);

// 7. Nothing above ever re-serialized: the only hash in the design is eventId(token bytes),
//    and the only JSON.stringify in lib.js runs at SIGNING time. (Structural; see the card.)
const tokenBytes = Buffer.byteLength(token, 'utf8');
console.log(`bytes-gate: ok`);
console.log(`  event token: ${tokenBytes} B (payload ${JSON.stringify(payload).length} B raw, +${(tokenBytes / JSON.stringify(payload).length - 1).toFixed(2)}x envelope overhead)`);
console.log(`  kill sweep: ${mutations} byte mutations, 0 verified`);
console.log(`  canonical-spelling variant rejected: ...${variantFound.slice(-4)} vs ...${sig.slice(-4)} (decode identically)`);
console.log(`  hygiene residue: ${hygiene.length} parse rejections (dup members, __proto__, >2^53, lone surrogate)`);
