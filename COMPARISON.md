# How Open Feed compares

What follows is not advocacy. It is a record of the design choices that differ from existing
protocols, stated as trades: what each choice costs, what it buys, and why the trade was made for
the adversary in `GOALS.md`. Each section is organized around an Open Feed concept and compares
against the protocols that make a different choice in the same area.

Section references (§) point into `open-feed-spec.md`.

---

## 1. Signing and verification

Open Feed signs files as body, one newline, signature — three standard-library calls to verify, no
library at all.

**JWS compact serialization** base64url-encodes the payload, so what a reader receives is not what
the signer signed. RFC 7797's unencoded-payload option fixes that, at the cost of a header with
`"b64":false` and a `crit` list every verifier must negotiate before it can even look at the
signature. "Body, newline, signature" is that option with the header removed.

**Canonical JSON (RFC 8785 / JCS)** signs a re-serialization. A verifier must parse what it was
served, re-serialize it by the canonicalization rules, and hope its number formatting, string
escaping and member sorting agree with the producer's. Every parser divergence lives in that gap.
§2.3 removes the gap by removing the step. Three things count against canonicalization here:

1. It needs a library, or 200 lines. Priority 1 in `GOALS.md` is implementability from a standard
   library. No standard library canonicalizes JSON.
2. The library is not enough anyway. `JSON.parse` cannot reject a duplicate member name, so a strict
   parser is required *in addition* to the canonicalizer. Two pieces of machinery where this design
   has one small parser and no canonicalizer.
3. It reintroduces the gap it was meant to close. Because the signature covers canonical bytes
   rather than served bytes, a further rule is needed — "a document must arrive as its own
   canonicalization" — to stop a verifier from pinning a normalization of what it was served instead
   of what it was served. That rule is easy to skip, and skipping it is silent.

**Nostr** signs the SHA-256 of a serialized array with its own escaping rules, so the JSON on the
wire is again not the signed input.

**The Linked Data Signatures Mastodon layered on ActivityPub** (`RsaSignature2017`) need RDF dataset
canonicalization (URDNA2015) before anything can be signed at all — the most expensive version of
the same idea, and the draft it rests on is superseded; the fediverse signs the HTTP request
instead, so an object cannot be re-verified once it has left the wire.

The trade Open Feed makes is that a publisher must keep the bytes it signed and serve *those*. It
cannot regenerate a file from a database row and expect it to verify. In exchange, verification is
three standard-library calls and needs no library at all, which is priority 1 in `GOALS.md`.

**JSON hygiene** (§2.4) is I-JSON's (RFC 7493) rules made uniform plus `__proto__`, which is a
language hazard rather than an interchange one. The difference is where the enforcement lives.
I-JSON is a profile you are asked to conform to; §2.4 is a parser you have to write anyway, because
`JSON.parse` cannot express any of it. The duplicate-member case in particular is a known attack
class: parser differentials between two services reading one document have been shown to produce
authorization bypasses (Bishop Fox, 2021). The cost is about 100 lines of parser, once.

---

## 2. Identity and first contact

Your identity is your anchor key. A reader obtains it out of band (§3.7) and refuses a profile
whose `anchor` differs.

**SSH's host-key prompt is TOFU, and §3.7 refuses it.** The prompt says the host's authenticity
can't be established, prints a fingerprint, and asks whether to continue connecting — almost nobody
has the fingerprint to compare against, so almost everybody types `yes`, and the trust that gets
established is trust in whoever answered the connection. Open Feed's first concern is that prompt,
answered `yes`, with a hostile host on the other end.

**Signal's safety numbers** are the closest relative: 60 digits shown as twelve groups of five,
compared in person or read aloud, with a QR scan as the fast path. Same shape — an out-of-band
check value over public keys — and the same honest admission that most people never do it. Six words
are shorter to say than sixty digits, at the cost of being a check on identity only.

