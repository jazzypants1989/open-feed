// Migration and exit (§3.4): does the mechanism the whole threat model resolves to actually
// work, and what does it fail to say?
//
// §13.2 ends every adversary tier at the same place — "what the protocol offers this user is
// **exit**: §3.4, §4.5, §14, real only if all three hold at once." None of §3.4 is implemented
// or exercised anywhere: `verifyRecoverySignature` and `resolveFork` exist in src/chain.js with
// no migration consuming them, and `assertRelocationCarriesForward` (§9.3 invariant 5) has
// never seen a relocation. So the load-bearing claim is the untested one.
//
// Five scenes, each ending in a verdict about the TEXT rather than the code:
//
//   S1  cooperative migration — successor/predecessor, back catalog byte-verbatim
//   S2  recovery migration against a host that simply declines (§4.5's MUST NOT reject)
//   S3  the abandoned host tombstones the back catalog afterwards. §7.5 says the successor's
//       manifest wins. Nothing says the predecessor's CHAIN is retired, and the consumer is
//       still pinned to it — so what does a conforming consumer actually answer?
//   S4  the recovery key is stolen. It cannot sign a chain version (§5.2 step 3), so what CAN
//       it do? Mint a competing migration. Two valid recovery migrations from one predecessor,
//       and §5.5 adjudicates forks of a chain, not forks of a migration.
//   S5  inbound replies after the move address `{old_feed}#{id}`. §3.4 says record the
//       predecessor's feed URLs at migration time. Is that bookkeeping necessary?
//
// UNLIKE the other prototypes here, this one imports src/ instead of re-deriving canon/sign.
// Those explore whether a mechanism should exist and are right to stay independent of any
// implementation. This one asks whether mechanisms that ALREADY exist compose into a working
// exit — a question you can only answer by composing the real ones. Re-implementing the chain
// walk would be testing a second walk.

import crypto from 'node:crypto';

import {
  Publisher,
  PinStore,
  walkToPin,
  identityChainPolicy,
  manifestChainPolicy,
  verifyRecoverySignature,
  resolveFork,
  derivedVersionUrl,
  assertRelocationCarriesForward,
  documentHash,
  canonicalBytes,
  sign,
  normalizeIdentityUrl,
} from '../src/index.js';

// ---- a web ------------------------------------------------------------------------------
// url -> document. Every host publishes into it; the consumer only ever reads from it, which
// keeps "who could have served this" honest: nothing reaches the consumer except through here.

const web = new Map();
const publish = (pub) => { for (const [url, doc] of pub.documents()) web.set(url, doc); };
const fetchVersion = async (url, seq) => web.get(derivedVersionUrl(url, seq));

let clock = 1736899200;
const tick = (seconds = 3600) => (clock += seconds);
const now = () => clock;

function makeSigner(kid, { use, iat = 1736899200 - 86400 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat, kid, kty: 'OKP', x };
  if (use) jwk.use = use;
  return { kid, jwk, privateKey };
}

// ---- a consumer -------------------------------------------------------------------------
// Level 1 (§12): pins both chains, walks `prev` to the pin on every later fetch, and treats a
// pin it cannot connect as unverifiable rather than re-pinning (§5.3).

function makeConsumer(label) {
  const pins = new PinStore({ now });
  const identities = new Map();   // identity url -> the tip it last verified
  const manifests = new Map();    // manifest url -> the tip it last verified
  const retired = new Set();      // S3's proposed rule, off until we argue for it

  async function readIdentity(identityUrl) {
    const tip = web.get(identityUrl);
    if (!tip) throw new Error(`${identityUrl} is unreachable`);
    const { hash } = await walkToPin({
      url: identityUrl, tip, pin: pins.pin(identityUrl), fetchVersion, policy: identityChainPolicy, pins,
    });
    pins.advance(identityUrl, tip.seq, hash);
    identities.set(identityUrl, tip);
    return tip;
  }

  async function readManifest(manifestUrl, identityDocument) {
    const tip = web.get(manifestUrl);
    if (!tip) throw new Error(`${manifestUrl} is unreachable`);
    const { hash } = await walkToPin({
      url: manifestUrl, tip, pin: pins.pin(manifestUrl), fetchVersion,
      policy: manifestChainPolicy(identityDocument), pins,
    });
    pins.advance(manifestUrl, tip.seq, hash);
    manifests.set(manifestUrl, tip);
    return tip;
  }

  return { label, pins, identities, manifests, retired, readIdentity, readManifest };
}

