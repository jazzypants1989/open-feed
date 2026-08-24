---
model: qwen3.8-max
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:38:13.781Z
prompt: PROMPT-pass1.md
prompt_sha256: eab389889e055bcb32bc4532edc2183f780d8a267227464b47a9a9e220cae542
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":1606,"completion_tokens":13880,"total_tokens":15486,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":5845}}
wall_seconds: 275
truncated: false
reasoning_chars: 22507
---
# Hearthwire: A Protocol for Decentralized Personal Publishing

## 1. Architecture in One Page

There are three kinds of artifact in this protocol:

**The Identity Document.** A single signed JSON object that says "this key is this person, and right now they live at this URL." It is the root of trust. Everything else hangs from it.

**The Post.** A signed JSON object representing one act of authorship: a piece of writing, a photo, a reaction, a reply. Posts are immutable once signed. They carry a per-author sequence number that makes reordering and backdating detectable.

**The Feed.** An ordered list of posts, served by the hub over HTTPS. The hub is a dumb store: it accepts signed posts from the author's device and serves them to anyone who asks. It does not verify, does not moderate, does not transform.

**What a reader fetches on first contact:** the Identity Document at the author's hub URL. This yields the author's Ed25519 public key. The reader stores this key permanently. From this moment, the reader can verify anything signed by this key, from any URL, forever.

**What a reader fetches on a poll:** the Feed at the author's hub URL. Each post is verified against the stored key. New posts (higher seq than last-seen) are ingested. Encrypted posts are attempted for decryption. The reader never asks the hub for permission or interpretation.

**What is signed:** every post, every identity document, every key-rotation statement. The signature covers a deterministic byte string constructed from the object's fields in a fixed order (not from JSON serialization, avoiding any canonicalization dependency).

**What is not signed:** the hub's TLS certificate, the URL itself, any metadata the hub adds (Content-Type headers, ETags). The hub's role is transport and storage, not authority.

The wire protocol is HTTPS GET and POST. A reader GETs feeds and identity documents. An author POSTs signed posts to their hub. There is no server-to-server protocol. Cross-hub interaction is just "a reader on hub B fetches a URL on hub A."

---

## 2. The Identity Primitive

**A person is an Ed25519 keypair. The 32-byte public key is the person.**

This is the entire identity. No username, no domain, no registration, no directory. The public key is the name. All other identifiers (display name, avatar, hub URL) are claims made in signed documents that the key endorses.

**Why not a domain name?** The hub operator controls the domain. In the divorce scenario, Bob controls `family.example` and can revoke Alice's subdomain, redirect it, or serve forged content from it. A domain is a lease from the host; a key is a possession.

**Why not a DID or decentralized identifier?** DIDs require a method specification, often a registry or a resolution algorithm, and typically a JOSE or JSON-LD processing stack. This violates the no-dependencies constraint and adds a second implementer's weekend to the learning curve. A raw public key, base64url-encoded, is a DID in the truest sense — it identifies a key — without the ceremony.

**Why not a username on a hub?** Same problem as domain: the hub is the authority, and the hub is the adversary. "alice@family.example" is a name Bob grants and can revoke.

**Why Ed25519 specifically?** It produces small keys (32 bytes) and small signatures (64 bytes). Signing is deterministic (no nonce to get wrong). Verification is fast. It is in every major language's standard or near-standard crypto library. And — critically for encryption — it lives on Curve25519, meaning the same key material can be converted to X25519 for Diffie-Hellman, giving us public-key encryption from the same identity without a second keypair.

**What about the human-readable name?** It is a field in the Identity Document: `"name": "Alice"`. It is signed, so the hub cannot change it. But it has no protocol-level uniqueness. Two people can both be "Alice." The public key disambiguates. Humans recognize each other by key fingerprint displayed in-app, or by the name plus the hub URL they first encountered. This is a deliberate trade of global uniqueness for zero infrastructure.

---

## 3. The Four Floor Assurances, Mechanism by Mechanism

### Assurance 1: The host cannot speak for you.

**Mechanism:** Every post carries an Ed25519 signature computed over a deterministic byte string derived from the post's fields. The private key exists only on the author's device. The hub receives the signed post via HTTPS POST and stores it. To serve a post "as Alice" that Alice did not write, Bob would need Alice's private key. He does not have it. It was generated on her device, never transmitted, never stored on the hub.

**Verification:** A reader checks `Ed25519_Verify(author_pubkey, signing_input, signature)`. If it fails, the post is discarded. The reader's stored copy of Alice's public key is the anchor; the hub's served bytes are untrusted until verified.

**Failure mode:** If Alice's device is stolen or her key is extracted by malware, the attacker can sign as her. The protocol cannot prevent this; it can only detect it after the fact via a revocation/rotation statement (Section 5). The protocol's guarantee is that the *hub operator specifically* cannot forge, because the key never touches the hub.

### Assurance 2: The host cannot read what wasn't meant for it.

**Mechanism:** Posts with `visibility: "encrypted"` carry ciphertext instead of cleartext content. The ciphertext is produced by encrypting the content with a random content key. The content key is then encrypted separately to each intended recipient's X25519 public key (derived from their Ed25519 identity key). The hub stores and serves the ciphertext and the encrypted key blobs. It cannot decrypt without any recipient's private key.

**What the hub learns anyway:** The hub learns that an encrypted post exists, its sequence number, its timestamp, its size, and the number of recipients (count of key blobs). It does not learn who the recipients are (key blobs are addressed to X25519 public keys, which the hub may or may not be able to correlate with identities depending on whether it has seen those keys before). It does not learn the content.

**Failure mode:** If all recipients are on the same hub and the hub operator knows their public keys, the operator can count the blobs and know the audience size. For a family of five, this leaks "this is addressed to roughly five people." The content remains unreadable. This is an accepted leakage; the non-goal list excludes traffic-analysis resistance beyond hiding the audience.

### Assurance 3: The host cannot keep you.

