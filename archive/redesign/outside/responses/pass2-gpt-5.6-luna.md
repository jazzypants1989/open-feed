---
model: gpt-5.6-luna
pass: 2
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T22:02:51.795Z
prompt: PROMPT-pass2.md
prompt_sha256: e808057730fa1e8528c594da5513c840a16897c944e6bf2b03a576244d5ed8f5
reasoning_effort: medium
finish_reason: null
tokens: {"prompt_tokens":7072,"completion_tokens":4610,"total_tokens":11682,"prompt_tokens_details":{"cached_tokens":1617}}
wall_seconds: 48
truncated: false
reasoning_chars: 0
---
## A. Attack on the other direction

The most serious failure is the combination of **“the publisher forgets”** and an unspecified backup requirement.

### Concrete divorce attack: portability fails

1. The woman publishes a year of posts and photos.
2. Her device signs them, and the hostile hub stores them.
3. The application deletes local copies after successful upload, as the direction permits.
4. Her ex notices the divorce and deletes the stored objects.
5. He refuses all export requests and refuses further uploads.
6. She obtains a new hub and a new client.

She still has her signing key, but not “everything she wrote.” The hub was the only copy. The protocol has delivered neither assurance 3 nor scenario 1.

A signed tombstone does not help. It proves deletion, but does not reconstruct the deleted content.

This is not an implementation bug. It follows from making the publisher forget and making backup UX optional. The specification must require at least one user-controlled durable copy, even if the application hides the fact that it is a cryptographic backup.

### Domain-loss attack

There is a second, related failure in scenario 4.

1. Readers know only `https://family.example`.
2. The family publishes a higher-sequence location statement only to `family.example`.
3. The domain expires or the hostile operator suppresses the new statement.
4. The new hub comes online elsewhere.

Readers cannot discover it. The new statement exists, but no reader can obtain it.

Remembering every location ever named does not solve this: the new location was never learned. A resolver is explicitly optional, so “existing readers find them” is not guaranteed.

This is an unavoidable limitation without one of:

- a surviving old endpoint;
- a pre-published alternate endpoint;
- a contact who forwards the signed statement;
- a resolver or directory;
- a reader-side backup of the statement.

The direction is honest about the limitation, but the limitation conflicts with the stated domain-loss scenario if that scenario is a requirement rather than an aspiration.

### Another important attack: head equivocation by omission

The direction says the head lists what exists, but does not define what a reader should do when the hub serves an older head.

If the woman publishes a departure at sequence 20 and the ex serves a previously valid head at sequence 19:

- a reader who has seen sequence 20 detects staleness;
- a reader who has never seen sequence 20 does not.

That is acceptable as an availability limitation, but it must be stated. A signed head is not a proof that the hub has shown the complete current history. It is merely a signed publisher statement. The phrase “notice when something it saw vanishes” is useful, but not completeness in the stronger sense.

### Choices I think are right

- **Identity as a key** is correct and essential.
- **The hub as storage, not signer** is the right trust boundary.
- **A publish interface** is excellent. It prevents the protocol from quietly becoming “use our application on our hub.”
- **Signing exact bytes** is attractive. It avoids canonicalization traps, provided the signed file and the served file are unambiguously the same bytes.
- **Separate authored feeds for replies and reactions** is a good decentralized model. It avoids inbox ownership and cross-hub ACL negotiation.
- **Sealed recipient identities** are better than publishing an audience list.
- **Pull as the core** is simpler and leaks less than a mandatory push channel.
- **Treating deletion as a tombstone rather than promising erasure** is realistic.

The social recovery idea is reasonable for families, but it needs a precise trust and discovery rule.

---

## B. Attack on my own design

My design made several promises too casually.

### 1. I assumed the local archive into existence

I wrote that the application maintains a complete local archive, but the brief explicitly requires that Grandma need not know about keys or files. That is not enough. The protocol should specify a durable encrypted local vault and backup behavior, while allowing the UI to hide it.

Otherwise my design has exactly the other team's portability failure.

### 2. My recovery design was underspecified

I proposed recovery trustees, but did not specify:

- how many are required;
- whether the policy is public;
- how readers learn that a recovery certificate is valid;
- what happens if recovery trustees disagree;
- how the old encryption key is recovered.

A replacement signing key does not decrypt old private posts. Recovery must separately preserve the old encryption private key, in an encrypted recovery package, or old private history is lost.

### 3. Relocation was not sufficient for discovery

My signed relocation statement works only for readers who receive it. A hostile old hub can suppress it. I mentioned alternate endpoints, but did not make them a required availability strategy.

No signed protocol can make a reader discover an entirely unknown endpoint when every known endpoint is unavailable. I should have stated that as a hard impossibility, then specified pre-published redundancy and contact-mediated forwarding.

