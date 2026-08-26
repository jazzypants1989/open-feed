# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.**

## Summary

Open Feed is a protocol for publishing from your own domain with an identity you control. Your
identity is a cryptographic key — not a URL, not an account — so it travels with you if you move.
Everything you publish is a signed file at a stable URL, and readers can verify it without trusting
your host. The entire protocol is built from primitives found in most languages' standard libraries.

Your host is just storage — a static file server is a fully conforming host. People on different
hosts reply, react, and share encrypted content with each other as easily as people on the same one.
The protocol is designed for the case where your host operator can look at everything, refuse to
cooperate, and may not be on your side — and content for chosen people is encrypted to their keys.

## 1. Terms

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in
RFC 2119 and RFC 8174.

**base64url** is base64url without padding (RFC 4648 §5). An Ed25519 or X25519 public key is 43
characters, a SHA-256 hash is 43, an Ed25519 signature is 86.

| term | meaning |
|---|---|
| **profile** | the signed file naming your keys, locations, and recovery list |
| **index** | the signed list of what is currently published — which posts and media exist, and the highest number used |
| **post** | one immutable signed file; replies, reactions, and private messages are all posts |
| **anchor key** | your first signing key — it *is* your identity. A link or scanned code carries it, and readers follow the chain from it |
| **chain** | the links from the anchor key to the key in use now, each signed by the previous key or vouched by the recovery list |
| **recovery list** | the people or keys you named in advance to restore you, committed privately |
| **pin** | what a reader verified and remembers about an identity — the profile, the chain, the recovery lists at each chain length, and the index |
| **withdraw** | remove a post from the live set by appending a line to the index |
| **hub** | anything that stores and serves the files. It holds no key of yours and makes no decision about who you are |

A **publisher** writes files, a **reader** verifies them, a **hub** stores and serves them. Known-good
files for every construction below are in `test-vectors.md`.

## 2. Files

Everything on the wire is one of four kinds of file, under a name the writer claims (§8.4):

| kind | path | overwritten? | signed by |
|---|---|---|---|
| profile | `/<name>/profile` | yes, compare-and-swap | the current key — the key the chain ends on |
| index | `/<name>/index` | yes, compare-and-swap | the current key |
| post | `/<name>/posts/<n>` | no, created once | any key in the chain |
| media | `/<name>/media/<hash>` | no | not signed; admitted by being listed in the index |

### 2.1. The format

A signed file is its body, one `\n` byte, then the signature. The body MUST be a JSON object encoded as
UTF-8 and MUST NOT contain a raw `\n` byte — a newline inside a string is the two characters `\n` —
because a verifier splits the file at its last `\n`. The signature MUST be Ed25519 over the body bytes,
encoded as exactly 86 base64url characters that decode to 64 bytes and re-encode to the same 86
characters.

### 2.2. The address

A file's address is the base64url SHA-256 of its body. A media file's address is the SHA-256 of its
bytes.

### 2.3. No canonicalization

The bytes served are the bytes signed. A producer signs what it serialized; a verifier verifies what it
received; neither re-serializes.

### 2.4. JSON hygiene

A producer MUST NOT emit a duplicate member name, a member named `__proto__`, an integer outside
±(2^53 − 1), or an unpaired UTF-16 surrogate. A reader SHOULD reject a body containing any of them, and
one that accepts `__proto__` MUST parse into an object that does not inherit from it.

### 2.5. Unknown members

Unknown members MUST be preserved; they are inside the signature. Extension members SHOULD begin
with `_`.

## 3. Identity

Your identity is your anchor key: a 32-byte Ed25519 public key. A reader MUST obtain it by a route the
host does not control (§3.7) and MUST refuse a profile whose `anchor` differs from it.

### 3.1. The profile

```json
{"anchor":"<key>","version":3,"name":"Alice",
 "chain":[{"key":"<anchor>"},{"key":"<key2>","recovery":{"leaves":["<hash>","<hash>","<hash>"]},"sig":"<86 chars>"}],
 "recovery":{"leaves":["<hash>","<hash>","<hash>"]},
 "locations":["https://alice.example/alice"],
 "read":"<x25519 key>"}
```

| member | | meaning |
|---|---|---|
| `anchor` | MUST | the identity |
| `version` | MUST | a non-negative integer; MUST NOT go backwards |
| `chain` | MUST | the links from the anchor key to the key in use now (§3.2) |
| `recovery` | MUST | the recovery list (§3.3); MAY be empty |
| `locations` | MUST | every place this identity is served from (§3.5) |
| `read` | SHOULD | the X25519 key others encrypt to (§3.6) |
| `name` | MAY | a display name; MUST NOT be used to resolve or match an identity |

