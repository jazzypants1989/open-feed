# Publishing

§8 of the spec. One script; the prose below is the former publish-interface and your-copy examples.

---

## The publish interface

**Spec:** §8 entire — §8.1 compare-and-swap, §8.2 create-once, §8.3 write order, §8.4 claiming a
name, §8.5 reclaiming a squatted number, §8.6 the same rule for media, §8.7 what a hub MUST do, §8.8
withdrawal. §12's hub paragraph is the summary.
**Run:** `node examples/publish-interface/publish-interface.js`

Four signed kinds and the views beside them, two verbs, one conditional header. **There is no account, no token, and no session: the
request is the signed file.** A hub does not know who alice is and is never told; it holds bytes,
compares an entity tag, and — if it accepts writes at all — checks that the profile and index it is
handed hang together under their own keys. Everything else the interface does is arithmetic about
numbers and hashes.

That anyone's client can write to anyone's hub is the point, not an oversight. `GOALS.md` states it
as a decision: *bring-your-own-client is the security property, since a hub that ships the app can
take the key.* The publish interface exists so that clients and hubs are a market rather than a
pairing — which is what makes floor item 3, *the host cannot keep you*, mean anything. The example
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
of the bytes, which §8.1 permits and no writer may assume.) The views of §11 ride the same rule and
appear in the table for that reason.

**The race, lost twice.** Two devices hold the same tag. The phone writes post 2 and wins; the
laptop writes post 3, loses with a 412, and then does the naive thing — takes the hub's new tag and
re-sends *its own* entries. The result is not an error anywhere. A pinned reader says `ok
["withdrawn: 2"]`: post 2 is gone and the loss is **indistinguishable from alice withdrawing it**,
because in the wire format those are the same thing. That is why §8.1's MUST is about re-reading
rather than about retrying. The second run replays the race and folds the new line into what the hub
is serving instead; both posts survive and there is no note at all.

**§8.2 — create-once, and the gap that follows.** The device writes post 4 and crashes before the
index. A reader sees posts 1, 2, 3 and is *indifferent* — a number nobody lists is nothing, so a gap
is not evidence of anything and needs no explanation. When the device comes back it cannot prove it
listed 4, so it abandons it: `PUT /alice/posts/4` → 409, `PUT /alice/posts/5` → 201, and 4 is a
permanent hole. The block then shows what happens if it lists 4 late anyway. The hub stores it — the
hub cannot tell — and the pinned reader returns `host: post 4 is listed now and was not before`.
**That is the same check that catches a host backdating a post into someone's history** (§7.2),
which is why the publisher's rule has to be the strict one: a reader cannot distinguish a sloppy
device from a hostile host, and it is not asked to.

**§8.3 — the post before the index.** Written the wrong way round, the index lists bytes that are
not there and every reader gets `host: post 6 is listed and not served` — an accusation the host did
not earn. Written the right way round, a reader caught between the two writes sees posts 1, 2, 3, 5
and nothing unusual: an unlisted post is nothing to anybody, so there is no window in which anyone
is wrong.

**§8.4 — claiming a name, and the empty index.** `bro` claims a second name on the same hub with a
profile only, and reads cold as `host: no index served` — a brand-new identity accusing a perfectly
honest host at the moment someone signs up. One empty index fixes it. Then the checks a hub that
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

**§8.7 — the MUSTs, and the ceiling.** Exact bytes back (`examples/no-canonicalization/` owns that
rule and shows what pretty-printing costs), `Access-Control-Allow-Origin: *` on everything publicly
readable, and — for a hub that accepts writes — the `OPTIONS` preflight a browser sends before a
cross-origin `PUT` with `If-Match`, plus `ETag` in `Access-Control-Expose-Headers`, without which a
browser-based publisher cannot read the tag it is required to send. Then the ceiling. The operator
does the worst thing available to him and overwrites her index in his own store: a reader who never
met her gets `host`, a reader holding a pin gets `ok` with the note `no index I can verify` and her
posts unchanged. **Whatever a hub does, it can never write as you, because it cannot make your
signature. The worst it can do is refuse you or delete things** — and a hub MAY require a pass, an
account, a rate limit or a bill on top, which changes nothing about that ceiling.

