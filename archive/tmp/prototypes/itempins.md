# itempins — can items carry the second observation §5.3.1 needs?

**Question.** §5.3.1's compare rule is a Level 1 MUST, and §5.2 step 5 makes a publisher record
every `(seq, hash)` it produced — but nothing supplied either with a second observation to compare
against. At the time, the only supply was a published pins *document* (then numbered §16.1): a
standing record of whom you read and when, opt-in precisely because it is a reading-graph
disclosure. Could `_openfeed.pins` on ordinary interaction items — scoped to the recipient's own
chains — supply the observations without the disclosure?

**Method.** A three-party scene: Mom hosted by a key-custodian hub, Dad self-hosting, Gran a
third-party reader. Six claims: the pin is unstrippable and uneditable inside the signed bytes;
it catches the hub equivocating about Mom at a recorded seq; it catches a version Mom never
authored; on a published relation it reaches Gran with no help from the hub; recipient-scoping is
zero-disclosure where the document is not; and what it costs.

**Numbers.** Sample reply without pins 522 B, with 2 pin entries 795 B — +273 B, +52%, ~137 B per
entry (stale if the entry shape `url`/`seq`/`hash`/`observed` or §6's canonical serialization
changes; the percentage is relative to that one small item). Disclosure: the pins document named
3 origins including a therapist; the item pin named exactly 1, the party the reply already
addresses (stale if §16.1's publication-scoping rule ever admits third-party entries on published
items).

**Verdict.** ADOPTED, and the spec moved past it: the pins document was deleted outright, and
item-carried pins *became* §16.1 — no document, no endpoint, no discovery — with emission promoted
from the prototype's "OPTIONAL convention" to a Level 3 MUST (§16.2), heeding optional throughout.
The prototype's bounds survived into the text verbatim in substance: published items pin only the
addressee's chains, delivered-only items may gossip third parties to exactly one counterparty, and
the mechanism does not defeat a custodian who also supplies the comparing client — its value lands
with the two-self-hosting-relatives persona.

**No gate exists for this experiment**, deliberately. The original hand-rolled its own
canonicalization, signing, and `compare()` equivocation model rather than importing `src/chain.js`
— exactly the failure mode this folder replaces: its assertions could stay green while the shipped
code regressed. The shipped §16 behavior is guarded where it should be, in `test/`:
`chain.test.js` (entry scoping, owned-chains, emitter-store admissibility), `inbox.test.js`
(pins judged locally, published-item scoping, §16.1 end to end with no hand-written `_pins`), and
`reader.test.js` (a peer's pin resolved, never believed). A gate here would duplicate those.

**Original:** `tmp/archive/itempins-prototype.js` (the full scene, the stripped/edited-pin
signature checks, and the disclosure comparison against the since-deleted pins document).
