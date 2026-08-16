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
- Built on four standards and nothing else: HTTPS, JSON Feed 1.1, JOSE (JWK/JWS), and JSON canonicalization (RFC 8785).
- One signed object model, one signature construction, one verifier.
- The manifest proves **presence**: your host can't make a post disappear without leaving a signed, attributable trace. This is the thing Nostr relays can't do.
- Publishing (Level 2) is small enough to implement in a weekend — every artifact is a file, signed at build time — and works on free static hosting (Netlify, GitHub Pages, Cloudflare). Verifying (Level 1) is the deeper half: pinning, chain walking, and the manifest invariants are real work, which is why a dependency-free reference implementation ships in `src/`.
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

Two things make that real rather than nearly real, and both are requirements rather than good intentions. The manifest commits to each item's **exact bytes**, not just its version number — otherwise a hub holding your key could tell two family members different things under one `(id, version)` and produce identical manifests. And **somebody has to compare**: a pin nobody ever checks against a second observation is evidence collected and thrown away, so applying the compare rule is a Level 1 MUST (§5.3.1), and the optional item-carried pins (§16) are how a family supplies each other with observations to compare.

### Trust Model

**Be clear about this:** if your hub holds your signing key — the simplest arrangement, and what most hosted setups do today, though no longer what the spec recommends (§12) — the admin can sign content as you. That is the same trust model as email — you trust your provider not to read your mail even though they could. For family hubs, this is fine.

But the trust model is a **gradient, not a binary** (§13.2):

- **Key custodian** (hub holds your key): forward impersonation is unpreventable, and so is *deletion* — a tombstone is an ordinary item, so anyone who can sign for you can retire your posts. But even here the hub *cannot silently rewrite the past* against anyone who has pinned you. Deletions must appear as signed tombstones; per-reader rewriting surfaces as a detectable fork.
- **Serving-path compromise** (CDN / static bucket / web tier hacked, but the signing key is elsewhere): the most common real-world attack. The attacker can't sign, so the chains and manifest give **full integrity** — no undetectable omission, rollback, or injection.
- **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full integrity against the host by construction.

Client-side keys move you from the key-custodian tier toward the dumb-host tier — and delegated custody (spec §4.6, §12) is the recommended way to get most of that move while a hub still publishes for you. Both are supported for anyone who wants them.

### What's In Scope

- Signed public content (posts, media references).
- Authenticated interactions (replies, likes, reposts, quotes, mentions) — as signed feed items.
- Key rotation and revocation, verifiable against a pinned chain.
- Identity migration and recovery (one operation).
- Multi-author feeds (family boards, team feeds).
- Nested threading for conversations.
- Anti-omission / anti-rollback proofs via the manifest.

### What's Out of Scope

- Confidentiality. Privacy in the core is a publication decision — publish or deliver (§11). Encrypted content is an **optional layer** (§15) whose guarantee is bounded by the recipient's key custody; there is no restricted-visibility feed mechanism.
- Global-scale firehoses / aggregators. Open Feed scales *across* identities (each is self-contained and independently verifiable), not to millions of items per identity; the manifest is a deliberate small-catalog boundary.
- Content moderation policy (left to hub operators).
- Storage formats and sync protocols (files on disk are fine).
- Specific authentication methods (how you log in to your own hub is your business).
- Protocol bridges (ActivityPub, atproto, Webmention, Nostr) — feasible as gateways, but out of the core (Appendix C). Note that the *cheapest* interop needs no bridge at all: see below.

---

## Getting Started

### For Users

1. Get an identity URL from a hub (or run your own).
2. Your hub serves your `openfeed.json`, feed, and manifest, and handles key management.
3. Use a client app to post content and interact with others.
4. Share your identity URL like you'd share an email address.

### For Hub Operators

Open Feed defines four conformance levels (§12):

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
| `/{user}/openfeed/{seq}.json` | Retained prior identity-document versions (once `seq > 1`, §5.4) |
| `/{user}/manifest/{seq}.json` | Retained prior manifest versions (once its `seq > 1`)  |
| `/{user}/feed/items/{hash}.json` | Each committed revision on its own (optional, §7.6)      |
| `/{user}/export`              | Your complete signed archive, on demand (Level 3, §14)      |

Every public document is served with `Access-Control-Allow-Origin: *` so browser readers work without a proxy.

The item URLs are optional and worth explaining, because their value is not obvious from the path. A manifest names the exact bytes of every item it commits, so a reader can always tell that something *should* be there — but with only a paginated feed to ask, it can never honestly tell the difference between "the host is hiding this" and "that is on a page I did not fetch". Serving each revision at a URL named by the hash the manifest already commits gives it a way to ask for one thing. The fetch is self-verifying, since the URL *is* the content hash, and a superseded revision stays reachable, which nothing else here offers. See §7.6.

**Level 3 adds (requires a server):**

| Path              | Purpose                                        |
| ----------------- | ---------------------------------------------- |
| `/{user}/inbox`   | POST endpoint for receiving signed items (§10) |

Your feed is your outbox; there is no separate outbox endpoint.

See the [specification](open-feed-spec.md) for full requirements.

### For Client Developers

Your client needs to:

1. **Read** — fetch an identity's `openfeed.json`, feed, and manifest; verify signatures; pin and enforce both chains.
2. **Publish** — sign items, update the feed, advance and re-sign the manifest.
3. **Interact** — a reply/like/etc. is a signed item with a `_rel` array; POST it to the recipient's inbox (and usually publish it in your own feed too).
4. **Receive** — run an inbox, or poll the feeds you follow (the feed is the source of truth).

---

## Examples

All examples use the `https://pence.family/~mom/` family framing. Signatures are shown as `"_sig": "..."` for readability; the spec's Appendix B has real, self-verifying test vectors.

### Identity Document (`openfeed.json`)

This one signed file carries the profile, the keys, and the endpoints together. It lives at the fixed path `{identity}openfeed.json`.

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

