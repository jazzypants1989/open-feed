# Review — the fresh-start design, doubted with code (2026-08-21)

**Written by the agent that took `HANDOFF-fresh-start.md` at its word: doubt it, then make the
doubt reproducible. Nothing here is implemented; everything here runs.** Eight candidate gates and
one measurement in `gates/` and `tmp/measure/`, each with a card, every assertion revert-checked
(`node tmp/redesign/gates/revert.js`: 18 mutations, 18 caught). `src/`, the spec, `GOALS.md`,
`RULINGS.md`, `TLDR-new.md`, and the `decisions/` experiments are untouched; `npm test` (267) and
`npm run prototypes` (11) are green; `TLDR-new.md` still passes `tldr-check.js` at 199 / 92 / 8.

The short version: **the design's skeleton survives — three signed kinds, genesis identity,
admission, per-post signatures, a pinned head — and four of its six load-bearing claims are
either false as stated or true only under a rule the design does not yet write down.** None of
the breaks needs a new mechanism; each needs a sentence the owner has to choose.

## 0. The handoff's own §0, checked

| claim | result |
|---|---|
| TLDR-new passes the three budgets | yes — 199 / 92 / 8 |
| "zero RFC 2119 keywords" | true, but `tldr-check.js` does not count them (that is `tmp/rules.js`, spec only) |
| every `decisions/*-exp.js` runs | all 24 exit 0 |
| `bytes-gate` transfers to last-line | **half.** The body does; the signature line does not (claim 1) |
| the old gates prove the new head | they do not, as the handoff says; `gates/README.md` now labels the substrate of every gate |

## 1. Last-line signing is as safe as compact-JWS — `lastline-gate`

**Asserted:** same malleability argument as bytes-gate, no re-serialization, nothing swept.
**Found:** body and separator are not malleable (1,544 mutations, 0 verify under either decoder);
every helpful-host transform fails closed; Ed25519 S+L is rejected. **The signature line is
unboundedly malleable under the decoder every experiment uses**: 2,658 mutations, 0 verify under
a strict decoder, **638 distinct files verify under `Buffer.from(s, 'base64url')`** — Node skips
non-alphabet bytes and ignores the last character's four unused bits. `bytes-gate.md` found this
on the old substrate and made the strict-spelling rule the condition of its verdict; the rule
and the four-item parse-hygiene list were both dropped when the helpers were rewritten. The
reference `parse` also mis-splits a file with no separator (fails closed by luck).
**Verdict: holds under two MUSTs the design does not state.** The signature line is exactly 86
base64url characters whose canonical re-encoding is themselves; a file's address is the hash of
its *body*. Without the second, "hash-addressed" read naturally gives one post 638 addresses.
`JSON.parse` accepts 4 of the 5 divergence cases; "no canonicalization" does not delete the
duplicate-member sentence.

## 2. The head is cheaply range-fetchable and that tames its growth — `headrange-gate`, `tmp/measure/headrange.js`

**Asserted:** with mental arithmetic.
**Found:** the structural half holds — a tail reconstruction after an append verifies and is
byte-identical; after any middle edit or withdrawal it does not verify, so the fallback is always
detected. Field order is worth one request per poll, not bytes (entries-first costs 0 B). The
scaling half **does not hold as stated**: it depends on (1−e)^k, the chance that none of the k
versions since the last poll touched the middle. Family scale (81.6 KB head): fine at any edit
rate. 100k posts polled daily: 0.6 MB/reader-year at e=0, 216 MB at 0.5%, **1.43 GB at 5% — 79%
of always-full.** The public journal the handoff asked for (10k followers): 14.3 TB/year at 5%,
vs 18.2 TB always-full, 0.49 TB for a paged head, 0.05 TB for the counter. gzip helps 30% and
does not compose with `Range`.
**Verdict: collapse at the handoff's own 5%, holds near 0.5%; the design has never stated an
edit rate.** The shape that survives edits is a paged head — fixed-size pages as files, the head
listing page hashes — which keeps every admission property. Ruling 4's "138 bytes" is also
stale: 178 B with a prev-hash, 337 B at 5% withdrawals, and the counter cannot express an edit.

## 6. Admission + per-post signature vs head-only — `persig-gate`

