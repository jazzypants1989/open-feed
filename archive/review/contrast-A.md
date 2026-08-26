# Contrast fact-check — batch A (signed-file, no-canonicalization, json-hygiene, the-chain, recovery-list, contest, first-contact)

Read-only audit of every factual claim about an external system in the seven `.md` files, plus
Open-Feed-self claims inside the Contrast sections checked against `open-feed-spec.md` and
`GOALS.md`. Sources were fetched, not recalled, except where marked UNVERIFIABLE. Ordered by
severity; correct claims get one line at the end.

Verdict scale: WRONG (false as written) · MISLEADING (true-ish but leads the reader to a false
picture) · OVERSTATED (right direction, too strong) · UNVERIFIABLE · CORRECT (incl. simplified but fair).

## 1. Needs a fix

### 1.1 `examples/json-hygiene/json-hygiene.md:76` — OVERSTATED (self-claim, measurable)
> "about a quarter of the weekend reader is this and nothing else"

`examples/weekend-reader/weekend-reader.js`: `parse()` is lines 39-68 (~30 lines) of ~237
implementation lines above the `// ====` marker — about 13%. Even counting `sigBytes` and
`openFile` (16-38) it is ~22% and that is no longer "this and nothing else". Suggest: "about an
eighth of the weekend reader is this parser" or drop the fraction.

### 1.2 `examples/signed-file/signed-file.md:70` — MISLEADING
> "**ActivityPub's Linked Data Signatures** need RDF dataset canonicalization before anything can be signed at all"

Linked Data Signatures are not part of ActivityPub (W3C REC) at all. They are a Mastodon
convention (`RsaSignature2017`, canonicalized with URDNA2015 in `JsonLdHelper#canonicalize`)
copied by Pleroma and Misskey, and Mastodon's own docs call the underlying draft superseded.
The canonicalization claim is correct; the attribution is not.
Sources: https://docs.joinmastodon.org/spec/security/ ("Linked Data Signatures 1.0 was a draft
specification for attaching cryptographic signatures to JSON-LD documents"; not a core
ActivityPub requirement); https://red.anthropic.com/2026/cvd/findings/ANT-2026-P2DWB2SK (Mastodon
verifies "over the URDNA2015 RDF canonicalization").
Suggested wording: "**The Linked Data Signatures Mastodon layers on ActivityPub** (RsaSignature2017)
need RDF dataset canonicalization (URDNA2015) before anything can be signed at all — the most
expensive version of the same idea, and the draft it rests on is already superseded."

### 1.3 `examples/the-chain/the-chain.md:126` and `examples/contest/contest.md:115` — MISLEADING (minor)
> "a master key signs device keys" / "A master key signs your devices and your contacts sign your master key"

MSC1756 / the spec define three keys: the master key signs the *self-signing* and *user-signing*
keys; the self-signing key signs devices; the user-signing key signs other users' master keys. The
master key never signs a device directly. The conclusions drawn (replacing the master key means
re-verifying; keys are uploaded to the homeserver via `/keys/device_signing/upload`) are correct:
"If a user changes their master key, clients of users that they communicate with must notify their
users about the change."
Source: https://github.com/matrix-org/matrix-spec-proposals/blob/main/proposals/1756-cross-signing.md
Suggested: "a master key signs a self-signing key, which signs device keys" (the-chain) and "A
master key stands over your devices (through a self-signing key) and your contacts sign your master
key" (contest). One extra clause each.

### 1.4 `examples/first-contact/first-contact.md:84-85` — MISLEADING (quoted text is not the prompt)
> "`The authenticity of host … can't be established. Fingerprint is SHA256:…. Are you sure you want to continue?`"

