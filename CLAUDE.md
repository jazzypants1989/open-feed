# CLAUDE.md - AI Agent Context

## Project Overview

Open Feed Protocol is a minimal specification for decentralized publishing and interaction, targeting families and small groups first but designed to scale across identities. It builds entirely on existing standards (JSON Feed, JOSE/JWS/JWK, JSON canonicalization) and deliberately keeps a small surface.

## File Structure

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `open-feed-spec.md`   | Normative specification (source of truth), **v0.2.0**  |
| `open-feed-encrypted-content.md` | OPTIONAL extension (v0.1.0): encrypted items (JWE in `_enc`), carrier binding, enc-key lifecycle, blobs, circle rosters |
| `open-feed-conventions.md` | OPTIONAL extension (v0.2.0): `follows` + `pins` documents (Appendix C vectors). Self-commitments **removed** |
| `README.md`           | Human-friendly docs, examples, comparisons, FAQ        |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub built on the protocol |
| `CLAUDE.md`           | This file - context for AI agents                      |
| `tmp/regen.js`       | Test-vector generator/validator (spec Appendix D + conventions Appendix C). Self-verifies signatures **and** cross-checks every vector string against the published docs |
| `tmp/enc-prototype.js` | Encrypted-item probe; CLAIM 5 demonstrates the ciphertext-relay attack and its rejection |
| `tmp/circles-prototype.js` | Roster spike — models rollback only, **not withholding**; see encrypted-content §6.2 |

## Current Status

**Version 0.2.0 — Draft.** v0.1.0 was the first public, self-contained spec. v0.2.0 resolves a
nine-pass simplification debate (`PROPOSALS*.md`, plus a blind adversarial review of pass 9) and is
the version where the protocol stopped pretending to offer privacy it could not deliver.

Pre-1.0: breaking changes ARE allowed to fix correctness/security defects. After 1.0: additive only.

### What changed in 0.2.0, and why

Two facts drove it. **(1) The threat model:** the operator of a family hub may be a loved one who
is an abuser — an adversary who controls the serving path, the inbox, and (by default) the keys. No
confidentiality mechanism defeats them; what the protocol can give them is **exit**, which it did
not previously have. **(2) The missing persona, finally named:** two self-hosting family members.
Nine passes asked for a host-trusted cross-hub audience and concluded none existed; it is the modal
case for a URL-native protocol, and it makes cross-hub `family` visibility a launch requirement.

| Change | Where |
|---|---|
| **Restricted-feeds extension deleted entirely** (not slimmed) — it tried to occupy a cell that doesn't exist, *published but not public* | file removed; §11 replaced; Appendix E records the reasoning + the re-addability test |
| **Conventions §5 self-commitments deleted** — existed only to patch a hole restricted feeds opened | `open-feed-conventions.md` |
| **§11 is now Privacy**: the publish/deliver 2×2, the existence-privacy trade, the audience-of-one rule | spec §11 |
| **New §15 Export and Exit** + fourth adversary tier (hostile custodian who is also the counterparty) | spec §15, §14.2 |
| **Recovery keys MUST be generated on the member's device**, never transmitted to the host | spec §4.5, L3 conformance |
| `feed` + `manifest` + `feeds` → **one `feeds` array** `{url, manifest?, rel}`; `manifest` OPTIONAL (feed-level, not per-item) | spec §3.2.1 |
| `history` → an **index** `[{seq, hash, url}]`; prior versions served individually | spec §5.4, §9.2 |
| Attachment `_sha256` SHOULD → **MUST** | spec §7.4 |
| Tombstones defined by **allowlist** of retained fields | spec §7.3 |
| `crv`/`use` constraints scoped to **signing** keys (resolves a self-contradiction; lets extensions define key types) | spec §4.1 |
| New **encrypted-content extension** | `open-feed-encrypted-content.md` |

### Decisions taken — do not relitigate without new information

- **Exit, not confidentiality, is the answer for the hostile-custodian case.** Encryption is offered
  and honestly bounded; it is never marketed as protection from your own host.
- **Cross-hub `family` = published + encrypted.** The feed is a public, manifested, CORS-`*` file of
  ciphertext. Keeps the completeness proof, export, migration, single-valuedness.
- **Audience is hidden** (encrypted roster, untagged JWE recipients). The owner was explicitly
  worried about publishing association graphs.
- **Family interactions are delivered, not published**, so `_rel` never lands in a public file.
- **Cleartext delivered-private is audience-of-one (DMs) only.**
- **`prev_url` was rejected** in favour of the history index: signed bytes are immutable, so
  `prev_url` would retroactively break the walk for anyone whose pin predates a rehost.
