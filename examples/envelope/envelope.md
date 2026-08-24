# The envelope

**Spec:** §6 the three visibilities, §6.1 the envelope, §6.2 carrier binding, §6.3 slots and tags,
§6.5 the audience is inside, §6.6 an encrypted post's target. §6.4's padding is `examples/padding/`.
**Run:** `node examples/envelope/envelope.js`

Three visibilities, one mechanism: public; encrypted to a chosen set of reading keys; and a direct
message, which is that set with one member in it. An encrypted post is an ordinary post whose
content sits in an `encrypted` member, and **nothing about signing changes** — it is signed and
addressed exactly as any other post (§2), the index lists it exactly as any other post (§4), and a
reader that cannot open it verifies it completely and hands it back with the field opaque (§7.4).
There is no second signing construction in this protocol.

The whole envelope is about fifty lines of a standard library: one X25519 ephemeral, HKDF-SHA256,
ChaCha20-Poly1305. The example derives a slot from `node:crypto` alone and checks the result against
Appendix B.8, so a second implementer can follow every intermediate value and know when they have
it right.

## What the output shows

**Three visibilities, one mechanism.** A public post carries `n`, `at` and `text`. The family post
and the direct message carry `n`, `at` and `encrypted`, and are otherwise indistinguishable from
each other and from any other post: body, one `\n`, 86 signature characters. The DM is not a
different kind of object — it is the same envelope with one member in the audience besides alice
herself. Comments and reactions on an encrypted post are encrypted in turn, which the reply later in
the output shows.

**The construction, printed as the spec states it.** One ephemeral pair per message. Per recipient
`R`: `Z = X25519(ephemeral private, R)`, then
`tag(8) || kek(32) || knonce(12) = HKDF-SHA256(ikm = Z, salt = epk, info = "openfeed/v1/slot", 52)`,
then `wrapped = ChaCha20-Poly1305(kek, knonce, content key, aad = epk)`. The content once:
`plain` is UTF-8 JSON of the audience followed by the post's content members, length-prefixed and
padded to a bucket (§6.4), and `ct = ChaCha20-Poly1305(content key, 12 zero bytes, padded,
aad = epk || carrier)`. The example prints `Z`, the three derived pieces, the wrap and the
ciphertext, and asserts that the slot it built by hand is byte-for-byte the second slot of Appendix
B.8.

**The all-zero nonce.** It is safe for the reason it is safe in HPKE, and for no other: the content
key is 32 random bytes and MUST NOT be reused across messages, so that `(key, nonce)` pair is used
exactly once in the life of the key. Reuse the content key across two posts and you have reused a
nonce, which for a stream cipher means the two plaintexts XOR to a readable difference. There is no
counter to get wrong because there is nothing to count.

**The carrier is associated data.** This is the sharpest block. The thief lifts alice's envelope out
of her post 5 and drops it into a post of his own — number 1, signed by his key, listed in his
index. His post is *valid*: it verifies under his key, and a reader is right to accept it as his.
Then mum's client tries to open the envelope against the carrier it was served in,
`<thief's anchor key>:1`, and gets nothing. A client that passes no carrier at all gets nothing
either.

The output then shows what the binding buys, by building the same ciphertext with `epk` alone as
associated data: that unwrap takes no carrier argument, so there is nothing to compare and nothing
to forget, and the identical bytes open wherever they are pasted — alice's words rendered under the
thief's name, from an envelope he could never read. **Binding as associated data rather than
comparing fields afterwards is the difference between a rule a client can skip and a rule a client
cannot reach around.** A wrong carrier is not a failed comparison; it is a wrong key.

**A tag is a hint, never a decision.** A recipient derives its own tag and scans for it. The example
opens the DM twice: once by scanning, once with an opener that ignores every tag and simply tries to
unwrap all eight slots. Same plaintext. **An implementation that never looks at a tag is conformant
and merely slower** — and that equivalence is the test of whether a tag decides anything. The last
line makes the failure mode concrete: a slot carrying mum's own tag whose unwrap fails, placed
first. That is a collision, and §6.3 requires her to keep scanning. A reader that stopped there
would conclude a message was not for it on eight bytes it does not control.

**Tags are blinded per message.** Mum's tag on post 5 and on post 6 are different strings, and the
two posts share none of their sixteen slot tags. The tag is derived through the message's own
ephemeral, so it needs one of the two private halves: an observer holding every published reading
key and the ephemeral public key derives nothing, and one recipient's slots do not link across
posts. That is why a slot is labelled with a tag rather than with a key identifier — a `kid` would
name the audience to every observer, permanently.

