# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.**

## Abstract

Open Feed is a protocol for publishing and interacting from a place you control, where the place is
not who you are. An identity is a signing key. A **profile** names your current keys, your
locations, and the people who can restore you. A **head** beside it lists what you have published
now. A **post** is one immutable signed file; a reply, a reaction, and a private message are all
posts naming a target. Readers pull. Content for chosen people is sealed to their keys with the
audience inside.

Everything is built from a language's standard library: Ed25519, X25519, SHA-256,
ChaCha20-Poly1305, HKDF, HTTP, JSON, base64url. There is no canonicalization, no JOSE library, and
no dependency this specification asks you to install.

## 1. What this must deliver

The design is judged against one person: **the operator of a family hub who is a loved one and an
abuser.** He is inside the family, entitled to look, runs the server, and will not cooperate. Four
things a person can rely on, stated as promises rather than mechanisms:

1. **The host cannot speak for you.** Nothing it serves as yours verifies unless you signed it, and
   the key that signs was never the host's.
2. **The host cannot read what wasn't meant for it.** Content for chosen people is unreadable by
   anyone else, the host included.
3. **The host cannot keep you.** You can leave at any moment with your identity and everything you
   wrote, without asking, because the key and the copy were always on your device.
4. **Family on other hubs are first-class.** Two relatives self-hosting on separate domains share,
   reply, and react to each other's family-only content as if they were on one hub.

Four priorities, in order, which decide the arguments this document does not otherwise settle:
**no dependencies**; **easy to implement** (a second implementer finishes a publisher or a reader in
a weekend from this text alone); **interop** (our content reaches existing feed readers with nothing
built); **minimal** (the shortest text that delivers the four promises).

What is deliberately not pursued: human-readable wire bytes, continuity for strangers across key
loss, and millions of items per identity. Open Feed scales **across identities** — many people on a
few large hubs is the case that must work.

## 2. Conventions and terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and
OPTIONAL are to be interpreted as described in RFC 2119 and RFC 8174.

**base64url** means base64url encoding without padding (RFC 4648 §5). Every key, hash, and signature
in this document is a base64url string: an Ed25519 or X25519 public key is 43 characters, a SHA-256
hash is 43 characters, an Ed25519 signature is 86 characters.

| term | meaning |
|---|---|
| **profile** | the signed file naming your keys, locations, and recovery list |
| **head** | the signed list saying which posts and photos exist now, and the highest number you have used |
| **post** | one immutable signed file; a reply, reaction, or private message is a post naming a target |
| **genesis key** | your first signing key. It *is* your identity; a link or a scanned code carries it, and readers follow the chain from it |
| **chain** | the hops from the genesis key to the key in use now, each a rotation or a restore |
| **recovery list** | the people or keys you named in advance to restore you, committed privately |
| **pin** | what a reader verified itself and remembers about an identity — the profile, the chain, the courts, and the head. This is what catches a lying host later |
| **withdraw** | take a post out of the live set by appending a line to the head |
| **seal** | encrypt to chosen keys with the audience inside |
| **hub** | anything that stores and serves the files. It holds no key of yours and makes no decision about who you are |

**Roles.** There are three, and they are not levels — none is more of the protocol than another
(§13). A **publisher** writes files. A **reader** verifies them. A **hub** stores and serves them.

## 3. Files

Everything on the wire is one of four kinds, at four conventional paths under a name the hub gave
you:

| kind | path | overwritten? | signed by |
|---|---|---|---|
| profile | `/<name>/profile` | yes, compare-and-swap | the key the chain currently ends on |
| head | `/<name>/head` | yes, compare-and-swap | the same key — always the current one (§5.6) |
| post | `/<name>/posts/<n>` | no, created once | any key in the chain |
| photo | `/<name>/media/<hash>` | no | nothing — admitted by being listed (§5.4) |

### 3.1. The file format

A signed file is **its body bytes, one `\n`, then the signature over the body**.

- The body MUST be a JSON object encoded as UTF-8, with no leading byte-order mark.
- The signature line MUST be exactly 86 base64url characters, and those characters MUST re-encode
  to themselves when the 64 bytes they decode to are encoded again. Both halves are needed: base64
  admits several spellings of the same bytes, and a verifier that accepts more than one spelling
  accepts a file that is not byte-identical to the one the author signed.
- The body MUST NOT contain a `\n` byte. A verifier splits at the **last** `\n` in the file, so the
  rule exists to make "the line after the body" and "the last line of the file" the same thing for
  every implementation. A compact JSON serializer never emits one.
- The signature MUST be Ed25519 (RFC 8032) over the body bytes exactly as served.

### 3.2. Addresses

**A file's address is the base64url SHA-256 of its body, never of the whole file.** This is a MUST
and not a convention: RFC 8032 permits — and some standard libraries perform — randomized Ed25519
signing, so two honest signings of the same body produce two different files. Addressing the whole
file would make an author's own two copies of one post two different posts, and every hash a head
publishes would depend on which library signed it.

A photo has no body and no signature: **its address is the SHA-256 of its bytes**, and that is the
whole of its verification (§5.4).

### 3.3. No canonicalization

**The bytes served are the bytes signed.** There is no canonical form, no member ordering rule, and
no re-serialization step anywhere in this protocol. A producer serializes once and signs what it
serialized; a verifier hashes and verifies the bytes it received and never rebuilds them.

This is the single largest simplification in the design and it has one consequence a hub operator
must be told: **a host that pretty-prints, sorts members, or adds a trailing newline makes every
file it touches read as forged.** Ordinary servers and proxies do all three unasked. §9.7 makes
serving the exact bytes a MUST for that reason.

### 3.4. JSON hygiene

`JSON.parse` and its equivalents cannot see a duplicate member, treat `__proto__` as an ordinary
member, silently round an integer past 2^53, or reject a lone surrogate — four ways two readers can
disagree about what one signed body says.

A producer MUST NOT emit a body containing a duplicate member name, a member named `__proto__`, an
integer outside ±(2^53 − 1), or an unpaired UTF-16 surrogate. A reader SHOULD reject a body
containing any of them. The rule is asymmetric because only the author can sign: the only party who
can exploit the ambiguity is an author confusing her own readers, so a producer that never emits one
closes it, and a reader that rejects one closes it again.

### 3.5. Extension fields

Unknown members MUST be preserved by anything that stores or forwards a file, because they are
inside the signature. Extension members SHOULD be prefixed with `_`. Extension relation types
(§6.3) are absolute URLs.

## 4. Identity

**Your identity is your genesis key.** Not a URL, not a name, not a domain — a 32-byte Ed25519
public key that you generated and that nobody else ever held. Where you live is a property of your
identity and can change without changing it.

### 4.1. First contact

A reader that learned your key from the host it is now reading has learned nothing: the host chose
both the profile and the key printed in it, and a substituted profile is internally perfect. So a
reader MUST obtain the genesis key by a route the host does not control, and MUST refuse a profile
whose `genesis` is not the key it learned.

Two routes are defined, and both are ordinary product surfaces rather than key ceremonies:

- **A link or a scanned code carries the key.** The "send this link to your people" link a
  departing publisher hands out, and the square scanned across a dinner table, both carry the
  genesis key; the reading app compares and refuses on a mismatch. A link is not a key, and a user
  is never shown one.
