# weekend-gate — write the whole thing from the TL;DR and see what it needs

**Candidate gate** (`../HANDOFF-to-spec.md` §2.H, and it answers §2.G on the way). Substrate: none.
`weekend-reader.js` and `weekend-publisher.js` import **nothing** from `lastline.js` or from each
other — that is the measurement. They were written from `TLDR-new.md` and the rulings, with the
standard library only, and the rule was: if either needs a thing the TL;DR does not say, that is a
finding about the TL;DR, not about the code.

**Question.** GOALS priority 2 says a second implementer finishes a publisher or a reader in a
weekend from the text alone. That has never been tested on this design. `git-gate`'s 137-line
verifier is the bar.

**Method.** Both files, then a hub on a real loopback socket (three paths, two verbs, one
conditional header), then thirteen moments driven end to end: three posts published; a withdrawal;
a rewrite that clears its lines; a rotation; a restore vouched by one listed member; the restored
key publishing. Then the hostile moves — withholding a listed post, serving an older head, swapping
a post for another she signed, substituting a whole other identity, a second profile at one version,
a post signed by a key that was hers and never listed. Then a second identity on the same hub whose
replies name a post that exists, one she withdrew, and one that never did.

**Numbers** (stale if either file changes; the two files were changed by the final review, see the
note at the end):
- **The reader is 141 lines, the publisher 47** — non-blank, non-comment, standard library only.
  Against `git-gate`'s 137-line verifier, and that one had no key changes, no recovery and no
  rewrite rule. About a quarter of the reader is the strict JSON scan, which exists because
  `JSON.parse` cannot see a duplicate member.
- **Exactly three reader verdicts across all thirteen moments** (§2.G's target, measured, not
  counted from the rulings): `ok`, `host`, `identity`. `recently restored`, `withdrawn: 2`,
  `pending: n` and `no head newer than the one this reader holds` are **notes on an ok read**, not
  states — which is what keeps the count at three.
- Griefing is bounded: 1,000 replies to posts that exist cost **0** fetches, and 1,000 naming
  numbers that never existed cost **5** — one look at that identity — and produce **one** line.

**Three things the TL;DR did not say, found by writing it.**

1. **The head must be signed by the key that is current now**, so a rotation or a restore means
   writing the head *again*. This is not bookkeeping: it is the mechanism. A thief holding a
   rotated-out key can still sign a head, and the head is what admits posts — so if a reader
   accepted a head from any key in the chain, the thief would decide what counts as hers, and a
   restore would take nothing back from him. Written the other way round: **re-signing the head is
   what a restore actually restores.**

2. **A head that will not verify is not an accusation.** Between the two writes a rotation takes,
   an honest host is serving a head signed by a key the profile no longer ends on. The first version
   of this reader called that `host` — it accused an honest host of misbehaving during an honest
   rotation, in both write orders. The rule that works: a reader holding a head it verified itself
   keeps that one and says nothing; only a reader with none has anything to report. Costs no state,
   and it is the same fallback as a host that stops updating, which the design already tolerates.

3. **The rumor rule needs two bounds, and the naive version is an amplifier.** A reply naming a
   number above the top makes the reader look again — so a griefer writing 1,000 replies naming
   numbers that do not exist makes the reader fetch somebody else's host 1,000 times and print
   1,000 messages. Look again **at most once per identity per pass**, and say **one line per
   person**, however many replies they wrote. The rumor names who, not how often.

**Kill criterion.** A hostile move the reader does not catch; a reader state beyond the three the
design allows; a rumor raised over a post the author withdrew; either file over 200 lines.
**Not triggered.**

**Revert-checked** (`revert.js`, 6 rows): dropping the check that the profile's genesis is the key
this reader learned (the substituted-identity row goes red); accepting a head signed by any key in
the chain rather than the current one (the mid-rotation row goes red — and this is finding 1 in
reverse); dropping the post's address and declared-number check (the swapped-post row goes red);
raising a rumor unconditionally (the withdrawn-reply row goes red); looking again per reply rather
than per identity, and printing a line per reply (the griefing row goes red both ways).

**Verdict.** The weekend holds: 141 lines for a reader that follows key changes, folds a head,
checks admission, and catches every hostile move staged here, plus 47 for a publisher that races
correctly against another device. Priority 2 survives contact with priority 1 — there is no
canonicalizer, no JOSE, no dependency. The three findings above are sentences the spec owes, and
all three were invisible until the code existed.

**Run:** `node tmp/redesign/gates/weekend-gate.js`

**Changed by the final review (2026-08-21).** The two files are no longer the ones measured above:
`gapless-gate` fixed the publisher's rewrite (it was confirming every pending post) and put the
pending flag in the pin; `court-gate` put the fork-point court into the reader (+18 lines) and made
a restore hop carry the list it satisfied; `media-gate` added the photo entry (+2). **The reader is
now 161 lines and the publisher 51.** The thirteen moments above still read the same, and the
"second profile at the same version" row is now settled by the court rather than by `pseq` equality
— which is the finding: as measured here, the reader contested two profiles at one version and
followed a thief who picked a higher one.
