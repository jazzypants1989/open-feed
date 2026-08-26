# Open Feed Protocol Specification

**Version 0.1.0 — Draft, unreleased.**

## Summary

Open Feed is a protocol for publishing from your own domain with an identity you control. Your
identity is a cryptographic key — not a URL, not an account — so it travels with you if you move.
Everything you publish is a signed file at a stable URL, and readers can verify it without trusting
your hub. The entire protocol is built from primitives found in most languages' standard libraries.

Your hub is just storage — a static file server is a fully conforming hub. People on different
hubs reply, react, and share encrypted content with each other as easily as people on the same one.
The protocol is designed for the case where your hub operator can look at everything, refuse to
cooperate, and may not be on your side — the adversary is a loved one who controls the family hub —
and content for chosen people is encrypted to their keys.

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
| **checkpoint** | what a reader verified and remembers about an identity — the profile, the chain, the recovery lists at each chain length, and the index |
| **withdraw** | remove a post from the live set by appending a line to the index |
| **hub** | anything that stores and serves the files. It holds no key of yours and makes no decision about who you are |

A **publisher** writes files, a **reader** verifies them, a **hub** stores and serves them. Known-good
files for every construction below are in `test-vectors.md`.

## 2. Files

Everything on the wire is one of four kinds of file, under a name the publisher claims (§8.4):

| kind | path | overwritten? | signed by |
|---|---|---|---|
| profile | `/<name>/profile` | yes, compare-and-swap | the current key — the key the chain ends on |
| index | `/<name>/index` | yes, compare-and-swap | the current key |
| post | `/<name>/posts/<number>` | no, created once | any key in the chain |
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

The bytes served are the bytes signed. A publisher signs what it serialized; a reader verifies what it
received; neither re-serializes.

### 2.4. JSON hygiene

A publisher MUST NOT emit a duplicate member name, a member named `__proto__`, an integer outside
±(2^53 − 1), or an unpaired UTF-16 surrogate. A reader SHOULD reject a body containing any of them, and
one that accepts `__proto__` MUST parse into an object that does not inherit from it.

### 2.5. Unknown members

Unknown members MUST be preserved; they are inside the signature. Extension members SHOULD begin
with `_`.

## 3. Identity

Your identity is your anchor key: a 32-byte Ed25519 public key. A reader MUST obtain it by a route the
hub does not control (§3.7) and MUST refuse a profile whose `anchor` differs from it.

### 3.1. The profile

