# The chain

**Spec:** §3.3 the chain, and §3.5 for what changing a key costs in practice.
**Run:** `node examples/the-chain/the-chain.js`

Your identity is your anchor key (§3), and a key you have held for years is a key you may one day
lose or have taken. The chain is how the identity survives that without becoming a name a server
looks up. It is an array of links inside the profile, running from the anchor key to the key in use
now, and it has exactly one link shape:

```json
{"key":"<new key>","recovery":{…},"sig":"<86 chars>","vouchers":[{"key":…,"salt":…,"sig":…}]}
```

A link with `sig` is a **rotation** — the previous key signed the move, so the owner made it. A link
with `vouchers` is a **restore** — members of the recovery list signed the move, so the owner's
people made it for them. A link may carry both. There is no third construction, no revocation
message, and nothing here that a host issues or countersigns.

## What the output shows

**The chain runs from the anchor key to the key in use now.** The example prints alice's chain at
lengths one, two and three: the bare first link, the rotation, the restore. The first link MUST be
`{"key": <anchor>}` and its key MUST equal `anchor`, which is what ties the whole array back to the
key a reader learned out of band (§3.1). Every later link is the same shape and differs only in
which of `sig` and `vouchers` it carries. These are the chains in Appendix B.3, B.4 and B.5.

**A rotation is signed by the key it replaces.** The signed input is printed in full, because a
second implementer has to reproduce it from the text: 88 ASCII bytes, the previous key, `->`, the
new key, both in base64url. The signature that comes out is Appendix B.4's, character for
character, and it is read by §2.1's rule — 86 base64url characters that re-encode to themselves.

The two failures beside it are the ones a hand-written verifier gets wrong. Signing
`<new>-><previous>` produces a perfectly valid Ed25519 signature over the wrong bytes; the arrow has
a direction and it points the way the identity moved. And a signature by *some* key over *some*
move verifies fine in isolation — it is only a link when the key that signed it is the key the
previous link ended on. Both come back `false`.

**A restore carries vouchers over the same bytes.** Not a different message, not a countersignature
over the rotation — the same 88 bytes, signed by other people. A voucher counts when two things
hold: its signature verifies, **and** `SHA-256(salt ‖ "|" ‖ voucher key)` in base64url is one of
`recovery.leaves`. The example shows bro producing a cryptographically perfect signature under a
salt that is not the one committed for him; it counts zero. His own salt, same signature, counts
one — the signature was never the question. And mum's voucher listed twice counts one, because the
threshold is over **distinct** voucher keys; the chain does not hold at `k` of 2. Duplicating a
voucher is the cheapest possible attack on a threshold and it is worth seeing it fail.

**Every link carries the recovery list as it stood before it.** This is the part of §3.3 that looks
redundant and is not. A reader meeting alice for the first time at chain length three holds no
recovery list at lengths one and two, so it has nothing to judge those links by: the example walks
the chain holding a list only at length one and gets `null`. The lists carried on the links are what
it adopts, and then the walk succeeds. A reader that already holds a list at that length ignores the
carried copy (§3.6 rule 3) — the carried copy is for the cold reader only. The list itself is
`examples/recovery-list/`; what happens when two chains disagree about one identity is
`examples/contest/`.

**Vouchers may be added to a link after it was made.** `src/profile.js`'s `vouched` takes a rotation
alice made alone and returns the same link with her people's signatures attached: same `key`, same
`sig`, two vouchers that now count. Nothing after that link is disturbed. That matters because
§3.6 settles a contest by a **majority of the recovery list at the split**, not by `k` and not by a
`sig` — so a bare rotation can be stuck against a thief's vouched fork. The fix is not to restore
again onto a fresh key and abandon everything signed since; it is for her people to back the link
she already made. One link shape is what buys that.

**A restore changes the key and nothing else.** A link with no `sig` MUST NOT arrive, in the same
profile version, with a change to `locations`, `recovery`, `name` or `read`, and a pinned reader
MUST catch it. The example pins a reader at version 2 and then serves it version 3 twice: once
honestly, which reads `ok`, and once with `locations` moved to another host, which reads
**identity — a restore changed more than the key**. The script asserts the same verdict for a
changed `name`, a changed `read` and a changed `recovery`. The people who vouched were asked to move
alice's key. They were not asked to move her hub, rewrite who may recover her next time, or swap the
X25519 key that everything private is encrypted to.

