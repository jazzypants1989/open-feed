# The weekend reader

**Spec:** §7 entire, and everything §7 reaches — §2 files, §3 identity, §4 the index, §5 targets.
**Run:** `node examples/weekend-reader/weekend-reader.js`

This is a capstone, not an illustration. It is **a whole conforming reader in one file**, written
from the protocol's text alone with nothing but Node's standard library, and it is the second
implementation that `tools/regen.js` verifies every vector in Appendix B with. Two independent
readers agreeing on every byte is the closest thing to interop this spec has had.

It exists to answer a question `GOALS.md` puts second in its priority list: **a second implementer
finishes a publisher or a reader in a weekend from the text alone.** That is not a claim you can
argue your way to. It was tested by writing the thing, under one rule: if the reader needs something
the text does not say, that is a finding about the text, not about the code.

## What the output shows

**The measurement, first.** The script reads its own source and reports the non-blank, non-comment
lines above the marker that separates the reader from the demo below it. It is around 170 lines,
about a sixth of which is the strict JSON scan of §2.4 — which exists only because `JSON.parse`
cannot see a duplicate member (see `examples/files/`). Everything else — the file format, the
chain walk, the recovery lists, the contest rules, replay, admission, the rumor rule — is the rest.

**An honest read**, so the shape of a result is visible: a verdict, the posts, the notes.

**The hostile moves, and the verdict each one earns.** Fifteen moves — a listed post withheld, post
1 served at the path for post 3, a post signed by a key that was never hers, an older index, a listed
media file withheld and then altered, a number below the highest that was never there, a number re-listed
at another hash inside one index, a whole other identity at the address, a branch vouched only by the
list its own link brought, a profile that forgets her restore, an index signed by a rotated-out key,
a genuine post listed at a number its body does not declare, and an index with `entries` not first —
and **each one names the verdict it must earn**, which matters: counting three distinct
verdicts at the end is not enough by itself, because a check that stopped working would move one row
to another verdict and leave the count at three. The count is asserted too, and it is §7.2's rule
confirmed by measurement rather than by design document: `ok`, `tampered`, `contested`, and no fourth.
`examples/reading/` takes §7 apart step by step; this file is the whole of it running at once.

**The rumor rule, at a thousand replies.** Mum replies twice from her own hub at numbers at or below
alice's `highest` and the reader says nothing and spends no extra fetch. A griefer writes a thousand
replies naming numbers that never existed, and it costs **one look at alice — five fetches — and one
line**, because §7.4's two bounds are look again at most once per identity per pass, and say one line
per person. This is the finding that writing this file produced; `examples/reading/` is the
example that takes it apart.

**An index it cannot verify is not an accusation.** The last block stages the honest case: alice
rotates, and between her two writes (§4.4) the hub is serving an index signed by the key her
profile no longer ends on. A checkpointed reader keeps the index it verified itself and notes *"no index I
can verify"*; a cold reader, holding none, reports `tampered`. Nobody is accused of anything, and the
reader cannot tell that case from a 404 or a garbled file — which is the trade §7.1 step 7 makes on purpose.

Two SHOULDs it does not implement, so that the measurement stays honest about what a weekend buys:
the cold-reader retry, and §3.5's fallback to another remembered location. Both are app-level
loops around `read`, and `src/reader.js` leaves them to the app as well (`FINDINGS.md` §2).

## What writing it found

Three sentences the text did not say, all of them invisible until the code existed. All three are in
the spec now, which is what this file was for.

1. **The index must be signed by the key that is current now**, so a rotation or a restore means
   writing the index *again* (§4.4, §3.5). Not bookkeeping — the mechanism. A thief holding a
   rotated-out key can still sign an index, and the index is what admits posts; if a reader accepted
   an index from any key in the chain, the thief would go on deciding what counts as hers and a
   restore would take nothing back. **Re-signing the index is what a restore actually restores.**
2. **An index that will not verify is not an accusation** (§7.1 step 7). The first version of this reader
   called the mid-rotation window `tampered` — accusing an honest hub of misbehaving during an honest
   rotation, in both write orders. The rule that works costs no state and is the same fallback as a
   hub that stops updating, which the design already tolerates.
3. **The rumor rule needs two bounds, and the naive version is an amplifier** (§7.4). A reply naming
   a number above the highest makes the reader look again — so a griefer writing a thousand replies
   naming numbers that never existed makes the reader fetch somebody else's hub a thousand times.
   Look again at most once per identity per pass; say one line per person. `examples/reading/`
   stages the measurement.

## Contrast

The interesting comparison is not with another protocol but with the same protocol's other reader.
`src/reader.js` is the reference implementation: one module per spec chapter, an injected fetcher,
a checkpoint with named fields. This file is one flat page written by somebody who had only the text. They
agree on all 49 vectors, and the disagreements they had along the way became the three findings
above.

The line count is the argument. `GOALS.md`'s first priority is no dependencies — Ed25519, SHA-256,
HTTP, JSON, base64url, and nothing else — and its second is that a person can implement this in a
weekend. Those two pull against each other: every dependency you refuse is code somebody has to
write. A reader in this many lines, with no canonicalizer, no JOSE library, and no third-party
anything, is what the tension resolves to.

The kill criterion set before writing it was: a hostile move the reader does not catch, a reader
state beyond the three the design allows, a rumor raised over a post the author withdrew, or either
file over 200 lines. None of them triggered.

The demo below the marker in the source file is not part of the reader; the measurement stops at the
marker, and the publisher it imports is imported there and nowhere else.
