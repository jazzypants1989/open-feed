// The export bundle (§14): is it actually an exit, or a backup with an exit's vocabulary?
//
// §14 sets its own bar and it is a high one — "on demand, without operator approval,"
// "byte-verbatim," "includes received items," "includes the photos" — and then says the thing
// worth testing: "An export mechanism a hostile operator can withhold, degrade, or serve
// incomplete is not an exit; it is a courtesy." §13.2 makes the bundle one of the three legs
// exit stands on, "real only if all three hold at once."
//
// So the question is not whether a bundle can be produced. It is whether a bundle, ALONE, on a
// machine with no network and no help from the host that made it, re-establishes everything its
// owner had. Four scenes:
//
//   S1  produce and verify — signatures, both chains, items against manifests, no network
//   S2  the round trip. §14's byte-verbatim rule is easy to state and easy to break: a bundle
//       is JSON containing JSON, and everything between "serialize" and "parse" is where
//       hashes die. Includes other people's bytes carrying fields this exporter never knew.
//   S3  the migrated identity from tmp/migration-prototype.js. §14 says restore "exactly as it
//       would verify live documents" — so what does a successor's bundle need that it has?
//   S4  the photos: archive container vs the URL-only fallback §14 calls degraded, measured.
//
// Imports src/ for the same reason the migration prototype does: the verification this asks
// about is verification that already exists, and re-deriving it would test a second verifier.

import crypto from 'node:crypto';

import {
  Publisher,
  PinStore,
  walkToPin,
  identityChainPolicy,
  manifestChainPolicy,
  verifyRecoverySignature,
  assertHistoryInvariants,
  reconcileFeed,
  derivedVersionUrl,
  documentHash,
  canonicalBytes,
  sign,
  verifyDocument,
} from '../../src/index.js';

let clock = 1736899200;
const tick = (s = 3600) => (clock += s);
const now = () => clock;
const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`S${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function makeSigner(kid, { use } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat: 1736899200 - 86400, kid, kty: 'OKP', x };
  if (use) jwk.use = use;
  return { kid, jwk, privateKey };
}

// ---- the identity being exported ---------------------------------------------------------

const HUB = 'https://mom.hub.example/';
const STRANGER = 'https://gran.example/';

const hubSigner = makeSigner('hub-1');
const recovery = makeSigner('recovery-1', { use: 'recovery' });
const mom = new Publisher({
  identity: HUB, title: "Mom's Journal", signer: hubSigner,
  profile: { name: 'Mom' }, recoveryKeys: [recovery.jwk], now,
});

// A photo, so §14's attachment rules have something to carry. `_openfeed.sha256` is over the BYTES
// (§7.4) and is inside the signed item, which is what lets the archive container name files
// by hash and still be self-verifying.
const photoBytes = Buffer.from('=== not really a JPEG, but it hashes like one ==='.repeat(400));
const photoHash = crypto.createHash('sha256').update(photoBytes).digest('base64url');
const PHOTO_URL = `${HUB}2025/12/07/cookies.jpg`;

tick();
mom.publishItem({
  id: 'urn:uuid:0001-cookies',
  content_text: 'The grandkids came over and we made cookies.',
  // An extension field with no column anywhere — §7.2's preserve-unknown-members rule is a
  // signature dependency, and a bundle is where a schema-shaped exporter drops it.
  _ai_assisted: true,
  attachments: [{ url: PHOTO_URL, mime_type: 'image/jpeg', _openfeed: { sha256: photoHash  }}],
});
mom.advanceManifest({ updated: tick() });

tick();
mom.publishItem({ id: 'urn:uuid:0002-garden', content_text: 'Tomatoes finally in.' });
tick();
mom.publishItem({ id: 'urn:uuid:0003-typo', content_text: 'Wrong on purpose.' });
mom.tombstone('urn:uuid:0003-typo', { at: tick() });
mom.advanceManifest({ updated: tick() });
mom.advanceIdentity({ bio: 'Grandmother, gardener, cat enthusiast.' }, { updated: tick() });

// Other people's bytes. §14: "`received` items MUST be included verbatim as received. They are
// other people's signed bytes; the exporter is a custodian, not an author." Gran's reply
// carries fields Mom's hub has never heard of, which is the case that decides whether a
// column-shaped exporter can round-trip at all.
const granSigner = makeSigner('gran-1');
const granIdentity = (() => {
  const doc = { url: STRANGER, keys: [granSigner.jwk], name: 'Gran', seq: 1, updated: 1736899200 };
  doc._sig = sign(doc, granSigner.privateKey, `${STRANGER}#gran-1`, { kind: 'identity' });
  return doc;
})();
const receivedReply = (() => {
  const item = {
    id: 'urn:uuid:aaaa-reply',
    authors: [{ url: STRANGER }],
    content_text: 'Lovely!',
    date_published: '2025-02-15T12:00:00Z',
    _openfeed: { version: 1, rel: [{ type: 'reply', to: `${HUB}feed.json#urn:uuid:0001-cookies`, _mood: 'warm' }] },
    _gran_client: { version: '3.1', theme: 'large-print' },
  };
  item._sig = sign(item, granSigner.privateKey, `${STRANGER}#gran-1`, { kind: 'item' });
  return item;               // no _openfeed: { feed_url: delivered }, not published (§11.1.1)
})();

