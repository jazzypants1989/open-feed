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

## Stage 1 — code clean-up — CLOSED 2026-08-17

Layout: `tmp/archive/` (originals, never run by CI) · `tmp/prototypes/<name>.js` + `<name>.md`
(gates and verdict cards) · `tmp/measure/` (informative scripts, no gates).

**The gate contract** lives in `tmp/prototypes/README.md`: imports `src/`, real assertions each
revert-checked (break the thing, watch it fail), comments ≤1 line, target ≤~200 lines. The card
carries: question, method, key numbers (marked with what would make them stale), verdict, pointer
to the archived original. Revert-checks are an executable table, `tmp/revert-gates.js`
(`npm run prototypes:revert`) — not just a dated note in the card.

- [x] Create layout; `git mv` all 17 prototypes to `tmp/archive/`; fix their relative paths
- [x] Point `tmp/check-prototypes.js` at `tmp/prototypes/*.js`; fail on an empty set
- [x] Write `tmp/prototypes/README.md` (the gate contract)
- [x] Note the layout change in CLAUDE.md (full table shrink happens at stage end)

Gates to rewrite (drive `src/` on properties whose violation is silent):

- [x] threshold — shipped `verifyMigration` refuses `_recovery_sigs` (revert-checked)
- [x] inbox — §10.2 ordering by outbound fetch position; §10.3 write-before-verify; dedup across migration
- [x] delivery-chain — §10.6/§11.2; **preserve its greps of four exact spec sentences**
- [x] freshness — §9.1.2 with the rule off and on; Q5 greedy declaration; Q6 punctual custodian
- [x] withholding-capability — §3.2.1 `items` caught-vs-silent; undeclared publisher reads as before
- [x] itemurls — §7.6 hash-addressing; feed-parsed and standalone bodies hash identically
- [x] migration — both §3.4 paths through shipped `verifyRecoverySignature`/`resolveFork`
- [x] enctags — shipped envelope keeps shared-`epk` + blinded-tag shape, no `kid`
- [x] export — §14 restore with no network, no bundle-specific verifier; E1 ancestor asymmetry
- [x] canonicality — regime-B bytes equivocate; regime-C cannot reproduce §14-nested docs
- [x] feedbinding — the Q3 board-owner attack against shipped `_feed_url`, plus the spec-text
      locator that keeps the ~106-word figure honest. (Omitted from the first draft of this
      table — the 17th prototype; caught during stage close)

Verdict cards only (assertion promoted only if cheap):

