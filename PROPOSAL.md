# Open Feed Protocol — v0.6 Proposal

**Status: Proposal (clean-slate rewrite, revision 3).** This document proposes a collapsed redesign of Open Feed. It is self-contained: it does not depend on `open-feed-spec.md` (v0.5.1), which remains the reference for the expansive design. Appendix E maps what was removed or merged and why.

**Revision 2 incorporates review decisions** (see `PROPOSAL-REVIEW.md`, `PROPOSAL-REVIEW-2.md`, and the follow-up synthesis): the manifest is now a **separately-signed cumulative document** decoupled from the key chain (§9); interactions use a **`_rel` relation array** with bridge-shaped, namespaceable types (§8); items carry a **canonical/copy** rule via a mandatory `_feed_url` (§7.5); **Authorized Fetch moved to an extension** so the core has exactly one signing construction (§11); the replies endpoint **returns a JSON Feed** (§12); **recovery folded into migration** (§3.4); a non-verifying **Level 0** read tier is named (§13); and audit fixes land (single-author binding §6.6, CORS on all public documents §13/§14, silent `202` for blocked authors §10.4, untrusted-content rendering generalized §10.5). `follows` and `pins` conventions are added (Appendix G).

**Revision 3 incorporates the comparative review** (protocol-landscape comparison vs ActivityPub / atproto / Nostr / IndieWeb, plus a second independent review): a `root` relation type fixes thread-root inbox delivery (§8.1); the pull path gains a receipt-time analog for revocation via manifest first-observation (§4.4, §14.10); multiple feeds are resolved with a `feeds` array and an activity-feed convention (§3.2, §8); item ids are bound to one feed and MUST NOT contain `#` (§7.2, §7.5, §8); migration blesses bulk re-signing (§3.4); hub trust is restated as a three-tier adversary gradient (§14.2); the scaling claim is scoped explicitly (§14.4, §14.14); and a key-delegation extension is sketched (Appendix H).

## Abstract

Open Feed is a protocol for decentralized publishing and interaction. An identity is an HTTPS URL that serves **one signed identity document** — profile, keys, endpoints, and a tamper-evident chain of its own versions. Content is published as signed JSON Feed items; a **separately-signed, cumulative manifest** commits the feed's contents so a host cannot silently drop or roll them back. Interactions (replies, likes, reposts, quotes, mentions) **are** feed items carrying a `_rel` relation array, delivered by POSTing the signed item to the recipient's inbox.

The protocol is a few conventional documents and one endpoint:

```
https://pence.family/~mom/               ← identity URL (human page, optional)
https://pence.family/~mom/openfeed.json  ← identity document (signed: profile + keys + chain)
https://pence.family/~mom/feed.json      ← JSON Feed 1.1, signed items
https://pence.family/~mom/manifest.json  ← signed, cumulative commitment to the feed's contents
https://pence.family/~mom/inbox          ← POST signed items here (Level 3 only)
```

plus a **history** document (the chain of past identity-document versions) referenced from the identity document.

Built on four standards and nothing else: **HTTPS**, **JSON Feed 1.1**, **JOSE** (JWK/JWS/JWT, RFC 7515/7517/7519/7797), and **JSON canonicalization** (RFC 8785 + I-JSON RFC 7493).

## 1. Design Principles

1. **Identity in one signed document; content in one signed manifest.** Everything a verifier needs about an identity — its keys and its endpoints — is in one signed JSON document at one conventional path. What content that identity has published is committed by one separately-signed manifest. Both are pinned (§5.3, §9); neither requires HTML parsing, link-relation discovery, or a cross-document key-ownership check.
2. **One object model.** A like is an item. A reply is an item. There is exactly one signed schema for content, one update mechanism (versioning), one delete mechanism (tombstones), and one verifier.
3. **The feed is the source of truth; the inbox is a push cache.** Delivery makes things fast; polling the signed feed makes them complete. Nothing exists only in transit.
4. **Convention over configuration.** Fixed paths (`openfeed.json`, `manifest.json`). One relation array. Prefix rules for extension fields; a small registered vocabulary (plus namespaced URLs) for relation *types*.
5. **Byte-exact signing, one construction.** Documents are signed as published bytes (RFC 8785) with a single detached-JWS construction (§6). No verify-time normalization, no remote contexts, no second signing scheme in the core (the restricted-feed token is an extension, §11).
6. **Honest trust model.** Hubs that hold keys can impersonate their users, like email providers can. This is documented, not hidden. Client-side keys are supported for those who want them; the manifest and chain defend against a *host* that turns malicious, which is a distinct threat from a *key custodian* (§14.2).

## 2. Terminology

RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

- **Identity**: an HTTPS URL controlled by a person or group.
- **Identity document**: the signed JSON document at `{identity_url}openfeed.json`.
- **Item**: a JSON Feed item, signed, the universal content object.
- **Relation item**: an item carrying a `_rel` array (§8) — what other protocols call an interaction.
- **Manifest**: the separately-signed, cumulative document committing to a feed's item set (§9).
- **Chain**: the hash-linked sequence of identity-document versions (§5).
- **Pin**: a consumer's stored `(seq, hash)` observation of an identity document or a manifest.

## 3. Identity

### 3.1. Identity URL

An identity is an HTTPS URL. Normalization (applied whenever identity URLs are stored or compared):

- MUST use the `https` scheme
- Domain lowercased; default port (`:443`) removed
- Query string and fragment stripped
- Trailing slash appended if absent
- Path treated as case-sensitive

| Input | Normalized |
|-------|------------|
| `https://Alice.Example/~mom` | `https://alice.example/~mom/` |
| `https://example.com:443/~alice/` | `https://example.com/~alice/` |
| `https://example.com/~alice?ref=x#about` | `https://example.com/~alice/` |

The identity URL SHOULD serve a human-readable page (HTML, a profile, anything). Nothing in this protocol reads it. Machines read the identity document.

### 3.2. Identity Document

The identity document lives at the fixed path `{identity_url}openfeed.json` (the normalized identity URL, which ends in `/`, plus the literal filename). Examples:

- `https://pence.family/~mom/` → `https://pence.family/~mom/openfeed.json`
- `https://jessepence.com/` → `https://jessepence.com/openfeed.json`

It is a signed JSON document:

```json
{
  "url": "https://pence.family/~mom/",
  "name": "Mom",
  "bio": "Grandmother, gardener, cat enthusiast.",
  "avatar": "https://pence.family/~mom/avatar.jpg",
  "feed": "https://pence.family/~mom/feed.json",
  "manifest": "https://pence.family/~mom/manifest.json",
  "inbox": "https://pence.family/~mom/inbox",
  "history": "https://pence.family/~mom/history.json",
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

Fields:

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The identity URL. MUST match the URL the document was fetched under (after normalization). Author binding for the document itself. |
| `keys` | MUST | Array of JWKs (section 4). At least one non-revoked, non-recovery key. |
| `seq` | MUST | Version counter, starts at 1, strictly increasing (section 5). Advances on **identity** changes (keys, profile, endpoints, migration) — *not* on content publication. |
| `updated` | MUST | Publication time of this version (Unix seconds). |
| `_sig` | MUST | Detached JWS over the document (section 6). |
| `prev` | MUST if `seq > 1` | Base64url SHA-256 of the full canonical bytes of the previous version, including its `_sig` and `_recovery_sig` if present. |
| `history` | MUST if `seq > 1` | URL of the version history document (section 5.4). |
| `feed` | SHOULD (MUST for Level 2) | URL of the identity's JSON Feed. |
| `manifest` | MUST if `feed` present | URL of the feed's signed manifest (section 9). |
| `feeds` | MAY | Additional feeds beyond the primary — array of `{ "url": ..., "manifest": ... }` objects, each committed by its **own** signed manifest (section 9). Used e.g. for the activity feed (section 8). |
| `inbox` | MAY (MUST for Level 3) | Inbox endpoint URL. |
| `replies` | MAY | Replies-endpoint URL (section 12). |
| `follows`, `pins` | MAY | URLs of the follow list / observed-pins document (Appendix G). Outside the trust core. |
| `name`, `bio`, `avatar`, `content_warning` | MAY | Profile metadata. `content_warning`, if present, marks all content from this identity as sensitive. |
| `successor`, `predecessor` | MAY | Migration links (section 3.4). |
| `_recovery_sig` | MAY | Recovery co-signature for fork resolution (section 5.5). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise. Extension fields SHOULD use a `_` prefix.

Note that the identity document commits to the manifest by **URL**, not by hash. Content freshness is proven by the manifest's own signature and sequence (section 9), so ordinary publishing does **not** re-sign or re-version the identity document. The chain versions identity state, which changes rarely.

Every identity document is signed and versioned — there is no unsigned or unchained mode. Verification is trust-on-first-observation (section 5.3): the signature proves continuity between versions, not first-contact authenticity.

### 3.3. Fetching and Redirects

When fetching an identity document:

- Follow at most 5 redirects
- MUST NOT follow a redirect to a different origin
- The response MUST parse as JSON; reject `text/html` or any non-JSON Content-Type; accept `application/json`
- The response MUST carry `Access-Control-Allow-Origin: *` (section 13); this applies to every publicly-readable document, so browser Level-1 readers work without a proxy

A cross-origin redirect is never identity equivalence. Migration is expressed in-band (section 3.4), not with redirects. Same-origin redirects (trailing slash, path moves) are followed normally.

### 3.4. Migration and Recovery

Migration and recovery are one operation — *this identity continues over there* — differing only in **which key attests**.

To move from `https://old.example/~alice/` to `https://alice.new/`:

1. Establish the new identity (new identity document, new or same keys), adding `"predecessor": "https://old.example/~alice/"`.
2. **Cooperative migration** (old domain still under control): the old identity document publishes a new chain version adding `"successor": "https://alice.new/"`. Consumers follow `successor` when both links exist and agree — each is inside a signed document, so the pair is a cryptographic cross-signature verifiable against the old identity's pinned chain.
3. **Recovery** (old domain lost): the new identity document additionally carries a `_recovery_sig` — a detached JWS by a **recovery key** (§4.5) that was committed in a pinned ancestor of the predecessor. A consumer holding a pin of the old identity verifies the co-signature against that recovery key and follows `predecessor` even though the old side can no longer publish a `successor`.

Migration makes the new feed canonical for *new* content, but previously-published items carry the old feed's URL in their signed `_feed_url`, so at the new home they would be mere copies (section 7.5). The migration procedure therefore ends with **bulk re-signing**: republish the back catalog at the new feed — same `id`s, bumped `_version`, `date_modified` set to the re-signing time, `_feed_url` naming the new feed — and commit it all in the new feed's manifest. A verified migration is the sole exception to the id/feed binding rule (section 7.5): the binding follows the identity to its successor feed. Consumers that verified the migration treat the re-signed versions as superseding the predecessor's.

A `successor` claim without a matching `predecessor` (or vice versa), and unaccompanied by a valid recovery co-signature, MUST NOT be treated as migration. Consumers without a prior pin of the old identity can only treat a recovery-based migration as unverified (out-of-band confirmation recommended); Appendix G's `pins` convention is how a family propagates such a claim through its social graph. Recovery handles *domain loss*; it does not protect against theft of the recovery key itself.

There is no separate "recovery claim" or "recovery attestation" document: the chained identity document — signed by an active key, carrying `predecessor`, and co-signed by a committed recovery key — *is* the attestation.

## 4. Keys

### 4.1. Key Entries

Keys are JWK objects (RFC 7517) in the identity document's `keys` array:

| Field | Required | Description |
|-------|----------|-------------|
| `kid` | MUST | Key ID, unique within this identity, MUST NOT contain `#` |
| `kty` | MUST | `OKP` |
| `crv` | MUST | `Ed25519` |
| `x` | MUST | Base64url public key (32 bytes) |
| `iat` | SHOULD | Issued-at (Unix seconds) |
| `revoked_at` | MAY | Revocation time (Unix seconds). Absent or `null` = active. |
| `use` | MAY | `sig` (default) or `recovery` (section 4.5) |
| `alg` | MAY | If present, `EdDSA` |

Implementations MUST ignore keys with unrecognized `kty`/`crv` (future algorithms slot in additively). Timestamp convention: key and chain fields use Unix seconds (JOSE convention); content fields use ISO 8601 strings (JSON Feed convention).

### 4.2. Key Identifiers

The full key identifier used in JWS headers is:

```
{identity_url}#{kid}
```

e.g. `https://pence.family/~mom/#key-1`. Verifiers split at the **last** `#`: the left side is the identity URL (normalize it; normalization strips fragments, so the split happens first), the right side is the `kid` to find in that identity's document.

Because keys live *in* the identity document, key ownership is structural: the identity named by the `kid` either lists the key or it doesn't. There is no separate ownership check, and possession of a key that merely *verifies* proves nothing about any identity.

### 4.3. Rotation

1. Publish a new chain version (section 5.2) adding the new key
2. Sign new content and manifests with the new key
3. Optionally set `revoked_at` on the old key in the same or a later version

Rotated-out keys SHOULD remain listed for at least 30 days (verification of old content). A key MUST remain listed in any chain version whose `_sig` it produces (section 5.2).

### 4.4. Revocation

- Signatures on content whose effective signing time (section 6.5) is after `revoked_at` MUST be rejected; before, they remain valid.
- Because content timestamps are self-reported, a key thief can backdate. For inbox-delivered items, receivers SHOULD apply the revocation check against **receipt time**, which the sender cannot backdate. Revocation limits damage from honest rotation far more than it stops an active thief (section 14.10).
- The pull path has a receipt-time analog. Consumers SHOULD record the wall-clock time each item id was **first observed** in a signed manifest (one timestamp alongside the manifest pin, section 9) and apply the revocation check against that first-observed time. A thief can backdate an item's `date_published`, but cannot backdate when a consumer's polling loop first saw a manifest commit to it — a "years-old" item first entering the manifest after `revoked_at` is rejected. (Consumers with no observation history for an identity fall back to the self-reported check; first contact is TOFU here as everywhere, section 5.3.)

