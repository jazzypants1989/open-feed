# Open Feed Protocol

**Version 0.1.0 — Draft**

A minimal convention for decentralized publishing and interaction, built entirely on existing standards.

## Goals

1. Anyone can publish signed content from a URL they control
2. Anyone can run a small identity hub for friends, family, or colleagues
3. Interactions (replies, reactions) are authenticated and verifiable
4. The spec is small enough to implement in a weekend
5. Private content is out of scope — this governs only public, verifiable content

## Non-Goals

- Replacing email, messaging, or private communication
- Specifying storage formats, sync mechanisms, or local-first architectures
- Mandating specific UI patterns or AI integration
- Solving content moderation at the protocol level

---

## 1. Identity

An identity is a URL. The URL must:

- Use HTTPS
- Return an HTML document (the profile)
- Be treated as case-sensitive
- Include a trailing slash when stored or compared (normalize `/~mom` to `/~mom/`)

Examples:

```
https://alice.example/
https://pence.family/~mom/
https://jovialpenguin.com/~contractor/
```

### 1.1 Profile Document

The profile is an HTML page containing `<link>` elements for discovery:

```html
<!DOCTYPE html>
<html>
  <head>
    <link
      rel="authorization_endpoint"
      href="https://example.com/auth/authorize"
    />
    <link rel="token_endpoint" href="https://example.com/auth/token" />
    <link rel="pubkey" href="https://example.com/~alice/pubkey" />
    <link
      rel="feed"
      href="https://example.com/~alice/feed.json"
      type="application/feed+json"
    />
    <link rel="inbox" href="https://example.com/~alice/inbox" />
  </head>
  <body>
    <!-- Human-readable profile content -->
  </body>
</html>
```

All endpoints are optional except `pubkey` (required for signature verification).

### 1.2 Hub Metadata (Optional)

A hub may publish metadata at `/.well-known/open-feed-hub.json`:

```json
{
  "version": "0.1.0",
  "name": "Pence Family Hub",
  "admin_contact": "jesse@pence.family",
  "users_endpoint": "https://pence.family/users.json"
}
```

The `users_endpoint`, if present, returns a list of identity URLs hosted on this hub. This aids discovery but is not required.

---

## 2. Keys and Signatures

### 2.1 Key Format

Keys are published at the URL specified by `rel="pubkey"`. The document must be JSON:

```json
{
  "keys": [
    {
      "id": "https://pence.family/~mom/pubkey#key-1",
      "type": "Ed25519",
      "public": "base64-encoded-32-bytes",
      "created": "2025-12-01T00:00:00Z",
      "revoked": null
    }
  ]
}
```

**Fields:**

| Field     | Required | Description                                               |
| --------- | -------- | --------------------------------------------------------- |
| `id`      | Yes      | Unique identifier for this key (URI fragment recommended) |
| `type`    | Yes      | Algorithm. Initially only `Ed25519` is defined.           |
| `public`  | Yes      | Base64-encoded public key bytes                           |
| `created` | Yes      | ISO 8601 timestamp                                        |
| `revoked` | No       | ISO 8601 timestamp if revoked, otherwise `null` or absent |

### 2.2 Key Rotation

To rotate keys:

1. Generate a new keypair
2. Add the new key to the `keys` array
3. Optionally set `revoked` on the old key

Old signatures remain valid if verified against the key that created them (identified by `kid` in the signature). Verifiers should reject signatures made after a key's `revoked` timestamp.

### 2.3 Signature Format

Signatures use JWS Compact Serialization (RFC 7515) with detached payload:

```
base64url(header).payload-not-included.base64url(signature)
```

The header must include:

```json
{
  "alg": "EdDSA",
  "kid": "https://pence.family/~mom/pubkey#key-1"
}
```

The `kid` (key ID) tells verifiers which key to use.

### 2.4 Canonicalization

Before signing, JSON must be canonicalized:

