# Open Feed Protocol

A minimal specification for decentralized publishing and interaction, built entirely on existing standards.

---

## TL;DR

**What it is:** A way to publish signed content from a URL you control, and receive authenticated interactions (replies, likes) from others. Think "blogs with cryptographic signatures, a standard inbox, and a receipt that proves nobody quietly dropped your posts."

**Core concepts:**

1. **Identity** = An HTTPS URL you control (e.g., `https://pence.family/~mom/`).
2. **Identity document** = One signed JSON file at the fixed path `{identity}openfeed.json` — profile, keys, endpoints, and a tamper-evident chain of its own versions. There is no profile HTML to parse and no separate key document.
3. **Feed** = JSON Feed 1.1, items signed with Ed25519.
4. **Manifest** = A separately-signed, chained file that commits to exactly which items your feed contains, so a host can't silently drop, reorder, or roll back your content.
5. **Interactions** = Not a separate object type. A reply, like, repost, quote, or mention **is** a signed feed item carrying a `_rel` relation array, delivered by POSTing it to the recipient's inbox.

**Quick example:**

```
Identity URL: https://pence.family/~mom/         (a human page — optional, nothing reads it)
    ↓ fetch  {identity}openfeed.json
Identity doc: signed JSON — profile + keys + endpoints + version chain
    ↓ it points at  feed  and  manifest
Feed JSON:    signed posts from Mom (JSON Feed 1.1)
Manifest:     signed, chained commitment to which items the feed contains
    ↓ verify
Every item's signature checks against a key in the (pinned) identity doc,
and the manifest proves the feed you got is complete and current.
```

**What makes it different:**

- No blockchain, no tokens, no complex infrastructure.
- Built on four standards and nothing else: HTTPS, JSON Feed 1.1, JOSE (JWK/JWS/JWT), and JSON canonicalization (RFC 8785).
- One signed object model, one signature construction, one verifier.
- The manifest proves **presence**: your host can't make a post disappear without leaving a signed, attributable trace. This is the thing Nostr relays can't do.
- Small enough to implement in a weekend. Publishing works on free static hosting (Netlify, GitHub Pages, Cloudflare).
- Optional `@user@domain` identifiers via WebFinger.

> This README is the friendly companion to the [specification](open-feed-spec.md). The spec **defines**; this document **explains**. Where they differ, the spec wins. Section references (like §9) point into the spec.

---

## Design Philosophy

### Why another protocol?

Existing options are either too complex (ActivityPub requires understanding JSON-LD, HTTP Signatures, and a large vocabulary) or too centralized in practice (AT Protocol is decentralized in theory but Bluesky-centric today). Nostr is beautifully small but relays can silently withhold your notes, and its `npub` keys aren't human identities.

Open Feed asks: what's the _minimum_ needed for signed, verifiable public content with interactions, where your identity is a URL you already understand and nobody can quietly rewrite your history?

The whole protocol is a few conventional files and one endpoint:

```
https://pence.family/~mom/               ← identity URL (human page, optional)
https://pence.family/~mom/openfeed.json  ← identity document (signed: profile + keys + chain)
https://pence.family/~mom/feed.json      ← JSON Feed 1.1, signed items
https://pence.family/~mom/manifest.json  ← signed, chained commitment to the feed's contents
https://pence.family/~mom/inbox          ← POST signed items here (Level 3 only)
```

### Two chains, one discipline

Open Feed pins two things on first contact (trust-on-first-use) and re-checks them forever after:

- The **identity document** is chained (`seq`, `prev`, `_sig`). It versions identity state — keys, profile, endpoints, migration links — which changes rarely (5–20 versions in a lifetime). See §5.
- The **manifest** is chained by the *identical* mechanism, but versions your *content* — which id's are live, which are deleted, at what version. Publishing a post advances the manifest chain, never the identity chain. See §9.

A consumer that has seen you even once will detect a rollback (un-revoking a stolen key, resurrecting a deleted post) or equivocation (showing different people different histories), because both are hash-linked and both are pinned. This is the certificate-transparency bargain: transparency rather than perfect integrity, but transparency with teeth.

### Trust Model

**Be clear about this:** if your hub holds your signing key (the simple default), the admin can sign content as you. That is the same trust model as email — you trust your provider not to read your mail even though they could. For family hubs, this is fine.

But the trust model is a **gradient, not a binary** (§14.2):

- **Key custodian** (hub holds your key): forward impersonation is unpreventable — but even here the hub *cannot silently rewrite the past* against anyone who has pinned you. Deletions must appear as signed tombstones; per-reader rewriting surfaces as a detectable fork.
- **Serving-path compromise** (CDN / static bucket / web tier hacked, but the signing key is elsewhere): the most common real-world attack. The attacker can't sign, so the chains and manifest give **full integrity** — no undetectable omission, rollback, or injection.
- **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full integrity against the host by construction.

Client-side keys move you from the first tier toward the third. They're supported for anyone who wants them.

### What's In Scope

