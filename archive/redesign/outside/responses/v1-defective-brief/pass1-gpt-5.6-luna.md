---
model: gpt-5.6-luna
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:13:14.860Z
prompt: PROMPT-pass1.md
prompt_sha256: eab389889e055bcb32bc4532edc2183f780d8a267227464b47a9a9e220cae542
finish_reason: null
tokens: {"prompt_tokens":1547,"completion_tokens":5543,"total_tokens":7090}
wall_seconds: 58
truncated: false
reasoning_chars: 0
---
# Proposed protocol: Signed Personal Hubs (SPH)

The protocol has one deliberately sharp boundary:

> A hub is a cache and transport, not an identity provider and not an authority.

The identity belongs to a signing key. A hub may publish, withhold, reorder, or delete objects, but it cannot create valid objects for that identity.

One requirement is impossible without an additional communication path: if a domain disappears completely, and no reader has cached a redirect and no one sends readers a relocation announcement, there is no way for a reader to discover the new location. HTTP, DNS, and cryptography cannot solve that. The design therefore supports migration for existing readers through cached signed relocation records, old-hub redirects, or an out-of-band announcement. It does not pretend to provide global discovery.

## 1. Architecture

Each person has:

1. **Identity key**
   - Ed25519 signing key.
   - Identity is `id = base32(SHA256(ed25519_public_key))`.
   - The private key is generated and stored on the person's devices, never on the hub.

2. **Encryption key**
   - X25519 key pair, separate from the signing key.
   - Its public key is included in the signed identity document.

3. **Identity document**
   - Signed by the identity signing key.
   - Contains:
     - identity ID;
     - signing public key;
     - encryption public key;
     - current service URLs;
     - display name and profile data;
     - key-rotation and recovery policy;
     - monotonically increasing document version.

4. **Content objects**
   - Posts, replies, reactions, attachment descriptors, and tombstones.
   - Each is signed by the author.
   - Each has a sequence number and previous-object hash where applicable.

5. **Hub**
   - Stores opaque objects and serves them over HTTPS.
   - It need not understand their contents.
   - It may serve public objects in RSS, Atom, and JSON Feed representations.
   - It may expose a JSON API for signed objects.

6. **Relocation record**
   - A signed statement saying:
     ```
     identity X is now also served at URL Y
     ```
   - Existing readers cache these records.
   - A cooperating old hub can return HTTP 308 with the signed record.
   - A hostile or vanished hub cannot be compelled to do so.

### Object representation

Transport uses ordinary JSON, but signatures do not cover JSON serialization. They cover a small specified byte sequence:

```text
domain = "sph/1"
type
identity_id
sequence_number
previous_hash
created_at
content_hash
ciphertext_or_plaintext
attachment_hashes
```

Each field is encoded as:

```text
uint64_be(byte_length) || raw_bytes
```

Fields occur in the fixed order above. Integers are unsigned big-endian. Strings are UTF-8. Hashes and signatures are raw bytes before base64 transport encoding.

A JSON object might look like:

```json
{
  "type": "post",
  "id": "...",
  "author": "...",
  "seq": 42,
  "prev": "...",
  "created": "2025-03-08T12:00:00Z",
  "body": "...",
  "ciphertext": false,
  "sig": "..."
}
```

The JSON is merely an envelope. An implementation does not need a JSON canonicalizer.

### First contact

Given a service URL, a reader fetches:

```text
GET /.well-known/sph
```

It obtains the identity document and verifies:

1. the document's signature;
2. that its identity ID hashes to the declared signing key;
3. that the URL is listed as a current service URL.

The reader then fetches the current manifest:

```text
GET /sph/manifest
```

The manifest contains signed object summaries and the latest sequence number. Objects are fetched by hash or object ID.

The reader stores:

- the identity document;
- the highest verified sequence;
- object hashes;
- known relocation records;
- recipient encryption keys.

### Polling

A poll fetches the manifest with `If-None-Match` or a protocol-specific cursor. The reader verifies every new object before displaying it.

