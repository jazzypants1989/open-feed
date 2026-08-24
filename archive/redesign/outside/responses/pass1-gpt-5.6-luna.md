---
model: gpt-5.6-luna
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:46:52.733Z
prompt: PROMPT-pass1.md
prompt_sha256: ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d
reasoning_effort: medium
finish_reason: null
tokens: {"prompt_tokens":1620,"completion_tokens":5794,"total_tokens":7414}
wall_seconds: 59
truncated: false
reasoning_chars: 0
---
# Proposed protocol: Signed Personal Objects (SPO)

Two requirements are impossible as literally stated:

1. **A reader cannot find a person after every old endpoint disappears** without some surviving rendezvous point, directory, or previously known replacement address.
2. **A hostile hub cannot be prevented from withholding content or traffic.** Cryptography can prove that an object is authentic or confidential, but cannot make an uncooperative server serve it.

The design below satisfies the four assurances except for those unavoidable availability and rendezvous limits. It gives the domain-migration scenario a practical solution by requiring identities to publish more than one endpoint, or to keep the old domain as a redirect.

---

## 1. Architecture

An identity is a public signing key, not a domain, username, or hub account.

Each identity has:

- a signing keypair;
- an encryption keypair;
- a recovery configuration;
- one or more HTTPS endpoints;
- signed objects;
- a local export containing all private material and authored objects.

A hub is only an object store and HTTPS server. It need not understand users, permissions, threads, or encryption.

### Objects

There are five important object types.

#### Identity document

Contains:

```text
identity_key
encryption_key
display_name
endpoints[]
sequence
previous_document_hash
recovery_keys[]
created
expires
signature
```

It is signed by the identity signing key.

The identity identifier is:

```text
spo:sha256:<hash of signing public key>
```

Names and domains are merely metadata.

#### Content object

Contains:

```text
type = post | photo | reply | reaction | profile | ...
author_identity
object_id
created
audience = public | private
thread_parent     optional
payload or ciphertext
attachments[]
signature
```

The signature covers every field except the signature itself.

#### Encryption envelope

For a private object, the payload is encrypted once with a random content key. The content key is separately encrypted for every recipient.

The envelopes contain no recipient identifier.

#### Recovery or key-transition object

A signed statement authorizing a new signing key, normally signed by the old key and optionally by recovery trustees.

#### Endpoint or relocation statement

A signed statement saying:

```text
identity
new_endpoints[]
effective_sequence
previous_endpoints[]
signature
```

It may be served by any endpoint.

### Storage layout

A minimal hub can serve:

```text
/.well-known/spo/<identity-hash>/identity
/.well-known/spo/<identity-hash>/manifest
/objects/<object-hash>
/attachments/<attachment-hash>
```

The manifest is signed and lists object hashes, or lists signed batches of object hashes.

An even simpler hub may serve a static directory copied from the publisher.

### First contact

A reader is given an HTTPS identity URL, QR code, or feed URL. It fetches:

1. the identity document;
2. the signed manifest;
3. the public feed, if the reader supports RSS, Atom, or JSON Feed;
4. referenced objects.

The reader records:

- the identity public key;
- the first-seen document;
- the endpoint list;
- object hashes already seen;
- the highest valid identity-document sequence.

### Polling

The reader fetches the current identity document and manifest, verifies them, and downloads unknown objects.

A host may omit, delay, reorder, or replay objects. It may not alter a valid object without invalidating its signature.

---

## 2. Wire encoding

The protocol does not sign JSON. JSON has several equivalent serializations, and relying on an external canonicalizer violates the dependency requirement.

The cryptographic wire format is a small deterministic binary encoding:

```text
field := uint32_be(length) || bytes
record := field(type) || field(version) || field(each named field)
```

Fields occur in fixed specification order. Integers are unsigned big-endian. Strings are UTF-8. Lists carry a count followed by records. Unknown fields are rejected in signed core objects.

The signature input is:

```text
"SPO/1\0" || object_type || canonical_binary_fields
```

The signature is Ed25519 over that byte sequence.

JSON, RSS, and Atom are projections of signed objects. They are not authoritative representations.

Assumed standard-library primitives:

- SHA-256;
- Ed25519;
- X25519;
- HKDF-SHA-256;
- an authenticated encryption mode such as AES-GCM or ChaCha20-Poly1305;
- HTTPS/TLS;
- secure random generation;
- base64 for presentation formats.

Where a language lacks X25519 or an AEAD mode in its standard library, the implementation must either use another standard-library public-key encryption primitive or state that the platform cannot implement SPO without additional code. “Implement Ed25519 yourself” is not a reasonable weekend requirement.

