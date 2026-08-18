# deltamanifest — is snapshot+delta worth a second manifest shape?

**Question.** Retained manifest history grows as O(versions × items) because every version carries
its whole `items` map — §13.4 calls it the largest storage obligation in the protocol, and §9.1.1's
`_skip` papers over the walk cost. Would versions that carry only what changed (a DELTA), with a
full SNAPSHOT every Nth version, be worth the second document shape that "one way of doing each
thing" forbids?

**Method.** Size both models over one deterministic workload (adds plus per-version edit/delete
churn) at three scales — §9.2's own worked example (10y daily, no rotation), §9.2's actual
recommendation (1y daily), and a volume publisher (1y hourly). Byte arithmetic is self-checked
against real serialization before anything prints. Price: total retained history; reconnecting a
pin 1 day / 1 month / 1 year back, each model against its **own** §13.4 budget (B's tip is a tiny
delta, so its budget is the 10 MB floor — stricter); first contact; and the at-rest claim, by
honestly serializing one year's chain and compressing the retained series for real
(per-file gzip / whole-set gzip / brotli / zstd) against a delta encoding of the same series.

**Numbers** (all stale-prone — directional ratios that could invert with a different compressor,
snapshot cadence, or scenario table; re-derive with `node tmp/measure/deltamanifest.js` before
relying on any of them):

- Retained storage: B wins by ~40–60× (38.5× / 58.6× / 60.5× across the three scenarios).
- The day/year inversion: 1 day back at hourly cadence, B-delta 0.0 MB vs A+`_skip` 2.5 MB;
  1 year back it inverts — B-delta 59.4 MB (the whole history, **over** §13.4's budget, `_skip`'s
  own case) vs A+`_skip` 3.9 MB, because `_skip` is O(log versions) and a delta chain is
  O(changes). B+`_skip` dominates both (1.5 MB) — the verdict is *not* that A is cheaper.
- At rest (365 versions, real bytes): whole-set brotli 276× and zstd 215× beat an actual delta
  encoding (38×); whole-set **gzip only 2.6×** — its 32 KB window is smaller than one manifest
  version — and per-file gzip 2.3×, the column a static host serving precompressed files gets.

**Verdict.** Keep Model A, the full map per version — not on transfer or storage cost, both of
which B wins, but on what the second shape spends: §9.3's invariants become a fold over a range
instead of a map lookup between adjacent versions; invariant 1 is only checkable against
reconstructed state a consumer must hold; and §5.3.1's observers end up holding reconstructed
state in common rather than published bytes. The storage win is bought at the wrong counter:
**the same order of win is available at rest with no wire change** — the claim §13.4 now carries
("compressing or delta-encoding at rest brings the bytes on disk to roughly O(total changes)") —
with two qualifications the measurement earns: it takes a large-window compressor or a
cross-object-dedup store (brotli/zstd, not gzip, whose window is smaller than one version), and a
static host serving precompressed per-file assets gets the per-file column, not the cross-version
one.

**Measure, not a gate.** This lives in `tmp/measure/` and is not run by CI. It imports nothing
from `src/` — it prices two document shapes against each other, it does not guard shipped code —
and its verdict rests on directional ratios that a compressor, cadence, or scenario change could
invert. The script still asserts its 8 directional claims and exits 1 naming any that fail, so
re-run it before leaning on the ratios (in particular before §13.4's at-rest sentence or the
Stage 3 skip-links hypothesis, whose counter-cost is the inversion above).

**Original:** `tmp/archive/deltamanifest-prototype.js` (Q1–Q5 narration, the per-question prose,
and the full recommendation argument).
