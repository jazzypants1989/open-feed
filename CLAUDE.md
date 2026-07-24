# CLAUDE.md - AI Agent Context

## Project Overview

Open Feed Protocol is a minimal specification for decentralized publishing and interaction, targeting families and small groups first but designed to scale across identities. It builds entirely on existing standards (JSON Feed, JOSE/JWS/JWK, JSON canonicalization) and deliberately keeps a small surface.

## File Structure

| File | Purpose |
| ---- | ------- |
| `open-feed-spec.md` | **The specification — one document, source of truth, v0.1.0.** Core §1–§14, plus two OPTIONAL layers: encrypted content (§15) and the follows/pins/replies conventions (§16). Appendices A–E: media types, WebFinger, WebSub, test vectors, gateways |
| `README.md` | Human-friendly docs: examples, protocol comparisons, the interop-without-a-bridge route, the bridge-profile template, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub built on the protocol |
| `CLAUDE.md` | This file — context for AI agents |
| `tmp/regen.js` | Test-vector generator/validator (spec Appendix D). Self-verifies every signature, confirms each manifest entry's hash equals its item's full published bytes, **and** cross-checks every vector string against the published spec. Exits non-zero on drift |
| `tmp/enc-prototype.js` | Encrypted-item probe; CLAIM 5 demonstrates the ciphertext-relay attack and its rejection (spec §15.2.1) |
| `tmp/circles-prototype.js` | Roster spike — models rollback only, **not withholding**; see spec §15.4's status gate |

**Design history lives in git, not in the documents.** The spec had an Appendix E narrating every
removal, and the repo had eleven files of proposal debate; both were deleted in the consolidation
pass. Do not re-add a changelog appendix. Conclusions that are expensive to re-derive belong in
"Decisions taken" below; everything else is `git log`.

## Current Status

**Version 0.1.0 — Draft. Unreleased: nothing here has had a reader outside this repo, and nothing
implements it.** The number is a placeholder for a first release, not a running edit counter.

**Do not bump the version for ordinary normative changes.** An earlier session bumped it per editing
pass, producing a "0.2.0" that claimed on its own first line to be "the second public draft" of a
document nobody had read. Record changes here; move the number only at a release someone outside
this repository can depend on.

Pre-1.0, breaking changes ARE allowed to fix correctness/security defects. After 1.0: additive only.

### Findings worth not re-deriving

Three results cost a lot to reach and are invisible in the finished text:

- **A version-only manifest is undetectably insufficient against a key custodian.** It is fully
  sufficient against a serving-path attacker, which is why it survived many passes. But a host
  holding the signing key can sign one `(id, version)` as two different things for two readers and
  produce *byte-identical manifests* — agreeing pins, no fork, nothing to find. This is why §9
  commits `id → [version, hash]` and not `id → version`.
- **§4.5's device-generated recovery key can be honored to the letter and defeated in full.** A host
  serves the member a genesis document with the member's real recovery key, and serves *everyone
  else* one with a key the host holds. The member's own view is correct, so §5.2's self-record sees
  nothing; at exit the member's co-signature fails against every pin while the host produces a
  competing branch that §5.5 *prefers*. The fix is comparison, not cryptography — hence §5.3.1 and
  the Level 3 genesis disclosure. **Exit's root of trust is a TOFU event the adversary mediates.**
- **Inbound bridging is publication, not observation.** An ingested item lands in the gateway's
  manifested, permanently-retained, CORS-`*` feed, so ingesting one followers-only post is a
  permanent world-readable committed disclosure. Appendix E's inbound half exists for this reason.

### The threat model that drives the design

**The operator of a family hub may be a loved one who is an abuser** — an adversary who controls the
serving path, the inbox, and (by default) the keys. No confidentiality mechanism defeats them; what
the protocol gives them is **exit** (§3.4, §4.5, §14), and all three parts must hold at once.

The second driver is the **two self-hosting family members** persona: it is the modal case for a
URL-native protocol, and it is what makes cross-hub `family` visibility a launch requirement.

## Decisions taken — do not relitigate without new information