// Mom's own delivered-only item — a private note to Gran that reached no feed.
const deliveredNote = (() => {
  const item = {
    id: 'urn:uuid:bbbb-note',
    authors: [{ url: HUB }],
    content_text: 'Call me when you get a chance.',
    date_published: '2025-02-16T09:00:00Z',
    _openfeed: { version: 1, rel: [{ type: 'mention', to: STRANGER }] },
  };
  item._sig = sign(item, hubSigner.privateKey, `${HUB}#hub-1`, { kind: 'item' });
  return item;
})();

// ---- the exporter ------------------------------------------------------------------------

function exportBundle(publisher, { delivered = [], received = [], unpublished = [], attachments = [] } = {}) {
  return {
    version: 'openfeed-export/1',
    url: publisher.identity,
    exported_at: now(),
    identity: {
      current: publisher.identityDocument,
      history: publisher.identityVersions.slice(0, -1),
    },
    feeds: [{
      feed: publisher.feed,
      manifest: publisher.manifest,
      manifest_history: publisher.manifestVersions.slice(0, -1),
    }],
    delivered,
    received,
    unpublished,
    attachments,
  };
}

// ---- the restorer ------------------------------------------------------------------------
// §14: "A consumer restores from a bundle by verifying it exactly as it would verify live
// documents ... Nothing about verification changes because the bytes arrived in a file."
// Taken literally: the same walkToPin, the same policies, with the bundle standing in for the
// network. If that is true, this function needs no bundle-specific verification logic at all.

