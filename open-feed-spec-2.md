# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.**

## Abstract

Open Feed is a protocol for publishing from your own domain with an identity you control. Your
identity is a cryptographic key — not a URL, not an account — so it travels with you if you move.
Everything you publish is a signed file at a stable URL, and readers can verify it without trusting
your host. The entire protocol is built from primitives found in most languages' standard libraries.

Your host is just storage — a static file server is a fully conforming host. People on different
hosts reply, react, and share encrypted content with each other as easily as people on the same one.
The protocol is designed for the case where your host operator can look at everything, refuse to
cooperate, and may not be on your side — and content for chosen people is encrypted to their keys.

## 1. Conventions and terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and
OPTIONAL are to be interpreted as described in RFC 2119 and RFC 8174.

When this document doesn't settle a question, four priorities do, in order: **no dependencies**;
**easy to implement** (someone can write a publisher or reader in a weekend from this text alone);
**interop** (content reaches existing feed readers without anything built); **minimal** (the shortest
spec that delivers these promises). This protocol does not pursue human-readable wire bytes,
continuity for strangers across key loss, or millions of items per identity. It scales across
identities — many people on a few large hubs is the case that must work.

**base64url** means base64url encoding without padding (RFC 4648 §5). Every key, hash, and signature
in this document is a base64url string: an Ed25519 or X25519 public key is 43 characters, a SHA-256
hash is 43 characters, an Ed25519 signature is 86 characters.

| term | meaning |
|---|---|
| **profile** | the signed file naming your keys, locations, and recovery list |
| **index** | the signed list of what is currently published — which posts and media exist, and the highest number used |
| **post** | one immutable signed file; replies, reactions, and private messages are all posts |
| **anchor key** | your first signing key — it *is* your identity. A link or scanned code carries it, and readers follow the chain from it |
| **chain** | the links from the anchor key to the key in use now, each signed by the previous key or vouched by the recovery list |
| **recovery list** | the people or keys you named in advance to restore you, committed privately |
| **pin** | what a reader verified and remembers about an identity — the profile, the chain, the recovery lists at each chain length, and the index. This is what catches a lying host later |
| **withdraw** | remove a post from the live set by appending a line to the index |
| **hub** | anything that stores and serves the files. It holds no key of yours and makes no decision about who you are |

**Roles.** There are three, and they are independent. A **publisher** writes files. A **reader**
verifies them. A **hub** stores and serves them. None is more of the protocol than another (§12).

## 2. Files

Everything on the wire is one of four kinds, at conventional paths under a name the hub assigns:

| kind | path | overwritten? | signed by |
|---|---|---|---|
| profile | `/<name>/profile` | yes, compare-and-swap | the current key (the key the chain ends on) |
| index | `/<name>/index` | yes, compare-and-swap | the current key (§4.6) |
| post | `/<name>/posts/<n>` | no, created once | any key in the chain |
| media | `/<name>/media/<hash>` | no | not signed — admitted by being listed in the index (§4.4) |

### 2.1. The file format

A signed file is **its body bytes, one `\n`, then the signature over the body**.

- The body MUST be a JSON object encoded as UTF-8, with no leading byte-order mark.
- The signature line MUST be exactly 86 base64url characters that round-trip: decoding to 64 bytes
  and re-encoding MUST produce the same characters. Base64 admits multiple spellings of the same
  bytes, and accepting more than one means accepting a file that isn't byte-identical to what the
  author signed.
- The body MUST NOT contain a `\n` byte. A verifier splits at the **last** `\n` in the file, so this
  rule makes "the line after the body" and "the last line" the same thing for every implementation. A
  compact JSON serializer never emits one.
- The signature MUST be Ed25519 (RFC 8032) over the body bytes exactly as served.

### 2.2. Addresses