- **A spoken code**, for the phone call, and for the moment a person is shown two versions of one
  identity. It is **six words**, and it is derived rather than chosen:

  ```
  bits  = HKDF-SHA256(ikm = genesis key bytes, salt = "", info = "openfeed/v1/spoken", 9 bytes)
  index_i = the i-th 11-bit big-endian field of the first 66 bits, for i = 0..5
  ```

  Each index selects a word from a fixed 2,048-word list; implementations that need to interoperate
  MUST use the BIP-39 English wordlist, which this document does not reproduce. Six words is 66
  bits. The number is load-bearing and is why it is not five or three: a code an adversary can grind
  is a code he can match, and at 40 bits a laptop core finds a colliding key in under a second, at
  which point the ex reads Alice's code back to her mother in Alice's voice.

### 4.2. The profile

```json
{"genesis":"<key>","pseq":3,"name":"Alice",
 "chain":[{"key":"<genesis>"},{"key":"<key2>","by":"rotation","sig":"<86 chars>"}],
 "recovery":{"k":2,"leaves":["<hash>","<hash>","<hash>"]},
 "locations":["https://alice.example/alice"],
 "read":"<x25519 key>"}
```

| member | required | meaning |
|---|---|---|
| `genesis` | MUST | the identity. A reader MUST check this against the key it learned (§4.1) |
| `pseq` | MUST | the version, a non-negative integer that never goes back (§4.6) |
| `chain` | MUST | the hops from `genesis` to the key in use now (§4.3) |
| `recovery` | MUST | the list that can restore you, committed (§4.4). It MAY be empty |
| `locations` | MUST | every place this identity is served from (§4.7) |
| `read` | SHOULD | the X25519 public key others seal to (§4.8) |
| `name` | MAY | a display name |

The profile MUST be signed by the key its `chain` ends on.

`name` exists because apps show a name and an address, and without it the name is whatever path
segment a hub assigned — so every hub decides what Alice is called, and the hub she is leaving
decides it too. It is signed like everything else, so a hub cannot rename her. It is not unique, is
not an identifier, and MUST NOT be used to resolve or match an identity.

There is no `prev` member. A profile does not name its predecessor: nothing in this protocol reads
such a field, the rollback it would catch is caught by `pseq` and by §4.6's chain rule, and a member
nobody reads is a member implementers get wrong.

### 4.3. The chain

The chain is an array of hops. The first hop MUST be `{"key": <genesis>}` and its key MUST equal
`genesis`. Every later hop MUST be one of two kinds, and a reader MUST reject a profile whose chain
contains anything else.

**A rotation** is signed by the key it replaces:

```json
{"key":"<new key>","by":"rotation","sig":"<86 chars>"}
```

`sig` is an Ed25519 signature by the **previous** hop's key over the ASCII bytes
`<previous key>-><new key>`, where both keys are their base64url spellings. It is verified with the
same 86-character rule as a file's signature line (§3.1).

**A restore** is vouched by members of the recovery list:

```json
{"key":"<new key>","by":"restore",
 "court":{"k":2,"leaves":["<hash>","<hash>","<hash>"]},
 "vouchers":[{"key":"<voucher key>","salt":"<salt>","sig":"<86 chars>"}]}
```

Each voucher's `sig` covers the same `<previous key>-><new key>` bytes, signed by that voucher's own
key. A voucher counts when its signature verifies **and** `SHA-256(salt ‖ "|" ‖ voucher key)`,
base64url, is one of `court.leaves`. The hop is valid when the number of **distinct** voucher keys
that count is at least `court.k`.

**A restore hop MUST carry the recovery list it satisfied** — the list as it stood *before* the hop —
in `court`. This is not redundancy with the profile's own `recovery`: the profile's list is the one
that governs the *next* restore, so without the carried copy a reader meeting this identity for the
first time cannot walk the chain at all, and an author who edits her recovery list after a restore
breaks her own chain for every reader.

**A restore changes the key and nothing else.** It MUST NOT be accompanied, in the same profile
version, by a change to `locations`, `recovery`, `name`, or `read`. One sentence, and it converts a
permanent takeover into one the owner's own people can undo.

A post signed by a key that was once hers but is not in the chain is simply not hers (§8.4). That is
how a stolen old key is closed without any revocation mechanism.

### 4.4. The recovery list

```json
"recovery": {"k": 2, "leaves": ["<hash>", "<hash>", "<hash>"]}
```

Each leaf is `SHA-256(salt ‖ "|" ‖ member key)` in base64url, with a distinct random salt per
member. A member vouching reveals only their own salt and key, so the rest of the list stays hidden;
nobody learns who else could restore you, and a reader can still check membership exactly.

The **count** of leaves is public and MUST be, because a majority has to be counted against
something (§4.6). `k` is the threshold the *author* set for a restore to be valid at all.

The list MAY be empty. The requirement is *named in advance*, never *social*: a list may hold
people, or a key you keep yourself — a printed code, a passkey, a password manager — or your host,
or nothing. An app SHOULD name at least one recoverer, and the owner's own backup key counts.
**Whoever names nobody has no court** (§4.6), and an app SHOULD say so plainly rather than let the
choice be silent.

A restored identity SHOULD be flagged "recently restored" for seven days by reading apps. That flag
is presentation, not a verdict (§8.3), and the permanent record of who vouched stays in the chain.

### 4.5. Rotating and restoring in practice

Changing the key means writing the profile **and** the head again, because the head MUST be signed
by the current key (§5.6). An app SHOULD also rotate when the recovery list changes, because a
changed list reaches other readers' courts only through a hop (§4.6).

### 4.6. Contests: two profiles claiming one identity

A thief holding a key of hers can publish a profile whose chain walks perfectly from her genesis.
Checking that the chain walks is therefore not a test of anything. Four rules settle it, and a
reader MUST apply all four.

1. **The pin holds the chain, and a served chain MUST extend it key for key.** The first index at
   which a served chain differs from the pinned one is the **split**. A profile at a *higher* `pseq`
   whose chain is a strict *prefix* of the pinned chain is a split too, at the end of the prefix —
   that is the thief pretending her restore never happened. Checking that a chain walks does not
   catch him: his walks.
2. **A court is kept per chain length: the first recovery list the reader ever saw at that length**,
   whether from a profile's `recovery` or from a restore hop's `court`. A court MUST NOT be
   overwritten. So a thief who holds the key and rewrites the list before forking changes nothing
   for a reader that already held one.
3. **A pinned reader judges a restore by the list it holds, never by the copy the hop carries.** The
   carried copy (§4.3) exists for readers with no court; a reader with one MUST NOT prefer it.
4. **A majority of the court at the split wins.** More than half of that list, on exactly one side.
   If both sides reach a majority, or neither does, the identity is **contested** (§8.3) and the
   reader follows no branch.

**Majority, and not `k`.** They differ on one case, and it is the case the protocol exists for: *the
ex is on her recovery list, and he vouches for himself, while Alice merely rotates her key.* Under a
threshold of `k`, one listed adversary hands himself her identity. Under a majority he cannot, ever,
alone. **The price is stated because it is real:** a one-of-two restore against a bare rotation
stays contested until a second member vouches, so a person recovering while an adversary holds her
old key waits on a second voucher. That is the trade, taken deliberately.

Two limits a reader cannot escape and an app MUST NOT hide:

- **A cold reader's court is whatever the first profile it saw carried.** A reader that first meets
  an identity on the thief's branch will reject the real one later. Only a reader that pinned before
  the split — or a person who can ask one who did — can run the rule correctly.
- **A list change reaches other readers' courts only through a hop**, which is why §4.5 asks an app
  to rotate when the list changes.

Against a pin, and outside a split: `pseq` MUST NOT go backwards, and the same `pseq` with a
different address is contested.

### 4.7. Locations and moving

`locations` lists every place this identity is served from. A reader MUST remember every location a
verified profile has ever named and SHOULD try the others when one stops answering. Moving is
writing your files somewhere else and publishing a profile with a higher `pseq` naming the new place.