**PGP fingerprints and the web of trust** are the version that failed as a human protocol. Comparing
40 hex characters at a key-signing party asked people to be careful about something they had no way
to feel, and the usual outcome was checking the last eight characters, or none. Open Feed takes the
ergonomic lesson without the social graph: there is no signature-on-a-key, no trust transitivity,
and no keyservers. Vouching exists, but only for recovery (§3.3), only from a list you chose, and
only as hashes that reveal nothing until used.

**BIP-39** supplies the wordlist and nothing else. Its wordlist is a good one to borrow — 2,048
words chosen so that four letters identify each, and so they survive being said out loud — but a
BIP-39 mnemonic *is* a secret you can reconstruct a wallet from, and this is the opposite: six
words derived from a **public** key, safe to say in a room, and not enough bits to reverse.

---

## 3. The chain and key management

The chain links every key change back to the anchor key. There is no revocation, no CRL, no OCSP,
no expiry date.

**Revocation, and its absence.** Every revocation mechanism elsewhere is an *announcement* — a
document that has to reach the reader for the key to be closed, and it reaches the reader over a
path the host controls. Against the adversary `GOALS.md` names, the one who runs the serving path
and will not cooperate, **a revocation the host can withhold is not a revocation**. So the old key
is closed by what it may no longer do rather than by what anyone says about it: the reader computes
the current key from the chain, and an index signed by anything else is not the identity's index.
There is nothing to withhold, because there is nothing to deliver.

**X.509 and CA chains** run *outward* to a third party: the subject's key is vouched for by an
issuer, up to a root the reader was shipped. Trust arrives from outside and revocation has to be
published by whoever issued it. Open Feed's chain runs *inward* — every link is signed by the
identity's own previous key or by people the identity committed to in advance, and the whole thing
is carried in the profile the reader is already fetching. Nobody issues anything, and there is no
party who could refuse to.

**PGP key transition statements** are the closest ancestor of a rotation link: a plaintext document
saying "old key K1 is retiring, new key K2 is me," signed by both. It is the same idea done by
convention — the format is folklore, the signed bytes are a paragraph of English, and no
implementation verifies it. §3.2 makes it 88 bytes with a fixed shape that a verifier checks
without being asked.

**Signal.** When a contact's identity key changes you get a notification: the safety number changed,
verify again. There is no cryptographic link from the old key to the new one, so the notice is the
whole mechanism, and Signal itself made it non-blocking by default. Open Feed's equivalent of that
notification is a verdict a reader computes for itself, and a restore is *not* the same event as a
stranger substituting a key: one walks the chain, the other does not.

**Matrix cross-signing** is closer: a master key signs a self-signing key, which signs device keys,
so devices come and go under one stable identity without re-verifying each one. But replacing the
master key itself lands in the same place as Signal — other users have to verify the identity again
— and the whole structure lives on a homeserver rather than in a file the reader holds. The chain's
answer to *the master key is the thing that was lost* is the recovery list.

**Nostr** is the honest baseline, because it is the closest living system with the same starting
premise: identity is a key you hold, and there is no server that owns your name. It is also where
that premise usually stops — in the base protocol a lost key is a lost identity, and the proposals
for migration have not settled into something readers implement. §3.2 is the argument that a
key-as-identity protocol can survive key loss without acquiring an account system, and §3.3 is the
price: a chain that walks perfectly proves nothing on its own, so the recovery list has to do the
deciding.

---

## 4. Key recovery

The recovery list is salted hashes of member keys, committed privately in advance. Recovery is
public signatures, not secret reconstruction.

**Shamir secret sharing, and the wallets built on it.** The usual shape of social recovery splits a
secret into shares, and recovery means gathering enough shares to reassemble it. That design has a
moment where the secret exists again, on one machine, and it means your friends are custodians of a
fragment of you. Open Feed recovers *nothing*. There is no share, no reconstruction, and no moment
where anything sensitive is assembled: the vouchers are public signatures over the ASCII bytes
`<previous key>-><new key>`, and the new key was generated by the owner before she asked anybody.

