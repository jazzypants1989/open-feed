// The inbox (§10), over a real socket for the one fetch it is allowed to make.
//
// Most of what §10 requires is invisible in output. §10.2's ordering and §10.3's
// write-before-verify rule are both properties of *when* something happens, and a correct
// implementation and a wrong one return the same status either way — which is what makes the
// damage silent and what makes these assertions about `fetches`, `fetchesBeforeVerify`, and the
// contents of the dedup store rather than about status codes alone.

import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY, T0, newSite, consumer, makeSigner } from './helpers/site.js';
import {
  createInbox,
  DedupStore,
  DeliveryStore,
  documentHash,
  normalizeIdentityUrl,
  splitTarget,
  renderable,
  publishable,
  canonicalBytes,
  chainUrlsOf,
  PinStore,
  Publisher,
  sign,
} from '../src/index.js';

const MOM = 'https://mom.pence.family/';
const MOM_FEED = `${MOM}feed.json`;
const MY_ITEM = 'urn:uuid:550e8400-cookies';
const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** An identity served at `site`, so the inbox's one fetch has somewhere real to land. */
function identityAt(site, name, { revoked_at } = {}) {
  const signer = makeSigner(`${name}-1`, { iat: T0 - 30 * DAY });
  const url = `${site.url}${name}/`;
  const jwk = { ...signer.jwk };
  if (revoked_at) jwk.revoked_at = revoked_at;
  const doc = { url, keys: [jwk], name, seq: 1, updated: T0 - 30 * DAY };
  doc._sig = sign(doc, signer.privateKey, `${url}#${signer.kid}`);
  site.files.set(`${name}/openfeed.json`, canonicalBytes(doc));
  return { url, signer, document: doc };
}

function item(who, fields) {
  const doc = {
    authors: [{ url: who.url }],
    _version: 1,
    content_text: 'thanks!',
    date_published: iso(T0 - 3600),
    ...fields,
  };
  doc._sig = sign(doc, who.signer.privateKey, `${who.url}#${who.signer.kid}`);
  return doc;
}

const body = (doc) => canonicalBytes(doc);

function inboxFor(t, site, extra = {}) {
  const me = consumer(t, { now: () => T0 });
  const held = new Set([MY_ITEM]);
  return createInbox({
    owner: MOM,
    feedUrls: [MOM_FEED],
    holdsItem: (id) => held.has(id),
    fetcher: me.fetcher,
    now: () => T0,
    ...extra,
  });
}

test('one delivery costs one hit in each rate-limit bucket, not two in the IP bucket', async (t) => {
  // §10.2 step 6 is "by source IP (always) and by author (once known)" — two axes, charged
  // once each. The pipeline calls the limiter twice, before and after verification, and the
  // status is `202` either way, so a limiter charging the IP on both calls is invisible until
  // an operator wonders why a configured budget of N behaves like N/2. Worse, it behaves like
  // N/2 for *well-formed* traffic and the full N for garbage that never reaches step 8 — the
  // ladder pointing the wrong way. Only the charges reveal it, which is why this asserts on
  // them rather than on a `429`.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const charges = [];
  const inbox = inboxFor(t, site, {
    rateLimit: ({ sourceIp, author }) => { charges.push({ sourceIp, author }); return true; },
  });

  const ok = await inbox.deliver(
    body(item(gran, { id: 'urn:uuid:rl-1', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] })),
    { sourceIp: '203.0.113.9' },
  );
  assert.equal(ok.status, 202, 'a well-formed delivery is accepted');

  assert.equal(charges.length, 2, 'the limiter is consulted before and after verification');
  assert.deepEqual(charges[0], { sourceIp: '203.0.113.9', author: null }, 'step 6: IP only');
  assert.deepEqual(charges[1], { sourceIp: null, author: `${gran.url}` }, 'step 8: author only');

  // The axes are disjoint: exactly one charge per bucket per delivery.
  assert.equal(charges.filter((c) => c.sourceIp).length, 1, 'the IP is charged once');
  assert.equal(charges.filter((c) => c.author).length, 1, 'the author is charged once');
});

// ---- §10.2: the order is the security property ----