- **Pass 9's "transparency/confidentiality theorem" is false** and was not adopted — its own 2×2
  contains the counterexample (published+encrypted has both). The corrected statement is over
  *existence*-privacy.
- **"Binding symmetry" was rejected**; the real defect next door (`_sha256` as SHOULD) was fixed.
- **Self-monitoring (proposed §5.6) was rejected** as a security rule: evadable by targeted
  equivocation, undefined baseline under split custody, and its stated response is a recovery key
  the adversary generated. The diagnosis survives as a producer MUST to record published
  `(seq, hash)` (§5.2) plus a pointer to third-party pins.
- **`follows`+`pins` merge rejected** — conflates two disclosure decisions and prices
  anti-equivocation in social-graph disclosure.
- **Replies endpoint keeps its own URL**, reframed as a *view over the inbox*.

## The v0.2.0 Object Model (read this before editing anything)

```
{identity_url}/               ← identity URL (optional human page; nothing reads it)
{identity_url}/openfeed.json  ← IDENTITY DOCUMENT: signed; profile + keys + feeds[] + version chain
{identity_url}/feed.json      ← JSON Feed 1.1, signed items
{identity_url}/manifest.json  ← signed, CHAINED commitment to the feed's contents
{identity_url}/inbox          ← POST signed items here (Level 3 only)
{identity_url}/history.json          ← INDEX of retained identity-document versions
{identity_url}/manifest-history.json ← INDEX of retained manifest versions
```

1. **Identity document (§3.2)** — signed, chained. Keys inside (`keys`); every feed in one `feeds`
   array (§3.2.1) with `{url, manifest?, rel}`.
2. **Items (§7)** — signed JSON Feed items: single-entry `authors`, `_feed_url`, `_version`, `_sig`.
3. **Interactions ARE items (§8)** — a `_rel` array; threading via `root`.
4. **Manifest (§9)** — separately-signed, chained commitment to feed contents.

**Two chains, one pin-and-walk discipline (§5, §9.1).** Pin `(seq, hash)` on first observation; walk
`prev` to the pin on every later fetch; any divergence is an attack.

**One principle explains the document set:** a container self-verifies iff its entries are
chain-linked. A chain (identity doc, manifest) needs no companion. A feed does not self-verify —
items are independent leaves — so it needs a companion chain, and that companion *is* the manifest.
Use this as explanation, not as a rule that licenses deletions.

## Open Questions (deferred, not forgotten)

- **Circle rosters are not ready to ship** (encrypted-content §6.2). Before offering them, a second
  prototype must model **withholding** (not just rollback — `tmp/circles-prototype.js` covers only
  rollback), identity-document-published enc keys, carrier binding on roster-wrapped replies, and
  the N identity-doc fetches a single reply implies.
- `_rel` type registry governance pre-1.0
- Key delegation extension (`open-feed-delegation.md`, planned) — multi-device + hub custody without
  a second signing construction; the pinned chain is the revocation substrate NIP-26 lacked
- External time anchoring (transparency log / witness network) beyond the family-scale `pins`
  convention
- Normative bridge profiles (Webmention / ActivityPub / atproto), starting with Webmention
- **Split custody** (hub holds the signing key, client holds only the enc key) is an attractive
  product pattern and is *not* claimed in the spec, because its guarantee holds only when the client
  is not distributed by the custodian — which the reference product does not currently satisfy

## Key Design Decisions (intentional, not oversights)

- **Identity = HTTPS URL** — not DIDs, not handles. URLs are universal and owned. WebFinger gives optional `@user@domain` discovery (Appendix B). Trade-off: weaker account portability than atproto's DID indirection (§14.14) — partly offset in v0.2.0 by making exit a first-class feature (§15).
- **One signed document per identity** — `openfeed.json`. No HTML parsing in the trust chain, no link-relation discovery, no cross-document key-ownership check (key ownership is structural).
- **Keys = JWK inside the identity document** — Ed25519 `OKP` for signing. `kid` in JWS headers = `{identity_url}#{kid}` (split at last `#`). The `crv`/`use` constraints bind **signing** keys only, which is what lets an extension define an encryption key type without a core change.
- **Signatures = one construction** — detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes. Signs header AND payload. Byte-exact (no verify-time normalization; producers emit NFC); duplicate JSON keys rejected (I-JSON). **This is now the only construction anywhere — core and extensions.** Encryption is not a second construction: it changes what the content *is*, not how it is signed.
- **One object model** — like/reply/repost/quote/mention are all items with `_rel`. One schema, one update mechanism (versioning), one delete mechanism (tombstones), one verifier.
- **The feed is the source of truth; the inbox is a push cache.** Nothing exists only in transit — with one stated exception, delivered-private content (§11.1), which is why that is scoped to audience-of-one.
- **Canonical vs copy (`_feed_url`, §7.5)** — an item is canonical only in the feed its signed `_feed_url` names. Manifest proves presence; `_feed_url` proves exclusivity. Neither covers content carried *by reference* — hence `_sha256` MUST (§7.4).
- **Migration = recovery** (§3.4) — one operation, differing only in which key attests. Path 3 (recovery co-signature) is the exit path and works without the old host's cooperation.
- **Honest trust model** (§14.2) — four adversary tiers. The fourth (hostile custodian who is also the counterparty) is not on the technical gradient and is answered by exit, not by cryptography.
- **No privacy mechanism in the core** (§11) — privacy is a publication decision (publish vs deliver), and audience control at one host is host authorization, i.e. software. Confidentiality is an OPTIONAL extension whose guarantee is bounded by recipient key custody.
- **Exit is a first-class feature** (§15, §4.5, §3.4) — the three parts (device-generated recovery key, uncooperative migration, export bundle) only work together, and Level 3 hosts MUST provide all three.

