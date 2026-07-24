# Open Feed — Follows and Pins (Conventions Extension)

**Extension version 0.1.0 — Draft.** Targets the Open Feed core specification **v0.1.0** (`open-feed-spec.md`) and the restricted-feeds extension **v0.1.0** (`open-feed-restricted-feeds.md`). This is an OPTIONAL extension; it is not part of the core and MUST NOT be required for core conformance. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive. RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

## Abstract

Two optional documents, both referenced from the identity document (core §3.2, `follows` / `pins`):

- **`follows`** — who an identity reads. Turns "which feeds does my hub poll?" from private configuration into published protocol.
- **`pins`** — an identity's `(url, seq, hash)` observations of chained documents (identity documents and manifests, core §5, §9). Publishing them, **signed**, gives a family-scale social graph four properties with no new cryptography: cross-observer **anti-equivocation**, **recovery propagation**, informal **timestamping**, and **first-contact corroboration**. A pins document an identity publishes about **its own** restricted chain is a **self-commitment** (§5) — the mechanism that restores cross-reader equivocation detection to restricted feeds (restricted-feeds §8.2).

This document supersedes and expands the sketch in core Appendix G, which now points here.

## 1. Relationship to the Core

This extension introduces **no new signing construction.** A published follows or pins document is an ordinary Open Feed signed document — the **core detached-JWS construction (core §6), reused unchanged.** Everything it commits to (identity documents, manifests) is committed by the core's existing chains; pins are *observations of* those chains, not a new chain type. A pins document MAY itself be chained (§3.3) using the identical §9 manifest mechanics.

Follows and pins are, for the purpose of **verifying content**, outside the trust core: a consumer never needs anyone's follows or pins to verify an item, a manifest, or an identity document. What signing adds is that a *peer* can trust the document genuinely came from its author (§2) — which is what makes the four gossip properties (§4) and the self-commitment mechanism (§5) sound. An unsigned, client-local pins store is still useful to its owner as private enforcement memory (core §5.3); it simply cannot be gossiped.

## 2. Scope, Trust, and Privacy (read this first)

- **Publishing is opt-in; both documents MAY be kept client-local.** A hub that polls feeds and pins what it sees needs no published document at all — the enforcement value (core §5.3, §9.1) is entirely local. Publishing trades privacy for the network properties below.
- **Follows publish who you read.** A `follows` document names, in cleartext, the identities you subscribe to — your reading graph. This is often sensitive; core Appendix G already flags social-graph documents as keepable client-local, and this extension inherits that caution.
- **Pins publish who you read *and when*.** Each pin's `observed` time (§3.2) reveals when you last polled a given identity — your online times and reading cadence. A pins document is a strictly richer social-graph disclosure than a follows document.
- **Self-commitments publish that a restricted feed exists and how often you post to it** (§5), but never its **content** (a pin carries only a hash). This is the same disclosure class as a published grant-revocation list (restricted-feeds §6.2.2) and is **incompatible with existence-private restricted feeds** (§5.3).
- **Signing does not make a pin true.** A signed pin proves its author *asserts* it observed `(url, seq, hash)` at `observed` — not that the observation is honest. A lying witness can assert a hash it never saw. The gossip properties (§4) are therefore evidential, not proofs: they gain strength from *multiple independent* witnesses, and a single witness is only as trustworthy as its author.

## 3. The `pins` Document

An identity MAY publish a pins document and reference it from its identity document via the `pins` field (core §3.2). It records versions of chained documents the publisher has observed.

```json
{
  "url": "https://reader.example/",
  "pins": [
    { "url": "https://test.example/openfeed.json", "seq": 1, "hash": "f7lGHylIOM-swVa0Fg8DlFCJ5k-fPCgucLPmXhGQ9ns", "observed": 1739577600 },
    { "url": "https://test.example/manifest.json",  "seq": 1, "hash": "GPbjqBsIVHRzgMlbfqXu5IU29SqEhMQnAlukdt8j7DY", "observed": 1739577600 }
  ],
  "updated": 1739577600,
  "_sig": "..."
}
```

### 3.1. Document Fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The publisher's identity URL. Author binding (core §6.6): the `_sig` `kid`'s identity MUST equal this. |
| `pins` | MUST | Array of pin entries (§3.2). MAY be empty. |
| `updated` | MUST | Publication time (Unix seconds). |
| `_sig` | SHOULD (MUST if published; MUST for self-commitments, §5) | Detached JWS by a key valid in the publisher's identity chain (core §6). |
| `seq`, `prev`, `history` | MAY | Present iff the pins document is itself chained (§3.3). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise. Timestamps in this document use **Unix seconds** throughout (the pinned data is chain-adjacent, and `observed` is compared against key `iat` / `revoked_at`, core §4).

