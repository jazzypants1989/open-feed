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
UTF-8 and serialized without whitespace, so it contains no raw `\n` (a newline inside a string is the
two characters `\n`); a verifier splits the file at its last `\n`. The signature MUST be Ed25519 over
the body bytes, encoded as exactly 86 base64url characters that decode to 64 bytes and re-encode to
the same 86 characters.

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