async function restore(bundle, { pinnedAncestor = null } = {}) {
  const report = { identity: null, chains: [], items: null, notes: [] };

  const identityUrl = `${bundle.url}openfeed.json`;
  const identityVersions = [...bundle.identity.history, bundle.identity.current];
  const fromBundle = (versions) => async (_url, seq) => versions.find((v) => v.seq === seq);

  // Both chains, walked from genesis rather than from a pin: a restorer holds no pin, which is
  // §5.3's first-contact case, and the bundle is the only history there is.
  const pins = new PinStore({ now });
  await walkToPin({
    url: identityUrl, tip: bundle.identity.current, pin: { seq: 1, hash: documentHash(identityVersions[0]) },
    fetchVersion: fromBundle(identityVersions), policy: identityChainPolicy, pins,
  });
  report.identity = bundle.identity.current;
  report.chains.push([identityUrl, identityVersions.length]);

  for (const entry of bundle.feeds) {
    const manifestUrl = `${bundle.url}manifest.json`;
    const manifestVersions = [...entry.manifest_history, entry.manifest];
    await walkToPin({
      url: manifestUrl, tip: entry.manifest, pin: { seq: 1, hash: documentHash(manifestVersions[0]) },
      fetchVersion: fromBundle(manifestVersions), policy: manifestChainPolicy(report.identity), pins,
    });
    assertHistoryInvariants(manifestVersions, { url: manifestUrl });
    report.chains.push([manifestUrl, manifestVersions.length]);

    // §9.3: every served item against its manifest entry, hash included. `partial: false` says
    // this is the whole feed, which for a bundle it is by construction — the one context where
    // the withholding verdict is unambiguous.
    report.items = reconcileFeed(entry.manifest, entry.feed.items, {
      url: manifestUrl, now: now(), partial: false,
    });
  }

  // Other people's bytes verify against their own identities, which a bundle does not carry.
  for (const item of bundle.received) {
    report.notes.push(['received', item.id, 'signature checkable only against its author\'s live identity']);
  }
  if (pinnedAncestor) {
    const r = verifyRecoverySignature(bundle.identity.current, { pinnedAncestor });
    report.notes.push(['migration', bundle.identity.current.predecessor ?? '(none)', r.valid ? 'verified' : r.reason]);
  }
  return report;
}

// =========================================================================================
scene(1, 'Produce and verify — no network, no help from the host');
// =========================================================================================

const drafts = [
  { id: 'draft-1', content_text: 'Half-finished thought about the hospital appointment.', _draft: true },
];
const bundle = exportBundle(mom, {
  delivered: [deliveredNote],
  received: [receivedReply],
  unpublished: drafts,
  attachments: [{ url: PHOTO_URL, _openfeed: { sha256: photoHash }, bytes: photoBytes.toString('base64url') }],
});

const report = await restore(bundle);
const states = [...report.items.states.values()];
const byState = states.reduce((a, s) => ((a[s.state] = (a[s.state] ?? 0) + 1), a), {});

say(`  bundle: ${kb(Buffer.byteLength(JSON.stringify(bundle)))} of JSON`);
say(`  chains walked from genesis, entirely out of the bundle:`);
for (const [url, n] of report.chains) say(`    ${url}  ${n} versions`);
say(`  items reconciled against their manifest entry: ${JSON.stringify(byState)}`);
say(`  invariant violations: ${report.items.violations.length}`);
say(`  delivered-only items carried: ${bundle.delivered.length}   received: ${bundle.received.length}`);
say(`  unpublished (unsigned, outside the verifiable core): ${bundle.unpublished.length}`);

verdict(
  '§14\'s central claim holds literally: `restore` above contains no bundle-specific\n' +
  'verification. The same walkToPin, the same policies, the same reconcileFeed — only the\n' +
  'fetch function changed, from a socket to an array. That is a real property and a good\n' +
  'argument for the bundle being one document rather than a format.',
);

// =========================================================================================
scene(2, 'The round trip — where byte-verbatim actually dies');
// =========================================================================================

// A bundle that never leaves memory proves nothing. Serialize it, parse it back, and re-run
// the same verification: this is the step §14 is warning about when it says "a bundle whose
// contents have been re-serialized is worthless, because the hashes will not chain."

const onDisk = Buffer.from(JSON.stringify(bundle), 'utf8');
const reloaded = JSON.parse(onDisk.toString('utf8'));
const afterTrip = await restore(reloaded);

say(`  written and read back: ${kb(onDisk.length)}`);
say(`  chains still verify: ${afterTrip.chains.map(([, n]) => n).join(', ')} versions`);
say(`  violations after the trip: ${afterTrip.items.violations.length}`);

