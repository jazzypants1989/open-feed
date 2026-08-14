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

Open Feed is a **transparency** protocol: it makes publication tamper-evident and is deliberately not private (§1, principle 7). What it offers anyone who needs to leave the host serving them is a portable identity, a recovery key that host never held, and a complete signed copy of their own content (§3.4, §4.5, §14). Two OPTIONAL layers are specified here and required by nothing: encrypted content (§15) and the follows/pins conventions (§16).

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
- Userinfo (`user:password@`) stripped — an identity is a place, not a credential, and leaving it in makes one identity two
- Query string and fragment stripped
- Trailing slash appended if absent
- Path treated as case-sensitive

| Input | Normalized |
|-------|------------|
| `https://Alice.Example/~mom` | `https://alice.example/~mom/` |
| `https://example.com:443/~alice/` | `https://example.com/~alice/` |
| `https://example.com/~alice?ref=x#about` | `https://example.com/~alice/` |
| `https://bob@example.com/~alice/` | `https://example.com/~alice/` |

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
| `follows` | MAY | URL of the OPTIONAL follows document (§16). Outside the trust core. |
| `name`, `bio`, `avatar`, `content_warning` | MAY | Profile metadata. `content_warning`, if present, marks all content from this identity as sensitive. |
| `successor`, `predecessor` | MAY | Migration links (§3.4). |
| `_recovery_sig` | MAY | A recovery co-signature — a detached JWS by a recovery key (§4.5) — for recovery-based migration (§3.4) and fork resolution (§5.5). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise; extension fields SHOULD use a `_` prefix. Every identity document is signed and versioned — there is no unsigned or unchained mode — and verification is trust-on-first-observation (§5.3): the signature proves continuity between versions, not first-contact authenticity.

#### 3.2.1. Feed Entries

Each entry in `feeds` is an object:

| Key | Required | Description |
|-----|----------|-------------|
| `url` | MUST | The feed's URL (JSON Feed 1.1, §7.1). No particular form is required — a feed is not a chained document and has no derived version URLs. |
| `manifest` | MUST | URL of that feed's own signed manifest (§9). MUST end in `.json`. |
| `rel` | SHOULD | What this feed is, from the token vocabulary (§2.1): `primary`, `activity`, `archive`, or a namespaced absolute URL. Default `primary`. |

- **Exactly one entry SHOULD carry `rel: "primary"`**, and that entry is the identity's authoritative feed — what a consumer reads when it wants "this identity's content." Where a publisher has rotated (§9.2), `primary` is the *current* feed and the older ones carry `rel: "archive"`; a consumer wanting the whole catalog reads every entry. Array order is display preference and carries no authority.
- **Each feed has its own manifest.** Manifests are keyed by `feed_url` (§9); one manifest never commits two feeds.
- **Every listed feed is manifested.** There is no unproven feed, so §9.3's invariants apply everywhere without a per-feed conditional in any verifier. The cost is a chain advance per publication, which §9.2 bounds by *time* rather than by activity: a high-volume feed advances its manifest on a schedule, not once per item.

The identity document commits to each manifest by **URL**, not by hash. Content freshness is proven by the manifest's own signature and chain (§9), so ordinary publishing does not re-sign or re-version the identity document. The identity chain versions identity state, which changes rarely (5–20 versions over a lifetime); the manifest chain versions content, which changes often. Two chains, one pinning discipline.

### 3.3. Fetching and Redirects

When fetching an identity document: follow at most 5 redirects; MUST NOT follow a redirect to a different origin; the response MUST parse as JSON (reject `text/html` or any non-JSON Content-Type; accept `application/json`); the response MUST carry `Access-Control-Allow-Origin: *`, as every publicly-readable document must, so browser Level-1 readers work without a proxy. A cross-origin redirect is never identity equivalence — migration is expressed in-band (§3.4), not with redirects — while same-origin redirects are followed normally.

### 3.4. Migration and Recovery

Migration and recovery are one operation — *this identity continues over there* — differing only in **which key attests**. There are three occasions for it: you move hosts by choice, you lose your domain, or **you leave a host that will not cooperate** (§14). The third is the one the mechanism must be judged against, because it is the only one where the other party is adversarial.

To move from `https://old.example/~alice/` to `https://alice.new/`:

1. Establish the new identity (new identity document, new or same keys), adding `"predecessor": "https://old.example/~alice/"`.
2. **Cooperative migration** (old domain still controlled): the old identity document publishes a new chain version adding `"successor": "https://alice.new/"`. Consumers follow `successor` when both links exist and agree — each sits inside a signed document, so the pair is a cryptographic cross-signature verifiable against the old identity's pinned chain.
3. **Recovery** (old domain lost): the new identity document additionally carries `_recovery_sig`, a detached JWS by a **recovery key** (§4.5) committed in a pinned ancestor of the predecessor. A consumer holding a pin of the old identity verifies the co-signature against that key and follows `predecessor` even though the old side can no longer publish a `successor`.

A `successor` claim without a matching `predecessor` (or vice versa), unaccompanied by a valid recovery co-signature, MUST NOT be treated as migration. Consumers with no prior pin of the old identity can only treat a recovery-based migration as unverified; out-of-band confirmation is recommended, and §16.1's item-carried pins are how a family propagates such a claim along the traffic it already exchanges. Recovery handles *domain loss*; it does not protect against theft of the recovery key itself. There is no separate recovery-claim document: the chained identity document — signed by an active key, carrying `predecessor`, co-signed by a committed recovery key — *is* the attestation. A consumer that has **not** verified a migration sees the same `id` presented as canonical at two feeds; it MUST treat the higher-`_version` copy as *unverified pending migration verification* rather than as an equivocation to reject, and reconcile once the pair or the co-signature verifies against a pin. This is the one situation where an `id` legitimately carries two live `_feed_url` values.

**The back catalog moves byte-verbatim; do not re-sign it.** Previously-published items carry the old feed's URL in their signed `_feed_url`, so at the new home they would be mere copies (§7.5) unless something reconciles them. Re-signing them would — same `id`s, bumped `_version`, new `date_modified` — and it is the wrong answer: it rewrites the bytes of every item you ever published, invalidating every hash held by every consumer's manifest pin and every pin a peer has shared (§16.1). A wholesale rewrite of the past is the exact pattern §5.3.1 exists to make suspicious, and exit should not require producing it. Instead the verified migration itself carries the binding: republish the back catalog **byte-verbatim** at the new feed and commit those same bytes in the new feed's manifest, where §7.5's canonical test honors the predecessor. Nothing is re-signed, so the id/feed binding rule (§7.5) is not breached and needs no exception — the binding simply follows the identity to its successor feed, and every hash survives intact. **Completeness follows too, as a MUST rather than a courtesy**: the successor's manifest genesis is bound to the predecessor's final state by §9.3 invariant 5, so a migration is a continuation and not a reset. Without that rule a key custodian holds both halves of a cooperative migration — publish the `successor`, stand up the new identity, emit a genesis manifest committing whatever subset it likes — and discards content with no tombstone and no fork.

**Predecessor equivalence.** One named rule closes every dangling-reference problem a migration creates: **for a consumer that has verified the migration, the predecessor's identity and feed URLs are equivalent to the successor's own — transitively across a chain of verified migrations.** The sites that apply it elsewhere (§4.4, §7.5, §9, §9.3 invariant 5, §10.2) are consequences of this rule, not independent rules. Its two direct consequences here: a `_rel` entry's `to` names its target as `{feed_url}#{item_id}` (§8), and those references live in *other people's* signed items, which nobody can re-sign — so a consumer MUST treat `{predecessor_feed}#{id}` and `{successor_feed}#{id}` as **the same target**, or every reply ever received dangles at the new home. And a Level 3 host MUST accept inbox relevance (§10.2) against its owner's **predecessor** feed URLs as well as its current ones, since otherwise the first consequence of exercising §14's exit is that replies to everything you ever published start bouncing as `not_relevant`. Record the predecessor's feed URLs **at migration time** — in the uncooperative case the old identity document may be unreachable afterwards, which is the reason you migrated.

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
| `use` | MAY | **Signing keys**: `sig` (default), `recovery` (§4.5), or `delegated` (§4.6) |
| `alg` | MAY | If present, `EdDSA` |

A **signing key** is any key referenced by the `kid` of a `_sig` (§6.2). The `crv` and `use` constraints above bind signing keys only; extensions MAY define keys with other `crv`/`use` values in the same array, as §15 does. Implementations MUST ignore keys with unrecognized `kty`/`crv`/`use`, so future algorithms and extension key types slot in additively. Algorithm confusion is already closed by §6.2, which requires verifiers to reject any signature whose referenced key's `crv` is not `Ed25519`, so a non-signing key can never be pressed into service as a signing key. But a key the core ignores is a key the core does not **audit**: its presence in a signed, chained document is transparent — adding it advances the chain (§5) — while no core verifier ascribes it meaning, so an extension defining such a key MUST state who checks it and what revoking it means.

Timestamp convention: key and chain fields use Unix seconds (JOSE); content fields use ISO 8601 strings (JSON Feed).

### 4.2. Key Identifiers

The full key identifier used in JWS headers is `{identity_url}#{kid}`, e.g. `https://pence.family/~mom/#key-1`. Verifiers split at the **last** `#`: the left side is the identity URL (normalize it — normalization strips fragments, so the split happens first), the right side is the `kid` to find in that identity's document. Because keys live *in* the identity document, key ownership is structural: the identity named by the `kid` either lists the key or it does not. There is no separate ownership check, and possession of a key that merely *verifies* proves nothing about any identity.

**A `kid` permanently names one key.** Within an identity, `(identity_url, kid)` is bound to the key material first published under it — `kty`, `crv`, and `x` — and MUST NOT be rebound to different material in any later version; a new key takes a new `kid`. Rebinding is not a naming preference but a takeover that passes every other stated check: a successor keeping `kid: key-1` and swapping its `x` satisfies both §5.2's "valid in the previous version" and §5.3 step 1's "listed in the document itself," because the label is what those rules match on. Verifiers MUST compare key **material** across a chain hop, not `kid`s. The rule also protects the archive, since §6.5 resolves a `kid` against the *current* document (§4.3): rebind one and every artifact it ever signed stops verifying.

### 4.3. Rotation

Publish a new chain version (§5.2) adding the new key; sign new content and manifests with it; optionally set `revoked_at` on the old key in the same or a later version. Revocation ends a key's *authority*; delisting it ends *verifiability*, and §6.5 resolves a `kid` against the **current** identity document. A key therefore MUST remain listed while any artifact it signed is still served — live items and tombstones, retained manifest and identity-document versions — which, since retention is permanent (§5.4), means a signing key is in practice never dropped. That costs 32 bytes against §13.4's 100-key budget. Delisting one leaves the back catalog's *bytes* still committed by the manifest (§9.3) and its *authorship* unverifiable, and §13.6 says never to attribute unsigned content: the archive does not vanish, it goes anonymous. A key MUST also remain listed in any chain version whose `_sig` it produces, or that version cannot be verified from its own bytes (§5.2).

### 4.4. Revocation

- Signatures on content whose effective signing time (§6.5) is after `revoked_at` MUST be rejected; before, they remain valid.
- Because content timestamps are self-reported, a key thief can backdate. For inbox-delivered items, receivers SHOULD apply the revocation check against **receipt time**, which the sender cannot backdate. Revocation limits damage from honest rotation far more than it stops an active thief (§13.10).
- The pull path has a receipt-time analog. Consumers SHOULD record the wall-clock time each item id was **first observed** in a signed manifest — one timestamp alongside the manifest pin — and check revocation against that. A thief can backdate an item's `date_published` but cannot backdate when a consumer's polling loop first saw a manifest commit to it, so a "years-old" item first entering the manifest after `revoked_at` is rejected. Two scoping rules keep this from rejecting honest content. Key the record on **`(author, id)`**, never on `(feed_url, id)`, so a consumer that followed a predecessor keeps its earlier and stronger observation across a migration. And apply the check only to items **canonical by the ordinary `_feed_url` test** (§7.5): an item canonical here only by the predecessor exception arrived byte-verbatim from a migration, so its signing necessarily predates that event and the self-reported check governs. Consumers with no observation history for an identity fall back to the self-reported check throughout; first contact is TOFU here as everywhere (§5.3).

### 4.5. Recovery Keys

A key with `"use": "recovery"`:

- MUST NOT sign regular content or manifests
- MUST be stored offline, not on the hub — and SHOULD be held where whoever operates the identity's host cannot reach it either, because §13.2's hostile-custodian adversary is defined by access, not by protocol position: for a family hub that means outside the home the operator shares, and for a commercial host outside the operator's custody, or the key checks nobody
- SHOULD be generated at identity creation
- Co-signs a migration for domain-loss recovery (§3.4) and MAY co-sign a chain version for fork resolution (§5.5)

