# CLAUDE.md - AI Agent Context

## Project Overview

Open Feed Protocol is a minimal specification for decentralized publishing and interaction, targeting families and small groups first but designed to scale across identities. It builds entirely on existing standards (JSON Feed, JOSE/JWS/JWK, JSON canonicalization) and deliberately keeps a small surface.

## File Structure

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `open-feed-spec.md`   | Normative specification (source of truth), **v0.1.0**  |
| `open-feed-restricted-feeds.md` | OPTIONAL extension (v0.1.0): restricted (audience-controlled) feeds — fetch assertion + capability grants (Appendix R vectors) |
| `open-feed-conventions.md` | OPTIONAL extension (v0.1.0): `follows` + `pins` documents; **self-commitments** (§5) restore cross-reader equivocation detection to restricted feeds (Appendix C vectors) |
| `README.md`           | Human-friendly docs, examples, comparisons, FAQ        |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub built on the protocol |
| `CLAUDE.md`           | This file - context for AI agents                      |
| `tmp/regen.js`       | Test-vector generator/validator (spec Appendix D + restricted-feeds Appendix R + conventions Appendix C) |

## Current Status

**Version 0.1.0 — Draft.**

This is the first *public*, self-contained spec. It is a clean-slate design. Several prior internal drafts (never released; the last was numbered 0.5.1, preserved in git history) explored a much larger surface; v0.1.0 collapses it. The version was reset to 0.1.0 on purpose: the old numbers communicated with an audience that never existed, and this is the first version anyone could actually build against. Appendix E of the spec is the design-history / what-changed record.

Pre-1.0: breaking changes ARE allowed to fix correctness/security defects. After 1.0: additive only.

## The v0.1.0 Object Model (read this before editing anything)

The whole protocol is **a few conventional documents at fixed paths, plus one endpoint:**

```
{identity_url}/               ← identity URL (optional human page; nothing reads it)
{identity_url}/openfeed.json  ← IDENTITY DOCUMENT: signed; profile + keys + endpoints + version chain
{identity_url}/feed.json      ← JSON Feed 1.1, signed items
{identity_url}/manifest.json  ← signed, CHAINED commitment to the feed's contents
{identity_url}/inbox          ← POST signed items here (Level 3 only)
{identity_url}/history.json          ← identity-document version history
{identity_url}/manifest-history.json ← manifest version history
```

Four core pieces to keep straight:

1. **Identity document (`openfeed.json`, spec §3.2)** — replaces the old profile-HTML + separate-JWKS + profile-metadata triad. Keys live *inside* it (`keys` array). Endpoints (`feed`, `manifest`, `inbox`, `replies`, `history`) are fields. It is signed and **chained** (`seq`/`prev`/`updated`/`_sig`); the chain versions *identity state* (keys, profile, endpoints, migration) and advances rarely.
2. **Items (spec §7)** — every content object is a signed JSON Feed item: single-entry `authors` (author binding, §6.6), `_feed_url` (canonical/copy rule, §7.5), `_version`, `_sig`.
3. **Interactions ARE items (spec §8)** — no separate interaction object. An interaction is an item carrying a `_rel` array: `[{ "type": "reply"|"root"|"like"|"repost"|"quote"|"mention"|"<absolute-url>", "to": "{feed_url}#{item_id}" }]`. Threading uses a `root` entry (not `_in_reply_to`). Reactions = `like` + `_emoji`. Content-less relations (like/repost) SHOULD go in a separate **activity feed** (listed in `feeds`).
4. **Manifest (`manifest.json`, spec §9)** — separately-signed, **chained** (`seq`/`prev`/`history`/`items` map id→version/`deleted` map/optional checkpoint). Commits feed contents so a host can't silently drop/reorder/rollback. Pinned (TOFU) by the SAME discipline as the identity chain. Publishing advances the manifest chain, not the identity chain.

**Two chains, one pin-and-walk discipline (spec §5, §9.1):** pin `(seq, hash)` on first observation; walk `prev` to the pin on every later fetch; treat any divergence (seq decrease, prev mismatch, same-seq-different-hash) as an attack. Both chains retain and serve full history, which is what makes host equivocation — of keys *or content* — cross-consumer detectable (the certificate-transparency bargain, §14.2).

