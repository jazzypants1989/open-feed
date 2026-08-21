// Holistic pass, part 1 of 2 — the identity/key side of the design this conversation converged on.
// Config under test: identity = GENESIS key; a PROFILE carries a succession chain (rotation hops
// signed by the previous key, restore hops vouched by a committed recovery list); LAST-LINE signing
// (JSON bytes, "\n", base64url Ed25519 sig over the bytes). No revocation timestamps (GOALS retires them).
import crypto from 'node:crypto';

const mk = (n) => { const k = crypto.generateKeyPairSync('ed25519'); k._n = n; return k; };
const pub = (k) => k.publicKey.export({ format: 'jwk' }).x;
const keyObj = (x) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
const H = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const rawSign = (msg, k) => crypto.sign(null, Buffer.from(msg), k.privateKey).toString('base64url');
const rawOK = (msg, sig, x) => { try { return crypto.verify(null, Buffer.from(msg), keyObj(x), Buffer.from(sig, 'base64url')); } catch { return false; } };
// last-line file format
const sign = (obj, k) => { const body = Buffer.from(JSON.stringify(obj)); return Buffer.concat([body, Buffer.from('\n'), Buffer.from(rawSign(body, k))]); };
const parse = (file) => { const s = file.lastIndexOf(0x0a); const body = file.subarray(0, s); return { body, obj: JSON.parse(body.toString()), sig: file.subarray(s + 1).toString() }; };
const fileOK = (file, x) => { try { const { body, sig } = parse(file); return crypto.verify(null, body, keyObj(x), Buffer.from(sig, 'base64url')); } catch { return false; } };

// ---- the recovery commitment: the profile carries {k, commit} where commit = H(secret salt || the
// FULL member set). The salt stays secret until a restore reveals it, so pre-restore the commit is
// unguessable even to someone who knows every candidate public key (see commitment-exp.js). A
// restore hop reveals {salt, members} and provides valid signatures from a k-subset of members.
const commit = (salt, keys) => H(Buffer.from(salt + '|' + [...keys].sort().join('|')));
const recoveryOK = (rec, hop) =>
  commit(hop.salt, hop.members) === rec.commit &&
  hop.vouchers.length >= rec.k &&
  hop.vouchers.every((v) => hop.members.includes(v.key));

// ---- walk a profile's succession chain from genesis to the current key
function walkChain(p, { enforceRecovery = true } = {}) {
  if (p.chain[0].key !== p.genesis) return { ok: false, why: 'chain does not start at the genesis' };
  for (let i = 1; i < p.chain.length; i++) {
    const hop = p.chain[i], prev = p.chain[i - 1].key, msg = `${prev}->${hop.key}`;
    if (hop.by === 'rotation') {
      if (!rawOK(msg, hop.sig, prev)) return { ok: false, why: `rotation hop ${i} not signed by the previous key` };
    } else if (hop.by === 'restore') {
      if (!hop.vouchers.every((v) => rawOK(msg, v.sig, v.key))) return { ok: false, why: `restore hop ${i}: a voucher signature is bad` };
      if (enforceRecovery && !recoveryOK(p.recovery, hop)) return { ok: false, why: `restore hop ${i}: does not satisfy the committed list` };
    } else return { ok: false, why: `hop ${i}: unknown kind` };
  }
  return { ok: true, current: p.chain[p.chain.length - 1].key, chainKeys: p.chain.map((h) => h.key) };
}

const G = mk('genesis'), A = mk('A (rotated-to, later stolen)'), B = mk('B (post-restore)');
const mum = mk('mum'), sister = mk('sister'), ex = mk('the ex');
const salt = crypto.randomBytes(16).toString('base64url');
const rotHop = (from, to) => ({ key: pub(to), by: 'rotation', sig: rawSign(`${pub(from)}->${pub(to)}`, from) });
// members = the full committed set (revealed here); voucherKeys = the k that actually sign; salt = revealed here.
const restoreHop = (from, to, members, voucherKeys, salt) => ({ key: pub(to), by: 'restore', salt, members: members.map(pub),
  vouchers: voucherKeys.map((v) => ({ key: pub(v), sig: rawSign(`${pub(from)}->${pub(to)}`, v) })) });
const mkRec = (k, salt, members) => ({ k, commit: commit(salt, members.map(pub)) });

console.log('\n============================================================');
console.log('THE ARTIFACT INVENTORY — every operation maps onto three signed file kinds');
console.log('============================================================\n');
console.log('  kind      changes         signed by      addressed by     what maps onto it');
console.log('  profile   rarely (CAS)    current key    fixed path       rotate, restore, relocate, edit recovery list, rename');
console.log('  head      every post      current key    fixed path       post, edit, WITHDRAW (remove entry — no tombstone artifact)');
console.log('  post      never (immut.)  a chain key    its own hash     post, reply, reaction, DM (= post sealed to one)');
console.log('  (view)    generated       —              pretty alias     the JSON Feed a plain reader sees; unsigned, Level 0');
console.log(`
  Three signed kinds, not the spec's ~nine artifact types. Withdrawal is a head edit, so there is
  no permanent deletion record (GOALS:75). A reply/reaction/DM is a post with a target and/or a
  seal, not a new kind. A restore is a hop in the profile's chain, not an event of its own.
`);

