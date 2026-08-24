---
model: qwen3.8-max
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:52:06.403Z
prompt: PROMPT-pass1.md
prompt_sha256: ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":1678,"completion_tokens":18211,"total_tokens":19889,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":10235}}
wall_seconds: 373
truncated: false
reasoning_chars: 39624
---
# Hearth: A Protocol for Decentralized Personal Publishing

## 1. Architecture in One Page

**Artifacts.** There are exactly three kinds of object in this protocol.

| Artifact | Purpose | Signed? | Encrypted? |
|---|---|---|---|
| **Identity document** | Binds a person to a public key and a hub URL. The root of trust. | By the person's Ed25519 key | No |
| **Content item** | A post, photo, reply, reaction, relocation notice, or key-rotation record. The unit of publishing. | By the author's Ed25519 key | Optionally (see §6) |
| **Feed** | An ordered list of content-item URLs for one person. A convenience index, not a signed object. | No (each item is self-authenticating) | No |

**What a reader fetches on first contact.** A URL of the form `https://hub.example/p/<key-id>` where `key-id` is the first 16 bytes of SHA-256 over the author's 32-byte Ed25519 public key, base64url-encoded (22 characters). The reader GETs:

1. The **identity document** at that URL → obtains the author's Ed25519 public key, X25519 public key, display name, and declared hub URL.
2. The **feed** at `<url>/feed` → a JSON array of item URLs, newest first.
3. Each **item** it wishes to read → verifies the Ed25519 signature against the public key from step 1, then either reads the plaintext body or attempts decryption (§6).

**What a reader fetches on a poll.** Only step 2 (the feed), then any items it has not yet seen. Items are immutable once published; a previously verified item never needs re-fetching.

**The hub's role.** A hub is a file store with an HTTPS interface. It accepts `PUT` of an identity document and `POST` of content items, and serves them back over `GET`. It does not verify signatures, manage sessions, enforce access control, or interpret content. A hub serving 10,000 people is 10,000 directories of static files behind `net/http`'s file server. The "dumb hub" of Scenario 6 is literally this.

**Crypto primitives assumed.** I target languages whose standard library provides: Ed25519 sign/verify (Go `crypto/ed25519`, Node `crypto`), X25519 ECDH (Go `crypto/ecdh`, Node `crypto.diffieHellman`), AES-256-GCM (Go `crypto/aes`+`crypto/cipher`, Node `crypto.createCipheriv`), SHA-256, HMAC-SHA256, and base64url. These are all present in Go ≥ 1.20 and Node ≥ 16. Python's stdlib does not include Ed25519 or X25519; a Python implementation would need `cryptography`, which is a dependency. I flag this as a real limitation of the "standard library" constraint for that language.

---

## 2. The Identity Primitive

**A person is an Ed25519 keypair generated on their own device.** The 32-byte public key is the identity. The `key-id` (truncated SHA-256 of the public key) is the address. Nothing else is identity: not a username, not a domain, not a hub account.

**Why not the alternatives:**

- **Domain-based identity (e.g., `alice@family.example`).** The domain is controlled by the hub operator. In the divorce scenario, the hostile ex controls the domain and can reassign, revoke, or impersonate. Rejected because identity must not be in the gift of the adversary.

- **Blockchain / name-registry identity.** A global ledger is a shared-infrastructure dependency (violates Priority 1), introduces a consensus mechanism that is unnecessary for the scale of families, and does not solve the key-custody problem. Rejected.

- **Password / shared-secret identity.** A secret known to both the person and the hub is a secret the hub can use. The hostile operator could authenticate as the person. Rejected because it fails Assurance 1 by construction.

- **Ed25519 vs. ECDSA P-256 vs. RSA.** Ed25519 keys are 32 bytes, signatures are 64 bytes, signing is deterministic (no nonce to mismanage), and the algorithm is in Go and Node stdlibs. P-256 requires careful nonce handling and larger signatures. RSA signatures are huge. Ed25519 is the clear choice for a weekend implementer.

The identity document is the *published binding* of key → person → hub, but the key is the person. The document can be re-published at any hub; the key travels with the person.

---

## 3. The Four Floor Assurances, Mechanism by Mechanism

### Assurance 1: The host cannot speak for you.

**Mechanism.** Every content item carries an Ed25519 signature over a canonical serialization of all its fields except the signature itself. The signing key is generated on the person's device and never transmitted to the hub. The hub stores the signed blob; it never possesses the private key.

**Signing payload construction.** To avoid a JSON canonicalizer dependency, the spec fixes field order and compact encoding. The signing payload is the UTF-8 encoding of:

```
v\nauthor\ntype\ncreated\nbody
```

where `body` is the JSON encoding of the body object with keys in alphabetical order and no whitespace. The implementer builds this string with concatenation, not with a JSON library's `Marshal`. This is three lines of code in any language.

**Failure mode.** A compromised hub can *withhold* items (refuse to serve them) or *serve stale copies*, but it cannot produce a byte string that verifies against the person's public key without the private key. Ed25519 is existentially unforgeable under chosen-message attack. The failure is liveness, not authenticity.

### Assurance 2: The host cannot read what wasn't meant for it.

**Mechanism.** Encrypted content items. The item's `type` field is `"encrypted"`. The body is an encryption envelope (§6) that the hub stores and serves opaquely. Decryption requires the recipient's X25519 private key, which is on the recipient's device, not the hub.

**Failure mode.** If the hub operator is *also* a member of the intended audience (the divorce scenario: the ex is in the family group), they can decrypt on their own device. This is inherent and acknowledged by the brief ("No confidentiality mechanism defeats someone who is inside the audience"). The encryption protects against the hub *as infrastructure*: the server process, the disk, the backup, the commercial host's employees. It does not protect against a family member reading a message addressed to them.

A second failure mode: if the person's device is compromised, the key is compromised. This is outside the protocol's scope.

### Assurance 3: The host cannot keep you.

**Mechanism.** Three properties conspire:

1. The private key was generated on, and never leaves, the person's device. The hub cannot revoke or withhold it.
2. Every item the person published is signed and can be re-published at any other hub. The person's device holds the authoritative copy (or can reconstruct the feed from local storage).
3. A **relocation item** (type `"relocation"`) signed by the person's key announces the new hub URL. It is published at the new hub. Readers who learn the new URL verify the same public key and follow.

The person does not need the old hub's cooperation. They do not need to "export" anything; they already have everything. Leaving is: install app on new hub, publish identity document, sign a relocation, tell your contacts.

**Failure mode.** The old hub can refuse to serve the relocation item, so readers who *only* know the old URL may not discover the move through the protocol alone. They learn through a side channel (a phone call, a text message). This is a social-layer problem the protocol cannot fully solve, but the protocol ensures the move is *verifiable* once the new URL is known.

### Assurance 4: People on other hubs are first-class.

**Mechanism.** Encrypted content is served publicly. Since only intended recipients can decrypt it, there is no access-control decision at the serving hub. A reader on Hub B fetches from Hub A with a plain HTTPS GET. No authentication between hubs, no token exchange, no ACL configuration.

Replies and reactions are published to the *replying person's own hub*, not the original author's hub. The original author's app polls the replying person's hub to discover them. This inverts the usual "post a comment on my server" model and eliminates the need for Hub A to trust Hub B.

**Failure mode.** Hub A can refuse to serve its content to Hub B's users (IP-blocking, rate-limiting). This is a liveness attack, not a confidentiality or integrity attack. The content author can re-publish elsewhere. There is no protocol-level remedy for a hub that refuses to serve; this is equivalent to a website blocking your IP.

---

## 4. Scenario Walk-Throughs

### Scenario 1: The Divorce

**Setup.** Alice's identity lives on `family.example`, operated by her ex, Bob. Alice's Ed25519 and X25519 private keys are on her phone. She has published 200 items over three years.

