# JSON hygiene

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

## What the output shows

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

## Contrast

RFC 7493 (I-JSON) covers three of these four — unique names, integers inside the IEEE-754 exact
range, no lone surrogates — and Open Feed's rules are I-JSON's rules plus `__proto__`, which is a
language hazard rather than an interchange one. The difference is where the enforcement lives.
I-JSON is a profile you are asked to conform to; §2.4 is a parser you have to write anyway, because
`JSON.parse` cannot express any of it and no standard library ships one that can.

The duplicate-member case in particular is a known attack class, not a hypothetical: parser
differentials between two services reading one document have produced real authorization bypasses.
Open Feed's exposure is narrower than a typical API's — there is one document format and one
verifier — but the consequence is sharper, because the document is signed. A body that says two
different things to two readers is a signature over an ambiguity, and the author can point at
whichever reading suits them afterwards.

The cost is about 100 lines of parser, once. `src/file.js` holds it, and it is the only place in the
reference implementation that knows what JSON looks like. That cost is also the sharpest tension in
`GOALS.md`: priority 1 says no dependencies, priority 2 says a second implementer finishes in a
weekend (scenario 6), and this parser is where the two meet — about a quarter of the weekend reader
is this and nothing else. The alternative was a canonicalizer *plus* a strict parser, which is why
the tension resolves in favour of the parser alone.
