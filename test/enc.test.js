// Encrypted content (§15). Required by no core level and REQUIRED in full of any deployment
// offering audience-restricted content; marked "never independently reviewed" in the
// specification — while `DISTRIBUTION-MODEL.md` treats it as a launch dependency for cross-hub
// audiences.
//
// The claim this layer makes about the core is that it does not touch it: an encrypted item is an
// ordinary signed item whose content happens to be opaque, and the core neither defines nor
// inspects `_enc`. So the first tests run the *unchanged* verifier and the *unchanged* manifest
// reconciliation over encrypted items, because "no new signing construction" is falsifiable.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { DAY, T0, makeSigner } from './helpers/site.js';
import {
  Publisher,
  seal,
  openEnvelope,
  encryptionKeyFor,
  declaredAudience,
  slotTag,
  sealAttachment,
  openAttachment,
  EncError,
  verifyDocument,
  reconcileFeed,
  documentHash,
  sign,
  b64u,
  sha256,
} from '../src/index.js';

/** An identity that publishes an X25519 encryption key alongside its signing key (§15.1). */
function member(url, name) {
  const signer = makeSigner(`${name}-1`, { iat: T0 - 30 * DAY });
  const enc = crypto.generateKeyPairSync('x25519');
  const { x } = enc.publicKey.export({ format: 'jwk' });
  const document = {
    url,
    name,
    seq: 1,
    updated: T0 - 30 * DAY,
    keys: [signer.jwk, { crv: 'X25519', iat: T0 - 30 * DAY, kid: `${name}-enc-1`, kty: 'OKP', use: 'enc', x }],
  };
  document._sig = sign(document, signer.privateKey, `${url}#${signer.kid}`, { kind: 'identity' });
  return { url, name, signer, document, encPrivate: enc.privateKey, encPublic: enc.publicKey };
}

const mom = member('https://mom.pence.family/', 'mom');
const dad = member('https://dad.pence.family/', 'dad');
const gran = member('https://gran.example/', 'gran');
const eve = member('https://eve.example/', 'eve');

const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** An encrypted item, built the way §15 says: an ordinary item with `content_text: ""`. */
function encryptedItem(author, { id, feedUrl, recipients, audience, content }) {
  const item = {
    id,
    authors: [{ url: author.url }],
    content_text: '',
    date_published: iso(T0),
    _openfeed: { version: 1, ...(feedUrl ? { feed_url: feedUrl } : {}) },
  };
  // Sealed against the item as it stands, then the envelope joins the same object (§7.2, §15.2.1).
  item._openfeed.enc = seal({ item, content, recipients: recipients.map((r) => r.document), audience });
  item._sig = sign(item, author.signer.privateKey, `${author.url}#${author.signer.kid}`, { kind: 'item' });
  return item;
}

// ---- the claim about the core ----

test('an encrypted item is an ordinary signed item to the unchanged verifier', () => {
  // §15: "It defines no new signing construction (§6.1)... Nothing about signing, author
  // binding, `_feed_url`, versioning, tombstones, or the manifest changes."
  const item = encryptedItem(mom, {
    id: 'urn:uuid:sealed',
    feedUrl: 'https://mom.pence.family/feed.json',
    recipients: [dad, gran],
    content: { content_text: 'the biopsy came back clear' },
  });

  const info = verifyDocument(item, { identityDocument: mom.document, kind: 'item' });
  assert.equal(info.identityUrl, mom.url);
  assert.equal(item.content_text, '', '§7.2\'s marker for "no displayable content"');

  // And an ordinary manifest commits it, byte for byte, with no knowledge of `_enc`.
  const manifest = {
    url: mom.url,
    feed_url: 'https://mom.pence.family/feed.json',
    seq: 1,
    updated: T0 + 60,
    items: { [item.id]: [1, documentHash(item)] },
  };
  const reconciled = reconcileFeed(manifest, [item], { now: T0 + 120, url: manifest.feed_url });
  assert.deepEqual(reconciled.violations, []);
  assert.equal(reconciled.states[0].state, 'live');
});

// ---- §15.2: one shared ephemeral, blinded tags ----

