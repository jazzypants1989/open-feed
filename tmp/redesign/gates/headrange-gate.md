# headrange-gate — does range-fetch tame the list head's linear growth?

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §3
claim 2). Substrate: the `{hseq, prev, entries:[[n, hash]]}` head over `lastline.js`. The
numbers come from `tmp/measure/headrange.js`; the gate guards the structural half.

**Question.** The handoff says the head is "intended to be range-fetchable (sorted, append-stable,
signature on the last line)" and that this tames its growth, "asserted with mental arithmetic."
Two things have to be true: a reader that cached the last head can rebuild the new one from a
tail fetch and *never accept a wrong rebuild*; and the bytes that saves have to survive the
versions that are not appends.

**Method.** Gate: heads at hseq 9 → 10 (append, and a digit carry) → 11 (a middle edit; a
withdrawal), under both field orders; a reader that keeps the verified bytes up to the last
entry, fetches the rest, and accepts only if the reconstruction verifies. Measurement: a seeded
ten-year history at two scales with edit/withdrawal rate e ∈ {0, 0.5%, 5%}; readers on hourly,
daily, and weekly cadences trying the tail first and paying tail + full on failure; compared to
always-full, ruling 4's counter at the same withdrawal rate, and a 1,000-entry paged head. Sizes
are arithmetic over the real serializer's layout, checked against `JSON.stringify` at
checkpoints; gzip is measured on real-entropy hashes.

**Numbers** (stale if the head shape, entry width, or the workload constants change):
- 52.4 B per entry; **81.6 KB** head at 1,557 posts, **5.39 MB** at 100,000. gzip to 71% / 68%
  — and `Range` over `Content-Encoding: gzip` addresses compressed bytes, so the two do not compose.
- Append tail: 140 B (prefix-first, two ranges) / 202 B (entries-first, one range) against a
  463 B head. Entries-first costs **0 bytes** and the prefix is byte-stable; prefix-first's
  entries shift by one byte when hseq gains a digit and the reader must re-read the prefix.
- Family, year 10, daily: always-full 12 MB/reader; range reader **0.03 MB** at e=0, **1.0 MB** at
  e=5% (92% of tail fetches succeed). The list head is fine at family scale at any edit rate.
- Active (100k posts, 27/day), year 10, daily: always-full 1.87 GB/reader; range reader **0.6 MB**
  at e=0, **216 MB** at e=0.5% (88% tail success), **1.43 GB** at e=5% (21% success — 27 versions
  per poll and 0.95²⁷ ≈ 25%). Weekly at e=5%: 0% success, range = always-full + the wasted tails.
- Public journal, 10,000 followers polling daily, egress per year: always-full 18.2 TB; **list
  with range 0.01 / 2.16 / 14.32 TB** at e = 0 / 0.5% / 5%; paged head 0.21 / 0.23 / 0.49 TB;
  counter 0.001 / 0.005 / 0.051 TB.
- Ruling 4's "138-byte counter" is 178 B with a prev-hash at e=0 and **337 B** at e=5% family scale,
  **14.9 KB** at e=5% active scale (the withdrawn list grows; the counter cannot express an edit
  at all, which is `substitution-exp.js`'s objection to it).

**Kill criterion.** A cached prefix that changes under an append; a reconstruction after a middle
edit or withdrawal that verifies; a reorder that costs bytes. **Not triggered.**

**Revert-checked** (`revert.js`): forcing `headBody` to prefix-first regardless of order (the
entries-first stability row goes red); making the reader accept a reconstruction without
verifying it (the edit and withdrawal rows go red — a stale middle would be accepted silently).

**Verdict.** The structural claim holds: tail reconstruction is sound and a wrong one is always
detected. The scaling claim **does not hold as stated**: range-fetch tames growth only while the
fraction of versions that touch the middle of the list, compounded over the versions between two
polls, stays small. At the public-journal case the handoff asked for, the range reader spends
79% of always-full at e=5% — *collapse*, in the handoff's word — and 12% at e=0.5%. The design
has never stated an edit/withdrawal rate, and the verdict flips on it. Field order is worth one
request per poll, not bytes. The shape that survives edits is a paged head (fixed-size pages as
their own files, the head listing page hashes): 0.49 TB/year at the worst case tried, and it
keeps every admission property because a page is just a slice of the same `[n, hash]` list.

**Run:** `node tmp/redesign/gates/headrange-gate.js` · `node tmp/measure/headrange.js`
