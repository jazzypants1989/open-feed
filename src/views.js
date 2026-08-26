// §10 — generated views: a JSON Feed 1.1 document, an Atom feed, an h-card page, from the index and
// the posts; and a WebFinger JRD for discoverability. Nothing in a view is signed and a view is
// never the index. Ids are `urn:openfeed:<anchor>:<number>`; withdrawn posts are absent; encrypted posts
// are omitted. A post with media and no text is a post (§4.3), and it is listed.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `live` is the ok read's `posts` map; `location` the location (`https://hub/name`). */
function items(read, location) {
  return [...read.posts.entries()].filter(([, p]) => p.encrypted === undefined).sort(([a], [b]) => a - b)
    .map(([number, p]) => ({ number, p, id: `urn:openfeed:${read.anchor}:${number}`, url: `${location}/posts/${number}`, title: (p.text ?? '').split('\n')[0].slice(0, 60) }));
}

export function jsonFeed(read, location) {
  const name = read.name ?? location.split('/').pop();
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: name, home_page_url: `${location}/`, feed_url: `${location}/feed.json`,
    authors: [{ name, url: `${location}/` }],
    items: items(read, location).map(({ p, id, url }) => ({ id, url, date_published: p.at, content_text: p.text ?? '', ...(p.target?.location ? { external_url: `${p.target.location}/posts/${p.target.number}` } : {}) })),
  }, null, 1);
}

export function atom(read, location) {
  const name = read.name ?? location.split('/').pop(), list = items(read, location);
  const updated = list.map(({ p }) => p.at).sort().at(-1) ?? '1970-01-01T00:00:00Z';
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${esc(`urn:openfeed:${read.anchor}`)}</id>
  <title>${esc(name)}</title>
  <updated>${esc(updated)}</updated>
  <link rel="self" href="${esc(`${location}/feed.xml`)}"/>
  <link rel="alternate" href="${esc(`${location}/`)}"/>
  <author><name>${esc(name)}</name></author>
${list.map(({ p, id, url, title }) => `  <entry>
    <id>${esc(id)}</id>
    <title>${esc(title)}</title>
    <updated>${esc(p.at)}</updated>
    <link rel="alternate" href="${esc(url)}"/>
    <content type="text">${esc(p.text ?? '')}</content>
  </entry>`).join('\n')}
</feed>
`;
}

/** WebFinger JRD (RFC 7033): `acct:name@domain` → the profile and the h-card page. */
export function webfinger(name, location) {
  const domain = new URL(location).host;
  return JSON.stringify({
    subject: `acct:${name}@${domain}`,
    links: [
      { rel: 'self', type: 'application/openfeed+json', href: `${location}/profile` },
      { rel: 'http://webfinger.net/rel/profile-page', type: 'text/html', href: `${location}/index.html` },
      { rel: 'alternate', type: 'application/feed+json', href: `${location}/feed.json` },
      { rel: 'alternate', type: 'application/atom+xml', href: `${location}/feed.xml` },
    ],
  }, null, 1);
}

/** The h-card: the profile's name, and the link with the anchor key in its fragment (§3.7). */
export function hcard(read, location) {
  const name = read.name ?? location.split('/').pop();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(name)}</title>
<link rel="alternate" type="application/feed+json" href="${esc(`${location}/feed.json`)}">
<link rel="alternate" type="application/atom+xml" href="${esc(`${location}/feed.xml`)}"></head>
<body><div class="h-card"><a class="p-name u-url" href="${esc(`${location}/#${read.anchor}`)}">${esc(name)}</a></div>
<ul class="h-feed">
${items(read, location).map(({ p, url }) => `<li class="h-entry"><a class="u-url" href="${esc(url)}"><time class="dt-published" datetime="${esc(p.at)}">${esc(p.at)}</time></a> <span class="e-content">${esc(p.text ?? '')}</span></li>`).join('\n')}
</ul></body></html>
`;
}