// The specific things a schema-shaped exporter loses, checked one at a time.
const tripped = reloaded.feeds[0].feed.items.find((i) => i.id === 'urn:uuid:0001-cookies');
const original = mom.items.get('urn:uuid:0001-cookies');
say();
say(`  survived the trip, and each is a signature dependency (§7.2):`);
say(`    _ai_assisted (extension field, no column anywhere):     ${tripped._ai_assisted}`);
say(`    attachment _sha256 (inside the signed bytes, §7.4):     ${tripped.attachments[0]._openfeed?.sha256 === photoHash}`);
say(`    item bytes identical to what was signed:                ${canonicalBytes(tripped).equals(canonicalBytes(original))}`);
const grn = reloaded.received[0];
say(`    a stranger's unknown members (_mood, _gran_client):     ` +
    `${grn._openfeed?.rel[0]._mood === 'warm' && grn._gran_client?.theme === 'large-print'}`);
say(`    that stranger's item still verifies against their key:  ` +
    `${(() => { try { verifyDocument(grn, { identityDocument: granIdentity }); return true; } catch { return false; } })()}`);

// Now the failure mode, made explicit rather than described.
const decomposed = {                      // what a columns-first exporter reconstructs
  id: original.id, authors: original.authors, content_text: original.content_text,
  date_published: original.date_published, _openfeed: { feed_url: original._openfeed?.feed_url },
  _openfeed: { version: original._openfeed?.version, attachments: original.attachments, _sig: original._sig },
};
const stillHashes = documentHash(decomposed) === documentHash(original);
say();
say(`  and the failure: an item reconstructed from columns, dropping only the one field this`);
say(`  schema has no place for (_ai_assisted):`);
say(`    hashes to its manifest entry: ${stillHashes}`);
say(`    signature verifies:           ` +
    `${(() => { try { verifyDocument(decomposed, { identityDocument: mom.identityDocument }); return true; } catch { return false; } })()}`);
say(`  One dropped field, and the item is neither committed nor authored. Nothing warns you:`);
say(`  the JSON is well-formed and every other field is right.`);

verdict(
  'JSON round-tripping is safe — canonicalization is a function of the parsed value, so\n' +
  'key order and whitespace cannot hurt you. What kills a bundle is DECOMPOSITION, and the\n' +
  'blast radius is one unknown field. DISTRIBUTION-MODEL already says "store the bytes, not\n' +
  'just the fields"; this is the measurement behind it, and the received-item case is the\n' +
  'unanswerable one — those fields belong to a schema the exporter will never have.',
);

// =========================================================================================
scene(3, 'The migrated identity — what a successor\'s bundle cannot prove');
// =========================================================================================

// Mom exits to her own domain, exactly as tmp/migration-prototype.js models it: new identity
// at a URL she controls, `predecessor` set, recovery co-signed, back catalog byte-verbatim.

const OWN = 'https://mom.example/';
const ownSigner = makeSigner('own-1');
const own = new Publisher({
  identity: OWN, title: "Mom's Journal", signer: ownSigner,
  profile: { name: 'Mom', predecessor: HUB }, recoveryKeys: [recovery.jwk], now: () => tick(0),
});
for (const [id, item] of mom.items) own.items.set(id, item);
own.advanceManifest({ updated: tick() });
// §6.3: `_sig` covers `_recovery_sig`, so the co-signature goes on first and the version is
// re-signed over it. `coSignIdentity` replaces the tip, which is the same thing this used to
// do by hand and is now the publisher's job.
const migrated = own.coSignIdentity(recovery, { kidIdentity: HUB });

const exitBundle = exportBundle(own, {
  delivered: [deliveredNote], received: [receivedReply], unpublished: drafts,
  attachments: [{ url: PHOTO_URL, _openfeed: { sha256: photoHash }, bytes: photoBytes.toString('base64url') }],
});

