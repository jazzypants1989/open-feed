# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.** Nothing implements this and it has had no readers outside its author. Version numbers mark releases, not edits. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive. RFC 2119 keywords (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY) apply throughout.

## Abstract

Open Feed is a protocol for decentralized publishing and interaction. An identity is an HTTPS URL serving **one signed identity document** — profile, keys, endpoints, and a tamper-evident chain of its own versions. Content is published as signed JSON Feed items; a **separately-signed, chained manifest** commits the feed's contents so a host cannot silently drop, reorder, rewrite, or roll them back. Interactions (replies, likes, reposts, quotes, mentions) **are** feed items carrying a `_rel` relation array, delivered by POSTing the signed item to the recipient's inbox.

The protocol is four conventional documents and one endpoint:

```
https://pence.family/~mom/               ← identity URL (human page, optional)
https://pence.family/~mom/openfeed.json  ← identity document (signed: profile + keys + chain)
https://pence.family/~mom/feed.json      ← JSON Feed 1.1, signed items
https://pence.family/~mom/manifest.json  ← signed, chained commitment to the feed's contents
https://pence.family/~mom/inbox          ← POST signed items here (Level 3 only)
```

plus each chain's retained prior versions, served at URLs derived from the document they version (§5.4). Built on four standards and nothing else: **HTTPS**, **JSON Feed 1.1**, **JOSE** (JWK/JWS, RFC 7515/7517/7797), and **JSON canonicalization** (RFC 8785 + I-JSON RFC 7493).

Open Feed is a **transparency** protocol: it makes publication tamper-evident and is deliberately not private (§1, principle 7). What it offers anyone who needs to leave the host serving them is a portable identity, a recovery key that host never held, and a complete signed copy of their own content (§3.4, §4.5, §14). Two OPTIONAL layers are specified here and required by nothing: encrypted content (§15) and the follows/pins/replies conventions (§16).

## 1. Design Principles

1. **Identity in one signed document; content in one signed manifest.** Everything a verifier needs about an identity — keys and endpoints — is in one signed JSON document at one conventional path. What that identity has published is committed by one separately-signed manifest. Both are chained and pinned by the same discipline (§5, §9). Neither requires HTML parsing, link-relation discovery, or a cross-document key-ownership check.
2. **One object model.** A like is an item. A reply is an item. One signed schema for content, one update mechanism (versioning), one delete mechanism (tombstones), one verifier.
3. **The feed is the source of truth; the inbox is a push cache.** Delivery makes things fast; polling the signed feed makes them complete. Nothing exists only in transit, with one stated exception (§11.1).
4. **Convention over configuration.** Fixed paths (`openfeed.json`, `manifest.json`). One relation array. A `_` prefix for extension fields; a small registered vocabulary plus namespaced URLs for token values (§2.1).
5. **Byte-exact signing, one construction.** Documents are signed as published bytes (RFC 8785) with a single detached-JWS construction (§6). No verify-time normalization, no remote contexts, and no second signing scheme anywhere — not in the core, not in §15, not in §16. Encryption is not a second construction: it changes what the content *is*, not how it is signed.
6. **Honest trust model.** Hubs that hold keys can impersonate their users, as email providers can. This is documented, not hidden. Client-side keys are supported for those who want them; the two chains defend against a *host* that turns malicious, a distinct threat from a *key custodian* (§13.2).
7. **Transparency, not privacy — and an exit instead.** Several core mechanisms are deliberately hostile to privacy: history is retained permanently and served (§5.4), every public document carries `Access-Control-Allow-Origin: *` (§3.3), deletions leave a durable public record (§9), documents are single-valued by design, and deletion is best-effort (§7.3). These are the properties that make equivocation detectable, and they are the same properties that make forgetting impossible. Confidentiality is OPTIONAL (§15) and is only ever as strong as the recipient's key custody. What the core offers anyone who needs to get away from their host is **exit** (§3.4, §4.5, §14). If you are choosing this protocol because you need something kept secret, read §13.2 first.

## 2. Terminology

- **Identity**: an HTTPS URL controlled by a person or group.
- **Identity document**: the signed JSON document at `{identity_url}openfeed.json`.
- **Item**: a JSON Feed item, signed, the universal content object.
- **Relation item**: an item carrying a `_rel` array (§8) — what other protocols call an interaction.
- **Manifest**: the separately-signed, chained document committing to a feed's item set (§9).
- **Chain**: a hash-linked sequence of versions of a document (identity document, §5; manifest, §9).
- **Pin**: a consumer's stored `(seq, hash)` observation of a chained document.

### 2.1. Token Vocabularies

Several fields take a value from a small registered set that must stay open to extension. One rule governs them all:

> A **token-vocabulary value** is either a registered token from the set this specification defines, **or** an absolute URL naming a custom value (`https://example.com/ns#bookmark`). Consumers MUST preserve values they do not recognize and MUST NOT reject a document for carrying one; they MAY ignore them.

URL namespacing is collision-free without a registry, which is why custom values are URLs rather than bare strings; this mirrors HTML link relations, and it applies to `_rel[].type` (§8), feed `rel` (§3.2.1), and key `use` (§4.1). Extension **fields** are different: they use a `_` prefix (§3.2) and are *not* collision-free. Relation types and feed roles are values, not field names, precisely so they can be namespaced properly.

## 3. Identity

### 3.1. Identity URL

An identity is an HTTPS URL. Normalization, applied whenever identity URLs are stored or compared:

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

The identity URL SHOULD serve a human-readable page. Nothing in this protocol reads it; machines read the identity document.

### 3.2. Identity Document

The identity document lives at the fixed path `{identity_url}openfeed.json` — the normalized identity URL, which ends in `/`, plus the literal filename. So `https://pence.family/~mom/` → `https://pence.family/~mom/openfeed.json`.

```json
{
  "url": "https://pence.family/~mom/",
  "name": "Mom",
  "bio": "Grandmother, gardener, cat enthusiast.",
  "avatar": "https://pence.family/~mom/avatar.jpg",
  "feeds": [
    { "url": "https://pence.family/~mom/feed.json", "manifest": "https://pence.family/~mom/manifest.json", "rel": "primary" },
    { "url": "https://pence.family/~mom/activity.json", "manifest": "https://pence.family/~mom/activity-manifest.json", "rel": "activity" }
  ],
  "inbox": "https://pence.family/~mom/inbox",
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

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The identity URL. MUST match the URL the document was fetched under (after normalization). Author binding for the document itself. |
| `keys` | MUST | Array of JWKs (§4). At least one non-revoked, non-recovery key. |
| `seq` | MUST | Version counter, starts at 1, strictly increasing (§5). Advances on **identity** changes (keys, profile, endpoints, migration) — *not* on content publication. |
| `updated` | MUST | Publication time of this version (Unix seconds). |
| `_sig` | MUST | Detached JWS over the document (§6). |
| `prev` | MUST if `seq > 1` | Base64url SHA-256 of the full canonical bytes of the previous version, including its `_sig` and `_recovery_sig` if present. |
| `feeds` | SHOULD (MUST for Level 2) | Array of feed entries (§3.2.1). Every feed this identity publishes, in one place. |
| `inbox` | MAY (MUST for Level 3) | Inbox endpoint URL. |
| `follows`, `pins`, `replies` | MAY | URLs of the OPTIONAL conventions documents and endpoint (§16). Outside the trust core. |
| `name`, `bio`, `avatar`, `content_warning` | MAY | Profile metadata. `content_warning`, if present, marks all content from this identity as sensitive. |
| `successor`, `predecessor` | MAY | Migration links (§3.4). |
| `_recovery_sig` | MAY | Recovery co-signature for fork resolution (§5.5). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise; extension fields SHOULD use a `_` prefix. Every identity document is signed and versioned — there is no unsigned or unchained mode — and verification is trust-on-first-observation (§5.3): the signature proves continuity between versions, not first-contact authenticity.

#### 3.2.1. Feed Entries

Each entry in `feeds` is an object:

| Key | Required | Description |
|-----|----------|-------------|
| `url` | MUST | The feed's URL (JSON Feed 1.1, §7.1). MUST end in `.json` (§5.4 derives version URLs from it). |
| `manifest` | MUST | URL of that feed's own signed manifest (§9). MUST end in `.json`. |
| `rel` | SHOULD | What this feed is, from the token vocabulary (§2.1): `primary`, `activity`, or a namespaced absolute URL. Default `primary`. |

- **Exactly one entry SHOULD carry `rel: "primary"`**, and that entry is the identity's authoritative feed — what a consumer reads when it wants "this identity's content." Array order is display preference and carries no authority.
- **Each feed has its own manifest.** Manifests are keyed by `feed_url` (§9); one manifest never commits two feeds.
- **Every listed feed is manifested.** There is no unproven feed, so §9.4's invariants apply everywhere without a per-feed conditional in any verifier. The cost is a chain advance per publication, which §9.2 bounds by *time* rather than by activity: a high-volume feed advances its manifest on a schedule, not once per item.

The identity document commits to each manifest by **URL**, not by hash. Content freshness is proven by the manifest's own signature and chain (§9), so ordinary publishing does not re-sign or re-version the identity document. The identity chain versions identity state, which changes rarely (5–20 versions over a lifetime); the manifest chain versions content, which changes often. Two chains, one pinning discipline.

### 3.3. Fetching and Redirects

When fetching an identity document: follow at most 5 redirects; MUST NOT follow a redirect to a different origin; the response MUST parse as JSON (reject `text/html` or any non-JSON Content-Type; accept `application/json`); the response MUST carry `Access-Control-Allow-Origin: *`, as every publicly-readable document must, so browser Level-1 readers work without a proxy. A cross-origin redirect is never identity equivalence — migration is expressed in-band (§3.4), not with redirects — while same-origin redirects are followed normally.

### 3.4. Migration and Recovery

Migration and recovery are one operation — *this identity continues over there* — differing only in **which key attests**. There are three occasions for it: you move hosts by choice, you lose your domain, or **you leave a host that will not cooperate** (§14). The third is the one the mechanism must be judged against, because it is the only one where the other party is adversarial.

To move from `https://old.example/~alice/` to `https://alice.new/`:

1. Establish the new identity (new identity document, new or same keys), adding `"predecessor": "https://old.example/~alice/"`.
2. **Cooperative migration** (old domain still controlled): the old identity document publishes a new chain version adding `"successor": "https://alice.new/"`. Consumers follow `successor` when both links exist and agree — each sits inside a signed document, so the pair is a cryptographic cross-signature verifiable against the old identity's pinned chain.
3. **Recovery** (old domain lost): the new identity document additionally carries `_recovery_sig`, a detached JWS by a **recovery key** (§4.5) committed in a pinned ancestor of the predecessor. A consumer holding a pin of the old identity verifies the co-signature against that key and follows `predecessor` even though the old side can no longer publish a `successor`.

A `successor` claim without a matching `predecessor` (or vice versa), unaccompanied by a valid recovery co-signature, MUST NOT be treated as migration. Consumers with no prior pin of the old identity can only treat a recovery-based migration as unverified; out-of-band confirmation is recommended, and §16's `pins` convention is how a family propagates such a claim through its social graph. Recovery handles *domain loss*; it does not protect against theft of the recovery key itself. There is no separate recovery-claim document: the chained identity document — signed by an active key, carrying `predecessor`, co-signed by a committed recovery key — *is* the attestation. A consumer that has **not** verified a migration sees the same `id` presented as canonical at two feeds; it MUST treat the higher-`_version` copy as *unverified pending migration verification* rather than as an equivocation to reject, and reconcile once the pair or the co-signature verifies against a pin. This is the one situation where an `id` legitimately carries two live `_feed_url` values.

**The back catalog moves byte-verbatim; do not re-sign it.** Previously-published items carry the old feed's URL in their signed `_feed_url`, so at the new home they would be mere copies (§7.5) unless something reconciles them. Re-signing them would — same `id`s, bumped `_version`, new `date_modified` — and it is the wrong answer: it rewrites the bytes of every item you ever published, invalidating every hash held by every consumer's manifest pin and every peer's published pin (§16.1). A wholesale rewrite of the past is the exact pattern §5.3.1 exists to make suspicious, and exit should not require producing it. Instead the verified migration itself carries the binding: republish the back catalog **byte-verbatim** at the new feed and commit those same bytes in the new feed's manifest, where §7.5's canonical test honors the predecessor. Nothing is re-signed, so the id/feed binding rule (§7.5) is not breached and needs no exception — the binding simply follows the identity to its successor feed, and every hash survives intact.

**Relation targets follow the migration too.** A `_rel` entry's `to` names its target as `{feed_url}#{item_id}` (§8), and those references live in *other people's* signed items, which nobody can re-sign, so every reply ever received points at the predecessor's feed URL and would dangle at the new home. Two rules close this, both consequences of the migration already being verified: a consumer that has verified a migration MUST treat `{predecessor_feed}#{id}` and `{successor_feed}#{id}` as **the same target**, transitively across a chain of verified migrations; and a Level 3 host MUST accept inbox relevance (§10.2) against its owner's **predecessor** feed URLs as well as its current ones, since otherwise the first consequence of exercising §14's exit is that replies to everything you ever published start bouncing as `not_relevant`. Record the predecessor's feed URLs **at migration time** — in the uncooperative case the old identity document may be unreachable afterwards, which is the reason you migrated.

