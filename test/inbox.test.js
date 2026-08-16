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
  splitTarget,
  renderable,
  publishable,
  canonicalBytes,
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
