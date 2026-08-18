# inbox — is §10.2's order a real property, and does dedup survive a migration?

**Question.** §10.2 is the only numbered list in the specification whose numbering is normative,
and its two ordering rules — cheap local checks before any outbound fetch, the dedup store read
at step 5 but never written before step 8 — are invisible in the output of a correct
implementation *and* of a wrong one: the forgery draws the same status either way. Is the order
observable at all, and does §10.3's `(author, id)` store survive what §3.4 does to an author?

**Method.** Run the **shipped** `createInbox`/`DedupStore` (the original hand-rolled the
pipeline; the gate does not) with the outbound fetch stubbed to a counter — §13.5's discipline is
tested in `test/`, and what is untested is WHEN the fetch happens, which a socket obscures.
Observe fetches **by position** (`fetches`, `fetchesBeforeVerify`) for a relevant delivery, a
forged signature, and an irrelevant sender; run §10.3's write-before-verify defect both ways by
injecting the one forbidden write; check C1's id-half relevance against a feed-URL-only receiver
and §8.1's `root` entry at the thread host; retract a delivered-only note after the author's §3.4
migration, with and without the `equivalent` predicate; price §10.4's existence oracle keyless.

**Numbers.** `1` outbound fetch per relevant or forged delivery, `0` for an irrelevant one, `0`
before step 7 always — these are load-bearing: they *are* §10.2's property, since status codes
cannot reveal it. Stale if `src/inbox.js` reorders the pipeline, adds a fetch (e.g. `confirmTarget`
turning outbound), or changes the identity cache so a first contact costs other than one. The
`202`/`401`/`400`/`409` statuses are §10.4's table and go stale only with it.

**Verdict.** The order is real and cheap: an unauthenticated sender not talking about the inbox
owner buys zero outbound requests; one who is buys exactly one, to a fixed path derived from the
claimed author (§13.9). §10.3's early write is the cheapest denial in the protocol — a victim URL
and an item id, no key — and silent in both directions, since the forgery is rejected either way;
§13.9 now carries it (ADOPTED). The unlooked-for finding also ADOPTED: §10.3's dedup key was not
migration-aware though §4.4's identically-shaped record explicitly was, so a post-exit retraction
of a delivered-only item filed as a stranger's new item and the sender got a `202` saying it
landed. §10.3 now subjects the `author` half to predecessor equivalence; `src/inbox.js` takes an
`equivalent` predicate, and the gate runs the failure with it absent and the cure with it present.

**What the gate guards** (`inbox.js`, revert-checked 2026-08-17: each proposed mutation was applied in turn, the gate failed naming the broken claim, and the tree was restored green (runner: the mutations recorded above)): the fetch counts stay pinned to the
step-7 boundary, the shipped write order keeps the victim's genuine revisions accepted, relevance
keeps refusing strangers before any fetch, and `DedupStore.write` keeps landing a successor's
retraction on the predecessor's record. Proposed revert-check mutations, each matching exactly
once in `src/inbox.js`:

1. `if (!relevant(item) && !tombstoneOfStored) return out('not_relevant');` →
   `if (false) return out('not_relevant');` — should fail the irrelevant-sender, C1, and §8.1
   claims (the refusals become acceptances).
2. `holders.set(existing?.author ?? me, version);` → `holders.set(me, version);` — should fail
   the with-`equivalent`-predicate claim (the retraction files beside the original again).

**Original:** `tmp/archive/inbox-prototype.js` (scene narration, the hand-rolled §10.2 pipeline
with its `writeBeforeVerify` flag, and the full §10.4 pricing discussion).
