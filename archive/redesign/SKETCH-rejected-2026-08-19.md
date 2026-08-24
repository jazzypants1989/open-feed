# Open Feed 2 — straw-man draft

**Status: a Stage 3 straw-man, not a specification.** This is `PLAN.md`'s radical candidate,
written to be attacked. It is a complete RFC 2119 draft rather than a diff, because the three moves
it makes (R1, R2, R3) each *remove* things the current text spends its length patching, and a diff
would show the patches surviving. Nothing here has been implemented; the risky deltas are priced in
Stage 3 Sessions B/C and the decision gate is the owner's.

**The three moves, in one line each:**

- **R2 — there is no delivered column.** Everything an identity says is published in its own feed
  and committed by its own log. Privacy is a property of the *bytes* (§15), never of the channel.
  The inbox becomes a content-free **ping**.
- **R1 — the log replaces the manifest.** An append-only chain of typed events with periodic
  checkpoints, instead of a chain each of whose versions restates the whole live set.
- **R3 — witnesses.** Two hubs that read each other publish pins of each other's chains, which
  turns §5.3.1's *detectable* equivocation into *detected* between them.

**What this draft holds fixed** (`PLAN.md`, Stage 3): the exit triad (§3.4 migration, §4.5 recovery
keys, §14 export); §3.1's URL rules and §6's signing construction in substance; §15's envelope; and
`feed.json` as a plain JSON Feed anyone's existing reader can consume.

**Normative word count target: 8–12k.** Justification here is one sentence per rule; the attack
narratives and defeated alternatives that the current spec carries beside its MUSTs live in
`tmp/redesign/rejections.md` for now and in `RATIONALE.md` if this is adopted (Stage 4).

---

## How it works

Your identity is an HTTPS URL. At a fixed path under it sits one signed JSON file — the identity
document — with your profile, public keys, and one endpoint. Your content is a stream of signed
items: post, reply, like, and deletion are one object; an interaction is an item naming its
target. Everything you say is published; nothing is private for how it travelled. Content for a
chosen audience is encrypted, and published like the rest.

Beside the feed sits a signed **log**: an append-only chain of events — item added, item deleted —
each naming exact bytes. Nothing vanishes from a log; removal is an event. A periodic
**checkpoint** restates the live set, so a new reader starts there.

Both are chains: every version names the hash of the one before, and old versions stay served
forever. A reader pins the last version it verified; later reads must walk back to it. Two readers
comparing pins catch a host telling each a different story.

One signature construction throughout: detached, over canonical JSON bytes. If your host turns
hostile, a recovery key it never held proves your identity moved, and an export bundle carries every
signed byte elsewhere.

## What it guarantees

Nobody can alter, forge, or misattribute what you signed. A host cannot silently delete, rewrite,
or roll back what you published: removal is a signed event every reader sees, and readers comparing
notes catch a host lying differently to each. A message committed by its sender's log cannot be
suppressed by its recipient's host. You can always leave — prove your identity moved, and republish
your verified archive anywhere without your old host's permission. None of this is privacy: who
posts, when, and how often is public forever. Encryption hides the words and the audience, never
the posting.

## Glossary

- **item** — a signed JSON Feed entry; the one content object (post, reply, like, deletion alike)
- **identity document** — the signed file at your URL: profile, keys, endpoint
- **feed** — a JSON Feed of items, listed in the identity document, owned by one identity
- **log** — the signed append-only chain of add and delete events over a feed's items
- **checkpoint** — a log version that also restates the whole live set, so a reader can join there
- **pin** — a reader's stored (version, hash) of a chain; later reads must connect to it
- **relation** — the entry that makes an item a reply, like, repost, quote, or mention of a target
- **ping** — an unsigned "look at this URL" sent to an identity's endpoint; asserts nothing
- **recovery key** — an offline key the host never held; co-signs the proof that an identity moved
- **export bundle** — one archive of every signed byte an identity published; verifiable anywhere

---

## 1. Design Principles

1. **Identity in one signed document; content in one signed log.** Everything a verifier needs
   about an identity is in one signed JSON document at one conventional path. What that identity
   has published is committed by one separately-signed append-only log. Both are chained and pinned
   by the same discipline (§5, §9).
2. **One object model.** A like is an item. A reply is an item. A deletion is an item. One signed
   schema, one update mechanism, one delete mechanism, one verifier.
3. **The feed is the source of truth. Nothing exists only in transit.** There is no exception.
   Notification makes things fast; the published log makes them complete.
4. **Convention over configuration.** Fixed paths, one relation array, one `_openfeed` object
   holding everything this protocol adds to a JSON Feed item, a `_` prefix for extension fields, and
   a small registered vocabulary plus namespaced URLs for token values (§2.1).
5. **Byte-exact signing, one construction.** Documents are signed as published bytes (RFC 8785)
   with a single detached-JWS construction (§6). No verify-time normalization, no second signing
   scheme anywhere. Encryption is not a second construction: it changes what the content *is*, not
   how it is signed.
6. **Honest trust model.** Hubs that hold keys can impersonate their users, as email providers can.
   The chains defend against a *host* that turns malicious, a distinct threat from a *key custodian*
   (§13.2).
7. **Transparency, not privacy — and an exit instead.** History is retained permanently and served,
   every public document is world-readable, deletions leave a durable public record. Those are the
   properties that make equivocation detectable and forgetting impossible. Confidentiality is a
   layer (§15) and is only ever as strong as the recipient's key custody. What the core offers
   anyone who needs to get away from their host is **exit** (§3.4, §4.5, §14).

## 2. Terminology

- **Identity**: an HTTPS URL controlled by a person or group.
- **Identity document**: the signed JSON document at `{identity_url}openfeed.json`.
- **Item**: a JSON Feed item, signed, the universal content object.
- **Relation item**: an item carrying an `_openfeed.rel` array (§8).
- **Log**: the separately-signed, chained, append-only record of a feed's item events (§9).
- **Checkpoint**: a log version that also restates the folded live set (§9.2).
- **Chain**: a hash-linked sequence of versions of a document (identity document §5, log §9).
- **Pin**: a consumer's stored `(seq, hash)` observation of a chained document.

### 2.1. Token Vocabularies

> A **token-vocabulary value** is either a registered token from the set this specification
> defines, **or** an absolute URL naming a custom value (`https://example.com/ns#bookmark`).
> Consumers MUST preserve values they do not recognize and MUST NOT reject a document for carrying
> one; they MAY ignore them.

URL namespacing is collision-free without a registry. The rule binds `_openfeed.rel[].type` (§8),
feed `rel` (§3.2.1), and key `use` (§4.1). This document is the registry: the registered tokens are
exactly those the current text lists, adding one is an ordinary revision, and there is no external
registry.

Key `use` inverts the ignore rule deliberately: an unrecognized `use` causes an implementation to
ignore **the key**, not merely the value, so anything that key signed fails to verify. Everywhere
else an unknown token is inert data; on a key it is a restriction the verifier does not understand,
and honoring the entry while discarding the restriction would grant authority the publisher meant
to withhold (§4.6).

Extension **fields** are different: a `_` prefix marks them and does nothing to keep two extensions
apart, which is why everything this protocol adds to a JSON Feed item sits under one name (§7.2).

## 3. Identity

### 3.1. Identity URL

An identity is an HTTPS URL. Normalization, applied whenever identity URLs are stored or compared:

- MUST use the `https` scheme
- Domain lowercased and expressed as its **A-label** (punycode) form; default port (`:443`) removed
- Userinfo (`user:password@`) stripped
- Query string and fragment stripped
- Trailing slash appended if absent
- Path carried through **byte-for-byte as published**: case-sensitive, percent-encoding never
  decoded and never re-encoded, dot-segments not removed

| Input | Normalized |
|-------|------------|
| `https://Alice.Example/~mom` | `https://alice.example/~mom/` |
| `https://example.com:443/~alice/` | `https://example.com/~alice/` |
| `https://example.com/~alice?ref=x#about` | `https://example.com/~alice/` |
| `https://bob@example.com/~alice/` | `https://example.com/~alice/` |
| `https://münchen.example/` | `https://xn--mnchen-3ya.example/` |
| `https://example.com/%7Ealice/` | `https://example.com/%7Ealice/` (**not** `/~alice/`) |

A U-label host and its A-label are one name at every layer below this one, so comparing them as
strings makes one identity two. Percent-encoding is the reverse: decoding it is where the
equivalences stop being obvious, so this specification declines to decode at all. Producers MUST
publish identity URLs whose paths contain no dot-segments and carry only the percent-encoding
RFC 3986 requires. The rule is stated as string operations on the URL's parts because **a
general-purpose URL library cannot implement it** — every mainstream parser edits the path as a
side effect of parsing. A library MAY be used for the host's lowercasing and A-label form; the path
MUST be taken from the input string as published.

The identity URL SHOULD serve a human-readable page. Nothing in this protocol reads it.

**Every other URL this specification compares is normalized by the same rules minus the last two.**
Feed URLs, log URLs, the `to` of a relation entry's feed half, and the URLs a pin is keyed on are
compared after: `https` required; host lowercased and A-label, default port removed; userinfo
stripped; **fragment stripped, query kept**; path byte-for-byte, no trailing slash appended. The
trailing slash reads as nonsense on a file, and a feed may legitimately live behind a query while an
identity is a place whose query is noise. Where either side fails to normalize, the comparison is
unequal and the item is a copy (§7.5), never an error and never a match.

### 3.2. Identity Document

The identity document lives at `{identity_url}openfeed.json`.

```json
{
  "url": "https://pence.family/~mom/",
  "name": "Mom",
  "avatar": "https://pence.family/~mom/avatar.jpg",
  "feeds": [
    { "url": "https://pence.family/~mom/feed.json", "log": "https://pence.family/~mom/log.json", "rel": "primary" }
  ],
  "notify": "https://pence.family/~mom/notify",
  "seq": 7,
  "prev": "aNy3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "updated": 1739577600,
  "keys": [
    { "kid": "key-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "iat": 1736899200 },
    { "kid": "recovery-1", "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "recovery", "iat": 1736899200 }
  ],
  "_sig": "..."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The identity URL, the **same value in every version of the chain**, matching the URL it was fetched under (after normalization) or, at a derived URL (§5.4), the identity whose chain that URL belongs to. Author binding (§6.6). |
| `keys` | MUST | Array of JWKs (§4). At least one non-revoked, non-recovery key. |
| `seq` | MUST | Version counter, starts at 1, contiguous (§5). Advances on **identity** changes, not on publication. |
| `updated` | MUST | Publication time (Unix seconds). Never earlier than the previous version's; `seq`, not this, is the ordering key. |
| `_sig` | MUST | Detached JWS over the document (§6). |
| `prev` | MUST if `seq > 1` | Base64url SHA-256 of the full canonical bytes of the previous version, `_sig` and `_recovery_sig` included. |
| `feeds` | SHOULD (MUST for Level 2) | Feed entries (§3.2.1). Every feed this identity publishes, in one place. |
| `notify` | MAY (MUST for Level 3) | Ping endpoint URL (§10). |
| `name`, `bio`, `avatar`, `content_warning` | MAY | Profile metadata. |
| `successor`, `predecessor` | MAY | Migration links (§3.4). |
| `_recovery_sig` | MAY | A recovery co-signature (§4.5) for recovery-based migration (§3.4) and fork resolution (§5.5). |

Unknown fields MUST be preserved when re-serializing and ignored otherwise; extension fields SHOULD
use a `_` prefix. Every identity document is signed and versioned, and verification is
trust-on-first-observation (§5.3).

#### 3.2.1. Feed Entries

| Key | Required | Description |
|-----|----------|-------------|
| `url` | MUST | The feed's URL (JSON Feed 1.1, §7.1). No particular form required. |
| `log` | MUST | URL of that feed's own signed log (§9). MUST end in `.json`. |
| `rel` | SHOULD | `primary`, `activity`, `archive`, or a namespaced absolute URL (§2.1). Default `primary`. |
| `items` | SHOULD (MUST for Level 2) | `true` if this feed serves each committed revision at its derived item URL (§7.6) — the publisher's own signed statement about its own conformance, and what makes §9.4's withholding verdict reachable. Absent or `false` means a consumer asks for nothing and accuses nobody. |

- **Exactly one entry SHOULD carry `rel: "primary"`.** Where more than one does — stated or
  defaulted — the publisher has named no authoritative feed and a consumer MUST NOT pick between
  them; it reads every entry, which is what it does for the whole catalog anyway.
- **Each feed has its own log**, keyed by `feed_url`. An entry's `log` MUST NOT be the identity
  document's own URL, two entries MUST NOT name one log, and a log's `feed_url` MUST NOT change
  across versions of its chain — a verifier MUST reject such a version exactly as it rejects a
  `prev` mismatch, because it is the same claim: this is not a version of this chain.
- **Delisting is archival, not deletion.** A consumer MUST NOT read a vanished entry as content
  withdrawn; removing content requires a tombstone event (§9.1). A consumer that has pinned a
  feed's log SHOULD keep polling it after its entry disappears.
- **Every listed feed is logged.** There is no unproven feed, so §9.4's invariants apply everywhere
  without a per-feed conditional.

The identity document commits to each log by **URL**, not by hash: content freshness is proven by
the log's own signature and chain, so ordinary publishing does not re-sign the identity document.
The identity chain versions identity state, which changes rarely (5–20 versions over a lifetime);
the log versions content.

### 3.3. Fetching and Redirects

On every fetch this specification defines: follow at most 5 redirects; MUST NOT follow a redirect
to a different origin; the response MUST parse as JSON. A cross-origin redirect is never identity
equivalence — migration is expressed in-band (§3.4). The rule binds every fetch, because §5.3.1
compares observations of **one URL** and a chained document whose URL a pin is keyed on must not
serve its bytes from a second origin.

Every publicly-readable document MUST be served with `Access-Control-Allow-Origin: *`, because a
browser is a first-class Level 1 reader. It is a *transport* header, so a consumer outside a browser
MUST NOT refuse a document for lacking it: it surfaces the omission as non-conformance and reads the
document.

#### 3.3.1. Caching

- **Immutable.** Every derived version URL (§5.4) and derived item URL (§7.6) names its own content
  and MUST never change. Producers SHOULD serve them with a long freshness lifetime and
  `immutable`; consumers MAY cache them indefinitely.
- **Mutable tips.** An identity document, a log, and a feed serve the publisher's *current* claim.
  Producers SHOULD serve them with a short lifetime and an `ETag`; a consumer deciding a verdict
  MUST revalidate rather than answer from a stale cached copy. This reaches co-authors too:
  resolving another author's key means walking and pinning *that* author's chain, so a cache
  spanning polls is where §5.3.1 quietly stops firing on a shared board.

§12's one-hour ceiling on a cached identity document is a bound on **revocation**, not on staleness:
a key revoked after an entry was written stays accepted for the life of that entry.

### 3.4. Migration and Recovery

Migration and recovery are one operation — *this identity continues over there* — differing only in
**which key attests**. There are three occasions: you move hosts by choice, you lose your domain, or
**you leave a host that will not cooperate** (§14). The third is the one the mechanism must be
judged against.

To move from `https://old.example/~alice/` to `https://alice.new/`:

