# Review: `tools/revert.js` rows 1–22 of 44 (first half)

Scope: rows 1–22 by position (N = 44, ceil(N/2) = 22). Row 22 is the first `media-gate` row
(`sha256(f) !== n`). Every row in this range mutates a **seed gate** or the **weekend reader/publisher**,
never `src/`; the `src/` rows start at row 36 and belong to the second half.

Method: the tree was copied to `tmp/review/tree-A/` (deleted afterwards), each row applied there, and
the gate run to see *which* claim goes red. Subtler mutations were then probed the same way. No tracked
file was touched and `npm run revert` was not run.

One structural note first: **none of these 22 rows carries a per-row comment naming a spec rule.**
The only comments are the section headers ("The envelope moved...", "The 2026-08-23 review gates"). So
"the rule the comment claims" below is what the `from` text's own comment, the gate's claim text, and the
gate's header say it is. A per-row `// §x.y` label would make this audit mechanical next time.

## Table

| # | gate | edit (what actually changes) | rule it hits | claim that goes red | class |
|---|------|------------------------------|--------------|---------------------|-------|
| 1 | weekend-gate | reader accepts a profile whose `anchor` is not the learned key | §7.1 step 2 | "substituted identity ... identity" | RIGHT |
| 2 | weekend-gate | index verified under *any* chain key, not the current one | §4.6 / §7.2 step 7 | "mid-rotation ... keeps the index it verified" (goes red because the `no index I can verify` note vanishes, not because anyone is accused) | RIGHT |
| 3 | weekend-gate | drops both the address check *and* the `n`-declares-its-number check on posts | §7.4 step 10 | "older index, swapped post ..." (the swapped post is caught by the **address** half only) | RIGHT-BUT-BUNDLED — the `n` half is dead weight; see below |
| 4 | weekend-gate | drops "still above top after the look" *and* one-line-per-person de-dup | §7.5 bound 2 | "thousand replies ... cost one look" (`grief.length === 1`) | RIGHT-BUT-BUNDLED — only de-dup is what weekend-gate sees; the other half is caught by twohubs-gate claim 9, not by this gate |
| 5 | weekend-gate | reader looks again for targets at/below top | §7.5 step 11 | "at or below the top costs no fetch" | RIGHT |
| 6 | weekend-gate | reader re-fetches once per reply, not once per identity | §7.5 bound 1 | same claim (`noisyFetches === 5`) | RIGHT |
| 7 | gapless-gate | fold accepts a 3-element entry | §4.1/§4.2 (implicit: the entry table has no 3-element line) | "retired pending line does not fold" | RIGHT (spec rule is implicit — §4.2 has no explicit arity MUST) |
| 8 | gapless-gate | the whole §7.2 step 9 back-check is skipped | §7.2 step 9 | late listing, backdating, reserved-late (3 claims) | WEAK — strawman; `n > pin.top` → `n >= pin.top` slips every gate |
| 9 | gapless-gate (its own Hub) | hub lets the owner overwrite her own file | §8.5 "the owner cannot overwrite their own" | 5 claims (orphan retaken, crash lands at 8 ...) | RIGHT but **harness-only** — it mutates the seed's stand-in hub, not an implementation; and that hub's `owners()` accepts *any* chain key, which §8.5 forbids |
| 10 | court-gate | split detection off (`i = -1`) | §3.6 rule 1 | thief followed; tie not contested; 1-of-2 not contested | RIGHT |
| 11 | court-gate | prefix-at-higher-version not a split | §3.6 rule 1, 2nd sentence | "forgets her restore is a fork" | RIGHT |
| 12 | court-gate | carried recovery lists always overwrite held ones | §3.6 rules 2 + 3 | listed adversary; rewrite-list-first; cold-then-other | RIGHT (two rules in one edit; the `!(j in ...)` guard is the load-bearing one — dropping only `j >= from` is a no-op, probed green) |
| 13 | court-gate | link validity judged by the carried list | §3.6 rule 3 (validity) / §7.1 step 4 | same three claims as 12 | RIGHT (row 25 is the same rule one line up, via `recovery = link.recovery`; both fine) |
| 14 | court-gate | contest decided by ≥1 voucher instead of majority | §3.6 rule 4 | "1-of-2 vs bare rotation contested; 2-of-2 settled" | RIGHT — but see below: the spec's headline case for rule 4 is only in the pure-function table, not through the reader |
| 15 | envelope-gate (seed envelope.js) | content AAD = `epk` only | §6.2 MUST | "bound ... lifted does not open" | RIGHT |
| 16 | envelope-gate | floor policy becomes pow2 | §6.4 SHOULD (8 slots / 512 B) | "floor does not tell a DM from a family post" | RIGHT — label it SHOULD, not MUST |
| 17 | envelope-gate | one fixed ephemeral for every message | §6.1 "one ephemeral per message" (→ §6.3 unlinkable tags) | "tag does not link across two posts" | RIGHT-BUT-MISLABELED: the rule is §6.1's per-message ephemeral; §6.3 blinding is the consequence the gate measures |
| 18 | twohubs-gate (its own `thread()`) | the *demo's* thread assembly stops comparing target hashes | §5.4 | "assembles the thread ... number AND hash" | INCIDENTAL — mutates the harness's client code; the reader's own §5.4 line (221) is unobservable, see below |
| 19 | twohubs-gate (staging) | sealer takes the read key from the served profile | §3.8 / §6.5 | "sealing to an unverified read key hands the thread to the host" | INCIDENTAL — staging self-test; no implementation is exercised |
| 20 | twohubs-gate (its own assertion) | swaps the expected fetch counts M↔J | §7.5 "look again at the author's hub" | the claim it edits | WEAK — edits the assertion, proves only that the gate counts; replace with `if (!refreshed.has(t.key))` → `if (false)` (probed: red on 4 twohubs claims + 1 weekend-gate) |
| 21 | twohubs-gate (staging) | Jesse's reply names Mom's *old* hub | §3.7 / §7.5 `loc` follow | "follows Mom to the new one"; "frozen copy refused" | RIGHT as staging; the second claim going red is incidental (with no move followed, the "frozen" read is not older any more) |
| 22 | media-gate | media bytes not checked against listed hash | §4.4 / §7.4 step 10 | "swapped media ... the hash catches it"; "unchecked hub → readers accuse her host" | RIGHT |