- Signed public content (posts, media references).
- Authenticated interactions (replies, likes, reposts, quotes, mentions) — as signed feed items.
- Key rotation and revocation, verifiable against a pinned chain.
- Identity migration and recovery (one operation).
- Multi-author feeds (family boards, team feeds).
- Nested threading for conversations.
- Anti-omission / anti-rollback proofs via the manifest.

### What's Out of Scope

- End-to-end encrypted content. (Restricted-visibility feeds are an **extension** — see below — but that's audience control, not confidentiality.)
- Global-scale firehoses / aggregators. Open Feed scales *across* identities (each is self-contained and independently verifiable), not to millions of items per identity; the manifest is a deliberate family-scale boundary.
- Content moderation policy (left to hub operators).
- Storage formats and sync protocols (files on disk are fine).
- Specific authentication methods (how you log in to your own hub is your business).
- Protocol bridges (ActivityPub, atproto, Webmention) — feasible as gateways, but out of the core (Appendix F).

---

## Getting Started

### For Users

1. Get an identity URL from a hub (or run your own).
2. Your hub serves your `openfeed.json`, feed, and manifest, and handles key management.
3. Use a client app to post content and interact with others.
4. Share your identity URL like you'd share an email address.

### For Hub Operators

Open Feed defines four conformance levels (§13):

| Level | Name | Description |
| ----- | ---- | ----------- |
| 0 | Consume (non-verifying) | A plain JSON Feed reader that ignores signatures. Works today, no Open Feed code. |
| 1 | Read | Fetch and verify identity docs, feeds, and manifests; pin both chains. No server needed. |
| 2 | Publish | Serve a signed identity doc, feed, and manifest (with histories). Static hosting works. |
| 3 | Interact | Everything in Level 2 plus an inbox endpoint. Requires a server. |

**Level 2 endpoints (static-hosting compatible — every artifact is a file, signed at build time):**

| Path                          | Purpose                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| `/{user}/`                    | Human page (optional; nothing reads it)                     |
| `/{user}/openfeed.json`       | Signed identity document — profile, keys, endpoints, chain  |
| `/{user}/feed.json`           | JSON Feed 1.1 with signed items                             |
| `/{user}/manifest.json`       | Signed, chained commitment to the feed's contents           |
| `/{user}/history.json`        | Index of retained identity-document versions (once `seq > 1`) |
| `/{user}/manifest-history.json` | Index of retained manifest versions (once its `seq > 1`)  |
| `/{user}/export`              | Your complete signed archive, on demand (Level 3, §15)      |

Every public document MUST be served with `Access-Control-Allow-Origin: *` so browser readers work without a proxy.

**Level 3 adds (requires a server):**

| Path              | Purpose                                        |
| ----------------- | ---------------------------------------------- |
| `/{user}/inbox`   | POST endpoint for receiving signed items (§10) |
| `/{user}/replies` | Optional thread discovery (§12)                |

The old `outbox` is gone — your feed *is* your outbox. Webmention and OAuth endpoints are no longer part of the core.

See the [specification](open-feed-spec.md) for full requirements.

### For Client Developers

Your client needs to:

1. **Read** — fetch an identity's `openfeed.json`, feed, and manifest; verify signatures; pin and enforce both chains.
2. **Publish** — sign items, update the feed, advance and re-sign the manifest.
3. **Interact** — a reply/like/etc. is a signed item with a `_rel` array; POST it to the recipient's inbox (and usually publish it in your own feed too).
4. **Receive** — run an inbox, or poll the feeds you follow (the feed is the source of truth).

---

## Examples

All examples use the `https://pence.family/~mom/` family framing. Signatures are shown as `"_sig": "..."` for readability; the spec's Appendix D has real, self-verifying test vectors.

### Identity Document (`openfeed.json`)

This single signed file replaces the old profile HTML, the JWKS document, and the profile-metadata JSON. It lives at the fixed path `{identity}openfeed.json`.

```json
{
  "url": "https://pence.family/~mom/",
  "name": "Mom",
  "bio": "Grandmother, gardener, cat enthusiast.",
  "avatar": "https://pence.family/~mom/avatar.jpg",
  "feeds": [
    { "url": "https://pence.family/~mom/feed.json", "manifest": "https://pence.family/~mom/manifest.json", "rel": "primary" }
  ],
  "inbox": "https://pence.family/~mom/inbox",
  "history": "https://pence.family/~mom/history.json",
  "seq": 7,
  "prev": "aNy3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "updated": 1739577600,
  "keys": [
    { "kid": "key-1", "kty": "OKP", "crv": "Ed25519", "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", "iat": 1736899200 },
    { "kid": "recovery-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "recovery", "iat": 1736899200 }
  ],
  "_sig": "..."
}
```

Notes:

- `feeds` is one array for every feed you publish — entries are `{url, manifest?, rel}`, and `rel: "primary"` names the authoritative one. `manifest` is optional: a feed without one has no completeness proof, which is a reasonable trade for an activity feed of likes and a bad one for anything you'd miss.
- `keys` is a standard array of JWKs (RFC 7517). The `x` field is the base64url Ed25519 public key. `iat`/`revoked_at` are Unix seconds (JOSE convention); content timestamps use ISO 8601 (JSON Feed convention). The `crv`/`use` constraints apply to *signing* keys — extensions can add other key types to the same array, and core verifiers ignore them.
- `seq`/`prev`/`updated`/`_sig` are the version-chain fields. `prev` is the base64url SHA-256 of the *full* previous version's bytes. Genesis (`seq: 1`) has no `prev` or `history`. See §5.
- The identity doc commits to the manifest **by URL, not by hash** — so ordinary publishing advances the manifest chain and never re-signs the identity doc.
- Unknown fields MUST be preserved when re-serializing. Extension fields use a `_` prefix.

### Key identifiers

In a JWS header, the `kid` is the full key identifier `{identity_url}#{kid}` — for example:

```
https://pence.family/~mom/#key-1
```

Verifiers split at the **last** `#`: the left side is the identity URL (fetch `{identity}openfeed.json`), the right side is the `kid` to find in that document's `keys`. Because keys live *inside* the identity's own signed document, key ownership is structural — there's no separate "does this identity really own this key?" check anymore, and possessing a key that merely verifies proves nothing.

### Feed with a Post

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Mom's Feed",
  "home_page_url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "authors": [{ "name": "Mom", "url": "https://pence.family/~mom/" }],
  "items": [
    {
      "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "authors": [{ "url": "https://pence.family/~mom/" }],
      "_feed_url": "https://pence.family/~mom/feed.json",
      "content_text": "The grandkids came over today! We made cookies.",
      "date_published": "2025-12-07T14:30:00Z",
      "_version": 1,
      "_sig": "..."
    }
  ]
}
```

Notes:

- Each item carries its own single-entry `authors` array (the signer) and `_feed_url` **inside the signed bytes**. These cryptographically bind the post to its author and its feed. Feed-level `authors` are *not* signed and carry no authority — clients MUST attribute solely to the item's own `authors` entry (§6.6).
- `_feed_url` drives the canonical/copy rule (§7.5): an item is *canonical* only in the feed its `_feed_url` names. The same signed bytes seen elsewhere (an aggregate feed, a cache, a bridge) are a verifiable *copy* but carry no liveness — to know whether a copy is still live, consult the manifest at its `_feed_url`.
- The signature is a detached JWS with unencoded payload (RFC 7797): header carries `"alg":"EdDSA","b64":false,"crit":["b64"]` plus the `kid`, and the signature covers header **and** payload.

### The Manifest

The manifest is the headline feature. It's a separately-signed, chained document that says exactly which item id's your feed contains and at what version — so a host can't silently drop, reorder, or roll back your content without producing a detectable fork.

```json
{
  "url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "seq": 412,
  "prev": "Jq3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "history": "https://pence.family/~mom/manifest-history.json",
  "updated": 1739577600,
  "items": {
    "urn:uuid:550e8400-e29b-41d4-a716-446655440000": 3,
    "urn:uuid:661f9511-f3ac-52e5-b827-557766551111": 1
  },
  "deleted": { "urn:uuid:99aa2222-...": 4 },
  "_sig": "..."
}
```

- `items` maps each live item id to its current `_version`; `deleted` records tombstoned id's. The per-item content doesn't need a hash here — each item is already signed, and the `_version` pins the exact signed revision.
- A consumer pins the manifest at its `(seq, hash)` and walks `prev` back to that pin on every later fetch — the *same* pin-and-walk discipline as the identity chain (§9.1).
- Invariants (§9.4): an id, once in `items`, must appear in every later manifest (in `items` or `deleted`) until folded into an optional checkpoint. Content can't silently vanish; removal requires a signed tombstone.
- Checkpointing (§9.3) bounds growth for anyone who needs it; a family-scale identity may never bother.

Together, the manifest and `_feed_url` close both gaps: the manifest proves **presence** (a host can't drop your content), and `_feed_url` proves **exclusivity** (a host can't inject or resurrect your content by copying it into its own feed). As a bonus, a follower can serve its cached copy of your feed when your host is down, and it still verifies.

### Multi-Author Feed (Family Board)

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Pence Family Board",
  "feed_url": "https://pence.family/family/feed.json",
  "authors": [
    { "name": "Mom", "url": "https://pence.family/~mom/" },
    { "name": "Dad", "url": "https://pence.family/~dad/" }
  ],
  "items": [
    {
      "id": "urn:uuid:aaa...",
      "authors": [{ "url": "https://pence.family/~dad/" }],
      "_feed_url": "https://pence.family/family/feed.json",
      "content_text": "Reminder: family dinner Sunday at 5pm!",
      "date_published": "2025-12-07T10:00:00Z",
      "_version": 1,
      "_sig": "..."
    }
  ]
}
```

