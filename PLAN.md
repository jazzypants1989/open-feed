# The Cutting Campaign

**What this file is:** the multi-session plan for simplifying Open Feed, and its state. Every
session that works the campaign ends by updating the checklists here. This file replaces
`HANDOFF.md` (deleted; its archaeology is in git, its live content is folded in below).
`tmp/review-findings.md` remains the permanent record of the previous review passes until Stage 4
archives it.

**The goal**, in the owner's words: the best *balance* of simplicity, flexibility, and capability.
The project deliberately built outward — a large shell around the idea — and is now cutting toward
the pearl. Four stages: clean the code, force a tl;dr, prototype simpler designs, then rewrite the
docs and prove them from code.

**The campaign's working rule** (inherited from four documented instances of the same bug —
something written once, never re-checked, quietly false): *if you are about to act on a number or
a claim, re-derive it first.* Every stage below ends in an artifact that can fail, not a prose
claim.

---

## Owner rulings for this campaign (2026-08-17, superseding the old record)

1. **Everything is on the table.** The decisions recorded as "settled, do not relitigate" in
   `tmp/review-findings.md` and the old HANDOFF are **reopenable** by Stage 3 prototypes, judged
   purely on the simplicity/flexibility/capability balance. The old rulings and their reasons are
   listed under "Previously settled decisions" below — a reversal must answer the recorded
   reasoning and be surfaced to the owner plainly, never adopted silently.
2. **The floor is the threat model's assurances, not feature shapes.** Must survive: the exit
   assurance (today §3.4 migration + §4.5 recovery + §14 export), cross-hub family visibility,
   and audience-restricted content. How each is delivered is fluid — similar assurances, not
   identical mechanisms. Read §13.2 before touching anything security-relevant.
3. **tl;dr shape:** 200 words how-it-works + 100 words guarantees + a ≤10-term glossary.
   Standard vocabulary (JSON, HTTPS, URL, signature) is free; terms of art (chain, manifest,
   pin, …) are not. The glossary cap is the sharpest instrument: an eleventh term names a cut
   candidate.
4. **Prototype end-state:** originals archived verbatim under `tmp/archive/` (import paths
   mechanically fixed so they still run by hand); rewritten prototypes are clean **gates** that
   import `src/` and assert; prose lives in partner `.md` verdict cards; measurement-only scripts
   live in `tmp/measure/`; no code exists to carry comments.

---

## Stage 0 — materialize the campaign

- [x] Commit the pending HANDOFF.md measurement (`5c59c70`)
- [x] Write this file
- [x] Delete HANDOFF.md

## Stage 1 — code clean-up (~1–2 sessions)

Layout: `tmp/archive/` (originals, never run by CI) · `tmp/prototypes/<name>.js` + `<name>.md`
(gates and verdict cards) · `tmp/measure/` (informative scripts, no gates).

**The gate contract** lives in `tmp/prototypes/README.md`: imports `src/`, real assertions each
revert-checked (break the thing, watch it fail), comments ≤1 line, target ≤~200 lines. The card
carries: question, method, key numbers (marked with what would make them stale), verdict, pointer
to the archived original.

- [ ] Create layout; `git mv` all 17 prototypes to `tmp/archive/`; fix their relative paths
- [ ] Point `tmp/check-prototypes.js` at `tmp/prototypes/*.js`; fail on an empty set
- [ ] Write `tmp/prototypes/README.md` (the gate contract)
- [ ] Note the layout change in CLAUDE.md (full table shrink happens at stage end)

Gates to rewrite (drive `src/` on properties whose violation is silent):

- [ ] threshold — shipped `verifyMigration` refuses `_recovery_sigs` (revert-checked)
- [ ] inbox — §10.2 ordering by outbound fetch position; §10.3 write-before-verify; dedup across migration
- [ ] delivery-chain — §10.6/§11.2; **preserve its greps of four exact spec sentences**
- [ ] freshness — §9.1.2 with the rule off and on; Q5 greedy declaration; Q6 punctual custodian
- [ ] withholding-capability — §3.2.1 `items` caught-vs-silent; undeclared publisher reads as before
- [ ] itemurls — §7.6 hash-addressing; feed-parsed and standalone bodies hash identically
- [ ] migration — both §3.4 paths through shipped `verifyRecoverySignature`/`resolveFork`
- [ ] enctags — shipped envelope keeps shared-`epk` + blinded-tag shape, no `kid`
- [ ] export — §14 restore with no network, no bundle-specific verifier; E1 ancestor asymmetry
- [ ] canonicality — regime-B bytes equivocate; regime-C cannot reproduce §14-nested docs

