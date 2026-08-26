# spoken-gate — what the six words distinguish, and what grinding them costs

**Review gate** (2026-08-23 review, finding A7 and text defect C1). Substrate: the §3.1 derivation
verbatim (the one `tools/regen.js` uses for B.12) over keys from the weekend publisher.

**Question.** §3.1 derives the code from the *anchor* key and offers it "for the moment a person
is shown two versions of one identity". Two versions of one identity share the anchor. And §3.1
says "at 40 bits a laptop core finds a colliding key in under a second" — the sentence the
six-word ruling rests on. Is either true?

**Method.** Alice's branch and a thief's, same anchor, different current keys: the code over the
anchor, then over each branch's current key. Then a grind: keygen + HKDF per try for 1.5 s on
one core, extrapolated to 40/55/66 bits — as measured, with the attacker's point-addition
shortcut (walk the scalar, add the base point: ~100× cheaper than a keygen), and on a GPU.

**Numbers** (stale if §3.1's derivation changes; the rate is this machine's, 30,872 tries/s):

- Same anchor → **the same six words** on both branches. Over the current keys they differ, and
  a reader handed the current key out of band can pick the branch that contains it.

| bits | one core, as measured | with point addition (×100) | a GPU (×100,000) |
|---|---|---|---|
| 40 | 1.1 years | 4 days | **0.1 h** |
| 55 | 3.7e4 years | 370 years | 135 days |
| 66 | 7.6e7 years | 7.6e5 years | **760 years** |

40 bits on one core is about a year, not "under a second" — the sentence is off by eight orders
of magnitude (`decisions/spokencode-exp.js` had already measured 328 days). Six words hold at
~760 GPU-years under the most aggressive model; five would not.

**Kill criterion.** Two branches of one identity speaking different codes under §3.1 as written;
a rate making 40 bits sub-second. **Not triggered.**

**Revert-checked** (`revert.js`): deriving the repaired code from the anchor instead of the
current key makes row 2 collide.

**Verdict.** The code distinguishes *identities*, never two branches of one: §3.1's contest clause
is false as written. Repair: define the code over *a key*; let the out-of-band route carry the
current key as well as the anchor, and let a reader given one follow the branch containing it —
the only exit from `identity: contested` the text has. Replace the 40-bit sentence with the table.

**Run:** `node examples/_seeds/spoken-gate.js`