**Asserted:** the owner leaned "keep per-post sig"; price the alternative.
**Found:** they do different jobs (injection vs portability). The signature is 87 B/post: 135 KB
for a family archive, 8.7 MB at 100k, 87 GB across a 10k-follower journal — **13.6% / 0.61% /
0.61% of one year's head egress.** A Merkle proof for a withdrawn post costs 5–8× the signature.
**Verdict: keep per-post signatures; the handoff's framing compared the wrong two numbers.** The
unstated consequence: **a signed DM is non-repudiable.** Head-only signing would have made a
withdrawn private message deniable; the design chooses provable-forever without saying so.

## 3. The split-view detector covers what it claims — `splitview-gate` (real sockets)

**Asserted:** "cannot show two people different histories without their replies colliding."
**Found:** Issue 5's mechanism works where it says. Three things it does not say:
- **The detector is floor item 4 doing the work.** Captive family (Alice, mom, cousin on one
  hostile hub): 4 of 63 strategies escape readers and echo — each isolates one member both ways.
  Add one interacting outsider with a social path to the stale reader: **0 of 511** escape.
  Remove the path: strategies escape again. A hub-served web app that proxies the outsider fetch
  kills it as surely as captivity — bring-your-own-client (`GOALS.md:62`) is load-bearing.
- **Uniform stale is undetectable by design.** Everyone but Alice capped at 40; all pins agree;
  no verdict anywhere. The only signal is Alice's own device seeing a low pin about her in an
  outsider's reply — a freshness judgement ruling 7 retired, and to a real author
  indistinguishable from honest lag.
- **The pin as specified is a forgery vector.** `(999, junk)` from any valid key makes an honest
  host read as WITHHELD; `(47, junk)` makes an honest Alice read as **FORKED**. Repair A (pins are
  hints, convict only on a verified head) neutralizes both and demotes the genuine F1 case to a
  hint too. Repair B (the head signs `hseq\nH(body)`, so the pin verifies offline at ~150 B)
  keeps the verdicts; signing the hash alone is not enough.
Latency: 1 / 2 / 4 / 15.5 days for an outsider replying every 1 / 3 / 7 / 30 days; never when
captive. Griefing is bounded (1,000 pins → one re-fetch). Sealed replies add no class.
**Verdict: holds for the adversary Issue 5 named, under a repair the owner must pick, and only
where floor item 4 already holds.** The naive rule is not shippable.

## 4. Recovery as the fork court is coherent and safe — `salt-custody-gate`, `forkcourt-gate`