test('an irrelevant delivery costs zero outbound fetches', async (t) => {
  // §10.2: "Cheap local checks run before any outbound fetch; the sender is unauthenticated
  // until step 7." An inbox that verified first would let anyone who can POST choose which URL
  // it dials, for free (§13.9). The status is the same either way — only the count is not.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site);

  const stranger = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:elsewhere',
    _rel: [{ type: 'reply', to: 'https://somebody-else.example/feed.json#urn:uuid:not-mine' }],
  })));
  assert.equal(stranger.status, 400);
  assert.equal(stranger.error, 'not_relevant');
  assert.equal(stranger.fetches, 0, 'nothing was dialled on an unauthenticated request');

  const relevant = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:reply-1',
    _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(relevant.status, 202);
  assert.equal(relevant.fetches, 1, 'exactly one, at the claimed author\'s fixed path');
  assert.equal(relevant.fetchesBeforeVerify, 0, 'and not one of them before step 7');
});

test('malformed and off-limits bodies are refused before anything is dialled', async (t) => {
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site);

  const cases = [
    ['not json at all', 400, 'invalid_json'],
    ['{"a":1,"a":2}', 400, 'invalid_json'],                       // I-JSON duplicate member
    ['{"__proto__":{}}', 400, 'invalid_json'],                    // §6.3's reserved name
    ['{"a":9007199254740993}', 400, 'invalid_json'],              // §6.3's number range
    [JSON.stringify({ id: 'x#y' }), 400, 'missing_field'],        // §7.2: ids carry no #
    [JSON.stringify({ id: 'a', authors: [] }), 400, 'missing_field'],
  ];
  for (const [raw, status, error] of cases) {
    const got = await inbox.deliver(raw);
    assert.equal(got.status, status, raw.slice(0, 30));
    assert.equal(got.error, error, raw.slice(0, 30));
    assert.equal(got.fetches, 0);
  }

  // §13.4's inbox cap, refused on size alone.
  const huge = await inbox.deliver(Buffer.alloc(200 * 1024, 0x20));
  assert.equal(huge.status, 400);
  assert.equal(huge.fetches, 0);

  // And a timestamp outside §10.2 step 4's window never reaches a socket either.
  const old = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:ancient',
    date_published: iso(T0 - 30 * DAY),
    _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(old.status, 400);
  assert.equal(old.fetches, 0);
});

// ---- §10.3: the cheapest denial in the protocol ----

test('a forged delivery cannot pin a victim\'s item at a version it will never reach', async (t) => {
  // §13.9's "cheaper attack beside it": a victim's identity URL and one item id, no key, no
  // valid signature, one request. Write the dedup store before verifying and `(victim, id)` is
  // pinned at version 99 forever, so every genuine revision the victim signs is rejected as
  // stale. The forgery is rejected either way — which is exactly what makes it invisible.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const dedup = new DedupStore();
  const inbox = inboxFor(t, site, { dedup });

  const real = item(gran, {
    id: 'urn:uuid:gran-reply',
    _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  });
  const forged = { ...real, _version: 99, content_text: 'not from gran' };
  forged._sig = real._sig;   // stale signature over different bytes

  const rejected = await inbox.deliver(body(forged));
  assert.equal(rejected.status, 401);
  assert.equal(rejected.error, 'invalid_signature');
  assert.equal(dedup.read(gran.url, 'urn:uuid:gran-reply'), null, 'and it left no trace (§10.3)');

  const genuine = await inbox.deliver(body(real));
  assert.equal(genuine.status, 202, 'so the real revision still lands');
  assert.equal(dedup.read(gran.url, 'urn:uuid:gran-reply').version, 1);
});

test('a lower or equal version is stale, and an update replaces', async (t) => {
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site);
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];

  assert.equal((await inbox.deliver(body(item(gran, { id: 'urn:uuid:r', _rel: rel, _version: 2 })))).status, 202);
  const replay = await inbox.deliver(body(item(gran, { id: 'urn:uuid:r', _rel: rel, _version: 2 })));
  assert.equal(replay.status, 409);
  assert.equal(replay.error, 'stale_version');
  assert.equal(replay.fetches, 0, 'stale is rejected without fetching (§10.2 step 5)');

  const update = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:r', _rel: rel, _version: 3, date_modified: iso(T0 - 60),
  })));
  assert.equal(update.status, 202);
});