const say = (s = '') => console.log(s);
const scene = (n, title) => { say(); say(`${'='.repeat(78)}`); say(`S${n}. ${title}`); say('='.repeat(78)); };
const verdict = (text) => { say(); say(`  VERDICT  ${text.replace(/\n/g, '\n           ')}`); };

// ---- the cast ---------------------------------------------------------------------------
// Mom is hosted by a family hub that holds her ROOT signing key — §13.2's key-custodian tier,
// which §12 no longer recommends but which is what most hosted setups are. That choice is the
// scenes' independent variable: S2 and S4 turn on what the host can and cannot sign.

const HUB = 'https://mom.hub.example/';
const OWN = 'https://mom.example/';
const EVE = 'https://mom-archive.example/';   // Eve's URL, named to look like a continuation

const hubSigner = makeSigner('hub-1');
const recovery = makeSigner('recovery-1', { use: 'recovery' });

const hub = new Publisher({
  identity: HUB, title: "Mom's Journal", signer: hubSigner,
  profile: { name: 'Mom' }, recoveryKeys: [recovery.jwk], now,
});

// A year of ordinary publishing, so the back catalog is a real thing to carry.
const BACK_CATALOG = ['urn:uuid:0001-cookies', 'urn:uuid:0002-garden', 'urn:uuid:0003-birthday'];
for (const id of BACK_CATALOG) {
  tick();
  hub.publishItem({ id, content_text: `entry ${id}` });
  hub.advanceManifest({ updated: tick() });
}
hub.advanceIdentity({ bio: 'Grandmother, gardener, cat enthusiast.' }, { updated: tick() });
publish(hub);

const HUB_IDENTITY = `${HUB}openfeed.json`;
const HUB_MANIFEST = `${HUB}manifest.json`;
const HUB_FEED = `${HUB}feed.json`;

// Gran has read Mom for a year and holds pins of both chains. She is the party every scene is
// actually about: §13.2's guarantees are all statements about what a pinned consumer detects.
const gran = makeConsumer('Gran');
const hubTip = await gran.readIdentity(HUB_IDENTITY);
await gran.readManifest(HUB_MANIFEST, hubTip);

// The hashes Gran now holds for each item. §3.4's "byte-verbatim, do not re-sign" is a claim
// about exactly these surviving the move, so capture them before anything moves.
const granHeldHashes = new Map(
  Object.entries(gran.manifests.get(HUB_MANIFEST).items).map(([id, [, hash]]) => [id, hash]),
);

say(`Setup: ${HUB} — identity seq ${hubTip.seq}, manifest seq ${gran.manifests.get(HUB_MANIFEST).seq}, ` +
    `${BACK_CATALOG.length} items.`);
say(`       Gran pinned both chains. She holds ${granHeldHashes.size} item hashes.`);
say(`       The hub holds Mom's root signing key. Her recovery key is offline.`);

// =========================================================================================
scene(1, 'Cooperative migration — the case where nobody is hostile');
// =========================================================================================

// Mom stands up her own domain. Same recovery key; a fresh signing key, since the hub held
// the old one and the point is to stop it signing for her.
const ownSigner = makeSigner('own-1');
const own = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: ownSigner,
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now: () => tick(0),
});

