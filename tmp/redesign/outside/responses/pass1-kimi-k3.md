---
model: kimi-k3
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:53:09.219Z
prompt: PROMPT-pass1.md
prompt_sha256: ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d
reasoning_effort: medium
finish_reason: stop
tokens: {"prompt_tokens":1688,"completion_tokens":13278,"total_tokens":14966,"cached_tokens":512,"prompt_tokens_details":{"cached_tokens":512},"completion_tokens_details":{"reasoning_tokens":5752}}
wall_seconds: 436
truncated: false
reasoning_chars: 24953
---
# HEARTH — a design for hostile-host personal publishing

Working name: **Hearth**. Everything below is argued from the floor upward. Where I made a non-obvious call, the rejected alternative is named. Where I'm guessing, I say so.

---

## 0. Primitives assumed

The design assumes a standard library providing:

- **Ed25519** (sign/verify)
- **X25519** (ECDH). If absent but ECDH over P-256 exists (Java, .NET), P-256 is a drop-in replacement; the wire format names the curve. If your stdlib has Ed25519 but *no* DH at all, see the fallback note in §6.
- **SHA-256**, **HMAC-SHA256** (HKDF is built from HMAC in five lines; the spec includes them)
- **AES-256-GCM**. Fallback if absent: ChaCha20-Poly1305 is ~150 lines of portable code and the spec may include a reference implementation; I treat this as acceptable because Poly1305 is short and testable, but AES-GCM is the primary.
- **base64url** (no padding), **JSON**, **HTTPS**

Everything signed is signed over **exact bytes**, never over canonicalized JSON. This is the single most important wire decision, so it gets stated here: JSON canonicalization is a known implementer trap and is explicitly out of scope per the brief. Instead, every signed object is transmitted as

```json
{"body": "<base64url of exact bytes>", "sig": "<base64url Ed25519 over those bytes>"}
```

The `body` bytes are themselves JSON, but verifiers never re-serialize them — they verify the bytes, then parse. The **hash of an object** is `SHA-256(body bytes)`, base64url-encoded, written `h:…`. Hashes and signatures are therefore independent of key order, whitespace, and JSON dialect. A second implementer cannot get this wrong without failing every test vector, which is the point.

---

## 1. Architecture in one page

**What a person is:** an Ed25519 keypair, generated on their device, never leaving it except under their control. The **identity id** is `p` + base64url of the *inception* public key (32 bytes → 43 chars). Current keys may differ from the inception key via rotation (§5); the id never changes.

**Artifacts.** There are exactly five.

1. **Card** — a signed object, the root of everything a stranger needs:
```json
{"v":1, "t":"card", "id":"p…", "seq":41,
 "key":"<current Ed25519 pub, b64url>",
 "enc":"<current X25519 pub, b64url>",
 "hubs":["https://family.example","https://b.example"],
 "rot":[{"key":"<prior pub>","by":"<sig of this card's predecessor key>","n":1}],
 "name":"Nana Rose", "ts":1737000000}
```
The card is signed by the *current* key; the `rot` chain links it back to the inception key that `id` encodes (§5). `enc` is a separate X25519 key, certified by being inside a signed card. The card supersedes by `seq`.

2. **Log** — an append-only sequence of **entries**, each a signed object:
```json
{"t":"post"|"reply"|"react"|"vouch"|"rotate"|"move",
 "id":"p…", "seq":142, "prev":"h:<sha256 of entry 141's body>",
 "ts":1737000123, …type-specific fields…}
```
`prev` makes the log a hash chain: the hub cannot delete, reorder, or splice entries without invalidating every later signature the author has published. Public entries carry content inline (`"text":"…"`, photo by blob hash); private entries carry an encrypted envelope (§6) and are opaque to the hub.

3. **Blobs** — content-addressed byte strings (photos), fetched by hash. Private blobs are ciphertext; the hash is of the ciphertext, so the hub can dedupe and serve them blindly.

4. **Envelopes** — the delivery unit. POSTed to a recipient's hub inbox:
```json
{"to":"p…recipient…", "env":"<base64url ciphertext>"}
```
Inside the ciphertext: the sender id, a signature, and either a private log entry, a move notice, or a vouch. The outer envelope reveals only the recipient.

5. **Feeds** — the hub *renders* each identity's public entries as RSS 2.0 and JSON Feed at fixed paths. This is a rendering, not a protocol object; it carries no signatures and exists purely for interop (§3, assurance 4 is cryptographic; feeds are a courtesy).

**HTTP surface** (the whole of it):

```
GET  {hub}/p/{id}/card            → latest signed card
GET  {hub}/p/{id}/log?after={seq} → signed entries after seq (paged)
GET  {hub}/p/{id}/b/{hash}        → blob bytes
GET  {hub}/p/{id}/feed.xml        → RSS 2.0 rendering of public entries
GET  {hub}/p/{id}/feed.json       → JSON Feed rendering
POST {hub}/inbox                  → {to, env}
```

