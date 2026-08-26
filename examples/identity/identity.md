# Identity

§3 of the spec: the anchor key, the profile, the chain, the recovery list, the reading key, and first contact. One script; the prose below is the former first-contact, the-chain and recovery-list examples.

---

## First contact

**Spec:** §3.1, and the `anchor` rule in §3.2. §3.6 is the contest the last block points at.
**Run:** `node examples/first-contact/first-contact.js`

Your identity is your anchor key (§3). Everything else — the profile, the chain, the index, the
posts — hangs off it, and all of it arrives through a host. So the first question a reader has to
answer is the one question the host cannot be allowed to answer: **which key is this?**

A reader that learns your key from the host it is reading has learned nothing, because the host
chose both the profile and the key printed in it. §3.1 gives two routes that go around the host — a
link with the key in its fragment, and six spoken words — and one rule that makes them bite: a
reader MUST refuse a profile whose `anchor` does not match what it learned.

### What the output shows

**A reader that learns your key from the host has learned nothing.** The example has a hostile host
serve a profile that is well formed in every respect: valid signed file (§2.1), chain that walks
(§3.3), a recovery list, a `name` of "Alice". It is simply a profile for a key the host generated.
Verified against the key printed inside it — trust on first use — it comes back `ok`. Verified
against the key the reader learned out of band, `verifyProfile` returns `identity: not the identity
this reader learned`, and it returns it *before* checking the chain or the signature, because the
question of who this is comes first. Note that `name` is no help either: it is signed, so no hub can
choose it for you, but §3.2 forbids using it to resolve or match an identity.

**The link.** `https://alice.example/alice#pukq6VMQ…` is the location with the anchor key in its
fragment. A fragment is not part of a request (RFC 3986 §3.5), so the key never reaches the server —
the example prints the request target the server actually gets, `GET /alice`, with no key in it. The
rest of the link is an ordinary page address: a plain browser follows it, lands on alice's page, and
ignores the fragment, which is what makes the link shareable in a text message or a QR code by
someone who has no idea what any of this is. A reading app splits it into a location to fetch from
and a key to check `anchor` against, and refuses on mismatch.

**The spoken code.** Six words for a phone call, derived exactly as §3.1 writes it:
HKDF-SHA256 with the key bytes as ikm, an empty salt, `"openfeed/v1/spoken"` as info, nine bytes
out; the first 66 bits cut into six 11-bit big-endian fields; each field an index into the BIP-39
English wordlist. The example prints the nine bytes, then each field in binary, its index, and its
word, and asserts the six indices against Appendix B.12 — `923 1951 1851 172 1664 898`, which is
alice's anchor key and reads *inflict view trash better source icon*.

Worth being precise about what this route is. The six words are a **check value, not a transport**:
you cannot reconstruct 32 bytes from 66 bits, so nobody types the code in and gets a key. What
happens is that the reader fetches a candidate — from a location it was told over the same phone
call — and the code confirms which key that candidate must have. The host supplies the bytes; the
person supplies the answer to *which*.

**66 bits, and why not 55.** That confirmation is only as good as the odds against a host finding
some *other* key whose code matches. The wordlist is 2,048 words, which is 2^11, so each word is 11
bits and six words are 66: 73,786,976,294,838,206,464 keys to search. Five words would be 55 bits,
36,028,797,018,963,968 — 2,048 times less work, and §3.1 puts the difference plainly: at 66 bits
grinding a colliding key is centuries of GPU time, at 55 it is not. The example asserts the
arithmetic, not the timing. One extra word costs a second on a phone call.

**The code distinguishes identities, not versions.** Alice's profile at `version` 1 and at
`version` 3 — after a rotation and a restore, so three keys in the chain and a different key signing
— speak the identical six words, because both are one identity and share one anchor key. The
example prints them side by side with the impostor's, which speaks something else entirely. This is
the code's limit stated honestly: it tells alice from a stranger and it cannot tell one branch of
alice from another.

**The exit from contested.** That limit is why §3.6 needs a way out. When two profiles claim one
identity and no majority of the recovery list settles it, the reader stops at **contested** and
follows neither branch. §3.1's answer is that the same two routes MAY carry the key the owner's
chain **currently ends on** instead of the anchor — a different key, so a different six words, and
a reader given it MUST follow the branch whose chain contains that key and pin there. The example
shows alice's branch and a thief's agreeing on the anchor's code and disagreeing on the current
key's. It is one block here on purpose; `examples/contest/` is where §3.6 lives.

**A user is never shown a key.** Everything a person handles in this example is a link or six
English words. The 43 characters appear in the output because it is a program printing its working;
they are not a thing an app puts in front of anybody. That is `GOALS.md` scenario 2 — Grandma
installs an app, picks a name, is never shown a key — and it is a design constraint, not a UI
preference: a protocol whose safety check is 43 characters of base64url has a safety check nobody
performs.

Every key printed comes from Appendix B.1's seeds, except the hostile host's, which is seeded the
same way under its own label so the output still reproduces byte for byte.

## The chain

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

### What the output shows

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
majority is over **distinct** voucher keys; one of three is not more than half, and the chain does
not hold. Duplicating a voucher is the cheapest possible attack on a count and it is worth seeing it
fail.

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
§3.6 settles a contest by a **majority of the recovery list at the split**, never by a `sig` — so a
bare rotation can be stuck against a thief's vouched fork. The fix is not to restore
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
its closure: it cannot sign an index (§4.4 — the index MUST be signed by the key the chain
*currently* ends on, which is what a restore actually restores; see `examples/the-index/`) and it
cannot hold a number against the owner (§8.5). There is no revocation message anywhere.