// §3.4: "republish the back catalog **byte-verbatim**; do not re-sign it." Not a loop over
// publishItem — that would re-sign, bump _version, and rewrite _feed_url. The bytes move
// unaltered, which is why every hash Gran holds survives.
for (const [id, item] of hub.items) own.items.set(id, item);
own.advanceManifest({ updated: tick() });

// The old side co-operates: one more chain version naming where it went.
hub.advanceIdentity({ successor: OWN }, { updated: tick() });
publish(hub); publish(own);

const OWN_IDENTITY = `${OWN}openfeed.json`;
const OWN_MANIFEST = `${OWN}manifest.json`;
const OWN_FEED = `${OWN}feed.json`;

// Gran refetches and finds the successor link.
const hubAfter = await gran.readIdentity(HUB_IDENTITY);
const ownGenesis = web.get(OWN_IDENTITY);
const linksAgree = hubAfter.successor === OWN &&
  normalizeIdentityUrl(ownGenesis.predecessor) === normalizeIdentityUrl(HUB);

say(`  ${HUB} seq ${hubAfter.seq} carries successor -> ${hubAfter.successor}`);
say(`  ${OWN} seq ${ownGenesis.seq} carries predecessor -> ${ownGenesis.predecessor}`);
say(`  the pair cross-signs: ${linksAgree}  (each link sits inside signed bytes, §3.4 step 2)`);

const ownTip = await gran.readIdentity(OWN_IDENTITY);
const ownManifest = await gran.readManifest(OWN_MANIFEST, ownTip);

// The claim §3.4 makes about the back catalog, checked rather than asserted.
let hashesIntact = 0;
for (const [id, held] of granHeldHashes) {
  if (ownManifest.items[id]?.[1] === held) hashesIntact++;
}
const carried = assertRelocationCarriesForward(
  gran.manifests.get(HUB_MANIFEST), ownManifest, { fromUrl: HUB_MANIFEST, toUrl: OWN_MANIFEST },
);

say(`  back catalog: ${hashesIntact}/${granHeldHashes.size} hashes Gran already held still match`);
say(`  §9.3 invariant 5: ${carried.carried} ids carried forward, none dropped`);

// And the items at the new feed still name the OLD feed inside their signed bytes.
const sample = own.items.get(BACK_CATALOG[0]);
say(`  every carried item still signs _feed_url = ${sample._feed_url}`);
say(`  ...served from ${OWN_FEED}, so §7.5's plain test reads them as COPIES.`);
say(`  Only the verified migration makes them canonical here — the predecessor exception.`);

verdict(
  'Works, and the byte-verbatim rule earns its keep: nothing was re-signed, so every hash\n' +
  'Gran accumulated over a year survives the move. Re-signing would have invalidated all\n' +
  `${granHeldHashes.size} of them and every peer pin (§16.1) covering the same history.`,
);

// =========================================================================================
scene(2, 'Recovery migration — the host simply declines');
// =========================================================================================

// Rewind: the same move, but the hub never publishes a `successor`. §3.4 calls this the case
// the mechanism must be judged against, "because it is the only one where the other party is
// adversarial." The hub does nothing at all — no forgery, no takedown. It just keeps serving.

const declined = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: makeSigner('own-2'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now: () => tick(0),
});
// The recovery co-signature. §6.3 strips BOTH signature fields before canonicalizing, so the
// root signer and the recovery co-signer sign identical bytes and neither covers the other.
//
// Note the `kid`, which is where this prototype's first surprise lives — see the finding below.
// It names the PREDECESSOR, not the document it sits on.
const declinedGenesis = { ...declined.identityDocument };
declinedGenesis._recovery_sig = sign(declinedGenesis, recovery.privateKey, `${HUB}#${recovery.kid}`);

// The other reading, built so the difference is visible rather than asserted.
const kidNamesSelf = { ...declined.identityDocument };
kidNamesSelf._recovery_sig = sign(kidNamesSelf, recovery.privateKey, `${OWN}#${recovery.kid}`);