test('every recipient opens it, and nobody else does', () => {
  const item = encryptedItem(mom, {
    id: 'urn:uuid:family',
    feedUrl: 'https://mom.pence.family/feed.json',
    recipients: [dad, gran],
    content: { content_text: 'cookies at four' },
  });

  for (const who of [dad, gran]) {
    const plaintext = openEnvelope(item, { privateKeys: [who.encPrivate] });
    assert.equal(plaintext.content_text, 'cookies at four');
  }
  assert.throws(
    () => openEnvelope(item, { privateKeys: [eve.encPrivate] }),
    (e) => e instanceof EncError && /no slot/.test(e.message),
  );
});

test('the envelope carries one ephemeral and no kid, and its tags disclose nothing', () => {
  // §15.2. A `kid` would name the audience to every observer forever. A tag computed from the
  // ECDH shared secret needs one of the two private halves, so an observer holding every
  // recipient's *published* key and the ephemeral public key derives nothing — and it is
  // unlinkable across items because the ephemeral is fresh per item, which is also the reason a
  // `kid` is forbidden here.
  const of = (id) => encryptedItem(mom, {
    id, feedUrl: 'https://mom.pence.family/feed.json', recipients: [dad, gran], content: { content_text: 'x' },
  })._openfeed?.enc;

  const first = of('urn:uuid:one');
  const second = of('urn:uuid:two');

  const header = JSON.parse(Buffer.from(first.protected, 'base64url').toString('utf8'));
  assert.equal(header.enc, 'A256GCM');
  assert.equal(header.epk.crv, 'X25519');
  assert.equal(first.recipients.length, 2);
  for (const slot of first.recipients) {
    assert.equal(slot.header.alg, 'ECDH-ES+A256KW');
    assert.equal(slot.header.kid, undefined, '§15.2: a per-recipient header MUST NOT carry kid');
    assert.equal(Buffer.from(slot.header._tag, 'base64url').length, 8);
  }

  // One shared ephemeral for the whole envelope, so a reader pays one key agreement per key it
  // holds and then byte comparisons — work does not grow with the audience (§15.5.7).
  const secondHeader = JSON.parse(Buffer.from(second.protected, 'base64url').toString('utf8'));
  assert.notEqual(header.epk.x, secondHeader.epk.x, 'fresh per item');
  assert.notDeepEqual(
    first.recipients.map((r) => r.header._tag),
    second.recipients.map((r) => r.header._tag),
    'so the same audience is unlinkable across two items',
  );

  // An observer holds every published encryption key and the ephemeral, and still cannot say
  // whether Dad is in this envelope.
  const published = [dad, gran, eve].map((w) => encryptionKeyFor(w.document));
  assert.ok(published.every((k) => typeof k.x === 'string'));
  const tags = new Set(first.recipients.map((r) => r.header._tag));
  assert.equal(
    published.filter((k) => tags.has(k.x)).length, 0,
    'nothing an observer holds is comparable to a tag',
  );
});

test('a tag match whose unwrap fails keeps scanning and then fails closed', () => {
  // The question §15.2 left open. Eight bytes collide, so a match whose unwrap fails is an
  // ordinary event rather than an attack — and treating a tag match as a decision would let
  // anyone who could grind one deny a recipient their own item.
  const item = encryptedItem(mom, {
    id: 'urn:uuid:collide',
    feedUrl: 'https://mom.pence.family/feed.json',
    recipients: [dad, gran],
    content: { content_text: 'still readable' },
  });

  const dadTag = item._openfeed?.enc.recipients.find(
    (s) => s.header._tag === slotTag(crypto.diffieHellman({
      privateKey: dad.encPrivate,
      publicKey: crypto.createPublicKey({
        key: JSON.parse(Buffer.from(item._openfeed?.enc.protected, 'base64url').toString('utf8')).epk,
        format: 'jwk',
      }),
    })),
  );
  assert.ok(dadTag, 'Dad has a slot');

  // A forged slot carrying Dad's tag and garbage key material, placed first.
  item._openfeed?.enc.recipients.unshift({
    header: { alg: 'ECDH-ES+A256KW', _tag: dadTag.header._tag },
    encrypted_key: b64u(crypto.randomBytes(40)),
  });

  const plaintext = openEnvelope(item, { privateKeys: [dad.encPrivate] });
  assert.equal(plaintext.content_text, 'still readable', 'the reader kept scanning past the collision');

  // And with every real slot gone, it fails closed rather than half-opening.
  item._openfeed.enc.recipients = [item._openfeed.enc.recipients[0]];
  assert.throws(() => openEnvelope(item, { privateKeys: [dad.encPrivate] }), EncError);
});

