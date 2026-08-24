# writer-gate — one log, many devices: who serializes?

**Candidate gate** (the genuinely new obligation both LOG candidates create; the manifest design
never had it because items are unordered and the batch absorbs races).

**Question.** Can compare-and-swap appends (HTTP `If-Match` on the tip locator) serialize racing
devices, and does the offline-member + delegated-hub corner have a publish path that forces
nobody to re-sign?

**Method.** A CAS tip store and a deliberately naive store over `lib.js` events. Scenarios: two
devices racing on one tip (loser rebases and re-signs — it holds its own key); the same race on
the naive store (a fork, and the compare rule's evidence shape); the offline corner — the member
signs the content **blob** offline, the hub (delegated key) signs the ordering **entry** naming
the blob's hash at reconnect; five writers contending on one tip.

**Numbers.** None load-bearing; the properties are the result. Retries bounded (5 writers, every
append landed exactly once).

**Kill criteria.** Any interleaving serving a fork without the equivocation alarm; an
offline/delegated corner with no publish path. **Not triggered.**

**Verdict.** The obligation is real but cheap: one writer *surface* (the tip), CAS semantics, and
a rebase loop on the losing device. The feared "client must re-sign on sync under delegated
custody" corner dissolves once authorship and ordering are split between two signatures —
**authorship lives in the blob (member key), ordering in the entry (delegated key)** — which is
also LOG+URL's multi-device answer and makes §4.6-style custody load-bearing rather than
recommended for multi-device deployments. The naive-store fork is visible to the ordinary compare
rule (two event ids at one seq), so a hub that fails to serialize convicts itself in the same
vocabulary as every other equivocation.

**Run:** `node tmp/redesign/gates/writer-gate.js`
