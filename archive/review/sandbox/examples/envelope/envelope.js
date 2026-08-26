// §6.1–6.3, §6.5–6.6 — encrypted content: one X25519 ephemeral per message, a blinded slot per
// recipient, the carrier bound as associated data, and the audience inside naming people.
// Run: node examples/envelope/envelope.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, splitFile, verifyFile, address, signingKeyFromSeed } from '../../src/file.js';
import { encrypt, decrypt, carrierOf, bucket, readingKeyFromSeed, readingPublicKey, INFO, FLOOR } from '../../src/envelope.js';

// Appendix B's keys and its seeded randomness. A real publisher draws the ephemeral, the content
// key and the dummy slots at random, and no two of its posts look alike.
const ed = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const xk = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`envelope:${l}`).digest());
const ck = (l) => crypto.createHash('sha256').update(l).digest();
const dummies = (l) => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', l, '', String(i++), n)); };
const b64 = (b) => Buffer.from(b).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url');
const aead = (k, iv, d, aad) => { const c = crypto.createCipheriv('chacha20-poly1305', k, iv, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: d.length }); return Buffer.concat([c.update(d), c.final(), c.getAuthTag()]); };
const unaead = (k, iv, d, aad) => { const c = crypto.createDecipheriv('chacha20-poly1305', k, iv, { authTagLength: 16 }); c.setAAD(aad, { plaintextLength: d.length - 16 }); c.setAuthTag(d.subarray(-16)); return Buffer.concat([c.update(d.subarray(0, -16)), c.final()]); };
const rows = (...r) => console.log(r.map(([a, b]) => `  ${a.padEnd(34)}${b}`).join('\n'));
const Z12 = Buffer.alloc(12);

const AT = 'https://alice.example/alice';
const alice = { ed: ed('alice/anchor'), read: xk('vector:alice-read'), loc: AT };
const mum = { ed: ed('mum'), read: xk('vector:mum-read'), loc: 'https://mom.example/mom' };
const sis = { ed: ed('sis'), read: xk('vector:sis-read'), loc: 'https://sis.example/sis' };
const bro = { ed: ed('bro'), read: xk('vector:bro-read'), loc: 'https://bro.example/bro' };
const who = (p) => ({ key: p.ed.x, read: p.read.x, loc: p.loc });          // §6.5's audience entry
const A3 = ed('alice/restored'), thief = ed('thief');

// Post 5 is Appendix B.8, alice's direct message to mum; post 6 is the same mechanism to four people.
const c5 = carrierOf(alice.ed.x, 5), c6 = carrierOf(alice.ed.x, 6);
const dm = encrypt({ content: { text: 'I am leaving him on Friday', rel: 'root' }, audience: [who(alice), who(mum)], carrier: c5, ephemeral: xk('vector:ephemeral/5'), contentKey: ck('openfeed/v1/vector:contentkey/5'), random: dummies('openfeed/v1/vector:dummies/5') });
const fam = encrypt({ content: { text: 'the divorce is final, come for dinner', rel: 'root' }, audience: [who(alice), who(mum), who(sis), who(bro)], carrier: c6, ephemeral: xk('example:ephemeral/6'), contentKey: ck('example:contentkey/6'), random: dummies('example:dummies/6') });
const post1 = signFile({ n: 1, at: '2026-07-04T10:15:00Z', text: 'the peonies came back' }, alice.ed);
const post5 = signFile({ n: 5, at: '2026-08-18T21:40:00Z', encrypted: dm }, A3);
const post6 = signFile({ n: 6, at: '2026-08-19T08:05:00Z', encrypted: fam }, A3);

const clear = (f) => Object.keys(JSON.parse(splitFile(f).body)).join(', ');
console.log('§6 — three visibilities, one mechanism\n');
rows(['public      post 1', `in the clear: ${clear(post1)}`], ['encrypted   post 6', `in the clear: ${clear(post6)}   an audience of four`],
  ['a DM        post 5', `in the clear: ${clear(post5)}   an audience of two — mum, and alice herself`]);
console.log('\n  A DM is that set with one member besides the author. All three are ordinary signed posts\n  (§2) — body, one \\n, 86 signature characters — and the index lists all three alike (§4).\n');
for (const f of [post1, post5, post6]) assert.equal(splitFile(f).sigLine.length, 86);
assert.equal(clear(post5), 'n, at, encrypted'); assert.equal(clear(post6), 'n, at, encrypted');

