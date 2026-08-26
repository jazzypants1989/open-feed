// §10 — views: JSON Feed, Atom, h-card, WebFinger, validated against their respective standards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonFeed, atom, hcard, webfinger, postPage } from '../src/views.js';
import { createHub } from '../src/hub.js';
import { createPublisher } from '../src/publish.js';
import { createReader } from '../src/reader.js';
import { encrypt, postBinding, newReadingKey } from '../src/openfeed.js';
import { memIo, readerOver, person, list, claim } from './helpers/site.js';
import { rotation } from '../src/profile.js';
import { signProfile } from '../src/profile.js';

const AT = 'https://hub.example/alice';

async function setup({ posts = [], recovery } = {}) {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  const pub = await claim(io, alice, AT, { recovery: recovery ?? list() });
  for (const [n, body] of posts) await pub.publish(n, body);
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  assert.equal(read.verdict, 'ok', read.why);
  return { hub, io, alice, pub, read };
}

// ---- JSON Feed 1.1 (https://www.jsonfeed.org/version/1.1/) ----

test('JSON Feed: required fields per JSON Feed 1.1', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hello' }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(typeof feed.title, 'string');
  assert.ok(Array.isArray(feed.items));
  for (const item of feed.items) {
    assert.equal(typeof item.id, 'string', 'each item requires an id');
    assert.ok('content_text' in item || 'content_html' in item || 'summary' in item,
      'each item requires at least one of content_text, content_html, or summary');
  }
});

test('JSON Feed: home_page_url and feed_url point to the right location', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.home_page_url, `${AT}/`);
  assert.equal(feed.feed_url, `${AT}/feed.json`);
});

test('JSON Feed: authors array with name and url', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.ok(Array.isArray(feed.authors));
  assert.equal(feed.authors[0].name, 'alice');
  assert.equal(feed.authors[0].url, `${AT}/`);
});

test('JSON Feed: item ids are urn:openfeed:<anchor>:<number>', async () => {
  const { read, alice } = await setup({ posts: [
    [1, { at: '2026-08-01T00:00:00Z', text: 'first' }],
    [2, { at: '2026-08-02T00:00:00Z', text: 'second' }],
  ] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.deepEqual(feed.items.map(i => i.id), [
    `urn:openfeed:${alice.key.x}:1`,
    `urn:openfeed:${alice.key.x}:2`,
  ]);
});

test('JSON Feed: date_published is the post at field', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T12:34:56Z', text: 'hi' }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.items[0].date_published, '2026-08-01T12:34:56Z');
});

test('JSON Feed: post with target gets external_url', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'nice post', rel: 'reply',
    target: { key: 'somekey', number: 5, hash: 'somehash', location: 'https://other.example/bob' } }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.items[0].external_url, 'https://other.example/bob/posts/5');
});

test('JSON Feed: post without target has no external_url', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'standalone' }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.items[0].external_url, undefined);
});

// ---- Atom (RFC 4287) ----

test('Atom: required feed elements per RFC 4287', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hello' }]] });
  const xml = atom(read, AT);
  assert.ok(xml.includes('<?xml version="1.0" encoding="utf-8"?>'), 'XML declaration');
  assert.ok(xml.includes('<feed xmlns="http://www.w3.org/2005/Atom">'), 'Atom namespace');
  assert.ok(/<id>[^<]+<\/id>/.test(xml), 'feed requires <id>');
  assert.ok(/<title>[^<]+<\/title>/.test(xml), 'feed requires <title>');
  assert.ok(/<updated>[^<]+<\/updated>/.test(xml), 'feed requires <updated>');
  assert.ok(/<author>\s*<name>[^<]+<\/name>\s*<\/author>/.test(xml), 'feed requires <author><name>');
  assert.ok(xml.includes('rel="self"'), 'feed requires <link rel="self">');
});

test('Atom: feed id is urn:openfeed:<anchor>', async () => {
  const { read, alice } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const xml = atom(read, AT);
  assert.ok(xml.includes(`<id>urn:openfeed:${alice.key.x}</id>`));
});

