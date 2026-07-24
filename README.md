# Open Feed Protocol

A minimal specification for decentralized publishing and interaction, built entirely on existing standards.

---

## TL;DR

**What it is:** A way to publish signed content from a URL you control, and receive authenticated interactions (replies, likes) from others. Think "blogs with cryptographic signatures and a standard inbox."

**Core concepts:**

1. **Identity** = An HTTPS URL (e.g., `https://pence.family/~mom/`)
2. **Profile** = HTML page at that URL with `<link>` elements for discovery
3. **Feed** = JSON Feed 1.1 at a discoverable URL, items signed with Ed25519
4. **Interactions** = Signed JSON posted to recipient's inbox
5. **Keys** = Ed25519 keypairs, published at a discoverable URL

**Quick example:**

```
Identity URL: https://pence.family/~mom/
    ↓ fetch
Profile HTML: contains <link rel="feed" href="..."> and <link rel="jwks" href="...">
    ↓ discover
Feed JSON: signed posts from Mom
    ↓ verify
JWKS: Ed25519 public key(s) to verify signatures (RFC 7517 standard)
```

**What makes it different:**

- No blockchain, no tokens, no complex infrastructure
- Uses standards you already know (JSON Feed, JWS/JWK, OAuth 2.0, Webmention)
- Small enough to implement in a weekend
- Works on free hosting (Netlify, GitHub Pages, Cloudflare)
- Supports familiar `@user@domain` identifiers via WebFinger

---

## Design Philosophy

### Why another protocol?

Existing options are either too complex (ActivityPub requires understanding JSON-LD, HTTP Signatures, and a large vocabulary) or too centralized (AT Protocol is decentralized in theory but Bluesky-centric in practice).

Open Feed asks: what's the _minimum_ needed for signed, verifiable public content with interactions?

### Trust Model

**Be clear about this:** Hub operators have significant power. If your hub stores your private key (the simple default), the admin can:

- Read your key and sign content as you
- Modify your feed content
- Delete your identity

This is fine for family hubs where you trust the admin. For other scenarios, use client-side keys (supported but more complex).

This is the same trust model as email. You trust your email provider not to read your mail, even though they could.

### What's In Scope

- Signed public content (posts, media references)
- Authenticated interactions (replies, likes, reposts)
- Key rotation and revocation
- Identity migration between hubs
- Multi-author feeds (family boards, team feeds)
- Nested threading for conversations

### What's Out of Scope

- End-to-end encrypted content (access-controlled feeds are easily supported, but deferred to implementations)
- Federated timelines or aggregators (easily built on top -- you just need to fetch feeds and verify signatures)
- Content moderation policy (left to hub operators)
- Storage formats and sync protocols (files on disk are fine as long as the HTTP endpoints work)
- AI integration (deferred to implementations)
- Specific authentication methods (WebAuthn vs magic links vs passwords are all up to the hub)

---

## Getting Started

### For Users

1. Get an identity URL from a hub (or run your own)
2. Your hub gives you a profile page and handles key management
3. Use a client app to post content and interact with others
4. Share your identity URL like you'd share an email address

### For Hub Operators

Open Feed defines three conformance levels:

| Level | Name | Description |
| ----- | ---- | ----------- |
| 1 | Read | Fetch feeds, verify signatures. No server needed. |
| 2 | Publish | Serve signed feeds. Static hosting works. |
| 3 | Interact | Full hub with inbox. Requires server. |

**Level 2 endpoints (static hosting compatible):**

| Endpoint                 | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `/{user}/`               | Profile HTML with discovery links              |
| `/{user}/keys.json`      | JWKS document with Ed25519 public key(s)       |
| `/{user}/feed.json`      | JSON Feed 1.1 with signed items                |
| `/.well-known/webfinger` | WebFinger discovery (optional)                 |

**Level 3 adds (requires server):**

