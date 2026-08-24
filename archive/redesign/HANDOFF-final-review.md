# Handoff — the last review before the spec is written

**Written 2026-08-21 by the agent that took `HANDOFF-to-spec.md`, built its §2.A–C, and then took
§2.G–H as well, at the owner's instruction, for one more fresh agent. Your job, in order:
(1) doubt what the previous three sessions ruled, with code; (2) build the experiments listed in §2,
which are the ones the spec cannot be written honestly without; (3) bring each open question to the
owner in plain words with the number in hand. You are the last pass before `SKETCH.md` becomes
spec text. Do not write spec text.**

**Distrust this file.** Four handoffs before it each opened by admitting their author was wrong, and
§6 records where I was. Every number here is copied from a run on 2026-08-21 and is stale the moment
a constant moves. Re-run before you quote.

**The single most useful thing you can do is find a green claim that never ran its own path.** I
shipped one this session and only caught it by reading the log — see §6.

## 0. Read these, in this order

1. `tmp/redesign/SKETCH.md` — **the design as it now stands**, written from the TL;DR down. Every
   schema in it is running code, not prose. This is what the spec will be written from, and it is
   the thing you are here to attack.
2. `tmp/redesign/TLDR-new.md` — the whole protocol in a page. Passes `tmp/measure/tldr-check.js` at
   200 / 99 / 8, which is *exactly* at budget on the first section: if you add a sentence, something
   else comes out.
3. `tmp/redesign/GOALS.md` — the floor (four items) and the priorities. Fixed. Lines 44–47 say what
   is deliberately *not* a priority. Two lines are stale pending the fold-in: 65–70 ("enough peers a
   reader already trusts", rejected by ruling 6) and 80 (item-carried pins — rejected again by
   §11.1, and it stands as written).
4. `tmp/redesign/RULINGS.md` — §1–10 from the outside review, **§11 from the review walk**, **§12
   from this session**. §12 is where every rule the sketch rests on was taken, and every item in it
   names the gate that forces it.
5. `tmp/redesign/rejections.md` — the reversal ledger. §11–14 are answered; §14 is this session's
   part-reversal of ruling 3. **Anything you reverse gets an entry there before you build on it.**
6. `tmp/redesign/gates/README.md` — every gate, one line, **labelled by substrate**. Do not cite an
   old-substrate gate for a new-substrate claim.
7. `tmp/redesign/decisions/README.md` — every experiment, one line. Illustrations, not gates.
8. `CLAUDE.md` at the repo root — spec-editing rules (no line budget, keep the justification beside
   a MUST, `tmp/regen.js` after any byte-level change, no changelog, no version bump).

**Run first**, and expect all green:

```
npm test                                                                     # 267
npm run prototypes                                                           # 11
for f in tmp/redesign/gates/*-gate.js; do node "$f" || echo RED $f; done     # 18
for f in tmp/redesign/decisions/*-exp.js; do node "$f" >/dev/null || echo RED $f; done   # 30
node tmp/redesign/gates/revert.js                                            # 35/35, ≈90 s
node tmp/measure/tldr-check.js tmp/redesign/TLDR-new.md                      # 200/99/8
```

Everything in `tmp/redesign/` is committed as of this handoff, so a revert has somewhere to go.
`src/`, `open-feed-spec.md`, `README.md` and `GOALS.md` are untouched and stay that way.

## 1. What changed since `HANDOFF-to-spec.md` — the delta you are reviewing

Four gates and two experiments, and eight rulings in `RULINGS.md` §12. In one paragraph each:

**The head is append-only** (§12.1). A withdrawal is an appended `[n, null]`; the four candidate
shapes collapsed into one dial — *how often the author rewrites the file* — and the reader turned
out to be indifferent to where the dial sits, so it is a publisher setting with a suggested default
of once a month. `gates/aohead-gate` (14 claims) is the structure; `decisions/tracelife-exp.js` is
the price, in days of visible trace against bytes. The finding that reframed it: **the leftover
lines are ~6% of the file**, so rewriting is a privacy decision and never a size one, and it buys
nothing against the custodian of §13.2, who kept every version he served.