1. Establish the new identity, adding `"predecessor": "https://old.example/~alice/"`.
2. **Cooperative migration**: the old identity document publishes a new chain version adding
   `"successor"`. Consumers follow `successor` when both links exist and agree — each sits inside
   signed bytes, so the pair is a cross-signature verifiable against the old identity's pinned chain.
3. **Recovery**: the new identity document additionally carries `_recovery_sig`, a detached JWS by a
   **recovery key** (§4.5) committed in a pinned ancestor of the predecessor. Its `kid` MUST name
   the **predecessor's** identity URL, because that is where the key is committed and where §4.5
   resolves it.

A `successor` claim without a matching `predecessor` (or vice versa), unaccompanied by a valid
recovery co-signature, MUST NOT be treated as migration. **Two recovery-based migrations claiming
the same predecessor are unresolvable**, and a consumer MUST NOT follow either without out-of-band
confirmation: a recovery key cannot sign a chain version (§5.2 step 3), so a thief cannot take the
identity in place — what they can do is mint a competing successor that verifies identically. A
stolen recovery key therefore denies its owner an exit rather than granting anyone an impersonation.
Consumers with no prior pin can only treat a recovery-based migration as unverified.

**The back catalog moves byte-verbatim; do not re-sign it.** Previously-published items carry the
old feed's URL in their signed `_openfeed.feed_url`, so at the new home they would be copies (§7.5)
unless something reconciles them. Re-signing invalidates every hash held by every consumer's pin
and every pin a peer has shared — a wholesale rewrite of the past is the exact pattern §5.3.1
exists to make suspicious. Instead the verified migration carries the binding: republish
byte-verbatim, commit those same bytes in the new feed's log, and §7.5's canonical test honors the
predecessor. **Completeness follows as a MUST**: the successor's log genesis is bound to the
predecessor's final state by §9.4 invariant 4, so a migration is a continuation and not a reset.

**Predecessor equivalence.** One rule closes every dangling-reference problem a migration creates:
**for a consumer that has verified the migration, the predecessor's identity and feed URLs are
equivalent to the successor's own — transitively across a chain of verified migrations.** A consumer
MUST cap the migration chain it follows (RECOMMENDED: 32 hops) and MUST NOT revisit an identity
already on the path. Its direct consequence: a relation entry's `to` names its target as
`{feed_url}#{item_id}` (§8), and those references live in *other people's* signed items, which
nobody can re-sign — so a consumer MUST treat `{predecessor_feed}#{id}` and `{successor_feed}#{id}`
as the same target, or every reply ever received dangles at the new home. The other sites that apply
it (§4.4, §7.5, §9.4, §16.1) are consequences of this rule, not independent rules.

**A verified migration retires the predecessor's chains.** The consumer keeps its pins on them as
history — they are what a peer's older pin is checked against and what a recovery co-signature
resolves in — but stops advancing them and stops reading publication state out of them. This is not
implied by anything above: §5.3.1 is keyed on a document URL, so a predecessor chain continuing to
advance is not equivocation, and a consumer that keeps walking it inherits whatever the departed-from
host says next.

**Uncooperative departure.** Path 2 requires the old side's cooperation, and a host holding your
signing key can equally publish a `successor` you did not ask for. Path 3 is the exit path, and it
works without the old host on one condition: the recovery key must be one the host cannot produce
(§4.5). Where that does not hold, there is no exit. Departure does not retract what was published;
taking a *copy* with you is the export bundle's job (§14).

## 4. Keys

### 4.1. Key Entries

| Field | Required | Description |
|-------|----------|-------------|
| `kid` | MUST | Unique within this identity, MUST NOT contain `#` |
| `kty` | MUST | `OKP` |
| `crv` | MUST | **Signing keys**: `Ed25519` |
| `x` | MUST | Base64url public key (32 bytes) |
| `iat` | SHOULD | Issued-at (Unix seconds) |
| `revoked_at` | MAY | Revocation time (Unix seconds). Absent or `null` = active. |
| `use` | MAY | **Signing keys**: `sig` (default), `recovery` (§4.5), `delegated` (§4.6) |
| `alg` | MAY | If present, `EdDSA` |

A **signing key** is any key referenced by the `kid` of a `_sig`. The `crv`/`use` constraints bind
signing keys only; extensions MAY define keys with other values in the same array, as §15 does.
Implementations MUST ignore keys with unrecognized `kty`/`crv`/`use`. Algorithm confusion is closed
by §6.2, which requires verifiers to reject any signature whose referenced key's `crv` is not
`Ed25519`. A key the core ignores is a key the core does not **audit**, so an extension defining one
MUST state who checks it and what revoking it means.

Key and chain fields use Unix seconds (JOSE); content fields use RFC 3339 strings (§7.2).

### 4.2. Key Identifiers

The full key identifier is `{identity_url}#{kid}`. Verifiers split at the **last** `#`: the left
side is the identity URL (normalize it — normalization strips fragments, so the split happens
first), the right side is the `kid`. Key ownership is structural: the identity named either lists
the key or it does not.

**A `kid` permanently names one key.** Within an identity, `(identity_url, kid)` is bound to the key
material first published under it and MUST NOT be rebound in any later version. Verifiers MUST
compare key **material** across a chain hop, not `kid`s, and MUST **reject** a version that rebinds
one — the chain does not advance past it, for the same reason as a `prev` mismatch. Rebinding passes
every other check: a version keeping `kid: key-1` and swapping its `x` satisfies both §5.2's "valid
in the previous version" and §5.3 step 1's "listed in the document itself", because the label is what
those rules match on.

### 4.3. Rotation

Publish a new chain version adding the new key; sign new content with it; optionally set
`revoked_at` on the old key. Revocation ends a key's *authority*; delisting it ends *verifiability*,
and §6.5 resolves a `kid` against the **current** identity document. A key therefore MUST remain
listed while any artifact it signed is still served — which, since retention is permanent (§5.4),
means a signing key is in practice never dropped. A key MUST also remain listed in any chain version
whose `_sig` it produced.

**More than one active signing key is ordinary, and it is the answer to device loss.** §5.2 asks a
continuity key only to have been valid in the previous version, so an identity MAY list several
active `sig` keys — one per device. A holder whose phone is lost signs the next version from their
laptop and revokes the lost key in it. It is a *second device*, not a second keypair on the one
device.

### 4.4. Revocation

- Signatures on content whose effective signing time (§6.5) is after `revoked_at` MUST be rejected;
  before, they remain valid.
- Because content timestamps are self-reported, a key thief can backdate. A time the verifier
  vouches for itself therefore **bounds** the self-reported one — the check runs against the
  **later** of the two — and never replaces it. Consumers SHOULD record the wall-clock time each
  **exact revision** was first observed committed in a signed log, keyed on
  `(author, id, _openfeed.version)`, and use it as that bound.
- Bounding **per revision** is what makes the record worth keeping. Keyed on `(author, id)` alone
  and substituted for the claim, a thief of a revoked key publishes version 4 of an id first
  observed years ago, the stale observation stands in for the fresh claim, and the mechanism makes
  revocation *weaker* for every revision after the first.
- Two scoping rules keep this from rejecting honest content. Apply it only where the consumer holds
  observation **history** for the pair; with none, first contact is TOFU here as everywhere. And
  apply it only to items canonical by the ordinary `_openfeed.feed_url` test (§7.5), since an item
  canonical only by the predecessor exception arrived byte-verbatim from a migration and its signing
  necessarily predates that event. The `author` half is subject to predecessor equivalence (§3.4),
  and an id-half match across two *different* authors is one record only across a **verified**
  migration, never merely because the `id` matches.

Revocation limits damage from honest rotation far more than it stops an active thief (§13.10).

### 4.5. Recovery Keys

A key with `"use": "recovery"`:

- MUST NOT sign regular content or logs
- MUST be stored offline, not on the hub — and SHOULD be held where whoever operates the identity's
  host cannot reach it either, because §13.2's hostile-custodian adversary is defined by access, not
  by protocol position
- SHOULD be generated at identity creation
- Co-signs a migration for domain-loss recovery (§3.4) and MAY co-sign a chain version for fork
  resolution (§5.5)

`_recovery_sig` is a **single co-signature**, and an extension MUST NOT redefine it as one share of
a threshold (k-of-n) scheme. A verifier that does not implement the threshold reads `_recovery_sig`
as what this section says it is and follows the migration, so a thief holding one share gets to
choose which verifier adjudicates their theft: the extension fails **open** at exactly the moment it
exists to guard. A threshold scheme carrying its shares in a *different* member and marking its keys
with an undefined `use` fails **closed** and is simply out of scope: k-of-n resists the theft of one
share and, in the same move, makes the exit depend on reaching another holder, which is the wrong
trade for §13.2's adversary.

An identity MAY list **several** recovery keys, any one of which may co-sign. That is 1-of-n, it
fails closed, and it buys availability and nothing against theft: every holder can move the identity
alone, and where two act, both branches carry a valid co-signature, which §5.5 calls unresolvable.

**A pin alone is not enough to follow a recovery.** A pin is a `(seq, hash)`; a recovery key is in
the *bytes*, and the case this mechanism exists for is exactly the one where fetching those bytes
fails because the domain is gone. A consumer that intends to honor recovery-based migration MUST
therefore retain, at the version it verified, a **recovery pin**: the ordinary `(url, seq, hash)`
plus the **recovery keys** that version committed and the **feed URLs** it listed. It can only
record one while the predecessor is still readable — which is before the move, with no second
chance. Naming those two fields rather than "the identity document" is the difference between a
hundred bytes per key and §13.4's whole 100 KB, held forever, for every identity ever read.
Retaining the whole document is a permitted superset. A consumer MUST use the **most recent**
predecessor version it has verified, not any older ancestor it retains: reading recovery state out
of an older one would undo every revocation published since.

Verifiers MAY reject a recovery-based migration while the original identity serves a **conflicting**
chain. They MUST NOT reject it merely because the original identity is *still being served* —
treating "still reachable" as grounds would hand a hostile custodian a veto over their user's exit
by doing nothing at all.

**Generation and possession.** Where the recovery key is stored is not the rule that matters; **who
generates it and who has ever held it** is. An implementation hosting identities on behalf of others
(§12) MUST provision each hosted identity with a recovery key **generated on the member's own device
and never transmitted to the host**. Where a deployment's onboarding cannot meet this, it MUST
disclose that the operator can reproduce the user's recovery key, because that user has no exit.

**Generation alone is not enough: the commitment must be checkable.** A host that publishes the
identity document also chooses what it says, and first contact is TOFU. It can serve the *member's*
client a genesis carrying the member's real recovery key and serve *everyone else* one carrying a
key the host holds; nothing in the member's own view is wrong, and at exit the member's co-signature
fails against every consumer's pin. The defence is comparison and it happens once: an implementation
hosting identities MUST get the member's **genesis** `(seq, hash)` and recovery-key fingerprint
compared outside its own custody — presented to the member for out-of-band comparison, or witnessed
(§16.2) by an identity the operator does not control. One relative comparing one hash defeats the
attack.

### 4.6. Delegated Keys

A key with `"use": "delegated"` is a signing key whose holder is not trusted with the identity
itself:

> A delegated key MAY sign any artifact this specification defines **except a version of the
> identity document** — never as a continuity key, never at genesis — and it is not a recovery key.
> Items and logs are within its authority; keys, revocation, migration links, and profile are not.

The deployment it exists for is §12's: the member's device generates a **root** signing key and a
recovery key, and the host receives only a delegated key. The host publishes on the member's behalf
without ever being able to add a key, un-revoke one, publish a `successor`, or alter the delegation.
What remains is two things rather than one: a host holding a delegated key can impersonate the
member's *content* until the delegation is revoked and, because a tombstone is an ordinary item, can
**delete** content the member published. That deletion is not silent — §9.1's tombstone event is
signed and every pinned consumer sees it — but it is not preventable either. Where that matters, the
member's own root key can sign tombstones on their device while the host still advances the log.

The marker is a `use` token rather than an extension field because the two fail in opposite
directions: §4.1 makes an unrecognized `use` ignore the key, so a delegated key fails **closed** at a
verifier that predates this section, while an extension field on an ordinary `sig` key would fail
**open**.

## 5. The Version Chain

A compromised host could roll the identity document back to an older version or serve different
versions to different readers. The chain makes both tamper-evident to any consumer who has seen the
identity even once. This chain versions **identity state**; content is protected by the same
mechanism applied to the log (§9), so ordinary publishing leaves the identity chain short.

### 5.1. Chain Fields

`seq`, `prev`, `updated`, `_sig`, and optionally `_recovery_sig`. `prev` hashes the *full published
canonical bytes* of the predecessor, signature fields included.

There is **one hashing rule in this protocol**, used everywhere a document names another document's
bytes: *base64url SHA-256 of the full published canonical bytes, signature fields included.* It is
the same value in `prev`, in a log's event entries (§9), and in a pin.

**And one spelling of base64url.** Everywhere this specification writes base64url — `prev`, log
entries, pins, `_openfeed.sha256`, key `x`, and both segments of a `_sig` — the encoding is the
RFC 4648 §5 URL-safe alphabet with **no padding**, and a producer MUST emit and a consumer MUST
require the single canonical spelling: no `=`, no `+` or `/`, no characters outside the alphabet, and
no trailing bits that re-encode to a different string. A consumer MUST reject any other spelling
rather than decode it. Requiring it only of values compared as strings would leave the one that is
*decoded* accepting several spellings of one signature: an item's `_sig` sits inside a feed, which
§6.3 exempts from the arrival rule, so whoever controls the serving path appends one `=`, the
signature still verifies, the bytes no longer hash to what the log commits, and an attacker holding
**no key** convicts an honest publisher of the one thing the chains exist to detect.

### 5.2. Producing a Version

1. Start from the current version; apply changes
2. `seq` += 1; `prev` = hash of the previous version; set `updated`, which **MUST NOT be earlier
   than the previous version's**. `seq` is the ordering key; `updated` is a timestamp, not an
   ordinal — two versions may share one. The prohibition on *backward* drift is load-bearing:
   `updated` is the effective signing time every revocation check on a chained document resolves
   against, and §9.4 invariant 3 separates lag from violation by asking whether a log's `updated` has
   passed a given item. A strict increase would additionally forbid two versions in one second, which
   costs liveness (a burst of tombstones, a three-version rotation, an NTP correction) and buys
   nothing: a publisher determined to hold content in unfalsifiable lag satisfies strictness by
   adding one second per version.
3. Sign with a **continuity key**: a key that was valid (non-revoked, non-recovery, non-delegated)
   in the *previous* version
