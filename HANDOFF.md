# Handoff

**This file is scaffolding, not a record.** It gets one fresh agent productive on work in
flight. When the work lands, delete it (see `CLAUDE.md`, "Rules for this file").

---

## 1. What is happening

**"The custody pass" is mid-execution: 4 of ~7 commits landed, all green.** The owner approved
a full plan this session; it lives at
`/Users/jessepence/.claude/plans/handoff-md-jiggly-kazoo.md` — **read it first**, it is the
source of truth for what remains. Summary of the frame: key delegation (`use: "delegated"`)
is drafted into §4.6 and promoted to §12's recommended custody architecture ("the hub is a
servant, not a custodian"); every HANDOFF-§4 open question from the previous handoff gets a
final closure; a set of subtraction cuts shrinks the spec. Delta manifests were evaluated and
rejected (accounting to be recorded in the commit-3 message; see plan Part 2).

Owner decisions obtained this session (fixed inputs, do not re-ask):
- **Client-held encryption keys** for the reference family hub; owner explicitly endorses
  automatic client-side key generation and notes local models make on-device AI plausible.
- **No timeline for a first user** — churn is free.
- **Spec public eventually, no date.**
- README demotions confirmed with the variant: **mechanics demote to README; the two B.2
  warnings keep RFC 2119 force in §13** (now §13.16 — done).

## 2. Commits already landed (this pass)

1. `21fca82` — Delegation §4.6 + §12/§13.2 rewrite; threshold recovery permanently closed in
   §4.5; split custody stated as bounded claim (new "delegated custodian" tier); `findKey`
   `use`-allowlist fix in `src/jws.js`; delegated exclusions in `src/chain.js`
   (`assertContinuityKey` + `identityChainPolicy.verifySignature`); `Publisher` refuses
   recovery/delegated signers; vectors B.9 (was D.10); negative tests.
2. `346e740` — Replies endpoint cut; §11.1.1 generalized to artifact classes and carries the
   promotion rule; §16 shrank.
3. `abbdbb7` — Appendices B (aliases/accounts) + C (WebSub) demoted to README; warnings moved
   to **§13.16** with MUSTs intact; `accounts` → `_accounts` README convention; **appendices
   renumbered: Test Vectors D→B, Gateways E→C, labels D.x→B.x everywhere**;
   `test/appendix-d.test.js` renamed `test/vectors.test.js`; vector B.8 reworked to test
   unknown-extension-field preservation.
4. `ef91c34` — Follows document demoted to README (`_follows`); §16 = pins only; pin emission
   MAY→SHOULD; **deliberate narrowing**: the `activity` rel token STAYS in §3.2.1 (demoting
   it forces URL-namespaced rel values — worse than the one-word entry); the §3.2 example no
   longer shows an activity feed. Vectors: B.8 follows dropped, B.6 re-signed without
   `follows`, extension/delegated vectors renumbered B.8/B.9 (twelve signed vectors now).

## 3. What remains (plan Parts 2–4, execution steps 3–5)

Work through the plan file's "Execution order"; remaining items:

- **Commit 3 — closure edits** (plan Part 4, all text-only):
  - §11.2 group audiences → *permanently out of scope* wording (plan has the sketch: second
    protocol's worth of machinery; separate spec layered on this one; MUST NOT present
    author-held-list broadcast as group membership).
  - §2.1 → "the spec is the registry" paragraph (registered tokens are what the text lists;
    additions are spec revisions; no external registry; note the deliberate inversion for key
    `use` — unrecognized hides the *key*).
  - §6.1 → dual-signing rejected + one new boundary MUST: a key listed in `keys` MUST NOT
    sign under any other construction; foreign suites get a separate key (listable as an
    extension key per §4.1, or in a did:web doc).
  - §16.1 + §13.10 → external time anchoring *permanently out of scope*; pin entries being
    self-contained signed claims is WHY closure is safe (pure extension, no door ajar).
    Replace "remains future work that nothing here forecloses" phrasing with the closed form.
  - §5.4 or §13.4 → one non-normative sentence: retention is a *serving* obligation, not a
    storage layout; retained versions compress/delta-encode to ~O(total changes).
  - Appendix C (Gateways, formerly E) → "No profile is defined here" becomes *permanent*
    non-normativity (profiles bind to foreign protocols' behavior-of-the-moment).
  - Record the **delta-manifest rejection** accounting in this commit's message (plan Part 2
    has the full argument: live set/rotation survive, cadence survives, skip-links' direct
    map-comparison omission check breaks under deltas; 0 mechanisms deleted, 3+ added).