Verdict cards only (assertion promoted only if cheap):

- [ ] syndication — **card must state in bold**: the measured costs priced the *chained* shape;
      the adopted convention is unchained (the old file's table overstates the adopted cost)
- [ ] manifestindex — its `|| true` assertion was dead; the three rejection reasons are card material
- [ ] itempins
- [ ] skiplinks — headline number was halved once when repriced at the MUST; mark stale-prone
- [ ] enc — hand-rolled its own JWE; anything still load-bearing gets re-pointed at `src/enc`

Measure scripts:

- [ ] deltamanifest → `tmp/measure/` (verdict is ratios that could invert with compressor/scenario)

Stage close:

- [ ] Shrink CLAUDE.md's per-prototype table to a pointer at the cards
- [ ] `npm run check` and `npm run prototypes` green; every gate revert-checked

## Stage 2 — the tl;dr (~1 session)

- [ ] `TLDR.md` at root: best honest 200 (how) + 100 (guarantees) + ≤10-term glossary for the
      spec *as it stands*, marked draft
- [ ] `tmp/measure/tldr-check.js` (~30 lines): enforce the budget mechanically
- [ ] **Complexity ledger** (append as a section here): every mechanism/term that blew the
      budget → its spec sections, word cost, and which floor assurance it serves. A mechanism
      serving no stated guarantee is a named cut candidate.

## Stage 3 — redesign prototypes, the heart (~3+ sessions)

Each hypothesis gets a Stage 1-style prototype (gate + card), judged on: (1) the assurance floor,
(2) which of the 267 tests' *intents* break — the suite encodes the adversary catalog, (3)
measured simplicity (spec words removed, glossary terms removed, wire/request cost). Check
`tmp/archive/` and the cards first: several near-misses are already priced, and re-*discovering*
them is waste. Each accepted change lands completely — spec + `src/` + tests + `node tmp/regen.js`
+ affected gates — before the next hypothesis begins.

Hypothesis list (Stage 2's ledger will reorder and extend):

- [ ] §9.1.1 skip links (~700 words of OPTIONAL; deltamanifest card holds the counter-cost)
- [ ] §4.4's two revocation heuristics (weakest-defended of the five; §4.4 itself concedes)
- [ ] `_recovery_sig`'s second role as §5.5 fork tiebreaker (a SHOULD a first-contact consumer cannot run)
- [ ] §2.1's vocabulary meta-rule (governs one real vocabulary, inverts one, one unused)
- [ ] §16.1's `observed` field (supports only what §13.10 declines to build on)
- [ ] One chain construction — identity + manifest unified at the *design* level (the dead sketch
      merged the *sections*; a design merge makes "87% no counterpart" the thing to fix)
- [ ] Manifest-optional core — can item-carried pins do enough of §5.3.1's work that the manifest
      becomes a layer? (§9: 5,012 words, largest section, 173 w/MUST vs 95–110 baseline)
- [ ] Fewer document kinds / fewer conformance levels, measured against the glossary cap
- [ ] Inbox and encryption as companion layers (spec-splitting was "a thing not to try"; the
      owner has put it back on the table, so it gets priced rather than presumed)

## Stage 4 — docs clean-up + proving the spec (~2 sessions)

- [ ] Re-run the tl;dr against the new spec — the campaign's success metric: it fits, or the
      misses are deliberate and named. Promote into README's TL;DR.
- [ ] The 26% pile: ~9,900 words carrying no RFC 2119 keyword, never assessed as a pile. Where a
      proof or test now carries a justification's weight, the prose shrinks to a sentence.
- [ ] README (13.6k words) and DISTRIBUTION-MODEL (20k) trimmed; `npm run rules`'s near-verbatim
      echo report drives cross-document consistency
- [ ] Expand `tmp/prove.js`/`proofs.js`: cover the enforceable MUSTs (honest output is the
      fraction proven/enforceable); extend to numeric and uniqueness claims (the class that
      nearly deleted Appendix C); resolve the deliberately-failing §5.3.1 entry (missing test or
      dead line — needs a human read of §12's stateless carve-out); then wire `npm run prove`
      into `npm run check` — only once green, because a gate that ships red gets suppressed
- [ ] Retire the record: review-findings.md, sketches-review.md, appendix-c-case.md →
      `tmp/archive/`; this file shrinks to whatever is still open
- [ ] Last, over the finished spec: the three-model §15 adversarial review (owner uses OpenCode
      Go; key in `.env` as `OPENCODE_KEY`; models GLM-5.3, Kimi K3, Qwen3.8 Max), labeled plainly
      as a shake-out, not a cryptographer's review

---

## Previously settled decisions (now reopenable — answer the reasoning, surface the reversal)

1. **One-recipient delivery** — every placement of per-pair state inside one multi-recipient
   signed object either broadcasts the audience or re-links it (delivery-chain prototype, Q4).
2. **Whole-second timestamps** — `iat` is a registered JOSE parameter defined in seconds;
   milliseconds there is a wrong-unit standard field no library catches, and milliseconds only in
   Open Feed's own fields puts a unit boundary on §6.5's revocation comparison.
3. **`_openfeed` namespacing** (`_sig` top-level in all three kinds) — see `d5ddc03`.
4. **§15/§16 promotion; §7.6 capability flag; freshness bound** — each has an ADOPTED prototype
   whose card (Stage 1) records the measurement it stood on.
5. **Rejected delivery-receipt designs** (published receipt map; sender-side commitment) and the
   three rejected rule-extraction mechanisms (index appendix, requirements table, blockquote
   convention) — priced and declined; the reasons are in the register.

## Key numbers (measured 2026-08-17 — re-derive before acting on any of them)

Spec 41,232 words, 64 sections, ~282–284 MUSTs (431 RFC 2119 keywords / 338 rule-bearing
sentences); ~140 words per hard requirement; 26% of prose carries no keyword; §12's 28 named
sections reach 143/282 MUSTs (51%). README 13,647 words; DISTRIBUTION-MODEL 20,091.
`src/` 7,413 lines / 15 files; `test/` 7,878 lines / 267 tests. Appendix C is 4.5% of MUSTs and
4.5% of words (the "~15%" figure was wrong by 3× and nearly deleted it).

## Traps (inherited; still true)

- `tmp/rules.js`'s weight table is a ranking, never a proportion. `--gate` is the only part that
  may fail a build; keep it that way.
- The reader re-fetches a co-author's identity each read — that is §3.3.1, not a missing cache.
  A cross-read cache silently stops fork detection. (`inbox.js`'s one-hour *document* cache is
  correct.)
- A prototype with no assertions only checks that the file still runs. Never edit `src/`, the
  spec, or a prototype while `npm run prototypes` is in flight — several read files mid-run.
- `_openfeed` is merged into an item, never replaced (`publish.js` has `withOpenFeed`).
- Both consumer stores evict whole identities, never old entries — §4.4's record is a lower
  bound, so the oldest observations are the strongest (§13.4).
- `sign()`/`buildHeader()`/`verifyDocument` require an explicit `kind`; `policy.verifySignature`
  requires the chain URL; `parseTimestamp` in `jws.js` is the only content-timestamp parser.
- `_sig` covers `_recovery_sig`: co-sign first, then sign — prefer
  `advanceIdentity(changes, { recoverySigner })`.
- `ObservationStore` bounds self-reported time with `Math.max`, never `??`. Invariant 3's
  "passed over" test applies only to items the manifest's owner signed.
- `fetchDocument` refuses cross-origin redirects for every kind except `'json'`.
- §13's list is numbered and cross-referenced from four files: append, never insert.
- `tmp/regen.js` checks every hash-shaped literal in Appendix B against the current run; a vector
  quoted twice needs the rule to reach both.
- Any wire change breaks three files: spec, README, DISTRIBUTION-MODEL.

## Open questions (inherited)

1. §3.1's percent-encoding rule — the one place two conforming implementations could split one
   identity into two chains. No prototype; longest-standing open question.
2. Where a real §15 cryptography review comes from (the three-model pass is a shake-out).
3. Adoption asymmetry — publishing buys nothing until verifying readers exist; a product and
   distribution question no spec work touches (see the register's last section).