4. Retain the previous version, served byte-identically at its derived URL (§5.4)
5. **Record the `(seq, hash)` of the version just produced**, and make that record available to the
   identity's owner. An identity cannot audit its own chain without a record of what it actually
   published; where a host holds a signing key this is the owner's only means of noticing a version
   they did not ask for. It is weak alone; the durable check is comparison by other people (§5.3.1,
   §16).

The continuity key is often revoked *in the very version it signs*; that is normal rotation, and
validity is judged against the previous version's state. Genesis has no predecessor and is signed by
a non-revoked key it contains, under the same exclusions.

### 5.3. Consumer Enforcement (Pinning)

A consumer that has verified an identity document at `(seq: N, hash: H)` MUST store that pin. On any
later fetch:

1. Verify the new document's `_sig`; the signing key named by its `kid` MUST be listed in the
   document itself.
2. Walk `prev` links back to `(N, H)`, fetching intermediate versions from their derived URLs. At
   each hop, verify that version's `_sig`, confirm its bytes hash to the value its successor's `prev`
   names, confirm its signing key was valid in *its* predecessor — hash linkage alone is
   insufficient, since a fabricated intermediate could introduce an attacker's key — and confirm its
   `url` names **this** chain's identity. That last check closes what the others leave open: a holder
   of a listed key could otherwise publish, into its own chain, a version claiming to be somebody
   else's identity, and every other check on the walk passes on the forgery's own terms.
3. Reject if `seq` decreased, if any `prev` mismatches, or if the compare rule below fails.

**`seq` is contiguous: version *N*'s `prev` names version *N−1* and nothing else.** The walk descends
by `prev` and has no other way to name the next version to fetch, and §5.4's derived URLs are indexed
by `seq`, so a gap is a URL that must `404`.

First contact is TOFU: accept and pin. A consumer that cannot connect its pin to the current document
MUST treat the chain as unverifiable rather than silently re-pin. The consumer separately pins the
**log** at its own `(seq, hash)` and walks it by the identical procedure (§9.3).

#### 5.3.1. The compare rule

> Given any two observations of the same chained document URL at the same `seq` with **different**
> hashes, the publisher has **equivocated**. A consumer MUST treat this as an attack on that chain:
> it MUST NOT silently prefer either version, and MUST surface it.

This is the rule the whole transparency claim rests on: the chains make equivocation *detectable*,
and detection is exactly this comparison. A verifier that pins but never compares has built the
evidence and thrown it away.

**What counts as an observation.** A chained document's *tip* URL serves whatever the publisher
currently claims, while a particular `seq` is also served byte-identically forever at its derived
URL; an identity document is additionally its own key source, so anyone who can write the tip URL can
mint a key and self-sign a version at any `seq`. An observation is therefore a version obtained from
that `seq`'s **derived** URL, or one whose walk connected it to the consumer's pin. A document that
connects to neither MUST NOT fire this rule; it is an unverifiable fetch and §12's transient ladder
governs it. Without this qualification anyone able to answer a single request could permanently deny
a consumer an identity. It has an implementation consequence, stated because violating it is silent:
versions encountered during a walk MUST NOT be recorded as observations until the walk has connected
to the pin.

**A peer's shared pin (§16) is not itself an observation.** It is a signed assertion that its author
*says* it saw something. A disagreeing peer pin is a reason to **fetch that `seq` from its derived
URL and check**; what the consumer then holds is its own observation, and this rule applies to that.

**What follows surfacing.** Once §5.5 resolution has been run and failed to pick a branch, the
response SHOULD be uniform: retain the pin without advancing it, accept no further version of that
chain until the divergence resolves or the consumer deliberately re-pins, and keep rendering what was
already verified. An equivocation impeaches the chain's future, not the bytes already checked.

### 5.4. Retained Versions

Producers MUST retain every prior version of a chained document and serve it at a **derived URL**:

> Take the document's own URL, strip the trailing `.json`, and append `/{seq}.json`.

Every chained document's URL MUST end in `.json`, so the derivation is total. Prior versions MUST be
served **byte-identically** to how they were published. A producer SHOULD **also** serve the
*current* version at its own derived URL, from publication rather than once superseded: it costs one
extra file and makes §5.3.1's settling fetch available at the `seq` a consumer most often pins. A
producer doing this MUST write the derived copy **before** the tip. The derived path is reserved.

The URL is *derived* rather than named in a signed field because signed bytes are immutable: a
publisher who ever moved hosts would retroactively break the walk for every consumer whose pin
predates the move.

Consumers SHOULD cap the versions walked per update (RECOMMENDED: 1000) and the total history bytes
fetched (§13.4). **On the identity chain that cap is also a denial available to whoever holds a
continuity key** — a custodian that advances the chain past the cap between polls makes the identity
permanently unverifiable to every pinned consumer, having forged nothing. It is bounded in practice
by the chain being short by design, so a chain racing past a thousand is itself the finding.
Delegated custody (§4.6) removes the capability outright.

### 5.5. Fork Resolution

Equivocation detection reveals *that* a chain forked, not *which* branch is honest. A version MAY
carry `_recovery_sig`: a detached JWS by a recovery key committed in a pinned ancestor, computed over
the co-signing bytes of §6.3. A thief of the online key cannot produce it, so verifiers detecting a
fork SHOULD prefer the branch carrying a valid recovery co-signature; a fork where neither branch
carries one — or both do, which puts the recovery key itself in question — is unresolvable and SHOULD
be flagged for manual review.

## 6. Signatures

### 6.1. Format

Detached JWS Compact Serialization with **unencoded payload** (RFC 7515 + RFC 7797):

```
base64url(header)..base64url(signature)
```

The payload is the canonical JSON bytes (§6.3). The JWS Signing Input is:

```
ASCII(BASE64URL(UTF8(header)) || '.') || canonical-json-bytes
```

The signature covers **header and payload**. Signing only the payload MUST NOT be done: it leaves
`alg` and `kid` unauthenticated. This is the **only** signing construction, in the core and in every
extension.

**One key, one construction.** A key that signs under this construction MUST NOT produce signatures
under any other, and no key material may be shared between the two: two suites that disagree about
what is covered can each accept bytes the other's signer never meant to authorize. A foreign suite
gets its **own keypair**, which MAY be listed in `keys` as an extension key (§4.1).

### 6.2. Header

```json
{ "alg": "EdDSA", "b64": false, "crit": ["b64"], "kid": "https://pence.family/~mom/#key-1",
  "typ": "openfeed-item+json" }
```

All five fields MUST be present with exactly these `alg`/`b64`/`crit` values. `typ` names the **kind
of document being signed** and MUST be exactly one of `openfeed-identity+json`, `openfeed-log+json`,
or `openfeed-item+json` (Appendix A). Verifiers MUST reject unrecognized `alg`, `crit` entries they
do not understand, an unrecognized or absent `typ`, and signatures where the referenced key's `crv`
is not `Ed25519`. **Header parameters beyond these five are permitted and MUST be ignored** unless
named in `crit`.

**`typ` puts the document's kind inside the signed bytes.** A verifier picks the author-binding
carrier by kind (§6.6) and resolves revocation against a different field by kind (§6.5 step 7), so
the same signed bytes read as two different claims depending on what a verifier believes it is
holding. A verifier MUST still take the kind from context and never from the bytes; `typ` is the
check that the two agree, a comparison rather than a decision.

### 6.3. Canonicalization

1. Remove the document's **top-level** `_sig`. When the signature being computed or checked is a
   **recovery co-signature**, remove that field as well. Removal is top-level only: a `_sig` nested
   anywhere inside is ordinary data and MUST be left in place, because a recursive strip would leave
   an embedded signed document uncovered by the outer signature and freely swappable under it.
2. Serialize per RFC 8785: UTF-8, no whitespace, keys sorted, ES6 number formatting

**`_sig` therefore covers `_recovery_sig`, and that asymmetry is load-bearing.** The co-signature's
payload omits both fields; `_sig`'s payload omits only `_sig`. Two consequences follow, and the order
is one of them: **co-sign first, then sign.** Were the two payloads identical, whoever controls the
serving path could simply **delete `_recovery_sig`** — on a successor's genesis that is the exit
being denied in silence, and the resulting message is indistinguishable from an honest document that
offered none.

Strings are signed **byte-exact as published** — no Unicode normalization at sign or verify time.
Producers SHOULD emit NFC.

**Parser equivalence is part of this construction.** An **item** has no byte range of its own — it is
one member of an array inside a feed — so its "full published canonical bytes" are what a verifier's
own parser and serializer produce. Four rejections keep two implementations equivalent, and each is a
MUST:

- **Duplicate member names** (I-JSON, RFC 7493). This binds every signed JSON in the protocol, the
  JWS protected header included.
- **Lone surrogates**, at parse and at serialize.
- **The member name `__proto__`**, which this specification reserves and no document may carry. In
  one widespread runtime the name is an accessor rather than a data property, so an object rebuilt
  from a parse silently drops it from its own serialization — and therefore from the signature
  payload and every pin — while every later read still sees it. Appended to somebody else's
  already-signed item it survives every other check defined here, which is worse than a forgery
  because nothing is forged.
- **Numbers whose RFC 8785 canonical form is an integer-form token outside ±(2⁵³−1).** A wider
  integer type preserves such a token exactly while a double implementation rounds it, and two
  conforming-looking verifiers then hash different payloads with no other symptom. The test is on
  the canonical form, never the source token. The consequence is worth stating: a document carrying
  such a number anywhere is unreadable, and the ordinary sources are identifiers and timestamps, so
  producers SHOULD carry those as strings.

**A chained document MUST arrive as its own canonicalization.** A consumer MUST reject an identity
document or a log whose body is not byte-identical to the canonicalization of the value parsed from
it. Without this rule a verifier pins a normalization of what it was served rather than the bytes it
was served. Feeds are excluded and cannot be included: a feed is neither signed nor chained, and its
items are covered by parser equivalence instead — except where a producer serves them individually,
which gives them a body of their own and brings them under this rule (§7.6).

**Byte-identical means byte-identical, and the case that catches people is a trailing newline.**
Signing computes the exact canonical bytes, so serving them is *keeping* that string rather than
producing a second one; the only way to fail is to serialize twice. The rule is not relaxable:
exempting the current tip would let a publisher who published non-canonical bytes serve those same
bytes at the derived URL, where the exemption no longer covers them — one `seq` with two byte
strings, which §5.3.1 reports as equivocation against a publisher who did nothing wrong.

### 6.4. Signing

1. Remove `_sig` — and `_recovery_sig` too, if this is the co-signature; canonicalize → payload bytes
2. Build the header, whose `typ` names the kind being signed; `header-b64 = BASE64URL(UTF8(header))`
3. Sign `ASCII(header-b64 || '.') || payload-bytes` with Ed25519
4. Set `_sig` = `header-b64 || '..' || BASE64URL(signature)`

### 6.5. Verification

1. Extract the signature; remove `_sig` (and `_recovery_sig` if this is the co-signature);
   canonicalize → payload bytes
2. Parse header; enforce §6.2
3. **Kind binding**: the header's `typ` MUST name the kind this verifier took from context. Reject
   otherwise. It runs here, before anything is fetched, because every step below reads a different
   field depending on the answer.
4. Split `kid` at the last `#` → identity URL + key id
5. **Author binding**: the `kid` identity URL MUST equal the claimed author (§6.6) after
   normalization. Reject otherwise.
6. Fetch the identity document at `{identity_url}openfeed.json`; enforce pinning (§5.3); find the key
7. If the key has `iat`, verify it predates the content's **effective signing time** — for items,
   `date_modified` if present else `date_published`; for logs and identity documents, `updated`
8. Verify the key was not revoked before the effective signing time
9. Verify the Ed25519 signature over the reconstructed Signing Input

The effective-signing-time rule lets content be legitimately re-signed after rotation: bump
`_openfeed.version`, set `date_modified`, keep `date_published`.

### 6.6. Author Binding

Every signed document carries its author's identity URL **inside the signed bytes**, and the claimed
author MUST equal the `kid`'s identity URL. This prevents republishing someone's signed item under a
different name: the binding travels with the bytes.

**`_recovery_sig` is bound differently and deliberately**: on a migration document its `kid` names the
*predecessor* (§3.4), because the key it references is committed and resolved there. That is the only
place in this specification where the two signature fields answer to different identities.

For **logs** and **identity documents** the carrier is the `url` field. Which carrier applies is
selected by what the verifier is verifying — a fact of the verification context, never of the bytes —
because §3.2 obliges a chained document to carry unknown members intact, so an `authors` extension
member on an identity document is conformant data and a verifier that sniffs for it reads its author
binding out of a field the signer chose freely. Context decides; `typ` confirms.

For **items** the carrier is the item-level `authors` array, which MUST contain **exactly one entry**
whose `url` is the signer's identity URL; feed-level `authors` are not covered by item signatures and
MUST NOT be relied on. A multi-author *feed* still works because every item names its own single
author. The exclusion of JSON Feed 1.1's multi-entry item `authors` is deliberate: a second entry is
either a duplicate of the signer or an attribution to somebody who signed nothing, and §13.6 says
never to attribute unsigned content. Clients MUST attribute solely to this entry. The **displayed
name** comes from that identity's own pinned identity document where the client holds one, and
otherwise from this entry's `name` — both sit inside signed bytes, but the identity document is
current while an item's `name` is frozen at signing time. Profile metadata an item cannot carry comes
from the identity document or from nowhere. A client MUST NOT display a name drawn from any other
source.

Note the limit. It covers what the item carries **by value**. It does not and cannot cover what the
item carries **by reference**: anyone may put someone else's attachment URL, or a copy of their text,
into their own freshly-signed item. Items MUST also include `_openfeed.feed_url`, the containing
feed's URL, in the signed payload, which drives the canonical/copy rule (§7.5).

## 7. Feeds and Items

### 7.1. Feed Document

A feed MUST conform to JSON Feed 1.1. Content-Type `application/feed+json` or `application/json`;
reject non-JSON. Like every public document, a feed MUST carry `Access-Control-Allow-Origin: *`.
Required: `version`, `title`, `feed_url`, `items`; feed-level `authors` MAY be present for display
and carry no authority.

**A feed is a view.** It is neither signed nor chained: what a feed says about itself — its
`feed_url`, its `next_url`, its ordering — is unsigned and MUST NOT be treated as an assertion about
anything (§7.5). Its *items* are signed, and what is *live* is decided by the log (§9). A feed is how
items are served in bulk and how a Level 0 reader with no Open Feed implementation at all reads the
content, which is the whole reason it stays a JSON Feed.

A feed is owned by the identity whose identity document lists it in `feeds`, and its contents are
committed by the log that entry names. Feeds MAY contain items from multiple authors — a family
board — since every item is independently signed and attributed.

**What shared ownership costs a contributor**, since it points the wrong way: the *owner's* log
commits the board, so a contributor whose items are canonical there has no completeness proof of
their own. A contributor who wants the §9 guarantee for their own words SHOULD publish them to their
own logged feed and let the board carry **copies** (§7.5).

### 7.2. Items

Every item MUST include:

| Field | Description |
|-------|-------------|
| `id` | Globally unique, permanent (UUID URN or tag URI RECOMMENDED). MUST NOT contain `#` |
| `date_published` | RFC 3339 `date-time` (profile below) |
| `authors` | Single-entry author binding (§6.6) |
| `_sig` | Detached JWS (§6). **Top level**, not inside `_openfeed` |
| `_openfeed` | Object. Every other member this specification defines on an item lives inside it |
| `_openfeed.feed_url` | The containing feed's URL |
| `_openfeed.version` | Integer, starts at 1 |

**One object holds everything this specification adds to a JSON Feed item.** An item is somebody
else's object model, and `_`-prefixed members are a *shared* extension space with no collision rule.
The names this protocol needs — `version`, `deleted`, `rel`, `enc`, `pins` — are the most generic
available, and left bare each is a name a second extension may reasonably want; because they sit
inside signed bytes, the failure is a signature over a value one extension did not mean. `_sig` is
the one exception: it is not a member this protocol adds to a JSON Feed item, it is the envelope the
item arrives in, and it is the same envelope on an identity document and a log. Unknown members
inside `_openfeed` are preserved exactly as unknown members outside it are.

**Content timestamps are RFC 3339, not "ISO 8601".** `date_published` and `date_modified` MUST be an
RFC 3339 `date-time` whose offset is `Z` or a numeric `±HH:MM`; producers SHOULD use `Z`. Naming the
larger standard would admit `24:00`, comma decimal separators, ordinal and week dates, and a bare
`+01` offset, which real parsers read differently or refuse. This is the effective signing time §6.5
resolves revocation against, so a consumer MUST reject a timestamp outside the profile rather than
fall back to a lenient parse — at least one widespread fallback reads an unrecognized string as
**local** time, making an item's signing time a function of where its reader is sitting.

Every item MUST carry at least one of `content_text` / `content_html`. A content-less relation item
satisfies this with `content_text: ""`, exactly as a tombstone does. Consumers MUST preserve unknown
**members**, `_`-prefixed or not.

### 7.3. Versioning and Tombstones

To edit: bump `_openfeed.version`, set `date_modified`, re-sign. Same `id` forever;
`(author, id, _openfeed.version)` names an exact signed revision, and feeds carry only the latest.
To delete: publish a **tombstone** — same `id`, bumped version, `date_modified` set,
`_openfeed.deleted: true`, re-signed. A tombstone MUST contain **exactly** these fields and no
others:

`id`, `authors`, `date_published`, `date_modified`, `_openfeed.version`, `_openfeed.deleted`,
`_sig`, `content_text: ""`, plus `_openfeed.feed_url`, `_openfeed.rel`, and `_openfeed.unverified`
**if and only if** the item being tombstoned carried them.

Every other field MUST be absent. This is an allowlist on purpose: a denylist naming today's known
content fields would let a conformant tombstone retain a title, a tag, or an extension payload
carrying the very thing the author deleted, and would need editing for every future content type.

Consumers seeing a valid tombstone SHOULD drop cached content and retain the tombstone; higher
`_openfeed.version` wins over any replayed earlier revision. Tombstones SHOULD stay in the feed for
≥30 days, and the log remembers them for the life of the chain (§9). Deletion is best-effort:
consumers that never re-fetch cannot be forced, and attachment *bytes* are removed by the host, not
by the tombstone.

### 7.4. Attachments and Pagination

Attachments use JSON Feed's `attachments`: the metadata is inside the signed bytes, the referenced
bytes are not. Each entry MUST carry `_openfeed.sha256`, the base64url SHA-256 of the referenced
bytes, and consumers MUST treat an attachment lacking one as unverified content — never as part of
the signed record. Without it whoever controls those bytes, including the host, can swap the photo
under a signed item undetectably, which for a media-first deployment is the largest integrity gap
available.

Pagination uses JSON Feed's `next_url`; feeds SHOULD carry at least the 50 most recent items. A
consumer bounds its own walk: §13.4's per-read caps cover the pages together, a consumer MUST NOT
re-fetch a `next_url` it has already read in the same pass, and it MUST NOT treat `next_url` as an
assertion about anything. Nothing makes the page sequence terminate or the pages disjoint.

### 7.5. Canonical and Copied Items

An item is **canonical** only in the feed its signed `_openfeed.feed_url` names. The same signed item
may legitimately appear elsewhere as a **copy**, still verifiable as *authored* by its signer, but
carrying **no authority over current publication state**.

- A consumer MUST verify an item's `_openfeed.feed_url` matches the feed URL it was **fetched from**
  (after normalization) — the URL the consumer requested, never the `feed_url` member inside the feed
  document, which is unsigned like everything else at feed level. A mismatch marks the item a copy.
  **One mismatch is not a copy:** where the `_openfeed.feed_url` names a feed of a **predecessor**
  identity and the consumer has verified that migration, the item is canonical here (§3.4). A
  consumer that has not verified the migration correctly sees a copy, which is the safe reading.
- To determine whether a copied item is currently live, consult the log of the feed where it is
  **canonical** — ordinarily the feed its `_openfeed.feed_url` names, but the **successor's** where
  a verified migration has moved it. Resolving to the predecessor's log instead would let an
  abandoned host tombstone a departed identity's whole back catalog for every reader of every copy.
- An `id` is permanently bound to a single `_openfeed.feed_url`. The same `id` MUST NOT be signed
  with two different values: the bytes would differ while `(author, id, _openfeed.version)` claims to
  name one exact revision. Cross-posting uses a **new item** with a fresh `id` carrying a `repost` or
  `quote` relation. A verified migration is not an exception: the item keeps its single signed
  `_openfeed.feed_url`, and what changes is only where those unaltered bytes are treated as canonical.

Together with the log this closes both omission and injection: the log proves **presence**, so a host
cannot drop your content, and `_openfeed.feed_url` proves **exclusivity**, so a host cannot inject or
resurrect your content by copying it into its own feed. Availability is weaker than it looks: a
follower may serve its cached copy while your host is down, but §6.5 step 6 resolves the signing key
against the author's **current** identity document on the same host that is down. A consumer MAY
complete the check from state it holds itself — a pinned identity document, or the retained version
its recovery pin records — which is exactly the standing this section gives a copy.

**Bridged and unverified items.** Content conveyed from another protocol (Appendix C) cannot be a
native signed item, because no one holds the foreign author's key. It is signed by the **gateway**
that observed it and MUST carry `_openfeed.unverified: true` — no exception and no second form. Its
`authors` entry names the **signer**, never the foreign author. It SHOULD carry `external_url`, which
on an unverified item MAY be a non-HTTP URI; consumers MUST NOT dereference it.

### 7.6. Derived Item URLs

A feed serves its items in pages; a log names each one's exact bytes. Nothing lets a consumer ask for
**one item**, and §9.4's withholding verdict is the rule that suffers for it. A Level 2 producer MUST
therefore also serve each committed revision individually:

> Take the feed's URL, strip a trailing `.json` if it has one, and append `/items/{hash}.json`, where
> `hash` is the §5.1 value its log event names.

**Addressed by hash rather than by id, and that is the whole of the design.** An id-addressed
derivation needs a percent-encoding rule for item ids, which §3.1 declines to specify: an id may be a
tag URI, a UUID URN, or a URL, so encoders disagree about where its path segment ends, and a `404`
from the wrong derivation is indistinguishable from withholding — the verdict this mechanism exists
to make honest. A base64url hash is URL-safe by construction and needs no rule at all.

- **The body MUST be byte-identical to the bytes the log commits.** §6.3's arrival rule applies, and
  this is the one place an item has a byte range of its own — it supplies the check parser
  equivalence otherwise has none of.
- **A fetch is self-verifying.** The URL names its own content hash, so a consumer knows it received
  what it asked for with no log lookup and no signature check. Authorship is unaffected.
- **The producer declares it with `items: true`** (§3.2.1). Without a declaration the asymmetry below
  fails open against precisely the adversary §9.4 exists for: a host that serves a log and answers
  `404` beneath `/items/` is indistinguishable from a static host that predates this rule. The
  declaration sits in the signed identity document, so a custodian can withdraw it only by advancing
  the identity chain in front of every pinned reader.
- **Producers MUST serve it; consumers MUST NOT require it.** It is a MUST on the producing side
  because §9.4's withholding verdict is otherwise unreachable — a consumer reading one page learns
  only that a committed revision is not in the page it holds, which is the ordinary state of every
  paginated reader. It is not a MUST on the consuming side because a consumer must go on reading
  publishers who predate this rule.
- **The path is reserved** and revisions accumulate rather than replace, so a superseded revision
  stays retrievable. Retention beyond the current revision is a producer's choice.

## 8. Interactions Are Items

There is no separate interaction object and no separate interaction channel. An interaction is an
item carrying an **`_openfeed.rel` array**: one entry per relation, each an object with a `type` and
a target `to`.

```json
{
  "id": "urn:uuid:...",
  "authors": [{ "url": "https://pence.family/~dad/" }],
  "content_text": "Those cookies were delicious!",
  "date_published": "2025-12-07T16:00:00Z",
  "_sig": "...",
  "_openfeed": {
    "feed_url": "https://pence.family/~dad/feed.json",
    "version": 1,
    "rel": [{ "type": "reply", "to": "https://pence.family/~mom/feed.json#urn:uuid:550e8400-..." }]
  }
}
```

| `type` | Meaning | Content |
|--------|---------|---------|
| `reply` | Reply to the referenced item | REQUIRED |
| `root` | Thread root of a nested reply; accompanies `reply` (§8.1) | (governed by `reply`) |
| `like` | Endorsement of the referenced item | NONE (add `_emoji` to the entry for reactions) |
| `repost` | Share of the referenced item | NONE |
| `quote` | Quote of the referenced item | REQUIRED |
| `mention` | Mentions the referenced identity | REQUIRED |
| `witness` | Carries pins of the referenced identity's chains (§16.2) | NONE |

**`type`** is a registered token or an absolute URL (§2.1). **`to`** is a single target URI. Where the
target is an item **in this protocol** it MUST be `{feed_url}#{item_id}` — resolvable structurally by
splitting at the last `#`, unambiguous because ids never contain `#`. A bare URL is permitted only
where the target is *not* an Open Feed item. One form rather than two, because the failure of the
second is silent. For `mention` and `witness`, `to` is an identity URL. Multiplicity is expressed with
**multiple entries**, never an array in `to`. Entries are **open objects** whose unknown keys MUST be
preserved — this is where per-relation extension and bridge round-trip data live.

**Every relation item is published**, in its author's own feed, committed by its author's own log,
like every other item. A `like` is not special, and there is no delivered column for it to live in
(§11). Clients SHOULD NOT render content-less relation items as posts; a publisher SHOULD segregate
them into a separate **activity feed** — a `feeds` entry with `rel: "activity"`, logged like any
other — so a Level 0 reader does not render bare likes as posts.

The consequence is stated rather than discovered: on a cleartext feed, *who liked what and when* is a
permanent public fact. Where the interaction graph is what must not be public, the answer is to
encrypt the item and seal its relations (§15.4), not to invent a private channel.

### 8.1. Threading

A `reply` entry's `to` points at the **parent**. When the parent is not the thread root, the item
SHOULD also carry a `root` entry, so that a reader following the thread from its root can find deep
replies. Threads are trees built by walking parents; clients display flat or nested and SHOULD cap
walk depth, since loops are possible in malicious data — treat re-visited references as leaves.

Polling the participants' feeds is what makes a thread complete; a ping (§10) is what makes it fast.

### 8.2. Updating and Deleting Interactions

Same as any item: edit = bump `_openfeed.version` + re-sign; unlike or retract = tombstone. To
*change* a reaction, tombstone the old item and publish a new one with a fresh `id`; `id` reuse
across different relations is not permitted.

## 9. The Log

The log commits an identity to a feed's contents. Each feed has its own log, keyed by its `feed_url`
and named by that feed's `feeds` entry (§3.2.1). It is a **separately-signed, chained, append-only**
document: signed by a key valid in the identity's chain, carrying its own contiguous `seq` and `prev`
hash-linkage. It is the **same pin-and-walk discipline as §5, applied to content instead of
identity.** Publishing an item advances the log and never touches the identity chain.

```json
{
  "url": "https://pence.family/~mom/",
  "feed_url": "https://pence.family/~mom/feed.json",
  "seq": 412,
  "prev": "Jq3l73-Z_cRTwvLApVhCPi19Pxx3Kgn7XN-uw8vfk0",
  "updated": 1739577600,
  "events": [
    ["add", "urn:uuid:550e8400-...", 3, "czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"],
    ["del", "urn:uuid:99aa2222-...", 4, "8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI"]
  ],
  "_sig": "..."
}
```

- `url`: the owning identity (author binding, §6.6); MUST match the identity whose `feeds` entry
  names this log
- `feed_url`: the feed this log commits to. Committed items ordinarily carry a matching
  `_openfeed.feed_url`, and a verifier MUST NOT reject a log for committing one that names a
  **predecessor** feed instead (§3.4)
- `seq`: contiguous version counter, starts at 1; a consumer rejects any log whose `seq` is below its
  pin
- `prev`: **MUST if `seq > 1`.** The §5.1 hash of the immediately preceding version
- `updated`: publication time (Unix seconds), never earlier than the previous version's; the
  effective signing time for the revocation check (§6.5)
- `events`: **MUST.** An ordered array of events (§9.1). MAY be empty, which is how a publisher
  advances a chain to prove it is alive without publishing anything
- `state`: **MAY.** A checkpoint (§9.2)
- `prev_checkpoint`: **MUST on a checkpoint whose chain has an earlier one** (§9.2)
- `_next_update`: **MAY.** Unix seconds, strictly greater than `updated` (§9.5)
- `_sig`: detached JWS (§6) by a chain-valid key

### 9.1. Events

Each event is a four-element array `[op, id, version, hash]`:

| `op` | Meaning |
|------|---------|
| `add` | The revision `(id, version)` is live from this log version onward, and its bytes hash to `hash` |
| `del` | The revision `(id, version)` is a tombstone (§7.3), and the item is deleted from this log version onward |

`hash` is the §5.1 rule applied to that revision's full published canonical bytes, `_sig` included.
`version` is the item's `_openfeed.version` and is not redundant beside the hash: it makes §9.4's
"per-item versions never decrease" checkable **without holding either revision's bytes**, since two
differing hashes at consecutive events are otherwise indistinguishable from a rollback.

**The log commits to bytes, not only to a version**, and the hash is not optional. A serving-path
attacker who cannot sign is fully contained by `version` alone, but a **key custodian** is not
(§13.2): holding the signing key, it can sign item `X` version 1 as one thing for you and another for
your sister, and with a version-only log both readers see byte-identical logs, agreeing pins, and no
fork — undetectable in principle, not merely unnoticed. The hash closes that with the mechanism that
already exists, since two readers comparing pins now diverge at the same `seq`.