- `feeds` is one array for every feed you publish — entries are `{url, manifest, rel}`, and `rel: "primary"` names the authoritative one. Every listed feed is manifested; there is no unproven feed. A high-volume feed doesn't pay a chain advance per item, because a manifest may advance on a schedule rather than per publication (§9.2) — and the resulting lag window is bounded, so it can't quietly become a place to hide content from one reader (§9.3).
- `keys` is a standard array of JWKs (RFC 7517). The `x` field is the base64url Ed25519 public key. `iat`/`revoked_at` are Unix seconds (JOSE convention); content timestamps use ISO 8601 (JSON Feed convention). The `crv`/`use` constraints apply to *signing* keys — extensions can add other key types to the same array, and core verifiers ignore them.
- `seq`/`prev`/`updated`/`_sig` are the version-chain fields. `prev` is the base64url SHA-256 of the *full* previous version's bytes. Genesis (`seq: 1`) has no `prev`. Prior versions are retained at a **derived URL** — strip `.json`, append `/{seq}.json`, so version 6 of this document is at `https://pence.family/~mom/openfeed/6.json`. There is no history-index document to maintain. See §5.4.
- The identity doc commits to the manifest **by URL, not by hash** — so ordinary publishing advances the manifest chain and never re-signs the identity doc.
- Unknown fields survive re-serialization, since signatures depend on it. Extension fields use a `_` prefix.

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

- Each item carries its own single-entry `authors` array (the signer) and `_feed_url` **inside the signed bytes**. These cryptographically bind the post to its author and its feed. Feed-level `authors` are *not* signed and carry no authority — attribution comes solely from the item's own `authors` entry, and the *displayed* name from the author's pinned identity document, falling back to the item's own `name` where a client hasn't fetched that document (§6.6).
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
  "updated": 1739577600,
  "items": {
    "urn:uuid:550e8400-e29b-41d4-a716-446655440000": [3, "czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"],
    "urn:uuid:661f9511-f3ac-52e5-b827-557766551111": [1, "vdS1bhnFd5XsIugXNLR0k-7UHDxRJi7DO6XRWF5l_gU"]
  },
  "deleted": { "urn:uuid:99aa2222-...": [4, "8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI"] },
  "_sig": "..."
}
```

- `items` maps each live item id to `[version, hash]` — the item's current `_version`, and the SHA-256 of its exact published bytes. `deleted` records tombstoned id's the same way. The hash is what makes the guarantee hold against a hub that holds your key: with a version-only manifest, a key-holding host could sign one `(id, version)` as two different things for two readers and produce identical manifests, so the equivocation would be undetectable in principle. It costs about 48 bytes per item (§9).
- A consumer pins the manifest at its `(seq, hash)` and walks `prev` back to that pin on every later fetch — the *same* pin-and-walk discipline as the identity chain (§9.1).
- Invariants (§9.3): an id, once in `items`, must appear in every later manifest (in `items` or `deleted`). Content can't silently vanish; removal requires a signed tombstone.
- Growth is bounded on two independent axes (§9.2): advance the manifest on a cadence rather than once per post, and rotate to a fresh feed when the live set gets large. Past roughly 100 KB of manifest, also emit skip links (§9.1.1) — without them a reader who stops checking for a few weeks can no longer reconnect their pin within the budget a verifier is allowed to spend.

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

Weigh one consequence before using a shared feed: the board *owner's* manifest is what commits the board, so a contributor gets no completeness proof of their own over content that is canonical there. The owner — or the owner's host — can drop a contributor's items and nothing in the contributor's chain records it, which is the protocol's central guarantee running the wrong way for the person who most wants it. Publishing to your own manifested feed and letting the board carry **copies** (§7.1, §7.5) keeps the proof where you want it, costs the board nothing, and is why a client-assembled aggregate view is usually the better shape than a shared canonical feed.

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

The `to` is `{feed_url}#{item_id}` — the only form for an Open Feed target (item id's never contain `#`, so receivers resolve relevance by splitting at the last `#`). A bare URL in `to` names something outside the protocol: a web page, or a foreign object a gateway is pointing at. Dad publishes this in his own feed *and* POSTs the same bytes to Mom's inbox — one object, one signature, nothing to keep in sync.

Core relation types (§8): `reply` and `quote` and `mention` carry content; `like` and `repost` carry none; `root` marks a thread root. Custom relations use an absolute-URL type (e.g. `"type": "https://example.com/ns#bookmark"`) — namespaced by URL so they never collide.

**Like (with an emoji reaction):**

```json
{
  "id": "urn:uuid:772fa622-1111-2222-3333-444455556666",
  "authors": [{ "url": "https://alice.example/" }],
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

A `like` carries no *displayable* content (`content_text` is `""`, since JSON Feed requires a content field, §7.2); a reaction adds `_emoji` to the `_rel` entry (entries are open objects — unknown keys are preserved).

Note what this example doesn't have: a `_feed_url`. A like should be **delivered, not published** (§8). Its only reader is the person whose post was liked and the inbox already reaches them, while publishing it makes reactions the dominant driver of manifest volume and writes the interaction graph — who reacted to whom, and when — into a world-readable file. The trade the spec asks you to make knowingly: a public like *count* becomes the post author's own unverifiable assertion, since the evidence is in their inbox. Relations meant to be seen (`reply`, `repost`, `quote`, `mention`) are published as ordinary items, and anyone who does publish content-less relations puts them in a separate **activity feed** — listed under `feeds` with its own manifest — so a plain reader doesn't render bare likes as posts.

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

Jesse's reply points `reply` at Dad's reply (the parent) and `root` at Mom's original post (the thread root). The `root` entry matters: inbox relevance is judged per `_rel` entry, so without it the thread's host (Mom) would reject a reply-to-a-reply as `not_relevant` and never see it. Senders deliver a nested reply to both the parent's and the root's inboxes (§8.1). Clients build the tree by walking parents and display flat or nested. `_in_reply_to` is gone — threading is a `root` relation now.

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

This is purely a human-friendly aliasing layer — a convention of this README, not the spec; nothing else depends on it; keys live in `openfeed.json`, so there is no key-document link to discover.

### Thread Discovery

The spec deliberately defines no thread-discovery endpoint. Threads are complete by polling the participants' feeds, where replies are canonically published, and fast via inbox delivery; a public endpoint's only unique reach is replies from strangers — near-nothing at family scale, a spam surface at any other. An implementation that wants one anyway is building a public projection of received content, and spec §11.1.1 binds it: items with no `_feed_url` were delivered, not published, and must never appear in any public response. If you build one, a sensible shape is a JSON Feed of the reply items reproduced byte-verbatim, so signatures keep verifying and consumers reuse the ordinary feed parser.

---

## Signature Verification

To verify any signed document (item, manifest, or identity document):

1. **Determine the claimed author** from the signed bytes — for an item, its single `authors` entry's `url`; for a manifest or identity document, the `url` field.
2. **Parse the JWS header** and enforce it: `"alg":"EdDSA","b64":false,"crit":["b64"]` plus a `kid`. Reject anything else.
3. **Split the `kid`** at the last `#` → identity URL + key id. The identity URL and the claimed author have to match, after normalization. This binding travels with the bytes, so you can't republish someone's content under a new name.
4. **Fetch `{identity}openfeed.json`** and **enforce the pin** (§5.3): verify its `_sig` against a key it lists, walk `prev` back to your stored pin, reject any rollback or equivocation. Find the key by `kid`.
5. **Check timing**: the key's `iat` (if present) must predate the content's effective signing time (`date_modified` else `date_published` for items; `updated` for manifests/identity docs), and the key must not have been revoked before that time.
6. **Verify the Ed25519 signature** over the reconstructed RFC 7797 signing input: `base64url(header) + "." + canonical-json-bytes`. Canonical bytes are RFC 8785 with the signature fields removed; strings are signed byte-exact (producers emit NFC, verifiers do not normalize); JSON with duplicate keys is rejected (I-JSON).