A multi-author feed works because every item names its own single author and is independently signed. The feed-level `authors` list is display-only.

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
  "_sig": "..."
}
```

Same `id` forever; bump `_version`, set `date_modified`, re-sign. The manifest's entry for this id updates to version `2`. When checking a key's `iat`/`revoked_at`, verifiers use the **effective signing time** — `date_modified` if present, else `date_published` — which is what lets you re-sign old content after a key rotation without it being rejected as "signed before the key existed" (§6.5).

### Deleted Post (Tombstone)

```json
{
  "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "authors": [{ "url": "https://pence.family/~mom/" }],
  "_feed_url": "https://pence.family/~mom/feed.json",
  "content_text": "",
  "date_published": "2025-12-07T14:30:00Z",
  "date_modified": "2025-12-09T09:00:00Z",
  "_version": 3,
  "_deleted": true,
  "_sig": "..."
}
```

A delete is a signed tombstone: same `id`, bumped `_version`, `_deleted: true`, content removed (`content_text` emptied to stay JSON-Feed-valid). The manifest moves this id from `items` into `deleted`. Higher `_version` wins, so a replayed earlier copy can't resurrect it (§7.3).

### Interactions Are Items

There is no separate interaction object. An interaction is an ordinary signed item carrying a `_rel` array — one entry per relation, each with a `type` and a target `to`.

**Reply:**

```json
{
  "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "authors": [{ "url": "https://pence.family/~dad/" }],
  "_feed_url": "https://pence.family/~dad/feed.json",
  "content_text": "Those cookies were delicious!",
  "date_published": "2025-12-07T16:00:00Z",
  "_version": 1,
  "_rel": [
    { "type": "reply", "to": "https://pence.family/~mom/feed.json#urn:uuid:550e8400-e29b-41d4-a716-446655440000" }
  ],
  "_sig": "..."
}
```

The `to` is `{feed_url}#{item_id}` (item id's never contain `#`, so receivers resolve relevance by splitting at the last `#`). Dad publishes this in his own feed *and* POSTs the same bytes to Mom's inbox — one object, one signature, nothing to keep in sync.

