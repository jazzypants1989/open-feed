# Media

**Spec:** §4.4 media and attachments, §5.5 `media` on a post, §6.6 the key inside the envelope,
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

## What the output shows

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
on an encrypted post the reference lives inside the envelope (§5.5, §6.6). The host cannot read it,
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

## Contrast

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