### 4.5. Recovery Keys

A key with `"use": "recovery"`:

- MUST NOT sign regular content or manifests
- MUST be stored offline (not on the hub)
- SHOULD be generated at identity creation
- Co-signs a migration for domain-loss recovery (§3.4) and MAY co-sign a chain version for fork resolution (§5.5)

Because recovery keys are committed in the chain, any consumer holding a pin can verify a later recovery-based migration or fork resolution against the recovery key present at a pinned `(seq, hash)`. Verifiers MAY reject a recovery-based migration while the original domain still serves a conflicting chain.

## 5. The Version Chain

The identity document is served over TLS, but a compromised host or hijacked domain could roll back to an older version (un-revoking a key) or serve different versions to different readers. The chain makes both tamper-evident to any consumer who has seen the identity even once.

The chain versions **identity state** — keys, profile, endpoints, migration links. Content freshness is protected separately, and by the same logic, by the signed cumulative manifest (§9): a consumer pins the manifest exactly as it pins the identity document. Splitting the two means ordinary publishing advances the manifest, not the chain, so the chain stays short (5–20 versions over a lifetime) regardless of how often content is posted.

### 5.1. Chain Fields

`seq`, `prev`, `updated`, `_sig` (and optionally `_recovery_sig`), as defined in section 3.2. `prev` hashes the *full published canonical bytes* of the predecessor — including its signature fields — so byte-preserving storage of old versions is the simplest correct implementation.

### 5.2. Producing a Version

1. Start from the current version; apply changes (keys, profile, endpoints, migration links)
2. `seq` += 1; `prev` = hash of the previous version; set `updated`
3. Sign with a **continuity key**: a key that was valid (non-revoked, non-recovery) in the *previous* version
4. Append the previous version to the history document

The continuity key is often revoked *in the very version it signs* — that is normal rotation. Validity is judged against the previous version's state. The continuity key MUST remain listed in the version it signs (else the version cannot be verified from its own bytes); it MAY be dropped in later versions. Genesis (`seq: 1`) has no predecessor and is signed by a non-revoked key it contains.

### 5.3. Consumer Enforcement (Pinning)

A consumer that has verified an identity document at `(seq: N, hash: H)` MUST store that pin. On any later fetch:

1. Verify the new document's `_sig`; the signing key named by its `kid` MUST be listed in the document itself
2. Walk `prev` links (fetching intermediates from `history`) back to `(N, H)`. At each hop, verify that version's `_sig` and confirm its signing key was valid in *its* predecessor — hash linkage alone is not sufficient, since a fabricated intermediate could introduce an attacker's key
3. Reject if `seq` decreased, if any `prev` mismatches, or if two documents claim the same `seq` with different hashes (equivocation)

The consumer separately pins the **manifest** at its own `(seq, hash)` and enforces monotonicity and the cumulative invariant on it (§9). Content needs no lineage walk: the manifest is cumulative, so the current signed manifest already proves everything a genesis-to-now walk would, and key trust flows from the chain the manifest's `_sig` key belongs to.

First contact is TOFU: accept and pin. Tampering is detectable from the second observation onward, or immediately for any two consumers comparing pins out-of-band. A consumer that cannot connect its identity pin to the current document (missing history) MUST treat the chain as unverifiable rather than silently re-pin.

### 5.4. History

Producers MUST retain all prior identity-document versions and serve them at the `history` URL:

```json
{ "versions": [ { "...": "verbatim seq:1 document" }, { "...": "verbatim seq:2 document" } ] }
```

Ascending order; every version from genesis; entries MUST canonicalize to bytes matching the successor's `prev`. Because the chain advances only on identity changes (not on publication), history grows slowly; consumers SHOULD still cap the versions walked per update (RECOMMENDED: 1000) and the history size fetched (section 14.4). The manifest has **no** history document — being cumulative, its latest version suffices.

### 5.5. Fork Resolution

Equivocation detection reveals *that* the chain forked, not *which* branch is honest — after key theft, both branches carry valid continuity signatures. A version MAY carry `_recovery_sig`: a second detached JWS by a recovery key committed in a pinned ancestor. `_sig` and `_recovery_sig` are each computed over the canonical document with **both** signature fields removed.

A thief of the online key cannot produce `_recovery_sig` (the recovery key is offline). Verifiers detecting a fork SHOULD prefer the branch carrying a valid recovery co-signature; a fork where neither branch has one is unresolvable and SHOULD be flagged for manual review. Producers SHOULD co-sign the first version published after a suspected compromise.

## 6. Signatures

### 6.1. Format

Detached JWS Compact Serialization with **unencoded payload** (RFC 7515 + RFC 7797):

```
base64url(header)..base64url(signature)
```

The payload is the canonical JSON bytes (section 6.3). The JWS Signing Input is:

```
ASCII(BASE64URL(UTF8(header)) || '.') || canonical-json-bytes
```

The signature covers **header and payload**. Signing only the payload bytes MUST NOT be done — it leaves `alg` and `kid` unauthenticated, letting an attacker swap the referenced key.

This is the **only** signing construction in the core. It signs identity documents, items, and manifests identically. (The restricted-feed extension, §11, uses a standard encoded-JWS token; that construction is deliberately kept out of the core.)

### 6.2. Header

```json
{ "alg": "EdDSA", "b64": false, "crit": ["b64"], "kid": "https://pence.family/~mom/#key-1" }
```

All four fields MUST be present with exactly these `alg`/`b64`/`crit` values. Verifiers MUST reject unrecognized `alg`, `crit` entries they don't understand, and signatures where the referenced key's `crv` is not `Ed25519` (the `alg` alone does not fix the curve).

### 6.3. Canonicalization

1. Remove `_sig` (and `_recovery_sig` if present)
2. Serialize per RFC 8785: UTF-8, no whitespace, keys sorted, ES6 number formatting

Strings are signed **byte-exact as published** — no Unicode normalization at sign or verify time. Producers SHOULD emit NFC. Implementations MUST reject JSON containing duplicate member names (I-JSON, RFC 7493).

### 6.4. Signing

1. Remove signature fields; canonicalize → payload bytes
2. Build the header; `header-b64 = BASE64URL(UTF8(header))`
3. Sign `ASCII(header-b64 || '.') || payload-bytes` with Ed25519
4. Set `_sig` = `header-b64 || '..' || BASE64URL(signature)`

### 6.5. Verification

1. Extract and remove signature fields; canonicalize → payload bytes
2. Parse header; enforce section 6.2
3. Split `kid` at the last `#` → identity URL + key id
4. **Author binding**: the `kid` identity URL MUST equal the claimed author (section 6.6) after normalization. Reject otherwise.
5. Fetch the identity document at `{identity_url}openfeed.json`; enforce pinning (section 5.3); find the key
6. If the key has `iat`: verify it predates the content's **effective signing time** — for items, `date_modified` if present else `date_published`; for manifests and identity documents, `updated`. (No `iat` → skip.)
7. Verify the key was not revoked before the effective signing time
8. Verify the Ed25519 signature over the reconstructed Signing Input

The effective-signing-time rule lets content be legitimately re-signed after rotation: bump `_version`, set `date_modified` to the actual signing time, keep `date_published`.

