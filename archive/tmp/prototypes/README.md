# Prototype gates

Each `.js` here is a **gate**: a small executable that asserts an experiment's conclusion still
holds against the shipped code. Each has a partner `.md` **verdict card** carrying everything
else — the question, the method, the numbers, the verdict, and a pointer to the archived original
in `tmp/archive/`. Some experiments have only a card, because nothing about them still needs to be
re-runnable. `npm run prototypes` runs every gate.

The contract for a gate:

- **It imports `src/`.** A gate exists to catch `src/` drifting out from under a claim the spec
  relies on; a hand-rolled copy of canonicalization or signing can stay green while `src/`
  regresses, which is the failure mode this folder replaces.
- **It asserts, and every assertion has been revert-checked** — the thing it guards was broken
  once, deliberately, and the gate observed to fail. An assertion that has never failed is a
  claim. Add the mutation as a row in `tmp/revert-gates.js` (`npm run prototypes:revert` re-runs
  every check) and note the check in the card.
- **Comments are one line, maximum.** Prose — why the question mattered, what the alternatives
  cost, what the numbers were — belongs in the card. Code exists to fail when a claim stops being
  true, not to carry an argument.
- **Target ≤~200 lines.** A fresh agent should consume a gate in one screenful of context.
- **Exit 0 when everything holds, exit 1 with a line naming what did not.** `check-prototypes.js`
  judges by exit status alone.

The card's shape: **Question** · **Method** · **Numbers** (each marked with what would make it
stale) · **Verdict** · **What the gate guards** · **Original**: `tmp/archive/<name>-prototype.js`.

Measurement scripts that print numbers but gate nothing live in `tmp/measure/`, not here.