// §6.1 derived here from node:crypto alone, so a second implementer can follow every step.
const eph = xk('vector:ephemeral/5'), epk = unb64(eph.x), key5 = ck('openfeed/v1/vector:contentkey/5');
const Z = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: readingPublicKey(mum.read.x) });
const k52 = Buffer.from(crypto.hkdfSync('sha256', Z, epk, INFO, 52));
const [tag, kek, knonce] = [k52.subarray(0, 8), k52.subarray(8, 40), k52.subarray(40, 52)];
const wrapped = aead(kek, knonce, key5, epk);
console.log('§6.1 — one ephemeral per message, one slot per recipient, the content once\n');
rows(['epk', eph.x], ['content key', `${b64(key5)}   32 random bytes, used once`], ['carrier', c5]);
console.log(`\n  mum's slot, from her reading key R and this message's ephemeral:\n    tag(8) || kek(32) || knonce(12) = HKDF-SHA256(ikm = Z, salt = epk, info = "${INFO}", 52)`);
rows(['  Z = X25519(eph priv, R)', `${Z.toString('hex').slice(0, 32)}…`], ['  tag(8)', b64(tag)],
  ['  kek(32)', `${kek.toString('hex').slice(0, 32)}…`], ['  knonce(12)', knonce.toString('hex')]);
console.log(`    wrapped = ChaCha20-Poly1305(kek, knonce, content key, aad = epk)\n      ${b64(wrapped)}`);
assert.deepEqual([b64(tag), b64(wrapped)], dm.slots[1]);
const plain = Buffer.from(JSON.stringify({ audience: [who(alice), who(mum)], text: 'I am leaving him on Friday', rel: 'root' }), 'utf8');
const padded = Buffer.alloc(bucket(plain.length + 2, FLOOR.body));
padded.writeUInt16BE(plain.length, 0); plain.copy(padded, 2);
const ct = aead(key5, Z12, padded, Buffer.concat([epk, Buffer.from(c5, 'ascii')]));
console.log('\n  and the content, once:');
rows(['  plain', `${plain.length} bytes of UTF-8 JSON — the audience, then the content members`],
  ['  padded', `2-byte big-endian length, plain, zeros to ${padded.length} (§6.4 — examples/padding/)`]);
console.log(`    ct = ChaCha20-Poly1305(content key, 12 zero bytes, padded, aad = epk || carrier)\n      ${b64(ct).slice(0, 43)}…   ${b64(ct).length} characters`);
console.log('\n  The all-zero nonce is safe for the reason it is safe in HPKE: the content key is 32 random\n  bytes and MUST NOT be reused across messages, so that (key, nonce) pair is used exactly once.\n');
assert.equal(b64(ct), dm.ct);

// §6.2: the thief lifts alice's envelope into a post of his own, signed by his key, listed in his index.
const lifted = signFile({ n: 1, at: '2026-08-19T02:00:00Z', encrypted: dm }, thief);
const cT = carrierOf(thief.x, 1);
console.log('§6.2 — the carrier is associated data, so a lifted envelope does not open\n');
rows(["the thief's post 1 verifies", `${verifyFile(lifted, thief.x) !== null}   under his own key — it really is his post`],
  ['mum opens it at his carrier', `${decrypt(dm, mum.read.privateKey, cT)}   (${cT.slice(0, 10)}…:1)`],
  ['a client that passes no carrier', `${decrypt(dm, mum.read.privateKey, '')}`],
  ['at the post it was published in', `"${decrypt(dm, mum.read.privateKey, c5).text}"`]);
const unbound = aead(key5, Z12, padded, epk);
console.log(`\n  There is no "forgot to compare": the carrier is not a field checked afterwards, it is what\n  the unwrap is keyed against. Had the associated data been epk alone, the unwrap would take no\n  carrier at all, and the same bytes would open wherever they were pasted:\n    "${JSON.parse(unaead(key5, Z12, unbound, epk).subarray(2, 2 + plain.length)).text}" — her words, under his name.\n`);
assert.equal(decrypt(dm, mum.read.privateKey, cT), null); assert.equal(decrypt(dm, mum.read.privateKey, ''), null);
assert.equal(decrypt(dm, mum.read.privateKey, c5).text, 'I am leaving him on Friday');
assert.equal(JSON.parse(unaead(key5, Z12, unbound, epk).subarray(2, 2 + plain.length)).text, 'I am leaving him on Friday');

