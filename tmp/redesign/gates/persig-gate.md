# persig-gate — admission plus a per-post signature, or head-only signing?

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §3
claim 6). Substrate: `lastline.js`. Promotes `decisions/inventory-head-exp.js` Issue 2 to kill
criteria and prices the alternative the owner asked to have priced honestly.

**Question.** The design admits a post only if the current head lists its hash *and* signs every
post with a chain key. Are the two redundant, and what does the second one cost against the
deniability and bytes that head-only signing would buy?

**Method.** Five posts, a head listing them, a well-signed sixth from a key that was once
Alice's and is listed nowhere; then #3 withdrawn and Mom, who kept it, asked to prove Alice wrote
it — under per-post signatures and under a modelled head-only scheme (bare bodies, one signature
per head version, the keeper holding no superseded head). The signature's byte cost is measured
from the file; the Merkle alternative is priced as ⌈log₂N⌉ × 43 B per inclusion proof without
being built; the per-post total is set against `tmp/measure/headrange.js`'s year-10, daily, e=5%
head egress (re-run that before quoting the ratio).

**Numbers** (stale if the signature encoding, hash width, or headrange's workload change):
- Injection: refused with admission on, admitted with it off.
- Withdrawn #3: attributable by its own signature; inert under head-only.
- Per-post signature: **87 B** (86 + separator). Family archive 135 KB; active 8.7 MB; journal
  across 10,000 followers 87 GB — against one year's head egress of 1.0 MB / 1.43 GB / 14.32 TB:
  **13.6% / 0.61% / 0.61%**. At family scale the head is so small the signature share looks
  large; in absolute terms it is 135 KB over ten years.
- Merkle inclusion proof for one withdrawn post: 473 B at 1,557, 731 B at 100k, plus the
  retained signed head — 5–8× the signature it would replace, before implementation cost.

**Kill criterion.** A well-signed unlisted post admitted; a withdrawn post unattributable with
its own signature; a signature costing other than 87 B; a proof cheaper than it. **Not triggered.**

**Revert-checked** (`revert.js`): `admitted` returning true unconditionally (the injection row
goes red); `signedByChain` returning false (the admission-off and withdrawn rows go red).

**Verdict.** Not redundant: admission stops injection, the per-post signature makes a post
portable once it leaves the head. The handoff's framing — "head-only signing size at scale vs the
deniability/portability it trades" — compares the wrong two numbers: the signatures are under 1%
of the head traffic beyond family scale and 135 KB in total at it. Keep per-post signatures and
state the cost as bought. One consequence the design has not stated and the owner should:
**a signed DM is non-repudiable.** Head-only signing would have made a private message deniable
once withdrawn; the per-post signature makes it provable by its recipient forever. For the
driving persona that cuts both ways, and it deserves a sentence.

**Run:** `node tmp/redesign/gates/persig-gate.js`
