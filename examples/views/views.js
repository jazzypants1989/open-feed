// §10 — views: JSON Feed, Atom and an h-card generated from the index and the posts; media types.
// Run: node examples/views/views.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rule } from '../../tools/rule.js';
import { signFile, verifyFile, address, signingKeyFromSeed } from '../../src/file.js';
import { signProfile } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createReader } from '../../src/reader.js';
import { createHub } from '../../src/hub.js';
import { encrypt, postBinding, readingKeyFromSeed } from '../../src/envelope.js';
import { jsonFeed, atom, hcard, webfinger } from '../../src/views.js';

const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const xkey = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const seeded = (() => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', 'openfeed/v1/vector:views', '', String(i++), n)); })();
const alice = key('alice/anchor'), mum = key('mum'), host = key('bro');
const AT = 'https://alice.example/alice', NEW = 'https://pence.family/alice';

const sealed = encrypt({ content: { text: 'the solicitor rang back' }, audience: [{ key: alice.x, read: xkey('alice-read').x, location: AT }, { key: mum.x, read: xkey('mum-read').x, location: 'https://mom.example/mom' }],
  binding: postBinding(alice.x, 3), ephemeral: xkey('ephemeral/3'), random: seeded, contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/3').digest() });
const post = {
  1: signFile({ number: 1, at: '2026-08-01T09:12:00Z', text: 'First day of the holidays.\nThe kids are feral already.' }, alice),
  2: signFile({ number: 2, at: '2026-08-02T20:40:00Z', text: 'Rain. Board games. <b>Not</b> HTML & such.' }, alice),
  3: signFile({ number: 3, at: '2026-08-03T21:15:00Z', encrypted: sealed }, alice),
  4: signFile({ number: 4, at: '2026-08-04T08:00:00Z', text: 'Peonies are back.' }, alice),
};
const profileAt = (version, locations) => signProfile({ anchor: alice.x, version, name: 'Alice', chain: [{ key: alice.x }], recovery: { leaves: [] }, locations, read: xkey('alice-read').x }, alice);
const store = new Map([[`${AT}/profile`, profileAt(1, [AT])], ...Object.entries(post).map(([number, f]) => [`${AT}/posts/${number}`, f])]);
const entries = [[1, address(post[1])], [2, address(post[2])], [3, address(post[3])], [4, address(post[4])], [4, null]];
store.set(`${AT}/index`, signIndex({ entries, version: 2, highest: 4 }, alice));
const reader = createReader({ get: async (u) => (store.has(u) ? { bytes: store.get(u), etag: '"t"', type: 'text/plain' } : null) });   // a media type the reader never looks at
const read = await reader.read({ learned: alice.x, at: AT });
assert.equal(read.verdict, 'ok', read.why);

const feed = JSON.parse(jsonFeed(read, AT)), docs = [jsonFeed(read, AT), atom(read, AT), hcard(read, AT)];
console.log('§10 — three views from one read\n');
console.log(`  feed.json  ${feed.items.length} items, ids ${feed.items.map((i) => i.id.replace(alice.x, '<anchor>')).join(', ')}`);
console.log(`  feed.xml   <feed>, id urn:openfeed:<anchor>\n  index.html an h-card named "${read.name}" and an h-feed\n`);
assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
assert.deepEqual(feed.items.map((i) => i.id), [`urn:openfeed:${alice.x}:1`, `urn:openfeed:${alice.x}:2`]);
assert.ok(atom(read, AT).includes('<feed xmlns="http://www.w3.org/2005/Atom">') && atom(read, AT).includes(`<id>urn:openfeed:${alice.x}</id>`));
assert.ok(hcard(read, AT).includes('class="h-card"') && hcard(read, AT).includes('>Alice</a>'));
// Same ids at a new location.
for (const [k, v] of [...store]) store.set(k.replace(AT, NEW), v);
store.set(`${NEW}/profile`, profileAt(2, [AT, NEW]));
const there = JSON.parse(jsonFeed(await reader.read({ learned: alice.x, at: NEW }), NEW));
assert.deepEqual(there.items.map((i) => i.id), feed.items.map((i) => i.id));
assert.notDeepEqual(there.items.map((i) => i.url), feed.items.map((i) => i.url));
// Withdrawn absent, encrypted omitted, no ciphertext.
assert.ok(read.posts.has(3) && !read.posts.has(4));
assert.ok(!docs.some((d) => d.includes(sealed.ciphertext) || d.includes(sealed.ephemeral) || d.includes(sealed.slots[0][1]) || d.includes('solicitor') || d.includes('Peonies')));
// A view is not evidence: the host rewrites feed.json and the reader never notices; the same edits to the files are caught.
const doctored = JSON.parse(jsonFeed(read, AT));
doctored.items.push({ id: `urn:openfeed:${alice.x}:5`, url: `${AT}/posts/5`, date_published: '2026-08-05T08:00:00Z', content_text: 'I have moved to his hub — follow me there.' });
store.set(`${AT}/feed.json`, Buffer.from(JSON.stringify(doctored)));
assert.equal(verifyFile(store.get(`${AT}/feed.json`), alice.x), null);
assert.equal((await reader.read({ learned: alice.x, at: AT })).verdict, 'ok');
store.set(`${AT}/index`, signIndex({ entries: [...entries, [5, address(signFile({ number: 5, text: 'x' }, host))]], version: 3, highest: 5 }, host));
assert.equal((await reader.read({ learned: alice.x, at: AT })).verdict, 'tampered');
console.log('  the host invents an item in feed.json: the reader never fetched it; the same edit to the index: host\n');
rule('10', `A publisher SHOULD write a JSON Feed 1.1 document, an Atom feed, and an h-card page, generated from the
index and the posts, at \`/<name>/feed.json\`, \`/<name>/feed.xml\`, and \`/<name>/index.html\`; a hub MAY generate
them itself. A view is unsigned, and a reader MUST NOT treat one as evidence of anything. Item ids
are \`urn:openfeed:<anchor key>:<number>\` and the feed's id is \`urn:openfeed:<anchor key>\`. Withdrawn posts are
absent. Encrypted posts are omitted or rendered as an empty placeholder item at their number; a view MUST
NOT carry ciphertext. The h-card's name is the profile's \`name\`.`);

// WebFinger: acct:alice@alice.example → the profile and the h-card.
const wf = JSON.parse(webfinger('alice', AT));
assert.equal(wf.subject, 'acct:alice@alice.example');
assert.ok(wf.links.some((l) => l.rel === 'self' && l.type === 'application/openfeed+json' && l.href === `${AT}/profile`));
assert.ok(wf.links.some((l) => l.rel === 'http://webfinger.net/rel/profile-page' && l.href === `${AT}/index.html`));
// A hub with an origin serves WebFinger for names it holds.
const hub = createHub({ origin: 'https://alice.example' });
hub.store.set('alice/profile', profileAt(1, [AT]));
const wfr = hub.handle({ method: 'GET', path: '/.well-known/webfinger', query: 'resource=acct:alice@alice.example' });
assert.equal(wfr.status, 200);
assert.equal(wfr.headers['content-type'], 'application/jrd+json');
assert.equal(JSON.parse(wfr.body).subject, 'acct:alice@alice.example');
assert.equal(hub.handle({ method: 'GET', path: '/.well-known/webfinger', query: 'resource=acct:nobody@alice.example' }).status, 404);
console.log('  WebFinger: acct:alice@alice.example → profile (application/openfeed+json) and h-card (text/html)\n');
rule('10', `A hub SHOULD serve a WebFinger response (RFC 7033) at \`/.well-known/webfinger\` for each name it holds, linking the profile (\`application/openfeed+json\`) and the h-card page.`);

// <link rel="alternate">: the h-card links to the feeds, and the WebFinger response links to them too.
const card = hcard(read, AT);
assert.ok(card.includes('rel="alternate" type="application/feed+json"'));
assert.ok(card.includes('rel="alternate" type="application/atom+xml"'));
assert.ok(wf.links.some((l) => l.rel === 'alternate' && l.type === 'application/feed+json'));
assert.ok(wf.links.some((l) => l.rel === 'alternate' && l.type === 'application/atom+xml'));
rule('10', `The h-card page SHOULD include \`<link rel="alternate">\` entries pointing to the JSON Feed and Atom views. The WebFinger response SHOULD include matching \`alternate\` links.`);

// Media types, as the hub serves them; the reader above read everything as text/plain.
hub.store.set('alice/index', store.get(`${AT}/index`)); hub.store.set('alice/posts/1', post[1]);
hub.store.set('alice/feed.json', Buffer.from('{}')); hub.store.set('alice/feed.xml', Buffer.from('<feed/>')); hub.store.set('alice/index.html', Buffer.from('<html/>')); hub.store.set('alice/media/' + 'a'.repeat(43), Buffer.from('bytes'));
const typeOf = (p) => hub.handle({ method: 'GET', path: p }).headers['content-type'];
const types = { '/alice/profile': 'application/openfeed+json', '/alice/index': 'application/openfeed+json', '/alice/posts/1': 'application/openfeed+json', '/alice/feed.json': 'application/feed+json', '/alice/feed.xml': 'application/atom+xml', '/alice/index.html': 'text/html; charset=utf-8', ['/alice/media/' + 'a'.repeat(43)]: 'application/octet-stream' };
for (const [p, t] of Object.entries(types)) assert.equal(typeOf(p), t, p);
console.log('  the hub serves application/openfeed+json, application/feed+json, application/atom+xml, text/html; the reader read them as text/plain\n');
rule('10', `| kind | media type |
|---|---|
| profile, index, post | \`application/openfeed+json\` |
| JSON Feed view | \`application/feed+json\` |
| Atom view | \`application/atom+xml\` |
| h-card page | \`text/html\` |
| media | whatever the bytes are |

A reader MUST NOT reject a signed file for its declared media type.`);
