# Open Feed Protocol Specification

**Version 0.1.0 — Draft. Unreleased:** this document has had no readers outside its author, and nothing implements it. Version numbers here mark releases, not edits; they begin moving when someone outside this repository can depend on them.

It is a clean-slate design and does not depend on any earlier document. Several prior internal drafts explored a much larger surface; a nine-pass simplification debate collapsed it, and a subsequent **privacy-and-exit pass** set the shape below. Appendix E records what was removed and why. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive.

**What the privacy-and-exit pass settled** — recorded because the reasoning is load-bearing, not because anyone needs to migrate:

- There is **no restricted-feeds mechanism**, and an extension that provided one was removed rather than slimmed. Confidentiality is an optional encrypted-content extension (§11.3); audience control at a single host is host authorization, i.e. software. Appendix E records the reasoning and the test that shows the removal is a real layering.
- Every feed an identity publishes lives in **one `feeds` array** of `{url, manifest?, rel}` entries (§3.2.1), with `manifest` OPTIONAL — not in separate `feed` / `manifest` fields.
- `history` is an **index** of `(seq, hash, url)` rather than a container of full prior versions (§5.4); prior versions are served individually.
- Attachment `_sha256` is a **MUST** (§7.4).
- Tombstones are defined by an **allowlist** of retained fields (§7.3).
- **§15 Export and Exit** exists, answering the fourth adversary tier in §14.2.

## Abstract

Open Feed is a protocol for decentralized publishing and interaction. An identity is an HTTPS URL that serves **one signed identity document** — profile, keys, endpoints, and a tamper-evident chain of its own versions. Content is published as signed JSON Feed items; a **separately-signed, chained manifest** commits the feed's contents so a host cannot silently drop, reorder, or roll them back. Interactions (replies, likes, reposts, quotes, mentions) **are** feed items carrying a `_rel` relation array, delivered by POSTing the signed item to the recipient's inbox.

The protocol is a few conventional documents and one endpoint:

```
https://pence.family/~mom/               ← identity URL (human page, optional)
https://pence.family/~mom/openfeed.json  ← identity document (signed: profile + keys + chain)
https://pence.family/~mom/feed.json      ← JSON Feed 1.1, signed items
https://pence.family/~mom/manifest.json  ← signed, chained commitment to the feed's contents
https://pence.family/~mom/inbox          ← POST signed items here (Level 3 only)
```

plus, for each chain, the retained prior versions and a small **history index** naming them, referenced from the document it versions.

Built on four standards and nothing else: **HTTPS**, **JSON Feed 1.1**, **JOSE** (JWK/JWS/JWT, RFC 7515/7517/7519/7797), and **JSON canonicalization** (RFC 8785 + I-JSON RFC 7493).

Open Feed is a **transparency** protocol: it makes publication tamper-evident, and it is deliberately not private (§1, principle 7). What it offers anyone who needs to leave the host serving them is a portable identity, a recovery key that host never held, and a complete signed copy of their own content (§3.4, §4.5, §15).

## 1. Design Principles

1. **Identity in one signed document; content in one signed manifest.** Everything a verifier needs about an identity — its keys and its endpoints — is in one signed JSON document at one conventional path. What content that identity has published is committed by one separately-signed manifest. Both are chained and pinned by the same discipline (§5, §9); neither requires HTML parsing, link-relation discovery, or a cross-document key-ownership check.
2. **One object model.** A like is an item. A reply is an item. There is exactly one signed schema for content, one update mechanism (versioning), one delete mechanism (tombstones), and one verifier.
3. **The feed is the source of truth; the inbox is a push cache.** Delivery makes things fast; polling the signed feed makes them complete. Nothing exists only in transit.
4. **Convention over configuration.** Fixed paths (`openfeed.json`, `manifest.json`). One relation array. Prefix rules for extension fields; a small registered vocabulary (plus namespaced URLs) for relation *types*.
5. **Byte-exact signing, one construction.** Documents are signed as published bytes (RFC 8785) with a single detached-JWS construction (§6). No verify-time normalization, no remote contexts, no second signing scheme anywhere — not in the core and not in any extension. Encryption (§11.3) is not a second construction: it changes what the content *is*, not how it is signed.
6. **Honest trust model.** Hubs that hold keys can impersonate their users, like email providers can. This is documented, not hidden. Client-side keys are supported for those who want them; the two chains defend against a *host* that turns malicious, which is a distinct threat from a *key custodian* (§14.2).
7. **Transparency, not privacy — and an exit instead.** Open Feed makes publication **tamper-evident**. It does not make it private, and several of its core mechanisms are deliberately hostile to privacy: history is retained permanently and served (§5.4, §9.2), every public document carries `Access-Control-Allow-Origin: *` (§3.3), deletions leave a durable public record (§9), documents are single-valued by design, and deletion itself is best-effort (§7.3). These are the properties that make equivocation detectable; they are the same properties that make forgetting impossible. Content confidentiality is an OPTIONAL extension (§11) and is only ever as strong as the recipient's key custody. What the core does offer anyone who needs to get away from their host is **exit** — a portable identity (§3.4), a recovery key the host never held (§4.5), and a complete signed copy of your own content (§15). If you are choosing this protocol because you need something kept secret, read §14.2 first.

## 2. Terminology

RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

- **Identity**: an HTTPS URL controlled by a person or group.
- **Identity document**: the signed JSON document at `{identity_url}openfeed.json`.
- **Item**: a JSON Feed item, signed, the universal content object.
- **Relation item**: an item carrying a `_rel` array (§8) — what other protocols call an interaction.
- **Manifest**: the separately-signed, chained document committing to a feed's item set (§9).
- **Chain**: a hash-linked sequence of versions of a document (identity document, §5; or manifest, §9).
- **Pin**: a consumer's stored `(seq, hash)` observation of an identity document or a manifest.

### 2.1. Token Vocabularies

Several fields take a value from a small registered set that must also stay open to extension. They all follow one rule, stated here once:

> A **token-vocabulary value** is either a registered token from the set this specification defines, **or** an absolute URL naming a custom value (`https://example.com/ns#bookmark`). Consumers MUST preserve values they do not recognize and MUST NOT reject a document for carrying one; they MAY ignore them.

URL namespacing is collision-free without a registry, which is why custom values are URLs and not bare strings. This mirrors HTML link relations. It applies to `_rel[].type` (§8), feed `rel` (§3.2.1), and key `use` (§4.1).

Note the contrast with extension **fields**, which use a `_` prefix (§3.2) and are *not* collision-free. Relation types and feed roles are values, not field names, precisely so they can be namespaced properly.

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
  "feeds": [
    { "url": "https://pence.family/~mom/feed.json", "manifest": "https://pence.family/~mom/manifest.json", "rel": "primary" },
    { "url": "https://pence.family/~mom/activity.json", "rel": "activity" }
  ],
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
| `keys` | MUST | Array of JWKs (§4). At least one non-revoked, non-recovery key. |
| `seq` | MUST | Version counter, starts at 1, strictly increasing (§5). Advances on **identity** changes (keys, profile, endpoints, migration) — *not* on content publication. |
| `updated` | MUST | Publication time of this version (Unix seconds). |
| `_sig` | MUST | Detached JWS over the document (§6). |
| `prev` | MUST if `seq > 1` | Base64url SHA-256 of the full canonical bytes of the previous version, including its `_sig` and `_recovery_sig` if present. |
| `history` | MUST if `seq > 1` | URL of the version history **index** (§5.4). |
| `feeds` | SHOULD (MUST for Level 2) | Array of feed entries (§3.2.1). Every feed this identity publishes, primary and additional, in one place. |
| `inbox` | MAY (MUST for Level 3) | Inbox endpoint URL. |
| `replies` | MAY | Replies-endpoint URL (§12). |
| `follows`, `pins` | MAY | URLs of the follow list / observed-pins document (Appendix G). Outside the trust core. |
| `name`, `bio`, `avatar`, `content_warning` | MAY | Profile metadata. `content_warning`, if present, marks all content from this identity as sensitive. |
| `successor`, `predecessor` | MAY | Migration links (§3.4). |
| `_recovery_sig` | MAY | Recovery co-signature for fork resolution (§5.5). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise. Extension fields SHOULD use a `_` prefix.

#### 3.2.1. Feed Entries

Each entry in `feeds` is an object:

| Key | Required | Description |
|-----|----------|-------------|
| `url` | MUST | The feed's URL (JSON Feed 1.1, §7.1). |
| `manifest` | SHOULD | URL of that feed's own signed manifest (§9). OPTIONAL — see below. |
| `rel` | SHOULD | What this feed is, from the token vocabulary (§2.1): `primary`, `activity`, or a namespaced absolute URL. Default `primary`. |

Rules:

- **Exactly one entry SHOULD carry `rel: "primary"`**, and that entry is the identity's authoritative feed — the one a consumer reads when it wants "this identity's content." Array order is display preference only and carries no authority.
- **Each feed has its own manifest.** Manifests are keyed by `feed_url` (§9); one manifest never commits two feeds.
- **`manifest` is OPTIONAL, and omitting it is a real trade.** A feed with no manifest has **no completeness proof**: a host can drop items from it undetectably, and §9.4's invariants do not apply to it. This is intended for feeds carrying only content-less relation items (§8) — an activity feed of likes and reposts, where the anti-omission proof is not worth a second chain advancing on every reaction. It is a property of the **feed**, not of individual items: a manifested feed commits *everything* in it, so §9.4 invariant 3 stays a bright line rather than a per-item judgment. A publisher who wants the proof for their reactions simply publishes the activity feed with a manifest.
- **A manifest-less feed carries no liveness authority, ever.** §7.5 tells consumers to consult the manifest at an item's `_feed_url` to learn whether it is live or deleted; where there is no manifest there is nothing to consult. Consumers MUST NOT cache an item from a manifest-less feed as live, and MUST treat retraction as conveyable only by inbox tombstone (§8.2). A consumer that never saw the retraction cannot learn of it — state this to users rather than papering over it.

Note that the identity document commits to each manifest by **URL**, not by hash. Content freshness is proven by the manifest's own signature and chain (§9), so ordinary publishing does **not** re-sign or re-version the identity document. The identity chain versions identity state, which changes rarely (5–20 versions over a lifetime); the manifest chain versions content, which changes often. Two chains, one pinning discipline.

Every identity document is signed and versioned — there is no unsigned or unchained mode. Verification is trust-on-first-observation (§5.3): the signature proves continuity between versions, not first-contact authenticity.

### 3.3. Fetching and Redirects

When fetching an identity document:

- Follow at most 5 redirects
- MUST NOT follow a redirect to a different origin
- The response MUST parse as JSON; reject `text/html` or any non-JSON Content-Type; accept `application/json`
- The response MUST carry `Access-Control-Allow-Origin: *` (§13); this applies to every publicly-readable document, so browser Level-1 readers work without a proxy

A cross-origin redirect is never identity equivalence. Migration is expressed in-band (§3.4), not with redirects. Same-origin redirects (trailing slash, path moves) are followed normally.

### 3.4. Migration and Recovery