---

## 3. What is a person?

A person is a signing public key.

The identifier is the SHA-256 fingerprint of that key. A display name can change. A domain can change. A hub can change. The key is the stable identity.

### Alternatives rejected

#### Domain name

A domain is controlled by a registrar and DNS provider. It fails immediately during divorce, hosting disputes, and domain loss.

#### Hub account

The hub operator controls account creation and deletion. It lets the hub speak for the user.

#### Email address

Email addresses are mutable, often controlled by providers, and do not provide object authentication.

#### Username plus password

Passwords authenticate to a service. They do not let readers verify old material after migration.

#### Certificate authority identity

A CA can be useful for transport security, but it makes identity depend on an external authority and introduces revocation and issuance policy that this protocol does not need.

The tradeoff is that a public-key fingerprint is not human-friendly. The application should show “Mum” and a short fingerprint warning only when keys change.

---

## 4. The four assurances

## 4.1 The host cannot speak for you

Every identity-authored object is signed by the identity signing key.

The hub can:

- fabricate an unsigned object;
- alter a signed object;
- serve a different object at the same URL;
- claim that an object belongs to another identity.

The reader rejects all of these.

The host may replay an old valid object. It may also create a new object if it possesses the private key. Therefore the private signing key must never be stored unencrypted on the hub.

### Failure mode

If the private key is stolen, the thief can sign as the identity. Cryptography cannot distinguish the owner from someone holding the key. Recovery and key-transition mechanisms handle this after detection, not before.

A signature proves authorship by the key, not physical presence of the human.

---

## 4.2 The host cannot read what was not meant for it

Public objects are plaintext.

Private objects use envelope encryption.

### Encryption procedure

The sender:

1. generates a random 256-bit content key `K`;
2. serializes the plaintext object;
3. encrypts it using AEAD:

```text
nonce = random 96 bits
ciphertext = AEAD_Encrypt(K, nonce, plaintext, associated_data)
```

The associated data includes:

```text
protocol version
object id
author identity
audience mode
```

This prevents moving ciphertext between objects.

For each recipient:

1. obtain the recipient's signed encryption public key;
2. generate an ephemeral X25519 keypair `(e_priv, e_pub)`;
3. calculate:

```text
shared = X25519(e_priv, recipient_public_key)
wrap_key = HKDF(shared, salt=object_id, info="SPO envelope")
```

4. encrypt `K` using an AEAD under `wrap_key`;
5. publish:

```text
ephemeral_public_key
wrap_nonce
wrapped_content_key
```

No recipient identity is included.

The private object is:

```text
object metadata
ciphertext nonce
ciphertext
envelopes[]
author signature
```

A recipient tries each envelope with their private encryption key. If decryption succeeds and the resulting object verifies, the envelope is theirs.

For a family-sized audience this is acceptable. It is O(number of envelopes) per object. A recipient may cache which envelope position works for a sender, but that is an optimization.

### Why not publish recipient identifiers?

A list such as:

```text
[to: Alice, Bob]
```

would reveal the audience to the hub. Instead, the hub sees anonymous cryptographic envelopes.

### What the hub still learns

The hub learns:

- who published the object;
- when it was uploaded;
- its size;
- how many recipient envelopes it contains;
- that it is private;
- which clients fetch it;
- traffic timing and network metadata;
- possibly correlations between posts and replies.

It does not learn the plaintext or the recipient names from the object itself.

A recipient, of course, can read and copy the content. This protects against the hub, not against an authorized audience member.

### Cross-hub delivery

A posts a private object on `a.example`. B's application fetches A's object directly, or A's application copies the ciphertext to B's hub. Neither hub needs an access-control agreement.

B's encryption key was obtained from B's signed identity document. The object is encrypted to B before either hub stores it.

A reply is a new signed object authored by B, normally encrypted to the participants. Its `thread_parent` is A's object hash or identity-plus-object URL.

### Failure mode

The hub can refuse to serve the ciphertext. No protocol can force a hostile server to deliver bytes. Replication to several hubs and local caching reduce this risk.

---

## 4.3 The host cannot keep you

The publishing application maintains a local encrypted vault containing:

- the signing private key;
- the encryption private key;
- recovery configuration;
- every authored object;
- attachments;
- identity and relocation statements;
- a list of known contacts and their keys.

Publishing uploads a copy; it does not create the original.

An export is a directory or archive of these files. It needs no hub-specific database.

The user can leave by:

1. stopping uploads to the old hub;
2. starting a new hub or using another HTTPS endpoint;
3. publishing a signed relocation statement;
4. giving the new endpoint to readers, or relying on an already-published alternate endpoint.