**There is no removal event, and that is the point of the shape.** An event, once published, is
committed by every later version's `prev` and served forever at its derived URL, so content cannot
silently vanish from a log: unpublishing something requires a `del` event that every pinned consumer
sees. The invariant the previous design had to state and check per hop is here a property of the
document.

**The folded state.** A consumer's view of what is live is the fold of the events in `seq` order:
`add` sets the live revision for an id, `del` moves it to deleted. Ids are never dropped from the
folded state — a deleted id stays deleted and its tombstone stays named, so deletion history is
verifiable for the life of the chain, and an `add` for an id already `del`ed is a resurrection and a
violation (§9.4 invariant 2).

### 9.2. Checkpoints

A log version MAY carry `state`, a full restatement of the folded live and deleted sets:

```json
"state": {
  "items": { "urn:uuid:550e8400-...": [3, "czai6zQ_04DBDS7NgdaOeaUCbA_f4YGR2bzuambgNa8"] },
  "deleted": { "urn:uuid:99aa2222-...": [4, "8HgMi021TdOCqbaGYnTY5UJzDdWf7JO1nlp-wt1QWTI"] }
}
```

A version carrying `state` is a **checkpoint**. Rules:

- `state` MUST equal the fold of every event in the chain up to and including this version's own
  `events`. It is a **restatement, not a claim**: any consumer holding the segment can falsify it,
  and one that finds a mismatch MUST treat it as a violation (§9.4 invariant 1).
- A checkpoint MUST carry `prev_checkpoint`, the §5.1 hash of the previous checkpoint of the same
  chain, unless it is the first. Checkpoints therefore form a sparse chain over the dense one, and
  they are the only skip mechanism in this protocol.
- A consumer **MAY join a chain at a checkpoint** rather than at genesis: it takes `state` as its
  starting view and pins that version. That is the same trust-on-first-observation §5.3 already
  defines, and it is what keeps first contact O(live items) rather than O(all events ever).
- A consumer walking back to a pin **MAY follow `prev_checkpoint`** where both endpoints are
  checkpoints, verifying each landing exactly as it verifies a `prev` hop, and it SHOULD then fetch
  the version immediately above that landing and confirm its `prev` names the same hash. A checkpoint
  hash and a `prev` are two signed statements about one version's bytes: without the check, a
  publisher can aim a forged sparse chain at skipping readers alone.
- **Skipping observes fewer versions, and that costs the skipper as well as everyone else.** It makes
  a weaker witness for others (§16), and a publisher can hide a transient publication from every
  skipping reader while remaining fully detectable to a linear one. Nothing is forged by it — the
  intermediate versions are retained and served — so it is a limit on detection, and a consumer with
  reason to audit a range walks it linearly.
- Publishers SHOULD emit a checkpoint at a cadence that keeps a first-contact read and a
  long-absence walk inside §13.4's budgets, and SHOULD pin the emission to **absolute** seqs (the
  largest multiple of a fixed power of two below the current `seq`) so that every reader lands on the
  same versions: §5.3.1 needs two observers at the **same** `seq` to compare anything.
- **A consumer MUST NOT follow a checkpoint link on the identity chain**, which has none. An identity
  document is its own key source, so a freshly-fetched tip is authenticated by nothing until the walk
  connects it to the pin, and following an anchor offered by that tip would let a serving-path
  attacker holding no key splice a forged tip onto an honest history. A log resolves its signer in the
  already-pinned identity chain, so its tip is authenticated *before* its links are read.

### 9.3. Chain Mechanics

Producing and verifying a log version follow §5.2 and §5.3 exactly, with these substitutions:

| §5 (identity document) | §9 (log) |
|---|---|
| Document at `{identity_url}openfeed.json` | Document at the `log` URL of a `feeds` entry (§3.2.1) |
| Signing key listed in the document itself | Signing key valid in the identity chain of `url`, found in that identity's pinned document |
| Changes = keys, profile, endpoints, migration links | Changes = `events` |
| Reject on `seq` decrease, `prev` mismatch, compare-rule failure | Same, plus the invariants (§9.4) |

Prior versions are retained at derived URLs by §5.4 — same rule, same byte-identical requirement.

**What each hop of that walk checks**, because two of them differ from §5.3's. The tip's `_sig` MUST
be verified; so MUST the `_sig` of any version reached by a checkpoint link, and of the `seq+1`
companion that confirms it. A version reached by an ordinary `prev` hop is the other case: its bytes
are already hash-committed by a successor the consumer verified, in a run terminating at the signed
tip, so verifying its own `_sig` is OPTIONAL. That relaxation is log-only and MUST NOT be carried to
§5.3, where an identity document is its own key source and the per-hop check is the whole defence.

**The tip's signing key MUST NOT be revoked in the current identity document**, whatever the log's
`updated` says. On the identity chain revocation is enforced structurally, because §5.2 step 3 judges
a continuity key against the **previous version's** state; a log resolves its signer by §6.5 instead,
which compares `revoked_at` against a self-reported `updated` that only has to exceed its
predecessor's. Without this rule a holder of a revoked key extends the content chain indefinitely.
Versions reached by an ordinary `prev` hop are unaffected and MUST remain valid. The operational
consequence is a duty: **revoking a log-signing key means advancing that log with a valid one.**

### 9.4. Invariants

A violation MUST be surfaced, and the response is graded because the **evidence** is. Invariants 1,
2 and 4, and invariant 3's passed-over rule, compare signed bytes the consumer already holds, so they
take §5.3.1's response: hold the pin without advancing it, accept no further version until a human
intervenes, keep rendering what was already verified. Invariant 3's *first* clause is different in
kind: a feed serving a revision the log has not committed is a claim about **two objects fetched at
two moments**, and nothing makes those reads atomic. A consumer SHOULD re-fetch the feed once,
revalidating, before convicting; a verdict that misfires against honest publishers is one nobody keeps
running. Producers close their half: **write the feed before the log that commits it.**

1. **A checkpoint restates; it does not decide.** Where a consumer holds the events a checkpoint
   covers, `state` MUST equal their fold. A mismatch is a violation. (Content cannot silently vanish
   without one: §9.1 gives the log no removal event, and every event is committed by every later
   `prev`.)
2. `seq` is contiguous and `updated` never decreases (§5.2); per-item versions never decrease, and an
   `add` for an id whose latest event is a `del` at the same or higher version is a resurrection and a
   violation. The `seq`/`updated` asymmetry is §5.2's: `seq` orders the chain, so it must move;
   `updated` is a clock reading, and two versions published in one second carry one value.
3. A served feed MUST NOT contain an item version lower than the log's folded state, and MUST NOT
   contain live items the log has not committed — **except** transiently newer content, which is *lag*
   and is treated as unverified-pending rather than as a violation. **Two rules bound the pending
   state, and neither needs history.** First, being passed over is observable directly **for an item
   the log's own owner signed**: a log version whose `updated` is later than such an item's effective
   signing time has demonstrably advanced past it. That scope is load-bearing — effective signing time
   is self-reported *by the item's author*, and a feed may carry several, so unscoped the test convicts
   the log's publisher on a number somebody else chose. Second, consumers SHOULD apply an absolute
   ceiling (RECOMMENDED: 7 days) and treat anything uncommitted beyond it as unverified regardless of
   the publisher's rhythm; the ceiling is deliberately the consumer's own, because a bound derived from
   observed cadence catches only a publisher *deviating* from its rhythm and gives a first-contact
   consumer no deadline at all. Both bounds run in one direction, so the other needs one too: a
   consumer SHOULD treat an item dated more than **24 hours ahead of its own clock** as a violation
   rather than as lag, because both tests invert under a future-dated item and a publisher stamping
   next year would otherwise hold its whole feed in permanent pending. An item whose `id` and
   `_openfeed.version` match a committed event MUST hash to that event's value; a mismatch is a
   violation, not lag.
4. **Relocation does not reset the chain.** §5.3.1 is keyed on a document URL, so a *new* log URL is a
   new chain and a fresh first observation — which would let a publisher discard content by renaming a
   file. Where a `feeds` entry's `log` URL changes, or a verified migration moves the feed to a
   successor identity, every `id` live in the last folded state the consumer observed MUST appear in
   the new chain: live at the same or a higher version, or deleted. A consumer holding no prior pin has
   nothing to carry across.

Consumers verify incrementally — any item read from the feed is checked against the folded state with
one lookup and one hash.

A third state sits between lag and violation. An item the log commits but the feed never yields — a
`404` at its §7.6 URL, a page that ends where the item should be — is **withheld**. No invariant is
broken and nothing is forged: the consumer knows an exact revision exists, knows its hash, and cannot
obtain the bytes. **Withholding is asserted only about bytes the consumer actually tried to obtain**,
because "committed but not in the page I hold" is the ordinary state of every paginated reader. A
consumer holding a partial view reports the item as not yet seen, which accuses nobody. **A publisher
that declared `items: true` and then declined is the case that matters**: that is the publisher's own
signed statement that the revision is individually addressable, so a consumer holding the declaration
MUST report the item as withheld. Without this the mechanism is switched off by whoever it was built
to catch.

**The feed is not thereby retired.** A §7.6 URL is derived from the hash its log event names, so an
item the log has not yet committed **has no such URL**, and on any cadence there is a standing window
whose content is reachable through the feed and nowhere else.

### 9.5. Freshness, and the attack of doing nothing

Every attack the chains detect is a **mutation**. One mutation is the null one: **serve the last
honest version forever.** A host that stops advancing a member's log, and goes on serving that frozen
version and its matching feed, satisfies every invariant, every pin, and every signature. To every
reader, *this host has stopped publishing you* and *you have had nothing to say* are the same
observation.

> A log MAY carry **`_next_update`**, a Unix-seconds deadline by which its publisher undertakes to
> have advanced that chain. A consumer SHOULD treat a chain as **stale** once
> `min(_next_update, updated + own ceiling)` has passed (RECOMMENDED ceiling: 7 days). Stale is an
> **unverified** state: the consumer holds its pin without advancing it, keeps rendering what it
> already verified, and MUST NOT treat staleness as equivocation.

A malformed value — anything but an integer strictly greater than `updated` — makes the **tip**
unreadable, where the publisher can correct it by advancing, and MUST be read as absent in retained
history, which nobody can correct.

Three properties, and the third is why this is not a bound derived from observed cadence. The
declaration sits **inside the signed bytes**, so a serving-path attacker cannot extend it. It can only
**tighten** the consumer's own ceiling and never loosen it, so a publisher declaring a ten-year rhythm
is stale in seven days exactly like one declaring nothing. And it gives a **first-contact** consumer a
deadline, which a derived bound cannot.

**What it does not reach: a key custodian.** That adversary advances an empty log — no events, a fresh
`updated`, a fresh `_next_update` — and is perfectly punctual while committing nothing the member
writes. No rule about timestamps constrains the party signing them. This closes the freeze against an
attacker who **cannot sign**, and against a host that has merely stopped. Against §13.2's terminal
adversary what remains is the member's own record (§5.2 step 5), comparison by other readers
(§5.3.1), and witnesses (§16.2). An implementation MUST NOT describe the field as making a host unable
to withhold.

### 9.6. Cadence and Retention

Retained log history grows as **O(total events)** — every event exactly once, plus a per-version
header, plus whatever checkpoints the publisher emits. A family publishing three items a day for ten
years writes roughly 11,000 events: single-digit megabytes of retained history, before anyone has
posted a photo. Nothing here needs feed rotation to stay bounded, and rotation is available (open a new
feed with its own log, list it in `feeds`, mark the old one `rel: "archive"`) as an organizational
choice rather than a scaling requirement. **Rotate by adding a `feeds` entry, never by repointing an
existing one** — repointing a `log` URL is a relocation and §9.4 invariant 4 then requires the new
chain to carry forward every id the old one held.

A log MAY commit a batch: publish items as they are written and advance the chain on a schedule. The
cost is worth naming precisely: uncommitted content is content a host can serve to one reader and not
another without forking anything, so a long cadence weakens §9's guarantee rather than merely delaying
it. Publishers SHOULD keep the window one their readers would accept, SHOULD advance immediately for a
tombstone, and SHOULD declare the rhythm with `_next_update`. §9.4 invariant 3's ceiling is not the
publisher's to choose: a slower cadence does not buy a longer window, it converts honest lag into what
every conforming reader reports as unverified.

**A partial advance does not exist.** Every version MUST carry an `add` event for every item the feed
is already serving whose effective signing time precedes that version's `updated` and which the folded
state does not already hold at that revision. A publisher on a daily cadence that advances at two in
the afternoon carrying only a tombstone has produced a version whose `updated` has demonstrably passed
every item it published that morning, which invariant 3 reads as *passed over*.

## 10. Notification

### 10.1. The ping

An identity MAY publish a `notify` endpoint. Its entire job is to say *look at this URL*.

```
POST {notify}
Content-Type: application/json

{ "look": "https://pence.family/~dad/" }
```

- The body MUST be a JSON object with a `look` member naming an **absolute HTTPS URL**: an identity
  URL, a feed URL, or a log URL. Any other member MUST be ignored. Bodies over 1 KB MUST be refused.
- **A ping is unsigned and asserts nothing.** There is no author, no dedup, no replay window, no
  revocation check, and no signature to verify, because nothing in a ping is acted on except the
  decision to read a URL — and reading it verifies everything (§5, §6, §9). A ping cannot be forged
  into a claim, because it makes none.
- The endpoint MUST allow cross-origin requests:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

- **The only responses are `202` and `429`.** `202` means the ping was accepted for consideration and
  says nothing about what the receiver will do; `429` MUST carry `Retry-After`. There is no code for
  "not relevant", "unknown identity", or "blocked", because every such code is an oracle about the
  receiver's state answered before any sender has been authenticated — and no sender ever is.

### 10.2. What a receiver may do with one

> **A ping MUST NOT be the cause of an outbound fetch.** A receiver MAY use a ping to bring forward a
> poll of a chain it **already tracks**. For a URL it does not track, it MAY queue the URL for its
> owner's attention and MAY fetch it — but only at a rate its own policy sets independently of the
> volume of pings it receives.

This is the whole of §10's security argument, and it replaces a nine-step verification pipeline. The
hazard a push channel creates is that an unauthenticated stranger chooses an origin the receiver
dials; bounding the fetch rate by the *receiver's* budget rather than the sender's send rate removes
the amplification entirely, and §13.4's fan-out caps already bound the rest. Rate-limit pings by source
IP and by the origin named in `look`.

A receiver SHOULD apply §13.5's fetch discipline to anything it does dereference, and MUST NOT
dereference a `look` URL that is not HTTPS.

### 10.3. What replaces delivery

Nothing does, and nothing has to. An interaction is a published item (§8), so:

- **Completeness** is the log's, exactly as for any other item. A dropped delivery used to be
  invisible; a suppressed item is now the withholding verdict (§9.4) against the *sender's* host,
  detected by the ordinary read path.
- **Recovery from a missed ping** is polling, which is what a consumer does anyway. A ping is an
  optimization and its loss costs latency and nothing else.
