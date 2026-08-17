// Can canonicality stop naming a location?
//
// `_openfeed.feed_url` sits inside every published item's signed bytes and does three jobs at once:
//
//   (a) PUBLICATION MARKER — its absence means "delivered, not published" (§8, §11.1.1)
//   (b) LOCATOR           — it names the feed whose manifest governs a copy's liveness (§7.5)
//   (c) CANONICALITY      — an item is canonical only in the feed it names (§7.5)
//
// Job (c) is the one that costs. Because it names a *location*, and a location changes when an
// identity moves, §3.4 has to buy it back everywhere:
//
//   §7.5   "One mismatch is not a copy" — the predecessor exception
//   §9     a verifier MUST NOT reject a manifest committing a predecessor's feed URL
//   §3.4   predecessor equivalence, enumerated across six sites
//
// The candidate this measures keeps (a) and (b) exactly as they are and changes only (c):
//
//   > An item is canonical in the feed it was fetched from iff that feed's OWNING IDENTITY is
//   > the identity the item names as its feed owner — `_feed_owner`, defaulting to
//   > `authors[0].url` when absent.
//
// Both halves are already in signed bytes, both are identity URLs, and identity URLs already
// go through predecessor equivalence for key resolution (§6.5 step 5) — so a migrated back
// catalog would be canonical at its new home by a rule the verifier already runs, rather than
// by an exception written for it.
//
// The kill criterion, stated before the measurement: if the clause count does not drop, or if
// preserving the multi-author board (§7.1) costs a rule as long as the one it replaces, keep
// `_openfeed.feed_url` and record why.
//
// Imports src/: the corpus is built by the real Publisher and the URL comparator is the shipped
// one, because a rule that only works against a re-derived normalizer is not a result.

import { Publisher, canonicalBytes, normalizeUrlForCompare, normalizeIdentityUrl, sign } from '../src/index.js';
import crypto from 'node:crypto';

const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`Q${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };
const T0 = 1736899200;

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: T0 - 86400, kid, kty: 'OKP', x }, privateKey };
}

const MOM_OLD = 'https://old.example/~mom/';
const MOM_NEW = 'https://mom.example/';
const DAD = 'https://dad.example/';
const EVE = 'https://eve.example/';
const feedOf = (id) => `${id}feed.json`;
const boardOf = (id) => `${id}board.json`;

// ---------------------------------------------------------------------------------------
// The two rules, as functions. Everything below runs both over the same inputs.
//
// `ctx` is what a reader holds when it classifies an item: the feed URL it actually requested,
// the identity document that owns that feed (already fetched, because verifying any item in it
// needs the key), and the verified-migration relation.
// ---------------------------------------------------------------------------------------

/** Predecessor equivalence over identity URLs — the relation §3.4 already defines. */
function makeEquivalence(pairs) {
  // pairs: [predecessor, successor]
  const up = new Map(pairs.map(([p, s]) => [normalizeIdentityUrl(p), normalizeIdentityUrl(s)]));
  return function equivalent(a, b) {
    const walk = (x) => { const seen = [normalizeIdentityUrl(x)]; let cur = seen[0];
      while (up.has(cur)) { cur = up.get(cur); seen.push(cur); } return seen; };
    return walk(a).includes(normalizeIdentityUrl(b)) || walk(b).includes(normalizeIdentityUrl(a));
  };
}

/** TODAY (§7.5). Compares the item's `_openfeed.feed_url` against the URL the consumer requested. */
function canonicalToday(item, ctx) {
  const declared = item._openfeed?.feed_url ? normalizeUrlForCompare(item._openfeed?.feed_url) : null;
  if (!declared) return { canonical: false, why: 'delivered-only' };
  if (declared === normalizeUrlForCompare(ctx.fetchedFeedUrl)) return { canonical: true, why: 'own' };
  // §7.5's exception, which exists ONLY because the compared value is a location. It needs the
  // set of feed URLs every verified predecessor of this feed's owner ever listed — state the
  // consumer must have recorded before the move (§4.5's recovery pin carries it for this).
  if (ctx.predecessorFeedUrls.some((u) => normalizeUrlForCompare(u) === declared)) {
    return { canonical: true, why: 'predecessor exception (§7.5)' };
  }
  return { canonical: false, why: 'copy' };
}

/** PROPOSED. Compares two identity URLs through the equivalence the verifier already runs. */
function canonicalProposed(item, ctx) {
  if (!item._openfeed?.feed_url) return { canonical: false, why: 'delivered-only' };
  const claimed = item._feed_owner ?? item.authors?.[0]?.url;
  if (typeof claimed !== 'string') return { canonical: false, why: 'no owner named' };
  if (ctx.equivalent(claimed, ctx.feedOwnerIdentity)) return { canonical: true, why: 'owner matches' };
  return { canonical: false, why: 'copy' };
}

const RULES = [['today', canonicalToday], ['proposed', canonicalProposed]];

// ---------------------------------------------------------------------------------------
// A corpus of items, each with the situation it represents.
// ---------------------------------------------------------------------------------------

const momSigner = makeSigner('mom-1');
const dadSigner = makeSigner('dad-1');
const eveSigner = makeSigner('eve-1');

function item(authorId, signer, fields) {
  const doc = {
    id: fields.id,
    authors: [{ url: authorId }],
    _openfeed: { version: 1 },
    content_text: fields.content ?? 'hello',
    date_published: new Date(T0 * 1000).toISOString(),
    ...(fields.feedUrl ? { _openfeed: { feed_url: fields.feedUrl  }} : {}),
    ...(fields.feedOwner ? { _feed_owner: fields.feedOwner } : {}),
  };
  doc._sig = sign(doc, signer.privateKey, `${authorId}#${signer.kid}`);
  return doc;
}