**A key rotated away from keeps its posts valid.** Post 1 was signed by the anchor key a year and
two links ago, and it still verifies under the chain's keys — the chain is a set of keys that ever
spoke for this identity, not a single current one. What the old key may no longer do is the whole of
its closure: it cannot sign an index (§4.6 — the index MUST be signed by the key the chain
*currently* ends on, which is what a restore actually restores; see `examples/the-index/`) and it
cannot hold a number against the owner (§8.5). There is no revocation message anywhere.

**§3.5 — changing the key means writing the profile and the index again, in that order.** The last
block shows an index signed by the key alice just left failing under the current key, which is the
mechanical reason for the ordering: the index MUST be signed by the current key (§4.6), and a hub
that verifies writes checks the index against the profile it holds (§8.4). Profile first, index
second. Between the two writes an honest host is briefly serving an index its own profile disowns;
§7.2 answers that — an index that will not verify is not an accusation against anyone.

This is `GOALS.md` scenario 2, *Grandma onboards*: she "loses her phone a year later and is back by
calling her daughter." The daughter is a leaf in a recovery list; the phone call is a restore link;
the chain is why the grandchildren's readers follow her to the new key instead of meeting a
stranger.

## Contrast

**Revocation, and its absence.** There is no CRL, no OCSP responder, no revocation certificate, no
expiry date and no "this key is compromised" message anywhere in Open Feed. That is not an
omission. Every one of those is an *announcement* — a document that has to reach the reader for the
key to be closed, and it reaches the reader over a path the host controls. Against the adversary
§13.1 names, the one who runs the serving path and will not cooperate, **a revocation the host can
withhold is not a revocation**. So the old key is closed by what it may no longer do rather than by
what anyone says about it: the reader computes the current key from the chain in a profile it
verified, and an index signed by anything else is not the identity's index. There is nothing to
withhold, because there is nothing to deliver.

**X.509 and CA chains.** A TLS certificate chain is also a chain, but it runs *outward* to a third
party: the subject's key is vouched for by an issuer, whose key is vouched for by another issuer,
up to a root the reader was shipped. Trust arrives from outside and revocation has to be published
by whoever issued it. Open Feed's chain runs *inward* — every link is signed by the identity's own
previous key or by people the identity committed to in advance, and the whole thing is carried in
the profile the reader is already fetching. Nobody issues anything, and there is no party who could
refuse to.

**PGP key transition statements.** The closest ancestor of a rotation link: a plaintext document
saying "old key K1 is retiring, new key K2 is me," signed by both. It is the same idea done by
convention — the format is folklore, the signed bytes are a paragraph of English, and no
implementation verifies it, so a human reads it and decides. §3.3 makes it 88 bytes with a fixed
shape that a verifier checks without being asked. OpenPGP does also have revocation certificates and
expiry, and they work about as well as key servers deliver them.

**Signal.** When a contact's identity key changes you get a notification: the safety number changed,
verify again. There is no cryptographic link from the old key to the new one, so the notification is
the entire mechanism, and users are trained to tap past it. Open Feed's equivalent of that
notification is a verdict a reader computes for itself, and a restore is *not* the same event as a
stranger substituting a key: one walks the chain, the other does not.

**Matrix cross-signing** is closer, and worth naming honestly: a master key signs device keys, so
devices come and go under one stable identity without re-verifying each one. But replacing the
master key itself lands in the same place as Signal — other users have to verify the identity again
— and the whole structure lives on a homeserver rather than in a file the reader holds. The chain's
answer to *the master key is the thing that was lost* is the recovery list.

**Nostr** is the honest baseline this is competing with, because it is the closest living system
with the same starting premise: identity is a key you hold, and there is no server that owns your
name. It is also where that premise usually stops — in the base protocol a lost key is a lost
identity, and the proposals for migration have not settled into something readers implement. §3.3 is
the argument that a key-as-identity protocol can survive key loss without acquiring an account
system, and §3.6 is the price: a chain that walks perfectly proves nothing on its own, so the
recovery list has to do the deciding.
