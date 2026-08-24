# Posts and targets

**Spec:** §5 entire — §5.1 `n`, §5.2 `at`, §5.3 `rel`, §5.4 `target`, §5.5 `media`, §5.6 private
messages are posts. Appendix B.6 and B.7 are its vectors.
**Run:** `node examples/posts-and-targets/posts-and-targets.js`

A post is the last of the three file shapes and the only one that carries what somebody wrote. It is
an ordinary signed file (§2) whose object says at most four things: the number it is published at,
when its author says it was written, what it says, and what it answers. **A post is immutable,
created once, and signed by any key in its author's chain at the time of writing** — so a post
signed before a rotation keeps verifying after it, and no post is ever edited in place.

There is one such object and there are no others. A reply, a reaction, a repost, an edit and a
direct message are all this object with a different `rel`, and the only structural difference
between a public post and a private one is whether the content sits inside an envelope (§6). Nothing
in the protocol is a like endpoint, a boost verb, a revision history, or an inbox.

## What the output shows

**A post, and its members.** The first block prints Appendix B.6 byte for byte — 66 bytes of body,
one `\n`, 86 characters of signature — and names each member against the object §5 opens with. Then
two facts that go together: post 1 verifies under alice's **anchor key** and post 3 under **the key
she rotated to**, because a reader checks a post against *any* key in the chain (§7.4); and a
second, different file PUT at the path where post 1 already lives comes back `409`, because a
numbered post is created once (§8.2). Immutable and signed-by-any-chain-key are the two halves of
the same design: the key can move, the file cannot.

**The number is inside the signed bytes.** §5.1 is one sentence and it is doing structural work. The
example signs one `at` and one `text` at number 2 and again at number 6, and the two files have
different addresses; strip `n` out of the body and both hash to the same thing. That is the whole
mechanism — because the number is inside the bytes, it is inside the address, and post 2 *is not*
post 6 at any hash. So a host that wants to show you post 2 where post 6 should be has to serve a
whole different file, and the reader that checks the served file's address and its `n` against the
index says **this host is misbehaving** (§7.3) — `post 6 is not what the index lists`.
Nothing about the file was tampered with: the signature is alice's and the bytes are hers. It is
simply not that post.

**At the hub, the number is the other half of the reclaim rule.** A hub checks nothing on the
ordinary path of a post, so a stranger can `201` a file into a number alice has not reached yet —
and the file he replays can be one of *hers*, signed by the key her chain ends on. What tells the
hub it is not her file for that number is that it does not declare that number. When she publishes
her own post 9 it does, and the hub replaces his (§8.5). Take `n` out of the bytes and the replay is
indistinguishable from her own post 9: the hub would have to keep it and refuse her, forever, on her
own name. `examples/publish-interface/` owns §8.5; this block only shows the half that §5.1
supplies.

**`at` is content time, and is never a verdict.** This one is worth being emphatic about. The
example publishes a post dated 1970 and a post dated 3026. Both are perfectly valid; the reader
returns **ok** with no note; an app that sorts by `at` gets `5 1 2 3 4 6` while the index's own
order is `1 2 3 4 5 6`. Neither timestamp was consulted to reach any verdict, and neither decides
precedence: a number has one hash ever (§4.2) and the index that says so is signed. §13.2 is the
complete list of places a clock appears in this protocol — `at`, the seven-day "recently restored"
flag, the rewrite cadence — and not one of them gates anything. The reason is in the threat model:
the adversary runs the server, and a party who runs the server also sets its clock.

**A reply, a reaction, and a private message are the same kind of object.** The block prints a
`like` and a `reply` side by side; they differ in `rel` and in whether there is a `text`. The third
line is the encrypted post from further down, which is the same object again. `rel` is `reply`,
`root`, `like`, `repost`, `quote`, `mention` or `supersedes`, or an absolute URL for anything a
vocabulary of seven does not cover.

**An edit is a new post that withdraws the old one.** Post 7 carries `rel: "supersedes"` and a
target naming post 3 and its hash; the index withdraws 3 in the same amendment. The reader reads
**ok** and notes `withdrawn: 3`, and — this is the part that makes the SHOULD implementable — **the
pin keeps the hash post 3 had**. So sis's older reply, which targets `(3, that hash)`, still
resolves: the reader can see what it was answering even though the post is gone from the live set.
§5.3 asks a reader holding post 7 to show those replies under it, and without the remembered hash
every edit would orphan its thread.

**`target`, and the full hash.** The block prints Appendix B.7 byte for byte and names all four
members. `key` is the target author's **anchor key, never a URL**, because the URL can change and
the identity cannot; `loc` is where the replier last knew that author to live, which is how someone
who moved gets found again (§3.7). `hash` is all 43 characters of the target's address — not a
prefix, not an opaque id.

**A reply whose target hash the index does not list is a reply to something else.** This is the rule
that makes the full hash more than decoration, and the example stages the attack it stops. Mum has
two signed files that each say "post 12"; her index lists one of them. Sis replies to each. For a
reader holding a pin for mum, the first reply threads and the second is returned with its target
marked unresolved — and, correctly, the reader says nothing about it, because a mismatched target is
not evidence against anybody in particular (§7.5). Both replies are genuine and signed. What the
rule denies is the *author* who shows one room one post 12 and another room a different one: only
one of them is in the index a given reader verified, so only one of the two threads can look right.

**`media`, and none on an encrypted post.** A public post carries `media` as an array of addresses;
the index lists each file by its address alone and the reader checks that the bytes hash to it
(§4.4). The encrypted post's public members are exactly `n`, `at`, `encrypted` — no `media`, no
`rel`, no `target`, because on an encrypted post all three are inside the envelope, and each media
entry there is `{hash, key}` rather than a bare hash (§6.6). `examples/media/` and
`examples/envelope/` are where those live.

