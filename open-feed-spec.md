# Open Feed Protocol Specification

**Version 0.5.1**

## Abstract

Open Feed is a protocol for decentralized publishing and interaction. Identities are HTTPS URLs. Content is published as signed JSON Feed items. Interactions are signed JSON objects delivered to inboxes. This specification defines the wire formats and verification procedures for interoperability.

## 1. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in RFC 2119.

## 2. Identity

### 2.1. Identity URL

An identity is an HTTPS URL. The URL:

- MUST use the `https` scheme
- MUST return an HTML document (the profile)
- MUST be treated as case-sensitive for the path component
- MUST have the domain component normalized to lowercase
- MUST have default ports removed (`:443` for HTTPS)
- MUST have query parameters stripped when stored or compared
- MUST have fragment identifiers stripped when stored or compared
- MUST have a trailing slash appended if not present

Normalization examples:

| Input | Normalized |
|-------|------------|
| `https://Alice.Example/~mom` | `https://alice.example/~mom/` |
| `https://example.com:443/~alice/` | `https://example.com/~alice/` |
| `https://example.com/~alice?ref=twitter` | `https://example.com/~alice/` |
| `https://example.com/~alice/#about` | `https://example.com/~alice/` |

### 2.2. Profile Document

The profile is an HTML document at the identity URL. It MUST include `<link>` elements for endpoint discovery.

Required links:

| Relation | Purpose |
|----------|---------|
| `jwks` | URL of JWKS document (type `application/jwk-set+json`) |

Optional links:

| Relation | Purpose |
|----------|---------|
| `feed` | URL of JSON Feed (type `application/feed+json`) |
| `inbox` | URL of Open Feed inbox endpoint |
| `webmention` | URL of Webmention endpoint (W3C standard) |
| `profile` | URL of structured profile metadata (type `application/json`) |
| `authorization_endpoint` | OAuth 2.0 authorization endpoint |
| `token_endpoint` | OAuth 2.0 token endpoint |

Implementations MUST support `rel="jwks"`. For backwards compatibility, implementations SHOULD also accept `rel="pubkey"` as an alias.

Example:

```html
<link rel="jwks" href="https://example.com/~alice/keys.json" type="application/jwk-set+json">
<link rel="feed" href="https://example.com/~alice/feed.json" type="application/feed+json">
<link rel="inbox" href="https://example.com/~alice/inbox">
<link rel="webmention" href="https://example.com/~alice/webmention">
```

### 2.3. Redirect Handling

When fetching a profile document:

- Implementations MUST follow HTTP redirects (301, 302, 307, 308)
- Implementations MUST NOT follow more than 5 redirects
- Implementations MUST NOT follow redirects to a different origin for the profile document itself
- Discovered endpoint URLs MAY be on different origins

A cross-origin redirect on the profile document MUST NOT be treated as identity equivalence: if `https://old.example/~alice/` redirects to `https://new.example/`, the two remain distinct identities. Identity migration across origins is expressed with `rel="successor"` and `rel="canonical"` links served at the old identity URL (see Migration in the README), not with cross-origin redirects. Same-origin redirects (e.g., adding a trailing slash, or moving a path within one domain) are followed normally.

### 2.4. Profile Metadata

If `rel="profile"` is present, the linked document MUST be JSON with this structure:

```json
{
  "name": "Display Name",
  "bio": "Short biography",
  "avatar": "https://example.com/avatar.jpg",
  "url": "https://example.com/~alice/",
  "created": "2025-01-15T00:00:00Z",
  "content_warning": "This account posts adult content"
}
```

All fields are OPTIONAL. The `url` field, if present, MUST match the identity URL after normalization.

The `content_warning` field, if present, indicates that all content from this identity should be treated as potentially sensitive. Clients SHOULD display this warning before showing any content from the identity.

## 3. Keys

### 3.1. Key Document (JWKS)

The public key document MUST be a JSON Web Key Set (JWKS) per RFC 7517.

The Content-Type MUST be `application/jwk-set+json`.

```json
{
  "keys": [
    {
      "kid": "key-1",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "base64url-encoded-public-key",
      "iat": 1704067200
    }
  ]
}
```

An active key omits `revoked_at`. Implementations SHOULD omit the field rather than serializing `revoked_at: null`; a present-but-null value MUST be treated identically to an absent one (the key is not revoked).

Required JWK fields:

| Field | Description |
|-------|-------------|
| `kid` | Key ID (unique within this JWKS) |
| `kty` | Key type. MUST be `OKP` for Ed25519. |
| `crv` | Curve. MUST be `Ed25519`. |
| `x` | Base64url-encoded public key bytes (32 bytes for Ed25519) |

Optional JWK fields:

| Field | Description |
|-------|-------------|
| `iat` | Issued-at timestamp (Unix seconds) |
| `revoked_at` | Revocation timestamp (Unix seconds). Open Feed extension. |
| `use` | Key usage. If present, MUST be `sig`. |
| `alg` | Algorithm. If present, MUST be `EdDSA`. |

The `keys` array MUST contain at least one non-revoked key.

A JWKS MAY additionally carry document-level chain fields (`_seq`, `_prev`, `_updated`, `_sig`) for tamper-evident key history; see section 3.7.

**Timestamp formats:**

| Context | Format | Example |
|---------|--------|---------|
| JWK fields (`iat`, `revoked_at`) | Unix seconds (integer) | `1704067200` |
| Content fields (`date_published`, `published`) | ISO 8601 (string) | `"2025-01-01T00:00:00Z"` |

This follows JWT conventions (RFC 7519) for key metadata and JSON Feed conventions for content.

### 3.2. Key ID Construction

The full key identifier used in JWS `kid` headers is constructed by appending a fragment to the JWKS URL:

```
{jwks_url}#{kid}
```

Example: If JWKS is at `https://example.com/~alice/keys.json` and key has `kid: "key-1"`, the full identifier is:

```
https://example.com/~alice/keys.json#key-1
```

### 3.3. Supported Algorithms

Implementations MUST support:

| `kty` | `crv` | JWS `alg` | Description |
|-------|-------|-----------|-------------|
| `OKP` | `Ed25519` | `EdDSA` | EdDSA with Curve25519 |

Implementations MUST ignore keys with unrecognized `kty` or `crv` values.

Future versions MAY define additional algorithms (e.g., post-quantum).

### 3.4. Key Rotation

To rotate keys:

1. Generate a new keypair
2. Add the new key to the `keys` array
3. Begin signing new content with the new key
4. Optionally set `revoked_at` on the old key

Old keys SHOULD remain in the document for at least 30 days after revocation to allow verification of previously-signed content. Producers publishing a Key History Chain MUST additionally keep a rotated-out key listed in any chain version whose `_sig` it produces (section 3.7.2).

### 3.5. Key Revocation

When a key is revoked:

- The `revoked_at` field MUST be set to a Unix timestamp (seconds)
- The timestamp indicates when the key became untrusted
- Signatures on content timestamped after `revoked_at` MUST be rejected
- Signatures on content timestamped before `revoked_at` remain valid

### 3.6. Recovery Keys

Identities MAY designate recovery keys for domain loss scenarios. Recovery keys provide a mechanism to claim identity succession when the original domain becomes inaccessible.

#### 3.6.1. Recovery Key in JWKS

Recovery keys are included in the JWKS with `"use": "recovery"`:

```json
{
  "keys": [
    {
      "kid": "primary-1",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "...",
      "iat": 1704067200
    },
    {
      "kid": "recovery-1",
      "kty": "OKP",
      "crv": "Ed25519",
      "x": "...",
      "use": "recovery",
      "iat": 1704067200
    }
  ]
}
```

Recovery keys:

- MUST NOT be used for regular content signing
- MAY co-sign Key History Chain versions for fork resolution (section 3.7.6)
- MUST be stored securely offline (not on the hub)
- SHOULD be generated at identity creation time
- MAY have multiple recovery keys for redundancy

#### 3.6.2. Recovery Attestation

A recovery attestation is a signed document authorizing recovery key holders to claim succession:

```json
{
  "type": "recovery_attestation",
  "identity": "https://example.com/~alice/",
  "recovery_keys": [
    "https://example.com/~alice/keys.json#recovery-1"
  ],
  "created": "2025-01-15T00:00:00Z",
  "expires": "2030-01-15T00:00:00Z",
  "_sig": "..."
}
```

The attestation:

- MUST be signed by a non-recovery key (proving current control)
- MUST list the authorized recovery key IDs
- SHOULD include an expiration date
- SHOULD be stored securely offline alongside recovery private keys
- MAY be published at `rel="recovery"` for transparency

#### 3.6.3. Claiming Succession via Recovery

To claim succession when the original domain is inaccessible:

1. Establish new identity at new location
2. Create a recovery claim signed by the recovery key:

```json
{
  "type": "recovery_claim",
  "original_identity": "https://old.example/~alice/",
  "new_identity": "https://new.example/~alice/",
  "recovery_attestation": {...},
  "claimed": "2025-06-15T00:00:00Z",
  "_sig": "..."
}
```

3. Publish the recovery claim at the new identity
4. Notify known contacts through out-of-band channels

#### 3.6.4. Verifying Recovery Claims

Verifiers encountering a recovery claim SHOULD:

1. Verify the recovery claim signature against the recovery key
2. Verify the recovery attestation signature (if available from cache)
3. Verify the recovery key was in the original JWKS (if cached)
4. Check that the attestation has not expired
5. Accept or flag the succession for manual review

Verifiers MAY:

- Require additional out-of-band confirmation
- Maintain a cache of known identity-to-recovery-key mappings
- Reject claims if the original domain is still accessible (potential hijack)

If the identity publishes a Key History Chain (section 3.7) and the verifier has a pinned observation, steps 2–3 above become cryptographically verifiable against the pin rather than dependent on an ad-hoc cache (section 3.7.4).