Readers who never learn the new location are the honest limit of this design. The mechanism that
reaches them is **the address riding along in other people's posts** (§6.4): a reply carries its
target's location as the replier currently knows it, and a reader that sees a newer location in a
post it has verified follows it there. A cousin with any social path to the departing person finds
her; a reader with none does not. §14.3 states what that reader sees.

Because a sealed post's target is inside the envelope (§7.6), relocation rides along in **public**
replies only.

### 4.8. The reading key

`read` is an X25519 public key, and it is what others seal to (§7). It is separate from the signing
key by necessity rather than taste: deriving one from the other is Edwards-to-Montgomery field
arithmetic that no mainstream standard library exposes, and priority 1 forbids adding one.

**The reading key is not socially recoverable.** A restore returns your name, not your archive. What
was sealed to you was usually also sealed to others, who can re-seal it to your new reading key;
what was sealed to you alone is gone unless your app backed the key up. Escrowing it with a single
voucher would let a listed adversary read everything you ever received, which is the same person
§4.6 exists to stop.

A publisher MUST seal only to a `read` key taken from a profile it verified (§8.2). A sealer that
lifts the key off whatever the host served is sealing to the host: the substitution attack of §4.1,
wearing a different coat.

## 5. The head

```json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>","pending"],["<photo hash>"]],
 "hseq":9,"top":3}
```

The head is the answer to "what exists now." It MUST be signed, it MUST live at `/<name>/head`, and
it is the one file besides the profile that is legitimately overwritten.

| member | meaning |
|---|---|
| `entries` | the lines, in order. The live set is the **fold** of them (§5.2) |
| `hseq` | the version, a non-negative integer that MUST NOT go backwards |
| `top` | the highest post number ever issued, which MUST NOT decrease (§5.3) |

`entries` MUST come first in the serialized body. This is the one member-order requirement in the
protocol and it is not a canonicalization rule: appending a line then leaves every earlier byte
where it was, so a reader that cached the file can fetch only the tail — *including across a
withdrawal*, which is what makes an append-only head cheap enough to be the shape at all.

There is no `prev` member, for the reason given in §4.2.

### 5.1. What the entries mean

| line | means |
|---|---|
| `[n, hash]` | post number `n` exists, and its address is `hash` |
| `[n, hash, "pending"]` | post `n` exists at that address but the device has not released it (§5.5) |
| `[n, null]` | post `n` is withdrawn |
| `[hash]` | the photo with that address exists (§5.4) |
| `[hash, null]` | that photo is withdrawn |

### 5.2. The fold

A reader computes the live set by folding the entries in order, and a head that does not fold is
invalid. A reader reports **host** (§8.3).

**That verdict names the wrong party, and the choice is deliberate.** A head that verifies and does
not fold can only have been produced by the author's own key — a hub cannot make one, because it
cannot sign. So the fault is a broken publisher, not a misbehaving host. It is reported as `host`
anyway, because the alternative is a fourth reader state for a case that means "these files do not
hang together" and nothing more, and §8.3's count of three is worth more than the distinction. An
app SHOULD word this one as *the files at this address do not make sense* rather than as an
accusation against the operator.

- **A number is issued once.** For a numbered line, if `n` has appeared before, the line is legal
  only if the previous record for `n` was `pending` and this line carries the *identical* hash — that
  is a confirmation (§5.5) — or the line is a withdrawal. Anything else makes the head invalid. A
  reader therefore never has to decide which of two hashes for one number is real.
- **A withdrawal MUST refer to something live.** `[n, null]` for a number that is not currently live
  makes the head invalid. So does `[hash, null]` for a photo that is not listed.
- **A photo is new whenever it appears.** `[hash]` for an address already live makes the head
  invalid.
- `top` MUST be greater than or equal to the highest number issued anywhere in `entries`.

### 5.3. `top`

`top` is the highest post number ever issued and it MUST NOT decrease, even when the post holding
that number is withdrawn.

This is load-bearing, not bookkeeping. §8.5's rumor rule says a reply naming a number *above* the
top of the head a reader holds is worth looking into. Without a `top` that outlives its post,
withdrawing your newest post lowers the highest number listed — and every reply to it becomes a
rumor naming the replier, raised over a post you deliberately deleted.

### 5.4. Photos and attachments

A photo is the one unsigned file. **What admits it is being listed in the head; what checks it is its
hash.** It lives at `/<name>/media/<hash>` where `<hash>` is the base64url SHA-256 of its bytes, and
a reader MUST verify that the bytes it fetched hash to the name it fetched them under.

Photos are listed in the head rather than left to the posts that reference them, so that retention is
one rule and reaches **sealed** posts, whose references the host cannot read. A photo referenced by a
post but not listed in the head is simply not there: the post reads fine and the photo is absent.

A photo attached to a sealed post is sealed too: the bytes at the listed hash are ciphertext, the
reference to it is inside the envelope, and the hub learns that a blob of some size exists and
nothing else.

### 5.5. Pending posts

A scheduled post is published as `[n, hash, "pending"]`. A reader MUST NOT fetch a pending post and
MUST NOT treat its absence as withholding — the device has not released it, and no reader's clock
decides otherwise.

**A pending entry is confirmed by appending a bare `[n, hash]` line with the identical hash, never by
rewriting the file.** A rewrite (§5.7) MUST carry a pending entry through still pending. Confirming
by rewrite releases every scheduled post the moment the file is compacted, and the reader that then
fetches bytes the device never sent reports the host.

The stated cost: a host sitting on a scheduled post is uncalled until the author next publishes, and
never if she never does.

### 5.6. The head is signed by the current key

**The head MUST be signed by the key the profile's chain currently ends on.** Not by any key in the
chain — by the current one.

This is the mechanism and not a formality. The head is what admits posts. A thief holding a
rotated-out key can sign a head, so if a reader accepted a head from any chain key, the thief would
go on deciding what counts as hers and a restore would take nothing back. **Re-signing the head is
what a restore actually restores.**

The consequence is a window: between the two writes a rotation takes, an honest host is serving a
head signed by a key the profile no longer ends on. §8.2 handles it — an unverifiable head is not an
accusation.

### 5.7. Rewriting

A withdrawal is an appended line, and the lines it leaves behind go when the author next rewrites the
whole file. **How often is the publisher's setting, and readers are indifferent to where it sits.**
A reader that last saw `hseq` 1 and returns at `hseq` 6, across two rewrites and an append it never
saw, accepts, is told what was withdrawn, and raises nothing false.

A suggested default is once a month. It is a **privacy decision and never a size one**: the leftover
lines are about 6% of the file. What rewriting buys is that a withdrawn post's line stops being
visible to readers who arrive later and to the public. What it does not buy is anything at all
against a custodian who kept every version he ever served (§14.1).

## 6. Posts

```json
{"n":7,"at":"2026-08-01T09:00:00Z","text":"the divorce is final",
 "rel":"reply",
 "target":{"key":"<genesis>","n":3,"hash":"<hash>","at":"https://mom.example/mom"},
 "media":["<photo hash>"]}
```

A post is immutable, created once, and signed by any key in its author's chain at the time of
writing.

### 6.1. `n` — the post's own number

**A post MUST declare the number it is published at, inside its signed bytes**, and both the reader
(§8.4) and the host (§9.5) check it.

At the reader it catches a host serving genuine post 2 at the name 7. At the host it is half of the
reclaim rule: without it, a stranger replays a genuine post of hers into a number she has not reached
yet, and it is signed by her own chain. A signature test alone is not enough; the number in the bytes
is what makes the file *this* post.

