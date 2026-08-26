// spoken-gate: the six-word code of §3.1 — what it distinguishes, and what it costs to grind.
// §3.1 derives it from the GENESIS key and offers it "for the moment a person is shown two
// versions of one identity". Every §3.6 contest is two versions of one identity, and they share
// the anchor. And §3.1 says "at 40 bits a laptop core finds a colliding key in under a second".
// Finding A7 and text defect C1 of the 2026-08-23 review.
// Kill criteria: two branches of one identity speaking different codes under §3.1 as written;
// a measured rate that makes 40 bits a sub-second grind.
import crypto from 'node:crypto';
import * as pub from '../weekend-publisher/weekend-publisher.js';

const claims = [];
const claim = (what, ok) => { claims.push([what, ok]); console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`); };

// §3.1 verbatim: HKDF-SHA256(ikm = key bytes, salt = "", info = "openfeed/v1/spoken", 9 bytes),
// six 11-bit big-endian fields of the first 66 bits.
function spoken(x) {
  const bits = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(x, 'base64url'), Buffer.alloc(0), 'openfeed/v1/spoken', 9));
  let acc = 0n; for (const b of bits) acc = (acc << 8n) | BigInt(b);
  return Array.from({ length: 6 }, (_, i) => Number((acc >> (72n - 11n * BigInt(i + 1))) & 0x7ffn));
}

console.log('\n1. A contest: Alice\'s branch and the thief\'s share the anchor.\n');
const G = pub.newKey(), K2 = pub.newKey(), T = pub.newKey();
const REC = pub.commit(1, [{ key: pub.newKey(), salt: 's' }]);
const alice = { anchor: G.x, chain: [{ key: G.x }, pub.rotation(G, K2, REC)] };
const thief = { anchor: G.x, chain: [{ key: G.x }, pub.rotation(G, T, REC)] };
const asWritten = [spoken(alice.anchor), spoken(thief.anchor)];
claim(`as written, the two versions speak ${asWritten[0].join(' ')} and ${asWritten[1].join(' ')} — the same six words`, asWritten[0].join() === asWritten[1].join());
const repaired = [spoken(alice.chain.at(-1).key), spoken(thief.chain.at(-1).key)];
claim(`over the key each branch currently ends on they differ: ${repaired[0].join(' ')} vs ${repaired[1].join(' ')}`, repaired[0].join() !== repaired[1].join());
claim('a reader handed the current key out of band can pick the branch that contains it — the exit §3.6 lacks', alice.chain.some((h) => h.key === K2.x) && !thief.chain.some((h) => h.key === K2.x));

console.log('\n2. What grinding a code costs, measured on this machine (one core).\n');
// The attacker wants a key whose code matches Alice's: one keygen and one HKDF per try.
const target = spoken(G.x).join();
const t0 = process.hrtime.bigint(); let tries = 0;
while (Number(process.hrtime.bigint() - t0) < 1.5e9) { tries++; if (spoken(pub.newKey().x).join() === target) break; }
const rate = tries / (Number(process.hrtime.bigint() - t0) / 1e9);
// Faster than keygen: the attacker walks the scalar and adds the base point — a point addition,
// ~100× cheaper than a fresh keygen — so the honest floor on his rate is ~100× this one.
const fmt = (s) => (s < 60 ? `${s.toFixed(1)} s` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : s < 86400 * 365 ? `${(s / 86400).toFixed(0)} days` : `${(s / 86400 / 365).toExponential(1)} years`);
console.log(`  ${Math.round(rate).toLocaleString()} keygen+HKDF per second\n`);
console.log('  bits   one core, as measured        with point addition (×100)   a GPU (×100,000)');
const row = {};
for (const bits of [40, 55, 66]) {
  const s = 2 ** bits / rate;
  row[bits] = [s, s / 100, s / 100000];
  console.log(`  ${String(bits).padEnd(6)} ${fmt(s).padEnd(28)} ${fmt(s / 100).padEnd(28)} ${fmt(s / 100000)}`);
}
claim(`40 bits on one laptop core is ${fmt(row[40][0])}, not "under a second" — §3.1's number is wrong by ${Math.round(Math.log10(row[40][0]))} orders of magnitude`, row[40][0] > 3600 * 24);
claim(`66 bits with a GPU and the point-addition shortcut is still ${fmt(row[66][2])} — the ruling stands, the sentence does not`, row[66][2] > 86400 * 365 * 100);

const failed = claims.filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} claim(s) did not hold` : `\nall ${claims.length} claims hold`);
process.exit(failed.length ? 1 : 0);
