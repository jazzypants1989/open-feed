# Rulings — the owner's decisions on the outside review

Kept as we walk `outside/SYNTHESIS.md` decision by decision, 2026-08-20. When the walk finishes
these fold into `GOALS.md`; until then this is the record so nothing is lost mid-conversation.

## 1. First contact — how a reader learns your key the first time

**Ruled: the link carries the key, and a short spoken code exists alongside it.**

A hostile host serving a substituted profile is not detectable from inside the file — the stamp is
made by the key printed in it and the host chose both (`decisions/firstcontact-exp.js`). Only a key
learned by a route the host does not control turns it into a refusal. So:

- the "send this link to your people" link carries the key; a reader's app compares and refuses on
  a mismatch. A scanned square at the dinner table is the same thing.
- a short spoken code (five syllables standing in for the key) is available for the phone call, and
  is also what a person is shown when two versions of an identity turn up.

Does not cover: readers who arrive by any other route — they are back to accepting the first key
they see, which is what the notes already concede about strangers. "Users never see a key" survives:
a link is not a key and three words are not a key.

## 2. The local copy — CLOSED (see the note at the end of this section)

**Ruled: the family fallback gets written down.** A post is stamped once and the stamp travels with
the bytes, so anyone holding your posts can hand them back and they still verify as yours. Your
readers are a backup nobody set up on purpose (`decisions/localcopy-exp.js`). It covers only what
they were allowed to see and proves nothing about completeness — a fallback, not a guarantee.

**Held open: whether an app MUST retain what it publishes (one sentence), or whether publishing is
defined as syncing a local store up (structural).** The structural version was priced and is worse
than it looks — a device with a partial copy erases the host and the loss reads to every reader as
the host censoring; thin clients cannot publish at all; handing over a post to be released later
stops making sense; and "make your state match mine" is a far larger interface than "put this file
here" (`decisions/sync-exp.js`). Revisit once the writing/devices/index cluster is settled.

**Closed after rulings 3-5.** The structural option is dead by construction: publishing was defined
as *put this numbered file here*, which is a different verb from *make your state match mine*, and
you cannot have both. So the ruling is the one sentence — **an app MUST keep the stamped bytes of
everything it publishes; the host's copy is a copy of yours, not the other way round.**

The old objection to it was "a rule nobody can check." The 138-byte index answers that, in a way
that was not visible when the option was first put up (`decisions/rebuild-exp.js`): Alice arrives at
a new host with her key and her index, her family hands back what they kept, every post still
verifies — and her own stamped index tells her exactly which numbers are still missing, so she can
ask a named relative for a named list instead of hoping. The same arithmetic gives her app a
readout ("holding 1,204 of your 1,557 posts") and gives the next app she installs something to check
on import. That is a rule with a readout, not an unenforceable rule.

Floor item 3 now has three independent paths to the archive — the retention rule, the index, and the
family fallback — and none of them needs the host's cooperation. The export mechanism needed exactly
that, which is why it stays deleted.

## 3. Naming on the host — entailed by ruling 4

**Ruled: a number that goes up.** `/alice/posts/7`; a new post is always a new file; the host
refuses a write to a number that exists, and the losing app retries with the next one. This kills
silent overwriting (`decisions/writing-exp.js`) and keeps addresses a plain feed reader can walk.

**Two habits ride along, both free:**
- **Every post declares its own number inside its stamped bytes.** This is what catches a host
  serving genuine post #2 at the name #7, and it is what makes a pretty alias over a
  fingerprint-named object safe: the reader checks what came back, not where it came from.
- **A number is only used up by a write that landed.** Numbering must be gapless or the index
  false-accuses the host over an abandoned draft.

Fingerprint names are still expected for photos and attachments, which are not numbered and are big.

