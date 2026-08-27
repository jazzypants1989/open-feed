# Distribution Model

A family journaling app with an AI companion, built as an ordinary Open Feed publisher.

`open-feed-spec.md` defines the protocol. This document describes one product built on it, and cites
the spec rather than restating it — where a section number appears, that is where the rule lives.

**It is free.** The owner's position: free forever, and good luck to anyone who wants to make money
off it. There is no business model section below because there is no business model.

---

## 1. What this is

A member talks to an AI companion through the day. In the evening the companion drafts a journal
entry in their voice; the member edits it and publishes. Family read each other's entries, reply,
and react. Some entries are for everyone, some for the family only, some for nobody.

The whole application is an Open Feed publisher and an Open Feed reader wearing a product. There is
no private API that is the real source of truth, and no format the protocol does not already define.
A member who leaves takes a directory of signed files that any other reader can verify, and the
application they leave behind cannot speak in their name afterward.

That last property is the reason the protocol exists, and `GOALS.md` states the adversary it is
judged against. This product inherits the whole of that threat model: the operator of the family hub
may be a family member who is not on your side.

## 2. The product

1. Reflect on the day through conversation, and publish something worth keeping.
2. Choose an audience per entry: everyone, chosen people, or nobody.
3. Read and reply to relatives who are on this hub and relatives who are not, identically.
4. Keep photographs alongside the words.
5. Leave at any moment with all of it.

### Design principles

1. **The app is the client, and the client holds the keys.** Signing happens on the member's device.
   The hub never holds a key that can sign a profile or an index, so it can never publish as a member
   (§4.4). This is the decision every other one below hangs off.
2. **The hub is storage.** A static file server that accepts signed `PUT`s is a fully conforming hub
   (§8, §8.7). Everything the product does beyond that is convenience, not authority.
3. **One set of formats.** A member hosted here and a member self-hosting publish the same four kinds
   of file (§2) and are read by the same code. There is no internal representation that is more true
   than the signed bytes.
4. **Nothing exists only in the app.** Every published thing is a signed file at a stable URL. The
   app's database is a cache and an index over files it can re-derive.
5. **The AI handles complexity, not custody.** The companion drafts, suggests, and summarizes. It
   never holds a key and it never decides an audience on its own.

## 3. How it sits on the protocol

Three parties, and only the first two are ours:

```
  member's device                    hub                        any reader
  ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
  │ companion (AI)   │        │  /<name>/profile │        │ fetch, verify,   │
  │ editor           │        │  /<name>/index   │        │ checkpoint (§7)  │
  │ keys ────────────┼─ PUT ─▶│  /<name>/posts/… │◀─ GET ─┤                  │
  │ signing          │  (§8)  │  /<name>/media/… │        │ feed readers,    │
  │ reader + cache   │        │  views (§10)     │        │ browsers, other  │
  │ your copy (§8.9) │        │                  │        │ family apps      │
  └──────────────────┘        └──────────────────┘        └──────────────────┘
```

The hub serves back the exact bytes it was given (§2.3), answers cross-origin reads with
`Access-Control-Allow-Origin: *`, and handles the preflight for a cross-origin `PUT` (§8.7). It may
also generate the views (§10) so a member's phone does not have to. That is the entire server-side
product surface that the protocol cares about; accounts, rate limits, and a bill are the hub's own
business and the spec explicitly allows them (§8).

### Deployment models

| model           | shape                                                             | reader sees                  |
| --------------- | ----------------------------------------------------------------- | ---------------------------- |
| **Family hub**  | everyone under one origin: `pence.family/mom`, `pence.family/dad` | an anchor key and a location |
| **Mixed**       | most on the hub, one relative on `jessepence.com/jesse`           | an anchor key and a location |
| **Self-hosted** | each member on their own domain                                   | an anchor key and a location |

The three are indistinguishable to a reader on purpose, and the app must not distinguish them either.
A reply from `pence.family/dad` and a reply from `jessepence.com/jesse` arrive by the same route,
verify by the same rule, and render the same way.