Migration and recovery are one operation — *this identity continues over there* — differing only in **which key attests**. There are three occasions for it, not two: you move hosts by choice, you lose your domain, or **you leave a host that will not cooperate** (§15). The third is the one the mechanism has to be judged against, because it is the only one where the other party is adversarial.

To move from `https://old.example/~alice/` to `https://alice.new/`:

1. Establish the new identity (new identity document, new or same keys), adding `"predecessor": "https://old.example/~alice/"`.
2. **Cooperative migration** (old domain still under control): the old identity document publishes a new chain version adding `"successor": "https://alice.new/"`. Consumers follow `successor` when both links exist and agree — each is inside a signed document, so the pair is a cryptographic cross-signature verifiable against the old identity's pinned chain.
3. **Recovery** (old domain lost): the new identity document additionally carries a `_recovery_sig` — a detached JWS by a **recovery key** (§4.5) that was committed in a pinned ancestor of the predecessor. A consumer holding a pin of the old identity verifies the co-signature against that recovery key and follows `predecessor` even though the old side can no longer publish a `successor`.

Migration makes the new feed canonical for *new* content, but previously-published items carry the old feed's URL in their signed `_feed_url`, so at the new home they would be mere copies (§7.5). The migration procedure therefore ends with **bulk re-signing**: republish the back catalog at the new feed — same `id`s, bumped `_version`, `date_modified` set to the re-signing time, `_feed_url` naming the new feed — and commit it all in the new feed's manifest. A verified migration is the sole exception to the id/feed binding rule (§7.5): the binding follows the identity to its successor feed. Consumers that verified the migration treat the re-signed versions as superseding the predecessor's.

A consumer that has **not** verified the migration will see the same `id` presented as canonical at two feeds — the old one (lower `_version`, old `_feed_url`) and the new one (higher `_version`, new `_feed_url`). It MUST treat the higher-`_version` copy as *unverified pending migration verification*, not as an equivocation to reject, and reconcile once the `successor`/`predecessor` pair (or the recovery co-signature) verifies against a pin. This is the one situation where the same `id` legitimately carries two live `_feed_url` values, and it resolves the moment migration is confirmed.

A `successor` claim without a matching `predecessor` (or vice versa), and unaccompanied by a valid recovery co-signature, MUST NOT be treated as migration. Consumers without a prior pin of the old identity can only treat a recovery-based migration as unverified (out-of-band confirmation recommended); Appendix G's `pins` convention is how a family propagates such a claim through its social graph. Recovery handles *domain loss*; it does not protect against theft of the recovery key itself.

There is no separate "recovery claim" or "recovery attestation" document: the chained identity document — signed by an active key, carrying `predecessor`, and co-signed by a committed recovery key — *is* the attestation.

**Uncooperative departure.** Path 2 requires the old side to publish a `successor`, so it is unavailable against a host that declines — and a host that holds your signing key can equally publish a `successor` you did not ask for. Path 3 is therefore the exit path, and it works against an uncooperative host **without that host's participation**, on one condition: the recovery key must be one the host cannot produce (§4.5). Where that condition holds, a departing user re-establishes their identity elsewhere, co-signs with the recovery key committed in a pinned ancestor, and every consumer holding a prior pin follows them. Where it does not hold, there is no exit — the operator can sign a competing branch with equal standing, and §5.5 fork resolution cannot separate them.

Departure does not retract what was published. Items already served from the old feed remain signed and verifiable there, and the old host may keep serving them; the successor feed's re-signed catalog (above) is what consumers who verified the migration treat as current. Taking a *copy* of your content with you is the export bundle's job, not migration's (§15).

## 4. Keys

### 4.1. Key Entries

Keys are JWK objects (RFC 7517) in the identity document's `keys` array:

| Field | Required | Description |
|-------|----------|-------------|
| `kid` | MUST | Key ID, unique within this identity, MUST NOT contain `#` |
| `kty` | MUST | `OKP` |
| `crv` | MUST | **Signing keys**: `Ed25519` |
| `x` | MUST | Base64url public key (32 bytes) |
| `iat` | SHOULD | Issued-at (Unix seconds) |
| `revoked_at` | MAY | Revocation time (Unix seconds). Absent or `null` = active. |
| `use` | MAY | **Signing keys**: `sig` (default) or `recovery` (§4.5) |
| `alg` | MAY | If present, `EdDSA` |

A **signing key** is any key referenced by the `kid` of a `_sig` (§6.2) — that is, every key this specification defines. The `crv` and `use` constraints above bind signing keys only; extensions MAY define keys with other `crv`/`use` values in the same array.

Implementations MUST ignore keys with unrecognized `kty`/`crv`/`use` (future algorithms and extension key types slot in additively). Two consequences worth stating plainly:

- Algorithm confusion is already closed: §6.2 requires verifiers to reject any signature whose referenced key's `crv` is not `Ed25519`, so a non-signing key can never be pressed into service as a signing key.
- A key the core ignores is a key the core does not **audit**. Its presence in a signed, chained document is transparent (adding it advances the chain, §5) but no core verifier ascribes it meaning. An extension that defines such a key MUST state who checks it and what a revocation of it means.

Timestamp convention: key and chain fields use Unix seconds (JOSE convention); content fields use ISO 8601 strings (JSON Feed convention).

### 4.2. Key Identifiers

The full key identifier used in JWS headers is:

```
{identity_url}#{kid}
```

e.g. `https://pence.family/~mom/#key-1`. Verifiers split at the **last** `#`: the left side is the identity URL (normalize it; normalization strips fragments, so the split happens first), the right side is the `kid` to find in that identity's document.

Because keys live *in* the identity document, key ownership is structural: the identity named by the `kid` either lists the key or it doesn't. There is no separate ownership check, and possession of a key that merely *verifies* proves nothing about any identity.

### 4.3. Rotation

1. Publish a new chain version (§5.2) adding the new key
2. Sign new content and manifests with the new key
3. Optionally set `revoked_at` on the old key in the same or a later version

Rotated-out keys SHOULD remain listed for at least 30 days (verification of old content). A key MUST remain listed in any chain version whose `_sig` it produces (§5.2).

### 4.4. Revocation

- Signatures on content whose effective signing time (§6.5) is after `revoked_at` MUST be rejected; before, they remain valid.
- Because content timestamps are self-reported, a key thief can backdate. For inbox-delivered items, receivers SHOULD apply the revocation check against **receipt time**, which the sender cannot backdate. Revocation limits damage from honest rotation far more than it stops an active thief (§14.10).
- The pull path has a receipt-time analog. Consumers SHOULD record the wall-clock time each item id was **first observed** in a signed manifest (one timestamp alongside the manifest pin, §9) and apply the revocation check against that first-observed time. A thief can backdate an item's `date_published`, but cannot backdate when a consumer's polling loop first saw a manifest commit to it — a "years-old" item first entering the manifest after `revoked_at` is rejected. (Consumers with no observation history for an identity fall back to the self-reported check; first contact is TOFU here as everywhere, §5.3.)

### 4.5. Recovery Keys

A key with `"use": "recovery"`:

- MUST NOT sign regular content or manifests
- MUST be stored offline (not on the hub)
- SHOULD be generated at identity creation
- Co-signs a migration for domain-loss recovery (§3.4) and MAY co-sign a chain version for fork resolution (§5.5)

Because recovery keys are committed in the chain, any consumer holding a pin can verify a later recovery-based migration or fork resolution against the recovery key present at a pinned `(seq, hash)`.

Verifiers MAY reject a recovery-based migration while the original identity serves a **conflicting** chain — one that advances with its own `successor` claim, or otherwise contradicts the migration. They MUST NOT reject it merely because the original identity is *still being served*. The distinction matters: an uncooperative departure (§3.4) is exactly the case where the old host keeps serving an unchanged chain and simply declines to acknowledge the move. Treating "still reachable" as grounds for rejection would hand a hostile custodian a veto over their user's exit by doing nothing at all.

Where both sides do advance with contradictory claims, that is a fork, and §5.5 governs: prefer the branch carrying a valid recovery co-signature. A custodian that never held the recovery key cannot produce one, which is the whole point of the generation rule below.

**Generation and possession.** Where the recovery key is stored is not the whole rule; **who generates it and who has ever held it** is the rule that matters. A recovery key generated by the host and handed to the user is not a check on the host — the host retains the ability to produce it, and every guarantee below collapses.

Therefore: a Level 3 implementation hosting identities on behalf of others MUST provision each hosted identity with a recovery key **generated on the member's own device and never transmitted to the host**. The host receives the public JWK to commit in the chain and nothing else. Where a deployment's onboarding cannot meet this (a purely server-side signup, say), it MUST disclose to the user that the operator can reproduce their recovery key, because that user has no exit (§15).

This one requirement is what turns recovery from a *domain-loss* feature into an *exit* mechanism (§3.4, §15). It is the difference between "your host went away" and "your host will not let you leave."

## 5. The Version Chain

The identity document is served over TLS, but a compromised host or hijacked domain could roll back to an older version (un-revoking a key) or serve different versions to different readers. The chain makes both tamper-evident to any consumer who has seen the identity even once.

The chain versions **identity state** — keys, profile, endpoints, migration links. Content freshness is protected separately, by the same mechanism, by the signed manifest chain (§9): a consumer pins the manifest exactly as it pins the identity document. Splitting the two means ordinary publishing advances the manifest chain, not the identity chain, so the identity chain stays short (5–20 versions over a lifetime) regardless of how often content is posted.

### 5.1. Chain Fields

`seq`, `prev`, `updated`, `_sig` (and optionally `_recovery_sig`), as defined in §3.2. `prev` hashes the *full published canonical bytes* of the predecessor — including its signature fields — so byte-preserving storage of old versions is the simplest correct implementation.

### 5.2. Producing a Version

1. Start from the current version; apply changes (keys, profile, endpoints, migration links)
2. `seq` += 1; `prev` = hash of the previous version; set `updated`
3. Sign with a **continuity key**: a key that was valid (non-revoked, non-recovery) in the *previous* version
4. Publish the previous version at its own URL and append its `(seq, hash, url)` entry to the history index (§5.4)
5. **Record the `(seq, hash)` of the version just produced**, and make that record available to the identity's owner

Step 5 exists because §14.2's transparency claim assumes an auditor it never names. Equivocation is *detectable* only by someone who compares — and the party with the strongest interest in comparing is the identity itself, which cannot compare without a record of what it actually published. Where the signing key is held by a host on the user's behalf, this record is the user's only means of noticing a version they did not ask for. It is not sufficient on its own: a host that knows which client belongs to the owner can serve that client the honest branch. The durable check remains cross-observer comparison by *other people* (§5.3, and the `pins` convention, Appendix G).

The continuity key is often revoked *in the very version it signs* — that is normal rotation. Validity is judged against the previous version's state. The continuity key MUST remain listed in the version it signs (else the version cannot be verified from its own bytes); it MAY be dropped in later versions. Genesis (`seq: 1`) has no predecessor and is signed by a non-revoked key it contains.

### 5.3. Consumer Enforcement (Pinning)

A consumer that has verified an identity document at `(seq: N, hash: H)` MUST store that pin. On any later fetch:

1. Verify the new document's `_sig`; the signing key named by its `kid` MUST be listed in the document itself
2. Walk `prev` links back to `(N, H)`, fetching the intermediate versions from the URLs given in the `history` index (§5.4) — these MAY be fetched in parallel, since the index names them all at once. At each hop, verify that version's `_sig`, confirm its bytes hash to the value its successor's `prev` names, and confirm its signing key was valid in *its* predecessor — hash linkage alone is not sufficient, since a fabricated intermediate could introduce an attacker's key
3. Reject if `seq` decreased, if any `prev` mismatches, or if two documents claim the same `seq` with different hashes (equivocation)

The consumer separately pins the **manifest** at its own `(seq, hash)` and walks it by the identical procedure (§9.1). The identity chain and the manifest chain are two applications of one mechanism: pin on first observation, walk `prev` to the pin on every later fetch, treat any divergence as an attack.

First contact is TOFU: accept and pin. Tampering is detectable from the second observation onward, or immediately for any two consumers comparing pins out-of-band. A consumer that cannot connect its pin to the current document (missing history) MUST treat the chain as unverifiable rather than silently re-pin.

### 5.4. History

Producers MUST retain all prior versions of a chained document, serve each at its own URL, and serve an **index** of them at the `history` URL:

```json
{
  "url": "https://pence.family/~mom/openfeed.json",
  "versions": [
    { "seq": 1, "hash": "f7lGHylIOM-swVa0Fg8DlFCJ5k-fPCgucLPmXhGQ9ns", "url": "https://pence.family/~mom/openfeed/1.json" },
    { "seq": 2, "hash": "aNy3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0", "url": "https://pence.family/~mom/openfeed/2.json" }
  ]
}
```

The index is an ordinary unsigned JSON document — it needs no signature, because every entry it points at is signed and every `hash` is checked against the chain the consumer is already walking. A lying index cannot forge a version; it can only fail to lead somewhere useful, which the walk detects.

Rules:

- `versions` MUST be in ascending `seq` order, MUST cover every retained version, and each `hash` MUST be the base64url SHA-256 of that version's **full published canonical bytes** — the same value its successor carries in `prev`.
- Each `url` MUST be **same-origin** with the document the index versions. A consumer walking a chain follows these URLs, so they are an outbound-fetch vector and get the §3.3 / §14.5 discipline.
- Prior versions MUST be served **byte-identically** to how they were published. Storing them as static files at their own URLs is the natural implementation and is why this shape was chosen.

**Why an index and not a container.** Earlier drafts served the full text of every prior version in one document. Two problems: a manifest version embeds its whole `items` map (§9), so a manifest history is O(versions × items) and the producer rewrites the entire document on every publish; and a consumer one version behind had to fetch the identity's entire history to obtain it. An index is O(versions) small, append-only to write, and lets a consumer fetch exactly the versions it lacks — in parallel, since one fetch reveals every URL.

**Why an index and not a `prev_url` inside each version.** Putting the retrieval URL in the signed bytes would remove the index entirely, and it was rejected: signed bytes are immutable, so a publisher who ever moves hosts would retroactively and unfixably break the walk for every consumer whose pin predates the move. `history` is a field of the *current* document, so rehosting updates it and everyone's walk keeps working. It also keeps checkpoint retrieval (§9.3) possible and preserves atomic third-party auditing — an auditor fetches one index to learn a chain's whole shape.

Consumers SHOULD cap the versions walked per update (RECOMMENDED: 1000) and the total history bytes fetched (§14.4).

### 5.5. Fork Resolution

Equivocation detection reveals *that* the chain forked, not *which* branch is honest — after key theft, both branches carry valid continuity signatures. A version MAY carry `_recovery_sig`: a second detached JWS by a recovery key committed in a pinned ancestor. `_sig` and `_recovery_sig` are each computed over the canonical document with **both** signature fields removed.

A thief of the online key cannot produce `_recovery_sig` (the recovery key is offline). Verifiers detecting a fork SHOULD prefer the branch carrying a valid recovery co-signature; a fork where neither branch has one is unresolvable and SHOULD be flagged for manual review. Producers SHOULD co-sign the first version published after a suspected compromise.

## 6. Signatures

### 6.1. Format

Detached JWS Compact Serialization with **unencoded payload** (RFC 7515 + RFC 7797):

```
base64url(header)..base64url(signature)
```

The payload is the canonical JSON bytes (§6.3). The JWS Signing Input is:

```
ASCII(BASE64URL(UTF8(header)) || '.') || canonical-json-bytes
```

The signature covers **header and payload**. Signing only the payload bytes MUST NOT be done — it leaves `alg` and `kid` unauthenticated, letting an attacker swap the referenced key.

This is the **only** signing construction, in the core and in every extension. It signs identity documents, items, and manifests identically. An extension that needs a second one is evidence the design is wrong, not that the rule needs an exception.

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
2. Parse header; enforce §6.2
3. Split `kid` at the last `#` → identity URL + key id
4. **Author binding**: the `kid` identity URL MUST equal the claimed author (§6.6) after normalization. Reject otherwise.
5. Fetch the identity document at `{identity_url}openfeed.json`; enforce pinning (§5.3); find the key
6. If the key has `iat`: verify it predates the content's **effective signing time** — for items, `date_modified` if present else `date_published`; for manifests and identity documents, `updated`. (No `iat` → skip.)
7. Verify the key was not revoked before the effective signing time
8. Verify the Ed25519 signature over the reconstructed Signing Input

The effective-signing-time rule lets content be legitimately re-signed after rotation: bump `_version`, set `date_modified` to the actual signing time, keep `date_published`.

### 6.6. Author Binding

Every signed document carries its author's identity URL **inside the signed bytes**:

- **Items**: the item-level `authors` array MUST contain **exactly one entry**, whose `url` is the signer's identity URL. (Feed-level `authors` are not covered by item signatures and MUST NOT be relied on. A multi-author *feed* still works — every item names its own single author.) Clients MUST attribute solely to this entry; they MUST NOT display any other self-asserted author name. Bridged content is not an exception: an ingested item is signed by its gateway, so the gateway (or a proxy identity it operates) *is* the author here, and the foreign author is named by that proxy's own identity document rather than by a second entry (§7.5, Appendix F.3).
- **Manifests**: the `url` field (the identity that owns the feed).
- **Identity documents**: the `url` field.

The claimed author MUST equal the `kid`'s identity URL. This prevents republishing someone's signed **item** under a different name: the binding travels with the bytes.

Note the limit of that guarantee. It covers what the item carries **by value** — the bytes the signature is computed over. It does not and cannot cover what the item carries **by reference**: anyone may put someone else's attachment URL, or a copy of their text, into their own freshly-signed item. That is ordinary plagiarism, no protocol prevents it, and `_sha256` (§7.4) proves only that the referenced bytes are the ones the signer meant — not that the signer produced them.

