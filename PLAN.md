# Finishing the spec

**What this file is:** the multi-session plan for finishing `open-feed-spec.md`, and its state. Every
session that works it ends by updating the checklists here. It replaces the Cutting Campaign's plan,
which is in git history; that campaign's product is the current spec, and its record is in
`archive/` (`archive/README.md` is the index).

**The goal**, in the owner's words: the spec as short as possible while still covering all of its
bases, to the point where a novice can read it in an hour or two and immediately understand its
concepts. The spec should mostly contain the normative language and still stand alone. Everything
else — the reasoning, the contrasts, the walkthroughs — lives beside runnable examples, so that the
spec can shed it without losing it.

**The order matters.** Get everything *around* the spec in order first, so the agent finishing the
spec has less to hold at once: consolidate the repo (A), curate the examples (B), reckon with the
root documents (C), and only then rewrite the spec (D). By D it should be obvious what has to remain
in the spec, because everything else will have somewhere to live.

**Working rule**, inherited: if you are about to act on a number or a claim, re-derive it first.
Every stage ends in an artifact that can fail — `npm run check` — not a prose claim.

---

## Rulings (2026-08-24)

- Layout: `src/` + `test/` + `examples/` + `tools/` + `archive/`; `tmp/` is gitignored scratch;
  no `bin/`. The barrel is `src/openfeed.js`; `src/index.js` is the spec's §4 module.
- Examples **print and assert**, commit their output, and run under `npm run check`.
- The spec's vocabulary is fixed (anchor key, chain, link, recovery list, profile, index, post, media,
  encrypted, pin, withdraw, hub); code and docs follow it. The rename came first so every example is
  written in the final words.
- The redesign record is archived verbatim; `GOALS.md` (values and scenarios) moved to the root.
- The weekend reader and publisher are the capstone examples and remain the second reader that
  vector regeneration checks against.
- One example per concept, in spec order (~20), plus the two capstones; the scenarios stay tests.
- The owner is not yet ready to rely on git history alone for the old material; hence `archive/`.

---

## Stage A — consolidate — CLOSED 2026-08-24

- [x] Checkpoint commit of the in-flight spec vocabulary pass (`caca5ed`)
- [x] Code renamed to the spec's vocabulary and section numbers (`genesis→anchor`,
      `pseq/hseq→version`, `court→recovery`, `hop→link`, `head→index`, `sealed→encrypted`,
      `photo→media`, `seal/open→encrypt/decrypt`); pin fields disambiguated
      (`profileVersion/profileHash`, `indexVersion/indexHash`, `recoveryLists`)
- [x] Appendix B regenerated in the new field names; 49 vector checks under both readers
- [x] Tree moved: `src2→src`, `test2→test`, spec-2 → `open-feed-spec.md`, old spec/src/test/bin and
      all of `tmp/` → `archive/`, twelve surviving gates → `examples/_seeds/`, weekend instruments →
      `examples/weekend-*`, `GOALS.md` and `TLDR.md` promoted
- [x] `tools/regen.js` (both readers, envelope from `src/`), `tools/examples.js`, `tools/revert.js`
      (35 rows, all caught); `package.json` scripts: `test`, `vectors`, `examples`, `revert`, `seeds`,
      `check`
- [x] `CLAUDE.md` rewritten for the layout; banners on `README.md` and `DISTRIBUTION-MODEL.md`;
      `archive/README.md` and `examples/README.md` written
- [x] `npm run check` green; old vocabulary and `-2` labels appear only under `archive/`

Deviations from the approved plan, both deliberate: the old spec is `archive/open-feed-spec.md`
(not `-1`) so every archived script's relative path still resolves; and the `_seeds/` gates still
import the weekend instruments and `examples/_seeds/{envelope,hub}.js` rather than `src/` — they
are raw material, and `tools/revert.js`'s rows target them until Stage B retargets each at `src/`.

## Stage B — the examples (next 1–2 sessions)

