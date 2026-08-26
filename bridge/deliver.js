// Deliver ActivityPub activities to followers' inboxes with HTTP Signatures.
import { sign } from './signatures.js';

export async function deliver(activity, followers, keyId, privateKey) {
  const body = JSON.stringify(activity);
  const results = [];

  for (const followerActor of followers) {
    const inbox = typeof followerActor === 'string'
      ? await resolveInbox(followerActor)
      : followerActor;
    if (!inbox) { results.push({ actor: followerActor, ok: false, reason: 'no inbox' }); continue; }

    const headers = sign(
      { method: 'POST', url: inbox, headers: { 'content-type': 'application/activity+json' }, body },
      keyId, privateKey,
    );

    try {
      const res = await fetch(inbox, { method: 'POST', headers: { ...headers, 'content-type': 'application/activity+json' }, body });
      results.push({ actor: followerActor, ok: res.ok, status: res.status });
    } catch (err) {
      results.push({ actor: followerActor, ok: false, reason: err.message });
    }
  }

  return results;
}

async function resolveInbox(actorUrl) {
  try {
    const res = await fetch(actorUrl, { headers: { accept: 'application/activity+json, application/ld+json' } });
    if (!res.ok) return null;
    const actor = await res.json();
    return actor.inbox ?? null;
  } catch { return null; }
}