### 6.2. `at` — content time

`at` is an ISO 8601 timestamp, and it is what apps display and order by. **It is never a verdict.**
Nothing in this protocol decides an authenticity, freshness, or precedence question from a wall clock
(§14.2).

### 6.3. `rel` — what kind of post this is

`rel` is `reply`, `root`, `like`, `repost`, `quote`, `mention`, or `supersedes`, or an absolute URL
for anything else. A reply, a reaction, and a private message are all posts; there is no separate
mechanism for any of them.

**An edit is a new post that withdraws the old one**, with `rel: "supersedes"` pointing back at it.
There is no in-place revision and no version history to walk.

### 6.4. `target` — what this post answers

```json
"target": {"key":"<author genesis>","n":3,"hash":"<43 chars>","at":"https://mom.example/mom"}
```

All four members are REQUIRED on a post that has a `rel` naming another post. `key` is the target
author's genesis key — never a URL, because the URL can change and the identity cannot. `at` is where
the replier last knew that author to live, and is the relocation mechanism of §4.7.

`hash` MUST be the full 43-character address of the target post, and **a reader MUST treat a reply
whose target hash does not match the hash the target's head lists as a reply to something else.**
Without that check the full hash is decoration. With it, an author cannot show her mother one post
and her cousin another at the same number and have both threads look right: the equivocation costs
her a second preimage on SHA-256 rather than a collision on a prefix.

There is no pin carried on a post. A post says what it answers, and that is the whole signal.

### 6.5. `media`

An array of photo addresses (§5.4). On a sealed post the `media` member is inside the envelope, so
the public file carries none.

### 6.6. Private messages are posts

A direct message is a post sealed to one person, living on the sender's own host. There is no inbox,
no dead-drop, and no push.

Two consequences, both stated because neither is obvious to the person being protected. The host
cannot read it (§7), but it learns **the shape of the correspondence** — how many, how often, how
big, fetched by whom — and it can withhold any of them, which to the recipient looks like the sender
going quiet. And **a signed private message is provable by its recipient forever**, withdrawn or not:
that is what per-post signatures mean. For the driving scenario, that is mostly evidence in the
victim's hands.

## 7. Sealed content

Three visibilities, one mechanism: public; sealed to a chosen set of reading keys; and a direct
message, which is that set with one member in it. Comments and reactions on a sealed post are sealed
in turn.

A sealed post is an ordinary post whose content sits in a `sealed` member:

```json
{"n":5,"at":"2026-08-01T09:00:00Z",
 "sealed":{"epk":"<x25519 key>","slots":[["<tag>","<wrapped>"],…],"ct":"<ciphertext>"}}
```

**Nothing about signing changes.** A sealed post is signed and addressed exactly as any other post
(§3), the head lists it exactly as any other post (§5), and a reader that cannot open it verifies it
completely and returns it with the field opaque (§8.4). There is no second signing construction in
this protocol, and this is where that claim is tested.

### 7.1. The envelope

One X25519 ephemeral key pair per message. For each recipient reading key `R`:

```
Z                            = X25519(ephemeral private, R)
tag(8) ‖ kek(32) ‖ knonce(12) = HKDF-SHA256(ikm = Z, salt = epk, info = "openfeed/v1/slot", 52 bytes)
wrapped                      = ChaCha20-Poly1305(key = kek, nonce = knonce, plaintext = content key,
                               aad = epk)
```

and the content, once:

```
plain   = UTF-8 JSON of {"audience": [...], …the post's content members…}
padded  = 2-byte big-endian length of plain, then plain, then zeros to a bucket (§7.4)
ct      = ChaCha20-Poly1305(key = content key, nonce = 12 zero bytes, plaintext = padded,
          aad = epk ‖ carrier)
```

`epk` is the ephemeral public key, base64url. Every slot is a `[tag, wrapped]` pair of base64url
strings. The content key MUST be 32 random bytes and MUST NOT be reused across messages; the
all-zero nonce is safe for exactly that reason, as in HPKE.

### 7.2. Carrier binding

**The content's associated data MUST be `epk ‖ carrier`, where `carrier` is the ASCII bytes
`<author genesis key>:<post number>` of the post the envelope is published in.**

Without it the attack is live: the thief lifts Alice's sealed envelope out of her post, drops it into
a post of his own signed by his key and listed in his head, and her family's clients decrypt it and
**render her words under his name** — from an envelope he could never read. He is not forging a
signature; he is re-parenting a ciphertext.

Binding it as associated data rather than as fields compared afterwards is the point: with AAD there
is no "forgot to compare." A client that passes the wrong carrier, or none, does not open the
envelope at all. It costs zero bytes.

### 7.3. Slots, and what a tag is

A recipient derives its own tag from its own `Z` and scans the slots for it. **A tag is a hint, never
a decision.** A match whose unwrap fails is a collision, and the reader MUST keep scanning rather
than conclude the message is not for it. An implementation that ignores the tags entirely and tries
every slot is conformant and merely slower — which is the test of whether a tag decides anything.

Tags are blinded per message: they are derived through the message's own ephemeral, so the same
recipient's tag differs on every post and an observer holding every public reading key in the family
can derive none of them.

### 7.4. Padding

`bucket(n, floor)` is the greater of `floor` and the next power of two at or above `n`. Slots are
padded to `bucket(slot count, slot floor)` with dummies — a dummy is a tag nobody can derive and a
wrap nobody can open, and MUST be indistinguishable in width from a real slot. The body is padded to
`bucket(length + 2, body floor)`.

**A publisher SHOULD use a floor of 8 slots and 512 bytes**, so that a message to one person is the
same size as a message to the family. Without it, power-of-two padding alone still tells a 346-byte
DM from a 766-byte family post, and the host reads the difference off the file listing without
opening anything.

It is a SHOULD and not a MUST, with the price stated: the floor costs about 1.1 KB per direct
message, and a minimal implementation that skips it is still conformant — which priority 2 requires,
since a weekend implementation that cannot be conformant is a specification failure rather than an
implementer's.

### 7.5. The audience is inside

`audience` MUST be the recipients' reading keys, sealed in the plaintext, and a publisher MUST
include **itself** in the audience or it cannot read its own outbox.

The audience is inside so a recipient learns who else can answer. Without it, a reply to a
family-only post reaches the original author and nobody else, silently: the replier's app knows only
the author's key, so the rest of the family never see the reply and are never told it exists, and the
thread splits in half with no error anywhere.

The audience is never in a header, and the slot tags never name a key. What the host learns is that a
sealed post exists, when, and roughly how big.

### 7.6. A sealed post's target

**On a sealed post, `rel`, `target`, and `media` go inside the envelope.** The public file carries
`n`, `at`, and `sealed`, and nothing else about what it answers.

This is a deliberate trade. In the clear, the rumor rule (§8.5) works for every reader — and every
hub operator reads the reading graph off his own disk: *Jesse answered Mom's post 3*, *Cousin liked
Mom's post 1*, per post, without opening anything. Sealed, only the recipients can raise a rumor
about a sealed reply — and they are the only people for whom it is a reply at all.

A public post keeps `rel` and `target` in the clear, so public threading, public relocation (§4.7),
and the rumor rule are unaffected for everything a stranger could see anyway.

## 8. The reader

A reader is given three things: the genesis key it learned (§4.1), a location to read from, and
optionally the pin it kept from last time. **The order of operations below is normative** — each step
supplies what the next one checks, and a reader that reorders them is checking something else.

### 8.1. Profile, chain, court

1. Fetch `/<name>/profile`. A profile that is not served at all is **host** — the hub has a path
   for it and did not answer. A body that does not parse under §3.4's rules is **identity**: the
   reader cannot tell a garbled file from a substituted one, and either way it has nothing verified
   to say who this is.
