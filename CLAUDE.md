# CLAUDE.md

## Rules for this file

**This file is orientation, not a record. The spec is the source of truth; `git log` is the history.**

Do not add to this file:

- Anything the spec already says. If a rule is in `open-feed-spec.md`, read it there. A shadow copy
  here goes stale and then contradicts the spec.
- Anything that happened. What a previous draft got wrong, what a pass fixed, what was proposed and
  rejected, what you just changed — that is the commit message. Write it there instead.
- A changelog, a "recent changes" section, or a bullet per session.

Add something only if a future agent would make a **worse decision** without it *and* it is not
already in the repo. That is a narrow gate. This file should get shorter more often than longer.

## What this is

Open Feed Protocol: a minimal specification for decentralized publishing and interaction, aimed at
families and small groups first but designed to scale across identities. Built entirely on existing
standards (JSON Feed, JOSE/JWS/JWK, RFC 8785 canonicalization), with a deliberately small surface.

| File | Purpose |
| ---- | ------- |
| `open-feed-spec.md` | **The specification.** Core §1–§14; OPTIONAL layers §15 (encrypted content) and §16 (item-carried pins); Appendices A (media types), B (test vectors), C (gateways) |
| `README.md` | Human-facing docs: examples, protocol comparisons, interop routes, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub |
| `src/` | **Reference implementation**, zero dependencies: Level 1 verifier and Level 2 publisher. `canonical.js` is RFC 8785 + a hand-written I-JSON parser, because §6.3's duplicate-member rejection is not something `JSON.parse` can do; `jws.js` is the §6 construction; `chain.js` is §5.3's walk for both chained documents; `manifest.js` is §9.3; `publish.js` emits every artifact as bytes. **`fetch.js` is the only module that opens a socket — keep it that way.** Node's `crypto` has Ed25519 natively — no `jose`, no `@noble`, no `canonicalize` |
| `test/` | `npm test`. `vectors.test.js` extracts vectors from the spec document itself and resolves keys structurally (§4.2); `negative.test.js` is the must-fail corpus Appendix B has none of; `e2e.test.js` runs the publisher against the verifier over a real TLS socket, with `helpers/tls.js` hand-encoding the certificate because §3.1 makes HTTPS part of the identity |
| `tmp/regen.js` | Regenerates and validates Appendix B test vectors |
| `tmp/enc-prototype.js` | Encrypted items; demonstrates the ciphertext-relay attack and §15.2.1's rejection of it |
| `tmp/syndication-prototype.js` | Compares `_syndication` shapes (field / document / receipt) on routing, retraction, retained history |
| `tmp/skiplinks-prototype.js` | Manifest skip links on a 365-version chain; forged-anchor attack |
| `tmp/itempins-prototype.js` | `_pins` on items — the disclosure and byte measurements behind §16.1 |

## The threat model that drives the design

**The operator of a family hub may be a loved one who is an abuser** — an adversary who controls the
serving path, the inbox, and (by default) the keys. No confidentiality mechanism defeats them; the
protocol answers with **exit** (§3.4, §4.5, §14), and its three parts must hold together. The second
driver is the **two self-hosting family members** persona, which is what makes cross-hub `family`
visibility a launch requirement.

Read §13.2 before touching anything security-relevant.

## Version policy

**0.1.0 — Draft, unreleased.** Nothing here has had a reader outside this repo; nothing implements it.

**Do not bump the version for ordinary changes.** The number marks a release someone outside this
repository can depend on, not an edit counter. Pre-1.0, breaking changes ARE allowed to fix
correctness or security defects; post-1.0, additive only.

## Editing the spec

1. **RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Guard the simplicity.** The spec's value is how little of it there is: one way of doing each
   thing, stated once, whatever the current shape of those things happens to be. Resist a second
   construction, a second model, or a second document growing up beside the first. If it can live
   in README, it should.
3. **Keep the rule, cut the archaeology.** Justification sitting next to a MUST is load-bearing —
   it is what stops the next implementer weakening it, so it stays. A paragraph about what an
   earlier draft got wrong does not.
4. **Run `node tmp/regen.js`** after any change touching canonicalization, signing, document shape,
   or the vectors. It self-verifies signatures and manifest hashes and confirms every vector string
   appears verbatim in the spec. Exits non-zero on drift.
5. **Timestamps** — key/chain fields in Unix seconds (JOSE); content fields in ISO 8601 (JSON Feed).
6. **No changelog appendix, no version bump.** Record the change in the commit.
7. **There is no line budget. Do not reintroduce one.** It was retired deliberately: a line count
   measures the wrong thing, and chasing it pushes toward exactly the two edits this file forbids —
   splitting the document up, and cutting the justification that sits next to a MUST. The real
   target is **the shortest spec that still covers its bases**, and the lever that actually moves
   it is design, not compression. Removing an equivocation between two sections is worth more than
   removing fifty lines.

## Editing the README

README explains; the spec defines. Keep the TL;DR under a page, link spec section numbers, use no
RFC 2119 keywords, and keep examples consistent with the spec's object model.

## Extension conventions

- **Fields**: prefix with `_` (`_content_warning`, `_sha256`). Unknown `_` fields MUST survive
  re-serialization — signatures depend on it.
- **Relation types** (`_rel[].type`): a registered token (`reply`/`root`/`like`/`repost`/`quote`/
  `mention`) or an absolute URL for custom relations. These are values, not field names.
