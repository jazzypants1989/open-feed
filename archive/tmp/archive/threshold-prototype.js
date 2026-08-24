// Does k-of-n recovery have to fail open?
//
// §4.5 forbids it permanently, with the reason beside the MUST:
//
//   "`_recovery_sig` is a **single co-signature, permanently and by design**: a threshold (k-of-n)
//    scheme MUST NOT be layered on by extension. A verifier that does not implement the threshold
//    sees the one co-signature it understands and accepts it, so any such extension fails **open**
//    at exactly the moment it exists to guard — handing a recovery-key thief the choice of
//    verifier."
//
// That argument is sound for one shape of extension and is asserted for all of them. §4.6 —
// written in the same commit that closed this question — establishes the opposite technique for
// exactly this problem: mark the key with a `use` token, because §4.1 makes an implementation
// IGNORE a key whose `use` it does not recognize, so everything that key touched fails CLOSED.
//
// So: three questions, and the first two are settled by running the SHIPPED verifier rather than
// by reasoning about a hypothetical one.
//
//   Q1  Does the fail-open shape §4.5 describes actually fail open here?           (it should)
//   Q2  Does a fail-CLOSED shape exist — `_recovery_sigs` plus a `use` token?      (it should)
//   Q3  Would it buy anything against the adversary this protocol is built around — the relative
//       with physical access to the printed card (§13.2's hostile-custodian tier)?
//
// Imports src/: `verifyMigration` and `verifyRecoverySignature` under test are the shipped ones,
// because "an old verifier rejects this" is a claim about a real verifier or it is nothing.

import {
  verifyMigration,
  verifyRecoverySignature,
  recoveryPin,
  documentHash,
  canonicalBytes,
  signingPayload,
  signingInput,
  buildHeader,
  normalizeIdentityUrl,
  sign,
} from '../../src/index.js';
import crypto from 'node:crypto';

const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`Q${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };

const T0 = 1736899200;
const DAY = 86400;

function makeKey(kid, use) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, privateKey, jwk: { crv: 'Ed25519', iat: T0 - DAY, kid, kty: 'OKP', x, ...(use ? { use } : {}) } };
}

/** A detached co-signature over §6.3's co-signing bytes, by `key`, naming `identity`. */
function coSign(doc, key, identity) {
  // §6.2's `typ`: a recovery co-signature is only ever over an identity-chain version.
  const headerB64 = Buffer.from(JSON.stringify(buildHeader(`${identity}#${key.kid}`, 'identity')), 'utf8').toString('base64url');
  const sig = crypto.sign(null, signingInput(headerB64, signingPayload(doc)), key.privateKey);
  return `${headerB64}..${Buffer.from(sig).toString('base64url')}`;
}

const OLD = 'https://old.example/~mom/';
const NEW = 'https://mom.example/';
const THIEF = 'https://not-mom.example/';

const root = makeKey('root-1');
const newRoot = makeKey('new-root-1');
const thiefRoot = makeKey('thief-1');

// ---------------------------------------------------------------------------------------
// Q1 — the shape §4.5 describes. Three recovery keys, all marked `use: "recovery"`, with the
// threshold rule living *outside* the key entries: in an extension field, a profile, a README.
// ---------------------------------------------------------------------------------------

scene(1, 'The fail-OPEN shape §4.5 argues against — confirmed against the shipped verifier');

const openKeys = [makeKey('rec-a', 'recovery'), makeKey('rec-b', 'recovery'), makeKey('rec-c', 'recovery')];

const predecessorOpen = {
  url: OLD, seq: 4, updated: T0,
  keys: [root.jwk, ...openKeys.map((k) => k.jwk)],
  // A threshold declared where an old verifier will not look for it. This is the extension
  // §4.5 forecloses, in its most plausible form.
  _recovery_threshold: 2,
};
predecessorOpen._sig = sign(predecessorOpen, root.privateKey, `${OLD}#root-1`, { kind: 'identity' });

// The thief holds exactly ONE of the three cards, and mints a migration with one co-signature.
const stolenOne = {
  url: THIEF, seq: 1, updated: T0 + 30 * DAY,
  predecessor: OLD,
  keys: [thiefRoot.jwk],
};
stolenOne._sig = sign(stolenOne, thiefRoot.privateKey, `${THIEF}#thief-1`, { kind: 'identity' });
stolenOne._recovery_sig = coSign(stolenOne, openKeys[0], OLD);