say(`  the successor's bundle carries:`);
say(`    identity chain of ${OWN}: ${[...exitBundle.identity.history, exitBundle.identity.current].length} version(s), back to ITS genesis`);
say(`    manifest chain of ${OWN}: ${[...exitBundle.feeds[0].manifest_history, exitBundle.feeds[0].manifest].length} version(s)`);
say(`    back catalog, byte-verbatim, still signing _feed_url = ${own.items.get('urn:uuid:0001-cookies')._openfeed?.feed_url}`);
say();
say(`  the genesis carries predecessor -> ${exitBundle.identity.current.predecessor}`);
say(`  and a _recovery_sig. Verifying it needs the recovery key committed in a PINNED ANCESTOR`);
say(`  of the predecessor (§4.5) — a version of ${HUB}openfeed.json.`);

const withoutAncestor = verifyRecoverySignature(exitBundle.identity.current, {
  pinnedAncestor: { url: OWN, seq: 1, keys: exitBundle.identity.current.keys },
});
const withAncestor = verifyRecoverySignature(exitBundle.identity.current, {
  pinnedAncestor: mom.identityDocument,
});

say();
say(`    verified against what the bundle contains (the successor's own keys): ` +
    `${withoutAncestor.valid} — ${withoutAncestor.reason}`);
say(`    verified against the predecessor's chain (NOT in the bundle):         ${withAncestor.valid}`);
say();
say(`  So a restorer holding only this bundle can verify every signature, both chains, and`);
say(`  every item — and CANNOT verify the one claim the bundle exists to support. §14 says`);
say(`  restore "exactly as it would verify live documents", but a live verifier reaches the`);
say(`  predecessor over the network. In the exit case that host is the one being left.`);
say();
say(`  Note the shape: the successor listing the recovery key in its own document proves`);
say(`  nothing (that is the self-blessing §4.2 rules out). What is missing is the PREDECESSOR'S`);
say(`  signed, chained version that committed the key — bytes the departing member had a pin`);
say(`  of all along, and which no rule tells the host to hand over.`);

verdict(
  'A gap, and it sits precisely where §13.2 says the three legs must hold at once. §3.4 moves\n' +
  'the identity, §14 moves the content, and neither moves the EVIDENCE that links them. A\n' +
  "successor's bundle is self-consistent and cannot prove it is a successor.\n" +
  '\n' +
  "Fix is small and the bytes already exist: §14's `identity` slot gains the predecessor's\n" +
  'retained versions byte-verbatim — at minimum the ancestor committing the recovery key,\n' +
  'ideally the chain back to the pin. A departing member is entitled to them under §14\'s own\n' +
  '"complete copy" language; nothing currently says so, and the host has every reason not to\n' +
  'volunteer them. Alternatively the successor may carry them itself, but that is a new\n' +
  'document — the bundle slot costs nothing and reuses retention that already exists (§5.4).',
);

// =========================================================================================
scene(4, 'The photos — archive container vs the degraded fallback');
// =========================================================================================

// §14: attachments SHOULD be inlined; where one JSON document makes that impractical the
// bundle MAY be an archive container whose entries are named by `_openfeed.sha256`; and only where
// neither is possible may it fall back to url + hash alone — "a degraded export rather than
// an equivalent one ... An export that omits the photos has not exported a family archive."

const PHOTOS = 2400;                       // a decade of family photographs
const AVG = 2.4 * 1024 * 1024;
const inlineBytes = PHOTOS * AVG * (4 / 3); // base64 inflates by 4/3
const containerBytes = PHOTOS * AVG;
const jsonOnly = Buffer.byteLength(JSON.stringify({ ...bundle, attachments: bundle.attachments.map(({ bytes, ...r }) => r) }));

