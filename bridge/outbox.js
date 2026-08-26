// Translate Open Feed posts into ActivityPub Create/Note activities.
// Encrypted posts are omitted (same as views). Withdrawn posts are absent.
const AP_CONTEXT = 'https://www.w3.org/ns/activitystreams';
const AP_PUBLIC = 'https://www.w3.org/ns/activitystreams#Public';

function noteFromPost(post, number, read, bridgeOrigin, feedLocation) {
  const actorId = `${bridgeOrigin}/users/${read.name ?? 'unknown'}`;
  const noteId = `${actorId}/posts/${number}`;
  const note = {
    '@context': AP_CONTEXT,
    id: noteId,
    type: 'Note',
    attributedTo: actorId,
    published: post.at,
    to: [AP_PUBLIC],
    cc: [`${actorId}/followers`],
    content: post.text ?? '',
    url: `${feedLocation}/posts/${number}`,
  };
  if (post.target?.location) {
    note.inReplyTo = `${post.target.location}/posts/${post.target.number}`;
  }
  return note;
}

function createActivity(note, actorId) {
  return {
    '@context': AP_CONTEXT,
    id: `${note.id}/activity`,
    type: 'Create',
    actor: actorId,
    published: note.published,
    to: note.to,
    cc: note.cc,
    object: note,
  };
}

export function outbox(read, bridgeOrigin, feedLocation) {
  const actorId = `${bridgeOrigin}/users/${read.name ?? 'unknown'}`;
  const items = [...read.posts.entries()]
    .filter(([, p]) => p.encrypted === undefined)
    .sort(([a], [b]) => a - b)
    .map(([number, post]) => createActivity(noteFromPost(post, number, read, bridgeOrigin, feedLocation), actorId));

  return {
    '@context': AP_CONTEXT,
    id: `${actorId}/outbox`,
    type: 'OrderedCollection',
    totalItems: items.length,
    orderedItems: items,
  };
}

export function activitiesForDelivery(read, bridgeOrigin, feedLocation) {
  const actorId = `${bridgeOrigin}/users/${read.name ?? 'unknown'}`;
  return [...read.posts.entries()]
    .filter(([, p]) => p.encrypted === undefined)
    .sort(([a], [b]) => a - b)
    .map(([number, post]) => createActivity(noteFromPost(post, number, read, bridgeOrigin, feedLocation), actorId));
}