**What Bob cannot do:**
- Post as Alice: he does not have her Ed25519 private key. Any item he fabricates will fail signature verification.
- Alter or backdate her items: the `created` timestamp and body are inside the signing payload. Changing either invalidates the signature.
- Read her family-only posts to her mother: these are encrypted to her mother's X25519 key. Bob's hub process stores the ciphertext. If Bob is in the family group and the post is addressed to him too, he can read it on his own device — but not as the hub, as a reader. If the post is addressed only to her mother, Bob cannot decrypt it.
- Prevent her leaving: her key is on her phone. She does not need his permission to generate a relocation item.

**The departure.** Alice sets up an account at `alice.example`. She publishes her identity document (same public key) there. She signs a relocation item: `{"type":"relocation","body":{"new_hub":"https://alice.example"}}`. She publishes it at `alice.example`.

**Bob's frozen copy.** Bob still serves Alice's 200 old items at `family.example`. They are validly signed — they *are* her content. But Alice's identity document at `family.example` either still exists (serving the old `hub` field) or has been replaced. Alice's mother's app, which has been told the new URL, fetches `https://alice.example/p/<key-id>`, verifies the same public key, and sees the `hub` field points to `alice.example`. The app marks `family.example` as stale. Bob's copy reads as an archive, not as Alice's current voice. Bob cannot add to it.

**One-tap follow.** Alice's mother's app already stores Alice's public key. Alice sends her mother the new URL (text message, phone call). Mother's app fetches the identity document, confirms the public key matches, and updates its stored hub URL. One tap.

### Scenario 2: Grandma Onboards

**Setup.** Grandma installs the app. The app generates an Ed25519 keypair and an X25519 keypair locally. Grandma picks a display name ("Nana"). She is never shown a key, never asked to manage a file. The app stores the keys in the OS keychain / secure enclave.

**Recovery share.** At setup, the app offers to create a **recovery backup**: the Ed25519 and X25519 private keys encrypted with a passphrase-derived key (using HMAC-SHA256 iterated as a KDF, since we lack Argon2 in stdlib). The app offers to send this encrypted blob to a trusted contact's app. Grandma sends it to her daughter. The daughter's app stores it, labeled "Nana backup."

**One year later: phone lost.** Grandma calls her daughter. Daughter's app has the encrypted backup. Grandma provides her passphrase (or the daughter helps her set a new identity if the passphrase is lost — in which case this is a key rotation from the recovery key, and the old key is declared compromised via a rotation item signed by the recovery key). The app decrypts the backup, imports the keys, and re-publishes the identity document at the same or a new hub. Grandma's identity (public key) is unchanged. Her content, if she had a local copy or if her hub preserved it, is re-linked.

**What the protocol provides vs. what the app provides.** The protocol provides key rotation (a rotation item signed by the old key authorizes a new key). The app provides the UX of encrypted backup and recovery. The protocol does not mandate a backup mechanism; it only mandates that the identity document can be updated with a new key via a signed rotation record.

### Scenario 3: Two Hubs, One Thread

**Setup.** Alice on `a.example`, Bob on `family.example`. Both have Ed25519 + X25519 keypairs.

**Alice posts a family-only photo.** She creates a content item of type `"encrypted"`. The plaintext body is `{"type":"photo","url":"https://a.example/media/img.jpg","caption":"Sunday dinner"}`. She encrypts this to Bob's X25519 public key (§6). She signs the resulting item and PUTs it to `a.example`.

**Bob reads it.** Bob's app polls `https://a.example/p/<alice-key-id>/feed`. It sees a new item of type `"encrypted"`. It attempts decryption: X25519(bob_priv, ephemeral_pub) → shared secret → unwrap CEK from the single slot → AES-256-GCM decrypt → plaintext photo item. Bob sees the photo.

**Bob replies.** He creates a reply item: `{"type":"reply","body":{"target":"<alice-item-id>","text":"Looks great!"}}`. He encrypts the body to Alice's X25519 key. He signs it with his Ed25519 key. He POSTs it to `family.example` (his own hub).

**Alice sees the reply.** Alice's app polls `https://family.example/p/<bob-key-id>/feed`. It sees the encrypted reply, decrypts it, and displays it threaded under her photo.

**Bob reacts.** Same pattern: a reaction item referencing Alice's item ID, encrypted to Alice, signed by Bob, posted to `family.example`.

**No access-control configuration.** Neither hub needed to whitelist the other. All cross-hub traffic is plain HTTPS GET (for reading) and POST to one's own hub (for publishing). The encryption makes serving public safe.

### Scenario 4: The Domain Goes

**Setup.** `family.example` becomes unaffordable. Five family members use it.

