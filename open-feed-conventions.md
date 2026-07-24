# Open Feed — Conventions: Follows, Pins, and Thread Discovery (Extension)

**Extension version 0.1.0 — Draft. Unreleased.** Targets the Open Feed core specification **v0.1.0** (`open-feed-spec.md`). This is an OPTIONAL extension; it is not part of the core and MUST NOT be required for core conformance. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive. RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

**A note on what is deliberately absent.** An earlier draft of this document carried a §5 defining *self-commitments* — a public commitment to the hash of a private artifact. It existed solely to restore cross-reader equivocation detection to restricted feeds, and the privacy-and-exit pass removed both (core Appendix E). `pins` is therefore cleanly "observations of others," and should stay that way.

## Abstract

Three optional facilities, all referenced from the identity document (core §3.2, `follows` / `pins` / `replies`):

- **`follows`** — who an identity reads. Turns "which feeds does my hub poll?" from private configuration into published protocol.
- **`pins`** — an identity's `(url, seq, hash)` observations of chained documents (identity documents and manifests, core §5, §9). Publishing them, **signed**, gives a family-scale social graph four properties with no new cryptography: cross-observer **anti-equivocation**, **recovery propagation**, informal **timestamping**, and **first-contact corroboration**.
- **`replies`** — an optional read view over an inbox, filtered to one target id: thread discovery, not trust.

**What is *not* here, deliberately: the compare rule.** Core §5.3.1 defines it and core §12 makes it a Level 1 MUST, because the core's whole transparency claim (§13.2) rests on it. What this extension supplies is the other half — a *supply of second observations* to compare against. Applying the rule to observations you already hold costs nothing and discloses nothing. Publishing pins discloses whom you read and when, which is why publication stays opt-in and the rule does not.

An identity's own record of what it published (core §5.2) is not enough on its own — a host that knows which client is yours can serve you the honest branch. It cannot know which of many readers will compare, which is why comparison by *other people* is the durable check, and why this document exists.

This document supersedes and expands the sketch in core Appendix G, which now points here.

## 1. Relationship to the Core

This extension introduces **no new signing construction.** A published follows or pins document is an ordinary Open Feed signed document — the **core detached-JWS construction (core §6), reused unchanged.** Everything it commits to (identity documents, manifests) is committed by the core's existing chains; pins are *observations of* those chains, not a new chain type. A pins document MAY itself be chained (§3.3) using the identical §9 manifest mechanics.

Everything here is, for the purpose of **verifying content**, outside the trust core: a consumer never needs anyone's follows, pins, or replies endpoint to verify an item, a manifest, or an identity document. What signing adds is that a *peer* can trust a document genuinely came from its author (§2) — which is what makes the four gossip properties (§4) sound. An unsigned, client-local pins store is still useful to its owner as private enforcement memory (core §5.3); it simply cannot be gossiped.

The `replies` endpoint (§6) is outside the trust core in the same sense but for a different reason: it returns other people's already-signed items verbatim, and a consumer re-verifies each one exactly as it would from a feed. It adds discovery, never authority.

## 2. Scope, Trust, and Privacy (read this first)

- **Publishing is opt-in; both documents MAY be kept client-local.** A hub that polls feeds and pins what it sees needs no published document at all — the enforcement value (core §5.3, §5.3.1, §9.1) is entirely local, and the compare rule is a core Level 1 MUST whether or not anything is published. Publishing trades privacy for the network properties below.
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

A consumer that fetches peers' signed pins documents gains four properties. This section specifies the observable behaviors; it does **not** define a gossip/aggregation transport (peer discovery, flooding, anti-spam) — that is the deferred witness-network work (core §13.10, Appendix H). Follows lists are the natural peer set: the identities you follow are the pins you fetch.

### 4.1. Anti-Equivocation (feeding the compare rule)

The rule itself is core §5.3.1: two observations of the same chained-document URL at the same `seq` with different hashes mean the publisher equivocated, and a consumer MUST treat that as an attack. A pin entry is simply an observation in transferable form, so a peer's signed pin is a valid second observation:

- `P.hash == Q.hash` → **corroboration.** The two observers agree on that chain's version.
- `P.hash != Q.hash` → **equivocation.** Core §5.3.1 applies unchanged.

A legitimate post-theft **fork resolution** (core §5.5) surfaces here too — after key theft, two identity-document branches carry the same `seq` with different hashes, one bearing a valid recovery co-signature. That is not a false positive: the chain genuinely *did* fork. Core §5.3.1 says to run §5.5 resolution before treating a divergence as unresolved compromise, and that applies to pins exactly as it applies to a consumer's own two observations.

What this extension adds is **reach**. Without published pins, a consumer can only compare against what it happened to fetch itself, so a host that serves each reader a consistent private branch is never caught. With them, the comparison spans the social graph — the certificate-transparency bargain (core §13.2) made concrete for a family. An **aggregator** is just a consumer that fetches many pins documents and compares pairwise; it needs no special authority, because every input is independently signed.

This is also the practical defence against the genesis-equivocation attack in core §4.5, where a host commits a recovery key its member never generated. One relative's pin of that member's genesis document, compared once, defeats it.

### 4.2. Recovery Propagation

A recovery-based migration (core §3.4) cannot publish a `successor` from the lost domain, so consumers who lost the old pointer may never learn of it. A trusted peer's pin naming a `seq` for the old identity **beyond** the consumer's own pin is the signal to re-walk: the consumer fetches that identity's history, walks to the peer's `(seq, hash)` (confirming it reached the same version the peer witnessed), and discovers the `predecessor`/recovery co-signature there (core §3.4, §5.5). The pin is the pointer that says "look again"; verification remains the consumer's own.

### 4.3. Informal Timestamping

A signed pin with `observed = T`, from an author the consumer trusts, is a **witnessed assertion** that `(url, seq, hash)` existed by time `T`. Independent witnesses converging on a `(seq, hash)` at or before `T` establish a family-scale lower bound on when that version existed — the external time anchor core §4.4 and §13.10 defer to conventions. It is evidential, not a proof (§2): a colluding witness can backdate `observed`, so a single witness is only as trustworthy as its author, and strength comes from independence.

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

## 6. The `replies` Endpoint (OPTIONAL)

An identity MAY expose thread discovery via a `replies` field in its identity document (core §3.2). This lived in the core through several drafts and was moved here, because it is **discovery, not trust**: everything it returns is obtainable by polling the participants' feeds, which is where the reply items are canonically published (core §7.5). Its only unique reach is replies from identities a consumer does not already follow — near-nothing at family scale, and a spam surface at any other.

It moved rather than being deleted for one reason: it is the largest privacy footgun the protocol has, and an implementer who wants thread discovery will build *something*. Better that the thing they build comes with §6.2 attached than that they reinvent it without.

### 6.1. Shape

The endpoint is **a read view over the inbox**, not a second store. Everything it returns was delivered by `POST {inbox}` (core §10) and is held verbatim there; this is a public projection of that data, filtered to one target id. Build it as a query, not as a parallel collection to keep in sync.

It keeps its own URL rather than being folded into `GET {inbox}`: core §10.1 reserves authenticated GET on the inbox for the owner reading their own mail, and an inbox may hold delivered-private content (core §11.1). One URL serving both an owner-scoped private view and an unauthenticated public projection is the shape most authorization bugs take. Two URLs, one store.

```
GET {replies}?item={percent-encoded-item-id}
```

The response is a **JSON Feed** (core §7.1) whose `items` are the reply items reproduced **byte-verbatim** as received, with the queried id echoed in a feed-level `_replies_to`. Optional params: `since` (ISO 8601), `limit` (default 50); pagination via the feed's own `next_url`. Because the response is a JSON Feed, consumers reuse the feed parser, and the verbatim rule (fields never added, dropped, or reordered; absent fields stay absent, never `null`) is the same rule that already governs feeds. Consumers re-verify each reply's signature and build the tree from `_rel` `reply` entries (`root` entries, core §8.1, index deep replies to their thread). The endpoint MAY be moderated or filtered; consumers handle gaps gracefully.