- **Reaching a stranger** costs the stranger a decision. Someone who does not read you can be pinged;
  whether they look is theirs to choose, and a ping carries nothing that could pressure the choice.
- **Blocking** is not reading. There is no inbound content to accept, moderate, or discard, so there
  is no block list a harasser can probe.

## 11. Privacy

The core has no privacy mechanism, and that is a design outcome rather than an omission.

### 11.1. One channel

Everything an identity says is published: in a feed, committed by a log, world-readable. There is no
second channel and no unlisted mode.

|  | **Published, cleartext** | **Published, encrypted** (§15) |
|---|---|---|
| Who can read it | Everyone | The audience the author wrapped to, and their key custodians |
| What is public | Everything | Existence, time, size, slot count, and the author (§11.2) |
| What it keeps | Pin, walk, compare, completeness proof (§9), export (§14), migration (§3.4) | All of the same |

**A third cell does not exist: published but not public.** Serving audience-varying bytes forfeits
single-valuedness and with it the whole pin-and-walk discipline.

> **A completeness proof is a public artifact.** Its power is that strangers can compare it. Content
> whose **existence** must be private therefore cannot have one. Content whose **bytes** are opaque
> still can — encryption and the log compose fine.

Content whose existence must be private is not published here at all. That is a real exclusion and it
is stated plainly: this protocol has nowhere to put a message whose *occurrence* must not be visible.

### 11.2. What is never hidden

On a published feed, encrypted or not, these are cleartext by construction: `id`, `date_published`,
`date_modified`, `authors`, `_openfeed.version`, `_openfeed.feed_url`, plus the log's record of
publication cadence and deletions. That is who posts, when, and how often.

What encryption **does** hide, and what the current design does not, is the rest: §15.2's blinded slot
tags mean an observer cannot learn *who* an encrypted item was wrapped to, and §15.4 requires an
encrypted item's relations to be sealed, so an observer cannot learn *what it replies to*. The
interaction graph of an encrypted conversation is therefore private; its rhythm is not.

**Hiding a feed's existence is not offered.** A deployment can host one at an unguessable URL, but
that is a bearer secret with the properties of one — it leaks through logs, referrers, and history
sync — not a protocol mechanism.

### 11.3. Audiences

> **Any audience larger than one requires a membership decision. It does not require a membership
> document.**

Three arrangements, in ascending price:

- **An author-held list.** The author holds the list locally and wraps to it (§15.2). Nothing leaves
  their client. This is not group membership and a deployment MUST NOT present it as one: every reply
  goes back to the author alone, because a replier cannot wrap to a list they cannot read.
- **An author-declared audience** (§15.3). The author names the identities they wrapped to *inside the
  sealed plaintext*, so the recipients — and only the recipients — can read it and wrap a reply to the
  same people. The membership decision is still the author's alone; what changes is that the replier
  can act on it instead of guessing.
- **A published membership roster.** Required when someone other than the author must *convene* the
  audience. **This is out of scope permanently, not pending a later section**: this specification
  defines no membership document, will not define one, and a mechanism of that kind MUST NOT be
  presented as part of it.

The price of the third is why its exclusion is permanent. A roster is chained (so members can pin it)
and encrypted (so it is not public), which means: membership *stale* for every replier between
versions; a custodian who can *withhold* a version and silently shrink the audience; keys published to
everyone it admits and rekeyed on every removal; a binding between roster and items or an author can
retroactively change who a past item was addressed to; and a per-member identity fetch at the moment
of replying. That is a second protocol's worth of trust machinery, and the honest form for it is a
**separate specification layered on this one**, which needs nothing added here to become possible. An
author-declared audience escapes six of those seven, which is why it is admissible where a roster is
not: it is not a document and not shared state, so there is nothing to chain, withhold, pin, or be
stale between.

### 11.4. Rendering untrusted content

Item content from anyone other than the local user is untrusted, whether it arrives by polling a
stranger's feed or by any other route. Receivers MUST either render only `content_text`, escaped, or
aggressively sanitize `content_html` through an allowlist. Never render untrusted HTML as-is. Content
marked `_openfeed.unverified` MUST be displayed distinctly and never cached as verified.

## 12. Conformance

Each level lists **behaviors**. It does not restate the **shapes** those behaviors act on: what an
identity document is (§3.2), what a key entry is (§4.1), how a chain field is formed (§5.1). Roughly
half of this specification's MUSTs live in those definitions, and conforming to a level includes them.

**Level 0 — Consume (non-verifying).** A plain feed reader that fetches the JSON Feed and ignores
`_sig` is a valid consumer; it just gets no authenticity guarantee. Level 0 has no requirements and is
named so that the additive relationship to the existing feed ecosystem is explicit.

**Level 1 — Read.** MUST: fetch and parse identity documents, feeds, and logs; **reject a chained
document whose body is not its own canonicalization** (§6.3) — named because it is a consumer MUST
that is not a signature check; verify signatures (§6), including each header's `typ` against the kind
being verified; enforce revocation, including the rule that a log tip's signing key is not revoked
(§9.3); **pin and enforce both chains** and apply the compare rule (§5.3.1); enforce the canonical/copy
rule (§7.5); check items against the log's folded state, hash included (§9.4); normalize every URL it
stores or compares (§3.1); reject a content timestamp outside §7.2's profile rather than fall back to a
lenient parse; **report a revision it cannot obtain from a feed whose entry declares `items: true` as
withheld rather than as unseen** (§7.6); **enforce a bound at each point in §13.4**, treating a breach
as `unverifiable` and never as a violation; handle unknown fields and relation types gracefully.
SHOULD: honor content warnings; follow pagination — and a consumer that does MUST bound its own walk;
**treat a chain past its deadline as stale** (§9.5), holding its pin rather than advancing it. MAY
cache identity documents, and MUST NOT hold one longer than 1 h or answer a verdict out of one without
revalidating (§3.3.1).

Pinning is a MUST because it is what the §13.2 guarantees are made of: a verifier that checks
signatures but keeps no pin re-establishes trust on first use at every fetch, and a host holding the
signing key can hand it any history it likes, forever, without forking anything. The one exception is
narrow — **a consumer with no persistent storage cannot pin.** Such a consumer remains conformant to
everything else at this level, but MUST NOT be presented as providing the §13.2 guarantees.

The canonical/copy rule is a MUST for a narrower reason: the log check above **depends** on it, since
without §7.5 a consumer cannot tell which log governs an item.

**Level 2 — Publish.** Level 1, plus MUST: serve an identity document (signed, chained, retaining
prior versions at their derived URLs); serve at least one feed, listed in `feeds`, of signed items;
serve a signed, chained log for **every** feed entry, with its own retained prior versions; serve every
committed revision at its derived item URL **and declare it with `items: true`** (§7.6) — named here
because a Level 1 MUST that no publisher supplies the evidence for is a rule that reads as satisfied
while never running; produce valid signatures and canonical JSON; generate unique ids; serve every
public document with `Access-Control-Allow-Origin: *`. SHOULD: emit checkpoints at a cadence that keeps
first contact and a long absence inside §13.4 (§9.2); declare each log's cadence with `_next_update`.
Fully static-hostable: every Level 2 artifact is a file, and signing happens at build time.

**Level 3 — Notify.** Level 2, plus MUST: a `notify` endpoint with §10's rules; **emit item-carried
pins for identities whose chains this sender already tracks, on the items addressed to them** (§16).
Emission is named at this level because §13.2's transparency claim is made of it: the compare rule is a
Level 1 MUST that the core otherwise supplies nothing to compare.

**Hosting identities on behalf of other people** cuts across all levels and carries its own MUSTs. The
hazard is custody, not capability. Any implementation hosting identities for others MUST:

1. Provision each hosted identity with a recovery key (§4.5), generated on the member's own device and
   never transmitted to the host.
2. Get the member's **genesis** `(seq, hash)` and recovery-key fingerprint compared outside its own
   custody — presented to the member for out-of-band comparison, or witnessed by an identity the
   operator does not control (§16.2) — and record and expose the `(seq, hash)` of every later chain
   version it produces for them (§5.2).
3. Serve that owner a complete export bundle on demand (§14).

**The recommended custody architecture extends requirement 1 to the signing key itself.** The member's
device generates a root signing key alongside the recovery key, and the host receives only a
**delegated key** (§4.6). A host SHOULD be built this way. One that instead holds members' root keys
MUST disclose that it can rewrite their identity — add keys, un-revoke, publish a `successor` — and not
merely impersonate their content. The `successor` is the sharpest item on that list: §4.5 lets a
verifier reject a recovery-based migration while the original advances a competing claim, so a host
holding the root key can **contest** a departure rather than merely decline it. A host that never held
such a key cannot answer at all.

Requirement 2 is not paperwork: without it, requirement 1 can be satisfied to the letter and defeated
in full (§4.5), and that is as true under delegated custody, since the host still serves the documents
and first contact is still TOFU.

**Transient failures.** If an identity-document or log fetch fails transiently, cache the failure and
retry (1 h, 4 h, 24 h) before permanent rejection.

## 13. Security Considerations

1. **Signature limitations.** Signatures prove a key signed bytes — not when, not who a person is, not
   that content is true.
