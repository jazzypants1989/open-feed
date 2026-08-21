# pubif-gate — the publish interface, over real sockets

**Candidate gate** (`../HANDOFF-to-spec.md` §2.C; GOALS "still open" 1; rulings 3 and 5). Substrate:
`lastline.js`, with the head shaped as `aohead-gate` rules it. `writer-gate` proved the
compare-and-swap convention on the **old** substrate and is not cited here — nothing in this file
imports it.

**Question.** Ruling 3 fixed the naming (a number that goes up, create-once, first-come with the
profile as proof) and ruling 5 added compare-and-swap on the overwritten files, but the interface
has never been run: two devices have never actually raced over a socket, and the "host MAY check
stamps" half was ruled on the reasoning that readers check regardless, so it is *disk hygiene, not a
floor question*. This gate runs it.

**Method.** A ~70-line hub on a real loopback socket, in three configurations — one that verifies the
stamp on every write against the profile sitting at that name, one that verifies nothing, and the
ruled one that verifies only when a number is already taken. `PUT` at
`/name/profile`, `/name/head`, `/name/posts/N`; compare-and-swap by `If-Match` on the two files that
are overwritten; create-once on the numbered ones. Sixteen claims: two devices racing for one number
**and forced to collide on the head** (neither writes until both hold the same etag, so the loser
really takes the 412 path); the same head race with compare-and-swap off; a replayed request; a name
takeover, a rotation and a profile rollback; an outsider writing as Alice on each host; and a griefer
against create-once on each host, the reclaim rule turned around, and the
replay of a genuine post into an empty slot.

**Numbers** (stale if the hub's rules change):
- The race: `posts/7 409 · posts/8 201 · head 412 · head 200` for the loser. Both posts land, the
  head lists **7 and 8** at top 8. The saving move is that the loser re-reads **what the host is
  serving** and folds its own line into that, rather than re-sending its own idea of the list.
- Compare-and-swap off: the second head write lands and post 7 — which exists, verifies, and is
  signed — reads to every reader as **a withdrawal**. Not an error, not a rumor. **A silent loss.**
- Replay: a captured `PUT` of a post is refused by create-once (409), a captured `PUT` of the head
  by the stale etag (412). **There is no token, session or account anywhere in the interface** — the
  request *is* the signed file, and both refusals fall out of rules that exist for other reasons.
- The name: an outsider claiming it gets 409, Alice's rotation 200, her older profile 409.

**The finding.** *"The host MAY check stamps"* is not disk hygiene. The floor half of the ruling is
confirmed — an outsider's post lands on the dumb hub (201) and **the reader refuses it either way**,
so nothing about the floor depends on which host you are on. But create-once and unchecked stamps do
not compose: a griefer PUTs `/alice/posts/30…34` with files signed by his own key, gets **201 five
times**, and Alice's own post at 30 is then refused **409 — permanently, by the rule that protects
her from being overwritten**. On the stamp-checking host he gets 403 five times and she gets 201.
This is not a nuisance that a reader notices and discounts; it is a stop, it is cheap, and it is
available to anyone on the internet who knows the address.

**The repair, as ruled (2026-08-21; RULINGS §12.5).** A hub may check nothing on the ordinary path,
but a write to a number that is **already taken** must be resolved rather than refused flatly: if
the file sitting there is not the owner's, the owner's write replaces it. The griefer's five 201s
become five reclaimed 200s and the hub serves Alice's bytes. It does not turn around — he cannot
take back what she reclaimed (409), cannot overwrite a genuine post of hers (409) — and create-once
survives, because Alice cannot overwrite her own post either (409). The exit opens only for a file
that is not the owner's.

**And "not the owner's" cannot mean "not signed by her".** He can replay a *genuine* post of hers
into a number she has not reached yet; it is signed by her chain, so a signature test alone calls it
hers and locks her out of that number permanently. What closes it is ruling 3's other habit — **a
post declares its own number inside its signed bytes** — checked *at the host*, not only at the
reader. Replayed post 7 sitting at slot 50 declares 7, so it is not her file for 50, and she takes
50 back. That habit was recorded as riding along "for free"; here it is load-bearing.

**Kill criterion.** A race that loses a post or a head entry; a head collision that never happens
(the retry path untested); a replayed PUT that lands; an outsider who takes over a name or whose
write verifies as Alice; a reader whose verdict depends on which host served it; a reclaim rule the
griefer can use, or that lets an author overwrite her own post. **Not triggered.**

**Revert-checked** (`revert.js`, 6 rows): removing the `If-Match` check (the collision and the
silent-loss rows go red); removing create-once (the race and the replay rows go red); removing the
`pseq` advance on a profile (the rollback row goes red); removing the stamp check (the outsider and
griefer rows go red); refusing every taken number outright (the reclaim row goes red); dropping the
declared-number test from "is this her file" (the replay-into-an-empty-slot row goes red).

**Verdict.** The interface as ruled works over a real socket and is smaller than it looked: three
paths, two verbs, one conditional header, no accounts. Two sentences it owes. **A writer that loses
a compare-and-swap re-reads the file the host is serving and folds its own line into that** — the
naive retry silently drops the other device's post, and the loss reads as a deletion, so nothing
anywhere reports it. **A number held by a file that is not the owner's may be reclaimed by the
owner, and by nobody else** — where "the owner's" means signed by a key in her chain *and* declaring
that number. Ruling 3's "the host MAY check stamps" survives on the ordinary path and stops being
true on a collision.

**Run:** `node tmp/redesign/gates/pubif-gate.js`
