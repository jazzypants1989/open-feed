---
model: deepseek-v4-pro
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:26:19.752Z
prompt: PROMPT-pass1.md
prompt_sha256: eab389889e055bcb32bc4532edc2183f780d8a267227464b47a9a9e220cae542
finish_reason: null
tokens: null
wall_seconds: 843
truncated: false
reasoning_chars: 173256
---
# A minimal hostile-hub-tolerant publishing protocol

I’ll call the protocol **smallpub/v1** below. It is deliberately small enough to describe in one document, but I’ve included exact shapes where they matter.

---

## 1. Architecture in one page

There are five artifact types:

1. **Root key document (`keydoc`)** — signed by the identity root key. It delegates day-to-day signing and encryption to an active signing key and an active encryption key.
2. **Profile** — signed by the active signing key. It carries the human name, the current hub list, and feed URLs.
3. **Public content objects** — posts, replies, and reactions, signed by the active signing key.
4. **Private content objects** — the same content, but encrypted first, then signed again on the outside.
5. **Recovery record** — signed by the root key. It contains the root seed encrypted to one or more recovery agents.

Everything stored on a hub is a **SignedObject**:

```json
{
  "payload": "<base64url of UTF-8 JSON bytes>",
  "signature": "<base64url of 64-byte Ed25519 signature over payload bytes>",
  "signer": "ed25519:<base64url public key>"
}
```

The signature is over the exact bytes inside `payload`, never over the JSON wrapper. That is how the protocol avoids a JSON canonicalizer: the signed bytes are already a byte string in the `payload` field. A hub may reorder outer JSON fields, but it cannot change `payload` without invalidating the signature.

URL shape on a hub for an identity with root public key `R`:

```
GET  /p/<R_b64url>/key.json
GET  /p/<R_b64url>/profile.json
GET  /p/<R_b64url>/feed.json              (JSON Feed; public)
GET  /p/<R_b64url>/encrypted-feed.json    (private item list)
GET  /p/<R_b64url>/items/<content-id>.json
PUT  /p/<R_b64url>/items/<content-id>.json
```

`R` is the Ed25519 root public key, base64url-encoded without padding.

**First contact:** a reader fetches `key.json`, verifies it with the root key, learns the active signing and encryption keys, then fetches `profile.json`, verifies it with the active signing key.

**Poll:** a reader polls `feed.json` for public items. For private items, it polls `encrypted-feed.json`, fetches each item, and tries every key slot to see whether one decrypts for it.

A hub does not need accounts, ACLs, or an inbox service. It needs to store crypto blobs under IDs and serve three or four feeds.

---

## 2. Identity primitive

A person, to this protocol, is an **Ed25519 root public key**.

The root key signs a key document that delegates to an **active signing key** and an **active encryption key**. Day-to-day posts and profile updates are signed by the active signing key. Encryption to that person uses the active encryption key.

So the stable identity is:

```text
ed25519:<base64url(root_public_key)>
```

The human name is a signed claim in the profile, not the identity.

### Why root + active rather than one key?

A single key would be simpler. It would also work for signing and encryption. But splitting root from active gives two important properties:

- **Theft of a phone does not steal the root identity.** The root private key can be deleted from the phone after onboarding and only kept encrypted with recovery agents.
- **A stolen or lost active key can be revoked by the root key.**

The host never possesses either private key.

### Alternatives rejected

- **Email/domain identities (`alice@example.com`)**: The domain owner controls resolution, can seize the name, and the identity changes when the domain changes. This fails the divorce and domain-loss scenarios.
- **HTTPS URL identities**: Same problem. The URL is a locator, not a person.
- **Human names**: No uniqueness, no cryptographic binding.
- **A global registry, blockchain, or DHT**: Explicitly forbidden by the priorities and unnecessary for small groups.
- **A bare Ed25519 key without root/active split**: Simpler, but makes phone theft much worse and makes recovery/revocation harder to reason about.

The root key is deliberately the identity. Total loss of the root key is identity loss. That is one of the explicit non-goals for continuity.

---

## 3. Delivering the four floor assurances

### 3.1 The host cannot speak for you

Mechanism:

- The host never has `root_private_seed`, `active_sign_private`, or `active_enc_private`.
- All content is signed by the active signing key.
- The active signing key is bound to the root key by the root-signed `keydoc`.
- Readers verify the chain:

```text
root key
  -> verifies keydoc
    -> yields active signing key
      -> verifies profile and every content object
```

Failure mode: if the root key itself is stolen, the thief can sign a new keydoc and take over the identity cryptographically. This is why the root private key should be kept off the device after onboarding and only stored encrypted with recovery agents.

### 3.2 The host cannot read what was not meant for it

Mechanism:

- Private content is encrypted end-to-end to the active encryption keys of the chosen recipients.
- The host sees only the outer private envelope: author, timestamp, nonce, ciphertext, and a fixed number of unlabeled key slots.
- The host has no recipient private encryption keys, so it cannot open a slot.

Failure mode: if the hostile operator is itself in the audience, it can read the content. The brief already concedes this: no confidentiality mechanism defeats someone inside the audience. Also, if the sender encrypts to a stale but still valid active encryption key whose private key has been lost, delivery fails, but confidentiality is not broken.

### 3.3 The host cannot keep you

Mechanism:

- The root identity is independent of any hub.
- The active signing/encryption private keys are on the user’s device.
- The app keeps a local copy of every signed object the user has written.
- The user can leave by signing a new profile with a higher sequence number, pointing to a new hub, and uploading the same signed objects there.

Failure mode: if the user loses the device and has no recovery agent, the identity is lost. But under normal operation, the host’s cooperation is not required to leave. A hostile host can still serve stale content to readers who never see the new profile; that is a discovery/availability limitation, not a floor failure.

### 3.4 People on other hubs are first-class

Mechanism:

- A hub is just a dumb store. There are no inter-hub access-control agreements.
- A private item is encrypted to recipient keys, not to a hub’s notion of an inbox.
- A reply is just a post with a `replyTo` field. A reaction is a small signed/encrypted object with a `target` field.
- If A on `a.example` wants to read B’s private reply on `family.example`, A’s reader polls B’s `encrypted-feed.json` and tries the slots. If A is a recipient, it decrypts.

Failure mode: discovery is the weak point. There is no global directory, so A must know where B currently publishes. Profiles and hub lists mitigate this, but a reader who only knows a dead or hostile hub may need an out-of-band hint.

---

## 4. Scenario walk-throughs

### 4.1 The divorce

The woman’s root key and active keys were created on her phone. The ex-partner operates the hub and has root access to storage.

- He cannot post as her because he does not have her active signing key.
- He cannot read her family-only posts because they are encrypted to chosen recipient keys, not to the hub.
- He cannot alter or backdate what she wrote because every public post is signed and every private post has an inner signed object.
- She leaves by installing/moving to a new hub, signing a new profile with `seq` one higher than the old one, and uploading her local copy of her content.
- Her mother’s reader has a one-tap way to fetch the new profile. Once it has the higher `seq`, the old hub’s frozen copy of the profile reads as stale.
- The hostile hub can still serve old signed posts. They verify, but they are visibly old because their signed `seq` and `created` are lower.

### 4.2 Grandma onboards

During onboarding, the app:

1. Generates an Ed25519 root key.
2. Generates an active signing key and an active X25519 encryption key.
3. Creates a root-signed `keydoc`.
4. Creates a recovery record containing the root seed encrypted to her daughter’s active encryption key.
5. Uploads the keydoc, profile, and recovery record.
6. Deletes the root private key from the phone, keeping only the active signing and encryption keys.

Grandma never sees a key. She picks a name and taps “done.”

A year later she loses the phone. She calls her daughter. The daughter’s app has the recovery record, decrypts the root seed with her own encryption private key, and provisions a new phone. The daughter’s app generates a new active keypair, signs a new `keydoc` with higher `keySeq`, and publishes it. The old lost active key is revoked.

The hostile hub cannot decrypt the recovery record because it is encrypted to the daughter.

### 4.3 Two hubs, one thread

A on `a.example`, B on `family.example`.

1. A writes a family-only post. The plaintext includes:

```json
{
  "type": "post",
  "visibility": "private",
  "to": ["ed25519:<A_root>", "ed25519:<B_root>"]
}
```

2. A’s app encrypts it to A’s and B’s active encryption keys and publishes the opaque outer envelope to `a.example`.
3. B’s reader polls A’s `encrypted-feed.json`, fetches the new private envelope, tries its encryption private key against each slot, decrypts, and verifies the inner signature

<details><summary>Model reasoning trace (173256 chars) — kept because rejected alternatives often live here</summary>

```
We need respond to design brief. Need produce protocol design. Need think deeply. We must not assume existing. Need design from principles. Need address all 8 sections. Need likely propose decentralized personal publishing with hostile hub. Need meet floor assurances. Need minimal, no dependencies. We need design.

We need design protocol. Let's restate goals.

We need decentralized personal publishing/interaction. Person publishes writing/photos/short posts; others read/reply/react. No central service. Hubs serve content over HTTPS. Hub may host one or many, may be hostile. Adversaries: hub operator insider, technically capable, has credentials, controls storage/serving/inbound/exit. Need floor assurances:
1 host cannot speak for you: only your signed content verifies; key never host's.
2 host cannot read private content addressed to chosen people: unreadable by anyone else incl host.
3 host cannot keep you: leave with identity and everything wrote without permission; key and copy always device.
4 people on other hubs first-class: cross-hub family-only content share/reply/react without access-control agreement between hubs.

Priorities:
1 no deps: stdlib Ed25519, SHA-256, HTTP, JSON, base64. no canonicalizer, JOSE, git, blockchain, DHT, global registry.
2 easy implement weekend.
3 interop RSS/Atom/JSON Feed, fediverse/Bluesky with nothing extra. replies coming back extension.
4 minimal.

Non-goals: human-readable wire, continuity across total key loss, millions items/identity, consensus/tokens/shared ledger, anonymity/traffic resistance beyond hiding who encrypted message for.

Scenarios: divorce, grandma onboard, two hubs thread, domain goes, big lazy hub, weekend, stranger.

Need provide architecture one page, identity primitive, four assurances, scenarios, key change/recovery incl contested departure, encryption construction, honest cost sheet, what cut.

Need design. Let's think from first principles.

Core challenge: Hostile hub storing user content. Need signing and encryption with keys user controls. Identity key on user device. Host cannot sign. For private content, end-to-end encryption to recipients.

No global registry. Identity must be self-sovereign and portable across domains. Need identifiers not tied to domain? Scenario domain goes, identity unchanged. So identity cannot be domain-based? Could be public key based. But Grandma onboarding no shown key. Need human name maybe. Identity primitive maybe an Ed25519 public key fingerprint as canonical ID, with human name as mutable profile. Need discover after move? Existing readers find them: maybe via signed pointer/redirect from old domain? But hostile hub can't forge. Or reader follows by key and uses domain as locator; when domain changes, need update locator. Maybe use signed "profile document" stored at hub that includes current hub URL? But if domain gone, how find? Could use DNS? No global registry. If domain unaffordable, can't serve old domain. Existing readers need find them. Could have readers store last known hubs, maybe use WebFinger? But domain gone means old domain no. Maybe if identity is key, can search? No. Need think. Scenario 4: family.example becomes unaffordable. Everyone moves. Nobody's identity changes. Existing readers find them. If existing readers have a follow relationship, maybe they have a "contact" record signed by identity that lists hubs? But if only old domain gone and no central registry, reader may not find new domain unless they have some out-of-band. But scenario says existing readers find them. Need protocol mechanism. Could use signed "profile" at old domain? But old domain gone. Could use reader's stored copy of profile includes multiple hub URLs? If they only knew family.example, no. Maybe identity includes a stable key; reader polls a list of known hub URLs from prior profile? If the domain goes, old hub unavailable. Need some discovery. Maybe use DNS TXT at domain? gone. Maybe use distributed hash? non-goal no DHT. Maybe existing readers find them because domain is not identity; they can follow via a URL that contains key, and if the domain dies they re-follow? "Existing readers find them" maybe after they move, their app can update followers via some mechanism? But no central. Hm.

Maybe use petnames / introductions: Reader's subscription not to domain only but to identity key; the hub URL is a locator. Reader can query "hub hints" embedded in signed content? If content on old domain is gone, but reader has cached posts containing signed "current hub" field. If user moves and publishes a signed "move" notice before domain goes? But scenario domain goes unaffordable maybe sudden. Need readers find them. Could leverage existing feed readers/RSS? They follow URL. If domain goes, RSS URL goes. They need a stable URL. Could use a third-party? Hmm.

Maybe identity is a URL like https://domain/path? Then domain changes identity? But scenario says identity unchanged. So identity must be key or hash. Existing readers find them after domain changes: maybe through a signed "alias" or "pointer" at the old domain cannot be served. Unless the old domain is taken over by someone else? "family.example becomes unaffordable" meaning domain lost, maybe old URL no longer serves. They could move to new domain and update via a friend's hub? Maybe there is a mechanism where peers gossip signed locator updates. But initial audience families small, no global registry. Could use "trusted contacts" as recovery/locating: if reader is a family member, they may know new location out of band? But scenario says existing readers find them. Maybe they follow by key and the reader app tries the old URL; old URL gone; then it asks a designated "well-known" or "hint" service? Not allowed global directory? Could use the domain's DNS? gone.

Let's not assume. Maybe include a "locator document" signed by identity and hosted on one or more hubs. Existing readers know a set of hub URLs from previous profile. If one hub goes, they can use another. But if only one hub and it goes, no.

Could use content-addressed or key-based lookup on a DHT? Explicit non-goal says no DHT. So cannot.

Maybe scenario 4 only requires existing readers find them when domain goes, but maybe there is some actor: everyone moves. Perhaps followers are on hubs that have a relationship and when they move, the identity's own hub updates? But old domain gone. Hmm.

Maybe "existing readers find them" meaning they can be found by querying their old domain? If domain unaffordable, they could let it expire, but maybe they can set a redirect at DNS? If domain gone, no. Perhaps "domain goes" means the hub software/domain of family.example is shut down, not DNS? They might still control domain? "becomes unaffordable" implies lose domain. Need design maybe use domain-independent identity and DNS not needed. For finding, use the identity's public key to query a peer? But no DHT.

Let's park, revisit.

Core architecture possibilities:
- Artifacts: Identity (signing key pair), Profile document, Posts/Items (content objects), Envelopes, Messages, Reactions, Follows, etc.
- A hub stores JSON documents at URLs. Reader fetches HTTPS URLs.
- Signing: Ed25519 over bytes. Need avoid canonicalization. We can define exact byte encoding for signatures. Use "signature over SHA-256 of content bytes". For JSON, sign raw bytes? But JSON can be re-encoded. Need deterministic for verification. Since no canonicalizer, sign exact bytes as served? But if hub reserializes, signature breaks. We can define that signed objects are byte strings, not JSON objects? Or use JSON with a "sig" over a stable serialization. Without canonicalizer, can use base64 of raw content? Need human not read wire. Maybe content format is binary? But priority no deps; JSON. We can define signed payload as a string containing JSON, and signature over UTF-8 bytes of that string. Documents stored as JSON with base64-encoded signed bytes? Let's design.

Simplest: Use "signed object" format: a JSON object containing:
{
  "payload": "<base64url of UTF-8 JSON bytes of the inner object>",
  "signature": "<base64url Ed25519 signature over the bytes>",
  "key": "<base64url public key>"
}
Reader verifies signature over base64-decoded payload bytes. This avoids canonicalization because signature is over exact bytes. The payload itself is JSON but treated as bytes. Hub serves this envelope; cannot change payload without invalid signature. This is easy. But payload is base64 in JSON, not human-readable wire, okay. Need maybe sign full bytes of an "envelope" with payload. For content, the payload JSON includes author, created, etc.

Alternatively sign raw HTTP body: Content-Type application/x-... and signature in header? But hubs may store and re-serve; easier to have self-contained object.

Use SHA-256 hash for content addressing. We can compute CID-like hash of payload bytes. Content IDs maybe "sha256:base32". Could use for integrity and linking.

Identity primitive: Ed25519 public key. Canonical ID could be "did:key:z..."? No deps, but can use base64url of public key. Since no dependency, define key ID as `ed25519:<base64url(pubkey)>`? The person is identified by the signing public key, permanent across domains. Human-readable name is a claim in signed profile, not identity. Need argue against alternatives:
- Domain-based identities rejected because host can take domain, identity must survive hostile host and domain loss. Host could control domain; floor 3.
- Human names rejected (non-unique, no cryptographic root).
- Central registry/DID methods rejected due no global dependency.
- Keypair is only thing user controls; host never has private key. Identity = public key fingerprint. The private key is identity root. It can sign profile documents asserting display name, current hub locators, recovery keys.

Need key management: Host never has private key. User device holds it. Grandma onboarding: she picks name, app creates key on phone, stores in phone secure storage; no shown key. Recovery by calling daughter: need social recovery mechanism. Need design. Maybe recovery key is split or stored encrypted by trusted contacts? Need no central. We need key recovery after lost phone. Need hostile host? The daughter helps. Could have a "recovery kit" encrypted to a secret shared with daughter? But grandma is never shown key or told to store file outside house. She loses phone. She is back by calling daughter. Need design.

Approach: On onboarding, app generates identity key and a "recovery key" or "backup secret". It can use a passphrase? She is never shown key. Could encrypt the identity private key to a "recovery secret" derived from answers to security questions? Not enough. Could store an encrypted copy of the private key on her hub, encrypted to a "recovery key" held by trusted contacts (daughter). But hub is hostile maybe, cannot read if encrypted. Daughter's device has recovery key. If grandma loses phone, she calls daughter; daughter uses her app to retrieve the encrypted backup from hub and decrypt with her recovery key, then provisions new phone. Need ensure hostile hub cannot store bad backup? The identity key itself can sign a "recovery policy" designating recovery agents and encrypting backup to them. Host can serve stale/old backup but not forge. We need design.

Let's outline:
- Identity keypair (Ed25519) is root. Private key on device.
- User may create a "recovery record": signed by identity key, containing:
  - Encrypted private key (or seed) to one or more recovery agents' public keys.
  - Maybe threshold? For simplicity one or more.
- Host stores recovery record. It cannot decrypt because encrypted to agents. It cannot modify because signed.
- On recovery, the user (with daughter) fetches the recovery record from hub (or daughter's device may have cached it). Daughter's private key decrypts her copy of the identity private key. She can then set up new device.
- But if only one agent, daughter can steal identity. That's acceptable? Scenario says calling daughter. Need maybe user chooses trusted contacts. Host cannot use record because not recipient.
- Need also allow recovery if hub is hostile and denies access? Floor 3: host cannot keep you. If hub refuses to serve recovery record? But user always has key on device; lost phone. If host refuses, daughter may have cached encrypted backup? We can have recovery record also stored on trusted contacts' devices/hubs? The daughter's app can store a copy automatically when she becomes recovery agent. Then recovery doesn't require hostile hub. Good.
- Grandma never shown key. App creates identity and recovery. During onboarding, app asks "choose a recovery contact" (daughter) and sends encrypted backup to daughter out-of-band? If daughter not present? Could be via hub: encrypted to daughter's public key, daughter's app polls? But if daughter on same hub? Need discover daughter's public key by name? Not central. Maybe invite via link/QR.

Key change and rotation, loss, theft, contested departure. Need design robust.

Need also support multiple devices? Maybe not central but key on device.

Content types:
- Public posts: signed, stored on hub.
- Private posts: encrypted to recipients, unreadable by hub.
Need encryption construction. Must be implementable with stdlib: Ed25519 for signing, SHA-256. But encryption? Priority says stdlib: Ed25519, SHA-256, HTTP, JSON, base64. Ed25519 is signature only, no encryption. Need encryption for confidentiality. We need specify using what? Could use X25519? But design brief says Ed25519 only? It says implementable from standard library: Ed25519, SHA-256. But standard libraries often have Ed25519 but not X25519? Some have Ed25519 and maybe X25519. However we need encryption. We can derive a symmetric key using Diffie-Hellman. Ed25519 keys can be converted to X25519? Or use Ed25519 public keys for ECDH? Ed25519 is EdDSA, not directly encryption. Could use ephemeral X25519 or use Ed25519 keys converted to Curve25519 (Montgomery) for DH. The brief lists Ed25519 but not X25519; maybe assumes standard library has Ed25519, SHA-256. It doesn't mention AES. Need encryption construction using standard library? Maybe use ChaCha20/Poly1305? Not always stdlib. But brief says no deps, not necessarily only those primitives; "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." This list is examples of stdlib (?) Ed25519 is not always stdlib. Maybe they mean standard library plus those primitives. We can specify X25519 and ChaCha20-Poly1305? That might violate easy implement? Need consider.

Maybe use a "sealed box" construction using libsodium? No dependency. Need deliberate.

Could use RSA? Not stdlib. Need build encryption from Ed25519? Is there a way to encrypt to Ed25519 keys using only Ed25519 and SHA-256? Not straightforward. We need public-key encryption. Ed25519 keys can be used for Diffie-Hellman if we define key conversion to X25519 (birationally equivalent). That requires X25519 scalar multiplication. Maybe standard library has Ed25519 operations but not X25519. But if implement Ed25519 from stdlib? Wait Ed25519 in std library? Python has hashlib, maybe not Ed25519. But priority says no dependencies beyond stdlib: Ed25519 as a permitted primitive. We can require X25519 as part of same Curve25519 implementation; but "Ed25519" only maybe oversight. We can specify using X25519 for ECDH and ChaCha20-Poly1305 for AEAD. Need justify. But final should align with brief: maybe define encryption using ECIES with X25519 and HKDF, ChaCha20-Poly1305. If libs not in stdlib? Could implement in weekend? ChaCha20-Poly1305 from standard library? Some languages no. Alternatively use AES-GCM? Not stdlib. We need be minimal. Could use "crypto_box" from NaCl, but that's a library. The brief explicitly says no JOSE library, not no crypto library. It says implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64. Maybe Ed25519 is considered a small algorithm implementable. We can use X25519 + ChaCha20-Poly1305 as the encryption construction, implementing from same Curve25519 math. That's acceptable? Need maybe mention.

But maybe we can design encryption using only Ed25519 signature keys and SHA-256? Let's think. Public-key encryption can be done with Diffie-Hellman using X25519, which uses same underlying field as Ed25519. We can specify conversion: Ed25519 public key to Curve25519 Montgomery u-coordinate. Private key to X25519 scalar. Then compute shared secret with recipient's public key and sender's ephemeral private key. Use SHA-256 HKDF to derive AEAD key. For AEAD, could use a simple stream cipher from SHA-256? We could define a custom encryption scheme using HMAC-SHA-256 and XOR keystream. Is that secure? We can use HKDF to derive encryption key and MAC key; encrypt with AES? Not stdlib. Could use ChaCha20. If not, implement Salsa20? But no. Need specify something concrete and secure. Could use "XChaCha20-Poly1305" as AEAD; it's standard, simple, but not in many stdlibs. However weekend implementer can implement? Maybe.

Let's identify suitable primitives:
- Ed25519 signatures (allowed).
- X25519 ECDH (same curve, simple).
- ChaCha20-Poly1305 for AEAD (no patent, simple). Or AES-GCM if hardware but less simple.
Could use libsodium? But no deps. Maybe say implementations MAY use any library exposing these, but the specification defines them.

Need design encryption construction:
For private message/post to recipients:
- Recipients are Ed25519 public keys.
- Recipients' encryption keys: Convert Ed25519 pub to X25519 pub. The same identity keypair can be used for both signing and encryption. Need caution: using same key for signing and X25519 is generally acceptable if using appropriate domain separation (Ed25519 sign and X25519 DH). We can derive encryption subkey from identity key? Maybe better: Identity key is Ed25519 signing key. We derive an X25519 encryption keypair from the same seed using HKDF with label "encryption". Then public encryption key is included in profile. But identity primitive is Ed25519 public key; profile contains encryption public key signed. For private content, senders need recipient's encryption key. They can fetch recipient's profile. But if recipient's hub is hostile, profile's encryption key is signed by identity; if host tampered, signature invalid. So receiving encrypted to correct key. Good. Need maybe if profile unavailable? Use Ed25519-to-X25519 directly from identity key to avoid fetching extra. But deriving separate encryption key from seed allows rotation? Simpler: Use Ed25519 pubkey converted to X25519 as encryption key. But note Ed25519 keys can be converted. Let's decide.

Could use identity key for both signing and encryption. This means public identity key (Ed25519) is converted to X25519 for DH. Recipient encryption key is deterministic from identity. That avoids profile fetch for encryption? You still need know recipient's identity key. You may know from follow. But for profile maybe.

Need address recipients without publishing audience. We need not reveal who private content is for to hub. If the hub stores encrypted object, it sees sender maybe? We can hide recipient. Need construction: "recipients addressed without publishing the audience." Options:
- Encrypt to each recipient's public key separately. If naive, the object contains per-recipient encrypted keys labeled with recipient key IDs, revealing audience. Need avoid publishing audience. Use "key encapsulation with anonymous pairing": a recipient can try to decrypt all key slots; each slot has no label. The hub sees number of recipients but not identities. To hide even number? Could pad. Need design.

For small family, we can use an encrypted envelope with a list of `encrypted_key` slots. Each slot is encrypted to a recipient's key plus some randomness. Recipients try each slot with their private key; if success, decrypt. Slots have no recipient identifier. This hides identities from hub, but leaks number. We can pad to fixed number (e.g., slots count always next multiple of 8 or 16) to hide audience size. Need include recipient public key? No slot label. To prevent a recipient from knowing other recipients? Family audience maybe not need hide from each other? The brief says beyond hiding who an encrypted message is for (from hub). We can accept recipients know each other? But if they decrypt, they may see audience list inside, not important.

How to make a slot unlabeled but recipient can try? AEAD with additional data maybe. For each recipient:
- Generate ephemeral X25519 keypair.
- Compute shared secret with recipient's X25519 pubkey.
- Derive a key-wrapping key using HKDF(shared_secret, ephemeral_pub, recipient_pub, context "slot").
- Encrypt the content encryption key (CEK) and maybe content metadata under that key using AEAD.
- Slot contains `ephemeral_pub` and `ciphertext`. No recipient ID. Recipient computes shared secret from ephemeral_pub and its private key, derives key, tries AEAD decrypt. Because ephemeral_pub is random, no recipient identifier. If the ephemeral key is reused per slot? each slot separate.
- To avoid trial failure ambiguity, AEAD authentication ensures correct recipient. Need also include a slot tag? We can include a random "slot_id" inside encrypted payload to verify. AEAD auth already.
- But if recipient has multiple keys (rotation), can try each.
- Hub learns number of slots. We can pad slots to fixed sizes. For very small groups maybe set a constant `SLOT_PAD = 16` or 32. Since scale many identities but not millions. Encrypted messages may contain padded slots. Minimal maybe fixed 16.

Content encryption:
- Generate random 256-bit CEK.
- Encrypt content bytes with AEAD (ChaCha20-Poly1305) under CEK, with AAD maybe a content hash? Use nonce random.
- Encrypted envelope includes `nonce`, `ciphertext`, `slots`.
- The CEK is encrypted to each recipient in slots.
- Sign the encrypted envelope? Should the author sign? For private content, we need authenticity. If content is signed by author's identity key, then signature over plaintext or ciphertext? If over plaintext, the signature is encrypted too? Need design. Assurance: host cannot speak for you even for private content. If recipient decrypts, they need verify it came from author. We need author signature over plaintext payload. But if signature over plaintext is inside encrypted content, hub cannot verify but recipients can. That's fine. The outer envelope may have an author ID? That reveals who sent to hub and anyone? For private content, hiding author? Not required? But maybe hub sees who posted. Floor says host cannot read content; metadata maybe not. It says hiding *who* an encrypted message is for, not sender. Host knows account posting. We can include author ID in outer envelope signed? But host could alter? Need integrity. We can sign outer envelope to protect from hub tampering. But if outer envelope includes author ID and signature, hub learns author. Acceptable. But if host is hostile family member, knows sender. We need prevent host from forging. Sign outer envelope with author identity key over the encrypted envelope bytes. But if the host stores and serves, host can't modify.

Could separate:
- Plaintext content object: JSON with author, created, content, inReplyTo?, audience? Author signature over exact bytes of this object.
- Then encrypt the signed content object (payload bytes) with CEK. The encrypted payload includes signature; recipient verifies after decryption.
- Outer envelope: JSON with `author` (identity key), `created`, `nonce`, `ciphertext`, `slots`, `signature` (by author over the entire envelope excluding signature). Since author signature is over ciphertext and slots, it authenticates outer envelope. Hub cannot alter encrypted content or slots without breaking signature.
- Does outer signature use same identity key as inner signature? Yes. Could be redundant but protects outer slots from tampering (e.g., hub strips slots) and ensures ciphertext not swapped. Inner signature authenticates plaintext. Good.

But for public posts, no encryption. Public post object signed. Hub cannot alter.

Need define object model.

Identity/profile:
- Identity keypair: Ed25519.
- Identity ID: `ed25519:<base64url(public_key)>` maybe with prefix. Could use `id` field.
- Profile document signed by identity. Contains:
  - `id`: identity key
  - `name`: human display name
  - `hubs`: array of hub URLs where content may be found (current preferred first)
  - `encryptionKey`? If using converted identity key, not needed, but maybe include X25519 public key derived.
  - `recovery`: maybe recovery policy
  - `created`, `updated`
  - `signature`
- Profile stored at hub at a well-known URL? Maybe `https://hub.example/.well-known/person/<keyid>/profile.json`. But if hub is hostile, can block, but identity remains. Need first contact. If reader knows identity ID and a hub URL, fetch profile. How know hub? From a URL the user shares: `https://hub.example/@name`? That URL returns HTML with profile? We need interop.
- Well-known URLs:
  - `/.well-known/identity/<id>/profile.json` maybe.
  - Also content at `https://hub.example/<hub-specific path>`.