- **Migration does not re-sign the back catalog.** An earlier draft ended §3.4 with bulk re-signing,
  because old items' signed `_feed_url` names the old feed. That rewrites the bytes of everything
  the identity ever published, invalidating every hash held in any consumer's manifest pin or peer's
  published pin — a wholesale rewrite of the past, which is the pattern §5.3.1 exists to flag, made
  mandatory on the *exit* path. The fix reuses a rule already present: §3.4 already makes
  predecessor and successor **relation targets** equivalent under a verified migration, so §7.5's
  canonical test now honors a predecessor `_feed_url` the same way. Back catalog moves byte-verbatim;
  hashes survive; zero new consumer state (the predecessor feed URLs are already recorded at
  migration time). Side effect worth keeping: the id/feed binding rule loses its one exception,
  because nothing is re-signed and no id is ever signed with two `_feed_url` values.
- **Likes are delivered, not published** (§8, SHOULD). A `like`'s only reader is the author of the
  liked item, and the inbox already reaches them. Publishing made reactions the dominant driver of
  manifest volume — the problem §9.2's cadence was invented to solve — and wrote §11.4's interaction
  graph into a world-readable file for no reader benefit. Reposts/quotes/mentions/replies stay
  published; the activity feed survives for reposts but is no longer something most identities need.
  Stated cost: a public like *count* becomes the post author's unverifiable assertion.
- **Manifest lag is bounded, and the bound is derived, not declared** (§9.4 invariant 3). §9.2's
  cadence created a standing window in which a host could serve an item to one reader and not
  another with no fork produced, and nothing ever converted "still pending" into "violation." A
  consumer that has walked the chain can read the publisher's real cadence from successive `updated`
  values, so the bound needs no new field: RECOMMENDED max(1h, 2× median of the last 10 intervals).
- **A membership document is not necessarily a published one** (§11.2). §11.2's absolute rule read
  as forbidding what §15.4 recommends shipping first. An author broadcasting to a list only *they*
  address holds it client-side and is unaffected by the roster ship gate; a *published* roster is
  required exactly when someone else — a replier — must wrap to the same audience. This is the
  reference product's critical path, so the distinction is now explicit in both documents.
- **A shared feed gives its contributors no completeness proof** (§7.1). The *owner's* manifest
  commits a multi-author board, so the owner or the owner's host can drop a contributor's items with
  nothing recorded in the contributor's chain — the §9 guarantee running backwards for the family
  persona. Stated rather than fixed: contributors publish to their own manifested feed and the board
  carries copies, which is what DISTRIBUTION-MODEL's client-side aggregate already does. Note that
  multi-author feeds are the *only* capability `_feed_url` uniquely buys, and the reference product
  does not use them.
- **`did:web` is an OPTIONAL alias, not a second identity system** (Appendix B, alongside
  WebFinger). One static `did.json` carrying the same Ed25519 keys makes the key resolvable to
  atproto/DIF/VC tooling. No signature crosses in either direction — this is the operational form of
  "only the key is shareable" from the FEP-8b32 finding. The alias resolves to the identity URL and
  stops there; the identity document remains authoritative.

- **Exit, not confidentiality, is the answer for the hostile-custodian case.** Encryption is offered
  and honestly bounded; it is never marketed as protection from your own host.
- **Cross-hub `family` = published + encrypted.** The feed is a public, manifested, CORS-`*` file of
  ciphertext. Keeps the completeness proof, export, migration, single-valuedness.
- **Audience is hidden** (encrypted roster, untagged JWE recipients). The owner was explicitly
  worried about publishing association graphs.
- **Family interactions are delivered, not published**, so `_rel` never lands in a public file.
  This only holds because §11.1.1 forbids receivers from republishing them; the two are one design.
- **Cleartext delivered-private is audience-of-one (DMs) only.**
- **There is no restricted-feeds mechanism**, and *published but not public* is not a cell that
  exists (§11.1). Serving audience-varying bytes forfeits single-valuedness and with it pin-and-walk.
  Audience control at one host is host authorization — software, not protocol. It could return as a
  pure extension with zero core changes, which is the test that the removal was a real layering.
- **`prev_url` was rejected, and so was the history index that replaced it.** Signed bytes are
  immutable, so `prev_url` would retroactively break the walk for anyone whose pin predates a
  rehost. The derived URL (§5.4) has the same rehosting-safety for the same reason — it is computed
  from where the document is served *now* — at one fewer document type and one fewer round trip.
- **Every listed feed is manifested** (§3.2.1, MUST). Optionality bought a small saving and cost
  three consumer rules, a per-feed conditional in every verifier, and the footgun of real content
  silently unproven. §9.2's time-based cadence solves the activity-feed problem instead.