**A file's address is the base64url SHA-256 of its body, never of the whole file.** Some standard
libraries (Apple's CryptoKit among them) produce randomized Ed25519 signatures, so two honest
signings of the same body produce different files. Hashing the whole file would make the address
depend on which library signed it.

A media file has no body and no signature: **its address is the SHA-256 of its bytes**, and that is
the whole of its verification (§4.4).

### 2.3. No canonicalization

**The bytes served are the bytes signed.** There is no canonical form, no member ordering rule, and
no re-serialization step. A producer serializes once and signs what it serialized; a verifier hashes
and verifies the bytes it received and never rebuilds them.

One consequence: **a host that pretty-prints, sorts members, or adds a trailing newline makes every
file it touches read as forged.** Ordinary servers and proxies do all three unasked. §8.7 makes
serving the exact bytes a MUST for that reason.

### 2.4. JSON hygiene

`JSON.parse` and its equivalents cannot see a duplicate member, treat `__proto__` as an ordinary
member, silently round an integer past 2^53, or reject a lone surrogate — four ways two readers can
disagree about what one signed body says.

A producer MUST NOT emit a body containing a duplicate member name, a member named `__proto__`, an
integer outside ±(2^53 − 1), or an unpaired UTF-16 surrogate. A reader SHOULD reject a body
containing any of them. The rule is asymmetric: only the author can sign, so for three of the four a
producer that never emits one closes the ambiguity. `__proto__` is the exception — a reader that does
not reject it MUST at least parse into an object it does not inherit from.

### 2.5. Extension fields

Unknown members MUST be preserved by anything that stores or forwards a file, because they are
inside the signature. Extension members SHOULD be prefixed with `_`. Extension relation types
(§5.3) are absolute URLs.

## 3. Identity

**Your identity is your anchor key** — a 32-byte Ed25519 public key that you generated and that
nobody else ever held. Not a URL, not a name, not a domain. Where you are hosted can change without
changing who you are.

### 3.1. First contact

A reader that learns your key from the host it is reading has learned nothing — the host chose both
the profile and the key printed in it. A reader MUST obtain the anchor key by a route the host does
not control, and MUST refuse a profile whose `anchor` does not match.

Two routes are defined:

- **A link or scanned code.** The link is the location with the anchor key in its fragment —
  `https://alice.example/alice#<anchor key>` — so the key never reaches the server and a plain
  browser still lands on the page. The reading app compares and refuses on mismatch. A user is never
  shown a key.
- **A spoken code**, for a phone call. Six words derived from the key:

  ```
  bits    = HKDF-SHA256(ikm = key bytes, salt = "", info = "openfeed/v1/spoken", 9 bytes)
  index_i = the i-th 11-bit big-endian field of the first 66 bits, for i = 0..5
  ```

  Each index selects a word from a fixed 2,048-word list; implementations that need to interoperate
  MUST use the BIP-39 English wordlist. Six words is 66 bits of entropy — enough that brute-forcing
  a match takes centuries on a GPU. Five words (55 bits) would not be enough.

The code distinguishes *identities*. It cannot distinguish two versions of one identity, because both
share the anchor key. When a reader is stuck at **contested** (§3.6), the same two routes MAY carry
the key the owner's chain **currently ends on** instead, and a reader given that key MUST follow the
branch whose chain contains it and pin there. This is the only exit from a contest, and it runs
through a person, never through the host.

### 3.2. The profile

```json
{"anchor":"<key>","version":3,"name":"Alice",
 "chain":[{"key":"<anchor>"},{"key":"<key2>","recovery":{"k":2,"leaves":["<hash>","<hash>","<hash>"]},"sig":"<86 chars>"}],
 "recovery":{"k":2,"leaves":["<hash>","<hash>","<hash>"]},
 "locations":["https://alice.example/alice"],
 "read":"<x25519 key>"}
```

| member | required | meaning |
|---|---|---|
| `anchor` | MUST | the identity. A reader MUST check this against the key it learned (§3.1) |
| `version` | MUST | a non-negative integer that MUST NOT go backwards (§3.6) |
| `chain` | MUST | the links from the anchor key to the key in use now (§3.3) |
| `recovery` | MUST | the recovery list, committed (§3.4). MAY be empty |
| `locations` | MUST | every place this identity is served from (§3.7) |
| `read` | SHOULD | the X25519 public key others encrypt to (§3.8) |
| `name` | MAY | a display name |

The profile MUST be signed by the key its chain ends on.

`name` is signed like everything else, so a hub cannot choose it for you. It is not unique, is not an
identifier, and MUST NOT be used to resolve or match an identity.

### 3.3. The chain

The chain is an array of links. The first link MUST be `{"key": <anchor>}` and its key MUST equal
`anchor`. Every later link has one shape:

```json
{"key":"<new key>",
 "recovery":{"k":2,"leaves":["<hash>","<hash>","<hash>"]},
 "sig":"<86 chars>",
 "vouchers":[{"key":"<voucher key>","salt":"<salt>","sig":"<86 chars>"}]}
```

- `key` is the key this link moves to.
- `recovery` MUST be the recovery list (§3.4) **as it stood before this link** — the list that
  governed moving away from the previous key. It is REQUIRED on every link.
- `sig`, when present, is an Ed25519 signature by the **previous** link's key over the ASCII bytes
  `<previous key>-><new key>`, both keys in their base64url spellings, verified with the same
  86-character rule as a file's signature line (§2.1). This is a **rotation**: the owner moved.
- `vouchers`, when present, are signatures over the same bytes by members of the recovery list. A
  voucher counts when its signature verifies **and** `SHA-256(salt ‖ "|" ‖ voucher key)`, base64url,
  is one of `recovery.leaves`. This is a **restore**: the owner's people moved them.

A link is **valid** when `sig` verifies, or when the number of **distinct** voucher keys that count
is at least `recovery.k`. A reader MUST reject a profile whose chain contains a link that is neither.

A link may carry both `sig` and `vouchers`. Vouchers MAY be **added to a link after it was made** — a
rotation the owner made alone can later be backed by their people, which lets them win a contest at
that link without abandoning every key and post that came after it (§3.6).

**Every link carries its recovery list because a reader meeting this identity for the first time
holds no other copy.** A reader that first sees the chain at length three has no recovery list at
lengths one and two. The carried copy is what a reader with no list at that length adopts; a reader
already holding one ignores it (§3.6 rule 3).

**A restore changes the key and nothing else.** A link with no `sig` MUST NOT be accompanied, in the
same profile version, by a change to `locations`, `recovery`, `name`, or `read`. A pinned reader MUST
check this: a profile whose chain has grown by a link with no `sig` since the pin, and whose
`recovery`, `locations`, `name`, or `read` differ from what the pin holds, is **identity**.

A key rotated away from stays in the chain and keeps its posts valid — but it cannot sign an index
(§4.6) and cannot hold a number against the owner (§8.5). That is how a stolen old key is closed
without a revocation mechanism.

### 3.4. The recovery list

```json
"recovery": {"k": 2, "leaves": ["<hash>", "<hash>", "<hash>"]}
```

Each leaf is `SHA-256(salt ‖ "|" ‖ member key)` in base64url, with a distinct random salt per
member. A member vouching reveals only their own salt and key, so the rest of the list stays hidden.

The **count** of leaves is public and MUST be, because a majority has to be counted against something
(§3.6). `k` is the threshold the author set for a restore to be valid.

The list MAY be empty. Members can be people, a backup key you keep yourself, or your host. An app
SHOULD require two or more members (or the owner alone), because **a list with one other person gives
that person the identity at that chain length** — a majority of one is one, and it stays given after
a rotation, because a recovery list is never overwritten once a reader has seen it (§3.6).

A restored identity SHOULD be flagged "recently restored" for seven days by reading apps. That flag
is presentation, not a verdict (§7.3), and the record of who vouched stays in the chain.

### 3.5. Rotating and restoring in practice

Changing the key means writing the profile **and** the index again, in that order, because the index
MUST be signed by the current key (§4.6) and a hub that verifies writes (§8.4) checks the index
against the profile it holds. An app SHOULD also rotate when the recovery list changes, because a
changed list reaches other readers only through a new chain link (§3.6).

### 3.6. Contests: two profiles claiming one identity

A thief holding one of your keys can publish a profile whose chain walks perfectly from your anchor —
and so can anyone holding none, with a link vouched by a recovery list of their own making. Checking
that the chain walks is therefore not a test of anything. Four rules settle it, and a reader MUST
apply all four.

1. **The pin holds the chain, and a served chain MUST extend it key for key.** The first index at
   which a served chain differs from the pinned one is the **split**. A profile at a *higher*
   `version` whose chain is a strict *prefix* of the pinned chain is a split too, at the end of the
   prefix — that is the thief pretending a restore never happened.
2. **A recovery list is kept per chain length: the first one the reader ever saw at that length**,
   from a link's `recovery` or from a profile's `recovery`. A recovery list MUST NOT be overwritten.
   A thief who holds the key and rewrites the list before forking changes nothing for a reader that
   already holds one — and because every link carries its list, a reader holds one at **every** length
   its pinned chain reaches from the first read on.
3. **A reader judges a link by the recovery list it holds at that length, never by the copy the link
   carries** — for the link's validity (§3.3) and for the contest alike. The carried copy is for
   readers with no list at that length; a reader with one MUST NOT prefer it, and a pinned reader
   MUST NOT adopt a carried recovery list at any length its pinned chain already reaches.
4. **A majority of the recovery list at the split wins.** More than half of that list vouching, on
   exactly one side. A link's `sig` is not a vote: it proves only that whoever held the previous key
   moved, and the thief held it too. If both sides reach a majority, or neither does, the identity is
   **contested** (§7.3) and the reader follows no branch until a person hands it the current key
   (§3.1).

**Majority, and not `k`.** They differ on one case, and it is the case the protocol exists for: the
abuser is on the recovery list, and he vouches for himself, while Alice merely rotates her key. Under
a threshold of `k`, one listed adversary hands himself her identity. Under a majority he cannot,
ever, alone. **The price:** a one-of-two restore against a bare rotation stays contested until a
second member vouches. What the single link shape (§3.3) buys here is that Alice does not restore
*again* to pay it — her people add their vouchers to the link she already made, and the keys and
posts after it stand.

Two limits a reader cannot escape and an app MUST NOT hide:

- **A cold reader's recovery list is whatever the first profile it saw carried.** A reader that first
  meets an identity on the thief's branch will reject the real one later. Only a reader that pinned
  before the split — or a person who can ask one who did, or be handed the current key (§3.1) — can
  settle it.
- **A list change reaches other readers only through a link**, which is why §3.5 asks an app to
  rotate when the list changes.

Against a pin, and outside a split: `version` MUST NOT go backwards, and the same `version` with a
different address is contested.

### 3.7. Locations and moving

`locations` lists every place this identity is served from. A reader MUST remember every location a
verified profile has ever named and SHOULD try the others when one stops answering. Moving is writing
your files somewhere else and publishing a profile with a higher `version` naming the new place.

Readers who never learn the new location are the honest limit of this design. The mechanism that
reaches them is **the address riding along in other people's posts** (§5.4): a reply carries its
target's location as the replier currently knows it, and a reader that sees a newer location in a
post it has verified follows it there. Someone with any social path to the departing person finds
them; a reader with none does not. §13.3 states what that reader sees.

Because an encrypted post's target is inside the envelope (§6.6), relocation rides along in
**public** replies only.

### 3.8. The reading key

`read` is an X25519 public key, and it is what others encrypt to (§6). It is separate from the
signing key because deriving one from the other requires Edwards-to-Montgomery field arithmetic that
no mainstream standard library exposes.

**The reading key is not socially recoverable.** A restore returns your name, not your archive. What
was encrypted to you was usually also encrypted to others, who can re-encrypt it to your new reading
key; what was encrypted to you alone is gone unless your app backed the key up.

A publisher MUST encrypt only to a `read` key taken from a profile it verified (§7.1). An
implementation that takes the key from whatever the host served is encrypting to the host.

## 4. The index

```json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>"],["<media hash>"]],
 "version":9,"top":3}
```

The index is the answer to "what exists now." It MUST be signed, it MUST live at `/<name>/index`, and
it is the one file besides the profile that is legitimately overwritten.

| member | meaning |
|---|---|
| `entries` | the lines, in order. The live set is the **fold** of them (§4.2) |
| `version` | the version, a non-negative integer that MUST NOT go backwards |
| `top` | the highest post number ever issued, which MUST NOT decrease (§4.3); `0` when none has been |

`entries` MUST come first in the serialized body. This is the one member-order requirement in the
protocol and it is not a canonicalization rule: appending a line leaves every earlier byte where it
was, so a reader that cached the file MAY fetch only the tail (a range request conditioned on the
entity tag it holds, `If-Range`).

### 4.1. What the entries mean

| line | means |
|---|---|
| `[n, hash]` | post number `n` exists, and its address is `hash` |
| `[n, null]` | post `n` is withdrawn |
| `[hash]` | the media file with that address exists (§4.4) |
| `[hash, null]` | that media file is withdrawn |

### 4.2. The fold

A reader computes the live set by folding the entries in order, and an index that does not fold is
invalid. A reader reports **host** (§7.3).

That verdict names the wrong party: an index that verifies but does not fold was produced by the
author's own key, not a misbehaving hub. It is reported as `host` anyway, because a fourth reader
state for this case isn't worth the complexity. An app SHOULD word it as *the files at this address
do not make sense* rather than as an accusation against the operator.

- **A number has one hash, ever.** If `n` has appeared before, the line is legal only if it withdraws
  a live `n`, or re-lists a withdrawn `n` at the *identical* hash. Anything else makes the index
  invalid. A pinned reader enforces the same rule across indexes: it remembers the hash of every
  number it saw withdrawn, and a number that comes back at another hash is **host** (§7.2).

  Re-listing at the identical hash is allowed because it is harmless — and because it is the way back
  from a thief who held the current key and withdrew everything the owner wrote.
- **A withdrawal MUST refer to something live.** `[n, null]` for a number that is not currently live
  makes the index invalid. So does `[hash, null]` for a media file that is not listed.
- **Numbers start at 1.** `n` is a positive integer; `top` is `0` until a number has been issued.
- **A media file is new whenever it appears.** `[hash]` for an address already live makes the index
  invalid.
- `top` MUST be greater than or equal to the highest number issued anywhere in `entries`.

### 4.3. `top`

`top` is the highest post number ever issued and it MUST NOT decrease, even when the post holding
that number is withdrawn.

This matters because §7.5's rumor rule says a reply naming a number *above* the top of the index a
reader holds is worth looking into. Without a `top` that outlives its post, withdrawing your newest
post lowers the highest number listed — and every reply to it becomes a rumor raised over a post you
deliberately deleted.

### 4.4. Media and attachments

A media file is the one unsigned file. **What admits it is being listed in the index; what checks it
is its hash.** It lives at `/<name>/media/<hash>` where `<hash>` is the base64url SHA-256 of its
bytes, and a reader MUST verify that the bytes it fetched hash to the name it fetched them under.

Media files are listed in the index rather than left to the posts that reference them, so that
retention is one rule and reaches **encrypted** posts, whose references the host cannot read. A media
file referenced by a post but not listed in the index is simply not there: the post reads fine and
the media is absent.

A media file attached to an encrypted post is encrypted too: the publisher draws a random 32-byte
key, computes `ChaCha20-Poly1305(key, nonce = 12 zero bytes, plaintext = the media bytes, aad = "")`,
and lists and serves the ciphertext — so the listed hash is the hash of the ciphertext. The key is
carried as `{"hash": <listed hash>, "key": <key, base64url>}` in the envelope's `media` (§6.6). The
key MUST NOT be reused for a second media file. The reference is inside the envelope, and the hub
learns only that a blob of some size exists.

### 4.5. Scheduled posts

There is no mechanism. A post written on Monday for Friday is held by the device until Friday and
published then, at the next number; it carries Friday's `at`. The device holds the key and the bytes,
and §5.1 signs the number in, so it needs nothing it does not have.

### 4.6. The index is signed by the current key

**The index MUST be signed by the key the profile's chain currently ends on.** Not by any key in the
chain — by the current one.

The index is what admits posts. A thief holding a rotated-out key can sign an index, so if a reader
accepted an index from any chain key, the thief would go on deciding what counts as yours and a
restore would take nothing back. **Re-signing the index is what a restore actually restores.**

The consequence is a window: between the two writes a rotation takes, an honest host is serving an
index signed by a key the profile no longer ends on. §7.2 handles it — an unverifiable index is not
an accusation.

### 4.7. Rewriting

A withdrawal is an appended line, and the lines it leaves behind go when the author next rewrites the
whole file. **How often is the publisher's setting, and readers are indifferent.** A reader that last
saw `version` 1 and returns at `version` 6, across two rewrites and an append it never saw, accepts
and is told what was withdrawn.

A suggested default is once a month. It is a **privacy decision and never a size one**: the leftover
lines are about 6% of the file. What rewriting buys is that a withdrawn post's line stops being
visible to later readers and to the public. What it does not buy is anything against a host operator
who kept every version they ever served (§13.1).

## 5. Posts

```json
{"n":7,"at":"2026-08-01T09:00:00Z","text":"the divorce is final",
 "rel":"reply",
 "target":{"key":"<anchor>","n":3,"hash":"<hash>","loc":"https://mom.example/mom"},
 "media":["<media hash>"]}
```

A post is immutable, created once, and signed by any key in its author's chain at the time of
writing.

### 5.1. `n` — the post's own number

**A post MUST declare the number it is published at, inside its signed bytes**, and both the reader
(§7.4) and the hub (§8.5) check it.

At the reader it catches a host serving genuine post 2 at the path for 7. At the hub it is half of
the reclaim rule: without it, a stranger replays a genuine post into a number the owner has not
reached yet, and it is signed by the owner's own chain. The number in the bytes is what makes the
file *this* post.

### 5.2. `at` — content time

`at` is an RFC 3339 timestamp, and it is what apps display and order by. **It is never a verdict.**
Nothing in this protocol decides an authenticity, freshness, or precedence question from a wall clock
(§13.2).

### 5.3. `rel` — what kind of post this is

`rel` is `reply`, `root`, `like`, `repost`, `quote`, `mention`, or `supersedes`, or an absolute URL
for anything else. A reply, a reaction, and a private message are all posts; there is no separate
mechanism for any of them.

**An edit is a new post that withdraws the old one**, with `rel: "supersedes"` pointing back at it.
There is no in-place revision and no version history. A reader that holds the superseding post SHOULD
show replies that target the superseded `(n, hash)` under it, or every edit orphans its thread.

### 5.4. `target` — what this post answers

```json
"target": {"key":"<author anchor>","n":3,"hash":"<43 chars>","loc":"https://mom.example/mom"}
```

All four members are REQUIRED on a post that has a `rel` naming another post. `key` is the target
author's anchor key — never a URL, because the URL can change and the identity cannot. `loc` is
where the replier last knew that author to live, and is the relocation mechanism of §3.7.

`hash` MUST be the full 43-character address of the target post, and **a reader MUST treat a reply
whose target hash does not match the hash the target's index lists, now or when it was withdrawn, as
a reply to something else.** Without that check the full hash is decoration. With it, an author
cannot show one person one post and another person a different post at the same number and have both
threads look right.

### 5.5. `media`

An array of media addresses (§4.4). On an encrypted post the `media` member is inside the envelope,
so the public file carries none.

### 5.6. Private messages are posts

A direct message is a post encrypted to one person, living on the sender's own host. There is no
inbox, no dead-drop, and no push.

Two consequences worth stating. The host cannot read it (§6), but it learns **the shape of the
correspondence** — how many, how often, how big, fetched by whom — and it can withhold any of them,
which to the recipient looks like the sender going quiet. And **a signed private message is provable
by its recipient forever**, withdrawn or not: that is what per-post signatures mean.

## 6. Encrypted content

Three visibilities, one mechanism: public; encrypted to a chosen set of reading keys; and a direct
message, which is that set with one member in it. Comments and reactions on an encrypted post are
encrypted in turn.

An encrypted post is an ordinary post whose content sits in an `encrypted` member:

```json
{"n":5,"at":"2026-08-01T09:00:00Z",
 "encrypted":{"epk":"<x25519 key>","slots":[["<tag>","<wrapped>"],...],"ct":"<ciphertext>"}}
```

**Nothing about signing changes.** An encrypted post is signed and addressed exactly as any other
post (§2), the index lists it exactly as any other post (§4), and a reader that cannot open it
verifies it completely and returns it with the field opaque (§7.4). There is no second signing
construction in this protocol.

### 6.1. The envelope

One X25519 ephemeral key pair per message. For each recipient reading key `R`:

```
Z                            = X25519(ephemeral private, R)
tag(8) || kek(32) || knonce(12) = HKDF-SHA256(ikm = Z, salt = epk, info = "openfeed/v1/slot", 52 bytes)
wrapped                      = ChaCha20-Poly1305(key = kek, nonce = knonce, plaintext = content key,
                               aad = epk)
```

and the content, once:

```
plain   = UTF-8 JSON of {"audience": [...], ...the post's content members...}
padded  = 2-byte big-endian length of plain, then plain, then zeros to a bucket (§6.4)
ct      = ChaCha20-Poly1305(key = content key, nonce = 12 zero bytes, plaintext = padded,
          aad = epk || carrier)
```

`epk` is the ephemeral public key, base64url. Every slot is a `[tag, wrapped]` pair of base64url
strings. The content key MUST be 32 random bytes and MUST NOT be reused across messages; the all-zero
nonce is safe for exactly that reason, as in HPKE.

### 6.2. Carrier binding

**The content's associated data MUST be `epk || carrier`, where `carrier` is the ASCII bytes
`<author anchor key>:<post number>` of the post the envelope is published in.**

Without it the attack is straightforward: someone lifts an encrypted envelope out of one post, drops
it into a post of their own signed by their key and listed in their index, and recipients' clients
decrypt it and render the original author's words under the new name — from an envelope they could
never read.

Binding it as associated data rather than as fields compared afterwards means there is no "forgot to
compare." A client that passes the wrong carrier, or none, does not open the envelope at all.

### 6.3. Slots, and what a tag is

A recipient derives its own tag from its own `Z` and scans the slots for it. **A tag is a hint, never
a decision.** A match whose unwrap fails is a collision, and the reader MUST keep scanning rather
than conclude the message is not for it. An implementation that ignores the tags entirely and tries
every slot is conformant and merely slower — which is the test of whether a tag decides anything.

Tags are blinded per message: they are derived through the message's own ephemeral, so the same
recipient's tag differs on every post and an observer cannot derive them from public reading keys.

### 6.4. Padding

`bucket(n, floor)` is the greater of `floor` and the next power of two at or above `n`. Slots are
padded to `bucket(slot count, slot floor)` with dummies — a dummy is random bytes, a tag nobody can
derive and a wrap nobody can open, and MUST be indistinguishable in width from a real slot. It MUST
NOT be derived from anything a recipient holds, or a recipient counts the true audience. The body is
padded to `bucket(length + 2, body floor)`.

**A publisher SHOULD use a floor of 8 slots and 512 bytes**, so that a message to one person is the
same size as a message to the family. Without it, the host can tell a DM from a group post by file
size alone.

It is a SHOULD and not a MUST: the floor costs about 1.1 KB per direct message, and a minimal
implementation that skips it is still conformant.

### 6.5. The audience is inside

`audience` MUST be an array of the recipients, encrypted in the plaintext, each identifying the
recipient:

```json
"audience": [{"key":"<anchor>","read":"<x25519 key>","loc":"https://mom.example/mom"}, ...]
```

and a publisher MUST include **itself** in the audience or it cannot read its own outbox.

The audience is inside so a recipient learns who else can answer — and *who* they are, not just which
key. Without the entry naming a person, a recipient who knows a member only from the envelope holds
an X25519 key and nothing that leads to a profile, so it cannot encrypt a reply to them: the reply
reaches everyone else, silently, and the thread splits in half with no error anywhere. With the
entry, the replier reads the member's profile at `loc`, refuses it unless its `anchor` is `key`
(§3.1), and encrypts to the `read` key that profile carries.

The audience is never in a header, and the slot tags never name a key. What the host learns is that
an encrypted post exists, when, and roughly how big.

### 6.6. An encrypted post's target

**On an encrypted post, `rel`, `target`, and `media` go inside the envelope.** The public file
carries `n`, `at`, and `encrypted`, and nothing else about what it answers. Inside, each `media`
entry is `{"hash", "key"}` (§4.4) rather than a bare hash.

A public post keeps `rel` and `target` in the clear, so public threading, public relocation (§3.7),
and the rumor rule (§7.5) are unaffected for everything a stranger could see anyway.

## 7. The reader

A reader is given three things: the anchor key it learned (§3.1), a location to read from, and
optionally the pin it kept from last time. **The order of operations below is normative** — each step
supplies what the next one checks, and a reader that reorders them is checking something else.

### 7.1. Profile, chain, recovery list

1. Fetch `/<name>/profile`. A profile that is not served at all is **host**. A body that does not
   parse under §2.4's rules is **identity**: the reader cannot tell a garbled file from a substituted
   one.
2. If `anchor` is not the key this reader learned, stop: **identity**.
3. Record a recovery list for every chain length beyond those the pinned chain reaches, from the
   links' `recovery` members and the profile's `recovery`, keeping any list already held (§3.6 rules
   2–3).
4. Walk the chain (§3.3), judging each link by the recovery list held at its length. If any link
   fails, or a link without `sig` is accompanied by a change it may not make, stop: **identity**.
5. Verify the file's signature under the key the chain ends on. If it fails, stop: **identity**.
6. Against a pin: apply §3.6. A split is settled by the recovery list's majority, and the reader
   either follows the branch the list chose, reports **host** for a branch the list rejected, or
   stops at **identity: contested**. With no split, a lower `version` than the pin is **identity**,
   and an equal `version` at a different address is **identity: contested**.

### 7.2. The index

7. Fetch `/<name>/index` and verify it under the **current** key (§4.6). Fold the entries (§4.2) and
   check `top`.
8. **An index that will not verify is not an accusation.** A reader holding an index it verified
   itself keeps that one, notes *"no index I can verify"*, and says nothing further. Only a reader
   holding none reports **host**.

   A garbled file, a 404, an index signed by a rotated-out key, and an honest host caught
   mid-rotation all produce exactly this, and the reader cannot tell them apart. A **cold** reader —
   one with no pin — SHOULD retry the whole read once before reporting `host`, re-fetching both the
   profile and the index.
9. Against a pin: `version` MUST NOT go backwards; the same `version` at a different address is
   **host**; `top` MUST NOT go backwards; and for every live numbered entry at or below the pinned
   `top`, the post MUST have been live before — or withdrawn before — at the identical hash. A number
   at or below the old top that was never there is **host**; one that comes back at another hash is
   **host**. Numbers the pin held that are no longer live are noted `withdrawn: n`, and the pin keeps
   their hashes.

   Media files are exempt from that last check: a media file has no number and so no `top`, and a new
   one is always new.

### 7.3. Three verdicts, and notes

A read returns exactly one of three verdicts, and a conforming reader MUST NOT invent a fourth:

| verdict | means |
|---|---|
| **ok** | everything checked out |
| **this host is misbehaving** | the files served do not hang together, and withholding, swapping, or rolling back is what would do it (see §4.2 for the one case where the label is charged to the wrong party) |
| **this identity is in question** | who this is cannot be settled from here |

`recently restored`, `withdrawn: n`, and `no index I can verify` are **notes on an ok read**, not
verdicts. An implementation that promotes a note to a state has four states and one of them cries
wolf.

A frozen copy — an old profile served forever by a host the author has left — reads as **identity: an
older profile than the one this reader saw**, because two claims about one identity are in play and
this reader has seen the newer one. It is not a misbehaving host: the host is serving exactly what it
has.

### 7.4. Posts

10. For each live entry: fetch it, and

    - for a **media file**, check the bytes hash to the listed address; if not, **host**;
    - for a **post**, verify its signature under **any key in the chain**, check its address equals
      the hash the index lists, and check its `n` equals the number it was served at. Any failure is
      **host**.

    A listed file that is not served is **host**. An encrypted post is verified exactly like any other
    and returned with `encrypted` opaque; opening it is the client's business (§6), not the reader's.
    A post whose `target.hash` is not what that author's index lists for `target.n` — now, or when
    the reader saw it withdrawn — is returned with the target marked unresolved (§5.4).

### 7.5. Targets, and the rumor rule

11. For each post naming a target whose author this reader holds a pin for: if the target number is
    at or below that author's `top`, say nothing — it is a withdrawal or a supersession, and the
    index is signed, so the host cannot have edited it. If it is **above** the top, look again.

Two bounds are REQUIRED, and a reader without both is a weapon:

- **Look again at most once per identity per pass.** Not once per reply.
- **Say one line per person**, however many replies they wrote.

Without them, a thousand replies naming numbers that never existed cost a thousand fetches aimed at
somebody else's host and print a thousand messages.

What is said is a rumor and never an accusation: *"X replied to something I cannot see,"* naming the
replier, because that is the only party the reader has evidence about.

**Following a reply's `loc` is both the feature and a beacon.** It is how a reader with no other path
finds someone who moved (§3.7) — and it tells whoever wrote that reply the address and moment of
every reader that holds a pin for the name they targeted, once per identity per pass. A reader MAY
try the locations it already holds before the address in the reply.

## 8. The publish interface

Four paths, two verbs, one conditional header. **There is no account, no token, and no session: the
request is the signed file.** Anyone's client can write to anyone's hub — bring-your-own-client is a
security property, because a hub that ships the app can take the key.

```
PUT /<name>/profile        If-Match: <etag>      -> 200 | 412
PUT /<name>/index          If-Match: <etag>      -> 200 | 412
PUT /<name>/posts/<n>                            -> 201 | 200 (reclaimed) | 409
PUT /<name>/media/<hash>                         -> 201 | 200 (replaced) | 409
PUT /<name>/feed.json | feed.xml | index.html    If-Match: <etag>      -> 200 | 412   (views, §11)
GET any of the above                             -> 200 | 404
```

### 8.1. Compare-and-swap on the two overwritable files

The profile and the index are overwritten, so two devices can clobber each other. A writer MUST send
`If-Match` with the entity tag of the version it read, and a hub MUST refuse with 412 if the file has
changed since — or if the file exists and the request carries no `If-Match` at all. The entity tag is
a strong tag, compared byte for byte, and opaque to the writer: a writer reads it from the `ETag`
header and never computes it. A hub MAY use the SHA-256 of the bytes it is serving.

**A writer that loses the race MUST re-read the file the hub is now serving and fold its own line
into that**, not re-send its own version. The naive retry silently drops the other device's post, and
the loss reads to every reader as an ordinary withdrawal.

### 8.2. Create-once on numbered posts

A post is created once. A hub MUST refuse a write to a number that is already held, except under
§8.5. A publisher that loses retries at the next number.

**Numbering need not be gapless.** A crash between the post write and the index write burns one
number, and a reader is indifferent: a number nobody lists is nothing. The rule that follows: **a
device that comes back MUST abandon a number it cannot prove it listed, and MUST NOT list one late.**
A pinned reader's check that a number at or below the old top cannot appear that was never there
(§7.2) is the same check that catches a host backdating a post into someone's history.

### 8.3. Write order

**The post is written before the index that lists it.** An index listing bytes that are not there yet
is `host` to every reader until they land; a post nobody has listed is nothing to anybody.

### 8.4. Claiming a name

First come, with the profile as the proof. Later writes under that name MUST carry the same `anchor`
and a `version` that has advanced — and a hub that accepts writes MUST check the proof: it MUST
refuse a profile whose chain does not walk (§3.3) or whose signature does not verify under the key
the chain ends on, and an index that does not verify under the key the profile it holds ends on.

**A publisher MUST write an index when it claims a name**, even an empty one. Otherwise a brand-new
identity on a perfectly honest hub reads as `host: no index served` at the moment someone signs up.

### 8.5. Reclaiming a squatted number

**A number held by a file that is not the owner's MAY be reclaimed by the owner, and by nobody
else.** "The owner's file" means declaring that number in its body (§5.1) **and** either signed by
the key the chain of the profile at that name **currently ends on**, or listed at that number and
address in the index at that name. Not *any* chain key: a key rotated away from stays in the chain so
its listed posts stay valid, but a thief holding it could otherwise squat five numbers and hold them
forever.

Without this, create-once turns an unchecked write into a permanent block: a stranger PUTs five posts
at numbers the owner has not reached, and those numbers are refused forever. The rule does not turn
around: the squatter cannot take back what was reclaimed, cannot overwrite a genuine post, and the
owner cannot overwrite their own.

A hub MAY check nothing on the ordinary path of a post or a media file. It MUST NOT ignore a
collision.

### 8.6. The same rule for media

**A hub MUST replace a file at `/<name>/media/<hash>` whose bytes do not hash to that name, when
offered bytes that do.** This is the content-addressed twin of §8.5. Without it, a stranger PUTs
junk at the address of a media file before the owner uploads it, the real bytes are refused as a
collision, and readers blame the host for a file that doesn't match the index.

### 8.7. What a hub MUST do

- **Serve back the exact bytes it was given.** Pretty-printing, sorting members, or appending a
  newline each make every file read as forged (§2.3).
- **Allow cross-origin reads** (`Access-Control-Allow-Origin: *` on everything publicly readable),
  or no browser-based reader can read across hosts. A hub that accepts writes MUST also answer the
  preflight a browser sends before a cross-origin `PUT` with `If-Match`, and expose `ETag`, or no
  browser-based publisher can write to it.

A hub MAY require more of its own writers — a pass, an account, a rate limit, a bill. Whatever a hub
does, it can never write as you, because it cannot make your signature. The worst it can do is refuse
you or delete things.

### 8.8. Withdrawal, and whether anything is ever deleted

Withdrawing a post removes it from the live set. It does not remove the file: there is no DELETE
verb, an author cannot overwrite their own post, and the fold refuses a withdrawal of something that
was never listed (§4.2).

**A hub MAY remove a numbered or hashed file that the current index does not list**, after a grace
window long enough to cover the write order of §8.3. This is what lets an honest hub honour a
deletion request. It is a MAY because no reader depends on it either way, and an app MUST NOT tell a
user that withdrawing erased anything.

## 9. Fetching

Every rule in this section binds a reader's outbound requests, and none of it is optional politeness.
The rumor rule (§7.5) follows a URL that a **replier** chose, so a reader's fetch layer sits in front
of attacker-supplied addresses by design.

- **HTTPS only.** Certificates validated.
- **At most 5 redirects, and never to a different origin.** A cross-origin redirect is never identity
  equivalence: moving is expressed in the profile (§3.7), not in a `Location` header. Each redirect
  is re-checked for scheme and address.
- **Refuse non-public addresses.** The check is on the **resolved** address, never on the hostname —
  a hostname tells you nothing, and an attacker controls their own zone — so a reader hooks name
  resolution and checks what came back before the socket connects. Checking after connecting leaves a
  rebinding window. Address literals in the URL are checked as well, because resolution is never
  called for them.

  Blocked IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`,
  `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`. Blocked
  IPv6: the unspecified address, loopback, link-local, unique-local, and **every embedded-IPv4 form
  judged as the IPv4 address it carries** — `::ffff:a.b.c.d`, the deprecated `::a.b.c.d`, the
  translated `::ffff:0:a.b.c.d`, NAT64's `64:ff9b::/96` and `64:ff9b:1::/48`, and 6to4's
  `2002::/16`.

  A dotted quad with a leading zero MUST be refused rather than guessed at: `0177.0.0.1` is octal to
  some resolvers and decimal to others, and that disagreement is itself the bypass.
- **Bound everything.** A timeout covering connect, redirects, and body read together (10 s
  RECOMMENDED); a body cap per fetch (1 MB RECOMMENDED for the profile and index, larger for media);
  a cap on concurrent sockets per origin (10 RECOMMENDED); and a cap on how many identities one pass
  will resolve.

A reader that hits a cap has **no verdict**, not an accusation: the read did not complete, and the
publisher may have done nothing. That is not a fourth verdict (§7.3) — it is the absence of one, and
an app shows it as "could not check", never as a state of the identity. The same holds for transport
failures — a timeout, a reset, a name that does not resolve. A reader SHOULD retry before reporting
**host**, and SHOULD distinguish "I could not reach this" from "this was answered, and wrongly." Only
the second is evidence about a hub.

## 10. Your copy

**An app MUST keep the signed bytes of everything it publishes.** Not the text, not a database row —
the bytes, with the signature line on the end.

This is one rule with three consequences:

- **Those bytes verify with no host in reach.** A post signs itself, so a copy proves its author to
  anyone holding it, forever. There is no export format and no bundle to define, because the file on
  the wire is already the archive format.
- **Anyone you published to is a backup nobody set up on purpose.** Your readers hold what they were
  allowed to see and can hand it back; it verifies as yours. It covers only what they could see and
  proves nothing about completeness — a fallback, not a guarantee.
- **Your own last index is the table of contents.** It says which numbers exist, so an app rebuilding
  after a phone loss knows exactly what is missing and can ask a named relative for a named list,
  rather than hoping.

Leaving is therefore writing the same files somewhere else. The host is asked for nothing, and there
is nothing for it to refuse.

## 11. Generated views

A publisher SHOULD write a JSON Feed 1.1 document, an Atom feed, and an h-card page, generated from
the index and the posts, at `/<name>/feed.json`, `/<name>/feed.xml`, and `/<name>/index.html` (§8).
They are unsigned, overwritable files; a hub MAY generate them itself instead. They are how this
protocol reaches readers that have never heard of it.

**Nothing in a view is signed, and a view is never the index.** A view is something a host can
regenerate; the index is something only the author's key can produce. An implementation MUST NOT
treat a view as evidence of anything.

- **Item ids are `urn:openfeed:<anchor key>:<n>`.** Not the URL: a URL id makes every post reappear
  as unread in every plain feed reader on the day the author relocates.
- **Withdrawn posts are absent** from every view.
- **Encrypted posts are omitted**, or rendered as an empty placeholder item at their number. A view
  MUST NOT carry ciphertext.
- The h-card's name is the profile's `name` (§3.2) when present. A link on that page MAY carry the
  anchor key in its fragment, which never reaches the server — but a reader that learned the key
  *from a page the host served* has learned it from the host, and §3.1 still applies.

## 12. Conformance

Three roles. They are independent: implementing one says nothing about the others, and none of them
is a level of the others.

**A publisher** MUST produce files per §2, sign the profile and index with the current key (§3.2,
§4.6), maintain the chain (§3.3), write posts before indexes (§8.3), write an index when it claims a
name (§8.4), fold correctly when it rewrites (§4.7), keep the bytes it publishes (§10), re-read and
re-fold on a lost compare-and-swap (§8.1), and encrypt only to verified reading keys (§3.8) with the
audience named inside (§6.5). It SHOULD write the views of §11, and SHOULD pad encrypted content to
§6.4's floor.

**A reader** MUST obtain the anchor key out of band (§3.1), perform §7's steps in order, apply the
contest rules of §3.6 with a recovery list at every length its pin reaches, honour §7.3's three
verdicts without adding a fourth, apply both bounds of the rumor rule (§7.5), check a reply's target
hash (§5.4), and enforce §9 on every outbound request. It SHOULD reject bodies that violate §2.4.

**A hub** MUST serve exact bytes and allow cross-origin reads (§8.7), and hold no signing key of any
user. Static hosting is a conforming hub. **A hub that accepts writes** MUST additionally enforce
compare-and-swap on the profile and index (§8.1), verify them before storing (§8.4), enforce
create-once on numbered posts (§8.2), resolve a collision under §8.5 and §8.6 rather than refuse it,
and answer a browser's preflight (§8.7). It MAY do anything else it likes about who may write.

## 13. Security considerations

### 13.1. The adversary this is built against

A hub operator who is inside the family. He is entitled to look, he controls the serving path and
everything anyone sends through it, he supplies the client if he can, and he will not cooperate.

What the protocol gives that person's victim is **exit**. The key was generated on their device and he
never held it. Content encrypted to chosen keys is unreadable to him however completely he owns the
disk. Their copy is theirs and their readers hold the rest, so leaving is writing the same files
elsewhere and asking him for nothing (§10). Their family on other hubs were never on his.

What it does **not** give them: confidentiality *from* him for anything he was an audience member of,
protection from him deleting or refusing to serve, or any recourse that runs through him.
Implementations MUST NOT market audience control or encryption to this user as protection from their
own host.

Every rewriting attack he can mount is against **what a reader has not yet seen**. What a reader
already verified is pinned — the chain with a recovery list at every length it reaches, the index,
the live set and the withdrawn hashes — and he cannot alter it, drop it without a signed withdrawal,
or roll it back, because he cannot sign.

### 13.2. Where a clock appears — the whole list

A wall clock never gates a security verdict. This list is the check on that claim:

| where | whose clock | what it decides |
|---|---|---|
| `at` on a post | the author's | what is displayed, and the order a UI shows |
| "recently restored", 7 days | the reader's | a flag beside a name, with no verdict attached (§3.4) |
| the rewrite cadence | the publisher's | how long a withdrawal's leftover lines live (§4.7) |

### 13.3. What is not defended, stated plainly

- **Staleness is indistinguishable from silence.** A reader cannot tell a host that has stopped
  serving updates from an author who has gone quiet. A hostile host can freeze every pinned reader
  where it stands. An app MAY surface "no new index in N days" as interface; it is not a protocol
  state and MUST NOT be reported as one.
- **A frozen copy reads as stale only to a reader with a social path.** After Alice leaves, the ex
  can serve her last honest profile forever. A reader that has learned her new address reads that
  copy as `identity: an older profile than the one this reader saw`. A reader with no social path
  sees an unmarked page and has no way to know. §3.7 is the mechanism that reaches everyone else, and
  it reaches them through public replies only.
- **A cold reader's recovery list is whatever its first profile carried** (§3.6). A reader that first
  meets an identity on a thief's branch will reject the real one when it appears.
- **The shape of a correspondence is visible even when its contents are not.** How many encrypted
  posts, when, roughly how big, fetched by which address. §6.4's floor hides one distinction — a
  message to one person from a message to the group — and nothing hides the rest.
- **A signed private message is provable by its recipient forever** (§5.6).
- **There is no forward secrecy.** A reading key that leaks opens every encrypted post ever addressed
  to it. `read` can be changed by a new profile version, and nothing re-encrypts the past.
- **A recovery list of one other person is that person's identity** at that chain length, for every
  reader that saw the list (§3.4).
- **First contact after a hijack is unprotectable**, by definition: a reader with no prior knowledge
  of the identity accepts the first key it is shown, and §3.1's whole purpose is to make sure that
  key came from somewhere else.

### 13.4. Implementation notes

- **Never attribute unsigned content.** Display unverified content distinctly and never cache it as
  verified.
- **Escape or sanitize anything not authored locally**, always. A post is attacker-controlled text
  until it is rendered safely, verified or not.
- **Cap thread walk depth.** `reply` graphs from malicious parties may contain cycles.
- **Compare secrets in constant time**, including slot tags (§6.3).
- **Bound every store keyed on an identity a reader met in someone else's post.** Those are
  first-contact pins that nothing else references; evicting one costs exactly what never having
  fetched it would. Evict whole identities rather than old entries.

## Appendix A: Media types

| kind | media type |
|---|---|
| profile, index, post | `application/openfeed+json` |
| generated JSON Feed view | `application/feed+json` |
| generated Atom view | `application/atom+xml` |
| generated h-card page | `text/html` |
| media | whatever the bytes are |

A reader MUST NOT reject a signed file for its declared media type: the signature covers the bytes,
and no media type is inside it. A reader that refuses on a header is refusing on something the author
never signed and the host chose.

## Appendix B: Test Vectors

**These vectors use the pre-rename field names (`genesis`, `pseq`, `hseq`, `court`, `sealed`) and
need regeneration after the reference implementation is updated to match the new wire format. Run
`node tmp/regen2.js` after updating `src2/` to produce vectors with the current field names.**

Every vector below is produced by `tmp/regen2.js`, which signs them with the reference publisher,
verifies them by running the reference **reader** over them in the order §7 states, and then checks
that this document carries them verbatim. Run `node tmp/regen2.js` after any change to a schema, to
the signing format, or to the envelope; it exits non-zero on drift.

Keys are deterministic so the bytes reproduce. Note that a *different* signature line for the same
body is equally valid (§2.2): a verifier hashes the body and checks the signature, and never compares
files byte for byte.

### B.1. Keys

```
alice anchor    (Ed25519 public)  KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y
alice rotated   (Ed25519 public)  kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs
alice restored  (Ed25519 public)  17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M
mum             (Ed25519 public)  5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU
sis             (Ed25519 public)  lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ
bro             (Ed25519 public)  Tt-buDzctWsjDmOG9DDd3IPy-4grdRXTB1VJTds1a5Q
alice reading   (X25519 public)   cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc
mum reading     (X25519 public)   Yu9nDDrlZOLjeg9rT9ZOffojS6Kne4lF4m93Ag8NGiU
```

### B.2. The recovery commitment (§3.4)

Two of three, committed one member at a time. `sis` vouching reveals `saltsis` and her key, and
nothing about `mum` or `bro`.

```
salts             mum "saltmum"  sis "saltsis"  bro "saltbro"
SHA-256(salt|key) WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4
                  wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc
                  frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ
committed         {"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]}
```

### B.3. Profile, `version` 1 (anchor)

The chain is one link long and the file is signed by the anchor key.

```
{"genesis":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y","pseq":1,"name":"Alice","chain":[{"key":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y"}],"recovery":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
gMaI7c1h6-xg2SqeH_z7HgPXd6A56Ll-y6ZoHcYWlwt_VmijkEQhH8pGrwETEqvgENTsV9ZylwrZ-4k8rnrQBQ
```

### B.4. Profile, `version` 2 (a rotation)

The link carries the recovery list that stood before it and is signed by the key it replaces, over
the ASCII bytes `<previous>-><new>` (§3.3).

```
{"genesis":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y","pseq":2,"name":"Alice","chain":[{"key":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y"},{"key":"kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs","court":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"sig":"hFF1jQj5arz7t91ZRKTyWooglxs36Sq3yvBqEHvDieBqDTVIxavUMSeUn2BPiifaRU75AKnIolBI6KP-KOutAg"}],"recovery":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
17pPVug0a_MS-fIHLqHvIkxtq6s0G8yZ-gvTPxbjXy20rA7yVXKzdpZ1Bpsk4D0_iXT9DWj5JHjVVxB2-LluDw
```

### B.5. Profile, `version` 3 (a restore)

The same link shape with vouchers instead of a signature: two of three, each revealing only its own
salt, counted against the `recovery` list the link carries (§3.3).

```
{"genesis":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y","pseq":3,"name":"Alice","chain":[{"key":"KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y"},{"key":"kAIz_MtYt-fQQiaSZcNG9Mfhzb3Y5a1kT6TndVQInFs","court":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"sig":"hFF1jQj5arz7t91ZRKTyWooglxs36Sq3yvBqEHvDieBqDTVIxavUMSeUn2BPiifaRU75AKnIolBI6KP-KOutAg"},{"key":"17Ffa8rSZgnuFbV_5lfpNbt29t3qbWSOZgD2Qzfwy2M","court":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"vouchers":[{"key":"5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU","salt":"saltmum","sig":"zlSag21icaKQIgVI-iopptghcCruIYne8uv1aI9P94VOSm-CoFQ3e44Ajp5zR0DPmvCwl3KJNKbJgCyFi-ZxBg"},{"key":"lSsNjsT3evpDW6UbuftsCqsxJ4eTe8pS21eX5p9QTNQ","salt":"saltsis","sig":"ttyqfT-I4auqFG0udf45r76o5gavmZEnStB0E5oAcQAKIAYNpkJRz9LjIqJfu8ZiolEB9Gtabq9w-RYtVOIHDw"}]}],"recovery":{"k":2,"leaves":["WU9iV-S-tZGjW-FrS9wk-rOZY5-PLunyBjVkt3_9um4","wUP6Dx7DznM2KJ6vN9XxcgyUW8zjER_B9ULwMXXA9Hc","frqJoJxgmjRUXk-XHjW0knmo7NDdFa3Kqz1bohnM4TQ"]},"locations":["https://alice.example/alice"],"read":"cLoW-OhUZjtdhQBEZbMz92JNIyeJc3q_EU3WkzIsjkc"}
QKPzYgL7DQIDmwG3RflZmIv7xwW9s4RoooWd_EpljPJzyR6tf9g93OzVq6KwKS8xzf2CPP6NFWrobQMJqgn_Cg
```

### B.6. Post

The number is inside the signed bytes (§5.1).

```
{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}
JenRgJyI2SN2Rf26q8P6-yfATUWqobPIc9b9i5rTsGwj3p9CT_QkeFHec--GmOwkwr0Z6Op1AIrLH6hawRyHAw
```

### B.7. Post — a reply

The target names the author's anchor key, the number, all 43 characters of the address, and where
the replier last knew that author to live (§5.4).

```
{"n":3,"at":"2026-07-19T09:30:00Z","text":"congratulations, both of you","rel":"reply","target":{"key":"5ywjllCxE-n6N6Ugee2AYJDSGaBb4HA81cODDf_NoqU","n":12,"hash":"_wcb5V3yCD3C6KmN7mOmNw3DKJcRdBJItfW0Z-Ic_kc","loc":"https://mom.example/mom"}}
S4mRckyGslGrhS5n9O6KmD0qqweGXOzu784PMH3sUHgrDqD5SliKvKiecBa6JWbIm9y1hkFTzor1_Bzqd433Dw
```

### B.8. Post — encrypted

Only `n` and `at` are in the clear; the text, the relation, the target and the media references are
inside the envelope (§6.6), and so is the audience, naming each recipient by anchor key, reading key
and location (§6.5). The audience is padded to eight slots (§6.4); the six dummies are random bytes,
drawn here from a seeded stream so the vector reproduces. The carrier bound into the associated data
is `KgEodEif3xsa539zA8FLVaFvAOiXBEXBlvGWJo9Oo4Y:5`.

```
{"n":5,"at":"2026-08-18T21:40:00Z","sealed":{"epk":"bulurRC1e4YYuDGwVZj_Yh9ZgswZoponWSc5JsAp5z8","slots":[["cwNqOZ1KtPU","LRz0F-kLZzeE3HcRmOcfbdxrFr7PIszC4GJ6JiiQBW2D_2yuzRMWiemDHEawzpsH"],["SzNzzQy4o2c","2rsCQZAjQMhlxocGQd4baI0tsCQiZqRX8BtHmJ8mihXiGd5DtWA0mmPvzLY0Ite-"],["ILHlw-FK67c","EEU5dLZYx6yEemQZP08spx3Y5pQzWwofzUulmWSGNbIMT8a2knmNjUfsl3cdChDa"],["zopSOkIKgJA","851y70OHR0pocIlM2xXn1AFGJov5I1-8AJetsUZZUg7IIrUsAvVD6EjNSBpyIOrV"],["hRdE2dQilV0","jhRdmjLCLWphJNUnZB51gFsZx-SDyhst09cIU4dTvTb6WBoMgcb-WU_CQG_8A0Bv"],["qjOkXqGsg6A","y5a0GA8nhNIcQ-VUZaRm57oApXBpsrVeAfknLoePEjG9WI3xDrKBOCyAbOFC9c4M"],["O0DMO8iWfSg","hlttXoxLa4Lsnku2aci3pMQXbxAJ4_yL6C2JWC2kwdreCKdwNS55MlDW48XLlFLr"],["egvAYnVIubU","R9Xb_tWYWN9e9jD7MRIMvW_yDhRunvH2X6UEtOaFOMGmTBondgMEGsOQMNXVWWbK"]],"ct":"F0a_r7lGklcYcRiWYCqFFFNp-LVbDvXoMpnGcjuCE4M2wPAy7BFRHxBc-VVy-7UWHcW0mZuGSAL1ciZacbdkimDVSoB-43mWafOWXphvPemBv9vQysIpreYdZN80gXmqrwgEU1FX6pkPbnhh_Ar1d9e_Cr_tFMaf9ZEjOjp7l9o6hCnVWMqdhMarC-Dqz9l61Pb7YW5__E1Anz_RvGWdZdMr1YJoFUWpvaXZPLpPlrDB60scEDCOlIKGYIHbpAM_LDO_j_UUviXfq6H7akDGDt2ookJtvaLSbiwXmPo-hU5ONM5PFMylYsPp5HNXs5Kv1wuaTQb0asjrl8pJ7uSCsIAspXZyLgXX4IlHI97ks2P1_6s9xmiYn9gFxekNQX9l98xbfXHkMw4mYTS_mwafKcQYVt6ihiZc3FDjD_22BZJ9u3h65mBtodt9OKw4FC1YnDyy3Omd7_jQpzzh40vYRIz3j7dDRXtykla-n4QjscunP7Eg3SQjErNJk86HWyFLMFFuFjdHpZvddYan_Yscgf8M3Vkir0lWrr-ux0UFcqxNyr7afJK3D0pJLuHb_qqpCyntEnz743_xEJ2iNN6B9bsJjzP1y9Kqm_za9Ea4Z-CygTZP7LX_RB1OJjeDZCDKr3oD5GkNmllSxKXiAlby8emchzLqjNu-pjRfm--gBAiIbRYv4indeNwi_bUshW0b"}}
-_4Dp2haV17saQcirH8_m5-yJQpjAy0P8pZhHePc6NvxDCvBEzBWW2MKGzT80YF9jM263k2J8egr4zXfyADgDg
```

### B.9. Index, `version` 1

Three posts live.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"]],"hseq":1,"top":3}
a0_uUhyp3MeHYvU3Rt2tZ_YPIezh8xZNtRJM3BjzgwB84ry5deWfqhNv27xm0X9R15DvALY-CHg_A1EUSIPtDg
```

### B.10. Index, `version` 2 — a withdrawal, a media file

Post 2 is withdrawn by an appended line, post 5 is the encrypted one, and the media file is listed by
its address alone. The media file's bytes are 26 bytes hashing to
`fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g`.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"],[2,null],[4,"3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo"],[5,"R84DUdZcPR-SDboffq3p4DiC5HZ62URDz5Ed76Is03k"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"]],"hseq":2,"top":5}
7_GkGP4o9Jt-gm2dNO6UpZ-z8mE5oZCqCFqiqHLwWKvXF-XW424mDz1UGs5P9t_AXFOHxpAcIb3fy7h47PeiCA
```

### B.11. Index, `version` 3 — the rewrite, and a number that comes back

The lines the withdrawal left behind are gone (§4.7), and post 2 is re-listed at the hash it had
(§4.2). A reader holding `version` 2 accepts this: it remembers the withdrawn hash, and the same
bytes coming back are not a change.

```
{"entries":[[1,"hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY"],[3,"i8fWlv91EDyWVMc6iURfRC5pdun7669DXd59uEIBpn4"],[4,"3mnLZnbcYLQKoGGsRAjrSkU0cO7ALyYHCsjacXKGMeo"],[5,"R84DUdZcPR-SDboffq3p4DiC5HZ62URDz5Ed76Is03k"],["fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g"],[2,"AkmRbiX-pd5u2-E0I8HLguor4ft81dB1eEWUz2JMRFs"]],"hseq":3,"top":5}
a2MZEsB7gh_laQ3xPOVlXAYXr4TZgXJXGtDiU9zCKTSstmP4jlP-eyGwpwan2f3Rtlw-xjlgR5pp8E1MaY6YAA
```

### B.12. The spoken code (§3.1)

Six 11-bit indices into a 2,048-word list, from the anchor key above — or from any key (§3.1).

```
HKDF-SHA256(ikm = key, salt = "", info = "openfeed/v1/spoken", 9 bytes)
indices  1991 1056 613 530 955 1997
```