Need minimal.

Let's think data structures.

Use "documents" as JSON objects with a `type` field. Signed objects are encoded as "signed envelope":
```
{
  "payload": "<base64url bytes of a JSON document>",
  "signature": "<base64url 64 bytes>",
  "signer": "<ed25519:... or base64url pubkey>"
}
```
Maybe signer field inside payload too. For self-contained signatures, use `signature` over `payload` bytes plus `signer`? Actually signature over `payload` bytes only is fine; signer is declared in payload and envelope. The `signer` in envelope identifies verification key. To prevent key confusion, include signer in payload. Verify `signature` over base64-decoded `payload`. The `payload` JSON has `author` equal to signer.

For public post:
Payload:
```
{
  "type": "post",
  "author": "ed25519:...",
  "created": "2024-...",
  "text": "...",
  "media": [{"hash": "sha256:...", "type": "image/jpeg", "url": "https://..."}],
  "replyTo": ["<content-id>"],
  "audience": "public"
}
```
Signed envelope stored on hub.

Content ID: SHA-256 of signed envelope? Or of payload? Need content-addressed. If content ID is hash of signed envelope serialization, but envelope is JSON with base64 payload/signature. Could use hash of payload bytes? Hash of payload including signature? We need refer to exact content. Use `id = "sha256:" + base32(SHA-256(payload bytes))`? But payload doesn't include signature; two signatures? The author signs payload. Content ID of payload bytes (without signature) ensures integrity of content but does not bind signature. For replies, referencing payload hash is fine. But if a hostile hub changes the signature envelope? The content ID may not cover signature. But if content is served with different/removed signature, ID still identifies payload; reader verifies signature separately. Could use hash of signed envelope bytes for content ID to ensure full object. However if re-sign? We can define content ID = SHA-256 of the signed payload bytes (the base64-decoded `payload`). Since payload includes author and timestamp, cryptographically unique. The signature is over those same bytes. Content ID doesn't include signature but is enough. If an attacker strips signature, the payload still hashed, but verification fails. Could use `id` field inside payload? Can't self-reference due hash. We can compute ID externally.

Need for fetch: Reader first contact with a person:
- Knows a "person URL" like `https://hub.example/<name>`? The hub serves an HTML page or JSON profile. This page includes identity key and hub URLs.
- But host could tamper with profile? Profile signed by identity; if hub serves tampered profile without valid signature, reader rejects.
- First contact from a shared URL: The URL itself contains a user handle on a hub; reader fetches `https://hub.example/@alice` or `.well-known`. It gets a profile signed by identity. The reader verifies signature and learns identity key. Then can subscribe.
- Poll: Reader polls the hub URL listed in profile for new items. Each item fetched and verified.

Hub storage:
- Hubs store signed/encrypted documents, serve over HTTPS. They can be dumb: GET/PUT endpoints. No access control needed for public; private encrypted objects can be stored publicly but are opaque. Hub need not enforce audience for private because encryption does. It might be nice to have per-identity collections.

Need path design:
- Each identity has a "container" on a hub. Could be `https://hub.example/users/<id>/...` or `https://hub.example/<id>/`.
- Since identity is public key, we can use `https://hub.example/<id>/profile.json`, `posts/`, `items/`. But ID contains base64url; safe.
- Hub can serve a profile at `https://hub.example/<id>/profile.json`.
- Host can choose path, but profile doc includes `hubs`: URLs (base URLs) where content is stored. 
- For interop, define a well-known endpoint: `GET https://hub.example/.well-known/person/<id>/profile.json` and `GET https://hub.example/.well-known/person/<id>/feed.json` (JSON Feed). Could also serve RSS/Atom. But host may map.

Maybe need use a "hub URL" as the origin plus a root prefix. Identity profile lists "endpoints": profile, items, feed. For simplicity.

Let's formulate:
A hub is an HTTPS host that serves:
- `GET /.well-known/protocol` returns `{"protocol":"...","version":1}` (optional).
- `GET /p/<id>/profile.json` returns signed profile envelope.
- `GET /p/<id>/feed.json` returns a JSON Feed of public posts (interop).
- `GET /p/<id>/items/<content-id>.json` returns signed/encrypted item envelope.
- `PUT /p/<id>/items/<content-id>.json` with signed envelope, for publishing.
But hubs may have own paths; profile can list `base` URL.

Need define envelope types.

Let's consider replies and reactions cross-hub.
- A reply is a post with `replyTo` containing content ID of original. It may be public or private. If private, only recipients of original? Need thread access. In scenario, A and B family. A makes family-only post, B replies and reacts across hubs. A's post encrypted to family (maybe A and B). B's reply needs be encrypted to same audience? Or at least to A and others. B knows audience from decrypted post? The decrypted post could include an `audience` list of recipient keys. Then B's app can encrypt reply to same audience (or selected). This ensures cross-hub with no hub ACL. Hubs just store encrypted replies. For reactions likewise: reaction object encrypted to the author/audience? Or public? Scenario family-only post; reaction should be family-only. So reaction is encrypted to audience.

Need design for private audience. The plaintext content includes `audience: ["ed25519:...", ...]` inside encrypted payload. Recipients can see who else was addressed. Does this publish audience to recipients? It's inside; family members already know. Hub cannot. Fine.

For private posts, how does a recipient's reader discover it? Hub doesn't know audience; it cannot provide a per-recipient inbox. So hubs store encrypted objects, and recipients need fetch them. If A publishes private post on a.example, B on family.example needs learn about it. Without hub access control, how does B know to fetch? Options:
1. Recipients poll a known "inbox" URL per recipient? Not possible if hub can't identify recipient.
2. Sender's hub includes a public "outbox" of encrypted objects; all items are public (ciphertext) at predictable URLs. B's reader can poll A's outbox and try decrypting all new items. If many items, B tries each envelope. Hub sees B fetching ciphertext, but not which are for B (because B fetches all). This hides recipient from hub, but B may download all A's private posts, trying slots. For family scale fine.
- A's reader can subscribe to A's outbox feed. But private posts must not appear in public RSS/Atom; they would be encrypted, not readable by ordinary feed readers. We can have a separate "encrypted items" stream.
- The hub cannot filter per recipient. So for each author, all encrypted items are at known sequence. B polls A's encrypted item list. It tries decrypt each. This is manageable.
- Need ensure the hub cannot learn whether B succeeded; B fetches all ciphertexts anyway. Hiding who among audience? If B only fetches A's encrypted feed, hub knows B is interested in A. But if B is a family member, that's okay? The brief says hiding who an encrypted message is for beyond that? It says "Anonymity or traffic-analysis resistance beyond hiding *who* an encrypted message is for." So hub knowing B fetches A's encrypted feed may reveal B is associated with A, but not which message is for B. Fine.

Could have a shared "family group" mailbox? But no hub ACL. Use per-author outbox.

Need define encrypted item envelope outer:
```
{
  "type": "private",
  "author": "ed25519:...",
  "created": "...",
  "nonce": "...",
  "ciphertext": "...",
  "slots": [
    {"ephemeralKey": "...", "ciphertext": "..."},
    ...
  ],
  "signature": "..."  // over UTF-8 bytes of the JSON string of the object without signature
}
```
The `signature` over outer envelope bytes. Need exact serialization. Without canonicalization, define that signature is over the UTF-8 bytes of a serialized JSON object with fields in a fixed order and no extra whitespace, excluding `signature`. But if served as JSON, the hub may reorder fields. If signature is over exact bytes, the verifier needs reconstruct exact bytes. We can define a deterministic serialization for signing: e.g., concatenate fixed fields in a specified order: `type + "\n" + author + ...`? Or use message pack? To avoid canonicalization, we can define that the signed object is not a JSON object but a "signed byte string envelope" where the outer signature is over a byte string `payload` not the JSON envelope fields. Hmm.

We already solved by wrapping payload in base64 and signing payload bytes. For outer envelope signature over slots/header, we could also have a `signedHeaders` payload as base64? Let's design consistently.

Simplest: Use "signed document" as a JSON object with exactly:
```
{
  "payload": "<base64url bytes of JSON payload>",
  "signature": "<base64url>",
  "signer": "<ed25519:...>"
}
```
For public posts, this is enough. For private items, the `payload` is the plaintext content; it is encrypted. But the outer envelope needs to be signed. We can treat the entire private item as a signed document whose payload is not encrypted? Let's separate.

We can have two layers:
- Inner signed content: `{ "payload": base64(plaintext JSON), "signature": ..., "signer": ... }` (signed by author). This is the bytes that get encrypted.
- Outer "private envelope": JSON with fields `author`, `created`, `nonce`, `ciphertext` (base64 of the inner signed content encrypted), `slots`, and a signature over the outer envelope. Again canonicalization issue.

Need solve canonicalization once. Options:
1. Define all signed envelopes as a "binary document" format: a sequence of length-prefixed fields, not JSON. But priority HTTP/JSON, base64. We can define a simple canonical byte encoding for signed objects: a UTF-8 JSON serialization with no whitespace and keys in lexicographic order. This is a JSON canonicalizer, which priority says no JSON canonicalizer. But implementing lexicographic ordering is easy, but brief says "No JSON canonicalizer" likely means no dependency. Could define a specific order and types; implementer writes serialization by hand. It is a canonicalizer but small. Is that allowed? They said no JSON canonicalizer as dependency, likely not as concept? "Implementable from a language's standard library: ... No JSON canonicalizer" means cannot assume a library; but we can specify a canonical form? That is essentially a canonicalizer. But maybe okay if simple.

Better: Avoid signing arbitrary JSON structures by signing exact byte strings. For outer envelope, make the signed content a `payload` field like:
```
{
  "payload": "<base64url bytes of a JSON object>",
  "signature": "<base64url>",
  "signer": "..."
}
```
We can use this pattern recursively. For private item, the outer signed document's `payload` is a JSON object containing `type`, `author`, `nonce`, `ciphertext`, `slots`? Wait then signature over payload bytes. The `payload` is base64, so exact bytes. The outer envelope is signed over that payload. The outer envelope fields (`payload`, `signature`, `signer`) need no canonicalization beyond those three; we can verify signature over the bytes in `payload` only. Thus the signature does not cover the outer JSON wrapper's other fields, only the `payload` bytes. The outer wrapper has `payload` base64, `signature`, `signer`. There are no other fields outside payload that need integrity; all relevant fields are inside payload. So no canonicalization issue: the envelope is just a carrier with those three fields; the signed data is the payload bytes. For public posts, payload contains the post fields. For private outer envelope, payload contains outer private metadata (author, nonce, ciphertext, slots). This payload is signed by author, then the private envelope is served as `{payload: base64(signed private metadata), signature, signer}`. Wait that would sign the outer metadata. But the plaintext content itself is encrypted inside; we also need inner signature over plaintext. We can define inner content as a signed document `{payload, signature, signer}` (the plaintext post), and then encrypt its entire serialized JSON (or maybe just the payload/signature?) to produce ciphertext. The outer private metadata contains the ciphertext and slots, and is itself signed by the author to prevent tampering. So two signatures:
- Inner signature over plaintext content (author).
- Outer signature over private metadata (author) to protect ciphertext/slots.
This works with base64.

