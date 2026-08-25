# The envelope

**Spec:** §6 the three visibilities, §6.1 the envelope, §6.2 carrier binding, §6.3 slots and tags,
§6.4 the audience is inside, §6.5 an encrypted post's target.
**Run:** `node examples/envelope/envelope.js`

Three visibilities, one mechanism: public; encrypted to a chosen set of reading keys; and a direct
message, which is that set with one member in it. An encrypted post is an ordinary post whose
content sits in an `encrypted` member, and **nothing about signing changes** — it is signed and
addressed exactly as any other post (§2), the index lists it exactly as any other post (§4), and a
reader that cannot open it verifies it completely and hands it back with the field opaque (§7.4).
There is no second signing construction in this protocol.

The whole envelope is about 75 lines over a standard library: one X25519 ephemeral, HKDF-SHA256,
ChaCha20-Poly1305. The example derives a slot from `node:crypto` alone and checks the result against
Appendix B.8, so a second implementer can follow every intermediate value and know when they have
it right — by running this script, since Appendix B.1 publishes public keys only and the seeds
behind B.8 live in `tools/regen.js`.

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
`plain` is UTF-8 JSON of the audience followed by the post's content members, under §2.4's rules
like any body, and `ct = ChaCha20-Poly1305(content key, 12 zero bytes, plain, aad = epk || carrier)`.
Wherever `epk` appears in a derivation — the salt and both AADs — it is the 32 raw bytes, not the
43-character text; the carrier is ASCII. The example prints `Z`, the three derived pieces, the wrap and the ciphertext, and asserts
that the slot it built by hand is byte-for-byte the second slot of Appendix B.8 — which is also the
example's check that `src/envelope.js`'s info string is the spec's, since the derivation here spells
`"openfeed/v1/slot"` out rather than importing it.

**The all-zero nonce.** It is safe for the reason it is safe in age's key wrap, and for no other:
the content key is 32 random bytes and MUST NOT be reused across messages, so that `(key, nonce)`
pair is used exactly once in the life of the key. Reuse the content key across two posts and you
have reused a nonce, which for a stream cipher means the two plaintexts XOR to a readable
difference. There is no counter to get wrong because there is nothing to count. The same discipline
holds one level up, and §6.1 states it without a MUST: `knonce` is derived from the ephemeral, so an
ephemeral reused across two posts wraps two content keys under one `(kek, knonce)` — a two-time pad
over the content keys, and the same tag for that recipient on both posts. One ephemeral per message
is a rule, not a habit. (`FINDINGS.md` §1 is where the missing MUST is filed.)

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
unwrap every slot. Same plaintext. **An implementation that never looks at a tag is conformant
and merely slower** — and that equivalence is the test of whether a tag decides anything. The last
line makes the failure mode concrete: a slot carrying mum's own tag whose unwrap fails, placed
first. That is a collision, and §6.3 requires her to keep scanning. A reader that stopped there
would conclude a message was not for it on eight bytes it does not control. (That mum's slot is
the second is `src/envelope.js`'s habit — slots in audience order — and Appendix B.8 fixes it for
the vector only; nothing in §6 fixes placement, and a publisher MAY shuffle. The slots are authenticated by nothing in the AEAD: only the file's Ed25519 signature
covers them, which is enough, because only the author can sign.)

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

**Verified completely, opaque to everyone else.** The last block ties post 5 to Appendix B.8 by its
address and shows the host's own reading key opening nothing. A reader outside the audience runs
§7.4's three checks on it exactly as on any post — signature under a chain key, address, `n` — and
hands `encrypted` back whole; `examples/the-reader/` stages that read, and this file does not repeat
it.

**What the host learns**, said plainly: that an encrypted post exists, when it was written, how
big it is, and how many slots it has — so how many people it is for. It does not learn who they are
or what it answers. Hiding the size of the audience from the host is not a goal of this design, and
§13.3 says so. Two facts a family app has
to hold that neither example stages, because they are one `decrypt` call each: a later post to a
smaller audience is simply a post bro cannot open, and he keeps post 6 forever (§13.3, no forward
secrecy); and a new `read` key in a later profile version opens new posts only — old posts still
open with the old private key, and nothing re-encrypts the past (§3.8).