test('Atom: each entry has required elements per RFC 4287', async () => {
  const { read } = await setup({ posts: [
    [1, { at: '2026-08-01T00:00:00Z', text: 'first' }],
    [2, { at: '2026-08-02T00:00:00Z', text: 'second' }],
  ] });
  const xml = atom(read, AT);
  const entries = xml.split('<entry>').slice(1);
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.ok(/<id>[^<]+<\/id>/.test(entry), 'entry requires <id>');
    assert.ok(/<title>[^<]*<\/title>/.test(entry), 'entry requires <title>');
    assert.ok(/<updated>[^<]+<\/updated>/.test(entry), 'entry requires <updated>');
    assert.ok(/rel="alternate"/.test(entry), 'entry requires <link rel="alternate">');
  }
});

test('Atom: feed updated is the latest post date', async () => {
  const { read } = await setup({ posts: [
    [1, { at: '2026-08-01T00:00:00Z', text: 'earlier' }],
    [2, { at: '2026-08-05T00:00:00Z', text: 'later' }],
  ] });
  const xml = atom(read, AT);
  const feedUpdated = xml.match(/<feed[^>]*>[\s\S]*?<updated>([^<]+)<\/updated>/)?.[1];
  assert.equal(feedUpdated, '2026-08-05T00:00:00Z');
});

test('Atom: self link points to feed.xml', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const xml = atom(read, AT);
  assert.ok(xml.includes(`href="${AT}/feed.xml"`));
});

// ---- WebFinger (RFC 7033) ----

test('WebFinger: subject is acct:name@domain', async () => {
  const wf = JSON.parse(webfinger('alice', AT));
  assert.equal(wf.subject, 'acct:alice@hub.example');
});

test('WebFinger: links array with required rels', async () => {
  const wf = JSON.parse(webfinger('alice', AT));
  assert.ok(Array.isArray(wf.links));
  const rels = wf.links.map(l => l.rel);
  assert.ok(rels.includes('self'), 'must include self link to profile');
  assert.ok(rels.includes('http://webfinger.net/rel/profile-page'), 'must include profile-page link');
  assert.ok(rels.filter(r => r === 'alternate').length >= 2, 'must include alternate links for feeds');
});

test('WebFinger: self link is the profile with openfeed media type', async () => {
  const wf = JSON.parse(webfinger('alice', AT));
  const self = wf.links.find(l => l.rel === 'self');
  assert.equal(self.type, 'application/openfeed+json');
  assert.equal(self.href, `${AT}/profile`);
});

test('WebFinger: alternate links for JSON Feed and Atom', async () => {
  const wf = JSON.parse(webfinger('alice', AT));
  const alts = wf.links.filter(l => l.rel === 'alternate');
  assert.ok(alts.some(l => l.type === 'application/feed+json' && l.href === `${AT}/feed.json`));
  assert.ok(alts.some(l => l.type === 'application/atom+xml' && l.href === `${AT}/feed.xml`));
});

// ---- h-card (microformats2) ----

test('h-card: has microformats2 h-card with p-name', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const html = hcard(read, AT);
  assert.ok(html.includes('class="h-card"'));
  assert.ok(html.includes('class="p-name u-url"'));
  assert.ok(html.includes('>alice</a>'));
});

test('h-card: anchor key in the link fragment', async () => {
  const { read, alice } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const html = hcard(read, AT);
  assert.ok(html.includes(`#${alice.key.x}`));
});

test('h-card: has h-feed with h-entry children', async () => {
  const { read } = await setup({ posts: [
    [1, { at: '2026-08-01T00:00:00Z', text: 'first' }],
    [2, { at: '2026-08-02T00:00:00Z', text: 'second' }],
  ] });
  const html = hcard(read, AT);
  assert.ok(html.includes('class="h-feed"'));
  const entryCount = (html.match(/class="h-entry"/g) || []).length;
  assert.equal(entryCount, 2);
  assert.ok(html.includes('class="dt-published"'));
  assert.ok(html.includes('class="e-content"'));
});

test('h-card: link rel=alternate for both feeds in head', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const html = hcard(read, AT);
  assert.ok(html.includes('rel="alternate" type="application/feed+json"'));
  assert.ok(html.includes('rel="alternate" type="application/atom+xml"'));
});

