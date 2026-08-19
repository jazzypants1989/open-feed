# feedbinding — can canonicality stop naming a location?

**Question.** `_openfeed.feed_url` does three jobs inside an item's signed bytes: publication
marker (§8, §11.1.1), locator for the governing manifest (§7.5), and canonicality (§7.5). The
third names a *location*, and a location changes when an identity moves, so §3.4 has to buy it
back with exception text in §7.5 and §9. Candidate: keep jobs one and two, and make canonicality
compare identity URLs instead — `_feed_owner`, defaulting to `authors[0].url` — so a migrated
back catalog is canonical by the predecessor equivalence the verifier already runs (§6.5 step 6),
not by an exception written for it. Kill criterion, stated up front: if the clause count does not
drop, or preserving the multi-author board (§7.1) costs a rule as long as the one replaced, keep
`_openfeed.feed_url`.

**Method.** Both rules as functions over the same signed corpus (items built with the shipped
`sign`, URLs compared with the shipped `normalizeUrlForCompare`/`normalizeIdentityUrl`): (Q1)
four ordinary cases — own feed, injection into a stranger's feed, delivered-only, re-signed
plagiarism; (Q2) a byte-verbatim back catalog served at the successor feed, read by a consumer
that verified the migration and by one that did not; (Q3) the multi-author board — a contributor
opting in under each rule's noun, an un-opted-in copy, and the board owner *moving* the
contributor's item into her primary feed; (Q4) the deleted spec text counted by locating the
§7.5 and §9 passages in the shipped spec, not from memory.

**Numbers.** ~106 words of exception text would delete (the §7.5 "One mismatch is not a copy"
passage plus §9's predecessor `feed_url` carve-out). Stale if either passage is reworded or
moved — the gate greps the same anchor sentences and fails when they no longer resolve, which is
what keeps the figure honest.

**Verdict.** **Keep `_openfeed.feed_url`** — precision over brevity. The candidate works: every
ordinary case agrees, the migrated back catalog is canonical with no exception, the board
survives by contributor opt-in. But `_feed_url` names *one feed* where `_feed_owner` names an
identity that may own twenty (§13.4). Concretely: Dad contributes to Mom's family board by
signing `_feed_owner: https://mom.example/`; Mom then serves those same bytes in her primary
feed, and because she owns both feeds the owner still matches — Dad's item reads as canonical
somewhere he never put it. Under `_feed_url` that move is a copy. Mom cannot forge the bytes,
but she can move them, and recovering the lost precision means naming the feed again — which is
where we started. The exception text is the price of precision, not an accident. Also: the
candidate deletes only two application sites of predecessor equivalence, not the relation (job
two still compares feed URLs), and `_feed_owner ?? authors[0].url` adds a second
absence-means-something rule beside §11.1.1's load-bearing one.

**What the gate guards** (`feedbinding.js`, revert-checked — the mutations below are rows in `tmp/revert-gates.js`, and `npm run prototypes:revert` re-applies each one and requires the gate to fail): the two rules keep agreeing
everywhere except Q3 — in particular the Q3 asymmetry itself, moved-item-stays-canonical under
`_feed_owner` and copy under `_feed_url`, which is the whole reason the candidate was rejected;
the shipped URL comparator keeps distinguishing two feeds of one identity; and the §7.5/§9
passages behind the ~106-word figure stay locatable. Revert-check mutations (rows in `tmp/revert-gates.js`), each a
one-line edit matching exactly once:

1. `src/jws.js`, in `normalizeUrlForCompare`: `return url.href;` → `return url.origin + '/';`
   — collapses an origin's feeds into one URL, so the moved board item becomes canonical under
   `_feed_url` too and the Q3 assertion fails.
2. `open-feed-spec.md`, §7.5: `which is the safe reading.` → `which is the safest reading.`
   — moves the grep anchor, so the passage-location assertion fails.

**Original:** `tmp/archive/feedbinding-prototype.js` (scene narration, the per-case verdict
tables, the survives-list of what the candidate does *not* delete, and the full three-point
verdict text).
