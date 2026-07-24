# Open Feed — Encrypted Content (Extension)

**Extension version 0.1.0 — Draft. Unreleased, and never independently reviewed.** Targets the Open Feed core specification **v0.1.0** (`open-feed-spec.md`). This is an OPTIONAL extension; it is not part of the core and MUST NOT be required for core conformance. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive. RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

## Abstract

An encrypted item is an **ordinary Open Feed signed item** whose content is an opaque payload in an `_enc` field. Nothing about signing, author binding, `_feed_url`, versioning, tombstones, or the manifest changes: the core commits to the ciphertext exactly as it commits to cleartext, and the host serves bytes it cannot read.

This extension defines the payload format, the encryption key that recipients publish, the rule that binds a payload to the item carrying it, and the roster that lets a *group* audience work. It introduces **no second signing construction** (core §6.1) — encryption changes what the content *is*, not how it is signed.

## 1. The guarantee, stated once

> **Encrypted content is exactly as private as the recipient's key custody.**

Encryption protects a plaintext from every party except (a) its author, who needs no secret to encrypt because they encrypt to recipients' *public* keys, and (b) anyone holding a recipient's private encryption key. If a recipient's host holds that key — the common case for a hosted user, and the default in most deployments — then that host can read everything sent to them, and encryption has bought protection from everyone *else*, which is real but is not what most people hear.

Two consequences, both of which implementations MUST convey to users rather than bury:

- **This is not a defence against your own host.** See core §14.2's fourth adversary tier. Do not market it as one.
- **Its value tracks how many recipients hold their own keys.** That is a product and UX variable, not a protocol one. Two families whose members each hold their own keys get a strong guarantee from the same bytes that give two fully-hosted families almost none.

The honest place this *does* earn its keep: content published to a world-readable feed that only a named audience should read, and content crossing hosts that are not all trusted equally. A family archive on a public CDN is opaque to the CDN, to crawlers, to archivers, and to every host except those holding an audience member's key.

## 2. What is never hidden

On a **published** feed (core §11.1), these stay cleartext by construction and are not a defect to be fixed later:

`id`, `date_published`, `date_modified`, `authors`, `_version`, `_feed_url`, and `_rel` with its `to` targets — plus the manifest's record of publication cadence and deletions (core §9, §14.8).

That is *who posts, when, how often, and who replies to whom*: the interaction graph. Encryption hides what you said, not that you said it. Where the graph itself is sensitive, §7 describes the only real answer, which is not cryptographic.

## 3. The encryption key

A recipient publishes an X25519 key in their own identity document's `keys` array (core §4.1). The core's `crv`/`use` constraints bind **signing** keys only, so this needs no core change and core verifiers ignore it (core §4.1).

```json
{ "kid": "enc-1", "kty": "OKP", "crv": "X25519", "use": "enc", "x": "…", "iat": 1736899200 }
```

- `use` MUST be `"enc"`. `crv` MUST be `X25519` (RFC 8037).
- The key MUST be published in the **recipient's own** identity document. A sender MUST resolve a recipient's encryption key from that document and MUST NOT accept one supplied by any third party — including a roster (§6). This is the check that stops a roster owner, or a host, substituting a key it controls.
- Because the identity document is chained and pinned (core §5), *substituting* a published encryption key is as detectable as substituting a signing key: it advances the chain, and a consumer walking to its pin sees it. Note carefully what this does **not** cover: whether the sender wrapped to the *right* people is a client-side act that is never published, and no observer can check it (§8).

### 3.1. Lifecycle — it is not the signing-key lifecycle

Core §4.3–§4.5 are written for signing keys and mean something different, or nothing, here. Implementations MUST NOT reuse that machinery by analogy:

- **Retention inverts.** A rotated-out signing key MAY be dropped after 30 days (core §4.3). A rotated-out encryption key MUST be retained by its owner **indefinitely**, because every ciphertext ever wrapped to it — including items in *other people's* feeds — is frozen against it. Dropping it destroys readability, permanently.
- **`revoked_at` has no verification effect.** For an encryption key it means: senders MUST NOT wrap *new* content to it. It does not invalidate existing ciphertext, cannot un-decrypt anything, and no verifier checks it. It is an instruction to encryptors, and an unenforceable one — which is a real limit, not a wording quibble.
- **There is no recovery key for decryption.** Core §4.5's recovery key restores *identity continuity*; it cannot restore *readability*. A user who loses their encryption private key loses every encrypted item ever sent to them, irreversibly, with a perfect backup of every byte on disk. **This is the only failure mode in Open Feed that destroys content**, and it is user-triggered. Any implementation offering encryption MUST provide key backup and MUST state this consequence plainly at the moment the user opts in.
- **Migration must carry it.** Core §3.4 requires no secret to survive a migration except the offline recovery key. Add encryption and the private encryption key becomes a second must-survive secret, retained forever. Recovery-based migration (core §3.4) recovers the *name* and not the *archive*: the recovered identity is readable by others and unreadable by itself. Encryption keys MUST be cumulative in the identity document — never dropped — so that a migrated identity's old and new eras stay distinguishable and decryptable.

## 4. The envelope

`_enc` carries a **JWE JSON Serialization** (RFC 7516):

- `alg`: `ECDH-ES+A256KW`, `enc`: `A256GCM`, ephemeral keys X25519 per RFC 8037.
- Recipients are **untagged**: a per-recipient header carries `alg` and `epk` and MUST NOT carry `kid`. The audience is therefore not disclosed by the item; a reader trial-decrypts each slot until one opens. At family scale (N ≈ 10–30) that is a few dozen X25519 operations, low single-digit milliseconds.
- The item carrying an `_enc` payload sets `content_text: ""` — the core's marker for "no displayable content," already used by relation items and tombstones (core §7.2). Such an item is conformant to the core today; the core does not mention `_enc` and does not need to.

Note that the per-recipient headers are *not* covered by the JWE's own AEAD. Here they are covered by the item's `_sig`, which signs the whole item including `_enc` — but that protection exists only while the envelope stays in its carrier. Anything that lifts `_enc` out of its item (a cache, a bridge, a debugging tool) loses it.

### 4.1. Carrier binding (MUST)

**The envelope is not context-free.** It MUST name the item it belongs to, and a decrypting client MUST reject it if the names disagree.

The sealed plaintext MUST be a JSON object carrying at least:

```json
{ "id": "<the carrier item's id>",
  "authors": [{ "url": "<the carrier item's author>" }],
  "_feed_url": "<the carrier item's _feed_url, if it has one>",
  "content_text": "…" }
```

On decrypt, a client MUST compare the sealed `id`, `authors[0].url`, and `_feed_url` against the outer item's, and MUST discard the payload on any mismatch — rendering nothing, and attributing nothing.

**Why this is a MUST.** Without it, the following works. Eve fetches an encrypted item from a world-readable feed. She cannot read it. She copies the `_enc` blob verbatim into a new item with a fresh `id`, her own `authors`, her own `_feed_url`, and any `_rel` she likes, and signs it with her own key. Every core check passes: valid signature, valid author binding, `_feed_url` matches the feed it is served from, fresh `id` so core §7.5's exclusivity rule is not triggered, and an ordinary manifest commits it. Any audience member's client then decrypts it and renders the original author's private words **attributed to Eve, in a context Eve chose** — as a reply to a question they never answered, say.

What makes this worse than ordinary misattribution: **Eve does not need to be in the audience.** In a cleartext world a copier can only misattribute what they could already read. Here the capability is strictly broader, and it works against exactly the people the encryption was for.

This check lives at the **decrypting client**, not the core verifier: the core still commits to opaque bytes and still has one construction. `tmp/enc-prototype.js` demonstrates both the attack and the rejection.

## 5. Attachments

Encrypted attachments need no gate, no key-distribution mechanism, and no streaming construction:

- Encrypt the bytes with a fresh per-blob symmetric key (AES-256-GCM).
- Publish the **ciphertext** at an ordinary public URL. It is opaque bytes: CDNs cache it, `Access-Control-Allow-Origin: *` holds, static hosting holds.
- The attachment entry (core §7.4) is unchanged, and `_sha256` is the hash **of the ciphertext**. Integrity is therefore verifiable *by anyone, without any key*, from a signed item — a host that swaps bytes is caught by a party who cannot read either version. AEAD gives plaintext integrity on top.
- The per-blob key travels **inside the item's already-encrypted content**. Whoever can read the caption can decrypt the photo. There is no second audience, no second roster, and nothing new to revoke.
- Single-shot AES-GCM decrypt into a blob URL is sufficient for photo-sized media; streaming AEAD is only needed for video and is out of scope here.

The one real cost: **thumbnails must be generated client-side at upload** and published as further encrypted attachments, because the host cannot see the image. That is the standard trade in every end-to-end product, and it buys the deletion of an entire authorization mechanism.

## 6. Group audiences: the roster

Core §11.2 states the rule this section implements: **any audience larger than one requires a membership document.** A direct message needs none. A group does, because a replier is a *reader* — they did not choose the audience and nothing in the item tells them who it is.

A **roster** is a chained, signed, encrypted document listing an audience's members. It reuses the core's chained-document mechanism (core §5) by reference and defines no new one:

```json
{ "url": "https://pence.family/~mom/",
  "circle": "https://pence.family/~mom/circles/family",
  "seq": 3,
  "prev": "…",
  "history": "https://pence.family/~mom/circles/family-history.json",
  "updated": 1739577600,
  "_enc": { "…": "JWE wrapping the member list to each member's published enc key" },
  "_sig": "…" }
```

- The sealed member list is an array of `{ "identity": "<identity URL>" }` entries. It MUST NOT carry members' encryption keys as authoritative values: a sender MUST resolve each member's key from that member's own identity document (§3).
- The roster is pinned and walked exactly as a manifest is (core §9.1), so **rollback is detected** — a host cannot re-admit a removed member by serving a stale version.
- Members added at version N cannot read content wrapped before N; members removed at version N keep whatever they already fetched. There is no retroactive revocation, and there cannot be.

### 6.1. Roster freshness — and its limit

An item wrapped to a circle MUST name the roster version it used:

```json
"_circle": { "url": "https://pence.family/~mom/circles/family", "seq": 3, "hash": "…" }
```

A reader holding roster version M who sees an item claiming `seq < M` MUST surface it as **stale-audience** before rendering or replying: the item may have been wrapped to someone since removed. Slot count versus roster size is a consistency check — a roster of eight and an envelope of nine slots means someone extra.

Two limits, stated rather than solved:

- **The window is real.** A replier wraps to the roster version they hold. If the owner removed someone at version 3 and the replier still holds version 2, that person reads the reply. `_circle` makes the staleness *visible*; it does not close the window. Nothing short of rekeying does.
- **Withholding is not rollback.** A host need not serve a stale roster — it can simply decline to serve the newest version to a chosen replier. Pin-and-walk cannot distinguish "no new version" from "new version withheld." A member who sees other members citing a higher `seq` than they have been served SHOULD treat that as a compromise signal.

### 6.2. Status

**Rosters are not ready to ship.** They are specified here so the shape is on record and so §6.1's limits are not rediscovered. Before any implementation offers them: a prototype must model withholding (not merely rollback), identity-document-published encryption keys rather than freestanding ones, carrier binding on roster-wrapped replies, and the N identity-document fetches and pins a single reply implies. `tmp/circles-prototype.js` covers rollback only, and is a spike rather than evidence.

Ship §4 (broadcast to a known audience) and audience-of-one messages first. Those are complete.

## 7. Metadata, and the two channels

Encryption does nothing about §2's cleartext metadata, and on a published feed the reply graph is the loudest part of it. The structural answer:

- **Posts** intended for an audience are **published, encrypted** — they keep the manifest's completeness proof, the export bundle (core §15), migration, and durability. The cost is that *this identity posted at this time* is public.
- **Interactions** on that content are **delivered, not published** (core §11.1) — POSTed to the audience's inboxes with no `_feed_url`, so `_rel` and its `to` targets never land in a world-readable file. The cost is that replies have no completeness proof and that someone joining later cannot reconstruct old threads.

**This half of the design is enforced at the recipient, not at the author**, and implementers MUST understand that before relying on it. Delivering an interaction keeps it off the public web only for as long as every recipient declines to republish it. Core §11.1.1 makes that a MUST and core §12 applies it to the replies endpoint — the surface most likely to undo it, since a hub that projects its inbox publicly would republish exactly the reply graph this section exists to hide. An audience member whose client ignores §11.1.1 defeats this for everyone in the audience, silently, and no other participant can detect it.

This is a genuine trade, not a free win, and which side of it a deployment wants depends on whether a reader graph or a durable thread record matters more. State the choice to users; do not make it silently.

## 8. Security considerations

1. **The wrap-list is unverifiable.** Whether an author wrapped to the right people is not checkable by anyone — not by observers, not by other audience members. With untagged recipients only the slot *count* is visible. Nobody can detect a wrap to a stale or substituted key, and nobody can detect an extra recipient beyond a count mismatch. This is the first rule in Open Feed that is not checkable from bytes by a third party, and it is why "consent is membership in the wrap-list" is a weaker claim than it sounds: membership is not auditable, so it degrades to a claim about membership.
2. **A reading key-custodian leaves no trace.** Every other adversary in core §14.2 surfaces: rewriting the past forks a chain, dropping content violates a manifest invariant. A host that simply *reads* what it holds the key for is invisible. Core §14.2's tier table should be read with that in mind.
3. **No forward secrecy.** Compromise of a long-term X25519 key decrypts every past ciphertext wrapped to it, including messages from a device recovered years later.
4. **No retroactive revocation.** Once wrapped, content is readable by that key-holder forever. Unlike an authorization grant, there is nothing to revoke.
5. **Key loss destroys content** (§3.1). The only such failure mode in the protocol.
6. **Recipient-count DoS.** A reader trial-decrypts every slot, so an item with a very large recipient count is a cheap denial of service against anyone who opens it. Clients MUST cap the recipient slots they will attempt (RECOMMENDED: 256) and treat an item exceeding it as unreadable rather than grinding.
7. **Tombstones.** Core §7.3's allowlist already removes `_enc` from a tombstone, since only the listed fields survive. This is why that rule is an allowlist: a denylist naming today's content fields would have left ciphertext in place and deleted nothing.
8. **Do not encrypt to yourself and call it private.** An item wrapped only to its author is still published metadata (§2) and is still on someone's host. If content must not exist publicly, do not publish it (core §11.1).
9. **Bridges amplify the §2 metadata leak, and are forbidden from doing so.** §2's leak is bounded by the surface the author chose — their feed URL and whoever fetches it. A gateway relaying an encrypted item to a foreign network moves that leak to a different audience with different reach, which is why core Appendix F.2 forbids a gateway from emitting content it cannot read **in any form, including a placeholder**: not the ciphertext, not an "encrypted post" stub, not a bare timestamped entry. Implementers reach for the stub because a silent gap looks like a bug; here the gap is the correct behavior.

## 9. Conformance

This extension defines no new conformance level; it refines core Level 1+.

- A client that renders encrypted content MUST implement the carrier-binding check (§4.1) and MUST NOT render a payload that fails it.
- A client that encrypts MUST resolve each recipient's encryption key from that recipient's own identity document (§3).
- An implementation that offers encryption MUST provide encryption-key backup and MUST disclose, at opt-in, that key loss is unrecoverable (§3.1) and that the guarantee is bounded by recipient key custody (§1).
- Rosters (§6) MUST NOT be presented as ready for use until §6.2's conditions are met.
