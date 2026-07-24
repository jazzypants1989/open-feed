# Open Feed — Follows and Pins (Conventions Extension)

**Extension version 0.2.0 — Draft.** Targets the Open Feed core specification **v0.2.0** (`open-feed-spec.md`). This is an OPTIONAL extension; it is not part of the core and MUST NOT be required for core conformance. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive. RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

**Changed in 0.2.0:** §5 (self-commitments) is **removed**, along with vectors C.2/C.2b. It existed solely to restore cross-reader equivocation detection to restricted feeds, and the restricted-feeds extension no longer exists (core Appendix E). `pins` is once again cleanly "observations of others."

## Abstract

Two optional documents, both referenced from the identity document (core §3.2, `follows` / `pins`):

- **`follows`** — who an identity reads. Turns "which feeds does my hub poll?" from private configuration into published protocol.
- **`pins`** — an identity's `(url, seq, hash)` observations of chained documents (identity documents and manifests, core §5, §9). Publishing them, **signed**, gives a family-scale social graph four properties with no new cryptography: cross-observer **anti-equivocation**, **recovery propagation**, informal **timestamping**, and **first-contact corroboration**.

Pins are the answer to a question the core raises and does not settle: §14.2 claims equivocation is detectable, which is true only if *somebody compares*. An identity's own record of what it published (core §5.2) is not enough — a host that knows which client is yours can serve you the honest branch. Comparison by *other people* is the durable check, and this is the document that makes it mechanical.

This document supersedes and expands the sketch in core Appendix G, which now points here.

## 1. Relationship to the Core

This extension introduces **no new signing construction.** A published follows or pins document is an ordinary Open Feed signed document — the **core detached-JWS construction (core §6), reused unchanged.** Everything it commits to (identity documents, manifests) is committed by the core's existing chains; pins are *observations of* those chains, not a new chain type. A pins document MAY itself be chained (§3.3) using the identical §9 manifest mechanics.

Follows and pins are, for the purpose of **verifying content**, outside the trust core: a consumer never needs anyone's follows or pins to verify an item, a manifest, or an identity document. What signing adds is that a *peer* can trust the document genuinely came from its author (§2) — which is what makes the four gossip properties (§4) sound. An unsigned, client-local pins store is still useful to its owner as private enforcement memory (core §5.3); it simply cannot be gossiped.

## 2. Scope, Trust, and Privacy (read this first)

- **Publishing is opt-in; both documents MAY be kept client-local.** A hub that polls feeds and pins what it sees needs no published document at all — the enforcement value (core §5.3, §9.1) is entirely local. Publishing trades privacy for the network properties below.
- **Follows publish who you read.** A `follows` document names, in cleartext, the identities you subscribe to — your reading graph. This is often sensitive; core Appendix G already flags social-graph documents as keepable client-local, and this extension inherits that caution. If `follows` entries carry a `name` petname (the object form, §5), a published follows document *also* discloses your private labels for those identities — publish petnames only if you intend them public.
- **Pins publish who you read *and when*.** Each pin's `observed` time (§3.2) reveals when you last polled a given identity — your online times and reading cadence. A pins document is a strictly richer social-graph disclosure than a follows document.
- **A pin leaks no content.** `hash` is a preimage-resistant SHA-256; the item ids, versions, and timestamps inside a pinned manifest cannot be recovered from it. What a pins document discloses is *whom you read and when*, not *what they said*.
- **Signing does not make a pin true.** A signed pin proves its author *asserts* it observed `(url, seq, hash)` at `observed` — not that the observation is honest. A lying witness can assert a hash it never saw. The gossip properties (§4) are therefore evidential, not proofs: they gain strength from *multiple independent* witnesses, and a single witness is only as trustworthy as its author.

## 3. The `pins` Document

An identity MAY publish a pins document and reference it from its identity document via the `pins` field (core §3.2). It records versions of chained documents the publisher has observed.

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

