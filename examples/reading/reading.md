# Reading

§7 of the spec. One script; the prose below is the former the-reader and top-and-rumors examples.

---

## The reader

**Spec:** §7 entire, and §4.1 for the one verdict charged to the wrong party.
**Run:** `node examples/reading/reading.js`

A reader is given three things: **the anchor key it learned** (§3.7), **a location**, and optionally
**the checkpoint it kept from last time**. It performs eleven steps in an order the spec makes normative,
and it returns exactly one of three verdicts: **ok**, **tampered** (this hub is misbehaving), and **contested**
(this identity is in question). `recently restored`, `withdrawn: <number>` and `no index I can verify` are notes
on an ok read, not a fourth state.

That count is the design. Everything else in this example — the order, the notes, the frozen copy,
the battery — is downstream of the decision that a reader has three things to say and no more.

### What the output shows

**A reader is given three things.** The three inputs are printed at the top of a read because they
are the whole of what a reader is entitled to assume. There is no trust store, no list of
authorities and no name lookup: the anchor key is the identity, and the location is a place to look
for files that the key will have to vouch for.

**The order of operations is normative.** The eleven steps are printed with what each one actually
saw on a cold read. It is unusual for a spec to fix an order, and §7 does it because **each step
supplies what the next one checks** — reorder them and a reader is checking something else. The
example makes two adjacent pairs concrete:

- **Step 2 before step 4.** A substituted identity has a chain of its own, and it holds. The
  impostor's profile is read twice: by a reader that learned the thief's anchor key, where it comes
  back `ok`, and by a reader that learned hers, where it is `contested`. Step 4 asks whether a
  history hangs together; only step 2 asks *whose* history it is. A reader that walks first has
  verified a perfectly good chain belonging to a stranger.
- **Step 4 before step 5.** Her rotated profile does not verify under the anchor key and does verify
  under the key the chain ends on. Which key to verify under is the chain's last word (§3.2, §4.4).
  A reader that verified first would have to guess, and the only guess available is the anchor —
  which stops working the first time she rotates.

**The notes are not verdicts.** Three ordinary reads, three notes, three `ok` verdicts: a withdrawal
gives `withdrawn: 2`, a rotation caught between its two writes gives `no index I can verify`, and a
restore two of three list members vouched for gives `recently restored`. Every one of those is an
honest event in an honest identity's life.

**An index that will not verify is not an accusation.** The same hub, at the same moment, read two
ways. A publisher rotating her key writes the profile and then re-signs the index (§4.4); between
those two writes an honest hub is serving an index signed by a key the profile no longer ends on. A
reader **holding an index it verified itself** keeps that one, notes it, hands back its posts and
says nothing further. Only a reader **holding none** has anything to report, and it reports `tampered`.
An app SHOULD ask that cold reader to retry the whole read once — profile and index — before it does.

**Every live entry is checked before it is handed back (§7.1 step 12).** A media file's bytes must hash to
the address the index lists. A post must verify under *any* key in the chain — post 1 here is still
signed by the anchor key, two links back, and is still hers — its address must equal the hash the
index lists, and its `number` must equal the number it was served at. Any failure is `tampered`. The last row
is the encrypted post: this reader holds no reading key, never looked for one, and hands back
`encrypted` whole and unopened. Opening it is the client's business (§6), and a post is verified
identically whether or not anyone present can read it.

**A frozen copy is about the identity, not the hub.** After she leaves, the old hub serves the
profile and index it had, forever. To a reader that has seen the newer profile that is `contested: an
older profile than the one this reader saw`. It is emphatically **not** `tampered`: this hub is serving
exactly what it has, and nothing it did was misbehaviour. Two claims about one identity are in play
and this reader has seen the newer one, so the open question is which of them is her. A reader
arriving cold has no second claim and reads an unmarked page — that is an inherent limit of any protocol, and
the second half of this example shows the one mechanism (§3.5, through public replies) that reaches anybody else
at all.