### 6.6. Author Binding

Every signed document carries its author's identity URL **inside the signed bytes**:

- **Items**: the item-level `authors` array MUST contain **exactly one entry**, whose `url` is the signer's identity URL. (Feed-level `authors` are not covered by item signatures and MUST NOT be relied on. A multi-author *feed* still works — every item names its own single author.) Clients MUST attribute solely to this entry; they MUST NOT display any other self-asserted author name.
- **Manifests**: the `url` field (the identity that owns the feed).
- **Identity documents**: the `url` field.

The claimed author MUST equal the `kid`'s identity URL. This prevents republishing someone's signed content under a different name: the binding travels with the bytes.

Items MUST also include `_feed_url` (the containing feed's URL) in the signed payload when served in a feed; this drives the canonical/copy rule (§7.5). Inbox-only items omit it (§8).

## 7. Feeds and Items

### 7.1. Feed Document

A feed MUST conform to JSON Feed 1.1. Content-Type `application/feed+json` or `application/json` (reject non-JSON; the check exists to avoid parsing HTML error pages, not to police vendor types — static hosts serve `application/json` and MUST be accepted). Like every public document, a feed MUST be served with `Access-Control-Allow-Origin: *`.

Required: `version`, `title`, `feed_url`, and `items`. Feed-level `authors` MAY be present for display; they carry no authority.

A feed is owned by the identity whose identity document lists it under `feed`, and its contents are committed by the manifest that identity lists under `manifest` (§9). Feeds MAY contain items from multiple authors (family boards); every item is independently signed and attributed by its own signed single-entry `authors`.

### 7.2. Items

Every item MUST include:

| Field | Description |
|-------|-------------|
| `id` | Globally unique, permanent (UUID URN or tag URI RECOMMENDED). MUST NOT contain `#` — ids appear as URI fragments in relation references (section 8) |
| `date_published` | ISO 8601 |
| `authors` | Single-entry author binding (section 6.6) |
| `_feed_url` | The containing feed's URL (MUST for feed-served items; omitted only for inbox-only items) |
| `_version` | Integer, starts at 1 |
| `_sig` | Detached JWS (section 6) |

plus at least one of `content_text` / `content_html`. Consumers MUST preserve unknown `_` fields; signatures depend on it. A relation item additionally carries `_rel` (§8).

### 7.3. Versioning and Tombstones

To edit: bump `_version`, set `date_modified`, re-sign. Same `id` forever; `(author, id, _version)` names an exact signed revision. Feeds carry only the latest version.

To delete: publish a **tombstone** — same `id`, bumped `_version`, `date_modified` set, `_deleted: true`, content fields removed (`content_text` set to `""` to stay JSON-Feed-valid), `authors`/`date_published`/`_feed_url`/`_rel` retained, re-signed. Consumers seeing a valid tombstone SHOULD drop cached content and retain the tombstone (higher `_version` wins over any replayed earlier revision). Tombstones SHOULD stay in the feed for ≥30 days; the manifest remembers them permanently (§9). Deletion is best-effort — consumers that never re-fetch can't be forced.

### 7.4. Attachments and Pagination

Attachments use JSON Feed's `attachments` (metadata signed; bytes not — `_sha256` SHOULD carry a content hash for images and other integrity-sensitive media). Pagination uses JSON Feed's `next_url`; feeds SHOULD carry at least the 50 most recent items.

### 7.5. Canonical and Copied Items

An item is **canonical** only in the feed its signed `_feed_url` names. The same signed item may legitimately appear elsewhere — a family aggregate feed, a follower's cache, a bridge — as a **copy**. Because the signature travels with the bytes, a copy is still verifiable as *authored* by its signer. But a copy carries **no authority over current publication state**: it does not prove the item is still live, is not evidence of manifest membership, and cannot resurrect content the author has tombstoned.

Rules:

- A consumer MUST verify an item's `_feed_url` matches the feed URL it was fetched from (after normalization) before treating it as canonical. A mismatch marks the item a copy — display it (e.g. "via …"), attribute it to its signer, but do not grant it liveness or manifest standing.
- To determine whether a copied item is currently live or deleted, consult the manifest at its `_feed_url` (§9). The canonical manifest is authoritative; a copy cannot override a tombstone recorded there.
- An `id` is permanently bound to a single `_feed_url`. The same `id` MUST NOT be signed with two different `_feed_url` values: the bytes would differ while `(author, id, _version)` claims to name one exact revision (§7.3), and inbox dedup (§10.3) would silently drop one variant. Cross-posting the same content to another feed (one's own feed *and* a family board, say) uses a **new item** with a fresh `id` carrying a `repost` or `quote` relation to the original. (A verified migration is the sole exception: §3.4's bulk re-signing moves the binding to the successor feed.)

Together with the manifest this closes both omission and injection: the manifest proves **presence** (a host can't drop your content), and `_feed_url` proves **exclusivity** (a host can't inject or resurrect your content by copying it into its own feed). It also gives availability for free — a follower may serve its cached copy of your feed when your host is down, and it still verifies.

**Bridged and unverified items.** Content ingested from another protocol (ActivityPub, Webmention/IndieWeb, atproto — Appendix F) cannot be a native signed item, because no one holds the foreign author's Open Feed key. Such content MUST be marked `_unverified: true` (a copy the gateway merely observed) **or** authored by a disclosed gateway/proxy identity whose key custody is stated. It MUST NOT be presented as a native, verified identity. This is the same honest-hub-trust model (§14.2) extended across a protocol boundary.

## 8. Interactions Are Items

There is no separate interaction object. An interaction is an item carrying a **`_rel` array**: one entry per relation, each an object with a `type` and a target `to`.

```json
{
  "id": "urn:uuid:...",
  "authors": [{ "url": "https://pence.family/~dad/" }],
  "_feed_url": "https://pence.family/~dad/feed.json",
  "content_text": "Those cookies were delicious!",
  "date_published": "2025-12-07T16:00:00Z",
  "_version": 1,
  "_rel": [{ "type": "reply", "to": "https://pence.family/~mom/feed.json#urn:uuid:550e8400-..." }],
  "_sig": "..."
}
```

Core relation types:

| `type` | Meaning | Content |
|--------|---------|---------|
| `reply` | Reply to the referenced item | REQUIRED |
| `root` | Thread root of a nested reply; accompanies `reply` (section 8.1) | (governed by `reply`) |
| `like` | Endorsement of the referenced item | NONE (add `_emoji` to the entry for reactions) |
| `repost` | Share of the referenced item | NONE |
| `quote` | Quote of the referenced item | REQUIRED |
| `mention` | Mentions the referenced identity | REQUIRED |

Entry shape:

- **`type`** — a registered token from the table above **or** an absolute URL for custom relations (`"type": "https://example.com/ns#bookmark"`). This mirrors HTML link relations: a small registered vocabulary plus permissionless namespaced URIs. Namespacing by URL is collision-free; the `_` field convention is not, which is why relation *types* are values, not field names.
- **`to`** — a single target URI. For items: `{feed_url}#{item_id}` (RECOMMENDED — receivers resolve relevance structurally by splitting at the last `#`, unambiguous because ids never contain `#`, section 7.2) or the target's permalink `url` (which forces receivers to recognize their own permalinks — workable for hubs, fuzzier for anyone else). For `mention`: the mentioned identity URL. Multiplicity is expressed with **multiple entries**, never an array in `to` (so a reply that mentions two people is three entries).
- Entries are **open objects**: unknown keys MUST be preserved. This is where per-relation extension and bridge round-trip data live (`_emoji` on a `like`; a foreign activity id on a bridged `reply`).

Custom-typed entries follow the same shape; receivers store unknown types and MAY hide them. Clients SHOULD NOT render content-less relation items (`like`, `repost`) as posts; they are activity. Publishers SHOULD segregate content-less relation items into a separate **activity feed** — listed in `feeds` (section 3.2) with its own manifest — rather than the primary feed. This keeps the primary feed clean for Level 0 readers (a plain feed reader would otherwise render bare likes as posts) and keeps the primary manifest, where every id lives forever (section 9), from being dominated by likes.

Interaction items live in their author's feed like any other item (SHOULD — they MAY be inbox-only, in which case `_feed_url` is omitted). One object, one signature: publishing it and delivering it are the same bytes, so there is nothing to keep in sync.

### 8.1. Threading

A `reply` entry's `to` points at the **parent** — a post, or another reply item (in the parent author's feed). When the parent is not itself the thread root, the item SHOULD also carry a `root` entry pointing at the thread root. Without it, deep replies never reach the conversation's host: inbox relevance (section 10.2) is judged per `_rel` entry, so a reply-to-a-reply references only the parent's author, and the root author's inbox would reject it as `not_relevant` — the person hosting the thread would be the one who can't see it. Because the relevance check is type-agnostic, `root` entries are honored even by receivers that predate the type. Senders SHOULD deliver a nested reply to both the parent author's and the root author's inboxes.