For inbox-delivered items, apply the revocation check against **receipt time** (which a sender can't backdate); for polled content, against the time you first saw the id in a signed manifest (§4.4). If an identity-document or manifest fetch fails transiently, cache the failure and retry (1h, 4h, 24h) rather than rejecting permanently.

---

## Migration and Recovery

Migration and recovery are **one operation** — *this identity continues over there* — differing only in which key attests (§3.4). You establish the new identity with a `predecessor` link, and then either the old side publishes a matching `successor` (a cross-signature verifiable against its pinned chain), or, if the old domain is gone, the new document carries `_recovery_sig`, a co-signature by a **recovery key** committed in a pinned ancestor. Either way the chained identity document *is* the attestation; there is no separate claim document, and a one-sided link with no recovery co-signature is not a migration.

Your back catalog comes with you **byte-verbatim** — you do not re-sign it. Previously-published items carry the old feed's URL in their signed `_feed_url`, and rewriting that would change the bytes of everything you ever published, invalidating every hash any consumer's manifest pin or any peer's published pin already holds. A wholesale rewrite of your own past is the exact pattern the compare rule exists to flag, and exit shouldn't require producing one. So the verified migration carries the binding instead: republish the same bytes at the new feed, commit them in the new manifest, and a consumer who has verified the migration treats an item whose `_feed_url` names a predecessor feed as canonical there (§3.4, §7.5). Because nothing is re-signed, "an id belongs to one feed forever" stays true and no longer needs a migration exception carved out of it — what moves is where the unaltered bytes are served.

The same equivalence covers the other loose end: replies you already received point at the old feed URL inside *other people's* signed items, which nobody can re-sign, so consumers treat predecessor and successor targets as the same thing once the migration verifies (§3.4, §10.2). Without that, exercising your exit would make every inbound reply start bouncing.

**Recovery keys** (§4.5) are generated at identity creation, stored offline, never on the hub, and never sign regular content. Recovery handles *domain loss*; first contact *after* a hijack is unprotectable by design (TOFU); and theft of the recovery key itself is worth stating precisely, because it does not fail the way people expect. A stolen recovery key **cannot sign a chain version** (§5.2), so nobody impersonates you with it. What its holder *can* do is mint a competing migration — a fresh identity at a URL they control, claiming you as predecessor, co-signed by the same committed key — which verifies exactly as well as yours. §3.4 calls that pair unresolvable, so the loss is not your identity but your **exit**: no reader is told which claim is you. Where the key lives is therefore the whole of the protection, which is why §4.5 asks for somewhere your host's operator cannot reach. Because one key in one place is one thing an adversary with access to that place can find — a relative in the same home, or the operator of the host itself — the key belongs where neither can reach it (§4.5). Item-carried pins (§16) are how a family propagates and cross-checks a recovery claim along the traffic it already exchanges.

The part that turns this from a domain-loss feature into an **exit** is who generated the key. A recovery key the hub generated and handed you is no check on the hub, so a Level 3 host must generate it on your device and never receive it — and must show you your genesis `(seq, hash)` and the key's fingerprint at signup so you can compare them out of band with someone else. Otherwise the hub can honor the letter of the rule and serve everyone else a different genesis document.

### Key rotation and compromise

Rotation (§4.3): publish a new chain version adding the new key, start signing with it, optionally set `revoked_at` on the old key. A rotated-out key stays listed for as long as anything it signed is still served — and since retention is permanent (§5.4), that is in practice forever: revocation ends a key's authority, delisting would end the verifiability of everything it ever signed. A key always stays listed in any chain version it signed.

Listing more than one *active* signing key is ordinary, and it is how you survive a lost device: any listed key can advance the chain, so you sign the next version from your other device and revoke the lost one there (§4.3). Nothing escalates to the recovery key, and you don't have to move.

Compromise: rotate immediately, set `revoked_at` to the earliest suspected compromise time, and co-sign your next chain version with your recovery key (`_recovery_sig`, §5.5) so anyone who sees the thief's competing chain can tell which branch is really you. Because timestamps are self-reported, a thief can backdate forged content past a `revoked_at` — so revocation mainly limits damage from *honest* rotation, and receivers apply the revocation check against receipt/first-observed time, not the sender's claim (§4.4).

---

## Extensions

### Field Conventions

Extension fields on any JSON object should take a `_` prefix — that is collision avoidance, not a verification input. What signatures actually depend on is the other half: implementations preserve unknown members when re-serializing, prefixed or not (§7.2). Common ones:

| Field              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `_feed_url`        | The containing feed's URL (signed; canonical/copy rule, §7.5) |
| `_version`         | Item revision counter (signed)                       |
| `_deleted`         | Tombstone marker (§7.3)                              |
| `_rel`             | Relation array — makes an item an interaction (§8)   |
| `_emoji`           | Emoji reaction, on a `like` relation entry           |
| `_sha256`          | SHA-256 hash of an attachment's bytes (base64url)    |
| `_unverified`      | Marks bridged/observed content not natively signed (§7.5) |
| `_recovery_sig`    | Recovery co-signatures on a chain version (§5.5)     |

### Custom relation types

Interaction *types* are values, not field names, so they namespace cleanly by URL — e.g. `"type": "https://example.com/ns#bookmark"`. Receivers store unknown types and may hide them from display. 

### Privacy — publish or deliver

The core has no privacy mechanism, and that is the design rather than a gap. Content reaches people two ways, and everything follows from which:

- **Published** — in a feed, committed by a manifest. Gets the completeness proof, gossip, pinning, the export bundle, migration. Public.
- **Delivered** — POSTed to an inbox, no `_feed_url`. Private from everyone but the two hosts. Works today, no mechanism needed.

There is no third cell — *published but not public* does not exist. Serving different bytes to different readers is exactly what breaks pinning, so anything built on that axis (authenticated fetch, capability grants, a gated manifest) costs the completeness proof it was meant to preserve. Audience control at a single host is host authorization — software, not protocol.

What's genuinely incompatible is narrower than "privacy": a completeness proof is a public artifact, so content whose **existence** must be private can't have one. Content whose **bytes** are opaque still can — which is why encryption and the manifest compose fine.

Because "delivered" is a choice the author makes and *other people* enforce, the spec makes it a MUST: **publication is the author's decision, and only the author's** (§11.1.1). A receiver holds a delivered item as a custodian, not an author, and must never put it in a feed, a manifest, any public query surface, or a bridge. This binds the bytes, not the information — nothing stops someone describing in their own post what you told them privately.

**Encrypted content** (spec §15, optional) is an ordinary signed item whose content is an opaque payload. The feed stays public, CORS-`*`, statically hostable, byte-identical for everyone; the host serves bytes it can't read. Its guarantee, stated plainly: **exactly as private as the recipient's key custody** — if their host holds their key, their host can read it. It is not a defence against your own host.

One rule predicts the rest: **any audience larger than one needs a membership decision — but not necessarily a membership document** (§11.2). Three arrangements, in ascending price:

- **A list you hold locally.** You wrap to it; nothing leaves your client. This is *not* a group: every reply comes back only to you, because your recipients can't wrap to a list they can't read.
- **An audience you declare in the item** (§15.2.2). The identities you wrapped to ride inside the *sealed plaintext*, so your recipients — and only your recipients — can read the list and wrap their replies to the same people. That's the family thread, working across hubs, and it costs no new document, no endpoint, and no second construction. The honest catch: a replier is trusting your stated audience the same way they're trusting you not to forward their reply, and neither is checkable (§15.5).
- **A published roster.** Needed only when somebody *other* than the author convenes the audience, and permanently out of scope (§11.2). Not a placeholder for a later section: a roster has to be chained so members can pin it and encrypted so it isn't public, which brings staleness between versions, a custodian who can withhold one, a rekey on every removal, a binding between roster and items, and an identity fetch per reply — a second protocol's worth of trust machinery, and the honest home for it is a separate spec layered on this one. Six of those seven costs are exactly what the declared audience above avoids by not being shared mutable state.

### Follows and pins

One item field specified in spec §16, plus one README-level document convention, both *outside* the trust core:

- **`_follows`** — who you read (`{ "url": ..., "follows": [...], "updated": ..., "_sig": ... }`, referenced by a `_follows` field in the identity document; entries are identity-URL strings or objects with a `url` plus optional petname/feed-narrowing keys). A convention of this README — nothing in the spec reads it, and the spec's extension rules (`_` prefix, preserve-unknown) are all it relies on. Turns "which feeds does my hub poll?" into shareable data, and doubles as the natural trust set for weighing pins. Keep it client-local if you don't want your reading graph published.
- **`_pins` on items** — your signed `(url, seq, hash)` observations of others' chains, carried on the items you already send (keyed by document URL, so one identity's identity-doc and each manifest are distinguished). They give a family anti-equivocation cross-checking, recovery propagation, informal timestamping, and a first-contact web-of-trust — the pairwise substitute for a transparency log, at essentially no new cryptography and no new document.
Pins also answer a question the trust model raises and doesn't settle: equivocation is *detectable*, but only if somebody compares. Your own record of what you published is a weak check — a host that knows which client is yours can serve that client the honest branch. Comparison by other people is the durable one.

