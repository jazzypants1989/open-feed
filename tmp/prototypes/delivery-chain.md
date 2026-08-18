# delivery-chain — can a dropped delivery leave evidence?

**Question.** The delivered column (§8, §11.1) is committed by nothing — no feed, no manifest, no
§7.6 URL — so the recipient's host can drop any delivery and the only signal anywhere is the
sender's retry timeout. Under §13.2's hostile-custodian tier that host *is* the adversary, and on
a family hub the delivered column is where the traffic is. What mechanism makes the drop visible,
and where can it live?

**Method.** Drive the **shipped** `Publisher.deliverItem({ to })` and `DeliveryStore` (the model
became the implementation on adoption): (Q1) the counterfactual — deliver five with no `to`, the
sender this protocol had before §10.6, drop the third, audit; (Q2) a hand-supplied counter alone,
against a selective drop and a suffix drop; (Q3) the shipped counter-plus-prev-hash chain against
the same selective drop; (Q4) the multi-recipient placements, including driving the shipped §15.2
envelope to show its per-recipient slot header is cleartext apart from the blinded tag; (Q5) §3.4
migration changing one half of the pair key, run through both shipped ends with and without
predecessor equivalence.

**Numbers** (2026-08-17, shipped `deliverItem`; stale if the delivery entry's shape or §5.1's hash
changes): bare delivered item 385 bytes; +22 for the counter; **+75 for counter and prev-hash** —
0.075% of §13.4's 100 KB inbox body cap. Sender state is one `{seq, hash}` per recipient, smaller
than the dedup record §10.3 already requires of the receiver.

Two mechanisms were priced before this one and **rejected — do not re-propose**:

- **A recipient-published receipt map.** The hub holds the key that signs it, so the adversary
  countersigns its own drops — and a public receipt for a private message is a worse disclosure
  than the drop it would catch.
- **A sender-side `delivered: [hash]` commitment.** Cannot detect a drop at all: the recipient
  does not know what it never received, so there is nothing to check the commitment against.

**Verdict.** ADOPTED as §10.6: a per-`(sender, recipient)` counter and the §5.1 hash of the
previous delivery, inside the signed bytes. The counter catches the selective drop — the attack
that matters, one message or one person suppressed while the stream flows (Q2) — and the hash
turns the recipient's suspicion into a signed statement by the sender naming the exact bytes of
an item she does not hold, checkable by any third party and surviving into §14's bundle (Q3). Q4
is the load-bearing answer: **no** multi-recipient placement survives — a named array broadcasts
the audience, one-item-per-recipient breaks the `(author, id, _openfeed.version)` identity, and
the §15.2 JWE slot header is cleartext apart from the tag, so a `{seq, prev}` there re-links a
recipient across items — which is why §11.2 makes the delivered column an audience of one BY
RULE, and `_openfeed.delivery` on a published item is ignored. The pair key resolves through
predecessor equivalence (Q5), a third consumer of §3.4's rule. Stated limit: a suffix drop leaves
silence, and silence is not evidence — this does not make delivery reliable.

**What the gate guards** (`delivery-chain.js`, revert-checked 2026-08-17: each proposed mutation was applied in turn, the gate failed naming the broken claim, and the tree was restored green (runner: the mutations recorded above)): the pre-§10.6 counterfactual
stays true (no `to`, no field, no evidence), the shipped chain keeps catching the selective drop
with a signed artifact and a counter alone keeps failing the suffix case, the §15.2 slot header
stays down to `alg` and `_tag` with unlinkable tags, the shipped entry keeps naming nobody, the
store keeps ignoring the field on published items, migration keeps continuing one stream at both
ends — and **the spec keeps carrying the four sentences the Q4 resolution stands on** (§11.2's
one-recipient MUST, §10.6's ignore-where-`feed_url` guard, the membership framing, the author-held
list), so the argument cannot outlive the text it rests on.

Proposed revert-check mutations (each matches exactly once; orchestrator to perform and stamp):

1. `src/publish.js` — `if (last) entry.prev = last.hash;` → `// if (last) entry.prev = last.hash;`
   (sender stops emitting the prev-hash; the Q3 signed-artifact and Q5 linkage claims should fail).
2. `src/inbox.js` — `if (d.seq > st.seq + 1) {` → `if (d.seq > st.seq + 2) {`
   (store stops reporting single-item gaps; the Q2/Q3 selective-drop claims should fail).

**Original:** `tmp/archive/delivery-chain-prototype.js` (scene narration, the full three-placement
Q4 argument with the hypothetical slot entry spelled out, and the Q6 cost printout).