Define a generic **SignedObject**:
```
{
  "payload": "<base64url of UTF-8 bytes>",
  "signature": "<base64url Ed25519 signature over payload bytes>",
  "signer": "<ed25519:base64url or just base64url public key>"
}
```
The signer key is also inside payload often. To verify, decode payload, parse JSON, check payload.author equals signer? Not strictly required; verifier can check signature. Need avoid key confusion: include `signer` in payload maybe. We'll make payload JSON always has an `author` field equal to signer for content.

For public post:
Outer SignedObject as above. Payload is JSON post.

For private item:
- Plaintext post JSON (type "post", author, created, text, audience, replyTo, etc.)
- Inner SignedObject: `{payload: base64(plaintext post JSON), signature: sig_by_author, signer: author}`. This entire JSON object (or maybe raw bytes) is serialized as UTF-8, then encrypted.
- Private outer metadata JSON: `{"type":"private","author":author,"created":...,"nonce":...,"ciphertext":base64(encrypted inner SignedObject bytes),"slots":[...]}`. This metadata is put into a SignedObject: `{payload: base64(private metadata JSON), signature: sig_by_author, signer: author}`.
- So the item stored is a SignedObject. The `payload` is base64 of private metadata. The private metadata contains ciphertext. This is clean.

Content ID: We need a stable ID for an item. Could be SHA-256 of the payload bytes of the inner SignedObject? Or of the outer SignedObject's payload bytes? If replies reference content, they need refer to the item. We can set content ID = SHA-256 of the inner plaintext payload bytes (the post JSON) for public post; for private post, maybe the outer SignedObject payload? But the outer metadata includes ciphertext which depends on CEK, but also content identity. Need reference to the private item by ID. Recipients fetch by ID. The hub stores by content ID. Could use `id` computed from the outer SignedObject's payload bytes (the private metadata). For public, outer payload is the post JSON. That is simple: `content_id = sha256(payload_bytes)` of the SignedObject served. For public post, payload is post content. For private, payload is outer private metadata (including ciphertext). This ID covers exact ciphertext and slots. But if the same plaintext encrypted multiple times (e.g., re-encrypted for different audience) yields different ID? That's okay; a private item is the encrypted envelope, not the plaintext. Thread replies refer to the encrypted item ID? If recipients decrypt, inside plaintext they can have a `thread` id maybe based on plaintext? Need careful.

Maybe define two IDs:
- `id`: content ID of the outer signed payload (what hub stores).
- `thread`: for replies, use a "conversation ID" that is a random ID generated by author and included in plaintext. This is stable across encryption and visible to recipients. Could use hash of the plaintext payload? But private replies need to refer to original. The original's plaintext contains a `conversation` or `id` maybe. The reply's plaintext can contain `replyTo` = the original's `id` (outer ID? or plaintext ID?). If the reply is encrypted, the reply's plaintext `replyTo` should be something recipients can resolve. They can fetch the original by its outer ID? The hub stores by outer ID. So use outer ID. But if the original was re-encrypted? not likely. For public post, outer ID = hash of payload. For private post, outer ID = hash of private metadata. The plaintext of the original doesn't contain its outer ID? It could include `id` field assigned by author: maybe `id` is the hash of outer payload, but the plaintext is inside and doesn't know outer ciphertext before encryption. Could compute after encryption? The plaintext payload could include `id` equal to the hash of the plaintext payload (without signature? circular because id inside payload affects hash). So can't self-hash.

Alternative: Use a content ID derived from the inner signed object's signature? Or from a random message ID generated by author. The author can include a random `id` (e.g., base64url 16 random bytes) in plaintext. Hub can store by that ID? But hub needs derive storage key from content. Could use the outer SignedObject's `signature`? For public, the signature/hash of payload. For private, outer payload hash. The plaintext could reference `replyTo` as the original's `id` which is not self-derived? We can have author assign a `messageId` = `sha256(signature? no)`. Let's design content addressing:

- The author creates a plaintext content JSON. It includes `created` timestamp and random `nonce`/`id` maybe. The content ID is the SHA-256 of the payload bytes of the outer SignedObject. But the outer payload for public post is this content JSON. Since content JSON includes a random `id`, the hash can be computed. For private, the outer private metadata includes the ciphertext, which includes the plaintext. The plaintext includes a random `id`. We can make outer private metadata's `id` field equal to that same random id (author-generated). Then content ID for private item could be the outer payload hash, but the plaintext `id` is the same random ID. This ID is generated by author, not self-hash. Hub stores at path `/items/<id>.json`? But if hub receives item, it needs compute the ID. It can parse the SignedObject payload, maybe use a field for storage: author can include `"id": "<random base64url>"` in both plaintext and outer metadata. To prevent collision, include author and random. Content ID = `sha256("post:" + author + ":" + id)` maybe? Need deterministic and verifiable.

Maybe simplest: Every content item has an author-generated `id` which is a base64url random 128-bit. The hub stores object at `/items/<author>/<id>.json` or by hash. But hub must not rely on author? It can use path derived from author and id. Readers fetch by author and id from profile feed. For content addressing, use `id` plus author. This avoids self-hash. But replies need refer to `author` and `id`. The content ID can be a string `ed25519:<author>:<id>`? The host cannot forge due signature. If hub stores by `id` within author's container, fine. Host could store object at wrong path? It can serve, but readers verify signature. The path is just locator.

Need decide. Content addressing by hash is nice for interop and integrity; but we can define `id` as random chosen by author and include in signed payload. Then readers can fetch by URL from feed. For replies, reference by `author` + `id`. This is simple and no canonicalization. However hash-based ID ensures content-addressed storage and prevents host substituting object at same ID. Signature already prevents substitution. Hash ID may be useful. But can use signed object with `id`. If author-generated id, a hostile hub could serve an older signed object with same id? Author could reuse id? We can require id unique random; old object signed by author with same id would also verify, but if author reused accidentally? Not threat. Could use `id = SHA-256(payload bytes)` to ensure uniqueness. But circular.

Let's stick with hash-based ID for public signed objects: content ID = `sha256:<base32(payload_bytes)>`. For private objects, content ID = `sha256:<base32(outer_private_metadata_payload_bytes)>`. The plaintext inside can reference this content ID? It cannot self-reference due ciphertext. But for replies, the reply's plaintext can include the original's content ID as observed from the outer envelope. For the original post's plaintext, it doesn't need to know its own content ID. If a reply wants to reply, it uses the outer ID of the original. That's fine. For private original, the outer ID is known to recipients? Yes, when they fetch the outer SignedObject from a feed, they see its content ID (or can compute from payload). They can decrypt; the reply app can cite that outer ID. Good. The original's plaintext can also include a `thread` random ID to tie multiple encrypted items? But not required.

Need feed format:
- Public posts can be served as JSON Feed at `/feed.json` with items whose `id` is content ID, `url` points to the item. This gives interop with RSS/Atom/JSON Feed. The feed includes public content (signed objects) maybe with text. We can also serve RSS/Atom.
- Private items: We need a way for authorized recipients to discover new private items. Since hub can't filter, the hub can serve an `encrypted-feed.json` at `/encrypted-feed.json` listing all private item IDs for an author. B's reader polls this feed, fetches each item, tries decrypt. The feed itself reveals no contents/audience. It is public but opaque. Host could provide this feed; if hostile, they could omit items (but host controls storage/serving; can always withhold). Floor assurance 2 is confidentiality, not availability? Floor 3 host cannot keep you. Host withholding content? If private messages, the recipient may not know. But if author uses another hub? Need maybe availability against host? Not in floor. But host can refuse to serve, but content encrypted; if host refuses to serve, failure is availability. Could mitigate by storing copies on multiple hubs. Profile lists hubs; readers can fetch from any. Hubs can be dumb mirrors. We can design hubs store signed objects; user can publish same item to multiple hubs. For private, same ciphertext can be copied. That helps.

Need first contact and poll:
- First contact: Reader receives a person URL or identity ID + hub. Fetch profile at hub. Verify signed profile. Profile includes `id`, current hub list, public feed URL, encrypted feed URL.
- Poll: Reader polls the public feed for public posts, encrypted feed for private. For encrypted, it tries each slot to decrypt; if decrypt succeeds, inner signature verifies.

How does Grandma's daughter find grandma after she moves? Profile hubs updated. Existing reader's app follows identity ID. It polls old hub; if profile not found or not updated? If old hub hostile or gone, maybe it tries other hubs from last known profile. But if only old hub and domain gone, no. We need maybe profile includes a "contact" list? Let's revisit later.

Need identity primitive section argument. Let's detail.

Identity primitive: Ed25519 public key as stable ID. Human name is profile claim. Alternative rejected:
- Domain-relative identifiers (user@domain) rejected because host controls domain; can revoke, and identity changes when domain goes.
- HTTPS URL identifiers rejected for same reason; host can seize.
- DID with registry/blockchain rejected due no global registry/dependency.
- A bare human name rejected because no cryptographic binding.
- Keypair as identity gives host cannot speak for you, host cannot keep you, stable across hubs/domain loss. It's self-certifying. The public key string is ugly but apps hide it.

Need key management and recovery.

Let's expand.

