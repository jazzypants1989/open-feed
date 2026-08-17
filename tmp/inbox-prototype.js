// The inbox (§10): is the pipeline's ORDER the security property it claims to be, and does
// dedup survive the things §3.4 does to an author?
//
// §10.2 is unusual in this specification: it is a numbered list whose numbering is normative.
// "Cheap local checks run **before** any outbound fetch; the sender is unauthenticated until
// step 7." §10.3 adds a second ordering rule in the opposite direction — the store is READ at
// step 5 and MUST NOT be WRITTEN until step 8. Both are invisible in the output of a correct
// implementation and invisible in the output of a wrong one, which is the argument for
// measuring rather than reading.
//
//   S1  the happy path, with every outbound fetch counted and placed
//   S2  §10.3's write-before-verify attack, run both ways
//   S3  relevance: C1's id-half match, and §8.1's root entry
//   S4  dedup across a migration — the finding this prototype was not looking for
//   S5  §10.4's existence oracle, priced
//
// The outbound fetch is stubbed to a counter rather than driven through src/fetch.js. That is
// deliberate: §13.5's discipline (HTTPS, redirects, address filtering) is already tested in
// test/fetch.test.js, and what is untested is WHEN the fetch happens. A counter answers that
// and a socket obscures it.

import crypto from 'node:crypto';

import { sign, verifyDocument, normalizeIdentityUrl, parseIJSON } from '../src/index.js';

const say = (s = '') => console.log(s);
const scene = (n, t) => { say(); say('='.repeat(78)); say(`S${n}. ${t}`); say('='.repeat(78)); };
const verdict = (t) => { say(); say(`  VERDICT  ${t.replace(/\n/g, '\n           ')}`); };

const T0 = 1739577600;                                    // "now" at the receiving hub
const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

function makeIdentity(url, kid, { revoked_at } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat: T0 - 86400 * 30, kid, kty: 'OKP', x };
  if (revoked_at) jwk.revoked_at = revoked_at;
  const doc = { url, keys: [jwk], name: kid, seq: 1, updated: T0 - 86400 * 30 };
  doc._sig = sign(doc, privateKey, `${url}#${kid}`, { kind: 'identity' });
  return { url, kid, jwk, privateKey, document: doc };
}

function signItem(identity, { _openfeed, ...fields } = {}) {
  // MERGED, never replaced. `{ ...item, _openfeed: { rel } }` silently drops `version`, and
  // every item this file signs then fails §10.2 step 2 as `missing_field` — which is exactly
  // what it did, through the whole `_openfeed` rename, because nothing here asserted anything.
  const item = {
    authors: [{ url: identity.url }],
    date_published: iso(T0 - 3600),
    ...fields,
    _openfeed: { version: 1, ..._openfeed },
  };
  item._sig = sign(item, identity.privateKey, `${identity.url}#${identity.kid}`, { kind: 'item' });
  return item;
}

// ---- the cast ---------------------------------------------------------------------------

const MOM = 'https://mom.pence.family/';
const MOM_FEED = `${MOM}feed.json`;
const gran = makeIdentity('https://gran.example/', 'gran-1');
const dad = makeIdentity('https://dad.example/', 'dad-1');
const eve = makeIdentity('https://eve.example/', 'eve-1');

const web = new Map([
  [`${gran.url}openfeed.json`, gran.document],
  [`${dad.url}openfeed.json`, dad.document],
  [`${eve.url}openfeed.json`, eve.document],
]);

// ---- the inbox ---------------------------------------------------------------------------
// §10.2 verbatim, in order, with the two ordering rules made observable.