Items MUST also include `_feed_url` (the containing feed's URL) in the signed payload when served in a feed; this drives the canonical/copy rule (§7.5). Inbox-only items omit it (§8).

## 7. Feeds and Items

### 7.1. Feed Document

A feed MUST conform to JSON Feed 1.1. Content-Type `application/feed+json` or `application/json` (reject non-JSON; the check exists to avoid parsing HTML error pages, not to police vendor types — static hosts serve `application/json` and MUST be accepted). Like every public document, a feed MUST be served with `Access-Control-Allow-Origin: *`.

Required: `version`, `title`, `feed_url`, and `items`. Feed-level `authors` MAY be present for display; they carry no authority.

A feed is owned by the identity whose identity document lists it in `feeds` (§3.2.1), and its contents are committed by the manifest that entry names (§9) — if it names one. Feeds MAY contain items from multiple authors (family boards); every item is independently signed and attributed by its own signed single-entry `authors`.

### 7.2. Items

Every item MUST include:

| Field | Description |
|-------|-------------|
| `id` | Globally unique, permanent (UUID URN or tag URI RECOMMENDED). MUST NOT contain `#` — ids appear as URI fragments in relation references (§8) |
| `date_published` | ISO 8601 |
| `authors` | Single-entry author binding (§6.6) |
| `_feed_url` | The containing feed's URL (MUST for feed-served items; omitted only for inbox-only items) |
| `_version` | Integer, starts at 1 |
| `_sig` | Detached JWS (§6) |

plus at least one of `content_text` / `content_html`. A content-less relation item (a `like` or `repost`, §8) satisfies this with `content_text: ""`, exactly as a tombstone does (§7.3) — JSON Feed 1.1 requires a content field to be present, so "NONE" in the §8 relation table means no *displayable* content, not an absent field. Consumers MUST preserve unknown `_` fields; signatures depend on it. A relation item additionally carries `_rel` (§8).

### 7.3. Versioning and Tombstones

To edit: bump `_version`, set `date_modified`, re-sign. Same `id` forever; `(author, id, _version)` names an exact signed revision. Feeds carry only the latest version.

To delete: publish a **tombstone** — same `id`, bumped `_version`, `date_modified` set, `_deleted: true`, re-signed.

A tombstone MUST contain **exactly** these fields and no others:

`id`, `authors`, `date_published`, `date_modified`, `_version`, `_deleted`, `_sig`, `content_text: ""`, plus `_feed_url` and `_rel` **if and only if** the item being tombstoned carried them (an inbox-only item has no `_feed_url`, §8).

Every other field — standard JSON Feed (`title`, `summary`, `content_html`, `image`, `banner_image`, `tags`, `url`, `external_url`, `attachments`, …) and every extension field — MUST be absent. This is an allowlist on purpose: a denylist naming only the content fields known today would let a conformant tombstone retain a title, a tag, or an extension payload that carries the very thing the author deleted, and would need editing for every future content type. Retained fields are exactly those needed to verify the tombstone and route it: authorship, identity, ordering, and relation targets.

Consumers seeing a valid tombstone SHOULD drop cached content and retain the tombstone (higher `_version` wins over any replayed earlier revision). Tombstones SHOULD stay in the feed for ≥30 days; the manifest remembers them until folded into a checkpoint (§9). Deletion is best-effort — consumers that never re-fetch can't be forced, and attachment *bytes* referenced by the deleted revision are removed by the host, not by the tombstone (§7.4).

### 7.4. Attachments and Pagination

Attachments use JSON Feed's `attachments`: the metadata is inside the signed bytes, the referenced bytes are not. Each attachment entry MUST carry `_sha256`, the base64url SHA-256 of the referenced bytes, and consumers MUST treat an attachment lacking one as unverified content (§10.5) — never as part of the signed record.

This is a MUST rather than a SHOULD because of what §14.2 claims. Against a serving-path compromise the chain and manifest are said to give **full integrity**; that holds only for bytes the signature covers. An attachment referenced without a hash sits outside the envelope entirely, so whoever controls those bytes — including the host — can swap the photo under a signed item and nothing detects it. For a media-first deployment that is the largest integrity gap available, and one required field closes it.

Pagination uses JSON Feed's `next_url`; feeds SHOULD carry at least the 50 most recent items.

### 7.5. Canonical and Copied Items

An item is **canonical** only in the feed its signed `_feed_url` names. The same signed item may legitimately appear elsewhere — a family aggregate feed, a follower's cache, a bridge — as a **copy**. Because the signature travels with the bytes, a copy is still verifiable as *authored* by its signer. But a copy carries **no authority over current publication state**: it does not prove the item is still live, is not evidence of manifest membership, and cannot resurrect content the author has tombstoned.

Rules:

- A consumer MUST verify an item's `_feed_url` matches the feed URL it was fetched from (after normalization) before treating it as canonical. A mismatch marks the item a copy — display it (e.g. "via …"), attribute it to its signer, but do not grant it liveness or manifest standing.
- To determine whether a copied item is currently live or deleted, consult the manifest at its `_feed_url` (§9). The canonical manifest is authoritative; a copy cannot override a tombstone recorded there.
- An `id` is permanently bound to a single `_feed_url`. The same `id` MUST NOT be signed with two different `_feed_url` values: the bytes would differ while `(author, id, _version)` claims to name one exact revision (§7.3), and inbox dedup (§10.3) would silently drop one variant. Cross-posting the same content to another feed (one's own feed *and* a family board, say) uses a **new item** with a fresh `id` carrying a `repost` or `quote` relation to the original. (A verified migration is the sole exception: §3.4's bulk re-signing moves the binding to the successor feed.)

Together with the manifest this closes both omission and injection: the manifest proves **presence** (a host can't drop your content), and `_feed_url` proves **exclusivity** (a host can't inject or resurrect your content by copying it into its own feed). It also gives availability for free — a follower may serve its cached copy of your feed when your host is down, and it still verifies.

**Bridged and unverified items.** Content ingested from another protocol (ActivityPub, Webmention/IndieWeb, atproto, Nostr — Appendix F) cannot be a native signed item, because no one holds the foreign author's Open Feed key. It is therefore signed by the **gateway** that observed it, and:

- It MUST carry `_unverified: true`. There is **no exception and no second form.** Nothing that crosses a protocol boundary is natively authentic, precisely because no bridge holds a foreign author's key; a gateway presenting ingested content any other way is making a claim it cannot support. §10.5 governs how such content is displayed.
- Its `authors` entry names the **signer** — the gateway, or a proxy identity the gateway operates — per §6.6, never the foreign author, who signed nothing here. Naming the foreign author is what proxy identities are for (Appendix F.3).
- It SHOULD carry `external_url` naming the foreign original. On an `_unverified` item this MAY be a non-HTTP URI (`nostr:note1…`, `at://did:plc:…`), since not every protocol identifies objects with URLs. Consumers MUST NOT dereference it; §14.5's fetch discipline governs anything they do dereference.

This is the same honest-hub-trust model (§14.2) extended across a protocol boundary.

Ingest is only half of a bridge, and a gateway publishes other people's content in **both** directions. Appendix F.2 states the rule that governs it — *a gateway may not change the terms under which content was published* — of which §11.1.1 is the case the core enforces directly: a delivered-only item, one with no `_feed_url`, MUST NOT be emitted to a foreign network.

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
| `root` | Thread root of a nested reply; accompanies `reply` (§8.1) | (governed by `reply`) |
| `like` | Endorsement of the referenced item | NONE (add `_emoji` to the entry for reactions) |
| `repost` | Share of the referenced item | NONE |
| `quote` | Quote of the referenced item | REQUIRED |
| `mention` | Mentions the referenced identity | REQUIRED |

Entry shape:

- **`type`** — a registered token from the table above **or** an absolute URL for custom relations (`"type": "https://example.com/ns#bookmark"`). This mirrors HTML link relations: a small registered vocabulary plus permissionless namespaced URIs. Namespacing by URL is collision-free; the `_` field convention is not, which is why relation *types* are values, not field names.
- **`to`** — a single target URI. For items: `{feed_url}#{item_id}` (RECOMMENDED — receivers resolve relevance structurally by splitting at the last `#`, unambiguous because ids never contain `#`, §7.2) or the target's permalink `url` (which forces receivers to recognize their own permalinks — workable for hubs, fuzzier for anyone else). For `mention`: the mentioned identity URL. Multiplicity is expressed with **multiple entries**, never an array in `to` (so a reply that mentions two people is three entries).
- Entries are **open objects**: unknown keys MUST be preserved. This is where per-relation extension and bridge round-trip data live (`_emoji` on a `like`; a foreign activity id on a bridged `reply`).

Custom-typed entries follow the same shape; receivers store unknown types and MAY hide them. Clients SHOULD NOT render content-less relation items (`like`, `repost`) as posts; they are activity. Publishers SHOULD segregate content-less relation items into a separate **activity feed** — a `feeds` entry with `rel: "activity"` (§3.2.1) — rather than the primary feed. This keeps the primary feed clean for Level 0 readers (a plain feed reader would otherwise render bare likes as posts) and keeps the primary manifest, where every id lives (§9), from being dominated by likes. An activity feed MAY omit its `manifest`, trading the completeness proof for not advancing a second chain on every reaction; §3.2.1 states exactly what that costs.

Interaction items live in their author's feed like any other item (SHOULD — they MAY be inbox-only, in which case `_feed_url` is omitted). One object, one signature: publishing it and delivering it are the same bytes, so there is nothing to keep in sync.

### 8.1. Threading

A `reply` entry's `to` points at the **parent** — a post, or another reply item (in the parent author's feed). When the parent is not itself the thread root, the item SHOULD also carry a `root` entry pointing at the thread root. Without it, deep replies never reach the conversation's host: inbox relevance (§10.2) is judged per `_rel` entry, so a reply-to-a-reply references only the parent's author, and the root author's inbox would reject it as `not_relevant` — the person hosting the thread would be the one who can't see it. Because the relevance check is type-agnostic, `root` entries are honored even by receivers that predate the type. Senders SHOULD deliver a nested reply to both the parent author's and the root author's inboxes.

Threads are trees built by walking parents; clients display flat or nested and SHOULD cap walk depth (loops are possible in malicious data; treat re-visited references as leaves). The replies endpoint (§12) accelerates discovery.

### 8.2. Updating and Deleting Interactions

Same as any item: edit = bump `_version` + re-sign; unlike/retract = tombstone, delivered to the same inbox. Tombstones SHOULD retain their `_rel` array (routing), and receivers MUST accept a tombstone whose `(author, id)` matches a stored item even if `_rel` is absent. To *change* a reaction, tombstone the old item and publish a new one with a fresh `id` — `id` reuse across different relations is not permitted.

## 9. The Manifest

The manifest commits an identity to a feed's contents. Each feed an identity publishes has its own manifest, keyed by its `feed_url` and named by that feed's `feeds` entry (§3.2.1). It is a **separately-signed, chained** document: signed by a key valid in the identity's chain, carrying its own monotonic `seq` and `prev` hash-linkage. It is the **same pin-and-walk discipline as the identity chain (§5), applied to content instead of identity.** Publishing a new item advances the manifest chain; it never touches the identity chain, which stays short.

```json
{
  "url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "seq": 412,
  "prev": "Jq3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "history": "https://pence.family/~mom/manifest-history.json",
  "updated": 1739577600,
  "items": { "urn:uuid:550e8400-...": 3, "urn:uuid:661f9511-...": 1 },
  "deleted": { "urn:uuid:99aa2222-...": 4 },
  "_sig": "..."
}
```

Fields:

- `url`: the owning identity (author binding, §6.6); MUST match the identity whose `feeds` entry (§3.2.1) names this manifest
- `feed_url`: the feed this manifest commits to
- `seq`: monotonic version counter, starts at 1, strictly increasing; a consumer rejects any manifest whose `seq` is below its pin (rollback)
- `prev`: **MUST if `seq > 1`.** Base64url SHA-256 of the full published canonical bytes (including `_sig`) of the immediately preceding manifest version. Genesis (`seq: 1`) omits it.
- `history`: **MUST if `seq > 1`.** URL of the manifest history **index** (§9.2), from which a consumer learns the URL and hash of every retained prior version and so can walk `prev` back to its pin.
- `updated`: publication time (Unix seconds); the effective signing time for the revocation/`iat` check (§6.5)
- `items`: map of live item `id` → current `_version`
- `deleted`: map of tombstoned `id` → tombstone `_version`. Omit when empty. Entries persist (a few dozen bytes each) until folded into a checkpoint (§9.3), so deletion history is verifiable
- `checkpoint_seq`, `checkpoint_hash`: OPTIONAL. Names a retained earlier manifest version, bounding growth (§9.3)
- `_sig`: detached JWS (§6) by a chain-valid key

Item *content* integrity needs no hash here: each item carries its own signature, and the `_version` in the manifest binds to the exact signed revision — a host cannot present a version the author never signed. The manifest adds what per-item signatures cannot: **presence, freshness, and — via the chain — tamper-evidence against a host that equivocates on what was published.**

### 9.1. Chain Mechanics

Producing and verifying a manifest version follow §5.2 and §5.3 exactly, with the manifest standing in for the identity document:

**Producing:** from the current version, apply content changes; `seq += 1`; `prev` = hash of the previous manifest; set `updated`; sign with a key valid in the identity chain; append the previous version to the manifest history (§9.2).

**Consumer enforcement (pinning):** a consumer that verified a manifest at `(seq: N, hash: H)` MUST store that pin. On any later fetch:

1. Verify `_sig` per §6.5, with the `kid` identity equal to `url` and the key found in that identity's pinned document
2. Walk `prev` links back to `(N, H)`, fetching intermediates from the `history` index (§5.4, §9.2). Reject if `seq` decreased, any `prev` mismatches, or two manifests claim the same `seq` with different hashes (equivocation)
3. Enforce the invariants (§9.4)
4. Update the pin

Because prior manifest versions are retained and individually addressable (§9.2), a manifest fork is detectable across consumers exactly as an identity-document fork is (§5.3): two observers — or a `pins` aggregator (Appendix G) — reconstruct the manifest at a shared `seq` and compare hashes; divergence surfaces as same-`seq`/different-hash. This is the property the host-trust analysis (§14.2) relies on: a signer that equivocates on *what content exists* is as catchable as one that equivocates on *what keys exist*.

First contact is TOFU (§5.3): accept and pin.

### 9.2. Manifest History

Producers MUST retain prior manifest versions, serve each at its own URL, and serve an **index** of them at the `history` URL, in the shape of §5.4 — same rules, same same-origin guard, same byte-identical retention.

Unlike the identity chain, the manifest advances on every publication, so this is the long chain. It is also the case the index shape was designed for: a manifest version carries its full `items` map, so a container of manifest versions grows as O(versions × items) and is rewritten on every post, while an index entry is three small fields. §9.3 bounds it further.

### 9.3. Checkpointing (OPTIONAL)

Left unbounded, `items` grows with the catalog and `deleted` grows forever, against the §14.4 caps. A manifest MAY declare a **checkpoint** to bound both:

- `checkpoint_seq` + `checkpoint_hash` name an earlier manifest version that MUST remain retrievable — that is, it MUST still appear in the `history` index (§9.2) with a working `url`, even when versions around it have been pruned.
- A manifest that declares a checkpoint MUST still carry its full **live** set in `items` (so the current manifest remains self-sufficient for what is live), but MAY **omit `deleted` entries whose tombstone was committed at or before the checkpoint.** Their permanence is preserved by the retained checkpoint: a consumer that does not find an id in the current manifest and needs its disposition consults the checkpoint (located via the `history` index, fetched directly, and hash-verified against `checkpoint_hash`).
- Manifest versions *before* a checkpoint MAY be pruned: their documents MAY return `404` and their index entries MAY be dropped. The checkpoint version itself MUST NOT be pruned. A consumer whose pin predates a pruned checkpoint MUST treat the chain as unverifiable (§5.3) rather than silently re-pin.

Checkpointing trades a little walk complexity for a bounded live manifest. It is OPTIONAL; a family-scale identity may never need it.

### 9.4. Invariants

Violations MUST be treated like chain equivocation:

1. An `id`, once present in `items`, MUST appear in every later manifest — in `items` (same or higher version) or in `deleted` — until folded into a checkpoint (§9.3). Content cannot silently vanish; removal requires a signed tombstone.
2. `seq` and per-item versions never decrease.
3. A served feed MUST NOT contain an item version lower than the manifest's, and MUST NOT contain live items absent from the manifest — **except** transiently newer content (an item newer than the manifest is *manifest lag*, e.g. mid-publish caching; consumers treat its presence as unverified rather than as a violation, and expect the next manifest version to commit it). Because the manifest is cheap to re-sign, publishers SHOULD advance it together with the feed, keeping this window small.

Consumers verify incrementally: any item read from the feed is checked against its manifest entry (one map lookup). Detecting omission of an item you have never seen requires comparing manifests across pins, which the chain (§9.1) makes sound.

### 9.5. Manifest Verification (summary)

(1) Verify `_sig` per §6.5, with the `kid` identity equal to `url` and the key found in that identity's pinned document. (2) Enforce the pin and walk `prev` to it (§9.1). (3) Enforce the invariants (§9.4). (4) Update the pin.

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

Cheap local checks run **before** any outbound fetch (the sender is unauthenticated until step 7; see §14.9):

