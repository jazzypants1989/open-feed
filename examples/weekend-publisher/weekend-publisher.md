# The weekend publisher

**Spec:** §8 the publish interface, and §4.5 for the rewrite; it produces the files of §2, §3 and §4.
**Run:** `node examples/weekend-publisher/weekend-publisher.js`

The other capstone. **A whole conforming publisher in one file**, standard library only, written
from the protocol's text alone — and the thing that signs every file in Appendix B. When
`tools/regen.js` regenerates the test vectors, this is what produces the bytes; two independent
readers then verify them.

It is about a third the size of the reader, and that asymmetry is worth noticing on its own: in this
design the publisher's job is small and the reader's job is where all the checking lives. A hub that
cannot forge a signature can only refuse you or delete things, so almost nothing has to be defended
on the way out.

## What the output shows

**The measurement**, the same way the reader does it: non-blank, non-comment lines above the marker
that separates the publisher from the demo. Around 50.

**Claiming a name is a profile — and an index, even an empty one (§8.4).** The demo writes both.
Without that empty index a brand-new identity on a perfectly honest hub reads as `host: no index
served` at the moment somebody signs up, which is the worst possible first impression for a
protocol whose whole point is telling a bad host from a good one.

**The post is written before the index that lists it (§8.3).** The wire log shows the order for
every post: `PUT /alice/posts/n`, then `PUT /alice/index` with the entity tag of the version that was
read. An index listing bytes that are not there yet is `host` to every reader until they land; a post
nobody has listed is nothing to anybody. The asymmetry is the whole reason there is an order.

**A number already held is 409, and the publisher takes the next one (§8.2).** The laptop asks for 1,
2 and 3, gets refused three times, and lands on 4. Nothing is lost and nothing is retried in place.

**Numbering need not be gapless.** Post 4 is written and never folded into the index, which is
exactly what a crash between the two writes looks like — and the demo leaves it there, because *a
number nobody lists is nothing*. A device that comes back MUST abandon a number it cannot prove it
listed, and MUST NOT list one late.

**A withdrawal is an appended line; a rewrite drops what it left behind (§4.5).** Both index bodies
are printed. Same live set, fewer lines.

**The loser of a race re-reads and folds (§8.1).** The phone and the laptop both read the same index
and both publish a post. The phone's index write wins. The laptop's *naive* retry — re-sending its
own version with the tag it read — gets 412, and that 412 is the hub refusing to let the laptop drop
the phone's post. `amendIndex` re-reads what the hub is now serving and folds its line into that, and
both posts survive. **This is the single easiest thing to get wrong in the whole protocol**, because
the naive version works perfectly until two devices are used at once, and then it silently deletes
posts — and the loss reads to every reader as an ordinary withdrawal, which is to say, as something
the author did on purpose.

## Contrast

**There is no account, no token, and no session: the request is the signed file.** Compare with
Micropub, the Mastodon API, or AT Protocol's repo endpoints, all of which begin with an authorization
story — a token, a scope, a refresh, a server that decides who you are. Here the hub cannot decide
who you are; it can only decide whether to accept bytes. Anyone's client can write to anyone's hub,
and that is a security property rather than a convenience: **a hub that ships the app can take the
key**, so the spec makes clients and hubs a market instead of a pairing.

**Compare-and-swap over `If-Match` and `ETag`** is a 1997 mechanism (RFC 2068, then 2616, now RFC
9110) doing exactly the job it was designed for. The design uses it rather than inventing a version field, which is why static hosting
is a conforming hub for reading (§12) and why a browser-based publisher works at all, given the
preflight rules of §8.7.

**The publisher forgets; readers remember.** There is no DELETE verb here, no retained-version
history, and no permanent deletion record. `examples/rewrite/` and `examples/your-copy/` carry that
argument; what this file shows is that the client side of it is a handful of lines.

The demo below the marker in the source file is not part of the publisher — it includes a hub in
eleven lines, which is `GOALS.md` scenario 6's third implementer in miniature.