The old hub can retain a frozen copy, but it cannot make that copy current.

### Failure mode

The host can:

- delete its copy;
- block exports;
- refuse to serve the identity;
- serve a stale view.

Local storage and replication handle deletion. Nothing handles the case where the user has lost every local copy and every remote copy.

---

## 4.4 People on other hubs are first-class

The protocol has no hub-level ACL.

Access is granted by encrypting an object to recipient identity keys. The recipient's hub does not need to know the sender's policy, and the sender's hub does not need to trust the recipient's hub.

A reader can fetch objects from arbitrary HTTPS origins. A person is not “a member of a hub”; they are an identity with a keypair and endpoints.

The limitation is availability: either hub can refuse federation or direct HTTP retrieval. The cryptographic model still works without cooperation.

---

## 5. Ordering, manifests, and stale copies

Each signed object has:

- a random object ID;
- a creation timestamp;
- an optional parent object;
- the author's signature.

The publisher also signs manifests containing object hashes and a monotonically increasing manifest sequence.

A manifest may include:

```text
manifest_sequence
previous_manifest_hash
object_hashes[]
signature
```

This gives readers a useful history when they have seen successive manifests.

It does not provide global ordering. A hostile hub can show one reader a forked or stale manifest and another reader a different one. Without a witness, quorum, or ledger, readers cannot know which is freshest.

The application should say:

- “published according to the author's signed timestamp”;
- “last manifest observed”;

not “globally proved to have been published at time X.”

A host cannot backdate an object in the sense of making it appear to have been signed before the key existed, but the legitimate key holder can sign an object today containing yesterday's timestamp. This is unavoidable without trusted time.

---

## 6. Key change, loss, and theft

## Normal rotation

The old key signs:

```text
old_identity
new_signing_key
new_encryption_key
sequence
reason = rotation
signature
```

Readers accept the new key only through a valid transition from the old key.

The new key then signs a fresh identity document.

Old content remains verifiable under the old key.

## Planned revocation

The old key signs:

```text
identity
revoked_key
replacement_key
effective_sequence
signature
```

Readers stop accepting new objects from the revoked key after the effective sequence.

## Lost key

The user chooses recovery trustees during setup. For example, three relatives each receive a recovery public key or an encrypted recovery share. The policy can require two of three signatures.

A recovery certificate contains:

```text
identity fingerprint
replacement signing key
replacement encryption key
recovery sequence
trustee signatures
```

Readers accept it if the required quorum signs it.

The recovery trustees do not receive the everyday private key. They can authorize a replacement key, but cannot decrypt old private posts unless the user separately gave them that ability.

The application can automate this. Grandma need never see a key or file.

## Stolen key

The owner uses a recovery quorum to revoke the stolen key and authorize a new one. Content signed by the stolen key remains cryptographically valid historically; it is not erased. Readers distinguish:

- objects signed before revocation;
- objects signed after the revocation sequence.

If the thief races the owner, readers need a sequence policy and, ideally, multiple recovery trustees. There is no perfect solution for two conflicting parties holding the same key and both signing before a revocation becomes visible.

## Contested departure

Suppose the old hub claims the relocation statement is forged.

A reader that already knows the identity key verifies the relocation signature directly. The hub's denial has no evidentiary value.

A new reader needs an introduction to the identity key. It can obtain:

- the old signed identity document;
- a cached copy from another reader;
- a contact's signed reference;
- a QR code or export from the user.

If the hostile hub serves an old identity document, the reader compares sequence numbers and transition signatures.

If the old key was lost, the reader verifies the recovery quorum instead.

The old hub can continue displaying old, valid posts. It cannot make them current after a valid transition, assuming the reader sees the transition.

---

## 7. Scenario walkthroughs

## 7.1 Divorce

The woman's phone holds her signing and encryption private keys and a complete local archive.

Her ex's hub has only:

- public objects;
- encrypted private objects;
- her public keys;
- uploaded signatures.

He cannot create a valid new post as her. He cannot decrypt a post encrypted only to her mother and siblings. He can delete or withhold his copy, but her phone retains the originals.

She publishes a relocation statement pointing to `new.example`. Her mother's application sees the signed transition and follows the new endpoint.

The ex's server can still serve old posts. They verify as old objects under her key, but they are not accepted as the current feed after the newer manifest and relocation statement.

The ex can lie about timestamps or suppress the transition from his server. A reader with another endpoint, a cached copy, or the transition itself can resolve that. A reader that can see only the hostile server cannot be forced to learn the truth.

## 7.2 Grandma

