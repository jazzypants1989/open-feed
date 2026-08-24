---
model: kimi-k3
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:41:50.329Z
prompt: PROMPT-pass1.md
prompt_sha256: eab389889e055bcb32bc4532edc2183f780d8a267227464b47a9a9e220cae542
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":1615,"completion_tokens":15467,"total_tokens":17082,"prompt_tokens_details":{},"completion_tokens_details":{"reasoning_tokens":9054}}
wall_seconds: 486
truncated: false
reasoning_chars: 39828
---
# Kith — a protocol for personal publishing under a hostile host

A note before the design: three existing systems come close and each fails at least one floor item. **ActivityPub** fails floors 1–3 outright (the server speaks for you, reads your DMs, and can keep you). **Nostr** gets identity-as-key right but has no key rotation or recovery at all — key loss is identity death, which kills scenario 2 — and no group encryption with hidden audiences. **Secure Scuttlebutt** has the right append-only backbone and private messages, but identity is welded to one key forever, and it has no HTTP/feed-reader interop story. **AT Protocol** has rotation, but through a central directory (PLC), which priority 1 forbids. Kith is, honestly, SSB's log plus Nostr's key-identity plus a signed key log, rebuilt to be implementable from a standard library in a weekend. The novel part, such as it is, is the key log and the discipline of never trusting the transport.

---

## 1. Architecture in one page

**A person is an Ed25519 public key.** Everything else — name, hub, photo — is signed, replaceable metadata.

**Five artifacts exist:**

1. **The key log (klog).** A short hash-chained sequence of signed statements: genesis, key rotations, recovery designations, hub-move notices, device grants. This is the identity's spine. It is tiny (dozens of entries over a lifetime) and is mirrored liberally — your app mirrors the klogs of everyone it follows.

2. **The item log.** One append-only, hash-chained sequence of signed envelopes per identity: posts, photos (as content-addressed blobs referenced by hash), replies, reactions, profile updates. This is everything the person ever published.

3. **The envelope.** The universal signed container. No canonicalization is needed anywhere in Kith, because signatures cover *bytes that are never re-serialized*:

```
{"v":1,
 "k":"<b64url ed25519 pubkey that signed>",
 "p":"<b64url payload bytes, verbatim>",
 "s":"<b64url ed25519 sig over (\"kith1\" || k || p)>"}
```

The payload is a JSON object, but it is signed, transported, stored, and verified as opaque bytes. An implementation may emit JSON however it likes; nobody ever re-serializes someone else's payload. This is the trick that lets a weekend implementer skip JSON canonicalization entirely — the single biggest interop landmine in signed-JSON systems, removed by signing a byte string instead of a data structure.

4. **Item payloads**, public:

```
{"seq":41,"prev":"<b64 sha256 of previous payload>","ts":1731020400,
 "type":"post","body":{"text":"..."},"heads":{"<idB>":[7,120]}}
```

(`heads` is an optional gossip field: "the latest klog seq / item seq I've seen for these people." It costs nothing and powers stale-detection and move-propagation; see §4.)

Sealed (private) payloads replace `body` with `sealed`:

```
{"seq":42,"prev":"...","ts":...,"type":"post",
 "sealed":{"eph":"<b64 x25519 pub>",
           "boxes":[{"t":"<8 bytes>","k":"<40 bytes>"},...],
           "ct":"<b64>","m":"<b64 16-byte HMAC>"}}
```

5. **Derived views.** The hub *also* renders `/u/<id>/feed.json` (JSON Feed) and `/u/<id>/rss.xml` from the public items. These are **unsigned conveniences**. A hostile hub can lie in them; any reader that cares verifies the log instead. They exist solely for priority 3 — existing feed readers and fediverse bridges consume them with nothing built.

