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
- [x] §9 Fetching ← `fetching`
- [x] §10 Views ← `views` (WebFinger added: hub serves `/.well-known/webfinger`, spec rule in §10)
- [x] `CLAUDE.md` and `examples/README.md` reflect the final script set

## Decided (2026-08-25)

- `TLDR.md`: drop "encrypted" as a glossary term (it's a property, not a thing; the how-it-works
  section already covers it). The whole TLDR needs an editing pass — deferred to the rewrite session.
- The Contrast sections in the example `.md`s (~800 lines, ~11k words): pull the bulk into a
  `COMPARISON.md` at the repo root. Only contrasts that genuinely teach something about *this*
  protocol's choice stay inline. In progress.
- `GOALS.md` scenario 7 (interop / bridges): interop is priority 3 and the gap is a failure, not an
  open question. WebFinger and any remaining discoverability work are next.

## The rewrite session — agenda for later

Four documents need a pass together: the spec (via its examples and `rule()` calls), `TLDR.md`,
`DISTRIBUTION-MODEL.md`, and `README.md`. The README describes a protocol that no longer exists
(identity as a URL, `openfeed.json`, manifests, JOSE, conformance levels). The distribution model
carries the same banner. The TLDR has smaller problems but should be aligned after the spec settles.

What follows is context for the agent running that session, not exact instructions — things are
still in flux and there is room to find better answers along the way.

**Wire names.** Several member names are unnecessarily terse: `n`, `loc`, `epk`, `ct`, `sig` (in
chain links), and the intermediate `Z` in §6.1. The protocol is not compressing millions of events
through a relay; it is serving a family's posts. Spelling these out (`number`, `location`,
`ephemeral`, `ciphertext`, `signature`; and describing the shared secret in prose rather than naming
it `Z`) costs a few bytes on the wire and saves every implementer from cross-referencing §5 and §6
on every read. `at` and `rel` are fine as-is. This is a wire-format change that touches the spec,
the implementation, the examples, and the test vectors.

**Spec jargon.** A few terms coined for the spec are harder to understand than the concepts they
name:

- "fold" (§4.1) is functional-programming jargon for "process the list in order to build the current
  state." The noun form ("the live set is their fold") is worse.
- "pin" is doing heavy lifting — §1 defines it as seven pieces of state, the TLDR defines it as one,
  and it reads like a UI element. "Checkpoint" or "snapshot" might land faster.
- The verdicts "host" and "identity" (§7.2) use common nouns as return values, which collide with
  the things those nouns already name. Something like "tampered" / "contested" would be clearer.
- "top" (§4.2) uses a bare adjective as a noun for "the highest number ever issued."
- "carrier" (§6.2) appears once, in "carrier binding," and nowhere else.
- "split" (§3.4) is introduced, used in one subsection, and never seen again.

**§8 Publishing** is the longest section (572 words) and the roughest. §8.5 (reclaiming a number)
and §8.6 (media hash replacement) are hard to parse on first read. §8.7 mixes CORS mechanics with
hub autonomy under one heading.

**§7.1's step list** packs too many rules per numbered item. Step 8 is five distinct rules chained
with semicolons. Breaking the list into smaller pieces — or grouping by phase (profile, index,
posts) — would help.

**§10 Views** is the thinnest section (146 words) for a protocol that ranks interop as priority #3.
It says nothing about discovery (WebFinger, `<link rel="alternate">`), nothing about how a feed
reader finds the feeds. Expanding it is part of the interop work, not just the rewrite.

**The adversary.** The old §13 (security considerations) was cut, and most of it deserved cutting —
forward secrecy's absence is obvious from the construction, staleness vs. silence is inherent in
pull. But the one-sentence adversary model ("the operator of the hub may be the adversary") is the
thing an implementer most needs to know and wouldn't assume. It currently lives in `CLAUDE.md` and
`GOALS.md` but not in the spec. It may need one sentence in the summary or §1.

**Voice.** The spec uses "app" (6 rules), "implementation" (4), "reader" (~25), "publisher" (~7),
"hub" (~14), "writer" (~5), "producer" (~3), and ~19 subjectless passives. "App" and
"implementation" are undefined in §1 and mean different things in different places. Concrete lines:

- "app" as publishing-app subject: spec lines 134, 135, 452
- "app" as reading-app subject: spec lines 137, 447, 472
- "implementation" as any-code subject: spec lines 175, 292, 313, 479
- "writer" overlaps with "publisher" (§8 only); "producer" overlaps with "publisher" (§2 only)

**Stale section references.** 69 stale references across 22 active files. The mapping:
§7.5→§7.4 (21 hits), §13.x→removed (20), §4.6→§4.4 (8), §4.7→§4.5 (8), §11→§10 (5),
§12→removed (4), §3.8→§3.6 (2), §14.3→removed (1). Heaviest files: `examples/reading/reading.md`
(7), `examples/the-index/the-index.md` (6), `examples/contests/contests.md` (8),
`examples/envelope/envelope.md` (5). Also in src: `reader.js` (§7.5×2), `publish.js` (§11),
`index.js` (§4.7); in tests: `reader.test.js` (3), `hub.test.js` (1), `index.test.js` (1); in
tools: `regen.js` (2), `revert.js` (3); in `CLAUDE.md` (4), `GOALS.md` (2). The §13.x references
in example `.md` files need rephrasing since security considerations is no longer a section.

**`examples/README.md`** references stale example names `the-reader` (→`reading`) and
`publish-interface` (→`publishing`) in the contract section (line 18), and describes each example
`.md` as having a Contrast section (lines 21–25) — now mostly moved to `COMPARISON.md`.

**DISTRIBUTION-MODEL.md** — six things with no home yet, kept here as the only record: the two
cache classes and why the split is correctness not tuning; how cache skew between the index and
posts manufactures a false `host` verdict against an honest publisher; the lower bound on §8.8's
grace window; what §8.7's "a pass, an account, a rate limit, a bill" is *not*; moderation stated
honestly; and third-party processing of other people's decrypted content.

## Traps

- `tools/spec.js --write` rewrites all of `open-feed-spec.md` and `tools/regen.js --write` all of
  `test-vectors.md`. Anything hand-typed into either is lost on the next `--write` — edit the
  `rule()` in the script instead.