Core relation types (§8): `reply` and `quote` and `mention` carry content; `like` and `repost` carry none; `root` marks a thread root. Custom relations use an absolute-URL type (e.g. `"type": "https://example.com/ns#bookmark"`) — namespaced by URL so they never collide.

**Like (with an emoji reaction):**

```json
{
  "id": "urn:uuid:772fa622-1111-2222-3333-444455556666",
  "authors": [{ "url": "https://alice.example/" }],
  "_feed_url": "https://alice.example/activity.json",
  "content_text": "",
  "date_published": "2025-12-07T17:00:00Z",
  "_version": 1,
  "_rel": [
    {
      "type": "like",
      "to": "https://pence.family/~mom/feed.json#urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "_emoji": "❤️"
    }
  ],
  "_sig": "..."
}
```

A `like` carries no *displayable* content (`content_text` is `""`, since JSON Feed requires a content field, §7.2); a reaction adds `_emoji` to the `_rel` entry (entries are open objects — unknown keys are preserved). Content-less relations (likes, reposts) SHOULD live in a separate **activity feed** — listed under `feeds` in the identity doc, with its own manifest — so a plain feed reader doesn't render bare likes as posts and the primary manifest isn't dominated by them (§8).

**Nested reply (threading with `root`):**

```json
{
  "id": "urn:uuid:883gb733-5555-6666-7777-888899990000",
  "authors": [{ "url": "https://pence.family/~jesse/" }],
  "_feed_url": "https://pence.family/~jesse/feed.json",
  "content_text": "I helped make them!",
  "date_published": "2025-12-07T16:30:00Z",
  "_version": 1,
  "_rel": [
    { "type": "reply", "to": "https://pence.family/~dad/feed.json#urn:uuid:661f9511-f3ac-52e5-b827-557766551111" },
    { "type": "root",  "to": "https://pence.family/~mom/feed.json#urn:uuid:550e8400-e29b-41d4-a716-446655440000" }
  ],
  "_sig": "..."
}
```

Jesse's reply points `reply` at Dad's reply (the parent) and `root` at Mom's original post (the thread root). The `root` entry matters: inbox relevance is judged per `_rel` entry, so without it the thread's host (Mom) would reject a reply-to-a-reply as `not_relevant` and never see it. Senders SHOULD deliver a nested reply to both the parent's and the root's inboxes (§8.1). Clients build the tree by walking parents and display flat or nested. `_in_reply_to` is gone — threading is a `root` relation now.

**Retracting a reaction:** tombstone the item (same id, bumped `_version`, delivered to the same inbox). To *change* a reaction, tombstone the old item and publish a new one with a fresh id — reusing an id across different relations is not permitted (§8.2).

### Sending to an Inbox

```
POST /~mom/inbox HTTP/1.1
Host: pence.family
Content-Type: application/json

{ ...the signed item verbatim... }
```