**A location is not an identity.** The identity is the anchor key (§3), and moving is publishing a
profile at a higher `version` naming a new place (§3.5). This is why the product does not have to get
URL layout right on the first day: a member who starts at `pence.family/mom` and later self-hosts
keeps their identity, their history, and everyone who reads them.

## 4. Identity, onboarding, and recovery

Onboarding is where this product either honors `GOALS.md` or quietly breaks it, so it gets the most
detail in this document.

**1. The device makes the key.** The app generates the anchor key — a 32-byte Ed25519 key — and the
X25519 reading key (§3.6) on the member's own device, and stores them in the platform keystore. The
hub is not present for this step and never receives either private half.

**2. The app writes the anchor profile and an empty index.** The profile carries `anchor`,
`version`, `chain` (one link, the anchor itself), `recovery`, `locations`, and `read` (§3.1); the app
signs it and `PUT`s it, then `PUT`s an empty index, because claiming a name requires both (§8.4). The
hub answers 403 for a profile that does not verify and 409 for a name already held under another
anchor. First come, with the profile as the proof.

**3. The recovery list is relatives, and it is set up now.** The recovery list is a set of hashed
leaves — `SHA-256(salt ‖ "|" ‖ member key)` with a distinct salt per member — so the list itself
reveals nobody (§3.3). If the member loses their key, a majority of the listed members vouch for a
new one and the identity survives (§3.2). The spec asks for a backup key of the member's own plus
**three or more** other members, and the width is the whole defense: a member who holds the backup key
and one leaf of their own is a majority of any list of three or fewer, and the backup key is generated
on the device — which somebody else may have been holding. Four leaves is the first shape in which
that person is outvoted (`test/setup.test.js`).

This replaces the printed-card ceremony an earlier design used, and it is better on the axis that
matters here. A card in a drawer is an artifact the hostile-custodian adversary has physical access
to. A threshold across relatives is not, and the operator holding the server gains nothing toward it
unless he also holds a majority of the list — which is a social fact the member can see and choose.

**Setup is the one screen the adversary may be standing at.** The person walking a member through
onboarding is often the person the list most needs to outvote, so the app must ask in words that do
not hand him the pen:

- Ask for **people, by name, out loud** — _"name three people who would know it was really you"_ —
  rather than _"who can vouch for you?"_, which invites whoever is holding the phone to add himself.
- Say that the person helping **should not be the only one on the list**, at the moment the list is
  built, not in a help page.
- Read the list back as names the member recognizes, and let them change it later. A changed list
  reaches readers only through a new link, so the app rotates when it changes (§3.3).
- Never let the flow finish with fewer than three people beside the backup key. The spec's SHOULD is
  the app's MUST here: nobody comes back later to widen a list that already works.

And state the limit rather than implying the arithmetic is a guarantee: nothing in the protocol tells
two keys of one person from two people (§3.3). What a reader can do is report **who** vouched for a
restore, because the link publishes their keys — so the app shows those names beside "recently
restored", which is the only thing that separates a rescue from a takeover.

**4. First contact happens out of band, once.** A reader must learn an anchor key by a route the hub
does not control (§3, §3.7). The app supports both routes the spec defines: a link with the key in
its fragment, `https://pence.family/mom#<anchor key>`, and a six-word spoken code derived from the key
(§3.7) for the case where the link itself would travel through something the operator can see. Read
the six words to your sister on the phone; she types them in; the app refuses any profile whose anchor
does not match.

This is the step users skip and the step that carries the whole guarantee. The app should make it a
moment — a card with the six words and the link, shown once at setup and available afterward — and
should say plainly what it defends against, because a hub that both publishes an identity and
introduces it can introduce a different one.

**5. Rotation and restore are ordinary.** Changing keys appends a link to the chain signed by the
previous key (§3.2); losing a key and being vouched back is a link with vouchers instead. Readers
walk the chain and a restore may change the key and nothing else (§3.2), so the app must not bundle
a profile edit into a recovery.

## 5. What gets published

The product's objects are the protocol's four kinds of file (§2). There is no fifth thing.