// Gran verifies the co-signature against the recovery key committed in the version of the
// predecessor chain she has ACTUALLY verified — §4.5 is emphatic that this is the most recent
// one, not any older ancestor she still retains.
const pinnedAncestor = gran.identities.get(HUB_IDENTITY);
const recoveryCheck = verifyRecoverySignature(declinedGenesis, { pinnedAncestor });

const selfKidCheck = verifyRecoverySignature(kidNamesSelf, { pinnedAncestor });

say(`  the hub published no successor. It is still up, still serving seq ${pinnedAncestor.seq}.`);
say(`  Gran checks the co-signature against the recovery key committed at her pin:`);
say(`    valid: ${recoveryCheck.valid}, signer: ${recoveryCheck.signer}`);
say();
say(`  FOUND: which identity does a _recovery_sig's \`kid\` name? The spec never says, and the`);
say(`  two readings are not interchangeable:`);
say(`    kid = {predecessor}#recovery-1  -> ${recoveryCheck.valid ? 'verifies' : 'fails'}`);
say(`    kid = {successor}#recovery-1    -> ${selfKidCheck.valid ? 'verifies' : `fails — ${selfKidCheck.reason}`}`);
say(`  Only the first can be right. §4.5 resolves the key out of the PINNED ANCESTOR, so a kid`);
say(`  naming the new document would send a verifier to resolve it in the very document making`);
say(`  the claim — self-blessing, and the attack §4.2 calls "possession of a key that merely`);
say(`  verifies proves nothing about any identity."`);
say(`  But §6.6 says the claimed author MUST equal the kid's identity URL, and this document's`);
say(`  claimed author is ${OWN}. Read literally, §6.6 forbids the only correct form. §6.6 is`);
say(`  written for _sig and never scopes itself; on a migration document the two fields need`);
say(`  different rules, and §3.4 path 3 is the one place they diverge.`);
say();
say(`  §4.5: verifiers MUST NOT reject a recovery migration merely because the original`);
say(`  identity is still being served — "treating 'still reachable' as grounds for rejection`);
say(`  would hand a hostile custodian a veto over their user's exit by doing nothing at all."`);

// Now the sharp part, which §4.5 permits in the very next sentence.
const conflicting = { ...pinnedAncestor };
say();
say(`  BUT: the hub holds Mom's ROOT key, so it can publish a conflicting successor instead`);
say(`  of doing nothing — and §4.5 says verifiers MAY then reject the recovery migration.`);
hub.advanceIdentity({ successor: 'https://mom.hub-archive.example/' }, { updated: tick() });
publish(hub);
const hostile = await gran.readIdentity(HUB_IDENTITY);
say(`    the hub's chain now advances to seq ${hostile.seq}: successor -> ${hostile.successor}`);
say(`    Mom's own claim carries a valid recovery co-signature. Both are well-formed.`);
say(`    Nothing in §3.4 or §5.5 ranks them: one is a chain advance, one is a co-signature.`);

verdict(
  'Two findings, one of them unanticipated.\n' +
  '\n' +
  "(a) The `kid` on a migration's _recovery_sig MUST name the predecessor, and the spec\n" +
  '    never says so — while §6.6, read literally, forbids it. Unspecified and load-bearing:\n' +
  '    the self-naming reading resolves the key from the document making the claim.\n' +
  '    -> §3.4 path 3 states the kid form; §6.6 scopes its author binding to _sig.\n' +
  '\n' +
  '(b) Recovery migration works against a host that DECLINES, which is what §4.5 promises.\n' +
  '    It does not work against a host that ANSWERS — and a root-key-holding hub can always\n' +
  '    answer. That is the concrete price of root custody and the sharpest argument for §12\n' +
  '    recommending delegated keys: a hub that cannot advance the chain cannot contest an\n' +
  '    exit. Worth saying at §4.6/§12 in those terms, since today it reads as a preference.',
);

