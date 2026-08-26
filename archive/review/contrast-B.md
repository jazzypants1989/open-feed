# Contrast-section fact-check, batch B

Scope: `## Contrast` sections (plus other claims about outside systems) in `examples/{the-index,
rewrite,top-and-rumors,posts-and-targets,media,envelope,padding}/<name>.md`. Every verdict below
was checked against a primary source (RFC text, protocol spec, project docs) fetched during the
review, not from memory. Ordered by severity. Line numbers are as of commit `fbd873a`.

Verdict key: WRONG = states something false. MISLEADING = true words, false impression. OVERSTATED
= true in the main case, stated as universal. CORRECT = checks out (simplifications noted only when
they matter). UNVERIFIABLE = could not reach a primary source or the number cannot be reproduced.

## 1. Wrong

### envelope.md:38 and :148-150 — the all-zero nonce is attributed to HPKE

- L38: "**The all-zero nonce.** It is safe for the reason it is safe in HPKE, and for no other"
- L148-150: "Same shape: an ephemeral X25519, HKDF-SHA256, ChaCha20-Poly1305, a content key
  encrypted once per recipient, an all-zero nonce justified by a single-use key."
- Verdict: **WRONG** as an attribution. RFC 9180 never uses an all-zero nonce. `Seal` computes
  `xor(base_nonce, I2OSP(seq, Nn))` where `base_nonce` is *derived from the key schedule*
  (RFC 9180 §5.2); with `seq = 0` the first nonce is `base_nonce`, not zero. HPKE also has no
  "content key encrypted once per recipient" — RFC 9180 defines no multi-recipient construction at
  all (it says a recipient with several keys needs an application-defined mechanism, §10). The
  system that actually does what §6 does — wrap a fresh key under ChaCha20-Poly1305 with a nonce
  "fixed as 12 0x00 bytes", justified by the key being single-use — is **age** (C2SP `age.md`,
  X25519 recipient stanza). L150 also contradicts L156-157, which correctly says HPKE's nonce comes
  from the key schedule XORed with a sequence number.
- Suggested wording (L38): "It is safe for the reason it is safe in age's X25519 recipient stanza,
  and for no other: the key is fresh and used exactly once." (L148-150): drop "an all-zero nonce
  justified by a single-use key" from the "same shape" list, and replace "the box-per-recipient
  pattern that multi-recipient HPKE uses on top of it" with "the box-per-recipient pattern that the
  JOSE/COSE HPKE drafts (draft-ietf-jose-hpke-encrypt, draft-ietf-cose-hpke) and age build on top
  of it" — RFC 9180 itself has no such pattern.
- Source: RFC 9180 §5.2, §10; C2SP age spec, "X25519 recipient stanza".

### envelope.md:166 — NIP-44 "over an X25519 shared secret"

- Claim: "The cipher suite is nearly the same — ChaCha20 with HKDF-SHA256 over an X25519 shared
  secret, with padding"
- Verdict: **WRONG.** NIP-44 v2 derives its conversation key from **secp256k1 ECDH** (`a·B` per
  BIP340), HKDF-extract with SHA-256 and salt `'nip44-v2'`. There is no X25519 anywhere in it.
  The rest of the sentence (ChaCha20, HKDF-SHA256, padding) is correct, and L169's "ChaCha20 …
  encrypts-then-MACs with HMAC-SHA256 rather than using an AEAD" is correct and is the actual
  suite difference worth naming.
- Suggested wording: "ChaCha20 with HKDF-SHA256 over a secp256k1 ECDH secret (Nostr's curve), with
  padding".
- Source: nostr-protocol/nips `44.md`.

### the-index.md:87-90 — "no place to state 'and these are all of them,' and no signature over the statement if there were" (Atom)

- Claim: "In RSS, Atom and JSON Feed the document *is* the entries … There is no place to state
  'and these are all of them,' and no signature over the statement if there were."
