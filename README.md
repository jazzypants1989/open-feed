# Open Feed

A small protocol for publishing from a place you control with an identity that is a key. It is aimed
at families and small groups first.

Everything on the wire is a signed file: a JSON body, one `\n`, and an Ed25519 signature over the
body bytes exactly as served. The whole protocol is built from primitives most standard libraries
already ship — Ed25519, X25519, SHA-256, ChaCha20-Poly1305, HKDF, JSON, HTTP. There is no
canonicalizer, no JOSE, no ledger, no account, and no server that owns your name. Your hub is
storage: static hosting is a conforming hub for reading.

[`open-feed-spec.md`](open-feed-spec.md) is the specification and the only source of truth. This
document explains; the spec defines. Section references like §4.2 point into it.

---

## Why

From [`GOALS.md`](GOALS.md), which is the floor this protocol is judged against:

> The first prompt was about Tim Berners-Lee's SOLID: self-hosting and data privacy, done more
> pragmatically than Mastodon or Bluesky. The project's real adversary arrived later, from life:
> **if my sister had been on her abusive ex-husband's hub, he would have controlled her words, her
> inbox, her archive, and her ability to leave — during a divorce.**

That person is the design's adversary, and he is unusual in a specific way. He is inside the family
and entitled to look. He runs the server, so he controls the serving path and everything that
travels it. He supplies the client if he can. He will not cooperate, and there is no regulator,
appeal, or third party who can make him.

Against him the protocol does not promise confidentiality for anything he was an audience of, and it
does not promise he will keep serving. It promises two things he cannot take: **verification he
cannot forge**, because the key that signs was generated on the other device and he never held it,
and **exit**, because the copy and the key were always on that device and leaving is writing the
same files somewhere else (§10, §13.1).

Everything below is downstream of that.

---

## TL;DR

**Your identity is your anchor key** — a 32-byte Ed25519 public key you generated. Not a URL, not a
name, not an account. A reader learns it from a link with the key in its fragment, or from six
spoken words, and refuses any profile that does not carry it (§3.1).

**Everything on the wire is one of four kinds of file** (§2), at conventional paths under a name the
hub assigns:

| kind | path | overwritten? | signed by |
| --- | --- | --- | --- |
| profile | `/<name>/profile` | yes, compare-and-swap | the key the chain ends on |
| index | `/<name>/index` | yes, compare-and-swap | the key the chain ends on (§4.6) |
| post | `/<name>/posts/<n>` | no, created once | any key in the chain |
| media | `/<name>/media/<hash>` | no | not signed — admitted by being listed in the index |

**A signed file is body bytes, one `\n`, then 86 base64url characters of signature.** The bytes
served are the bytes signed; there is no canonical form and no re-serialization step (§2.3). A
file's address is the base64url SHA-256 of its body — 43 characters — never of the whole file, since
some libraries sign randomly (§2.2).

**The profile** names your anchor key, the chain of key changes running back to it, your recovery
list, every location you are served from, and the X25519 key others encrypt to (§3.2).

**The index** is the signed answer to *what exists now*: a list of lines that a reader folds into a
live set, a `version` that never goes backwards, and `top`, the highest post number ever issued
(§4). It is what makes withholding visible — a host cannot quietly drop a post, because the author
signed a statement that it exists.

**A post** is one immutable file. A reply, a reaction, a repost, an edit and a private message are
all posts with a different `rel`; a reply names its target by anchor key, number, full hash, and
where the replier last knew that author to live (§5). There is no inbox and nothing is pushed.

**Private content** is encrypted to a chosen set of reading keys, with the audience inside the
ciphertext and the recipients found by blinded per-message tags. A direct message is that set with
one member in it. The hub learns that an encrypted post exists, when, and roughly how big (§6).

**A reader** performs §7's steps in a fixed order and returns exactly one of three verdicts: **ok**,
**this host is misbehaving**, **this identity is in question**. What it verified it remembers, in a
pin, and the pin is what catches a lying host on the next read.

**Publishing** is `PUT` of a signed file. There is no account, no token, and no session: the request
*is* the credential, because only your key can make it (§8). Anyone's client can write to anyone's
hub, on purpose — a hub that ships the app can take the key.