The application generates keys locally and stores them in its encrypted application data. It displays “Grandma,” not cryptographic material.

During setup, her daughter and two other relatives become recovery trustees. Their devices store only recovery authorization material.

When Grandma loses her phone:

1. she installs the application again;
2. calls her daughter;
3. the daughter and another trustee approve a replacement key;
4. the application creates a new identity document through the recovery protocol;
5. the application fetches the old archive from any surviving hub or family backup;
6. old posts remain signed by the old key, while new posts use the new key.

This does not restore encrypted old posts unless the new device also receives the old encryption private key or a separately backed-up copy of it. Therefore the application should back up the encryption private key to an encrypted recovery package. Trustees can authorize release of that package, but cannot read it themselves.

If all backups are lost, old private content is unrecoverable by design.

## 7.3 Two hubs, one thread

A's public identity document lists an encryption public key. B's document does likewise.

A encrypts a family-only post with a random content key and creates envelopes for B and the other family members. A publishes the ciphertext on `a.example`.

B's app fetches it directly. It tries the anonymous envelopes, decrypts the content key, and verifies A's signature.

B replies with a new signed object:

```text
author = B
thread_parent = hash(A's object)
audience = same family set
ciphertext = ...
```

B publishes the reply on `family.example`.

A's reader follows the parent reference and fetches B's reply. No ACL exchange occurs between hubs.

## 7.4 Domain migration

Before `family.example` expires, the identity publishes:

```text
endpoints = [
  https://new-family.example,
  https://backup.example
]
```

The statement is signed and replicated to all endpoints. Readers follow it.

If the old domain disappears after this statement was seen, migration works.

If the old domain disappears before anyone sees the statement, readers can still find the person through a surviving backup endpoint or a previously known new endpoint.

If the domain disappears and there is no surviving endpoint, no cached relocation, no contact reference, and no directory, discovery is impossible. This is not a protocol deficiency; it is an information-theoretic limitation. The protocol should require endpoint redundancy for users who need this guarantee.

---

## 8. Interoperability

A public SPO post can be rendered as:

- RSS 2.0;
- Atom;
- JSON Feed.

The feed includes ordinary public text, media URLs, author display name, and the SPO object URL. A custom link or enclosure can expose the signed object for applications that verify it.

Existing feed readers see ordinary content without understanding SPO.

A Mastodon or Bluesky bridge can consume the feed and publish it using its existing APIs. That gives interoperability for public content. The resulting Mastodon or Bluesky account is not automatically the same cryptographic identity unless the bridge includes a signed identity reference.

Replies from those systems are an optional extension. Their own signatures and moderation semantics are not SPO signatures.

Private objects cannot appear in ordinary feeds without either exposing plaintext or requiring an SPO-aware client.

---

## 9. Cost sheet and uncertainties

### Bad at

- Guaranteed availability against a hostile hub.
- Automatic discovery after every endpoint vanishes.
- Anonymous metadata.
- Large audiences: per-recipient envelopes become expensive.
- Strong global ordering.
- Proving real-world publication time.
- Revoking content already delivered to a recipient.
- Preventing an authorized recipient from forwarding content.
- Recovery without trusting any person or device.

### Operational complexity

The cryptography is not the hardest part. Difficult areas include:

- safe key backup;
- recovery UX;
- key rotation races;
- handling multiple devices;
- deciding which manifest is freshest;
- attachment deduplication;
- importing and exporting encrypted archives;
- explaining stale versus deleted content.

### Least certain choices

The least certain choice is anonymous recipient envelopes. They provide the requested audience privacy but require trying envelopes and leak count and size. A private per-recipient inbox would improve efficiency but reveal recipients to the hub.

The second uncertain choice is recovery quorum policy. Recovery improves usability but creates social trust and possible coercion. A purely local key is safer against trustees but fails Grandma's scenario.

---

## 10. What I would cut in half

I would cut:

1. manifest chains, keeping only individually signed objects and a signed object index;
2. multi-device conflict handling;
3. anonymous envelope optimization and accept recipient identifiers;
4. recovery quorum, initially using one encrypted family recovery package;
5. built-in RSS/Atom projections, leaving them to a small adapter.

I would not cut:

- identity-key signatures;
- local export;
- encrypted content keys;
- signed key transitions;
- endpoint relocation;
- content-addressed object storage.

Those are the minimum mechanisms supporting the four assurances.

The essential conclusion is that the protocol can make a hostile hub an untrusted cache rather than an authority. It cannot make that cache available, honest about freshness, or capable of discovering a completely vanished identity without some surviving copy or rendezvous point.