The body is a signed item, byte-for-byte. The inbox runs cheap local checks first (size, required fields, **relevance** — some `_rel` entry must reference this inbox's owner, dedup, rate limit) and only *then* fetches the sender's identity document to verify the signature (§10.2). Responses: `202` accepted, `400` malformed/not-relevant, `401` bad signature/revoked key, `404` target missing, `409` stale version, `429` rate-limited. Blocked authors get a silent `202` so a harasser can't tell they've been blocked.

Missed deliveries are recovered by polling the sender's feed — the feed is the source of truth, the inbox is just a push cache.

### WebFinger Discovery (Optional)

`@user@domain` identifiers resolve via WebFinger (RFC 7033), then the client fetches the identity document as the authoritative source:

```
GET /.well-known/webfinger?resource=acct:mom@pence.family
```

```json
{
  "subject": "acct:mom@pence.family",
  "aliases": ["https://pence.family/~mom/"],
  "links": [
    { "rel": "self", "type": "text/html", "href": "https://pence.family/~mom/" }
  ]
}
```

This is purely a human-friendly aliasing layer (Appendix B). Nothing else depends on it — and note there is no `rel="jwks"` link anymore; keys live in `openfeed.json`.

### Thread Discovery (Replies Endpoint, Optional)

An identity MAY expose a `replies` endpoint in its identity document. The response is a **JSON Feed** whose items are the reply items reproduced byte-verbatim (so signatures still verify), with the queried id echoed in `_replies_to`:

```
GET /~mom/replies?item=urn:uuid:550e8400-e29b-41d4-a716-446655440000
```

Consumers reuse the ordinary feed parser, re-verify each reply, and build the tree from `_rel` `reply`/`root` entries (§12).

---

## Signature Verification

To verify any signed document (item, manifest, or identity document):

1. **Determine the claimed author** from the signed bytes — for an item, its single `authors` entry's `url`; for a manifest or identity document, the `url` field.
2. **Parse the JWS header** and enforce it: `"alg":"EdDSA","b64":false,"crit":["b64"]` plus a `kid`. Reject anything else.
3. **Split the `kid`** at the last `#` → identity URL + key id. The identity URL MUST equal the claimed author (after normalization). This binding travels with the bytes, so you can't republish someone's content under a new name.
4. **Fetch `{identity}openfeed.json`** and **enforce the pin** (§5.3): verify its `_sig` against a key it lists, walk `prev` back to your stored pin, reject any rollback or equivocation. Find the key by `kid`.
5. **Check timing**: the key's `iat` (if present) must predate the content's effective signing time (`date_modified` else `date_published` for items; `updated` for manifests/identity docs), and the key must not have been revoked before that time.
6. **Verify the Ed25519 signature** over the reconstructed RFC 7797 signing input: `base64url(header) + "." + canonical-json-bytes`. Canonical bytes are RFC 8785 with the signature fields removed; strings are signed byte-exact (producers emit NFC, verifiers do not normalize); JSON with duplicate keys is rejected (I-JSON).

For inbox-delivered items, apply the revocation check against **receipt time** (which a sender can't backdate); for polled content, against the time you first saw the id in a signed manifest (§4.4). If an identity-document or manifest fetch fails transiently, cache the failure and retry (1h, 4h, 24h) rather than rejecting permanently.

The old steps — fetch profile HTML, discover `rel="jwks"`, confirm the JWKS URL is one the profile advertises — are all gone. Keys live in the identity document, so ownership is a string comparison.

---

## Migration and Recovery

Migration and recovery are **one operation** — *this identity continues over there* — differing only in which key attests (§3.4).

To move from `https://old.example/~alice/` to `https://alice.new/`:

1. Establish the new identity (new `openfeed.json`, new or same keys), adding `"predecessor": "https://old.example/~alice/"`.
2. **Cooperative migration** (you still control the old domain): the old identity document publishes a new chain version adding `"successor": "https://alice.new/"`. The matching `successor`/`predecessor` pair — each inside a signed document — is a cryptographic cross-signature a consumer verifies against the old identity's pinned chain.
3. **Recovery** (old domain lost): the new identity document also carries a `_recovery_sig` — a detached JWS by a **recovery key** that was committed in a pinned ancestor of the old identity. A consumer who pinned the old identity verifies that co-signature and follows `predecessor` even though the old side can no longer publish a `successor`.

There is no separate "recovery attestation" document — the chained identity document, signed by an active key, carrying `predecessor`, and co-signed by a committed recovery key, *is* the attestation. A `successor`/`predecessor` claim without its counterpart and without a valid recovery co-signature MUST NOT be treated as migration.

Because previously-published items carry the old feed's URL in their signed `_feed_url`, migration ends with **bulk re-signing**: republish the back catalog at the new feed (same id's, bumped `_version`, `date_modified` set, new `_feed_url`) and commit it in the new manifest. A verified migration is the one exception to the "an id belongs to one feed forever" rule — the binding follows the identity to its successor.

**Recovery keys** (§4.5): a key with `"use": "recovery"` must be generated at identity creation, stored offline (never on the hub), and never signs regular content. It exists to co-sign a domain-loss migration and to resolve forks. Recovery handles *domain loss*; it does not protect against theft of the recovery key itself, and first contact *after* a hijack is unprotectable by design (TOFU). The `pins` convention (Appendix G) is how a family propagates and cross-checks a recovery claim.

### Key rotation and compromise

Rotation (§4.3): publish a new chain version adding the new key, start signing with it, optionally set `revoked_at` on the old key. Keep rotated-out keys listed ≥30 days so old content still verifies; a key MUST stay listed in any chain version it signed.

Compromise: rotate immediately, set `revoked_at` to the earliest suspected compromise time, and co-sign your next chain version with your recovery key (`_recovery_sig`, §5.5) so anyone who sees the thief's competing chain can tell which branch is really you. Because timestamps are self-reported, a thief can backdate forged content past a `revoked_at` — so revocation mainly limits damage from *honest* rotation, and receivers apply the revocation check against receipt/first-observed time, not the sender's claim (§4.4).

---

## Extensions

### Field Conventions

Extension fields on any JSON object MUST be prefixed with `_`, and implementations MUST preserve unknown `_` fields when re-serializing (signatures depend on it). Common ones:

| Field              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `_feed_url`        | The containing feed's URL (signed; canonical/copy rule, §7.5) |
| `_version`         | Item revision counter (signed)                       |
| `_deleted`         | Tombstone marker (§7.3)                              |
| `_rel`             | Relation array — makes an item an interaction (§8)   |
| `_emoji`           | Emoji reaction, on a `like` relation entry           |
| `_sha256`          | SHA-256 hash of an attachment's bytes (base64)       |
| `_unverified`      | Marks bridged/observed content not natively signed (§7.5) |
| `_recovery_sig`    | Recovery co-signature on a chain version (§5.5)      |

### Custom relation types

Interaction *types* are values, not field names, so they namespace cleanly by URL — e.g. `"type": "https://example.com/ns#bookmark"`. Receivers store unknown types and MAY hide them from display. This replaces the old `x-` interaction-type convention.

### Privacy — publish or deliver

The core has no privacy mechanism, and that is the design rather than a gap. Content reaches people two ways, and everything follows from which:

- **Published** — in a feed, committed by a manifest. Gets the completeness proof, gossip, pinning, the export bundle, migration. Public.
- **Delivered** — POSTed to an inbox, no `_feed_url`. Private from everyone but the two hosts. Works today, no mechanism needed.

There is no third cell — *published but not public* does not exist. An earlier draft tried to build it (authenticated fetch, capability grants, a gated manifest) and every artifact it needed was a consequence of serving different bytes to different readers, which is exactly what breaks pinning. It's gone; spec Appendix E records why, and the test that shows it can come back as a pure extension if anyone ever wants it.

What's genuinely incompatible is narrower than "privacy": a completeness proof is a public artifact, so content whose **existence** must be private can't have one. Content whose **bytes** are opaque still can — which is why encryption and the manifest compose fine.

**Encrypted content** ([`open-feed-encrypted-content.md`](open-feed-encrypted-content.md), optional) is an ordinary signed item whose content is an opaque payload. The feed stays public, CORS-`*`, statically hostable, byte-identical for everyone; the host serves bytes it can't read. Its guarantee, stated plainly: **exactly as private as the recipient's key custody** — if their host holds their key, their host can read it. It is not a defence against your own host.

One rule predicts the rest: **any audience larger than one needs a membership document.** A DM needs no roster. A group does, because a replier is a reader and nothing tells them who the audience is — a membership problem, identical whether the content is encrypted or not.

### Follows and pins — conventions

Two optional documents referenced from the identity document, both *outside* the trust core, specified in full in [`open-feed-conventions.md`](open-feed-conventions.md) (spec Appendix G is now a pointer):

- **`follows`** — who you read (`{ "follows": [...], "updated": ... }`). Turns "which feeds does my hub poll?" into protocol. MAY be kept private/client-local.
- **`pins`** — your **signed** `(url, seq, hash)` observations of others' chains (keyed by document URL, so one identity's identity-doc and each manifest are distinguished). Publishing them gives a family anti-equivocation cross-checking, recovery propagation, informal timestamping, and a first-contact web-of-trust — the family-scale substitute for a transparency log, at essentially no new cryptography.
Pins also answer a question the trust model raises and doesn't settle: equivocation is *detectable*, but only if somebody compares. Your own record of what you published is a weak check — a host that knows which client is yours can serve that client the honest branch. Comparison by other people is the durable one.