2. If `genesis` is not the key this reader learned, stop: **identity**.
3. Walk the chain (§4.3). If any hop fails, stop: **identity**.
4. Verify the file's signature under the key the chain ends on. If it fails, stop: **identity**.
5. Record a court for every chain length this profile carries a list for, keeping any court already
   held (§4.6 rule 2).
6. Against a pin: apply §4.6. A split is settled by the court's majority, and the reader either
   follows the branch the court chose, reports **host** for a branch the court rejected, or stops at
   **identity: contested**. With no split, a lower `pseq` than the pin is **identity**, and an equal
   `pseq` at a different address is **identity: contested**.

### 8.2. The head

7. Fetch `/<name>/head` and verify it under the **current** key (§5.6). Fold the entries (§5.2) and
   check `top`.
8. **A head that will not verify is not an accusation.** A reader holding a head it verified itself
   keeps that one, notes *"no head I can verify"*, and says nothing further. Only a reader holding
   none reports **host**.

   The note is worded that way because a garbled file, a 404, a head signed by a rotated-out key, and
   an honest host caught mid-rotation all produce exactly this, and the reader cannot tell them
   apart. A **cold** reader — one with no pin — SHOULD retry the whole read once before reporting
   `host`. The rotation window is one request wide under either write order, nothing the publisher
   can do closes it, and the retry has to re-fetch the profile as well as the head, because which of
   the two is the stale one depends on the order the publisher wrote them in.
9. Against a pin: `hseq` MUST NOT go backwards; the same `hseq` at a different address is **host**;
   `top` MUST NOT go backwards; and for every live numbered entry at or below the pinned `top`, the
   post MUST have been live before at the identical hash. A number at or below the old top that was
   never there is **host**. Numbers the pin held that are no longer live are noted `withdrawn: n`.

   Photos are exempt from that last check: a photo has no number and so no `top`, and a new one is
   always new.

### 8.3. Three verdicts, and notes

A read returns exactly one of three verdicts, and a conforming reader MUST NOT invent a fourth:

| verdict | means |
|---|---|
| **ok** | everything checked out |
| **this host is misbehaving** | the files served do not hang together, and withholding, swapping, or rolling back is what would do it (see §5.2 for the one case where the label is charged to the wrong party) |
| **this identity is in question** | who this is cannot be settled from here |

`recently restored`, `withdrawn: n`, `pending: n`, and `no head I can verify` are **notes on an ok
read**, not verdicts. Keeping that distinction is what holds the count at three, and an
implementation that promotes a note to a state has four states and one of them cries wolf.

Which verdict covers what is not free-form. A frozen copy — an old profile served forever by a host
the author has left — reads as **identity: an older profile than the one this reader saw**, because
two claims about one identity are in play and this reader has seen the newer one. It is not a
misbehaving host: the host is serving exactly what it has.

### 8.4. Posts

10. For each live entry that is not pending: fetch it, and

    - for a **photo**, check the bytes hash to the listed address; if not, **host**;
    - for a **post**, verify its signature under **any key in the chain**, check its address equals
      the hash the head lists, and check its `n` equals the number it was served at. Any failure is
      **host**.

    A listed file that is not served is **host**. A sealed post is verified exactly like any other and
    returned with `sealed` opaque; opening it is the client's business (§7), not the reader's.

### 8.5. Targets, and the rumor rule

11. For each post naming a target whose author this reader holds a pin for: if the target number is
    at or below that author's `top`, say nothing — it is a withdrawal or a supersession, and the head
    is signed, so the host cannot have edited it. If it is **above** the top, look again.

Two bounds are REQUIRED, and a reader without both is a weapon:

- **Look again at most once per identity per pass.** Not once per reply.
- **Say one line per person**, however many replies they wrote.

Without them, a thousand replies naming numbers that never existed cost a thousand fetches aimed at
somebody else's host and print a thousand messages.

What is said is a rumor and never an accusation: *"X replied to something I cannot see,"* naming the
replier, because that is the only party the reader has evidence about.

**Following a reply's `at` is both the feature and a beacon.** It is how a reader with no other path
finds someone who moved (§4.7) — and it tells whoever wrote that reply the address and moment of
every reader that holds a pin for the name he targeted, once per identity per pass. A reader MAY try
the locations it already holds before the address in the reply. The griefer's cost is one hit per
reader per pass and one line naming him; that is the whole of it, and it is stated rather than
hidden.

## 9. The publish interface

Three paths, two verbs, one conditional header. **There is no account, no token, and no session: the
request is the signed file.** Anyone's client can write to anyone's hub, which is the point — a hub
that ships the app can take the key, so bring-your-own-client is a security property and it needs an
interface.

```
PUT /<name>/profile        If-Match: <etag>      → 200 · 412
PUT /<name>/head           If-Match: <etag>      → 200 · 412
PUT /<name>/posts/<n>                            → 201 · 200 (reclaimed) · 409
PUT /<name>/media/<hash>                         → 201 · 200 (replaced) · 409
GET any of the above                             → 200 · 404
```

### 9.1. Compare-and-swap on the two overwritable files

The profile and the head are overwritten, so two devices can clobber each other on them. A writer
MUST send `If-Match` with the entity tag of the version it read, and a hub MUST refuse with 412 if
the file has moved since. The entity tag is opaque to the writer; a hub MAY use the SHA-256 of the
bytes it is serving.

**A writer that loses the race MUST re-read the file the hub is now serving and fold its own line
into that**, not re-send its own idea of the list. The naive retry silently drops the other device's
post, and the loss reads to every reader as an ordinary withdrawal — so nothing, anywhere, reports
it.

### 9.2. Create-once on numbered posts

A post is created once. A hub MUST refuse a write to a number that is already held, except under
§9.5. A publisher that loses retries at the next number.

**Numbering need not be gapless.** A crash between the post write and the head write burns one
number, and a reader is indifferent: a number nobody lists is nothing. What matters is the rule that
falls out — **a device that comes back MUST abandon a number it cannot prove it listed, and MUST NOT
list one late.** A pinned reader's check that a number at or below the old top cannot appear that was
never there (§8.2) is exactly the check that catches a custodian backdating a post into her history,
and it cannot tell the two apart. Same rule, opposite intent.

### 9.3. Write order

**The post is written before the head that lists it.** A head listing bytes that are not there yet is
`host` to every reader until they land; a post nobody has listed is nothing to anybody.

### 9.4. Claiming a name

First come, with the profile as the proof. Later writes under that name MUST carry the same `genesis`
and a `pseq` that has advanced.

**A publisher MUST write a head when it claims a name**, even an empty one. Otherwise a brand-new
identity on a perfectly honest hub reads as `host: no head served` — "this host is misbehaving," at
the moment Grandma signs up. The alternative, treating no-head-at-all as an empty head, reopens
withholding the whole head for free.

### 9.5. Reclaiming a squatted number

**A number held by a file that is not the owner's MAY be reclaimed by the owner, and by nobody else.**
"The owner's file" means signed by a key in the chain of the profile at that name **and** declaring
that number in its body (§6.1).

Without this, create-once turns an unchecked write into a permanent block: a stranger PUTs five
posts at numbers she has not reached, signed by his own key, and her own posts at those numbers are
refused forever — for five requests and her address. The rule does not turn around. He cannot take
back what she reclaimed, cannot overwrite a genuine post of hers, and she cannot overwrite her own.

A hub MAY check nothing on the ordinary path. It MUST NOT ignore a collision.

### 9.6. The same rule for photos