test('h-card: valid HTML structure', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  const html = hcard(read, AT);
  assert.ok(html.includes('<!doctype html>'));
  assert.ok(html.includes('<meta charset="utf-8">'));
  assert.ok(html.includes('lang="en"'));
});

// ---- Edge cases ----

test('empty posts: all views generate without error', async () => {
  const { read } = await setup();
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.items.length, 0);
  assert.ok(atom(read, AT).includes('<feed'));
  assert.ok(atom(read, AT).includes('<updated>1970-01-01T00:00:00Z</updated>'), 'epoch fallback for empty feed');
  assert.ok(hcard(read, AT).includes('class="h-card"'));
});

test('media-only post (no text): listed with empty content_text', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice');
  const pub = await claim(io, alice, AT, { recovery: list() });
  const mediaHash = await pub.publishMedia(Buffer.from('a photograph'));
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', media: [mediaHash] });
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].content_text, '');
  const xml = atom(read, AT);
  assert.ok(xml.includes('<entry>'));
});

test('special characters are escaped in all views', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: '<script>alert("xss")</script> & "quotes"' }]] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.ok(feed.items[0].content_text.includes('<script>'), 'JSON Feed carries raw text, not escaped');
  const xml = atom(read, AT);
  assert.ok(!xml.includes('<script>alert'), 'Atom escapes angle brackets');
  assert.ok(xml.includes('&lt;script&gt;'));
  const html = hcard(read, AT);
  assert.ok(!html.includes('<script>alert'), 'h-card escapes angle brackets');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('encrypted posts are omitted from all views, no ciphertext leak', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), bob = person('bob');
  const aliceRead = newReadingKey(), bobRead = newReadingKey();
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'public post' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', encrypted: encrypt({
    content: { text: 'secret message' },
    audience: [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: bob.key.x, read: bobRead.x, location: 'https://bob.example/bob' }],
    binding: postBinding(alice.key.x, 2),
  }) });
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  const docs = [jsonFeed(read, AT), atom(read, AT), hcard(read, AT)];
  for (const doc of docs) {
    assert.ok(!doc.includes('secret message'), 'plaintext must not appear');
    assert.ok(!doc.includes('ciphertext'), 'ciphertext field must not appear');
  }
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.equal(feed.items.length, 1, 'encrypted post is omitted');
});

test('items are sorted by number', async () => {
  const { read, alice } = await setup({ posts: [
    [3, { at: '2026-08-03T00:00:00Z', text: 'third' }],
    [1, { at: '2026-08-01T00:00:00Z', text: 'first' }],
    [2, { at: '2026-08-02T00:00:00Z', text: 'second' }],
  ] });
  const feed = JSON.parse(jsonFeed(read, AT));
  assert.deepEqual(feed.items.map(i => i.id), [
    `urn:openfeed:${alice.key.x}:1`,
    `urn:openfeed:${alice.key.x}:2`,
    `urn:openfeed:${alice.key.x}:3`,
  ]);
});

// ---- Key rotation: the re-meeting (scenario 7, §3c) ----

test('re-meeting: view ids survive key rotation — the stranger sees continuity', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), k2 = person('k2'), daughter = person('daughter');
  const rec = list(daughter);
  const pub = await claim(io, alice, AT, { recovery: rec });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', text: 'hello from the garden' });
  await pub.publish(2, { at: '2026-08-02T00:00:00Z', text: 'the roses are blooming' });
  const reader = readerOver(io);
  const before = await reader.read({ learned: alice.key.x, at: AT });
  const feedBefore = JSON.parse(jsonFeed(before, AT));
  const atomBefore = atom(before, AT);
  const hcardBefore = hcard(before, AT);
  const idsBefore = feedBefore.items.map(i => i.id);
  const atomFeedId = atomBefore.match(/<id>([^<]+)<\/id>/)?.[1];
  const anchorFragment = `#${alice.key.x}`;

  // Rotate the key: set the profile directly (the hub verifies the existing signer on PUT).
  const rotated = signProfile({
    anchor: alice.key.x, version: 2, name: 'alice',
    chain: [{ key: alice.key.x }, rotation(alice.key, k2.key, rec)],
    recovery: rec, locations: [AT],
  }, k2.key);
  hub.store.set('alice/profile', rotated);
  const pub2 = createPublisher({ io, key: k2.key, at: AT });
  await pub2.resignIndex();
  await pub2.publish(3, { at: '2026-08-03T00:00:00Z', text: 'new key, same me' });

  const after = await reader.read({ learned: alice.key.x, at: AT });
  assert.equal(after.verdict, 'ok', after.why);
  const feedAfter = JSON.parse(jsonFeed(after, AT));
  const atomAfter = atom(after, AT);
  const hcardAfter = hcard(after, AT);

  // All pre-rotation ids unchanged.
  assert.deepEqual(feedAfter.items.slice(0, 2).map(i => i.id), idsBefore);
  // Atom feed id unchanged — this is the identity.
  assert.ok(atomAfter.includes(`<id>${atomFeedId}</id>`));
  // The new post also uses the anchor, not the new signing key.
  assert.ok(feedAfter.items[2].id.startsWith(`urn:openfeed:${alice.key.x}:`));
  // h-card fragment still carries the anchor key.
  assert.ok(hcardAfter.includes(anchorFragment));
  // Content survives.
  assert.equal(feedAfter.items.length, 3);
  assert.equal(feedAfter.items[0].content_text, 'hello from the garden');
  assert.equal(feedAfter.items[2].content_text, 'new key, same me');
});