⚠️ Both documents publish your social graph. `pins` additionally publishes *when* you read. Keep them client-local if that matters; the enforcement value is entirely local either way.

### Media integrity and alt text

Attachments use JSON Feed's `attachments`. The metadata is signed but the bytes aren't, so every attachment **MUST** carry a `_sha256` content hash — without it the bytes sit outside the signature envelope entirely and whoever controls them (including the host) can swap the photo under a signed item undetected. Consumers treat a hash-less attachment as unverified content. Use the attachment's `title` for alt text.

### Real-time updates

JSON Feed 1.1's `hubs` field enables WebSub push; subscribers MUST still verify signatures because the hub is untrusted infrastructure (Appendix C).

---

## Known Concerns & Limitations

### Discovery

**Problem:** How do you find people? **Current approach:** Out-of-band sharing — share your identity URL like an email address. **Future:** hub directories, WebSub aggregators, search indexing.

### Content completeness (solved)

**Problem:** How do you know a host showed you *all* of someone's posts, and didn't quietly drop the ones it didn't like? **Approach:** the signed, chained manifest (§9) commits to the exact live set; omission or rollback surfaces as a detectable fork against your pin. This is the property Nostr relays lack. It does *not* scale to millions of items per identity — that's a deliberate family-scale boundary.