| product object     | on the wire                                                                       |
| ------------------ | --------------------------------------------------------------------------------- |
| journal entry      | a post at `/<name>/posts/<number>` with `text`, `at`, and any `media` (§5)        |
| comment            | a post with `rel: "reply"` and a `target` naming the entry (§5.3, §5.4)           |
| reaction           | a post with `rel: "like"`, and the same `target`                                  |
| photograph         | a media file at `/<name>/media/<hash>`, listed in the index (§4.3)                |
| edit               | a new post with `rel: "supersedes"` naming the old one, which is withdrawn (§5.3) |
| delete             | a withdrawal line in the index, `[number, null]` (§4.1)                           |
| the journal itself | the index (§4) — the list of what is live, signed, at one URL                     |

A comment is a post in **its author's own index**, not in the recipient's. This is the largest single
change from any inbox-shaped design and section 6 is about what follows from it.

### Three audiences, not four

| audience          | how                                                                           |
| ----------------- | ----------------------------------------------------------------------------- |
| **anyone**        | an ordinary post, cleartext (§5)                                              |
| **chosen people** | an encrypted post: the content is sealed to each recipient's reading key (§6) |
| **nobody**        | not published at all — it stays in the app and in the member's copy (§8.9)    |

An earlier design had a fourth tier, _unlisted_: published but not advertised. It does not survive
here and should not be reintroduced. The index is the head (§4), a reader finds posts by replaying it,
and a post that is not listed is simply absent. "Published but hidden" would mean serving one thing
and claiming another, which is exactly the equivocation the reading rules catch (§7.1).

### Encrypted posts

An encrypted post is a post whose content sits in an `encrypted` member: one ephemeral X25519 key
pair, one wrapped slot per recipient, and the content encrypted once under a content key (§6.1). It
is signed, addressed, listed, and fetched exactly like any other post, and a reader who cannot open it
verifies it and moves on with the envelope opaque (§6). Attached photographs are encrypted too, under
their own per-file key carried inside the envelope (§4.3, §6.5).

Three consequences the product must handle rather than hide:

- **The audience is inside the envelope** (§6.4). Every recipient sees who else was included, which
  is what lets a reader compose a reply to the same people without anyone publishing a roster. It also
  means the audience is a claim by the author that no recipient can check — say so in the UI where a
  member joins a conversation, not in a help page.
- **Adding someone is prospective.** They can read from the moment they are added, and nothing
  re-wraps what came before. The UI must say this at the moment of adding.
- **The metadata is public.** Anyone can see that this identity posted, at what number, when, how
  often, and — from a reply's `target` — who replied to whom. Only the content is opaque. Where the
  fact of the conversation is the sensitive part, encryption is not the mechanism that helps.

And the bound the spec states outright: a reader must not be shown encryption as protection from a
hub that is in the audience (§6). Where the operator is on the list, he is a reader like any other,
and the protocol's answer is exit, not confidentiality.

### Editing, withdrawing, and what deletion means

An edit is a new post that supersedes the old one, and readers holding the superseding post show
replies that targeted the superseded `(number, hash)` under it (§5.3). A withdrawal removes a line
from the index; it does not remove a file, and the hub may clean up unlisted files afterward (§8.8).

The app **must not tell a member that withdrawing erased anything** (§8.8). It did not. Bytes already
fetched, cached, or archived by anyone are gone from the publisher's control the moment they were
served. Say it at the moment of the change.

### Views

The app generates a JSON Feed, an Atom feed, and an h-card page from the index and the posts (§10),
so a relative can subscribe in an ordinary feed reader. Views are unsigned and no reader may treat one
as evidence (§10). Withdrawn posts are absent; encrypted posts are omitted or rendered as an empty
placeholder, and a view must never carry ciphertext. The hub may generate the views itself.

## 6. Interaction without an inbox

**There is no inbox** (§5.6). Nothing is delivered anywhere. A reply is a post in the replier's own
index carrying a `target`: the target author's anchor key, the target's number, the target's full
address, and the location the replier last knew that author to be served at (§5.4).

So a conversation is assembled by the reader, not routed by a server:

1. The app reads the identities its member follows (§7.1) — hub-hosted relatives and self-hosted ones
   by exactly the same path.
2. For every post naming a target the app holds a checkpoint for, it checks that `target.hash` is what
   that author's index lists for `target.number` (§7.1 step 13). A mismatch means the reply is to
   something else, and it renders as unresolved rather than being attached to the wrong post.