Also: row 7 is byte-identical to row 31 (pending-gate) and row 1 to row 34 (audience-gate). Not wrong —
the same edit is checked by two gates — but the table is longer than the set of distinct edits.

## Notable rows, expanded

**Row 3 — the `n` check is untested on the weekend side.** Mutating only `post.obj.n !== n` → nothing
(keeping the address check) is green in every gate that uses the weekend reader (weekend, gapless, media,
twohubs, court, oldkey, pending, audience, coldcourt). No gate stages an index that lists at number 3 a
file whose body says `"n": 2`. Because the index is signed by the current key, the only actor who can do
this is the author (or a custodian with her key), which is exactly the §12.2/gapless-gate custodian
scenario — one extra staging line there (`amendIndex` listing `[3, address(post declaring 2)]`) plus a
row `post.obj.n !== n` → `false` closes it.

**Row 8 — strawman.** `if (typeof n !== 'number' || n > pin.top) continue;` → `if (true) continue;`
deletes the whole step-9 back-check. The realistic regression is the boundary: `n > pin.top` →
`n >= pin.top` is green in gapless, weekend, pending and media. The case that would catch it is a number
equal to the pinned `top` that was never live (an author who bumped `top` ahead of a listing, as gapless
s6 does with `top: 8`, then lists 8 late against a pin taken at `top: 8`). Suggest a second row with the
`>=` edit once that staging exists.

**Row 9 — the seed hub is not §8.5-conformant, and the row can only ever test the seed.** `owners()` in
`examples/_seeds/gapless-gate.js` line 26 uses `chain.some(...)` — any chain key — while §8.5 says the
owner's file is one signed by the key the chain *currently ends on* (or listed). gapless-gate never stages
a thief with a rotated-out key squatting, so its hub's looseness is invisible; oldkey-gate (row 27,
second half) covers the real rule against `_seeds/hub.js`. Row 9 is fine as a harness self-check but
should not be read as evidence for §8.5.

**Row 14 — the reader-level majority rule is proved only by its price, never by its purpose.** court-gate
scenario 2 ("the ex, listed, vouches himself") has the ex carry *his own* list, so his link is refused by
rule 3 before rule 4 ever runs. The case §3.6 names — the ex vouching himself under the **real** list of
three, against Alice's bare rotation — appears only in the pure-function table (rows 133–145), which
does not touch the reader. Subtler mutations `* 2 >` → `* 2 >=` and "≥ k" are both caught, but only by
the "1-of-2 vs bare rotation stays contested" claim. A staged scene (REC3, thief = `restore(A2, T,
[ex], REC3)` vs Alice `rotation(A2, A3, REC3)`) would let row 14's edit go red for the reason the rule
exists.

