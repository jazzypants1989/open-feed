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