3. If the target's number is above that author's `highest`, the reply is talking about something the
   app has not seen yet, and it looks again — re-reading that author at the locations it holds and then
   at the reply's location (§7.4).

The rumor rule bounds that lookup: at most one look-again per identity per pass, and one line per
replier however many replies they wrote — _"Jesse replied to something I cannot see"_ (§7.4). The app
should render that line literally, because it is the honest state and the alternative is a thread with
a hole in it and no explanation.

**What this costs.** Latency is polling latency, not delivery latency; a reply appears when the app
next reads that author. There is no push. A relative nobody follows is talking to an empty room.

**What it buys.** There is no endpoint to authenticate, rate-limit, flood, or silently drop, and no
class of "it was delivered but never arrived" bugs. A hub that wants to suppress a reply has to
suppress its author's whole index, which every reader with a checkpoint detects (§7.1). And a
self-hosted relative needs to run a static file server, not a service.

**Reactions and threading.** A reaction is a post like any other, which means it is public in the same
sense the entry is — there is no delivered-only channel to hide it in. A reaction to an encrypted post
should itself be encrypted to the same audience (§6.5). Deep replies carry a `root` relation alongside
`reply` (§5.3) so the app can render a thread flat or nested from the same data.

**Notifications** are computed by the reading app from what it just read: new posts by followed
identities, replies and reactions whose `target` names this member. The hub is not involved and does
not know who is notified about what.

## 7. The app's two interfaces

### Publishing (§8)

```
PUT /<name>/posts/<number>                        → 201 | 200 (reclaimed) | 409
PUT /<name>/index          If-Match: <etag>       → 200 | 412
PUT /<name>/profile        If-Match: <etag>       → 200 | 412
PUT /<name>/media/<hash>                          → 201 | 200 | 409 | 400
```

There is no account, token, or session on this path: the request is the signed file (§8). Publishing
an entry is exactly two writes — **the post first, then the index that lists it** (§8.3) — and the app
must never reverse them, because an index naming a post the hub does not serve reads as tampered to
every reader (§7.1 step 12).

The index write is compare-and-swap: send `If-Match` with the tag read, and on a 412 re-read the index
the hub now serves and merge the new line into _that_ file's entries (§8.1). A member posting from a
phone and a laptop will hit this, so it is ordinary app plumbing rather than an error case. A post
number is created once and may not be reused (§8.2); a device that comes back must abandon a number it
cannot prove it listed rather than list it late.

### Reading (§7)

The reader half of the app runs the steps in order (§7.1) for each identity its member follows, and
keeps a **checkpoint** — the profile's version and address, the chain, the recovery list at each chain
length, every location ever named, the index's version and address, `highest`, the live set with its
hashes, and the hash of every number seen withdrawn (§7.3). The checkpoint is the app's own state and
never goes on the wire.

A read returns exactly one of three verdicts, and the app must not invent a fourth (§7.2):

| verdict       | what the app should say                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ok**        | nothing — render the journal. Notes ride along: _recently restored_, _withdrawn: 7_, _no index I can verify_                                                          |
| **tampered**  | "This hub is not serving Mom's journal correctly." Name the hub, not the person. Keep showing the last good read                                                      |
| **contested** | "Two versions of this identity are in circulation." Show both, follow neither, and offer the one thing that resolves it: get the current key from her directly (§3.7) |

The wording matters more than usual. **tampered** is an accusation against the serving path;
**contested** is an unresolved fork in an identity. Collapsing them into "something's wrong" throws
away the only distinction the reader is equipped to make.

A cap or a transport failure is **not** a verdict (§9). An unreachable hub is an unreachable hub, and
the app must not render it as a state of the identity. The reader also enforces §9's outbound bounds —
HTTPS only, at most 5 redirects and never cross-origin, non-public addresses refused before the socket
connects, timeouts and body caps and per-origin socket caps — and this matters more here than in a
typical client, because the rumor rule follows a URL a replier chose (§9).

## 8. The AI companion

The companion is the product. Everything above is how it stays honest.

