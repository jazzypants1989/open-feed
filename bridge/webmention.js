// Webmention (W3C Recommendation): discover a target's endpoint and send a mention.
// Outbound only — when an Open Feed post replies to an external URL, notify the target.

export async function discoverEndpoint(targetUrl, fetchFn = fetch) {
  const res = await fetchFn(targetUrl, { redirect: 'follow' });
  const linkHeader = res.headers.get('link');
  if (linkHeader) {
    const match = linkHeader.match(/<([^>]+)>;\s*rel="?webmention"?/);
    if (match) return new URL(match[1], targetUrl).href;
  }
  const html = await res.text();
  const linkTag = html.match(/<link[^>]+rel="?webmention"?[^>]*>/i);
  if (linkTag) {
    const href = linkTag[0].match(/href="([^"]+)"/i);
    if (href) return new URL(href[1], targetUrl).href;
  }
  const aTag = html.match(/<a[^>]+rel="?webmention"?[^>]*href="([^"]+)"/i);
  if (aTag) return new URL(aTag[1], targetUrl).href;
  return null;
}

export async function send(sourceUrl, targetUrl, fetchFn = fetch) {
  const endpoint = await discoverEndpoint(targetUrl, fetchFn);
  if (!endpoint) return { sent: false, reason: 'no endpoint' };
  const body = new URLSearchParams({ source: sourceUrl, target: targetUrl });
  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  return { sent: res.ok, status: res.status, endpoint };
}

export async function sendForPost(post, postUrl, fetchFn = fetch) {
  if (!post.target?.location) return null;
  const targetUrl = `${post.target.location}/posts/${post.target.number}`;
  return send(postUrl, targetUrl, fetchFn);
}
