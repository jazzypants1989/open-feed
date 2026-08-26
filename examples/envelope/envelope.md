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
encrypts to the `read` key that profile carries — §3.6 is emphatic that a publisher encrypts only to
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
(§7.4) all read `rel` and `target`, so they work for everything a stranger could see anyway and are
simply unavailable for anything encrypted — see `examples/moving/` and `examples/top-and-rumors/`.

**Verified completely, opaque to everyone else.** The last block ties post 5 to Appendix B.8 by its
address and shows the host's own reading key opening nothing. A reader outside the audience runs
§7.4's three checks on it exactly as on any post — signature under a chain key, address, `n` — and
hands `encrypted` back whole; `examples/the-reader/` stages that read, and this file does not repeat
it.

**What the host learns**, said plainly: that an encrypted post exists, when it was written, how
big it is, and how many slots it has — so how many people it is for. It does not learn who they are
or what it answers. Hiding the size of the audience from the host is not a goal of this design, and
the protocol does not try to hide it. Two facts a family app has
to hold that neither example stages, because they are one `decrypt` call each: a later post to a
smaller audience is simply a post bro cannot open, and he keeps post 6 forever (no forward
secrecy); and a new `read` key in a later profile version opens new posts only — old posts still
open with the old private key, and nothing re-encrypts the past (§3.6).