**The audience is inside, and each entry names a person.** Mum opens post 6 and finds four entries,
each `{key, read, loc}` — an anchor key, an X25519 reading key, and a location. Alice's own entry is
among them, because a publisher that leaves itself out cannot read its own outbox.

Then the argument that makes the entry a person rather than a key. Mum replies, and for each entry
she reads the profile at `loc`, refuses it unless its `anchor` is that entry's `key` (§3.1), and
encrypts to the `read` key that profile carries — §3.8 is emphatic that a publisher encrypts only to
a key it took from a profile it verified, because taking the key the host served is encrypting to
the host. The example shows that refusal working: a profile served at bro's location under someone
else's anchor yields nothing.

The counterfactual is the point. Had the audience been reading keys and nothing else, mum would hold
an X25519 key for sis and for bro and nothing that leads to a profile — no anchor to check it
against, no location to fetch, and nothing she could name as a `target` (§5.4). So her reply goes
out to the one member she already knew. **The thread splits in half, silently, and neither half is
told.** No error is raised anywhere, because from the protocol's point of view nothing went wrong.

**`rel`, `target` and `media` go inside.** Mum's reply is a reply, but the public bytes of her post
13 do not contain the string `reply`, and do not contain alice's key. The public file carries `n`,
`at` and `encrypted`, and nothing about what it answers. Inside, each `media` entry is
`{"hash", "key"}` (§4.4) rather than a bare hash. The consequence is stated plainly and belongs to
two other examples: public threading, relocation riding along in a reply (§3.7) and the rumor rule
(§7.5) all read `rel` and `target`, so they work for everything a stranger could see anyway and are
simply unavailable for anything encrypted — see `examples/moving/` and `examples/top-and-rumors/`.

**Verified completely, opaque to everyone else.** The last block runs §7.4's three checks on post 5
from outside the audience: the signature verifies under a key in alice's chain, the address is the
one the index lists, and `n` equals the number it was served at. The verdict is *ok* and the
`encrypted` member comes back as an object with three members nobody outside the audience can do
anything with. Not an error, not a verdict — opening it is the client's business, never the
reader's. The host's own reading key opens nothing. `examples/the-reader/` owns the full order of
steps; this block is the one line of it that concerns §6.

**What the host learns**, said plainly: that an encrypted post exists, when it was written, and
roughly how big it is. It does not learn who it is for, how many people it is for, or what it
answers. Because the audience is inside the plaintext, a large audience does show in the bucket the
body lands in; §6.4's floor is what hides the small end, so that a message to one person is the size
of a message to the family. That floor is priced in `examples/padding/`.

## Contrast

This construction was deliberately re-chosen. The design it replaced was not broken, and the
replacement is not novel — the interesting part is what each of the alternatives costs.

**The JWE construction this replaced.** The archived §15 (`archive/open-feed-spec.md`, implemented
in `archive/src/enc.js`) put a **JWE JSON Serialization** (RFC 7516) in the field: `alg`
`ECDH-ES+A256KW`, `enc` `A256GCM`, an X25519 ephemeral per RFC 8037, key derivation by RFC 7518's
Concat KDF. The good ideas are all still here: one shared ephemeral, per-recipient slots found by a
blinded 8-byte tag with `kid` forbidden, the audience encrypted inside rather than in a header. What
went was the JOSE shape around them.

The price it was paying, re-measured against the current code:

| | archived §15 | §6 |
| --- | --- | --- |
| spec words | 3,606 | 905 |
| implementation | 381 lines (`archive/src/enc.js`) | 76 lines (`src/envelope.js`), media included |
| bytes per recipient slot | 160 | 83 |
| carrier binding | three plaintext fields compared by the client | associated data |
| audience | OPTIONAL, identity URLs | MUST, `{key, read, loc}` |
| padding | none | §6.4, with a floor |

`GOALS.md` priority 1 is "implementable from a language's standard library… no canonicalizer, no
JOSE library". The old envelope hand-rolled JWE rather than importing one, which is the worst of
both: a wire format whose rules live in four RFCs, implemented by us. And its per-recipient header
was **not covered by the JWE's own AEAD** — the archived §15.2 says so — so it leaned on the item
signature for integrity, and lost that protection the moment anything lifted the envelope out of its
carrier. Carrier binding then had to be re-added as a MUST that a decrypting client performs by
comparing `id`, `authors[0].url` and `feed_url`, with a further rule that "absent against present is
a mismatch, in both directions", because that is what happens when a check lives beside the data
instead of underneath it. §6.2 is the same defence in one line of associated data, and two of those
three fields no longer exist.

