# CLAUDE.md - AI Agent Context

## Project Overview

Open Feed Protocol is a minimal specification for decentralized publishing and interaction, targeting families and small groups first but designed to scale across identities. It builds entirely on existing standards (JSON Feed, JOSE/JWS/JWK, JSON canonicalization) and deliberately keeps a small surface.

## File Structure

| File                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `open-feed-spec.md`   | Normative specification (source of truth), **v0.1.0**  |
| `open-feed-encrypted-content.md` | OPTIONAL extension (v0.1.0): encrypted items (JWE in `_enc`), carrier binding, enc-key lifecycle, blobs, circle rosters. **Never independently reviewed** |
| `open-feed-conventions.md` | OPTIONAL extension (v0.1.0): `follows` + `pins` + the `replies` endpoint (Appendix C vectors) |
| `README.md`           | Human-friendly docs, examples, comparisons, FAQ        |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub built on the protocol |
| `CLAUDE.md`           | This file - context for AI agents                      |
| `tmp/regen.js`       | Test-vector generator/validator (spec Appendix D + conventions Appendix C). Self-verifies signatures, confirms each manifest entry's hash equals its item's full published bytes, **and** cross-checks every vector string against the published docs |
| `tmp/enc-prototype.js` | Encrypted-item probe; CLAIM 5 demonstrates the ciphertext-relay attack and its rejection |
| `tmp/circles-prototype.js` | Roster spike — models rollback only, **not withholding**; see encrypted-content §6.2 |

## Current Status

**Version 0.1.0 — Draft. Unreleased: nothing here has had a reader outside this repo, and nothing
implements it.** The number is a placeholder for a first release, not a running edit counter.

**Do not bump the version for ordinary normative changes.** Earlier sessions bumped it per editing
pass, which produced a "0.2.0" that claimed on its own first line to be "the second public draft"
of a document nobody had read. Record changes in spec Appendix E and in this file; move the number
only at a release someone outside this repository can depend on.

Pre-1.0: breaking changes ARE allowed to fix correctness/security defects. After 1.0: additive only.

### The privacy-and-exit pass — what it settled, and why

(Named rather than numbered; it is the body of work on branch `v0.2.0-privacy-and-exit`, which
predates the renumbering above.)

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
| **New §14 Export and Exit** + fourth adversary tier (hostile custodian who is also the counterparty) | spec §14, §13.2 |
| **Recovery keys MUST be generated on the member's device**, never transmitted to the host | spec §4.5, L3 conformance |
| `feed` + `manifest` + `feeds` → **one `feeds` array** `{url, manifest, rel}` (`manifest` was OPTIONAL in this pass; the later simplification pass made it a MUST) | spec §3.2.1 |
| `history` → an **index** `[{seq, hash, url}]`; prior versions served individually | spec §5.4, §9.2 |
| Attachment `_sha256` SHOULD → **MUST** | spec §7.4 |
| Tombstones defined by **allowlist** of retained fields | spec §7.3 |
| `crv`/`use` constraints scoped to **signing** keys (resolves a self-contradiction; lets extensions define key types) | spec §4.1 |
| New **encrypted-content extension** | `open-feed-encrypted-content.md` |

### Since that pass: the receiver-side republication fix (§11.1.1)

A defect found while orienting, not part of the pass above. Extension §7 routes group interactions
down the **delivered** path so the reply graph never lands in a world-readable file — but core §12
defines a world-readable projection of the inbox and did not say what it may contain. A hub
implementing both (the replies endpoint is a Level 3 SHOULD) would publish exactly the graph the
extension was built to hide.