Threads are trees built by walking parents; clients display flat or nested and SHOULD cap walk depth (loops are possible in malicious data; treat re-visited references as leaves). The replies endpoint (section 12) accelerates discovery.

### 8.2. Updating and Deleting Interactions

Same as any item: edit = bump `_version` + re-sign; unlike/retract = tombstone, delivered to the same inbox. Tombstones SHOULD retain their `_rel` array (routing), and receivers MUST accept a tombstone whose `(author, id)` matches a stored item even if `_rel` is absent. To *change* a reaction, tombstone the old item and publish a new one with a fresh `id` — `id` reuse across different relations is not permitted.

## 9. The Manifest

The manifest commits an identity to a feed's contents. Each feed an identity publishes — primary or additional (`feeds`, section 3.2) — has its own manifest, keyed by its `feed_url`. It is a **separately-signed** document — signed by a key valid in the identity's chain — with its own monotonic sequence. Rolling it back or forking it is exactly as detectable as rolling back keys, but publishing a new item advances the manifest alone, never the identity chain.

```json
{
  "url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "seq": 412,
  "updated": 1739577600,
  "items": { "urn:uuid:550e8400-...": 3, "urn:uuid:661f9511-...": 1 },
  "deleted": { "urn:uuid:99aa2222-...": 4 },
  "_sig": "..."
}
```

- `url`: the owning identity (author binding, §6.6); MUST match the identity that lists this manifest under `manifest`
- `feed_url`: the feed this manifest commits to
- `seq`: monotonic version counter; a consumer rejects any manifest whose `seq` is below its pin (rollback)
- `updated`: publication time (Unix seconds); the effective signing time for the revocation/`iat` check (§6.5)
- `items`: map of live item `id` → current `_version`
- `deleted`: map of tombstoned `id` → tombstone `_version`. Entries stay here permanently (a few dozen bytes each), so deletion history is verifiable from the latest manifest alone. Omit when empty
- `_sig`: detached JWS (§6) by a chain-valid key

Item *content* integrity needs no hash here: each item carries its own signature. The manifest adds what signatures cannot: **presence** and **freshness**. Content needs no `prev`-lineage because the manifest is cumulative (invariant 1) — the current signed manifest is self-sufficient, and key trust comes from the chain the signing key belongs to.

Invariants (violations MUST be treated like chain equivocation):

1. An `id`, once present in `items`, MUST appear in every later manifest — in `items` (same or higher version) or in `deleted` — forever. Content cannot silently vanish; removal requires a signed tombstone.
2. `seq` and per-item versions never decrease.
3. A served feed MUST NOT contain an item version lower than the manifest's, and MUST NOT contain live items absent from the manifest — **except** transiently newer content (an item newer than the manifest is *manifest lag*, e.g. mid-publish caching; consumers treat its presence as unverified rather than as a violation, and expect the next manifest version to commit it). Because the manifest is cheap to re-sign, publishers SHOULD advance it together with the feed, keeping this window small.

Consumers verify incrementally: any item read from the feed is checked against the manifest entry (one map lookup). Detecting omission of an item you've never seen requires comparing manifests across pins, which pinning (§5.3) makes sound.

**Manifest verification.** (1) Verify `_sig` per §6.5, with the `kid` identity equal to `url` and the key found in that identity's pinned document. (2) Enforce the pin: `seq` ≥ pinned `seq`; on equal `seq`, hash MUST match (equivocation otherwise). (3) Enforce the cumulative invariant against any prior manifest pin. (4) Update the pin.

## 10. Inbox

### 10.1. Endpoint

`POST {inbox}` with `Content-Type: application/json`; the body is a **signed item**, verbatim. The inbox MUST allow cross-origin requests:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Reading one's own inbox (authenticated GET) is implementation-specific and out of scope; how a user authenticates to their own hub is out of scope entirely.

### 10.2. Verification

Cheap local checks run **before** any outbound fetch (the sender is unauthenticated until step 7; see section 14.9):

