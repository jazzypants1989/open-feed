---
model: minimax-m3
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:52:12.704Z
prompt: PROMPT-pass1.md
prompt_sha256: ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":1766,"completion_tokens":35970,"total_tokens":37736,"prompt_tokens_details":{"cached_tokens":156},"completion_tokens_details":{"reasoning_tokens":21812}}
wall_seconds: 379
truncated: false
reasoning_chars: 94537
---
# Persona: A Protocol for Decentralized Personal Publishing

The name is a placeholder. The design is the thing.

I am assuming the implementer has a standard library that provides: Ed25519 signing, SHA-256, X25519 ECDH (or, if not, a 25519 curve ECDH via the Ed25519→Curve25519 conversion, or as a last resort P-256 ECDH), HKDF-SHA256, ChaCha20-Poly1305 or AES-256-GCM, constant-time base64, UTF-8, JSON encoding, and an HTTP client and server. Go 1.21+, recent Rust with only `std`, and Node 20+ all clear the bar. Python's standard library does not, and that is the one case where I would relax the no-dependencies rule to admit `cryptography` for the missing primitives; everywhere else, the rule holds.

---

## 1. Architecture (one page)

**Participants**

- *Device.* The user's app. Holds the signing key. Publishes, fetches, encrypts, decrypts, and pushes activities to other hubs directly. The device is the active principal; the hub is its storage.
- *Hub.* A HTTPS server that stores the user's signed content, serves it on request, and accepts incoming activities addressed to the user. The hub does not have the user's signing key, does not have the user's encryption key, and cannot read encrypted content. The hub's job is to be there when the device is asleep.
- *Reader.* Any other app or feed reader that fetches content from hubs and verifies signatures.

**Artifacts**

| Artifact | What it is | Signed? | Where it lives |
|---|---|---|---|
| **Actor profile** | JSON document: name, bio, inbox/outbox URLs, public keys | Yes, by the actor's signing key | At `https://{hub}/{name}` |
| **Activity** | JSON document: a Post, Reply, Follow, Like, Move, or KeyRotation | Yes, by the actor's signing key | In an outbox or inbox collection, or at its own URL |
| **Object** | The content of a Post/Reply (text, image references) | Inside the activity; the activity signature covers it | Inline in the activity, or referenced by URL |
| **Collection** | Ordered list of activity IDs: outbox, inbox, followers, following | The collection itself is not signed; the activities are | At `…/outbox`, `…/inbox`, `…/followers`, `…/following` |
| **Encrypted blob** | For private content: ciphertext + per-recipient wrapped keys | Yes, by the author | Replaces the plaintext in the activity |

**On first contact** the reader knows `alice@hub.example`. It does:

1. `GET https://hub.example/.well-known/webfinger?resource=acct:alice@hub.example` → JSON with the actor URL.
2. `GET {actor URL}` → the actor profile, including the signing public key, encryption public key, and the outbox URL.
3. `GET {outbox URL}` → the public outbox, served as JSON Feed so stock readers work.

The reader now has everything it needs to display the public feed and to verify any signed activity it sees later.

**On a poll** the reader re-fetches the outbox. It compares the `id` of the most recent item it has to the `id` of the most recent item in the outbox. Anything new is fetched and signature-verified.