Presented in code font as a quotation, but OpenSSH's strings are `"The authenticity of host
'%.200s (%s)' can't be established"`, `"%s key fingerprint is: %s"` (e.g. `ED25519 key fingerprint
is SHA256:…`) and `"Are you sure you want to continue connecting (yes/no/[fingerprint])? "`. The
`[fingerprint]` option matters slightly to the argument: OpenSSH does let a user who *has* the
fingerprint paste it as the answer. The point (almost nobody has it) still stands.
Source: https://raw.githubusercontent.com/openssh/openssh-portable/master/sshconnect.c
Suggested: either quote it exactly or stop using code font: "the prompt that says the host's
authenticity can't be established, prints a fingerprint, and asks whether to continue connecting".

### 1.5 `examples/json-hygiene/json-hygiene.md:64` — OVERSTATED
> "`JSON.parse` cannot express any of it and no standard library ships one that can."

True for JavaScript's `JSON.parse`. Not true as a universal: Python's stdlib `json` exposes
`object_pairs_hook`, which is enough to reject duplicate names, and it parses `9007199254740993`
exactly (arbitrary-precision int). No standard library rejects lone surrogates or `__proto__`
(the latter is JS-specific anyway), so the *conclusion* — you write a parser — holds for the full
set of four. UNVERIFIABLE as a survey of every language; the Python counter-example is standard
documented behaviour (https://docs.python.org/3/library/json.html, `object_pairs_hook`).
Suggested: "…because `JSON.parse` cannot express any of it and no standard library ships a parser
that catches all four."

### 1.6 `examples/json-hygiene/json-hygiene.md:60-61` — OVERSTATED (RFC 2119 level)
> "RFC 7493 (I-JSON) covers three of these four — unique names, integers inside the IEEE-754 exact range, no lone surrogates"

Unique names: MUST NOT (§2.3). Surrogates/noncharacters: MUST NOT (§2.1). Numbers: only a
SHOULD NOT ("SHOULD NOT include numbers that express greater magnitude or precision than an IEEE
754 double") plus a note that a sender "cannot expect" exactness past 2^53-1. So I-JSON *advises*
on the integer case rather than forbidding it, and §2.4's MUST NOT is stricter. Simplified but
fair as a one-liner; a word like "advises on" for the integer case would be exact.
Source: https://www.rfc-editor.org/rfc/rfc7493.html

### 1.7 `examples/json-hygiene/json-hygiene.md:66-67` — OVERSTATED
> "parser differentials between two services reading one document have produced real authorization bypasses."

Bishop Fox's 2021 work surveyed 49 parsers and *demonstrated* privilege escalation and free-purchase
bypasses in companion labs; the write-up does not cite a named production incident. "have
produced" implies a known real-world case. Suggested: "have been shown to produce authorization
bypasses (Bishop Fox, 2021)".
Source: https://bishopfox.com/blog/json-interoperability-vulnerabilities

### 1.8 `examples/the-chain/the-chain.md:120-122` — OVERSTATED (tone)
> "the notification is the entire mechanism, and users are trained to tap past it"

"No cryptographic link from the old key to the new one" is correct. But Signal's mechanism is
the safety number (60 digits / QR) *plus* the notice; and since the 2017 update the default is
advisory (a notice in the conversation, no approval needed), so "trained to tap past it" is
editorializing about a design that deliberately does not block. Fair as opinion; not as
description. Suggest "…so the notice is the whole mechanism, and Signal itself made it
non-blocking by default."
Source: https://signal.org/blog/safety-number-updates/

## 2. Fine, with a note

- `signed-file.md:42-43` CryptoKit randomized Ed25519 — CORRECT, verbatim from Apple: "the CryptoKit
  implementation of the algorithm employs randomization to generate a different signature on every
  call, even for the same data and key, to guard against side-channel attacks."
  (developer.apple.com …/privatekey/signature(for:))
- `signed-file.md:59-63` JWS compact base64url-encodes the payload; RFC 7797 `b64:false` MUST be in
  `crit` — CORRECT (RFC 7797 §6). "Open Feed's earlier drafts used exactly this" — CORRECT,
  `archive/open-feed-spec.md:323,342` (`"alg":"EdDSA","b64":false,"crit":["b64"]`, detached).
- `signed-file.md:68-69` Nostr signs SHA-256 of `[0,pubkey,created_at,kind,tags,content]` with its
  own escape list — CORRECT (NIP-01). Note only that it is Schnorr/secp256k1, irrelevant here.
- `no-canonicalization.md:46-48` JCS: UTF-16 code-unit sort, ECMAScript number formatting, fixed
  escaping — CORRECT (RFC 8785 §3.2.3, §3.2.2.3, §3.2.2.2). "why it is long" — RFC 8785 is ~30 pages,
  most of it test data; fair.
- `no-canonicalization.md:53` "a library, or 200 lines" — the archived `archive/src/canonical.js`
  is 296 lines (parser + canonicalizer). Fair order of magnitude.
- `no-canonicalization.md:58-61` "a chained document must arrive as its own canonicalization" —
  CORRECT quote of the old spec (`archive/open-feed-spec.md:370`).
- `json-hygiene.md:14` "other stacks keep the first" — CORRECT: 7 of 49 parsers (rapidjson,
  jsonparser, gojay, json-iterator, Jason, Poison, jsone) per Bishop Fox; RFC 8259 §4 says "Many
  implementations report the last name/value pair only."
- `json-hygiene.md:16-17` big-int rounding and `\ud800` -> `ef bf bd` — CORRECT, reproduced in Node.
- `json-hygiene.md:73` "about 100 lines of parser" — `src/file.js:41-154`, 113 lines. CORRECT.
- `the-chain.md:95-103` CRL/OCSP as announcements the serving path can withhold — CORRECT as a
  characterization (OCSP stapling notwithstanding, the responder/CA still publishes).
- `the-chain.md:105-111` X.509 chain description — CORRECT.
- `the-chain.md:113-118` PGP transition statements: plaintext, signed by both keys, verified by
  humans — CORRECT/fair (josefsson.org, infra.apache.org/key-transition.html). "the format is
  folklore" — accurate; there is no standard. OpenPGP revocation certs + expiry — CORRECT.
- `the-chain.md:132-135` Nostr: NIP-01 has no key-loss story; migration is unmerged proposals
  (NIP-41 draft branch, NIP-76 PR #782, PR #1032) — CORRECT.
- `recovery-list.md:71-77` Shamir wallets reconstruct a secret — CORRECT as the generic shape.
- `recovery-list.md:79-85` Argent guardians approve a new signer; approvals counted on chain;
  guardian addresses visible on chain — CORRECT (support.argent.xyz; Argent requires a majority of
  guardians and a 48h delay, which if anything strengthens the paragraph's point).
- `recovery-list.md:87` Merkle proof ~log n — CORRECT.
- `contest.md:110-114` Signal safety numbers — CORRECT.
- `contest.md:119-122` CONIKS/key transparency need a log plus auditors/gossip — CORRECT.
- `contest.md:123-125` ION / ledger-backed `did:*` — CORRECT (ION anchors to Bitcoin via Sidetree).
- `first-contact.md:27` fragment not sent, RFC 3986 §3.5 — CORRECT.
- `first-contact.md:35-39` HKDF derivation matches spec §3.1 and B.12 — CORRECT (B.12 indices not
  independently recomputed; `npm run examples` asserts them).
- `first-contact.md:48-51` 2^66 = 73,786,976,294,838,206,464; 2^55 = 36,028,797,018,963,968 —
  CORRECT (checked). "§3.1 puts the difference plainly … centuries of GPU time" — matches spec text
  ("centuries on a GPU"). Note, not a finding: that is per single GPU; a thousand-GPU farm is years,
  and the spec's sentence could say "on a GPU" more carefully. Not an external-system claim.
- `first-contact.md:92-95` Signal: 60 digits, 12 groups of 5, QR fast path — CORRECT.
- `first-contact.md:96-98` PGP 40-hex fingerprints — CORRECT for v4 (v6 keys, RFC 9580, are 64 hex;
  immaterial). "checking the last eight characters, or none" — UNVERIFIABLE folklore, fair.
- `first-contact.md:102-107` BIP-39: 2,048 words, first four letters unique, similar words avoided,
  "spoken over the telephone" in the BIP's own rationale; a mnemonic reconstructs a wallet —
  CORRECT (bip-0039.mediawiki).

## 3. Open Feed self-claims in these sections vs the spec — all consistent

Checked: §13.2's three clock entries (contest:104) match the spec table verbatim; "the same
`version` with a different address is contested" (contest:34) = §3.6 last para; §3.6 rules 2 and 3
cited by number (recovery-list:58, the-chain:53) are numbered that way in the spec; "only member-
order rule" (no-canonicalization:69) = §4 "the one member-order requirement"; seven-day SHOULD and
"presentation not a verdict" (recovery-list:63-64) = §3.4/§7.3; restore-changes-nothing-else list
`locations, recovery, name, read` (the-chain:65-66) = §3.3; "SHOULD require two or more members
(or the owner alone)" = §3.4; "reading key is not socially recoverable" = §3.8; scenario numbers
and quotes (1 divorce, 2 grandma incl. the "loses her phone a year later…" quote, 6 weekend, 7
stranger), floor item 1, priorities 1/2/4 wording, and the 2026-08-21 rewording note all match
`GOALS.md`. No contradictions found.

## 4. Style

- First person: none. The only hits (`no-canonicalization.md:18` "my host", `json-hygiene.md:30`
  "post 2 to me", `the-chain.md:114` "K2 is me") are inside quoted hypothetical speech.
- Tone drift from the `signed-file` template (declarative, no reader-address, no self-rating):
  - `the-chain.md:126` "and worth naming honestly", `first-contact.md:41` "Worth being precise
    about", `first-contact.md:89` "Note the difference in stakes, though, and be fair to SSH" —
    the template never addresses the reader or grades its own candour.
  - `contest.md:61` "The single most important block." — self-rating; the template lets the
    content rank itself.
  - `contest.md:9` and `first-contact.md:8` use bold sentences as thesis statements mid-paragraph;
    the template bolds only block leads.
  - `recovery-list.md:105` "Read that rule there rather than reconstructing it here." — imperative
    to the reader; fine as intent, off-template as voice.
- The Contrast sections in `the-chain`, `recovery-list`, `contest` are 40-45 lines against the
  template's 20; not wrong, but the template's own instruction ("point at the example that argues a
  thing rather than re-arguing it") is bent by `recovery-list.md:100-105`, which re-argues §3.6.
