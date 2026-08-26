# Review: examples/contest/ (§3.6)

Read-only review, 2026-08-25. `node tools/examples.js contest` is green (ok, 0.1s, output matches).
Evidence probes: `tmp/review/contest-probe.mjs` (run with `node tmp/review/contest-probe.mjs`).

Paths are absolute under /Users/jessepence/repos/open-feed/; `contest.js` = examples/contest/contest.js,
`contest.md` = examples/contest/contest.md, `spec` = open-feed-spec.md.

## Findings by severity

### HIGH

**H1. The centrepiece claim is false for the example's own key material, and the example never says so.**
contest.md:70-72 ("One listed adversary, acting alone, takes her identity under `k` and cannot take it
under a majority") and contest.out.txt:53-54 / contest.js:99-100 ("Under a majority he cannot, alone,
ever") are true only *at a split*. The example's list is `k = 1` of 3 with the ex on it
(contest.js:14). With that list he does not need to fork at A2: he extends the pinned chain with a
self-vouched restore `A3 -> EX`, §3.3's validity rule (spec:193-194, "at least `recovery.k`") is met by
his one voucher against the *held* family list, no split exists, §3.6 rule 4 never runs, and the reader
follows him. Verified against `src/`: probe 1 in `tmp/review/contest-probe.mjs` returns `ok, now
following EX` for exactly block 5's pin (`rotPin`, contest.js:64). This is FINDINGS.md:29-37 (1.1(b)),
whose own last sentence is "It also makes §3.6's strongest sentence ... true only *at a split*."
FINDINGS.md:47-49 names `examples/contest/` as needing restaging; contest.md does not cite FINDINGS or
the caveat anywhere. As shipped, the example teaches a reader that the majority rule closes the
listed-abuser case; under the current spec it does not, and the example's own `k = 1` is the open door.
Suggested minimum without changing the spec: one sentence in contest.md's "Majority, and not `k`" block
and one at the top of the block in the script pointing at FINDINGS §1.1(b), and stop saying "ever".

### MEDIUM

**M1. The one arm of rule 4 that works *for* the reader is never staged.** Rule 4 has three outcomes
(spec:625-628: follow the branch the list chose / `host` for the rejected branch / `contested`). Every
split in the example serves the ex's branch, so only `host` and `contested` are produced: block 1
(contest.js:38), block 2 (:55), block 3 (:65), the five-row table (:81-86, whose assertion at :85 can
only ever produce `TIE` or `HOST`), block 6 (:105-106). The "served branch wins" path —
`src/profile.js:96-98`, pruning lists above the split, re-adopting, re-walking — never executes. That
is the thief-first ordering: reader pinned at version 2 (ends on A2, which he holds), he rotates
`A2 -> EX` first and the reader follows (no split), then Alice's `mum + sis` restore arrives and her
2-of-3 majority pulls the reader back. Probe 2 in `tmp/review/contest-probe.mjs`: `2a ok following EX`,
`2b ok switched to A3`. `test/profile.test.js:72-74` covers it; the teaching example does not, and it is
the case that makes the rule worth having. No `tools/revert.js` row exercises lines 96-98 either
(rows at tools/revert.js:317-335 cover findIndex, the prefix clause, list overwrite, the carried copy,
majority-vs-k, and the tie).

**M2. The example gives the attacker less than the threat model does (Q4).** CLAUDE.md's operator
"controls the serving path" and "will not cooperate"; spec:912-913. In the example he is made to wait
and to choose his weakest move:
- Block 2 (contest.js:54-55): the reader is pinned at version 2, whose chain *ends on A2* — the key he
  holds is her live key at that moment. A non-cooperating operator who holds the live key rotates it
  to his own at once (probe 2a: the reader follows, no contest). The example instead has him
  "republish with a list of one" and then stand aside while `alice restores to A3: ok` (contest.js:55,
  `r2a`) reaches the reader through a serving path he controls. contest.md:36-44 narrates this as the
  rule beating him; it is the ordering beating him.
- Block 5 (H1): he forks at a rotated-away key when, listed under `k = 1`, extending wins outright.
- Nothing in the example has him withhold. Every "Alice's real profile then reads ..." line assumes the
  reader obtained her bytes; on his hub it would not. §13.3's "staleness is indistinguishable from
  silence" (spec:942-945) is the honest framing and contest.md never mentions it. Block 7's cold reader
  (contest.js:119-124) is the one place the example gives him first move, and there he wins — which is
  the right shape; it should not be the only place.
The "supplies the client" clause cannot be staged and is not a defect.

**M3. Length (Q6).** contest.js is 134 lines against "about 120" (examples/README.md:14-16), and the
lines are packed: 13,436 chars, max line 241 chars, 34 lines over 120 chars (contest.js:27, :103,
:106, :119-120 are several statements comma-joined into one). By bytes it is within 7% of `the-reader`
(14,381 chars, 185 lines), which the contract exempts for being a whole chapter; `contest` is one
rule. The contract's escape valve is "it is two examples" (README:16), and the seams are visible: rule
1-4 (blocks 1-4) and "majority-vs-k, the price, the limits" (blocks 5-7). Also README:12 says
"comments of one line"; contest.js:1-3 is a three-line header comment.

### LOW

**L1. "the link carries it" misdescribes which member delivered the wider list.** contest.js:127 /
contest.out.txt:79 ("she rotates, and the link carries it — now k=1 of 4 at length 3"). The pinned
reader's list at length 3 comes from the *profile's* `recovery` member (`src/profile.js:53`,
`recoveryLists[p.chain.length] = p.recovery`), not from the link's `recovery`, which by §3.3 (spec:184)
is the list that stood *before* the link and here is ignored at length 2 because the reader already
holds `family` there (asserted at contest.js:131). The link's copy would reach a *cold* reader at
length 2; it reaches this pinned reader nowhere. Spec:281 uses the same loose phrase ("through a
link"), so this is a shared imprecision, but the example is where it should be exact.

**L2. The exit is asserted with `.some()` on two arrays, not with a reader.** contest.js:129-132 prove
only `alice.chain` contains `A3.x` and `served.chain` does not. §3.1 (spec:141-143) says a reader given
that key "MUST follow the branch whose chain contains it and pin there". `src/reader.js` and
`src/cli.js` contain no such path (grep for `contest`/`currently ends`/`handed` returns nothing), so
the example cannot exercise it; but contest.md:94-96 ("the reader follows the branch whose chain
contains that key") reads as if it did. Not in FINDINGS §2/§3; FINDINGS.md:195 mentions §3.1 only for
a citation fix.

**L3. "nobody following her sees anything new" overstates the price.** contest.md:77-78. A reader that
pinned her restore (`p6`) and keeps reading *her* files is fine (contest.js:106, `p6b` reads `ok`);
only a reader served the ex's branch is stuck, and only while it is served that branch. The stuck
state is "follows no branch" (spec:264), which is per-read, not "nobody ... anything new".

**L4. "0 of 1" and "1 >= 1 / 0 < 1" are string literals.** contest.js:72 prints `her link 0 of 1` and
:96 prints `his 1 >= 1 and her 0 < 1`; :101 feeds literal `0, 1` into `byK`/`byMajority`. The counts
are asserted elsewhere for the same links (contest.js:75, `counts` = `[0,1,1]`), so the numbers are
true, but "Every line above is asserted" (contest.js:134) is stricter than the script.

**L5. Block 2's `fields` pin quietly carries his list.** After `rw` (contest.js:54), `pinOf(rw).fields[0]`
is `his` (the profile's `recovery` at that read), while `recoveryLists[2]` stays `family`. Alice's
restore at `r2a` passes the §3.3 "changes nothing else" check only because `src/profile.js:101`
compares against `recoveryLists[pin.chain.length]` (the held list), not `pin.fields[0]`. That is a
defensible reading of "what the pin holds" (spec:206-208), but it is a reading, and the example leans
on it silently. Worth one sentence, or a test row, since a second reader could compare against the
last-seen profile's `recovery` and return `identity` here.

## Q1. Narration vs code vs spec — line by line

Checked every sentence of contest.md against contest.js and spec §3.3-3.6, §7.1, §7.3, §13. Correct
unless listed: the rule-1 block (md:23-34; js:36-51; spec:248-251, 284-285), rule 2 (md:36-44;
js:54-62; spec:252-256), rule 3 (md:46-52; js:64-75; spec:257-260), rule 4 table (md:54-59; js:77-88;
spec:261-265), price/repair (md:74-84; js:103-117; spec:196-198, 270-273), cold reader (md:86-89;
js:119-124; spec:277-280, 951-952), sections (md:3-4 cites §7.3; the `host` label for a rejected
branch is mandated at spec:626, §7.1 step 6, which md does not cite but is consistent with).

Mismatches:
1. md:70-72 and js:99-100 — "cannot ... ever" (H1).
2. md:77-78 — "nobody following her sees anything new" (L3).
3. js:127 / out:79 — "the link carries it" (L1).
4. md:94-96 — "the reader follows the branch whose chain contains that key" beside an assertion that
   is an array membership check (L2).
5. md:7-9 says the walk is free for "somebody holding none of them, with a link vouched by a recovery
   list of their own making"; the script only stages the thief who holds A2 (js:32, :43). md:10-11
   correctly scopes the printed `true` to "the thief's chain", so this is a mild promise the script
   does not keep, not an error.
6. md:17-19 "`tools/revert.js` holds the edit ... that turns each one off": true for the four rules
   (tools/revert.js:317-335); not for rule 4's follow arm (M1), and not for the two "plain rules"
   (md:33-34) — those rows, if they exist, are under `the-chain`, not `contest`.

## Q2. Re-derivation of every asserted outcome from the spec text

Held lists at the pins: every pin adopts `family` at lengths 1, 2, 3 from `L1.recovery`, the second
link's `recovery`, and the profile's `recovery` (spec:252-256, 619-621). "Majority" = more than half of
3 = 2 (spec:261-262).

| where | pinned link at split | served link at split | hers / his (of 3) | spec outcome | src | match |
|---|---|---|---|---|---|---|
| js:38 `r1` | restA3 (mum, sis) | exRot (sig by A2) | 2 / 0 | hers wins; served branch rejected -> host (spec:626) | HOST | yes |
| js:38 `r1b` | restA3 | none (prefix, v9 > v3) | 2 / 0 | split at end of prefix (spec:249-251); host | HOST | yes |
| js:38 `older` | no split | v2 < v3 | - | identity (spec:284) | older | yes |
| js:39 `twin` | no split | v3, different body | - | contested (spec:285) | contested at one version | yes |
| js:54 `rw` | no split, same length | list replaced by A2 | - | ok; list not overwritten (spec:252-254) | ok, lists unchanged | yes |
| js:55 `r2a` | chain grows by restore | - | 2 of 3 valid | ok if nothing else changed (spec:205-208) | ok | yes (see L5) |
| js:55 `r2` | restA3 | exRest (ex alone) | 2 / 1 | hers wins; host | HOST | yes |
| js:65 `r3` | rotA3 (sig) | exRest | 0 / 1 | neither majority; contested (spec:263-264) | TIE | yes |
| js:81 row 1 | restA3 | exRot | 2 / 0 | host | HOST | yes |
| row 2 | rotA3 | exRot | 0 / 0 | contested ("sig is not a vote", spec:262-263) | TIE | yes |
| row 3 | rotA3 | exRest | 0 / 1 | contested | TIE | yes |
| row 4 | restA3 | exRest | 2 / 1 | host | HOST | yes |
| row 5 | restA3 | coerced (mum, ex) | 2 / 2 | both majority; contested | TIE | yes |
| js:105 `c6` | hers (mum alone, list of 2) | hisRot | 1 / 0 of 2 | 1 is not > 1; contested (spec:270) | TIE | yes |
| js:106 `p6b` | chain unchanged, vouchers added | - | 2 of 2 | ok (spec:196-198) | ok, keys unchanged | yes |
| js:106 `c6b` | mended | hisRot | 2 / 0 | host | HOST | yes |
| js:119 `coldRead` | no pin | exRest against carried `his` | 1 of 1 | ok (spec:277-278) | ok, adopts `his` at 2 | yes |
| js:119 `c7` | pinned on his | restA3 against held `his` | 0 of 1 | step 4 fails before step 6 (spec:622-628) -> identity, chain does not hold | same | yes |
| js:120 `edited`/`onward` | same length / new length | - | - | held list kept; new one only at new length (spec:281-282) | family / wider | yes |

Every asserted outcome agrees with the spec text. Places where the example rests on `src/` choices
the spec does not pin down:
- The verdict *strings* (`'serves a branch the recovery rejected'`, `'contested: two histories...'`,
  `'the chain of key changes does not hold'`, contest.js:22, :131) are `src/profile.js` wording; the
  spec fixes only the three verdicts (spec:654-660). Fine for an example, but the `.md` should not imply
  the phrases are normative.
- The `split()` helper (contest.js:27) re-implements `src/profile.js:90-91` rather than reading the
  split index from the reader; if the two drifted the example would print one index and judge by
  another. The prefix clause's `o.version > pin.profileVersion` guard matches spec:249-250 ("higher
  `version`").
- `adoptRecoveryLists(..., rotPin.chain.length)` at contest.js:67 proves that function honours its
  `from` argument; the reader-level proof is `r3` itself (had the carried copy been adopted, `theirs`
  would be a majority and the reader would switch — that is revert row tools/revert.js:327-329).
- L5 above: which copy "what the pin holds" refers to in spec:206-208.

## Q3. If §3.3 were amended to ">= k AND more than half of `leaves`"

The one-bar rule (FINDINGS.md:39-45) makes `exRest` (1 of 3) and `hers` (1 of 2) *invalid links*, so
`walk` (src/profile.js:62) fails before any split is considered (spec §7.1 step 4 precedes step 6).

Assertions that flip:
- contest.js:62 — `got(r2)` becomes `['identity', 'the chain of key changes does not hold']`, not HOST.
- contest.js:75 — `got(r3)` likewise; `counts` stay `[0,1,1]`; `adopted[2]` stays `family`.
- contest.js:85 — rows 3 and 4 (`exRest`) become `identity: chain does not hold`; rows 1, 2, 5 unchanged.
- contest.js:101 — `got(r3)` flips as above; `byK(0,1,1)` still says `'the ex'` and `byMajority` still
  says `'contested'`, but the contrast is now between the spec and a rule the spec no longer contains.
- contest.js:105 — `pinTo(prof(3, [anchor, L1p, hers], pair), A3)` throws: `hers` is 1 of 2, invalid,
  so the "price" block cannot even be pinned. The price becomes FINDINGS' "is not valid until a second
  member vouches", and the demonstration collapses into: mum alone publishes -> `identity`; sis adds
  her voucher to the same link -> `ok`. The repair (contest.js:106, `mended`) survives unchanged.
- contest.js:131-132 unchanged: `coldRead` (1 of 1 is a majority of `his`), `c7`, `edited`, `onward`
  all hold.
- Block 1 unchanged (restA3 is 2 of 3; exRot and `forgotten` are signed rotations).

Structural consequence: `byK` (contest.js:90) would then be a design that was considered and not
adopted, which examples/README.md:22-23 forbids in a script ("never in a script") — the threshold
contrast would have to move to contest.md's Contrast section. `k` itself becomes a floor above the
majority (an author can demand *more* than half), and the example would want a list where `k` exceeds
the majority to show `k` still means something (e.g. `k = 3` of 3: mum + sis is a majority and still
not valid). The revert row tools/revert.js:330-332 (majority -> k) would need a companion that drops
the "more than half" half of the validity rule. The weekend reader
(`examples/weekend-reader/weekend-reader.js`) must change in step or Appendix B diverges
(FINDINGS.md:47-49).

## Q5. Duplication between contest.md and recovery-list.md

Three paragraphs make the same argument; the last is nearly verbatim against the spec as well.

1. Majority, not `k`, on the listed abuser.
   - recovery-list.md:100-105: "The answer is §3.6's majority rule, which is a majority and not `k`
     for this reason alone: under a threshold, one listed adversary vouching for himself hands himself
     the identity; under a majority he cannot do it alone, ever. Read that rule there rather than
     reconstructing it here."
   - contest.md:70-72: "One listed adversary, acting alone, takes her identity under `k` and cannot
     take it under a majority. That is the whole difference between the two rules, and it is the case
     the protocol exists for."
   - spec:267-270 says it a third time. recovery-list.md:105 already defers ("read that rule there");
     the sentence before it re-argues anyway. Both carry the H1 overstatement ("ever").

2. `k` is not the contest test.
   - recovery-list.md:44-46: "`k` is not the test that settles a *contested* identity — that one is a
     majority (§3.6), and the two differ exactly where it matters, on the adversary who is himself on
     the list."
   - contest.md:61-63: "The recovery list is three people with `k` = 1 ... and the ex is one of the
     three. He vouches for himself."

3. The count is public because a majority needs a denominator.
   - recovery-list.md:33-38: "a contest between two profiles claiming one identity is settled by a
     **majority** of the recovery list at the split (§3.6), and a majority needs a denominator every
     reader can see. Hide the count and a forger with one voucher can call it a majority of a list only
     he can count."
   - contest.md:46-49: "Against the copy his link carries — one member, himself — he has a majority and
     she has none." Same argument from the other side (the forger *did* supply his own denominator).

4. Never overwritten / list of one.
   - recovery-list.md:53-61 ("a reader that already saw the list of one there keeps it, because a
     recovery list is never overwritten once a reader has seen it (§3.6 rule 2)").
   - contest.md:36-44 (rule 2) and :86-89 (cold reader adopts "his list of one").

5. Every reader settles locally against what it saw first.
   - recovery-list.md:82-84: "Open Feed has no ledger, so every reader settles it locally against what
     it saw first, which is why so much of §3.6 is about *which* copy of the list a reader is allowed
     to believe."
   - contest.md:86-89 and :107-108: "counted against a list the reader already had."

Suggested split: recovery-list.md keeps the disclosure/denominator argument (its §3.4 subject) and
cuts :44-46 and :100-105 to one pointer; contest.md owns majority-vs-`k`.

## Q6. Contract

- `**Spec:**` contest.md:3; `**Run:**` :5; `## What the output shows` :21; `## Contrast` :100; named
  scenario: "`GOALS.md` scenario 1, **the divorce**" :131 (and scenario 2 at :133). All present.
- contest.md:135-137 cites "Scenario 1's 2026-08-21 rewording" — matches GOALS.md:94-98.
- Length: over, and over by more than the line count says (M3).
- `node tools/examples.js contest`: ok.
- Output file matches; every `console.log` line maps to an assertion except the literals in L4.