**First contact.** A reader knows an `id` and a hub hint (from a link, a QR code, a vouch, or a contact's address book). It fetches `card`, verifies the rotation chain back to the inception key, stores the card, then fetches `log?after=0` and verifies each entry: signature under the card's current key, `prev` linkage, monotonic `seq`. Private entries are trial-decrypted (§6); those not addressed to the reader are skipped as opaque.

**Poll.** `GET card` (compare `seq`; if newer, re-verify), then `GET log?after={last_seen}`. That's all. No subscriptions, no webhooks, no push — a poll interval is an app decision.

**Writing.** The author's app holds the key and a full local replica of its own log. Publishing a public entry = append locally, upload to hub(s). Publishing a private entry = encrypt to the audience, upload the opaque entry to the author's hub (for the author's own history) **and** deliver a copy inside an envelope to each audience member's hub. Readers of private content fetch *their own copy from their own hub*. This is the load-bearing decision behind assurance 4, argued in §3.

**Rejected here:** a DHT or registry for discovery (banned, and unnecessary — discovery is social), server-side fan-out for private content (puts the hub in the confidentiality path, violating assurance 2), and hub-to-hub federation protocols (nothing in the floor requires hubs to trust or even know about each other).

---

## 2. The identity primitive

**A person is an Ed25519 keypair; an identity is the base64url of its inception public key, plus a signed rotation chain establishing the current key.**

Why this and not the alternatives:

- **DNS names as identity** (`alice@family.example`): rejected because scenario 4 (the domain goes) and the divorce both require identity to survive the host. A name bound to a domain is a lease, and the landlord is the adversary.
- **Bare current public key as identity, no rotation chain**: simpler, and honestly considered. Rejected because §5 of the brief demands planned rotation with continuity, and "every key change is a new identity" makes routine hygiene (phone upgrade, suspected theft) socially expensive. The rotation chain costs one array in the card and one verification loop.
- **Hash-linked key-event log (KERI-style) with pre-rotation**: the serious contender. Pre-rotation (committing to the next key's hash in advance) gives theft resistance: a thief of the current key still can't rotate. I rejected it on two grounds. First, it doesn't survive the actual scenario-2 failure: Grandma loses her phone, and the pre-rotated key was *on the phone*. Total device loss defeats pre-rotation exactly when a non-technical user needs recovery. Second, it roughly doubles the identity section of the spec — every implementer must implement event-log semantics, not just signature verification — for a property (theft-resistant rotation) that social vouching provides anyway. The brief's non-goals explicitly release me from continuity across total key loss; I spend that freedom here.
- **Petnames / any global naming**: rejected; there is no registry and the brief bans building one. `name` in the card is a self-asserted display string. Disambiguation is done by introduction path (who vouched, who handed you the link) — which is how families actually work.

So: keys are identity, **vouches** are names. A vouch is a log entry:

```json
{"t":"vouch","id":"p…voucher…","seq":88,"prev":"h:…","ts":…,
 "old":"p…alice-old…","new":"p…alice-new…",
 "note":"my sister Alice, lost her phone 2025-01-12"}
```

Reader policy: a rotation signed by the old key is accepted automatically. A vouch is accepted if the voucher is (a) in *your* contacts and (b) someone you already associated with the old id — e.g., you saw them in a shared thread. Apps should confirm with one tap rather than silently; see §5.

**What this identity cannot do:** it cannot give a stranger continuity across total key loss (explicitly a non-goal, scenario 7's "re-meet"), and it cannot distinguish "the person" from "whoever holds the key." Theft is handled socially (§5), not cryptographically. That is a real cost and it's named, not hidden.

---

## 3. The four assurances, mechanism by mechanism

### 3.1 The host cannot speak for you

Every author-originated object — card, log entry, envelope inner — is signed by a key the host never possesses (keys are generated and held in the app; the hub API has no endpoint that accepts key material, and upload endpoints accept only signed bodies). Verification is total: a reader verifies the rotation chain to the inception key, then every entry's signature and `prev` link. Anything the hub invents, alters, backdates, or reorders fails verification or breaks the chain.

**Failure modes, named:**

- *Withholding.* The hub can refuse to serve entries, or serve an old prefix. It cannot be prevented — it controls the disk. It is **detectable**: sequence gaps, and a head newer than what the hub serves (learned from any other copy — another listed hub, or gossip with contacts, §3.3). The remedy is exit, which assurance 3 makes cheap. The spec makes hubs redundant (`hubs` is a list) so withholding one copy is not withholding all.
- *Split views.* The hub shows reader X entries {1..50} and reader Y entries {1..48}. Detectable when readers compare heads (apps gossip heads inside the encrypted envelopes they're already exchanging — free side channel) and when the author audits their own hub as an anonymous reader. Not preventable in principle; made attributable in practice because any two signed conflicting entries… can't exist — only the author signs. So hub equivocation takes the form of selective omission, which the gossip channel catches.
- *The hub signs nothing itself.* Deliberately. Hubs are untrusted storage; a hub signature would prove nothing anyone needs and would tempt implementers into trusting it. The dumb-hub weekend implementer (scenario 6) implements zero cryptography.

### 3.2 The host cannot read what wasn't meant for it

Full construction in §6. Sketch: each item gets a random content key; the body is AES-256-GCM under that key; the content key is wrapped per recipient via ephemeral-static X25519 to the `enc` key in the recipient's card. The header carries no recipient identities — recipients trial-decrypt. The adversary-in-the-audience case is handled by scoping: after the divorce, she writes to "family minus him," and no mechanism is claimed for posts that *were* addressed to him — those he keeps, and the spec says so.

**Failure mode:** recipient key compromise retroactively exposes everything addressed to that recipient (no forward secrecy — flagged in §7 as my least comfortable choice). And the hub learns metadata (§6.4): timing, sizes, audience size, delivery edges.

### 3.3 The host cannot keep you

Three mechanisms, all structural rather than procedural:

1. **The key was never the host's** (3.1), so identity is portable by construction.
2. **The app is required to keep a full local replica** of everything it publishes. This is a MUST in the spec, not a suggestion: "an implementation that does not retain a local copy of every entry it publishes is non-conformant." Exit is therefore not an export procedure; it is re-upload of what you already have. The hub's copy is a cache of your device, not the reverse.
3. **Departure is a signed log entry and a pushed notice:**
```json
{"t":"move","id":"p…","seq":201,"prev":"h:…","ts":…,
 "hubs":["https://newhub.example"]}
```
The author's app POSTs this inside envelopes to every contact's hub inbox and uploads it to the old hub too (he may drop it; see below). New hub: app replays the local replica and publishes a fresh card. Readers poll the old hub, see nothing new, and receive the move envelope — mom's app shows "Alice moved to newhub.example — follow?" One tap (scenario 1's requirement) updates the stored card.

**Failure mode — the contested departure (the brief asks for this one explicitly):** he serves a frozen copy and claims *her* move notice is the forgery. Resolution: the move entry is signed and hash-chained to entries her readers already hold; a "forged" move cannot chain to `prev` hashes that predate the dispute. His frozen copy can only ever be a *prefix* — verifiably stale against any newer head, and unable to extend. His remaining move is to claim her key was stolen and that the *frozen* log is the real her. The protocol's answer is cold but correct: **the key is the person;** if he truly has her key, no protocol can tell them apart, and the remedy is the theft path of §5 (she re-keys and vouches from the new inception). If he doesn't have the key, his claim produces no valid signatures and dies on first verification. "Reads as stale rather than as her" is delivered by the chain, not by his cooperation.

### 3.4 People on other hubs are first-class

This falls out of one decision: **access control is possession of a content key, not hub policy.** A private entry is a self-contained ciphertext. The author delivers a copy to each audience member's own hub in an envelope; each reader fetches it from *their* hub with the ordinary, unauthenticated `GET` — there is nothing to authorize, because the bytes are useless without the key. Two hubs never need an access-control agreement, a federation contract, a shared allowlist, or even knowledge of each other's existence (scenario 3). Cross-hub replies and reactions are just more encrypted entries delivered the same way, threading by content hash (`root: h:…`, `ref: h:…`).

Public content crosses hubs even more trivially: any reader can `GET` any public log from any hub, and the feed renderings make it visible to RSS readers and (via any existing RSS→ActivityPub bridge) Mastodon with nothing built — scenario 7.

**Failure mode:** spam. `POST /inbox` is unauthenticated at the outer layer (the sender is inside the ciphertext by design, §6.4). A hub cannot distinguish a stranger's envelope from a contact's without its user's keys. Mitigation: hubs rate-limit per recipient, and apps silently drop envelopes that don't decrypt or don't verify. A hub that wants harder policy may require a per-recipient bearer token in the URL (`POST /inbox/{token}`), issued by the user to their contacts — listed in the spec as an optional hub-local mechanism, deliberately not federated.

---

## 4. Scenario walk-throughs

### 4.1 The divorce

Her key is on her phone; his hub never held it. **He cannot post as her:** any entry he fabricates fails signature verification in every reader that has her card. **He cannot read her new family-only posts:** she now addresses "family minus him"; the content key is wrapped only to those `enc` keys. He holds ciphertext. (The posts from the marriage that were addressed to him: he can still read those. No honest design claims otherwise; §2 of the brief concedes it.) **He cannot alter or backdate:** the hash chain; his edits break signatures, his insertions break `prev`. **He cannot stop her leaving:** her app holds key + full replica. She stands up an account on a cousin's hub (or a €2 host), replays, publishes a `move` entry and new card, and pushes move envelopes to her contacts. Her mother's app surfaces "Alice moved — follow?"; one tap; subsequent polls go to the new hub. His frozen copy is a prefix of her chain: any reader with the move entry holds a signed head newer than anything he can ever serve. It reads as *an archive*, not as *her*. He may drop her `move` entry from the copy he serves — irrelevant, since the notice reached contacts by the inbox path, which he is not on: envelopes go from her device directly to each recipient's hub.

### 4.2 Grandma onboards

Install. App generates the keypair in the background. She types "Nana Rose." The app shows a QR / link (`hearth:p…?hub=…`) she shows her daughter in person; daughter's app fetches the card, and both apps record each other as contacts. She is never shown a key and never told to store anything.

A year later, the phone is gone. New phone, new app, **new inception key** — the old one is unrecoverable and the design does not pretend otherwise. She calls her daughter. Her app sends a vouch request (an envelope containing her new card) to the daughter's hub; the daughter's app displays "Someone claims to be your mother (Nana Rose, `p…old`). Verify by voice?" The daughter **calls her** — the spec requires the app to phrase it that way, because the vouch's entire value is the out-of-band check — and taps confirm. The daughter's app publishes a `vouch` entry (`old` → `new`) and replies to the request with the family contact list the grandma had been part of.

Every family member who follows `p…old` and trusts the daughter now sees: "Nana Rose has a new key, vouched by [daughter], whom you both know. Re-follow?" One tap each. Her public archive is re-ingested from her hub into the new identity's app as a read-only "previous journal" (clearly labeled, signatures intact). Her private posts are recoverable only in the sense that the family holds copies and can re-share; the spec claims nothing more. Strangers who followed her meet her again as a new identity — the brief's scenario 7 explicitly licenses this.

### 4.3 Two hubs, one thread

A (`p…A`, on `a.example`) writes a family-only post to audience {A, B}. Her app encrypts (§6), uploads the opaque entry to `a.example`, and POSTs an envelope containing the same entry to `family.example`'s inbox, addressed `to: p…B`. B's app polls its own hub's inbox — the only poll it ever makes — decrypts the envelope, verifies A's signature against A's card (fetched once from `a.example`, cached), and displays the post. B replies: audience {A, B} again; the reply entry goes to B's own hub and in an envelope to `a.example` addressed to A. A reaction from B: same machinery, `{"t":"react","ref":"h:…","symbol":"❤"}`. Neither hub configured anything; neither hub can read anything; neither hub needed to know the other exists. The thread is woven by content hashes, so it displays correctly regardless of which copy any reader received first.

### 4.4 The domain goes

`family.example` lapses. Identities are keys — nothing about them changes. Before the shutdown (or after, for those who moved early), each person updates their card's `hubs` list and pushes `move` envelopes to contacts. Readers whose authors moved silently follow. The stragglers — people whose readers poll a dead domain — are recovered by two mechanisms: cards SHOULD list at least two hubs (spec recommendation; apps warn at setup if only one), so most readers were already dual-homed and simply fail over; and `move`/`vouch` gossip means one cousin's re-follow propagates the new location to the family graph within one poll cycle. Public archives are re-uploaded from local replicas to the new hosts; signatures and hashes are unchanged, so every `ref` in every old reply still resolves.

(Scenarios 5–7 are covered inline: the big lazy hub is a dumb KV store whose per-identity cost is `O(entries)` with constant overhead — it does no crypto at all (§3.1, scenario 5); the weekend implementer handles five endpoints and one envelope pattern with stdlib-only primitives (scenario 6); the stranger subscribes to `feed.xml` in any reader, sees posts on Mastodon via any existing RSS→AP bridge, and after key loss re-meets the author via her new feed (scenario 7).)

---

## 5. Key change and recovery

There are three transitions, in decreasing strength:

**Rotation (planned).** The old key exists and is trusted. The app generates a new signing key (and a new `enc` key) and publishes a card whose `rot` array gains one link: `{"key":"<new pub>","by":"<old key's signature over the new card body>","n":<k>}`. Readers verify the chain: inception key (== `id`) → link 1 → … → current. Identity id unchanged; followers notice nothing except a card `seq` bump. Used for phone upgrades, hygiene, and *suspected* (unconfirmed) compromise.

**Loss (total).** No old key. New inception id, recovery purely by vouch (§4.2). The spec's only requirements: apps must request vouches through the contact graph, apps must display the voucher and require an explicit tap, and apps must keep the old identity visible as a labeled archive. The brief's non-goal makes this legal; my claim is narrower — it's also *sufficient for the stated audience*, because families have redundant, voice-verifiable relationships.

**Theft.** The hard one. The thief can sign as the victim, including rotations — a thief *rotating* looks identical to the victim rotating. The protocol's position, stated plainly: while the thief alone holds the key, the protocol cannot distinguish them, and any design claiming otherwise is claiming magic. What the design provides is the fastest possible *social* re-key: the victim creates a new inception and pushes vouch requests to every contact; contacts verify out-of-band (the app literally instructs "call them"); the theft is denounced in the victim's contacts' own logs (`{"t":"vouch","old":…,"new":…,"note":"stolen, do not trust p…old after seq 212"}`), which doubles as a revocation signal — a vouch whose `old` key readers are told to distrust past a sequence number bounds the thief's window to entries the contacts accept. Everything the thief signed in the window is provably "signed by the key that was her at seq ≤ 212" — which is precisely, and only, what it is.

**Contested departure** is covered in §3.3: the chain resolves forgery claims in her favor when he lacks the key, and the theft path applies when he has it.

A flagged uncertainty: the spec sets no vouch threshold (how many vouchers, what trust). I specify single-voucher-by-known-contact with mandatory user confirmation, because families are small and the confirmer is human. A formal M-of-N policy language smelled like spec bloat for scenario-2 scale, but I am not certain this is right for the 10,000-customer hub, where contacts are weaker ties.

---

## 6. The encryption construction

Goal: an entry readable by exactly a chosen audience, opaque to everyone else including every hub, with the audience identities not published.

### 6.1 Keys

- Identity signing key: Ed25519 `(sk, pk)`.
- Encryption key: X25519 `(ek, ePK)`, generated with the identity, published in the signed card (`enc`). Separate key, certified by the signing key — **rejected alternative:** deriving X25519 from the Ed25519 key (the libsodium birational map). It saves a key field but requires every implementer to write Edwards→Montgomery field arithmetic correctly, which is exactly the kind of subtle, unglamorous code that breeds interoperability bugs. A second keypair costs nothing at this scale.

### 6.2 Per-item construction

For an item with plaintext `P` and audience {R₁…Rₙ} (the author always included):

1. `CK ← random(32)`; `nonce_b ← random(12)`.
2. `C ← AES-256-GCM(CK, nonce_b, P, aad = header_bytes)`. Plaintext `P` is JSON: `{"text":…,"ref":"h:…","root":"h:…",…}` plus blob refs.
3. For each recipient Rᵢ, in random order:
   - `eph_i ← random X25519 keypair`
   - `s_i ← X25519(eph_i_secret, Rᵢ.ePK)`
   - `WK_i ← HKDF-SHA256(s_i, salt=nil, info="hearth-wrap" ‖ Rᵢ.id ‖ item_hash)` (32 bytes; HKDF expand is two HMAC invocations)
   - `slot_i = eph_i_pub(32B) ‖ nonce_i(12B) ‖ AES-256-GCM(WK_i, nonce_i, CK)(48B)`
   - `tag_i = HMAC-SHA256(WK_i, "slot")[0:2]` — prepended to the slot so recipients skip non-matching slots with one HMAC instead of a GCM failure; leaks nothing (2 bytes under a per-item key).
4. Header (the *body* of the log entry, signed as always):
```json
{"t":"post","id":"p…","seq":143,"prev":"h:…","ts":…,
 "enc":{"v":1,"alg":"X25519-HKDF-A256GCM","nb":"<b64 nonce_b>",
        "c":"<b64 C>","slots":["<b64 tag‖slot>", …]}}
```
Signature covers the whole body, ciphertext included — so the hub cannot tamper with slots, strip recipients, or swap ciphertexts.

**Decryption:** for each slot, compute `s ← X25519(my_ek, slot.eph_pub)`, `WK ← HKDF(…, my id, item_hash)`, check `tag`, then unwrap `CK`, then decrypt `c`. O(slots) HMACs worst case, one GCM each for matches — trivial at family scale.

### 6.3 Properties and decisions

- **Audience hiding:** slots carry no ids; an observer learns only `len(slots)`. **Optional padding:** apps SHOULD pad slot count to the next power of two with garbage slots (random bytes). Spec'd as SHOULD, not MUST — padding leaks less but I didn't want to mandate a policy.
- **Blobs** (photos): encrypted under the same `CK` (one content key per post covers its attachments), stored as ciphertext, addressed by ciphertext hash.
- **Replies** re-derive the audience from the thread (the replier's app knows whom it could read the root as; audience defaults to root's audience) and generate a **fresh CK** — no group keys exist, so removing someone from a thread is just "not in the new slot list," and old items remain readable to former members, which §3.2 already conceded.
- **Delivery:** the encrypted entry is uploaded to the author's hub (their own archive) and sent inside envelopes to each recipient's hub. Envelope encryption is the identical construction with audience {recipient} and `P = {"from":"p…","sig":…,"entry":{…}}` — sender identity exists only inside the ciphertext.
- **Fallback if stdlib has Ed25519 but no X25519:** P-256 ECDH where available; otherwise the spec permits a pinched construction — ephemeral X25519 implemented from the field arithmetic a stdlib bignum provides. I flag this as the one place "stdlib only" genuinely bites (Python's stdlib, notably, ships neither Ed25519 nor X25519 — a Python implementer is out of luck on the *no third-party* constraint as literally stated; Go, Java, C#, Swift, and Node are all fine. The brief says to name assumptions: this is mine.)

### 6.4 What the hub learns anyway

Everything not encrypted: that identity `p…` published something of size S at time T; the (padded) audience size; the reply graph of *public* threads; and, on the recipient's hub, that *someone* sent `p…B` an envelope of size S at time T (sender hub/IP is visible at the transport layer — mitigable by the sender's app but not hidden by the protocol; anonymity beyond recipient-hiding is an explicit non-goal). The author's own hub sees **only** what the author uploads — since private delivery is device→recipient-hub, the author's hub never sees delivery edges at all. In the divorce scenario this matters: her ex's hub learns that she posts and roughly when, and nothing else — not the audience, not the content, not whom she talks to.

---

## 7. The honest cost sheet

- **No forward secrecy, anywhere.** Static `enc` keys mean one stolen phone exposes everything ever addressed to it. Ratcheting (Signal-style) would fix it and would triple the spec, require session state synchronized across devices, and break the "fetch any copy from any hub and decrypt" model. I chose the simple thing for the stated adversary (a hostile *operator*, not a device thief) and I am **least sure of this choice** of all of them.
- **Signatures are non-repudiable.** Everything you write is provably yours, forever, to anyone who holds it. That's the price of assurance 1. For a family journal this is arguably a feature (authenticity of the archive); for a teenager it might not be. Off-the-record deniability is incompatible with the floor and was not attempted.
- **Metadata is only partly protected** (§6.4). A patient hostile hub builds a timing/size profile and, if it also hosts some of your contacts, correlation edges. The floor doesn't promise more, but users will assume more; the spec must say so loudly.
- **Multi-device is punted.** Key sync between a user's phone and laptop needs either export/import (a file the brief says Grandma must never be told to store) or a device-linking sub-protocol (vouch-your-own-device — actually the same vouch machinery, one extra entry type). I specify single-device and list device-linking as an extension. This will be the first thing real users demand.
- **Discovery is entirely social.** No search, no directory, no global names. Strangers find you by URL. This is correct for the audience and a hard ceiling on growth — accepted per non-goals.
- **Reader-side cost of hidden audiences:** trial decryption per slot, and private archives are duplicated on every audience member's hub (N copies of N-recipient content). Flat per identity, fine at family scale, wasteful in the large.
- **The stale-not-her property is social, not absolute.** It holds for readers who got the move notice or gossip a newer head. A reader who only ever polls his hub and has no contacts in common sees a frozen journal with no signal. The spec mitigates (dual hubs, head gossip) but cannot close this; nothing can, short of a ledger, which is banned.
- **Vouch trust policy is under-specified** (§5) — my second-least-sure point.
- **Complexity is front-loaded in the app, not the hub.** "Weekend hub" is genuinely easy; "weekend publisher" is easy only because the envelope pattern (§0) removes canonicalization. The crypto composition (HKDF info strings, AAD, tag prefix) is small but exact; the spec must ship test vectors or interop dies.

## 8. What I would cut, forced to halve

In order:

1. **The rotation chain** — collapse to "every key change is a vouched new inception." Rotation then costs re-following; theft handling is unchanged. Loses scenario hygiene continuity; keeps every floor item. This is half the identity machinery for a property the floor doesn't list.
2. **Atom and one of RSS/JSON Feed** — keep JSON Feed (trivial to emit) plus RSS 2.0 only if bridges demand it.
3. **Slot padding** — keep audience hiding, drop size hiding.
4. **Multi-hub card redundancy** — keep the field, drop the SHOULD.
5. **Head gossip between contacts** — the split-view detector. Painful to cut, but it's a detection refinement, not a floor mechanism.

What I would not cut at any size: sign-the-bytes envelopes, the hash-chained log, per-item content keys with recipient-hidden slots, and the local-replica MUST. Those four *are* the floor.

---

### Closing note on existing protocols

The brief invites the argument that something already solves this. The honest survey: ActivityPub fails assurances 1–3 outright (the instance holds keys in effect, speaks for users, and lock-in is notorious); Bluesky's AT Protocol is closest philosophically (keys, portability, signed repos) but assumes a global directory/relay infrastructure the brief bans; Nostr is keys-plus-relays and gets 1 and 3 but has no private-audience story that hides recipients and no rotation; Secure Scuttlebutt gets 1–3 and social recovery but no web interop and no multi-hub portability of identity; encrypted-mail overlays fail 3. None satisfies the floor *under these constraints* — stdlib-only, no shared infrastructure, hostile insider operator, feed-reader interop. Hearth is, deliberately, the intersection of SSB's self-certifying log and AT's portability, stripped of everything that required infrastructure, with the encryption doing the work that ACLs do elsewhere.

<details><summary>Model reasoning trace (24953 chars) — kept because rejected alternatives often live here</summary>

```
This is a substantial design brief asking for a full protocol design. I need to write a long, argued design document. Let me think through the actual design carefully first.

Core constraints:
- No third-party libs: stdlib only. Ed25519, SHA-256, HTTP, JSON, base64 illustrations. Need encryption construction from stdlib primitives — this is the hard part. Stdlib with Ed25519 but maybe not X25519 or AEAD... The brief says "any primitive your target language's standard library actually provides is in bounds." I should assume Ed25519, SHA-256, HMAC, a stream cipher or AES-CTR/GCM... Many stdlibs (Go) have all. Python stdlib has no Ed25519 actually — but the brief says illustrations. I should pick a primitive set and justify. Key problem: Ed25519 signing keys can't do DH directly without conversion (birational map to Montgomery — that's implementable in ~30 lines of bigint arithmetic, but risky). Options:
  1. Two keys: Ed25519 signing + X25519 encryption key, the encryption key certified by the signing key.
  2. Derive X25519 from Ed25519 seed via hash (libsodium-style conversion) — but requires implementing field arithmetic.
  3. Use a KEM-like construction: sender generates ephemeral X25519... still needs X25519.
  
  Simplest: each identity has a signing key (Ed25519) and a separate DH key (X25519), both on the device, DH key signed by signing key. Sender does ephemeral-static X25519 per recipient, then KDF via SHA-256/HKDF-ish (HKDF is trivially HMAC), then AEAD. AEAD: if stdlib has AES-GCM use it; else implement... ChaCha20-Poly1305 in pure code is doable but slow; Poly1305 is ~50 lines. Go stdlib has chacha20poly1305? Actually golang.org/x/crypto is not stdlib, but Go stdlib has AES-GCM. I'll assume AES-256-GCM (widely in stdlibs: Go, .NET, Java, Rust via... no Rust stdlib has no crypto). The brief says state assumptions. I'll assume: Ed25519, X25519 (or ECDH P-256 as fallback — P-256 ECDH is in many stdlibs too), SHA-256, HMAC-SHA256, AES-256-GCM, base64url. State that clearly.

Identity primitive: public key. Choices: bare pubkey, did:key, self-certifying with hash (KERI-style), DNS-based. The floor: host can't speak for you, you can leave with identity, domain loss doesn't change identity. So identity = Ed25519 public key, encoded. But rotation needed (scenario 2: grandma loses phone). Recovery: social recovery — "calling her daughter." So identity must survive key loss via... options:
  - A) Identity = pubkey; key loss = new identity; followers re-meet. Scenario 7 explicitly allows re-meeting after key loss ("After the author's key loss, they re-meet the author"). Non-goal: "continuity of a stranger's view of you across total key loss." So total key loss = new identity is acceptable for strangers. But grandma must be "back by calling her daughter" — daughter can vouch: the daughter's app, which follows grandma, sees new key + attestation. So recovery is social attestation, not cryptographic continuity. Grandma's new identity is introduced by daughter's signed statement "this is my mother, her old key was X, new key is Y." That's a "vouch" object. Followers who trust the daughter auto-follow.
  - Alternatively pre-signed rotation/backup key (recovery key). Grandma "never told to store a file outside the house" — so no seed phrase. Social recovery it is. Also could do: identity document with next-key hash commitment (KERI-style pre-rotation) — but if she loses her phone, she loses the pre-rotated key too unless stored elsewhere. So pre-rotation doesn't solve total device loss without external storage. Social vouching solves it.
  
  So: identity = Ed25519 public key ("the person is the key"). Identifier string: base64url(pubkey) or multibase-ish. I'll define `pk` = base64url(no padding) of 32-byte pubkey, identity id = "pk" string itself, maybe with a prefix like `k` or did-less. Keep simple: `id` = base64url(sha256(pubkey))? No — hash means rotation changes... pubkey itself is the id; rotation = new id + vouch chain. Actually wait: if identity = pubkey, key compromise requires rotation which changes identity. Alternative: identity = hash of an inception event (KERI) with a rotation log — but that requires a verifiable key event log hosted somewhere, more complexity, and total loss still fatal. Given non-goals allow re-meeting after total loss, I'll go bare pubkey + vouch-based key change. Key theft is worse: attacker has key, can sign as you. Contested departure scenario: hostile operator claims departure is forgery. Hmm — operator never has the key (floor 1). Contested departure = operator claims the signed "I've moved" manifest is forged. Resolution: the departure statement is signed by the same key that signed all prior content; readers verify the signature chain — the log is append-only signed with sequence numbers and hashes, so the move notice chains to prior content. The operator can't forge it. The operator can *withhold* it (serve frozen stale copy) — mitigated by the log being self-certifying and readers getting the new location from the author's new hub directly or from contacts. The move notice must also be posted at the new location; readers poll the old hub, get nothing new (or stale), and learn of the move via... how does mom's app follow with one tap? The author, from her device, sends signed move notices to her contacts' hubs (delivery) and/or the move notice is fetched from contacts. Since author has contact list on device, she can push signed redirect objects to each contact's hub inbox. Mom's app receives a signed "Alice has moved to newhub.example, same key" → one tap confirm. The old hub's frozen copy: any reader who has the move notice knows it's stale; also the log's head sequence means frozen copy is verifiably old if readers have newer. Also the author can stop... she can't force old hub to serve redirect. The "reads as stale rather than as her" is delivered by: content is only verifiably current as of signed head; reader compares heads among sources; and mom's app now points at new hub.

Log structure: signed append-only log (hash chain) of items. Each item signed; or sign a head checkpoint over merkle... keep simple: each entry contains prev hash, seq, timestamp (author-claimed), body ref. Hub stores entries; readers verify chain. Backdating: host can't backdate because chain + signatures; but author can backdate their own items (they're the author — fine, it's their journal). Host altering = signature failure.

Artifacts:
1. Identity doc / manifest: signed, contains pubkey (self), current hub URL(s), encryption (DH) pubkey signed by signing key, display name, seq/version, timestamp. This is the "card." Fetched at well-known URL.
2. Log: append-only entries, each signed, hash-chained. Entry types: post, reply, reaction, vouch, move, key-change.
3. Items/blobs: content addressed by hash.
4. Inbox/delivery: signed+encrypted envelopes POSTed to recipient hub.

Well-known URL: `https://hub.example/.well-known/…/<id>` or per-user path. For interop priority #3 (RSS/Atom/JSON Feed, fediverse/Bluesky without anything built): hub can render public posts as RSS/JSON Feed — that's hub-side rendering, no protocol change. "with nothing extra built" — bridge: ActivityPub needs WebFinger + signatures... A bridge is an extension; the brief says content reaching existing feed readers with nothing extra built. A hub (even dumb) can serve a feed.xml generated from the public log since the log format is fixed — a weekend hub can render RSS. JSON Feed trivially. Fediverse "through a bridge" is scenario 7 — bridge is allowed as existing-ish? "sees it on Mastodon through a bridge with nothing built" — meaning a generic RSS→AP bridge works because we emit RSS. Good: hub MUST serve public items as RSS 2.0 + JSON Feed at predictable paths. Then any existing bridge works.

First contact fetch: reader knows author's id (pubkey) and a hub hint (URL). Fetch `GET {hub}/p/{id}/card` → signed card (current hubs, enc key). Then `GET {hub}/p/{id}/log?since=N` → entries. Poll: same with since. Blob fetch: `GET {hub}/p/{id}/blob/{hash}`.

Encryption construction (assurance 2): 
- Audience: chosen people. Sender has each recipient's card → their X25519 enc pubkey (signed by their signing key).
- Content encryption: random 32-byte content key CK per item (or per post with multiple recipients). Body encrypted with AES-256-GCM under CK.
- Key delivery: for each recipient: ephemeral X25519 keypair; shared = X25519(eph, recip_enc_pub); wrap key = HKDF-SHA256(shared, info=recipient signing id || item hash); wrapped CK = AES-GCM(wrap key, CK) or XOR with KDF output (AES key wrap simpler: just GCM-encrypt CK). Header lists {eph_pub, wrapped_CK} per recipient.
- Hiding audience (non-goal says hide *who* an encrypted message is for — wait, non-goal: "Anonymity or traffic-analysis resistance beyond hiding who an encrypted message is for" — so hiding recipient identity IS a goal). So headers can't list recipient ids. Recipients trial-decrypt: each header slot is just {eph_pub, wrapped}; recipient tries each slot with their key (or use a 2-byte tag = truncated HMAC(wrap_key, "slot") to skip fast — but tag could correlate? tag is per-item random-ish, fine, doesn't reveal identity without the key). Number of slots reveals audience size — pad to fixed buckets? Mention as leak: hub learns audience size (pad to power of two optionally) and item timing/size. Also hub learns reply graphs via delivery endpoints.
- Sender includes themselves in slots so they can re-read.
- Reply encryption: same construction, audience = original audience (or subset). Thread id = hash of root item.
- Forward secrecy: not provided (static enc keys). Flag in cost sheet. Could do per-item signed ephemeral from author... recipient compromise reveals all. Acceptable; note it.

What hub learns: existence of items, sizes, timing, audience count (padded), who fetches what (unless private fetch via delivery). Delivery of private items: author POSTs encrypted envelope to recipient's hub inbox; envelope addressed how without revealing? Recipient hub must route to recipient's inbox — the recipient's hub knows it's for its user (that's fine, it's the recipient's hub). Cross-hub: a.example posts to family.example inbox: reveals sender hub + recipient id to family.example. Recipient id on their own hub is unavoidable-ish. The author's own hub learns nothing about private content if delivery goes author-device → recipient-hub directly (device does HTTPS POST). Good: private content need not transit author's hub at all. But replies referencing a private thread — readers fetch from... the private items live where? Options: private items are delivered to each audience member's hub (copies), each reader fetches their own copy from their own hub. That gives hub-independent access control: no ACL between hubs because the object is encrypted and self-contained; access control = possession of CK. That's how scenario 3 works with no access-control config: A creates encrypted item, delivers envelope copy to B's hub; B fetches from own hub, decrypts, replies, delivers back. Reactions same. 

Public items: plaintext body, signed, hub serves to anyone.

Floor 4: people on other hubs first-class — delivered by: identity independent of hub (pubkey), encrypted items portable (copy to recipient hub), public items fetchable cross-hub, cards list multiple hubs for redundancy. No hub-to-hub ACL agreements because access control is cryptographic.

Delivery protocol: POST {hub}/inbox with envelope {to: recipient id, from: sender id, payload: encrypted item or notice, signature}. Hub checks signature, stores, recipient polls their inbox. Notices: move notices, vouches, reply notifications.

Floor 3 (can't keep you): key + full copy on device. App keeps local replica of everything published (it authored it). Leaving: update card (new hub list), publish move notice, push to contacts, start serving/uploading to new hub. Old hub cooperation not needed. Failure mode: if device lost simultaneously... that's key loss scenario. If author didn't keep local copy and hub holds only copy — app MUST keep copy; spec requires it.

Floor 1: signatures everywhere; card self-signed; log entries signed; hash chain. Failure mode: hub serves different views to different readers (fork/split-view). Chain makes fork detectable when readers compare notes or when author audits. Hub can omit/withhold (censorship) — detectable (seq gaps) but not preventable; mitigated by leaving. Equivocation: signing two different heads — attributable fraud proof (two signed conflicting entries = proof of misbehavior... by author though; hub can't equivocate as author). Hub's fork of *its view*: hub can't create signed entries, only withhold. So split-view = showing different subsets; author audit + reader cross-checking (gossip heads with contacts) mitigates.

Scenario 2 grandma: app generates key, never shown. Picks name — name is local/petname? Global naming is a registry — out. Names are non-unique display names; contacts exchange ids via introductions (in person, QR, or via vouch). Grandma loses phone: new phone, new key, new card; daughter's app (a contact) receives vouch request: grandma calls daughter, daughter's app shows "someone claims to be your mother, verify by call," daughter confirms → daughter's app signs vouch linking old id → new id, and shares contact list? Grandma's new app needs her audience back: daughter (and other contacts) re-send... The vouch propagates: anyone who followed old id and trusts daughter's vouch (daughter was in grandma's family group; trust = daughter is in your contacts and she vouches) gets offered re-follow. Grandma's old content: lost with phone unless she had copies on... her hub holds her public content; private content copies live on audience hubs. Her new app can re-ingest public log from hub, and family can re-share private stuff. Identity continuity for her family = vouch chain. For strangers: re-meet (allowed). 

Also add: recovery could be strengthened by "recovery contacts" designated in advance — daughter holds a pre-authorized vouch capability? Simpler: vouch from any N contacts, reader policy decides. Keep vouch simple: signed statement {old_id, new_id, context}. Reader trusts if voucher is trusted contact of reader who knew old_id.

Scenario 4 domain goes: ids are keys — unchanged. Cards update hub URLs. Readers poll old hub → gone; fallback: readers got move notice before shutdown if lucky; else contacts propagate new cards via vouch/move gossip; also readers can query other known hubs from the card's hub list (card listed multiple hubs). Spec: cards SHOULD list ≥2 hubs; apps republish card + log to both. Reader tries all.

Scenario 5 big lazy hub: cost flat per identity — hub is dumb KV: store signed blobs, serve by id, no crypto. Log serving is range GETs. Fine.

Scenario 1 divorce walkthrough: as designed above. He can't post as her (no key), can't read family-only (encrypted to audience excluding... wait — he's "inside the family — entitled to see family-only content." Hmm! The scenario says "He cannot... read her family-only posts." But the adversary section says he's inside the audience and "No confidentiality mechanism defeats someone who is inside the audience." Resolution: he can read posts addressed to an audience including him (old family posts addressed to whole family incl. him). After divorce, she posts to family-minus-him — encryption audience excludes him; he holds the bytes, can't read. The floor says "content addressed to chosen people unreadable by anyone else." So: he reads what she addressed to him while married; new posts to a new audience exclude him. Also he can't retroactively... old posts he was audience to, he can still read (he has CK) — that's inherent; she can rotate audience keys? Our construction has no group keys — per-item CK. Old items remain readable to him. Fine, honest.
- Alter/backdate: chain + signatures prevent.
- Stop her leaving: can't; key+copy on device.
- After leaving: mom's app gets signed move notice (pushed to mom's hub inbox by daughter's app... by the author's app directly) → one tap. His frozen copy: he can keep serving her old public log, but readers who follow the card/move notice know new location; his copy stops at seq N while new head is N+k → "stale not her": also she can post a final signed "this hub is stale, I've moved" item which he may withhold — but withholding is visible; and any reader comparing notes sees it. Also he could keep serving forever and readers polling him see no new content; the move notice delivered out-of-band (inbox) fixes follows.

Contested departure (§5): he claims her move notice is forged. But it's signed by her key, chains into her log (move notice is a log entry with prev hash linking to entries readers already have). A forgery can't chain. If he claims her key was stolen and *his* frozen version is the real her — readers trust the key; whoever holds the key is her, protocol-wise. If he genuinely stole the key (device compromise): then theft handling — she vouches from a new key, contacts verify out-of-band, old key marked compromised; he can forge until readers accept the vouch. Named failure mode: key theft = identity theft until social re-key; protocol cannot distinguish. Honest.

Key change vs recovery:
- Rotation (planned): old key signs "succession" entry naming new key; new key co-signs (countersigns) proving possession — chain of continuity, id becomes... if id = pubkey, rotation changes id; to keep stable id across planned rotation, id should be the *inception* key hash and cards chain rotations? That's KERI-lite. Do I want it? Benefit: planned rotation keeps identity. Cost: log of key events, more spec. Given non-goal "continuity across total key loss" but rotation (theft suspicion, hygiene) is in scope (§5 asks rotation). Decision: identity = initial pubkey (inception id); current key established by signed rotation chain. Every card carries the rotation chain from inception key to current key. Id string = base64url(inception pubkey) — hmm, or hash of inception event. Simplest: id = base64url(sha-256 of inception pubkey + rotation index?) no. Keep: `id` = "p" + base64url(32-byte inception pubkey). Rotation entry signed by old key (and countersigned by new) extends chain. Total loss: chain breaks → new inception id + vouches from contacts linking old→new; readers treat as "same person, verified socially" (apps can merge display). This gives planned rotation continuity without external storage, and social recovery for loss. It's a bit more complex but §5 demands rotation/theft handling. I'll include it but mark "what I'd cut": rotation chain could be cut to bare "new key + vouch" model.

Actually simpler unified model: every key change is a "succession": if old key available → cryptographically signed (strong succession). If not → vouch-based (weak succession). Reader policy: strong successions auto-accepted; weak ones need M-of-your-contacts vouching or out-of-band confirm. Good.

Wire format: JSON, signatures over... canonicalization problem! No canonicalizer allowed. Solution: sign the exact bytes. Envelope pattern: {"sig":..., "payload":"<base64url of exact JSON bytes>"} — or detached: signature covers the byte concatenation of length-prefixed fields. Simplest weekend-friendly: an object is `{"body": <base64url bytes>, "sig": <base64url>}` where body bytes are themselves JSON. Signature = Ed25519 over body bytes exactly. No canonicalization ever; transport preserves bytes; JSON field order irrelevant since body is opaque bytes. Hash of item = SHA-256(body bytes). That's the "shape of the bytes" concreteness.

Timestamps: author-claimed unix seconds; hub could withhold; no trusted time — note it. Backdating by author possible; reply chains give partial ordering (reply references item hash → causal order).

Feed interop: hub renders public log to RSS2/Atom/JSON Feed. Reply context via link. Bridge to AP via existing RSS bridges (e.g., feed→AP bots). Replies back = extension (mention inbox parsing) — non-goal.

Now let me also handle "hub learns anyway": timing, sizes, item counts, audience size (slot count, optionally padded), social graph edges when delivery crosses hubs (sender id → recipient id envelope visible to both hubs; hide sender? envelope must be signed for spam control... sender could be revealed only to recipient: outer envelope {to, blob} where blob encrypted to recipient includes sender id + signature inside; hub sees only recipient id + timing. Spam: hub accepts anything for its users → mitigation: hub may require a "postage" = recipient-issued token? Keep simple: hub rate-limits; note it). Good: put sender identity inside the encrypted inner envelope. Outer: {to: recipient_id, body: encrypted-to-recipient, }. Inner signed by sender. Hub of recipient learns: someone sent something to user at time T, size S. Sender's hub learns nothing (device posts directly). That's decent metadata hygiene, state clearly.

Costs/honest sheet:
- No forward secrecy; static DH keys; key theft exposes all history addressed to you.
- Multi-device: needs key sync between devices — punting (vouch or device-link protocol = extension; or export). Flag.
- Hub can withhold/censor; detection via gaps & cross-check, no prevention.
- Reader-side trial decryption cost: O(slots) per item; tag optimization.
- No global names; discovery is social (introductions, vouches, QR, out-of-band links `web+proto:...`? a URL containing id+hub hint).
- Strangers and key loss: new identity; re-meet via bridge/mastodon etc.
- Storage duplication: private items copied to every audience member's hub (flat per identity, fine at family scale).
- Replies to public posts from fediverse don't come back without extension.
- Deniability: signatures are non-repudiable — everything you post is provably yours forever. Trade-off vs floor 1. Flag as least-sure choice.
- The "stale not her" guarantee is probabilistic-social: depends on readers receiving move notice.
- Grandma's private content recovery is best-effort.

Halving: cut rotation chain (keep vouch-only), cut multi-hub redundancy, cut padding, cut Atom (keep JSON Feed + RSS), cut vouch to single-contact.

Primitives assumed: Ed25519, X25519 (fallback: ECDH P-256 — X25519 preferred; if stdlib lacks it but has Ed25519... e.g., some stdlibs. State assumption explicitly), SHA-256, HMAC-SHA256 (HKDF built from it), AES-256-GCM (fallback: implement ChaCha20-Poly1305 in ~150 lines, mention), base64url, JSON. 

Let me also define fetch protocol concretely:
- Card: GET {hub}/p/{id}/card → signed body bytes {v, id, key: current signing pub, enc: enc pub, hubs: [...], name, seq, prev rotations}. 
- Log: GET {hub}/p/{id}/log?after={seq} → JSON array of entries (each {body, sig}), plus hubs may paginate.
- Blob: GET {hub}/p/{id}/b/{sha256b64}.
- Feed: GET {hub}/p/{id}/feed.xml, feed.json.
- Inbox: POST {hub}/inbox {to, env}.

Log entry types: post, reply, react, card (card updates are log entries? or separate seq), move, rotate, vouch, tombstone? Keep entry = {t:type, seq, prev, ts, ...type fields, ref:hash}.

Public post body includes content inline (small) or blob ref for photos. Photos: blob encrypted with same CK scheme for private.

Reactions: {t:react, ref, symbol} — emoji.

Reply threading: {t:post, in-reply-to: hash, root: hash}.

Now, "the host cannot keep you" — also need export: everything already on device; but also spec: reader apps cache; hub MUST allow full unauthenticated? No — full GET of own log is just the log endpoint. Fine.

One-tap follow for mom: move notice pushed to her hub inbox; app shows "Alice moved — follow?" tap → updates stored card, fetches from new hub. 

Length: they want ~4000 words. This will be long. Format: markdown headers, concrete JSON-ish byte shapes, mechanism-by-mechanism. Use code blocks for wire shapes. Should be thorough but I shouldn't bloat infinitely; aim for a well-structured ~4000-5000 word document.

Let me draft the structure:

# Title: name the protocol. Something like "Hearth" or "Ownlog"... pick a neutral name: "Foyer"? "Kin"? I'll call it **"Hearthmark"**? Simpler: "the protocol (working name: Kinship)" — I'll go with **Hearth**. Actually let me pick something descriptive: "Self-Signed Publishing (SSP)". I'll name it **"Solace"**? Keep it simple: working name **HEARTH**.

Sections:
0. Primitives assumed.
1. Architecture in one page (artifacts, signatures, fetch flows).
2. Identity primitive + rejected alternatives.
3. The four floor assurances, mechanism + failure mode.
4. Scenario walkthroughs 1–4 (mention 5,6,7 briefly).
5. Key change & recovery: rotation, loss, theft, contested departure.
6. Encryption construction in implementable detail + what hub learns.
7. Honest cost sheet.
8. What I'd cut.

Write it now, concrete and argued. Use base64url shapes. Keep code blocks tight.
```

</details>