**Migration.** Each person generates a new hub URL (a new self-hosted box, a different commercial host, a relative's server). Each publishes their identity document at the new hub, with the same public key. Each signs a relocation item pointing to the new hub.

**Identity continuity.** The public key does not change. The `key-id` does not change. A reader who has `https://family.example/p/<key-id>` bookmarked will, upon fetching, either get a 404 (domain gone) or a stale identity document. If the person has published a relocation at the new hub and communicated the new URL through any side channel, the reader updates. If the reader has the public key stored locally (as any conforming app should), they can verify the identity document at the new URL by checking the key.

**Existing readers find them.** Feed readers (RSS, etc.) that were pointed at `family.example`'s feed will see it go stale or 404. The person publishes a new RSS feed at the new hub. The reader updates the feed URL. This is no different from any website changing its domain. The protocol's contribution is that the *identity* (public key) is unchanged, so the reader can verify continuity.

---

## 5. Key Change and Recovery

**Rotation (planned).** The person generates a new Ed25519 keypair. They create a rotation item:

```json
{
  "type": "rotation",
  "body": {
    "new_key": "<base64url new Ed25519 public key>",
    "note": "optional human-readable reason"
  },
  "created": "2025-07-01T00:00:00Z",
  "author": "<base64url OLD public key>"
}
```

This item is signed by the **old** key. It authorizes the new key. The identity document is then re-published with the new key, signed by the new key. Readers who see the rotation item can verify the chain: old key signs the rotation, new key signs subsequent content.

**Loss.** If the private key is lost and no recovery backup exists, the identity is lost. The person must create a new identity (new keypair) and re-establish trust socially. The old public key becomes inert. This is the price of self-sovereign identity without a global registry. The brief's non-goal of "continuity of a stranger's view of you across total key loss" acknowledges this.

**Theft.** If the person suspects the private key is stolen, they rotate immediately (if they still have the key) or invoke recovery (if they have a backup). The rotation item, signed by the old key, declares the new key. A stolen key that has not yet been used to sign a conflicting rotation is superseded. If the thief signs a conflicting rotation, we have a fork: two rotation items signed by the same old key, authorizing different new keys. Readers must pick one. The protocol cannot resolve this; it is a social problem. The person's best defense is to rotate quickly and tell their contacts through a trusted channel.

**Contested departure.** The hostile hub operator (Bob in the divorce) claims Alice's relocation is a forgery. But the relocation is signed by Alice's Ed25519 key. Bob does not have this key. He cannot produce a valid signature. He can claim the key was compromised, but he cannot demonstrate this cryptographically. Alice can prove live possession of the key by signing a fresh challenge (the current timestamp, a nonce Bob provides). If she signs it correctly, the key is hers. If Bob produces a different key he claims is "really" Alice's, it will not match the public key that has been signing Alice's content for years. The weight of history is on Alice's side.

The one attack Bob has: if he controls the only URL Alice's contacts know, he can refuse to serve the relocation and serve a warning page instead. But the contacts can reach Alice through a side channel, get the new URL, and verify the public key. The protocol makes the forgery claim *checkable*, which is the most it can do.

---

## 6. The Encryption Construction

**Goal.** Encrypt a content item's body to a set of recipients such that:
- Only holders of the intended recipients' X25519 private keys can decrypt.
- The hub (and any eavesdropper) cannot determine who the recipients are.
- The construction uses only X25519, AES-256-GCM, HMAC-SHA256, and SHA-256.

**Key generation.** Each person generates an X25519 keypair alongside their Ed25519 keypair. Both public keys are in the identity document. The X25519 private key stays on the device.

**Encryption (sender side).** To encrypt a plaintext body `P` to recipients with X25519 public keys $X_1, X_2, \ldots, X_n$:

1. Generate a random 32-byte **Content Encryption Key** (CEK).
2. Generate a random 12-byte **content nonce** $N_c$.
3. Encrypt: $C, T_c \leftarrow \text{AES-256-GCM}(CEK, N_c, P)$ → ciphertext $C$, 16-byte tag $T_c$.
4. Generate a random X25519 ephemeral keypair $(e_{priv}, e_{pub})$.
5. For each recipient $i$:
   a. $s_i \leftarrow \text{X25519}(e_{priv}, X_i)$ → 32-byte shared secret.
   b. $k_i \leftarrow \text{HMAC-SHA256}(\text{key}=s_i,\ \text{msg}=\texttt{"hearth-key-wrap"} \mathbin\| e_{pub})$ → 32-byte wrapping key.
   c. Generate random 12-byte nonce $N_i$.
   d. $E_i, T_i \leftarrow \text{AES-256-GCM}(k_i, N_i, CEK)$ → encrypted CEK.
6. The **encryption envelope** is:

```json
{
  "ephemeral": "<base64url e_pub>",
  "nonce": "<base64url N_c>",
  "ciphertext": "<base64url C || T_c>",
  "slots": [
    {"nonce": "<base64url N_1>", "ciphertext": "<base64url E_1 || T_1>"},
    {"nonce": "<base64url N_2>", "ciphertext": "<base64url E_2 || T_2>"}
  ]
}
```

7. The content item's `type` is `"encrypted"`, its `body` is this envelope. The item is signed normally (§3).

**Decryption (recipient side).** A recipient with X25519 private key $x$:

1. Parse the envelope. Extract $e_{pub}$ and the slots.
2. $s \leftarrow \text{X25519}(x, e_{pub})$.
3. $k \leftarrow \text{HMAC-SHA256}(\text{key}=s,\ \text{msg}=\texttt{"hearth-key-wrap"} \mathbin\| e_{pub})$.
4. For each slot $j$: attempt $CEK_j \leftarrow \text{AES-256-GCM-Decrypt}(k, N_j, E_j)$. If the GCM tag verifies, $CEK_j$ is the CEK. (For a family group, $n \leq 20$, so this is at most 20 attempts.)
5. Decrypt: $P \leftarrow \text{AES-256-GCM-Decrypt}(CEK, N_c, C)$.

**What the hub learns.** The hub sees: the author (from the signature), the timestamp, the fact that the item is encrypted, the number of slots (i.e., the number of recipients), and the ciphertext. It does **not** learn: the recipients' identities (the slots are unlabeled), the plaintext, or the CEK.

**Why not label the slots with recipient key IDs.** Because key IDs are public. Labeling slots with key IDs would reveal the audience to the hub. Unlabeled slots force a trial-decryption, which is cheap for small $n$ and hides the audience.

**Why HMAC-SHA256 instead of HKDF.** HKDF is not in every standard library. HMAC-SHA256 used as a single-step KDF is sufficient here because the input ($s_i$) is already a high-entropy 32-byte Diffie-Hellman output. We do not need HKDF's extract-then-expand structure; we need a PRF keyed by a high-entropy secret, which HMAC provides.

**Why AES-256-GCM instead of ChaCha20-Poly1305.** Both are fine. AES-GCM is in Go and Node stdlibs without additional packages. ChaCha20-Poly1305 is in Go's stdlib (`golang.org/x/crypto/chacha20poly1305` — wait, that's `x/crypto`, not stdlib). In Node, ChaCha20-Poly1305 is available via `crypto.createCipheriv('chacha20-poly1305', ...)`. I choose AES-GCM for maximum stdlib availability, but the spec could allow either.

---

## 7. The Honest Cost Sheet

**What this design is bad at:**

- **Discovery.** There is no directory, no search, no "find my cousin." You learn someone's URL through a side channel. This is fine for families and small groups; it is a wall for any kind of open social network. I accept this.

- **Availability.** If your hub goes down, your content is unavailable until you re-publish elsewhere. There is no replication, no redundancy built into the protocol. A family member's "hub in a closet" is a single point of failure. The protocol could define multi-hub publishing (sign once, PUT to several hubs), but I have not specified it, and it complicates the feed model.

- **Ordering and completeness of the feed.** The feed is an unsigned list maintained by the hub. The hub can omit items, reorder them, or serve a partial feed. The reader has no way to know an item is missing unless they have an independent source. This is a real weakness. A Merkle hash chain over item IDs would let a reader detect gaps, but it adds complexity and I have not included it. I flag this as the choice I am least sure of.

- **Large-group encryption.** The slot-per-recipient model is $O(n)$ in the number of recipients. For a family of 20, this is trivial. For a group of 1,000, the envelope becomes large and trial-decryption becomes slow. The brief says the audience is families and small groups, so I accept this limit.

- **No forward secrecy.** If a recipient's X25519 private key is compromised, all past encrypted items can be decrypted. The ephemeral key per message provides some protection (compromising one message's CEK doesn't compromise others), but the long-term X25519 key is the root. Rotating the X25519 key is possible via the rotation mechanism, but old items remain decryptable with the old key. I do not solve this.

- **Timestamp trust.** The `created` timestamp is self-declared by the author and covered by the signature. A malicious author can backdate their own content. The protocol prevents the *hub* from backdating, but not the author. This is inherent to any self-published system without a trusted timestamping authority, which would be a dependency.

**Where it is more complex than it looks:**

- The signing payload construction ("fixed field order, compact JSON") sounds trivial but is a source of interop bugs. Two implementers who disagree on whether the body's keys are sorted, or whether the `v` field is an integer or a string, will produce different signatures. The spec must include at least three test vectors with exact byte sequences. I have not written them here, but they are essential.

- The "try each slot" decryption is simple but has a subtle timing side channel: the recipient's app will spend different amounts of time depending on which slot is theirs. For a family group, this is not a meaningful attack. For a larger group, it could leak the recipient's index. I accept this.

**Which choices I am least sure of:**

1. **The feed as an unsigned list.** I worry about the hub silently dropping items. A signed feed head (a hash of all item IDs, signed by the author) would help, but it requires the author to re-sign on every publish, which complicates the "dumb hub" model. I have left it unsigned and flagged the risk.

2. **No server-to-server delivery.** Everything is pull-based (readers poll). This means latency for replies: Alice won't see Bob's reply until her app next polls his hub. A push mechanism (webhooks, server-to-server POST) would reduce latency but requires hub-to-hub authentication, which violates the "no access-control agreement" principle. I chose pull. It is simpler. It is also slower.

3. **The identity document as the sole root of trust.** If the hub refuses to serve the identity document, a new reader cannot bootstrap trust. They must obtain the public key through a side channel. This is a usability problem. I do not have a good solution that avoids a global registry.

---

## 8. What I Would Cut

If forced to halve the specification:

**Cut the X25519 encryption entirely.** This removes Assurance 2, which is the most complex part of the protocol. All content becomes signed-but-public. The divorce scenario's confidentiality guarantee evaporates: the hostile hub can read everything. But the other three assurances survive. The spec becomes: Ed25519 signing, identity documents, content items, feeds, relocation, rotation. This is implementable in an afternoon. The encryption can be added as a v2.

If I must keep encryption but cut elsewhere:

**Cut the feed.** Readers fetch items individually by URL. The author's app maintains a list of item URLs and shares it (or the reader crawls a known URL pattern). This removes the hub's ability to reorder or omit items from the feed, at the cost of convenience.

**Cut the reaction and reply types.** Reduce to a single "post" type. Replies and reactions are posts that reference another post's ID in their body. This removes two type definitions and their validation rules. The semantic distinction is in the body, not the type.