⚠️ A published `_follows` document publishes your social graph — keep it client-local if that matters; the enforcement value is entirely local. Pins are scoped so an entry never reveals a reading relationship its carrying item hasn't already revealed: published items pin only the identities they address, and third-party pins ride delivered items alone (§16.1).

### Syndication map (`_syndication`)

A POSSE publisher (see "The POSSE route" below) needs to know where the copies went — to route a foreign reply home when the backlink is missing, and to know what to retract when the original is deleted. A third README-level convention, built like `_follows`: a **signed, unchained** document referenced by a `_syndication` field in the identity document.

```json
{
  "url": "https://pence.family/~mom/openfeed.json",
  "syndication": {
    "urn:uuid:4f8c...": ["https://mastodon.social/@mom/112233", "at://did:plc:abcd1234/app.bsky.feed.post/3kx..."]
  },
  "updated": "2026-02-15T09:00:00Z",
  "_sig": "..."
}
```

Keys are item ids; values are the URIs of the copies. Unchained means no `seq`, no `prev`, nothing committed by a manifest — so it can be rewritten or deleted outright, which is the point: where your copies live is exactly the kind of disclosure you should be able to withdraw, and the map carries no authority anyone verifies anything against. Keep it client-local if you'd rather not publish it at all.

Two shapes it deliberately isn't:

- **A `_syndication` field on the item.** Tombstones are an allowlist (§7.3), so deleting a post strips the field — the targets disappear from the published bytes at exactly the moment you need them to retract the copies. Editing the map also means bumping `_version`, re-signing, and re-manifesting an item whose content never changed.
- **A signed receipt item per copy.** Doubles the signed artifacts, turns routing into a feed scan, and a published receipt outlives the retraction as a permanent statement of where the copies went — the disclosure this convention lets you erase.

The backlink stays the primary routing key: each syndicated copy links to the entry's permalink, so a gateway observing a reply usually already holds the parent. The map is the fallback and the retraction list.

### Media integrity and alt text

Attachments use JSON Feed's `attachments`. The metadata is signed but the bytes aren't, so the spec **requires** every attachment to carry a `_sha256` content hash — without it the bytes sit outside the signature envelope entirely and whoever controls them (including the host) can swap the photo under a signed item undetected. Consumers treat a hash-less attachment as unverified content. Use the attachment's `title` for alt text.

### Real-time updates

JSON Feed 1.1's `hubs` field enables WebSub push — a convention of this README; nothing in the spec reads it. Push changes how the bytes arrive and nothing else, so a subscriber runs the ordinary Level 1 verification it would have run after polling (§12): a push hub is untrusted infrastructure like any other transport.

---

## Known Concerns & Limitations

### Discovery

**Problem:** How do you find people? **Current approach:** Out-of-band sharing — share your identity URL like an email address. **Future:** hub directories, WebSub aggregators, search indexing.

### Content completeness (solved)

**Problem:** How do you know a host showed you *all* of someone's posts, and didn't quietly drop the ones it didn't like? **Approach:** the signed, chained manifest (§9) commits to the exact live set; omission or rollback surfaces as a detectable fork against your pin. This is the property Nostr relays lack. It does *not* scale to millions of items per identity — that's a deliberate small-catalog boundary.

### Spam and Abuse

**Problem:** Anyone can create an identity and flood inboxes. **Approach:** rate-limit by source IP (before any fetch) and by author (once known); relevance check rejects items not about the inbox owner; moderation queues and allowlists for unknown authors; blocked authors get a silent `202`.

### Timestamp Trust

**Problem:** Timestamps are self-reported; backdating is possible. **Approach:** for inbox items, use receipt time as a trustworthy lower bound; for polled content, use the time you first saw the id in a signed manifest; item-carried pins are a pairwise external time anchor. A transparency log or witness network is deliberately out of scope (§13.10, §16.1) — a pin is a self-contained signed claim, so anyone who wants to aggregate them can, and the spec declining to define the aggregator forecloses nothing.

### Hub Trust

**Problem:** Hub admins who hold your keys can impersonate you. **Approach:** documented honestly as a gradient (§13.2) — even a key-holding hub can't silently rewrite the past against pinned consumers. Client-side keys move you off that tier, and delegated keys (§4.6) go further: the hub holds only a revocable delegated key that can sign content but can never advance your identity chain, while your root key stays on your own device. That is the custody architecture §12 recommends, and the sharpest reason is about leaving rather than about forgery: a hub holding your **root** key can publish a `successor` of its own, which §4.5 lets verifiers weigh against your recovery-signed departure — so it can *contest* your exit rather than merely decline it. A hub that never held such a key cannot answer at all. What delegation does *not* remove is content deletion — a tombstone is an item, so a delegated key can retire your posts too, visibly but unstoppably; sign tombstones with your root key on your own device if that matters to you.

### Legal and Deletion

**Problem:** Right-to-deletion vs. distributed caching. **Approach:** deletion is best-effort — publish a signed tombstone; consumers who re-fetch drop their cached copy. Caches that never re-fetch can't be forced. The `deleted` map does make "this identity deleted something at version N" a lasting public fact — fine for family use, worth noting elsewhere.

### Identity Portability

**Problem:** Lose the domain without a recovery key and the identity is orphaned — the email trade-off. Durable identity across domain loss is what atproto buys with DID indirection; Open Feed deliberately trades it for URL-native simplicity. Recovery keys + pins are the pairwise mitigation, not a fix.

### Offline Delivery

**Problem:** If a recipient's inbox is down, deliveries are lost. **Approach:** senders retry with backoff for 24 hours; recipients recover anything missed by polling the sender's feed (the feed is the source of truth).

---

## Relationship to Other Protocols

Open Feed is **signed** like Nostr and atproto, but **human-URL-identified** like IndieWeb and ActivityPub. Its distinguishing feature is the manifest: a content-completeness proof that Nostr lacks and that atproto gets (differently) from its signed repo.

### What already interoperates, today, with nothing new

Before any of the comparisons below, the boring answer: **your feed is a JSON Feed 1.1 document.** Every JSON Feed reader already works — it just ignores `_sig` and gets no authenticity guarantee (Level 0, §12). Publish an Atom or RSS mirror and the entire feed-reader installed base works too. Add h-card/h-entry markup to your identity page and IndieWeb tooling can read you.