scene(1, 'The ordinary cases — the two rules must agree, or this is over before it starts');

const noMigration = makeEquivalence([]);

const CASES = [
  {
    name: 'own feed, ordinary post',
    item: item(MOM_OLD, momSigner, { id: 'urn:uuid:1', feedUrl: feedOf(MOM_OLD) }),
    ctx: { fetchedFeedUrl: feedOf(MOM_OLD), feedOwnerIdentity: MOM_OLD, predecessorFeedUrls: [], equivalent: noMigration },
    want: true,
  },
  {
    name: "a copy of Mom's item in Eve's feed (injection)",
    item: item(MOM_OLD, momSigner, { id: 'urn:uuid:1', feedUrl: feedOf(MOM_OLD) }),
    ctx: { fetchedFeedUrl: feedOf(EVE), feedOwnerIdentity: EVE, predecessorFeedUrls: [], equivalent: noMigration },
    want: false,
  },
  {
    name: 'delivered-only item (no _feed_url)',
    item: item(DAD, dadSigner, { id: 'urn:uuid:2' }),
    ctx: { fetchedFeedUrl: feedOf(DAD), feedOwnerIdentity: DAD, predecessorFeedUrls: [], equivalent: noMigration },
    want: false,
  },
  {
    name: "Eve re-signs Mom's content as her own (plagiarism, not injection)",
    item: item(EVE, eveSigner, { id: 'urn:uuid:3', feedUrl: feedOf(EVE) }),
    ctx: { fetchedFeedUrl: feedOf(EVE), feedOwnerIdentity: EVE, predecessorFeedUrls: [], equivalent: noMigration },
    want: true,   // canonical AND correctly attributed to Eve; §6.6's stated limit
  },
];

let agree = 0;
for (const c of CASES) {
  const results = RULES.map(([n, fn]) => [n, fn(c.item, c.ctx)]);
  const same = results.every(([, r]) => r.canonical === c.want);
  if (same) agree++;
  say(`  ${same ? 'agree' : 'DIVERGE'}  ${c.name}`);
  for (const [n, r] of results) say(`           ${n.padEnd(9)} canonical=${String(r.canonical).padEnd(5)} (${r.why})`);
}
say();
say(`  ${agree} of ${CASES.length} ordinary cases agree, and the exclusivity property is intact under both:`);
say('  neither rule lets Eve make somebody else\'s item canonical in her own feed, because both');
say('  halves of both comparisons sit inside the author\'s signed bytes.');

// ---------------------------------------------------------------------------------------

scene(2, 'The migration — where today\'s rule needs an exception and the candidate does not');

// Mom moves. §3.4 forbids re-signing the back catalog, so her old items keep the OLD feed URL
// in their signed bytes forever, and are served from the NEW feed.
const backCatalog = item(MOM_OLD, momSigner, { id: 'urn:uuid:old-1', feedUrl: feedOf(MOM_OLD), content: 'published before the move' });
const migrated = makeEquivalence([[MOM_OLD, MOM_NEW]]);

const atNewHome = {
  fetchedFeedUrl: feedOf(MOM_NEW),
  feedOwnerIdentity: MOM_NEW,
  predecessorFeedUrls: [feedOf(MOM_OLD)],   // recorded before the move; §4.5's recovery pin
  equivalent: migrated,
};
// The same read by a consumer that never verified the migration — the safe reading under both.
const unaware = { ...atNewHome, predecessorFeedUrls: [], equivalent: noMigration };

