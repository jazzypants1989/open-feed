// Decision 5 — Alice has a phone and a laptop. Your notes say "the device", singular.
import crypto from 'node:crypto';

const mkKey = () => crypto.generateKeyPairSync('ed25519');
const sign = (o, k) => { const b = Buffer.from(JSON.stringify(o)); return { body: o, bytes: b, stamp: crypto.sign(null, b, k.privateKey).toString('base64url') }; };
const ok = (f, k) => { try { return crypto.verify(null, f.bytes, k.publicKey, Buffer.from(f.stamp, 'base64url')); } catch { return false; } };

console.log(`
--- Part 1: both devices post at the same second (they share one key) ---

The order things actually happen in. Both devices read the index first, so both are working from
"the highest post is 3", and neither knows about the other.

   1. phone   writes post 4
   2. laptop  tries post 4, is refused, writes post 5
   3. laptop  writes the index saying the highest is 5
   4. phone   writes the index saying the highest is 4   <- it never heard about post 5
`);

const key = mkKey();
function race({ hostChecksTheIndexDidNotMove }) {
  const posts = new Map([[1, 'a'], [2, 'b'], [3, 'c']]);
  let index = sign({ seq: 1, top: 3 }, key);
  const readByPhone = index.body, readByLaptop = index.body;   // step 0: both read the same thing
  const notes = [];

  const writePost = (n) => { while (posts.has(n)) n += 1; posts.set(n, 'x'); return n; };
  const writeIndex = (basedOn, top, who) => {
    if (hostChecksTheIndexDidNotMove && basedOn.seq !== index.body.seq) {
      notes.push(`${who}'s index write was refused, so it re-read and retried`);
      top = Math.max(top, index.body.top);
      basedOn = index.body;
    }
    index = sign({ seq: basedOn.seq + 1, top }, key);
  };

  const phonePost = writePost(4);                       // 1
  const laptopPost = writePost(4);                      // 2
  writeIndex(readByLaptop, laptopPost, 'laptop');       // 3
  writeIndex(readByPhone, phonePost, 'phone');          // 4

  const orphans = [...posts.keys()].filter((n) => n > index.body.top);
  return { phonePost, laptopPost, top: index.body.top, orphans, notes };
}

for (const mode of [false, true]) {
  const r = race({ hostChecksTheIndexDidNotMove: mode });
  console.log(`  host ${mode ? 'refuses an index write if it moved underneath' : 'lets the last index write win               '}`);
  r.notes.forEach((n) => console.log(`     (${n})`));
  console.log(`     posts on disk: 1-3, ${r.phonePost}, ${r.laptopPost}.  index says the highest is ${r.top}.`);
  console.log(`     ${r.orphans.length
    ? `POST #${r.orphans.join(', #')} IS NOW UNREADABLE. It sits above the highest number Alice\n     declared, so every reader treats her own post as something the host smuggled in.`
    : 'nothing orphaned — every post she wrote is readable'}\n`);
}

console.log('--- Part 2: she loses the phone. What has to change? ---\n');

// One key, copied to both devices.
{
  const shared = mkKey();
  console.log('  one key on both devices');
  console.log('     the thief has her identity outright, and she cannot revoke the phone without');
  console.log('     revoking herself: everyone who knows her has to learn a new key.');
  console.log(`     her laptop can still stamp (${ok(sign({ x: 1 }, shared), shared) ? 'same key' : ''}), which is the only good news.\n`);
}

// A key per device, each one vouched for by an identity key kept elsewhere.
{
  const identity = mkKey(), phone = mkKey(), laptop = mkKey();
  const vouch = (device, revoked) => sign({ device: device.publicKey.export({ format: 'jwk' }).x, revoked }, identity);
  const profile = [vouch(phone, false), vouch(laptop, false)];
  const afterLoss = [vouch(phone, true), vouch(laptop, false)];
  const stillGood = (list) => list.filter((v) => !v.body.revoked).length;
  console.log('  a key per device, vouched for by an identity key kept somewhere else');
  console.log(`     before: ${stillGood(profile)} devices can post. after revoking the phone: ${stillGood(afterLoss)}.`);
  console.log('     her name, her key, her followers: all unchanged. Nobody has to be told anything.');
  console.log('     the price: the identity key that signs those vouchers is not on either device.');
  console.log('     It is on paper in a drawer, or at the host — and if it is at the host, the host');
  console.log('     can vouch for a device of its own and post as her. That is the question you');
  console.log('     already closed by saying the device is the only thing that stamps.\n');
}