**Still open in this decision:** how the host knows it is you (no accounts and it checks your stamp
against your own profile file / a temporary pass / the host's own business), and whether the host
checks stamps at all before storing.

**Two sentences the spec owes regardless:** the host MUST serve back the exact bytes it was given —
pretty-printing, sorting keys, or adding a trailing newline each make every post read as forged, and
all three are things ordinary servers do unasked — and it MUST let a page on another site read its
files, or no browser-based reader can read across hosts.

## 4. The index — the small stamped thing a reader pins

**Ruled: the tiny counter.** `{sequence, highest number, withdrawn list, hash of the previous
index}` — about 138 bytes, against 6.8 KB for a list of names and 33 KB for names plus fingerprints,
after ten years at three posts a week (`decisions/index-exp.js`).

It matches both larger shapes on every attack tried: a quietly dropped post, a post served under
another's name, a post smuggled in under a key stolen from Alice last year, and a replayed older
index. The smuggling defence is free and comes from the naming rather than the index — every number
at or below the declared top is taken and cannot be written over, and anything above it is above
what the author declared.

**Hard rule, unanimous across all six outside models:** the generated feed view is never the index.
A view is something the host can regenerate; the index must be producible only by the author's key.

**Consequence for the next decision:** two writes per post, and the index is the one file that is
legitimately overwritten, so two devices can clobber each other on it. `gates/writer-gate.md`
already tested the fix — the host refuses the write if the index moved underneath, and the loser
re-reads and retries.

## 5. Two devices

**Ruled: one key, copied between devices by the app** — scanned from phone to laptop, or synced by
the platform keychain. Written down as a decision, with the caveat one outside model attached: this
is defensible for families and wrong for journalists, and it is the first thing to revisit if the
audience widens. Losing a device therefore lands on the recovery mechanism, which has to exist anyway.

Rejected: a key per device vouched for by an identity key. Better on phone loss — revoke one device
and the name, key and followers are all unchanged — but the vouching key cannot live on either
device, and every home for it contradicts something already decided. At the host, the host can vouch
for a device of its own and post as her; on paper in a drawer, it is the file Grandma was promised
she would never be told to keep.

**Taken regardless of that choice, because it bites with one device too** (a phone plus a
scheduled-post job is already two writers): **the host refuses an index write if the index moved
since the writer read it**, and the loser re-reads and retries. Without it the two devices do not
lose a post — "refuse a number that is taken" already covers that — they lose the *index*, and a
post above the declared top reads to every reader as something the host smuggled in
(`decisions/devices-exp.js`). Same finding as `gates/writer-gate.md`.

## 3 (continued). How the host knows it is you, and whether it checks

**Ruled: describe the no-accounts version, and let a host require more on top.** The file arrives
stamped; the host checks it against the key in the profile file at that path; claiming a name is
first-come with the profile as the proof. Nothing to sign up for, no password, no host-held secret —
which is Grandma's scenario almost verbatim. A host that wants a temporary-pass handshake or an
account for rate-limiting and billing may have one; that is the market, not the protocol.

**Ruled: the host MAY check stamps before storing.** Readers check regardless, so this is disk
hygiene, not a floor question. It is worth noticing that *none* of these choices affects the floor:
whatever the host does, it can never write as you, because it cannot make your stamp. The worst any
of them permits is refusing you or deleting things, which the host can do anyway.

## 6. Getting back in after losing your key

**Ruled, in four parts.**

**Who may vouch: whatever the person names, and the list may be empty.** The requirement is
*named in advance*, not *social* — which matters, because the population this protocol exists for
includes people with no family left to name (`decisions/recovery2-exp.js`). A list may hold people,
or a key the owner keeps themselves (a printed code, a passkey, a password manager), or their host,
or nothing at all. The reader does the same membership check in every case; "no recovery" is the
empty list, so the loner costs no extra machinery and lands exactly where the notes already put key
backup — app-level, spec mandates none.

Rejected: **"enough peers a reader already trusts,"** which fails in both directions at once
(`decisions/recovery-exp.js`). It lets the ex in — he *is* a peer the mother already trusts, that
being the entire meaning of the phrase — and it keeps the real owner out, since two honest vouchers
do not reach a bar the ex clears with three captured ones. And it fails silently: mother and sister
end up disagreeing about who Alice is, both certain, no warning, **identical bytes on both phones**.
Nothing in the design looks for that, because every split-detection idea assumes the two sides hold
different bytes. This one is a disagreement about a rule.

**The list is committed as a fingerprint,** revealed only when a restore happens. That is open
question 3 — *is a reader's trust set ever published?* — answered with a mechanism rather than a
policy. Today's spec publishes recovery keys in the clear.

**A restore may change the key and nothing else** — not the location, not the list of who may vouch
next, not the display name. One sentence, and it converts a permanent takeover into one the owner's
own people can undo.

**Two paths, and only the second one waits:**
- *Proving it yourself* — signing with a key you kept — is direct proof. Immediate, nobody asked.
- *Being vouched for* — **back at once, flagged "recently restored" for 7 days.** The owner can post
  and read the same afternoon; if the restore is a fake, the real owner still holds their key, is
  not recovering but being attacked, and objects during the week, at which point it never settles.
  After the week the flag clears but a permanent "restored on this date, vouched by these keys" note
  remains, and objections never expire.

An earlier pass dismissed the waiting period as only helping someone who still holds their key. That
is true and backwards: the person who still holds their key is precisely the *victim* of a fake
restore. A wait protects everyone who is **not** recovering from having a recovery declared for them.

**Carried along regardless:** the *reading* key must travel in whatever backup an app makes. Two
keys do two jobs — one stamps what you write, one unlocks what others sealed to you — and all of the
above concerns only the first. Without the second, "Grandma is back" means back with an unreadable
history that nobody alive can open.

**Noted for later:** this adds a reader state ("recently restored"). A couple of the remaining
decisions also want reader states, and one outside model argued that accumulating them is the
project's characteristic mistake. Keep a running count.

## 7. The frozen copy

**Ruled: the current address rides along in other people's posts.** When someone replies to you,
their reply carries your address as they currently know it, and a reader who sees a newer address
in any post it has verified follows it. So a cousin with any social path to the departing person
finds her, and the cost is a field in a reply that has to exist anyway plus one reader rule. It
falls out of the decision already taken that an interaction is a post in its *author's* feed.

**Rejected: the declared next-post deadline** (~26 bytes; the profile promises to post again within
7 days and readers show stale past that). It binds the ex exactly — he cannot sign, only freeze what
she already signed — but it buys the *signal* and not the *way out*, and it costs a new reader state
that the notes had already retired once.

**Consequence to write down honestly:** a reader with no social path to her still sees an unmarked
frozen page. Scenario 1 currently promises that copy "reads as stale, not as her." It does not, for
that reader, and the scenario's wording must be changed to match rather than the other way round
(`decisions/freeze-exp.js`).

## 8. Private one-to-one messages

**Ruled: keep them as they are — an encrypted post with one recipient, living on the sender's own
host.** No dead-drop, no inbox, no push.

The floor holds as written: floor item 2 promises the host cannot *read* what was not meant for it,
and that promise survives intact. What the host gets instead is the shape of the correspondence —
128 files over a year, 1-2 KB each, each fetched once by the same address, with a visible change of
rhythm in week 34 — and the ability to withhold any of them, which to the recipient looks like the
sender going quiet (`decisions/dm-metadata-exp.js`).

The exit message itself is not what this rides on: she has a phone, and the notes already answer
that case with "send this link to your people." What is being accepted is the year of ordinary
private conversation before it.

Rejected: the dead-drop box (a capped, token-gated write to a directory on the recipient's host —
demonstrated over real HTTP in `decisions/deaddrop-exp.js`, ~25 server lines, the ex's access log
empty). It works, and it costs the recipient the ability to be a plain static file server. Also
rejected: a narrow push channel (~1,000 words) and a full inbox (~2,000).

## 9. Encryption tidy-ups

**Taken as a bug fix, not a choice: the audience list goes inside the sealed bytes.** Without it a
reply to a family-only post reaches the original author and nobody else, silently — the replier's
app knows only the author's key, because that is the one thing the carrier binding names. The rest
of the family never see the reply and are never told it exists, so the thread splits in half with no
error anywhere. `src/enc.js` already does this correctly (§15.2.2); the risk is only that a rewrite
drops it, since the notes say "names sealed inside" without saying whose names or that readers get
them (`decisions/audience-exp.js`). Second, smaller gotcha from the same run: an app must seal to
*itself* or it cannot read its own outbox.

**Ruled: pad the recipient count to the next power of two, as a SHOULD.** ~130 bytes per junk slot,
~390 bytes on a family of five, turning "exactly 5 recipients" into "between 5 and 8". A SHOULD
rather than a MUST so a minimal implementation stays conformant, which is the weekend-implementation
goal. Five of the six outside models wanted this; one argued against on the grounds that the family
adversary already knows roughly how big the family is.

**Settled by priority 1, not really a choice: keep a separate key for reading.** Deriving the
reading key from the stamping key means hand-written Edwards-to-Montgomery field arithmetic, which
no mainstream standard library exposes.

**Still commissioned:** the evaluation of the envelope construction itself. Scope it to "the current
envelope versus an HPKE-shaped one, with test vectors" and stop there — two outside models
independently said the library is not the question, only the construction shape.

## 10. Scheduled posts

**Ruled: the pre-stamped post carries the time it is meant to appear.** One sentence. A host
releasing it early is then visible to every reader; holding it back is ordinary withholding, which
the index already catches; releasing one after the author has left is bounded the same way. Keeps
the feature and makes the abuse visible rather than removing the surface.

Rejected: dropping host release (costs the feature to anyone whose phone is off), and building
"still here" heartbeats on top of it — that reopens ruling 7's declined deadline in a more
expensive form.

## 11. The fresh-start review — rulings of 2026-08-21

Walked `REVIEW-fresh-start.md` with the owner, one question at a time, after a skeptical read and a
second agent's attempt to refute that read. Each ruling names the experiment that backs it; the
four new ones in `decisions/` were built after the rulings to check the ones that rest on a number.

**1. The carried pin is dropped; a reply's own target is the rumor.** A reply already names what it
answers — the author's key, the post's number, its fingerprint — and that is the whole signal: a
reader that sees a reply to a number *above the top* of the head it holds for that author
re-fetches, and if the host still will not show it, says "X replied to something I can't see,"
naming X. Never an accusation. A missing number at or below the top is a withdrawal, because the
host cannot edit a signed head, so replies to withdrawn or superseded posts say nothing
(`decisions/targetrumor-exp.js`: strategy for strategy the target catches what the pin caught,
the edit stays quiet, the forgery names its forger). The pin a *reader* keeps of heads it verified
itself stays; the glossary term narrows to that. The "author echo" is moot. TLDR sentence to
become "…cannot show two people different histories once one of them replies to something the
other can't see." Answers `gates/splitview-gate.md`'s forgery finding by removing the surface.

**2. The head's shape — OPEN, the owner's call after `decisions/headage-exp.js`.** The review's
"collapse at 5%" reproduces only with both of its assumptions (edits anywhere in ten years; a
reader re-downloading whenever anything was touched). Fixing them does **not** rescue the flat
list at journal scale: 14% of always-full when edits land within the hour, 65% at a one-day
half-life, 75% at a week — one withdrawal of yesterday's post per day spoils most tails. What
does hold is the **append-only head**: a withdrawal is an appended `[n, null]` line and the author
rewrites the file occasionally; 0.01 TB/year at journal scale against 17.7 TB, 0.59 TB compacting
monthly (so a withdrawn post's line lives at most a month). The owner accepted a temporary trace
in advance. 16-byte fingerprints halve every column. At family scale every shape is noise; the
paged head is never needed. Recommendation: append-only with monthly compaction.

**3. A contest is settled by a majority of the recovery list as it stood at the split.** Only a
reader that pinned the pre-fork profile — or can ask one who did — can run that rule; a cold
reader shows "contested" (`decisions/forkcold-exp.js`: from cold the two branches disagree about
the list; walking history does not help because the thief holding the key re-signs it back to the
version he likes; the pinned reader names Alice). One sentence in the spec. An objection is the
owner's next profile version wherever she can write, found by the social path. The seven-day flag
stays as UX. Rejected fallbacks for an empty list: the host's order (the adversary decides), lower
fingerprint (re-sign until you win), timestamps (a clock deciding a security question), and
"whoever still holds the key wins" (under ruling 5 a stolen phone means the thief holds it, and he
would veto the real restore). **The empty-list answer is a default, not a rule:** an app SHOULD
name at least one recoverer, and the owner's own backup key counts; whoever declines has no court,
stated plainly.

**4. Recovery secrets are per member** (each voucher reveals only their own; `gates/salt-custody-gate.md`).
Majority needs the list's size, which the leaf array makes public. **The reading key is not
socially recoverable:** a restore returns the name; what was sealed to you was mostly also sealed
to others, who can re-seal it to your new key; what was sealed to you alone is gone unless your app
backed it up. One sentence. (Escrow at one voucher would let a listed ex read everything.)

**5. Scheduled posts stay, as "pending."** The device lists the post as pending; a reader never
convicts a pending entry on its own clock; it becomes ordinary when the device next publishes a
head listing it plainly, and only then can withholding be called (`decisions/scheduled5-exp.js`:
passes all four of `gates/scheduled-gate.md`'s columns). Stated cost: a host sitting on a scheduled
post is uncalled until the author next publishes, and never if she never does.

**6. An edit is a new number that withdraws the old one**; `supersedes` is a relation type beside
`reply`/`quote`, not a field. **The head lists photos** (~55 bytes each) so retention is one rule
and reaches sealed posts, whose references the host cannot read. **The contact list is the app's**,
not on the wire: each use carries its own copy, and after phone loss it is rebuilt from what the
family re-seals back and who vouched.

**7. Two sentences the signing format owes**, both MUSTs: the signature line is exactly 86
base64url characters that re-encode to themselves; a file's address is the hash of its *body* —
because some standard libraries randomize Ed25519 signatures, so two honest signers of the same
bytes produce different files. **JSON hygiene:** a producer MUST NOT emit duplicate members,
`__proto__`, integers past 2^53, or lone surrogates; a reader SHOULD reject them. Only the author
can sign, so the only exploiter is an author confusing her own readers.

**8. A signed private message is provable by its recipient forever**, withdrawn or not. Stated
plainly as a consequence of per-post signatures; for the driving scenario it is mostly evidence in
the victim's hands.

**9. Reversals, in the owner's name** (`rejections.md` §11–13): the tiny counter → the list, on
correctness; ruling 10's mechanism → "pending." Item-carried pins are *not* re-adopted (ruling 1).

**Still open after this walk:** the spoken code's bits; the NIP-44 evaluation and the padding
floor; time discipline as a written list; the reader-state count; and ruling 2 above. Numbering
stays load-bearing: ruling 3's create-once rule and ruling 1's "above the top" both depend on it.
