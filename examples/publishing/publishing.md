# Publishing

§8 of the spec. One script; the prose below is the former publish-interface and your-copy examples.

---

## The publish interface

**Spec:** §8 entire — §8.1 compare-and-swap, §8.2 create-once, §8.3 write order, §8.4 claiming a
name, §8.5 reclaiming a squatted number, §8.6 the same rule for media, §8.7 what a hub MUST do, §8.8
withdrawal. §8.7 is the summary of what a hub must do.
**Run:** `node examples/publishing/publishing.js`

Four signed kinds and the views beside them, two verbs, one conditional header. **There is no account, no token, and no session: the
request is the signed file.** A hub does not know who alice is and is never told; it holds bytes,
compares an entity tag, and — if it accepts writes at all — checks that the profile and index it is
handed hang together under their own keys. Everything else the interface does is arithmetic about
numbers and hashes.

That anyone's client can write to anyone's hub is the point, not an oversight. `docs/GOALS.md` states it
as a decision: *bring-your-own-client is the security property, since a hub that ships the app can
take the key.* The publish interface exists so that clients and hubs are a market rather than a
pairing — which is what makes floor item 3, *the hub cannot keep you*, mean anything. The example
drives `src/hub.js` directly as the pure `(request) → (response)` handler it is; no socket is opened
anywhere in it.

### What the output shows

**The whole interface, on one screen.** The first block is §8's table, and the three requests under
it are a complete signup: `PUT /alice/profile`, a `GET /alice/index` that 404s, `PUT /alice/index`.
Nothing else was sent — no `Authorization`, no cookie, no registration call. The reference publisher
(`src/publish.js`) writes both, because §8.4 makes the empty index part of claiming the name.

**§8.1 — compare-and-swap on the two overwritable files.** Both refusals are shown: a stale tag is
412, and so is a request that carries no `If-Match` at all against a file that exists. The 412 hands
back the tag the hub is now serving, which is how a writer gets a usable one; it never computes a
tag, because the tag is opaque and compared byte for byte. (`src/hub.js` happens to use the SHA-256
of the bytes, which §8.1 permits and no writer may assume.) The views of §10 ride the same rule and
appear in the table for that reason.

**The race, lost twice.** Two devices hold the same tag. The phone writes post 2 and wins; the
laptop writes post 3, loses with a 412, and then does the naive thing — takes the hub's new tag and
re-sends *its own* entries. The result is not an error anywhere. A checkpointed reader says `ok
["withdrawn: 2"]`: post 2 is gone and the loss is **indistinguishable from alice withdrawing it**,
because in the wire format those are the same thing. That is why §8.1's MUST is about re-reading
rather than about retrying. The second run replays the race and replays the new line into what the hub
is serving instead; both posts survive and there is no note at all.

**§8.2 — create-once, and the gap that follows.** The device writes post 4 and crashes before the
index. A reader sees posts 1, 2, 3 and is *indifferent* — a number nobody lists is nothing, so a gap
is not evidence of anything and needs no explanation. When the device comes back it cannot prove it
listed 4, so it abandons it: `PUT /alice/posts/4` → 409, `PUT /alice/posts/5` → 201, and 4 is a
permanent hole. The block then shows what happens if it lists 4 late anyway. The hub stores it — the
hub cannot tell — and the checkpointed reader returns `tampered: post 4 is listed now and was not before`.
**That is the same check that catches a hub backdating a post into someone's history** (§7.1 step 10),
which is why the publisher's rule has to be the strict one: a reader cannot distinguish a sloppy
device from a hostile hub, and it is not asked to.

**§8.3 — the post before the index.** Written the wrong way round, the index lists bytes that are
not there and every reader gets `tampered: post 6 is listed and not served` — an accusation the hub did
not earn. Written the right way round, a reader caught between the two writes sees posts 1, 2, 3, 5
and nothing unusual: an unlisted post is nothing to anybody, so there is no window in which anyone
is wrong.