**Row 18 — §5.4 in the weekend reader is unobservable.** Line 221 of the reader
(`if (listed() !== undefined && listed() !== t.hash) { t.unresolved = true; continue; }`) has no effect
any gate can see: when it fires, `t.n` is necessarily ≤ `top`, so the next line `continue`s anyway; the
only side-effect is `t.unresolved`, which no gate (and no demo) reads. Probed: `if (false) {...}` is
green in weekend, twohubs and gapless. Row 18 instead mutates the gate's own `thread()` helper, which
does its own hash comparison. Either make a gate consult `p.target.unresolved` after `rumors()` (or have
`read()` set it), or drop the pretence that the weekend reader is tested for §5.4.

**Row 20 — tautological.** The `from` is the gate's assertion expression; the `to` is the same assertion
with the numbers swapped. It cannot detect any change in any implementation. Replace with the
implementation edit `if (!refreshed.has(t.key)) {` → `if (false) {` (red in twohubs on 4 claims).

**Row 2 — right rule, note the evidence is the honest window.** weekend-gate never serves a thief-signed
index; the mid-rotation claim reddens because the honest old-key index now verifies and the note
disappears. The adversarial case ("an index signed by a rotated-out key, to a cold reader") lives only in
the weekend reader's own demo, which `npm run examples` diffs — so it is covered, just not by this gate.

## MUSTs in the covered sections with no row (weekend reader / seed envelope side)

Probed by disabling each line and running every gate that uses the weekend reader. "green" = no gate
notices; "caught by X" = a gate already fails, so a row is one line away.

| rule | reader line | probe result |
|------|-------------|--------------|
| §3.3 first link key MUST equal `anchor` | 124 | green everywhere |
| §3.3 `recovery` REQUIRED on every link | 83 | green |
| §3.3 **distinct** voucher keys | 77 | green (no gate double-vouches) |
| §3.4 leaf = `SHA-256(salt‖"|"‖key)` | 77 | green (no gate offers a voucher off the list) |
| §3.3 a restore changes the key and nothing else (pinned MUST check) | 151 | green in weekend, court, coldcourt, twohubs |
| §3.6 `version` MUST NOT go backwards (profile) | 148 | green in weekend/court/oldkey; twohubs claim 10 catches it incidentally (via row 21's staging) |
| §3.6 same `version`, different address → contested | 149 | **green in weekend-gate despite its "second profile at the same version" claim** — that scene is settled by the split rule (chains differ), so line 149 never runs |
| §3.4 recently-restored flag (SHOULD) | 155 | caught by weekend-gate — row is free |
| §4.2 withdrawal MUST refer to something live | 102 | caught by gapless-gate only ("cannot withdraw what was never listed") |
| §4.2 numbers start at 1 | 101 | green |
| §4.2 `top` ≥ highest number issued | 165 | green everywhere |
| §4.2 media file new whenever it appears | 99 | green (media-gate never re-lists a live hash) |
| §7.1 unparseable profile → identity (not host) | 123 | green |
| §7.2 cold reader with no verifiable index → host | 167 | green in weekend/court (twohubs crashes on it, which is a crash, not the rule) |
| §7.2 index `version` MUST NOT go backwards | 174 | **green everywhere** — weekend-gate's "older index" scene is caught by `top` going backwards (176), not by version |
| §7.2 same index `version`, different address → host | 175 | green |
| §7.2 `top` MUST NOT go backwards | 176 | green as a direct probe target (it is what silently carries the rollback claim) |
| §7.2 comes back at another hash → host | 184 | caught by oldkey-gate only |
| §7.4 listed and not served → host | 193 | caught by weekend, gapless, media — row is free |
| §6.3 tag is a hint: MUST keep scanning after a failed unwrap | seed envelope.js 70 | green (envelope-gate stages no tag collision; `src` has a row in the second half) |
| §6.4 dummies MUST NOT be derived from anything a recipient holds | seed 57 | green (`src` has a row; the seed does not) |
| §6.4 body bucket is `length + 2` | seed 47 | green |
| §6.1 wrap AAD = `epk`; §6.5 audience inside | seed 51 / 45 | caught by envelope-gate vectors — rows are free |
| §6.5 publisher MUST include itself in the audience | — | nothing checks it on either side |
| §7.2 cold reader SHOULD retry once | — | the weekend reader does not implement it (SHOULD, so not a defect; worth a note in weekend-reader.md) |

Rows 2, 5, 6, 10–13, 15, 22 are exactly what they claim and need nothing.
