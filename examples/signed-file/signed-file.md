# A signed file

**Spec:** §2.1 the file format, §2.2 addresses, §2.5 extension fields.
**Run:** `node examples/signed-file/signed-file.js`

Everything Open Feed puts on the wire is a file of this shape:

```
<body bytes><\n><86 base64url characters>
```

The body is a JSON object. The last line is an Ed25519 signature over the body bytes exactly as
served. There is no header, no envelope, no wrapper object, and no second construction anywhere in
the protocol — a profile, an index and a post are all this, and differ only in what the object says.

## What the output shows

**Three parts, and nothing else.** The example signs the spec's own Appendix B.6 post and prints
the resulting 153 bytes: 66 of body, one separator, 86 of signature. You can hold the whole format
in your head, which is the point — a second implementer has to reproduce it from the text alone
(`GOALS.md` scenario 6, the weekend).

**The signature says who.** `verifyFile` hands back four things: the parsed object, the bytes it
verified, the address, and *which key signed*. Under mum's key the same file is not a file at all.
Nothing else in the protocol establishes authorship — not the domain it came from, not a field
inside the object claiming a name, not the path it was served at. This is `GOALS.md` floor item 1,
the host cannot speak for you, reduced to a single function call.

**86 characters that re-encode to themselves.** Base64 admits more than one spelling of the same 64
bytes: the final character of an 86-character signature carries two bits that decode to nothing, so
flipping them leaves a *different* string that a lenient decoder reads as the *same* signature. The
example builds that respelling and watches it fail. The rule — decode to 64 bytes **and** re-encode
to the same characters — is what makes "the file alice signed" a set with one member in it. The
same strict decode reads every 43-character key in the protocol.

**No raw newline in the body.** A verifier splits at the **last** `\n`, so "the line after the body"
and "the last line" are the same line for everyone. That only works because the body contains no
`\n` of its own — and it never does, because a compact JSON serializer escapes a newline in text as
`\n` (two characters). The example signs a post whose text has a line break in it and shows the
body with no `0x0a` byte anywhere.

**The address is the hash of the body.** Not of the file. Some standard libraries — Apple's
CryptoKit among them — produce randomized Ed25519 signatures, so two honest signings of one body
are two different files. The example makes that concrete by having mum sign alice's exact body:
different bytes on the wire, identical address. If the address covered the signature, it would
depend on which library ran, and an index entry written on a phone would not match the same post
re-signed on a laptop.

**An unknown member is not yours to drop.** `_mood` survives a round trip because it is inside the
signature; a store that strips it hands back something that no longer verifies. That is why §2.5
makes preservation a MUST rather than politeness: there is no way to drop a member and still have
a file.

## Contrast

Most signed-document formats put a layer between the bytes served and the bytes signed, and the
layer is where the interoperability bugs live.

- **JWS compact serialization** base64url-encodes the payload, so what a reader receives is not
  what the signer signed. RFC 7797's unencoded-payload option fixes that, at the cost of a header
  with `"b64":false` and a `crit` list every verifier must negotiate before it can even look at the
  signature. "Body, newline, signature" is that option with the header removed.
- **Canonical JSON (RFC 8785 / JCS)** signs a re-serialization. A verifier must parse what it was
  served, re-serialize it by the canonicalization rules, and hope its number formatting, string
  escaping and member sorting agree with the producer's. Every parser divergence lives in that gap.
  §2.3 removes the gap by removing the step; `no-canonicalization/` is the example for it.
- **Nostr** signs the SHA-256 of a serialized array with its own escaping rules, so the JSON on the
  wire is again not the signed input.
- **The Linked Data Signatures Mastodon layered on ActivityPub** (`RsaSignature2017`) need RDF
  dataset canonicalization (URDNA2015) before anything can be signed at all — the most expensive
  version of the same idea, and the draft it rests on is superseded; the fediverse signs the HTTP
  request instead, so an object cannot be re-verified once it has left the wire.

The trade Open Feed makes is that a publisher must keep the bytes it signed and serve *those*. It
cannot regenerate a file from a database row and expect it to verify. In exchange, verification is
three standard-library calls and needs no library at all, which is priority 1 in `GOALS.md`.