| Endpoint                 | Purpose                                        |
| ------------------------ | ---------------------------------------------- |
| `/{user}/inbox`          | POST endpoint for receiving interactions       |
| `/{user}/outbox`         | Sent interactions (authenticated GET)          |
| `/{user}/replies`        | Thread discovery (GET with `?item=` param)     |
| `/{user}/webmention`     | Webmention endpoint (optional, W3C standard)   |
| `/auth/*`                | OAuth 2.0 endpoints (optional but recommended) |

See the [specification](open-feed-spec.md) for full requirements.

### For Client Developers

Your client needs to:

1. **Read feeds** - Fetch JSON Feed, verify signatures against pubkey
2. **Post content** - Sign items, upload feed to hub
3. **Send interactions** - Sign interaction, POST to recipient's inbox
4. **Receive interactions** - Poll or subscribe to user's inbox

---

## Examples

### Profile HTML

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Mom's Profile</title>
    <link
      rel="jwks"
      href="https://pence.family/~mom/keys.json"
      type="application/jwk-set+json"
    />
    <link
      rel="feed"
      href="https://pence.family/~mom/feed.json"
      type="application/feed+json"
    />
    <link rel="inbox" href="https://pence.family/~mom/inbox" />
    <link rel="webmention" href="https://pence.family/~mom/webmention" />
    <link
      rel="profile"
      href="https://pence.family/~mom/profile.json"
      type="application/json"
    />
    <link
      rel="authorization_endpoint"
      href="https://pence.family/auth/authorize"
    />
    <link rel="token_endpoint" href="https://pence.family/auth/token" />
  </head>
  <body>
    <h1>Mom</h1>
    <p>Grandmother, gardener, cat enthusiast.</p>
  </body>
</html>
```

### Profile JSON (rel="profile")

```json
{
  "name": "Mom",
  "bio": "Grandmother, gardener, cat enthusiast.",
  "avatar": "https://pence.family/~mom/avatar.jpg",
  "url": "https://pence.family/~mom/",
  "created": "2025-01-15T00:00:00Z"
}
```

For accounts with sensitive content, add a content warning:

```json
{
  "name": "Artist",
  "bio": "Digital art and illustrations",
  "content_warning": "This account posts adult content"
}
```

### JWKS Document (rel="jwks")

```json
{
  "keys": [
    {
      "kid": "key-1",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
      "iat": 1736899200
    }
  ]
}
```

This is a standard JWKS (RFC 7517) document. The `x` field is the base64url-encoded Ed25519 public key. The `iat` (issued-at) and `revoked_at` are Unix timestamps (seconds). An active key omits `revoked_at` (a present-but-`null` value means the same thing: not revoked).

**Note on timestamp formats:** JWK fields (`iat`, `revoked_at`) use Unix seconds per JWT conventions. Content fields (`date_published`, `published`) use ISO 8601 strings per JSON Feed conventions.

### Feed with Posts

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Mom's Feed",
  "home_page_url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "authors": [
    {
      "name": "Mom",
      "url": "https://pence.family/~mom/"
    }
  ],
  "items": [
    {
      "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "authors": [{ "url": "https://pence.family/~mom/" }],
      "_feed_url": "https://pence.family/~mom/feed.json",
      "content_text": "The grandkids came over today! We made cookies.",
      "date_published": "2025-12-07T14:30:00Z",
      "_version": 1,
      "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcGVuY2UuZmFtaWx5L35tb20va2V5cy5qc29uI2tleS0xIn0..signature"
    }
  ]
}
```

Notes:
- The `kid` in the signature header is `https://pence.family/~mom/keys.json#key-1`, pointing to the JWKS document and key ID. Verifiers confirm this JWKS URL is one Mom's profile actually advertises before trusting the key.
- Each item carries its own `authors` (the signer) and `_feed_url`. These are inside the signed bytes, so they cryptographically bind the post to its author and feed — feed-level `authors` are **not** signed by the item and can't be relied on for this. See spec section 4.6.
- The header now includes `"b64":false,"crit":["b64"]` (RFC 7797 unencoded payload).

