# CLAUDE.md - AI Agent Context

## Project Overview

Open Feed Protocol is a minimal specification for decentralized publishing and interaction, targeting families and small groups first but designed to scale. It builds entirely on existing standards (JSON Feed, JWS/JWK, OAuth 2.0, Webmention, WebFinger, WebSub).

## File Structure

| File                | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `open-feed-spec.md` | Normative specification (source of truth)              |
| `README.md`         | Human-friendly docs, examples, implementation guidance |
| `CLAUDE.md`         | This file - context for AI agents                      |

## Key Design Decisions

These are intentional choices, not oversights:

- **Identity = HTTPS URL** - Not DIDs, not handles. URLs are universal and owned. WebFinger provides optional `@user@domain` discovery.
- **Keys = JWKS (RFC 7517)** - Standard JSON Web Key Sets. Not custom format. Every JWT library can parse it.
- **Signatures = Ed25519 + JWS** - Not HTTP Signatures (ActivityPub). JWS is simpler and better specified.
- **Feeds = JSON Feed 1.1** - Not Atom, not custom format. JSON Feed is readable and extensible.
- **Extensibility = `_` prefix, not JSON-LD** - JSON-LD solves vocabulary collision but breaks byte-exact signing (no canonical serialization without RDF canonicalization) and requires remote context resolution. Open Feed signs raw bytes (RFC 8785) and uses JSON Feed's `_` extension convention instead.
- **Canonicalization = byte-exact RFC 8785** - No verify-time Unicode normalization (producers emit NFC); duplicate JSON keys rejected (I-JSON). Signatures cover exactly the bytes published.
- **Multi-author feeds** - Feeds can have multiple authors; each item is signed by its author.
- **Delivery = Inbox + Webmention** - Two options: rich signed objects to inbox, or W3C Webmention for broader compatibility.
- **Hub-managed keys OK** - For family hubs, simplicity beats security theater. Trust model is documented.
- **Nested threading** - Replies can reference other replies via `_in_reply_to`, enabling nested conversations.
- **Timestamp formats** - JWK fields use Unix seconds (JWT convention), content fields use ISO 8601 (JSON Feed convention).

## Current Status

**Version 0.5.1 - Draft**

New in v0.5.1 (correctness & security patches from review):
- **Webmention author trust strengthened (§7.2.2)** - Same-origin was insufficient for path-based identities (any page on a shared host could impersonate any identity on that host, e.g. `~dad` claiming `~mom`). The claimed identity URL (normalized, trailing slash intact) must now be a **string prefix** of the `source` URL. Breaking change to a MUST, justified as a security fix.
- **Chain continuity key retention (§3.7.2, §3.7.3, §3.4)** - The continuity key MUST remain listed in the chain version it signs; §3.7.3 step 1 ("verify `_sig` against a key it contains") was previously unsatisfiable if a producer dropped the rotated-out key. History-walk verification now explicitly re-checks the continuity rule at each hop.
- **`_prev` hashing disambiguated (§3.7.1, §3.7.6)** - `_prev` covers the full published predecessor including `_sig` **and** `_recovery_sig` when present.
- **`htu` resource-URL normalization defined (§8.2.2)** - §2.1 identity normalization (which appends a trailing slash) would corrupt paths like `/feed.json`; `htu` now has its own rule: lowercase scheme/host, drop default port, strip query/fragment, path byte-exact.
- **Removed nonstandard `449` Webmention status (§7.2.4)** - Not part of the W3C spec; use `400`.
- **F.8 test vector regenerated with a distinct `key-2`** - Previously `key-2` reused `key-1`'s public key, so key-confusion bugs couldn't be caught. `key-2` is now RFC 8032 test vector 2. Genesis and `_prev` unchanged; `_seq:2` bytes and `_sig` recomputed and self-verified.
- **Appendix B note** - Link relations defined here are not IANA-registered; registration or URL-form relations planned pre-1.0.

New in v0.5.0 (fixes & additions from review):
- **Canonicalization is byte-exact** - Verify-time NFC normalization removed (§4.3); producers SHOULD emit NFC. Stock RFC 8785 libraries are now conformant as-is. Duplicate JSON member names MUST be rejected (I-JSON, RFC 7493). Test vectors in Appendix F were already NFC and remain valid.
- **Key History Chain fixes** - The §3.7.1 example now follows the §3.7.2 continuity rule (a new version is signed by a key valid in the *previous* version — normally the key being revoked; now stated explicitly). Added §3.7.5 chain history retrieval (`_history_url`): without it, the §3.7.3 pin-walking MUST was unsatisfiable after two rotations between fetches. Added §3.7.6 fork resolution via recovery co-signature (`_recovery_sig`) — resolves which branch of an equivocation is honest, since the thief lacks the offline recovery key.
- **Item tombstones (§5.4.1)** - Feed items are deleted by publishing a signed `_deleted: true` version (same `id`, bumped `_version`, empty `content_text`). Previously only interactions could be deleted.
- **Interaction `content` is plain text (§6.1)** - Receivers MUST escape it; HTML rendering is the displayer's job.
- **Webmention author trust (§7.2.2)** - For unsigned sources, the claimed author identity MUST be same-origin with the `source` URL (h-card authorship is self-asserted; without this, any page could impersonate any identity). *(Strengthened to a path-prefix rule in v0.5.1.)*
- **Authorized Fetch polish (§8.2)** - 60s clock-skew leeway on `iat`/`exp`; `htu` query-string exclusion documented as intentional; `WWW-Authenticate` challenge `error` params defined; format explicitly aligned with DPoP (RFC 9449).