```json
{"anchor":"<key>","version":3,"name":"Alice",
 "chain":[{"key":"<anchor>"},{"key":"<key2>","recovery":{"leaves":["<hash>","<hash>","<hash>"]},"signature":"<86 chars>"}],
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
`{"key", "recovery", "signature"?, "vouchers"?}`: `key` is the key this link moves to; `recovery` is the recovery
list as it stood before this link; `signature` is an Ed25519 signature by the previous link's key over the ASCII
bytes `<previous key>-><new key>`, checked as §2.1 checks a signature line — a **rotation**; `vouchers`
are `{key, salt, signature}` signatures over the same bytes by recovery-list members, and one counts when its
signature verifies and `SHA-256(salt ‖ "|" ‖ key)` in base64url is one of `recovery.leaves` — a
**restore**.

A link is valid when `signature` verifies, or when the distinct voucher keys that count are more than half of
`recovery.leaves`. A reader MUST reject a profile whose chain contains a link that is neither. A list of
fewer than 2 leaves cannot restore. Vouchers MAY be added to a link after it was made.

A restore changes the key and nothing else: a checkpointed reader MUST report **contested** for a profile whose
chain has grown by any link without `signature` and whose `recovery`, `locations`, `name`, or `read` differ from
the checkpoint.

A chain MUST NOT exceed 64 links, and a reader MUST reject a longer one. A key rotated away from keeps its
posts valid but cannot sign an index (§4.4) or hold a number against the owner (§8.5).

### 3.3. The recovery list

`{"leaves": ["<hash>", …]}`. Each leaf is `SHA-256(salt ‖ "|" ‖ member key)` in base64url with a distinct
random salt per member, so a member vouching reveals only itself. The list MUST NOT exceed 32 leaves, and a
reader MUST reject a longer one. It MAY be empty, and a list of fewer than 2 cannot restore.

A publisher SHOULD create and list a backup key at setup, so that one other person plus that key
restores. A publisher SHOULD rotate when the list changes, because a changed list reaches readers only
through a new link; changing the key means writing the profile and then the index (§4.4). A reader
SHOULD flag a restored identity "recently restored" for seven days; the flag is presentation, not a
verdict (§7.2).

### 3.4. Contests

A reader MUST apply four rules to a served profile:

1. The checkpoint holds the chain, and a served chain MUST extend it key for key. The first index at which
   they diverge is the **divergence point**; a higher `version` whose chain is a strict prefix of the
   checkpointed chain diverges at the end of the prefix.
2. A recovery list is kept per chain length — the first one the reader saw at that length — and MUST NOT
   be overwritten.
3. A link is judged by the list the reader holds at that length, never by the copy the link carries. A
   checkpointed reader MUST NOT adopt a carried list at any length its chain already reaches.
4. More than half of the recovery list at the divergence point, vouching on exactly one side, wins. `signature` is not a
   vote. If both sides reach a majority, or neither, the identity is **contested** (§7.2) and the reader
   follows no branch until handed the current key (§3.7).

Outside a divergence, `version` MUST NOT go backwards, and the same `version` at a different address is
contested.

### 3.5. Locations

`locations` lists every base the paths of §2 hang off. A reader MUST remember every location a verified
profile has ever named. Moving is publishing a profile with a higher `version` naming the new place. A
reply carries its target's location as the replier knows it (§5.4), and a reader that sees a newer
location in a verified post follows it.

### 3.6. The reading key

`read` is an X25519 public key; it is what others encrypt to (§6). A publisher MUST encrypt only to the
`read` of the highest profile `version` it has verified, and SHOULD read the profile again before encrypting:
a `read` the owner has replaced still verifies, and content sealed to it is readable by whoever took it and
by nobody else. Rotating `read` protects nothing already sent. A restore does not recover it.

### 3.7. First contact

A link is the location with the anchor key in its fragment, `https://alice.example/alice#<anchor key>`;
the reader compares and refuses on mismatch. A spoken code is six words: `HKDF-SHA256(ikm = key, salt = "",
info = "openfeed/v1/spoken", 9 bytes)`, the first 66 bits read as six 11-bit big-endian indices into the
BIP-39 English wordlist, which implementations MUST use. When a reader is contested, either route MAY carry
the key the owner's chain currently ends on; a reader given that key MUST follow the branch containing it
and checkpoint there.

## 4. The index

```json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>"],["<media hash>"]],"version":9,"highest":3}
```

| member | meaning |
|---|---|
| `entries` | the lines, in order; the live set is their replay (§4.1) |
| `version` | a non-negative integer that MUST NOT go backwards |
| `highest` | the highest post number ever issued, `0` when none has been (§4.2) |

`entries` MUST come first in the body, so that appending a line leaves every earlier byte in place and a
reader MAY fetch only the tail.

### 4.1. Entries and replay

| line | means |
|---|---|
| `[number, hash]` | post `number` exists at address `hash` |
| `[number, null]` | post `number` is withdrawn |
| `[hash]` | the media file at address `hash` exists (§4.3) |
| `[hash, null]` | that media file is withdrawn |

A reader computes the live set by replaying the entries in order. `number` is a positive integer. A number has
one hash, ever: a line for a `number` already seen is legal only if it withdraws a live `number` or re-lists a
withdrawn `number` at the identical hash. A withdrawal MUST refer to something live. `[hash]` for a media file
already live is illegal. `highest` MUST be at least the highest number in `entries`. An index that verifies
but entries are invalid is invalid, and a reader reports **tampered** (§7.2). A checkpointed reader remembers the hash of
every number it saw withdrawn, and a number that comes back at another hash is **tampered**.

### 4.2. `highest`

`highest` MUST NOT decrease, even when the post holding that number is withdrawn.

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

A publisher MAY replace the index with replay of its entries, at a higher `version`. A reader accepts a
rewritten index exactly as it accepts an appended one.

## 5. Posts

```json
{"number":7,"at":"2026-08-01T09:00:00Z","text":"the divorce is final",
 "rel":"reply",
 "target":{"key":"<anchor>","number":3,"hash":"<hash>","location":"https://mom.example/mom"},
 "media":["<media hash>"]}
```