**Cut the rotation mechanism.** Key rotation becomes "create a new identity and tell your contacts." This loses the cryptographic chain of custody across key changes but simplifies the spec significantly. The recovery mechanism (encrypted backup held by a trusted contact) still works; it just results in a new identity rather than a continuation of the old one.

The irreducible core, below which the protocol ceases to deliver its floor, is: **Ed25519 keypair on the user's device, signed content items, an identity document binding key to URL, and HTTPS GET/PUT.** Everything else is in service of one of the four assurances or the interop goals, and can be deferred.

---

## Appendix: Wire Shapes

**Identity document** at `GET /p/<key-id>`:

```json
{
  "v": 1,
  "key": "abc123...32-byte-ed25519-pub-b64url",
  "enckey": "def456...32-byte-x25519-pub-b64url",
  "name": "Alice",
  "hub": "https://alice.example",
  "created": "2025-01-15T00:00:00Z",
  "updated": "2025-06-01T00:00:00Z",
  "prev_key": null,
  "sig": "b64url-ed25519-sig-64-bytes"
}
```

Signing payload for the identity document: `v\nkey\nenckey\nname\nhub\ncreated\nupdated\nprev_key` with values in their serialized form, `\n`-separated. (The `sig` field is excluded.)

**Content item** at `GET /p/<key-id>/item/<item-id>`:

```json
{
  "v": 1,
  "author": "abc123...ed25519-pub-b64url",
  "type": "post",
  "created": "2025-06-01T12:00:00Z",
  "body": {
    "text": "Sunday dinner was lovely."
  },
  "id": "b64url-sha256-of-signing-payload",
  "sig": "b64url-ed25519-sig-64-bytes"
}
```

**Encrypted content item:**

```json
{
  "v": 1,
  "author": "abc123...ed25519-pub-b64url",
  "type": "encrypted",
  "created": "2025-06-01T12:00:00Z",
  "body": {
    "ephemeral": "b64url-32-byte-x25519-ephemeral-pub",
    "nonce": "b64url-12-byte-content-nonce",
    "ciphertext": "b64url-aes-gcm-ciphertext-and-tag",
    "slots": [
      {"nonce": "b64url-12b", "ciphertext": "b64url-encrypted-cek-and-tag"},
      {"nonce": "b64url-12b", "ciphertext": "b64url-encrypted-cek-and-tag"}
    ]
  },
  "id": "b64url-sha256-of-signing-payload",
  "sig": "b64url-ed25519-sig-64-bytes"
}
```

**Feed** at `GET /p/<key-id>/feed`:

```json
{
  "v": 1,
  "author": "abc123...ed25519-pub-b64url",
  "updated": "2025-06-01T12:00:00Z",
  "items": [
    "https://alice.example/p/abc123/item/xyz789",
    "https://alice.example/p/abc123/item/uvw456"
  ]
}
```

The feed is not signed. Each item URL points to a self-authenticating item.

**Relocation item:**

```json
{
  "v": 1,
  "author": "abc123...ed25519-pub-b64url",
  "type": "relocation",
  "created": "2025-07-01T00:00:00Z",
  "body": {
    "new_hub": "https://newhub.example"
  },
  "id": "...",
  "sig": "..."
}
```

**Rotation item:**

```json
{
  "v": 1,
  "author": "abc123...OLD-ed25519-pub-b64url",
  "type": "rotation",
  "created": "2025-07-01T00:00:00Z",
  "body": {
    "new_key": "b64url-new-ed25519-pub",
    "new_enckey": "b64url-new-x25519-pub"
  },
  "id": "...",
  "sig": "...signed-by-OLD-key..."
}
```

**RSS/Atom interop.** The hub (or a bridge process) renders public, unencrypted items as an RSS 2.0 or Atom feed at `/p/<key-id>/feed.xml`. Encrypted items are omitted. This is a presentation-layer concern outside the core protocol. A Mastodon or Bluesky bridge reads this feed and re-posts. No protocol extension is needed.

---

*End of design.*

<details><summary>Model reasoning trace (39624 chars) — kept because rejected alternatives often live here</summary>

```
The user is asking me to design a decentralized personal publishing and interaction protocol from first principles. This is a substantial design exercise. Let me think through this carefully.

The key constraints:
- No central service, hubs store/serve content over HTTPS
- Adversary is the hub operator (hostile family member)
- Four floor assurances: can't speak for you, can't read what wasn't for it, can't keep you, cross-hub interop
- No third-party libraries (standard library only)
- Easy to implement in a weekend
- Interop with RSS/Atom/JSON Feed and fediverse/Bluesky
- Minimal specification

Let me think about each component:

**Identity primitive:**
The person IS their key pair. Ed25519 is the natural choice - it's in most standard libraries (Python's `hashlib` + `secrets` can generate, but actually Ed25519 signing is in Python's `cryptography` which isn't stdlib... wait, let me reconsider. Actually in Python 3.x, there's no Ed25519 in stdlib. But in Go, `crypto/ed25519` is stdlib. In Rust, it's not stdlib. In JavaScript/Node, `crypto` module has Ed25519 since Node 15+. Let me think about what's actually available.

Actually, the brief says "Ed25519, SHA-256, HTTP, JSON, and base64 are illustrations of what that means in practice, not a closed list — any primitive your target language's standard library actually provides is in bounds." So I should specify which language I'm targeting or which primitives I'm assuming. Let me assume Ed25519 is available (it's in Go stdlib, Node.js crypto, and many others). SHA-256 is universally available. AES-GCM or ChaCha20-Poly1305 for encryption.

Actually, let me reconsider. The brief says "from a language's standard library." Let me assume we're targeting a language where Ed25519, SHA-256, AES-256-GCM (or X25519+ChaCha20-Poly1305), HTTP, JSON, and base64 are all available. Go is a good reference implementation target since `crypto/ed25519`, `crypto/sha256`, `crypto/aes`, `crypto/cipher` (GCM), `encoding/json`, `encoding/base64`, `net/http` are all stdlib. Node.js also works with `crypto` module.

**Architecture:**

Let me think about what artifacts exist:
1. Identity document - the person's public key, current hub URL, any aliases
2. Content items - posts, photos, reactions - each signed
3. Feed - an ordered list of content items
4. Encrypted content - for family-only/private posts

**The identity problem:**
A person is identified by their public key. But humans need a name. The identity is the key. The "address" is a URL where you can find the current identity document. 

Wait, but if the hub is hostile, the identity document on the hub could be tampered with. So the identity document must be signed. And the key must be generated on the person's device, never on the hub.

Let me think about this more carefully:

**Identity = Ed25519 public key.** The "address" of a person is a URL. Initially it's `https://hub.example/.well-known/person/<key-fingerprint>` or similar. But this creates a bootstrapping problem - how do you know the key at the URL is the right one?

Actually, let me think differently. The person's identity IS their key pair. The key is generated on their device. The public key is published. The "address" that people share is the URL of their hub + some identifier. But the identifier should be derived from the key, not assigned by the hub.

Let me think about the URL structure:
- A person's canonical URL: `https://hub.example/p/<short-key-id>` where short-key-id is derived from the public key
- Or: the person publishes at any URL, and the content is self-authenticating via signature

Actually, the simplest approach: 
- Person generates Ed25519 keypair on their device
- They publish their public key in a signed "identity document" at a URL on their hub
- The URL contains a fingerprint of the key (first N bytes of SHA-256 of the public key)
- All content is signed with the private key
- Readers verify signatures against the public key in the identity document

**The divorce scenario:**
- Woman has her key on her device
- She publishes signed content to the hub
- Hub serves it but can't forge signatures
- When she leaves, she takes her key and her content (which she has locally)
- She publishes a new identity document at a new hub
- She needs a way to tell followers "I moved" - this is a signed "relocation" message
- The old hub's copy becomes stale because it can't produce new signed content, and the identity document now points elsewhere