The contract is in `examples/README.md`; the reading order there is the checklist. Per example:
read its seed(s) → write `<slug>.js` over `src/` in the spec's words (≤ ~120 lines, seeded keys,
narrate + assert) → write `<slug>.md` (concept, spec section, what the output shows, contrasts;
this is where prose from the spec/README/DISTRIBUTION-MODEL lands) → generate `<slug>.out.txt` →
add the `tools/revert.js` row(s) that turn it red, retargeted at `src/` → delete the seed(s) it
consumed. **The stage closes when `_seeds/` is empty** and `npm run revert` is all caught.

Seeds by example: 01–03 `weekend-gate` + `test/file.test.js` (**`weekend-gate` stays** until the
capstones are documented — it is their material too, and its card holds the numbers they cite);
04 `spoken-gate`; 05–07 `court-gate`,
`coldcourt-gate`, `oldkey-gate`; 08 `twohubs-gate`; 09, 12 `oldkey-gate`, `gapless-gate`;
10 `test/reader.test.js`; 11 `media-gate`; 13 `gapless-gate`; 14–15 `envelope-gate`,
`audience-gate`; 16 `test/reader.test.js`; 17 `hubwrite-gate`, `test/hub.test.js`; 18
`test/fetch.test.js`; 19 `pending-gate` (its point: there is no mechanism), scenarios; 20 `views.js`.
`envelope-gate` also prices the old §15 construction against the new one — that comparison goes into
`envelope.md` as a contrast, and its import of `archive/src/enc.js` goes with the seed.

The capstones: give `weekend-reader` and `weekend-publisher` a `<slug>.md` (what a second
implementer wrote from the text alone, and what it cost — the numbers are on `weekend-gate.md`) and
a narrated `<slug>.out.txt`, since today they are libraries and print nothing; `tools/regen.js`
imports them and must keep working.

- [x] 01–03 files — `signed-file`, `no-canonicalization`, `json-hygiene`; nine revert rows against
      `src/file.js`, all caught. `tools/revert.js` now resolves a row's gate as a seed *or* an
      example directory, so a row moves with its subject and nothing else changes
- [ ] 04–08 identity
- [ ] 09–12 the index
- [ ] 13 posts
- [ ] 14–15 encrypted content
- [ ] 16 the reader
- [ ] 17 the publish interface
- [ ] 18–20 fetching, your copy, views
- [ ] capstones documented and printing
- [ ] `_seeds/` empty; `seeds` script removed from `package.json`; `examples/README.md` links complete

## Stage C — the root documents (~1 session)

With the example `.md`s holding the supporting prose, decide per document what stays, what moves,
and what dies. Output: each file rewritten or archived, and **an explicit list of what the spec may
now drop because it lives elsewhere** — that list is Stage D's input.

- [ ] `README.md` (13.6k words, old design): rewrite for the current spec — TL;DR from `TLDR.md`,
      pointers into `examples/`; the protocol-comparison section (3k words) becomes an example `.md`
      or goes
- [ ] `DISTRIBUTION-MODEL.md` (20k words, old design): rewrite small for the current spec or archive
- [ ] `TLDR.md`: reconcile with the spec's §1 table; fold into README or keep
- [ ] `GOALS.md`: keep as the statement of values and scenarios; trim the redesign-era asides
- [ ] `CLAUDE.md`: shrink again
- [ ] The "may now drop" list, section by section

## Stage D — the spec rewrite (~1–2 sessions)

Target: normative language; every MUST keeps its one-sentence justification; stand-alone; readable
by a novice in an hour or two. Input: Stage C's list. Every edit is gated by `npm run check` — the
vectors under two readers, the examples, the tests — so shortening cannot silently change meaning.

- [ ] Section-by-section pass with the list in hand
- [ ] Re-read as a novice; time it
- [ ] Owner review

---

## Traps

- Never edit `src/`, the spec, or an example while `npm run revert` is in flight: it mutates files in
  place and restores them.
- `tools/regen.js --write` rewrites Appendix B from the marker to the end of the spec. Anything
  placed after Appendix B is lost.
- `examples/_seeds/*` are not examples: they still speak to the weekend instruments and their own
  `hub.js`/`envelope.js`, and their cards cite the numbers from before the rulings. Read the card's
  "held to the rulings" note before quoting a number.
- The README and DISTRIBUTION-MODEL describe the old design until Stage C; do not "fix" a sentence
  in them to match the new spec piecemeal.
