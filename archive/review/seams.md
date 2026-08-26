# Seams review — ebfdd0a..HEAD

Read-only review of the six seams named in the brief. Nothing was modified; `npm run revert` was
not run. Line numbers are at HEAD (fbd873a).

## Findings by severity

### Medium

**M1. The two readers now disagree on `why` for a `top` shape failure, and only one of them sees
two of the three shape rules at all.**
`src/reader.js:33` now passes `checkIndex`'s message through verbatim — `'top is below the highest
number issued'`, `'entries is not the first member'`, `'version is not a non-negative integer'`
(`src/index.js:30-32`). `examples/weekend-reader/weekend-reader.js:165` still returns
`'the index does not fold'` for a `top` below the fold's `top`, and does not check `entries`-first
or `version` shape at all (it would read such an index as `ok`). So after the edit: same verdict
(`host`) but a different `why` between readers for a bad `top`; and a `host`/`ok` verdict split for
the other two shape rules, which predates the edit. Nothing in `tools/regen.js`'s vectors exercises
an invalid index, so the divergence is unobserved by "both readers agree". Before the edit the
prefix `'the index does not fold: …'` at least made `src/`'s wording a superset of the weekend
reader's; now they share nothing on that path. If the edit stands, the weekend reader's line 165
needs the same split (a one-line change, below the 200-line ceiling with room), or FINDINGS.md
should record the divergence explicitly.

**M2. The new `src/reader.js` label is spec-correct, but no assertion anywhere observes it through
the reader.** §4 (the table and the "`entries` MUST come first" paragraph, spec lines 322-335)
carries the shape rules; §4.2 (line 345) is only the fold; §7.2 step 7 (line 636) says "Fold the
entries (§4.2) and check `top`" as two acts. Separating the labels matches that. But
`examples/the-index/the-index.js:75` asserts the bare fold string for a true fold failure (which
was unprefixed before the change too), and `:76` asserts `checkIndex` directly rather than through
`reader.read`. No test in `test/` and no example drives a shape failure through `createReader`.
The changed line is therefore a behaviour change with zero coverage; `tools/revert.js:208` (the
one `the-index` row aimed at `src/reader.js`) should be checked to see whether it reaches this line.

### Low

**L1. `'a index'` → `'an index'` (`src/index.js:42`) is app-visible too.** It is a `why` string a
client could match on. Nothing in this repo does (grep clean outside `test/index.test.js:41` and
`test/reader.test.js:65`, both updated in the same commit `6b6fc88`), so it is cosmetic here, but
HANDOFF §4.3 lists only the reader.js change as "the one to check"; there are two app-visible string
changes, not one.

**L2. `examples/fetching/fetching.js` — justification holds; two nits.** The redirect loop is
`request()` in `src/fetch.js:104-126` and calls `http/https.request` directly at `:85`; the only
injection points are `resolve` and `tls` (`:60-61`). A fake fetcher of the kind `the-reader.js:22-27`
injects replaces `fetch.js` entirely, so it cannot exercise `fetch.js`'s redirect or cap rules — the
socket is genuinely required unless `src/fetch.js` grows a transport seam, which would be a `src/`
change made to serve an example. Server binds `127.0.0.1` only (`:66`); the loopback-permitting
fetcher is a separate `local` instance with `protocols: ['http:']` (`:68`) and never touches the
default `consumer`. `origin.close()` at `:84` runs only on the happy path; an assertion failure
before it rejects the top-level await and the process exits non-zero, so nothing leaks. The port
never reaches stdout (`fetching.out.txt` grep for `:\d{4,5}` finds only the static `127.0.0.1`
rows), and the one runtime count printed (`saw.length`, `:74`) is deterministic (6). Nits: `hop('/big')`
runs twice (`:81` and `:83`); HANDOFF says the server closes "before the last three blocks" — two
blocks follow (`:86` and `:100`).

**L3. `examples/README.md`'s three-file contract is technically honoured by the capstones, but
the marker convention that makes that true lives only in `CLAUDE.md` traps and the gates' comments.**
Not a defect; noting that `examples/README.md` does not mention the marker at all, so a reader of
the contract alone will not know why `weekend-reader.js` is 398 lines under a ~120-line rule.

**L4. Marker fallbacks differ.** The gates fall back to the whole file when no `// ====` line exists
(`court-gate.js:21`, `weekend-gate.js:18`: `end < 0 ? src.length : end`). The capstones do not
(`weekend-reader.js:249`, `weekend-publisher.js:103`: `slice(0, findIndex(...))` — a `-1` silently
drops only the last line). Either way a deleted marker fails the `< 200` assertion for the reader
(398 lines) so it would be noticed; the publisher (189 total) would pass at 189 and mis-report. Low.

## Seam-by-seam answers

### 1. The four `src/` edits (`git diff ebfdd0a..HEAD -- src/`)

Every changed line, all in commit `6b6fc88`:

- `src/index.js:42` — `bad('a index older than the one this reader saw')` → `bad('an index older …')`. App-visible `why`; tests updated (`test/index.test.js:41`, `test/reader.test.js:65`; a comment at `test/reader.test.js:85`). Otherwise cosmetic.
- `src/profile.js:71` — JSDoc return shape drops `switched`, which `verifyProfile` never returned. Comment only.
- `src/reader.js:32-33` — one comment line added; `if (why) return bad('host', why === 'the index does not fold' ? why : \`the index does not fold: ${why}\`)` → `if (why) return bad('host', why)`. **Behaviour change** in `why` for the three `checkIndex` failures; verdict unchanged. Correctness and coverage: M1, M2.
- `src/wordlist.js:1` — comment `§4.1` → `§3.1`. Comment only (§3.1 is the spoken code; correct).

Does anything match on the old string? No. `grep "does not fold"` outside `_seeds/` hits only `src/reader.js:33`, `examples/the-index/the-index.js:66,75` and `.md:36,39`, `examples/weekend-reader/weekend-reader.js:165` and `.out.txt:23`, `README.md:217`, and the spec — all the bare form for true fold failures. Nothing used the prefixed form.

Consistency between readers: no — see M1.

Are the other three truly cosmetic? Yes: two comments and one wording change in a string that has no matcher in the repo.

### 2. `examples/fetching/`

See L2. Summary: the justification is true given `src/fetch.js`'s structure; loopback only; closes on the happy path and exits on failure; output deterministic.

### 3. Duplicated argument

**`the-index.md` / `rewrite.md`** — the cross-version half of "one hash per number" is argued in full in both, including the same restore-from-a-thief rationale and the same staged test:

- `the-index.md:53-63`: "A number has one hash, ever. Appendix B.11 is the rewrite (§4.7) … Across a rewrite the fold cannot … the rule that reaches across versions is the reader's own memory. §7.2 makes the pinned reader keep the hash of every number it saw withdrawn, and the example runs one reader through four versions to show it … Re-listing at the identical hash is allowed because it is harmless — and because it is the way back from a thief who held the current key and withdrew everything the owner wrote."
- `rewrite.md:42-49`: "A number that comes back. Appendix B.11 re-lists post 2 at the hash it had … the pinned reader accepting it and then … the same number back at a different hash — coming back as host, because the pin remembered. The rule exists for the restore: a thief who held the current key and withdrew everything is undone by the owner re-listing her own posts … The fold's half of the same rule — one hash per number inside a single index — belongs to `the-index/`."

`rewrite.md` already draws the line ("the fold's half belongs to `the-index/`"); `the-index.md` does not honour it from its side. **`the-index.md` should keep only the in-index fold rule and point at `rewrite/` for the pin-across-versions rule and the thief rationale** — its `:53-63` collapse to two sentences. Same for the 6% figure: `the-index.md:109` ("leftover withdrawal lines at roughly 6% of the file") restates `rewrite.md:51-56` ("Six per cent, measured … 5.5%"); point, don't restate. (`the-index.js` also stages a four-version pinned read, so the scripts overlap too; that is a length question for Stage B's owner, not this review.)

**`recovery-list.md` / `contest.md`** — `recovery-list.md` says "Read that rule there rather than reconstructing it here" (`:99`) and reconstructs it three times:

- `recovery-list.md:32-37` "The count of leaves is public, and MUST be … a contest … is settled by a majority … Hide the count and a forger with one voucher can call it a majority of a list only he can count." vs `contest.md:60-70` "Majority, and not `k` … under a threshold of `k`: his 1 ≥ 1 … under a majority: 1 of 3 is not more than half."
- `recovery-list.md:39-45` "`k` is not the test that settles a contested identity — that one is a majority (§3.6), and the two differ exactly where it matters, on the adversary who is himself on the list." — same point again.
- `recovery-list.md:94-99` (Contrast, "The abuser on the list") "under a threshold, one listed adversary vouching for himself hands himself the identity; under a majority he cannot do it alone, ever." — third time.
- `recovery-list.md:57-64` "A list with one other person hands that person the identity … a reader that already saw the list of one there keeps it, because a recovery list is never overwritten once a reader has seen it (§3.6 rule 2)" vs `contest.md:37-44` "A recovery list is kept per chain length, and is never overwritten."