A hub may return an older valid manifest. A reader that has already seen a higher sequence marks that response stale. A first-time reader cannot detect rollback by the hub; this is an unavoidable limitation without an external consistency witness.

## 2. Identity

A person is an Ed25519 public key, not:

- a username;
- an email address;
- a domain;
- a hub account;
- a URL.

The identity string is a hash of the public key, which makes it compact and safe to use as a storage key.

### Why not a domain?

Domains are movable, expirable, and controlled by third parties. They are useful locators but poor identities.

### Why not a username?

Names collide and require a global registry. They also provide no cryptographic authentication.

### Why not a certificate authority?

A certificate authority makes a third party authoritative over identity. It also introduces a dependency the design does not need.

### Why not a blockchain or DHT?

Neither is necessary for signing, encryption, export, or ordinary following. Both add availability and implementation costs while failing to solve key theft or a malicious audience member.

The cost is that an identity is not naturally memorable. Applications display a chosen name, domain, and profile, but security decisions use the key fingerprint.

## 3. The four assurances

### 3.1 The host cannot speak for you

Every identity-bearing object is signed by the author's Ed25519 key.

The hub can:

- fabricate unsigned objects;
- alter signed objects;
- claim that an object belongs to another person;
- replay an old valid object;
- omit objects.

It cannot produce a new valid object without the signing key.

The reader must display unsigned hub metadata as hub metadata, never as the person's content.

#### Limitation: equivocation

A malicious hub can show different valid histories to different readers. Sequence numbers and previous hashes detect inconsistent histories when two readers compare notes, but do not prevent a hub from withholding one branch.

A stronger design would require signed periodic checkpoints witnessed by other hubs. That adds coordination, so it is not part of the minimal protocol.

### 3.2 The host cannot read what was not meant for it

Public content is intentionally public.

Private content is encrypted before upload. The hub receives ciphertext, not plaintext.

The hub may nevertheless learn:

- that an object exists;
- its approximate size;
- upload time;
- which service URL stored it;
- access timing;
- possibly the number of recipient envelopes;
- attachment sizes and traffic patterns.

It also learns the author of an uploaded object from the transport context unless the user uses another transport. This protocol does not promise anonymity.

A person who is an intended recipient can read and copy the content. No encryption scheme changes that.

### 3.3 The host cannot keep you

The device creates:

- the identity key;
- every signed object;
- the private encryption key;
- a local encrypted archive.

Uploading is replication, not publication of the only copy.

An export is a directory containing:

```text
identity.json
keys/
objects/
attachments/
manifest.json
relocations/
```

All objects are self-verifying. A new hub can serve the same identity immediately.

The hub can refuse to provide its copy, but it cannot prevent use of the local copy. The practical failure mode is loss of all devices and backups.

### 3.4 People on other hubs are first-class

A post does not name a hub ACL. It names recipient encryption keys.

To send to B:

1. A fetches B's signed identity document from B's hub.
2. A verifies B's identity and encryption key.
3. A encrypts the post to B's public encryption key.
4. A uploads the resulting object to A's hub.
5. B's application fetches A's public object stream, or receives an ordinary notification containing its object URL.
6. B decrypts locally.

No hub needs to approve the relationship. Neither hub needs a shared access-control database.

A hub can refuse to serve A's object to B, but then it is withholding content, not enforcing cryptographic authorization. B can fetch from another replica or directly from A's new hub.

## 4. Encryption construction

I would use separate X25519 encryption keys rather than attempting to reuse Ed25519 signing keys. Key reuse is easy to get wrong and makes rotation harder.

The cryptographic suite is:

- X25519;
- HKDF-SHA-256;
- ChaCha20-Poly1305, or an equivalent authenticated encryption primitive.

If the implementation environment lacks those primitives, they must be implemented or provided by a small cryptographic package. SHA-256 alone is not a safe substitute for authenticated encryption. This is the main place where the “standard library only” requirement is unrealistic.

### Private object format

A private post contains:

```text
version
author_id
object_id
ephemeral_x25519_public_key
nonce
ciphertext
recipient_envelopes[]
author_signature
```