Key creation:
- User installs app. App generates Ed25519 identity keypair and a random recovery secret? Actually private key stored on device. App asks display name, recovery contact. It creates profile signed.
- The app also generates a "recovery record" signed by identity:
  - `type: "recovery"`
  - `author`: identity ID
  - `created`
  - `agents`: [ {agentKey: daughter's identity key, encryptedSeed: ...} ] maybe
  - `policy`: number of agents needed? For simplicity one.
- Encrypt identity private seed (or a recovery key) to daughter's public key using the same encryption construction (or simpler X25519 to agent). This record is stored on the user's hub and sent to daughter's app. Host cannot decrypt.
- If phone lost, grandma calls daughter. Daughter's app has the encrypted recovery record (or fetches from any hub). She decrypts with her private key, obtains grandma's identity private key, and helps grandma provision new phone. The app can then generate a new device and maybe sign a revocation? Need consider theft. If phone stolen, identity key may be stolen. Need key rotation/revocation.

Key rotation:
- Identity can sign a "key rotation" document specifying a new identity key. The old key signs over new key and transition metadata. Host and readers can verify. This allows moving to new key while retaining identity? If identity is the key, rotating changes identity. Need design "identity" as a stable identifier with rotation keys. But if identity primitive is a key, key change changes identity. Scenario 7: after author's key loss, they re-meet author (stranger), meaning continuity across total key loss is non-goal. But for theft/rotation, maybe need a "successor" pointer so followers can follow new key. This is a new identity? The person remains same socially but cryptographic continuity is via a signed rotation from old key. We can define identity as an "account" with a canonical root key that can delegate/rotate? Hmm.

Floor 3 host cannot keep you: key and copy always on device. If key changes, identity maybe new key. The brief scenario 4: domain goes, identity doesn't change. So identity must survive moving hubs, not key rotation. Key rotation is separate, not necessarily preserving ID. Key loss total continuity non-goal. Theft: if private key stolen, attacker can sign as you. Need recovery/revocation: If you still have old key? We need allow revocation. But if thief has key, they can sign conflicting rotations. Without trusting a third party, no way to recover from key theft. We can only rely on pre-signed recovery agents? Let's think.

We can design identity as a signing key, no separate recovery authority. If key stolen, thief can sign. To recover, user needs a pre-established recovery key/agent that can rotate identity. But if the identity is the old key, the thief controls the old key and can also sign. Need a root identity separate from signing key? Maybe identity primitive should be a "key set" with a master recovery key and signing subkeys. But no global registry. Could use a self-signed "identity document" with a root key and one or more active signing keys. The root key can rotate signing keys; root key itself is identity. The host cannot speak because active signing key private is user's. If signing key stolen, user uses root key (kept offline) to revoke and rotate. But grandma never shown key, root key on device? If phone lost, root key lost too. Hmm.

Let's define identity as an Ed25519 root key. The root key signs a "key document" that lists current active signing key(s). Content is signed by active signing key, not root? Then root can revoke active. But active key can be on device, root maybe backed up. For recovery, root private key encrypted to daughter. If phone lost, daughter decrypts root key, can issue new active signing key. This is more complex but better for theft/rotation. But floor 3 says "key and copy always on your device" maybe root key on device. Host never has. Simpler identity key = signing key.

Need satisfy "host cannot speak for you": signed by identity key, which was never host's. If identity key stolen? Out of scope? Key theft is in section 7. Need specify limitations.

Maybe use two keys:
- **Identity root key**: Ed25519, offline/device, signs only profile and key changes. It is the canonical ID.
- **Signing subkey**: Ed25519, device, signs posts. Profile (signed by root) lists current signing subkey. Host can't post because subkey private on device. If subkey stolen, root revokes it. If root lost, recovery via agents decrypts encrypted root key backup. This is a clean design. But complexity: two keys for readers. Is it necessary? Weekend implementer? Maybe overkill. The brief prioritizes minimal. Could use one key and accept key theft cannot be cryptographically resolved without social recovery. But section asks key change and recovery — can state limitation. However hostile host claiming departure is forgery: if you leave and old key signs move? Need contested departure. Let's design with root + subkeys maybe.

But the floor says "the key that signs was never the host's." It doesn't require root/subkey. Could be just one key.

Let's examine contested departure: hostile operator claims the departure is the forgery. Scenario: woman leaves hostile hub. She moves identity/content to new hub. Host has old copy of her profile/posts. He claims her departure/move notice is forgery. How do we ensure her old content reads as stale rather than as her? Need mechanism.

If identity is Ed25519 key held by woman. She signs a "move" document pointing to new hub. Host cannot forge. But host may serve the old profile signed by her (from before departure), and claim it is current. It doesn't have private key, so cannot sign new posts. But can serve old content. How do readers know old profile is stale? If she publishes a signed "profile update" with a higher timestamp/sequence to new hub, but readers polling old hub won't see it if host hides it. If she can publish to old hub before leaving? Host may block. She can publish to her followers' hubs or directly to reader? Need design.

Need prevent hostile host from serving stale signed content as current. Use signed sequence numbers / timestamps. Profile includes a monotonically increasing `seq`. Posts have `created` timestamp. Host can serve old profile (signed) with lower seq. But if reader has no newer info, they may accept old. When she moves, she can publish new profile to other hubs or to contacts. Readers that know her may fetch from multiple hubs or receive a signed "move" via a contact. But existing readers that only poll the hostile hub may not see the move if the host withholds it. However if they follow by identity and have her profile with multiple hub URLs? If she only had one hub (hostile), and he blocks new update, readers can't discover move automatically. Need maybe she can send a signed move notice to her followers via their own hubs? But no central. Scenario 1: "After she leaves, her mother's app follows her with one tap, and his frozen copy of her old content reads as stale rather than as her." Her mother's app probably has a direct relationship; when she leaves, she can tell mother's app out-of-band? "follows her with one tap" maybe the mother can update. Need protocol support.

Could use a "revocation/pointer" at old domain? Host can block. Maybe she can use a new domain and publish there; mother's app may know new domain because daughter tells? But the brief wants protocol. Need argue.

One approach: Content includes a `hub` field and a timestamp. Readers can compare if they see multiple copies. A hostile host serving old content cannot produce newer signed content. But without seeing newer content, they can't know there is newer. However if each post/profile includes a `prev` hash chain, and the latest signed object is propagated to followers by any hub, readers can detect stale old host if they know chain head from any source. Need distribution of chain head. Could publish a signed "head" to a small set of "witness" hubs? No global. Maybe followers' own hubs fetch and mirror updates from the author's hubs. If mother follows her, mother's hub (maybe separate) might fetch from hostile hub. If hostile hub withholds, no. If mother's app also occasionally fetches from the author's new hub? Need know.

Maybe floor doesn't require readers who only trust hostile host to detect move; scenario says after she leaves, her mother's app follows her with one tap. Perhaps moving includes sending a new profile to mother's app directly (e.g., QR). Then mother's app sees higher seq and marks old copy stale. Hostile host serving old profile can be detected because the mother's app has newer signed profile. Good.

Need "stale rather than as her" means signed profile has a sequence number; when mother's app sees a profile with seq 5 from hostile hub, and it knows seq 6 from new hub, it treats hostile copy as stale. The hostile host can still serve old signed posts; they verify as her old posts, but not new. They are not forgeries. It cannot alter them. So acceptable.

Thus need monotonic sequence in profile and posts. Host cannot roll back? If reader has no newer, maybe can't detect. But if they ever learn newer, they can mark old as stale. Use `seq` in profile. For posts, `created` timestamp signed; host cannot backdate because signature. But it can serve an old post as new? The post's signed timestamp is old; feed listing can be malicious but item signature shows old timestamp. Readers can sort by timestamp. Host cannot alter or backdate what she wrote because signatures.

Need key rotation/revocation:
- Profile contains `seq` and `hubs` and `signingKey` maybe.
- A higher `seq` profile supersedes lower. Readers accept highest known.
- A "revocation" object can be signed by identity key revoking a subkey or profile. Host cannot forge.
- If identity key stolen, thief can sign higher seq. No cryptographic solution. Pre-signed recovery agents may help if root key separate. Let's discuss.

Maybe implement a root and active signing key. Let's decide architecture.

Given adversarial host, identity key private must be never on host. User device may be phone. Grandma loses phone. Recovery via daughter. A single identity key encrypted to daughter is simplest. Key rotation/loss: if lost and recovered from daughter, she gets same key; no rotation needed. If phone stolen, thief can sign; user can use same key (recovered) to sign a revocation? But thief also has key. They can race. No way to prove which is legitimate without external trust. We can add a **revocation passphrase**? No.

Could design recovery with **multi-agent threshold** and **pre-declared recovery keys** that are separate from identity key. The identity key can sign a recovery policy granting agents the ability to rotate the identity key. If identity key stolen, agents can sign a revocation? But if thief has identity key, they can also sign a new policy? Hmm if root key signs policies, thief has root. Need root key separate and not on device? Let's model.

Identity root key: generated during onboarding. It is the identity. It can be stored offline/recovery. It signs a **delegation** to an active signing key stored on phone. Hostile host never has either. If phone lost, root key recovered from daughter, can delegate new signing key; thief cannot sign with root (offline). If phone stolen, thief has active signing key only, not root (if root not on phone). User recovers root, revokes active key. This is robust. If grandma loses phone, daughter decrypts root key backup. If phone stolen, thief can't steal root if not stored on phone. But how does grandma post from phone without root? Phone has active signing key. Root key can be stored in daughter's encrypted backup only, or maybe phone secure enclave? The floor says "identity and everything you wrote ... key and a copy were always on your device." It says key and copy always on your device. If root not on device, violates? Maybe active key on device, root copy can be on device? If root on phone, thief gets it. Could store root only in recovery agents and maybe a printed copy? But grandma never shown key. Hmm.

Floor 3: "You can leave at any moment with your identity and everything you wrote, without asking permission, because the key and a copy were always on your device." This implies the signing key (at least active) and content copy are on device. It doesn't say root key must be on device. Active key on device suffices to sign. Recovery root with daughter maybe.

But adding root key/subkeys increases complexity. Need weekend implementer? Maybe still doable: Keys are just Ed25519. Profile signed by root, lists active signing key. Posts signed by active key. Readers verify chain: root -> profile -> active key -> posts. This is simple.

Identity primitive then could be the root public key. Root signs a **Key Document**:
```
{
  "type": "keydoc",
  "root": "<root id>",
  "activeKey": "<signing pubkey>",
  "created": "...",
  "seq": 1,
  "signature": "sig by root"
}
```
Profile (display name, hubs) signed by active key? Or root? Maybe profile signed by root if root offline. But updating hubs/name frequently requires root. Could store root on device? Hmm. Could have active key sign profile updates, but root key doc delegates profile signing to active. Then root only needed for key rotation/recovery. Profile signed by active key. Reader verifies active key via root key doc, then profile via active. But root key doc must be stored. If root private offline, recovery easier.

Let's define:
- Root key = identity ID. Private stored encrypted for recovery agents; may also be on user's device initially? For Grandma, app can generate root and active. Root private can be kept in OS secure storage? If phone lost, thief may get root. To allow recovery from theft, root should not be on phone after backup? But then grandma cannot recover without daughter if she wants to rotate. For posting, only active key on phone.
- Onboarding: App generates root keypair and active keypair. Root private key is encrypted to recovery agents (daughter) and then **deleted from the device**? But floor says key always on device? Maybe active key is the signing key. Identity root is not used day-to-day. The user "has identity" via active key signed by root. But can she prove root ownership? The active key is delegated. The root private not on device means if she wants to move to a new hub and update profile, active key can sign. She can always leave with active key and content. Good.
- But can she rotate active key without root? No. If active key stolen, she needs root recovery. If root private deleted, she calls daughter to recover root and revoke. That's fine.
- Is this too complex? It's two keys. But improves theft story.

However brief priority "easy implement" maybe one key is easier. We can present root+active as an optional key management extension? But the protocol should deliver floor. To handle hostile host claiming departure is forgery and theft, root+active robust.

Let's consider if root+active affects "identity primitive". Identity ID might be root public key. Root public key signs a "delegation" to active signing key. Active key signs content/profile. But then the host cannot speak for you because he never had active private key. If host was never given root either. Good.

But if active key is on lost phone, thief can sign as her until root revokes. That's a window. We can pre-sign a revocation from root? The user can call daughter to recover root and sign revocation. The daughter is recovery agent. This is acceptable.

Need recovery of root key. Use threshold? Could use one trusted contact. For grandma, daughter. But if daughter is hostile? Trust. We can support multiple agents and threshold.

Let's design recovery record:
- Signed by root key (or active? root) containing:
  - `type: "recovery"`
  - `root`: root public key
  - `activeKey`: current active
  - `created`, `seq`
  - `agents`: [ {agentKey: daughter's root or active encryption key, encryptedRoot: ...} ]
  - `policy`: {threshold: 1}
- The `encryptedRoot` is the root private key (or seed) encrypted to agent's encryption key using our private envelope construction. The recovery record is stored on hub and on agents' devices.
- To recover, the agent decrypts `encryptedRoot` with their private key. The agent's app then has root private key. It can generate a new active key and sign a new key document (revoking old active) with root. It then provisions the new device. This means agent has full access to identity. For grandma/daughter acceptable. For stronger, use threshold multiple agents.

Hostile hub sees recovery record but cannot decrypt. It cannot modify.

But if root private key is only in recovery record encrypted to daughter, what if daughter loses her key? Could have multiple agents. Not required.

Now, does this violate no dependencies? It's just Ed25519 and encryption.

Let's elaborate encryption construction.

We need define:
- Public-key encryption of a binary message `M` to a set of recipients.
- Use X25519 ECDH + HKDF (SHA-256) + ChaCha20-Poly1305.
- Need key derivation from Ed25519 root/active keys. We can define:
  - Every Ed25519 keypair has an associated X25519 keypair derived from the same 32-byte seed. Standard conversion:
    - Ed25519 public key -> Curve25519 u-coordinate (RFC 7748 mappings).
    - Ed25519 private key seed -> X25519 scalar (clamp).
  - But if root key private stored as seed, yes. For active key too.
- Recipient encryption key: For identity root, maybe use root's X25519. For content, recipients are root IDs (or active?). We can encrypt to root keys so recovery agents? Hmm. For private posts, recipients are people (identity root keys). Their active signing keys may be used? We need their encryption public key. Could use root's X25519 derived from root public key. That is stable. Even if active key rotates, private posts can be decrypted using root private key (which may be offline). That's inconvenient. Better derive an **encryption subkey** from root or active? If root private offline, recipient can't decrypt private posts on device unless it has encryption subkey. We need content encryption to a device key.

Maybe define a separate **encryption key** for each identity, generated by the root and delegated in the key document, along with signing key. The encryption private key can be on the user's device (or multiple devices). The root key delegates both signing and encryption keys. This is even more complex.

Alternative: Use active signing key's X25519 for encryption. Active key private is on device, so recipients can decrypt. If active key rotates, new key doc advertises new encryption key; senders encrypt to current active. If an old private post was encrypted to old active, recipient with new device needs old active key? They may keep key history. This is okay. The root is only for recovery/rotation. So for private messages, the recipient is an identity root, but the encryption key used is the current active encryption key? Need know active for recipient. Sender fetches the recipient's profile/key document, which includes active signing key. Can convert that to X25519. That way encryption is to the current device key. If active key rotates, the recipient's profile updates.

But if the profile is hosted on hostile hub, it might provide stale active key. The sender will encrypt to old active. If the recipient has rotated, they may still have old key? Maybe not. Could fetch from multiple hubs and choose latest seq. If stale, the recipient won't decrypt, and sender may resend. This is liveness, not confidentiality. The hostile hub cannot read because it doesn't have old active private; if it served its own key, signature invalid. If it serves old signed active key, it was valid at some point but revoked by root? The key doc with revocation would have higher seq; sender needs latest. If only stale available, fail. But no confidentiality breach.

Maybe simplify: Use a distinct **encryption keypair** delegated by root, generated on device. The key document includes `signingKey` and `encryptionKey` (Ed25519 pub for X25519? Actually X25519 pub). The encryption private key is on device. When active key rotates, encryption key may rotate too. For private posts, sender uses recipient's current encryption key from the latest key doc. Recipients decrypt with corresponding private key.

Is separate encryption key necessary? Using active signing key for X25519 is acceptable; standard crypto libraries often discourage but not insecure if domain separated. We can derive an X25519 encryption key from the same seed as the active signing key using HKDF labels. But for key doc, include `encryptionKey` (X25519 public) explicitly, signed by root or active. That avoids exposing Ed25519 key for DH. But then key doc has two public keys.

Maybe for weekend simplicity, one active signing key whose Ed25519 public is converted to X25519 for encryption. Then key doc only includes `activeKey`. We'll use domain separation in HKDF. We can note standard blessing: converting Ed25519 to X25519 is well-defined; use the seed for both? Hmm.

Let's simplify identity to **one identity key** for signing and encryption? But then recovery/theft issue. The brief's "identity primitive" could be the root key? Let's not overcomplicate for encryption.

Could design:
- Identity is an Ed25519 keypair. Private key on device. Public key is ID.
- Profile signed by identity key.
- Encryption to identity: use X25519 derived from identity public key.
- Recovery record encrypts identity private key to recovery agents.
- Key rotation: identity key can sign a "successor" key. If key stolen, no perfect solution.

This is much easier. We can honestly state key theft is not solvable without pre-established recovery, and total key loss non-goal. The brief says key change and recovery including theft and contested departure. We can describe limitations.

Maybe root+active is actually worth it. Let's incorporate but not too complex.

Define artifacts:
1. **Root key** (Ed25519). This is the identity. It signs a **Key Assignment** that delegates to a **Signing Key**.
2. **Signing Key** (Ed25519). Signs Profile and Posts. It is kept on device. Host never has it.
3. **Profile** signed by Signing Key. Contains display name, hubs, etc.
4. **Posts/Replies/Reactions** signed by Signing Key.
5. **Encrypted envelope** for private content. Uses encryption to recipients' current **encryption key** derived from their Signing Key? Hmm.

But if profile signed by Signing Key, and Signing Key delegated by Root, a reader must fetch root assignment first. How? The identity ID = root public key. The hub serves at `/p/<rootID>/key.json` a signed root assignment. It contains the active signing key and a `seq`. Then profile at `/p/<rootID>/profile.json` signed by active key. For first contact, reader fetches key.json, verifies root signature, gets active key. Then fetches profile, verifies active signature. That's two fetches. Acceptable.

When active key signs a post, how does reader know active key is current? Reader has key assignment. If host serves old active key assignment, and then posts signed by old active, they verify as old but may be stale. To know current, the reader fetches key.json with highest `seq` from hubs. If root later revokes active, it signs new key.json with higher seq. Readers who see it reject old posts. Host cannot produce new key.json without root private. Good.

For private encryption, if using active signing key for DH, sender needs active signing key. Fetch key.json. If active key rotates, sender uses new.

Now Recovery:
- Root private key is encrypted to recovery agents. The recovery record is signed by root (or active?) and stored. If phone lost, root private can be recovered.
- The root private key ideally not on the phone after setup? But to sign key rotation later, user needs root. If root is not on phone, she needs daughter to rotate keys. For normal hub moves, active key can sign profile. For key theft, she needs root. So root can be kept off device, only recovery. But if she wants to add a recovery agent, she needs root. Could do via root offline. For simplicity, the app can keep root private in device secure storage initially; after backing up, it may delete root, leaving active key. Let's specify: The root private key is generated on device during onboarding, encrypted to recovery agents, then destroyed on the device; only the active signing key remains. This gives strong theft protection. The user can still "leave" because active key and content are on device. The root private key is recoverable via agents. If she wants to rotate active key, she recovers root. Good.

Does floor 3 require "the key and a copy were always on your device"? The active signing key is on device; root isn't, but identity root? The identity is root; if root private not on device, does she have identity? She has active key that can sign day-to-day, but not the root. The host cannot keep her because she can move with active key and content; but if she loses active key and no recovery agents, she loses root. That's fine. The phrase "the key" maybe refers to signing key, not root. We can word.

Need maybe not overcomplicate with root deletion. Let's think scenario 2: Grandma onboards. App picks name, creates root+active, encrypts root to daughter, deletes root from phone? If she loses phone, she calls daughter, daughter recovers root and sets up new phone. That works. She never shown key. She doesn't need root daily. Good.

But for the malicious host scenario: If host was abusive ex, did he ever have root? No. He may have been recovery agent? In divorce, maybe not. The woman has root deleted from device but encrypted to her mother/sister. She can recover. Host can't. Good.

Need define recovery record carefully:
- Root key signs a **Recovery Record**:
```
{
  "type": "recovery",
  "root": "<root pubkey>",
  "seq": 1,
  "agents": [
    {
      "agent": "<agent root or active pubkey>",
      "encryptedRoot": "<base64 of encrypted root seed>"
    }
  ],
  "threshold": 1,
  "created": "..."
}
```
Signature by root over payload bytes (using generic SignedObject).
- The `encryptedRoot` is produced using our private envelope construction to the agent's encryption key. It could be a full private message whose plaintext is a JSON `{ type: "root-seed", root: ..., seed: ... }`.
- The recovery record is public but encrypted fields are opaque.
- It is stored on the user's hub and delivered to agents. The agent's app can decrypt.

If root private is deleted, she cannot update recovery record without root; she can recover root to do so.

Now profile:
- Profile signed by active signing key:
```
{
  "type": "profile",
  "author": "<root pubkey>",
  "signingKey": "<active pubkey>",
  "name": "...",
  "hubs": ["https://new.example/p/<root>"],
  "publicFeed": "https://new.example/p/<root>/feed.json",
  "encryptedFeed": "https://new.example/p/<root>/encrypted-feed.json",
  "seq": 5,
  "updated": "...",
  "bio": "..."
}
```
Wait if profile signed by active key, it should include `signingKey`? The active key is already trusted. But to bind to root, the key assignment has active. The profile doesn't need to repeat. It includes `author` root. Signature by active. Readers verify active from key assignment. The host cannot change active key without root signature. Profile includes hubs.

Sequence: The root key assignment has `seq` for key rotation. Profile has `seq` for profile updates (hubs). A hostile host can serve old profile with lower seq. If reader knows newer from another hub, it marks old stale. If not, no way.

Could combine key assignment and profile into one document signed by root? But root offline. We can keep separate.

Posts:
- Public post signed by active signing key:
```
{
  "type": "post",
  "author": "<root pubkey>",
  "created": "...",
  "text": "...",
  "audience": "public",
  "replyTo": ["<content-id>"],
  "reactionTo": ["<content-id>"],
  "seq": maybe?
}
```
Need prevent host from reordering? Posts have timestamps. Ed25519 signature over payload. Host cannot backdate because signature over created timestamp. Could host publish an old signed post as if new? The timestamp is old. Readers can see it's old. Feed order may be spoofed but content timestamp is signed.

Private posts:
- Plaintext post JSON includes `audience`: list of recipient root IDs? Use root IDs. The plaintext is signed by active key as a SignedObject.
- Then encrypted to recipients. We need encrypt to recipients' current active encryption keys. The sender needs to fetch each recipient's key assignment and maybe profile. If recipients are root IDs. For each recipient root ID, fetch key.json from a known hub; obtain active signing key; derive X25519 pub. If unavailable, maybe use root key? We can include an `encryptionKey` derived from root? Hmm. If root private offline, recipient can't decrypt with root. But active key on device. So use active signing key.

But if active signing key is Ed25519, can convert to X25519. We'll specify.

Need define content ID and URLs.

Artifacts stored on hub:
- Key assignment: `GET /p/<root>/key.json` -> SignedObject (signed by root)
- Profile: `GET /p/<root>/profile.json` -> SignedObject (signed by active)
- Public posts: `GET /p/<root>/items/<content-id>.json` -> SignedObject (signed by active)
- Private items: `GET /p/<root>/items/<content-id>.json` -> SignedObject whose payload is private metadata (signed by active)
- Public feed: `GET /p/<root>/feed.json` -> JSON Feed (could be generated by hub, not signed). It lists public posts.
- Encrypted feed: `GET /p/<root>/encrypted-feed.json` -> JSON list of private item IDs and maybe outer SignedObjects? If hub generated, it could omit. Better have an append-only signed **index**? For minimal, hub provides feed; if hostile hub can omit, but it can always omit serving. We can have the author publish a signed **log** of item IDs? Hmm.

Host can withhold items. Floor doesn't include availability against host except not keep you. But if she leaves, she has copy. Private recipients may miss if hostile. If hub is hostile, it can refuse to serve. We can recommend users mirror to multiple hubs. But no guarantee. We should name failure.

Maybe define a **signed index** per identity:
- `index.json` signed by active key, listing the latest N item IDs (or all item IDs) and current seq. It is updated with each post. The hub serves it; if it serves an old index, readers see fewer items but don't know unless they have a newer index. But if the author publishes to multiple hubs, readers can compare.
- Simpler: The hub's feed is generated from stored items. For public JSON Feed interop, hub generates feed. Since host can omit, but not floor.

Need interplay with interop (RSS/Atom/JSON Feed):
- Public posts should be in JSON Feed. We can define hub serves a JSON Feed at `/p/<root>/feed.json` with items. The content text is plain. That can be consumed by existing feed readers. Mastodon/Bluesky bridges can read the JSON Feed. For RSS/Atom, hub may serve `/feed.xml` and `/feed.atom`. The protocol can require JSON Feed; RSS/Atom optional. The brief says content reaches existing feed readers (RSS/Atom/JSON Feed) and fediverse/Bluesky with nothing extra built. So if we provide JSON Feed, many readers. For RSS/Atom, a dumb hub can generate them. Good.
- "Their replies coming back is an extension, not a requirement." So no need incoming from fediverse.

Now, more detailed encryption.

Let's define primitives:

**Base64url**: RFC 4648 without padding.

**SHA-256**: standard.

**Ed25519**: Ed25519 signatures, 64-byte.

**X25519**: Curve25519 ECDH. We can define how to derive X25519 keys from Ed25519 keys if using same key:
- Ed25519 private key seed is 32 bytes. The X25519 private scalar is `seed` clamped: `scalar = seed`; clear bits 0,1,2 and bit 255, set bit 254 (RFC 7748 clamping). In practice X25519 implementations do this.
- Ed25519 public key `A = [a]B` in Edwards. Convert to Montgomery u-coordinate: `u = (1+y)/(1-y) mod p`. Or use standard `birational.decompress` formulas. But to simplify, we can say the key document may include an explicit X25519 public key, avoiding conversion. For active signing key, we can derive an X25519 **encryption key** from the same seed using HKDF and a label, and include it in the key document. Then no conversion needed for recipients, but need sender fetch it. Let's do this to avoid conversion complexity.

Define **encryption subkey**: Each active signing key has an associated X25519 keypair. How is it generated?
- During key generation, produce a 32-byte seed for signing key and a separate 32-byte seed for encryption key? Or derive from root? Simpler: The key document includes:
  - `signingKey`: Ed25519 public key
  - `encryptionKey`: X25519 public key
Both signed by root. The user's device stores corresponding private keys. For grandma, the app generates both. The host never has either.
- Key document signed by root:
```
{
  "type": "keydoc",
  "root": "<root>",
  "seq": 1,
  "active": {
    "signingKey": "<ed25519 pubkey>",
    "encryptionKey": "<x25519 pubkey>"
  },
  "created": "..."
}
```
This is better: no Ed25519-to-X25519 conversion. It requires key doc includes encryption key. Recipients fetch key doc and use encryption key. Root key not used for encryption. Key rotation creates new key doc with new signing/encryption keys.

But if the signing key signs content, the encryption key is only for receiving encrypted content. For sending, the sender's device has its own encryption private key? Actually if A sends to B, A uses B's encryptionKey for key wrapping. A's own encryptionKey is only for receiving. A's content is signed by A's signingKey. So sender needs only signing key.

Recovery agents:
- Agent identities also have root and active encryption key. The recovery record encrypts root seed to agent's `encryptionKey` from their key doc. Agent's device has corresponding private key.

Now we need specify encryption envelope in terms of X25519 keys and ChaCha20-Poly1305.

**Key encapsulation slots**:
For each recipient `i` with X25519 public key `R_i`:
- Generate an ephemeral X25519 keypair (`s`, `S`).
- Compute DH shared secret `DH_i = X25519(s, R_i)`.
- Derive a slot key `SK_i = HKDF-SHA256(ikm=DH_i, salt=context, info="slot-key" || S || R_i || outer_nonce?)`.
- Encrypt a random 256-bit CEK under `SK_i` using AEAD:
  - `slot_plaintext = CEK` (32 bytes)
  - `slot_ciphertext = ChaCha20-Poly1305.Encrypt(key=SK_i, nonce=random_slot_nonce, plaintext=CEK, aad=outer_nonce || S?)`
- Slot: `{"ephemeralKey": base64url(S), "nonce": base64url(slot_nonce), "ciphertext": base64url(slot_ciphertext)}`
No recipient ID. Recipient computes shared secret from `ephemeralKey` and its private encryption key, derives SK, tries to decrypt; AEAD auth verifies. If fails, try next slot.
- Need include `S` in AAD/info to bind ephemeral key; yes.

But HKDF derivation: Use HKDF-SHA256. Need define HKDF. Standard library may not have HKDF but implementable with HMAC-SHA256. HMAC uses SHA-256. Good. Brief standard library has SHA-256; HMAC is simple. We can specify HKDF.

**CEK**:
- Random 256-bit key used for content AEAD.
- The content plaintext is the inner SignedObject serialized as JSON (or payload? We'll encrypt the whole inner SignedObject JSON bytes).
- Encrypt with ChaCha20-Poly1305 using CEK and a random nonce. AEAD ciphertext includes tag.

**Why ChaCha20-Poly1305?** Would need implement. We can define it, maybe point to RFC 7539. It is simple, no dependencies. Is that allowed? The brief says implementable from standard library Ed25519, SHA-256, etc. ChaCha20-Poly1305 not listed. Could use AES-GCM? Not stdlib. Could use a custom AEAD from SHA-256? Let's evaluate.

Could define AEAD using **HMAC-SHA256 and XOR**? E.g., encrypt with stream cipher generated by HMAC? That is less standard but implementable from SHA-256 only. We need authenticated encryption. A simple construction: Use HKDF to derive encryption key and MAC key. Encrypt plaintext with XOR using keystream from SHA-256 in counter mode. Then HMAC-SHA256 over ciphertext + AAD for authentication. Is that secure? Yes if properly designed: use HKDF to derive keys, use SHA-256 counter mode as PRF, use HMAC-SHA256 for MAC. This avoids ChaCha20/Poly1305. But it's nonstandard and may be avoided. Could specify and use. The brief says no dependencies but standard library includes SHA-256. Implementing HMAC and HKDF is easy. Implementing ChaCha20-Poly1305 is maybe also easy but longer. Which honors "standard library only"? The list includes Ed25519, SHA-256, HTTP, JSON, base64. No ChaCha20. So a design using only SHA-256 and Ed25519 for encryption might better satisfy #1. Let's consider.

Can we build public-key encryption from Ed25519? We still need X25519 for DH, but implementing X25519 from the same Curve25519 field might be required anyway. The brief says Ed25519, not X25519. But many Ed25519 libraries include X25519? Maybe no. We can specify a small X25519 implementation. Or we can use Ed25519 keys for encryption via ECDH? There is no standard encryption with Ed25519. But we can use **static-static DH with X25519**. Need implement X25519. We'll include it.

For AEAD, if we want only SHA-256, define **Encrypt-then-MAC with counter mode from SHA-256**:
- Derive `ek = HKDF(cei, info="enc")` and `mk = HKDF(cei, info="mac")`.
- To encrypt plaintext P with nonce N:
  - Split P into blocks of 32 bytes.
  - For each block index i (starting 0), keystream block = SHA-256(ek || N || uint32_be(i)) (or HMAC?).
  - C = P xor keystream.
  - MAC = HMAC-SHA256(mk, N || AAD || C) (or SHA-256).
- This is a secure stream cipher if SHA-256 is a PRF. It is a bit nonstandard but acceptable? We can call it "S-256" or "SHA-256-CTR + HMAC". But designers might frown. Yet the brief's constraints intentionally demand from stdlib. We can define a small AEAD using HMAC-SHA256 and SHA-256.

However the brief likely expects using libsodium? But it says no dependencies. "Ed25519, SHA-256, HTTP, JSON, base64" maybe they don't mention AES because it's not in stdlib. They might expect we define a custom construction for encryption from Ed25519/SHA-256. But encryption from Ed25519 is not possible directly. Maybe use `crypto_box`? Let's parse: "No dependencies. Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64. No JSON canonicalizer, no JOSE library, no git binary, no blockchain, no DHT, no global registry or directory service." This says implementable from a language's standard library; the list may be examples of what standard library has? Many languages don't have Ed25519 in stdlib. Python's hashlib has SHA-256 but not Ed25519. So perhaps they mean "with a standard library plus these primitives"? It says "from a language's standard library: Ed25519, SHA-256..." This is weird. Maybe they mean the only cryptographic primitives allowed are Ed25519 and SHA-256. But they ask encryption construction, so must build encryption from those? You can't build public-key encryption from Ed25519 alone. Maybe they expect using Ed25519 to sign and X25519 for DH as part of the same primitive? Could treat "Ed25519" as shorthand for Curve25519. But they explicitly mention Ed25519 only. Hmm.

Let's re-read: "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." Maybe "standard library" in the sense that these are acceptable dependencies? But Ed25519 is not standard library in most. Maybe they mean no exotic deps; Ed25519 and SHA-256 are small enough to implement, and supposed to be in the language's standard library? The wording is ambiguous.

We need deliver a design. We can specify X25519 + HKDF + AES? The brief says no deps but we can say "uses X25519, ChaCha20-Poly1305, which are implementable from the same small Curve25519 and SHA-256 primitives." That might be okay. To be safe, maybe avoid ChaCha20 by using HMAC-SHA256 stream cipher, so only X25519 + SHA-256 + HMAC. But X25519 still extra. We can say X25519 is the encryption counterpart of Ed25519; implementers already need Curve25519 arithmetic for Ed25519; it's a small addition. That aligns.

Let's consider standard libraries: If someone has Ed25519, they likely have X25519? Python's cryptography lib not stdlib. In Rust, ed25519-dalek includes x25519? Not necessarily. A weekend implementer could implement X25519. The size: X25519 is about 20 lines if using field arithmetic? But if implementing Ed25519 from scratch, it's big. The brief wants weekend implementer; maybe they assume using a library for Ed25519? But "no dependencies" says no. Hmm.

I think design can specify cryptographic primitives as:
- Ed25519 for signatures.
- X25519 for ECDH.
- HKDF-SHA256 for key derivation.
- ChaCha20-Poly1305 for AEAD (or a SHA-256-based AEAD if you want fewer primitives). 
This is reasonable, and note implementers can use any library providing these; the protocol itself has no other deps.

Need perhaps define a custom AEAD using SHA-256 to avoid ChaCha20. But ChaCha20-Poly1305 is simpler to implement and standard. The brief said no dependencies, not no cryptographic algorithms beyond listed. I'd choose X25519 + ChaCha20-Poly1305 for concrete security, but mention if you want to reduce primitives, use HMAC-SHA256-CTR.

However maybe to satisfy "standard library": define AEAD as `crypto_secretbox`? That's NaCl, not stdlib. Hmm.

Could define an AEAD that uses **HMAC-SHA256** and **XOR with SHA-256 keystream**, because SHA-256 is explicitly allowed. Let's outline:

**AeadEncrypt(key, nonce, plaintext, aad)**:
- `k_enc = HKDF-SHA256(key, nonce, "enc")`? Actually HKDF-Extract/Expand.
- `k_mac = HKDF-SHA256(key, nonce, "mac")`.
- For i from 0: `block = SHA256(k_enc || nonce || uint32_be(i))`
- `ciphertext = plaintext XOR block`
- `tag = HMAC-SHA256(k_mac, aad || nonce || ciphertext)` (first 16 bytes maybe)
- Return `ciphertext || tag` or separate.
This is secure if SHA-256 is a PRF. It's nonstandard and maybe an "intellectual point" but fine. But implementers need HMAC (easy). The brief explicitly permits SHA-256. This avoids ChaCha20. However cryptographic review might be concerned: SHA-256 as keystream in counter mode is okay but slower. For small content, fine.

But for key wrapping with AEAD, the slot plaintext is just 32 bytes. We can use this custom AEAD.

Should we call it "S2AEAD"? Need specify enough details.

Alternatively use **HMAC-SHA256 for both encryption and authentication**:
- Use the counter mode as above; include nonce and AAD. 
- Use a constant `info` for domain separation.
- Keys derived from CEK via HKDF-SHA256:
  - `enc_key = HKDF(CEK, info="encryption")`
  - `mac_key = HKDF(CEK, info="mac")`
But HKDF itself uses HMAC. Fine.

Let's ensure nonce uniqueness: random 16-byte or 24-byte nonce. We can use random 12-byte? For SHA-256 counter mode, random 16 bytes is fine.

Maybe we can define `X25519` key agreement, then use `HKDF-SHA256` to output two 32-byte keys. This is simple.

Let's define:

**Key derivation**:
- `HKDF-SHA256(ikm, salt, info, length)` standard RFC 5869.
- `derive_keys(shared_secret, ephemeral_pub, recipient_pub, context)`:
  - `okm = HKDF-SHA256(ikm=shared_secret, salt=context, info="<protocol>/slot" || ephemeral_pub || recipient_pub, length=64)`
  - `slot_enc_key = okm[0:32]`, `slot_mac_key = okm[32:64]`

**AEAD** (custom):
```
Encrypt(enc_key, mac_key, nonce, plaintext, aad):
  for i = 0..ceil(len(P)/32)-1:
    keystream[i] = SHA256(enc_key || nonce || uint32_be(i))
  C = P XOR keystream
  tag = HMAC-SHA256(mac_key, aad || nonce || C)  // truncated to 16 bytes
  return C, tag
Decrypt verifies tag constant-time.
```
Need include protocol version/domain separation in nonce or AAD to prevent cross-protocol.

This is implementable from SHA-256 and HMAC. It is not standard but meets constraints.

But maybe we should not invent crypto; we can state "If your standard library includes XChaCha20-Poly1305, use it; otherwise the following SHA-256 AEAD is defined." Hmm. The design brief likely appreciates minimal and concrete. We can choose `ChaCha20-Poly1305` and mention `HMAC-SHA256` alternative if ChaCha20 unavailable. But the final answer should be definitive.

Given the priorities #1 no deps beyond Ed25519, SHA-256, HTTP, JSON, base64, I will define the AEAD using HMAC-SHA256 and SHA-256 counter mode. That uses exactly SHA-256. We still need X25519, but that's part of the Curve25519 primitive. If implementer has Ed25519, they can implement X25519 with same field. Hmm.

Could we avoid X25519 by using **RSA-like?** No. X25519 is necessary for public-key encryption. We'll include it.

Let's specify `X25519` as a primitive. The brief didn't list it but it's the standard encryption counterpart of Ed25519. I'll justify: "An Ed25519 implementation already contains the field arithmetic; X25519 is a scalar-multiply on the same curve."

Now, recipients addressing without publishing audience:
- Slots contain no recipient identifier. To hide audience size, pad to a fixed number. Define slot count fixed to `SLOT_PAD = 16` (or 32). The sender generates real slots for each recipient, then dummy slots for padding.
- Dummy slot construction: Generate an ephemeral X25519 keypair and encrypt a random CEK? Actually a dummy slot must be indistinguishable from a real slot. Generate a random ephemeral key and a random ciphertext of the same length (or encrypt a random 32-byte plaintext with a random key derived from scalar with itself? The recipient's trial will fail). Better: Encrypt a random 32-byte plaintext under a random key to produce a valid-looking slot; no recipient can decrypt. Or simply create slot with random `ephemeralKey` and random `ciphertext`/`nonce` of correct lengths; trial decryption will fail. But a distinguisher might notice if ciphertext is not valid AEAD under ephemeral key. Since hub doesn't know the private key, it cannot tell. But to be safe, generate ephemeral key and encrypt random plaintext with a derived key from X25519(ephem_priv, random_pub) or even from the CEK? The slot ciphertext must not decrypt with recipient keys. Use a random key. We'll define: for dummy slot, generate ephemeral X25519 keypair, compute DH with a random one-time public key, derive slot key, encrypt 32 zero bytes? Then no real recipient can decrypt; it is a valid AEAD. The hub cannot distinguish.
- All slots have identical fields.
- The actual CEK for content could be one random 32-byte. Real slots encrypt CEK. Dummy slots encrypt random bytes. Recipients try each; only real ones yield CEK. But if a dummy slot accidentally decrypts? AEAD auth prevents.
- How does recipient know CEK is correct? AEAD tag verifies. Once decrypted, they get 32 bytes. Then attempt to decrypt outer ciphertext? Need also an explicit check. We can include a **CEK confirmation** value in the outer metadata: e.g., `cekCheck = HMAC(CEK, "cek-check")` but that would help a recipient verify CEK before decrypting content. However a hub could brute force? CEK random 256-bit, no. We can include `cekCheck` so recipient can identify correct slot: each decrypted slot plaintext is CEK (32 bytes), but there are many slots. To know if decryption succeeded, AEAD tag already tells. So no need. But if AEAD tag verifies for dummy? no.
- Recipient's app stops after first successfully authenticated slot and uses the plaintext as CEK.

Need hide number of recipients: fixed SLOT_PAD. But if always 16, that's overhead for private messages (16 slots * ~48 bytes = 768 bytes). Fine. For small families maybe 16 enough to hide audience size. If a message has >16 recipients, use multiple messages or increase. We can set SLOT_PAD = 32? Flat per-identity cost? 10k users on hub, private items maybe many. 16 slots per private item overhead ~1KB. Acceptable. Let's choose 16.

Need maybe include an `audienceHint`? No, that would leak.

Hub learns:
- The author/sender (outer metadata includes author).
- The item's creation time, size, number of slots (padded constant), and because slots are fixed count, not recipient count.
- It does not learn recipient identities or content.
- It learns when a reader fetches the item but not whether they decrypted.

Now public/private interplay with replies/reactions:
- Reply is a post with `replyTo` content ID. For public, `replyTo` public post ID.
- For private, reply plaintext includes `replyTo` private item's outer content ID and maybe `audience` copied from original. The reply is encrypted to the same audience (or subset). The hubs store it on the reply author's hub. Cross-hub: B's hub stores B's encrypted reply. A's reader needs discover B's reply. How? If A and B are family, A's app follows B? Maybe the thread is distributed. For private content, there is no central thread. A's reader could poll B's encrypted feed, decrypt B's reply. Or B could copy the reply to A's hub? The hub can't decrypt, but B can upload to A's hub if authorized? Hmm.
- In scenario 3: A on a.example, B on family.example. A makes family-only post. B replies and reacts cross-boundary. How does A see B's reply? A's app needs fetch from B's hub or B's reply needs to be stored somewhere A's app already polls. If A and B follow each other, A polls B's encrypted feed. But the reply is encrypted to A (and others), so A can decrypt. Good. No hub ACL.
- A's original private post on A's hub; B's app polls A's encrypted feed, decrypts. B's app replies by publishing a private reply on B's hub, encrypted to the same audience. A's app polls B's encrypted feed, decrypts reply. Cross-hub works. No access-control agreement.

Reactions similarly: a private reaction object signed by B, encrypted to audience, stored on B's hub. A polls B's encrypted feed.

Need define types:
- `post`: a post.
- `reply`: could just be a `post` with `replyTo`. It can be public/private.
- `reaction`: JSON `{type:"reaction", author, created, target: content-id, emoji: "❤️"}` signed/encrypted.
- `profile`, `keydoc`, `recovery`.

Need define object IDs.
Could use content ID = SHA-256 of outer SignedObject payload bytes. Let's formalize:
- For any stored item, the `id` is `sha256-<base32(payload_bytes)>`. The hub stores at `/items/<base32>.json`.
- The SignedObject for public/private includes `payload`. The hub computes ID from payload. It can serve at that ID. The feed lists IDs. 
- For a private item, the outer payload is the private metadata, so ID is hash of that.
- For a public post, outer payload is the post JSON, so ID is hash of content. This is content-addressed; the host cannot change the served content without changing ID, but the ID is in URL. The host could serve a different object at same ID? Then computed hash mismatches; reader rejects.

Need note: Base32 encoding for IDs to be URL-safe. Define alphabet `a-z2-7` no padding. Or use base64url. For readability? Not important. Let's use base32 lowercase no padding of raw SHA-256. Prefix `sha256:` maybe; in URLs use `sha256:<base32>`. But URL path could include colon; fine. Simpler: `id = "sha256:" + base32(SHA256(payload_bytes))`. 

For feed URLs, `feed.json` items have `id` and `url` to `/items/<id>.json`.

Need define profile/hub discovery:
- A "person URL" can be `https://hub.example/p/<root>` or `https://hub.example/.well-known/person/<root>`.
- Root ID is `ed25519:<base64url(root_pub)>`. For URL path, use the base64url without prefix or with `ed25519_`? To avoid `/` and padding, base64url no padding. We'll define a compact ID string: `u` + base64url? Maybe use `ed25519:` prefix in JSON but URL path uses base64url (e.g., `abc...`). 
- Well-known: `GET /p/<rootKeyB64>/key.json` and `GET /p/<rootKeyB64>/profile.json`. The root key b64 is URL-safe.
- Profile includes `hubs` array and `base` URLs. A reader that has a root ID but no hub can try hubs from last known profile; no global registry.

Need sequence numbers:
- Key document: root signs with `seq` integer. The active key with highest `seq` seen wins. Host cannot create new keydoc without root.
- Profile: active signs with `seq`. Higher seq wins for hubs/name.
- Content: signed `created` timestamp. Could include a per-author monotonically increasing `serial`? If we want host cannot serve old posts as latest. Timestamps can be trusted (signed). But clock skew? We can use `seq` per author for each post? If posts have `seq`, a malicious host can serve old seq as newer? It can't change seq, but if reader sees seq 10 from new hub and seq 9 from old hub, marks old stale. Similar. We can include a `seq` in posts as well. Let's define each content item has `seq`: integer increments per author. Then feed can show `seq`. A hostile host can serve old seq; if reader knows newer seq from another copy, it detects. If not, no. But timestamps suffice. For thread, maybe `created`.

Need prevent host from altering/backdating: signature over `created`.

Now scenario walk-throughs.

Let's write architecture one page first in final. Then identity primitive. Then assurances. Then scenarios. Then key change/recovery. Then encryption construction. Then cost sheet. Then cut.

Need be careful to not be too long but as long as needed. Desired oververbosity 5; user asks as long as needed. We can provide detailed design.

Let's plan final structure:

1. Architecture one page.
2. Identity primitive.
3. Floor assurances delivery.
4. Scenario walkthroughs (1-4 maybe also 5/6/7 briefly).
5. Key change and recovery.
6. Encryption construction.
7. Honest cost sheet.
8. What would cut.

Let's design in more detail.

### Architecture details

**Entities and artifacts**:
- **Identity root key** (`R`): Ed25519 public key; string `ed25519:<b64>`. Stable ID of person. Private root seed generated on device and not stored on hub; encrypted to recovery agents.
- **Active signing key** (`S_pub`): Ed25519 public key delegated by root. Private on user device(s). Signs all daily content and profile.
- **Active encryption key** (`E_pub`): X25519 public key delegated by root. Private on user device. Used by others to encrypt private items to this person.
- **Key document** (`keydoc`): signed by root. Binds root -> {active signing key, active encryption key, seq}. Stored at hub.
- **Profile**: signed by active signing key. Contains display name, hubs, feed URLs, seq, bio. Stored at hub.
- **Content objects**: `post`, `reaction`, `reply` (post with replyTo). Signed by active signing key. Public objects served as SignedObject. Private objects encrypted as PrivateEnvelope then signed as SignedObject.
- **SignedObject**: `{payload: base64url(bytes), signature: base64url, signer: "ed25519:..."}`. The bytes are UTF-8 JSON. The signature is Ed25519(signer, payload_bytes). To verify: decode payload, check signature. The payload JSON may contain its own `author` field and `signer`; if it does, must match.
- **PrivateEnvelope**: outer signed object whose payload is private metadata: `{type:"private", author, created, seq, nonce, ciphertext, slots}`. The ciphertext is encrypted inner signed content. `slots` are key slots.
- **Feeds**: `feed.json` (JSON Feed of public posts) and `encrypted-feed.json` (list of private item IDs). Hubs may also generate RSS/Atom.

**URLs on a hub**:
- `GET /p/<root-b64>/key.json` -> SignedObject keydoc
- `GET /p/<root-b64>/profile.json` -> SignedObject profile
- `GET /p/<root-b64>/feed.json` -> JSON Feed public
- `GET /p/<root-b64>/encrypted-feed.json` -> `{version:1, items:[{id, url, created, seq}]}`
- `GET /p/<root-b64>/items/<id>.json` -> SignedObject post/private
- `PUT /p/<root-b64>/items/<id>.json` with SignedObject for publishing
Maybe include `/inbox`? No, hub dumb.

**First contact**:
- Reader receives a person URL `https://hub/p/<root>` or root ID + a hub.
- Fetch keydoc, verify root signature. Fetch profile, verify active signing signature. Get active signing/encryption keys, hubs, feed URLs.
- Reader subscribes to feeds.

**Poll**:
- Poll public feed for public posts; verify signatures.
- Poll encrypted feed; fetch each private item; try slot decryption using reader's encryption private key; if one slot decrypts, decrypt inner signed content and verify active signature. If not, ignore.

**Publishing**:
- Author creates post JSON, signs with active signing key -> SignedObject. For private, constructs inner SignedObject, encrypts to recipient encryption keys, then signs outer metadata with active signing key -> SignedObject. PUT to own hub(s). Hub stores and updates feeds.

**Signature details**:
- SignedObject payload is base64 of exact UTF-8 JSON bytes. Signatures over those bytes. The outer wrapper fields not signed except payload; this avoids canonicalization.

Need mention no JSON canonicalizer because the signed payload is a byte string; the JSON wrapper is just carrier. Hub can re-encode outer wrapper as long as payload, signature, signer strings remain. Actually if hub reorders outer fields, the payload base64 string remains. But verify uses the string value. Fine.

### Identity primitive section

Argue: person = root Ed25519 public key.
- Host cannot speak for you because only root/active private keys can sign; root private never on hub; active private never on hub.
- Host cannot keep you because root ID is independent of hub; active private key and content copies are on device; profile can be re-published at new hub.
- Stable across domain loss; domain is just locator.
Alternatives rejected:
- Email/domain identity: host can take over, domain can expire, no cryptographic binding.
- Human name: no uniqueness, no proof.
- Central registry: violates no dependency.
- PGP-style key fingerprint: essentially same but key management and UI. We choose Ed25519 because small signatures, simple.

Need mention active signing/encryption keys delegated by root, so root can revoke them.

### Floor assurances

1. **Host cannot speak for you.** Mechanism: All content signed by active signing key; active key delegated by root via keydoc signed by root. Private keys never on hub. Host can serve old signed objects but cannot create new valid signatures. Reader verifies keydoc -> profile -> content chain. Failure mode: If root private leaked/stolen, host could sign as you. Mitigation: root kept off device, encrypted to recovery agents; revocation via root.

2. **Host cannot read private content.** Mechanism: End-to-end encryption. Content encrypted with random CEK using AEAD. CEK is encapsulated to each recipient's X25519 encryption key in unlabeled slots. Hub has no recipient private keys. Hub sees only ciphertext and padded slots. Failure mode: If recipient encryption key compromised, or if sender encrypts to wrong key (e.g., due to forged profile with old but valid active key), hub/attacker might read. But host cannot decrypt as it doesn't have keys. Need maybe host as family member with legitimate credentials cannot read private DMs? If host is in audience? Brief says no confidentiality mechanism defeats someone inside audience. So if host is a recipient, they can read. Assurance says "Content addressed to chosen people is unreadable by anyone else, host included." If host not recipient.

3. **Host cannot keep you.** Mechanism: Identity root key and active key are on user's device (active; root recoverable). User's content is signed and stored on device (app keeps a copy). To leave, user PUTs profile and content to a new hub; signs profile with new hub URL and higher seq. Host cannot remove or alter. Readers who see new profile treat old hub as stale. Failure: If user loses device and no recovery agent, or hostile host withholds old content (but user has copy). The floor says "key and copy always on your device"; app must maintain local copy.

4. **Cross-hub first-class.** Mechanism: Identity is key, hubs are dumb stores. Private items are encrypted to recipient keys, not hub ACLs. Any recipient can poll any hub's encrypted feed and decrypt. Replies/reactions are stored on their author's hubs and encrypted to same audience. No hub-to-hub agreement. Public JSON Feeds interop. Failure: Discovery of new hubs can be hard without a directory; profiles and contact lists provide hints.

Need maybe say availability not guaranteed.

### Scenario walkthroughs

**1. Divorce**: Woman's root/active keys on her phone; hub is ex's server. He can't post (no keys). He can't read family-only posts (encryption). He can't alter/backdate (signatures). She leaves: installs app on new hub, signs profile seq+1 with new hub URL, copies all signed content. Her mother's app gets new profile via one tap (or sync), sees higher seq; when it later polls old hub, it sees lower seq stale and ignores. His frozen copy reads as stale (lower seq) because mother's app knows higher seq. Even if he serves old content, it's signed by her and old timestamp; not new.

**2. Grandma onboard**: App generates root key and active key, plus recovery record encrypted to daughter's encryption key. Root private deleted after backup. She picks name. Phone lost. She calls daughter. Daughter's app opens recovery record (stored locally or fetched from hub), decrypts root seed with daughter's private encryption key, generates new active key, signs new keydoc with root (seq+1), revokes old active, provisions grandma's new phone. Grandma is back. Hostile hub could not read recovery record or use it. (Need daughter's app to have permission; maybe if daughter not present initially, the app sends her a recovery request later.)

**3. Two hubs, one thread**: A posts private family-only post on a.example encrypted to family (including B). B's app polls A's encrypted feed, tries slots, decrypts, verifies. B replies from family.example: plaintext reply includes replyTo A's private item ID and audience family; encrypts to family; publishes on family.example. A's app polls B's encrypted feed, decrypts reply. A's reaction likewise. Hubs never need ACL agreement. Both see same thread via IDs.

**4. Domain goes**: Identity root keys unchanged. Each user signs a new profile with new hub URLs and higher seq. Since profiles may be stored on other hubs or sent to contacts, existing readers fetch the new profile. Old domain gone; but if a reader only knew old domain and had no other hub/contact, it may fail. We can say protocol cannot find a moved person without some hint: the new profile must reach the reader via any hub, email, message, or a cached profile containing multiple hub URLs. To meet scenario, the app should mirror profiles and feeds to at least one other hub or contact; the new profile's higher seq supersedes old. Existing readers that have the person in their contact list can get the update from a mutual contact? Hmm, need design maybe include "contact list as gossip" or "profile mirroring".

Let's rethink scenario 4 and discovery. We need existing readers find them. We can add a mechanism: Each profile contains a list of `hubs` where the person currently publishes. When a user moves, they update their profile on multiple hubs. But if only family.example and it goes, there's no existing hub to update. However before the domain goes, they might have had a profile listing only family.example. When they move, family.example is gone; they need tell readers somehow. The scenario says "Everyone moves. Nobody's identity changes. Existing readers find them." We can design that profiles are mirrored to **contacts' hubs** as a standard part of following. For example, when B follows A, B's app stores a copy of A's profile and periodically fetches it. If A moves and family.example goes, A can publish her new profile to B's hub? But A may not have write access to B's hub. B's hub is dumb but could allow A to PUT her signed profile? Hmm.

Maybe each person's own hub is not special. A can publish her signed profile to any dumb hub that allows PUT. If family.example goes, she publishes new profile on new.example. But B's reader only knows old family.example. It cannot find new. Unless B's reader has a **contact record** containing A's root ID and a list of hubs, and the app periodically tries all. If no new hub, no.

Could use a **signed profile document** embedded in an email? Out of band. But scenario says existing readers find them, maybe there is an out-of-band one tap? They may see a new URL from the person. We can design a **portable contact link** that includes root ID and one or more hub hints; when domain goes, the person can send a new link to existing readers. But "existing readers find them" automatically? Not necessarily.

Maybe use DNS domain as a locator, but domain gone. Could keep identity independent and use a **well-known URL on a stable domain**? No global.

Maybe use **web F2F**: readers' apps can store a "follow" as a query to a search service? Not allowed.

Maybe we can use **the person's own contacts as resolvers**: When A moves, her new profile can be broadcast to a few close contacts (e.g., mother, B) via their hubs. B's app, when it notices old hub failing, can ask its contacts' hubs if they have a newer profile for A. This is a gossip over explicit contacts, no global directory. Is that allowed? No DHT, but small group contact graph is fine. Let's design a minimal **contact directory**?

Design a `contacts.json` signed by active key? It lists people you follow and their current profile/hubs. When A moves, she can send her new profile to B (maybe through a direct message or B's hub). B's app stores it. If family.example goes, B's app already has A's new profile before/after? A can publish a message to her followers via their hubs? Maybe.

But the brief says "two hubs, one thread" no access-control agreement, but not necessarily gossip. Let's not overengineer. We can state: Discovery after a domain loss is inherently out-of-band; the protocol ensures identity unchanged and signed profile with higher seq can be served from any hub. To make existing readers find them automatically, apps should keep multiple hub hints and contacts. The floor doesn't include availability discovery. But scenario 4 expects. We need satisfy.

Maybe use **signed profile in a URL**? People can share a link with new domain; existing readers who click/import find them. The phrase "existing readers find them" could be via re-sharing a URL, not automatic. Hmm.

Let's think of a mechanism with no global directory but automatic:
- Each identity has a stable **root key**. Readers follow by root key. To fetch updates, they need a locator. If the locator (domain) fails, they can't. But they might have the author's **profile** cached, which includes a `hubs` list. If the author published a new hub URL before domain went, readers get it. But if domain goes unexpectedly, no. Users can set up a second hub as backup (a relative's box) and profile lists both. Then readers can try old and backup. The scenario says "family.example becomes unaffordable. Everyone moves." If before losing domain they configure new hubs and update profiles, readers that poll before domain goes get new hubs. If not, they need out-of-band.

The design can require that a person's profile lists at least one **mirror hub** not on the same domain. Then if one domain dies, readers can fetch from mirror. That's not a global registry; just a second hub. The "domain goes" scenario can be survived if users have a mirror. For families/small groups, maybe one relative's hub mirrors. We can include "hubs are mirrors; the app can mirror profile and items to any accepting hub." This seems necessary for availability.

Let's include: Profiles have `hubs` array; the app on first setup can mirror to one or more hubs. The domain going is liveness, not identity. Existing readers find them if they have any current hub hint; otherwise they need out-of-band. This is honest. We can mention in walkthrough.

But the design brief wants "existing readers find them" not necessarily automatically without any hint. We'll write: "The protocol provides the primitive: a signed profile with a higher seq pointing to the new hub. If the old domain is gone, any reader with a cached mirror or shared new link finds them; the identity is unchanged. The app should mirror profiles to at least one secondary hub for automatic failover."

Maybe good enough.

**5. Big lazy hub**: Commercial hub with 10k users hostile at scale. Because hub is dumb and sees only encrypted/signed blobs, per-identity cost flat: store/serve bytes, no ACL, no per-identity decryption. Host cannot mass-decrypt private content or forge; it can only withhold service. A hostile operator at scale gains no more than a small one. The hub's per-identity cost is just storage/serving of feeds and items.

**6. Weekend**: The protocol is simple: Ed25519 signatures, X25519, HMAC-SHA256, JSON, HTTP. A publisher can be written in a weekend; a reader also; hub is just static file server with PUT/GET. We need specify endpoints.

**7. Stranger**: Public posts are in JSON Feed/RSS; a stranger's ordinary feed reader sees them. Mastodon bridge reads JSON Feed. After author's key loss, they re-meet the author (new key) because total key loss continuity is non-goal. They can follow new key.

### Key change and recovery

Need detail rotation, loss, theft, contested departure.

**Rotation**:
- Root key can sign a new keydoc with higher seq delegating new active signing/encryption keys. This is done when device lost or suspected compromise. Old active key's signatures before the revocation remain valid for old posts but are no longer current. New posts use new active key. Readers that see keydoc seq N reject posts signed by keydoc seq < N after they know N.
- Root key itself cannot be rotated without changing identity. Since identity = root key, total root key loss is identity loss (non-goal). If root key is compromised, attacker can sign new keydocs; there is no cryptographic way to recover. Pre-signed recovery agents can freeze? If attacker has root, they can also revoke? No.

**Loss**:
- Root key private is encrypted to recovery agents in the recovery record. If device lost, user contacts agent(s); agent decrypts root seed; user generates new active key and keydoc, revoking lost active. If only active key lost but root safe, same.
- If no recovery agents and root deleted, identity lost. Non-goal continuity across total key loss.

**Theft**:
- If active key stolen but root safe: user recovers root, signs a new keydoc with higher seq, revoking stolen active. Anything the thief signs after revocation date is rejected by readers who see new keydoc. Before revocation, there is a window.
- If root key stolen: catastrophic. The thief can sign new keydocs and impersonate. The only mitigation is social: contacts can be told out-of-band, but no cryptographic revocation because the root is the identity. This is a limitation; we can say root should be kept offline and encrypted to agents.

**Contested departure**:
- Scenario: hostile operator claims the departure is forgery. Woman signs new profile with new hub and higher seq. Host serves old profile with lower seq. The old profile is signed by her, so it verifies. Readers use the highest seq they have seen. If they have seen the new profile (via a mirror/contact), they mark the hostile copy stale. If they only see the hostile copy, they cannot distinguish stale from current; no protocol can solve this without a trusted witness or additional channel, because the old profile is a valid signed statement. We can say the hostile host cannot produce a higher seq forged profile, so once the reader has the new profile, the contest is decided. The departure's signed sequence number is the mechanism. Need maybe include a `supersedes` or `revokes` list.
- Old posts remain valid as her old posts; they are not forgeries. The hostile operator may serve them as current, but readers with new profile know her current hub and ignore stale feeds.

Need also discuss key doc seq separately. A higher keydoc seq revokes old signing key. A thief with old active key cannot forge after revocation.

### Encryption construction details

Let's write precise.

**Primitives**:
- Ed25519 sign/verify.
- X25519 ECDH.
- SHA-256, HMAC-SHA256, HKDF-SHA256.
- Custom AEAD `Aead` based on SHA-256 and HMAC.

Define `base64url` and `base32`.

**Key generation**:
- Root key: Ed25519 keypair; public `root_pub`; private seed `root_seed` (32 bytes). ID string `ed25519:<b64url(root_pub)>`.
- Active signing key: Ed25519 keypair; public `sign_pub`; private `sign_seed`.
- Active encryption key: X25519 keypair; public `enc_pub` (32 bytes); private `enc_priv` (32 bytes).

**Keydoc**:
Payload JSON:
```
{
  "type": "keydoc",
  "root": "ed25519:...",
  "seq": 1,
  "signingKey": "<b64url(sign_pub)>",
  "encryptionKey": "<b64url(enc_pub)>",
  "created": "ISO8601"
}
```
Signed by root using SignedObject.

**Key derivation for slots**:
- Let `context = "example-protocol/v1"` (ASCII bytes).
- For each recipient with X25519 public `R`:
  - Generate ephemeral X25519 keypair (`e_priv`, `E_pub`).
  - `dh = X25519(e_priv, R)` (32 bytes).
  - `okm = HKDF-SHA256(ikm=dh, salt=context, info="slot" || E_pub || R, length=64)`
  - `slot_enc_key = okm[0:32]`, `slot_mac_key = okm[32:64]`
  - `slot_nonce = random 16 bytes`
  - `slot_ciphertext, slot_tag = AeadEncrypt(enc=slot_enc_key, mac=slot_mac_key, nonce=slot_nonce, plaintext=cek, aad=outer_nonce || E_pub || R)`
  - Slot JSON: `{"eph": b64url(E_pub), "nonce": b64url(slot_nonce), "ct": b64url(slot_ciphertext || slot_tag)}` (or separate tag)
- Dummy slots: same, but generate random `cek_dummy`, use random `R_dummy`? Wait for dummy, recipient key `R_dummy` is a random X25519 public key. Compute `dh = X25519(e_priv, R_dummy)`; derive keys; encrypt random 32 bytes. No one can decrypt. The slot looks identical.
- The outer private metadata contains `slots` array of fixed length `SLOT_PAD = 16`.

**Content encryption**:
- Inner signed content is a full SignedObject JSON string `inner_bytes`.
- Generate random `cek` (32 bytes), `nonce` (16 bytes).
- Derive content keys from CEK with HKDF:
  - `okm = HKDF-SHA256(ikm=cek, salt=context, info="content", length=64)`
  - `content_enc_key = okm[0:32]`, `content_mac_key = okm[32:64]`
- `ciphertext, tag = AeadEncrypt(content_enc_key, content_mac_key, nonce, inner_bytes, aad=outer_metadata_excluding_ct?)`.
Need be careful with AAD binding. The outer metadata includes `author`, `created`, `seq`, `nonce`, `slots`. But the ciphertext is inside outer metadata; can't include ciphertext in AAD itself. We can use AAD = `author || created || nonce` (the outer nonce). The slot encryption uses `outer_nonce` as AAD to bind slots to the same outer nonce/author. Let's define:
- `outer_nonce = random 16 bytes` (separate from content nonce? Could use same? Use content nonce for content AEAD; slot encryption AAD includes outer nonce).
- Outer private metadata:
```
{
  "type": "private",
  "author": "<root>",
  "created": "...",
  "seq": 123,
  "nonce": "<b64url(outer_nonce)>",
  "ciphertext": "<b64url(ciphertext || tag)>",
  "slots": [...]
}
```
The content AEAD AAD can be `author || created || seq || nonce` (outer nonce). The slot AEAD AAD can be `outer_nonce || E_pub || R` to bind slots to the same outer nonce and prevent swapping slots between messages. The outer metadata is then signed by active signing key, so all fields bound.
- For content AEAD, nonce should be unique; we use `content_nonce` maybe included separately. The `nonce` field in outer metadata could serve as content nonce too. Since it's used in AAD, okay. Let's set one `nonce` (16 bytes) used for content AEAD and slot AAD. It is stored in outer metadata. For content encryption, use that nonce. Then no separate content nonce. The content AEAD uses nonce directly; slots bind to it.

Need clarify AAD for content: `aad = author || created || seq` (or the outer metadata fields excluding ciphertext/slots). But if `author` is root ID string, can use bytes of UTF-8.

**Recipient decryption**:
- Reader fetches private SignedObject, verifies outer signature by active signing key.
- Parses outer private metadata. Gets nonce, ciphertext, slots.
- For each slot:
  - Extract `eph`, `slot_nonce`, `ctag`.
  - Compute `dh = X25519(reader_enc_priv, eph)`.
  - Derive slot keys using HKDF with the same info.
  - Try AeadDecrypt with AAD `outer_nonce || eph || reader_enc_pub`. If tag verifies, get `cek`.
- Once CEK obtained, derive content keys with HKDF, decrypt ciphertext with AAD `author || created || seq`, obtain inner SignedObject JSON bytes.
- Verify inner signed content (signature by author's active signing key). If valid, process.

Need include `reader_enc_pub` in AAD for slot; but recipient knows their own encryption public key. Wait the sender used recipient's `R` in AAD. The recipient must use the same `R` (their public key). If they have multiple keypairs, they try each, using corresponding public key. For active key rotation, encryption key changes; old private keys may be available. If not, cannot decrypt old messages. We can recommend devices keep old encryption private keys.

The slot derivation info includes `E_pub || R`, where `R` is recipient public key. To decrypt, recipient uses `E_pub` from slot and their own public key `R`. Good.

Need include `context` domain separation. The protocol name maybe "picnic"? Let's choose a name? The design brief doesn't name it. We can call it "postcard" or "smallweb protocol". Need maybe use a string constant. Let's choose "postcard/v1" as a placeholder. But maybe avoid naming. We can use `"https://example.org/protocol"`? A string constant like `"p/v1"`.

Let's define constants:
- `PROTOCOL_CONTEXT = "smallpub/v1"` (UTF-8).

**Signature of SignedObject**:
- `payload` is base64url of UTF-8 JSON bytes.
- `signature` is Ed25519 signature over `payload_bytes` (not base64) by the signer's key.
- `signer` field identifies the public key: `"ed25519:<b64url>"`.
- For public posts, signer is active signing key; payload JSON has `"author": "<root>"` and `"signer": "<active_pub>"` maybe. Need include `signer` in payload to prevent ambiguity. Let's define payload JSON must include `signer` field equal to the public key used. For keydoc, payload includes `root` and is signed by root; the `signer` in outer wrapper is root. We can omit `signer` in payload but check outer signer. To be safe, include `"signer": "<pubkey>"` in payload. But then signed payload includes signer.

Define all content payloads include:
- `"type"`: string
- `"author"`: root ID
- `"signer"`: active signing key or root key (who signs this payload)
- `"created"`: RFC3339 UTC timestamp
- `"seq"`: integer (per identity, incremental)
For keydoc, `author` root ID, `signer` root key.
For profile, `author` root ID, `signer` active signing key.
For post/reaction, `author` root ID, `signer` active signing key.

**Sequence numbers**:
- Each identity has a single `seq` used across keydoc, profile, and content? Or separate sequences? We can define separate:
  - `keySeq` for keydoc (root-signed). 
  - `profileSeq` for profile.
  - `contentSeq` for content. 
But maybe one global seq is simpler. A single monotonically increasing `seq` signed by current active key for all profile/content; keydoc has its own `keySeq`. The hostile host can serve old profile with lower `seq`; readers track highest. Let's define:
- Keydoc has `keySeq`.
- Profile has `seq` (profile sequence). Content has `seq` (content sequence) separate. This allows profile updates without content increments.
- Host cannot alter seq due signature. If it serves old content with lower seq, and reader knows higher from mirror, stale.

Need not overdo.

### Feeds and interop

Public feed:
- `GET /p/<root>/feed.json` returns JSON Feed v1.1:
```
{
 "version": "https://jsonfeed.org/version/1.1",
 "title": "<name>",
 "home_page_url": "...",
 "feed_url": "...",
 "items": [
   {"id": "<content-id>", "url": "https://hub/p/<root>/items/<id>.json", "date_published": "...", "content_text": "...", "authors": [{"name": "..."}]}
 ]
}
```
- Hub can generate from stored public posts. Since JSON Feed is consumed by readers. For RSS/Atom, hub may generate `/feed.rss` and `/feed.atom` from same data.
- The `id` is content ID.

Private feed:
- `GET /p/<root>/encrypted-feed.json`:
```
{
  "version": 1,
  "items": [
    {"id": "<content-id>", "url": "https://hub/p/<root>/items/<id>.json", "created": "...", "seq": 123}
  ]
}
```
No plaintext. The reader fetches and decrypts. The feed itself can be generated by hub; it reveals only that the author has private items. For a hostile hub, it can omit, but cannot forge decrypted content.

Could use a signed **head** in profile to help detect stale feeds? Include profile `lastSeq` for content? Hmm. Host can serve old feed. If reader has a mirror, compare. Not required.

### The big lazy hub per-identity cost flat

The hub stores items in content-addressed flat files. No per-identity databases except feed generation. Serving is O(items). Private slots fixed 16, so cost flat per private item, independent of audience size. Host cannot do recipient filtering so no per-user inbox. Good.

### Honest cost sheet

Need identify what design bad at:
- Discovery and availability: no global directory, moving without a reachable mirror/contact can lose readers. Hostile hub can withhold updates; floor doesn't solve.
- Key compromise/root loss: total root key loss is identity loss; root theft cannot be cryptographically solved.
- Encrypted content is public ciphertext: anyone can download and try to brute force. Security relies on X25519 and AEAD; metadata (author, timestamps, message size, padded slots) leaks.
- Padded slots overhead: every private item carries 16 slots, ~1 KB overhead. For large audiences or many small private messages, inefficient.
- No traffic anonymity beyond hiding recipients; hub sees who fetches encrypted feeds.
- Custom AEAD if using HMAC-SHA256 is nonstandard and may be slower; need careful implementation.
- Sequence staleness detection only works if reader has seen newer info; otherwise stale can be served.
- Interop is one-way for public posts; replies from fediverse/Bluesky back are not provided.
- The root+active key design is more complex than it looks; implementers must handle keydoc, profile, rotation.

Least sure choices:
- Custom SHA-256 AEAD vs ChaCha20-Poly1305. I'd choose to specify ChaCha20-Poly1305 if allowed; but constraints push custom. Maybe state uncertainty.
- Fixed slot padding count (16) may leak audience size for groups >16; choose 32?
- Root+active split: may be overkill but protects theft. Could simplify to one key.

### What would cut if halve spec

- Cut root/active split; use a single Ed25519 key for identity and signing. Recovery record directly encrypts that key to recovery agents. Key theft then unrecoverable; key rotation only by signing a successor (but thief can too). This removes keydoc and active encryption key? We still need encryption key? Use Ed25519-to-X25519 conversion. Cuts a lot.
- Cut private replies/reactions? But floor requires. Could cut RSS/Atom output, keep JSON Feed only.
- Cut padded slots to no padding (leak audience size) or fixed 8.
- Cut profile seq and staleness, rely on timestamps.
- Cut custom AEAD, use ChaCha20-Poly1305.

Need align with "what you would cut if forced to halve the specification" — answer single-key identity, JSON Feed only, no padding, ChaCha20-Poly1305.

Now let's refine some details and ensure consistency.

#### URLs and path

Use root public key base64url no padding. Example: `rootb64 = base64url(root_pub)`.
Root ID in JSON: `"ed25519:<rootb64>"`.
Hub base for a person: `https://host/p/<rootb64>`.
Keydoc: `https://host/p/<rootb64>/key.json`
Profile: `https://host/p/<rootb64>/profile.json`
Public feed: `https://host/p/<rootb64>/feed.json` (JSON Feed)
Encrypted feed: `https://host/p/<rootb64>/encrypted-feed.json`
Items: `https://host/p/<rootb64>/items/<content-id>.json`

Content ID: `sha256-<base32(payload_bytes)>` maybe include prefix `sha256:`. In URL path, prefix okay. Base32 lowercase no padding. Let's define `id = "s256:" + base32(SHA256(payload_bytes))`? Simpler: `id = base32(SHA256(payload_bytes))`. Base32 alphabet `abcdefghijklmnopqrstuvwxyz234567`. No padding. String length 52. We can prefix `sha256.`? Let's choose `id = "sha256-" + base32`. Example URL: `.../items/sha256-abc...json`. Use no colon to avoid path issues. JSON Feed IDs can be `sha256-...`.

Need ensure hub can compute ID from SignedObject payload: it has `payload` base64. It decodes to bytes, computes SHA-256, base32. It can then store at that ID. The client can compute ID before PUT and PUT to that URL. The hub should verify that the URL matches the computed ID and signature? A dumb hub can verify signature? It could, but not required for storage. To prevent abuse, hub may choose to verify. But a hostile hub could store anything; readers verify.

#### Signing objects

Generic SignedObject:
```
{
  "payload": "<base64url(bytes)>",
  "signature": "<base64url(64 bytes)>",
  "signer": "ed25519:<base64url(pub)>"
}
```
- `payload` is base64url of UTF-8 JSON object.
- `signature` is Ed25519 signature over the decoded payload bytes.
- `signer` is the public key used.
- To verify: decode payload, parse JSON, check signature. Also check that `payload.signer` equals outer `signer` and `payload.author` maybe.

For keydoc, payload `signer` = root. For profile/post, payload `signer` = active signing key. The reader must know the active key from the keydoc (or from prior state). For keydoc, verify signer = root (the ID).

Profile payload:
```
{
  "type": "profile",
  "author": "ed25519:<root>",
  "signer": "ed25519:<active_pub>",
  "seq": 3,
  "name": "Alice",
  "hubs": ["https://new.example/p/<root>", "https://mirror.example/p/<root>"],
  "publicFeed": "https://new.example/p/<root>/feed.json",
  "encryptedFeed": "https://new.example/p/<root>/encrypted-feed.json",
  "created": "ISO",
  "updated": "ISO"
}
```
The `hubs` list should include base URLs. Reader uses the first reachable.

Public post payload:
```
{
  "type": "post",
  "author": "ed25519:<root>",
  "signer": "ed25519:<active_pub>",
  "seq": 42,
  "created": "ISO",
  "audience": "public",
  "text": "...",
  "media": [{"type":"image/jpeg","sha256":"...","url":"https://..."}],
  "replyTo": ["<content-id>"],
  "thread": "<optional thread id>"
}
```
For media, actual binary files (photos) are served by hub as opaque files. For private media, the image bytes must be encrypted too. Need think: Photos. Public photos can be files; post includes URL and hash. Private photos: encrypt binary and include as encrypted blob? The design scope says writing, photos, short posts. For private photos, the encrypted content could be JSON containing base64 of media? That could be large. We can define private media is encrypted as a separate encrypted blob using same CEK? Simpler: For private posts, if media is included, the plaintext JSON can include `media` with `content` as base64 of the media bytes. It gets encrypted with the post. For large photos, base64 overhead 33%, but okay for non-goal millions. Or define encrypted media blob with same CEK but separate content. For minimal, put media bytes base64 in plaintext. Public posts can use URLs.

Private plaintext post payload includes `audience` as array of root IDs and maybe `audienceSigningKeys`? The sender needs to encrypt to recipients. The plaintext includes `audience`: list of recipient root IDs, so recipients can see who was addressed. It does not publish outside because encrypted.
```
{
  "type":"post",
  "author":"ed25519:<root>",
  "signer":"ed25519:<active_pub>",
  "seq":43,
  "created":"...",
  "audience":"private",
  "to":["ed25519:<rootA>","ed25519:<rootB>"],
  "text":"...",
  "replyTo":["<content-id>"]
}
```
Need keep `audience` field maybe for public/private. Use `"visibility": "public"` or `"private"`.

Reaction payload:
```
{
  "type":"reaction",
  "author":"...",
  "signer":"...",
  "seq":44,
  "created":"...",
  "target":"<content-id>",
  "reaction":"❤️"
}
```
For private, encrypted with `to` audience.

#### Private feeding and discovery

A private item's outer private metadata includes `author`, `created`, `seq`, `nonce`, `ciphertext`, `slots`. It uses `visibility: "private"`? The outer metadata maybe:
```
{
  "type": "private",
  "author": "...",
  "signer": "...",
  "created": "...",
  "seq": 45,
  "nonce": "...",
  "ciphertext": "...",
  "slots": [...]
}
```
Signed by active key as SignedObject. The hub can list it in encrypted feed. The inner plaintext (inside ciphertext) includes the actual post/reaction. The outer private metadata doesn't say whether it is post/reaction; hub only sees private.

Content ID of private item is SHA-256 of the outer private metadata payload bytes (the SignedObject's payload). That is what appears in encrypted feed. The inner plaintext's `replyTo` references this content ID, so recipients can fetch.

#### Encryption of inner signed content

Inner SignedObject for private content:
- Take private plaintext JSON (e.g., post with `to`), serialize to UTF-8 bytes `plain_bytes`.
- Create inner SignedObject:
```
{
  "payload": base64url(plain_bytes),
  "signature": base64url(Ed25519(active_signing_key, plain_bytes)),
  "signer": "ed25519:<active_pub>"
}
```
- Serialize this inner SignedObject JSON to UTF-8 bytes `inner_bytes`. This is what is encrypted.
This means the inner signature is over the private plaintext bytes. The recipient after decryption parses the inner SignedObject, verifies the signature over its payload. Good.

Outer SignedObject:
- Build private metadata payload as a JSON object, serialize to UTF-8 bytes `outer_metadata_bytes`.
- Sign `outer_metadata_bytes` with active signing key to produce outer SignedObject.
Thus two signatures.

Could avoid double signing by signing only plaintext and relying on AEAD to protect outer slots. But hub could swap slots/ciphertext? AEAD content uses nonce and AAD, but slots not covered by content AEAD. If hub swaps slots with another message, recipient may fail to decrypt; denial of service. If hub strips slots, denial. We want integrity of slots, so outer signature is needed. Good.

#### Recovery record encryption

Recovery record is a SignedObject by root:
Payload:
```
{
  "type": "recovery",
  "root": "ed25519:<root>",
  "signer": "ed25519:<root>",
  "seq": 1,
  "created": "...",
  "threshold": 1,
  "agents": [
    {
      "agent": "ed25519:<agent_root>",
      "encryptedRoot": "<base64url of encrypted root seed envelope>"
    }
  ]
}
```
The `encryptedRoot` is a full private envelope? To avoid recursion, define a simple sealed box to agent's X25519 encryption key:
- Generate ephemeral X25519 keypair, compute DH with agent's encryption key, HKDF, encrypt the root seed (32 bytes) using AEAD. This is a one-recipient envelope:
```
{
  "eph": "...",
  "nonce": "...",
  "ciphertext": "..."
}
```
But need not use slots; can define `sealRoot` using same AEAD. To keep minimal, reuse slot construction with one real slot plus 15 dummy? Or just a slot array? For recovery record, hiding audience not needed? The record is public and lists agents anyway (agent keys!) so audience is known. Simpler: `encryptedRoot` can be a JSON object with `eph`, `nonce`, `ciphertext`, `tag`, and `agent` can be identified. It is encrypted to that agent. The root seed is encrypted with AEAD under key derived from X25519(ephemeral, agent_enc_pub). This doesn't need hidden recipient. We'll specify a helper `encryptToKey(pub, plaintext)`.
- The recovery record itself is signed by root, so host can't modify agents.
- If root private is deleted, this record cannot be updated without root, but can be used to recover root.

The agent's app should keep a copy of the recovery record locally, so it can recover even if hub withholds.

#### Contested departure and seq

Need define `seq` values:
- Keydoc has `keySeq`. When a new keydoc is signed, increment `keySeq`.
- Profile has `seq`. When hubs/name change, increment.
- Content has `seq`. Increment per content item.
Readers store the highest `seq` per identity/profile they have seen. If a hub serves a profile with seq lower than stored, mark stale. For content, feed lists `seq`; reader ignores items with `seq <= lastSeen?` But if content is fetched out of order? Use per-author seq. A hostile hub can omit items but cannot renumber. If reader sees seq 10, it knows there may be gaps, but if another hub has seq 11, stale.

Need maybe use a single `updated` timestamp in profile; seals.

#### Interop and bridges

- Public posts are in JSON Feed at `/feed.json`; hub can also serve `/feed.rss`, `/feed.atom` generated from same items. The JSON Feed contains plain text and URLs.
- Mastodon/Bluesky bridge: A bridge can read the JSON Feed and post to those networks. It doesn't need special protocol. Replies from those networks coming back is non-goal.

#### Implementation complexity

Need ensure weekend implementer can write publisher/reader from text. We'll include exact field names and crypto.

Maybe we should provide a short "byte shapes" in encryption section:
- SignedObject JSON shape
- Private outer metadata shape
- Slot shape
- AEAD tag 16 bytes.

Let's define AEAD carefully.

**SHA-256 AEAD**:
We need avoid ambiguity. Let's define `AeadEncrypt(enc_key, mac_key, nonce, plaintext, aad)`:
1. If `len(nonce) != 16`, error.
2. For `i = 0..n-1`, where `n = ceil(len(plaintext)/32)`:
   - `block_i = SHA256(enc_key || nonce || uint32_be(i))`
   - `ciphertext_i = plaintext_i XOR block_i[0:len(plaintext_i)]`
3. `tag = HMAC-SHA256(mac_key, aad || nonce || ciphertext)[0:16]`
4. Return `ciphertext`, `tag`.

`AeadDecrypt` recomputes tag and compares constant-time; on mismatch fail.
This is essentially a PRF-based stream cipher + HMAC. It is not standard but okay.

Need key derivation:
- HKDF standard:
```
HKDF-Expand(PRK, info, L)...
```
Maybe just reference RFC 5869.

For content encryption:
- Derive `enc_key` and `mac_key` from `cek` using HKDF:
`okm = HKDF-SHA256(ikm=cek, salt=PROTOCOL_CONTEXT, info="content", length=64)`
`enc_key = okm[0:32]`, `mac_key = okm[32:64]`.
- Nonce is the outer metadata `nonce`.
- AAD for content = UTF-8 bytes of `type || "\n" || author || "\n" || created || "\n" || seq`.
This binds ciphertext to the outer metadata. But `type` is "private", author, created, seq are strings.

For slot encryption:
- `okm = HKDF-SHA256(ikm=dh, salt=PROTOCOL_CONTEXT, info="slot" || E_pub || R, length=64)`
- Nonce is random 16 bytes per slot.
- AAD for slot = UTF-8 bytes of `outer_nonce || "\n" || E_pub || "\n" || R`? Need ensure same. The recipient knows `outer_nonce` from outer metadata. It knows `E_pub` from slot and its own `R`. Include `E_pub` and `R` in AAD too. The slot plaintext is `cek` (32 bytes).
- The slot `ct` field stores `ciphertext || tag` as base64url (or separate `tag`). We'll define `ct` includes tag appended.

Need include a `cek_check`? Not necessary; AEAD decrypt tells if CEK is correct. But there is a subtle issue: Multiple real recipient slots each encrypt the same CEK. A recipient tries slots; if one decrypts, it gets CEK. It then derives content keys and decrypts. If the content decryption also has an AEAD tag, it verifies. If the slot decryption produced a wrong CEK, content tag fails; but slot tag would have failed. Good.

**Dummy slots**:
- To make dummy slots indistinguishable, we can generate a random X25519 public key `R_dummy` (without knowing private) and compute DH with the ephemeral private and `R_dummy`, derive keys, encrypt random 32 bytes. Since `R_dummy` is a valid curve point? It might be invalid? X25519 public keys are 32 bytes; some invalid points can produce all-zero shared secret. For dummy, that's fine but could be distinguishable if hub checks? Hub doesn't know private. But for indistinguishability, use a random valid key. Could just use a random 32-byte string; X25519 accepts clamped scalar and any u-coordinate, may produce low-order points. Not a concern. To be safe, generate a random one-time keypair `dummy_recip_priv, dummy_recip_pub` and compute DH with its public key, then derive keys and encrypt random bytes; then use that. This is a valid slot that no real recipient can decrypt. The private dummy can be discarded. The hub cannot tell that no real recipient corresponds because slots are unlabeled.

**Slot count fixed**: We can define `SLOT_PAD = 16`. If audience > 16, create multiple private deliveries? Or increase. Better define slots count = max(16, next_power_of_two(len(recipients)+1))? That leaks if >16. For minimal, fixed 16; if more than 16, split audience into groups? That complicates. The initial audience is families/small groups; 16 enough. We can state if more, use multiple items or specify a padded count of 32/64. For big groups, maybe no. Choose 16.

**Private feed fetch**: Because slots are unlabeled, a recipient must fetch all private items from an author and try decrypting all slots. This is O(items * 16) per poll. For "many identities, not millions items per person" fine. The hub sees readers fetching encrypted feed; cannot tell which items decrypt. It may infer by fetch timing? We can recommend clients fetch entire feed and all items, maybe with delay, to avoid revealing which items are new. But not central.

#### Key assignment and profile fetching

First contact needs fetch keydoc. But if the active signing key is rotated, the keydoc URL always serves latest? The hub may store multiple keydocs. The canonical `key.json` should return the latest known by that hub. But a hostile hub can serve old keydoc. The reader fetches and verifies. If it has a newer keydoc from another hub, it can ignore. The keydoc includes `keySeq` and `created`. The hub might not host the latest if user moved; but the profile on new hub has new keydoc? Actually profile is signed by active key. If root is offline, user cannot create new keydoc on new hub? Wait if root private is deleted, user cannot sign new keydoc. But for moving hubs, she doesn't need new keydoc; she can sign a new profile with the existing active key. The keydoc remains the same. She can copy the existing keydoc to the new hub. So key.json at old and new hub can be identical; active key unchanged. If she wants to rotate active key, she needs root. So for normal move, root not needed. Good.

The profile is signed by active key; even if the active key is old but not revoked, valid. If she rotates, new keydoc.

When a reader first contacts via a URL, it may not know the root ID. The hub can serve at a human path `/@alice/profile.json`? But identity is root. We can support a **WebFinger-like**? For simplicity, a person URL can be `https://hub/p/<rootb64>/profile.json` directly; the user shares that. Apps parse rootb64 from URL. Grandma doesn't see.

Maybe for interop, a user-friendly hub can serve `https://hub/@alice` HTML with `<link rel="alternate" type="application/json" href="/p/<root>/profile.json">`. But not required.

#### Host can keep you? Content copy

The floor says "the key and a copy were always on your device." The app must store all content locally. Since content is signed/encrypted, the device has a local copy. Leaving means uploading to new hub. Good.

Need define local store? Not protocol, but requirement for hub/app.

### More on identity primitive alternatives

Let's craft convincing arguments.

- Rejected: WebFinger/email-style IDs: `acct:alice@example`. Domain owner controls resolution; hostile host can serve false profile or block. Identity changes if domain lost. 
- Rejected: DID methods with registry/blockchain: violates no global registry/dependency, complexity.
- Rejected: Content-addressed identity as hash of first post: cannot sign, no key management.
- Rejected: A bare Ed25519 key without root/active split: simpler but poor theft recovery. We selected root/active because hostile host may be a family member and stolen phone/lost phone should not mean identity theft or permanent host control.
But maybe root/active complexity maybe less minimal. We'll justify.

### Honest cost sheet details

Let's list.

**Bad at**:
- Availability: A hub can always withhold or delete content/feeds. The protocol gives integrity/confidentiality, not liveness. Mirrors and device copies are mitigations, not guarantees.
- Discovery after domain loss: no global resolution; readers need a fresh hub hint.
- Key theft of root: catastrophic; no cryptographic recovery.
- Staleness detection only with known newer seq; a reader who only trusts a hostile hub with no alternative sees stale content as current.
- Private items overhead and recipient hiding: constant padding costs bandwidth; audiences >16 unsupported without extra.
- Public interop is one-way; replies from fediverse require bridges.
- Custom AEAD if used is nonstandard; not optimized.
- Root/active split means more state and edge cases (revocation, keydoc propagation).

**Complexity hidden**:
- Sequence handling and revocation; local copy management; multiple device encryption keys; recovery UX.
- Generating JSON Feed/RSS from signed posts; media handling.

**Least sure**:
- Custom SHA-256 AEAD vs ChaCha20-Poly1305. We can say if I were writing a real standard, I would specify ChaCha20-Poly1305; here constraints push to a custom HMAC-SHA256 stream cipher.
- Fixed slot padding value. 16 is arbitrary; small groups okay, but leaks if groups larger.
- Root/active split: maybe overkill; one key would halve spec but weaken theft story.

### What would cut

If forced to halve:
- Collapse root and active into one Ed25519 key; encryption key derived from it. Recovery record encrypts that same key. This removes keydoc, root signatures, active rotation.
- Keep profile and posts signed by the same key.
- Use ChaCha20-Poly1305 for AEAD (assuming simple library) instead of custom AEAD.
- Drop slot padding to no padding or fixed 4.
- Keep JSON Feed only, drop RSS/Atom.
- Drop reactions as separate type? But floor includes reactions? Actually floor includes reply/react. Need keep reactions but could fold reaction into a post with `reaction` field.
- Simplify URLs: one well-known endpoint.

This would still deliver floor except theft recovery weaker and audience size leaks.

### Encryption construction exact steps

Let's write step-by-step for implementer.

**Sending a private object**:
1. Create plaintext JSON (post/reaction) with `to` list.
2. Serialize plaintext JSON to UTF-8 bytes `plainBytes`.
3. Sign `plainBytes` with active signing key: `sig = Ed25519_sign(active_priv, plainBytes)`.
4. Construct inner SignedObject:
   `inner = {"payload": b64url(plainBytes), "signature": b64url(sig), "signer": "ed25519:<active_pub>"}`
   Serialize inner JSON to UTF-8 bytes `innerBytes`.
5. Generate random `cek` (32 bytes) and `nonce` (16 bytes).
6. Derive content AEAD keys:
   `okm = HKDF-SHA256(ikm=cek, salt=PROTOCOL_CONTEXT, info="content", length=64); c_enc=okm[0:32]; c_mac=okm[32:64]`.
   `ciphertext, tag = AeadEncrypt(c_enc, c_mac, nonce, innerBytes, AAD = UTF8(author || "\n" || created || "\n" || seq))`.
   `ct = ciphertext || tag`.
7. For each recipient with encryption public key `R` (from their keydoc), create a slot:
   - Generate ephemeral X25519 keypair (`e_priv`, `E_pub`).
   - `dh = X25519(e_priv, R)`.
   - `okm = HKDF-SHA256(ikm=dh, salt=PROTOCOL_CONTEXT, info="slot" || E_pub || R, length=64); s_enc=okm[0:32]; s_mac=okm[32:64]`.
   - `slot_nonce = random(16)`.
   - `slot_ct, slot_tag = AeadEncrypt(s_enc, s_mac, slot_nonce, cek, AAD = UTF8(nonce || "\n" || E_pub || "\n" || R))`.
   - Slot = `{"eph": b64url(E_pub), "nonce": b64url(slot_nonce), "ct": b64url(slot_ct || slot_tag)}`.
8. Add dummy slots until total `SLOT_PAD` (16). For dummy, generate ephemeral and `R_dummy`; encrypt random 32 bytes.
9. Build outer private metadata JSON:
   `{"type":"private","author":"ed25519:<root>","signer":"ed25519:<active_pub>","created":"...","seq":...,"nonce":b64url(nonce),"ct":b64url(ct),"slots":[...]}`
   Serialize to UTF-8 bytes `outerBytes`.
10. Sign `outerBytes` with active signing key: `outer_sig`.
11. Outer SignedObject = `{"payload": b64url(outerBytes), "signature": b64url(outer_sig), "signer": "ed25519:<active_pub>"}`.
12. Compute content ID = `sha256-` + base32(SHA256(outerBytes)). PUT to `/items/<id>.json`.

**Receiving**:
1. Fetch outer SignedObject; verify outer signature over its payload. Check `payload.signer` matches active signing key from keydoc.
2. Parse outer private metadata.
3. For each slot, try:
   - Compute `dh = X25519(enc_priv, eph)` where `enc_priv` is reader's current (or old) X25519 private for the public key `R` used by sender. The reader needs know which `R` the sender used; if the reader has multiple encryption keypairs, try each. Usually current `R` is the one in their latest keydoc, but old slots may use old `R`. The slot does not identify `R`. The reader should try all known encryption keypairs.
   - Derive slot keys with `info="slot" || eph || R_pub_for_this_priv`.
   - Decrypt `slot.ct` with AAD `nonce || eph || R_pub`. On success, get `cek`.
4. Once CEK, derive content keys, decrypt outer `ct` with AAD `author || created || seq`, get `innerBytes`.
5. Parse inner SignedObject; verify inner signature over inner payload. Parse plaintext JSON.
6. Check `author` and `to` includes reader? The recipient can decide.

Need define `AeadEncrypt` returns `(ciphertext, tag)`, `ct` stores concatenation `ciphertext || tag`; `tag` length 16 bytes.

**Security notes**:
- `nonce` must never be reused with same `cek`. Random 16 bytes; probability negligible.
- Slot nonces random 16 bytes; different per slot.
- HKDF salt can be protocol context. Info binds keys.
- Ed25519 private keys for signing and X25519 private keys for encryption are separate keypairs; active keydoc contains separate encryption key. This avoids using same key for signing and DH.

Need clarify `created` is RFC3339 UTC, e.g., `2024-01-01T00:00:00Z`.

### Interop with RSS/Atom/JSON Feed

Public feed:
- The hub constructs JSON Feed from public SignedObjects after verifying? A dumb hub can serve. For RSS/Atom, same.
- The content ID in feed is the SignedObject ID.
- The `url` points to the SignedObject JSON; ordinary feed readers may not know SignedObject but can read `content_text` from feed. Good.
- For Mastodon/Bluesky, a bridge can read the JSON Feed and post as the author? To post to fediverse, the bridge needs to verify signature? It can read public JSON Feed and create posts. The feed contains name and text. No extra protocol.

### Potential issue: Public posts as JSON Feed require the hub to have plaintext. For public, yes. For private, no feed with plaintext. Good.

### Potential issue: Hubs can be dumb but still serve JSON Feed generated from public posts. A third implementer can write dumb hub that serves both. The hub needs to parse SignedObjects to generate feed. If it can't verify signatures, it can still parse payload JSON because payload is base64 JSON. It can extract `type`, `text`, `created`, `author` and generate feed. For private, it cannot decrypt inner content but can list outer metadata from SignedObject payload. It can serve encrypted-feed. It can store by content ID.

### Need specify content ID for all objects
- Public: content ID = SHA-256 of outer SignedObject payload bytes (the post JSON).
- Private: content ID = SHA-256 of outer SignedObject payload bytes (the private metadata JSON).
- Keydoc and profile don't need content IDs.

The hub can compute ID from payload. But a client computing ID before signing? It signs payload; after signing, it can compute ID. It can PUT.

### Potential issue: Re-encrypting a private item to different recipients yields different ciphertext and slots, thus different content ID. If A wants to share a private post with new people, they can send a new private item with same plaintext but new encryption. That's okay.

### Sequence and staleness more concrete:
- Keydoc `keySeq`: When root signs a new active key, increment. Readers keep highest known. If a reader sees a post signed by old active key but knows keySeq higher, reject as stale (unless it's an old item already fetched; for signatures on old posts, they remain valid as historical but not current actions). Need distinguish:
  - Old posts signed by revoked key before revocation: Should they remain valid? If a reply cites an old post, the reader may need to verify it using the old key at the time. The keydoc with higher seq revokes old key for new signatures, but old signatures made before revocation remain valid. Ed25519 signatures don't have timestamp unless payload includes created. The reader can verify an old post's payload `created` is before the new keydoc's `created`, so it may accept. For simplicity, old items already fetched remain; for new fetches, if signed by revoked key and payload timestamp before keydoc `created`, they are historical. If after, reject. Host cannot backdate because signature covers created. Good.
- Profile `seq`: Highest wins. An old profile with lower seq is stale.
- Content `seq`: Per author, no two should have same seq. Historical posts keep seq. Host can serve old seq; readers may ignore if they have seen higher from newer feed.

Maybe include `keySeq` in profile payload as well? When active key is rotated, the new keydoc has higher keySeq; the profile signed by new key should include that keySeq. Readers can bind. Let's add `keySeq` to profile? Or it can be inferred from keydoc. For profile signed by active key, if active key is revoked, profile signature invalid. So need know active key. Readers fetch keydoc.

### Potential issue: Active key rotation and old content:
- When root signs a new keydoc, old active key is revoked. But the old active key may have signed a profile that is still current? The user must sign a new profile with the new active key and higher `seq`. Readers will fetch new keydoc and new profile. Good.
- If hostile host serves old keydoc and old profile, and reader has no newer, it accepts old. But if reader knows new, stale.

### Recovery record details

Let's specify helper `encryptToKey`:
Given agent's X25519 encryption public key `R`, plaintext `P` (root seed maybe 32 bytes), produce:
```
{
  "eph": b64url(E_pub),
  "nonce": b64url(nonce),
  "ct": b64url(ciphertext || tag)
}
```
Using ephemeral X25519, HKDF info `"recovery" || E_pub || R`, AAD `"recovery" || R`.
The agent decrypts with its X25519 private key.
This is simpler than slots; but for consistency we can use the same slot mechanism with one slot. Since recovery record lists agent keys, audience not hidden. Let's define a **sealed object** format:
```
{
  "eph": "...",
  "nonce": "...",
  "ct": "..."
}
```
where `ct` includes AEAD tag.
- Derive `okm = HKDF-SHA256(ikm=dh, salt=PROTOCOL_CONTEXT, info="seal" || E_pub || R, length=64)`
- `enc = okm[0:32], mac = okm[32:64]`
- `nonce = random(16)`
- `ct, tag = AeadEncrypt(enc, mac, nonce, plaintext, aad="seal" || R)`
- `ct_field = b64url(ct || tag)`
The agent decrypts with its private encryption key `r`:
- `dh = X25519(r, eph)`
- derive keys with same info, decrypt.

Could also use this for slots, but slots need unlabeled. The slot format is similar but no `R` field.

Good.

### Formal protocol name

Maybe call it "smallpub protocol" — not necessary. Use constant string `"smallpub/v1"`.

### Final response length

Need produce long answer. We can write in sections with headings. Use concise but detailed.

Let's draft final.

Need start with maybe "I will call it X" maybe. Use "Smallpub/v1" perhaps. The design brief doesn't need a name. We can use "the protocol".

Let's ensure all questions answered:
1 architecture one page.
2 identity primitive and why, rejected alternatives.
3 four floor assurances mechanism + failure.
4 scenario walkthroughs at least 1,2,3,4.
5 key change and recovery rotation, loss, theft, contested departure.
6 encryption construction enough to implement.
7 honest cost sheet.
8 what cut.

Let's write.

Potential issue: "No JSON canonicalizer" — Our generic SignedObject signs payload bytes, but the inner payload JSON is serialized as bytes; how to ensure signature verification if JSON parser reserializes? We don't reserialize. The payload is base64 string; the verifier decodes to bytes and parses JSON only for reading, but signature is over the decoded bytes. The exact bytes are fixed by the sender. There is no need to re-serialize the JSON for signature. Good.

However the `outer private metadata` is itself a JSON object that is base64-encoded in the outer SignedObject's payload. The outer signature is over its exact UTF-8 bytes. The sender must ensure it puts the exact bytes in payload. The hub can re-encode the outer SignedObject wrapper but not the payload string. This is fine.

Need mention that JSON payloads are human-readable after base64 decode but wire bytes are not.

### Verify floor 2 with host as abusive family member inside audience?
The brief says no confidentiality mechanism defeats someone inside the audience. We need mention: If the hostile operator is a recipient of a private post, they can read it; the floor only covers "content addressed to chosen people" where host is not chosen. Good.

### Let's craft the final answer with enough detail.

I'll write in markdown.

Potential issue: `X25519` encryption key generation. The keydoc includes `encryptionKey`. The user's device stores the corresponding private key. But if user has multiple devices, how to encrypt to all? We can allow multiple keydocs? Root signs one active set at a time. Multiple devices can share same encryption private key? Could, but not ideal. For simplicity, one active device key. If user has multiple devices, they need to share active signing/encryption private keys or rotate. Not required.

### Let's write final.

Need be careful with cryptographic details:
- Ed25519 public key base64url of 32 bytes.
- X25519 public key base64url of 32 bytes.
- `signer` field in SignedObject is `ed25519:<b64url>`. For active signing key, we might also use `ed25519:` prefix. For encryption key, use `x25519:<b64url>` in keydoc.
- In content payload, `signer` field is the active signing key string.

### Detail: Key assignment payload:
```
{
  "type": "keydoc",
  "author": "ed25519:<root>",
  "signer": "ed25519:<root>",
  "keySeq": 1,
  "created": "...",
  "signingKey": "ed25519:<active_sign_pub>",
  "encryptionKey": "x25519:<active_enc_pub>"
}
```
Signed by root.

### Detail: Public post payload:
```
{
  "type": "post",
  "author": "ed25519:<root>",
  "signer": "ed25519:<active_sign_pub>",
  "seq": 42,
  "created": "...",
  "visibility": "public",
  "text": "..."
}
```
Reply:
```
{
  "type":"reply",
  ...
  "replyTo": ["sha256-..."]
}
```
Maybe just use `type: "post"` with `replyTo`. For reactions, `type: "reaction"`, `target`: content ID, `reaction`: string. The brief uses reply and react; feed readers only need posts.

Private plaintext:
```
{
  "type":"post",
  ...
  "visibility":"private",
  "to":["ed25519:<rootA>","ed25519:<rootB>"],
  "text":"...",
  "replyTo":["sha256-..."]
}
```

### Content ID string
Let's define base32 alphabet and no padding. `id = "sha256-" + base32(SHA256(payload_bytes))`. Length 52+7=59; maybe long. Use base64url? `sha256-` + base64url(SHA256(payload_bytes))` length 43+7=50. base64url alphabet includes `-` and `_`, URL-safe. Let's use base64url no padding for content IDs. Simpler. But base64url strings can have `-` and `_`; fine. Content ID: `"sha256-" + base64url(SHA256(payload_bytes))`. The base64url string length 43. Good.

Need not use base32. The priority mentions base64. Let's use base64url.

### Encrypted feed item ID
The hub serves encrypted-feed.json with `id` and `url`. For a hostile hub, it can omit items. We can also include a signed **profile field** `lastSeq` for content? Not needed.

### Hubs and authentication
Publishing to a hub requires some kind of authentication? The adversarial hub could allow anyone to PUT to any identity's container, causing garbage. But readers verify signatures, so garbage won't be accepted. However a malicious hub or third party could spam an identity's container with invalid SignedObjects. Hub should verify `signer` matches the container root? But a dumb hub may not. We can require the hub verifies the outer SignedObject signature and that the payload author matches the URL root before accepting. For a commercial hub, this is cheap; prevents some abuse. But a hostile hub can choose not to. Not floor. We can mention hubs SHOULD verify signatures before storing to avoid obviously invalid content.

But authorization to PUT: Since identity is self-certifying, anyone can PUT to their own container if the hub allows. The hub can require possession proof? Not necessary; signatures. For public posts, the author signs. For private, author signs. The hub could accept any valid SignedObject for the container. Spam can be ignored by readers if invalid. If valid spam from another key? The container root is in URL; the hub should check `payload.author == root` and `signer` chain. Since content is signed by active key delegated by root. If someone tries to use another root, hub rejects. So no account system needed; the URL itself is the identity container.

But root ID in URL is the author. The hub can verify chain and store. Good.

For profile and keydoc, the hub can verify root signatures. For content, verify active key via keydoc. If the hub doesn't, readers do.

### Grandma onboarding details

Onboarding:
- App generates root keypair. It creates a recovery record encrypted to daughter's encryption public key. But to encrypt to daughter's key, the app needs daughter's keydoc. How does it get it? Daughter may share a link/QR. The app can scan daughter's contact link. If daughter not present? The app can create recovery record later; for initial onboarding, maybe grandmas's app asks for daughter's person URL. If no, can skip and set up later. The scenario says she is never shown a key and never stores file. She calls daughter after losing phone. So daughter must have been set as recovery contact at some point.
- The app generates active signing/encryption keypair.
- Uploads keydoc signed by root, profile signed by active.
- Deletes root private after encrypting to daughter. Actually if root private deleted, how was keydoc signed? Done before deletion.
- The app stores active private keys and content locally.

If phone lost, daughter's app has recovery record. It decrypts root seed using daughter's encryption private key. It generates a new active keypair for grandma. It signs a new keydoc with root (keySeq increments), revoking old active. But how does it publish? It can PUT to grandma's hub(s). If hostile hub blocks, it can publish to a new hub. The root key is now known to daughter; she could impersonate grandma cryptographically. That's trust. Need mention.

### Theft detail:
- Root private not on phone if deleted; thief only gets active keys. Daughter recovers root, signs new keydoc revoking old active, publishes. Old active keys cannot sign new content once readers see new keydoc. There is a window between theft and revocation. If thief had root? root deleted from phone; not stolen. Good.
- If the phone is lost and found by attacker, they can post as grandma using active key until revocation. The protocol cannot prevent unauthorized posts before revocation; readers who don't know new keydoc may accept. Once revocation is seen, posts after revocation by old key are rejected.

### Contested departure:
- Suppose hostile ex claims the departure is forgery. The departure is a profile signed by active key with higher seq and new hub. The host can produce old profile with lower seq, still valid. If readers have not seen the new profile, they may believe old. But once they see new (via QR, new hub, contact), the old is stale. The protocol cannot force a reader who only listens to the hostile host to learn the truth; that's an availability/discovery issue. The cryptographic floor is: he cannot forge a higher-seq profile, cannot post as her, cannot alter old content. We can say this is the best possible without a trusted third party or global directory.

### Encryption details: Why fixed slots hides recipient count but not message size
Need mention message size leaks approximate length of plaintext; for small messages, maybe padding? The AEAD ciphertext length reveals plaintext length. We can optionally pad plaintext to a fixed block (e.g., 1KB) to hide size. But not required. The brief says no traffic-analysis resistance beyond hiding who an encrypted message is for. So content length leak okay. But fixed slots hide audience size. Good.

### The custom AEAD might be controversial
Let's maybe phrase: "If you have ChaCha20-Poly1305 available, it is the better choice; but to meet the standard-library constraint, the reference AEAD is the following HMAC-SHA256 stream cipher." This is honest and brief.

Need maybe include HKDF implementation? Standard.

Let's now compose final.

Potential issue: `HKDF-SHA256` with `ikm=dh` and `salt=PROTOCOL_CONTEXT`. If `salt` is a constant string, it's okay. In RFC 5869, salt optional. Use string as bytes.

Potential issue: The slot derivation info includes `E_pub || R`; the recipient's `R` is their public encryption key. If they have multiple private keys, they also need to know their public keys. They can store keypairs.

Potential issue: When encrypting to multiple recipients, the sender must fetch each recipient's keydoc to get their current `encryptionKey`. If a recipient is on a hostile hub, the sender might get stale keydoc. Could use the latest known from its own local cache or multiple hubs. If encrypting to stale key, the recipient may not have private key if rotated; delivery fails. The sender can retry after fetching newer. Not a confidentiality issue. Could include an outer `keySeq` field in the private metadata so recipients know which encryption key was used? Wait slots are unlabeled; if the recipient has multiple old encryption keys, they try all. But how do they know which public key `R` to use in derivation? They try each stored keypair. Good. However if the sender used a stale key that the recipient has discarded, cannot decrypt. We can recommend devices keep old encryption private keys for some time. But if active key stolen and revoked, the recipient may still keep old private key? If revoked due theft, the thief also has it; but the recipient can still decrypt old messages sent to that key. Fine.
- The outer private metadata could include a `keySeq` of the recipient keydoc used? That would leak recipient? It might reveal version but not identity. Not necessary.

Potential issue: The content AEAD AAD includes `author`, `created`, `seq`; but if a malicious hub changes the outer SignedObject payload's `signer`? That would invalidate outer signature but maybe hub could replace signature? It doesn't have active key. If it replays a different signed outer metadata with same ciphertext? The signature covers `nonce`, `slots`, etc. Good.

Potential issue: If a post is public, its SignedObject payload is the post JSON. The hub can verify Active key chain. The content ID is hash of post JSON. If a reply references it, the reply includes that ID. Good.

### Maybe include a note on media
Public photo: post payload can include `media` with `hash` and `url`. The file itself is not signed? We should sign a hash of media. The post payload includes `sha256` of media. Private photo: include base64 in plaintext; encrypted. Good.

### Let's draft final answer.

Need ensure final answer not too terse. We'll include sections exactly.

Let's begin.

---

"Protocol design: smallpub/v1" maybe.

Let's write.

Potential issue: The final answer may be too long. The user asks as long as needed. We can aim around 5000-6000 words. Need balance.

Let's create final text.

----

Let's produce final response.
```

</details>