**Leaving** is writing the same files somewhere else. The host is asked for nothing and has nothing
to refuse (§10).

**What a person can rely on**, which is `GOALS.md`'s floor:

- **The host cannot speak for you.** Nothing it serves as yours verifies unless you signed it, and
  the key that signs was never the host's.
- **The host cannot read what wasn't meant for it.** Content for chosen people is encrypted to their
  keys, and the host serves bytes it cannot open.
- **The host cannot keep you.** The key and the copy were always on your device.
- **Family on other hubs are first-class.** Two relatives on separate domains reply and react to
  each other's family-only content with no access control anywhere.

Vocabulary is fixed and small: *anchor key, chain, link, recovery list, profile, index, post, media,
encrypted, pin, withdraw, hub* (§1).

---

## How it works

### The file, and the address

A signed file is three parts:

```
{"n":1,"at":"2026-07-04T10:15:00Z","text":"the peonies came back"}
Pe6ZO_mwGsToFUaNh1sRuPI7kTastKn7qJ3KpXyPBupKLLJzuoZiAnfwUbXTxnULHkLkqevKxmU3q3xPj1ehDQ
```

That is Appendix B.6: 66 bytes of body, one `\n`, 86 characters of signature — 153 bytes on the
wire. A profile, an index and a post are all this shape and differ only in what the object says.

Three rules make the shape unambiguous. The signature line has to decode to 64 bytes *and* re-encode
to the same 86 characters, so one file has one spelling. The body carries no raw `\n`, so "the line
after the body" and "the last line" are the same line for every implementation — a compact JSON
serializer never emits one. And the address is the hash of the **body**: Appendix B.6's body hashes
to `hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY`, which is exactly what Appendix B.9's index lists
at number 1.

**There is no canonicalization** (§2.3). A producer serializes once and signs what it serialized; a
verifier hashes and checks what it received and never rebuilds it. The consequence lands on whoever
serves the file: a hub that pretty-prints, sorts members, or appends a newline makes every file it
touches read as forged, which is why §8.7 makes serving the exact bytes an obligation. A trailing
newline is the sharpest case — it does not corrupt the file, it moves the split point, so the file
quietly becomes a different file with no signature in it.

**§2.4 closes the four ways `JSON.parse` lets two honest readers disagree** about one signed body: a
duplicate member name, a member called `__proto__`, an integer rounded past 2^53, an unpaired
surrogate. A producer emits none of them; a reader rejects them. This is the one piece of JSON
machinery the protocol needs, and it replaced a canonicalizer plus a strict parser.

### Identity is a key

Your anchor key *is* your identity (§3). A reader that learns your key from the host it is reading
has learned nothing, because the host chose both the profile and the key printed inside it. Two
routes go around the host (§3.1):

- **A link or scanned code** — `https://alice.example/alice#<anchor key>`. A fragment is never sent
  in a request, so the key never reaches the server, and a plain browser still lands on the page.
- **A spoken code**, for a phone call: six words from the BIP-39 English wordlist, derived by
  `HKDF-SHA256(ikm = key bytes, salt = "", info = "openfeed/v1/spoken", 9 bytes)` cut into six
  11-bit fields. Alice's anchor key in Appendix B.12 is indices `923 1951 1851 172 1664 898`, which
  reads *inflict view trash better source icon*. Six words is 66 bits — enough that grinding a
  colliding key is centuries of GPU time. Five would not be.

A user is never shown a key. That is a design constraint, not a UI preference: a safety check that
is 43 characters of base64url is a safety check nobody performs.

### The chain, and coming back from a lost key

A key you have held for years is a key you may lose or have taken. The **chain** is an array of
links inside the profile, running from the anchor key to the key in use now, with exactly one link
shape (§3.3). A link carrying `sig` is a **rotation** — the previous key signed the ASCII bytes
`<previous key>-><new key>`, so the owner moved. A link carrying `vouchers` is a **restore** —
members of the **recovery list** signed the same bytes, so the owner's people moved them. A link may
carry both, and vouchers can be added to a link after it was made.

