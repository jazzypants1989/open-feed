# Plan: the spec is generated from the examples

**The mechanism.** An example script proves a rule with an assertion, then prints it with `rule()`
(`tools/rule.js`). `tools/spec.js` runs every example in reading order and assembles the printed
rules, under a hand-held list of section headings, into `open-feed-spec.md`; `tools/regen.js`
generates `test-vectors.md` the same way. A rule no script proves is not in the spec. Hand-written
content in the spec is the Summary, §1 Terms, and the headings — nothing else. `node tools/spec.js` fails on
drift; `--write` regenerates.

**The cadence.** One section at a time, in spec order. The owner reads the generated section and
approves it before the next. Wording is written fresh from what each assertion shows; the old text
is `archive/spec-before-generation.md`, for reference only.

## The outline (ruled 2026-08-25)

Summary (the old Abstract, verbatim — the one approved wording) · 1 Terms · 2 Files · 3 Identity ·
4 The index · 5 Posts · 6 Encrypted content · 7 Reading · 8 Publishing (your copy is its last rule) ·
9 Fetching · 10 Views (media types are a table here). No appendices: the vectors are `test-vectors.md`.
Conformance, security considerations and implementation notes are not sections; a rule that lived
there gets a home in the section it belongs to or is cut. Rules only, no motivation; one script per
section, two for the big ones; the old scripts are raw material, merged or deleted as a section needs.

## Sections

- [x] §2 Files ← `files` (was `signed-file` + `no-canonicalization` + `json-hygiene`)
- [x] §3 Identity ← `identity` (was `first-contact` + `the-chain` + `recovery-list`), `contests` (was `contest` + `moving`)
- [x] §4 The index ← `the-index` (absorbed `media` and `rewrite`)
- [x] §5 Posts ← `posts` (was `posts-and-targets`)
- [x] §6 Encrypted content ← `envelope`
- [x] §7 Reading ← `reading` (was `the-reader` + `top-and-rumors`)
- [x] §8 Publishing ← `publishing` (was `publish-interface` + `your-copy`)
- [ ] §9 Fetching ← `fetching`
- [ ] §10 Views ← `views`
- [ ] `CLAUDE.md` and `examples/README.md` reflect the final script set

## Open — the owner's questions, not decided

- `README.md`: still the old-design text under a banner. Rewritten with the owner, section by section,
  or not at all.
- `TLDR.md`: says the host learns "that, when, and roughly how big"; §13.3 also said "and how many".
  Add the three words or not? The guarantees section is at 99/100 words.
- The Contrast sections in the example `.md`s (~800 lines). Left as they are until the owner raises it.
- `GOALS.md` scenario 7 (interop / bridges) is promised and cashed nowhere in the repo;
  `examples/views/views.md` disclaims it.
- From `DISTRIBUTION-MODEL.md`, archived but not fully rehoused — six things with no home yet, kept
  here verbatim as the only record: hub operations belong in
  `examples/publish-interface/publish-interface.md`: the two cache classes and why the split is
  correctness rather than tuning; how cache skew between the index and the posts manufactures a false
  `host` verdict against an honest publisher; the lower bound on §8.8's grace window (it must exceed
  the gap between §8.3's two writes); what §8.7's "a pass, an account, a rate limit, a bill" is *not*
  (a billing relationship with a writer, never the identity, and never the same list as an envelope's
  `audience`); and moderation stated honestly — refuse a write, stop serving, drop an unlisted file,
  and nothing else. Two more: third-party processing of *other people's* decrypted content, which §6
  and §10 make sharper rather than softer and which nothing in the repo raises
  (`examples/envelope/` or `examples/your-copy/`); and the bridge/POSSE half of scenario 7 — the old
  README's route was a discoverable Atom feed plus an h-card and a third-party bridge representing
  you in the fediverse as `@yourdomain.com`, an unverified claim about an external service. The
  `did:web` mapping, the Bluesky domain-handle seam, and WebFinger are factual notes about other
  ecosystems that went with it.

## Traps

- `tools/spec.js --write` rewrites all of `open-feed-spec.md` and `tools/regen.js --write` all of
  `test-vectors.md`. Anything hand-typed into either is lost on the next `--write` — edit the
  `rule()` in the script instead.
