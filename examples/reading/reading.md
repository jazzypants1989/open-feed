# Reading

§7 of the spec. One script; the prose below is the former the-reader and top-and-rumors examples.

---

## The reader

**Spec:** §7 entire, and §4.2 for the one verdict charged to the wrong party.
**Run:** `node examples/the-reader/the-reader.js`

A reader is given three things: **the anchor key it learned** (§3.1), **a location**, and optionally
**the pin it kept from last time**. It performs eleven steps in an order the spec makes normative,
and it returns exactly one of three verdicts: **ok**, **this host is misbehaving**, and **this
identity is in question**. `recently restored`, `withdrawn: n` and `no index I can verify` are notes
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
  back `ok`, and by a reader that learned hers, where it is `identity`. Step 4 asks whether a
  history hangs together; only step 2 asks *whose* history it is. A reader that walks first has
  verified a perfectly good chain belonging to a stranger.
- **Step 4 before step 5.** Her rotated profile does not verify under the anchor key and does verify
  under the key the chain ends on. Which key to verify under is the chain's last word (§3.3, §4.6).
  A reader that verified first would have to guess, and the only guess available is the anchor —
  which stops working the first time she rotates.

**The notes are not verdicts.** Three ordinary reads, three notes, three `ok` verdicts: a withdrawal
gives `withdrawn: 2`, a rotation caught between its two writes gives `no index I can verify`, and a
restore two of three list members vouched for gives `recently restored`. Every one of those is an
honest event in an honest identity's life.

**An index that will not verify is not an accusation.** The same hub, at the same moment, read two
ways. A publisher rotating her key writes the profile and then re-signs the index (§4.6); between
those two writes an honest host is serving an index signed by a key the profile no longer ends on. A
reader **holding an index it verified itself** keeps that one, notes it, hands back its posts and
says nothing further. Only a reader **holding none** has anything to report, and it reports `host`.
§7.2 asks that cold reader to retry the whole read once — profile and index — before it does.

**Every live entry is checked before it is handed back (§7.4).** A media file's bytes must hash to
the address the index lists. A post must verify under *any* key in the chain — post 1 here is still
signed by the anchor key, two links back, and is still hers — its address must equal the hash the
index lists, and its `n` must equal the number it was served at. Any failure is `host`. The last row
is the encrypted post: this reader holds no reading key, never looked for one, and hands back
`encrypted` whole and unopened. Opening it is the client's business (§6), and a post is verified
identically whether or not anyone present can read it.

**A frozen copy is about the identity, not the host.** After she leaves, the old hub serves the
profile and index it had, forever. To a reader that has seen the newer profile that is `identity: an
older profile than the one this reader saw`. It is emphatically **not** `host`: this host is serving
exactly what it has, and nothing it did was misbehaviour. Two claims about one identity are in play
and this reader has seen the newer one, so the open question is which of them is her. A reader
arriving cold has no second claim and reads an unmarked page — §13.3 states that limit plainly, and
`top-and-rumors/` shows the one mechanism (§3.7, through public replies) that reaches anybody else
at all.

**Thirteen hostile moves, three verdicts.** A hub withholds a listed post, serves an older index,
rolls the index's `version` back while keeping `top` and every entry, serves a second index at the
same `version`, swaps a post for another she signed, serves a genuine post at the wrong number,
serves a post signed by a key that was never hers, withholds a listed media file, alters media
bytes, substitutes a whole other identity, serves a second profile at one version, serves nothing
at all — and finally smuggles in a post signed by a key that really was hers. The verdict for each
is printed, and then the number that matters: **the set of distinct verdicts across the whole
battery has exactly three members**, measured from the run rather than counted from the design. The
two index rows are there because they are caught by nothing else: an older index usually has a
lower `top` too, and only §7.2's `version` rule sees a rollback that keeps it.

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
reader cannot distinguish an honest host caught mid-rotation from a 404 from a file that arrived
garbled. §7.2 says so outright. The trade is worth taking, because the three cases call for the same
behaviour anyway — keep the index you verified, or retry and then report — and a reader that split
them would be inviting an app to *explain* a difference none of its users can act on.

**Why the verdict names a party at all.** A verdict is not a description of a file; it is an answer
to "who do I take this up with?" `host` means the files served do not hang together in a way that
withholding, swapping or rolling back would explain, and the author's own signature is the thing
that makes that attributable — the host is the only party in the exchange that could have done it.
`identity` means the question is upstream of any host: which key is hers.