**Uncooperative departure.** Path 2 requires the old side to publish a `successor`, so it is unavailable against a host that declines — and a host holding your signing key can equally publish a `successor` you did not ask for. Path 3 is therefore the exit path, and it works without the old host's participation on one condition: the recovery key must be one the host cannot produce (§4.5). Where that holds, a departing user re-establishes their identity elsewhere, co-signs with the recovery key committed in a pinned ancestor, and every consumer holding a prior pin follows them. Where it does not hold, there is no exit — the operator can sign a competing branch with equal standing, and §5.5 cannot separate them. Departure does not retract what was published: items already served from the old feed remain signed and verifiable there, and taking a *copy* of your content with you is the export bundle's job (§14).

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

A **signing key** is any key referenced by the `kid` of a `_sig` (§6.2). The `crv` and `use` constraints above bind signing keys only; extensions MAY define keys with other `crv`/`use` values in the same array, as §15 does. Implementations MUST ignore keys with unrecognized `kty`/`crv`/`use`, so future algorithms and extension key types slot in additively. Algorithm confusion is already closed by §6.2, which requires verifiers to reject any signature whose referenced key's `crv` is not `Ed25519`, so a non-signing key can never be pressed into service as a signing key. But a key the core ignores is a key the core does not **audit**: its presence in a signed, chained document is transparent — adding it advances the chain (§5) — while no core verifier ascribes it meaning, so an extension defining such a key MUST state who checks it and what revoking it means.

Timestamp convention: key and chain fields use Unix seconds (JOSE); content fields use ISO 8601 strings (JSON Feed).

### 4.2. Key Identifiers

The full key identifier used in JWS headers is `{identity_url}#{kid}`, e.g. `https://pence.family/~mom/#key-1`. Verifiers split at the **last** `#`: the left side is the identity URL (normalize it — normalization strips fragments, so the split happens first), the right side is the `kid` to find in that identity's document. Because keys live *in* the identity document, key ownership is structural: the identity named by the `kid` either lists the key or it does not. There is no separate ownership check, and possession of a key that merely *verifies* proves nothing about any identity.

### 4.3. Rotation

Publish a new chain version (§5.2) adding the new key; sign new content and manifests with it; optionally set `revoked_at` on the old key in the same or a later version. Rotated-out keys SHOULD remain listed for at least 30 days so old content still verifies, and a key MUST remain listed in any chain version whose `_sig` it produces (§5.2).

### 4.4. Revocation

- Signatures on content whose effective signing time (§6.5) is after `revoked_at` MUST be rejected; before, they remain valid.
- Because content timestamps are self-reported, a key thief can backdate. For inbox-delivered items, receivers SHOULD apply the revocation check against **receipt time**, which the sender cannot backdate. Revocation limits damage from honest rotation far more than it stops an active thief (§13.10).
- The pull path has a receipt-time analog. Consumers SHOULD record the wall-clock time each item id was **first observed** in a signed manifest — one timestamp alongside the manifest pin — and check revocation against that. A thief can backdate an item's `date_published` but cannot backdate when a consumer's polling loop first saw a manifest commit to it, so a "years-old" item first entering the manifest after `revoked_at` is rejected. Consumers with no observation history fall back to the self-reported check; first contact is TOFU here as everywhere (§5.3).

### 4.5. Recovery Keys

A key with `"use": "recovery"`:

- MUST NOT sign regular content or manifests
- MUST be stored offline, not on the hub
- SHOULD be generated at identity creation
- Co-signs a migration for domain-loss recovery (§3.4) and MAY co-sign a chain version for fork resolution (§5.5)

Because recovery keys are committed in the chain, any consumer holding a pin can verify a later recovery-based migration or fork resolution against the recovery key present at that pinned `(seq, hash)`.

Verifiers MAY reject a recovery-based migration while the original identity serves a **conflicting** chain — one advancing with its own `successor` claim, or otherwise contradicting the migration. They MUST NOT reject it merely because the original identity is *still being served*. An uncooperative departure (§3.4) is exactly the case where the old host keeps serving an unchanged chain and simply declines to acknowledge the move; treating "still reachable" as grounds for rejection would hand a hostile custodian a veto over their user's exit by doing nothing at all. Where both sides advance with contradictory claims, that is a fork and §5.5 governs.

**Generation and possession.** Where the recovery key is stored is not the rule that matters; **who generates it and who has ever held it** is. A recovery key generated by the host and handed to the user is not a check on the host, because the host retains the ability to reproduce it. Therefore a Level 3 implementation hosting identities on behalf of others MUST provision each hosted identity with a recovery key **generated on the member's own device and never transmitted to the host**; the host receives the public JWK to commit in the chain and nothing else. Where a deployment's onboarding cannot meet this — a purely server-side signup, say — it MUST disclose to the user that the operator can reproduce their recovery key, because that user has no exit (§14). This one requirement is what turns recovery from a *domain-loss* feature into an *exit* mechanism.

**Generation alone is not enough: the commitment must be checkable.** A host that publishes the identity document also chooses what it says, and first contact is TOFU (§5.3). A host can therefore serve the *member's* client a genesis document carrying the member's real recovery key and serve *everyone else* one carrying a key the host holds. Nothing in the member's own view is wrong, so §5.2's self-record does not catch it; at exit, the member's co-signature fails against every consumer's pin while the host produces a competing branch that §5.5 *prefers*. Device generation is defeated without ever being violated. The defence is comparison, and it is cheap because it happens once: a Level 3 implementation hosting identities on behalf of others MUST present the member, at onboarding, with the `(seq, hash)` of their **genesis** identity document and a fingerprint of their **recovery key**, in a form suitable for reading aloud or comparing out-of-band; and a consumer MUST apply the compare rule (§5.3.1) to any second observation of a chain version it has already pinned, including one obtained from a peer. One relative comparing one hash defeats the attack. Publishing pins (§16) makes this mechanical and remains OPTIONAL, since it discloses a reading graph that this requirement does not.

## 5. The Version Chain

A compromised host or hijacked domain could roll the identity document back to an older version (un-revoking a key) or serve different versions to different readers. The chain makes both tamper-evident to any consumer who has seen the identity even once. This chain versions **identity state** — keys, profile, endpoints, migration links. Content freshness is protected separately by the same mechanism, the signed manifest chain (§9); splitting the two means ordinary publishing advances the manifest chain, not the identity chain, so the identity chain stays short regardless of how often content is posted.

### 5.1. Chain Fields

`seq`, `prev`, `updated`, `_sig`, and optionally `_recovery_sig`, as defined in §3.2. `prev` hashes the *full published canonical bytes* of the predecessor, signature fields included, so byte-preserving storage of old versions is the simplest correct implementation.

There is **one hashing rule in this protocol**, used everywhere a document names another document's bytes: *base64url SHA-256 of the full published canonical bytes, signature fields included.* It is the same value in `prev`, in a manifest's item commitments (§9), in `checkpoint_hash` (§9.3), and in a pin (§5.3, §16.1).

### 5.2. Producing a Version

1. Start from the current version; apply changes
2. `seq` += 1; `prev` = hash of the previous version; set `updated`
3. Sign with a **continuity key**: a key that was valid (non-revoked, non-recovery) in the *previous* version
4. Retain the previous version, served byte-identically at its derived URL (§5.4)
5. **Record the `(seq, hash)` of the version just produced**, and make that record available to the identity's owner. §13.2's transparency claim assumes an auditor, and an identity cannot audit its own chain without a record of what it actually published — where a host holds the signing key, this is the owner's only means of noticing a version they did not ask for. It is a weak check alone; the durable one is comparison by other people (§5.3.1, §16).

The continuity key is often revoked *in the very version it signs*; that is normal rotation, and validity is judged against the previous version's state. The continuity key MUST remain listed in the version it signs, or that version cannot be verified from its own bytes; it MAY be dropped later. Genesis (`seq: 1`) has no predecessor and is signed by a non-revoked key it contains.

### 5.3. Consumer Enforcement (Pinning)

A consumer that has verified an identity document at `(seq: N, hash: H)` MUST store that pin. On any later fetch:

1. Verify the new document's `_sig`; the signing key named by its `kid` MUST be listed in the document itself.
2. Walk `prev` links back to `(N, H)`, fetching intermediate versions from their derived URLs (§5.4). These MAY be fetched in parallel, since the consumer knows both endpoints of the range and the URLs are computable. At each hop, verify that version's `_sig`, confirm its bytes hash to the value its successor's `prev` names, and confirm its signing key was valid in *its* predecessor — hash linkage alone is insufficient, since a fabricated intermediate could introduce an attacker's key.
3. Reject if `seq` decreased, if any `prev` mismatches, or if the compare rule below fails.

First contact is TOFU: accept and pin. Tampering is detectable from the second observation onward, or immediately for any two consumers comparing. A consumer that cannot connect its pin to the current document — missing retained versions — MUST treat the chain as unverifiable rather than silently re-pin. The consumer separately pins the **manifest** at its own `(seq, hash)` and walks it by the identical procedure (§9.1): the two chains are two applications of one mechanism, pin on first observation, walk `prev` to the pin on every later fetch, treat any divergence as an attack.

#### 5.3.1. The compare rule

> Given any two observations of the same chained document URL at the same `seq` with **different** hashes, the publisher has **equivocated**. A consumer MUST treat this as an attack on that chain: it MUST NOT silently prefer either version, and MUST surface it.

This holds whatever the second observation's provenance — the consumer's own store, a cached response, a second device, or a signed pin published by a peer (§16). It is stated in the core because it is the rule the whole transparency claim rests on (§13.2): the chains make equivocation *detectable*, and detection is exactly this comparison. A verifier that pins but never compares has built the evidence and thrown it away.

Two consequences. **Comparison by other people is the durable form** — a publisher's own record (§5.2, step 5) is weak, because a host that knows which client belongs to the owner can serve it the honest branch, but it cannot know which of *many* readers will compare. And **a legitimate fork trips this rule, correctly**: after key theft both branches carry valid continuity signatures at the same `seq`, so the compare rule reports *that* a fork exists while §5.5 is how a consumer picks the honest branch. Run §5.5 resolution before treating a divergence as unresolved compromise. Applying the rule to observations you already hold costs nothing and discloses nothing; *publishing* pins discloses whom you read and when, which is why publication is optional (§16) and the rule is not.

### 5.4. Retained Versions

Producers MUST retain every prior version of a chained document and serve it at a **derived URL**:

> Take the document's own URL, strip the trailing `.json`, and append `/{seq}.json`.

| Chained document | Version 3 is served at |
|---|---|
| `https://pence.family/~mom/openfeed.json` | `https://pence.family/~mom/openfeed/3.json` |
| `https://pence.family/~mom/manifest.json` | `https://pence.family/~mom/manifest/3.json` |

Every chained document's URL MUST end in `.json`, so the derivation is total — the identity document satisfies this by its fixed path (§3.2) and a `feeds` entry's `manifest` URL is constrained to match (§3.2.1). Prior versions MUST be served **byte-identically** to how they were published; static files at those paths are the natural implementation. The derived path is reserved: a publisher MUST NOT serve unrelated content beneath it. Derived URLs are same-origin by construction, which is what the §3.3 / §13.5 fetch discipline wants.

The URL is *derived* rather than named in a signed `prev_url` field because signed bytes are immutable: a publisher who ever moved hosts would retroactively and unfixably break the walk for every consumer whose pin predates the move. Consumers SHOULD cap the versions walked per update (RECOMMENDED: 1000) and the total history bytes fetched (§13.4).

### 5.5. Fork Resolution

Equivocation detection reveals *that* a chain forked, not *which* branch is honest — after key theft, both branches carry valid continuity signatures. A version MAY carry `_recovery_sig`: a second detached JWS by a recovery key committed in a pinned ancestor. `_sig` and `_recovery_sig` are each computed over the canonical document with **both** signature fields removed. A thief of the online key cannot produce `_recovery_sig`, since the recovery key is offline, so verifiers detecting a fork SHOULD prefer the branch carrying a valid recovery co-signature; a fork where neither branch has one is unresolvable and SHOULD be flagged for manual review. Producers SHOULD co-sign the first version published after a suspected compromise.

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

The signature covers **header and payload**. Signing only the payload bytes MUST NOT be done: it leaves `alg` and `kid` unauthenticated, letting an attacker swap the referenced key. This is the **only** signing construction, in the core and in every extension, and it signs identity documents, items, and manifests identically. An extension that needs a second one is evidence the design is wrong, not that the rule needs an exception.

### 6.2. Header

```json
{ "alg": "EdDSA", "b64": false, "crit": ["b64"], "kid": "https://pence.family/~mom/#key-1" }
```