1. Enforce body-size limits; parse JSON; reject duplicate keys (I-JSON)
2. Validate required item fields (§7.2)
3. **Relevance**: some `_rel` entry's `to` MUST reference this inbox's owner — their identity URL, their feed URL (with or without fragment), or an item of theirs. This is one lookup over `_rel` and works even for relation *types* the receiver doesn't understand (so unknown-typed interactions genuinely about the owner are accepted, per §8). Reject otherwise (`not_relevant`). Exception: a tombstone whose `(author, id)` matches a stored item is always relevant. A bare feed-URL `mention` alone SHOULD NOT authorize unbounded volume — treat it as low-priority/moderated
4. Timestamp bounds: effective signing time not more than 7 days past nor 24 hours future
5. Dedup (§10.3) — reject without fetching if stale
6. Rate-limit by source IP (always) and by author (once known)
7. Verify the signature per §6.5 (one outbound fetch: the author's identity document; cache it, and negatively cache failures)
8. Apply the revocation check against receipt time (§4.4)

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

## 11. Privacy

The core has no privacy mechanism, and that is a design outcome rather than an omission. This section says what the protocol does and does not offer, so that nobody has to infer it.

### 11.1. Publish or deliver

Content reaches people two ways, and everything else follows from which one you choose:

|  | **Published** — in a feed, committed by a manifest, `_feed_url` present | **Delivered** — POSTed to an inbox, no `_feed_url` (§8) |
|---|---|---|
| **Cleartext** | The public web. Pin, walk, gossip, completeness proof (§9). | Private from everyone except the two hosts. Works today; no mechanism needed. |
| **Encrypted** | Host-blind archive on a dumb host. Content opaque, **metadata public**. Keeps the completeness proof, the export bundle, and migration. See §11.3. | Host-blind delivery. Content and reply graph both stay off the public web. |

A **fifth cell does not exist: published but not public.** Earlier drafts of this protocol tried to build one — an authenticated-fetch extension with a `401` challenge, capability grants, a gated manifest, a CORS carve-out, and a documented cross-reader equivocation hole that then needed its own patch, which then needed its own patch. Every one of those artifacts was a consequence of putting private content on the published axis. They are gone (Appendix E).

What is genuinely incompatible is narrower than "privacy":

> **A completeness proof is a public artifact.** Its power is that strangers can compare it (§9.1, §14.2). Content whose **existence** must be private therefore cannot have one. Content whose **bytes** are opaque still can — encryption and the manifest compose fine.

#### 11.1.1. Publication is the author's decision, and only the author's

An item with no `_feed_url` was **delivered, not published** (§8) — its author chose the right-hand column above. Whoever receives it holds someone else's signed bytes as a **custodian, not an author** (§15 uses the same words for the same reason). Therefore:

> A receiver MUST NOT place a delivered-only item into any publicly-readable artifact: not a feed (§7.1), not a manifest (§9), not a replies-endpoint response (§12), and not a gateway emission to a foreign network (§7.5, Appendix F).

This is the **only** enforcement the delivered column has. Without it, choosing that column is not a privacy mechanism at all: any one recipient can undo it unilaterally, at no cost, and the author gets no signal that it happened. Note the asymmetry that makes this worth a MUST — the author's choice is visible in the signed bytes and is trivially checkable, while its violation is invisible to the person it harms.

The rule binds the **bytes**, not the information — the same by-value/by-reference limit as §6.6. Nothing stops a recipient publishing their own signed item describing what you told them privately. That is ordinary indiscretion, no protocol prevents it, and this one does not pretend to.

### 11.2. Audience of one, audience of many

The second rule predicts what breaks, and it cuts across the first:

> **Any audience larger than one requires a membership document.** An audience of one does not.

A direct message needs no roster: there is exactly one counterparty, threading works, and it is expressible in the core today as a signed item with no `_feed_url`, delivered to that person's inbox. A *group* audience is different — a replier is a reader, not the author, and nothing in the core tells them who else is in the audience. That is a membership problem, not a cryptography problem: it is identical whether the content is encrypted or in cleartext. Group audiences are therefore defined by the extension that also defines the roster (§11.3), and are not part of the core.

### 11.3. Encrypted content (OPTIONAL extension)

Confidentiality is specified separately in [`open-feed-encrypted-content.md`](open-feed-encrypted-content.md). An encrypted item is an ordinary signed item whose content is an opaque payload; the core neither defines nor inspects it, and the single signing construction (§6.1) is untouched.

Its guarantee, stated once and honestly: **encrypted content is exactly as private as the recipient's key custody.** A recipient whose host holds their decryption key has confidentiality against everyone except that host. Encryption is not a defence against your own host (§14.2, fourth tier).

### 11.4. What is never hidden

On a **published** feed, encrypted or not, these are cleartext by construction: `id`, `date_published`, `authors`, `_version`, `_feed_url`, and `_rel` with its `to` targets. That is who posts, when, how often, and who replies to whom — the interaction graph. Encryption hides what you said, not that you said it. Publication cadence and the deletion record are similarly permanent and public (§9, §14.8).

Where the interaction graph itself is sensitive, the answer is not a stronger cipher: it is to keep those items off the published axis entirely (§11.1, delivered column).

### 11.5. Hiding a feed's existence

Not offered. Serving a feed only to selected readers means serving audience-varying bytes, which forfeits single-valuedness and with it the whole pin-and-walk discipline (§5.3, §9.1) — that is the trade §11.1 describes, and it is why the extension that tried it is gone. A deployment that needs an unlisted feed can host one at an unguessable URL, but that is an operational choice with the properties of a bearer secret (it leaks through logs, referrers, and history sync), not a protocol mechanism, and this specification does not bless it as one.

## 12. Replies Endpoint (OPTIONAL)

The replies endpoint is **a read view over the inbox**, not a second store. Everything it returns was delivered by `POST {inbox}` (§10) and is held verbatim there; this endpoint is the public projection of that data, filtered to one target id. Implementers should build it as a query, not as a parallel collection to keep in sync.

It keeps its own URL rather than being folded into `GET {inbox}` on purpose: §10.1 reserves authenticated GET on the inbox for the owner reading their own mail, and an inbox may hold delivered-private content (§11.1). One URL serving both an owner-scoped private view and an unauthenticated public projection is the shape most authorization bugs take. Two URLs, one store.

That separation settles *who may query*. It does not settle *what may be returned*, and the second rule is the one that carries the weight:

> **The projection is of published replies only.** An item with no `_feed_url` MUST NOT appear in a replies-endpoint response, whatever its `_rel` targets. Its author delivered it rather than publishing it (§11.1.1), and this endpoint MUST NOT overrule that.

The check is a single field lookup inside the signed bytes — the author's own statement that the item is published — so it costs nothing and needs no manifest fetch (§10.3 forbids requiring one). An author who later promotes a delivered item to published, by bumping `_version` and adding `_feed_url`, makes it eligible from that revision onward; a receiver serves whichever revision it actually holds.

An implementation that skips this check converts every delivered-private interaction it receives into a public one, silently and by default. The encrypted-content extension routes group interactions down the delivered path precisely to keep a reply graph off the public web (`open-feed-encrypted-content.md` §7); that design depends entirely on this rule holding here.

An identity MAY expose thread discovery via a `replies` field in its identity document. The response is a **JSON Feed** (§7.1) whose `items` are the reply items reproduced **byte-verbatim** as received, with the queried id echoed in a feed-level `_replies_to`:

```
GET {replies}?item={percent-encoded-item-id}
```

Optional params: `since` (ISO 8601), `limit` (default 50); pagination via the feed's own `next_url`. Because the response is a JSON Feed, consumers reuse the feed parser and the verbatim rule (fields never added, dropped, or reordered; absent fields stay absent, never `null`) is the same rule that already governs feeds. Consumers re-verify each reply's signature and build the tree from `_rel` `reply` entries (`root` entries, §8.1, index deep replies to their thread). The endpoint MAY be moderated or filtered; consumers handle gaps gracefully.

## 13. Conformance

### Level 0 — Consume (non-verifying)

A plain feed reader that fetches the JSON Feed and ignores `_sig` is a valid consumer — it just gets no authenticity guarantee. Open Feed is strictly additive to the existing feed ecosystem: JSON Feed 1.1 readers (and, if an Atom mirror is published, RSS/Atom readers) work today with no Open Feed code. Level 0 has no requirements; it is named so the additive relationship is explicit.

### Level 1 — Read

MUST: fetch and parse identity documents, feeds, and manifests; verify signatures (§6); enforce revocation; handle unknown fields and relation types gracefully.
SHOULD: pin and enforce both chains — the identity document and the manifest (§5.3, §9.1); check items against manifests; enforce the canonical/copy rule (§7.5); honor content warnings; follow pagination; cache identity documents (≤1 h).

No infrastructure required.

### Level 2 — Publish

Level 1, plus MUST: serve an identity document (signed, chained, with history once `seq > 1`); serve at least one feed, listed in `feeds` (§3.2.1), of signed items; serve a signed, chained manifest for every feed entry that names one (with manifest history once its `seq > 1`); produce valid signatures and canonical JSON; generate unique ids; serve every public document with `Access-Control-Allow-Origin: *`.

Fully static-hostable: every Level 2 artifact is a file; signing happens at build time. (Sending interactions requires Level 2 — you need published keys for anyone to verify you.)

### Level 3 — Interact

Level 2, plus MUST: inbox endpoint with the §10 verification, dedup, CORS, and response codes.

An implementation that hosts identities **on behalf of other people** additionally MUST: provision each hosted identity with a recovery key generated on the member's own device and never transmitted to the host (§4.5); record and expose to the owner the `(seq, hash)` of every chain version it produces for them (§5.2); and serve that owner a complete export bundle on demand (§15). These three are what make hosted identities portable rather than captive, and an implementation that skips any one of them MUST say so plainly to the people it hosts.

SHOULD: replies endpoint; rotation UI for hosted users.

| Feature | L0 | L1 | L2 | L3 |
|---------|----|----|----|----|
| Read feed (no verify) | ✓ | ✓ | ✓ | ✓ |
| Verify signatures | | ✓ | ✓ | ✓ |
| Publish signed content | | | ✓ | ✓ |
| Send interactions | | | ✓ | ✓ |
| Static hosting sufficient | ✓ | ✓ | ✓ | |
| Receive interactions | | | | ✓ |
| Export bundle on demand (§15) | | | | ✓ (hosting others) |
| Device-generated recovery keys (§4.5) | | | | ✓ (hosting others) |

### Transient Failures

If an identity-document or manifest fetch fails transiently, cache the failure and retry (1 h, 4 h, 24 h) before permanent rejection.

## 14. Security Considerations

1. **Signature limitations.** Signatures prove a key signed bytes — not when (timestamps are self-reported), not who a person is, not that content is true.
2. **Hub trust vs host trust — a gradient, not a binary.** Three adversary tiers:
   - **Key custodian** (hub holds the user's signing key): forward impersonation is unpreventable — the email trust model, stated plainly. But even a key custodian cannot *silently rewrite the past* against pinned consumers. Both chains are retained and served (§5.4, §9.2), so removals must surface as signed tombstones (attributable actions), and per-consumer rewriting — of keys *or of content* — surfaces as a fork: two observers reconstruct the document at a shared `seq` and find different hashes (equivocation, detectable via pins, Appendix G). Transparency rather than integrity — but transparency with teeth, the certificate-transparency bargain. Content equivocation is exactly as detectable as key equivocation *because* the manifest is chained, not merely cumulative.
   - **Serving-path compromise** (CDN, static bucket, web tier — anything outside the signing boundary): the most common real-world compromise. The attacker cannot sign, so chain and manifest give hub users **full integrity**: no undetectable omission, rollback, or injection. Hubs SHOULD keep signing behind a narrower boundary than serving.
   - **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full integrity against the host by construction.

   Client-side keys (or the delegation extension sketched in Appendix H) move a user from the first tier toward the third.

   A fourth tier does not fit on that gradient, because it is not defined by technical position:

   - **Hostile custodian who is also the counterparty.** The operator of the hub is *inside the audience* and *controls the exit*. A family hub run by a relative is the ordinary case. This adversary reads everything the host can read (which, for hub-managed keys, is everything), sees the metadata no mechanism hides, is not deterred by transparency because they are entitled to look, and — uniquely — can decline to let the user leave.

     Against this adversary the protocol's integrity machinery is beside the point: it defends what you published from being *altered*, not from being *read by the person hosting it*. Confidentiality does not rescue it either. Encryption (the OPTIONAL extension, §11) is only as strong as the recipient's key custody, and this operator supplies the client, generates the keys at onboarding unless §4.5 is followed, and can add a key of their own to the identity document — a change the chain records perfectly and nobody is necessarily reading.

     What the protocol can offer this user is **exit**: an identity they can take elsewhere (§3.4), a recovery key the operator never held (§4.5), and a complete signed copy of their own content (§15). Those three are the parts of this specification built for them, and they are only real if all three hold at once. Implementations SHOULD NOT market audience control, restricted visibility, or encryption to this user as protection from their own host.
3. **TLS and CORS.** Everything HTTPS; validate certificates. Every publicly-readable document is served with `Access-Control-Allow-Origin: *` so browser Level-1 readers need no proxy.
4. **Resource limits and scale.** Suggested caps: identity document 100 KB / 100 keys; manifest 1 MB (~10–15k live items — a deliberate family-scale ceiling; use checkpointing, §9.3, to keep the live manifest bounded and offload deletion history); feed page 10 MB / 1000 items; inbox body 100 KB; chain versions walked per update 1000; **total history bytes fetched per update 10 MB** (§5.4, §9.2); concurrent fetches per origin 10. Open Feed scales **across identities** — each is self-contained and independently verifiable — not in items-per-identity; the manifest is that boundary by construction, and a global-scale aggregator (firehose) is explicitly out of scope.
5. **SSRF.** For every outbound fetch: HTTPS only, ≤5 redirects, 10 s timeout, size limits, reject private/loopback/link-local addresses, dedicated restrictive HTTP client.
6. **Signature stripping and by-reference reuse.** Never attribute unsigned content; display unverified content distinctly; never cache it as verified. Related: an item referencing media by URL is not evidence that its author produced those bytes (§6.6). Author binding covers content carried by value; it cannot cover content carried by reference, and `_sha256` proves only that the bytes are the ones the signer meant.
7. **Replay/timing.** Constant-time comparisons; NTP; never trust self-reported time as sole ordering.
8. **Enumeration and the public record of activity.** Rate-limit discovery endpoints; uniform timing for exists/doesn't-exist. Note what the design publishes permanently and by requirement: the `deleted` map (§9) makes "this identity deleted something at version N" a lasting public fact, and the retained manifest chain (§9.2) publishes posting cadence — when you write, how often, and when that changed. Do not describe this as acceptable "for family use": where the adversary is a family member (§14.2, fourth tier), it is precisely the leak that matters, and it survives encryption of the content.
9. **Inbox fetch amplification.** The `author` in a delivered item is attacker-controlled until verification succeeds. Rate-limit by source IP before fetching; run all local checks first; fetch only the fixed-path identity document of the claimed author (never an arbitrary URL from the `kid` — the path convention makes this structural); negatively cache failures. Collapsing discovery to one document also halves the amplification factor by construction.
10. **Rollback vs self-reported time.** The chains detect identity-document and content rollback — both relative to a consumer's pin. Neither detects item *backdating* (self-reported timestamps); receipt time is the trustworthy lower bound for inbox items, and manifest first-observation time (§4.4) is its pull-path analog, and the `pins` convention (Appendix G) is a family-scale external time anchor. A true transparency log / witness network remains future work.
11. **Inbound and copied HTML.** §10.5. Escape or sanitize any content not authored by the local user, always.
12. **Thread loops.** `_rel` `reply` graphs from malicious parties may contain cycles; cap walk depth.
13. **Manifest lag vs violation.** Content *newer* than the manifest is lag (tolerate briefly); content *vanished* from the manifest without a tombstone, or a copied item contradicting the canonical manifest, is a violation (treat as equivocation).
14. **Receiver-side republication.** The publish/deliver choice (§11.1) is the core's only privacy mechanism, and it is enforced entirely at parties other than the author. Any surface that projects received content publicly — the replies endpoint (§12), a bridge (§7.5), an aggregate feed — MUST filter out delivered-only items (§11.1.1). This is the failure mode most likely to be introduced by an implementer who is being *helpful*: republishing what arrived in the inbox looks like completeness and is a disclosure the author declined.
15. **Identity portability.** Losing the domain without recovery keys orphans the identity — the email trade-off. Recovery keys + pins close the hijack gap for anyone who observed the identity before the hijack; first contact after a hijack is unprotectable **by design**. Durable identity across domain loss is what atproto buys with DID indirection; Open Feed deliberately trades it for URL-native simplicity, and recovery keys + pins are the family-scale mitigation, not a fix. External anchors (transparency logs, witnesses) remain deferred.

## 15. Export and Exit

Everything in §3.4 moves an *identity*. This section moves the *content*, and the two together are what let someone leave a host that does not want them to.

An **export bundle** is a single JSON document containing a complete, independently-verifiable copy of everything an identity has published and received. A Level 3 implementation hosting identities on behalf of others MUST make it available to the identity's owner on demand, without operator approval and without rate limits that make it impractical.

```json
{
  "version": "openfeed-export/1",
  "url": "https://pence.family/~mom/",
  "exported_at": 1739577600,
  "identity": { "current": { "..." : "identity document" }, "history": [ "..." ] },
  "feeds": [ { "feed": { "...": "JSON Feed" }, "manifest": { "..." : "current manifest" }, "manifest_history": [ "..." ] } ],
  "delivered": [ "...signed items this identity sent that were never published..." ],
  "received": [ "...signed items delivered to this identity's inbox..." ],
  "attachments": [ { "url": "...", "_sha256": "...", "bytes": "base64url" } ]
}
```

Requirements:

- Every document MUST appear **byte-verbatim as published** — the same canonical bytes that were signed (§6.3). A bundle whose contents have been re-serialized is worthless, because the hashes will not chain.
- `identity.history` and `manifest_history` MUST be complete back to genesis, or back to a checkpoint (§9.3) that is itself included.
- `received` items MUST be included verbatim as received. They are other people's signed bytes; the exporter is a custodian, not an author.
- `delivered` MUST include items that exist only in transit — those with no `_feed_url`, which appear in no feed and no manifest and are therefore in no other artifact.
- `attachments` SHOULD inline the referenced bytes; where size makes that impractical, the bundle MUST at minimum retain each `url` and `_sha256` so the copy is checkable if the bytes are fetched separately. An export that omits the photos has not exported a family archive.
- The bundle MAY itself be signed (§6), which proves who assembled it. It does not need to be: every artifact inside carries its own signature, so a bundle is verifiable from its contents alone. This is the property that makes it useful against a host you do not trust — you do not have to trust the exporter either.

A consumer restores from a bundle by verifying it exactly as it would verify live documents: signatures per §6.5, chains per §5.3 and §9.1, items against their manifests per §9.4. Nothing about verification changes because the bytes arrived in a file.

**What the bundle is for.** Three things, in increasing order of how much they matter:

1. **Backup.** Your host loses a disk.
2. **Migration.** §3.4 tells consumers your identity continues elsewhere; the bundle is what you carry there to re-sign into the new feed.
3. **Exit.** You are leaving a host that is not on your side. This is the case that sets the requirements above — "on demand, without operator approval," "byte-verbatim," "includes received items," "includes the photos." An export mechanism that a hostile operator can withhold, degrade, or serve incomplete is not an exit; it is a courtesy. Together with a recovery key the operator never held (§4.5) and the migration path that needs no cooperation (§3.4), it is the whole of what this protocol offers the fourth-tier adversary case (§14.2) — and each of the three is load-bearing.

## Appendix A: Media Types

| Document | Content-Type (serve) | Accept (consume) |
|----------|---------------------|------------------|
| Identity document, manifest, history indexes, retained prior versions, export bundle, inbox body | `application/json` | any JSON; reject non-JSON |
| Feed | `application/feed+json` | that, or `application/json` |

All served with `Access-Control-Allow-Origin: *`.

## Appendix B: WebFinger (OPTIONAL)

`@user@domain` identifiers resolve via WebFinger (RFC 7033): `GET /.well-known/webfinger?resource=acct:mom@pence.family` returns the identity URL in `aliases` / `rel="self"` links. Clients MUST then fetch the identity document as the authoritative source. Purely a human-friendly aliasing layer; nothing else depends on it.

## Appendix C: Real-Time Updates (OPTIONAL)

JSON Feed 1.1 already defines a `hubs` field for WebSub. Feeds MAY advertise one; subscribers get pushes instead of polling, and MUST still verify item signatures — the WebSub hub is untrusted infrastructure. Nothing Open-Feed-specific is added. Real-time *inbox* notification to one's own clients (SSE, WebSocket) is implementation-specific.

## Appendix D: Test Vectors

All vectors are computed and self-verifying (regenerated by `tmp/regen.js`, which validates the canonicalizer against D.2's known SHA-256 and cryptographically self-verifies every `_sig`). Keys are **deterministic, testing-only** Ed25519 keys — not for any real identity.

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

### D.3. Manifest (genesis, `seq: 1`)

Full published canonical bytes (signed by `test-key-1`, `updated` = 1736899200):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..jeougogRyjJFslTe1xYIqGGJ7kbpccQN59PDKSN1Yd9ghO78rn97mIX0BwwhZGLMZaHw_Zkr9NhF2YlCHRMfAg","feed_url":"https://test.example/feed.json","items":{"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":1},"seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Base64url SHA-256 of these canonical bytes (this is `seq: 2`'s `prev`): `GPbjqBsIVHRzgMlbfqXu5IU29SqEhMQnAlukdt8j7DY`

### D.3b. Manifest, `seq: 2` (chained)

Adds a second item and chains to the genesis via `prev`. Signed by `test-key-1`, `updated` = 1739577600:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..UQHPRbpNJhtsUEIkILVzAKyKEPgO5oJtHtkKQXC8X2NPet3YpjB-S8HtSuDoDx5zLLk6j7Ow9BD09CnpxOJ_Cg","feed_url":"https://test.example/feed.json","history":"https://test.example/manifest-history.json","items":{"urn:uuid:00112233-4455-6677-8899-aabbccddeeff":1,"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":1},"prev":"GPbjqBsIVHRzgMlbfqXu5IU29SqEhMQnAlukdt8j7DY","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

Its `prev` equals the D.3 genesis hash, demonstrating manifest chaining (§9.1).

### D.4. Identity Document, `seq: 1` (genesis)

Full published canonical bytes (this exact string is what `seq: 2`'s `prev` hashes). Note the shape: one `feeds` array (§3.2.1) rather than separate `feed` + `manifest` fields, and `history` naming a version **index** (§5.4):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..WUNXi_EE0O0rqiZfcyBfjwFObOBD17zMuhj_bqjLOribrahSZky5voMzVTW1LEJ2tAL5KMyWiBEuF4oSxI_yDQ","feeds":[{"manifest":"https://test.example/manifest.json","rel":"primary","url":"https://test.example/feed.json"}],"history":"https://test.example/history.json","inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"name":"Test Identity","seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Hash (base64url SHA-256, = `seq: 2`'s `prev`): `mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y`

### D.5. Identity Document, `seq: 2` (rotation)

Adds `test-key-2`, revokes `test-key-1`. Signed by `test-key-1` — the continuity key, valid in `seq: 1`, revoked by the very version it signs, and still listed in it (§5.2):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..s9EtuunyYLna5IjMkSvu9rk9RDm2jxKKv-QRb-c69NkK8GhPRBZbI71K-3dUrY5UNFJrAnjX3jQLB4va9E_mAQ","feeds":[{"manifest":"https://test.example/manifest.json","rel":"primary","url":"https://test.example/feed.json"}],"history":"https://test.example/history.json","inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","revoked_at":1739577600,"x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1739577600,"kid":"test-key-2","kty":"OKP","x":"KOvPWZT35Xzwcsw6vfQzO3idc8oa67BdHZ0oXpriOQA"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"name":"Test Identity","prev":"mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

### D.6. Identity History Index (`seq: 1` retained)

The `history` document (§5.4) is an **index**, not a container of full versions: `(seq, hash, url)` per retained version, with each version served byte-identically at its own URL. It is unsigned — every version it names carries its own signature, and every `hash` is checked against the chain the consumer is already walking, so a lying index can misdirect but cannot forge.

```
{"url":"https://test.example/openfeed.json","versions":[{"hash":"mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y","seq":1,"url":"https://test.example/openfeed/1.json"}]}
```

Its single entry's `hash` equals D.4's full-bytes hash, which is also D.5's `prev` — the value a consumer walking from `seq: 2` back to a `seq: 1` pin compares against.

**Validation recipe:** verify all five `_sig` values (D.2 item, D.3/D.3b manifests, D.4/D.5 identity documents) against `test-key-1`; recompute D.3's full-bytes hash and confirm it equals D.3b's `prev` (manifest chaining); recompute D.4's full-bytes hash and confirm it equals both D.5's `prev` and D.6's index entry (identity chaining, and the index agreeing with the chain); verify the manifests' `_sig` against `test-key-1` as listed in the (pinned) identity document; confirm the item in D.2 matches the manifest entry `(id, 1)`.

`tmp/regen.js` performs all of these checks **and** verifies that every vector string above appears verbatim in this document — so a vector that drifts out of sync with the generator fails the run rather than sitting stale.

## Appendix E: Design History

This specification is a clean-slate synthesis. Several prior internal drafts (never publicly released; the last was numbered 0.5.1 and is preserved in git history) explored a larger surface: profile HTML with link-relation discovery, a separate JWKS document, standalone interaction objects with a type matrix, dual publication, Webmention in the core, and Authorized Fetch in the core. This version collapses that surface. The table records where each earlier construct went, as design rationale:

| Prior construct | Fate | Where it went |
|------------------|------|---------------|
| Profile HTML + `<link>` discovery | **Removed** | Fixed-path identity document; HTML parsing eliminated from the trust chain |
| Profile metadata document | **Merged** | Identity document fields |
| Separate JWKS document | **Merged** | `keys` in the identity document; `kid` = `{identity_url}#{kid}` |
| Key-ownership check | **Made structural** | Keys live only in the identity's own document; the check is a string comparison |
| Key History Chain on JWKS | **Generalized, then split** | One chain versions the identity document (keys/profile/endpoints); a **second, separately-signed chain** — the manifest — versions the feed. One pin-and-walk discipline, two artifacts; publishing advances the manifest chain, not the identity chain |
| Feed-omission open question | **Resolved** | Signed, chained manifest (§9) proves presence and makes omission/rollback tamper-evident; `_feed_url` (§7.5) proves exclusivity |
| Recovery attestation / recovery-claim document | **Removed** | Folded into migration: `predecessor` + a recovery-key `_recovery_sig` (§3.4) |
| Interaction objects, type matrix, `x-` types, dual publication, `target`/`target_item`/`source` | **Removed / collapsed** | Items with a `_rel` array; one schema, one verifier; feed and inbox carry the same bytes |
| Outbox endpoint | **Removed** | Your feed is your outbox |
| Webmention in core | **Removed from core** | Inbox is the sole core delivery path; Webmention returns as a **bridge gateway** (Appendix F), ingesting `_unverified` copies |
| Authorized Fetch (`401` challenge, fetch assertions, capability grants, gated manifest, reader lists) | **Removed entirely** (privacy-and-exit pass) | It tried to occupy a cell that does not exist: *published but not public* (§11.1). Every artifact it needed — the second signing construction, the CORS carve-out, timing equalization, a documented cross-reader equivocation hole, and the self-commitment mechanism invented to patch that hole — was a consequence of serving audience-varying bytes. Confidentiality moved to encrypted content (§11.3); audience control at a single host is host authorization, i.e. software, not protocol. **It can return as a pure extension with zero core changes** — a `401` is host behavior, an assertion is extension-local, a reader list is an extension field — which is the test that the removal is a real layering and not a deletion of capability |
| Self-commitments (conventions §5) | **Removed** (privacy-and-exit pass) | Existed solely to patch the above. The insight is worth keeping even though the mechanism is gone: *a public commitment to the hash of a private artifact restores cross-observer equivocation detection over it, for versions the owner actually commits to.* It is the reason §11.1's trade is stated over **existence**-privacy rather than confidentiality |
| Deriving an X25519 encryption key from the Ed25519 signing key | **Considered and rejected** | Tempting (one keypair, no new key type, no lifecycle, no discovery — `age` does exactly this for `ssh-ed25519`), and wrong here for three reasons that do not depend on each other. **(1) Lifecycle divergence:** a rotated-out signing key MAY be dropped after 30 days (§4.3), while an encryption key must be retained for as long as any ciphertext wrapped to it matters — derivation makes signing-key rotation silently destroy readability, or freezes signing keys forever. **(2) Merged blast radius:** one compromise would cost both future impersonation and all past confidentiality. **(3) Cross-primitive hygiene:** exposing a signing oracle and a Diffie-Hellman oracle on one keypair is a security-proof burden a small specification should not take on. Recorded here so the question is not re-opened annually |
| Replies-endpoint envelope | **Simplified** | Returns a JSON Feed (§12) |
| Bespoke relation fields (`_reply_to`, …) | **Unified** | `_rel` array with registered-token-or-URL types (§8) |
| OAuth/IndieAuth, `pubkey`/link-relation registry, Content-Type strictness, timestamp duality | **Removed / reduced** | Out of scope, gone, one rule, JOSE-boundary only |

What deliberately survived unchanged: byte-exact RFC 8785 + I-JSON, RFC 7797 header-covering signatures, author binding, effective signing time, tombstones, conformance levels, the static-hosting story, and the honest hub-trust model.

## Appendix F: Interoperability

Open Feed reaches other systems two ways, and the cheap one is not a bridge.

### F.1. Interoperability without a bridge

Most of what Open Feed interoperates with, it interoperates with **today, with nothing new built and no gateway operated**, because its wire formats are other people's wire formats:

- **A feed is a JSON Feed 1.1 document.** Every JSON Feed reader already works, ignoring `_sig` and getting no authenticity guarantee — Level 0 (§13). This is not a fallback; it is the default relationship to the existing ecosystem.
- **An Atom or RSS mirror** of the same items reaches the entire feed-reader installed base. It carries no signatures and is a copy in the sense of §7.5.
- **h-entry / h-card markup** on the optional human-readable page at the identity URL (§3.1) makes the identity legible to IndieWeb tooling.

Those last two are worth more than they look, because **existing bridges consume them**. A publisher serving an Atom feed discoverable from their home page, plus an h-card, can be bridged into the fediverse by a third-party service such as Bridgy Fed without this specification defining anything. The identity models even agree: such a service represents the site as `@yourdomain.com`, domain-bound, which is what an Open Feed identity URL already is — so there is no mapping to design.

The trade is the honest one stated throughout this appendix: content that reaches another network by any of these routes arrives **unsigned and without a completeness proof**. It is a copy (§7.5). That is the same trade a gateway makes, at none of the cost, which is why a deployment wanting reach should exhaust this section before building anything in the rest of the appendix.

### F.2. Gateways, and the one rule that governs them

A gateway is a **trusted intermediary, never a transparent adapter** — each target protocol has a different trust primitive, and no bridge can hold a foreign author's Open Feed key. A gateway is an ordinary Open Feed identity: it has an identity document, keys, a chained manifest, and an inbox, so a gateway that equivocates about what it bridged forks its own chain and is caught by §9.1 like any other signer. Open Feed's pull-canonical model (§1, principle 3) makes gateways resumable and drift-free.

Everything a gateway must and must not do follows from one rule, applied in both directions:

> **A gateway may not change the terms under which content was published.** Not the **audience** — never widen it. Not the **durability** — never make permanent what was ephemeral. Not the **verification status** — never present an assertion as a signature.

Those three questions are the test for any protocol, including one that does not exist yet.

**Outbound** (Open Feed → foreign network):

- **Delivered-only items MUST NOT be emitted** *(audience)*. An item with no `_feed_url` was kept off the public web by its author (§11.1.1); emitting it is a publication decision the author declined to make.
- **A gateway MUST NOT emit content it cannot read, including as a placeholder** *(audience)*. For an encrypted item (§11.3) the ciphertext, an "encrypted post" stub, and a bare timestamped entry are all forbidden. The reasoning matters, because the naive reading is that the metadata is public anyway: it is public **incidentally**, as the price of keeping the completeness proof (§11.4), not as a decision to announce. An author publishing opaque bytes at their own URL has accepted that whoever fetches that URL learns they posted. They have not asked a gateway to tell a foreign follower graph the same thing, and §14.8 is explicit that posting cadence is the leak that survives encryption and matters most against the fourth-tier adversary (§14.2). Skipping is always safe; announcing is not.
- **A gateway MUST NOT claim a completeness guarantee for bridged content** *(verification)*. No target protocol has an analog of the manifest (§9), so the proof does not survive the crossing.

**Inbound** (foreign network → Open Feed). This is the half implementations are likeliest to get wrong, because ingest feels like observation. It is publication: an ingested item lands in the gateway's own feed, is committed by the gateway's manifest, is retained permanently (§5.4, §9.2), and is served with `Access-Control-Allow-Origin: *`.

- **Ingest only what the source published publicly** *(audience)*. ActivityPub content not addressed to `Public` — followers-only, or a direct message — MUST NOT be ingested, and the same holds for any protocol's restricted or end-to-end-encrypted content. One followers-only post ingested into a manifested feed is a permanent, world-readable, cryptographically-committed disclosure its author never authorized.
- **Do not durabilize the ephemeral** *(durability)*. Content the source protocol expires, or allows to be genuinely withdrawn, MUST NOT be ingested: §9's retention rules turn removal into a permanent public record rather than a deletion (§14.8). A protocol whose deletions are real is not compatible with a protocol whose deletions are tombstones.
- **Everything ingested is `_unverified`** *(verification)*. §7.5, without exception.

### F.3. Proxy identities

A gateway signs what it ingests, so §6.6 places the gateway in the `authors` entry — which leaves the *foreign author* unnamed. A **proxy identity** is how a gateway names them: an ordinary Open Feed identity, minted and key-held by the gateway, one per foreign actor, whose identity document carries that actor's `name`, `bio`, and `avatar`. Items ingested from that actor are signed by their proxy, so attribution is **structural** rather than an unverified string in a field the core would otherwise have to define.

It is also the only representation available for actors whose native identifiers cannot be URLs — a Nostr `npub`, a phone number, a handle on a closed network.

A proxy identity is **not** a hosted identity in §13's sense, and that distinction is what keeps §15 coherent: its principal never asked for it, holds no keys, and has a real home elsewhere. Because everything a proxy publishes is `_unverified` (§7.5), it never claims to *be* that person — it claims to mirror them, which is a claim the gateway can support. §13's device-generated recovery key, `(seq, hash)` disclosure, and export bundle therefore do not apply: there is no captive user, because there is no user.

The price of that carve-out is honesty about what a proxy is. A gateway minting proxy identities MUST:

- **Disclose** in each proxy's identity document that it is a gateway-operated mirror, who operates it, and where the actor's real home is.
- **Never claim exit** (§15) for a proxy identity.
- **Withdraw the proxy on the foreign actor's request.** This stands where exit stands for a real hosted identity, and it is weaker; say so rather than dressing it up.

A gateway unwilling to meet these should not mint proxies. Ingesting everything under the gateway's own single identity is always available, and costs only per-actor attribution.

### F.4. The targets

- **Webmention / IndieWeb** — cheapest, and half-built by F.1: outbound rides on published h-entry HTML; inbound synthesizes `_unverified` items from mf2. No core changes.
- **ActivityPub** — the brid.gy model: a stateful actor proxy polls the feed and fans out `Create`/`Like`/`Announce`, and mirrors AP replies into the inbox.

  **FEP-8b32 does not converge, and earlier drafts of this appendix claimed it did.** Its `eddsa-jcs-2022` cryptosuite and Open Feed share a curve (Ed25519) and a canonicalization scheme (RFC 8785), but they sign **different bytes**: FEP-8b32 signs the 64-byte `SHA-256(canonical proof config) || SHA-256(canonical document)`, while Open Feed signs `ASCII(BASE64URL(header) || '.') || canonical-bytes` directly (§6.1). No signature is portable in either direction — and that is before the payloads differ, an ActivityStreams object being nothing like a JSON Feed item. There is no transparent object-level bridge on this seam.

  What does converge is narrower and still useful: the **key**. One Ed25519 keypair can serve as an Open Feed signing key and as an AP `assertionMethod` (FEP-521a), and the two signing inputs cannot be confused — an Open Feed signing input always begins with the fixed ASCII prefix `eyJhbGciOiJFZERTQSI`, while an `eddsa-jcs-2022` input is exactly 64 bytes of hash output. That makes an author-side dual-signing publisher conceivable, which is a different thing from a bridge and is deferred (Appendix H).
- **atproto** — heaviest: a mirror PDS (DID + DAG-CBOR + MST), no transparent path. The clean identity seam is **did:web ↔ Open Feed URL** (both domain-bound, and `did.json` sits beside `openfeed.json` at the same path).
- **Nostr** — events map onto items cleanly (id, pubkey, `created_at`, content), and relays are a push transport a gateway can subscribe to. Two frictions this appendix has already named: `npub` identities are not URLs, so ingest requires proxy identities (F.3), and event references are `nostr:` URIs rather than HTTP URLs (§7.5).

### F.5. What a bridge profile must specify

Because F.2's rule is protocol-independent, a profile for a specific protocol is a filled-in table rather than a fresh trust argument. A profile MUST specify:

| Slot | What it fixes |
|---|---|
| **Identity mapping** | Foreign actor → identity URL and back; whether proxies are minted per actor (F.3) or everything rides one gateway identity |
| **Object mapping** | Foreign object type → item, and where applicable → `_rel` type (§8), as a registered token or a namespaced URL |
| **Source URI form** | What `external_url` carries, and whether it is dereferenceable |
| **Audience test** | How the profile determines an object was published *publicly*. The safety-critical slot (F.2) |
| **Durability test** | How the profile determines an object is durable enough to ingest (F.2) |
| **Update and delete mapping** | Foreign edit → `_version` bump; foreign delete → tombstone (§7.3). The gateway owns its item ids, so both are ordinary |
| **What does not map** | Foreign objects with no item representation — `Follow`, `Accept`, `Block`, lexicon records, room state. These are the bridge's internal state and MUST NOT be invented into `_rel` types |
| **Failure semantics** | What happens when the foreign object disappears, when a delete arrives for something never ingested, and when the foreign side is unreachable |

The last two slots exist because they are where implementers improvise, and improvisation at a trust boundary is how the honest-hub model gets quietly abandoned.

## Appendix G: Conventions — Follows and Pins (OPTIONAL)

Two optional documents, both **outside the trust core** (nothing needs to verify them to verify content), referenced from the identity document (`follows` / `pins`, §3.2). Specified in full in [`open-feed-conventions.md`](open-feed-conventions.md).

- **`follows`** — who you read. Turns "which feeds does my hub poll?" from configuration into protocol (the core operation of the pull-canonical model). MAY be kept private (client-local).
- **`pins`** — signed `(url, seq, hash)` observations of others' identity documents or manifests. Publishing them gives a family, with no new cryptography, four properties at once: **anti-equivocation** (peers cross-check each other's view of a chain, turning §5.3's / §9.1's out-of-band comparison into published data), **recovery propagation** (a recovery-based successor, §3.4, gossips through the social graph), **informal timestamping** (a pin observed at wall-clock T witnesses that `(seq, hash)` existed by T, §14.10), and **first-contact web-of-trust** (consistent pins from already-trusted identities soften TOFU). This is the family-scale substitute for a transparency log, a DID directory, and a timestamp authority.

Pins are also the answer to a question §14.2 raises and does not settle: equivocation is *detectable*, but only if somebody compares. A producer's own record of what it published (§5.2) is a weak check — a host that knows which client is yours can serve that client the honest branch. Comparison by other people is the durable one, and `pins` is what makes it mechanical.

## Appendix H: Open Questions

- **`_rel` type registry governance** — how the registered core token set (vs namespaced URLs) is maintained pre-1.0.
- **Key delegation (extension, sketched; `open-feed-delegation.md`, planned — not yet drafted)** — the highest-value trust upgrade available. A delegation is a statement signed by a root identity key — `{delegate: {JWK}, kid, exp, scope}` — published in the identity document; a hub or extra device holds only the *delegated* key while the root stays client-side or offline. Content signs with the delegate key; verifiers resolve the `kid` to the delegation entry in the pinned identity document and confirm it unexpired and unrevoked. Revoking a delegate is an ordinary chain version — the pinned chain is exactly the authoritative revocation substrate whose absence killed Nostr's NIP-26. This one statement type answers both multi-device *and* hub custody (moving hub deployments from the key-custodian tier to the serving-path tier of §14.2) without adding a second signing construction.
- **External time anchoring** — a true transparency log / witness network beyond the family-scale `pins` convention; deferred.
- **Bridge profiles** — normative gateway specs for Webmention / ActivityPub / atproto (Appendix F), starting with the Webmention gateway.
- **Author-side dual signing (parked)** — a publisher's own client emitting both an Open Feed `_sig` and a foreign-format signature (e.g. FEP-8b32) over the same Ed25519 key, so bridged content need not be `_unverified`. It is the only known route to verified cross-protocol authorship, and the two signing inputs are structurally unconfusable (Appendix F.3). It is also a second signing construction in all but name, which §6.1 forbids in the core and in extensions. Parked deliberately: it is not blocking anything, and taking it up means deciding whether "no second construction" is a rule about *this protocol's* artifacts or about everything an Open Feed publisher signs.
