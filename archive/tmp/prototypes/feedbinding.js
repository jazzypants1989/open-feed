// Gate for tmp/prototypes/feedbinding.md — `_feed_url` canonicality vs the rejected `_feed_owner`.
import { sign, normalizeUrlForCompare, normalizeIdentityUrl } from '../../src/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const T0 = 1736899200;
const MOM_OLD = 'https://old.example/~mom/';
const MOM_NEW = 'https://mom.example/';
const DAD = 'https://dad.example/';
const EVE = 'https://eve.example/';
const feedOf = (id) => `${id}feed.json`;
const boardOf = (id) => `${id}board.json`;

function makeSigner(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return { kid, jwk: { crv: 'Ed25519', iat: T0 - 86400, kid, kty: 'OKP', x }, privateKey };
}

// Predecessor equivalence over identity URLs — the relation §3.4 defines.
function makeEquivalence(pairs) {
  const up = new Map(pairs.map(([p, s]) => [normalizeIdentityUrl(p), normalizeIdentityUrl(s)]));
  return function equivalent(a, b) {
    const walk = (x) => {
      const seen = [normalizeIdentityUrl(x)];
      let cur = seen[0];
      while (up.has(cur)) { cur = up.get(cur); seen.push(cur); }
      return seen;
    };
    return walk(a).includes(normalizeIdentityUrl(b)) || walk(b).includes(normalizeIdentityUrl(a));
  };
}

// TODAY (§7.5): compare the item's signed `_openfeed.feed_url` against the URL actually fetched.
function canonicalToday(item, ctx) {
  const declared = item._openfeed?.feed_url ? normalizeUrlForCompare(item._openfeed.feed_url) : null;
  if (!declared) return false;
  if (declared === normalizeUrlForCompare(ctx.fetchedFeedUrl)) return true;
  return ctx.predecessorFeedUrls.some((u) => normalizeUrlForCompare(u) === declared);
}

// REJECTED: compare `_feed_owner ?? authors[0].url` against the fetched feed's owning identity.
function canonicalProposed(item, ctx) {
  if (!item._openfeed?.feed_url) return false;
  const claimed = item._feed_owner ?? item.authors?.[0]?.url;
  if (typeof claimed !== 'string') return false;
  return ctx.equivalent(claimed, ctx.feedOwnerIdentity);
}

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
    ...(fields.feedUrl ? { _openfeed: { feed_url: fields.feedUrl } } : {}),
    ...(fields.feedOwner ? { _feed_owner: fields.feedOwner } : {}),
  };
  doc._sig = sign(doc, signer.privateKey, `${authorId}#${signer.kid}`, { kind: 'identity' });
  return doc;
}

// Ordinary cases — the two rules must agree on all of them.
const noMigration = makeEquivalence([]);
const CASES = [
  ['own feed, ordinary post',
    item(MOM_OLD, momSigner, { id: 'urn:uuid:1', feedUrl: feedOf(MOM_OLD) }),
    { fetchedFeedUrl: feedOf(MOM_OLD), feedOwnerIdentity: MOM_OLD, predecessorFeedUrls: [], equivalent: noMigration },
    true],
  ["a copy of Mom's item in Eve's feed (injection)",
    item(MOM_OLD, momSigner, { id: 'urn:uuid:1', feedUrl: feedOf(MOM_OLD) }),
    { fetchedFeedUrl: feedOf(EVE), feedOwnerIdentity: EVE, predecessorFeedUrls: [], equivalent: noMigration },
    false],
  ['delivered-only item (no _openfeed.feed_url)',
    item(DAD, dadSigner, { id: 'urn:uuid:2' }),
    { fetchedFeedUrl: feedOf(DAD), feedOwnerIdentity: DAD, predecessorFeedUrls: [], equivalent: noMigration },
    false],
  ["Eve re-signs Mom's content as her own (plagiarism, not injection — §6.6's stated limit)",
    item(EVE, eveSigner, { id: 'urn:uuid:3', feedUrl: feedOf(EVE) }),
    { fetchedFeedUrl: feedOf(EVE), feedOwnerIdentity: EVE, predecessorFeedUrls: [], equivalent: noMigration },
    true],
];
const ordinaryAgree = CASES.every(([, doc, ctx, want]) =>
  canonicalToday(doc, ctx) === want && canonicalProposed(doc, ctx) === want);