All four fields MUST be present with exactly these `alg`/`b64`/`crit` values. Verifiers MUST reject unrecognized `alg`, `crit` entries they do not understand, and signatures where the referenced key's `crv` is not `Ed25519` — the `alg` alone does not fix the curve.

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
6. If the key has `iat`, verify it predates the content's **effective signing time** — for items, `date_modified` if present else `date_published`; for manifests and identity documents, `updated`. No `iat` → skip.
7. Verify the key was not revoked before the effective signing time
8. Verify the Ed25519 signature over the reconstructed Signing Input

The effective-signing-time rule lets content be legitimately re-signed after rotation: bump `_version`, set `date_modified` to the actual signing time, keep `date_published`.

### 6.6. Author Binding

Every signed document carries its author's identity URL **inside the signed bytes**, and the claimed author MUST equal the `kid`'s identity URL. This prevents republishing someone's signed **item** under a different name: the binding travels with the bytes. For **manifests** and **identity documents** the carrier is the `url` field. For **items** it is the item-level `authors` array, which MUST contain **exactly one entry** whose `url` is the signer's identity URL; feed-level `authors` are not covered by item signatures and MUST NOT be relied on, though a multi-author *feed* still works because every item names its own single author. Clients MUST attribute solely to this entry and MUST NOT display any other self-asserted author name. Bridged content is not an exception: an ingested item is signed by its gateway, so the gateway — or a proxy identity it operates — *is* the author here, and the foreign author is named by that proxy's own identity document (§7.5, Appendix E).

Note the limit. It covers what the item carries **by value** — the bytes the signature is computed over. It does not and cannot cover what the item carries **by reference**: anyone may put someone else's attachment URL, or a copy of their text, into their own freshly-signed item. That is ordinary plagiarism, no protocol prevents it, and `_sha256` (§7.4) proves only that the referenced bytes are the ones the signer meant — not that the signer produced them. Items MUST also include `_feed_url`, the containing feed's URL, in the signed payload when served in a feed, which drives the canonical/copy rule (§7.5); inbox-only items omit it (§8).

## 7. Feeds and Items

### 7.1. Feed Document

A feed MUST conform to JSON Feed 1.1. Content-Type `application/feed+json` or `application/json`; reject non-JSON. The check exists to avoid parsing HTML error pages, not to police vendor types — static hosts serve `application/json` and MUST be accepted. Like every public document, a feed MUST be served with `Access-Control-Allow-Origin: *`. Required: `version`, `title`, `feed_url`, `items`; feed-level `authors` MAY be present for display and carry no authority.

A feed is owned by the identity whose identity document lists it in `feeds` (§3.2.1), and its contents are committed by the manifest that entry names (§9). Feeds MAY contain items from multiple authors — a family board — since every item is independently signed and attributed by its own signed single-entry `authors`.

**What shared ownership costs a contributor**, since it is not obvious and it points the wrong way. The *owner's* manifest commits the board, so a contributor whose items are canonical there has no completeness proof of their own over that content: the owner, or the owner's host, can drop a contributor's items and nothing in the contributor's chain records it. A contributor who wants the §9 guarantee for their own words SHOULD publish them to their own manifested feed and let the board carry **copies** (§7.5). That costs the board nothing — copies verify, attribute correctly, and take their liveness from the contributor's manifest — and it is why an aggregate view assembled by a client is usually the better shape than a shared canonical feed.

### 7.2. Items

Every item MUST include:

| Field | Description |
|-------|-------------|
| `id` | Globally unique, permanent (UUID URN or tag URI RECOMMENDED). MUST NOT contain `#` — ids appear as URI fragments in relation references (§8) |
| `date_published` | ISO 8601 |
| `authors` | Single-entry author binding (§6.6) |
| `_feed_url` | The containing feed's URL. MUST for feed-served items; omitted only for inbox-only items |
| `_version` | Integer, starts at 1 |
| `_sig` | Detached JWS (§6) |

plus at least one of `content_text` / `content_html`. A content-less relation item — a `like` or `repost` (§8) — satisfies this with `content_text: ""`, exactly as a tombstone does (§7.3): JSON Feed 1.1 requires a content field to be present, so "NONE" in §8's relation table means no *displayable* content, not an absent field. Consumers MUST preserve unknown `_` fields; signatures depend on it.

### 7.3. Versioning and Tombstones

To edit: bump `_version`, set `date_modified`, re-sign. Same `id` forever; `(author, id, _version)` names an exact signed revision, and feeds carry only the latest version. To delete: publish a **tombstone** — same `id`, bumped `_version`, `date_modified` set, `_deleted: true`, re-signed. A tombstone MUST contain **exactly** these fields and no others:

`id`, `authors`, `date_published`, `date_modified`, `_version`, `_deleted`, `_sig`, `content_text: ""`, plus `_feed_url` and `_rel` **if and only if** the item being tombstoned carried them.

Every other field — standard JSON Feed (`title`, `summary`, `content_html`, `image`, `tags`, `url`, `attachments`, …) and every extension field — MUST be absent. This is an allowlist on purpose: a denylist naming only today's known content fields would let a conformant tombstone retain a title, a tag, or an extension payload carrying the very thing the author deleted, and would need editing for every future content type. Retained fields are exactly those needed to verify the tombstone and route it.

Consumers seeing a valid tombstone SHOULD drop cached content and retain the tombstone; higher `_version` wins over any replayed earlier revision. Tombstones SHOULD stay in the feed for ≥30 days, and the manifest remembers them until folded into a checkpoint (§9.3). Deletion is best-effort: consumers that never re-fetch cannot be forced, and attachment *bytes* referenced by the deleted revision are removed by the host, not by the tombstone.

### 7.4. Attachments and Pagination

Attachments use JSON Feed's `attachments`: the metadata is inside the signed bytes, the referenced bytes are not. Each attachment entry MUST carry `_sha256`, the base64url SHA-256 of the referenced bytes, and consumers MUST treat an attachment lacking one as unverified content (§10.5) — never as part of the signed record. This is a MUST because §13.2 claims full integrity against a serving-path compromise, and that holds only for bytes the signature covers: an attachment referenced without a hash sits outside the envelope entirely, so whoever controls those bytes, including the host, can swap the photo under a signed item undetectably. For a media-first deployment that is the largest integrity gap available, and one required field closes it.

Pagination uses JSON Feed's `next_url`; feeds SHOULD carry at least the 50 most recent items.

### 7.5. Canonical and Copied Items

An item is **canonical** only in the feed its signed `_feed_url` names. The same signed item may legitimately appear elsewhere — a family aggregate feed, a follower's cache, a bridge — as a **copy**. Because the signature travels with the bytes, a copy is still verifiable as *authored* by its signer. But a copy carries **no authority over current publication state**: it does not prove the item is still live, is not evidence of manifest membership, and cannot resurrect content the author has tombstoned.

- A consumer MUST verify an item's `_feed_url` matches the feed URL it was fetched from (after normalization) before treating it as canonical. A mismatch marks the item a copy: display it, attribute it to its signer, but do not grant it liveness or manifest standing. **One mismatch is not a copy:** where the `_feed_url` names a feed of a **predecessor** identity of the one owning the feed it was fetched from, and the consumer has verified that migration (§3.4), the item is canonical here — transitively across a chain of verified migrations, and by the same reasoning that makes predecessor relation targets equivalent. A consumer that has not verified the migration correctly sees a copy, which is the safe reading.
- To determine whether a copied item is currently live or deleted, consult the manifest at its `_feed_url` (§9). The canonical manifest is authoritative and a copy cannot override a tombstone recorded there. Because that manifest commits each item's exact bytes, the same lookup also tells a consumer whether the copy it holds is the revision the author committed or a stale one.
- An `id` is permanently bound to a single `_feed_url`. The same `id` MUST NOT be signed with two different `_feed_url` values: the bytes would differ while `(author, id, _version)` claims to name one exact revision (§7.3), and inbox dedup (§10.3) would silently drop one variant. Cross-posting the same content to another feed uses a **new item** with a fresh `id` carrying a `repost` or `quote` relation to the original. A verified migration does **not** breach this rule and is not an exception to it: the item keeps its single signed `_feed_url`, and what changes is only where those unaltered bytes are served and treated as canonical (§3.4).

Together with the manifest this closes both omission and injection: the manifest proves **presence**, so a host cannot drop your content, and `_feed_url` proves **exclusivity**, so a host cannot inject or resurrect your content by copying it into its own feed. It also gives availability for free — a follower may serve its cached copy of your feed when your host is down, and it still verifies.

**Bridged and unverified items.** Content ingested from another protocol (Appendix E) cannot be a native signed item, because no one holds the foreign author's Open Feed key. It is therefore signed by the **gateway** that observed it, and it MUST carry `_unverified: true` — **no exception and no second form**, since nothing crossing a protocol boundary is natively authentic (§10.5 governs how it is displayed). Its `authors` entry names the **signer**, the gateway or a proxy identity the gateway operates, per §6.6 — never the foreign author, who signed nothing here. It SHOULD carry `external_url` naming the foreign original, which on an `_unverified` item MAY be a non-HTTP URI (`nostr:note1…`, `at://did:plc:…`) since not every protocol identifies objects with URLs; consumers MUST NOT dereference it, and §13.5's fetch discipline governs anything they do dereference. Ingest is only half of a bridge: Appendix E states the rule governing both directions, and §11.1.1 is the case the core enforces directly.

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

| `type` | Meaning | Content |
|--------|---------|---------|
| `reply` | Reply to the referenced item | REQUIRED |
| `root` | Thread root of a nested reply; accompanies `reply` (§8.1) | (governed by `reply`) |
| `like` | Endorsement of the referenced item | NONE (add `_emoji` to the entry for reactions) |
| `repost` | Share of the referenced item | NONE |
| `quote` | Quote of the referenced item | REQUIRED |
| `mention` | Mentions the referenced identity | REQUIRED |

**`type`** is a registered token from the table **or** an absolute URL for custom relations, per the token-vocabulary rule (§2.1). **`to`** is a single target URI: for items, `{feed_url}#{item_id}` (RECOMMENDED — receivers resolve relevance structurally by splitting at the last `#`, unambiguous because ids never contain `#`, §7.2) or the target's permalink `url`, which forces receivers to recognize their own permalinks; for `mention`, the mentioned identity URL. Multiplicity is expressed with **multiple entries**, never an array in `to`, so a reply that mentions two people is three entries. Entries are **open objects** whose unknown keys MUST be preserved — this is where per-relation extension and bridge round-trip data live, such as `_emoji` on a `like`. Custom-typed entries follow the same shape; receivers store unknown types and MAY hide them. Clients SHOULD NOT render content-less relation items as posts; they are activity.

**Likes SHOULD be delivered, not published.** A `like` is addressed to one person, reaches them through the inbox regardless, and has no other reader. Publishing it buys nobody anything, makes reactions the dominant driver of manifest volume (§9.2), and writes into a world-readable file exactly the interaction graph §11.4 lists as the metadata no encryption hides. So a `like` SHOULD omit `_feed_url` and be delivered only. Relations meant to be *seen* — `reply`, `repost`, `quote`, `mention` — are ordinary published items. State the consequence rather than discovering it later: a public like **count** becomes the post author's own unverifiable assertion, because the evidence sits in their inbox. That is the right trade at family scale and a real loss at public scale, so a publisher who needs reactions anyone can verify publishes them and pays §11.4's price knowingly. Whoever does publish content-less relations SHOULD segregate them into a separate **activity feed** — a `feeds` entry with `rel: "activity"` (§3.2.1), manifested like any other — so a Level 0 reader does not render bare likes as posts.

Interaction items otherwise live in their author's feed like any other item (SHOULD — any of them MAY be inbox-only, in which case `_feed_url` is omitted). One object, one signature: publishing and delivering are the same bytes, so there is nothing to keep in sync.

### 8.1. Threading

A `reply` entry's `to` points at the **parent** — a post, or another reply item in the parent author's feed. When the parent is not itself the thread root, the item SHOULD also carry a `root` entry pointing at the thread root. Without it, deep replies never reach the conversation's host: inbox relevance (§10.2) is judged per `_rel` entry, so a reply-to-a-reply references only the parent's author, and the root author's inbox would reject it as `not_relevant` — the person hosting the thread would be the one who cannot see it. Because the relevance check is type-agnostic, `root` entries are honored even by receivers that predate the type. Senders SHOULD deliver a nested reply to both the parent author's and the root author's inboxes.

Threads are trees built by walking parents; clients display flat or nested and SHOULD cap walk depth, since loops are possible in malicious data — treat re-visited references as leaves. Polling the participants' feeds is what makes a thread complete; the optional replies endpoint (§16.4) only accelerates discovery of replies from identities you do not already follow.

### 8.2. Updating and Deleting Interactions

Same as any item: edit = bump `_version` + re-sign; unlike or retract = tombstone, delivered to the same inbox. Tombstones SHOULD retain their `_rel` array for routing, and receivers MUST accept a tombstone whose `(author, id)` matches a stored item even if `_rel` is absent. To *change* a reaction, tombstone the old item and publish a new one with a fresh `id`; `id` reuse across different relations is not permitted.

## 9. The Manifest