The recovery mechanism is designed for legitimate domain loss. It does not protect against key theft.

### 3.7. Key History Chain

A JWKS is fetched over TLS, but nothing stops a compromised host (or a hijacked domain) from **rolling back** to an older JWKS to un-revoke a key, or **equivocating** by serving different key sets to different readers. The Key History Chain makes both tamper-evident to any consumer who has seen the JWKS even once (trust-on-first-observation), and it is what makes revocation (3.5) and recovery (3.6) verifiable rather than advisory.

Support is OPTIONAL to produce but, once a producer publishes a chain, consumers that have pinned a prior version MUST enforce it (below).

#### 3.7.1. Chained JWKS Fields

A chained JWKS adds these top-level fields (Open Feed extensions, `_` prefixed):

| Field | Description |
|-------|-------------|
| `_seq` | Monotonic version counter (integer). Starts at 1; MUST strictly increase with each published version. |
| `_prev` | Base64url SHA-256 of the **full canonical bytes** (RFC 8785, section 4.3) of the immediately preceding published JWKS document, including its `_sig` and, if present, its `_recovery_sig`. Omitted only for `_seq: 1` (genesis). |
| `_updated` | Publication time of this version (Unix seconds). |
| `_sig` | Detached JWS (section 4) over the canonical JWKS document with the signature fields removed. For `_seq: 1`, signed by a non-revoked key listed in this document; for later versions, signed by a continuity key per section 3.7.2. |
| `_history_url` | OPTIONAL. URL of the chain history document (section 3.7.5). |
| `_recovery_sig` | OPTIONAL. Second detached JWS by a recovery key, for fork resolution (section 3.7.6). |

The `_sig` is self-referential (signed by a key in the document it certifies), like a self-signed certificate. It provides continuity and tamper-evidence **between versions**; it does not bootstrap first-contact trust (that remains TOFU).

Genesis example (`_seq: 1`):

```json
{
  "keys": [
    { "kid": "key-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "iat": 1736899200 },
    { "kid": "recovery-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "recovery", "iat": 1736899200 }
  ],
  "_seq": 1,
  "_updated": 1736899200,
  "_sig": "<detached JWS by key-1 over the canonical document without _sig>"
}
```

Next version (`_seq: 2`) — rotate to `key-2`, revoke `key-1`, chained to the genesis via `_prev`:

```json
{
  "keys": [
    { "kid": "key-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "iat": 1736899200, "revoked_at": 1739577600 },
    { "kid": "key-2", "kty": "OKP", "crv": "Ed25519", "x": "...", "iat": 1739577600 },
    { "kid": "recovery-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "recovery", "iat": 1736899200 }
  ],
  "_seq": 2,
  "_prev": "<base64url SHA-256 of the canonical _seq:1 document, including its _sig>",
  "_updated": 1739577600,
  "_sig": "<detached JWS by key-1 over the canonical document without _sig>"
}
```

