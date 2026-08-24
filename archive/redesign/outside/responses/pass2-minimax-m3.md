---
model: minimax-m3
pass: 2
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T22:05:02.374Z
prompt: PROMPT-pass2.md
prompt_sha256: e808057730fa1e8528c594da5513c840a16897c944e6bf2b03a576244d5ed8f5
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":16954,"completion_tokens":17172,"total_tokens":34126,"prompt_tokens_details":{"cached_tokens":128}}
wall_seconds: 178
truncated: false
reasoning_chars: 48288
---
# A. Attack on the other team's direction

## The main attack: relocation breaks against the hostile hub

The other team's design has a load-bearing assumption underneath the relocation mechanism: that the **current location** can be discovered by pulling from the profile, and that the profile's history of locations is sufficient for a reader to find the new one. The design is **everything-is-pull**, with push as an extension. This is what kills it.

The hostile-hub scenario in Scenario 1 unfolds like this:

1. Alice is on `alice@family.example`, hosted by her ex-husband. Her followers (her mother, sister, brother, a few friends) all know her by that address. Each follower has previously fetched Alice's profile and stored her public key and her profile URL.
2. Alice's device signs a Move activity. In the other team's design, a Move is just an item: `{"type": "Move", "from": <alice>, "to": <newhub.example/actor/alice>, "seq": 2, "signature": …}`. The sequence is 2; the previous profile statement was sequence 1.
3. Alice's device must put this Move somewhere readers will find it. **There is no inbox in the core.** The only place to put a signed item is at a location: either the old one (the hostile hub) or the new one (where nobody knows to look).
4. If Alice PUTs the Move to the old hub (the only place readers currently know to fetch), the hostile hub sees the Move, recognizes it as a relocation, and either (a) refuses to serve it, (b) serves it but strips it from any index/feed view, or (c) serves an older `seq` value in the profile so the Move looks stale. The Move's signature is valid — the hub doesn't need to forge anything. It just needs to *withhold*. Withholding is enough.
5. Readers who come back later fetch Alice's profile from `family.example`. The profile says `seq: 1`, points at `family.example`, and lists no other locations (the hub can omit them). The reader has no signal that anything has changed. The reader's "remember every location the profile has ever named" rule is satisfied because the profile has only ever named `family.example`. The reader has no basis to look anywhere else.
6. Alice's mother is one of these readers. She calls Alice and says "I can't find your new posts." Alice explains she moved. Mom has to manually type `newhub.example/actor/alice` into her reader and follow it. The protocol has done nothing for her.

