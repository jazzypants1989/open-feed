# What happened to the spec

This started as an IndieWeb-shaped thing: your identity was your URL, you discovered people by
sniffing `<link>` tags, content was JSON Feed with signature extensions, and interactions were POSTed
to an inbox behind OAuth. Private content wasn't even a goal yet. That was 17 KB, and it had zero
RFC 2119 keywords. It was a sketch.

Then attacks started arriving. Each one got a patch, and each patch got a MUST. The URL kept being
the identity, and the patches kept defending it: `kid` rebinding rules, anchor-confirmation fetches,
`_next_update`, a `_recovery_sig` ordering rule, item-carried pins for split-view detection, four
conformance levels. By the time it peaked, the spec was 271 KB with 293 MUSTs, three independent
hash chains, seventeen security items, and a whole new chapter (section 16) that existed purely so
the compare rule had the second observation it needed. The reference implementation was 7,413 lines.
Nobody had built it.

Six people were given the brief cold. All six made identity a key and rejected domain identity.
Three of them independently named their design "Hearth."

That one change — identity is a key you hold, not a URL someone serves — collapsed the spec from
271 KB to 67 KB in a single commit (`6791a91`). URL normalization, percent-encoding, migration
links, `successor`/`predecessor` chains, author binding, `kid` naming, the `feeds[]` array, the
per-feed manifest: all gone. Not because any of them were wrong, but because they were all answering
the question "what happens when your identifier can change or be taken," and that question doesn't
exist when the identifier is a key.

The pattern repeated everywhere: anything whose correctness depended on the hub keeping history got
replaced by the reader keeping state. Gen 2 kept every prior version of the profile and manifest
forever, and a reader walked `prev` links back to its pin. Now the publisher overwrites both files
and the reader remembers a checkpoint.

A second compression brought 67 KB down to 26 KB. The mechanism barely changed — MUSTs only fell
from 98 to 78 — but the prose went: rationale, worked examples, the conformance section, the
security section, both appendices. And the spec stopped being hand-written. `tools/spec.js`
assembles it from `rule()` strings that the runnable examples print after the assertions that prove
them. 58 rules, each machine-checked. 1,338 lines of implementation. 4,400 words.

| | Gen 0 | Gen 1 | Gen 2 | Gen 3 | Gen 4 (now) |
|---|---|---|---|---|---|
| current | pre-repo | 07-23 | 07-23 → 08-24 | 08-21 → 08-25 | 08-25 → |
| bytes | 17 KB | 82 KB | **271 KB** | 67 KB | **26 KB** |
| words | 2,229 | ~13,000 | **41,245** | 10,502 | **4,400** |
| sections | 10 + 2 app. | 10 + app. | **16 + 3 app.** | 13 + 2 app. | **10, none** |
| MUST | 0 | — | **293** | 98 | 78 |
| signed wire objects | 3 | 4 | **6** | 3 | 3 (+1 unsigned) |
| hash chains on the wire | 0 | 1 | **3** | 1 | 1 |
| reference impl. | none | none | **7,413 lines** | ~2,100 | **1,338** |
| machine-checked rules | — | — | — | — | **58** |

---

## What kept coming back

Some things got cut, came back, got cut again. Worth knowing about because they'll look tempting
again.

**Contests and first contact** were both retired in the redesign as unnecessary complexity. The spec
reinstated both: two branches of a chain need a tiebreak, and without first contact nothing stops a
hub from introducing an identity it also publishes.

**Item-carried pins** were retired, brought back as a split-view detector, and dropped for good.
As specified, they were a forgery vector — any replier could make an honest hub read as withholding.

**`prev`** was added to both overwritten files (profile and index) and then cut. A field that only
the reader who saw the immediately prior version can check is a field no reader can rely on. A
member nobody reads is a member implementers get wrong.

**`k`** (the author-set recovery threshold) survived three reviews and then fell. A threshold below
a majority is a second door into the identity, and the contest rule never watched it.

**Padding** — dummy audience slots and a 512-byte floor — was wanted by five of six outside models,
adopted as a SHOULD, and cut outright. Hiding the audience size from the hub is not a goal.

**Scheduled posts** were kept, rescued by a `pending` mechanism, and then both were cut. Removing
`pending` removed eighteen spec lines.