function makeInbox({ ownedIds = new Set(), blocked = new Set(), writeBeforeVerify = false } = {}) {
  const dedup = new Map();               // §10.3: (author, id) -> version
  const trace = [];
  let fetches = 0;
  let fetchesBeforeStep7 = 0;

  const key = (author, id) => `${normalizeIdentityUrl(author)}\0${id}`;

  async function fetchIdentity(url) {
    fetches++;
    return web.get(`${normalizeIdentityUrl(url)}openfeed.json`) ?? null;
  }

  // §10.2 step 3. `to` is `{feed_url}#{item_id}` (§8); receivers split at the LAST '#',
  // unambiguous because ids never contain one (§7.2).
  function relevant(item, { byIdHalf }) {
    if (!Array.isArray(item._openfeed?.rel)) return false;
    for (const rel of item._openfeed?.rel) {
      const to = String(rel?.to ?? '');
      const cut = to.lastIndexOf('#');
      const feedHalf = cut === -1 ? to : to.slice(0, cut);
      const idHalf = cut === -1 ? null : to.slice(cut + 1);
      if (feedHalf === MOM || feedHalf === MOM_FEED) return true;
      if (byIdHalf && idHalf && ownedIds.has(idHalf)) return true;
    }
    return false;
  }

  async function post(body, { at = T0, byIdHalf = true, confirmTarget = false } = {}) {
    trace.length = 0;
    const step = (n, what) => trace.push(`${n}. ${what}`);
    const done = (status, error) => ({ status, error, fetches, fetchesBeforeStep7, trace: [...trace] });

    // 1 — size, parse, I-JSON duplicate-member rejection
    step(1, 'parse + I-JSON');
    if (body.length > 100 * 1024) return done(400, 'invalid_json');
    let item;
    try { item = parseIJSON(body); } catch { return done(400, 'invalid_json'); }

    // 2 — required fields (§7.2)
    step(2, 'required fields');
    const author = item?.authors?.[0]?.url;
    if (typeof item?.id !== 'string' || item.id.includes('#') || typeof author !== 'string' ||
        typeof item._openfeed?.version !== 'number' || typeof item.date_published !== 'string' ||
        typeof item._sig !== 'string') {
      return done(400, 'missing_field');
    }

    // 3 — relevance. §10.2's exception: a tombstone whose (author, id) matches a stored item
    // is always relevant. Note this reads the dedup store, before any signature check.
    step(3, 'relevance');
    const stored = dedup.get(key(author, item.id));
    const tombstoneOfMine = item._openfeed?.deleted === true && stored !== undefined;
    if (!relevant(item, { byIdHalf }) && !tombstoneOfMine) return done(400, 'not_relevant');

    // 4 — timestamp bounds
    step(4, 'timestamp bounds');
    const signedAt = Math.floor(Date.parse(item.date_modified ?? item.date_published) / 1000);
    if (signedAt < at - 7 * 86400 || signedAt > at + 86400) return done(400, 'missing_field');

    // 5 — dedup READ. §10.3: reject stale without fetching.
    step(5, 'dedup (read only)');
    if (stored !== undefined && item._openfeed?.version <= stored) return done(409, 'stale_version');

    // The defect this prototype exists to price. §10.3 forbids it in one sentence, and it is
    // the single most natural line to write here: you have the pair, you have the version.
    if (writeBeforeVerify) dedup.set(key(author, item.id), item._openfeed?.version);

    // 6 — rate limit by source IP (always); by author only once known, which is step 7
    step(6, 'rate limit (IP)');

    // 7 — THE fetch. Everything above ran on attacker-controlled bytes.
    fetchesBeforeStep7 = fetches;
    step(7, 'verify signature — ONE outbound fetch');
    const identityDocument = await fetchIdentity(author);
    if (!identityDocument) return done(401, 'invalid_signature');
    let info;
    try {
      info = verifyDocument(item, { identityDocument, kind: 'item' });
    } catch {
      return done(401, 'invalid_signature');
    }

    // 8 — revocation against RECEIPT time (§4.4), which a sender cannot backdate
    step(8, 'revocation vs receipt time');
    if (typeof info.key.revoked_at === 'number' && at > info.key.revoked_at) {
      return done(401, 'key_revoked');
    }

    // 9 — optional target existence, after step 7 so it is not an unauthenticated oracle
    if (confirmTarget) {
      step(9, 'target exists');
      const target = item._openfeed?.rel?.[0]?.to ?? '';
      const id = target.slice(target.lastIndexOf('#') + 1);
      if (id && !ownedIds.has(id)) return done(404, 'target_not_found');
    }

    // Accepted. §10.4: a blocked author gets 202 with the content discarded — a distinct
    // status tells a harasser to make a new identity and confirms the account exists.
    step(10, 'write dedup + store');
    dedup.set(key(author, item.id), item._openfeed?.version);
    if (blocked.has(normalizeIdentityUrl(author))) return done(202, null);
    return done(202, null);
  }

  return { post, dedup, key, get fetches() { return fetches; } };
}