// ---- IndieWeb microformats: p-author, u-in-reply-to ----

test('h-card: each h-entry has a p-author with h-card', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hello' }]] });
  const html = hcard(read, AT);
  assert.ok(html.includes('class="p-author h-card"'), 'h-entry must include p-author');
});

test('h-card: reply post has u-in-reply-to link', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'nice post', rel: 'reply',
    target: { key: 'somekey', number: 5, hash: 'somehash', location: 'https://other.example/bob' } }]] });
  const html = hcard(read, AT);
  assert.ok(html.includes('class="u-in-reply-to"'), 'reply must include u-in-reply-to');
  assert.ok(html.includes('href="https://other.example/bob/posts/5"'), 'u-in-reply-to points to target');
});

test('h-card: non-reply post has no u-in-reply-to', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'standalone' }]] });
  const html = hcard(read, AT);
  assert.ok(!html.includes('u-in-reply-to'));
});

// ---- Per-post page ----

test('postPage: generates valid h-entry page', async () => {
  const { read, alice } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hello world' }]] });
  const html = postPage(read, AT, 1);
  assert.ok(html);
  assert.ok(html.includes('class="h-entry"'));
  assert.ok(html.includes('class="u-uid"'));
  assert.ok(html.includes(`urn:openfeed:${alice.key.x}:1`));
  assert.ok(html.includes('class="dt-published"'));
  assert.ok(html.includes('class="e-content"'));
  assert.ok(html.includes('hello world'));
  assert.ok(html.includes('class="p-author h-card"'));
});

test('postPage: reply post has u-in-reply-to', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'great post', rel: 'reply',
    target: { key: 'k', number: 3, hash: 'h', location: 'https://bob.example/bob' } }]] });
  const html = postPage(read, AT, 1);
  assert.ok(html.includes('class="u-in-reply-to"'));
  assert.ok(html.includes('href="https://bob.example/bob/posts/3"'));
});

test('postPage: returns null for encrypted post', async () => {
  const hub = createHub(), io = memIo(hub);
  const alice = person('alice'), bob = person('bob');
  const aliceRead = newReadingKey(), bobRead = newReadingKey();
  const pub = await claim(io, alice, AT, { recovery: list() });
  await pub.publish(1, { at: '2026-08-01T00:00:00Z', encrypted: encrypt({
    content: { text: 'secret' },
    audience: [{ key: alice.key.x, read: aliceRead.x, location: AT }, { key: bob.key.x, read: bobRead.x, location: 'https://bob.example/bob' }],
    binding: postBinding(alice.key.x, 1),
  }) });
  const read = await readerOver(io).read({ learned: alice.key.x, at: AT });
  assert.equal(postPage(read, AT, 1), null);
});

test('postPage: returns null for nonexistent post', async () => {
  const { read } = await setup({ posts: [[1, { at: '2026-08-01T00:00:00Z', text: 'hi' }]] });
  assert.equal(postPage(read, AT, 99), null);
});