- [x] syndication — **card must state in bold**: the measured costs priced the *chained* shape;
      the adopted convention is unchained (the old file's table overstates the adopted cost)
- [x] manifestindex — its `|| true` assertion was dead; the three rejection reasons are card material
- [x] itempins
- [x] skiplinks — headline number was halved once when repriced at the MUST; mark stale-prone
- [x] enc — hand-rolled its own JWE; anything still load-bearing gets re-pointed at `src/enc`

Measure scripts:

- [x] deltamanifest → `tmp/measure/` (verdict is ratios that could invert with compressor/scenario)

Stage close:

- [x] Shrink CLAUDE.md's per-prototype table to a pointer at the cards
- [x] `npm run check` and `npm run prototypes` green; every gate revert-checked (21 mutations in `tmp/revert-gates.js`, all caught)

## Stage 2 — the tl;dr — CLOSED 2026-08-17

- [x] `TLDR.md` at root: best honest 200 (how) + 100 (guarantees) + ≤10-term glossary for the
      spec *as it stands*, marked draft
- [x] `tmp/measure/tldr-check.js` (~30 lines): enforce the budget mechanically
- [x] **Complexity ledger** (append as a section here): every mechanism/term that blew the
      budget → its spec sections, word cost, and which floor assurance it serves. A mechanism
      serving no stated guarantee is a named cut candidate.


## The complexity ledger (Stage 2, 2026-08-17)

297 words — 200/97/10 exactly, `tmp/measure/tldr-check.js` green. The predicted
failure did not happen, and the actual finding is sharper: the tl;dr fits only by describing the
happy path. All ten glossary slots went to nouns; `tombstone`, `version`, `published/delivered`,
`canonical/copy`, `migration`, and `level` each lost the 11th-term contest, and
**published/delivered is the most painful omission** — it is the protocol's central conceptual
split and the 300 words never mention it.

Word costs re-derived 2026-08-17 (`re-split on ## headings, fences dropped`); total spec prose
≈ 40,700. What the budget excluded:

| Mechanism | Where | Words | Serves | In the 300 words |
| --- | --- | --- | --- | --- |
| URL normalization, two comparators | §3.1 | ~900 | every identity/pin comparison | hidden inside "HTTPS URL" |
| Migration + recovery + predecessor equivalence | §3.4, §4.5 | ~2,900 | **exit (floor)** | one sentence |
| Delegated keys | §4.6 | ~700 | exit custody | absent |
| Revocation + two observation heuristics | §4.4 | ~600 | damage limitation (§4.4 itself concedes how little) | absent — Stage 3 candidate |
| Chain fine print: contiguity, base64url spelling, retention, fork resolution, caps | §5 | 2,694 | integrity | "chain"/"pin" carry two lines of it |
| Signing + canonicalization + parser equivalence + kind binding | §6 | 2,947 | integrity of everything | seven words |
| Canonical/copy + derived item URLs + withholding | §7.5–§7.6, §9.3 | ~2,200 | completeness | absent entirely |
| Manifest machinery: skip links, freshness, cadence, five invariants, lag/withheld/stale | §9 | 4,980 | completeness + freshness | "manifest" carries one line — the largest pile |
| Inbox pipeline: ordering, dedup, oracles, delivery continuity | §10 | 2,083 | interaction integrity | "inbox" carries one line |
| Published/delivered split + audience-of-one + roster foreclosure | §11 | 1,707 | **audience restriction (floor)** | absent |
| Tombstone allowlist + versioning | §7.3 | ~600 | the deletion guarantee | three words |
| Encryption layer | §15 | 3,555 | **audience-restricted content (floor)** | one clause |
| Item-carried pins | §16 | 1,602 | equivocation-detection supply | absent |
| Conformance levels + hosting rules | §12 | 1,396 | — | absent |
| Token-vocabulary meta-rule | §2.1 | ~350 | extension governance | absent — Stage 3 candidate |

**Guarantees the 100 words could not fit** — each is real, each has a mechanism pile behind it,
and none was expressible in the budget:

- *A host that stops serving you is distinguishable from you going quiet* — §9.1.2 freshness.
- *A dropped private message is visible to its recipient* — §10.6 delivery continuity.
- *A host serving the manifest but refusing the bytes is caught* — §7.6 + §9.3 withholding.
- *Your encrypted words cannot be replayed under someone else's name* — §15.2.1 carrier binding.
- *Ordinary family traffic carries the cross-checking* — §16.1 item pins.

**The reading that matters for Stage 3.** Those five guarantees are all patches for the same gap
— things the manifest-plus-pin core cannot see (silence, drops, refusals, replays, single-witness
blindness) — and each was answered with *another application of the same chain/commitment
discipline*: §10.6 is "the third application of the one chain discipline" by its own text, §16.1
is pins again, §9.1.2 is a deadline on the chain, §7.6 is hash-addressing again. Five separate
mechanisms, ~9,000 words, one underlying idea. The one-chain-construction and manifest-optional
hypotheses in Stage 3 are aimed exactly here: if the applications genuinely unify, four of the
five guarantees become one sentence and the tl;dr's omissions stop being omissions.

## The review pass + prelude (2026-08-19) — CLOSED

A full review re-derived Stage 1/2's claims (every checked number reproduced; all 21 revert
mutations were live) and found four defects, all fixed the same session:

1. Ten verdict cards were bulk-stamped "revert-checked" while still carrying "to be performed by
   the orchestrator" tails — the campaign's own signature bug inside its own instruments. The
   cards now point at `tmp/revert-gates.js` as the sole record.
2. `tmp/revert-gates.js` had no green baseline — a gate already red would have "caught" every one
   of its mutations vacuously. It now runs each gate clean first and reports `GATE ALREADY RED`.
3. The gates were absent from `npm run check` although all 11 now finish in under a second — the
   exact decay mode this fleet exists to stop. Wired in.