## Key Design Decisions (intentional, not oversights)

- **Identity = HTTPS URL** — not DIDs, not handles. URLs are universal and owned. WebFinger gives optional `@user@domain` discovery (Appendix B). Trade-off: weaker account portability than atproto's DID indirection (§14.14) — the deliberate price of URL-native simplicity.
- **One signed document per identity** — `openfeed.json`. No HTML parsing in the trust chain, no link-relation discovery, no cross-document key-ownership check (key ownership is structural: the `kid`'s identity either lists the key or it doesn't).
- **Keys = JWK inside the identity document** — Ed25519 `OKP`. `kid` in JWS headers = `{identity_url}#{kid}` (split at last `#`).
- **Signatures = one construction** — detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes. Signs header AND payload (never payload-only). Byte-exact (no verify-time Unicode normalization; producers emit NFC); duplicate JSON keys rejected (I-JSON, RFC 7493). This is the ONLY signing construction in the core — the restricted-feed token (encoded JWT) is deliberately an extension so the core stays single-construction.
- **One object model** — like/reply/repost/quote/mention are all items with `_rel`. One schema, one update mechanism (versioning), one delete mechanism (tombstones `_deleted:true`), one verifier.
- **The feed is the source of truth; the inbox is a push cache** — inbox delivery makes things fast, polling the signed feed makes them complete. Nothing exists only in transit. No separate outbox (your feed is your outbox).
- **Canonical vs copy (`_feed_url`, §7.5)** — an item is canonical only in the feed its signed `_feed_url` names; the same signed bytes elsewhere are a verifiable *copy* with no liveness/manifest authority. Manifest proves presence; `_feed_url` proves exclusivity.
- **Migration = recovery** (§3.4) — one operation (`predecessor`/`successor` links + recovery-key `_recovery_sig`), differing only in which key attests. No separate attestation/claim documents.
- **Honest trust model** (§14.2) — three adversary tiers: key custodian (impersonation unpreventable, but past-rewriting surfaces as detectable forks), serving-path compromise (chains give full integrity), dumb-host/external-signer (full integrity by construction). Client-side keys / the sketched delegation extension move a user toward the stronger tiers.
- **Delivery is inbox-only in the core** — Webmention is NOT in the core; it returns only as an optional bridge/gateway (Appendix F), ingesting `_unverified` copies.
- **Restricted feeds (Authorized Fetch) are an OPTIONAL extension** (§11; separate doc planned), audience-control not confidentiality.

## Standards Adopted

| Standard              | RFC/Spec | Usage in Open Feed               |
| --------------------- | -------- | -------------------------------- |
| JWK                   | RFC 7517 | Public keys (inside identity doc) |
| JWS                   | RFC 7515 | Signature format                 |
| JWS Unencoded Payload | RFC 7797 | Detached `b64:false` signing     |
| JWT                   | RFC 7519 | (Extension) restricted-feed fetch assertions |
| JSON Canonicalization | RFC 8785 | Pre-signing serialization        |
| I-JSON                | RFC 7493 | Duplicate-key rejection          |
| DPoP (modeled on)     | RFC 9449 | (Extension) fetch-assertion shape |
| Ed25519 (EdDSA)       | RFC 8032 | Signature algorithm; test vectors |
| WebFinger             | RFC 7033 | Optional `@user@domain` discovery |
| JSON Feed             | 1.1      | Feed format                      |
| WebSub                | W3C Rec  | Optional real-time (via JSON Feed `hubs`) |

Out of the core (vs prior drafts): Webmention (now a bridge only), OAuth/IndieAuth, standalone JWKS document, profile-HTML link discovery, Authorized Fetch (now an extension).

## Open Questions (deferred, not forgotten)