2. **Hub trust vs host trust — a gradient, not a binary.** Four adversary tiers sit on it, and a fifth
   does not.
   - **Key custodian** (hub holds the user's signing key): forward impersonation is unpreventable —
     the email trust model. What it cannot do is *silently rewrite the past* against a pinned
     consumer. Be precise about which half of that the core delivers alone. Rollback and omission
     *relative to your own pin* are caught by every conforming Level 1 consumer, unaided.
     **Per-consumer equivocation is different**: a host that serves each reader a consistent private
     branch never produces two conflicting observations at any single reader, so no reader catches it
     alone however diligent. What supplies the second observation is people — an out-of-band
     comparison (§4.5, §12 requirement 2), item-carried pins riding traffic that already flows (§16),
     or a witness (§16.2). So equivocation is *detectable* rather than *detected* by default, and
     *detected* between parties who witness each other. A deployment where nobody ever compares has
     the first half of this tier's guarantee and not the second.
   - **Delegated custodian** (hub holds only a delegated key, §4.6): forward impersonation of
     *content* remains until the member revokes the delegation, and so does tombstoning it; keys,
     revocation, and migration are out of the host's reach. What this tier does **not** claim: where
     the custodian also distributes the member's client, every client-side guarantee is bounded by
     that client, and §12 requirement 2's comparison outside the operator's custody is the one check
     that survives it.
   - **Serving-path compromise** (CDN, static bucket, web tier): the most common real-world
     compromise. The attacker cannot sign, so chain and log give **full integrity**: no undetectable
     omission, rollback, or injection.
   - **Dumb host, external signer** (build-time signing on static hosting; client-side keys): full
     integrity against the host by construction.
   - **Hostile custodian who is also the counterparty** — off the gradient, because it is not defined
     by technical position. The operator is *inside the audience* and *controls the exit*; a family
     hub run by a relative is the ordinary case. This adversary reads everything the host can read,
     sees the metadata no mechanism hides, is not deterred by transparency because they are entitled
     to look, and can decline to let the user leave. Confidentiality does not rescue it (§11.3), since
     this operator supplies the client and generates the keys at onboarding unless §4.5 is followed.
     What the protocol offers is **exit**: §3.4, §4.5, §14, real only if all three hold at once.
     Implementations SHOULD NOT market audience control or encryption to this user as protection from
     their own host. Two things this adversary can do to the exit itself: a custodian holding the
     member's root signing key can **contest** a departure rather than merely decline it, which
     delegated custody removes outright; and a stolen recovery key **denies an exit** rather than
     granting an impersonation, which is why the recovery key's location *is* the exit.
3. **TLS and CORS.** Everything HTTPS; validate certificates; every publicly-readable document carries
   `Access-Control-Allow-Origin: *`.
4. **Resource limits and scale.** A consumer MUST enforce a bound at each point below and SHOULD use
   these figures, which are RECOMMENDED rather than fixed — but note the cost of choosing your own,
   because several places read a cap as normative and two consumers with different caps can reach
   **different security verdicts** about one publisher. A cap breach is always `unverifiable`, never a
   violation. Caps: identity document 100 KB / 100 keys; log version 1 MB; checkpoint `state` 1 MB
   (~10k live items at roughly 96 bytes per entry — the live-set bound); feed page 10 MB / 1000 items;
   ping body 1 KB; chain versions walked per update 1000; **total history bytes fetched per update:
   the greater of 10 MB and 20× the current version's size**, counted as **decoded** bytes; concurrent
   fetches per origin 10; `feeds` entries processed per identity read 20; distinct author identities
   resolved per feed read 50. The last two bound a consumer's **fan-out**, which the per-document caps
   do not: one conformant identity document can list hundreds of feeds and one feed page can name a
   distinct author per item, each costing an identity fetch, a chain walk, and a *permanent* pin. Pins
   created for identities encountered only as item authors in someone else's feed MAY accordingly be
   evicted, and every other record keyed on such an identity may go with it — under two rules that
   make eviction safe rather than merely cheap. **Evict whole identities, never old entries**: §4.4's
   record is a *lower* bound on when a key could have signed, so the oldest observations are the
   strongest and an evictor ranking by age destroys the mechanism it is bounding. **And never evict a
   party to a recorded migration**: §4.5's recovery pin is written while the predecessor is still
   readable because there is no second chance. Open Feed scales **across identities**, each
   self-contained and independently verifiable, not in items-per-identity; a global-scale aggregator
   is explicitly out of scope.
5. **SSRF.** For every outbound fetch: HTTPS only, ≤5 redirects, 10 s timeout, size limits, reject
   private/loopback/link-local addresses, dedicated restrictive HTTP client.
6. **Signature stripping and by-reference reuse.** Never attribute unsigned content; display unverified
   content distinctly; never cache it as verified. Author binding covers content carried by value and
   cannot cover content carried by reference (§6.6, §7.4).
7. **Replay and timing.** Constant-time comparisons; NTP; never trust self-reported time as sole
   ordering.
8. **Enumeration and the public record of activity.** Note what the design publishes permanently and
   by requirement: a `del` event makes "this identity deleted something at version N" a lasting public
   fact, and the retained log publishes posting cadence. Do not call this acceptable "for family use" —
   where the adversary is a family member it is precisely the leak that matters, and it survives
   encryption. Item ids sit inside that permanent record, so an identity for whom deletion is sensitive
   SHOULD use opaque ids.
9. **The ping is the only unauthenticated inbound surface, and it is inert.** It carries no author, no
   content, and no claim; §10.2 forbids it from causing a fetch. The failure mode to guard is an
   implementation that "helpfully" dereferences `look` on arrival, which reintroduces the whole
   fetch-amplification hazard this design removed. Rate-limit by source IP and by named origin, and
   bound the queue.
10. **Rollback vs self-reported time.** The chains detect identity-document and content rollback, both
    relative to a consumer's pin. Neither detects item *backdating*; log first-observation time (§4.4)
    is the bound, and item-carried pins (§16) are a **pairwise** external time anchor. A transparency
    log or witness *network* is **out of scope here, permanently** — and closing that question costs
    nothing, because a pin entry is a self-contained signed claim about `(url, seq, hash)` at a time,
    so anything that collects such claims consumes artifacts this specification already defines. The
    extension point is the pin itself.
11. **Inbound and copied HTML.** Escape or sanitize any content not authored by the local user, always
    (§11.4).
12. **Thread loops.** `reply` graphs from malicious parties may contain cycles; cap walk depth (§8.1).
13. **Lag, withholding, violation, stale.** Four distinct states, defined with their bounds in §9.4 and
    §9.5. Do not collapse them: two are attacks, one is not, and one is the absence of evidence.
14. **Identity portability.** Losing the domain without recovery keys orphans the identity — the email
    trade-off. Recovery keys and pins close the hijack gap for anyone who observed the identity before
    the hijack; first contact after a hijack is unprotectable by design.
15. **Cross-platform account links in chained documents.** Publishing a claim to a foreign account
    inside any chained document is a **permanent, irreversible disclosure** of a cross-platform
    identity link: removal withdraws the claim, never the disclosure, because every prior version stays
    served. Identities for whom the operator or a family member is the adversary SHOULD NOT publish
    such links. And a claim about a foreign account MUST be presented as a claim, never as established,
    until the foreign side's own attestation has been checked.
16. **Freeze — the cheapest attack.** Every check in §5.3, §9.3, and §9.4 compares a document against
    its predecessor or against a consumer's pin, so every one passes on a host that serves the last
    honest version forever. §9.5 is the answer and its reach is exactly stated there: it binds an
    attacker who cannot sign, and a key custodian defeats it by advancing an empty log on schedule.
    Implement the check; do not report the problem solved.
17. **Everything is public, and that is now the whole story.** The previous design had a delivered
    column whose contents were private from everyone but the two hosts; it does not exist here. An
    author with something whose *occurrence* must not be visible has no mechanism in this protocol
    (§11.1), and an implementation MUST NOT present encryption as one.

## 14. Export and Exit

§3.4 moves an *identity*. This section moves the *content*. An **export bundle** is a single JSON
document — optionally wrapped in an archive container alongside the attachment bytes — containing a
complete copy of everything an identity has published, independently verifiable throughout, plus
whatever unpublished content its host holds for it. An implementation hosting identities on behalf of
others MUST make it available to the identity's owner on demand, without operator approval and without
rate limits that make it impractical.

```json
{
  "version": "openfeed-export/2",
  "url": "https://pence.family/~mom/",
  "exported_at": 1739577600,
  "identity": { "current": { "..." : "identity document" }, "history": [ "..." ] },
  "feeds": [ { "feed": { "...": "JSON Feed" }, "log": { "..." : "current log version" }, "log_history": [ "..." ] } ],
  "unpublished": [ "...drafts and items kept private to their author; reached no feed..." ],
  "attachments": [ { "url": "...", "_openfeed": { "sha256": "..." }, "bytes": "base64url" } ]
}
```

- Every **chained document and every item** MUST appear byte-verbatim as published — the same
  canonical bytes that were signed. A bundle whose contents have been re-serialized is worthless,
  because the hashes will not chain. The scope is exactly the documents that *have* canonical bytes: a
  bundle nests a feed as a JSON **value**, and what it carries for a feed is the item array, whose
  members are each byte-verbatim under this rule.
- `identity.history` and `log_history` are the **retained prior versions themselves**, byte-verbatim,
  complete back to genesis. Where this identity has a `predecessor`, `identity.history` MUST also carry
  the **predecessor's** retained versions — at minimum the one committing the recovery key its
  `_recovery_sig` resolves against. Without them the bundle can verify everything except the one claim
  that makes it a *successor's* bundle, and the case where those bytes are hard to get is exactly the
  case that matters, since the host holding them is the one being left.
- **One slot has no completeness proof.** `feeds` is checkable against its own logs, so a short export
  of published content is detectable — which is the whole gain of §11.1's single column, since the
  previous design had three uncheckable slots and this has one. `unpublished` is committed by nothing;
  its contents verify individually and its *absence* verifies as nothing at all.
- `unpublished` SHOULD carry content the host holds that reached no feed: drafts, and items an author
  kept private. It is the one slot whose contents may be unsigned, so it sits **outside** the
  verifiable core and MUST NOT be presented as part of it — include it anyway. Where a host's product
  is a private journal this is most of what its owner came for. A host that signs such items at rest
  makes them export-native.
- A bundle MAY carry a `cache` slot of other identities' items the exporter had read. Those are
  ordinary **copies** (§7.5): verifiable as authored, with no authority over publication state, and
  covered by no completeness claim.
- `attachments` carry the referenced bytes, and for anything with media the ordinary form is an
  **archive container**: any archive format whose entry `openfeed-export.json` is the document above
  and whose remaining entries are the attachment bytes, each named by its `_openfeed.sha256`. That is
  still one bundle and still self-verifying, because the hash naming each file is the one inside the
  signed item that references it. Inlining bytes as base64 SHOULD NOT be the default: it inflates media
  by a third and forces the whole archive through a single parse. An export that omits the photos has
  not exported a family archive.
- The bundle itself carries no signature. §6.2's closed `typ` set names no bundle kind — a deliberate
  absence — and none is needed: every artifact inside carries its own signature, so a bundle is
  verifiable from its contents alone. That is what makes it useful against a host you do not trust.

A consumer restores from a bundle by verifying it exactly as it would verify live documents. Nothing
about verification changes because the bytes arrived in a file.

**What the bundle is for**, in increasing order of how much it matters: **backup**; **migration**
(§3.4 tells consumers your identity continues elsewhere, and the bundle is what you carry there to
republish byte-verbatim); and **exit** (you are leaving a host that is not on your side). Exit is the
case that sets the requirements above. An export mechanism a hostile operator can withhold, degrade,
or serve incomplete is not an exit; it is a courtesy.

## 15. Encrypted Content

**Status: never independently reviewed.** No one outside this specification's authorship has read this
layer. What would retire the sentence: a cryptographer's pass on §15.2's envelope, and a second
implementation of §15.2.1's carrier binding written from this text alone.

**Conformance.** No core level requires this layer, and Levels 0 through 3 are complete without it. But
this draft **raises its load**: with the delivered column gone (§11.1), encryption is the *only*
confidentiality mechanism in the protocol, and every private conversation runs through an envelope
nobody has reviewed. That is the sharpest cost of R2 and it is stated first rather than last.

> An implementation that offers audience-restricted content MUST implement this layer in full —
> §15.1's key resolution, §15.2's envelope, §15.2.1's carrier binding, §15.4's sealed relations, and
> §15.6's disclosures — and MUST NOT offer such content by any other means. A deployment that restricts
> an audience by *access control* rather than by encryption has built §11.1's third cell, which does
> not exist, and forfeits the single-valuedness the whole pin-and-walk discipline rests on.

It defines no new signing construction: encryption changes what the content *is*, not how it is signed.
An encrypted item is an **ordinary signed item** whose content is an opaque payload in `_openfeed.enc`.
The core commits to the ciphertext exactly as it commits to cleartext, and the host serves bytes it
cannot read.

The guarantee is one sentence and implementations MUST convey it rather than bury it: **encrypted
content is exactly as private as the recipient's key custody.** It is not a defence against your own
host. What stays cleartext regardless is §11.2's list.

### 15.1. The encryption key

A recipient publishes an X25519 key in their own identity document's `keys` array. The core's
`crv`/`use` constraints bind signing keys only (§4.1), so this needs no core change.

```json
{ "kid": "enc-1", "kty": "OKP", "crv": "X25519", "use": "enc", "x": "…", "iat": 1736899200 }
```

`use` MUST be `"enc"` and `crv` MUST be `X25519` (RFC 8037). A sender MUST resolve a recipient's
encryption key from that recipient's **own** identity document and MUST NOT accept one supplied by any
third party — the check that stops an intermediary substituting a key it controls. Because that
document is chained and pinned, substituting a published encryption key is as detectable as
substituting a signing key. What this does not cover: whether the sender wrapped to the *right* people
is a client-side act that is never published (§15.5).

**Lifecycle — it is not the signing-key lifecycle**, and implementations MUST NOT reuse §4.3–§4.5 by
analogy:

- **Retention is about the private half.** §4.3 keeps a signing key's *public* half listed so that what
  it signed stays verifiable; its private half can be destroyed at rotation. An encryption key inverts
  that: the **private half MUST be retained by its owner indefinitely**, because every ciphertext ever
  wrapped to it is frozen against it.
- **`revoked_at` has no verification effect.** It means senders MUST NOT wrap *new* content to the key.
  It does not invalidate existing ciphertext and no verifier checks it.
- **There is no recovery key for decryption.** A user who loses their encryption private key loses
  every encrypted item ever sent to them, irreversibly, with a perfect backup on disk. **This is the
  only failure mode in Open Feed that destroys content.** Any implementation offering encryption MUST
  provide key backup and MUST state this at the moment the user opts in.
- **Migration must carry it.** Encryption keys MUST be cumulative in the identity document — never
  dropped — so a migrated identity's old and new eras stay decryptable. Recovery-based migration
  recovers the *name*, not the *archive*.

### 15.2. The envelope

`_openfeed.enc` carries a **JWE JSON Serialization** (RFC 7516) with `alg`: `ECDH-ES+A256KW`, `enc`:
`A256GCM`, and an ephemeral X25519 key per RFC 8037. The carrying item sets `content_text: ""`, the
core's marker for "no displayable content".

**One ephemeral, shared; recipients identified by a blinded tag.** The JWE protected header carries a
single `epk` for the whole envelope, and each per-recipient header carries `alg` and a `_tag`: the
first 8 bytes of `SHA-256("openfeed-slot-tag" || Z)`, where `Z` is that recipient's ECDH shared secret.
A per-recipient header MUST NOT carry `kid`. A reader derives `Z` once from its own private key and the
shared `epk`, computes the tag, and finds its slot by comparison; a non-recipient compares and stops.

Both halves are needed. The tag keeps the audience undisclosed, because computing it requires one of
the two private halves, and it is unlinkable across items because the ephemeral is fresh per item —
which is the property that rules out `kid` here. Sharing the ephemeral is what makes the tag *useful*:
with one ephemeral per recipient a reader would have to perform the key agreement before it could
compute any tag, so cost would stay linear in slots.

The trade, stated rather than left to be found: a leaked ephemeral **secret** exposes the key-wrapping
path for every recipient rather than one. That secret is generated and discarded inside a single
encryption, so it carries the same exposure the content key already has there.

The per-recipient headers are *not* covered by the JWE's own AEAD. They are covered by the item's
`_sig`, which signs the whole item including `_openfeed.enc` — but that protection exists only while
the envelope stays in its carrier.

#### 15.2.1. Carrier binding (MUST)

**The envelope is not context-free.** It MUST name the item it belongs to, and a decrypting client MUST
reject it if the names disagree. The sealed plaintext MUST be a JSON object carrying at least:

```json
{ "id": "<the carrier item's id>",
  "authors": [{ "url": "<the carrier item's author>" }],
  "_openfeed": { "feed_url": "<the carrier item's _openfeed.feed_url>", "rel": [ "..." ] },
  "audience": ["https://pence.family/~mom/", "https://jessepence.com/"],
  "content_text": "…" }
```

On decrypt, a client MUST compare the sealed `id`, `authors[0].url`, and `_openfeed.feed_url` against
the outer item's, and MUST discard the payload on any mismatch — rendering nothing, attributing
nothing. **Absent against present is a mismatch, in both directions.**

**Why this is a MUST.** Without it the following works. Eve fetches an encrypted item from a
world-readable feed. She cannot read it. She copies the `_openfeed.enc` blob verbatim into a new item
with a fresh `id`, her own `authors`, her own `_openfeed.feed_url`, and signs it with her own key.
Every core check passes, and any audience member's client then decrypts it and renders the original
author's private words **attributed to Eve, in a context Eve chose**. What makes this worse than
ordinary misattribution: **Eve does not need to be in the audience.** In a cleartext world a copier can
only misattribute what they could already read; here the capability is strictly broader, and it works
against exactly the people the encryption was for.

This check lives at the **decrypting client**, not the core verifier: the core still commits to opaque
bytes and still has one construction.

### 15.3. The declared audience (SHOULD)

`audience` is an array of identity URLs naming who the author wrapped this item to. It exists for one
case the rest of this specification cannot otherwise reach: **a reply to encrypted content that the
other recipients can also read.** A replier cannot wrap to a list they cannot read, so without it every
reply comes back to the author alone and a deployment has published a conversation only its author can
continue. **An author publishing encrypted content to an audience SHOULD declare it.**

- It MUST appear inside the **sealed plaintext** and MUST NOT appear in a JWE per-recipient header,
  whose tags §15.2 keeps blinded so that an *observer* learns nothing. Readers learning the audience is
  the point; observers learning it is the leak the blinding exists to prevent.
- A client replying to an item that declares one SHOULD wrap its reply to the same identities,
  resolving each one's encryption key from **that identity's own identity document** (§15.1 — a list is
  not a key source).
- It carries no authority and grants no one anything. It is the author's statement about who they
  wrapped to, and §15.5 item 1 establishes that no such statement is checkable by anyone.

**Why this is not the membership document §11.3 forecloses.** That section prices a *published* roster:
chained, encrypted, stale between versions, withholdable, rekeyed on removal, bound to items, refetched
per member. A declared audience incurs none of the first six. It is not a document and not shared state,
so there is nothing to chain, publish, withhold, or pin, and there is no version to be stale between —
the audience of a post is fixed at the moment the post is written, which is the correct scope and not
an approximation of one. Removal needs no rekey, because the next item names a different list. What
remains is one identity-document fetch per recipient, which §15.1 already requires. What it does not do
is make the audience addressable by anyone else.

### 15.4. Sealed relations, and what the two designs each hide

An encrypted item's relations are **sealed, not outer**:

> An item carrying `_openfeed.enc` MUST NOT carry `_openfeed.rel`. Where it has relations they MUST
> appear as `_openfeed.rel` inside the sealed plaintext, in the shape §8 defines, and a decrypting
> client MUST reject a payload whose outer item carries the field.

The reason is that the relation array is the loudest cleartext metadata a published item has: `to`
names a feed and an item id, so an outer relation on an encrypted reply publishes the conversation
graph while hiding only the words. Sealing it costs a Level 0 or non-audience reader nothing they could
have used — they cannot read the content either — and it costs the *audience* nothing, because they
decrypt before they thread. What it costs is that an encrypted reply is invisible as a reply to
everyone outside the audience, including the parent's author if they are not in it, which is the
correct outcome and is stated so nobody restores the outer field to "fix" threading.

**What this design hides that the previous one did not**, and what it exposes that the previous one did
not — say both:

| | Delivered-only item (previous design) | Published encrypted item (this design) |
|---|---|---|
| Content | Private from all but the two hosts | Private from all but the audience's key custodians |
| Recipient identity | Known to both hosts | Hidden from everyone (blinded tags, §15.2) |
| Reply graph | Private | Hidden from everyone (sealed relations) |
| Existence, time, size, slot count | Private from the public | **Public forever** |
| Committed by | Nothing; the recipient's host could drop it silently | The sender's own log (§9) |
| In the sender's export | A slot with no completeness proof | `feeds`, with one |
| Survives migration | No | Yes |

The row that reads worst is the fourth, and it is the honest price of R2: *that this identity posted
something opaque at this time, at this rate* is a permanent public record. §13.8 already names cadence
as the leak that survives encryption; this design enlarges the set of content it applies to. In
exchange rows two, three, five, six and seven all improve, and a recipient's host loses the ability to
suppress a message entirely.

### 15.5. Attachments

Encrypt the bytes with a fresh per-blob symmetric key (AES-256-GCM) and publish the **ciphertext** at
an ordinary public URL — opaque bytes, so CDNs cache it and static hosting holds. The attachment entry
is unchanged and `_openfeed.sha256` is the hash **of the ciphertext**, so integrity is verifiable *by
anyone, without any key*: a host that swaps bytes is caught by a party who cannot read either version.
The per-blob key travels **inside the item's already-encrypted content**, so whoever can read the
caption can decrypt the photo — no second audience and nothing new to revoke. The one real cost:
**thumbnails must be generated client-side at upload**, because the host cannot see the image.

### 15.6. Security considerations

1. **The wrap-list is unverifiable.** Whether an author wrapped to the right people is not checkable by
   anyone. Only the slot *count* is visible. This is the first rule in Open Feed that is not checkable
   from bytes by a third party, so "consent is membership in the wrap-list" degrades to a *claim*.
2. **A declared audience extends that unverifiability to the replier.** State it to users as *you are
   trusting the author's stated audience exactly as you are trusting them not to forward your reply*.
   Someone added to a later item cannot read earlier replies, and removing someone is prospective only.
3. **A reading key-custodian leaves no trace.** Every other adversary in §13.2 surfaces; a host that
   simply *reads* what it holds the key for is invisible.
4. **No forward secrecy.** Compromise of a long-term X25519 key decrypts every past ciphertext wrapped
   to it.
5. **No retroactive revocation.** Once wrapped, content is readable by that key-holder forever.
6. **Key loss destroys content** (§15.1). The only such failure mode in the protocol.
7. **Recipient count is not a DoS lever, and the tag is why.** Work is one key agreement per key the
   reader holds, then a comparison per slot, so it does not grow with the audience, and the case that
   would otherwise be worst — a non-recipient, which on a world-readable encrypted feed is anyone at
   all — is the cheapest.
8. **Tombstones.** §7.3's allowlist already removes `_openfeed.enc` from a tombstone. This is why that
   rule is an allowlist.
9. **Do not encrypt to yourself and call it private.** An item wrapped only to its author is still
   published metadata and still on someone's host.
10. **Bridges amplify the metadata leak and are forbidden from doing so.** A gateway MUST NOT emit
    content it cannot read, in any form, including a placeholder (Appendix C).
11. **This layer now carries the whole confidentiality story** (§11.1), and it is unreviewed. Every
    disclosure below MUST say so.

### 15.7. Conformance

This layer defines no new level; it refines core Level 1+. A client that renders encrypted content MUST
implement carrier binding (§15.2.1) and sealed relations (§15.4), and MUST NOT render a payload that
fails either. A client that encrypts MUST resolve each recipient's encryption key from that recipient's
own identity document, including every identity named by a declared `audience`. An implementation
offering encryption MUST provide key backup and MUST disclose, at opt-in, that key loss is
unrecoverable, that the guarantee is bounded by recipient key custody, and that publishing an encrypted
item makes its existence, time, and size permanently public (§15.4). One that wraps replies to a
declared audience MUST additionally disclose §15.6 item 2. Every one of those disclosures MUST be
accompanied by §15's status: this layer has had no reader outside its authorship.

## 16. Item-Carried Pins and Witnesses

One facility, needing no document, no endpoint, and no discovery: **pins carried on items**. Emitting
them is a Level 3 MUST; heeding them is OPTIONAL throughout. It is not needed to verify anything, and it
introduces no new signing construction. **The compare rule is deliberately not here** — §5.3.1 defines
it and §12 makes it a Level 1 MUST. What this section supplies is the other half: a *supply of second
observations* to compare against.

**A pin leaks no content** — `hash` is a preimage-resistant SHA-256. **Signing does not make a pin
true**: it proves its author *asserts* it observed `(url, seq, hash)` at `observed`. The properties
below are evidential, not proofs, and gain strength from *multiple independent* witnesses.

### 16.1. Pin entries

An item MAY carry `_openfeed.pins`, an array of pin entries:

```json
"_openfeed": {
  "pins": [
    { "url": "https://test.example/openfeed.json", "seq": 1, "hash": "mUGmYabnGfAOkFR756jemnhXO1pqQf663KxMP41m44Y", "observed": 1739577600 }
  ]
}
```

Each entry carries `url` (MUST — the **chained document** observed: an identity document or a log),
`seq` (MUST), `hash` (MUST — the §5.1 hash of that version's full published bytes), and `observed`
(SHOULD — Unix seconds when the item's author **first** observed this `(url, seq, hash)`). Entries are
open objects: unknown keys MUST be preserved. Because `_openfeed.pins` sits inside the signed bytes, a
custodian can neither strip nor rewrite it — only drop the item whole.

**A Level 3 sender MUST carry pins for an identity whose chains it already tracks, on the items
addressed to that identity.** Emission is the supply side of §5.3.1's Level 1 MUST, and the asymmetry is
what forces it: a host serving each reader a consistent private branch is caught by no reader alone, so
the compare rule has teeth exactly to the extent that somebody supplies a second observation. The MUST
is narrow on purpose — it binds only a sender that *already* holds the pins, only items addressed to
that identity, and it costs about a hundred bytes on traffic that was being sent anyway.

**What an entry may name is scoped by who can read the item**, and the scoping is the entire basis of
the claim that pins disclose nothing new. Every item here is published (§11.1), so there are two cases
and they follow the same rule — *a pin may name only what the item already reveals*:

- **On a cleartext item**, every entry MUST name a chained document of an identity the item is
  addressed to: a relation target's author, or the subject of a `witness` entry. An entry naming any
  other identity MUST NOT be emitted and MUST be ignored on receipt, because a published item is
  world-readable forever and a third-party pin there would broadcast its author's reading graph,
  silently and to everyone. An interaction already reveals that its author reads its target, so a
  target-scoped pin adds nothing.
- **On an encrypted item**, entries MAY appear inside the **sealed plaintext** and MAY there name
  chained documents of **third parties**, because the disclosure reaches exactly the audience the
  author chose. Entries in the *outer* object of an encrypted item follow the cleartext rule and, since
  §15.4 seals the relation array, an encrypted item ordinarily has no outer addressee and therefore no
  admissible outer entry.

**An entry is a claim, never an observation.** A recipient compares each entry against its own records.
Equal hashes at the same `seq` are **corroboration**. A differing hash at a recorded `seq` is a **reason
to check**: fetch that `seq` from its derived URL and compare what you get against your own pin — which
resolves to equivocation, to a lying or mistaken witness, or to a chain to re-walk, and only the first
fires §5.3.1. Freezing on the entry's word alone would let any stranger revoke any identity for the
recipient. Two further guards: a `seq` above anything the pinned identity itself published names a
version its host produced without it, which is what §5.2 step 5's record exists to catch; and a consumer
MUST NOT dereference an entry naming a chain it does not already track — entries arrive from strangers,
and acting on unknown ones would make pins a fetch-amplification oracle.

**What pins buy.** Four properties, each evidential rather than proof: **anti-equivocation** (readers'
views meet); **recovery propagation** (a pin naming a `seq` beyond the consumer's own is the signal to
re-walk and discover a `predecessor` and its co-signature); **informal timestamping** (independent
witnesses converging at or before `T` establish a pairwise lower bound on when a version existed); and
**first-contact corroboration** (consistent pins from identities the consumer already trusts soften
TOFU, and never replace verification).

**Reach, stated honestly.** A pin travels no further than the item carrying it, and every item here is
published, so a pin lands in its author's own feed and log where anyone reads it. Properties 2–4 remain
**pairwise** in *trust* — they are worth what their witness is worth — and **this specification defines
no aggregate: no pins document, no log-of-logs, no witness network**, as a permanent decision. A
standing published record of who observed whom and when is precisely the reading graph the scoping rules
above spend their length avoiding, and the aggregate leaks by existing rather than by being read. Anyone
who wants one can collect the entries already flowing and publish them under their own identity, and be
judged as the witness they are.

### 16.2. The witness profile

Nothing above requires an interaction to carry a pin. A **witness** is an identity that publishes them
deliberately, and it needs no new field, endpoint, or verification rule:

> A witness publishes, on a cadence, an ordinary item carrying a `witness` relation entry (§8) for each
> identity it attests to, and `_openfeed.pins` entries naming the chains of exactly those identities.
> The item's `date_published` is the attestation time. Nothing consumes it that does not already consume
> §16.1.

Two hubs that each read the other and each witness the other convert §13.2's *detectable* equivocation
into *detected*: a host serving one reader a private branch of its member's chain now has that branch
contradicted by a published, signed, third-party artifact that the member's own family reads. That is
the two-self-hosting-relatives persona, and it is the deployment this protocol is aimed at.

**Three limits, and the third is the one to hold on to:**

- A witness discloses that it reads whom it witnesses. The `witness` relation makes that explicit
  rather than incidental, which is why the entry is required rather than the pins standing alone: the
  disclosure is the *point* of the attestation and must not be smuggled.
- A witness under the same custodian as its subject witnesses nothing. §12 requirement 2's
  substitution — witnessed *by an identity the operator does not control* — is what makes it a check.
- **A witness does not detect a punctual empty log.** A key custodian that advances its member's chain
  on schedule while committing nothing the member wrote produces a chain every witness agrees about.
  What catches that is the member's own record (§5.2 step 5) compared against what the host serves —
  and where the host holds the member's key, nothing does. §9.5 says the same thing and neither
  sentence may be softened.

## Appendix A: Media Types

| Document | Content-Type (serve) | Accept (consume) |
|----------|---------------------|------------------|
| Identity document, log, retained prior versions, export bundle, ping body | `application/json` | any JSON; reject non-JSON |
| Feed | `application/feed+json` | that, or `application/json` |

All served with `Access-Control-Allow-Origin: *`.

**Signed-document types**, used as the `typ` of a JWS protected header (§6.2) and nowhere else:

| Kind | `typ` | Full media type |
|------|-------|-----------------|
| Identity document | `openfeed-identity+json` | `application/openfeed-identity+json` |
| Log | `openfeed-log+json` | `application/openfeed-log+json` |
| Item | `openfeed-item+json` | `application/openfeed-item+json` |

These are **not** Content-Types and MUST NOT be served as one. They name the kind for the signature,
which is a statement about the bytes rather than about the transfer.

## Appendix B: Test Vectors

To be regenerated from an implementation of this draft. The existing Appendix B's vectors for keys,
items, relation items, identity documents, delegated custody, encrypted items, and item-carried pins
carry over unchanged in construction; the manifest vectors are replaced by log vectors and the
delivered-pair vector is deleted.

## Appendix C: Interoperability and Gateways

The cheapest interoperability is not a bridge, because the wire formats are already other people's: a
JSON Feed plain readers consume, an Atom or RSS mirror, h-card/h-entry markup on the human page, and
identifier-alias conventions. This appendix governs the expensive route.

A **gateway** is a **trusted intermediary, never a transparent adapter**: each target protocol has a
different trust primitive, and no bridge can hold a foreign author's key. A gateway is an ordinary
identity, so a gateway that equivocates about what it bridged forks its own chain. Everything follows
from one rule, applied in both directions:

> **A gateway may not change the terms under which content was published.** Not the **audience** —
> never widen it. Not the **durability** — never make permanent what was ephemeral. Not the
> **verification status** — never present an assertion as a signature.

**Outbound.** A gateway MUST NOT emit content it cannot read, including as a placeholder: for an
encrypted item the ciphertext, an "encrypted post" stub, and a bare timestamped entry are all
forbidden. Metadata is public **incidentally**, as the price of keeping the completeness proof, not as
a decision to announce. No completeness guarantee crosses. Notifying a foreign network about your
*own published* relation item mints no proxy identity and ingests nothing; the trust argument begins
at ingest.

**Inbound.** Ingest is publication: an ingested item lands in the gateway's own feed, is committed by
its log, is retained permanently, and is world-readable.

- **Ingest only what the source published publicly.** Content not addressed to a public audience —
  followers-only, a direct message, any protocol's restricted content — MUST NOT be ingested. One
  followers-only post ingested into a logged feed is a permanent, world-readable, cryptographically
  committed disclosure its author never authorized.
- **Do not durabilize the ephemeral.** Content the source protocol expires or allows to be genuinely
  withdrawn MUST NOT be ingested: a protocol whose deletions are real is not compatible with one whose
  deletions are tombstones.
- **Everything ingested is `_openfeed.unverified`** (§7.5), without exception.

**Backfeed has no private channel here.** The previous design let a gateway convey foreign responses by
delivering them privately; with the delivered column gone, a gateway conveying a foreign response
either **ingests** it — which is publication, and therefore only ever for responses the source
published publicly — or **pings** the identity it concerns and publishes nothing (§10). A gateway MUST
NOT ingest a foreign response that was not public at its source, and a receiver rendering a foreign
response on its own **unsigned, mutable** surfaces (the human page, which nothing in this protocol
reads) MAY do so because such a surface can honor a later foreign deletion; it MUST NOT enter any
signed, logged, or retained artifact.

**Proxy identities.** A gateway signs what it ingests, so §6.6 places the gateway in `authors`, leaving
the foreign author unnamed. A **proxy identity** names them: an ordinary identity, minted and key-held
by the gateway, one per foreign actor. Attribution becomes structural rather than an unverified string.
A proxy is **not** a hosted identity in §12's sense — its principal never asked for it, holds no keys,
and has a real home elsewhere — so §12's requirements do not apply. The price of that carve-out is
honesty: a gateway minting proxies MUST **disclose** in each proxy's identity document that it is a
gateway-operated mirror, who operates it, and where the actor's real home is; MUST **never claim exit**
for a proxy; and MUST **withdraw the proxy on the foreign actor's request**.

**Bridge profiles.** **No profile is defined here, and none will be**: a profile binds to a foreign
protocol's behavior of the moment, and normative text that goes stale at a trust boundary is worse than
no text. Normative here, because protocol-independent: a profile MUST fix the **audience test** and the
**durability test** that decide what may be ingested. And binding the gateway rather than the profile:
foreign objects with no item representation MUST NOT be invented into `_openfeed.rel` types.
