# First contact

**Spec:** §3.1, and the `anchor` rule in §3.2. §3.6 is the contest the last block points at.
**Run:** `node examples/first-contact/first-contact.js`

Your identity is your anchor key (§3). Everything else — the profile, the chain, the index, the
posts — hangs off it, and all of it arrives through a host. So the first question a reader has to
answer is the one question the host cannot be allowed to answer: **which key is this?**

A reader that learns your key from the host it is reading has learned nothing, because the host
chose both the profile and the key printed in it. §3.1 gives two routes that go around the host — a
link with the key in its fragment, and six spoken words — and one rule that makes them bite: a
reader MUST refuse a profile whose `anchor` does not match what it learned.

## What the output shows

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

## Contrast

Everyone building this has met the same problem, and the interesting differences are in what they
ask a human to do.

- **SSH's host-key prompt is TOFU, and §3.1 refuses it.** `The authenticity of host … can't be
  established. Fingerprint is SHA256:…. Are you sure you want to continue?` — almost nobody has the
  fingerprint to compare against, so almost everybody types `yes`, and the trust that gets
  established is trust in whoever answered the connection. That is precisely the reader that has
  learned nothing. Open Feed's first block is that prompt, answered `yes`, with a hostile host on
  the other end. Note the difference in stakes, though, and be fair to SSH: it is protecting a
  session against an active attacker, whereas here the *expected* host is a party who may be hostile
  from the beginning (see the threat model in `CLAUDE.md` and §13).
- **Signal's safety numbers** are the closest relative: 60 digits shown as twelve groups of five,
  compared in person or read aloud, with a QR scan as the fast path. Same shape — an out-of-band
  check value over public keys — and the same honest admission that most people never do it. Six
  words are shorter to say than sixty digits, at the cost of being a check on identity only.
- **PGP fingerprints and the web of trust** are the version that failed as a human protocol.
  Comparing 40 hex characters at a key-signing party asked people to be careful about something
  they had no way to feel, and the usual outcome was checking the last eight characters, or none.
  Open Feed takes the ergonomic lesson without the social graph: there is no signature-on-a-key,
  no trust transitivity, and no keyservers. Vouching exists, but only for recovery (§3.4), only
  from a list you chose, and only as hashes that reveal nothing until used.
- **BIP-39** supplies the wordlist and nothing else. Its wordlist is a good one to borrow — 2,048
  words chosen so that four letters identify each, and so they survive being said out loud — but a
  BIP-39 mnemonic *is* a secret you can reconstruct a wallet from, and this is the opposite: six
  words derived from a **public** key, safe to say in a room, and not enough bits to reverse.
  Anyone who confuses the two will misfile this as "your recovery phrase", which it is not; the
  recovery mechanism in this protocol is §3.4, a list of people.

The scenarios this serves are `GOALS.md` 2 (Grandma onboards and is never shown a key) and 7 (the
stranger, who re-meets an author after a key loss — the current-key route is how). Scenario 1's
sister needs it too: when she leaves the ex's hub, the reader that follows her does so by anchor
key, and the frozen copy he keeps serving reads as an older version of her rather than as her.