**On a push** (only for the user's own app) the device subscribes to its own inbox. When someone on another hub replies, that hub `POST`s the activity to the inbox URL with an HTTP signature. The inbox stores it. The device picks it up on next poll and decrypts if needed.

**Discovery of people on other hubs** is by name@hub, just as on first contact. There is no global registry. The only way to find someone is to know their current name@hub, or to be told it (out-of-band or by a signed Move activity in your inbox).

---

## 2. Identity

**A person is an Ed25519 keypair.** The 32-byte public key is the identity. The 32-byte private key is the only thing that can speak for it.

A *name* (e.g., `alice`) is a human label, scoped to a hub. The mapping `alice → {public signing key, public encryption key}` lives in the actor profile, but the mapping is a *property* of the identity, not the identity itself. The same public key can appear on another hub under a different name; it is still the same person.

A *location* is the URL of the actor profile. It can change. When it does, the person signs a Move activity with their key, and the new location becomes canonical.

**Why an Ed25519 keypair, argued against the alternatives I rejected:**

- *Email address.* Not self-certifying. The provider can revoke it, can reissue it to someone else, and can read anything you send. The whole point of the design is that the hub is the adversary; putting the identity in the hands of an email provider is worse.
- *Phone number.* Worse than email. Carriers transfer numbers, SIM-swap is a thing, and a phone number is not a cryptographic object at all.
- *Domain name.* Rented, expirable, and seizable. The "domain goes" scenario in the brief is exactly this failure. A domain can be a *location*, never an *identity*.
- *Random UUID.* No provenance, no built-in verification. If I tell you my UUID is `f3a7…`, you have no way to know whether I am the same person who told you that UUID last month.
- *DID (W3C Decentralized Identifiers).* A DID is a URL that resolves through a *method* — usually a blockchain, a ledger, or a hosted registry. Every method I am aware of depends on infrastructure the brief excludes. A DID that resolves through a hub is just a hub URL; a DID that resolves through a blockchain is exactly the shared ledger the brief forbids.
- *Blockchain address.* Same problem, plus the cost, plus the public-permanence that the brief's threat model does not need.
- *PGP key.* Cryptographically workable, but PGP carries decades of baggage: web of trust, key servers, key formats, packet encoding. Not in any standard library. Not worth it.
- *Bluesky's DID PLC.* A fine system, but it depends on the PLC directory — a shared service. The brief forbids it.

**The Ed25519 keypair has no infrastructure dependency.** To verify a signature, you need the public key. The public key is in the actor profile. To get the actor profile, you need its URL. To get its URL, you need WebFinger at the user's current hub. That is the whole dependency chain, and every link is replaceable by a phone call.

**The encryption key is a separate X25519 keypair.** I considered deriving the X25519 key from the Ed25519 seed (this is done in Signal and elsewhere), but the conversion requires a KDF and is fiddly. Two independent keypairs, both 32 bytes, both in standard libraries, both fast, is simpler and adds no real cost. The actor profile carries both public keys.

**Trade-off I accept:** the identity is not human-readable. A user is `8f3a7b…` to a machine and `alice@hub.example` to a person. The human name is a *nickname*, not an identity. Two Alices on different hubs are the same person if and only if their public keys match.

---

## 3. The Four Floor Assurances

### Assurance 1: The host cannot speak for you

**Mechanism.** Every activity is signed by the actor's signing key *before* it leaves the device. The signature is over the SHA-256 hash of the activity's canonical JSON, with the `signature` field removed. The activity uploaded to the hub is already signed. The hub stores and serves it. The hub has never seen the private key.

**Verification.** A reader fetches the actor profile, extracts the public signing key, and verifies the Ed25519 signature on every activity. A fabricated or altered activity fails verification and is rejected.

**Failure mode named.** If the device is compromised, the attacker has the key and can sign as the user. The design does not protect against a compromised device; it protects against a compromised hub. The assumption is the device is in the user's pocket.

**What the hub can still try, and why it fails.**

- *Serve a fabricated activity.* Fails signature verification.
- *Modify a signed activity.* Fails signature verification.
- *Re-serve an old activity as new.* The activity has a `published` timestamp and an `id`. Readers can detect re-served old content. The actor profile on the hub can also include a `movedTo` field; if the hub removes it, readers who have the Move activity in their inbox (pushed directly by the user's app) know to ignore the old location.
- *Strip a signature.* The signature is inside the activity. The hub cannot remove it without making the activity fail the reader's signature check. (A hub that serves an *unsigned* activity and claims it is the user's would be caught the moment a reader compared it to a signed one.)

### Assurance 2: The host cannot read what wasn't meant for it

**Mechanism.** Private content is encrypted on the device, before upload. The hub stores and serves ciphertext. The encryption keys are derived using ECDH between an ephemeral key generated by the sender and the recipient's long-term X25519 public key. The hub has neither half.

**What the hub sees.** The audience (a list of recipient public keys or actor URLs), the ciphertext, the encrypted per-recipient key wraps, the ephemeral public keys, the size, the timing. The brief explicitly accepts that the hub sees the audience. The hub does *not* see the plaintext, the content key, or the recipients' private keys.

**Failure mode named.** If a recipient's device is compromised, the attacker can decrypt. This is outside the threat model. If the hub simply refuses to deliver, the user's app pushes directly to recipient hubs, bypassing the hostile hub; the design's federation model is push-from-device, not pull-by-hub. (See Section 4, Scenario 1.)

**What the hub can still try, and why it fails.**

- *Read the plaintext.* Cannot; it is ciphertext.
- *Modify the ciphertext.* The activity's signature covers the ciphertext as well as everything else. Modification breaks the signature; recipients reject.
- *Re-target the ciphertext.* Each recipient has a separate key wrap bound to their public key. Re-targeting would require re-wrapping, which requires the recipient's private key, which the hub does not have.
- *Replay an old ciphertext to a new recipient.* The new recipient is not in the audience list and cannot decrypt; they have no entry to look up.

### Assurance 3: The host cannot keep you

**Mechanism.** The signing key lives on the device. The device also has, or can fetch, a copy of the user's content. The user can set up a new hub, republish the actor profile at the new location with the same public key, and sign a Move activity. The hub is no longer involved.

**What the user needs to leave, concretely:**

- The signing private key. On the device.
- A local copy of the content, *or* the ability to fetch it from the old hub before leaving.
- A new hub. (A friend's box, a paid host, a $5 VPS. The design does not care.)
- The followers list. The user has this locally (the app tracks it) or can fetch it from the old hub.

**What happens after the user leaves.** The user's app pushes a signed Move activity to every follower's inbox. Followers verify the signature against the old actor profile's public key, see the new location, and update. The old hub now serves stale content at best. The new hub is canonical.

**Failure mode named.** If the user's *device* is lost and the key was only on the device, the user cannot publish until they recover. Recovery is via recovery contacts (Section 5). If recovery contacts are also unavailable, the identity is gone. Continuity of a stranger's view of you across total key loss is an explicit non-goal.

**What the hub can still try, and why it fails.**

- *Refuse to serve the Move activity.* The user's app pushes the Move directly to followers' inboxes, not through the old hub. The hub's cooperation is not required.
- *Continue serving the old content as if it were current.* Readers who have received the Move ignore the old location. Readers who haven't yet will, on next contact, see the `movedTo` field in the (now-updated) actor profile, or notice that the actor profile no longer matches.
- *Claim the Move is a forgery.* The Move is signed by the user's key. Anyone holding the public key can verify the signature. The hub's claim is not technically credible; it is a social claim, and the technical record refutes it.
- *Refuse to let the user fetch their own content.* The user fetches before leaving. If the hub blocks fetch, the user has the local copy.

### Assurance 4: People on other hubs are first-class

**Mechanism.** Recipients are addressed by their actor URL. The author fetches the recipient's actor profile, learns their encryption public key and their inbox URL, encrypts to them, and pushes the activity to their inbox. The recipient's hub stores it. No access-control agreement between hubs is required; encryption handles the access control.

**What the author needs to send a private post to Bob on another hub:**

1. Bob's actor URL. (The author knows it or looks it up via WebFinger.)
2. Bob's encryption public key. (In the actor profile.)
3. Bob's inbox URL. (In the actor profile.)
4. An HTTPS client. (To POST to Bob's inbox.)

**No federation agreement, no shared key server, no mutual handshake.** The author sends an encrypted blob to a URL. The recipient decrypts. Hubs are routers, not gatekeepers.

**Failure mode named.** If Bob's hub is down, Bob doesn't get the message. The design does not guarantee delivery; it guarantees that if delivered, only Bob can read. (Delivery can be retried; the activity has a stable id, so duplicates are detectable.)

**What the hub can still try, and why it fails.**

- *Refuse to accept the POST.* Bob's hub is a dumb store; if it refuses, Bob configures a different hub. The protocol does not require any particular hub to accept anything.
- *Read the activity.* It is encrypted to Bob. The hub has Bob's inbox URL but not Bob's private key. It sees ciphertext.
- *Lie to the author about Bob's encryption key.* The author fetches Bob's actor profile from Bob's hub. If the author trusts Bob's hub to serve the right key, the threat is reduced to "what if Bob's hub is hostile?" — which is a different adversary than the one we're designing for. The author's hub is the adversary. For the *author's* hub to substitute a key, it would need to control Bob's hub, which it does not.

---

## 4. Scenario Walk-throughs

### Scenario 1: The Divorce

Alice's account is on `family.example`, operated by her hostile ex-husband. She has been posting publicly and privately (to family) for years. The ex controls the hub. He has every right to be there and will not cooperate.

**Before the divorce, the design has been protecting Alice continuously:**

- All of Alice's public posts are signed by her key. The ex can serve them, modify them, or suppress them, but he cannot post *as* her. Any activity he fabricates fails signature verification on every reader.
- All of Alice's family-only posts are encrypted to the recipients' keys. The ex has the ciphertext. He does not have the plaintext. He never will, unless he compromises a recipient's device.
- Alice's key is on her phone. The ex has never had it.
- Alice's app has been pushing activities directly to followers' inboxes. The ex's hub federation is convenient, not load-bearing. When Alice posts, the encrypted copy goes to her mother's hub, her sister's hub, her brother's hub — directly, not through the ex's hub.
- Alice's app has a local copy of her outbox and a local record of who follows her.

**The day Alice decides to leave:**

1. She signs a Move activity on her phone: `{type: "Move", actor: "https://family.example/actor/alice", target: "https://newhub.example/actor/alice", signature: { … by Alice's key … }}`.
2. Her app iterates through her locally-stored followers list and POSTs the Move to each follower's inbox (her mother's hub, her sister's, etc.), with an HTTP signature by Alice.
3. Her app sets up the new actor profile at `newhub.example`, signed by the same key.
4. She does not need to delete anything from `family.example`. The old content, if the ex serves it, is now stale.

**What readers see, after the move:**

- The next time Alice's mother opens her reader, the inbox shows the Move activity. The reader verifies the signature against the public key it had stored for Alice (from the old actor profile). It updates its subscription to `newhub.example`.
- The next time a stranger fetches `https://family.example/actor/alice`, they get the old profile, which now includes `movedTo: "https://newhub.example/actor/alice"` (if the ex hasn't stripped it). If the ex has stripped it, the stranger is reading from a stale location; their reader will, on next contact, notice the new subscription and follow it.
- The ex can continue to serve the old public content at `family.example`. It is signed by Alice. It is real content she wrote. He has not forged anything. He has simply failed to update the location. Readers who know about the move ignore the old location; readers who don't are reading a frozen archive, not a live feed.

**What the ex cannot do:**

- Post as Alice. He does not have her signing key.
- Read Alice's family-only posts. They are encrypted to the recipients.
- Alter what Alice wrote. Signatures verify.
- Prevent Alice from leaving. Her key is on her device; her new hub is under her control; the Move was pushed directly to followers.

**What the ex can do, and how the design copes:**

- Deny service to `family.example`. Readers move to the new location. The old hub going dark is exactly the "domain goes" scenario.
- Serve old content as if it were new. Readers see the timestamp and the absence of new content. The actor profile's `movedTo` field (or its absence, if the ex stripped it) signals staleness.
- Claim the Move is a forgery. The signature proves it is not. The ex can make the claim socially, but not technically.

### Scenario 2: Grandma Onboards

Grandma installs the app on her phone. She picks the name `grandma` and enters `family.example` as her hub. The app asks if she wants to add a recovery contact. She says yes, types her daughter's name, `daughter@elsewhere.example`, and is done. She is never shown a key. She is never told to write anything down or remember a passphrase.

**What happened on her device:**

1. The app generated an Ed25519 signing keypair and an X25519 encryption keypair. The private keys are in the app's secure storage (Keychain on iOS, Keystore on Android).
2. The app looked up `daughter@elsewhere.example` via WebFinger at `elsewhere.example` and fetched the daughter's actor profile. It extracted the daughter's encryption public key.
3. The app generated a "recovery bundle": a small JSON object containing the signing private key, encrypted to the daughter's encryption public key using the construction in Section 6. The bundle is `{ "for": "daughter@elsewhere.example", "wrapped_key": "...", "ephemeral_pub": "...", "wrapped_at": "2024-01-15T..." }`.
4. The app POSTed the recovery bundle to a recovery endpoint on the daughter's hub. (The daughter's hub exposes `/actor/daughter/recovery-inbox` for this purpose; only the daughter's app can read it.) The app also created a small in-app "icebreaker" note: "If you are reading this, your mother needs help recovering her account."
5. The app uploaded the actor profile to `family.example`.

**A year later, grandma loses her phone.** She calls her daughter.

1. Grandma installs the app on a new phone. She enters `grandma@family.example`.
2. The app fetches the actor profile from `family.example` and confirms the identity.
3. The app asks "Recover from a contact?" Grandma says yes. She enters `daughter@elsewhere.example`.
4. The new app generates a fresh keypair for the recovery session and POSTs to the daughter's hub: `{ "action": "request_recovery", "for": "grandma@family.example", "session_pubkey": "...", "voice_confirmed": true }`. The `voice_confirmed` field is set by the daughter in the next step, not by the new device — the new device cannot truthfully set it.
5. The daughter's app receives the request and pushes a notification: "Mom is trying to recover. Allow?" The daughter, who has just spoken to her mother on the phone, taps yes.
6. The daughter's app signs a `recovery_approval` with her own key: `{ "approving": "grandma@family.example", "new_session_pubkey": "...", "expires": "..." }`. The daughter's app retrieves the recovery bundle, decrypts it with the daughter's encryption private key, and re-encrypts the signing private key to the new session's public key. The daughter's app POSTs this to the new device, with an HTTP signature.
7. The new device verifies the daughter's signature (the daughter's public key is in the daughter's actor profile, which the new device fetched). The new device decrypts the wrapped key using the new session's private key. The new device now has grandma's signing private key.
8. The new device prompts grandma: "Is this your account? You can now publish. For safety, you may want to rotate your key now (which will invalidate the old one)."

**Threats considered and how the design handles them:**

- *An attacker pretends to be grandma and asks the daughter for recovery.* The daughter gets a push notification and must approve. The social verification (the phone call) is the layer that catches this. The technical layer ensures the recovery data only flows to a device the daughter has explicitly approved for this session.
- *The hub is hostile and substitutes a fake actor profile.* The new device verifies the profile's signature. The hub cannot forge a profile signed by grandma's key because the hub does not have it. If the hub serves no profile, the device knows the account doesn't exist (from the device's perspective).
- *The daughter's hub is hostile and substitutes a fake recovery bundle.* The bundle is encrypted to the daughter's key. The daughter's app decrypts it; the hub never sees the plaintext. The hub cannot substitute a valid bundle encrypted to the daughter's key because it doesn't have the daughter's key.
- *The daughter herself is malicious.* The threat model does not cover this. The daughter is a recovery contact by social choice; she is trusted. The design protects against the hub, not against a chosen recovery contact going rogue. (Mitigation available: a 2-of-2 scheme where the key is XOR-split between two contacts, each holding one share. The user needs both to recover. This costs one extra contact and is implementable without a library. I would not enable it by default.)

**What grandma never had to do:** remember a passphrase, write down a seed phrase, store a file, configure a key, or understand what a key is.

### Scenario 3: Two Hubs, One Thread

Alice is on `a.example`. Bob is on `family.example`. Carol is on `c.example`. All three are in the same family group. They have not configured anything together; their hubs have no relationship.

**Alice writes a private post to the family:**

1. Alice's app looks up Bob and Carol by name@hub, fetches their actor profiles, extracts their X25519 encryption public keys.
2. Alice's app generates a 32-byte content key K.
3. Alice's app encrypts the post body with K (ChaCha20-Poly1305), producing ciphertext C.
4. Alice's app generates an ephemeral X25519 keypair per recipient. For Bob: shared secret S_B = e_A · R_B, key wrap key K_B = HKDF(S_B, salt=E_A, info="msg-key-v1"), wrapped key W_B = ChaCha20-Poly1305(K_B, K). Same for Carol.
5. The activity body now contains: `content: null`, `encrypted: { ciphertext: C, scheme: "xchacha20-poly1305+hpke-like-v1", recipients: [{ key_id: <Bob's pubkey>, ephemeral_pub: E_A, wrapped_key: W_B }, { key_id: <Carol's pubkey>, ephemeral_pub: E_A, wrapped_key: W_C }] }`.
6. Alice's app signs the activity with her Ed25519 signing key.
7. Alice's app uploads the signed activity to her outbox on `a.example`.
8. Alice's app POSTs the activity to Bob's inbox (`https://family.example/actor/bob/inbox`) and to Carol's inbox (`https://c.example/actor/carol/inbox`), with an HTTP signature.

**Bob receives the post:**

1. Bob's hub stores the activity in Bob's inbox.
2. Bob's app fetches the inbox. It sees a new activity from Alice.
3. Bob's app finds Bob's entry in the `recipients` list (matching Bob's public key).
4. Bob's app computes S = r_B · E_A, derives K_B, decrypts W_B to get K.
5. Bob's app decrypts C with K. Bob now has the plaintext.

**Bob replies, privately, to the thread (Alice and Carol):**

1. Bob's app generates a new content key, encrypts the reply, wraps the key to Alice and to Carol (using *their* encryption public keys, which Bob's app fetched earlier and cached).
2. Bob signs, uploads, and pushes to Alice's and Carol's inboxes.

**Carol reacts with a heart:**

1. Carol's app generates a Like activity: `{ type: "Like", actor: carol, object: <Alice's activity id> }`.
2. Carol's app signs and uploads. The Like is public, so it's also pushed to anyone else who follows Carol and to the inboxes of people in the thread who would want to see reactions (in this design, Carol's app pushes the Like to Alice's and Bob's inboxes for visibility).
3. Alice and Bob see the Like in their inboxes.

**Access control:** the author chose the recipients. The encryption enforces it. No hub is asked to enforce anything. No hub has any say in who is in the audience. The two hubs in this scenario are `a.example` (Alice's) and `family.example` (Bob's) and `c.example` (Carol's). They have no shared access-control list. They do not need one. They have not signed any agreement. The protocol works between them as if they were one hub.

### Scenario 4: The Domain Goes

`family.example` becomes unaffordable. The family has 30 days before the domain expires and the hub host pulls the plug.

**In the 30 days:**

1. Each family member signs a Move activity: `{ type: "Move", actor: "https://family.example/actor/{name}", target: "https://newfamily.example/actor/{name}", signature: ... }`.
2. Each family member's app pushes the Move to every follower's inbox. For a family, this is at most a few hundred people. Each push is a small POST.
3. Each family member sets up the new actor profile on `newfamily.example` with the same public key.
4. The old hub, if cooperative, can be left with a redirect or a `movedTo` field on each actor profile. If uncooperative, it doesn't matter — readers got the Move in their inbox.

**The day the domain expires:**

- DNS for `family.example` stops resolving. WebFinger lookups fail.
- The old hub is unreachable.
- All readers who updated to `newfamily.example` are unaffected. They follow the new location.
- Readers who did not get the Move activity (e.g., a stranger who subscribed to the public RSS feed a year ago and never interacted) lose their subscription. They cannot rediscover the family through the protocol alone. The user must notify them out-of-band, or accept that the subscription is gone.

**What the design does not solve here:** discovery of *strangers* after a domain change. If a reader had only the public feed (no inbox interaction, no contact list), they get no automatic notification of the move. They would have to re-discover the family by being told the new name@hub, or by stumbling across it in some other channel. The design does not include a global registry precisely to avoid that infrastructure; the trade-off is that strays are strays.

For a family audience, this is acceptable. Everyone is in everyone else's inbox. The Move reaches them. The "stranger" case is rare and recoverable through normal social channels ("hey, we're at newfamily.example now").

---

## 5. Key Change and Recovery

### Key rotation (planned)

A user may rotate their signing key for ordinary reasons: device migration, key compartmentalization, or simply hygiene.

**The protocol:**

1. The user generates a new Ed25519 signing keypair and a new X25519 encryption keypair on the device.
2. The user signs a `KeyRotation` activity with the **old** signing key:

```json
{
  "@type": "KeyRotation",
  "id": "https://hub.example/actor/alice/activities/{rand}",
  "actor": "https://hub.example/actor/alice",
  "new_signing_pub": "base64...",
  "new_encryption_pub": "base64...",
  "rotated_at": "2024-06-01T12:00:00Z",
  "signature": { "key_id": "...#key-old", "value": "base64..." }
}
```

3. The user updates the actor profile on the hub to advertise the new public keys.
4. The user pushes the `KeyRotation` activity to followers' inboxes so they update their stored public key.
5. From this point, new activities are signed with the new key. Old activities remain valid (they were signed with the old key, and the old public key is still verifiable — the user can publish a `Revocation` for the old key if desired, but it is not required for security).

**Why sign the rotation with the old key?** So that the rotation is provably authorized by the current identity holder. Without this, anyone could "rotate" the key of anyone else. The old key signing the new key is the chain of custody.

### Key loss (unplanned)

Device destroyed, key gone, no copy. The user cannot publish new content. Recovery contacts come into play.

**Recovery contacts** are a feature of the actor profile. The profile includes a `recovery` field:

```json
"recovery": [
  { "contact": "https://elsewhere.example/actor/daughter", "wrapped_at": "2024-01-15T..." },
  { "contact": "https://elsewhere.example/actor/son",     "wrapped_at": "2024-01-15T..." }
]
```

For each contact, a `recovery_bundle` exists (stored on the contact's hub, in the contact's recovery-inbox), containing the user's signing private key encrypted to the contact's encryption public key. The user generated and uploaded these bundles at setup time.

**Recovery flow:** as in Scenario 2. The new device contacts a recovery contact, the contact approves (out-of-band, e.g., a phone call), the contact decrypts the bundle and re-wraps the key to a fresh session key the new device generated, and the new device receives the signing key.

**1-of-N by default, with optional 2-of-2 via XOR.** I considered Shamir's secret sharing for M-of-N with M < N, but Shamir requires polynomial interpolation, which is not in any standard library I know of. The simple alternatives:

- *1-of-N.* Each contact holds a full copy of the key, encrypted to their public key. Any one can recover. Security rests on the trustworthiness of the contacts (one malicious contact can impersonate). This is the default and matches Scenario 2.
- *2-of-2 via XOR.* The signing key is XOR'd with a random 32-byte share1; share1 is given to contact A, share2 (= key XOR share1) is given to contact B. To recover, both must cooperate. The user generates share1 on the device, computes share2, encrypts share1 to A and share2 to B, uploads both. This is implementable in 20 lines and uses only XOR, AES-GCM (or ChaCha20-Poly1305), and HKDF. It is not enabled by default because the UX is worse (two phone calls instead of one) and the threat model doesn't demand it.
- *M-of-N for M ≥ 2, M < N.* Not supported without a library. Documented as a future extension.

**What the recovery contact learns.** The contact learns the user's signing private key during recovery. The contact already had the encrypted bundle, so they could have decrypted it at any time. The recovery flow does not give the contact any new capability. It is a UX wrapper around "the contact decrypts the bundle they already have."

### Key theft

Device stolen, key extracted by an attacker. The attacker can now publish as the user. The user, on a new device, must rotate the key to invalidate the stolen one.

**The user contacts a recovery contact** (or has a copy of the key elsewhere) to get back the ability to sign. Then the user signs a `KeyRotation` with the recovered key. The rotation invalidates the stolen key for future content. Past content signed by the stolen key is still valid (signatures verify against the old public key), which is the correct semantic — the attacker could not have signed things the user *did* sign, and the user's history is preserved.

**Detection.** The user notices unauthorized posts and rotates. The user cannot retroactively delete the attacker's posts from hubs the attacker has already posted to. For private content, the attacker could not have read it (encrypted), so the breach is publication, not surveillance.

### Contested departure (the hostile ex-husband scenario, deeper)

The threat is: the hostile operator claims the Move activity is a forgery. They publish a counter-claim: "Alice's key was compromised; the real Alice is still here." They cannot sign this counter-claim with Alice's key (they don't have it). They can only sign it with their own key (if the hub has one) or post it unsigned.

**The defense is the signature.** Any reader holding Alice's public key can verify the Move. The Move's signature is over the Move body, which includes the new location. The signature is by Alice's key. It verifies. The counter-claim is, at best, signed by the hub operator's key, which is not Alice's.

**The social defense.** Alice's followers can call her. She can, in front of them, sign a fresh message with her key (the same one that signed the Move). The Move is genuine. The ex's claim is not.

**The protocol defense.** Alice's app, when sending the Move, includes a `notary` field with a list of recovery contacts who have *also* countersigned the Move. Each recovery contact, having been asked by Alice (out-of-band), signs `{ "I, daughter@elsewhere.example, attest that I have verified the identity of the person signing this Move, and that the new location https://newhub.example/actor/alice is controlled by the holder of signing key <pubkey>." }` with their own key. These counter-signatures give the Move social weight, cryptographically verified.

This is not a "notary service" in any global sense. It is the family vouching for each other, signed. The ex can claim the Move is forged; the family can show their signatures saying they helped verify it. The technical layer makes the social claim checkable.

**The honest limit.** If the recovery contacts are also controlled by the adversary (e.g., the ex is the only recovery contact, or has compromised all of them), the social defense fails. This is a configuration error: do not make your hostile ex your recovery contact. The design does not protect against user error in choosing recovery contacts.

---

## 6. Encryption Construction

I am specifying one construction, end to end. The target implementer should be able to write it from this section alone.

### Keys

Each actor has:

- `sk_sign`: Ed25519 signing private key, 32 bytes (the "seed" or "expanded secret key" — implementer's choice, but 32 bytes is the canonical form).
- `pk_sign`: Ed25519 signing public key, 32 bytes.
- `sk_enc`: X25519 encryption private key, 32 bytes.
- `pk_enc`: X25519 encryption public key, 32 bytes.

The actor profile advertises `pk_sign` and `pk_enc`. The private keys never leave the device.

### Encryption to one recipient

Inputs: recipient's `pk_enc` (call it `R`, 32 bytes), plaintext `P` (a byte string), associated data `A` (the activity id, as a UTF-8 byte string).

1. Generate ephemeral X25519 keypair `(e, E)` where `E = e · G` (X25519 scalar multiplication of base point).
2. Compute shared secret `S = e · R` (X25519). If `S` is all-zero (vanishingly unlikely, ~1 in 2^256), abort and retry with a new ephemeral key.
3. Derive a 32-byte key-encryption key: `K_wrap = HKDF-SHA256(S, salt=E, info="persona-msg-key-v1", length=32)`.
4. Generate a random 32-byte content key `K_content`.
5. Compute the ciphertext of the plaintext: `C = ChaCha20-Poly1305-Encrypt(K_content, nonce=0x000000000000000000000000, plaintext=P, aad=A)`. (Yes, a fixed nonce. The key is unique per message, so nonce reuse is impossible. This is a known acceptable pattern when keys are not reused.)
6. Wrap the content key for this recipient: `W = ChaCha20-Poly1305-Encrypt(K_wrap, nonce=0x000000000000000000000000, plaintext=K_content, aad=E)`.
7. Output bundle for this recipient: `{ "key_id": base64url(R), "ephemeral_pub": base64url(E), "wrapped_key": base64url(W) }`.

### Decryption by one recipient

Inputs: recipient's `sk_enc` (call it `r`, 32 bytes), the bundle `{ key_id, ephemeral_pub, wrapped_key }`, the ciphertext `C`, the associated data `A`.

1. Decode `E` from `ephemeral_pub`. Reject if `E` is not a valid X25519 public key (e.g., not on the curve, though X25519 public keys are always 32 bytes and the all-zero key is the only degenerate case; check `E != 0` and use a Montgomery ladder or equivalent).
2. Compute `S = r · E` (X25519).
3. Derive `K_wrap = HKDF-SHA256(S, salt=E, info="persona-msg-key-v1", length=32)`.
4. Unwrap: `K_content = ChaCha20-Poly1305-Decrypt(K_wrap, nonce=0, ciphertext=wrapped_key, aad=E)`. If authentication fails, abort.
5. Decrypt: `P = ChaCha20-Poly1305-Decrypt(K_content, nonce=0, ciphertext=C, aad=A)`. If authentication fails, abort.
6. Output `P`.

### Encryption to multiple recipients

The activity body contains one ciphertext `C` and a list of recipient bundles, one per recipient. The sender:

1. Generates one `K_content` and computes one `C`.
2. For each recipient, performs the "Encryption to one recipient" steps 1–7, using the same `K_content` and `C`, but the recipient's `R` and a fresh ephemeral keypair per recipient (or the same ephemeral keypair for all — both work; per-recipient ephemeral keys are slightly more wasteful but cleaner).

The activity looks like:

```json
{
  "@type": "Post",
  "id": "https://a.example/actor/alice/activities/abc123",
  "actor": "https://a.example/actor/alice",
  "published": "2024-06-01T12:00:00Z",
  "to": ["https://family.example/actor/bob", "https://c.example/actor/carol"],
  "visibility": "private",
  "content": null,
  "encrypted": {
    "scheme": "persona-enc-v1",
    "aad_field": "id",
    "ciphertext": "base64url(C)",
    "recipients": [
      { "key_id": "base64url(R_B)", "ephemeral_pub": "base64url(E_B)", "wrapped_key": "base64url(W_B)" },
      { "key_id": "base64url(R_C)", "ephemeral_pub": "base64url(E_C)", "wrapped_key": "base64url(W_C)" }
    ]
  },
  "signature": { ... over canonical JSON of the above, by pk_sign ... }
}
```

A recipient finds their entry by matching `key_id` to their own `pk_enc`. The activity's `signature` is over the canonical JSON of the whole activity, including the `encrypted` block; the hub cannot modify the ciphertext or the recipient list without invalidating the signature.

### What the hub learns

| Learned | Not learned |
|---|---|
| Sender (from `actor` and signature) | Plaintext content |
| Audience (from `to` and `recipients[].key_id`) | Content key `K_content` |
| Ciphertext bytes | Recipient private keys |
| Size and timing | Whether a given recipient is the one decrypting (the hub can't tell which entry in `recipients` matches which real recipient, because it doesn't know recipients' private keys) |

The last point is worth pausing on. The hub sees a list of `(key_id, ephemeral_pub, wrapped_key)` triples. It does not know which of these corresponds to which real person, because it doesn't have the recipients' private keys and cannot tell which `key_id` matches which follower. If the author includes fake entries (decoy recipients), the hub cannot tell which are real. The audience is hidden from the hub *to the extent that the hub cannot link key_ids to real people* — which is most of the way, if the author is careful.

**Wait, I need to be more precise.** The hub sees the `to` field, which lists actor URLs. So the hub knows the audience *by URL*. What the hub does not know is the mapping from URL to encryption public key — but the author fetched the URLs to get the keys, so the author knows both, and the hub can infer both by watching the author's network traffic. The hub sees the *outgoing* HTTP requests to the recipients' hubs (to fetch their actor profiles), and from those it can infer the audience as a set of `(URL, key_id)` pairs.

So the audience is not hidden from the hub in any meaningful sense. The brief accepts this: "the hub learns the audience of encrypted messages." I name it: *the hub learns the audience.* The protection is over the *content*, not the audience. If you want to hide the audience, you need a different design (e.g., a mix network), and that is explicitly out of scope.

### Why these primitives, argued

- **Ed25519 for signing.** Standard library in Go, Rust (via `ed25519-dalek`? no, not stdlib; in stdlib in Go 1.21+ and in Node 20+; in Java and C#; in Python via `cryptography` if you relax the rule). Fast, small signatures (64 bytes), small keys (32 bytes), deterministic signatures (no nonce required), well-understood.
- **X25519 for ECDH.** Same availability as Ed25519 in most modern stdlibs. 32-byte keys, fast, constant-time implementations are standard. Rejected: P-256 ECDH (more bytes, NIST curve, slower, larger signatures if used for signing too); RSA-OAEP (2048-bit keys are 256 bytes, signatures are huge, the design's "small JSON" goal suffers).
- **HKDF-SHA256 for key derivation.** Standard, in every standard library that has any KDF at all, easy to implement from HMAC-SHA256 if needed.
- **ChaCha20-Poly1305 for AEAD.** 32-byte key, 96-bit nonce (we use 64 bits / all-zero, which is acceptable for unique per-message keys), no padding, fast in software. Rejected: AES-256-GCM (equivalent security, but AES is slower on platforms without hardware acceleration; ChaCha20 is the default choice for software-only implementations). The fixed-nonce pattern is safe here because `K_content` is a fresh random key per message; nonce reuse would require reusing the key, which never happens.

### Canonical JSON for signing

A canonical form is required so that signatures are reproducible across implementations. The risk in this design is exactly the risk in every JSON-signing protocol: two implementations serialize differently and signatures fail to verify. I define a single, simple canonical form:

1. **Encoding:** UTF-8. No BOM.
2. **Object keys:** sorted lexicographically by the byte representation of the key (i.e., sort by the UTF-8 bytes of the JSON-escaped key string).
3. **No insignificant whitespace:** no spaces, no newlines, no indentation, outside of string contents.
4. **Numbers:**
   - Integers: as decimal digits, no leading zeros (except the number `0` itself), no `+` sign, no decimal point.
   - Floats: decimal point, no leading zero before the decimal point, digits after the decimal point, exponent with lowercase `e`, no `+` on exponent.
   - *The design avoids floats in signed payloads.* All numbers in activities are integers (timestamps, counts) or absent. If you must sign a float, the rules above apply.
5. **Strings:** JSON-escaped per RFC 8259. No pretty-printing. No raw newlines.
6. **Arrays:** as written, no special ordering.
7. **`true`/`false`/`null`:** lowercase.

The signature input is the canonical JSON of the activity, with the `signature` field omitted. The signature value is `base64url(Ed25519(sk_sign, SHA-256(canonical_json_bytes)))`.

**Why hash before signing?** Ed25519 already hashes internally (it uses SHA-512), so an outer SHA-256 is redundant. I include it for two reasons: (a) it makes the signature input a fixed-size 32 bytes, which simplifies implementations that might want to log or compare signed pre-images; (b) it allows the implementation to swap signature schemes later (e.g., to a post-quantum scheme) by changing only the signature wrapper. I am uncertain whether this redundancy is worth the 32 bytes it adds to each activity. I would accept a design without the outer SHA-256 if the implementer prefers.

**An example:**

Activity body (with `signature` stripped):
```json
{"@type":"Post","actor":"https://a.example/actor/alice","content":"Hello.","id":"https://a.example/actor/alice/activities/abc","published":"2024-06-01T12:00:00Z","to":["https://www.w3.org/ns/activitystreams#Public"]}
```

Canonical JSON serialization of the above: the same, because the keys are already sorted alphabetically. SHA-256 of the UTF-8 bytes: a 32-byte digest. Ed25519 signature over the digest: 64 bytes, base64url-encoded. Placed in the `signature` field. Done.

---

## 7. Cost Sheet

### What the design is bad at

**Real-time push when the device is offline.** Federation in this design is push-from-device. If Alice's phone is off when she posts (or, more realistically, if the app is suspended in the background and cannot make outbound HTTP), the activity sits in her outbox until her device is online to push it to followers' inboxes. The hub *can* push on her behalf (it has the activity and the follower list), but a hostile hub won't. For real-time, the user needs the hub to cooperate. The design trades real-time guarantees for the ability to operate correctly against a hostile hub.

Mitigation: the activity is in the outbox as soon as it's posted. Readers who poll the outbox (rather than waiting for inbox delivery) see it immediately. For followers on other hubs, the push is the only way; if the device is offline, the push is delayed.

**Hiding the social graph from the hub.** As discussed in Section 6, the hub sees the audience. This is a known limitation and is accepted by the brief. The design does not attempt to hide who-talks-to-whom from the hub. If that is a requirement, the design is wrong for you.

**Spam and abuse.** The design has no built-in anti-spam. A hostile hub could fill a user's inbox with junk activities. A hostile actor could send a million follow requests. The design assumes the user has an app-level filter (block lists, rate limits, "only accept inbox posts from people I follow"). This is a deliberate non-feature; the brief asks for a floor, not a ceiling.

**Large follower counts.** Sending a copy of each post to each follower is O(N) in follower count, both for storage on the author's hub and for outbound pushes. For a family (≤ 20 followers), this is trivial. For a thousand followers, it's noticeable but fine. For a hundred thousand, it's a problem. The design is for the "families and small groups" use case, not for celebrities.

**Global discovery.** No search, no directory, no "find me someone who likes knitting." Finding people requires knowing their name@hub or their public key. This is the price of no shared infrastructure.

### What the design cannot deliver

- **Anonymity.** The signing key is the identity. Every post is attributable. Pseudonymity is possible (use a key with no link to your real name), but anonymity is not.
- **Real-time delivery guarantees.** Delivery is best-effort. The protocol does not promise that Bob gets Alice's message within X seconds.
- **Censorship resistance at the network layer.** If the network between Alice's hub and Bob's hub is blocked, the message doesn't get through. The design does not include onion routing or mix networks.
- **Continuity across total key loss with no recovery contacts.** If the key is lost and no recovery contact is available, the identity is gone. The brief lists this as a non-goal.
- **Hiding the audience from the hub.** Repeated for emphasis. The design does not solve this. It solves content confidentiality, not audience confidentiality.

### Where the design is more complex than it looks

**Canonical JSON.** Signing requires a canonical form. Getting the canonical form right — UTF-8 encoding, key sorting, number formatting, string escaping — across implementations is a known source of bugs. JCS (RFC 8785) is the proper way; this design uses a simpler subset, but the implementer must implement it *exactly* as specified. Test vectors help. I would include 3–5 test vectors in the spec.

**Inbox semantics.** The inbox is a collection that receives POSTs. The semantics around ordering, deduplication, pagination, and retention are not trivial. A dumb hub might implement "inbox is a list, append-only, no dedup" — which works for the design but is not how ActivityPub inboxes work. The implementer should read the spec carefully and not assume ActivityPub semantics.

**Federation state and retries.** The app pushes to followers' inboxes. Some pushes fail (hub down, network blip). The app retries. How long does it retry? How does it know which pushes succeeded? The spec leaves this to the app. A reference implementation would track pending pushes in a local queue with exponential backoff. The protocol is silent on this; the implementer is not.

**Key derivation from a passphrase (if you add one).** PBKDF2, Argon2, scrypt — all require care. The design does not include passphrase-based recovery (per the grandma scenario, no passphrase), so this is moot unless the implementer adds it.

**HTTP signatures for POSTs.** The inbox POST is authenticated by an HTTP signature. The signature is over a canonical form of the request (method, path, headers, body hash). The spec for HTTP signatures is non-trivial. I would specify a minimal subset: sign `host`, `date`, `digest`, and the request path, with Ed25519. (Draft-cavage HTTP signatures are the reference; this design is compatible with a subset.)

### Choices I am least sure of

**The outer SHA-256 before Ed25519 signing.** I argued for it in Section 6, but I am genuinely uncertain. It is redundant, costs 32 bytes per activity, and the only benefit is future-proofing for signature scheme agility. A minimal design would sign the canonical JSON bytes directly with Ed25519 and skip the hash. I am leaving the SHA-256 in for the agility argument, but I would not fight to keep it.

**The fixed-nonce ChaCha20-Poly1305 pattern.** It is safe (unique key per message → no nonce reuse), but it is non-standard. Standard practice is a random 96-bit nonce. I chose fixed-nonce for simplicity (no random number generator needed at encryption time beyond the content key) and for determinism (a message can be re-encrypted and produces the same ciphertext, which is occasionally useful for caching). An implementer who is uncomfortable with this should use a random nonce; the cost is 12 bytes per message and a requirement that the RNG be sane.

**The recovery flow for grandma.** The "phone call to the daughter, who approves on her device" is socially correct and technically sound, but it requires the daughter to have the app installed, the app to be working, the push notification to arrive, and the daughter to understand what she's approving. For a real grandma, any of these can fail. The design assumes a baseline of technical competence in the family. A "grandma-proof" version would need a simpler recovery mechanism (e.g., a recovery code printed on a card, kept in a drawer), but the brief explicitly rules this out ("never told to store a file outside the house"). I am least sure this works in practice for the intended user. It is the most user-hostile part of the design.

**No global registry for discovery.** The "stranger" case in Scenario 7 is handled by a bridge to Mastodon or by the user re-discovering the author through normal social channels. This is a known limitation. The alternative is a DHT or a blockchain, both of which the brief excludes. I accept the limitation, but I am not certain the trade-off is worth it for a "families and small groups" use case — for families, discovery is via the family group chat, not via a global registry; the design works.

**The choice of Ed25519 over Ed448 or a post-quantum scheme.** Ed25519 is fast, small, and ubiquitous. It is not post-quantum. A future adversary with a quantum computer could forge signatures. For a "families" use case, this is not a near-term concern. For a "ten thousand people on one hub" use case, it might be. I would not block on this; I would note it.

---

## 8. What I would cut

If forced to halve the specification, I cut, in order:

1. **Reactions (Like, Announce, etc.).** These are just activities with `type: "Like"`. A reader can display them without protocol support; the protocol only needs to define that they are signed activities. I would reduce the type vocabulary to `Post`, `Reply`, `Follow`, `Move`, `KeyRotation`. Reactions are a reader UI concern, not a protocol concern.

2. **The followers and following collections as managed lists.** The app can compute "who follows me" from my inbox (look for `Follow` activities) and "who I follow" from my outbox (look for `Follow` activities I sent). The protocol does not need to expose `/followers` and `/following` endpoints. Cut them; the app derives them.

3. **Image uploads.** The protocol references image URLs. Where the images are hosted is out of scope. The user can use any image host, or a hub that supports uploads, or nothing. I would not define upload in the core spec.

4. **The encryption key as a separate keypair.** Derive the X25519 key from the Ed25519 seed using a KDF (e.g., HKDF, or simply take the first 32 bytes of SHA-512 of the seed). This halves the key material the user must back up. The trade-off is that rotation rotates both keys together, which is usually fine. I would keep the two keypairs only if implementer simplicity is paramount; for minimality, derive.

5. **Multiple-recipient encryption in one step.** Define encryption to one recipient. The app loops for multiple recipients, generating a separate ciphertext per recipient. This bloats the activity (one ciphertext per recipient instead of one shared) but simplifies the spec dramatically. For a family, the bloat is small.

6. **The KeyRotation activity as a separate type.** Rotation can be implied by publishing a new actor profile with a new `publicKey` field, signed by the new key, and announcing it via a Move or a regular Post. A reader that sees a new public key in the actor profile, where the old profile had a different one, can infer rotation. This is fragile (no chain of custody) and I would not actually cut this; the chain of custody matters. But if I had to, I would.

7. **HTTP signatures for inbox POSTs.** Replace with a simpler "API key" model: the inbox accepts POSTs with a header `X-Persona-Sender: <base64 public key>`, and the hub trusts the key (or checks it against a block list). This is weaker (vulnerable to replay, no request integrity) but trivial to implement. I would only do this if implementing HTTP signatures is a real barrier.

**What I would not cut, even halved:**

- The identity model (keypair, not name).
- Signed activities.
- The four floor assurances, in their entirety.
- The Move activity and the `movedTo` field.
- WebFinger discovery.
- The public outbox as JSON Feed.
- The encryption construction (even if cut to single-recipient).
- The recovery contact mechanism (even if simplified to 1-of-1).

These are the load-bearing pieces. Everything else is sugar.

---

## Appendix: The shape of the bytes

For the implementer who wants to see the wire format, here are the artifacts in their canonical form.

### Actor profile

```json
{
  "@type": "Person",
  "id": "https://a.example/actor/alice",
  "name": "Alice",
  "preferred_username": "alice",
  "summary": "Writes about gardens.",
  "inbox": "https://a.example/actor/alice/inbox",
  "outbox": "https://a.example/actor/alice/outbox",
  "followers": "https://a.example/actor/alice/followers",
  "following": "https://a.example/actor/alice/following",
  "public_key": {
    "id": "https://a.example/actor/alice#sign",
    "type": "Ed25519",
    "public_key_base64url": "..."
  },
  "encryption_key": {
    "id": "https://a.example/actor/alice#enc",
    "type": "X25519",
    "public_key_base64url": "..."
  },
  "recovery": [
    { "contact": "https://elsewhere.example/actor/daughter" }
  ],
  "signature": {
    "key_id": "https://a.example/actor/alice#sign",
    "value": "..."
  }
}
```

The actor profile itself is signed. This is a bootstrap problem: how does a reader know the profile is genuine? The answer: the profile is fetched over HTTPS from a hub the reader has chosen to trust (or has been told to trust out-of-band). The signature is defense-in-depth — if the hub serves a modified profile, the signature fails. But the initial trust in the hub is from the URL: if you trust `a.example` to serve Alice's content (because you knew Alice was at `a.example`), then you trust the profile you fetch from there.

For a higher-security bootstrap, the profile can be fetched from multiple locations (Alice's device, a mirror, a friend's cache) and compared. The design does not mandate this; the implementer can add it.

### Public Post activity

```json
{
  "@type": "Post",
  "id": "https://a.example/actor/alice/activities/01HXY...",
  "actor": "https://a.example/actor/alice",
  "published": "2024-06-01T12:00:00Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "visibility": "public",
  "content": "The peonies are out.",
  "signature": {
    "key_id": "https://a.example/actor/alice#sign",
    "value": "..."
  }
}
```

### Private Post activity (encrypted to two recipients)

```json
{
  "@type": "Post",
  "id": "https://a.example/actor/alice/activities/01HXZ...",
  "actor": "https://a.example/actor/alice",
  "published": "2024-06-01T12:05:00Z",
  "to": ["https://family.example/actor/bob", "https://c.example/actor/carol"],
  "visibility": "private",
  "content": null,
  "encrypted": {
    "scheme": "persona-enc-v1",
    "aad_field": "id",
    "ciphertext": "base64url...",
    "recipients": [
      {
        "key_id": "base64url(Bob's pk_enc)...",
        "ephemeral_pub": "base64url...",
        "wrapped_key": "base64url..."
      },
      {
        "key_id": "base64url(Carol's pk_enc)...",
        "ephemeral_pub": "base64url...",
        "wrapped_key": "base64url..."
      }
    ]
  },
  "signature": {
    "key_id": "https://a.example/actor/alice#sign",
    "value": "..."
  }
}
```

### Follow activity

```json
{
  "@type": "Follow",
  "id": "https://elsewhere.example/actor/daughter/activities/01HXA...",
  "actor": "https://elsewhere.example/actor/daughter",
  "published": "2024-05-15T08:00:00Z",
  "to": ["https://a.example/actor/alice"],
  "object": "https://a.example/actor/alice",
  "signature": {
    "key_id": "https://elsewhere.example/actor/daughter#sign",
    "value": "..."
  }
}
```

### Move activity

```json
{
  "@type": "Move",
  "id": "https://a.example/actor/alice/activities/01HXM...",
  "actor": "https://a.example/actor/alice",
  "published": "2024-09-01T10:00:00Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "object": "https://a.example/actor/alice",
  "target": "https://newhub.example/actor/alice",
  "signature": {
    "key_id": "https://a.example/actor/alice#sign",
    "value": "..."
  }
}
```

The old actor profile, after the move, should include `"moved_to": "https://newhub.example/actor/alice"`. If the hub strips it, readers who received the Move in their inbox know the new location anyway.

---

## Final note

The design is a floor, not a ceiling. It is the smallest thing that delivers the four assurances. It is intentionally ugly in places — the recovery flow is socially awkward, the discovery model loses strangers, the federation is best-effort. The brief asks for the floor, and the floor is what I have given. Above the floor, implementers can add: search, anti-spam, richer reaction types, attachment uploads, federation relays, mobile push notifications, relay-based audience hiding, and all the things a mature system needs. None of those are in scope here. The point of this design is the four assurances hold when everything above the floor is broken or hostile or absent.

<details><summary>Model reasoning trace (94537 chars) — kept because rejected alternatives often live here</summary>

```

The user is asking me to design a protocol for decentralized personal publishing and interaction. This is a substantial design document request. Let me think carefully about this.

The key constraints:
1. No third-party packages — standard library only
2. Must survive a hostile hub operator (insider threat)
3. Four floor assurances: host can't speak for you, can't read what wasn't meant for it, can't keep you, people on other hubs are first-class
4. Interop with RSS/Atom/JSON Feed and fediverse/Bluesky
5. Easy to implement in a weekend

The central problem: a hostile operator with legitimate credentials, controlling storage and serving. How do we maintain these four properties?

Let me think about each floor assurance:

**1. The host cannot speak for you.**
The content needs to be cryptographically signed by a key the host never had. This means:
- Each user has a signing keypair
- The key lives on the user's device
- The hub stores signed content but cannot forge it
- Public key is part of identity

**2. The host cannot read what wasn't meant for it.**
Content addressed to specific people must be encrypted. The hub sees encrypted blobs. Recipients are addressed in a way that doesn't reveal the audience list. This requires:
- Public key encryption to recipients
- The hub sees "encrypted blob, addressed to opaque recipient list"
- Need to think about how to address without revealing audience

**3. The host cannot keep you.**
The user can leave at any moment. This means:
- The signing key lives on the user's device
- A copy of content lives on the user's device
- Identity is tied to the key, not the domain
- Following your identity works across hubs

**4. People on other hubs are first-class.**
No access-control agreement between hubs. This means:
- Recipient addressing is by public key, not by hub membership
- Recipients on other hubs can fetch their content
- Federation through signed content, not through server agreements

Now, the challenge of the design:

**Identity**: What is a person?
- A person is an Ed25519 keypair
- The public key is the identity
- A name is a human-readable alias
- The hub knows a mapping of name → public key, but this is just for convenience

**Content addressing**:
- Each piece of content is signed by the author's key
- Content is addressed by a hash (content-addressed)
- Activities have a specific format

**The inbox/outbox pattern**:
- Outbox: where the user's content is published
- Inbox: where incoming activities are stored
- This is similar to ActivityPub but with cryptographic guarantees

**Key recovery**:
- For grandma, she shouldn't have to store a key
- Solution: encrypted backup with daughter/recovery contacts
- Multi-key recovery: M-of-N recovery contacts can rotate the key

Wait, but recovery contacts have their own keys. How does this work without a key escrow problem?

Let me think... The key is generated on the device. The device encrypts the key with a key derived from a passphrase + recovery contacts' public keys. The recovery contacts can each independently help recover, but only M of N together can decrypt.

Actually, simpler: split the key into N shares using Shamir's Secret Sharing. M of N shares can reconstruct. The shares are sent to recovery contacts encrypted to their public keys.

But Shamir's is not in the standard library typically. Hmm. We need a standard-library-only construction.

Alternative: Use a simple XOR-based secret sharing. For 2-of-2, just XOR the two halves. For M-of-N, we can do something with hash chains.

Actually, let me think about this differently. What if we use a simple "wrapping" approach:
- The user's key is wrapped with a key derived from a passphrase (or from the recovery contacts' keys)
- Each recovery contact holds a wrapped copy
- The new device needs to contact M recovery contacts to unwrap

For M=2 of N=3:
- Generate 3 shares where any 2 can reconstruct
- Without Shamir, we can do: split key K into K1, K2, K3 such that K = K1 XOR K2 XOR K3, and have multiple XOR combinations

This is getting complex. Let me think of a simpler approach.

What if the recovery is just "social" — the user designates N recovery contacts. To recover, you need any M of them to send you a "voucher" signed by their key, plus a passphrase. Then you derive the key.

Actually, here's an idea: 
- User picks a passphrase P
- Generate recovery key R = PBKDF2(P)
- Wrap the signing key S with R
- Each recovery contact has a copy of the wrapped S
- To recover, you need the passphrase (which you remember) + any one contact to give you the wrapped S

But this requires the user to remember a passphrase, which is what grandma scenario says is not required.

Let me re-read grandma: "She installs an app, picks a name, is never shown a key, and is never told to store a file outside the house. A year later she loses her phone. She is back by calling her daughter."

So recovery is by calling her daughter. The daughter can help her recover. So:
- Daughter has some kind of recovery capability
- The user doesn't need to remember anything

How can the daughter help without a key escrow problem?
- The daughter's app holds a recovery token for grandma
- This token, combined with something the user knows (or has via her new device), reconstructs the key
- But the daughter alone shouldn't be able to impersonate grandma

Solution: 
- User has a signing key
- Daughter holds an encrypted copy of the signing key
- The encryption is done with a key that requires BOTH the daughter's key AND a passphrase the user chose
- OR: daughter's help is needed to start recovery, but the new device generates a new key and the daughter vouches for it to existing contacts

Actually, the cleanest approach: the key is generated on the device. The app prompts for a passphrase (even grandma can do this if we make it user-friendly) and uses it to encrypt the key for backup. Recovery contacts (like daughter) hold encrypted shares. The passphrase is the user's only burden, but the design says it shouldn't be.

Hmm. Let me re-read: "is never shown a key, and is never told to store a file outside the house."

The user is not told to store anything. The key is stored on the device. The backup happens automatically and silently. The user doesn't need to remember a passphrase. But if the device is lost, recovery requires... what?

Option: The recovery contacts collectively (M of N) can authorize a key rotation. So:
- User loses device
- Contacts M of N sign a "rotation voucher" that says "I attest that this new public key belongs to [name]"
- New device generates new keypair, gets M-of-N signatures, publishes
- This is similar to Key Transparency / CONIKS but without the global infrastructure

But how does the new device get the contacts to sign? It needs to know who they are. The contacts are listed in the user's public profile (signed by the old key). The new device fetches this from the hub or from other contacts.

But wait, the hub is hostile. The new device can't trust what the hub says about who the recovery contacts are. Unless... the contact list itself is signed by the user, and replicated across multiple locations.

OK, let me think about this practically:

The user's data is replicated across multiple locations anyway (their own device, maybe a NAS, contacts' inboxes). The "device" is just one location. The key is the identity. If the device is lost but the key is in the user's "other locations" (recovery contacts), recovery is possible.