- Verdict: **WRONG for Atom**, correct for RSS 2.0 and JSON Feed. RFC 5005 §2 ("Complete Feeds")
  defines `<fh:complete/>`: "indicates that the feed document it occurs in is a complete
  representation of the logical feed's entries". And RFC 4287 §5.1 lets `atom:feed` carry an
  XML-DSig enveloped signature, so a signature over that statement is available too. The
  *practical* point — nobody deploys these together, and a signed complete feed still cannot
  express "post n was withdrawn" — survives, but the sentence as written is false.
- Suggested wording: "In RSS and JSON Feed the document *is* the entries and there is no place to
  say 'these are all of them'; Atom has one (RFC 5005's `fh:complete`) and an optional XML
  signature to put over it (RFC 4287 §5.1), and almost nobody uses either. None of the three can
  say a post *was* here and was withdrawn."
- Source: RFC 5005 §2; RFC 4287 §5.1.

## 2. Misleading or overstated

### media.md:105-107 — MMS "with the sender having no say and no name for the file at all"

- Verdict: **OVERSTATED.** MMS is store-and-forward through an MMSC and messages are deleted on
  expiry if unretrieved (3GPP TS 23.140) — that part is correct. But the sender *can* request an
  expiry (`X-Mms-Expiry` in M-Send.req; the MMSC may cap it), and MIME parts carry
  `Content-ID`/`Content-Location`. "No say" and "no name for the file at all" are both too strong.
- Suggested wording: "expire on the carrier's schedule — the sender may ask for an expiry and the
  carrier may cap it — and the part has no name that outlives the message."
- Source: 3GPP TS 23.140 (MMSC expiry handling); OMA MMS Encapsulation (M-Send.req fields).

### padding.md:98-99 — "Tor uses fixed-size cells, so every hop carries the same shape and there is nothing to measure"

- Verdict: **OVERSTATED**, fair as a sketch. Tor's *relay* cells are fixed (512/514 bytes per link
  protocol), but the link layer also has variable-length cells (VERSIONS, VPADDING, CERTS,
  AUTH_CHALLENGE — command 7 and ≥128), and "nothing to measure" is not true of Tor: cell *counts*
  and timing are exactly what website-fingerprinting attacks measure. The padding.md paragraph's
  own first block (L86-88) already concedes timing and frequency leak, so the Tor sentence
  undercuts it.
- Suggested wording: "Tor carries traffic in fixed-size relay cells, so cell *size* reveals
  nothing — counts and timing still do".
- Source: tor-spec, "Cell packet format".

### padding.md:100-102 — TLS 1.3 "made it entirely optional, with no guidance on how much"

- Verdict: **CORRECT, slightly overstated.** RFC 8446 §5.4: records "MAY be padded" and "the
  padding policy is out of scope for this document". Appendix E.3 does discuss traffic analysis
  and says padding helps but gives no policy. "No guidance on how much" is fair; "entirely
  optional" is right. Fine as written, but "with only an appendix noting that it exists" would be
  more exact.
- Source: RFC 8446 §5.4, Appendix E.3.

### posts-and-targets.md:146-148 — Signal "authenticates messages with a MAC under a key both parties hold rather than with a signature"

- Verdict: **CORRECT** (Double Ratchet: AES-256-CBC + HMAC-SHA256 over associated data ‖
  ciphertext; no per-message signature). One simplification worth knowing: Signal *does* use
  signatures at session setup (X3DH signed prekeys), so "with a signature" should be read as
  "per message". The sentence says "authenticates messages", so it is fine.
- Source: signal.org Double Ratchet spec, "Recommended cryptographic algorithms".

### posts-and-targets.md:146 — "Signal hides the sender from its own server for delivery (sealed sender)"

- Verdict: **CORRECT.** Signal's blog: the client hands the envelope to the service "without
  authenticating" along with the recipient's delivery token; the sender certificate is inside the
  encrypted envelope. (The Kaptchuk et al. NDSS'21 paper shows the server can still de-anonymise
  by timing — an observation the paragraph's own "worth being modest about" already leaves room
  for.)
