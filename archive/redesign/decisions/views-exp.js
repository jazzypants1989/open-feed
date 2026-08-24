// Experiment — the generated views (HANDOFF-final-review.md §2.G; GOALS priority 3, scenario 7;
// ruling 4). From the head and the posts, produce the three interop surfaces the old README
// promised — a JSON Feed 1.1 document, an Atom feed, an h-card page — and consume each with an
// independent consumer written here, with no library. Then check what the rulings say about them:
// nothing in a view is signed; the feed is never the head; a withdrawn post is absent; and what a
// sealed post becomes in a public feed. The publisher is weekend-publisher.js, unchanged; the
// verifier that catches what the feed cannot is weekend-reader.js, unchanged.
//
//   node tmp/redesign/decisions/views-exp.js
import crypto from 'node:crypto';
import * as pub from '../gates/weekend-publisher.js';
import { read } from '../gates/weekend-reader.js';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const body = (f) => JSON.parse(f.subarray(0, f.lastIndexOf(0x0a)).toString('utf8'));

// ---- an identity, three public posts, one sealed, one withdrawn ----
const A = pub.newKey(), NAME = 'alice', LOC = 'https://alice.example';
const profile = pub.profile({ genesis: A.x, pseq: 1, chain: [{ key: A.x }], recovery: { k: 1, leaves: [] }, locations: [LOC], read: 'x25519-placeholder' }, A);
const posts = new Map([
  [1, pub.post(1, { at: '2026-08-01T09:00:00Z', text: 'First day of the holidays.\nThe kids are feral already.' }, A)],
  [2, pub.post(2, { at: '2026-08-02T10:00:00Z', text: 'Rain. Board games. <b>Not</b> HTML, just text with an angle bracket & an ampersand.' }, A)],
  [3, pub.post(3, { at: '2026-08-03T11:00:00Z', text: 'This one gets withdrawn.' }, A)],
  [4, pub.post(4, { at: '2026-08-04T12:00:00Z', sealed: { to: 3, ct: 'base64url-ciphertext…' } }, A)],   // no text: sealed
  [5, pub.post(5, { at: '2026-08-05T13:00:00Z', text: 'Back home.', rel: 'reply', target: { key: 'k', n: 9, hash: 'h', at: 'https://mom.example/mom' } }, A)],
]);
const E = (n) => [n, pub.address(posts.get(n))];
const head = pub.head({ entries: [E(1), E(2), E(3), E(4), E(5), [3, null]], hseq: 6, top: 5 }, A);
const files = new Map([[`/${NAME}/profile`, profile], [`/${NAME}/head`, head], ...[...posts].map(([n, f]) => [`/${NAME}/posts/${n}`, f])]);

// ---- the views, generated from the head and the posts (the live set, in number order) ----
const live = () => {
  const m = new Map();
  for (const [n, h] of body(head).entries) h === null ? m.delete(n) : m.set(n, h);
  return [...m.keys()].sort((a, b) => a - b).map((n) => ({ n, ...body(posts.get(n)) }));
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const url = (n) => `${LOC}/${NAME}/posts/${n}`;
// The id: genesis key + number. Not the URL — a URL id makes every post reappear as unread in every
// plain reader the day the author relocates, and the number is what the head and every reply name.
const id = (p) => `urn:openfeed:${A.x}:${p.n}`;
const title = (p) => (p.text ?? '').split('\n')[0].slice(0, 60);

const jsonFeed = ({ sealedAs = 'omit' } = {}) => JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: NAME,
  home_page_url: `${LOC}/${NAME}/`,
  feed_url: `${LOC}/${NAME}/feed.json`,
  authors: [{ name: NAME, url: `${LOC}/${NAME}/` }],
  items: live().flatMap((p) => {
    if (p.text === undefined) return sealedAs === 'omit' ? [] : [{ id: id(p), url: url(p.n), date_published: p.at, content_text: '' }];
    return [{ id: id(p), url: url(p.n), date_published: p.at, content_text: p.text, ...(p.target ? { external_url: p.target.at } : {}) }];
  }),
}, null, 1);

const atom = () => {
  const items = live().filter((p) => p.text !== undefined);
  const updated = items.map((p) => p.at).sort().at(-1) ?? '1970-01-01T00:00:00Z';
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(`urn:openfeed:${A.x}`)}</id>
  <title>${esc(NAME)}</title>
  <updated>${updated}</updated>
  <link rel="self" href="${esc(`${LOC}/${NAME}/atom.xml`)}"/>
  <link rel="alternate" href="${esc(`${LOC}/${NAME}/`)}"/>
  <author><name>${esc(NAME)}</name></author>
${items.map((p) => `  <entry>
    <id>${esc(id(p))}</id>
    <title>${esc(title(p))}</title>
    <updated>${p.at}</updated>
    <link rel="alternate" href="${esc(url(p.n))}"/>
    <content type="text">${esc(p.text)}</content>
  </entry>`).join('\n')}