**Guardian-based smart accounts** (Argent, and the ERC-4337-era accounts that followed) are much
closer — guardians approve a change of the controlling key rather than hand back a seed — and the
difference is where the decision is settled. Those systems have a shared ledger: the contract counts
approvals once, and everyone reads the same answer. Open Feed has no ledger, so every reader settles
it locally against what it saw first, which is why so much of §3.4 is about *which* copy of the
list a reader is allowed to believe. The other difference is disclosure: a guardian set is typically
visible on chain, whereas a recovery list publishes only its size.

**Why not a Merkle tree.** A Merkle root would prove membership in about `log n` hashes and would
hide the size of the set — and hiding the size is precisely what this design cannot afford, since
§3.4 counts a majority against it. A flat array of salted hashes is the smaller construction, and §2
has no room for a second one.

**Why the salt, and not a bare hash.** `SHA-256(key)` would commit to the member just as well, and
would be scanned in a second: the candidate set is a family, their keys are already published in
their own profiles, and an attacker only has to hash each one and look for it. The salt turns the
scan into a scan the attacker cannot run without the very disclosure it is trying to avoid.

**The abuser on the list.** The threat model this protocol is built against is a hub operator who is
a loved one, and he is exactly the sort of person who ends up on a recovery list — that is scenario
1 in `GOALS.md`, the divorce. §3.4 is the answer: the list is committed, and the majority rule
keeps a single member from seizing the identity alone.

**What a restore does not return.** The reading key is not socially recoverable (§3.6). Your people
can give you back your name, your chain and your posts; what was encrypted to you alone is gone
unless your app kept the key. The list is about identity, not about an archive.

---

## 5. Contests and relocation

A contest is two profiles claiming one identity. A move is a profile naming a new location.

### Contests

**There is no timestamp anywhere in this rule, and that is deliberate.** The adversary runs the
server. He can serve any file at any moment, hold one back for a week, or publish a branch dated
before the one it is fighting. A wall clock decides nothing here. Systems that settle a split by
"latest wins" hand the decision to whoever can write the newest file, which in this threat model is
the abuser. Open Feed settles it by *who vouched*, counted against a list the reader already had.

**Signal's safety numbers.** A key change produces a notification, and the user decides. That is
honest and it is the right shape for a two-party session, but it puts the whole question on a
person at the moment they are least able to answer it. Open Feed's `contested` verdict is the same
admission with a rule attached: the reader keeps following nobody until the recovery list settles it
or a person hands over the current key.

**Matrix cross-signing and device verification** solve the multi-device problem well; they do not
answer *two profiles claiming one identity* without a user comparing emoji again.

**Key transparency and CONIKS-style logs.** Genuinely strong, and the wrong shape for this project:
they need a log and an auditor, and in scenario 1 the plausible log operator is the hub — the
adversary. A gossip layer to keep the log honest is a second protocol at least as large as this one.

**Blockchain-anchored identity** (ION, `did:*` methods with a ledger). Same objection, more so: a
global ledger everyone must agree on, to publish family photos from a Raspberry Pi in a spare room.

**"Just ask them."** This is what §3.7's exit is, and the spec says so in as many words rather than
dressing it up. The difference from the systems above is that the asking is *bounded*: it is needed
only when the recovery list produces no majority, and what gets handed over is one key, over a
channel the host does not control.

### Relocation

Every other design answers "how do people find you after you move" by asking somebody to cooperate.

**Mastodon / ActivityPub.** Migration is `alsoKnownAs` on the new account plus a `Move` activity
issued *from the old one*: you must still be able to log in to the server you are leaving, and it
must be willing to emit the activity. Followers transfer; posts do not. Open Feed's adversary is a
host that will not cooperate, so a migration whose first step is an action by the old host is not
available at all.

**AT Protocol / Bluesky.** The closest comparison, and a good design: identity is a DID that
survives a move between hosts, and a holder of the rotation key can repoint the DID document without
the old host's blessing. The cost is the resolution layer everyone must consult — `did:plc` is a
directory, `did:web` is a domain you have to keep paying for. Open Feed's `locations` is the cheap
version of the same idea: no directory and no log, and the price is that the list is only as current
as the last profile a given reader verified.