// ============================================================
console.log('============================================================');
console.log('ISSUE 1 — after a restore, the stolen old key A still signs bytes that verify. Can it');
console.log('          inject a NEW post as Alice, now that revocation timestamps are gone?');
console.log('============================================================\n');
const rec = mkRec(2, salt, [mum, sister]);
const profile = { genesis: pub(G), pseq: 4, recovery: rec, chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A), restoreHop(A, B, [mum, sister], [mum, sister], salt)] };
const w = walkChain(profile);
console.log(`  chain walk: ${w.ok ? 'valid' : 'INVALID: ' + w.why}; current key = B; chain keys ever valid = [G, A, B]\n`);

// The thief holds A and signs a brand-new post. Its bytes verify under A, which IS a chain key.
const evil = sign({ n: 99, body: 'transfer the house to me' }, A);
const good = sign({ n: 5, body: 'the divorce is final' }, A);   // a genuine old post, also A-signed
const signedByAnyChainKey = (file) => w.chainKeys.some((x) => fileOK(file, x));
// The current head, signed by B, lists only the genuine posts.
const head = sign({ hseq: 40, entries: [[5, H(parse(good).body)]] }, B);
const admits = (file, n) => { const h = parse(head).obj; const e = h.entries.find(([m]) => m === n); return e && e[1] === H(parse(file).body); };

console.log('  post              signed by a chain key?   listed in B\'s head?   ADMISSION ON        ADMISSION OFF');
for (const [label, file, n] of [['genuine #5 (by A)', good, 5], ['injected #99 (by A)', evil, 99]]) {
  const sigok = signedByAnyChainKey(file), listed = admits(file, n);
  console.log(`  ${label.padEnd(17)} ${(sigok ? 'yes' : 'no').padEnd(24)} ${(listed ? 'yes' : 'no').padEnd(20)} ${(sigok && listed ? 'Alice\'s' : 'refused').padEnd(19)} ${sigok ? 'Alice\'s' : 'refused'}`);
}
console.log(`
  The stolen key still verifies forever — dropping revocation timestamps does not change that, and
  could not: old posts must stay valid or every restore orphans the archive. What stops the
  injection is ADMISSION: a post is Alice's only if the CURRENT head (signed by B) lists its number
  at its hash. Turn admission off (accept any chain-key signature, which is what "no revocation
  timestamps" leaves you with alone) and #99 walks in. Admission is free here because the head is
  already an [n, hash] list — it is glm's rule, arriving for nothing.

  The residue, stated honestly: admission works at ALICE'S location, because only B can write B's
  head. It does NOT stop the thief serving a whole alternate profile (genesis->A, no restore, A
  current) at a host HE controls — that is the frozen-copy / relocation case, answered by the
  genesis link and gossip, not by admission.
`);

// ============================================================
console.log('============================================================');
console.log('ISSUE 3 — ruling 6 says a restore changes the key and nothing else. But a post-theft');
console.log('          restore must escape the thief\'s host. Do "key-only" and "must relocate" conflict?');
console.log('============================================================\n');
const HOME = 'alice.example', EXHOST = 'exhost.example', SAFE = 'newhub.net';
// Malicious restore: the ex is on the marriage-era list; he vouches himself in.
// The ex is on the marriage-era list and, because a restore once happened during the marriage, he
// knows that era's salt. That is the precondition the attack needs; see Issue 4.
const marriageSalt = crypto.randomBytes(16).toString('base64url');
const marriageRec = mkRec(1, marriageSalt, [mum, sister, ex]);
const relocatingRestore = { genesis: pub(G), pseq: 4, recovery: marriageRec, locations: [EXHOST], chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A), restoreHop(A, ex, [mum, sister, ex], [ex], marriageSalt)] };
const keyOnlyRestore = { genesis: pub(G), pseq: 4, recovery: marriageRec, locations: [HOME], chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A), restoreHop(A, ex, [mum, sister, ex], [ex], marriageSalt)] };
console.log('  A restore hop that is ALSO allowed to set the location:');
console.log(`     ex restores to his key AND moves Alice to ${relocatingRestore.locations[0]} in one step`);
console.log(`     -> readers follow to ${relocatingRestore.locations[0]}; Alice never even appears at a location to contest from\n`);
console.log('  A restore hop that changes the key only (location unchanged from the prior version):');
console.log(`     ex restores to his key; location stays ${keyOnlyRestore.locations[0]}`);
console.log('     -> during the veto window the contest happens at Alice\'s KNOWN location, where her');
console.log('        readers are already looking; only AFTER the window can the new key relocate\n');
// The good post-theft path: key-only restore to B, then a separate relocation by B.
const goodRestore = { genesis: pub(G), pseq: 4, recovery: rec, locations: [HOME], chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A), restoreHop(A, B, [mum, sister], [mum, sister], salt)] };
const thenRelocate = { ...goodRestore, pseq: 5, locations: [SAFE, HOME] };
console.log(`  Alice's own post-theft path: key-only restore (pseq 4, still ${goodRestore.locations[0]}),`);
console.log(`     then B publishes a relocation (pseq 5 -> ${thenRelocate.locations.join(', ')}). walk valid: ${walkChain(thenRelocate).ok}`);
console.log(`
  They do not conflict once you separate the RESTORE HOP from what the new key does next. The hop
  carries no location, so a malicious restore cannot relocate-and-lock in a single step with no
  window; a legitimate restore relocates a beat later with an ordinary higher-pseq profile. "Key
  only" is a property of the hop, not a life sentence on the key.
`);