**§8.4 — claiming a name, and the empty index.** `bro` claims a second name on the same hub with a
profile only, and reads cold as `tampered: no index served` — a brand-new identity accusing a perfectly
honest hub at the moment someone signs up. One empty index fixes it. Then the checks a hub that
accepts writes MUST make: a profile signed by somebody other than the key its chain ends on (403), a
profile whose chain does not walk (403), a different `anchor` claiming a name already held (409), a
profile whose `version` has not advanced (409), and an index not signed by the key the held profile
ends on (403). The entity tag is no part of the
proof — every one of those refusals carried the *correct* tag, read from a public `GET`. The block
closes on the honest case those checks must not break: a real rotation, the old key refused for the
index afterwards, and the index re-signed under the new one.

**§8.5 — reclaiming a squatted number.** The subtlest rule in the chapter, and the reason it is
subtle is that it must repair a denial of service without becoming an overwrite primitive. A
stranger squats 7 and a thief holding a key alice rotated away from squats 8; both land, because a
hub MAY check nothing on the ordinary path. One PUT reclaims each. Then the asymmetry, three ways:
the thief cannot take 8 back, cannot overwrite post 1, and alice cannot overwrite post 1 either. The
pair to compare is post 1 and post 8 — **both signed by the same anchor key, which is still in the
chain**. Post 1 is hers because the index lists it at that number and address; post 8 was nobody's,
because the other half of the rule asks for the key the chain *currently* ends on. If any chain key
counted, a thief who once held one could squat numbers ahead of her and hold them forever.

**§8.6 — the media twin.** The same shape, keyed by hash instead of number. Junk offered at an
address it does not hash to is refused outright; junk that a dumber hub let in is replaced the
moment the real bytes are offered; and the reverse never happens. The last line is worth noticing:
offering the *same* correct bytes a second time is a 409, not a no-op write, because the address is
already held by the file that belongs there.

**§8.7 — the MUSTs, and the ceiling.** Exact bytes back (`examples/files/` owns that
rule and shows what pretty-printing costs), `Access-Control-Allow-Origin: *` on everything publicly
readable, and — for a hub that accepts writes — the `OPTIONS` preflight a browser sends before a
cross-origin `PUT` with `If-Match`, plus `ETag` in `Access-Control-Expose-Headers`, without which a
browser-based publisher cannot read the tag it is required to send. Then the ceiling. The operator
does the worst thing available to him and overwrites her index in his own store: a reader who never
met her gets `tampered`, a reader holding a checkpoint gets `ok` with the note `no index I can verify` and her
posts unchanged. **Whatever a hub does, it can never write as you, because it cannot make your
signature. The worst it can do is refuse you or delete things** — and a hub MAY require a pass, an
account, a rate limit or a bill on top, which changes nothing about that ceiling.

**§8.8 — withdrawal.** There is no DELETE verb (405), an author cannot overwrite her own post, and
withdrawing post 2 removes a line from the index while the bytes stay exactly where they were. A hub
MAY then drop what the current index does not list, after a grace window long enough to cover §8.3's
write order — here that collects the withdrawn post, the burned number, and the two reclaimed files,
and the reader is unmoved. The note the checkpointed reader prints is `withdrawn: 2`, the same note the
lost race produced in §8.1. **An app MUST NOT tell a user that withdrawing erased anything**:
everyone who already read post 2 still holds it, and no rule in this protocol reaches into their
copy. `examples/the-index/` is where that argument lives.

## Your copy

**Spec:** §8.9; the threat model for the adversary, §8 for what leaving costs, §5.6 for the uncomfortable half.
**Run:** `node examples/publishing/publishing.js`

**An app MUST keep the signed bytes of everything it publishes.** Not the text, not a database row —
the bytes, with the signature line on the end. That is the whole of §8.9, and everything else in the
section is a consequence of it: those bytes verify with no hub in reach, the people you published
to hold a copy of whatever they were shown, your own last index says how much there was, and leaving
is writing the same files somewhere else.

