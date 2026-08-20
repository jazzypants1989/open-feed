# channel-gate — the delivered-channel axis, priced

**Candidate gate** (argued: it picks a variant, it cannot kill a candidate).

**Question.** PLAN.md's R2 kills the delivered column. Under the driving adversary (§13.2's
hostile custodian), what exactly is lost, and does a *minimal* delivered channel avoid re-growing
§10?

**Method.** Variant (a), published-only: the victim submits an encrypted post; the hostile hub —
which owns the append — declines to commit it; the gate asserts the freshness verdict fires only
past the 7-day ceiling and the recipient never obtains the message. Variant (b), minimal
delivered channel: an *unlogged* signed event (no seq/prev) sealed to one recipient via shipped
`src/enc.js`, POSTed by the victim's own device, verified at the recipient against the sender's
spine with **zero victim-hub touches**, deduplicated **by token hash**; then the §10.3 poisoning
attack is attempted against it.

**Numbers.** The delivery mini-chain (`dseq`/`dprev`) costs what the delivery-chain card measured
(+75 B); everything else here is a property, not a quantity.

**Kill criterion** (variant (a) only): the delivered blob failing to verify at the recipient
without the victim's hub in the path. **Not triggered — (b) works.**

**Verdict — keep a minimal delivered channel.** Three findings:
1. **Suppression is not a corner case under (a): it is the adversary's cheapest move**, and
   detection (staleness, day 7+) is not delivery — the covert outbound path ("tell grandma I'm
   leaving") only exists under (b), because a device-to-recipient POST never transits the hostile
   hub. Under (a) the same message is also a *permanent public event* on the victim's log.
2. **(b) does not re-grow §10.** Content-addressed dedup (a set of token hashes) replaces the
   `(author, id) → version` store, and with it the write-before-verify hazard and §13.9's
   version-poisoning attack — the forged token files as the attacker's own item and the genuine
   one still lands. What survives of §10 is ~1,000 words: relevance, IP-then-author rate ladder,
   response hygiene, §11.1.1's no-republication MUST, `dseq`/`dprev`.
3. The recorded rejections stay answered under (b): Q4's one-recipient rule transplants (the
   channel is an audience of one by rule); both rejected receipt designs stay rejected for their
   recorded reasons — and a sender-side commitment is now *worse* than when first rejected,
   because the log is the identity and the commitment would publish the DM's existence into it
   permanently.

**Run:** `node tmp/redesign/gates/channel-gate.js`
