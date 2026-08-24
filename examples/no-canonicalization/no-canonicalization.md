# No canonicalization

**Spec:** §2.3, and §8.7 for the obligation it puts on a hub.
**Run:** `node examples/no-canonicalization/no-canonicalization.js`

**The bytes served are the bytes signed.** There is no canonical form, no member ordering rule, and
no re-serialization step anywhere in Open Feed. A producer serializes once and signs what it
serialized; a verifier hashes and verifies what it received, and never rebuilds it.

That is one sentence in the spec and it removes a whole subsystem. It also puts a real obligation on
whoever serves the file, which is what this example is mostly about.

## What the output shows

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

## Contrast

The alternative is to define a canonical form and sign that. RFC 8785 (JSON Canonicalization Scheme)
is the well-made version: sort members by UTF-16 code unit, format numbers by ECMAScript rules,
escape strings a fixed way. Open Feed's own earlier drafts signed RFC 8785 bytes inside a detached
JWS.

Three things went wrong with it, in this project's own history:

1. **It needs a library, or 200 lines.** Priority 1 in `GOALS.md` is implementability from a
   standard library. No standard library canonicalizes JSON.
2. **The library is not enough anyway.** `JSON.parse` cannot reject a duplicate member name, so a
   strict parser was required *in addition* to the canonicalizer (see `json-hygiene/`). Two pieces
   of machinery where the current design has one small parser and no canonicalizer.
3. **It reintroduces the gap it was meant to close.** Because the signature covers canonical bytes
   rather than served bytes, the old spec needed a further rule — "a chained document must arrive as
   its own canonicalization" — to stop a verifier from pinning a normalization of what it was served
   instead of what it was served. That rule is easy to skip, and skipping it is silent.

The trade runs the other way now: publishing is stricter (keep your bytes) and verifying is three
standard-library calls. For a protocol whose adversary controls the server (`GOALS.md`, the
divorce), moving the strictness onto the *publisher's stored bytes* and away from the *verifier's
reconstruction* is also the safer direction — the reader's job gets smaller, and the reader is the
one who has to be right.

One apparent exception is not one. §4 requires `entries` to come first in an index's body — the
protocol's only member-order rule. It exists so that appending a line leaves every earlier byte where
it was, and a reader that cached the file can fetch only the tail. Nobody re-serializes anything, and
no verifier has to know the rule to check a signature.