New capabilities in v0.4.0:
- **Authorized Fetch (section 8.2)** - Cross-hub reading of restricted-visibility feeds via a short-lived self-signed EdDSA JWT (binds method + URL, replay-guarded). No shared secrets; reuses existing keys. This is what makes cross-hub family/private feeds work.
- **Key History Chain (section 3.7)** - Optional tamper-evident JWKS versioning (`_seq`/`_prev`/`_updated`/`_sig`). Consumers pin on first observation and detect key rollback/equivocation; makes revocation and recovery verifiable rather than advisory.

Recent changes in v0.4.0 (correctness & security hardening):
- **Signatures now cover the header** - Adopted RFC 7797 (JWS unencoded payload, `b64:false`, `crit:["b64"]`). The previous "sign the payload bytes only" construction was not a valid JWS and left `alg`/`kid` unauthenticated (section 4.1, 4.2, 4.4).
- **Author binding** - Signed feed items MUST include an item-level `authors` array (in the signed bytes); feed-level authors are not signed. Prevents republishing another identity's signed content under a forged author (section 4.6, 5.2).
- **Key-ownership check** - Verifiers MUST confirm the `kid`'s JWKS URL is advertised by the *claimed author's* profile; possession of a public key is not identity ownership (section 4.5 step 5, 7.1.3).
- **Effective signing time** - `iat`/`revoked_at` checks use `date_modified` if present, else `date_published`/`published`, so legitimate re-signing after rotation isn't rejected (section 4.5).
- **Real test vectors** - Appendix F regenerated with computed, self-verifying values (the old SHA-256 was the empty-string hash and the private-key hex was wrong).
- **Resolved contradictions** - id-reuse for delete/update (6.1/6.4/6.5), cross-origin redirect vs migration (2.3), Level-1 "send" in the matrix (9.2), field injection into signed objects in the replies/outbox responses (7.4.2/7.5.2).
- **Content-Type** - MUST accept `application/json` (static hosts serve `.json` that way); only `text/html`/non-JSON is rejected (9.5).
- **New security sections** - Inbox fetch amplification (10.11) and revocation-vs-self-reported-timestamps (10.12).

Additions in v0.3.0:
- **Conformance levels** - Three tiers: Read (Level 1), Publish (Level 2), Interact (Level 3)
- **Recovery keys** - Mechanism for identity succession when domain is lost (section 3.6)
- **Replies endpoint** - Standardized thread discovery via `rel="replies"` (section 7.4)
- **Outbox endpoint** - Sent interaction history via `rel="outbox"` (section 7.5)
- **Reply publication model** - Dual publication to feed AND inbox for discoverability (section 6.2.1)
- **Expanded security considerations** - SSRF, resource limits, enumeration, signature stripping (section 10)
- **Test vectors** - Canonicalization and signature examples (Appendix F)

Previous additions (v0.2.0):
- Multi-author feed support
- Nested threading via `_in_reply_to`
- WebSub real-time updates (Appendix E)
- Error response format standardization
- Transient failure handling guidance
- Content-Type strictness (MUST instead of SHOULD)

## Resolved Questions

These were resolved in v0.2.0:

- **Threading model**: Nested replies supported via `_in_reply_to` field. Clients can display flat or nested.
- **Multi-author feeds**: Supported. Feed-level `authors` array lists all permitted authors; item-level `authors` specifies who wrote that item.
- **Interaction updates vs replay prevention**: Resolved by allowing same ID with later timestamp to replace previous version.
- **Missing `iat` handling**: If `iat` is not present, skip the issued-at check (assume key existed).
- **Fragment handling**: Fragments are stripped from identity URLs during normalization.

These were resolved in v0.3.0:

- **Thread discovery**: Solved via `rel="replies"` endpoint (section 7.4). Author can expose replies for their items.
- **Identity portability**: Recovery keys (section 3.6) allow succession when domain is lost.
- **Outbox symmetry**: `rel="outbox"` provides history of sent interactions (section 7.5).
- **Reply discoverability**: Dual publication model (section 6.2.1) - publish to feed AND deliver to inbox.
- **Conformance ambiguity**: Three explicit levels define what static vs server implementations must support.
- **Security gaps**: Expanded section 10 with SSRF, resource limits, enumeration, signature stripping.

## Open Questions (not yet resolved)

