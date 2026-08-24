---
model: glm-5.3
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:58:25.680Z
prompt: PROMPT-pass1.md
prompt_sha256: ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d
reasoning_effort: high
finish_reason: stop
tokens: {"prompt_tokens":1634,"completion_tokens":19127,"total_tokens":20761,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":12918}}
wall_seconds: 295
truncated: false
reasoning_chars: 55364
---
# Hearth — a design for decentralized personal publishing under a hostile host

## 0. Position statement: what exists, and why I'm not just naming it

The nearest living relative of this design is **nostr**: keys are identity, relays are dumb stores, clients do all verification. I am not going to pretend otherwise — Hearth is nostr's philosophy on a diet, and the deltas are the whole point:

- nostr has **no key rotation**. Lose your phone, lose your identity. Scenario 2 (grandma) dies there.
- nostr's encryption (NIP-44 and friends) is bolted on, has no audience model, and doesn't carry threads. Scenario 3 (two hubs, one thread) dies there.
- nostr's NIP surface is sprawling; this brief demands something a second implementer finishes in a weekend.

ActivityPub is rejected because identity is `user@domain` and the instance holds authority — the divorce scenario is unwinnable by construction. ATProto is rejected because the DID/PLC directory is shared infrastructure the brief forbids, and repo sync is a week, not a weekend. Keybase proved the key-chain model but built it on centralized servers and is dead. Signal/WhatsApp aren't publishing and aren't portable. So: new design, honestly descended from nostr, with the missing organs grown.

**Primitives assumed.** SHA-256, HMAC, Ed25519, X25519, HKDF, one AEAD (AES-256-GCM or ChaCha20-Poly1305), base64url, compact JSON, HTTP/1.1. In Go, Java, .NET, and Node these are all standard library. In Python, Ed25519/X25519/AEAD are **not** — this is my largest dependency concession and I flag it in the cost sheet (§7). HKDF is 15 lines over HMAC if a language lacks it; the true hard requirement is Ed25519 + X25519 + one AEAD.

**The one deep architectural decision.** There are no hub-to-hub messages, no inbox, no federation, no delivery. Hubs are static file servers plus an authenticated upload endpoint. Every semantic — identity, threading, access control, freshness — lives in the client, expressed over self-certifying files. This single decision is what makes assurance 4 ("no access-control agreement between hubs") trivially true: hubs never need to agree about anything because hubs never talk.

---

## 1. The architecture in one page

### Artifacts

Every artifact is a file with the same envelope shape:

```
<compact single-line JSON document>
.
<base64url of Ed25519 signature over the document bytes>
```

The document is serialized compactly (no whitespace, one line). Because JSON escapes newlines inside strings, a line containing only `.` cannot occur inside a compact JSON document, so the terminator is unambiguous. **The signature is over the raw document bytes.** There is no JSON canonicalization anywhere in the protocol — files are content-addressed by `sha256` of the whole file and are copied byte-for-byte by mirrors and caches, so no one ever re-serializes anything. (Canonical JSON is the classic weekend-killer; this construction deletes it.)

Four artifact types exist:

1. **`id.json` — the identity chain head.** A short file: `{seq, prev, type, key, at, recovery, name}` (details in §2). The chain links backward via `prev = sha256(previous head file)`. A person's identity is the chain rooted at their genesis event.

2. **`feed.json` — the signed index.** `{v, author, latest_seq, items: [{seq, ts, id}...]}`, signed by the author's current key. `id` is the sha256 of an item file. Pagination is allowed (older pages are just more signed index files); for family scale one file is fine.

3. **Items.** `{v, seq, ts, author, type, target?, enc? | body}`. `type ∈ {post, reply, react, profile}`. Public items carry `body` inline; private items carry the `enc` structure of §6. Photos are content-addressed blobs listed in the body/decrypted body.

4. **Blobs.** Raw bytes (ciphertext for private posts), addressed by sha256.

An item **counts** — is admitted to a reader's view — only if referenced by a validly signed index. Standalone item files can be cached and verified, but admission requires the index. This closes the stale-key hole: a key stolen before rotation can't sneak items in, because the current key's index won't list them.

### What a reader fetches

**First contact** (given a location URL, from a link or QR):
1. `GET {base}/id.json` → verify the chain head's signature and walk `prev` links as far as the hub serves. Pin the genesis hash and current key (trust on first use).
2. `GET {base}/feed.json` → verify signature against the current chain key; record `latest_seq`.
3. Fetch listed items and blobs; verify each item's sha256 against its index entry and its signature against a key in the chain.

**Every poll:**
1. `GET id.json` (tiny). Unchanged, or a valid extension (rotation, move, profile change).
2. `GET feed.json`. If `latest_seq` is higher than stored, fetch the new items.
3. Optionally cross-poll the mirrors listed in `id.json` and compare — this is the only defense against a hub serving different views to different readers.

The hub's whole surface is `GET` on static bytes, one authenticated `PUT` for the author, and (optionally, for interop) generated RSS/Atom. That's the "dumb hub" of scenario 6.

---

## 2. The identity primitive

**A person is an Ed25519 keypair plus its signed event chain.** The genesis event is self-certifying: the first key signs a document introducing itself, listing initial device location(s) and optional recovery keys. The *name* of the person, to a computer, is the genesis hash; to a human, it's a display name plus wherever they're currently served; the mapping between them is the chain.

Why key-not-domain, argued against the alternatives:

- **`user@hub` (ActivityPub).** In the divorce, the operator owns the name. Assurance 3 is impossible: leaving means abandoning the identifier, and every social bond tied to it. Rejected outright.
- **DID + registry (ATProto's PLC).** Solves portability but the brief forbids shared infrastructure, and a directory is a chokepoint (and a weekend-killer to interact with). Hearth's chain *is* a poor man's DID document: it binds key history, locations, and recovery, with no resolver anywhere.
- **Bare key, no chain (nostr).** Simplest possible, and it fails grandma: key loss is death, theft is uncontestable. The chain is the minimal structure that adds rotation, recovery, and moves — roughly 40 lines of verification code — and it's the piece I'd refuse to cut.
- **Web of trust / global registry (Keybase).** Trust decisions get outsourced to third parties or infrastructure. This design insists trust decisions stay with the reader: your app decides, based on signatures and what you've pinned, whose chain extends.

One honest limitation, stated now because it recurs: **first contact is trust-on-first-use.** If your *first* encounter with "Alice" happens through Bob's hostile hub, Bob can present a fake Alice with Bob's key; the cryptography pins identities, it doesn't create them. Families mitigate this with the invite/QR flow (the invite link carries the genesis hash). Strangers accept TOFU, as they do with SSH today.

---

## 3. The four floor assurances

### 3.1 The host cannot speak for you

**Mechanism.** The signing key is generated on the author's device and never leaves it in the clear (recovery escrow, when used, is ciphertext or a key held by a chosen person — never the hub). Every item, every index, every chain event is Ed25519-signed. The hub serves files; it cannot produce one that verifies. The index-admission rule (§1) means even a stolen-and-rotated-away key can't inject content.

**Failure modes.** Key theft on the device (mitigated by rotation + recovery, §5). TOFU on first contact (above). And the interop bridges: RSS and ActivityPub renderings of public posts are *unsigned* to external readers — Mastodon will not check Alice's signature. That's accepted by the brief ("reaches existing feed readers… with nothing extra built"); the signed originals remain canonical for native readers.

### 3.2 The host cannot read what wasn't meant for it

**Mechanism.** Private items and their photos are end-to-end encrypted (§6). The hub stores and serves ciphertext to anyone who asks — which is precisely why no hub-to-hub access-control agreement is ever needed. Authorization is a property of keys, not of servers.

**The honest scoping.** The brief says it plainly and I repeat it: the hostile operator who is *inside the audience* reads family-only posts. What remains true: posts to circles that exclude him, DMs between other people, and any content addressed after a removal — all unreadable to him, forever, even from his own disks. He can store the ciphertext; he cannot retroactively acquire the item key.

**Failure modes.** No forward secrecy: an item key leaked later decrypts that item for whoever holds it. Metadata (§6 lists exactly what leaks). And deletion isn't prevented — only forgery and reading are; availability is a separate axis handled by mirrors and local archives.

### 3.3 The host cannot keep you

**Mechanism.** The author's app keeps a complete local archive — every item it ever published, plus ciphertext of everything it fetched — and the identity key. Export is copying a directory. Moving is: start publishing the same chain at a new base URL; the identity never referenced the old hub except as a *location hint* in the chain. `id.json` can list several locations at once, so a prudent author (or an app doing it by default) has an escape hatch configured *before* the divorce.

**Failure modes.** If the user's only device was provisioned by someone else's app (a relative set grandma up *on the relative's phone*), the custodian effectively holds the identity. The onboarding flow (§4, scenario 2) generates keys on the user's own device precisely to avoid this. The hostile hub retains its frozen copy — which reads as stale (below), but which he can serve to people who never learn of the move.

### 3.4 People on other hubs are first-class

**Mechanism.** There is no hub-to-hub anything. B's client polls A's feed directly across domains; hubs set `Access-Control-Allow-Origin: *` (safe — the content defends itself). Threading is a client-side join: a reply is an item in the *replier's* feed carrying `target = {author, id}`; A's app, polling B's feed, matches targets locally. Reactions are tiny items the same way. An encrypted reply copies the audience from inside the decrypted target (§6), so B never needs to know A's circle management.

**Failure modes.** You see replies only from feeds you poll. A stranger's reply to your public post is invisible unless a bridge surfaces it — this is the deliberate price of no global infrastructure, and for the stated audience it's the right price. Browser-based readers need the CORS header or a trivial proxy.

---

## 4. Scenario walk-throughs

### Scenario 1: the divorce

Alice's identity, archive, and DMs live on Bob's hub. Bob is technically capable and motivated.

- **Post as her:** impossible; he has no key, and her recovery contact is her sister, not him. Items he fabricates fail signature; items he replay-signs don't exist because he never had the key.
- **Read her family-only posts:** the ones addressed to circles including him, yes — that's the conceded ground. The ones excluding him, her DMs to her mother: ciphertext he can't open.
- **Alter or backdate:** any edit breaks the signature; any reordering breaks the signed index; any replay of an old index shows `latest_seq` and timestamps older than what her mother's app already holds — it renders as "stale, no updates since March," not as Alice going quiet *now*.
- **Stop her leaving:** she doesn't ask him. Her app holds the full archive and the key. She publishes her chain continuing at her new location (which she'd be wise to have pre-listed as a second `at` entry).
- **Mother's one tap:** Alice sends a link over any channel — SMS, a phone call reading it out, whatever: `https://new.example/alice/#<genesis>`. The mother's app fetches, verifies the chain back to the genesis it pinned years ago, sees seq continuity, and follows. Total protocol work: two GETs.
- **His frozen copy:** serves the old chain head and old index forever. To anyone who followed her out, it's a museum; to anyone who never left, it's visibly frozen in time.

### Scenario 2: grandma onboards

1. Daughter sends an invite link (contains her hub's URL and *her own* genesis, for pairing).
2. Grandma installs the app, taps the link, picks the display name "Nana." The app generates an Ed25519 keypair in the platform keystore. She is never shown a key, never asked to store a file.
3. The app asks: "Who can help if you lose your phone?" She taps "Daughter." Daughter's phone gets a pairing request; her public key goes into grandma's genesis event as `recovery`. This is the *only* key ceremony grandma experiences, and it's a button.
4. Publishing works; everything is automatic.
5. A year later the phone is in a lake. She calls her daughter. New phone, new app, tap the same invite link. The new device generates a fresh keypair. Daughter's app — holding her recovery key — signs a `rotate` event: {new grandma key, seq+1, prev}. Grandma's app publishes the extended chain to the hub. Mother and everyone else poll, see a `recovery`-signed rotation, accept it (family policy; see §5 for the trust semantics), and follow the new key. Grandma is back. She made two phone calls' worth of decisions, zero cryptographic ones.

### Scenario 3: two hubs, one thread

A on `a.example` writes a family-only post. Her app: generates `item_key`, encrypts the body (which contains the audience list), wraps `item_key` into seven envelopes via ephemeral X25519, signs the outer doc, PUTs the doc and the encrypted photo blobs to `a.example`, updates `feed.json`.

B on `family.example`: his app polls `https://a.example/a/` directly (cross-origin, ACAO header present), fetches the new item, tries each envelope with his private key, unwraps envelope #3, decrypts, and sees the audience list inside the plaintext. He replies: his app writes an item `{type: reply, target: {author: A_pub, id: sha256}}`, encrypts to the *same* audience copied from the decrypted target, publishes to `family.example`. Their cousin reacts: `{type: react, target: {...}, emoji: "❤️"}`, same treatment.

A's app polls B's feed and the cousin's feed (she follows family), decrypts the reply and reaction, matches `target` against her local item — the thread assembles on her screen. **No hub knew the other existed. No hub evaluated an access-control decision. Ever.**

### Scenario 4: the domain goes

`family.example` becomes unaffordable. Everyone's identity — their keys and chains — never mentioned the domain except as a current location. The family re-hosts: someone's $4 VPS, or a commercial hub; each person uploads their chain and archive (which every device still holds in full — the family collectively has N+ redundant copies of everything). Followers get new links through whatever channel they already use to talk to family, or through the pre-listed mirror locations in each chain. Nobody's identity changes; nobody re-keys; old signatures still verify because files moved byte-for-byte and content addressing doesn't care about URLs.

### Scenarios 5–7, briefly

**The big lazy hub.** Per-identity hub cost is flat: storage plus static GETs. No per-user crypto work (clients do it), no inbox processing (there are no federated messages), no key management. A hostile operator at scale can do exactly what the divorce Bob could: nothing to identity, nothing to excluded-content confidentiality, nothing to exit — plus degrade service and hoard metadata, both of which are stated, bounded failures.

**The weekend.** Publisher: write compact JSON, sign it, PUT it, update and sign the index — a few hundred lines. Reader: GET three kinds of files, verify two kinds of signatures, do the §6 unwrap. Dumb hub: a static file server with an authenticated PUT and an RSS generator. All three fit a weekend precisely because the protocol has one envelope format, one signing rule, and no server-side semantics.

**The stranger.** The hub renders public items to RSS/Atom and (optionally) an ActivityPub actor. Feed readers subscribe to the RSS; Mastodon follows the bridge. After key loss, the stranger's continuity is a declared non-goal: they re-meet the author as a new identity and re-follow. Native readers with pinned chains may or may not accept the recovery rotation — their choice.

---

## 5. Key change and recovery

**Voluntary rotation.** New keypair on device; chain event `{seq: n+1, prev: hash(head_n), type: "rotate", key: new_pub}` signed by the old key. Old signatures stay verifiable forever — items embed the full signing pubkey, and readers accept any key the chain ever certified (with the index-admission rule preventing a retired key from injecting new content).

**Loss without a recovery contact:** identity death. The chain cannot be extended; native followers see it end. This is deliberate — the alternative is a global registry or universal web of trust, both forbidden, both worse.

**Loss with a recovery contact:** the §4 walkthrough. The trust semantics deserve honesty: a `recovery`-signed rotation means "someone the old identity designated says this is still them." Readers' apps default to accepting rotations from recovery keys listed in the chain, and display a quiet provenance marker. In a family this is exactly the right amount of ceremony.

**Theft.** The attacker holds grandma's key. Grandma's daughter rotates via recovery. The attacker can *also* extend the chain, signing a rotation to an attacker-controlled key with the stolen key — and cryptographically, the attacker's branch looks *more* legitimate (signed by the identity key itself). Result: two chains from one genesis. **This is not cryptographically resolvable without a global ordering service, which the brief forbids, and I will not pretend otherwise.** The design's answer is that the fork is *visible* — apps show "identity contested, two live chains" — and resolution is social: grandma calls her family; they watch which chain her actual app publishes to. The recovery mechanism exists precisely so that the human who lost the key has a louder voice than the one who stole it. Flagged in §7 as the thing I'm least comfortable with.

**The contested departure.** Bob serves Alice's old chain and tells her mother "that 'move' you saw is a forgery; her key was stolen." The signature proves the *key* signed the move; it cannot prove the key still means Alice. Three facts blunt Bob: (1) he can produce no valid chain extension himself — the accusation is all he has; (2) Alice's chain listed a second location and a recovery contact from day one, and a move countersigned by the recovery key is a two-key attestation; (3) the mother has an out-of-band channel to Alice, and the one-tap refollow only requires that she use it once. Trust is decided by the reader, with the evidence on the table. That is the most any signature-based system honestly offers.

**A design I rejected here: per-device keys.** Chain event types `add-device`/`rm-device`, with items signed by device keys authorized by the identity key (kept escrowed/offline), would make theft cleanly revocable and multi-device natural, at the cost of one more artifact layer and one more verification rule. I cut it for v1 because grandma's recovery path already works without it and the brief ranks minimalism second. It is the first revision I'd make, and I flag my uncertainty: this cut is defensible for families and wrong for, say, journalists.

---

## 6. The encryption construction

One construction, used for circles, replies-in-circles, and DMs alike. Notation: `X25519(eph_priv, recip_pub)`; `HKDF-SHA256(ikm, salt, info, L)`; `AEAD_K(nonce, plaintext)` = AES-256-GCM or ChaCha20-Poly1305.

**Sender, composing a private item:**

1. Build the plaintext document (compact JSON):
   `P = {"body": "...", "aud": ["<b64 pubkey>", ...], "photos": [{"j": 0, "mime": "image/jpeg"}], ...}`
   `aud` is the full audience — recipient public keys — *inside* the ciphertext. Insiders see the insider list; outsiders see nothing. Replies copy `aud` from the decrypted target.
2. `item_key = random(32)`; `n = random(12)`.
3. `ct = AEAD_itemkey(n, P)`. (The outer Ed25519 signature over the whole doc already binds `ct` to author/seq/timestamp, so the AEAD needs no additional associated data.)
4. Photo blobs: `blob_key_j = HKDF(item_key, salt=n, info="blob:"+j)`; each blob encrypted under its own key, addressed by hash of ciphertext.
5. `eph = X25519 keygen()`. For each recipient public key `R_i`:
   - `Z_i = X25519(eph_priv, R_i)`
   - `okm = HKDF(Z_i, salt = SHA256(eph_pub || "hearth-wrap"), info = "wrap", L = 44)`
   - `(wk, wn) = (okm[0:32], okm[32:44])`
   - `to[i] = {"c": AEAD_wk(wn, item_key)}` — **no recipient identifier in the envelope.**
6. Outer doc:

```json
{"v":1,"seq":47,"ts":"2026-05-04T18:03:11Z","author":"b64(ed25519 pubkey)","type":"post",
 "enc":{"epk":"b64","n":"b64","to":[{"c":"b64"}, ...],"ct":"b64"}}
```

signed per the §1 envelope. Note the signature covers the ciphertext and the envelope list: the hub cannot strip a recipient's envelope or swap ciphertexts without detection.

**Recipient:** for each entry in `to`, in order: derive `(wk, wn)` from `X25519(my_priv, epk)`, attempt unwrap (AEAD tag tells you), stop on success. Then decrypt `ct` with `item_key`.

**What is encrypted:** body, audience list, photo references, any mentions. **What is public:** existence, seq, timestamp, type, ciphertext size, blob sizes, and the *number* of envelopes — the audience's cardinality, not its membership. **What the hub learns anyway:** all of the above, plus fetch timing and source IPs. Because readers fetch whole feeds rather than cherry-picking items, the hub's fetch log reveals "someone polled Alice's feed," not "someone wanted item 47" — a structural hiding of *interest*, worth the bandwidth at family scale. Who a *DM* is for is hidden in the same way: one envelope, no key inside it, and the hub's log shows only that the feed was polled.

**Costs, stated:** N recipients ⇒ N ECDH operations and N×(32+16+12) bytes per item, and a recipient unwraps by trial, averaging N/2 ECDHs. Fine for tens; wrong for thousands — this construction is explicitly sized for families, per the brief. **No forward secrecy**: compromise of a recipient key later decrypts everything it was ever wrapped into. A ratcheted group construction (Sender Keys, MLS) would buy PCS at the cost of the entire weekend-implementability budget; rejected, not regretted, but named.

---

## 7. The honest cost sheet

**What it's bad at:**

- **Contested key forks** (§5) resolve socially, not cryptographically. Anyone telling you otherwise is selling a blockchain.
- **No forward secrecy.** Hostile-insider-adjacent readers keep their copies and their keys.
- **Split-view serving.** A hub can show reader A a different (validly signed, stale) view than reader B. Detection requires mirror cross-polling or gossip between readers — which the protocol makes *possible* (everything is verifiable standalone) but does not orchestrate.
- **Metadata leakage:** sizes, cadence, audience cardinality, IPs. Encrypted photos still have encrypted-photo sizes.
- **Reply visibility is bounded by who you poll.** No global thread. No search. Finding anyone is social. For the stated audience, correct; for the public web, a real gap.
- **Availability is only defended, never guaranteed.** Deletion by a hostile hub is detectable (seq gaps, stale indices) and recoverable (mirrors, every reader's local archive) but not preventable.
- **No spam or abuse story at the hub.** Deliberately: moderation is reader-side (you choose whose chain to extend into your view). A big commercial hub curating its *own* rendered views is welcome to; it can't curate anyone's verification.

**Where it's more complex than it looks:**

- The identity chain's edge cases (forks, recovery policy, what apps do on `recovery`-signed rotations) carry more social weight than their byte count suggests.
- Multi-device, even without device keys, means exporting/syncing the identity key between your own gadgets — QR-to-QR, fine, but someone must specify it and I mostly hand-waved it above.
- The "readers fetch whole feeds" simplification quietly caps comfortable feed sizes in the tens of thousands of items; pagination exists but complicates the staleness story slightly (each page is separately signed; gaps between pages are detectable; this is fine but must be written carefully).

**Choices I'm least sure of:**

1. **Single identity key vs. device keys** (§5) — I chose minimalism; I'd revisit within a year.
2. **The dependency concession.** "Standard library only" is true in Go/Java/.NET/Node and false in Python and C, where Ed25519+X25519+AEAD mean a third-party package or a heroic from-scratch implementation. One could specify an HMAC-SHA-256-only fallback suite (HKDF-CTR stream + HMAC tag, ~40 lines) and I considered making it normative; I didn't, because two cipher suites are an interop tax forever. If the audience for this is Python hobbyists, I'm wrong.
3. **Recipient-hiding envelopes (trial decryption).** Hiding *whom* a DM is for cost real complexity; the brief asked for it, but I'd want deployment evidence that the cardinality-only leak is worth it versus simply listing recipient key ids.
4. **Whole-index signing** assumes feeds stay modest. It will embarrass me at ~50k items per person; the brief says not to care, but pagination is where I'd look first under load.

---

## 8. If forced to halve the specification

Cut, in order: the ActivityPub bridge (keep bare RSS — strangers still get scenario 7's feed-reader half); reactions (replies alone carry a thread); mirror support (keep multiple `at` locations, drop cross-polling guidance); photo encryption (photos public-only in v1 — a visible wound, but the floor's assurance 2 survives via text); feed pagination.

What remains is the irreducible core, and I'd defend it to the last line: **the envelope format with signatures over raw bytes, the identity chain with recovery, the signed index, one encryption construction with audience-in-plaintext, and hubs that are nothing but static file servers.** That five-piece core is what delivers all four floor assurances; everything else in this document is polish on it.

<details><summary>Model reasoning trace (55364 chars) — kept because rejected alternatives often live here</summary>

```
This is a rich design brief. I need to produce a full protocol design document. Let me think from first principles.

Core problem: hostile hub operator who is inside the family audience. The four assurances:

1. Host cannot speak for you → content signed by a device-held key (Ed25519), verification keys anchored in identity.
2. Host cannot read what wasn't meant for it → E2E encryption for private content. But the hub operator may be a *recipient* (inside the audience). The brief says "No confidentiality mechanism defeats someone who is inside the audience. The question is what remains true anyway." So family-only content encrypted to the family's keys; the hostile operator, if a family member, can read family-only posts addressed to him — but not posts where he's excluded, not DMs to others, etc. Actually re-read: "entitled to see family-only content" — so the design must accept that; what remains: he can't alter, can't forge, can't backdate, can't hold her hostage.
3. Host cannot keep you → device holds keys and full local copy; identity not bound to hub's domain.
4. Cross-hub first-class → identity must be key-based, not domain-based; discovery via signed manifests / keys; content addressed by signatures not URLs.

Identity primitive: a keypair (Ed25519) is the person. Person = public key + a self-signed "profile document" (name, etc.). But discoverability: how do readers find the person after domain change? Scenario 4: domain goes, everyone moves, identity unchanged, existing readers find them. That requires either (a) clients poll old hubs which serve a signed "moved" pointer (but hostile hub won't serve it / will strip it — actually the moved statement is signed so hub can't forge it, but hub can *refuse* to serve it — censorship), or (b) some out-of-band social discovery — mother's app follows with one tap: she gets a link from her daughter. That's fine: bootstrap by exchanging identity (key) via any channel — QR code, message, the works. So no global registry. Readers keep a local address book of (key → last-known hub URL(s)). The signed profile/manifest includes "currently served at" URLs, signed by identity key, so a hub can't redirect someone to a wrong hub... well it could serve a stale manifest. Freshness: timestamps + sequence numbers + revocation? Contested departure (§5): hostile operator claims the woman's "I've moved" statement is a forgery. Mechanism: key rotation with designated recovery, or... The core defense: the departure statement is signed by her current key. The operator claims she lost the key and someone else has it? The counter is: her mother's app, upon receiving the new location out-of-band (one tap), verifies the signature chain. The operator's claim of forgery only matters to people who only ever hear from him. Fundamentally: trust decisions belong to the reader, not the hub. Readers can subscribe to both and compare sequence numbers; signed sequence numbers make rollback visible if any copy reaches the reader.

Freshness/backdating (scenario 1: "alter or backdate"): signed timestamps are weak (lying about clock). Better: a signed, monotonically increasing sequence number per feed ("epoch"), plus the reader keeps the highest seen. A hostile hub serving a frozen old copy reads as stale — reader sees seq 40 frozen while... hmm, reader can't tell stale from quiet unless timestamps. But scenario says "his frozen copy of her old content reads as stale rather than as her" — i.e., readers who followed her to the new hub know seq continues there; his copy stalls at seq N. Also include signed timestamps inside each item; readers can flag "last update 3 years ago." Good enough.

Grandma onboarding (scenario 2): never shown a key, loses phone, recovers by calling daughter. So: social recovery — Shamir? No third-party libs allowed but Shamir is implementable by hand... but "easy to implement" — simple XOR secret-sharing is easy (k-of-n? XOR gives n-of-n). Simpler: recovery is a designated recovery key held by chosen contacts (daughter holds grandma's recovery key, or a recovery keypair whose public key is in grandma's profile, signed by identity key; daughter's app can co-sign a rotation). Design: profile document contains identity key + optional recovery public key. Rotation statement: new identity key, signed by old identity key OR by recovery key + a waiting period? Contested rotation: hostile hub can't rotate her key (doesn't have it). Hostile operator can't claim departure is forgery if reader trusts the signature.

But wait: key rotation and "host cannot speak for you" — if the hub can never rotate her key, and she loses her phone without recovery contacts... She needs at least one recovery contact. Grandma's daughter is the recovery contact. Also the key lives on device; app backs up encrypted? "never told to store a file outside the house" — the app can do automatic encrypted backup to her own hub (encrypted with a key derived from... something). Hmm, careful: backing up the identity key to the hub defeats assurance 1 if hub can decrypt it. Back it up encrypted to the recovery contact(s), or encrypted under a passphrase. Simplest honest design: device key + recovery contact(s); optionally encrypted key escrow to hub under user passphrase (hub sees ciphertext only). For grandma, passphrase is bad; recovery contact is the answer.

Key rotation mechanism: a "key event" in an append-only signed log (identity ledger, like a mini SIGMA/Keybase-ish sequence but local, no global). Each person has an identity chain: genesis (first key), then signed statements {seq, prev_hash, statement, key}. Readers verify chain from genesis. Genesis key is the true name. Hmm but scenario 7: stranger re-meets author after total key loss. Non-goal: "Continuity of a stranger's view of you across total key loss." So strangers just re-meet as new identity, fine.

Domain moves: the identity chain includes current locations (hub URLs). Readers who poll the old hub get either nothing (hub dead) or a stale location; re-finding is social (one tap) or via bridge/profile pages that republish. Actually the manifest at old hub might serve signed "moved to" — hub will cooperate if merely lazy/hostile-at-departure? Hostile hub won't serve move notice. So social re-find, plus hub multiplicity: profile lists multiple mirrors (mother's box mirrors daughter's feed — signed, so anyone can mirror). Mirrors: anyone can mirror your signed feed; that's a nice property — signed content makes storage fungible. The manifest lists known mirrors signed by author; mirrors can be polled.

Cross-hub threads (scenario 3): A on a.example posts family-only content encrypted to a set of recipient public keys. How does B on family.example get the key? The encryption construction: per-item, generate random symmetric key; encrypt content (AES-GCM — stdlib in most languages? Python has no AES in stdlib! Hmm. "any primitive your target language's standard library actually provides" — illustrations include Ed25519, SHA-256. Python stdlib: hashlib (SHA-256), hmac, no Ed25519, no AES. But they said illustrations, not closed list; assume target languages provide Ed25519 and AEAD (Go stdlib has both: crypto/ed25519, crypto/aes, crypto/cipher; Java has both; Rust stdlib has neither...). I'll state assumptions: Ed25519, X25519, HKDF, SHA-256, AES-GCM or ChaCha20-Poly1305 — noting that in Go/Java/.NET these are stdlib; for languages lacking them, allow one of a small fixed set. Also: could do encryption with only SHA-256 + HMAC? You could build a stream cipher from HKDF and Encrypt-then-MAC with HMAC... X25519 can be built from... no, implementing X25519 from scratch is a weekend-killer. Alternative: use the *signing* keys for key agreement? Ed25519 keys → convert to X25519 (bip-ish conversion, doable but fiddly, ~20 lines and a pain to verify). Honest choice: declare assumption set: Ed25519 + X25519 + HKDF-SHA256 + ChaCha20-Poly1305 or AES-GCM. Go, Java, .NET, Node (crypto module is stdlib-ish). I'll flag this tension explicitly.

Recipients addressed without publishing the audience: per-recipient "envelope" — Ephemeral-static ECDH: item key wrapped for each recipient: (recipient_pubkey_ephemeral? no) — sender generates ephemeral X25519 keypair, for each recipient does X25519(eph_priv, recip_pub) → HKDF → AEAD-encrypt the item key. Envelope = (ephemeral_pub, AEAD(tag), recipient?). To hide *which* recipient: don't include recipient public key in envelope; each reader tries all envelopes with their private key — try-decrypt on each of N envelopes. That's the Signal-ish "sender keys" / Sealed-sender style. Reveals audience *size*, hides membership. Hub learns: item exists, size (number of envelopes), timestamps, sizes, who fetches which items (if hub serves them, it sees fetch patterns — but readers usually fetch via their own hub proxy? Design decision: readers fetch encrypted items and store locally; the hub serving the author's content sees IP of fetcher unless proxied. Non-goal: traffic analysis beyond hiding who a message is for. Note: hiding recipient identity inside the item is doable (no pubkeys in envelopes), but fetch logs reveal it — mention in cost sheet; mitigation: fetch whole feed, or fetch via a friend's hub proxy. Actually simplest: fetch the full feed listing + all encrypted items? For families that's fine. I'll specify: readers fetch the whole feed (small scale), so hub sees only "someone fetched the feed," not which items. Nice and simple and honest about cost: bandwidth O(feed).

Wait — but family-only posts: who can even list them? If the encrypted items are served publicly on the hub (fetchable by anyone), the hub lists ciphertext. Random stranger can fetch ciphertext, can't decrypt. That's fine — and it's what makes "no access-control agreement between hubs" work: authorization is cryptographic, not ACL-based. The hub serves ciphertext to anyone; only keyholders read. That's the elegant core: **the hub is a dumb, untrusted blob store; all access control is end-to-end keys**. This delivers assurance 4 with zero hub coordination.

What about replies and reactions crossing hubs (scenario 3)? A reply is a post by B that references A's item by (A's key id + item hash). B's reply, if family-only, is encrypted to the family key set. Family "audience" management: how does B know whom to encrypt to? Circles/audiences: each person publishes (signed, public) an address-book-ish "circle" listing: member public keys, possibly with display names. A's app, when composing family-only, encrypts to all keys in her "family" circle... but she must know B's key — she does, she follows B. Circles are local per-author, but members can discover each other via the ciphertext... no. For a reply to reach A and the rest of family, B encrypts to keys B knows. Simplest: B encrypts to the union of the reply-target's circle? But circles are private? If circle membership is hidden, B can't know it. Options: (a) circles are public (signed roster of public keys) — hides nothing about membership but that's OK? The brief: "recipients addressed without publishing the audience" — that's about individual items. Hmm, if circle rosters are public, audience is published transitively. Alternative: B encrypts reply to the same set of envelopes... B can't know A's item audience because it's hidden. Resolve: replies in an encrypted thread form a chain; each reply author encrypts to their own "family" circle (locally defined). Members overlap enough in families. Or: (b) each encrypted item, when decrypted, contains the item's audience key list (inside the plaintext!) — recipients learn who else can read, and can reply to that same audience. That's elegant: audience membership is hidden from hub/non-recipients but visible to recipients (who are inside the audience anyway — consistent with "no confidentiality against insiders"). So plaintext includes "audience: [keyids...]" and reply copies it (or extends). Good. Circle management: the app keeps a contact list; first item to a new circle enumerates keys; thereafter the audience travels inside the plaintext. Adding members later: new items can extend audience; old items stay as-is. Key rotation of a member: address by current key; re-keying old content = re-encryption, optional, out of scope.

Feeds and artifacts. Let me lay out:

Artifacts per person:
- **Identity chain** (identity.json): array of signed key events: [{seq, prev, ts, location(s), pubkey, recovery_pubkeys?, name/avatar?}] each signed by the then-current identity key. The final entry's pubkey is the person. The chain's genesis hash is one form of the person's "true name," but for humans we present name + hub URL and the app pins the key on first contact (TOFU) — like SSH. Actually simpler presentation: the person = current public key; the chain gives history. For following: user enters URL (or scans QR) → app fetches profile, pins key.
- **Profile document**: signed by identity key: display name, bio, avatar URL, current feed location(s), mirrors. Could be folded into chain head. Fold it: chain head IS the profile. Fewer artifacts = more minimal. But chain should be append-only for rotation; profile fields (avatar, bio) change often → separate signed "profile.json" with seq number, signed by current key, referenced... Let me keep two: identity.json (rarely changes; key events, locations) and feed.json (the post log). Profile metadata (name, bio, avatar) can be an entry type in the feed? Feed entries: posts. Profile changes as feed items of type "profile"? That bloats. Keep three artifacts but simple:
  1. `identity.json` — the key chain + current locations. (signed by chain keys)
  2. `feed.json` — ordered list of item refs: [{seq, ts, id(hash), type, url}] with each entry signed by identity key, plus a final "feed head" signature. Or per-item signatures and the feed is just a signed index. Design: feed.json = {author_keyid, latest_seq, items:[{seq, ts, id, sig}...] } signed as a whole by current identity key. Simpler: one signature over the whole index. Items individually signed too (so mirrors and caches can serve items independently and stay verifiable). Why item sigs if index is signed? Because items are fetched separately and should verify standalone; also enables partial sync. Keep both but note index sig alone would suffice if items are always fetched with... no—items are content-addressed by hash, so integrity comes free; authenticity (authorship) needs signature on the item bytes. So: item = canonical JSON {seq, ts, author_keyid, type, body...} + sig. Index lists ids/hashes. Good.
  3. Items: `item-<seq>.json` — signed envelope: public header (seq, ts, author keyid, type, and if encrypted: `enc` header with array of envelopes + nonce) — the signature covers the header and ciphertext. So even encrypted items are unforgeable/unbackdatable by the host: signature covers seq and ts. Wait, backdating: author sets ts at creation; host can't change ts without breaking sig. Host can serve old items as if new? It can't change seq either. Reader sees seq <= max_seen → stale. Good.
  4. Blobs (photos): content-addressed (sha256), listed in item body, each encrypted for private posts (encrypt then hash? hash of ciphertext).

- Well-known URL: `https://hub.example/<user>/id.json` etc. But identity not domain-bound: the URL is just a *location hint*; the person is the key. Discovery flow on first contact: fetch from any location, pin key (TOFU + out-of-band verification optional via QR showing key fingerprint). Poll flow: fetch identity.json (check for rotation/move), fetch feed.json (compare seq), fetch new items.

Interop (priority 3): the hub serves plain `feed.xml`/`rss`/`json` translations of the *public* items for feed readers, and hub can implement WebFinger+ActivityPub bridge mapping @user@hub → public posts. Signed items give the bridge integrity-ish, though Mastodon won't verify sigs. That's fine: "reaches... with nothing extra built" — the hub exposes public items as RSS. Note: the bridge content isn't signature-verified by Mastodon — acceptable; the signed originals remain canonical. Scenario 7: stranger follows public journal in feed reader, sees on Mastodon via bridge. After key loss, "they re-meet the author" — meaning stranger's continuity is a non-goal; they just re-follow. Fine.

Assurance 1 mechanism details: key never on hub (except as encrypted backup, optional, under user-chosen passphrase — ciphertext-only host). Actually maybe skip hub escrow entirely; recovery via contacts. Grandma scenario: recovery contact = daughter. Mechanism: identity chain entry can include `recovery: [keyids]`. Rotation via recovery key requires... a signed statement by recovery key. But then recovery key holder can rotate identity key → daughter can impersonate grandma after theft! Mitigation: two-party: rotation statement signed by recovery key is marked "provisional" and requires... hmm. Options:
- Recovery rotation creates a NEW identity (chain fork) that followers who trust the recovery contact accept. Trust decision at reader. For family, that's fine: daughter is trusted by the family; the hostile ex is not a declared recovery contact.
- Theft: attacker has device key. Owner rotates via recovery key → chain shows both branches; readers pick... messy. Keep it simple and honest: rotation by old key (normal); rotation by recovery key (emergency, marked `via: recovery`, readers MAY warn). Contested departure (§5): ex claims her "moved" statement is forgery. Her moved statement is signed by her current key on her chain with seq > anything the ex's copy has. The ex cannot produce a valid chain with higher seq signed by her key (he doesn't have it) — unless he claims key theft. If he claims "she lost her key, someone stole it": readers decide; her social recovery statement + out-of-band contact (mother talks to daughter... she IS the daughter—wait, mother follows *her*, the woman). One-tap refollow: mother receives (via any channel) the woman's new location or identity chain; app verifies: same genesis, seq continuity, signed by current key, and the current key matches what mother's app had pinned (no rotation needed if only the hub changed — the common case: move ≠ key change). Right! Moving hubs requires NO key event if location is separate... but readers learn new location how? Not from hostile hub. Out-of-band one tap (share link). The link contains new location + key fingerprint. Also mirrors: she can pre-configure multiple locations (her friend's hub) in her identity chain *before* the divorce. Good defensive practice: list ≥2 locations. Nice point.

Assurance 3: device always has full copy: app syncs/pins all items (including encrypted ones it can't read? It can read ones addressed to her; others she just caches headers or full ciphertext — cheap for family scale; cache everything). Export = copy directory. Key in app's platform keystore + escrow options.

Assurance 4 details: cross-hub reply: B's hub serves B's signed feed; A's reader follows B's feed from family.example directly (client fetches cross-domain — is that CORS issue? Browsers: yes. This design presumes native apps / server-side readers, not browser JS readers. Flag it: web-based readers need a proxy — any hub can proxy because content is public ciphertext. CORS: hub SHOULD set Access-Control-Allow-Origin: * since content is self-protecting. Fine.)

Reaction: a small signed item {type: reaction, target: author_keyid+item_hash, emoji}. Delivered how? Does A ever see B's reaction? B's reaction appears in B's feed; A's app, knowing A's item, searches... how does A's app find replies? Thread assembly: reverse: A's app polls the feeds of everyone she follows (she follows family). B's reply is in B's feed; B's reply references A's item hash; A's app correlates locally. That's how ATProto-ish "reply glob" or how nostr works (pull-based, client-side threading). This avoids any hub-to-hub delivery protocol entirely! No federation messages, no inbox, no webmentions. Everything is published feeds; threading is client-side join on (target_keyid, item_hash). Beautifully minimal. Cost: you only see replies from people whose feeds you poll → strangers' replies invisible unless bridged; fine for families. Mention as cost. Reaction aggregation: client-side.

Big lazy hub (scenario 5): per-identity cost flat: hub stores blobs, serves static files; no per-user crypto work (client does E2E); no inbox processing (no federation pushes); billing per storage. Hostile at scale: can't forge (sigs), can't read (E2E), can't lock in (device copies + identity portability). Can censor individual items (serve 404) — but readers notice holes? Seq gaps visible in feed.json... but hub controls feed.json too — serves stale/edited feed.json? Edited index breaks sig → readers detect. Serve valid old index → stale (seq frozen). Serve index with gaps → gaps visible (items have seqs; missing seqs detectable). Censorship is detectable but not preventable; mirrors mitigate. Also hub can serve different content to different readers (split-view attack): reader A sees seq 41, reader B sees seq 40. Detectable only via cross-checking with mirrors or other readers. Honest cost sheet item. Mitigation: list mirrors; cross-poll.

Freshness of "stale" (scenario 1): mother's app follows woman at new location; new feed has seq 47; ex's hub serves seq ≤ 45 with old location in identity.json. Mother's app sees author's key pinned → identity.json at ex's hub signed but old seq → chain seq lower than known → stale. And if mother never learned of the move? Then she sees frozen feed — "reads as stale rather than as her": timestamps old, seq frozen; app can flag "no updates since date." Acceptable.

Now the four assurance mechanisms, failure modes:

1. Cannot speak for you: Ed25519 sigs over items/chain; key generated on device; hub never sees private key; recovery escrow ciphertext-only (if any). Failure mode: key theft on device; TOFU on first contact (first fetch from hostile hub could serve entirely fake person+key — but then you never met the real person; mitigated by out-of-band fingerprint exchange for family). Also bridge content (RSS) isn't sig-checked by external readers — outside the floor.

2. Cannot read: X25519 ephemeral-static per-recipient envelope wrapping item key; AEAD (ChaCha20-Poly1305 or AES-GCM). Failure modes: insider recipients (accepted by brief); hub sees metadata: item count, sizes, envelope counts, fetch times/IPs, public header (ts, type, seq). Also compaction: forward secrecy? None — ciphertext at rest; if a key leaks later, old family items decrypt. Mention: no post-compromise security; could add periodic ratchet... cut for minimalism. Also the hub can *delete* (availability not confidentiality).

3. Cannot keep you: local full archive + key on device; identity = key not account; multiple locations; mirrors; export. Failure: user never ran the app on a device they control? (grandma on a hub her daughter set up—phone is hers though). If grandma's identity key was generated by daughter's app on daughter's phone → daughter is effectively grandma's key custodian. Acceptable in-family trust, flag it. Also: hub can refuse deletion of its copy (stale copy persists, reads as stale).

4. Cross-hub first-class: no inter-hub protocol; readers fetch cross-origin; crypto ACLs; client-side threading. Failure: replies from people you don't poll; browser CORS (mitigate with ACAO header); "one thread" only within your followed set.

Key change & recovery (§5 required):
- Rotation (voluntary): chain append {seq+1, new_pub, ts} signed by old key. Devices update on poll. Old sigs remain verifiable via chain (readers keep chain, look up key by seq range... simpler: items signed by whichever key was current; readers verify item sig against any key in chain (try each — chains are short). Or items reference keyid = hash of pubkey; chain maps keyids. Use keyids = first 8 bytes of sha256(pubkey)? Fine, or full pubkey embedded — items embed full pubkey (32 bytes, cheap, simpler than keyid indirection). Embed full pubkey, verify against chain membership. Simple.
- Loss (grandma): recovery contact path. Grandma's chain head lists recovery_pub (daughter's key). Daughter signs rotation statement {new grandma key, ts} with her key. Readers see `via: recovery` and accept (family trusts daughter) — trust decision is reader's; apps default to accepting recovery rotations from keys already in chain, MAY prompt. Grandma's new device generates fresh key, shows QR to daughter, daughter's app signs the rotation, grandma's app publishes new chain head to her hub... wait, hostile hub? Not hostile in this scenario — her hub is fine (maybe daughter runs it). If the hub is hostile AND key lost: hostile hub serves old chain; grandma republishes chain at a new location; recovery rotation signed by daughter; followers accept if they trust daughter. Fine.
- Theft: attacker has grandma's key; grandma uses recovery to rotate; chain forks: attacker (with old key) could rotate to attacker-key-2 signed by old key, competing with daughter-signed rotation. Readers see two chains from same genesis; choose by policy (prefer recovery-signed? but attacker-signed-by-old-key looks more legitimate!). Honest answer: race, social resolution — grandma calls her contacts; apps show "contested" state. This is genuinely hard without a global ledger; the brief explicitly forbids one. Flag it in cost sheet. Mitigation: the recovery rotation statement is signed by BOTH recovery key and... nothing helps cryptographically. It's a human-layer tiebreak. Say so.
- Contested departure: covered above — signature + seq + out-of-band refollow; the operator's "forgery" claim is a claim of key theft; contested-key UI state.

Encryption construction detail (§6): show byte shapes.

Item (public):
```
{
 "v":1, "type":"post", "seq":47, "ts":"2026-...", 
 "author":"b64(ed25519 pubkey)",
 "body": {...}, 
 "sig":"b64(ed25519 over sha256? or over canonical bytes)"
}
```
Canonicalization without a JSON canonicalizer lib: don't canonicalize JSON — sign a *separate byte string*: define the signed payload as explicit field concatenation? Simpler: sig covers a canonical form defined as: the JSON object serialized with sorted keys, no whitespace — but "no JSON canonicalizer" dependency means implementers must hand-roll; a weekend implementer can sort keys recursively in 20 lines. Alternative that dodges canonicalization: sign the exact bytes served, and include nothing nested? I.e., hub serves item bytes; sig is over those bytes minus sig field. Problem: re-serialization by mirrors changes bytes. Mirrors serve byte-identical files (content-addressed by hash!). Items are addressed by sha256 of the file bytes; mirrors copy files verbatim. Then signature covers the file bytes with the sig field zeroed/omitted: define: sig = ed25519(priv, sha256(json_without_sig_field_serialized...)) — still needs deterministic serialization. Cleanest minimal rule: **the file bytes are the canonical form. Sign sha256 of the file bytes with the "sig" field removed, where removal means: the file is generated as exactly `BODY || SIG` — two files?** Alternative widely-used trick: put signature OUTSIDE the JSON: file = canonical_body.json + "\n--\n" + b64sig? Then body is arbitrary JSON (parseable, human-friendly-ish, and any JSON serialization works as long as file is copied byte-for-byte). Since files are content-addressed and copied verbatim, we never re-serialize. Parsers just split on the separator. This kills the canonicalization dependency dead. I like it: **every artifact is two parts: JSON document, then a separator line `-----`, then base64 signature over the JSON bytes (everything before separator).** Envelope format: `doc\n-----\nsig`. Hash/id = sha256(entire file bytes). Verification: split at LAST occurrence of separator? Separator inside JSON string? JSON strings can contain "-----" in a body text! Use unambiguous separator: since JSON docs end with `}` followed by newline; separator `\n.\n` like SMTP? Body text could contain ".\n"? In JSON, a newline in a string is escaped as \n (two chars), so raw newline can't appear inside a JSON string! So a line consisting of a single "." cannot occur inside JSON (a JSON document's only raw newlines are between tokens... a "." alone on a line can't be valid JSON token context). Use RFC822/SMTP-style: terminator line containing only "." — safe because JSON strings escape newlines. 

So artifacts: `doc` (JSON bytes) + `\n.\n` + `b64(sig over doc bytes)` + `\n`. Verifier: find first occurrence of "\n.\n" after... the doc itself can't contain raw "\n.\n" because inside strings newlines are escaped; outside strings, "." can only appear inside numbers (e.g., `1.5` — could `\n.\n` occur? `. ` as a token alone? JSON tokens: after a newline, `.` isn't valid start except... numbers like 1.5 contain "." but not at line start after newline unless pretty-printed weirdly. To be extra safe: forbid pretty-printing; require doc serialized compactly (no whitespace) — generators emit compact JSON; and forbid raw newline in doc except the final one. Then doc = compact JSON + "\n", then "." line. Even simpler: doc is compact single-line JSON; file = `doc\n.\nb64sig\n`. A single-line compact JSON can't contain raw newline at all. Solid, trivially implementable. Say: "artifacts are single-line compact JSON; signature lines follow a dot line; sign sha256 of doc bytes."

Encryption item shape:
```
doc = {
 "v":1,"type":"post","seq":47,"ts":...,"author":b64pub,
 "enc":{
   "algs":"x25519-es/hkdf-sha256/aes-256-gcm",
   "n": b64(nonce for content AEAD),
   "epk": b64(ephemeral pubkey),
   "to":[ {"t":"k", "c":b64(wrapped key AEAD ct+tag)} , ... ],
   "ct": b64(encrypted body incl audience list, mentions)
 }
}
```
Hmm — per-recipient wrap: with static ECDH sender-ephemeral: Z_i = X25519(eph_priv, recip_static_pub); key_i = HKDF(Z_i, salt=sha256(doc-minus-to?), info="wrap"); wrapped_i = AEAD(key_i, nonce derived from counter i, plaintext=item_key). Recipient tries each `to[i]` with X25519(mypriv, epk) → HKDF → unwrap; success/failure via AEAD tag. Recipient identity hidden (no pubkey per envelope). Audience size leaked. Plaintext body contains `"aud":[keyids...]` so recipients know the audience for replying. Also inside plaintext: full body, any mentions.

Wait, AEAD nonce per envelope: derive nonce = i or use HKDF output split into key+nonce. Fine: key_i = HKDF(Z_i, salt=h, info="w", len=32+12): first 32 = wrap key, next 12 = nonce. Content: item_key random 32 bytes; ct = AES-256-GCM(item_key, nonce n, plaintext = compact JSON of body). Photos: each blob encrypted under derived keys from item_key: blob_key = HKDF(item_key, info=filename/idx).

Which AEAD? AES-GCM (Go/Java/.NET stdlib; Python lacks). ChaCha20-Poly1305: Go yes, Python no, Java yes (11+? Java has ChaCha20-Poly1305 since 11). Note assumption honestly: "I assume an AEAD and X25519; languages where these aren't stdlib (Python, C) pay a real cost — this is my biggest dependency concession; alternatives considered: hand-rolled HMAC stream cipher (encrypt via HKDF-CTR + HMAC tag) implementable from SHA-256/HMAC alone in ~40 lines — I specify the wire format so that algorithm agility... no, agility is complexity. Decision: mandate X25519+HKDF+AEAD; provide the 40-line HMAC-CTR fallback as a specified alternative cipher suite for stdlib-only languages? Maybe mention as appendix possibility. Keep one suite for interop; concede the Python point in cost sheet.

Also mention: hiding "who it's for" — envelopes contain no recipient key; but hub sees fetches. Since readers pull whole feeds, hub sees only "IP X fetched feed." But who's IP X? For families, whatever. Non-goal allows it.

RSS/bridges: hub generates `/feed.xml` from public items (type post, no enc). Mastodon bridge: hub exposes ActivityPub actor per user with public posts; replies from fediverse: extension (inbox → hub converts to signed items? can't sign as user... replies come back "as an extension, not a requirement" — fine, punt: bridge marks them as unverified or hub holds... no. Just punt.)

Grandma flow detail: install app → "pick a name" → app generates keypair in platform secure store → chooses a hub (app shows known family hub, from daughter's invite link) → publishes identity.json. Never sees key. Backup: app exports encrypted identity backup QR / file → daughter scans (recovery registration: daughter's pubkey into grandma's chain). Phone lost → call daughter → daughter sends invite link (contains hub location + grandma's... nothing secret needed? New device generates new key; daughter signs rotation referencing grandma's genesis; grandma's app publishes updated chain to hub; mother/others re-poll and accept (recovery rotation policy). Grandma never handled a key. ✓.

Cost sheet: no forward secrecy; split-view attacks; contested rotation unresolved cryptographically; reply visibility limited to polled feeds (no global search/discovery — actually that's a feature re: no directories, but means finding people is social); metadata leakage (sizes, timing, audience cardinality); dependency concession on AEAD/X25519 stdlib availability; browser clients need CORS-friendly hubs or proxies; multi-device sync complexity (signing on multiple devices → subkeys? Keep: one key per device with chain — or device keys added to chain: chain entry type "device". Hmm, multi-device: simplest: identity key exportable/syncable between own devices via QR; or chain-authorized device keys (each device key added by identity key, items signed by device key). That's nicer: rotation granularity + revocation of lost phone without rotating identity! Chain entries: add_device/remove_device. Then grandma's lost phone: revoke device key via recovery... wait recovery rotates identity; device revocation needs identity key which was on lost phone. Design: identity key lives... ugh, complexity. Choose: person has one identity key held in secure enclave; devices each get own key authorized in chain by identity key; identity key kept offline/escrowed (this actually helps theft: identity key on paper in drawer / with recovery contact; daily signing by device keys). Grandma: her identity key generated at onboarding, backed up via QR to daughter at setup ("pairing"), never seen. This gives: lost phone → revoke device key with identity key (from pairing/escrow) → no chain fork needed! And theft of phone ≠ identity theft. This is better. But adds one artifact layer. Cost sheet: mention I'm least sure about whether device-key indirection earns its complexity for v1; a v1 with single key is simpler; device keys are the right second revision. Actually for grandma-lost-phone with single key: recovery contact rotates. With device keys: revoke+add. Both need daughter. Device keys handle theft better. I'll include device keys in design but flag as the first thing I'd cut... no wait §8 asks what to cut if halving: cut device keys → single key per person; cut mirrors; cut reactions; cut blob encryption (photos public-only initially?). Let me structure the answer.

Length: they want ~4000 words argued. Let me write it well-structured with headers matching their 8 asks. Show byte shapes. Be concrete.

Name the protocol? Something like "Ledgerless"... call it "Household" or "Commonplace"? Maybe "Keystone"? Simple name: **"Notary"?** Eh. "SIGNPOST"? I'll call it **Threshold**? Let me just call it **"Frontporch"**? Pick something evocative of family + self-signed: **"Hearth"**. Good: hearth = home fire, family center, and it's your own fire not the landlord's.

Let me now also nail down "what a reader fetches on first contact and on a poll":

First contact (given a location URL, e.g., from a link/QR):
1. GET `{loc}/id.json` → identity chain. Verify chain internally (genesis → head), record head key, genesis hash. TOFU pin. Optionally compare fingerprint out-of-band.
2. GET `{loc}/feed.json` → signed index: {head_keyid? author key, latest_seq, items:[{seq,id,url}]}, signed by a key in the chain. Record latest_seq.
3. Fetch items (all, or recent N): GET item files by id; verify sha256(id match) + signature by chain key.
4. Fetch blobs.

Poll:
1. GET id.json (short) — check head unchanged or valid extension (rotation/move/device changes).
2. GET feed.json — if latest_seq > known, fetch new items. Also compare across mirrors optionally.

Item id = sha256 of file bytes → content-addressed, mirrors trivial, hub can't alter without breaking hash (and even hash-match-but-different-bytes impossible).

Backdating: item contains ts and seq signed; index signed. Hub could withhold new index → stale detection via ts. Hub can't insert fake items (sig). Hub can't reorder (seq). ✓.

Feed.json size: it grows unboundedly with items... scale "not millions per person" — families: hundreds/thousands. Index could be paginated: feed.json lists last 200 + link to archive pages. Mention.

One thread cross-hub, concrete: A posts item#47 encrypted to family (7 envelopes). B (family.example) polls A's feed from a.example (B's app fetches directly), decrypts (B's key unwraps envelope 3), sees audience list, writes reply item#12 on family.example: type "reply", target: {author: A_pub, id: sha256}, encrypted to same audience (copies aud, maybe adds). A's app polls B's feed, decrypts B's reply, correlates target → thread. C reacts: item {type:"react", target:{...}, emoji:"❤️"} — reactions maybe plaintext? Emoji reaction reveals little; but for family-only posts a public reaction leaks "something exists." Keep reactions under same encryption or mark visibility="audience of target." Simplest: reaction item carries the same envelope set as target (author copies audience from decrypted target). Fine.

Now the identity section (ask #2): person = an Ed25519 public key + its chain (the genesis key is the name; the *current* key is the speaker). Rejected alternatives:
- Domain-based (ActivityPub): identity dies with domain (scenario 4 fails), hostile operator owns your handle.
- DID documents / DIDs: fine but require resolvers/registries infra; our chain IS a poor-man's DID; rejected the DID spec machinery for dependency reasons.
- Web-of-trust/global registry (keybase-style, nostr relays+npub): nostr's key-as-identity is close — nostr is essentially this philosophy; differences: nostr relies on relays + global filter feeds, NIPs sprawl, no encryption in core (NIP-44 bolted), no chain (rotation impossible). I should acknowledge nostr as the nearest existing thing and argue deltas: rotation/recovery chain, audience-carried E2E, compact artifact set. Also Bluesky's DID+handle: relies on PLC directory = shared infrastructure, rejected.
- Username@hub: rejected (divorce: operator owns the name).

Assurance 4 "no access-control agreement between hubs" — the deep move: **there are no hub-to-hub messages at all.** Hubs never talk to each other. Readers do cross-polling. The hub is a static file server + optional RSS translation. This is the architecture's central simplification: "hubs are dumb CDNs for self-certifying files; all semantics live in clients."

That also makes scenario 6 trivial: a dumb hub = static file server with `GET`, maybe auto-RSS. Weekend implementer: publisher = write JSON files + sign + PUT/POST upload (auth: hub account, e.g., HTTP basic or a session — hub auth is out of protocol scope, it's just hosting). Reader = fetch + verify + decrypt. 

Upload protocol: hub needs a write API. Minimal: `PUT /{user}/...` with hub credentials; or even "hub watches a folder." Keep: single authenticated PUT (or POST) of artifact bytes. Spec says hubs SHOULD accept authenticated PUT with bearer token issued out-of-band at account creation. Fine.

Now write the document. Sections per their ask list 1-8. Include byte shapes. Keep prose tight but argued. Aim maybe 3500-4500 words. Use headers, minimal fluff. Include:

0. Preamble: nearest prior art (nostr, ActivityPub, ATProto, Keybase) — one paragraph each, argue why not just use them. Actually brief says "if you believe an existing one already solves this, say so." Nostr is closest on 1,3,4 but weak on 2 (E2E not core, audience mgmt), no key rotation (single key forever — grandma-loss = death), relays encourage client polling — my design is basically "nostr with a key-event chain, audience-carrying E2E, and static-file hubs." Honest framing: this is nostr's philosophy on a diet, and the delta is the point.

1. Architecture one page.
2. Identity primitive + rejections.
3. Four assurances, mechanisms + failure modes.
4. Scenarios 1,2,3,4 (also touch 5-7 briefly).
5. Key change/recovery.
6. Encryption construction detail.
7. Cost sheet.
8. What to cut.

Primitives assumed: SHA-256, HMAC, HKDF (buildable from HMAC in ~15 lines — actually HKDF is specified from HMAC; can include tiny pseudo-code), Ed25519, X25519, one AEAD (AES-256-GCM or ChaCha20-Poly1305), base64url, compact JSON, HTTP. Note Go/Java/.NET/Node have all in stdlib; Python lacks Ed25519/X25519/AEAD in stdlib — flagged as the biggest concession; offer the HMAC-CTR+HMAC fallback suite as a normative appendix option ("suite B: hsalsa..." no—keep simple: mention possibility, don't fully spec).

Canonicalization: the "\n.\n" envelope trick — explain why (JSON canonicalization is the classic weekend-killer; we sidestep by never re-serializing: files are content-addressed and copied verbatim; signature over raw doc bytes).

Let me draft the item shapes concretely:

identity.json (doc part):
```json
{"v":1,"genesis":"b64","events":[
 {"seq":1,"ts":"2025-06-01T10:00:00Z","key":"b64(ed25519 pub)","recovery":["b64 daughter pub"],"device":["b64 device pub"],"at":["https://a.example/alice/"],"name":"Alice"},
 {"seq":2,"ts":"2026-02-03...","key2":...}
]}
```
Each event: signed by previous key (or recovery key if via:"recovery"). Event doc: {"seq":n,"prev":"b64(sha256(prev event doc))","type":"rotate|move|device|profile", ...}. Chain verification: hash-link + sig by key introduced in seq n-1.

Hmm, decide structure: identity.json = list of event *files*? Keep one file: doc = {"v":1,"events":[ [event_doc, sig], ... ]} where event_doc is the compact JSON string... nested JSON strings are ugly. Alternative: identity.json is itself the chain head only, with prev hash linking to previous head files (id1.json, id2.json...). Content-addressed chain of head files! Each file: doc {"v":1,"seq":n,"prev":"sha256-of-previous-head","type":"rotate","key":"newpub","sig-by":"keyid or recovery", ...} + sig. Client walks backward via prev. Minimal and uniform with everything else (same envelope format). 

feed.json: doc {"v":1,"author":"b64 current key","latest_seq":47,"prev_feed":"sha256(prev feed.json)"?} — feed index also hash-chained for gap detection! Then hub can't serve a truncated *older valid* feed without reader noticing? Reader can notice: latest feed.json's prev-chain must reach back to a feed.json the reader has seen. If hub serves feed@seq47 whose prev is hash of feed@seq40 but reader has feed@seq45, mismatch → tamper/gap detected. Nice. But requires hub to keep all old feed files (fine, they're small; or readers keep them). Simplify: feed.json is append-only log of entries? Feed file itself is the full log: {"v":1,"items":[{seq,ts,id},...]} signed whole. Hash-chaining not needed if the whole index is one signed doc: hub serving older valid index = stale (detectable by ts/seq), hub serving edited = invalid sig, hub serving subset-of-items-in-valid-way? Can't: any doc it serves must be sig-valid by author → only docs author actually signed. Author signs full indexes; hub can only replay old signed indexes → stale, never forged. Gaps within a served index impossible (sig covers whole list). So single signed index doc suffices; drop prev-chaining. But author might sign many index versions (each poll cycle?) — author signs new index when posting. Old ones valid but stale. Reader keeps max seq+ts. Good — simpler. Note index regrowth: author signs index containing all item ids; families: fine. Pagination noted.

Item file: doc {"v":1,"seq":47,"ts":"...","author":"b64","type":"post|reply|react|profile","target":{...},"enc":{...}} — no "body" if enc present; else body inline. Plus dot-line + sig by author (or device key authorized in identity head... if device keys used, feed/index signed by device key; readers check device key ∈ head's device list. Let me include device keys — it genuinely helps theft and grandma-recovery and multi-device. Chain event types: "root" (genesis, includes identity pub? Let's say genesis event introduces the identity key itself, self-signed — the anchor), then "rotate", "add-device","rm-device","move","profile". Who signs: identity key. Root: identity key signs a doc naming itself (self-certifying). Recovery keys listed in root/rotate events.

Wait, simpler model: ONE key per person (identity key) does all signing. Devices: each device holds the identity key (synced via QR between own devices). Lost device → rotate via recovery. This is simpler; device-key indirection is v2. Given "minimal" priority #4 and weekend implementability, I'll go single-key, and discuss device keys in key-change section as the known upgrade, honestly noting I'm torn. Hmm. But theft section: attacker with stolen phone has grandma's key; rotation race... With device keys, theft is cleanly revocable. Tension. Decision: spec single identity key + recovery; discuss device-key extension in §5 with argument. That's defensible and honest.

Grandma key custody: at onboarding, identity key generated in device secure enclave; app offers "pair with family" → QR to daughter's app which stores an *encrypted copy* of the identity key? No — daughter as recovery contact: grandma's chain lists daughter's public key; rotation statements may be signed by recovery key. Also app supports printing an encrypted paper backup (passphrase) — optional.

Divorce walkthrough specifics (scenario 1): Alice's stuff on Bob's hub. Bob: cannot post as Alice (no key; recovery contact is her sister not him). Cannot read her family-only posts *where he's excluded* — but wait, brief says he's "entitled to see family-only content" — i.e., in-circle posts he can read (he's family). What he can't read: posts to circles excluding him, her DMs. Fine — assurance 2 holds w.r.t. content not addressed to him. Cannot alter/backdate: sigs+seq. Cannot stop leaving: she has local archive; her key; she publishes new location (identity chain event "move" — but Bob won't serve it! She publishes the move event at her new hub; chain continues there; Bob's copy frozen). Mother one-tap: Alice shares link (any channel) `https://newhub.example/alice/#k=<b64 genesis>` — app fetches, verifies chain from genesis, matches pinned key. Bob's frozen copy: stale seq/ts.

Domain-goes (scenario 4): everyone's identity = keys; each person's chain has location(s); community re-hosts (someone's new domain / a shared cheap hub); followers get new links socially (the family already has side-channels); mirrors listed in chains help. Nobody's identity changes ✓.

Scenario 5 brief note. Scenario 6: weekend. Scenario 7: RSS + AP bridge.

Encryption section detail (ask 6):

Sender:
1. body_doc = compact JSON: {"body":"...","photos":[{"id":..,"mime":..}],"aud":["b64 keyids or full pubs"],"reply":...}
2. item_key = random 32B.
3. content_ct = AEAD_Encrypt(item_key, nonce=n(12B random), body_doc) — include doc header as AD? The enc header is in outer signed doc; use AD = sha256 of outer doc sans "to" array? Simpler: AD = the outer doc's "author|seq|ts" — or just bind via including header fields inside body_doc too. Minimal: AD = empty; outer signature already binds ciphertext to author/seq/ts. Blob keys: blob_key_j = HKDF(item_key, info="blob:"+j).
4. eph = X25519 keygen. For each recipient pub R_i: Z = X25519(eph_priv, R_i); okm = HKDF-SHA256(ikm=Z, salt=sha256(eph_pub||"hearth-wrap"), info="wrap", L=44); (wk, wn) = okm[0:32], okm[32:44]; to[i] = {"c": AEAD_Encrypt(wk, wn, item_key)}. No recipient identifier.
5. doc = {..., "enc":{"epk":b64,"n":b64,"to":[...],"ct":b64}}.

Recipient: for each entry in "to": derive, try unwrap (AEAD tag check); on success decrypt ct. Trying N envelopes: N ECDH ops per item — families N small; note as cost.

What hub learns: existence, ts, seq, type, ciphertext size, number of envelopes (audience size), fetches. Photos: encrypted blob sizes. Mention: audience *cardinality* only.

Add-member semantics: aud inside plaintext lists keyids; a later post can address a superset. Removing: new posts only.

DMs: item with type "post", aud=[one key], envelopes=[1]. Same machinery. ✓.

Forward secrecy: none; state that.

Interop: hub generates RSS from public items: title/body/dates; `atom:link` self. Feed readers ✓. Mastodon: hub exposes ActivityPub: actor URL, outbox with public posts Create/Note; signature: hub-generated (unverified by Masto) — content authenticity only for native readers; that's the stated trade. Bridge discovers via WebFinger at hub domain.

What would I cut (§8): device-key... already cut. Cut: mirrors (list multiple locations still), reactions (keep reply), blob encryption (photos public or none), feed pagination, AP bridge (keep RSS only), multi-location support → single location + social refollow. Halved spec = single-key identity chain + signed items + one encryption mode + static GET hub + RSS. 

Cost sheet items:
- No forward secrecy / PCS.
- Split-view serving by hub (detectable only via mirror cross-poll).
- Contested rotation not cryptographically resolvable — social layer.
- Reply discovery limited to feeds you poll; no global reply collection. Threading is local.
- Metadata leakage (sizes, cadence, envelope counts, IPs).
- N-envelopes try-decrypt cost; scaling audience to 100s gets costly (per-item N ECDHs; also envelope bytes) — fine for families, bad for "public-ish encrypted groups."
- Dependency honesty: Ed25519/X25519/AEAD not universal stdlib (Python!). The HMAC-CTR fallback is implementable but I haven't specced it — flagged.
- Browser apps awkward (CORS okay-ish, but key storage in browser meh).
- Key loss for isolated users (no recovery contact) = identity death — by design (non-goal re strangers).
- Hostile hub can delete with detection-only; also can DoS availability.
- Hub auth/account bootstrap is out of scope (abuse, spam on big hubs) — the design deliberately has no answer to spam/moderation: moderation is *reader-side* (you choose whom to follow; hubs may curate but readers verify). Note: on big commercial hub, operator hostile: can't forge, can't read, can't lock in — but CAN degrade (serve slowly, drop items) and can profile metadata. 
- Storage duplication: every client caches full archive — fine at family scale, stated.
- I'm least sure of: (a) single-key vs device-keys, (b) the try-all-envelopes recipient hiding (worth its cost?), (c) whether feed.json whole-index signing survives larger feeds, (d) recovery trust semantics.

Also should address: "what a reader fetches on first contact and on a poll" — explicit.

Naming: call it Hearth. Files: /id.json (current head name — actually chain files: /k/<genesis8>.json? Location URL structure: hub gives each user a base path: https://hub/u/alice/. Files: id.json (chain head), feed.json, items/<seq>-<id12>.json or items/<id>.json, blobs/<id>. The link shared contains base URL; key pinned on first fetch; optionally fragment #genesis for pre-pinning.

Invite link format: `hearth://<base-url>#<b64(genesis_pub or genesis hash)>` or https URL with fragment.

Write it. Use markdown headers. Reasonable length ~4000-4500 words. Let me be careful to hit every numbered ask. Also weave scenario 5/6/7 briefly.

One more architectural point for "The host cannot speak for you" failure mode: TOFU on first contact via hostile hub — if your *first* contact with "Alice" happens through Bob's hub, Bob can present a fake Alice (own key). Cryptographic identity prevents *hijack of an existing pinned identity*, not first-impression impersonation. Mitigate: fingerprints, QR pairing in family. Name it.

Also: sequence numbers and backdating — host can't create new items; can it replay old item as new by serving old feed.json? Reader sees seq lower than stored max → stale. Reader sees equal seq but fresh fetch... ts old. OK.

Feed head signed by "author" current key — after rotation, new key signs; readers verify new key via chain. Items embed full author pubkey; readers check membership in chain (any key in chain history? No — only keys current *at or after* item ts? Simplest: any key ever valid in chain can have signed items; revocation/rotation doesn't invalidate old sigs (good — history stays verifiable); but a *stolen old key* could sign new-looking items with high seq... reader checks seq monotonicity against feed index signed by current key. Items are only accepted as part of a signed index? Let me make that the rule: **an item counts only if referenced by a signed feed index** (or chain of indexes). Then stale-key attacks fail (index signed by current key lists exactly the items). Verification of standalone items still possible for caches, but admission requires index. Good rule; state it.

Poll flow then: fetch id.json → fetch feed.json (verify sig by current head key) → fetch listed new items (verify hash + sig) → fetch blobs. 

Also note hub MAY gzip/etag etc. Caching via ETag = sha256. Cheap.

Grandma details: "never told to store a file outside the house" — recovery pairing happens in-app at setup (QR shown on daughter's phone, grandma scans — or via the invite flow). Say: onboarding = install app → tap invite link from daughter (contains hub URL) → app creates identity, asks "who can help if you lose your phone?" → tap daughter (already a contact) → daughter's phone gets pairing request → done. No files, no key display.

Divorce contested departure §5: Bob claims departure is forgery. Facts: mother's app holds pinned Alice key K and chain seq n. Alice's new location serves chain seq n+1 "move" signed by K... wait, move event signed by Alice's key. Bob says "that's not Alice, her key was compromised / she didn't write it." Cryptographically Bob cannot produce any chain with seq ≥ n+1 signed by K. His claim is that K itself is stolen. Resolution: social (mother calls Alice), plus optional: Alice also pre-signed nothing... Additional defense: Alice could have pre-registered the move BEFORE the divorce (multiple locations listed at onboarding). The design's honest position: the signature proves the *key* moved her; whether the key still means Alice is a trust question the reader answers socially; apps surface it plainly. Also recovery contact can co-sign the move → two-key attestation. Mention.

OK — also quick nod: why not just use Signal/WhatsApp? Not publishing/not portable. Why not Matrix? Homeserver owns identity. Why not ATProto? PLC directory = shared infra + repo sync complexity + PDS trust. Why not ActivityPub? domain identity + instance authority + ACL server-side. Why not Keybase? centralized-ish proofs, dead. Why not nostr? Closest; deltas as argued. I'll put this early.

Now write. Keep code blocks tight. Total target ~4000 words. Let me write the final answer.
```

</details>