The manifest commits an identity to a feed's contents. Each feed has its own manifest, keyed by its `feed_url` and named by that feed's `feeds` entry (§3.2.1). It is a **separately-signed, chained** document: signed by a key valid in the identity's chain, carrying its own monotonic `seq` and `prev` hash-linkage. It is the **same pin-and-walk discipline as §5, applied to content instead of identity.** Publishing a new item advances the manifest chain and never touches the identity chain.

```json
{
  "url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
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

- `url`: the owning identity (author binding, §6.6); MUST match the identity whose `feeds` entry names this manifest
- `feed_url`: the feed this manifest commits to
- `seq`: monotonic version counter, starts at 1, strictly increasing; a consumer rejects any manifest whose `seq` is below its pin
- `prev`: **MUST if `seq > 1`.** The §5.1 hash of the immediately preceding manifest version. Genesis omits it.
- `updated`: publication time (Unix seconds); the effective signing time for the revocation/`iat` check (§6.5)
- `items`: map of live item `id` → **`[version, hash]`**, where `version` is the item's current `_version` and `hash` is the §5.1 hashing rule applied to that item's full published canonical bytes, `_sig` included
- `deleted`: map of tombstoned `id` → `[version, hash]` of its tombstone. Omit when empty. Entries persist until folded into a checkpoint (§9.3), so deletion history is verifiable
- `checkpoint_seq`, `checkpoint_hash`: OPTIONAL, bounding growth (§9.3)
- `_sig`: detached JWS (§6) by a chain-valid key

**The manifest commits to bytes, not only to a version**, and the hash is not optional. A *serving-path* attacker who cannot sign is fully contained by `_version` alone, but a **key custodian** is not (§13.2): holding the signing key, it can sign item `X` version 1 as one thing for you and another for your sister, and with a version-only manifest both readers see byte-identical manifests, agreeing pins, and no fork — undetectable in principle, not merely unnoticed. The hash closes that using the mechanism that already exists, since two readers comparing pins (§5.3.1) now diverge at the same `seq`, and it costs about 48 bytes per item. So the manifest supplies what per-item signatures cannot: **presence, freshness, exact content, and — via the chain — tamper-evidence against a host that equivocates on any of them.**

### 9.1. Chain Mechanics

Producing and verifying a manifest version follow §5.2 and §5.3 exactly, with these substitutions:

| §5 (identity document) | §9 (manifest) |
|---|---|
| Document at `{identity_url}openfeed.json` | Document at the `manifest` URL of a `feeds` entry (§3.2.1) |
| Signing key listed in the document itself | Signing key valid in the identity chain of `url`, found in that identity's pinned document |
| Changes = keys, profile, endpoints, migration links | Changes = `items`, `deleted` |
| Reject on `seq` decrease, `prev` mismatch, compare-rule failure (§5.3.1) | Same, plus the invariants (§9.4) |

Prior versions are retained at derived URLs by §5.4 — same rule, same byte-identical requirement, nothing manifest-specific. Because they are individually addressable, a manifest fork is detectable across consumers exactly as an identity-document fork is: two observers, or a pins aggregator (§16.2), reconstruct the manifest at a shared `seq` and compare hashes. Because the manifest commits to item *bytes*, this covers equivocation over *what was said* as well as over *what exists*. First contact is TOFU.

### 9.2. Cadence and Retention

What *is* manifest-specific is volume. This is the long chain, and every version carries its whole `items` map, so retained manifest history grows as **O(versions × items)**. A family publishing three items a day for ten years reaches roughly 11,000 versions over 11,000 items — on the order of gigabytes of retained history, before anyone has posted a photo. Two mechanisms bound it, and a publisher of any volume SHOULD use both — one that uses neither is still conformant and will be fine at family scale for years, but it is the configuration that grows without bound, so it should be a choice rather than an accident:

- **Advance on a cadence, not per publication.** A manifest MAY commit a batch: publish items as they are written, and advance the chain on a schedule (hourly, daily). Version count then tracks *time* rather than *activity*, so a burst of twenty posts costs the same chain as one. This needs no new mechanism — §9.4 invariant 3 defines the resulting state, where an item newer than the manifest is **manifest lag**, treated as unverified-pending rather than as a violation, *and bounds how long that reading survives*. The cost is exactly that window, and it is worth naming precisely: uncommitted content is content a host can serve to one reader and not another without forking anything, so a long cadence is a real weakening of §9's guarantee rather than a delay in delivering it. Publishers SHOULD state their cadence to their users, SHOULD keep it short enough that the window is acceptable to them, and SHOULD advance immediately for a **tombstone**, since a deletion the author wants honored should not wait on a timer.
- **Checkpoint** (§9.3), which lets versions before the checkpoint be pruned entirely.

### 9.3. Checkpointing (OPTIONAL)

Left unbounded, `items` grows with the catalog and `deleted` grows forever, against the §13.4 caps. A manifest MAY declare a **checkpoint**: `checkpoint_seq` + `checkpoint_hash` name an earlier manifest version that MUST remain retrievable at its derived URL even when versions around it have been pruned. A manifest declaring a checkpoint MUST still carry its full **live** set in `items`, so the current manifest remains self-sufficient for what is live, but MAY **omit `deleted` entries whose tombstone was committed at or before the checkpoint** — their permanence is preserved by the retained checkpoint, which a consumer needing an id's disposition fetches directly and hash-verifies against `checkpoint_hash`. Manifest versions *before* a checkpoint MAY be pruned and MAY return `404`; the checkpoint version itself MUST NOT be pruned.

**The cost of pruning falls on lapsed readers, and it is real.** A consumer whose pin predates a pruned checkpoint cannot walk back to it and MUST treat the chain as unverifiable (§5.3) rather than silently re-pin. Someone who follows a family member, stops reading for a year, and returns finds their pin stranded — not because anyone attacked them, but because the publisher pruned. Two ways to soften it, neither free: prune conservatively, stating a retention floor to your readers so an unpredictable cliff becomes a policy; or accept a peer's signed pin (§16) at an intermediate `seq` as a reachable starting point, which is corroboration rather than proof (§5.3.1).

### 9.4. Invariants

Violations MUST be treated like chain equivocation:

1. An `id`, once present in `items`, MUST appear in every later manifest — in `items` at the same or a higher version, or in `deleted` — until folded into a checkpoint. Content cannot silently vanish; removal requires a signed tombstone.
2. `seq` and per-item versions never decrease.
3. A served feed MUST NOT contain an item version lower than the manifest's, and MUST NOT contain live items absent from the manifest — **except** transiently newer content. An item newer than the manifest is *manifest lag*, whether from mid-publish caching or a scheduled cadence (§9.2); consumers treat it as unverified-pending rather than as a violation, and expect the next manifest version to commit it. **Lag is bounded, and the bound is observable.** A consumer that has walked the chain can read the publisher's actual cadence from successive versions' `updated` values, so it needs no declared value and no new field: an item still uncommitted after an advance that demonstrably happened has been passed over, and that is a violation. RECOMMENDED bound: the greater of one hour and twice the median inter-version interval over the last 10 versions. Without a bound, a batching publisher holds a standing window in which it can serve an item to one reader and not another while producing no evidence at all — the guarantee of §9 reduced to the cadence.
4. An item whose `id` and `_version` match a manifest entry MUST hash to that entry's committed value. A mismatch is a violation, not lag: the manifest names an exact revision and the feed is serving a different one.

Consumers verify incrementally — any item read from the feed is checked against its manifest entry with one map lookup and one hash. Detecting omission of an item you have never seen requires comparing manifests across pins, which the chain makes sound.

## 10. Inbox

### 10.1. Endpoint

`POST {inbox}` with `Content-Type: application/json`; the body is a **signed item**, verbatim. The inbox MUST allow cross-origin requests:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Reading one's own inbox (authenticated GET) is implementation-specific and out of scope, as is how a user authenticates to their own hub.

### 10.2. Verification

Cheap local checks run **before** any outbound fetch; the sender is unauthenticated until step 7 (§13.9).

1. Enforce body-size limits; parse JSON; reject duplicate keys (I-JSON)
2. Validate required item fields (§7.2)
3. **Relevance**: some `_rel` entry's `to` MUST reference this inbox's owner — their identity URL, their feed URL with or without fragment, or an item of theirs. This is one lookup over `_rel` and works even for relation *types* the receiver does not understand, so unknown-typed interactions genuinely about the owner are accepted. The owner's **predecessor** identity and feed URLs count as their own (§3.4). Reject otherwise (`not_relevant`). Exception: a tombstone whose `(author, id)` matches a stored item is always relevant. A bare feed-URL `mention` alone SHOULD NOT authorize unbounded volume — treat it as low-priority or moderated.
4. Timestamp bounds: effective signing time not more than 7 days past nor 24 hours future
5. Dedup (§10.3) — reject without fetching if stale
6. Rate-limit by source IP (always) and by author (once known)
7. Verify the signature per §6.5 — one outbound fetch, the author's identity document; cache it, and negatively cache failures
8. Apply the revocation check against receipt time (§4.4)

### 10.3. Replay and Deduplication

Receivers store `(author, id) → version`. A delivery is **new** if the `(author, id)` is unknown (accept); an **update**, including tombstones, if `_version` is greater than stored (accept, replace); **stale** if `_version` is equal or lower (reject `409`). Receivers MAY additionally verify the item appears in the sender's manifest, but MUST NOT require it — inbox-only items are legitimate.

### 10.4. Responses

| Status | Meaning |
|--------|---------|
| `202` | Accepted / queued (do not distinguish moderation from auto-approval) |
| `400` | Malformed, missing fields, or not relevant to this inbox |
| `401` | Signature invalid or key revoked |
| `404` | Referenced target item does not exist |
| `409` | Stale version |
| `429` | Rate limited (include `Retry-After`) |

Error bodies: `{ "error": "code", "message": "human text" }` with codes `invalid_json`, `missing_field`, `not_relevant`, `invalid_signature`, `key_revoked`, `target_not_found`, `stale_version`, `rate_limited`. **Blocked authors SHOULD receive `202`** with the content silently discarded: signalling a block with a distinct status tells a harasser to make a new identity and confirms the account exists. Reserve an explicit refusal status for policy denials you actually want visible. Note that `404` answers the existence question §13.8 asks implementations to obscure; it is safe where ids are unguessable UUIDs, and where they are not — or where an item's existence is itself sensitive — return `202` and discard instead. Senders retry 5xx and timeouts with exponential backoff for 24 hours; recipients recover missed deliveries by polling the sender's feed, since the feed is the source of truth, and hubs SHOULD reconcile relation items found by polling against the inbox record.

### 10.5. Rendering Untrusted Content

Item content from anyone other than the local user is untrusted — whether it arrives by inbox delivery **or** by polling a stranger's feed. Receivers MUST either render only `content_text`, escaped, or aggressively sanitize `content_html` through an allowlist. Never render untrusted HTML as-is. Content marked `_unverified` (§7.5) MUST be displayed distinctly and never cached as verified.

## 11. Privacy

The core has no privacy mechanism, and that is a design outcome rather than an omission.

### 11.1. Publish or deliver

Content reaches people two ways, and everything else follows from which one you choose:

|  | **Published** — in a feed, committed by a manifest, `_feed_url` present | **Delivered** — POSTed to an inbox, no `_feed_url` (§8) |
|---|---|---|
| **Cleartext** | The public web. Pin, walk, gossip, completeness proof (§9). | Private from everyone except the two hosts. Works today; no mechanism needed. |
| **Encrypted** (§15) | Host-blind archive on a dumb host. Content opaque, **metadata public**. Keeps the completeness proof, the export bundle, and migration. | Host-blind delivery. Content and reply graph both stay off the public web. |

A **fifth cell does not exist: published but not public.** Serving audience-varying bytes forfeits single-valuedness and with it the whole pin-and-walk discipline. What is genuinely incompatible is narrower than "privacy":

> **A completeness proof is a public artifact.** Its power is that strangers can compare it (§9.1, §13.2). Content whose **existence** must be private therefore cannot have one. Content whose **bytes** are opaque still can — encryption and the manifest compose fine.

#### 11.1.1. Publication is the author's decision, and only the author's

An item with no `_feed_url` was **delivered, not published** (§8) — its author chose the right-hand column. Whoever receives it holds someone else's signed bytes as a **custodian, not an author** (§14 uses the same words for the same reason). Therefore:

> A receiver MUST NOT place a delivered-only item into any publicly-readable artifact: not a feed (§7.1), not a manifest (§9), not a replies-endpoint response (§16.4), and not a gateway emission to a foreign network (§7.5, Appendix E).

This is the **only** enforcement the delivered column has. Without it, choosing that column is not a privacy mechanism at all: any one recipient can undo it unilaterally, at no cost, and the author gets no signal that it happened. Note the asymmetry that makes this a MUST — the author's choice is visible in the signed bytes and trivially checkable, while its violation is invisible to the person it harms. The rule binds the **bytes**, not the information, the same by-value/by-reference limit as §6.6: nothing stops a recipient publishing their own signed item describing what you told them privately, which is ordinary indiscretion that no protocol prevents and this one does not pretend to.

### 11.2. Audience of one, audience of many

> **Any audience larger than one requires a membership document.** An audience of one does not.

A direct message needs no roster: there is exactly one counterparty, threading works, and it is expressible in the core today as a signed item with no `_feed_url` delivered to that person's inbox. A *group* audience is different — a replier is a reader, not the author, and nothing in the core tells them who else is in the audience. That is a membership problem, not a cryptography problem, and it is identical whether the content is encrypted or in cleartext. Group audiences are therefore defined by §15.4, which also defines the roster, and are not part of the core.

**A membership document is not necessarily a published one**, and conflating the two makes the rule above look stricter than it is. An author broadcasting to an audience that only *they* address holds the list locally and wraps to it — no document leaves their client, nothing is pinned, and §15.4's ship gate does not apply, which is why §15.4 recommends shipping exactly that first. A **published** roster is required precisely when someone other than the author must address the same audience: the replier, who cannot wrap to a list they cannot read. The rule is about a membership *decision* existing, not about publishing one, and the two cases differ in readiness as well as in shape — broadcast to an author-held list is complete today; the published roster that makes group *replies* work is not.

### 11.3. Encrypted content

Confidentiality is OPTIONAL and specified in §15. An encrypted item is an ordinary signed item whose content is an opaque payload; the core neither defines nor inspects it, and the single signing construction (§6.1) is untouched. Its guarantee, stated once:

> **Encrypted content is exactly as private as the recipient's key custody.**

Encryption protects a plaintext from every party except its author, who needs no secret because they encrypt to recipients' *public* keys, and anyone holding a recipient's private encryption key. A recipient whose host holds their decryption key has confidentiality against everyone except that host. Encryption is not a defence against your own host (§13.2, fourth tier), and its value tracks how many recipients hold their own keys — a product and UX variable, not a protocol one.

### 11.4. What is never hidden

On a **published** feed, encrypted or not, these are cleartext by construction: `id`, `date_published`, `date_modified`, `authors`, `_version`, `_feed_url`, and `_rel` with its `to` targets, plus the manifest's record of publication cadence and deletions (§9, §13.8). That is who posts, when, how often, and who replies to whom — the interaction graph. Encryption hides what you said, not that you said it. Where the graph itself is sensitive, the answer is not a stronger cipher: it is to keep those items off the published axis entirely (§11.1, delivered column; §15.5).

**Hiding a feed's existence is not offered**, for the reason above. A deployment that needs an unlisted feed can host one at an unguessable URL, but that is an operational choice with the properties of a bearer secret — it leaks through logs, referrers, and history sync — not a protocol mechanism, and this specification does not bless it as one.

## 12. Conformance

**Level 0 — Consume (non-verifying).** A plain feed reader that fetches the JSON Feed and ignores `_sig` is a valid consumer; it just gets no authenticity guarantee. Open Feed is strictly additive to the existing feed ecosystem. Level 0 has no requirements and is named so that additive relationship is explicit.

**Level 1 — Read.** MUST: fetch and parse identity documents, feeds, and manifests; verify signatures (§6); enforce revocation; **pin and enforce both chains** (§5.3, §9.1) and apply the compare rule (§5.3.1); check items against their manifest entries, hash included (§9.4); handle unknown fields and relation types gracefully. SHOULD: enforce the canonical/copy rule (§7.5); honor content warnings; follow pagination; cache identity documents (≤1 h). No infrastructure required.

Pinning is a MUST because it is what the §13.2 guarantees are made of: a verifier that checks signatures but keeps no pin re-establishes trust on first use at every fetch, and a host holding the signing key can hand it any history it likes, forever, without ever forking anything. The one exception is narrow — **a consumer with no persistent storage cannot pin.** Such a consumer is still useful (a one-shot command-line verifier, a stateless function) and remains conformant to everything else at this level, but it MUST NOT be presented as providing the §13.2 guarantees, and SHOULD tell its users so.

**Level 2 — Publish.** Level 1, plus MUST: serve an identity document (signed, chained, retaining prior versions at their derived URLs once `seq > 1`); serve at least one feed, listed in `feeds`, of signed items; serve a signed, chained manifest for **every** feed entry, with its own retained prior versions; produce valid signatures and canonical JSON; generate unique ids; serve every public document with `Access-Control-Allow-Origin: *`. Fully static-hostable: every Level 2 artifact is a file, and signing happens at build time. Sending interactions requires Level 2, since you need published keys for anyone to verify you.

**Level 3 — Interact.** Level 2, plus MUST: an inbox endpoint with the §10 verification, dedup, CORS, and response codes. SHOULD: rotation UI for hosted users; a replies endpoint (§16.4) if thread discovery is wanted. An implementation that hosts identities **on behalf of other people** additionally MUST:

1. Provision each hosted identity with a recovery key generated on the member's own device and never transmitted to the host (§4.5).
2. Present the member, at onboarding, with their **genesis** `(seq, hash)` and their recovery key's fingerprint in a form they can compare out-of-band (§4.5), and record and expose the `(seq, hash)` of every later chain version it produces for them (§5.2).
3. Serve that owner a complete export bundle on demand (§14).

These make hosted identities portable rather than captive, and an implementation skipping any one of them MUST say so plainly to the people it hosts. Requirement 2 is not paperwork: without it, requirement 1 can be satisfied to the letter and defeated in full (§4.5).

**Transient failures.** If an identity-document or manifest fetch fails transiently, cache the failure and retry (1 h, 4 h, 24 h) before permanent rejection.

## 13. Security Considerations

1. **Signature limitations.** Signatures prove a key signed bytes — not when (timestamps are self-reported), not who a person is, not that content is true.
2. **Hub trust vs host trust — a gradient, not a binary.** Three adversary tiers sit on it, and a fourth does not.
   - **Key custodian** (hub holds the user's signing key): forward impersonation is unpreventable — the email trust model, stated plainly. But even a key custodian cannot *silently rewrite the past* against pinned consumers. Both chains are retained and served (§5.4), so removals must surface as signed tombstones, and per-consumer rewriting — of keys, of *which* items exist, or of *what those items say* — surfaces as a fork: two observers reconstruct the document at a shared `seq` and find different hashes. Transparency rather than integrity, but transparency with teeth. Two conditions make that claim true rather than nearly true, and both are requirements elsewhere here: the manifest commits each item's **exact bytes** (§9), and somebody has to **compare** (§5.3.1). §16 makes comparison mechanical; §12 makes the rule mandatory at Level 1.
   - **Serving-path compromise** (CDN, static bucket, web tier — anything outside the signing boundary): the most common real-world compromise. The attacker cannot sign, so chain and manifest give **full integrity**: no undetectable omission, rollback, or injection. Hubs SHOULD keep signing behind a narrower boundary than serving.
   - **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full integrity against the host by construction. Client-side keys are what move a user from the first tier toward this one.
   - **Hostile custodian who is also the counterparty** — off the gradient, because it is not defined by technical position. The operator is *inside the audience* and *controls the exit*; a family hub run by a relative is the ordinary case. This adversary reads everything the host can read (for hub-managed keys, everything), sees the metadata no mechanism hides, is not deterred by transparency because they are entitled to look, and can decline to let the user leave. The integrity machinery is beside the point: it defends what you published from being *altered*, not from being *read by the person hosting it*. Confidentiality does not rescue it either, since encryption is only as strong as the recipient's key custody (§11.3) and this operator supplies the client, generates the keys at onboarding unless §4.5 is followed, and can add a key of their own to the identity document — a change the chain records perfectly and nobody is necessarily reading. What the protocol can offer this user is **exit**: §3.4, §4.5, §14, real only if all three hold at once. Implementations SHOULD NOT market audience control, restricted visibility, or encryption to this user as protection from their own host.
3. **TLS and CORS.** Everything HTTPS; validate certificates. Every publicly-readable document carries `Access-Control-Allow-Origin: *` so browser Level-1 readers need no proxy.
4. **Resource limits and scale.** Suggested caps: identity document 100 KB / 100 keys; manifest 1 MB (~10k live items at roughly 96 bytes per `[version, hash]` entry — a deliberate family-scale ceiling; use checkpointing, §9.3); feed page 10 MB / 1000 items; inbox body 100 KB; chain versions walked per update 1000; **total history bytes fetched per update 10 MB**; concurrent fetches per origin 10. Retained manifest history grows as O(versions × items) and is the largest storage obligation in the protocol; §9.2 is how a publisher bounds it. Open Feed scales **across identities**, each self-contained and independently verifiable, not in items-per-identity; a global-scale aggregator (firehose) is explicitly out of scope.
5. **SSRF.** For every outbound fetch: HTTPS only, ≤5 redirects, 10 s timeout, size limits, reject private/loopback/link-local addresses, dedicated restrictive HTTP client.
6. **Signature stripping and by-reference reuse.** Never attribute unsigned content; display unverified content distinctly; never cache it as verified. Author binding covers content carried by value and cannot cover content carried by reference (§6.6, §7.4).
7. **Replay and timing.** Constant-time comparisons; NTP; never trust self-reported time as sole ordering.
8. **Enumeration and the public record of activity.** Rate-limit discovery endpoints; use uniform timing for exists/doesn't-exist. Note what the design publishes permanently and by requirement: the `deleted` map makes "this identity deleted something at version N" a lasting public fact, and the retained manifest chain publishes posting cadence — when you write, how often, and when that changed. Do not describe this as acceptable "for family use": where the adversary is a family member (tier four above), it is precisely the leak that matters, and it survives encryption of the content.
9. **Inbox fetch amplification.** The `author` in a delivered item is attacker-controlled until verification succeeds. Rate-limit by source IP before fetching; run all local checks first; fetch only the fixed-path identity document of the claimed author, never an arbitrary URL from the `kid` — the path convention makes this structural. Negatively cache failures.
10. **Rollback vs self-reported time.** The chains detect identity-document and content rollback, both relative to a consumer's pin. Neither detects item *backdating*; receipt time is the trustworthy lower bound for inbox items, manifest first-observation time is its pull-path analog (§4.4), and the `pins` convention (§16.2) is a family-scale external time anchor. A true transparency log or witness network remains future work.
11. **Inbound and copied HTML.** Escape or sanitize any content not authored by the local user, always (§10.5).
12. **Thread loops.** `_rel` `reply` graphs from malicious parties may contain cycles; cap walk depth (§8.1).
13. **Manifest lag vs violation.** Content *newer* than the manifest is lag and is tolerated briefly; content *vanished* from the manifest without a tombstone, or a copied item contradicting the canonical manifest, is a violation (§9.4).
14. **Receiver-side republication.** The publish/deliver choice is the core's only privacy mechanism and it is enforced entirely at parties other than the author. Any surface that projects received content publicly — a replies endpoint, a bridge, an aggregate feed — MUST filter out delivered-only items (§11.1.1). This is the failure mode most likely to be introduced by an implementer who is being *helpful*: republishing what arrived in the inbox looks like completeness and is a disclosure the author declined.
15. **Identity portability.** Losing the domain without recovery keys orphans the identity — the email trade-off. Recovery keys and pins close the hijack gap for anyone who observed the identity before the hijack; first contact after a hijack is unprotectable by design. Durable identity across domain loss is what atproto buys with DID indirection; Open Feed deliberately trades it for URL-native simplicity, and recovery keys plus pins are the family-scale mitigation, not a fix.

## 14. Export and Exit

§3.4 moves an *identity*. This section moves the *content*, and the two together are what let someone leave a host that does not want them to. An **export bundle** is a single JSON document containing a complete, independently-verifiable copy of everything an identity has published and received. A Level 3 implementation hosting identities on behalf of others MUST make it available to the identity's owner on demand, without operator approval and without rate limits that make it impractical.

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

- Every document MUST appear **byte-verbatim as published** — the same canonical bytes that were signed (§6.3). A bundle whose contents have been re-serialized is worthless, because the hashes will not chain.
- `identity.history` and `manifest_history` are arrays of the **retained prior versions themselves**, byte-verbatim, complete back to genesis or to a checkpoint (§9.3) that is itself included.
- `received` items MUST be included verbatim as received. They are other people's signed bytes; the exporter is a custodian, not an author.
- `delivered` MUST include items that exist only in transit — those with no `_feed_url`, which appear in no feed and no manifest and are therefore in no other artifact.
- `attachments` SHOULD inline the referenced bytes; where size makes that impractical, the bundle MUST at minimum retain each `url` and `_sha256` so the copy is checkable if the bytes are fetched separately. An export that omits the photos has not exported a family archive.
- The bundle MAY itself be signed (§6), which proves who assembled it, but need not be: every artifact inside carries its own signature, so a bundle is verifiable from its contents alone. That is what makes it useful against a host you do not trust — you do not have to trust the exporter either.

A consumer restores from a bundle by verifying it exactly as it would verify live documents: signatures per §6.5, chains per §5.3 and §9.1, items against their manifests per §9.4. Nothing about verification changes because the bytes arrived in a file.

**What the bundle is for**, in increasing order of how much it matters: **backup** (your host loses a disk); **migration** (§3.4 tells consumers your identity continues elsewhere, and the bundle is what you carry there to re-sign into the new feed); and **exit** (you are leaving a host that is not on your side). Exit is the case that sets the requirements above — "on demand, without operator approval," "byte-verbatim," "includes received items," "includes the photos." An export mechanism a hostile operator can withhold, degrade, or serve incomplete is not an exit; it is a courtesy.

## 15. Encrypted Content (OPTIONAL)

**Status: never independently reviewed.** This layer is OPTIONAL and MUST NOT be required for core conformance at any level. It defines no new signing construction (§6.1): encryption changes what the content *is*, not how it is signed. An encrypted item is an **ordinary Open Feed signed item** whose content is an opaque payload in an `_enc` field. Nothing about signing, author binding, `_feed_url`, versioning, tombstones, or the manifest changes: the core commits to the ciphertext exactly as it commits to cleartext, and the host serves bytes it cannot read.

The guarantee is §11.3's, and implementations MUST convey it rather than bury it: **encrypted content is exactly as private as the recipient's key custody**, so this is not a defence against your own host. The honest place it earns its keep: content published to a world-readable feed that only a named audience should read, and content crossing hosts that are not all trusted equally. A family archive on a public CDN is opaque to the CDN, to crawlers, to archivers, and to every host except those holding an audience member's key. What stays cleartext regardless is §11.4's list.

### 15.1. The encryption key

A recipient publishes an X25519 key in their own identity document's `keys` array. The core's `crv`/`use` constraints bind signing keys only (§4.1), so this needs no core change and core verifiers ignore it.

```json
{ "kid": "enc-1", "kty": "OKP", "crv": "X25519", "use": "enc", "x": "…", "iat": 1736899200 }
```

`use` MUST be `"enc"` and `crv` MUST be `X25519` (RFC 8037). The key MUST be published in the **recipient's own** identity document: a sender MUST resolve a recipient's encryption key from that document and MUST NOT accept one supplied by any third party, including a roster (§15.4). This is the check that stops a roster owner, or a host, substituting a key it controls. Because the identity document is chained and pinned (§5), *substituting* a published encryption key is as detectable as substituting a signing key. What this does **not** cover: whether the sender wrapped to the *right* people is a client-side act that is never published, and no observer can check it (§15.6).

**Lifecycle — it is not the signing-key lifecycle.** §4.3–§4.5 are written for signing keys and mean something different, or nothing, here. Implementations MUST NOT reuse that machinery by analogy:

- **Retention inverts.** A rotated-out signing key MAY be dropped after 30 days (§4.3). A rotated-out encryption key MUST be retained by its owner **indefinitely**, because every ciphertext ever wrapped to it — including items in *other people's* feeds — is frozen against it. Dropping it destroys readability permanently.
- **`revoked_at` has no verification effect.** For an encryption key it means senders MUST NOT wrap *new* content to it. It does not invalidate existing ciphertext, cannot un-decrypt anything, and no verifier checks it. It is an instruction to encryptors, and an unenforceable one.
- **There is no recovery key for decryption.** §4.5's recovery key restores *identity continuity*; it cannot restore *readability*. A user who loses their encryption private key loses every encrypted item ever sent to them, irreversibly, with a perfect backup of every byte on disk. **This is the only failure mode in Open Feed that destroys content**, and it is user-triggered. Any implementation offering encryption MUST provide key backup and MUST state this consequence plainly at the moment the user opts in.
- **Migration must carry it.** §3.4 requires no secret to survive a migration except the offline recovery key. Add encryption and the private encryption key becomes a second must-survive secret, retained forever. Recovery-based migration recovers the *name*, not the *archive*: the recovered identity is readable by others and unreadable by itself. Encryption keys MUST be cumulative in the identity document — never dropped — so a migrated identity's old and new eras stay decryptable.

### 15.2. The envelope

`_enc` carries a **JWE JSON Serialization** (RFC 7516) with `alg`: `ECDH-ES+A256KW`, `enc`: `A256GCM`, and ephemeral X25519 keys per RFC 8037. Recipients are **untagged**: a per-recipient header carries `alg` and `epk` and MUST NOT carry `kid`, so the audience is not disclosed by the item and a reader trial-decrypts each slot until one opens — at family scale (N ≈ 10–30) a few dozen X25519 operations, low single-digit milliseconds. The item carrying an `_enc` payload sets `content_text: ""`, the core's marker for "no displayable content" already used by relation items and tombstones (§7.2), so such an item is conformant to the core today; the core does not mention `_enc` and does not need to.

The per-recipient headers are *not* covered by the JWE's own AEAD. Here they are covered by the item's `_sig`, which signs the whole item including `_enc` — but that protection exists only while the envelope stays in its carrier. Anything that lifts `_enc` out of its item (a cache, a bridge, a debugging tool) loses it.

#### 15.2.1. Carrier binding (MUST)

**The envelope is not context-free.** It MUST name the item it belongs to, and a decrypting client MUST reject it if the names disagree. The sealed plaintext MUST be a JSON object carrying at least:

```json
{ "id": "<the carrier item's id>",
  "authors": [{ "url": "<the carrier item's author>" }],
  "_feed_url": "<the carrier item's _feed_url, if it has one>",
  "content_text": "…" }