**The head carries all 32 bytes** (§12.2). The 16-byte prefix saves 38%, not the half §11.2 rounds
it to, and is safe against both attackers the handoff named. It was rejected on **minimality**: it
needs two widths kept in step forever, because the *author's* own equivocation drops from 2^128 to
2^64 and is closed only by a reply's target carrying all 32. `decisions/hashwidth-exp.js`.

**The head declares `top`** (§12.3) — the highest number ever issued, never decreasing. A finding,
not a choice, and **it is a hole the flat list has had from its first withdrawal onward**: delete
your newest post and the highest number listed drops, so a reply to it reads as above the top and
the reader raises a rumor naming the replier over a post you deliberately deleted.

**`prev` is only checkable by a reader that saw the version immediately before** (§12.4). Across a
gap, `hseq` and the rewrite check are the whole defence, and the spec must not imply the chain is
walked.

**A number held by a file that is not the owner's may be reclaimed by the owner** (§12.5), where
"the owner's" means signed by a key in her chain *and* declaring that number. This part-reverses
ruling 3's "the host MAY check stamps ... disk hygiene, not a floor question": create-once plus an
unchecked write is a **permanent** block on a number, for five requests and her address.
`gates/pubif-gate` (16 claims, real sockets).

**Three sentences found by writing the whole thing** (§12.7): the head must be signed by the key the
profile *currently* ends on, so re-signing the head is what a restore actually restores; an
unverifiable head is not an accusation; the rumor rule needs two bounds or it is a griefing
amplifier. **All three were invisible until the code existed.** `gates/weekend-gate`, with
`weekend-reader.js` (141 lines) and `weekend-publisher.js` (47), standard library only.

**The reader has exactly three states** (§12.8), measured across thirteen moments, because
`recently restored` / `withdrawn: n` / `pending: n` / `no head newer than the one I hold` are
**notes on an ok read, not states**. §2.G is answered. §2.F is answered in `SKETCH.md` §7: four
places a clock appears, none gating a verdict.

## 2. Build these — ranked by how much spec text is wrong without them

**A. The envelope. Commissioned three times, never once run.** This is the largest unbuilt thing in
the project and the only floor item (GOALS 2) with no gate on this substrate. Scope it and stop:
today's `src/enc.js` construction against an HPKE/NIP-44-shaped one — X25519 + ChaCha20-Poly1305 +
HKDF, padded — **keeping the blinded per-recipient slot tags and the sealed audience** (ruling 9;
`decisions/audience-exp.js` shows what dropping the audience costs), **with test vectors**, and with
the padding **floor** so a DM is the size of a family post (`decisions/dm-metadata-exp.js`), not just
power-of-two slot padding. Two outside models independently said the library is not the question,
only the construction shape. **The half that has never been checked at all: run an encrypted post
through the *unchanged* `weekend-reader.js`.** "No new signing construction" is falsifiable and
nobody has falsified it on this substrate — `test/enc.test.js` does it for the old one.

**B. Two hubs, one thread** (GOALS scenario 3, **floor item 4**). Over real sockets, two origins: a
family-only post on one, a sealed reply from the other, a reaction, and the unchanged reader reading
both with no access control anywhere. `gates/pubif-gate.js` and `gates/weekend-gate.js` both stand
up hubs you can copy. A floor item with no gate on this substrate is the most embarrassing thing
that could be in a spec, and this is the last one.

**C. Gapless numbering under failure — the hole I did not test.** Numbering is load-bearing three
times over: create-once (ruling 3), "above the top" (§11.1), and the reclaim rule (§12.5). Nothing
has stressed it. Stage at least: (i) the app crashes after `PUT /posts/8` lands and before the head
write — 8 is taken, unlisted, `top` is 7; what does the next publish do, and does the gap read to a
reader as a withdrawal of a post that never existed? (ii) the same with two devices racing; (iii)
the same with a griefer holding numbers the owner then reclaims — does `top` still tell the truth?
(iv) an abandoned draft, which ruling 3 explicitly warns "false-accuses the host." I believe the
answers are benign and I have no evidence.

