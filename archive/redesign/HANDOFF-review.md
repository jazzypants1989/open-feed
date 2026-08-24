# Handoff — Stage 3, the skeptical review. Read this, then attack everything it describes.

**Written 2026-08-19 by the agent that produced the candidates and gates, at the owner's
instruction, for the next agent.**

## 1. Your instruction (the owner's words, near-verbatim)

> Skeptically review everything done so far and look for **issues, improvements, or innovative
> alternatives** to the solutions, rather than simply accepting the suggestions.

You are a reviewer and a rival designer, not an executor of `CANDIDATES.md`. Its recommendation
("sketch GIT, carry sealed-pins + minimal-delivered into it") is a **claim under review**, and so
is every gate, card, and rejection answer in `tmp/redesign/`. The owner's per-axis positions,
recorded exactly:

- **Substrate:** undecided — review first.
- **Identity:** "the hybrid sounds very appealing, but perhaps there are yet further solutions
  beyond these confines." Explore beyond hash/URL/hybrid before treating those as the menu.
- **Delivered channel:** leans minimal-delivered, "but I accept further unnamed possible
  solutions."
- **§15 envelope:** the NIP-44 evaluation is **commissioned** (a decision, not a lean): same
  blinded-slot-tag layout, Cure53-audited primitives, same test intents, cost delta measured.

## 2. What exists (verify before trusting; every command is cheap)

- `tmp/redesign/CANDIDATES.md` — comparison + decision sheet. `rejections.md` — draft answers to
  every recorded rejection. Both are this session's writing: review targets, not ground truth.
- `tmp/redesign/gates/` — seven gates, each with a card: bytes, log, subchain, writer,
  sealed-pins, channel, git. All green at session end (`for g in bytes log subchain writer
  sealed-pins channel git; do node tmp/redesign/gates/$g-gate.js; done`). `npm run check` green,
  nothing outside `tmp/redesign/` + PLAN.md touched.
- The three full design briefs (LOG+KEY, LOG+URL, PROFILE) are in this session's transcript;
  their decision-relevant content is condensed into CANDIDATES.md. The 267-test intent inventory
  and the verdict-card/rejection inventory are also in the transcript.

## 3. Known soft spots in my own work — start here, do not end here

A review that only attacks what the author flags is not a review. But hiding these would be
worse:

1. **Gates test what I designed them to test.** log-gate's violation-class "equivalence" is my
   enumeration (vanish, resurrection, version rollback, contiguity, ts). Hunt for classes I did
   not stage — timestamp gaming across checkpoint boundaries, cadence manipulation, K-boundary
   edge cases, a checkpoint that lies by *addition* rather than omission.
2. **"No uncommitted-window blindness" (rejections.md §9, manifestindex entry) is overstated.**
   "Publishing IS appending" holds for a self-hosted single writer. Under delegated custody the
   member's blob exists while no entry commits it — that is exactly today's lag window,
   reintroduced. The candidates need a lag story for delegated custody and I never wrote one.
3. **channel-gate's variant (a) may be a strawman.** I modeled published-only as "the hub owns
   the append." But the member's device holds the key: a layout where the device CAS-appends
   directly to any mirror it controls (hub = dumb storage, or a second mirror) may restore the
   covert outbound path *within* published-only, at the price of the multi-writer story and the
   readers-know-the-hint problem. Nobody gated discovery/location-hints at all — for hash
   identity, "how does grandma's reader find the new location after exit" is asserted, not
   tested. This is probably the largest ungated surface.
4. **git-gate ran on loose objects only.** After `git gc`, dumb HTTP serves packfiles — an
   incremental fetch may then transfer a whole pack (coarse-grained, possibly the entire
   history). This could invert the GIT candidate's transfer economics; the gate must be extended
   with a gc'd repo before GIT's numbers are trusted. Also untested: SHA-256 object format,
   linear-main enforcement, and repository size at the 10-year scenario with media.
5. **Word estimates are design-agent guesses.** 5–6.5k (GIT) vs 16.5k (LOG+KEY) drove the
   recommendation; nobody has written a page of either sketch. Treat the ranking as plausible
   and the magnitudes as soft.
6. **The hybrid identity was never designed, let alone gated.** It is two sentences in a brief.
   If it appeals to the owner, it needs a real design: what exactly is signed, what a UI shows,
   what happens when the home-URL claim and the serving location disagree, and whether it
   re-imports any migration machinery through the back door.
7. **sealed-pins-gate hand-waves one resolution branch** (custodian answers with the recipient's
   own branch: A's disagreeing claim must round-trip back to A — a comment, not an assertion).
   And detection latency is bounded by encrypted-traffic frequency, which nobody measured.
8. **bytes-gate's mutation sweep is single-character.** The structural argument (signature covers
   header.payload; strict spelling pins the rest) says multi-byte mutations add nothing, but the
   sweep does not prove that argument — check it.
9. **My rejections.md answers are my own grading of my own homework.** §9.2-Merkle,
   deltamanifest, and manifestindex especially: each "answered/dissolved" verdict deserves a
   hostile re-read against the recorded text.

## 4. Alternatives the owner explicitly invited (beyond the named menu)

Non-exhaustive, deliberately: the owner asked for solutions "beyond these confines."
- Identity: social/threshold *loss*-recovery (the threshold card rejected k-of-n for exit
  coordination — key LOSS may price differently); DNS/DNSSEC-anchored keys; identity = the
  encryption key rather than the signing key; petname-exchange protocols.
- Substrate: a bespoke log *serialized as* a git object store (stock-git readable, no git
  dependency in the verifier); SQLite file as the archive; tar/zip snapshots with a tiny index.
- Channel: recipient-side mailbox files the sender writes via CAS (no POST endpoint at all);
  store-and-forward through a second family's hub.
- Anything that makes the *discovery/hint* problem first-class instead of residual.

## 5. Procedure (unchanged)

Owner rulings stand: reversals answer recorded reasoning in writing (`rejections.md` is the
ledger — extend or correct it, including reversing *this session's* answers); the floor and
§13.2's adversary are fixed; re-derive numbers before acting on them; `npm run check` stays
green; nothing outside `tmp/redesign/` changes without its own justification. The NIP-44
evaluation wants a Stage-1-style gate (drive `src/enc.js`'s test intents against the swapped
construction; measure size/cost; card the verdict). PLAN.md's Session A tail (sketch,
intent-map, finalized rejections, tl;dr through `tmp/measure/tldr-check.js`) remains owed after
the review settles the axes.
