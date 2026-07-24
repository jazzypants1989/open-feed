# Distribution Model

A family journaling app with AI assistance, built as a conforming **Open Feed** implementation (see `open-feed-spec.md`). Start simple, add complexity only when needed — but stay on-protocol from day one, so hub users and self-hosted members interoperate through the same signed formats rather than a private API that diverges from the spec.

**Relationship to the spec:** This app is a Level 3 hub (spec §9.1.3). Every user's content is published as signed JSON Feed items (spec §5), interactions flow through the inbox (spec §7.1) with Webmention as a fallback (§7.2), `family`-visibility feeds use Authorized Fetch (§8.2), and keys follow the rotation/recovery/chain model (§3). Where this document previously described spec-divergent shortcuts, it has been brought into line; the app's own additions (AI companion, drafting flow) are layered on top and never replace the wire formats.

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
3. **Sign everything** - All published content is signed (spec §4), so any consumer — hub, self-hosted member, or third-party reader — can verify it the same way. Portability and cross-hub trust fall out for free.
4. **AI handles complexity** - Users talk to the companion; technical details are invisible.

### Design Rationale (For Implementers)

Earlier drafts of this doc took spec-divergent shortcuts to save effort. Following the spec instead costs a little more up front but removes a class of "works on the hub, breaks across hubs" bugs. The table below records how each earlier shortcut was reconciled:

| Earlier shortcut | Now (spec-aligned) | Why |
|------------------|--------------------|-----|
| No signatures on hub content | **Sign all feed items** (spec §5.2, §4.6) | Signing on write is cheap (sign once, cache). It makes hub content portable and verifiable off-hub, and is required for a conforming feed. Hub-managed keys keep it invisible to users (spec §7.5.3, §10.2). |
| Webmention instead of custom inbox | **Inbox is primary** (spec §7.1); Webmention is the fallback (§7.2) | The signed inbox gives verified authorship and structured interactions. Webmention remains for IndieWeb interop, but arrives as lower-trust and is marked as such. |
| Flat comments only | **Nested threading** via `_in_reply_to` (spec §6.6) | Store `parentId`; render flat *or* nested. Data cost is one nullable column; the spec's threading is already defined. |
| No key rotation/revocation | **Support rotation + revocation** (spec §3.4–3.5) and the **Key History Chain** (§3.7) | Required for a real trust story and cheap to serve. The chain makes revocation tamper-evident. |
| No recovery keys | **Support recovery keys** (spec §3.6) | Generated once at account creation, stored offline. Enables succession if the domain is lost. |
| Internal API as source of truth | **Internal API over spec storage** | Hub users hit a fast REST API, but every write produces the same signed JSON Feed item / inbox interaction a self-hoster would produce. The API is a cache/convenience, not a fork of the model. |