test('a stranger reusing an id files a separate record rather than revising somebody else\'s', async (t) => {
  // The bound §10.3 gained on the id-half match. Ids are globally unique by convention and
  // published in the clear, so without it Eve copies a public id, signs her own item at a higher
  // `_version` — a genuine signature, just genuine about the wrong thing — and the receiver
  // files it as a revision of Gran's.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const eve = identityAt(site, 'eve');
  const dedup = new DedupStore();
  const inbox = inboxFor(t, site, { dedup });
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];

  await inbox.deliver(body(item(gran, { id: 'urn:uuid:shared', _rel: rel, _version: 2 })));
  const collided = await inbox.deliver(body(item(eve, { id: 'urn:uuid:shared', _rel: rel, _version: 9 })));

  assert.equal(collided.status, 202, 'not stale — it is a different item that shares an id');
  assert.equal(collided.collision, gran.url, 'and the collision is named rather than resolved');
  assert.equal(dedup.read(gran.url, 'urn:uuid:shared').version, 2, 'Gran\'s record is untouched');
  assert.equal(dedup.read(eve.url, 'urn:uuid:shared').version, 9);
});

test('a verified migration makes two authors one record', async (t) => {
  // The property the id-half match exists for, and the reason it cannot simply be dropped:
  // §6.6 binds a tombstone's author to the identity now signing it, so an author who migrated
  // and then retracts something they *delivered* beforehand arrives under a new pair.
  const site = await newSite(t);
  const before = identityAt(site, 'old');
  const after = identityAt(site, 'new');
  const dedup = new DedupStore({
    equivalent: (a, b) => a === b || [a, b].every((u) => [before.url, after.url].includes(u)),
  });
  const inbox = inboxFor(t, site, { dedup });
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];

  await inbox.deliver(body(item(before, { id: 'urn:uuid:moved', _rel: rel, _version: 1 })));
  const retraction = await inbox.deliver(body(item(after, {
    id: 'urn:uuid:moved',
    _version: 2,
    _deleted: true,
    content_text: '',
    date_modified: iso(T0 - 60),
    _rel: rel,
  })));

  assert.equal(retraction.status, 202);
  assert.equal(retraction.collision, null);
  assert.equal(dedup.read(before.url, 'urn:uuid:moved').version, 2, 'one record, now at the tombstone');
});

// ---- §10.2 step 3: relevance ----

test('relevance matches the id half whatever feed the other half names', async (t) => {
  // §10.2's predecessor equivalence with no recorded state: a reply written before a migration
  // names the old feed inside its author's signed bytes, and nobody can re-sign it. Matching the
  // id half honors it with nothing that has to survive the move — which matters because the
  // state's failure window *is* the exit.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site);

  const preMigration = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:old-reply',
    _rel: [{ type: 'reply', to: `https://mom.oldhost.example/feed.json#${MY_ITEM}` }],
  })));
  assert.equal(preMigration.status, 202, 'the feed half is stale; the id half is not');

  // §8.1: relevance is judged per entry and is type-agnostic, so a `root` entry reaches the
  // thread's host even at a receiver that predates the type.
  const nested = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:nested',
    _rel: [
      { type: 'reply', to: 'https://dad.example/feed.json#urn:uuid:dads-reply' },
      { type: 'root', to: `${MOM_FEED}#${MY_ITEM}` },
    ],
  })));
  assert.equal(nested.status, 202);

  const unknownType = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:custom',
    _rel: [{ type: 'https://example.com/ns#bookmark', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(unknownType.status, 202, 'an unknown type about me is still about me (§2.1)');
});

// ---- §7.3 and §8.2: tombstones ----

test('a tombstone that kept its content is refused; one that dropped its _rel is not', async (t) => {
  // §7.3's allowlist is an allowlist on purpose: a denylist naming today's content fields would
  // let a conformant tombstone retain a title, a tag, or an extension payload carrying the very
  // thing the author deleted. §8.2 pulls the other way for the receiver — the `(author, id)`
  // match is the authority and the routing is a convenience.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site);
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];

  await inbox.deliver(body(item(gran, { id: 'urn:uuid:t', _rel: rel })));

  const fat = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:t', _version: 2, _deleted: true, content_text: '',
    date_modified: iso(T0 - 60), title: 'the thing I deleted', _rel: rel,
  })));
  assert.equal(fat.status, 400);
  assert.match(fat.message, /title/);

  const bare = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:t', _version: 2, _deleted: true, content_text: '', date_modified: iso(T0 - 60),
  })));
  assert.equal(bare.status, 202, '§8.2: the (author, id) match is the authority, not the routing');
});