// Migration: the byte-verbatim back catalog served at the successor feed (§3.4, §7.5).
const backCatalog = item(MOM_OLD, momSigner, { id: 'urn:uuid:old-1', feedUrl: feedOf(MOM_OLD), content: 'published before the move' });
const migrated = makeEquivalence([[MOM_OLD, MOM_NEW]]);
const atNewHome = {
  fetchedFeedUrl: feedOf(MOM_NEW), feedOwnerIdentity: MOM_NEW,
  predecessorFeedUrls: [feedOf(MOM_OLD)], equivalent: migrated,
};
const unaware = { ...atNewHome, predecessorFeedUrls: [], equivalent: noMigration };

// Multi-author board (§7.1): Dad opts in inside his own signed bytes, under each rule's noun.
const dadOnBoardToday = item(DAD, dadSigner, { id: 'urn:uuid:b1', feedUrl: boardOf(MOM_NEW) });
const dadOnBoardProposed = item(DAD, dadSigner, { id: 'urn:uuid:b2', feedUrl: boardOf(MOM_NEW), feedOwner: MOM_NEW });
const dadOrdinary = item(DAD, dadSigner, { id: 'urn:uuid:b3', feedUrl: feedOf(DAD) });
const board = { fetchedFeedUrl: boardOf(MOM_NEW), feedOwnerIdentity: MOM_NEW, predecessorFeedUrls: [], equivalent: migrated };

// Q3 attack: Mom serves Dad's board item in her PRIMARY feed — she owns both, so owner matches.
const momPrimary = { ...board, fetchedFeedUrl: feedOf(MOM_NEW) };

// The §7.5 and §9 passages the ~106-word deletion figure counted; fail if they move.
const specPath = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', 'open-feed-spec.md');
const spec = fs.readFileSync(specPath, 'utf8');
const PASSAGES = [
  ['**One mismatch is not a copy:**', 'which is the safe reading.'],
  ['and a verifier MUST NOT reject a manifest for committing one that names a **predecessor**',
    'the only place they can be committed'],
];
let deletedWords = 0;
let passagesLocated = true;
for (const [from, to] of PASSAGES) {
  const i = spec.indexOf(from);
  const j = i < 0 ? -1 : spec.indexOf(to, i);
  if (i < 0 || j < 0) { passagesLocated = false; continue; }
  deletedWords += spec.slice(i, j + to.length).split(/\s+/).length;
}

const gate = [
  ['the two rules agree on every ordinary case', ordinaryAgree],
  ['both keep the migrated back catalog canonical for a consumer that verified the move',
    canonicalToday(backCatalog, atNewHome) && canonicalProposed(backCatalog, atNewHome)],
  ['both read it as a copy for a consumer that did not',
    !canonicalToday(backCatalog, unaware) && !canonicalProposed(backCatalog, unaware)],
  ['both keep the multi-author board, by contributor opt-in',
    canonicalToday(dadOnBoardToday, board) && canonicalProposed(dadOnBoardProposed, board)],
  ['both refuse an un-opted-in item copied onto that board',
    !canonicalToday(dadOrdinary, board) && !canonicalProposed(dadOrdinary, board)],
  ["Q3: the moved board item stays canonical under `_feed_owner` (the flaw) and is a copy under `_feed_url`",
    canonicalProposed(dadOnBoardProposed, momPrimary) === true
    && canonicalToday(dadOnBoardToday, momPrimary) === false],
  ['the §7.5 and §9 exception passages sit where the word count located them',
    passagesLocated && deletedWords > 0],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log(`feedbinding: all claims hold (exception passages: ~${deletedWords} words)`);