// §6.3: an implementation that ignores tags entirely and tries every slot is conformant.
let tries = 0;
const openBlind = (env, priv, carrier) => {
  const e = unb64(env.epk);
  const k = Buffer.from(crypto.hkdfSync('sha256', crypto.diffieHellman({ privateKey: priv, publicKey: readingPublicKey(env.epk) }), e, INFO, 52));
  for (const [, w] of env.slots) {
    tries++;
    let c; try { c = unaead(k.subarray(8, 40), k.subarray(40, 52), unb64(w), e); } catch { continue; }   // no tag consulted
    const p = unaead(c, Z12, unb64(env.ct), Buffer.concat([e, Buffer.from(carrier, 'ascii')]));
    return JSON.parse(p.subarray(2, 2 + p.readUInt16BE(0)).toString('utf8'));
  }
  return null;
};
const blind = openBlind(dm, mum.read.privateKey, c5);
const collided = { ...dm, slots: [[dm.slots[1][0], b64(dummies('collision')(48))], ...dm.slots] };
console.log('§6.3 — a tag is a hint, never a decision\n');
rows(["scanning for mum's own tag", `finds slot 2 of ${dm.slots.length}, and unwraps once`],
  ['ignoring every tag, trying all', `${tries} unwraps here, up to ${dm.slots.length} — conformant, merely slower`],
  ['the same plaintext either way', JSON.stringify(blind) === JSON.stringify(decrypt(dm, mum.read.privateKey, c5))]);
console.log("\n  and a slot carrying mum's own tag whose unwrap fails, placed first:");
rows(['  she keeps scanning and opens', `"${decrypt(collided, mum.read.privateKey, c5).text}"`]);
console.log('\n  A reader that stopped at the first match would decide a message was not for it on eight\n  bytes it does not control. The tag saves work; it never answers the question.\n');
assert.deepEqual(blind, decrypt(dm, mum.read.privateKey, c5));
assert.equal(decrypt(collided, mum.read.privateKey, c5).text, 'I am leaving him on Friday');

const mumTag = (env) => b64(Buffer.from(crypto.hkdfSync('sha256', crypto.diffieHellman({ privateKey: mum.read.privateKey, publicKey: readingPublicKey(env.epk) }), unb64(env.epk), INFO, 8)));
console.log('§6.3 — tags are blinded per message\n');
rows(["mum's tag on post 5", mumTag(dm)], ["mum's tag on post 6", mumTag(fam)],
  ['slot tags the two posts share', `${dm.slots.filter(([t]) => fam.slots.some(([u]) => u === t)).length} of ${dm.slots.length}`]);
console.log('\n  A tag is derived through the message\'s own ephemeral, so an observer holding every published\n  reading key derives none of them, and one recipient\'s slots do not link across posts.\n');
assert.notEqual(mumTag(dm), mumTag(fam));
assert.equal(dm.slots.filter(([t]) => fam.slots.some(([u]) => u === t)).length, 0);
assert.ok(dm.slots.some(([t]) => t === mumTag(dm)) && fam.slots.some(([t]) => t === mumTag(fam)));

// §6.5: the entry names a person, so a replier can reach that person's profile (§3.1) and take the
// reading key from the profile it verified (§3.8) instead of one that arrived inside a message.
const profile = (p, anchor = p.ed) => signFile({ anchor: anchor.x, version: 1, chain: [{ key: anchor.x }], recovery: { k: 0, leaves: [] }, locations: [p.loc], read: p.read.x }, anchor);
const hosted = new Map([alice, mum, sis, bro].map((p) => [p.loc, profile(p)]));
const readKeyFor = (a) => { const v = verifyFile(hosted.get(a.loc) ?? Buffer.alloc(0), a.key); return v && v.obj.anchor === a.key ? v.obj.read : null; };
const inside = decrypt(fam, mum.read.privateKey, c6);
console.log('§6.5 — the audience is inside, and each entry names a person\n');
console.log(`  mum opens post 6 and finds ${inside.audience.length} entries — alice's own among them, or alice could not read her own outbox:`);
rows(...inside.audience.map((a) => [`  key ${a.key.slice(0, 10)}…`, `read ${a.read.slice(0, 10)}…   loc ${a.loc}`]));
assert.equal(inside.audience.length, 4); assert.ok(inside.audience.some((a) => a.key === alice.ed.x));