</feed>
`;
};

// The h-card. The profile has no display name, so the name is the path segment. The genesis key
// rides in the fragment of the u-url link — a fragment never reaches the server, and a link with it
// is exactly what ruling 1 means by "a link carries the key". The page is served by the host, so a
// reader that learned the key FROM this page learned it from the host (firstcontact-exp.js).
const hcard = () => {
  const p = body(profile);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(NAME)}</title>
<link rel="alternate" type="application/feed+json" href="${esc(`${LOC}/${NAME}/feed.json`)}">
<link rel="alternate" type="application/atom+xml" href="${esc(`${LOC}/${NAME}/atom.xml`)}">
</head><body>
<div class="h-card">
  <a class="p-name u-url" href="${esc(`${p.locations[0]}/${NAME}/#k=${p.genesis}`)}">${esc(NAME)}</a>
${p.locations.slice(1).map((l) => `  <a class="u-url" href="${esc(`${l}/${NAME}/`)}">${esc(l)}</a>`).join('\n')}
</div>
</body></html>
`;
};

// ---- three independent consumers ----
// JSON Feed 1.1: what the spec requires of a document and an item.
function consumeJsonFeed(text) {
  const f = JSON.parse(text), why = [];
  if (f.version !== 'https://jsonfeed.org/version/1.1') why.push('version');
  if (typeof f.title !== 'string') why.push('title');
  if (!Array.isArray(f.items)) why.push('items');
  for (const it of f.items ?? []) {
    if (typeof it.id !== 'string' || !it.id) why.push(`item id`);
    if (typeof it.content_text !== 'string' && typeof it.content_html !== 'string') why.push(`item ${it.id}: no content`);
  }
  return { ok: why.length === 0, why, items: f.items ?? [] };
}
// Atom: a 20-line tag tokenizer (Node has no XML parser), balance check, then required paths.
function consumeAtom(text) {
  const toks = [...text.matchAll(/<\?[^>]*\?>|<!--[\s\S]*?-->|<\/([\w:]+)\s*>|<([\w:]+)(\s[^>]*?)?(\/?)>|([^<]+)/g)];
  const stack = [], paths = new Map(), why = [];
  for (const t of toks) {
    if (t[1]) { if (stack.pop() !== t[1]) why.push(`unbalanced </${t[1]}>`); }
    else if (t[2]) {
      const path = [...stack, t[2]].join('/');
      paths.set(path, (paths.get(path) ?? 0) + 1);
      if (!t[4]) stack.push(t[2]);
    } else if (t[5] && /[<>]|&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(t[5])) why.push('unescaped text');
  }
  if (stack.length) why.push(`unclosed <${stack.join(',')}>`);
  const entries = paths.get('feed/entry') ?? 0;
  for (const p of ['feed/id', 'feed/title', 'feed/updated']) if (paths.get(p) !== 1) why.push(`missing ${p}`);
  for (const p of ['feed/entry/id', 'feed/entry/title', 'feed/entry/updated']) if ((paths.get(p) ?? 0) !== entries) why.push(`an entry lacks ${p.split('/')[2]}`);
  return { ok: why.length === 0, why, entries };
}
// h-card: the classes IndieWeb tooling looks for.
function consumeHcard(html) {
  const why = [];
  for (const c of ['h-card', 'p-name', 'u-url']) if (!new RegExp(`class="[^"]*\\b${c}\\b[^"]*"`).test(html)) why.push(`no .${c}`);
  const href = /class="[^"]*u-url[^"]*" href="([^"]+)"/.exec(html)?.[1] ?? '';
  const key = /#k=([A-Za-z0-9_-]{43})$/.exec(href)?.[1] ?? null;
  return { ok: why.length === 0, why, href, key };
}

// ---- the runs ----
const jf = jsonFeed(), jf2 = jsonFeed(), at = atom(), hc = hcard();
const cj = consumeJsonFeed(jf), ca = consumeAtom(at), ch = consumeHcard(hc);
const idsStable = consumeJsonFeed(jf2).items.map((i) => i.id).join() === cj.items.map((i) => i.id).join();

// 1. nothing in any view is signed: no 86-character base64url run, no member named like a signature
const SIG = /[A-Za-z0-9_-]{86}/;
const sigNamed = /"(sig|signature|_sig|jws|proof)"\s*:/;
const unsigned = [jf, at, hc].every((v) => !SIG.test(v) && !sigNamed.test(v));

// 2. the feed is never the head. The host changes one post's text in the feed view; the JSON Feed
// consumer is happy and has nothing to compare it against. The same host serving a changed post
// file is caught by the unchanged reader, because the head names the post's address.
const tampered = jf.replace('Back home.', 'Back home. (The host added this.)');
const tamperedOK = consumeJsonFeed(tampered).ok;
const swapped = new Map(files);
swapped.set(`/${NAME}/posts/5`, pub.post(5, { at: '2026-08-05T13:00:00Z', text: 'Back home. (The host added this.)' }, A));
const get = (m) => async (p) => m.get(p) ?? null;
const honest = await read(get(files), { learned: A.x, at: `/${NAME}` });
const caught = await read(get(swapped), { learned: A.x, at: `/${NAME}` });
// and a reader holding only the feed cannot tell which of two feeds is the real one:
const feedHashA = sha256(jf), feedHashB = sha256(tampered);

// 3. the withdrawn post is absent from every view
const withdrawnAbsent = ![jf, at].some((v) => v.includes('This one gets withdrawn.')) && !cj.items.some((i) => i.id.endsWith(':3')) && ca.entries === 3;

// 4. the sealed post, both ways
const placeholder = consumeJsonFeed(jsonFeed({ sealedAs: 'placeholder' }));
const sealedOmitted = !cj.items.some((i) => i.id.endsWith(':4')) && !jf.includes('ct');
const sealedPlaceholder = placeholder.ok && placeholder.items.some((i) => i.id.endsWith(':4') && i.content_text === '');
const leaksCiphertext = jsonFeed({ sealedAs: 'placeholder' }).includes('base64url-ciphertext');

console.log(`
  JSON Feed item:   ${JSON.stringify(cj.items[0])}
  Atom entry:       ${at.split('\n').filter((l) => /<entry>|<id>|<title>|<updated>|<\/entry>/.test(l)).slice(0, 5).map((l) => l.trim()).join(' ')}
  h-card:           ${hc.split('\n').find((l) => l.includes('p-name')).trim()}

  sizes: JSON Feed ${jf.length} B, Atom ${at.length} B, h-card ${hc.length} B — from a head of ${head.length} B and ${[...posts.values()].reduce((s, f) => s + f.length, 0)} B of posts
  consumers: JSON Feed ${cj.ok ? 'ok' : cj.why.join('; ')} (${cj.items.length} items) · Atom ${ca.ok ? 'ok' : ca.why.join('; ')} (${ca.entries} entries) · h-card ${ch.ok ? 'ok' : ch.why.join('; ')} (key in the link: ${ch.key === A.x ? 'yes' : 'no'})

  the host edits one post's text inside the feed view: the JSON Feed consumer says ${tamperedOK ? 'ok' : 'bad'};
  the same edit served as the post file: the unchanged reader says "${caught.verdict}: ${caught.why}" (honest read: ${honest.verdict})
  the real feed hashes to ${feedHashA.slice(0, 12)}… and the edited one to ${feedHashB.slice(0, 12)}…, and nothing anywhere says which is hers

  the sealed post: omitted — ${sealedOmitted ? 'absent, ciphertext absent' : 'PRESENT'}; as a placeholder — ${sealedPlaceholder ? 'an empty item at its number' : 'not staged'}${leaksCiphertext ? ', AND THE CIPHERTEXT LEAKED' : ''}
`);

const claims = [
  ['a plain JSON Feed 1.1 consumer accepts the feed view with every required field present', cj.ok && cj.items.length === 3],
  ['a naive Atom consumer finds the feed well-formed with every required element present', ca.ok],
  ['the h-card carries the classes IndieWeb tooling reads, and the link carries the genesis key', ch.ok && ch.key === A.x],
  ['item ids are stable across regenerations', idsStable],
  ['nothing in any view is signed — no signature line, no member named like one', unsigned],
  ['the feed view is never the head: a post edited inside the feed passes the feed consumer, and the same edit served as the file is caught by the unchanged reader',
    tamperedOK && honest.verdict === 'ok' && caught.verdict === 'host'],
  ['a withdrawn post is absent from every view', withdrawnAbsent],
  ['a sealed post can be omitted from the public feed, and a placeholder is also a valid item — neither leaks the ciphertext', sealedOmitted && sealedPlaceholder && !leaksCiphertext],
];
for (const [what, ok] of claims) console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${what}`);

