# Contests and locations

§3.4–3.5 of the spec. One script; the prose below is the former contest and moving examples.

---

## Contests: two profiles claiming one identity

**Spec:** §3.4, leaning on §3.2 (the chain) and §3.3 (the recovery list), reaching §7.2 for the
`contested` verdict and §3.7 for the exit.
**Run:** `node examples/contests/contests.js`

A thief holding one of your keys can publish a profile whose chain walks perfectly from your anchor
key. So can somebody holding none of them, with a link vouched by a recovery list of their own
making. **Checking that the chain walks is therefore not a test of anything** — it is the
observation §3.4 starts from, and the first block below prints `true` for the thief's chain to make
it concrete. Everything in §3.4 exists because the walk is free.

The person doing this is not a stranger. He is the hub operator, he is family, he is on the recovery
list because he was on it before the divorce, and he will not cooperate (`CLAUDE.md`'s threat model;
`docs/GOALS.md` scenario 1). This example stages him by name.

Four rules settle a contest, and a reader MUST apply all four. Each is staged here so that the rule,
and not the fact that a chain walks, is what decides the verdict; `tools/revert.js` holds the edit
to `src/` that turns each one off and must turn this example red. The verdict *strings* printed
below are `src/profile.js`'s wording; the spec fixes only the three verdicts (§7.2).

### What the output shows

**The checkpoint holds the chain, and a served chain must extend it key for key.** The reader checkpointed Alice
at `version` 3: anchor key, a rotation to A2, a restore to A3. The ex holds A2 — the key she rotated
away from, which stays in her chain and keeps her old posts valid (§3.3) — and serves a chain that
walks from the anchor and ends on his own key. The **divergence point** is index 2, the first index at which
the two chains differ, and the reader's verdict names the hub, not Alice.

The second half of the rule is the sharper one: he serves `version` 9 with the chain from *before*
her restore. Nothing in it is forged; it is simply shorter. A profile at a higher `version` whose
chain is a strict **prefix** of the checkpointed chain is a divergence too, at the end of the prefix — that is
the thief pretending a restore never happened, and without this clause he wins by picking a big
number. The block closes with the two plain rules that hold against a checkpoint outside any divergence:
`version` MUST NOT go backwards, and the same `version` with a different address is contested.

**A recovery list is kept per chain length, and is never overwritten.** The ex holds A2, so he can
sign a profile at the chain length the reader is checkpointed at. He republishes with a recovery list of
one — himself — and the read comes back `ok`, because *nothing distinguishes his edit from hers*:
the key that signs is the key her chain ends on. What he does not get is the reader's list. A reader
keeps the first recovery list it ever saw at each chain length, and because every link carries the
list that stood before it (§3.3), a checkpointed reader holds one at **every** length its chain reaches,
from its first read. When he then splits the chain with a restore his own list would have
blessed, the list at the divergence point is still the three-member one: his single voucher is not a majority
of it, so his link is not a valid link at all (§3.3), and the read ends before any contest.

**A link is judged by the list the reader holds, never by the copy it carries.** The same divergence,
counted twice. Against the list the reader holds — three members — his self-vouched restore is one
of three, which is not a valid link. Against the copy his link carries — one member, himself — he
has a majority and would be Alice. The block closes with a link of his that *is* valid — a rotation
signed with the A2 he holds, vouched by himself, carrying his list of one — against her restore by mum
and sis: under the held list his one voucher of three loses to her two, and the reader names the hub. The carried copy exists
only for a reader with no list at that length; a checkpointed reader MUST NOT prefer it, and MUST NOT
adopt one at any length its chain already reaches. The example shows the reader's list at index 2
unchanged after the read.

