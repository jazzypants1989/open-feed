# The publish interface

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

## What the output shows

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

## Contrast

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