- Source: signal.org/blog/sealed-sender/.

### envelope.md:146-147 — "the honest description of §6 is HPKE's base mode in spirit"

- Verdict: **MISLEADING** once L148-150 is fixed, mildly. What §6 actually resembles is age's
  recipient-stanza + payload-key design (ephemeral X25519 → HKDF → ChaCha20-Poly1305 wrap of a
  file key, zero nonce, one wrap per recipient). HPKE base mode is the DHKEM half of that. Saying
  "HPKE in spirit, age in shape" would be accurate; the current text names only HPKE and never
  mentions age, which is the nearest actual relative.

### envelope.md:160-161 — "`GOALS.md` records the evaluation as commissioned rather than closed"

- Verdict: **UNVERIFIABLE / loose paraphrase.** `GOALS.md` never uses "commissioned". It lists the
  encryption construction as open item 2 for outside review (L118-119) and says the envelope was
  "re-chosen for simplicity … not kept for JWE's sake" (L81-82). The gist is right; the word is
  not in the source. Suggest: "and `GOALS.md` lists the construction as an open question for
  outside review, not a closed one".

### top-and-rumors.md:77-80 — email backscatter

- Verdict: **CORRECT.** Forged envelope sender → bounces to the forged party; the fix was
  rejecting at SMTP transaction time (and SPF-style checks) rather than accepting-then-bouncing.
  No source needed beyond RFC 5321 §6.2 / common practice; nothing here is contestable.

## 3. Correct (one line each)