// =========================================================================================
scene(3, 'A6 — the abandoned host tombstones the back catalog');
// =========================================================================================

// Back to the cooperative timeline, where Gran verified the migration in S1. The hub still
// serves the old feed and manifest, still holds the key that signs them, and now retires
// everything Mom ever published there.

for (const id of BACK_CATALOG) hub.tombstone(id, { at: tick() });
hub.advanceManifest({ updated: tick() });
publish(hub);

const hubManifestAfter = await gran.readManifest(HUB_MANIFEST, await gran.readIdentity(HUB_IDENTITY));

say(`  the hub advanced its manifest to seq ${hubManifestAfter.seq}, moving all`);
say(`  ${BACK_CATALOG.length} ids into \`deleted\` under signed tombstones.`);
say();
say(`  What breaks? Nothing:`);
say(`    §9.3 invariant 1 — satisfied, the ids are in \`deleted\`, not missing`);
say(`    §5.3.1 compare rule — no equivocation, one branch, one hash per seq`);
say(`    signatures — valid, the hub holds the key`);
say(`    Gran's pin on ${HUB_MANIFEST} — advanced cleanly to seq ${hubManifestAfter.seq}`);
say();

// So Gran now holds two answers for one item, and both chains verify.
const id = BACK_CATALOG[0];
const perOldChain = hubManifestAfter.deleted?.[id] ? 'DELETED' : 'live';
const perNewChain = ownManifest.items[id] ? 'live' : 'deleted';
say(`  Gran asks: is ${id} live?`);
say(`    per ${HUB_MANIFEST}: ${perOldChain}`);
say(`    per ${OWN_MANIFEST}: ${perNewChain}`);
say();
say(`  §7.5 answers it — consult the manifest of the feed where the item is CANONICAL, which`);
say(`  after a verified migration is the successor's. It even gives the reason: resolving to`);
say(`  the predecessor's "would let an abandoned host tombstone a departed identity's entire`);
say(`  back catalog for every reader of every copy."`);
say();
say(`  What §7.5 does NOT say is what happens to the PIN. Gran is still pinned to a chain the`);
say(`  hub controls, still walking it, still advancing it — and §5.3.1 is keyed on document`);
say(`  URL, so the old chain advancing is not equivocation. It is simply a chain whose answers`);
say(`  no longer bind, with nothing telling her to stop asking.`);

// The proposed rule, applied.
gran.retired.add(HUB_IDENTITY);
gran.retired.add(HUB_MANIFEST);
const answerWithRule = gran.retired.has(HUB_MANIFEST) ? perNewChain : perOldChain;
say();
say(`  With A6's rule — a verified migration RETIRES the predecessor's chains; keep the pins`);
say(`  as history, stop advancing them, stop reading liveness out of them:`);
say(`    Gran's answer: ${answerWithRule}, and she stops fetching ${HUB_MANIFEST} at all.`);

verdict(
  'The gap is real and it is not §7.5 — §7.5 already picks the right manifest. The gap is\n' +
  'that a consumer keeps a LIVE PIN on a chain the departed-from host still controls, with\n' +
  'no rule retiring it. Two conforming implementations therefore disagree about a departed\n' +
  "member's back catalog, and the disagreement favors the host being left. One sentence in\n" +
  '§3.4 fixes it, next to predecessor equivalence, which is where a reader will look.',
);

// =========================================================================================
scene(4, 'B1 — the recovery key is stolen');
// =========================================================================================

// The distribution model's onboarding warns that a card in a drawer is exactly the artifact a
// hostile-custodian adversary has physical access to. Suppose they take it. What can they do?