### 3.1. Document Fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The publisher's identity URL. Author binding (core §6.6): the `_sig` `kid`'s identity MUST equal this. |
| `pins` | MUST | Array of pin entries (§3.2). MAY be empty. |
| `updated` | MUST | Publication time (Unix seconds). |
| `_sig` | SHOULD (MUST if published) | Detached JWS by a key valid in the publisher's identity chain (core §6). |
| `seq`, `prev`, `history` | MAY | Present iff the pins document is itself chained (§3.3). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise. Timestamps in this document use **Unix seconds** throughout (the pinned data is chain-adjacent, and `observed` is compared against key `iat` / `revoked_at`, core §4).

### 3.2. Pin Entry

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The **chained document** observed: an identity document (`{identity_url}openfeed.json`) or any manifest (`.../manifest.json`, core §9). The URL disambiguates all of an identity's chains uniformly — one identity-document chain, one manifest chain per feed (core §3.2 `feeds`). |
| `seq` | MUST | The observed version counter of that chain. |
| `hash` | MUST | Base64url SHA-256 of the observed version's **full published canonical bytes** (including its `_sig`) — the same value that version's successor hashes in `prev` (core §5.1, §9). |
| `observed` | SHOULD | Wall-clock time (Unix seconds) the publisher **first** observed this `(url, seq, hash)`. The witnessed lower bound that enables informal timestamping (§4.3). |

A pin names one version. To attest a chain's progression, publish multiple pins (successive `seq`) or re-publish the pins document over time.

### 3.3. Chained Pins Documents (OPTIONAL)