- the-index.md:100-103 — Nostr relays are partial, no per-author completeness claim. CORRECT (NIP-01 gives relays no completeness semantics).
- the-index.md:105-108 — CT publishes a signed tree head, inclusion and consistency proofs; monitors/auditors detect misbehaviour. CORRECT (RFC 6962 §2.1.1, §2.1.2, §3.5, §5.3-5.4).
- rewrite.md:79-84 — Mastodon `Delete` is best-effort delivery to known inboxes; modified/offline instances keep rows. CORRECT (ActivityPub §7; Mastodon behaviour).
- rewrite.md:85-90 — "right to be forgotten" is a claim against a data controller enforced by a regulator. CORRECT (GDPR Art. 17).
- rewrite.md:91-95 — Signal disappearing messages: timer honoured by cooperating clients; screenshots/another camera defeat it; "Signal is careful to say so". CORRECT (signal.org/blog/disappearing-messages: "not for situations where your contact is your adversary").
- rewrite.md:96-100 — git rebase leaves old objects reachable via reflog/dangling objects until pruned; other clones keep what they fetched. CORRECT. ("in every clone" is a small stretch — a clone that never fetched the old commits has nothing to prune — but fair.)
- top-and-rumors.md:85-90 — ActivityPub delivers by push to `inbox`; signature checks and rate limits are operator policy. CORRECT (ActivityPub §7; HTTP Signatures are not in the ActivityPub spec).
- top-and-rumors.md:90-92 — Nostr clients subscribe (`REQ`) and relays deliver. CORRECT (NIP-01).
- posts-and-targets.md:112-116 — ActivityStreams 2.0 vocabulary (`Create`, `Like`, `Announce`, `Follow`, `Undo`), delivered by POST to an actor's `inbox`. CORRECT.
- posts-and-targets.md:123-125 — `In-Reply-To` names a `Message-ID`; ActivityPub `inReplyTo` names a URI. CORRECT (RFC 5322 §3.6.4; AS2 vocabulary).
- posts-and-targets.md:126-128 — Nostr `e` tag holds an event id that is SHA-256 of the serialized event. CORRECT (NIP-01: `sha256` of `[0, pubkey, created_at, kind, tags, content]`).
- posts-and-targets.md:136-137 — Nostr replaceable events keep the largest `created_at`, ties broken on id. CORRECT (NIP-01: "lowest id (first in lexical order) should be retained"). Direction of the tie-break is unstated in the text; fine.
- posts-and-targets.md:138 — LWW registers in CRDTs use wall-clock precedence. CORRECT.
- media.md:78 — git names a blob by hash of `"blob <size>\0" || content`. CORRECT (Pro Git, "Git Objects").
- media.md:78-79 — IPFS names by a CID that wraps a multihash. CORRECT (multiformats/cid: version ‖ codec ‖ multihash).
- media.md:92-95 — ActivityPub objects carry an `attachment` array; Mastodon caches remote media and prunes it on a schedule. CORRECT (`tootctl media remove`, default 7 days; admin media-cache retention setting).
- media.md:100-105 — Matrix media at `mxc://` URIs; encrypted attachments carry key + IV and a SHA-256 of the ciphertext, AES-CTR-256. CORRECT (client-server spec, "Sending encrypted attachments": "A hash of the ciphertext MUST also be included, in order to prevent the homeserver from changing the file content").
- envelope.md:117-120 — archived §15 used JWE JSON Serialization (RFC 7516), `ECDH-ES+A256KW`, `A256GCM`, X25519 per RFC 8037, Concat KDF per RFC 7518. CORRECT against `archive/open-feed-spec.md:867,878`; RFC numbers are the right ones.
- envelope.md:137-138 — archived §15.2 says per-recipient headers are "not covered by the JWE's own AEAD". CORRECT, quoted verbatim from `archive/open-feed-spec.md` §15.2.
- envelope.md:140-142 — the archived carrier check compared `id`, `authors[0].url`, `feed_url`, "absent against present is a mismatch, in both directions". CORRECT (`archive/open-feed-spec.md:900`).
- envelope.md:152-155 — HPKE `LabeledExtract`/`LabeledExpand` mix `"HPKE-v1"` and a `suite_id`. CORRECT (RFC 9180 §4).
- envelope.md:156-157 — HPKE nonce = base_nonce XOR seq, because a context encrypts many messages. CORRECT.
- envelope.md:158 — HPKE has an authenticated mode. CORRECT (mode_auth, mode_auth_psk).
- envelope.md:163 — NIP-44 v2 Cure53-audited. CORRECT (December 2023, stated in NIP-44).
- envelope.md:166-167 — §6's padding buckets are NIP-44's idea. CORRECT in spirit; NIP-44 pads to a power-of-two with 32-byte chunks and a 32-byte minimum, which is bucket-shaped.
- envelope.md:167-169 — NIP-44 is two-party, static-key, no ephemeral, HMAC-SHA256 encrypt-then-MAC. CORRECT.
- envelope.md:174-176 — Signal/MLS (RFC 9420) have ratchets, forward secrecy, group state; §6 has none. CORRECT.
- padding.md:93-95 — CRIME/BREACH recover secrets from compressed-then-encrypted lengths. CORRECT (CRIME: TLS compression; BREACH: HTTP compression inside TLS — "a TLS connection" covers both loosely).
- padding.md:102-104 — RFC 7685 `padding` extension exists to dodge implementations that hang on a 256-511-byte ClientHello. CORRECT.
- padding.md:104-105 — Signal pads plaintext to fixed increments (160 bytes) and sealed sender strips the sender from what the server sees. CORRECT (Signal-Android wiki "Protocol": padded to multiples of 160; sealed-sender blog).

## 4. Internal claims about Open Feed in these sections, checked against the spec and code