// ---- §15.2.1: carrier binding ----

test('a relayed ciphertext is refused, and the relayer never had to be in the audience', () => {
  // The attack §15.2.1 is a MUST for. Eve cannot read the item. She copies the `_enc` blob
  // verbatim into a new item with a fresh `id`, her own `authors`, her own `_feed_url`, and signs
  // it with her own key. Every core check passes — valid signature, valid author binding,
  // `_feed_url` matching the feed it is served from, fresh `id` so §7.5's exclusivity rule is
  // not triggered — and an audience member's client would render Mom's private words attributed
  // to Eve, in a context Eve chose. What makes it worse than ordinary misattribution is that
  // **Eve does not need to be in the audience**: in a cleartext world a copier can only
  // misattribute what they could already read.
  const original = encryptedItem(mom, {
    id: 'urn:uuid:private',
    feedUrl: 'https://mom.pence.family/feed.json',
    recipients: [dad, gran],
    content: { content_text: 'something Mom told only her family' },
  });

  const relayed = {
    id: 'urn:uuid:eves-post',
    authors: [{ url: eve.url }],
    _openfeed: { feed_url: 'https://eve.example/feed.json', version: 1 },
    content_text: '',
    date_published: iso(T0 + 60),
    _openfeed: { enc: original._openfeed?.enc, rel: [{ type: 'quote', to: 'https://mom.pence.family/feed.json#urn:uuid:private' }] },
  };
  relayed._sig = sign(relayed, eve.signer.privateKey, `${eve.url}#${eve.signer.kid}`, { kind: 'item' });

  // The core is satisfied. That is the point: the core commits to opaque bytes and has one
  // construction, so this check belongs at the decrypting client and nowhere else.
  assert.doesNotThrow(() => verifyDocument(relayed, { identityDocument: eve.document, kind: 'item' }));

  // And the decrypting client refuses, rendering nothing and attributing nothing.
  assert.throws(
    () => openEnvelope(relayed, { privateKeys: [dad.encPrivate] }),
    (e) => e instanceof EncError && /carrier binding/.test(e.message),
  );
  // The genuine carrier still opens, so the check is not simply refusing everything.
  assert.equal(
    openEnvelope(original, { privateKeys: [dad.encPrivate] }).content_text,
    'something Mom told only her family',
  );
});

test('every field of the binding is checked, including a _feed_url that appeared or vanished', () => {
  const delivered = encryptedItem(mom, {
    id: 'urn:uuid:delivered', recipients: [dad], content: { content_text: 'just for you' },
  });
  assert.equal(openEnvelope(delivered, { privateKeys: [dad.encPrivate] }).content_text, 'just for you');

  // §11.1.1: only the author can move an item across the published/delivered line, by bumping
  // `_version`, adding `_feed_url`, and re-signing. A recipient adding one to the bytes they
  // hold is exactly what the binding stops.
  const promoted = { ...delivered, _openfeed: { ...delivered._openfeed, feed_url: "https://dad.pence.family/feed.json" } };
  assert.throws(
    () => openEnvelope(promoted, { privateKeys: [dad.encPrivate] }),
    /_openfeed\.feed_url/,
  );
});

// ---- §15.2.2: the declared audience ----