### 3.2. Pin Entry

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The **chained document** observed: an identity document (`{identity_url}openfeed.json`) or any manifest (`.../manifest.json`, core §9). The URL disambiguates all of an identity's chains uniformly — one identity-document chain, one manifest chain per feed (core §3.2 `feeds`), including restricted ones. |
| `seq` | MUST | The observed version counter of that chain. |
| `hash` | MUST | Base64url SHA-256 of the observed version's **full published canonical bytes** (including its `_sig`) — the same value that version's successor hashes in `prev` (core §5.1, §9). |
| `observed` | SHOULD | Wall-clock time (Unix seconds) the publisher **first** observed this `(url, seq, hash)`. The witnessed lower bound that enables informal timestamping (§4.3). |

A pin names one version. To attest a chain's progression, publish multiple pins (successive `seq`) or re-publish the pins document over time.

### 3.3. Chained Pins Documents (OPTIONAL)

A pins document MAY carry `seq`, `prev`, and `history`, in which case it is a chain with the **identical mechanics of core §9** (monotonic `seq`, `prev` = base64url SHA-256 of the prior version's full bytes, retained history, pin-and-walk enforcement per core §9.1). Chaining makes a *consumer* of the pins able to detect rollback of the pins themselves — a host cannot silently drop a past pin.

Chaining is OPTIONAL for casual follows/pins (an unchained document is a signed "latest snapshot," sufficient for the compare rule of §4.1). It is **RECOMMENDED for any pins document carrying self-commitments** (§5), because the security of the commitment mechanism depends on a host being unable to serve a reader an older commitment set that omits a version (§5.2).

## 4. Consuming Pins

A consumer that fetches peers' signed pins documents gains four properties. This section specifies the observable behaviors; it does **not** define a gossip/aggregation transport (peer discovery, flooding, anti-spam) — that is the deferred witness-network work (core §14.10, Appendix H). Follows lists are the natural peer set: the identities you follow are the pins you fetch.

### 4.1. Anti-Equivocation (the compare rule)

Given any two pins `P` and `Q` (from any sources, including one's own store) with `P.url == Q.url` and `P.seq == Q.seq`:

- `P.hash == Q.hash` → **corroboration.** The two observers agree on that chain's version.
- `P.hash != Q.hash` → **equivocation.** The identity that owns `P.url` served divergent versions at one `seq`. Consumers MUST treat this exactly as the local equivocation case (core §5.3 for identity documents, §9.1 for manifests): the chain is compromised or the host is dishonest; flag it.

This turns core §5.3's / §9.1's "two observers reconstruct the document at a shared `seq` and compare hashes" from a manual, out-of-band step into published, automatable data — the certificate-transparency bargain (core §14.2) made concrete for a family. An **aggregator** is simply a consumer that fetches many pins documents and runs this comparison pairwise; it needs no special authority, because every input is independently signed.

### 4.2. Recovery Propagation

A recovery-based migration (core §3.4) cannot publish a `successor` from the lost domain, so consumers who lost the old pointer may never learn of it. A trusted peer's pin naming a `seq` for the old identity **beyond** the consumer's own pin is the signal to re-walk: the consumer fetches that identity's history, walks to the peer's `(seq, hash)` (confirming it reached the same version the peer witnessed), and discovers the `predecessor`/recovery co-signature there (core §3.4, §5.5). The pin is the pointer that says "look again"; verification remains the consumer's own.

### 4.3. Informal Timestamping

A signed pin with `observed = T`, from an author the consumer trusts, is a **witnessed assertion** that `(url, seq, hash)` existed by time `T`. Independent witnesses converging on a `(seq, hash)` at or before `T` establish a family-scale lower bound on when that version existed — the external time anchor core §4.4 and §14.10 defer to conventions. It is evidential, not a proof (§2): a colluding witness can backdate `observed`, so a single witness is only as trustworthy as its author, and strength comes from independence.

### 4.4. First-Contact Corroboration

First contact with any identity is TOFU (core §5.3): the consumer accepts and pins whatever it is first served, with no way to know it is the honest version. Consistent signed pins of the same `(seq, hash)` from identities the consumer **already** trusts soften this — an informal web of trust over first contact. It never replaces verification of the chain from that pin forward; it only raises confidence that the pinned starting point is the real one.

## 5. Self-Commitments (Restricted-Feed Transparency)

A pin whose `url` names a chain the pins document's **author owns** is a **self-commitment**: not a witness observation of someone else, but the owner publicly attesting the `(seq, hash)` of its own chain. Applied to a **restricted** manifest (restricted-feeds §7), this is the mechanism that restores the cross-reader equivocation detection that restricted-feeds §8.2 otherwise loses.

```json
{
  "url": "https://test.example/",
  "pins": [
    { "url": "https://test.example/family/manifest.json", "seq": 1, "hash": "q1mbSP0wZm9IEkQwh5Y98iR8e5tzxgiaJ7n1HOXXvuQ", "observed": 1739577600 }
  ],
  "updated": 1739577600,
  "_sig": "..."
}
```

Here `url` (the owner) owns the identity that publishes `family/manifest.json` (a restricted feed). The pins document is **public** (world-readable, `Access-Control-Allow-Origin: *`, core §3.3) and **signed**, so it is a public commitment to a version of an otherwise-gated chain.

### 5.1. Why This Closes the §8.2 Gap

Restricted-feeds §8.2 observes that a host can serve reader A a manifest at `seq: 10` with items `{X}` and reader B a *different* manifest at `seq: 10` with items `{Y}`, undetectably — because authorized readers cannot publicly gossip restricted pins without leaking the content itself. That equivocation requires the owner's signing key (only genuinely-signed versions exist at one `seq`; a host holding no key can do no worse than per-reader rollback, restricted-feeds §8.1–§8.2). So the residual threat is the key-custodian tier (core §14.2).

With self-commitments, a key-custodian host that wants A and B to see different `seq: 10` manifests must publish **two conflicting public commitments** for `(family/manifest.json, seq: 10)`. That forks the **public** pins chain — and a public fork is caught by exactly the cross-observer compare rule of §4.1 (any two readers, or any aggregator, comparing the owner's public commitments). Cross-reader equivocation on restricted content is thereby **reduced to public-feed equivocation**, which the core already makes detectable.

Reader-side check: a restricted-feed reader that fetches the owner's public pins document MUST, for a restricted manifest it was served at `(seq, hash_served)`, confirm the owner's public commitment for that `(url, seq)` has `hash == hash_served`. A mismatch MUST be treated as equivocation (§4.1). Absence of a commitment for a version the reader was served is tolerated as **commitment lag** (§5.2), not a violation.

### 5.2. Operational Requirements

- The owner SHOULD publish a fresh commitment **promptly** after advancing a restricted manifest. Until the commitment is published, a reader served the newer genuine version has nothing to compare and treats it as commitment lag (analogous to manifest lag, core §9.4) — it is not yet cross-checkable, but it is not rejected.
- A commitment-bearing pins document SHOULD be **chained** (§3.3) so a host cannot serve a reader an older commitment set that omits `seq: 10` (a rollback of the commitments themselves); the reader pins the commitment chain and walks it like any other (core §9.1).
- The owner's signing key SHOULD be kept off the serving host (client-side or delegated signing, core §14.2). A host that holds the owner's key can equivocate on the commitments *and* the manifest together; moving the signing boundary off the host is what makes the commitment a genuine external check rather than a second thing the same adversary controls.

### 5.3. What a Commitment Leaks, and the Existence-Private Tradeoff

A self-commitment names the restricted manifest's URL and a monotonic `seq` with an `observed` time. It therefore leaks:

- that the restricted feed **exists** (its manifest URL appears in a public document), and
- its **publish cadence and velocity** (one new commitment per version, timestamped).

It leaks **no content**: `hash` is a preimage-resistant SHA-256, and the item ids, versions, and timestamps inside the manifest cannot be recovered from it.

Consequently self-commitments are **incompatible with existence-private restricted feeds** (restricted-feeds §9): an owner who hides that the feed exists cannot publish commitments about it. This completes a coherent tradeoff triangle for restricted feeds:

> **Existence-public** restricted feeds MAY publish self-commitments (this section) and a grant-revocation list (restricted-feeds §6.2.2), gaining public equivocation-transparency and prompt public revocation — at the cost of disclosing the feed's existence and cadence. **Existence-private** restricted feeds forgo **both**, accepting the softer per-reader-only guarantees of restricted-feeds §8.1 in exchange for hiding that the audience exists at all.

## 6. The `follows` Document

An identity MAY publish a follows document and reference it from its identity document via the `follows` field (core §3.2).

```json
{
  "url": "https://reader.example/",
  "follows": ["https://test.example/", "https://gran.example/~gran/"],
  "updated": 1739577600,
  "_sig": "..."
}
```

- `url` MUST be the publisher's identity (author binding, core §6.6); `_sig` SHOULD be present when published.
- `follows` is an array whose entries are either an **identity URL string** or an **object** `{ "url": <identity URL>, ... }` carrying optional extension keys (e.g. a `name` petname, or a `feeds` array narrowing which of the followed identity's feeds are polled). Consumers MUST accept both forms and MUST preserve unknown keys.
- `updated` is Unix seconds.

The follows document doubles as the natural peer set for consuming pins (§4): the identities listed here are the ones whose pins a consumer fetches. It carries no authority over content and, like pins, MAY be kept client-local (§2).

## 7. Conformance

This extension defines no new conformance level; it refines core Level 1+ (core §13) and interoperates with the restricted-feeds extension.

- A consumer that publishes follows or pins MUST sign them with the core construction (core §6) and set `url` to its own identity (author binding).
- A consumer that **consumes** peers' pins MUST apply the §4.1 compare rule and treat a same-`(url, seq)`/different-`hash` divergence as equivocation (core §5.3, §9.1).
- A restricted-feed **owner** that opts into cross-reader transparency MUST publish self-commitments per §5 (signed; SHOULD be chained, §3.3, §5.2) and MUST NOT do so for an existence-private feed (§5.3).
- A restricted-feed **reader** that fetches the owner's commitments MUST apply the §5.1 reader-side check.
- Follows and pins remain OPTIONAL: a peer that publishes neither is fully conformant, and no consumer may require them of a peer.

## Appendix C: Test Vectors

All vectors are computed and self-verifying, regenerated by `tmp/regen.js` alongside the core Appendix D and restricted-feeds Appendix R vectors. Keys are the same deterministic, testing-only Ed25519 keys as core Appendix D and restricted-feeds Appendix R. **Not for any real identity.**

Identities: publisher/reader `https://reader.example/` (key `reader-key-1`, as in restricted-feeds R); feed owner `https://test.example/` (key `test-key-1`, as in core D.1). The pinned hashes are reproduced verbatim from other vectors: the identity-document hash from core D.4 (`seq: 1`), the public-manifest hash from core D.3 (`seq: 1`), and the restricted-manifest hash of restricted-feeds R.3.

### C.1. Pins Document — Observer (§3, §4)

The reader `https://reader.example/` witnesses the owner's public identity document (core D.4, `seq: 1`) and public manifest (core D.3, `seq: 1`). Full published canonical bytes, signed by `reader-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..LV8IsGFp-eRbnSXeKkS8Z0Q7QSPvTzM8_D_4ZWsJsLyNp5Aa7ZA-LXZAS4dy7wKodRJvdIHFr-SncfzJWHlFCw","pins":[{"hash":"f7lGHylIOM-swVa0Fg8DlFCJ5k-fPCgucLPmXhGQ9ns","observed":1739577600,"seq":1,"url":"https://test.example/openfeed.json"},{"hash":"GPbjqBsIVHRzgMlbfqXu5IU29SqEhMQnAlukdt8j7DY","observed":1739577600,"seq":1,"url":"https://test.example/manifest.json"}],"updated":1739577600,"url":"https://reader.example/"}
```

The two `hash` values equal, respectively, core D.4's identity-document `seq: 1` hash and core D.3's manifest `seq: 1` hash — so any consumer holding its own pin of either chain can run the §4.1 compare rule against this document.

### C.2. Self-Commitment — F1 (§5)

The owner `https://test.example/` publicly commits to `seq: 1` of its **restricted** manifest (restricted-feeds R.3). Full published canonical bytes, signed by `test-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..tV9XCqKlRPKMqOPZz0D_vQ2-AEBQeuTX7ArhOPRGd3nv9SqUfpO86Kp0_-vH_BktewIuFdXX_7yKXmeUfwL-Dw","pins":[{"hash":"q1mbSP0wZm9IEkQwh5Y98iR8e5tzxgiaJ7n1HOXXvuQ","observed":1739577600,"seq":1,"url":"https://test.example/family/manifest.json"}],"updated":1739577600,"url":"https://test.example/"}
```

The committed `hash` (`q1mbSP0wZm9IEkQwh5Y98iR8e5tzxgiaJ7n1HOXXvuQ`) is the base64url SHA-256 of restricted-feeds R.3's full published bytes. **Reader-side check (§5.1):** a reader served R.3 recomputes that hash over the bytes it received and confirms it equals this commitment. To upgrade this to a walkable commitment log (§5.2), add `seq`/`prev`/`history` per core §9 mechanics (core D.3b demonstrates the chaining).

### C.3. Follows Document (§6)

`https://reader.example/` follows the owner and a grandparent. Full published canonical bytes, signed by `reader-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..7rVRo4zwaPw_ALwAxf9DEmiTkdFZQRizEEKtKJ_ucJ0kNKUYsNB1vA-WJnht7QefhQWWogPbWRiR7PJiHDk6Bw","follows":["https://test.example/","https://gran.example/~gran/"],"updated":1739577600,"url":"https://reader.example/"}
```

**Validation recipe:** verify C.1 and C.3 `_sig` against `reader-key-1` (as it would be listed in `https://reader.example/`'s identity document); verify C.2 `_sig` against `test-key-1`; confirm C.1's pinned hashes equal the core D.4 / D.3 `seq: 1` hashes; confirm C.2's committed hash equals the SHA-256 of restricted-feeds R.3's published bytes (the reader-side check). `tmp/regen.js` performs all of these checks.