`_recovery_sig` is a **single co-signature, permanently and by design**: a threshold (k-of-n) scheme MUST NOT be layered on by extension. A verifier that does not implement the threshold sees the one co-signature it understands and accepts it, so any such extension fails **open** at exactly the moment it exists to guard — handing a recovery-key thief the choice of verifier. Where one key is not protection enough, the answer is custody of that one key, not more keys.

Because recovery keys are committed in the chain, any consumer holding a pin can verify a later recovery-based migration or fork resolution against the recovery keys present at that pinned `(seq, hash)`. **Which pinned version is not a free choice**: a consumer MUST use the most recent version of the predecessor chain it has verified, not any older ancestor it happens to retain. Retaining observations at every `seq` is what makes a peer's older pin checkable (§5.3.1, §16.1), and reading recovery state out of one would undo every revocation published since — a key retired and replaced years ago would still verify against the version that first committed it. Revocations the consumer never fetched remain invisible to it, which is inherent to a stale pin and is what §16.1's recovery propagation exists to shorten. Recovery restores identity continuity only; §15.1 is explicit that no recovery key restores readability.

Verifiers MAY reject a recovery-based migration while the original identity serves a **conflicting** chain — one advancing with its own `successor` claim, or otherwise contradicting the migration. They MUST NOT reject it merely because the original identity is *still being served*. An uncooperative departure (§3.4) is exactly the case where the old host keeps serving an unchanged chain and simply declines to acknowledge the move; treating "still reachable" as grounds for rejection would hand a hostile custodian a veto over their user's exit by doing nothing at all. Where both sides advance with contradictory claims, that is a fork and §5.5 governs.

**Generation and possession.** Where the recovery key is stored is not the rule that matters; **who generates it and who has ever held it** is. A recovery key generated by the host and handed to the user is not a check on the host, because the host retains the ability to reproduce it. Therefore an implementation hosting identities on behalf of others (§12) MUST provision each hosted identity with a recovery key **generated on the member's own device and never transmitted to the host**; the host receives the public JWK to commit in the chain and nothing else. Where a deployment's onboarding cannot meet this — a purely server-side signup, say — it MUST disclose to the user that the operator can reproduce their recovery key, because that user has no exit (§14). This one requirement is what turns recovery from a *domain-loss* feature into an *exit* mechanism.

**Generation alone is not enough: the commitment must be checkable.** A host that publishes the identity document also chooses what it says, and first contact is TOFU (§5.3). A host can therefore serve the *member's* client a genesis document carrying the member's real recovery key and serve *everyone else* one carrying a key the host holds. Nothing in the member's own view is wrong, so §5.2's self-record does not catch it; at exit, the member's co-signature fails against every consumer's pin while the host produces a competing branch that §5.5 *prefers*. Device generation is defeated without ever being violated. The defence is comparison, and it is cheap because it happens once: an implementation hosting identities on behalf of others (§12) MUST present the member, at onboarding, with the `(seq, hash)` of their **genesis** identity document and a fingerprint of their **recovery key**, in a form suitable for reading aloud or comparing out-of-band; and a consumer MUST apply the compare rule (§5.3.1) to any second observation of a chain version it has already pinned, including one obtained from a peer. One relative comparing one hash defeats the attack. Item-carried pins (§16.1) make this mechanical, remain OPTIONAL, and disclose nothing this requirement does not.

### 4.6. Delegated Keys

A key with `"use": "delegated"` is a signing key whose holder is not trusted with the identity itself. One rule, an exclusion rather than an enumeration:

> A delegated key MAY sign any artifact this specification defines **except a version of the identity document** — never as a continuity key (§5.2), never at genesis — and it is not a recovery key, so it never co-signs a migration or fork resolution (§4.5). Items, manifests, and delivered-only items are all within its authority; keys, revocation, migration links, and profile are not.

The deployment it exists for is §12's: the member's device generates a **root** signing key (an ordinary `sig` key) and a recovery key, and the host receives only a delegated key. The host then publishes on the member's behalf — items, manifests, cadence batches, tombstones — without ever being able to add a key, un-revoke one, publish a `successor`, or alter the delegation itself, because every identity-chain version requires a key the host never held. What remains is stated plainly: a host holding a delegated key can impersonate the member's *content* until the member revokes it. Revocation is an ordinary chain version signed by the root, setting `revoked_at` (§4.4); the pinned chain is the revocation substrate, so a revoked delegation cannot be quietly ignored by any pinned consumer.

The marker is a `use` token rather than an extension field because the two fail in opposite directions. §4.1 requires implementations to ignore keys with an unrecognized `use`, so to a verifier that predates this section a delegated key does not resolve and everything it signed fails **closed** — rejected, never misread. An extension field on an ordinary `sig` key would fail **open**: an old verifier would find the key, verify the signature, and silently ignore the restriction, so a delegated-key thief's identity-chain forgery would verify at exactly the verifiers that do not know what a delegation is.

## 5. The Version Chain

A compromised host or hijacked domain could roll the identity document back to an older version (un-revoking a key) or serve different versions to different readers. The chain makes both tamper-evident to any consumer who has seen the identity even once. This chain versions **identity state** — keys, profile, endpoints, migration links. Content freshness is protected separately by the same mechanism, the signed manifest chain (§9); splitting the two means ordinary publishing advances the manifest chain, not the identity chain, so the identity chain stays short regardless of how often content is posted.

### 5.1. Chain Fields

`seq`, `prev`, `updated`, `_sig`, and optionally `_recovery_sig`, as defined in §3.2. `prev` hashes the *full published canonical bytes* of the predecessor, signature fields included, so byte-preserving storage of old versions is the simplest correct implementation.

There is **one hashing rule in this protocol**, used everywhere a document names another document's bytes: *base64url SHA-256 of the full published canonical bytes, signature fields included.* It is the same value in `prev`, in a manifest's item commitments (§9), and in a pin (§5.3, §16).

### 5.2. Producing a Version

1. Start from the current version; apply changes
2. `seq` += 1; `prev` = hash of the previous version; set `updated`
3. Sign with a **continuity key**: a key that was valid (non-revoked, non-recovery, non-delegated, §4.6) in the *previous* version
4. Retain the previous version, served byte-identically at its derived URL (§5.4)
5. **Record the `(seq, hash)` of the version just produced**, and make that record available to the identity's owner. §13.2's transparency claim assumes an auditor, and an identity cannot audit its own chain without a record of what it actually published — where a host holds a signing key, the member's own or a delegated one signing manifests on their behalf (§4.6), this is the owner's only means of noticing a version they did not ask for. It is a weak check alone; the durable one is comparison by other people (§5.3.1, §16).

The continuity key is often revoked *in the very version it signs*; that is normal rotation, and validity is judged against the previous version's state. The continuity key MUST remain listed in the version it signs, or that version cannot be verified from its own bytes; it MAY be dropped later. Genesis (`seq: 1`) has no predecessor and is signed by a non-revoked key it contains, under the same exclusions — never a recovery or delegated key (§4.5, §4.6).

### 5.3. Consumer Enforcement (Pinning)

A consumer that has verified an identity document at `(seq: N, hash: H)` MUST store that pin. On any later fetch:

1. Verify the new document's `_sig`; the signing key named by its `kid` MUST be listed in the document itself.
2. Walk `prev` links back to `(N, H)`, fetching intermediate versions from their derived URLs (§5.4). These MAY be fetched in parallel, since the consumer knows both endpoints of the range and the URLs are computable; a manifest MAY additionally offer skip links that shorten the walk to O(log) fetches (§9.1.1). At each hop, verify that version's `_sig`, confirm its bytes hash to the value its successor's `prev` names, and confirm its signing key was valid in *its* predecessor — hash linkage alone is insufficient, since a fabricated intermediate could introduce an attacker's key.
3. Reject if `seq` decreased, if any `prev` mismatches, or if the compare rule below fails.

First contact is TOFU: accept and pin. Tampering is detectable from the second observation onward, or immediately for any two consumers comparing. A consumer that cannot connect its pin to the current document — missing retained versions — MUST treat the chain as unverifiable rather than silently re-pin. The consumer separately pins the **manifest** at its own `(seq, hash)` and walks it by the identical procedure (§9.1): the two chains are two applications of one mechanism, pin on first observation, walk `prev` to the pin on every later fetch, treat any divergence as an attack.

#### 5.3.1. The compare rule

> Given any two observations of the same chained document URL at the same `seq` with **different** hashes, the publisher has **equivocated**. A consumer MUST treat this as an attack on that chain: it MUST NOT silently prefer either version, and MUST surface it.

It is stated in the core because it is the rule the whole transparency claim rests on (§13.2): the chains make equivocation *detectable*, and detection is exactly this comparison. A verifier that pins but never compares has built the evidence and thrown it away.

**What counts as an observation, because not every response is one.** A chained document's *tip* URL serves whatever the publisher currently claims, while a particular `seq` is *also* served — byte-identically and forever — at its derived URL (§5.4). An identity document is additionally its own key source (§5.3 step 1), so anyone who can write the tip URL can mint a key, list it, and self-sign a version at any `seq`. An observation is therefore a version the consumer obtained from that `seq`'s **derived** URL, or one whose walk connected it to the consumer's pin. A document that connects to neither MUST NOT fire this rule: it is an unverifiable fetch, and §12's transient-failure ladder governs it. Where a freshly-fetched tip conflicts with a pin, **one fetch of the retained copy settles which case it is** — a retained copy still matching the pin means the tip is forged, while a retained copy that has *moved* is itself the §5.4 violation and is equivocation. This qualification is load-bearing rather than pedantic: without it anyone able to answer a single request can permanently deny a consumer an identity, since the response below is to stop accepting that chain until a human intervenes — and the denial is indistinguishable, to the reader, from that identity's publisher having attacked them.

Provenance is otherwise irrelevant: the consumer's own store, a cached response, a second device. **A peer's shared pin (§16) is not itself an observation.** It is a signed assertion that its author *says* it saw something, which §16 is explicit that signing does not make true, so treating one as a second observation would let any peer freeze any chain for any reader by asserting one false entry. A disagreeing peer pin is a reason to **fetch that `seq` from its derived URL and check** — what the consumer then holds is its own observation, and this rule applies to that.

Two consequences. **Comparison by other people is the durable form** — a publisher's own record (§5.2, step 5) is weak, because a host that knows which client belongs to the owner can serve it the honest branch, but it cannot know which of *many* readers will compare. And **a legitimate fork trips this rule, correctly**: after key theft both branches carry valid continuity signatures at the same `seq`, so the compare rule reports *that* a fork exists while §5.5 is how a consumer picks the honest branch. Run §5.5 resolution before treating a divergence as unresolved compromise. Applying the rule to observations you already hold costs nothing and discloses nothing; sharing pins is optional (§16) and scoped so it discloses nothing new either — §16 supplies the second observations, never the obligation to compare them.

**What follows surfacing.** Surfacing is the MUST, but a property whose whole value is that readers agree is worth little if every reader then behaves differently, so the response SHOULD be uniform: once §5.5 resolution has been run and failed to pick a branch, retain the pin without advancing it, accept no further version of that chain until the divergence resolves or the consumer deliberately re-pins, and keep rendering what was already verified. An equivocation impeaches the chain's future, not the bytes already checked against it.

### 5.4. Retained Versions

Producers MUST retain every prior version of a chained document and serve it at a **derived URL**:

> Take the document's own URL, strip the trailing `.json`, and append `/{seq}.json`.

| Chained document | Version 3 is served at |
|---|---|
| `https://pence.family/~mom/openfeed.json` | `https://pence.family/~mom/openfeed/3.json` |
| `https://pence.family/~mom/manifest.json` | `https://pence.family/~mom/manifest/3.json` |

Every chained document's URL MUST end in `.json`, so the derivation is total — the identity document satisfies this by its fixed path (§3.2) and a `feeds` entry's `manifest` URL is constrained to match (§3.2.1). Prior versions MUST be served **byte-identically** to how they were published; static files at those paths are the natural implementation. The derived path is reserved: a publisher MUST NOT serve unrelated content beneath it. Derived URLs are same-origin by construction, which is what the §3.3 / §13.5 fetch discipline wants. The URL is *derived* rather than named in a signed `prev_url` field because signed bytes are immutable: a publisher who ever moved hosts would retroactively and unfixably break the walk for every consumer whose pin predates the move. Consumers SHOULD cap the versions walked per update (RECOMMENDED: 1000) and the total history bytes fetched (§13.4).

### 5.5. Fork Resolution