```

On decrypt, a client MUST compare the sealed `id`, `authors[0].url`, and `_feed_url` against the outer item's, and MUST discard the payload on any mismatch — rendering nothing, attributing nothing.

**Why this is a MUST.** Without it the following works. Eve fetches an encrypted item from a world-readable feed. She cannot read it. She copies the `_enc` blob verbatim into a new item with a fresh `id`, her own `authors`, her own `_feed_url`, and any `_rel` she likes, and signs it with her own key. Every core check passes: valid signature, valid author binding, `_feed_url` matches the feed it is served from, fresh `id` so §7.5's exclusivity rule is not triggered, and an ordinary manifest commits it. Any audience member's client then decrypts it and renders the original author's private words **attributed to Eve, in a context Eve chose**. What makes this worse than ordinary misattribution: **Eve does not need to be in the audience.** In a cleartext world a copier can only misattribute what they could already read; here the capability is strictly broader, and it works against exactly the people the encryption was for.

This check lives at the **decrypting client**, not the core verifier: the core still commits to opaque bytes and still has one construction. `tmp/enc-prototype.js` demonstrates both the attack and the rejection.

### 15.3. Attachments

Encrypted attachments need no gate, no key-distribution mechanism, and no streaming construction. Encrypt the bytes with a fresh per-blob symmetric key (AES-256-GCM) and publish the **ciphertext** at an ordinary public URL — opaque bytes, so CDNs cache it, `Access-Control-Allow-Origin: *` holds, static hosting holds. The attachment entry (§7.4) is unchanged and `_sha256` is the hash **of the ciphertext**, so integrity is verifiable *by anyone, without any key*, from a signed item: a host that swaps bytes is caught by a party who cannot read either version, and AEAD gives plaintext integrity on top. The per-blob key travels **inside the item's already-encrypted content**, so whoever can read the caption can decrypt the photo — no second audience, no second roster, nothing new to revoke. Single-shot AES-GCM decrypt into a blob URL is sufficient for photo-sized media; streaming AEAD is only needed for video and is out of scope.

The one real cost: **thumbnails must be generated client-side at upload** and published as further encrypted attachments, because the host cannot see the image. That is the standard trade in every end-to-end product, and it buys the deletion of an entire authorization mechanism.

### 15.4. Group audiences: the roster

§11.2 states the rule this implements: **any audience larger than one requires a membership document.** A **roster** is a chained, signed, encrypted document listing an audience's members. It is an ordinary chained document under §5.4 and §5.3 — `.json` URL, retained prior versions at derived URLs, pinned and walked exactly as a manifest is (§9.1) — and defines no new mechanism.

```json
{ "url": "https://pence.family/~mom/",
  "circle": "https://pence.family/~mom/circles/family.json",
  "seq": 3,
  "prev": "…",
  "updated": 1739577600,
  "_enc": { "…": "JWE wrapping the member list to each member's published enc key" },
  "_sig": "…" }