### 6.2. Published replies only (MUST)

> An item with **no `_feed_url`** MUST NOT appear in a replies-endpoint response, whatever its `_rel` targets. Its author delivered it rather than publishing it (core §11.1.1), and this endpoint MUST NOT overrule that.

The check is a single field lookup inside the signed bytes — the author's own statement that the item is published — so it costs nothing and needs no manifest fetch (core §10.3 forbids requiring one). An author who later promotes a delivered item to published, by bumping `_version` and adding `_feed_url`, makes it eligible from that revision onward; a receiver serves whichever revision it actually holds.

An implementation that skips this check converts every delivered-private interaction it receives into a public one, silently and by default. The encrypted-content extension routes group interactions down the delivered path precisely to keep a reply graph off the public web (`open-feed-encrypted-content.md` §7); that design depends entirely on this rule holding here. Core §13.14 names it as the failure mode most likely to be introduced by an implementer who is being *helpful*.

## 7. Conformance

This extension defines no new conformance level; it refines core Level 1+ (core §12).

- A consumer that publishes follows or pins MUST sign them with the core construction (core §6) and set `url` to its own identity (author binding).
- A consumer that consumes peers' pins MUST treat each pin entry as an observation for core §5.3.1's compare rule. (The rule itself is a core Level 1 MUST and is not restated here.)
- An implementation serving a `replies` endpoint MUST enforce §6.2.
- All three facilities remain OPTIONAL: a peer that publishes none of them is fully conformant, and no consumer may require them of a peer.

## Appendix C: Test Vectors

All vectors are computed and self-verifying, regenerated by `tmp/regen.js` alongside the core Appendix D vectors. Keys are the same deterministic, testing-only Ed25519 keys as core Appendix D. **Not for any real identity.**

Identities: publisher/reader `https://reader.example/` (key `reader-key-1`); feed owner `https://test.example/` (key `test-key-1`, as in core D.1). The pinned hashes are reproduced verbatim from the core vectors: the identity-document hash from core D.4 (`seq: 1`) and the manifest hash from core D.3 (`seq: 1`).

### C.1. Pins Document — Observer (§3, §4)

The reader `https://reader.example/` witnesses the owner's public identity document (core D.4, `seq: 1`) and public manifest (core D.3, `seq: 1`). Full published canonical bytes, signed by `reader-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..r7oXrbWhRVsbjqfRMH9orMexlXhCvm5XHWElijfA0b7tqE1-lMA9JQcJksozDtQSBQr2oIWl4pyUAZODSKj7Ag","pins":[{"hash":"vvjaE1GRk0wxvVU37Ik8h6uVzFLoAZ_-TInTrQB4zho","observed":1739577600,"seq":1,"url":"https://test.example/openfeed.json"},{"hash":"8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI","observed":1739577600,"seq":1,"url":"https://test.example/manifest.json"}],"updated":1739577600,"url":"https://reader.example/"}
```

The two `hash` values equal, respectively, core D.4's identity-document `seq: 1` hash and core D.3's manifest `seq: 1` hash — so any consumer holding its own pin of either chain can run the §4.1 compare rule against this document.

### C.2. Follows Document (§5)

`https://reader.example/` follows the owner and a grandparent. Full published canonical bytes, signed by `reader-key-1`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9..7rVRo4zwaPw_ALwAxf9DEmiTkdFZQRizEEKtKJ_ucJ0kNKUYsNB1vA-WJnht7QefhQWWogPbWRiR7PJiHDk6Bw","follows":["https://test.example/","https://gran.example/~gran/"],"updated":1739577600,"url":"https://reader.example/"}
```

**Validation recipe:** verify C.1 and C.2 `_sig` against `reader-key-1` (as it would be listed in `https://reader.example/`'s identity document); confirm C.1's pinned hashes equal the core D.4 / D.3 `seq: 1` hashes. `tmp/regen.js` performs all of these checks.