const MY_ITEM = 'urn:uuid:550e8400-cookies';
const MY_REPLY = 'urn:uuid:661f9511-thanks';

// =========================================================================================
scene(1, 'The happy path, with every fetch counted and placed');
// =========================================================================================

const inbox = makeInbox({ ownedIds: new Set([MY_ITEM, MY_REPLY]) });
const reply = signItem(gran, {
  id: 'urn:uuid:aaaa-0001',
  content_text: 'Those cookies were delicious!',
  _openfeed: { rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
});
const r1 = await inbox.post(JSON.stringify(reply));

say(`  status ${r1.status}, outbound fetches: ${r1.fetches}`);
say(`  fetches performed BEFORE step 7: ${r1.fetchesBeforeStep7}`);
say(`  pipeline:`);
for (const t of r1.trace) say(`    ${t}`);

// The same, from an unknown author with a bad signature: how much work did they buy?
const forged = { ...reply, id: 'urn:uuid:aaaa-0002', _sig: reply._sig };
const r2 = await inbox.post(JSON.stringify(forged));
// A distinct `id`, deliberately: reusing the accepted one made this land on §10.3's stale
// check at step 5 and cost zero fetches for a reason that has nothing to do with relevance —
// so the measurement below read as a pass with the relevance check switched off entirely.
const junk = await inbox.post(JSON.stringify({
  ...reply,
  id: 'urn:uuid:aaaa-0009',
  _openfeed: { ...reply._openfeed, rel: [{ type: 'reply', to: 'https://elsewhere.example/feed.json#x' }] },
}));

say();
say(`  a forged signature costs the receiver: ${r2.fetches - r1.fetches} fetch, status ${r2.status}`);
say(`  an irrelevant item costs:              ${junk.fetches - r2.fetches} fetches, status ${junk.status} (${junk.error})`);
say(`  — which is §13.9's whole point: relevance is what keeps an attacker from turning this`);
say(`  inbox into a fetch amplifier, and it is free because it reads only the posted bytes.`);

verdict(
  'The ordering is real and cheap. An unauthenticated sender who is not talking about the\n' +
  'inbox owner buys zero outbound requests; one who is buys exactly one, to a fixed path\n' +
  'derived from the claimed author (§13.9 — never an arbitrary URL from the kid).',
);

// =========================================================================================
scene(2, 'The §10.3 write-before-verify attack');
// =========================================================================================

// §10.3, one sentence: "The §10.2 pipeline **reads** this store before verification and MUST
// NOT **write** it until verification succeeds ... recording an unverified (author, id) ->
// version lets anyone pin a victim's item at a version it will never reach."

const poisonRuns = {};
for (const writeBeforeVerify of [true, false]) {
  const victimInbox = makeInbox({ ownedIds: new Set([MY_ITEM]), writeBeforeVerify });

  // Eve knows Dad's identity URL and guesses (or observes) an item id. She signs nothing
  // usable — her _sig is garbage — and claims a version Dad will never reach.
  const poison = {
    id: 'urn:uuid:dddd-0001',
    authors: [{ url: dad.url }],
    content_text: 'not from Dad',
    date_published: iso(T0 - 60),
    _openfeed: { version: 999999, rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
    _sig: reply._sig,                                     // valid shape, wrong key
  };
  const poisoned = await victimInbox.post(JSON.stringify(poison));

  // Dad's real reply, correctly signed, at an ordinary version.
  const real = signItem(dad, {
    id: 'urn:uuid:dddd-0001',
    content_text: 'Save me one.',
    _openfeed: { rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
  });
  const genuine = await victimInbox.post(JSON.stringify(real));

  poisonRuns[String(writeBeforeVerify)] = { poisoned, genuine };
  say(`  writeBeforeVerify = ${String(writeBeforeVerify).padEnd(5)}  ` +
      `Eve's forgery: ${poisoned.status} ${poisoned.error ?? ''}   ` +
      `Dad's real reply: ${genuine.status} ${genuine.error ?? ''}`);
}

say();
say(`  Same rejection of the forgery either way — Eve never gets an item stored. The damage`);
say(`  is entirely in the dedup store, and it is permanent: (dad.example, that id) is pinned`);
say(`  at 999999, so every genuine revision Dad will ever sign is stale forever. He is not`);
say(`  told. Mom is not told. The forgery was rejected, which is what makes it invisible.`);

verdict(
  'The MUST earns its place, and the failure is silent in both directions. Note what the\n' +
  'attack needs: a victim identity URL and an item id — no key, no access, no signature. It\n' +
  'is the cheapest denial in the protocol and its cost to the attacker is one HTTP request.\n' +
  'ADOPTED: §13.9 now carries it, beside the fetch amplification it is cheaper than. §10.3\n' +
  'still states the rule, but it no longer states it only where a dedup-store implementer\n' +
  'would find it.',
);

// =========================================================================================
scene(3, 'Relevance: the id half, and the root entry');
// =========================================================================================

const withIdHalf = makeInbox({ ownedIds: new Set([MY_ITEM, MY_REPLY]) });
const withoutIdHalf = makeInbox({ ownedIds: new Set([MY_ITEM, MY_REPLY]) });

// C1: after Mom migrates, replies keep naming the OLD feed inside other people's signed bytes.
const OLD_FEED = 'https://mom.hub.example/feed.json';
const toOldFeed = signItem(gran, {
  id: 'urn:uuid:aaaa-0003',
  content_text: 'Still thinking about those cookies.',
  _openfeed: { rel: [{ type: 'reply', to: `${OLD_FEED}#${MY_ITEM}` }] },
});
const a = await withIdHalf.post(JSON.stringify(toOldFeed), { byIdHalf: true });
const b = await withoutIdHalf.post(JSON.stringify(toOldFeed), { byIdHalf: false });
say(`  reply naming the predecessor feed:`);
say(`    id-half match (C1):          ${a.status} ${a.error ?? 'accepted'}`);
say(`    feed-URL match only:         ${b.status} ${b.error ?? 'accepted'}`);
say(`  The second is what a host gets if its predecessor-URL table was never written or did`);
say(`  not survive the move — and §3.4 warns the old document may be unreachable by then.`);

// §8.1: a reply-to-a-reply reaches the thread's host only via a `root` entry.
say();
const nested = signItem(dad, {
  id: 'urn:uuid:dddd-0002',
  content_text: 'I helped make them!',
  _openfeed: { rel: [{ type: 'reply', to: `${gran.url}feed.json#urn:uuid:aaaa-0001` }] },
});
const nestedWithRoot = signItem(dad, {
  id: 'urn:uuid:dddd-0003',
  content_text: 'I helped make them!',
  _openfeed: {
    rel: [
      { type: 'reply', to: `${gran.url}feed.json#urn:uuid:aaaa-0001` },
      { type: 'root', to: `${MOM_FEED}#${MY_ITEM}` },
    ],
  },
});
const n1 = await withIdHalf.post(JSON.stringify(nested));
const n2 = await withIdHalf.post(JSON.stringify(nestedWithRoot));
say(`  reply-to-a-reply at the THREAD HOST's inbox (§8.1):`);
say(`    without a root entry: ${n1.status} ${n1.error}  <- the person hosting the thread cannot see it`);
say(`    with a root entry:    ${n2.status} accepted`);
say(`  Relevance is judged per _rel entry and is type-agnostic, so a receiver that predates`);
say(`  the \`root\` token still honors it — which is why §8.1 works as a SHOULD on senders.`);

verdict(
  'Both mechanisms do what §8.1 and C1 claim. The id-half match needs no state at all and\n' +
  'is checked against a store step 5 reads anyway, which is the argument for retiring §3.4\'s\n' +
  'predecessor-feed-URL bookkeeping rather than implementing it.',
);

// =========================================================================================
scene(4, 'Dedup across a migration — the one this was not looking for');
// =========================================================================================

// §4.4 is explicit that its first-observation record is keyed on `(author, id)` "never on
// (feed_url, id), so a consumer that followed a predecessor keeps its earlier and stronger
// observation across a migration." §10.3 uses the SAME key shape and says nothing about
// migration. Does it need to?

const granNew = makeIdentity('https://gran.new/', 'gran-new-1');
web.set(`${granNew.url}openfeed.json`, granNew.document);
const receiving = makeInbox({ ownedIds: new Set([MY_ITEM]) });

// Gran sends a private note before she migrates. Delivered only — no _feed_url — so it exists
// nowhere but this inbox and her own export bundle (§14).
const note = signItem(gran, {
  id: 'urn:uuid:aaaa-private',
  content_text: 'Between us: the biopsy came back fine.',
  _openfeed: { rel: [{ type: 'mention', to: MOM }] },
});
const sent = await receiving.post(JSON.stringify(note));
say(`  Gran delivers a private note from ${gran.url}: ${sent.status}`);
say(`  stored under (${gran.url}, urn:uuid:aaaa-private) at version 1`);

// Gran migrates to gran.new. Now she wants it retracted. A tombstone is an ordinary item
// (§7.3) and must be signed — by a key of the identity that signs it, which is now gran.new,
// because §6.6 binds authors[0].url to the kid's identity.
say();
say(`  Gran migrates to ${granNew.url} and retracts it. The tombstone must be signed by a key`);
say(`  she still holds, and §6.6 binds authors[0].url to the kid's identity — so it names`);
say(`  ${granNew.url}, not ${gran.url}. The bytes cannot say otherwise.`);

const retraction = signItem(granNew, {
  id: 'urn:uuid:aaaa-private',
  content_text: '',
  date_published: iso(T0 - 3600),
  date_modified: iso(T0 - 60),
  _openfeed: { version: 2, deleted: true, rel: [{ type: 'mention', to: MOM }] },
});
const retracted = await receiving.post(JSON.stringify(retraction));
say();
say(`  the retraction: ${retracted.status} ${retracted.error ?? 'accepted'}`);
say(`  dedup store now holds:`);
for (const [k, v] of receiving.dedup) say(`    ${k.replace('\0', '  ')}  v${v}`);
say();
say(`  It was accepted — as a NEW item, under a different (author, id) pair. The original is`);
say(`  untouched and still live. §10.3's "an update, including tombstones, if _version is`);
say(`  greater than stored" never fired, because nothing was stored under this author.`);
say(`  §8.2's "receivers MUST accept a tombstone whose (author, id) matches a stored item"`);
say(`  never fired either, for the same reason.`);
say();
say(`  Nothing here is a signature failure, a relevance failure, or a version conflict. Every`);
say(`  check passed and the retraction did not retract.`);

verdict(
  'A sixth site for predecessor equivalence, which nothing named when this was measured. §3.4\n' +
  'listed the consequences it closes — §4.4, §7.5, §9, §9.3 invariant 5, §10.2 — and §10.3 was\n' +
  'not among them, so dedup keyed a migrated author as a stranger. After exercising your exit you\n' +
  'no longer EDIT or RETRACT anything you delivered before it. For a delivered-only item that\n' +
  'is the only copy in existence outside your own export bundle, and the recipient holds it.\n' +
  '\n' +
  'This is worse than the bouncing replies §3.4 already worries about, because it fails\n' +
  'CLOSED-looking and OPEN-behaving: the sender gets a 202 and believes the retraction landed.\n' +
  '\n' +
  '-> ADOPTED. §10.3 now states that the `author` half is subject to predecessor equivalence,\n' +
  '   "exactly as §4.4\'s identically-shaped record is". The scene above still runs the failure\n' +
  '   because the clause is a rule about the receiver\'s own store: `src/inbox.js` takes an\n' +
  '   `equivalent` predicate, and a deployment that supplies none reproduces exactly this.',
);

// =========================================================================================
scene(5, '§10.4\'s existence oracle, priced');
// =========================================================================================

const probed = makeInbox({ ownedIds: new Set([MY_ITEM]) });
await probed.post(JSON.stringify(signItem(dad, {
  id: 'urn:uuid:dddd-known', content_text: 'hi', _openfeed: { rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
})));

const probe = (id) => JSON.stringify({
  id, authors: [{ url: dad.url }], content_text: '', date_published: iso(T0 - 60),
  date_modified: iso(T0 - 60), _openfeed: { version: 2, deleted: true }, _sig: reply._sig,
});
const known = await probed.post(probe('urn:uuid:dddd-known'));
const unknown = await probed.post(probe('urn:uuid:dddd-guessed'));

say(`  a garbage-signed tombstone, naming a pair that IS stored:  ${known.status} ${known.error}`);
say(`  the same, naming a pair that is NOT:                       ${unknown.status} ${unknown.error}`);
say(`  The difference is the oracle §10.4 names: the tombstone-relevance exception reads the`);
say(`  dedup store at step 3, before any signature check, so the status distinguishes the two`);
say(`  with no key and no knowledge beyond an id.`);
say();
say(`  §10.4 prices this as safe where ids are unguessable UUIDs and directs 202-and-discard`);
say(`  where they are not. Confirmed: the whole attack is guessing ${'urn:uuid:'.length + 32} characters.`);

verdict(
  'Behaves as documented, and §10.4 documents it in the right amount of detail. Worth noting\n' +
  'that C1 (id-half relevance) does not widen this: the oracle already answers to an id alone.',
);

// =========================================================================================
say();
say('='.repeat(78));
say('SUMMARY');
say('='.repeat(78));
say(`
  Holds
    S1  §10.2's ordering is a real property: an irrelevant sender buys 0 outbound fetches,
        a relevant one buys exactly 1, to a fixed path
    S3  id-half relevance and §8.1's root entry both work, and the first needs no state
    S5  §10.4's oracle behaves exactly as documented and is bounded by id guessability

  Findings — BOTH ADOPTED. They are kept because the measurements below them are what the
  clauses rest on, and a rule whose evidence has been deleted is a rule nobody can re-check.
    I1  §10.3's write-before-verify defect is the cheapest denial in the protocol — a victim
        URL and an item id, no key — and it is silent to both the victim and the receiver.
        §10.3 stated the rule where only an implementer of the dedup store would read it.
        -> CLOSED. §13.9 now carries it, beside the fetch-amplification attack it is cheaper
           than, and says why the damage is invisible: the forgery is rejected either way.
    I2  §10.3's dedup key was not migration-aware, though §4.4's identically-shaped key
        explicitly was. After migrating you could not edit or retract anything you delivered
        before migrating: the tombstone arrives under a new (author, id), is accepted as a
        NEW item, and the original stays live. Sender sees 202.
        -> CLOSED. §10.3's first paragraph now states that the \`author\` half is subject to
           predecessor equivalence (§3.4), "exactly as §4.4's identically-shaped record is".

  Both findings were about state the inbox keeps rather than bytes it checks, which is the
  half of §10 with the least normative text and the most implementation freedom. S4's scene
  still runs the failure, because what closed it is one clause and nothing enforces it here:
  the equivalence lives in the receiver's own store, which is why \`src/inbox.js\` takes an
  \`equivalent\` predicate rather than assuming one.
`);

// ---- gate ---------------------------------------------------------------------------------
// This file had no assertion gate on any of it. §10.2's ordering and §10.3's write-before-verify
// rule are exactly the properties that return the SAME STATUS CODE whether obeyed or not — which
// is this prototype's opening argument for measuring rather than reading, and was also the
// reason nothing here could fail.
const claims = [
  ['S1 a relevant delivery costs exactly one outbound fetch', r1.fetches === 1],
  ['S1 no outbound fetch happens before step 7 (§10.2 numbering is normative)',
    r1.fetchesBeforeStep7 === 0],
  ['S1 an irrelevant sender costs zero outbound fetches', junk.fetches === r2.fetches],
  ['S1 a forged signature still costs exactly one, and no more', r2.fetches - r1.fetches === 1],
  ['S2 the forgery is rejected whichever order the store is written in',
    poisonRuns.true.poisoned.status >= 400 && poisonRuns.false.poisoned.status >= 400],
  ['S2 write-before-verify is what denies the victim their own later revisions',
    poisonRuns.true.genuine.status >= 400 && poisonRuns.false.genuine.status < 300],
  ['S3 an id-half match reaches an inbox a feed-URL match cannot (C1)',
    a.status < 300 && b.status >= 400],
  ['S3 §8.1: a nested reply reaches the thread host only via a `root` entry',
    n1.status >= 400 && n2.status < 300],
  ['S4 a post-migration retraction files as a NEW item, leaving the original live',
    retracted.status < 300 && receiving.dedup.size === 2],
  ['S5 §10.4 distinguishes a stored pair from an unstored one with no key',
    known.status !== unknown.status],
];
const broken = claims.filter(([, ok]) => !ok);
if (broken.length) {
  say();
  say('FAIL — these claims no longer hold:');
  for (const [label] of broken) say(`  ${label}`);
  say('Either the prototype is stale or the property it measures is. Both are findings.');
  process.exit(1);
}
