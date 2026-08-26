// §11 — generated views: a JSON Feed 1.1 document, an Atom feed, an h-card page, from the index and
// the posts. Nothing in a view is signed and a view is never the index. Ids are
// `urn:openfeed:<anchor>:<n>`; withdrawn posts are absent; encrypted posts are omitted.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `live` is the ok read's `posts` map; `loc` the location (`https://hub/name`). */
function items(read, loc) {
  return [...read.posts.entries()].filter(([, p]) => p.encrypted === undefined && typeof p.text === 'string').sort(([a], [b]) => a - b)
    .map(([n, p]) => ({ n, p, id: `urn:openfeed:${read.anchor}:${n}`, url: `${loc}/posts/${n}`, title: p.text.split('\n')[0].slice(0, 60) }));
}

export function jsonFeed(read, loc) {
  const name = read.name ?? loc.split('/').pop();
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: name, home_page_url: `${loc}/`, feed_url: `${loc}/feed.json`,
    authors: [{ name, url: `${loc}/` }],
    items: items(read, loc).map(({ p, id, url }) => ({ id, url, date_published: p.at, content_text: p.text, ...(p.target?.loc ? { external_url: `${p.target.loc}/posts/${p.target.n}` } : {}) })),
  }, null, 1);
}

export function atom(read, loc) {
  const name = read.name ?? loc.split('/').pop(), list = items(read, loc);
  const updated = list.map(({ p }) => p.at).sort().at(-1) ?? '1970-01-01T00:00:00Z';
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(`urn:openfeed:${read.anchor}`)}</id>
  <title>${esc(name)}</title>
  <updated>${esc(updated)}</updated>
  <link rel="self" href="${esc(`${loc}/feed.xml`)}"/>
  <link rel="alternate" href="${esc(`${loc}/`)}"/>
  <author><name>${esc(name)}</name></author>
${list.map(({ p, id, url, title }) => `  <entry>
    <id>${esc(id)}</id>
    <title>${esc(title)}</title>
    <updated>${esc(p.at)}</updated>
    <link rel="alternate" href="${esc(url)}"/>
    <content type="text">${esc(p.text)}</content>
  </entry>`).join('\n')}
</feed>
`;
}

/** The h-card: the profile's name, and the link with the anchor key in its fragment (§3.1). */
export function hcard(read, loc) {
  const name = read.name ?? loc.split('/').pop();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(name)}</title>
<link rel="alternate" type="application/feed+json" href="${esc(`${loc}/feed.json`)}">
<link rel="alternate" type="application/atom+xml" href="${esc(`${loc}/feed.xml`)}"></head>
<body><div class="h-card"><a class="p-name u-url" href="${esc(`${loc}/#${read.anchor}`)}">${esc(name)}</a></div>
<ul class="h-feed">
${items(read, loc).map(({ p, url }) => `<li class="h-entry"><a class="u-url" href="${esc(url)}"><time class="dt-published" datetime="${esc(p.at)}">${esc(p.at)}</time></a> <span class="e-content">${esc(p.text)}</span></li>`).join('\n')}
</ul></body></html>
`;
}