1. Enforce body-size limits; parse JSON; reject duplicate keys (I-JSON)
2. Validate required item fields (section 7.2)
3. **Relevance**: some `_rel` entry's `to` MUST reference this inbox's owner — their identity URL, their feed URL (with or without fragment), or an item of theirs. This is one lookup over `_rel` and works even for relation *types* the receiver doesn't understand (so unknown-typed interactions genuinely about the owner are accepted, per §8). Reject otherwise (`not_relevant`). Exception: a tombstone whose `(author, id)` matches a stored item is always relevant. A bare feed-URL `mention` alone SHOULD NOT authorize unbounded volume — treat it as low-priority/moderated
4. Timestamp bounds: effective signing time not more than 7 days past nor 24 hours future
5. Dedup (section 10.3) — reject without fetching if stale
6. Rate-limit by source IP (always) and by author (once known)
7. Verify the signature per section 6.5 (one outbound fetch: the author's identity document; cache it, and negatively cache failures)
8. Apply the revocation check against receipt time (section 4.4)

### 10.3. Replay and Deduplication

Receivers store `(author, id) → version`. A delivery is:

- **new** if the `(author, id)` is unknown → accept
- an **update** (including tombstones) if `_version` is greater than stored → accept, replace
- **stale** if `_version` is equal or lower → reject `409`

Receivers MAY additionally verify the item appears in the sender's manifest (extra assurance that the interaction is really published), but MUST NOT require it — inbox-only items are legitimate.

### 10.4. Responses

| Status | Meaning |
|--------|---------|
| `202` | Accepted / queued (do not distinguish moderation from auto-approval — and see below) |
| `400` | Malformed, missing fields, or not relevant to this inbox |
| `401` | Signature invalid or key revoked |
| `404` | Referenced target item does not exist |
| `409` | Stale version |
| `429` | Rate limited (include `Retry-After`) |

Error bodies: `{ "error": "code", "message": "human text" }` with codes `invalid_json`, `missing_field`, `not_relevant`, `invalid_signature`, `key_revoked`, `target_not_found`, `stale_version`, `rate_limited`.

**Blocked authors SHOULD receive `202`** with the content silently discarded — signalling a block with a distinct status tells a harasser to make a new identity and confirms the account exists. Reserve an explicit refusal status only for policy denials you actually want visible.

Senders retry 5xx/timeouts with exponential backoff for 24 hours. Recipients recover missed deliveries by polling the sender's feed (the feed is the source of truth); hubs SHOULD reconcile relation items found by polling against the inbox record.

### 10.5. Rendering Untrusted Content

Item content from anyone other than the local user is untrusted — whether it arrives by inbox delivery **or** by polling a stranger's feed. Receivers MUST either render only `content_text` (escaped) or aggressively sanitize `content_html` through an allowlist. Never render untrusted HTML as-is. Content marked `_unverified` (§7.5) MUST be displayed distinctly and never cached as verified.

## 11. Restricted Feeds (Extension)

Restricted (e.g. family-only) feeds are an **OPTIONAL extension**, specified separately (`open-feed-restricted-feeds.md`) and kept out of the core so the core has exactly one signing construction (§6.1). Level 3 implementations serving restricted feeds SHOULD implement it. Summary:

- Restricted feeds are **audience control, not confidentiality** — the serving host can read them; E2E encryption is out of scope.
- An unauthenticated GET returns `401` with `WWW-Authenticate: OpenFeed-Sig`. The reader retries with a short-lived, self-signed **encoded** EdDSA JWT (modeled on DPoP, RFC 9449) binding method + resource-normalized URL, replay-guarded by `jti`, using the same Ed25519 keys they already publish. The host serves the feed only to identities on the owner's reader list.
- A restricted feed carries its **own signed manifest** (same §9 mechanics), gated behind the same authentication.
- **Discovery:** the restricted feed's URL MAY be listed publicly in the identity document (its *existence* is metadata; its *contents* stay gated), or delivered to authorized readers as a signed inbox item when even the existence is sensitive. The identity document itself MUST NOT be served in audience-varying forms — two views at one `seq` would be equivocation (§5.3).

## 12. Replies Endpoint (OPTIONAL)

An identity MAY expose thread discovery via a `replies` field in its identity document. The response is a **JSON Feed** (§7.1) whose `items` are the reply items reproduced **byte-verbatim** as received, with the queried id echoed in a feed-level `_replies_to`:

```
GET {replies}?item={percent-encoded-item-id}
```

Optional params: `since` (ISO 8601), `limit` (default 50); pagination via the feed's own `next_url`. Because the response is a JSON Feed, consumers reuse the feed parser and the verbatim rule (fields never added, dropped, or reordered; absent fields stay absent, never `null`) is the same rule that already governs feeds. Consumers re-verify each reply's signature and build the tree from `_rel` `reply` entries (`root` entries, section 8.1, index deep replies to their thread). The endpoint MAY be moderated or filtered; consumers handle gaps gracefully.

## 13. Conformance

### Level 0 — Consume (non-verifying)

A plain feed reader that fetches the JSON Feed and ignores `_sig` is a valid consumer — it just gets no authenticity guarantee. Open Feed is strictly additive to the existing feed ecosystem: JSON Feed 1.1 readers (and, if an Atom mirror is published, RSS/Atom readers) work today with no Open Feed code. Level 0 has no requirements; it is named so the additive relationship is explicit.

### Level 1 — Read

MUST: fetch and parse identity documents, feeds, and manifests; verify signatures (section 6); enforce revocation; handle unknown fields and relation types gracefully.
SHOULD: pin and enforce the chain and the manifest (sections 5.3, 9); check items against manifests; enforce the canonical/copy rule (§7.5); honor content warnings; follow pagination; cache identity documents (≤1 h).

No infrastructure required.

### Level 2 — Publish

Level 1, plus MUST: serve an identity document (signed, chained, with history once `seq > 1`), a signed feed, and a signed manifest; produce valid signatures and canonical JSON; generate unique ids; serve every public document with `Access-Control-Allow-Origin: *`.

Fully static-hostable: every Level 2 artifact is a file; signing happens at build time. (Sending interactions requires Level 2 — you need published keys for anyone to verify you.)

### Level 3 — Interact

Level 2, plus MUST: inbox endpoint with the section 10 verification, dedup, CORS, and response codes.
SHOULD: replies endpoint; the restricted-feeds extension (§11) when serving restricted feeds; recovery keys and rotation UI for hosted users.

| Feature | L0 | L1 | L2 | L3 |
|---------|----|----|----|----|
| Read feed (no verify) | ✓ | ✓ | ✓ | ✓ |
| Verify signatures | | ✓ | ✓ | ✓ |
| Publish signed content | | | ✓ | ✓ |
| Send interactions | | | ✓ | ✓ |
| Static hosting sufficient | ✓ | ✓ | ✓ | |
| Receive interactions | | | | ✓ |
| Restricted feeds (extension) | | | | ✓ |

### Transient Failures

If an identity-document or manifest fetch fails transiently, cache the failure and retry (1 h, 4 h, 24 h) before permanent rejection.

## 14. Security Considerations

1. **Signature limitations.** Signatures prove a key signed bytes — not when (timestamps are self-reported), not who a person is, not that content is true.
2. **Hub trust vs host trust — a gradient, not a binary.** Three adversary tiers:
   - **Key custodian** (hub holds the user's signing key): forward impersonation is unpreventable — the email trust model, stated plainly. But even a key custodian cannot *silently rewrite the past* against pinned consumers: the cumulative manifest invariant forces removals to surface as signed tombstones (attributable actions), and per-consumer rewriting to surface as forks (equivocation, detectable via pins). Transparency rather than integrity — but transparency with teeth, the certificate-transparency bargain.
   - **Serving-path compromise** (CDN, static bucket, web tier — anything outside the signing boundary): the most common real-world compromise. The attacker cannot sign, so chain and manifest give hub users **full integrity**: no undetectable omission, rollback, or injection. Hubs SHOULD keep signing behind a narrower boundary than serving.
   - **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full integrity against the host by construction.

   Client-side keys (or the delegation extension sketched in Appendix H) move a user from the first tier toward the third.
3. **TLS and CORS.** Everything HTTPS; validate certificates. Every publicly-readable document is served with `Access-Control-Allow-Origin: *` so browser Level-1 readers need no proxy.
4. **Resource limits.** Suggested caps: identity document 100 KB / 100 keys; manifest 1 MB (~10–15k items — a deliberate family-scale ceiling; paginate beyond it); feed page 10 MB / 1000 items; inbox body 100 KB; history versions walked per update 1000; concurrent fetches per origin 10. Open Feed scales **across identities** — each is self-contained and independently verifiable — not in items-per-identity; the flat manifest is that boundary by construction, and a global-scale aggregator (firehose) is explicitly out of scope.
5. **SSRF.** For every outbound fetch: HTTPS only, ≤5 redirects, 10 s timeout, size limits, reject private/loopback/link-local addresses, dedicated restrictive HTTP client.
6. **Signature stripping.** Never attribute unsigned content; display unverified content distinctly; never cache it as verified.
7. **Replay/timing.** Constant-time comparisons; NTP; never trust self-reported time as sole ordering.
8. **Enumeration.** Rate-limit discovery endpoints; uniform timing for exists/doesn't-exist. The permanent `deleted` map (§9) makes "this identity deleted something at version N" a lasting public fact — fine for family use, worth noting for anyone else.
9. **Inbox fetch amplification.** The `author` in a delivered item is attacker-controlled until verification succeeds. Rate-limit by source IP before fetching; run all local checks first; fetch only the fixed-path identity document of the claimed author (never an arbitrary URL from the `kid` — the path convention makes this structural); negatively cache failures. Collapsing discovery to one document also halves the amplification factor by construction.
10. **Rollback vs self-reported time.** The chain detects identity-document rollback; the manifest's `seq` detects content rollback — both relative to a consumer's pin. Neither detects item *backdating* (self-reported timestamps); receipt time is the trustworthy lower bound for inbox items, and the `pins` convention (Appendix G) is a family-scale approximation of an external time anchor. A true transparency log / witness network remains future work.
11. **Inbound and copied HTML.** Section 10.5. Escape or sanitize any content not authored by the local user, always.
12. **Thread loops.** `_rel` `reply` graphs from malicious parties may contain cycles; cap walk depth.
13. **Manifest lag vs violation.** Content *newer* than the manifest is lag (tolerate briefly); content *vanished* from the manifest without a tombstone, or a copied item contradicting the canonical manifest, is a violation (treat as equivocation).
14. **Identity portability.** Losing the domain without recovery keys orphans the identity — the email trade-off. Recovery keys + pins close the hijack gap for anyone who observed the identity before the hijack; first contact after a hijack is unprotectable **by design**. Durable identity across domain loss is what atproto buys with DID indirection; Open Feed deliberately trades it for URL-native simplicity, and recovery keys + pins are the family-scale mitigation, not a fix. External anchors (transparency logs, witnesses) remain deferred.

## Appendix A: Media Types

| Document | Content-Type (serve) | Accept (consume) |
|----------|---------------------|------------------|
| Identity document, manifest, history, inbox body | `application/json` | any JSON; reject non-JSON |
| Feed | `application/feed+json` | that, or `application/json` |

All served with `Access-Control-Allow-Origin: *`.

## Appendix B: WebFinger (OPTIONAL)

`@user@domain` identifiers resolve via WebFinger (RFC 7033): `GET /.well-known/webfinger?resource=acct:mom@pence.family` returns the identity URL in `aliases` / `rel="self"` links. Clients MUST then fetch the identity document as the authoritative source. Purely a human-friendly aliasing layer; nothing else depends on it.

## Appendix C: Real-Time Updates (OPTIONAL)

JSON Feed 1.1 already defines a `hubs` field for WebSub. Feeds MAY advertise one; subscribers get pushes instead of polling, and MUST still verify item signatures — the WebSub hub is untrusted infrastructure. Nothing Open-Feed-specific is added. Real-time *inbox* notification to one's own clients (SSE, WebSocket) is implementation-specific.

## Appendix D: Test Vectors

All vectors are computed and self-verifying (regenerated for revision 2 with `tmp/regen.cjs`, which validates the canonicalizer against D.2's known SHA-256 and cryptographically self-verifies every `_sig`). Keys are **deterministic, testing-only** Ed25519 keys — not for any real identity.

### D.1. Keys

Identity: `https://test.example/`. Public keys (`x`, base64url):

| `kid` | role | `x` |
|-------|------|-----|
| `test-key-1` | primary | `EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0` |
| `recovery-1` | recovery | `1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk` |
| `test-key-2` | rotation | `KOvPWZT35Xzwcsw6vfQzO3idc8oa67BdHZ0oXpriOQA` |

JWS header for every `_sig` below (signed by `test-key-1`):

```json
{"alg":"EdDSA","b64":false,"crit":["b64"],"kid":"https://test.example/#test-key-1"}
```

base64url (the header segment of each `_sig`):

```
eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0
```

### D.2. Signed Item

Canonical bytes (no `_sig`; `ö` is NFC U+00F6, wave is U+1F44B):

```
{"_feed_url":"https://test.example/feed.json","_version":1,"authors":[{"url":"https://test.example/"}],"content_text":"Hello, wörld! 👋","date_published":"2025-01-15T12:00:00Z","id":"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6"}
```

SHA-256 (hex): `7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168`

`_sig`:

```
eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..MnPQcvR9PB4E_pJ1YZTggDoRwu0_uOcPegHfebTbKpdtzv8k4O8tbLtnk4VNDyjGa3mWLc15wtkMRK7nTVcoDQ
```

### D.3. Manifest

Full published canonical bytes (signed by `test-key-1`, `updated` = 1736899200):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..jeougogRyjJFslTe1xYIqGGJ7kbpccQN59PDKSN1Yd9ghO78rn97mIX0BwwhZGLMZaHw_Zkr9NhF2YlCHRMfAg","feed_url":"https://test.example/feed.json","items":{"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":1},"seq":1,"updated":1736899200,"url":"https://test.example/"}
```

### D.4. Identity Document, seq 1 (genesis)

Full published canonical bytes (this exact string is what seq 2's `prev` hashes):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..znmg27jptvmexlzgMLe5i9IcRU6SErrqZrvtpmmx_eby5uetMAnZx6HaaSarRcoQQB9WtpSJ1dAub5aPi30-Dw","feed":"https://test.example/feed.json","history":"https://test.example/history.json","inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"manifest":"https://test.example/manifest.json","name":"Test Identity","seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Hash (base64url SHA-256, = seq 2's `prev`): `f7lGHylIOM-swVa0Fg8DlFCJ5k-fPCgucLPmXhGQ9ns`

### D.5. Identity Document, seq 2 (rotation)

Adds `test-key-2`, revokes `test-key-1`. Signed by `test-key-1` — the continuity key, valid in seq 1, revoked by the very version it signs, and still listed in it (§5.2):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..Iakri50AKxBHLr2-1MQW0GnVXBmmWL85fjDC9Dv7hSOfkgfmpBQBZEYPp8B4aXXv5pwFuEgg0to8f2AQqaHuBw","feed":"https://test.example/feed.json","history":"https://test.example/history.json","inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","revoked_at":1739577600,"x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1739577600,"kid":"test-key-2","kty":"OKP","x":"KOvPWZT35Xzwcsw6vfQzO3idc8oa67BdHZ0oXpriOQA"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"manifest":"https://test.example/manifest.json","name":"Test Identity","prev":"f7lGHylIOM-swVa0Fg8DlFCJ5k-fPCgucLPmXhGQ9ns","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

**Validation recipe:** verify all four `_sig` values (D.2 item, D.3 manifest, D.4/D.5 identity documents) against `test-key-1`; recompute D.4's full-bytes hash and confirm it equals D.5's `prev`; verify the manifest's `_sig` against `test-key-1` as listed in the (pinned) identity document; confirm the item in D.2 matches the manifest entry `(id, 1)`. The regeneration script `tmp/regen.cjs` performs all of these checks.

## Appendix E: What Was Removed or Merged (vs v0.5.1, and revised in rev 2)

| v0.5.1 construct | Fate | Where it went |
|------------------|------|---------------|
| Profile HTML + `<link>` discovery (§2.2) | **Removed** | Fixed-path identity document; HTML parsing eliminated from the trust chain |
| Profile metadata document (§2.4) | **Merged** | Identity document fields |
| Separate JWKS document (§3.1–3.2) | **Merged** | `keys` in the identity document; `kid` = `{identity_url}#{kid}` |
| Key-ownership check | **Made structural** | Keys live only in the identity's own document; the check is a string comparison |
| Key History Chain on JWKS (§3.7) | **Generalized, then split** | The chain versions the identity document (keys/profile/endpoints); a **separately-signed cumulative manifest** commits the feed. One pinning discipline, two artifacts; publishing advances the manifest, not the chain |
| Feed-omission open question | **Resolved** | Signed manifest (§9) proves presence; `_feed_url` (§7.5) proves exclusivity |
| Recovery attestation / recovery-claim document | **Removed** | Folded into migration: `predecessor` + a recovery-key `_recovery_sig` (§3.4) |
| Interaction objects, types matrix, `x-` types, dual publication, `target`/`target_item`/`source` | **Removed / collapsed** | Items with a `_rel` array; one schema, one verifier; feed and inbox carry the same bytes |
| Outbox endpoint (§7.5) | **Removed** | Your feed is your outbox |
| Webmention (§7.2) | **Removed from core** | Inbox is the sole core delivery path; Webmention returns as a **bridge gateway** (Appendix F), ingesting `_unverified` copies and riding on published h-entry HTML |
| Authorized Fetch (in core) | **Moved to extension** | §11 stub; the restricted-feed token is the only second signing construction and lives outside the core |
| Replies-endpoint envelope | **Simplified** | Returns a JSON Feed (§12) |
| Bespoke relation fields (`_reply_to`, …) | **Unified** | `_rel` array with registered-token-or-URL types (§8) |
| OAuth/IndieAuth, WebSub appendix, `pubkey`/`449`/link-relation registry, Content-Type strictness, timestamp duality | **Removed / reduced** | Out of scope, one paragraph, gone, one rule, JOSE-boundary only |

What deliberately survived unchanged: byte-exact RFC 8785 + I-JSON, RFC 7797 header-covering signatures, author binding, effective signing time, tombstones, conformance levels, the static-hosting story, and the honest hub-trust model.

## Appendix F: Interoperability (Gateways)

Bridges to other protocols are **out of scope for the core but feasible as gateways** — trusted intermediaries, never transparent adapters, because each target protocol has a different trust primitive and no bridge can hold a foreign author's Open Feed key. A gateway may (1) ingest foreign content as an `_unverified` copy (§7.5), (2) sign a claim *about* it under its own identity, or (3) proxy the foreign actor as a gateway-hosted Open Feed identity whose key custody is disclosed. All three are the honest-hub-trust model (§14.2) extended across a boundary; Open Feed's pull-canonical model (§1.3) makes them resumable and drift-free.

- **Webmention / IndieWeb** — cheapest, and half-built: outbound rides on published h-entry HTML; inbound synthesizes `_unverified` items from mf2. No core changes.
- **ActivityPub** — the brid.gy model: a stateful actor proxy polls the feed and fans out `Create`/`Like`/`Announce`, and mirrors AP replies into the inbox. The one convergence seam is **FEP-8b32** (`eddsa-jcs-2022` = Ed25519 over RFC 8785 — the same primitive), where a near-transparent object-level bridge becomes conceivable.
- **atproto** — heaviest: a mirror PDS (DID + DAG-CBOR + MST), no transparent path. The clean identity seam is **did:web ↔ Open Feed URL** (both domain-bound).

## Appendix G: Conventions — Follows and Pins (OPTIONAL)

Two optional documents, both **outside the trust core** (nothing needs to verify them to verify content), referenced from the identity document.

**`follows`** — who you read. Turns "which feeds does my hub poll?" from configuration into protocol (the core operation of the pull-canonical model). Follow lists MAY be kept private (client-local) instead.

```json
{ "follows": ["https://pence.family/~mom/", "https://jessepence.com/"], "updated": "2025-12-07T00:00:00Z" }
```

**`pins`** — `(identity, seq, hash)` observations you have made of others' identity documents or manifests. Publishing them gives a family, with no new cryptography, four properties at once:

1. **Anti-equivocation** — peers cross-check each other's view of a chain automatically, turning §5.3's out-of-band comparison into published data.
2. **Recovery propagation** — a successor claimed via recovery (§3.4) reaches consumers who lost the old pointer, gossiped through the social graph.
3. **Informal timestamping** — a pin observed at wall-clock T is a witnessed lower bound that `(seq, hash)` existed by T (§14.10).
4. **First-contact web-of-trust** — consistent pins from identities you already trust soften TOFU's first-contact weakness.

```json
{ "pins": [ { "identity": "https://jessepence.com/", "seq": 12, "hash": "..." } ], "updated": "..." }
```

This is the family-scale substitute for a transparency log, a DID directory, and a timestamp authority — the highest-value-per-byte extension in the design.

## Appendix H: Open Questions

- **`_rel` type registry governance** — how the registered core token set (vs namespaced URLs) is maintained pre-1.0
- **Key delegation (extension, sketched)** — the highest-value trust upgrade available. A delegation is a statement signed by a root identity key — `{delegate: {JWK}, kid, exp, scope}` — published in the identity document; a hub or extra device holds only the *delegated* key while the root stays client-side or offline. Content signs with the delegate key; verifiers resolve the `kid` to the delegation entry in the pinned identity document and confirm it unexpired and unrevoked. Revoking a delegate is an ordinary chain version — the pinned chain is exactly the authoritative revocation substrate whose absence killed Nostr's NIP-26. This one statement type answers both multi-device *and* hub custody (moving hub deployments from the key-custodian tier to the serving-path tier of §14.2) without adding a second signing construction. To be specified as `open-feed-delegation.md` pre-1.0
- **External time anchoring** — a true transparency log / witness network beyond the family-scale `pins` convention; deferred
- **Export bundle** — signed archive format (identity history + feed + manifest) for backup and migration
- **Bridge profiles** — normative gateway specs for Webmention / ActivityPub / atproto (Appendix F), starting with the Webmention gateway