A post is immutable, created once (§8.2), and signed by any key in its author's chain.

### 5.1. `number`

A post MUST declare the number it is published at inside its signed bytes. A file served at `/posts/<number>`
whose `number` is another number is not that post (§7.1).

### 5.2. `at`

`at` is an RFC 3339 timestamp. It is what apps display and order by, and it decides nothing else: no
verdict in this protocol is reached from a clock. A reader MUST NOT reject a post for a missing or
malformed `at`.

### 5.3. `rel`

`rel` is `reply`, `root`, `like`, `repost`, `quote`, `mention`, or `supersedes`, or an absolute URL for anything
else. An edit is a new post with `rel: "supersedes"` naming the old one, which is withdrawn; a reader
holding the superseding post SHOULD show replies that target the superseded `(number, hash)` under it.

### 5.4. `target`

```json
"target": {"key":"<author anchor>","number":3,"hash":"<43 chars>","location":"https://mom.example/mom"}
```

All four members are REQUIRED on a post whose `rel` names another post: `key` is the target author's
anchor key, `number` the target's number, `hash` the full 43-character address of the target post,
and `location` where the replier last knew that author to be served (§3.5). A reader MUST treat a
reply whose `hash` is not what the target's index lists for `number` — now, or when it was
withdrawn — as a reply to something else.

### 5.5. `media`

An array of media addresses (§4.3). On an encrypted post, `rel`, `target` and `media` are inside the
envelope (§6.5); the public file carries only `number`, `at`, and `encrypted`.

### 5.6. Private messages

A private message is a post encrypted to its recipients (§6), listed in the sender's own index. There is
no inbox.

## 6. Encrypted content

An encrypted post is a post whose content is inside an `encrypted` member:

```json
{"number":5,"at":"2026-08-01T09:00:00Z",
 "encrypted":{"ephemeral":"<x25519 key>","slots":[["<tag>","<wrapped>"],...],"ciphertext":"<ciphertext>"}}
```

It is signed, addressed, and listed exactly as any other post, and a reader that cannot open it verifies
it and returns it with `encrypted` opaque (§7.1). A reader MUST NOT present encryption or audience
control as protection from a hub that is in the audience.

### 6.1. The envelope

The ephemeral X25519 key pair MUST be fresh for each message and MUST NOT be reused: two messages
under one ephemeral wrap their content keys under the same `kek` and `knonce`. For each recipient reading key `R`:

```
Z                               = X25519(ephemeral private, R)
tag(8) || kek(32) || knonce(12) = HKDF-SHA256(ikm = Z, salt = ephemeral, info = "openfeed/v1/slot", 52 bytes)
wrapped                         = ChaCha20-Poly1305(key = kek, nonce = knonce, plaintext = content key, aad = ephemeral)
```

and the content, once:

```
plain      = UTF-8 JSON of {"audience": [...], ...the post's content members...}
ciphertext = ChaCha20-Poly1305(key = content key, nonce = 12 zero bytes, plaintext = plain, aad = ephemeral || <anchor>:<number>)
```

`ephemeral` is the ephemeral public key in base64url; wherever it is used as bytes it is the 32 raw key bytes.
Each slot is a `[tag, wrapped]` pair of base64url strings. A reader MUST reject an all-zero `Z`.
The content key MUST be 32 random bytes and MUST NOT be reused across messages. `plain` is a JSON object
body and §2.4 applies to it.

### 6.2. Post binding

The associated data of `ciphertext` is the ephemeral public key followed by the ASCII bytes
`<author anchor key>:<post number>` of the post the envelope is published in. This binding MUST
be present; an envelope lifted into another post does not open there.

### 6.3. Slots and tags

A recipient derives its own tag from its own `Z` and scans the slots for it. A tag is a hint: a match
whose unwrap fails is a collision, and the reader MUST keep scanning.

### 6.4. The audience

`audience` MUST be an array of the recipients inside the plaintext, each
`{"key": <anchor>, "read": <x25519 key>, "location": <location>}`, and a publisher MUST include itself.

### 6.5. An encrypted post's target

Inside the envelope, `rel` and `target` are as in §5, and each `media` entry is
`{"hash": <listed hash>, "key": <base64url>}` (§4.3).

## 7. Reading