The profile MUST be signed by the key its chain ends on.

### 3.2. The chain

The chain is an array of links. The first MUST be `{"key": <anchor>}`. Every later link is
`{"key", "recovery", "sig"?, "vouchers"?}`: `key` is the key this link moves to; `recovery` is the recovery
list as it stood before this link; `sig` is an Ed25519 signature by the previous link's key over the ASCII
bytes `<previous key>-><new key>`, checked as §2.1 checks a signature line — a **rotation**; `vouchers`
are `{key, salt, sig}` signatures over the same bytes by recovery-list members, and one counts when its
signature verifies and `SHA-256(salt ‖ "|" ‖ key)` in base64url is one of `recovery.leaves` — a
**restore**.

A link is valid when `sig` verifies, or when the distinct voucher keys that count are more than half of
`recovery.leaves`. A reader MUST reject a profile whose chain contains a link that is neither. An empty
list cannot restore. Vouchers MAY be added to a link after it was made.

A restore changes the key and nothing else: a pinned reader MUST report **identity** for a profile whose
chain has grown by any link without `sig` and whose `recovery`, `locations`, `name`, or `read` differ from
the pin.

A chain MUST NOT exceed 64 links, and a reader MUST reject a longer one. A key rotated away from keeps its
posts valid but cannot sign an index (§4.4) or hold a number against the owner (§8.5).

### 3.3. The recovery list

`{"leaves": ["<hash>", …]}`. Each leaf is `SHA-256(salt ‖ "|" ‖ member key)` in base64url with a distinct
random salt per member, so a member vouching reveals only itself. The list MUST NOT exceed 32 leaves. It
MAY be empty, and an empty list means the identity cannot be restored.

An app SHOULD create and list a backup key at setup, and SHOULD require two or more members beyond the
owner's own keys. An app SHOULD rotate when the list changes, because a changed list reaches readers only
through a new link; changing the key means writing the profile and then the index (§4.4). A reading app
SHOULD flag a restored identity "recently restored" for seven days; the flag is presentation, not a
verdict (§7.2).

### 3.4. Contests

A reader MUST apply four rules to a served profile:

1. The pin holds the chain, and a served chain MUST extend it key for key. The first index at which they
   differ is the **split**; a higher `version` whose chain is a strict prefix of the pinned chain is a
   split at the end of the prefix.
2. A recovery list is kept per chain length — the first one the reader saw at that length — and MUST NOT
   be overwritten.
3. A link is judged by the list the reader holds at that length, never by the copy the link carries. A
   pinned reader MUST NOT adopt a carried list at any length its chain already reaches.
4. More than half of the recovery list at the split, vouching on exactly one side, wins. `sig` is not a
   vote. If both sides reach a majority, or neither, the identity is **contested** (§7.2) and the reader
   follows no branch until handed the current key (§3.7).

Outside a split, `version` MUST NOT go backwards, and the same `version` at a different address is
contested.

### 3.5. Locations

`locations` lists every base the paths of §2 hang off. A reader MUST remember every location a verified
profile has ever named. Moving is publishing a profile with a higher `version` naming the new place. A
reply carries its target's location as the replier knows it (§5.4), and a reader that sees a newer
location in a verified post follows it.

### 3.6. The reading key

`read` is an X25519 public key; it is what others encrypt to (§6). A publisher MUST encrypt only to a
`read` taken from a profile it verified. A restore does not recover it.

### 3.7. First contact

A link is the location with the anchor key in its fragment, `https://alice.example/alice#<anchor key>`;
the app compares and refuses on mismatch. A spoken code is six words: `HKDF-SHA256(ikm = key, salt = "",
info = "openfeed/v1/spoken", 9 bytes)`, the first 66 bits read as six 11-bit big-endian indices into the
BIP-39 English wordlist, which implementations MUST use. When a reader is contested, either route MAY carry
the key the owner's chain currently ends on; a reader given that key MUST follow the branch containing it
and pin there.

## 4. The index

```json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>"],["<media hash>"]],"version":9,"top":3}
```

| member | meaning |
|---|---|
| `entries` | the lines, in order; the live set is their fold (§4.1) |
| `version` | a non-negative integer that MUST NOT go backwards |
| `top` | the highest post number ever issued, `0` when none has been (§4.2) |