| task                | what it does                                                                         |
| ------------------- | ------------------------------------------------------------------------------------ |
| daily conversation  | asks about the day, prompts reflection                                               |
| entry drafting      | synthesizes the conversation into an entry in the member's voice                     |
| audience suggestion | "this mentions health — family only?" — a suggestion, never a default that publishes |
| photo descriptions  | alt text for attached media                                                          |
| digest              | "Dad reacted to your cookies post"                                                   |

**It runs in the member's client.** Not as a privacy nicety — as the only place it can run. Content
for chosen people is encrypted to reading keys the hub does not hold (§6), so there is no plaintext on
the server for a server-side companion to read, and building one would mean either weakening the
encryption or splitting the product into two companions with different reach. One companion, on the
device, over content that device can decrypt.

Two viable engines, and the app should let the member pick: a local model on their own hardware, which
involves no third party at all, or the member's own provider key called from their own client. In the
second case the app must say plainly that the content reaches that provider — the hub cannot make that
disclosure on the member's behalf, because the hub does not know.

**What it sees:** the member's own entries and drafts, their conversation history, and family content
this member can actually decrypt. **What it does not see:** anyone else's drafts, anyone else's
conversations, any private key, and anything the member's own keys cannot open.

**Cross-member consent.** Family content this member can read includes entries other relatives
addressed to an audience this member is in, and feeding it to a model is a disclosure those authors
did not explicitly agree to. Client-side execution does not make that go away; it makes it _the
reading member's own disclosure to make_, which is the version that can be consented to honestly.
Three things follow: disclose during onboarding that entries shared with a member may be processed by
a model that member chose; provide a per-member exclusion that keeps their content out of others'
companion context; and never put another member's private entries or drafts into any context, because
those were never published in the first place.

Entries the companion drafted carry `_ai_assisted: true` at the post's top level (§2.5 — extension
members begin with `_` and are inside the signature). Displaying it is a member preference; recording
it is not.

## 9. Leaving

A member must be able to leave without the operator's cooperation. Under device custody this is
nearly free, which is the strongest practical argument for the custody decision.

**1. Your copy is already yours.** A publisher must keep the signed bytes of everything it publishes
(§8.9), and here the publisher _is_ the member's app. Export is a directory: profile versions, the
index, every post, every media file, byte-verbatim, so every hash and signature still checks. No
server-side export endpoint has to exist, no admin has to approve it, and nothing can be rate-limited
into uselessness.

The export must also carry the unpublished half — entries addressed to nobody, drafts, and the
member's companion conversations. A journaling app whose export returns the public journal and
withholds the private one has built a backup, not an exit.

**2. Moving is a profile write.** Stand up files at a new location, publish a profile at a higher
`version` naming it (§3.5), and readers who remember any location this identity ever named follow it.
The old hub is not asked and cannot object: it never held a key that can sign a profile (§4.4), so it
cannot answer with a branch of its own.

**3. If the key is gone,** a majority of the recovery list vouches for a new one and the chain
continues (§3.2, §3.3). If two branches do circulate, the contest rules decide by the recovery list at
the divergence point, and if neither reaches a majority the identity is **contested** until the owner
hands a reader the current key directly (§3.4, §3.7).

Test the walkthrough end to end before launch, with the hub deliberately refusing to help. That is the
only test that proves the property.

## 10. Building it

### Order

**Phase 1 — the client.** Keys on the device, anchor profile and index, recovery list at onboarding,
first-contact card, entry composition, photographs, publishing (post then index, compare-and-swap),
the reader with checkpoints and the three verdicts, views, and export. _Test: Mom posts, Dad replies
from another domain, Grandma subscribes in a feed reader, an independent verifier checks every
signature, and Mom exports her whole journal while the admin refuses to help._

**Phase 2 — audiences.** Encrypted posts and encrypted media (§6), the audience picker, encrypted
replies and reactions to the same audience, and the UI lines that state what the audience claim is
worth and that adding someone is prospective. _Test: a family-only entry readable by a self-hosted
relative and opaque to the hub's own operator._

**Phase 3 — the companion.** Conversation, drafting, audience suggestions, digests, running on the
member's device against content it can decrypt, with the engine choice and its disclosure. _Test: Mom
talks to the companion and publishes a family-only entry the hub cannot read._