- envelope.md:128 — "spec words 3,606 / 905". Measured with `wc -w` on the §6 and archived §15 bodies: **901 and 3,602**. Within a heading's worth; UNVERIFIABLE to the digit, harmless. Consider rounding ("about 900 / 3,600") so the table does not drift on the next edit.
- envelope.md:129 — "381 lines / 76 lines". CORRECT (`wc -l`).
- envelope.md:130 — "bytes per recipient slot 160 / 83". 83 reproduces: 8-byte tag → 11 base64url chars, 48-byte wrap → 64 chars, plus `["","",],` = 83. 160 for the archived JWE per-recipient object is UNVERIFIABLE without rebuilding one; plausible.
- envelope.md:132 — audience "MUST, `{key, read, loc}`". CORRECT (§6.5, spec L583).
- envelope.md:154 — `"openfeed/v1/slot"` is the whole domain separation, salt = `epk`. CORRECT (spec L521).
- envelope.md:121 — "`kid` forbidden" in the archived design. CORRECT (`archive/src/enc.js:138,153`).
- the-index.md:116 — "leftover withdrawal lines at roughly 6% of the file". CORRECT, matches spec §4.7 (L424).
- the-index.md:92-95 — reader notes `host: post n is listed and not served`, `withdrawn: n`. `withdrawn: n` is the spec's string (§7.4, L646). The `host:` note's exact wording is not in the spec grep; the-index.md elsewhere (L83) uses `no index I can verify`, which is. Minor; check the `host` note against §7.4's list before relying on the literal.
- rewrite.md:84 — "the belief §8.8 forbids an app from creating". §8.8: "an app MUST NOT tell a user that withdrawing erased anything". Fair paraphrase.
- posts-and-targets.md:154-162 — sealed sender unavailable, no deniability, no forward secrecy, citing §13.3 / §5.6 / §6. All three match §13.3's bullets ("shape of a correspondence is visible", "provable by its recipient forever (§5.6)", "There is no forward secrecy").
- padding.md:115-116 — floors 8 slots / 512 bytes, SHOULD. CORRECT (§6.4). padding.md:121 says a MUST "would put a byte cost on every implementation"; §6.4 prices it at "about 1.1 KB per direct message" — consistent.
- padding.md:89-90 — "clients poll on a fixed cadence" is in `GOALS.md` (L81) and not the spec. CORRECT.

## 5. Tone and voice (house style = `examples/signed-file/signed-file.md`)

The template's Contrast is four terse bullets, present tense, no process narrative, no first person,
no "honest"/"deliberately". Deviations:

- **First person.** `envelope.md:137` "implemented by us" — the only true first-person in the seven. (`top-and-rumors.md:17` "I cannot see" and `media.md:97` "my feed" are quoted speech, fine.)
- **Archaeology / process narrative** (CLAUDE.md rule 3 applies to the spec, but the same instinct is what the template follows):
  - `envelope.md:114-115` "This construction was deliberately re-chosen. The design it replaced was not broken…" and the whole "JWE construction this replaced" block (L117-144) is a redesign record, not a contrast with another system. The template mentions its own history in one clause ("Open Feed's earlier drafts used exactly this"). Suggest cutting the block to one bullet and pointing at `archive/redesign/`.
  - `top-and-rumors.md:97-100` "This finding did not come from reading the design. It came from writing a second reader…" — session narrative in a Contrast.
- **Editorialising tics** absent from the template: "the honest description" (envelope:146), "the honest answer" (envelope:174), "honest" (padding:111, 120; posts-and-targets:168), "deserves plain arithmetic" (posts-and-targets:146), "This is the least comfortable part of §5" (posts-and-targets:145), "worth naming" (top-and-rumors:71; posts-and-targets:118), "worth stating carefully, because it is easy to oversell" (rewrite:102), "the design says so rather than dressing it up" (the-index:110). Each is a sentence the template would not spend.
- **Scenario/GOALS recaps inside Contrast** (`the-index:115-120`, `top-and-rumors:102-108`, `posts-and-targets:164-175`, `media:109-113`, `envelope:193-200`) are not contrasts with other systems; the template has none. Not wrong, but they are a second section wearing the first's heading.
- **Length.** signed-file's Contrast is 22 lines. These run 36 (the-index), 35 (rewrite), 40 (top-and-rumors), 66 (posts-and-targets), 39 (media), 89 (envelope), 46 (padding).

## 6. Not found

No claims about Bluesky/AT Protocol, Bridgy Fed, Argent/ERC-4337, RFC 8785, RFC 7493 or age appear
in these seven files (age *should* appear — see item 1). Nothing in these Contrast sections
contradicts `open-feed-spec.md` beyond the word-count rounding noted above.