**Mechanism:** The private key is generated on the author's device and never leaves it. All posts are signed locally and uploaded as finished, signed objects. The author's device holds a complete copy of every post they have made (they signed it, so they have the bytes). To leave: stop POSTing to the old hub. Start POSTing to a new hub (or self-hosting). Publish a new Identity Document at the new location with an incremented sequence number and the same public key. Tell your readers the new URL (or they discover it via your next signed post, which contains your hub URL).

The hub has no lock-in mechanism. There is no account to close, no data export to request, no API to call. The author simply stops sending bytes to the old hub and starts sending them to a new one. The old hub retains its copies of old posts, but those posts are signed by the author's key and can be re-hosted anywhere.

**Failure mode:** The old hub can continue serving the old posts. It cannot stop the author from leaving, but it can keep serving a frozen snapshot. Readers detect staleness via sequence numbers (Section 4, Scenario 1). The old hub cannot produce *new* posts with valid signatures.

### Assurance 4: People on other hubs are first-class.

**Mechanism:** There is no hub-to-hub protocol. There is no access-control negotiation, no shared permissions database, no federation handshake. Cross-hub interaction works because:

- **Reading:** B on `b.example` fetches A's post from `a.example` via a plain HTTPS GET. Verifies A's signature. Done.
- **Replying:** B writes a reply post, signs it with B's key, POSTs it to B's own hub. The reply contains the `id` of A's post. A's reader, polling B's hub (or being notified), sees the reply and threads it.
- **Reacting:** Same as replying, but the post type is `reaction`.
- **Reading encrypted content:** A encrypts to B's public key. B fetches the ciphertext from A's hub, decrypts locally. A's hub never knows B's private key. B's hub never sees the cleartext.

No hub needs to trust any other hub. No hub needs to know about any other hub's users. The cryptographic relationship is between the author's key and the reader's key, mediated by nothing.

**Failure mode:** Discovery. B must know A's hub URL to fetch A's posts. This is bootstrapped out-of-band (a link, a QR code, a family group chat). The protocol does not solve global discovery; it solves verification once you have the key. This is an accepted limitation for the family/small-group scale.

---

## 4. Scenario Walk-Throughs

### Scenario 1: The Divorce

Alice's identity lives on Bob's hub at `family.example`. Alice's Ed25519 private key is on her phone. Bob operates the hub.

**Before departure:** Alice writes family-only posts. They are encrypted to her chosen recipients (her mother, her sister). Bob stores the ciphertext. He can see that encrypted posts exist, their timestamps, and that they have 2 key blobs. He cannot read them. He can see her public posts. He cannot forge posts because he lacks her private key.

**The departure:** Alice installs a self-hosted hub at `alice.example` (or moves to her mother's hub). She composes an Identity Document:

```json
{
  "key": "b64url(alice_pubkey)",
  "name": "Alice",
  "hub": "https://alice.example/",
  "seq": 148,
  "previous_hub": "https://family.example/",
  "sig": "b64url(sign(alice_privkey, signing_input))"
}
```

She POSTs this to her new hub. She tells her mother: "I'm at alice.example now." Her mother's app fetches the new Identity Document, verifies the signature against the stored public key (same key — Alice didn't rotate, she moved), and updates the hub URL. One tap.

**Bob's frozen copy:** Bob still serves Alice's old posts at `family.example`. They are validly signed. But the highest seq is 147. Alice's new hub shows seq 148+. When Alice's mother's app next polls, it fetches from `alice.example` and sees seq 148. If it ever checks `family.example`, it sees seq ≤ 147 and marks the content as stale. Bob cannot produce seq 148 with a valid signature. He cannot alter seq 100 because the signature would break. He cannot backdate a new post as seq 50 because the reader already has seq 50 with a different signature.

**The contested claim:** Bob tells family members, "Alice's new hub is a fake; I'm the real Alice." His claim fails because he cannot produce a valid Ed25519 signature for Alice's public key. Any post he serves with Alice's key and an invalid signature is rejected by any conforming reader.

### Scenario 2: Grandma Onboards

Grandma installs the app. The app generates an Ed25519 keypair locally. Grandma is shown: "Pick a name." She types "Grandma." The app creates an Identity Document, signs it, and asks where to put it. Grandma's daughter says, "Put it on the family hub." The app POSTs the Identity Document and Grandma's first post to `family.example`. Grandma never sees a key, a file, or a technical concept.

**Key storage:** The private key is in the app's secure storage (platform keychain, encrypted file). The app also offers: "Back up with a family member." Grandma taps this. The app encrypts her private key with a random passphrase, displays the passphrase (or encodes it as a short word list), and sends the encrypted blob to her daughter's app. The daughter's app stores it. Grandma never writes anything down.

**One year later, phone lost:** Grandma calls her daughter. Daughter's app has the encrypted key blob. Daughter reads Grandma the passphrase (or they meet in person and the app transfers it). Grandma installs the app on a new phone, enters the passphrase, and her key is restored. She is the same person. Her seq continues. Nothing changes on any hub.

**If Grandma cannot reach her daughter:** The key is gone. The protocol cannot recover it. Grandma generates a new key. She is, cryptographically, a new person. She tells her family, "I'm at a new key." Her family updates their stored key for her. This is the explicit non-goal: continuity of a stranger's view across total key loss is not provided. For family, the social graph re-anchors her.

### Scenario 3: Two Hubs, One Thread

A is on `a.example`. B is on `family.example`. A writes a family-only post: "Dinner at 7."