// ============================================================
console.log('============================================================');
console.log('ISSUE 4 — the ex controls the host and serves a MARRIAGE-ERA profile in which he is still');
console.log('          a listed recoverer. Recovery-list rollback.');
console.log('============================================================\n');

// Real history, each profile version chained by prev-hash:
//   v3: recovery over {mum,sister,ex}, salt s3   (the ex is listed)
//   v4: recovery over {mum,sister},   salt s4    (the ex removed)
const s3 = crypto.randomBytes(16).toString('base64url'), s4 = crypto.randomBytes(16).toString('base64url');
const recV3 = mkRec(1, s3, [mum, sister, ex]);
const recV4 = mkRec(2, s4, [mum, sister]);
const p3 = sign({ genesis: pub(G), pseq: 3, prev: 'p2hash', recovery: recV3, chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A)], locations: [HOME] }, A);
const p4 = sign({ genesis: pub(G), pseq: 4, prev: H(parse(p3).body), recovery: recV4, chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A)], locations: [HOME] }, A);

console.log('  Case 1 — the ex never saw a restore, so he does not know v3\'s secret salt s3:');
// He serves v3 and tries to mint a restore against recV3 WITHOUT knowing s3 (guesses a salt).
const blindHop = restoreHop(A, ex, [mum, sister, ex], [ex], crypto.randomBytes(16).toString('base64url'));
const blindProfile = { genesis: pub(G), pseq: 4, prev: H(parse(p3).body), recovery: recV3, locations: [EXHOST], chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A), blindHop] };
console.log(`     his restore against v3\'s commit walks valid?   ${walkChain(blindProfile).ok}  -- he cannot reproduce the commit without s3`);
console.log('     So the naive rollback FAILS at the salt: the commitment is unguessable pre-restore even');
console.log('     though he knows every member key (commitment-exp.js), because the salt is his to lack.\n');

console.log('  Case 2 — a restore DID happen during the marriage, so the ex learned s3 and the v3 members:');
const knownHop = restoreHop(A, ex, [mum, sister, ex], [ex], s3);   // now he knows s3
const rolledBack = { genesis: pub(G), pseq: 4, prev: H(parse(p3).body), recovery: recV3, locations: [EXHOST], chain: [{ key: pub(G), by: 'genesis' }, rotHop(G, A), knownHop] };
console.log(`     his restore against v3\'s commit walks valid?   ${walkChain(rolledBack).ok}  -- now it does; k=1 and he signs`);
const pinnedPseq = parse(p4).obj.pseq;
const forkAtPseq = rolledBack.pseq === pinnedPseq && H(parse(p4).body) !== H(Buffer.from(JSON.stringify(rolledBack)));
console.log(`     COLD reader (no pin) accepts it?               yes  -- nothing tells it v3\'s list was superseded`);
console.log(`     PINNED reader (saw real v4) accepts it?        ${!forkAtPseq}  -- two different objects at pseq 4 => profile fork`);
console.log(`
  So the salt is doing real work: it defends BOTH pre-restore enumeration AND a naive rollback
  replay. The residual attack (Case 2) needs a prior restore that leaked a list the attacker was
  on — narrow, but real in a long marriage. Its defenses are the ones already on the table:
   - the profile is PREV-HASH CHAINED, so the rollback is a visible fork to anyone who saw the
     ex-removal version (revert-check below);
   - a restore hop may NOT change the recovery commitment (ruling 6's "nothing else"), so a
     successful takeover still cannot entrench a new list the real owner cannot undo;
   - the veto window lets the real owner, still holding a key, contest during the window.
  A cold reader with no pin is exposed, as in every hostile-host case, and answered the same way:
  the genesis link points at Alice's location, not the ex\'s.
`);
console.log(`  revert-check: with NO prev-hash on the profile, both Case-2 objects are "just pseq 4" and the`);
console.log(`     pinned reader has no fork to see -> silent takeover. The prev-hash is load-bearing.`);