**§8.8 — withdrawal.** There is no DELETE verb (405), an author cannot overwrite her own post, and
withdrawing post 2 removes a line from the index while the bytes stay exactly where they were. A hub
MAY then drop what the current index does not list, after a grace window long enough to cover §8.3's
write order — here that collects the withdrawn post, the burned number, and the two reclaimed files,
and the reader is unmoved. The note the pinned reader prints is `withdrawn: 2`, the same note the
lost race produced in §8.1. **An app MUST NOT tell a user that withdrawing erased anything**:
everyone who already read post 2 still holds it, and no rule in this protocol reaches into their
copy. `examples/rewrite/` is where that argument lives.

### Contrast

**"The request is the signed file" versus a publishing API.** Micropub, the Mastodon API and AT
Protocol's `com.atproto.repo.*` all put an authorization layer between a client and a repository —
some mix of app registration, an OAuth flow, bearer tokens, scopes, refresh and revocation (IndieAuth
skips the registration, Mastodon's tokens are long-lived, AT Protocol has the whole list). Open Feed
has none of those, and the absence is not a simplification of the same design
— it is a different one. In a token model the server decides what a client may write and can
therefore write it itself; the token proves you asked, not that you meant it. Here the *file* is the
credential: a hub that wants to publish as alice needs her Ed25519 private key, which never leaves
her device. What the hub keeps is the ability to refuse a write, to delete an unlisted file, and to
stop serving — real powers, all of them visible to a reader as `host` or as silence, and none of
them the power to speak as her. Note the cost honestly: there is no revocation of a compromised
client, because there is nothing to revoke. A stolen key is answered by §3.3's chain and §3.4's
recovery list, not by the publish interface.

**Bring-your-own-client as a security property.** The threat model in `CLAUDE.md` — the hub operator
is a family member who is an abuser — makes the app-plus-server product the wrong shape at the root,
because whoever ships the app can ship one that copies the key on first launch. Splitting the two is
not a preference about ecosystems; it is what makes the key's location a fact rather than a promise.
This costs interoperability work that a paired product gets for free, and it is what `GOALS.md`
scenario 6 (a second implementer writes a publisher and a reader from the text, a third writes a
dumb hub that serves both) is a test of.

**Compare-and-swap over HTTP.** `If-Match` and `ETag` are HTTP/1.1's conditional requests (RFC 2068,
1997; then RFC 2616, now RFC 9110) doing exactly the job they were specified for. The design uses them rather than
inventing a version field on the wire, and buys two things: nothing new to learn, and a serving path
that an ordinary static host already implements. Where it is thin: conditional `PUT` is far less
widely implemented than conditional `GET`, and several popular object stores have only recently
grown it; intermediaries and CDNs have historically felt free to rewrite or weaken `ETag`; and the
tag covers one file, so there is no transaction spanning the post write and the index write — §8.3's
ordering rule is what stands in for one. The index does carry a `version`, but it is the reader's
freshness check (§7.2), not the writer's lock; the lock is the tag, and the tag is the hub's.

**Squatting and create-once.** The lesson generalises past this protocol: an unchecked
create-once write is a permanent denial of service waiting for someone bored enough to issue it, and
the repair has to be *asymmetric* or it stops being a repair. Symmetric "last writer wins" would let
the squatter take the number straight back; symmetric "the owner may always overwrite" would hand
the owner an edit primitive the rest of the design spends §4.2 and §5 refusing to grant. §8.5
threads it by defining "the owner's file" from evidence the hub can check without knowing anybody:
the number declared inside the signed bytes, plus either the current chain key's signature or the
index's own listing at that number and address.

**Static hosting is a conforming hub.** §12 says so in as many words: serve exact bytes, allow
cross-origin reads, hold no user's signing key. A bucket behind a CDN clears that bar, which means
the cheapest possible deployment already delivers the read side of the floor, and everything in §8.1
through §8.6 is the additional bar for a hub that accepts writes. That split is what keeps
`GOALS.md` scenario 5 (ten thousand people on one commercial hub, the operator being the ex at
scale) from turning into a fight about the operator's software: per-identity cost stays flat, and
every floor item is enforced at the reader.

---

## Your copy

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

### What the output shows

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
envelope (§6.4). So she asks a named person for a named list — sis, for posts 4 and 5, not "send me
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

One limit of the rebuild: for an encrypted post the index gives the number and the address but not
the audience, which is inside the envelope (§6.4). The app knows which numbers it lacks and not whom
to ask — which is why §10's first rule is about the bytes, not the index.

### Contrast

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
