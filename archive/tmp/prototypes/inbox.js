// Gate for tmp/prototypes/inbox.md — §10.2's order, §10.3's write rule, §3.4's dedup, run against the shipped inbox.
import crypto from 'node:crypto';
import { sign, createInbox, DedupStore, normalizeIdentityUrl, FetchError } from '../../src/index.js';

const T0 = 1739577600;
const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const MOM = 'https://mom.pence.family/';
const MOM_FEED = `${MOM}feed.json`;
const MY_ITEM = 'urn:uuid:550e8400-cookies';

function makeIdentity(url, kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  const jwk = { crv: 'Ed25519', iat: T0 - 86400 * 30, kid, kty: 'OKP', x };
  const doc = { url, keys: [jwk], name: kid, seq: 1, updated: T0 - 86400 * 30 };
  doc._sig = sign(doc, privateKey, `${url}#${kid}`, { kind: 'identity' });
  return { url, kid, privateKey, document: doc };
}

// `_openfeed` MERGED, never replaced — replacing drops `version` and every item fails step 2 as missing_field.
function signItem(identity, { _openfeed, ...fields } = {}) {
  const item = {
    authors: [{ url: identity.url }],
    content_text: 'hello',
    date_published: iso(T0 - 3600),
    ...fields,
    _openfeed: { version: 1, ..._openfeed },
  };
  item._sig = sign(item, identity.privateKey, `${identity.url}#${identity.kid}`, { kind: 'item' });
  return item;
}

const gran = makeIdentity('https://gran.example/', 'gran-1');
const dad = makeIdentity('https://dad.example/', 'dad-1');
const granNew = makeIdentity('https://gran.new/', 'gran-new-1');
const web = new Map([gran, dad, granNew].map((i) => [normalizeIdentityUrl(i.url), i.document]));

// The fetch stubbed to a lookup: §13.5 is tested elsewhere; WHEN the fetch happens is tested here.
const fetcher = () => ({
  async fetchIdentityDocument(url) {
    const doc = web.get(normalizeIdentityUrl(url));
    if (!doc) throw new FetchError(`no identity at ${url}`, { url });
    return { doc };
  },
});

const opts = (extra = {}) => ({
  owner: MOM, feedUrls: [MOM_FEED], ownsItem: (id) => id === MY_ITEM,
  fetcher: fetcher(), now: () => T0, ...extra,
});
const relToMom = { rel: [{ type: 'reply', to: `${MOM_FEED}#${MY_ITEM}` }] };

// ---- §10.2's order, observed by fetch position rather than status codes ----
const inbox1 = createInbox(opts());
const reply = signItem(gran, { id: 'urn:uuid:aaaa-0001', _openfeed: relToMom });
const r1 = await inbox1.deliver(JSON.stringify(reply));
const forged = { ...signItem(dad, { id: 'urn:uuid:dddd-0666', _openfeed: relToMom }), _sig: reply._sig };
const r2 = await inbox1.deliver(JSON.stringify(forged));
const junk = await inbox1.deliver(JSON.stringify(signItem(dad, {
  id: 'urn:uuid:dddd-0667',
  _openfeed: { rel: [{ type: 'reply', to: 'https://elsewhere.example/feed.json#x' }] },
})));

// ---- §10.3's write-before-verify rule, run both ways ----
const POISON_ID = 'urn:uuid:dddd-0001';
const runs = {};
for (const writeBeforeVerify of [true, false]) {
  const victim = createInbox(opts());
  const poison = {
    id: POISON_ID, authors: [{ url: dad.url }], content_text: 'not from Dad',
    date_published: iso(T0 - 60), _openfeed: { version: 999999, ...relToMom }, _sig: reply._sig,
  };
  const poisoned = await victim.deliver(JSON.stringify(poison));
  // The one line §10.3 forbids: the attacker-claimed pair recorded before verification.
  if (writeBeforeVerify) victim.dedup.write(normalizeIdentityUrl(dad.url), POISON_ID, 999999);
  const genuine = await victim.deliver(JSON.stringify(signItem(dad, { id: POISON_ID, _openfeed: relToMom })));
  runs[String(writeBeforeVerify)] = { poisoned, genuine };
}

// ---- relevance: C1's id-half match, and §8.1's root entry ----
const OLD_FEED = 'https://mom.hub.example/feed.json';
const toOldFeed = signItem(gran, {
  id: 'urn:uuid:aaaa-0003',
  _openfeed: { rel: [{ type: 'reply', to: `${OLD_FEED}#${MY_ITEM}` }] },
});
const c1a = await createInbox(opts()).deliver(JSON.stringify(toOldFeed));
const c1b = await createInbox(opts({ ownsItem: () => false })).deliver(JSON.stringify(toOldFeed));

