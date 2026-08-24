---
model: hy3
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:48:05.608Z
prompt: PROMPT-pass1.md
prompt_sha256: ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":1622,"completion_tokens":4008,"total_tokens":5630,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":1625}}
wall_seconds: 132
truncated: false
reasoning_chars: 6636
---
# Protocol Design: "Latch"

## 1. Architecture in one page

**Core idea.** A *person* is an Ed25519 keypair. The public key is the identity. Everything a person
publishes is a signed JSON object. A *hub* is a dumb static HTTPS file server that stores those
objects at predictable paths under a user's directory. The hub never sees private keys, never signs,
and cannot modify objects without breaking signatures.

**Artifacts**

| Artifact | Path on hub | Purpose | Signed? |
|---|---|---|---|
| Profile | `/u/<pubkey>/profile.json` | Name, current hub, seq, optional bio | Yes (self) |
| Feed index | `/u/<pubkey>/feed.json` | JSON Feed of public post IDs (newest first) | Yes |
| Public post | `/u/<pubkey>/p/<id>.json` | Text/photo ref, reply-to, ts, seq | Yes |
| Private envelope | `/u/<pubkey>/e/<id>.json` | AES-GCM ciphertext + per-recipient key boxes | Inner post signed; outer envelope not |
| Move note | `/u/<pubkey>/move.json` | New hub URL, seq | Yes |
| Guardian record | `/u/<pubkey>/guardians.json` | Pubkeys of recovery guardians | Yes |

`id` = first 32 hex chars of SHA-256 of the canonical (signature-stripped) post JSON.

**What a reader fetches**
- *First contact*: `GET https://hub/u/<pubkey>/profile.json`, then `feed.json`. For a follow, store
  pubkey + hub.
- *Poll*: re-`GET profile.json` (cheap; seq bump means something changed), then `feed.json` (public)
  and any `e/<id>.json` referenced by profile's `inbox` pointer (or by other posts). Cross-hub
  replies are absolute URLs in `reply_to`.

**Hub behavior.** It accepts `PUT` (or authenticated `POST`) of any bytes to a user's directory if
the object verifies under `<pubkey>` (hub checks sig to avoid garbage, but cannot forge). It serves
static. It may omit or delay; it cannot alter.

---

## 2. Identity primitive

**A person = an Ed25519 public key (32 bytes, base64url).** That is the entire global identifier.
Everything else (name, hub URL, avatar) is a *claim* signed by that key.

**Rejected alternatives**
- *Domain name as identity* (e.g. `@a@a.example`). Fails scenario 4: domain goes, identity changes.
  We need identity to survive hub migration.
- *Handle in a global registry / DHT*. Banned by "no shared infrastructure" and unnecessary.
- *Decentralized identifier (DID) documents*. Adds a layer and a canonicalization dependency; we
  already have a signed profile object that does the job with zero extra machinery.
- *Pairwise pseudonyms*. Would break "people on other hubs are first-class" and make Grandma's life
  harder.

The public key is ugly but never shown to humans except as a QR or "follow code" once. Display name
comes from the latest signed `profile.json`.

---

## 3. The four floor assurances

### 1. Host cannot speak for you
Every post, profile, move, reaction is a JSON object with a `"sig"` field: `base64(Ed25519_sign(
canonical_json_without_sig, privkey))`. Readers verify before display. Hub has no privkey.
*Failure mode*: host can *withhold* your posts or serve an old seq, but cannot emit new ones as you.

### 2. Host cannot read what wasn't meant for it
Private posts are not stored as plaintext on the hub. See §6. Hub stores ciphertext + ephemeral
pubkey + N key-boxes. It cannot decrypt.
*Failure mode*: host learns *that* a private post exists, its size, and how many recipients (count of
boxes). It does not learn who.