A recovery list is a threshold `k` and one salted hash per member —
`SHA-256(salt ‖ "|" ‖ member key)` (§3.4). Publishing it publishes only how many people are on it;
a member vouching reveals their own salt and key and nothing about anybody else's. Nothing is split,
shared out, or reassembled — your people hold their own keys, and what they can do with them is sign
one sentence about you.

A key rotated away from stays in the chain and keeps its old posts valid. What it can no longer do
is sign an index (§4.6) or hold a number against the owner (§8.5). That is how a stolen old key is
closed without a revocation message — and the reason there is no revocation message is that it would
have to reach the reader over a path the adversary controls.

**A chain that walks proves nothing on its own** (§3.6). A thief holding one of your keys can
publish a chain that walks perfectly from your anchor, and so can someone holding none of them, with
a link vouched by a recovery list of their own making. Four rules settle a contest between two
profiles claiming one identity. A reader's pin holds the chain and a served chain has to extend it
key for key; a recovery list is kept per chain length and never overwritten; a link is judged by the
list the reader holds, never by the copy the link carries; and a **majority** of the list at the
split wins, on exactly one side, or the identity is **contested** and the reader follows nobody
until a person hands it the current key.

Majority rather than `k`, for one reason: the abuser is on the recovery list, because he is family.
Under a threshold, one listed adversary vouches for himself and hands himself her identity. Under a
majority he cannot, ever, alone. The price is stated where the rule is — a one-of-two restore
against a bare rotation stays contested until a second member vouches.

Two limits nothing repairs, and §13.3 says so rather than hiding them: a cold reader's recovery list
is whatever the first profile it saw carried, so a reader that first meets an identity on a thief's
branch will reject the real one later; and a change to the list only reaches other readers through a
new chain link.

### Locations, and moving

`locations` lists every place an identity is served from. A reader remembers every location a
verified profile ever named and tries the others when one stops answering (§3.7). Moving is writing
the same signed files somewhere else and publishing a profile with a higher `version` — nothing is
asked of the host you are leaving, which matters because that host is often the adversary.

The mechanism that reaches readers who never learn the new address is **the address riding along in
other people's posts**: a public reply carries its target's location as the replier knows it, and a
reader that sees a newer location in a post it verified follows it there. Someone with any social
path to the departing person is found; a reader with none is not, and sees the frozen copy as an
unmarked page. Because an encrypted post's target is inside the envelope, relocation rides in public
replies only.

### The index

```json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>"],["<media hash>"]],
 "version":9,"top":3}
```

Four line shapes and no others: `[n, hash]` says post `n` exists at that address, `[n, null]`
withdraws it, `[hash]` says a media file exists, `[hash, null]` withdraws it. A reader recomputes
the live set by **folding** the lines in order, so a reader that joined at `version` 1 and a reader
that joined at `version` 6 hold the same answer about today (§4.2). An index that does not fold is
invalid.

Two rules carry most of the weight. **A number has one hash, ever** — a withdrawn number may come
back only at the identical bytes, which is how an owner undoes a thief who withdrew everything she
wrote. And **`top` never decreases**, even when the post holding that number is withdrawn, because
§7.5's rumor rule treats a reply naming a number above the top as worth looking into; a `top` that
fell would turn every reply to a deliberately deleted post into an accusation of withholding.

`entries` comes first in the body. That is the protocol's one member-order rule, and it is not
canonicalization: appending a line leaves every earlier byte where it was, so a reader that cached
the file can fetch only the tail.

**A media file is the one unsigned file.** What admits it is being listed in the index; what checks
it is its hash (§4.4). Listing media in the index rather than leaving it to the posts that reference
it means retention is one rule that still works on encrypted posts, whose references the hub cannot
read. Media attached to an encrypted post is itself encrypted under a fresh key, and the listed hash
is the hash of the ciphertext.

**Withdrawing** appends a line; **rewriting** writes the file out again from the fold and drops the
lines the withdrawal left behind. Readers are indifferent to when that happens. Rewriting is a
privacy decision and never a size one — measured on a year of a family feed with one post in twenty
withdrawn, the leftover lines are 5.5% of the file. What it buys is that the withdrawal stops being
visible to later readers. What it does not buy is anything back from someone who already looked, or
from an operator who kept every version he served.