**Thirteen hostile moves, three verdicts.** A hub withholds a listed post, serves an older index,
rolls the index's `version` back while keeping `highest` and every entry, serves a second index at the
same `version`, swaps a post for another she signed, serves a genuine post at the wrong number,
serves a post signed by a key that was never hers, withholds a listed media file, alters media
bytes, substitutes a whole other identity, serves a second profile at one version, serves nothing
at all — and finally smuggles in a post signed by a key that really was hers. The verdict for each
is printed, and then the number that matters: **the set of distinct verdicts across the whole
battery has exactly three members**, measured from the run rather than counted from the design. The
two index rows are there because they are caught by nothing else: an older index usually has a
lower `highest` too, and only §7.1 step 8's `version` rule sees a rollback that keeps it.

The last row is why one of those three is `ok`. A file signed by a key that was hers is not a post.
The index admits posts (§4), the index does not list 9, and the read is entirely ordinary — the file
is simply not there. There is nothing left over here for a fourth verdict to be.

## Why three, and not more

Every extra state is a state a user has to be taught, and one of them will cry wolf. The three notes
are exactly the cases that tempt an implementer into a fourth: they are *unusual*, and unusual reads
feel like they deserve their own colour. But each of them is produced by an honest identity doing an
honest thing — withdrawing a post, rotating a key, coming back from a lost phone — and a state that
fires on those is a state that fires mostly on nothing being wrong. That is the failure mode the
count exists to prevent.

It costs something real. Because `no index I can verify` is one note rather than several states, a
reader cannot distinguish an honest hub caught mid-rotation from a 404 from a file that arrived
garbled. §7.1 step 7 says so outright. The trade is worth taking, because the three cases call for the same
behaviour anyway — keep the index you verified, or retry and then report — and a reader that split
them would be inviting an app to *explain* a difference none of its users can act on.

**Why the verdict names a party at all.** A verdict is not a description of a file; it is an answer
to "who do I take this up with?" `tampered` means the files served do not hang together in a way that
withholding, swapping or rolling back would explain, and the author's own signature is the thing
that makes that attributable — the hub is the only party in the exchange that could have done it.
`contested` means the question is upstream of any hub: which key is hers.

There is one case where the label is charged to the wrong party. §4.1: **an index that verifies but
whose entries do not replay came from the author's own key**, not from a misbehaving hub, and is reported as
`tampered` anyway, because a fourth state for it is not worth the complexity. The spec's answer is a
wording rule rather than a state: an app SHOULD say *the files at this address do not make sense*,
not *this operator is cheating you*. That is good advice for all of `tampered`, and it is why the
verdict in the implementation is a bare token (`tampered`) with a separate sentence attached, rather
than a phrase an app is expected to show verbatim.

## Scenarios

`GOALS.md` scenario 1 (**the divorce**) is the centre. Its ending is the frozen copy: after she
leaves, Mom's app follows her with one tap and reads the ex's frozen copy "as an older version of
her, not as her" — which is precisely `contested: an older profile than the one this reader saw`, and
precisely not `tampered`. Getting that one verdict wrong turns the scenario's resolution into an
accusation against a hub that did nothing.

Scenario 6 (**the weekend**) is the other. The three verdicts were not decided and then implemented:
a second implementer wrote a whole reader from the text alone, ran thirteen staged moments through
it, and the distinct verdicts came out three (`examples/_seeds/weekend-gate.md`). That reader is
still in the repo as `weekend-reader/`, and it is the second reader `tools/regen.js` verifies
`test-vectors.md` with. This example re-measures the same claim against `src/reader.js` and its own
battery, because a number quoted from a design document is not evidence.

§7.4 — step 13, targets and the rumor rule — is the one place a read reaches past the identity it
was asked about. It is the second half of this example.

---

## `highest`, and the rumor rule

**Spec:** §4.2 for `highest`, §7.4 for targets and the rumor rule, §7.2 for why a rumor is a note and
not a verdict.
**Run:** `node examples/reading/reading.js`