// ---- §4.4, §10.4 ----

test('revocation is judged against receipt time, which a sender cannot backdate', async (t) => {
  const site = await newSite(t);
  const gran = identityAt(site, 'gran', { revoked_at: T0 - 2 * DAY });
  const inbox = inboxFor(t, site);

  const backdated = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:backdated',
    date_published: iso(T0 - 3 * DAY),     // before the revocation, as the sender tells it
    _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(backdated.status, 401);
  assert.equal(backdated.error, 'key_revoked');
});

test('a blocked author gets 202 and the content is discarded', async (t) => {
  // §10.4: a distinct status tells a harasser to make a new identity and confirms the account
  // exists. In a family app the harasser frequently knows exactly which account they are probing.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site, { blocked: new Set([`${site.url}gran/`]) });

  const got = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:blocked', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(got.status, 202);
  assert.equal(got.item, null);
  assert.equal(got.discarded, true);
});

test('the CORS headers §10.1 requires cannot be forgotten', async (t) => {
  const site = await newSite(t);
  const inbox = inboxFor(t, site);
  assert.deepEqual(inbox.cors, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
});

// ---- §11.1.1 ----

test('the republication gate is one field, and it is the only enforcement that column has', async (t) => {
  // §11.1.1: "A receiver MUST NOT place a delivered-only item into any publicly-readable
  // artifact." §13.14 calls it the failure mode most likely to be introduced by an implementer
  // being helpful. The asymmetry is why it is a MUST — the author's choice is visible in the
  // signed bytes and trivially checkable, while its violation is invisible to the person it harms.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const inbox = inboxFor(t, site);

  const delivered = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:private', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(delivered.delivered, true);
  assert.equal(publishable(delivered.item), false);

  const published = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:public',
    _feed_url: `${gran.url}feed.json`,
    _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
  })));
  assert.equal(published.delivered, false);
  assert.equal(publishable(published.item), true);
});

// ---- §16.1: pins that arrive on a delivery ----

const MOM_CHAIN = `${MOM}openfeed.json`;
const MOM_MANIFEST = `${MOM}manifest.json`;
const STRANGER_CHAIN = 'https://stranger.example/openfeed.json';

/** An owner who has been reading its own chains, which is what gives an entry anything to hit. */
function ownerPins() {
  const pins = new PinStore({ now: () => T0 });
  pins.advance(MOM_CHAIN, 3, 'mom-id-3');
  pins.advance(MOM_MANIFEST, 12, 'mom-manifest-12');
  return pins;
}

test('a delivery\'s pins are judged locally, and cost the receiver nothing (§16.1)', async (t) => {
  // §10.2's fetch discipline governs this pipeline and §16.1 forbids dereferencing a stranger's
  // entry anyway (§13.9), so heeding pins must not add an outbound request. The count is the
  // only observable difference between an inbox that obeys that and one that does not.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const pins = ownerPins();
  const inbox = inboxFor(t, site, { pins });

  const got = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:pinned-1',
    _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }],
    _pins: [
      { url: MOM_CHAIN, seq: 3, hash: 'mom-id-3', observed: T0 - 600 },
      { url: MOM_CHAIN, seq: 3, hash: 'a-hash-the-peer-invented', observed: T0 - 600 },
      { url: MOM_CHAIN, seq: 9, hash: 'mom-id-9', observed: T0 - 60 },
      { url: STRANGER_CHAIN, seq: 1, hash: 'whoever', observed: T0 - 60 },
      { url: MOM_CHAIN, seq: 0, hash: 'malformed' },
    ],
  })));

  assert.equal(got.status, 202);
  assert.equal(got.fetches, 1, 'the author\'s identity document, and nothing for the pins');
  assert.deepEqual(got.peerPins.entries.map((e) => e.verdict), [
    'corroborates',   // the same bytes at a seq this receiver observed itself
    'check',          // different bytes there: §16.1's reason to go look, resolved elsewhere
    'unknown',        // a tracked chain at a seq beyond the pin — the re-walk signal
    'untracked',      // never tracked: ignored outright rather than dereferenced (§13.9)
  ]);
  assert.equal(got.peerPins.ignored, 1, 'the malformed entry');
  // Entries come back whole — §3.2 keeps unknown members, and `observed` is what §16.1's
  // informal timestamping is made of, so a verdict that dropped them would be unusable.
  assert.deepEqual(got.peerPins.entries[0], {
    url: MOM_CHAIN, seq: 3, hash: 'mom-id-3', observed: T0 - 600,
    verdict: 'corroborates', held: 'mom-id-3',
  });

  // And the claim stayed a claim. If a peer's entry were an observation, §5.3.1's response —
  // accept no further version until a human re-pins — would be available to any stranger who
  // can reach an inbox, against any chain the owner reads.
  assert.equal(pins.isFrozen(MOM_CHAIN), false);
  assert.deepEqual(pins.pin(MOM_CHAIN), { seq: 3, hash: 'mom-id-3', observed: T0, firstPinned: T0 });
  assert.equal(pins.reconcilePeerPin(MOM_CHAIN, 9, 'mom-id-9').verdict, 'unknown', 'seq 9 was not recorded');
});