1. Serialize to UTF-8
2. No whitespace between tokens
3. Object keys sorted lexicographically (recursively)
4. No trailing commas
5. Numbers as-is (no scientific notation normalization)

The `_sig` field, if present, must be removed before canonicalization.

This matches RFC 8785 (JSON Canonicalization Scheme).

### 2.5 Algorithm Agility

Implementations must:

- Support `Ed25519` (identified as `EdDSA` in JWS)
- Ignore keys with unrecognized `type` values
- Reject signatures with unrecognized `alg` values

Future versions may define additional algorithms (e.g., post-quantum). Hubs can publish multiple keys with different algorithms during migration periods.

---

## 3. Feeds

Feeds use JSON Feed 1.1 (https://jsonfeed.org/version/1.1) with extensions.

### 3.1 Feed Document

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
  "items": []
}
```

The `authors[].url` must match the identity URL.

### 3.2 Feed Items

```json
{
  "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "content_text": "The grandkids came over today!",
  "date_published": "2025-12-07T14:30:00Z",
  "_sig": "eyJhbGciOiJFZERTQSIsImtpZCI6Imh0dHBzOi8vcGVuY2UuZmFtaWx5L35tb20vcHVia2V5I2tleS0xIn0..base64sig"
}
```

**Extension fields (prefixed with `_`):**

| Field       | Required | Description                                                     |
| ----------- | -------- | --------------------------------------------------------------- |
| `_sig`      | Yes      | JWS signature over the canonicalized item (with `_sig` removed) |
| `_reply_to` | No       | URL of the post this is replying to (for threaded posts)        |
| `_mentions` | No       | Array of identity URLs mentioned in this post                   |

### 3.3 Item IDs

Item `id` must be globally unique. Recommended formats:

- UUID URN: `urn:uuid:...`
- Tag URI: `tag:pence.family,2025-12-07:mom:001`
- Fragment URL: `https://pence.family/~mom/feed.json#2025-12-07-001`

Once published, an item's `id` must never change.

### 3.4 Media Attachments

Use the standard JSON Feed `attachments` array:

```json
{
  "id": "...",
  "content_text": "Photo from the park",
  "attachments": [
    {
      "url": "https://pence.family/~mom/media/park-2025-12-07.jpg",
      "mime_type": "image/jpeg",
      "size_in_bytes": 245000
    }
  ],
  "_sig": "..."
}
```

Media hosting is an implementation concern. The signature covers the `attachments` metadata but not the media bytes themselves.

---

## 4. Interactions

Interactions are signed JSON payloads sent to an identity's inbox.

### 4.1 Interaction Object

```json
{
  "type": "reply",
  "id": "urn:uuid:...",
  "target": "https://pence.family/~mom/feed.json",
  "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "author": "https://pence.family/~dad/",
  "content": "Great photo! Was that at the park?",
  "published": "2025-12-07T15:45:00Z",
  "_sig": "..."
}
```

**Fields:**

| Field         | Required | Description                                                         |
| ------------- | -------- | ------------------------------------------------------------------- |
| `type`        | Yes      | Interaction type (see 4.2)                                          |
| `id`          | Yes      | Globally unique identifier                                          |
| `target`      | Yes      | Feed URL being interacted with                                      |
| `target_item` | No       | Specific item ID within the feed (omit for feed-level interactions) |
| `author`      | Yes      | Identity URL of the interaction author                              |
| `content`     | Varies   | Text content (required for `reply`, optional otherwise)             |
| `published`   | Yes      | ISO 8601 timestamp                                                  |
| `_sig`        | Yes      | JWS signature by the author                                         |

### 4.2 Interaction Types

| Type       | Description                          | `content`         |
| ---------- | ------------------------------------ | ----------------- |
| `reply`    | A textual response                   | Required          |
| `like`     | An endorsement                       | Not used          |
| `repost`   | Sharing to one's own feed            | Not used          |
| `bookmark` | Private save (notification optional) | Not used          |
| `flag`     | Report for moderation                | Optional (reason) |