The plaintext is:

```text
content_type
reply_target
reaction_target
body
attachment_descriptors
```

The author generates a random 256-bit content key `K`.

It encrypts the plaintext with:

```text
AEAD_Encrypt(
    key = K,
    nonce = random,
    associated_data = signed_object_header,
    plaintext
)
```

For each recipient, including the author if desired:

1. Generate an ephemeral X25519 key pair.
2. Compute:
   ```text
   shared = X25519(ephemeral_private, recipient_public)
   ```
3. Derive:
   ```text
   wrapping_key = HKDF-SHA256(
       shared,
       salt = object_id,
       info = "sph recipient envelope v1"
   )
   ```
4. Encrypt `K` under `wrapping_key`.

The envelope contains only:

```text
ephemeral_public_key
nonce
wrapped_content_key
```

It does not contain the recipient ID or public key.

Every recipient downloads the envelope list and attempts decryption with their private key. Usually implementations can optimize this by indexing locally, but the wire format does not publish an audience list.

This leaks the number and approximate size of recipient envelopes. Hiding that would require padding every post to a fixed envelope count or an anonymous mailbox system, neither of which is worth the initial complexity.

### Replies and reactions

A reply to a private post includes the target object's hash. That hash is public metadata. The reply itself is encrypted to the original post's recipients plus the reply author, according to the author's chosen audience.

The protocol does not assume that every recipient of a parent post is entitled to every reply.

A reaction is a signed object. For a private object, it is encrypted to the relevant audience. The hub can store reactions without understanding them.

## 5. Key changes, loss, and theft

### Normal rotation

The old identity key signs a transition:

```text
old_identity
new_signing_public_key
new_encryption_public_key
new_version
reason
```

The new identity document includes the old-key signature. Readers accept the new key as the continuation of the old identity.

The old key remains in the document as historical evidence but is not accepted for new objects after the transition point.

### Device addition

A device key is an authorized signing key listed in the identity document. A simpler implementation can keep one signing key in an encrypted device vault; a more robust implementation gives each device its own key and has the identity key sign device certificates.

The weekend implementation should start with one active signing key and encrypted backups.

### Key theft

If an attacker obtains the signing key, they can produce valid-looking posts. Cryptography cannot distinguish the owner from the thief.

The owner can use a previously configured recovery policy to revoke the key and authorize a new one. Readers who see the revocation stop accepting later objects from the stolen key.

A malicious hub can hide the revocation from readers. It cannot make readers who have received the revocation accept the stolen key again.

### Key loss

The preferred recovery mechanism is encrypted social backup:

- the private identity key is split into, for example, 3-of-5 shares;
- each share is encrypted to a trusted contact's encryption key;
- no share is stored on the hub;
- recovery contacts combine shares on the new device.

The app can perform this without showing Grandma a key or asking her to manage a file.

If all shares and all devices are lost, continuity is lost. That is an explicit non-goal.

A recovery quorum can authorize a new signing key, but this means the quorum is trusted to recover the identity. That is unavoidable.

### Contested departure

Suppose the woman leaves the hostile hub and publishes a new identity document or relocation record.

The record is verifiable under her signing key. The ex can say “this is forged,” but cannot create a competing record unless he has the key. Readers compare the signature and identity fingerprint, not the hub's assertion.

If the ex stole the key, the situation is genuinely ambiguous until a recovery revocation is accepted. There is no cryptographic solution to possession of the signing key.

The ex can continue serving old signed posts. Readers should show them as belonging to an earlier sequence and stale service location, not as newly authored content.

## 6. Scenario walkthroughs

### Divorce

The woman’s device generated her signing and encryption keys. The hostile hub has only ciphertext, signed objects, and a copy of her public identity document.

He cannot:

- sign a new post as her;
- modify an existing post;
- change its sequence or timestamp without invalidating its signature;
- decrypt posts encrypted only to her and selected recipients;
- prevent her device from exporting her archive.

