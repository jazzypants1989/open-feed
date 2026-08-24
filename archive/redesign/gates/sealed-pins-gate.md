# sealed-pins-gate — equivocation detection with zero public reading-graph bytes

**Candidate gate** (the candidates' answer to §16.1's aggregator foreclosure and its scoping
prose — the recorded objection is that a standing published record of who-observed-whom is a
reading graph, and the aggregate leaks by existing).

**Question.** Can pins ride *inside* encrypted content (the shipped §15.2 envelope, unchanged),
so two families detect a hostile custodian serving each a consistent private branch, while no
cleartext byte anywhere names who reads whom?

**Method.** Drives shipped `src/enc.js` (`seal`/`open`, carrier binding included). A custodian
serves families A and B different event ids at one seq of mom's chain. A's ordinary encrypted
reply to B carries A's pin sealed in the plaintext. Asserts: the wire form contains no `pins`
member, no pinned identity, no branch id, no recipient name; B opens, compares with its own
record, and resolves the disagreement at the derived URL — whichever branch the custodian answers
with, someone now holds two verified observations of one seq; a non-recipient (the custodian)
opens nothing; a relayed envelope under Eve's item is refused by carrier binding.

**Numbers.** None load-bearing beyond §15.2's own (a pin entry is ~100 B of plaintext). The
properties are the result.

**Kill criterion.** Detection requiring a published cleartext pin naming an identity the carrying
item does not already publicly address. **Not triggered.**

**Verdict.** Sealed pins supply §5.3.1's second observation with strictly less disclosure than
today's §16.1 (which permits cleartext pins on delivered items, visible to the recipient's host).
Scoped honestly: this reaches parties who exchange *encrypted* items — the two-self-hosting-
families persona exactly — and the custodian-as-recipient still reads pins addressed to them,
which is the entitled-to-look boundary no mechanism moves. It does not reverse the aggregator
foreclosure; it makes the pairwise supply cheaper and quieter. Note it leans further on §15,
whose unreviewed status is unchanged — the NIP-44 swap question (see CANDIDATES.md) applies here
too.

**Run:** `node tmp/redesign/gates/sealed-pins-gate.js`