Implementations may define additional types prefixed with `x-` (e.g., `x-emoji-react`). Unknown types should be stored but may be hidden from display.

### 4.3 Interaction Updates and Deletes

To update an interaction, send a new interaction with the same `id` and a later `published` timestamp. The signature must be valid.

To delete, send:

```json
{
  "type": "delete",
  "id": "urn:uuid:...",
  "target": "...",
  "author": "...",
  "published": "...",
  "_sig": "..."
}
```

The `id` must match the interaction being deleted. Implementations should remove or hide the original.

### 4.4 Replay Prevention

Interactions must include `target` (the feed URL). Inbox implementations should reject interactions where:

- The `target` doesn't match the inbox owner's feed
- The `id` has already been received (duplicate)
- The `published` timestamp is more than 7 days in the past or future

---

## 5. Inbox

An inbox receives interactions via HTTP POST.

### 5.1 Endpoint

```
POST /~mom/inbox
Content-Type: application/json

{...interaction object...}
```

### 5.2 Verification

The inbox must:

1. Parse the interaction JSON
2. Extract `author` URL
3. Fetch the author's profile, discover `rel="pubkey"`
4. Fetch the pubkey document
5. Find the key matching the `kid` in the signature
6. Verify the signature against the canonicalized interaction
7. Check the key was not revoked before `published`
8. Validate replay prevention rules (section 4.4)

### 5.3 Responses

| Status                  | Meaning                                   |
| ----------------------- | ----------------------------------------- |
| `202 Accepted`          | Interaction received and queued           |
| `400 Bad Request`       | Malformed JSON or missing required fields |
| `401 Unauthorized`      | Invalid signature or revoked key          |
| `403 Forbidden`         | Author is blocked                         |
| `404 Not Found`         | Target item doesn't exist                 |
| `409 Conflict`          | Duplicate interaction ID                  |
| `429 Too Many Requests` | Rate limited                              |

The inbox should not distinguish between "moderation queue" and "auto-approved" in the response.

### 5.4 Rate Limiting

Implementations should rate limit by:

- Author identity (e.g., 100 interactions/hour)
- Source IP (fallback for bad actors)

Rate limits are implementation-specific and not part of this spec.

---

## 6. Authentication

Authentication to a hub (for posting, managing identity, etc.) uses OAuth 2.0 with IndieAuth discovery.

### 6.1 Discovery

The profile document links to endpoints:

```html
<link rel="authorization_endpoint" href="..." />
<link rel="token_endpoint" href="..." />
```

### 6.2 Flow

Standard OAuth 2.0 Authorization Code flow:

1. Client redirects to authorization endpoint
2. User authenticates (WebAuthn, magic link, etc.)
3. Authorization endpoint redirects back with code
4. Client exchanges code for tokens at token endpoint

Authentication method (WebAuthn vs. magic link) is an implementation choice, not part of this spec.

### 6.3 Tokens

Access tokens should be short-lived JWTs (1 hour).
Refresh tokens should be longer-lived (2-4 weeks) and stored server-side.

Token format is implementation-specific but must include the identity URL as the subject.

### 6.4 Scopes

Recommended scopes:

| Scope                 | Allows                           |
| --------------------- | -------------------------------- |
| `profile`             | Read profile information         |
| `feed:read`           | Read private feed items (if any) |
| `feed:write`          | Publish to feed                  |
| `interactions:read`   | Read received interactions       |
| `interactions:manage` | Approve/reject interactions      |

---

## 7. Migration

### 7.1 Identity Portability

To migrate from `https://old.example/~alice/` to `https://alice.new/`:

1. Set up the new identity with a new keypair
2. Publish a migration notice at the old identity:

```html
<link rel="canonical" href="https://alice.new/" />
<link rel="successor" href="https://alice.new/" />
```

3. Optionally, publish a signed migration post:

```json
{
  "id": "...",
  "content_text": "I've moved to https://alice.new/",
  "_migration": {
    "from": "https://old.example/~alice/",
    "to": "https://alice.new/",
    "effective": "2025-12-07T00:00:00Z"
  },
  "_sig": "..."
}
```

4. Cross-sign: publish a post at the new identity signed by the old key, proving control of both

Implementations should follow `rel="successor"` and update stored identity references.

### 7.2 Key Compromise

If a key is compromised:

1. Add a new key to the pubkey document
2. Set `revoked` on the compromised key with the earliest known compromise time
3. Re-sign recent posts with the new key
4. Notify followers (implementation-specific)

Interactions received with the compromised key after the `revoked` timestamp should be rejected.

---

## 8. Security Considerations

### 8.1 Signature Trust Model

Signatures prove that content was created by whoever controls the private key for an identity. They do not prove:

- When the content was created (timestamps are self-reported)
- That the identity belongs to a particular real-world person
- That the content is true or trustworthy

Hub operators can forge content for identities they host. Choose hubs you trust, or run your own.

### 8.2 Key Storage

Private keys should be stored encrypted at rest. For browser-based apps, consider:

- WebAuthn/FIDO2 for key storage
- Encrypted backup to hub (recoverable by hub admin — this is a feature for family hubs, a risk for others)

### 8.3 TLS Requirements

All URLs must use HTTPS. Implementations must validate certificates and should pin known hubs if possible.

### 8.4 Content Security

This spec does not address content filtering, spam detection, or abuse prevention beyond signature verification and rate limiting. These are implementation concerns.

---

## 9. Extensibility

### 9.1 Extension Fields

JSON objects may include additional fields prefixed with `_`. Implementations must preserve unknown `_` fields when re-serializing.

### 9.2 Extension Types

Interaction types prefixed with `x-` are reserved for implementation-specific extensions.

### 9.3 Versioning

Breaking changes require a new spec version. The version is indicated in `/.well-known/open-feed-hub.json` and may be included in signed objects:

```json
{
  "_spec": "0.1.0",
  ...
}
```

Implementations should accept objects without `_spec` as version 0.1.x.

---

## 10. Conformance

### 10.1 Identity Provider (Hub)

A conforming hub must:

- Serve profile documents with required `<link>` elements
- Publish valid pubkey documents
- Provide an inbox endpoint (section 5)
- Implement OAuth 2.0 for authenticated operations

### 10.2 Publishing Client

A conforming client must:

- Produce valid signatures (section 2)
- Generate globally unique item IDs
- Canonicalize JSON per RFC 8785

### 10.3 Consuming Client

A conforming client must:

- Verify signatures before trusting content
- Check key revocation status
- Handle unknown interaction types gracefully

---

## Appendix A: Example Flows

### A.1 Publishing a Post

```
1. User writes post in client app
2. Client canonicalizes post JSON (without _sig)
3. Client signs with user's private key
4. Client adds _sig to post
5. Client uploads updated feed.json to hub
```

### A.2 Sending a Reply

```
1. Reader writes reply in their client
2. Client constructs interaction object
3. Client signs with reader's private key
4. Client discovers author's inbox via profile
5. Client POSTs interaction to inbox
6. Inbox verifies signature and stores interaction
```

### A.3 Verifying a Post

```
1. Client fetches feed.json
2. For each item, extract _sig and remove it
3. Canonicalize the item
4. Fetch author's pubkey document via profile
5. Find key matching kid in signature
6. Verify signature
7. Check key was created before and not revoked before item's date_published
```

---

## Appendix B: JSON Schemas

Available at: `https://openfeed.example/schemas/0.1/`

- `pubkey.schema.json`
- `feed-item.schema.json`
- `interaction.schema.json`

---

## Acknowledgments

This spec is a synthesis of ideas from IndieWeb, ActivityPub, AT Protocol, JSON Feed, and countless conversations about what a simpler approach might look like.

The goal is not novelty but practicality: the minimum viable convention that enables decentralized publishing and interaction without requiring a PhD to implement.
