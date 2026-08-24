# log-gate — one event log with checkpoints, at family scale

**Candidate gate.**

**Question.** Can one append-only event log (O(1) typed events, checkpoint every K=256) replace
the two chains + manifest, with invariant checks that never consult reconstructed state — and
does it beat today's Model A + `_skip` on the deltamanifest card's own scenarios?

**Method.** Builds the 10-year family journal (3 posts/day, 5% edit, 1% delete) as a *really
signed* log; runs the windowed checkpoint audit (prev state blob + window events, nothing else,
resumable at any checkpoint); stages every violation class against both the per-hop fold and the
any-two-checkpoints map diff; prices first contact / 6-month lapse / full audit; re-runs
`tmp/measure/deltamanifest.js` live (subprocess) for the Model A numbers.

**Numbers** (stale if K, the event shape, or the deltamanifest scenario table changes):
- 11,707 signed events, 45 checkpoints, built in ~420 ms; avg token 427 B.
- Retained forever: **27.8 MB** (events 4.8 MB + checkpoint state blobs 23.1 MB — **the blobs
  dominate; the checkpoint cadence K is the storage knob**).
- First contact: **1,105 KB, 4 fetches** (kill: >5 MB or >20). Lapsed 6 months: 293 KB,
  3 segment fetches. Full audit from genesis: 27.8 MB, 46 fetches.
- vs Model A (re-run live): retained **68× / 28× / 130×** smaller across the three scenarios;
  1-year lapsed walk at the hourly scenario: A+`_skip` 3.9 MB vs log **1.1 MB (skip mode)** /
  4.8 MB (linear). Advance cadence stops mattering: the daily and hourly scenarios cost the
  same log, because cost tracks changes.

**Kill criteria.** First contact >5 MB or >20 fetches; audit needing cross-window state; a
violation class the per-version diff catches that checkpoint pairs cannot; 1-year lapsed walk
exceeding A+`_skip`. **None triggered — but the last one fired during development** and forced a
design consequence: **checkpoint events must be individually addressable** (a skipping reader
fetches checkpoint events + ONE landing state blob, not every blob). With them buried in
segments, the 1-year walk was 50 MB and the candidate died. The layout now owes
`events/<id>`-style addressing for checkpoints at minimum.

**Verdict.** The log shape holds. The deltamanifest card's fold objection is dissolved, not
argued away: integrity checks per hop are hash + contiguity + O(1) content rules; the live set is
*defined* by the fold and consulted by no integrity check; skip readers compare **published
checkpoint bytes** at shared positions (the §5.3.1 requirement), and the checkpoint audit is
windowed and optional. §9.2's Merkle objections: the state blob is still a plain map (no
inclusion proofs, no dynamic endpoint); static hosting improves (immutable segments + one growing
file). Honest residue: checkpoint blobs are the new O(live set) recurring term — rotation's
successor problem at ~100× lower cost, and a 100k-item identity still needs a sharding answer.

**Run:** `node tmp/redesign/gates/log-gate.js`