say(`  ${PHOTOS} photos at ${(AVG / 1024 / 1024).toFixed(1)} MB:`);
say(`    inlined base64 in one JSON document: ${(inlineBytes / 1024 ** 3).toFixed(2)} GB, and it must be parsed as one value`);
say(`    archive container (§14):             ${(containerBytes / 1024 ** 3).toFixed(2)} GB, streamable, entries named by _sha256`);
say(`    url + _sha256 only:                  ${kb(jsonOnly)} — and 0 photos`);
say();
say(`  the container stays self-verifying with no extra machinery, because the name of each`);
say(`  file is the hash inside the signed item that references it:`);
const entryName = bundle.attachments[0]._openfeed?.sha256;
const recomputed = crypto.createHash('sha256').update(photoBytes).digest('base64url');
say(`    archive entry:            ${entryName}`);
say(`    hash of its bytes:        ${recomputed}`);
say(`    named by the signed item: ${own.items.get('urn:uuid:0001-cookies').attachments[0]._openfeed?.sha256 === recomputed}`);
say();
say(`  What the degraded form actually degrades to: every \`url\` points back at ${HUB},`);
say(`  the host being left. The fallback is not "smaller export" — it is an export whose`);
say(`  content is hostage to the party the export exists to escape. §14 says this; it is`);
say(`  worth seeing that the JSON still looks complete and verifies clean without them.`);

verdict(
  'The archive container is the right default rather than the exception §14 frames it as:\n' +
  'inlining costs 33% inflation AND forces a multi-GB single JSON parse, for no gain. §14\n' +
  'orders them SHOULD-inline / MAY-container, which points a naive implementer at the worse\n' +
  'one for any deployment with photographs — i.e. the deployment §14 was written for. Worth\n' +
  'inverting: container is the ordinary form, inlining the special case for small bundles.',
);

// =========================================================================================
say();
say('='.repeat(78));
say('SUMMARY');
say('='.repeat(78));

// ---- gate ---------------------------------------------------------------------------------
// This file had no assertion gate, so `check-prototypes.js` was only ever proving it did not
// crash — and its two findings sat printed as open long after §14 absorbed them. A prototype
// is evidence; evidence nobody re-runs is a claim.
{
  const claims = [
    ['S1 a bundle verifies with no bundle-specific verifier and no network', report.items.violations.length === 0],
    ['S1 both chains walk from genesis out of the bundle alone', report.chains.length === 2],
    ['S2 the bundle survives a serialize/parse round trip byte-verbatim', afterTrip.items.violations.length === 0],
    ['S3 a successor\'s own keys cannot verify its own recovery co-signature', withoutAncestor.valid === false],
    ['S3 the predecessor\'s retained chain can', withAncestor.valid === true],
  ];
  const broken = claims.filter(([, ok]) => !ok);
  if (broken.length) {
    say();
    say('FAIL — these claims no longer hold:');
    for (const [label] of broken) say(`  ${label}`);
    say('Either the prototype is stale or the rule it supports is. Both are findings.');
    process.exit(1);
  }
}

say(`
  Holds
    S1  §14's "verification does not change" is literally true — the restorer needed no
        bundle-specific logic, only a different fetch function
    S2  JSON round-tripping is safe; decomposition is what kills a bundle, and one unknown
        field is enough. Other people's received bytes are the unrecoverable case
    S4  the archive container is self-verifying with nothing added, because entries are
        named by the hash the signed item already carries

  Gaps
    E1  a MIGRATED identity's bundle cannot prove its own migration. It carries the
        successor's chains back to the successor's genesis, and the recovery co-signature
        resolves against the PREDECESSOR's chain, which no slot holds.
        -> §14's \`identity\` gains the predecessor's retained versions, byte-verbatim.
           This is the seam between §3.4 and §14 that §13.2 assumes is closed.
    E2  §14 orders the attachment forms SHOULD-inline / MAY-container, steering implementers
        toward 33% inflation and a multi-GB single parse.
        -> invert: the container is the ordinary form.

  Both are about the bundle as an EXIT rather than as a backup. As a backup it is already
  correct; the two gaps only bite when the host is not helping, which is the case §14 says
  sets its requirements.
`);
