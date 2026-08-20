---
model: glm-5.3
pass: 1
endpoint: https://opencode.ai/zen/go/v1/chat/completions
date: 2026-08-20T21:24:49.673Z
prompt: PROMPT-pass1.md
prompt_sha256: eab389889e055bcb32bc4532edc2183f780d8a267227464b47a9a9e220cae542
finish_reason: stop
tokens: {"prompt_tokens":1561,"completion_tokens":49042,"total_tokens":50603,"prompt_tokens_details":{"cached_tokens":0},"completion_tokens_details":{"reasoning_tokens":41586}}
wall_seconds: 753
truncated: false
reasoning_chars: 174931
---
# Hearth: a design for decentralized family publishing

*The name is cosmetic. Everything below is the argument.*

## 0. Thesis, and a precise reading of the adversary

The brief's §2 concedes the game up front: no confidentiality survives an insider. So the design goal is not to beat the hostile operator at cryptography — it is to make his powers **only ever negative**. He can suppress, withhold, delay, degrade, and profile. He can never fabricate, alter, repurpose, re-attribute, lock in, or read what he was excluded from. Every mechanism below is chosen to keep that asymmetry intact, and every place where a negative power survives is named rather than papered over.

The whole design in one breath:

> A person **is an Ed25519 keypair generated on their device**. Everything they publish is an **envelope: a signed payload in their personal append-only log**, hosted on any dumb HTTPS hub. Privacy is not access control on the hub — it is **symmetric "circle" keys handed to chosen people out-of-band**, under which content is encrypted before the hub ever sees it. The hub is untrusted disk. Trust lives entirely in signatures and in keys that never leave people's devices.

Three readings of the floor I want to contest slightly, before delivering it:

- **Assurance 2** is achievable only with the insider caveat the brief itself states: the ex can keep reading the *archive of circles he legitimately belonged to*. What he can never read is anything addressed to a set that excludes him. The protocol's job is to make exclusion real, retroactive invisibility impossible, and the cost of exclusion one conversation, not one renegotiation-per-hub.
- **Assurance 3** ("everything you wrote") holds fully for text and metadata; for media it holds because the authoring device is the original source of the photos anyway. It is a device-storage policy, backed by protocol, not magic.
- **Assurance 4** holds for integrity, confidentiality, and identity — but a hostile hub can always *drop traffic* (availability). The design mitigates with polling, mirrors, and gossip; it does not pretend to solve denial of service.

## 1. Prior art, honestly

The brief invites "an existing protocol already solves this" as an answer. I don't believe one does, under these constraints. The nearest neighbors:

- **Secure Scuttlebutt** is the closest in spirit: key-based identity, append-only per-person logs, gossip. I reject it as *the* answer because its stack — secret-handshake transport, private groups built on X25519 with ephemeral group IDs, its own feed encoding — fails priorities 1–3 (stdlib-only, weekend-implementable, plain-HTTPS + feed interop). Hearth is, roughly, SSB's load-bearing ideas re-derived on a five-primitive palette. SSB also never had a hostile-hub-first threat model; its design leans on eventual gossip rather than on surviving a motivated insider serving your storage.
- **Nostr** is the closest living system: keys as identity, relays as dumb hubs. I adopt its hub-is-dumb philosophy. I part ways on three load-bearing points: Nostr events are unordered (no chain, so no backdating defense, no rotation pinning, no stale detection); its private messaging is per-recipient ECDH (needs X25519 and *publishes the recipient list*, which violates this brief's audience-hiding requirement); and it has no always-local-mirror/guardian story. If Nostr grew a per-person hash chain and tagless boxes it would converge toward this.
- **ATProto** separates identity from hosting via signed DID documents — the same core insight as my "move" items — but its identity layer requires `did:plc` (a shared ledger — forbidden here) or `did:web` (domain-bound — dies in the divorce), and the reference stack is heavy. I keep the 10% of the idea that matters and drop the machinery.
- **ActivityPub / Mastodon** binds identity to a hub-owned URL; the hostile operator *is* the authority on that URL. Dead on arrival for scenario 1. Its "account migration" is a signed hint that the old server may simply refuse to serve — exactly the failure mode this design must survive.

So: a distillation, standing on those shoulders.

## 2. Architecture in one page

**Artifacts.**

| Artifact | What it is | Signed? | Purpose |
|---|---|---|---|
| Keyring | Ed25519 identity seed + circle keys + pairing secrets; on device, wrapped copies with guardians | — | The person, and everything they can decrypt |
| Envelope | `{"v":1,"p":b64(payload),"s":b64(sig)}` | Ed25519 over payload bytes | The atomic unit of everything |
| Log | Ordered list of envelopes (seq + prev-hash chain) | Each item | The person's complete publish history |
| Blob | Bytes, content-addressed by SHA-256; encrypted for private media | Hashed | Photos and long text |
| Inbox | Per-person queue of signed "ping" hints | Signed by sender | Timeliness for replies/DMs; never load-bearing |
| Projections | RSS / JSON Feed / HTML / directory | **Unsigned** | Cosmetic views for strangers and bridges |

The invariant that makes the hostile hub survivable: **everything the hub stores is either an envelope (signed), a blob (hash-verified), or an unsigned projection that nobody trusts.** The hub is untrusted disk with a POST endpoint.

**Payload common fields** (all types):

```json
{ "type": "post", "root": "<root pubkey b64>", "key": "<signing pubkey b64>",
  "seq": 41, "prev": "<item id b64>", "at": 1735689600, ... }
```

Item id = `b64(SHA-256(payload))`. Types: `post`, `reply`, `react`, `profile`, `move`, `rotate`, `delete`, `witness`, `box` (private anything), plus `ping` for inbox hints. `root` is the person's first-ever key — their permanent ID. `key` is the current signing key (equal to root until rotation).

**Endpoints a hub must serve** (a static file server plus a small upload CGI):

```
GET  /hearth/<keyid>/log?since=<seq>     → envelopes, oldest-first
GET  /hearth/<keyid>/item/<id>           → envelope
GET  /hearth/<keyid>/blob/<id>           → bytes
POST /hearth/<keyid>/item, /blob         → upload (hub account auth, hub's choice)
POST /hearth/<keyid>/inbox               → ping hints
GET  /hearth/<keyid>/feed.json|.xml      → unsigned projection, public items only
GET  /hearth/dir?q=Gran                  → advisory, unsigned name→keyid lookup
```

**First contact.** You arrive via a link or QR that carries both a hub URL and a keyid (the link *is* the trust anchor; a bare name lookup through a hub directory is TOFU — see §4, A1). The app fetches the log tail, verifies every envelope's signature under the payload's `key`, checks the seq/prev chain back as far as it cares to, extracts the latest `profile` item for name and avatar, and renders. Boxes are trial-decrypted against the local keyring (§7).

**Every poll thereafter.** `GET log?since=<last seq>`; verify; render; fetch blobs on demand. Timeliness for other people's replies to you comes from inbox pings (which cause a fetch-and-verify of the sender's log) — but pings are only ever hints; mutual polling works alone.

**Roles.** The *app* does everything cryptographic. The *hub* stores and serves bytes and may optionally verify signatures on ingest to keep its disk clean. A *bridge* is anyone's RSS→fediverse bot. A *mirror* is anyone copying your public log — free replication, harmless, because nothing unsigned is ever trusted.

## 3. The identity primitive

**A person is their root Ed25519 public key** (displayed as `Name#` + 8 hex of its SHA-256). The key never lives on a hub; it is generated on the device at onboarding, and only public keys and signed payloads ever cross to the hub.

Everything we normally think of as identity decomposes into signed *attributes inside the log*:

- **Name/bio/avatar** — a `profile` item. The hub can't rename you; it can only serve stale profiles.
- **Location** — implicit: wherever your log is currently served. A `move` item (signed) points to the new base URL; readers follow it.
- **Key succession** — a `rotate` item (signed by old key, naming the new key) with a strict pinning rule (§6).

Why the key and not the alternatives:

- **A domain / `did:web`**: identity dies with the domain or is held hostage by whoever controls DNS and serving. In the divorce, her identity is her ex's property. Rejected outright.
- **A registry / `did:plc` / any shared ledger**: forbidden (no global consensus), and unnecessary — resolution here is "fetch from anywhere you last saw them, verify against the key you already hold."
- **A hub-scoped handle (ActivityPub)**: the hub *is* the identity authority; §2's adversary is that authority. Rejected.
- **Content-addressed profile (IPFS-style)**: still needs a signing key to authorize updates; adds a DHT to get nothing more. Rejected.

The cost of key identity is that humans use names and crypto uses keys, so the *bridge between them* is where trust enters: QR pairings, links carrying keyids, and short fingerprints for eyeball checks. For the family audience, that bridge is exactly the moment where humans are already present (install, in-person setup, recovery). For strangers, it's TOFU-plus-fingerprints — no worse than the web, and strictly better than today once they hold the key.

One more consequence worth stating: **identity is independent of hosting, so hub choice is a hosting decision, never a trust decision.** Grandma on the hostile son-in-law's commercial hub and grandma on her daughter's Raspberry Pi have identical security; they differ only in availability and ads.

## 4. The four floor assurances, mechanism by mechanism

### A1. The host cannot speak for you

*Mechanism.* Client-side key generation at onboarding (a conformance requirement — a server that generates keys for users is out of spec, and the spec says so loudly). Every artifact is an envelope; the signature covers the payload bytes including `at`, `seq`, `prev`, and (for private items) the ciphertext. Attribution is by the `key`/`root` fields inside the signed payload, so an item cannot be re-attributed without breaking its signature. Readers verify mandatorily.

*Backdating and alteration.* Alteration breaks the signature. Backdating a *new* item ("she wrote this in 2019") requires signing with an old date — impossible without the key. Reordering breaks `prev` links. Replaying authentic old items is possible but self-defeating: each item self-dates, and any reader who has ever seen a longer chain — or meets one later, since chains prefix-match — recognizes the replay as a truncation. Serving a frozen log is detectable as *stale*, which is precisely what scenario 1 demands.

*Failure mode, named.* The unsigned projections. An RSS file, an HTML page, a Mastodon bridge post — the hostile hub can edit those, because ordinary feed readers don't verify anything; for them this is exactly today's web. The floor holds where verification is possible: the log is the artifact of record, and hubs SHOULD embed the envelope (`"_hearth": {"p":…,"s":…}`) in JSON Feed entries so any verifying reader — present or future — can check. "Nothing it serves as yours verifies unless you signed it" is true; "nothing it serves is believed" is not, and cannot be, at RSS.

*Also named:* the hub can censor — refuse to serve, serve subsets, target different content to different fetchers. That is the negative power the thesis concedes. Detection tools exist (witness items, mirror comparison) but cure is only departure.

### A2. The host cannot read what wasn't meant for it

*Mechanism.* Audience = "circle" = a random 256-bit symmetric key. The author's device encrypts the item (text, reply-targets, media references, even the item's inner type) with Hash-CTR under a per-item nonce, *then* signs the payload containing the ciphertext — so the hub holds opaque bytes it cannot read and cannot maul. Circle keys reach members through per-pair "direct channels" whose secrets were established out-of-band at pairing time (§7). The hub is never in any key's distribution path.

Crucially, the box carries **no recipient list and no circle tag** — only a nonce, a key-check value, and ciphertext. Recipients self-identify by trial-decrypting with keys they hold. The audience is not published, not even as a count, not even as "these items belong to the same circle" clustering (this is why I rejected tags — see §7).

*Failure modes, named.* (1) A circle member leaks the key — opens that circle's past and future until rotation. Inside the audience, per §2, this is not a solvable problem, and per-recipient encryption would not solve it either. (2) No forward secrecy: a key leaked today decrypts the archived ciphertexts the hostile hub already holds, for circles he was excluded from but a member betrayed. (3) A compromised pairing channel compromises the pair's channel and anything granted over it. (4) Device compromise is total (identity + circles); §6 covers hygiene.

### A3. The host cannot keep you

*Mechanism.* The keyring and a full local mirror (log + blobs; photos originate on the device anyway) live on your device and in guardians' wrapped copies. Leaving is: sign up anywhere (or point your own domain at a box), upload the mirror, append a `move` item, share one link. No protocol step requires the old hub's cooperation, because identity was never the hub's to withhold.

*Failure modes, named.* Device loss without guardians = identity death (strangers re-meet you as a new key — accepted non-goal; families have guardians precisely to avoid this). The ex keeps serving his frozen copy forever — detectably stale, unextendable by him. And deletion is best-effort against a hostile host: tombstone items remove content from every honest reader's view, but the hub can keep serving old envelopes to whoever enumerates them; the only full remedy is circle rotation, which is nuclear and honest about being so.

### A4. People on other hubs are first-class

*Mechanism.* There is no hub-to-hub anything. Cross-hub interaction is person-to-person cryptography riding on dumb HTTP: B reads A's family-only post because B holds A's circle key; B's reply is an item in *B's* log, encrypted to *B's* circle containing A; A's app fetches B's log (pinged via inbox, or by polling, since families follow mutually) and assembles the thread by matching decrypted `to_item` references. No hub knows what a circle is, who is in it, or that the other hub exists.

*Failure mode, named.* The hostile hub can drop pings and drop cross-fetches through itself. Mutual-follow polling already covers most of this; witness items (§6) cover the rest — any third party's log can embed foreign envelopes as a courier, verified by original signature. What remains is the availability concession of §0.

## 5. Scenario walk-throughs

### 5.1 The divorce

Her key was generated on her phone; the hub never saw the private key. Her log lives on his hub as envelopes he can serve, truncate, or freeze — never forge, never extend, never backdate. Her posts to the "family" circle (while he was family) are readable to him: he was the audience; accepted. When the marriage ends, she creates a new circle — pairing with her mother and sister by phone or in person, channels he cannot see — and posts to it *on his hub* as ciphertext he stores but cannot read, forever, unless a member betrays.

She leaves: her app uploads log and blobs to her sister's hub, appends `{"type":"move","to":"https://sister.example/hearth/<her keyid>/"}`, and texts her mother a link. One tap: mom's app fetches, sees the fetched chain extend the prefix it already holds (mom's stored head appears in it), updates, done. Her relatives' apps that keep polling the ex's hub see a chain frozen at seq N — and any of them who later compare against her real chain see his copy is a prefix truncation. His copy reads as stale, not as her. The one thing he retains: the family-archive ciphertexts from circles he belonged to, which he can read and she cannot un-read — the insider concession, stated in §0.

### 5.2 Grandma onboards

The daughter installs the app on grandma's phone. The app generates the keypair in the OS keystore — grandma is never shown a key, because there is nothing she needs to do with one. She picks "Gran"; the name is a signed `profile` item. The app asks where the page should live (default: the daughter's hub — a hosting decision, not a trust decision). Then the two phones pair: QR shown on one, scanned by the other. That single 16-byte secret, exchanged across a kitchen table, does three jobs at once: establishes their direct channel, lets Gran send her daughter family-only content later, and — because the app immediately wraps Gran's full keyring under a key derived from that secret and pushes the wrapped copy to the daughter's app — makes the daughter a **guardian**. No file was stored anywhere grandma was told about; the backup is an app-to-app artifact.

A year later the phone is in a lake. Gran calls her daughter. The daughter's app shows a recovery QR; Gran's new phone scans it; the daughter's app relays the wrapped keyring over the new channel; the new phone unwraps it (verifying the restored key against the public key it fetches from the log — and against the daughter's locally known copy, which does not depend on any hub's honesty). Gran is back, same identity, same followers. The app then rotates the identity key and re-wraps guardian copies, because the exposure window is unknown. The honest price, named in §8: whoever can restore you can impersonate you — the daughter, holding both the pairing secret and the wrapped keyring, could have seized Gran's identity at any time. Rotation-on-recovery plus follower-side rotation alerts bound that risk; they do not eliminate it. (K-of-N sharing is a straightforward extension; I defaulted to any-one-guardian because the scenario says one phone call.)

### 5.3 Two hubs, one thread

A (`a.example`) posts a family-only item: app encrypts the inner document under circle key K_Afam with fresh nonce, wraps it in a signed `box` payload, POSTs the envelope to a.example. B (`family.example`) follows A, polls A's log, trial-decrypts the box with a key from his keyring, reads it. B replies: his app builds an inner reply document (`to: A's root keyid`, `to_item: the box's item id`), encrypts it under *B's* circle key K_Bfam (a different circle — his own — that includes A; A holds that key because B once granted it over their direct channel), signs, appends to B's log on family.example, and POSTs a signed ping to A's inbox on a.example: `{from: B, feed: B's log URL, head: latest item id}`. A's app fetches B's log tail, verifies, decrypts, and renders the thread. A reaction is the same flow with a two-field payload. Neither hub holds any configuration, any ACL, any knowledge of the other's existence. The only cross-hub wire traffic is plain GETs and one untrusted-but-signed POST.

### 5.4 The domain goes

`family.example` lapses. Every affected person's app holds the full mirror locally; each signs up elsewhere, uploads, and appends a `move`. Identity is untouched — nobody's ID ever contained the domain. Contacts find them via the shared link (one tap, prefix-verified) and via gossip: relatives' logs carry `witness` items embedding the move envelopes, which double as third-party timestamps. Strangers who followed `https://family.example/feed.xml` lose the feed — inherent to URL-following without a global registry — but when they re-find the author by any ordinary means, the feed carries the same key it always did, continuity to the old chain verifies automatically, and the stranger's reader resumes. Scenario 5 (the big hostile hub) adds nothing new: per-identity hub cost is storage + poll-serving, flat; the operator's powers are exactly the divorce ex's powers minus circle membership — he can profile and degrade, and cannot forge, read exclusions, or retain. Scenario 7 is A1's projection story plus the non-goal: after *total* key loss the public author returns under a new root key, may attach an unverifiable "formerly #fingerprint" claim, and re-meets the stranger socially; the bridge's handle continuity is the bridge's problem.

## 6. Key change and recovery

**Routine rotation.** The device generates a new keypair and appends `{"type":"rotate","to":"<new pk>"}` signed by the old key; the new key's log begins at seq 1 with `prev` pointing at the rotate item's id, `root` unchanged. Circle keys and channel secrets are *independent of the identity key*, so rotation breaks no audiences — a quiet but important decoupling. Guardian copies are re-wrapped and re-pushed.

**The pinning rule (the load-bearing part).** Once a reader has seen a rotate at old-key seq *n*, it rejects any old-key item with seq > *n*. This is why the log needs sequence numbers at all: a key thief holding the old key can sign items with arbitrary *timestamps*, so timestamps cannot bound the theft — monotonic position can. (This is my concrete disagreement with Nostr-style unordered events: without a chain, rotation security collapses to guesswork.)

**Theft.** Rotate immediately from a safe device. Readers who see the rotation are protected by pinning; readers whom the thief's hub keeps in the dark (serving only the thief's fork) follow the thief until an out-of-band or gossip channel reaches them. Identity rotation does not rotate circles — the stolen keyring included them — so post-theft hygiene means re-granting circles, and since channel secrets were also stolen, ultimately re-pairing. For a family this is one awkward dinner; for the design it is an honest, bounded mess, flagged in §8.

**Loss.** Restore via guardian (5.2), then rotate.

**The contested departure.** The hostile operator's move: publicly claim her departure is a forgery and keep serving "the real her." Cryptographically, his claim is empty — the move and post-move items carry her valid signatures, and he cannot produce a single signed item postdating the move. His only available act is serving the frozen prefix, which is detectably stale and which he cannot extend. The one argument available to him — "her key was stolen; the mover is the thief" — is unfalsifiable in any scheme (it is the insider problem wearing a different coat), but it is also *non-operative*: to act on it he would still need her key. What the design adds, cheaply, is **witnesses**: when she leaves, relatives' apps embed her move envelope in their own logs. Those witness items sit on hubs he doesn't control, are signed by people he can't impersonate, and timestamp the departure ("this envelope existed by date D"). The public record on other hubs proves the departure authentic; his frozen copy is thereby also provably a truncation, to anyone who ever compares.

## 7. The encryption construction

**Palette discipline and the key decision.** The brief's palette has signatures and hashes but no key agreement. That is not an accident to work around — it forces the design to notice something: **per-recipient public-key encryption is wrong for this adversary.** Against an insider it buys nothing (he's a recipient); against the hub it costs the audience list (wrapped keys must name recipient public keys — publishing exactly what §6.6 forbids; hiding it requires anonymity machinery far beyond a weekend); and it needs a DH primitive off-palette. Symmetric circle keys with out-of-band pairing are not the consolation prize — they are the correct semantics: *the audience is a shared secret among exactly the people chosen.* The costs (pairing friction, no forward secrecy) are §8's to own.

**The cipher (HCTR).** SHA-256 in counter mode, domain-separated everywhere:

```
block(b)      = SHA-256("hearth-ctr" || dk || n || be32(i))      # 32 bytes
enc/dec(pt)   = pt XOR (block(0) || block(1) || ...)[:len(pt)]

box key        dk = SHA-256("hearth-item" || K || n)             # K = circle/channel key
blob key       dk = SHA-256("hearth-blob"  || K || n)
box check      chk = SHA-256("hearth-chk" || K || n)[0:8]
channel key    kA→B = SHA-256("hearth-dc" || S || pkA || pkB)    # S = pairing secret
```

Nonces `n` are 16 fresh random bytes per box and per blob; reusing (K, n) is the one forbidden act (keystream reuse). There is no MAC: every ciphertext lives inside a signed payload, so malleability by the hub dies against the signature; media blobs are referenced by the SHA-256 of their stored bytes, so substitution dies against the hash.

**The box payload** (what the hub sees):

```json
{ "type":"box", "root":"…", "key":"…", "seq":42, "prev":"…", "at":1735689900,
  "n":"<16B nonce>", "chk":"<8B check>", "ct":"<ciphertext>" }
```

The hub learns: a box exists, when, how big. Not: what type of thing it is, whom it's for, which circle, what it replies to, or any media filenames — all inside `ct`. I rejected a stable circle tag on the wire precisely because it would let the hub cluster same-circle items; instead, readers trial-decrypt: for each key in the keyring (families hold dozens at most), compute the check; on match, derive `dk`, decrypt, parse. One hash per key per box. Key lookup after decryption is local (key → circle label).

**Inner document** (after decryption): `{"t":"post"|"reply"|"react"|"dm"|"grant", "text":…, "media":[{"blob":id,"type":…,"bytes":…}], "to":…, "to_item":…, "grant":{"label":"Family","key":"…"}}`.

**Media.** Public blobs are raw bytes. Private blobs are `"HRTH1" || n(16) || ciphertext`, self-describing; blob id is the SHA-256 of the stored bytes, so fetch integrity is checkable by anyone and decryption needs only the circle key and the blob header. Item references to media sit *inside* ciphertext for private items.