## Contrast

None of this construction is novel; the interesting part is what each of the alternatives costs.

**JWE** (RFC 7516, JSON Serialization with `ECDH-ES+A256KW` and `A256GCM`) is the standards-track
way to say the same thing — one shared ephemeral, a wrapped content key per recipient — and it
costs a wire format whose rules live in four RFCs (7516, 7518, 8037, and the Concat KDF), with no
standard library that implements them. Its per-recipient header is **not covered by the JWE's own
AEAD**, so carrier binding has to be a rule a decrypting client performs by comparing plaintext
fields afterwards; §6.2 is the same defence in one line of associated data.

**HPKE (RFC 9180) and age** are the closest well-specified relatives — HPKE in spirit, age in shape.
HPKE's base mode is the DHKEM half: an ephemeral X25519, HKDF-SHA256, ChaCha20-Poly1305. age's
X25519 recipient stanza is the rest: a file key wrapped once per recipient under a single-use key
with a nonce fixed at twelve zero bytes, exactly §6's justification for its own. RFC 9180 itself has
neither a multi-recipient mode nor a zero nonce. Where §6 deviates from HPKE, plainly:

- HPKE derives through `LabeledExtract`/`LabeledExpand` with a version prefix and a ciphersuite
  identifier mixed into the key schedule. §6 derives straight from the raw X25519 output with
  HKDF salted by `epk`, and `"openfeed/v1/slot"` is the whole of the domain separation.
- HPKE's `Seal` takes a nonce from the key schedule XORed with a sequence number, because an HPKE
  context encrypts many messages. Here a content key encrypts exactly one, so there is no sequence.
- HPKE offers an authenticated mode. §6 does not need one: the sender is authenticated by the
  Ed25519 signature on the file the envelope rides in, and §6.2 binds the envelope to that file.
- HPKE and age are reviewed, tested, widely implemented, and this is not. That is a real cost of
  the trade, and `GOALS.md` lists the construction as an open question for outside review, not a
  closed one.

**NIP-44** (Nostr's encrypted payloads, Cure53-reviewed) is the other close relative, and the
nearest reviewed construction this one could be swapped for. The cipher suite is nearly the same
— ChaCha20 with HKDF-SHA256 over a secp256k1 ECDH secret (Nostr's curve), with padding. Two
differences matter. NIP-44 is a **two-party** format: a conversation key from a
*static* pair of keys, so it has no ephemeral, no slots, and no audience; a group is N pairwise
copies. And it encrypts-then-MACs with HMAC-SHA256 rather than using an AEAD, which is a choice §6
does not need to make because ChaCha20-Poly1305 is in the standard library too. What §6 cannot take
from it is the shape, because a family post to four people is one object with four slots, not four
objects.

**Signal and MLS (RFC 9420)** are the comparison people reach for, and this is not in that family
at all. There is **no ratchet, no forward secrecy after the fact, and no
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
learns that an encrypted post exists, when, how big, and to how many. The cost of putting the
audience inside is that recipients learn each
other, which is the intended trade: it is what makes a reply reach the same people.

**The scenarios this serves.** `GOALS.md` floor item 2 — *the host cannot read what wasn't meant for
it* — is the centre, and §6.2 is what stops the host converting an envelope it cannot read into an
attribution it chose. Scenario 3, *two hubs, one thread*, is the other: Jesse on one domain and Mom
on another exchange a family-only post, a reply and a reaction **with no access control anywhere**.
No server checks membership, because there is no membership; the audience is a list of people
written into the plaintext by the author, and every hub in the path is serving bytes it cannot read
to anyone who asks. That is why §6.4's entry has to name a person and not just a key — it is the
only thing that lets the second hub's reader answer the first hub's post.