const pinOpen = recoveryPin(predecessorOpen);
const openResult = verifyMigration({
  predecessorDocument: predecessorOpen,
  successorDocument: stolenOne,
  pinnedAncestor: pinOpen,
});

say(`  predecessor commits 3 recovery keys and declares a threshold of ${predecessorOpen._recovery_threshold}`);
say('  a thief holding ONE card mints a migration with ONE co-signature');
say();
say(`  shipped verifier verdict : verified=${openResult.verified}  via=${openResult.via}`);
say();
say('  §4.5 is exactly right about this shape. The threshold sits in a field a pre-extension');
say('  verifier does not read, the one co-signature it does understand verifies, and the identity');
say('  moves to a URL the thief controls. The extension fails OPEN at the moment it exists to');
say('  guard, and the thief gets to choose which verifier adjudicates their theft.');

// ---------------------------------------------------------------------------------------
// Q2 — the fail-CLOSED shape. Same idea, two changes, both borrowed from §4.6:
//   · the keys carry an unrecognized `use`, so §4.1 makes an old verifier IGNORE them
//   · the signatures live in `_recovery_sigs` (an array), so `_recovery_sig` is simply absent
// ---------------------------------------------------------------------------------------

scene(2, 'A fail-CLOSED shape — `_recovery_sigs` plus a `use` token §4.1 already hides');

const USE = 'recovery-threshold';
const closedKeys = [makeKey('rec-a', USE), makeKey('rec-b', USE), makeKey('rec-c', USE)];

const predecessorClosed = {
  url: OLD, seq: 4, updated: T0,
  keys: [root.jwk, ...closedKeys.map((k) => k.jwk)],
  _recovery_threshold: 2,
};
predecessorClosed._sig = sign(predecessorClosed, root.privateKey, `${OLD}#root-1`, { kind: 'identity' });
const pinClosed = recoveryPin(predecessorClosed);

// (a) The thief, again holding one card, tries the same trick under the new shape.
const stolenClosed = {
  url: THIEF, seq: 1, updated: T0 + 30 * DAY, predecessor: OLD, keys: [thiefRoot.jwk],
};
stolenClosed._sig = sign(stolenClosed, thiefRoot.privateKey, `${THIEF}#thief-1`, { kind: 'identity' });
stolenClosed._recovery_sigs = [coSign(stolenClosed, closedKeys[0], OLD)];

const thiefClosed = verifyMigration({
  predecessorDocument: predecessorClosed, successorDocument: stolenClosed, pinnedAncestor: pinClosed,
});

// (b) The legitimate 2-of-3 migration, as an old verifier sees it.
const genuine = {
  url: NEW, seq: 1, updated: T0 + 30 * DAY, predecessor: OLD, keys: [newRoot.jwk],
};
genuine._sig = sign(genuine, newRoot.privateKey, `${NEW}#new-root-1`, { kind: 'item' });
genuine._recovery_sigs = [coSign(genuine, closedKeys[0], OLD), coSign(genuine, closedKeys[1], OLD)];

const genuineOld = verifyMigration({
  predecessorDocument: predecessorClosed, successorDocument: genuine, pinnedAncestor: pinClosed,
});

// (c) …and the belt-and-braces case: an attacker who ALSO copies one signature into the field an
//     old verifier does read, hoping to be waved through.
const smuggled = { ...genuine };
delete smuggled._sig;
smuggled.url = THIEF;
smuggled.keys = [thiefRoot.jwk];
smuggled._sig = sign(smuggled, thiefRoot.privateKey, `${THIEF}#thief-1`, { kind: 'identity' });
smuggled._recovery_sig = coSign(smuggled, closedKeys[0], OLD);   // one signature, in the old field
const smuggledResult = verifyMigration({
  predecessorDocument: predecessorClosed, successorDocument: smuggled, pinnedAncestor: pinClosed,
});
const smuggledCo = verifyRecoverySignature(smuggled, { pinnedAncestor: pinClosed });

