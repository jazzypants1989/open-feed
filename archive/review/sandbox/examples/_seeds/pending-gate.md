# pending-gate — what the pending line buys, and whom

**Review gate** (2026-08-23 review, finding A4; the owner rules after it). Substrate: weekend
reader and publisher, unchanged, over a loopback socket against `hub.js`.

**Question.** §4.5 lists a scheduled post as `[n, hash, "pending"]`: a reader MUST NOT fetch it,
and it is confirmed by a bare line in a index only the device can sign. RULINGS §10.5 kept it with
one cost stated ("a host sitting on a scheduled post is uncalled…") and no purpose stated. What
does any reader observe from the line before the device confirms? What can the hub do at release
time? And what does the device do if the line does not exist?

**Method.** Alice with seven posts, a reader pinned. Monday she lists post 8 pending (the bytes
stay on her device); Tuesday and Wednesday she posts 9 and 10; readers pinned and cold look. The
same two reads against the same index with the pending line deleted. Friday the hub tries to
release by appending the confirmation itself. Saturday the device confirms. Then the design
without the line: the device publishes the scheduled post at release time at the next number;
and the thing the line was for — Monday's number listed late below a top a reader has seen.

**Numbers** (stale if §4.5 or the reader's fetch step change):

- Between the line and the confirmation, pinned and cold: `ok [1–7, 9, 10] pending: 8`; post 8
  fetched **0** times. With the line deleted from the same index: **identical** but for the note.
- The hub appends the confirmation: pinned `ok` with *no index I can verify*, post 8 absent; cold
  `host`. **The hub cannot release anything.**
- The device confirms: 8 appears below top 10, and a pinned reader accepts it — the line's one
  effect: **a number reserved on Monday can be listed on Saturday without reading as a backdate.**
- Without the line, the scheduled post lands at **10** at release time, `ok` everywhere; the
  device has the key and the bytes and §5.1 signs the number in, so it needs nothing. Listing
  Monday's number late instead is `host: post 8 is listed now and was not before` — the same
  check gapless-gate found, which the pending line is the only way around.
- Cost: **18 spec lines**, 7 reader lines, 4 publisher lines — the entry table, the fold's
  confirmation clause, the rewrite's carry-through, §7.4's exemption, a note, a §13.2 row, a pin
  field, and B.10/B.11.

**Kill criterion.** A reader-observable effect before the device confirms (none); a hub able to
release (it cannot); a design without the line under which a scheduled post cannot be published
(it can, at the next number). **Not triggered.**

**Revert-checked** (`revert.js`): making the reader fetch a pending entry turns the "0 fetches"
row red; removing `top: 8` from Monday's index makes the confirmation read as a backdate.

**Verdict.** `pending` is a number reservation: it lets a post scheduled on Monday keep Monday's
number. Nothing a reader sees before the device acts depends on it, the hub can do nothing with
it, and the device can publish the same post at the next number with nothing it lacks. Keeping it
buys a stable number for scheduled posts at the price above, and §4.5 must then state that
purpose, since the text states only the cost. **The owner rules** (plan-mode answer 2026-08-23:
after this gate). Cutting it reverses RULINGS §10.5.

**Held to the ruling (2026-08-23, RULINGS §13.5 — cut).** The gate now asserts the ruled design: a
index carrying the retired three-element line does not fold; the scheduled post lands at the next
number and reads as an ordinary post; a number reserved in advance and listed late below a seen
top is `host`; and the word is gone from the spec and both reference files (18 → 0, 7 → 0, 4 → 0).

**Run:** `node examples/_seeds/pending-gate.js`