- **The "transparency/confidentiality theorem" is false** and was not adopted — its own 2×2 contains
  the counterexample (published+encrypted has both). The corrected statement is over
  *existence*-privacy.
- **"Binding symmetry" was rejected**; the real defect next door (`_sha256` as SHOULD) was fixed.
- **Self-monitoring as a security rule was rejected**: evadable by targeted equivocation, undefined
  baseline under split custody, and its stated response is a recovery key the adversary generated.
  The diagnosis survives as a producer MUST to record published `(seq, hash)` (§5.2) plus the
  compare rule (§5.3.1) and third-party pins (§16).
- **`follows`+`pins` merge rejected** — conflates two disclosure decisions and prices
  anti-equivocation in social-graph disclosure.
- **Replies endpoint keeps its own URL**, reframed as a *view over the inbox*, and lives in the
  optional conventions layer (§16.4) rather than the core. It was moved rather than deleted because
  an implementer who wants thread discovery will build *something*, and §11.1.1's guard should
  travel with it (§16.4.1).
- **Bridged content is always `_unverified`** — no exception, no second form. An earlier "or authored
  by a disclosed gateway identity" branch generated a three-lane trust structure and a collision
  with §12's exit MUSTs; both vanished when the branch was deleted.
- **FEP-8b32 does not converge with Open Feed signing**, though three documents once claimed it did.
  Same curve (Ed25519) and canonicalization (RFC 8785), but `eddsa-jcs-2022` signs
  `SHA256(proofConfig) ‖ SHA256(doc)` while Open Feed signs the JWS signing input directly. No
  signature crosses in either direction; only the *key* is shareable.
- **Author-side dual signing is parked, not rejected** — the only route to verified cross-protocol
  authorship, and the two signing inputs are structurally unconfusable (an Open Feed signing input
  always begins with the ASCII prefix `eyJhbGciOiJFZERTQSI`; an `eddsa-jcs-2022` input is exactly
  64 bytes). Taking it up means deciding whether "one signing construction" governs *this protocol's
  artifacts* or *everything an Open Feed publisher signs*. Not blocking anything.

## The Object Model (read this before editing anything)

