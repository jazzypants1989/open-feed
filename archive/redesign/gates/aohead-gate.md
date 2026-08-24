# aohead-gate — is the append-only head a shape the reader rules survive?

**Candidate gate** (tests the design on trial; `../HANDOFF-to-spec.md` §2.A). Substrate:
`lastline.js` — last-line signed files, hash-of-body addressing, the profile chain. The head shape
itself is built inside the gate, not in `lastline.js`, because it is on trial: it moves into the
reference only if the owner rules for it.

**Question.** `decisions/headage-exp.js` shows the flat list losing at journal scale under any
realistic edit age and the append-only head winning by two orders of magnitude. That is an egress
argument. This gate asks the other half: does the append-only head still *support the reader rules
the design already has* — admission, the pin, the "above the top" rumor, the withdrawal that leaves
no permanent record — or does it buy bytes by giving one of them up?

**Method.** One history at both shapes: 1–6 published, 4 withdrawn, 7 appended, then a compaction.
Append-only writes a withdrawal as an appended `[n, null]` and the live set is the *fold* of the
entries in order. Fourteen claims: the fold against the flat list of the same history; every illegal
second line for a number; a `pending` entry (RULINGS §11.5) confirmed; admission off the fold
including an unlisted post signed by a stolen key; a reader-relative tail across a withdrawal, with
the flat list's forced full re-read as the contrast; a compaction that verifies, chains by `prev`
and preserves the fold; the tail reconstruction across a compaction failing; a compaction that
changes a live hash or re-admits a withdrawn number refused by a reader that held the previous
head; a compaction that drops a live post accepted *only* as a withdrawal and named as one; 3,804
contiguous deletions against the retraction line; the rollback that the signature cannot stop; a
reader that skipped every version in between; and the reply to a withdrawn *top* post.

**Numbers** (stale if the head shape or entry width changes; egress numbers live in
`decisions/headage-exp.js` and `decisions/tracelife-exp.js`, not here):
- A withdrawal costs **+62 B appended**; the compaction of one retracted post takes **59 B** back.
- The tail after two versions is **218 of 529 B** — and it is a tail *after a withdrawal*, which is
  the case where the flat list's reconstruction does not verify at all.
- **3,804 contiguous deletions of 1–8 bytes: 0 verify.** Removing `,[4,null]` outright: does not
  verify. A hostile host cannot un-withdraw a post by editing the file.
- The rollback it *can* serve — the head from before the withdrawal — is caught by `hseq` for a
  reader holding a pin and **not caught at all cold**. That is the same limit every shape has.

**Why the rewrite cadence can be the publisher's business** (the owner's ruling, 2026-08-21). A
reader that last saw hseq 1 and comes back at hseq 6 — across two rewrites, two withdrawals and an
append it never saw — accepts, is told that 4 was withdrawn, and stays quiet about a reply naming 7,
a post it never knew existed, because the declared `top` covers it. Nothing in the reader depends on
how often the author rewrites. The honest half of that: **`prev` does not chain across a gap**, so
it is checkable only by a reader that saw the immediately preceding version. Across a gap, `hseq`
not going backwards and the rewrite check against what the reader holds are the whole defence — and
the spec text should say that rather than implying the chain is walked.

**The finding that was not commissioned.** A reply to a withdrawn post is supposed to stay quiet:
"a missing number at or below the top is a withdrawal" (RULINGS §11.1). If the top of the head is
taken as *the highest number listed*, then withdrawing the **newest** post lowers it, and a reply
to that post reads as **above the top — a rumor naming the replier for a post the author deleted**.
Append-only hides this for a while (the retraction line keeps the number visible) and a compaction
exposes it. The fix is one integer: the head declares `top`, the highest number ever issued, and it
never decreases. Then the verdict is quiet before and after a compaction. **This is not a
consequence of append-only — the flat list has the same hole from the first withdrawal onward, and
no gate had looked.** `headrange-gate` and `splitview-gate` both use max-of-entries.

**Kill criterion.** A fold that disagrees with the flat list of the same history; a re-admitted
number accepted; a tail reconstruction that verifies after a rewrite; a compaction that changes a
live entry's hash and is accepted by a reader holding the previous head; a skipping reader that
cannot check a rewrite; a retraction line removable without breaking the signature; a reply to a
withdrawn top post reading as a rumor under the declared top. **Not triggered.**

**Revert-checked** (`revert.js`, 5 rows): allowing a number to be listed twice (the illegal-second-
line row goes red); dropping the hash-equality check across a rewrite (the compaction row goes red
— a hash swap is accepted silently); making the reader accept the served bytes instead of
reconstructing (the tail row goes red — the flat list's failure stops being visible); checking
`prev` on every version rather than only on an adjacent one (the skipping-reader row goes red);
reading the top as max-of-entries (the last row goes red).

**Verdict.** The append-only head keeps every reader rule the flat list has, and one it does not:
a withdrawal is still a tail fetch, so the shape that wins on bytes wins without a reader
concession. Three sentences are owed by whichever shape is chosen. **The live set is a fold, not a
list** — the reader replays entries in order, and a number listed twice, a withdrawal of a number
that is not live, or a `pending` entry confirmed with a different hash makes the head invalid.
**A compaction is checked against what the reader already verified** — live entries survive
unchanged or are numbers above the old top, and what vanished is a withdrawal, which is all a
compaction may hide. **The head declares `top`.** How *often* to rewrite is not a protocol rule at
all: the reader is indifferent to it, so it is the publisher's setting, with the price in days and
bytes measured in `decisions/tracelife-exp.js` and a suggested default of once a month.

**Run:** `node tmp/redesign/gates/aohead-gate.js`