An index's `highest` is the highest post number ever issued, and §4.2 says it MUST NOT decrease — not
even when the post holding that number is withdrawn. On its own that reads like bookkeeping. It is
not: `highest` is the only thing standing between a reader and a false accusation, and between somebody
else's hub and a thousand fetches it did not ask for.

The rule it serves is §7.4. When a post you can read replies to a post you cannot, the reader has to
decide whether that is worth mentioning. If the target number is at or below the `highest` of the index
it holds, the answer is no: the post was withdrawn or superseded, the index is signed, and a hub
cannot have quietly edited it. If the number is **above** the `highest`, the index the reader holds does
not account for a post somebody else says exists — so the reader looks again, once, and says one
line. That line is a **rumor**: *"X replied to something I cannot see."* It names the replier,
because the replier is the only party the reader has evidence about.

### What the output shows

**`highest` is the highest number ever issued, not the highest number listed.** Alice publishes three
posts and withdraws the third. The index still carries the line that issued 3 and the line that
withdrew it, the live set is `1, 2`, and `highest` is 3. Then she rewrites (§4.5) and both lines about 3
are gone — the entries mention only 1 and 2, and `highest` is still 3. After a rewrite, `highest` is the
**only** record that the number was ever used. That is what makes it a member of the index rather
than something a reader could compute from `entries`.

**Why `highest` outlives its post.** Mum's third reply targets post 3, the one alice deleted on purpose.
The example stages both worlds against the same reply. With `highest` at 3, the reader says nothing and
makes zero extra fetches. With `highest` allowed to fall to 2 — which is what a publisher that
recomputed it from the live entries would write after the rewrite — the same reply is above the highest,
the reader
looks again at alice's hub, and a rumor goes up over a post its author removed herself. Every reply
to a withdrawn newest post becomes an accusation of withholding. That is the whole of §4.2's
argument, and it is why the constraint is on the publisher's number rather than on the reader's
inference.

**A checkpointed reader is not fooled by the drop.** The same forged-low index shown to a reader that
already recorded `highest` 3 comes back **tampered: the highest number used went backwards** (§7.1 step 8).
So the falling `highest` hurts exactly the reader who has no history to check it against — a new one —
and that is the reader most likely to believe the rumor.

**1,000 replies, and what the reader pays for them.** The measurement is the point of the second
half. A thousand replies to posts alice has listed cost **0** fetches and print **0** lines: they
are at or below the `highest`, and the rule stops there. A thousand replies naming 500…1499, numbers alice
never issued, cost **one look at that identity — 4 fetches, one whole read of alice: profile, index,
post 1, post 2 — and print one line.** The naive rule, which looks again per reply and prints per
reply, would spend 4,000 fetches at alice's hub and print 1,000 messages. The four is not a
constant: it is the size of one read of the target, so the naive rule's bill grows with the
*target's* post count as well as with the attacker's reply count. Both bounds — **at most one
look-again per identity per pass**, and **one line per person** — are REQUIRED by §7.4, and a reader
with only one of them is still broken in the other direction.

**A rumor is never raised over a post the author withdrew.** The reader that watched the withdrawal
holds `3` in its checkpoint's withdrawn map, with the hash it had. Mum's reply names that exact hash, 3 is
at or below the `highest`, and the reader stays quiet at a cost of zero fetches. Note that this reader
would stay quiet even without the checkpoint's memory of the hash: the `highest` check alone is enough. The
withdrawn map is what lets it also tell a reply to *her* post 3 from a reply to some other post
claiming that number (§5.4) — that one is marked unresolved, and it too says nothing.

**A rumor is a note, not a fourth state.** §7.2 allows exactly three verdicts — `ok`, `tampered`,
`contested` — and a conforming reader MUST NOT invent a fourth. The
last block shows the reads that surround the rumor all coming back `ok`: mum's feed, alice's feed,
and the griefer's own feed. Nothing the griefer wrote is a verdict against him; writing a reply that
names a number is not misbehaviour a reader can see. The rumor is said beside an `ok` read, in the
same place as `withdrawn: 3` and `recently restored`.

