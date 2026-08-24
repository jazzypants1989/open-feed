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
| `open-feed-spec-2.md` | **The redesigned specification (Open Feed 2)** — the Cutting Campaign's product, reviewed and ruled 2026-08-23 (`tmp/redesign/REVIEW-spec2.md`, RULINGS §13–14). Identity is a genesis key; files are `body\n<sig>` with no canonicalization; one hop shape carrying its court; the head with one-hash-per-number; the envelope with carrier AAD; a PUT interface with verified writes. Beside the old spec until the swap (docs must catch up first) |
| `src2/` · `test2/` | **The spec-2 reference implementation**, zero dependencies, and its suite. `file.js` is §3 (the strict parser lives here); `profile.js` §4 (walk, courts, contest); `head.js` §5; `envelope.js` §7 + sealed photos; `spoken.js` + `wordlist.js` §4.1 (BIP-39 as data); `reader.js` §8 over an injected fetcher; **`fetch.js` is the only src2 module that opens a socket** (`addresses.js` shared logic, ported verbatim); `publish.js` §9-client + §11 (it keeps every byte it writes); `hub.js` §9-server as a pure handler (verifies profile/head on write); `views.js` §12; `cli.js`/`bin/openfeed2.js`. `test2/scenarios.test.js` stages GOALS.md's scenarios; `tmp/regen2.js` verifies Appendix B with **both** readers (src2 and the weekend instrument) and the envelope byte-for-byte |
| `open-feed-spec.md` | **The old specification** (superseded in design, still what `src/`+`test/` implement). Core §1–§14; layered §15 (encrypted content — required by no level, REQUIRED of any deployment offering audience-restricted content) and §16 (item-carried pins — emission a Level 3 MUST, heeding optional); Appendices A (media types), B (test vectors), C (gateways) |
| `README.md` | Human-facing docs: examples, protocol comparisons, interop routes, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub |
| `src/` | **Reference implementation**, zero dependencies: Level 1 verifier, Level 2 publisher, Level 3 inbox, plus §14 export and the §15 layer. `canonical.js` is RFC 8785 + a hand-written I-JSON parser, because §6.3's duplicate-member rejection is not something `JSON.parse` can do; `jws.js` is the §6 construction; `chain.js` is §5.3's walk for both chained documents; `manifest.js` is §9.3; `migration.js` is §3.4 — predecessor equivalence held once and asked by every site that needs it, plus §4.5's **recovery pin** — `(url, seq, hash)` and the keys committed there, which is what a co-signature resolves against and what §7.5's exception needs, rather than the whole document; `publish.js` emits every artifact as bytes; `reader.js` composes the lot into the Level 1 consumer, and the *order* is its content — identity chain before manifest, manifest before items; `cli.js` is that reader as a command; `inbox.js` is §10 as a function rather than a server, because §10.2's *ordering* is the security property and a socket hides it — it reports its own outbound fetch count for that reason; `export.js` is §14, and it deliberately contains no verifier: `restoreFetcher` is a fetcher over a bundle's contents and `verifyBundle` is `createReader` unchanged, which is how §14's "nothing about verification changes" is checked rather than asserted; `enc.js` is §15 and touches nothing else — one shared ephemeral, blinded per-recipient tags, and §15.2.1's carrier binding at the decrypting client. **`fetch.js` is the only module that opens a socket — keep it that way.** Node's `crypto` has Ed25519 natively — no `jose`, no `@noble`, no `canonicalize` |
| `bin/openfeed.js` | `openfeed verify <identity-url> [--pins FILE]`. A shim over `src/cli.js`, which takes argv, streams, and its reader as arguments so the command is testable as a function |
| `test/` | `npm test`. `vectors.test.js` extracts vectors from the spec document itself and resolves keys structurally (§4.2); `negative.test.js` is the must-fail corpus Appendix B has none of; `migration.test.js` drives §3.4 through the composed reader across two origins, and its last case pins the false accusation the module exists to stop — a verifier ignorant of migration reports a carried back catalog as *withheld*; `e2e.test.js` drives the layers against each other over a real TLS socket and `reader.test.js` drives the composed reader the same way — most of it **twice**, because pinning is what §12 makes a MUST and one run proves nothing. `inbox.test.js` asserts on outbound fetch counts and on the dedup store rather than on status codes, because §10.2's ordering and §10.3's write-before-verify rule return the same code whether obeyed or not; `export.test.js` restores with no network and its last case is the whole exit — migrate, export, restore, with the host refusing to help; `enc.test.js` runs the *unchanged* verifier over encrypted items, since "no new signing construction" is falsifiable. `helpers/site.js` is the shared origin (certificate hand-encoded in `helpers/tls.js`, since §3.1 makes HTTPS part of the identity) |
| `tmp/regen.js` | Regenerates and validates Appendix B test vectors |
| `tmp/check-prototypes.js` | `npm run prototypes`. Runs every gate in `tmp/prototypes/` (seconds, since the gates replaced the old minutes-long prototypes) and fails if any no longer holds; writes `tmp/prototype-results.json` (gitignored) every run. Never edit `src/`, the spec, or a gate while a run is in flight: a half-landed edit reads as a failure. It exists because the convention decayed silently: `src/` drifted out from under three prototypes, one had been exiting 1 for several commits, and the old handoff went on arguing §7.6's case from a number that no longer reproduced. **A prototype nobody re-runs is a claim, not evidence** |
| `tmp/archive/` · `tmp/prototypes/` · `tmp/measure/` | The prototype fleet, reorganized by the Cutting Campaign (`PLAN.md`). `prototypes/` holds a **gate** (clean code importing `src/`, one-line comments, every assertion revert-checked via `tmp/revert-gates.js`) and/or a **verdict card** per experiment — the card is the question, method, numbers, and verdict; read it before re-litigating a design choice, because most near-misses are already priced there. `archive/` is every original verbatim (runnable by hand, never run by CI). `measure/` is measurement scripts whose numbers could invert — re-run before relying on them. Contract in `tmp/prototypes/README.md` |

## The threat model that drives the design

**The operator of a family hub may be a loved one who is an abuser** — an adversary who controls the
serving path, the inbox, and (by default) the keys. No confidentiality mechanism defeats them; the
protocol answers with **exit** (§3.4, §4.5, §14), and its three parts must hold together. The second
driver is the **two self-hosting family members** persona, which is what makes cross-hub `family`
visibility a launch requirement.

Read §13.2 before touching anything security-relevant.

## Version policy

**0.1.0 — Draft, unreleased.** Nothing here has had a reader outside this repo. Each spec is
checked against running code: `src/` implements the old one, `src2/` the new one — and spec-2's
vectors are verified by two independent readers (`src2/reader.js` and the weekend instrument),
which is the closest thing to somebody else's reading it has had.

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
4. **Run `node tmp/regen.js`** (old spec) or **`node tmp/regen2.js`** (spec-2) after any change
   touching signing, document shape, the envelope, or the vectors. Each self-verifies and confirms
   every vector appears verbatim in its spec. Exits non-zero on drift.
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