test('a published item may pin only chains the receiver owns; a delivered one may gossip (§16.1)', async (t) => {
  // The scoping is the whole basis of the claim that pins disclose nothing new: a published
  // item is world-readable forever, so a third-party entry there would broadcast its author's
  // reading graph to everyone, silently.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const pins = ownerPins();
  const inbox = inboxFor(t, site, { pins });
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];
  const carried = [
    { url: MOM_CHAIN, seq: 3, hash: 'mom-id-3', observed: T0 - 600 },
    { url: STRANGER_CHAIN, seq: 1, hash: 'whoever', observed: T0 - 60 },
  ];

  const published = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:pinned-public', _feed_url: `${gran.url}feed.json`, _rel: rel, _pins: carried,
  })));
  assert.equal(published.delivered, false);
  assert.deepEqual(published.peerPins.entries.map((e) => e.url), [MOM_CHAIN]);
  assert.equal(published.peerPins.ignored, 1, 'the third-party entry never reaches a verdict');

  const delivered = await inbox.deliver(body(item(gran, {
    id: 'urn:uuid:pinned-private', _rel: rel, _pins: carried,
  })));
  assert.equal(delivered.delivered, true);
  assert.deepEqual(delivered.peerPins.entries.map((e) => e.verdict), ['corroborates', 'untracked']);
  assert.equal(delivered.peerPins.ignored, 0, 'delivery reaches exactly one counterparty');
});

test('the owner\'s manifest chains are pinnable on a published item only once declared', async (t) => {
  // `ownedChainUrls` defaults to the identity document alone, because that is the one chain
  // whose URL §3.1 derives. A deployment that knows its manifest URLs says so — and until it
  // does, an entry naming one is a third party's as far as the scoping rule can tell.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];
  const entry = [{ url: MOM_MANIFEST, seq: 12, hash: 'mom-manifest-12', observed: T0 - 600 }];
  const asPublished = (id, extra) => body(item(gran, {
    id, _feed_url: `${gran.url}feed.json`, _rel: rel, _pins: entry, ...extra,
  }));

  const bare = await inboxFor(t, site, { pins: ownerPins() }).deliver(asPublished('urn:uuid:m-1'));
  assert.deepEqual(bare.peerPins.entries, []);
  assert.equal(bare.peerPins.ignored, 1);

  const declared = await inboxFor(t, site, {
    pins: ownerPins(),
    ownedChainUrls: chainUrlsOf({ url: MOM, feeds: [{ url: MOM_FEED, manifest: MOM_MANIFEST }] }),
  }).deliver(asPublished('urn:uuid:m-2'));
  assert.deepEqual(declared.peerPins.entries.map((e) => e.verdict), ['corroborates']);
  assert.equal(declared.peerPins.ignored, 0);
});