### 3. Host cannot keep you
Private key is generated and stored on the user's device. The device holds all signed objects (they
are just files). To leave: bump `seq`, sign `move.json` pointing to new hub, `PUT` it to new hub,
tell followers (they poll profile). Old host's frozen copy is provably stale because `move.json` has
higher `seq` and newer `ts`.
*Failure mode*: if you lose the key, you lose the identity (see §5). Host cannot *prevent* departure.

### 4. People on other hubs are first-class
`reply_to` and `reaction_to` are absolute URLs (`https://otherhub/u/<pub>/p/<id>.json`). A reader
following A fetches B's post from B's hub directly. Access control is end-to-end encryption, not hub
ACLs. No agreement between hubs needed.
*Failure mode*: if B's hub is down, the reply is unresolvable (same as any web link).

---

## 4. Scenario walk-throughs

**1. The divorce.**
Wife's pubkey `W` lives on husband's hub `H`. She writes family-only posts: encrypted envelopes,
hub cannot read. He cannot post as her (no key). He cannot alter/backdate: any changed byte breaks
sig. He can stop serving her `feed.json`; she signs `move.json` to `her.newhub.net` from her phone,
puts it there. Mother (follower) polls `W` profile, sees higher seq + move, updates hub pointer in
one tap. Old copy on `H` shows last `seq` lower than `move.json` now discoverable elsewhere; reader
labels it "stale".

**2. Grandma onboards.**
App generates Ed25519 keypair on her phone. Daughter's pubkey is pre-loaded as *guardian*. Grandma's
key is encrypted to daughter's key and stored in `guardians.json` (she never sees bytes). She picks
name "Grandma". Loses phone. Calls daughter. Daughter decrypts guardee key, provisions new phone,
re-`PUT`s profile to same hub (or new). Seq continues. Grandma is back; no file backup needed.

**3. Two hubs, one thread.**
A on `a.example` posts family-only (encrypted to B, C). B on `family.example` fetches A's feed, sees
envelope, decrypts. B replies: signed public-or-private post with `reply_to:
https://a.example/u/A/p/<id>.json`. A's reader fetches cross-hub. No hub config; encryption did the
ACL.

**4. The domain goes.**
All users on `family.example` had their own keys. Each signs `move.json` to new hub (e.g.
`newhost.net/u/<pub>/`). Followers polling old domain get connection failure; they use last-known
profile's `move` if cached, or re-discover via guardian. Identity (pubkey) unchanged.

---

## 5. Key change and recovery

- *Rotation*: sign new profile with `seq+1` containing new pubkey? No—key rotation means new
  identity. We allow *key replacement* only via guardians: `guardians.json` lists M-of-N pubkeys; a
  `recover.json` signed by K guardians declares new pubkey `W'`. Readers accept `W'` after seeing
  that. Old key revoked.
- *Loss*: guardians decrypt escrowed private key, hand to new device.
- *Theft*: if hostile operator steals device? He still lacks key unless device compromised; key
  never on hub.
- *Contested departure*: Hostile ex claims `move.json` is forgery. But `move.json` is signed by `W`;
  he cannot forge. He may serve a fake `move.json` claiming return to his hub—readers verify sig;
  his fake lacks `W` sig, ignored. He may withhold real `move.json`; followers find it on new hub or
  via guardian gossip.

---

## 6. Encryption construction (Assurance 2)

Primitives assumed in std lib: `Ed25519`, `X25519` (derive from Ed25519 pub via standard conversion),
`SHA-256`, `AES-256-GCM`, `HKDF`.

For a private post to recipients `R1..Rn` (each an Ed25519 pubkey):
1. Build inner post JSON (author, ts, seq, content, visibility:"private"), sign with author key.
2. `K = random 32 bytes`. `nonce = random 12 bytes`. `CT = AES256GCM(K, nonce, inner_json)`.
3. Generate ephemeral X25519 keypair `(eph_priv, eph_pub)`.
4. For each `Ri`: `shared = X25519(eph_priv, Ri_x25519)`; `ek = HKDF(shared, eph_pub||Ri_pub)`;
   `box_i = AES256GCM(ek, nonce2, K)` (or just raw encrypt). No recipient identifier included.