`contest/` owns §3.6. **`recovery-list.md` should keep one sentence per point plus the pointer**: the count is public because §3.6 needs a denominator (keep, one line); `k` vs majority (cut `:39-45`'s second half and the whole `:94-99` paragraph); never-overwritten (keep the staged fact at `:57-64`, cut the explanation of the rule, point at `contest/`).

### 4. Length

`wc -l examples/*/*.js`: over ~120 — `publish-interface` 201, `the-reader` 185 (both under the §7/§8 amendment), `posts-and-targets` 180, `envelope` 167, `moving` 147, plus the capstones (398/189, exempt by the marker design). At or under: `views` 138, `your-copy` 139, `contest` 134, `the-chain` 133, `top-and-rumors` 133, `padding` 130, `the-index` 129, `rewrite` 126, `media` 121, `first-contact` 120, `recovery-list` 119, `fetching` 115, `json-hygiene` 85, `signed-file` 83, `no-canonicalization` 78.

What could go without losing an asserted §-rule of that example:

- **`posts-and-targets.js` (180)**: the §5.6 block `:162-178` (inbox 404, host cannot open, host withholds) asserts §6 and §7.4/§13.3 facts that `envelope/` and `the-reader/` own; with it goes the seeded envelope at `:37-43` and the `encrypt/decrypt/carrierOf/readingKeyFromSeed` import, since §5.3 (`:113`) and §5.5 (`:157-160`) only need an opaque `encrypted` object. The §5.1 reclaim block `:86-92` is §8.5 and says so ("examples/publish-interface/"). Roughly 30 lines, leaving ~150.
- **`envelope.js` (167)**: the §7.4 block `:154-165` carries a ~900-character B.8 literal to assert byte-for-byte what `tools/regen.js` already checks with both readers, and its rule ("verify completely, hand back opaque") is §7.4 / `the-reader/`; drop it and assert only `address(post5)` if a vector tie is wanted. The §6.5 audience block `:118-143` (four hosted profiles, `readKeyFor`, the split thread) is a second concept — it is what `_seeds/audience-gate.js` staged — and is the natural candidate for "it is two examples". Either cut gets under ~140.
- **`moving.js` (147)**: the §6.6 block `:138-145` restates `envelope.js:146-152` (same rule, same assertion shape) — cut, point. The forged-post half of the beacon block (`:102-109`, `:125-127`, `:134`) asserts `host: post 1 is not what the index lists`, which is `the-reader/`'s §7.4 rule; keep bro's genuine beacon post (`:111-136`) since "locations held first, reply `loc` last" is the §3.7/§7.5 point here, though `fetching.js:100-110` asserts the same order. ~20 lines.

### 5. The `// ====` marker

- Gates slice at the marker: `examples/_seeds/court-gate.js:21`, `weekend-gate.js:18` — `findIndex(l => l.startsWith('// ===='))`, count non-blank non-`//` lines above it. Capstones use the identical predicate (`weekend-reader.js:248-250`, `weekend-publisher.js:102-104`).
- The count asserted is of the slice above the marker only: `court-gate.js:147,186` (`readerLines < 200`), `weekend-gate.js:143,165-166` (reader and publisher `< 200`), capstones `:288` / `:137` (`measured < 200`). Recomputed independently with awk: reader **170**, publisher **51**, matching PLAN.md.
- Above the marker only to serve the demo: **none**. Reader: `read` and `rumors` are §7/§7.5 and are what `tools/regen.js:15` imports; no demo helper sits above `:237`. Publisher: every export above `:94` is a §3.3/§4.7/§8 primitive; `newKey` (`:10`), `vouched` (`:27`) and `relist` (`:82`) are called only from `_seeds/` (`court-gate.js:46`, `coldcourt-gate.js:69,71`, etc.), not by the demo or by `regen.js`, but each is one line and is publisher API, not demo scaffolding. Vice versa (implementation hiding below the marker): none — the demo's seeded keys (`weekend-reader.js:252-257`), in-memory hub (`weekend-publisher.js:116-129`) and the deferred `import` of the publisher (`weekend-reader.js:247`) are demo material and correctly below. The reader's `isMain` guard (`:241`) is below the marker, so `regen.js` importing the module runs nothing.
- See L4 on the fallback asymmetry.

### 6. Files outside the named set

`git diff ebfdd0a..HEAD --stat`, 78 files. Outside `examples/ tools/ src/ test/ README.md GOALS.md PLAN.md FINDINGS.md SPEC-CUTS.md HANDOFF-review.md archive/ package.json`:

- **`CLAUDE.md`** (+8/−5): table rows rewritten for `src/` (drops "(+ encrypted media)" and "(BIP-39 as data)"), `examples/` (defers to `examples/README.md`, `_seeds/` → "see PLAN.md before deleting"), a new `FINDINGS.md` row, the `README.md · DISTRIBUTION-MODEL.md · TLDR.md · GOALS.md` row becomes `README.md · GOALS.md`; the "Editing the README" rule loses "keep the TL;DR under a page … keep examples consistent with the spec's object model" and gains "point at the example that argues a thing"; one new trap about the `// ====` marker. Consistent with the file's own gate.
- **`TLDR.md`** deleted (−39) — HANDOFF §4.6.
- `archive/DISTRIBUTION-MODEL.md` (−3) — under `archive/`, in the set.
- `package.json` shows no change in the stat.

**`open-feed-spec.md` is byte-identical**: `git rev-parse ebfdd0a:open-feed-spec.md HEAD:open-feed-spec.md` → `a79c73db3c58fa986943fb0937441c63e545ff0a` both; `--stat` lists no change.