**Standards used** (mirrors spec Appendix C):
- [JSON Feed 1.1](https://jsonfeed.org/version/1.1) - Feed format
- [JWKS (RFC 7517)](https://tools.ietf.org/html/rfc7517) - Public key format
- [JWS (RFC 7515)](https://tools.ietf.org/html/rfc7515) + [RFC 7797](https://www.rfc-editor.org/rfc/rfc7797) - Signatures (detached, unencoded payload)
- [JWT (RFC 7519)](https://tools.ietf.org/html/rfc7519) - Authorized Fetch assertions (spec §8.2)
- [RFC 8785](https://tools.ietf.org/html/rfc8785) - JSON Canonicalization Scheme (for signing)
- [Ed25519 (RFC 8032)](https://www.rfc-editor.org/rfc/rfc8032) - Signature algorithm
- [Webmention](https://www.w3.org/TR/webmention/) + [Microformats2](https://microformats.org/wiki/microformats2) - Fallback cross-site interactions / machine-readable HTML

### Deployment Models

| Model | Description | When to use |
|-------|-------------|-------------|
| **Centralized** | Everyone on `pence.family` | Default. Simplest. |
| **Hybrid** | Most on hub, some self-host | Tech-savvy family members |
| **Distributed** | Everyone self-hosts | Maximum independence |

The app should handle all three transparently. A comment from `pence.family/~dad/` and `jessepence.com/journal/` should look the same to `pence.family/~mom/`.

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
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │  Static  │  │   JSON   │  │   RSS    │
        │   HTML   │  │   Feed   │  │   Feed   │
        └──────────┘  └──────────┘  └──────────┘
```

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

Their public profile is at `https://pence.family/~mom/`.

**Identity URL normalization:**

When comparing or storing identity URLs (for external members or author attribution):
- Normalize domain to lowercase (`Alice.Example` → `alice.example`)
- Remove default ports (`:443` for HTTPS)
- Strip query parameters and fragments
- Ensure trailing slash on path

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
  id: string;                    // UUID
  authorId: string;              // User ID (for hub users)
  authorUrl?: string;            // Identity URL (for external/self-hosted)
  title?: string;
  contentHtml: string;           // Rendered HTML
  contentText: string;           // Plain text (for feeds, search)
  visibility: 'public' | 'family' | 'private' | 'unlisted';
  attachments?: Attachment[];    // Photos, files
  publishedAt?: Date;            // null = draft
  createdAt: Date;
  updatedAt: Date;
}

interface Attachment {
  url: string;                   // URL to the file
  mimeType: string;              // e.g., "image/jpeg"
  alt?: string;                  // Alt text for images
  width?: number;
  height?: number;
}
```

| Visibility | Who can see it |
|------------|----------------|
| `public` | Anyone |
| `family` | Logged-in family members |
| `private` | Only the author |
| `unlisted` | Anyone with the link (not in feeds) |

### Comments

A comment on an entry:

```typescript
interface Comment {
  id: string;                    // UUID
  entryId: string;               // Entry being commented on

  // For hub users:
  authorId?: string;             // User ID (internal)

  // For external/self-hosted authors:
  authorUrl?: string;            // Identity URL
  authorName?: string;           // Display name (cached)
  authorAvatar?: string;         // Avatar URL (cached)
  sourceUrl?: string;            // URL of their comment page

  contentHtml: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Either `authorId` (hub user) or `authorUrl` (external) will be set, not both.

### Reactions

A lightweight interaction:

```typescript
interface Reaction {
  id: string;
  entryId: string;

  // For hub users:
  authorId?: string;

  // For external/self-hosted authors:
  authorUrl?: string;
  authorName?: string;
  sourceUrl?: string;            // URL of their like page

  emoji: string;                 // Single emoji: "❤️", "😂", etc.
  createdAt: Date;
}
```

---

## API

Simple REST. All endpoints except public reads require authentication.

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
PATCH  /api/entries/:id          # Update entry
DELETE /api/entries/:id          # Delete entry

POST   /api/entries/:id/publish  # Publish a draft
```

### Comments

```
GET    /api/entries/:id/comments     # List comments on entry
POST   /api/entries/:id/comments     # Add comment
PATCH  /api/comments/:id             # Edit comment (author only)
DELETE /api/comments/:id             # Delete comment (author or entry owner)
```

### Reactions

```
GET    /api/entries/:id/reactions    # List reactions
POST   /api/entries/:id/reactions    # Add reaction (body: {"emoji": "❤️"})
DELETE /api/reactions/:id            # Remove reaction (author only)
```

### Users

```
GET    /api/users                    # List family members
GET    /api/users/:id                # Get user profile
PATCH  /api/users/:id                # Update profile (self or admin)
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

---

## Cross-Site Interactions (Self-Hosted Members)

When family members self-host, they can't use `POST /api/comments`. The **primary** path is the Open Feed **inbox** (spec §7.1): the self-hoster signs an interaction object and POSTs it to `pence.family/~mom/inbox`; the hub verifies the signature and author binding (spec §4.5–4.6) and stores it as a verified comment. **Webmention** (spec §7.2) is offered as a fallback for IndieWeb tools that don't speak the inbox — those arrive lower-trust (see below).

### How It Works (Inbox — primary)

```
Jesse (self-hosted) comments on Mom's post:

1. Jesse's client builds a signed `reply` interaction (spec §6.1):
   { type:"reply", target:"https://pence.family/~mom/feed.json",
     target_item:"urn:uuid:...", author:"https://jessepence.com/",
     content:"...", published:"...", _sig:"..." }

2. POST it to Mom's inbox:  POST https://pence.family/~mom/inbox

3. Mom's hub verifies (spec §7.1.3): local checks -> confirm the kid's
   JWKS belongs to jessepence.com's profile -> fetch JWKS -> verify sig
   -> replay checks -> store as a verified comment.
```

Interaction `content` is plain text (spec §6.1). The hub derives `contentHtml` itself (escape, then optional autolinking) — never store or render externally-supplied HTML.

### How It Works (Webmention — fallback)

```
Jesse (self-hosted at jessepence.com) wants to comment on Mom's post (pence.family/~mom/)

1. Jesse publishes comment on his own site:
   jessepence.com/replies/2025-12-07-cookies.html
   (contains link to Mom's post with class="u-in-reply-to")

2. Jesse's server sends Webmention:
   POST pence.family/webmention
   source=jessepence.com/replies/2025-12-07-cookies.html
   target=pence.family/~mom/2025/12/07/

3. Mom's hub:
   - Fetches Jesse's page
   - Parses the h-entry (finds author, content, timestamp)
   - Verifies the claimed author URL is a path prefix of the source URL
     (the h-card is self-asserted — without this check any page could
     claim to be Jesse; same-origin alone is not enough on a shared
     host, where ~dad's pages could claim to be ~mom; spec §7.2.2)
   - Verifies Jesse is in the family list
   - Optionally verifies signature
   - Stores the comment
```

### Webmention Endpoint

```
POST /webmention
Content-Type: application/x-www-form-urlencoded

source={url-of-comment}&target={url-of-entry}
```

**Response codes:**
- `202 Accepted` - Queued for processing
- `400 Bad Request` - Invalid source or target
- `200 OK` - Processed immediately

### Comment Format (h-entry)

Self-hosted comments must be valid h-entry:

```html
<article class="h-entry">
  <a class="p-author h-card" href="https://jessepence.com/">
    <img class="u-photo" src="https://jessepence.com/avatar.jpg" alt="">
    <span class="p-name">Jesse</span>
  </a>
  <a class="u-in-reply-to" href="https://pence.family/~mom/2025/12/07/">
    In reply to Mom's post
  </a>
  <div class="e-content">
    <p>Those cookies were amazing!</p>
  </div>
  <time class="dt-published" datetime="2025-12-07T16:00:00-05:00">
    December 7, 2025 at 4:00 PM
  </time>
  <a class="u-url" href="https://jessepence.com/replies/2025-12-07-cookies.html">
    Permalink
  </a>
</article>
```

### Family Membership for Self-Hosted

The hub maintains a family list that includes external identity URLs:

```json
{
  "family": [
    {"identity": "https://pence.family/~mom/", "role": "admin"},
    {"identity": "https://pence.family/~dad/", "role": "member"},
    {"identity": "https://jessepence.com/", "role": "member"}
  ]
}
```

When a Webmention arrives:
1. Parse the source to find the author's identity URL
2. Verify the claimed identity URL (normalized, with trailing slash) is a **string prefix of the source URL** — the h-card author is self-asserted by the source page, so an unrelated page's claim proves nothing (spec §7.2.2). Same-origin alone is insufficient on shared hosts with path-based identities (any `pence.family` page would pass for any `pence.family/~*/` member). Claims failing the prefix check go to moderation as unauthenticated; never auto-accept them as that identity.
3. Check if that URL is in the family list
4. If not, reject (or queue for moderation)

### Signatures (Required on all published content)

All published feed items and inbox interactions are signed (spec §4, §5.2). Signatures prove content came from the claimed identity and let any consumer verify it off-hub. On the hub, signing is done at write time with hub-managed keys (invisible to users); self-hosters sign with their own keys. The JWS uses the detached, unencoded-payload construction of spec §4.1 (RFC 7797), and items carry the author binding of spec §4.6.

**JWKS document** at `/.well-known/jwks.json` or linked via `<link rel="jwks">`:

```json
{
  "keys": [{
    "kid": "2025-key",
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
  }]
}
```

**Signed content** includes `_sig` field with JWS (detached, unencoded payload — RFC 7797; header carries `b64:false,crit:["b64"]`, spec §4.2). Interactions bind the signer via `author`; feed items bind via `authors` (spec §4.6):

```json
{
  "type": "reply",
  "id": "urn:uuid:...",
  "target": "https://pence.family/~mom/feed.json",
  "target_item": "urn:uuid:...",
  "author": "https://jessepence.com/",
  "content": "Those cookies were amazing!",
  "published": "2025-12-07T16:00:00-05:00",
  "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vamVzc2VwZW5jZS5jb20vLndlbGwta25vd24vandrcy5qc29uIzIwMjUta2V5In0..base64sig"
}
```

**Verification process** (spec §4.5):

1. Determine the claimed author (`author` for interactions; an `authors[].url` for feed items)
2. Extract and remove `_sig`; canonicalize the remaining JSON (below)
3. Parse the JWS header; confirm `alg=EdDSA`, `b64=false`, `crit=["b64"]`; get `kid`
4. Confirm the `kid`'s JWKS URL is advertised by the **claimed author's** profile (don't trust an arbitrary key just because it verifies)
5. Fetch that JWKS, find the key (`kid` format `{jwks_url}#{key_id}`), check revocation vs effective signing time
6. Reconstruct the signing input (`base64url(header)` + `.` + canonical bytes) and verify the Ed25519 signature

**JSON Canonicalization (RFC 8785):**

Before signing or verifying, JSON must be canonicalized:
1. Serialize with no whitespace between tokens
2. Sort object keys lexicographically (recursively for nested objects)
3. Numbers: no unnecessary leading zeros or trailing zeros after decimal

Strings are signed byte-exact as published — no verify-time Unicode normalization (spec §4.3). Emit NFC when authoring content, and reject JSON with duplicate object keys.

Example:
```json
// Input (with whitespace)
{ "b": 1, "a": 2 }

// Canonical output
{"a":2,"b":1}
```

Libraries that handle this: `canonicalize` (npm) implements RFC 8785 directly.

**When to verify:**
- Always verify signatures on inbound content (self-hosted members, and any content fetched from another hub)
- Hub-hosted content is also signed at write time (spec-conformant feeds require it); the hub can trust its own DB for internal reads, but the signature is what makes that content portable and verifiable by everyone else

**Transient failures:**

If JWKS fetch fails temporarily (network error, server down):
1. Cache the failure and retry later
2. Retry schedule: 1 hour, 4 hours, 24 hours
3. After 3 failed attempts, reject the content
4. Don't permanently reject on first transient failure

### Reactions via Webmention

Self-hosted members can send likes/reactions too:

```html
<span class="h-entry">
  <a class="p-author h-card" href="https://jessepence.com/">Jesse</a>
  <a class="u-like-of" href="https://pence.family/~mom/2025/12/07/">liked this</a>
</span>
```

Send Webmention with this as source. Hub parses `u-like-of` and creates a reaction.

For emoji reactions, include the emoji:
```html
<span class="h-entry">
  <a class="u-like-of" href="https://pence.family/~mom/2025/12/07/">
    <span class="p-content">😂</span>
  </a>
</span>
```

### Sending Webmentions

When a hub user's entry links to an external URL, send a Webmention:

1. Parse entry content for external links
2. For each link, discover their Webmention endpoint
3. Send `POST` with source (your entry) and target (their URL)

This notifies external sites when they're mentioned.

### Aggregating Self-Hosted Entries

When a family member self-hosts, their journal entries should appear in the family feed. Two approaches:

**Option A: Poll their feed (simple)**
- Hub periodically fetches each external member's JSON Feed
- Parse entries, verify signatures, add to family feed
- Poll frequency: every 15-30 minutes

**Option B: WebSub (real-time)**
- External member's feed advertises a WebSub hub
- Hub subscribes to their feed
- Gets notified immediately when they publish

Start with polling. Add WebSub later if latency matters.

**Key custody caveat:** the hub pulls a self-hoster's `family`-visibility feed by signing fetch assertions *as the reading member* (e.g., as Mom) — possible only because the hub holds Mom's key. A member who opts into client-side keys can't be proxied this way; their own client must fetch restricted external feeds directly (or they accept that restricted external content won't appear in their hub-rendered family feed).

```typescript
interface ExternalMember {
  identityUrl: string;           // https://jessepence.com/
  feedUrl: string;               // https://jessepence.com/feed.json
  role: 'member' | 'viewer';
  lastFetched?: Date;
  lastEntryId?: string;          // To detect new entries
}
```

---

## Published Output

When an entry is published, generate static files:

### HTML Page

```
/~mom/2025/12/07/index.html
```

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Made cookies with the grandkids - Mom's Journal</title>
  <link rel="canonical" href="https://pence.family/~mom/2025/12/07/">
  <link rel="alternate" type="application/feed+json" href="https://pence.family/~mom/feed.json" title="JSON Feed">
  <link rel="alternate" type="application/atom+xml" href="https://pence.family/~mom/feed.xml" title="Atom Feed">
  <link rel="author" href="https://pence.family/~mom/">
  <link rel="webmention" href="https://pence.family/webmention">
</head>
<body>
  <article class="h-entry">
    <h1 class="p-name">Made cookies with the grandkids</h1>
    <p class="p-author h-card">
      <a class="u-url p-name" href="https://pence.family/~mom/">Mom</a>
    </p>
    <time class="dt-published" datetime="2025-12-07T14:30:00-05:00">
      December 7, 2025
    </time>

    <div class="e-content">
      <p>The grandkids came over today and we made chocolate chip cookies...</p>
      <img src="cookies.jpg" alt="Fresh cookies on a cooling rack">
    </div>
  </article>

  <section id="comments">
    <!-- Server-rendered or client-fetched -->
  </section>
</body>
</html>
```

The `h-entry` microformat makes the page machine-readable for IndieWeb tools and future federation.

### JSON Feed

```
/~mom/feed.json
```

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Mom's Journal",
  "home_page_url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "authors": [{"name": "Mom", "url": "https://pence.family/~mom/"}],
  "items": [
    {
      "id": "https://pence.family/~mom/2025/12/07/",
      "url": "https://pence.family/~mom/2025/12/07/",
      "title": "Made cookies with the grandkids",
      "content_text": "The grandkids came over today...",
      "content_html": "<p>The grandkids came over today...</p>",
      "date_published": "2025-12-07T14:30:00-05:00"
    }
  ]
}
```

### Atom Feed

```
/~mom/feed.xml
```

Atom (not RSS 2.0) for maximum compatibility and better date handling:

```xml
<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Mom's Journal</title>
  <link href="https://pence.family/~mom/"/>
  <link rel="self" href="https://pence.family/~mom/feed.xml"/>
  <id>https://pence.family/~mom/</id>
  <updated>2025-12-07T14:30:00-05:00</updated>
  <author>
    <name>Mom</name>
    <uri>https://pence.family/~mom/</uri>
  </author>
  <entry>
    <title>Made cookies with the grandkids</title>
    <link href="https://pence.family/~mom/2025/12/07/"/>
    <id>https://pence.family/~mom/2025/12/07/</id>
    <published>2025-12-07T14:30:00-05:00</published>
    <updated>2025-12-07T14:30:00-05:00</updated>
    <content type="html">&lt;p&gt;The grandkids came over today...&lt;/p&gt;</content>
  </entry>
</feed>
```

Generate both JSON Feed and Atom. They're trivially derived from the same data.

### What Gets Published

| Visibility | HTML | JSON Feed | Atom |
|------------|------|-----------|------|
| `public` | Yes | Yes (public feed) | Yes |
| `family` | Yes (behind auth) | Yes, as a **restricted feed** via Authorized Fetch (spec §8.2) | No |
| `private` | No | No | No |
| `unlisted` | Yes | No | No |

The `family` feed is a real signed JSON Feed, but served only to authorized readers: an unauthenticated GET returns `401 … WWW-Authenticate: OpenFeed-Sig`, and a self-hosted family member's client retries with a signed fetch assertion (spec §8.2). This is what lets Jesse's off-hub reader pull Mom's family-only entries into his feed. It is audience control, not encryption — the hub can still read the content.

### Visibility Changes & Unpublishing

Visibility is not write-once. When an entry's visibility changes (or it is deleted), previously published artifacts must be actively retracted:

| Transition | Actions |
|------------|---------|
| any → `private` / deleted | Delete static HTML; remove the item from feeds and publish a signed tombstone (`_deleted: true`, spec §5.4.1); ping WebSub if enabled |
| `public` → `family` | Remove from public feed/Atom and tombstone there; serve HTML behind auth; item moves to the restricted feed |
| `family` → `public` | Add to public feed; regenerate HTML without auth |

Anything already syndicated (RSS readers, email digests) is best-effort — the tombstone tells conforming consumers to drop cached content, but an email can't be recalled. Warn users of this when they downgrade visibility.

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
| Comments on user's entries | Auth tokens, passwords |

AI conversations are stored per-user and never shared with other users or their AI companions.

**Cross-user consent:** "Family posts user can see" means *other members'* content — including their `family`-visibility entries — enters this user's AI context and is sent to the AI provider, which those authors never explicitly agreed to. Handle this explicitly:

- Disclose during onboarding that family-visible posts may be processed by the AI provider on behalf of other members
- Provide a per-user opt-out (`ai_exclude` flag): excluded members' entries and comments never enter anyone else's AI context
- Never include another member's `private` entries or drafts (already the rule above)

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
            User approves → Entry published
```

### Entry Generation

The AI should:

1. **Summarize, don't transcribe** - Extract key moments
2. **Preserve voice** - Sound like the user, not the AI
3. **Respect "off the record"** - User can say "don't include this"
4. **Structure naturally** - Paragraphs, maybe a photo, maybe a quote

**Disclosure**: Entries should include `_ai_assisted: true` in metadata. Display is user preference (subtle footer, or nothing visible).

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
3. Invitee is added with `member` role

### Removing a Member

1. Admin removes user
2. Their past entries/comments remain visible (historical record)
3. They can no longer log in or post

---

## Implementation Order

### Phase 1: Core App (Hub Users) — on-protocol from the start

- [ ] User auth (magic links or passkeys)
- [ ] Per-user keypair generation + JWKS endpoint (`/{user}/keys.json`); hub-managed keys encrypted at rest
- [ ] Entry CRUD
- [ ] Canonicalization + **signing on publish** (spec §4; sign once, cache)
- [ ] Static HTML generation on publish
- [ ] Signed JSON Feed generation (item-level `authors` binding, `_feed_url`)
- [ ] Atom feed generation
- [ ] Comments as signed `reply` interactions (internal API produces the same signed object as the inbox path)
- [ ] Basic family feed

**Test**: Can Mom post a signed entry, Dad comment on it, Grandma subscribe in a reader, and an independent verifier confirm every signature?

### Phase 2: AI Integration

- [ ] Conversation UI
- [ ] AI context assembly
- [ ] Entry drafting from conversation
- [ ] Visibility suggestions

**Test**: Can Mom talk to the AI and publish a journal entry?

### Phase 3: Federation (Self-Hosted Members)

- [ ] **Inbox endpoint (receive)** — verify signatures + author binding (spec §7.1.3), replay prevention, fetch-amplification guard (§10.11)
- [ ] Inbox sending (outbound signed interactions)
- [ ] Authorized Fetch for `family`-visibility feeds (spec §8.2) — serve `401`/verify assertions
- [ ] Webmention endpoint (receive/send) as fallback + microformat parsing (h-entry, h-card)
- [ ] External family member management + allowlist
- [ ] Feed polling for external members (verify signatures)
- [ ] Thread backfill during polling: reconcile external feed items whose `_reply_to` targets hub entries, healing replies whose inbox delivery was missed (the signed feed is the source of truth; the inbox is a latency optimization)
- [ ] External entries in family feed
- [ ] Key History Chain publication (spec §3.7)

**Test**: Can Jesse (self-hosted) post a signed `reply` to Mom's inbox, pull her family-only feed via Authorized Fetch, and have his entries appear verified in the family feed?

### Phase 4: Polish

- [ ] Reactions as signed `like` / `x-emoji-react` interactions (inbox + Webmention fallback)
- [ ] Key rotation + revocation UI (spec §3.4–3.5); recovery-key generation at onboarding (§3.6)
- [ ] Notifications (in-app)
- [ ] Photo uploads with thumbnails (+ `_sha256` attachment integrity)
- [ ] Profile customization
- [ ] Search (entries, comments)
- [ ] Signing tools for self-hosters

**Test**: Does it feel good to use daily?

### Phase 5: Distribution (Optional)

- [ ] Email digests for family
- [ ] WebSub for real-time feed updates
- [ ] Mastodon cross-posting

**Test**: Can Grandma get a daily email with the family's posts?

---

## Future: Broader Federation

Self-hosted family members are covered in Phase 3. This section is for interoperating with the wider internet.

### ActivityPub (Mastodon/Fediverse)

To let Mastodon users follow family journals:
- Actor document per user (`/~mom/actor.json`)
- Inbox/Outbox endpoints
- HTTP Signatures (different from JWS—Mastodon's requirement)
- Activity vocabulary (Create, Note, Like, Announce)

Consider using a bridge service (like fed.brid.gy) instead of implementing directly.

### Public Discovery

Currently, you share your URL directly. For public discovery:
- WebFinger support (`/.well-known/webfinger`)
- Hub directory page
- Search engine optimization

### Identity Portability

If a family member wants to move from hub to self-hosted:
1. Set up new site with same content structure
2. Add `<link rel="canonical" href="new-url">` to old profile
3. Hub should 301 redirect old URLs to new
4. Update family list to new identity URL

Past comments attributed to old URL remain (no automatic migration needed—URLs still work via redirect).

---

## Self-Hosting Guide

For family members who want to run their own instance.

### Minimum Requirements

To participate in the family network, a self-hosted site needs:

This maps to spec conformance **Level 2** (publish) at minimum, **Level 3** (interact) to receive comments:

| Component | Purpose | Required? | Spec level |
|-----------|---------|-----------|------------|
| Profile page | Identity URL that returns HTML with discovery links | Yes | 1/2 |
| JWKS | Public key(s) for signature verification | Yes | 2 |
| Signed JSON Feed | Machine-readable, signed entries (hub polls this) | Yes | 2 |
| Atom Feed | For plain feed readers | Recommended | — |
| Inbox sending | Post signed interactions to others' inboxes | Yes | 2 |
| Inbox receiving | Accept signed interactions from others | Recommended | 3 |
| Authorized Fetch (serve) | Share `family`-visibility feeds off-hub | Optional | 3 |
| Webmention (send/receive) | Fallback interaction path for IndieWeb tools | Optional | 3 |

### Profile Page

Your identity URL (e.g., `https://jessepence.com/`) must return HTML with discovery links:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Jesse's Journal</title>
  <link rel="alternate" type="application/feed+json" href="/feed.json" title="JSON Feed">
  <link rel="alternate" type="application/atom+xml" href="/feed.xml" title="Atom Feed">
  <link rel="jwks" href="/.well-known/jwks.json" type="application/jwk-set+json">
  <link rel="webmention" href="/webmention">
</head>
<body>
  <div class="h-card">
    <img class="u-photo" src="/avatar.jpg" alt="">
    <a class="p-name u-url" href="https://jessepence.com/">Jesse</a>
    <p class="p-note">Software developer, family member</p>
  </div>
</body>
</html>
```

### Signing Your Content

Generate an Ed25519 keypair and publish the public key:

**JWKS** at `/.well-known/jwks.json`:
```json
{
  "keys": [{
    "kid": "2025",
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "your-base64url-public-key"
  }]
}
```

**Sign entries** by:
1. Create JSON object without `_sig`
2. Canonicalize (RFC 8785: sorted keys, no whitespace; emit NFC strings when authoring)
3. Sign canonical bytes with Ed25519
4. Add `_sig` with JWS: `base64url({"alg":"EdDSA","kid":"https://yoursite/.well-known/jwks.json#2025"})..base64url(signature)`

Libraries: `jose` (Node.js), `@noble/ed25519` (pure JS)

### Sending Webmentions

When you publish a post or comment that links to a family member:

1. Parse your content for links
2. For each link, fetch the target page
3. Find their Webmention endpoint (`<link rel="webmention">`)
4. POST to endpoint: `source=your-post-url&target=their-url`

Libraries: `send-webmention` (Node.js)

### Static Site Option

You can self-host with just static files + a Webmention service:

- Use webmention.io to receive Webmentions
- Use a build script to send Webmentions on deploy
- Generate JSON Feed from your posts
- Sign content at build time

No server required.

---

## Technical Notes

### Database Schema (Simplified)

```sql
-- Hub users
users (id, username, display_name, bio, avatar_url, role, created_at)

-- External family members (self-hosted)
external_members (id, identity_url, feed_url, display_name, avatar_url, role, last_fetched, created_at)

-- Journal entries (hub users only; external entries are fetched, not stored permanently)
entries (id, author_id, title, content_html, content_text, visibility, attachments_json, published_at, created_at, updated_at)

-- Comments (both internal and external)
comments (id, entry_id, author_id, author_url, author_name, author_avatar, source_url, content_html, created_at, updated_at)

-- Reactions (both internal and external)
reactions (id, entry_id, author_id, author_url, author_name, source_url, emoji, created_at)

-- Auth
sessions (id, user_id, token, expires_at)

-- AI
ai_conversations (id, user_id, messages_json, date, created_at)
```

For comments/reactions: either `author_id` (hub user) OR `author_url` (external) is set.

**External entries cache** (optional, for family feed performance):
```sql
external_entries_cache (id, member_id, entry_url, title, content_text, content_html, published_at, fetched_at)
```

This is a cache, not source of truth. Re-fetch from their feed if stale.

### File Output Structure

```
/public
  /~mom
    /index.html              # Profile page
    /feed.json               # JSON Feed
    /feed.xml                # Atom (optional)
    /avatar.jpg
    /2025
      /12
        /07
          /index.html        # Entry page
          /cookies.jpg       # Attachments
```

### Recommended Limits

| Resource | Limit |
|----------|-------|
| Entry content | 50KB |
| Photo upload | 10MB |
| Photos per entry | 10 |
| Comments per entry | 500 |
| AI conversation history | 30 days |

### Caching

| Resource | Cache |
|----------|-------|
| Static HTML | Until updated |
| JSON Feed | Until updated |
| User profiles | 1 hour |
| API responses | No cache (dynamic) |

---

## Security

Keep it simple for a family app:

### Authentication
- Use secure session tokens (HTTP-only cookies)
- Implement rate limiting on login attempts
- Support passkeys if possible (phishing-resistant)

### Authorization
- Check visibility on every entry/comment access
- Verify user owns resource before edit/delete
- Admin role required for user management

### Input Validation
- Sanitize HTML content (allowlist safe tags: `p`, `a`, `em`, `strong`, `blockquote`, `code`, `ul`, `ol`, `li`, `img`)
- Validate file uploads (type, size)
- Escape user content in templates

### Fetching External URLs

When verifying Webmentions or polling external feeds:

**Basic protections:**
- HTTPS only (reject HTTP URLs)
- Timeout after 10 seconds
- Limit response size (1MB for pages, 10MB for feeds)
- Limit redirects (max 5)
- Sanitize external HTML more aggressively than internal content

**Content-Type validation (important):**
- When fetching JSON Feeds, send `Accept: application/feed+json` header
- When fetching JWKS, send `Accept: application/jwk-set+json` header
- Reject responses that don't return the correct Content-Type
- You may accept `application/json` as a fallback, but log a warning

This strictness prevents security issues from accidentally parsing HTML error pages as JSON. A misconfigured server returning `<html>404 Not Found</html>` should not be parsed as a feed.

**SSRF protection:**
- Reject URLs resolving to private IP addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Reject URLs resolving to loopback addresses (127.0.0.0/8, ::1)
- Validate DNS responses before connecting

### Infrastructure
- HTTPS everywhere
- Secure headers (CSP, X-Frame-Options)
- Regular backups
- Don't log sensitive data

---

## What We're NOT Building

To keep scope manageable:

- **End-to-end encryption** - Hub admin can read everything. That's fine for family.
- **Algorithmic feeds** - Chronological only. No engagement optimization.
- **Public discovery** - Share your URL directly. No global search.
- **Real-time chat** - This is journaling, not messaging.
- **Stories/ephemeral content** - Everything persists.

---

## Summary

1. **Hub-first, self-hosting supported** - Start with centralized, add federation in Phase 3
2. **Focus on AI experience** - That's the product differentiator
3. **On-protocol** - Signed inbox interactions (primary) + Webmention (fallback); the internal API is a convenience over spec-conformant storage
4. **Sign everything** - All content signed on write; verify all inbound/off-hub content
5. **Generate static files** - HTML + signed JSON Feed works everywhere
6. **Ship and iterate** - A working, spec-conformant app beats a perfect spec

---

## Notes for Future Development

This section captures decisions and context that may be useful for future work.

### Nested Threading (default)

Threading follows spec §6.6, so build it in from the start:

1. `parentId` on Comment (nullable) maps to the interaction's `_in_reply_to`
2. Store as adjacency list; build the tree client-side
3. Render flat *or* nested (clients may collapse deep threads)
4. `target_item` is always the root post; `_in_reply_to` is the parent interaction

### Signing Hub Content (default)

Hub content is signed on write (spec §5.2, §4.6):

1. Generate a keypair per hub user; store the private key encrypted at rest
2. Add `_sig` to each feed item on publish; include item-level `authors` (author binding) and `_feed_url`
3. Expose `/{user}/keys.json` (JWKS), ideally with a Key History Chain (spec §3.7)
4. Sign once on write and cache the signature (don't re-sign on read)
5. Key custody: hub-managed is the default (invisible to users, hub can impersonate — documented trust model, spec §10.2); offer client-side keys for members who want them

### If You Need Real-Time Updates

Current design uses polling for external feeds. For real-time:

1. **WebSub** - W3C standard for real-time feed updates
   - External member advertises WebSub hub in their feed
   - Your hub subscribes to their feed via the WebSub hub
   - Gets POST notification when they publish
2. **Server-Sent Events** - For real-time updates to connected clients
3. **WebSocket** - For bidirectional real-time (overkill for journaling)

### If You Need ActivityPub Compatibility

For Mastodon/Fediverse interop, you'd need:

1. Actor documents per user (`/~mom/actor.json`) with ActivityPub vocabulary
2. HTTP Signatures (different from JWS - uses RSA, signs HTTP headers)
3. Inbox/Outbox endpoints speaking ActivityPub vocabulary
4. Mapping: Entry → Create(Note), Comment → Create(Note) with inReplyTo, Like → Like activity

Consider using a bridge service (fed.brid.gy) instead of implementing directly.

### Known Libraries

| Purpose | Library | Notes |
|---------|---------|-------|
| Ed25519 signing | `@noble/ed25519` | Pure JS, no native deps |
| JWS/JWK handling | `jose` | Full JWT/JWS/JWK support |
| JSON canonicalization | `canonicalize` | RFC 8785 implementation |
| Webmention sending | `send-webmention` | Discovers endpoint and sends |
| Microformat parsing | `microformats-parser` | Parses h-entry, h-card |
| HTML sanitization | `sanitize-html` | Allowlist-based |
| Feed parsing | `feedparser` or `rss-parser` | For polling external feeds |

### Extension Fields

If you need to add custom fields to JSON objects:

- Prefix with `_` (underscore): `_ai_assisted`, `_content_warning`, etc.
- Preserve unknown `_` fields when re-serializing (don't strip them)
- Document any new fields you add

### Microformat Classes Reference

For h-entry parsing/generation:

| Class | Purpose | Example |
|-------|---------|---------|
| `h-entry` | Container for a post | `<article class="h-entry">` |
| `p-name` | Post title | `<h1 class="p-name">` |
| `e-content` | Post content (HTML) | `<div class="e-content">` |
| `dt-published` | Publication date | `<time class="dt-published">` |
| `u-url` | Permalink | `<a class="u-url" href="...">` |
| `p-author` | Author (with h-card) | `<a class="p-author h-card">` |
| `u-in-reply-to` | URL being replied to | `<a class="u-in-reply-to" href="...">` |
| `u-like-of` | URL being liked | `<a class="u-like-of" href="...">` |
| `h-card` | Author/person info | `<span class="h-card">` |
| `u-photo` | Avatar/photo URL | `<img class="u-photo">` |

### Testing Cross-Site Interactions

For testing Webmention without running two servers:

1. Use [webmention.io](https://webmention.io) as a hosted endpoint
2. Use [webmention.rocks](https://webmention.rocks) for testing your sender
3. Use [indiewebify.me](https://indiewebify.me) to validate your h-entry markup