This is the example the threat model is for. The hub operator in `docs/GOALS.md` is a loved one who is an
abuser: he controls the serving path, he will not cooperate, and no confidentiality mechanism
defeats him for anything he was an audience of. The protocol's answer to him is **exit** — floor
item 3, *the hub cannot keep you* — and exit is not a feature that gets built later. It is what the
copy already is.

### What the output shows

**A copy is bytes, not rows.** The publisher's copy after five posts is a map from path to bytes:
`/profile`, `/index`, `/posts/1` … `/posts/5`, and nothing else. `/posts/1` is printed whole — the
body, then the `\n`, then the 86-character signature — and it is `test-vectors.md`.6 verbatim. Then the
same post kept the way an ordinary application would keep it, as three columns in a table, and
re-serialized from those columns on the way out: every field present, every value right, alice's own
signature line on the end, and it **does not verify**. Nothing was lost; the member order changed,
because a row has columns and no order. Re-serializing in the order it was written would have
verified *on this machine, today, with this serializer* — which is the trap `files/`
is about. §2.3 signs the bytes that were served, so the only copy that is worth anything is a copy
of the bytes.

**Those bytes verify with no hub in reach.** Three hostile hubs, which are three faces of the same
person: one that is gone (`tampered: no profile served`), one that refuses the connection (**no verdict
at all** — §9 is explicit that a read that did not complete is not an accusation), and one that
lies, serving post 1's bytes at post 3 (`tampered: post 3 is not what the index lists`). Then the copy
on her phone, checked against her anchor key with **no fetcher at all**: the profile is signed by
the key the chain ends on, the index verifies and replays, and each post's address is the line the
index carries. There is no export format here and no bundle to define — the file on the wire already
*is* the archive format. `docs/GOALS.md` retired the export bundle in one clause: *you always had the
copy*.

**Anyone you published to is a backup nobody set up on purpose.** Mum's reader is an ordinary reader
with one extra line: it keeps every byte it was served. She hands five files back and all five
verify under alice's anchor key — nothing about them depended on which hub they came from, so
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
because the current index does not list it, and a withdrawn post is not owed a place back (§4.1).
When the hub, unasked, offers post 1's bytes as post 5, they are **refused** on the hash — a backup
you did not set up is also a backup you do not have to trust.

Two are still missing, and the honest line is what the index *cannot* say: it gives the number and
the address and nothing about who saw them, because an encrypted post's audience is inside the
envelope (§6.4). So she asks a named person for a named list — sis, for posts 4 and 5, not "send me
everything you have" — and the rebuilt copy is then read by an ordinary reader over a `Map` with no
network: `ok`, posts 1, 3, 4, 5.

**Leaving is writing the same files somewhere else.** The posts and the index go to the new hub byte
for byte, in the order §8.3 requires: same bytes, same addresses, same signatures, `201` and `200`.
Exactly one file is re-signed, and only to name the new location (§3.5) — the profile. The old hub
was asked for nothing and had nothing to refuse, which is the sentence §8.9 ends on. Mum's checkpoint from
the old hub, pointed at the new one, reads `ok` with the note `withdrawn: 2`: same anchor key, same
identity, no re-introduction. How a reader who was *never told* finds her at all is a different
mechanism and belongs to `contests/`.

**Where §8.9 meets the threat model, said plainly.** Post 3 was family-only and the operator is family, so his
reading key is in its audience. He opens it from bytes he already holds, with no hub involved, and
her leaving changes that not at all. A key that was never in the audience gets `null`; sis, who was
in it, reads the message. **Encryption chose who; it cannot un-choose them, and a withdrawal does
not reach a copy.** §5.6 says the same thing from the other side: a private message is provable by
its recipient forever. The answer to that operator is exit, not secrecy — and the spec makes it a MUST
NOT to market it as anything else.

One limit of the rebuild: for an encrypted post the index gives the number and the address but not
the audience, which is inside the envelope (§6.4). The app knows which numbers it lacks and not whom
to ask — which is why §8.9's first rule is about the bytes, not the index.