**A signed freshness claim** — an index saying when to expect the next one — was Gen 2's
`_next_update`, fell with the redesign, and was priced again against a hub that freezes. It detects
the freeze with no replier at all, and fires identically on a publisher who is merely quiet. Cut,
with the measurement in `test/freeze.test.js`.

**The tiny counter** (`{sequence, top, withdrawn, prev}`, 138 bytes) was chosen over a list, then
reversed for the append-only entries list. The counter can't express an edit.

---

## What the simplifications cost

Four things looked like they might be real losses. Instead of arguing about them, each got a script
that staged the scenario against the adversary from `docs/GOALS.md`. Three turned out to be real defects
and got spec fixes. One turned out to be free.

**A recovery list of one** is not a weak configuration — it's a complete, silent, permanent transfer
of the identity. The person listed mints a restore to their own key, re-signs the index, and every
reader reads `ok` with the note "recently restored" (the same note an honest rescue shows). The
owner can't win it back: §3.4 rule 4 says `signature` is not a vote, and rule 2 keeps the first
recovery list a reader saw at each chain length, so that length stays his permanently. A SHOULD was
the only thing between Grandma and whoever set up her phone. §3.2 now refuses a restore under fewer
than two leaves. `test/scenarios.test.js` stages Grandma's scenario in exactly this arrangement.

**A stale reading key**: §3.6 said "a `read` taken from a profile it verified" and said nothing
about *when*. So a publisher doing everything the spec asked would keep encrypting to a key the
owner had replaced, indefinitely, with no signal to either party. The recipient can't read her own
family's messages and can't tell why. §3.6 now names the highest verified version. The
back-catalogue loss stays — rotation is prospective only, nothing re-encrypts, and a restore
doesn't recover the key.

**A hub that freezes**: serving the last index she ever wrote, unchanged, is invisible to a reader
on its own. Cold or checkpointed, first read or hundredth, every rule in §7 passes, because every
rule asks what was *served*, not whether it's *current*. The answer turned out to be §7.4: one reply
from one person the reader also follows, naming a number above the frozen `highest`, and the reader
finds her. The rule now names that job and its precondition.

**The offline archive** turned out not to be a loss at all. Both readers verify a directory of kept
bytes with no hub and no network, and both catch a single flipped byte. §2.1 makes every file
self-checking, §8.9 hands her the files, and the directory is the export bundle Gen 2 spent a
chapter defining. `test/archive.test.js` defends this.

**Still uncosted, by design.** No forward secrecy. No removal from a past audience. No metadata
privacy — who published, when, at what number, who replied to whom, all public. No deletion. No
discovery. No push (latency is polling latency). No moderation layer. The index is one file that
grows by a line per post.

---

## The two open questions, and what staging them cost

**kimi's challenge**, the sharpest thing the outside review produced:

> The chain defends the archive; the push channel defends the person. If forced to choose, the floor
> needs the person. Their error was not refusing the lattice; it was refusing the lattice *and* the
> push channel, leaving nothing.

`test/freeze.test.js` measures it. The freeze is as invisible as feared: cold or checkpointed, a year
or a decade on, both readers return **ok** over February's index with no note at all, because every
rule in §7 asks what was *served* and none of them consults a clock. What breaks it is one reply,
from one person the reader already reads, naming a number above the frozen `highest` — and where she
has moved, the address in that reply carries the reader to her outright, without asking the hub she
left.

Staging it found a defect in the channel itself. The look-again took its address from whichever reply
it met first, so somebody who replied both *before* and *after* a move stranded the reader at the
address they gave first — permanently, since the same reply is met first on every pass. Both readers
had it, independently, from the same wording. §7.4 now names the replier's highest-numbered reply.

The mechanism that would remove the precondition was priced rather than dismissed: a signed freshness
claim in the index, the shape Gen 2 carried as `_next_update`. It works — a lone reader with no
replier anywhere detects the freeze. It also fires identically on Grandma's honest hub when she has
nothing to say for two months, and the only way she clears it is republishing her index on a cadence,
from a device that has to be awake, for no new post. It buys the difference between *quiet* and
*withheld* by making every quiet publisher look withheld. Not adopted.

