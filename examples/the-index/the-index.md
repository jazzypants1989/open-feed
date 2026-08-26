# The index

§4 of the spec: entries and the fold, `top`, media, who signs the index, rewriting. One script; the prose below is the former the-index, media and rewrite examples.

---

## The index

**Spec:** §4 the index, §4.1 what the entries mean, §4.2 the fold, §4.6 signed by the current key.
Vectors: Appendix B.9–B.11.
**Run:** `node examples/the-index/the-index.js`

The index is the answer to *what exists now*. It is one signed file at `/<name>/index`, and with the
profile it is one of the only two files a publisher is allowed to overwrite (§8.1) — every numbered
post is written once and never again. Its body has three members: `entries`, the lines in order;
`version`, which never goes backwards; and `top`, the highest post number ever issued.

Nothing in it is a diff and nothing is a patch. A reader recomputes the whole live set from line one
every time, by **folding** the entries in order (§4.2), so a reader that joined at `version` 1 and a
reader that joined at `version` 6 hold the same answer about today. The value of having such a file
at all is completeness: because the author signed a statement of what exists, a host cannot quietly
drop a post and have the absence look like nothing.

### What the output shows

**One signed file that says what exists now.** The example prints Appendix B.9 — three posts live,
`version` 1, `top` 3 — and names the three members. It is an ordinary signed file (§2.1): body,
newline, signature, and the address is the hash of the body, exactly as `signed-file/` showed.

**Four line shapes, and nothing else.** `[n, hash]` says post `n` exists at that address;
`[n, null]` withdraws it; `[hash]` says a media file with that address exists; `[hash, null]`
withdraws it. That is the whole grammar. Appendix B.10 carries the first three: post 2 withdrawn by
an appended line, post 5 encrypted, and one media file listed by its address alone. Media has its
own example (`media/`, §4.4); what matters here is that it is admitted by *being listed*, and
checked by its hash, so retention is one rule that reaches **encrypted** posts too.

**The live set is the fold of the entries, in order.** The example folds B.10's seven lines one at a
time and prints the live set after each: post 2 appears, then leaves when `[2, null]` is reached,
and the media file joins at the end. The fourth line shape, `[<media hash>, null]`, takes the media
file back out again.

**An index that does not fold is invalid, and the verdict is `host`.** Five malformed entry lists
are shown being refused — a number listed twice, a withdrawal of something that is not live, a
number below 1, a media file listed twice, a media withdrawal of nothing — and then one of them is
served to a reader, which reports `host: the index does not fold`. The spec is honest about this
label and so is the narration: the index **verified**, so it came from the author's own key, not
from a misbehaving hub. It is reported as `host` anyway because a fourth reader state was not worth
the complexity (§7.3 allows exactly three), and an app SHOULD word it as *the files at this address
do not make sense* rather than as an accusation against the operator. The same block shows `top`'s
floor — it MUST be at or above the highest number anywhere in `entries` — and that a feed which has
issued nothing has `top` 0. *Why* `top` outlives the post holding it is §4.3 and belongs to
`top-and-rumors/`.

**A number has one hash, ever.** Within one index the fold enforces it: a withdrawn number may come
back at the identical hash (Appendix B.11 does exactly that) and at no other. Across a rewrite the
fold cannot see it — once the `[2, null]` line has been swept away, that index has never heard of
post 2 — and the example runs one reader through four versions to show the half that is the pinned
reader's memory (§7.2). Why the identical-hash repeat is allowed, and why the cross-version rule is
the way back from a thief, is `rewrite/`'s argument; this example only shows both halves firing.

(`recently restored` appears in those notes because this identity's chain ends in a restore. It is
§3.5's note, not §4's business; see `the-chain/`.)

**`entries` MUST come first.** This is the protocol's one member-order requirement, and the example
measures what it buys: 161 of `version` 1's 183 body bytes are the opening prefix of `version` 2's
340, byte for byte, because appending a line leaves every earlier byte where it was. A reader that
cached `version` 1 MAY therefore fetch only the tail — a range request conditioned on the entity tag
it holds (`If-Range`). Put `entries` last instead and the counter-example is stark: `version` 9
becoming 10 moves every entry byte, and the shared prefix collapses to 11 bytes. It is **not** a
canonicalization rule (`no-canonicalization/`): nobody re-serializes anything, and a verifier that
has never heard of the rule still checks the signature correctly.