test('pins are heeded only after verification, and only where the receiver asked for them', async (t) => {
  // §16 is OPTIONAL and this is where that has to be visible: a receiver that passes no store
  // reports nothing, and a receiver that passes one still learns nothing from a delivery that
  // never got past §10.2 step 7. Everything before that step ran on attacker-controlled bytes.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const rel = [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }];
  const carried = [{ url: MOM_CHAIN, seq: 3, hash: 'mom-id-3', observed: T0 - 600 }];

  const optedOut = await inboxFor(t, site).deliver(body(item(gran, {
    id: 'urn:uuid:no-store', _rel: rel, _pins: carried,
  })));
  assert.equal(optedOut.status, 202);
  assert.equal(optedOut.peerPins, null, 'no store, no verdicts — the facility is OPTIONAL');

  const inbox = inboxFor(t, site, { pins: ownerPins() });
  const noPins = await inbox.deliver(body(item(gran, { id: 'urn:uuid:no-pins', _rel: rel })));
  assert.equal(noPins.peerPins, null, 'and an item carrying none is not an empty verdict set');

  const real = item(gran, { id: 'urn:uuid:forged-pins', _rel: rel, _pins: carried });
  const forged = { ...real, content_text: 'not from gran' };
  forged._sig = real._sig;
  const rejected = await inbox.deliver(body(forged));
  assert.equal(rejected.status, 401);
  assert.ok(!rejected.peerPins, 'an unverified item\'s pins are not evidence of anything');
});

// ---- helpers the pipeline exposes ----