say(`  keys are marked \`use: "${USE}"\`, which §4.1 tells an implementation to ignore`);
say('  signatures live in `_recovery_sigs`, so `_recovery_sig` is absent entirely');
say();
say('  as seen by the SHIPPED (pre-extension) verifier:');
say(`    thief, 1 of 3 signatures      : verified=${String(thiefClosed.verified).padEnd(5)}  ${thiefClosed.reason ?? ''}`);
say(`    genuine, 2 of 3 signatures    : verified=${String(genuineOld.verified).padEnd(5)}  ${genuineOld.reason ?? ''}`);
say(`    thief smuggling 1 sig into the old field:`);
say(`                                    verified=${String(smuggledResult.verified).padEnd(5)}  ${smuggledResult.reason ?? ''}`);
say(`      (the co-signature itself: valid=${smuggledCo.valid} — ${smuggledCo.reason})`);
say();
say('  Every one of them is refused, and the third is the interesting one: even when an attacker');
say('  puts a genuine co-signature in the field an old verifier reads, `§4.1`\'s ignore rule means');
say('  the key does not resolve at all, so the signature verifies against nothing. The threshold');
say('  is not enforced by an old verifier — it is enforced by an old verifier declining to');
say('  adjudicate, which is precisely what failing closed means.');
say();
say('  A NEW verifier, implementing the extension, would count distinct valid co-signatures over');
say('  §6.3\'s co-signing bytes and require `_recovery_threshold` of them. Modelled here rather');
say('  than shipped, since the point is what the OLD one does:');

function verifyThreshold(doc, { pinnedAncestor, threshold, use }) {
  const identity = normalizeIdentityUrl(pinnedAncestor.url);
  const keys = (pinnedAncestor.keys ?? []).filter((k) => k?.use === use);
  const seen = new Set();
  for (const s of Array.isArray(doc._recovery_sigs) ? doc._recovery_sigs : []) {
    // Reuse the shipped single-signature checker by presenting one signature at a time in the
    // field it reads — the construction is unchanged (§6.1), which is the whole point.
    for (const jwk of keys) {
      const probe = { ...doc, _recovery_sig: s };
      delete probe._recovery_sigs;
      const r = verifyRecoverySignature(probe, {
        pinnedAncestor: { ...pinnedAncestor, keys: [{ ...jwk, use: 'recovery' }] },
      });
      if (r.valid) { seen.add(jwk.kid); break; }
    }
  }
  return { valid: seen.size >= threshold, count: seen.size, threshold };
}

const newOnGenuine = verifyThreshold(genuine, { pinnedAncestor: pinClosed, threshold: 2, use: USE });
const newOnThief = verifyThreshold(stolenClosed, { pinnedAncestor: pinClosed, threshold: 2, use: USE });
say(`    genuine, 2 of 3 : valid=${newOnGenuine.valid}  (${newOnGenuine.count}/${newOnGenuine.threshold} distinct keys)`);
say(`    thief,   1 of 3 : valid=${newOnThief.valid}  (${newOnThief.count}/${newOnThief.threshold} distinct keys)`);

verdict(
  'A fail-closed k-of-n extension exists and needs nothing this specification does not already\n'
  + 'have: §4.1\'s ignore-unrecognized-`use` rule, §6.1\'s single construction, and §6.3\'s\n'
  + 'co-signing bytes. §4.5\'s stated reason is true of the shape it describes and false as a\n'
  + 'general claim — and the technique that refutes it is §4.6\'s, written in the same commit.',
);

// ---------------------------------------------------------------------------------------

scene(3, 'Would it buy anything against the adversary this design is actually about?');