**The "can't keep you" assurance:**
- Key is on the person's device, never on the hub
- Content is signed locally and pushed to the hub
- Person always has a local copy (or can reconstruct from their device)
- Leaving = publish new identity doc elsewhere + sign a relocation notice

**The "can't read" assurance:**
- Public content: signed but not encrypted, anyone can read
- Family-only content: encrypted to specific recipients
- Encryption: use recipient public keys (each person has an Ed25519 key; for encryption, we need a key exchange mechanism)
- X25519 for key exchange + AES-256-GCM or ChaCha20-Poly1305 for symmetric encryption
- Or: Ed25519 keys can be converted to X25519 keys for Diffie-Hellman

Wait, the brief says "No dependencies" and "standard library." Let me check what's available:
- Go: `crypto/ed25519`, `golang.org/x/crypto/curve25519` - wait, curve25519 is in `golang.org/x/crypto` which is NOT stdlib. But `crypto/ecdh` in Go 1.20+ supports X25519. Let me check... Yes, Go 1.20 added `crypto/ecdh` with X25519 support.
- Actually, for the design, I'll specify the primitives needed and note which standard libraries provide them.

Let me reconsider the encryption scheme:
- Each person has an Ed25519 signing key AND an X25519 encryption key (or derive one from the other)
- For encrypted content: sender does X25519 ECDH with each recipient's encryption public key to derive a shared secret, then encrypts content with that key
- Or: generate a random content encryption key (CEK), encrypt content with CEK using AES-GCM, then encrypt CEK to each recipient using X25519+HKDF

Actually, for simplicity and stdlib availability, let me think about what's simplest:
- Option A: For each recipient, do X25519(sender_ephemeral, recipient_public) to get shared secret, encrypt content separately for each. O(n) encryptions.
- Option B: Generate random CEK, encrypt content once with CEK, encrypt CEK to each recipient. O(n) key encryptions but 1 content encryption.
- Option B is better for multiple recipients.