test('the audience travels inside the sealed bytes and reaches readers only', () => {
  // §15.2.2 exists for one case: a reply to encrypted content that the other recipients can also
  // read. It MUST appear inside the sealed plaintext and MUST NOT appear in a per-recipient
  // header — readers learning the audience is the point; observers learning it is the leak the
  // tags exist to prevent.
  const item = encryptedItem(mom, {
    id: 'urn:uuid:convened',
    feedUrl: 'https://mom.pence.family/feed.json',
    recipients: [dad, gran],
    audience: [dad.url, gran.url],
    content: { content_text: 'a family thread' },
  });

  const wire = JSON.stringify(item._openfeed?.enc);
  assert.ok(!wire.includes('dad.pence.family'), 'nothing about the audience is on the wire');
  assert.ok(!wire.includes('gran.example'));

  const plaintext = openEnvelope(item, { privateKeys: [gran.encPrivate] });
  assert.deepEqual(declaredAudience(plaintext), [dad.url, gran.url]);
  assert.equal(declaredAudience({ content_text: 'no audience' }), null);

  // The point of it: Gran can now wrap a reply to the same people — resolving each key from that
  // identity's *own* document (§15.1), never from the list, which names people and holds no keys.
  const reply = encryptedItem(gran, {
    id: 'urn:uuid:granny-reply',
    recipients: [mom, dad],
    content: {
      content_text: 'wouldn\'t miss it',
      _openfeed: { rel: [{ type: 'reply', to: 'https://mom.pence.family/feed.json#urn:uuid:convened' }] },
    },
  });
  assert.equal(openEnvelope(reply, { privateKeys: [mom.encPrivate] }).content_text, 'wouldn\'t miss it');
  assert.equal(openEnvelope(reply, { privateKeys: [dad.encPrivate] }).content_text, 'wouldn\'t miss it');
});

// ---- §15.1: key resolution ----

test('an encryption key is resolved from the recipient\'s own document and never from a list', () => {
  // §15.1: "a sender MUST resolve a recipient's encryption key from that document and MUST NOT
  // accept one supplied by any third party." This is the check that stops an intermediary
  // substituting a key it controls, and because the identity document is chained and pinned,
  // substituting a published encryption key is as detectable as substituting a signing key.
  assert.equal(encryptionKeyFor(dad.document).kid, 'dad-enc-1');
  assert.throws(
    () => encryptionKeyFor({ url: 'https://nokeys.example/', keys: [] }),
    (e) => e instanceof EncError && /use "enc"/.test(e.message),
  );
  // A signing key is not an encryption key, whatever a caller hoped (§4.1's constraints bind
  // signing keys only, and an extension key type is ignored by core verifiers).
  assert.throws(() => encryptionKeyFor({ url: 'https://x.example/', keys: [dad.signer.jwk] }), EncError);
});

// ---- §15.3: attachments ----

test('an encrypted attachment\'s _sha256 is over the ciphertext, so anyone can check it', () => {
  // §15.3: "integrity is verifiable by anyone, without any key, from a signed item: a host that
  // swaps bytes is caught by a party who cannot read either version." That is what makes this
  // need no gate, no key-distribution mechanism, and no streaming construction.
  const photo = crypto.randomBytes(8192);
  const sealed = sealAttachment(photo);

  assert.equal(sealed._openfeed?.sha256, b64u(sha256(sealed.ciphertext)), 'the hash names the published bytes');
  assert.notDeepEqual(sealed.ciphertext.subarray(0, photo.length), photo);
  assert.deepEqual(openAttachment(sealed.ciphertext, sealed), photo);

  // AEAD gives plaintext integrity on top of the public hash.
  const tampered = Buffer.from(sealed.ciphertext);
  tampered[10] ^= 0xff;
  assert.throws(() => openAttachment(tampered, sealed));

  // And the per-blob key travels inside the item's already-encrypted content, so whoever can
  // read the caption can decrypt the photo — no second audience, nothing new to revoke.
  const item = encryptedItem(mom, {
    id: 'urn:uuid:photo',
    feedUrl: 'https://mom.pence.family/feed.json',
    recipients: [dad],
    content: {
      content_text: 'the grandkids',
      attachments: [{ url: 'https://mom.pence.family/p.enc', _openfeed: { sha256: sealed._openfeed?.sha256 }, _enc_key: sealed.key, _enc_iv: sealed.iv }],
    },
  });
  const opened = openEnvelope(item, { privateKeys: [dad.encPrivate] });
  assert.deepEqual(openAttachment(sealed.ciphertext, {
    key: opened.attachments[0]._enc_key, iv: opened.attachments[0]._enc_iv,
  }), photo);
});

