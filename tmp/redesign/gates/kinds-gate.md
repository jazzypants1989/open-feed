# kinds-gate — do three signed kinds cover every operation?

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §3
claim 5 and the artifact inventory in `decisions/inventory-keys-exp.js`). Substrate: `lastline.js`.

**Question.** The inventory maps every operation onto profile / head / post, with *edit* on the
head ("replace the hash at n"). Ruling 3 says the host refuses a write to a number that exists
and a post declares its own number. TLDR-new says "everything is a signed file." Do edit, a
photo, a follow, a mute, and a board fit, and what does the edit mapping break?

**Method.** #7 changed under a reader that kept the bytes it verified: edit in place (new bytes
at 7, head updated), a host swap (head unchanged, file swapped), a rewrite by a compromised
current key — the evidence tuple each leaves. Then what in-place editing costs: the two-device
race with overwrite permitted (`writing-exp.js`), two valid files both declaring `n: 7` in the
family archive, and mom's old reply targeting `(7, oldhash)` — against edit-as-a-new-number with
a `supersedes` pointer. A hash-named unsigned blob referenced from a post: swapped, unreferenced,
injected; the head's growth if it listed blob hashes. Follow, mute, board as one line each, and
the contact list's two possible homes priced per hundred changes.

**Numbers** (stale if the head shape or ruling 3 change):
- Edit in place **is** distinguishable from a host swap (head and file agree after an edit,
  disagree after a swap) — the handoff's worry was the wrong one. It is **indistinguishable from a
  compromised-key rewrite**: identical evidence tuples.
- Overwrite permitted: the two-device race loses **1** post silently; create-once loses 0.
- Two `n: 7` files: not orderable from bytes; with `supersedes: [7, hash]`, orderable.
- Mom's reply to `(7, oldhash)` under edit in place: shown over the new text with an n-only
  check, or reads as withdrawn with a hash check. As a new number: lands on the text it answered.
- Blob: a swap is caught by its hash; an unreferenced or injected blob is inert. Listing blob
  hashes in the head costs **55 B per photo** (86 KB at one per post over 1,557 posts — the head
  doubles).
- Contact list surviving phone loss, 100 changes: as sealed-to-self posts, 100 numbers and 100
  head versions; as a profile blob, 100 pseq versions.

**Kill criterion.** Edit in place indistinguishable from a host swap; edit-as-new-number failing
any row edit-in-place fails; a blob swap or injection a reader accepts. **Not triggered.**

**Revert-checked** (`revert.js`): the host refusing overwrite even under edit in place (the race
row goes red); the reply resolver ignoring the hash (the withdrawn row goes red).

**Verdict.** Three *signed* kinds hold. Two sentences in the design do not: "edit maps onto the
head" — an in-place edit reopens ruling 3's host rule (and with it the lost-post race), leaves the
family archive unable to order two versions, and strands every old reply; an edit must be a new
number carrying a pointer to what it replaces, and the owner must say whether the superseded
number stays listed (history visible) or is withdrawn (`GOALS.md:75` literal). And "everything is
a signed file" — a photo is an unsigned hash-named file admitted by reference, a fourth file kind
even if not a signed one, and "the store retains what its head declares" reaches it only if the
host parses posts or the head lists blobs. Follow, mute, and board are reader-local or generated;
the contact list is the genuinely undesigned piece (handoff §5), and both homes for it have a
visible cost.

**Run:** `node tmp/redesign/gates/kinds-gate.js`
