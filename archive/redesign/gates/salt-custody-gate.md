# salt-custody-gate — who holds the recovery salt?

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §3
claim 4 and `decisions/inventory-keys-exp.js` Issue 4). Substrate: `lastline.js`'s commitment.

**Question.** The recovery list is committed as `H(salt || members)` with threshold `k`; a restore
reveals `{salt, members}` and a k-subset signs. Issue 4 concludes the salt "defends both pre-restore
enumeration and a naive rollback replay" and that the ex "cannot reproduce the commit without s3"
unless a prior restore leaked it. Nothing says who holds the salt. Does the conclusion survive
every answer to that question?

**Method.** The same commitment under three custody models — salt known to the owner alone, salt
shared with every listed member, and one leaf per member (`H(k || sorted H(salt_i || key_i))`, a
voucher revealing only its own salt) — each tried against Grandma (lost her only phone, no backup,
mum vouches), the ex (still listed, k=1, no prior restore), and `commitment-exp.js`'s enumerator
over twenty known family keys in subsets of up to four.

**Numbers** (stale if the commitment construction or the family size changes):
- Owner-only salt: Grandma **cannot** be restored (the salt was on the phone); the ex cannot
  either, but only because nobody can.
- Shared salt: Grandma is restored; **the ex restores himself with no prior leak** — every member
  knows the salt by construction. Issue 4 Case 1's premise is false under the only model in
  which recovery works.
- Per-member leaf: Grandma restored by mum revealing one salt; the ex removed in v4 fails
  against v4; a listed member with k=1 still restores alone. A restore reveals **1** member, not N.
- Enumeration: unsalted commitment found in **38** guesses; shared-salt and leaf commitments not
  found in 6,195.

**Kill criterion.** A custody model under which Grandma restores with no backup *and* a listed
member cannot restore alone; an enumeration recovering a salted list. **Not triggered — asserted
by exhaustion over the three models.**

**Revert-checked** (`revert.js`): disabling the commitment comparison (Grandma's guessed-salt hop
passes under owner-only); dropping the salt from the leaf (the enumerator finds it).

**Verdict.** The salt's secrecy buys enumeration resistance and nothing about who may restore.
Issue 4's rollback defense rests on the salt being the owner's alone, and under that model
scenario 2 ("back by calling her daughter") fails outright. Under any model where Grandma gets
back in, a listed member restores at will, so the defense against a stale list is the
prev-hash chain and the removal of the ex from the list *before* separation — not the salt. The
leaf construction is the repair worth adopting: same restore path, one member revealed instead
of the whole list, enumeration still defeated. **The owner must rule on salt custody;** the design
as written is silent and Issue 4 assumed the answer that breaks Grandma.

**Run:** `node tmp/redesign/gates/salt-custody-gate.js`