Equivocation detection reveals *that* a chain forked, not *which* branch is honest — after key theft, both branches carry valid continuity signatures. A version MAY carry `_recovery_sig`: a detached JWS by a recovery key committed in a pinned ancestor (§4.5), computed over the co-signing bytes of §6.3. A thief of the online key cannot produce it, since recovery keys are offline, so verifiers detecting a fork SHOULD prefer the branch carrying a valid recovery co-signature; a fork where neither branch carries one — or both do, which puts the recovery key itself in question — is unresolvable and SHOULD be flagged for manual review. Producers SHOULD co-sign the first version published after a suspected compromise.

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

Because step 1 removes **both** signature fields, a signer and a recovery co-signer (§3.4, §5.5) compute their signatures over identical bytes, and neither signature covers the other.

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

Every signed document carries its author's identity URL **inside the signed bytes**, and the claimed author MUST equal the `kid`'s identity URL. This prevents republishing someone's signed **item** under a different name: the binding travels with the bytes. For **manifests** and **identity documents** the carrier is the `url` field. For **items** it is the item-level `authors` array, which MUST contain **exactly one entry** whose `url` is the signer's identity URL; feed-level `authors` are not covered by item signatures and MUST NOT be relied on, though a multi-author *feed* still works because every item names its own single author. Clients MUST attribute solely to this entry — its `url` is authoritative, and its `name` is displayable because it sits inside the signed bytes — and MUST NOT display a name drawn from anywhere else, feed-level `authors` included. Bridged content is not an exception: an ingested item is signed by its gateway, so the gateway — or a proxy identity it operates — *is* the author here, and the foreign author is named by that proxy's own identity document (§7.5, Appendix C).

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

Consumers seeing a valid tombstone SHOULD drop cached content and retain the tombstone; higher `_version` wins over any replayed earlier revision. Tombstones SHOULD stay in the feed for ≥30 days, and the manifest remembers them for the life of the feed's chain (§9). Deletion is best-effort: consumers that never re-fetch cannot be forced, and attachment *bytes* referenced by the deleted revision are removed by the host, not by the tombstone.

### 7.4. Attachments and Pagination

Attachments use JSON Feed's `attachments`: the metadata is inside the signed bytes, the referenced bytes are not. Each attachment entry MUST carry `_sha256`, the base64url SHA-256 of the referenced bytes, and consumers MUST treat an attachment lacking one as unverified content (§10.5) — never as part of the signed record. This is a MUST because §13.2 claims full integrity against a serving-path compromise, and that holds only for bytes the signature covers: an attachment referenced without a hash sits outside the envelope entirely, so whoever controls those bytes, including the host, can swap the photo under a signed item undetectably. For a media-first deployment that is the largest integrity gap available, and one required field closes it.

Pagination uses JSON Feed's `next_url`; feeds SHOULD carry at least the 50 most recent items.

### 7.5. Canonical and Copied Items

An item is **canonical** only in the feed its signed `_feed_url` names. The same signed item may legitimately appear elsewhere — a family aggregate feed, a follower's cache, a bridge — as a **copy**. Because the signature travels with the bytes, a copy is still verifiable as *authored* by its signer. But a copy carries **no authority over current publication state**: it does not prove the item is still live, is not evidence of manifest membership, and cannot resurrect content the author has tombstoned.

- A consumer MUST verify an item's `_feed_url` matches the feed URL it was fetched from (after normalization) before treating it as canonical. A mismatch marks the item a copy: display it, attribute it to its signer, but do not grant it liveness or manifest standing. **One mismatch is not a copy:** where the `_feed_url` names a feed of a **predecessor** identity of the one owning the feed it was fetched from, and the consumer has verified that migration, the item is canonical here — predecessor equivalence (§3.4). A consumer that has not verified the migration correctly sees a copy, which is the safe reading.
- To determine whether a copied item is currently live or deleted, consult the manifest of the feed where it is **canonical** (§9) — ordinarily the feed its `_feed_url` names, but the **successor's** where a verified migration has moved it, by the exception above. Resolving to the predecessor's manifest instead would let an abandoned host tombstone a departed identity's entire back catalog for every reader of every copy, which is the exit §3.4 exists to grant being revoked after the fact. The canonical manifest is authoritative and a copy cannot override a tombstone recorded there. Because that manifest commits each item's exact bytes, the same lookup also tells a consumer whether the copy it holds is the revision the author committed or a stale one. A consumer holding a copy but no knowledge of the migration cannot reach the successor's manifest at all — the ordinary limit of a copy, closed by §3.4's links where they are still reachable.
- An `id` is permanently bound to a single `_feed_url`. The same `id` MUST NOT be signed with two different `_feed_url` values: the bytes would differ while `(author, id, _version)` claims to name one exact revision (§7.3), and inbox dedup (§10.3) would silently drop one variant. Adding a `_feed_url` to an item that had none is not two values: that is the author promoting a delivered item to a published one, at a new `_version` (§11.1.1). Cross-posting the same content to another feed uses a **new item** with a fresh `id` carrying a `repost` or `quote` relation to the original. A verified migration does **not** breach this rule and is not an exception to it: the item keeps its single signed `_feed_url`, and what changes is only where those unaltered bytes are served and treated as canonical (§3.4).

Together with the manifest this closes both omission and injection: the manifest proves **presence**, so a host cannot drop your content, and `_feed_url` proves **exclusivity**, so a host cannot inject or resurrect your content by copying it into its own feed. It also gives availability for free — a follower may serve its cached copy of your feed when your host is down, and it still verifies.

