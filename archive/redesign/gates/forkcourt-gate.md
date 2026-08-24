# forkcourt-gate — is the recovery list a coherent court for forks?

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §3
claim 4, ruling 6, `decisions/theft-exp.js`, `decisions/inventory-keys-exp.js` Issue 3).
Substrate: `lastline.js`'s profile chain and commitment.

**Question.** Ruling 6: a vouched restore is back at once, flagged for seven days; "the real
owner still holds their key … and objects during the week, at which point it never settles";
a restore may change the key and nothing else. `theft-exp.js` adds that the named recoverers
are the tie-break for the two-devices-one-key fork. What is an objection on the wire, who
resolves the contest, does the window bind the adversary who holds a device, and what happens
when the list is empty or rewritten?

**Method.** (b) The only objection the design affords — a competing profile at the same pseq
with the same prev, by the key Alice kept — against a vouched restore, read warm, cold at the
ex's host, cold at Alice's new host, and after seven days of polling; the in-design tie-break
(k members vouch) applied to both branches. (c) The restorer publishing a relocation at pseq 5
inside the window, with and without a reader rule to keep polling the pre-restore location.
(d) A thief holding A: the empty list, the list rewritten on the thief's rotation judged by each
branch's own list vs the list at the fork point, and the reader state his rotation produces.

**Numbers** (stale if ruling 6 gains an objection shape or a settlement rule):
- Warm reader: `contested`; cold reader at the ex's host: `fine (recently restored)`; cold reader
  at Alice's new host: `fine`. After 7 days: still contested. Settle time: **∞**.
- k=1 is satisfied on **both** branches (the ex for his, mum for Alice's) — the tie-break
  discriminates nothing.
- Relocation inside the window: valid; **0 of 5** followers ever see the objection; **5 of 5** with
  the rule "poll the pre-restore location while flagged." If the pre-restore host is the ex's,
  the objection cannot be written there at all.
- Empty list: no winner; the host's CAS decides what cold readers see.
- Rewritten list: judged by each branch's own list, **both** the thief and Alice win; judged by
  the list in the last profile both branches share, **Alice alone**.
- A key-holding thief's rotation reads `fine` — it is "proving it yourself." Window protection
  against this adversary: **0 days**.

**Kill criterion.** A contest the code settles by a rule the owner has not written; a window that
protects against a key-holding thief for more than zero days. **Not triggered.**

**Revert-checked** (`revert.js`): removing the two-objects-at-one-pseq check (the warm reader sees
no contest); judging the fork by the thief's list (the fork-point row picks the thief).

**Verdict.** "Never settles" is literal: the design has a contest state and no settlement rule,
and its only candidate rule (k of the list vouch) is met by both sides whenever k=1. Four things
the owner must write before recovery can be called a court: what an objection is and where it
lives when the old host is hostile (a contest is reachable exactly as far as a relocation is —
ruling 7's social path); what settles a contest (A-wins lets a thief with A block every
legitimate restore forever; majority-of-fork-point-members is the rule this gate shows working;
never-settles is a dead identity); that the court is the list **at the fork point**, because a
rotation — unlike a restore — may rewrite the list and the thief's rotation is the owner's own act
on the wire; and whether an empty list means a two-device fork is unresolvable by design. The
seven-day window protects against a vouched impostor and against nobody who already holds a
key, which under ruling 5 is what every lost phone looks like. The reader states this adds are
`contested` and `recently restored` — two of the four §5 is counting.

**Run:** `node tmp/redesign/gates/forkcourt-gate.js`