### Spam and Abuse

**Problem:** Anyone can create an identity and flood inboxes. **Approach:** rate-limit by source IP (before any fetch) and by author (once known); relevance check rejects items not about the inbox owner; moderation queues and allowlists for unknown authors; blocked authors get a silent `202`.

### Timestamp Trust

**Problem:** Timestamps are self-reported; backdating is possible. **Approach:** for inbox items, use receipt time as a trustworthy lower bound; for polled content, use the time you first saw the id in a signed manifest; the `pins` convention is a family-scale external time anchor. A true transparency log / witness network is future work.

### Hub Trust

**Problem:** Hub admins who hold your keys can impersonate you. **Approach:** documented honestly as a gradient (§14.2) — even a key-holding hub can't silently rewrite the past against pinned consumers. Client-side keys move you off that tier; the sketched key-delegation extension (Appendix H) would let a hub hold only a revocable delegated key while your root key stays offline.

### Legal and Deletion

**Problem:** Right-to-deletion vs. distributed caching. **Approach:** deletion is best-effort — publish a signed tombstone; consumers who re-fetch drop their cached copy. Caches that never re-fetch can't be forced. The `deleted` map does make "this identity deleted something at version N" a lasting public fact — fine for family use, worth noting elsewhere.

### Identity Portability

**Problem:** Lose the domain without a recovery key and the identity is orphaned — the email trade-off. Durable identity across domain loss is what atproto buys with DID indirection; Open Feed deliberately trades it for URL-native simplicity. Recovery keys + pins are the family-scale mitigation, not a fix.

### Offline Delivery

**Problem:** If a recipient's inbox is down, deliveries are lost. **Approach:** senders retry with backoff for 24 hours; recipients recover anything missed by polling the sender's feed (the feed is the source of truth).

---

## Relationship to Other Protocols

Open Feed is **signed** like Nostr and atproto, but **human-URL-identified** like IndieWeb and ActivityPub. Its distinguishing feature is the manifest: a content-completeness proof that Nostr lacks and that atproto gets (differently) from its signed repo.

### vs ActivityPub

ActivityPub is comprehensive but complex: JSON-LD, HTTP Signatures, and a large vocabulary. Open Feed uses `_`-prefixed fields instead of JSON-LD, JWS instead of HTTP Signatures, and a feed + manifest instead of an outbox.

**Why not JSON-LD?**

