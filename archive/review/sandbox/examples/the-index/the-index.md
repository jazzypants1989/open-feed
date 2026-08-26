# The index

**Spec:** §4 the index, §4.1 what the entries mean, §4.2 the fold, §4.6 signed by the current key.
Vectors: Appendix B.9–B.11.
**Run:** `node examples/the-index/the-index.js`

The index is the answer to *what exists now*. It is one signed file at `/<name>/index`, and with the
profile it is one of the only two files a publisher is allowed to overwrite (§8.1) — every numbered
post is written once and never again. Its body has three members: `entries`, the lines in order;
`version`, which never goes backwards; and `top`, the highest post number ever issued.

Nothing in it is a diff and nothing is a patch. A reader recomputes the whole live set from line one
every time, by **folding** the entries in order (§4.2), so a reader that joined at `version` 1 and a
reader that joined at `version` 6 hold the same answer about today. The value of having such a file
at all is completeness: because the author signed a statement of what exists, a host cannot quietly
drop a post and have the absence look like nothing.

## What the output shows

**One signed file that says what exists now.** The example prints Appendix B.9 — three posts live,
`version` 1, `top` 3 — and names the three members. It is an ordinary signed file (§2.1): body,
newline, signature, and the address is the hash of the body, exactly as `signed-file/` showed.

**Four line shapes, and nothing else.** `[n, hash]` says post `n` exists at that address;
`[n, null]` withdraws it; `[hash]` says a media file with that address exists; `[hash, null]`
withdraws it. That is the whole grammar. Appendix B.10 carries the first three: post 2 withdrawn by
an appended line, post 5 encrypted, and one media file listed by its address alone. Media has its
own example (`media/`, §4.4); what matters here is that it is admitted by *being listed*, and
checked by its hash, so retention is one rule that reaches **encrypted** posts too.

**The live set is the fold of the entries, in order.** The example folds B.10's seven lines one at a
time and prints the live set after each: post 2 appears, then leaves when `[2, null]` is reached,
and the media file joins at the end. The fourth line shape, `[<media hash>, null]`, takes the media
file back out again.

**An index that does not fold is invalid, and the verdict is `host`.** Five malformed entry lists
are shown being refused — a number listed twice, a withdrawal of something that is not live, a
number below 1, a media file listed twice, a media withdrawal of nothing — and then one of them is
served to a reader, which reports `host: the index does not fold`. The spec is honest about this
label and so is the narration: the index **verified**, so it came from the author's own key, not
from a misbehaving hub. It is reported as `host` anyway because a fourth reader state was not worth
the complexity (§7.3 allows exactly three), and an app SHOULD word it as *the files at this address
do not make sense* rather than as an accusation against the operator. The same block shows `top`'s
floor — it MUST be at or above the highest number anywhere in `entries` — and that a feed which has
issued nothing has `top` 0. *Why* `top` outlives the post holding it is §4.3 and belongs to
`top-and-rumors/`.

**A number has one hash, ever.** Appendix B.11 is the rewrite (§4.7): the lines the withdrawal left
behind are gone, and post 2 is re-listed at the hash it had. That is legal. Re-listing at a
*different* hash is not, and within one index the fold catches it. Across a rewrite the fold cannot:
once the `[2, null]` line has been swept away, that index has never heard of post 2, so the rule
that reaches across versions is the reader's own memory. §7.2 makes the pinned reader keep the hash
of every number it saw withdrawn, and the example runs one reader through four versions to show it:
the withdrawal is noted `withdrawn: 2`, the same bytes coming back read `ok`, and other bytes at
that number read `host: post 2 changed after the reader saw it`.

Re-listing at the identical hash is allowed because it is harmless — and because it is the way back
from a thief who held the current key and withdrew everything the owner wrote. She restores and
re-lists the same bytes, and readers who watched him delete them accept it in silence.

