# Open Feed

**Publish from a place you control, with an identity that is a key.**

Open Feed is a simple, interoperable protocol for publishing content. Everything on the wire is a
signed file, built from primitives already in a standard library — Ed25519, X25519, SHA-256,
ChaCha20-Poly1305, HKDF, JSON, HTTP. There is no server software to install and no account to
hold: a static file server is a conforming hub for reading. A hub that accepts writes checks a
little more ([§8.4](open-feed-spec.md#84-claiming-a-name), [§8.5](open-feed-spec.md#85-reclaiming-a-number)).

**Status: 0.1.0, draft, unreleased.**

## How it works

Your identity is a signing key. A profile at your address names your current keys, your locations,
and a recovery list, and chains every key change back to your first key — so a reader who learned
that key, from a link or a spoken code, follows you through every rotation and move.

Every file is signed, and the bytes served are the bytes signed. Beside the profile sits an index:
the signed list of what exists now. A post counts as yours when the index lists its hash;
withdrawing it appends a line taking it back, gone when the file is next rewritten. A post signs
itself, so anyone holding a copy can prove you wrote it.

A reply, reaction, or private message is a post in its author's feed, naming its target by key,
number, hash, and location. Readers pull; a newer location in any verified post is where a reader
looks next. A reply naming a number above the index's highest makes a reader look again, then say
only that it cannot see what was answered. Private content is encrypted to chosen keys with the
audience inside; a direct message is that, to one.

## What it guarantees

The hub cannot speak for you: nothing verifies as yours unless your key signed it, and that key was
never the hub's. It cannot read what you encrypted to others. It cannot keep you — your key and your
copy are yours, and your readers hold the rest, so you leave by writing the same files elsewhere. It
cannot drop or swap a post without a reader who saw it noticing, nor show two people different
histories once one of them replies to something the other cannot see. Losing your key is survivable:
the people you named restore it.

## Glossary

- **anchor key** — your first signing key; it _is_ your identity, and a link or a spoken code carries it
- **chain** — the links from the anchor key to the key in use now, each signed by the previous key or vouched for
- **profile** — the signed file naming your keys, your locations, and your recovery list
- **index** — the signed list of what is published now, and the highest post number you have used
- **post** — one immutable signed file; a reply, reaction, or private message is a post naming a target
- **media** — a file admitted by its hash appearing in the index, not by a signature of its own
- **recovery list** — the people or keys you named in advance to restore you, committed privately
- **checkpoint** — what a reader verified for itself and remembers; it is what catches a lying hub later
- **withdraw** — take a post out of the live set by appending a line to the index
- **hub** — anything that stores and serves the files; it holds no key of yours and decides nothing about who you are

## Contributing

Changes arrive as pull requests, and a pull request here is **code**. `open-feed-spec.md` is
generated: every rule in it is a `rule()` call in an example, printed right after the assertion that
proves it, and a rule no running script proves is not in the spec. There is nothing in the spec file
to patch, and a protocol proposal with no example that runs is not reviewable.

So a change to the protocol is a change to an example:

1. Edit the rule where it is proved — a `rule()` in `examples/<concept>/<concept>.js`, beside its
   assertion. A new rule needs a new assertion to earn it.
2. Run `npm run spec -- --write` and commit the regenerated spec as part of your change. Anything
   typed by hand into `open-feed-spec.md` is lost on the next write. If you touched signing, document
   shape, or the envelope, run `npm run vectors -- --write` and commit that too.
3. Run `npm run check`. Green before you open the pull request, not after.

```sh
npm test            # no dependencies, Node >= 20
npm run spec        # re-run every example; fail if the spec is not what they printed
npm run vectors     # check test-vectors.md, verifying every vector with both readers
npm run check       # all of the above, plus this page's word budgets
```

New concepts get their own example, under the contract in
[`examples/README.md`](examples/README.md). Bug reports, questions, and "have you considered" do not
need any of this — open an issue.

| where                                    | what                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| [`open-feed-spec.md`](open-feed-spec.md) | the specification — **generated** from the examples                              |
| [`test-vectors.md`](test-vectors.md)     | known-good files, verified by two independent readers                            |
| [`src/`](src/)                           | the reference implementation: zero dependencies, one module per spec chapter     |
| [`examples/`](examples/)                 | one small program per concept; read them in order and you have read the protocol |
| [`bridge/`](bridge/)                     | four other protocols — **interop, not spec**                                     |
| [`archive/`](archive/)                   | what the redesign superseded, and the record of why                              |

## Interop

Beside the signed files a publisher writes three unsigned **views** — a JSON Feed, an Atom feed, and
an h-card page ([§10](open-feed-spec.md#10-views)). Point an ordinary feed reader at either feed and
it works today. A view proves nothing, and is not meant to: a reader that cares verifies the signed
files.

[`bridge/`](bridge/) translates one Open Feed identity into ActivityPub, Nostr, AT Protocol, and the
IndieWeb, stdlib-only and adding no rule to the protocol — **interop, not spec**. Each bridge holds
its own key, so the account a follower sees on Mastodon survives Open Feed key rotation.

[`COMPARISON.md`](COMPARISON.md) sets each of Open Feed's decisions beside the way those protocols
made it.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