There is one case where the label is charged to the wrong party. §4.2: **an index that verifies but
does not fold came from the author's own key**, not from a misbehaving hub, and is reported as
`host` anyway, because a fourth state for it is not worth the complexity. The spec's answer is a
wording rule rather than a state: an app SHOULD say *the files at this address do not make sense*,
not *this operator is cheating you*. That is good advice for all of `host`, and it is why the
verdict in the implementation is a bare token (`host`) with a separate sentence attached, rather
than a phrase an app is expected to show verbatim.

### Contrast

**TLS certificate validation** is the cautionary case. A browser's chain validation has a genuinely
large vocabulary — expired, not yet valid, hostname mismatch, unknown issuer, revoked, revocation
unknown, weak signature algorithm, name constraint violation — and it surfaces most of them through
one interstitial with an "Advanced" link. The vocabulary is real and the user's response to all of
it is identical: click through. A security UI with many states degrades into one state, and the
state is *yes*. Open Feed does not get to be smarter than browser vendors here; it gets to have less
to say.

**GnuPG's trust levels** — unknown, undefined, never, marginal, full, ultimate, plus separate
validity — are the same lesson at the identity layer. The model is more expressive than Open Feed's
and, by most accounts, almost nobody ever set the values, so in practice the whole lattice collapsed
to "I have this key" versus "I do not". Open Feed's chain and recovery list (§3.3, §3.4) produce a
verdict, not a score, and the reader does not ask its user to arbitrate.

**Signal's "safety number changed"** is the closest relative and it is deliberately binary. It maps
almost exactly onto `identity`: something about who this is has changed and cannot be settled from
here. Open Feed adds one state Signal has no need for, `host`, because Open Feed's reader re-fetches
a history a hub could withhold or roll back, while a Signal server relays messages it cannot replay
or reorder into an earlier state.

The general rule this example is built around: **the number of states is a UI budget, not a
correctness budget.** The protocol can detect far more than three conditions — the reader's `why`
strings distinguish a dozen — but what it *reports* is three, and the extra detail rides as
explanation inside a verdict rather than as another thing a person must learn.

## Scenarios

`GOALS.md` scenario 1 (**the divorce**) is the centre. Its ending is the frozen copy: after she
leaves, Mom's app follows her with one tap and reads the ex's frozen copy "as an older version of
her, not as her" — which is precisely `identity: an older profile than the one this reader saw`, and
precisely not `host`. Getting that one verdict wrong turns the scenario's resolution into an
accusation against a hub that did nothing.

Scenario 6 (**the weekend**) is the other. The three verdicts were not decided and then implemented:
a second implementer wrote a whole reader from the text alone, ran thirteen staged moments through
it, and the distinct verdicts came out three (`examples/_seeds/weekend-gate.md`). That reader is
still in the repo as `weekend-reader/`, and it is the second reader `tools/regen.js` verifies
Appendix B with. This example re-measures the same claim against `src/reader.js` and its own
battery, because a number quoted from a design document is not evidence.

§7.5 — step 11, targets and the rumor rule — is the one place a read reaches past the identity it
was asked about. It belongs to `top-and-rumors/`.

---

## `top`, and the rumor rule

**Spec:** §4.3 for `top`, §7.5 for targets and the rumor rule, §7.3 for why a rumor is a note and
not a verdict.
**Run:** `node examples/top-and-rumors/top-and-rumors.js`

An index's `top` is the highest post number ever issued, and §4.3 says it MUST NOT decrease — not
even when the post holding that number is withdrawn. On its own that reads like bookkeeping. It is
not: `top` is the only thing standing between a reader and a false accusation, and between somebody
else's hub and a thousand fetches it did not ask for.

The rule it serves is §7.5. When a post you can read replies to a post you cannot, the reader has to
decide whether that is worth mentioning. If the target number is at or below the `top` of the index
it holds, the answer is no: the post was withdrawn or superseded, the index is signed, and a hub
cannot have quietly edited it. If the number is **above** the top, the index the reader holds does
not account for a post somebody else says exists — so the reader looks again, once, and says one
line. That line is a **rumor**: *"X replied to something I cannot see."* It names the replier,
because the replier is the only party the reader has evidence about.

### What the output shows

**`top` is the highest number ever issued, not the highest number listed.** Alice publishes three
posts and withdraws the third. The index still carries the line that issued 3 and the line that
withdrew it, the live set is `1, 2`, and `top` is 3. Then she rewrites (§4.7) and both lines about 3
are gone — the entries mention only 1 and 2, and `top` is still 3. After a rewrite, `top` is the
**only** record that the number was ever used. That is what makes it a member of the index rather
than something a reader could compute from `entries`.