So the answer to kimi is a number: **one other reader in common**. Below that the freeze is total,
and what is left is exit and first contact (§3.7) — the person rather than the archive, which was his
point. Whether one is a floor or a hope is a judgement about families, not about the protocol.

**glm's root-of-trust gap** — answered, and the answer cost two spec changes:

> Whoever chooses her app — the daughter, or in a worse family, the son-in-law "helping her set it
> up" — is her undeclared root of trust, and the spec is silent about it.

`test/setup.test.js` stages him. §3.2's floor — a list of fewer than two leaves cannot restore —
turned out not to reach him, because the leaf he was given is not the only one he holds: the backup
key §3.3 told the app to make was generated on the phone in his hands. Him plus that key is two of
two. Him, her daughter, and that key is two of three. Both are majorities, both walk the chain to a
key of his, and both read **ok** with the note "recently restored" — the same note an honest rescue
shows. A fourth leaf is the first width that refuses him, because a majority of four is three. So
§3.3 now asks for a backup key beside at least **three** other members instead of one, and a reader
reports the keys that vouched, which the link published anyway.

What does not go away: a leaf is a hash of a salt and a key, and no rule tells two keys of one
person from two people. The honest rescue and the takeover are the same bytes in every respect a
reader checks — `test/setup.test.js` asserts exactly that, side by side. The protocol's whole answer
is the width of the list and the name beside each key, and the app is where that gets asked for.

---

## Decisions ledger

Why each thing is the way it is. Reversing one means answering its reason.

**Identity and keys**

- *Recovery is named-in-advance, not social.* The hostile operator **is** a peer the mother already trusts. Social recovery makes identity viewer-relative: mother and sister disagree about who Alice is, both certain, no warning.
- *The recovery list is salted hashes, revealed only on vouching.* Cleartext lists leak the family.
- *A restore changes the key and nothing else* (§3.2). Converts a permanent takeover into one the owner's people can undo.
- *No revocation.* A rotated-away key keeps its posts valid but can't sign an index (§4.4) or hold a number (§8.5).
- *The recommended list is a backup key beside at least three others* (§3.3). A member holding the backup key and one leaf of their own is a majority of any list of three or fewer, and the backup key is made on a device somebody else may have set up.
- *One key per person, synced between devices.* Per-device keys need a vouching key, and every home for it contradicts something. Caveat: **defensible for families, wrong for journalists.**
- *A separate X25519 reading key.* Deriving from the signing key needs Edwards-to-Montgomery math no standard library exposes.

**The index**

- *The generated feed view is never the index.* Unanimous across all six outside models. A view is something the hub can regenerate; the index must need the author's key.
- *`highest` never decreases* (§4.2). Otherwise withdrawing your newest post turns every reply into a rumor.
- *The index is signed by the key the chain currently ends on* (§4.4). A rotated-away key can't sign an index, and re-signing is what a restore actually restores.
- *Posts are immutable; an edit is a new post that withdraws the old.* In-place editing is indistinguishable from a compromised-key rewrite.
- *The full 32-byte hash, not a 16-byte prefix.* Two widths must be kept in step forever.

**Encryption**

- *The audience list goes inside the ciphertext* (§6.4). Without it, a reply to a family-only post reaches only the original author, and the thread silently splits.
- *The post binding is AAD, not fields compared afterwards* (§6.2). Otherwise a thief lifts her envelope into his own post and her words render under his name.
- *Audience entries are `{key, read, location}`.* Reading keys alone leave a replier with no way to find a profile.

**Publishing**

- *No accounts, tokens, or sessions.* The request is the signed file; claiming a name is first-come with the profile as proof.
- *Serve back the exact bytes.* Pretty-printing, key reordering, or a trailing newline each make every post read as forged.
- *A collision is reclaimed, not refused* (§8.5). Flat refusal lets a griefer lock Alice out with five requests.
- *"Put this file here," not "make your state match mine."* The sync version means a partial-copy device erases the hub.

**Scope**

- *No inbox* (§5.6). A dead-drop inbox was built in ~25 server lines. It costs static file serving.
- *No global resolver.* A resolver is a registry is a central authority.
- *No canonicalization.* The design signs served bytes. §2.4 is what's left of RFC 8785.
- *Three roles, no conformance levels.*