**Signed by the key the chain currently ends on.** Not by any key in the chain — by the current one
(§4.6). The example gives Alice a chain of anchor → rotated → restored, and shows an index signed by
the middle key failing to verify. The reason is staged rather than asserted: the index is what
admits posts, so if a reader accepted an index from any chain key, a thief holding a rotated-out key
would go on deciding what counts as hers, and a restore would take nothing back. **Re-signing the
index is what a restore actually restores.**

The honest consequence is printed too. Between the two writes a rotation takes, a truthful host is
serving an index signed by a key the profile no longer ends on — so §7.2 says an unverifiable index
is not an accusation. A reader with no pin reports `host`; a reader holding an index it verified
itself keeps that one, notes `no index I can verify`, and says nothing further.

### Contrast

**A feed that is its items cannot say what is missing.** In RSS, Atom and JSON Feed the document
*is* the entries, and a truncated document is indistinguishable from a short one: a host that drops
your last three posts serves a feed that looks exactly like a feed with three fewer posts. RSS and
JSON Feed have no place to state "and these are all of them"; Atom has one (RFC 5005's
`fh:complete`) and an optional XML signature to put over it (RFC 4287 §5.1), and almost nobody uses
either. None of the three can say a post *was* here and was withdrawn.
Open Feed's index is a signed, versioned claim about the whole set, and the host cannot sign one. So
withholding a post the index lists reads as `host: post n is listed and not served`; serving an
older index is caught by `version` going backwards; and a number that comes back as different bytes
is caught by the pin (§7.2). What a reader is told when a post simply stops being listed is
`withdrawn: n` — it cannot tell a deletion from a change of mind, and does not try to. That is
`GOALS.md` floor item 1 and scenario 1's *he cannot alter or backdate what she wrote*: the mechanism
is not that the host is trusted, but that its options are all visible to a reader that was here
before.

**Nostr relays make the same trade in the other direction.** An absent event is unremarkable: relays
are expected to be partial, and there is no per-author statement of completeness to compare against.
That buys enormous flexibility in how events are spread around and gives up the ability to say a
relay withheld something. Open Feed pays one extra signed file per identity and gets the claim.

**A transparency log buys much more and costs much more.** Certificate Transparency and Merkle-log
designs generally publish a signed tree head plus inclusion and consistency proofs, so that a third
party — an auditor or monitor who was never a reader — can prove the log operator equivocated or
rolled back. Open Feed has no proofs, no auditors, and no gossip between readers. Its index is
comparable only against what *this* reader saw itself (its pin, §7.2), so a rollback shown to a
brand-new reader is invisible to that reader. The design says so rather than dressing it up: the
adversary is a family hub operator, the defence is exit (§10, §13.1) and verification he cannot
forge (§7), and hash-chained proofs would have added an appendix of machinery to catch a case the
threat model does not need caught.

**The cost is bounded and flat.** One extra file per identity, rewritten at the publisher's chosen
cadence (§4.7); what the leftover withdrawal lines weigh is measured in `rewrite/`. Nothing about the
index scales with the number of readers or the number of identities a hub carries, which is what
`GOALS.md` scenario 5 — ten thousand people on one commercial hub, per-identity cost flat — asks of
it. The member-order rule and the range request are a small part of the same instinct: they let a
returning reader ask for a few hundred bytes instead of the whole file, and they buy nothing else.

---

## Media

**Spec:** §4.4 media and attachments, §5.5 `media` on a post, §6.5 the key inside the envelope,
Appendix A media types.
**Run:** `node examples/media/media.js`

A media file is the one unsigned file in the protocol. Everything else on the wire is a body, a
newline and an Ed25519 signature (§2.1); a photograph is just its bytes, living at
`/<name>/media/<hash>` where `<hash>` is the base64url SHA-256 of those bytes. **What admits it is
being listed in the index; what checks it is its hash.** Those are two different questions and the
example keeps them apart, because most of what is interesting about §4.4 falls out of the split.

The second half of the section is retention. Media is listed in the index rather than left to the
posts that reference it, so that "what should the hub keep?" is one rule — a rule that still works
when the hub cannot read the post, which is the case for every encrypted post on it.

### What the output shows

**A media file is the one unsigned file.** The example uses Appendix B.10's photograph: 26 bytes
hashing to `fKGh1GT8MtRZogFKb3upiE9A63CETyE-sjhJwE5HK5g`. Handed to the file verifier it comes back
`null` — there is no body, no separator and no signature to check. There is nothing for a signature
to add, either: the hash is already inside an index the author signed, so the blob is bound to the
identity by the index and named by its own content. A second signature would buy nothing and add a
second format.