1. A's app encrypts "Dinner at 7" to B's X25519 public key (and any other recipients). A signs the post. A POSTs it to `a.example`.
2. B's app polls A's feed at `a.example` (B's app knows A's hub URL from a previous exchange). B fetches the encrypted post. B's app attempts decryption with B's private key. It succeeds. B reads "Dinner at 7."
3. B replies: "I'll bring wine." B signs this reply with B's key. The reply's `reply_to` field contains the `id` of A's post. B POSTs it to `family.example`.
4. A's app polls B's feed at `family.example` (A knows B's hub URL). A sees the reply, verifies B's signature, threads it under the original post.
5. B reacts with a ❤️. Same mechanism: a signed post of type `reaction` referencing A's post, stored on `family.example`.

At no point do `a.example` and `family.example` communicate. No ACL is configured. No webhook is registered. No federation protocol is spoken. The interaction is: signed objects, fetched by URL, verified by key, decrypted by the recipient.

### Scenario 4: The Domain Goes

`family.example` becomes unaffordable. The operator (or the family collectively) decides to shut it down.

Every person whose content lives there has their private key on their device and a local copy of their signed posts. Each person picks a new hub (self-host, a relative's box, a commercial host). Each publishes a new Identity Document at the new hub with the same public key and a higher seq.

**Identity does not change.** The public key is the same. The name is the same. Only the `hub` URL in the Identity Document changes.

**Existing readers find them:** Readers stored the public key and the hub URL. When the old hub goes dark, the reader's poll fails. The reader needs the new URL. This is communicated out-of-band: a family group chat, an email, a QR code at Thanksgiving. The reader updates the URL. The key verifies everything.

Alternatively: if the family has a shared "directory" post (a post of type `directory` listing everyone's current hub URLs, signed by a trusted family member), readers can fetch this from any surviving hub to discover new locations. This is a convenience, not a requirement.

**The old content:** The old hub's copies are valid signed posts. Anyone who has them can re-host them. They are not "locked" to the domain. A reader who saved all of Alice's posts can verify them forever, regardless of where Alice is now.

---

## 5. Key Change and Recovery

### Rotation (voluntary)

Alice wants a new key (e.g., she suspects her device was briefly compromised, or she's upgrading). She creates a **Rotation Statement**:

```json
{
  "type": "rotation",
  "old_key": "b64url(old_pubkey)",
  "new_key": "b64url(new_pubkey)",
  "seq": 200,
  "created": "2025-06-01T12:00:00Z",
  "sig_old": "b64url(sign(old_privkey, signing_input))",
  "sig_new": "b64url(sign(new_privkey, signing_input))"
}
```

Both the old and new keys sign the same payload. A reader who trusts the old key can verify `sig_old` and accept the new key. From seq 201 onward, posts are signed with the new key. The reader updates their stored key.

**Why both signatures?** So that a reader who only has the new key (e.g., they discover Alice after rotation) can verify backward via `sig_new`, and a reader who only has the old key can verify forward via `sig_old`. The chain is one link long by design; we do not build a chain of rotations. If you've rotated three times, your current Identity Document references only the immediately previous key.

### Loss

The key is gone. No backup exists. The identity, cryptographically, is dead.

The person generates a new key. They are a new identity. They tell their family. The family updates their stored keys. Old posts remain valid (they were signed by the old key), but they are now orphaned — no one will produce new posts with that key.

For the "stranger following a public journal" scenario: the stranger loses track. If they encounter the author again and the author says "I'm the same person, new key," the stranger can choose to trust this social assertion. The protocol provides no mechanism for a stranger to verify continuity across total key loss. This is the stated non-goal.

### Theft

Alice believes her private key has been extracted (phone stolen, malware). She issues a **Revocation Statement**, signed with the (possibly compromised) old key AND a new key:

```json
{
  "type": "revocation",
  "revoked_key": "b64url(compromised_pubkey)",
  "new_key": "b64url(new_pubkey)",
  "revoke_after_seq": 150,
  "reason": "device_stolen",
  "sig": "b64url(sign(old_privkey, signing_input))"
}
```

The `revoke_after_seq` field says: "Treat all posts with seq > 150 from the old key as suspect." This is a best-effort signal. If the attacker also has the key, they can issue a counter-revocation. The protocol cannot resolve this; it is a social problem. For the family threat model, the family adjudicates: "Alice called me and told me her new key. I believe her."

**Contested departure (the hostile operator claims the departure is the forgery):** Bob claims the rotation statement at `alice.example` is fake — that he is the real Alice and the person at the new hub is an imposter. His claim fails on a simple test: produce a valid signature from Alice's public key that you (Bob) created. He cannot. The rotation statement is signed by Alice's private key. If Bob cannot produce another valid signature, his claim is empty. If he *can* produce a valid signature, then he had the private key, and the compromise is real — but then Alice's revocation (with the new key) is the correct response, and the family must adjudicate socially.

### Recovery (Grandma's scenario)

The protocol does not mandate a recovery mechanism. It mandates only that the key is the identity and that rotation is possible. Implementations provide backup UX:

- **Encrypted backup to a trusted contact:** The app encrypts the private key with a random 256-bit passphrase, encodes the passphrase as 24 words (from a 2048-word list, giving ~264 bits of entropy, more than enough), and sends the encrypted blob to a family member's app. Recovery: enter the 24 words.
- **Split across contacts:** The key is XOR-split into N shares (simple XOR secret sharing, not Shamir — for N=2 or N=3, XOR is sufficient and trivially implementable). Each share goes to a different family member. Recovery requires all shares.

The protocol's only requirement: the recovery mechanism must not give the hub operator access to the key. The backup goes to a person, not to the hub.

---

## 6. The Encryption Construction

This section is implementation-level.

### Primitives

- **Ed25519** for signatures (identity, integrity).
- **X25519** for Diffie-Hellman key agreement (derived from the same Curve25519 key material as Ed25519; conversion is a standard, well-documented operation).
- **SHA-256** for hashing, KDF, and as the PRF for the stream cipher.
- **HMAC-SHA256** for message authentication (this is SHA-256 with a standard construction; no separate primitive needed).

If a language's standard library provides Ed25519 but not X25519 directly, the conversion is: for the private key, clamp the 32-byte Ed25519 seed per RFC 7748 §5; for the public key, apply the birational map from the Ed25519 point to the Montgomery u-coordinate. This is ~10 lines of arithmetic. I flag this as the one place where an implementer might need a reference beyond the spec text.

### What is encrypted

The `content` field of the post. This includes text, image references (URLs or inline base64), and any structured data. The `visibility` field is set to `"encrypted"`. The `content` field in the served JSON is replaced by a ciphertext object.

### To whom

The author chooses a set of recipients by their public keys. These are the Ed25519 public keys of the intended readers, converted to X25519 public keys for the DH operation.

### Encryption procedure

1. Generate a random 32-byte **content key** `K`.
2. Generate a random 12-byte **nonce** `N`.
3. **Encrypt the content:**
   - Produce a keystream: for block `i` (0-indexed), compute `block_i = SHA-256(K || N || i_as_4_bytes_big_endian)`. Concatenate blocks to match plaintext length. XOR plaintext with keystream to produce ciphertext `C`.
   - Compute `MAC = HMAC-SHA-256(K, N || C)`.
4. **Encrypt the content key to each recipient:**
   - Generate an ephemeral X25519 keypair `(e, E)`.
   - For recipient `j` with X25519 public key `P_j`:
     - `shared_j = X25519(e, P_j)` (32 bytes).
     - `key_j = SHA-256(shared_j || E || P_j)` (32 bytes).
     - `encrypted_key_j = K XOR SHA-256(key_j || 0x00000000)` (one SHA-256 block is 32 bytes, exactly the size of K).
   - Store the tuple `(E, encrypted_key_j)`.
   - **Note:** a fresh ephemeral keypair is generated per recipient, so the hub cannot link two recipients as having received the same post (the `E` values differ). Alternatively, for efficiency with many recipients, one ephemeral keypair can be shared; this leaks to the hub that these N blobs belong to one post, which is already obvious from the post structure. I recommend per-recipient ephemeral keys for simplicity of reasoning.
5. **Assemble the encrypted content object:**

```json
{
  "nonce": "b64url(N)",
  "ciphertext": "b64url(C)",
  "mac": "b64url(MAC)",
  "keys": [
    { "ephemeral": "b64url(E)", "key": "b64url(encrypted_key_1)" },
    { "ephemeral": "b64url(E)", "key": "b64url(encrypted_key_2)" }
  ]
}
```

### Decryption procedure (recipient)

1. For each entry in `keys`: attempt `shared = X25519(my_x25519_priv, entry.ephemeral)`. Compute `key_j = SHA-256(shared || entry.ephemeral || my_x25519_pub)`. Recover `K_candidate = entry.key XOR SHA-256(key_j || 0x00000000)`.
2. Attempt decryption: recompute keystream from `K_candidate` and `nonce`, XOR with ciphertext, check HMAC. If HMAC matches, this was your blob. (For a family of 5–20, you try at most 20 blobs. Each attempt is one X25519 scalar multiplication and two SHA-256 calls. Negligible.)
3. If no blob matches, the post is not addressed to you.

### How recipients are addressed without publishing the audience

The `keys` array contains ephemeral public keys and encrypted content keys. It does not contain recipient identities. The hub sees N blobs. If the hub knows all family members' X25519 public keys, it can attempt to match blobs by checking whether `X25519(known_priv, E)` produces a valid decryption — but this requires the hub to have the recipients' *private* keys, which it does not. The hub can correlate by metadata (who fetched the post, timing), but the protocol does not give it the audience list.

For additional protection: the author can pad the `keys` array with random blobs (encrypted to random X25519 keys) to obscure the audience size. This is optional and left to the implementation.

### What the hub learns anyway

- That an encrypted post exists, its seq, its timestamp, its size.
- The number of key blobs (audience size, approximately).
- Which IP addresses fetch the post (correlatable with users if the hub is small).
- The content is unreadable. The audience identities are not in the post. The hub cannot decrypt.

---

## 7. The Honest Cost Sheet

**What this design is bad at:**

- **Discovery.** There is no global directory. You find people through social channels. For a family of 15, this is fine. For a community of 500, it becomes a real friction point. I have not solved this and do not attempt to.
- **Deletion.** Once a post is signed and served, the author cannot compel the hub to delete it. The hub can retain a copy forever. The author can revoke (say "seq > N is no longer valid"), but the bytes persist. True deletion requires the hub's cooperation, and the hub may be hostile.
- **Forward secrecy for encrypted posts.** If a recipient's private key is later compromised, all past encrypted posts addressed to them can be decrypted. There is no ratcheting. For family-scale use, this is acceptable; for high-security messaging, it is not.
- **Ordering across authors.** Sequence numbers are per-author. There is no global timestamp authority. Two posts from different authors can claim the same timestamp. Readers must accept partial ordering.
- **Availability.** If the author's hub goes down, their content is unreachable until they move. There is no redundancy layer in the protocol. Readers who cached the content still have it, but new readers cannot fetch it.

**What it cannot deliver:**

- Protection against a recipient who screenshots or re-shares encrypted content. The content is decrypted on the recipient's device; the protocol has no DRM.
- Protection against a hub that refuses to serve a specific post (selective censorship by omission). The reader can detect gaps in the sequence, but cannot prove the hub is withholding.
- Anonymity of the author. Posts are signed with a persistent key. The author is identifiable across all their posts.

**Where it is more complex than it looks:**

- **The signing input construction.** Getting the byte-level format exactly right, with no ambiguity, across implementations, is fiddlier than "just sign the JSON." I mitigate this by specifying the exact byte layout, but I suspect the second implementer will spend an hour on edge cases (empty fields, Unicode in names, the difference between null and absent).
- **The Ed25519-to-X25519 conversion.** It is a known operation, but it is not always exposed by high-level libraries. An implementer may need to drop to a lower-level API or implement the birational map. This is the one place where "standard library" gets fuzzy.
- **The SHA-256 stream cipher.** It is correct but slow (~32 bytes per SHA-256 call, vs. 64 bytes per AES block). For a 10 MB photo, this is ~300,000 SHA-256 calls. On a phone, this might take a noticeable fraction of a second. For text posts, it is instantaneous. I accept this cost for the zero-dependency property, but I flag it.

**Which choice I am least sure of:**

The decision to make the X25519 key derivable from the Ed25519 identity key, rather than requiring a separate encryption keypair. The advantage is simplicity: one key, one identity, no key management. The disadvantage is that a compromise of the signing key also compromises all past encryption. A separate encryption key could be rotated independently. I chose unity for the Grandma-onboards scenario: one key to back up, not two. But I am not fully certain this is right for all threat models.

I am also uncertain about the sequence number as the sole anti-backdating mechanism. A hostile hub could serve an old feed snapshot to a new reader, who would see seq 1–50 and believe that is the complete history. The reader has no way to know that seq 51–100 exist unless they ask a different source. This is a fundamental limitation of a hub-mediated architecture without a global log.

---

## 8. What I Would Cut

If forced to halve the specification, I would cut:

1. **The encrypted key blob padding.** The optional random blobs to obscure audience size. Nice-to-have, not floor.

2. **The rotation statement's dual signature.** I would keep only the old-key signature. The new key signs its own first post. A reader who discovers the person post-rotation just trusts the new key from the Identity Document. The backward-verification chain is a luxury.

3. **The `previous_hub` field in the Identity Document.** Staleness detection via sequence numbers is sufficient. The explicit pointer to the old hub is a convenience for migration UX, not a protocol requirement.

4. **The SHA-256 stream cipher specification in detail.** I would replace it with: "Use any authenticated encryption scheme available in your standard library (AES-GCM, ChaCha20-Poly1305, or the SHA-256-CTR construction described here)." This widens the implementation surface slightly but removes the most performance-constrained part of the spec.

5. **The reaction post type.** A reaction is just a reply with a single-emoji content field. I would not give it a separate type. This saves a paragraph of spec and one branch in every implementation.

What I would **not** cut: the signing input construction (it is the core of Assurance 1), the encryption scheme (Assurance 2), the sequence number (Assurance 3 and staleness detection), or the "no hub-to-hub protocol" principle (Assurance 4). These are the floor.

---

## Appendix: Shape of the Bytes

### Identity Document

```
GET https://alice.example/.well-known/identity.json

{
  "key": "b64url(32-byte Ed25519 public key)",
  "name": "Alice",
  "hub": "https://alice.example/",
  "seq": 148,
  "created": "2025-01-15T10:30:00Z",
  "sig": "b64url(64-byte Ed25519 signature)"
}
```

Signing input for the Identity Document:

```
"identity\n" +
key_b64url + "\n" +
name + "\n" +
hub + "\n" +
seq_decimal_string + "\n" +
created
```

### Post

```
GET https://alice.example/feed.json

{
  "posts": [
    {
      "id": "b64url(sha256(signing_input_bytes))",
      "author": "b64url(32-byte Ed25519 public key)",
      "seq": 147,
      "created": "2025-06-14T19:22:00Z",
      "type": "post",
      "visibility": "public",
      "content": { "text": "The garden is blooming." },
      "reply_to": null,
      "sig": "b64url(64-byte Ed25519 signature)"
    }
  ],
  "next_seq": 148
}
```

Signing input for a post:

```
type + "\n" +
author_b64url + "\n" +
seq_decimal_string + "\n" +
created + "\n" +
visibility + "\n" +
sha256_hex(canonical_content_bytes) + "\n" +
(reply_to_id or "null")
```

Where `canonical_content_bytes` is the UTF-8 encoding of the JSON serialization of the `content` object with keys in the order: `text`, `image_url`, `alt`. (This is a fixed, small schema — not arbitrary JSON. This avoids the canonicalization problem by restricting the content shape.)

### Encrypted post content

```json
{
  "type": "post",
  "visibility": "encrypted",
  "content": {
    "nonce": "b64url(12 bytes)",
    "ciphertext": "b64url(variable)",
    "mac": "b64url(32 bytes)",
    "keys": [
      { "ephemeral": "b64url(32 bytes)", "key": "b64url(32 bytes)" }
    ]
  },
  "seq": 147,
  ...
}
```

The signing input hashes the entire `content` object as bytes (the ciphertext, not the cleartext). The author signs the encrypted form. The reader verifies the signature before decrypting.

---

## Closing Note

This design is, at its core, "signed JSON served over HTTPS, with optional encryption to known keys." The intellectual content is in what is *not* built: no server-to-server protocol, no access-control negotiation, no global registry, no consensus. The four floor assurances fall out of two facts: the private key never touches the hub, and the reader verifies before believing. Everything else is ergonomics.

The tension the brief identifies — between no-dependencies and easy-to-implement — is real and is resolved here by restricting the content schema (small, fixed fields; no arbitrary JSON in the signing input) and by accepting SHA-256 as the sole hash/cipher primitive. The second implementer's weekend is spent on the signing input format and the X25519 conversion, not on a JOSE stack or a canonicalization algorithm. That is the trade, and I believe it is the right one.

<details><summary>Model reasoning trace (22507 chars) — kept because rejected alternatives often live here</summary>

```
The user wants me to design a protocol for decentralized personal publishing and interaction from first principles. This is a substantial design document. Let me work through this carefully.

Let me think about the core constraints:
- No central service
- Hubs are just storage/serving over HTTPS
- The adversary is INSIDE the family - the hub operator
- Must be implementable with just Ed25519, SHA-256, HTTP, JSON, base64
- Must work across hubs without inter-hub agreements
- Must survive hostile hub operators
- Family/small group scale, not millions

The four floor assurances:
1. Host cannot speak for you (signing)
2. Host cannot read what wasn't meant for it (encryption)
3. Host cannot keep you (portability)
4. Cross-hub is first-class (no ACL coordination)

Let me think about the identity primitive first.

**Identity**: A person IS their Ed25519 keypair. The public key is their identity. This is the simplest thing that works. Why not DIDs? Too complex, requires registries. Why not domain names? The host controls the domain. Why not a username? Requires a registry. The key IS the person.

But wait - key loss is a problem. And key rotation. Let me think...

Actually, the identity should be: a signing keypair, where the public key is the identity. But we need a way to:
- Rotate keys (sign old key's statement to new key)
- Recover from loss (some form of social recovery or backup)
- Handle contested departures

Let me think about the architecture:

**Artifacts:**
- Identity document: public key, hub URL, optional metadata
- Posts: signed JSON objects
- Reactions: signed references to posts
- Replies: signed posts that reference another post
- Encrypted content: for family-only

**What a reader fetches:**
- First contact: the identity document (to get the public key)
- Poll: the feed of signed posts

**Signing**: Every post is signed with Ed25519. The signature covers the content. The hub cannot forge.

**Encryption**: This is the hard part. For family-only content:
- The author encrypts to specific recipients
- The hub stores ciphertext
- The hub cannot decrypt

How do we do this with just Ed25519 and SHA-256? We need:
- Ed25519 for signing
- For encryption, we need some form of public-key encryption. Ed25519 is a signature scheme, not encryption. But we can derive X25519 keys from Ed25519 keys (they're both on Curve25519). Or we can use a KDF approach.

Wait - the constraint says "Ed25519, SHA-256, HTTP, JSON, base64." No mention of X25519 or any encryption primitive directly. But we need encryption for assurance 2.

Hmm, let me re-read: "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64."

This is tricky. Most standard libraries that have Ed25519 also have X25519 (they're both Curve25519). Python's `cryptography` library has both. Node's `crypto` module has both. Go's `crypto/ed25519` and `crypto/ecdh` or `golang.org/x/crypto/nacl` (well, x/crypto isn't stdlib...).

Actually, let me reconsider. The constraint says "from a language's standard library." In Python, the standard library doesn't include Ed25519 directly either (you need `cryptography` or `nacl`). In Go, `crypto/ed25519` is stdlib but X25519 is in `crypto/ecdh` (Go 1.20+). In Rust, you need `ed25519-dalek` and `x25519-dalek`.

I think the intent is: no exotic dependencies. The primitives available are Ed25519 (which implies Curve25519, which implies X25519 is derivable), SHA-256, and standard encoding. I'll use X25519 for key exchange since it's the encryption counterpart to Ed25519 and available in the same libraries. If I'm wrong about this being available, I'll note it.

Actually, for a pure-stdlib approach: Ed25519 keys can be converted to X25519 keys (there's a well-known birational map). So if you have Ed25519, you can derive the X25519 public key from the Ed25519 public key. This means the same identity key can be used for both signing and encryption (via conversion).

Let me design the encryption:
- Author has Ed25519 keypair → derives X25519 keypair
- Each recipient has Ed25519 keypair → derives X25519 keypair
- Author generates ephemeral X25519 keypair
- For each recipient: ECDH(ephemeral_priv, recipient_pub) → shared secret → SHA-256 → symmetric key
- Encrypt content with... wait, we need a symmetric cipher. AES? ChaCha20?

Hmm, the constraint says Ed25519, SHA-256, HTTP, JSON, base64. No symmetric cipher mentioned. This is a problem.

Wait - maybe I can use a stream cipher constructed from SHA-256? Like a counter-mode construction: keystream = SHA-256(key || counter) for each block. This is a valid (if not optimal) PRF-based stream cipher. It's not as fast as AES but it works and uses only SHA-256.

Actually, let me reconsider the constraint. "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." I think this means these are the *named* primitives, but the intent is "no exotic dependencies." Most standard libraries that provide Ed25519 also provide AES or ChaCha20. But to be safe and literal, I'll design around SHA-256 as the only hash/cipher primitive, using it to construct a stream cipher.

Actually, I'll use HMAC-SHA256 (which is just SHA-256 with a specific construction) as a KDF, and SHA-256 in counter mode as a stream cipher. This is implementable with just SHA-256.

Let me structure the document now:

1. Architecture in one page
2. Identity primitive
3. Floor assurances mechanism by mechanism
4. Scenario walkthroughs (1, 2, 3, 4)
5. Key change and recovery
6. Encryption construction
7. Honest cost sheet
8. What to cut

Let me think about the feed structure:

A hub serves:
- `/.well-known/identity.json` or similar - the identity document
- `/feed.json` or similar - the signed posts
- Individual post URLs

Actually, let me think about what "a person" looks like on the wire:

Identity: A 32-byte Ed25519 public key. That's it. That's the person. Everything else is derived.

But humans need a way to find each other. So we need a URL. The identity document is at a URL, and it contains the public key. But the URL is controlled by the hub...

Wait. The identity is the key. The URL is just where you currently find them. When they move, the key stays the same.

Let me think about the "profile" or "identity document":

```json
{
  "key": "base64url(ed25519_public_key)",
  "name": "Alice",
  "hub": "https://alice.example/",
  "previous": null,
  "seq": 1,
  "sig": "base64url(signature over the above)"
}
```

This is signed by the identity key. The hub serves it but can't modify it without detection.

For the feed:

```json
{
  "id": "base64url(sha256(canonical_json))",
  "author": "base64url(ed25519_public_key)",
  "created": "2025-01-15T10:30:00Z",
  "seq": 42,
  "type": "post",
  "content": { ... },
  "visibility": "public" | "encrypted",
  "reply_to": null | "post_id",
  "sig": "base64url(ed25519_signature)"
}
```

For encrypted posts, `content` is replaced by ciphertext.

Now, the signing. What exactly is signed? We need canonical JSON or we need to sign a specific serialization. The constraint says no JSON canonicalizer. So we need a simpler approach.

Option: Sign the SHA-256 hash of a specific byte sequence. Define the signing payload as the concatenation of specific fields in a defined order, or sign the SHA-256 of the JSON with fields in a defined order.

Actually, the simplest approach: the signature covers the SHA-256 hash of the JSON bytes with a defined field order. Or better: define the signing input as a specific string constructed from the fields.

Let me think... "No JSON canonicalizer" means we can't rely on sorted keys or anything. So let's define the signing input explicitly:

```
sign_input = type + "\n" + author_b64 + "\n" + seq + "\n" + created + "\n" + content_hash
```

Where content_hash is SHA-256 of the content bytes. This avoids canonicalization entirely.

Actually, even simpler: sign the SHA-256 of the entire JSON object with the `sig` field removed and fields in a specified order. But "specified order" in JSON is tricky without a canonicalizer.

Better approach: The signature is over a byte string constructed by concatenating fields in a fixed order, separated by a delimiter. This is unambiguous and doesn't require JSON canonicalization.

Let me define:

```
signing_payload = "post\n" +
                  author_b64url + "\n" +
                  seq_string + "\n" +
                  created + "\n" +
                  visibility + "\n" +
                  sha256_hex(content_bytes) + "\n" +
                  (reply_to or "null")
```

Then `sig = Ed25519_Sign(private_key, signing_payload)`.

This is clean, unambiguous, and requires no canonicalization.

Now for encryption. The recipient set must not be visible to the hub. So we can't have a "recipients" list in the clear.

Approach: The author encrypts the content once with a random content key, then encrypts the content key to each recipient. The ciphertext is stored on the hub. The hub sees: encrypted blob + N encrypted key blobs. The hub doesn't know which keys correspond to which people (if we anonymize them).

Wait, but the hub needs to know who can decrypt to serve the content... actually no. The hub just stores and serves the encrypted blob to anyone who asks. The decryption happens client-side. The recipient fetches the encrypted post, tries to decrypt each key blob with their private key, and if one works, they decrypt the content.

But this means every recipient fetches the same encrypted blob and tries all key blobs. For small family groups this is fine.

How do recipients identify which key blob is theirs without revealing identity to the hub? Each key blob could be encrypted to a specific X25519 public key. The recipient tries to decrypt each blob. For 5-20 family members, trying 20 decryptions is trivial.

But wait - if the key blobs are in the clear (just encrypted content keys), the hub can see how many recipients there are. That's probably fine for the threat model. The hub can't tell WHO without knowing which X25519 keys belong to whom. But if the hub is the family hub, it probably knows everyone's keys...

Hmm. Let me think about this differently. The requirement says "Content addressed to chosen people is unreadable by anyone else, the host included." So the host cannot READ the content. It's okay if the host knows that a post exists and roughly how many people it's addressed to. The content itself must be unreadable.

So the construction:
1. Author generates random 32-byte content key K
2. Author encrypts content with K (using SHA-256 counter-mode stream cipher)
3. For each recipient i with X25519 public key P_i:
   - Generate ephemeral X25519 keypair (e_i, E_i)
   - shared_i = X25519(e_i, P_i)
   - key_i = SHA-256(shared_i || E_i || P_i)
   - encrypted_key_i = K XOR SHA-256_stream(key_i)  (or encrypt K with the stream cipher)
   - Store (E_i, encrypted_key_i) as a key blob
4. The post contains: ciphertext, [list of (E_i, encrypted_key_i)]

The hub sees: ciphertext + list of ephemeral public keys + list of encrypted content keys. It cannot decrypt without any recipient's private key.

Actually, I realize I should think about whether we even need per-recipient encryption or if we can use a group key. For simplicity and the "no coordination" requirement, per-recipient is better. Each recipient can be added/removed without re-encrypting for everyone.

But wait - the requirement says "no access-control agreement between the hubs." This means hub A doesn't need to know about hub B's users. The author just encrypts to the public keys of the people they want to reach. Those people can be on any hub. They fetch the encrypted post from the author's hub and decrypt locally.

This is clean. Let me proceed.

Now, for the "host cannot keep you" assurance: The key is on the person's device. The content is signed by them. They can copy all their signed posts (they're public on the hub) and take them anywhere. Their identity (key) moves with them. The hub has no special claim.

For "people on other hubs are first-class": Since all content is signed by the author's key, and encrypted content is encrypted to recipients' keys regardless of hub, there's no hub-to-hub coordination needed. B on hub B fetches A's post from hub A, verifies A's signature, decrypts if needed. Done.

Let me now think about key rotation and recovery:

**Rotation**: The author signs a "rotation statement" with the old key: "I am now key X." This is a signed object. Anyone who has the old key can verify the chain.

**Loss**: This is harder. If you lose your key, you lose your identity. The design says "Continuity of a stranger's view of you across total key loss" is a non-goal. But for family, we want recovery.

Social recovery: The author designates N recovery contacts (by their public keys). To recover, M of N contacts co-sign a statement "key X is the continuation of identity Y." But wait - identity IS the key. If the key is lost, the identity is gone.

Hmm. Let me reconsider. Maybe identity isn't JUST the key. Maybe identity is a key plus a recovery mechanism. Or maybe identity is a "chain" where the latest key is the current one, and the chain is verified back to the original.

Actually, for the "Grandma loses her phone" scenario: She calls her daughter. The daughter has a backup of Grandma's key (or a recovery share). The simplest approach: when Grandma sets up, her key is backed up to a family member's device (encrypted). Or: Grandma's key is split into shares (Shamir's secret sharing) and distributed to family members.

But Shamir's secret sharing requires more than SHA-256... actually it requires finite field arithmetic. Over GF(256) it's doable with just XOR and table lookups, but it's complex.

Simpler: The key is encrypted with a passphrase and stored with a trusted family member. Or: the key is simply copied (encrypted) to a family member's device.

For the protocol spec, I'll say: recovery is out-of-band. The protocol provides a rotation mechanism (old key signs new key), and the implementation provides backup/recovery UX. The protocol doesn't mandate how backup works.

For contested departure: Alice leaves Bob's hub. Bob claims the "departure" is forged - that someone else is posting as Alice. But Alice's key is hers. If Bob never had her private key, he can't forge her signature. The rotation statement is signed by her key. If Bob claims it's forged, the counter-argument is: show us a valid signature from Alice's key that you produced. He can't.

Unless Bob had access to Alice's key while she was on his hub. But the design says the key is ALWAYS on the person's device. The hub never has the private key. So Bob never had it.

But what if Alice's device was compromised? Then we need a revocation mechanism. Alice issues a revocation: "All posts before sequence N from key X are potentially compromised. My new key is Y." Signed by... the old key? But if the old key is compromised, the attacker could also sign a revocation.

This is a fundamental problem. The solution: Alice signs the revocation with the old key AND the new key. Or: Alice's recovery contacts co-sign the rotation. For the family threat model, the recovery contacts (family members) can vouch.

Let me think about the "stale copy" problem: After Alice leaves, Bob still has her old content. The content is signed by her key, so it's still valid. But it's "stale" - it's a snapshot. How do readers know it's stale?

The identity document has a `seq` number and a `hub` URL. When Alice moves, she publishes a new identity document at her new hub with a higher seq. Readers who follow Alice check her identity document. If they fetch from Bob's hub and see seq 50, but Alice's new hub says seq 51 with a different hub URL, they know Bob's copy is stale.

But how do readers find Alice's new hub? They need to know where to look. This is the discovery problem.

Option: The identity document includes a "next" pointer. Before Alice leaves, she publishes an identity document that says "I'm moving to X." But in the divorce scenario, Bob controls the hub and might not serve this.

Better option: Alice's identity is her key. Readers store her key. When they want to check for updates, they need to find her current hub. This requires some discovery mechanism.

Simplest: The reader stores the hub URL. If the hub becomes hostile, Alice needs to tell her readers her new URL out-of-band (email, text, etc.). Then they update their stored URL.

Or: Alice's signed posts include her hub URL. When a reader gets a post, they can verify it came from the claimed hub. If Alice starts posting from a new hub, readers see the new URL in her posts.

Actually, for the "one tap" follow after departure: Alice tells her mother "I'm now at alice-new.example." Mother's app updates the URL. The key is the same, so all old content still verifies. New content comes from the new URL. Simple.

For the "frozen copy reads as stale": The reader can check the sequence number. If the reader knows Alice is at seq 100 (from her new hub), and Bob's copy only goes to seq 50, the reader knows it's incomplete. The reader marks it as such.

Let me now think about the feed format and interop:

For RSS/Atom/JSON Feed interop: The hub serves a standard feed format alongside the signed JSON. Or: the signed JSON IS the feed, and a bridge converts it. For "nothing extra built," the simplest approach is:

- The hub serves `/feed.xml` (RSS/Atom) for public posts. This is unsigned (or separately signed) and is just for legacy readers.
- The canonical signed feed is at `/feed.json`.
- For ActivityPub (fediverse): the hub serves an ActivityPub-compatible endpoint. But this requires more work...

Actually, the requirement says "Their replies coming back is an extension, not a requirement." So we just need outbound interop. The simplest: serve an RSS/Atom feed of public posts at a well-known URL. Feed readers subscribe to it. Done.

For Mastodon/Bluesky: A bridge service converts the RSS feed to ActivityPub or AT Protocol. The bridge is a separate service, not part of this protocol. "With nothing built" means the protocol doesn't require building the bridge - existing bridges that consume RSS will work.

OK, let me also think about the "big lazy hub" scenario. 10,000 people on one hub. The hub stores signed posts and serves them. Per-identity cost: storage of their posts, bandwidth to serve them. The hub doesn't need to verify signatures (it's just storage). It doesn't need to manage access control (encryption is client-side). The cost is flat: just bytes stored and served.

Actually, the hub might want to verify signatures to avoid storing garbage. But it doesn't HAVE to. It's just a dumb file server. The verification happens on the reader's side.

Now let me structure the full document. I'll aim for thorough but not bloated. Let me write it section by section.

One more thought on the encryption: I said SHA-256 counter mode as a stream cipher. Let me be more precise:

```
keystream_block_i = SHA-256(key || i_as_4_bytes_big_endian)
ciphertext = plaintext XOR keystream_block_0 || keystream_block_1 || ...
```

This is a standard CTR-mode construction using SHA-256 as the PRF. It's not as fast as AES-CTR but it's correct and uses only SHA-256. For family-scale content (a few KB per post), performance is irrelevant.

For the ECDH: Ed25519 private keys can be converted to X25519 private keys, and Ed25519 public keys to X25519 public keys. This is a well-known transformation (clamp the private key scalar, apply the birational map to the public key point). Most Ed25519 implementations include this or it's a few lines of code.

Wait, actually, is X25519 available in "standard libraries"? Let me check:
- Python: `cryptography` package has X25519. Not in `hashlib` or `hmac` (stdlib). But `cryptography` is basically standard.
- Go: `crypto/ecdh` has X25519 (Go 1.20+). Stdlib.
- Node.js: `crypto.diffieHellman` with X25519. Stdlib.
- Rust: Not in std, needs `x25519-dalek`.

Hmm, it's not universally in the stdlib. But the design brief says "Ed25519, SHA-256" as the primitives. I think the intent is that Curve25519 operations are available. I'll note this as a potential issue and provide the SHA-256-only fallback if needed.

Actually, for a pure SHA-256-only approach to encryption, we could do:
- Use the Ed25519 key as a shared secret somehow? No, that doesn't work for public-key encryption.
- Use a password-based approach? No, we need public-key.

I think we need X25519 (or equivalent DH). I'll include it and note that it's the encryption counterpart to Ed25519, available in the same libraries. The design brief's spirit is "no exotic dependencies" not "literally only these five things."

Actually wait, re-reading: "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." I think this is listing what you need, not an exhaustive list of what you can use. The point is: no JOSE, no git, no blockchain, no DHT. X25519 is in the same family as Ed25519. I'll include it.

Let me also think about: do we need a MAC? If we're encrypting, we need authenticated encryption to prevent tampering. With SHA-256 CTR mode, we need a separate MAC.

HMAC-SHA256(key, ciphertext) as a MAC. This is just SHA-256 with a specific construction. Available everywhere SHA-256 is.

So the encryption is:
1. Generate content_key (random 32 bytes)
2. Encrypt: keystream from SHA-256-CTR(content_key, nonce), XOR with plaintext
3. MAC: HMAC-SHA256(content_key, ciphertext)
4. For each recipient: encrypt content_key using X25519 ECDH + SHA-256 KDF

This gives us authenticated encryption with only SHA-256, X25519, and random bytes.

OK, I think I have enough to write the full design. Let me structure it clearly and argue each choice.

Let me also think about the sequence number and ordering. Each post has a monotonically increasing sequence number per author. This prevents backdating (you can't insert a post with seq 5 after seq 10 without it being obvious). It also helps with "stale copy" detection.

The seq number is part of the signed content, so the hub can't reorder posts.

One more consideration: the "no JSON canonicalizer" constraint. I need to define the signing input without relying on JSON serialization being deterministic. My approach of constructing a byte string from fields in a fixed order handles this.

Let me write the document now. I'll aim for ~4000-5000 words of substantive, argued design.

```

</details>

