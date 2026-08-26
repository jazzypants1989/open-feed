// §11 — the generated views: a JSON Feed 1.1 document, an Atom feed and an h-card page, built from
// the index and the posts, and signed by nobody. Run: node examples/views/views.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signFile, verifyFile, address, signingKeyFromSeed } from '../../src/file.js';
import { signProfile } from '../../src/profile.js';
import { signIndex } from '../../src/index.js';
import { createReader } from '../../src/reader.js';
import { encrypt, carrierOf, readingKeyFromSeed } from '../../src/envelope.js';
import { jsonFeed, atom, hcard } from '../../src/views.js';

// Appendix B's keys, and a seeded stream where §6.4 wants random bytes, so every byte here reproduces.
const key = (l) => signingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const xkey = (l) => readingKeyFromSeed(crypto.createHash('sha256').update(`openfeed/v1/vector:${l}`).digest());
const seeded = (() => { let i = 0; return (n) => Buffer.from(crypto.hkdfSync('sha256', 'openfeed/v1/vector:views', '', String(i++), n)); })();
const alice = key('alice/anchor'), mum = key('mum'), host = key('bro');   // `bro`'s key stands in for the host's own
const AT = 'https://alice.example/alice', NEW = 'https://pence.family/alice';
const indent = (s) => s.trimEnd().split('\n').map((l) => `    ${l}`).join('\n');
const short = (s) => `${s.slice(0, 8)}…`;

// Four posts: two public, one encrypted to mum (§6), one that alice withdraws (§4.2).
const sealed = encrypt({
  content: { text: 'the solicitor rang back' },
  audience: [{ key: alice.x, read: xkey('alice-read').x, loc: AT }, { key: mum.x, read: xkey('mum-read').x, loc: 'https://mom.example/mom' }],
  carrier: carrierOf(alice.x, 3), ephemeral: xkey('ephemeral/3'), random: seeded,
  contentKey: crypto.createHash('sha256').update('openfeed/v1/vector:contentkey/3').digest(),
});
const post = {
  1: signFile({ n: 1, at: '2026-08-01T09:12:00Z', text: 'First day of the holidays.\nThe kids are feral already.' }, alice),
  2: signFile({ n: 2, at: '2026-08-02T20:40:00Z', text: 'Rain. Board games. <b>Not</b> HTML & such.' }, alice),
  3: signFile({ n: 3, at: '2026-08-03T21:15:00Z', encrypted: sealed }, alice),
  4: signFile({ n: 4, at: '2026-08-04T08:00:00Z', text: 'Peonies are back.' }, alice),
};
const profileAt = (version, locations) => signProfile({ anchor: alice.x, version, name: 'Alice', chain: [{ key: alice.x }], recovery: { k: 0, leaves: [] }, locations, read: xkey('alice-read').x }, alice);
const store = new Map([[`${AT}/profile`, profileAt(1, [AT])], ...Object.entries(post).map(([n, f]) => [`${AT}/posts/${n}`, f])]);
const entries = [[1, address(post[1])], [2, address(post[2])], [3, address(post[3])], [4, address(post[4])], [4, null]];
const listing = { entries, version: 2, top: 4 };
store.set(`${AT}/index`, signIndex(listing, alice));
const reader = createReader({ get: async (u) => (store.has(u) ? { bytes: store.get(u), etag: '"t"' } : null) });
const read = await reader.read({ learned: alice.x, at: AT });
assert.equal(read.verdict, 'ok', read.why);

console.log('§11 — a publisher SHOULD write three views, generated from the index and the posts\n');
const written = [['feed.json — JSON Feed 1.1 (application/feed+json)', jsonFeed(read, AT)], ['feed.xml — Atom (application/atom+xml)', atom(read, AT)], ['index.html — an h-card and an h-feed (text/html)', hcard(read, AT)]];
for (const [what, doc] of written) console.log(`  /alice/${what}\n\n${indent(doc)}\n`);
console.log('  They are how this protocol reaches readers that have never heard of it.\n');
const feed = JSON.parse(jsonFeed(read, AT));
assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
assert.deepEqual(feed.items.map((i) => i.id), [`urn:openfeed:${alice.x}:1`, `urn:openfeed:${alice.x}:2`]);
assert.ok(atom(read, AT).includes('<feed xmlns="http://www.w3.org/2005/Atom">'));
assert.ok(hcard(read, AT).includes('class="h-card"') && hcard(read, AT).includes('class="h-feed"'));
assert.ok(atom(read, AT).includes('&lt;b&gt;'), 'a view escapes what it prints; it never trusts it');