**Phase 4 — the hard middle.** Rotation and restore flows, the contest UI, moving between locations,
notification polish, search over the local cache. _Test: Mom moves to her own domain and every reader
follows without touching the old hub._

**Phase 5 — the wider internet.** Interop through `bridge/` — ActivityPub, Nostr, AT Protocol, and
the IndieWeb, each holding its own stable key so protocol identity survives Open Feed key rotation.
This is interop, not spec, and nothing here changes a rule.

The companion is the product, so Phase 3 looking late deserves an answer: it is client-side, so it has
no technical dependency on Phase 2 and the two could swap. The order above ships the audience layer
first because an audience tier offered before the layer that encrypts it cannot be corrected afterward —
cleartext already served is served — while a companion that arrives a release later costs only time.

### Security

**Be honest about the trust model.** The hub sees who publishes, when, at what number, and who replies
to whom, on every tier including the encrypted one. The hub in the audience reads the content, like any
other reader. And the party that ships the client is trusted by every member who runs it — device
custody moves the keys off the server, and does not move them away from whoever wrote the code holding
them. Reproducible builds and a client a member can inspect or replace are the only answers to the
last one, and they belong on the roadmap rather than in a claim.

**The reader is the attack surface.** Everything it fetches is untrusted: enforce §9's bounds, apply
§2.4's hygiene rules on every body parsed, and render post text as text — never as markup — since a
post is written by someone who may be hostile and read by a family member.

**The hub's own obligations are small and non-negotiable:** serve back exactly the bytes it was given
(§2.3), refuse a profile or index that does not verify, refuse a name held under another anchor, never
ignore a number collision (§8.5), and answer cross-origin reads (§8.7).

### Limits

| resource                       | limit                                      |
| ------------------------------ | ------------------------------------------ |
| profile, index, or post fetch  | 1 MB (§9)                                  |
| chain                          | 64 links, a hard reader-side reject (§3.2) |
| recovery list                  | 32 leaves (§3.3)                           |
| redirects per fetch            | 5, never cross-origin (§9)                 |
| concurrent sockets per origin  | 10 (§9)                                    |
| photo upload                   | 10 MB; 10 per entry                        |
| companion conversation history | 30 days on the device                      |

Open Feed scales across identities rather than into items-per-identity, and the index is where that
boundary shows up: it is one file that grows by a line per post. A member with a decade of daily
entries is fine; a firehose is not what this is.

## 11. What we're not building

- **Encryption for everything.** Public entries are cleartext by definition. Drafts and companion
  conversations live on the device, so the hub does not hold them — but say what the app does hold
  rather than implying a guarantee the architecture does not make.
- **Algorithmic feeds.** Chronological only.
- **A global index.** Discovery is sharing a link or reading six words aloud.
- **Real-time chat.** A private message is a post encrypted to its recipients and listed in the
  sender's own index (§5.6); that is as close as this gets, and it is not messaging.
- **Ephemeral content.** Withdrawal is honest about what it does not do (§8.8), and "disappearing"
  would be a lie in a system where readers keep copies.
- **A moderation layer.** This is a family, and the trust set is the address book.

## 12. Notes for future development

**Interop is already built and lives in `bridge/`.** One Open Feed identity translated to ActivityPub,
Nostr, AT Protocol, and the IndieWeb, standard-library only, with each bridge holding its own stable
key. Read `bridge/` and `deploy/README.md` before designing anything in this area — the questions
in-memory tests could not answer have been answered against real instances.

**POSSE** — syndicating a member's public entries to their own accounts elsewhere — is the natural
first use of the bridge in this product, and it is additive: nothing about it touches the four kinds of
file.

**Real-time updates.** If polling latency becomes the thing members complain about, the answer is a
notification channel _beside_ the protocol, never a delivery path inside it. The index stays the
source of truth; anything faster is a hint that something changed.

**A second reader.** `examples/weekend-reader/` is an independent implementation of §7 and is one of
the two readers that verify `test-vectors.md`. A product change that makes the weekend reader wrong
is a protocol change, and belongs in the spec first.