### Multi-Author Feed (Family Board)

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Pence Family Board",
  "feed_url": "https://pence.family/family/feed.json",
  "authors": [
    {
      "name": "Mom",
      "url": "https://pence.family/~mom/"
    },
    {
      "name": "Dad",
      "url": "https://pence.family/~dad/"
    },
    {
      "name": "Jesse",
      "url": "https://pence.family/~jesse/"
    }
  ],
  "items": [
    {
      "id": "urn:uuid:...",
      "authors": [
        {
          "name": "Dad",
          "url": "https://pence.family/~dad/"
        }
      ],
      "content_text": "Reminder: family dinner Sunday at 5pm!",
      "date_published": "2025-12-07T10:00:00Z",
      "_version": 1,
      "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcGVuY2UuZmFtaWx5L35kYWQva2V5cy5qc29uI2tleS0xIn0..signature"
    }
  ]
}
```

Each item is signed by its author. The item-level `authors` field specifies who wrote that specific item.

### Edited Post (Versioning)

```json
{
  "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "authors": [{ "url": "https://pence.family/~mom/" }],
  "_feed_url": "https://pence.family/~mom/feed.json",
  "content_text": "The grandkids came over today! We made chocolate chip cookies.",
  "date_published": "2025-12-07T14:30:00Z",
  "date_modified": "2025-12-07T15:00:00Z",
  "_version": 2,
  "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcGVuY2UuZmFtaWx5L35tb20va2V5cy5qc29uI2tleS0xIn0..newsignature"
}
```

When a key's `iat` is checked, verifiers use `date_modified` (the actual signing time) if present, else `date_published`. This is what lets you re-sign an old post with a new key after rotation without it being rejected as "signed before the key existed."

### Reply Interaction

```json
{
  "type": "reply",
  "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "target": "https://pence.family/~mom/feed.json",
  "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "author": "https://pence.family/~dad/",
  "content": "Those cookies were delicious!",
  "published": "2025-12-07T16:00:00Z",
  "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcGVuY2UuZmFtaWx5L35kYWQva2V5cy5qc29uI2tleS0xIn0..signature"
}
```

### Nested Reply (Threading)

```json
{
  "type": "reply",
  "id": "urn:uuid:772fa622-g4bd-63f6-c938-668877662222",
  "target": "https://pence.family/~mom/feed.json",
  "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "_in_reply_to": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "author": "https://pence.family/~jesse/",
  "content": "I helped make them!",
  "published": "2025-12-07T16:30:00Z",
  "_sig": "..."
}
```

The `_in_reply_to` field points to Dad's reply, creating a nested thread. Clients can display this as flat or nested.

### Like Interaction

```json
{
  "type": "like",
  "id": "urn:uuid:772fa622-g4bd-63f6-c938-668877662222",
  "target": "https://pence.family/~mom/feed.json",
  "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "author": "https://alice.example/",
  "published": "2025-12-07T17:00:00Z",
  "_sig": "..."
}
```

### Delete Interaction

```json
{
  "type": "delete",
  "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "target": "https://pence.family/~mom/feed.json",
  "author": "https://pence.family/~dad/",
  "published": "2025-12-07T18:00:00Z",
  "_sig": "..."
}
```

### Mention Interaction

```json
{
  "type": "mention",
  "id": "urn:uuid:883gb733-h5ce-74g7-d049-779988773333",
  "target": "https://pence.family/~mom/",
  "source": "https://alice.example/feed.json#post-456",
  "author": "https://alice.example/",
  "published": "2025-12-07T19:00:00Z",
  "_sig": "..."
}
```

### Webmention Delivery (Alternative)

Instead of POSTing to an inbox, you can publish a reply to your own feed and send a Webmention:

**1. Publish reply to your feed:**

```json
{
  "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "authors": [{ "url": "https://pence.family/~dad/" }],
  "_feed_url": "https://pence.family/~dad/feed.json",
  "content_text": "Those cookies were delicious!",
  "date_published": "2025-12-07T16:00:00Z",
  "_reply_to": "https://pence.family/~mom/posts/cookies",
  "_sig": "..."
}
```

**2. Send Webmention:**

```
POST /~mom/webmention HTTP/1.1
Host: pence.family
Content-Type: application/x-www-form-urlencoded