**A hub MUST replace a file at `/<name>/media/<hash>` whose bytes do not hash to that name, when
offered bytes that do.** This is the content-addressed twin of §9.5, and the failure it prevents is
worse than a refusal: a stranger PUTs 100 bytes of junk at the address of her photo before she
uploads it, her own bytes are refused as a collision, and **her readers accuse her host** — `photo …
is not what the head lists` — over a file the host received honestly.

### 9.7. What a hub MUST do

- **Serve back the exact bytes it was given.** Pretty-printing, sorting members, or appending a
  newline each make every file read as forged (§3.3).
- **Allow cross-origin reads** (`Access-Control-Allow-Origin: *` on everything publicly readable),
  or no browser-based reader can read across hosts — and a browser is a first-class reader.

A hub MAY require more of its own writers — a pass, an account, a rate limit, a bill. That is the
market, not the protocol, and none of it touches the floor: whatever a hub does, it can never write
as you, because it cannot make your signature. The worst it can do is refuse you or delete things,
which it can do anyway.

### 9.8. Withdrawal, and whether anything is ever deleted

Withdrawing a post removes it from the live set. It does not remove the file: there is no DELETE
verb, an author cannot overwrite her own post, and the fold refuses a withdrawal of something that
was never listed (§5.2). Against a custodian this is moot — he kept every byte he ever served.

**A hub MAY remove a numbered or hashed file that the current head does not list**, after a grace
window long enough to cover the write order of §9.3. This is what lets an honest hub honour a real
deletion request. It is a MAY because no reader depends on it either way, and an app MUST NOT tell a
user that withdrawing erased anything.

## 10. Fetching

Every rule in this section binds a reader's outbound requests, and none of it is optional politeness.
The rumor rule (§8.5) follows a URL that a **replier** chose, so a reader's fetch layer sits in front
of attacker-supplied addresses by design.

- **HTTPS only.** Certificates validated.
- **At most 5 redirects, and never to a different origin.** A cross-origin redirect is never identity
  equivalence: moving is expressed in the profile (§4.7), not in a `Location` header. Each hop is
  re-checked for scheme and address.
- **Refuse non-public addresses.** The check is on the **resolved** address, never on the hostname —
  a hostname tells you nothing, and an attacker controls their own zone — so a reader hooks name
  resolution and checks what came back before the socket connects. Checking after connecting leaves a
  rebinding window. Address literals in the URL are checked as well, because resolution is never
  called for them.

  Blocked IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`,
  `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`. Blocked
  IPv6: the unspecified address, loopback, link-local, unique-local, and **every embedded-IPv4 form
  judged as the IPv4 address it carries** — `::ffff:a.b.c.d`, the deprecated `::a.b.c.d`, the
  translated `::ffff:0:a.b.c.d`, NAT64's `64:ff9b::/96` and `64:ff9b:1::/48`, and 6to4's `2002::/16`.
  Each of those reaches loopback through an address a naive IPv6 check waves through.

  A dotted quad with a leading zero MUST be refused rather than guessed at: `0177.0.0.1` is octal to
  some resolvers and decimal to others, and that disagreement is itself the bypass.
- **Bound everything.** A timeout covering connect, redirects, and body read together (10 s
  RECOMMENDED); a body cap per fetch (1 MB RECOMMENDED for the profile and head, larger for photos);
  a cap on concurrent sockets per origin (10 RECOMMENDED); and a cap on how many identities one pass
  will resolve. The last one is the fan-out bound the byte caps do not imply — without it, one
  hostile head converts one read into thousands of fetches at attacker-chosen origins.

A reader that hits a cap has an **unverifiable** read, not an accusation: it ran out of budget, and
the publisher may have done nothing. The same holds for a fetch that fails for transport reasons — a
timeout, a reset, a name that does not resolve. A reader SHOULD retry before reporting **host**, and
SHOULD distinguish "I could not reach this" from "this was answered, and wrongly." Only the second is
evidence about a hub.

## 11. Your copy

**An app MUST keep the signed bytes of everything it publishes.** Not the text, not a database row —
the bytes, with the signature line on the end.

This is floor item 3, and it is one rule with three consequences that no host has to cooperate with:

- **Those bytes verify with no host in reach.** A post signs itself, so a copy of it proves its
  author to anyone holding it, forever. There is no export format and no bundle to define, because
  the file on the wire is already the archive format.
- **Anyone you published to is a backup nobody set up on purpose.** Your readers hold what they were
  allowed to see and can hand it back; it verifies as yours. It covers only what they could see and
  proves nothing about completeness — a fallback, not a guarantee.
- **Your own last head is the index.** It says which numbers exist, so an app rebuilding after a
  phone loss knows exactly what is missing and can ask a named relative for a named list, rather than
  hoping. The same arithmetic gives a reading app an honest readout — "holding 1,204 of your 1,557
  posts" — and gives the next app you install something to check on import.

Leaving is therefore writing the same files somewhere else. The host is asked for nothing, and there
is nothing for it to refuse.

## 12. Generated views

A publisher SHOULD serve a JSON Feed 1.1 document, an Atom feed, and an h-card page, generated from
the head and the posts. They are how this protocol reaches readers that have never heard of it.

**Nothing in a view is signed, and a view is never the head.** A view is something a host can
regenerate; the head is something only the author's key can produce. A host that edits a post inside
the feed view is invisible to every feed consumer and caught immediately by any reader that fetches
the post file, because the head names its address — and nothing anywhere says which of two feeds is
the real one. An implementation MUST NOT treat a view as evidence of anything.

- **Item ids are `urn:openfeed:<genesis key>:<n>`.** Not the URL: a URL id makes every post reappear
  as unread in every plain feed reader on the day the author relocates, and the number is what the
  head and every reply already name.
- **Withdrawn posts are absent** from every view.
- **Sealed posts are omitted**, or rendered as an empty placeholder item at their number. A view MUST
  NOT carry ciphertext: it is unreadable to every consumer of the view by definition, and publishing
  it hands a scraper the envelope.
- The h-card's name is the profile's `name` (§4.2) when present. A link on that page MAY carry the
  genesis key in its fragment, which never reaches the server — but a reader that learned the key
  *from a page the host served* has learned it from the host, and §4.1 still applies.

## 13. Conformance

Three roles. They are independent: implementing one says nothing about the others, and none of them
is a level of the others.

**A publisher** MUST produce files per §3, sign the profile and head with the current key (§4.2,
§5.6), maintain the chain (§4.3), write posts before heads (§9.3), write a head when it claims a name
(§9.4), fold correctly when it rewrites (§5.7), keep the bytes it publishes (§11), and re-read and
re-fold on a lost compare-and-swap (§9.1). It SHOULD generate the views of §12, and SHOULD pad sealed
content to §7.4's floor.

**A reader** MUST obtain the genesis key out of band (§4.1), perform §8's steps in order, apply the
contest rules of §4.6, honour §8.3's three verdicts without adding a fourth, apply both bounds of the
rumor rule (§8.5), and enforce §10 on every outbound request. It SHOULD reject bodies that violate
§3.4.

**A hub** MUST serve exact bytes and allow cross-origin reads (§9.7), enforce compare-and-swap on the
profile and head (§9.1), enforce create-once on numbered posts (§9.2), resolve a collision under §9.5
and §9.6 rather than refuse it, and hold no signing key of any user. It MAY do anything else it likes
about who may write.

## 14. Security considerations

### 14.1. The adversary this is built against

A hub operator who is inside the family. He is entitled to look, he controls the serving path and
everything anyone sends her, he supplies the client if he can, and he will not cooperate. Read this before touching
anything security-relevant.

What the protocol gives that person's victim is **exit**, and exit is the only answer offered. The
key was generated on her device and he never held it (floor 1). Content sealed to chosen keys is
unreadable to him however completely he owns the disk (floor 2). Her copy is hers and her readers
hold the rest, so leaving is writing the same files elsewhere and asking him for nothing (floor 3,
§11). Her family on other hubs were never on his (floor 4).

What it does **not** give her: confidentiality *from* him for anything he was an audience member of,
protection from him deleting or refusing to serve, or any recourse that runs through him.
Implementations MUST NOT market audience control or encryption to this user as protection from her
own host.

One thing is worth stating in his direction rather than hers. Every rewriting attack he can mount is
against **what a reader has not yet seen**. What a reader already verified is pinned, and he cannot
alter it, drop it without a signed withdrawal, or roll it back, because he cannot sign.

### 14.2. Where a clock appears — the whole list

A wall clock never gates a security verdict. This list is the check on that claim, and a mechanism
that adds a row to it is adding a clock to a security decision:

| where | whose clock | what it decides |
|---|---|---|
| `at` on a post | the author's | what is displayed, and the order a UI shows |
| a pending post's release | the author's device | when the device confirms the entry — never a reader (§5.5) |
| "recently restored", 7 days | the reader's | a flag beside a name, with no verdict attached (§4.4) |
| the rewrite cadence | the publisher's | how long a withdrawal's leftover lines live (§5.7) |

### 14.3. What is not defended, stated plainly

- **Staleness is indistinguishable from silence.** A reader cannot tell a host that has stopped
  serving updates from an author who has gone quiet, and this is by design: §8.2 makes an
  unverifiable head a note rather than an accusation, and the alternatives — a declared next-post
  deadline, a heartbeat — buy the signal without buying a way out, at the cost of a fourth reader
  state and a clock in a verdict. A hostile host can therefore freeze every pinned reader where it
  stands, and the frozen readers carry a note the stalled ones do not. An app MAY surface "no new
  head in N days" as interface; it is not a protocol state and MUST NOT be reported as one.
- **A frozen copy reads as stale only to a reader with a social path.** After Alice leaves, the ex
  can serve her last honest profile forever. A reader that has learned her new address reads that
  copy as `identity: an older profile than the one this reader saw`. A reader with no social path to
  her — no reply from anyone, no link — sees an unmarked page and has no way to know. §4.7 is the
  mechanism that reaches everyone else, and it reaches them through public replies only.
- **A cold reader's court is whatever its first profile carried** (§4.6). A reader that first meets
  an identity on a thief's branch will reject the real one when it appears.
- **The shape of a correspondence is visible even when its contents are not.** How many sealed posts,
  when, roughly how big, fetched by which address. §7.4's floor hides one distinction — a message to
  one person from a message to the family — and nothing hides the rest.
- **A signed private message is provable by its recipient forever** (§6.6).
- **First contact after a hijack is unprotectable**, by definition: a reader with no prior knowledge
  of the identity accepts the first key it is shown, and §4.1's whole purpose is to make sure that
  key came from somewhere else.

### 14.4. Implementation notes

- **Never attribute unsigned content.** Display unverified content distinctly and never cache it as
  verified.
- **Escape or sanitize anything not authored locally**, always. A post is attacker-controlled text
  until it is rendered safely, verified or not.
- **Cap thread walk depth.** `reply` graphs from malicious parties may contain cycles.
- **Compare secrets in constant time**, including slot tags (§7.3).
- **Bound every store keyed on an identity a reader met in someone else's post.** Those are
  first-contact pins that nothing else references; evicting one costs exactly what never having
  fetched it would. Evict whole identities rather than old entries.

## Appendix A: Media types

| kind | media type |
|---|---|
| profile, head, post | `application/openfeed+json` |
| generated JSON Feed view | `application/feed+json` |
| generated Atom view | `application/atom+xml` |
| generated h-card page | `text/html` |
| photo | whatever the bytes are |

A reader MUST NOT reject a signed file for its declared media type: the signature covers the bytes,
and no media type is inside it. A reader that refuses on a header is refusing on something the author
never signed and the host chose.

## Appendix B: Test Vectors

Every vector below is produced by `tmp/regen2.js`, which signs them with the reference publisher,
verifies them by running the reference **reader** over them in the order §8 states, and then checks
that this document carries them verbatim. Run `node tmp/regen2.js` after any change to a schema, to
the signing format, or to the envelope; it exits non-zero on drift.

Keys are deterministic so the bytes reproduce. Note that a *different* signature line for the same
body is equally valid (§3.2): a verifier hashes the body and checks the signature, and never compares
files byte for byte.

### B.1. Keys

```
alice genesis   (Ed25519 public)  KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y
alice rotated   (Ed25519 public)  kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs
alice restored  (Ed25519 public)  17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M
mum             (Ed25519 public)  5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU
sis             (Ed25519 public)  lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ
bro             (Ed25519 public)  Tt-buDzctWsjDmOG9DDd3IPy-4grdRXTB1VJTds1a5Q
alice reading   (X25519 public)   cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc
mum reading     (X25519 public)   Yu9nDDrlZOLjeg9rT9ZOffojS6Kne4lF4m93Ag8NGiU
```

### B.2. The recovery commitment (§4.4)

Two of three, committed one member at a time. `sis` vouching reveals `saltsis` and her key, and
nothing about `mum` or `bro`.

```
salts             mum "saltmum"  sis "saltsis"  bro "saltbro"
SHA-256(salt|key) WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4
                  wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc
                  frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ
committed         {"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]}
```

### B.3. Profile, `pseq` 1 (genesis)

The chain is one hop long and the file is signed by the genesis key.

```
{"genesis":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y","pseq":1,"name":"Alice","chain":[{"key":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y"}],"recovery":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
gMaI7c1h6-xg2SqeH_z7HgPXd6A56Ll-y6ZoHcYWlwt_VmijkEQhH8pGrwETEqvgENTsV9ZylwrZ-4k8rnrQBQ
```

### B.4. Profile, `pseq` 2 (a rotation)

The hop is signed by the key it replaces, over the ASCII bytes `<previous>-><new>`.

```
{"genesis":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y","pseq":2,"name":"Alice","chain":[{"key":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y"},{"key":"kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs","by":"rotation","sig":"hFF1jQj5arz7t91ZRKTyWooglxs36Sq3yvBqEHvDieBqDTVIxavUMSeUn2BPiifaRU75AKnIolBI6KP-KOutAg"}],"recovery":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
lBuOlH_J1QR7D0fZG8NgeE7hzzll9zBGc2q_cRveLkeopGNQfgDbX_LRedrflHoerdi2pXRN6pllJXqSkThkDw
```

### B.5. Profile, `pseq` 3 (a restore)

Two of three vouchers, each revealing only its own salt. The hop carries `court` — the list it
satisfied — because a reader meeting this identity for the first time has no other copy of it (§4.3).

```
{"genesis":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y","pseq":3,"name":"Alice","chain":[{"key":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y"},{"key":"kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs","by":"rotation","sig":"hFF1jQj5arz7t91ZRKTyWooglxs36Sq3yvBqEHvDieBqDTVIxavUMSeUn2BPiifaRU75AKnIolBI6KP-KOutAg"},{"key":"17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M","by":"restore","court":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"vouchers":[{"key":"5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU","salt":"saltmum","sig":"zlSag21icaKQIgVI-iopptghcCruIYne8uv1aI9P94VOSm-CoFQ3e44Ajp5zR0DPmvCwl3KJNKbJgCyFi-ZxBg"},{"key":"lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ","salt":"saltsis","sig":"ttyqfT-I4auqFG0udf45r76o5gavmZEnStB0E5oAcQAKIAYNpkJRz9LjIqJfu8ZiolEB9Gtabq9w-RYtVOIHDw"}]}],"recovery":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
ny-9uuojVOoPXBZ0TEfEZBaqoWPJpSM28VbehTvjWhilEellQf9juCtJ6zYS_zgCbzZc963UDRkrVulELNy8DQ
```

### B.6. Post

The number is inside the signed bytes (§6.1).

```
{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}
JenRgJyI2SN2Rf26q8P6-yfATUWqobPIc9b9i5rTsGwj3p9CT_QkeFHec--GmOwkwr0Z6Op1AIrLH6hawRyHAw
```

### B.7. Post — a reply

The target names the author's genesis key, the number, all 43 characters of the address, and where
the replier last knew that author to live (§6.4).

```
{"n":3,"at":"2026-07-19T09:30:00Z","text":"congratulations, both of you","rel":"reply","target":{"key":"5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU","n":12,"hash":"_wcb5V3yCD3C6KmN7mOmNw3DKJcRdBJItfW0Z-Ic_kc","at":"https://mom.example/mom"}}
pg75WGP-fngwGGv4LTkbA9gV-yRcU-vFC9HScBj63FZjw33bWCWKLmRQIfbaWIdQrb04ybiZVUiBYpsKdUAYCw
```

### B.8. Post — sealed

Only `n` and `at` are in the clear; the text, the relation, the target and the media references are
inside the envelope (§7.6). The audience is padded to eight slots (§7.4). The carrier bound into the
associated data is `KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y:5`.

```
{"n":5,"at":"2026-08-18T21:40:00Z","sealed":{"epk":"bulurRC1e4YYuDGwVZj_Yh9ZgswZoponWSc5JsAp5z8","slots":[["cwNqOZ1KtPU","LRz0F-kLZzeE3HcRmOcfbdxrFr7PIszC4GJ6JiiQBW2D_2yuzRMWiemDHEawzpsH"],["SzNzzQy4o2c","2rsCQZAjQMhlxocGQd4baI0tsCQiZqRX8BtHmJ8mihXiGd5DtWA0mmPvzLY0Ite-"],["73aYUwc1nYM","fhZOhGkI6SYVQsw8ToaM0AEIV9n5BWVg5FzBwTtytkWMI7kbwUTAwk-5_eJxbc5V"],["pDw05LzubDU","m_CfIPhainVpawhxUOwAiRXs6ylp_eaVBAYnvjfO7JeXlP0qq8FMJ24f9FpOfQuz"],["WLgR9Qj8Gh4","Y9BLe3X0OvDF0sdkf1C7FRoFn1xN0tvDJEeM1d3qfZJsBBPC5oxS9XdA0krmNtf9"],["YV9nLfwG_vk","J_9lvtCHjPNbRSUtdO_eyOdNA225kZg8R89YB42jgCbQEGaAXxZECEC-JS02jveN"],["Rdnrsty8HyI","Qak_sEBHK5Lp3oTYH5XYm-t_C6k-7Rv4QTQWDljNEn70BeJLZSjWENfSYb5zBWna"],["aS4UrGC1-XI","wkQNWkDUCOra94aX3nhx591BeplFaDDUY9B0fuMFLwfFVedIjlYivNIPKw-6UITZ"]],"ct":"FoS_r7lGklcYcRiWYCqFTRJO8ptUe7_2D7bdcha6N_UU0dx95hphEGFj0ElwjrIIF_nfjLWkQx3pXhIyMqxykG3iLOgu_Ua4QbvJG8JRBof2v9Xj_8IO_8UiQ64CpQC9rwkPeiBgyLo5f1QSmyujWMjnee7OX8TQ-d8qNC8ww59ymDTIC5_ci-G1C-fumJ4ul-nuYSlqv1NGky7RvEnmR7hOrKBSN3DQys-1UPk3052v3QUqRVfr8bDHOcuf90ReblGLx7Qsj0aQ7-WdNQ6pf4iKjmAf2MO2TBY1wY8H6woKRqIVW4DPB6TQlidu6d3JsWTwHjC_BK3f-4x9g92x8ecU6zEbeyf7wuUoQPzekQuBi9tO_Ee38rdo64x1IBIVm6l0EB6JEXN7TRbL_n7rC_46H_7D6wYwuTGVZpPRJfoU1lgViEAr07IZWdUaOA8q-VCQ5svvgJekhUHh40vYRIz3j7dDRXtykla-n4QjscunP7Eg3SQjErNJk86HWyFLMFFuFjdHpZvddYan_Yscgf8M3Vkir0lWrr-ux0UFcqxNyr7afJK3D0pJLuHb_qqpCyntEnz743_xEJ2iNN6B9bsJjzP1y9Kqm_za9Ea4Z-CygTZP7LX_RB1OJjeDZCDKr3oD5GkNmllSxKXiAlby8emchzLqjNu-pjRfm--gBAjkfCgaea7N0c7P5zuKvZnh"}}
ki8IniNutVIZa3a_LOtOtRzGiOzyBxpR72xPxcF2y58aLP9LPJ-_0BlD8E8sDQ4RQxH2LOwXw4LsD0xsJbEoBA
```

### B.9. Head, `hseq` 1

Three posts live.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"bpiBxxuyRy7YovD2yN3vId-YFto8ECOrFr0cvuQLNIA"]],"hseq":1,"top":3}
APzq99ihT0M1YhqDJcm2G1arshy9u09GdHHQeA7RFptLN7dzqiUCfYXdYLyd-RRjHTLJ9SawqwfAuxT-7AwfDA
```

