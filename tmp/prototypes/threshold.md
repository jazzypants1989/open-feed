# threshold — does k-of-n recovery have to fail open?

**Question.** §4.5 forbids layering a threshold (k-of-n) recovery scheme on by extension, and the
justification beside the MUST claimed *any* such extension fails open — a pre-extension verifier
sees the one co-signature it understands and accepts it, handing a recovery-key thief the choice
of verifier. Is that true as a generalization?

**Method.** Run the **shipped** `verifyMigration`/`verifyRecoverySignature` (never a model of
them) against: (Q1) the fail-open shape §4.5 describes — threshold declared outside the key
entries, signatures reusing `_recovery_sig`; (Q2) a fail-closed shape — signatures in a new
`_recovery_sigs` array, keys marked with a `use` token §4.1 requires implementations to ignore —
including an attacker who smuggles one genuine signature back into the old field; (Q3) a
capability table for 1-of-1 / 1-of-n / 2-of-3 against §13.2's hostile-custodian adversary.

**Numbers.** None load-bearing — the findings are boolean verdicts of the shipped verifier. What
would make them stale: any change to `src/chain.js`'s recovery-key resolution (the
`use === 'recovery'` filter) or to §4.1's ignore-unknown-`use` rule.

**Verdict.** §4.5's *scope* stands, its *stated reason* was false as a generalization — and the
spec text was rewritten accordingly. Q1 confirmed: reusing `_recovery_sig` does fail open with one
stolen card. Q2 refuted the generalization: the `_recovery_sigs`+`use` shape fails **closed** at
every stage — an old verifier declines to adjudicate, even against the smuggled-signature attack,
because the key resolves against nothing. Q3 is why the ban survives on different grounds: k-of-n
trades a theft risk for a coordination risk at the moment §14 requires an exit needing nobody's
cooperation, and a custodian holding two shares can both migrate alone and block.

**What the gate guards** (`threshold.js`, revert-checked 2026-08-17 by widening `src/chain.js`'s
recovery-key filter to any `use` — assertions 4 and 5 failed): the fail-open shape stays accepted
(the demonstration §4.5 cites), every closed-shape document stays refused by the shipped verifier,
and §4.1's ignore rule keeps the smuggled signature resolving against no key.

**Original:** `tmp/archive/threshold-prototype.js` (scene narration, the modelled
extension-aware verifier, and the full Q3 capability table).