**Asserted:** new this session, ungated.
**Found, custody:** the design never says who holds the salt, and `inventory-keys-exp.js` Issue 4
assumed the one answer that breaks scenario 2. Owner-only salt: Grandma cannot be restored — it
was on the phone. Shared with members: Grandma is restored, and **the listed ex restores himself
with no prior leak**, so Issue 4 Case 1 ("he does not know s3") is false. No custody model gives
both. The per-member leaf (`H(k || sorted H(salt_i || key_i))`) restores Grandma, reveals one
member per restore instead of the list, defeats enumeration (unsalted: 38 guesses; leaf: not
found in 6,195), and still cannot stop a listed member under k=1 — nothing can.
**Found, court:** the objection has no wire shape; the only thing it can be — a competing
profile at the same pseq — produces `contested` for warm readers and a clean accept of whichever
branch a cold reader is served. After seven days: still contested; **the only in-design tie-break
(k members vouch) is met on both branches under k=1.** The restorer relocates at pseq 5 inside
the window and 0 of 5 followers ever see the objection (5 of 5 with a rule to keep polling the
pre-restore location — which is useless when that host is the ex's). A thief holding A rotates
as "proving it yourself": no flag, **window protection 0 days**, and his rotation may rewrite
the recovery list, which a restore may not. Judged by each branch's own list both win; judged by
the list **at the fork point**, Alice alone. An empty list has no court at all.
**Verdict: not yet a court.** Four rulings are owed: salt custody (leaf recommended); what an
objection is and where it lives when the old host is hostile; what settles a contest
(majority of fork-point members is the rule this gate shows working; never-settles is a dead
identity; A-wins lets a thief block every restore); and that the court is the fork-point list.

## 5. Three kinds cover every operation — `kinds-gate`, `scheduled-gate`

**Asserted:** the artifact inventory's table.
**Found:** three *signed* kinds hold. Two sentences do not. "Edit maps onto the head": in-place
editing is distinguishable from a host swap but **indistinguishable from a compromised-key
rewrite**, needs the host to overwrite a number (the two-device race then loses a post), leaves
two `n: 7` files the family archive cannot order, and strands every old reply. An edit must be a
new number with a `supersedes` pointer; the owner must say whether the superseded number stays
listed. "Everything is a signed file": a photo is an unsigned hash-named file admitted by
reference — a fourth file kind — and retention reaches it only if the host parses posts or the
head lists blobs (+55 B per photo; the head doubles at one per post). Follow, mute, board are
reader-local or generated. The contact list (handoff §5) is the undesigned piece; both homes for
it — sealed-to-self posts or a profile blob — cost a version per change and show the rhythm.
**Scheduled posts (A1):** under admission the host cannot make #8 Alice's. Pre-signing Friday's
head **forks Alice's own identity against her Tuesday post** (or rolls it back); listing #8 as
pending makes the verdict depend on the reader's wall clock. **0 of 4 options** pass every column.
Drop host release, or accept a clock-gated verdict declared as UX.

## Conflicts with the written record, now surfaced (`rejections.md` §11–13)

1. **Item-carried pins** — `GOALS.md:80` retires them; the design's detector is one. ⚠
2. **Counter → list** — ruling 4 chose the counter; the design uses the list, unruled and, until
   now, unpriced. ⚠
3. **Scheduled posts** — ruling 10 cannot coexist with admission. ⚠
4. `GOALS.md:65–70` still says "enough peers a reader already trusts"; ruling 6 rejected it.
   To amend when the rulings fold in.
5. Handoff §5 demotes "a post declares its own number" to a convenience; ruling 3's create-once
   host rule and `kinds-gate`'s edit finding both depend on numbers being load-bearing. Keep it.

## Reader states the gates would add

`unverified-claim` (repair A), `contested` (forkcourt), `recently restored` (ruling 6),
`pending` (scheduled option 3). Four beyond §5's target of three. Repair B removes the first;
dropping host release removes the last; the middle two are the price of recovery existing.

## What the owner must rule on (nothing below can be settled in code)

| # | ruling owed | the gate that forces it |
|---|---|---|
| 1 | Strict base64url spelling on the signature line — MUST | lastline |
| 2 | A file's address is the hash of its body — MUST | lastline |
| 3 | Duplicate member / `__proto__` / big-int / lone-surrogate rejection — one sentence | lastline |
| 4 | The edit/withdrawal rate the head's scaling story assumes; or adopt the paged head | headrange |
| 5 | Pins as hints (A) or the head signing `hseq\nhash` (B); decide with #1–2 | splitview |
| 6 | The author echo as permitted UX, given ruling 7 | splitview |
| 7 | Salt custody — per-member leaf recommended | salt-custody |
| 8 | What an objection is on the wire and where it lives when the old host is hostile | forkcourt |
| 9 | What settles a contest; the court is the fork-point list; the empty-list case | forkcourt |
| 10 | A1: drop host release, or `pending` as UX | scheduled |
| 11 | An edit is a new number with `supersedes`; does the old number stay listed | kinds |
| 12 | Blob retention: head lists blobs, or the host parses posts | kinds |
| 13 | Where the contact list lives | kinds |
| 14 | DM non-repudiation as a stated consequence of per-post signatures | persig |

## How to re-derive everything here

```
for f in tmp/redesign/gates/*-gate.js; do node "$f" || echo "RED: $f"; done   # ≈ 30 s
node tmp/measure/headrange.js                                                # ≈ 1 s
node tmp/redesign/gates/revert.js                                            # ≈ 75 s
npm test && npm run prototypes && node tmp/measure/tldr-check.js tmp/redesign/TLDR-new.md
```

Every number in this file is copied from a run on 2026-08-21 and is stale the moment
`lastline.js`, a gate, or a workload constant changes. The cards say which.

## Rulings (2026-08-21)

The owner walked the table above one row at a time; the rulings are `RULINGS.md` §11, the three ⚠
reversals are answered in `rejections.md` §11–13, and four experiments built after the rulings
check the ones that rest on a number: `decisions/headage-exp.js` (row 4 — the collapse needs both
of this review's assumptions, and fixing them does not rescue the flat list; the append-only head
does), `targetrumor-exp.js` (rows 5–6 — the pin is dropped; the reply's target is the rumor),
`scheduled5-exp.js` (row 10 — a fifth option passes every column), `forkcold-exp.js` (rows 8–9 —
the fork-point court is a warm reader's court). The findings above are left as written.