Those last two matter more than they look, because **existing bridges already eat them.** A site serving a discoverable Atom feed plus an h-card can be bridged into the fediverse by a third-party service like [Bridgy Fed](https://fed.brid.gy/) — no gateway to run, no bridge spec to implement, nothing in this repository required. It even represents you as `@yourdomain.com`, domain-bound, which is what your Open Feed identity URL already is, so there's no mapping to invent.

One more static file gives machine legibility to DID ecosystems — with a scope worth stating precisely. Your identity URL maps mechanically to a `did:web` identifier, and serving a DID document carrying the same Ed25519 keys makes the key resolvable by DIF tooling and verifiable-credential verifiers (a convention of this README — nothing in the spec reads it). It does **not** reach atproto: atproto accepts hostname-level `did:web` only (`did:web:mom.pence.family` is valid; `did:web:pence.family:~mom` is not), and its signing curves are P-256 and K-256, so the Ed25519 key never crosses. No signature crosses in either direction regardless. The practical Bluesky seam is the **domain handle**: `mom.pence.family` as a Bluesky handle, bound by a DNS TXT record or a `/.well-known/atproto-did` file to an ordinary Bluesky-hosted account — no PDS, no DID document needed. Handles are domain-scoped with no path form, which is why the reference deployment issues identities at subdomains. And keep any DID document in step with `keys`, or you're advertising a revoked key the identity chain already retired.

The trade is the honest one: content reaching another network this way arrives **unsigned and with no completeness proof** — it's a copy (§7.5). But that's the same trade a purpose-built gateway makes, at none of the cost. Exhaust this before building a bridge (above).

### The POSSE route: your account, your tooling, no middleman

There are two ways into networks like Mastodon and Bluesky, and they are rivals, not layers — pick one per network, or you get two presences with a split reply graph. The **zero-effort tier** is the Bridgy Fed route above: nothing to build, no silo account, a bridge operator in the middle. The **recommended tier**, for anyone willing to hold silo accounts, is **POSSE through a syndication gateway** (spec Appendix C): publish on your own site, then your own tooling — holding your own OAuth token — posts the copy to your own Mastodon or Bluesky account and conveys replies back to your inbox.

The pitch, precisely: *the silo copy is admitted to be a copy (§7.5), and no intermediary is added beyond the silos POSSE already accepts.* Every POSSE setup in wide use today routes through a bridge operator; this one doesn't. The silos themselves are still trusted — for the copy's availability, for the account, and for the honesty of the notifications API your backfeed polls.

What the protocol contributes, none of it requiring anything from Mastodon or Bluesky:

- **A signed claim that the account is yours** — an `_accounts` extension field in your identity document (a convention of this README — see "Foreign accounts" below; the spec's §13.16 carries its warnings). Unlike an HTML `rel="me"`, it can't be varied per reader without forking your chain, and removing it is a dated, signed revocation every pinned reader observes. This is where Open Feed picks up what IndieWeb leaves on the table: IndieWeb's interop links are unsigned HTML assertions a host can vary per reader with no evidence and revise with no record. The honest cost — a permanent, irreversible disclosure of your cross-platform identity graph — is stated at the field, and for some people the deletable HTML link is genuinely the better tool.
- **A safe channel for responses to return** — backfeed is *delivery, not ingest* (spec Appendix C): foreign replies arrive in your inbox as `_unverified` items, never enter any manifested feed, and may render on your entry page's own revocable HTML surface, which can honor a later foreign deletion the way a permanent signed artifact never could.
- **A backlink discipline** — each syndicated copy links to the entry's permalink: the routing key for backfeed, and the item-level half of the foreign-attestation rule (see "Foreign accounts" below).
- **A record of where the copies went** — the `_syndication` map (see "Extensions"), which is what you route an unlinked reply with and what you consult to retract copies when you delete the original.

For a static site with no inbox it's simpler still: your own client polls your own silo notifications and renders what it finds locally. No gateway identity, no delivery, no protocol machinery — the delivery rule exists for third-party gateways (a family hub bridging for its members), not for you.

### Foreign accounts (`_accounts`)

A convention of this README, not the spec — no core check reads it, and the spec's §13.16 carries the rules that do bind: the permanence warning, and claim-until-attested presentation. An identity document may carry an `_accounts` extension field listing foreign accounts its owner claims to control:

```json
"_accounts": [
  { "id": "https://mastodon.social/@mom", "proof": "rel-me" },
  { "id": "did:plc:abcd1234", "handle": "mom.pence.family", "proof": "atproto-handle" }
]
```

Entries are strings or objects with at least `id`; `proof` names how a consumer checks the claim itself (a platform's cached "verified" badge is evidence of a past check, not a present link):

- **`rel-me`** — the foreign profile lists a URL under the claimed identity, and that page carries an HTML `rel="me"` hyperlink back. Both halves are publicly fetchable; check both. The HTML link has to exist alongside `_accounts` anyway (Mastodon's verifier reads HTML and will never read `openfeed.json`), so generate the HTML links *from* the array and treat the array as authoritative where they disagree.
- **`atproto-handle`** — the entry names the immutable DID; the domain side is a `_atproto` DNS TXT record or `/.well-known/atproto-did`, and the foreign side is the DID document naming the handle back (`alsoKnownAs`). Key the claim by DID; the handle is mutable routing. A handle on a provider domain you don't control (`mom.bsky.social`) has no domain half and stays an unverified claim whatever `proof` says.

Re-check on first observation, on any change, and periodically (a week is reasonable); present stale results as "previously verified" with the age, and treat a failing re-check as downgrade-to-claim — a foreign outage looks exactly like a revocation. Two honest limits. What the signed form defends against is *third parties* claiming your accounts — an entry can't be varied per reader without forking the chain. It does not defend against a key custodian planting accounts on you, since a host holding the signing key can control both halves of the check; detection there is the chain recording the addition and somebody comparing (§5.2, §5.3.1). And publication is permanent: retained versions mean removing an entry withdraws the claim, never the disclosure. Where the operator or a family member is the adversary, don't use this — a deletable unsigned HTML link is the better tool (spec §13.16).

### vs ActivityPub

ActivityPub is comprehensive but complex: JSON-LD, HTTP Signatures, and a large vocabulary. Open Feed uses `_`-prefixed fields instead of JSON-LD, JWS instead of HTTP Signatures, and a feed + manifest instead of an outbox.

**Why not JSON-LD?**

- **It breaks byte-exact signing.** A JSON-LD document has no single canonical serialization; signing it needs RDF canonicalization (the source of AP's Linked Data Signatures woes). Open Feed signs exact bytes via RFC 8785, which only works on plain JSON.
- **It requires remote `@context` resolution** — an SSRF, availability, and mutability surface Open Feed simply doesn't have.
- **In practice nobody uses the graph** — most AP implementations treat JSON-LD as JSON with a magic `@context`. Open Feed makes that de facto practice normative.

**Bridge:** feasible only as a stateful gateway (the brid.gy model — see below), never a transparent adapter. **FEP-8b32 is not the convergence seam it looks like:** its `eddsa-jcs-2022` shares Open Feed's curve (Ed25519) and canonicalization (RFC 8785), but signs different bytes — a 64-byte pair of hashes, where Open Feed signs the JWS signing input directly. No signature crosses in either direction. What *can* be shared is the key itself (Appendix C).

### vs AT Protocol (Bluesky)

atproto is technically decentralized but practically Bluesky-centric today, with DIDs, repos, lexicons, and significant infrastructure. Its signed repo gives it the same anti-omission guarantee Open Feed gets from the manifest, and its DID indirection buys real account portability across hosts.

The portability gap is narrower than it looks, and worth stating precisely. `did:plc` is a chained log of key-rotation operations with recovery keys — structurally the same thing as Open Feed's identity chain (§5) plus recovery keys (§4.5). The difference isn't sophistication, it's *where the log lives*: Bluesky operates it at a neutral third party, so losing your domain doesn't orphan you. Open Feed keeps the log at your own URL and pays for that with the domain-loss risk, mitigated but not fixed by recovery keys and pins. `did:web`, the DID method that isn't centrally operated, is domain-bound exactly as an Open Feed identity URL is — but it serves only the self-hosted-PDS minority, and only at hostname level; the identity seam for an ordinary Bluesky account is the **domain handle** (see "Foreign accounts" below). A full content bridge is still a heavy mirror PDS with no transparent path; the lightweight route is POSSE (below).

### vs Nostr

Nostr and Open Feed are both plain-JSON and Ed25519-signed, and both let you self-host trivially. The differences:

- **Identity.** Nostr identity is a raw `npub` public key; Open Feed identity is a human-readable URL you control, which also gives you rotation and recovery a bare keypair can't.
- **Completeness.** A Nostr relay can silently withhold your notes and you can't prove it; Open Feed's signed, chained manifest makes omission and rollback detectable. This is the core distinction.
- **Delegation.** Nostr's NIP-26 delegation foundered partly for lack of an authoritative revocation substrate; Open Feed's pinned chain *is* exactly that substrate, which is what makes §4.6's delegated keys safe here and NIP-26's unsafe there.

The trade runs the other way too, and it's the sharpest thing Nostr has on us: **relay redundancy**. A Nostr note lives on many relays, so no single operator can withhold everything. An Open Feed identity is served from one origin, and the manifest makes withholding *detectable*, not *impossible* — different property, and the weaker one when your host simply goes dark. The copy rule (§7.5) means a follower's cached copy of your feed still verifies and can be served on your behalf, which is the ingredient for redundancy; what isn't specified is how anyone finds that mirror.

### vs IndieWeb / Webmention

IndieWeb shares Open Feed's "your identity is a URL you own" philosophy and its build-on-the-open-web ethos. What Open Feed adds over vanilla IndieWeb is cryptographic authorship and the completeness proof — Webmention has no signatures. Everything ingested from IndieWeb is `_unverified`, without exception; that isn't a slight on Webmention, it's that nobody but you can hold your Open Feed key.

The two directions are separable and priced very differently (Appendix C). **Outbound is nearly free**: sending a Webmention when you publish a reply whose target dereferences to an HTTP URL mints no proxy identity, ingests nothing, keeps no state, and widens no audience — the item was already published at your own URL. It's a POST, and it reaches the whole IndieWeb. **Inbound is the expensive half**: synthesizing `_unverified` items from microformats is a gateway, with an audience test, a durability test, and a trust argument attached. Do outbound first; the trust argument starts at ingest.

### vs RSS/Atom

Open Feed builds on JSON Feed, the modern JSON equivalent of RSS/Atom. Plain feed readers (Level 0) can consume the feed and ignore signatures — Open Feed is strictly additive. Publishing an Atom mirror alongside maximizes compatibility.

### Writing a bridge profile

Spec Appendix C states the one rule that governs every gateway — *a gateway may not change the terms under which content was published*: not the **audience**, not the **durability**, not the **verification status**. Because that rule is protocol-independent, a profile for a specific protocol is a filled-in table rather than a fresh trust argument. **Profiles live here rather than in the spec, permanently**: a profile binds to a foreign protocol's behavior of the moment — its visibility flags, its deletion semantics, its identity seam — and normative text that goes stale at a trust boundary is worse than none, because implementers keep obeying it. This is the template; a worked one follows.

| Slot | What it fixes |
|---|---|
| **Identity mapping** | Foreign actor → identity URL and back; whether proxy identities are minted per actor or everything rides one gateway identity |
| **Object mapping** | Foreign object type → item, and where applicable → `_rel` type, as a registered token or a namespaced URL |
| **Source URI form** | What `external_url` carries, and whether it is dereferenceable |
| **Audience test** | How the profile decides an object was published *publicly*. Safety-critical |
| **Durability test** | How the profile decides an object is durable enough to ingest. Safety-critical |
| **Update and delete mapping** | Foreign edit → `_version` bump; foreign delete → tombstone. The gateway owns its item ids, so both are ordinary |
| **What does not map** | Foreign objects with no item representation — `Follow`, `Accept`, `Block`, lexicon records, room state. Bridge-internal state; never invent `_rel` types for them |
| **Failure semantics** | The foreign object disappears; a delete arrives for something never ingested; the foreign side is unreachable |

Those last two are where implementers improvise, and improvisation at a trust boundary is how the honest-hub model gets quietly abandoned.

#### Worked profile: Mastodon, syndication class (POSSE)

The cheapest real profile, and the one most people want. **Class: syndication** — outbound posts go to *your own* Mastodon account; inbound responses are **delivered, never ingested**. Nothing foreign enters a manifested feed, so the safety-critical ingest slots collapse into a delivery test, no proxy identities are minted, and the whole thing is a client with an OAuth token. Written against Mastodon's behavior as of this writing; check the API before implementing, which is exactly why this table isn't in the spec.

| Slot | This profile |
|---|---|
| **Identity mapping** | Your identity URL ↔ your own account; no third parties are mapped. Seam is `rel-me` in both directions: a profile metadata field on Mastodon pointing at your identity URL, an `<a rel="me">` back on your human page, and an `_accounts` entry with `proof: "rel-me"` as the signed half (see "Foreign accounts") |
| **Object mapping** | Published item (has `_feed_url`) → public status. `_rel` `reply` at a foreign status → status with `in_reply_to_id`, resolved from the target URL. `like` → favourite; `repost` → boost. `quote` has no native analog: post as an ordinary status carrying the link, never as a boost |
| **Source URI form** | Delivered backfeed items carry the foreign status URL in `external_url` (dereferenceable). Each syndicated copy links back to the item's permalink; the copy's URI goes in your `_syndication` map |
| **Audience test** | Deliver responses whose visibility is `public` or `unlisted` — both world-readable at their URL. `private` and `direct` never leave the silo, at all. The revocable-render carve-out (Appendix C: rendering a delivered `_unverified` item on your own mutable HTML page) applies to `public` only; `unlisted` means "public but not amplified," and putting it on your entry page is amplification the author declined |
| **Durability test** | Nothing is ingested, so nothing is durabilized publicly — which is *why* this is a syndication profile. Mastodon deletions are real, so a mirroring gateway ingesting statuses into a manifested feed would durabilize content whose deletion is genuine, and Appendix C forbids it. Delivered copies still persist in the recipient's inbox and export bundle until tombstoned: best-effort, never recall |
| **Update and delete mapping** | Foreign edit → deliver a new `_version` of the delivered item. Foreign delete → tombstone signed by the **same author** as the original delivery, or `(author, id)` dedup can never match it. Keep the foreign-status-id → `(author, id)` map across restarts |
| **What does not map** | `Follow`, `Accept`, `Block`, poll votes, pins, filters, follow requests. Bridge-internal or none of your business; never invent `_rel` types for them |
| **Failure semantics** | The notifications API is a cursor over a finite buffer: gaps are normal, so silence is never proof of no reply, and a missed notification must not be reported as a deletion. A delete for a status never delivered → ignore. Account `Move` → the `_accounts` claim drops to unverified until re-checked at the new account. Instance unreachable → assert nothing; the correct output is no output |

#### The Bluesky variant, in one line

Same class, same table; the seam differs. Identity is a **domain handle** (`mom.pence.family` bound by DNS TXT or `/.well-known/atproto-did` to an ordinary Bluesky account), keyed by the immutable DID with `proof: "atproto-handle"`; there is no `unlisted` tier, so the audience test is simply "public," and quote-posts *do* have a native analog.

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

A: Not natively — but two routes work today, requiring nothing from Mastodon. Zero-effort: an Atom mirror plus h-card, bridged by Bridgy Fed as `@yourdomain.com`. Recommended: POSSE — your own Mastodon account, posted to by your own tooling, with replies delivered back to your inbox (the syndication gateway, Appendix C). Pick one per network; running both splits your reply graph. A full ActivityPub mirroring gateway remains possible and remains a trusted intermediary — no bridge can hold your Open Feed key.

**Q: Can I also sign my posts for another protocol — ActivityPub's object integrity proofs (FEP-8b32), say?**

A: Yes, and it needs nothing from this spec — which is why there's no dual-signing mechanism in it. The recipe: **use a separate keypair for the foreign suite.** Serialize the item into the foreign shape, sign that with the foreign key, and let the two signatures cover different bytes; neither claims anything about the other, and a consumer verifying one learns nothing about the other. Publish the foreign key wherever that suite looks for it — a `did:web` document, an actor object — or list it in `keys` as an extension key with its own `use` value, which core verifiers ignore (§4.1).

What you must not do is sign both constructions with **one** key. Spec §6.1 makes that a MUST: two suites that disagree about what's covered can each accept bytes the other's signer never meant to authorize, and that attack needs no flaw in either suite by itself. Keys are cheap; signature confusion isn't.

**Q: How do I handle private content?**

A: Two answers, depending on who you're hiding it from. **From the public:** don't publish it — deliver it to the recipients' inboxes. No mechanism, works today. **From your host:** encrypt it (spec §15) — the feed stays public and the host serves bytes it can't read. **From someone you already gave it to:** impossible, and no protocol claims otherwise.

Note what stays visible on a published feed even when encrypted: who posted, when, how often, and who replied to whom. Encryption hides what you said, not that you said it.

**Q: How do I send a private message?**

A: An ordinary signed item with no `_feed_url`, delivered to that person's inbox. An audience of one needs no membership document, so this is the case that just works — threading, edits, and tombstones all behave normally. Encrypt it if your host shouldn't read it.

**Q: What if my hub operator is malicious?**

A: If they hold your keys they can impersonate you going forward (the email model) — but they *can't* silently rewrite your history against anyone who's pinned you.

The harder version of this question is the one where your hub operator is a relative, sits inside the audience, and controls whether you can leave. The spec names that as its own adversary tier (§13.2) and is blunt that encryption doesn't save you from it: they supply the client, and by default they generated your keys. What the protocol gives you instead is **exit** — an identity you can take elsewhere (§3.4), a recovery key generated on your device that they never held (§4.5), and a complete signed copy of your own content on demand (§14). Those three only work together, and a hub that skips any of them has to say so.

**Q: Isn't that a weak answer for a protocol with this much crypto in it?**

A: It's the true one. Open Feed is a transparency protocol — permanent retained history, world-readable documents, a durable public deletion record. Those are the properties that make tampering detectable, and they're the same properties that make forgetting impossible. Adding a privacy mechanism that fails against the adversary people actually have would be worse than saying what it does.

**Q: Can multiple people post to the same feed?**

A: Yes. Every item is signed by its own author (named in the item's single-entry `authors`), so a family board or team feed just collects independently-signed items. The feed-level author list is display-only.

**Q: Where did the outbox / JWKS document / profile HTML go?**

A: Consolidated. Your feed is your outbox. Keys, profile, and endpoints all live in the one signed `openfeed.json`, so key ownership is a string comparison instead of a cross-document check.

---

## Contributing

This is an unreleased draft specification (v0.1.0) with no implementations yet. Feedback welcome.

- **Issues:** technical problems, ambiguities, missing features.
- **Proposals:** new relation types, extension fields, gateway/bridge specs.

The goal is to keep the core minimal. If it can be an extension, it should be an extension.

---

## License

[Apache License 2.0](LICENSE). The specification and the reference implementation are under the
same terms — a permissive license with an explicit patent grant, chosen so that implementing this
protocol carries no legal question for anyone, commercial or otherwise.

---

## Acknowledgments

This spec synthesizes ideas from IndieWeb, ActivityPub, AT Protocol, Nostr, JSON Feed, and the broader conversation about what decentralized social could look like if we prioritized simplicity — and the ability to prove nobody edited your past.
