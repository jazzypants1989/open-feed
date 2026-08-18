# manifestindex — should the manifest be the index, and the feed a Level 0 surface?

**Question.** Once §7.6 gives every committed revision its own URL, does a verifying reader still
need the feed at all? The strong proposal: Level 1 goes manifest → items, `feed.json` becomes what
`feed.xml` is — a surface for readers that do not verify — and with it dissolve §6.3's
parser-equivalence paragraph, §9.3's pagination scoping, and §13.4's feed-page caps.

**Method.** Build a ten-year family journal (3 items/day, heterogeneous sizes, real bytes on a
1/10 sample) with the shipped `Publisher`; price cold and warm reads under both designs in bytes,
requests, and modelled latency against §13.4's concurrency cap of 10; price the publisher's §7.6
obligation against what it already owes; then test, claim by claim, what spec text actually
dissolves.

**Numbers.** Cold, manifest-as-index costs **48× the requests** (10,611 vs 221) for the same
bytes. Warm, it saves **55 KB out of 163 KB**, because the manifest is **~65% of the poll under
both designs** — a cost neither design touches, so the index question is decided in its noise. (A
2026-08-17 rerun on current `src/` lands within 2%: 57 KB of 165, 64%.) Stale if: the manifest's
shape or serialization changes (`src/manifest.js`, §9.1's chain fields), the corpus assumptions
move (item sizes, 3/day cadence, 50-item pages), or §13.4's per-origin cap of 10 changes.

**Verdict.** SPLIT. **Adopted:** §7.6 promoted to a Level 2 MUST — its storage is a rounding
error beside retained manifest history, and it is the only thing that makes §9.3's withholding
verdict reachable. **Rejected:** manifest-as-index, on three independent grounds — the 48× cold
cost against a cap that exists precisely to stop one read becoming thousands of fetches; the warm
saving that is noise beside the manifest both designs pay for; and the structural one, which is
fatal regardless of cost: an item the manifest has not yet committed **has no §7.6 URL**, and
§9.2's recommended batching guarantees such a window always exists, so a reader without the feed
sees everything except today. Nor does the spec text dissolve: §6.3 must still define the hash of
an item parsed out of an array, because that is what the manifest commits.

**No gate**, deliberately. The rejection rests on model numbers about a synthetic corpus and on a
structural fact now written into the spec (§9.3's "the feed is not thereby retired"), not on a
property of `src/` that could drift. And the original's own gate was weak evidence: one of its
four rows was dead code — `feedItems.some(...) || true` can never fail — so the runner proved
less than it appeared to. The adopted half is guarded where it lives: §12's Level 2 list and the
withholding-capability card.

**Original:** `tmp/archive/manifestindex-prototype.js` (corpus construction, the full cost table,
and the Q3 claim-by-claim dissolution test).
