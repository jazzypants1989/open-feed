# Files

§2 of the spec. Three concerns, one script: the signed file, no canonicalization, JSON hygiene.

---

## A signed file

**Spec:** §2.1 the file format, §2.2 addresses, §2.5 extension fields.
**Run:** `node examples/signed-file/signed-file.js`

Everything Open Feed puts on the wire is a file of this shape:

```
<body bytes><\n><86 base64url characters>
```

The body is a JSON object. The last line is an Ed25519 signature over the body bytes exactly as
served. There is no header, no envelope, no wrapper object, and no second construction anywhere in
the protocol — a profile, an index and a post are all this, and differ only in what the object says.

### What the output shows

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

### Contrast

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

---

## No canonicalization

**Spec:** §2.3, and §8.7 for the obligation it puts on a hub.
**Run:** `node examples/no-canonicalization/no-canonicalization.js`

**The bytes served are the bytes signed.** There is no canonical form, no member ordering rule, and
no re-serialization step anywhere in Open Feed. A producer serializes once and signs what it
serialized; a verifier hashes and verifies what it received, and never rebuilds it.

That is one sentence in the spec and it removes a whole subsystem. It also puts a real obligation on
whoever serves the file, which is what this example is mostly about.

### What the output shows

**The same object, three re-spellings.** The example pretty-prints alice's post, sorts its members,
and re-serializes it — three things an ordinary server, proxy, or template does without being asked.
All three parse to the object she signed. Two of them are not her file, and a reader cannot tell
"my host reformatted this" from "somebody rewrote this": both come out as *not signed by alice*.

The third — re-serializing with the same serializer that produced it — happens to verify. That is
worth seeing precisely because it is a trap: it will hold on the machine you tested and fail on the
one that has a different JSON library, a different float formatter, or a different idea of which
characters need escaping.

**What a canonicalizing verifier would have to agree about.** `{"n":1.0}` comes back `{"n":1}`.
`{"n":1e3}` comes back `{"n":1000}`. `{"t":"café"}` comes back with a literal é;
`{"t":"A"}` comes back as `A`. Every one of those parses to exactly what it claims and
serializes to something else. A protocol that signs a re-serialization has to specify all four (and
more) and then hope every implementation agrees — that is what RFC 8785 is, and why it is long.
Open Feed answers none of these questions, because it never asks them.

**A trailing newline does not corrupt the file, it re-cuts it.** This is the sharpest one. A
verifier splits at the *last* `\n` (§2.1). Append one byte and the split point moves to the end: the
"body" is now the old body plus the separator plus the signature, and the "signature line" is the
empty string. Nothing is corrupted; the file has simply become a different file with no signature in
it. Text editors, shell redirects, and build steps add that byte constantly.

**The same rule, seen from the hub.** §8.7 makes serving the exact bytes a MUST. The example runs
alice's file through three hubs and shows the reader's verdict for each. The cost is stated plainly:
**a hub cannot regenerate a file from a database row.** It stores the bytes it was given and returns
them. Everything else a hub does — compare-and-swap, create-once, reclaim (§8) — is arranged around
that one fact.

### Contrast

The alternative is to define a canonical form and sign that. RFC 8785 (JSON Canonicalization Scheme)
is the well-made version: sort members by UTF-16 code unit, format numbers by ECMAScript rules,
escape strings a fixed way. Three things count against it here:

1. **It needs a library, or 200 lines.** Priority 1 in `GOALS.md` is implementability from a
   standard library. No standard library canonicalizes JSON.
2. **The library is not enough anyway.** `JSON.parse` cannot reject a duplicate member name, so a
   strict parser is required *in addition* to the canonicalizer (see `json-hygiene/`). Two pieces
   of machinery where this design has one small parser and no canonicalizer.
3. **It reintroduces the gap it was meant to close.** Because the signature covers canonical bytes
   rather than served bytes, a further rule is needed — "a document must arrive as its own
   canonicalization" — to stop a verifier from pinning a normalization of what it was served
   instead of what it was served. That rule is easy to skip, and skipping it is silent.

The trade runs the other way here: publishing is stricter (keep your bytes) and verifying is three
standard-library calls. For a protocol whose adversary controls the server (`GOALS.md`, the
divorce), moving the strictness onto the *publisher's stored bytes* and away from the *verifier's
reconstruction* is also the safer direction — the reader's job gets smaller, and the reader is the
one who has to be right.

One apparent exception is not one. §4 requires `entries` to come first in an index's body — the
protocol's only member-order rule. It exists so that appending a line leaves every earlier byte where
it was, and a reader that cached the file can fetch only the tail. Nobody re-serializes anything, and
no verifier has to know the rule to check a signature.