// §13.2's hostile-custodian tier: a relative who operates the hub AND has physical access to the
// house the recovery card is stored in. §4.5 today says: hold the card somewhere they cannot
// reach. §3.4 says two competing recovery migrations are unresolvable.
const rows = [
  ['1-of-1 (today)', 1, 1],
  ['1-of-n (today, §4.5 permits)', 1, 3],
  ['2-of-3 (the extension)', 2, 3],
];
say('  scheme                          thief with 1 card    owner who lost 1 card    owner who lost 2');
for (const [name, k, n] of rows) {
  const thiefWins = 1 >= k;
  const ownerAfter1 = (n - 1) >= k;
  const ownerAfter2 = (n - 2) >= k;
  say(`  ${name.padEnd(30)} ${(thiefWins ? 'CAN take the name' : 'cannot').padEnd(21)}`
    + `${(ownerAfter1 ? 'can still exit' : 'CANNOT exit').padEnd(25)}`
    + `${ownerAfter2 ? 'can still exit' : 'CANNOT exit'}`);
}
say();
say('  The middle row is the one that matters, because it is what the spec offers today and it is');
say('  the wrong end of the trade for this threat model. §4.5 permits several recovery keys and');
say('  says so plainly: "That is 1-of-n rather than k-of-n, and it fails closed, so it is');
say('  permitted — but it buys availability and nothing against theft." Availability is the');
say('  problem a family hub does NOT have (§13.2\'s adversary is a person, not a disk), and theft');
say('  is the problem it does.');
say();
say('  What 2-of-3 costs, stated as plainly:');
say('   · the owner must reach TWO holders to exit, at the moment they are least able to ask');
say('     favours — which is the same moment §14 says an export must need no one\'s cooperation.');
say('   · losing two cards is now unrecoverable where losing one was survivable.');
say('   · a custodian who holds TWO of the three has BOTH capabilities: they can migrate alone and');
say('     they can block. So the scheme is only as good as the distribution, and distribution is a');
say('     product decision no verifier can check — the same unverifiability §15.5 item 1 names.');

// ---------------------------------------------------------------------------------------

say();
say('='.repeat(78));
const gate = [
  ['the fail-open shape is accepted by the shipped verifier', openResult.verified === true],
  ['a `_recovery_sigs` document is refused by the shipped verifier', genuineOld.verified === false],
  ['a thief\'s single signature is refused under the closed shape', thiefClosed.verified === false],
  ['smuggling a valid signature into the old field does not help', smuggledResult.verified === false],
  ['an extension-aware verifier accepts 2-of-3 and refuses 1-of-3',
    newOnGenuine.valid === true && newOnThief.valid === false],
];
const failed = gate.filter(([, ok]) => !ok);
if (failed.length) { for (const [w] of failed) console.error(`FAILED: ${w}`); process.exit(1); }

verdict(
  'DO NOT define k-of-n here — but REWRITE §4.5\'s reason, because the one it gives is false and\n'
  + 'a false justification beside a MUST is worse than no justification: it is the sentence that\n'
  + 'stops the next implementer thinking, and it will not survive the first person who tries.\n'
  + '\n'
  + 'What the measurements support, precisely:\n'
  + '\n'
  + '  · Q1 confirms the fail-open shape. An extension that reuses `_recovery_sig` and declares\n'
  + '    its threshold anywhere else IS accepted by a pre-extension verifier, with one stolen\n'
  + '    card. That specific extension should stay forbidden and the text should say so.\n'
  + '  · Q2 refutes the generalization. `_recovery_sigs` plus a `use` token §4.1 hides fails\n'
  + '    closed at every stage, including against an attacker who smuggles a genuine signature\n'
  + '    into the old field. "MUST NOT be layered on by extension" is therefore too strong; the\n'
  + '    rule that is actually load-bearing is "MUST NOT reuse `_recovery_sig`".\n'
  + '  · Q3 says the ban is still right on its merits, for reasons §4.5 does not currently give.\n'
  + '    k-of-n moves the failure from theft to availability and coordination, and §14 requires\n'
  + '    an exit that needs nobody\'s cooperation — a 2-of-3 exit needs one other person\'s, at\n'
  + '    exactly the moment §13.2 says the owner is least able to ask. And a custodian holding two\n'
  + '    shares gains both capabilities at once. That is a custody-distribution problem no\n'
  + '    verifier can check, which is the same class of unverifiable claim §15.5 item 1 isolates.\n'
  + '\n'
  + 'So: keep the scope decision, replace the argument. §4.5 should forbid reusing `_recovery_sig`\n'
  + '(with Q1\'s demonstration as the reason), note that a fail-closed shape is constructible and\n'
  + 'is simply out of scope, and say the real thing — that this specification\'s recovery story is\n'
  + 'one key held where the custodian cannot reach it, and that spreading it across holders trades\n'
  + 'a theft risk for a coordination risk at the worst possible moment.',
);
say();
say('ALL CLAIMS HOLD');