**Pairing and grants.** Two people exchange a 16-byte random secret S out-of-band — QR across a kitchen table, or a link over any channel they already trust (an E2E messenger; a family group chat is *not* such a channel if the adversary is in it). Direction keys derive as above (sender's pubkey first), so A→B and B→A boxes carry unrelated checks and even a hub operating both logs cannot link the channels cryptographically. To admit B to a circle, A appends a `box` (under their channel key) whose inner document is a grant: label + the circle key. Grants ride A's log — durable, exportable, gossip-able — and B picks them up by following A. Revocation is rotation: new circle key, new grants to remaining members over their channels; the excluded member keeps the old key and the old archive (no forward secrecy, named).

**Guardian wrapping.** The keyring (identity seed, circles, channel secrets) is serialized, encrypted with HCTR under `SHA-256("hearth-guard" || S)` for each guardian, and stored in that guardian's app — never in the public log.

**What the hub learns anyway — the full list.** Feed-fetch and poll patterns (who follows whom, when); box count, timing, and sizes per identity; the public chain skeleton (seq, timestamps, hence activity cadence); social-graph edges implied by inbox pings and cross-fetches (though *which* items relate to whom is inside ciphertext); media sizes; and, for a big hub, cross-customer timing correlation. This is consistent with the stated non-goal: we hide *who an encrypted message is for*; we do not attempt traffic-analysis resistance.

**A note on HCTR.** It is a PRF-counter stream cipher: sound under the standard assumption that secret-prefixed SHA-256 is a PRF, with domain separation and unique nonces doing the work. It is nonetheless *nonstandard*, and I flag it as my least comfortable load-bearing choice (§8). The alternative — mandating an AEAD — breaks priority 1 in several mainstream stdlibs; a future version byte could upgrade it without touching anything else in the design.

**And the envelope, revisited.** The base64-payload envelope is where priorities 1 and 2 stop fighting: the signature covers *exact bytes*, so no JSON canonicalization exists anywhere in the protocol — no key-ordering rules, no number-format rules, no escape rules, nothing for a second implementer to get subtly wrong. The cost is base64-in-base64 for text payloads, which nobody reads anyway (§5 of the brief). I rejected fixed-key-order canonical JSON for exactly the reason it always fails: the bugs are invisible until two implementations disagree at 2 a.m.

## 8. The honest cost sheet

- **No forward secrecy, anywhere.** A leaked circle key opens that circle's entire archive, including ciphertexts a hostile hub has been patiently storing. Rotation is remedial, not preventive. This is the deepest cost of the palette and of symmetric circles, and I'd defend it only on the brief's own terms: the named adversary either holds the key (unsolvable) or doesn't.
- **Pairing is the linchpin and it is a social assumption.** Every confidentiality property routes through a 16-byte secret exchanged over a channel the family trusts. If pairing happens over a compromised channel, the circle is compromised from birth. No protocol fixes a broken introduction channel.
- **Guardians can impersonate.** 1-of-N recovery means the daughter could seize Gran's identity silently. Rotation-on-recovery and follower alerts bound it; K-of-N would bound it better at the cost of the one-phone-call recovery the scenario demands. My uncertainty here is genuine — I chose availability because families mostly do not coup their grandmothers, and I have no data.
- **HCTR is nonstandard.** Flagged above. If SHA-256-as-PRF ever wobbles, so does A2.
- **The single log is single-writer and grows forever.** Two devices appending concurrently produce a display-flagged fork, not a resolution; the spec's answer is honest UI, not CRDTs. A decade of family posting fits easily in the non-goals' shadow, but log compaction is an open problem I have not solved.
- **Deletion is best-effort against a hostile host**, as A3 admits.
- **Plain feed readers and bridges trust the hub**, because RSS verifies nothing. The signed log is the record; the projections are cosmetics. Strangers get web-grade trust, and that is the deal.
- **TOFU on name-first contact.** A hostile hub can hand a *new* follower a different key for the same displayed name. Links that embed keyids, QR pairings, and fingerprints are the mitigation; the residual is real.
- **Discovery is human.** Moves propagate by shared links and gossip. Strangers lose you at domain death and re-find you socially. No search, no global directory — the price of "no dependencies" paid in convenience.
- **Availability is not defended by design**, only by leaving, mirroring, and gossip. A hostile hub can make your life there quiet and slow.
- **Spam surface.** Inboxes accept pings from anyone; they must be rate-limited, and apps must only auto-fetch feeds of people they follow (pings are hints, never commands).
- **Least sure, ranked:** HCTR as mandatory cipher; the 1-of-N guardian default; whether out-of-band pairing is acceptable enough to families to survive contact with reality; multi-device fork UX.

## 9. If forced to halve it

The floor's load-bearing core — envelopes + chain, circles + pairing + tagless boxes, local mirror + move + guardians + rotation pinning — survives any halving. Cut, in order:

1. **Inbox pings** — pure polling already works; timeliness degrades.
2. **Witness items** — moves then propagate only by shared links; contested departures lose their notarization.
3. **Reactions** — keep replies; a reaction is a reply with one emoji in it anyway.
4. **The hub directory and Atom** — links and JSON Feed only.
5. **DM as a distinct inner type** — a circle of two already is one.

What I would refuse to cut, even at halving: the seq/prev chain (rotation security and stale detection live there), the tagless box (audience hiding lives there), and the guardian wrap (scenario 2 lives there). Everything else in this document is convenience wrapped around those three, which is, in the end, the argument for the whole design: four assurances, three mechanisms, five primitives, and a hub too dumb to lie convincingly.

<details><summary>Model reasoning trace (174931 chars) — kept because rejected alternatives often live here</summary>

```
Let me think carefully about this design brief. This is a protocol design exercise with a very specific adversarial center: the hostile hub operator who is *inside the family* — entitled to see family-only content, holding legitimate credentials, controlling storage, serving, inbound message paths, and the exit.

Let me re-read the constraints:

1. No dependencies: Ed25519, SHA-256, HTTP, JSON, base64 only. No canonical JSON, no JOSE, no git, no blockchain, no DHT, no global registry.
2. Easy to implement in a weekend from the text alone.
3. Interop with RSS/Atom/JSON Feed and fediverse/Bluesky with nothing extra built.
4. Minimal.

The four floor assurances:

1. Host cannot speak for you — nothing it serves verifies unless you signed it, key was never the host's.
2. Host cannot read what wasn't meant for it — content addressed to chosen people is unreadable by anyone including the host.
3. Host cannot keep you — leave at any moment with identity and everything, without permission, because key and copy always on your device.
4. People on other hubs are first-class — cross-hub sharing/replies/reactions to family-only content with no access-control agreement between hubs.

Non-goals: human-readable wire bytes; continuity of a stranger's view across total key loss; millions of items; global consensus; anonymity beyond hiding *who an encrypted message is for* (interesting — so hiding the recipient is a goal, some minimal metadata privacy).

Scenarios: divorce, grandma onboarding (never shown a key, recovery via daughter), two hubs one thread, domain loss (identity unchanged), big lazy hub (hostile at scale, flat per-identity cost), weekend implementation, stranger via feed reader/Mastodon bridge and re-meeting after key loss.

Wait — non-goal says "continuity of a stranger's view of you across total key loss" is a non-goal, but scenario 7 says "After the author's key loss, they re-meet the author." So the stranger doesn't get continuity — they just re-meet. That's consistent: the stranger's view doesn't carry over seamlessly; the author can re-establish contact and demonstrate... something. Re-meeting is weaker than continuity.

Let me think about the core architecture from first principles.

**What is a person?**

The identity primitive. Options:
- A domain name (host = identity). Rejected: domain loss scenario breaks it; the divorce scenario breaks it (the ex controls the domain/host).
- A keypair (Ed25519). The person IS the key. Name is derived/attributed.
- A did:key style thing — did:key is literally multibase-encoded Ed25519 public key. But we can't depend on the DID spec; we just define our own simple format. Actually did:key for Ed25519 is simple: "did:key:z6Mk..." base58btc. But base58 isn't in the allowed list (base64 is). So we define our own: the person is their Ed25519 public key, encoded in base64url.

Key insight: identity must be the key because the key is the only thing that (a) is on the person's device, (b) survives hub moves, (c) can authenticate content. Everything else — names, domains — is a pointer/attribute.

But keys are hostile to grandmas. So: identity is the key; the *handle* is a human-facing attribute; and the *address* — how you find the person — is a discovery document at a URL.

So we have three layers:
- **Key** (identity): Ed25519 public key, base64url. This is the person. Fingerprint: SHA-256 of it for display.
- **Name/handle**: a display string chosen by the person, signed by them, so hubs can't rename them.
- **Location**: one or more URLs where their stuff lives. Signed too.

This is basically the "key as identity, signed profile pointing at current location" model — what did:key + did documents do, what Fritter/Secure Scuttlebutt did (feed IDs are keys), what cabal does, and what ATProto does with did:plc (but did:plc has a registry — rejected; did:web is domain-based — rejected for domain-loss scenario... though actually let me think about that).

Alternative: did:web. Identity = domain. But then the divorce scenario: her identity is her subdomain on the hostile hub? Her ex controls DNS and serving. did:web documents are fetched over HTTPS from the domain — the hostile operator controls that. He could serve an old DID doc, refuse to serve the new one. She can't move because identity is bound to the domain he controls. Rejected.

Alternative: webfinger + actor URL (ActivityPub). Identity = https URL on the hub. Same problem: the host owns the identity. The divorce scenario kills it. Rejected.

Alternative: keybase-style proofs binding a key to social accounts. Overkill, needs external services.

So: **identity = Ed25519 key, self-certifying.** The person's canonical identifier is the public key itself. Everything else is signed claims.

Now, how do you resolve a person to a current location? You need some indirection. Options:

- The person publishes a signed "location document" at their current hub. But how does a follower who only knows the key find that? They need a starting point: the last-known hub URL. Following = recording (key, hub URL). When the hub goes away, you need a fallback.

- Keybase-style witnesses: other people vouch for where the person is. This is where the "no global registry" constraint bites. But we can have a *decentralized gossip* layer: when you move, you sign a "moved to" statement; people who see it relay it. Followers' apps poll the old hub; if the old hub is hostile, it won't serve the move notice — so followers won't learn the new location automatically. Hmm. But scenario 4 says "existing readers find them." The domain goes (unaffordable) — that's not a hostile operator, just a dead domain. In the divorce, the hostile ex will absolutely not serve her move notice.

So there must be a way to find someone knowing only their key, without a global registry. Options:

a) **Out-of-band fallback**: a second URL ("backup locator") the person controls — e.g., their own domain, a static host, or a "guardian." Grandma's recovery scenario introduces "call your daughter" — the daughter is a *recovery guardian*. That suggests a social recovery scheme.

b) **DHT or blockchain** — explicitly rejected by the brief.

c) **Mutual gossip**: every hub serves a "witness" endpoint... but no access-control agreement between hubs, and hubs are lazy.

Let me think about what's actually needed. The four floor items don't include "followers automatically find you after a hostile seizure." Assurance 3 says: you can leave with your identity and everything you wrote, without asking permission. It doesn't say followers automatically follow. But scenario 1 says: "After she leaves, her mother's app follows her with one tap." One tap! So the mother's app needs to learn the new location with one tap. The tap could be: scanning a QR code, opening a link the daughter sends via any channel (the mother is inside the family; the hostile ex can't stop the daughter from texting her mom a link). So the move notice can be delivered over any channel — SMS, in person. The link contains the key (which the mother's app already knows — it verifies it matches the person she knows) plus the new location, signed. One tap on a link: `kin://relocate?key=...&at=https://new.example/...` or just a URL to the new hub's introduction document, which the app fetches, verifies the signature against the known key, and updates.

That works and needs no global registry. The security comes from the key: a signed relocation from the known key is authoritative; the hostile ex can't forge it. He can withhold it (mother wouldn't know to look), but he can't fabricate a false one. And he can't stop her texting mom.

Also for public strangers (scenario 7, scenario 4 "existing readers find them"): the person's feed URL changes. For a stranger in a feed reader, they follow a URL; when the domain dies, the feed dies. The design should include: the signed profile contains previous locations / an alias chain, and the feed itself advertises the key, so anyone who re-finds the author by any means can verify. And there's a trick: put the key ID in the feed, and when the author reappears at a new URL, they sign a statement containing the old feed URL, so a reader who finds the new feed can check continuity. But non-goal: continuity of a stranger's view across total key loss. So after total key loss, the stranger re-meets them as a new identity — that's acceptable. Re-meeting is fine.

OK here's the shape I'm converging to. Let me name the protocol. Something short. "Hearth"? Family hearth. "Kin"? The brief says families. Let me call it... the artifacts need names. Let me think about artifacts first, name later. Actually let me name it something neutral: I'll call it **Ledger**? No — no ledger. **Kith**? "Kith and kin." Or "Hearth" is nice — hub = hearth of the home. Let me go with **Hearth**. Hmm, or "Attest"? Let me just pick Hearth — warm, family, and each hub is a hearth. Actually "hearth" also connotes the fire you can carry coals from (leaving with your content). Fine: **Hearth**.

**Artifacts:**

Let me enumerate what a person has:

1. **Identity key** (Ed25519) on the device. This is the person.
2. **Profile document**: signed JSON: { key, display name, bio, avatar pointer, current hub base URL, sequence/timestamp, prev-hash?, relocation chain }. Published at the hub, discoverable at `https://hub/.well-known/hearth/<keyfp>` or similar.
3. **Feed**: ordered sequence of items, each signed. The feed needs tamper-evidence: the hostile hub can drop items, reorder, or serve old content as new. Scenario 1: "his frozen copy of her old content reads as stale rather than as her." So each item has a timestamp and signature; the feed is a hash chain (each item's signature covers a sequence number and/or the hash of the previous item), so reordering, splicing, and backdating are detectable. Backdating specifically: the hostile host writes a new item and claims it was written in 2019. If items are chained, inserting into the middle breaks the chain. But he could fork the chain from item N and rewrite history after N — readers who saw the real chain prefix up to N+1 will notice divergence. Readers who never saw beyond N can't tell. That's the honest limit: signed timestamps prove "not before" only if you have a trusted timestamp; without one, you can only prove consistency. Hmm — but actually, each signature covers the item's own claimed date; the hub cannot forge her signature on a new item at all. Backdating *her* items is impossible unless he has her key. What he can do is serve a *truncated* old feed as if current. "Reads as stale": items carry dates and the chain head has a date; a frozen copy is detectably frozen (no items after date X, and the reader knows the feed's latest chain head she saw). Also the profile can point at the feed head. The mechanism: **each item's signature includes the hash of the previous item's header (a hash chain), and the profile document names the current chain head**. Hmm, that couples profile updates to every post — annoying. Alternative: items include monotonically increasing sequence numbers and timestamps, and readers remember the highest seq they've seen; serving an older head is detectable as stale (regression). Forking history is detectable by anyone who saw the true prefix. This is the classic causal-history approach (Lamport-ish). Good enough, and cheap: no Merkle trees, just prev-hash in the signed payload.

Wait — do I want per-item signatures or one signed feed file? Per-item: each post is a signed JSON envelope; the hub stores/serves them; readers verify each independently. Chain: envelope includes `seq` and `prev` (hash of the previous envelope's ID, where ID = SHA-256 of the envelope bytes... careful: envelope includes signature; prev should hash the previous envelope's ID which is the hash of its signed content + signature; fine, just define: item ID = base64url(SHA-256(canonical serialization of envelope))). No canonical JSON allowed! That's the rub. "No JSON canonicalizer." Hmm.

How do you hash JSON without canonicalization? Options:
- Sign/verify over the exact bytes the server serves, and hash those bytes. But then re-serialization (by a different implementation) breaks the hash. If the envelope is served as-is (the signed bytes are the stored bytes), the hash is over bytes as served. The publisher produces the envelope once; the hub stores opaque bytes; readers hash the bytes they got. That works as long as nobody needs to re-serialize. But two implementations exchanging envelopes (e.g., relaying between hubs, or a reader re-serving) just relay opaque bytes. So: **the signed unit is a byte string; the signature is computed over those exact bytes; JSON is a convention for humans, but the security is over bytes.** But then how does the reader parse the envelope? The envelope is JSON: `{"body": {...}, "sig": "...", ...}` — but the signature must cover the whole envelope except the sig field... which requires canonical re-serialization to verify. Ugh. Classic problem.

Solutions:
(a) Detached signature over a payload string: the envelope is `{"payload": "<base64 of signed bytes>", "sig": "<base64>"}` — i.e., sign the serialized content bytes and embed them as an opaque base64 blob. The payload bytes are the canonical form: the producer serializes once. Ugly for humans but the brief says "human-readable wire bytes" is a non-goal! "Nobody reads them." So this is fine. But it's double-encoded JSON (JSON-in-base64-in-JSON), which is inelegant and adds size. Hmm.

(b) Define a tiny canonical form ourselves — but that's "a JSON canonicalizer" dependency... unless the canonical form is trivially specified in half a page: e.g., "the payload is serialized as JSON with no whitespace, keys in the order listed in the schema" — a fixed key order per object type. Implementing "serialize with these keys in this order, no whitespace" from the schema is doable in a weekend. Many protocols do this (e.g., Matrix's canonical JSON is famously a pain; but fixed-key-order is much simpler). The risk: numbers. Floats and big ints vary across languages. Mitigation: all numbers in signed payloads are integers (seq, timestamps) or strings. That's a spec rule: "signed payloads contain no floating-point numbers." Then fixed-key-order + no-whitespace + UTF-8 + no escapes beyond the mandatory (or: escape only `"` `\` and control chars per JSON spec — but different languages escape `/` differently... rule: escape exactly `"` and `\` and U+0000–001F using \uXXXX except \b\f\n\r\t which... ugh, that's getting into canonicalization weeds).

Honest assessment: (a) is robust and dumb; (b) is prettier but each rule is a foot-gun for the weekend implementer. The brief's priorities: no dependencies (#1) and easy (#2). Base64-blob-in-JSON (a) requires zero canonicalization: signature covers exactly the bytes in the payload field. Verification: base64-decode, check signature over decoded bytes, then JSON-parse decoded bytes for interpretation. Two JSON parses — fine. Size cost ~33% on the payload — acceptable for text posts and metadata; for photos, they're referenced by hash, not embedded.

Hmm wait, but there's a hybrid: make the signed thing not-JSON at all. Define the signing input as a simple line-based record (like SSH's "string" encoding or DNSSEC-ish). E.g., sign over the concatenation of length-prefixed fields. But then implementers must get length-prefixing right... base64 blob is simpler to debug honestly? Hmm. Actually here's an even simpler approach used by PASETO-ish designs: sign the exact bytes of a file. For a post: the post body is just... bytes (text). The envelope could be: the signed object is built as `header || "." || body` where header is fixed-format. Nah.

Let me reconsider. Another approach: **sign the JSON bytes as produced by the author's app; the envelope carries those exact bytes plus signature; the hub serves the envelope file as opaque bytes; the reader parses JSON, takes the exact string of the `payload` field... ** no — JSON strings get unescaped when parsed; re-serializing may differ. The payload-as-base64 trick avoids this because base64 strings are ASCII with no escapes; the escaped/unescaped distinction vanishes. Yes: base64url has no characters that JSON ever escapes (base64url alphabet: A–Z a–z 0–9 - _ ; all safe). So `{"p":"<b64>","s":"<b64>"}` — parse JSON, decode p, verify s over p bytes, parse p as JSON to read fields. Deterministic, no canonicalization, works in every stdlib. 

I'll go with (a): **signed payloads are byte strings (base64url-encoded in transit), signed with Ed25519 over the exact decoded bytes; JSON inside is advisory-structured but security-critical fields are simple types.** And to keep it humane, the inner JSON uses short fixed field names. Actually — wait. Let me reconsider once more, because double-encoded JSON will draw groans. Alternative: sign only a **digest structure**: the envelope is plain readable JSON `{"type":"post","seq":41,"prev":"...","body":"...","ts":1700000000,"sig":"..."}` where sig = Ed25519 over SHA-256 of... no, still needs canonical form to compute the hash input.

Alternative that works: sig over the envelope bytes with the `sig` field's value blanked... requires canonical re-serialization again. No.