He can delete or suppress objects and can show old valid objects. Her application identifies the old copy as stale once it has a newer signed sequence or relocation record.

She uploads her identity document and archive to a new hub. Her mother’s app follows the signed relocation record and needs no new identity relationship.

If her mother had never seen the relocation record and the old hub disappears, the app cannot discover the new hub without an out-of-band announcement. That is the unavoidable discovery limitation.

### Grandma

The app creates the key and stores it in its encrypted local keystore. It presents Grandma only with a display name.

The app silently creates social recovery shares and sends them to her daughter and other chosen contacts. Grandma is not asked to copy a seed phrase.

After losing her phone:

1. she installs the app;
2. chooses “recover identity”;
3. calls enough recovery contacts;
4. the contacts' apps transfer encrypted shares;
5. the new device reconstructs the identity key locally.

The hub is not involved in recovery.

### Two hubs, one thread

A's app fetches B's identity document and verifies B's encryption key. A encrypts a family-only post to B and other selected recipients.

The post is stored at A's hub. B's app fetches it over HTTPS and decrypts it. B replies with a separately signed encrypted object. A fetches B's object from B's hub.

Neither hub configures an ACL. The authorization is in the object itself.

### Domain loss

Before the move, each reader has cached A's identity document and service URLs. A publishes a signed relocation record pointing to the new hub.

Existing readers try the old URL, receive the record if the old host cooperates, or use the cached record directly. They fetch the same identity and object hashes at the new URL.

If the domain is simply allowed to expire with no redirect and no prior cached relocation, readers cannot find the new hub. A protocol with no global directory cannot guarantee this case. The practical mitigation is to publish relocation records well before expiration and distribute them through existing readers, email, or social networks.

## 7. Interoperation

Public posts are rendered as:

- RSS 2.0;
- Atom;
- JSON Feed.

The feed contains the ordinary title, body, dates, links, and author display name. A signature can be included as an extension, but ordinary readers need not understand it.

A fediverse bridge can publish public posts as Mastodon statuses. A Bluesky bridge can create records using the normal public APIs. Nothing special is needed for public reading.

Those systems will not automatically preserve SPH private-object semantics. Private posts remain SPH-only unless deliberately copied into another system.

Replies from those systems can be imported later as signed SPH objects whose source is identified as an external account. Proving that an external account belongs to the same person is an application-level link, not an identity fact.

## 8. Honest cost sheet

Bad at:

- global discovery after total disappearance of a domain;
- preventing a hub from censoring or withholding;
- preventing a legitimate recipient from forwarding plaintext;
- hiding metadata and traffic analysis;
- detecting a hub's equivocation without readers comparing histories;
- recovering an identity after total key and backup loss;
- making private content work in ordinary RSS readers.

More complex than it first appears:

- canonical signing bytes;
- attachment addressing and garbage collection;
- key rotation;
- social recovery;
- replay and stale-history handling;
- reliable encrypted recipient envelopes;
- deciding whether private replies include all parent recipients.

The least certain choice is the encrypted recipient-envelope format. It hides recipient names from the hub but leaks envelope count and requires recipients to try envelopes. A more scalable design would use opaque recipient mailboxes, but that introduces routing infrastructure and can become a hidden global dependency.

The four assurances are not all equally absolute:

- authenticity is strong while the key is safe;
- confidentiality excludes intended recipients and metadata leakage;
- exit depends on the device copy surviving;
- cross-hub operation works cryptographically, but availability still depends on some fetch path.

## 9. What I would cut in half

I would initially cut:

1. multi-device signing certificates;
2. encrypted reactions;
3. automatic external reply import;
4. sophisticated append-only checkpoints;
5. social recovery quorum authorization for key replacement.

The first version would retain:

- one Ed25519 identity key;
- one X25519 encryption key;
- signed identity documents;
- signed immutable objects;
- encrypted private posts;
- local export;
- signed relocation records;
- public RSS, Atom, and JSON Feed output.

That subset delivers the central property: a hub can host a person, but it cannot become that person, read ciphertext not addressed to it, or become the only place where the person's identity and work exist.