### Posts

```json
{"n":7,"at":"2026-08-01T09:00:00Z","text":"the divorce is final",
 "rel":"reply",
 "target":{"key":"<anchor>","n":3,"hash":"<hash>","loc":"https://mom.example/mom"},
 "media":["<media hash>"]}
```

That is §5's own example; Appendix B.7 is a real one, with real keys, all 43 characters of the
target's address, and its signature line. A post declares the number it is published at **inside
its signed bytes**
(§5.1), which is what makes post 2 not be post 6 at any hash — and what lets a hub tell a replayed
file from the owner's own post at that number. `at` is content time and is **never a verdict**:
§13.2 lists every place a clock appears in the whole protocol, and not one of them gates anything,
because a party who runs the server also sets its clock.

`rel` is `reply`, `root`, `like`, `repost`, `quote`, `mention`, `supersedes`, or an absolute URL. An
edit is a new post that withdraws the old one. A `target` names the author's **anchor key**, never a
URL, and all 43 characters of the target's address — and a reader treats a reply whose target hash
is not what that author's index lists as a reply to something else, which is what stops an author
showing two audiences two different "post 12" and having both threads look right.

A private message is a post encrypted to one person, living on the sender's own hub. There is no
inbox, no dead-drop, and no push. Two costs come with that and the spec states both: the hub learns
the *shape* of the correspondence even though it cannot read a word, and **a signed private message
is provable by its recipient forever**.

### Encrypted content

Three visibilities, one mechanism (§6): public; encrypted to a chosen set of reading keys; and a
direct message, which is that set with one member. An encrypted post is an ordinary post whose
content sits in an `encrypted` member, and **nothing about signing changes** — it is signed,
addressed, listed and verified exactly like any other post, and a reader that cannot open it returns
it with the field opaque.

One X25519 ephemeral per message. For each recipient, `HKDF-SHA256` over the shared secret yields a
tag, a key-wrapping key and a nonce, and the content key is wrapped into that recipient's slot. The
content is encrypted once with ChaCha20-Poly1305 under a fresh 32-byte key and an all-zero nonce —
safe for exactly the reason it is safe in HPKE, because the key is used once.

Three properties are worth naming:

- **The carrier is bound as associated data.** The content's AAD is `epk || <author anchor>:<n>`, so
  an envelope lifted out of one post and dropped into another does not open at all. Binding it,
  rather than comparing fields afterwards, means there is no "forgot to compare" (§6.2).
- **A tag is a hint, never a decision.** Tags are derived through the message's own ephemeral, so an
  observer holding every published reading key derives none of them, and one recipient's tags do not
  link across posts. An implementation that ignores tags and tries every slot is conformant and
  merely slower (§6.3).
- **The audience is inside the ciphertext**, and each entry names a person — anchor key, reading
  key, and location — not just a key. Without that, a recipient cannot find a profile for the other
  members, so a reply reaches only the people it already knew and the thread splits in half with no
  error anywhere (§6.5).

Slots and body are padded to power-of-two buckets, with a suggested floor of 8 slots and 512 bytes,
so that a message to one person is the same size as a message to the family (§6.4). Measured, the
floor costs 498 bytes on a direct message. It has a horizon: because §6.5's audience list is itself
content, the 512-byte body floor stops covering the difference somewhere around three or four
recipients — a direct message is 1,574 bytes and a six-recipient post is 2,257.

`rel`, `target` and `media` go inside the envelope on an encrypted post. The public file carries
`n`, `at`, and `encrypted`, and nothing about what it answers.

### The reader

A reader is given three things: the anchor key it learned, a location, and optionally the pin it
kept from last time. §7's eleven steps run in an order the spec makes normative, because each step
supplies what the next one checks — profile, then chain, then recovery lists, then the file's
signature, then the pin; then the index and its fold; then every live entry; then targets.

It returns exactly one of **three verdicts**, and a conforming reader does not invent a fourth:

| verdict | means |
| --- | --- |
| **ok** | everything checked out |
| **this host is misbehaving** | the files served do not hang together, and withholding, swapping, or rolling back is what would do it |
| **this identity is in question** | who this is cannot be settled from here |

`recently restored`, `withdrawn: n` and `no index I can verify` are **notes on an ok read**, not
states. Every one of them is produced by an honest identity doing an honest thing — coming back from
a lost phone, taking a post down, rotating a key between the two writes that takes. A state that
fires on those is a state that fires mostly on nothing being wrong, and users learn to click past
it. The count is a UI budget, not a correctness budget: the reader distinguishes a dozen conditions
internally and *reports* three.

A **pin** is the reader's own state and never a wire object: the profile and its hash, the chain,
the recovery list at every chain length it reaches, the index, the live set, the withdrawn hashes,
`top`. Every rewriting attack the adversary can mount is against what a reader has not yet seen.

Step 11 is the **rumor rule** (§7.5). A reply naming a number above the top of the index a reader
holds is worth looking into once; what gets said is *"X replied to something I cannot see,"* naming
the replier, because that is the only party the reader has evidence about. Two bounds are required
and a reader without both is a weapon: **look again at most once per identity per pass**, and **say
one line per person**. The measurement is in `examples/top-and-rumors/` — a thousand replies naming
numbers that were never issued cost one look-again, 4 fetches and 1 line; the naive per-reply rule
costs 4,000 fetches and 1,000 lines, aimed at somebody else's hub.

### Publishing, and fetching

Four paths, two verbs, one conditional header (§8). **There is no account, no token, and no session:
the request is the signed file.**

```
PUT /<name>/profile        If-Match: <etag>   -> 200 | 412
PUT /<name>/index          If-Match: <etag>   -> 200 | 412
PUT /<name>/posts/<n>                         -> 201 | 200 (reclaimed) | 409
PUT /<name>/media/<hash>                      -> 201 | 200 (replaced)  | 409
GET any of the above                          -> 200 | 404
```

The profile and the index are overwritten, so they carry compare-and-swap on an opaque entity tag.
The rule that matters is what a writer does when it *loses* the race: re-read what the hub is now
serving and fold your own line into that, never re-send your own version — the naive retry silently
drops the other device's post, and the loss reads to every reader as an ordinary withdrawal.

Numbered posts are created once, and numbering need not be gapless: a crash between the post write
and the index write burns a number, and a number nobody lists is nothing. A device that comes back
abandons a number it cannot prove it listed, because listing one late is indistinguishable to a
reader from a host backdating a post into someone's history. Posts are written before the index that
lists them. A squatted number can be reclaimed by the owner and by nobody else, and the rule does
not turn around.

Whatever else a hub does — a pass, an account, a rate limit, a bill — it can never write as you,
because it cannot make your signature. The worst it can do is refuse you or delete things.

§9 binds a reader's outbound requests, and none of it is optional politeness: the rumor rule follows
a URL that a *replier* chose, so a reader's fetch layer sits in front of attacker-supplied addresses
by design. HTTPS only, certificates validated. At most five redirects and never to a different
origin, because a `Location` header is not identity equivalence. Non-public addresses refused —
checked on the **resolved** address before the socket connects, with every embedded-IPv4 form judged
as the IPv4 address it carries, and an ambiguous dotted quad like `0177.0.0.1` refused rather than
guessed at. Everything bounded: one deadline over connect, redirects and body read together, a body
cap, a socket cap, and a cap on identities per pass.

A reader that hits a cap, or a timeout, or a name that does not resolve, has **no verdict** — not a
fourth one, the absence of one. An app shows "could not check", never a state of the identity.

### Your copy

**An app keeps the signed bytes of everything it publishes** (§10). Not the text, not a database
row — the bytes, with the signature line on the end. One rule, three consequences:

- Those bytes verify with no host in reach. There is no export format and no bundle to define,
  because the file on the wire already *is* the archive format.
- Anyone you published to is a backup nobody set up on purpose. It covers only what they could see
  and proves nothing about completeness — a fallback, not a guarantee.