---

## JSON hygiene

**Spec:** §2.4.
**Run:** `node examples/json-hygiene/json-hygiene.js`

A signed body reaches every reader as the same bytes. §2.4 is about the four ways those identical
bytes can still *mean* different things to two honest readers — and the whole protocol rests on them
meaning one thing, because "post 3 is this hash" is a claim two people have to agree about.

`JSON.parse` and its equivalents cannot see any of the four.

| what | `JSON.parse` | the problem |
| --- | --- | --- |
| `{"n":1,"n":2}` | keeps the last | nothing in JSON says which wins; other stacks keep the first |
| `{"__proto__":…}` | an ordinary member | a member that is not data |
| `{"n":9007199254740993}` | `9007199254740992` | silently, with no error to catch |
| `{"text":"\ud800"}` | a half-character | re-encoding replaces it with U+FFFD |

A producer MUST NOT emit any of them. A reader SHOULD reject any of them.

### What the output shows

**Four bodies `JSON.parse` accepts.** The example runs each through both parsers side by side: the
standard one, which takes them, and the §2.4 parser in `src/file.js`, which names what is wrong.
That parser exists for exactly this reason — it is the one piece of JSON machinery the protocol
needs, and it replaced a canonicalizer plus a strict parser in the earlier design (see
`no-canonicalization/`).

**The disagreements are not untidiness.** A duplicate `n` makes one signed body post 1 to you and
post 2 to me — and `n` is what the index admits (§4.1) and what a reply targets (§5.1). The integer
case is worse than a disagreement: no reader is *given* the choice, because the rounding happens
inside the parse. `9007199254740993` becomes `9007199254740992` with no error anywhere.

**The lone surrogate, in bytes.** `\ud800` parses to one UTF-16 unit that is half of a pair. Encode
it back to UTF-8 and you get `ef bf bd`, the replacement character — a different string. Anything
that displays, indexes, searches, or re-encodes it holds something other than what was signed.

**The producer half.** `signFile` parses its own serialization before it signs it, so a signer
refuses to emit three of the four. There is no fourth line: a JavaScript object cannot hold a
duplicate member and no serializer emits one. That is the shape of all four — unreachable by
accident, reachable on purpose. The rule is asymmetric for a reason worth stating plainly: **only
the author can sign**, so a producer that never emits one of these closes the ambiguity for
everybody, and the reader's check is there for the author who is not honest.

**Why `__proto__` is called out separately.** It is the exception to the asymmetry, because in a
JavaScript-family runtime the danger is not what the author meant — it is what the *reader's own
copy* does. `JSON.parse` gives an own member named `__proto__`; the moment anything copies that
object with `Object.assign`, spread, or a merge helper, the copy inherits from whatever the member
held. The example shows `copied.n === 9` with no own member named `n`. Hence the fallback clause:
a reader that does not reject `__proto__` MUST at least parse into an object it does not inherit
from, so a member can never arrive from a prototype.

**Everything else is ordinary JSON.** The largest safe integer, an emoji, escapes — all fine. The
last block also closes a loop with §2.3: the escape `\ud83d\udc90` and a literal 💐 parse to the
same string and are *different files*. There is no canonical spelling; the one that was served is
the one that was signed.

### Contrast

RFC 7493 (I-JSON) covers three of these four — unique names and no lone surrogates as MUST NOTs,
and integers outside the IEEE-754 exact range as a SHOULD NOT — and Open Feed's rules are I-JSON's
rules made uniform plus `__proto__`, which is a language hazard rather than an interchange one. The
difference is where the enforcement lives. I-JSON is a profile you are asked to conform to; §2.4 is
a parser you have to write anyway, because `JSON.parse` cannot express any of it and no standard
library ships a parser that catches all four (Python's `object_pairs_hook` gets the duplicate, and
nothing gets the surrogate).

The duplicate-member case in particular is a known attack class, not a hypothetical: parser
differentials between two services reading one document have been shown to produce authorization
bypasses (Bishop Fox, 2021).
Open Feed's exposure is narrower than a typical API's — there is one document format and one
verifier — but the consequence is sharper, because the document is signed. A body that says two
different things to two readers is a signature over an ambiguity, and the author can point at
whichever reading suits them afterwards.

The cost is about 100 lines of parser, once. `src/file.js` holds it, and it is the only place in the
reference implementation that knows what JSON looks like. That cost is also the sharpest tension in
`GOALS.md`: priority 1 says no dependencies, priority 2 says a second implementer finishes in a
weekend (scenario 6), and this parser is where the two meet — about a sixth of the weekend reader
is this parser. The alternative was a canonicalizer *plus* a strict parser, which is why the tension
resolves in favour of the parser alone.