// ---- what it does not hide ----

test('§11.4\'s metadata is cleartext by construction, and the test says so out loud', () => {
  // "Encryption hides what you said, not that you said it." A publisher who needs the
  // interaction graph private keeps those items off the published axis entirely (§11.1, §15.4).
  const p = new Publisher({
    identity: mom.url, signer: mom.signer, profile: { name: 'Mom' }, now: () => T0,
  });
  const carrier = { id: 'urn:uuid:visible', authors: [{ url: mom.url }], _openfeed: { feed_url: p.feedUrl  }};
  const enc = seal({ item: carrier, content: { content_text: 'secret' }, recipients: [dad.document] });
  const published = p.publishItem({
    id: 'urn:uuid:visible',
    content_text: '',
    _openfeed: { enc: enc, rel: [{ type: 'reply', to: 'https://gran.example/feed.json#urn:uuid:granny-post' }] },
  }, { at: T0 });

  const wire = JSON.stringify(published);
  assert.ok(wire.includes('urn:uuid:visible'), 'id');
  assert.ok(wire.includes(mom.url), 'authors');
  assert.ok(wire.includes(p.feedUrl), '_feed_url');
  assert.ok(wire.includes('gran.example'), '_rel targets — the interaction graph');
  assert.ok(!wire.includes('secret'), 'and only the content is opaque');
});

// ---- §5.1's one spelling of base64url reaches this layer too ----

test('the envelope is §5.1-strict: a non-canonical spelling is an EncError, never an acceptance', () => {
  // The sharp case is `tag` (or `ciphertext`, or `encrypted_key`): pad it with `=` and a
  // lenient decoder recovers the same bytes, so the envelope OPENS — the layer accepts a
  // spelling §5.1 forbids, and two implementations disagree about what the document even is.
  const item = encryptedItem(mom, {
    id: 'urn:uuid:strict', recipients: [dad], content: { content_text: 'x' },
  });
  assert.equal(openEnvelope(item, { privateKeys: [dad.encPrivate] }).content_text, 'x',
    'the honest spelling opens');

  const mutated = (field, change) =>
    ({ ...item, _openfeed: { ...item._openfeed, enc: { ...item._openfeed.enc, [field]: change(item._openfeed.enc[field]) } } });
  for (const [field, change] of [
    ['tag', (v) => v + '='],
    ['ciphertext', (v) => v + '=='],
    ['iv', (v) => v + '='],
    ['protected', (v) => v + '='],
  ]) {
    assert.throws(
      () => openEnvelope(mutated(field, change), { privateKeys: [dad.encPrivate] }),
      (e) => e instanceof EncError && /canonical base64url|impossible base64url/.test(e.message),
      `${field} padded must be refused as a spelling, not decoded leniently`,
    );
  }
});

test('a hostile epk fails inside the module contract: EncError, never a bare crypto exception', () => {
  const item = encryptedItem(mom, {
    id: 'urn:uuid:epk', recipients: [dad], content: { content_text: 'x' },
  });
  const withEpkX = (x) => {
    const protectedB64 = Buffer.from(
      JSON.stringify({ enc: 'A256GCM', epk: { crv: 'X25519', kty: 'OKP', x } }),
    ).toString('base64url');
    return { ...item, _openfeed: { ...item._openfeed, enc: { ...item._openfeed.enc, protected: protectedB64 } } };
  };
  // A truncated point, a padded spelling, and garbage: each is the attacker choosing the epk,
  // and each must surface as this module's own error before any key agreement is attempted.
  const short = Buffer.alloc(31, 7).toString('base64url');
  for (const x of [short, dad.encPublic.export({ format: 'jwk' }).x + '=', 'not base64url!!']) {
    assert.throws(
      () => openEnvelope(withEpkX(x), { privateKeys: [dad.encPrivate] }),
      (e) => e instanceof EncError,
      `epk x ${JSON.stringify(x.slice(0, 12))}… must be an EncError`,
    );
  }
});