A reader is given the anchor key it learned (§3), a location, and optionally the checkpoint it kept from last time.
The steps are in order; each supplies what the next checks.

### 7.1. The steps

1. Fetch `<location>/profile`. Not served: **tampered**. Does not parse under §2.4: **contested**.
2. `anchor` is not the key learned: **contested**.
3. Adopt a recovery list for every chain length beyond those the checkpointed chain reaches, from the links'
   `recovery` and the profile's, keeping any list already held.
4. Walk the chain (§3.2), judging each link by the list held at its length. A link that fails, or a link
   without `signature` beside a change it may not make: **contested**.
5. Verify the signature under the key the chain ends on. Failure: **contested**.
6. Against a checkpoint, apply §3.4.
7. Fetch `<location>/index`, verify it under the current key (§4.4), replay it (§4.1). An index that does
   not verify: a reader holding one it verified before keeps that one and notes `no index I can verify`;
   a reader holding none: **tampered**.
8. Against a checkpoint: `version` and `highest` MUST NOT go backwards, else **tampered**.
9. Against a checkpoint: the same `version` at a different address is **tampered**.
10. Against a checkpoint: every live number at or below the checkpointed `highest` MUST have been live or
    withdrawn before at the identical hash, else **tampered**. Media files are exempt.
11. Against a checkpoint: numbers the checkpoint held that are no longer live are noted `withdrawn: <number>`
    and their hashes kept.
12. For each live entry, fetch it. A media file's bytes MUST hash to the listed address. A post MUST verify
    under a key in the chain, its address MUST equal the listed hash, and its `number` MUST equal the number it
    was served at. A failure, or a listed file not served: **tampered**.
13. For each post naming a target whose author the reader holds a checkpoint for: if `target.hash` is not what
    that author's index lists for `target.number`, now or when it was withdrawn, mark the target unresolved
    (§5.4); otherwise, if `target.number` is above that author's `highest`, look again (§7.4).

### 7.2. Verdicts

A read returns exactly one of **ok**, **tampered** (this hub is misbehaving), or **contested** (this identity
is contested), and a reader MUST NOT invent a fourth. `recently restored`, `withdrawn: <number>`, and `no index I
can verify` are notes on an ok read.

### 7.3. The checkpoint

What a reader keeps from an ok read: the profile's `version` and address, the chain, the recovery list at
each chain length, every location ever named, the index's `version` and address, `highest`, the live set with
its hashes, and the hash of every number it saw withdrawn.

### 7.4. Targets and the rumor rule

A look-again re-reads the target's author at the locations the reader holds (§3.5) and then at the reply's
`location`, in that order because the reply's `location` is an address the replier chose, and updates the checkpoint
on an ok read. This is also the only way a reader learns of posts a hub holds and does not serve, and it reaches
them only when someone the reader already reads has replied to one. Two bounds are REQUIRED: look again at most
once per identity per pass, and say one line per replier — *"X replied to something I cannot see"* — however
many replies they wrote.

## 8. Publishing

```
PUT /<name>/profile        If-Match: <etag>   → 200 | 412
PUT /<name>/index          If-Match: <etag>   → 200 | 412
PUT /<name>/posts/<number>                         → 201 | 200 (reclaimed) | 409
PUT /<name>/media/<hash>                      → 201 | 200 (replaced) | 409 | 400
PUT /<name>/feed.json | feed.xml | index.html  If-Match: <etag>  → 200 | 412   (§10)
GET any of the above                          → 200 | 404
```

There is no account, token, or session: the request is the signed file. A hub that checks the proof (§8.4)
answers 403 for a profile or index that does not verify and 409 for a name held under another anchor or a
`version` that has not advanced. A hub MAY require more of its own publishers — a pass, an account, a
rate limit, a bill.

### 8.1. Compare-and-swap

A publisher MUST send `If-Match` with the entity tag of the version it read, and a hub MUST answer 412 if the
file has changed since, or if the file exists and the request carries no `If-Match`. The tag is strong,
opaque to the publisher, and compared byte for byte; a hub MAY use the SHA-256 of the bytes it serves. A
writer that loses MUST re-read the file the hub now serves and merge its own line into that file's
`entries`.

### 8.2. Create-once

A hub MUST refuse a write to a number already held, except under §8.5. Numbering need not be gapless: a
device that comes back MUST abandon a number it cannot prove it listed, and MUST NOT list one late.