- **It breaks byte-exact signing.** A JSON-LD document has no single canonical serialization; signing it needs RDF canonicalization (the source of AP's Linked Data Signatures woes). Open Feed signs exact bytes via RFC 8785, which only works on plain JSON.
- **It requires remote `@context` resolution** — an SSRF, availability, and mutability surface Open Feed simply doesn't have.
- **In practice nobody uses the graph** — most AP implementations treat JSON-LD as JSON with a magic `@context`. Open Feed makes that de facto practice normative.

**Bridge:** feasible only as a stateful gateway (the brid.gy model — see below), never a transparent adapter. The one convergence seam is **FEP-8b32** (`eddsa-jcs-2022` = Ed25519 over RFC 8785 — the *same* primitive Open Feed signs with), where a near-transparent object-level bridge becomes conceivable.

### vs AT Protocol (Bluesky)

atproto is technically decentralized but practically Bluesky-centric today, with DIDs, repos, lexicons, and significant infrastructure. Its signed repo gives it the same anti-omission guarantee Open Feed gets from the manifest, and its DID indirection buys real account portability across hosts. Open Feed deliberately trades that DID-grade portability for URL-native simplicity — no DID resolution, no repo sync, static hosting works. The clean identity seam for a bridge is **did:web ↔ Open Feed URL** (both domain-bound); a full bridge is a heavy mirror PDS with no transparent path.

### vs Nostr

Nostr and Open Feed are both plain-JSON and Ed25519-signed, and both let you self-host trivially. The differences:

- **Identity.** Nostr identity is a raw `npub` public key; Open Feed identity is a human-readable URL you control, which also gives you rotation and recovery a bare keypair can't.
- **Completeness.** A Nostr relay can silently withhold your notes and you can't prove it; Open Feed's signed, chained manifest makes omission and rollback detectable. This is the core distinction.
- **Delegation.** Nostr's NIP-26 delegation foundered partly for lack of an authoritative revocation substrate; Open Feed's pinned chain *is* exactly that substrate (Appendix H).

### vs IndieWeb / Webmention

IndieWeb shares Open Feed's "your identity is a URL you own" philosophy and its build-on-the-open-web ethos. Webmention (which earlier drafts had in the core) is now an optional **bridge gateway** (Appendix F): outbound rides on published h-entry HTML, inbound synthesizes `_unverified` items from microformats. What Open Feed adds over vanilla IndieWeb is cryptographic authorship and the completeness proof — Webmention has no signatures.

### vs RSS/Atom

Open Feed builds on JSON Feed, the modern JSON equivalent of RSS/Atom. Plain feed readers (Level 0) can consume the feed and ignore signatures — Open Feed is strictly additive. Publishing an Atom mirror alongside maximizes compatibility.

---

## FAQ

**Q: Why not just use ActivityPub?**

A: It's great but complex. If you want a weekend project to publish signed content with interactions — and a proof your host isn't hiding your posts — Open Feed is simpler.

**Q: Why Ed25519 specifically?**

A: Fast, secure, small signatures, widely implemented. Unknown `kty`/`crv` keys are ignored, so future algorithms slot in additively.

**Q: Can I run a hub on static hosting?**

A: Publishing (Level 2), yes — the identity doc, feed, manifest, and histories are all just files signed at build time. Receiving interactions (Level 3, the inbox) needs a server, even a serverless function.

**Q: What's the manifest for, really?**

A: So your host can't lie about *what you published*. Without it, a host could quietly omit posts and you'd have no proof. The manifest is a signed, chained commitment to your exact live item set; drop or roll back a post and any consumer who has seen you before detects the fork. It's the certificate-transparency idea applied to a feed.

**Q: Is this compatible with Mastodon?**

A: Not directly. A stateful ActivityPub gateway could bridge them, but that's out of the core (Appendix F). Bridges are trusted intermediaries, never transparent — no bridge can hold your Open Feed key.

**Q: How do I handle private content?**

A: Two answers, depending on who you're hiding it from. **From the public:** don't publish it — deliver it to the recipients' inboxes. No mechanism, works today. **From your host:** encrypt it ([`open-feed-encrypted-content.md`](open-feed-encrypted-content.md)) — the feed stays public and the host serves bytes it can't read. **From someone you already gave it to:** impossible, and no protocol claims otherwise.

Note what stays visible on a published feed even when encrypted: who posted, when, how often, and who replied to whom. Encryption hides what you said, not that you said it.

**Q: How do I send a private message?**

A: An ordinary signed item with no `_feed_url`, delivered to that person's inbox. An audience of one needs no roster, so this is the case that just works — threading, edits, and tombstones all behave normally. Encrypt it if your host shouldn't read it.

**Q: What if my hub operator is malicious?**

A: If they hold your keys they can impersonate you going forward (the email model) — but they *can't* silently rewrite your history against anyone who's pinned you.

The harder version of this question is the one where your hub operator is a relative, sits inside the audience, and controls whether you can leave. The spec names that as its own adversary tier (§14.2) and is blunt that encryption doesn't save you from it: they supply the client, and by default they generated your keys. What the protocol gives you instead is **exit** — an identity you can take elsewhere (§3.4), a recovery key generated on your device that they never held (§4.5), and a complete signed copy of your own content on demand (§15). Those three only work together, and a hub that skips any of them has to say so.

**Q: Isn't that a weak answer for a protocol with this much crypto in it?**

A: It's the true one. Open Feed is a transparency protocol — permanent retained history, world-readable documents, a durable public deletion record. Those are the properties that make tampering detectable, and they're the same properties that make forgetting impossible. Adding a privacy mechanism that fails against the adversary people actually have would be worse than saying what it does.

**Q: Can multiple people post to the same feed?**

A: Yes. Every item is signed by its own author (named in the item's single-entry `authors`), so a family board or team feed just collects independently-signed items. The feed-level author list is display-only.

**Q: Where did the outbox / JWKS document / profile HTML go?**

A: Consolidated. Your feed is your outbox. Keys, profile, and endpoints all live in the one signed `openfeed.json`. See the spec's Appendix E for the full before/after.

---

## Contributing

This is a draft specification (v0.2.0). Feedback welcome.

- **Issues:** technical problems, ambiguities, missing features.
- **Proposals:** new relation types, extension fields, gateway/bridge specs.

The goal is to keep the core minimal. If it can be an extension, it should be an extension.

---

## Acknowledgments

This spec synthesizes ideas from IndieWeb, ActivityPub, AT Protocol, Nostr, JSON Feed, and the broader conversation about what decentralized social could look like if we prioritized simplicity — and the ability to prove nobody edited your past.