**HTTP 301 and `Link rel=canonical`.** The redirect is served by the host you left. It is the right
answer when you own both ends and useless in exactly the case this protocol cares about. §9 refuses
cross-origin redirects for the same reason: a `Location` header is not identity equivalence, and
moving is expressed in the profile.

**Changing your email address.** The baseline everybody already knows: you tell people one at a time,
and some never hear. §3.5 is that, made mechanical — the telling happens inside public replies
written by people who already know where you are, so it reaches everyone with a social path to you
and nobody else.

---

## 6. The index and completeness

The index is a signed, versioned claim about the whole set: which posts exist, which are withdrawn,
and the highest number ever issued.

**A feed that is its items cannot say what is missing.** In RSS, Atom and JSON Feed the document
*is* the entries, and a truncated document is indistinguishable from a short one: a host that drops
your last three posts serves a feed that looks exactly like a feed with three fewer posts. None of
the three can say a post *was* here and was withdrawn. Open Feed's index is a signed, versioned
claim about the whole set, and the host cannot sign one.

**Nostr relays make the same trade in the other direction.** An absent event is unremarkable: relays
are expected to be partial, and there is no per-author statement of completeness to compare against.
That buys enormous flexibility in how events are spread around and gives up the ability to say a
relay withheld something.

**A transparency log buys much more and costs much more.** Certificate Transparency and Merkle-log
designs publish a signed tree head plus inclusion and consistency proofs, so a third party can prove
the log operator equivocated. Open Feed has no proofs, no auditors, and no gossip between readers.
Its index is comparable only against what *this* reader saw itself, so a rollback shown to a
brand-new reader is invisible to that reader. The design says so rather than dressing it up.

### Content addressing

**Content addressing without the network.** Naming a file by the hash of its bytes is the oldest
idea here: git names a blob by the hash of its content, and IPFS names one by a CID that wraps a
multihash. Open Feed borrows the idea and none of the machinery. There is no DHT, no gateway, no
content-routing layer: the blob lives at your hub, at a path under your own name, and nowhere else.

**Why the media file is not signed, when everything else is.** The signature on the index already
covers the hash, and the hash already covers the bytes, so the chain from anchor key to photograph
is complete without touching the blob. Signing it as well would mean a second file format, and §2's
whole point is that there is one format.

**Attachments elsewhere.** In ActivityPub an object carries an `attachment` array holding URLs, and
what happens to the bytes is up to whoever is serving them; Mastodon instances cache remote media
and prune the cache on their own schedule, so a post can outlive its picture or the picture outlive
the post. Open Feed puts that decision in the one signed file the author controls: an index line is
the author saying *this blob is part of my feed*, and its absence is the author saying it is not.

**Matrix** keeps media in a per-homeserver repository addressed by `mxc://` URIs, and in an
encrypted room the file is encrypted client-side and the event carries the key alongside a SHA-256
of the ciphertext — recognisably the same shape as `{"hash", "key"}` in Open Feed's envelope, with
a different cipher under it.

### Withdrawal and deletion

Every protocol that lets people publish has to answer "what does delete mean," and the honest
answers are all smaller than users expect.

**Mastodon's `Delete` activity** is a message sent to the instances the server believes have a copy.
It is best-effort in every direction: an instance that was down misses it, one running modified
software may keep the row, and caches, bridges, and search indexes retain what they scraped. It is a
request to cooperating peers, which is a reasonable design — but it produces the belief that
deletion propagated, which is the belief §8.8 forbids an app from creating.

**The "right to be forgotten"** is a claim against a data controller, enforced by a regulator. It
does not survive translation into a signed-file protocol, because there is no controller: the bytes
are signed, self-verifying, and already on other people's disks. Open Feed cannot honour an erasure
demand against a holder who declines, and does not offer to. What it can do is make leaving cost
nothing, which is the remedy that fits the adversary — a person, not a company, who will not
cooperate and cannot be sued into it.

