// Nostr NIP-01 events with NIP-48 proxy tags for Open Feed bridging.
// The bridge signs events with its own key — not the identity's.
import crypto from 'node:crypto';
import { schnorrSign, schnorrPubkey } from './schnorr.js';

function eventId(pubkey, createdAt, kind, tags, content) {
  const serialized = JSON.stringify([0, pubkey, createdAt, kind, tags, content]);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

export function createEvent(kind, content, tags, key) {
  const pubkey = schnorrPubkey(key.privateKey).toString('hex');
  const createdAt = Math.floor(Date.now() / 1000);
  const id = eventId(pubkey, createdAt, kind, tags, content);
  const sig = schnorrSign(Buffer.from(id, 'hex'), key.privateKey).toString('hex');
  return { id, pubkey, created_at: createdAt, kind, tags, content, sig };
}

export function profileEvent(read, feedLocation, key) {
  const name = read.name ?? 'unknown';
  const content = JSON.stringify({
    name,
    about: `Open Feed identity at ${feedLocation}`,
    picture: '',
    nip05: '',
  });
  return createEvent(0, content, [], key);
}

export function noteEvent(post, number, read, feedLocation, key) {
  const tags = [['proxy', `${feedLocation}/posts/${number}`, 'openfeed']];
  if (post.target?.location) {
    tags.push(['e', '', post.target.location]);
    if (post.target.key) tags.push(['p', post.target.key]);
  }
  return createEvent(1, post.text ?? '', tags, key);
}

export function eventsFromRead(read, feedLocation, key) {
  const events = [profileEvent(read, feedLocation, key)];
  for (const [number, post] of [...read.posts.entries()].sort(([a], [b]) => a - b)) {
    if (post.encrypted !== undefined) continue;
    events.push(noteEvent(post, number, read, feedLocation, key));
  }
  return events;
}

export function relayMessage(event) {
  return JSON.stringify(['EVENT', event]);
}