**What admits it is being listed; what checks it is its hash.** With `["<hash>"]` in the index and
the right bytes served, the read is `ok` and the reader hands back the 26 bytes. Swap the bytes at
that address and the verdict is **this host is misbehaving** (§7.3) — *media file … is not what the
index lists*. Withhold them and it is the same verdict — *listed and not served*. A reader MUST
verify that the bytes it fetched hash to the name it fetched them under, and that one check is the
whole verifier for this kind of file.

**A media file the index does not list is simply not there.** Post 6 names a hash in its `media`
array, and the hub is serving exactly those bytes at exactly that path — and the reader still comes
back `ok`, with post 6 present and no media. The post is not broken by it and nothing is said about
it. Being served is not being there; being listed is. This is what makes the index the only thing a
reader has to reason about: a hub can hold any blobs it likes, and none of them is part of the feed
until a signed index says so.

**Listed in the index, so retention is one rule that reaches encrypted posts.** Post 7 is encrypted.
The file the hub serves has three members — `n`, `at`, `encrypted` — and no `media` at all, because
on an encrypted post the reference lives inside the envelope (§5.5, §6.5). The host cannot read it,
so it cannot work out which blobs the post needs. The index line `["CpQDyIo_…"]` tells it anyway:
keep this one. That is the whole argument. If media were only ever named by the posts that reference
them, a hub's retention rule would be "parse every post and collect its references", which is a rule
that stops working on exactly the posts the protocol most wants to protect.

**Encrypted media: the listed hash is the hash of the ciphertext.** The publisher draws a random
32-byte key and computes `ChaCha20-Poly1305(key, nonce = 12 zero bytes, plaintext = the media bytes,
aad = "")`, then **lists and serves the ciphertext**. So the address in the index is the SHA-256 of
the ciphertext, not of the photograph — the example prints both so the difference is visible. The
key travels as `{"hash": <listed hash>, "key": <key, base64url>}` in the envelope's `media`. The
round trip is the last line: mum opens the envelope with her reading key, takes the hash and the
key out of it, fetches the blob, checks the hash, decrypts, and holds the original 26 bytes. The
reader never sees any of that — §7.4 verifies the ciphertext against the listed hash and stops
there; opening the envelope is the client's business.

**The key MUST NOT be reused for a second media file.** The nonce is fixed at twelve zero bytes, so
a key is a keystream and reusing it encrypts a second file under the same one. The example encrypts
a second photograph under the same key and prints the XOR of the two ciphertexts beside the XOR of
the two photographs: they are the same bytes. Anyone holding both blobs — the hub, for a start —
recovers the difference between two photographs without ever holding the key. Authenticity goes with
it: the Poly1305 one-time key is derived from the key and nonce, so repeating the pair lets an
attacker who sees two valid tags forge further ones. A fixed nonce is safe only under the discipline
that makes it fixed, which is one fresh key per media file.

**What the hub learns.** The three blobs and their sizes, and nothing else. Not which post an
encrypted one belongs to, and not whether two of them are the same photograph encrypted twice. It
does of course learn who fetched what and when, as it does for every file it serves (§5.6, §13.1);
what it does not learn is anything from the bytes. Appendix A gives media no media type of its own —
"whatever the bytes are" — and nothing the protocol checks reads that header, because the hash
covers the bytes and the header is not among them. A hub is free to serve the right `Content-Type`
and a reader is free to use it for display; nothing verifies on it.

### Contrast

**Content addressing without the network.** Naming a file by the hash of its bytes is the oldest
idea here: git names a blob by the hash of its content (with a short header), and IPFS names one by
a CID that wraps a multihash. Open Feed borrows the idea and none of the machinery. There is no DHT,
no gateway, no content-routing layer, and no third party who might have a copy: the blob lives at
your hub, at a path under your own name, and nowhere else. What content addressing buys here is
narrow and specific — the hub cannot swap a photograph without the reader noticing, and it buys that
without a signature, a key, or a second file format.

**Why the media file is not signed, when everything else is.** The signature on the index already
covers the hash, and the hash already covers the bytes, so the chain from anchor key to photograph
is complete without touching the blob. Signing it as well would mean a second file format — a
signature line stapled to arbitrary binary, or a sidecar file, or a wrapper — and §2's whole point
is that there is one format. The cost of the choice is that a media file taken out of the feed
proves nothing on its own; you need the index line beside it. That seems right for what media is.