This is a clean break of Scenario 1 and also Scenario 4 (the domain goes — readers who only knew the old location are stranded; the "location list" mechanism is only useful if the *current* hub honestly serves the full history of the profile's moves, which a hostile or dead hub will not).

The other team's text says push is an extension. **It cannot be an extension.** If push is optional, then the hostile hub's suppression of the Move is sufficient to defeat the relocation. The "host cannot keep you" assurance in the brief is not a property the core can provide without a push channel that does not depend on the hub being cooperative. The other team's design has made the wrong primitive optional.

## Secondary attacks

**No canonicalization is a real win — but only if the format is unambiguous.** "Signed items are files, signed as the bytes served" is good if the file is a binary blob (a JPEG, a CBOR document, a custom format with explicit length prefixes). It is **not** good if the file is JSON served by a hub that controls serialization, because the bytes can drift in whitespace, key ordering, and number formatting even when the hub does not intend to tamper. The other team is implicitly relying on the publisher's app saving *exactly* the bytes it signed and the hub serving *exactly* those bytes. A hub that re-encodes the JSON before serving breaks the signature. A hub that doesn't re-encode, but adds a trailing newline, breaks the signature. The design needs to be specific about whether the hub is required to serve the exact bytes, and how the reader handles a server that compresses (which changes the bytes but is reversible). This is doable but the brief's claim that this is simpler than canonicalization is partially wrong: it trades canonicalization-spec work for byte-fidelity-spec work, plus the work of defining the file format (magic numbers, length prefixes, content-type hashes).

**"Identities sealed inside" is hand-waving that probably does not survive contact with the threat model.** The brief explicitly accepts that the hub can see the audience. The other team's direction claims audience sealing via "encrypted to a chosen set of keys with the recipients' identities sealed inside." In any realistic construction, the recipient list is a set of `(key_id, ephemeral_pub, wrapped_key)` triples, and the recipient's device has to find their entry. If `key_id` is the recipient's public key in plaintext, the hub trivially identifies the audience by looking up profiles. If `key_id` is a hash of the public key (the only plausible "sealing"), the hub still knows the audience if it knows the recipients' public keys — which it does if any of them are on the same hub (likely in a family), and which it can infer by watching the publisher's outbound HTTP to fetch their profiles. The "sealing" is at best a defense against a hub that doesn't know the recipient set, which is not the threat model. I would not advertise this as a property the design delivers.

**Social recovery with "enough peers" has an undefined threshold.** The direction punts the threshold to the reader, which is correct as a policy decision but underspecified as a protocol decision. If the protocol does not specify how a recovery attestation is structured, what it signs, and how it is propagated, then implementers will improvise. The natural answer is the one I described in my design: a `KeyChange` activity signed by the recovery contacts (each with their own key), whose signatures the reader verifies against the peers' public keys the reader already holds. The direction needs to specify this; otherwise the mechanism will be reinvented badly.

**"BYOC is the security property" works only if the user actually brings their own client.** For the target user (grandma, a non-technical family member), the realistic deployment is the official app from the official hub company. The "market" framing is a fig leaf unless the spec actually demands on-device key storage and on-device signing. The other team needs to be explicit that the hub cannot serve the signing key as part of the API surface, and that any client implementation must keep the key on the device. Without that, the protocol collapses for the target user.

## What's right about the other team's direction

I do not want to leave the impression that the design is bad. It gets several things genuinely right that my design does not:

1. **No canonicalization.** Sign-the-bytes is a cleaner primitive than canonical-JSON. If the spec nails the file format (length prefixes, magic, content-type identifier, signature appended or sidecar), implementers will have a much smaller surface for interop bugs than my design's "implement RFC 8785 (or this 50-line subset) exactly." The trade-off is format-design work vs. canonicalization-spec work; both are real, but format-design is one-time and canonicalization is forever.
2. **Publisher forgets; readers remember.** This is a *real* privacy property. If Alice deletes a post, Alice's hub doesn't have to retain it, but readers who already fetched it may keep their copy. This is the right asymmetry: the publisher has a right to be forgotten at their location, and the readers who already received the content have already received it. My design has no deletion story at all; the other team's is correct.
3. **The signed sequenced head for completeness.** A reader can pin a small head and detect when items have gone missing without a tombstone. This is a lightweight freshness mechanism that my design lacks entirely. A reader polling my outbox has no way to know whether the hub is serving a truncated view; the other team's reader does.
4. **Everything is pull by default.** This is the right default for a metadata-minimizing design. Push creates an inbox, an attack surface for spam, a place where the hub sees incoming traffic from other hubs, and a complex protocol to specify. Pull-only is simpler.
5. **BYOC framing.** Specifying the publish interface as a small contract between any client and any hub is a clean way to make the security property auditable. My design assumes a particular client-hub relationship; theirs makes it explicit.

The other team's design is closer to *correct architecture* than mine in several places. It loses on the relocation scenario because it makes the wrong thing optional.

# B. Attack on my own design

Re-reading my design with the other team's direction beside it, the problems I now see are:

## The bootstrap / first-contact trust problem (the biggest gap)

My design's security rests on a chain: WebFinger → actor URL → actor profile → public key. **Every link in that chain depends on the hub being honest on first contact.** If the hub serves a fake profile with the attacker's key, the reader follows the attacker's feed, thinking it is Alice's.

I named no mitigation for this. The other team's design has the same problem. The brief's threat model is *the hub is the adversary from the first interaction*, and neither of us actually solves that on the first contact. We both assume the URL itself is trusted (which is true for subsequent contacts, after the reader has verified a Move and updated to a known location, but not for first contact).

A real fix would include one or more of:

- **Public key as part of the address.** The address becomes `alice#a1b2c3d4@hub.example`, where `a1b2c3d4` is the first 4 bytes of the public key, displayed in the UI. On first contact, the reader verifies that the key in the profile matches the fingerprint in the address. A hub that substitutes a different key fails this check.
- **Out-of-band verification as a designed step, not a workaround.** The reader UI shows the fingerprint prominently on first contact and asks "do you trust this key?" Verification is done by the user comparing fingerprints with the claimed owner over a side channel (phone, in person, signed paper).
- **Multi-hub corroboration.** The reader fetches the profile from the actor's hub *and* from any cached or mirrored location, and compares.

I had hand-waved this with "the reader trusts the URL." That is not good enough. It is the floor's load-bearing weakness. Both designs have it; I am naming it.

## Canonicalization is a real implementation burden

My design requires the implementer to produce canonical JSON exactly per my spec (UTF-8, sorted keys, no insignificant whitespace, integers only in signed payloads, RFC 8259 escaping). This is 50 lines of careful code and a dozen test vectors. The other team's "sign the bytes" approach is genuinely cleaner here. If I were rewriting my design, I would adopt the sign-the-bytes approach and define a simple binary envelope:

```
[4 bytes magic: "PRSN"]
[1 byte version]
[1 byte content-type-id]
[4 bytes body length, big-endian]
[N bytes body (any format: JSON, CBOR, image, etc.)]
[64 bytes Ed25519 signature, over all preceding bytes]
```

The signature is over the magic, version, type, length, and body. The type tells the reader how to parse the body. No canonicalization needed; the bytes are the bytes. I should have designed it this way and didn't.

## Inbox semantics are hand-waved

I specified "the hub accepts POSTs to the inbox and stores them" without specifying deduplication, ordering, retention, pagination, rate limits, or authentication. Each implementer will make different choices. Readers and writers will not interoperate. The other team's pull-only design avoids this entirely.

If I keep the inbox, I need to specify it: idempotent by activity id, FIFO or causal ordering, retention by reader poll (hub GC's what the reader has acknowledged), rate-limited by HTTP signature verification, signed POSTs using a minimal HTTP signature scheme (draft-cavage with Ed25519, signing `(request-target)`, `host`, `date`, `digest`).

## HTTP signatures are hand-waved

I said "HTTP signature over the request" and left the construction undefined. The natural answer is draft-cavage-http-signatures with Ed25519, signing a minimal set of components. The implementer has to read that draft (which is 30 pages) and implement it. This is real work that I glossed over. The other team's design avoids this by not having an inbox.

## Multi-device is not addressed

My design assumes one device holds the signing key. If Alice wants to publish from her phone and her laptop, she needs the key on both. I do not specify how. The natural answer is "the user uses their platform's secure sync (iCloud Keychain, Android Sync, etc.)," but that is platform-dependent and may not be available. A better answer is "the user generates one signing key per device, and the actor profile lists multiple signing keys, each with a `device` field; activities are signed by the device that created them." This is a real gap.

## Recovery UX is the most user-hostile part

I flagged this in my own design. A real grandma is unlikely to successfully recover her account through the "phone call to daughter, who has the app, who gets a push, who approves" flow. The flow has too many moving parts. The other team's "bring-your-own-client is the security property" framing makes this worse: grandma is on the official app, the official hub, and the official recovery contact is her daughter who is also on the official setup, and any of them being broken breaks the flow.

A more honest recovery would include a printed recovery code as an *optional* fallback, even if the brief discourages it. The brief says "never shown a key, never told to store a file outside the house." A 12-word recovery phrase is a key, even if we don't call it that. The brief's user-experience preference is in tension with the brief's threat model; my design did not resolve this tension.

## Group membership changes are not addressed

If Alice posts to Bob and Carol, and later wants to remove Carol (or add Dave), there is no mechanism. Carol already has the content key. Forward secrecy for group membership changes requires either re-encrypting the thread with a new key (which means all subsequent posts use a new key, and old posts remain decryptable by Carol) or some form of ratcheting (Signal-style, but multi-recipient). Neither design addresses this. It is hard, and I am not sure it is worth solving in v1.

## I left the head / completeness story out

The other team has a real answer here; I do not. My design lets the hub serve a truncated outbox and the reader has no way to know what it is missing. The other team's signed head gives the reader a verifiable expectation of the outbox contents, which makes deletion detectable and tampering expensive. I should have included it.

## Other weaknesses

- **The audience is visible to the hub.** I accepted this explicitly. The other team's "sealed" claim is hand-wavy, but if they actually implemented hashed key IDs with no metadata in the recipient list, the audience would be better hidden from the hub than in my design. I should consider adopting this.
- **No deletion story.** My design has Move but not Delete. The other team has tombstones. I should adopt tombstones.
- **The "icebreaker note" is plaintext-ish.** I described storing it on the daughter's hub; that means the daughter's hub can read it. It should be encrypted to the daughter's key.
- **The 2-of-2 XOR recovery was under-specified.** I described it but didn't say "the user generates share1 randomly on the device, computes share2 = key XOR share1, encrypts share1 to contact A's public key, encrypts share2 to contact B's public key, and uploads both." I described the result without specifying the construction.

# C. Reconciliation

## The hybrid design

The best of both is:

**Identity.** Ed25519 signing keypair + X25519 encryption keypair, both 32 bytes. Public keys in the actor profile. Key as identity, address as location, name as human-readable nickname. Same as both designs.

**Item format.** A binary envelope, no canonicalization. The publisher's app produces an item as bytes, signs them, stores them at a conventional path on the hub. The format:

```
[4 bytes magic: "PRSN"]
[1 byte version: 0x01]
[1 byte content-type-id: see registry below]
[8 bytes body length, big-endian, unsigned]
[N bytes body — any format]
[64 bytes Ed25519 signature, over bytes [0..12+N])
```

Content-type IDs: `0x01` = JSON (with the implementer's choice of canonicalization or none, since the bytes are signed), `0x02` = JPEG, `0x03` = PNG, `0x10` = CBOR, `0xFF` = opaque. The signature is over the magic, version, type, length, and body. The reader parses the body according to the type.

For text content, use JSON (type `0x01`) and let the publisher's app serialize however it likes, as long as the bytes are stable. The bytes are the canonical form because they are signed. A reader that wants to display the JSON parses it; the bytes are whatever the publisher produced.

**Hub interface.** Signed PUT to `https://{hub}/actor/{name}/items/{item-id}` with the signed file as the body. Hub stores the body. Hub may verify the signature against the actor's public key (which it knows from the profile) and refuse to store items that don't verify. Hub exposes:
- `GET /actor/{name}/items/{item-id}` — the signed file
- `GET /actor/{name}` — the actor profile (also a signed file)
- `GET /actor/{name}/head` — the signed head
- `GET /actor/{name}/outbox.json` — a generated JSON Feed view of the public items (NOT signed; for interop only)
- `GET /actor/{name}/inbox` — POST target for incoming activities (signed)

**Head / completeness.** A small signed file listing the IDs of items currently in the outbox, in canonical order (e.g., by `published` timestamp, ties broken by item-id byte order). The head has its own sequence number; readers pin the head and notice when items disappear without a tombstone, or when the head goes backward.

**Deletion.** A signed tombstone file replaces the item. The hub removes the item file and adds the tombstone. The head is updated to include the tombstone's ID instead of the item's. Readers who already fetched the item keep their copy; the publisher's location is now silent about it.

**Move.** A signed item with type `Move`. The publisher's app pushes this to *followers' inboxes* (yes, push; this is required, not an extension — see below).

**Audience sealing.** The recipient list uses hashed key IDs: `key_id = SHA-256(pk_enc || salt)`, where the salt is per-message. The hub sees the hashes, not the keys. Bob's device computes the hash of his own key and looks it up in the list. This costs Bob O(N) hash computations per message, which is fine for family-scale audiences. It does not hide the audience from a hub that knows the recipients' keys (which it usually does in a family), but it raises the bar for the casual observer and makes the audience hard to enumerate from the activity alone.

**Encryption construction.** Use HPKE (RFC 9180) with DHKEM-X25519-HKDF-SHA256 + ChaCha20-Poly1305. One HPKE seal per recipient. The encrypted activity contains the ciphertext, the list of HPKE ciphertexts, and the hashed key IDs. This is an audited construction and replaces the hand-rolled encryption I specified.

**Push (inbox) is first-class, not an extension.** The inbox is a core feature because Scenario 1 (relocation against a hostile hub) requires it. The push channel is needed specifically for:
- `Move` activities, so a hostile hub cannot suppress relocation.
- `Follow` activities, so a follower on a different hub can be reached.
- Replies to private posts, so the hub cannot suppress inbound replies to encrypted threads.

The hub must accept POSTs to the inbox with an HTTP signature over the request, authenticate the sender, and store the activity. The hub does *not* need to deliver the activity to the recipient device — the device polls the inbox. The hub is a dumb store.

**Social recovery.** A `KeyChange` activity: `{type: "KeyChange", actor: alice, old_key: ..., new_key: ..., attestations: [{attester: bob_pubkey, sig: ...}, ...]}`. Each attester signs the body (minus the attestations). The protocol does not specify a threshold; each reader applies its own policy. Default threshold for "family" readers: any one attester whose public key the reader already trusts. The `KeyChange` is pushed to followers' inboxes so the news propagates even if the user's hub is hostile.

**Trust on first contact.** Include the first 4 bytes of the public key in the human-readable address (`alice#a1b2c3@hub.example`). The reader UI displays the fingerprint on first contact and asks the user to verify. For the threat model in the brief, this is the load-bearing mitigation. Both designs lacked it; the reconciled one has it.

## What neither design considered

I think there are five things both designs leave out that matter.

**1. First-contact trust.** Already discussed above. The biggest gap. The reconciled design addresses it with fingerprints in the address.

**2. Multi-device key handling.** Real users have phones and laptops. Neither design specifies how Alice publishes from two devices. The natural answer is "the actor profile lists multiple signing keys, each tagged with a device id; activities carry the device id in the signature; readers accept any device's key." This is a 5-paragraph addition to the spec, and neither design has it.

**3. Inbox spam and rate limits.** If push is first-class, the inbox is a spam surface. A hostile actor can flood Alice's inbox with junk activities. The design needs:
- HTTP signature requirement on POSTs (so the attacker has to use a key; they can generate a fresh key per attempt, so this is not enough).
- Rate limits at the hub, by source IP and by source key.
- Reader-side filters (block lists, "only accept inbox posts from people I follow").
- A spam-classification signal the hub can compute (e.g., "this sender has no followers; bucket them").

Neither design addresses this. The pull-only design (the other team's) avoids it but at the cost of breaking relocation. The reconciled design needs both.

**4. Hub authentication.** TLS gives transport security, but the device has to know it is talking to the real `family.example` and not an attacker with a misissued cert. Standard answer: certificate transparency + pinned roots. The design could include an optional `hub_key` field in the actor profile that pins the hub's TLS public key (HPKP-style, but opt-in). Neither design has this.

**5. Group membership changes with forward secrecy.** If Alice posts to Bob and Carol, then removes Carol, Carol still has the content key. To prevent Carol from reading future posts, the group must re-key. To prevent Carol from reading past posts she already received, nothing helps (she has them). The design could specify:
- A "thread key" separate from the per-message content key.
- When the audience changes, the thread key rotates.
- Old messages encrypted under the old thread key remain readable to anyone who had the old key.
- This is honest forward secrecy for the *future*, not the past.

Neither design has this. It is hard to retrofit. The reconciled design should at least name it as a known limitation.

**A framing both designs have wrong.** Both designs treat the hub as a passive storage-and-serving layer, with encryption and signatures doing the security work. The threat model is a hub that *acts* (suppresses, substitutes, withholds). The defenses (signatures, encryption, push channel) work against a hub that *modifies*. They only partially work against a hub that *withholds*. The fundamental asymmetry is: a hub can always refuse to serve, but it cannot forge. The design should acknowledge this asymmetry everywhere and design around it: every operation the hub can withhold needs a fallback that does not require the hub.

The other team's design gets this asymmetry right for reading (the reader can detect withholding via the head). My design gets it wrong for relocation (the Move can be withheld; the push is the only fix). The reconciled design makes push mandatory precisely because withholding is the hub's strongest attack.

# D. Answers to the five open questions

**1. The publish interface.** A signed PUT to conventional paths is the right answer. The publisher's app issues `PUT https://{hub}/actor/{name}/items/{item-id}` with the signed file as the body, content-type `application/octet-stream`. The hub stores the body as-is. The hub may verify the signature against the actor's signing key (which it knows from the actor's profile PUT earlier) and refuse to store items that don't verify. The hub exposes `GET` on the same path. The hub generates a JSON Feed view from the items in its directory for interop, but the JSON Feed is not signed and is a cache. The interface is small: PUT and GET on items, PUT and GET on the profile, PUT and GET on the head, POST to the inbox. Six endpoints.

**2. The encryption construction.** Use HPKE (RFC 9180) with `DHKEM-X25519-HKDF-SHA256` + `ChaCha20-Poly1305`. This is the IETF standard, audited, in libraries everywhere (though not in every standard library — the implementer may need to do HPKE's Expand/Extract sequences from HKDF-SHA256 and ChaCha20-Poly1305 primitives that are in their stdlib). For multiple recipients, run HPKE `SetupEncrypt` once per recipient, each producing a separate HPKE ciphertext. The activity contains the encrypted body, the list of `(key_id, hpke_ciphertext)` pairs, and the hashed key IDs. The hub sees hashed key IDs, ephemeral public keys, and ciphertext sizes; the recipients find their entry by hashing their own public key with the message salt. This is the construction I would specify; the other team should adopt it.

**3. Social recovery threshold and trust set.** The threshold is a per-reader policy, not a protocol value. The protocol supports this by carrying N signatures from N peers on a `KeyChange` activity; the reader applies its own rule. A reasonable default for a family reader: accept any `KeyChange` where at least one attester's public key is in the reader's "trusted peers" set, where the trusted peers set is built up from prior interactions (people the reader has previously verified). The trust set is never published (correct, as the other team says) — it is the reader's private state. The `KeyChange` activity itself is public, signed by the attesters, so any reader can see who attested.

**4. The head.** The head is a separate small signed file (`head.signed`), not the generated feed view. It contains:
- A monotonically increasing sequence number.
- The IDs of items currently in the outbox, in canonical order.
- The actor's signature over the preceding fields.

The generated JSON Feed view is a cache for interop; it can be regenerated at any time from the items in the directory. The head is the source of truth for "what items exist at this location right now." Readers pin the head. When the head sequence goes backward, the reader knows it is being served stale data. When an item in the pinned head is missing on a subsequent fetch, the reader knows it has been removed without a tombstone. When a tombstone appears in a new head, the reader knows the removal was authorized.

**5. Whether push should exist at all.** Push must exist, as a first-class mechanism, not an extension. The reason: relocation against a hostile hub requires it. A hostile hub can suppress a Move; readers polling the hostile hub will never see the Move; readers will not learn the new location. Without push, the floor assurance "the host cannot keep you" cannot be delivered by the core protocol — only by an extension that the spec does not require.

The metadata cost of push is real. The hub sees inbound connections from other hubs (or from the user's device when the device pushes directly). For a family, this is acceptable: the hub already knows the family members. For broader use, the design can mitigate by:
- Pushing from the user's device, not the user's hub, so the inbound connection appears to come from a residential IP, not a hub IP.
- Using a relay that aggregates pushes from many users, so individual connections are not visible to the recipient hub.
- Accepting the metadata cost as the price of the floor.

My position: push is mandatory, the metadata cost is acceptable for the target audience (families), and the spec should specify the inbox semantics (idempotent by activity id, FIFO ordering, signed POSTs with draft-cavage HTTP signatures using Ed25519, retention GC'd by reader acknowledgement). I would refuse to leave push as an extension; the extension framing makes the design fail Scenario 1.

---

# Summary

The other team's direction has a real architectural advantage in format, completeness, and deletion model, but loses on relocation because it makes push optional. My design gets the floor right by making push mandatory, but loses on canonicalization, completeness, and deletion, and has an under-specified inbox. The reconciled design takes the file-based signing from the other team, the mandatory push from my design, HPKE as the encryption construction, hashed key IDs for audience hiding, fingerprints in the address for first-contact trust, and an explicit tombstone + head model for deletion and completeness.

The thing neither design considered and that I now think is the most important: **trust on first contact**. Both designs assume the URL is honest. The threat model says the hub is the adversary from the first interaction. The fix is fingerprints in the address and a verification step in the UI. Without it, the floor is built on sand; with it, the floor holds.

<details><summary>Model reasoning trace (48288 chars) — kept because rejected alternatives often live here</summary>

```
The user has given me a serious, thoughtful design brief and then the other team's direction. I need to:
- A) Attack the other team's direction
- B) Attack my own design
- C) Reconcile
- And answer their five open questions

Let me think carefully about each.

---

## A) Attacking the other team's direction

The other team's direction has several specific mechanisms:
1. Identity = key, location = URL, profile signed and lists current location(s)
2. Signed location list with sequence numbers
3. Device is the only signer; hub stores; bring-your-own-client (BYOC) is the security property
4. Signed items are FILES, signed as bytes served — NO CANONICALIZATION
5. Key change = "B succeeds A" signed by A (or by enough trusted peers)
6. Publisher forgets; readers remember; deletion = tombstone
7. Completeness = signed sequenced head listing what exists
8. Everything is pull — interactions are items in the author's feed; no inbox in core
9. Three tiers via one mechanism: public, encrypted to set (with identities sealed inside), DM is encrypted to one

Key things to attack:

**"Signed as bytes served" — no canonicalization**

This is huge. If the hub serves a file and the signature is over the bytes-as-served, then the hub controls the bytes. The hub can:
- Add/remove trailing whitespace
- Add/remove BOM
- Change newline conventions (CRLF vs LF)
- Add trailing newline
- Change key ordering in JSON (wait, but they say "files" — are the signed items JSON? The summary says "items" not specifically JSON files. They say "Signed items are files, signed as the bytes served" and "JSON Feed / Atom feed and the profile page are generated views — required of publishers as the interop surface, never the signed object.")

OK so the signed object is a binary file (or whatever) and the signature is over the literal bytes the hub serves. This means:
- The signature must include everything served. So if a hub adds a Content-Type header in a way that affects bytes... wait, content-type isn't bytes. But if the file is served with a charset declaration, that's metadata.
- More importantly: any compression (gzip, brotli) would change the bytes. So either compression is forbidden, or signatures are over uncompressed bytes and the served bytes may differ.
- If signatures are over uncompressed bytes and the hub serves compressed bytes, the reader must decompress before verifying. That's fine.
- BUT: if signatures are over the bytes-as-served, then a hub that changes the file (e.g., re-encodes a JSON view) invalidates the signature. The reader detects modification.

Actually wait. Re-reading: "Signed items are files, signed as the bytes served." This means: the publisher creates a file, signs it, and the hub serves that file. The signature is over those exact bytes. If the hub changes them, the signature fails.

This is actually MORE robust than canonicalization, in some sense, because there's no canonicalization rule to mismatch. But it raises the question: how does the reader know what subset of the served file is the signed payload? If the served file is a JPEG with EXIF metadata and a signature appended, the reader must know where the signature is and what bytes it covers.

Possible formats:
- Concatenated: bytes || signature
- Length-prefixed: length || bytes || signature  
- Sidecar: bytes + bytes.sig file
- Wrapped envelope: { payload, signature, key_id } where the signature is over the payload part

If it's the last, you DO have canonicalization concerns (how is "payload" serialized as a length-prefixed chunk?). If it's the first two, the format is unambiguous.

The bigger issue: **the hub serves what the publisher signed, but the publisher might sign something semantically wrong**. The signature binds bytes, not semantics. The reader must parse the bytes to know what they mean. This is fine, but it means a hub can serve the same file with different MIME types — wait, MIME type isn't bytes. Headers aren't bytes (well, the body is).

OK so for "no canonicalization" as a defense against canonicalization bugs, this is good. But it doesn't solve the JSON-parsing-attack-vector: a reader that interprets JSON differently than the publisher might be fooled. The signature is over bytes; both reader and publisher must agree on what the bytes mean.

Hmm, this is interesting but I don't think it's the main attack.

**Attack: "Signed location list with sequence numbers — a location statement with a higher sequence wins"**

This is the relocation mechanism. But sequence numbers are tricky. Who assigns them? The signer. So Alice's first Move says "I'm at location A". Second Move says "I'm at location B" with sequence 2. Readers see Move 2 and update.

But: the hostile hub sees Alice sign Move 1 with her key. It can replay Move 1 later and claim that's the current one (because it has sequence 1, which is older, but maybe the reader doesn't know about Move 2?). Actually if the reader has Move 2, it knows Move 1 is stale. If the reader has only Move 1 (never got Move 2), and the hub serves Move 1, the reader believes it. But Move 2 was sent to the readers' apps via... push? They say everything is pull. So Move 2 must be fetched.

If Move 2 is in the new location's feed, the reader needs to know to fetch the new location. But the reader doesn't know to look there until it gets the Move. So how does Move 2 propagate?

Wait — they say "Readers remember every location a profile has ever named and check the others when the primary goes stale." So readers track ALL historical locations. But how does the reader learn about new locations? If Alice moves, and the reader only knew the old location, and Alice's app signs Move 2 and pushes to... where?

If everything is pull, then Move 2 lives in Alice's new location's feed. The reader doesn't know about the new location until it sees Move 2. But Move 2 is in the new location's feed. So the reader must check the new location to find Move 2. But it doesn't know about the new location.

The reader could check the OLD location's feed for Move 2. If Alice signed Move 2 and uploaded it to her OLD hub (which is the hostile hub), then the hub could refuse to serve it. Or serve an older version. Or strip it.

If Alice signs Move 2 only on her NEW location's feed, then the reader doesn't know to look at the new location.

This is a real problem. They say "the location list" is in the profile. If the hub modifies the profile to remove old locations, the reader loses track.

Concrete attack (Scenario 1 — the divorce):

1. Alice's account is on `family.example` (hostile ex).
2. Alice signs a Move to `newhub.example`. Sequence 2.
3. Alice's app tries to publish the Move. Where? Two options:
   - **Option A**: Publish to old hub. The hostile hub refuses to serve it, or serves only Move sequence 1. The reader never learns about the new location.
   - **Option B**: Publish only to new hub. The reader doesn't know about the new hub.
4. Even if Alice pushes the Move to her followers' apps, there's no push mechanism in the core ("a push ping, inbound interop, and direct messages that must not appear on any feed are extensions"). So readers who knew Alice before are stuck with the old hub.

How does the reader recover? It checks the old hub. The hub says "Alice is still here, here's her profile." Maybe the hub serves the profile with `moved_to` field stripped. Reader has no way to know.

Unless: the reader tracks every location the profile has ever named, including locations the profile used to list. If Alice's app, when it signed Move 1 to the old hub, also wrote the Move somewhere the hub can't suppress... but there's no such place.

This is a **real failure of Scenario 1**. The other team's design claims to handle relocation but their everything-is-pull design makes relocation brittle. The hostile hub can simply refuse to serve Move 2, or modify the profile to omit it, and readers won't know.

Compare to my design: I have an inbox and the user's app pushes the Move to followers' inboxes. The followers' apps get the Move even if Alice's hub is hostile. The hub's cooperation is not required.

So the other team's design has a fundamental fragility: **move propagation depends on the hostile hub cooperating**. This breaks Scenario 1 and also breaks Scenario 4 (the domain goes) in a worse way — readers who subscribed via WebFinger or whatever and don't have Move 2 are stuck.

Actually wait, let me re-read: "Readers remember every location a profile has ever named and check the others when the primary goes stale." So readers track historical locations. But how do they learn of new ones? Either:
- The new location is named in a Move published somewhere
- Or the reader has to discover it by other means

If Move is in the new location's feed, reader must know about new location first. Chicken-and-egg.

If Move is in the OLD location's feed (the hostile hub), the hostile hub can suppress.

I think the other team is hoping for: the reader polls the old hub. The old hub is asked for "everything Alice has ever published, by location list". The reader gets the Move sequence 2 (if the hub serves it). The reader then knows about the new location and fetches from it.

But the hostile hub can refuse to serve Move 2. The reader has no recourse. The design's "the host cannot keep you" assurance is broken because Move propagation goes through the host.

This is a strong, specific attack. Let me crystallize it.

**Attack: "BYOC as a security property"**

They say "bring-your-own-client is treated as the security property, so the specification includes a small publish interface — how any client writes signed files to any hub — so clients and hubs form a market rather than a pairing."

This is interesting. The security model is: the app is separate from the hub. The user picks an app and a hub. The app signs, the hub stores.

But this means: if the user picks the official app from the official hub company, they get the official pairing — which has the key. The "market" framing only protects users who actually bring their own client.

For grandma, the official app on the official hub is the only realistic option. So the security property evaporates for the target user.

Furthermore: even if a user uses a third-party client, the client's job is to hold the key and sign. If the client is hosted on the hub (web app), the hub has the key in the browser's JS context — which is reachable by the hub's server (via JS injection, via compromised CDN, via XSS). So a "client" that runs on the hub is not really bringing their own client.

The security property of BYOC only holds if the client runs on the user's device and the user trusts the client. If the user trusts the official client from the official hub, the hub can compromise the client and the model collapses. The "market" framing is a fig leaf unless the client is genuinely on-device.

This is more of a critique than an attack, but it points to a weakness.

**Attack: "encrypted to a chosen set of keys with the recipients' identities sealed inside"**

They claim the identities are sealed — meaning the hub doesn't see the audience. My design explicitly accepts the hub sees the audience. Let me think about whether their sealing works.

For ECDH to work, the recipient needs to find their entry in the recipient list. The list is `(key_id, ephemeral_pub, wrapped_key)` triples. If `key_id` is the recipient's public key (in plaintext), the hub sees which keys can decrypt. The hub can match keys to identities (by looking up actor profiles), so the audience is not actually sealed.

Unless: the design uses some kind of private set intersection or oblivious lookup. That's expensive and not in a standard library.

I think "sealed" is hand-waving. The hub will see the audience by inspecting the key_ids. Unless the key_ids are themselves blinded (which breaks the recipient lookup problem — how does Bob find his entry?).

Maybe they mean: the key_ids are hashed, so the hub sees hashes but not keys. Then Bob must try every hash to find his. For a family-scale audience, this works. But Bob doesn't know what hash to look for without trying every entry. If there are N recipients, Bob does N hashes and N decrypt attempts. That's O(N) per message, which is fine for a family.

Actually, this is doable: `key_id = SHA-256(pk_enc || some_salt)`. Bob computes this for his own key and looks it up in the list. The hub sees the hash, not the key.

But the hub can do the same: for every profile it knows about, compute `SHA-256(pk_enc || salt)` and check if it's in the recipient list. If the hub is also Bob's hub (it has Bob's profile), the hub knows Bob's `pk_enc` and can compute the hash.

So the "sealing" works only if the hub doesn't know the recipient set. In Scenario 1, the hub is Alice's hub, which sees Alice's outgoing traffic and can infer who she's talking to from her lookups. The hub also probably knows the family members' profiles (because they may be on the same hub). So the hub can compute hashes and identify recipients.

The audience is not actually hidden from the hub in either design. The other team's claim of "sealed identities" is overstated.

Actually wait — the other team might mean something else. Let me re-read: "encrypted to a chosen set of keys with the recipients' identities sealed inside." Maybe they mean the encryption is "sealed" in the cryptographic sense (as in HPKE's "seal"), not that identities are hidden from the hub. Or maybe they mean the recipient identities (URLs) are not in the activity at all — only key IDs are.

Even with key IDs being hashes, the hub can identify recipients if it knows their keys. So this is not "sealed" in any meaningful sense.

This is a real critique but maybe not the strongest attack.

**Attack: "social recovery with trusted peers"**

They say "key B succeeds key A, valid when signed by A (ordinary rotation) or by enough peers a reader already trusts (social recovery)."

How does the reader know which peers to trust? They say "never published" for the trust set. So the trust set is private to the reader. But then social recovery depends on the reader's trust set, which is different for every reader.

If Alice's hub is hostile and Alice's keys are lost, and Alice wants to recover, Alice's recovery peers (her mom, her sister) sign "B succeeds A" for Alice. These signatures are presented to readers. But each reader decides independently whether to trust the signers.

For a family, "trust" is "anyone I've ever interacted with." For a stranger who only knows Alice's public feed, trust is "the same public key, in the same feed." The stranger has no peer trust set for Alice.

So social recovery works within a family but not for strangers. This matches my design's recovery contact mechanism (which is 1-of-N with the family as the trust set). The other team's design is similar in spirit but with the trust set being implicit and reader-dependent.

The problem: how does Alice's recovery peers know to sign? They must be told. How are they told? Out-of-band (a phone call). Same as my design. So the recovery mechanism is essentially the same; the other team's framing is just more flexible (any peer the reader trusts, not just designated recovery contacts).

I think this is OK, but the "enough peers" threshold is undefined. If Alice's recovery contacts (mom and sister) both sign, is that enough? What if a reader doesn't know either of them? Then the reader falls back to... what? Public key continuity? But the key has changed. The reader has no basis to update.

So for a reader who doesn't know the recovery peers, recovery looks like a key change with no chain of custody. The reader has to trust the new key based on... the absence of any other info? This is weak.

Hmm, but if the design says "a reader who trusts at least one signer of the recovery attestation updates to the new key, and a reader who trusts none of them falls back to the old key (or refuses to update)", that's defensible.

I don't think this is the strongest attack.

**Attack: deletion / publisher forgets / tombstone model**

"A signed tombstone" replaces the deleted item. "What a reader already fetched is the reader's."

In Scenario 1, the divorce: Alice wants her content gone from the hostile hub. She signs a tombstone. The hub... can refuse to serve it. Or serve it in a place readers won't look. The reader has the old content cached. The hub can keep serving the old content.

In my design: Alice signs a Move and pushes it to followers. Followers stop polling the old hub. The old hub's content becomes irrelevant.

In the other team's design: Alice signs a tombstone. It replaces the item at the old hub. If the hub refuses, readers keep seeing the old content. If Alice wants to make the old content disappear, she needs to either (a) convince readers to drop it (no mechanism) or (b) hope the hub cooperates.

This is similar to the relocation problem: the hostile hub controls the served bytes. Tombstones only work with hub cooperation.

**Attack: completeness story**

"A signed, sequenced head lists what exists; a reader may pin it and notice when something it saw vanishes without a tombstone."

This is the freshness mechanism. The reader pins the head, sees what items should exist, and detects when one disappears without a tombstone.

But: the head itself is signed and stored on the hub. The hostile hub can:
- Serve an old head (replay attack)
- Refuse to serve the head
- Strip items from the served head (but signature would fail... unless the head is generated from current state)

Wait, if the head is signed and the hub modifies it, the signature fails. So the head is tamper-evident. But the hub can refuse to serve it (denial of service) or serve an older one (which the reader could detect by seeing the sequence number go backward... but readers may not track sequence history).

Hmm. If the reader has pinned head N, and the hub serves head N-1, the reader can detect this (N-1 < N). But if the hub just refuses to serve any head, the reader is stuck.

And the hub can also modify the items referenced by the head. The head says "items 1, 2, 3 exist." The hub serves items 1, 2, and refuses 3. The reader has to compare the head's list to what it can actually fetch and notice the gap.

In a hostile hub scenario, this is detective work the reader must do on every fetch. It's not catastrophic, but it means the reader is doing a lot of work to detect a hostile hub.

**Strongest attack: Scenario 1 (the divorce) breaks under "everything is pull"**

Let me focus on this as my main attack. The sequence:

1. Alice is on `family.example`, run by her hostile ex.
2. Alice wants to leave.
3. Alice's app signs a Move activity, sequence 2, pointing to `newhub.example`.
4. Alice's app uploads the Move to `family.example` (the only place to put it, since there's no inbox).
5. The hostile ex sees the Move (he's watching his own hub) and refuses to serve it. Or strips it from the feed. Or serves an older version where Alice's profile points back to `family.example`.
6. Alice's followers, who know Alice at `alice@family.example`, continue to fetch from `family.example`. They see Alice's old content. They never see Move 2. They don't know to look at `newhub.example`.
7. Alice's mother might be one of these followers. She calls Alice and asks "why aren't you posting?" Alice explains she moved. Mom manually goes to `newhub.example` to find Alice. The reader's auto-discovery has failed.
8. Worse: Alice's readers, who only know the old public key, see Alice's old content continue to appear. They have no signal that it's stale.

Compare to my design:
- Alice's app pushes the Move directly to her mother's hub, sister's hub, etc.
- The Move arrives in their inboxes.
- Their readers verify Alice's signature on the Move (against the public key they already have).
- They update their subscriptions to the new location.

The other team's design has no equivalent. It assumes the hub will serve the Move. In Scenario 1, the hub won't.

This is the core attack. Let me articulate it clearly.

Actually, let me also note: the other team says "a push ping, inbound interop, and direct messages that must not appear on any feed are extensions." So they do allow a push mechanism as an extension. But the security of relocation in the core depends on the hub serving the Move. The push extension doesn't help with relocation, because the Move must be published *as the latest item in Alice's feed* (i.e., at her location), and her location is the hostile hub.

OK so this is the attack. Let me write it up.

**Other things to note positively about the other team's direction:**

1. **No canonicalization** — this is genuinely good. Canonicalization bugs are a real source of interop failures. If they have a clean way to sign bytes-as-served without canonicalization, that's a real win. (But it requires a careful format spec — see critique below.)

2. **The "head" / completeness model** — clever. Pinning a sequenced head and detecting missing items is a lightweight freshness mechanism. Better than nothing.

3. **BYOC framing** — the idea that the security property is the separation between app and hub, not just the protocol between them, is right. A protocol that assumes the client is part of the hub is weaker than one that explicitly separates them.

4. **Reader-side memory** — "the publisher forgets; readers remember" is a nice privacy property. If Alice deletes a post, the readers' caches still have it, but Alice's hub doesn't have to retain it. Reduces hub storage.

5. **No inbox in core** — they correctly identify that an inbox is a push-receive surface that creates spam and metadata issues. Making push an extension is a clean architectural choice.

6. **"Sealed" audience** (if they mean hash-based key IDs) is a nice audience-hiding attempt. My design doesn't try. If their construction works, it's an improvement.

But there are weaknesses.

---

## B) Attacking my own design

What did I get wrong or hand-wave?

1. **The outer SHA-256 before Ed25519 signing.** I flagged this as uncertain. I think I should drop it. It's redundant and adds 32 bytes per activity.

2. **Fixed-nonce ChaCha20-Poly1305.** I flagged this. It's non-standard. A random nonce is more conventional. The "deterministic encryption" benefit is marginal.

3. **Canonical JSON.** This is the biggest practical weakness. Getting canonicalization right across implementations is hard. The other team's "no canonicalization" approach is genuinely better here, IF they have a clean format. My design inherits a real implementation burden.

4. **The recovery flow for grandma.** I flagged this as the most user-hostile part. The "phone call to the daughter, who approves on her device, who must have the app installed" is a lot of moving parts. For grandma, simpler is better.

5. **No audience hiding from the hub.** I accepted this explicitly. The other team claims "sealed" identities. If their sealing works (even partially), it's an improvement.

6. **HTTP signatures for inbox POSTs.** I mentioned a "minimal subset" but didn't specify it. This is hand-waved. Implementers will struggle.

7. **Inbox semantics.** I said "the inbox is a collection that receives POSTs" but didn't specify deduplication, ordering, retention, etc. Real hubs will implement this differently. Interop breaks.

8. **The "head" / completeness model.** I have nothing like this. A reader can pin my outbox and notice items disappearing, but there's no signed head attesting to "these are the items." This means a hostile hub can serve truncated views and the reader has no way to know what's missing.

9. **Deletions.** My design says "Alice signs a Move" but doesn't address whether Alice can delete items from the hostile hub. She can't — the hub has the data and can keep serving it. I have no tombstone mechanism.

10. **The "Move" / relocation assumes the push channel.** My design depends critically on the push channel for relocation. If the push channel is unreliable or hostile, the Move doesn't propagate. I should have been more explicit that the push channel is load-bearing.

11. **The "dumb hub" is not really dumb.** A hub that doesn't enforce access control (because encryption does) but does store and serve — that's a thin layer, yes. But it still has to do WebFinger, serve the outbox, accept inbox POSTs, validate HTTP signatures, etc. A truly dumb hub (file dump on S3) doesn't work. I overstate the simplicity.

12. **WebFinger dependency.** I rely on WebFinger for discovery. WebFinger is a simple protocol but it's not "from your language's standard library" — it's an HTTP endpoint. I treat it as a primitive but it's a service. If `family.example` doesn't run WebFinger, discovery fails. I should have specified the fallback (know the actor URL directly, or have it out-of-band).

13. **The "no global registry" trade-off.** I accepted that strangers lose track after a move. The other team accepts the same. This is a real cost. For a "family" use case, fine. For broader use, it's a problem. I should have thought harder about whether there's a way to have lightweight discovery without infrastructure.

14. **No rate limiting / anti-abuse.** Same as other team. Acknowledged.

15. **The 2-of-2 XOR recovery scheme.** I described it but didn't say how to verify it works. The XOR of two shares must equal the key. This is trivial but easy to get wrong (one share is the key, the other is zeros — useless). I should have specified the construction more carefully.

16. **The "icebreaker note" in grandma's recovery bundle.** This is a nice UX touch but it's stored on the daughter's hub in plaintext (or encrypted to the daughter's key). The daughter's hub sees it. If the daughter's hub is hostile, the icebreaker note is visible. I should have encrypted it.

17. **The HTTP signature scheme for inbox POSTs.** I punted on this. The other team avoids it by not having an inbox. I should have either specified it or removed the inbox.

18. **The "key changes" / "loss" / "theft" sections are reasonable but I don't address contested departure deeply enough.** I have a "notary" mechanism (recovery contacts counter-signing the Move) but it's vague. The other team's "trusted peers sign 'B succeeds A'" is essentially the same idea, named differently. Mine is weaker in presentation.

---

## C) Reconciling

The best design is a hybrid. Let me think about what the core primitives should be.

**Things to take from my design:**
- Identity as Ed25519 keypair (also good for the other team)
- Encryption with X25519 + ChaCha20-Poly1305
- The four floor assurances as the goal
- Move activity for relocation
- Recovery contacts with social recovery
- Push from device for relocation (this is load-bearing)

**Things to take from the other team's design:**
- No canonicalization — sign bytes-as-served
- BYOC: explicit client/hub separation
- "Publisher forgets; readers remember" — deletion via tombstone
- Head / completeness model
- Optional audience sealing via hashed key IDs
- No inbox in core — pull is the default

**Key tensions:**

1. **Canonicalization vs. no canonicalization.** The other team's approach is better if they have a clean format. My approach is better if they don't. I think the no-canonicalization approach is cleaner IF the format is "concatenated signed file" — e.g., a CBOR structure with explicit lengths, or a flat binary format. But that means non-JSON signed objects, which limits who can inspect them (humans can't read them, the brief allows this).

Actually, looking at this again — the brief allows non-human-readable wire bytes. So a binary format is fine. Let me propose:

**Reconciled approach:** signed items are binary files. The format is:
- 4-byte magic ("PRSN")
- 4-byte version
- 32-byte content-type hash (identifies the schema)
- 4-byte body length
- N bytes of body (canonical, schema-defined; for JSON, RFC 8785 JCS; for binary, schema-defined)
- 32-byte signature input hash
- 64-byte Ed25519 signature

Actually this is getting complex. Simpler: use CBOR with deterministic encoding (RFC 8949), or just use plain JSON with the canonicalization rules. But "no canonicalization" is a real win...

Hmm, let me think. The other team's "sign the bytes" approach is good if the bytes are unambiguous. If the file is a JPEG, the bytes are unambiguous. If the file is JSON, the bytes are not unambiguous (key ordering, whitespace, etc.). So:
- For binary content (images, etc.), sign the bytes.
- For JSON content, sign a canonicalized form, OR sign a length-prefixed CBOR encoding.

If we use CBOR with deterministic encoding (RFC 8949 §4.2.1, "Core Deterministic Encoding Requirements"), we get unambiguous bytes without canonicalization rules to specify separately. This is the right answer.

Or: use plain JSON with JCS (RFC 8785) as a strict subset. JCS is in many standard libraries now? Probably not. But it's well-specified and short. The implementer can implement it in 50 lines.

I think the cleanest reconciled approach: **CBOR with deterministic encoding**, signed as bytes. The implementer uses their language's CBOR library — but the brief says no third-party libraries. So... implement CBOR in your weekend? CBOR is more complex than JSON canonicalization.

OK so maybe: **plain JSON, JCS (RFC 8785)**. The implementer reads RFC 8785 (10 pages), implements it in a weekend, signs the canonical bytes. Or even simpler: define a stricter canonical form (the one I defined: UTF-8, sorted keys, no insignificant whitespace, integers only, escape per RFC 8259). 50 lines.

The no-canonicalization ideal is appealing but creates format-design work. The canonicalization approach creates canonicalization-implementation work. They're about equivalent in cost. I'll go with canonicalization in the reconciled design, but acknowledge the trade-off.

Actually, wait. Re-reading the other team's brief: "Signed items are files, signed as the bytes served." The signed item is a file the user creates. The user could create it in any format — JSON, CBOR, a custom binary format. The signature is over the file bytes. The reader must parse the file according to its declared type.

If the file declares its type (e.g., a magic number at the start, or a content-type hash), the reader knows how to parse it. If the file is JSON, the reader parses JSON and must trust the publisher's serialization — but since the bytes are signed, the reader knows exactly what bytes were signed. If the bytes are `{"a":1,"b":2}` the signature is over those bytes. The reader sees `{"a":1,"b":2}` and the signature verifies. If the publisher serializes differently each time, the signature changes — but the reader sees the same bytes each time (because the publisher saved them).

So the trick is: the publisher saves the exact bytes they signed. The hub serves those bytes. The reader verifies the signature over those bytes.

For the reader to interpret the JSON, the reader needs to parse it. JSON parsing is standard. The reader gets the exact same JSON the publisher wrote.

This is actually cleaner than canonicalization. The bytes are whatever the publisher decided. The signature is over them. No canonical form needed. The reader and publisher agree on the schema (the JSON shape), not on the serialization.

This works. And it's simpler to implement than JCS. The publisher's app produces some JSON; the publisher's app signs those exact bytes; the hub serves them; the reader parses them; the reader verifies the signature.

The cost: if the publisher's app serializes differently on different occasions (e.g., different key ordering), the same logical activity has different signatures. This is fine for verification but breaks deduplication if the reader hashes the bytes (they'd hash differently for the same logical content).

OK so the no-canonicalization approach is genuinely cleaner for the publisher-side and reader-side, at the cost of byte-level dedup.

In the reconciled design, I'll go with: **signed items are bytes, signature over the bytes, content-type hash indicates the schema**.

2. **Inbox vs. no inbox.** The other team's pull-only design is elegant but breaks under the hostile-hub relocation scenario. My push design is ugly but works. The reconciliation: **make push an extension, but specify the semantics of the inbox so that implementations can interoperate.** The other team allows this as an extension; I should adopt that framing.

But the relocation scenario REQUIRES push to be reliable, because the hostile hub can suppress Moves. So push is not optional for the floor assurance #3 ("the host cannot keep you"). The other team's design fails this assurance.

I think the right answer is: **push is part of the floor**, not an extension. It's needed for relocation to work against a hostile hub. The other team's framing (push as extension) is wrong because it leaves a hole in the floor.

3. **Audience hiding.** The other team's claim of "sealed identities" via hashed key IDs is intriguing but not fully specified. If implemented (with hashed key IDs + per-recipient ephemeral keys), it works to hide the audience from the hub, *if the hub doesn't know the recipients' public keys*. But in a family scenario, the hub probably does know (because it serves some of the recipients). So the audience is partially hidden but not fully.

In the reconciled design, I'll adopt hashed key IDs as an optional feature (or default if it's simple enough). It costs little and provides meaningful audience hiding when the hub doesn't know the recipients.

4. **Deletions / tombstones.** The other team's tombstone model is good. I'll adopt it.

5. **Head / completeness.** The other team's sequenced head is good for the reader to detect tampering. I'll adopt it.

6. **BYOC.** The other team's framing of "the client/hub separation is the security property" is right. I'll adopt it.

---

**What neither design considered?**

Let me think hard.

1. **Group encryption with membership changes.** Neither design addresses what happens when the audience of an encrypted thread changes. If Alice posts to Bob and Carol, then later removes Carol, how does Carol get removed? In both designs, Carol has the content key and can decrypt old content. Forward secrecy for group membership changes is hard. Neither design addresses it.

2. **Spam at the inbox level.** Both designs punt on spam. The pull-only design avoids inbox spam by not having an inbox. The push design needs rate limits and anti-spam. This is a real gap.

3. **Hub authentication.** How does the device know it's talking to the real hub? TLS gives transport security, but the hub's identity is just a domain name. If the user's DNS is compromised or the hub's TLS cert is misissued, the device might talk to the wrong hub. The design should include hub key pinning or similar. Neither addresses this.

4. **Metadata at the network layer.** Both designs assume the network is observable by the hub. The hub sees IPs, sizes, timings, even if it can't read the content. Neither addresses traffic-analysis resistance at the network layer (the brief explicitly limits this to "hiding who an encrypted message is for," which we partly address with hashed key IDs).

5. **Post-quantum cryptography.** Both designs use Ed25519 and X25519, which are not post-quantum. The brief doesn't require post-quantum, but neither design addresses the migration path.

6. **Multi-device.** What if Alice wants to use two devices? Both designs assume one device = one signing key. To use multiple devices, Alice would either (a) sync the key between devices (which has its own security issues) or (b) use multiple keys (which complicates identity). Neither addresses this.

7. **Offline publishing.** What if Alice wants to post from a device that has no network? She can sign on the device. The hub stores it. But pushing to followers requires network. The design supports offline *signing* but not offline *delivery*. Acceptable, but worth noting.

8. **The hub's view of the activity graph.** The hub sees the structure of the social graph (who follows whom, who replies to whom) even when content is encrypted. Neither design hides this. For a family, the hub already knows the family. For a stranger, the hub learns the social graph. Hiding this is hard.

9. **Trust in the first actor profile.** Both designs have a bootstrap problem: how does the reader know the public key for `alice@hub.example` is really Alice's? They trust the hub to serve the right profile. If the hub is hostile, it can serve a fake profile with the attacker's key. The reader would follow the attacker's feed, thinking it's Alice's.

Mitigations:
- Out-of-band verification (Alice tells you her public key fingerprint over a secure channel)
- Multi-hub verification (check Alice's profile from multiple sources)
- Web of trust (sign public key with other trusted keys)

Neither design addresses this systematically. This is a real gap.

10. **Revocation beyond Move.** Neither design addresses "Alice's key was compromised; how do readers know to stop trusting it?" My design has a revocation note; the other team's has the same problem. There's no mechanism to broadcast a revocation except through the same channels (which may be hostile).

11. **The cost of "everyone pushes to everyone."** In a federation model where every device pushes to every follower's inbox, a user with N followers creates N HTTP requests per post. For a family, N=10, fine. For a "big lazy hub" with 10K users per hub, N might be 100-1000 per user, also fine. But for a celebrity, N=1M, this is a problem. Neither design addresses this; both claim "small groups" as the target.

12. **The cost of storing the inbox.** A hub that accepts inbox POSTs for all its users has unbounded storage. If the device doesn't poll the inbox, the inbox grows. Garbage collection requires knowing what's been delivered. Neither design addresses inbox GC.

13. **The cost of storing the outbox.** If a user has been publishing for 10 years and never deletes, their outbox grows. The brief says "millions of items per identity" is a non-goal, but it doesn't bound the size of a typical user's outbox. A family that takes photos and posts daily could hit thousands of items per year. Storage and fetch cost grow.

14. **Search.** Neither design addresses search. A user wants to find "the post I made about the trip to Yellowstone in 2023." Without search, they scroll. For a small outbox, fine. For a large one, painful.

15. **Identity portability.** Both designs have identity = key. The key lives on the device. If the device is lost and no recovery contacts, identity is lost. Both designs accept this. But: what about identity portability across devices? My design requires the device to hold the key. If Alice wants to publish from her phone and her laptop, she needs the key on both. Sync mechanisms exist (iCloud Keychain, etc.) but are device-specific. Neither design addresses this.

OK let me pick the most important ones to highlight:

**Top gaps neither design addresses:**

1. **Hub authentication / first contact trust.** Bootstrap problem: how does the reader know the public key is genuine? Both designs trust the hub on first contact, which is exactly the threat model we're designing against. This is the most important gap.

2. **Multi-device key handling.** Real users have multiple devices. Neither design addresses it.

3. **Spam at the inbox level** (more relevant to my design with push).

4. **Group encryption membership changes.** Hard problem, but relevant for families that grow/shrink.

5. **First-contact trust** deserves more attention. Let me think about this.

In my design: Alice's mother fetches `alice@hub.example` via WebFinger. Gets the actor URL. Fetches the actor URL. Gets the actor profile. The actor profile includes Alice's public key. The mother verifies the profile's signature with the public key in the profile. Wait — circular! The signature is verified with the key it's verifying. This doesn't prove anything.

So the security of first contact is entirely on the URL: if `hub.example` is honest, the profile is genuine. If `hub.example` is hostile, the profile can be fake.

This is the fundamental weakness. The other team's design has the same weakness: trust the hub on first contact.

The mitigation: out-of-band verification. Alice tells her mother "my public key fingerprint is `a1b2c3...`." Mother verifies when she fetches the profile. If they match, the profile is genuine.

This is the design's load-bearing trust mechanism, and neither design makes it explicit. Both rely on the URL being honest, with out-of-band verification as the escape hatch.

A proper design would include:
- Key fingerprint as part of the human-readable name (e.g., `alice#a1b2c3@hub.example`)
- A way to compare fingerprints in the UI
- A way to mark a key as "trusted" so subsequent changes (rotation) require re-verification

Neither design does this systematically.

---

## Answers to the five open questions

Let me answer each.

**1. The exact shape of the publish interface (a signed PUT of files at conventional paths is the candidate).**

A signed PUT of files at conventional paths is roughly right. The publisher signs a file and PUTs it to a hub at a path. The hub stores the file (with its signature) and serves it on GET. The hub may also generate a JSON Feed view from the signed files (as the interop surface) but never modifies the signed bytes.

Specifically: the publisher's app issues an HTTPS PUT to `https://{hub}/actor/{name}/items/{activity-id}` with the signed file as the body. The hub stores the body. The signature is part of the file (e.g., appended) or in a sidecar file at `{activity-id}.sig`. The hub may verify the signature before accepting (to prevent the publisher from uploading junk that won't verify later) but this is optional.

For the profile: the publisher's app PUTs the actor profile to `https://{hub}/actor/{name}`. For the outbox: derived from the items, or signed separately.

The "conventional paths" approach has a problem: the hub might not have the path layout the publisher expects. The publisher has to know the hub's API. This is fine — it's a small API spec.

Alternative: the publisher uploads everything as `(key, value)` pairs, and the hub organizes them by the actor they belong to (the actor's public key, not their name). The hub is dumber — it doesn't need to know the URL structure. But the publisher has to specify the key.

I think the signed PUT to conventional paths is right. It's a small, well-specified interface.

**2. The encryption construction.**

The current one was written in-house and has never been reviewed by a cryptographer; swapping it for an audited off-the-shelf construction is under evaluation.

Use HPKE (RFC 9180). It's an IETF standard, well-reviewed, and exactly the right shape: a sender encrypts to a recipient's public key with an optional KEM (DH-based, KEM-based, or PSK-based) and produces a sealed ciphertext. HPKE supports the per-recipient ephemeral key pattern naturally.

HPKE's DHKEM-X25519-HKDF-SHA256 + ChaCha20-Poly1305 is the configuration to use. It's in the standard library of several languages (or close to it; the primitives are). The output is a single ciphertext blob per recipient, which is cleaner than the multi-component format I specified.

For multiple recipients, the sender does one HPKE seal per recipient, each producing a ciphertext. The sender puts the encrypted content + the list of HPKE ciphertexts in the activity. Each recipient finds their HPKE ciphertext (by key_id), opens it, gets the content key, decrypts the content.

This is cleaner than my custom construction. I would adopt HPKE.

**3. How many trusted peers constitute social recovery, and whether a reader's trust set is ever published. The current answer to the second is: never.**

For social recovery: the threshold is not protocol-defined. It's a per-reader policy. The reader decides "I trust these N keys; if M of them sign a recovery attestation, I accept it." Different readers can have different thresholds.

The protocol supports this by carrying N signatures from N peers, and the reader applies its own threshold. There's no protocol-enforced threshold.

For the trust set being published: never is the right answer for the reader's trust set (which is the reader's private policy). But: the recovery attestation itself, signed by the recovery peers, is public (in the activity stream). So the reader sees "alice's mom and alice's sister signed this attestation" — but the reader decides whether to trust them.

The recovery peer's *public key* is public (it's in their actor profile). The fact that the reader trusts it is private.

The recovery attestation format: `{ type: "KeyChange", actor: alice, old_key: ..., new_key: ..., attestations: [{ attester: bob, signature: ... }, { attester: carol, signature: ... }] }`. The signatures are over the attestation body (minus signatures). Each attester signs independently.

I think this is right. The threshold is policy, not protocol.

**4. When items are separate files, what exactly is "the head"? Is the generated feed view also the head, or is the head a third tiny signed file?**

The head is a third tiny signed file. Specifically:

- The outbox is a directory of item files (`{item-id}.signed`).
- The head is a small file (`head.signed`) that lists the IDs of the items currently in the outbox, in some canonical order (e.g., by sequence number, then by ID), with a sequence number for the head itself.
- The head is signed by the actor's signing key.
- A reader pins the head and verifies the signature. The reader compares the head's list of IDs to what it has fetched and notices discrepancies.

The generated JSON Feed view is NOT the head. The JSON Feed is for interop with non-Persona-aware readers; it's regenerated by the hub (or the publisher's app) from the item files. The head is a Persona-internal artifact.

This separation is important: the JSON Feed can be regenerated at any time without invalidating the head (the head is the source of truth, the JSON Feed is a cache).

The hub may or may not serve the head. If the hub is honest, it serves the latest head. If the hub is hostile, it might serve an old head or refuse. The reader detects this by tracking head sequence numbers and noticing when the head goes backward or stale.

**5. Whether the push/delivered channel should exist at all, or whether everything genuinely being pull is worth the metadata it makes public.**

The push channel must exist, but as a first-class mechanism, not an extension. The relocation scenario (Scenario 1) requires push to work against a hostile hub. If push is an extension, the floor assurance #3 ("the host cannot keep you") is not delivered by the core protocol.

The metadata cost of push is real: the hub sees inbound connections from other hubs, can infer who is talking to whom based on connection patterns. Mitigations:
- Push from the user's device (not the hub), so the inbound connection is from the user's IP, not the hub's
- Use a relay to obscure the source IP
- Accept the metadata cost

The metadata cost is less bad than the alternative: a design where the host can keep you because it can suppress your Moves. The metadata is the price of the floor.

---

OK now let me write this up. The user asked for an attack, an attack on myself, a reconciliation, and answers to the questions. Length: as long as it needs to be.

Let me organize the response.

Structure:
- A. Attack on the other team
  - Main attack (Scenario 1 / relocation under hostile hub)
  - Secondary attacks (canonicalization trade-off, audience sealing, social recovery threshold, BYOC assumption)
  - What's right about the other team's design
- B. Attack on my own design
  - The bootstrap / first-contact trust problem (the biggest gap)
  - Canonicalization burden
  - Inbox semantics hand-wave
  - Multi-device
  - Recovery UX
  - Other things
- C. Reconciliation
  - Hybrid design
  - What neither considered
- D. Answers to the five questions

Let me write this. I'll aim for thorough but not bloated. Maybe 5000-6000 words.
```

</details>

