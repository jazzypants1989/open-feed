# recovery-gate — the contest rule inside the composed reader

**Candidate gate** (`../HANDOFF-final-review.md` §1.D; RULINGS §10.3). Substrate: the weekend reader
and publisher over a real loopback socket. `decisions/forkcold-exp.js` showed the fork-point recovery
as a pure function; `weekend-reader.js` said "contested" and stopped.

**Question.** §10.3 settles a contest by a majority of the recovery list *as it stood at the split*,
and says only a reader that pinned the pre-fork profile can run it. Nobody had run it inside a
reader that also folds a index and fetches posts. Does it fit, and what must the reader have kept?

**The hole found first.** The reader as written contested only *two profiles at one `version`*. A
thief holding a rotated-out key who picked a **higher** number — `version` 4 with a plain rotation to
his own key, after Alice had restored to `version` 3 with two of three vouchers — was **followed by a
pinned reader and by a cold one**. The contest rule caught a careless thief and nobody else. The
chain being a valid walk from the anchor was the whole test, and his chain walks.

**Method.** Eleven claims, every fork staged in both orders (the reader meets the thief's branch
first, then Alice's; and the reverse): a thief at a higher `version` against a two-of-three restore; the
ex, *on the list*, vouching for himself against a majority; one voucher each of two (the tie
`weekend-gate` stages); a bare rotation against a one-of-two restore, then against two of two; the
thief rewriting the list at the same chain length before forking; a newer profile with the chain
from *before* her restore; a cold reader handed each branch first; Alice dropping a voucher from
her list after the restore. Then the rule as a pure function under three candidate rules.

**What the reader keeps, and the four rules it took (141 → 159 lines):**

1. **The pin holds the chain**, and a served chain must extend it key for key. Where it does not is
   the split. A newer profile whose chain is a strict *prefix* of the pinned one is a split too — the
   thief pretending the restore never happened.
2. **A recovery per chain length: the first list the reader saw there** — from the profile, or from
   the link that carried it. It is never overwritten. So the thief who holds the key and rewrites the
   list before forking changes nothing for a reader that already held one.
3. **A restore link carries the list it satisfied.** The profile's own list is for the *next*
   restore, so a cold reader needs the carried copy to walk the chain at all — and without it, an
   author who edits her list after a restore breaks her own chain (claim 9, revert-checked).
4. **A pinned reader judges a restore by the list it holds, never by the copy the link carries.** The
   branch whose link at the split has a majority of that list wins; one majority on exactly one side,
   or the verdict is contested.

**Numbers** (stale if the reader or the rule changes):

| fork | thief first | Alice first |
|---|---|---|
| thief at `version` 4, rotation; Alice 2 of 3 | followed, then **switched to Alice** | Alice, then `host: serves a branch the recovery rejected` |
| the ex, listed, vouches himself (forged recovery of one); Alice 2 of 3 | `identity` outright (his link fails under the held recovery), then Alice | `identity` |
| one voucher each of two | `identity: contested` | `identity: contested` |
| thief rotates; Alice 1 of 2 | `identity: contested` | `identity: contested` |
| thief rotates; Alice 2 of 2 | switched to Alice | `host` |
| thief rewrites the list, then forks | `identity` outright, then Alice | `identity` |
| `version` 9 with the chain from before her restore | — | `host` |
| cold on Alice, then the thief | — | `host` |
| cold on the thief (forged recovery of one), then Alice | `identity` — **Alice is the one rejected** | — |

The rule three ways, on the row that separates them — *the ex, on the list, vouches for himself;
Alice merely rotates*: **majority: contested · at least k: the ex wins · strictly more: the ex
wins.** Majority is the only rule under which a listed adversary never wins alone; its price is the
fourth row — a one-of-two restore against a bare rotation stays contested until a second member
vouches.

**Kill criterion.** A thief followed by a reader that pinned the pre-fork profile; a listed
adversary who wins alone; an author whose own chain breaks when she edits her list; a fork settled
by the wrong list; the reader over 200 lines. **Not triggered.**

**Revert-checked** (`revert.js`, 6 rows): no chain-prefix check (the thief is followed again); a
prefix chain not treated as a fork (the forgotten-restore row goes red); recoveryLists overwritten by
whatever the latest link carries (the listed ex wins); recoveryLists overwritten by a same-length list edit
(the rewrite-then-fork row goes red); restore links verified against the profile's current list (her
own chain breaks); "any voucher wins" instead of a majority (the listed-ex row goes red).

**Verdict.** The recovery fits — 18 lines — and what it costs the reader is the chain and one list per
chain length, both of which it had already verified. Three sentences the spec owes: a served chain
must extend the pinned one; a restore carries the list it satisfied, and a pinned reader ignores
that copy; the recovery at a split is the first list the reader saw at that length, and a majority of
it wins. Two limits to state plainly: **a cold reader's recovery is whatever its first profile
carried**, so a reader that first meets an identity on the thief's branch will reject the real one
later (§10.3's limit, now measured); and a list change only reaches readers' recoveryLists through a link,
so an app SHOULD rotate when the list changes. One question for the owner: majority, or at least
`k` — the table above is the whole difference.

**Run:** `node examples/_seeds/court-gate.js`

**Re-measured 2026-08-23** under the unified link (RULINGS §13.4; `coldcourt-gate`): every link
carries its list, and a reader judges a link's *validity* by the recovery it holds at that length —
so a forged recovery of one no longer reaches the contest at all. Rows 2 and 5 read `identity: the
chain of key changes does not hold` on the thief's branch in either order, where they read
"switched to Alice" / `host` before; the rest of the table is unchanged.