say('  the byte-verbatim back catalog, served at the successor feed:');
for (const [n, fn] of RULES) {
  const r = fn(backCatalog, atNewHome);
  say(`    ${n.padEnd(9)} canonical=${String(r.canonical).padEnd(5)} (${r.why})`);
}
say();
say('  and by a consumer that has NOT verified the migration (must read as a copy under both):');
for (const [n, fn] of RULES) {
  const r = fn(backCatalog, unaware);
  say(`    ${n.padEnd(9)} canonical=${String(r.canonical).padEnd(5)} (${r.why})`);
}
say();
say('  Same verdicts. What differs is what each verdict COST to state:');
say();
say('    today     a named exception (§7.5, "One mismatch is not a copy") plus the state it');
say('              consumes — the set of feed URLs every verified predecessor listed, which a');
say('              consumer can only record BEFORE the move (§4.5). A second carve-out in §9');
say('              stops a verifier rejecting the manifest that commits those same items.');
say('    proposed  nothing. `_feed_owner` is an identity URL and identity URLs already go');
say('              through predecessor equivalence to resolve a signing key (§6.5 step 5), so');
say('              the back catalog is canonical by a comparison the verifier already runs.');

// ---------------------------------------------------------------------------------------

scene(3, 'The multi-author board — the case the candidate must not break (§7.1)');

// Dad contributes to Mom's family board, canonically. Under today's rule he signs the board's
// FEED URL; under the candidate he signs the board owner's IDENTITY URL.
const dadOnBoardToday = item(DAD, dadSigner, { id: 'urn:uuid:b1', feedUrl: boardOf(MOM_NEW) });
const dadOnBoardProposed = item(DAD, dadSigner, { id: 'urn:uuid:b2', feedUrl: boardOf(MOM_NEW), feedOwner: MOM_NEW });
// And Dad's ORDINARY item, which Mom has copied onto her board without asking.
const dadOrdinary = item(DAD, dadSigner, { id: 'urn:uuid:b3', feedUrl: feedOf(DAD) });

const board = {
  fetchedFeedUrl: boardOf(MOM_NEW), feedOwnerIdentity: MOM_NEW,
  predecessorFeedUrls: [], equivalent: migrated,
};

const boardRows = [
  ['Dad contributes canonically', dadOnBoardToday, dadOnBoardProposed, true],
  ['Mom copies Dad\'s own post onto the board', dadOrdinary, dadOrdinary, false],
];
say('  case                                        today      proposed');
for (const [name, a, b, want] of boardRows) {
  const t = canonicalToday(a, board);
  const p = canonicalProposed(b, board);
  const ok = t.canonical === want && p.canonical === want;
  say(`  ${name.padEnd(43)} ${String(t.canonical).padEnd(10)} ${String(p.canonical).padEnd(8)} ${ok ? '' : ' ← DIVERGE'}`);
}
say();
say('  The board survives, and it survives for the right reason: under both rules a contributor');
say('  OPTS IN inside their own signed bytes, and neither the board owner nor anyone on the');
say('  serving path can opt them in. What changes is only which noun they write — a feed URL or');
say('  the board owner\'s identity URL.');
say();
say('  One asymmetry the candidate introduces, and it is a real cost: `_feed_owner` names an');
say('  IDENTITY, and an identity may list several feeds (§3.2.1). So a contributor who writes');
say(`  \`_feed_owner: ${MOM_NEW}\` is canonical in ANY feed Mom owns that commits`);
say('  those bytes, not in one named feed. Today\'s rule pins it to exactly one. Mom cannot forge');
const boardToFeed = canonicalProposed(dadOnBoardProposed, {
  ...board, fetchedFeedUrl: feedOf(MOM_NEW),
});
say(`  the bytes, but she can MOVE them: serving Dad's board item in her primary feed reads as`);
say(`  canonical=${boardToFeed.canonical} under the candidate and as a copy today.`);

// ---------------------------------------------------------------------------------------

scene(4, 'What actually deletes, counted rather than asserted');

// The spec text that exists *because* canonicality compares a location. Counted by locating
// each passage in the shipped spec rather than from memory.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
const specPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'open-feed-spec.md');
const spec = fs.readFileSync(specPath, 'utf8');

