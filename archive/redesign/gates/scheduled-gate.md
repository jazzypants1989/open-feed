# scheduled-gate — ruling 10 under an author-only head with admission

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §5 item
A1 and `decisions/scheduled-exp.js`). Substrate: the `[n, hash]` head over `lastline.js`.

**Question.** Ruling 10 keeps host-released scheduled posts: the pre-stamped post carries its
release time. The list head admits a post only when the current head lists its hash, and only
the author's key writes the head. Alice pre-stamps #8 on Monday for Friday and posts #9 from her
phone on Tuesday; the host and Alice are honest. Is there a way to do it that is admissible
before her device wakes, collides with no interim post, shows early release without a clock, and
gives a clock-free verdict?

**Method.** Four options staged against a pinned reader with the list-head verdicts (rollback
below the pin, fork at the pin, per-entry served / pending / withheld): (1) the host releases the
file only; (2) the device pre-signs Friday's head, either reusing hseq 11 or skipping to 12; (3)
the head lists #8 with its release day (`scheduled-exp.js`'s `pending`, ported); (4) no host
release.

**Numbers** (stale if the head's verdict set or ruling 10 change):

| option | admissible before the device wakes | no collision with #9 | early release visible | verdict clock-free |
|---|---|---|---|---|
| 1 host releases the file only | no — never admitted | yes | no | yes |
| 2 device pre-signs the head | yes | **no — FORK at hseq 11, or ROLLBACK if the device skips to 12** | no | yes |
| 3 head lists #8 as pending | yes | yes | only via the post's release day vs a clock | **no — a clock one day fast convicts the honest host of WITHHELD** |
| 4 no host release | n/a | yes | yes | yes |

**0 of 4** options pass every column.

**Kill criterion.** An option passing all four columns; option 2's collision not producing two
valid heads at one hseq. **Not triggered.**

**Revert-checked** (`revert.js`): removing the fork check makes option 2 read `fine`.

**Verdict.** Under admission, host release is dead as ruled: the host cannot make #8 Alice's, and
every way of letting it either forks Alice's own head against herself or makes a withholding
verdict depend on the reader's wall clock — the one thing the time-discipline rule forbids. The
choice left is the one the handoff already put on the table: drop host release (the device posts
at the time, or late), or accept option 3 with its clock-gated verdict stated as UX rather than
security. **A1 is the owner's to rule;** the table is what each ruling buys.

**Run:** `node tmp/redesign/gates/scheduled-gate.js`