(`recently restored` appears in those notes because this identity's chain ends in a restore. It is
§3.5's note, not §4's business; see `the-chain/`.)

**`entries` MUST come first.** This is the protocol's one member-order requirement, and the example
measures what it buys: 161 of `version` 1's 183 body bytes are the opening prefix of `version` 2's
340, byte for byte, because appending a line leaves every earlier byte where it was. A reader that
cached `version` 1 MAY therefore fetch only the tail — a range request conditioned on the entity tag
it holds (`If-Range`). Put `entries` last instead and the counter-example is stark: `version` 9
becoming 10 moves every entry byte, and the shared prefix collapses to 11 bytes. It is **not** a
canonicalization rule (`no-canonicalization/`): nobody re-serializes anything, and a verifier that
has never heard of the rule still checks the signature correctly.

**Signed by the key the chain currently ends on.** Not by any key in the chain — by the current one
(§4.6). The example gives Alice a chain of anchor → rotated → restored, and shows an index signed by
the middle key failing to verify. The reason is staged rather than asserted: the index is what
admits posts, so if a reader accepted an index from any chain key, a thief holding a rotated-out key
would go on deciding what counts as hers, and a restore would take nothing back. **Re-signing the
index is what a restore actually restores.**

The honest consequence is printed too. Between the two writes a rotation takes, a truthful host is
serving an index signed by a key the profile no longer ends on — so §7.2 says an unverifiable index
is not an accusation. A reader with no pin reports `host`; a reader holding an index it verified
itself keeps that one, notes `no index I can verify`, and says nothing further.

## Contrast

**A feed that is its items cannot say what is missing.** In RSS, Atom and JSON Feed the document
*is* the entries, and a truncated document is indistinguishable from a short one: a host that drops
your last three posts serves a feed that looks exactly like a feed with three fewer posts. There is
no place to state "and these are all of them," and no signature over the statement if there were.
Open Feed's index is a signed, versioned claim about the whole set, and the host cannot sign one. So
withholding a post the index lists reads as `host: post n is listed and not served`; serving an
older index is caught by `version` going backwards; and a number that comes back as different bytes
is caught by the pin (§7.2). What a reader is told when a post simply stops being listed is
`withdrawn: n` — it cannot tell a deletion from a change of mind, and does not try to. That is
`GOALS.md` floor item 1 and scenario 1's *he cannot alter or backdate what she wrote*: the mechanism
is not that the host is trusted, but that its options are all visible to a reader that was here
before.

**Nostr relays make the same trade in the other direction.** An absent event is unremarkable: relays
are expected to be partial, and there is no per-author statement of completeness to compare against.
That buys enormous flexibility in how events are spread around and gives up the ability to say a
relay withheld something. Open Feed pays one extra signed file per identity and gets the claim.

**A transparency log buys much more and costs much more.** Certificate Transparency and Merkle-log
designs generally publish a signed tree head plus inclusion and consistency proofs, so that a third
party — an auditor or monitor who was never a reader — can prove the log operator equivocated or
rolled back. Open Feed has no proofs, no auditors, and no gossip between readers. Its index is
comparable only against what *this* reader saw itself (its pin, §7.2), so a rollback shown to a
brand-new reader is invisible to that reader. The design says so rather than dressing it up: the
adversary is a family hub operator, the defence is exit (§10, §13.1) and verification he cannot
forge (§7), and hash-chained proofs would have added an appendix of machinery to catch a case the
threat model does not need caught.

**The cost is bounded and flat.** One extra file per identity, rewritten at the publisher's chosen
cadence (§4.7), with the leftover withdrawal lines at roughly 6% of the file. Nothing about the
index scales with the number of readers or the number of identities a hub carries, which is what
`GOALS.md` scenario 5 — ten thousand people on one commercial hub, per-identity cost flat — asks of
it. The member-order rule and the range request are a small part of the same instinct: they let a
returning reader ask for a few hundred bytes instead of the whole file, and they buy nothing else.