**§3.5 — changing the key means writing the profile and the index again, in that order.** The last
block shows an index signed by the key alice just left failing under the current key, which is the
mechanical reason for the ordering: the index MUST be signed by the current key (§4.4), and a hub
that verifies writes checks the index against the profile it holds (§8.4). Profile first, index
second. Between the two writes an honest host is briefly serving an index its own profile disowns;
§7.2 answers that — an index that will not verify is not an accusation against anyone.

This is `GOALS.md` scenario 2, *Grandma onboards*: she "loses her phone a year later and is back by
calling her daughter." The daughter is a leaf in a recovery list; the phone call is a restore link;
the chain is why the grandchildren's readers follow her to the new key instead of meeting a
stranger.

## The recovery list

**Spec:** §3.4, with §3.3 for the link that spends it and Appendix B.2 for the vector.
**Run:** `node examples/recovery-list/recovery-list.js`

A recovery list is one hash per person you would trust to say "yes, that is her, and this is her
new key" — and more than half of them have to say it (§3.3). The hash is `SHA-256(salt ‖ "|" ‖ member key)` in
base64url, with a distinct random salt per member, so publishing the list publishes nothing about
who is on it — only how many. When a member vouches, they reveal their own salt and their own key
and sign the move, and the link in your chain (§3.3) carries that voucher forever.

Nothing is shared out, and nothing is reconstructed. Your people do not hold pieces of your key;
they hold their own keys, and what they can do with them is sign one sentence about *you* — that
the identity anchored at this key now uses that one. The key they move you to is a key you made
yourself. This is the mechanism behind `GOALS.md` scenario 2: Grandma loses her phone, calls her
daughter, and is back — without ever having been shown a key or asked to store a file.

### What the output shows

**One leaf per member, each under its own salt.** The three members, their salts, their keys, and
the leaf each pair hashes to, laid out as Appendix B.2 lays them out, and then the committed object
`{"leaves":[…]}` that goes in the profile. The example asserts the three leaves and the
committed JSON against the spec's own vector, character for character.

**A voucher reveals only itself.** sis vouches, and what goes on the wire is one object: her key,
her salt, her signature. The example makes the disclosure argument concrete instead of asserting it.
An attacker who holds the three leaves and knows the whole family's public keys — they are public,
they are in everyone's own profile — is run three times: with `saltsis` revealed he identifies sis
and nobody else, with no salt he identifies nobody, and against a hypothetical bare `SHA-256(key)`
leaf he identifies all three at once. A family is a small guessable space; the salt is the entire
reason a leaf does not fall to a scan of it.

**The count of leaves is public, and MUST be.** Three leaves are three leaves to anyone who fetches
the profile. That is not a leak the design tolerates, it is a requirement: §3.6 counts a majority
against the list, and a majority needs a denominator every reader can see. `examples/contest/` is
where that rule is worked out; this example only shows the number it needs.

**A restore is valid when more than half of the list vouches.** Over three members, sis alone
leaves the link invalid at one counted voucher; mum joining makes it two and the link stands; and
mum's key submitted under sis's salt counts zero, because a leaf binds the salt and the key together
and either half alone hashes to nothing. Then the whole profile is read and comes back **ok**,
ending on the key Alice made. There is no threshold for the author to set: the same majority
settles a contested identity, and `examples/contest/` shows why one bar is the point.

**The list MAY be empty.** An empty list is a real choice with an exact price: no leaf can ever
match, so no voucher can ever count, so no restore is possible and a lost key is a lost identity.
Where the list is not empty, a member can be a person, a backup key you keep in a drawer, or your
host. A leaf does not say which, and nothing outside your own app knows.

**Starting alone: a backup key you keep yourself.** For the first person on the protocol — or
anyone whose people are not on it yet — the list has nobody to name. §3.4 says an app SHOULD create
a backup key at setup and list it, and the example stages exactly that: a list of one leaf, the
backup key's six-word spoken code (§3.1) printed as it would go on paper, and a restore to a new
phone vouched by that key alone. A majority of one is one, so the paper is the whole recovery. When
people join later she lists them and rotates (§3.5); nothing in the protocol has to change for her
to go from one member to several, and nothing about recovery waits on having friends first.

**A list with one other person hands that person the identity.** The example stages it: Alice lists
bro and nobody else, bro restores to a key of his own, one of one counted — a majority — and the
chain walks to his key. Then the half that makes it worse. Alice replaces the list with the
three and rotates so the change reaches readers at all (§3.5), and her new link at chain length 1
carries the new list — but a reader that already saw the list of one there keeps it (§3.6 rule 2,
staged in `examples/contest/`). Bro's ability to restore at that length does not expire with the
list; it lasts as long as that reader does. That is why §3.4 says an app SHOULD require two or more
members beyond your own keys: a majority of one is one, which is the right answer for your own
backup key and the wrong one for somebody else's.

**"Recently restored" is presentation, not a verdict.** The read is **ok**; `restored` is a fact
about the chain, and reading apps SHOULD show it for seven days. The vouchers stay in the chain and
stay readable a year later — who moved this identity is part of the record, not a transient notice.
The three verdicts (§7.3) are ok, this host is misbehaving, and this identity is in question; a
fourth state that cried "restored" would be a state users learn to click past.