**Attachments elsewhere.** In ActivityPub an object carries an `attachment` array holding URLs, and
what happens to the bytes is up to whoever is serving them; Mastodon instances cache remote media
and prune the cache on their own schedule, so a post can outlive its picture in one direction or the
picture outlive the post in the other. Nothing in the object says how long the bytes should live,
because the object is not the place that decision is made. Open Feed puts that decision in the one
signed file the author controls: an index line is the author saying *this blob is part of my feed*,
and its absence is the author saying it is not.

**Media repositories.** Matrix keeps media in a per-homeserver repository addressed by `mxc://`
URIs, and — this is the near-neighbour of §4.4 — in an encrypted room the file is encrypted
client-side and the event carries the key alongside a SHA-256 **of the ciphertext** — recognisably
the same shape as `{"hash", "key"}` in the envelope, with a different cipher under it. The
differences are in the surroundings rather than in the idea: Matrix's URI is a server-scoped
identifier rather than the hash itself, and retention is the homeserver's policy. MMS is the other
extreme — the bytes are carried inside the message through a carrier's store-and-forward server and
expire on the carrier's schedule (the sender may ask for an expiry and the carrier may cap it), and
the part has no name that outlives the message.

**The scenarios.** Scenario 1, the divorce: the family photographs attached to her family-only posts
sit on his hub as ciphertext at a hash of that ciphertext, and what he learns is that a blob of some
size exists. Scenario 5, the big lazy hub: ten thousand people on one commercial hub, and the
operator's retention job is to read one signed line per file — no parsing of posts, no decryption it
cannot do anyway, and a cost that stays flat per identity.

---

## Rewriting

**Spec:** §4.7 rewriting, over §4.2 the fold and §7.2 a pinned reader across versions; §8.8 and
§13.1 for what withdrawal is not.
**Run:** `node examples/rewrite/rewrite.js`

Withdrawing a post is an appended line: `[n, null]`. The line that listed the post stays exactly
where it was, because appending is the only edit that leaves every earlier byte alone — which is
what lets a reader fetch the tail of an index it already holds (§4). So a withdrawal costs two
lines, and both of them are about a post nobody can read: the number that went, and the hash it
had. Rewriting is the author writing the whole file out again from the fold — the live set, in
order, and nothing else. Version `version` goes up by one and the lines are gone.

The reason to do it is privacy, and the honest version of that claim is smaller than it sounds.
Open Feed is a protocol in which readers keep what they fetched: that is not a leak, it is the
whole of §10 and the reason leaving a hub costs nothing. **The publisher forgets; readers
remember.** There is no permanent deletion record, no retained-version history, and no way to reach
into a copy someone else holds — and no verb that would let an author try. A rewrite changes what
the *next* person to fetch the index can see. It says nothing at all about the people who already
fetched it, and nothing at all about the host operator, who fetched every version by definition
(§13.1). Pretending otherwise would be the dishonest design, so §8.8 states the limit as a MUST
NOT: an app **MUST NOT** tell a user that withdrawing erased anything.

### What the output shows

**A withdrawal is an appended line, and a rewrite is what takes it away.** The example prints the
entries of Appendix B.10 and then of B.11 — the spec's own before and after, asserted byte for byte
including the signature line. Two of version 2's seven lines are about post 2, which is not there
any more: the listing and the withdrawal. Version 3 has neither. This is the one place the protocol
overwrites history rather than appending to it, and it is safe for exactly one reason, which the
next block is.

**The rewrite changes the file and never the live set.** Fold version 2's entries and fold the
lines a rewrite keeps: the same posts, the same media file, the same `top`. A rewrite is a
re-spelling of the answer the fold already gives, so no reader can tell the difference except by
looking at the byte count. `top` in particular does not move, because it is the highest number ever
issued and not the highest number listed (§4.3) — a rewrite that recomputed it from the live
entries would silently turn every reply to a withdrawn newest post into a rumor (§7.5).

**A reader that last saw version 1 returns at version 6.** This is the strongest form of "readers
are indifferent": in between are two rewrites and three appends, four of the six versions this
reader never fetched and never will. It reads `ok`. It is told `withdrawn: 3` — the one thing it is
owed, because post 3 is a post it held and no longer has — and that is a **note on an ok read**,
never a verdict (§7.3). Its pin quietly keeps the hash post 3 had, which is what makes the next
block possible.