**A private message is a post.** It sits at `/alice/posts/4` on **alice's own host**, listed in her
own index, and there is no inbox anywhere for it to be delivered to — the example PUTs at a
plausible inbox path on mum's hub and gets a `404`, because the path does not exist in the protocol.
A non-recipient's reading key opens nothing; mum's opens it. Then the two costs §5.6 insists on
stating, both shown rather than asserted:

- **The host learns the shape of the correspondence.** It holds the file, so it knows a message
  exists, when it was written, how big it is, and — from its own logs — who fetched it and when.
  §6.4's padding hides exactly one distinction, a message to one person from a message to the
  family; nothing hides the rest (§13.3).
- **The host can withhold it.** The example deletes the file and reads again: the verdict is **this
  host is misbehaving** with `post 4 is listed and not served`. That verdict is real, and it does
  not give mum the message. A host that has gone quiet and a sender who has gone quiet look the same
  from where she is standing (§13.3).
- **A signed private message is provable by its recipient forever.** Alice's signature covers this
  ciphertext; mum holds the key that opens it and her own copy of the bytes (§10). Withdrawing post
  4 unmakes neither.

## Contrast

**"Everything is a post" as a design choice.** ActivityPub goes the other way: an extensible
vocabulary of activity types over ActivityStreams 2.0 — `Create`, `Like`, `Announce`, `Follow`,
`Undo` and more — delivered by POST to an actor's `inbox`. That buys expressiveness and a place to
hang new verbs. It costs a server that must know what each type means, a delivery side channel with
its own authentication story, and an `Undo` for every verb. Open Feed has one object and a `rel`, so
there is **one code path, one verifier, and one retention rule**: everything is a numbered file the
index lists or does not. The cost is real and worth naming — a `rel` value is not self-describing to
a client that has not heard of it, and there is no negotiation, no type registry, and no way to make
a new kind of post behave differently on the wire. A reader that does not recognise a `rel` has a
post it can verify and display and cannot interpret. The bet is that this is the better failure.

**The full target hash, against threading by identifier alone.** Email's `In-Reply-To` names a
`Message-ID`, and ActivityPub's `inReplyTo` names a URI: in both cases the identifier says *which*
object, and nothing about *what it said*. The thing at that URI can change afterwards, and every
reply to it silently comes to be answering something else. Nostr is the closer relative — an `e` tag
holds an event id that is itself a hash of the event, so a Nostr reply does bind its parent's
content. What Open Feed adds on top is the pairing with a **number**: because `(author, n)` is the
slot a post lives in and the index is signed, a reply naming `(key, n, hash)` can be checked against
what that author's index lists at `n`, now or when the reader saw it withdrawn. That check is what
makes a number safe to use as a join key at all. Without it, an author could hand out two files that
both claim to be post 12 and let two audiences build two coherent threads under "the same" post;
with it, one of the two lands nowhere.

**`at` deciding nothing, against timestamp precedence.** Plenty of protocols resolve conflicts with
a wall clock. Nostr's replaceable events are the nearby example: relays keep the copy with the
largest `created_at`, breaking ties on the id — a timestamp the publisher chooses. Last-write-wins
registers in CRDT-flavoured systems do the same thing. It works when nobody has an incentive to lie.
Open Feed's adversary is the operator of the family hub, who supplies the serving path and can set
any clock he likes, so precedence is carried by monotonic counters he cannot forge instead:
`version` on the profile and the index, and one-hash-per-number on posts, all inside signed bytes.
`at` is left to do the only job it can honestly do, which is tell an app what order to draw things
in.

**The direct-message trade, against Signal.** This is the least comfortable part of §5 and it
deserves plain arithmetic. Signal hides the sender from its own server for delivery (sealed sender)
and authenticates messages with a MAC under a key both parties hold rather than with a signature —
so a recipient cannot hand a transcript to a third party as cryptographic proof of who wrote it.
That property is usually called deniability, and it is worth being modest about: it is a
cryptographic property, not a social one, and it does not stop anybody being believed.

Open Feed gives up both, deliberately and by construction.

- **Sealed sender is not available**, because a message *is* a numbered file on the sender's own
  hub. The host holds it; the shape of the correspondence is visible to whoever serves it (§13.3).
- **Deniability is given up**, because the same per-post signature that stops the ex from posting as
  his wife also makes anything she sends provable by whoever received it. There is no separate
  construction for messages (§6): one signing rule covers the whole protocol, and that is most of
  why a second implementer can write a verifier in an afternoon.
- **There is no forward secrecy** either (§13.3): a reading key that leaks opens every encrypted
  post ever addressed to it, and changing `read` in a new profile version does not re-encrypt the
  past.

For the person in `GOALS.md` scenario 1 — the sister publishing from her ex's hub during a divorce —
the ledger reads: the property she needs most, that he cannot write anything in her name and cannot
alter or backdate what she wrote, is exactly the property that makes her own private messages
provable by their recipients. She should be told that, in those words, by any client that offers her
messaging. §13.1 already forbids the marketing claim; this is the same honesty pointed at the
recipient's side of the wire.

The other scenario this example serves is `GOALS.md` scenario 3, **two hubs, one thread**. Because a
`target` names an anchor key and a location rather than an account on a server, sis replying from
her own hub to mum's post 12, and mum reacting to alice's post from a third, need no federation
handshake, no shared access control, and no agreement between the hubs at all. Each reply is a file
its author publishes on her own host; threading is something readers do afterwards, out of hashes.