source=https://pence.family/~dad/feed.json&target=https://pence.family/~mom/posts/cookies
```

The receiver fetches your feed, finds the signed reply, and verifies it.

### WebFinger Discovery

Users can be discovered via `@user@domain` format:

```
GET /.well-known/webfinger?resource=acct:mom@pence.family HTTP/1.1
Host: pence.family
```

Response:

```json
{
  "subject": "acct:mom@pence.family",
  "aliases": ["https://pence.family/~mom/"],
  "links": [
    {
      "rel": "self",
      "type": "text/html",
      "href": "https://pence.family/~mom/"
    },
    {
      "rel": "jwks",
      "type": "application/jwk-set+json",
      "href": "https://pence.family/~mom/keys.json"
    },
    {
      "rel": "feed",
      "type": "application/feed+json",
      "href": "https://pence.family/~mom/feed.json"
    }
  ]
}
```

### Thread Discovery (Replies Endpoint)

To discover replies to a post, query the author's replies endpoint:

```
GET /~mom/replies?item=urn:uuid:550e8400-e29b-41d4-a716-446655440000
```

Response:

```json
{
  "item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "replies": [
    {
      "type": "reply",
      "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
      "target": "https://pence.family/~mom/feed.json",
      "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "author": "https://pence.family/~dad/",
      "content": "Those cookies were delicious!",
      "published": "2025-12-07T16:00:00Z",
      "_sig": "..."
    },
    {
      "type": "reply",
      "id": "urn:uuid:772fa622-g4bd-63f6-c938-668877662222",
      "target": "https://pence.family/~mom/feed.json",
      "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "_in_reply_to": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
      "author": "https://pence.family/~jesse/",
      "content": "I helped make them!",
      "published": "2025-12-07T16:30:00Z",
      "_sig": "..."
    }
  ],
  "next_url": null
}
```

Each reply is reproduced **verbatim** as received (so its signature still verifies) — the server must not inject or drop fields. A direct reply to the item simply omits `_in_reply_to` (don't serialize it as `null`); a nested reply includes it, pointing at its parent. The `_in_reply_to` field builds the thread tree. Clients can display flat or nested.

### Outbox (Sent Interactions)

Your outbox contains interactions you've sent (requires authentication):

```
GET /~dad/outbox
Authorization: Bearer {token}
```

Response:

```json
{
  "interactions": [
    {
      "delivered": true,
      "delivered_at": "2025-12-07T16:00:01Z",
      "interaction": {
        "type": "reply",
        "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
        "target": "https://pence.family/~mom/feed.json",
        "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
        "author": "https://pence.family/~dad/",
        "content": "Those cookies were delicious!",
        "published": "2025-12-07T16:00:00Z",
        "_sig": "..."
      }
    }
  ]
}
```

Delivery metadata (`delivered`, `delivered_at`) lives in an envelope *around* the signed `interaction`, never inside it — adding fields to the signed object would invalidate its signature.

---

## Implementation Guidance

### Recommended Limits

These are SHOULD-level recommendations. Implementations MAY support more.

| Limit                              | Recommended Minimum              |
| ---------------------------------- | -------------------------------- |
| Post text length                   | 10,000 characters                |
| Feed items                         | 50 recent items (paginate older) |
| Attachments per item               | 10                               |
| Attachment size                    | 50 MB                            |
| Interactions per hour (per author) | 100                              |

### Caching Strategy

| Resource      | Recommended Cache                 |
| ------------- | --------------------------------- |
| Profile HTML  | 1 hour                            |
| JWKS document | 1 hour (or until signature fails) |
| Feed JSON     | 5 minutes (or use ETags)          |
| Profile JSON  | 1 hour                            |

### Interaction Delivery

When sending interactions:

1. Attempt delivery immediately
2. On failure (5xx, timeout), retry with exponential backoff
3. Retry schedule: 1 min, 5 min, 30 min, 2 hours, 8 hours, 24 hours
4. Give up after 24 hours of failures
5. Log failures for user visibility

### Spam Mitigation

Recommended approaches (pick what fits your use case):

1. **Rate limiting** - 100 interactions/hour per author identity
2. **Moderation queue** - Unknown authors go to review by default
3. **Allowlists** - Only accept from known identities (opt-in)
4. **Silent drop** - Blocked authors get 202 Accepted but content is discarded

### Key Management by Use Case

| Use Case      | Recommended Approach                                 |
| ------------- | ---------------------------------------------------- |
| Family hub    | Hub-managed keys. Admin is trusted. Simplicity wins. |
| Personal blog | Client-side keys with password-encrypted backup      |
| High security | Hardware keys (WebAuthn) with recovery keys          |

### Recovery Keys

For domain loss scenarios, generate a recovery key at identity creation:

```json
{
  "keys": [
    {
      "kid": "primary-1",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "..."
    },
    {
      "kid": "recovery-1",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "...",
      "use": "recovery"
    }
  ]
}
```

Store the recovery private key securely offline (not on the hub). Create a recovery attestation signed by your primary key. If you lose access to your domain, you can claim succession at a new location using the recovery key.

See specification section 3.6 for full details.

### Signature Verification

When verifying signatures:

1. Determine the **claimed author**: for a feed item, an entry in the item's signed `authors` array; for an interaction, the top-level `author`.
2. Fetch that author's profile (follow redirects, max 5; profile itself must not redirect cross-origin)
3. Discover `rel="jwks"` link
4. Parse the signature header for `kid` (format: `{jwks_url}#{key_id}`). **The `jwks_url` MUST match a JWKS URL from the claimed author's profile** — never trust a key just because it verifies; confirm the identity owns it.
5. Fetch JWKS document and find the key matching `key_id` (confirm `crv` is `Ed25519`, not just `alg=EdDSA`)
6. Check key's `iat` (issued-at) is before the content's **effective signing time** — `date_modified` if present, else `date_published`/`published` (if `iat` present)
7. Check key's `revoked_at` is absent or after the effective signing time
8. Canonicalize content (byte-exact RFC 8785 — strings are signed as published; producers should emit NFC. Reject JSON with duplicate object keys.)
9. Reconstruct the JWS Signing Input (`base64url(header)` + `.` + canonical bytes) and verify the Ed25519 signature over it. The signature covers the header **and** payload (RFC 7797 unencoded payload, `b64:false`); signing only the payload bytes is invalid and insecure.