say(`  First, what they CANNOT do. §5.2 step 3 requires a continuity key — non-revoked,`);
say(`  non-recovery, non-delegated — so a recovery key cannot sign a chain version at all.`);
let forgedChainVersion = null;
try {
  const forged = { ...pinnedAncestor, seq: pinnedAncestor.seq + 1, prev: documentHash(pinnedAncestor) };
  delete forged._sig;
  forged.updated = tick();
  forged._sig = sign(forged, recovery.privateKey, `${HUB}#${recovery.kid}`);
  identityChainPolicy.verifySignature(forged);
  forgedChainVersion = 'ACCEPTED';
} catch (e) {
  forgedChainVersion = `rejected — ${e.message.split(',')[0]}`;
}
say(`    a chain version signed by the recovery key: ${forgedChainVersion}`);
say();
say(`  So the stolen key cannot take the identity in place. What it CAN do is mint a`);
say(`  competing MIGRATION, which needs no key of the predecessor's at all:`);

const eve = new Publisher({
  identity: EVE, title: "Mom's Journal", signer: makeSigner('eve-1'),
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now: () => tick(0),
});
const eveGenesis = { ...eve.identityDocument };
eveGenesis._recovery_sig = sign(eveGenesis, recovery.privateKey, `${HUB}#${recovery.kid}`);

const momClaim = verifyRecoverySignature(declinedGenesis, { pinnedAncestor });
const eveClaim = verifyRecoverySignature(eveGenesis, { pinnedAncestor });

say(`    Mom's claim  ${OWN}  -> co-signature valid: ${momClaim.valid}`);
say(`    Eve's claim  ${EVE}  -> co-signature valid: ${eveClaim.valid}`);
say();
say(`  Both verify against the same recovery key committed in the same pinned ancestor. They`);
say(`  are documents at DIFFERENT URLs, each at seq 1, so:`);
say(`    §5.3.1 does not fire — it compares two observations of ONE document URL at one seq`);
say(`    §5.5 is not reached — §3.4 never routes competing migrations into fork resolution`);
say(`    §4.5's "conflicting chain" clause does not reach it either: the conflict is between`);
say(`         two SUCCESSORS, not between a successor and the original's own chain`);

// The machinery has an answer shape; the text has no route into it.
const asFork = resolveFork([declinedGenesis, eveGenesis], { pinnedAncestor });
say();
say(`  If a consumer DID route them into §5.5 anyway:`);
say(`    resolved: ${asFork.resolved} — "${asFork.reason}"`);
say(`  which is the correct verdict, reached by a rule that does not currently apply.`);

verdict(
  'Sharper than expected, and in a different place than the threat model suggests. Recovery-\n' +
  'key theft is not a takeover — the key cannot sign a chain version. It is a DENIAL: the\n' +
  "thief mints a competing migration, both claims verify, and no rule in §3.4, §4.5, or §5.5\n" +
  "adjudicates. The victim's exit does not fail loudly; it fails as a contest no reader is\n" +
  'told how to settle, which resolves in practice to whichever URL a reader happens to find.\n' +
  '\n' +
  'Fix is small because the verdict already exists: route competing recovery migrations from\n' +
  'one predecessor into §5.5, whose answer — unresolvable, surface it, follow neither without\n' +
  'out-of-band confirmation — is exactly right and already written. §13.2 should then say the\n' +
  'consequence plainly: the recovery key\'s location is the exit, because whoever else holds it\n' +
  'cannot become you but can stop you from becoming yourself somewhere else.',
);

// =========================================================================================
scene(5, 'C1 — where do replies to the old feed go?');
// =========================================================================================

// A reply Dad sent last year points at `{HUB_FEED}#{id}`, inside HIS signed bytes, which
// nobody can re-sign. After the move it arrives at Mom's new inbox. §10.2 step 3 rejects
// anything not relevant to the inbox owner, so the question is how the new host recognizes it.

const inboundTo = `${HUB_FEED}#${BACK_CATALOG[1]}`;
const held = new Set(BACK_CATALOG);          // the ids the new host holds — §10.2 step 5 reads
                                             // this store anyway, for dedup, before verifying