- Your own last index is the table of contents, so an app rebuilding after a lost phone knows
  exactly what is missing and can ask a named person for a named list.

Leaving is therefore writing the same files somewhere else. Exactly one file is re-signed, and only
to name the new location.

### Generated views

A publisher also writes a JSON Feed 1.1 document, an Atom feed and an h-card page, generated from
the index and the posts (§11). They are how this protocol reaches readers that have never heard of
it — a feed reader written in 2005 subscribes to a journal here with no Open Feed code in it.

**Nothing in a view is signed, and a view is never the index.** A view is something a host can
regenerate; an index is something only the author's key can produce. Item ids are
`urn:openfeed:<anchor key>:<n>` rather than URLs, so a relocation does not make every post reappear
as unread. Withdrawn posts are absent, encrypted posts are omitted, and no view carries ciphertext.

---

## A reading path

The twenty examples in [`examples/`](examples/) are how to actually learn this. Each is a short
program that prints its working and asserts every claim it makes, a document that explains the
concept and contrasts it with how other protocols do the same job, and its committed output.
`npm run examples` re-runs all of them and diffs. They are in spec order, and reading them in order
is reading the protocol; the full table with spec sections is in
[`examples/README.md`](examples/README.md).

**Files (§2)** — [`signed-file`](examples/signed-file/) (body, newline, signature; the address is
the hash of the body) · [`no-canonicalization`](examples/no-canonicalization/) (pretty-printing,
sorting or a trailing newline reads as forged) · [`json-hygiene`](examples/json-hygiene/) (the four
ways `JSON.parse` lets two readers disagree)

**Identity (§3)** — [`first-contact`](examples/first-contact/) (the link fragment and the six-word
code) · [`the-chain`](examples/the-chain/) (rotating, restoring, vouchers added later) ·
[`recovery-list`](examples/recovery-list/) (salted leaves: a voucher reveals only itself) ·
[`contest`](examples/contest/) (the split, and majority over `k`, with the abuser on the list) ·
[`moving`](examples/moving/) (locations, and relocation riding along in a reply)

**The index (§4)** — [`the-index`](examples/the-index/) (entries, the fold, one hash per number) ·
[`top-and-rumors`](examples/top-and-rumors/) (why `top` outlives its post; both bounds of the rumor
rule) · [`media`](examples/media/) (listed by the index, checked by the hash) ·
[`rewrite`](examples/rewrite/) (withdrawal lines vanish and readers are indifferent)

**Posts (§5)** — [`posts-and-targets`](examples/posts-and-targets/) (the number inside the bytes;
the full target hash)

**Encrypted content (§6)** — [`envelope`](examples/envelope/) (slots, blinded tags, and the carrier
bound as associated data) · [`padding`](examples/padding/) (a message to one person is the size of a
message to the family)

**The reader (§7)** — [`the-reader`](examples/the-reader/) (the order of steps; three verdicts and
the notes on an ok read)

**Publishing and everything after (§8–§11)** — [`publish-interface`](examples/publish-interface/)
(compare-and-swap, create-once, reclaim) · [`fetching`](examples/fetching/) (non-public addresses,
redirects, and caps that are no verdict) · [`your-copy`](examples/your-copy/) (rebuilding from the
bytes and your own last index) · [`views`](examples/views/) (JSON Feed, Atom and an h-card generated
from the index)

**Then the two capstones.** [`weekend-reader`](examples/weekend-reader/) is a whole conforming
reader in one file — 170 non-blank, non-comment lines, standard library only, written from the
protocol's text alone. [`weekend-publisher`](examples/weekend-publisher/) is the publisher, at 51.
They are not illustrations: the reader is the **second implementation** that `tools/regen.js`
verifies Appendix B with, and the publisher is what signs those vectors. Three rules in the spec
exist because writing them found the text did not say them — that the index has to be re-signed
after a key change, that an index a reader cannot verify is not an accusation, and that the rumor
rule needs both of its bounds.

---

## What this is not, and what it does not defend

A README that only sells is worse than useless for a protocol whose value proposition is honesty
about limits. §13.3 is the spec's own list; this is it in short.

