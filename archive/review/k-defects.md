# Review: the two `k` defects (FINDINGS.md §1.1, HANDOFF-review.md §3)

Independent reproduction, from scratch, against `src/` and against the second reader. Script:
`tmp/review/k-repro.js` (imports only `src/` and `examples/weekend-reader/weekend-reader.js`; runs
with `node tmp/review/k-repro.js`; touches nothing tracked). Nothing was fixed.

## 1. Result

Both defects reproduce exactly as described, in **both** readers, and a verifying hub stores the
forged profile too.

| case | `src/profile.js` `verifyProfile(forged, {learned, pin})` | `weekend-reader.js` `read(get, {learned, at, pin})` | `src/hub.js` PUT (§8.4) |
|---|---|---|---|
| (a) `{k:0, leaves:[]}`; thief appends `{key: thief, recovery}` with no `sig`, no `vouchers`, signs v2 with his key | `ok`, `chain.current === thief.x` (pinned **and** cold) | `ok`, `chain.current === thief.x` | 200, stored |
| (b) `commit(1,[mum,sis,ex])`; reader pinned at chain length 1; ex (holding no key of Alice's) publishes v2 = `restore(A1, EX, [ex], REC)` | `ok`, `chain.current === ex.x` | `ok`, `chain.current === ex.x` | (same path; would store) |
| (c) extra: `commit(1,[mum,ex])`, same move by the ex | `ok`, follows ex | `ok`, follows ex | — |
| contrast: reader pinned **after** Alice rotated once, then served the ex's self-vouched branch | `identity: contested: two histories, and no majority settles it` | (same code) | — |

The contrast row is the point: §3.6's majority rule works, but only when the served chain *diverges*
from the pinned one. In (a)/(b) the served chain **extends** the pinned chain key for key, so there
is no split, §3.6 rule 4 never runs, and the only gate is §3.3's per-link validity — which is `k`.

Note on the weekend reader: it initially answered `host: no index served` because my first run gave
it a profile only; with an index re-signed under the forger's key (which the forger can do, §4.6) it
returns `ok` and follows him. Its `walk` at `examples/weekend-reader/weekend-reader.js:84` is
character-for-character the same test as `src/profile.js:62`:

```
if (!linkSig(from, link.key, from, link.sig) && vouches(from, link, recovery) < recovery.k) return null;
```

## 2. The spec sentences that permit each

(a) `k` = 0:

- §3.3: "A link is **valid** when `sig` verifies, or when the number of **distinct** voucher keys
  that count is at least `recovery.k`." — zero counted vouchers is "at least" zero.
- §3.4: "The list MAY be empty." and "`k` is the threshold the author set" — no lower bound on `k`
  anywhere; §3.2's table gives `recovery` no constraint beyond "committed (§3.4). MAY be empty".
- §7.1 step 4: "Walk the chain (§3.3), judging each link by the recovery list held at its length."
  — the held list is Alice's own `{k:0}`, so the walk passes.

(b) `k` below a majority:

- §3.3, same sentence: 1 counted voucher ≥ `k` = 1 → valid.
- §3.6 rule 4 applies only "at the split" ("A majority of the recovery list **at the split** wins"),
  and rule 1 defines a split as "the first index at which a served chain differs from the pinned
  one". A chain that appends a link differs at no index, so there is no split and no majority test.
- §3.4's warning ("a list with one other person gives that person the identity at that chain
  length") and §13.3's repeat of it state only the n = 1 case; the general form (any `k` members
  when `k` ≤ n/2) is unstated.

**Verdict: the spec text is at fault, not only `src/`.** Both readers implement §3.3 faithfully; the
hub implements §8.4 faithfully (it walks the chain under the carried lists and it does hang
together). A conforming reader written from the text alone — which is what the weekend reader is —
has the same hole. §3.6's "Under a majority he cannot, ever, alone" is true only at a split, and
§3.6's own opening ("a link vouched by a recovery list of their own making ... Checking that the
chain walks is therefore not a test of anything") is contradicted by §7.1 step 4 + §3.3, which make
the walk the *only* test in the no-split case.

## 3. The proposed fix: "valid when vouchers ≥ `k` AND more than half of `leaves`"

### Does it close both?

Yes. With `v` = distinct counted vouchers, `n` = `leaves.length`:

| case | today (`v ≥ k`) | proposed (`v ≥ k && 2v > n`) |
|---|---|---|
| (a) k=0, n=0, v=0 | valid | **invalid** (0 > 0 false; an empty list can never restore, which is §3.4's stated intent) |
| (b) k=1, n=3, v=1 | valid | **invalid** |
| (c) k=1, n=2, v=1 | valid | **invalid** |
| B.5 vector: k=2, n=3, v=2 | valid | valid — **Appendix B is unaffected** |
| k=0, n=3, v=2 | valid | valid (`k` = 0 becomes harmless: majority governs) |

Also: it makes §3.3 and §3.6 consistent — any link valid as a restore automatically carries a
majority, so the pinned side of a split always has one, and a thief's side needs one to be valid at
all. Rule 4 could then be restated without "majority": the side whose link at the split is a valid
restore wins; both or neither → contested. (Both is still reachable: a coerced member can vouch on
both sides, as `examples/contest/` row 5 shows.)

### Edge cases (from `k-repro.js` block (d) and (e))

- **n = 1** (one other person): 1 of 1 is a majority → still hands that person the identity. Not a
  new problem; already stated in §3.4 and §13.3. Unchanged.
- **n = 2, k = 1**: now needs both. The "one-of-two restore against a bare rotation stays contested"
  case in §3.6 becomes "is not a valid link" — the profile reads `identity: the chain of key
  changes does not hold` rather than `contested`. The repair is the same (sis adds her voucher to
  the existing link, §3.3). This is the one *behavioural* change to an honest flow, and the spec
  already prices it.
- **Even n**: 2 of 4 is not a majority; 3 needed. `k` = 2 of 4 becomes a setting that cannot be
  what it says. Nothing in the repo uses an even non-empty list.
- **k > n**: impossible today and impossible after. Unchanged. Worth a sentence in §3.4 ("`k`
  greater than the count of leaves makes restore impossible"), but not a security matter.
- **k below a majority with the fix in place**: `k` becomes inert (the majority clause dominates).
  `k` only matters when set *above* a majority (e.g. 3 of 3). That means the fix does not quite
  deliver "one bar" — it delivers `max(k, majority)`. See alternatives.
- **A leaf that is the current key itself** (owner lists her own key as a "backup key you keep
  yourself", §3.4): the key being moved *away from* can vouch for the move (verified against
  `<prev>-><new>` like any voucher), so it counts as a vote. A thief holding that key gets one vote
  at a split — 1 of n, harmless for n ≥ 3, and for n = 1 it is the already-stated list-of-one case.
  Neither today's rule nor the fix changes this. A leaf that is the *new* key (`link.key`) vouching
  for its own arrival also counts, and that is the intended backup-key restore. No new problem.
- **Duplicate leaves / padding**: vouchers are counted by distinct key, leaves by count; an author
  who lists the same key under two salts raises the denominator without raising the numerator.
  Self-harm only (a thief cannot rewrite a held list, §3.6 rule 2). Unchanged by the fix.
- **`restored` flag**: unaffected (`sig === undefined` still defines it).
- **Pinned readers holding lists adopted under the old rule**: pre-release, moot.

### Simpler or tighter alternatives

1. **MUST `k` ≥ 1.** Closes only (a). Case (c) — `k` = 1 of 2 — and (b) survive. Rejected by the
   repro.
2. **`k` > n/2 as a profile-validity rule (`wellFormed`), i.e. reject any list whose `k` is not a
   majority.** Closes both *if readers enforce it* (an author's own list is the attack surface, so a
   publish-time-only rule at the hub/publisher is not enough — the reader must refuse to adopt or
   walk under such a list). Advantages: the invariant is visible in the file; `k` stays meaningful
   ("the author's threshold, which is at least a majority"); §3.3's validity sentence stays as is.
   Costs: every `{k:0, leaves:[]}` in the repo becomes malformed (needs `{k:1, leaves:[]}`); it
   adds a shape rule to §3.4 and a verdict path ("malformed") for something that is really a
   validity question; and a reader still has to compute the majority to check the rule, so it saves
   nothing at verify time. Equivalent in strength to the proposed fix; slightly more surface.
3. **Drop `k` from the wire; validity is majority, full stop.** The tightest reading of "one way of
   doing each thing": §3.3 and §3.6 use literally one bar, `k` stops being a second knob the author
   can set wrong, and the "majority, and not `k`" paragraph in §3.6 disappears because there is
   nothing to contrast. Cost: the author loses "3 of 3" (a stricter-than-majority list), which is a
   real preference for some; and it changes the committed shape, so **every vector in Appendix B
   regenerates** (`recovery` appears in B.2–B.5) and every `commit(...)` call site changes. Larger
   ripple; arguably the better design; not required to close the defects.
4. **Proposed fix as stated (`v ≥ k && 2v > n`).** Closes both, leaves the wire shape and all
   vectors intact, and keeps `k` as an optional *stricter* threshold. Recommended as the minimal
   change, with two prose amendments: §3.4 should say `k` is a floor that may exceed a majority but
   cannot go below one, and §3.6 rule 4 should be restated in terms of a valid restore at the split
   rather than a separate majority count, so the two sections share one sentence.

Whichever is chosen, `k` = 0 with an empty list should stay legal (it is the "no restore possible"
setting §3.4 describes and many examples use); under the proposed fix it is harmless.

## 4. Files the proposed fix would touch

Normative:

- `open-feed-spec.md` §3.3 (the validity sentence), §3.4 (`k` description; the "one other person"
  warning generalises), §3.6 (the "Majority, and not `k`" paragraph, the "price" sentence, and
  optionally rule 4), §7.1 step 4 (no text change needed, but re-read), §13.3 (the recovery-list
  bullet). Appendix B: **no vector changes** (B.5 is 2 of 3), but `node tools/regen.js` must run.

Code (both readers must agree or the vectors diverge):

- `src/profile.js:62` (`walk`). `majority` at line 37 can then be reused by `walk`.
- `examples/weekend-reader/weekend-reader.js:84` (`walk`); its `majority` closure at line 141.
- `src/hub.js` — no change (it calls `walk`).

Mutation table — rows quote the exact lines above and must be re-targeted:

- `tools/revert.js:54-55` (weekend-reader walk), `:193` (src walk), `:331-332` (src `majority` →
  `k` mutation; after the fix this mutation may no longer be distinguishable from the validity rule
  and needs re-thinking).

Tests / helpers:

- `test/helpers/site.js:52` and `test/reader.test.js:45` — `{k:0, leaves:[]}` remains a valid
  profile under the proposed fix (it just cannot restore). **No change required** unless alternative
  2 is chosen. FINDINGS/HANDOFF list them as ripple; that is only true for a `k` ≥ 1 rule.
- `test/profile.test.js:75-78` ("one voucher is below k=2") — still passes; `:80-86` ("a one-member
  list is a recovery of one") — still passes (1 of 1). Should gain the two new negative cases.

Examples (script + `.out.txt` + `.md` each):

- `examples/contest/` — restaged. Lines 92-101 (the `byK` vs `byMajority` block) lose their
  contrast; lines 103-116 (`hers` = 1-of-2 restore, `p6` pinned on it) cannot be pinned at all under
  the fix, so the "price" block becomes "the link is not valid until sis vouches" rather than
  "contested until sis vouches". `contest.md` lines 61-76.
- `examples/recovery-list/` — `recovery-list.js:78-100` (empty list, one-member list) still hold;
  `recovery-list.md:40-54, 103` prose about `k` needs one paragraph.
- `examples/the-chain/the-chain.md:45, 60` — prose only.
- `examples/posts-and-targets/posts-and-targets.js:31` (`commit(1,[sis])`) and
  `examples/first-contact/first-contact.js:27` (`commit(1,[bro])`) — 1 of 1 still valid; no change.
- `examples/moving/`, `top-and-rumors/`, `envelope/`, `views/`, `media/`, `weekend-publisher/`,
  `weekend-reader/` demo — all use `{k:0, leaves:[]}` or `commit(2, [])` as "no restore" and are
  unaffected.

Docs:

- `README.md:163-186` (the recovery-list explanation) and `:558-561` (the open-finding paragraph,
  to be removed once fixed); `FINDINGS.md` §1.1 (close); `SPEC-CUTS.md` / `PLAN.md` where they
  reference the finding; `examples/_seeds/court-gate.md` mentions `k` (seed card, stale anyway).

## 5. Summary

1. Both defects reproduce from scratch against `src/`: (a) `k`=0 and (b) `k`=1 of 3 each let a
   party holding **no** key of Alice's extend a **pinned** reader's chain to his own key, verdict `ok`.
2. The second reader (`weekend-reader.js:84`) has the identical `walk` test and returns `ok` on both;
   a verifying hub stores the forged profile (200).
3. The spec is at fault: §3.3 "at least `recovery.k`" + §3.4 "MAY be empty" + §3.6's majority applying
   only "at the split" — a chain that *extends* the pin has no split and only `k` guards it.
4. The proposed fix (`v ≥ k && 2v > leaves.length`) closes (a), (b) and the `k`=1-of-2 case, leaves
   Appendix B unchanged, and introduces no new hole; its one honest-flow change is that a 1-of-2
   restore reads "does not hold" instead of "contested" (same repair). `k` becomes inert below a
   majority — dropping `k` from the wire is the tighter design but regenerates every vector.
5. Ripple: spec §3.3/§3.4/§3.6/§13.3, `src/profile.js:62`, `weekend-reader.js:84`, `tools/revert.js`
   rows 54-55/193/331-332, `examples/contest/` (restaged) plus prose in `recovery-list`, `the-chain`,
   README. `{k:0,leaves:[]}` in the test helpers can stay.