**A number that comes back.** Appendix B.11 re-lists post 2 at the hash it had. That is legal, and
it is the *only* legal repeat: §4.2 allows a withdrawn number back at the identical hash and
nothing else. The example shows the pinned reader accepting it and then shows the illegal twin —
the same number back at a different hash — coming back as **host**, because the pin remembered.
The rule exists for the restore: a thief who held the current key and withdrew everything is
undone by the owner re-listing her own posts at their own hashes, and that has to work whether or
not he happened to rewrite first. The fold's half of the same rule — one hash per number *inside* a
single index — belongs to `the-index/`.

**Six per cent, measured.** The example builds a year of a family feed — 150 posts, one in twenty
withdrawn some weeks after it was published — and measures the lines a rewrite would drop as a
fraction of the signed file. It comes to **5.5%**, which is what the spec means by "about 6%".
Half a kilobyte off an eight-kilobyte file. Nobody should schedule a rewrite to save that, and a
publisher who reasons about it as a size problem has already misread it; the reason to rewrite is
that the withdrawn line stops being public.

**What it buys, and what it does not.** After the rewrite the index carries no line about post 3 at
all, and a reader arriving now sees a feed in which it never existed. Three things do not change.
Post 3's bytes are still served at `/posts/3` and still verify — there is no DELETE verb, an author
cannot overwrite her own post, and the fold refuses a withdrawal of something that was never listed
(§8.8). An honest hub **MAY** remove a file the current index does not list, which is how it can
honour a deletion request, and it is a MAY because no reader depends on it either way. And an
operator who kept every version he ever served still holds version 4, which contains `[3,null]` —
the line, the hash, and the hour he served it. That is `GOALS.md` scenario 1, the divorce, and
scenario 5, the same operator at commercial scale: against him the protocol's answer is never
confidentiality after the fact, it is **exit** (§10, §13.1).

That is also as far as §4.2's "one hash, ever" reaches. Once the rewrite has dropped the `[3,null]`
line, an index that lists 3 again at another hash folds cleanly, and only a reader that held a pin
across the rewrite can tell. A cold reader has nothing to compare against.

### Contrast

Every protocol that lets people publish has to answer "what does delete mean," and the honest
answers are all smaller than users expect.

- **Mastodon's `Delete` activity** is a message sent to the instances the server believes have a
  copy. It is best-effort in every direction: an instance that was down misses it, an instance that
  never received the original ignores it, an instance running modified software may keep the row,
  and caches, bridges, and search indexes retain what they scraped. It is a request to cooperating
  peers, which is a reasonable design — but it produces the belief that deletion propagated, which
  is the belief §8.8 forbids an app from creating.
- **The "right to be forgotten"** is a claim against a data controller, enforced by a regulator. It
  is a real remedy and it does not survive translation into a signed-file protocol, because there
  is no controller: the bytes are signed, self-verifying, and already on other people's disks.
  Open Feed cannot honour an erasure demand against a holder who declines, and does not offer to.
  What it can do is make leaving cost nothing, which is the remedy that fits the adversary in
  §13.1 — a person, not a company, who will not cooperate and cannot be sued into it.
- **Signal's disappearing messages** are the closest analogue to a rewrite: a timer that
  cooperating clients honour. Signal is careful to say so. A modified client, a screenshot, or a
  second phone in the room defeats it entirely, and the feature's value is that it makes forgetting
  the default between people who are not attacking each other. A rewrite has exactly that shape and
  exactly that limit.
- **Git** is the closest structural analogue. `rebase` or a history rewrite produces a new
  history, and the old objects stay reachable by hash — in the reflog, in dangling objects, in
  every clone — until somebody prunes them, which no other clone will do for you. An Open Feed
  index is the same trade at a smaller scale: the new version is authoritative, the old one is
  still whatever anyone kept.

The one thing a rewrite does buy is worth stating carefully, because it is easy to oversell.
Withdrawal removes a post from the live set immediately, for everyone, on the next fetch of the
index — that part is not best-effort, because the index is signed and the fold is arithmetic. What
the rewrite adds is that the *record of the withdrawal* stops being served: a stranger arriving
next month reads a feed with no gap in it, and does not learn that on some Tuesday there was a post
at number 3 and the author took it down. That is a real privacy gain against the public and against
future readers, and it is the entire gain. It buys nothing back from anyone who already looked.
