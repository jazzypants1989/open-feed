# oldkey-gate — what a rotated-out key can still do

**Review gate** (2026-08-23 review, findings A2 and A5). Substrate: weekend reader and publisher,
unchanged, over loopback sockets against `hub.js` with its `reclaim` knob.

**Question.** §4.3: a stolen old key "is closed without any revocation mechanism" because only the
current key signs the head. Two rules the sentence does not cover: §9.5 calls a file "the owner's"
when *any* chain key signed it; §5.2 says a number is issued once and a withdrawn one is never
re-listed. What does a key she rotated away from do at each?

**Method.** A2: Alice at `[G, K2]`, three posts listed; the thief holds G and PUTs five posts at
4–8, each signed by G and declaring its number; Alice publishes post 4. Then the rule's other
three directions (her unlisted current-key post, her listed old-key post, her own overwrite), under
`reclaim: 'chain'` (as written) and `'current'` (the repair). A5: the thief held K2, withdrew posts
1–3 and rewrote; Alice restores to K3 and re-lists the three at their identical hashes, read by a
reader pinned before, one pinned during, and a cold one — once after his rewrite, once with his
withdrawal lines still in the head. Then the repaired fold as a pure function.

**Numbers** (stale if §9.5, §5.2, or the reader's fold change):

- As written the thief gets **201 × 5**, Alice's post 4 lands at **9**, and readers read `ok` —
  the squats are unlisted, so nothing anywhere reports five numbers lost to her for good. With
  "the owner's file" = signed by the **current** key, or listed: post 4 lands at **4**; the thief
  still cannot take her unlisted current-key post (409) or her listed old-key post (409), and she
  still cannot overwrite her own (409). The repair loses none of the three refusals.
- As written, re-listing after his rewrite: pinned-before `ok`, **pinned-during `host: post 1 is
  listed now and was not before`** (a false accusation against an honest restore), cold `ok`. With
  his withdrawal lines still present: every reader `host: the head does not fold`. **Whether she
  may re-list depends on whether the thief happened to rewrite** — §5.2's "issued once" reaches
  only the head it is written in.
- Repaired fold (one hash per number, ever; the pin remembers the hash of what was withdrawn):
  all three readers `ok`; a re-list at a different hash, or a live number listed twice, still does
  not fold; withdrawn → re-listed → withdrawn folds to nothing. A host can do none of it — the
  head is signed by the current key alone (checked).

**Kill criterion.** The squat refused under §9.5 as written; a re-listing rule that lets a host
resurrect anything or a number carry two hashes. **Not triggered.**

**Revert-checked** (`revert.js`): reverting `hub.js`'s `'current'` branch to "any chain key"
makes the repaired run lose five numbers; dropping the repaired fold's hash check lets `[1,a]
[1,null] [1,b]` fold.

**Verdict.** §9.5 needs four words — *the key the chain currently ends on* — plus "or listed"; the
old-key squat is otherwise the exact harm §9.5 was written to stop, turned around. §5.2's rule
should be the one the repaired fold states: **a number may be re-listed only at the hash it had**,
and a pinned reader remembers withdrawn hashes — which the owner adopted in plan mode
(2026-08-23). It is also the only rule that is the same before and after a rewrite.

**Held to the ruling (2026-08-23, RULINGS §14.2).** The reader now carries the re-list rule and
remembers withdrawn hashes: after Alice's restore, a reader pinned before, one pinned during the
thief's withdrawals, and a cold one all read `ok` with the three posts, whether or not he rewrote;
post 2 coming back at another hash is `host: post 2 changed after the reader saw it` to the pinned
reader and, across a rewrite, invisible to the cold one (it never held the hash — which is what a
pin is for); within one head the fold refuses the second hash for everyone. `hub.js` defaults to
`reclaim: 'current'`; the `'chain'` knob remains as the as-written demonstration.

**Run:** `node tmp/redesign/gates/oldkey-gate.js`