const threadHost = createInbox(opts());
const nestedTo = { type: 'reply', to: `${gran.url}feed.json#urn:uuid:aaaa-0001` };
const n1 = await threadHost.deliver(JSON.stringify(signItem(dad, {
  id: 'urn:uuid:dddd-0002', _openfeed: { rel: [nestedTo] },
})));
const n2 = await threadHost.deliver(JSON.stringify(signItem(dad, {
  id: 'urn:uuid:dddd-0003',
  _openfeed: { rel: [nestedTo, { type: 'root', to: `${MOM_FEED}#${MY_ITEM}` }] },
})));

// ---- dedup across a §3.4 migration: a delivered-only note retracted after the author's exit ----
const PRIVATE = 'urn:uuid:aaaa-private';
async function migrationScene(equivalent) {
  const inbox = createInbox(opts({ dedup: new DedupStore(equivalent ? { equivalent } : {}) }));
  await inbox.deliver(JSON.stringify(signItem(gran, {
    id: PRIVATE, _openfeed: { rel: [{ type: 'mention', to: MOM }] },
  })));
  const retraction = signItem(granNew, {
    id: PRIVATE, content_text: '', date_modified: iso(T0 - 60),
    _openfeed: { version: 2, deleted: true, rel: [{ type: 'mention', to: MOM }] },
  });
  const retracted = await inbox.deliver(JSON.stringify(retraction));
  return { retracted, holders: inbox.dedup.byId.get(PRIVATE) };
}
const GRAN_PAIR = new Set([normalizeIdentityUrl(gran.url), normalizeIdentityUrl(granNew.url)]);
const naive = await migrationScene(null);
const aware = await migrationScene((a, b) => GRAN_PAIR.has(a) && GRAN_PAIR.has(b));

// ---- §10.4's existence oracle, no key needed ----
const probed = createInbox(opts());
await probed.deliver(JSON.stringify(signItem(dad, { id: 'urn:uuid:dddd-known', _openfeed: relToMom })));
const probe = (id) => JSON.stringify({
  id, authors: [{ url: dad.url }], content_text: '', date_published: iso(T0 - 3600),
  date_modified: iso(T0 - 60), _openfeed: { version: 2, deleted: true }, _sig: reply._sig,
});
const known = await probed.deliver(probe('urn:uuid:dddd-known'));
const unknown = await probed.deliver(probe('urn:uuid:dddd-guessed'));

const gate = [
  ['a relevant delivery is accepted and costs exactly one outbound fetch',
    r1.status === 202 && r1.fetches === 1],
  ['no outbound fetch happens before step 7 (§10.2 numbering is normative)',
    r1.fetchesBeforeVerify === 0 && r2.fetchesBeforeVerify === 0],
  ['a forged signature is refused and still costs exactly one fetch, no more',
    r2.status === 401 && r2.fetches === 1],
  ['an irrelevant sender is refused for zero outbound fetches (§13.9)',
    junk.status === 400 && junk.fetches === 0],
  ['§10.3: the forgery is rejected whichever order the store is written in',
    runs.true.poisoned.status === 401 && runs.false.poisoned.status === 401],
  ["§10.3: write-before-verify alone denies the victim's own later revisions",
    runs.true.genuine.status === 409 && runs.false.genuine.status === 202],
  ['C1: an id-half match reaches an inbox a feed-URL match cannot',
    c1a.status === 202 && c1b.status === 400],
  ['§8.1: a nested reply reaches the thread host only via a `root` entry',
    n1.status === 400 && n2.status === 202],
  ["§3.4: without equivalence a post-migration retraction files as a stranger's new item, collision named",
    naive.retracted.status === 202 && naive.holders.size === 2 && naive.retracted.collision !== null],
  ["§3.4: with the `equivalent` predicate the retraction retires the predecessor's delivery",
    aware.retracted.status === 202 && aware.holders.size === 1
      && aware.holders.get(normalizeIdentityUrl(gran.url)) === 2],
  ['§10.4: a stored pair is distinguishable from an unstored one with no key at all',
    known.status === 401 && unknown.status === 400],
];

const failed = gate.filter(([, ok]) => !ok);
for (const [what, ok] of gate) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);
if (failed.length) process.exit(1);
console.log('inbox: all claims hold');