**HPKE (RFC 9180)** is the closest well-specified relative, and the honest description of §6 is
*HPKE's base mode in spirit, hand-rolled from primitives a standard library already has*, plus the
box-per-recipient pattern that multi-recipient HPKE uses on top of it. Same shape: an ephemeral
X25519, HKDF-SHA256, ChaCha20-Poly1305, a content key encrypted once per recipient, an all-zero
nonce justified by a single-use key. Where it deviates, plainly:

- HPKE derives through `LabeledExtract`/`LabeledExpand` with a version prefix and a ciphersuite
  identifier mixed into the key schedule. §6 derives straight from the raw X25519 output with
  HKDF salted by `epk`, and `"openfeed/v1/slot"` is the whole of the domain separation. That is
  cheaper and it means a future cipher change is a change to that string, not a parameter.
- HPKE's `Seal` takes a nonce from the key schedule XORed with a sequence number, because an HPKE
  context encrypts many messages. Here a content key encrypts exactly one, so there is no sequence.
- HPKE offers an authenticated mode. §6 does not need one: the sender is authenticated by the
  Ed25519 signature on the file the envelope rides in, and §6.2 binds the envelope to that file.
- HPKE is a reviewed, tested, widely implemented standard, and this is not. That is a real cost of
  the trade and `GOALS.md` records the evaluation as commissioned rather than closed.

**NIP-44** (Nostr's encrypted payloads, Cure53-reviewed) is the other close relative, and
`archive/redesign/CANDIDATES.md` records that swapping to its construction was the cheapest answer
to this envelope's "never independently reviewed" status. The cipher suite is nearly the same
— ChaCha20 with HKDF-SHA256 over an X25519 shared secret, with padding — and §6's padding buckets
are its idea. Two differences matter. NIP-44 is a **two-party** format: a conversation key from a
*static* pair of keys, so it has no ephemeral, no slots, and no audience; a group is N pairwise
copies. And it encrypts-then-MACs with HMAC-SHA256 rather than using an AEAD, which is a choice §6
does not need to make because ChaCha20-Poly1305 is in the standard library too. What §6 takes from
it is the padding discipline; what it cannot take is the shape, because a family post to four people
is one object with four slots, not four objects.

**Signal and MLS (RFC 9420)** are the comparison people reach for, and the honest answer is that
this is not in that family at all. There is **no ratchet, no forward secrecy after the fact, and no
group state.** A recipient's reading key opens every post ever addressed to it; compromise that key
and the archive goes with it. Nobody is *added to* or *removed from* anything, because there is no
group to be a member of — an audience is fixed at the moment a post is written, and the next post
simply names a different list. This is **file encryption for a mailing list**, and the design says
so rather than implying otherwise. What it buys is that a post is a static file any dumb host can
serve and any reader can verify years later without a session, which is the property the rest of the
protocol is built on.

**Why the audience is inside and not in a header.** A header would be readable by the host, which is
floor item 2 in reverse: the audience of a family-only post is exactly the social graph the abusive
operator in `GOALS.md`'s divorce scenario wants. A key identifier per slot would do the same thing
permanently, since reading keys are long-lived and published. A blinded tag needs one of the two
private halves and is fresh per message, so an observer with every published key and the whole feed
learns that an encrypted post exists, when, and roughly how big — and with §6.4's floor, not even a
DM-versus-group distinction. The cost of putting the audience inside is that recipients learn each
other, which is the intended trade: it is what makes a reply reach the same people.

**The scenarios this serves.** `GOALS.md` floor item 2 — *the host cannot read what wasn't meant for
it* — is the centre, and §6.2 is what stops the host converting an envelope it cannot read into an
attribution it chose. Scenario 3, *two hubs, one thread*, is the other: Jesse on one domain and Mom
on another exchange a family-only post, a reply and a reaction **with no access control anywhere**.
No server checks membership, because there is no membership; the audience is a list of people
written into the plaintext by the author, and every hub in the path is serving bytes it cannot read
to anyone who asks. That is why §6.5's entry has to name a person and not just a key — it is the
only thing that lets the second hub's reader answer the first hub's post.