If JWKS fetch fails temporarily, cache the failure and retry later (1 hour, 4 hours, 24 hours). Don't reject content permanently due to transient errors.

---

## Extensions

### Field Conventions

Extension fields on JSON objects MUST be prefixed with `_` (underscore).

Implementations MUST preserve unknown `_` fields when re-serializing.

**Common extensions:**

| Field              | Purpose                                   |
| ------------------ | ----------------------------------------- |
| `_content_warning` | Content warning text (string)             |
| `_deleted`         | Tombstone marker for deleted items (spec §5.4.1) |
| `_language`        | BCP 47 language tag for item              |
| `_sha256`          | SHA-256 hash of attachment bytes (base64) |
| `_history_url`     | URL to version history document           |
| `_in_reply_to`     | ID of parent interaction for threading    |

### Custom Interaction Types

Custom interaction types MUST be prefixed with `x-`.

Example: `x-emoji-react` for emoji reactions.

Implementations SHOULD store unknown interaction types but MAY hide them from display.

### Emoji Reactions

```json
{
  "type": "x-emoji-react",
  "id": "urn:uuid:...",
  "target": "https://example.com/~alice/feed.json",
  "target_item": "urn:uuid:...",
  "author": "https://bob.example/",
  "emoji": "❤️",
  "published": "...",
  "_sig": "..."
}
```

