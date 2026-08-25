# Plan: the spec is generated from the examples

**The mechanism.** An example script proves a rule with an assertion, then prints it with `rule()`
(`tools/rule.js`). `tools/spec.js` runs every example in reading order and assembles the printed
rules, under a hand-held list of section headings, into `open-feed-spec.md` above Appendix B;
`tools/regen.js` keeps owning Appendix B. A rule no script proves is not in the spec. Hand-written
content in the spec is the headings and a short §1 — nothing else. `node tools/spec.js` fails on
drift; `--write` regenerates.

**The cadence.** One section at a time, in spec order. The owner reads the generated section and
approves it before the next. Wording is written fresh from what each assertion shows; the old text
is `archive/spec-before-generation.md`, for reference only.

## Sections

- [ ] tool built; §2 files ← `signed-file`, `no-canonicalization`, `json-hygiene`
- [ ] §3 identity ← `first-contact`, `the-chain`, `recovery-list`, `contest`, `moving`
- [ ] §4 the index ← `the-index`, `top-and-rumors`, `media`, `rewrite` (§4.5 stays out until a script proves it)
- [ ] §5 posts ← `posts-and-targets`
- [ ] §6 encrypted content ← `envelope`
- [ ] §7 the reader ← `the-reader`, `top-and-rumors`, `moving`, `fetching`
- [ ] §8 the publish interface ← `publish-interface`, `weekend-publisher`
- [ ] §9 fetching ← `fetching`
- [ ] §10 your copy ← `your-copy`
- [ ] §11 views ← `views` (Appendix A exists only if `views` prints it)
- [ ] §12 conformance, §13 security — whatever survives as rules of its own; §13.4 is gone
- [ ] `CLAUDE.md` updated for the generated spec

## Open — the owner's questions, not decided

- `README.md`: still the old-design text under a banner. Rewritten with the owner, section by section,
  or not at all.
- `TLDR.md`: says the host learns "that, when, and roughly how big"; §13.3 also said "and how many".
  Add the three words or not? The guarantees section is at 99/100 words.
- §3.3 caps a chain at 64 links and §3.4 a recovery list at 32 leaves. Both numbers were picked by an
  agent and never discussed.
- The Contrast sections in the example `.md`s (~800 lines). Left as they are until the owner raises it.
- §4.5 scheduled posts: write the script that proves it, or leave it out.
- `GOALS.md` scenario 7 (interop / bridges) is promised and cashed nowhere in the repo;
  `examples/views/views.md` disclaims it.
- The spec caps a *reader's* outbound fetches (§9) and says nothing about a writable hub's own limits.
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

- `tools/regen.js --write` rewrites Appendix B from its heading to the end of the spec; `tools/spec.js
  --write` rewrites everything above it. Anything hand-typed into `open-feed-spec.md` is lost on the
  next `--write` — edit the `rule()` in the script instead.