const PASSAGES = [
  ['§7.5 the predecessor exception',
    '**One mismatch is not a copy:**', 'which is the safe reading.'],
  ['§9 the manifest feed_url carve-out',
    'and a verifier MUST NOT reject a manifest for committing one that names a **predecessor**',
    'the only place they can be committed'],
];
let deleted = 0;
say('  passages whose existence is owed to comparing a location:');
for (const [name, from, to] of PASSAGES) {
  const i = spec.indexOf(from);
  const j = i < 0 ? -1 : spec.indexOf(to, i);
  const chars = i < 0 || j < 0 ? 0 : (j + to.length) - i;
  const words = chars ? spec.slice(i, j + to.length).split(/\s+/).length : 0;
  deleted += words;
  say(`    ${name.padEnd(40)} ${String(words).padStart(4)} words ${chars ? '' : '  (NOT FOUND — check the anchors)'}`);
}

// What does NOT delete, which is the honest half.
const SURVIVES = [
  'predecessor equivalence itself (§3.4) — still needed for keys, for `_openfeed.rel` targets, for inbox dedup',
  '§4.5\'s recovery pin still records feed URLs, because a copy\'s liveness lookup (job (b)) still needs them',
  '§10.2 / §10.3\'s id-half matching — those key on item ids, never on `_openfeed.feed_url`',
  '§9.3 invariant 5 — about manifest chains, not about item bytes',
];
say();
say(`  ~${deleted} words of spec delete. What does NOT:`);
for (const s of SURVIVES) say(`    · ${s}`);
say();
say('  And the candidate ADDS: one extension field (`_feed_owner`), its default rule, and a');
say('  sentence saying an identity\'s feeds are interchangeable for canonicality — which is the');
say('  new looseness Q3 measured.');

// ---------------------------------------------------------------------------------------

say();
say('='.repeat(78));
const claims = [
  ['the two rules agree on every ordinary case', agree === CASES.length],
  ['both keep the migrated back catalog canonical for a consumer that verified the move',
    canonicalToday(backCatalog, atNewHome).canonical && canonicalProposed(backCatalog, atNewHome).canonical],
  ['both read it as a copy for a consumer that did not',
    !canonicalToday(backCatalog, unaware).canonical && !canonicalProposed(backCatalog, unaware).canonical],
  ['both keep the multi-author board, by contributor opt-in',
    canonicalToday(dadOnBoardToday, board).canonical && canonicalProposed(dadOnBoardProposed, board).canonical],
  ['both refuse an un-opted-in item copied onto that board',
    !canonicalToday(dadOrdinary, board).canonical && !canonicalProposed(dadOrdinary, board).canonical],
  ['the spec passages this would delete were located, not assumed', deleted > 0],
];
const failed = claims.filter(([, ok]) => !ok);
if (failed.length) {
  for (const [what] of failed) console.error(`FAILED: ${what}`);
  process.exit(1);
}

verdict(
  'KEEP `_openfeed.feed_url`. The candidate works, and it is not worth the churn.\n'
  + '\n'
  + `What it buys is real but small: ~${deleted} words of exception text, and the pleasing property that\n`
  + 'a migrated back catalog is canonical by a comparison the verifier already runs rather than by\n'
  + 'a rule written for it. What it costs is the reason to decline:\n'
  + '\n'
  + '1. PRECISION. `_openfeed.feed_url` names one feed; `_feed_owner` names an identity that may own\n'
  + '   twenty (§13.4). Under the candidate a contributor cannot say WHICH of an owner\'s feeds\n'
  + '   their item is canonical in, so a board owner can move a contributor\'s item into their\n'
  + '   primary feed and it stays canonical — measured in Q3. Today that is a copy. Recovering\n'
  + '   the precision means naming the feed again, which is where we started.\n'
  + '2. IT DOES NOT DELETE PREDECESSOR EQUIVALENCE, only two of its application sites. The\n'
  + '   relation still has to exist and still has to be recorded before a move, because job (b)\n'
  + '   — routing a copy to the manifest that governs it — still compares feed URLs.\n'
  + '3. IT ADDS A FIELD AND A DEFAULT. `_feed_owner ?? authors[0].url` is a second rule about\n'
  + '   what an absent field means, in a document where the ONE such rule that exists already\n'
  + '   (an absent `_openfeed.feed_url` means delivered-not-published, §11.1.1) is load-bearing enough to\n'
  + '   need its own MUST. Two fields whose absence means different things is exactly the\n'
  + '   equivocation §1 principle 4 is about.\n'
  + '\n'
  + 'The finding worth keeping is not the candidate — it is that the exception text is the price of\n'
  + 'PRECISION, not an accident. §7.5 compares a location because a location is what a manifest\n'
  + 'lookup needs, and every alternative either loses that or re-derives it.',
);
say();
say('ALL CLAIMS HOLD');