The `emoji` field MUST contain a single emoji (one or more Unicode codepoints forming a single grapheme cluster).

Multiple reactions from the same author to the same item are allowed (different emoji). To change a reaction, send a `delete` for the old one and a new reaction.

### Quote Posts

To quote another post, publish a regular feed item with `_quote_of`:

```json
{
  "id": "urn:uuid:...",
  "content_text": "This is such a great point!",
  "_quote_of": {
    "url": "https://alice.example/feed.json",
    "item_id": "urn:uuid:original-post-id"
  },
  "date_published": "...",
  "_sig": "..."
}
```

After publishing, send a `mention` interaction to notify the quoted author:

```json
{
  "type": "mention",
  "id": "urn:uuid:...",
  "target": "https://alice.example/",
  "source": "https://bob.example/feed.json#your-quote-post-id",
  "author": "https://bob.example/",
  "published": "...",
  "_sig": "..."
}
```

Clients displaying quotes SHOULD fetch and verify the quoted content.

---

## Conventions (Non-Normative)

These are recommended patterns, not requirements.

### Following Lists

To publish who you follow, add to your profile:

```html
<link
  rel="following"
  href="https://example.com/~alice/following.json"
  type="application/json"
/>
```

Format:

```json
{
  "following": ["https://pence.family/~mom/", "https://bob.example/"],
  "updated": "2025-12-07T00:00:00Z"
}
```

This is optional. Follow lists may be kept private (client-local).

### Content Warnings

```json
{
  "id": "...",
  "_content_warning": "Discussion of illness",
  "content_text": "...",
  "_sig": "..."
}
```

Clients SHOULD hide content behind the warning until user opts to view.

### Alt Text for Images

Use JSON Feed's `title` field on attachments:

```json
{
  "attachments": [
    {
      "url": "https://example.com/photo.jpg",
      "mime_type": "image/jpeg",
      "title": "Sunset over mountains with orange and purple sky"
    }
  ]
}
```

### Media Integrity

For integrity verification, include SHA-256 hash:

```json
{
  "attachments": [
    {
      "url": "https://example.com/photo.jpg",
      "mime_type": "image/jpeg",
      "_sha256": "base64-encoded-sha256-hash"
    }
  ]
}
```

Clients MAY verify the hash after download. Note: this breaks if media is transcoded.

---

## Known Concerns & Limitations

### Discovery

**Problem:** How do you find people?

**Current approach:** Out-of-band sharing. Share your identity URL like an email address - in person, on business cards, on other social media.

**Future options:** Hub directories, WebSub for aggregators, search engine indexing.

### Spam and Abuse

**Problem:** Anyone can create an identity and flood inboxes.

**Current approach:** Rate limiting by author and IP. Moderation queues for unknown authors.

**Mitigations:** Allowlists (only known authors). Hub reputation (block bad hubs). Proof of work (not recommended - hurts legitimate users).

### Timestamp Trust

**Problem:** Timestamps are self-reported. Backdating is possible.

**Current approach:** Accept self-reported timestamps. Inboxes record receipt time as a lower bound.

**Future option:** RFC 3161 trusted timestamps via `_timestamp_proof` extension.

### Hub Trust

**Problem:** Hub admins can impersonate users (if they hold keys).

**Current approach:** Document the trust model explicitly. For family hubs, this is a feature (admin can help with recovery). For others, use client-side keys.

**Mitigations:** Client-side key generation. Transparency logs for auditing.

### Legal and Deletion

