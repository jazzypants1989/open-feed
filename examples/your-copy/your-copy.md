# Your copy

**Spec:** §10; §13.1 for the adversary, §8 for what leaving costs, §5.6 for the uncomfortable half.
**Run:** `node examples/your-copy/your-copy.js`

**An app MUST keep the signed bytes of everything it publishes.** Not the text, not a database row —
the bytes, with the signature line on the end. That is the whole of §10, and everything else in the
section is a consequence of it: those bytes verify with no host in reach, the people you published
to hold a copy of whatever they were shown, your own last index says how much there was, and leaving
is writing the same files somewhere else.

This is the example the threat model is for. The hub operator in `GOALS.md` is a loved one who is an
abuser: he controls the serving path, he will not cooperate, and no confidentiality mechanism
defeats him for anything he was an audience of. The protocol's answer to him is **exit** — floor
item 3, *the host cannot keep you* — and exit is not a feature that gets built later. It is what the
copy already is.

## What the output shows

**A copy is bytes, not rows.** The publisher's copy after five posts is a map from path to bytes:
`/profile`, `/index`, `/posts/1` … `/posts/5`, and nothing else. `/posts/1` is printed whole — the
body, then the `\n`, then the 86-character signature — and it is Appendix B.6 verbatim. Then the
same post kept the way an ordinary application would keep it, as three columns in a table, and
re-serialized from those columns on the way out: every field present, every value right, alice's own
signature line on the end, and it **does not verify**. Nothing was lost; the member order changed,
because a row has columns and no order. Re-serializing in the order it was written would have
verified *on this machine, today, with this serializer* — which is the trap `no-canonicalization/`
is about. §2.3 signs the bytes that were served, so the only copy that is worth anything is a copy
of the bytes.

**Those bytes verify with no host in reach.** Three hostile hubs, which are three faces of the same
person: one that is gone (`host: no profile served`), one that refuses the connection (**no verdict
at all** — §9 is explicit that a read that did not complete is not an accusation), and one that
lies, serving post 1's bytes at post 3 (`host: post 3 is not what the index lists`). Then the copy
on her phone, checked against her anchor key with **no fetcher at all**: the profile is signed by
the key the chain ends on, the index verifies and folds, and each post's address is the line the
index carries. There is no export format here and no bundle to define — the file on the wire already
*is* the archive format. `GOALS.md` retired the export bundle in one clause: *you always had the
copy*.

**Anyone you published to is a backup nobody set up on purpose.** Mum's reader is an ordinary reader
with one extra line: it keeps every byte it was served. She hands five files back and all five
verify under alice's anchor key — nothing about them depended on which host they came from, so
nothing about them breaks when a different party returns them. The output then states the limit
exactly, because this is the part it would be dishonest to oversell. Mum last looked in July: post 4
is a message to sis and mum was never in its audience, post 5 was published after she looked, and
her index is version 4 where alice's last is version 7. **A fallback, not a guarantee.** It covers
what they could see and proves nothing about completeness.

**Your own last index is the table of contents, and this is the block to read.** The phone is gone.
One file came back off the laptop — `/index` — and it is the one that matters, because it is the
signed answer to *what exists now* (§4). The rebuild reads like a screen an application would
actually show: the index says 1, 3, 4, 5 exist and that 2 was withdrawn; nothing is in hand; four
posts are missing. Mum hands back what she kept, and each file gets a verdict against the index
rather than against trust: `/posts/1` and `/posts/3` are **taken** because their addresses are the
lines the index carries; her `/index` is **ignored** as an older version; `/posts/2` is **ignored**
because the current index does not list it, and a withdrawn post is not owed a place back (§4.2).
When the hub, unasked, offers post 1's bytes as post 5, they are **refused** on the hash — a backup
you did not set up is also a backup you do not have to trust.

Two are still missing, and the honest line is what the index *cannot* say: it gives the number and
the address and nothing about who saw them, because an encrypted post's audience is inside the
envelope (§6.5). So she asks a named person for a named list — sis, for posts 4 and 5, not "send me
everything you have" — and the rebuilt copy is then read by an ordinary reader over a `Map` with no
network: `ok`, posts 1, 3, 4, 5.

**Leaving is writing the same files somewhere else.** The posts and the index go to the new hub byte
for byte, in the order §8.3 requires: same bytes, same addresses, same signatures, `201` and `200`.
Exactly one file is re-signed, and only to name the new location (§3.7) — the profile. The old host
was asked for nothing and had nothing to refuse, which is the sentence §10 ends on. Mum's pin from
the old hub, pointed at the new one, reads `ok` with the note `withdrawn: 2`: same anchor key, same
identity, no re-introduction. How a reader who was *never told* finds her at all is a different
mechanism and belongs to `moving/`.