console.log(`
  Reading.

  1. The views are a ${jf.length + at.length + hc.length}-byte projection of the live set and the profile, and three consumers
     that know nothing about Open Feed accept them. GOALS priority 3's "our content reaches existing
     feed readers with nothing built" holds with a publisher that writes three more files. What
     survives of the old README's interop section: the Atom-plus-h-card route into the fediverse
     through a third-party bridge, and POSSE, both of which only ever needed these views. What does
     not: "a JSON Feed 1.1 document with signed items" — the feed is no longer the signed object, so
     a plain reader consuming it gets a copy and never a verdict, which ruling 4 says out loud.

  2. The id. Recommend ${JSON.stringify(id({ n: 7 })).replace(A.x, '<genesis>')}: the number is what the head and every reply
     already name, and a URL id would make every post reappear as unread in every plain reader the
     day the author relocates, which GOALS scenario 4 says must change nobody's identity. The URL
     goes in \`url\`, where a reader expects to click it.

  3. The sealed post. Recommend omitting it. The head already publishes that number ${4} exists, so a
     placeholder hides nothing from anyone who reads the head — but a plain feed reader never reads
     the head, and an empty item in a stranger's feed is a prompt to ask what it was. Omit, and let
     the views be the public half only.

  4. One thing the profile is missing for this: a display name. The h-card's p-name above is the
     path segment. "Apps show a name and an address" (GOALS) needs the name to come from somewhere
     signed, or every hub decides what Alice is called. One optional field, or the path — a ruling.
`);
if (claims.some(([, ok]) => !ok)) process.exit(1);