**Problem:** GDPR right to deletion vs. distributed caching.

**Current approach:** Deletion is best-effort. Publish a signed tombstone version of the item (`_deleted: true`, spec §5.4.1); consumers that re-fetch drop their cached copy. Caches that never re-fetch may not honor deletion.

This is the same limitation as email or any federated system.

### Feed Scalability

**Problem:** Feeds can grow indefinitely.

**Current approach:** JSON Feed pagination via `next_url`. Recommend keeping 50 recent items in main feed, archive older items.

### Offline Delivery

**Problem:** If recipient's inbox is down, interactions are lost.

**Current approach:** Sender retry with exponential backoff for 24 hours.

**Alternative:** Hub-level outbox that handles delivery (hub sees all outgoing interactions).

---

## Migration

### Changing Identity URLs

To migrate from `https://old.example/~alice/` to `https://alice.new/`:

1. Set up new identity with new keypair at `https://alice.new/`
2. At old identity, add:
   ```html
   <link rel="canonical" href="https://alice.new/" />
   <link rel="successor" href="https://alice.new/" />
   ```
3. Post a signed migration notice at old identity
4. Cross-sign: post at new identity signed by old key (proves control of both)
5. Followers should follow `rel="successor"` and update references

**Note on redirects:** A cross-origin migration is expressed with the `rel="successor"`/`rel="canonical"` links above, served at the old URL — *not* by 301-redirecting the old profile to the new domain. Verifiers must not follow a cross-origin redirect on a profile document (spec §2.3), because that would let any domain that can hijack a redirect claim to be you. Same-origin path changes (e.g., `/~alice/` → `/users/alice/` on the same host) may use ordinary redirects.

### Key Rotation

1. Generate new keypair
2. Add new key to pubkey document (array supports multiple keys)
3. Start signing new content with new key
4. Optionally set `revoked_at` timestamp on old key
5. Keep old key in document for at least 30 days (for verification of old content)

### Key Compromise