```
{identity_url}/               ← identity URL (optional human page; nothing reads it)
{identity_url}/openfeed.json  ← IDENTITY DOCUMENT: signed; profile + keys + feeds[] + version chain
{identity_url}/openfeed/{seq}.json  ← retained prior versions, DERIVED path (§5.4)
{identity_url}/feed.json      ← JSON Feed 1.1, signed items
{identity_url}/manifest.json  ← signed, CHAINED commitment to feed contents (items → [version, hash])
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

- **Circle rosters are not ready to ship** (§15.4 states the gate as four conditions). Before
  offering them, a prototype must model **withholding** (not just rollback — `tmp/circles-prototype.js`
  covers only rollback), use identity-document-published enc keys, exercise carrier binding on
  roster-wrapped replies, and measure the N identity-doc fetches a single reply implies.
- `_rel` type registry governance pre-1.0
- Key delegation extension (`open-feed-delegation.md`, planned, not drafted) — the highest-value
  trust upgrade available. A delegation is a statement signed by a root identity key
  (`{delegate: {JWK}, kid, exp, scope}`) published in the identity document; a hub or extra device
  holds only the *delegated* key while the root stays client-side or offline. Verifiers resolve the
  `kid` to the delegation entry in the pinned identity document. Revoking a delegate is an ordinary
  chain version — the pinned chain is exactly the authoritative revocation substrate whose absence
  killed Nostr's NIP-26. One statement type answers both multi-device *and* hub custody (moving hub
  deployments from the key-custodian tier to the serving-path tier of §13.2) with no second signing
  construction.
- External time anchoring (transparency log / witness network) beyond the family-scale `pins`
  convention
- Normative bridge profiles (Webmention / ActivityPub / atproto / Nostr). The framework is Appendix E
  and the template is in README, so a profile is a filled-in table rather than a fresh trust
  argument. **Do the no-bridge route first**: an Atom mirror + h-card reaches the fediverse via
  existing bridges (Bridgy Fed) with nothing in this repo implemented, and its bridged handle is
  already `@yourdomain.com` — the identity URL — so no mapping exists to design. That may make the
  Webmention profile optional rather than the starting point. Two things have since narrowed what a
  profile has to cover: `did:web` (Appendix B) fixes the atproto identity seam without a profile,
  and Appendix E now states that the **directions are separable** — outbound notification of your
  own published items mints no proxy identity, ingests nothing, and needs none of the inbound
  machinery, so a "Webmention profile" is really just the inbound half.
- Author-side dual signing — parked, see "Decisions taken"
- **Split custody** (hub holds the signing key, client holds only the enc key) is an attractive
  product pattern and is *not* claimed in the spec, because its guarantee holds only when the client
  is not distributed by the custodian — which the reference product does not currently satisfy

## Key Design Decisions (intentional, not oversights)

- **Identity = HTTPS URL** — not DIDs, not handles. URLs are universal and owned. WebFinger gives optional `@user@domain` discovery (Appendix B). Trade-off: weaker account portability than atproto's DID indirection (§13.15) — partly offset by making exit a first-class feature (§14).
- **One signed document per identity** — `openfeed.json`. No HTML parsing in the trust chain, no link-relation discovery, no cross-document key-ownership check (key ownership is structural).
- **Keys = JWK inside the identity document** — Ed25519 `OKP` for signing. `kid` in JWS headers = `{identity_url}#{kid}` (split at last `#`). The `crv`/`use` constraints bind **signing** keys only, which is what lets §15 define an encryption key type without a core change.
- **Signatures = one construction** — detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes. Signs header AND payload. Byte-exact (no verify-time normalization; producers emit NFC); duplicate JSON keys rejected (I-JSON). **This is the only construction anywhere, core and optional layers.** Encryption is not a second construction: it changes what the content *is*, not how it is signed.
- **One object model** — like/reply/repost/quote/mention are all items with `_rel`. One schema, one update mechanism (versioning), one delete mechanism (tombstones), one verifier.
- **The feed is the source of truth; the inbox is a push cache.** Nothing exists only in transit — with one stated exception, delivered-private content (§11.1), which is why that is scoped to audience-of-one.
- **Canonical vs copy (`_feed_url`, §7.5)** — an item is canonical only in the feed its signed `_feed_url` names. Manifest proves presence; `_feed_url` proves exclusivity. Neither covers content carried *by reference* — hence `_sha256` MUST (§7.4).
- **Migration = recovery** (§3.4) — one operation, differing only in which key attests. Path 3 (recovery co-signature) is the exit path and works without the old host's cooperation.
- **Honest trust model** (§13.2) — four adversary tiers. The fourth (hostile custodian who is also the counterparty) is not on the technical gradient and is answered by exit, not by cryptography.
- **No privacy mechanism in the core** (§11) — privacy is a publication decision (publish vs deliver), and audience control at one host is host authorization, i.e. software. Confidentiality is OPTIONAL (§15) and bounded by recipient key custody.
- **Exit is a first-class feature** (§14, §4.5, §3.4) — the three parts (device-generated recovery key, uncooperative migration, export bundle) only work together, and Level 3 hosts MUST provide all three.

## Standards Adopted

| Standard | RFC/Spec | Usage in Open Feed |
| -------- | -------- | ------------------ |
| JWK | RFC 7517 | Public keys (inside identity doc) |
| JWS | RFC 7515 | Signature format |
| JWS Unencoded Payload | RFC 7797 | Detached `b64:false` signing |
| JSON Canonicalization | RFC 8785 | Pre-signing serialization |
| I-JSON | RFC 7493 | Duplicate-key rejection |
| Ed25519 (EdDSA) | RFC 8032 | Signature algorithm; test vectors |
| JWE | RFC 7516 | Encrypted item content (`_enc`, §15) |
| X25519 / OKP | RFC 8037 | Encryption keys, ECDH-ES (§15) |
| WebFinger | RFC 7033 | Optional `@user@domain` discovery |
| did:web | W3C DID Core | Optional key-resolvability alias (Appendix B); no signature crosses |
| JSON Feed | 1.1 | Feed format |
| WebSub | W3C Rec | Optional real-time (via JSON Feed `hubs`) |