**A majority of the list at the divergence point wins, on exactly one side.** Five divergences in a table, with the
voucher counts the reference implementation actually computed. Row 2 is the point about signatures:
two signed rotations, one from Alice and one from the ex with the key he took, and the verdict is
contested. **A link's `signature` is not a vote.** It proves that whoever held the previous key moved, and
he held it too. Rows 3 and 4 never reach the contest at all: his link is a restore he vouched for
alone, one of three, and §3.3 rejects it as a link before rule 4 is consulted. Row 5 is the other
tie — mum was made to vouch for him, so both branches reach a majority — and it also resolves to
contested. Both sides, or neither: the reader follows nobody.

**He moves first.** The threat model (`CLAUDE.md`) gives the operator the serving path and first
move, and the key he holds is not one she rotated away from but her *live* one. So the block stages
the order he would actually choose: a reader checkpointed at `version` 2, whose chain ends on A2, is served
his rotation A2 → his key. No divergence — the chain extends the checkpoint — and the reader follows him, `ok`.
Then her restore, vouched by mum and sis, reaches the same reader at `version` 4: now there is a
divergence point at index 2, hers has the majority, his does not, and the reader switches back to A3. That is
the arm of rule 4 that works *for* the reader, and it is also the honest limit of it: on his hub her
restore may never arrive. Withholding is the move no rule in §3.4 answers, and that is an inherent limit of the protocol.

**One bar, a majority.** The recovery list is three people and the ex is one of them. He vouches
for himself. Alice, meanwhile, has done nothing dramatic — she rotated her key, alone, as anybody
does when they get a new phone. The example stages his move twice against the same list: as a fork
at the divergence point, and as an *extension* — he appends a self-vouched restore A3 → his key to the chain
the reader already holds, so there is no divergence and rule 4 never runs. Both read `contested: the chain
of key changes does not hold`, because §3.3 makes a restore valid only when **more than half** of
the list vouches, and one of three is not more than half. That is why the spec has no separate
threshold for a restore: any lower bar would be a second door into the identity — one the contest
rule never watches, since a chain that extends the checkpoint is never contested. The majority is the one
bar, for a link's validity and for a contest alike.

**The price, and the repair.** The majority rule is not free, and the spec says so where the rule is
stated. On a list of two, a restore mum vouched alone is one of two — not more than half — so the
link does not hold and a checkpointed reader reads `contested`. Alice needs a second member, and until she
gets one she cannot come back.

What the single link shape (§3.3) buys is that she does not pay that price twice. Vouchers MAY be
added to a link **after it was made**, so sis signs the same `A2 -> A3` move Alice already made,
Alice republishes at a higher `version`, and the chain is unchanged key for key: A3 still signs, and
the post A3 signed before any of this still verifies. The ex rotating her old key against that link
now reads `tampered`. Without that, her only move would be to restore *again* to a fresh key, abandoning
A3 and every post it signed.

**Two limits, and the only exit.** A cold reader's recovery list is whatever the first profile it
saw carried. The example runs a reader with no checkpoint against the ex's branch: it follows him, adopts
his list of one, and thereafter rejects Alice's real profile outright — *the real Alice is the one
it turns away*. Nothing in the protocol repairs that, and an app MUST NOT hide it . The
second limit is quieter: a list change reaches other readers only through a new chain length, so
Alice adding her brother at the same chain length changes nothing for a checkpointed reader until she
rotates and the profile carries the new list at the new length — which is why §3.3 asks an app to
rotate when the list changes.

The exit is §3.7, and it runs through a person: somebody hands the reader the key the owner's chain
**currently ends on**, by link or by spoken code, and the reader MUST follow the branch whose chain
contains that key. Alice's chain contains A3; his does not. The example checks only that — which
chain contains the key — because `src/reader.js` has no current-key path yet. See
`examples/identity/` for the two routes. There is no other way out of a contest, and the design
says so rather than inventing one.

## Moving

**Spec:** §3.5 locations, §5.4 `target.location` for the mechanism, the threat model for the limit.
**Run:** `node examples/contests/contests.js`

