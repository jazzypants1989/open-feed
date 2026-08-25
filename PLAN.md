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

- [x] 01–03 files — `signed-file`, `no-canonicalization`, `json-hygiene`
- [x] 04–08 identity — `first-contact`, `the-chain`, `recovery-list`, `contest`, `moving`
- [x] 09–12 the index — `the-index`, `top-and-rumors`, `media`, `rewrite`
- [x] 13 posts — `posts-and-targets`
- [x] 14–15 encrypted content — `envelope`, `padding`
- [x] 16 the reader — `the-reader`
- [x] 17 the publish interface — `publish-interface`
- [x] 18–20 fetching, your copy, views — `fetching`, `your-copy`, `views`
- [x] capstones documented and printing — each carries a demo below a `// ====` marker; the file
      reports its own measurement (reader 171 lines, publisher 51, non-blank and non-comment above
      the marker), and `court-gate`/`weekend-gate` count the same slice. `tools/regen.js` still
      imports both
- [ ] `_seeds/` empty; `seeds` script removed from `package.json`; `examples/README.md` links complete

**All twenty examples and both capstones are written, and `npm run check` is green: 54 tests, 49
vector checks under two readers, 22 examples matching their committed output, seeds green, and
`npm run revert` catching all 136 mutations (96 of them new).** `tools/revert.js` resolves a row's
gate as an example directory first and a seed second, so a row moves with its subject.

What is left in this stage is only the seed deletion, and it is harder than it looks. **Measured
twice.** Retarget the fourteen rows whose subject is `examples/weekend-reader/weekend-reader.js` at
the capstone example: with the capstone's first demo, **thirteen of the fourteen went uncaught**. The
demo was then strengthened — thirteen hostile moves, each asserting the verdict it must earn rather
than only the count of distinct verdicts, plus media, a backdated number, a number re-listed at
another hash, a prefix split, a link carrying its own recovery list, and the rumor rule at a thousand
replies — and **ten of the fourteen are now caught**. The four still uncaught are the anchor check
(twice), the string guard on a media entry, and the one-hash-per-number rule inside a single index.

So the seeds are not yet redundant: the new rows prove `src/`, and the seeds are still the only thing
that proves the *second* reader, which is the one Appendix B is checked against.

Three ways out, in order of preference. (1) Grow the capstone's demo until it catches all fourteen,
and delete the seeds it replaces — the demo roughly doubles, and its committed output with it.
(2) Move the hostile-move staging into `test/` as the weekend reader's own suite, retarget the rows
there, and empty `_seeds/` — it is a test, not teaching material, and this is the honest home for it.
(3) Keep `_seeds/` and strike the checkbox. Whichever is chosen, do it seed by seed, not in one
sweep, and re-run `npm run revert` after each.

**Writing the examples found defects. They are in `FINDINGS.md`, unfixed, and two of them are
security defects in `k` — read that file before Stage D, and before touching §3.3, §3.4 or §3.6.**

## Stage C — the root documents (~1 session)

With the example `.md`s holding the supporting prose, decide per document what stays, what moves,
and what dies. Output: each file rewritten or archived, and **an explicit list of what the spec may
now drop because it lives elsewhere** — that list is Stage D's input.

- [ ] `README.md` — still the old-design text with its banner (13.6k words). An agent rewrote it
      wholesale in `8f2054b` without walking it with the owner; the owner reversed that. That draft
      is in git history only. The rewrite is to be done with the owner, section by section.
- [ ] `DISTRIBUTION-MODEL.md` — untouched. An agent archived it in Stage C without being asked; the
      owner reversed that. It is the owner's document: do not move, archive, or fold it (see `CLAUDE.md`).
- [x] `TLDR.md` — kept, its own file, at the budget `tools/tldr.js` enforces (200/100/10). An agent
      deleted it in `8f2054b` without being asked; the owner restored it.
- [x] `GOALS.md` — untouched, in the owner's words. An agent rewrote it in `6b6fc88` without being
      asked; the owner restored it. Never edit it without an instruction naming the file.
- [x] `CLAUDE.md` — reviewed and **came out a wash**, 1,211 → 1,217 words. The `examples/` and
      `src/` rows lost detail that `examples/README.md` now owns and the README rule lost a sentence,
      and that bought back one new trap: the capstones' `// ====` marker is what three separate
      measurements slice on, so moving it breaks them silently. Reported rather than dressed up as a
      cut — the file is a repo map, a threat model, seven editing rules and six traps, and there is
      no fat left in it that is not load-bearing
- [x] The "may now drop" list — `SPEC-CUTS.md`, section by section. **Its headline is the finding:
      the drops come to about 520 words of 10,277, five per cent.** The spec is already tight; what
      would actually shorten it is its last section, "Shorter by design", thirteen places where one
      thing is said twice or three paragraphs stand where a table belongs — worth another ~300 words
      once the three unsound ones (D, G, J) are struck, and where the "a novice reads it in an hour"
      goal is won or lost. Read that section first

## Stage D — the spec rewrite (~1–2 sessions)

Target: normative language; every MUST keeps its one-sentence justification; stand-alone; readable
by a novice in an hour or two. Input: `SPEC-CUTS.md`, and `FINDINGS.md`. Every edit is gated by
`npm run check` — the vectors under two readers, the examples, the tests — so shortening cannot
silently change meaning.

**Do the rulings first.** `FINDINGS.md` §1 holds two security defects that are one protocol change,
and §2–§4 hold about two dozen places the spec and the code disagree. Rewriting prose around rules
that are about to change is wasted work, and the `k` change would restage `examples/contest/`.

- [ ] Rule on `FINDINGS.md` §1 (the `k` change), then §1.2 (§2.4 inside the envelope), then the rest
- [ ] Section-by-section pass with `SPEC-CUTS.md` in hand — start with "Shorter by design"
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
- **From `DISTRIBUTION-MODEL.md`, archived but not fully rehoused.** Six things it carried have no
  home yet, and this list is the only record of them. Hub operations belong in
  `examples/publish-interface/publish-interface.md`: the two cache classes and why the split is
  correctness rather than tuning; how cache skew between the index and the posts manufactures a false
  `host` verdict against an honest publisher; the lower bound on §8.8's grace window (it must exceed
  the gap between §8.3's two writes); what §8.7's "a pass, an account, a rate limit, a bill" is *not*
  (a billing relationship with a writer, never the identity, and never the same list as an envelope's
  `audience`); and moderation stated honestly — refuse a write, stop serving, drop an unlisted file,
  and nothing else. Two more: third-party processing of *other people's* decrypted content, which §6
  and §10 make sharper rather than softer and which nothing in the repo raises
  (`examples/envelope/` or `examples/your-copy/`); and the bridge/POSSE half of `GOALS.md` scenario 7,
  which `examples/views/views.md` explicitly disclaims — **priority 3 (interop) is now promised in
  `GOALS.md` and cashed nowhere in the repo.** The old README's concrete route was: serve a
  discoverable Atom feed plus an h-card and a third-party bridge represents you in the fediverse as
  `@yourdomain.com` with nothing built. That is an unverified claim about an external service, which
  is why it was left out of the new README; it wants an example that asserts something, or a stated
  limit. The `did:web` mapping, the Bluesky domain-handle seam, and WebFinger are factual notes about
  other ecosystems that went with it and a future implementer would have to rediscover. One gap, not text to move: §9 caps a
  *reader's* outbound fetches and the spec says nothing about a writable hub's own limits.