- `_rel` type registry governance pre-1.0
- Key delegation extension (`open-feed-delegation.md`, planned) — multi-device + hub custody without a second signing construction; the pinned chain is the revocation substrate NIP-26 lacked
- ~~Restricted-feeds extension doc~~ **DONE** — `open-feed-restricted-feeds.md` v0.1.0 (fetch assertion = the one sanctioned second construction; capability grants primary + reader-list/capability-URL fallbacks; gated §9 manifest; Appendix R vectors in `tmp/regen.js`)
- ~~`follows` + `pins` conventions doc~~ **DONE** — `open-feed-conventions.md` v0.1.0 (URL-keyed signed pins; §4.1 compare rule; **self-commitments** §5 close the restricted-feeds §8.2 cross-reader-equivocation gap for existence-public feeds — the missed connection between pins and §8.2; Appendix C vectors reuse D.4/D.3/R.3 hashes). Core Appendix G shrunk to a pointer; restricted-feeds §2/§8.2 now reference it. **Still open:** F2 (existence-private mode breaks grant→manifest authz + discovery, restricted-feeds §6.2/§7/§9) and F3 (`_grant_revocations` placement vs. identity-chain-stays-short) — logged for a follow-up patch to the restricted-feeds extension.
- External time anchoring (transparency log / witness network) beyond the family-scale `pins` convention — partially served by conventions §4.3 (informal timestamping); a true witness network remains deferred
- Signed export bundle format (identity history + feed + manifest + manifest history)
- Normative bridge profiles (Webmention / ActivityPub / atproto), starting with Webmention

## When Editing the Spec

1. **Use RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Backwards compatibility** — pre-1.0, breaking changes allowed to fix security/correctness defects; call them out in the status note. Post-1.0 additive only.
3. **Update the version number** on any normative change.
4. **Keep it minimal** — if it can live in README or an extension doc, it should. Guard the single-signing-construction and single-object-model invariants.
5. **Verify examples and test vectors** — every `_sig`/hash in the spec must be reproducible. `tmp/regen.js` regenerates and self-verifies Appendix D (item, both manifests, both identity-doc versions). Run it after any change touching canonicalization, signing, or the vectors.
6. **Timestamp consistency** — key/chain fields use Unix seconds (JOSE); content fields use ISO 8601 (JSON Feed).

## When Editing the README

1. Keep the TL;DR under one page.
2. Examples must match the spec's model (identity doc, `_rel`, manifest); don't reintroduce JWKS/profile-links/Webmention-in-core.
3. README explains; spec defines. Link spec section numbers.

## Extension Conventions

- **Field extensions**: prefix with `_` (e.g., `_content_warning`, `_emoji`, `_sha256`). Preserve unknown `_` fields when re-serializing (signatures depend on it).
- **Relation types (`_rel[].type`)**: a registered token (`reply`/`root`/`like`/`repost`/`quote`/`mention`) OR an absolute URL for custom relations (collision-free namespacing). Relation *types* are values, not field names.

## Key Sections Reference (spec v0.1.0)

| Topic | Spec Section |
|-------|--------------|
| Identity URL normalization | 3.1 |
| Identity document | 3.2 |
| Fetching / redirects | 3.3 |
| Migration & recovery (one op) | 3.4 |
| Keys / key identifiers | 4.1–4.2 |
| Rotation / revocation | 4.3–4.4 |
| Recovery keys | 4.5 |
| Version chain (identity) | 5 |
| Pinning / enforcement | 5.3 |
| Fork resolution (`_recovery_sig`) | 5.5 |
| Signatures (format/header/canon) | 6.1–6.3 |
| Verification / author binding | 6.5–6.6 |
| Feeds & items | 7 |
| Versioning & tombstones | 7.3 |
| Canonical vs copied items (`_feed_url`) | 7.5 |
| Interactions are items (`_rel`) | 8 |
| Threading (`root`) | 8.1 |
| The manifest (chained) | 9 |
| Manifest chain mechanics / history / checkpoint | 9.1–9.3 |
| Inbox | 10 |
| Restricted feeds (extension) | 11 |
| Replies endpoint | 12 |
| Conformance (L0–L3) | 13 |
| Security considerations | 14 |
| Test vectors | Appendix D |
| Design history (what changed) | Appendix E |
| Gateways / bridges | Appendix F |
| Follows & pins conventions | Appendix G (pointer) → `open-feed-conventions.md`; self-commitments = §5 |