// §3.7 — the same identity at a second location. The views are regenerated; only the URLs change.
for (const [k, v] of [...store]) store.set(k.replace(AT, NEW), v);
store.set(`${NEW}/profile`, profileAt(2, [AT, NEW]));
const moved = await reader.read({ learned: alice.x, at: NEW });
const there = JSON.parse(jsonFeed(moved, NEW));
console.log('§11 — item ids are `urn:openfeed:<anchor key>:<n>`, not the URL\n');
console.log(`  anchor key   ${alice.x}`);
console.log(`  at ${AT}`);
for (const i of feed.items) console.log(`    ${i.id}   ${i.url}`);
console.log(`  she moves to ${NEW} (§3.7)`);
for (const i of there.items) console.log(`    ${i.id}   ${i.url}`);
console.log('\n  Same ids, new URLs. A URL id would make every post reappear as unread in every plain\n  feed reader on the day she moved.\n');
assert.equal(moved.verdict, 'ok', moved.why);
assert.deepEqual(there.items.map((i) => i.id), feed.items.map((i) => i.id));
assert.notDeepEqual(there.items.map((i) => i.url), feed.items.map((i) => i.url));
assert.ok(atom(moved, NEW).includes(`<id>urn:openfeed:${alice.x}</id>`));

const docs = [jsonFeed(read, AT), atom(read, AT), hcard(read, AT)];
console.log('§11 — withdrawn posts are absent, encrypted posts are omitted, and no view carries ciphertext\n');
console.log(`  the index lists   1, 2, 3 live and 4 withdrawn (§4.2), top ${listing.top}
  post 3            encrypted (§6) — epk ${short(sealed.epk)}  ${sealed.slots.length} slots  ct ${short(sealed.ct)}
  post 4            "Peonies are back." — withdrawn, so the reader never fetched it
  the three views   items 1 and 2, and nothing else
  any ciphertext?   ${docs.some((d) => d.includes(sealed.ct) || d.includes(sealed.epk))}`);
console.log('\n  §11 allows an empty placeholder item at an encrypted post\'s number instead; src/views.js\n  omits it. Either way the ciphertext stays in the post, where the audience can find it.\n');
assert.ok(!docs.some((d) => d.includes(sealed.ct) || d.includes(sealed.epk) || d.includes(sealed.slots[0][1])));
assert.ok(!docs.some((d) => d.includes(`urn:openfeed:${alice.x}:3`) || d.includes('solicitor')));
assert.ok(!docs.some((d) => d.includes('Peonies') || d.includes(`urn:openfeed:${alice.x}:4`)));
assert.ok(read.posts.has(3) && !read.posts.has(4), 'the reader has the encrypted post and not the withdrawn one');

console.log('§11 — the h-card\'s name is the profile\'s `name`, and the link\'s fragment carries the key\n');
console.log(`  profile name          "${read.name}"  — signed (§3.2), so no hub chooses it
  the h-card link       ${hcard(read, AT).match(/<a class="p-name[^]*?<\/a>/)[0]}
  with no name (§3.2)   falls back to "${hcard({ ...read, name: undefined }, AT).match(/<title>([^<]*)<\/title>/)[1]}", the last segment of the location
  what the server sees  GET /alice/  — a fragment is never sent (RFC 3986 §3.5)`);
console.log('\n  But this page came from the host. A reader that learned the anchor key from a page the\n  host served has learned it from the host, and §3.1 still applies — see first-contact/.\n');
assert.equal(read.name, 'Alice');
assert.ok(hcard(read, AT).includes(`href="${AT}/#${alice.x}"`) && hcard(read, AT).includes('>Alice</a>'));
assert.ok(hcard({ ...read, name: undefined }, AT).includes('<title>alice</title>'));