test('a target splits at the last #, and untrusted content is escaped', () => {
  assert.deepEqual(splitTarget(`${MOM_FEED}#${MY_ITEM}`), { feed: MOM_FEED, id: MY_ITEM });
  assert.deepEqual(splitTarget(MOM), { feed: MOM, id: null });
  // §7.2 forbids `#` in an id precisely so this split is unambiguous; a feed URL carrying one
  // still splits at the last, which is the rule §8 states.
  assert.deepEqual(splitTarget('https://x.example/f.json#a#b'), { feed: 'https://x.example/f.json#a', id: 'b' });

  const rendered = renderable({ content_text: '<script>alert(1)</script>', content_html: '<b>hi</b>' });
  assert.equal(rendered.text, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(rendered.html, null, '§10.5: never rendered as-is');
  assert.equal(rendered.requiresSanitizer, true);
  assert.equal(renderable({ _unverified: true, content_text: '' }).unverified, true);
});

test('a publisher\'s emitted pins are the ones this inbox heeds — §16.1 end to end', async (t) => {
  // §16.1 has two halves and until now only one of them had a caller. §5.3.1 is a Level 1 MUST
  // and §5.2 step 5 makes a publisher record every `(seq, hash)` it produced, but "nothing in
  // the core supplies either with a second observation to compare against" — that is the
  // emission half, and a compare rule nobody feeds is evidence collected and thrown away.
  //
  // So this drives the whole loop with no hand-written `_pins` anywhere: a sender that tracks
  // Mom's chains emits pins *for Mom* on an item addressed to her, and Mom's inbox scopes and
  // reconciles them against her own store.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');

  // What the sender knows about Mom, in its own PinStore.
  const senderPins = new PinStore({ now: () => T0 - 600 });
  senderPins.advance(`${MOM}openfeed.json`, 4, 'mom-identity-4');
  senderPins.advance(MOM_MANIFEST, 12, 'mom-manifest-12');
  // …and something about a third party, which the publication rule must keep off a published item.
  senderPins.advance('https://stranger.example/openfeed.json', 2, 'stranger-2');

  const momDocument = { url: MOM, feeds: [{ url: MOM_FEED, manifest: MOM_MANIFEST }] };
  const sender = new Publisher({
    identity: gran.url, signer: gran.signer, feedUrl: `${gran.url}feed.json`, now: () => T0 - 600,
  });

  // A published reply, with pins drawn from the store rather than written by hand.
  const reply = sender.publishItem(
    { id: 'urn:uuid:emitted-1', content_text: 'lovely', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
    { recipients: [momDocument], pins: senderPins },
  );
  assert.deepEqual(
    reply._pins.map((e) => `${e.url}@${e.seq}`).sort(),
    [`${MOM_MANIFEST}@12`, `${MOM}openfeed.json@4`].sort(),
    'recipient-scoped by construction — the stranger never appears',
  );
  assert.ok(reply._pins.every((e) => typeof e.observed === 'number'), '§16.1 asks for `observed`');

  // Mom's inbox, holding matching records for one chain and a conflicting one for the other.
  const momPins = new PinStore({ now: () => T0 });
  momPins.advance(`${MOM}openfeed.json`, 4, 'mom-identity-4');       // agrees
  momPins.advance(MOM_MANIFEST, 12, 'a-different-hash-entirely');    // disagrees

  const got = await inboxFor(t, site, {
    pins: momPins,
    ownedChainUrls: chainUrlsOf(momDocument),
  }).deliver(canonicalBytes(reply));

  assert.equal(got.status, 202);
  assert.equal(got.peerPins.ignored, 0, 'everything the publisher emitted was admissible');
  assert.deepEqual(
    Object.fromEntries(got.peerPins.entries.map((e) => [e.url, e.verdict])),
    { [`${MOM}openfeed.json`]: 'corroborates', [MOM_MANIFEST]: 'check' },
    'agreement corroborates; disagreement is a reason to check, never a freeze on a stranger\'s word',
  );
});

test('a publisher holding pins emits them by construction, not by remembering to', async (t) => {
  // §16.1's emission half is a Level 3 MUST now, and the reason the store is held on the
  // publisher rather than passed per call is that an obligation a caller re-supplies at every
  // send is one a deployment meets until the day it adds a code path. Nothing about the item
  // looks wrong when it is missed — the pin is simply absent, and the compare rule it exists to
  // feed goes on reporting nothing, which is the failure mode §13.2's teeth are made of.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const momDocument = { url: MOM, feeds: [{ url: MOM_FEED, manifest: MOM_MANIFEST }] };

  const pins = new PinStore({ now: () => T0 - 600 });
  pins.advance(`${MOM}openfeed.json`, 4, 'mom-identity-4');

  const sender = new Publisher({
    identity: gran.url, signer: gran.signer, feedUrl: `${gran.url}feed.json`,
    now: () => T0 - 600, pins,
  });
  const reply = sender.publishItem(
    { id: 'urn:uuid:by-construction', content_text: 'lovely', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
    { recipients: [momDocument] },   // no `pins` option: the publisher already holds the store
  );
  assert.deepEqual(reply._pins.map((e) => `${e.url}@${e.seq}`), [`${MOM}openfeed.json@4`]);

  // The MUST binds a sender that ALREADY tracks the recipient's chains, never one that would
  // have to go and read them first — so a publisher with no store owes nothing and emits nothing.
  const stranger = new Publisher({
    identity: gran.url, signer: gran.signer, feedUrl: `${gran.url}feed.json`, now: () => T0 - 600,
  });
  const bare = stranger.publishItem(
    { id: 'urn:uuid:owes-nothing', content_text: 'hi', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
    { recipients: [momDocument] },
  );
  assert.equal(bare._pins, undefined);
});

// ---- §10.6: delivery continuity ----

test('a dropped delivery is visible to its victim, and names the bytes it is missing', async (t) => {
  // The delivered column is committed by nothing: no feed, no manifest, no §7.6 URL, and §14
  // says the `delivered` and `received` slots carry no completeness proof. So the receiving host
  // can drop any delivery and the only signal anywhere is the sender's retry timeout — and under
  // §13.2's hostile-custodian tier that host is the adversary.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const sender = new Publisher({
    identity: gran.url, signer: gran.signer, feedUrl: `${gran.url}feed.json`, now: () => T0 - 600,
  });

  const sent = [];
  for (let i = 1; i <= 4; i++) {
    sent.push(sender.deliverItem(
      { id: `urn:uuid:note-${i}`, content_text: `note ${i}`, _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
      { at: T0 - 500 + i, to: MOM },
    ));
  }
  assert.deepEqual(sent.map((i) => i._delivery.seq), [1, 2, 3, 4]);
  assert.equal(sent[1]._delivery.prev, documentHash(sent[0]), 'each names the previous by its full published bytes');
  assert.equal(sent[0]._delivery.prev, undefined, 'the first names nothing');

  const deliveries = new DeliveryStore();
  const inbox = inboxFor(t, site, { deliveries });

  // Mom's hub delivers the first two, drops the third, delivers the fourth.
  const verdicts = [];
  for (const item of [sent[0], sent[1], sent[3]]) {
    const got = await inbox.deliver(canonicalBytes(item));
    assert.equal(got.status, 202);
    verdicts.push(got.deliveryChain);
  }
  assert.deepEqual(verdicts.slice(0, 2), [null, null], 'an unbroken stream reports nothing');

  const gap = verdicts[2];
  assert.equal(gap.kind, 'delivery_gap');
  assert.equal(gap.expected, 3);
  assert.equal(gap.got, 4);
  // The whole reason the hash is there rather than a bare counter: Mom does not merely suspect a
  // gap, she holds Gran's *signature* over the exact bytes of an item she was never given —
  // checkable by anyone with Gran's identity document, and durable into her export bundle.
  assert.equal(gap.missingHash, documentHash(sent[2]));
  assert.ok(!sent.slice(0, 2).some((i) => documentHash(i) === gap.missingHash));
});

test('the delivery stream is not advanced by an unverified sender (§10.3\'s rule, §10.6\'s store)', async (t) => {
  // The same write-before-verify hazard the dedup store has, and it bites harder here: a forged
  // delivery that advanced this stream would break a real sender's chain for this receiver
  // permanently, and every genuine item after it would report a gap that never happened.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const sender = new Publisher({
    identity: gran.url, signer: gran.signer, feedUrl: `${gran.url}feed.json`, now: () => T0 - 600,
  });
  const first = sender.deliverItem(
    { id: 'urn:uuid:real-1', content_text: 'one', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
    { at: T0 - 500, to: MOM },
  );

  const deliveries = new DeliveryStore();
  const inbox = inboxFor(t, site, { deliveries });

  // A forgery claiming to be Gran, at a delivery far ahead of anything she has sent.
  const forged = { ...first, id: 'urn:uuid:forged', _delivery: { seq: 99 }, _sig: first._sig };
  const rejected = await inbox.deliver(canonicalBytes(forged));
  assert.equal(rejected.status, 401);
  assert.equal(deliveries.bySender.size, 0, 'nothing was recorded for a sender who never verified');

  const accepted = await inbox.deliver(canonicalBytes(first));
  assert.equal(accepted.status, 202);
  assert.equal(accepted.deliveryChain, null, 'the real first delivery is still a first delivery');
});

test('`_delivery` on a published item is ignored, never a stream (§10.6, §11.2)', async (t) => {
  // A published item may be pushed to any number of inboxes, so no single counter could be true
  // of them all. If the store honored one anyway, a pushed reply carrying a stray `_delivery`
  // would advance — or, worse, corrupt — the private pair stream this sender keeps with this
  // receiver, and every later genuine delivery would report a gap that never happened.
  const site = await newSite(t);
  const gran = identityAt(site, 'gran');
  const sender = new Publisher({
    identity: gran.url, signer: gran.signer, feedUrl: `${gran.url}feed.json`,
    manifestUrl: `${gran.url}manifest.json`, title: 'gran', now: () => T0 - 600,
  });

  const dm = sender.deliverItem(
    { id: 'urn:uuid:dm-1', content_text: 'private', _rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] },
    { at: T0 - 500, to: MOM },
  );

  const deliveries = new DeliveryStore();
  // A published item that (in violation of §10.6's MUST NOT) carries a `_delivery` far ahead of
  // the real stream. Hand-shaped rather than produced by `Publisher`, which refuses the shape.
  const published = {
    id: 'urn:uuid:pushed-reply', authors: [{ url: gran.url }],
    _feed_url: `${gran.url}feed.json`, _delivery: { seq: 99 }, content_text: 'public reply',
  };
  assert.equal(deliveries.check(gran.url, published), null, 'no verdict is drawn from it');
  assert.equal(deliveries.record(gran.url, published), null, 'and nothing is recorded');
  assert.equal(deliveries.bySender.size, 0);

  // The real stream is untouched: the genuine first delivery is still seq 1, no gap, no replay.
  assert.equal(deliveries.check(gran.url, dm), null);
  deliveries.record(gran.url, dm);
  assert.deepEqual(deliveries.bySender.get(normalizeIdentityUrl(gran.url)),
    { seq: 1, hash: documentHash(dm) });
});