**Signal's disappearing messages** are the closest analogue to a rewrite: a timer that cooperating
clients honour. A modified client, a screenshot, or a second phone in the room defeats it entirely,
and the feature's value is that it makes forgetting the default between people who are not attacking
each other. A rewrite (§4.5) has exactly that shape and exactly that limit.

**Git** is the closest structural analogue. `rebase` produces a new history, and the old objects
stay reachable by hash until somebody prunes them. An Open Feed index is the same trade at a smaller
scale: the new version is authoritative, the old one is still whatever anyone kept.

---

## 7. Posts and interactions

Everything is a post. A reply, reaction, or private message is a post naming a target.

**"Everything is a post" as a design choice.** ActivityPub goes the other way: an extensible
vocabulary of activity types — `Create`, `Like`, `Announce`, `Follow`, `Undo` and more — delivered
by POST to an actor's `inbox`. That buys expressiveness and a place to hang new verbs. It costs a
server that must know what each type means, a delivery side channel with its own authentication
story, and an `Undo` for every verb. Open Feed has one object and a `rel`, so there is **one code
path, one verifier, and one retention rule**: everything is a numbered file the index lists or does
not. The cost is real — a `rel` value is not self-describing to a client that has not heard of it,
and there is no type registry. A reader that does not recognise a `rel` has a post it can verify and
display and cannot interpret. The bet is that this is the better failure.

**The full target hash, against threading by identifier alone.** Email's `In-Reply-To` names a
`Message-ID`, and ActivityPub's `inReplyTo` names a URI: in both cases the identifier says *which*
object, and nothing about *what it said*. Nostr is the closer relative — an `e` tag holds an event
id that is itself a hash. What Open Feed adds is the pairing with a **number**: because
`(author, n)` is the slot a post lives in and the index is signed, a reply naming `(key, n, hash)`
can be checked against what that author's index lists at `n`. That check is what makes a number safe
to use as a join key at all.

**`at` deciding nothing, against timestamp precedence.** Nostr's replaceable events keep the copy
with the largest `created_at`, breaking ties on the id — a timestamp the publisher chooses.
Last-write-wins registers in CRDT-flavoured systems do the same thing. It works when nobody has an
incentive to lie. Open Feed's adversary is the operator of the family hub, who can set any clock he
likes, so precedence is carried by monotonic counters he cannot forge instead: `version` on the
profile and the index, and one-hash-per-number on posts, all inside signed bytes.

**The direct-message trade, against Signal.** This is the least comfortable part of §5 and it
deserves plain arithmetic.

- **Sealed sender is not available**, because a message *is* a numbered file on the sender's own
  hub. The host holds it; the shape of the correspondence is visible.
- **Deniability is given up**, because the same per-post signature that stops the ex from posting as
  his wife also makes anything she sends provable by whoever received it. There is no separate
  construction for messages (§6): one signing rule covers the whole protocol.
- **There is no forward secrecy**: a reading key that leaks opens every encrypted post ever
  addressed to it, and changing `read` in a new profile version does not re-encrypt the past.

For the person in scenario 1 — the sister publishing from her ex's hub during a divorce — the
property she needs most, that he cannot write anything in her name and cannot alter what she wrote,
is exactly the property that makes her own private messages provable by their recipients.

---

## 8. Encryption

One X25519 ephemeral key pair per message, a wrapped content key per recipient, one AEAD ciphertext
for the content (§6).

**JWE** (RFC 7516, JSON Serialization with `ECDH-ES+A256KW` and `A256GCM`) is the standards-track
way to say the same thing, and it costs a wire format whose rules live in four RFCs, with no
standard library that implements them. Its per-recipient header is **not covered by the JWE's own
AEAD**, so carrier binding has to be a rule a decrypting client performs by comparing plaintext
fields afterwards; §6.2 is the same defence in one line of associated data.