const c13 = carrierOf(mum.ed.x, 13), c14 = carrierOf(mum.ed.x, 14);
const answer = { text: 'we are with you', rel: 'reply', target: { key: alice.ed.x, n: 6, hash: address(post6), loc: AT } };
const reply = encrypt({ content: answer, audience: inside.audience.map((a) => ({ ...a, read: readKeyFor(a) })), carrier: c13, ephemeral: xk('example:ephemeral/13'), contentKey: ck('example:contentkey/13'), random: dummies('example:dummies/13') });
const split = encrypt({ content: answer, audience: [who(mum), who(alice)], carrier: c14, ephemeral: xk('example:ephemeral/14'), contentKey: ck('example:contentkey/14'), random: dummies('example:dummies/14') });
const post13 = signFile({ n: 13, at: '2026-08-19T19:00:00Z', encrypted: reply }, mum.ed);
const opens = (env, c) => [alice, mum, sis, bro].map((p, i) => `${['alice', 'mum', 'sis', 'bro'][i]} ${decrypt(env, p.read.privateKey, c) !== null}`).join('   ');
console.log('\n  Mum replies, and a comment on an encrypted post is encrypted in turn (§6). For each entry she\n  reads the profile at `loc`, refuses it unless its `anchor` is that entry\'s `key` (§3.1), and\n  encrypts to the `read` key that profile carries (§3.8):');
hosted.set(bro.loc, profile(bro, thief));
console.log(`    ${opens(reply, c13)}\n    and a profile served at bro's loc under someone else's anchor is refused: ${readKeyFor(who(bro))}`);
console.log('\n  Had the audience been reading keys and nothing else, mum would hold an X25519 key for sis and\n  for bro and nothing that leads to a profile, so she could address only the member she already\n  knew. Her reply goes out to two, and nothing anywhere raises an error:');
console.log(`    ${opens(split, c14)}`);
console.log('  The thread splits in half and neither half is told.\n');
assert.ok([alice, mum, sis, bro].every((p) => decrypt(reply, p.read.privateKey, c13) !== null));
assert.deepEqual([alice, mum, sis, bro].map((p) => decrypt(split, p.read.privateKey, c14) !== null), [true, true, false, false]);
assert.equal(readKeyFor(who(bro)), null);

const b13 = splitFile(post13).body.toString();
console.log('§6.6 — on an encrypted post, rel, target and media go inside\n');
rows(["mum's post 13, in the clear", `${b13.slice(0, 47)}…`],
  ['"reply" in the public bytes?', `${b13.includes('reply')}   it is inside: rel="${decrypt(reply, alice.read.privateKey, c13).rel}"`],
  ["alice's key in the public bytes?", `${b13.includes(alice.ed.x)}   the target is inside, all four members of it`]);
console.log('\n  A public post keeps rel and target in the clear, so public threading, relocation riding along\n  in a reply (§3.7) and the rumor rule (§7.5) are unaffected for anything a stranger could see\n  anyway — and unavailable for anything encrypted. examples/moving/ and examples/top-and-rumors/.\n');
assert.equal(b13.includes('reply'), false); assert.equal(b13.includes(alice.ed.x), false);
assert.equal(decrypt(reply, alice.read.privateKey, c13).target.hash, address(post6));