## Standards Adopted

| Standard              | RFC/Spec | Usage in Open Feed               |
| --------------------- | -------- | -------------------------------- |
| JWK                   | RFC 7517 | Public keys (inside identity doc) |
| JWS                   | RFC 7515 | Signature format                 |
| JWS Unencoded Payload | RFC 7797 | Detached `b64:false` signing     |
| JSON Canonicalization | RFC 8785 | Pre-signing serialization        |
| I-JSON                | RFC 7493 | Duplicate-key rejection          |
| JWE                   | RFC 7516 | (Extension) encrypted item content (`_enc`) |
| X25519 / OKP          | RFC 8037 | (Extension) encryption keys, ECDH-ES |
| Ed25519 (EdDSA)       | RFC 8032 | Signature algorithm; test vectors |
| WebFinger             | RFC 7033 | Optional `@user@domain` discovery |
| JSON Feed             | 1.1      | Feed format                      |
| WebSub                | W3C Rec  | Optional real-time (via JSON Feed `hubs`) |

Out of the core: Webmention (now a bridge only), OAuth/IndieAuth, standalone JWKS document, profile-HTML link discovery, and **Authorized Fetch — removed entirely in v0.2.0, not merely moved** (see spec Appendix E).

## When Editing the Spec

1. **Use RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Backwards compatibility** — pre-1.0, breaking changes allowed to fix security/correctness defects; call them out in the status note. Post-1.0 additive only.
3. **Update the version number** on any normative change.
4. **Keep it minimal** — if it can live in README or an extension doc, it should. Guard the single-signing-construction and single-object-model invariants.
5. **Verify examples and test vectors** — `node tmp/regen.js` regenerates and self-verifies core Appendix D (item, both manifests, both identity-doc versions, history index) and conventions Appendix C (pins, follows), **and** reads both published docs to confirm every vector string appears verbatim. It exits non-zero on failure, so a vector that drifts out of sync fails the run instead of sitting stale. Run it after any change touching canonicalization, signing, document shape, or the vectors.
6. **Timestamp consistency** — key/chain fields use Unix seconds (JOSE); content fields use ISO 8601 (JSON Feed).

## When Editing the README

1. Keep the TL;DR under one page.
2. Examples must match the spec's model (identity doc, `_rel`, manifest); don't reintroduce JWKS/profile-links/Webmention-in-core.
3. README explains; spec defines. Link spec section numbers.

## Extension Conventions

- **Field extensions**: prefix with `_` (e.g., `_content_warning`, `_emoji`, `_sha256`). Preserve unknown `_` fields when re-serializing (signatures depend on it).
- **Relation types (`_rel[].type`)**: a registered token (`reply`/`root`/`like`/`repost`/`quote`/`mention`) OR an absolute URL for custom relations (collision-free namespacing). Relation *types* are values, not field names.

## Key Sections Reference (spec v0.2.0)

| Topic | Spec Section |
|-------|--------------|
| Identity URL normalization | 3.1 |
| Identity document | 3.2 |
| Feed entries (`feeds[]`) | 3.2.1 |
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
| Privacy (publish/deliver, audience-of-one) | 11 |
| Replies endpoint | 12 |
| Conformance (L0–L3) | 13 |
| Security considerations | 14 |
| Test vectors | Appendix D |
| Design history (what changed) | Appendix E |
| Gateways / bridges | Appendix F |
| Export and exit | 15 |
| Follows & pins conventions | Appendix G (pointer) → `open-feed-conventions.md` |