A pins document MAY carry `seq`, `prev`, and `history`, in which case it is a chain with the **identical mechanics of core §9** (monotonic `seq`, `prev` = base64url SHA-256 of the prior version's full bytes, retained history, pin-and-walk enforcement per core §9.1). Chaining makes a *consumer* of the pins able to detect rollback of the pins themselves — a host cannot silently drop a past pin.

Chaining is OPTIONAL (an unchained document is a signed "latest snapshot," sufficient for the compare rule of §4.1). Chain it when you want consumers of your pins to detect a host silently dropping a past observation.

## 4. Consuming Pins

A consumer that fetches peers' signed pins documents gains four properties. This section specifies the observable behaviors; it does **not** define a gossip/aggregation transport (peer discovery, flooding, anti-spam) — that is the deferred witness-network work (core §14.10, Appendix H). Follows lists are the natural peer set: the identities you follow are the pins you fetch.

### 4.1. Anti-Equivocation (the compare rule)

Given any two pins `P` and `Q` (from any sources, including one's own store) with `P.url == Q.url` and `P.seq == Q.seq`:

- `P.hash == Q.hash` → **corroboration.** The two observers agree on that chain's version.
- `P.hash != Q.hash` → **equivocation.** The identity that owns `P.url` served divergent versions at one `seq`. Consumers MUST treat this exactly as the local equivocation case (core §5.3 for identity documents, §9.1 for manifests): the chain is compromised or the host is dishonest; flag it.

  A legitimate post-theft **fork resolution** (core §5.5) also surfaces here — after key theft, two identity-document branches carry the same `seq` with different hashes, one of them bearing a valid recovery co-signature (`_recovery_sig`). This is not a false positive: the chain genuinely *did* fork, and the compare rule is right to report it. What the compare rule reports is *that* a fork exists; **core §5.5 is how a consumer then picks the honest branch** (prefer the one with a valid `_recovery_sig`; a fork where neither branch has one is unresolvable and goes to manual review). A consumer applying §4.1 to identity-document pins SHOULD run the §5.5 resolution before treating a divergence as unresolved compromise.

This turns core §5.3's / §9.1's "two observers reconstruct the document at a shared `seq` and compare hashes" from a manual, out-of-band step into published, automatable data — the certificate-transparency bargain (core §14.2) made concrete for a family. An **aggregator** is simply a consumer that fetches many pins documents and runs this comparison pairwise; it needs no special authority, because every input is independently signed.

### 4.2. Recovery Propagation

A recovery-based migration (core §3.4) cannot publish a `successor` from the lost domain, so consumers who lost the old pointer may never learn of it. A trusted peer's pin naming a `seq` for the old identity **beyond** the consumer's own pin is the signal to re-walk: the consumer fetches that identity's history, walks to the peer's `(seq, hash)` (confirming it reached the same version the peer witnessed), and discovers the `predecessor`/recovery co-signature there (core §3.4, §5.5). The pin is the pointer that says "look again"; verification remains the consumer's own.

### 4.3. Informal Timestamping

A signed pin with `observed = T`, from an author the consumer trusts, is a **witnessed assertion** that `(url, seq, hash)` existed by time `T`. Independent witnesses converging on a `(seq, hash)` at or before `T` establish a family-scale lower bound on when that version existed — the external time anchor core §4.4 and §14.10 defer to conventions. It is evidential, not a proof (§2): a colluding witness can backdate `observed`, so a single witness is only as trustworthy as its author, and strength comes from independence.

### 4.4. First-Contact Corroboration

First contact with any identity is TOFU (core §5.3): the consumer accepts and pins whatever it is first served, with no way to know it is the honest version. Consistent signed pins of the same `(seq, hash)` from identities the consumer **already** trusts soften this — an informal web of trust over first contact. It never replaces verification of the chain from that pin forward; it only raises confidence that the pinned starting point is the real one.

## 5. The `follows` Document

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

## 6. Conformance

This extension defines no new conformance level; it refines core Level 1+ (core §13).

- A consumer that publishes follows or pins MUST sign them with the core construction (core §6) and set `url` to its own identity (author binding).
- A consumer that **consumes** peers' pins MUST apply the §4.1 compare rule and treat a same-`(url, seq)`/different-`hash` divergence as equivocation (core §5.3, §9.1).
- Follows and pins remain OPTIONAL: a peer that publishes neither is fully conformant, and no consumer may require them of a peer.

## Appendix C: Test Vectors

All vectors are computed and self-verifying, regenerated by `tmp/regen.js` alongside the core Appendix D vectors. Keys are the same deterministic, testing-only Ed25519 keys as core Appendix D. **Not for any real identity.**

Identities: publisher/reader `https://reader.example/` (key `reader-key-1`); feed owner `https://test.example/` (key `test-key-1`, as in core D.1). The pinned hashes are reproduced verbatim from the core vectors: the identity-document hash from core D.4 (`seq: 1`) and the manifest hash from core D.3 (`seq: 1`).

### C.1. Pins Document — Observer (§3, §4)

The reader `https://reader.example/` witnesses the owner's public identity document (core D.4, `seq: 1`) and public manifest (core D.3, `seq: 1`). Full published canonical bytes, signed by `reader-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..zA-5qdtj7to9Qj_tTbQ3oo7wme9zcV5PM1__bXjd6ArcKn1rz6Gs0F41tWVkmyxWjzASWzG3rnbsced9TxaRBg","pins":[{"hash":"mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y","observed":1739577600,"seq":1,"url":"https://test.example/openfeed.json"},{"hash":"GPbjqBsIVHRzgMlbfqXu5IU29SqEhMQnAlukdt8j7DY","observed":1739577600,"seq":1,"url":"https://test.example/manifest.json"}],"updated":1739577600,"url":"https://reader.example/"}
```

The two `hash` values equal, respectively, core D.4's identity-document `seq: 1` hash and core D.3's manifest `seq: 1` hash — so any consumer holding its own pin of either chain can run the §4.1 compare rule against this document.

### C.2. Follows Document (§5)

`https://reader.example/` follows the owner and a grandparent. Full published canonical bytes, signed by `reader-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..7rVRo4zwaPw_ALwAxf9DEmiTkdFZQRizEEKtKJ_ucJ0kNKUYsNB1vA-WJnht7QefhQWWogPbWRiR7PJiHDk6Bw","follows":["https://test.example/","https://gran.example/~gran/"],"updated":1739577600,"url":"https://reader.example/"}
```

**Validation recipe:** verify C.1 and C.2 `_sig` against `reader-key-1` (as it would be listed in `https://reader.example/`'s identity document); confirm C.1's pinned hashes equal the core D.4 / D.3 `seq: 1` hashes. `tmp/regen.js` performs all of these checks.