5. Envelope JSON: `{ "id":..., "eph_pub":base64, "nonce":base64, "ct":base64,
   "boxes":[base64,base64,...] }`. Store at `e/<id>.json`.

Recipient: try each `box` with `X25519(self_priv, eph_pub)` → derive `ek` → decrypt to get `K` →
decrypt `ct`. If fails, not for them. Hub sees `boxes` count = N, sizes; learns nothing else.

---

## 7. Honest cost sheet

- **Bad at**: search, full-text indexing, large media (we store only refs/URLs to photos),
  real-time presence, comment threads with thousands of participants.
- **Cannot deliver**: anonymity (pubkey is fixed), forward secrecy (same K per post, but ephemeral
  limits), recovery without a guardian (key loss = identity loss).
- **More complex than looks**: the boxing loop and X25519 conversion; must be specified exactly to
  be interop.
- **Least sure of**: guardian escrow model for Grandma—it puts trust in daughter, but that's
  unavoidable without user-managed backups. Acceptable.

---

## 8. What I would cut

If forced to halve: drop *reactions* and *guardian recovery* (make key loss fatal but simpler);
drop JSON Feed in favor of only Atom; keep public posts, private envelopes, move notes, cross-hub
reply. That removes 40% of spec surface while preserving all four floor items.

---

*Existing protocol note*: ActivityPub + HTTP signatures + Magic Wormhole could approximate this, but
none give assurance 3/4 without massive libs. No off-the-shelf std-lib-only fit exists; hence new.

<details><summary>Model reasoning trace (6636 chars) — kept because rejected alternatives often live here</summary>

```
We need to design a protocol for decentralized personal publishing and interaction, meeting the four floor assurances, with no dependencies beyond standard library, easy to implement, interop with RSS/Atom/JSON Feed and fediverse/Bluesky via bridge (outbound only required), minimal.

We must assume primitives available in standard library: ed25519 (or similar signing), SHA-256, AES? Standard library may have AES? In many languages (Python, Go, Rust) standard library includes AES (via crypto packages, but maybe not "third-party"). The brief says "Ed25519, SHA-256, HTTP, JSON, and base64 are illustrations... any primitive your target language's standard library actually provides is in bounds". So we can assume standard library provides Ed25519, SHA-256, AES-GCM or ChaCha20? Python's stdlib has hashlib (SHA-256), hmac, secrets, but for encryption? Python's cryptography is not stdlib. However, we could use RSA? Actually Python stdlib has no symmetric encryption except maybe via ssl? But we can assume a language like Go has crypto/aes, crypto/cipher, crypto/ed25519, crypto/sha256. So we can specify AES-256-GCM with ephemeral key wrapped per recipient via Ed25519 public key? But we need asymmetric encryption for addressing to recipients without publishing audience. We can use curve25519 for key exchange (std lib in Go: crypto/ecdh? Go 1.20 has crypto/ecdh with X25519). Or we can do ECIES-like: generate ephemeral X25519 keypair, derive shared secret with recipient's public key (from Ed25519? convert to X25519), encrypt content with AES-GCM. The hub stores ciphertext and ephemeral pubkey, cannot map to recipient without knowing recipient's key (but can see count). That's fine.

Identity primitive: a person is a keypair (Ed25519). Their identity is the public key (or its hash) plus a handle for display. No central registry. They publish to a hub via signed objects. Each artifact is a JSON object with fields, signed by author's key. For hub hosting multiple identities, each user has a "user directory" at hub: `https://hub/user/<pubkeyhex>/`. The hub serves static files: `index.json` (feed), `posts/<id>.json`, `encrypted/<id>.json`, etc. The hub is dumb: just stores and serves bytes; cannot modify because signatures verified by readers.

Assurance 1: host cannot speak for you: all posts signed by user's key; key never on host (user signs on device). Host may serve stale/omit but cannot forge.

Assurance 2: host cannot read what wasn't meant for it: encrypt content for chosen recipients using their public keys; hub only sees ciphertext.