```

- The sealed member list is an array of `{ "identity": "<identity URL>" }` entries. It MUST NOT carry members' encryption keys as authoritative values: a sender MUST resolve each member's key from that member's own identity document (§15.1).
- Because the roster is chained, **rollback is detected**: a host cannot re-admit a removed member by serving a stale version.
- Members added at version N cannot read content wrapped before N; members removed at version N keep whatever they already fetched. There is no retroactive revocation, and there cannot be.

An item wrapped to a circle MUST name the roster version it used:

```json
"_circle": { "url": "https://pence.family/~mom/circles/family.json", "seq": 3, "hash": "…" }
```

A reader holding roster version M who sees an item claiming `seq < M` MUST surface it as **stale-audience** before rendering or replying, since the item may have been wrapped to someone since removed. Slot count versus roster size is a consistency check: a roster of eight and an envelope of nine slots means someone extra.

**Two limits, stated rather than solved.**

- **The staleness window is real.** A replier wraps to the roster version they hold. If the owner removed someone at version 3 and the replier still holds version 2, that person reads the reply. `_circle` makes the staleness *visible*; it does not close the window. Nothing short of rekeying does.
- **Withholding is not rollback.** A host need not serve a stale roster — it can simply decline to serve the newest version to a chosen replier, and pin-and-walk cannot distinguish "no new version" from "new version withheld." The detection path is the one that already exists for every other chained document: a roster is chained, so a peer's published pin (§16.1) naming a higher roster `seq` than you have been served is exactly §16.2.2's re-walk signal. A member who sees other members citing a higher `seq` than they have been served — whether from a `_circle` field or a published pin — MUST treat it as a compromise signal and MUST NOT wrap new content until they can fetch that version. This narrows withholding from undetectable to detectable-by-a-comparing-peer; it does not make it preventable.

**Status: rosters are not ready to ship**, and MUST NOT be presented as ready until all four of the following hold:

1. A prototype models **withholding**, not merely rollback. `tmp/circles-prototype.js` covers rollback only and is a spike, not evidence.
2. That prototype uses **identity-document-published encryption keys** (§15.1), not freestanding ones.
3. Carrier binding (§15.2.1) is exercised on **roster-wrapped replies**, not only on author-published items.
4. The cost of the **N identity-document fetches and pins that a single reply implies** is measured, not assumed.

Ship §15.2 (broadcast to a known audience) and audience-of-one messages first; those are complete.

### 15.5. Metadata, and the two channels

Encryption does nothing about §11.4's cleartext metadata, and on a published feed the reply graph is the loudest part of it. The structural answer splits the two channels. **Posts** intended for an audience are **published, encrypted**, keeping the manifest's completeness proof, the export bundle (§14), migration, and durability — at the cost that *this identity posted at this time* is public. **Interactions** on that content are **delivered, not published** (§11.1), POSTed to the audience's inboxes with no `_feed_url`, so `_rel` and its `to` targets never land in a world-readable file — at the cost that replies have no completeness proof and someone joining later cannot reconstruct old threads.

**This half of the design is enforced at the recipient, not at the author**, and implementers MUST understand that before relying on it. Delivering an interaction keeps it off the public web only for as long as every recipient declines to republish it. §11.1.1 makes that a MUST and §16.4 applies it to the replies endpoint — the surface most likely to undo it. An audience member whose client ignores §11.1.1 defeats this for everyone in the audience, silently, and no other participant can detect it. This is a genuine trade, not a free win: state the choice to users; do not make it silently.

### 15.6. Security considerations

1. **The wrap-list is unverifiable.** Whether an author wrapped to the right people is not checkable by anyone — not by observers, not by other audience members. With untagged recipients only the slot *count* is visible. This is the first rule in Open Feed that is not checkable from bytes by a third party, and it is why "consent is membership in the wrap-list" is weaker than it sounds: membership is not auditable, so it degrades to a *claim* about membership.
2. **A reading key-custodian leaves no trace.** Every other adversary in §13.2 surfaces: rewriting the past forks a chain, dropping content violates a manifest invariant. A host that simply *reads* what it holds the key for is invisible.
3. **No forward secrecy.** Compromise of a long-term X25519 key decrypts every past ciphertext wrapped to it.
4. **No retroactive revocation.** Once wrapped, content is readable by that key-holder forever. Unlike an authorization grant, there is nothing to revoke.
5. **Key loss destroys content** (§15.1). The only such failure mode in the protocol.
6. **Recipient-count DoS.** A reader trial-decrypts every slot, so an item with a very large recipient count is a cheap denial of service against anyone who opens it. Clients MUST cap the recipient slots they will attempt (RECOMMENDED: 256) and treat an item exceeding it as unreadable rather than grinding.
7. **Tombstones.** §7.3's allowlist already removes `_enc` from a tombstone, since only listed fields survive. This is why that rule is an allowlist: a denylist naming today's content fields would have left ciphertext in place and deleted nothing.
8. **Do not encrypt to yourself and call it private.** An item wrapped only to its author is still published metadata (§11.4) and is still on someone's host. If content must not exist publicly, do not publish it.
9. **Bridges amplify the metadata leak, and are forbidden from doing so.** The leak is bounded by the surface the author chose. A gateway relaying an encrypted item to a foreign network moves it to a different audience with different reach, which is why Appendix E forbids a gateway from emitting content it cannot read **in any form, including a placeholder**.

### 15.7. Conformance

This layer defines no new conformance level; it refines core Level 1+. A client that renders encrypted content MUST implement carrier binding (§15.2.1) and MUST NOT render a payload that fails it. A client that encrypts MUST resolve each recipient's encryption key from that recipient's own identity document (§15.1). An implementation offering encryption MUST provide encryption-key backup and MUST disclose, at opt-in, that key loss is unrecoverable and that the guarantee is bounded by recipient key custody (§11.3). Rosters (§15.4) MUST NOT be presented as ready for use until that section's four conditions are met.

## 16. Conventions: Follows, Pins, and Thread Discovery (OPTIONAL)

Three OPTIONAL facilities, referenced from the identity document (`follows` / `pins` / `replies`, §3.2), none required for core conformance and none needed to verify anything. A consumer never needs anyone's follows, pins, or replies endpoint to verify an item, a manifest, or an identity document. They introduce no new signing construction: a published follows or pins document is an ordinary Open Feed signed document (§6).

**What is deliberately not here: the compare rule.** §5.3.1 defines it and §12 makes it a Level 1 MUST, because the core's transparency claim rests on it. What this section supplies is the other half — a *supply of second observations* to compare against. Applying the rule to observations you already hold costs nothing and discloses nothing; publishing pins discloses whom you read and when, which is why publication stays opt-in and the rule does not.

**Scope and privacy — read before publishing anything.** Publishing is opt-in and both documents MAY be kept client-local: a hub that polls feeds and pins what it sees needs no published document at all, since the enforcement value is entirely local. Publishing trades privacy for the network properties below. **Follows publish who you read** — your reading graph, in cleartext, including your private petnames if entries carry them (§16.3). **Pins publish who you read *and when***: each pin's `observed` time reveals when you last polled a given identity, so a pins document is a strictly richer social-graph disclosure than a follows document. **A pin leaks no content** — `hash` is a preimage-resistant SHA-256, and the ids, versions, and timestamps inside a pinned manifest cannot be recovered from it. **Signing does not make a pin true**: it proves its author *asserts* it observed `(url, seq, hash)` at `observed`, not that the observation is honest, and a lying witness can assert a hash it never saw. The properties below are evidential, not proofs, and gain strength from *multiple independent* witnesses.

### 16.1. The `pins` document

An identity MAY publish a pins document recording versions of chained documents it has observed, and reference it from its identity document via `pins`.

```json
{
  "url": "https://reader.example/",
  "pins": [
    { "url": "https://test.example/openfeed.json", "seq": 1, "hash": "mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y", "observed": 1739577600 },
    { "url": "https://test.example/manifest.json",  "seq": 1, "hash": "GPbjqBsIVHRzgMlbfqXu5IU29SqEhMQnAlukdt8j7DY", "observed": 1739577600 }
  ],
  "updated": 1739577600,
  "_sig": "..."
}
```

`url` (MUST) is the publisher's identity URL, and author binding applies — the `_sig` `kid`'s identity MUST equal it. `pins` (MUST) is an array of pin entries and MAY be empty. `updated` (MUST) is the publication time in Unix seconds. `_sig` SHOULD be present, and MUST be if the document is published: a detached JWS by a key valid in the publisher's identity chain (§6).

Each pin entry carries `url` (MUST — the **chained document** observed: an identity document, a manifest, or a roster; the URL disambiguates all of an identity's chains uniformly), `seq` (MUST — the observed version counter), `hash` (MUST — the §5.1 hash of that version's full published bytes, the same value its successor names in `prev`), and `observed` (SHOULD — wall-clock Unix seconds when the publisher **first** observed this `(url, seq, hash)`). A pin names one version; to attest a chain's progression, publish multiple pins at successive `seq` or re-publish over time. Unknown fields MUST be preserved when re-serializing, and timestamps here are Unix seconds throughout, since `observed` is compared against key `iat` / `revoked_at` (§4).

A pins document MAY itself carry `seq` and `prev`, in which case it is a chain with the identical mechanics of §5 and §9.1. Chain it when you want consumers of your pins to detect a host silently dropping a past observation; an unchained document is a signed "latest snapshot," sufficient for §16.2.1.

### 16.2. Consuming pins

A consumer that fetches peers' signed pins documents gains four properties. This section specifies observable behaviors; it does **not** define a gossip transport (peer discovery, flooding, anti-spam), which remains future work. Follows lists are the natural peer set: the identities you follow are the pins you fetch.

**16.2.1. Anti-equivocation.** A pin entry is an observation in transferable form, so a peer's signed pin is a valid second observation for §5.3.1. Equal hashes at the same `seq` are **corroboration**; different hashes are **equivocation**, and §5.3.1 applies unchanged. A legitimate post-theft fork (§5.5) surfaces here too and is not a false positive — the chain genuinely did fork — so run §5.5 resolution before treating a divergence as unresolved compromise. What this adds is **reach**: without published pins, a consumer compares only against what it happened to fetch itself, so a host serving each reader a consistent private branch is never caught. An **aggregator** is just a consumer that fetches many pins documents and compares pairwise; it needs no special authority, because every input is independently signed. This is also the practical defence against the genesis-equivocation attack in §4.5 — one relative's pin, compared once, defeats it.

**16.2.2. Recovery propagation.** A recovery-based migration (§3.4) cannot publish a `successor` from the lost domain, so consumers who lost the old pointer may never learn of it. A trusted peer's pin naming a `seq` for the old identity **beyond** the consumer's own pin is the signal to re-walk: the consumer fetches that identity's history, walks to the peer's `(seq, hash)`, and discovers the `predecessor` and recovery co-signature there. The pin says "look again"; verification remains the consumer's own. The same signal detects roster withholding (§15.4).

**16.2.3. Informal timestamping.** A signed pin with `observed = T`, from an author the consumer trusts, is a **witnessed assertion** that `(url, seq, hash)` existed by time `T`. Independent witnesses converging on a `(seq, hash)` at or before `T` establish a family-scale lower bound on when that version existed — the external time anchor §4.4 and §13.10 defer to. A colluding witness can backdate `observed`, so strength comes from independence.

**16.2.4. First-contact corroboration.** First contact with any identity is TOFU (§5.3). Consistent signed pins of the same `(seq, hash)` from identities the consumer **already** trusts soften this — an informal web of trust over first contact. It never replaces verification of the chain from that pin forward; it only raises confidence that the pinned starting point is the real one.

### 16.3. The `follows` document

An identity MAY publish a follows document and reference it via the `follows` field.

```json
{
  "url": "https://reader.example/",
  "follows": ["https://test.example/", "https://gran.example/~gran/"],
  "updated": 1739577600,
  "_sig": "..."
}
```

`url` MUST be the publisher's identity (author binding, §6.6), `_sig` SHOULD be present when published, and `updated` is Unix seconds. `follows` is an array whose entries are either an **identity URL string** or an **object** `{ "url": <identity URL>, ... }` carrying optional extension keys — a `name` petname, or a `feeds` array narrowing which of the followed identity's feeds are polled; consumers MUST accept both forms and MUST preserve unknown keys. The follows document doubles as the natural peer set for consuming pins (§16.2) and carries no authority over content.

### 16.4. The `replies` endpoint

An identity MAY expose thread discovery via a `replies` field in its identity document. This is **discovery, not trust**: everything it returns is obtainable by polling the participants' feeds, where reply items are canonically published (§7.5). Its only unique reach is replies from identities a consumer does not already follow — near-nothing at family scale, and a spam surface at any other. It is specified rather than omitted because it is the largest privacy footgun the protocol has, and an implementer who wants thread discovery will build *something*; better that it comes with §16.4.1 attached.

The endpoint is **a read view over the inbox**, not a second store: everything it returns was delivered by `POST {inbox}` (§10) and is held verbatim there, so build it as a query rather than a parallel collection to keep in sync. It keeps its own URL rather than being folded into `GET {inbox}`, because §10.1 reserves authenticated GET on the inbox for the owner reading their own mail, and an inbox may hold delivered-private content (§11.1) — one URL serving both an owner-scoped private view and an unauthenticated public projection is the shape most authorization bugs take.

```
GET {replies}?item={percent-encoded-item-id}
```

The response is a **JSON Feed** (§7.1) whose `items` are the reply items reproduced **byte-verbatim** as received, with the queried id echoed in a feed-level `_replies_to`. Optional params: `since` (ISO 8601), `limit` (default 50); pagination via the feed's own `next_url`. Because the response is a JSON Feed, consumers reuse the feed parser, and the verbatim rule — fields never added, dropped, or reordered; absent fields stay absent, never `null` — is the rule that already governs feeds. Consumers re-verify each reply's signature and build the tree from `_rel` `reply` entries, using `root` entries (§8.1) to index deep replies. The endpoint MAY be moderated or filtered; consumers handle gaps gracefully.

#### 16.4.1. Published replies only (MUST)

> An item with **no `_feed_url`** MUST NOT appear in a replies-endpoint response, whatever its `_rel` targets. Its author delivered it rather than publishing it (§11.1.1), and this endpoint MUST NOT overrule that.

The check is a single field lookup inside the signed bytes — the author's own statement that the item is published — so it costs nothing and needs no manifest fetch (§10.3 forbids requiring one). An author who later promotes a delivered item to published, by bumping `_version` and adding `_feed_url`, makes it eligible from that revision onward; a receiver serves whichever revision it actually holds.

An implementation that skips this check converts every delivered-private interaction it receives into a public one, silently and by default. §15.5 routes group interactions down the delivered path precisely to keep a reply graph off the public web, and that design depends entirely on this rule holding here.

### 16.5. Conformance

This section defines no new conformance level; it refines core Level 1+. A consumer that publishes follows or pins MUST sign them with the core construction (§6) and set `url` to its own identity. A consumer that consumes peers' pins MUST treat each pin entry as an observation for §5.3.1's compare rule. An implementation serving a `replies` endpoint MUST enforce §16.4.1. All three facilities remain OPTIONAL: a peer that publishes none of them is fully conformant, and no consumer may require them of a peer.

## Appendix A: Media Types

| Document | Content-Type (serve) | Accept (consume) |
|----------|---------------------|------------------|
| Identity document, manifest, retained prior versions, roster, follows, pins, export bundle, inbox body | `application/json` | any JSON; reject non-JSON |
| Feed, replies-endpoint response | `application/feed+json` | that, or `application/json` |

All served with `Access-Control-Allow-Origin: *`.

## Appendix B: Identifier Aliases (OPTIONAL)

Two aliasing layers, both optional, both subject to the same rule: **an alias resolves to the identity URL and stops there.** Clients MUST then fetch the identity document as the authoritative source, and an alias document that disagrees with it is authoritative for nothing. **WebFinger** (RFC 7033) gives `@user@domain` identifiers: `GET /.well-known/webfinger?resource=acct:mom@pence.family` returns the identity URL in `aliases` / `rel="self"` links. Purely a human-friendly layer; nothing else depends on it.

**`did:web`** gives machine legibility to ecosystems that resolve DIDs. An identity URL maps mechanically — `https://pence.family/~mom/` → `did:web:pence.family:~mom`, resolving to `https://pence.family/~mom/did.json`, same-origin and derivable — and a publisher MAY serve a DID document there carrying the same Ed25519 public keys as its `keys` array. Nothing in this protocol reads it, and **no signature crosses in either direction**: Open Feed signs the JWS signing input directly (§6.1), while the DID ecosystem's Ed25519 suites sign other bytes. What crosses is the *key*, which becomes resolvable by tooling that speaks DIDs at the cost of one static file. A publisher serving one MUST keep it consistent with `keys` — a stale DID document advertising a revoked key is a liability the identity chain would otherwise have retired (§4.4).