### 4. My manifest was not a completeness proof

A signed manifest listing objects lets readers detect a stale sequence, but only if they have seen a newer sequence. It does not prove that a first-contact hub is showing the newest head.

I should have used the term **publisher view**, not completeness proof. A transparency witness or independent mirrors would improve this, but would add infrastructure explicitly contrary to the brief.

### 5. My cryptographic construction was too confident

The X25519/HKDF/AEAD envelope construction is plausible, but “plausible” is not “reviewed.” It needs exact domain separation and binding of:

- protocol version;
- object identifier;
- author key;
- recipient encryption key;
- ephemeral public key;
- ciphertext nonce;
- algorithm identifiers.

Otherwise envelope substitution and cross-protocol attacks become possible.

The other team's instinct to reject an in-house construction is right. However, “audited off-the-shelf” conflicts with the no-third-party-package priority unless the platform standard library already supplies it.

### 6. I blurred signed objects and interop views

RSS, Atom, and JSON Feed are generated views. They should not be treated as signed authoritative objects unless the exact generated bytes are signed. My design should have made the content-addressed signed object the authority and the feeds explicitly projections.

The other direction is clearer here.

### 7. I did not adequately specify hub write semantics

I described storage paths but not the write contract. A minimal hub should accept immutable content-addressed files and signed profile/head files without needing identity-specific trust.

---

## C. Reconciled design

The best design is a hybrid, with a stricter distinction between:

1. **identity and authorship**;
2. **confidentiality**;
3. **availability and backup**;
4. **freshness and discovery**.

Cryptography solves the first two. It cannot solve the latter two without surviving copies or rendezvous points.

### Identity

An identity is the SHA-256 fingerprint of an Ed25519 signing public key.

A signed profile contains:

- signing key;
- encryption key;
- display metadata;
- endpoint list;
- recovery policy;
- profile sequence;
- predecessor hash;
- signature.

Keys are separate: Ed25519 for signatures, X25519 for encryption.

### Objects

An authored object is an immutable file:

```text
object-id = sha256(exact-served-bytes)
```

Its bytes contain a fixed binary header and payload. The signature covers the exact bytes excluding the signature field, or, more simply, covers a deterministic “unsigned file” prefix followed by a signature trailer.

No JSON canonicalization is required.

Objects include:

```text
author
object-id
created
kind
parent-ids[]
audience
payload
signature
```

Public objects contain plaintext. Private objects contain an encrypted payload and anonymous recipient envelopes.

### Encryption

For each private object:

1. Generate random content key `K`.
2. Encrypt the serialized object payload with AEAD.
3. For each recipient encryption key:
   - generate ephemeral X25519 key;
   - derive a wrapping key using HKDF-SHA-256;
   - AEAD-encrypt `K`;
   - include no recipient identifier.

The KDF context binds:

```text
"SPO envelope v1"
object-id
author-key
recipient-key
ephemeral-key
```

The recipient tries envelopes until one decrypts and the resulting object signature and object ID verify.

This hides recipient names, but not:

- object existence;
- size;
- timing;
- envelope count;
- traffic metadata;
- access patterns.

Fixed polling can reduce fetch correlation but cannot eliminate it. I would not promise more.

### Head

The head should be a third, small, signed file, not the generated feed.

It contains:

```text
identity
head-sequence
previous-head-hash
object-ids[]
tombstone-ids[]
generated-at
signature
```

For the expected scale, listing all object IDs is acceptable. A Merkle root could reduce head size, but creates proof and traversal complexity that the brief does not need.

The head is a signed declaration of the publisher's current view, not a proof of global completeness.

A reader:

- rejects invalid heads;
- remembers the highest sequence;
- recognizes lower sequences as stale;
- detects conflicting same-sequence heads;
- notices removal of previously observed objects;
- does not infer that an unseen object never existed.

Generated RSS/Atom/JSON Feed views are derived from the head and public objects. They are interop surfaces, not authoritative records.

### Publish interface

Use immutable PUTs:

```text
PUT /objects/<sha256>
Body: exact signed object bytes
```

The hub verifies that the path hash equals the body hash. It may optionally verify the signature, but need not understand the identity.

For the profile and head:

```text
PUT /profiles/<identity>/<sequence>-<hash>
PUT /heads/<identity>/<sequence>-<hash>
```

Readers retrieve a small conventional pointer or fetch the highest available sequence. The pointer itself is not authoritative; the signed profile/head is.

A hub may implement authentication, quotas, and authorization operationally, but those are not protocol trust assumptions.

### Mandatory local custody

The application must keep, in a user-controlled encrypted vault:

- private keys;
- authored objects;
- attachments;
- profile and head history;
- recovery package;
- known relocation statements.

The UI may hide all of this. “No file outside the house” means no manual file handling, not no durable local storage.

The application should make at least one automated encrypted backup possible. The protocol cannot require a particular cloud or family service, but it should define an export format.

### Recovery

The profile contains a recovery policy:

```text
recovery-key-1
recovery-key-2
recovery-key-3
threshold = 2
```

A recovery transition is valid if:

- the old key signs it; or
- the declared threshold of recovery keys signs it.

This is ordinary multiple-signature authorization, not a threshold signature primitive.

The recovery policy should be public. Existing readers need it to validate a recovery they did not personally witness. Publishing the recovery contacts leaks a social relationship, so privacy-sensitive users may encrypt the policy to selected readers—but then strangers cannot validate recovery. For this family protocol, I would make it public.

Recovery must address two things separately:

- replacement signing key;
- encrypted backup of the old encryption private key.

If the latter is unavailable, old private content is intentionally unrecoverable.

### Relocation and discovery

Every profile should contain at least two independently hosted endpoints where possible. Relocation is signed and published to all old and new endpoints before migration.

Readers retain all previously known endpoints and signed relocation statements.

The protocol should also define a simple contact card:

```text
identity fingerprint
latest signed profile or head
known endpoints
signature/reference
```

A relative can forward this card through any ordinary channel. This is not a global directory and does not violate the no-infrastructure requirement.

Still, there is a hard limit:

> If all old endpoints disappear, no reader retained a relocation statement, and nobody forwards a contact card, discovery is impossible.

That should be an explicit limitation, not hidden behind the word “resolver.”

### Replies and reactions

Replies and reactions are ordinary objects in their authors' feeds, with parent object hashes.

For a private parent, the author must know the recipient encryption keys. A reply is encrypted to the parent audience, or to a declared subset. No hub ACL is required.

---

## Answers to the five open questions

### 1. Publish interface

Use immutable, hash-addressed PUTs for objects, profiles, and heads. Do not use mutable conventional filenames as the authoritative upload target.

A hub may expose a convenience API, but every compliant hub must support:

```text
PUT immutable object
GET immutable object
GET current or highest profile
GET current or highest head
```

The hub need not possess identity keys or application logic.

### 2. Encryption construction

I would refuse to approve an in-house construction.

Given the stated dependency rule, I would specify a small, fully reviewed composition of standard-library primitives:

- X25519;
- HKDF-SHA-256;
- AES-GCM or ChaCha20-Poly1305;
- Ed25519.

The specification must include test vectors and exact domain separation. If the target language does not provide these safely, the language cannot meet the no-dependency goal for this protocol.

### 3. Social recovery threshold and publication

For families, I favor a public 2-of-3 or 2-of-5 recovery policy, signed into the profile.

The right threshold depends on:

- expected family size;
- coercion risk;
- whether trustees can be reached independently;
- whether recovery must work when one household is hostile.

A divorce scenario argues against putting all trustees in the same household. The policy should therefore require geographic or administrative diversity where practical.

### 4. What is the head?

A separate signed head is the cleanest answer.

The generated feed is a view and may vary in formatting, enclosure URLs, and truncation. It should not be the cryptographic head.

The head lists object IDs and tombstones. It is authoritative only as the publisher's signed current declaration.

### 5. Push and delivered channels

I would omit push and direct-message delivery from the core.

Push adds:

- recipient discovery;
- inbound authentication;
- replay and delivery semantics;
- metadata and abuse problems;
- a new path the hostile hub controls.

Pull handles posts, replies, and reactions and preserves the hub-independence property. A later push extension can be defined as an optimization, never as the only delivery path.

## What neither direction considered

The most important missing framing is an explicit **availability theorem**.

Both designs spend considerable effort on authenticity and confidentiality, but availability is different:

- signatures prevent forgery;
- encryption prevents reading;
- local custody enables exit;
- replication and rendezvous enable discovery and continued access.

No key design, head format, or recovery certificate can make a vanished endpoint discoverable without a surviving copy of the relevant location statement or an independent rendezvous channel.

A second useful primitive neither fully developed is **independent witness/mirror replication**. A few trusted relatives could automatically retain signed heads and relocation statements. This is not a blockchain, DHT, or global registry. It is simply redundant custody of signed data. It materially improves divorce and domain-loss behavior, but costs storage and creates social availability dependencies.

I would not solve global freshness or global deletion. They require infrastructure or authority that conflicts with the brief. The protocol should instead label views as:

- valid;
- stale relative to a known sequence;
- incomplete or unknown.

That modest claim is achievable and honest.