### 8.3. Write order

The post is written before the index that lists it.

### 8.4. Claiming a name

First come, with the profile as the proof. Later writes under that name MUST carry the same `anchor` and a
`version` that has advanced. A hub that accepts writes MUST refuse a profile whose chain does not walk or
whose signature does not verify under the key the chain ends on, and an index that does not verify under
the key the profile it holds ends on. A publisher MUST write an index when it claims a name, even an
empty one.

### 8.5. Reclaiming a number

A number held by a file that is not the owner's MAY be overwritten by the owner, and by nobody else. The
owner's file declares that number in its body and is either signed by the key the profile's chain
currently ends on or listed at that number and address in the index. A hub MAY check nothing on the
ordinary path of a post or a media file; it MUST NOT ignore a collision.

### 8.6. Media

A hub MUST replace a file at `/<name>/media/<hash>` whose bytes do not hash to that name when offered
bytes that do, and MAY refuse bytes that do not hash to the name.

### 8.7. What a hub must do

Serve back the exact bytes it was given (§2.3). Allow cross-origin reads with
`Access-Control-Allow-Origin: *`; a hub that accepts writes MUST answer the preflight for a cross-origin
`PUT` with `If-Match` and expose `ETag`.

### 8.8. Withdrawal and deletion

There is no `DELETE`. Withdrawing removes a line from the index, not a file. A hub MAY remove a file the
current index does not list, after a grace window covering §8.3. A publisher MUST NOT tell a user that
withdrawing erased anything.

### 8.9. Your copy

A publisher MUST keep the signed bytes of everything it publishes.

## 9. Fetching

Every rule here binds a reader's outbound requests; the rumor rule (§7.4) follows a URL a replier chose.

- HTTPS only, certificates validated.
- At most 5 redirects, never to a different origin; each redirect is re-checked for scheme and address.
- Refuse non-public addresses, checked on the resolved address before the socket connects, and on address
  literals in the URL. Blocked IPv4: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`,
  `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`.
  Blocked IPv6: the unspecified address, loopback, link-local, unique-local, multicast `ff00::/8`, discard
  `100::/64`, documentation `2001:db8::/32`, ORCHID `2001:10::/28` and `2001:20::/28`, Teredo `2001::/32`,
  and every embedded-IPv4 form judged as the IPv4 address it carries: `::ffff:a.b.c.d`, `::a.b.c.d`,
  `::ffff:0:a.b.c.d`, `64:ff9b::/96`, `64:ff9b:1::/48`, `2002::/16`. A dotted quad with a leading zero MUST be
  refused.
- Bound everything: one timeout over connect, redirects and body (10 s RECOMMENDED); a body cap per fetch
  (1 MB RECOMMENDED for the profile, index and a post; larger for media); a cap on concurrent sockets per
  origin (10 RECOMMENDED); a cap on identities resolved per pass.

A cap or a transport failure is no verdict: the read did not complete, and a reader MUST NOT show it as a
state of the identity.

## 10. Views

A publisher SHOULD write a JSON Feed 1.1 document, an Atom feed, and an h-card page, generated from the
index and the posts, at `/<name>/feed.json`, `/<name>/feed.xml`, and `/<name>/index.html`; a hub MAY generate
them itself. A view is unsigned, and a reader MUST NOT treat one as evidence of anything. Item ids
are `urn:openfeed:<anchor key>:<number>` and the feed's id is `urn:openfeed:<anchor key>`. Withdrawn posts are
absent. Encrypted posts are omitted or rendered as an empty placeholder item at their number; a view MUST
NOT carry ciphertext. The h-card's name is the profile's `name`.

A hub SHOULD serve a WebFinger response (RFC 7033) at `/.well-known/webfinger` for each name it holds, linking the profile (`application/openfeed+json`) and the h-card page.

The h-card page SHOULD include `<link rel="alternate">` entries pointing to the JSON Feed and Atom views. The WebFinger response SHOULD include matching `alternate` links.

| kind | media type |
|---|---|
| profile, index, post | `application/openfeed+json` |
| JSON Feed view | `application/feed+json` |
| Atom view | `application/atom+xml` |
| h-card page | `text/html` |
| media | whatever the bytes are |

A reader MUST NOT reject a signed file for its declared media type.