Out of the core: Webmention (a bridge only), OAuth/IndieAuth, standalone JWKS document,
profile-HTML link discovery, and Authorized Fetch (removed entirely, not moved — see "Decisions
taken," restricted feeds).

## When Editing the Spec

1. **Use RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Backwards compatibility** — pre-1.0, breaking changes allowed to fix security/correctness defects. Post-1.0 additive only.
3. **Record the change here; do not bump the version.** There is no changelog appendix and should not be one; git holds the history. The version marks a release someone outside this repository can depend on.
4. **Keep it minimal, and keep it one document.** If it can live in README, it should. Guard the single-signing-construction and single-object-model invariants.
5. **Keep the rule, cut the archaeology.** A sentence that stops an implementer weakening a MUST stays; a paragraph explaining what a previous draft got wrong does not.
6. **Verify test vectors** — `node tmp/regen.js` regenerates and self-verifies Appendix D (item, relation item, both manifests, both identity-doc versions, pins, follows), confirms each manifest entry's hash equals its item's full published bytes, **and** reads the spec to confirm every vector string appears verbatim. Exits non-zero on failure. Run it after any change touching canonicalization, signing, document shape, or the vectors.
7. **Timestamp consistency** — key/chain fields use Unix seconds (JOSE); content fields use ISO 8601 (JSON Feed).
8. **Watch the line budget.** The spec is deliberately under 1000 lines. Additions should displace, not accumulate.

## When Editing the README

1. Keep the TL;DR under one page.
2. Examples must match the spec's model (identity doc, `_rel`, manifest); don't reintroduce JWKS/profile-links/Webmention-in-core.
3. README explains; spec defines. Link spec section numbers. README should not carry RFC 2119 keywords.

## Extension Conventions

- **Field extensions**: prefix with `_` (e.g., `_content_warning`, `_emoji`, `_sha256`). Preserve unknown `_` fields when re-serializing (signatures depend on it).
- **Relation types (`_rel[].type`)**: a registered token (`reply`/`root`/`like`/`repost`/`quote`/`mention`) OR an absolute URL for custom relations (collision-free namespacing). Relation *types* are values, not field names.

## Key Sections Reference

| Topic | Spec Section |
|-------|--------------|
| Identity URL normalization | 3.1 |
| Identity document | 3.2 |
| Feed entries (`feeds[]`, every feed manifested) | 3.2.1 |
| Fetching / redirects | 3.3 |
| Migration & recovery (one op) | 3.4 |
| Keys / key identifiers | 4.1–4.2 |
| Rotation / revocation | 4.3–4.4 |
| Recovery keys (device generation + genesis disclosure) | 4.5 |
| Version chain (identity) | 5 |
| Pinning / enforcement | 5.3 |
| **The compare rule** (equivocation detection, Level 1 MUST) | 5.3.1 |
| Retained versions (derived URL; no index doc) | 5.4 |
| Fork resolution (`_recovery_sig`) | 5.5 |
| Signatures (format/header/canonicalization) | 6.1–6.3 |
| Verification / author binding | 6.5–6.6 |
| Feeds & items | 7 |
| Versioning & tombstones (allowlist) | 7.3 |
| Canonical vs copied items (`_feed_url`) | 7.5 |
| Interactions are items (`_rel`) | 8 |
| Threading (`root`) | 8.1 |
| The manifest (chained, `id → [version, hash]`) | 9 |
| Manifest chain mechanics / cadence + retention / checkpoint | 9.1–9.3 |
| Inbox | 10 |
| Privacy (publish/deliver, audience-of-one) | 11 |
| **Publication is the author's decision** (receivers may not republish delivered items) | 11.1.1 |
| Conformance (L0–L3) | 12 |
| Security considerations (four adversary tiers at 13.2) | 13 |
| Export and exit | 14 |
| **Encrypted content (OPTIONAL)** — key lifecycle, envelope, carrier binding, rosters | 15 |
| Carrier binding (the ciphertext-relay defence) | 15.2.1 |
| Rosters + the four-condition ship gate | 15.4 |
| **Conventions (OPTIONAL)** — follows, pins, replies | 16 |
| Consuming pins (anti-equivocation, recovery propagation, timestamping, TOFU corroboration) | 16.2 |
| Replies endpoint (published replies only) | 16.4–16.4.1 |
| Media types / identifier aliases (WebFinger, did:web) / WebSub | Appendix A / B / C |
| Test vectors | Appendix D |
| Gateways: the one rule, both directions, proxy identities | Appendix E |