**D. The contest rule inside a composed reader.** §11.3 settles a contest by a majority of the
recovery list *as it stood at the split*. `decisions/forkcold-exp.js` shows the rule working in
isolation; `weekend-reader.js` says `contested` and stops. Nobody has run the settling rule inside a
reader that also folds a head and fetches posts. Two things to find out: does it fit (the reader is
141 lines and `git-gate`'s bar was 137), and what does a reader need to have kept in order to run
it — because §11.3 says only a reader that pinned the pre-fork profile can.

**E. Media, end to end.** §11.6 puts photos in the head "so retention is one rule and reaches sealed
posts." A blob is the fourth file kind and the only unsigned one. It has never been fetched,
listed, withheld or swapped in any gate. What admits it, what a reader does when a listed blob is
withheld, and whether swapping one is caught by the head's entry — all unwritten.

**F. Attack the fallback I introduced.** §12.7 says an unverifiable head is not an accusation: the
reader keeps the head it verified and says nothing. **A hostile host can therefore serve an
unverifiable head forever and freeze a reader in silence.** I claimed that is no worse than ordinary
withholding, which `splitview-gate` already accepts as undetectable to a reader with no social path.
That claim is unmeasured. Stage it against `splitview-gate`'s strategy enumeration and either
confirm it or find that I opened something.

**G. Interop — the generated views** (GOALS priority 3, scenario 7). JSON Feed / Atom and an h-card
from the head and the posts; a plain feed reader consumes it; **nothing in it is signed**, and the
feed view is never the head (ruling 4, unanimous across all six outside models). One experiment.

**H. The spoken code** (`decisions/spokencode-exp.js`: ~14.6 bits, brute-forced in about a second).
5–6 words from a 2,048-word list is 55–66 bits; a slow hash is the other lever. A UX ruling with the
keygen-rate row already measured — take it to the owner, do not redesign it.

**I. Re-derive the head numbers against real bytes.** `decisions/headage-exp.js` and
`tracelife-exp.js` are arithmetic over an assumed serialization, not measurements of real files.
Serialize actual heads at a few points on each curve and check the arithmetic. If it is off by much,
the monthly-versus-never trade the owner ruled on moves, and he should be told.

**J. The intent map** (owed since `CANDIDATES.md`, and still owed). The 267 test intents in `test/`
mapped kept / transformed (mechanism named) / dropped (owner sign-off flagged). Most of §5/§6/§9/
§10/§14 drop *with their mechanism*; say so **per file, not per test**.

**Smaller, unruled:** the conformance taxonomy (the design suggests *roles* — publisher, reader, hub
— not levels); §2.1's token-vocabulary meta-rule, which likely dissolves with no JSON Feed namespace
to defend.

## 3. What to doubt in the delta, specifically

Not a list of suspicions — a list of places where a green gate is thinner than it looks.

- **The reclaim rule (§12.5) is four hours old.** Attack it. It is the only rule in the design that
  lets a stored file be replaced, which makes it the only place an overwrite can hide.
- **32 bytes over 16 (§12.2) was taken partly on taste.** The reasoning was "one width, stated once,
  is worth more than 38% of a file." If you can state the two-width pair in one clause that an
  implementer cannot get wrong, that is a reversal worth putting to the owner — with a
  `rejections.md` entry first.
- **`aohead-gate`'s rewrite check runs against what the reader holds.** A cold reader cannot run it
  at all. The card says so; nothing measures what that costs at the scale where readers are mostly
  cold.
- **`weekend-reader.js` is the design's own argument for itself.** I wrote both it and the rules it
  checks. A second pair of eyes on 141 lines is worth more than another gate.
- **`pending` (§11.5) has a fold rule but no lifecycle test.** What happens to a pending entry
  across a rewrite? Nothing checks.

## 4. Procedure — the campaign's standing rules, unchanged

- **Question everything, including this file.** Reversals answer the recorded reasoning in
  `rejections.md`. The floor and §13.2's hostile custodian are fixed; everything else reopens.
- **Doubt with code.** An objection with a runnable experiment beats ten of prose. Every assertion
  revert-checked — turn the defence off, watch the attack land, print it. A revert row that is *not*
  caught is information, not a chore: it means the rule you thought was load-bearing is somewhere
  else. That is how the rumor bound in §12.7 was found.
- **Re-derive before acting on a number.** `decisions/` are illustrations; `gates/` carry kill
  criteria; old-substrate gates prove conventions, not the new head.
- **Plain language with the owner.** Every open question in plain words, one at a time, full
  context, no jargon, no stacked acronyms. A recommendation marked as such, then the question.
  Never "should I proceed?"
- **Do not touch** `src/`, `open-feed-spec.md`, `README.md` or `GOALS.md`. `npm test` and
  `npm run prototypes` stay green throughout — red there means you edited something the old spec
  still owns.
- **No files in the harness scratchpad; no reads outside the repo.** `tmp/` for everything.

## 5. Where things are

| path | what |
|---|---|
| `tmp/redesign/SKETCH.md` | **the design, from the TL;DR down** — the thing you are reviewing |
| `tmp/redesign/TLDR-new.md` | the page. At budget: 200 / 99 / 8 |
| `tmp/redesign/RULINGS.md` §11–12 | every rule the sketch rests on, each naming its gate |
| `tmp/redesign/rejections.md` §11–14 | the reversal ledger; §14 is this session's |
| `tmp/redesign/gates/aohead-gate.{js,md}` | the append-only head, 14 claims |
| `tmp/redesign/gates/pubif-gate.{js,md}` | the publish interface over real sockets, 16 claims |
| `tmp/redesign/gates/weekend-gate.{js,md}` | the minimality measure and the three states |
| `tmp/redesign/gates/weekend-reader.js` · `weekend-publisher.js` | 141 and 47 lines, standard library only, **importing nothing from each other or from `lastline.js`** — that independence is the measurement |
| `tmp/redesign/gates/lastline.js` | the reference for the substrate every *other* new gate imports |
| `tmp/redesign/gates/revert.js` | 35 mutations, 35 caught |
| `tmp/redesign/decisions/tracelife-exp.js` · `hashwidth-exp.js` | the numbers behind §12.1 and §12.2 |
| `tmp/redesign/HANDOFF-to-spec.md` | the handoff I took; its §2.D–J are §2.A–J here, minus what got built |
| `tmp/redesign/outside/SYNTHESIS.md` | the six outside models' briefs that rulings 1–10 answer |
| `tmp/redesign/SKETCH-rejected-2026-08-19.md` | what "basically the same thing with tiny tweaks" looks like; do not produce another |

## 6. What I got wrong this session — so you do not inherit it

- **I shipped a green claim that never ran its own path.** `pubif-gate`'s two-device head race
  passed on the first run — and the log showed both devices getting `head 200`, because the event
  loop had serialised them. The retry path the claim is *about* had never executed. I only caught it
  by reading the printed log, not the verdict. It now forces the collision with a barrier and
  asserts that exactly one writer took a 412. **Assume there is another one of these and go find
  it.**
- **My first revert row for the rumor rule was not caught, and I nearly "fixed" the row.** The row
  was right and my model was wrong: the line I thought was the rule was an optimisation, and the
  real rule was two lines down. Chasing that properly is what surfaced the griefing amplifier.
- **I asserted `weekend-reader.js` was correct before running it against a rotation.** It called an
  honest host a liar during an honest key rotation, in both write orders. Two of §12.7's three
  sentences come from that single failure.
- **I let a stale number stand in two places** — "16-byte hashes halve every column" is 38%, and
  `headage-exp.js`'s own reading said "halve" too. Both corrected. Assume there are more.
- **`tracelife-exp.js`'s "when retractions > 10% of live" row fires once in a decade** and is
  therefore indistinguishable from "never". It is in the table because the previous session's
  recommendation named it; do not read it as a real fifth option.