But wait - the brief says "hiding who an encrypted message is for" is NOT a goal (beyond what's inherent). So we can list recipient key IDs in the ciphertext envelope. But we shouldn't reveal the content to the hub.

Let me think about the wire format for encrypted content:

```json
{
  "type": "encrypted",
  "recipients": ["<key-id-1>", "<key-id-2>"],
  "ciphertext": "<base64>",
  "nonce": "<base64>",
  "encrypted_keys": {
    "<key-id-1>": "<base64 of encrypted CEK>",
    "<key-id-2>": "<base64 of encrypted CEK>"
  }
}
```

Hmm, but this reveals the audience. The brief says "hiding who an encrypted message is for" is not a goal beyond what's inherent. So listing recipients is fine? Let me re-read: "Anonymity or traffic-analysis resistance beyond hiding who an encrypted message is for." This means we DO want to hide who it's for. So we shouldn't list recipients in the clear.

OK so the recipients should be hidden. How? 
- Encrypt the recipient list along with the content
- Or: use a scheme where each recipient can try to decrypt and discover they're a recipient
- Simplest: encrypt the entire envelope (including recipient list) and let each potential recipient try their key

Actually, the simplest approach that hides recipients:
- Generate random CEK
- Encrypt content with CEK (AES-256-GCM)
- For each recipient: X25519(sender_ephemeral_priv, recipient_pub) → shared_secret → HKDF → key_wrapping_key → encrypt CEK with AES-GCM
- Store the encrypted CEKs without labels (or with a hash of the recipient's key that only the recipient can recognize)
- The whole blob is opaque; each recipient tries each encrypted CEK slot until one decrypts

Wait, but the recipient needs to know which encrypted CEK is theirs. If we hash the recipient's key ID, that's a preimage that anyone could compute (key IDs are public). So we need something else.

Option: Use X25519 with a fixed ephemeral key per message. Each recipient computes X25519(their_priv, ephemeral_pub) to get the shared secret, then tries to decrypt each CEK slot. If it works (GCM tag verifies), they have the CEK. This is O(n) attempts per recipient but n is small (family group).

Actually, simpler: include the sender's ephemeral public key in the envelope. Each recipient does X25519(recipient_priv, ephemeral_pub) → shared_secret. Then try to decrypt each CEK slot with keys derived from shared_secret. The slot that produces a valid GCM tag is theirs.

But this reveals the ephemeral public key and the number of recipients. The brief says hiding "who" is the goal, not hiding "how many." I think this is acceptable.

Let me also think about: the hub sees the encrypted blob. It knows the sender (from the signature). It knows it's encrypted. It does NOT know the recipients. Good.

**Cross-hub interaction (assurance 4):**
- A on hub-a.example posts family-only content encrypted to B's key
- B on hub-b.example needs to fetch it
- B's hub needs to know where A's content is
- Solution: B follows A's URL. B's hub polls A's hub for new content.
- The encrypted content is served by A's hub to anyone who asks (it's encrypted, so serving it publicly is fine)
- B decrypts with their key
- B replies: B signs a reply, encrypts it to A (and the family group), posts to B's own hub
- A's hub polls B's hub or A's app polls B's hub directly

Wait, but if A's hub is hostile, A's hub might not deliver B's reply to A. But A has their own device. A's app can poll B's hub directly. Or A's new hub (after leaving) can poll.

The key insight: encrypted content can be served publicly because only intended recipients can decrypt it. This means cross-hub delivery is just "fetch the URL." No access-control agreement between hubs needed.

**Feed format and interop:**
- For public content: generate RSS/Atom/JSON Feed from signed posts
- The signed posts are the source of truth; the feed is a derived view
- For fediverse/Bluesky interop: a bridge can read the public feed and post to those networks
- The brief says "with nothing extra built" - meaning the feed format itself is sufficient for a bridge to pick up

**The relocation/migration mechanism:**
- Person signs a "relocation" record: "I, key X, am now at URL Y"
- This is published at the old location (if possible) and the new location
- Followers poll the old URL, see the relocation, follow to new URL
- The old hub can't forge the relocation because it requires the private key
- The old hub CAN refuse to serve the relocation - but the person can tell followers through other channels (in person, phone call, etc.)

**Key recovery (Grandma scenario):**
- Grandma's key is on her phone
- She loses her phone
- She calls her daughter
- How does she recover?

Options:
- Social recovery: daughter has a recovery share of the key
- Backup key: Grandma was given a backup key at setup (but she shouldn't have to manage files)
- The daughter's app can help: at setup, the key is split (Shamir's secret sharing) and shares given to trusted family members

But Shamir's secret sharing isn't in standard libraries. Hmm.

Alternative: at setup, generate two keys - a primary and a recovery. The recovery key is encrypted with a passphrase and given to a trusted person (or stored in a way the app manages). If the phone is lost, the trusted person provides the recovery key, and the identity document is updated to a new key.

Actually, simpler: the app generates the key and can export a "recovery code" (the private key encrypted with a user-chosen passphrase). The app offers to send this to a trusted contact. The trusted contact stores it in their app. When Grandma loses her phone, her daughter's app has the encrypted backup. Grandma provides her passphrase (or the daughter provides it if she knows it), the key is recovered, and a new device is set up.

But wait - "she is never told to store a file outside the house." The recovery happens within the app ecosystem. The daughter's app holds the encrypted backup. This is app-level, not protocol-level. The protocol just needs to support key rotation (updating the identity document to a new key, signed by the old key).

**Key rotation:**
- Sign a new identity document with the old key, specifying the new key
- The new identity document replaces the old one at the same URL
- Or: publish a "key rotation" record signed by the old key

**Contested departure:**
- Woman leaves the hostile hub
- Hostile ex claims her "departure" message is forged
- But the departure message is signed with her key
- The key was generated on her device, never on the hub
- The hub never had the private key
- So the hub cannot forge the signature
- The hub CAN claim the key was compromised, but it cannot produce a valid signature from a key it doesn't have
- The woman can prove the key is hers by signing a challenge in real-time (e.g., signing the current timestamp)

Actually, the deeper issue: the hub could claim that the "real" key was a different one, one that the hub controls. But the identity is bootstrapped from the key the person generated. If the hub tries to substitute a different key, it can't produce signatures that verify against the original public key. The public key is the anchor.

**Let me now structure the full response:**

1. Architecture in one page
2. Identity primitive
3. Four floor assurances, mechanism by mechanism
4. Scenario walk-throughs (1, 2, 3, 4)
5. Key change and recovery
6. Encryption construction
7. Honest cost sheet
8. What to cut

Let me draft this now. I'll aim for thorough, concrete, argued design.

Let me think about the wire format more carefully.

**Identity Document:**
```json
{
  "v": 1,
  "key": "<base64url Ed25519 public key, 32 bytes>",
  "name": "Alice",
  "hub": "https://hub.example",
  "created": "2025-01-15T00:00:00Z",
  "updated": "2025-06-01T00:00:00Z",
  "prev": null | "<base64url of previous key if rotated>",
  "sig": "<base64url Ed25519 signature over canonical JSON of all other fields>"
}
```

Wait, I need to be careful about canonical JSON. The brief says "no JSON canonicalizer" as a dependency. So I need to define a simple canonicalization or avoid it.

Alternative: sign a fixed-format byte string rather than JSON. Or define a very simple canonical form (keys in alphabetical order, no whitespace).

Actually, the simplest approach: define the signature input as a specific byte sequence, not JSON. For example:
- Concatenate fields in a fixed order with separators
- Sign that byte string

Or: define that the JSON must be serialized with keys in a specific order, no whitespace. This is easy to implement without a canonicalizer - just construct the string manually.

Let me go with: the signing input is the JSON serialized with keys in a fixed order (alphabetical), no whitespace, UTF-8 encoded. This is trivial to implement - just build the string. No canonicalizer library needed.

Actually, even simpler: define a specific binary format for signing. But JSON is easier for humans to debug. Let me go with ordered JSON.

**Content Item:**
```json
{
  "v": 1,
  "id": "<base64url SHA-256 of signing payload>",
  "author": "<base64url author public key>",
  "type": "post" | "photo" | "reaction" | "reply" | "relocation" | "rotation",
  "created": "2025-06-01T12:00:00Z",
  "body": { ... },  // type-specific content
  "sig": "<base64url Ed25519 signature>"
}
```

The `id` is the SHA-256 hash of the signing payload, which makes it a content-addressed identifier.

**Signing payload:** The JSON of the item minus the `sig` field, serialized with keys in fixed order.

**Feed:**
```json
{
  "v": 1,
  "author": "<base64url public key>",
  "items": [ ... content items, newest first ... ],
  "updated": "2025-06-01T12:00:00Z"
}
```

The feed itself isn't signed; each item is individually signed. This means the hub can't add items but could theoretically remove them. The person's device has the authoritative copy.

Actually, should the feed be signed? If the hub can remove items, that's a form of censorship. But the person can re-publish. And the feed is just a convenience - the items are the truth.

Hmm, but for the divorce scenario: the hostile hub could remove items from the feed. The woman has her items on her device. After she leaves, she re-publishes them at her new hub. The old hub's feed becomes stale.

I think individual item signing is sufficient. The feed is a convenience ordering.

**URL structure:**
- Identity document: `https://hub.example/.well-known/person/<key-id>`
  where key-id is base64url(SHA-256(public_key))[:16] (first 16 bytes, 22 base64url chars)
- Feed: `https://hub.example/.well-known/person/<key-id>/feed`
- Individual item: `https://hub.example/.well-known/person/<key-id>/item/<item-id>`

Or simpler: everything under `https://hub.example/p/<key-id>/`

**Polling:**
- A reader fetches the feed URL
- Gets a JSON list of items
- Verifies each item's signature against the author's public key
- For encrypted items, attempts decryption

**First contact:**
- Someone shares a URL: `https://hub.example/p/<key-id>`
- Reader fetches identity document → gets public key, name
- Fetches feed → gets items
- For public items, reads them
- For encrypted items, can't read them unless they're a recipient

**Reactions:**
A reaction is a content item:
```json
{
  "type": "reaction",
  "body": {
    "target": "<item-id being reacted to>",
    "emoji": "❤️"
  }
}
```

**Replies:**
```json
{
  "type": "reply",
  "body": {
    "target": "<item-id being replied to>",
    "text": "..."
  }
}
```

**Relocation:**
```json
{
  "type": "relocation",
  "body": {
    "new_hub": "https://newhub.example",
    "reason": "optional"
  }
}
```
Signed by the person's key. Published at both old and new hub.

**Key rotation:**
```json
{
  "type": "rotation",
  "body": {
    "new_key": "<base64url new Ed25519 public key>",
    "reason": "optional"
  }
}
```
Signed by the OLD key. This authorizes the new key.

Now let me think about the encryption more carefully.

**Encryption construction:**

For a family-only post to recipients R1, R2, R3:

1. Generate random 32-byte Content Encryption Key (CEK)
2. Encrypt the post body with AES-256-GCM using CEK → ciphertext + 12-byte nonce + 16-byte tag
3. Generate random 32-byte X25519 ephemeral keypair (eph_priv, eph_pub)
4. For each recipient Ri with X25519 public key Xi:
   a. Compute shared_secret = X25519(eph_priv, Xi) → 32 bytes
   b. Derive key_wrapping_key = HKDF-SHA256(shared_secret, salt=eph_pub, info="key-wrap") → 32 bytes
   c. Encrypt CEK with AES-256-GCM using key_wrapping_key → encrypted_cek_i + nonce_i + tag_i
5. Bundle: eph_pub, ciphertext, nonce, [encrypted_cek_i + nonce_i for each i]

The recipient does:
1. Compute shared_secret = X25519(recipient_priv, eph_pub)
2. Derive key_wrapping_key = HKDF-SHA256(shared_secret, salt=eph_pub, info="key-wrap")
3. Try each encrypted_cek slot: decrypt with key_wrapping_key. If GCM tag verifies, that's the CEK.
4. Decrypt content with CEK.

The number of slots reveals the number of recipients but not who they are. The brief says we need to hide "who" but the number leaking is acceptable.

Wait, but the hub knows who the author is (from the signature). And the hub knows all the keys on the hub. If there are only 3 people on the hub and the encrypted message has 2 slots, the hub can guess. But this is a small-group scenario and the brief acknowledges this limitation implicitly.

Actually, re-reading: "No confidentiality mechanism defeats someone who is inside the audience." So if the hub operator is a family member with their own key, they can decrypt family-only content they're addressed to. The encryption protects against the hub AS A SERVER, not as a reader. The hub process shouldn't have access to decryption keys. The keys are on the person's device.

Hmm, but if the hub operator is a family member, they have their own device with their own key. They can decrypt content addressed to them. That's by design - they're in the audience. The encryption protects against the hub AS INFRASTRUCTURE (the server process, the storage) reading content.

So the threat model for encryption is:
- The server process / storage should not be able to read encrypted content
- The hub operator, if they are ALSO a family member with their own key, CAN read content addressed to them (they're in the audience)
- The hub operator, if they are NOT in the audience, CANNOT read the content

This is consistent with the brief: "No confidentiality mechanism defeats someone who is inside the audience."

**X25519 key derivation from Ed25519:**
Ed25519 and X25519 use different curves (both Curve25519 but different forms). You can convert an Ed25519 key to X25519:
- Ed25519 private key → X25519 private key: hash the Ed25519 seed with SHA-512, take first 32 bytes, clamp
- Ed25519 public key → X25519 public key: birational map (multiply by u-coordinate conversion)

This conversion is well-defined but implementing it from scratch is non-trivial. Alternative: have two separate keys per person (one Ed25519 for signing, one X25519 for encryption). The identity document contains both public keys.

This is simpler to implement. Let me go with two keys:
- Signing key: Ed25519 (for signing content)
- Encryption key: X25519 (for Diffie-Hellman key agreement)

Both generated on the person's device. Both public keys in the identity document.

**What about HKDF?** HKDF is in Go's `crypto/hkdf` (stdlib since Go 1.22? Actually I think it's in `golang.org/x/crypto/hkdf`... let me check. No, `crypto/hkdf` was added in Go 1.22. For Node.js, `crypto.hkdfSync` is available since Node 15.) 

If HKDF isn't available, I can use HMAC-SHA256 directly as a KDF: KDF(secret, info) = HMAC-SHA256(key=secret, msg=info). This is a valid KDF construction.

Let me just specify: use HMAC-SHA256 as the KDF, since HMAC is universally available in stdlibs.

**Now, let me think about the "big lazy hub" scenario (10,000 people):**
- Each person has their own key and signs their own content
- The hub just stores and serves content
- No per-person crypto on the hub side
- Cost is storage + bandwidth, flat per identity
- The hub doesn't need to verify signatures (readers do that)
- Or the hub can verify signatures to avoid storing garbage, but that's optional

**Weekend implementer:**
The protocol needs to be simple enough:
1. Generate Ed25519 keypair + X25519 keypair
2. Create identity document, sign it
3. POST to hub
4. Create content item, sign it
5. POST to hub
6. GET feed from hub
7. Verify signatures
8. For encryption: X25519 + AES-GCM

All of these are straightforward with stdlib crypto.

**Interoperability with RSS/Atom/JSON Feed:**
- The public feed can be rendered as RSS/Atom/JSON Feed
- The hub (or a bridge) generates the feed XML/JSON from the signed items
- This is a presentation layer, not part of the core protocol
- The signed items are the source of truth; the feed is a view

For fediverse/Bluesky:
- A bridge reads the public feed and posts to ActivityPub / AT Protocol
- This is an external bridge, not part of the protocol
- The protocol just needs to make the content accessible in a structured format

OK, I think I have enough to write a comprehensive design. Let me structure it now.

Let me also think about what the protocol CANNOT do:
- It can't prevent the hub from serving stale content (but signatures + timestamps make staleness detectable)
- It can't prevent the hub from dropping messages (but the sender has a copy)
- It can't prevent a family member in the audience from leaking content
- It can't provide anonymity
- It can't scale to millions of items per person (by design)
- Key loss without recovery setup means identity loss

Let me also think about the "stale" content problem in the divorce scenario:
- After the woman leaves, the old hub still has her old signed content
- A reader fetches from the old hub and sees old content
- How do they know it's stale?
- The identity document at the old URL should be updated to point to the new hub (relocation)
- If the hostile hub refuses to serve the relocation, readers might not know
- But the woman can tell her mother directly (phone call, in person) "I'm at this new URL now"
- The mother's app fetches the new URL, gets the new identity document
- The old content at the old hub is still valid (it IS signed by her key) but the identity document now lives elsewhere
- The old hub can't add NEW content (can't sign)
- Readers can check: is there a relocation record? If the old hub doesn't serve one, but the reader knows the new URL through another channel, they can check the new identity document