1. Immediately add new key to pubkey document
2. Set `revoked_at` on compromised key with earliest known compromise time
3. Re-sign recent posts with new key (same `id`, new `_version`, and set `date_modified` to the re-signing time so the new key's `iat` check passes)
4. Notify followers through out-of-band channels

Interactions signed with the compromised key after `revoked_at` should be rejected. **Caveat:** because timestamps are self-reported, a thief can backdate forged content to before `revoked_at` and slip past the revocation check. Revocation mainly limits damage from an *honestly* rotated key; it does not stop an active attacker who holds your key. For interactions, receivers should apply the revocation check against inbox **receipt time**, not the sender's `published` value (see spec §10.12). This is why key theft is treated as unrecoverable without out-of-band trust re-establishment. If you publish a Key History Chain, co-sign your first post-compromise JWKS version with a recovery key (`_recovery_sig`, spec §3.7.6) — anyone who detects the thief's competing chain can then tell which branch is really you.

---

## Relationship to Other Protocols

### vs ActivityPub

ActivityPub is comprehensive but complex. It requires JSON-LD, HTTP Signatures, and understanding a large vocabulary (Create, Note, Announce, etc.).

Open Feed is deliberately minimal. `_` prefixed extensions instead of JSON-LD. JWS instead of HTTP Signatures. Feeds instead of outboxes.

**Why not JSON-LD?** JSON-LD solves a real problem -- vocabulary collision between extensions -- but at a cost Open Feed can't afford:

- **It breaks byte-exact signing.** A JSON-LD document has no single canonical serialization; the same graph can be expressed many ways, so signing it requires RDF canonicalization (the source of ActivityPub's Linked Data Signatures woes). Open Feed signs exact bytes via RFC 8785, which only works because documents are plain JSON.
- **It requires remote context resolution.** Interpreting a document means fetching `@context` URLs -- an SSRF, availability, and mutability surface that Open Feed simply doesn't have.
- **In practice, nobody uses it anyway.** Most ActivityPub implementations treat JSON-LD as plain JSON with a magic `@context` string. Open Feed makes that de facto practice normative.

Instead, Open Feed inherits JSON Feed's answer to extensibility: `_` prefixed fields with mandatory preservation of unknown fields. Collisions are avoided by convention rather than by namespace machinery.

**Bridge possibility:** Map JSON Feed items to AS2 Note objects. Map interactions to ActivityPub activities.

### vs AT Protocol (Bluesky)

AT Protocol is technically decentralized but practically Bluesky-centric. It has complex concepts (DIDs, repos, lexicons) and requires significant infrastructure.

Open Feed is simpler and works with static hosting. No DID resolution, no repo sync.

**Bridge possibility:** Map identities to did:web. Map feed items to app.bsky.feed.post records.

### vs RSS/Atom

Open Feed builds on JSON Feed, which is the modern JSON equivalent of RSS/Atom.

Plain RSS readers can consume the feed (ignoring signatures). Open Feed adds authentication and interactions.

**Recommendation:** Publish Atom alongside JSON Feed for maximum compatibility.

---

## FAQ

**Q: Why not just use ActivityPub?**

A: ActivityPub is great but complex. If you need a weekend project to publish signed content with interactions, Open Feed is simpler.

**Q: Why Ed25519 specifically?**

A: It's fast, secure, has small signatures, and is widely implemented. Future versions may add post-quantum algorithms.

**Q: Can I run a hub on static hosting?**

A: Partially. Feeds and profiles work on static hosting. Inboxes require a server (even a serverless function).

**Q: Is this compatible with Mastodon?**

A: Not directly. A bridge could translate between protocols. This is out of scope for v1.

**Q: How do I handle private content?**

A: Restricted-visibility feeds are supported via **Authorized Fetch** (spec §8.2). A reader proves who they are by signing the GET request with a short-lived self-signed EdDSA token (using the same Ed25519 keys they already have); the serving hub checks that identity against the feed owner's authorized-reader list. This works **across hubs** with no shared passwords or pre-provisioned tokens — Jesse's self-hosted reader can fetch Mom's family-only feed on `pence.family` just by signing the request.

Simpler options also work:

- **Private hub**: Run a hub where all content is behind auth by default.
- **Capability URLs**: Unguessable per-follower feed URLs (no cryptographic identity, but dead simple on static hosting).

Note: Authorized Fetch is **audience control, not confidentiality** — the serving hub can still read the content. For family hubs where you trust the admin, this is fine. For true privacy where even the hub can't read content, you'd need an encryption layer on top (out of scope for this protocol).

**Q: What if my hub operator is malicious?**

A: If they hold your keys, they can impersonate you. Use client-side keys if you don't trust your hub. Or run your own.

**Q: How do I send a private message?**

A: Private messaging is implemented as restricted-visibility feeds:

1. Create a feed whose authorized-reader list is just you and the recipient
2. Post your message to that feed
3. The recipient reads it via Authorized Fetch (spec §8.2) — their client signs the GET, your hub verifies their identity and serves it

This is the same mechanism as group chats—just with an audience of two. The hub controls who can read which feeds. As above, this is audience control, not end-to-end encryption: the hub can read the messages.

**Q: Can multiple people post to the same feed?**

A: Yes! Feeds can have multiple authors. Each item is signed by its author (who must be listed in the feed's or item's `authors` array). This enables family message boards, team feeds, collaborative journals, etc.

---

## Contributing

This is a draft specification. Feedback welcome.

- **Issues:** Technical problems, ambiguities, missing features
- **Proposals:** New interaction types, extension fields, bridge specs

The goal is to keep the spec minimal. If it can be an extension, it should be an extension.

---

## Acknowledgments

This spec synthesizes ideas from IndieWeb, ActivityPub, AT Protocol, JSON Feed, and the broader conversation about what decentralized social could look like if we prioritized simplicity.