## Appendix C: Real-Time Updates (OPTIONAL)

JSON Feed 1.1 already defines a `hubs` field for WebSub. Feeds MAY advertise one; subscribers get pushes instead of polling and MUST still verify item signatures, since the WebSub hub is untrusted infrastructure. Nothing Open-Feed-specific is added. Real-time *inbox* notification to one's own clients (SSE, WebSocket) is implementation-specific.

## Appendix D: Test Vectors

All vectors are computed and self-verifying, regenerated by `tmp/regen.js`, which validates the canonicalizer against D.2's known SHA-256, cryptographically self-verifies every `_sig`, confirms each manifest entry's hash equals its item's full published bytes, and checks that every vector string below appears verbatim in this document. Keys are **deterministic, testing-only** Ed25519 keys — not for any real identity.

### D.1. Keys

Identity: `https://test.example/`. Public keys (`x`, base64url):

| `kid` | role | `x` |
|-------|------|-----|
| `test-key-1` | primary | `EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0` |
| `recovery-1` | recovery | `1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk` |
| `test-key-2` | rotation | `KOvPWZT35Xzwcsw6vfQzO3idc8oa67BdHZ0oXpriOQA` |

JWS header for every `_sig` below (signed by `test-key-1`), and its base64url encoding — the header segment of each `_sig`:

```json
{"alg":"EdDSA","b64":false,"crit":["b64"],"kid":"https://test.example/#test-key-1"}
eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0
```

