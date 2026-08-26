# Files

§2 of the spec. Three concerns, one script: the signed file, no canonicalization, JSON hygiene.

---

## A signed file

**Spec:** §2.1 the file format, §2.2 addresses, §2.5 unknown members.
**Run:** `node examples/files/files.js`

Everything Open Feed puts on the wire is a file of this shape:

```
<body bytes><\n><86 base64url characters>
```

The body is a JSON object. The last line is an Ed25519 signature over the body bytes exactly as
served. There is no header, no envelope, no wrapper object, and no second construction anywhere in
the protocol — a profile, an index and a post are all this, and differ only in what the object says.

### What the output shows

**Three parts, and nothing else.** The example signs the spec's own `test-vectors.md`.6 post and prints
the resulting 153 bytes: 66 of body, one separator, 86 of signature. You can hold the whole format
in your head, which is the point — a second implementer has to reproduce it from the text alone
(`GOALS.md` scenario 6, the weekend).

**The signature says who.** `verifyFile` hands back four things: the parsed object, the bytes it
verified, the address, and *which key signed*. Under mum's key the same file is not a file at all.
Nothing else in the protocol establishes authorship — not the domain it came from, not a field
inside the object claiming a name, not the path it was served at. This is `GOALS.md` floor item 1,
the hub cannot speak for you, reduced to a single function call.

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

## No canonicalization

**Spec:** §2.3, and §8.7 for the obligation it puts on a hub.
**Run:** `node examples/files/files.js`

**The bytes served are the bytes signed.** There is no canonical form, no member ordering rule, and
no re-serialization step anywhere in Open Feed. A producer serializes once and signs what it
serialized; a verifier hashes and verifies what it received, and never rebuilds it.

That is one sentence in the spec and it removes a whole subsystem. It also puts a real obligation on
whoever serves the file, which is what this example is mostly about.

### What the output shows

**The same object, three re-spellings.** The example pretty-prints alice's post, sorts its members,
and re-serializes it — three things an ordinary server, proxy, or template does without being asked.
All three parse to the object she signed. Two of them are not her file, and a reader cannot tell
"my hub reformatted this" from "somebody rewrote this": both come out as *not signed by alice*.

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

## JSON hygiene

**Spec:** §2.4.
**Run:** `node examples/files/files.js`

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
§2.3's block above).

**The disagreements are not untidiness.** A duplicate `number` makes one signed body post 1 to you and
post 2 to me — and `number` is what the index admits (§4.1) and what a reply targets (§5.1). The integer
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
held. The example shows `copied.number === 9` with no own member named `number`. Hence the fallback clause:
a reader that does not reject `__proto__` MUST at least parse into an object it does not inherit
from, so a member can never arrive from a prototype.

**Everything else is ordinary JSON.** The largest safe integer, an emoji, escapes — all fine. The
last block also closes a loop with §2.3: the escape `\ud83d\udc90` and a literal 💐 parse to the
same string and are *different files*. There is no canonical spelling; the one that was served is
the one that was signed.