4. **A real spec defect**: §14 said a bundle "MAY itself be signed (§6)", but §6.2's closed `typ`
   set names no bundle kind and §6.5 step 3 rejects an unrecognized one — a signed bundle could
   never verify. Fixed by deleting the affordance (§14 itself argued the signature unnecessary);
   §6.3's and §6.6's nested-signature justifications re-grounded on embedded signed documents
   generally; `src/export.js`'s comment updated (its conservative don't-rewrite-under-a-`_sig`
   behavior kept).

Counting note: test/ is 7,878 lines only if helpers are counted; 7,500 without.

## Stage 3 — write the pearl (redesign, ~3+ sessions) — REPLANNED 2026-08-19

The review inverted this stage. The old list (kept below as the control arm) treated
simplification as independent deletions; the ledger's own reading — five patch mechanisms,
~9,000 words, one idea — points at designs where the patched gaps *do not exist*. Stage 3 now
drafts one coherent straw-man, **Open Feed 2**, from three moves, then attacks it with everything
Stages 1–2 built. Owner rulings 2026-08-19: radical straw-man over incremental cuts;
manifest-optional demoted to a card; Stage 4's rationale split is wholesale.

The three moves — each must answer its named recorded rejections in writing, never silently:

- **R2 — kill the delivered column.** Everything is published; §15 encryption is the privacy
  (§15.2's blinded tags already hide the audience); §10's inbox becomes a content-free **ping**
  ("look at ‹URL›", rate-limited, verified by the ordinary read path at the source), making §1's
  principle 3 true *without* its stated exception. §15.4 already reversed the delivered column
  for encrypted replies and recorded why; this finishes the move. Collapses: the §10 pipeline +
  oracles, §10.6 (its guarantee *upgraded* — a dropped message becomes the already-solved
  withholding problem, committed by the sender's own log), §11's 2×2 + audience-of-one
  scaffolding, the dedup/delivery stores, and §14's admitted no-completeness-proof slots.
  Price to measure, not assume: DM existence/size/timing metadata goes public; stranger replies
  become ping + fetch. Must answer: delivery-chain card Q4, both rejected receipt designs,
  §11.2's roster foreclosure (unchanged — audiences stay sealed).
- **R1 — the manifest becomes an append-only event log with checkpoints.** Typed events
  (add / tombstone / checkpoint); §9.3 invariant 1 becomes true by construction — there is no
  removal event but the tombstone; skip links → checkpoints; retained history becomes append-only
  immutable segments (the deltamanifest card measured this shape winning retained storage
  38–60×). Must answer: §9.2's Merkle paragraph (checkpoints keep the map — no inclusion proofs,
  no dynamic endpoint, static hosting *improves*); the deltamanifest card's
  fold/reconstructed-state objection (the log is the *only* shape and §5.3.1 still compares
  published bytes); §13.4's budgets re-derived for the log shape.
- **R3 — family witnesses.** The two-self-hosting-hubs persona gets a mutual witness profile:
  each hub publishes periodic pins of the chains it reads plus a freshness attestation, turning
  §13.2's "detectable rather than detected" into detected for witnessed hubs and closing
  §9.1.2's key-custodian gap there. §13.10 already states this is a pure extension needing no
  new field, endpoint, or rule. Measure what §16.1's scoping prose and §4.5's fingerprint
  choreography shrink to when the deployment profile carries detection.

Held fixed in every candidate: the exit triad (§3.4/§4.5/§14 — the identity chain stays small
and self-keyed; the recorded rejection of merging content volume into it stands), §6 + §6.3 +
§3.1 verbatim, the §15 envelope (unreviewed; R2 *raises* its load — say so), and `feed.json`
kept as a plain JSON Feed *view* of the log for Level 0 readers.

> **Session A was attempted on 2026-08-19 and failed** — the draft it produced was the current spec
> with two sections deleted and one field renamed, not a redesign. Read
> **`tmp/redesign/HANDOFF-stage3.md` before this file.** It records what went wrong, what is verified,
> and the questions this stage has to ask; the owner's standing instruction there is to question
> everything, including the three moves below and everything this file holds fixed.

> **Replanned again the same day, at the owner's instruction** ("prototype several different things;
> don't put all simplification eggs in one basket"): before any sketch, Session A now produces
> **competing candidates with runnable assumption gates**. Done 2026-08-19: three candidate designs
> (LOG+KEY, LOG+URL, and a profile study that eliminated nostr/ActivityPub/atproto and surfaced a
> GIT-substrate candidate) and **seven green gates** in `tmp/redesign/gates/` (bytes, log, subchain,
> writer, sealed-pins, channel, git — each with a verdict card and kill criteria; two kill criteria
> fired during development and forced design consequences, recorded on the cards).
> **`tmp/redesign/CANDIDATES.md` is the comparison and decision sheet** (four owner axes: identity
> primitive, substrate, delivered channel, §15 envelope); `tmp/redesign/rejections.md` (draft)
> answers every recorded rejection by name. **Owner ruling at the decision gate (2026-08-19): no
> candidate is adopted yet — the next session is a skeptical review** of everything this session
> produced (issues, improvements, innovative alternatives), per
> **`tmp/redesign/HANDOFF-review.md`**, which also records the owner's leanings (hybrid identity
> appealing; minimal delivered channel leaned; NIP-44 envelope evaluation commissioned) and the
> known soft spots to attack first. The sketch, intent-map, and finalized rejections follow the
> review.