// §3.4 as written: record the predecessor's feed URLs at migration time and match on them.
const recordedPredecessorFeeds = new Set([HUB_FEED]);
const relevantByTable = (to) => recordedPredecessorFeeds.has(to.slice(0, to.lastIndexOf('#'))) ||
                                to.startsWith(OWN_FEED);

// C1: match on the id half, whatever the feed half says.
const relevantById = (to) => held.has(to.slice(to.lastIndexOf('#') + 1));

say(`  inbound reply targets: ${inboundTo}`);
say(`    §3.4 as written (predecessor-URL table): relevant = ${relevantByTable(inboundTo)}`);
say(`    C1 (id half only):                      relevant = ${relevantById(inboundTo)}`);
say();
say(`  Both accept it. The difference is what has to survive the migration:`);
say(`    the table is state the new host must have been TOLD, at the moment §3.4 warns that`);
say(`    "the old identity document may be unreachable afterwards, which is the reason you`);
say(`    migrated." It is a persistence requirement whose failure window is the exit itself.`);
say(`    The id half needs nothing: ids are globally unique and '#'-free (§7.2), and §10.2`);
say(`    step 5 already reads this exact store for dedup before any signature is checked.`);
say();

// The honest cost, which §10.4 already prices.
const strangerProbe = `https://stranger.example/feed.json#${BACK_CATALOG[0]}`;
say(`  Cost: the id half alone widens §10.4's acknowledged existence oracle. A probe naming`);
say(`  a wrong feed but a right id — ${strangerProbe.slice(0, 46)}... —`);
say(`  now reads as relevant: ${relevantById(strangerProbe)} (was ${relevantByTable(strangerProbe)}).`);
say(`  §10.4 already weighs this for 404/409 and calls it safe where ids are unguessable`);
say(`  UUIDs, directing 202-and-discard where they are not. Same disposition, no new hazard.`);

verdict(
  'The bookkeeping is removable. Matching the id half does the same work with no state, and\n' +
  'removes a requirement that has to survive precisely the event during which state is most\n' +
  'likely to be lost. It retires one of predecessor equivalence\'s five sites — the most\n' +
  'fragile one — while §7.5, §9.3 invariant 5, §4.4, and §9 keep the rule for the rest.',
);

// =========================================================================================
say();
say('='.repeat(78));
say('SUMMARY');
say('='.repeat(78));
say(`
  Works as specified
    S1  cooperative migration, and byte-verbatim carriage keeps all ${granHeldHashes.size} held hashes
    S2  recovery migration against a host that declines to participate
    S4  a stolen recovery key cannot sign a chain version and cannot take the identity

  Gaps in the TEXT, not the code
    NEW the \`kid\` on a migration's _recovery_sig must name the PREDECESSOR — unstated, and
        §6.6 read literally forbids it. The self-naming alternative resolves the key from
        the document making the claim, so this is not a style question.
        -> state the form in §3.4 path 3; scope §6.6's author binding to _sig.
    A6  §7.5 picks the successor's manifest but nothing retires the predecessor's CHAIN.
        A consumer keeps a live pin on a chain the departed-from host controls.
        -> one sentence in §3.4, beside predecessor equivalence.
    B1  two valid recovery migrations from one predecessor are unadjudicated. §5.5 has the
        right verdict — "the recovery key is itself in question" — and §3.4 never routes
        competing migrations into it.
        -> route them, and state the consequence in §13.2.
    S2  a ROOT-key-holding hub can always contest an exit by publishing its own successor,
        which §4.5 permits verifiers to honor. Delegated custody removes the capability.
        -> say this at §4.6/§12, where it currently reads as a preference.
    C1  the predecessor-feed-URL table is unnecessary; the id half suffices.
        -> replace the requirement in §3.4/§10.2.

  What none of this touches: the signing construction, canonicalization, or the shape of any
  document. Every finding is a rule about what a CONSUMER does after a migration verifies,
  which is exactly the half §3.4 spends the least text on.
`);