Fixed by one rule, stated once and applied at three sites: **publication is the author's decision,
and only the author's.** An item with no `_feed_url` was delivered, not published; a receiver holds
it as a *custodian, not an author* (§14's own words, never applied here before) and MUST NOT place
it in any publicly-readable artifact.

| Where | What |
|---|---|
| spec **§11.1.1** (new) | The rule, plus the honest limit: it binds the *bytes*, not the information (§6.6's by-value/by-reference line) |
| spec §12 | Replies endpoint: items with no `_feed_url` MUST NOT be returned. One field lookup; no manifest fetch (§10.3 forbids requiring one) |
| spec §7.5 | Gateways MUST NOT emit delivered-only items outbound — the egress half of a bridge |
| spec §13.14 (new) | Security consideration; §13.15 is the renumbered identity-portability item |

### Since that pass: interoperability (Appendix F rewritten)

Three factual errors and one structural one were found and fixed. **Net effect: no new fields, and
one branch of a MUST deleted.** Interop got *smaller*, not bigger.

| Was | Now |
|---|---|
| "FEP-8b32 = the same primitive Open Feed uses; a near-transparent object-level bridge becomes conceivable" (in 3 files) | **False, corrected.** Same curve and canonicalization, but `eddsa-jcs-2022` signs `SHA256(proofConfig) ‖ SHA256(doc)` while Open Feed signs the JWS signing input directly. No signature crosses. Only the *key* is shareable (F.4) |
| §7.5: bridged content is `_unverified` **or** authored by a disclosed gateway identity | **The OR is deleted.** Everything ingested is `_unverified`, without exception — nothing crossing a protocol boundary is natively authentic |
| Appendix F option (3) proxied foreign actors, colliding with §12's Level 3 exit MUSTs | **Resolved by the OR deletion.** A proxy never claims to *be* the actor, so §12 doesn't reach it (F.3), at the price of three disclosure MUSTs |
| Three trust "lanes" (ingest / attest / proxy) | **One construction.** Ingest and attest were always identical; proxy differs only in whose identity URL signs |
| No rule for encrypted or delivered content crossing a bridge | **F.2, symmetric in both directions** |

**The organizing rule, which replaced the list:** *a gateway may not change the terms under which
content was published* — not the **audience** (never widen), not the **durability** (never make
permanent what was ephemeral), not the **verification status** (never present an assertion as a
signature). Those three questions are the test for any future protocol.

Two things worth not re-deriving:

- **Inbound is publication, not observation.** An ingested item lands in the gateway's manifested,
  permanently-retained, CORS-`*` feed. So ingesting one followers-only Mastodon post is a
  permanent world-readable committed disclosure. F.2's inbound half is newer and sharper than its
  outbound half; earlier drafts had only the outbound half.
- **Proxy identities are the attribution mechanism, not a UX nicety.** With `authors[0]` = the
  gateway (forced by §6.6), an ingested item has nowhere to name the foreign author. A per-actor
  proxy identity carries `name`/`bio`/`avatar` in its own identity document — structural
  attribution, zero new fields. It is also the only representation for actors whose identifiers
  cannot be URLs (Nostr `npub`, a phone number).

**Appendix F.1 is the part to act on first.** The cheapest interop is not a bridge: a JSON Feed is
already a JSON Feed, and an Atom mirror + h-card is enough for Bridgy Fed to bridge a site into the
fediverse with nothing in this repo implemented. Its bridged handle is `@yourdomain.com` — already
the identity URL, so no mapping exists to design.

#### Since that pass: the simplification pass (current)

Driven by a comparison against IndieWeb / ActivityPub / atproto / Nostr, which asked how much unique
utility the core actually provides. Net effect: **four core document types instead of six, one fewer
endpoint, one fewer conformance conditional — and the guarantee the protocol claims against a
key-holding host became true rather than nearly true.** Full rationale in spec Appendix E.1.

| Was | Now |
|---|---|
| `history` field → an unsigned `(seq, hash, url)` **index document**, one per chain | **Deleted.** Prior versions at a derived URL: strip `.json`, append `/{seq}.json` (spec §5.4). The index's hashes carried no authority *by its own admission*, its parallel-fetch benefit is reproduced by computing the URL range, and "pruned vs missing" was never distinguishable since the publisher controlled the index too |
| `manifest` OPTIONAL per feed entry; a feed could exist with no completeness proof | **MUST.** Every listed feed is manifested (§3.2.1). Deletes three consumer rules, a per-feed conditional in every verifier, and the footgun of real content silently unproven |
| Manifest version count grows with **activity** | Bounded by **time**: a manifest MAY advance on a cadence rather than per publication (§9.2). §9.4 invariant 3's "manifest lag" already defined the resulting state. This is what paid for the line above |
| Manifest commits `id → version` | `id → **[version, hash]**` (§9). ~48 bytes/item |
| Replies endpoint in core §12 | **Moved to conventions §6**, carrying §11.1.1's guard with it. It is discovery, not trust — everything it returns is obtainable by polling participants' feeds |
| Pinning a Level 1 **SHOULD**; compare rule only in an optional extension | Both **promoted**: pinning is a MUST with a stateless-verifier carve-out (§12), and the compare rule is core (**§5.3.1**) |
| `_rel` `to` dangles across a migration | Predecessor/successor targets are equivalent once a migration verifies (§3.4); inbox relevance accepts predecessor URLs (§10.2) |
| Device-generated recovery key, uncheckable | Level 3 MUST disclose the **genesis `(seq, hash)` and recovery-key fingerprint** for out-of-band comparison (§4.5) |

**Two findings worth not re-deriving.**

- **A version-only manifest is undetectably insufficient against a key custodian.** It is fully
  sufficient against a serving-path attacker, which is why this survived nine passes. But a host
  holding the signing key can sign one `(id, version)` as two different things for two readers and
  produce *byte-identical manifests* — agreeing pins, no fork, nothing to find. §13.2 claimed the
  chains catch content rewriting; that claim was false for the modal deployment until the hash.
- **§4.5's device-generated recovery key can be honored to the letter and defeated in full.** A host
  serves the member a genesis document with the member's real recovery key, and serves *everyone
  else* one with a key the host holds. The member's own view is correct, so §5.2's self-record sees
  nothing; at exit the member's co-signature fails against every pin while the host produces a
  competing branch that §5.5 *prefers*. The fix is comparison, not cryptography — hence §5.3.1 and
  the Level 3 disclosure. **Exit's root of trust is a TOFU event the adversary mediates.**

## Decisions taken — do not relitigate without new information

- **Exit, not confidentiality, is the answer for the hostile-custodian case.** Encryption is offered
  and honestly bounded; it is never marketed as protection from your own host.
- **Cross-hub `family` = published + encrypted.** The feed is a public, manifested, CORS-`*` file of
  ciphertext. Keeps the completeness proof, export, migration, single-valuedness.
- **Audience is hidden** (encrypted roster, untagged JWE recipients). The owner was explicitly
  worried about publishing association graphs.
- **Family interactions are delivered, not published**, so `_rel` never lands in a public file.
  This only holds because §11.1.1 forbids receivers from republishing them; the two are one design.
- **Cleartext delivered-private is audience-of-one (DMs) only.**
- **`prev_url` was rejected**, and so was the history index that replaced it: signed bytes are
  immutable, so `prev_url` would retroactively break the walk for anyone whose pin predates a
  rehost. The derived URL (§5.4) has the same rehosting-safety for the same reason — it is computed
  from where the document is served *now* — at one fewer document type and one fewer round trip.
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
- **Replies endpoint keeps its own URL**, reframed as a *view over the inbox* — and now lives in the
  conventions extension (§6) rather than the core. It moved rather than being deleted because an
  implementer who wants thread discovery will build *something*, and §11.1.1's guard should travel
  with it.
- **Bridged content is always `_unverified`** — no exception, no second form. The deleted OR was
  what generated the three-lane structure and the §12 exit collision; both vanished with it.
- **Author-side dual signing is parked, not rejected** (Appendix H) — the only route to verified
  cross-protocol authorship, and the two signing inputs are structurally unconfusable. Taking it up
  means deciding whether "one signing construction" governs *this protocol's artifacts* or
  *everything an Open Feed publisher signs*. Not blocking anything.

## The Object Model (read this before editing anything)

```
{identity_url}/               ← identity URL (optional human page; nothing reads it)
{identity_url}/openfeed.json  ← IDENTITY DOCUMENT: signed; profile + keys + feeds[] + version chain
{identity_url}/openfeed/{seq}.json  ← retained prior versions, DERIVED path (§5.4)
{identity_url}/feed.json      ← JSON Feed 1.1, signed items
{identity_url}/manifest.json  ← signed, CHAINED commitment to the feed's contents (items → [version, hash])
{identity_url}/manifest/{seq}.json  ← retained prior manifest versions, same derivation
{identity_url}/inbox          ← POST signed items here (Level 3 only)
```

There is **no history-index document**. Prior versions of any chained document live at
`{doc URL minus .json}/{seq}.json`. Four document types, not six.

1. **Identity document (§3.2)** — signed, chained. Keys inside (`keys`); every feed in one `feeds`
   array (§3.2.1) with `{url, manifest, rel}` — `manifest` is required, every listed feed is proven.
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
- Normative bridge profiles (Webmention / ActivityPub / atproto / Nostr) — the framework and the
  template exist (Appendix F.2, F.5), so a profile is now a filled-in table, not a fresh trust
  argument. **Do F.1 first**: the Atom-mirror route reaches the fediverse via existing bridges with
  nothing implemented, and may make the Webmention profile optional rather than the starting point
- Author-side dual signing (Appendix H) — parked, see "Decisions taken"
- **Split custody** (hub holds the signing key, client holds only the enc key) is an attractive
  product pattern and is *not* claimed in the spec, because its guarantee holds only when the client
  is not distributed by the custodian — which the reference product does not currently satisfy

## Key Design Decisions (intentional, not oversights)

- **Identity = HTTPS URL** — not DIDs, not handles. URLs are universal and owned. WebFinger gives optional `@user@domain` discovery (Appendix B). Trade-off: weaker account portability than atproto's DID indirection (§13.15) — partly offset by making exit a first-class feature (§14).
- **One signed document per identity** — `openfeed.json`. No HTML parsing in the trust chain, no link-relation discovery, no cross-document key-ownership check (key ownership is structural).
- **Keys = JWK inside the identity document** — Ed25519 `OKP` for signing. `kid` in JWS headers = `{identity_url}#{kid}` (split at last `#`). The `crv`/`use` constraints bind **signing** keys only, which is what lets an extension define an encryption key type without a core change.
- **Signatures = one construction** — detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes. Signs header AND payload. Byte-exact (no verify-time normalization; producers emit NFC); duplicate JSON keys rejected (I-JSON). **This is now the only construction anywhere — core and extensions.** Encryption is not a second construction: it changes what the content *is*, not how it is signed.
- **One object model** — like/reply/repost/quote/mention are all items with `_rel`. One schema, one update mechanism (versioning), one delete mechanism (tombstones), one verifier.
- **The feed is the source of truth; the inbox is a push cache.** Nothing exists only in transit — with one stated exception, delivered-private content (§11.1), which is why that is scoped to audience-of-one.
- **Canonical vs copy (`_feed_url`, §7.5)** — an item is canonical only in the feed its signed `_feed_url` names. Manifest proves presence; `_feed_url` proves exclusivity. Neither covers content carried *by reference* — hence `_sha256` MUST (§7.4).
- **Migration = recovery** (§3.4) — one operation, differing only in which key attests. Path 3 (recovery co-signature) is the exit path and works without the old host's cooperation.
- **Honest trust model** (§13.2) — four adversary tiers. The fourth (hostile custodian who is also the counterparty) is not on the technical gradient and is answered by exit, not by cryptography.
- **No privacy mechanism in the core** (§11) — privacy is a publication decision (publish vs deliver), and audience control at one host is host authorization, i.e. software. Confidentiality is an OPTIONAL extension whose guarantee is bounded by recipient key custody.
- **Exit is a first-class feature** (§14, §4.5, §3.4) — the three parts (device-generated recovery key, uncooperative migration, export bundle) only work together, and Level 3 hosts MUST provide all three.

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

Out of the core: Webmention (now a bridge only), OAuth/IndieAuth, standalone JWKS document, profile-HTML link discovery, and **Authorized Fetch — removed entirely in the privacy-and-exit pass, not merely moved** (see spec Appendix E).

## When Editing the Spec

1. **Use RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Backwards compatibility** — pre-1.0, breaking changes allowed to fix security/correctness defects; call them out in the status note. Post-1.0 additive only.
3. **Record the change; do not bump the version.** Add normative changes to spec Appendix E and to
   the status section of this file. The version number marks a release someone outside this
   repository can depend on — there has not been one, so it does not move. See "Current Status."
4. **Keep it minimal** — if it can live in README or an extension doc, it should. Guard the single-signing-construction and single-object-model invariants.
5. **Verify examples and test vectors** — `node tmp/regen.js` regenerates and self-verifies core Appendix D (item, relation item, both manifests, both identity-doc versions) and conventions Appendix C (pins, follows), including that each manifest entry's hash equals its item's full published bytes, **and** reads both published docs to confirm every vector string appears verbatim. It exits non-zero on failure, so a vector that drifts out of sync fails the run instead of sitting stale. Run it after any change touching canonicalization, signing, document shape, or the vectors.
6. **Timestamp consistency** — key/chain fields use Unix seconds (JOSE); content fields use ISO 8601 (JSON Feed).

## When Editing the README

1. Keep the TL;DR under one page.
2. Examples must match the spec's model (identity doc, `_rel`, manifest); don't reintroduce JWKS/profile-links/Webmention-in-core.
3. README explains; spec defines. Link spec section numbers.

## Extension Conventions

- **Field extensions**: prefix with `_` (e.g., `_content_warning`, `_emoji`, `_sha256`). Preserve unknown `_` fields when re-serializing (signatures depend on it).
- **Relation types (`_rel[].type`)**: a registered token (`reply`/`root`/`like`/`repost`/`quote`/`mention`) OR an absolute URL for custom relations (collision-free namespacing). Relation *types* are values, not field names.

## Key Sections Reference

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
| Retained versions (derived URL; no index doc) | 5.4 |
| Pinning / enforcement | 5.3 |
| **The compare rule** (equivocation detection, core MUST) | 5.3.1 |
| Fork resolution (`_recovery_sig`) | 5.5 |
| Signatures (format/header/canon) | 6.1–6.3 |
| Verification / author binding | 6.5–6.6 |
| Feeds & items | 7 |
| Versioning & tombstones | 7.3 |
| Canonical vs copied items (`_feed_url`) | 7.5 |
| Interactions are items (`_rel`) | 8 |
| Threading (`root`) | 8.1 |
| The manifest (chained) | 9 |
| Manifest chain mechanics / cadence + retention / checkpoint | 9.1–9.3 |
| Inbox | 10 |
| Privacy (publish/deliver, audience-of-one) | 11 |
| **Publication is the author's decision** (receivers may not republish delivered items) | 11.1.1 |
| Replies endpoint (published replies only) | conventions §6 |
| Conformance (L0–L3) | 13 |
| Security considerations | 14 |
| Test vectors | Appendix D |
| Design history (what changed) | Appendix E |
| Interop without a bridge (JSON Feed / Atom / h-card → existing bridges) | Appendix F.1 |
| The gateway rule (audience / durability / verification, both directions) | Appendix F.2 |
| Proxy identities (foreign-author attribution) | Appendix F.3 |
| Bridge profile template | Appendix F.5 |
| Export and exit | 15 |
| Follows & pins conventions | Appendix G (pointer) → `open-feed-conventions.md` |