Here `_prev` is the base64url SHA-256 of the full canonical bytes of the `_seq: 1` document above (including that document's `_sig`). A fully-computed chain vector — with the real key `x` from Appendix F and reproducible `_prev`/`_sig` values — is given in Appendix F.8.

Note that `_seq: 2` is signed by `key-1` — the continuity key that was valid in `_seq: 1` — even though this same document revokes it. Signing with the newly-introduced `key-2` would violate section 3.7.2, since `key-2` was not present in the previous version.

#### 3.7.2. Producing a New Version

1. Start from the current published document
2. Apply key changes (add/rotate/revoke)
3. Set `_seq` to previous `_seq + 1`
4. Set `_prev` to the base64url SHA-256 of the previous document's full canonical bytes
5. Set `_updated`
6. Sign with a current non-revoked key → `_sig`

Each version MUST be signed by a key that was **valid (non-revoked) in the previous version**, so an attacker who steals a current key cannot fork the chain forward without also having been in the trusted prior state.

The continuity key will often be revoked **in the new version** — that is the normal rotation case. Validity is assessed against the previous version's state: verifiers MUST NOT reject a chain `_sig` merely because the signing key carries `revoked_at` in the very document it signs. The genesis (`_seq: 1`) has no previous version and is signed by a non-revoked key it contains.

The continuity key MUST remain listed in the `keys` array of the version it signs (normally with `revoked_at` set). If it were removed, the document's `_sig` could not be verified from the document alone. It MAY be removed in *later* versions (each version contains its own signing key, which is all a history walk needs); the 30-day retention guidance of section 3.4 still applies for verifying previously-signed content.

#### 3.7.3. Consumer Enforcement (Pinning)

A consumer that has verified a JWKS at `(_seq: N, hash: H)` MUST store that pin. On any later fetch of the same identity's JWKS, the consumer MUST:

1. Verify the new document's `_sig`: the key named by its `kid` MUST be listed in the document itself (section 3.7.2 requires this) and the signature MUST verify against it
2. Verify the new document chains back to the pin: following `_prev` links — retrieving any intermediate versions via the chain history (section 3.7.5) — reaches `(N, H)` as an ancestor. At each hop, verify that version's `_sig` and confirm its signing key was **valid (non-revoked) in the predecessor version** (the continuity rule, section 3.7.2)
3. Reject if `_seq` decreased, if `_prev` does not match the known predecessor, or if two documents claim the same `_seq` with different hashes (equivocation)

A consumer encountering a chained JWKS for the first time accepts it (TOFU) and pins it. Rollback and equivocation are detectable from the **second** observation onward, or immediately for any two consumers who compare pins out-of-band.

Consumers that do not implement chaining ignore the `_` fields (they are preserved per the extension rules) and fall back to plain JWKS semantics.

#### 3.7.4. Interaction with Recovery

When recovery keys (3.6) are committed in the chain, a recovery claim becomes verifiable by anyone holding one honest prior observation: the verifier confirms the claimed recovery key was present at a pinned `(_seq, hash)`. This upgrades section 3.6.4 steps 2–3 from "if cached" to "verifiable against the pin," closing the domain-hijack gap for consumers who observed the identity before the hijack. First-contact-after-hijack still cannot be protected without an external anchor (transparency log / witness network — deferred).

#### 3.7.5. Chain History Retrieval

Only the latest JWKS version is served at the JWKS URL, but consumer enforcement (3.7.3) requires walking `_prev` links across every version published since the consumer's pin. Producers publishing a chain therefore MUST retain all prior versions and make them retrievable. The RECOMMENDED mechanism is a `_history_url` field in the chained JWKS pointing to a JSON document:

```json
{
  "versions": [
    { "...": "verbatim _seq:1 document" },
    { "...": "verbatim _seq:2 document" }
  ]
}
```

Requirements:

- Each entry in `versions` MUST canonicalize (section 4.3, with no fields removed) to bytes whose SHA-256 matches the successor version's `_prev` (byte-preserving storage is the simplest way to guarantee this)
- Entries MUST be in ascending `_seq` order and SHOULD include every version from genesis onward; the current version MAY be included
- Consumers SHOULD cap the number and size of history versions they process (section 10.6)

A consumer that cannot obtain the intermediate versions needed to connect its pin to the current document MUST treat the chain as unverifiable (equivalent to a `_prev` mismatch) rather than silently re-pinning.

#### 3.7.6. Fork Resolution via Recovery Co-Signature

Equivocation detection (3.7.3) reveals *that* two documents claim the same `_seq`; it cannot reveal *which* branch is honest — after a key theft, the thief holds the same continuity key as the owner and can sign a competing successor version.

To resolve forks, a chained JWKS MAY carry `_recovery_sig`: a second detached JWS signed by a key with `"use": "recovery"` that was present in a pinned ancestor version. When both signature fields are present, `_sig` and `_recovery_sig` are each computed over the canonical document with **both** fields removed (they sign the same payload, each under its own JWS header). The successor version's `_prev` hashes the full published document — including both signature fields (section 3.7.1).

Because recovery keys are stored offline (3.6.1), a thief of the online signing key cannot produce `_recovery_sig`. A verifier that detects a fork SHOULD prefer the branch carrying a valid recovery co-signature. A fork where neither branch carries one is cryptographically unresolvable and SHOULD be flagged for manual review.

Producers SHOULD add `_recovery_sig` to the first version published after a suspected key compromise.

## 4. Signatures

### 4.1. Signature Format

Signatures use JWS Compact Serialization (RFC 7515) with a detached, **unencoded** payload per RFC 7797 (JWS Unencoded Payload Option):

```
base64url(header)..base64url(signature)
```

The payload is not included in the serialization (detached mode). The two consecutive dots (`..`) indicate the empty payload section.

The payload is the canonical JSON bytes (section 4.3). Because the payload is unencoded (`b64: false`), the JWS Signing Input is:

```
ASCII(BASE64URL(UTF8(header)) || '.') || canonical-json-bytes
```

This is critical: the signature covers **both the protected header and the payload**. A construction that signs only the canonical payload bytes (omitting the header) MUST NOT be used — it would leave `alg` and `kid` unauthenticated, allowing an attacker to swap the referenced key.

### 4.2. JWS Header

The JWS protected header MUST include:

```json
{
  "alg": "EdDSA",
  "b64": false,
  "crit": ["b64"],
  "kid": "https://example.com/~alice/keys.json#key-1"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `alg` | MUST | Algorithm identifier. MUST be `EdDSA` for Ed25519. |
| `b64` | MUST | MUST be `false` (unencoded payload, RFC 7797). |
| `crit` | MUST | MUST be `["b64"]`, marking `b64` as a header parameter that MUST be understood. |
| `kid` | MUST | Full key identifier: `{jwks_url}#{kid}` (see section 3.2) |

Implementations MUST reject signatures with unrecognized `alg` values, and MUST reject signatures where `alg` is `EdDSA` but the referenced key's `crv` is not `Ed25519` (the `alg` value alone does not fix the curve). Implementations MUST reject a signature whose `crit` includes a parameter they do not understand.

### 4.3. Canonicalization

Before signing or verifying, JSON MUST be canonicalized:

1. Remove the `_sig` field if present (for chained JWKS documents carrying `_recovery_sig`, remove both signature fields; section 3.7.6)
2. Serialize per RFC 8785 (JSON Canonicalization Scheme):
   - UTF-8 encoding
   - No whitespace between tokens
   - Object keys sorted lexicographically (recursive)
   - No trailing commas
   - Numbers serialized without unnecessary leading zeros or trailing zeros after decimal

String values are signed and verified **byte-exact as published** — no Unicode normalization is applied at signing or verification time. Producers SHOULD emit all string values in NFC form. (Verify-time NFC normalization was removed in v0.5.0: stock RFC 8785 libraries do not normalize, so the extra step invited silent divergence between conformant and de facto implementations, and it made NFC-equivalent byte variants signature-compatible — a malleability. A pipeline that re-normalizes Unicode after signing breaks its own signatures, which is detectable and is that pipeline's bug.)

Implementations MUST reject JSON in which any object contains duplicate member names (I-JSON, RFC 7493). Parsers disagree on which duplicate wins, so a duplicate-key payload could verify against one interpretation while the application acts on another.

### 4.4. Signing Process

To sign a JSON object:

1. Remove any existing `_sig` field
2. Canonicalize the object (section 4.3) → `canonical-json-bytes`
3. Construct the protected header (section 4.2) and compute `header-b64 = BASE64URL(UTF8(header))`
4. Compute the JWS Signing Input: `ASCII(header-b64 || '.') || canonical-json-bytes`
5. Sign the Signing Input with the private key (Ed25519)
6. Set `_sig` to `header-b64 || '..' || BASE64URL(signature)`

### 4.5. Verification Process

To verify a signed JSON object:

1. Extract and remove the `_sig` field
2. Canonicalize the object (section 4.3) → `canonical-json-bytes`
3. Parse the JWS header. Confirm `alg` is `EdDSA`, `b64` is `false`, and `crit` is `["b64"]`; reject otherwise
4. Extract `kid` and split it into `{jwks_url}#{key_id}`
5. **Determine the claimed author** and confirm key ownership: the `jwks_url` in `kid` MUST match a JWKS URL discovered from the claimed author's profile (section 4.6). Reject if it does not. Possession of a public key MUST NOT be treated as ownership of an identity.
6. Fetch the claimed author's JWKS document and find the key matching `key_id`
7. Reconstruct the Signing Input: `ASCII(header-b64 || '.') || canonical-json-bytes`
8. If the key has `iat`, verify the key was created before the content's **effective signing time** — `date_modified` if present, otherwise `date_published` (feed items) / `published` (interactions)
9. Verify the key was not revoked before the effective signing time (check `revoked_at`)
10. Verify the Ed25519 signature over the Signing Input

If `iat` is not present on the key, skip step 8 (assume the key existed at the time of signing).

Using the effective signing time (step 8) rather than `date_published` alone allows content to be legitimately re-signed with a newer key after key rotation or compromise (section 3.4, 3.5) while retaining its original publication date: the re-signer sets `date_modified` to the actual signing time and bumps `_version`.

### 4.6. Author Binding

A signature proves that some key signed some bytes. To prevent an attacker from republishing another identity's signed content under their own name (by copying that identity's public key into their own JWKS), the signed payload MUST cryptographically bind the signing identity:

- **Feed items** MUST include an item-level `authors` array (JSON Feed 1.1) in the signed payload, containing an entry whose `url` is the identity URL of the signer. Because feed-level `authors` live in the feed document (not the item), they are **not** covered by the item signature and MUST NOT be relied on for author binding.
- **Interaction objects** already bind the author via the required top-level `author` field (section 6.1).

During verification, the claimed author (step 5 above) is:

- For a feed item: the `url` of an entry in the item's signed `authors` array.
- For an interaction: the top-level `author` field.

The signing key's owner MUST match the claimed author. Implementations MUST reject content where the signed author binding is absent or does not match the identity whose JWKS contains the signing key.

Items MAY additionally include a `_feed_url` field in the signed payload to bind the item to its containing feed; verifiers MAY reject items whose `_feed_url` does not match the feed they were retrieved from.

## 5. Feeds

### 5.1. Feed Document

Feeds MUST conform to JSON Feed 1.1 (https://jsonfeed.org/version/1.1).

The Content-Type MUST be `application/feed+json`.

Required fields:

| Field | Description |
|-------|-------------|
| `version` | MUST be `https://jsonfeed.org/version/1.1` |
| `title` | Feed title |
| `feed_url` | Canonical URL of this feed |
| `authors` | Array with at least one author |

At least one author's `url` field MUST be a valid Open Feed identity URL. For single-author feeds, this SHOULD match the feed owner's identity URL.

### 5.1.1. Feed Ownership

A feed is owned by the identity whose profile links to it via `rel="feed"`.

Feeds MAY have multiple authors. Each item is signed by its author, who MUST be listed in the feed's `authors` array or the item's `authors` array.

The feed owner:

- Controls who may publish to the feed
- Is responsible for serving the feed document
- MAY be different from item authors

For single-author feeds, the owner and sole author are the same identity.

### 5.2. Feed Items

Each item MUST include:

| Field | Description |
|-------|-------------|
| `id` | Globally unique identifier (see 5.3) |
| `date_published` | ISO 8601 timestamp |
| `authors` | Array with at least one author; one entry's `url` MUST be the signer's identity URL (author binding, section 4.6) |
| `_sig` | JWS signature (see section 4) |

Each item SHOULD include:

| Field | Description |
|-------|-------------|
| `content_text` | Plain text content |
| `_version` | Integer version number (starts at 1) |
| `_feed_url` | Canonical URL of the containing feed (binds the item to its feed, section 4.6) |

For HTML content, `content_html` MAY be used instead of or in addition to `content_text`.

The item-level `authors` array is REQUIRED (not optional) because it is the only author information covered by the item signature; feed-level `authors` are not part of the item's signed bytes (section 4.6). The signing key MUST belong to one of the item's `authors`. In a single-author feed, the item's `authors` entry is the same identity as the feed owner.

### 5.3. Item Identifiers

Item `id` values MUST be globally unique. RECOMMENDED formats:

- UUID URN: `urn:uuid:550e8400-e29b-41d4-a716-446655440000`
- Tag URI: `tag:example.com,2025-12-07:alice:001`

Once published, an item's `id` MUST NOT change.

### 5.4. Item Versioning

To edit a post:

1. Increment the `_version` field
2. Set `date_modified` to the edit timestamp
3. Update content fields as needed
4. Generate a new `_sig` over the updated item

The `id` MUST remain the same across versions. The combination of `id` and `_version` uniquely identifies a signed item.

Feeds SHOULD contain only the latest version of each item. Historical versions MAY be made available via `_history_url`.

#### 5.4.1. Item Deletion (Tombstones)

To delete a published item, publish a final version that is a **tombstone**:

1. Keep the same `id`
2. Increment `_version` and set `date_modified` to the deletion time
3. Set `_deleted: true`
4. Remove content fields (`title`, `content_html`, `attachments`, `summary`, `image`); set `content_text` to the empty string (JSON Feed requires a content field to be present)
5. Retain the fields required for verification: `authors`, `date_published`, and `_feed_url` if used
6. Sign the tombstone (section 4)

Consumers encountering a valid tombstone SHOULD delete cached content for that `id` and SHOULD retain the tombstone itself, so the content is not resurrected from a stale cache or a replayed earlier version (the tombstone's higher `_version` wins). The tombstone SHOULD remain in the feed (or its archive) for at least 30 days.

Deletion is best-effort: consumers that never re-fetch cannot be forced to delete. See the README's discussion of legal deletion for the policy implications.

### 5.5. Attachments

Media attachments use the JSON Feed `attachments` array:

```json
{
  "attachments": [
    {
      "url": "https://example.com/photo.jpg",
      "mime_type": "image/jpeg",
      "size_in_bytes": 245000,
      "title": "Alt text description"
    }
  ]
}
```

Attachment metadata is covered by the item signature. The media bytes themselves are not signed.

### 5.6. Feed Pagination

Feeds SHOULD contain at least the 50 most recent items.

For older items, use JSON Feed's `next_url` field:

```json
{
  "items": [...],
  "next_url": "https://example.com/~alice/feed.json?before=2025-01-01"
}
```

## 6. Interactions

### 6.1. Interaction Object

An interaction is a signed JSON object with this structure:

```json
{
  "type": "reply",
  "id": "urn:uuid:...",
  "target": "https://example.com/~alice/feed.json",
  "target_item": "urn:uuid:...",
  "author": "https://example.com/~bob/",
  "content": "Reply text",
  "published": "2025-12-07T15:00:00Z",
  "_sig": "..."
}
```

Required fields:

| Field | Description |
|-------|-------------|
| `type` | Interaction type (see 6.2) |
| `id` | Globally unique identifier |
| `target` | Feed URL or identity URL being interacted with |
| `author` | Identity URL of the interaction author |
| `published` | ISO 8601 timestamp |
| `_sig` | JWS signature by the author |

Optional fields:

| Field | Description |
|-------|-------------|
| `target_item` | Specific item ID within the feed |
| `content` | Text content (required for `reply`) |
| `source` | Source URL where interaction originates (required for `mention`) |
| `_in_reply_to` | ID of parent interaction for nested threading (see 6.6) |

The `content` field is plain text. Receivers MUST NOT interpret it as HTML and MUST escape it when rendering into an HTML context. Rich formatting in interactions is out of scope; hubs that display comments as HTML derive that HTML themselves (escaping, optional autolinking).

The `id` MUST be globally unique for each distinct **original** interaction from an author. Two different original interactions (e.g., a `like` and a `reply`) MUST NOT share an `id`.

Two operations deliberately reuse an existing `id` and are not new original interactions:

- An **update** (section 6.4) reuses the `id` of the interaction it replaces and keeps the same `type`.
- A **delete** (section 6.5) reuses the `id` of the interaction it removes, with `type: "delete"`.

An update MUST NOT change the `type` of an interaction. To change type (for example, to switch a reaction), send a `delete` for the original and a new interaction with a fresh `id`.

### 6.2. Interaction Types

| Type | Description | `content` | `target_item` |
|------|-------------|-----------|---------------|
| `reply` | Textual response | REQUIRED | REQUIRED |
| `like` | Endorsement | MUST NOT | REQUIRED |
| `repost` | Share to own feed | MUST NOT | REQUIRED |
| `mention` | Notification of mention | MUST NOT | MUST NOT |
| `delete` | Remove previous interaction | MUST NOT | MUST NOT |

**Type-specific requirements:**

For `mention`:
- `target` MUST be the mentioned identity URL (not feed URL)
- `source` MUST be the URL where the mention appears
- `target_item` MUST NOT be present
- `content` MUST NOT be present

For `delete`:
- `id` MUST match the interaction being deleted
- The author MUST be the same as the original interaction

Custom types MUST be prefixed with `x-` (e.g., `x-emoji-react`).

### 6.2.1. Reply Publication

Replies create a dual record for discoverability and verification:

1. **Inbox delivery** - Notify the target that a reply exists
2. **Feed publication** - Create a permanent, signed, discoverable record

When sending a `reply` interaction:

- The reply SHOULD be published to the author's own feed with `_reply_to` field
- The reply SHOULD be delivered to the target's inbox
- The `id` in the feed item and inbox interaction MUST match

Example feed item (in author's feed):

```json
{
  "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "authors": [{ "url": "https://example.com/~bob/" }],
  "_feed_url": "https://example.com/~bob/feed.json",
  "content_text": "Great post!",
  "date_published": "2025-12-07T16:00:00Z",
  "_reply_to": "https://example.com/~alice/feed.json#urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "_sig": "..."
}
```

Example inbox interaction (sent to target):

```json
{
  "type": "reply",
  "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
  "target": "https://example.com/~alice/feed.json",
  "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "author": "https://example.com/~bob/",
  "content": "Great post!",
  "published": "2025-12-07T16:00:00Z",
  "_sig": "..."
}
```

This dual publication ensures:

- **Discoverability** - Others can find the reply in the author's feed
- **Notification** - The target knows a reply exists
- **Verification** - Both records are signed by the same key with the same ID
- **Permanence** - The reply exists even if the target's inbox is cleared

Receivers MAY verify that a reply exists in the author's feed, but MUST NOT require it (the author may not have a feed, or may be using inbox-only replies).

### 6.3. Replay Prevention

Interactions MUST be rejected if:

- The `target` does not match the inbox owner's feed or identity
- The `id` has already been received from this author with an equal or later `published` timestamp
- The `published` timestamp is more than 7 days in the past
- The `published` timestamp is more than 24 hours in the future

Interactions with the same `id` and a later `published` timestamp replace the previous version (see 6.4).

### 6.4. Interaction Updates

To update an interaction, send a new interaction with:

- The same `id`
- A later `published` timestamp
- A valid signature

The recipient SHOULD replace the previous version. This mechanism allows correcting typos or editing the `content` of a reply. It MUST NOT be used to change the interaction `type`; to change type (e.g., switch a reaction), delete the original and send a new interaction (section 6.1).

### 6.5. Interaction Deletion

To delete an interaction:

1. Create an interaction with `type: "delete"`
2. Set `id` to the ID of the interaction being deleted
3. Sign and send to the same inbox

The recipient SHOULD remove or hide the original interaction.

### 6.6. Threading

Reply interactions support nested threading via the `_in_reply_to` field.

| Field | Description |
|-------|-------------|
| `target_item` | REQUIRED. The root post being discussed. |
| `_in_reply_to` | OPTIONAL. The specific interaction this replies to. |

If `_in_reply_to` is omitted, the reply is a direct response to the root post.

If `_in_reply_to` is present, it MUST be the `id` of another interaction on the same `target_item`.

Example nested reply:

```json
{
  "type": "reply",
  "id": "urn:uuid:charlie-reply-1",
  "target": "https://example.com/~alice/feed.json",
  "target_item": "urn:uuid:root-post-id",
  "_in_reply_to": "urn:uuid:bob-reply-1",
  "author": "https://example.com/~charlie/",
  "content": "Replying to Bob's reply",
  "published": "2025-12-07T16:30:00Z",
  "_sig": "..."
}
```

Clients MAY display threads as flat (sorted by time) or nested (grouped by `_in_reply_to`). Clients SHOULD provide controls to collapse deeply nested threads.

## 7. Interaction Delivery

Open Feed supports two delivery mechanisms for interactions:

1. **Open Feed Inbox** - Rich, signed interaction objects (section 7.1)
2. **Webmention** - W3C standard, simpler but less structured (section 7.2)

Implementations MAY support one or both. If both endpoints are advertised, senders SHOULD prefer the inbox for richer semantics.

### 7.1. Open Feed Inbox

#### 7.1.1. Endpoint

The inbox accepts interactions via HTTP POST:

```
POST /~alice/inbox HTTP/1.1
Host: example.com
Content-Type: application/json

{...interaction object...}
```

#### 7.1.2. CORS

Inbox endpoints MUST include CORS headers to allow cross-origin requests:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

#### 7.1.3. Verification

The inbox MUST perform these verification steps. Cheap, local checks are done **before** any outbound network fetch, so that unauthenticated senders cannot force the server to make requests (see section 10.5 and 10.11):

1. Parse the interaction JSON (enforce body size limits, section 10.6)
2. Validate required fields are present
3. Validate `type` is known or prefixed with `x-`
4. Apply replay-prevention timestamp bounds and per-source-IP rate limits (section 6.3, 7.3) **before** fetching anything
5. Extract `author` URL and normalize it per section 2.1
6. Parse the `_sig` header; extract `kid` and split into `{jwks_url}#{key_id}`
7. Confirm the `jwks_url` from `kid` belongs to the `author`'s profile: fetch the author's profile document and discover its `rel="jwks"` link. The `jwks_url` MUST match a JWKS URL advertised by that profile. Reject otherwise (do not fetch an arbitrary attacker-supplied JWKS URL). Cache negative results to avoid repeated fetches for the same bad author.
8. Fetch the JWKS document and find the key matching `key_id`
9. Verify the key was not revoked before the effective signing time (section 4.5)
10. Verify the signature per section 4.5 (including author binding, section 4.6)
11. Apply the remaining replay prevention rules per section 6.3

Because verification requires outbound fetches (profile, JWKS), and the `author` URL is attacker-controlled until step 10 succeeds, implementations MUST rate-limit by source IP (not only by `author`) and SHOULD negatively cache failed author/JWKS fetches, so a stream of interactions bearing forged author URLs cannot be used to amplify requests toward a third party.

#### 7.1.4. Response Codes

| Status | Meaning |
|--------|---------|
| `202 Accepted` | Interaction received and queued for processing |
| `400 Bad Request` | Malformed JSON or missing required fields |
| `401 Unauthorized` | Invalid signature or revoked key |
| `403 Forbidden` | Author is blocked |
| `404 Not Found` | Target item does not exist |
| `409 Conflict` | Duplicate interaction ID (with equal or later timestamp) |
| `429 Too Many Requests` | Rate limited |

Implementations SHOULD NOT distinguish between "queued for moderation" and "auto-approved" in the response.

#### 7.1.5. Reading Interactions

Inbox endpoints SHOULD support authenticated GET requests to retrieve received interactions.

```
GET /~alice/inbox HTTP/1.1
Host: example.com
Authorization: Bearer {token}
```

The response format is implementation-specific. Hubs MAY support:

- Pagination via query parameters
- Filtering by type, author, or target
- Real-time updates via WebSub, SSE, or WebSocket

Authentication MUST be required for GET requests. The inbox owner (or their delegates) are the only authorized readers.

#### 7.1.6. Error Responses

Error responses SHOULD include a JSON body:

```json
{
  "error": "error_code",
  "message": "Human-readable description"
}
```

Standard error codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `invalid_json` | 400 | Request body is not valid JSON |
| `missing_field` | 400 | Required field is missing |
| `invalid_signature` | 401 | Signature verification failed |
| `key_revoked` | 401 | Signing key was revoked before `published` |
| `author_blocked` | 403 | Author is blocked by recipient |
| `target_not_found` | 404 | `target_item` does not exist |
| `duplicate_id` | 409 | Interaction with this ID already exists (not an update) |
| `rate_limited` | 429 | Too many requests |

### 7.2. Webmention (W3C Standard)

Webmention is a W3C Recommendation for cross-site interaction notification. Open Feed implementations MAY support Webmention as an alternative or complement to the inbox.

#### 7.2.1. Endpoint

```
POST /~alice/webmention HTTP/1.1
Host: example.com
Content-Type: application/x-www-form-urlencoded

source=https://bob.example/posts/123&target=https://alice.example/posts/456
```

| Parameter | Description |
|-----------|-------------|
| `source` | URL of the page containing the interaction |
| `target` | URL of the page being interacted with |

#### 7.2.2. Verification

The Webmention endpoint MUST:

1. Validate `source` and `target` are valid URLs
2. Fetch the `source` URL
3. Verify `source` contains a link to `target`
4. Parse the source to extract interaction details

For Open Feed sources, the receiver SHOULD:

1. Parse the source as JSON Feed or locate the relevant feed item
2. Verify the item's signature per section 4.5
3. Extract interaction type from `_reply_to`, `_like_of`, or `_repost_of` fields (see 7.2.3)

For sources that do not carry a verifiable Open Feed signature, any author identity claimed inside the source markup (e.g., an h-card `p-author` URL) is self-asserted by the page containing it. Receivers MUST NOT treat such a claim as an authenticated identity unless the claimed identity URL (normalized per section 2.1, including its trailing slash) is a **string prefix of the `source` URL**. Author claims that fail the prefix check SHOULD be treated as unverified (queued for moderation or displayed as unauthenticated) — otherwise any page could impersonate any identity simply by naming it as author.

A same-origin check alone is NOT sufficient: origins are scheme + host + port, but Open Feed identities are commonly path-scoped (`https://example.com/~alice/` and `https://example.com/~bob/` share an origin). Under a same-origin rule, any page on a shared host could impersonate any identity on that host. The prefix rule confines a claim to pages under the identity's own path: `https://example.com/~alice/replies/1.html` may claim `https://example.com/~alice/`, but not `https://example.com/~bob/`. An apex-domain identity (`https://jessepence.com/`) is a prefix of every path on its origin, so it retains same-origin semantics. The trailing slash required by section 2.1 normalization prevents sibling-path confusion (`/~alice/` is not a prefix of `/~alice-evil/...`).

#### 7.2.3. Feed Item Extensions for Webmention

When publishing interactions to your own feed (for Webmention discovery), use these extension fields:

| Field | Interaction Type | Value |
|-------|-----------------|-------|
| `_reply_to` | Reply | URL identifying the post being replied to |
| `_like_of` | Like | URL identifying the post being liked |
| `_repost_of` | Repost | URL identifying the post being reposted |

The URL value identifies the target post. It is either the post's HTML permalink (for Webmention discovery, the target's page must link back), or, when referring to a feed item that has no standalone permalink, `{feed_url}#{item_id}` (as used in the dual-publication example in section 6.2.1). Both forms are permitted; use the permalink when one exists, since Webmention verification (section 7.2.2) fetches the `source` and looks for a link to `target`.

Example reply published to own feed:

```json
{
  "id": "urn:uuid:...",
  "content_text": "Great post!",
  "date_published": "2025-12-07T15:00:00Z",
  "_reply_to": "https://alice.example/posts/456",
  "_sig": "..."
}
```

The author then sends a Webmention with `source` pointing to their feed item.

#### 7.2.4. Response Codes

Per the Webmention specification:

| Status | Meaning |
|--------|---------|
| `200 OK` or `201 Created` | Webmention accepted |
| `202 Accepted` | Webmention queued for async processing |
| `400 Bad Request` | Invalid source or target (including a target that does not exist) |

### 7.3. Rate Limiting

Implementations SHOULD rate limit by:

- Author identity URL (for inbox)
- Source domain (for Webmention)
- Source IP address (as fallback)

Rate limit values are implementation-specific. RECOMMENDED: 100 interactions per hour per author.

Rate limited responses SHOULD include `Retry-After` header.

### 7.4. Replies Endpoint

Profile documents MAY include a replies endpoint for thread discovery:

```html
<link rel="replies" href="https://example.com/~alice/replies">
```

#### 7.4.1. Query Parameters

The replies endpoint MUST accept:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `item` | MUST | Item ID to retrieve replies for |

The `item` value is an item `id`, which commonly contains reserved characters (e.g., the `:` in `urn:uuid:...` or `tag:...`). Clients MUST percent-encode the value; servers MUST percent-decode it before comparison. The unencoded examples below are shown for readability only.

The endpoint SHOULD accept:

| Parameter | Description |
|-----------|-------------|
| `since` | ISO 8601 timestamp; return replies after this time |
| `limit` | Maximum number of replies to return (default: 50) |

Example request:

```
GET /~alice/replies?item=urn:uuid:550e8400-e29b-41d4-a716-446655440000
```

#### 7.4.2. Response Format

The response MUST be JSON with Content-Type `application/json`:

```json
{
  "item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
  "replies": [
    {
      "type": "reply",
      "id": "urn:uuid:661f9511-f3ac-52e5-b827-557766551111",
      "target": "https://example.com/~alice/feed.json",
      "target_item": "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      "author": "https://example.com/~bob/",
      "content": "Great post!",
      "published": "2025-12-07T16:00:00Z",
      "_sig": "..."
    }
  ],
  "next_url": "https://example.com/~alice/replies?item=...&since=2025-12-07T16:00:00Z"
}
```

The `replies` array contains interaction objects reproduced **verbatim** as received via inbox, so that their signatures remain verifiable. Servers MUST NOT add, remove, or reorder fields within a reply object (doing so invalidates the signature); in particular, an absent `_in_reply_to` MUST be omitted, not serialized as `null`. Threading structure is read from `_in_reply_to` when present (its absence means a direct reply to the item).

#### 7.4.3. Access Control

The replies endpoint:

- MAY be publicly accessible (unauthenticated GET)
- MAY require authentication for full access
- MAY return a filtered subset for unauthenticated requests
- SHOULD allow the identity owner to moderate (hide/show) replies

Implementations MAY return only replies the owner has approved for public display.

#### 7.4.4. Reply Discovery

Consumers discovering threads SHOULD:

1. Fetch the replies endpoint for the target item
2. Verify each reply's signature against the reply author's JWKS
3. Build thread structure using `_in_reply_to` relationships
4. Handle missing replies gracefully (author may have moderated them)

### 7.5. Outbox Endpoint

Profile documents MAY include an outbox endpoint:

```html
<link rel="outbox" href="https://example.com/~alice/outbox">
```

The outbox contains interactions sent by the identity owner, providing:

- Sync across multiple clients
- Audit trail of sent interactions
- Discoverability of public interactions

#### 7.5.1. Endpoint Requirements

GET requests to the outbox:

- MUST require authentication (see section 8)
- MUST return only interactions sent by the authenticated identity
- SHOULD support pagination via `next_url`
- SHOULD support filtering by `type` query parameter

```
GET /~alice/outbox?type=reply
Authorization: Bearer {token}
```

#### 7.5.2. Response Format

Delivery metadata MUST be carried in an envelope around the signed interaction, never as extra fields inside it (which would invalidate the signature):

```json
{
  "interactions": [
    {
      "delivered": true,
      "delivered_at": "2025-12-07T16:00:01Z",
      "interaction": {
        "type": "reply",
        "id": "urn:uuid:...",
        "target": "https://bob.example/feed.json",
        "target_item": "urn:uuid:...",
        "author": "https://example.com/~alice/",
        "content": "Great post!",
        "published": "2025-12-07T16:00:00Z",
        "_sig": "..."
      }
    }
  ],
  "next_url": "..."
}
```

The `delivered` and `delivered_at` fields are implementation-specific envelope metadata. The `interaction` object is reproduced verbatim (including its `_sig`) so it remains independently verifiable.

#### 7.5.3. Writing to Outbox

Implementations MAY support POST to outbox as an alternative to direct inbox delivery:

```
POST /~alice/outbox
Authorization: Bearer {token}
Content-Type: application/json

{...interaction object without _sig...}
```

The hub:

1. Validates the request
2. Signs the interaction with the user's key
3. Stores in outbox
4. Delivers to target inbox
5. Returns the signed interaction with delivery status

This pattern allows hub-managed keys while maintaining the interaction model.

## 8. Authentication

### 8.1. Operator Authentication (OAuth)

For operations where a user authenticates to **their own hub** (posting to one's own feed, managing identity, reading one's inbox/outbox), implementations SHOULD use OAuth 2.0 with discovery per IndieAuth.

The profile document links to endpoints:

```html
<link rel="authorization_endpoint" href="...">
<link rel="token_endpoint" href="...">
```

Token format and authentication methods (WebAuthn, magic link, etc.) are implementation-specific.

### 8.2. Authorized Fetch (Restricted Feeds)

OAuth (8.1) authenticates a user to their own hub. It does not solve the cross-hub case: a reader on hub A fetching a **restricted-visibility feed** served by hub B, where A and B share no accounts. Open Feed solves this with **Authorized Fetch** — the reader proves control of their identity by signing the request with the same Ed25519 keys used everywhere else. No shared secrets, no pre-provisioned tokens.

#### 8.2.1. Restricted Feeds

A feed (or feed variant) MAY be restricted. A restricted feed:

- MUST return `401 Unauthorized` to an unauthenticated GET, with a `WWW-Authenticate: OpenFeed-Sig` challenge header
- MUST NOT be advertised in a way that leaks its contents to unauthenticated clients
- Is served only to readers whose identity appears on the feed owner's authorized-reader list (an implementation-maintained allowlist; format is out of scope)

Restricted feeds are for audience control (family-only, friends-only), **not** confidentiality: the serving hub can read the content. End-to-end encryption is out of scope (section 10.2).

#### 8.2.2. Fetch Assertion

To fetch a restricted resource, the reader presents a short-lived, self-signed EdDSA JWT (RFC 7519) in the `Authorization` header:

```
GET /~mom/feed.json HTTP/1.1
Host: pence.family
Authorization: OpenFeed-Sig eyJhbGciOiJFZERTQSIsInR5cCI6Im9wZW5mZWVkLWZldGNoK2p3dCIsImtpZCI6...
```

The JWT uses standard JWS Compact Serialization (encoded payload — this is a token, not detached content). Header:

```json
{ "alg": "EdDSA", "typ": "openfeed-fetch+jwt", "kid": "https://reader.example/keys.json#test-key-1" }
```

Claims:

| Claim | Description |
|-------|-------------|
| `iss` | Reader's identity URL (normalized, section 2.1). The identity being authenticated. |
| `htm` | HTTP method, uppercase (`GET`). Binds the assertion to a method. |
| `htu` | Target URL (resource-normalized, below), without query string. Binds the assertion to this resource. |
| `iat` | Issued-at (Unix seconds). |
| `exp` | Expiry (Unix seconds). MUST be no more than 300 seconds after `iat`. |
| `jti` | Unique token identifier (nonce) for replay detection. |

**Resource-URL normalization** (for `htu`): lowercase the scheme and host, remove the default port (`:443`), and strip the query string and fragment. The path is preserved **byte-for-byte** — the identity-URL normalization of section 2.1 (which appends a trailing slash) MUST NOT be applied, since it would corrupt resource paths like `/~mom/feed.json`.

The `htm`/`htu` binding prevents a captured assertion from being replayed against a different endpoint or method; the short `exp` and `jti` bound replay within the same endpoint. Because `htu` excludes the query string, one assertion covers all query-string variants of the path (e.g., pagination) within its validity window — this is intentional.

This assertion format is modeled on OAuth 2.0 DPoP (RFC 9449): `htm`, `htu`, `jti`, and `iat` carry DPoP's semantics. It differs in binding the key via `kid` plus JWKS discovery rather than an embedded `jwk`, because Open Feed identities already publish their keys (section 3) and the verifier must tie the key to the `iss` identity anyway.

#### 8.2.3. Verification

To verify a fetch assertion, the serving hub MUST:

1. Parse the JWT; confirm `alg` is `EdDSA` and `typ` is `openfeed-fetch+jwt`
2. Confirm `htm` matches the request method and `htu` matches the requested URL after the same resource-URL normalization (section 8.2.2)
3. Confirm `iat` ≤ now < `exp`, allowing at most 60 seconds of clock skew on each bound (in particular, accept `iat` up to 60 seconds in the future), and `exp - iat` ≤ 300 seconds
4. Confirm `jti` has not been seen before within the token's validity window (replay cache)
5. Extract `kid`; confirm its JWKS URL is advertised by the `iss` identity's profile (key-ownership check, section 4.6)
6. Fetch the `iss` JWKS, find the key, verify the JWT signature; reject revoked keys (section 4.5)
7. Confirm `iss` appears on this feed's authorized-reader list

If all checks pass, serve the restricted resource. On failure return `401` (bad/absent/expired assertion) or `403` (valid assertion, but `iss` is not authorized).

The `WWW-Authenticate: OpenFeed-Sig` challenge MAY carry `error` and `error_description` parameters in the style of RFC 6750 (e.g., `WWW-Authenticate: OpenFeed-Sig error="expired_assertion"`). No other challenge parameters are defined.

The same SSRF, timeout, size, and fetch-amplification protections as inbox verification apply (section 10.5, 10.11) — the `iss`/`kid` are attacker-controlled until step 6 succeeds, so cheap checks (steps 1–4) run before any outbound fetch.

#### 8.2.4. Discovery

A hub MAY advertise that a feed has a restricted variant; the simplest conformant behavior is to serve `401 … WWW-Authenticate: OpenFeed-Sig` on the restricted URL and let authorized readers retry with an assertion. Readers learn restricted-feed URLs out-of-band or from an authenticated profile variant; specifying a discovery document is deferred.

## 9. Conformance

Open Feed defines three conformance levels to support incremental adoption and varied deployment scenarios.

### 9.1. Conformance Levels

#### 9.1.1. Level 1: Read (Feed Consumer)

A Level 1 implementation MUST:

- Fetch and parse JSON Feed 1.1 documents
- Discover JWKS via profile document `rel="jwks"` link
- Verify Ed25519 signatures per section 4.5
- Check key revocation status via `revoked_at` field
- Handle unknown fields and interaction types gracefully

A Level 1 implementation SHOULD:

- Display content warnings (`_content_warning` or profile-level) before revealing content
- Cache JWKS documents (RECOMMENDED: 1 hour or until signature verification fails)
- Follow `next_url` for paginated feeds
- Support WebFinger for `@user@domain` identifier resolution
- Pin and enforce the Key History Chain when an identity publishes one (section 3.7.3), to detect key rollback and equivocation

Level 1 allows reading and verifying Open Feed content without publishing or interacting. This level requires no server infrastructure.

#### 9.1.2. Level 2: Publish (Feed Producer)

A Level 2 implementation MUST meet all Level 1 requirements and:

- Serve a profile document (HTML) at the identity URL
- Include `rel="jwks"` link in profile document
- Serve valid JWKS document per section 3
- Serve valid JSON Feed 1.1 with signed items per section 5
- Generate valid signatures per section 4
- Generate globally unique item IDs
- Canonicalize JSON per section 4.3 (byte-exact RFC 8785; emit NFC strings)

A Level 2 implementation SHOULD:

- Include `_version` field starting at 1 for new items
- Provide `rel="profile"` with structured metadata
- Provide `rel="feed"` link in profile document
- Support WebFinger discovery per Appendix D

Level 2 can be fully static-hosted (e.g., GitHub Pages, Netlify, S3). No server-side processing is required. Interactions are not received at this level.

#### 9.1.3. Level 3: Interact (Full Hub)

A Level 3 implementation MUST meet all Level 2 requirements and:

- Accept interactions via inbox endpoint (section 7.1)
- Verify incoming interaction signatures per section 7.1.3
- Apply replay prevention rules per section 6.3
- Support CORS on inbox endpoint per section 7.1.2
- Return appropriate HTTP status codes per section 7.1.4

A Level 3 implementation SHOULD:

- Implement OAuth 2.0 for authenticated operations
- Support authenticated GET on inbox per section 7.1.5
- Support Webmention endpoint per section 7.2
- Support WebSub for real-time feed updates per Appendix E
- Provide `rel="replies"` endpoint per section 7.4
- Provide `rel="outbox"` endpoint per section 7.5

Level 3 requires server-side processing for the inbox endpoint. This is the full hub experience.

### 9.2. Feature Support Matrix

| Feature | Level 1 | Level 2 | Level 3 |
|---------|---------|---------|---------|
| Read feeds | ✓ | ✓ | ✓ |
| Verify signatures | ✓ | ✓ | ✓ |
| Publish signed content | | ✓ | ✓ |
| Static hosting compatible | ✓ | ✓ | |
| Receive interactions | | | ✓ |
| Send interactions | | ✓ | ✓ |
| OAuth authentication | | | ✓ |

Sending interactions requires signing them, which requires a published identity, profile, and JWKS — i.e., Level 2 infrastructure. A pure Level 1 reader can read and verify but cannot produce signatures others can verify.

### 9.3. Hub Conformance (Level 3)

In addition to Level 3 requirements, a conforming multi-user hub SHOULD:

- Isolate user data appropriately
- Implement rate limiting per section 7.3
- Provide user-facing key management
- Support key rotation per section 3.4
- Support recovery keys per section 3.6
- Publish a Key History Chain per section 3.7
- Support Authorized Fetch (section 8.2) if it serves restricted-visibility feeds

### 9.4. Transient Failure Handling

When signature verification fails due to inability to fetch the author's JWKS:

1. Implementations SHOULD cache the failure and retry
2. Retry schedule: 1 hour, 4 hours, 24 hours
3. After 3 failed attempts, the interaction MAY be permanently rejected
4. Implementations SHOULD NOT reject interactions permanently on first transient failure

For inbox delivery failures, see section 7.3 (Rate Limiting) for retry guidance.

### 9.5. Content-Type Handling

When fetching JWKS or Feed documents:

- Implementations MUST send appropriate `Accept` headers (`application/jwk-set+json` or `application/feed+json`)
- Implementations MUST reject responses whose Content-Type is `text/html` (or any non-JSON type), and MUST reject a response that does not parse as JSON
- Implementations MUST accept the type-specific Content-Type (`application/jwk-set+json`, `application/feed+json`)
- Implementations MUST accept `application/json` (optionally logging a warning)

The purpose of this check is to avoid parsing an HTML error page (`<html>404 Not Found</html>`) as JSON — that is the actual attack surface. It is **not** to require an exact vendor Content-Type: most static hosts (GitHub Pages, S3, Netlify) serve `.json` files as `application/json`, and Level 1/2 conformance depends on those hosts working. Rejecting `application/json` would make the static-hosting story in section 9.1.2 unattainable, so implementations MUST accept it.

## 10. Security Considerations

### 10.1. Signature Limitations

Signatures prove that content was signed by whoever controls a private key. They do not prove:

- When the content was actually created (timestamps are self-reported)
- That the identity belongs to a particular person
- That the content is true

### 10.2. Hub Trust

Hub operators who store private keys can:

- Sign content as any user they host
- Modify feed content
- Read private keys

This trust model is similar to email providers. Users requiring higher security SHOULD use client-side key generation.

### 10.3. TLS Requirements

All URLs in this specification MUST use HTTPS.

Implementations MUST validate TLS certificates.

Implementations SHOULD reject connections with invalid or expired certificates.

### 10.4. Key Storage

Private keys SHOULD be stored encrypted at rest.

Implementations MAY use hardware-backed key storage (WebAuthn/FIDO2) for enhanced security.

### 10.5. Server-Side Request Forgery (SSRF)

When fetching author profiles, JWKS documents, feed URLs, or source URLs for Webmention:

Implementations MUST:

- Validate URLs use the HTTPS scheme
- Follow redirect limits (max 5 per section 2.3)
- Apply connection timeout limits (RECOMMENDED: 10 seconds)
- Apply response size limits (RECOMMENDED: 1MB for profiles/JWKS, 10MB for feeds)

Implementations SHOULD:

- Reject URLs resolving to private IP addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Reject URLs resolving to loopback addresses (127.0.0.0/8, ::1)
- Reject URLs resolving to link-local addresses (169.254.0.0/16, fe80::/10)
- Validate DNS responses before connecting
- Use a dedicated HTTP client with restrictive defaults

### 10.6. Resource Exhaustion

Malicious actors may attempt to exhaust server resources. Implementations SHOULD enforce limits:

| Resource | Recommended Limit |
|----------|-------------------|
| Keys in JWKS document | 100 |
| JWKS chain history versions walked per update | 100 |
| Items in feed (single page) | 1000 |
| Interaction body size | 100KB |
| Attachment metadata per item | 1MB |
| Total feed document size | 10MB |
| Concurrent fetches per origin | 10 |

Implementations SHOULD return appropriate error responses (413, 429) when limits are exceeded.

### 10.7. Enumeration Attacks

WebFinger endpoints and inbox endpoints may be probed to enumerate users or content.

Implementations SHOULD:

- Rate limit WebFinger requests by source IP
- Return consistent response timing regardless of whether a user exists
- Consider requiring authentication for enumeration-sensitive queries
- Log and monitor for enumeration patterns

Implementations MUST NOT include detailed error messages that reveal internal state.

### 10.8. Signature Stripping

Content may be re-served without signatures by malicious intermediaries.

Consumers MUST:

- Not trust content claimed to be from an identity without a valid `_sig`
- Display unsigned content distinctly from verified content
- Not cache unsigned content as if it were verified

Producers SHOULD:

- Include signatures on all content, including cached/proxied content
- Re-validate signatures when re-serving content from cache

### 10.9. Replay and Timing Attacks

The replay prevention window (section 6.3) mitigates but does not eliminate timing attacks.

Implementations SHOULD:

- Use constant-time comparison for signature verification
- Synchronize clocks via NTP
- Log timestamp anomalies for security monitoring

Implementations MUST NOT use system time as the sole source of truth for ordering.

### 10.10. Identity Portability Limitations

URL-based identity depends on domain availability. If domain access is lost:

- With recovery keys (section 3.6): Identity can be reclaimed
- Without recovery keys: Identity is orphaned
- If domain is hijacked: Attacker can potentially claim false succession

Users requiring stronger guarantees SHOULD:

- Maintain recovery keys stored securely offline (not on hub)
- Use domains they control directly (not subdomains of platforms)
- Publish recovery attestations before they are needed

The trust model is similar to email: losing access to your email provider means losing that email address. For family hubs where the administrator is trusted, this is acceptable. For other deployments, consider additional safeguards.

### 10.11. Inbox Fetch Amplification

Inbox verification (section 7.1.3) makes outbound HTTP fetches (profile, JWKS) driven by the sender-supplied `author` URL, which is unauthenticated until verification succeeds. Without care, an attacker can POST a stream of interactions bearing forged `author` URLs pointing at a victim domain, turning the inbox into a request-amplification proxy against that victim.

Implementations MUST:

- Apply per-source-IP rate limiting **before** any outbound fetch (do not rate-limit solely by the unverified `author`).
- Perform cheap, local checks (parse, required fields, timestamp bounds) before fetching.
- Only fetch the JWKS URL advertised by the claimed author's own profile (section 7.1.3 step 7); never fetch an arbitrary JWKS URL taken directly from the `kid`.

Implementations SHOULD:

- Negatively cache failed profile/JWKS fetches so repeated forged authors do not each trigger a fetch.
- Apply the SSRF protections of section 10.5 to every such fetch.

### 10.12. Key Revocation and Self-Reported Timestamps

Key revocation (section 3.5) checks the signing key's `revoked_at` against the content's self-reported effective signing time (section 4.5). Because that timestamp is attacker-controllable once a key is stolen (section 10.1), a thief can backdate forged content to before `revoked_at` and have it accepted. Revocation therefore limits ongoing damage from an *honestly* rotated key far more than it stops an active thief.

To reduce this exposure, implementations SHOULD:

- For **interactions**, use the inbox **receipt time** as the effective time for the revocation check, not the sender's `published` value (the receipt time is a trustworthy lower bound the attacker cannot backdate).
- Treat feed-item timestamps as claims, and prefer independent evidence of time (receipt logs, WebSub delivery time, or a trusted timestamp) when the ordering matters for security decisions.

A hash-chained JWKS or transparency log (see the project's open questions) would let any consumer with one honest prior observation detect backdating and rollback; this is deferred.

---

## Appendix A: Media Types

| Document | Media Type |
|----------|------------|
| Profile | `text/html` |
| JWKS | `application/jwk-set+json` |
| Feed | `application/feed+json` |
| Profile metadata | `application/json` |
| Interaction (POST body) | `application/json` |
| WebFinger | `application/jrd+json` |

## Appendix B: Link Relations

| Relation | Specification |
|----------|---------------|
| `jwks` | This specification (JWKS document) |
| `pubkey` | This specification (alias for `jwks`, deprecated) |
| `feed` | JSON Feed 1.1 |
| `inbox` | This specification (interaction receiving) |
| `outbox` | This specification (interaction sending history) |
| `replies` | This specification (thread discovery) |
| `recovery` | This specification (recovery attestation) |
| `webmention` | W3C Webmention |
| `profile` | This specification |
| `authorization_endpoint` | IndieAuth / OAuth 2.0 |
| `token_endpoint` | IndieAuth / OAuth 2.0 |
| `following` | Convention (non-normative) |
| `successor` | This specification (identity migration) |
| `canonical` | RFC 6596 (preferred URL) |

**Note:** The relation values defined by this specification (`jwks`, `pubkey`, `inbox`, `outbox`, `replies`, `recovery`, `profile`, `successor`) are not registered in the IANA Link Relations registry. Registration (or migration to URL-form extension relations) is planned before 1.0; collisions with future registered relations are a known pre-1.0 risk.

## Appendix C: References

- RFC 2119: Key words for use in RFCs
- RFC 6596: The Canonical Link Relation
- RFC 7033: WebFinger
- RFC 7493: The I-JSON Message Format
- RFC 7515: JSON Web Signature (JWS)
- RFC 7517: JSON Web Key (JWK)
- RFC 7519: JSON Web Token (JWT)
- RFC 7797: JWS Unencoded Payload Option (`b64`)
- RFC 8032: Edwards-Curve Digital Signature Algorithm (EdDSA) — Ed25519 test vectors
- RFC 8785: JSON Canonicalization Scheme
- RFC 9449: OAuth 2.0 Demonstrating Proof of Possession (DPoP)
- JSON Feed 1.1: https://jsonfeed.org/version/1.1
- IndieAuth: https://indieauth.spec.indieweb.org/
- Webmention: https://www.w3.org/TR/webmention/
- WebSub: https://www.w3.org/TR/websub/

## Appendix D: WebFinger Discovery

WebFinger (RFC 7033) provides an optional discovery mechanism for `@user@domain` style identifiers.

### D.1. WebFinger Request

```
GET /.well-known/webfinger?resource=acct:alice@example.com HTTP/1.1
Host: example.com
Accept: application/jrd+json
```

### D.2. WebFinger Response

```json
{
  "subject": "acct:alice@example.com",
  "aliases": [
    "https://example.com/~alice/"
  ],
  "links": [
    {
      "rel": "self",
      "type": "text/html",
      "href": "https://example.com/~alice/"
    },
    {
      "rel": "jwks",
      "type": "application/jwk-set+json",
      "href": "https://example.com/~alice/keys.json"
    },
    {
      "rel": "feed",
      "type": "application/feed+json",
      "href": "https://example.com/~alice/feed.json"
    },
    {
      "rel": "inbox",
      "href": "https://example.com/~alice/inbox"
    },
    {
      "rel": "webmention",
      "href": "https://example.com/~alice/webmention"
    }
  ]
}
```

### D.3. Resource Identifier

The `resource` parameter uses the `acct:` URI scheme:

```
acct:{user}@{domain}
```

Hubs SHOULD support WebFinger queries for all hosted identities.

### D.4. Mapping to Identity URL

The canonical identity URL is found in:

1. The `aliases` array (HTTPS URL)
2. The `href` of the link with `rel="self"` and `type="text/html"`

Clients resolving `@user@domain` MUST fetch the identity URL and use the profile document as the authoritative source for endpoint discovery.

## Appendix E: WebSub Real-Time Updates

WebSub (W3C Recommendation) provides real-time push notifications for feed updates. This appendix defines OPTIONAL WebSub integration for Open Feed.

### E.1. Hub Discovery

Feed documents MAY advertise a WebSub hub:

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Alice's Feed",
  "feed_url": "https://example.com/~alice/feed.json",
  "hubs": [
    {
      "type": "WebSub",
      "url": "https://example.com/websub"
    }
  ],
  "items": [...]
}
```

Alternatively, the HTTP response MAY include Link headers:

```
Link: <https://example.com/websub>; rel="hub"
Link: <https://example.com/~alice/feed.json>; rel="self"
```

### E.2. Subscription

Subscribers follow the standard WebSub flow:

1. Discover hub URL from feed
2. POST subscription request to hub:
   ```
   POST /websub HTTP/1.1
   Host: example.com
   Content-Type: application/x-www-form-urlencoded

   hub.mode=subscribe
   &hub.topic=https://example.com/~alice/feed.json
   &hub.callback=https://subscriber.example/callback
   ```
3. Hub verifies intent (GET to callback with challenge)
4. Hub confirms subscription

### E.3. Content Distribution

When new content is published:

1. Publisher notifies hub (or hub detects change)
2. Hub POSTs to all subscriber callbacks:
   ```
   POST /callback HTTP/1.1
   Host: subscriber.example
   Content-Type: application/feed+json
   Link: <https://example.com/~alice/feed.json>; rel="self"
   Link: <https://example.com/websub>; rel="hub"

   {
     "version": "https://jsonfeed.org/version/1.1",
     ...full or partial feed...
   }
   ```

### E.4. Signature Verification

Subscribers MUST still verify item signatures per Section 4.5, even for content received via WebSub push. The WebSub hub is not trusted to verify signatures.

### E.5. Fat Pings vs Light Pings

Hubs MAY send:

- **Fat pings**: Full feed content in POST body (shown above)
- **Light pings**: Empty or minimal body; subscriber fetches feed

Fat pings are RECOMMENDED for efficiency. Subscribers MUST support both.

### E.6. Inbox Notifications

WebSub is designed for feed updates, not inbox notifications. For real-time inbox updates, implementations MAY:

1. Expose inbox as a subscribable feed (interactions as items)
2. Use Server-Sent Events (SSE) on an authenticated endpoint
3. Use WebSocket connections

These mechanisms are implementation-specific and not standardized by this specification.

### E.7. Security Considerations

- Callback URLs MUST use HTTPS
- Hubs SHOULD implement the WebSub `hub.secret` mechanism for authenticated content distribution
- Subscribers SHOULD verify the `Link: rel="self"` header matches the subscribed topic
- Subscribers MUST NOT trust content without verifying Open Feed signatures

## Appendix F: Test Vectors

This appendix provides test vectors for verifying implementations of canonicalization and signature verification.

### F.1. Test Keypair

The following Ed25519 keypair is for testing only. **DO NOT USE IN PRODUCTION.** It is RFC 8032 test vector 1.

```json
{
  "kid": "test-key-1",
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
  "d": "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A"
}
```

Key details:
- Public key (`x`): `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a` (hex)
- Private key seed (`d`): `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60` (hex)

The full `kid` for JWS headers, assuming the JWKS is served at `https://test.example/keys.json`, is `https://test.example/keys.json#test-key-1`.

### F.2. Canonicalization Test Vector

Input JSON (with whitespace for readability). Note the required author binding (`authors`) and feed binding (`_feed_url`) per section 4.6:

```json
{
  "id": "urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "authors": [ { "url": "https://test.example/" } ],
  "_feed_url": "https://test.example/feed.json",
  "content_text": "Hello, wörld! 👋",
  "date_published": "2025-01-15T12:00:00Z",
  "_version": 1,
  "attachments": [
    {
      "url": "https://example.com/photo.jpg",
      "mime_type": "image/jpeg"
    }
  ]
}
```

After RFC 8785 canonicalization (no whitespace, keys sorted; string values are already NFC as published):

```
{"_feed_url":"https://test.example/feed.json","_version":1,"attachments":[{"mime_type":"image/jpeg","url":"https://example.com/photo.jpg"}],"authors":[{"url":"https://test.example/"}],"content_text":"Hello, wörld! 👋","date_published":"2025-01-15T12:00:00Z","id":"urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6"}
```

Canonical UTF-8 bytes (hex) — the `ö` is NFC codepoint U+00F6 (`c3 b6`) and the wave emoji is U+1F44B (`f0 9f 91 8b`):

```
7b225f666565645f75726c223a2268747470733a2f2f746573742e6578616d706c652f666565642e6a736f6e222c225f76657273696f6e223a312c226174746163686d656e7473223a5b7b226d696d655f74797065223a22696d6167652f6a706567222c2275726c223a2268747470733a2f2f6578616d706c652e636f6d2f70686f746f2e6a7067227d5d2c22617574686f7273223a5b7b2275726c223a2268747470733a2f2f746573742e6578616d706c652f227d5d2c22636f6e74656e745f74657874223a2248656c6c6f2c2077c3b6726c642120f09f918b222c22646174655f7075626c6973686564223a22323032352d30312d31355431323a30303a30305a222c226964223a2275726e3a757569643a66383164346661652d376465632d313164302d613736352d303061306339316536626636227d
```

SHA-256 hash of the canonical UTF-8 bytes (hex):

```
0439a53bd612316fdcbed8c49ddde784a49e005658970fc3cd9faf752f18bcdf
```

### F.3. Signature Test Vector

Using the test keypair from F.1 and canonical bytes from F.2.

JWS protected header:

```json
{"alg":"EdDSA","b64":false,"crit":["b64"],"kid":"https://test.example/keys.json#test-key-1"}
```

JWS header (base64url):

```
eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2tleXMuanNvbiN0ZXN0LWtleS0xIn0
```

The JWS Signing Input (RFC 7797, unencoded payload) is the ASCII of the header-b64 followed by `.` followed by the raw canonical bytes from F.2:

```
ASCII("eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2tleXMuanNvbiN0ZXN0LWtleS0xIn0.") || <canonical-json-bytes>
```

Signature (base64url):

```
NaLhABk56k12vyKlkxSZWE8i5Vls_fXsUWYKYQ0cdD3lvXYOaJgJ0-CkG9XTzwyNqPkHbGycwcYSQdiC_qKeBw
```

Complete `_sig` value (detached, unencoded payload):

```
eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2tleXMuanNvbiN0ZXN0LWtleS0xIn0..NaLhABk56k12vyKlkxSZWE8i5Vls_fXsUWYKYQ0cdD3lvXYOaJgJ0-CkG9XTzwyNqPkHbGycwcYSQdiC_qKeBw
```

### F.4. Complete Signed Item

```json
{
  "id": "urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "authors": [ { "url": "https://test.example/" } ],
  "_feed_url": "https://test.example/feed.json",
  "content_text": "Hello, wörld! 👋",
  "date_published": "2025-01-15T12:00:00Z",
  "_version": 1,
  "attachments": [
    {
      "url": "https://example.com/photo.jpg",
      "mime_type": "image/jpeg"
    }
  ],
  "_sig": "eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2tleXMuanNvbiN0ZXN0LWtleS0xIn0..NaLhABk56k12vyKlkxSZWE8i5Vls_fXsUWYKYQ0cdD3lvXYOaJgJ0-CkG9XTzwyNqPkHbGycwcYSQdiC_qKeBw"
}
```

### F.5. Verification Steps

To verify the test vector:

1. Parse the JSON and extract `_sig`
2. Remove `_sig` from the object
3. Serialize per RFC 8785 (sorted keys, no whitespace; string bytes verbatim) → canonical bytes
4. Decode the JWS header (first segment before the first `.`); confirm `alg=EdDSA`, `b64=false`, `crit=["b64"]`
5. Extract `kid` → JWKS URL (`https://test.example/keys.json`) and key ID (`test-key-1`)
6. Confirm the claimed author (`authors[].url` = `https://test.example/`) advertises that JWKS URL in its profile (section 4.6); in this offline vector, assume it does
7. Fetch JWKS and find the matching key
8. Reconstruct the Signing Input: `ASCII(header-b64 || '.') || canonical-bytes`
9. Verify the Ed25519 signature over the Signing Input

### F.6. Number Canonicalization

RFC 8785 requires specific number formatting:

| Input | Canonical Output |
|-------|------------------|
| `1.0` | `1` |
| `-0` | `0` |
| `1.5` | `1.5` |
| `1e10` | `10000000000` |
| `1.23e-5` | `0.0000123` |
| `1.7976931348623157e+308` | `1.7976931348623157e+308` |

Implementations MUST use ES6 `Number.prototype.toString()` semantics for number serialization.

### F.7. Unicode Sorting

Object keys are sorted by UTF-16 code unit values, not Unicode codepoints:

```json
{"a":1,"aa":2,"b":3,"é":4}
```

Keys containing characters outside the BMP (emoji, etc.) are sorted by their UTF-16 surrogate pairs.

### F.8. Key History Chain Test Vector

A fully-reproducible two-version chain (section 3.7), signed with the Appendix F.1 test key at JWKS URL `https://test.example/keys.json`, key id `key-1`. (For brevity the genesis has a single key; a real chain would also carry recovery keys.)

**Genesis (`_seq: 1`)** — canonical form (this exact byte string is what `_prev` hashes):

```
{"_seq":1,"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2tleXMuanNvbiNrZXktMSJ9..DLcqU3UkibsZJ9Rjw2hV1NlS1nMnW9hxFLTj2Fwau38N4JPUgdHk6pgJlOMY-_yqzT8ftDs6JBFvS7IX15tmCg","_updated":1736899200,"keys":[{"crv":"Ed25519","iat":1736899200,"kid":"key-1","kty":"OKP","x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}]}
```

Its `_sig` is a detached JWS by `key-1` over the canonical document with `_sig` removed.

Base64url SHA-256 of the canonical genesis bytes above (this is `_seq:2`'s `_prev`):

```
wmHz_OurgNfoKYRC84u7fZEFULOjzopSvehSa_MDEf8
```

**Version 2 (`_seq: 2`)** — revokes `key-1`, adds `key-2`, chains to the genesis. `key-2`'s public key is RFC 8032 test vector 2 (`x` hex: `3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c`) — a distinct key, so implementations that confuse which key verifies which version fail this vector:

```
{"_prev":"wmHz_OurgNfoKYRC84u7fZEFULOjzopSvehSa_MDEf8","_seq":2,"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2tleXMuanNvbiNrZXktMSJ9..wcAEf_4H97HC7NDl9j9QiuS9DoieiwfsJdSiYigyTUvy8r_4T2oEb5uBnIn7mTkh78XP0s16pBntgJyJqvPPAw","_updated":1739577600,"keys":[{"crv":"Ed25519","iat":1736899200,"kid":"key-1","kty":"OKP","revoked_at":1739577600,"x":"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"},{"crv":"Ed25519","iat":1739577600,"kid":"key-2","kty":"OKP","x":"PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw"}]}
```

To validate a chain implementation: recompute the SHA-256 of the genesis canonical bytes, confirm it equals `_seq:2`'s `_prev`, and verify each `_sig` per section 4.5. (Both versions are signed by `key-1`, per the continuity rule of section 3.7.2: `_seq:2` MUST be signed by a key that was valid in `_seq:1` — even though `_seq:2` revokes that key. Note that `key-1` remains listed in `_seq:2`, as section 3.7.2 requires.)