**Where §10 meets §13.1, said plainly.** Post 3 was family-only and the operator is family, so his
reading key is in its audience. He opens it from bytes he already holds, with no host involved, and
her leaving changes that not at all. A key that was never in the audience gets `null`; sis, who was
in it, reads the message. **Encryption chose who; it cannot un-choose them, and a withdrawal does
not reach a copy.** §5.6 says the same thing from the other side: a private message is provable by
its recipient forever. The answer to that operator is exit, not secrecy — and §13.1 makes it a MUST
NOT to market it as anything else.

## Contrast

**Why "keep the bytes" is a protocol rule and not app advice.** This is the payoff of a decision
made three chapters earlier. Because §2.3 signs the bytes that were *served*, the wire format and
the archive format are the same object, and §10 can be one paragraph with no schema in it. A
protocol that signs a canonicalization instead cannot do that: the thing you hold is a
reconstruction, so the spec has to define an export bundle, give it a version, say what goes in it
and in what order, and then define a migration path for when that changes. §12 makes "keep the bytes
it publishes" a publisher MUST for the same reason it makes "serve back the exact bytes" a hub MUST
(§8.7) — the two rules are one rule seen from either end, and dropping either turns every file into
a file signed by nobody.

**Everything else in this space is something you ask for.** GDPR Article 20 gives a right to data
portability, which is a right exercised *against* a controller, with a regulator behind it if the
controller stalls; the adversary here is a family member on a home server who will not answer either
one. Mastodon has a real account archive — Settings, request, wait, download a tar of ActivityPub
JSON — and it is generated by the server, rate-limited by the server, and unavailable when the
server is down or unwilling. ActivityPub's `Move` activity forwards followers and moves no posts,
and it needs the origin server to emit it. Twitter/X's data download is the same shape without the
good faith: a request, a delay, a ZIP of unsigned JSON that proves nothing about who wrote it. Every
one of these is a favour with a form attached. Open Feed's claim is not that its export is better;
it is that **there is no export**, because the application was holding the published bytes the whole
time, and the bytes are self-proving.

**Bluesky and the AT Protocol are the closest relative, and get the important half right.** An
account's repository is a signed commit over a Merkle search tree, so its contents are verifiable
independently of the server that stores them, `com.atproto.sync.getRepo` hands the whole thing back
as a CAR file, and account migration between PDSes is a documented, working operation rather than a
promise (its guide says the mechanisms are not a formal part of the protocol, and the easy path
assumes both PDSes cooperate). That is genuinely the same insight: sign the data, not the
connection. Two differences are
worth naming rather than glossing. First, the CAR file is a *second* format — the repository is
DAG-CBOR in a CAR container, the API you read is JSON, so there is still an archive format distinct
from the wire format, and there is still a request (`getRepo`) that a host can be slow about or
refuse. Second, portability of the data is not portability of the name: a `did:plc` identity
resolves through a directory, which is an operated service, so the identity layer has a party in it
even when the data layer does not. Open Feed's identity is the anchor key itself and its continuity
is social (§3.3, §3.4) precisely so that there is nobody left to ask. The trade is real and runs
both ways: Bluesky's tree gives efficient sync and proofs of absence that this design's flat index
does not, and it pays for that in machinery the weekend implementer of `GOALS.md` priority 2 does
not have.

**The uncomfortable half.** Readers hold what they saw, forever, and that cuts both ways. The same
property that makes mum a backup makes the operator one: he keeps every byte he ever served, he
opens every envelope he was an audience member of, and withdrawing a post reaches the live set and
nothing else (§4.2, §8.8). A signed private message is provable by its recipient (§5.6) — which is
protection when the recipient is being disbelieved and exposure when the recipient is the person you
are leaving. There is no version of "signed per post" that gives the first without the second, and
the spec says so where the rule is rather than in a footnote.

**Scenarios.** This is floor item 3, *the host cannot keep you*, and the exit half of scenario 1,
the divorce: he cannot stop her leaving, because the key was generated on her device and the copy
never left it. Scenario 4, *the domain goes*, is the same mechanism with nobody hostile in it — the
files move, the identity does not — and scenario 2, *Grandma onboards*, is the reason the rebuild
block asks a named relative for a named list: the person recovering is not going to reason about
hashes, but her application can, and her own last index tells it exactly what to ask for.