**Why `top` outlives its post.** Mum's third reply targets post 3, the one alice deleted on purpose.
The example stages both worlds against the same reply. With `top` at 3, the reader says nothing and
makes zero extra fetches. With `top` allowed to fall to 2 — which is what a publisher that
recomputed it from the live entries would write after the rewrite — the same reply is above the top,
the reader
looks again at alice's host, and a rumor goes up over a post its author removed herself. Every reply
to a withdrawn newest post becomes an accusation of withholding. That is the whole of §4.3's
argument, and it is why the constraint is on the publisher's number rather than on the reader's
inference.

**A pinned reader is not fooled by the drop.** The same forged-low index shown to a reader that
already recorded `top` 3 comes back **host: the highest number used went backwards** (§7.2 step 9).
So the falling `top` hurts exactly the reader who has no history to check it against — a new one —
and that is the reader most likely to believe the rumor.

**1,000 replies, and what the reader pays for them.** The measurement is the point of the second
half. A thousand replies to posts alice has listed cost **0** fetches and print **0** lines: they
are at or below the top, and the rule stops there. A thousand replies naming 500…1499, numbers alice
never issued, cost **one look at that identity — 4 fetches, one whole read of alice: profile, index,
post 1, post 2 — and print one line.** The naive rule, which looks again per reply and prints per
reply, would spend 4,000 fetches at alice's host and print 1,000 messages. The four is not a
constant: it is the size of one read of the target, so the naive rule's bill grows with the
*target's* post count as well as with the attacker's reply count. Both bounds — **at most one
look-again per identity per pass**, and **one line per person** — are REQUIRED by §7.5, and a reader
with only one of them is still broken in the other direction.

**A rumor is never raised over a post the author withdrew.** The reader that watched the withdrawal
holds `3` in its pin's withdrawn map, with the hash it had. Mum's reply names that exact hash, 3 is
at or below the top, and the reader stays quiet at a cost of zero fetches. Note that this reader
would stay quiet even without the pin's memory of the hash: the `top` check alone is enough. The
withdrawn map is what lets it also tell a reply to *her* post 3 from a reply to some other post
claiming that number (§5.4) — that one is marked unresolved, and it too says nothing.

**A rumor is a note, not a fourth state.** §7.3 allows exactly three verdicts — `ok`, *this host is
misbehaving*, *this identity is in question* — and a conforming reader MUST NOT invent a fourth. The
last block shows the reads that surround the rumor all coming back `ok`: mum's feed, alice's feed,
and the griefer's own feed. Nothing the griefer wrote is a verdict against him; writing a reply that
names a number is not misbehaviour a reader can see. The rumor is said beside an `ok` read, in the
same place as `withdrawn: 3` and `recently restored`.

### Contrast

The general shape is worth naming, because it is not specific to this protocol: **any "go check
that" rule driven by attacker-controlled input is a request amplifier unless it is bounded per
identity and per pass.** The attacker writes cheap bytes on his own hub; the reader spends fetches
on a third party's hub. The attacker chooses how many. Neither of the two parties paying is the one
deciding.

The classic version is **email backscatter**: a spammer forges an envelope sender, and every server
that bounces politely turns one forged message into delivery attempts aimed at whoever was named.
The defence there was to stop generating the second message on unverified input — reject at the
transaction rather than bounce afterwards — which is the same move as bounding the look-again.
Open Feed's version is milder (a rumor pass costs one read, not a mail flood) but the structure is
identical, and the fix has to be structural for the same reason: rate limiting is a knob, and the
bound is a rule.

**ActivityPub** meets the shape from the other side. There the attacker's input arrives as a push
into an inbox, so the defence is at the door — signature checks, per-actor rate limits, delivery
queues — and it is operator policy rather than protocol text. Open Feed has no inbox and nothing is
pushed, so the equivalent decision happens inside a reader that already fetched the reply on
purpose. That is a smaller surface, but it also means no operator is in a position to add the
missing limit later: if the reader is unbounded, every copy of it is unbounded. **Nostr** puts the
fan-out in the relays, where a client subscribes and relays deliver; the amplification budget is a
relay's to manage, and the client is mostly a consumer of what arrives. Open Feed's reader is the
one making requests, so it has to carry its own budget. Neither of those designs is wrong about
this — they place the cost somewhere there is an operator to watch it, and this design has no such
operator by construction.

The scenarios this serves are `GOALS.md` **scenario 5, the big lazy hub**: ten thousand people on
one commercial hub whose operator is hostile at scale, where *per-identity cost stays flat* is a
floor requirement — and the rumor rule's per-identity-per-pass bound is exactly that requirement
applied to the reader's outbound fetches. And `GOALS.md` **scenario 1, the divorce**: the rumor is
how a reader finds out that a hub is withholding a post its author published, which is one of the
moves the ex's hub can make. `top` is what keeps that signal honest — without §4.3 the signal fires
on every withdrawal, and a warning that fires when nothing is wrong is a warning nobody reads.