**Not pursued at all** (§1): human-readable wire bytes, because nobody reads them; continuity for
strangers across key loss, because they are strangers by definition; millions of items per identity.
The design scales *across* identities — many people on a few large hubs is the case that has to
work.

**Not defended:**

- **Staleness is indistinguishable from silence.** A reader cannot tell a host that stopped serving
  updates from an author who went quiet. A hostile host can freeze every pinned reader where it
  stands.
- **A frozen copy reads as stale only to a reader with a social path.** After she leaves, the ex can
  serve her last honest profile forever. A reader that has learned her new address reads it as an
  older profile; a reader with none sees an unmarked page and has no way to know.
- **A cold reader's recovery list is whatever its first profile carried.** A reader that first meets
  an identity on a thief's branch will reject the real one when it appears.
- **The shape of a correspondence is visible even when its contents are not** — how many encrypted
  posts, when, roughly how big, fetched by which address. The padding floor hides one distinction;
  nothing hides the rest.
- **A signed private message is provable by its recipient forever.** The same per-post signature
  that stops the ex from posting as his wife makes anything she sends provable by whoever received
  it. There is no version of "signed per post" that gives the first without the second.
- **There is no forward secrecy.** A reading key that leaks opens every encrypted post ever
  addressed to it, and changing the key re-encrypts nothing.
- **A recovery list with one other person on it is that person's identity**, at that chain length,
  for every reader that saw the list.
- **First contact after a hijack is unprotectable**, by definition. §3.1 exists to make sure the key
  came from somewhere else.
- **Withdrawal erases nothing.** There is no DELETE verb, no deletion record, and no rule that
  reaches into a copy someone else holds. An app is forbidden from telling a user otherwise.
- **No confidentiality from an audience member**, including a hub operator who is one. The answer to
  him is exit, not secrecy, and implementations are forbidden from marketing it as anything else.

There is also no moderation policy, no discovery mechanism beyond sharing a link, no directory, no
transparency log, no auditors, and no gossip between readers. An index is comparable only against
what *this* reader saw itself, so a rollback shown to a brand-new reader is invisible to it.

---

## Compared with other protocols

Every comparison this project has made lives beside a runnable example, in that example's Contrast
section, argued against code rather than from memory. This table is the index into them, not a
summary of them.

| against | where the argument is |
| --- | --- |
| **JOSE / JWS / RFC 8785 (JCS)** — signing a re-serialization, and the gap it opens | [`signed-file`](examples/signed-file/), [`no-canonicalization`](examples/no-canonicalization/) |
| **RFC 7493 (I-JSON)** — the same four rules, enforced in a parser rather than a profile | [`json-hygiene`](examples/json-hygiene/) |
| **Signal** — safety numbers, key-change notifications, sealed sender, deniability, disappearing messages | [`first-contact`](examples/first-contact/), [`contest`](examples/contest/), [`the-reader`](examples/the-reader/), [`posts-and-targets`](examples/posts-and-targets/), [`rewrite`](examples/rewrite/) |
| **PGP, X.509, Matrix cross-signing** — chains that run outward, revocation that has to be delivered | [`the-chain`](examples/the-chain/), [`first-contact`](examples/first-contact/), [`the-reader`](examples/the-reader/) |
| **Key transparency, CONIKS, ledger-anchored DIDs** — right shape, wrong threat model: the plausible log operator is the hub | [`contest`](examples/contest/), [`the-index`](examples/the-index/) |
| **Shamir sharing, guardian smart accounts** — recovery that reassembles a secret, versus vouching that reassembles nothing | [`recovery-list`](examples/recovery-list/) |
| **Nostr** — the closest living premise; key loss, relay partiality, `e` tags, replaceable events by timestamp | [`the-chain`](examples/the-chain/), [`the-index`](examples/the-index/), [`posts-and-targets`](examples/posts-and-targets/), [`envelope`](examples/envelope/) |
| **ActivityPub / Mastodon** — a vocabulary versus one object; inbox delivery; `Move`; `Delete`; media caching | [`posts-and-targets`](examples/posts-and-targets/), [`top-and-rumors`](examples/top-and-rumors/), [`moving`](examples/moving/), [`rewrite`](examples/rewrite/), [`media`](examples/media/), [`views`](examples/views/) |
| **Bluesky / AT Protocol** — DIDs and a resolution layer; a signed repo and its CAR export | [`moving`](examples/moving/), [`your-copy`](examples/your-copy/) |
| **IPFS and git** — content addressing, borrowed without the network or the machinery; history rewriting | [`media`](examples/media/), [`rewrite`](examples/rewrite/) |
| **HPKE (RFC 9180), NIP-44, MLS** — what §6 takes from each, and what it is not | [`envelope`](examples/envelope/) |
| **Tor, TLS 1.3 record padding, CRIME/BREACH** — length is content | [`padding`](examples/padding/) |
| **SSRF, DNS rebinding, Pingback amplification** — the rumor rule fetches an address a stranger wrote | [`fetching`](examples/fetching/) |
| **Micropub, the Mastodon API, `com.atproto.repo.*`** — a token proves you asked; a signature proves you meant it | [`publish-interface`](examples/publish-interface/), [`weekend-publisher`](examples/weekend-publisher/) |
| **RSS, Atom, JSON Feed, IndieWeb** — a feed cannot say what is missing; the view is output, never input | [`the-index`](examples/the-index/), [`views`](examples/views/) |
| **GDPR portability, Mastodon's account archive, platform data downloads** — every one of them a favour with a form attached | [`your-copy`](examples/your-copy/) |

