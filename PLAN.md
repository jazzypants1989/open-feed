# Plan: the rewrite session

**The mechanism.** An example script proves a rule with an assertion, then prints it with `rule()`
(`tools/rule.js`). `tools/spec.js` runs every example in reading order and assembles the printed
rules, under a hand-held list of section headings, into `open-feed-spec.md`; `tools/regen.js`
generates `test-vectors.md` the same way. A rule no script proves is not in the spec. Hand-written
content in the spec is the Summary, §1 Terms, and the headings — nothing else. `node tools/spec.js`
fails on drift; `--write` regenerates.

## What is done

The spec generation (§2–§10) and the wire-format rename are complete. Every section is generated
from examples, and every terse wire member is spelled out:

| done | old → new |
|------|-----------|
| §2–§10 generated | one `rule()` per spec rule, proved by an assertion |
| `n` → `number` | post bodies, targets |
| `loc` → `location` | targets, audience entries |
| `epk` → `ephemeral` | envelope header |
| `ct` → `ciphertext` | envelope body |
| `sig` → `signature` | chain links |
| `top` → `highest` | index object |
| Contrast → `COMPARISON.md` | bulk moved; `weekend-publisher.md` still has one removable section |
| `examples/README.md` | updated for current script names and contract |

## What remains — owner-approved, in order

### 1. Vocabulary rename

These are decided (owner approved the specific replacements). Each changes spec terms and code.

**fold → replay.** `src/index.js`: rename `fold()` → `replay()`; import in `src/reader.js`;
error message "the index does not fold" → "the index entries are invalid" or similar; `rule()` calls
in `examples/the-index/the-index.js` and `examples/reading/reading.js`; section heading in
`tools/spec.js` ("Entries and the fold" → "Entries and replay").

**pin → checkpoint.** Broad rename — §1 Terms definition, all `rule()` calls that say "pin" or
"pinned", `src/reader.js` parameter and return property, `src/index.js` `checkAgainstPin()` →
`checkAgainstCheckpoint()`, `src/profile.js` `pin` parameter, all tests and examples, `CLAUDE.md`
vocabulary list (`pin` → `checkpoint`).

**carrier → postBinding.** Drop the term from spec rules; describe the AAD binding inline.
`src/envelope.js`: `carrierOf()` → `postBinding()`. Update `src/openfeed.js` re-export,
`examples/posts/posts.js`, `examples/envelope/envelope.js`, `tools/regen.js`, and any tests.

**split → describe inline.** §3.4 rules only (spec prose, no code): replace "the split" with "the
point where the chains diverge" or similar. "at the split" → "at the divergence point."

**host/identity verdicts → tampered/contested.** `src/profile.js` (`'identity'` → `'contested'`,
`'host'` → `'tampered'`), `src/index.js`, `src/reader.js`, `src/cli.js`, all test assertions, all
example assertions, `rule()` calls in `examples/reading/reading.js` defining §7.2.

Regenerate spec and test vectors after all renames. Run `npm run check`.

### 2. Voice cleanup

Unify the publish-side subject to three defined roles (publisher, reader, hub). Edit the `rule()`
calls in the example scripts, then regenerate the spec.

| current | becomes |
|---------|---------|
| `producer` (§2, 2 uses) | `publisher` |
| `verifier` (§2, 1 use) | `reader` |
| `writer` (§8, 3 uses) | `publisher` |
| `app` as publish-side (3 uses) | `publisher` |
| `app` as read-side (4 uses) | `reader` |
| `implementation` as read-side (3 uses) | `reader` |
| `implementation` generic (1 use, wordlist §3.1) | keep as `implementations` |

### 3. Structural spec changes

**§8.7 — separate CORS from hub autonomy.** Currently one paragraph mixing two concerns. Split into
a CORS subsection and move the hub-autonomy MAY elsewhere (its intro or a new subsection). May
renumber §8.8–§8.9.

**§8.5/§8.6 clarity.** Rephrase "reclaiming a number" and "media hash replacement" for readability
without changing semantics.

**§7.1 — break up overcrowded steps.** Step 8 packs 5 distinct rules with semicolons. Break into
separate numbered steps or group by phase. Edit the `rule()` call in `examples/reading/reading.js`.

**Adversary model.** Add one sentence to the Summary. It already says "may not be on your side" —
strengthen to name the adversary: the operator of a family hub who is an abuser, controlling the
serving path and refusing to cooperate.

**§10 — consider `<link rel="alternate">`.** WebFinger is already a rule. The example prose
discusses `<link rel="alternate">` but there is no `rule()` call. Decide whether it needs one.

### 4. Stale reference cleanup

**§13.x/§12/§14 in example `.md` files.** ~20 references to removed sections (security
considerations, appendices). Each needs rephrasing — not a find-replace. Files:
`the-index.md` (4× §13.1), `contests.md` (4× §13.3, 1× §13.1), `envelope.md` (2× §13.3),
`reading.md` (1× §13.3), `publishing.md` (1× §12, 3× §13.1), `posts.md` (1× §13.2),
`weekend-publisher.md` (1× §12).

**GOALS.md.** Remove spec section references entirely — the document should express goals without
citing spec numbers. Owner has explicitly authorized this.

**Weekend-publisher contrast.** Remove the Contrast section from
`examples/weekend-publisher/weekend-publisher.md` — content already in `COMPARISON.md`.

**Remove dead tooling.** Delete `tools/examples.js`, `tools/revert.js`, all
`examples/*/*.out.txt`, and `examples/_seeds/` entirely. None is in `npm run check`; `.out.txt`
is redundant with `npm run spec`; `_seeds`/`revert.js` are brittle mutation tests not in CI.

### 5. Document rewrites

**TLDR.md.** Drop "encrypted" from glossary. Editing pass: update vocabulary to the new terms.
Stay within budget (≤200 words how-it-works, ≤100 words guarantees, ≤10 glossary terms). Verify
with `npm run tldr`.

**README.md — full rewrite.** Current README has a stale-content banner and describes the old
protocol (identity as a URL, `openfeed.json`, manifests, JOSE, conformance levels). Rewrite for:
identity is a key, profile + index + posts, signed files with Ed25519, the encryption model,
publisher/reader/hub roles, WebFinger for discovery. Reference the spec for definitions, examples
for explanations.

**PLAN.md — final update.** Close out the rewrite session. Whatever remains (DISTRIBUTION-MODEL.md,
scenario 7 interop beyond WebFinger) becomes the new agenda.

## Verification

After each batch of changes:
```
npm run spec -- --write
npm run vectors -- --write   # after any change to signing, document shape, or the envelope
npm test
```

Final: `npm run check` (tests + vectors + TLDR budget).

## Traps

- `tools/spec.js --write` rewrites all of `open-feed-spec.md` and `tools/regen.js --write` all of
  `test-vectors.md`. Anything hand-typed into either is lost on the next `--write` — edit the
  `rule()` in the script instead.
- The `n` → `number` rename taught a lesson: a batch script that renames wire-member patterns
  (`{n:`, `.n`) misses function parameters and callback variables that carry the same name. Verify
  every example runs (`npm run spec`) before declaring a rename done.
- `GOALS.md` and `DISTRIBUTION-MODEL.md` are owner documents (`CLAUDE.md` says so). Do not edit
  without an instruction that names the file. GOALS.md editing was authorized for removing spec
  section references.