### B.10. Head, `hseq` 2 — a withdrawal, a pending post, a photo

Post 2 is withdrawn by an appended line, post 4 is listed but not released, post 5 is the sealed one,
and the photo is listed by its address alone. The photo's bytes are 26 bytes hashing to
`fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g`.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"bpiBxxuyRy7YovD2yN3vId-YFto8ECOrFr0cvuQLNIA"],[2,null],[4,"2snPilfT2ArJ4Epp8-1DGMwbB3laiOooGko515kr14Y","pending"],[5,"EUYNsar5GEkZU75IOUWERRHv97XvG2jhVbs5OnFCM-8"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"]],"hseq":2,"top":5}
H4kujuJytxLR8pAY02iFmsTwkBZQMw13ahI_F5USlaM3SnGR0j9zLCAw_cNFpaLnFp7C3Ra7eYiQ3ULrWCNBAQ
```

### B.11. Head, `hseq` 3 — the rewrite

The lines the withdrawal left behind are gone and the pending entry is carried through **still
pending** (§5.5). A reader holding `hseq` 2 accepts this, reports nothing, and its live set is
unchanged.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[3,"bpiBxxuyRy7YovD2yN3vId-YFto8ECOrFr0cvuQLNIA"],[4,"2snPilfT2ArJ4Epp8-1DGMwbB3laiOooGko515kr14Y","pending"],[5,"EUYNsar5GEkZU75IOUWERRHv97XvG2jhVbs5OnFCM-8"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"]],"hseq":3,"top":5}
BBImRtK8pRpJS9KjivRIPTNGS6ZMZ8f6XbdwH7q7mO7aC_3j5dIImKcmxJi2OZsfW55FArbRu-WfRBAn9kjzBg
```

### B.12. The spoken code (§4.1)

Six 11-bit indices into a 2,048-word list, from the genesis key above.

```
HKDF-SHA256(ikm = genesis key, salt = "", info = "openfeed/v1/spoken", 9 bytes)
indices  1991 1056 613 530 955 1997
```