**HPKE (RFC 9180) and age** are the closest well-specified relatives — HPKE in spirit, age in
shape. HPKE's base mode is the DHKEM half: an ephemeral X25519, HKDF-SHA256, ChaCha20-Poly1305.
age's X25519 recipient stanza is the rest: a file key wrapped once per recipient under a single-use
key. Where §6 deviates from HPKE:

- HPKE derives through `LabeledExtract`/`LabeledExpand` with a version prefix and a ciphersuite
  identifier. §6 derives straight from the raw X25519 output with HKDF salted by `epk`, and
  `"openfeed/v1/slot"` is the whole of the domain separation.
- HPKE's `Seal` takes a nonce from the key schedule XORed with a sequence number, because an HPKE
  context encrypts many messages. Here a content key encrypts exactly one.
- HPKE offers an authenticated mode. §6 does not need one: the sender is authenticated by the
  Ed25519 signature on the file the envelope rides in.
- HPKE and age are reviewed, tested, widely implemented, and this is not. That is a real cost.

**NIP-44** (Nostr's encrypted payloads, Cure53-reviewed) is the nearest reviewed construction this
one could be swapped for. The cipher suite is nearly the same. Two differences matter. NIP-44 is a
**two-party** format: a conversation key from a *static* pair of keys, so it has no ephemeral, no
slots, and no audience; a group is N pairwise copies. And it encrypts-then-MACs with HMAC-SHA256
rather than using an AEAD.

**Signal and MLS (RFC 9420)** are the comparison people reach for, and this is not in that family at
all. There is **no ratchet, no forward secrecy after the fact, and no group state.** Nobody is
*added to* or *removed from* anything, because there is no group to be a member of — an audience is
fixed at the moment a post is written, and the next post simply names a different list. This is
**file encryption for a mailing list**, and the design says so.

**Why the audience is inside and not in a header.** A header would be readable by the host, which is
floor item 2 in reverse: the audience of a family-only post is exactly the social graph the abusive
operator wants. A key identifier per slot would do the same thing permanently, since reading keys
are long-lived and published. A blinded tag needs one of the two private halves and is fresh per
message, so an observer with every published key and the whole feed learns that an encrypted post
exists, when, how big, and to how many — nothing else. The cost of putting the audience inside is
that recipients learn each other, which is the intended trade: it is what makes a reply reach the
same people.

---

## 9. Reading and verdicts

A read returns exactly one of **ok**, **host**, or **identity** (§7.2), and a reader MUST NOT
invent a fourth.

**TLS certificate validation** is the cautionary case. A browser's chain validation has a genuinely
large vocabulary — expired, not yet valid, hostname mismatch, unknown issuer, revoked, weak
algorithm — and it surfaces most of them through one interstitial with an "Advanced" link. The
vocabulary is real and the user's response to all of it is identical: click through. A security UI
with many states degrades into one state, and the state is *yes*. Open Feed does not get to be
smarter than browser vendors here; it gets to have less to say.

**GnuPG's trust levels** — unknown, undefined, never, marginal, full, ultimate, plus separate
validity — are the same lesson at the identity layer. The model is more expressive and, by most
accounts, almost nobody ever set the values, so in practice the whole lattice collapsed to "I have
this key" versus "I do not."

**Signal's "safety number changed"** is the closest relative and it is deliberately binary. It maps
almost exactly onto `identity`: something about who this is has changed and cannot be settled from
here. Open Feed adds one state Signal has no need for, `host`, because Open Feed's reader re-fetches
a history a hub could withhold or roll back, while a Signal server relays messages it cannot replay.

The general rule: **the number of states is a UI budget, not a correctness budget.** The protocol
can detect far more than three conditions, but what it *reports* is three, and the extra detail
rides as explanation inside a verdict rather than as another thing a person must learn.

### The rumor rule and amplification

Any "go check that" rule driven by attacker-controlled input is a request amplifier unless it is
bounded per identity and per pass. The attacker writes cheap bytes on his own hub; the reader spends
fetches on a third party's hub.

**Email backscatter** is the classic version: a spammer forges an envelope sender, and every server
that bounces politely turns one forged message into delivery attempts aimed at whoever was named. The
defence was to stop generating the second message on unverified input, which is the same move as
bounding the look-again (§7.4).

**ActivityPub** meets the shape from the other side. There the attacker's input arrives as a push
into an inbox, so the defence is at the door — signature checks, per-actor rate limits — and it is
operator policy rather than protocol text. Open Feed has no inbox and nothing is pushed, so the
limit has to be in the reader. **Nostr** puts the fan-out in the relays, where a client subscribes
and relays deliver; the amplification budget is a relay's to manage.

---

## 10. Publishing and portability

The request is the signed file. There is no account, token, or session.

**Micropub, the Mastodon API and AT Protocol's `com.atproto.repo.*`** all put an authorization layer
between a client and a repository — some mix of app registration, an OAuth flow, bearer tokens,
scopes, refresh and revocation. Open Feed has none of those, and the absence is not a simplification
of the same design — it is a different one. In a token model the server decides what a client may
write and can therefore write it itself; the token proves you asked, not that you meant it. Here the
*file* is the credential: a hub that wants to publish as alice needs her Ed25519 private key, which
never leaves her device.

**Bring-your-own-client as a security property.** The threat model — the hub operator is a family
member who is an abuser — makes the app-plus-server product the wrong shape at the root, because
whoever ships the app can ship one that copies the key on first launch. Splitting the two is not a
preference about ecosystems; it is what makes the key's location a fact rather than a promise.

**Compare-and-swap over HTTP.** `If-Match` and `ETag` are HTTP/1.1's conditional requests (RFC 9110)
doing exactly the job they were specified for. Where it is thin: conditional `PUT` is less widely
implemented than conditional `GET`, and several popular object stores have only recently grown it;
intermediaries and CDNs have historically felt free to rewrite or weaken `ETag`.

**Static hosting is a conforming hub.** Serve exact bytes, allow cross-origin reads, hold no user's
signing key. A bucket behind a CDN clears that bar, and everything in §8.1 through §8.6 is the
additional bar for a hub that accepts writes.

### Your copy and data portability

**Why "keep the bytes" is a protocol rule and not app advice.** Because §2.3 signs the bytes that
were *served*, the wire format and the archive format are the same object. A protocol that signs a
canonicalization cannot do that: the thing you hold is a reconstruction, so the spec has to define
an export bundle, give it a version, and then define a migration path for when that changes.

**Everything else in this space is something you ask for.** GDPR Article 20 gives a right to data
portability, exercised *against* a controller, with a regulator behind it; the adversary here is a
family member who will not answer either one. Mastodon has a real account archive — Settings,
request, wait, download a tar of ActivityPub JSON — and it is generated by the server, rate-limited
by the server, and unavailable when the server is down or unwilling. Twitter/X's data download is
the same shape without the good faith. **There is no export**, because the application was holding
the published bytes the whole time, and the bytes are self-proving.

**Bluesky and the AT Protocol** get the important half right. An account's repository is a signed
commit over a Merkle search tree, so its contents are verifiable independently of the server,
`com.atproto.sync.getRepo` hands the whole thing back as a CAR file, and account migration is a
documented, working operation. That is genuinely the same insight: sign the data, not the
connection. Two differences: the CAR file is a *second* format — DAG-CBOR in a CAR container, the
API is JSON, so there is still an archive format distinct from the wire format, and there is still
a request a host can refuse. And portability of the data is not portability of the name: a `did:plc`
identity resolves through a directory, so the identity layer has a party in it even when the data
layer does not. The trade runs both ways: Bluesky's tree gives efficient sync and proofs of absence
that a flat index does not.

**The uncomfortable half.** Readers hold what they saw, forever, and that cuts both ways. The same
property that makes mum a backup makes the operator one: he keeps every byte he ever served, he
opens every envelope he was an audience member of, and withdrawing a post reaches the live set and
nothing else. A signed private message is provable by its recipient — which is protection when the
recipient is being disbelieved and exposure when the recipient is the person you are leaving. There
is no version of "signed per post" that gives the first without the second.

---

## 11. Fetching

The rumor rule (§7.4) follows a URL a stranger wrote, so SSRF defence has to be in the
specification.

**SSRF is the frame.** Server-Side Request Forgery is normally a bug: an application accidentally
lets a user steer an outbound fetch. Here it is the *normal operation*. The concrete attack is DNS
rebinding: an attacker registers a name, points it at a public address, and the reader's checker
approves it; between that approval and the connection, the same name resolves to `127.0.0.1`. This
is why §9 says the check is on the resolved address *before the socket connects*, with no second
resolution in between.

**Other federated systems fetch arbitrary URLs too, and mostly leave the rules to the
implementation.** ActivityPub servers dereference remote object URLs as a matter of course, and SSRF
has been a recurring bug class — Mastodon alone has shipped advisories for the WebFinger fetch, for
missing IP ranges, for the IPv6 `::` form and for the IPv4-mapped forms, the last three being
exactly the embedded-IPv4 cases §9 spells out. The protocol says what to fetch, offers a sentence
of advice about localhost, and leaves the list to each implementation, so every implementation gets
to have the bug separately.

**Why the spec enumerates the ranges instead of saying "block private addresses."** Because
"private" is not a definition anyone implements identically. Is CGNAT private? Is `0.0.0.0`? Two
implementers who agree on the sentence and disagree on the list have produced a bypass — and the
reader with the shorter list is the one whose users get hurt.

**"No verdict is not a verdict."** If a failure to reach a host is reported as evidence about the
host, then every flaky coffee-shop connection becomes an accusation against somebody's aunt. The
verdicts in §7.2 are strong claims, and they are only worth anything if they are never raised by a
timeout. §9 makes the distinction structural rather than advisory.

---

## 12. Views and interop

A feed is a view, not the object. The JSON Feed document, the Atom feed, and the h-card page are
generated from the signed files and are unsigned themselves (§10).

**A feed is a view, not the object.** The other choice is to make the JSON Feed document *the* wire
format — extension fields under an `_openfeed` member of each item, a signature beside it, a
manifest listing item ids and versions. What goes wrong: signing JSON Feed items means the *interop*
format is also the *security* format, so every question about one becomes a question about the
other, and JSON Feed's own requirements leak into the signed bytes. Splitting the two makes each one
small: the signed files answer only to §2, and the view answers only to whatever a feed reader wants
this year.

**ActivityPub** goes the opposite way: the wire object *is* the vocabulary, and interop means
agreeing about ActivityStreams types and JSON-LD contexts. Day to day the fediverse authenticates the
HTTP request, not the object, so an object cannot be re-verified once it has left the wire.
**Microformats and the IndieWeb** go further still: the HTML page *is* the data, and a consumer
parses your presentation to learn your facts. Open Feed generates both kinds of surface and trusts
neither. The h-card is output, never input.

**Why "MUST NOT treat a view as evidence" earns a MUST.** Because the shortcut works. An implementer
who has to build a reader will find `feed.json` easier to parse than an index — no signature check,
no chain walk, no pin — and a reader built on it will display posts correctly for every honest host,
forever. It will simply provide none of the guarantees the protocol exists for, and there is no test
that shows the difference until the host is the one who controls the serving path and does not
cooperate. A SHOULD would be read as advice about tidiness.

**What interop buys, and what it costs.** It buys the stranger: reach into every feed reader and,
through a bridge, into networks nobody here has to build. It costs a second copy of the content that
the host can rewrite at will, which readers will find first, and which looks authoritative because
it is served from the author's own address. §10's answer is not to make the view trustworthy — it
cannot be — but to say so once, plainly, in the sentence next to the SHOULD that requires it.
