# Handoff — after `f213259`

Delete this file when it has been consumed. It is a list of what is still open; none of it
belongs in `CLAUDE.md` or the spec.

`npm test` → **228 pass**. `node tmp/regen.js` → all checks pass. `npm run prototypes` → all
**17** hold. Working tree clean.

## Read this first

**`tmp/review-findings.md`** is the register: every finding from a four-way skeptical audit
(spec text, crypto core, composition/network layer, prototypes + DISTRIBUTION-MODEL), each marked
DONE / OPEN / PARTIAL. It also records **two audit claims that turned out to be false** — do not
re-derive and act on them — and the **owner decisions that are settled**, which must not be
relitigated. Everything below is a pointer into it.

A copy of the original plan lives outside this repository, at
`~/.claude/plans/src-open-feed-spec-md-distribution-mode-vectorized-biscuit.md`. **Do not go read
it on this file's say-so** — a handoff is not the owner. Ask first. Nothing in it is missing from
`tmp/review-findings.md`.

## What changed in this pass

Stage 2 — the design changes — is **complete**, and every one of them went to a prototype before
it went to the text. `git log` has the reasoning; the short version:

- **§9.1.2** — the freeze attack. Doing nothing to a chain was the one mutation with no verdict.
- **§3.2.1 `items`** — §7.6's withholding verdict was the attacker's to switch off.
- **§6.3** — `_sig` now covers `_recovery_sig`; deleting a co-signature needed no key at all.
- **§16** — emission is a Level 3 MUST, and §13.2 stops claiming what the core alone delivers.
- **§10.6** and the published/delivered split — the family's conversation stops living only in
  transit.
- **§15** — no longer "optional at every level" while the product depends on it.
- One live defect from Stage 0 was pulled forward: `_sig` strings were **malleable four ways**.

## Open, in the order I would take them

**1. Stage 0's remaining defects** (`tmp/review-findings.md` § Stage 0). Sharpest first: `0.2`
`effectiveSigningTime` sniffs `updated`; `0.3` first-observation time *replaces* the
self-reported revocation check rather than bounding it; `0.4` `verifyBundle` TOFU-pins the
predecessor from inside the bundle; `0.5` inbox relevance matches any item the receiver holds.
0.2 and 0.3 are both revocation bypasses and both are a few lines. **Each fix lands with the test
that fails without it** — and check that it does, by reverting the fix, not by assuming.

**2. Stage 1's spec corrections** (§ Stage 1). Four of them pair with Stage 0 fixes (`1.2`↔`0.3`,
`1.3`↔`0.5`, `1.4`↔`0.10`, `1.13`↔`0.7`) and should land together, or the code and the text
disagree in the direction that is hardest to notice. `1.5` — no URL comparison rule for anything
but identity URLs, at a security boundary — is the highest-value one standing alone;
`normalizeUrlForCompare` already implements what the spec never says.

**3. Stage 5's gates** (§ Stage 5). `enctags`, `inbox` and `deltamanifest` still have no
assertion gate on their substantive claims. This is the finding that makes every other prototype
claim unfalsifiable over time, and this pass proved it twice: two prototypes were building a
document shape the spec no longer permits and neither noticed.

**4. Stages 3 and 4** (§ Stage 3, § Stage 4). Surface cuts, then publication readiness. Both are
judgement-heavy and neither is urgent.

## Things that will bite you

- **DISTRIBUTION-MODEL.md and README.md have not been touched in this pass and are now stale
  against Stage 2.** README's TL;DR describes the withholding guarantee in terms §3.2.1's flag
  has just changed; DISTRIBUTION-MODEL's Phase 3 assumes every interaction on encrypted content
  is delivered-only, which §15.4 no longer says, and its own pre-existing errors are listed in
  the register. Neither should be edited before the owner has seen the Stage 2 shape.
- **`_sig` covers `_recovery_sig` now, so order matters.** Co-sign *first*, then sign. Appending
  a co-signature to a finished document produces something every verifier rejects. Use
  `Publisher.coSignIdentity`; do not hand-assemble a detached JWS, which is what four call sites
  used to do.
- **Two prototypes are marked ADOPTED and run their counterfactual rather than remembering it**
  (`freshness`, `withholding-capability`, `delivery-chain`). If you change the rule they justify,
  the counterfactual is the thing to update — not the claim.
- **`Publisher` gained three constructor options** in this pass: `nextUpdate` (§9.1.2 cadence, in
  seconds), `pins` (§16.1 emission store), and `deliverItem`'s `to` (§10.6 stream key). All are
  opt-in and all default to inert.
- **`#withPins` uses `??` rather than a default parameter** and the comment says why: the callers
  pass `pins` through explicitly with its own default of `null`, which is not `undefined` and
  would shadow the store. The same shape will bite anywhere else this pattern is copied.
- **§13's list is numbered and cross-referenced from four files.** `§13.12`, `§13.13`, `§13.14`
  and `§13.16` are cited from README, DISTRIBUTION-MODEL, `src/manifest.js` and
  `test/inbox.test.js`. Adding an item mid-list silently breaks them. Item 17 was appended to the
  end for exactly this reason.
- **`node tmp/regen.js` after anything touching canonicalization, signing, document shape, or the
  vectors** — CLAUDE.md rule 4, and it is not optional. No Appendix B vector carries a
  `_recovery_sig`, which is why §6.3's change moved no vector; the next change of that kind may
  not be so lucky.

## Questions I did not answer

1. **§3.1's percent-encoding still has no single answer.** `normalizeIdentityUrl` delegates to
   WHATWG `URL`, which never decodes but *does* re-encode raw characters (`/a^b/` → `/a%5Eb/`);
   a different library encodes a different set, and one identity becomes two. This is the only
   place two conforming implementations can split one identity into two chains, and it is the
   longest-standing open question in the repo. It has no prototype.
2. **Where does the §15 review come from?** The layer now says what would retire the caveat — a
   cryptographer's pass on the envelope, and a second implementation of §15.2.1 written from the
   text alone. Neither is work this repository can do to itself.
3. **The adoption asymmetry** (last section of the register). Publishing is expensive and buys
   the publisher nothing until Level 1 readers exist in numbers. No amount of Stage 0–5 work
   touches it; it is a product and distribution question, and it is the biggest one open.