`entries` MUST come first in the body, so that appending a line leaves every earlier byte in place and a
reader MAY fetch only the tail.

### 4.1. Entries and the fold

| line | means |
|---|---|
| `[n, hash]` | post `n` exists at address `hash` |
| `[n, null]` | post `n` is withdrawn |
| `[hash]` | the media file at address `hash` exists (§4.3) |
| `[hash, null]` | that media file is withdrawn |

A reader computes the live set by folding the entries in order. `n` is a positive integer. A number has
one hash, ever: a line for an `n` already seen is legal only if it withdraws a live `n` or re-lists a
withdrawn `n` at the identical hash. A withdrawal MUST refer to something live. `[hash]` for a media file
already live is illegal. `top` MUST be at least the highest number in `entries`. An index that verifies
but does not fold is invalid, and a reader reports **host** (§7.2). A pinned reader remembers the hash of
every number it saw withdrawn, and a number that comes back at another hash is **host**.

### 4.2. `top`

`top` MUST NOT decrease, even when the post holding that number is withdrawn.

### 4.3. Media

A media file is listed by `[hash]` and served at `/<name>/media/<hash>`; a reader MUST verify that the bytes
hash to the name it fetched them under. A media file referenced by a post but not listed in the index is
absent. A media file attached to an encrypted post is encrypted: `ChaCha20-Poly1305(key, nonce = 12 zero
bytes, plaintext = the bytes, aad = "")` under a random 32-byte key; the ciphertext is what is listed and
served, and the key is carried as `{"hash": <listed hash>, "key": <base64url>}` in the envelope's `media`
(§6.5). A key MUST NOT be reused for a second media file.

### 4.4. Who signs the index

The index MUST be signed by the key the profile's chain currently ends on, not by any earlier key in the
chain.

### 4.5. Rewriting

A publisher MAY replace the index with the fold of its entries, at a higher `version`. A reader accepts a
rewritten index exactly as it accepts an appended one.

## 5. Posts

```json
{"n":7,"at":"2026-08-01T09:00:00Z","text":"the divorce is final",
 "rel":"reply",
 "target":{"key":"<anchor>","n":3,"hash":"<hash>","loc":"https://mom.example/mom"},
 "media":["<media hash>"]}
```

A post is immutable, created once (§8.2), and signed by any key in its author's chain.

### 5.1. `n`

A post MUST declare the number it is published at inside its signed bytes. A file served at `/posts/<n>`
whose `n` is another number is not that post (§7.1).

### 5.2. `at`

`at` is an RFC 3339 timestamp. It is what apps display and order by, and it decides nothing else: no
verdict in this protocol is reached from a clock. A reader MUST NOT reject a post for a missing or
malformed `at`.

### 5.3. `rel`

`rel` is `reply`, `root`, `like`, `repost`, `quote`, `mention`, or `supersedes`, or an absolute URL for anything
else. An edit is a new post with `rel: "supersedes"` naming the old one, which is withdrawn; a reader
holding the superseding post SHOULD show replies that target the superseded `(n, hash)` under it.

### 5.4. `target`

```json
"target": {"key":"<author anchor>","n":3,"hash":"<43 chars>","loc":"https://mom.example/mom"}
```

All four members are REQUIRED on a post whose `rel` names another post: `key` is the target author's
anchor key, `n` the number, `hash` the full 43-character address of the target post, `loc` where the
replier last knew that author to be served (§3.5). A reader MUST treat a reply whose `hash` is not what
the target's index lists for `n` — now, or when it was withdrawn — as a reply to something else.

### 5.5. `media`

An array of media addresses (§4.3). On an encrypted post, `rel`, `target` and `media` are inside the
envelope (§6.5); the public file carries only `n`, `at`, and `encrypted`.

### 5.6. Private messages

A private message is a post encrypted to its recipients (§6), listed in the sender's own index. There is
no inbox.

## 6. Encrypted content

An encrypted post is a post whose content is inside an `encrypted` member:

```json
{"n":5,"at":"2026-08-01T09:00:00Z",
 "encrypted":{"epk":"<x25519 key>","slots":[["<tag>","<wrapped>"],...],"ct":"<ciphertext>"}}
```

It is signed, addressed, and listed exactly as any other post, and a reader that cannot open it verifies
it and returns it with `encrypted` opaque (§7.1).

### 6.1. The envelope