// The centre: three edits, made to the view and then to the files the view was generated from.
const doctored = JSON.parse(jsonFeed(read, AT));
doctored.items[1].content_text = 'Rain. Board games. Everything is fine.';
doctored.items.push({ id: `urn:openfeed:${alice.x}:5`, url: `${AT}/posts/5`, date_published: '2026-08-05T08:00:00Z', content_text: 'I have moved to his hub — follow me there.' });
store.set(`${AT}/feed.json`, Buffer.from(JSON.stringify(doctored, null, 1)));
const forged = signIndex({ entries: [...entries, [5, address(signFile({ n: 5, text: 'x' }, host))]], version: 3, top: 5 }, host);
const why = async (mutate, restore) => { mutate(); const r = await reader.read({ learned: alice.x, at: AT }); restore(); return `${r.verdict}: ${r.why}`; };
const invented = await why(() => store.set(`${AT}/index`, forged), () => store.set(`${AT}/index`, signIndex(listing, alice)));
const changed = await why(() => store.set(`${AT}/posts/2`, signFile({ n: 2, at: '2026-08-02T20:40:00Z', text: 'Rain. Board games. Everything is fine.' }, alice)), () => store.set(`${AT}/posts/2`, post[2]));
const dropped = await why(() => store.delete(`${AT}/posts/1`), () => store.set(`${AT}/posts/1`, post[1]));
console.log('§11 — nothing in a view is signed, and a view is never the index\n');
console.log('  the host rewrites /alice/feed.json in place: one item invented, one item\'s text changed\n');
console.log(indent(JSON.stringify(doctored.items.slice(1), null, 1)));
console.log(`\n  read as a signed file (§2.1)   ${verifyFile(store.get(`${AT}/feed.json`), alice.x)} — a view has no signature to break`);
console.log(`  the reader's verdict now       ${(await reader.read({ learned: alice.x, at: AT })).verdict} — it never fetched the view\n`);
console.log('  the same three edits, made to the files the view was generated from:\n');
console.log(`    invent a post 5      in the view   accepted — 3 items\n                         in the files  ${invented}
    change post 2's text in the view   accepted — reads fine\n                         in the files  ${changed}
    drop post 1          in the view   accepted — 1 item\n                         in the files  ${dropped}`);
console.log('\n  A view is something a host can regenerate; the index is something only alice\'s key can\n  produce. An implementation MUST NOT treat a view as evidence of anything.\n');
assert.equal(verifyFile(store.get(`${AT}/feed.json`), alice.x), null);
assert.equal((await reader.read({ learned: alice.x, at: AT })).verdict, 'ok');
assert.equal(invented, 'host: the index is not signed by the key the profile ends on');
assert.equal(changed, 'host: post 2 is not what the index lists');
assert.equal(dropped, 'host: post 1 is listed and not served');

// §7 vs a feed reader, over the same origin at the same moment (GOALS.md scenario 7).
store.set(`${AT}/index`, forged);
const stranger = JSON.parse(store.get(`${AT}/feed.json`)).items;
const verdict = await reader.read({ learned: alice.x, at: AT });
console.log('§11 — the stranger\n');
console.log('  a plain feed reader parses the view, and does nothing else:');
for (const i of stranger) console.log(`    ${i.id}  ${i.content_text.split('\n')[0]}`);
console.log(`\n  an Open Feed reader (§7) over the same origin, at the same moment:\n    ${verdict.verdict}: ${verdict.why}`);
console.log(`
  The stranger gets reach and nothing else: no key, no verification, no protocol. He is
  protected against a network attacker (§9 is HTTPS-only) and against nobody else — the host
  he is reading can invent, edit, and unpublish anything on that page. That is what interop
  costs: a second surface the host controls entirely, bought for the reach that is GOALS.md
  priority 3 and scenario 7.\n`);
assert.equal(stranger.length, 3);
assert.equal(stranger[2].content_text, 'I have moved to his hub — follow me there.');
assert.equal(verdict.verdict, 'host');

console.log('Every line above is asserted.');