> **Superseded 2026-08-20 by a goals conversation with the owner.** The review found that the
> floor above encodes the July-24 review's conclusions and that none of the owner's original values
> (zero dependencies, weekend implementability, interop) were recorded anywhere. The owner's
> answers are now **`tmp/redesign/GOALS.md`** — the floor restated as four assurances, the
> priority order, the decisions taken (identity is a key; the device is the only signer; a small
> publish interface enters scope; pull-only core; publisher forgets; items are files signed as
> bytes; three privacy tiers, one mechanism), and the seven scenarios gates must stage. **Read it
> before CANDIDATES.md**: the candidates' four axes are settled or dissolved by it, and the
> sketch is written *from* GOALS.md, not from the three moves above or the control arm. GOALS.md
> is a draft the owner has not yet argued with.

> **Outside review, 2026-08-20.** Six non-Anthropic models designed from the brief and then attacked a
> summary of GOALS.md (`tmp/redesign/outside/`). The synthesis of that review was rewritten once
> after verification found it quoting quarantined answers (`SYNTHESIS-v2-superseded.md`, errata in
> v3's Appendix A). **`tmp/redesign/outside/SYNTHESIS.md` (v3) is now organized as decision briefs**
> — staleness/relocation, recovery, first contact, local copy, multi-device, push, encryption, scheduled
> posts, the head, the publish interface — each with the attack, what this repo already measured, and
> every option priced. **The owner rules from it next; GOALS.md and `rejections.md` are amended only
> after those rulings, and the sketch follows them.** Two of GOALS.md's decisions are genuinely
> destabilized by the review (a frozen copy cannot read as stale with no freshness signal; "peers a
> reader already trusts" makes identity reader-relative); the rest are confirmed or refined. The whole
> `tmp/redesign/` tree entered git with this block — it had been untracked for three sessions.

> **The skeptical review + reference implementation, 2026-08-23.** The owner asked for a skeptical
> review of `open-feed-spec-2.md`, proven in code, ending in the reference implementation. Findings
> in **`tmp/redesign/REVIEW-spec2.md`** (nine protocol defects A1–A9, each with a gate; a code-drift
> list; an editorial list); rulings in **RULINGS §14** (unified hop; `pending` cut; re-list at the
> identical hash; current-key reclaim; verified hub writes; audience entries naming people; the
> spoken code over any key; `src2/` beside, swap later). The spec, the weekend instruments,
> `envelope.js` and `tmp/regen2.js` were edited to the rulings (Appendix B regenerated); six review
> gates joined the fleet (`coldcourt`, `oldkey`, `hubwrite`, `pending`, `audience`, `spoken`) with
> revert rows; **`src2/` + `test2/` now exist** — the modular zero-dep reference implementation with
> §10's fetch layer (the section that had no code), a verified-write hub, views, the BIP-39 list as
> data, a CLI, GOALS scenarios as tests, and two-reader vector agreement in `regen2.js`. `npm test`
> runs both suites; `npm run check` runs both regens and every gate. **Still owed** before the swap:
> README + DISTRIBUTION-MODEL rewritten for spec-2; TLDR-new.md promoted; the §15-class outside
> review of the new envelope; `lastline.js`'s substrate drift is documented on the cards, not fixed.

- [ ] **Session A — straw-man + accounting.** `SKETCH.md`: Open Feed 2 as a real RFC 2119 draft,
      written small from the start (target ~8–12k normative words; missing the target is itself
      a finding). `tmp/redesign/intent-map.md`: all 267 test intents mapped kept / transformed
      (mechanism named) / dropped (owner sign-off flagged) — a silent gap here is the stage
      failing. `tmp/redesign/rejections.md`: every recorded rejection answered by name (§9.2
      Merkle, deltamanifest, delivery-chain Q4 + the two rejected receipt designs, §16.1
      aggregator foreclosure, §11.2 roster, §15.4 history, register items 1–5). The sketch's
      tl;dr through `tmp/measure/tldr-check.js`, published/delivered's fate in plain words.
- [ ] **Sessions B/C — price the three risky deltas** as Stage 1-style gates + cards,
      revert-checked into `tmp/revert-gates.js`: **log-gate** (walk/checkpoint/fold over `src/`
      primitives; the manifest adversary intents — rollback, resurrection, withholding,
      relocation; §13.4 and the deltamanifest scenarios re-derived); **ping-gate** (a pure
      function like `inbox.js`; §10's adversary intents — oracles, floods, forged hints; the
      claim to falsify: zero outbound fetches without a rate token, and the read path needs no
      new verification rule); **witness profile + the R2 price sheet** (DM metadata exposure,
      encrypted-reaction wire cost at family scale, stranger-reply latency — measured, on a
      card, for the owner).
- [ ] **Manifest-optional retired by card** (owner ruling): item pins never fetch and cannot
      supply completeness (`src/chain.js:305`, `src/inbox.js:653`; ~40-test blast radius;
      manifestindex's structural ground). The card states exactly what would reopen it.
- [ ] **Decision gate** (owner, artifacts in hand): adopt Open Feed 2, adopt partially (e.g. R1
      without R2), or fall back to the control arm. Adoption means rewriting spec + `src/` +
      tests with the intent-map as the checklist — multi-session.

**Control arm** (the fallback; the per-item evidence stands): one chained-document chapter
(`src/chain.js` is already one walk + two policies whose whole delta is one predicate — self-keyed
or not; ~12 boundary tests); one attestation concept (§10.6 + §16.1 are one shape ~2,000 words
apart); one observation-store shape (§4.4/§10.3/§10.6, the id-half rule stated once); one verdict
lattice (lag/withheld/violation/stale/unverifiable — §13.13 and §13.17 dissolve into it); one
derived-URL rule (§5.4/§7.6); one timing-constants table; then the old deletion hypotheses
(§9.1.1 skip links, §4.4's two heuristics, §2.1's meta-rule, §16.1's `observed`,
`_recovery_sig` as §5.5 tiebreaker, §12's duplicated hosting obligations vs §4.5/§14).

## Stage 4 — docs + proving, over whichever spec wins (~2 sessions)

Owner ruling 2026-08-19: the rationale split is **wholesale** — superseding this repo's
editing-rule caution. Update CLAUDE.md's rule 3 when it lands.

- [ ] **RATIONALE.md**: the spec keeps every rule plus a one-sentence justification; attack
      narratives and defeated alternatives move out, section-keyed. `tmp/prove.js` + the gates
      carry the "this rule is real" weight mechanically. (Replaces the old "26% pile" item —
      the pile moves wholesale instead of shrinking in place.)
- [ ] §13 split: §13.2 (adversary gradient) and §13.4 (cap table) stay normative; the ~10
      pure-restatement items become pointers.
- [ ] Re-run the tl;dr — the campaign metric is now: the **honest** tl;dr fits, with
      published/delivered either included or gone by design. Promote into README's TL;DR.
- [ ] README (13.6k) / DISTRIBUTION-MODEL (20k): the identity-document example exists in four
      places — keep one; Relationship to Other Protocols (3,002 w, README's largest section) out
      of README; DM's Signatures / Published Output / Cross-Site Interactions become links.
      `npm run rules`'s echo report drives it.
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