### D.2. Signed Item

Canonical bytes (no `_sig`; `ö` is NFC U+00F6, wave is U+1F44B), then the resulting `_sig`:

```
{"_feed_url":"https://test.example/feed.json","_version":1,"authors":[{"url":"https://test.example/"}],"content_text":"Hello, wörld! 👋","date_published":"2025-01-15T12:00:00Z","id":"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6"}
eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..MnPQcvR9PB4E_pJ1YZTggDoRwu0_uOcPegHfebTbKpdtzv8k4O8tbLtnk4VNDyjGa3mWLc15wtkMRK7nTVcoDQ
```

SHA-256 of those canonical bytes (hex): `7176563ef95f0a466379e161081a05f591ea6be60b8ccf8e613801d33c16d168`

**Full published bytes** — the item *with* its `_sig`, which is what the manifest commits to (§9):

```
{"_feed_url":"https://test.example/feed.json","_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..MnPQcvR9PB4E_pJ1YZTggDoRwu0_uOcPegHfebTbKpdtzv8k4O8tbLtnk4VNDyjGa3mWLc15wtkMRK7nTVcoDQ","_version":1,"authors":[{"url":"https://test.example/"}],"content_text":"Hello, wörld! 👋","date_published":"2025-01-15T12:00:00Z","id":"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6"}
```

Base64url SHA-256 of those bytes — the item's manifest commitment: `czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8`

The two hashes are of different things and both appear in the protocol: the *hex* hash is over the canonical bytes **without** `_sig` (the signing payload, §6.3), while the manifest commits to the **full published bytes** including `_sig` (§5.1).

### D.2b. Signed Relation Item (a reply)

An interaction is an ordinary item carrying `_rel` (§8). Full published canonical bytes, signed by `test-key-1`:

```
{"_feed_url":"https://test.example/feed.json","_rel":[{"to":"https://gran.example/~gran/feed.json#urn:uuid:00112233-4455-6677-8899-aabbccddeeff","type":"reply"}],"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..yz_Ih17djbgJCwlU0E5nkJZaVRIL0eiqU9wDV6z9KpbD8A_hR-E99qWvQPlnZFfs6XO5azgY5P0wfIhoyh7fBQ","_version":1,"authors":[{"url":"https://test.example/"}],"content_text":"Thanks, Gran!","date_published":"2025-02-15T09:00:00Z","id":"urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8"}
```

Manifest commitment (base64url SHA-256 of those bytes): `vdS1bhnFd5XsIugXNLR0k-7UHDxRJi7DO6XRWF5l_gU`

### D.3. Manifest (genesis, `seq: 1`)

Full published canonical bytes (signed by `test-key-1`, `updated` = 1736899200). Each `items` entry is `[version, hash]`, the hash being D.2's full-published-bytes commitment:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..n0gZ_Mgtf74bg1ehRaJ82un3FSkZI4SPw6-25A6WyOfjA5pfQP8XWidZ4EG8EBeTtqHQkIBZH46cbe5syZDaCQ","feed_url":"https://test.example/feed.json","items":{"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":[1,"czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"]},"seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Base64url SHA-256 of these canonical bytes (this is `seq: 2`'s `prev`): `8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI`

### D.3b. Manifest, `seq: 2` (chained)

Adds D.2b and chains to the genesis via `prev`. Signed by `test-key-1`, `updated` = 1739577600. The retained `seq: 1` version is served at the derived URL `https://test.example/manifest/1.json` (§5.4).

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..bAwxoHhZ0S2Rs7gP02G4lsa8FnVi0b1l6smpnquUtZxLxUrUQaCvUV1xFoFzorYS6c0rt_FragFikpo1PVmZDw","feed_url":"https://test.example/feed.json","items":{"urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8":[1,"vdS1bhnFd5XsIugXNLR0k-7UHDxRJi7DO6XRWF5l_gU"],"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":[1,"czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"]},"prev":"8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

Its `prev` equals the D.3 genesis hash, demonstrating manifest chaining (§9.1), and each `items` entry names the exact bytes of D.2 and D.2b respectively.

### D.4. Identity Document, `seq: 1` (genesis)

Full published canonical bytes — this exact string is what `seq: 2`'s `prev` hashes. Note the shape: one `feeds` array (§3.2.1), each entry naming a manifest.

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..HpP48LHgQHTPCflFzuTlhluQfv1bvDlgE_Ggn3uUpMU2DBF7FUvk-Qi66-5mmH6dEg7KlPZr1-kEaYY2CvFcDA","feeds":[{"manifest":"https://test.example/manifest.json","rel":"primary","url":"https://test.example/feed.json"}],"inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"name":"Test Identity","seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Hash (base64url SHA-256, = `seq: 2`'s `prev`): `vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho`

Once `seq: 2` exists, this version is served byte-identically at `https://test.example/openfeed/1.json`, derived by §5.4.

### D.5. Identity Document, `seq: 2` (rotation)

Adds `test-key-2`, revokes `test-key-1`. Signed by `test-key-1` — the continuity key, valid in `seq: 1`, revoked by the very version it signs, and still listed in it (§5.2):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..qpsmemLozSvp8vaFVkCHmJM_iWJWc5YGfcKAqyGTsBxt2hPrUGNMiC-7-b7NSHWyLtSzs2Sd8mlcy_1RnAg0DA","feeds":[{"manifest":"https://test.example/manifest.json","rel":"primary","url":"https://test.example/feed.json"}],"inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","revoked_at":1739577600,"x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1739577600,"kid":"test-key-2","kty":"OKP","x":"KOvPWZT35Xzwcsw6vfQzO3idc8oa67BdHZ0oXpriOQA"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"name":"Test Identity","prev":"vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

### D.6. Pins Document (§16.1)

A second identity, the reader `https://reader.example/` (key `reader-key-1`), witnesses the owner's identity document (D.4, `seq: 1`) and manifest (D.3, `seq: 1`). Full published canonical bytes:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..r7oXrbWhRVsbjqfRMH9orMexlXhCvm5XHWElijfA0b7tqE1-lMA9JQcJksozDtQSBQr2oIWl4pyUAZODSKj7Ag","pins":[{"hash":"vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho","observed":1739577600,"seq":1,"url":"https://test.example/openfeed.json"},{"hash":"8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI","observed":1739577600,"seq":1,"url":"https://test.example/manifest.json"}],"updated":1739577600,"url":"https://reader.example/"}
```

The two `hash` values equal, respectively, D.4's identity-document hash and D.3's manifest hash — so any consumer holding its own pin of either chain can run the compare rule (§5.3.1) against this document.

### D.7. Follows Document (§16.3)

`https://reader.example/` follows the owner and a grandparent. Full published canonical bytes:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..7rVRo4zwaPw_ALwAxf9DEmiTkdFZQRizEEKtKJ_ucJ0kNKUYsNB1vA-WJnht7QefhQWWogPbWRiR7PJiHDk6Bw","follows":["https://test.example/","https://gran.example/~gran/"],"updated":1739577600,"url":"https://reader.example/"}
```

**Validation recipe.** Verify all eight `_sig` values (D.2, D.2b, D.3, D.3b, D.4, D.5 against `test-key-1`; D.6, D.7 against `reader-key-1`). Recompute D.3's full-bytes hash and confirm it equals D.3b's `prev` (manifest chaining); recompute D.4's full-bytes hash and confirm it equals D.5's `prev` (identity chaining). Recompute the full-published-bytes hashes of D.2 and D.2b and confirm each equals the `hash` half of its `items` entry in D.3b (content commitment, §9). Confirm D.6's pinned hashes equal the D.4 and D.3 hashes. `tmp/regen.js` performs all of these.

## Appendix E: Interoperability and Gateways

The cheapest interoperability is not a bridge, because Open Feed's wire formats are already other people's wire formats. That route is four things, none of which requires anything in this specification to be implemented: a JSON Feed that plain readers already consume (Level 0, §12), an Atom or RSS mirror alongside it for the larger installed base, h-card/h-entry markup on the human page, and the optional identifier aliases of Appendix B. Existing third-party bridges already consume that combination. README expands on it. This appendix governs the expensive route.

A **gateway** is a **trusted intermediary, never a transparent adapter**: each target protocol has a different trust primitive, and no bridge can hold a foreign author's Open Feed key. A gateway is an ordinary Open Feed identity — identity document, keys, chained manifest, inbox — so a gateway that equivocates about what it bridged forks its own chain and is caught by §9.1 like any other signer. Everything it must and must not do follows from one rule, applied in both directions:

> **A gateway may not change the terms under which content was published.** Not the **audience** — never widen it. Not the **durability** — never make permanent what was ephemeral. Not the **verification status** — never present an assertion as a signature.

Those three questions are the test for any protocol, including one that does not exist yet.

**Outbound** (Open Feed → foreign network):

- **Delivered-only items MUST NOT be emitted** *(audience)*. An item with no `_feed_url` was kept off the public web by its author (§11.1.1); emitting it is a publication decision the author declined to make.
- **A gateway MUST NOT emit content it cannot read, including as a placeholder** *(audience)*. For an encrypted item (§15) the ciphertext, an "encrypted post" stub, and a bare timestamped entry are all forbidden. The naive reading is that the metadata is public anyway; it is public **incidentally**, as the price of keeping the completeness proof (§11.4), not as a decision to announce. An author publishing opaque bytes at their own URL has accepted that whoever fetches that URL learns they posted. They have not asked a gateway to tell a foreign follower graph the same thing, and §13.8 is explicit that posting cadence is the leak that survives encryption. Skipping is always safe; announcing is not.
- **A gateway MUST NOT claim a completeness guarantee for bridged content** *(verification)*. No target protocol has an analog of the manifest, so the proof does not survive the crossing.

**The two directions are separable, and outbound alone is cheap.** Notifying a foreign network about your *own published* relation item — sending a Webmention for a `to` that dereferences to an HTTP URL, say — mints no proxy identity, ingests nothing, keeps no state, and widens no audience, since the item was already published at your own URL. It needs none of the inbound machinery below. A publisher can do that and never operate a gateway; the trust argument begins at ingest.

**Inbound** (foreign network → Open Feed). This is the half implementations are likeliest to get wrong, because ingest feels like observation. It is publication: an ingested item lands in the gateway's own feed, is committed by its manifest, is retained permanently, and is served with `Access-Control-Allow-Origin: *`.

- **Ingest only what the source published publicly** *(audience)*. Content not addressed to a public audience — followers-only, a direct message, or any protocol's restricted or end-to-end-encrypted content — MUST NOT be ingested. One followers-only post ingested into a manifested feed is a permanent, world-readable, cryptographically-committed disclosure its author never authorized.
- **Do not durabilize the ephemeral** *(durability)*. Content the source protocol expires, or allows to be genuinely withdrawn, MUST NOT be ingested: §9's retention rules turn removal into a permanent public record rather than a deletion. A protocol whose deletions are real is not compatible with a protocol whose deletions are tombstones.
- **Everything ingested is `_unverified`** *(verification)*. §7.5, without exception.

**Proxy identities.** A gateway signs what it ingests, so §6.6 places the gateway in the `authors` entry, leaving the *foreign author* unnamed. A **proxy identity** names them: an ordinary Open Feed identity, minted and key-held by the gateway, one per foreign actor, whose identity document carries that actor's `name`, `bio`, and `avatar`. Attribution becomes **structural** rather than an unverified string in a field the core would otherwise have to define. It is also the only representation available for actors whose native identifiers cannot be URLs — a Nostr `npub`, a phone number, a handle on a closed network.

A proxy identity is **not** a hosted identity in §12's sense, and that distinction is what keeps §14 coherent: its principal never asked for it, holds no keys, and has a real home elsewhere. Because everything a proxy publishes is `_unverified`, it never claims to *be* that person — it claims to mirror them, a claim the gateway can support — so §12's device-generated recovery key, `(seq, hash)` disclosure, and export bundle do not apply: there is no captive user, because there is no user. The price of that carve-out is honesty. A gateway minting proxy identities MUST **disclose** in each proxy's identity document that it is a gateway-operated mirror, who operates it, and where the actor's real home is; MUST **never claim exit** (§14) for a proxy identity; and MUST **withdraw the proxy on the foreign actor's request**, which stands where exit stands for a real hosted identity and is weaker — say so rather than dressing it up. A gateway unwilling to meet these should not mint proxies; ingesting everything under the gateway's own single identity is always available, and costs only per-actor attribution.

**Bridge profiles.** Because the rule above is protocol-independent, a normative profile for a specific protocol is a filled-in table rather than a fresh trust argument. No profile is defined here; README carries the template and the per-protocol survey. A profile MUST fix, at minimum, the identity and object mappings, the `external_url` form, the **audience test** and **durability test** that decide what may be ingested (the safety-critical slots), the update/delete mapping, which foreign objects have no item representation and MUST NOT be invented into `_rel` types, and the failure semantics when the foreign side disappears or is unreachable. Those last two are where implementers improvise, and improvisation at a trust boundary is how the honest-hub model gets quietly abandoned.
