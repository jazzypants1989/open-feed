# syndication — what shape records where the copies went?

**Question.** A POSSE publisher needs a record of which foreign URIs hold each item's copies — to
route an unlinked foreign reply home, and to know what to retract when the original is deleted.
Three candidate shapes: (A) a `_syndication` field on the item, bump-and-re-sign; (B) a chained
syndication document in the §16 mold; (C) content-less receipt relation items in an activity feed.

**Method.** Model all three at family-decade volume — 100 posts × 2 targets (Mastodon + Bluesky)
— with real signatures, real manifest chains, real byte counts. Drive each through the same flows:
syndicate, route a foreign reply by its silo URI, delete one post and attempt retraction **from
public bytes alone** (the lost-laptop case), recognize a re-ingested stray copy as a duplicate.

**Numbers** (stale if §7.3's tombstone allowlist, §9.2's manifest growth model, or the manifest
shape changes — and see the verdict for what the B column actually priced): signatures 200 / 200 /
300; retained manifest KB 760 / 384 / 1908, plus 664 KB of retained syndication-doc history for B;
route lookup 51 / 1 / 101 scan ops. Retraction from public bytes: A **NO** — the §7.3 allowlist
strips `_syndication` from the tombstone, losing the target URIs at exactly the moment they are
needed; B and C YES. C's receipts survive retraction as permanent published statements of where
the copies went — the disclosure the map should let you erase.

**Verdict.** Shape B, **unchained** — README's `_syndication` convention, a signed document
referenced from the identity document. **The mandatory caveat for anyone reading the old table:
the adopted shape is unchained, but the B the experiment measured and priced was chained
(seq/prev, retained versions) — so its cost table overstates the adopted shape's cost, and the
chaining is what its numbers priced.** The chaining bought nothing: the map carries no authority
anyone verifies against, so a map nobody verifies has nothing for a pin to protect, and chaining
only makes the disclosure permanent (§5.4) when deletability is the point. Dropping the chain
keeps B's wins — one fetch to route, survives the tombstone allowlist, deletable outright — and
deletes both of B's measured headline costs. Only A and C were rejected on their measured numbers.

**No gate.** The adopted shape is a README-level convention, not a spec mechanism: nothing in
`src/` implements it, so there is no shipped code to drift out from under the claim. The
original's own assertion gate was a single `sane` boolean over four flow flags of its modelled
shapes, so archiving it loses almost nothing that was actually enforced.

**Original:** `tmp/archive/syndication-prototype.js` (the three modelled shapes, the full
comparison table, and the flow narration).