const B8_BODY = '{"n":5,"at":"2026-08-18T21:40:00Z","encrypted":{"epk":"bulurRC1e4YYuDGwVZj_Yh9ZgswZoponWSc5JsAp5z8","slots":[["cwNqOZ1KtPU","LRz0F-kLZzeE3HcRmOcfbdxrFr7PIszC4GJ6JiiQBW2D_2yuzRMWiemDHEawzpsH"],["SzNzzQy4o2c","2rsCQZAjQMhlxocGQd4baI0tsCQiZqRX8BtHmJ8mihXiGd5DtWA0mmPvzLY0Ite-"],["ILHlw-FK67c","EEU5dLZYx6yEemQZP08spx3Y5pQzWwofzUulmWSGNbIMT8a2knmNjUfsl3cdChDa"],["zopSOkIKgJA","851y70OHR0pocIlM2xXn1AFGJov5I1-8AJetsUZZUg7IIrUsAvVD6EjNSBpyIOrV"],["hRdE2dQilV0","jhRdmjLCLWphJNUnZB51gFsZx-SDyhst09cIU4dTvTb6WBoMgcb-WU_CQG_8A0Bv"],["qjOkXqGsg6A","y5a0GA8nhNIcQ-VUZaRm57oApXBpsrVeAfknLoePEjG9WI3xDrKBOCyAbOFC9c4M"],["O0DMO8iWfSg","hlttXoxLa4Lsnku2aci3pMQXbxAJ4_yL6C2JWC2kwdreCKdwNS55MlDW48XLlFLr"],["egvAYnVIubU","R9Xb_tWYWN9e9jD7MRIMvW_yDhRunvH2X6UEtOaFOMGmTBondgMEGsOQMNXVWWbK"]],"ct":"F0a_r7lGklcYcRiWYCqFFFNp-LVbDvXTILfYICimJP134PN360lOaRl4_2lw9qEbHtyqrom3PlngcSImLvZj0hfVSoB-43mWafOWXphvPemBv9vQysIpreYdZN80gXmqrwgEU1FX6pkPbnhh_Ar1d9e_Cr_tFMaf9ZEjOjp7l9o6hCnVWMqdhMarC-Dqz9l61Pb7YW5__E1Anz_RvGWdZdMr1YJoFUWpvaXZPLpPlrDB60scEDCOlIKGYIHbpAM_LDO_j_UUviXfq6H7akDGDt2ookJtvaLSbiwXmPo-hU5ONM5PFMylYsPp5HNXs5Kv1wuaTQb0asjrl8pJ7uSCsIAspXZyLgXX4IlHI97ks2P1_6s9xmiYn9gFxekNQX9l98xbfXHkMw4mYTS_mwafKcQYVt6ihiZc3FDjD_22BZJ9u3h65mBtodt9OKw4FC1YnDyy3Omd7_jQpzzh40vYRIz3j7dDRXtykla-n4QjscunP7Eg3SQjErNJk86HWyFLMFFuFjdHpZvddYan_Yscgf8M3Vkir0lWrr-ux0UFcqxNyr7afJK3D0pJLuHb_qqpCyntEnz743_xEJ2iNN6B9bsJjzP1y9Kqm_za9Ea4Z-CygTZP7LX_RB1OJjeDZCDKr3oD5GkNmllSxKXiAlby8emchzLqjNu-pjRfm--gBAhNlRr9lhkBTsubzlQR5yMM"}}';
const B8_SIG = 'of4DvgHLfMNW6qH9U5E1VuHVDh3TGYPmMdZKXBXTCwatYpLK7TOdr0Wbe18LrThOzU1VyhgwieuRxkkdYBhACw';
const seen = verifyFile(post5, [alice.ed.x, ed('alice/rotated').x, A3.x]);
console.log('§7.4 — a reader who is not in the audience verifies it completely and hands it back opaque\n');
rows(["signed by a key in alice's chain", `${seen.by === A3.x}   (her restored key)`],
  ['the address the index lists', seen.address], ['n equals the number served at', seen.obj.n === 5],
  ['encrypted comes back as', `an opaque object: ${Object.keys(seen.obj.encrypted).join(', ')}`],
  ["the host's own reading key opens", `${decrypt(dm, xk('example:host-read').privateKey, c5)}`]);
console.log(`\n  Not an error and not a verdict: opening it is the client's business, never the reader's. This\n  post is Appendix B.8 byte for byte — ${splitFile(post5).body.length} body bytes, ${post5.length} on the wire.\n\n  What the host learns is that an encrypted post exists, when (${seen.obj.at}), and roughly\n  how big: post 5 is ${post5.length} bytes and post 6, to four people, is ${post6.length}. The audience is inside, so a\n  large one shows in the bucket the body lands in; §6.4's floor hides the small end.\n`);
assert.equal(splitFile(post5).body.toString(), B8_BODY); assert.equal(splitFile(post5).sigLine, B8_SIG);
assert.equal(seen.by, A3.x); assert.equal(seen.obj.n, 5);
assert.deepEqual(Object.keys(seen.obj.encrypted), ['epk', 'slots', 'ct']); assert.equal(decrypt(dm, xk('example:host-read').privateKey, c5), null);

console.log('Every line above is asserted.');