Assurance 3: you can leave: your key and copy on device; you can push to another hub or serve yourself.

Assurance 4: people on other hubs first-class: cross-hub references via absolute URLs to post IDs; readers fetch from whichever hub; no ACL config between hubs because encryption handles access.

Need to support RSS/Atom/JSON Feed: public posts can be served as Atom feed by hub (or generated by user?). Since hub is dumb, user can include a `feed.xml` signed? But XML not needed signed; just public posts list. For interop, we can have a `public.json` which is JSON Feed; and hub can also serve `atom.xml` generated from same data by a simple script (but hub dumb: user uploads atom.xml). That's fine.

Key change/recovery: Grandma never sees key; her daughter acts as key escrow? Actually scenario 2: Grandma installs app, picks name, never shown key, loses phone, back by calling daughter. That implies delegated key custody: a trusted family member (daughter) holds Grandma's key (or a recovery shard). Or the app uses a hub-based account where hub holds key encrypted with password? But host cannot be trusted. So we need a "guardian" model: identity key is generated on device, encrypted to guardian's public key, stored on hub. On loss, guardian helps reissue. But floor assurance 3: key and copy always on device; but if she loses phone, she can be reissued by guardian; that's okay because key was never host's. We'll argue.

Contested departure: hostile operator claims departure is forgery. Solution: each post includes a sequence number and timestamp signed; a "move" statement signed by user key declaring new hub URL; old host may refuse to serve it but user can publish to new hub and notify followers via signed update. Followers verify signature; old host's frozen copy is stale because higher seq or move declaration.

Now produce design text.

Structure:
1. Architecture in one page.
2. Identity primitive.
3. Four floor assurances.
4. Scenario walk-throughs (1,2,3,4).
5. Key change/recovery.
6. Encryption construction.
7. Honest cost sheet.
8. What to cut.

We need to be concrete about bytes: show JSON shape.

Let's draft.

Artifacts:
- `identity.json`: `{ "name": "...", "pubkey": "<base64>", "hub": "https://a.example/", "seq": 0, "prev": null, "ts": 1234567890, "sig": "..." }` Actually identity is just pubkey; but a self-signed profile.
- `post.json`: `{ "id": "<sha256 of canonical json without sig>", "author": "<pubkey>", "ts": ..., "content": "...", "visibility": "public"|"private", "reply_to": "https://...", "seq": N, "sig": "..." }`
- `private envelope`: `{ "post_id": "...", "ephemeral_pub": "...", "ciphertext": "...", "recipients": [<opaque box>] }` where each box is `box_i = crypto_box(recipient_pub, ephemeral_priv, symmetric_key)`? Actually encrypt symmetric key per recipient.
- `feed.json` (JSON Feed) lists public posts.
- `move.json`: `{ "type":"move", "new_hub":"...", "seq":N, "sig":"" }`

Reader fetches on first contact: identity.json (or well-known at hub `/.well-known/...`?) and feed.

Now write.

Need to argue against alternatives: DID, blockchain, domain as identity. Reject domain as identity because domain can be taken (scenario 4). Reject handle as identity. Use public key as identity.

Encryption: Use X25519 (from Ed25519 pubkey conversion) + AES-256-GCM. For each private post, generate random 32-byte symmetric key K. Encrypt content with AES-GCM. For each recipient, compute shared secret = X25519(ephemeral_priv, recipient_pub); encrypt K with shared secret via HKDF -> AES wrap. Store array of `{ "to": <hint? none>, "boxed": <base64> }` but to avoid revealing audience, we don't include recipient pubkey; readers try each box with their key? That would leak count but not who. They can attempt decrypt; if fails, not for them. Hub sees count and sizes.

Now cost sheet: bad at real-time, search, large media (just references). Complexity in encryption boxing.

Cut: drop reactions, drop JSON Feed maybe keep only Atom.

Let's write thorough but not exceed 4000 words. Aim ~2500.

Proceed.
```

</details>