- **Commit 4 — README + DISTRIBUTION-MODEL**:
  - README: `_syndication` unchained-document convention (plan Part 4 item 3: document shape
    per `tmp/syndication-prototype.js` — field shape loses retraction targets to §7.3's
    tombstone allowlist; receipts double artifacts; unchained = erasable, mirrors
    `_follows`); the worked **Mastodon syndication-class profile** (identity seam = rel-me,
    backlink form, backfeed delivery, `_syndication` as mapping home); dual-signing FAQ
    (FEP-8b32 recipe with a separate key).
  - DISTRIBUTION-MODEL: custody sections flip from hub-held-keys default to
    delegated-by-default (root+recovery+encryption keys generated on member's device; hub
    holds delegated key only). Grep for "hub-managed keys", "Sign all feed items", onboarding
    sections. Also reconcile its `family`-visibility/AI sections with the owner's client-held
    keys decision (AI is client-side / explicitly-shared-content only; the doc's "server-side
    AI reads everything" framing is now wrong).
- **Commit 5 — final sweep**: delete this file; update CLAUDE.md's file table (HANDOFF row
  out; tmp prototype rows for decided questions can note "decided — see git log"); grep spec
  for `deferred|future work|remains future|not yet|for now` — every hit must read closed;
  final `npm test` + `node tmp/regen.js`.

Left half-checked from commit 2c (small): DISTRIBUTION-MODEL / README may still carry stale
references to a *spec-level* follows document or `follows` identity-document field — grep
`follows` in both and fix any that say the spec defines it (README's §"Follows and pins" and
the identity-document examples are already correct; unchecked was DISTRIBUTION-MODEL).

## 4. Traps for this pass specifically

- **Vector workflow**: any change touching signed bytes = edit `tmp/regen.js`, run it, paste
  the emitted strings into spec Appendix B verbatim, re-run until "ALL CHECKS PASS". regen
  cross-checks every vector string appears verbatim in the spec and exits non-zero on drift.
  `npm test` must show **120 passing** (grows only if you add tests).
- **Appendix letters changed this pass**: Test Vectors = **Appendix B** (labels B.1–B.9,
  including B.2b/B.3b), Gateways = **Appendix C**. Old D.x/E references are gone; do not
  reintroduce them. `test/vectors.test.js` extracts vectors from the spec by fenced
  single-line JSON — label-agnostic, but counts signed vectors (≥12).
- **Tier names, not ordinals**: §13.2 references now say "the hostile-custodian tier" — the
  delegated-custodian tier insertion renumbered the list, so never cite tiers by number.
- **`findKey` now enforces a `use` allowlist** (`undefined`/`sig`/`delegated` resolve;
  `recovery` errors specifically; anything else is "ignored" per §4.1). Tests that pinned
  old error layers were updated in `21fca82` — expect rejection one gate earlier.
- **The previous handoff's traps still bind** (they described current mechanisms): revocation
  strictly-after `revoked_at`; skip links manifest-only for security; `walkToPin` buffers
  until anchored; item pins are claims (`admissibleItemPins`/`reconcilePeerPin`, never
  `observe`); `PinStore` keeps `observed` per seq; identity URL inside every signed byte;
  §9.3 invariant 3's no-history test; `claimedAuthor` selects carrier by document kind.
- CLAUDE.md rules: no version bump, no changelog, archaeology goes in commit messages,
  justification beside a MUST stays in the text.

## 5. Unchanged backlog (not this pass)

`src/consumer.js`, the executable exit walkthrough (§3.4+§4.5+§14 end-to-end — still the
protocol's central untested claim), inbox implementation (§10), pagination (§7.4), §9.2
storage measurement, the product spike, and the verified-input wrappers for
`assertRelocationCarriesForward`/`resolveFork` (the read-before-verify defect class).