What about: the signature covers a **field-list encoding**: the app constructs the signing input by concatenating the values of specified fields in specified order, each prefixed by its byte length (SSH-style). Fields are strings/integers. This is ~15 lines of code in any language, fully specified in the doc, no JSON canonicalization (the JSON is just a carrier; the signing input is derived from parsed values, so re-serialization doesn't matter — anyone can reconstruct the signing input from parsed JSON deterministically because it uses *values*, not serialization). Numbers as decimal strings. That's actually clean! `sig_input = len("41"):"41" || len("..."):...` — length-prefixed, unambiguous, no canonical JSON needed. Both sides derive it from the parsed object. This is the classic "sign a canonical sequence of typed fields, not the JSON" approach.

Compare: base64-blob (a) vs length-prefixed field encoding (c).
- (a): zero ambiguity, signature over literal stored bytes; cost: nested encoding, envelope file is opaque-ish; any relay must keep payload bytes verbatim (fine); readers must not re-serialize before verifying (they don't).
- (c): readable JSON at the top level; signing input reconstruction is spec'd; risk: implementer gets length-prefixing wrong (off-by-one, big-endian lengths, string encoding) — but it's 15 lines with test vectors.

The brief says human-readable wire bytes is a non-goal — that tilts to (a). But debugging friendliness and the "weekend implementer" tilt to... both are weekend-able. Hmm. (a) has a subtle virtue: the *exact bytes* are the signed thing, so there's no possible divergence between what was signed and what's displayed; display is derived from the payload after verification. And it makes relay trivially safe. Also (a) means the signature can be checked *before* parsing the payload, which is nice for untrusted input. I'll choose (a) but with a twist to reduce double-JSON pain: the **outer** envelope is tiny (`v`, `payload`, `sig`), and everything meaningful is inner. And I'll allow the envelope to be served as `Content-Type: application/hearth+json`... fine.

Hmm, actually, wait. Let me reconsider (c) once more, because there's a hybrid that's very clean: make the *signing input* the base64-decoded... no. Decision: (a). Move on. I'll note the rejected alternative explicitly (canonical JSON with fixed key order — rejected because number/string escaping edge cases across stdlibs create interop bugs that are invisible until they bite).

Actually, hold on, one more consideration for (a): item IDs. Item ID = SHA-256(payload bytes) — the `payload` before decoding. `prev` links = these IDs. Fine.

**Now the core data model.**

Person's artifacts:

1. **Key**: Ed25519 keypair. Public key `K`. Identifier: `@` + base64url(K)? Or a fingerprint. Full key is only 32 bytes → base64url is 43 chars. That's fine to use directly as the ID. Display fingerprint: `@` + first 8 hex of SHA-256(K) for humans (like "you're chatting with @a1b2c3d4 — verify it matches").

2. **Person Document (the "card")**: signed payload: `{type:"card", key, name, bio, hub, updated, prev_card_hash, relocations: [...]}`. Served at the hub under `/.well-known/hearth/<keyid>.json` maybe. This is what you fetch on first contact and on poll (HEAD/ETag or fetch — cheap).

Wait — what about the feed? Let me define:

3. **Feed**: list of **items**. Item types: post (text, optional media pointers), photo (media + caption), reply (post + `in-reply-to` = item ID + optionally a quote of the parent for display), reaction (emoji + target item ID), and **control items**: relocation (new hub URL), key-change (new key, signed by old), grant/revoke (audience management), maybe "tombstone" (delete). All signed by the person, all in the same chain (one chain per person — the "log"). This is SSB-like: a single append-only log per identity, all feed and control events in one chain. That unifies everything: the chain is the person's history; moving hubs = appending a relocation item and copying the log to a new hub; readers follow the chain.

Chain details: each item payload includes `seq` (monotonic int starting 1) and `prev` (item ID of seq-1; empty for seq 1). Item ID = base64url(SHA-256(payload-bytes)). Signature inside... wait, signature must cover the payload which includes prev; the envelope is (payload, sig). Yes.

Feed fetching: reader asks hub for the person's log. Options: `GET /hearth/<keyid>/log?since=<seq>` returning envelopes. Or a JSON index + per-item files. Simplest: one endpoint returning an array of envelopes (or newline-delimited). Plus `GET /hearth/<keyid>/card` for the signed card. Media: content-addressed blobs `GET /hearth/<keyid>/blob/<sha256>`, referenced from items by hash. Content-addressing means the hub can't tamper with photos (reader verifies hash), and it lets copies dedupe. Item payloads reference media by `sha256` + size + maybe MIME.

Audience encryption (assurance 2) — the interesting part. Let me think hard.

**The encryption construction.**

Requirement: content addressed to chosen people is unreadable by anyone else including the host. Recipients must be addressed *without publishing the audience* (from §6.6: "how recipients are addressed without publishing the audience" — and the non-goal says anonymity "beyond hiding who an encrypted message is for" — i.e., hiding the recipient of an encrypted message IS in scope... wait, re-read: "Anonymity or traffic-analysis resistance beyond hiding who an encrypted message is for." Parse: the non-goal is anonymity/TA-resistance *except* that hiding who an encrypted message is for IS a goal. So: we must hide recipient identities; we need not hide anything else (e.g., timing, sizes).

Constraint: only Ed25519 and SHA-256 from stdlib. **No X25519!** Hmm, is X25519 in "a language's standard library" where Ed25519 is? The brief says "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." That list is the allowed palette. X25519 is not listed. But X25519 is... hmm. In many stdlibs (Go's crypto/ecdh has X25519; Rust's... no; Python's... no). The brief explicitly enumerates. I should treat the palette as: Ed25519, SHA-256, HTTP, JSON, base64. Can I do key agreement with only Ed25519? Yes — there's a standard trick: Ed25519 keys can be converted to X25519 keys (multiply by the cofactor, clamp, map curve points; the "cryptography from nothing" trick). Actually, converting an Ed25519 keypair to X25519 is straightforward math on edwards25519 points: the public key is a point; you can convert it to Montgomery form (u = (1+y)/(1-y)), and the private key: take the scalar, clamp it, and use it as an X25519 scalar. This is well-defined (used by Signal's XEdDSA, by libsodium's crypto_sign_ed25519_pk_to_curve25519). But implementing curve conversion from scratch in a weekend without a curve library? That's real math — cofactor handling, field arithmetic. "Implementable from a language's standard library: Ed25519" implies the stdlib exposes sign/verify, not raw curve ops. So no.

Alternative: **do key agreement with Ed25519 itself?** There's no standard DH over Ed25519 in stdlib APIs. You could do a签名-based key transport instead of key agreement! Key transport: the sender generates a random symmetric key, encrypts the content (how? we have no AES either!), and wraps the key to each recipient... but wrapping requires encryption, and we have no cipher in the palette!

Hold on. What can we encrypt with, given only SHA-256? **SHA-256 can be used as a stream cipher via counter mode (hash-based stream cipher): keystream = SHA-256(key || counter || nonce)**. That's straightforward and from-the-text implementable. It's not AES, but for this adversary model it's... hmm, is hash-counter-mode encryption sound? SHA-256 in counter mode as a PRG is a standard assumption (that's what HKDF-style expand does; it's how RC-like constructions... it's basically "Hash-CTR"). The security relies on SHA-256 behaving as a PRF under a secret key — that's the standard PRF assumption, widely believed, and this exact construction (hash as stream cipher) has been used in various systems (e.g., older "SHACAL-ish" usages, and Hash-DRBG). It's slow-ish (SHA-256 per 32 bytes → for a 5KB post, 160 hashes — trivial; for a 5MB photo, 160K hashes ≈ 25M bytes hashed — milliseconds. Fine.). I'm fairly comfortable with Hash-CTR given the constraint, with the caveat flagged: it's a nonstandard cipher construction; the conservative alternative is "require an AEAD too" which breaks priority #1. Actually, let me think again — maybe I should just allow an explicit note: "if your stdlib has ChaCha20-Poly1305 or AES-GCM, use it; Hash-CTR is the floor." But interop requires ONE mandatory algorithm. Mandatory: Hash-CTR (call it "HCTR"?) with SHA-256. Hmm, wait — should I worry about malleability? CTR mode without a MAC is malleable! The hub could flip bits in the ciphertext. Do we need integrity? The item is signed by the author... but the signature covers the *ciphertext*? If the envelope's signature covers the payload containing ciphertext, then tampering breaks the signature — integrity is provided by the author's Ed25519 signature over the ciphertext. But careful: the signature is over the payload bytes which include the ciphertext; any bit-flip by the hub breaks sig verification. So malleability is handled: **authenticate-then-encrypt... rather, sign-over-ciphertext**. Recipients verify the signature first (public), then decrypt. The hub cannot modify ciphertext without breaking the signature. And the hub can't decrypt. Good: no MAC needed beyond the signature. But note: the signature is public-key; anyone can verify; that's fine.

Now key transport: how does the recipient get the symmetric key? Sender generates random content key `ck`. For each recipient, wrap `ck`. Wrapping without a cipher... use SHA-256-based key derivation from a shared secret. Shared secret needs DH. Without X25519... options:

Option A: **Recipient public encryption keys that are Ed25519 keys, and use a signature-based key exchange?** There's no clean "encrypt to an Ed25519 key" from sign/verify primitives alone. Hmm... Can we derive a shared secret using two Ed25519 signature operations? There are exotic constructions (e.g., "signcryption from signatures" via Fiat-Shamir), but they're not weekend-implementable nor standard. No.

Option B: **Pre-shared per-recipient secrets established via an out-of-band pairing.** When you add someone to your audience, you and they... but how do two people establish a shared secret over an untrusted hub with only signatures? They can do a Diffie-Hellman... with what? Signatures don't give DH.

Wait — actually, hmm, can we do DH with just hash and Ed25519 sign? There's "hash-based key agreement"? No. There's the trick: each side generates a random value, signs it, publishes; shared secret = hash(A's random || B's random) — but then anyone who sees both randoms (they're published on the hub!) computes the secret. Unless they're exchanged privately... but we have no private channel yet. Chicken-and-egg. Unless the pairing happens in person / via QR code (scenario: family). Grandma onboarding: her daughter sets her up — in person or via a call. A QR code or a short pairing string delivered over any channel (even through the hostile hub, if it's a one-time code that must be combined with something else? If the hostile hub sees the full pairing string, he's in. So pairing codes must travel out-of-band: in person, phone call. For families this is plausible — but cross-hub scenario 3: A on a.example and B on family.example share family-only content "with no access-control configuration on either hub." Does A need to pair with B out-of-band? They're relatives; they can exchange a pairing code by phone once. Hmm, but is that "configuration"? It's user-level pairing, not hub-level config. The floor says "no access-control agreement between the hubs" — pairing between people is not an agreement between hubs. I think per-person pairing is acceptable and even desirable (it's how humans onboard anyway).

Option C: **Use Ed25519 keys but treat the verification key as an X25519 key via conversion, and spec the conversion in 10 lines?** The conversion ed25519→curve25519: for public keys: decompress Edwards point, compute u = (1+y)/(1-y) mod p. Requires field arithmetic mod 2^255-19 — NOT stdlib. Weekend implementer without a curve library can't do this. Rejected... unless the *protocol* mandates that each person also generates an X25519 keypair... but generating an X25519 keypair also needs curve ops (scalar * basepoint). Yeah no.

Hmm wait, actually — hold on. Let me reconsider. Is there a key-agreement scheme implementable with only *hash* and *signature* interfaces? 

Yes! **Hash-based key transport via signatures on the receiving side doesn't exist, but there's the "DH from signatures" no-go... ** let me think differently. 

**Option D: The sender encrypts to recipients using a key derived from a secret the recipient can compute but the hub cannot: e.g., a secret established when the recipient *followed* the author.** Follower-subscription model: to receive encrypted content, you present a "subscription key." Hmm: Each audience member has an Ed25519 key already (identity). What if the author, when admitting someone to the audience, generates a random group key `gk`, and *sends it to them*... encrypted how? Chicken-egg again — we need at least one bootstrapping encrypted channel. Over-the-phone reading of a code? "Read this 8-word code to your granddaughter" — actually for family pairing that's... viable but clunky for 10,000-person hubs (scenario 5: commercial hub with 10k customers — pairing with each reader by phone?? No — on a commercial hub, you add audience members by... hmm).

Wait, scenario 5: 10k people on one hub, hostile operator, per-identity cost flat. Content-addressed-to-chosen-people. On a commercial hub, people still mostly interact with their own family groups. Adding a family member = pairing once. That's like adding a contact in Signal. Actually acceptable! Signal's UX: you verify safety numbers optionally; you add contacts by phone number. Here: to read someone's family-only posts, they must add you — you exchange a pairing code once (QR, link, or 6-digit via call). Hmm, but can the link/QR travel through the hostile hub? If the ex sees the QR, he gets the group key... unless the pairing code is only *half* the secret and the other half is the recipient's key... 

Let me think about the "pairing" more carefully. Goal: establish a shared secret between author A and reader B over a channel controlled by adversary H (the hub), with only signatures public. Classic solution: **signed Diffie-Hellman**. Without DH primitives we can't. Second classic: **password-authenticated key exchange** — no. Third: **trust on first use with out-of-band verification** — doesn't create secrecy, only authentication.

OK here's another thought — what about using **Ed25519 signature generation as a deterministic PRF to derive per-recipient secrets**? Like: A encrypts to B using key = SHA-256(B's public key || A's private key)? A's private key is an Ed25519 scalar... but stdlib Ed25519 sign takes (priv, msg) and returns sig; it may not expose the raw scalar. Hmm, but here's a trick: A can compute SHA-256("wrap" || sk_A || pk_B)?? sk_A isn't exposed by the sign API. But A can *use signing itself* as the PRF: sig = Sign(sk_A, "derive:" || pk_B). Then the wrap key = SHA-256(sig || pk_B)? Anyone can verify sig with pk_A and the message "derive:pk_B" — so anyone can compute SHA-256(sig||pk_B) — public. No good, signatures are public.

What about: B derives from *its own* signature? B signs "derive: pk_A" → anyone can verify... same problem.

So pure sign/verify APIs genuinely can't do key agreement (this is expected — signatures are public operations). Therefore the protocol MUST introduce some additional secret material. The clean answer within the palette: **the protocol includes a "box keypair" that is... ** wait, what asymmetric encryption can we build from SHA-256 alone? None.

Hmm, hold on, wait. Let me re-read the brief: "Implementable from a language's standard library: Ed25519, SHA-256, HTTP, JSON, base64." Maybe the intended reading is "things like Ed25519, SHA-256, HTTP, JSON, base64" — i.e., a palette of this *level* of primitivity, all commonly in stdlibs. Is X25519 commonly in stdlibs? Go: yes (crypto/ecdh). Python: no (cryptography package, not stdlib). Node: crypto has X25519 via KeyObject/diffieHellman — yes, actually Node's crypto supports X25519 ECDH. Java (17+): XDH (X25519) is in JCA — yes! Java supports X25519 in the standard library (java.security XEC). Rust: no stdlib crypto at all (so the premise already assumes a crate or RustCrypto... hmm, Rust has no Ed25519 in std either! So "standard library" can't literally mean std for Rust. The brief's palette is aspirational: primitives you can get anywhere trivially.)

Given Java and Go and Node include X25519 but Python doesn't (need `cryptography` — though PyNaCl/cryptography are ubiquitous)... The brief explicitly lists the palette and X25519 isn't on it. I should respect the listed palette as the hard constraint, but I could note X25519 as the obvious upgrade. OR — find a construction that needs only Ed25519 sign/verify.

Actually wait! There IS a way to get key agreement from Ed25519 sign/verify alone, kind of: **the sender can encrypt to the recipient if the sender knows a secret that the recipient can be challenged to prove**... no, that's not how encryption works.

Let me flip it: **who needs to know the content key?** The author and the recipients. What if recipients don't get the key from the author, but *derive* it from a secret they already share with the author? In families, there IS a shared secret channel: the pairing moment. So: **audience keys are established at pairing time, out-of-band, and rotated by re-pairing.** The "group key" model: author picks a symmetric group key per audience ("family" circle), delivers it to each member via a pairing code exchanged out-of-band (in person, phone, video call). Encrypted posts = Hash-CTR with the circle key. Recipients are hidden: the ciphertext carries only a "circle ID" = SHA-256(circle key)? Hmm — the hub sees circle IDs but not members. 

But wait: circle key shared among all members means any member can decrypt — fine, members are the audience (the ex-spouse IS a family member — the adversary is inside the audience! §2: "No confidentiality mechanism defeats someone who is inside the audience."). So the adversary-in-the-family will HAVE the circle key. The point of encryption here is *only* to exclude the hub. So a shared group key is perfectly aligned: everyone in the family shares it; the hub doesn't have it. Confidentiality within the family is explicitly NOT a goal ("No confidentiality mechanism defeats someone who is inside the audience. The question is what remains true anyway.").

Oh wait, this changes everything. The encryption requirement is exactly: **keep the hub out, let the family in.** Not per-recipient granularity necessarily... but assurance 2 says "Content addressed to chosen people is unreadable by anyone else, the host included." "Chosen people" — the author chooses the audience. A group key for a circle gives that (the circle is the chosen people), as long as membership changes re-key the circle. If grandma leaks the circle key to the hostile hub (she's compromised — the hub operator is her son-in-law and could obtain the key from a family member's device)... hmm, the adversary "holding legitimate credentials" — the ex-spouse has an account on the hub and is family, so he's *entitled* to see family-only content anyway. So even if he obtains the family circle key legitimately (as a family member), that's within the threat model's acceptance. What he must NOT get: content addressed to circles he's not in. E.g., after the divorce, she creates a new circle excluding him; he must not read it even though he operates the hub. With group keys: she creates a new circle key, distributes to the new members... how? Out-of-band pairing again (she's excluding him, so she can call her mom). 

But here's the rub: **group key distribution at scale** — the 10k-user hub. Each user pairs with each of their readers out-of-band. For family-scale audiences (dozens), fine. The brief says "scale across many identities... not to millions of items per person" — audience sizes are small. OK.

But hmm, out-of-band pairing for EVERY audience member is operationally heavy, and "grandma onboards... is back by calling her daughter" — recovery is by calling the daughter, so the design already accepts human-mediated trust moments. Family pairing via QR/in-person/phone is consistent.

But wait, can we do better — can the *hub* help distribute keys while remaining excluded? The author could encrypt the circle key to each member and post those wrapped keys to the hub — wrapping needs per-member public-key encryption... which needs DH... which we don't have. UNLESS: per-member symmetric wrapping keys established at follow time via... same chicken-egg. OK so one more idea:

**Use Ed25519 signatures to authenticate a key exchange where the secrets are random and published — impossible.** Right, confirmed: no DH without curve ops. So the protocol has exactly two options within the palette:
1. Symmetric group keys, bootstrapped out-of-band (pairing codes), OR
2. Add X25519 to the palette (violating the letter of priority #1, arguably not its spirit — flag it).

Hmm, wait — there's a third: **derandomized shared secrets via identity + a one-time in-person exchange**... that's the same as 1.

And a fourth, sneaky one: **the content key is derived from the item itself and a secret shared between author and recipients that they established by ANY channel, including through the hub, if protected by... ** no.

Fifth: **Sealed boxes via "encrypt-to-future-verification"**? No.

Hmm, hold on — actually, what about this: each person, at onboarding, generates TWO keypairs: an identity Ed25519 key and a "secret-box" symmetric key? And publishes a *commitment* to the box key? Then to encrypt to B, A needs to know B's box key — only B knows it. No.

What about **hash-based public-key encryption (e.g., from Lamport signatures)?** Lamport OTS uses only hash functions! Can we build PKE from one-way functions? Yes — there are constructions of public-key encryption from trapdoor predicates... from any one-way function you get PRGs and symmetric crypto, but PKE from OWF is a major open problem (would imply... it's believed impossible-ish; PKE needs structure like factoring/discrete log/lattices). Hash signatures work because signing is a different primitive. So: no hash-only PKE. Confirmed.

Therefore: **symmetric group ("circle") keys with out-of-band pairing is the palette-compliant answer.** And I should argue it's actually the RIGHT answer for this adversary, not just the palette-compliant one:

- The adversary is inside the audience. Per-recipient keying (Signal-style) buys nothing against him — he's a recipient. What per-recipient keying buys is *excluding specific people from specific content* (fine-grained circles) and *hub exclusion*. Group keys per circle deliver both: circles exclude non-members (including the hub), and the ex is excluded from post-divorce circles.
- Simplicity: one symmetric key, Hash-CTR, done. No ratchets, no double ratchets, no X3DH. Weekend-implementable, genuinely.
- The failure mode is honest: if a circle key leaks (member device compromise, member betrayal), all that circle's content past and future (until rotation) is exposed to the leaker — but the leaker was... hmm, if a *member* leaks to the *hub operator*, then the hub can read the circle even though it's not a member. Failure mode named: **circle keys leaked by members expose the circle to outsiders.** Mitigation: rotation (new circle key, re-pair out-of-band); detection is hard. Also: messages to a circle could carry per-item keys derived as H(circle_key || item_id)? That doesn't help if circle_key leaks. Forward secrecy within a group without DH is impossible. Flag it: **no forward secrecy**; a leaked circle key decrypts all archived ciphertexts of that circle. For the divorce scenario: she rotates/excludes by making a new circle and the ex-hub keeps only ciphertexts it can't read — unless he already has the key from when he was a member (then he can read the *archive* of old family content he was entitled to — acceptable per threat model! "No confidentiality mechanism defeats someone who is inside the audience" — he was inside the family audience; old family posts readable by him = accepted). What he can't read: anything posted after she moved him out of the circle, posted on HIS hub? Wait — in the divorce scenario her content lives on his hub while she's still there. She posts to the "family minus him" circle while hosted by him: he must not read those. With circle keys: she creates circle "inner" with key K_inner, pairs with mom/sister out-of-band (phone/in-person — he can't intercept), posts ciphertexts to her feed on his hub. He stores ciphertexts, can't decrypt (doesn't have K_inner — unless a member leaks). When she leaves, the archive of "inner" ciphertexts goes with her; his frozen copy remains unreadable. 

Also private **messages** (DMs): same mechanism — a circle of two. Pairing: the two people exchange a pairing code once (in person or via call). The hostile hub relays but can't read. Reply/threads cross-hub with no hub config: B replies to A's encrypted post — B's reply is addressed to circle... B must encrypt the reply to a circle that includes A. How does B address A? B needs a circle containing A with a key A knows. Pairing is bidirectional? At pairing time, A and B exchange circle keys both ways (A gives B her circle key; B gives A his). So each pairing establishes two shared secrets (or one shared secret used for both directions — hmm, careful: if A and B share one secret S, then A's circle "B" and B's circle "A" both derive from S. If A later adds C to her circle-with-B... then C gets a key derived from... if the circle key is S itself and C is added, C learns S and can read B's messages to A! So circles must have independent keys, and pairings should exchange *personal channel keys* distinct from circle keys. Simplest rule: **each pairing = the two parties exchange one shared secret S_AB; A's "direct channel to B" and B's "direct channel to A" both use keys derived from S_AB (e.g., K_A→B = SHA-256("a2b" || S_AB || ...)). If A wants B and C in a group, A creates a NEW group key and must deliver it to B and C — via the direct channels (encrypted with S_AB, S_AC)!** Oh nice — direct channels let you bootstrap group keys *through* the hostile hub safely! Because direct-channel keys came from out-of-band pairing, and group keys are just data sent over those channels. So: out-of-band pairing is needed only once per pair of people; everything else (circle creation, rekeying, adding members) rides over direct channels. And circle membership can be managed dynamically: "circle update" control items in feeds, encrypted to current members via direct channels... wait, simpler: to add C to circle with key K, A sends K to C over the A→C direct channel (encrypted with K_A→C derived from S_AC). To rotate, A sends new key to each member over direct channels. All of this is posted as encrypted items that the hub relays blindly. 

Hmm wait, but there's a subtlety: B replying to A's family-only post. A's post was encrypted with A's family-circle key K_fam. B has K_fam (he's in the circle). B replies — B's reply should go to the circle. But B can't post to A's feed (only A signs A's feed)! B posts the reply in B's own feed, encrypted to... B's audience circle that includes the family? If B's family circle has a different key K'_fam, then A can read B's reply only if A has K'_fam. So replies to family-only posts require the *thread* to be readable by the family — meaning B's reply is encrypted to a circle of B's that contains the same people. In families, B's family circle ≈ same people but different key. So B must have paired with each of them (or at least those he replies to). Mechanically: B's reply item = encrypted with K_Bfam (B's family circle). A's reader app sees B's reply (A has K_Bfam from pairing) and renders it under A's post (via the `in-reply-to` item ID). Cross-hub: B is on family.example, A on a.example; B's reply lives in B's feed on family.example; A's app fetches it (via the reply-notification mechanism) and decrypts. No hub coordination. 

Reactions: same, an item in the reactor's feed: `{type:"reaction", target: <item id>, emoji: "❤️"}`, encrypted to the circle if the target was private, public if public. The *target author* learns of the reaction how? Polling: A's app polls the feeds of people A follows... that doesn't scale across many followers but for families fine. Better: **reply notifications via the hub's inbox**: each person has an inbox endpoint on their hub (`POST /hearth/<keyid>/inbox`) where other hubs/apps deliver notification envelopes: {"sender": <keyid>, "feed": <URL>, "item": <envelope or id>}. The hostile hub controls HER inbox — it can drop notifications (denial), but can't forge them (signed) and can't alter content (signed/envelope bytes). Missing notifications = missed replies, not corrupted ones — the reader can also discover replies by polling the feeds of followed people. Flag: hostile hub can suppress notification delivery (and even block outbound fetches? The hostile hub can refuse to serve her feed to the world — a full "shadowban"/silo seizure — the mitigation is only leaving or readers fetching via alternate mirrors; the floor's assurance 4 is about cross-hub *capability*... the hostile hub can cut her off from the network while she remains on it — that's an availability attack, inherent to hosting. Name it: the hub can always deny service; the floor only guarantees integrity/confidentiality/portability, not availability.)

Hmm — one more wrinkle on assurance 2: "The host cannot read what wasn't meant for it." Also *replies* to encrypted content must be encrypted (else the reply leaks the parent). And the notification envelope must not leak content — it carries only pointers (item IDs), not plaintext. Also the *title/summary* fields in feeds must not leak (RSS export for public posts only; private posts appear as opaque entries in the signed feed but the RSS bridge shows only public ones — or shows "private post" placeholders. For interop scenario 7 (stranger, public journal) only public posts matter — fine).

Now **recipient anonymity**: "hiding who an encrypted message is for." With circle keys, the item carries a circle tag. What does the hub learn? If the tag is a stable circle ID (e.g., SHA-256("circle-id" || K_circle)), the hub learns *that items belong to the same circle* and can correlate: same-circle items across people's feeds (e.g., B's reply uses a different key... no wait — B's reply is to *his* circle with his key; the tag would differ!). Hmm: the tag leaks circle-membership structure only within one author's feed (items sharing a tag). Cross-author correlation: A's item tagged T_A, B's reply tagged T_B — no link. Actually that's fine. But even better: derive the *wrapper* key... let me simplify: each encrypted item: sender picks random item key `ik`; content encrypted with ik (Hash-CTR, nonce = item id or random). Then `ik` is wrapped once per circle... no wait, with a single circle key, just encrypt directly with K_circle + unique nonce — no per-item key needed. Per-item keys would matter for... nothing here (no FS anyway). Keep it simple: **ciphertext = Hash-CTR(key = SHA-256("msg" || K_circle || item_nonce), plaintext); item includes {circle: tag, nonce: random 16 bytes}**. The tag = SHA-256("tag" || K_circle) — stable per circle, hides circle *name* (the circle's human label, e.g., "family-minus-Dave", is itself encrypted... wait the tag is a hash of the key, so the label never appears). The hub sees: these items share a tag; cannot name the circle, cannot enumerate members, cannot decrypt. Members are hidden: nothing in the item lists recipients. The hub does learn: number of circles, item counts/timing/sizes per circle, and — from network logs — fetch patterns (who fetches which feeds), so the hub can *infer* membership by watching who polls whose feed (traffic analysis, explicitly a non-goal to resist). Name what the hub learns: feed fetch logs, timing, sizes, circle tags, and the *fact* that item X in A's feed got a reply from B (reply notifications reveal social graph — even if content is opaque). Actually the `in-reply-to` in B's reply item is INSIDE the ciphertext, so the hub doesn't see what B replied to... but the notification envelope tells A's hub "B has a new item for A" — hmm, the notification could just be "B's feed updated at URL" without revealing which item. Let me design notifications minimally: `{type:"notify", from: <B keyid>, feed: <B feed URL>, fetch: <B feed URL + since>}` posted to A's inbox, signed by B. The hostile hub (A's hub) learns A and B interact (graph edge), not the content. Acceptable; name it.

Alright — **now the identity/verification chain for assurance 1** ("nothing it serves as yours verifies unless you signed it, and the key that signs was never the host's"). Mechanism: all items signed by the person's device key; keys generated on-device at onboarding, never on the hub (grandma's app generates it; the hub never sees the private key — it's in the app's keystore/Keychain). Hub serves envelopes; readers verify. The hub *could* refuse to serve, or serve stale, or serve others' content attributed... attribution is by signature/key, so misattribution fails verification. Backdating: covered by chain + timestamps + reader memory. Alteration: breaks signature. **The one thing the hub can do: withhold.** Also: replay old items as if new — detectable via seq/chain monotonicity per reader memory (each reader remembers the last seq/item ID it verified; if the hub serves a shorter chain, reader shows "stale" (scenario 1: "frozen copy reads as stale rather than as her" — exactly this: mom's app knows her chain head was item #412; the ex's hub serves up to #300 → app marks stale/regressed; if he serves #412 forever, it's frozen with no new items, and crucially mom has already followed her to the new hub).

Also "the key that signs was never the host's": onboarding must generate the key client-side. For grandma: app generates key, stores in OS keystore, backs up (see recovery). The hub gets only the public key and envelopes. Also this is what makes assurance 3 possible: the key lives on her device(s) and in backups — never escrowed to the hub... except recovery! Scenario 2: grandma loses phone, recovers "by calling her daughter." So the key must be recoverable via the daughter without the hub. Mechanism: **social recovery of the key material**: at onboarding (done by the daughter), the app shards the private key (Shamir?) — no, Shamir needs a library... hmm, "no dependencies." Simple version: the app encrypts the key with a recovery passphrase and gives the ciphertext to N guardians, K-of-N via... Shamir from scratch is ~30 lines (Lagrange interpolation over a small prime field — implementable, but is it weekend-trivial? Shamir over GF(251) is genuinely ~30 lines and easy to test; but combining shares requires the guardians' apps... ). Alternative: 1-of-N: the full encrypted key goes to each guardian with a passphrase known to grandma... she can't remember passphrases ("never shown a key, never told to store a file outside the house"). Hmm.

Simpler: **guardian = another member's app holds an encrypted copy of your key, unlockable by your new device proving... ** wait. Let me think about what recovery needs to achieve: restore private key to a new device, with the daughter's help, such that the hostile hub (if any) can't participate and can't get the key. Options:

(a) Daughter re-onboards grandma: new key, signed key-change from old key... but old key is lost — can't sign the change! Total key loss means the old chain cannot be extended. This is the "continuity of a stranger's view across total key loss" non-goal... but grandma is not a stranger — her family should keep following her. Hmm, so for *known followers* (her daughter, mom), continuity across grandma's total key loss IS required (scenario 2 says she's "back by calling her daughter" — back to her identity? or back with a new identity re-followed?). If the key is lost, the only way to continue the same identity is if the key (or enough of it) survives somewhere. So we need key backup. "Never told to store a file outside the house" — the backup must be automatic and invisible. So: at onboarding, the app splits the key and sends encrypted shares to chosen guardians' apps automatically (other family members' devices), and/or stores an encrypted copy on her own hub — wait, hub is potentially hostile (grandma might be on the hostile son-in-law's hub!). Hub-escrowed encrypted key: hub can't decrypt without the passphrase; grandma must remember a passphrase — she won't. But: encrypted to her *daughter's* public key... we have no public-key encryption (no DH!). Encrypted with a key derived from the pairing secret S(g-mom, daughter) — but pairing happens... the daughter sets her up, so the app can establish S at onboarding in person: QR code shown on daughter's phone, scanned by grandma's phone. The share sent to the daughter's app is encrypted with the pairing secret. Then when grandma loses her phone, the daughter's app holds a share (or the whole key) and can restore it to grandma's new phone via a new QR/in-person pairing. Guardians can be multiple (shares encrypted to each guardian's pairing secret). 1-of-N via N encrypted copies (each guardian alone can restore — simpler than Shamir K-of-N, weaker: any single guardian can impersonate grandma after "restoring"). K-of-N would be nicer but adds Shamir. Weekend rule: **full-key copies to K guardians, each wrapped with the pairing secret; accept that a guardian can restore (and thus could impersonate) — flag it.** Hmm, is that acceptable? The adversary is the hostile hub operator (inside family). Guardians are family members — if a guardian is the hostile ex... grandma picks guardians; the daughter sets her up; the ex isn't a necessary guardian. But a guardian gone bad could seize grandma's identity. Mitigation options: device-side key-change with delay + notification to all followers ("key rotation with a social acknowledgment window")... this is getting deep; address in key-change section. I'll go with: N guardians, each with a copy wrapped under the pairing secret; recovery = guardian re-delivers; optionally K-of-N Shamir as an extension. Actually — wait, I could do K-of-N without Shamir: give each guardian k_i where key = XOR of shares... that's 1-of-N composition... XOR of all shares = K-of-N exactly (all-or-nothing). "All guardians must cooperate" — for grandma, "call your daughter" (and maybe son) — plausible! All-or-nothing XOR sharing is 5 lines, trivially implementable, and honest. But if one guardian is unavailable/dead, no recovery. Hmm. For the spec: mandatory simple option (XOR all-shares) with Shamir noted as extension? Or per-guardian full copies (1-of-N) as mandatory? Trade-off: availability vs. insider abuse. The brief's adversary is the hub, not guardians per se, but the divorce scenario warns family members can turn hostile. I'll offer both but default to... let me think about grandma: "She is back by calling her daughter." Singular daughter. If recovery required ALL guardians and grandma appointed daughter + son, calling just the daughter wouldn't suffice. The scenario literally says calling her daughter suffices → 1-of-N default. OK: **each guardian holds a full copy, wrapped under the pairing secret with the guardian; recovery via any one guardian; the cost: any guardian can restore-and-impersonate; mitigation: rotation-on-recovery + follower-side alerts.** And note K-of-N as an optional upgrade with XOR (all-of-N) as a middle option. Good.

Wait, one more recovery consideration: recovery needs to happen WITHOUT the old key, so the new device gets the old key from the guardian, then signs a "key-rotation" item... but actually if the old key is restored, no rotation needed — the chain continues seamlessly. The restored key = same identity. But: did the hostile ex get a copy while the phone was lost? Unknown — so prudent recovery includes rotation: new device generates NEW key, signs a "key change" item with the OLD key (which the guardian just provided), specifying the new key. Followers see a chain-valid key change. The hostile hub cannot forge this (needs old key). But wait — what if the hostile hub *withholds* the key-change item from followers (he controls serving!)? Follower polls get the old chain, frozen. Mitigation: key-change items are ALSO broadcast... to whom? Followers poll her feed at her hub; if the hub is hostile it just doesn't serve it. So hostile-hub + key-change = followers don't learn it via that hub. They learn via: the person telling them (out-of-band link), or via *guardians'/relatives' relaying*: if mom follows both grandma and the daughter, the daughter's feed can carry a relayed copy of grandma's key-change item (a "witness" item — signed by the daughter, containing grandma's signed key-change envelope). Gossip via feeds of mutual contacts! That's the decentralized answer: **any third party can relay anyone's control items as "witnesses"**; readers accept witnessed control items into their view of a person's chain if signatures verify, preferring the longest valid chain. This is SSB-style gossip and needs no global registry. And it's simple: a witness item is just an envelope embedded in another person's feed with type "witness", plus the reader's merge rule (per-person, merge by seq, verify chain). I like it: the merge rule is "the longest valid chain wins" (per key). Contested chains: hostile hub could fork grandma's chain from seq N using... no — he can't forge items at all (no key). The only forks possible: (a) key theft (then two valid chains under same key — resolved by... the true owner rotates; followers see two chains both signed by old key... ugh, but key theft is addressed via rotation + witnesses), (b) the author themself double-appending (crash/re-install) — rare, merge by seq, tolerate duplicates. So fork handling is: readers merge chains by seq; if two different items share a seq (genuine fork), prefer... the one seen first? Show both? Family scale: show both, mark conflict. Honest answer.

Hmm, but wait — actually there's a subtle issue with "longest valid chain wins" for KEY CHANGE specifically: hostile hub wants to keep followers on the OLD key (so he can... he can't post with the old key either — key loss to him isn't assumed; he just doesn't have it. What does he gain by withholding key-change? He keeps followers fetching from HIS hub (ads? lock-in? control of the social graph?). Or, nastier: he *fakes* a key change: he forges "I moved to newkey K_attacker" — needs her signature — impossible. He could replay her OLD key-change (from an earlier legitimate rotation) — replay of an old rotation: followers who already processed it ignore (seq already seen). A fresh follower (never saw her chain) given a truncated old chain ending in old rotation... they'd follow old key — but old key is hers, hub can't post with it — so the worst case is serving stale content, detectable by timestamps. OK.)

Now **key rotation normally** (no loss): device generates new key, signs key-change item in the old chain (containing new pubkey), then continues the new chain with a genesis item that references the key-change item's ID. Followers verify handoff. Cross-signing both directions (new key signs a "supersedes" item too) prevents... eh, one direction suffices given chain continuity. Keep: old-key signs {type:"rotate", new: pk2, reason}; new chain's first item includes prev: <rotate item id> and a field "under": pk2 with pk1's handoff... The reader's rule: person = chain of keys linked by rotate items; the person-ID (stable) = the FIRST key ever (the "root key")? But grandma's recovery restores the same key — root key persists. If root key lost with no guardian (total loss, non-goal scenario for strangers but family = guardians exist). For strangers: total key loss → new identity, re-meet (scenario 7: "After the author's key loss, they re-meet the author" — via what? They find the new feed by... the bridge? The author posts from the new identity and the stranger re-discovers through ordinary means (a link, being re-shared). "Re-meet" is weak — fine, it's a non-goal to do better. Maybe add: new identity can sign a statement "I am formerly <old root key fingerprint>" — but without the old key, that statement is unauthenticated... it's a *claim*, useful socially (the stranger sees the claim, checks with mutual contacts — human verification). Fine.)

Hmm OK wait, I want to also reconsider: is the "single append-only log per person" the right structure vs. "signed items, unordered"? The log buys: tamper-evident ordering, backdating defense, stale detection, a natural "everything I wrote" export (assurance 3: leaving = copying the log file(s)). Cost: strict ordering requirements on multi-device (two devices appending concurrently → fork; family scale, phones+tablets — plausible!). Multi-device: mom posts from phone and iPad simultaneously → two items claiming same seq. Merge rule needed anyway. Alternatively: no strict seq, just signed timestamps + per-device monotonic counters? Simplest robust: seq per person with conflict-tolerance (if two items claim seq n, keep both, display both, author's app reconciles later by re-signing a "flatten" note? too complex). Honest answer: single-writer assumption, devices sync through one app instance at a time (the app treats the log as local-first with a lock; conflicts are rare and displayed, not silently resolved). Flag it in cost sheet.

**Media**: photos referenced by SHA-256 in signed items; blobs served content-addressed; readers verify hash; leaving = copying blobs (or re-deriving from the local cache the app keeps — assurance 3 says "a copy was always on your device" — the app mirrors your own feed+media locally... for 10k users on a big hub, each user's device mirrors their own content — sizes: family scale OK; the hub's per-identity cost stays flat: hub stores N users × their content — "flat" meaning no crypto-linear blowup like per-recipient copies! With per-recipient wrapping you'd store ciphertext copies per recipient — we DON'T: one ciphertext per circle... wait, no: with circle keys, ONE ciphertext serves the whole circle — that's the flat-cost win vs. per-recipient encryption which would multiply storage/traffic by audience size. Hmm, actually per-recipient only multiplies the *wrapped key* (small), not the ciphertext (one ciphertext + N wrapped keys ~ 100 bytes each). So flat either way. The flat claim: hub cost per identity = storage of their blobs + serving. No per-follower fan-out on the hub? Replies/notifications: the hub relays notifications — outbound delivery to followers... followers POLL (pull), so hub cost = answering polls: O(followers × poll rate). For 10k identities fine.)

**Interop (priority 3):** public posts export as RSS/Atom/JSON Feed at a stable URL (`/feed.xml` etc.) generated by the hub or any bridge from the signed feed (hub can't forge public items — they're signed; the RSS is just a projection, and the signed feed is the source of truth; a suspicious reader can cross-check). Mastodon bridging: the hub (or anyone) can expose an ActivityPub actor per person (outbox = public items); replies from Mastodon come back via... the brief says inbound replies are "an extension, not a requirement." So: outbound-only bridging — public posts appear on the fediverse; Bluesky via a Bsky bridge (feed → firehose... whatever, the bridge translates public feed to ATProto posts; needs a bridge service — "with nothing extra built" means the publisher doesn't build anything; bridges exist generically — RSS→Mastodon bridges exist (RSS Bridge / feed-to-fediverse bots), and for Bluesky there are RSS bridges emerging. Honest note: true zero-config bidirectional bridging isn't free; we get one-way visibility free via feeds.) Key point for interop: **the public feed URL and item permalinks are ordinary HTTPS URLs**, so feed readers just work. The identity story (key) rides in a JSON Feed extension field / RSS `<cloud>`-ish custom namespace (e.g., `<x-hearth:key>`), so bridges can carry identity if they want, ignore otherwise.

**First contact & poll (deliverable #1):** 
- First contact: you get a link `https://hub.example/@name` (human entry) or a hearth URI `hearth://<keyid>@<hub>` (precise entry, contains key so no TOFU needed... wait the key IS the id: `hearth:z...43chars?at=https://...`). Fetch the **card** at `https://<hub>/.well-known/hearth/<keyid>/card` (or follow the `at=`). Verify signature (card signed by keyid). Card points to feed endpoint. Fetch log (or `?since=`). Verify chain + signatures. Follow = store (root key, current key, current hub, last seq, circle keys you hold).
- Poll: GET card (ETag/304), GET log `?since=<seq>`; for private content you hold circle keys; blobs on demand.
- Polling the *whole person* across hub moves: card at old hub returns a signed relocation (or the reader's app uses witnesses/gossip or a re-shared link).

Hmm — what exactly is the card vs the log? Could the card just be an item in the log (type:"profile")? Then there's ONE artifact: the log. First contact: fetch log head → find latest profile/relocation. Simpler! But the hub needs to serve "where's this person" WITHOUT scanning the log... the hub can maintain an index (unsinged, advisory). Let me define: **the log is the only signed artifact**; hubs serve `GET /hearth/<keyid>/log` (whole or `?since=`), `GET /hearth/<keyid>/item/<id>`, `GET /hearth/<keyid>/blob/<hash>`, `POST /hearth/<keyid>/inbox`, and a convenience `GET /hearth/<keyid>/card` (unsigned summary with pointers, or just the latest signed profile item — I'll make card = latest signed profile item, served specially). RSS at `/feed.xml` for the hub or per-person `/hearth/<keyid>/feed.xml` (projection, public items only). Hmm, per-person RSS on big hub: `/hearth/<keyid>/rss.xml`. Fine.

Wait — do we even need the hub to know keyid → person mapping? Yes, it hosts many people; keyid is the storage key. And posting: how does the author's app submit items? Auth to the hub: the hub must authenticate the author (it could otherwise let anyone append garbage to her storage — not a security failure for readers (they verify signatures; garbage items fail verification and are dropped) but a storage-abuse problem for the hub). So posting auth: the app authenticates with... a hub-issued account credential (hub's choice — password/token/mTLS) PLUS every item is signed (the real security). The hub may also verify signatures before accepting (recommended: reject unverifiable items — keeps storage clean). Key point: **hub account credentials are convenience, not trust.** Revoking them doesn't affect identity. The hostile hub "holding legitimate credentials" (§2!) — he holds HIS OWN account on the hub, and maybe admin; he still can't forge her items. ✔.

Hmm, also: **who writes items to the hub — only the author's app?** For inbox notifications from other hubs: the OTHER hub (or the other person's app) POSTs to her inbox. Fine.

Now, cross-hub reply flow (scenario 3) concretely:
- A (on a.example) posts family-only item I_A (encrypted to A's circle "fam", tag T_Afam) to her log on a.example.
- B (on family.example), paired with A (they exchanged S_AB out-of-band at some family dinner; also B holds A's circle key K_Afam because A added him — how did A add B to the circle? A sent K_Afam to B over their direct channel: an encrypted item in A's log addressed to B (encrypted with key derived from S_AB), or a direct push to B's inbox, encrypted likewise. Let me settle: **circle-key distribution = items in the author's log encrypted to the recipient's direct channel** — actually better as inbox messages? Hmm. If circle keys ride in the log, then anyone with the direct-channel key can find them later (late joiners can catch up on history? Do we WANT new members to read old circle content? Grandma joins the circle in 2025 — can she read 2023 posts? The archive is on the hub as ciphertext; if she gets the current circle key, she reads ALL of it (no FS). Is that OK? Threat model: members are trusted; late member reading old content = normal social behavior ("scroll up"). Yes, acceptable, and honest: no forward secrecy means new members read history. Flag it.)
- B's app polls A's log (B follows A), sees I_A, decrypts (has K_Afam).
- B replies: creates item I_B in B's log on family.example: `{type:"reply", to: <A root keyid>, to_item: I_A.id, body...}`, encrypted to B's circle that includes A — wait, B encrypts with B's OWN circle key K_Bfam (a circle of B's containing the family). A holds K_Bfam (B distributed it to A via their direct channel). So A can read. ✔. B's app also POSTs a notification to A's inbox on a.example: signed by B: `{from: B_keyid, feed: https://family.example/hearth/<B>/log, upto: seq_n}` — a compact "come look" pointer. A's app fetches B's log since last-seen, verifies, decrypts reply, renders thread. **No hub-to-hub config** — the notification is app-to-hub HTTP POST; hubs don't need to know each other. If a.example (hostile) drops the notification, A's app ALSO polls B's feed directly (A follows B anyway — families follow each other mutually; even if not, A can follow B). So notification suppression has limited effect when people follow each other. ✔ Name the residual: if A doesn't follow B and the hub drops notifications, the reply is discoverable only by B telling A out-of-band or A's app polling commenters... a "backref" mechanism? (Items could include the parent's keyid — B's reply contains A's keyid in ciphertext... then A can't discover it either. Discovery of replies = notifications + mutual follows. Honest limit: hostile hub can hide replies from you while you're hosted there. Mitigation: leave; or a friendly third party (mom, who follows both) relays via witness items — witnesses can carry OTHER people's items! Mom's feed can include a witness item embedding B's reply envelope; A's app trusts... verifies B's signature on the embedded envelope — mom is just a courier. So gossip via mutual contacts solves even reply-suppression. Nice — this is the SSB gossip model earning its keep. I'll include witness items as a MAY/SHOULD with simple rules: any feed may embed foreign envelopes; readers process foreign envelopes they care about (by follow-list) after verifying signatures.)

- Reaction: same as reply, lighter: `{type:"react", to_item: <id>, emoji}`. Aggregation: A's reader collects react items targeting her items from all logs she can see.

**Scenario 4 (domain goes):** hub at family.example dies. Each person's app has the full local mirror (assurance 3). They sign "relocation" items... wait, chain append requires the key — fine, keys are on devices. New hub at new.example: app uploads log + blobs, gets new base URL, appends `{type:"move", to: https://new.example/hearth/<keyid>}`... hmm, ordering: the move item must be IN the log, but the log is served at the NEW hub; the OLD hub is dead (can't serve the move item). So: the move item is appended after transfer (readers fetch new log, see move item signed, fine) AND/OR the new card/first item declares `moved_from: <old URL>`. Readers discover the new location via: (a) mutual-contact gossip (witness items: mom's feed embeds daughter's move envelope), (b) the person shares a link out-of-band (one tap: `https://new.example/hearth/<keyid>#v=<latest item id>` — app fetches, verifies chain continuity against stored head, updates). (c) if old hub still alive but hostile: he serves stale; readers detect staleness (their stored head is newer than what he serves → "stale" badge, per scenario 1) and rely on (a)/(b). Identity unchanged because identity = root key, never the domain. Feed readers (strangers): they followed `https://family.example/feed.xml`; domain dead → they lose the feed unless they re-find it. Existing readers "find them" — via the out-of-band/gossip channels for contacts; strangers need the author to re-publicize the new feed URL (or a bridge that tracks keys). Honest: strangers following by URL lose the thread at domain death unless the author's new feed is re-shared — that's inherent to URL-based following without a global registry. The signed key continuity means when they DO re-find it, verification is automatic (the feed carries the key; continuity back to the old key is verifiable). For scenario 7's "re-meet after key loss": the stranger re-meets via any channel (the author posts a link somewhere, a mutual contact shares); the new identity is a new root key; the author can include an unsigned "formerly <fingerprint>" hint; the stranger decides to trust the re-meet socially. Non-goal respected. ✔

**Scenario 5 (big lazy hub):** per-identity: hub stores log + blobs per person (flat). Serving: polls answered per person (flat). Crypto per item: one signature, one ciphertext per circle — flat. The hostile operator at scale: can read nothing private (no circle keys — wait: could the commercial hub operator be a *member* of circles? Only if customers pair with him — no). Can't forge. Can't hold people (they mirror locally + can move). Commercial hostility = read metadata, inject ads into HTML pages around content (presentation layer — content itself signed; ads go in the wrapper page; readers using first-class apps see content without ads; feed readers get clean content too since RSS is the projection). Could degrade service (throttle) — availability again. ✔-ish, name it.

**Now let me nail the byte-level shapes.**

Envelope (outer, what's stored/served):
```json
{
  "v": 1,
  "p": "<base64url of payload bytes>",
  "s": "<base64url of Ed25519 signature over payload bytes>"
}
```
Hmm wait — I earlier said payload itself is JSON bytes. Let me reconsider whether to double-encode. Ugh, honestly, let me reconsider option (c) once more — fixed-field signing. You know what, there's an even simpler classic: **sign the payload string as UTF-8 bytes, where the payload is constructed by the app as a JSON object with keys in a fixed order**... the verifier must reconstruct identical bytes → needs identical serialization → canonicalization. No. Sticking with (a): `p`/`s` envelope. The inner payload JSON: readable after decode, for humans debugging with `jq` two steps. Fine. Item ID = base64url(SHA-256(p-bytes)). Hmm — should item ID include the signature? If two different signatures over same payload (weird), same ID — fine, keep ID = hash(payload). Chain `prev` = previous item's ID.

Inner payload fields (common): 
```json
{
  "type": "post" | "photo" | "reply" | "react" | "note" (control) ...,
  "key": "<author current pubkey b64u>",   // explicit, matches sig verifier
  "seq": 41,
  "prev": "<item id b64u>",               // "" for seq 1 or post-rotation genesis
  "at": 1735689600,                        // unix int seconds
  ...type-specific...
}
```
Type-specific:
- post: `{"text": "...", "media": [{"sha": "...", "bytes": 204800, "type": "image/jpeg"}], "circle": null | "<tag b64u>", "enc": null | {"n": "<nonce b64u>", "ct": "<b64u ciphertext>"} }` — hmm, wait: for encrypted items, what's signed vs encrypted? **The envelope signature covers the payload which CONTAINS the ciphertext** (so tamper-proof), and the plaintext is inside the ciphertext. The payload for encrypted items: `{"type":"post","seq":...,"circle":"<tag>","nonce":"...","ct":"..."}` — body text and media *hashes*? No! Media hashes inside ciphertext (else hub learns media fingerprints — it stores the blobs anyway! The hub serves the blobs; it HAS the bytes; hashing them is trivial. Media hashes in the clear leak nothing to the hub beyond what it has. But it leaks to *other fetchers*... no, only to those who fetch the item — followers — who can decrypt anyway... but PUBLIC fetchers of the log can see "there's a photo with hash X in circle T" — meh, minor. But: **reply targets inside ciphertext** (else the public log reveals social graph of private threads) — yes, `to_item` goes inside `ct` for private replies. Media: keep hashes inside ciphertext for tidiness? If inside, the reader decrypts, gets hashes, fetches blobs — blobs are served without needing circle membership?? **PROBLEM: the hub serves blobs to anyone?** Private photo blobs must not be fetchable by arbitrary fetchers (confidentiality from non-members — the hub can't read them, fine, but should randoms be able to download the ciphertext? The ciphertext is useless without the key — anyone CAN download ciphertext harmlessly (like an email server holding PGP mail). But wait — media blobs are encrypted too! The photo blob = ciphertext (encrypted with circle key). Then anyone fetching gets encrypted bytes — fine, no access control needed at the blob layer! Elegant: **blobs are always encrypted for private items, always plaintext for public items; blobs are content-addressed by the hash of the CIPHERTEXT (what's stored)** — hmm, or hash of plaintext? If blob hash = hash(plaintext), the hub can't verify storage integrity... doesn't need to; the reader verifies: decrypt blob, hash plaintext, compare. Two options; hash-of-stored-bytes is simpler for integrity-of-serve (reader checks the fetch), hash-of-plaintext is stable across re-encryption. Since ciphertext is deterministic given (key, nonce) and we won't re-encrypt, either works. Choose: **blob id = SHA-256 of the stored (possibly encrypted) bytes** — the item references blob ids; reader verifies fetch integrity directly; for private items the reader then decrypts with the circle key + the blob's nonce (nonce stored where? In the blob header! Blob = magic + nonce + ciphertext, self-describing: `b"HRTH1" || nonce(16) || ct` and blob-id = SHA-256(all of it). Then items just reference blob-ids; decryption key derivation needs circle key + nonce from blob header. Text posts: ciphertext inline in item (`ct` field, nonce inline). Media: separate blob files. Consistent scheme: Hash-CTR keystream = SHA-256(key || nonce || counter32) blocks... let me spec the cipher precisely:

```
keystream(k, n, i) = SHA-256( "hearth-ctr" || k || n || u32be(i) )   # 32 bytes per block
ct[j] = pt[j] XOR keystream(...)[j mod 32]
key derivation: mk = SHA-256("hearth-key" || circle_key || item_nonce)  for inline text
```
Wait — do I need per-item nonces AND per-blob nonces? CTR keystream reuse = catastrophic (XOR of plaintexts). Rule: **never reuse (key, nonce) pair**. Circle key + unique nonce per item (random 16 bytes) → distinct keystreams. Media blob: encrypted with mk derived... simplest: media encrypted with the same mk as the post (nonce = post's nonce? then blob keystream shares mk+nonce with text — text and media are different data but SAME keystream = XOR attack: attacker (the hub!) has both ciphertexts... if it can guess one plaintext (e.g., the text), it recovers keystream and decrypts the photo! DANGER. So: distinct nonces: item text uses nonce n1; each media blob carries its own nonce n2, n3... and derives mk from circle key + its own nonce. So blob: `HRTH1 || nonce16 || ct`, key = SHA-256("hearth-media" || K_circle || nonce). Inline text: key = SHA-256("hearth-text" || K_circle || nonce), nonce in the item. Each unique nonce random 128-bit → collisions negligible. ✔ And since a random nonce per item, same plaintext twice → different ciphertexts (hub can't dedupe-recognize repeats — fine).

Circle tag: tag = base64url(SHA-256("hearth-tag" || K_circle)) — stable identifier so members' apps can pick the right key; leaks only "same circle" grouping. Circle *name/label* ("Christmas plans") — inside ciphertext? The label is display metadata; put it in the encrypted body. So the item's cleartext has: type, circle tag, nonce, ct. The hub learns: this is an encrypted post (or reply/react — should type be hidden? Type in cleartext leaks some structure ("she replied to someone"). Hmm — could encrypt everything including type: item = {seq, prev, at, "boxed": {tag, nonce, ct}}? But then public/private distinction is itself info... it's visible anyway from RSS absence. Simplest: keep type in clear? For a privacy-first design, hide everything except the chain skeleton: items are either `"public": {...}` or `"boxed": {tag, nonce, ct}`. Wait, but then even `reply` vs `post` hidden. Let me define payload: public items: full JSON in clear. Private items: `{"seq":...,"prev":...,"at":...,"box":{"tag":"...","n":"...","ct":"..."}}` where ct decrypts to the same shape as a public item's content fields (text/media/to_item/etc.). Yes — cleaner and maximally hiding. The chain skeleton (seq, timestamps) is public — unavoidable-ish (needed for ordering/verification by everyone... actually is it? Only members need to verify ordering of private items? No — EVERYONE verifies signatures to validate the chain; seq/prev must be public to check chain integrity. Timestamps public = activity patterns leak. Acceptable, named.)

Now the **cipher critique**: Hash-CTR with SHA-256 — I should honestly assess: this is a stream cipher whose security = PRF security of SHA-256 under secret-prefixed keys. Known attacks: none practical; related-key concerns don't apply (key is the prefix input, distinct nonces give distinct inputs — standard "prefix-MAC"-style usage; length-extension doesn't apply since we're using full-block outputs, and the key is a prefix but we never expose the hash output... WAIT — careful: is the keystream ever exposed? If the attacker learns plaintext (e.g., guesses text), they recover keystream blocks for those positions, decrypting other data encrypted with same (key,nonce) — we prevent via unique nonces. Standard CTR caveat. Fine. Also: no authentication of the ciphertext beyond the envelope signature — the signature covers the payload including ct — but MEDIA BLOBS: the blob is a separate file NOT covered by the item signature except by hash! Item references blob-id = SHA-256(blob bytes) → covered by signature (hash in payload) → integrity ✔ (any blob tamper breaks hash match). But for private media, the hash is of the ciphertext (stored bytes), so the hub can't verify but the reader can — fine.

One more crypto piece: **direct channels & pairing.** Pairing (in person / call): the two apps exchange 16-byte random secrets S over the QR/local channel. Hmm, actually for a phone call, reading 16 bytes is impossible — short numeric codes are PAKE territory (no PAKE from palette...). In person/QR: full 16 bytes easy (QR of `hearth-pair:<S b64u>`). By link (any messenger): the link carries S — if the channel is compromised, pairing is compromised (that's inherent; the hostile hub can't see Signal/SMS... SMS maybe. Families use WhatsApp — the hostile ex might be in the family WhatsApp group but not in the 1:1 DM. Acceptable.) Also E2E messenger delivery of pairing links is the norm. OK: pairing secret S_AB (random 128-bit, exchanged out-of-band). Derived keys: A→B channel key = SHA-256("hearth-dc" || S || "A→B" || pk_A)... direction-binding: include both pubkeys ordered: k_AB = SHA-256("hearth-dc" || S || min(pkA,pkB) || max(pkA,pkB)) — one shared channel key for the pair (used both directions — if used both directions with distinct nonces, fine; direction doesn't need separation since both parties know all anyway; but for hygiene, derive two: k1 = H(...||"1"), k2 = H(...||"2"), A sends with k1, B with k2. Cheap, do it.)

Direct-channel message: an item in A's log: `box` with tag = H("dc-tag" || k_AB), nonce, ct = Encrypt(k_AB, payload containing e.g. a circle key grant: `{"grant": {"circle": "<new tag>", "key": "<K_circle b64u>", "label": "Family"}}`). B follows A, decrypts, stores circle key. **The grant rides A's public log** — hub sees an opaque boxed item with tag T_dc — hmm wait, the tag for the direct channel identifies the A↔B channel (a stable hash) — visible to hub: "A has a direct-channel item" — fine, hides recipient identity (that's the requirement! "how recipients are addressed without publishing the audience": the audience is NOT enumerated — only a channel tag appears; the hub can't tell WHO the other end is (unless traffic analysis — named non-goal). Even better: since k_AB is per-pair, the tag doesn't reveal B's identity cryptographically. ✔ Great — this satisfies "recipients addressed without publishing the audience."

Circle key rotation: A posts new grants over each member's direct channel; then new items use new tag. Old members not re-granted lose access going forward (but keep old key → old archive. No FS — named.)

Revocation of a member = rotate circle, re-grant to remaining. Cost O(members) direct messages — flat-ish. ✔

**Grandma onboarding (scenario 2) walk-through:**
1. Daughter installs app on grandma's phone (or grandma does; guided). App generates Ed25519 key on-device; stores in OS keystore. No key shown. ✔
2. Pick a name ("Gran"). Name is a signed profile attribute, not an identity. Hub: daughter's own hub or a commercial one — app asks "where will this live?" default: daughter's hub (families!). The app creates the account on the hub (normal signup) and uploads the first items. Hub never receives the private key. ✔
3. Pairing: grandma's phone shows QR / the daughter's phone scans it (or the daughter's app pairs her mom by proximity). This establishes S(g-mom, daughter) AND makes the daughter a guardian: the app wraps grandma's private key: wrapped = Hash-CTR(k=SHA-256("hearth-guard" || S), grandma's private key seed + pubkey + root info) and sends it to the daughter's app to store (and/or posts it to her log as a boxed item tagged for the guardian channel — hmm: if the wrapped guardian copy is in grandma's LOG, then it's on the hub — the hostile hub has the ciphertext; can the hub brute force? It's Hash-CTR under a 128-bit secret — no. But wait: the hostile hub could hold the wrapped copy and later, if it ever learns S (e.g., grandma re-pairs her phone with... no, S is only known to the two devices). OK but there's a subtler issue: storing guardian copies in the log means they're PUBLICLY fetchable by anyone (the log is public!) — anyone gets wrapped-key ciphertext; security rests on S (128-bit random) — that's fine actually (like a password-encrypted key file in public). But hygiene: better to deliver the guardian copy directly to the guardian's app (over their pairing channel or the direct channel), stored in the guardian's app storage, NOT in the public log. I'll do that: guardian copies live in guardians' apps (and their backups), not in the log. ✔ "never told to store a file outside the house": the app handles it; grandma does nothing. ✔
4. A year later: phone lost. Grandma calls daughter. Daughter sends a link/QR (or they're together): grandma's new phone installs app, scans daughter's recovery QR (or opens `hearth-recover` link). New phone gets wrapped key copy + S via... the recovery flow: new phone and daughter's app pair (new S'), daughter's app sends the wrapped key over the new channel, new phone unwraps (needs S_original — the wrapping key derived from the ORIGINAL pairing S, which the daughter's app still holds ✔), gets private key, verifies it matches the public key in her existing log (fetches log from hub — even the hostile hub serves the true public key since... it serves whatever; verification is against the fetched log's key + her own continuity... hmm, trust anchor: the daughter's app KNOWS grandma's public key (she's her guardian/contact) — so verification is against a locally-known key. ✔). Then prudently rotates: new key, rotate item signed by restored old key, continues. Followers see rotation (via hub or gossip). ✔ She's back. Total key loss without guardians → new identity (non-goal acknowledged).

Divorce scenario walk-through: covered above mostly. Points: he can't post as her (no key); can't read family-minus-him circle (no key; members paired out-of-band); can't alter/backdate (signatures + chain + reader-stored heads); can't stop her leaving (local mirror + key on device; upload elsewhere; append move item... wait — the move item must be appended to HER chain; her chain "lives" on his hub but she has the full mirror; she appends the move item locally and uploads the whole log to the new hub. The old hub's chain now lacks the move item — fine, hers is longer → readers accepting "longest valid chain" from any source (new hub, gossip) migrate. Mom's "one tap": daughter sends mom `https://new.example/hearth/<keyid>` link; mom's app fetches, sees chain extends the one mom already has (mom's stored head is in the new chain's prefix) → auto-accept, follow updated, one tap. ✔ His frozen copy: serves old chain; mom's app already beyond; other relatives still polling his hub see no new items and — do they know she moved? Only via gossip/out-of-band. For relatives not contacted: their apps show "stale since <date>" (no updates) — hmm, "stale" badge requires knowing staleness — if they poll and get no new items, is it stale or just quiet? The app can't distinguish "she stopped posting" from "hub withholding." Detect: her profile item could include a "heartbeat"/expected-update... overkill. The scenario says "his frozen copy of her old content reads as stale rather than as her" — I read this as: anyone who eventually sees his copy can tell it's old (signed dates, chain ends at seq N) rather than mistaking it for her current self. That's satisfied by signatures+chain: the frozen copy is authentic-but-old; it can't be extended by him; anyone re-meeting her real feed sees a longer chain. Also the move item in the true chain proves she left at time T. His copy lacks it — and if he fabricates a fake "she never left" ... can't sign. ✔ Also: her OLD posts on his hub in circles he belonged to: he keeps readable copies (was entitled) — accepted by threat model. Her private-circle posts (excluding him): he has ciphertexts, unreadable forever (unless a member leaks — named failure).

**Assurance 3 details:** "leave at any moment... because the key and a copy were always on your device." The app maintains a full local mirror: log + media blobs (encrypted ones as ciphertext — fine, she has keys). Leaving = (1) sign up elsewhere / point DNS if own domain; (2) upload mirror; (3) append move item; (4) tell people (one link). Without permission: hostile hub can't prevent any of this (it happens entirely off his infrastructure; he can't revoke her identity because identity isn't his). Storage on device: media mirror could be large (photos!). Hmm — "a copy was always on your device" — for a decade of family photos this is GBs. Phones handle it-ish; app policy: mirror text always; media cache LRU but offer full export... the assurance wants a COPY always on device. Compromise honestly: text+metadata always; media best-effort with explicit full-backup option; flag in cost sheet. Hmm, actually — for assurance 3 to hold at divorce-moment, she needs the media too (else leaving = losing photos). Real design: app keeps all HER OWN media locally (she authored them; her phone took the photos — the app uploads from device anyway, so the originals are on her device camera roll already!). ✔ Reasonable: originals live in her photo library; the app's mirror holds the encrypted uploads; either suffices to restore elsewhere. Good.

**Assurance 4 details:** cross-hub: everything above is person-to-person via signatures + direct channels; hubs are dumb storage/relay with zero knowledge of circles or each other. The only cross-hub interaction = HTTP POST notifications (optional!) and cross-fetching logs. No access-control agreement needed because access control is entirely in keys held by people. ✔ Failure mode: notification suppression + reply-discovery relies on mutual follows/gossip — named above.

**What does the reader fetch on first contact / poll?** (deliverable 1) — summarized above; I'll write a tight section: 
- Handle → key resolution: first contact usually via URL containing keyid (links carry it), or via hub directory `GET /hearth/directory?q=Gran` (advisory, unsigned, for humans). TOFU: if you follow via a bare handle URL without key, you get the hub's claim + the signed profile; you're trusting that hub for name→key binding (TOFU) — one honest caveat: **handle collisions/squatting on a hub** (hostile hub could serve a different key for "Gran"!). Mitigation: links shared between people embed the keyid; apps display key fingerprints; contacts verify. The hostile hub impersonation: he can create his OWN key, sign posts as "Gran" on his hub at the same handle URL?? If mom follows gran via URL on his hub, and he swaps in his own key's profile... mom's app ALREADY knows gran's key (she follows her) — swap detected (key mismatch → loud warning). For NEW followers via URL: TOFU risk (like SSH) — named. This is the classic self-certifying-identity trade-off: humans use names, crypto uses keys; the bridge (URL with embedded key, QR pairing, fingerprint verification) is where trust enters. For family: pairing/QR covers it.)

Poll: conditional GET on log `?since=seq`, blobs as needed. Also poll followed people's logs for replies/reactions (or rely on inbox notifications). Cheap.

**Key change & recovery (deliverable 5):**
- Rotation (routine): rotate item as described; also re-wrap guardian copies under new key; circle keys unaffected (they're independent of identity key!). Nice property: **identity key and circle keys are decoupled** — rotating identity doesn't break audience encryption; losing identity key with guardians restores everything.
- Theft (key compromise suspected): rotate immediately from a safe device; followers accept rotate items in-chain; the thief retains old key and can fork the chain from the rotate point — chain forks: two valid continuations (thief's fork vs. legit). Readers merge-by-seq → both appear?! Ugh. Resolution: key rotation should make readers PIN the new key once seen (monotonic: once you've seen rotate old→new at seq n, items signed by OLD key with seq > n are rejected). The thief's fork has old-key items with seq > n → rejected by readers who saw the rotation. Readers who never saw the rotation (only poll the thief's hub) follow the thief — impersonation succeeds against them until told otherwise (out-of-band/gossip). Honest limit, named. Also: thief who has the old key + circle keys... circle keys live in the app too! Theft of device = both. Rotation of identity doesn't rotate circles → rotate circles too after theft (re-grant over direct channels — but the thief also holds the direct-channel secrets... rotate circles via NEW pairings out-of-band. It's a mess but an honest one: post-theft hygiene = re-pair. Families can do a "family re-keying dinner," lol. Name it.)
- Loss (with guardian): restore + rotate (as grandma flow).
- Contested departure (deliverable 5's spicy bit): hostile operator claims HER departure is the forgery — i.e., he asserts the move/rotate items are fake and that the "real" her remains on his hub. Cryptographically: her move items ARE validly signed; his claim is unverifiable assertion. What can he DO? Serve the old chain without the move item (his right — it's his server) and publicly claim the new feed is a fake. Resolution is social: mom's app followed the longer chain; new followers comparing both see both chains are prefix-consistent (his is a prefix of hers); the divergence point is signed by HER key — so any verifier concludes the extension is authentically hers; his "it's a forgery" claim requires her key to have been stolen — unfalsifiable without additional evidence. Could add a **dead-man's / dispute marker**: her app could have pre-signed nothing special... What would help: a timestamped proof (e.g., her chain head registered with witnesses — mutual contacts' witness items provide third-party timestamps ("I saw her chain at head X on date D") — witness items give rough notarization! Nice: witnesses = timestamping authorities, organically. His frozen copy then demonstrably predates. I'll note witness items double as timestamps.
- What if HE claims a fake departure the other way — he fabricates "she moved to attacker-hub" — needs her signature — impossible. ✔ And he might replay her genuine OLD move item (from a previous move) to redirect people to an old hub — readers see seq already processed; no-op. A fresh victim might get confused; timestamps save. ✔

**The honest cost sheet (deliverable 7):** 
- No forward secrecy for circles (leaked/rotated-in members read history; a leaked circle key opens the archive).
- Hash-CTR is nonstandard; malleable-if-unsigned (we always sign over ciphertext — but the BLOB path: blob id covers the ciphertext; ✔). Performance fine.
- Group-key distribution = out-of-band pairing per pair of people; onboarding friction; pairing over compromised channels = compromise.
- Single-writer log: multi-device conflicts displayed, not resolved.
- Discovery/moves rely on human channels + gossip; a stranger following a URL loses you at domain death; no global search.
- TOFU on handle-first-contact.
- Availability attacks (withholding, throttling, notification suppression) are unaddressed by design — only by leaving.
- 1-of-N guardian recovery: a rogue guardian can seize the identity (mitigated by rotation-on-recovery + monotonic pinning + witnesses).
- Hub sees: timing, sizes, circle tags, social graph edges (via notifications/inbox), poll logs. Named explicitly (deliverable 6 asks "what the hub learns anyway").
- Interop is one-way (visibility into feed readers/Mastodon via bridges); fediverse replies inbound = extension.
- No moderation story beyond block/mute (should include block item? keep minimal: a "mute/block" is a local reader decision; protocol needs nothing. Skip.)
- The identity-key-on-device story vs. grandma: keystore + guardians is the load-bearing social trust; the protocol encrypts it but can't eliminate it.
- Key loss without guardians = identity death (accepted non-goal, but for families it's harsh — hence guardians mandatory at onboarding).
- Media on big hubs: hub could serve blobs slowly to non-customers... whatever, availability again.

**What to cut if halved (deliverable 8):** cut witness/gossip (moves/out-of-band links only), cut reactions (keep replies), cut rotation pre-authorization...; maybe cut inbox notifications (pure polling); maybe cut multi-circle (one "private" circle + DM channels only)... Order: notifications → gossip/witness → reactions → media-encryption subtleties (no—core). Actually if halved: drop witness items and inbox; keep pairing/circles/chain/move/recovery. Hmm, I'd argue keep notifications (they make cross-hub timely) — but they're optional by design anyway (polling works). Also cut Bluesky/Mastodon specifics to "RSS exists, bridges do the rest."

Also deliverable 2: identity primitive & argue against alternatives — did above: domain/did:web (hub controls), did:plc (registry — violates no-global-registry... well, DID PLC is a ledger-ish operation log on a consortium — violates "no shared ledger"), ActivityPub URL (same as domain), SSB feed IDs (closest prior art! SSB = key-identity + append-only log + gossip + private messages with group keys (ssb-private-groups use curve stuff)... SSB uses X25519/curve25519 DH for its private groups — our difference: palette constraint forces symmetric circles + pairing; SSB's ephemeral IDs etc. I should cite SSB as the closest existing system and argue both ways: SSB solves much of this (key identity, logs, offline-ish, private groups) BUT its stack (secret-handshake, private-groups, feed formats, no plain-HTTPS hub model, no RSS interop, JSON canonicalization via... it has its own) conflicts with priorities 1–3 (std-lib only, weekend implementable, feeds interop). So: "if an existing protocol already solves this, say so" — honest answer: **SSB is the nearest prior art; ATProto separates identity (did) from hosting via a signed DID document — the signed-relocation idea is basically ATProto's did:plc/did:web rotation or 'move' semantics; Mastodon's account migration is a weaker cousin.** I'll acknowledge these and argue why not: ATProto needs a DID method (plc = shared ledger — rejected; did:web = domain-bound — rejected at divorce... though did:web on HER own domain would be fine, but she's on the hostile hub in scenario 1 — rejected as the general answer; our card/move chain IS a did:web-like doc + rotation without the DID machinery). I'll frame our primitive as "a did:key whose document travels with the person" — implemented as a signed log. Good framing: **the identity is the key; the DID document is an item in your own log; resolution = fetch-anywhere + verify; updates = append.**

Length: brief says "as long as it needs to be... rather read 4,000 words of argued design than 800 of outline." So target ~4,000-5,500 words. It's a lot but the brief explicitly wants depth. I need to be efficient: use tight sections, concrete byte shapes, named rejections. Let me structure:

1. Architecture in one page (artifacts table, fetch flows).
2. Identity primitive + rejected alternatives.
3. The four assurances, mechanism + failure mode each.
4. Scenario walk-throughs (1,2,3,4 — plus brief nods to 5-7).
5. Key change/recovery incl. contested departure.
6. Encryption construction in implementable detail (incl. what hub learns).
7. Cost sheet.
8. What to cut.

Also should include the envelope/JSON shapes at the right moments. And name the protocol — I'll go with **Hearth**. Or maybe something less cute... The brief is family-centric; "Hearth" fits: each hub is a hearth; you carry fire (coals) from one hearth to another — actually that's literally the etymology of "focus"... fine, Hearth.

Let me now also double-check assurance 1's clause: "Nothing it serves as yours verifies unless you signed it, and the key that signs was never the host's." — covered: client-side keygen, envelope signatures, verification mandatory in readers. Edge: the hub could serve an UNSIGNED RSS projection with her content (RSS has no signatures!). The RSS feed is unsigned — a hostile hub could ALTER the RSS! Scenario: stranger reads her public journal via RSS; hostile hub edits the RSS text. RSS consumers can't verify. Mitigation: the signed log is the source of truth; RSS is a convenience projection; verification-capable readers (our apps, JSON Feed with extension carrying envelopes?) — could we put signatures IN the JSON Feed? JSON Feed items allow extension fields; we could embed `p`/`s` (or a link to the signed item) per entry — then even feed-reader users COULD verify if the reader cared (ordinary readers don't). Honest: **for plain feed readers, RSS content is as trustworthy as the hub — same as today's web.** The floor assurance says "nothing it serves as yours VERIFIES unless you signed it" — the RSS text doesn't verify (it's not signed); it's presentation. The signed artifacts are the log items. I'll state this precisely: the hub may lie to verifiers-without-verifying (plain RSS users); it cannot produce verifying artifacts. That's the honest reading and matches scenario 7 (stranger via ordinary reader = accepts hub's word, like the web today; the bridge likewise; when they re-meet via the app world, signatures resume). Hmm — but can we do better cheaply? JSON Feed allows a per-item `external_url`... we could define the bridge to include `content_html` plus a trailing signature block? Feed readers ignore unknown fields; a verifying reader could check. Cheap: include the envelope in a JSON Feed extension field `"_hearth": {p, s}`. Then any Hearth-aware reader of the feed verifies. I'll include that as a SHOULD for hubs. 

Also — **backdating**: I claimed chain + reader memory handles it. Let me double check the specific attack: hostile hub takes her REAL item #200 (a 2019 post) and re-serves it today as if she "just posted" it? The item's `at` timestamp is inside the signed payload — 2019. The hub can't change `at` (signature). It can re-serve old items but they're self-dating. It can truncate. It can't fabricate "she posted yesterday" (needs signature with current date — no key). So "alter or backdate what she wrote" (scenario 1) is fully covered: alteration breaks signatures; backdating requires forging a NEW item with an OLD date — impossible without the key; he could WITHDRAW items (censorship — availability). Also "splice" — reorder the chain — breaks prev links. ✔ Solid. One more: could he take her SIGNED item and serve it as belonging to someone else? Attribution is by `key` in payload + signature verification under that key — no. ✔

Media tampering: blob hash in payload ✔.

What about the hub withholding blobs while serving items (item verifies, media 404s)? Availability/degradation, named.

**Assurance 2 precise statement:** "Content addressed to chosen people is unreadable by anyone else, the host included." Our mechanism: circle symmetric keys, Hash-CTR, pairing-established. Failure modes: (a) member leaks key (hostile member = accepted threat per §2 — wait, §2 says the hostile operator is INSIDE the family, entitled to see family-only content. So for the FAMILY circle he may legitimately hold the key! The assurance must be read as: content addressed to a chosen set that EXCLUDES the host is unreadable by the host. If the host is inside the chosen set, nothing can help — the brief says so explicitly. So her defense in the divorce = new circles excluding him.) (b) no FS. (c) pairing channel compromise. All named. Also (d) brute-force of Hash-CTR — 128-bit keys, no. (e) implementation leaks (keystore). OK.

Now — wait, I should double-check the "hub learns" list for direct-channel tags: the direct-channel tag = H("dc-tag" || k_AB) is stable per pair and appears in BOTH people's logs (A's grant to B, B's grant to A?) — hmm: A sends B a circle key: item in A's log boxed under k_AB with tag T_AB. B replies: item in B's log boxed under B's circle key with tag T_circleB. Does B's log ever carry T_AB? If B sends A a direct message, yes — boxed under k_BA with tag T_BA = H("dc-tag"||k_BA). So the hub sees T_AB in A's log and T_BA in B's log — different tags (derived from different direction keys) — no cross-log linkage cryptographically. But if the hostile hub runs BOTH logs (big hub!), same operator sees both; still can't link T_AB ↔ T_BA without keys... they're independent hashes. But traffic/timing correlates. Fine — named as metadata leakage. Alternatively use the same pair key both directions with one tag: then tags MATCH across logs → the operator of both hubs (or any observer of both public logs — logs are public!) could link "A and B have a direct channel" — that's worse. Keep directional keys + distinct tags. ✔ (And note: even the tag itself in a single log just says "some direct channel exists" — to whom is hidden. Recipient anonymity ✔.)

Hmm, one subtlety: for B to DECRYPT A's boxed grant, B must know which key to try. B tries all its known direct-channel keys (few) against the tag — trivial. Same for circles. Key lookup by tag = local dictionary. ✔

Also, DMs: just a circle of... no — DM = direct channel item (boxed under k_AB), content arbitrary. Thread = items referencing each other by ID (inside ciphertext). ✔ Simple.

What about *who may fetch the log*? Logs are public (needed for cross-hub polling by arbitrary followers). Private content is ciphertext within. Blob URLs unguessable-ish (SHA-256) — but served to anyone who asks (ciphertext anyway). Hub MAY require auth for serving (its business model: only customers' followers?...) — but cross-hub needs anonymous fetch at least for interop... hub policy; hostile hub could demand login to fetch — friction, not compromise (readers in the family have accounts or the hub is commercial-public). Leave as deployment choice; note it.

**Item size / JSON**: photos not inline (blobs); text inline (b64 ct in payload — the payload includes ct as base64 in JSON — the payload is itself base64'd in the envelope — double base64 for ciphertext ~78% overhead on the *text* portion only. Meh but fine. Alternative: media-style blob for long texts? Allow `text` long posts to be blobs too. Fine: items may reference a text blob for >4KB bodies. Detail, mention in passing.)

Hmm, let me reconsider ONE more time whether per-item signatures + hash chain is overkill vs. simpler "signed items with timestamps, no chain." The chain defends: reorder, splice, fork-detection, backdate-with-stolen-old-item... backdating needs the key anyway. Reorder: timestamps inside signatures already fix order semantically (each item self-describes its time). Splice (mixing her items into someone else's feed): attribution by key ✔ without chain. Fork: without chain, hub serves subset — same as with chain (reader memory needed either way). So what does the chain REALLY buy? (a) compact staleness check (compare head), (b) tamper-evidence for DELETION order... deletion is possible anyway (hub truncates — chain doesn't prevent), (c) an anchor for "move" items and rotation pinning (monotonic seq is nice: "once you've seen seq n signed by old key, reject old-key items with seq>n" — that rule needed rotation security! With bare timestamps the same rule could use timestamps but timestamps are forgeable-ish... no, timestamps are signed by the key... but the THIEF has the old key → can sign items with any timestamp → fake "newer" old-key items. With seq + pinning: thief must produce seq > pinned n under old key — readers reject old key beyond pin. With timestamps: thief sets ts later — readers can't distinguish. So SEQ IS LOAD-BEARING for rotation security.) Keep the chain. Also chain gives "one number" for sync (`?since=seq`) — operationally valuable. ✔ Keep. Cost: strict append discipline. Fine.

Actually hmm, wait: with rotation pinning, "reject old-key items beyond pinned seq" — but the thief ALSO holds circle keys and direct-channel keys (device theft). The pin only protects the IDENTITY. Circle rotation post-theft is manual. Already noted.

Let me also think: **do readers need to fetch the whole log on first contact?** Log could be long (years). Fetch head + `?since=1` if wanted (archive). Hub serves ranges. First contact: fetch last N items + walk back as needed (feed pagination). Fine — `GET log` returns newest-first list with `?before=`/`?since=`. Keep simple: `?since=<seq>` returns items with seq > given, oldest-first, maybe capped with `next` link. Weekend-implementable. ✔

**The card/profile**: item type "profile" in the log (name, bio, avatar blob, hub URL). The hub additionally exposes `GET /hearth/<keyid>/card` = latest profile envelope + current move target (convenience). Hmm — "move target": after moving, the log (with move item) lives on the NEW hub; the OLD hub might keep serving the old log (frozen). A pointer at the old hub ("she moved to X") would be nice but requires the old hub's cooperation (hostile = won't). So moves propagate via link/gossip only. ✔ (Consistent with earlier analysis.)

**RSS URLs:** `/hearth/<keyid>/feed.json` (JSON Feed with `_hearth` envelopes), `/feed.xml` (Atom or RSS — say RSS 2.0, simplest). Hub-generated. Public items only; private items appear as… omit entirely (don't even show "private post exists"? Showing placeholders leaks timing/counts to feed readers — but the log is public anyway; placeholders in RSS are harmless and honest. I'll say: hubs SHOULD include a neutral placeholder ("private post") — actually for the STRANGER scenario cleanliness, default omit. Meh — decide: omit. Simpler.)

**Fediverse/Bluesky:** "with nothing extra built" — the publisher builds nothing; SOME bridge must exist for Mastodon visibility (RSS→Mastodon bridges exist as generic services; Bluesky has rss-to-bsky bridges; also the hub MAY implement ActivityPub outbox — recommended pattern: per-person actor URL = `/hearth/<keyid>/ap`... that's "extra built" by the HUB, not by the person; the brief says "reaches existing feed readers and the fediverse/Bluesky with nothing extra built" — nothing extra by whom? I read: the person/publisher does nothing extra; a generic bridge (like existing RSS bots) suffices. I'll state: any generic RSS→fediverse bridge works because we expose standard feeds; identity in the feed via extension fields lets bridges preserve attribution; inbound replies = extension (a bridge could translate mentions into inbox notifications with signed envelopes — actually a bridge CAN'T sign as the fediverse user under OUR scheme... inbound replies from Mastodon users would arrive as... unsigned-by-our-keys items. Extension: bridge posts them as items authored by a bridge-owned key with attribution metadata. Sketch in one paragraph, mark extension.)

**Now — the "big lazy hub" flat cost claim**: hub stores per identity: log (bounded by content), blobs (bounded), serves polls. No per-follower storage (followers poll). Notifications: inbound POSTs stored in inbox until fetched (bounded queue). ✔ flat per identity. The hostile-at-scale operator: same powers as divorce-ex (minus being inside circles): can read metadata, withhold, degrade, profile customers for ads (public content + timing). Cannot forge/read/hold. ✔ scenario 5 holds.

**Weekend implementer (scenario 6):** enumerate the minimal publisher: generate key; build payload JSON; sign; POST envelope+blob to hub with account token. Minimal reader: GET log; verify sigs (stdlib Ed25519 verify — available in Go/Java/Node/Python(3.13? no—cryptography pkg... hmm, Python: pynacl not stdlib. Honestly Python lacks Ed25519 in stdlib (hashlib has sha256; ed25519 is in... no). The brief asserts Ed25519 is stdlib-available — in Go (crypto/ed25519), Java (17+), Node (crypto.sign ed25519), Rust (needs crate). Fine — the brief set this premise; I'll note Rust/Python need one tiny crate/module but it's the same "level." Not my fight; brief says assume.)

Weekend reader: fetch, decode base64, verify, parse, render text posts; decrypt if keys present (SHA-256 + XOR — trivial). No canonical JSON anywhere. ✔ The design genuinely delivers this — that's the intellectual point the brief mentions (tension between no-deps and easy). My base64-envelope choice is exactly what resolves it.

Also — implementable hashing of "payload bytes": ID = SHA-256(p) where p is the decoded payload — unambiguous. ✔

Let me now also decide the **canonical URI form** for sharing: `https://hub/hearth/<keyid>` (person), `.../item/<id>` (item), plus keyid format: base64url(32-byte pubkey) = 43 chars. Display: `@Name#abcd1234` (first 4 bytes of SHA-256(pubkey) hex) — "Gran#9f2a". Handles within a hub for human discovery: hub directory maps name→keyid (advisory). Cross-hub handle display: `Gran#9f2a@hub.example` (cosmetic, resolves via that hub's directory then TOFU... with fingerprint check). OK.

**Guardian wrapping details:** wrapped = Hash-CTR(k=H("hearth-guard"||S), payload=JSON{seed... Ed25519 private key = 32-byte seed (SLIP-0010-style? Ed25519 private keys ARE 32-byte seeds; stdlibs take seed or expanded... Go: ed25519.PrivateKey is 64 bytes (seed||pub); seed = first 32. Spec: export the 32-byte seed.) plus root-key fingerprint, plus circle keys? Circle keys live in the app; guardian copy should include identity seed + (optionally) all circle keys + direct-channel secrets — else recovery restores identity but not circles! Include: full "keyring" = {identity seed, circles: [{tag, key, label}], channels: [{peer, secret}]}. Wrapped under S. Guardian stores blob. Recovery: unwrap → full restore. Also guardian copy updated on changes (app pushes new wrapped copy to guardians on key/circle changes). Simple. ✔ (And since guardian copies are in guardians' apps, hostile hub never sees them at all — better than log storage. But note: if guardian copy rides the direct channel (inbox), it passes through hubs as ciphertext — fine.)

Wait, direct channel messages ride the AUTHOR's log (public fetch). Guardian copies as log items? I said deliver to guardian app directly. Mechanism: POST to guardian's inbox (encrypted boxed envelope addressed by tag) OR via any channel. Simplest: the app sends boxed envelopes to the recipient's inbox endpoint (POST /hearth/<B>/inbox) — items NOT in any log, just relayed mail. Then circle grants don't clutter logs. But logs give durability/audit... Inbox items are ephemeral mail; circle keys should ALSO be recoverable — hmm, if B loses their phone: B's guardian restores B's keyring which contains circle keys — ✔ no need for log durability. OK: **direct messages and key grants go hub-to-hub via inboxes (push), posts/replies/reactions go in logs (pull).** Hmm wait — but then inbox delivery to an OFFLINE app: the hub holds inbox items until B's app polls its own inbox (inbox = per-person queue on B's hub). B's app polls/fetches inbox regularly (it's B's hub — even hostile hub holds B's inbox... hostile hub can DROP B's inbox items! Then B never gets the circle key → availability attack on grants. Mitigation: grants ALSO posted as boxed log items (belt and suspenders)? That reintroduces clutter... Decide: **grants are posted as boxed items in the author's log** (durable, gossip-able, visible to B whenever B fetches A's log — which B does anyway when following!) — and DMs use inboxes (ephemeral, fine). Hmm, but a boxed grant in A's log: B fetches A's log (B follows A), sees tag T_AB, decrypts with channel key, stores circle key. If A's hub is hostile and drops... it can't drop selectively? It can — it controls serving. But B polling A's log gets whatever hub serves; hub could hide the grant box. But hiding it also hides... hub can hide anything from B (availability). BUT gossip: B also receives A's log via witnesses? This is getting deep — accept: hostile hub can suppress specific items from specific fetchers (targeted censorship) — undetectable-ish (B could compare with another fetcher — "compare views" feature: apps could cross-check via a friend's mirror — witness items again. Mention as detection tool.) OK final: grants in log (boxed), DMs via inbox, notifications via inbox. And actually — hmm, DMs via inbox means the recipient's OWN hub stores them; recipient's app fetches; hostile own-hub drops them → you miss DMs (availability, named). Alternatively DMs also as boxed log items (then your DM history is in your log — durable, exportable, gossip-able — and "DM" = just a boxed item with a channel tag! UNIFORM: EVERYTHING is a log item; inboxes are only for notifications (tiny pointers). YES — that's cleaner and more minimal: **one artifact (the log), one relay crutch (the notification inbox).** DM = boxed item in your log addressed by channel tag; the peer finds it by following you (notifications make it timely). Circle grants = boxed items. Guardian copies = pushed to guardian app (out of band, since they're about bootstrapping). Uniform. I like it. Cost: your log carries your DMs — fine (it's your log; you export it when leaving — assurance 3 covers DMs! "private messages... all live on it" — the divorce scenario mentions private messages — and our design moves them WITH her ✔ — nice, this uniformity directly serves scenario 1's "private messages" clause.)

Wait, but a DM in MY log: the recipient reads it from MY log. A reply-DM in THEIR log. Thread = cross-referenced IDs. Fine. Inbox notification: "B has a new item" → A fetches B's log tail. ✔

Reactions: `{type:"react", box:{...}}` in reactor's log targeting ciphertext-hidden item ID. Aggregation for A = scan followed logs for react items whose decrypted `to` matches A's item IDs. Polling all follows on every poll — family scale (dozens), fine.

**One more check — "The host cannot speak for you... the key that signs was never the host's":** what if grandma onboards ON THE HOSTILE HUB via a web UI (no app)? Then the hub generates the key → owns her! Rule: **the spec must mandate client-side keygen; a pure-web onboarding (server-generated key) is out of conformance.** Web apps CAN do client-side keygen (WebCrypto Ed25519 — now in browsers! Safari/Chrome/FF support Ed25519 in WebCrypto as of 2023-2025 — mostly yes). Note: browser keys need export + guardian wrapping (localStorage). Doable but flag as weaker path. Grandma uses a native app anyway (scenario 2: "installs an app").

Alright — I also want to name the rejected alternative for **identity: web-of-trust/PKI (PGP)** — keys + manual verification is exactly the pairing/fingerprint story we do have (we DO have fingerprints + pairing — it's a lightweight TOFU+verify model). Fine to mention.

And rejected: **content addressing as identity (IPFS/CID of profile)** — still needs a key to update; same thing plus a DHT (rejected).

**Now, the writing plan** (~4,500-5,500 words, dense but organized, with byte shapes). Sections:

0. Preamble: name (Hearth), the one-sentence thesis: identity is a key you keep, content is a log you sign, privacy is symmetric keys you hand-deliver, hubs are dumb disks. Also the honest framing of the adversary: we cannot beat an insider; we make his powers merely-negative (withhold), never positive (forge/read/lock).

1. Architecture one-pager:
- Artifacts: keypair (device), the log (envelopes), blobs, inbox, directory, RSS projections. Table with purpose/signature.
- Envelope shape; item payload shape; boxed shape.
- Endpoints list.
- First contact flow; poll flow.
- Roles: app (does everything), hub (dumb HTTPS storage + relay), bridge (optional).

2. Identity: the root key; person = chain of keys; handle = signed attribute; location = signed attribute (log itself). Rejections: domain/did:web, did:plc/shared-ledger, AP URL, keyless handles. Prior art acknowledgment (SSB nearest; ATProto's separation of identity from hosting is the same insight; ours is the stdlib-only distillation).

3. Four assurances with mechanisms + failure modes. (Four subsections.)

4. Scenarios 1-4 (walk-throughs, concrete), with brief 5-7 coverage maybe folded elsewhere or short bullets.

5. Key lifecycle: rotation, theft, loss+guardians, contested departure (the "frozen prefix" argument + witnesses as notarization). Multi-device note.

6. Crypto spec (implementable): envelope, signing, chain, cipher (HCTR) with pseudocode, key derivations, tags, blobs, pairing, grants, what-the-hub-learns list. Also why-not-X25519 note (palette; and the insider-adversary argument that group keys are semantically sufficient; X25519 as upgrade path: if available, per-recipient wrapped keys become possible — but DON'T need it).

Hmm wait, actually let me reconsider X25519 once more, because a reviewer might say "just use X25519, it's basically Ed25519's sibling." The brief's palette is explicit and priority #1 is #1. Also — deeper: even WITH X25519, per-recipient crypto doesn't improve the floor against the stated adversary (insider), and it costs: recipient enumeration (privacy!), per-recipient wraps (audience visible on the wire — violating "addressed without publishing the audience"! With sealed boxes, the wrapped keys must appear somewhere with recipient keys → publishes the audience (unless anonymous tags/oblivious tricks — complexity explosion: key privacy needs anonymous IBE or ring-like constructions — NO). So symmetric circles are not just palette-compliant; they're BETTER for the audience-hiding requirement. That's a strong argument to make explicitly. The cost: pairing friction + no FS + member-leak blast radius. Great — this is the intellectual center of my answer.)

7. Cost sheet (bulleted, honest): FS absence; pairing UX; leakage list; availability attacks; single-writer; TOFU; web-RSS trust; multi-device conflicts; media mirror size; recovery trust in guardians; Hash-CTR nonstandardness; discovery after domain death for strangers; no search; moderation = local.

8. Cut list if halved: inbox notifications (pure polling), witness/gossip (rely on links), reactions, Atom/RSS variants (keep JSON Feed only?), multi-hub directories (links only), maybe even DMs (circles only). Order by what preserves the floor: the floor needs: envelopes/log/chain, circles+pairing, move+guardians. Everything else is cuttable. Also cut: blob encryption header generality, JSON Feed extension... etc.

Also throughout: flag uncertainties honestly (I'll mark 3-4: Hash-CTR comfort; single-log-forever growth vs. log compaction (hmm — logs grow forever; archival/rotation of logs — non-goal says not millions of items; a decade of family posting = 10-50k items — fine, note compaction as open issue); the 1-of-N guardian default; notification inbox abuse (spam) — hubs should rate-limit; TOFU UX).

Let me draft concrete byte shapes now, carefully, since deliverable 6 wants implementable detail.

Envelope:
```json
{ "v": 1, "p": "RXhhbXBsZQ", "s": "c2ln" }
```
- p: base64url(SHA-… no, p = the payload BYTES (a UTF-8 JSON document), base64url-encoded.
- s: base64url(Ed25519-sign(p-bytes) with the author's current key).
- id = "i" + base64url(SHA-256(p-bytes))? Just base64url(SHA-256(p)) — 43 chars.

Payload (public post):
```json
{
  "type": "post",
  "key": "<author pubkey b64u>",       // the signing key
  "seq": 41,
  "prev": "<id of seq-40>",
  "at": 1735689600,
  "text": "Dinner at six.",
  "media": [ { "blob": "<b64u sha256 of stored bytes>", "type": "image/jpeg", "bytes": 204800 } ]
}
```
Private item:
```json
{
  "type": "box",
  "key": "<...>",
  "seq": 42,
  "prev": "<...>",
  "at": 1735689900,
  "tag": "<b64u H('hearth-tag'||circle_key)>",
  "n": "<b64u 16-byte nonce>",
  "ct": "<b64u ciphertext>",
  "media": [ { "blob": "<...>", "type": "image/jpeg", "bytes": 99900 } ]   // blobs encrypted, referenced by ct? 
}
```
Hmm — media for private items: the blob refs must be findable... put media list INSIDE the ciphertext (the decrypted plaintext is a JSON doc with text/media/to/etc.). The outer payload for a box carries ONLY: type, key, seq, prev, at, tag, n, ct. Where do media blobs get fetched? Their IDs are in the plaintext. Blob fetch: `GET /hearth/<keyid>/blob/<id>`. Blob layout for private: `"HRTH1" || nonce16 || ct`; decrypt with key = H("hearth-media" || K_circle || nonce). Public blob: raw bytes (maybe with MIME from item). Blob id = SHA-256(stored bytes). ✔

Decrypted box content ("inner content doc"):
```json
{ "text": "...", "media": [...], "to_item": "<id>", "to": "<peer root keyid>", "grant": {...}, ... }
```
Types inside boxes: the outer type is always "box"; the inner doc has its own "t": "post"|"reply"|"react"|"dm"|"grant". Wait — should outer type distinguish reply for public items? Public reply: outer type "reply" with to/to_item in clear. Private: outer "box", inner t. Fine — define outer types: post, reply, react, profile, move, rotate, box. Box hides the inner type. ✔

Direct-channel item: outer type "box" with tag = H("hearth-tag" || k_dir) where k_dir = H("hearth-dc" || S || "1" || pkA || pkB)... let me define pairing-derived keys cleanly:

```
S  : 16-byte random pairing secret (exchanged out-of-band, e.g. QR)
kA = SHA-256("hearth-dc1" || S || pkA || pkB)   # A→B direction key (A is sender)
kB = SHA-256("hearth-dc2" || S || pkA || pkB)   # B→A
```
Hmm — simpler: one key k = SHA-256("hearth-dc" || S); tags differ per direction... no wait I argued directional keys prevent cross-log tag linkage. But actually with ONE key k, tag = H("hearth-tag" || k) same in both logs → linkage. With directional keys: A's boxes to B use kA (tag TA), B's boxes to A use kB (tag TB), TA≠TB ✔ and B knows both (derived from S + ordered pubkeys) ✔. Keep directional.

Cipher (call it **HCTR**):
```
stream(k, n, i)  = SHA-256("hearth-ctr" || k || n || be32(i))    # 32 bytes
enc(k, n, pt):  ks = concat(stream(k,n,0..ceil(len/32)-1)); return pt XOR ks[0:len]
```
Item text key: k_item = SHA-256("hearth-item" || K_circle || n). Media key: k_blob = SHA-256("hearth-blob" || K_circle || n_blob). Direction/circle tag: tag = SHA-256("hearth-tag" || K) truncated 16 bytes? Full 32, b64u. Nonces 16 random bytes. Never reuse (k,n). ✔

Grant inner doc:
```json
{ "t": "grant", "circle": { "tag": "<t>", "key": "<K_circle b64u>", "label": "Family, minus Dave" } }
```
Revoke = rotation: new key, new grants to remaining members; members keep old key (archive readable). Optionally an inner "revoke" note for UX.

Rotation item (outer, signed by OLD key):
```json
{ "type": "rotate", "key": "<old pk>", "seq": 900, "prev": "<...>", "at": ..., "to": "<new pk b64u>", "why": "recovery" }
```
Then the new key's log begins: payload signed by NEW key with `{"type":"post"..., "key":"<new pk>", "seq":1, "prev":"<rotate item id>", "root":"<root keyid>"}` — wait, `prev` points into the OLD key's chain; the new chain's seq restarts at 1 (or continues? continuing seq across keys complicates the pinning rule "old key beyond seq n"; restarting at 1 with prev pointing at the rotate item keeps each chain internally 1..n and the LINK is the signed rotate + prev. Pinning rule becomes: a reader accepts old-key items only if they chain to a prefix ending at or before the rotate item; equivalently the rotate item's position n bounds the old key. Reader rule: person = list of (key, chain) segments linked by rotate items; root = first key ever. ✔ Display id stays root-keyid... or a short fingerprint of root key. Follower records: root, current key, last (segment, seq, id).)

Move item: `{"type":"move","key":...,"seq":...,"prev":...,"at":...,"to":"https://new.example/hearth/<keyid>/"}` — appended (from wherever) — the reader fetches new URL, verifies chain continues. Multiple moves chain naturally. ✔

Profile item: `{"type":"profile", ..., "name":"Gran", "about":"...", "avatar":"<blob id>"}`.

React: `{"type":"react","to":"<root keyid>","to_item":"<id>","emoji":"❤️"}` (public) or boxed.

Reply: `{"type":"reply","to":"<root keyid>","to_item":"<id>","text":"..."}` or boxed with inner t:reply.

Notification (inbox POST body — this is NOT a log item; it's a small signed note from the POLLER's app (or hub?) — who signs it? The sender's app signs: `{from: <B keyid>, root:..., feed: <B feed URL>, head: <B latest item id>}` — A's app trusts nothing but uses it as a fetch hint; even hostile-forged notifications only cause wasted fetches (DoS-ish, rate-limit). Actually hubs could also notify each other (hub-to-hub push: family.example POSTs to a.example "my user B posted" — but hubs are untrusted; treat as hints only. Simplest: apps notify apps via recipient hub inbox; hubs MAY relay too. All hints, always verified by fetching. ✔ Spam: inbox rate-limited by hub; hints untrusted anyway.)

Endpoints (hub):
```
GET  /hearth/<keyid>/log?since=<seq>&limit=       → [envelopes] oldest-first
GET  /hearth/<keyid>/item/<id>                    → envelope
GET  /hearth/<keyid>/blob/<id>                    → bytes
POST /hearth/<keyid>/inbox                        → notification hints
POST /hearth/<keyid>/item   (auth: hub account)   → append envelope (hub SHOULD verify sig & chain locally)
POST /hearth/<keyid>/blob   (auth)                → store bytes
GET  /hearth/<keyid>/feed.json | feed.xml         → unsigned projection (public items)
GET  /hearth/dir?q=name                            → advisory directory
```
Hub account auth = whatever the hub likes (token). Emphasize: credentials ≠ identity.

First contact: resolve link → GET log (tail) → verify (root/current key chain, seq continuity, prev links, per-item sigs) → render; if box tags match local keyring → decrypt. Poll: GET log?since=last seq (+ conditional GET/ETag), verify, render; fetch blobs on demand; also poll inbox + followed logs (or rely on notifications). ✔

Now the four assurances section — mechanisms + failure modes (tight):

A1 (cannot speak for you): client-side keygen; every artifact an envelope signed by device key; verification mandatory; attribution = key field + signature. RSS/HTML projections are unsigned cosmetics (named failure: plain-RSS consumers trust the hub like today's web; JSON Feed SHOULD carry `_hearth` envelopes for verifiable readers). Backdate/alter: covered (sig covers at/seq; chain covers order; reader-stored head detects truncation/stale). Failure mode: hub may replay old authentic items to naive new fetchers (mitigated by dates/chain-head comparison), and may serve subsets (censorship — availability class).

A2 (cannot read): circles (symmetric 128-bit keys) + HCTR + tags; keys delivered via direct channels established by out-of-band pairing; hub stores/serves only ciphertext; blobs encrypted; even metadata (recipient, subject, media names, reply-targets) inside ct. Recipients hidden: no audience list anywhere; only per-circle tag. Failure modes: member leakage (accepted: insider); no FS (archive opens on leak); pairing-channel compromise; device compromise. Also — the hub sees the tag; tags are stable per circle → item clustering. (Could randomize tags per item? Then recipients can't find which key... they'd try all keys against each item — actually feasible (few keys, trial-decrypt by attempting tag match? tag is derived from key — try each key, compute tag, match — works with per-item random tags? If tag must equal H(key) it can't be random. Alternative: no tag at all; readers trial-decrypt every boxed item with every held key (HCTR has no cheap authentication... trial decrypt = full decrypt + JSON-parse sanity — ugly, false positives possible. Use an AEAD-ish check: include a checksum inside ct: first 4 bytes of H("hearth-chk"||k||n)? Then trial-decrypt is cheap and unambiguous. Then NO tags at all — boxed items are fully anonymous (no circle clustering visible!). Cost: every reader tries every key per box (m keys × 1 hash each — trivial). Hmm — but then the reader can't CACHE which key worked... it can (store item→key mapping locally). I like it: **tagless boxes with key-check bytes** — better privacy (hub sees only "a box", not "same-circle clustering"). But wait: the GRANT flow uses direct-channel boxes — how does B know which channel key to try? Same trial mechanism. And how does B know a box is FOR them at all vs. for another circle? It tries all keys; if none work, not for them (they skip). ✔ This also fixes: same-circle items across... hmm wait, actually there IS one loss: with tags, a follower's app could skip boxes quickly; with check-bytes it's still fast (one SHA-256 per key per box). Fine. DECISION: boxes carry {n, ct, chk} where chk = first 8 bytes of SHA-256("hearth-chk" || k || n); decryption: for each candidate key k_i: compute chk; if match, decrypt with H("hearth-item" || k_i || n). Trial cost O(keys). No tags on the wire. Wait — but is chk safe to publish? It's a hash including the secret key — like a key fingerprint — offline brute-force? Keys are 128-bit random — no. It does let anyone with the key CONFIRM they have it (fine, they can decrypt anyway). And it leaks nothing to others (preimage-resistant). ✔ Good refinement. Hmm, but one more consideration: multi-recipient direct grants — B tries channel keys AND circle keys; first match wins. ✔ Simple loop.

Hold on, one more edge: A's OWN app needs to decrypt her own old boxes after device restore — she has all keys (keyring). ✔

A3 (cannot keep you): key + full local mirror (log + blobs + keyring) on device; identity independent of hub; leaving = upload mirror anywhere + move item + share link; hostile hub's refusal is irrelevant (no permission to withhold — the only "permission" is serving, which you no longer need). Failure modes: device loss without guardians (identity death — non-goal for strangers, guarded against for family); media mirror size (app policy, flagged); the ex keeps serving stale copy (detectable, cannot extend).

A4 (first-class across hubs): all coordination is person-to-person cryptographic: cross-follows (fetch any hub's log), cross-replies/reactions (items in own log + notifications/gossip), circles spanning hubs (keys held by people, not hubs). No hub-to-hub contract. Failure: hostile hub suppresses notifications/cross-fetches (mitigation: mutual polling, witness gossip, leaving).

Scenario walkthroughs — write 1,2,3,4 in concrete narrative with byte-level beats, plus short 5,6,7 paragraphs (6 is basically "the whole spec is ~6 endpoints + 1 cipher + 1 envelope — here's the weekend checklist"; 7: feeds + bridge + re-meet).

Key change & recovery section: rotation flow; theft flow (pin rule); loss+guardian flow (restore, then rotate — and note WHY rotate after restore: unknown exposure window; the rotation protects identity, not circles — circle hygiene needs re-grant/re-pair — honest); contested departure: the "longest valid chain / signed divergence point" argument + witnesses as timestamping; note the unfalsifiable "he stole her key" counterclaim and why we don't solve it (it's the insider problem again — the claim "her departure is a forgery" requires her key to have been stolen; any evidence we accept for that would let a hostile operator fabricate departures... hmm actually let me think: could he FORCE a fake "she departed"? No (needs key). Could he UNDO her real departure for some followers? Only by serving them the frozen prefix — stale, detectable, and once they see the longer chain anywhere they pin past it. The one nasty case: followers who NEVER see the longer chain believe she's still there, silent. Social fix: the family notices. Also: her move item could be WITNESSED by relatives — their witness items are in THEIR logs (which he doesn't control!) — so the public record on other hubs proves the departure is authentic and dated. ✔ That's the answer to "contested departure": distributed witnesses.)

Crypto section: full pseudocode for HCTR, derivations, box format, blob format, pairing, grant, keyring/guardian wrap. Include the "what the hub learns" list: feed fetch patterns, box count/timing/size, seq/timestamps (public chain skeleton), inbox edges (graph), no content, no audience, no circle clustering (tagless), media sizes (blob sizes), and correlation via timing across its own users. Also cross-log reply-graph is hidden (to/to_item inside ct) — but notifications reveal edges; mutual-follow polling reveals edges via access logs. Explicit.

Cost sheet — as listed. Also include: log compaction absent (forever-growing log; non-goal shields us at family scale); single-writer; TOFU; RSS unsigned; no search/discovery beyond hub directories & links; spam/abuse on inbox & hub signup (hub policy); the pairing burden for large audiences (a "family-only" post to 200 people = 200 pairings — realistic families are ≤30; commercial-hub users mostly pair within small groups — fine but named); multi-device conflict display; guardians-as-weak-point; HCTR novelty; no message deletion semantics (tombstone items — hub may ignore; deletion = ask hub + tombstone in log + everyone's cache honors; the hostile hub keeps serving deleted ciphertexts (availability/privacy-ish: deleted-from-log but still-fetchable by ID if you know it — blob IDs unguessable, item IDs enumerable via seq... hub can enumerate old items — deletion is best-effort vs. hub! Name it. Mitigation: rotate circle after sensitive deletion — nuclear. Honest.)

Cut-if-halved: inbox, witnesses, react, RSS/Atom (keep JSON Feed), directory, DM inner-type (reuse post), maybe even move-item (replace with: new card at new hub + link re-share)... but move items are cheap and load-bearing for scenario 1 — keep. Cut order: notifications → witnesses → reactions → directory → Atom → multi-media-types (images only).

Also, the brief asks in deliverable 2 to "argue against the alternatives you rejected" — do that crisply for: domain identity, registry/DID-plc, AP-URL, SSB (as "nearest prior art — why not just SSB": its transport (secret-handshake, private groups w/ curve25519 & ephemeral group IDs, multiserver addresses, no stdlib-only path, JSON with its own canonicalization issues — actually SSB uses... it signs JSON with its own encoding... it's notoriously hard to implement in a weekend; and it lacks plain-HTTPS/RSS interop — its sync is its own RPC; bridging requires gateways). Also ATProto (identity via DID + signed DID docs — good bones! — but the reference stack needs PLC or did:web, plus PDS machinery, plus appview centralization pressure; our design is "the load-bearing 10% of that idea on stdlib primitives." Also Matrix (federation-heavy, server-owned accounts), Nostr (CLOSE! key identity + relays + NIP-04 encryption (deprecated, uses... NIP-44 now — ECDH-based) — nostr is genuinely close: relays = hubs, keys = identity. Why not nostr: (a) relays don't store persistent per-person logs (events float; no chain/ordering guarantees — no backdating defense beyond timestamps; well events have created_at signed — same as ours w/o seq... they lack chain/pinning → weaker rotation security); (b) NIP-04/44 private messaging is per-recipient ECDH (needs X25519/secp256k1 — palette violation; publishes recipient pubkeys → audience visible!); (c) no audience-hiding; (d) the ecosystem's discovery is... relays lists. So: "Nostr is the closest living system; we differ on three load-bearing points: the per-person signed chain (ordering/backdate/pinning), symmetric circles with hidden audiences, and the always-local mirror+guardian story. If nostr added a chain and tagless boxes it would converge toward this." Good, honest prior-art treatment — the brief says "if you believe an existing one already solves this, say so" — I'll say none fully does, SSB and Nostr are nearest, and why.)

I should also explicitly answer the brief's §3 challenge: "If you think one of these four is unachievable... say so." My position: all four are achievable; assurance 2 needs the careful reading (insider caveat given by the brief itself); assurance 3's "everything you wrote" includes media — device storage policy caveat; assurance 4 holds with availability caveats (hostile hub can suppress). State these readings up front — precision about what "holds" means.

Also the non-goal "traffic-analysis resistance beyond hiding who an encrypted message is for" — our tagless boxes hide the audience ✔; we do nothing about timing/size ✔ named.

One more design point I should nail: **grandma is "never shown a key"** — onboarding UX: app generates key silently, keystore-backed; pairing QR shown as a friendly "connect with daughter" flow; fingerprints appear only as short colored word-codes maybe ("Gran #amber-otter")? Keep it: display = `#` + 4 hex bytes; the pairing QR itself carries full identity. Fine.

And "never told to store a file outside the house": guardian copies flow app-to-app automatically; her hub is "in the house" (or the daughter's). ✔

Also scenario 2 says "A year later she loses her phone. She is back by calling her daughter." — walk through: call → daughter taps "help Gran restore" → shows QR / sends link → gran's new phone scans → app fetches wrapped keyring from daughter's app (over the new pairing channel — wait, the wrapped keyring is encrypted under the OLD pairing secret S. The daughter's app holds S? The daughter's app holds its OWN copy of S (pairing secrets are shared). So daughter's app can unwrap? It holds S, so it COULD unwrap grandma's keyring — yes: guardians CAN unwrap (they hold S) — that's the 1-of-N weakness restated: guardians hold channel secrets AND wrapped keyrings → they can restore the key at will (impersonation). Honest cost, named. Alternative: wrap under a secret S' that the guardian does NOT hold... then gran's new phone can't get S' either (phone lost). So the guardian must hold the unlock path. Unavoidable for phone-call recovery: **whoever can restore you can impersonate you.** Mitigations: rotation-on-recovery + followers pin; witnesses/alerts on rotation ("your contact rotated keys — tap to confirm"). Name it as THE trust trade-off of scenario 2. Alternatively K-of-N (Shamir) so no single guardian suffices — offer as option; default 1-of-N to match "calling her daughter." Also possible: guardian holds share, gran holds... nothing (phone lost). Yeah.)

Also the initial pairing for guardians: at onboarding the DAUGHTER is present (she set gran up) → same QR flow doubles as guardian pairing. ✔ elegant.

What about the daughter herself being on the hostile hub? Guardians should ideally not share the hub — note as guidance, not protocol.

Let me reconsider one thing: the brief's assurance 2 phrase "content addressed to chosen people" — maybe they intend per-recipient addressing (choose people, not circles)? Our circles ARE chosen people (a set chosen at grant time). A DM is a circle of 1. So "chosen people" ✔. Good.

Also — "replies coming back [from feed readers/fediverse] is an extension, not a requirement" ✔ we treat inbound bridge replies as extension sketch.

Now — the writing itself. The brief wants "argued design," 4,000+ words OK. I'll write with headers, tight prose, concrete shapes, named rejections, flagged uncertainties. Use minimal fluff. I'll aim for maybe 4,500-5,500 words. Format: markdown headers, code blocks for shapes, occasional bold for key terms. No giant tables except maybe one artifacts table. Given the depth requested, long is right, but I must keep every section earning its length — argued, not encyclopedic.

Let me make sure I cover ALL 8 requested returns:
1. Architecture one page ✔ (§2)
2. Identity primitive + rejections ✔ (§3)
3. Four assurances w/ mechanisms + failure modes ✔ (§4)
4. Walk-throughs 1,2,3,4 ✔ (§5) — include 5-7 briefly (brief says "at least 1,2,3,4")
5. Key change & recovery incl. contested departure ✔ (§6)
6. Encryption construction implementable + audience hiding + hub learns ✔ (§7)
7. Cost sheet ✔ (§8)
8. Cut list ✔ (§9)

Also weave in: the "tension between no-deps and easy = the intellectual point" — my base64-envelope + HCTR + trial-decrypt trio IS that resolution; call it out.

Names: protocol "Hearth". Envelope "envelope". Log "log". Boxes "boxes". Circles "circles". Pairing "pairing". Guardians "guardians". Witnesses "witnesses". Root key "root key". Good.

Let me think about a couple more sharp details to get right:

**Verification rule (the heart of A1), stated precisely:** A reader accepts an item iff: (1) envelope's signature verifies under the payload's `key`; (2) `key` equals the current key of the person, derived from the root key via the chain of rotate items; (3) `seq` and `prev` chain correctly; (4) `at` is not absurdly far future (sanity); (5) seq monotonic vs. reader's stored head (regression → mark stale, don't accept as new). Person's stable ID = root key. First contact TOFU: root key comes from the link/QR/directory; after that, pinned.

Hmm, also: **should `key` field be required in every payload?** It's redundant with context but makes items self-contained (verify anywhere). Keep. Signature covers it. ✔

**Envelope outer "v"** for versioning. ✔

**Charset/Unicode:** payloads are UTF-8 JSON; base64url no padding (state it: "base64url without padding, RFC 4648 §5, '=' omitted" — one line, stdlib base64.urlsafe + strip =... Python needs .rstrip('='); fine, weekend-doable).

**Integers only, no floats** in payloads (canonical-safety for the INNER json? Inner JSON isn't signed directly (signature is over bytes) — so inner JSON quirks don't matter cryptographically! The payload bytes are signed; whatever JSON is inside is just parsed. Numbers-as-floats only matter if... they don't. One less rule! (Nice consequence of choice (a) — mention it.) Though `seq` comparisons: keep integers, sanity rule.)

**Multi-device:** the app treats the log as single-writer; devices sync via the hub (one device appends at a time; a simple lock UI "posting from another device…"). Conflict: two heads at same seq → both valid-signed; reader shows both + flags; author resolves by appending a "resolution" note? Honest: display-only. Fine, cost sheet.

**Deleted items:** tombstone item `{type:"delete", target:<id>}` — followers drop from views; hub SHOULD drop; hostile hub keeps serving → readers honor tombstones anyway when re-fetching (they see the tombstone later in the chain ✔ — tombstones are chain items AFTER the target, so any fetch of the tail includes them → even a hostile hub serving "old items without tombstones" only fools fetchers of the frozen prefix. ✔ nice property of chain-ordered control ops.)

**Log compaction:** open issue box: a "checkpoint" item could hash a compressed archive... defer, cost sheet.

**Hub signup abuse:** hubs can host squatters; identity keys prevent impersonation of EXISTING people; new-follow TOFU caveat. ✔

**What if the hostile hub MITMs fetches between apps?** Everything is verified end-to-end; TLS is transport only; hub serves bytes; even plain HTTP would be safe content-wise (though traffic visible — meh, HTTPS everywhere, fine).

**Clock skew:** `at` sanity only; ordering is by seq. ✔

**Idempotent uploads:** same item to multiple hubs — fine (content-addressed-ish by ID). ✔ Mirroring/federation = dumb copying; anyone can mirror anyone's PUBLIC log (helps availability! mirrors as gossip). Private content mirroring: ciphertext, harmless. Note: a hostile mirror can't inject (signatures). So **third-party mirrors are free replication** — nice for scenario 4/5 (a friend can pin your log). Mention.

OK — also one thing to sanity-check: **the divorce scenario's "he cannot... stop her leaving."** With us: her app has key+mirror; she signs up at a new hub (or her sister's hub) — requires no permission from him. Her followers get the link/gossip. "Stop her leaving" — he can't hold the identity (it's her key); he retains a stale mirror. ✔ One nuance: her NEW hub needs her to prove... nothing! She just uploads her log. The new hub trusts nothing (it SHOULD verify signatures to avoid hosting garbage — its choice). ✔ No protocol-level permission anywhere. ✔

**Scenario 3 bytes-level flow:** write it concretely (A posts boxed item on a.example; notification POST to family.example... wait direction: A posts; B gets notified — B is on family.example; the notification goes to B's inbox on family.example, from A's app (or a.example hub). Then B replies on family.example (boxed under B's circle key... wait B's reply must be readable by A: B's circle "family" includes A; A holds K_Bfam via B's grant (boxed in B's log under their channel key). A's app gets notified (POST to A's inbox on a.example — hostile? In scenario 3 hubs are just separate, not hostile) → fetches B's log → decrypts reply → renders. Reaction same. ✔ Also thread rendering: A's reader assembles: her item (her log) + B's reply (B's log) linked by to_item (inside B's box, A decrypts and matches). ✔ No hub config. ✔

I think I should also mention **why HTTPS+static-ish serving**: hubs are just file servers + a POST endpoint — the "dumb hub" of scenario 6: a static file server + tiny upload CGI. Weekend ✔. Could even be an S3 bucket + CDN (no logic at all) minus inbox (notifications optional). Mention.

**Prior-art paragraph placement:** in identity section mostly; a short "nearest neighbors" note (SSB, Nostr, ATProto, Keybase-style, PGP web of trust) with one-line why-nots. The brief says "if you believe an existing one already solves this, say so and make the case" — I'll say: none satisfies the palette+weekend+feeds floor simultaneously; Hearth is a distillation.

Alright — also the brief's §3 note "No confidentiality mechanism defeats someone who is inside the audience. The question is what remains true anyway." — I should have a short meditation: the design's answer = the hostile insider's powers are only ever NEGATIVE (suppress, withhold, degrade, delay) and never POSITIVE (fabricate, alter, repurpose, lock-in, read-exclusions). And even his negative powers are bounded by mirrors/gossip. That's the thesis sentence of the whole piece. Put it early.

One more mechanism decision: **who POSTs items to the hub — the app directly (with hub account token)?** Yes. Hub MAY offer web UIs for reading; writing requires the app (or a conforming web app doing client-side keygen). ✔

Also decide: **circles are author-scoped; keys random 32 bytes.** Grant includes label + key. Tag — removed (tagless boxes with chk). Wait — with tagless boxes, does the grant still need the "tag"? No tag needed at all! The grant = {label, key}. Boxes carry chk+ct. Reader trial-matches. Simplify accordingly. But hmm — one catch: the reader must know WHICH circle a decrypted box belongs to (for UI: "posted to: Family") — after successful trial-decrypt with K, look up K in keyring → label. ✔ Self-describing after decryption.

And **forward references**: box references to_item (parent) — decryption needed before matching threads — fine.

Also: **should public items be the default and private opt-in?** Yes — interop scenario 7 (public journal) is the default posture; circles for family-only. ✔

Right — one more possible objection to handle: "you're rebuilding SSB badly / why not just use Signal groups?" — Signal: central service (violates no-central), phone-number identity, server-held groups, no self-publishing, no feeds. Not aligned. Fine to skip or one line.

Now let me also prep the **"least sure" flags** (the brief rewards flagged uncertainty):
1. HCTR (hash-CTR) as the mandatory cipher — I'm ~85% comfortable; the alternative was mandating ChaCha20-Poly1305/AES-GCM (better-studied, but violates "stdlib-only" in Python-land... actually AES is in hashlib? No — Python: no AES in stdlib (ssl module has it internally, not exposed... actually `cryptography` needed). Yeah HCTR is the palette-compliant choice; flag it, offer AEAD as SHOULD-if-available upgrade? NO — interop needs exactly one mandatory. HCTR mandatory, note the upgrade path via version bit.) Hmm wait, actually let me reconsider — is there risk HCTR is subtly broken in a way SHA-256-as-PRF isn't? The construction is a prefix-keyed hash in counter mode. Standard result: if H is a PRF (random-oracle-ish), HCTR is a semantically secure stream cipher (IND$-CPA under distinct nonces). SHA-256 with secret prefix: length-extension doesn't apply (we don't reveal outputs... wait, WE DO reveal outputs — the keystream XORs the plaintext; if plaintext is known/guessed, attacker recovers keystream BLOCKS for those positions. But keystream blocks are position+nonce-specific; other items use different nonces. Recovering keystream for block i of nonce n reveals nothing about other nonces (PRF). Also reveals nothing about the KEY (preimage resistance) — well, "nothing" in the PRF sense. OK I'm comfortable; the real caveat: no formal standardization; call it out and move on. Also add domain-separation prefixes everywhere (done: "hearth-ctr" etc.).)
2. 1-of-N guardians default (availability vs. insider abuse).
3. Single log forever (compaction unresolved).
4. TOFU on first contact via bare handle.
5. The claim that out-of-band pairing is acceptable UX for the target audience (it's the linchpin of A2 and it's a social assumption — flag prominently).

Also flag: the **inbox** is an unauthenticated spam surface (rate-limit, hints-only).

I think I'm ready to write. Structure with numbered sections matching the 8 deliverables (mapped), plus a §0 thesis and §1 prior art folded into identity. Keep prose tight but argued. Target ~5,000 words. Use code blocks for byte shapes (short ones). Avoid over-tabling; one artifacts table is fine.

Let me draft mentally some key precise definitions to keep consistent:

- base64url, unpadded. Call it "b64".
- keyid/person id: b64(32-byte Ed25519 public key). Root key = first key of the person; person id = b64(root pk).
- envelope: `{"v":1,"p":b64(payload),"s":b64(sig)}`; sig = Ed25519 over payload bytes; item id = b64(SHA-256(payload)).
- payload common fields: type, key (current signing pk), seq (int ≥1, per key-segment), prev (item id or ""), at (unix sec int).
- types: post, reply, react, profile, move, rotate, delete, box, witness.
- box fields: n (16-byte nonce b64), chk (8-byte b64), ct (b64). chk = SHA-256("hearth-chk"||k||n)[:8]; key for ct = SHA-256("hearth-item"||k||n); stream blocks SHA-256("hearth-ctr"||dk||n||be32(i)).
- inner doc: JSON with t ("post","reply","react","dm","grant"), text, media[{blob,type,bytes}], to, to_item, grant{label,key}, etc.
- media blobs: public: raw bytes; private: "HRTH1"||n16||ct, key = SHA-256("hearth-blob"||k||n). blob id = b64(SHA-256(stored bytes)).
- pairing secret S (16 random bytes, out-of-band). Direction keys: kA→B = SHA-256("hearth-dc"||S||"0"||pkA||pkB), kA→B other direction "1". Hmm — ordering: use literal sender/receiver roles: A sends with k = SHA-256("hearth-dc"||S||pk_sender||pk_receiver). Both sides can derive both. Simple. ✔
- circle key: 32 random bytes; grant via boxed item under channel key; keyring = {root seed, circles:[{label,key}], channels:[{peer pk, S}]}.
- guardian wrap: keyring JSON → HCTR under kg = SHA-256("hearth-guard"||S_pairing_with_guardian) → blob stored in guardian's app.

Wait — guardian wrap key uses the pairing secret S shared with that guardian — but if S is ALSO the channel key seed to that guardian, and the guardian can derive channel keys anyway — consistent: the guardian holds S by definition. ✔ And the guardian copy is delivered... at onboarding in person (same QR moment). Updates pushed via channel. ✔

Also recovery flow detail: new phone pairs with daughter (new S'), daughter's app sends wrapped keyring over new channel — but the wrap is under OLD S (gran-daughter original S)... the daughter's app holds old S → it can unwrap and REWRAP under new S'. Or simpler: daughter's app just sends the keyring encrypted under the new channel key. Either way daughter's app sees the keyring in the clear momentarily (it could anyway — it holds old S). ✔ So recovery = daughter relays the keyring. Rotation after restore recommended (protects against daughter's future compromise & the unknown exposure window... actually rotation after restore protects against whoever found the phone; but the thief of the phone has the keyring only if unlocked... eh, rotate anyway, cheap).

Hmm, wait — there's one more wrinkle: after gran's restore+rotation, her CIRCLE keys and channel secrets from the restored keyring are also potentially compromised (phone thief). Circle hygiene: re-grant circles (new keys) to members via channels — but channels' S secrets are ALSO in the keyring (compromised!) → re-pairing needed out-of-band. So post-theft hygiene = new pairings (a "re-key dinner"). Name honestly. OR: guardians' wrapped copies could exclude channel secrets... no — they're needed for full restore. Accept + document.

Also — I realize I should double check the **"never shown a key"** for grandma more: onboarding flow: (1) install app; (2) "Who's helping you? / scan this from your daughter's phone" → the daughter's app shows QR containing S (and optionally her identity). (3) app asks "where should your page live?" default daughter's hub (or gran picks commercial). (4) done. The QR is the pairing; the daughter's app auto-becomes guardian. ✔ No key material shown to humans ever. ✔

Now the RSS/JSON Feed shapes (brief):
JSON Feed: standard; each public item → entry; extension `"_hearth": {"p":..., "s":..., "id":...}` for verifiable readers; author name from profile; URL = item permalink endpoint (which serves the envelope + HTML?). Hub MAY serve an HTML page per item for permalinks (nice for the web). Fine, one paragraph.

Mastodon: generic RSS-bridge bots subscribe to feed.json/xml → posts appear from the bridge account or a per-person bridge actor; nothing built by publisher. Bluesky: rss-to-bsky bridges exist similarly. Note attribution caveat. One paragraph + honesty note.

Alright, also quickly: **"The hub's per-identity cost stays flat"** — state: hub does O(1) crypto per item (verify on ingest optional), O(size) storage per identity, O(poll) serving; nothing scales with followers or circles except serving traffic. ✔

And **scenario 6 "third writes a dumb hub that serves both"** — dumb hub = static file server with upload auth; list the 6 endpoints; ~200 lines. ✔

I want to open the piece with the thesis and the adversary meditation (short), then go. Also I'll add small "rejected alternative" call-outs inline per the brief's ask ("where you make a nonobvious choice, name the alternative you rejected").

Given length constraints of an answer, I'll write efficiently — dense paragraphs, avoid repeating. Let me now write the final answer. I'll aim for clear markdown with section headers. Roughly:

# Hearth — a design
## 0. The thesis / reading of the adversary
## 1. Prior art, honestly (short — why not SSB/Nostr/AP/ATProto)
## 2. Architecture in one page (artifacts, endpoints, flows)
## 3. Identity
## 4. The four assurances
## 5. Scenarios (1–4 detailed, 5–7 compact)
## 6. Key lifecycle: rotation, theft, loss, contested departure
## 7. The encryption construction (implementable)
## 8. Cost sheet
## 9. What I'd cut

Maybe merge 1 into 3. Keep as its own short section actually — the brief explicitly invites "if an existing one solves it, say so."

Let me write it now, carefully, keeping consistency of all names/fields. I'll keep code blocks minimal but precise. Length watch: I'll try ~5k words. That's acceptable per brief ("rather read 4,000 words...").

A few more consistency decisions while writing:

- Person ID display: `#` + first 6 hex of SHA-256(root pk)? Keep "Gran#3f9a2c" style, define precisely: 4 bytes → 8 hex.
- The `at` field: seconds. Sanity: reject > now + 1 day.
- `since` param on log GET.
- Move item: also allow "mirrors": list of extra URLs? Keep single `to` + note mirrors are free.
- Witness item: `{type:"witness", items:[{id, head...}]}` — actually simplest: witness embeds full foreign ENVELOPES: `{"type":"witness","env":[<envelope objects>]}`. Reader scans witness items for envelopes by followed persons; verifies + merges into that person's chain view. ✔ Timestamping: witness's own seq/at notarizes "existed by then."
- Delete/tombstone: `{type:"delete","target":"<item id>"}`.
- Rotate: `{type:"rotate","to":"<new pk b64>"}`; new segment genesis: seq 1, prev = rotate item's id, payload must include `"root": "<root pk b64>"`? For segments after the first, include root (self-certifying chain anyway; root field is convenience). Fine: common fields include `root` in all items? Cheap: include `root` always (b64 root pk). For the first segment, root == key. OK add `root` to common fields — helps witness merging. Yes.

Hmm, careful: rotate item is signed by OLD key and its `key` field = old pk; new segment items signed by new pk with `key` = new pk, `root` = root pk. Reader tracking: person(root) → segments[(pk1, head)...(pkN)] via rotate links. Pinned: once rotate at seq m seen, old-key items with seq>m rejected. ✔

- The contested-departure resolution rule stated as: "the longest chain that extends your stored prefix wins; a chain that forks your stored prefix without a rotate is a display conflict, not an override."

- Notification body: `{"from":"<b64 pk>","feed":"https://...","head":"<item id>"}` unsigned? Signed by sender app (cheap, prevents junk attribution — but it's only a hint; sign anyway: it's one line). OK: signed minimal envelope with type "ping" — hmm, notifications aren't log items; define them as the same envelope format with payload `{"type":"ping","feed":...}` signed by the SENDER's key; recipient treats as hint. ✔ Uniform crypto, no new formats. 

- Hub auth for POST: `Authorization: Bearer <hub token>` — hub-specific, out of protocol scope (state it).

- Content types: envelopes `application/json` (they're JSON with b64 fields — fine!). Blobs: `application/octet-stream`.

Good. Also make explicit: **everything the hub stores is either (a) an envelope (signed), (b) a blob (hashed), or (c) an unsigned projection (RSS/HTML/directory) that nobody trusts.** Nice invariant to state — "the hub is untrusted disk; trust lives in signatures and keys."

One more scenario-1 detail: "he cannot... read her family-only posts" — her family-only posts while married (he's family — he CAN read those by design/threat-model!). Hmm — scenario 1 says "He cannot post as her, read her family-only posts..." — wait, but §2 said the adversary is inside the family, entitled to see family-only content... Let me re-read scenario 1: "A woman's account lives on her hostile ex-partner's hub. He cannot post as her, read her family-only posts, alter or backdate what she wrote, or stop her leaving."

"ex-partner" — post-divorce! So by the time he's hostile, he's OUT of the family audience — she's re-keyed circles to exclude him. So "cannot read her family-only posts" = the post-divorce circles (and going forward). But ALSO possibly: during the marriage she posted family-only content he was entitled to; after divorce, the ARCHIVE of those — he keeps readable copies (he was a legitimate audience member; threat model accepts). But the scenario says "read her family-only posts" flatly — maybe they mean going forward + newly-addressed content. I'll handle precisely: (a) new posts after she excludes him: unreadable ✔; (b) old archive from when he was inside: he can still read what he was entitled to — I'll note this explicitly as the honest reading of "no confidentiality defeats an insider," and note she can also pre-emptively... can't retroactively un-read him. BUT she can control the ARCHIVE going forward in one way: when she leaves, she takes the archive; his frozen copy he can read (old family posts) — accepted. Hmm, could she have posted even during marriage with "family minus husband" circles? Sure, circles are arbitrary — but that's a social act, not a protocol one. Protocol delivers: circles arbitrary at all times. ✔ State this reading explicitly in scenario 1 — good place to show precision.

Also scenario 1: "her mother's app follows her with one tap" — the link share. ✔ "his frozen copy of her old content reads as stale rather than as her" — stale detection: followers' stored heads + move item + witnesses. Also: even a fresh stranger fetching his copy sees items ending at seq N dated ≤ T with no extension — and if they ever see her real chain, prefix-match proves his is a truncation. ✔

Okay. Also should I mention **archive/export format**: "your stuff" = the log + blobs; export = directory of envelopes + blob files + keyring backup. Trivially copyable. ✔ one line in A3.

Also mention **hub choice for gran default: daughter's hub** vs commercial — both fine; hostile-hub residence is survivable by design (that's the whole point) — hubs differ only in availability/UX, never in power. Good line: "hub choice is a hosting decision, never a trust decision."

NOW: write. Keep an eye on making it skimmable: headers, bold key terms, code blocks. No em-dash overuse... whatever, style: professional, direct, first-person designer voice ("I", "we"). The brief wants argued design — voice it as decisions with reasons and rejected alternatives.

Word budget per section roughly: thesis 200; prior art 350; architecture 600; identity 500; assurances 900; scenarios 1100; keys 700; crypto 900; cost 500; cut 250 → ~6,000. Slightly long; compress where possible but the brief explicitly blesses length. Aim 4,500–5,500. I'll compress prior art and scenarios prose.

Also: name the protocol once and note the name is cosmetic.

Let me write the HCTR pseudocode block carefully:

```
b   = SHA-256("hearth-ctr" || dk || n || be32(i))   # 32-byte block
ks  = b0 || b1 || ... (enough blocks)
ct  = pt XOR ks[0:len(pt)]

item decryption key: dk = SHA-256("hearth-item" || K || n)
blob  decryption key: dk = SHA-256("hearth-blob" || K || n)
channel key: kA→B = SHA-256("hearth-dc" || S || pk_A || pk_B)
box check: chk = SHA-256("hearth-chk" || K || n)[0:8]
```
Where K is circle key or channel key, n is the box/blob nonce (16 random bytes).

Trial-decrypt loop: for each key K in keyring: if SHA-256("hearth-chk"||K||n)[0:8] == chk → dk = ...; pt = XOR...; parse JSON.

Private blob: bytes = "HRTH1" || n(16) || ct; id = b64(SHA-256(bytes)).

Envelope verify: sig = Ed25519Sign(sk, payload_bytes); verify(pk_from_payload, payload_bytes, sig).

All good. Write the answer now.

Oh wait — one more thing to verify: the brief says priority 3: "The content reaches existing feed readers (RSS / Atom / JSON Feed) and the fediverse / Bluesky with nothing extra built." — "with nothing extra built" — by anyone?? For fediverse, SOME bridge must exist (Mastodon can't fetch RSS natively into a timeline... actually Mastodon has no RSS subscription feature for users to follow feeds... there are bots). Strictly, "nothing extra built" can only mean: no protocol-specific bridging machinery — generic feed-bridging suffices and already exists. I'll interpret and say so explicitly, flagging that fediverse visibility relies on existing generic bridges (or the hub optionally speaking ActivityPub outbox — extra built by hub, not required). Be honest about this reading. Bluesky: there are rss bridges (e.g., "rss-to-bluesky" services); also atproto... fine, same honesty.

And inbound fediverse replies as extension: sketch: bridge holds a key per bridged user? No — bridge posts reply as its own actor with attribution metadata + notification to author. One sentence. Actually the cleanest inbound path: a reply on Mastodon mentioning the bridged account → bridge translates to an envelope signed by the BRIDGE's key, delivered to author's inbox as a "foreign reply" with clear provenance badge ("via bridge, signed by bridge, claims to be mastodon.user@instance — author's app displays it as a bridged reply"). The author can relay it into their thread view. Trust decision by the author/reader, not the protocol. ✔ extension sketch done.

Also — the brief's scenario 7 mentions "sees it on Mastodon through a bridge with nothing built. After the author's key loss, they re-meet the author." — re-meet: after key loss (stranger case, no guardians? a public author might still have guardians... assume none): new root key; new feed; the stranger re-finds via a link/reshare; the new profile may claim "successor of #oldfingerprint" (unsigned claim); bridge may map... nothing verifiable — re-meeting is social. State it. ✔

Also note the identity across bridge: Mastodon users see a stable bridge handle; continuity there is the bridge's problem. Fine.

Alright, final consistency check on field names I'll use in the answer:
- envelope: v, p, s
- payload common: type, root, key, seq, prev, at
- types: post, reply, react, profile, move, rotate, delete, witness, box, ping(inbox hint)
- box: n, chk, ct
- inner doc: t, text, media, to, to_item, grant{label, key}, label
- media ref: {blob, type, bytes}
- endpoints as listed.

Time to write. I'll try to keep it tight and argued. Also start with a one-paragraph summary of the whole design (the "elevator": keys on devices, signed logs, symmetric circles, dumb hubs).

Also, should double-check one potential attack on boxes: **hub swaps box n/ct between items** (cut-and-paste): box in item i replaced by box from item j (both validly signed within their items — but the box fields are INSIDE the signed payload! The payload includes n/chk/ct. So swapping means altering the payload → signature breaks. ✔ Boxes are inside signed payloads. Media blobs are OUTSIDE (separate files) — hub swaps blob files? Item references blob IDs (inside payload/ct) → reader fetches by ID, verifies SHA-256 of stored bytes vs ID → swap detected. Hub serving the WRONG blob for an ID: hash mismatch. ✔ All integrity covered.)

And **blob guessing/enumeration**: blob IDs are 256-bit hashes, unguessable; log enumeration reveals IDs but blobs are ciphertext for private items ✔ public blobs are public ✔.

One subtle leak: private item's `media` array inside ct lists blob IDs; the hub already serves those blobs and sees item sizes... the hub KNOWS which blobs belong to which item? Only if it correlates (it can't decrypt, but blob upload timing correlates). Whatever — the hub stores everything; it knows sizes and timing. Named in hub-learns list. ✔

And the **inbox ping** could be abused to make the recipient fetch arbitrary URLs (SSRF-ish from the app): mitigate: only fetch URLs whose path starts with /hearth/ of a known peer... apps should only auto-fetch feeds of people they follow; ignore others. One line. ✔

Okay. Also decide protocol name final: "Hearth". Fine. Mention once: "name is cosmetic."

Write now. Also remember to explicitly state somewhere: "All four assurances are achievable — with precise readings — and here's where each is bounded" (the brief invited disagreement; I mostly agree with the floor but will contest the precise scope of #2 (insider) and #3 (media) and #4 (availability) — that IS the useful argument.)

Length discipline: go.
```

</details>

