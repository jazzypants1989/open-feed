// Handle incoming ActivityPub activities: Follow, Undo, Accept.
// Followers are stored in-memory for the prototype.
import { sign } from './signatures.js';

export function createInbox(bridgeOrigin, bridgeKey) {
  const followers = new Map();

  function followersFor(name) {
    if (!followers.has(name)) followers.set(name, new Set());
    return followers.get(name);
  }

  function acceptActivity(actorId, followActivity) {
    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${actorId}/accept/${Date.now()}`,
      type: 'Accept',
      actor: actorId,
      object: followActivity,
    };
  }

  async function handle(name, activity, { deliver }) {
    const actorId = `${bridgeOrigin}/users/${name}`;

    if (activity.type === 'Follow') {
      if (activity.object !== actorId) return { status: 400 };
      const followerActor = activity.actor;
      followersFor(name).add(followerActor);
      const accept = acceptActivity(actorId, activity);
      const followerInbox = typeof followerActor === 'string'
        ? await resolveInbox(followerActor, deliver)
        : followerActor.inbox;
      if (followerInbox) {
        const body = JSON.stringify(accept);
        const keyId = `${actorId}#main-key`;
        const headers = sign({ method: 'POST', url: followerInbox, headers: {}, body }, keyId, bridgeKey.privateKey);
        await deliver(followerInbox, body, headers);
      }
      return { status: 202, body: accept };
    }

    if (activity.type === 'Undo' && activity.object?.type === 'Follow') {
      const followerActor = activity.actor;
      followersFor(name).delete(followerActor);
      return { status: 200 };
    }

    return { status: 200 };
  }

  function getFollowers(name) {
    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `${bridgeOrigin}/users/${name}/followers`,
      type: 'OrderedCollection',
      totalItems: (followers.get(name)?.size ?? 0),
      orderedItems: [...(followers.get(name) ?? [])],
    };
  }

  return { handle, getFollowers, followersFor };
}

async function resolveInbox(actorUrl, deliver) {
  try {
    const res = await fetch(actorUrl, { headers: { accept: 'application/activity+json, application/ld+json' } });
    if (!res.ok) return null;
    const actor = await res.json();
    return actor.inbox ?? null;
  } catch { return null; }
}