The design that this repository itself replaced — JOSE with `b64:false`, RFC 8785 canonicalization,
JSON Feed items carrying an `_openfeed` object, delegated keys, identity as a URL — is in
[`archive/`](archive/), verbatim, with the rulings and reviews that retired it.
[`archive/README.md`](archive/README.md) is the index; consult it before re-litigating a design
choice, because most near-misses are already priced there.

---

## Status

**0.1.0 — draft, unreleased.** Nothing here has had a reader outside this repository. The spec is
checked against running code, and its vectors are verified by two independent readers
(`src/reader.js` and the weekend reader), which is the closest thing to somebody else's reading it
has had.

[`FINDINGS.md`](FINDINGS.md) is the defect list, and **nothing in it is fixed** beyond a handful of
cosmetic items. Two entries are security defects in the mechanism the whole design turns on, and
both want a ruling before the spec is rewritten:

1. **`k` is trusted in two places where a majority is meant.** §3.3 makes a restore link valid at
   `k` vouchers while §3.6 settles a contest by majority, so a `k` below a majority is a second,
   weaker door into the same room — and a `k` of zero admits an unsigned, unvouched link to a pinned
   reader. Read the majority rule above as what happens *at a contest*, not as a floor on every
   restore.
2. **§2.4's JSON rules do not reach inside the envelope.** The decrypted plaintext is parsed
   leniently, and it is where the audience, the target and the media keys live.

`FINDINGS.md` also records four places the spec's own numbers were wrong, which is why every number
in this document was re-derived rather than copied.

Pre-1.0, breaking changes are allowed to fix correctness or security defects. Post-1.0 the intent is
additive only. The version number marks a release someone outside this repository can depend on, not
an edit counter.

---

## Running it

`src/` is the reference implementation: zero dependencies, one module per spec chapter, about 1,300
lines including the strict JSON parser and the BIP-39 wordlist. `src/fetch.js` is the only module
that opens a socket.

```sh
npm test         # 54 tests: one file per module, plus GOALS.md's seven scenarios end to end
npm run vectors  # verify Appendix B with both readers — 49 checks (--write regenerates it)
npm run examples # run all 22 examples and diff against their committed output
npm run revert   # the mutation table: every rule an example proves, and the edit that turns it red
npm run check    # tests + vectors + examples + seeds; run this before every commit
```

`npm run revert` rewrites files in place while it runs, so nothing should be edited while it is in
flight.

---

## License

[Apache License 2.0](LICENSE). The specification and the reference implementation are under the same
terms — a permissive license with an explicit patent grant, chosen so that implementing this
protocol carries no legal question for anyone, commercial or otherwise.
