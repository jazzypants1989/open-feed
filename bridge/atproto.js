// AT Protocol XRPC client: session management and record creation.
// Supports both app-password auth (light path) and DID-based auth (full path).

export function createClient({ service = 'https://bsky.social', fetchFn = fetch } = {}) {
  let session = null;

  async function call(nsid, body, { method = 'POST', auth = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (auth && session) headers.authorization = `Bearer ${session.accessJwt}`;
    const res = await fetchFn(`${service}/xrpc/${nsid}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
  }

  async function login({ identifier, password }) {
    const res = await call('com.atproto.server.createSession', { identifier, password }, { auth: false });
    if (res.ok) session = res.data;
    return res;
  }

  async function refreshSession() {
    if (!session?.refreshJwt) return { ok: false };
    const res = await fetchFn(`${service}/xrpc/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session.refreshJwt}` },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (res.ok) session = data;
    return { ok: res.ok, status: res.status, data };
  }

  async function createRecord({ collection, record }) {
    if (!session) throw new Error('not logged in');
    return call('com.atproto.repo.createRecord', {
      repo: session.did,
      collection,
      record,
    });
  }

  async function postFromOpenFeed(post, number, feedLocation) {
    const record = {
      $type: 'app.bsky.feed.post',
      text: post.text ?? '',
      createdAt: post.at,
    };
    if (post.target?.location) {
      record.reply = {
        root: { uri: `${post.target.location}/posts/${post.target.number}`, cid: post.target.hash ?? '' },
        parent: { uri: `${post.target.location}/posts/${post.target.number}`, cid: post.target.hash ?? '' },
      };
    }
    return createRecord({ collection: 'app.bsky.feed.post', record });
  }

  async function syncFromRead(read, feedLocation) {
    const results = [];
    for (const [number, post] of [...read.posts.entries()].sort(([a], [b]) => a - b)) {
      if (post.encrypted !== undefined) continue;
      const res = await postFromOpenFeed(post, number, feedLocation);
      results.push({ number, ok: res.ok, status: res.status });
    }
    return results;
  }

  return { login, refreshSession, createRecord, postFromOpenFeed, syncFromRead, call, get session() { return session; } };
}
