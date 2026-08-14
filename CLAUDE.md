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
| `open-feed-spec.md` | **The specification.** Core §1–§14; OPTIONAL layers §15 (encrypted content) and §16 (follows/pins/replies conventions); Appendices A–E (media types, aliases + foreign accounts, WebSub, test vectors, gateways) |
| `README.md` | Human-facing docs: examples, protocol comparisons, interop routes, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub |
| `src/` | **Reference verifier** (Level 1, zero dependencies). `canonical.js` is RFC 8785 + a hand-written I-JSON parser, because §6.3's duplicate-member rejection is not something `JSON.parse` can do; `jws.js` is the §6 construction. Node's `crypto` has Ed25519 natively — no `jose`, no `@noble`, no `canonicalize` |
| `test/` | `npm test`. `appendix-d.test.js` extracts vectors from the spec document itself and resolves keys structurally (§4.2); `negative.test.js` is the must-fail corpus Appendix D has none of |
| `tmp/regen.js` | Regenerates and validates Appendix D test vectors |
| `tmp/enc-prototype.js` | Encrypted items; demonstrates the ciphertext-relay attack and §15.2.1's rejection of it |
| `tmp/circles-prototype.js` | Roster spike — models rollback only, **not** withholding |
| `tmp/syndication-prototype.js` | Compares `_syndication` shapes (field / document / receipt) on routing, retraction, retained history |
| `tmp/skiplinks-prototype.js` | Manifest skip links on a 365-version chain; forged-anchor attack |
| `tmp/itempins-prototype.js` | Recipient-scoped `_pins` on items |

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
2. **Guard the invariants.** One signing construction (detached JWS, RFC 7797 `b64:false`, Ed25519,
   over RFC 8785 bytes) everywhere including the optional layers; one object model (every
   interaction is an item with `_rel`); one document. If it can live in README, it should.
3. **Keep the rule, cut the archaeology.** Justification sitting next to a MUST is load-bearing —
   it is what stops the next implementer weakening it, so it stays. A paragraph about what an
   earlier draft got wrong does not.
4. **Run `node tmp/regen.js`** after any change touching canonicalization, signing, document shape,
   or the vectors. It self-verifies signatures and manifest hashes and confirms every vector string
   appears verbatim in the spec. Exits non-zero on drift.
5. **Timestamps** — key/chain fields in Unix seconds (JOSE); content fields in ISO 8601 (JSON Feed).
6. **No changelog appendix, no version bump.** Record the change in the commit.

## Editing the README

README explains; the spec defines. Keep the TL;DR under a page, link spec section numbers, use no
RFC 2119 keywords, and keep examples consistent with the spec's object model.

## Extension conventions

- **Fields**: prefix with `_` (`_content_warning`, `_sha256`). Unknown `_` fields MUST survive
  re-serialization — signatures depend on it.
- **Relation types** (`_rel[].type`): a registered token (`reply`/`root`/`like`/`repost`/`quote`/
  `mention`) or an absolute URL for custom relations. These are values, not field names.

## Open questions (deferred, not forgotten)

- **Circle rosters are not ready to ship** — §15.4 states the gate as four conditions. The prototype
  still needs to model **withholding** (not just rollback), use identity-document-published
  encryption keys, exercise carrier binding on roster-wrapped replies, and measure the identity-doc
  fetches one reply implies.
- **`_syndication` shape** — pending a call on `tmp/syndication-prototype.js`. Leading candidate: a
  §16-mold document, probably unchained (the `follows` precedent). Field and receipt shapes are
  measured and disfavored.
- **`_rel` type registry governance** — decide jointly with Appendix B.2's `proof` tokens; both are
  §2.1 vocabularies and deserve one answer.
- **Key delegation** (`open-feed-delegation.md`, planned, undrafted) — the highest-value trust
  upgrade available. A delegation signed by a root key and published in the identity document lets a
  hub hold only a delegated key; revocation is an ordinary chain version, so the pinned chain is
  exactly the revocation substrate whose absence killed Nostr's NIP-26. Moves hub deployments from
  the key-custodian tier to the serving-path tier, with no second signing construction.
- **Normative bridge profiles** — framework in Appendix E, template in README. Start with the
  syndication class, not Webmention.
- **Author-side dual signing** — parked. The only route to verified cross-protocol authorship. Taking
  it up means deciding whether "one signing construction" governs this protocol's artifacts or
  everything a publisher signs.
- **External time anchoring** (transparency log / witness network) beyond the family-scale `pins`
  convention.
- **Split custody** (hub holds the signing key, client holds only the encryption key) is deliberately
  *not* claimed in the spec: the guarantee holds only when the client is not distributed by the
  custodian, which the reference product does not satisfy.
- **The line budget needs restating.** The spec is ~1080 lines against a 1000-line target, and the
  overage is not duplication — a duplication pass moved the count by ~5, because paragraphs are one
  line each, so only deleting whole blocks moves the number. Core is ~640 lines. Getting under 1000
  means splitting §15/§16 out (against "one document"), cutting justification next to MUSTs
  (forbidden by rule 3), or counting core lines and setting the budget there. The third looks right.
  Do not run another compression pass expecting the number to move.