So the design needs to ensure that the key material gets distributed to recovery contacts, encrypted to them, automatically.

For grandma:
- App installed, asks for daughter's name (a known contact)
- Generates keypair
- Sends encrypted backup to daughter's inbox
- That's it. Grandma never sees a key. If she loses her phone, she calls daughter, daughter helps her set up new phone, daughter's app transfers the key.

But this gives daughter too much power. Daughter can impersonate grandma.

Mitigation: The encrypted backup to daughter is wrapped with a key that requires BOTH daughter's key AND a passphrase. But we're back to passphrase.

Alternative mitigation: Grandma's key is split between daughter and another contact (e.g., son). Both must cooperate. Or: the backup is wrapped such that any one contact can help recover, but the contact cannot use it themselves because they don't know the user's other credentials.

Actually, let me think about this differently. The threat model says the hub is the adversary, not the recovery contact. The daughter is trusted. So daughter having a copy of the key is fine, as long as daughter is a willing participant in recovery.

The issue is: if the key is stored only with the recovery contact, the contact could impersonate. But the contact is trusted, so this is OK in the threat model. The threat model is about the hub, not about mutual distrust among users.

OK, so for grandma:
- Recovery contact (daughter) holds an encrypted backup of the key
- The encryption is such that daughter can decrypt it (she's the recovery contact)
- When grandma loses phone, daughter helps her recover
- Daughter could impersonate, but daughter is trusted
- This is the social model

For the contested departure: the hostile ex-husband runs the hub. The wife generates her key. She keeps it on her device. She has recovery contacts (her mother, sister) who have encrypted backups. She can leave the hub at any time because:
- Her key is on her device
- Her content can be replicated to her new hub or contacts
- The hostile hub can be abandoned; readers can follow her new location

For the hub to "stop her leaving", the hub would have to prevent her from accessing the key. But the key is on her device, not the hub. So she can always leave.

For the hostile hub to "post as her": the hub doesn't have her signing key, so any content it serves is verifiable as not-signed-by-her.

For the hostile hub to "read her family-only posts": these are encrypted to the recipients' public keys. The hub sees ciphertext.

OK so the design is:
1. Each user has an Ed25519 keypair
2. Content is signed by the author
3. Private content is encrypted to recipients' public keys (using ECIES or similar)
4. Content is stored on the hub but the hub cannot forge or read
5. Identity is the public key; the human name is just an alias
6. Recipients on other hubs can fetch content addressed to them

Let me think about the cryptography more carefully.

**Signing**: Ed25519 (standard in many languages).

**Encryption**: We need public-key encryption. Ed25519 is for signing. For encryption, we need either:
- Curve25519 for ECDH (X25519)
- Use Ed25519 public key → X25519 public key conversion (works in libsodium, but in standard library?)

In Python's standard library, we don't have Curve25519. In Go's standard library, we have ed25519 but not X25519 directly (though crypto/ecdh was added in Go 1.20). In Rust, we have curve25519-dalek but that's not std. In JavaScript (Node), the Web Crypto API has Ed25519 but not X25519 in many environments.

Hmm, this is a problem. The design says "Ed25519, SHA-256, HTTP, JSON, and base64 are illustrations of what that means in practice, not a closed list — any primitive your target language's standard library actually provides is in bounds."

So if we're implementing in Go 1.20+, we have crypto/ecdh. In Python 3.x, we don't have X25519 in stdlib. In Node, we have some support.

Maybe we use ECIES with a different curve, like P-256, which is widely available. Or we use RSA-OAEP, which is universally available.

But RSA keys are big. For a "small families" use case, that's fine.

Or: We use Ed25519 for signing and a separate key for encryption. The encryption key could be X25519 or P-256. But we need a standard library primitive.

Let me think of a construction that only uses Ed25519 + SHA-256 + ... wait, that won't work for encryption.

Maybe the encryption is done at a higher level using a symmetric key, and the symmetric key is shared via some mechanism that only requires signing.

Actually, here's an idea: Use the signing keypair for both signing and key agreement via a "signcryption" or custom construction. But this requires care.

Or: just use two keypairs per user. One Ed25519 for signing, one for encryption. The encryption keypair is generated as needed. The encryption keypair is published alongside the identity.

What curve for encryption? Let's see what's commonly available in standard libraries:
- Go: P-256 (ecdh), X25519 (ecdh), RSA
- Python: RSA (via cryptography? no, that's not stdlib). Actually Python stdlib has nothing modern for ECC encryption. RSA in PyCryptodome but not stdlib.
- Node: ECDH P-256, P-384, P-521 via Web Crypto. X25519 in newer versions.
- Rust: ring or x25519-dalek needed, not stdlib
- Java: built-in ECDH, RSA

Hmm. The most portable is RSA. Let's consider RSA-OAEP for encryption.

But RSA keys are 2048+ bits, which is annoying for inclusion in JSON.

Alternative: use a KEM/DEM construction where the KEM is a hash-based or symmetric primitive, but this requires shared secrets, which is what we're trying to establish.

Wait, here's a thought: what if the encryption is done using the recipient's signing public key, using a scheme like "signcryption" or a custom construction? But this is tricky.

Let me re-think. The key insight: the encryption doesn't need to be non-malleable or authenticated at the cryptographic level — it's already authenticated by the signature. The author signs the encrypted content. So the encryption just needs to provide confidentiality against the hub.

For confidentiality, we need to encrypt content to a recipient. The recipient's public key is the only thing we have.

Standard approach: ECIES. ECDH to derive a shared secret, then KDF, then AES-GCM or ChaCha20-Poly1305.

If we're in an environment without ECC, we use RSA-OAEP or RSA-KEM.

Or, we could use a different approach: 
- The recipient publishes a long-term public key (Ed25519 or RSA)
- For each message, author generates an ephemeral keypair
- ECDH between ephemeral and recipient's key
- Derive symmetric key, encrypt

For Ed25519, the typical approach is to convert to Curve25519 for ECDH. This is possible in Go's standard library since 1.20 with crypto/ecdh.

Let me just commit to: Ed25519 for signing, X25519 for encryption (with crypto/ecdh in Go 1.20+, and in other languages with similar). If X25519 is not available in the standard library, fall back to P-256 ECDH. If neither, RSA-OAEP.

But the design says we should say which primitives we're assuming. So I'll say: Ed25519 for signing, X25519 for ECDH (assuming a standard library that provides this, e.g., Go 1.20+ or libsodium-equivalent), HKDF-SHA256 for key derivation, ChaCha20-Poly1305 or AES-256-GCM for encryption.

Actually wait. The brief says "Ed25519, SHA-256, HTTP, JSON, and base64 are illustrations of what that means in practice, not a closed list — any primitive your target language's standard library actually provides is in bounds". So I can specify any primitive that's in some standard library. X25519 is in Go stdlib (1.20+), Python via... hmm, not really. But the brief says I should say which I'm assuming.

Let me pick: Ed25519, SHA-256, X25519 (or Curve25519 ECDH), HKDF, ChaCha20-Poly1305 or AES-GCM. These are in Go stdlib and increasingly in others.

For the simplest version, maybe just: Ed25519 for signing, and for encryption, use a hybrid scheme: ECDH with the recipient's encryption public key (X25519) + ephemeral key, then ChaCha20-Poly1305.

OK let me now think about the protocol structure.

**Components**:
- Actor (identity)
- Activity (post, reply, like, follow)
- Object (the content being acted on)
- Collection (ordered list of activities, e.g., outbox, inbox)

**URLs** (assuming the hub serves at a domain):
- `https://hub.example/actor/name` — actor profile
- `https://hub.example/actor/name/outbox` — public activities
- `https://hub.example/actor/name/inbox` — where to send activities to this actor
- `https://hub.example/actor/name/followers` — list of followers
- `https://hub.example/activity/{id}` — individual activity

But the identity is the public key, not the URL. The URL is the hub's location for the actor. The actor can move to a different hub.

So we need an indirection: a way to resolve "I want to find actor X" to "X is at this hub".

This is the "discovery" problem. In ActivityPub, it's the `webfinger` protocol. In Bluesky, it's the DID PLC.

For this design, since we want no shared infrastructure, we need either:
- A well-known location that maps name@domain to a hub URL
- A way to bootstrap from the name+domain

WebFinger style: `https://hub.example/.well-known/webfinger?resource=acct:alice@example.com` returns a JSON with a link to the actor's profile.

But the identity is the public key. So when you find an actor at a URL, you get their public key, which is their identity. If they move, you can verify that the new URL is controlled by the same key.

**Signed activities**:
An activity is a JSON object with:
- `@context` (or similar) to identify the type
- `id`: URL of this activity
- `type`: "Create", "Like", "Follow", etc.
- `actor`: URL of the actor
- `object`: the content (or URL to it)
- `published`: timestamp
- `signature`: signature by the actor's key

**Content addressing**:
- Each activity has a unique URL
- The URL is content-addressed or just a unique ID
- A simple scheme: `{actor-url}/activities/{random-id}`

**Encryption**:
- For "family-only" content, the content is encrypted
- The encrypted blob is included in the activity
- The recipients are listed in an "enc-to" field with their public keys
- The hub sees the encrypted blob and the recipient public keys, but not the plaintext

Wait, but if we list recipient public keys, the hub knows who the audience is. The brief says "what the hub learns anyway" so it's OK for the hub to learn the audience of encrypted messages, but not the content. Let me re-read:

"what the hub learns anyway" — this is the section to describe what the hub learns. The hub learns:
- Who published what (signed metadata)
- The audience of encrypted messages (if we include recipient public keys)
- The size and timing of messages

The hub does NOT learn:
- The content of encrypted messages
- The signing keys

So listing recipient public keys is fine. The hub knows "Alice sent a message to Bob and Carol" but not what it says.

But wait, the brief says: "Anonymity or traffic-analysis resistance beyond hiding who an encrypted message is for." So hiding the audience IS a goal. Let me re-read.

"hiding who an encrypted message is for" — yes, this is in scope. So we should NOT include recipient public keys in the clear.

But how do recipients know to fetch the message if they don't know they're a recipient?

Options:
1. Each recipient's hub is sent a notification. The hub can then fetch the content.
2. Recipients poll their inbox on their hub, and their hub fetches from the author's hub.

In the inbox model, the author's hub sends a copy of the encrypted message to each recipient's hub. The recipient's hub stores it in the recipient's inbox. The hub learns who the recipient is (because it received the message), but the original author's hub might not know the recipient's identity (if it's done via a relay).

Hmm, this is getting complex. Let me think about it.

**Federation model**:
- Alice (alice@a.example) writes a family post
- The post is addressed to Bob (bob@b.example) and Carol (carol@c.example)
- Alice's hub encrypts the post for Bob and Carol
- Alice's hub sends a copy to Bob's hub and Carol's hub
- Bob's hub stores it in Bob's inbox
- Bob's app fetches Bob's inbox and decrypts

In this model, Alice's hub knows Bob and Carol's hub addresses (to send to). So Alice's hub knows the audience. But the audience is just hub addresses + user names, which is acceptable.

The "hiding who the message is for" is at the level of the wire bytes between hubs. If Alice's hub sends directly to Bob's hub, then the network observer knows Alice's hub is sending to Bob's hub. If we want to hide this, we'd need a relay. But the brief says "beyond hiding who an encrypted message is for" — so we do want to hide this from the hub, but not necessarily from network observers.

Actually, the brief is about the hub. The hub is the adversary. So we want to hide the content and audience from the hub. But the hub is the one sending the message, so it knows the audience.

Unless we use end-to-end encryption where the author's app encrypts to recipients' keys and the hub just routes opaque blobs.

OK here's the design:
- The author's app generates the activity
- The activity includes a "to" field listing the audience (by actor URL or by public key)
- For private activities, the content is encrypted
- The encrypted blob is what's sent over the wire
- The hub sees: who is sending, who is receiving (URLs/keys), the encrypted blob
- The hub CANNOT see: the plaintext content
- This satisfies "hiding what wasn't meant for the hub"
- The hub DOES see the audience — this is the "what the hub learns anyway"

So the design doesn't hide the audience from the hub, but it does hide the content. And the network observer sees the same thing as the hub (assuming no TLS hiding, which TLS provides).

OK so to summarize:
- Hub learns: who sent to whom, when, the size of messages
- Hub does NOT learn: content of encrypted messages, signing keys
- This is acceptable per the brief

Now, the "to" field. If the audience is hidden from the hub, we have a problem because the hub needs to know where to deliver. So the audience is visible to the hub, just not the content.

**Replies and reactions**:
- A reply is a new activity that references the original
- The reply is also signed by the replier
- For private threads, the reply is also encrypted to the thread participants
- The reply is sent to the thread participants' hubs

**Following**:
- A follow activity is signed by the follower
- Sent to the followee's hub
- The followee's hub stores it
- The followee's app can see the follow

**The divorce scenario**:
- Alice's account is on the family hub, run by hostile ex-husband
- Alice's key is on her device, not the hub
- Alice's content is signed by her key
- The hub cannot forge her content
- The hub cannot read her encrypted private content
- Alice can leave by taking her key and content
- Her new hub is at a different URL
- She publishes a "move" activity signed by her key
- Followers see the move and follow her new location
- The old hub is left with stale content

But how do followers know to follow her new location? The "move" activity needs to be visible to followers even if the hub is hostile. 

Solution: The move activity is also distributed to followers' hubs (they have her in their inbox). Her new hub can also send a notification. Or: the move activity is broadcast through a relay or gossip network.

Alternatively, the design includes a "user discovery" mechanism. Each user has a stable identity (public key). The hub URL is just a current location. To find someone, you look up their identity.

How do you look up an identity without a global registry?
- WebFinger: name@domain → hub URL
- If the domain is the same, you can find them
- If the domain changes, you need another mechanism

For the "domain goes" scenario: `family.example` becomes unaffordable. The new location is, say, `alice@newdomain.example`. Followers need to find her there.

One approach: she signs a "tombstone" or "move" activity that includes her new location. This is distributed to all followers. Each follower, on seeing this, updates their subscription.

But the hostile hub might refuse to distribute this. So the move activity needs to go directly to followers' hubs, bypassing the hostile hub.

How? The author's app can directly send to each follower's hub. The app knows the followers (from the followers list, which is part of the public data). The app can iterate through followers and send the move activity to each.

This works. The author's app does the federation directly, not relying on the hub.

Or: the move activity is published to a relay or gossip network. But the brief says no global infrastructure.

So the design is: the app does federation. The hub is just storage.

OK so the architecture is:
- A user has a device (phone, laptop) with their keys
- A hub provides storage and serves content over HTTPS
- The app on the device signs content and uploads to the hub
- The app on the device also federates: sends activities to other hubs directly
- The hub serves content to readers and to other hubs

Wait, if the app does the federation, then when the app is offline, federation doesn't happen. That's a problem.

So maybe the hub does the federation. But the hub is hostile. So the hub might not federate correctly.

Solution: the hub must federate according to the spec. If it doesn't, it's violating the spec. But the spec is voluntary.

Hmm. Maybe the design accepts this: if the hub is hostile, federation may be disrupted. The user can switch hubs.

Or: the design uses a push model where the app pushes to followers directly when online. When the app is offline, the hub can serve the content to readers who poll, but push federation requires the app.

Let me think about the "two hubs, one thread" scenario. A and B are on different hubs. A family-only post, reply, reaction cross the hub boundary. The hub boundary is transparent for access control.

This means: when A posts a family-only post, the post is encrypted to A's family list. The hub sends a copy to B (and others). B's hub stores it in B's inbox. B's app fetches and decrypts.

If A's hub is hostile, A's hub might not send to B. But A's app can do it directly.

So the design: the app, not the hub, handles federation. The hub is just storage and serving.

For pull-based readers: a reader polls A's hub for A's outbox. The hub serves the outbox. The reader can verify signatures.

For push-based: A's app pushes to B's hub. B's hub stores in B's inbox. B's app fetches B's inbox.

OK this is workable. The app is the active participant. The hub is dumb storage.

For the "big lazy hub" scenario: 10,000 people on one hub. The hub is hostile. Per-identity cost stays flat.

The per-identity cost is: storage of signed content. The hub serves content. The hub cannot read encrypted content. The hub can refuse to serve, but the user can leave.

For the hub to be hostile at scale, it might deny service to specific users. But the user can leave. So per-identity cost (to the user) is: ability to leave at any time, which is preserved.

The hub's cost is linear in storage and bandwidth, which is normal.

OK I think I have a good mental model. Let me now write up the design.

**The identity primitive**:
A person is an Ed25519 keypair. The public key is the identity. The private key is the signing key.

A "name" is a human-readable label, scoped to a hub. So "alice@hub.example" is a name on a hub. The hub maintains a mapping of name → public key, but this mapping is just for human convenience. The identity is the public key.

Why not just use a name? Because names are not unique and not owned. Why not use a domain? Because domains are not portable and can be taken away. Why not use an email? Same issues.

A public key is self-certifying. The person is the holder of the private key. No one else can be them.

Rejected alternatives:
- Email address: depends on DNS, not self-certifying
- Phone number: depends on telecom, not portable
- Domain name: rent-able, can be taken
- Random UUID: not human-friendly, no provenance

**The artifacts**:
1. **Actor profile**: JSON document with the actor's public key, name, bio, avatar URL, inbox URL, outbox URL.
2. **Activity**: JSON document with type, actor, object, timestamp, signature.
3. **Object**: the content (article, note, image, etc.), signed as part of the activity.
4. **Collection**: an ordered list of activities (outbox, inbox, followers, following).
5. **Encrypted blob**: when content is private, the content is encrypted; the ciphertext is what flows.

**The signature**:
Each activity is signed by the actor's key. The signature is over a canonical JSON serialization of the activity (minus the signature field). The signature is included in the activity.

Canonical JSON: we need a canonical form. The brief says no third-party libraries. Hmm. Canonical JSON is tricky. We can define a simple canonical form:
- Keys sorted alphabetically
- No whitespace
- UTF-8
- Numbers as decimal strings

We can define this in the spec. It's not hard to implement.

**Encryption**:
For each recipient, the author:
1. Generates an ephemeral X25519 keypair
2. Computes ECDH with recipient's X25519 public key
3. Derives a symmetric key using HKDF
4. Encrypts the content with ChaCha20-Poly1305
5. Includes the ephemeral public key and the ciphertext in the activity

Actually, to encrypt to multiple recipients efficiently, use a hybrid scheme:
1. Generate a random symmetric key K
2. Encrypt the content with K (ChaCha20-Poly1305)
3. For each recipient, encrypt K with their public key (ECIES)

So the activity contains:
- The encrypted content
- For each recipient: the encrypted K
- The ephemeral public key (if ECIES)

Wait, ECIES is: ephemeral keypair (e, E=eG), recipient's public key R, shared secret = eR, K = KDF(shared secret), encrypt K to R. But to decrypt, the recipient needs E. So we include E.

Alternatively, we can use a KEM/DEM where the KEM encapsulates the symmetric key.

Simple construction:
- For each recipient R with public key Rpub:
  - Generate ephemeral keypair (e, E)
  - shared = ECDH(e, Rpub)
  - K_r = HKDF(shared, salt, info)
  - encrypted_key_r = ChaCha20(K_r, K_content)
- For the content:
  - encrypted_content = ChaCha20(K_content, content)

Then the activity contains: encrypted_content, list of (E, encrypted_key_r) for each recipient.

This is basically HPKE (Hybrid Public Key Encryption). RFC 9180. We can use a simplified version.

Actually, let me simplify even more. We can use HPKE directly if the standard library supports it, or define a simple ECIES-like scheme.

Let me define: 
- Each actor has a long-term X25519 keypair for encryption (separate from the Ed25519 signing key, or derived from it).
- For each message:
  - Generate random 32-byte symmetric key K
  - Encrypt content: c = ChaCha20-Poly1305(K, content)
  - For each recipient with encryption public key Rpub:
    - Generate ephemeral X25519 keypair (e, E)
    - shared = ECDH(e, Rpub)
    - k_r = HKDF(shared, salt=E, info="message-key")
    - enc_K = ChaCha20-Poly1305(k_r, K)  // wrap K
  - Bundle: {c, [(E1, enc_K1), (E2, enc_K2), ...]}

The recipient:
- Finds their entry in the bundle
- Computes shared = ECDH(r_priv, E)
- k_r = HKDF(shared, salt=E, info="message-key")
- K = decrypt(k_r, enc_K)
- content = decrypt(K, c)

This is straightforward.

**Recipient addressing**:
The "to" field of an activity lists the recipients. For public activities, it's "https://www.w3.org/ns/activitystreams#Public". For private, it's a list of actor URLs or public keys.

The audience is visible to the hub. The content is encrypted.

For the hub to deliver to recipients on other hubs, the author's hub (or app) sends a copy to each recipient's hub inbox URL.

**Key change and recovery**:
- Rotation: the user generates a new keypair. Signs a "KeyRotation" activity with the OLD key, declaring the NEW public key. The new key takes effect immediately.
- Loss: recovery contacts help. The user designates M-of-N recovery contacts. Each contact has an encrypted share of the signing key (or a wrapped copy). To recover, the user contacts M of them.
- The contested departure: when the user leaves, they sign a "Move" activity with their key, declaring the new hub URL. The hub can refuse to serve this, but the user can distribute it through other channels (their app, directly to followers' inboxes).

For the "hostile hub claims the departure is a forgery": the user's signed move activity is verifiable. The signature proves it came from the user's key. The hub cannot forge it. So the hub can claim it's a forgery, but verifiers can check the signature.

**Granma onboarding**:
- User installs app, picks a name
- App generates keypair
- App prompts for a recovery contact (e.g., daughter)
- App sends encrypted backup to daughter's inbox (or to daughter's recovery endpoint)
- Grandma doesn't see the key, doesn't store a file
- If grandma loses phone, she calls daughter, daughter helps set up new phone, daughter's app provides the backup

The backup is encrypted to the daughter's key, so only daughter can decrypt. But daughter needs to give it back to grandma, not use it herself. The social contract handles this. The technical mechanism ensures that daughter can't accidentally leak it to others.

**The cost sheet**:
- Bad at: real-time federation when the app is offline
- Cannot deliver: hiding the audience from the hub
- More complex than it looks: canonical JSON, encryption to multiple recipients
- Least sure: the key recovery for grandma without a passphrase

**What to cut**:
- Reactions (likes, etc.) — these are just special cases of activities, can be added later
- Image uploads — can use external image hosts, or define later
- Federation of follower lists — just use the outbox

OK let me now write this up as a coherent design.

Actually, let me think about one more thing: how does the "followers list" work?

When Alice follows Bob, Alice's app sends a "Follow" activity to Bob's hub. Bob's hub stores it in Bob's inbox. Bob's app sees the follow in the inbox. Bob's app then adds Alice to Bob's followers list (or not — Bob might need to approve).

For Bob to send a post to all his followers, Bob's hub (or app) iterates through the followers list and sends a copy of the post to each follower's inbox. The post is encrypted to the followers.

If the hub is hostile, it might not deliver. The user's app can do the delivery.

For a user with thousands of followers, this is a lot of copies. The brief says the design scales across many identities, not millions of items per person. So thousands of followers is in scope. Sending a copy to each is feasible.

**The feed reader interop**:
For public posts, the outbox can be exposed as RSS/Atom/JSON Feed. The hub provides a feed at a standard URL. Existing feed readers can subscribe.

For the fediverse interop: ActivityPub is the standard. We could bridge to ActivityPub. But the design is not ActivityPub. We define our own format. A bridge translates.

The brief says: "The content reaches existing feed readers (RSS / Atom / JSON Feed) and the fediverse / Bluesky with nothing extra built."

Hmm, "with nothing extra built" — does this mean the design itself produces RSS or that we just need to bridge? Let me re-read.

"The content reaches existing feed readers (RSS / Atom / JSON Feed) and the fediverse / Bluesky with nothing extra built. Their replies coming back is an extension, not a requirement."

I think this means: the design's content should be readable by existing feed readers without the reader needing to be modified. And the design's content should be visible in Mastodon etc. through a bridge (which someone else builds).

So the outbox format should be JSON Feed (or RSS, Atom) so feed readers can read it. For fediverse, a bridge can translate.

JSON Feed is the simplest. Let's use JSON Feed for the public outbox.

**Let me now structure the design document:**

1. Architecture (one page)
2. Identity primitive
3. The four floor assurances, mechanism by mechanism
4. Scenario walk-throughs
5. Key change and recovery
6. Encryption construction
7. Cost sheet
8. What to cut

Let me draft this. The user wants a design, argued, with concrete details, and as long as it needs to be.

I'll aim for something thorough but not endless. Maybe 4-6k words.

Let me think about a few more things:

**Canonical JSON**:
We need a canonical form for signing. Options:
- Sort keys alphabetically, no whitespace, UTF-8
- Use a specific JSON canonicalization scheme (JCS, RFC 8785)

JCS requires a library typically. We can define our own simpler canonical form:
- Object keys sorted by code point (or by length, then code point)
- No insignificant whitespace
- Numbers in a specific format
- Strings with specific escaping

Actually, a simple approach: define a canonical form where:
- Object keys are sorted lexicographically by their UTF-8 encoding
- No whitespace
- Strings use JSON escaping (which is deterministic)
- Numbers use a canonical form (integer as integer, no leading zeros, etc.)

This is implementable in 50 lines of code.

**The activity format**:
I'll define a simple format inspired by ActivityStreams but simpler:

```
{
  "@type": "Post",
  "id": "https://hub.example/actor/alice/posts/123",
  "actor": "https://hub.example/actor/alice",
  "published": "2024-01-15T10:00:00Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "content": "Hello world",
  "signature": {
    "keyId": "https://hub.example/actor/alice#key",
    "value": "base64-signature"
  }
}
```

For encrypted content, the "content" field is replaced with an "encrypted" field containing the ciphertext and recipient info.

**The actor profile**:
```
{
  "@type": "Person",
  "id": "https://hub.example/actor/alice",
  "name": "Alice",
  "preferredUsername": "alice",
  "inbox": "https://hub.example/actor/alice/inbox",
  "outbox": "https://hub.example/actor/alice/outbox",
  "publicKey": {
    "id": "https://hub.example/actor/alice#key",
    "publicKeyBase64": "..."
  },
  "encryptionKey": {
    "id": "https://hub.example/actor/alice#enc-key",
    "publicKeyBase64": "..."
  }
}
```

**HTTP endpoints** (on the hub):
- GET /actor/{name} — actor profile
- GET /actor/{name}/outbox — public outbox (JSON Feed or our format)
- GET /actor/{name}/inbox — inbox (for the actor's app)
- POST /actor/{name}/inbox — for others to send activities
- GET /actor/{name}/followers — followers list
- GET /activity/{id} — individual activity

**Discovery**:
- WebFinger: GET https://hub.example/.well-known/webfinger?resource=acct:alice@hub.example
- Returns: { "links": [{ "rel": "self", "type": "application/json", "href": "https://hub.example/actor/alice" }] }

**The move activity**:
When Alice moves to a new hub:
```
{
  "@type": "Move",
  "id": "...",
  "actor": "https://old-hub/actor/alice",
  "target": "https://new-hub/actor/alice",
  "signature": { ... }
}
```
The new hub's actor profile is signed by the same key (or the new key if rotated).

**Key rotation**:
```
{
  "@type": "KeyRotation",
  "id": "...",
  "actor": "...",
  "newKey": { ... },
  "signature": { signed by OLD key ... }
}
```

**The "stale" indicator**:
After Alice leaves, the old hub still has her content. Readers can see that:
- The content is signed by Alice's old key
- The actor profile on the old hub might not be updated
- Or, there's a "movedTo" field in the actor profile

For readers to know it's stale, the actor profile on the old hub should include a "movedTo" field signed by Alice, pointing to the new location. If the hostile hub removes this, readers might not know. But readers can check: if they can't fetch the actor from the old hub, or if the key doesn't match, treat as stale.

Actually, the old hub might keep serving the old content. The reader needs to discover the move. The reader should periodically re-resolve the actor's location (e.g., via WebFinger at the original domain). If the domain still resolves but the hub is different, or if the WebFinger points to a new location, the reader follows the new location.

Hmm, this is getting complex. Let me think about the "domain goes" scenario: the domain is unaffordable. So the DNS doesn't resolve. Readers can't fetch WebFinger. How do they find the new location?

This is the fundamental problem of decentralized identity: how do you find someone after they move?

Options:
- The user tells their followers directly (out-of-band)
- The user's recovery contacts hold the new location
- A "tombstone" is left at the old location that includes the new location
- The user publishes their new location through some other channel

For a small audience (family), the user can tell people directly. For a larger audience, this is harder.

The design should provide a mechanism: the actor profile, when fetched, includes a "movedTo" field. If the domain is gone, readers can ask recovery contacts (if they know who they are) or wait for the user to re-establish.

Actually, the user can sign a "tombstone" activity that includes the new location, and this tombstone is distributed to all followers' inboxes. So when the user moves, they:
1. Sign a Move activity
2. Distribute it to all followers' inboxes
3. The new hub is now the canonical location

Followers receive the Move in their inbox (from when the user was still on the old hub, or pushed by the user's app to the new hub). They update their subscription to the new location.

If the old hub is hostile and refuses to distribute the Move, the user's app can do it directly.

OK I think I have enough. Let me write the design.

Wait, one more thing: the brief says "A goal, not a description" for minimality. So I should be terse where possible.

Also: "Where you make a nonobvious choice, name the alternative you rejected and why."

Let me start writing.

---

Actually, I realize I need to think more carefully about the canonical JSON issue. Many signing failures in similar protocols come from canonicalization differences. Let me think about a simple, unambiguous approach.

Simple canonical JSON for signing:
1. UTF-8 encoding
2. Object keys sorted by their JSON-escaped form (or by the raw UTF-8 bytes of the key)
3. No whitespace outside of strings
4. Numbers: integers as integers, no leading zeros, no trailing zeros, exponent lowercase
5. Strings: standard JSON escaping
6. Booleans: true/false
7. Null: null

This is implementable.

But to be safe, we can define a "signature input" that is a list of fields, not the whole JSON. Like: "sign the concatenation of: id, actor, type, published, content-hash". This avoids the canonicalization issue entirely.

Actually, let me define a "signature" as:
- The signature input is the SHA-256 hash of the canonical JSON of the activity (excluding the signature field)
- The signature is Ed25519(private_key, hash)

Or we can use a simpler approach: "to sign, concatenate the values of specific fields with a separator, and sign that." But this is fragile.

The cleanest is canonical JSON. Let me commit to that.

For canonical JSON, I'll specify:
- Encode to UTF-8
- Object keys sorted by their byte representation (lexicographic)
- No whitespace
- Standard JSON number formatting
- The result is a byte string

Implementable in ~100 lines of any language.

---

One more design decision: how do we handle the "inbox" for private content?

When Alice sends a private post to Bob, the post is encrypted. The post needs to get to Bob. Options:
1. Alice's hub sends a copy to Bob's hub inbox
2. Alice's app sends a copy to Bob's hub inbox directly
3. Bob's app polls Alice's hub for new content addressed to him

Option 3 is problematic: Bob's app would need to poll every potential author. Not scalable.

Option 1 or 2: the message is delivered to Bob's hub. Bob's app fetches Bob's inbox and decrypts.

The hub sees: Alice sent a message to Bob (hub addresses). The hub does NOT see the content.

If Alice's hub is hostile, it might not deliver. Alice's app can deliver directly (option 2). The app is the active participant.

OK so the design: the app does the federation. The hub is storage. When the app is online, it federates. When offline, federation is delayed.

For the user's own reader, they fetch their inbox from their own hub. The hub serves it.

---

Let me also think about the "feed reader interop" more carefully.

The brief says: "The content reaches existing feed readers (RSS / Atom / JSON Feed) ... with nothing extra built."

This means: a public outbox should be readable by a stock feed reader. So the outbox URL should serve a standard feed format.

JSON Feed is the simplest: https://www.jsonfeed.org/

The hub serves the outbox as JSON Feed. The activity format is similar but not identical. We can map:
- Actor's "Post" with type=Note → JSON Feed item
- Content is HTML or text
- Published → date_published
- etc.

For this to work "with nothing extra built", the hub must serve JSON Feed at the outbox URL. Or the app serves it. Either way, the outbox is JSON Feed-compatible.

Hmm, but our internal format has signed activities. JSON Feed doesn't have signatures. For public posts, the signature might be optional or included as an extension.

Actually, for public posts, the hub serves the content. The reader can verify signatures by fetching the actor profile and checking the signature. The hub cannot forge because it doesn't have the key.

For private posts, the content is encrypted, so feed readers can't read them anyway. Private posts are not in the public outbox.

So: the public outbox is JSON Feed, with optional signature fields. Private posts are in a separate "private outbox" or are pushed to recipients' inboxes.

Or: the outbox contains all activities, but private ones have encrypted content. Public feed readers see only the public ones (filter by audience).

Let me simplify: the outbox is an ordered list of activities. Each activity has a "visibility" field: "public" or "private". Public ones go to JSON Feed. Private ones are encrypted and pushed to recipients.

Or even simpler: the outbox is just for public posts. Private posts are not in the outbox; they're in the inbox of recipients.

Yes, this is cleaner. The outbox is the public feed. Private posts are delivered to inboxes.

So:
- Outbox: public activities, served as JSON Feed (or our format with JSON Feed extension)
- Inbox: activities sent to the actor (follows, replies, private posts addressed to them)
- The actor's app fetches the inbox to see new content

**Final structure**:
- Actor: profile with public keys
- Outbox: public posts (JSON Feed)
- Inbox: incoming activities (private posts addressed to actor, follows, etc.)
- Followers collection: list of followers (for the actor to know who to send to)
- Following collection: list of actors the user follows (for the user's reader)

The hub serves these. The app fetches and displays.

OK I think I'm ready to write. Let me also think about the "dumb hub" requirement: a third implementer writes a hub that serves both publishers and readers.

A dumb hub:
- Serves static files
- Accepts POST to inbox (with some auth)
- No federation logic (the app does federation)
- Just storage and serving

This is a simple ~500 line implementation.

**OK, let me write the design now.**

Actually, one more thing: the brief mentions "Millions of items per identity" as a non-goal. So the design is for small-scale personal publishing. Hundreds or thousands of items, not millions. This simplifies things.

**Identity recovery detail**:

For grandma's recovery:
- On setup, the app generates a signing keypair and an encryption keypair
- The app asks for a recovery contact (or several)
- The app generates a "recovery bundle": the signing private key encrypted to the recovery contact's encryption public key
- This bundle is sent to the recovery contact's hub (specifically, to a "recovery" endpoint or to the contact's app)
- The recovery contact stores it
- If grandma loses her device, she calls her daughter
- Daughter's app sends the recovery bundle to grandma's new device
- Grandma's new device decrypts with daughter's help... wait, daughter needs to decrypt first. 

Hmm. The recovery bundle is encrypted to the daughter's key. Only the daughter can decrypt it. But the daughter needs to give the plaintext key to grandma. The social contract: the daughter is trusted to give it only to grandma.

But the threat model is: the hub is hostile, not the daughter. The daughter is trusted. So this is OK.

Alternative: the recovery bundle is encrypted to a key derived from a passphrase that the user chose. But the brief says grandma doesn't know a passphrase.

Alternative: the recovery bundle is split between M contacts, and M are needed to reconstruct. This is more robust. Let's do M-of-N.

For M-of-N without Shamir: we can do simple secret sharing with XOR. For 2-of-2: key = share1 XOR share2. For 3-of-3: similar. For M-of-N with M < N, we need a more sophisticated scheme.

Actually, we can use a simple construction: 
- Generate N shares, each is a random 32-byte value
- The actual key is XOR of all N shares
- For reconstruction, need all N
- For threshold M, we need a different scheme

This requires Shamir or similar. Not in standard library typically.

Alternative: use a "trustee" model. The user designates N trustees. M of them must cooperate. Each trustee has a copy of the key encrypted to their public key. To recover, the user contacts M trustees, each decrypts their copy and sends the plaintext to the user.

But if each trustee has the full key, then any one trustee can impersonate. The M-of-N requirement is for availability (need M to recover), not for security (one trustee is enough to compromise).

So for security, we need secret sharing. For availability, we need M-of-N.

If we accept that recovery contacts are trusted (they could collude to impersonate), then we can just give each contact an encrypted copy. Need M of N to be available, but security is based on the trust of the contacts.

This is acceptable per the threat model. The threat model is about the hub, not about recovery contact collusion.

So: each recovery contact has an encrypted copy of the signing key. The user needs any one to recover. For availability, having multiple contacts means the user can recover if at least one is available.

But the brief says "M of N". Let me re-read.

"She is back by calling her daughter."

Just one contact. So 1-of-N. Each contact has a copy. Any one can help.

OK so the simple design: N recovery contacts, each has an encrypted copy of the key. User needs 1 to recover.

This is simple and implementable.

For the M-of-N case (if we want it for higher security), we can use a simple XOR scheme for M=2 of N=2: two shares that XOR to the key. For other M, N, we'd need a more complex scheme. Let's stick with 1-of-N for simplicity, and note that 2-of-N could be done with XOR for N=2.

**Final recovery design**:
- User designates N recovery contacts (N >= 1)
- App generates a "recovery bundle" for each contact: {encrypted_key: ChaCha20(contact_enc_pubkey, signing_privkey)}
- Bundle is sent to contact's "recovery" endpoint or stored in contact's app
- To recover: user contacts one recovery contact, who decrypts and sends back the key
- Security: the contact could impersonate, but contacts are trusted
- Availability: user can recover if at least one contact is available

Actually, the contact shouldn't just send the plaintext key. The contact should send it to the user's new device in a secure way. But this is over the internet, so TLS protects it.

OK I think I have a complete design. Let me write it.

Let me also think about the "contested departure" in more detail.

The hostile ex-husband runs the hub. Alice wants to leave. She has her signing key on her device. She:
1. Sets up a new hub (or uses a friend's hub)
2. Creates a new actor profile on the new hub with the same public key
3. Signs a "Move" activity with her key
4. Distributes the Move to all her followers (pushing to their inboxes)
5. Optionally, leaves the old hub

The hostile hub might:
- Refuse to serve her content anymore
- Continue serving her old content as if it's current
- Claim the Move is a forgery

The Move activity is signed by her key. Anyone with her public key can verify it. The hub cannot forge it because the hub doesn't have her private key.

After the Move, followers should:
- Update their subscription to the new hub
- Treat the old hub's content as stale
- The old hub might continue serving old content, but it's no longer authoritative

To prevent the old hub from serving "stale" content that looks current:
- Readers can check the "movedTo" field in the actor profile
- If the old hub removes this, readers might not know
- But readers can be told via the Move activity pushed to their inbox

If the hostile hub refuses to deliver the Move activity to followers' inboxes, Alice's app can do it directly. The app iterates through Alice's followers list and pushes the Move to each follower's hub inbox.

The followers list is public (or at least, Alice has access to it). Alice can fetch it from the old hub (if the hub serves it) or maintain her own copy.

OK this is workable.

**One issue**: if the old hub is hostile and doesn't serve the followers list, Alice might not know who to notify. But she likely has her own copy (her app tracks who she follows and who follows her). Or she can ask her close contacts to spread the word.

For a small audience (families), word-of-mouth is fine. For larger audiences, the followers list is important.

The design: the followers list is part of the public data. The hub serves it. If the hub doesn't, the user's app has a copy.

**OK, writing time.**

Let me structure the document:

# Design: A Protocol for Decentralized Personal Publishing

## 1. Architecture (one page)
## 2. Identity
## 3. The Four Floor Assurances
## 4. Scenario Walk-throughs
## 5. Key Change and Recovery
## 6. Encryption Construction
## 7. Cost Sheet
## 8. What to Cut

Let me draft section by section.

---

# Section 1: Architecture

The system has three kinds of participants:

**The Device** (the user's app): holds the user's signing key, publishes content, fetches content from the network, encrypts private content, decrypts incoming private content, handles federation.

**The Hub** (the server): stores signed content, serves it over HTTPS, accepts incoming activities for the user, and provides a public profile. The hub is *dumb*: it does not have the user's signing key and cannot read encrypted private content. The hub's job is to be there when the device is offline.

**The Reader** (a feed reader or another user's app): fetches content from hubs, verifies signatures, displays to the user.

**Artifacts**:

1. **Actor Profile**: a JSON document at `https://{hub}/{name}` containing the user's public keys, display name, bio, inbox/outbox URLs, and current hub location.

2. **Activity**: a JSON document representing a Post, Reply, Like, Follow, Move, KeyRotation, etc. Signed by the actor's signing key.

3. **Object**: the content of an activity (a note, an article, a photo reference). For public content, it's inline or referenced by URL. For private content, it's encrypted.

4. **Collection**: an ordered list of activities. The outbox contains the actor's public posts. The inbox contains activities sent to the actor. Followers and Following are lists of actor references.

**First contact**: a reader who knows `alice@hub.example` does a WebFinger lookup at `https://hub.example/.well-known/webfinger?resource=acct:alice@hub.example`, gets the actor URL, fetches the actor profile, and learns the inbox/outbox URLs and public keys.

**Polling**: the reader fetches the outbox to see new public posts. The reader fetches their own inbox (on their own hub) to see incoming activities.

**Push**: when Alice posts, her app pushes a copy of the activity to each follower's hub inbox. The app does this directly, not relying on the hub. The hub can also do it as a convenience.

**Signing**: every activity is signed by the actor's Ed25519 signing key. The signature is over the SHA-256 hash of the canonical JSON of the activity (excluding the signature field).

**Canonical JSON**: UTF-8, object keys sorted lexicographically by their byte representation, no insignificant whitespace, standard JSON number formatting.

---

# Section 2: Identity

A person is an **Ed25519 keypair**. The 32-byte public key is the identity. The 32-byte private key is the signing capability.

The "name" (e.g., "alice") is a human label scoped to a hub. The name → public key mapping is maintained by the hub but is *not* the identity. The identity is the public key itself.

The "location" is the hub URL where the actor profile is currently served. The location can change (the user can move hubs). The identity cannot change without a signed key rotation.

**Why a keypair, not a name?** Names are not unique, not ownable, and not self-certifying. A person named "Alice" on one hub is not the same as "Alice" on another. The public key is unique (with overwhelming probability) and self-certifying: only the holder of the private key can produce valid signatures.

**Why not a domain?** Domains are rented, can be seized, and depend on DNS infrastructure. A user does not control their domain the way they control their private key.

**Why not an email?** Same issues as domain, plus email providers can revoke addresses.

**Why not a DID or a blockchain identifier?** These depend on shared infrastructure (a DHT, a ledger, a resolver). The brief excludes these. A raw public key is self-contained: to verify, you only need the key.

**Rejected: a UUID generated by the user.** Not human-friendly, no provenance, no way to bootstrap. A public key is similar but comes with a built-in verification mechanism.

**The human name**: the name is for humans. "alice@hub.example" is how people refer to the identity. The name is a property of the hub, not of the identity. If alice moves from hub.example to newhub.example, she is still the same identity (same public key), but her name on the new hub might be different.

**Discovery**: WebFinger (`acct:name@domain`) returns the actor URL. The reader fetches the actor URL and gets the public key. From then on, the reader can verify any content from that identity regardless of the hub.

---

# Section 3: The Four Floor Assurances

## Assurance 1: The host cannot speak for you

Every activity is signed by the actor's signing key. The signing key is generated on the user's device and never leaves it. The hub stores signed activities but does not have the key. Any activity the hub serves as "from" the user can be verified against the public key in the actor profile.

**Mechanism**: the device signs before upload. The hub stores the signed blob. Readers verify the signature before displaying.

**Failure mode**: if the device is compromised, the attacker has the key and can sign as the user. This is outside the threat model (the threat is the hub). The design assumes the device is trusted.

**What the hub could try**:
- Serve an old activity as if it's new. The reader sees the timestamp and knows it's old. The reader also checks the actor profile for a "movedTo" field.
- Serve a fabricated activity. The signature won't verify. The reader rejects it.
- Modify a signed activity. The signature won't verify. The reader rejects it.

## Assurance 2: The host cannot read what wasn't meant for it

Private content is encrypted to the recipients' public keys before upload. The hub stores ciphertext. The hub does not have the decryption keys.

**Mechanism**: the device encrypts. The hub stores and serves ciphertext. The recipients' devices decrypt.

**Encryption**: for each private activity, the device generates a random 32-byte content key K. The content is encrypted with K using ChaCha20-Poly1305. K is then encrypted to each recipient's encryption public key using ECIES (X25519 ECDH + HKDF + ChaCha20-Poly1305 key wrap).

**What the hub sees**: the audience list (recipient actor URLs or public keys), the ciphertext, the size and timing. The hub does NOT see the plaintext.

**Failure mode**: if a recipient's device is compromised, the attacker can decrypt. Outside the threat model. If the hub is hostile, it can deny service (refuse to deliver) but cannot read.

**What the hub could try**:
- Read the content: cannot, it's encrypted.
- Modify the content: the signature is over the encrypted blob, so modification breaks the signature. Recipients reject.
- Replay old content: recipients can check timestamps and activity IDs.
- Traffic analysis: the hub sees who sends to whom, when, and the size. This is acceptable per the brief.

## Assurance 3: The host cannot keep you

The signing key is on the user's device. A copy of all content (or the ability to fetch it) is on the user's device. The user can leave the hub at any time.

**Mechanism**: the device holds the key and a local copy of content. The device can set up a new hub, publish the actor profile there, and distribute a "Move" activity signed by the user's key. Followers update to the new location.

**What the user needs to leave**:
- The signing key (on device).
- A copy of the content (on device, or fetchable from the old hub before leaving).
- A new hub (or use a friend's hub, or run their own).
- The followers list (so they can notify followers of the move).

**Failure mode**: if the device is destroyed and the key is lost, the user cannot prove their identity. Recovery contacts can help (see Section 5).

**What the hub could try**:
- Refuse to serve the Move activity. The user's app pushes the Move directly to followers' inboxes.
- Refuse to serve the actor profile. The user has already moved; the new hub is canonical.
- Hold the old content hostage. The user has a local copy or can fetch it before leaving. The old content on the hub is now stale and the hub is no longer authoritative.

## Assurance 4: People on other hubs are first-class

Recipients are addressed by their actor URL (which includes the hub domain). The author does not need to know or trust the recipient's hub beyond using the standard inbox endpoint. There is no access-control agreement between hubs.

**Mechanism**: when Alice posts to Bob, Alice's app fetches Bob's actor profile (from Bob's hub), gets Bob's encryption public key and inbox URL, encrypts the content to Bob, and pushes the activity to Bob's hub inbox. Bob's hub stores it in Bob's inbox. Bob's app fetches and decrypts.

**No server-to-server trust**: Alice's hub does not need to trust Bob's hub. Alice's app just sends the encrypted blob to the URL. The encryption ensures only Bob can read it.

**Failure mode**: if Bob's hub is down, Bob doesn't get the message. This is acceptable; Bob can recover by polling or using a backup hub. The protocol does not guarantee delivery; it guarantees that if delivered, only the intended recipient can read.

---

# Section 4: Scenario Walk-throughs

## Scenario 1: The Divorce

Alice's account is on `family.example`, run by her hostile ex-husband. She wants to leave.

1. Alice's app holds her signing key (generated on first install, never shared with the hub).
2. Alice's app has been pushing her posts directly to her followers' inboxes, not relying on the hub's federation. Her followers have copies of her posts.
3. Alice signs a "Move" activity: `{type: "Move", actor: "https://family.example/actor/alice", target: "https://new-hub.example/actor/alice", signature: ...}`.
4. Alice's app iterates through her followers list (which she has locally) and pushes the Move activity to each follower's hub inbox.
5. Alice sets up a new actor profile on `new-hub.example` with the same public key.
6. Followers' apps see the Move in the inbox, verify the signature (it matches Alice's public key from the old profile), and update their subscription to `new-hub.example`.
7. The ex-husband's hub still has Alice's old content. When readers try to fetch it, the actor profile on the old hub might be gone (Alice deleted it) or marked as moved. Readers who already updated to the new hub ignore the old.
8. The ex-husband can still serve the old content, but any new content must be signed by Alice's key, which he doesn't have. He cannot post as her. He cannot read her private posts (encrypted to recipients). He cannot alter what she wrote (signatures verify).

**What the ex-husband can still do**: deny service to the old hub. He can take it down. He can serve stale content. But he cannot impersonate her, read her private content, or prevent her from continuing to publish on the new hub.

## Scenario 2: Grandma Onboards

Grandma installs the app. She picks the name "grandma" on `family.example`. She is prompted to add a recovery contact. She enters her daughter's name: "daughter@elsewhere.example". She is done.

What happened behind the scenes:
1. The app generated an Ed25519 signing keypair and an X25519 encryption keypair on her device.
2. The app fetched the daughter's actor profile from `elsewhere.example` and got the daughter's encryption public key.
3. The app created a "recovery bundle": the signing private key encrypted to the daughter's encryption public key.
4. The app sent the recovery bundle to the daughter's hub (to a special recovery endpoint or to the daughter's app directly).
5. The app uploaded the actor profile to `family.example` with the public keys.
6. Grandma sees nothing about keys, files, or passphrases.

A year later, grandma loses her phone. She calls her daughter.

1. Grandma installs the app on a new phone. She enters her name "grandma@family.example".
2. The app fetches the actor profile from `family.example` and learns the public keys.
3. The app asks "Recover from a contact?" Grandma says yes and enters her daughter's name.
4. The app contacts the daughter's app, authenticates as grandma (how? — see below), and requests the recovery bundle.
5. The daughter's app sends the recovery bundle, which is encrypted to the daughter's key. The daughter's app decrypts it and sends the plaintext signing key to grandma's new app over an authenticated channel.
6. Grandma's new app now has the signing key and can publish as grandma.

**Authentication problem**: how does the daughter's app know it's really grandma asking? Anyone could claim to be grandma. The threat model here is: an attacker steals grandma's phone number or impersonates her. This is outside the hub-threat model but is a real concern.

**Solution**: the recovery request is signed by the new keypair that the new device generates. Wait, that doesn't help — the attacker generates a new keypair too.

**Better solution**: the recovery is authorized out-of-band. Grandma calls her daughter (voice), daughter verifies it's grandma, daughter then approves the recovery on her device. The daughter's device signs an "approval" that includes the new device's public key. Grandma's new device presents this approval.

But this requires the daughter to be involved in the technical flow, which is a barrier.

**Alternative**: the daughter's app, on receiving a recovery request, sends a push notification to the daughter: "Grandma is trying to recover. Allow?" The daughter taps yes.

This is workable. The social verification is: grandma calls daughter, daughter approves on her device.

The security: only the daughter can approve. The daughter's approval is tied to a specific new device (by its public key). The recovery bundle is then sent to that device.

The daughter's role: she vouches that the new device belongs to grandma. She does this by signing a "recovery approval" with her own key.

This is acceptable. The trust model: recovery contacts are trusted to vouches for the user's identity. This is the social recovery model.

**Alternative: passphrase**. The user picks a passphrase. The recovery bundle is encrypted to a key derived from the passphrase. The passphrase is needed to decrypt. No recovery contact needed.

But the brief says grandma doesn't store a file or remember a passphrase. So passphrase is out.

**Alternative: device-based**. The key is in the device's secure enclave, backed up to the platform's cloud (iCloud, Google Drive). This is the "easy" path but depends on the platform and doesn't give the user control.

The design uses social recovery with trusted contacts. The daughter is trusted. The design does not protect against a malicious recovery contact (but the hub-threat model is the focus).

## Scenario 3: Two Hubs, One Thread

Alice is on `a.example`. Bob is on `family.example`. Carol is on `c.example`. All are in the same family.

1. Alice writes a post addressed to a family group: "to": ["https://family.example/actor/bob", "https://c.example/actor/carol"], "visibility": "private".
2. Alice's app fetches Bob's and Carol's actor profiles, gets their encryption public keys.
3. Alice's app generates a content key K, encrypts the post with K (ChaCha20-Poly1305).
4. Alice's app encrypts K to Bob's encryption key (ECIES) and to Carol's encryption key (ECIES).
5. Alice's app uploads the signed, encrypted activity to `a.example`.
6. Alice's app pushes a copy of the activity to Bob's hub (`family.example/actor/bob/inbox`) and Carol's hub (`c.example/actor/carol/inbox`).
7. Bob's hub stores it in Bob's inbox. Bob's app fetches Bob's inbox, sees a new private post from Alice, decrypts it using his encryption private key.
8. Bob replies. His reply is also private, encrypted to the thread participants (Alice, Carol).
9. Bob's app pushes the reply to Alice's and Carol's inboxes.
10. The thread works across hubs with no access-control configuration.

**Access control**: there is no shared access-control list. The access control is: the author chooses recipients, and the encryption ensures only they can read. The hubs are just routers; they don't enforce access.

**What the hubs learn**: the hubs see that Alice sent something to Bob and Carol, and that Bob replied to Alice and Carol. The hubs see the ciphertext and the audience. The hubs do NOT see the content.

## Scenario 4: The Domain Goes

`family.example` becomes unaffordable. The family moves to `newfamily.example`.

1. Each user signs a "Move" activity: `{type: "Move", actor: "https://family.example/actor/alice", target: "https://newfamily.example/actor/alice", signature: ...}`.
2. Each user pushes the Move to all their followers' inboxes.
3. Each user sets up a new actor profile on `newfamily.example` with the same public key.
4. Followers update their subscriptions.

**For readers who only knew `family.example`**: they can no longer resolve it via WebFinger. But they should have received the Move activity in their inbox (pushed before the domain expired). When they open their reader, the Move is there, and they update.

**For readers who didn't get the Move** (e.g., they were following via the public feed and didn't have an inbox interaction): they lose the subscription. They can re-discover the new location out-of-band (the user tells them) or through a relay (if the design includes one).

**No global registry**: there is no "name registry" to update. The user's identity (public key) is portable. The location changes, but the identity doesn't.

**The hub's role**: the hub serves the current location. When the domain goes, the hub is unreachable. The user must move before the domain expires or arrange a redirect.

---

# Section 5: Key Change and Recovery

## Key Rotation

The user generates a new signing keypair. They sign a "KeyRotation" activity with the OLD key:

```json
{
  "@type": "KeyRotation",
  "id": "https://hub.example/actor/alice/activities/456",
  "actor": "https://hub.example/actor/alice",
  "newPublicKey": "base64...",
  "newEncryptionKey": "base64...",
  "published": "2024-...",
  "signature": { "keyId": "https://hub.example/actor/alice#key-old", "value": "..." }
}
```

The new public key is now authoritative. The actor profile is updated. Followers update their stored public key.

**Why sign with the old key?** To prove the rotation is authorized by the current key holder. Without this, anyone could "rotate" the key.

**Forward secrecy**: old content remains valid (signed by the old key, which is still known). The old key is not deleted; it's just no longer used for new content.

## Key Loss

If the device is destroyed and the key is lost, the user cannot publish new content. Recovery contacts help.

**Recovery contacts**: the user designates N recovery contacts (N >= 1). Each contact holds a "recovery bundle": the signing private key encrypted to the contact's encryption public key.

**Recovery flow**:
1. User gets a new device, installs the app.
2. User enters their name and a recovery contact's name.
3. The app contacts the recovery contact's app, authenticates (out-of-band, e.g., the user calls the contact).
4. The contact's app decrypts the recovery bundle and sends the signing private key to the user's new app.
5. The user's new app can now publish.

**The social contract**: the contact is trusted. The contact could impersonate the user, but the contact is a family member or friend who has been chosen for this role. The design does not protect against a malicious contact; it protects against a malicious hub.

**M-of-N**: for higher security, the key could be split (e.g., XOR shares for 2-of-2). But this requires all shares to reconstruct, which is the same as M=N. For M < N, a secret sharing scheme is needed (e.g., Shamir), which is not in the standard library. The design accepts 1-of-N or N-of-N (all contacts needed) for simplicity.

Actually, for 2-of-2 (or generally M-of-M), we can use XOR: split the key into M shares, XOR them all to get the key. This is implementable. So M-of-M is supported. M-of-N for M < N is not supported without a library.

## Key Theft

If the device is stolen and the key is extracted, the thief can publish as the user. The user must rotate the key to invalidate the old one.

**Detection**: the user notices unauthorized posts. They rotate the key. They notify followers (signed with the new key) that the old key is compromised.

**Recovery contacts can help**: the user contacts a recovery contact, who vouches that the new key is the legitimate one. This is similar to key loss.

## Contested Departure

The hostile hub claims the Move activity is a forgery. The user has signed the Move with their key. Anyone with the public key can verify the signature. The hub's claim is not technically credible.

**The hub could**:
- Serve the old actor profile without a "movedTo" field. Readers who don't have the Move activity might not know.
- Delete the old actor profile. Readers who try to resolve it fail.
- Serve fake content signed with a key they claim is the user's. The signature won't verify against the real public key.

**The defense**: the Move activity is pushed directly to followers' inboxes by the user's app, not relying on the hub. Followers see the Move and update. The hub can delay or block readers who come to fetch content, but it cannot forge the Move or prevent its delivery to followers' inboxes (the app does the delivery).

**The hub could claim the key is compromised**: the hub could publish a "this key is compromised" notice. But the hub doesn't have the key, so it can't sign this notice with the user's key. It can only sign with its own key (if it has one), which readers won't trust as the user's.

**Out-of-band verification**: followers can verify the Move out-of-band (e.g., the user calls them, they check the signature together). This is the social layer.

---

# Section 6: Encryption Construction

## Keys

Each actor has:
- An Ed25519 signing keypair (signing, 32 bytes each).
- An X25519 encryption keypair (key agreement, 32 bytes each).

The signing key is used to sign activities. The encryption key is used to receive encrypted content.

Some implementations derive the encryption key from the signing key (e.g., using the Ed25519 private key seed to generate an X25519 key). This is possible but requires a KDF. For simplicity, the design uses two independent keypairs.

## Public Key Encoding

Public keys are 32 bytes, encoded as base64 (URL-safe, no padding) in the actor profile.

## Encryption to One Recipient

Given: recipient's encryption public key Rpub (32 bytes), plaintext P.

1. Generate ephemeral X25519 keypair (e, E) where E = e * G.
2. Compute shared secret S = e * Rpub (ECDH).
3. Derive symmetric key K = HKDF-SHA256(S, salt=E, info="message-key", length=32).
4. Generate random 32-byte content key Kcontent.
5. Encrypt content: Ccontent = ChaCha20-Poly1305(Kcontent, nonce=zeros, P, AAD=activity_id).
6. For each recipient, encrypt Kcontent: Ckey = ChaCha20-Poly1305(K, nonce=zeros, Kcontent, AAD=E).
7. Output: {ephemeral_public: E, encrypted_content: Ccontent, encrypted_keys: [{recipient: Rpub, encrypted_key: Ckey}]}.

Wait, I need to clarify. In the multi-recipient case, we have one encrypted_content and one encrypted_key per recipient.

Let me rewrite:

For an activity with content P, addressed to recipients R1, R2, ..., Rn:

1. Generate random 32-byte content key Kc.
2. Compute ciphertext: C = ChaCha20-Poly1305(Kc, nonce=0, P, AAD=activity_id).
3. For each recipient Ri with encryption public key Rpub_i:
   a. Generate ephemeral keypair (e_i, E_i).
   b. Compute S_i = e_i * Rpub_i.
   c. Compute K_i = HKDF-SHA256(S_i, salt=E_i, info="msg-key-v1", length=32).
   d. Compute Ckey_i = ChaCha20-Poly1305(K_i, nonce=0, Kc, AAD=E_i).
4. The activity includes: {encrypted_content: C, recipients: [{key_id: Rpub_i, ephemeral: E_i, encrypted_key: Ckey_i}]}.

The recipient, on receiving the activity:
1. Find their entry in the recipients list (matching their public key).
2. Compute S = r_priv * E_i (where r_priv is their encryption private key).
3. Compute K = HKDF-SHA256(S, salt=E_i, info="msg-key-v1", length=32).
4. Decrypt Kc = ChaCha20-Poly1305-decrypt(K, nonce=0, Ckey_i, AAD=E_i).
5. Decrypt P = ChaCha20-Poly1305-decrypt(Kc, nonce=0, C, AAD=activity_id).

## What the Hub Learns

The hub sees:
- The sender (from the signature).
- The audience (the list of recipient public keys or actor URLs).
- The ciphertext (the encrypted content).
- The encrypted keys (one per recipient).
- The ephemeral public keys.
- The size and timing.

The hub does NOT see:
- The plaintext content.
- The content key Kc.
- The recipients' private keys.

## Audience Privacy

The audience is visible to the hub. If we want to hide the audience from the hub, we need a different design (e.g., the hub is not involved in delivery, or a relay is used). The brief accepts that the hub sees the audience.

For network observers (not the hub), TLS hides the audience from them.

## Non-Repudiation

The activity is signed by the author. The encryption is to the recipients. The hub cannot deny receiving a message (it served it) and cannot deny the audience (it's in the metadata).

---

# Section 7: Cost Sheet

## What the Design is Bad At

**Real-time push when the app is offline.** Federation requires the app to push to followers' inboxes. If the app is offline, federation is delayed. The hub can push as a fallback, but a hostile hub won't.

**Hiding the audience from the hub.** The hub sees who sends to whom. For the hub-threat model, this is acceptable. For a stronger threat model (e.g., hiding social graph from the server), this design is insufficient.

**Spam and abuse.** There is no built-in spam protection. A hostile hub could fill a user's inbox with junk. The design relies on the user filtering or the app filtering.

**Large follower counts.** The design sends a copy of each post to each follower. For thousands of followers, this is a lot of network traffic. For millions, it's infeasible. The design targets families and small groups.

**Global discovery.** There is no global search or directory. Finding someone requires knowing their name@hub or their public key. This is a feature, not a bug (no central registry), but it's a limitation.

## What the Design Cannot Deliver

**Hiding the social graph from the hub.** The hub sees the audience of every message. This is fundamental to the hub-based delivery model.

**Anonymity.** The signing key is linked to the actor. All content is attributable. The brief lists anonymity as a non-goal.

**Real-time guarantees.** The design is pull-based and push-based with eventual consistency. There are no real-time delivery guarantees.

## Where It Is More Complex Than It Looks

**Canonical JSON.** Signing requires a canonical form. Defining and implementing it correctly is tricky. UTF-8 encoding, key sorting, number formatting, string escaping all need care.

**Key derivation and encryption.** The ECIES construction requires careful implementation: ephemeral keys, HKDF, AEAD. It's about 50-100 lines of code per recipient.

**Inbox management.** The inbox is a collection that needs to be paginated, updated, and synced. The hub needs to implement inbox semantics.

**Federation state.** The app needs to track who it has sent messages to, retry failed sends, handle duplicates, etc.

## Choices I Am Least Sure Of

**The encryption construction.** I chose X25519 + ChaCha20-Poly1305 + HKDF. This is a standard pattern (similar to HPKE), but there are subtleties. The nonce being all-zeros is a simplification; in practice, a random nonce is better, but with a key per message, collision is unlikely.

**The key recovery flow.** The social recovery with trusted contacts works, but it requires the contact to be technically present (have the app, be online). For grandma's daughter, this might be a barrier.

**Canonical JSON.** I defined a simple canonical form, but there are edge cases. JCS (RFC 8785) is more robust but requires more spec.

**No global registry.** This is a hard constraint. Without a registry, discovering people after a domain change is hard. The design relies on out-of-band notification and direct push.

---

# Section 8: What I Would Cut

If forced to halve the specification:

**Cut: Key rotation and the "movedTo" field.** These are useful but add complexity. Without them, key loss is unrecoverable and moves are harder. But for the minimum viable product, they can be added later.

**Cut: Reactions (Likes, etc.).** These are just special activities. A reader can display any activity type. The spec only needs "Post", "Reply", "Follow", and "Move".

**Cut: The inbox collection as a separate endpoint.** Inbox can be a simple list. No need for pagination, ordering guarantees, etc. in the first version.

**Cut: Image uploads.** Images can be hosted elsewhere (a photo service, a personal server). The activity references the image URL. No need to define image upload in the protocol.

**Cut: The followers/following collections as managed lists.** The app can compute these from the inbox/outbox. Or just track them locally.

**Cut: The encryption for multiple recipients in one step.** Define encryption to one recipient; the app loops for multiple. This simplifies the spec.

Actually, the encryption to multiple recipients is important for efficiency. Cutting it would mean the app loops, generating a separate ciphertext per recipient. This is fine for small groups.

**Cut: The separate encryption keypair.** Derive the encryption key from the signing key. Or use a different scheme. This simplifies key management.

But deriving X25519 from Ed25519 is possible (using the same seed), but requires a KDF. Let me leave the two keypairs in.

**What I would keep**: the identity model (signing keypair), signed activities, canonical JSON, WebFinger discovery, public outbox (JSON Feed), encrypted private content, the Move activity.

---

OK I think this is a solid design. Let me review and refine.

A few things to add or clarify:

1. The actor profile should include both the signing key and the encryption key. The signing key is for verification. The encryption key is for receiving encrypted content.

2. The canonical JSON needs more detail. Let me add an example.

3. The JSON Feed mapping needs to be clear.

4. The hub endpoints need a clear list.

5. The signature scheme needs more detail. What exactly is signed? The canonical JSON of the activity excluding the signature field, hashed with SHA-256, signed with Ed25519.

6. I should discuss the choice of Ed25519 vs other signature schemes. Ed25519 is widely available, fast, small signatures (64 bytes), small keys (32 bytes).

7. The encryption: I should mention that ChaCha20-Poly1305 is a standard AEAD. The nonce can be zero because the key is unique per message. This is a known pattern.

8. The key recovery: I should be clearer about the flow. The daughter's app decrypts the recovery bundle and sends the plaintext key. The channel must be authenticated (TLS + the daughter's signature on a session token).

9. The contested departure: the hub can still serve old content. The defense is that readers can check the actor profile for a "movedTo" field, and they have the Move activity in their inbox.

10. I should mention that the design is inspired by ActivityPub but with cryptographic verification of the actor's identity and end-to-end encryption of private content.

Let me also think about whether the canonical JSON is actually a good idea, or if there's a simpler approach.

Alternative: instead of canonical JSON, define the signature input as a specific byte string constructed from the activity's fields. For example:

```
signature_input = activity_id || "\n" || actor || "\n" || type || "\n" || published || "\n" || content_hash
```

Where content_hash is SHA-256 of the content. This is simpler but less flexible (every field to be signed must be in this list).

Or: use a "signature suite" similar to JOSE, where the signature is over a specific serialization.

For simplicity, let's stick with canonical JSON. It's well-understood and flexible.

But to make it even simpler, I could define a "minimal canonical JSON" with just the rules needed:
- UTF-8
- Keys sorted
- No whitespace
- Standard JSON

This is ~50 lines of code.

OK let me also think about the URL scheme. Should activities be content-addressed (by hash) or by random IDs?

Content-addressed: the activity ID is the hash of the content. This is deterministic but requires the content to be known first. For mutable things (edits), this is a problem.

Random IDs: the activity ID is a random string. This is simpler and allows edits (different ID).

For social media, edits are rare. Let's use random IDs.

The activity ID is a URL: `https://hub.example/actor/alice/activities/{random-id}`.

The random ID is 16 bytes, base64-encoded.

---

Let me also think about how a feed reader discovers the feed.

The user knows `alice@hub.example`. The reader does:
1. WebFinger: `https://hub.example/.well-known/webfinger?resource=acct:alice@hub.example`
2. Response includes the actor URL: `https://hub.example/actor/alice`
3. Fetch the actor profile.
4. Get the outbox URL: `https://hub.example/actor/alice/outbox`
5. Fetch the outbox (JSON Feed).
6. Display items.

For polling, the reader fetches the outbox periodically. The outbox is paginated (e.g., 20 items per page, with a "next" link).

For private content, the reader does not see it in the JSON Feed (only public items). The user's app, when logged in as the user, fetches the inbox and decrypts private content.

---

Let me think about one more issue: the hub needs to authenticate POSTs to the inbox. Otherwise, anyone can send activities to anyone's inbox.

For public activities (Follow, Reply to a public post), the inbox POST is signed by the sender. The hub verifies the signature.

For private activities sent to the inbox, the content is encrypted to the recipient. The hub cannot read it, so the hub doesn't need to authenticate based on content. The hub can rate-limit or filter based on the sender's public key.

**Hub authentication**: the hub can require HTTP signatures (sign the request with the sender's key) or use a simple API key for known senders. The design uses HTTP signatures: the POST to the inbox includes a signature header.

This is similar to ActivityPub's HTTP signatures.

---

OK, I think I have enough. Let me write the final design.

Actually, let me think about the length. The user said "as long as it needs to be" and "we would rather read 4,000 words of argued design than 800 words of outline." So I should be thorough.

I'll write a comprehensive design document. Let me structure it well.

One more thought: the brief says "A person is an Ed25519 keypair" in the identity section, but I should argue this. Let me make sure I have good arguments against the alternatives.

Alternatives to a raw keypair:
- Email address: not self-certifying, provider can revoke
- Phone number: not self-certifying, can be transferred
- Domain name: not self-certifying, can expire
- UUID: not human-friendly, no provenance
- DID: depends on a resolver (infrastructure)
- Blockchain address: depends on a ledger (infrastructure, expensive)
- PGP key: possible, but PGP has baggage and is not standard library
- SSH key: possible, but unusual for this use case

The Ed25519 keypair is:
- Self-certifying (the key proves identity)
- Portable (can be generated anywhere, stored anywhere)
- Standard library available in most languages
- Small (32 bytes public, 32 bytes private, 64 bytes signature)
- Fast to verify
- Well-understood cryptography

The trade-off: not human-friendly. But the name (alice@hub.example) provides the human-friendly layer, while the key provides the security.

---

Let me finalize the design.

I want to make sure I address all the points in the brief:

1. ✅ Architecture in one page
2. ✅ Identity primitive, with arguments
3. ✅ Four floor assurances, mechanism by mechanism
4. ✅ Scenario walk-throughs (1, 2, 3, 4)
5. ✅ Key change and recovery
6. ✅ Encryption construction
7. ✅ Honest cost sheet
8. ✅ What to cut

Let me write it.

One more thing: the brief mentions "A person publishes writing, photos, and short posts". Photos are mentioned. How do photos work?

The design: a post can include image references. The image is hosted somewhere (a CDN, the hub, a personal server). The post includes the URL. The protocol doesn't define image upload; it just references URLs.

For a "dumb hub" that doesn't store images, the user uses an external image host. The post references the image URL.

For a hub that stores images, the hub provides an upload endpoint. But this is not in the core spec; it's a hub feature.

---

Let me also address: how does the user find their followers list?

The followers list is a collection at `https://hub.example/actor/alice/followers`. The hub serves it. The format is a list of actor URLs.

For privacy, the followers list might be access-controlled. But for the user's own use, the user can fetch their own followers list.

If the hub is hostile and won't serve the followers list, the user has a local copy (their app tracks it).

---

OK, writing the final version now.

I'll aim for about 4-5k words. Let me be thorough but not repetitive.

One last thing: the signature scheme. Let me be precise.

**Signature scheme**:
- Algorithm: Ed25519.
- Input: the canonical JSON serialization of the activity, with the "signature" field removed.
- Hash: SHA-256 of the canonical JSON bytes.
- Signature: Ed25519(private_key, hash).

The signature is included in the activity:
```json
{
  ...,
  "signature": {
    "keyId": "https://hub.example/actor/alice#key",
    "value": "base64url-encoded-signature"
  }
}
```

The "keyId" is a URL that resolves to the public key. The reader fetches the actor profile, gets the public key, and verifies the signature.

**Canonical JSON**:
- Encoding: UTF-8.
- Object keys: sorted lexicographically by their byte representation.
- No whitespace outside of strings.
- Numbers: integers as integers, no leading zeros, no decimal point for integers. Floats with decimal point, no leading zeros, exponent with lowercase 'e'.
- Strings: JSON-escaped.
- Booleans: true, false.
- Null: null.

Example:
```json
{"a":1,"b":[1,2,3],"c":"hello"}
```

This is deterministic given the input.

---

OK let me write the document now. I'll be comprehensive.

Let me think about the structure one more time:

# Title: Something like "Persona: A Protocol for Decentralized Personal Publishing" or just describe it.

# Section 1: Architecture (the one-page overview)
# Section 2: Identity
# Section 3: The Four Assurances
# Section 4: Scenarios
# Section 5: Key Change and Recovery
# Section 6: Encryption
# Section 7: Cost Sheet
# Section 8: What to Cut

Let me write.

Wait, the brief says "The architecture in one page." So section 1 should be a one-page summary, with the rest of the document being the detailed argumentation.

Let me make section 1 concise (fits on one page) and the rest detailed.

Section 1 should cover:
- What artifacts exist
- What each is for
- What is signed
- What a reader fetches on first contact and on a poll

OK, writing now.

Actually, I realize I should also discuss the choice of HTTP and JSON. The brief says "HTTP, JSON, and base64 are illustrations of what that means in practice, not a closed list". So I can assume HTTP, JSON, base64. I'll use these.

For the hub, it's an HTTPS server. For activities, they're JSON. For signatures and keys, base64-encoded bytes.

---

Let me also think about the relationship between this design and existing protocols.

This is similar to:
- ActivityPub: but with cryptographic verification of actors and end-to-end encryption.
- Bluesky / AT Protocol: but without the DHT/registry infrastructure.
- Nostr: similar (keypair-based identity, signed events), but with hub-based storage and HTTP delivery instead of relays.
- Matrix: but with a different identity model and no central server.

This is most similar to Nostr in the identity model, but different in the storage and delivery model (hubs instead of relays). The hub provides stable URLs and storage; the app handles federation.

Compared to ActivityPub: ActivityPub has the same actor/activity/outbox/inbox model, but the actor is identified by URL, not by key. The signatures in ActivityPub are on HTTP requests, not on the activities themselves. This design puts signatures on the activities, making them self-contained and verifiable regardless of the hub.

Compared to Nostr: Nostr uses a relay model. Events are stored on relays. The user publishes to multiple relays. This design uses a hub model: one hub per user (or shared hub), with the app handling federation to other hubs.

---

OK, writing the final design. I'll include a comparison to existing protocols where relevant, but the focus is on the design itself.

Let me start writing. I'll be thorough.

```

</details>

