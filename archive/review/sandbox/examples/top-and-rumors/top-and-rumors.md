# `top`, and the rumor rule

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

## What the output shows

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

## Contrast

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

This finding did not come from reading the design. It came from writing a **second** reader from the
text alone (`GOALS.md` scenario 6, staged in `examples/weekend-reader/`), where the rumor rule was
first implemented the obvious way — per reply — and the griefing count was measured afterwards. It
was invisible until the code existed, which is the argument for the capstone existing at all.

The scenarios this serves are `GOALS.md` **scenario 5, the big lazy hub**: ten thousand people on
one commercial hub whose operator is hostile at scale, where *per-identity cost stays flat* is a
floor requirement — and the rumor rule's per-identity-per-pass bound is exactly that requirement
applied to the reader's outbound fetches. And `GOALS.md` **scenario 1, the divorce**: the rumor is
how a reader finds out that a hub is withholding a post its author published, which is one of the
moves the ex's hub can make. `top` is what keeps that signal honest — without §4.3 the signal fires
on every withdrawal, and a warning that fires when nothing is wrong is a warning nobody reads.