One X25519 ephemeral key pair per message. For each recipient reading key `R`:

```
Z                               = X25519(ephemeral private, R)
tag(8) || kek(32) || knonce(12) = HKDF-SHA256(ikm = Z, salt = epk, info = "openfeed/v1/slot", 52 bytes)
wrapped                         = ChaCha20-Poly1305(key = kek, nonce = knonce, plaintext = content key, aad = epk)
```

and the content, once:

```
plain = UTF-8 JSON of {"audience": [...], ...the post's content members...}
ct    = ChaCha20-Poly1305(key = content key, nonce = 12 zero bytes, plaintext = plain, aad = epk || carrier)
```

`epk` is the ephemeral public key in base64url; wherever it is used as bytes it is the 32 raw key bytes.
Each slot is a `[tag, wrapped]` pair of base64url strings. An implementation MUST reject an all-zero `Z`.
The content key MUST be 32 random bytes and MUST NOT be reused across messages. `plain` is a JSON object
body and §2.4 applies to it.

### 6.2. Carrier binding

`carrier` is the ASCII bytes `<author anchor key>:<post number>` of the post the envelope is published in,
and MUST be bound as associated data of `ct` together with `epk`.

### 6.3. Slots and tags

A recipient derives its own tag from its own `Z` and scans the slots for it. A tag is a hint: a match
whose unwrap fails is a collision, and the reader MUST keep scanning.

### 6.4. The audience

`audience` MUST be an array of the recipients inside the plaintext, each
`{"key": <anchor>, "read": <x25519 key>, "loc": <location>}`, and a publisher MUST include itself.

### 6.5. An encrypted post's target

Inside the envelope, `rel` and `target` are as in §5, and each `media` entry is
`{"hash": <listed hash>, "key": <base64url>}` (§4.3).

## 7. Reading

A reader is given the anchor key it learned (§3), a location, and optionally the pin it kept from last time.
The steps are in order; each supplies what the next checks.

### 7.1. The steps

1. Fetch `<location>/profile`. Not served: **host**. Does not parse under §2.4: **identity**.
2. `anchor` is not the key learned: **identity**.
3. Adopt a recovery list for every chain length beyond those the pinned chain reaches, from the links'
   `recovery` and the profile's, keeping any list already held.
4. Walk the chain (§3.2), judging each link by the list held at its length. A link that fails, or a link
   without `sig` beside a change it may not make: **identity**.
5. Verify the signature under the key the chain ends on. Failure: **identity**.
6. Against a pin, apply §3.4.
7. Fetch `<location>/index`, verify it under the current key (§4.4), fold it (§4.1). An index that does
   not verify: a reader holding one it verified before keeps that one and notes `no index I can verify`;
   a reader holding none: **host**.
8. Against a pin: `version` and `top` MUST NOT go backwards; the same `version` at a different address is
   **host**; every live number at or below the pinned `top` MUST have been live or withdrawn before at
   the identical hash, else **host**; numbers the pin held that are no longer live are noted
   `withdrawn: n` and their hashes kept. Media files are exempt.
9. For each live entry, fetch it. A media file's bytes MUST hash to the listed address. A post MUST verify
   under a key in the chain, its address MUST equal the listed hash, and its `n` MUST equal the number it
   was served at. A failure, or a listed file not served: **host**.
10. For each post naming a target whose author the reader holds a pin for: if `target.hash` is not what
    that author's index lists for `target.n`, now or when it was withdrawn, mark the target unresolved
    (§5.4); otherwise, if `target.n` is above that author's `top`, look again (§7.4).

### 7.2. Verdicts

A read returns exactly one of **ok**, **host** (this host is misbehaving), or **identity** (this identity is
in question), and a reader MUST NOT invent a fourth. `recently restored`, `withdrawn: n`, and `no index I
can verify` are notes on an ok read.

### 7.3. The pin

What a reader keeps from an ok read: the profile's `version` and address, the chain, the recovery list at
each chain length, every location ever named, the index's `version` and address, `top`, the live set with
its hashes, and the hash of every number it saw withdrawn.

### 7.4. Targets and the rumor rule

A look-again re-reads the target's author at the locations the reader holds (§3.5) and then at the reply's
`loc`, and updates the pin on an ok read. Two bounds are REQUIRED: look again at most once per identity
per pass, and say one line per replier — *"X replied to something I cannot see"* — however many replies
they wrote. A reader MAY try the locations it already holds before the address in the reply.