Actually, I think the key insight is: the identity document is the anchor. It's signed. If the old hub serves an identity document that says "I'm at hub.example" but the real one (at the new hub) says "I'm at newhub.example", readers who know the new URL can verify. But readers who only know the old URL are stuck unless the old hub cooperates.

Mitigation: the relocation record is also published at the new hub. So if you learn the new URL through any channel, you can verify it's the same person (same key or valid rotation). The old hub becomes irrelevant.

For the "one tap" following: the mother's app already has the woman's public key. When the woman moves, she tells her mother the new URL (or the app discovers it through a relocation record). The mother's app verifies the identity document at the new URL has the same public key. One tap to confirm.

Let me now write the full design document.

One more thought on the structure. The brief asks for specific sections:
1. Architecture in one page
2. Identity primitive
3. Four floor assurances
4. Scenario walk-throughs (1, 2, 3, 4)
5. Key change and recovery
6. Encryption construction
7. Honest cost sheet
8. What to cut

Let me write this as a thorough, argued design document. I'll aim for around 4000-5000 words as the brief suggests.

Let me also think carefully about the "no dependencies" constraint. The primitives I need:
- Ed25519 sign/verify: Go `crypto/ed25519`, Node `crypto.sign('ed25519', ...)`, Python... hmm, Python stdlib doesn't have Ed25519. But the brief says to say which primitives I'm assuming. I'll target Go and Node.js as reference implementations.
- X25519 ECDH: Go `crypto/ecdh` (Go 1.20+), Node `crypto.diffieHellman` with X25519
- AES-256-GCM: Go `crypto/aes` + `crypto/cipher`, Node `crypto.createCipheriv('aes-256-gcm', ...)`
- SHA-256: universal
- HMAC-SHA256: universal
- HTTP: universal
- JSON: universal
- Base64url: universal

All of these are in Go stdlib and Node.js stdlib. Good.

Let me also think about whether I need X25519 specifically or if I could use something simpler. The issue is: for encryption, I need a key agreement mechanism. Options:
1. X25519 ECDH (requires X25519 implementation)
2. Encrypt CEK directly with recipient's public key (requires public-key encryption, like RSA - but RSA isn't great for this)
3. Pre-shared keys (impractical for dynamic groups)

X25519 is the right choice. It's in Go and Node stdlibs.

Actually wait - I should double-check. In Go, `crypto/ecdh` was added in Go 1.20 and supports X25519. In Node.js, `crypto.diffieHellman` supports X25519 keys since Node 13 or so. In Python, `cryptography` library has it but it's NOT stdlib. In Rust, it's not stdlib.

So my target implementations are Go and Node.js. I'll note this.

One more consideration: the brief mentions "a dumb hub that serves both" for the weekend scenario. The hub is just a static file server with a POST endpoint. It stores files and serves them over HTTPS. It doesn't need to understand the content. This is important for simplicity.

Actually, the hub needs to:
1. Accept POST of identity documents and content items
2. Store them
3. Serve them over GET
4. Maybe maintain a feed index

That's it. No crypto, no access control, no user management. Just a key-value store with HTTPS.

OK, I'm ready to write. Let me be thorough and concrete.

