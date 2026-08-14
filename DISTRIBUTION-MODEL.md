# Distribution Model

A family journaling app with AI assistance, built as a conforming **Open Feed** implementation (see `open-feed-spec.md`, Version 0.1.0). Start simple, add complexity only when needed — but stay on-protocol from day one, so hub users and self-hosted members interoperate through the same signed formats rather than a private API that diverges from the spec.

**Relationship to the spec:** This app is a Level 3 hub (spec §12). Every identity serves **one signed identity document** at `{identity_url}openfeed.json` — profile, keys, endpoints, and a tamper-evident version chain (spec §3.2, §4, §5). Content is published as signed JSON Feed items (spec §7), and a **separately-signed, chained manifest** commits each feed's contents so the host can't silently drop, reorder, or roll them back (spec §9). Interactions (replies, likes, reposts) **are** feed items carrying a `_rel` relation array (spec §8), delivered by POSTing the signed item to the recipient's inbox (spec §10). `family`-visibility content is **published encrypted** to the family audience in one form for every reader (spec §11.3, spec §15), wrapped to each member's own encryption key and decrypted in each member's client — on-hub and off-hub members alike. There is no gated feed and no second authorization mechanism — a document served in audience-varying forms is equivocation (spec §5.3.1). Until the encryption layer ships, `family` entries are **not published at all** (see "What Gets Published"). Custody is **delegated by default** (spec §4.6, §12): the member's device generates the root signing key, the recovery key, and the encryption key; the hub holds only a delegated key, which signs items and manifests but can never advance the identity chain (see "Key custody"). Where this document previously described spec-divergent shortcuts, it has been brought into line; the app's own additions (AI companion, drafting flow) are layered on top and never replace the wire formats.

---

## What We're Building

An AI-powered journaling application that:

1. Helps users reflect on their day through conversation with an AI companion
2. Publishes journal entries as static HTML (human-readable, shareable)
3. Lets family members comment on each other's journals
4. Supports both centralized (family hub) and distributed (self-hosted) deployments
5. Optionally syndicates to external platforms (RSS readers, email, Mastodon)

### Design Principles

1. **Works centralized first** - Single hub is simplest. Self-hosting is supported, not required.
2. **On-protocol from day one** - Hub users and self-hosted members use the same signed Open Feed formats. The internal REST API is a convenience layer over spec-conformant storage, never a divergent source of truth.
3. **Sign everything** - All published content is signed (spec §6), so any consumer — hub, self-hosted member, or third-party reader — can verify it the same way. Portability and cross-hub trust fall out for free.
4. **The feed is the source of truth; the inbox is a push cache** (spec §1). Delivery makes interactions fast; polling the signed feed makes them complete. Nothing exists only in transit.
5. **AI handles complexity** - Users talk to the companion; technical details are invisible.

### Design Rationale (For Implementers)

Earlier drafts of this doc took spec-divergent shortcuts to save effort. Following the spec instead costs a little more up front but removes a class of "works on the hub, breaks across hubs" bugs. The table below records how each earlier shortcut was reconciled against the v0.1.0 spec:

| Earlier shortcut | Now (spec-aligned) | Why |
|------------------|--------------------|-----|
| No signatures on hub content | **Sign all feed items** (spec §6, §7.2) | Signing on write is cheap (sign once, cache). It makes hub content portable and verifiable off-hub, and is required for a conforming feed. The hub's delegated key (spec §4.6) keeps it invisible to users. |
| Separate JWKS + profile-HTML discovery | **One signed identity document** at `{identity}openfeed.json` (spec §3.2) | Keys, profile, and endpoints live in one signed, chained JSON file at a fixed path. No HTML parsing, no `<link rel="jwks">`, no cross-document key-ownership check — key ownership is structural (spec §4.2). |
| Webmention instead of custom inbox | **Inbox is the sole core delivery path** (spec §10); Webmention is only an optional bridge | The signed inbox gives verified authorship and structured interactions. Webmention is demoted to an optional IndieWeb *gateway* (spec Appendix C) that ingests lower-trust `_unverified` copies. |
| Standalone interaction objects (`type`/`target`/`target_item`) | **Interactions are items with a `_rel` array** (spec §8) | A comment = an item with `_rel:[{type:"reply", to:"{feed_url}#{item_id}"}]`; a reaction = an item with `_rel:[{type:"like",...}]` and `_emoji`. One schema, one verifier; publishing and delivering are the same bytes. |
| Flat comments only | **Nested threading** via `_rel` `reply` + `root` entries (spec §8.1) | Store the parent reference; render flat *or* nested. Deep replies carry a `root` entry so the thread host's inbox accepts them. |
| No feed-integrity commitment | **Publish + advance a signed, chained manifest** (spec §9) | The manifest proves *presence* (a host can't drop your content) and, via its chain, tamper-evidence against rollback/equivocation. `_feed_url` proves *exclusivity* (spec §7.5). |
| No key rotation/revocation | **Rotation + revocation via the identity chain** (spec §4.3, §4.4, §5) | Required for a real trust story and cheap to serve. The chain makes rotation and revocation tamper-evident. |
| No recovery keys | **Support recovery keys** (spec §4.5) | Generated once at account creation, stored offline. Enables migration/recovery if the domain is lost (spec §3.4). |
| Internal API as source of truth | **Internal API over spec storage** | Hub users hit a fast REST API, but every write produces the same signed identity document / feed item / manifest a self-hoster would produce. The API is a cache/convenience, not a fork of the model. |

**Standards used** (mirrors spec Abstract):
- [JSON Feed 1.1](https://jsonfeed.org/version/1.1) - Feed format
- [JWK (RFC 7517)](https://tools.ietf.org/html/rfc7517) - Public keys, carried inside `openfeed.json`
- [JWS (RFC 7515)](https://tools.ietf.org/html/rfc7515) + [RFC 7797](https://www.rfc-editor.org/rfc/rfc7797) - Signatures (detached, unencoded payload)
- [RFC 8785](https://tools.ietf.org/html/rfc8785) - JSON Canonicalization Scheme (for signing)
- [I-JSON (RFC 7493)](https://www.rfc-editor.org/rfc/rfc7493) - Duplicate-key rejection
- [Ed25519 (RFC 8032)](https://www.rfc-editor.org/rfc/rfc8032) - Signature algorithm
- [Webmention](https://www.w3.org/TR/webmention/) + [Microformats2](https://microformats.org/wiki/microformats2) - Optional IndieWeb bridge only (spec Appendix C)

### Deployment Models

| Model | Description | When to use |
|-------|-------------|-------------|
| **Centralized** | Everyone on `pence.family` | Default. Simplest. |
| **Hybrid** | Most on hub, some self-host | Tech-savvy family members |
| **Distributed** | Everyone self-hosts | Maximum independence |

The app should handle all three transparently. A comment from `dad.pence.family/` and `jessepence.com/` should look the same to `mom.pence.family/`.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI Journaling App                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ Conversation│  │   Journal   │  │      Database           │  │
│  │   Engine    │─▶│  Generator  │─▶│  (entries, comments,    │  │
│  │  (AI API)   │  │             │  │   users, sessions)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            │
       ┌────────────┬───────┼────────┬────────────┐
       ▼            ▼       ▼        ▼            ▼
  ┌─────────┐ ┌──────────┐ ┌──────┐ ┌────────┐ ┌──────────┐
  │openfeed │ │  Static  │ │ JSON │ │manifest│ │   RSS/   │
  │ .json   │ │   HTML   │ │ Feed │ │ .json  │ │  Atom    │
  └─────────┘ └──────────┘ └──────┘ └────────┘ └──────────┘
```

The three signed artifacts — `openfeed.json` (identity), `feed.json` (content), `manifest.json` (content commitment) — are the on-protocol core. Static HTML and Atom are additive conveniences for humans and plain feed readers.

---

## Core Concepts

### Users

A user has:

```typescript
interface User {
  id: string;                    // Internal ID (UUID)
  username: string;              // e.g., "mom"
  displayName: string;           // e.g., "Mom"
  bio?: string;
  avatarUrl?: string;
  createdAt: Date;
  role: 'admin' | 'member' | 'viewer';
}
```

Their identity URL is `https://mom.pence.family/`, and their machine-readable identity document is at `https://mom.pence.family/openfeed.json` (spec §3.2). The identity URL MAY also serve a human-readable HTML page, but nothing in the protocol reads it.

**Decision: subdomains, not subpaths.** Hub members get identities at `https://{user}.pence.family/`, not `https://pence.family/~{user}/`. This is a Phase 1 decision because identity URLs are permanent — every signed item's `_feed_url` names the feed forever (spec §7.5), so switching later means exercising migration (spec §3.4) for every member. Three reasons, only one of which is Bluesky:

1. **Cross-protocol identity binding is domain-scoped** (README, "Aliases": WebFinger and did:web are README conventions). A Bluesky handle (`mom.pence.family`) binds via `_atproto` DNS TXT or `/.well-known/atproto-did`, and neither has a path form; a subpath identity has no Bluesky handle, permanently. Hostname-level `did:web` (the only kind atproto accepts) has the same shape.
2. **Origin isolation.** Subpath members share one browser origin, so one member's compromised or malicious HTML page can reach another member's same-origin state (inbox auth cookies, storage), and spec §3.3's same-origin fetch rules bind at origin granularity. Subdomains give each member their own origin. For a hub whose threat model includes its own members, this stands on its own even if Bluesky support is never built.
3. **Mastodon is indifferent** — `rel="me"` verifies against any URL — so the choice costs nothing on that side.

**Subdomains are never reused.** An identity URL is permanent and its chain is pinned by consumers, so a departed member's `mom.pence.family` cannot be handed to a new member: a fresh genesis under a pinned chain reads as an equivocating fork to everyone who ever followed the first one (spec §5.3.1). Retire the label with the member, and keep serving their `openfeed.json`, feed, and manifest so old signatures still verify.

Costs, all one-time: a wildcard certificate (or per-subdomain ACME), per-member DNS, and `/.well-known/atproto-did` served per subdomain. WebFinger stays at the apex: `acct:mom@pence.family` resolves to `https://mom.pence.family/` in `aliases` — aliasing across hosts is what README's WebFinger convention already permits. Everything else — §3.1 normalization, §5.4 derived URLs, export, migration — is unchanged; the identity URL is simply the subdomain root. One honest limit: a subdomain proves the *domain operator* controls it, not the member — but that is equally true of a subpath, and it is the custody trust model spec §13.2 already states — narrowed here to the delegated-custodian tier — not a new cost of this choice.

**Identity URL normalization** (spec §3.1):

When comparing or storing identity URLs (for external members or author attribution):
- Use the `https` scheme
- Normalize domain to lowercase (`Alice.Example` → `alice.example`)
- Remove default ports (`:443` for HTTPS)
- Strip query parameters and fragments
- Ensure trailing slash on path (path is case-sensitive)

Examples:
| Input | Normalized |
|-------|------------|
| `https://Alice.Example/~mom` | `https://alice.example/~mom/` |
| `https://example.com:443/~alice/` | `https://example.com/~alice/` |
| `https://example.com/~alice?ref=twitter` | `https://example.com/~alice/` |

This prevents the same identity from appearing as multiple different users due to URL variations.

### Entries

A journal entry:

```typescript
interface Entry {
  id: string;                    // UUID (URN or tag URI); permanent; MUST NOT contain '#'
  authorId: string;              // User ID (for hub users)
  authorUrl?: string;            // Identity URL (for external/self-hosted)
  title?: string;
  contentHtml: string;           // Rendered HTML
  contentText: string;           // Plain text (for feeds, search)
  visibility: 'public' | 'family' | 'private' | 'unlisted';
  attachments?: Attachment[];    // Photos, files
  version: number;               // Maps to _version; starts at 1, bumped on edit/delete
  publishedAt?: Date;            // null = draft
  modifiedAt?: Date;             // Maps to date_modified; set on re-sign/edit
  createdAt: Date;
  updatedAt: Date;
}

interface Attachment {
  url: string;                   // URL to the file
  mimeType: string;              // e.g., "image/jpeg"
  alt?: string;                  // Alt text for images
  width?: number;
  height?: number;
  sha256: string;                // REQUIRED. Maps to _sha256 (spec §7.4); an attachment
                                 // without one is unverified content, not signed record
}
```

When published, an entry becomes a signed JSON Feed item carrying `id`, `date_published`, single-entry `authors` (author binding, spec §6.6), `_feed_url`, `_version`, and `_sig` (spec §7.2). Editing bumps `_version` and sets `date_modified`; deletion publishes a **tombstone** (spec §7.3).

| Visibility | Who can see it |
|------------|----------------|
| `public` | Anyone |
| `family` | The family audience, via content **published encrypted** to them (spec §11.3, spec §15) — one form for every reader, decrypted in each member's own client with a key the hub never holds. **Not published in any form until the encryption layer ships** |
| `private` | Only the author **and the hub operator** — see the note below |
| `unlisted` | Anyone with the link (not in feeds) |

> **Do not label a tier `private` unless it is.** A `private` entry is stored in cleartext on the
> hub so the app can show it back to its author, so the operator can read it — key custody has
> nothing to do with it, and delegated custody (see "Key custody") does not change it. Call it what
> it is in the UI — "not shared with the family" rather than "private" — because the person most
> likely to rely on the stronger reading is the person for whom the operator *is* the adversary
> (spec §13.2, the hostile-custodian tier). `family` content is the tier the operator genuinely
> cannot read, because it is encrypted to keys the hub never holds; content that must not exist on
> their server should not be posted to it.


### Comments

A comment is a signed feed item with a `_rel` `reply` entry (spec §8). It is not a separate object type — it is an item like any other, whose `_rel` array names what it replies to:

```typescript
interface Comment {
  id: string;                    // UUID; the item id; permanent; no '#'

  // Relation (maps to _rel entry, type "reply"):
  replyToFeedUrl: string;        // Target feed URL
  replyToItemId: string;         // Target item id  → to: "{feedUrl}#{itemId}"
  rootFeedUrl?: string;          // For nested replies: thread root feed URL
  rootItemId?: string;           // For nested replies: thread root item id (type "root")

  // For hub users:
  authorId?: string;             // User ID (internal)

  // For external/self-hosted authors:
  authorUrl?: string;            // Identity URL
  authorName?: string;           // Display name (cached, display-only)
  authorAvatar?: string;         // Avatar URL (cached)

  contentText: string;           // Plain text; escape/sanitize before rendering
  version: number;               // _version
  createdAt: Date;
  updatedAt: Date;
}
```

Either `authorId` (hub user) or `authorUrl` (external) will be set, not both. Author attribution comes solely from the item's single-entry `authors` binding (spec §6.6) — never from a self-asserted display name.

### Reactions

A reaction is a signed feed item with a **content-less** `_rel` `like` entry carrying `_emoji` (spec §8):

```typescript
interface Reaction {
  id: string;                    // item id
  likeOfFeedUrl: string;         // target feed URL
  likeOfItemId: string;          // target item id  → _rel: [{type:"like", to:"{feed}#{id}", _emoji:"❤️"}]

  // For hub users:
  authorId?: string;

  // For external/self-hosted authors:
  authorUrl?: string;
  authorName?: string;

  emoji: string;                 // Single emoji, carried as _emoji on the _rel entry
  createdAt: Date;
}
```

**`Entry`, `Comment`, and `Reaction` above are view models, not the row of record.** Each is derived from a signed artifact whose `canonical_bytes` is the source of truth — see "Store the bytes, not just the fields" — so the real tables carry `canonical_bytes`, `sig`, and an `ext_json` bag for unknown `_` fields alongside these columns. Decomposing `_rel` into `replyToFeedUrl`/`replyToItemId` is fine as an index; reconstructing an item from those columns to re-verify or re-serve it is not, and will not reproduce the hash its manifest entry commits.

**Reactions are delivered, not published** (spec §8). A `like` has exactly one reader — the author of the thing liked — and the inbox already reaches them, so the item carries no `_feed_url` and never enters a feed or manifest. This is not a minor preference: reactions are the highest-volume object in a family app, and publishing them would both dominate manifest growth and write the family's reaction graph into a world-readable file that encryption does not cover (spec §11.4). The cost, which the UI should not paper over: a reaction count is the entry author's own tally from their inbox, not something another member can independently verify. Reposts and quotes are meant to be seen and are published normally; if the app ever publishes content-less relations, they go in a **separate activity feed** listed under `feeds` with its own manifest (spec §8, §3.2), so the primary feed stays clean for plain readers.

---

## API

Simple REST. All endpoints except public reads require authentication. This is the internal convenience layer; every write it performs also produces the corresponding signed Open Feed artifact (item + advanced manifest).

### Authentication

Use whatever works for your stack:
- Magic links (email a login link)
- Passkeys (WebAuthn)
- OAuth (if integrating with existing identity)
- Simple password (if you must)

Session stored in HTTP-only cookie or bearer token.

### Entries

```
GET    /api/entries              # List entries (filtered by visibility)
GET    /api/entries/:id          # Get single entry
POST   /api/entries              # Create entry (or draft)
PATCH  /api/entries/:id          # Update entry (bumps _version, re-signs, advances manifest)
DELETE /api/entries/:id          # Delete entry (publishes tombstone, advances manifest)

POST   /api/entries/:id/publish  # Publish a draft (sign item, advance manifest)
```

### Comments

```
GET    /api/entries/:id/comments     # List comments on entry
POST   /api/entries/:id/comments     # Add comment (produces a signed reply item)
PATCH  /api/comments/:id             # Edit comment (bump _version, re-sign)
DELETE /api/comments/:id             # Delete comment (tombstone) (author or entry owner)
```

### Reactions

```
GET    /api/entries/:id/reactions    # List reactions
POST   /api/entries/:id/reactions    # Add reaction (body: {"emoji": "❤️"} → signed like item)
DELETE /api/reactions/:id            # Remove reaction (tombstone) (author only)
```

### Users

```
GET    /api/users                    # List family members
GET    /api/users/:id                # Get user profile
PATCH  /api/users/:id                # Update profile (self or admin; re-signs openfeed.json, advances identity chain)
```

### Family Feed

```
GET    /api/feed                     # All family entries (respects visibility)
GET    /api/feed?author=:userId      # Entries from specific user
```

### Error Responses

Keep it simple:

```json
{
  "error": "not_found",
  "message": "Entry not found"
}
```

| Status | When |
|--------|------|
| 400 | Bad request (validation error) |
| 401 | Not authenticated |
| 403 | Not authorized (can't access this resource) |
| 404 | Not found |
| 500 | Server error |

(The inbox endpoint uses its own status/error vocabulary from spec §10.4 — see below.)

---

## Cross-Site Interactions (Self-Hosted Members)

When family members self-host, they can't use `POST /api/comments`. The **sole core path** is the Open Feed **inbox** (spec §10): the self-hoster signs a feed item carrying a `_rel` `reply` entry and POSTs it, verbatim, to `mom.pence.family/inbox`; the hub runs the §10.2 verification (author binding, signature, revocation, dedup) and stores it as a verified comment.

Webmention is **not** part of the core. It is available only as an optional IndieWeb **bridge** (spec Appendix C), producing lower-trust `_unverified` content — see "Optional Webmention Bridge" below.

### How It Works (Inbox)

```
Jesse (self-hosted) comments on Mom's post:

1. Jesse's client builds a signed reply *item* (spec §8):
   {
     "id": "urn:uuid:...",
     "authors": [{ "url": "https://jessepence.com/" }],
     "content_text": "Those cookies were delicious!",
     "date_published": "2025-12-07T16:00:00Z",
     "_version": 1,
     "_rel": [{ "type": "reply",
                "to": "https://mom.pence.family/feed.json#urn:uuid:550e8400-..." }],
     "_sig": "..."
   }
   (An inbox-only item omits _feed_url, spec §6.6/§8. If Jesse also publishes
    the reply in his own feed, that copy carries his _feed_url.)

2. POST it, verbatim, to Mom's inbox:  POST https://mom.pence.family/inbox
   Content-Type: application/json

3. Mom's hub verifies (spec §10.2), cheap local checks BEFORE any fetch:
   - size limit, parse JSON, reject duplicate keys (I-JSON)
   - required item fields present (§7.2)
   - RELEVANCE: some _rel entry's `to` references Mom (her identity, feed,
     or an item of hers) — one lookup over _rel, works for unknown types too
   - timestamp bounds (≤7d past, ≤24h future)
   - dedup by (author, id) → version
   - rate-limit by source IP
   Then: verify signature (§6.5) — one outbound fetch of the author's
   openfeed.json; key ownership is structural (the kid names jessepence.com,
   the key is listed there or it isn't). Apply revocation vs *receipt time*.
   Store as a verified comment.
```

Item `content` is plain text (`content_text`); the hub derives `contentHtml` itself (escape, then optional autolinking) and **never** renders externally-supplied HTML as-is (spec §10.5). Content marked `_unverified` MUST be displayed distinctly.

### Inbox Endpoint

```
POST {inbox}
Content-Type: application/json

<signed feed item, verbatim>
```

CORS is mandatory (spec §10.1):

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

**Response codes** (spec §10.4):

| Status | Meaning |
|--------|---------|
| `202` | Accepted / queued (blocked authors SHOULD also get `202`, content silently discarded) |
| `400` | Malformed, missing fields, or not relevant to this inbox |
| `401` | Signature invalid or key revoked |
| `404` | Referenced target item does not exist |
| `409` | Stale version |
| `429` | Rate limited (include `Retry-After`) |

Error bodies: `{ "error": "code", "message": "human text" }` with codes `invalid_json`, `missing_field`, `not_relevant`, `invalid_signature`, `key_revoked`, `target_not_found`, `stale_version`, `rate_limited`.

Senders retry 5xx/timeouts with exponential backoff for 24 hours. Missed deliveries are recovered by polling the sender's feed — the feed is the source of truth; the inbox is a latency optimization (spec §10.4, §1).

**Never republish what arrives here (spec §11.1.1).** An inbox item with **no `_feed_url`** was *delivered, not published* — its author deliberately kept it off the public web. The hub holds it as a custodian, so it MUST NOT appear in any public artifact: not in a member's published `feed.json`, not in a manifest, not in any thread-discovery or query endpoint if one is ever built (spec §11.1.1 binds every public projection), and not in a Webmention or ActivityPub bridge emission. Rendering it in the authenticated `/api/feed` for logged-in family is fine — that is the audience it was delivered to.

This matters most for the case this product depends on. Family interactions on encrypted content are delivered rather than published precisely so the reply graph never lands in a world-readable file (spec §15.4). One helpful "let's publish the comment thread so it's complete" feature undoes that for the whole family, silently, and nobody outside the hub can detect it. Gate it in code: a single `if (!item._feed_url) return` on every path that writes to a published file.

The one scoped exception is gateway backfeed, and the bytes distinguish it: a delivered item carrying `_unverified: true` **and** an `external_url` came from an enrolled gateway conveying a *publicly-published* foreign reply, and MAY render on the entry's unsigned HTML page (never in any signed artifact) — see "POSSE and the syndication gateway" and spec Appendix C. A native family item carries neither marker, and the gate above applies to it absolutely.

### Threading (nested replies)

A `reply` entry's `to` points at the **parent** item (spec §8.1). When the parent is not itself the thread root, the item SHOULD also carry a `root` entry pointing at the thread root, and the sender SHOULD deliver the nested reply to **both** the parent author's and the root author's inboxes. Without the `root` entry, the inbox relevance check (judged per `_rel` entry) would cause the thread host to reject a reply-to-a-reply as `not_relevant`. Clients build the tree by walking parents and SHOULD cap walk depth (malicious data can contain cycles).

### Sending Interactions (outbound)

To comment on, like, or reply to another identity's item, a hub user's action produces a signed item and the hub POSTs it to the target's inbox:

1. Build the item with the appropriate `_rel` entry/entries (`reply`, `like` + `_emoji`, `repost`, `quote`, plus `root` for nested replies)
2. Sign it with the hub's delegated key (spec §4.6; invisible to the user)
3. Discover the recipient's inbox from their `openfeed.json` (`inbox` field)
4. POST the signed item verbatim; retry with backoff on 5xx/timeout
5. Publish the same item in the sender's own feed **only where its target is public**. On a `public` entry, relations meant to be seen (`reply`, `repost`, `quote`, `mention`) are published normally, so polling discovers them. On `family` — that is, encrypted — content they are **delivered only**: `_rel[].to` stays cleartext even when the content does not (spec §11.4), so publishing a family reply writes the family's reply graph into a world-readable file. That is exactly what the delivered column exists to prevent (spec §15.4) and exactly what "Never republish what arrives here" above is protecting; publishing your own reply undoes it just as completely as republishing someone else's. Likes stop at the inbox in every case — no `_feed_url`, no feed, no manifest (spec §8)
6. On a `family` entry, deliver the reply to **every identity the entry's declared audience names** (spec §15.2.2), wrapped to their encryption keys — each resolved from that member's own `openfeed.json`, never from the audience list, which names people and holds no keys (spec §15.1). Fan-out is per-inbox, so a member whose inbox is down recovers nothing by polling: these items are delivered, not published, and the feed cannot heal them. Retry per spec §10.4 and say so in the UI rather than showing a thread that is silently incomplete for one member

### Reactions (inbox)

A reaction is the same flow with a `like` relation and no content:

```json
{
  "id": "urn:uuid:...",
  "authors": [{ "url": "https://jessepence.com/" }],
  "date_published": "2025-12-07T16:05:00Z",
  "_version": 1,
  "_rel": [{ "type": "like",
             "to": "https://mom.pence.family/feed.json#urn:uuid:550e8400-...",
             "_emoji": "😂" }],
  "_sig": "..."
}
```

To *change* a reaction, tombstone the old item and publish a new one with a fresh `id`; to *retract* one, deliver a tombstone to the same inbox (spec §8.2).

### Aggregating Self-Hosted Entries

When a family member self-hosts, their journal entries should appear in the family feed. The hub polls each external member's **feed** and verifies:

**Option A: Poll their feed (simple)**
- Hub periodically fetches each external member's `openfeed.json` (for keys/endpoints) and JSON Feed
- Verify each item's `_sig` (spec §6.5) and enforce the canonical/copy rule (`_feed_url` must match the feed URL fetched, spec §7.5)
- Pin and walk the member's manifest chain (spec §9.1); check each item against its manifest entry
- Poll frequency: every 15-30 minutes

**Option B: WebSub (real-time)**
- External member's feed advertises a WebSub hub (JSON Feed `hubs`; a README convention — nothing Open-Feed-specific)
- Hub subscribes; gets notified immediately when they publish
- MUST still verify item signatures — the WebSub hub is untrusted infrastructure

Start with polling. Add WebSub later if latency matters. Polling also **heals missed inbox deliveries**: a reply found in a member's feed whose `_rel` targets a hub entry is reconciled against the inbox record (the feed is authoritative; the inbox is a cache).

**External `family` feeds (the two-self-hosters case):** when a relative runs their own hub, their `family` feed is fetched like any other feed — it is a public, CORS-`*`, manifested file whose *contents* are encrypted to the family audience (spec §11.3). There is no authenticated fetch, no `401`, and no reader list: the hub polls it exactly as it polls a public feed. Decryption happens in the reading member's own client, since the hub holds no member's encryption key (see "Key custody") — the hub's job on this path is fetching, verifying, and handing over bytes it cannot read. This is why cross-hub family sharing works at all without a second authorization mechanism — and why the encryption extension is a launch dependency rather than a nice-to-have.

```typescript
interface ExternalMember {
  identityUrl: string;           // https://jessepence.com/
  feedUrl: string;               // https://jessepence.com/feed.json
  manifestUrl: string;           // https://jessepence.com/manifest.json
  role: 'member' | 'viewer';
  identityPin?: { seq: number; hash: string };   // pinned openfeed.json (spec §5.3)
  manifestPin?: { seq: number; hash: string };   // pinned manifest (spec §9.1)
  lastFetched?: Date;
  lastEntryId?: string;          // To detect new entries
}
```

### Optional Webmention Bridge

Webmention is **not** a co-equal delivery path — it is an optional gateway for IndieWeb tools that can't speak the signed inbox (spec Appendix C). Content that arrives via Webmention cannot be a native signed Open Feed item (no one holds the sender's Open Feed key), so it MUST be marked `_unverified: true` and displayed distinctly — **always, with no exception** (spec §7.5). It is signed by the hub acting as gateway; `external_url` names the foreign original. Treat it as lower-trust throughout; never present it as a native, verified identity.

If you implement the bridge:

```
Jesse publishes an h-entry reply on his own site and pings the hub:

  POST pence.family/webmention
  Content-Type: application/x-www-form-urlencoded
  source=jessepence.com/replies/2025-12-07-cookies.html
  target=mom.pence.family/2025/12/07/

Hub:
  - Fetches Jesse's page, parses the h-entry (author, content, timestamp)
  - Verifies the claimed author URL is a path prefix of the source URL
    (the h-card is self-asserted; on a shared host, same-origin alone is
     insufficient — dad's subdomain must not claim to be mom's)
  - Verifies Jesse is in the family list
  - Synthesizes an _unverified item (§7.5) and stores it, clearly marked
```

Response codes: `202` (queued), `400` (invalid source/target), `200` (processed).

Comment/like markup (h-entry / h-card / `u-in-reply-to` / `u-like-of`) and the microformat class reference live under "Notes for Future Development" — they belong only to this bridge, not the core.

### Family Membership

The hub maintains a family list of identity URLs (used both for the inbox reader/author allowlist and any Webmention bridge):

```json
{
  "family": [
    {"identity": "https://mom.pence.family/", "role": "admin"},
    {"identity": "https://dad.pence.family/", "role": "member"},
    {"identity": "https://jessepence.com/", "role": "member"}
  ]
}
```

For inbox items, authorship is cryptographic (the signature + author binding), so the family list gates *authorization* (is this verified author allowed to interact, and are they in the audience we encrypt `family` content to?), not *authentication*. For the Webmention bridge, the list is the only gate, and claims failing the source-prefix check go to moderation as unauthenticated — never auto-accept them as that identity.

---

## Signatures

All published artifacts are signed with one construction (spec §6): detached JWS Compact Serialization with **unencoded payload** (RFC 7515 + RFC 7797), Ed25519, over RFC 8785-canonical bytes. This single construction signs identity documents, feed items, and manifests identically. On the hub, items and manifests are signed at write time with the hub's **delegated** key (spec §4.6), invisibly to the member; versions of `openfeed.json` are signed by the member's **root** key on their own device (see "Key custody"). Self-hosters sign everything with their own keys.

### Where keys live

Keys are JWK objects in the `keys` array of the identity document (`openfeed.json`) — there is **no separate JWKS document** (spec §3.2, §4). Key ownership is structural: the identity named by a `kid` either lists the key or it doesn't (spec §4.2).

The full key identifier in a JWS header is `{identity_url}#{kid}` (spec §4.2), e.g. `https://jessepence.com/#key-1` — **not** a JWKS URL fragment. Verifiers split at the **last** `#`: left side is the identity URL, right side is the `kid` to find in that identity's `openfeed.json`.

### Key custody: delegated by default

**The hub is a servant, not a custodian** (spec §12's recommended architecture). Each member's identity carries three keys generated in the member's own client at onboarding, plus one the hub holds:

| Key | `use` | Generated | Held by | Signs / does |
|---|---|---|---|---|
| Root signing key | `sig` | Member's device | Member only | Every version of `openfeed.json` — keys, profile, endpoints, migration |
| Recovery key | `recovery` | Member's device | Member, offline | Co-signs migration and fork resolution (spec §4.5) |
| Encryption key | (extension, spec §15.1) | Member's device | Member only | Decrypts `family` content |
| Delegated key | `delegated` | Hub | Hub | Feed items, manifests, delivered items, **and tombstones** — never an identity-document version (spec §4.6) |

Day to day this is invisible: publishing an entry, batching a manifest, propagating a tombstone, POSTing an interaction — all of it runs on the delegated key with the member's device asleep. What changes is what the hub *cannot* do. It cannot add a key, un-revoke one, publish a `successor`, or edit the delegation itself, because every one of those is a version of the identity document and the hub never held a key that can sign one. The hostile-custodian adversary's cheapest identity attack — quietly adding a key of its own to the chain — stops being a thing this hub is trusted not to do and becomes a thing it cannot do.

**Identity-chain events therefore need the member's device**, and there are few of them: key rotation, revoking the hub's delegation, profile edits, migration — five to twenty in an identity's life, plus profile changes. The flow is the same every time: the hub composes the candidate version bytes, the client shows the member a diff of what changed, and the **root key signs on-device**. Build this once, in Phase 1, and every later ceremony reuses it.

What delegation does **not** buy, stated plainly so the UI never overstates it: a hub holding a delegated key can impersonate a member's *content* until the member revokes the delegation, and revocation is itself a root-signed chain version, so the member must still be able to reach their root key. And where this hub also ships the client (it does), every client-side guarantee is bounded by that client — the out-of-band genesis comparison at onboarding step 3b is the one check that survives it (spec §13.2, delegated-custodian tier).

**A tombstone is an item, so the delegated key can delete a member's journal** (spec §4.6). Not silently — spec §9.3 invariant 1 puts every removal in the manifest's `deleted` map under a signed tombstone every pinned reader sees — but not preventably either, and for a product whose value proposition is a decade of family archive that is the sharper capability of the two. **Sign tombstones with the member's root key, on their device.** A root key is an ordinary `sig` key, so signing an item touches no identity-document version and needs no ceremony beyond the on-device signing flow this hub already builds for chain versions; the hub still advances the manifest that commits the tombstone, so spec §9.2's "advance immediately for a tombstone" is unaffected. The cost is that a delete requires the member's device to be reachable, which is the correct thing to require of a delete and the wrong thing to require of a post — which is exactly why the two split here and not elsewhere.

**Root-key loss is better prevented than recovered.** A member MAY hold more than one active root `sig` key — phone and laptop — and any of them can advance the chain (spec §4.3), so a lost device is an ordinary rotation signed from the other one: no card to find, no relocation, nothing escalated. Offer the second key at onboarding, where the client is already generating keys and it costs one more step. Only where no second key exists does loss fall back to the recovery key: the member re-establishes at a new URL carrying `predecessor` with a recovery co-signature (spec §3.4, §4.5), which is the same path as domain loss and already on the Phase 1 list. Same-URL root replacement is deliberately not supported — a hub that could re-key a member's identity in place is the custodian this architecture exists to eliminate.

**Where a deployment cannot meet this** — a purely server-side signup with no client capable of generating or holding keys — spec §12 requires it to *disclose* that the operator can rewrite the member's identity state, not merely impersonate their content. That is a materially different sentence from the email trust model, and it must be shown to the member, not buried.

### JWS header (spec §6.2)

```json
{ "alg": "EdDSA", "b64": false, "crit": ["b64"], "kid": "https://jessepence.com/#key-1" }
```

All four fields MUST be present with exactly these `alg`/`b64`/`crit` values. Reject unrecognized `alg`, unknown `crit` entries, and any key whose `crv` is not `Ed25519`.

### Signed item example

```json
{
  "id": "urn:uuid:...",
  "url": "https://jessepence.com/2025/12/07/",
  "content_text": "Those cookies were amazing!",
  "date_published": "2025-12-07T16:00:00Z",
  "authors": [{ "url": "https://jessepence.com/" }],
  "_feed_url": "https://jessepence.com/feed.json",
  "_version": 1,
  "_rel": [{ "type": "reply",
             "to": "https://mom.pence.family/feed.json#urn:uuid:550e8400-..." }],
  "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vamVzc2VwZW5jZS5jb20vI2tleS0xIn0..base64sig"
}
```

Item author binding: the item-level `authors` array MUST contain **exactly one entry** whose `url` is the signer's identity (spec §6.6). Feed-level `authors` carry no authority. Items served in a feed MUST include `_feed_url`; inbox-only items omit it.

### Verification process (spec §6.5)

1. Extract and remove `_sig` (and `_recovery_sig` if present); canonicalize the remaining JSON (RFC 8785)
2. Parse the JWS header; enforce §6.2 (`alg=EdDSA`, `b64=false`, `crit=["b64"]`); read `kid`
3. Split `kid` at the last `#` → identity URL + key id
4. **Author binding:** the `kid`'s identity URL MUST equal the claimed author (the single `authors[].url` for items; the `url` field for manifests/identity docs) after normalization. Reject otherwise
5. Fetch the identity document at `{identity_url}openfeed.json`; enforce pinning (spec §5.3); find the key by `kid`. (No arbitrary URL from the `kid` is ever fetched — the path convention makes discovery structural, spec §13.9.)
6. If the key has `iat`, verify it predates the content's **effective signing time** (`date_modified` if present, else `date_published`; `updated` for manifests/identity docs)
7. Verify the key was not revoked before the effective signing time (for inbox items, check against **receipt time**, spec §4.4)
8. Verify the Ed25519 signature over the reconstructed signing input (`ASCII(header-b64 || '.') || canonical-bytes`)

### JSON Canonicalization (RFC 8785)

Before signing or verifying:
1. Serialize with no whitespace between tokens
2. Sort object keys lexicographically (recursively)
3. ES6 number formatting (no unnecessary leading/trailing zeros)

Strings are signed **byte-exact as published** — no verify-time Unicode normalization (spec §6.3). Emit NFC when authoring content, and **reject JSON with duplicate object keys** (I-JSON, RFC 7493).

```json
// Input (with whitespace)
{ "b": 1, "a": 2 }

// Canonical output
{"a":2,"b":1}
```

Libraries: none needed — `src/canonical.js` in this repo does RFC 8785 and the strict I-JSON parse together, and the strict parse is unavoidable anyway (spec §6.3 requires rejecting duplicate member names, which `JSON.parse` and the `canonicalize` npm package both accept silently).

### The manifest (spec §9)

Signing an item is not enough — a host could silently drop or roll back your content. So each feed carries a **separately-signed, chained manifest** committing to its item set. Whenever the app publishes, edits, or tombstones an item, it MUST **advance the manifest**:

```json
{
  "url": "https://mom.pence.family/",
  "feed_url": "https://mom.pence.family/feed.json",
  "seq": 412,
  "prev": "Jq3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "updated": 1739577600,
  "items": {
    "urn:uuid:550e8400-...": [3, "czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"],
    "urn:uuid:661f9511-...": [1, "vdS1bhnFd5XsIugXNLR0k-7UHDxRJi7DO6XRWF5l_gU"]
  },
  "deleted": { "urn:uuid:99aa2222-...": [4, "8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI"] },
  "_sig": "..."
}
```

- `items`: map of live item `id` → `[version, hash]`, the hash being the SHA-256 of that item's exact published bytes (spec §9). Sign the item, then commit its bytes — a version alone would let a key-holding hub show two family members different text under one `(id, version)` with identical manifests
- `deleted`: map of tombstoned `id` → `[version, hash]` of its tombstone
- `seq`/`prev`/`_sig`: the same pin-and-walk chain discipline as the identity document (spec §5), applied to content. Publishing advances the **manifest** chain; the identity chain stays short (it only versions keys/profile/endpoints). Prior versions are served at derived URLs (spec §5.4) — no history-index file to write
- The identity document commits to the manifest by **URL**, not by hash, so ordinary publishing never re-signs `openfeed.json`.

Emit `_skip` (spec §9.1.1) once a member's manifest passes ~100 KB. It reads like a tuning knob and is not: without it, a family member who stops reading for a few weeks cannot reconnect their pin inside spec §13.4's fetch budget, and a conforming verifier must then treat the chain as unverifiable (spec §5.3). The hub would be stranding its own readers by omission. Emit the current version at its derived URL too (`manifest/{seq}.json` written *before* `manifest.json`, spec §5.4), so a reader whose tip disagrees with its pin has a retained copy to settle it against.

Consumers pin the manifest at its `(seq, hash)` on first observation and walk `prev` to the pin on every later fetch (spec §9.1). Together with `_feed_url` (spec §7.5), the manifest closes both omission (a host can't drop your content) and injection (a host can't resurrect or inject content by copying it into its own feed).

### When to verify

- **Always** verify signatures on inbound content: inbox items, and anything fetched from another feed
- Enforce the canonical/copy rule (spec §7.5): an item is canonical only in the feed its `_feed_url` names; a copy is verifiable as *authored* but carries no liveness or manifest standing
- Hub-hosted content is also signed at write time (conforming feeds require it); the hub can trust its own DB for internal reads, but the signature + manifest are what make that content portable and verifiable by everyone else

### Transient failures (spec §12)

If an `openfeed.json` or manifest fetch fails transiently: cache the failure and retry at 1 h, 4 h, 24 h before permanent rejection. Don't reject on the first transient failure.

### SSRF and fetch discipline (spec §13.5, §13.9)

For every outbound fetch: HTTPS only, ≤5 redirects, 10 s timeout, size limits, reject private/loopback/link-local addresses. Never follow a cross-origin redirect for an identity document. Rate-limit inbox by source IP *before* fetching (the `author` is attacker-controlled until verification succeeds), and negatively cache lookup failures.

---

## Published Output

When an entry is published, the app generates/updates these files. The **signed** artifacts (`openfeed.json`, `feed.json`, `manifest.json`) are the protocol core; HTML and Atom are additive conveniences.

### Identity Document (`openfeed.json`) — discovery

```
mom.pence.family/openfeed.json
```

The single signed source of discovery — profile, keys, and endpoints (spec §3.2). This replaces the old profile-HTML-with-`<link>`-discovery + separate JWKS entirely.

```json
{
  "url": "https://mom.pence.family/",
  "name": "Mom",
  "bio": "Grandmother, gardener, cat enthusiast.",
  "avatar": "https://mom.pence.family/avatar.jpg",
  "feeds": [
    { "url": "https://mom.pence.family/feed.json",
      "manifest": "https://mom.pence.family/manifest.json",
      "rel": "primary" },
    { "url": "https://mom.pence.family/activity.json",
      "manifest": "https://mom.pence.family/activity-manifest.json",
      "rel": "activity" }
  ],
  "inbox": "https://mom.pence.family/inbox",
  "seq": 7,
  "prev": "aNy3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "updated": 1739577600,
  "keys": [
    { "kid": "key-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "iat": 1736899200 },
    { "kid": "recovery-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "recovery", "iat": 1736899200 }
  ],
  "_sig": "..."
}
```

Advance the identity chain (bump `seq`, set `prev`/`updated`, re-sign, and retain the old version at its derived URL, spec §5.4) only on **identity** changes — keys, profile, endpoints, migration links — not on content publication (spec §3.2, §5.2).

### JSON Feed (`feed.json`) — signed items

```
mom.pence.family/feed.json
```

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Mom's Journal",
  "home_page_url": "https://mom.pence.family/",
  "feed_url": "https://mom.pence.family/feed.json",
  "authors": [{"name": "Mom", "url": "https://mom.pence.family/"}],
  "items": [
    {
      "id": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "url": "https://mom.pence.family/2025/12/07/",
      "title": "Made cookies with the grandkids",
      "content_text": "The grandkids came over today...",
      "content_html": "<p>The grandkids came over today...</p>",
      "date_published": "2025-12-07T14:30:00-05:00",
      "authors": [{ "url": "https://mom.pence.family/" }],
      "_feed_url": "https://mom.pence.family/feed.json",
      "_version": 1,
      "_sig": "..."
    }
  ]
}
```

Each item carries the single-entry `authors` binding, `_feed_url`, `_version`, and `_sig`. `id` is a permanent UUID/tag URI and MUST NOT contain `#` (ids appear as URI fragments in `_rel` targets). Serve feeds with `Content-Type: application/feed+json` (or `application/json`) and `Access-Control-Allow-Origin: *`. Carry at least the 50 most recent items; paginate via `next_url` (spec §7.4).

### Manifest (`manifest.json`) — content commitment

```
mom.pence.family/manifest.json
```

Published and advanced on every content change (see "The manifest" above and spec §9). This is a required Level 2 artifact — a feed without a manifest is not conformant.

### Activity feed (optional) — content-less relations

```
mom.pence.family/activity.json  (+ mom.pence.family/activity-manifest.json)
```

Likes/reposts (content-less `_rel` items) SHOULD go here, listed under `feeds` in `openfeed.json` with their own manifest (spec §8), so the primary feed stays clean for Level 0 readers.

### HTML Page (optional, human-only)

```
mom.pence.family/2025/12/07/index.html   ← entry page
mom.pence.family/index.html              ← optional human profile page
```

The identity URL MAY serve a human-readable HTML page, but **discovery no longer depends on it** — machines read `openfeed.json` (spec §3.1). The old `<link rel="jwks">` / `rel="feed"` / `rel="webmention"` discovery links are gone from the core; keep only what a human browser needs (a `rel="alternate"` to the JSON/Atom feed is a nicety, not a protocol requirement). `h-entry`/`h-card` microformats remain useful only for the optional Webmention/IndieWeb bridge.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Made cookies with the grandkids - Mom's Journal</title>
  <link rel="canonical" href="https://mom.pence.family/2025/12/07/">
  <link rel="alternate" type="application/feed+json" href="https://mom.pence.family/feed.json" title="JSON Feed">
  <link rel="alternate" type="application/atom+xml" href="https://mom.pence.family/feed.xml" title="Atom Feed">
</head>
<body>
  <article>
    <h1>Made cookies with the grandkids</h1>
    <p>Mom · <time datetime="2025-12-07T14:30:00-05:00">December 7, 2025</time></p>
    <div>
      <p>The grandkids came over today and we made chocolate chip cookies...</p>
      <img src="cookies.jpg" alt="Fresh cookies on a cooling rack">
    </div>
  </article>
  <section id="comments"><!-- server-rendered or client-fetched --></section>
</body>
</html>
```

### Atom Feed (optional)

```
mom.pence.family/feed.xml
```

Atom (not RSS 2.0) for maximum compatibility with plain feed readers (spec Level 0). Trivially derived from the same data as the JSON Feed. Atom carries no Open Feed signatures — it exists only so unmodified RSS/Atom readers can subscribe.

```xml
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Mom's Journal</title>
  <link href="https://mom.pence.family/"/>
  <link rel="self" href="https://mom.pence.family/feed.xml"/>
  <id>https://mom.pence.family/</id>
  <updated>2025-12-07T14:30:00-05:00</updated>
  <author><name>Mom</name><uri>https://mom.pence.family/</uri></author>
  <entry>
    <title>Made cookies with the grandkids</title>
    <link href="https://mom.pence.family/2025/12/07/"/>
    <id>urn:uuid:550e8400-e29b-41d4-a716-446655440000</id>
    <published>2025-12-07T14:30:00-05:00</published>
    <updated>2025-12-07T14:30:00-05:00</updated>
    <content type="html">&lt;p&gt;The grandkids came over today...&lt;/p&gt;</content>
  </entry>
</feed>
```

### What Gets Published

| Visibility | openfeed.json | HTML | JSON Feed + manifest | Atom |
|------------|---------------|------|----------------------|------|
| `public` | Yes (lists feed/manifest) | Yes | Yes (public feed + manifest) | Yes |
| `family` | Yes (lists the feed + its manifest, like any other) | Yes (behind auth) | Yes — an ordinary public feed + manifest whose item **content is encrypted** to the family audience (spec §11.3) | No |
| `private` | Yes (no listing) | No | No | No |
| `unlisted` | Yes | Yes | No | No |

**Before the encryption layer ships, `family` entries are not published.** They live in the authenticated app and in the export bundle's `unpublished` slot (spec §14) — in no feed, no manifest, and no Atom mirror, the same treatment `private` gets. The tempting alternative, a cleartext feed behind a login wall, fails twice over: a feed listed in `feeds` that answers `401` is indistinguishable from withholding to every external consumer (spec §9.3) and forfeits the `Access-Control-Allow-Origin: *` that every published document carries (spec §12). And it is **irreversible in the direction that matters**. Per the transition table below, `public → family` means tombstone-plus-republish; deletion is best-effort; the bytes were already served openly and may already be archived by anyone. Anything published cleartext now is permanently public, so Phase 1 ships `family` as a visibility the app honors, not as a feed it serves. This is the one scheduling decision in this document that cannot be corrected later.

**No document is ever served in audience-varying forms.** Two views at one `seq` would be equivocation (spec §5.3), and that applies to feeds and manifests as much as to `openfeed.json`. A `family` feed is therefore a real signed JSON Feed with its own signed manifest, served to everyone, byte-identical — what differs is that its items' *content* is encrypted to the family audience. Every reader can pin it, walk it, and gossip about it; only the family can read it.

What this buys, versus the authenticated-fetch design it replaces: the feed stays statically hostable and CDN-cacheable, the completeness proof survives, the export bundle and migration cover it, and cross-reader equivocation detection works by construction rather than needing a separate commitment mechanism.

What it costs, and users must be told: **the metadata is public.** Anyone can see that this identity posted, when, how often, and — from `_rel` — who replied to whom. Only the content is opaque. Where the interaction graph itself is sensitive, keep those items off the feed and deliver them to inboxes instead (spec §11.1). See also the honest bound on the guarantee: encrypted content is exactly as private as the recipient's key custody. Here every member holds their own encryption key, so this hub cannot read `family` content — with the residual stated at "Key custody": the hub also ships the client that holds the key.

### Visibility Changes & Unpublishing

Visibility is not write-once. When an entry's visibility changes (or it is deleted), previously published artifacts must be actively retracted via **tombstones** and the **manifest** (spec §7.3, §9):

| Transition | Actions |
|------------|---------|
| any → `private` / deleted | Publish a signed **tombstone** (same `id`, bumped `_version`, `date_modified` set, `_deleted: true`, content removed); update the manifest (move the id from `items` to `deleted`); delete the static HTML; ping WebSub if enabled |
| `public` → `family` | Tombstone in the public feed + public manifest; republish (fresh signed item, content encrypted to the family audience) in the family feed + its manifest; serve HTML behind auth |
| `family` → `public` | Tombstone in the family feed + manifest; publish in cleartext to the public feed + manifest; regenerate HTML without auth |

Tombstones SHOULD stay in the feed ≥30 days; the manifest remembers them (in `deleted`) permanently. Deletion is best-effort — a consumer that never re-fetches can't be forced, and anything already syndicated to email/RSS can't be recalled. Warn users of this when they downgrade visibility. Note that the `deleted` map makes "this identity deleted something at version N" a lasting public fact (spec §13.8), and the manifest chain publishes posting cadence. Encryption does not hide either. Do not wave this away as "fine for family": where the person being watched is watched *by* family, this is the leak that matters.

---

## AI Companion

The AI companion is the product. Everything else is plumbing.

### What the AI Does

| Task | Description |
|------|-------------|
| Daily conversation | Asks about user's day, prompts reflection |
| Entry drafting | Synthesizes conversation into a journal entry |
| Visibility suggestion | "This mentions health stuff—keep it family-only?" |
| Photo descriptions | Generates alt text for images |
| Notification digest | "Dad loved your cookies post" |

### AI Context

What the AI can see:

```typescript
interface AIContext {
  user: {
    profile: User;
    recentEntries: Entry[];       // Last ~10 entries for continuity
    preferences: {
      defaultVisibility: Visibility;
      publishTime: string;        // "9pm" or "manual"
    };
  };

  family: {
    members: User[];
    recentPosts: Entry[];         // Family posts visible to this user
    recentComments: Comment[];    // Comments on user's entries
  };

  session: {
    messages: Message[];          // Today's conversation
    draft: Partial<Entry>;        // Entry being composed
    pendingPhotos: Photo[];       // Photos to include
  };
}
```

### AI Privacy Boundaries

| AI Can Access | AI Cannot Access |
|---------------|------------------|
| User's own entries (all) | Other users' private entries |
| User's own drafts | Other users' drafts |
| Family posts user can see | Other users' AI conversations |
| Comments on user's entries | Auth tokens, passwords, any private key |
| Encrypted `family` content — **only in the member's own client**, which is the only place it decrypts | Encrypted content, server-side: the hub holds no encryption key |

AI conversations are stored per-user and never shared with other users or their AI companions.

**Cross-user consent:** "Family posts user can see" means *other members'* content — including their `family`-visibility entries — enters this user's AI context and reaches whatever model serves it, which those authors never explicitly agreed to. Encryption changes *where* that happens, not whether it needs consent: once `family` content is encrypted (Phase 3), the hub cannot assemble it at all, so the disclosure happens in the reading member's own client and is theirs to make. Handle it explicitly either way:

- Disclose during onboarding that family-visible posts may be processed by a model on another member's behalf, and say which model runs where — on the hub, on that member's device, or at a provider that member chose
- Provide a per-user opt-out (`ai_exclude` flag): excluded members' entries and comments never enter anyone else's AI context
- Never include another member's `private` entries or drafts (already the rule above)
- **Delivered-only items never enter AI context.** An interaction with no `_feed_url` is one its author deliberately kept off the public web (spec §11.1.1), and on encrypted content that is where every family reply lives by design (spec §15.4). Shipping it to the AI provider is not a §11.1.1 violation — an API call is not a publicly-readable artifact — but it is the same disclosure the sender declined, made on their behalf by the hub. Gate it on the field the republication gate already reads: `if (!item._feed_url) return`, on the context-assembly path as well as the publish path. A member's *own* client running over their *own* inbox is a different question and theirs to answer; this binds the hub
- Be precise about what `ai_exclude` is worth. On **encrypted** content it is a cryptographic fact: exclusion means "not in the wrap-list," and no server-side process could include them if it wanted to. On cleartext content the hub stores — `public` and `unlisted` entries, drafts, comments — it is a **policy promise** the hub keeps, enforceable only by the hub. Say which one applies to the content at hand rather than which one applies to the member
- The underlying rule: **server-side AI and host-blind reading are mutually exclusive on the same content**, and this product has chosen host-blind for `family`. So the companion for `family` content runs client-side — a scheduled Phase 3 item shipping alongside encryption, not a footnote. Until it ships, `family` entries are not published at all (see "What Gets Published") and the AI works over cleartext the hub already holds; state plainly which tiers get which

### Daily Flow

```
Morning     User shares plans, mood
            AI: "Sounds like a full day!"
              ↓
Throughout  User shares moments, photos
            AI captures, asks follow-ups
              ↓
Evening     AI: "Ready to wrap up today's entry?"
            User reviews draft, makes edits
              ↓
Publish     AI: "Family only, or public?"
            User approves → Entry signed, feed + manifest advanced
```

### Entry Generation

The AI should:

1. **Summarize, don't transcribe** - Extract key moments
2. **Preserve voice** - Sound like the user, not the AI
3. **Respect "off the record"** - User can say "don't include this"
4. **Structure naturally** - Paragraphs, maybe a photo, maybe a quote

**Disclosure**: Entries should include `_ai_assisted: true` in metadata (a preserved `_`-prefixed extension field, spec §3.2/§7.2). It is part of the signed bytes. Display is user preference (subtle footer, or nothing visible).

---

## Family Features

### Aggregated Feed

The home screen shows all family posts:

```
GET /api/feed
```

Returns entries from all family members, newest first, respecting visibility.

### Notifications

When something happens, notify the relevant user:

| Event | Notify |
|-------|--------|
| New entry from family member | All family (configurable) |
| Comment on your entry | Entry author |
| Reaction on your entry | Entry author |
| Reply to your comment | Comment author |

Start with in-app notifications. Add email/push later.

### User Roles

| Role | Can do |
|------|--------|
| `admin` | Everything, plus manage users |
| `member` | Post, comment, react, see family content |
| `viewer` | See family content, react only |

---

## Onboarding

### Adding a Family Member

1. Admin creates invite: `POST /api/invites` → returns invite link
2. Invitee clicks link, creates account (username, password/passkey)
3. The **member's client generates three keys — root signing, recovery, and encryption — on their own device**, and sends the hub only their public JWKs (spec §4.5, §12, "Key custody"). The hub generates its own **delegated** key, composes the genesis `openfeed.json` (`seq: 1`) carrying all four public keys, and the client signs it with the root key. The hub then publishes it along with an empty feed and genesis manifest, both signed with the delegated key.

   Generating all three at once is why this costs no extra friction: the ceremony below already had to happen for the recovery key, and the root and encryption keys ride along in the same generate-and-store step. Automatic client-side generation with a good default is the design goal — the member should see a "save this" moment, not a key-management screen.

3a. The **recovery key never leaves the device** and is the one the member must store deliberately — a password manager, a printed card, a second device.

   **Place the recovery key well** (spec §4.5): a card in a drawer is exactly the artifact a hostile-custodian adversary (spec §13.2) has physical access to, and that adversary holding both the hub and the recovery key can produce a competing branch spec §5.5 actively prefers. Help the member store the private half with someone the operator cannot reach — held elsewhere is the version of this that survives the threat model the product is built around. It costs onboarding friction, which is real — so make it an offer with a good default, not a wall.

   This step is not optional and not a nicety: a recovery key the operator generated is not a check on the operator, and without it a member **cannot leave** (spec §3.4, §14). It is the single most important thing this onboarding flow does. Note that spec §12 attaches this MUST to *hosting identities for other people*, not to Level 3 — it binds this hub from the first member in Phase 1, long before there is an inbox.

3b. **Show the member their genesis `(seq, hash)` and the fingerprints of their root and recovery keys**, in a form they can read aloud or photograph — and tell them to compare it with one relative. Record every later chain version's own hash and expose it on a "chain receipts" page (spec §4.5, §5.2, §12).

   Step 3a is defeated in full without this, while being honored to the letter. A hub that publishes the identity document also chooses what it says, and first contact is trust-on-first-use: this hub could serve *the member's* client a genesis carrying their real recovery key and serve *everyone else* one carrying a key it holds. The member's own view would be correct. At exit their co-signature would fail against every consumer's pin while the hub produced a competing branch that spec §5.5 *prefers*. One relative comparing one hash defeats it, and nothing else does — the defence is comparison, not cryptography.
4. Invitee is added with `member` role

### Removing a Member

1. Admin removes user
2. Their past entries/comments remain visible (historical record); their `openfeed.json`/feed/manifest stay served so old signatures still verify
3. They can no longer log in or post
4. The hub MUST still serve them their export bundle (below) — removal ends posting, not ownership

### Leaving (member-initiated)

A member must be able to leave without the operator's cooperation. This is a requirement, not a feature, and it is three things that only work together (spec §14):

1. **Export.** `GET /api/export` returns the member's signed export bundle (spec §14): identity document and every retained prior version, feeds, manifests and their prior versions, delivered and received items, and attachment bytes — all **byte-verbatim as published**, so the hashes still chain. Available on demand, without admin approval, not rate-limited into uselessness. A decade of photographs will not fit in one streamable JSON document, so serve it as spec §14's archive container — `openfeed-export.json` plus the attachment bytes as files named by their `_sha256` — rather than degrading to a list of URLs pointing back at the hub the member is leaving.

   **It MUST also carry the unpublished half** — every `private` and `unlisted` entry, every draft, and the member's AI conversations — in spec §14's `unpublished` slot. This is the part most likely to be skipped and the part that matters most here: the published feed is, by construction, the content the member already gave away. A journaling app whose export returns the public journal and withholds the private one has built a backup, not an exit. Sign private entries at rest with the ordinary construction and no `_feed_url` (spec §6) so they land in the bundle export-native rather than as a loose dump.
2. **Re-establish elsewhere.** The member stands up a new identity at a URL they control, carrying `predecessor`, and co-signs it with the recovery key from onboarding step 3a — which this hub never held and therefore cannot forge a competing branch with.

   Delegated custody adds a lever before that one. The member's **root key** can revoke the hub's delegation and publish the departure directly, from their own device, with no card to find and nothing to reconstruct — and because the hub never held a key that can advance the identity chain, it cannot answer with a branch of its own. The recovery key is what remains for the harder cases: domain loss, or a root key the member no longer has.
3. **Consumers follow.** Anyone holding a pin of the old identity verifies the co-signature against the recovery key committed in the chain and follows the migration, with no participation from this hub (spec §3.4).

If any one of the three is missing, there is no exit. Build all three, and test the walkthrough end to end before launch — with the hub deliberately refusing to help.

---

## Implementation Order

### Phase 1: Core App (Hub Users) — on-protocol from the start

- [ ] **Per-member subdomains** (DNS + wildcard/ACME TLS; one document root per subdomain). Identity URLs are permanent, so this precedes the first onboarding — see "Decision: subdomains, not subpaths"
- [ ] User auth (magic links or passkeys)
- [ ] **Client-side key generation** (root + recovery + encryption on the member's device) and the on-device root-signing flow for identity-chain versions; the hub's per-member delegated key stored encrypted at rest (spec §4.6, §12; see "Key custody")
- [ ] **Serve `openfeed.json`** per user (signed, chained; profile + keys + endpoints), retaining prior versions at `openfeed/{seq}.json` once `seq > 1` (spec §3.2, §5.4)
- [ ] Entry CRUD
- [ ] **`family` entries stay unpublished until Phase 3's encryption lands** — held in the app and in the export bundle's `unpublished` slot, never written to `feed.json`, `manifest.json`, or the Atom mirror. A cleartext family feed behind a login wall cannot be taken back later (see "What Gets Published")
- [ ] Canonicalization (RFC 8785 + I-JSON) + **signing on publish** (spec §6; sign once, cache)
- [ ] Signed JSON Feed generation (single-entry item `authors` binding, `_feed_url`, `_version`)
- [ ] **Publish + advance the signed, chained `manifest.json`** on every publish/edit/delete — committing each item as `[version, hash]` — retaining prior versions at `manifest/{seq}.json` once `seq > 1` (spec §9, §5.4). Advance immediately for tombstones; batching ordinary posts onto a cadence is allowed and bounds chain growth (spec §9.2)
- [ ] Static HTML generation on publish (human page; not a discovery surface)
- [ ] Atom feed generation (Level 0 readers)
- [ ] Comments/reactions as signed items with `_rel` entries (internal API produces the same signed item the inbox path would; likes are delivered-only, spec §8)
- [ ] Basic family feed
- [ ] **The three custody obligations** (spec §12), because Phase 1 is where this hub starts holding other people's keys: device-generated recovery keys (onboarding 3a), the genesis `(seq, hash)` + recovery-fingerprint disclosure and per-version chain receipts (onboarding 3b), and `GET /api/export` including the `unpublished` slot (§Leaving)

**Do not defer these to Phase 3.** Spec §12 attaches them to *hosting identities for other people*, which is orthogonal to running an inbox — a Level 2 hub with no inbox holds members' keys and controls their exit exactly as a Level 3 one does. Identity URLs are permanent, so members onboarded before these land are members onboarded into a hub they cannot verifiably leave, and no later phase retroactively fixes a genesis nobody compared.

**Test**: Can Mom post a signed entry, Dad comment on it (as a `_rel` reply item), Grandma subscribe in a plain reader, and an independent verifier confirm every signature *and* the manifest chain? Can Mom read her genesis hash off the screen, and export her whole journal — private entries included — while the admin refuses to help?

### Phase 2: AI Integration

**Where the companion runs follows what it can read.** Phase 2's content — drafts, `private`, `public`, and `unlisted` entries — is cleartext on the hub, so server-side context assembly is fine and simplest. `family` content is encrypted from Phase 3 onward to keys the hub never holds (see "Key custody"), so its drafting and assembly move into the member's client. Build the context assembler once, behind an interface that can run in either place; that is the entire cost of not painting yourself into a server-side corner, and paying it here is much cheaper than paying it in Phase 3.

- [ ] Conversation UI
- [ ] AI context assembly
- [ ] Entry drafting from conversation
- [ ] Visibility suggestions

**Test**: Can Mom talk to the AI and publish a journal entry?

### Phase 3: Federation (Self-Hosted Members)

- [ ] **Inbox endpoint (receive)** — the §10.2 verification pipeline (local checks → relevance over `_rel` → signature via `openfeed.json` → revocation vs receipt time), dedup by `(author, id)`, CORS, §10.4 responses, fetch-amplification guard (spec §13.9)
- [ ] Inbox sending (outbound signed items to others' inboxes; deliver nested replies to both parent- and root-author inboxes, spec §8.1)
- [ ] External family member management + allowlist (authorization, since authorship is cryptographic)
- [ ] Feed polling for external members — verify signatures, enforce `_feed_url` canonical/copy rule, pin + walk both the identity and manifest chains (spec §5.3, §7.5, §9.1), carry pins across a manifest relocation or migration (spec §9.3 invariant 5), and distinguish lag from **withholding** — an item the manifest commits that the feed never yields is a finding, not a pending fetch
- [ ] Thread backfill during polling: reconcile external feed items whose `_rel` targets hub entries, healing replies whose inbox delivery was missed (the signed feed is the source of truth; the inbox is a latency optimization)
- [ ] External entries in family feed
- [ ] **Encrypted content** (spec §15) for `family`-visibility feeds — a **launch dependency** for cross-hub family sharing, not an optional extra, and the gate on publishing `family` entries in any form at all (Phase 1 holds them back). Cross-hub family *replies* work through the **declared audience** (spec §15.2.2): the entry names the identities it was wrapped to inside its own sealed plaintext, so a reading member's client can wrap a reply to the same people without anyone publishing a roster. Ship the two together — an encrypted family post nobody outside the hub can reply to is the product's headline feature working in one direction only. Two things the UI must say rather than imply (spec §15.5, item 2): a replier is trusting the author's stated audience, which nobody can check, and adding a member is prospective — they will not be able to read the thread that came before them. What still needs a *published* membership document, and is permanently out of scope, is an audience somebody **other than the author** convenes (spec §11.2)
- [ ] **Client-side AI companion** — the other half of the encryption item above, and scoped rather than optional. Every member holds their own encryption key, so on `family` content the hub is blind, and drafting and context assembly run in the member's client against content only that client can decrypt. Shipping encryption without this would quietly remove the product's headline feature from exactly the tier the product is about. Two viable engines: a local model on the member's device (increasingly plausible on ordinary hardware, and the version with no third party at all), or the member's own provider key called from their own client — in which case say plainly that the content reaches that provider, since the hub can no longer make that disclosure on their behalf
- [ ] **Exit, re-tested across hosts** — the export bundle and recovery keys ship in Phase 1 (above); what Phase 3 adds is the other end, a consumer that follows a recovery-based migration from a pin with no cooperation from this hub (spec §3.4, §14)

**Test**: Can Jesse (self-hosted) post a signed reply item to Mom's inbox and have his own signed entries appear verified (signature + manifest) in the family feed?

### Phase 4: Polish

- [ ] Reactions polish (emoji via `_emoji` on `like` entries; activity feed only if reposts are published)
- [ ] Key rotation + revocation UI via identity-chain versions (spec §4.3, §4.4, §5.2), including revoking the hub's delegation from the member's own device; migration/recovery flow (spec §3.4). Recovery-key generation is deliberately **not** listed here — it ships in Phase 1 with the other custody obligations, and a line item this far down the page is precisely how it gets deferred
- [ ] Notifications (in-app)
- [ ] Photo uploads with thumbnails (+ `_sha256` attachment integrity, spec §7.4)
- [ ] Profile customization (advances the identity chain)
- [ ] Search (entries, comments)
- [ ] Signing tools for self-hosters
- [ ] Item-carried `_pins` (spec §16) for family-scale anti-equivocation and recovery propagation, plus the optional `_follows` document (a README convention, not a spec document) as the natural trust set for weighing them

**Test**: Does it feel good to use daily?

### Phase 5: Distribution (Optional)

- [ ] Email digests for family
- [ ] WebSub for real-time feed updates (JSON Feed `hubs`; README convention)
- [ ] **Syndication gateway** (spec Appendix C, syndication class): outbound POSSE to members' own Mastodon/Bluesky accounts + inbound backfeed by inbox delivery — see "POSSE and the syndication gateway" below
- [ ] `_accounts` in members' identity documents (README convention; spec §13.16 carries its warnings), with the HTML `rel="me"` links **generated from** the array at build time so one signed source feeds both surfaces
- [ ] Optional Webmention bridge (spec Appendix C) — `_unverified` ingest only, mirroring class

**Test**: Can Grandma get a daily email with the family's posts? Can Mom's post appear on her own Mastodon account with replies flowing back under her entry page?

---

## Future: Broader Federation

Self-hosted family members are covered in Phase 3. This section is for interoperating with the wider internet. All of these are **gateways** (trusted intermediaries), not transparent adapters — no bridge can hold a foreign author's Open Feed key, so **everything bridged in is `_unverified`, without exception** (spec §7.5, Appendix C).

**Two rival routes to the fediverse — pick one per network, per member.** The **zero-effort tier** is Bridgy Fed: the Atom mirror plus an h-card is enough for a third-party service to bridge a member into the fediverse with no gateway to operate, as `@mom.pence.family` — the identity URL itself. Nothing to build; weaker reach; the bridge operator sits in the middle. The **recommended tier** is the syndication gateway below: a real account (`@mom@mastodon.social`) the member holds, posted to by their own tooling. A member running *both* on one network has two presences with a split reply graph and followers who don't know which to follow — so the app should treat this as one choice per network, not a stack.

### POSSE and the syndication gateway

The **syndication class** of gateway (spec Appendix C) is the POSSE path: publish on the member's Open Feed identity, syndicate to the member's own Mastodon/Bluesky accounts, deliver responses back. The pitch is precise: *the silo copy is admitted to be a copy, the original comes with a receipt, and no intermediary is added beyond the silos POSSE already accepts* — which no bridge-based POSSE setup can say. The silos themselves are still trusted: for the copy's availability, the account, and the honesty of the notifications API the backfeed polls.

For hub members the gateway is naturally a hub-operated service; for self-hosters it is a client-side tool. Either way it is real work, not a checkbox: OAuth token management per member per platform, platform-specific reply polling (Bluesky replies are all public and can also be watched via the firehose, which is heavier infrastructure than polling Mastodon's REST API), mapping foreign replies home via the backlink each syndicated copy carries to the entry permalink, and tombstone propagation. Concretely, per spec Appendix C's backfeed rule:

- **Delivery, never publication.** Foreign replies are POSTed to the member's inbox as `_unverified` items with no `_feed_url`, signed by the gateway (or a proxy identity, which is also the per-foreign-author rate-limit granularity). They never enter any feed, manifest, or public query surface.
- **Enrollment.** A member enrolls the gateway explicitly (a field in the hub's family config, or accepted-gateway URLs alongside the member's identity); unenrolled gateways' `_unverified` deliveries are rejected or held for moderation. Gateway deliveries get their own, lower quota class.
- **Timestamps and restarts.** `date_published` on a delivered item is the gateway's signing time (or the inbox's 7-day bound rejects backfill); the foreign creation time rides in an extension key on the `_rel` entry. The gateway persists its foreign-object → `(author, id)` mapping so a restart cannot orphan later tombstones.
- **Deletion is best-effort.** A foreign delete observed by the gateway becomes a delivered tombstone; one it never observes leaves the copy in the member's inbox and export bundle. The enrollment flow states this.

**What renders under a post.** Beneath an entry page, the app shows three bands with distinct provenance: verified family replies (signed, published or delivered by known family); `_unverified` backfeed from enrolled gateways, rendered on the **entry's HTML page only** — the unsigned, revocable surface spec Appendix C and §11.1.1 permit, which honors a later foreign deletion — clearly marked as from Mastodon/Bluesky and never entering any signed artifact; and delivered-private family content, which renders **only** in the authenticated family view, never on the public page. These three MUST NOT share a "verified" badge (spec §13.16).

### ActivityPub (Mastodon/Fediverse) — mirroring class

The brid.gy model: a stateful actor proxy polls the feed and fans out `Create`/`Like`/`Announce`, mirroring AP replies into the inbox as `_unverified` items. Consider using a bridge service (like fed.brid.gy) instead of implementing directly. **FEP-8b32 is not a shortcut** — its `eddsa-jcs-2022` shares Open Feed's curve and canonicalization but signs different bytes, so no signature is reusable (README, "vs ActivityPub").

Two things this bridge MUST NOT do, both of which a naive implementation does by default (spec §11.1.1, F.2): emit an item with no `_feed_url` (delivered, not published — the family comment threads), and emit anything derived from an encrypted item, **including a placeholder**. Encrypted posts are skipped entirely, not announced as "encrypted post."

### Public Discovery

Currently, you share your URL directly. For public discovery:
- WebFinger support (`/.well-known/webfinger`) resolving `@user@domain` to the identity URL, after which clients fetch `openfeed.json` as authoritative (a README convention, not a spec document)
- Hub directory page
- Search engine optimization

### Identity Portability (Migration & Recovery)

Migration and recovery are **one operation** in the spec (§3.4) — "this identity continues over there" — differing only in which key attests. There is no separate attestation or claim document.

If a family member moves from hub to self-hosted:
1. Establish the new identity (new `openfeed.json`) with `"predecessor": "https://mom.pence.family/"`
2. **Cooperative** (old domain still controlled): the old `openfeed.json` publishes a new chain version adding `"successor": "https://mom.example/"`. Consumers follow the cross-signed pair
3. **Recovery** (old domain lost): the new `openfeed.json` additionally carries `_recovery_sig`, a co-signature by the offline recovery key committed in a pinned ancestor (spec §4.5)
4. **Republish the back catalog byte-verbatim** at the new feed — same bytes, same signatures, same `_feed_url` naming the *old* feed — and commit those bytes in the new feed's manifest. Do **not** re-sign: rewriting every item would invalidate every hash any consumer or peer has pinned over the member's history. A consumer that has verified the migration treats an item whose `_feed_url` names a predecessor feed as canonical at the successor feed; because nothing is re-signed, the id/feed binding is never breached and needs no exception (spec §3.4, §7.5)
5. **Carry the catalog completely, and check it on the way in.** The successor's genesis manifest must account for every id live in the predecessor's last manifest — in `items` or in `deleted` (spec §9.3 invariant 5). A new manifest URL is a new chain and a fresh trust-on-first-observation, so without this a migration silently launders content deletion: no tombstone, no fork, nothing for a pinned consumer to notice. When *this hub* is the consumer — following a member who left for their own domain — enforce it, and surface a shortfall rather than re-pinning through it

Redirects are **not** identity equivalence — a cross-origin redirect is never followed for an identity document (spec §3.3). Portability across domain loss is the family-scale trade-off recovery keys + `pins` mitigate, not a full fix.

---

## Self-Hosting Guide

For family members who want to run their own instance.

### Minimum Requirements

To participate in the family network, a self-hosted site needs at least spec conformance **Level 2** (publish), and **Level 3** (interact) to *receive* comments. Conformance is now four levels — Level 0 (consume, non-verifying) through Level 3 (interact) (spec §12):

| Component | Purpose | Required? | Spec level |
|-----------|---------|-----------|------------|
| `openfeed.json` (signed, chained) | Identity: profile + keys + endpoints, at `{identity}openfeed.json` | Yes | 2 |
| `openfeed/{seq}.json` | Retained prior identity-document versions, derived path (spec §5.4) | Yes (once rotated) | 2 |
| Signed JSON Feed | Machine-readable, signed items (hub polls this) | Yes | 2 |
| `manifest.json` (signed, chained) + retained versions | Commitment to feed contents; proves presence, freshness, and exact bytes | Yes (for every listed feed) | 2 |
| Atom Feed | For plain feed readers (Level 0) | Recommended | 0 |
| Inbox sending | POST signed items to others' inboxes | Yes | 2 |
| Inbox receiving | Accept signed items from others | Recommended | 3 |
| Encrypted content (serve) | Share `family`-visibility feeds off-hub (extension, spec §11.3) | Required for cross-hub family | 3 |
| Export bundle | Let a member leave with everything (spec §14) | Required if you host anyone but yourself | — (custody, not a level) |
| Webmention bridge | Optional IndieWeb interop only (`_unverified`) | Optional | — |

(Sending interactions requires Level 2 — you need a published `openfeed.json` so anyone can verify you.)

### Identity Document (`openfeed.json`)

Your identity URL (e.g. `https://jessepence.com/`) MAY serve a human HTML page, but the **machine entry point is a signed JSON document at `https://jessepence.com/openfeed.json`** (spec §3.2). This replaces the old profile-HTML-plus-`<link rel="jwks">` discovery entirely — there is no separate JWKS file and no discovery links to parse.

```json
{
  "url": "https://jessepence.com/",
  "name": "Jesse",
  "bio": "Software developer, family member",
  "avatar": "https://jessepence.com/avatar.jpg",
  "feeds": [
    { "url": "https://jessepence.com/feed.json",
      "manifest": "https://jessepence.com/manifest.json",
      "rel": "primary" }
  ],
  "inbox": "https://jessepence.com/inbox",
  "seq": 1,
  "updated": 1736899200,
  "keys": [
    { "kid": "key-1", "kty": "OKP", "crv": "Ed25519", "x": "your-base64url-public-key", "iat": 1736899200 },
    { "kid": "recovery-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "recovery", "iat": 1736899200 }
  ],
  "_sig": "..."
}
```

Serve it (and every public document) with `Content-Type: application/json` and `Access-Control-Allow-Origin: *` (spec §3.3, §12). The genesis version is `seq: 1` (no `prev`); any later change bumps `seq`, sets `prev` (hash of the prior version), and is signed by a **continuity key** valid in the previous version (spec §5.2). The superseded version stays served, byte-identically, at the derived URL `https://jessepence.com/openfeed/1.json` (spec §5.4).

### Signing Your Content

Generate an Ed25519 keypair (plus an offline recovery key), and put the public keys in `openfeed.json`'s `keys` array (there is nowhere else — no standalone JWKS).

**Sign an item/manifest/identity doc** by:
1. Remove signature fields (`_sig`, `_recovery_sig`); build the JSON object
2. Canonicalize (RFC 8785: sorted keys, no whitespace; emit NFC; reject duplicate keys)
3. Build the header `{"alg":"EdDSA","b64":false,"crit":["b64"],"kid":"https://jessepence.com/#key-1"}` — note the `kid` is `{identity_url}#{kid}`, **not** a JWKS URL
4. Sign `ASCII(base64url(header) || '.') || canonical-bytes` with Ed25519
5. Set `_sig` = `base64url(header) || '..' || base64url(signature)`

Then advance and re-sign your **manifest** (spec §9) so the new item is committed.

Libraries: `jose` (Node.js), `@noble/ed25519` (pure JS), `canonicalize` (RFC 8785).

### Static Site Option

You can self-host with just static files — every Level 2 artifact is a file and signing happens at build time (spec §12):

- Generate `openfeed.json` (signed), `feed.json` (signed items), `manifest.json` (signed, chained), and their retained prior versions at build time
- Serve them with `Access-Control-Allow-Origin: *`
- Generate an Atom mirror for plain feed readers

No server required for Level 2. Receiving interactions (an inbox) needs a small dynamic endpoint (Level 3) — or use a hosted inbox relay. (The optional Webmention bridge, if you want it, can use webmention.io; but it is not part of the core.)

---

## Technical Notes

### Database Schema (Simplified)

```sql
-- Hub users
users (id, username, display_name, bio, avatar_url, role, created_at)

-- Public JWKs for every key (root, recovery, encryption — public halves only) plus the hub's
-- own delegated private key; drives openfeed.json `keys`
-- Never DELETE a row and never drop a key from openfeed.json: revocation ends authority,
-- delisting ends verifiability of everything it ever signed (spec §4.3)
keys (id, user_id, kid, use, public_jwk, private_key_encrypted, iat, revoked_at, created_at)

-- Identity-document chain versions (openfeed.json history)
-- canonical_bytes is the source of truth: served byte-identically at the derived URL
-- (spec §5.4) and exported byte-verbatim (spec §14). self_hash is this version's own
-- §5.1 hash — what the member compares out-of-band (onboarding 3b) and what the next
-- version's prev_hash must equal
identity_versions (id, user_id, seq, canonical_bytes, self_hash, prev_hash, updated_at)

-- External family members (self-hosted)
external_members (id, identity_url, feed_url, manifest_url, display_name, avatar_url, role,
                  identity_pin_seq, identity_pin_hash, manifest_pin_seq, manifest_pin_hash,
                  last_fetched, created_at)

-- Journal entries (hub users only; external entries are fetched, not stored permanently)
-- canonical_bytes = the exact signed bytes; ext_json preserves every unknown member, `_`-prefixed or not
-- (_ai_assisted, _pins, _enc, …) that have no column of their own
entries (id, author_id, title, content_html, content_text, visibility, attachments_json,
         ext_json, version, published_at, modified_at, canonical_bytes, item_hash, sig,
         deleted, created_at, updated_at)

-- Interaction items: comments (reply), reactions (like), etc. — one table, distinguished by _rel
interactions (id, author_id, author_url, author_name, author_avatar,
              rel_json, content_text, ext_json, date_published, feed_url, version,
              canonical_bytes, item_hash, sig, deleted, created_at, updated_at)
              -- rel_json holds the _rel array (type + to [+ _emoji …])
              -- feed_url NULL = delivered-only; the §11.1.1 republication gate reads this

-- Manifest chain versions (per feed)
manifest_versions (id, user_id, feed_url, seq, canonical_bytes, self_hash, prev_hash,
                   items_json, deleted_json, updated_at)

-- Auth
sessions (id, user_id, token, expires_at)

-- AI
ai_conversations (id, user_id, messages_json, date, created_at)
```

For interactions: either `author_id` (hub user) OR `author_url` (external) is set. Attribution is always the item's signed single-entry `authors`, not a self-asserted name.

**Store the bytes, not just the fields.** Every table above holding a signed artifact keeps a `canonical_bytes` column as its source of truth, with the parsed columns as a derived index. Decomposing a signed document into columns and re-serializing it later does not work here, for three reasons that each bite on their own. Spec §5.4 requires retained chain versions served **byte-identically**, and a JSON/JSONB column reorders keys. Spec §14 requires `received` items exported **byte-verbatim** — and those are other people's bytes, carrying extension fields this schema has never heard of, so they cannot be reconstructed at all once dropped. And spec §9.3 invariant 4 checks an item against its manifest entry by hashing its **full published bytes**, which is not something a row of columns can reproduce. Preserving unknown `_` fields is a signature dependency, not a nicety (spec §7.2) — the schema's own recommended `_ai_assisted` field is already an example of one with no column.

**External entries cache** (optional, for family feed performance):
```sql
external_entries_cache (id, member_id, item_id, url, title, content_text, content_html,
                        version, feed_url, published_at, modified_at, canonical_bytes, sig,
                        first_observed_at, fetched_at)
```

This is a cache, not source of truth. Re-fetch from their feed if stale — but keep `canonical_bytes` and `sig` even so, or the cached copy can be neither re-verified (spec §6.5) nor checked against its manifest entry (spec §9.3) without a refetch, which defeats the point of the cache. Record `first_observed_at` — the wall-clock time an item id was first seen committed in the member's manifest — and apply the revocation check against it (spec §4.4).

### File Output Structure

```
/public
  /mom.pence.family          # One document root per member subdomain
    /index.html              # Optional human profile page
    /.well-known/atproto-did # Optional Bluesky handle binding (one file per subdomain)
    /openfeed.json           # Identity document (signed, chained)
    /openfeed/1.json         # Retained prior versions, derived path (once seq > 1)
    /feed.json               # JSON Feed (signed items)
    /manifest.json           # Manifest (signed, chained)
    /manifest/1.json         # Retained prior manifest versions (once seq > 1)
    /activity.json           # Optional activity feed (published reposts; likes are delivered-only)
    /activity-manifest.json  # Its manifest (every listed feed is manifested)
    /activity-manifest/1.json
    /feed.xml                # Atom (optional)
    /avatar.jpg
    /2025/12/07
      /index.html            # Entry page
      /cookies.jpg           # Attachments
```

### Recommended Limits (aligned with spec §13.4)

| Resource | Limit |
|----------|-------|
| Identity document (`openfeed.json`) | 100 KB / 100 keys |
| Manifest | 1 MB (~10k live items at ~96 B per `[version, hash]` entry). Past ~10k live items, rotate to a new feed with `rel: "archive"` (spec §9.2) |
| Feed page | 10 MB / 1000 items |
| Inbox body | 100 KB |
| Chain versions walked per update | 1000 |
| Total history bytes fetched per chain update | Greater of 10 MB and 20× the current version's size, counted decoded (spec §13.4). This is the cap that actually binds a returning reader — see the skip-link note under "The manifest" |
| Concurrent fetches per origin | 10 |
| Entry content | 50 KB |
| Photo upload | 10 MB |
| Photos per entry | 10 |
| AI conversation history | 30 days |

Open Feed scales **across identities**, not in items-per-identity; the manifest is that boundary by construction (spec §13.4).

### Caching

| Resource | Cache |
|----------|-------|
| `openfeed.json` | ≤ 1 hour (spec Level 1) |
| Static HTML | Until updated |
| JSON Feed / manifest | Until updated |
| API responses | No cache (dynamic) |

---

## Security

Keep it simple for a family app, but honest about the trust model (spec §13).

### Trust model (be honest)

The hub holds a **delegated** key per member and nothing more (spec §4.6, see "Key custody"), which fixes exactly what it can be dishonest about. It **can** impersonate a member's *content* — sign an entry they never wrote — until the member revokes the delegation from their own device. It **cannot** touch identity state at all: not adding a key, not un-revoking one, not publishing a `successor`, because every one of those is a version of `openfeed.json` and the hub has never held a key that can sign one. And it cannot silently rewrite the *past* against a consumer who has pinned: both chains are retained and served, so removals surface as signed tombstones and per-consumer rewriting surfaces as a fork (same-`seq`/different-hash), detectable via pins.

The residual, stated where the operator will read it: this hub ships the client that generates and holds those keys, so every client-side guarantee is bounded by that client (spec §13.2, delegated-custodian tier). The check that survives is the out-of-band comparison at onboarding 3b — one relative comparing one hash — which is why that step is not a nicety.

**The case this hub has to take seriously**, because it is the one the protocol names as its own hostile-custodian adversary (spec §13.2): the operator of a family hub is a family member, and family members are sometimes the danger. That adversary reads everything the hub can read, sees the metadata no mechanism hides, is not deterred by transparency because they are entitled to look, and can decline to let someone leave. Nothing in the integrity machinery helps, and neither does encryption if the operator supplies the client and generated the keys.

What this hub can actually offer that person is **exit** — a recovery key it never held (onboarding 3a), an export bundle it must serve on demand (§Leaving), and a migration path that needs no cooperation from it. Build those three properly and do not market audience control or encryption to that user as protection from their own hub.

### Authentication
- Use secure session tokens (HTTP-only cookies)
- Rate-limit login attempts
- Support passkeys if possible (phishing-resistant)

### Authorization
- Check visibility on every entry/comment access
- Verify user owns resource before edit/delete
- Admin role required for user management

### Input Validation & Untrusted Content
- Item content from anyone but the local user is untrusted — **whether it arrives by inbox or by polling a feed** (spec §10.5). Render only escaped `content_text`, or aggressively sanitize `content_html` through an allowlist (`p`, `a`, `em`, `strong`, `blockquote`, `code`, `ul`, `ol`, `li`, `img`). Never render untrusted HTML as-is
- Content marked `_unverified` (bridged/Webmention) MUST be displayed distinctly and never cached as verified
- Validate file uploads (type, size); escape user content in templates
- Reject JSON with duplicate keys (I-JSON) everywhere you parse signed documents

### Fetching External URLs (SSRF, spec §13.5, §13.9)

For every outbound fetch (verifying inbox items, polling feeds, resolving `openfeed.json`):
- HTTPS only (reject HTTP)
- Timeout after 10 seconds; ≤5 redirects; never follow a cross-origin redirect for an identity document
- Limit response size (100 KB identity doc, 1 MB manifest, 10 MB feed page)
- Reject URLs resolving to private (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), loopback (127.0.0.0/8, ::1), or link-local addresses; validate DNS before connecting
- On the inbox path, run all local checks and rate-limit by source IP **before** the one signature-verification fetch (the `author` is attacker-controlled until then); fetch only the claimed author's fixed-path `openfeed.json`, never an arbitrary URL; negatively cache failures
- Reject non-JSON responses (avoid parsing HTML error pages as feeds); `application/json` is acceptable

### Signature discipline
- Never attribute unsigned content; display unverified content distinctly; never cache it as verified (spec §13.6)
- Constant-time signature/hash comparisons; NTP-synced clocks; never trust self-reported time as sole ordering (spec §13.7)
- Enforce revocation against receipt time (inbox) / first-observed time (poll), not self-reported timestamps (spec §4.4)

### Infrastructure
- HTTPS everywhere; validate certificates
- Secure headers (CSP, X-Frame-Options)
- Keep the signing boundary narrower than the serving boundary — a compromised CDN/web tier that can't sign gives pinned users full integrity (spec §13.2)
- Regular backups; don't log sensitive data (especially private keys)

---

## What We're NOT Building

To keep scope manageable:

- **End-to-end encryption for *everything*** - Encryption (spec §15) covers `family` content, which is what makes cross-hub `family` visibility work at all, and members hold their own keys. It does not cover `public` or `unlisted` entries, which are published in cleartext by definition, nor drafts and conversations the hub stores to run the app. The admin can read those; say so rather than implying otherwise. And no amount of encryption defends against the operator as *audience member* — they are inside the family.
- **Algorithmic feeds** - Chronological only. No engagement optimization.
- **Global-scale firehose/aggregator** - Open Feed scales across identities, not into a global index (spec §13.4). Public discovery is share-your-URL.
- **Real-time chat** - This is journaling, not messaging.
- **Stories/ephemeral content** - Everything persists (until tombstoned).

---

## Summary

1. **Hub-first, self-hosting supported** - Start with centralized, add federation in Phase 3
2. **Focus on AI experience** - That's the product differentiator
3. **On-protocol** - One signed `openfeed.json` for discovery; signed feed items; a signed, chained manifest committing contents; the signed inbox as the sole core interaction path (Webmention is only an optional bridge)
4. **Sign everything** - All content signed on write with one construction (spec §6); verify all inbound/off-hub content and pin both chains
5. **Generate static files** - `openfeed.json` + signed JSON Feed + manifest work everywhere; HTML/Atom are additive conveniences
6. **Ship and iterate** - A working, spec-conformant app beats a perfect spec

---

## Notes for Future Development

This section captures decisions and context that may be useful for future work.

### Interactions & Threading (`_rel`)

Interactions are items with a `_rel` array (spec §8); build the model around that from the start:

1. Store the `_rel` array (JSON) on the interaction row: each entry is `{type, to [, _emoji, …]}`
2. `type` is a registered token (`reply`, `like`, `repost`, `quote`, `mention`, `root`) or an absolute URL for custom relations; preserve unknown types
3. `to` is `{feed_url}#{item_id}` for items — the only permitted form for an Open Feed target (receivers split at the last `#`); an identity URL for `mention`; a bare URL only where the target is outside the protocol. Multiplicity is expressed with multiple entries, never an array in `to`
4. Threading: a `reply` entry points at the parent; add a `root` entry pointing at the thread root for nested replies (spec §8.1). Store as an adjacency list, build the tree client-side, render flat *or* nested, and cap walk depth (cycles possible in malicious data)
5. `like` items are delivered to the inbox and never published — no `_feed_url`, no feed row, no manifest entry (spec §8). A published content-less relation (`repost`) goes in the **activity feed**, not the primary feed

### Signing Hub Content (default)

Hub content is signed on write (spec §6, §6.6):

1. Generate a **delegated** keypair per hub user (spec §4.6) and store the private half encrypted at rest. The member's **root**, **recovery**, and **encryption** keys are generated on their own device and never reach the hub (spec §4.5, §12) — the hub stores only their public JWKs. **Never remove a public key from `openfeed.json`**, even long after rotation: revocation ends a key's authority, delisting ends verifiability of every item it ever signed, and verifiers resolve a `kid` against the *current* document (spec §4.3, §6.5)
2. Add `_sig` to each feed item on publish; include the single-entry `authors` binding and `_feed_url`
3. Advance and re-sign the **manifest** on every publish/edit/delete (spec §9)
4. Keys live in `openfeed.json`; `kid` = `{identity_url}#{kid}` (no separate JWKS)
5. Sign once on write and cache the signature (don't re-sign on read)
6. Key custody: **delegated by default** (spec §4.6, §12) — the member's device holds root, recovery, and encryption keys; the hub holds a delegated key that signs items and manifests but can never advance the identity chain. Day-to-day publishing stays invisible; identity-chain versions wake the member's client for an on-device root signature. See "Key custody"

### If You Need Real-Time Updates

Current design uses polling for external feeds. For real-time:

1. **WebSub** (JSON Feed `hubs`; README convention) - external member advertises a WebSub hub in their JSON Feed `hubs`; your hub subscribes and gets a POST when they publish. **Still verify item signatures** — the WebSub hub is untrusted
2. **Server-Sent Events** - for real-time updates to your own connected clients
3. **WebSocket** - bidirectional (overkill for journaling)

### If You Need ActivityPub Compatibility

Treat it as a **gateway** (spec Appendix C), not a transparent adapter:
1. A stateful actor proxy per user, polling the feed and fanning out `Create`/`Like`/`Announce`
2. HTTP Signatures (different from JWS — Mastodon's requirement)
3. Mirror inbound AP replies into the Open Feed inbox as `_unverified` items
4. Watch **FEP-8b32** (`eddsa-jcs-2022` = Ed25519 over RFC 8785) as a convergence seam

Consider using a bridge service (fed.brid.gy) instead of implementing directly.

### Nostr / atproto

- **Nostr**: the pinned identity chain is exactly the revocation substrate whose absence limited Nostr's NIP-26 delegation — which is why spec §4.6's delegation is safe here and NIP-26's was not. Also the simplest syndication target: publishing to relays needs no OAuth, no domain verification, no PDS, and a Nostr event can carry an `r` tag pointing at the entry permalink
- **atproto**: a full content bridge is the heaviest option (mirror PDS: DID + DAG-CBOR + MST). The practical identity seam is the **domain handle** — `mom.pence.family` resolves to the member's DID via DNS TXT or `/.well-known/atproto-did`, working with an ordinary bsky.social-hosted account (README, "Aliases": WebFinger and did:web are README conventions). `did:web` is atproto-valid only at hostname level (another reason for subdomain identities), and atproto signing keys are P-256/K-256 — the Ed25519 key never crosses

### Known Libraries

**The core needs no dependencies at all.** Node's built-in `crypto` does Ed25519 sign/verify and imports an OKP JWK directly, and the repo's own `src/` implements RFC 8785 plus the strict I-JSON parser in ~200 lines. Reach for the libraries below only where the table says so.

| Purpose | Library | Notes |
|---------|---------|-------|
| Ed25519 signing | *none* | `crypto.sign(null, input, key)` / `crypto.verify`; `createPublicKey({key: jwk, format:'jwk'})` imports an OKP key |
| JWS/JWK handling | *none* | The one construction is detached JWS with `b64:false` (spec §6.1); `jose` builds it, but assembling three base64url segments by hand is smaller than configuring it, and `jose` is needed for JWE if you implement spec §15 |
| JSON canonicalization | *none* | `canonicalize` (npm) implements RFC 8785, but it cannot reject duplicate member names — a spec §6.3 MUST — so a strict parser is required regardless, and it may as well canonicalize too |
| HTML sanitization | `sanitize-html` | Allowlist-based |
| Feed parsing | `feedparser` / `rss-parser` | For polling external feeds |
| Webmention (bridge only) | `send-webmention`, `microformats-parser` | Only if you build the optional IndieWeb bridge |

### Extension Fields (spec §3.2, §7.2)

If you need to add custom fields to JSON objects:

- Prefix with `_` (underscore): `_ai_assisted`, `_emoji`, etc.
- Preserve unknown **members** when re-serializing, `_`-prefixed or not (don't strip them) — **signatures depend on it** (spec §7.2). The prefix is a convention for avoiding collisions, not the test for what to keep; an extension field that skipped it, or a field a later JSON Feed revision adds, is inside the signed bytes just the same
- For relation *types*, use a registered token or a namespaced absolute URL (not a new field name), spec §8
- Document any new fields you add

### Optional Bridge Reference — Microformat Classes

These belong **only** to the optional Webmention/IndieWeb bridge (spec Appendix C), not the core. For h-entry parsing/generation:

| Class | Purpose |
|-------|---------|
| `h-entry` | Container for a post |
| `p-name` | Post title |
| `e-content` | Post content (HTML) |
| `dt-published` | Publication date |
| `u-url` | Permalink |
| `p-author` + `h-card` | Author info |
| `u-in-reply-to` | URL being replied to |
| `u-like-of` | URL being liked |
| `u-photo` | Avatar/photo URL |

Bridge-testing helpers: [webmention.io](https://webmention.io) (hosted endpoint), [webmention.rocks](https://webmention.rocks) (sender testing), [indiewebify.me](https://indiewebify.me) (h-entry validation). Again: bridged content is `_unverified` and lower-trust — never treat it as a native, verified identity.