Your identity is your anchor key (§3), so a location is only where the files happen to sit. Moving
is therefore not an identity event: you write the same signed files somewhere else and publish a
profile with a higher `version` naming the new place. Nothing has to be signed by the old hub,
asked of it, or served from it — which matters, because the hub you are leaving is often the one
this protocol is built against.

What that buys is exact, and worth stating in both directions. **Identity survives the move without
anyone's cooperation; reach survives only through people who reply to you.** A reader that holds a
location you no longer answer at, and has no social path to you, is not reached. the protocol states this limit plainly
rather than papering over it.

### What the output shows

**Where she is hosted changed; who she is did not.** alice is on `pence.family`, which becomes
unaffordable (`docs/GOALS.md` scenario 4). She writes her files to `alice.example` and publishes a
profile at `version` 2 naming both places; the anchor key printed under before and after is the same
43 characters, and it signed both files. The posts she carried across are the *same bytes* she
signed (§2.3), so post 1 keeps its address and the index entry that lists it is unchanged — a
relocation is not a re-publication. The last line of the block is the other half of how people are
told: the §3.7 link, the location with the anchor key in its fragment, which is what "send this to
your people" means (see `identity/`).

**A reader remembers every location a verified profile has ever named.** Three reads with the
remembered set beside each: `pence.family`, then both, then both again — because her `version` 3
names only `alice.example`, and the reader does not forget. That is the MUST in §3.5, and it is what
makes the next block work. The set lives in the reader's checkpoint, which is the reader's own state and
never a wire member.

**The reader who never learns the new location is the honest limit.** `pence.family` goes on serving
the last profile alice wrote there, and can do so forever. sis, whose checkpoint is that profile and who
has no social path to alice, reads `ok`: `version` 1, `highest` 1, one post, no notes. An unmarked page.
Not an error, not a redirect, not a "moved" marker — there is nowhere for a marker to come from that
she would have any reason to believe. The identical bytes read against mum's checkpoint, which has followed
alice, are refused as `identity — an older profile than the one this reader saw`. Only a reader that
has been somewhere else can read the frozen copy as old, which is why `docs/GOALS.md` scenario 1 was
reworded to say exactly that.

**When one location stops answering, the reader tries the others.** The domain finally lapses.
mum's app is still pointed at it, gets a transport failure — **no verdict at all** (§9), not an
accusation about anybody — and tries the other location it remembers. Two lines later she is reading
alice again, against the checkpoint she already held, and no third party was asked anything.

**The address rides along in other people's posts.** sis has no social path to alice until mum
writes a public reply. §5.4 makes all four members of `target` REQUIRED, and `location` is where the
replier last knew that author to live. The fetch trace is the whole mechanism in five lines: sis's
reader tries the location she already holds first (§7.4), finds nothing answering there, then tries
the address in the reply — and comes back holding `version` 3 and `highest` 2. No rumor is raised,
because having followed she can now see the post the reply names.

**A `location` aims a fetch, and only what verifies there moves anybody.** bro's own post names alice at
an address he controls, signed by him and listed in his own index. It verifies, and the reader does
fetch the address it names — once, after the locations it already holds (§7.4). What is served there
is a profile carrying alice's anchor and bro's signature, and the verdict is `identity — the profile
is not signed by the key it ends on`. The checkpoint does not move. What is at the far end still has to
verify under the anchor key the reader learned out of band (§3.7, §7.1); without that check this
would be an open redirect for the whole network. The fetch itself is the price, and §7.4 names it:
following a reply's `location` is both the feature and a beacon, which is why it is bounded to once per
identity per pass. (A reply that does not verify never reaches the rumor step at all — that is §7.4,
and `examples/reading/` stages it.)

**Relocation rides along in public replies only.** The `rel`, the `target` and its `location` of an
encrypted reply are inside the envelope (§6.5; `examples/envelope/` shows the public members are
`number`, `at` and `encrypted` and nothing else), so an encrypted reply moves nobody who was not already
in its audience. That is a real cost of keeping the reply graph off the wire, and §3.5 states it
rather than pretending the mechanism is universal.