**What a reader fetches.** First contact, given an intro (a URL: `https://hub.example/u/<id>`, possibly with a one-tap token): `GET /u/<id>/klog` → verify the chain from genesis, learn current signing key, encryption key, and hub list. Then `GET /u/<id>/items?after=0` → verify each envelope against the klog-authorized keys and the hash chain. On a poll: `GET /u/<id>/items?after=<last_seq>` and occasionally re-fetch the klog head (it's small; fetching it whole every time is acceptable and simpler). Sealed items are tried against the reader's decryption keys; non-matching boxes are skipped.

**What a hub is.** A dumb, partially-validating blob store. On `POST /u/<id>/items` it checks: signature valid for a currently-authorized key of `<id>`, `seq` is next, `prev` matches the stored head. This is spam/garbage protection for the hub's own disk, not a security property — security comes from the signatures, which readers verify themselves. Serving is static files over HTTPS.

---

## 2. The identity primitive

**A person is an Ed25519 keypair, generated on their device, never shown to them, never given to anyone.** The *identifier* is the base64url of the public key — 43 characters, used inside URLs, never typed by a human. Humans see petnames, which are local and personal (my "Mom" is your "Grandma Rose"), exactly as in phone contact lists.

Alternatives rejected:

- **DNS names as identity** (`alice@family.example`). Fails scenario 4 outright — the domain goes, everyone's identity dies with it. Worse, it fails the divorce: whoever controls the domain *is* everyone on it. A name you can lose is a lease, not an identity.
- **Hub-issued usernames.** Same failure, one level down. The brief's adversary *is* the issuer.
- **DIDs / blockchain names / global registries.** Priority 1 forbids them, and they're solutions to a problem we don't have: we don't need global human-meaningful uniqueness. We need one person to be findable by the fifty people who know them. A key plus a signed hub pointer does that.
- **A key with no rotation story (Nostr-style).** Tempting for simplicity, fatal for scenario 2. Grandma *will* lose her phone. An identity system for families in which losing a device is death is a non-starter. Rotation is worth every line it costs.

The price of key-as-identity is the bootstrap problem: how do you first learn someone's key? Answer: an **intro** — a URL or QR code containing the key and a current hub, transferred over any channel you already trust (a text message, a hug and a phone bump). This is exactly how phone numbers already work. First contact pins the key; from then on the key vouches for everything else, including its own replacements.

Scenario 7's re-meeting after total key loss is explicitly social: the stranger gets a new intro and decides to trust it the way they trusted the first one. The brief names this a non-goal, correctly — cryptographic continuity after total key loss with no pre-arranged recovery is impossible, not merely hard.

---

## 3. The four floor assurances, mechanism by mechanism

### 3.1 The host cannot speak for you

**Mechanism.** Every item and every key statement is a signed envelope (§1). The signing key was generated on the author's device; the hub has never seen it (the protocol contains no message that transmits a private key — there is nothing to refuse). Readers verify every envelope against keys authorized by the klog chain, which itself verifies from genesis. The hub's role is pure storage and transport; a hub that modifies one byte of a payload produces envelopes that fail verification, and its derived feeds are explicitly untrusted.

**Failure mode.** None, cryptographically. The operational failure is a reader implementation that displays unverified content (e.g., renders the RSS view as if it were authoritative). The spec must say plainly: derived views are hints, logs are truth.

### 3.2 The host cannot read what wasn't meant for it

**Mechanism.** Sealed items (construction in §6): a random per-item content key, the body encrypted under it with a SHA-256-built stream cipher and HMAC, and the content key boxed separately to each recipient via X25519. The hub stores and serves ciphertext. Access control is *possession of a private key*, not a hub decision — which is precisely why cross-hub sharing with no ACL agreement works (§3.4). Note the corollary the brief demands: the abusive ex who *is* in the audience of old family posts can read those, forever, and nothing can change that. Revocation is prospective only — he stops being able to read posts made after the audience excludes him. We say this out loud in the spec.

**The one deviation from priority 1.** The brief's allowed primitive set — Ed25519, SHA-256, HTTP, JSON, base64 — contains no key-agreement primitive, and assurance 2 cannot be built without one (symmetric crypto alone leaves the key-distribution problem unsolved; I considered deriving DH from Ed25519 internals, which is possible but requires SHA-512 and the clamping step, reuses signing keys for agreement — poor hygiene — and isn't actually in any standard library's *public* API anyway). So Kith adds exactly one primitive: **X25519**. It sits alongside Ed25519 in Go's, Rust's, Python's, and every other modern standard crypto offering, and the spec includes the fifteen-line HMAC-from-SHA-256 recipe so nothing else is needed. I flag this as a deliberate, argued deviation, not an oversight.

**Failure mode.** Device compromise reads everything sealed to that device, past and future — there is no forward secrecy (see §7). And a recipient can always re-share plaintext; that is not a cryptographic problem.

### 3.3 The host cannot keep you

**Mechanism.** Three parts. (a) *The key was never the host's* — your identity is already yours. (b) *Your copy was always on your device* — the reference app keeps the full item log locally as it publishes; the hub is a replica, not the master. Export is not a feature; it's what the app already has. (c) *Moves are signed statements*: a `move` entry in your klog, signed by your current key, naming new hub URLs. Any reader who sees it verifies it and follows it; any follower who has seen it can hand it to any other (klog statements are self-authenticating, so gossip is safe — a forged move notice simply fails signature verification). A new hub imports you by accepting your two logs; it validates signatures, charges you for disk, done. No permission from the old hub appears anywhere in the protocol.

**Failure mode.** The old hub can refuse to *serve* your move notice, so followers who only ever poll the old hub learn nothing until the gossip layer or one out-of-band message reaches them (§4.1). The old hub can also delete your public archive — but your device has it, your followers' apps have the public parts, and klog mirroring means your identity spine survives on every follower's phone. What the host *can* deny you is availability to strangers who only knew the old URL. That's real, and it's listed in §7.

### 3.4 People on other hubs are first-class

**Mechanism.** There is no inter-hub protocol. None. Authorization is end-to-end cryptography, and discovery is reader-side polling:

- To send family-only content to someone on another hub, your app fetches their klog (a public `GET`), learns their encryption key from their signed profile, and seals the item to it. The other hub's operator is not involved and has nothing to configure.
- Replies and reactions are ordinary items in the *responder's own log*, containing a reference — `(author id, payload hash)` — to the thing they respond to. Thread assembly happens in the reader: you already poll the logs of everyone you follow; any item whose reference matches something in your view is attached to the thread.
- An optional, unsigned `POST /u/<id>/hint {"from":"<id>","ref":"<hash>"}` exists so replies arrive in seconds instead of at the next poll. It is a latency optimization only. The brief states the adversary controls every inbound message path — so the design makes correctness independent of all of them. Dropped hints cost minutes, never data.

**Failure mode.** Reply discovery is bounded by your follow graph (plus one hop: if you follow B and B follows C, B's log can carry C's reply reference in `heads`-style metadata — but I specify only direct-follow discovery in the core). A reply from a complete stranger on an unconnected hub reaches you only via the hint path, which a hostile hub can drop. For the target audience — families, small groups, public journals — this is the right trade; for a Twitter-scale public square it wouldn't be.

---

## 4. Scenario walk-throughs

### 4.1 The divorce

Wife W's identity lives on ex-husband E's hub. Her keys have only ever been on her phone; her phone holds her complete item log.

She decides to leave. She signs a `move` statement (klog seq 9) naming her new commercial hub, uploads her two logs there, and keeps publishing — her app now dual-posts to both hubs for a grace period, though E's hub may refuse or silently drop new items. She sends her mother one message: a link. One tap: the intro contains her key, which the mother's app already knows; the app fetches the klog from the new hub, sees seq 9 chain correctly onto the seq-8 head it already remembers, and updates the hub pointer. **The cryptographic fact doing the work: E cannot produce a competing seq-9 statement, because producing one requires W's key.** His claim that "the departure is the forgery" is an assertion; the chain is a proof. Where they conflict, assertions lose — that's the entire design philosophy.

Meanwhile E keeps serving her frozen archive. Her mother's app, and every app that has seen klog seq 9, renders it with a badge: *"This copy is 214 days behind. The author has moved."* It still verifies as hers — E can't alter or backdate a single item, because any insertion or change breaks the `prev` hash chain against heads her followers already hold — but it reads as a snapshot, not as her voice.

What E retains: the plaintext of everything family-only that was addressed to him while he was in the audience (unfixable, by anyone, ever); her public archive as a static fossil; and traffic metadata from before the split. What he cannot do is speak as her, read the post-divorce posts sealed to the family-minus-him, or keep her.

### 4.2 Grandma onboards

Install. The app generates her keypair, generates her identity, and shows her none of it. She types "Rose." Two things happen at onboarding, both framed as "in case you lose your phone":

1. Her daughter's app displays a QR (or they do it over the phone with a spoken 6-word code). Grandma's app writes into her **genesis statement**: `rec: ["<daughter's identity key>"]` — *this key may re-key me*.
2. Her app encrypts her secret key material to **the daughter's encryption key** and stores that blob as a special item in her own log, on her hub. The hub can't read it. The daughter technically could — she is the trusted recovery person; that trust is the point of the ceremony, and the app says so in plain words.

A year later the phone is gone. New phone, fresh install, fresh keypair. Grandma calls her daughter. The daughter's app — which follows her — notices a stranger claiming recovery, or the daughter initiates it: it shows the new key's short code, the daughter confirms her mother's voice read it aloud, and her app signs a `recover` statement: *"fork from klog seq 4; from seq 5, signing key is K_new."* It publishes this to Grandma's hub slot (self-authenticating; the hub accepts it because the signature verifies against the recovery key in the genesis it already stores) and hands Grandma's phone the encrypted backup blob. Grandma's app re-keys the backup to her new device key. She is fully back: identity, archive, sealed history, followers — her followers' apps see a valid `recover` extending a chain they already hold and update silently.

### 4.3 Two hubs, one thread

A is on `a.example`, B on `family.example`; they exchanged intros at a wedding and follow each other.

1. A writes a family-only post. Her app fetched B's profile long ago while polling; it seals the body with a fresh content key, boxes the key to herself, to B, and to four others, pads the box count to 8, and posts the item to `a.example`. `family.example` is not contacted, consulted, or configured.
2. B's app polls A's log, finds item 42, computes its box tag against B's X25519 key, matches box 3, unwraps, decrypts. Inside the plaintext is `aud: [A, B, ...]` — the audience list is *inside* the ciphertext, so recipients can see it (needed for reply addressing) while the hub cannot (the boxes are opaque; see §6).
3. B replies: an item in **B's own log** on `family.example`, `ref: ["<A's id>", "<payload hash of item 42>"]`, sealed to the same `aud`. His app fires an unsigned hint at `a.example` for speed.
4. A's app polls B's log (it does anyway), sees the reference to an item in its view, attaches it to the thread, decrypts. A reaction from A works identically: an item of `type:"react"` with the same `ref`.

Total inter-hub configuration, both sides, forever: zero. The hubs never speak. This is the load-bearing consequence of making authorization cryptographic rather than administrative.

### 4.4 The domain goes

`family.example` is expiring. Nobody's identity is the domain, so nothing about anyone changes; only hub pointers do. Each person signs a `move` statement while the domain is still live; every follower's next poll picks it up — this is the common case and it's boring, correctly.

The ugly case is abrupt loss (the registrar pulls it tonight). Then: (a) every follower's app holds a mirror of every klog it follows — the identity spine survives on a hundred phones; (b) the `heads` gossip field in everyone's items means any two mutual-follow apps that sync can propagate a newer klog head they alone have seen, so a move published to a new hub reaches the whole family within one or two sync cycles; (c) worst case, one out-of-band intro per person, same as onboarding. Nobody re-keys, nobody re-follows fifty people, no one's archive is lost unless they personally kept no copy and every follower lost theirs — for families, implausible.

Scenarios 5–7, briefly: **The big lazy hub** — cost per identity is append-only blob storage plus one Ed25519 verification per publish; serving is static files; there is no ACL engine, no user database beyond id→log, no per-request crypto. Hostility at scale changes nothing, because the hub was never trusted with anything but availability. **The weekend** — day one, publisher: keygen, genesis, envelope, item chain, `POST`. Day two, reader: fetch, verify chain, verify envelopes, try boxes, render. Day three, dumb hub: static file server with a signature check on write. **The stranger** — the hub's derived `feed.json`/`rss.xml` flows into any RSS reader and into existing RSS→ActivityPub bridges (nothing built); after total key loss, the author re-meets the stranger socially with a new intro, and the old log's final state is whatever it was — we promise no more than that, and the brief says that's fine.

---

## 5. Key change and recovery

The klog is a hash-chained sequence; statement *n* is signed by a key authorized at statement *n−1*.

- **`rotate`** (routine: new phone, annual hygiene, suspected exposure): signed by the current signing key, names the new signing key and optionally new encryption key. Trivial, common, boring — deliberately so, so that rotation is not an emergency signal.
- **`move`**: signed by current signing key; new hub list. Cheap to issue often; hubs are attachments, not identity.
- **`grant`** / **`revoke`**: authorizes an additional device signing key / removes one. Each envelope's `k` field names the actual device key, so readers can enforce revocations. (This is the sketchiest area of the design; see §7.)
- **`recover`**: signed by any key in the current `rec` set. It explicitly names the klog point it forks from and repudiates everything after: `"fork":4, "repudiate":{"sign":"<old key>","after_item_seq":118}`. Readers prune repudiated segments and flag any already-seen repudiated items as disputed.

**Theft, contested.** Thief steals the device key and publishes a `rotate` at seq 5, then posts. The owner (via the recovery holder) publishes `recover` at seq 6 forking from seq 4 and repudiating the thief's key. Reader rule: a `recover` signed by a `rec`-set key *always* outranks signing-key statements, and the repudiation list is authoritative. The thief's window is exactly the time between theft and recovery; everything they published is cryptographically marked and socially deniable. If *two* valid recovery keys publish conflicting `recover` statements, or a `rec` key is itself stolen, the rule is: **halt, display both branches, demand out-of-band confirmation.** Kith never auto-resolves a fork between equally-authorized keys; it makes forks *visible* instead. Equivocation is detectable, not preventable — no consensus-free design can do better, and we say so.

**The contested departure** (the operator claims the move is the forgery): covered in §4.1 — the operator holds no key in the chain, so he can produce no competing statement, and unsigned assertions carry zero protocol weight. The one genuinely dangerous version is an operator who *also* holds a recovery key (imagine the ex was designated recovery holder during the marriage). Then he can publish a hostile `recover`. Defense: the `rec` set should hold at least two keys, `recover` statements should be gossiped loudly and surfaced to the user on every device ("a recovery of your identity was published — was this you?"), and the victim's live devices can immediately publish a signed protest item from the still-valid signing key, creating a visible contested state. I am not fully satisfied here; a 2-of-3 threshold on recovery is the obvious strengthening and is specified as an optional extension.

---

## 6. The encryption construction

Everything is built from X25519 and SHA-256 (HMAC included; the spec contains its 15-line definition).

**Per sealed item:**

1. Generate content key `ck` ← 32 random bytes.
2. Plaintext is the body JSON *including* the audience list: `{"aud":["<id>",...],"text":...}`. Audience hidden from the hub, visible to recipients (needed so replies can re-address the same group).
3. Ciphertext: `ct = plaintext XOR SHA256CTR(ck, item_hash)` where block *i* of the keystream is `SHA-256(ck || item_hash || i_be64)`. (Keyed, per-item-nonce stream cipher; fine given fresh random `ck` per item.)
4. Integrity: `m = HMAC-SHA-256(ck, ct)[0:16]`, verified before decryption is considered successful (encrypt-then-MAC).
5. Generate ephemeral X25519 keypair `e`. For each recipient *i* with encryption public key `P_i`:
   - `shared = X25519(e_priv, P_i)`; `secret = SHA-256(shared || "kith-box-v1")`
   - box tag: `t = secret[0:8]`
   - wrapped key: `w = ck XOR SHA-256(secret || "wrap")[0:32]`, concatenated with box MAC `SHA-256(secret || "box" || ck)[0:8]` → 40 bytes.
6. Pad the box list with random-box decoys up to the next size in {1, 2, 4, 8, 16, 32}.

**Recipient:** for each box, compute `secret` from their private key and `eph`, compare `secret[0:8]` to `t`; on match, unwrap and check the box MAC, then verify `m`, then decrypt. Cost is one X25519 per *item* (the ephemeral is shared across boxes) plus one SHA-256 per box.

**Why the tag is derived from the DH output** rather than being a recipient identifier: the hub cannot compute `secret`, so it cannot determine *which* public keys a box addresses, even by guessing-and-checking candidate keys. Combined with count padding, the hub learns: author, timestamp, approximate size, and a bucketed recipient count. It does **not** learn the audience, which is exactly the anonymity boundary the brief's non-goals draw. Senders include a box to themselves so their own devices can re-read their log.

**Encryption keys over time:** the current encryption key is in the signed profile and can rotate with `rotate`. Apps retain their full decryption-key history, so old items survive rotation. When someone's key rotates, senders' apps *may* lazily re-box old items to the new key (an optional courtesy; specified as a hint item type).

Rejected alternatives: **MLS or any real group keying** — beautiful, and ten times the spec; at family scale, per-item boxes are a few hundred bytes and zero state machines. **Shared symmetric group keys** — membership changes force re-keying and redistribution, and every member can impersonate the group key's origin; per-item boxes make revocation a non-event (just stop boxing to them). **Age/PGP-style formats** — external dependencies, against priority 1.

---

## 7. The honest cost sheet

- **No forward secrecy.** A stolen device key plus recorded ciphertext = the history. Rotating limits future exposure only. Adding ratcheting would roughly double the crypto spec; for the divorce adversary (who records everything he serves) this is the most painful omission on this list.
- **Availability is not guaranteed; only detectability is.** The hostile hub can withhold, equivocate (show different followers different heads), and serve stale data. Kith's answer is that all of these are *detectable* via held heads, gossip, and klog mirroring — but a determined host can still degrade service for as long as you remain its customer. The floor item is "cannot keep you," and the honest reading is "cannot keep you *for long or quietly*."
- **Timestamps are author-claims.** The chain gives total order per author, never time. An author can backdate their own unpublished items; nobody else can backdate anything.
- **Reply discovery is follow-bounded** (§3.4). The open-web "anyone can respond" experience requires trusting a hint path that the adversary is defined as controlling.
- **Polling doesn't scale to thousands of followees.** Fine for the stated audience; this is not a Twitter replacement.
- **Multi-device is the least-certain design area.** Device `grant`s work on paper, but the UX of authorizing, revoking, and synchronizing devices — and the edge cases when a granted device is the thing that was stolen — deserves more adversarial thought than I've given it.
- **Sealed content is invisible to derived feeds and bridges** (obviously), so the interop story is public-only. And the fediverse-replies-coming-back direction would require a bridge that holds keys and mints its own Kith identity — specified as an extension, not built.
- **The X25519 deviation** from the pristine primitive list (§3.2). I'm confident it's necessary — assurance 2 is impossible without key agreement — but it is a deviation.
- **Recovery key held by an abusive insider** (§5) is the one place where "the adversary is inside the family" bites cryptographically rather than just socially.
- **What the hub learns anyway:** who publishes when, how much, to roughly how many; the full public graph; IP-level traffic metadata. Padding and sealed audiences hide content and recipients, not existence or timing.
- **It cannot deliver:** continuity across total key loss (non-goal, correctly); prevention of equivocation; retrieval of plaintext from insiders; any defense of a reader who only ever talks to the hostile hub and has no mutuals.

---

## 8. If forced to halve the specification

Cut, in order: (1) RSS/Atom rendering — keep JSON Feed only, one derived view; (2) the hint path — polling-only, replies arrive within the poll interval; (3) device `grant`s — one device, recovery handles replacement; (4) box-count padding and decoys — accept recipient-count leakage; (5) `heads` gossip — keep explicit klog mirroring only; (6) lazy re-boxing of old items; (7) multi-hub redundancy in `move` statements.

What survives every cut: the envelope, the item log, the klog with rotate/move/recover, and sealed boxes. Those four are the floor — everything else in this document is latency, polish, or interop, and the protocol is honestly one page of invariants plus two byte formats: *sign bytes, chain them, never let anyone hold your key, and make the ciphertext itself the access-control list.*

<details><summary>Model reasoning trace (39828 chars) — kept because rejected alternatives often live here</summary>

```
The user wants a full protocol design from first principles. This is a deep design brief. I need to write a long, argued design document. Let me think carefully about the actual design before writing.

Core requirements:
- Decentralized personal publishing: hubs serve content over HTTPS.
- Adversary: the hub operator is hostile, inside the family, has legitimate credentials to see family-only content.
- Four assurances: (1) host can't forge; (2) host can't read content not addressed to it; (3) portable identity, key+copy on device; (4) cross-hub first-class interactions with no ACL agreements.
- No dependencies beyond stdlib: Ed25519, SHA-256, HTTP, JSON, base64. NO JSON canonicalizer — this is important. So signatures must be over byte-stable content, meaning we sign base64-encoded payloads or use detached envelope tricks: sign the exact bytes of a string. Common trick: sign over the base64url encoding of the JSON payload, or put the payload as a string inside the signed envelope. Simplest: the signed object contains `payload` as a base64url string of the canonical-by-construction JSON (or just arbitrary bytes), and signature is over that string's bytes. Actually simplest: envelope = {"payload": "<base64url>", "sig": "<base64url>"} where sig is Ed25519 over the raw payload bytes. Then no canonicalization needed — you verify by decoding payload and verifying sig over those exact bytes. That's the classic trick. The payload bytes are produced by the author's implementation and preserved verbatim by all relays; hubs store and serve bytes verbatim.

Wait — but JSON Feed / RSS interop (priority 3): public content should reach existing feed readers. JSON Feed requires specific JSON at a URL. So a hub can generate a JSON Feed / RSS rendering from the signed item log. That rendering is unsigned by the author (or annotated), but that's fine — it's a convenience view; hostile hub can lie in the feed view, but readers who care verify the signed log. Actually, for interop, the hub serves a derived feed; a paranoid reader fetches the signed log. Good tension to discuss.

Identity primitive: a person IS an Ed25519 public key (the "root key" or identity key). Everything else (petname, hub URL) is advisory data signed by that key. Alternatives rejected: DNS-based identity (fails scenario 4 — domain goes; also fails "host can't keep you" since operator controls domain); DID (needs registry/method complexity, violates no-dependencies); blockchain names (rejected by non-goals); hub-issued usernames (fails divorce). So: identity = pubkey. Key change: signed rotation certificates — a chain of "key change" statements each signed by the old key authorizing the new key. This gives key continuity across rotation AND theft recovery if you pre-commit... The classic problem: if the key is stolen, the thief can rotate too. Solutions: pre-generated recovery key held by family members (social recovery), or a "recovery key" designated in advance. Grandma scenario: she never sees a key; daughter holds a recovery key. So design: each identity has a signing key (on device) and designates recovery key(s) — e.g., daughter's identity key, or a threshold. Keep it simple: a recovery statement signed by... hmm.

Let me design the key-change mechanism carefully:

Identity log: a sequence of signed "events". Event 0: genesis — signed by the root key, declares current signing key and recovery key(s). Actually keep simpler: the identity key itself signs. Key rotation: statement signed by old key: "from seq N, key K_new speaks for me." This handles rotation and loss-if-you-planned-ahead (recovery key pre-designated, stored with daughter). Theft: if attacker steals active signing key, they can rotate; but if owner also has the key, it's a race — both can publish competing rotations. This is the contested departure scenario. How to resolve forks without consensus? Honest answer: you can't fully; readers must detect conflict (two valid signed statements with same seq from same key) and treat identity as contested, falling back to out-of-band verification. But we can do better with a pre-commitment: rotation statements can be hash-chained — each statement includes hash of previous statement. Still forkable by thief.

Better trick for theft: pre-committed rotation — at setup, generate a rotation statement signed in advance and give the *unsigned*... no. Another classic: "same-key recovery": the recovery key is a different key (offline/daughter's) designated in genesis; a recovery statement signed by the recovery key overrides the signing key chain. Thief of the device key can't forge recovery key signatures. So hierarchy: recovery key (cold, off-device, or held by trusted family) > signing key (hot, on device). Grandma: her recovery key is held... she never stores a file outside the house. "Back by calling her daughter": daughter's copy. Options: recovery key IS daughter's identity key (social recovery, no new artifact for grandma). Genesis designates daughter's pubkey as recovery agent. When grandma loses phone: she installs app, generates new device key, daughter's app signs a recovery statement: "identity X now speaks with key K_new, at seq N+1, superseding K_old." Readers accept because genesis said daughter's key may do this. Theft contested case: thief with device key publishes rotation; daughter publishes recovery superseding it; readers prefer recovery statements signed by the designated recovery key — deterministic rule: a recovery statement at higher seq signed by recovery key wins over any signing-key statement at any seq? Need a clean rule: key statements form a log with monotonically increasing seq; each statement must be signed by a key currently authorized to speak. Recovery key is authorized to speak at any time; statements from it with seq higher than anything seen reset the signing key. Conflict between two recovery statements: impossible unless recovery key itself compromised — then out-of-band.

The contested departure: hostile operator claims the departure is the forgery. The operator holds... in divorce scenario, does the operator hold her keys? No — floor 3 says key was always on her device, never the host's. So operator can't forge a rotation. Operator's move: serve a frozen old version of her key log and claim the move statement is fake. Readers resolve by: the move statement is signed by her key — it verifies; the operator's claim is unsigned, so it doesn't. But wait — the twist: "contested departure in which the hostile operator claims the departure is the forgery" — operator claims SHE lost her key and the attacker rotated. Since all rotations are signed by the prior key, the chain is verifiable; the only way the operator's story holds is if the thief had her key. Readers who know her out-of-band confirm. Cryptographically: the chain from genesis to current statement is a single unambiguous sequence of signatures; the hub cannot produce an alternative chain without a key in the chain. Also: hubs can't censor the key log because readers fetch it from the NEW hub; old content references the identity, not the hub.

Now, addressing: how do readers find an identity? First contact needs a bootstrap: an introduction containing pubkey + current hub URL, signed by the identity. Passed out-of-band (QR, message). After that, the reader pins the pubkey; hub changes are signed statements, so the reader follows the identity across hubs. No global registry. The "follow with one tap": mother's app has the daughter's... the wife's pubkey from before; app polls old hub (frozen, stale-detection: latest statement has higher seq / newer timestamp and different hub pointer) and new location. Actually how does mother's app find the new hub if old hub won't serve the move statement? She publishes the move statement and it's served from the new hub; mother's app needs to know new hub URL. Mechanisms: (a) she tells mother out-of-band (one tap on a link); (b) mutual contacts: mother's app also follows others who follow her; gossip of key logs among contacts — friends-of-friends relay the latest key-log head. Simplest honest answer: the move notice propagates through the social graph (any follower who learns the new location serves it to others — signed statements are self-authenticating so gossip is safe) and/or one out-of-band tap. Staleness detection: every statement has seq; frozen copy has lower seq than anything newer seen anywhere; and content items themselves carry seq numbers in the author's item log, so a hub serving an old log head is detectably stale once you've seen a newer head from anywhere.

Content model: author maintains a signed, append-only item log (a chain): each item = {seq, prev (hash of previous item), timestamp, type (post/reply/reaction/profile/keyop), body}. Signing: envelope trick (payload bytes + signature). The chain gives ordering and tamper-evidence: hub can't drop items without detection? It CAN withhold new items (serve stale head) but can't alter/backdate: backdating impossible because seq/prev chain and readers have seen later heads; also timestamps are author-claims anyway (no consensus time — honest note: author can lie about their own timestamps; the chain gives order not time). Hub can fork by withholding (show different followers different heads) — detectable when followers compare heads; equivocation is detectable, not preventable. Name the failure mode.

Floor 2 encryption: family-only content unreadable by host even though host serves it. Construction with stdlib-only primitives: problem — Ed25519 is signing only; need encryption. X25519 + something? Stdlib claim: "Ed25519, SHA-256, HTTP, JSON, base64" — that's the listed set. Hmm. Can we build encryption from just those? You can't do public-key encryption from Ed25519 cleanly... actually you CAN convert Ed25519 keys to X25519 (birational map), but X25519 isn't in the listed stdlib set. Many stdlibs (Go, Python's cryptography isn't stdlib; but Go's stdlib has curve25519? Go has golang.org/x/crypto — not stdlib. Actually Go 1.20+ has crypto/ecdh in stdlib which supports X25519!). Hmm, the brief says "Ed25519, SHA-256, HTTP, JSON, base64" as the assumed set. But encryption is a hard floor requirement (assurance 2). So we must either extend the allowed primitive set minimally or construct symmetric-only encryption. SHA-256 alone gives you: a stream cipher via SHA-256 in counter mode (hash(key || nonce || counter)) and a MAC via HMAC-SHA-256. So symmetric authenticated encryption is buildable from SHA-256 alone. Key distribution: the problem is getting the symmetric key to chosen recipients without the host reading it. Options:

(a) Convert Ed25519 to X25519 for ECDH — requires curve ops beyond listed set. The brief's priority list might be illustrative ("implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64"). I should flag this: assurance 2 requires a key-establishment primitive; the minimal addition is X25519 (or ECDH on some curve) — note that most modern stdlibs do include it (Go crypto/ecdh, Python... no). Alternative: abuse Ed25519 for key agreement — there are known hacks (using Ed25519 scalar multiplication — Ed25519 libraries internally do scalar mult; you can do a DH-ish using the signing key scalar: shared = a*B where... deterministic: Alice computes shared secret = SHA256( scalar_a * PK_b )? Ed25519 public key is A = a·B. DH: a·(b·B) = b·(a·B). If your Ed25519 implementation exposes scalar multiplication of the seed-derived scalar with a point, you get DH. But the private key in Ed25519 is hashed (h = SHA512(seed), clamp) — so you'd need SHA-512 and the internal clamp; and ECDH-with-signing-keys is cryptographically dicey (key reuse across sign/DH). Flag it as rejected for hygiene, choose: add X25519 to the allowed set as the single necessary extension, OR derive separate keys.

Cleanest design: identity has TWO keypairs? No — keep identity = one Ed25519 key. Derive encryption subkey from the same seed? If seed never leaves device (floor 3), the app can derive an X25519 keypair from the Ed25519 seed via SHA-512 (standard conversion, as in libsodium's ed25519_to_curve25519). Then only ONE public identity key, and its encryption counterpart is computable by anyone from the Ed25519 public key (the birational map on the public point needs only Ed25519 point ops... converting public key Edwards→Montgomery is u=(1+y)/(1−y), simple field math, implementable). Private side needs SHA-512+clamp — SHA-512 not in the list; can approximate with SHA-256-based expansion — nonstandard, risky. Hmm.

Simpler and more honest: define the identity as an Ed25519 key PLUS a derived X25519 key published in genesis/profile (same seed derivation, or independently generated and signed by the identity key — cleaner: the app generates an encryption keypair, and the signed profile binds encryption pubkey to identity). Then the primitive set is Ed25519 + X25519 + SHA-256 (+ SHA-256-based AEAD construction). I'll argue: the no-dependency list must admit X25519 or the floor item 2 is unachievable; flag this as the one place the brief's constraints conflict, choose to add exactly one primitive, and show the alternative (Ed25519-reuse hack) rejected.

Group encryption construction (family-only posts): per-item random 256-bit content key k; body encrypted with stream cipher SHA-256-CTR + HMAC-SHA-256 (encrypt-then-MAC). For each recipient, a "key box": ECDH(sender's ephemeral X25519, recipient's X25519 pub) → SHA-256 → wrap k (XOR or AES-less wrap: k XOR SHA-256(dh || nonce || "wrap"), plus MAC). Hiding the audience: boxes are labeled only with a recipient tag = truncated HMAC of the recipient's pubkey (so recipients can find their box by trial, but the hub can't enumerate the audience — it could if it knows candidate pubkeys: tag = HMAC(dh_shared, "tag")? If tag depends on DH output, hub can't compute it without being a party. So box = {eph_pub, tag = HMAC(shared, "tag")[0:8], wrapped = k XOR HMAC(shared, "wrap"), mac}. Recipient computes shared from their private key and eph_pub, derives tag, matches. Hub learns: number of recipients (count of boxes) — hide by padding to fixed bucket sizes (e.g., always pad boxes to next power of two or fixed 8/16) — and the author, timing, sizes. It does NOT learn who unless it already suspects and... it can't verify suspicion without the private key, since tag is derived from DH output. Good — that's "hiding who an encrypted message is for" per non-goal 5 (they explicitly scope anonymity to this).

Cross-hub sharing with no ACL agreement (floor 4, scenario 3): because authorization is cryptographic, not hub-mediated: A encrypts to B's published encryption key; B fetches A's items from A's hub (public fetch of encrypted blobs — hub serves anyone, or even requires nothing; the ciphertext is the ACL). Replies: B's reply is an item in B's own log, referencing (author, seq, item-hash) of A's item; B encrypts the reply to the same audience. How does A's hub/thread know about B's reply? Reply discovery: B sends (or their hub offers) a "ping" — but no inbound message path should be trusted... The adversary controls "any inbound message path" — so replies must propagate via pull: A's app polls the logs of everyone A follows; thread assembly happens in the reader by matching references. So no inbound write path at all — interactions are just cross-references between logs, discovered by polling people you follow. For "reply to someone you don't follow": the original poster's app can discover replies via... followers-of-thread: if A follows B, and B follows C, C's reply to A's post can be discovered if B's log references it? Simplification for the small-group scale: mutual-follow groups; everyone in a family group follows everyone, so all replies are discovered by polling the group. That's honest: thread assembly is client-side graph traversal bounded by follow list. The "ping" can exist as an OPTIONAL unauthenticated hint (hub-to-hub or direct POST) — purely a latency optimization; correctness never depends on it; signed content is fetched from the author's hub. Since adversary controls inbound path, we design so nothing depends on it. Good.

Reactions: items of type reaction referencing target, signed, same distribution.

Reader fetch flow: first contact: fetch identity document (key log head + profile) at hub URL from intro: GET https://hub/ID/log (the signed key-op chain) and GET https://hub/ID/items?after=N (item log). Poll: GET items?after=last_seen, and occasionally the key log head. Public rendering: hub ALSO serves /ID/feed.json (JSON Feed) and /ID/rss.xml — derived, unsigned; and an HTML page with microformats? For fediverse/Bluesky interop "with nothing extra built": a bridge is allowed ("through a bridge"). The stranger scenario says "sees it on Mastodon through a bridge with nothing built" — meaning generic existing bridges (RSS→ActivityPub bridges exist, e.g., Bridgy Fed) can consume the RSS/JSON Feed. So interop = serve standard feed formats derived from the log. That's the honest mechanism.

Hub protocol: dumbest possible store: PUT/POST of signed envelopes by the author (auth = signature on envelope; hub need not even authenticate beyond verifying signature matches the identity it stores under — the hub is untrusted anyway; auth only protects the hub's storage from spam, so a simple capability: the author proves possession by the item signatures themselves). Hub endpoints: 
- GET /{id}/keylog — full key-op chain
- GET /{id}/items?after={seq} — envelopes
- GET /{id}/items/{seq} 
- GET /{id}/feed.json, /rss.xml (derived views)
- POST /{id}/items (author publishes; hub verifies signature + seq continuity)
- GET /{id}/inbox/{?} — optional hint drop? skip / mark optional.
Big lazy hub: per-identity cost flat — append-only storage, no crypto per request except signature check on publish (cheap, Ed25519 verify). Serve static bytes. Fine.

Multi-device: briefly — each device could have own key authorized via signed device-authorization statement; or keep one key synced. Mention device subkeys as the mechanism (signed device grants), keep minimal: actually for minimality maybe just say: the item log is signed by the current signing key; multiple devices = signed subkey grants. Flag complexity.

Content addressing & leaving with everything: items are self-authenticating envelopes; export = copy the log; new hub imports by accepting the author's signed items (verified). Identity unchanged (pubkey). Move statement in key log points to new hub(s). Followers update.

Backdating: hub can't backdate because prev-hash chain + readers holding later heads; author CAN backdate their own unpublished items — but prev chain means an inserted item changes all subsequent hashes, so retro-insertion into a published prefix is impossible without fork. Good.

Timestamps: author-claimed; order from chain. Note honestly.

Now "what a reader fetches on first contact and poll" — covered.

Architecture in one page: artifacts: (1) identity keypair (device); (2) key log (chain of signed key statements: genesis, hub pointers, rotations, device grants); (3) item log (hash-chained signed envelopes); (4) envelopes: {payload_b64, kid?, sig} where payload is JSON bytes; (5) key boxes for private items; (6) intro/invite blob for bootstrap; (7) derived feed views (unsigned).

Envelope byte shape:
```
{"v":1,"payload":"<base64url of exact JSON bytes>","sig":"<base64url Ed25519 over payload bytes>"}
```
Wait — sign over the payload bytes (decoded) or over the base64 string? Sign over the decoded raw bytes; verifier decodes and verifies. Either works; pick: sig over the raw payload bytes. Include the signing key id? The identity is known from URL; for compactness include "by":"<pubkey prefix>"? Keep minimal: the hub path scopes it. Include seq inside payload.

Payload item:
```
{"seq":41,"prev":"<b64 sha256 of previous envelope>","ts":1730000000,"type":"post","aud":"public"|"sealed","body":{...}}
```
For sealed items, body = {"boxes":[...],"ct":"<b64>","tag":"<b64 mac>"}.

Key statement payload:
```
{"kseq":3,"kprev":"<hash>","type":"rotate|move|grant|recover","key":"<new pub>","hubs":["https://..."],"recover":"<recovery pub>",...}
```
Genesis: kseq 0, defines signing key, recovery key(s), hubs.

Recovery details: grandma — genesis names daughter's identity pubkey as recovery key. Lost phone: new install generates fresh keys; daughter's app signs recover statement {kseq:1, type:"recover", key:new}. But how does daughter know the new key is really grandma's? Out-of-band: grandma calls, reads a code / scans QR shown by her app — daughter's app signs that key. Person-to-person verification out of band; crypto just carries it. Good honest description.

Theft contested: device key stolen. Thief publishes rotate to their key at kseq 5. Owner (or recovery holder) publishes recover at kseq 6 superseding. Reader rule: process klog in order; a recover statement signed by the recovery key designated in the most recent valid statement is always valid; a rotate must be signed by the current signing key. If both chains appear with same kseq — fork, flag contested, show both, require out-of-band. Also note: thief can only mint statements from moment of theft; anything before is locked. Old content signed by old key remains attributable (it's in the chain history).

Hub fork/staleness: readers remember latest heads (klog head, item head) per identity; a poll returning lower seq than previously seen = stale or hostile; app warns "this hub is behind." Divorce scenario: ex's hub serves frozen item log; mother's app sees newer head from new hub (after one-tap intro or gossip) → old copy reads as stale; items there still verify as hers (he can't alter) but the app badges it "last updated X, identity has moved."

Audience key distribution over time: when encrypting to "family," the author needs current encryption keys of members — from their signed profiles (encryption key bound by signature). Recovery/rotation: sealed items addressed to keys, not identities — old items remain decryptable if recipient keeps old decryption keys (apps retain key history). Note forward secrecy is absent; flag in cost sheet.

The honest cost sheet: 
- No forward secrecy; device compromise exposes sealed history.
- Hub learns: recipient counts, timing, sizes, social graph of public interactions, IP metadata.
- Equivocation detectable not preventable; no global ordering.
- Author can lie about timestamps.
- Discovery of replies bounded by follow graph — replies from strangers need the optional hint path, which the hostile hub can drop; hence "first-class" only within follow reach... scenario: A and B cross-hub both follow each other — fine.
- Key log / item log availability depends on at least one honest copy; app keeps local copy (floor 3) and can re-publish.
- Multi-device is the sketchiest part.
- X25519 addition to primitive set — the one deviation, argued.
- Padding recipient counts costs bytes.
- Revocation of a family member (removing from audience) = future items use new content keys / exclude; old content stays readable — inherent (they were the audience). The divorce: ex is inside family audience until removed; removal only affects future posts. State that.
- No protection against ex re-sharing plaintext he legitimately received. State: not solvable, out of scope.
- Scaling: polling N followees' logs; fine for families, poor for thousands of follows.
- JSON Feed derivation of sealed content: hub can't render it (can't read); private content simply absent from public feeds. Reader apps render.

What to cut to halve: RSS/Atom rendering (keep JSON Feed only), device subkeys, the hint/ping path, padding buckets, multi-hub redundancy, HTML.

Length: they want argued depth, ~4000+ words fine. Use headers, show byte shapes. Write in a design-doc voice. Name the protocol? Give it a name — helps. Call it... something neutral: "Hearth"? "Folio"? "Kin"? The brief's scenarios are family-centric. I'll call it "Hearthline"? Keep simple: **"Hearth"**? Maybe "Understory"? I'll go with "Folklore"? Eh — "HEARTH" is nice. Or "Kinship". I'll name it "Hearth".

Also address "if an existing protocol already solves this, say so": brief mentions ActivityPub, AT Protocol, Nostr, Secure Scuttlebutt. Worth a short paragraph: Nostr is closest on identity=key but has no encryption-to-groups with hidden audiences, no key rotation/recovery (key loss = identity loss), relays can... Nostr fails floor 3/4 partially; AT Proto has rotation via DID PLC (central registry dependency — violates no-registry); SSB has the append-only log + private-boxes but no key rotation at all and no hub portability story with HTTP interop. ActivityPub fails floors 1–3 entirely (server speaks for you, server reads DMs, server keeps you). So existing ones each fail at least one floor item; this design borrows SSB's log and Nostr's key-identity, adds a key log. Good to include briefly.

Signing without canonicalization: emphasize the envelope trick prominently since it's the crux of priority 1 vs 2.

One more check — floor 2 "content addressed to chosen people unreadable by anyone else, the host included": the hostile host is a family member with legitimate credentials — he's a recipient of some content, not of new content after removal. Fine.

Bootstrap / first contact: intro blob = {"id":pubkey,"hub":url, "sig"...} or just URL containing pubkey: https://hub.example/u/<pubkey> — the URL itself carries identity; first fetch returns klog genesis whose key must match the URL. Nice: "the address of a person is a URL embedding their key." After that, hub position can move freely. This handles scenario 7 re-meeting after key loss: stranger re-meets author — new key, new URL; continuity is social (out-of-band), explicitly a non-goal. The reader verifies new intro out-of-band.

Also need: how do followers get notified of new hub when old hub is gone (scenario 4)? Before leaving, author publishes move statement while old hub still up; readers polling get it. If domain lapses suddenly: gossip — followers exchange klog heads when they sync (any two apps following overlapping people can swap latest signed statements; e.g., when you post a reply referencing someone, include their latest known klog head hash/seq in your item metadata — a soft "seen-head" pointer). Nice mechanism: items carry `heads`: {id: kseq/seq} hints; readers merge. That's the gossip layer with zero extra protocol — just optional fields in items. Then mother's app learns daughter's... in scenario 1, the wife's move propagates via any mutual contact whose app has seen it. And "one tap" = she also just sends her mother the new intro link. Good.

Timestamps and "reads as stale rather than as her": stale = app shows frozen copy badge. Also frozen copy still verifies — "as hers but old." The scenario says "reads as stale rather than as her" — meaning current voice is the new hub. Badge: "This copy is 214 days behind; the author has moved."

Envelope hashing for prev: hash over the full previous envelope bytes (the outer JSON as stored) or over payload? Hash over the payload bytes is cleaner (signs stay stable even if re-wrapped... but envelopes aren't re-wrapped). Define: prev = SHA-256 of previous envelope's payload bytes. Hmm, but two items could share payload? seq differs. Fine.

Hubs accepting items: hub checks: signature valid for identity at path, seq = last+1, prev matches. Hub as dumb store with light validation — protects itself from garbage, doesn't create trust.

Authorship of profile/name: profile is an item type; petnames local.

Reader weekend path: implement fetch klog, verify chain, fetch items, verify sigs+chain, render public bodies; sealed: try boxes. Publisher: generate keys, emit genesis, post items, PUT to hub.

Now write the document. Structure per section 7 of the brief: 8 deliverables. Include scenario walkthroughs 1,2,3,4 (and touch 5,6,7). Byte shapes in code blocks. Argue alternatives: DNS identity, DIDs, blockchain, Nostr-style no-rotation, per-item signing vs log, canonicalization vs envelope, MLS/group keying vs per-item boxes, symmetric-only, server-mediated ACLs, push vs pull.

Word budget: aim ~4500-5500 words. Dense but readable. Use headers and code blocks. Let's write.

Name: I'll call the protocol "Hearth" — hmm, or "Kith"? "Kith" is nice (kith and kin). Go with **Kith**. Actually "Hearth" evokes family hub. Either fine. Choose "Hearth"? I'll use "Kith" — short, distinct. Eh — final: **Hearth**. No wait, decision: "Kith". Done.

Identity notation: `k1` prefix + base64url(pubkey)? Keep simple: id = base64url(pubkey), ~43 chars.

Encryption details concrete:
- Sealed item body: 
```
{"alg":"S1","eph":"<b64 X25519 pub>","boxes":[{"t":"<8 bytes>","k":"<40 bytes>"}...],"ct":"<b64>","m":"<b64 16-byte MAC>"}
```
- shared_i = X25519(recipient_priv, eph_pub); secret = SHA-256(shared || "kith-box")
- tag t = secret[0:8]; wrapped key = content_key XOR SHA-256(secret || "wrap")[0:32] → 32 bytes; box MAC 8 bytes = SHA-256(secret||"boxmac"||content_key)[0:8]. So box k field = 40 bytes.
- content key ck random 32 bytes; plaintext = JSON body bytes; ct = P XOR SHA256-CTR(ck, nonce=item hash); MAC m = HMAC-SHA256(ck, ct)[0:16]. Or simpler: keystream = SHA-256(ck || counter) blocks; integrity: m = SHA-256(ck || "mac" || ct)[0:16] (length concerns — SHA-256 keyed prefix MAC is vulnerable to length extension, but with fixed output truncation and known length... length extension applies; use HMAC — HMAC is trivial from SHA-256, stdlib usually has it; if not, 20 lines. Say HMAC-SHA-256, noting it's double-SHA-256, implementable in 15 lines.) Fine.

Boxes count padding: pad with random boxes to next of {1,2,4,8,16,32}.

Recipient lookup: for each box, compute tag from own key; match → unwrap. O(1) per box.

Sender also needs to read own sealed items later: include a box to self.

Rotation of encryption keys: profile item carries current encryption pubkey, signed. Senders use latest. Old items decryptable via retained key history.

Now key statement payload shape:
```
{"kseq":2,"kprev":"<b64>","type":"rotate","sign":"<new ed pub>","enc":"<new x pub>","hubs":["https://h2.example/u/<id>"],"ts":...}
```
genesis adds "rec":["<recovery pub>"] and maybe threshold later — keep single recovery key, note threshold as extension. Actually multiple recovery keys: allow list, any one may sign recover (1-of-n; flag collusion risk, note n-of-m as future). Grandma: rec = daughter's key.

Reader acceptance rules for klog:
1. genesis key = identity (URL id).
2. each statement signed by an authorized key: rotate by current sign key; recover by any key in current rec set; move by current sign key.
3. kseq strictly increasing, kprev chain.
4. On conflict at same kseq: mark contested; surface; do not auto-pick.

Item acceptance: signed by sign key valid at that point in klog (state rule: items signed by a key that was current at some kseq ≤ latest; after rotation, old-key items remain valid historically — verifier checks item against key that was current when... no timestamps trusted; rule: an item is valid if signed by any key that appears in the klog as current at or before the latest kseq, AND the item chain is continuous. Theft wrinkle: thief rotates then writes items — those verify until recover supersedes; on recover, items signed by thief's key after the contested point are dropped/flagged. Rule: recover statement at kseq n may declare "items signed by key X with seq > s are repudiated" — an explicit repudiation list. Good concrete mechanism for the contested departure: the recover statement names the kseq/kprev it forks from and repudiates everything after. Readers then prune the thief's segment. This is honest and implementable.

Contested departure walkthrough: wife W on ex's hub H. W's keys on her phone only. She copies her item log (always synced locally), generates nothing new necessarily — she can keep same keys (ex never had them). She publishes move statement kseq 7 to her items/klog — but ex's hub refuses to serve/accept. She posts move + future items to new hub H2; sends mother intro link (one tap); also mutuals gossip. Ex claims departure is forgery: his evidence would require a competing klog branch — he has none signed. Mother's app: klog at H2 extends the chain she already had (kprev matches her remembered head) — cryptographic continuity, zero trust. Frozen copy on H: her old items, still valid, app marks stale because head seq < known head. If ex ALSO claims she was hacked... he cannot produce signatures. The only genuinely contested case is key theft, handled above with recover+repudiate. The phrase in the brief "hostile operator claims the departure is the forgery" — since operator never had keys, his claim is unsubstantiated assertion; the protocol's answer: assertions don't verify, chains do.

Scenario 2 grandma: onboarding: app generates keys, shows nothing; she picks petname (local). Genesis names daughter as recovery (daughter taps "I vouch" — her app signs... recovery designation must be IN genesis signed by grandma's key — daughter just provides her pubkey via QR proximity). Phone lost a year later: new phone, app generates new keypair, shows a short code/QR; she calls daughter; daughter's app (which follows grandma) shows "new key claiming to be Mom? verify code"; daughter confirms by voice; daughter's app signs recover statement {fork from kseq last, new sign key} and publishes to grandma's hub slot (daughter can publish it anywhere — it's self-authenticating; mother's... the statement is served from any hub, e.g., daughter's own hub as a "klog mirror" — apps mirror klogs of people they follow! Nice: klog mirroring is natural and helps availability). Grandma re-downloads her item log — wait, her copy was on the lost phone. Copies exist at: her hub (serves her items back to her — but sealed items encrypted to others... she included self-box, and her old decryption key is GONE with the phone). PROBLEM: grandma's old sealed items were decryptable only with lost keys. Mitigations: recovery could escrow an encryption backup: at setup, app encrypts a key-history backup blob to the recovery holder (daughter stores an encrypted backup she can't read — encrypted to... if it's encrypted to grandma's new key she doesn't have it yet... Flow: backup blob = grandma's key history encrypted with a random backup key; backup key given to daughter's app at setup (out-of-band QR at onboarding, or encrypted to daughter's enc key — daughter CAN read it then... make it encrypted to a key split? Keep simple honest: at onboarding, grandma's app encrypts the seed backup to DAUGHTER's encryption key and stores the blob on grandma's hub (hub can't read; daughter could — she's the trusted recovery person, that's the trust model; the brief says recovery by calling daughter, so daughter is trusted). On loss: daughter fetches blob, re-encrypts/passes to grandma's new key after voice-verify. This is clean: "recovery = a trusted person holding (a) power to re-key you, (b) an encrypted copy of your secrets." Blob on hub is unreadable by hub. Good. Also content others wrote to her: they encrypted to her old enc key → re-encrypt? Senders' apps can lazily re-box old items to her new enc key when they notice rotation (optional nicety; or she just loses old sealed content decryption — but with the backup blob she doesn't lose anything). With backup blob, she recovers everything. State that without the blob, sealed history addressed to her is recoverable only if senders re-box.

Scenario 3: A@a.example, B@family.example. A writes family-only post: sealed to {A self, B, Mom...}. A's app fetched B's profile (enc key) from B's klog/profile at family.example — public fetch, no agreement. B's app polls A's item log at a.example (B follows A — bootstrap via intro link exchanged once). Sealed item fetched, box matched, decrypted. Reply: item in B's log, refs (A-id, item hash), sealed to same audience (resolved from... audience known because B decrypted the original — app computes audience = original recipients? B only knows it was addressed to him; audience hiding means B can't enumerate other boxes! Interesting wrinkle: recipient can't see who else got it. Options: plaintext header INSIDE the ciphertext lists audience ids — hub can't see, recipients can. Yes: the sealed plaintext includes "aud":[ids] so replies can target the same set. Nice detail.) Reaction same. Discovery of B's reply by A: A follows B, polls B's log, sees ref to own item hash → threads it. No ACL config anywhere: authorization = possession of box. Latency: optional hint POST (B's app pings a.example/inbox with {from, ref-hash} unsigned hint) — ex can drop hints; poll catches up. Good.

Scenario 4: domain gone. Everyone's id = key, unchanged. Each publishes move (before lapse) to new hub; readers poll and follow. If lapse is abrupt: klog mirrors held by followers + gossip heads in items; one out-of-band intro per identity worst case. Mention commercial migration: export = the two logs; import = POST them.

Scenario 5 big lazy hub: flat cost: store+serve signed blobs, verify sig on write only; no per-request crypto, no ACLs, no user database beyond id→log. Hostile at scale: can't forge (sigs), can't read (sealed), can't trap (export is the logs themselves; users keep copies via their apps). Per-identity cost flat: O(items stored).

Scenario 6 weekend: order: publisher (keypair, genesis, items, envelope, PUT) ~ day 1; reader day 2; dumb hub day 3 (static file server with sig check on POST).

Scenario 7: stranger: RSS/JSON Feed derived view at /feed.json; Mastodon via existing RSS bridges (Bridgy Fed). Key loss without recovery set: new identity, re-meet out-of-band; old feed ends with signed "I lost my key, meet me at <new intro>" IF they still can sign — if total loss they can't even sign that; honest: stranger re-verifies socially. Non-goal acknowledged.

Interop honesty: replies coming back from fediverse is an extension (bridge would need to sign on behalf — bridges mint their own identities; note it).

Also section: why not just use SSB/Nostr/ATProto — short paragraph up front or in identity section.

Threat items hub CAN do: withhold/censor (availability), equivocate, traffic analysis, serve stale, delete (mitigated by local copies + mirrors), hint dropping, correlation of box counts. List in cost sheet.

Multi-device: device grants: sign key per device authorized by root? To keep minimal: the klog "grant" type authorizes additional sign keys; each item notes which key signed (envelope has "k":"<pubkey>" field). Recovery repudiation handles revoked devices. Keep brief, flag as least-sure area.

Envelope with key field:
```
{"v":1,"k":"<b64 ed pub of signing device key>","p":"<b64 payload bytes>","s":"<b64 sig over payload bytes>"}
```
Hmm sign over payload bytes only, or over k||p? Bind key: sig over ("kith1" || k || p) to prevent envelope confusion. Fine, one line.

Payload prev = SHA-256 of previous payload bytes? Or previous envelope? Choose previous payload bytes (item payloads are the content). Define head = (seq, SHA-256(payload)).

Okay. Also timestamps: "ts" author-claimed, readers use for display, chain for order.

Now write ~5000 words. Format: markdown headers, code blocks for byte shapes, bold for key rules. Follow the 8 requested deliverables in order, with scenario walkthroughs and walkthroughs for 1-4 required plus brief 5-7. Include rejected alternatives inline. Be honest about uncertainties. Let's draft.

I'll write the final answer now, keeping it tight but complete. Aim: comprehensive but not bloated. Maybe ~4500-5500 words. Headers numbered per their requested structure.
```

</details>