Let me think about one more thing: the "no access-control agreement between hubs" requirement for assurance 4. This means:
- Hub A doesn't need to authenticate Hub B
- Hub A doesn't need to check if Hub B is "allowed" to fetch content
- Encrypted content is served to anyone who asks (it's encrypted, so this is safe)
- Public content is served to anyone
- Replies and reactions are posted to the REPLYING person's hub, not the original author's hub
- The original author's app/hub polls the replying person's hub to see replies

This is the key architectural insight: all content is public (in the sense of being fetchable by anyone), but private content is encrypted. Access control is in the encryption, not in the serving.

This means the hub is truly dumb. It doesn't need to know about access control, authentication between hubs, or any of that. It just serves bytes.

Let me finalize the design and write it up.

Actually, one more thing about the "people on other hubs are first-class" requirement. Let me trace through a full interaction:

1. Alice on `alice.example` posts a family-only photo, encrypted to Bob's key
2. The encrypted item is stored on `alice.example`
3. Bob on `bob.example` polls Alice's feed at `https://alice.example/p/<alice-key-id>/feed`
4. Bob sees the encrypted item, decrypts it with his X25519 key
5. Bob wants to reply. He creates a reply item, signs it with his key, encrypts the text to Alice
6. Bob POSTs the reply to `bob.example` (his own hub)
7. Alice's app polls Bob's feed at `https://bob.example/p/<bob-key-id>/feed`
8. Alice sees the encrypted reply, decrypts it

No interaction between the hubs. No authentication between them. No access control configuration. Just HTTP GET and POST.

For reactions:
1. Alice posts a public post
2. Bob creates a reaction item referencing Alice's item ID, signs it
3. Bob POSTs to his own hub
4. Alice's app polls Bob's feed, sees the reaction

For family-only reactions:
1. Alice posts a family-only post (encrypted to Bob)
2. Bob creates a reaction, signs it, encrypts the reaction to Alice
3. Same flow as above

This works! The key insight is that all interaction is through signed, optionally-encrypted items served over plain HTTPS. No hub-to-hub protocol needed.

Now let me write the full document.

Let me think about the format of the signing payload more carefully. I need a canonical form that's easy to implement without a canonicalizer library.

Approach: define the signing payload as a specific byte string constructed by concatenating fields in a fixed order with a separator. For example:

```
signing_payload = v || "\n" || id || "\n" || author || "\n" || type || "\n" || created || "\n" || body_json
```

Where body_json is the JSON serialization of the body with keys in alphabetical order, no whitespace.

Actually, this is getting complicated. Simpler approach: define the signing payload as the JSON of the item with the `sig` field removed, with keys in a specific order, serialized compactly. The implementer just constructs this string manually.

For example:
```
{"author":"...","body":{...},"created":"...","id":"...","type":"...","v":1}
```

Keys in alphabetical order, no whitespace. The body is also serialized with keys in alphabetical order. This is deterministic and easy to implement.

Actually, I realize there's a subtlety: the `id` field is the SHA-256 of the signing payload, but the signing payload includes the `id`. That's circular. Let me fix this:

The `id` is computed from the signing payload EXCLUDING the `id` and `sig` fields. Then the `id` is included in the item but not in the signing payload. Wait, that means the `id` isn't covered by the signature. That's bad.

Better approach:
1. Construct the signing payload from all fields EXCEPT `sig` and `id`
2. Compute `id` = base64url(SHA-256(signing_payload))
3. Sign the signing_payload with Ed25519 → `sig`
4. The full item includes `id`, all fields, and `sig`
5. To verify: reconstruct signing_payload from the item (excluding `id` and `sig`), verify signature, verify `id` matches SHA-256 of signing_payload

This way, the `id` is derived from the content and the signature covers the content. The `id` is just a convenience reference.

Actually, I want the signature to cover everything including the id. Let me reconsider:

1. Construct the content payload from all fields EXCEPT `sig` and `id`
2. Compute `id` = base64url(SHA-256(content_payload))
3. Construct signing_payload = content_payload (same thing, since id is derived)
4. Sign signing_payload → `sig`
5. Full item = content_payload fields + `id` + `sig`

To verify:
1. Extract all fields except `sig` and `id`
2. Reconstruct content_payload
3. Verify SHA-256(content_payload) == id
4. Verify Ed25519 signature over content_payload using author's public key

This works. The `id` is redundant with the signature in some sense, but it provides a stable reference that doesn't require knowing the author's key.

Let me finalize this and write the document.

One more thought on the "stale" problem. After the woman leaves:
- Her old content at the old hub is still valid (signed by her key)
- But she's no longer publishing there
- A reader who only knows the old URL will see old content and no new content
- The identity document at the old URL should contain a relocation, but the hostile hub might not serve it
- Solution: the woman publishes a relocation at her NEW hub
- Readers who learn the new URL (through any channel) can fetch the identity document there
- The identity document at the new URL is signed by the same key
- The reader verifies: same key → same person → this is the current location
- The old hub's content is now "stale" - it's valid but not current
- The reader's app can mark it as stale because the identity document at the old URL either doesn't exist, doesn't match, or points elsewhere

For the "frozen copy reads as stale" requirement:
- The reader's app sees that the identity document at the old URL is missing or different
- Or: the reader's app has a "last seen" timestamp and notices no new content
- Or: the new identity document has a `prev_hub` field pointing to the old URL, and the reader can compare
- Simplest: the reader follows the URL in the identity document. If they're fetching from a URL that doesn't match the `hub` field in the identity document, they know they're at an old location.

Actually, the identity document contains a `hub` field. If the reader fetches from URL X and the identity document says `hub: Y` where Y ≠ X, the reader knows X is stale and should follow Y.

But the hostile hub might not serve the identity document at all, or might serve a modified one. Since the identity document is signed, the reader can detect modifications. If the hub doesn't serve it at all, the reader can't verify, and should treat the content as unverified/stale.

OK, I think I have a thorough enough understanding. Let me write the document now.

Let me also think about what happens when the hub operator tries to replay old content or backdate content:
- Each item has a `created` timestamp
- The timestamp is part of the signing payload
- The hub can't change the timestamp without invalidating the signature
- The hub CAN serve old items out of order, but the reader can sort by timestamp
- The hub CAN withhold items, but can't fabricate them
- Backdating would require creating a new item with an old timestamp, which requires the signing key

So backdating and alteration are prevented by the signature. Good.

What about the hub serving a mix of real and fabricated items? The reader verifies each item's signature. Fabricated items won't verify. The reader discards them.

What about the hub serving items from a different author as if they're from the target author? The `author` field in the item contains the public key. The signature must verify against that key. If the hub substitutes a different author's item, the signature won't verify against the expected author's key.

OK, I'm confident in the design. Let me write it up now.

Let me structure the response clearly with the 8 sections requested.

For the encryption section, I need to be very specific about the construction. Let me detail it:

**Encryption envelope format:**
```json
{
  "ephemeral": "<base64url X25519 ephemeral public key, 32 bytes>",
  "ciphertext": "<base64url AES-256-GCM ciphertext>",
  "nonce": "<base64url 12-byte nonce for content encryption>",
  "slots": [
    {
      "nonce": "<base64url 12-byte nonce for CEK encryption>",
      "ciphertext": "<base64url AES-256-GCM encrypted CEK, 32 bytes>"
    },
    ...
  ]
}
```

Each slot is an encrypted copy of the CEK for one recipient. The recipient tries each slot.

The signing payload for an encrypted item includes the encryption envelope (or its hash). Actually, the entire item is signed, including the encrypted body. So the signature covers the ciphertext, ensuring integrity.

Wait, the body of an encrypted item is the encryption envelope. The signing payload includes this envelope. So the signature covers the ciphertext. Good.

The item type would be "post" or "photo" etc., but the body is encrypted. Or should the type be outside the encryption? Let me think...

If the type is outside the encryption, the hub knows it's a "post" vs "photo" but not the content. That seems fine. The type is metadata.

Actually, for maximum privacy, encrypt the entire body including the type. But then the hub can't generate an RSS feed from encrypted items. That's fine - encrypted items aren't for public feeds.

Let me have two levels:
- Public items: type and body in the clear, signed
- Encrypted items: type is "encrypted", body is the encryption envelope, signed

The reader sees type "encrypted" and knows to decrypt. The actual content type (post, photo, reaction) is inside the encrypted payload.

This is clean. The hub can serve encrypted items in the feed, and readers who aren't recipients just see an opaque blob.

For the RSS/Atom interop: only public items appear in the feed. Encrypted items are skipped. The feed generator filters them out.

OK, let me write this up now. I'll aim for thoroughness and concreteness.

Let me also address: what does the hub store? 
- Identity documents (one per person)
- Content items (many per person)
- That's it. No databases, no user accounts, no sessions.

The hub is a file server. `POST /p/<key-id>/item` stores an item. `GET /p/<key-id>/feed` returns the list. `GET /p/<key-id>/item/<item-id>` returns one item. `GET /p/<key-id>` returns the identity document. `POST /p/<key-id>` updates the identity document.

The hub doesn't verify signatures (it can, but doesn't have to). It doesn't manage access. It just stores and serves.

For the "big lazy hub" with 10,000 people: each person's content is in a separate directory/namespace. The hub's cost is storage + bandwidth. No per-request crypto. No session management. Flat cost per identity.

OK, now I'll write the full document. Let me be thorough but also concise where possible. The brief says "as long as it needs to be" and prefers 4000+ words of argued design.

Let me draft the full response now.

```

</details>