These are intentionally deferred, not forgotten:

- WebSub integration for inbox notifications (feed updates covered in Appendix E)
- ActivityPub/AT Protocol bridge specifications
- Transparency logs / witness networks for high-security identity verification
- Formal following/subscription list format (convention exists in README, not normative)
- `_history_url` document format for **item** version history (the JWKS-chain history format is now defined in spec §3.7.5)
- Block list interchange between hubs
- Feed-level signature (or signed item manifest) so a serving host can't silently omit/reorder items — wire-format change, should be decided pre-1.0
- Social-graph witnessing: members publish observed `(identity, _seq, hash)` pins so a family cross-checks each other's key chains without a transparency log
- Signed export bundle format (feed pages + JWKS chain + interactions) for backup/migration
- Multi-device key distribution for client-side-key users

## Standards Adopted

| Standard              | RFC/Spec | Usage in Open Feed               |
| --------------------- | -------- | -------------------------------- |
| JWK/JWKS              | RFC 7517 | Public key documents             |
| JWS                   | RFC 7515 | Signature format                 |
| JWS Unencoded Payload | RFC 7797 | Detached `b64:false` signing     |
| JWT                   | RFC 7519 | Key timestamps; fetch assertions |
| JSON Canonicalization | RFC 8785 | Pre-signing serialization        |
| I-JSON                | RFC 7493 | Duplicate-key rejection          |
| DPoP (modeled on)     | RFC 9449 | Authorized Fetch assertion shape |
| WebFinger             | RFC 7033 | `@user@domain` discovery         |
| Webmention            | W3C Rec  | Alternative interaction delivery |
| WebSub                | W3C Rec  | Real-time feed updates           |
| JSON Feed             | 1.1      | Feed format                      |
| OAuth 2.0 / IndieAuth | RFC 6749 | Authentication                   |

## When Editing the Spec

1. **Use RFC 2119 keywords** - MUST, MUST NOT, SHOULD, SHOULD NOT, MAY
2. **Backwards compatibility** - Prefer additive changes. Pre-1.0, breaking changes ARE allowed when needed to fix a security or correctness defect (e.g., the v0.4.0 signing-construction fix) - call these out explicitly in the version notes. After 1.0, additive only.
3. **Update version number** - Any normative change requires version bump
4. **Keep it minimal** - If it can be in README, it should be in README
5. **Verify examples** - Every code block in spec must be valid
6. **Timestamp consistency** - JWK fields use Unix seconds, content fields use ISO 8601

## When Editing the README

1. **Keep TL;DR under 1 page** - This is the entry point for new readers
2. **Examples must match spec** - Copy from spec, don't improvise
3. **Link to spec sections** - README explains, spec defines
4. **Update concerns section** - If you solve a concern, note the resolution

## Extension Conventions

- **Field extensions**: Prefix with `_` (e.g., `_content_warning`, `_in_reply_to`)
- **Interaction types**: Prefix custom types with `x-` (e.g., `x-emoji-react`)
- **Preserve unknown fields**: Implementations MUST preserve unknown `_` fields when re-serializing

## Testing Approach

Implemented:
- Test vectors for canonicalization and signature verification (Appendix F)

Planned (not yet implemented):
- JSON Schema validation for all document types
- Conformance test suite for hubs and clients
- Reference implementations (open-feed-hub, open-feed-client)

## Common Tasks

### Adding a new interaction type

1. Add to spec section 6.2 with MUST/SHOULD requirements
2. Add example to README
3. Update CLAUDE.md if it affects design decisions

### Adding an extension field

1. Document in README under Extensions (not spec)
2. Add example showing usage
3. Consider if it should graduate to spec in future version

### Fixing ambiguity in spec

1. Clarify with minimal wording change
2. Add non-normative note if helpful
3. Bump patch version (0.2.x)

## Key Sections Reference

| Topic | Spec Section |
|-------|--------------|
| Identity URL normalization | 2.1 |
| Profile metadata | 2.4 |
| JWKS format | 3.1 |
| Recovery keys | 3.6 |
| Key History Chain | 3.7 |
| Chain history retrieval | 3.7.5 |
| Fork resolution (`_recovery_sig`) | 3.7.6 |
| Signature format (RFC 7797) | 4.1 |
| Signature verification | 4.5 |
| Author binding | 4.6 |
| Feed ownership | 5.1.1 |
| Multi-author items / author binding | 5.2 |
| Item tombstones | 5.4.1 |
| Interaction types | 6.2 |
| Reply publication | 6.2.1 |
| Replay prevention | 6.3 |
| Threading | 6.6 |
| Inbox verification | 7.1.3 |
| Error responses | 7.1.6 |
| Replies endpoint | 7.4 |
| Outbox endpoint | 7.5 |
| Authorized Fetch (restricted feeds) | 8.2 |
| Conformance levels | 9.1 |
| Security considerations | 10 |
| Test vectors | Appendix F |
| WebSub | Appendix E |