**Bridged and unverified items.** Content conveyed from another protocol (Appendix C) cannot be a native signed item, because no one holds the foreign author's Open Feed key. It is therefore signed by the **gateway** that observed it, and it MUST carry `_unverified: true` — **no exception and no second form**, since nothing crossing a protocol boundary is natively authentic (§10.5 governs how it is displayed). The marker travels with the item wherever it goes: it applies equally to an item ingested into a gateway's feed and to one **delivered** to an inbox with no `_feed_url` at all (Appendix C's backfeed rule). Its `authors` entry names the **signer**, the gateway or a proxy identity the gateway operates, per §6.6 — never the foreign author, who signed nothing here. It SHOULD carry `external_url` naming the foreign original, which on an `_unverified` item MAY be a non-HTTP URI (`nostr:note1…`, `at://did:plc:…`) since not every protocol identifies objects with URLs; consumers MUST NOT dereference it, and §13.5's fetch discipline governs anything they do dereference. Ingest is only half of a bridge: Appendix C states the rule governing both directions, and §11.1.1 is the case the core enforces directly.

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

Threads are trees built by walking parents; clients display flat or nested and SHOULD cap walk depth, since loops are possible in malicious data — treat re-visited references as leaves. Polling the participants' feeds is what makes a thread complete; the inbox is what makes it fast (§10). An implementation wanting a thread-discovery endpoint is inventing a public projection of received content, and §11.1.1 binds it.

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
- `feed_url`: the feed this manifest commits to. Committed items ordinarily carry a matching `_feed_url`, and a verifier MUST NOT reject a manifest for committing one that names a **predecessor** feed instead: §3.4 requires a migrated back catalog to be republished byte-verbatim, so those items keep the old URL forever and the successor's manifest is the only place they can be committed
- `seq`: monotonic version counter, starts at 1, strictly increasing; a consumer rejects any manifest whose `seq` is below its pin
- `prev`: **MUST if `seq > 1`.** The §5.1 hash of the immediately preceding manifest version. Genesis omits it.
- `updated`: publication time (Unix seconds); the effective signing time for the revocation/`iat` check (§6.5)
- `items`: map of live item `id` → **`[version, hash]`**, where `version` is the item's current `_version` and `hash` is the §5.1 hashing rule applied to that item's full published canonical bytes, `_sig` included
- `deleted`: map of tombstoned `id` → `[version, hash]` of its tombstone. Omit when empty. Entries persist for the life of the chain, so deletion history is verifiable
- `_sig`: detached JWS (§6) by a chain-valid key

**The manifest commits to bytes, not only to a version**, and the hash is not optional. A *serving-path* attacker who cannot sign is fully contained by `_version` alone, but a **key custodian** is not (§13.2): holding the signing key, it can sign item `X` version 1 as one thing for you and another for your sister, and with a version-only manifest both readers see byte-identical manifests, agreeing pins, and no fork — undetectable in principle, not merely unnoticed. The hash closes that using the mechanism that already exists, since two readers comparing pins (§5.3.1) now diverge at the same `seq`, and it costs about 48 bytes per item. So the manifest supplies what per-item signatures cannot: **presence, freshness, exact content, and — via the chain — tamper-evidence against a host that equivocates on any of them.**

### 9.1. Chain Mechanics

Producing and verifying a manifest version follow §5.2 and §5.3 exactly, with these substitutions:

| §5 (identity document) | §9 (manifest) |
|---|---|
| Document at `{identity_url}openfeed.json` | Document at the `manifest` URL of a `feeds` entry (§3.2.1) |
| Signing key listed in the document itself | Signing key valid in the identity chain of `url`, found in that identity's pinned document |
| Changes = keys, profile, endpoints, migration links | Changes = `items`, `deleted` |
| Reject on `seq` decrease, `prev` mismatch, compare-rule failure (§5.3.1) | Same, plus the invariants (§9.3) |

Prior versions are retained at derived URLs by §5.4 — same rule, same byte-identical requirement, nothing manifest-specific. Because they are individually addressable, a manifest fork is detectable across consumers exactly as an identity-document fork is: two observers reconstruct the manifest at a shared `seq` and compare hashes — §16.1's item-carried pins are how their views meet. Because the manifest commits to item *bytes*, this covers equivocation over *what was said* as well as over *what exists*. First contact is TOFU.

#### 9.1.1. Skip links (OPTIONAL)

Walking is linear in versions and every manifest version carries its whole `items` map, so reconnecting a pin costs O(versions × items) — and against §13.4's history-bytes cap a few months away turns a chain unverifiable (§5.3) for a reader nobody attacked.

A manifest MAY carry `_skip`, mapping a `seq` to the §5.1 hash of that earlier version of the same chain: `"_skip": {"256": "8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI"}`.

- Anchors MUST be **absolute** — for each `k ≥ 0`, the largest multiple of `2^k` below this `seq`, keeping only the distinct values of at least 1, since a chain starts at `seq: 1` and an anchor of 0 names nothing. Near a power of two the set collapses to one or two entries; that is harmless, because each landing carries its own `_skip` and the walk re-skips from there. Relative offsets (`seq−2`, `seq−4`, …) shorten a walk equally well and are wrong: every reader then lands on a different set of versions, and §5.3.1 needs two observers at the **same** `seq` to compare anything.
- A consumer MAY follow the smallest anchor not below its pin, verifying each landing exactly as §5.3 verifies a `prev` hop. It SHOULD then fetch the version immediately above that anchor and confirm its `prev` names the same hash. An anchor and a `prev` are two signed statements about one version's bytes: without the check, a publisher can aim a forged anchor at skipping readers alone; with it, forging one anchor requires forging every version above it, which is forging the whole chain.
- Consumers MUST NOT require `_skip`; a manifest without it is walked linearly. Skipping observes fewer versions, so a skipping consumer is a weaker witness for others (§16.1).

**A consumer MUST NOT follow a skip link on the identity chain.** The restriction is not a size judgement — the identity chain runs 5–20 versions over a lifetime (§3.2.1) and would not repay the field anyway — it is what keeps the mechanism sound. A manifest's signing key is resolved in the identity chain (§9.1), which the consumer has already walked and pinned, so a manifest tip is *authenticated before its `_skip` is read* and the anchors it offers are statements by a key already verified. An identity document is its own key source (§5.3 step 1), so a freshly-fetched tip is authenticated by nothing until the walk connects it to the pin: anyone who can write to the tip URL can mint a key, list it, and self-sign. Because the skip path replaces `prev` verification rather than adding to it, following an anchor offered by that tip lets a serving-path attacker holding **no key at all** splice a forged tip onto an honest history — the exact rollback the chain exists to prevent, reached through the shortcut.

### 9.2. Cadence and Retention

What *is* manifest-specific is volume. This is the long chain, and every version carries its whole `items` map, so retained manifest history grows as **O(versions × items)**. A family publishing three items a day for ten years reaches roughly 11,000 versions over 11,000 items — on the order of gigabytes of retained history, before anyone has posted a photo. Two mechanisms bound it, on independent axes: cadence cuts **versions**, rotation cuts **items**. A publisher of any volume SHOULD use both, and the axes multiply — a daily cadence and annual rotation together cut the example above by roughly thirty times. One that uses neither is still conformant and will be fine at family scale for years, but it is the configuration that grows without bound, so it should be a choice rather than an accident:

- **Advance on a cadence, not per publication.** A manifest MAY commit a batch: publish items as they are written, and advance the chain on a schedule (hourly, daily). Version count then tracks *time* rather than *activity*, so a burst of twenty posts costs the same chain as one. It needs no new mechanism — §9.3 invariant 3 defines the resulting state and bounds it. The cost is worth naming precisely: uncommitted content is content a host can serve to one reader and not another without forking anything, so a long cadence weakens §9's guarantee rather than merely delaying it. Publishers SHOULD state their cadence to their users, SHOULD keep the window one those users would accept, and SHOULD advance immediately for a **tombstone**, since a deletion the author wants honored should not wait on a timer.
- **Rotate feeds.** `items` carries the whole live set, and cadence does not shrink it, so a catalog approaching §13.4's manifest ceiling needs a second feed rather than a cleverer manifest. Open a new feed with its own manifest, list it in `feeds` (§3.2.1), and leave the old one in place with `rel: "archive"`: its chain simply stops advancing except to edit or tombstone what it already holds, and a consumer wanting the whole history reads every entry in `feeds` rather than paginating between them. **Rotate by adding a `feeds` entry, never by repointing an existing one.** Repointing a `manifest` URL is a relocation, and §9.3 invariant 5 then requires the new chain to carry forward every id the old one held — exactly the cost rotation exists to avoid, silently reintroduced.

### 9.3. Invariants

Violations MUST be treated like chain equivocation:

1. An `id`, once present in `items`, MUST appear in every later manifest — in `items` at the same or a higher version, or in `deleted`. Content cannot silently vanish; removal requires a signed tombstone.
2. `seq` and per-item versions never decrease.
3. A served feed MUST NOT contain an item version lower than the manifest's, and MUST NOT contain live items absent from the manifest — **except** transiently newer content. An item newer than the manifest is *manifest lag*, whether from mid-publish caching or a scheduled cadence (§9.2); consumers treat it as unverified-pending rather than as a violation, and expect the next manifest version to commit it. **Two rules bound the pending state, and neither needs history.** First, being passed over is observable directly: a manifest whose `updated` is later than an item's effective signing time has demonstrably advanced past it, so an item still uncommitted by that advance has been passed over — a violation, not lag. Second, consumers SHOULD apply an absolute ceiling (RECOMMENDED: 7 days, matching §10.2's staleness bound) and treat anything uncommitted beyond it as unverified regardless of the publisher's rhythm. The ceiling is deliberately the consumer's own rather than derived from the publisher's observed cadence: a derived bound catches only a publisher *deviating* from its rhythm, never one that simply declares a slow one, and it gives a first-contact consumer no deadline at all. Without a bound, a batching publisher holds a standing window in which it can serve an item to one reader and not another while producing no evidence at all — the guarantee of §9 reduced to the cadence.
4. An item whose `id` and `_version` match a manifest entry MUST hash to that entry's committed value. A mismatch is a violation, not lag: the manifest names an exact revision and the feed is serving a different one.
5. **Relocation does not reset the chain.** §5.3.1 is keyed on a document URL, so a *new* manifest URL is a new chain and a fresh trust-on-first-observation — which would let a publisher discard content by renaming a file. Where a `feeds` entry's `manifest` URL changes, or a verified migration (§3.4) moves the feed to a successor identity, every `id` live in the last manifest the consumer observed for that feed MUST appear in the new chain's manifest: in `items` at the same or a higher version, or in `deleted`. Honest deletion is unaffected, since it goes in `deleted`; a consumer holding no prior pin has nothing to carry across and treats the new chain as ordinary first contact.

Consumers verify incrementally — any item read from the feed is checked against its manifest entry with one map lookup and one hash. Detecting omission of an item you have never seen requires comparing manifests across pins, which the chain makes sound.

A third state sits between lag and violation. An item the manifest commits but the feed never yields — truncated pagination, a `404` on the permalink — is **withheld**. No invariant is broken and nothing is forged: the consumer knows an exact revision exists, knows its hash, and cannot obtain the bytes. That is the manifest doing its job, so a consumer MUST surface it as withholding rather than hold it as perpetually-pending, which is the shape the same evidence takes if nobody names it.

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
3. **Relevance**: some `_rel` entry's `to` MUST reference this inbox's owner — their identity URL, their feed URL with or without fragment, or an item of theirs. This is one lookup over `_rel` and works even for relation *types* the receiver does not understand, so unknown-typed interactions genuinely about the owner are accepted. The owner's **predecessor** identity and feed URLs count as their own — predecessor equivalence (§3.4). Reject otherwise (`not_relevant`). Exception: a tombstone whose `(author, id)` matches a stored item is always relevant. A bare feed-URL `mention` alone SHOULD NOT authorize unbounded volume — treat it as low-priority or moderated.
4. Timestamp bounds: effective signing time not more than 7 days past nor 24 hours future
5. Dedup (§10.3) — reject without fetching if stale
6. Rate-limit by source IP (always) and by author (once known)
7. Verify the signature per §6.5 — one outbound fetch, the author's identity document; cache it, and negatively cache failures
8. Apply the revocation check against receipt time (§4.4)
9. OPTIONALLY confirm the referenced target item exists (`404`, `target_not_found`). Run it **after** step 7, never before: run early and it is an unauthenticated existence oracle for `(author, id)` pairs, the hazard §10.4 weighs for `409`

### 10.3. Replay and Deduplication

Receivers store `(author, id) → version`. A delivery is **new** if the `(author, id)` is unknown (accept); an **update**, including tombstones, if `_version` is greater than stored (accept, replace); **stale** if `_version` is equal or lower (reject `409`). Receivers MAY additionally verify the item appears in the sender's manifest, but MUST NOT require it — inbox-only items are legitimate.

The §10.2 pipeline **reads** this store before verification and MUST NOT **write** it until verification succeeds. The `author` is attacker-controlled until step 7 (§13.9), so recording an unverified `(author, id) → version` lets anyone pin a victim's item at a version it will never reach, permanently rejecting its real revisions as stale.

### 10.4. Responses

| Status | Meaning |
|--------|---------|
| `202` | Accepted / queued (do not distinguish moderation from auto-approval) |
| `400` | Malformed, missing fields, or not relevant to this inbox |
| `401` | Signature invalid or key revoked |
| `404` | Referenced target item does not exist |
| `409` | Stale version |
| `429` | Rate limited (include `Retry-After`) |

Error bodies: `{ "error": "code", "message": "human text" }` with codes `invalid_json`, `missing_field`, `not_relevant`, `invalid_signature`, `key_revoked`, `target_not_found`, `stale_version`, `rate_limited`. **Blocked authors SHOULD receive `202`** with the content silently discarded: signalling a block with a distinct status tells a harasser to make a new identity and confirms the account exists. Reserve an explicit refusal status for policy denials you actually want visible. Note that `404` and `409` both answer the existence question §13.8 asks implementations to obscure, and `409` answers it *before* any signature is checked — an unauthenticated oracle for `(author, id)` pairs. §10.2's tombstone-relevance exception is the same oracle in a third place, since it too reads the dedup store before verification: a garbage-signed tombstone draws `401` where the pair is stored and `400` where it is not, and needs no knowledge of the target beyond the id. All three are safe where ids are unguessable UUIDs, and where they are not — or where an item's existence is itself sensitive — return `202` and discard instead. Senders retry 5xx and timeouts with exponential backoff for 24 hours; recipients recover missed deliveries by polling the sender's feed, since the feed is the source of truth, and hubs SHOULD reconcile relation items found by polling against the inbox record.

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

> A receiver MUST NOT place a delivered-only item into any publicly-readable artifact: not a feed (§7.1) — its own or an aggregate — not a manifest (§9), not the response of any query surface it invents (a thread-discovery endpoint, a search index, an aggregate view), and not a gateway emission to a foreign network (§7.5, Appendix C). The rule binds artifact *classes*, not a list of today's surfaces: a projection is bound the moment it exists, and the check is one field lookup inside the signed bytes, costing nothing (§10.3 forbids requiring more). Only the author can move an item across the line — bump `_version`, add `_feed_url`, re-sign (§7.5) — and from that revision onward it is ordinary published content; a receiver serves whichever revision it actually holds.

This is the **only** enforcement the delivered column has. Without it, choosing that column is not a privacy mechanism at all: any one recipient can undo it unilaterally, at no cost, and the author gets no signal that it happened. Note the asymmetry that makes this a MUST — the author's choice is visible in the signed bytes and trivially checkable, while its violation is invisible to the person it harms. The rule binds the **bytes**, not the information, the same by-value/by-reference limit as §6.6: nothing stops a recipient publishing their own signed item describing what you told them privately, which is ordinary indiscretion that no protocol prevents and this one does not pretend to. For a native delivered-only item the rule has no exceptions. The missing `_feed_url` is overloaded by exactly one other case, distinguishable from the bytes: a gateway-**delivered** foreign response (Appendix C's backfeed rule) carries `_unverified: true` and an `external_url`, which a native private item never does, and its underlying author *did* publish — publicly, on the foreign network. Appendix C scopes what a recipient may do there; nothing in it loosens this rule for anything else.

### 11.2. Audience of one, audience of many

> **Any audience larger than one requires a membership document.** An audience of one does not.

A direct message needs no membership document: there is exactly one counterparty, threading works, and it is expressible in the core today as a signed item with no `_feed_url` delivered to that person's inbox. A *group* audience is different — a replier is a reader, not the author, and nothing in the core tells them who else is in the audience. That is a membership problem, not a cryptography problem, and it is identical whether the content is encrypted or in cleartext. **Group audiences are out of scope**: this specification defines no membership document, and a group-audience mechanism MUST NOT be presented as part of it.

**A membership decision is not necessarily a published document**, and conflating the two makes the rule above look stricter than it is. An author broadcasting to an audience that only *they* address holds the list locally and wraps to it (§15.2) — no document leaves their client and nothing is pinned; that case is expressible today. A **published** membership document is required precisely when someone other than the author must address the same audience: the replier, who cannot wrap to a list they cannot read. Making group *replies* work therefore needs machinery this specification does not define — a chained, encrypted membership document with an answer to staleness and to withholding — and until something defines it, group replies are not claimed.

### 11.3. Encrypted content

Confidentiality is OPTIONAL and specified in §15. An encrypted item is an ordinary signed item whose content is an opaque payload; the core neither defines nor inspects it, and the single signing construction (§6.1) is untouched. Its guarantee, stated once:

> **Encrypted content is exactly as private as the recipient's key custody.**

Encryption protects a plaintext from every party except its author, who needs no secret because they encrypt to recipients' *public* keys, and anyone holding a recipient's private encryption key. A recipient whose host holds their decryption key has confidentiality against everyone except that host. Encryption is not a defence against your own host (§13.2, the hostile-custodian tier), and its value tracks how many recipients hold their own keys — a product and UX variable, not a protocol one.

### 11.4. What is never hidden

On a **published** feed, encrypted or not, these are cleartext by construction: `id`, `date_published`, `date_modified`, `authors`, `_version`, `_feed_url`, and `_rel` with its `to` targets, plus the manifest's record of publication cadence and deletions (§9, §13.8). That is who posts, when, how often, and who replies to whom — the interaction graph. Encryption hides what you said, not that you said it. Where the graph itself is sensitive, the answer is not a stronger cipher: it is to keep those items off the published axis entirely (§11.1, delivered column; §15.4).

**Hiding a feed's existence is not offered**, for the reason above. A deployment that needs an unlisted feed can host one at an unguessable URL, but that is an operational choice with the properties of a bearer secret — it leaks through logs, referrers, and history sync — not a protocol mechanism, and this specification does not bless it as one.

## 12. Conformance

**Level 0 — Consume (non-verifying).** A plain feed reader that fetches the JSON Feed and ignores `_sig` is a valid consumer; it just gets no authenticity guarantee. Open Feed is strictly additive to the existing feed ecosystem. Level 0 has no requirements and is named so that additive relationship is explicit.

**Level 1 — Read.** MUST: fetch and parse identity documents, feeds, and manifests; verify signatures (§6); enforce revocation; **pin and enforce both chains** (§5.3, §9.1) and apply the compare rule (§5.3.1); check items against their manifest entries, hash included (§9.3); handle unknown fields and relation types gracefully. SHOULD: enforce the canonical/copy rule (§7.5); honor content warnings; follow pagination; cache identity documents (≤1 h). No infrastructure required.

Pinning is a MUST because it is what the §13.2 guarantees are made of: a verifier that checks signatures but keeps no pin re-establishes trust on first use at every fetch, and a host holding the signing key can hand it any history it likes, forever, without ever forking anything. The one exception is narrow — **a consumer with no persistent storage cannot pin.** Such a consumer is still useful (a one-shot command-line verifier, a stateless function) and remains conformant to everything else at this level, but it MUST NOT be presented as providing the §13.2 guarantees, and SHOULD tell its users so.

**Level 2 — Publish.** Level 1, plus MUST: serve an identity document (signed, chained, retaining prior versions at their derived URLs once `seq > 1`); serve at least one feed, listed in `feeds`, of signed items; serve a signed, chained manifest for **every** feed entry, with its own retained prior versions; produce valid signatures and canonical JSON; generate unique ids; serve every public document with `Access-Control-Allow-Origin: *`. Fully static-hostable: every Level 2 artifact is a file, and signing happens at build time. Sending interactions requires Level 2, since you need published keys for anyone to verify you.

**Level 3 — Interact.** Level 2, plus MUST: an inbox endpoint with the §10 verification, dedup, CORS, and response codes. SHOULD: rotation UI for hosted users.

**Hosting identities on behalf of other people** cuts across all four levels and carries its own MUSTs. The hazard is custody, not capability: a Level 2 hub that publishes members' feeds and never implements an inbox holds their keys and controls their exit exactly as a Level 3 one does. Any implementation hosting identities for others MUST:

1. Provision each hosted identity with a recovery key (§4.5), generated on the member's own device and never transmitted to the host.
2. Present the member, at onboarding, with their **genesis** `(seq, hash)` and their recovery key's fingerprint in a form they can compare out-of-band (§4.5), and record and expose the `(seq, hash)` of every later chain version it produces for them (§5.2).
3. Serve that owner a complete export bundle on demand (§14).

**The recommended custody architecture extends requirement 1 to the signing key itself.** The member's device generates a root signing key alongside the recovery key — the same provisioning moment, and key generation the client automates costs the member nothing — and the host receives only a **delegated key** (§4.6). The host then publishes on the member's behalf while identity state stays out of its reach entirely. A host SHOULD be built this way. One that instead holds members' root keys MUST disclose to them that it can rewrite their identity — add keys, un-revoke, publish a `successor` — and not merely impersonate their content, because that is the difference this architecture exists to remove.

These make hosted identities portable rather than captive, and an implementation skipping any one of them MUST say so plainly to the people it hosts. Requirement 2 is not paperwork: without it, requirement 1 can be satisfied to the letter and defeated in full (§4.5) — and that is as true under delegated custody, since the host still serves the documents and first contact is still TOFU.

**Transient failures.** If an identity-document or manifest fetch fails transiently, cache the failure and retry (1 h, 4 h, 24 h) before permanent rejection.

## 13. Security Considerations

1. **Signature limitations.** Signatures prove a key signed bytes — not when (timestamps are self-reported), not who a person is, not that content is true.
2. **Hub trust vs host trust — a gradient, not a binary.** Four adversary tiers sit on it, and a fifth does not.
   - **Key custodian** (hub holds the user's signing key): forward impersonation is unpreventable — the email trust model, stated plainly. But it cannot *silently rewrite the past* against pinned consumers: retention (§5.4) forces removals to surface as signed tombstones, and per-consumer rewriting — of keys, of which items exist, or of what they say — surfaces as a fork. Transparency rather than integrity, but transparency with teeth, resting on two requirements stated elsewhere: the manifest commits exact bytes (§9), and somebody compares (§5.3.1, a Level 1 MUST, made mechanical by §16).
   - **Delegated custodian** (hub holds only a delegated key, §4.6; the member's device holds the root and recovery keys — §12's recommended architecture): forward impersonation of *content* remains until the member revokes the delegation; keys, revocation, and migration are out of the host's reach, and the member's root key can always publish the competing branch §5.5 resolves. What this tier does **not** claim: where the custodian also distributes the member's client, every client-side guarantee — root, recovery, and encryption keys alike — is bounded by that client, and §4.5's out-of-band genesis comparison is the one check that survives it, which is why §12 requirement 2 exists.
   - **Serving-path compromise** (CDN, static bucket, web tier — anything outside the signing boundary): the most common real-world compromise. The attacker cannot sign, so chain and manifest give **full integrity**: no undetectable omission, rollback, or injection. Hubs SHOULD keep signing behind a narrower boundary than serving.
   - **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full integrity against the host by construction. Client-side keys are what move a user from the first tier toward this one.
   - **Hostile custodian who is also the counterparty** (the tier other sections cite as *the hostile-custodian tier*) — off the gradient, because it is not defined by technical position. The operator is *inside the audience* and *controls the exit*; a family hub run by a relative is the ordinary case. This adversary reads everything the host can read, sees the metadata no mechanism hides, is not deterred by transparency because they are entitled to look, and can decline to let the user leave. The integrity machinery is beside the point — it defends what you published from being *altered*, not from being *read by the person hosting it* — and confidentiality does not rescue it either (§11.3), since this operator supplies the client, generates the keys at onboarding unless §4.5 is followed, and can add a key of their own to the identity document — a change the chain records perfectly and nobody is necessarily reading, and one that delegated custody (§4.6) removes from the operator's reach altogether where §12's architecture holds. What the protocol offers this user is **exit**: §3.4, §4.5, §14, real only if all three hold at once. Implementations SHOULD NOT market audience control, restricted visibility, or encryption to this user as protection from their own host.
3. **TLS and CORS.** Everything HTTPS; validate certificates. Every publicly-readable document carries `Access-Control-Allow-Origin: *` so browser Level-1 readers need no proxy.
4. **Resource limits and scale.** Suggested caps: identity document 100 KB / 100 keys; manifest 1 MB (~10k live items at roughly 96 bytes per `[version, hash]` entry — a deliberate family-scale ceiling; the live-set bound is feed rotation, §9.2); feed page 10 MB / 1000 items; inbox body 100 KB; chain versions walked per update 1000; **total history bytes fetched per update: the greater of 10 MB and 20× the current version's size**; concurrent fetches per origin 10. That budget scales with the document because a fixed one does not survive its own ceiling: a skip jump costs *two* full versions (§9.1.1), so against a 1 MB manifest a flat 10 MB reconnects a pin roughly 16 versions back — fewer than three weeks of daily cadence — while the same budget against a 96 KB manifest reconnects thousands. Retained manifest history grows as O(versions × items) and is the largest storage obligation in the protocol; §9.2 is how a publisher bounds it, and §9.1.1 is how a consumer stays inside the history-bytes cap after a long absence. A consumer that cannot reach its pin within the budget has an unverifiable chain (§5.3), not a re-pinning decision. Open Feed scales **across identities**, each self-contained and independently verifiable, not in items-per-identity; a global-scale aggregator (firehose) is explicitly out of scope.
5. **SSRF.** For every outbound fetch: HTTPS only, ≤5 redirects, 10 s timeout, size limits, reject private/loopback/link-local addresses, dedicated restrictive HTTP client.
6. **Signature stripping and by-reference reuse.** Never attribute unsigned content; display unverified content distinctly; never cache it as verified. Author binding covers content carried by value and cannot cover content carried by reference (§6.6, §7.4).
7. **Replay and timing.** Constant-time comparisons; NTP; never trust self-reported time as sole ordering.
8. **Enumeration and the public record of activity.** Rate-limit discovery endpoints; use uniform timing for exists/doesn't-exist. Note what the design publishes permanently and by requirement: the `deleted` map makes "this identity deleted something at version N" a lasting public fact, and the retained manifest chain publishes posting cadence. Do not call this acceptable "for family use" — where the adversary is a family member (the hostile custodian above) it is precisely the leak that matters, and it survives encryption. Item ids sit inside that permanent record, so an identity for whom deletion is sensitive SHOULD use opaque ids: `tag:example.com,2025-12-07:hospital` names in the `deleted` map exactly what its author removed, and a UUID URN does not.
9. **Inbox fetch amplification.** The `author` in a delivered item is attacker-controlled until verification succeeds. Rate-limit by source IP before fetching; run all local checks first; fetch only the fixed-path identity document of the claimed author, never an arbitrary URL from the `kid` — the path convention makes this structural. Negatively cache failures.
10. **Rollback vs self-reported time.** The chains detect identity-document and content rollback, both relative to a consumer's pin. Neither detects item *backdating*; receipt time is the trustworthy lower bound for inbox items, manifest first-observation time is its pull-path analog (§4.4), and item-carried pins (§16.1) are a family-scale external time anchor. A true transparency log or witness network remains future work.
11. **Inbound and copied HTML.** Escape or sanitize any content not authored by the local user, always (§10.5).
12. **Thread loops.** `_rel` `reply` graphs from malicious parties may contain cycles; cap walk depth (§8.1).
13. **Lag, withholding, violation.** Three distinct states, defined with their bounds in §9.3. Do not collapse them: the second and third are attacks and the first is not.
14. **Receiver-side republication.** §11.1.1 is enforced entirely at parties other than the author, so every surface that projects received content publicly must apply it. It is the failure mode most likely to be introduced by an implementer being *helpful*: republishing what arrived in the inbox looks like completeness and is a disclosure the author declined.
15. **Identity portability.** Losing the domain without recovery keys orphans the identity — the email trade-off. Recovery keys and pins close the hijack gap for anyone who observed the identity before the hijack; first contact after a hijack is unprotectable by design. Durable identity across domain loss is what atproto buys with DID indirection; Open Feed deliberately trades it for URL-native simplicity, and recovery keys plus pins are the family-scale mitigation, not a fix.
16. **Cross-platform account links in chained documents.** Publishing a claim to a foreign account (a fediverse handle, a Bluesky DID — README documents an `_accounts` convention) inside any chained document is a **permanent, irreversible disclosure** of a cross-platform identity link: removal withdraws the claim, never the disclosure, because every prior version stays served (§5.4). Identities for whom the operator or a family member is the adversary (the hostile-custodian tier above) SHOULD NOT publish such links — an unsigned HTML link is deletable and carries lower risk; signed buys tamper-evidence, unsigned buys erasure, and the choice must be stated, not made silently. And whatever the mechanism, a claim about a foreign account MUST be presented as a claim, never as established, until the foreign side's own attestation has been checked — account linkage MUST NOT share a "verified" label with authorship (§6.5), whose verifier and failure modes are different.

## 14. Export and Exit

§3.4 moves an *identity*. This section moves the *content*, and the two together are what let someone leave a host that does not want them to. An **export bundle** is a single JSON document containing a complete copy of everything an identity has published, sent, and received — independently verifiable throughout, plus whatever unpublished content its host holds for it. An implementation hosting identities on behalf of others (§12) MUST make it available to the identity's owner on demand, without operator approval and without rate limits that make it impractical.

```json
{
  "version": "openfeed-export/1",
  "url": "https://pence.family/~mom/",
  "exported_at": 1739577600,
  "identity": { "current": { "..." : "identity document" }, "history": [ "..." ] },
  "feeds": [ { "feed": { "...": "JSON Feed" }, "manifest": { "..." : "current manifest" }, "manifest_history": [ "..." ] } ],
  "delivered": [ "...signed items this identity sent that were never published..." ],
  "received": [ "...signed items delivered to this identity's inbox..." ],
  "unpublished": [ "...drafts and items kept private to their author; reached no feed and no inbox..." ],
  "attachments": [ { "url": "...", "_sha256": "...", "bytes": "base64url" } ]
}
```

- Every document MUST appear **byte-verbatim as published** — the same canonical bytes that were signed (§6.3). A bundle whose contents have been re-serialized is worthless, because the hashes will not chain.
- `identity.history` and `manifest_history` are arrays of the **retained prior versions themselves**, byte-verbatim, complete back to genesis.
- `received` items MUST be included verbatim as received. They are other people's signed bytes; the exporter is a custodian, not an author.
- `delivered` MUST include items that exist only in transit — those with no `_feed_url`, which appear in no feed and no manifest and are therefore in no other artifact.
- `unpublished` SHOULD carry content the host holds that reached neither a feed nor an inbox: drafts, and items an author kept private. It is the one slot whose contents may be unsigned, so it sits **outside** the verifiable core and MUST NOT be presented as part of it — include it anyway. Where a host's product is a private journal this is most of what its owner came for, and a bundle omitting it exports the parts of a life the identity already made public while withholding the part it did not. A host that signs such items at rest (§6, no `_feed_url`) makes them export-native and portable rather than merely dumped.
- `attachments` SHOULD inline the referenced bytes; where size makes that impractical, the bundle MUST at minimum retain each `url` and `_sha256` so the copy is checkable if the bytes are fetched separately. An export that omits the photos has not exported a family archive.
- The bundle MAY itself be signed (§6), which proves who assembled it, but need not be: every artifact inside carries its own signature, so a bundle is verifiable from its contents alone. That is what makes it useful against a host you do not trust — you do not have to trust the exporter either.

A consumer restores from a bundle by verifying it exactly as it would verify live documents: signatures per §6.5, chains per §5.3 and §9.1, items against their manifests per §9.3. Nothing about verification changes because the bytes arrived in a file.

**What the bundle is for**, in increasing order of how much it matters: **backup** (your host loses a disk); **migration** (§3.4 tells consumers your identity continues elsewhere, and the bundle is what you carry there to republish — **byte-verbatim**, since §3.4 forbids re-signing the back catalog, which is exactly why the bundle's contents must be the bytes that were signed); and **exit** (you are leaving a host that is not on your side). Exit is the case that sets the requirements above — "on demand, without operator approval," "byte-verbatim," "includes received items," "includes the photos." An export mechanism a hostile operator can withhold, degrade, or serve incomplete is not an exit; it is a courtesy.

## 15. Encrypted Content (OPTIONAL)

**Status: never independently reviewed.** This layer is OPTIONAL and MUST NOT be required for core conformance at any level. It defines no new signing construction (§6.1): encryption changes what the content *is*, not how it is signed. An encrypted item is an **ordinary Open Feed signed item** whose content is an opaque payload in an `_enc` field. Nothing about signing, author binding, `_feed_url`, versioning, tombstones, or the manifest changes: the core commits to the ciphertext exactly as it commits to cleartext, and the host serves bytes it cannot read.

The guarantee is §11.3's, and implementations MUST convey it rather than bury it: **encrypted content is exactly as private as the recipient's key custody**, so this is not a defence against your own host. The honest place it earns its keep: content published to a world-readable feed that only a named audience should read, and content crossing hosts that are not all trusted equally. A family archive on a public CDN is opaque to the CDN, to crawlers, to archivers, and to every host except those holding an audience member's key. What stays cleartext regardless is §11.4's list.

### 15.1. The encryption key

A recipient publishes an X25519 key in their own identity document's `keys` array. The core's `crv`/`use` constraints bind signing keys only (§4.1), so this needs no core change and core verifiers ignore it.

```json
{ "kid": "enc-1", "kty": "OKP", "crv": "X25519", "use": "enc", "x": "…", "iat": 1736899200 }
```

`use` MUST be `"enc"` and `crv` MUST be `X25519` (RFC 8037). The key MUST be published in the **recipient's own** identity document: a sender MUST resolve a recipient's encryption key from that document and MUST NOT accept one supplied by any third party. This is the check that stops an intermediary — a host, or whoever assembles an audience list — substituting a key it controls. Because the identity document is chained and pinned (§5), *substituting* a published encryption key is as detectable as substituting a signing key. What this does **not** cover: whether the sender wrapped to the *right* people is a client-side act that is never published, and no observer can check it (§15.5).

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

Encrypted attachments need no gate, no key-distribution mechanism, and no streaming construction. Encrypt the bytes with a fresh per-blob symmetric key (AES-256-GCM) and publish the **ciphertext** at an ordinary public URL — opaque bytes, so CDNs cache it, `Access-Control-Allow-Origin: *` holds, static hosting holds. The attachment entry (§7.4) is unchanged and `_sha256` is the hash **of the ciphertext**, so integrity is verifiable *by anyone, without any key*, from a signed item: a host that swaps bytes is caught by a party who cannot read either version, and AEAD gives plaintext integrity on top. The per-blob key travels **inside the item's already-encrypted content**, so whoever can read the caption can decrypt the photo — no second audience, no second key list, nothing new to revoke. Single-shot AES-GCM decrypt into a blob URL is sufficient for photo-sized media; streaming AEAD is only needed for video and is out of scope.

The one real cost: **thumbnails must be generated client-side at upload** and published as further encrypted attachments, because the host cannot see the image. That is the standard trade in every end-to-end product, and it buys the deletion of an entire authorization mechanism.

### 15.4. Metadata, and the two channels

Encryption does nothing about §11.4's cleartext metadata, and on a published feed the reply graph is the loudest part of it. The structural answer splits the two channels. **Posts** intended for an audience are **published, encrypted**, keeping the manifest's completeness proof, the export bundle (§14), migration, and durability — at the cost that *this identity posted at this time* is public. **Interactions** on that content are **delivered, not published** (§11.1), POSTed to the audience's inboxes with no `_feed_url`, so `_rel` and its `to` targets never land in a world-readable file — at the cost that replies have no completeness proof and someone joining later cannot reconstruct old threads.

**This half of the design is enforced at the recipient, not at the author**, and implementers MUST understand that before relying on it. Delivering an interaction keeps it off the public web only for as long as every recipient declines to republish it. §11.1.1 makes that a MUST and binds every public projection of received content — a thread-discovery endpoint being the surface most likely to undo it. An audience member whose client ignores §11.1.1 defeats this for everyone in the audience, silently, and no other participant can detect it. This is a genuine trade, not a free win: state the choice to users; do not make it silently.

### 15.5. Security considerations

1. **The wrap-list is unverifiable.** Whether an author wrapped to the right people is not checkable by anyone — not by observers, not by other audience members. With untagged recipients only the slot *count* is visible. This is the first rule in Open Feed that is not checkable from bytes by a third party, and it is why "consent is membership in the wrap-list" is weaker than it sounds: membership is not auditable, so it degrades to a *claim* about membership.
2. **A reading key-custodian leaves no trace.** Every other adversary in §13.2 surfaces: rewriting the past forks a chain, dropping content violates a manifest invariant. A host that simply *reads* what it holds the key for is invisible.
3. **No forward secrecy.** Compromise of a long-term X25519 key decrypts every past ciphertext wrapped to it.
4. **No retroactive revocation.** Once wrapped, content is readable by that key-holder forever. Unlike an authorization grant, there is nothing to revoke.
5. **Key loss destroys content** (§15.1). The only such failure mode in the protocol.
6. **Recipient-count DoS.** A reader trial-decrypts every slot with every encryption key it holds, so the cost is slots × keys — and §15.1 makes a reader's key count grow monotonically and never shrink. Cap the **product**, not the slot count: clients MUST cap the trial decryptions they will attempt (RECOMMENDED: 1024) and treat an item exceeding it as unreadable rather than grinding. The expensive case is the common one, since a non-recipient — anyone at all, on a world-readable encrypted feed — pays the full product on every item and never exits early. Recipients SHOULD attempt keys newest-`iat` first.
7. **Tombstones.** §7.3's allowlist already removes `_enc` from a tombstone, since only listed fields survive. This is why that rule is an allowlist: a denylist naming today's content fields would have left ciphertext in place and deleted nothing.
8. **Do not encrypt to yourself and call it private.** An item wrapped only to its author is still published metadata (§11.4) and is still on someone's host. If content must not exist publicly, do not publish it.
9. **Bridges amplify the metadata leak, and are forbidden from doing so.** The leak is bounded by the surface the author chose. A gateway relaying an encrypted item to a foreign network moves it to a different audience with different reach, which is why Appendix C forbids a gateway from emitting content it cannot read **in any form, including a placeholder**.

### 15.6. Conformance

This layer defines no new conformance level; it refines core Level 1+. A client that renders encrypted content MUST implement carrier binding (§15.2.1) and MUST NOT render a payload that fails it. A client that encrypts MUST resolve each recipient's encryption key from that recipient's own identity document (§15.1). An implementation offering encryption MUST provide encryption-key backup and MUST disclose, at opt-in, that key loss is unrecoverable and that the guarantee is bounded by recipient key custody (§11.3).

## 16. Conventions: Follows and Pins (OPTIONAL)

Two OPTIONAL facilities: a follows document referenced from the identity document (`follows`, §3.2), and one that needs no document at all, **pins carried on items** (§16.1). Neither is required for core conformance and neither is needed to verify anything — a consumer never needs anyone's follows or pins to verify an item, a manifest, or an identity document — and neither introduces a new signing construction (§6). **The compare rule is deliberately not here** — §5.3.1 defines it and §12 makes it a Level 1 MUST. What this section supplies is the other half: a *supply of second observations* to compare against.

**Scope and privacy — read before publishing anything.** The follows document is opt-in and MAY be kept client-local: a hub that polls feeds and pins what it sees needs no published document at all, since the enforcement value is entirely local. **Follows publish who you read** — your reading graph, in cleartext, including your private petnames if entries carry them (§16.2). Pins are scoped so that an entry never reveals a reading relationship its carrying item has not already revealed (§16.1). **A pin leaks no content** — `hash` is a preimage-resistant SHA-256, and the ids, versions, and timestamps inside a pinned manifest cannot be recovered from it. **Signing does not make a pin true**: it proves its author *asserts* it observed `(url, seq, hash)` at `observed`, not that the observation is honest, and a lying witness can assert a hash it never saw. The properties in §16.1 are evidential, not proofs, and gain strength from *multiple independent* witnesses.

### 16.1. Pins carried on items

§5.3.1's compare rule is a Level 1 MUST and §5.2 step 5 makes a publisher record every `(seq, hash)` it produced, but nothing in the core supplies either with a second observation to compare against. This does, out of traffic that already exists: the items already flowing between parties carry the pins.

An item MAY carry `_pins`, an array of **pin entries**:

```json
"_pins": [
  { "url": "https://test.example/openfeed.json", "seq": 1, "hash": "mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y", "observed": 1739577600 }
]
```

Each entry carries `url` (MUST — the **chained document** observed: an identity document or a manifest; the URL disambiguates all of an identity's chains uniformly), `seq` (MUST — the observed version counter), `hash` (MUST — the §5.1 hash of that version's full published bytes, the same value its successor names in `prev`), and `observed` (SHOULD — wall-clock Unix seconds when the item's author **first** observed this `(url, seq, hash)`). Entries are open objects: unknown keys MUST be preserved (§3.2). Timestamps are Unix seconds, since `observed` is compared against key `iat` / `revoked_at` (§4). Because `_pins` sits inside the signed bytes, a custodian can neither strip nor rewrite it — only drop the item whole.

**What an entry may name is scoped by how the item travels**, and the scoping is the entire basis of the claim that pins disclose nothing new:

- On a **published** item (`_feed_url` present), every entry MUST name a chained document of an identity the item is addressed to — a `_rel` target's author, or the owner of the inbox it is delivered to. An entry naming any other identity MUST NOT be emitted and MUST be ignored on receipt: a published item is world-readable forever, and a third-party pin there would broadcast its author's reading graph — silently, and to everyone. An interaction already reveals that its author reads its recipient, so a recipient-scoped pin adds nothing.
- On a **delivered-only** item (no `_feed_url`), entries MAY additionally name chained documents of **third parties**. Delivery reaches exactly one counterparty, so the disclosure — "I read Mom," said to a family member — goes only to someone the author is already in conversation with, and what that counterparty's *host* learns is bounded exactly as it is for the item's own content (§11.1).

**An entry is a claim, never an observation.** A recipient compares each entry against its own records and pins. Equal hashes at the same `seq` are **corroboration**. A differing hash at a `seq` it has recorded is a **reason to check**: fetch that `seq` from its derived URL (§5.4) and compare what you get against your own pin — that resolves to equivocation, to a lying or mistaken witness, or to a chain to re-walk, and only the first fires §5.3.1. Freezing on the entry's word alone would let any stranger able to POST to an inbox revoke any identity for the recipient. A legitimate post-theft fork (§5.5) surfaces here too and is not a false positive — the chain genuinely did fork — so run §5.5 resolution before treating a divergence as unresolved compromise. Two further guards: a `seq` above anything the recipient itself published names a version its host produced without it, which is exactly what §5.2 step 5's record exists to catch; and a consumer MUST NOT dereference an entry naming a chain it does not already track — entries arrive from strangers, and acting on unknown ones would make every inbox a fetch-amplification oracle (§13.9). An unknown chain is simply ignored.

**What pins buy.** Four properties, each evidential rather than proof:

1. **Anti-equivocation.** A consumer's own comparisons cover only what it fetched itself, so a host serving each reader a consistent private branch is never caught by any one reader alone; pins riding items are how readers' views meet. This is also the practical defence against the genesis-equivocation attack in §4.5 — one relative's pin of the member's genesis, compared once, defeats it.
2. **Recovery propagation.** A recovery-based migration (§3.4) cannot publish a `successor` from the lost domain, so consumers who lost the old pointer may never learn of it. A third-party pin on a delivered item, naming a `seq` for that identity beyond the consumer's own pin, is the signal to re-walk: fetch the history, walk to the asserted `(seq, hash)`, and discover the `predecessor` and recovery co-signature there. The pin says "look again"; verification remains the consumer's own.
3. **Informal timestamping.** A signed pin with `observed = T`, from an author the consumer trusts, is a **witnessed assertion** that `(url, seq, hash)` existed by time `T`. Independent witnesses converging at or before `T` establish a family-scale lower bound on when that version existed — the external time anchor §4.4 and §13.10 defer to. A colluding witness can backdate `observed`, so strength comes from independence.
4. **First-contact corroboration.** First contact is TOFU (§5.3). Consistent pins of the same `(seq, hash)` arriving from identities the consumer **already** trusts soften this — an informal web of trust over first contact. It never replaces verification of the chain from that pin forward.

**Reach, stated honestly.** A pin travels no further than the item carrying it. On a published relation item it lands in its author's own feed and manifest, where anyone reads it with no participation from the recipient's host. On a delivered-only item its path runs through the recipient's host, which cannot alter it but can drop it whole. Properties 2–4 are therefore **pairwise** — they work between parties who exchange items and accrue with traffic; there is no aggregator reading everyone's assertions at once, because a standing published record of who observed whom and when is a reading graph with timestamps, and this specification deliberately does not define one. At the scale this protocol targets (§13.4), out-of-band comparison plus item-carried pins covers the cases that matter; a published pins document remains future work that nothing here forecloses, and it would be purely additive.

### 16.2. The `follows` document

An identity MAY publish a follows document and reference it via the `follows` field.

```json
{
  "url": "https://reader.example/",
  "follows": ["https://test.example/", "https://gran.example/~gran/"],
  "updated": 1739577600,
  "_sig": "..."
}
```

`url` MUST be the publisher's identity (author binding, §6.6), `_sig` SHOULD be present when published, and `updated` is Unix seconds. `follows` is an array whose entries are either an **identity URL string** or an **object** `{ "url": <identity URL>, ... }` carrying optional extension keys — a `name` petname, or a `feeds` array narrowing which of the followed identity's feeds are polled; consumers MUST accept both forms and MUST preserve unknown keys. The follows document doubles as the natural trust set for weighing item-carried pins (§16.1) and carries no authority over content.

### 16.3. Conformance

This section defines no new conformance level; it refines core Level 1+. A consumer that publishes a follows document MUST sign it with the core construction (§6) and set `url` to its own identity. A consumer that heeds item-carried pins MUST resolve each disagreeing entry against the derived URL rather than treating the entry itself as an observation for §5.3.1, and MUST ignore entries naming chains it does not track (§16.1); one that emits pins MUST scope every entry as §16.1's publication rule requires. Both facilities remain OPTIONAL: a peer that uses neither is fully conformant, and no consumer may require them of a peer.

## Appendix A: Media Types

| Document | Content-Type (serve) | Accept (consume) |
|----------|---------------------|------------------|
| Identity document, manifest, retained prior versions, follows, export bundle, inbox body | `application/json` | any JSON; reject non-JSON |
| Feed | `application/feed+json` | that, or `application/json` |

All served with `Access-Control-Allow-Origin: *`.

## Appendix B: Test Vectors

All vectors are computed and self-verifying, regenerated by `tmp/regen.js`, which validates the canonicalizer against B.2's known SHA-256, cryptographically self-verifies every `_sig`, confirms each manifest entry's hash equals its item's full published bytes, and checks that every vector string below appears verbatim in this document. Keys are **deterministic, testing-only** Ed25519 keys — not for any real identity.

### B.1. Keys

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

### B.2. Signed Item

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

### B.2b. Signed Relation Item (a reply)

An interaction is an ordinary item carrying `_rel` (§8). Full published canonical bytes, signed by `test-key-1`:

```
{"_feed_url":"https://test.example/feed.json","_rel":[{"to":"https://gran.example/~gran/feed.json#urn:uuid:00112233-4455-6677-8899-aabbccddeeff","type":"reply"}],"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..Mpx31lnXJKgRBdJokGdYAzjc2BlQQ8HI_47OROsjmqMMwU3yaZDMLbxD4fkwhB72mgWDn1gddBW8-gajoYvoCw","_version":1,"authors":[{"url":"https://test.example/"}],"content_text":"Thanks, Gran!","date_published":"2025-02-10T09:00:00Z","id":"urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8"}
```

Manifest commitment (base64url SHA-256 of those bytes): `qWyq-M1dzN2Nf4zUcF08mVzLhpCw_ykJSTeoT8-xTio`

`date_published` sits before `test-key-1`'s revocation in B.5. It has to: §6.5 step 5 resolves a `kid` against the **current** identity document, so an item signed by that key after `revoked_at` is one a conforming verifier must reject (§4.4) no matter how sound its signature is.

### B.3. Manifest (genesis, `seq: 1`)

Full published canonical bytes (signed by `test-key-1`, `updated` = 1736899200). Each `items` entry is `[version, hash]`, the hash being B.2's full-published-bytes commitment:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..n0gZ_Mgtf74bg1ehRaJ82un3FSkZI4SPw6-25A6WyOfjA5pfQP8XWidZ4EG8EBeTtqHQkIBZH46cbe5syZDaCQ","feed_url":"https://test.example/feed.json","items":{"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":[1,"czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"]},"seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Base64url SHA-256 of these canonical bytes (this is `seq: 2`'s `prev`): `8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI`

### B.3b. Manifest, `seq: 2` (chained)

Adds B.2b and chains to the genesis via `prev`. Signed by `test-key-1`, `updated` = 1739577600. The retained `seq: 1` version is served at the derived URL `https://test.example/manifest/1.json` (§5.4).

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..LBK_PNGYQfLYOA9NrXvboRe-hmMqu59FZx9wQiyYbC3xh7SWalvwWHXUCaFJD42Z1FictCWEDmigvVoWMAx2Aw","feed_url":"https://test.example/feed.json","items":{"urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8":[1,"qWyq-M1dzN2Nf4zUcF08mVzLhpCw_ykJSTeoT8-xTio"],"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6":[1,"czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"]},"prev":"8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

Its `prev` equals the B.3 genesis hash, demonstrating manifest chaining (§9.1), and each `items` entry names the exact bytes of B.2 and B.2b respectively.

### B.4. Identity Document, `seq: 1` (genesis)

Full published canonical bytes — this exact string is what `seq: 2`'s `prev` hashes. Note the shape: one `feeds` array (§3.2.1), each entry naming a manifest.

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..HpP48LHgQHTPCflFzuTlhluQfv1bvDlgE_Ggn3uUpMU2DBF7FUvk-Qi66-5mmH6dEg7KlPZr1-kEaYY2CvFcDA","feeds":[{"manifest":"https://test.example/manifest.json","rel":"primary","url":"https://test.example/feed.json"}],"inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"name":"Test Identity","seq":1,"updated":1736899200,"url":"https://test.example/"}
```

Hash (base64url SHA-256, = `seq: 2`'s `prev`): `vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho`

Once `seq: 2` exists, this version is served byte-identically at `https://test.example/openfeed/1.json`, derived by §5.4.

### B.5. Identity Document, `seq: 2` (rotation)

Adds `test-key-2`, revokes `test-key-1`. Signed by `test-key-1` — the continuity key, valid in `seq: 1`, revoked by the very version it signs, and still listed in it (§5.2):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..qpsmemLozSvp8vaFVkCHmJM_iWJWc5YGfcKAqyGTsBxt2hPrUGNMiC-7-b7NSHWyLtSzs2Sd8mlcy_1RnAg0DA","feeds":[{"manifest":"https://test.example/manifest.json","rel":"primary","url":"https://test.example/feed.json"}],"inbox":"https://test.example/inbox","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"test-key-1","kty":"OKP","revoked_at":1739577600,"x":"EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0"},{"crv":"Ed25519","iat":1739577600,"kid":"test-key-2","kty":"OKP","x":"KOvPWZT35Xzwcsw6vfQzO3idc8oa67BdHZ0oXpriOQA"},{"crv":"Ed25519","iat":1736899200,"kid":"recovery-1","kty":"OKP","use":"recovery","x":"1M1BV4w0Z0njYasNg-EmwrblKcCt1zmese8W278yYkk"}],"name":"Test Identity","prev":"vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho","seq":2,"updated":1739577600,"url":"https://test.example/"}
```

### B.6. Reader Identity Document

A second identity, the reader `https://reader.example/`, publishing the key that signs B.7 and B.8. Without it those two signatures name a key no third party could resolve, since key ownership is structural — a key belongs to the identity whose document lists it (§4.2). A Level 1 consumer, so no `feeds` and no `inbox`: the follows document is all it publishes, referenced from here (§3.2). Full published canonical bytes:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..ga-sw3yC2OrP9R7CpNF8zqpHigGqnYL8zl760SCXaSwVlUxKXjHpqIp9_BnuhMaa_gR242CQJ2MySE8lKzrwAA","follows":"https://reader.example/follows.json","keys":[{"crv":"Ed25519","iat":1736899200,"kid":"reader-key-1","kty":"OKP","x":"X1ImihHt5syI0lgZfDFRh3UIQTMUh5RYH4OAb-b52zc"}],"name":"Reader","seq":1,"updated":1739577600,"url":"https://reader.example/"}
```

### B.7. Item Carrying Pins (§16.1)

A delivered-only reply (no `_feed_url`) from the reader to the author of B.2's item, carrying pins of the recipient's identity document (B.4, `seq: 1`) and manifest (B.3, `seq: 1`). The entries name only chains of the identity the item is addressed to, so it satisfies §16.1's publication rule on either axis. Full published canonical bytes:

```
{"_pins":[{"hash":"vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho","observed":1739577600,"seq":1,"url":"https://test.example/openfeed.json"},{"hash":"8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI","observed":1739577600,"seq":1,"url":"https://test.example/manifest.json"}],"_rel":[{"to":"https://test.example/feed.json#urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6","type":"reply"}],"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..k9CbSVhYurWpEAb7U9VadOjTU7Tbgf9JEL7raOhX2huJ4XjXBzgXtdGfobZLC-AiaPGxXiyizoTIlmQL4wijDw","_version":1,"authors":[{"url":"https://reader.example/"}],"content_text":"Lovely!","date_published":"2025-02-15T12:00:00Z","id":"urn:uuid:7c9e6679-7425-40de-944b-e07fc1f90ae7"}
```

The two `hash` values equal, respectively, B.4's identity-document hash and B.3's manifest hash — so the recipient, holding its own pin of either chain, can run the compare rule (§5.3.1) against these entries after resolving them per §16.1.

### B.8. Follows Document (§16.2)

`https://reader.example/` follows the owner and a grandparent. Full published canonical bytes:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..7rVRo4zwaPw_ALwAxf9DEmiTkdFZQRizEEKtKJ_ucJ0kNKUYsNB1vA-WJnht7QefhQWWogPbWRiR7PJiHDk6Bw","follows":["https://test.example/","https://gran.example/~gran/"],"updated":1739577600,"url":"https://reader.example/"}
```

### B.9. Identity Document with Extension Fields

A third identity, `https://posse.example/` (key `posse-key-1`), carrying `_accounts` — a README convention this specification does not define — with both entry shapes, a bare string and an object. The vector exercises §3.2's normative rule: unknown `_` fields sit inside the signed bytes, survive re-serialization, and are ignored by every core check. Standalone on purpose: adding a field to B.4 would change its hash, which is B.5's `prev`, cascading through every vector. Full published canonical bytes:

```
{"_accounts":["https://mastodon.social/@posse",{"handle":"posse.example","id":"did:plc:ewvi7nxzyoun6zhxrhs64oiz","proof":"atproto-handle"}],"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcG9zc2UuZXhhbXBsZS8jcG9zc2Uta2V5LTEifQ..SPUUIhGur3nLWfD6fALk08Mk8jIBaNbidZSNIEhfekucDSri-Ky_kvf3PsBVjsfxx-MT2jWJpxs8kzeaCGG6Dw","keys":[{"crv":"Ed25519","iat":1739577600,"kid":"posse-key-1","kty":"OKP","x":"0RXGkHAP-wMs0x7mlkEgwgpBJ8fl8pguVW6A7npnRZo"}],"name":"POSSE Identity","seq":1,"updated":1739577600,"url":"https://posse.example/"}
```

The signature verifies with `_accounts` treated as opaque — no core check consults it, and a verifier that dropped or reordered it would fail the Ed25519 check, which is what "unknown `_` fields MUST survive re-serialization" protects. The DID and the Mastodon URL are illustrative; neither resolves.

### B.10. Delegated Custody (§4.6)

A fourth identity, `https://member.example/`, in §12's recommended architecture: the identity document is signed by the member's **root** key while the item and manifest are signed by the hub's **delegated** key. Standalone on purpose, like B.9. Identity document, full published canonical bytes:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vbWVtYmVyLmV4YW1wbGUvI21lbWJlci1yb290LTEifQ..Y0tjVA-bgCMAIA1EQ250bsqeGZZ7dM8-Iblc1NEiDnzga85ONvcuKIFrdSGFoSPIyn9o3S5X_pN0tiwhsityBw","feeds":[{"manifest":"https://member.example/manifest.json","rel":"primary","url":"https://member.example/feed.json"}],"keys":[{"crv":"Ed25519","iat":1736899200,"kid":"member-root-1","kty":"OKP","x":"lBYIdfsoSyJtw7cR1busq-pKJ_sQSWAm7VyQXe7wJcA"},{"crv":"Ed25519","iat":1736899200,"kid":"hub-key-1","kty":"OKP","use":"delegated","x":"V9b9ajziR-hIyS-Kw7VEJMC5y5ODDVsIMjGceq8oabc"}],"name":"Delegated Member","seq":1,"updated":1736899200,"url":"https://member.example/"}
```

An item signed by `hub-key-1`, the delegated key — within its authority (§4.6):

```
{"_feed_url":"https://member.example/feed.json","_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vbWVtYmVyLmV4YW1wbGUvI2h1Yi1rZXktMSJ9..S3O8JN_p-o3FlUwWYOhSBCbwDKrp6hMiNPzUoC7sXcKV4VN7EvSG3hMYDgKdJCHrduGK2EibukxXl_PLYMd1Dg","_version":1,"authors":[{"url":"https://member.example/"}],"content_text":"Posted by the hub on my behalf.","date_published":"2025-02-20T10:00:00Z","id":"urn:uuid:2f1e8c4a-9b3d-4e5f-8a71-6c2d9e0b4f13"}
```

The manifest committing it, also delegated-signed:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vbWVtYmVyLmV4YW1wbGUvI2h1Yi1rZXktMSJ9..g_v-LRTtuSol3sRe4Pv2cmfD2gYuxhFFCASk1gGyFRzMSDrIPMfBlwN8wsivcOUS7TVEhcVp6iRwVNSOmm8VAw","feed_url":"https://member.example/feed.json","items":{"urn:uuid:2f1e8c4a-9b3d-4e5f-8a71-6c2d9e0b4f13":[1,"yVUs8yjWaY40adkRZBDBeVslAd66x_Y5VKhjqza0MhU"]},"seq":1,"updated":1740045600,"url":"https://member.example/"}
```

These are the positive half of §4.6 — the delegated key resolving where it may sign. The other half is a must-fail case (a delegated key signing an identity-document version), which Appendix B, being positive-only, cannot carry; the reference repository's negative corpus does.

**Validation recipe.** Verify all thirteen `_sig` values (B.2, B.2b, B.3, B.3b, B.4, B.5 against `test-key-1`; B.7, B.8 against `reader-key-1`; B.6 and B.9 against the key each publishes; B.10's identity document against `member-root-1` and its item and manifest against the delegated `hub-key-1`). Resolve every one of those keys the way §6.5 step 5 does — out of the signer's **current** identity document, B.5 for `test.example` — so `iat` and `revoked_at` are in scope and not just the Ed25519 check; every vector here is intended to verify under that rule, and one that verifies only against a genesis document is a defect. Recompute B.3's full-bytes hash and confirm it equals B.3b's `prev` (manifest chaining); recompute B.4's full-bytes hash and confirm it equals B.5's `prev` (identity chaining). Recompute the full-published-bytes hashes of B.2 and B.2b and confirm each equals the `hash` half of its `items` entry in B.3b (content commitment, §9). Confirm B.7's `_pins` hashes equal the B.4 and B.3 hashes, and that B.7 carries no `_feed_url` (delivered-only, §16.1). `tmp/regen.js` performs all of these.

## Appendix C: Interoperability and Gateways

The cheapest interoperability is not a bridge, because Open Feed's wire formats are already other people's wire formats. That route is four things, none of which requires anything in this specification to be implemented: a JSON Feed that plain readers already consume (Level 0, §12), an Atom or RSS mirror alongside it for the larger installed base, h-card/h-entry markup on the human page, and the identifier-alias conventions README documents (WebFinger, `did:web`). Existing third-party bridges already consume that combination. README expands on it. This appendix governs the expensive route.

A **gateway** is a **trusted intermediary, never a transparent adapter**: each target protocol has a different trust primitive, and no bridge can hold a foreign author's Open Feed key. A gateway is an ordinary Open Feed identity — identity document, keys, chained manifest, inbox — so a gateway that equivocates about what it bridged forks its own chain and is caught by §9.1 like any other signer. Everything it must and must not do follows from one rule, applied in both directions:

> **A gateway may not change the terms under which content was published.** Not the **audience** — never widen it. Not the **durability** — never make permanent what was ephemeral. Not the **verification status** — never present an assertion as a signature.

Those three questions are the test for any protocol, including one that does not exist yet.

**Outbound** (Open Feed → foreign network):

- **Delivered-only items MUST NOT be emitted** *(audience)*. An item with no `_feed_url` was kept off the public web by its author (§11.1.1); emitting it is a publication decision the author declined to make.
- **A gateway MUST NOT emit content it cannot read, including as a placeholder** *(audience)*. For an encrypted item (§15) the ciphertext, an "encrypted post" stub, and a bare timestamped entry are all forbidden. The naive reading is that the metadata is public anyway; it is public **incidentally**, as the price of keeping the completeness proof (§11.4), not as a decision to announce. An author publishing opaque bytes at their own URL has accepted that whoever fetches that URL learns they posted. They have not asked a gateway to tell a foreign follower graph the same thing, and §13.8 is explicit that posting cadence is the leak that survives encryption. Skipping is always safe; announcing is not.
- **A gateway MUST NOT claim a completeness guarantee for bridged content** *(verification)*. No target protocol has an analog of the manifest, so the proof does not survive the crossing.

**The two directions are separable, and outbound alone is cheap.** Notifying a foreign network about your *own published* relation item — sending a Webmention for a `to` that dereferences to an HTTP URL, say — mints no proxy identity, ingests nothing, keeps no state, and widens no audience, since the item was already published at your own URL. A publisher can do that and never operate a gateway; the trust argument begins at ingest.

**Two kinds of gateway.** The variable that prices a gateway is not direction but **what it commits to publicly.** A **mirroring gateway** ingests foreign content into its own manifested feed for an Open Feed audience: every inbound rule below applies in full, retention is permanent, and proxy identities are required. A **syndication gateway** serves a POSSE publisher: outbound, it posts the publisher's *own published* items to the publisher's *own foreign account* — a client calling a foreign API, requiring nothing from this protocol — and inbound, it conveys responses home by **delivery**, publishing nothing. Its natural operator is the publisher themselves, holding their own OAuth token, so the deployment adds **no intermediary beyond the silos POSSE already accepts.** Where publisher and gateway are the same actor, even delivery collapses into the client polling its own foreign notifications and rendering locally — no inbox, no protocol machinery, and only the publication prohibition below still binding. The delivery rule exists for the third-party case: a hub conveying responses to identities it does not operate. A syndicated copy SHOULD link back to its item's permalink — the item-level half of the bidirectional-attestation discipline README's foreign-account conventions use, and the key a gateway uses to route a foreign reply home.

> **Backfeed is delivery, not ingest.** A gateway conveying foreign responses to the Open Feed identity they concern SHOULD deliver them to that identity's inbox (§10) as `_unverified` items with no `_feed_url`, and MUST NOT publish them into any feed or other publicly-readable artifact (§11.1.1). The audience test applies unchanged — only responses the source published publicly, because the inbox's custodian is not necessarily its owner (§13.2) and the foreign author consented to neither. The durability test does not bar delivery, which durabilizes content *for its recipient*, not for the public; but the cost must be stated: delivered items persist in the recipient's inbox and export bundle (§14) until tombstoned, so a foreign deletion round-trips as best-effort, never as recall.

Mechanics that make the round trip work rather than merely permitted:

- **Timestamps.** A gateway-signed item's `date_published` is the **gateway's signing time** — otherwise §10.2's 7-day bound rejects any backfill or catch-up after downtime. The foreign creation time rides in an extension key on the `_rel` entry, where bridge round-trip data lives (§8). Delivered tombstones follow the same rule.
- **Deletion.** A gateway observing a foreign deletion SHOULD deliver a tombstone (§7.3, §8.2), signed by the **same author** — gateway or proxy — as the original delivery, or §10.3's `(author, id)` dedup can never match it. The gateway MUST therefore retain its foreign-object → `(author, id)` mapping across restarts, even though nothing it delivers is manifested. A deletion the gateway never observes leaves the recipient holding the copy; that is the best-effort bound above, stated rather than hidden.
- **Enrollment and quota.** A gateway asserts things about third parties and can deliver unbounded volume under one author. A receiver SHOULD accept gateway backfeed only from gateways its owner has enrolled, per receiving identity, and SHOULD hold them to a separate, lower quota class. Proxy identities are the per-foreign-author rate-limiting granularity: without them, one abusive foreign actor consumes the whole bridge's budget.

**Display: the revocable surface.** A delivered `_unverified` item whose `external_url` names a foreign original published to a public audience MAY be rendered on the recipient's own **unsigned, mutable surfaces** — the human page (§3.1), which nothing in this protocol reads — because such a surface can honor a later foreign deletion. It MUST NOT enter any signed, manifested, or retained artifact: not a feed, not a manifest, not any public query surface (§11.1.1), not an export beyond the inbox record itself. Both tests hold — the audience was public at the source, and a revocable surface does not durabilize. The carve-out keys on markers a native delivered-private item never carries (§11.1.1), and the public-audience assertion is the enrolled gateway's; a receiver that does not trust it that far renders nothing, which is always safe.

**Inbound** (foreign network → Open Feed). This is the half implementations are likeliest to get wrong, because ingest feels like observation. It is publication: an ingested item lands in the gateway's own feed, is committed by its manifest, is retained permanently, and is served with `Access-Control-Allow-Origin: *`.

- **Ingest only what the source published publicly** *(audience)*. Content not addressed to a public audience — followers-only, a direct message, or any protocol's restricted or end-to-end-encrypted content — MUST NOT be ingested. One followers-only post ingested into a manifested feed is a permanent, world-readable, cryptographically-committed disclosure its author never authorized.
- **Do not durabilize the ephemeral** *(durability)*. Content the source protocol expires, or allows to be genuinely withdrawn, MUST NOT be ingested: §9's retention rules turn removal into a permanent public record rather than a deletion. A protocol whose deletions are real is not compatible with a protocol whose deletions are tombstones.
- **Everything ingested is `_unverified`** *(verification)*. §7.5, without exception.

**Proxy identities.** A gateway signs what it ingests, so §6.6 places the gateway in the `authors` entry, leaving the *foreign author* unnamed. A **proxy identity** names them: an ordinary Open Feed identity, minted and key-held by the gateway, one per foreign actor, whose identity document carries that actor's `name`, `bio`, and `avatar`. Attribution becomes **structural** rather than an unverified string in a field the core would otherwise have to define. It is also the only representation available for actors whose native identifiers cannot be URLs — a Nostr `npub`, a phone number, a handle on a closed network.

A proxy identity is **not** a hosted identity in §12's sense, and that distinction is what keeps §14 coherent: its principal never asked for it, holds no keys, and has a real home elsewhere. Because everything a proxy publishes is `_unverified`, it never claims to *be* that person — it claims to mirror them, a claim the gateway can support — so §12's device-generated recovery key, `(seq, hash)` disclosure, and export bundle do not apply: there is no captive user, because there is no user. The price of that carve-out is honesty. A gateway minting proxy identities MUST **disclose** in each proxy's identity document that it is a gateway-operated mirror, who operates it, and where the actor's real home is; MUST **never claim exit** (§14) for a proxy identity; and MUST **withdraw the proxy on the foreign actor's request**, which stands where exit stands for a real hosted identity and is weaker — say so rather than dressing it up. A gateway unwilling to meet these should not mint proxies; ingesting everything under the gateway's own single identity is always available, and costs only per-actor attribution.

**Bridge profiles.** Because the rule above is protocol-independent, a normative profile for a specific protocol is a filled-in table rather than a fresh trust argument. A **syndication-class** profile is far smaller than a mirroring one — the safety-critical ingest slots drop out, leaving the identity seam (README's alias and foreign-account conventions), the backlink form, and the backfeed delivery mechanics above. No profile is defined here; README carries the template and the per-protocol survey. A profile MUST fix, at minimum, the identity and object mappings, the `external_url` form, the **audience test** and **durability test** that decide what may be ingested (the safety-critical slots), the update/delete mapping, which foreign objects have no item representation and MUST NOT be invented into `_rel` types, and the failure semantics when the foreign side disappears or is unreachable. Those last two are where implementers improvise, and improvisation at a trust boundary is how the honest-hub model gets quietly abandoned.
