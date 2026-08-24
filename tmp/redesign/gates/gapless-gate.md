# gapless-gate — numbering under failure

**Candidate gate** (`../HANDOFF-final-review.md` §2.C and §3's two `pending` gaps). Substrate: the
weekend reader and publisher, unchanged in construction, over a real loopback socket, against the
hub §12.5 rules — checks nothing on the ordinary path, resolves a collision.

**Question.** Numbering is load-bearing three times — create-once (ruling 3), "above the top"
(§11.1), the reclaim rule (§12.5) — and nothing had stressed it. What does a crash between the post
write and the head write do? Does a gap read as a withdrawal of a post that never existed? Does
`top` still tell the truth after a griefer is reclaimed? And what happens to a `pending` entry
across a rewrite and across the fallback a rotation forces — the two lifecycle paths nothing had
checked.

**Method.** Thirteen claims on fresh hubs. A device writes post 8 and dies before the head, then
comes back forgetting; the same, coming back *remembering* and listing 8 after 9; the custodian
(her current key and his disk) backdating a post into a withdrawn number; two devices and a crash; a
griefer holding 8–12 reclaimed in order with `top` and the highest listed number checked at every
step; a pending entry noted, never fetched, rewritten, carried through the rotation fallback,
abandoned, and released below the top after another device published; and the head written before
the post's bytes.

**Numbers** (stale if the reader, the publisher or the hub's rules change):
- A crash burns **one number and nothing else**: the next post lands at 9; pinned and cold readers
  read `ok` with no note; a reply naming the orphan is quiet. Two devices and a crash: 9 and 10.
- The orphan is **served forever**: her own file holds 8, so her retake is 409 and a head
  withdrawing a never-listed number does not fold.
- Listing the orphan late — below a top the reader has seen — is `host` to a pinned reader and `ok`
  cold. The custodian's backdate into 3 is the same pair. The key alone is refused (409) by
  create-once; it takes the disk.
- Griefer: five 201s, five reclaims, and at every step `top` equals the highest number listed.
- Pending: fetched **0** times; after the rewrite the line is still `[8, hash, "pending"]`; in the
  fallback the note is `pending: 8`, not an accusation.
- Head before post: `host — post 8 is listed and not served`; once the bytes land, `ok`.

**Three things found, two of them bugs in the files on trial.**

1. **The publisher needed the fold.** `rewrite` took the live list from the *reader's* pin, which
   carries hashes and nothing else, and wrote every pending entry back as confirmed — so the monthly
   rewrite released every scheduled post a month early and a reader fetched bytes the device had
   not sent: `host`. Fixed: the publisher folds the head it is rewriting and keeps the flag (two
   lines in, two out: still 47). The spec sentence: **a pending entry is confirmed by a bare line, never by a
   rewrite.**
2. **The pin needed the flag.** The reader's pin dropped `pending`, so the rotation fallback — which
   rebuilds the live set from the pin — fetched the pending post and accused an honest host. Fixed
   at no line cost. Found independently by `decisions/freezehead-exp.js`.
3. **"Numbering stays gapless" (SKETCH §6) is false under a crash, and it does not matter.** The
   reader is indifferent to gaps: a number nobody lists is nothing. What *does* matter is the rule
   that falls out: **a device that comes back must abandon a number it cannot prove it listed, never
   list it late** — because the pinned reader's rewrite check ("a number at or below the old top
   cannot appear that was never there") is exactly the check that catches the custodian backdating
   a post into her history, and it cannot tell the two apart. Same rule, opposite intent.

**And one thing for the owner.** The orphan — and every withdrawn post — stays on the host at its
number with no verb to remove it: the interface has no `DELETE`, she cannot overwrite her own file,
and the fold refuses a withdrawal of what was never listed. Against the custodian this is moot (he
kept every byte anyway); against an honest host it means "withdraw" never means "erase". Either the
spec says a host MAY remove a numbered file the head does not list (with a grace window for the
post-before-head write order, claim 13), or it says plainly that withdrawal is not deletion.

**Kill criterion.** A gap that reads to any reader as a withdrawal or an accusation; a `top` that
lies; a reclaim the griefer can use; a pending post fetched before its device released it; a late
listing or a backdated insertion a pinned reader does not catch. **Not triggered.**

**Revert-checked** (`revert.js`, 5 rows): the publisher's rewrite dropping the pending flag (the
rewrite row goes red); the pin dropping it (the fallback row goes red); skipping the rewrite check
for numbers at or below the old top (the late-listing and backdating rows go red — note that
disabling only the "was not before" line is *not* caught, because the hash comparison on the next
line fires on `undefined`; the rule is the pair, and the guard is what turns it off); fetching
pending entries (the never-fetched row goes red); letting the owner reclaim her own file (the
crash row goes red — the restart lands on 8 and the orphan is silently overwritten).

**Verdict.** Numbering holds under failure, with a gap being nothing to a reader. Two sentences the
spec owes: a pending entry is confirmed by a bare line and survives a rewrite pending; a device
abandons a number it cannot prove it listed. One sentence SKETCH §6 should lose ("gapless"), and
one question — is withdrawal ever deletion on an honest host — for the owner.

**Run:** `node tmp/redesign/gates/gapless-gate.js`

**Re-measured 2026-08-23** after `pending` was cut (RULINGS §14.5; `pending-gate`): section 5 now
stages a head carrying the retired line (`host: the head does not fold`), a scheduled post landing
at the next number, and a reserved number listed late below a seen top (`host: post 8 is listed now
and was not before` — the check that had made the line exist). The "two bugs in the files on
trial" above were bugs in a feature that no longer exists.

