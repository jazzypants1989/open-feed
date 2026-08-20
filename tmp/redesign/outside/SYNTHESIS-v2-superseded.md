# Outside perspectives — pass 1, reported and routed

**2026-08-20.** Six frontier models from six different labs, none with repo access, each given
`PROMPT-pass1.md` and nothing else. Full answers in `responses/`.

## How this file works, and what it deliberately does not do

Two owner rulings govern it:

1. **Report and flag; do not rank.** What follows states what each model said and routes it against
   this repo's record. There is no "headline finding," no ordering by importance, and no
   recommendation. Which of these matters is the owner's call, not this file's.
2. **Nothing is written down that was not read first.** Every claim below about `GOALS.md`, the
   spec, or `src/` was checked against the actual line and is quoted with its location. The first
   draft of this file failed exactly here — it paraphrased `GOALS.md:35` into a prompt, sent it to
   five models, and read the paraphrase back out of their answers as a finding. That draft is kept
   as `SYNTHESIS-v1-stale.md`; the error is documented in `PROMPT-pass1-DEFECT.md`.

Routing vocabulary, applied to each distinct claim:

| | |
|---|---|
| **ALREADY PRICED** | this repo has an answer, cited by file and section |
| **UNPRICED** | no card, gate, or rejection addresses it |
| **CONTRADICTS** | conflicts with a line in `GOALS.md` or the spec, with both quoted |
| **INTERNALLY INCONSISTENT** | the model's own design contradicts itself or the brief |

"Three models agree" is reported as a count, not as weight. Agreement across labs is evidence about
what a well-informed designer reaches by default; it is not evidence that the default is right for
this project, and two of the six answers below are visibly shaped by each other's absence rather
than by independent conviction.

## Provenance

All six ran against `PROMPT-pass1.md`, SHA-256 `ba5166e3…`, with `reasoning_effort` recorded per
response.

| model | lab | status |
|---|---|---|
| `gpt-5.6-luna` | OpenAI | complete, 59s |
| `qwen3.8-max` | Alibaba | complete, 373s |
| `kimi-k3` | Moonshot | complete, 436s |
| `minimax-m3` | MiniMax | complete, 379s |
| `hy3` | Tencent | complete, 132s |
| `glm-5.3` | Zhipu | complete, 295s at `effort: high` (it rejects `medium` outright) |

**Dropped as broken, not as uninteresting.** `deepseek-v4-pro` truncated mid-answer on all three
attempts (843s / 173k reasoning chars, then two shorter failures); `grok-4.5` returned upstream HTTP
503 twice. `responses/v1-defective-brief/` holds their partial output and everything produced under
the defective brief.

**A prior run of this exercise is not evidence.** `responses/v1-defective-brief/` was produced by a
brief that misstated priority 1 as a closed list of five primitives. Three of its four complete
answers invented hash-only ciphers in response. On the corrected brief all five completed models
chose a standard AEAD (AES-256-GCM or ChaCha20-Poly1305) and none wrote a paragraph justifying a
deviation. That before/after is the clearest available evidence that the contamination was real and
that the correction removed it — and it is the reason the v1 answers are not mixed into the counts
below.

---

## 1. What each model built

One paragraph each, so the routed claims below have a design to sit in. Names are the models' own.

- **`gpt-5.6-luna` — "Signed Personal Hubs."** Ed25519 identity, hash-of-key as the id, separate
  X25519 encryption key. Length-prefixed byte string as the signing input (`uint64_be(len) || bytes`
  per field, fixed order) rather than an encoded payload. Pull, with a content-free notification
  carrying an object URL. Shamir 3-of-5 social backup of the private key. The only answer that opens
  by conceding a floor item is unreachable: global discovery after a domain vanishes with no cached
  redirect *"cannot be solved by HTTP, DNS, and cryptography."*
- **`qwen3.8-max` — "Hearthwire."** Ed25519 identity; X25519 derived from the same Curve25519 key
  material rather than a second keypair. Three artifacts only: identity document, post, feed. Pure
  pull — no inbox anywhere. Per-recipient ephemeral keys, argued explicitly so the hub cannot link
  two recipients as receiving one post.
- **`kimi-k3` — "Hearth."** Five artifacts: card, log, blobs, envelopes, feeds. Inception key +
  rotation chain, so the id never changes. Hash-chained log with `prev`. **Delivers private content
  by POSTing an envelope to the recipient's hub inbox**, and names that "the load-bearing decision
  behind assurance 4." Includes slot padding in the design. Adds a `vouch` entry type for social
  attestation.
- **`minimax-m3` — "Persona."** The outlier: an explicitly ActivityPub-shaped design, with
  WebFinger discovery, `name@hub` addressing, actor profiles, and inbox/outbox collections with
  HTTP-signed POSTs — while keeping the Ed25519 keypair as the identity and the name as a nickname.
  The only answer that states which language standard libraries clear the dependency bar and which
  do not.
- **`hy3` — "Latch."** The shortest. Static file paths under `/u/<pubkey>/`, one file per artifact
  kind, hub does a signature check on `PUT` to keep its disk clean. Guardian escrow of the private
  key. Rejects key rotation outright — *"key rotation means new identity"* — allowing key
  replacement only via a guardian quorum.
- **`glm-5.3` — "Hearth."** Opens by naming nostr as its nearest living relative and itemizing the
  deltas. Envelope is a compact single-line JSON document, a `.` terminator line, then the
  signature — the terminator is unambiguous *"because JSON escapes newlines inside strings."* Four
  artifacts: identity chain head, signed index, items, blobs. **No inbox, no delivery, no
  hub-to-hub anything** — it calls that "the one deep architectural decision," on the grounds that
  hubs never needing to agree is what makes assurance 4 trivially true. Adds a rule the others do
  not: **an item is admitted to a reader's view only if a validly signed index lists it.**

---

## 2. Routed claims

### 2.1 ALREADY PRICED

| claim | who | where this repo answers it |
|---|---|---|
| Identity is an Ed25519 public key; a URL or domain is a location, never an identity | all five | `GOALS.md:54` *"**Identity is a key.** A signed profile names current location(s), keys, and recovery arrangement. The URL is where you live, not who you are."* Each model rejected domain identity on the divorce or domain-loss scenario, which is the same reasoning |
| Sign exact bytes; no JSON canonicalization | gpt, qwen, kimi, minimax | `GOALS.md:92` *"**Signed items are files, signed as the bytes served.** No canonicalization."* and `gates/bytes-gate.md`, whose verdict adds the one rule none of them stated: strict base64url spelling, *"without which a lenient decoder reads two spellings of one signature while the served bytes differ"* |
| Recipient slots carry no recipient identifier; readers trial-decrypt | gpt, qwen, kimi, hy3 | `tmp/prototypes/enctags.md`, adopted as §15.2. The card also establishes what none of them noticed: the cost driver was the **per-recipient ephemeral**, not the missing tag, and *"the two halves are welded."* qwen independently recommends per-recipient ephemerals for unlinkability — the exact tradeoff that card measured and decided against |
| ActivityPub fails at the adversary; Nostr lacks rotation and audience-hiding; atproto needs a shared directory | kimi, minimax, hy3, and glm in its v1 answer | `CANDIDATES.md` "The eliminations" — same three verdicts, same reasons |
| Hubs need no server-to-server protocol; encryption does the work of ACLs | all five | `GOALS.md:28` floor item 4, and the design already assumes it |

### 2.2 UNPRICED

**Audience size leaks through the slot count, and nothing pads it.**
Raised by gpt (*"leak count and size"*), hy3 (*"how many recipients (count of boxes)"*), and qwen
(same, in its v1 answer). kimi is the only one that **built padding in**, and lists "slot padding —
keep audience hiding, drop size hiding" as its third cut if forced to halve.

`src/enc.js:185` builds the slot array as `recipients.map(...)` — exactly one slot per
recipient, no padding and no decoy slots. The spec discusses slot count exactly
once, at `open-feed-spec.md:940`, and only as a denial-of-service question: *"Slot count still costs
bytes (§13.4 bounds the document)… Neither is a grinding cost and neither needs an arbitrary cap."*
It is never treated as a metadata disclosure. `GOALS.md:89` states the hub learns *"that an
encrypted item exists, when, roughly how big, and nothing about whom."* Slot count is not *whom*;
whether it is covered by *"nothing about whom"* is the open question, and no card, gate, or
rejection in the repo addresses it.

**Ed25519 → X25519 derivation instead of a second keypair.**
qwen derives the encryption key from the same Curve25519 material and gives the conversion
(*"clamp the 32-byte Ed25519 seed per RFC 7748 §5… apply the birational map"*), calling it the one
place an implementer needs a reference beyond the spec. minimax considered it and **rejected** it —
*"the conversion requires a KDF and is fiddly"* — choosing two independent keypairs. kimi assumes
X25519 with P-256 named as a drop-in where absent. `src/enc.js:105` uses a separate published
X25519 key; nothing in the repo records the derivation as considered.

**Rejecting key rotation entirely.**
hy3: *"key rotation means new identity. We allow *key replacement* only via guardians."* This is the
inverse of `GOALS.md:65`, which makes rotation and social recovery **one** attestation shape
(*"'key B succeeds key A,' valid when signed by A (rotation) or by enough peers a reader already
trusts"*). No card weighs collapsing rotation into recovery-only.

### 2.3 Where the models split — reported as a split, not a consensus

**Whether a delivered channel exists at all**, which is a live disagreement inside this repo.

| model | what it does |
|---|---|
| `kimi-k3` | POSTs encrypted envelopes to the recipient's hub inbox; calls it load-bearing for assurance 4 |
| `minimax-m3` | full inbox/outbox with HTTP-signed POSTs |
| `gpt-5.6-luna` | pull, plus a content-free notification carrying an object URL; mentions a per-recipient inbox only to reject it as revealing recipients to the hub |
| `hy3` | pull; `inbox` is a pointer in the profile to envelope objects, not an endpoint |
| `qwen3.8-max` | pure pull, no inbox anywhere |

Two build delivery, one builds a ping, two build neither. The repo's own two positions also
disagree, and the later one does not answer the earlier one:

- `gates/channel-gate.md` (2026-08-19, green): *"**Verdict — keep a minimal delivered channel.**
  … **Suppression is not a corner case under (a): it is the adversary's cheapest move**, and
  detection (staleness, day 7+) is not delivery — the covert outbound path ('tell grandma I'm
  leaving') only exists under (b), because a device-to-recipient POST never transits the hostile
  hub."*
- `GOALS.md:82` (2026-08-20): *"**Everything is pull.** … Push (a ping endpoint), inbound interop,
  and DMs that must not exist on a feed are extensions. *Retires:* the inbox pipeline, dedup/oracle
  rules, delivery chains, the published/delivered split."*

`GOALS.md` is the later document and the owner's, so it governs. What is flagged here is only that
its "Retires" line does not engage channel-gate's finding 1 — the covert outbound path — and that
the outside answers are split on the same question rather than settling it.

### 2.4 CONTRADICTS the floor — one model, deliberately

`qwen3.8-max`, asked what it would cut to halve the spec, leads with: *"**Cut the X25519 encryption
entirely.** This removes Assurance 2… the hostile hub can read everything. But the other three
assurances survive… This is implementable in an afternoon."*

The brief invited exactly this (*"if you think one of these four is… achievable only at a price not
worth paying, say so explicitly"*), so it is an answer rather than an error. It is the only place any
model proposed dropping a floor item, and it is reported because `GOALS.md:31` says *"Everything else
is negotiable"* about the other four — implying these are not.

### 2.5 INTERNALLY INCONSISTENT

`hy3` specifies signing as `base64(Ed25519_sign(canonical_json_without_sig, privkey))` and computes
ids as *"SHA-256 of the canonical (signature-stripped) post JSON,"* while the brief it was given
lists *"no JSON canonicalizer"* among the out-of-bounds dependencies. It is the only one of the five
that reintroduced canonicalization, and it did so without noticing or arguing for it. Its answer is
also the shortest by a wide margin.

---

## 3. The one measurement this exercise produced on its own

`glm-5.3` is the only model that answered the same brief twice — once defective, once corrected —
with everything else held constant. The delta is the cleanest evidence available about how much a
constraint in a brief shapes an answer, and it cuts against the earlier draft of this file.

| | defective brief | corrected brief |
|---|---|---|
| symmetric cipher | invented "HCTR," a SHA-256 counter-mode keystream **with no MAC** | AES-256-GCM or ChaCha20-Poly1305 |
| audience mechanism | **symmetric "circle" keys** exchanged out of band, argued at length as *"not the consolation prize — they are the correct semantics"* | per-recipient wrapping under one shared ephemeral — abandoned circles entirely, without comment |
| delivered channel | signed "ping" hints POSTed to a recipient's inbox | *"There are no hub-to-hub messages, no inbox, no federation, no delivery"* |

The circle-key design was the single most interesting idea in the first round, and one of its three
stated legs was the palette. With the palette corrected the model dropped the whole thing and
converged on the construction `src/enc.js` already implements. **An outside idea that does not
survive its own author's second look is not evidence for anything**, and the v1 answers are kept
only as a record of what a bad brief produces.

## 4. Two errors inside the answers, verified

**`glm-5.3` misstates the cost of its own construction.** It uses one shared ephemeral (`epk` appears
once in the envelope) and then says a recipient *"unwraps by trial, averaging N/2 ECDHs."* With a
shared ephemeral, `X25519(my_priv, epk)` is computed **once**; the trial loop is N/2 AEAD unwraps,
not N/2 key agreements. The distinction is the entire subject of `tmp/prototypes/enctags.md`, whose
verdict is that *"the cost driver was the **per-recipient ephemeral**, not the missing tag — and the
two halves are welded."* glm has the shared ephemeral and no tag, which that card measured as the
worse of the two partial adoptions: *"a shared ephemeral **without** tags forces
keys-outer/slots-inner, so every wrong key costs a full sweep of unwraps."*

**`hy3` reintroduces canonicalization.** Its signing input is
`Ed25519_sign(canonical_json_without_sig, privkey)` and its ids are `SHA-256` of *"the canonical
(signature-stripped) post JSON,"* in a brief listing "no JSON canonicalizer" as out of bounds. It is
the only one of the six that did this, did not argue for it, and did not appear to notice. It is
also the shortest answer by a wide margin.

## 5. Also already priced — glm's index-admission rule

`glm-5.3`: *"An item **counts** — is admitted to a reader's view — only if referenced by a validly
signed index… This closes the stale-key hole: a key stolen before rotation can't sneak items in,
because the current key's index won't list them."*

This is the existing canonicality rule. `open-feed-spec.md:407`: *"A feed is owned by the identity
whose identity document lists it in `feeds` (§3.2.1), and its contents are committed by the manifest
that entry names (§9)."* The property glm names — a pre-rotation stolen key cannot inject items
because the current key signs the index — follows from the same construction. What is worth noting
is only that glm states the anti-theft consequence as the rule's *purpose*, where the repo derives
it from §9's completeness machinery and prices the residual fork case separately in
`gates/subchain-gate.md` (*"exactly today's §5.5 class, no weaker and no stronger"*).

---

# Pass 2 — the models attack `GOALS.md`

Each model was shown its own pass-1 answer as conversation history, then a neutral summary of
`GOALS.md`'s direction written from its ten decision bullets, and asked to attack ours, attack its
own, and reconcile. Two findings below are verified against the exact lines and are stated first
because they are the only ones that name a specific pair of `GOALS.md` sentences that disagree.

## P1. `GOALS.md` retires the export bundle "because you always had the copy," and then mandates no copy

**`gpt-5.6-luna`**, unprompted, walks the divorce scenario to a portability failure:

> 1. The woman publishes a year of posts and photos. 2. Her device signs them, and the hostile hub
> stores them. 3. **The application deletes local copies after successful upload, as the direction
> permits.** 4. Her ex notices the divorce and deletes the stored objects. 5. He refuses all export
> requests and refuses further uploads. … She still has her signing key, but not "everything she
> wrote." The hub was the only copy. The protocol has delivered neither assurance 3 nor scenario 1.
>
> A signed tombstone does not help. It proves deletion, but does not reconstruct the deleted
> content. **This is not an implementation bug.** It follows from making the publisher forget and
> making backup UX optional.

The two `GOALS.md` lines it is standing between:

- **`GOALS.md:61`** retires *"the export bundle (**you always had the copy**), on-demand-export
  custody rules."*
- **`GOALS.md:68`** — *"Backup UX — keychain sync, passphrase-locked backup, recovery contacts,
  printed code — is app-level and **the spec mandates none**."*

The first justifies deleting §14 by asserting a local copy exists. The second declines to require
one. Nothing in `GOALS.md` closes the gap between them, and floor assurance 3 (`GOALS.md:26`) is
stated as *"You can leave at any moment with your identity and everything you wrote, without
asking, because **the key and the copy** were always on your device."* This is an unpriced tension
between two decisions in the same document, not a disagreement with the outside model.

## P2. `minimax-m3` names first-contact trust as the largest gap — which is the mechanism `GOALS.md:70` retires

> **The thing neither design considered and that I now think is the most important: trust on first
> contact.** Both designs assume the URL is honest. The threat model says the hub is the adversary
> from the first interaction. … Without it, the floor is built on sand.

Its proposed fix is a key fingerprint carried in the human-readable address, verified in the UI at
first contact.

The current specification already has this, and argues for it at length. `open-feed-spec.md:242`:

> A host can therefore serve the *member's* client a genesis document carrying the member's real
> recovery key and serve *everyone else* one carrying a key the host holds. Nothing in the member's
> own view is wrong… Device generation is defeated without ever being violated. The defence is
> comparison… an implementation hosting identities on behalf of others (§12) MUST present the
> member, at onboarding, with the `(seq, hash)` of their **genesis** identity document and a
> fingerprint of their **recovery key**, in a form suitable for reading aloud or comparing
> out-of-band… **One relative comparing one hash defeats the attack.**

`GOALS.md:70` retires it by name: *"**Retires:** recovery keys held outside the home, `_recovery_sig`,
fork resolution, **the genesis-fingerprint ceremony**."*

**Routed as a regression flag, not a finding.** An outside model with no repo access called the
deleted mechanism the single most important missing piece. That is not proof the deletion was wrong
— the ceremony was retired alongside recovery keys, which it partly exists to fingerprint, so some
of it may fall with them. What is verifiable is that `GOALS.md` deletes it without an argument, and
that the spec's argument for it (*"one relative comparing one hash defeats the attack"*) is not
answered anywhere in `GOALS.md` or `rejections.md`.

## P3. `gpt-5.6-luna` on the location list, and what "readers find them" does not cover

> Readers know only `https://family.example`. The family publishes a higher-sequence location
> statement **only to `family.example`**. The domain expires or the hostile operator suppresses the
> new statement. … **Remembering every location ever named does not solve this: the new location was
> never learned.**

Against `GOALS.md:73` — *"Readers remember every location a profile ever named and check the others
when the primary goes stale"* — and `GOALS.md`'s scenario 4, which asserts *"existing readers find
them from the location list."* The mechanism covers readers who learned a second location **before**
the primary died. gpt lists the five things that would close it (a surviving old endpoint, a
pre-published alternate, a contact who forwards the statement, a resolver, or a reader-side backup)
and notes `GOALS.md` already declines the resolver as *"an extension slot, not a mechanism."*
`GOALS.md` states the residual honestly for strangers (*"Strangers who only knew the old location
may be lost"*) but scenario 4's promise is about existing readers, and it is stronger than the
mechanism.

## P4. What the models said we got right

Reported because a critique that finds nothing good is not calibrated, and three of these are
decisions `GOALS.md` reversed against this repo's own prior position.

`gpt-5.6-luna`: identity as a key (*"correct and essential"*); the hub as storage and not signer
(*"the right trust boundary"*); the publish interface (*"excellent. It prevents the protocol from
quietly becoming 'use our application on our hub'"*); signing exact bytes; replies and reactions in
their author's own feed (*"avoids inbox ownership and cross-hub ACL negotiation"*); sealed recipient
identities; pull as the core (*"simpler and leaks less than a mandatory push channel"*); tombstones
rather than promised erasure.

`qwen3.8-max`, on the one it rates highest — and it is a reversal of its own design:

> **Sign-the-bytes, no canonicalization.** This is the single best decision in the document. My
> design specifies a signing payload built by string concatenation in fixed field order. **That is a
> canonicalization scheme wearing a disguise.**

## P5. Where pass 2 disagrees with itself on push

`minimax-m3` reaches the opposite conclusion from `gpt-5.6-luna` on the same question, and both
argue from scenario 4:

- `minimax-m3`: the other direction *"loses on relocation because it makes push optional. My design
  gets the floor right by **making push mandatory**."* It also concedes the cost `GOALS.md` avoids:
  *"If push is first-class, the inbox is a spam surface"* — and lists four mitigations it says
  neither design specifies.
- `gpt-5.6-luna`: *"Pull as the core is simpler and leaks less than a mandatory push channel."*

This is the same split pass 1 produced (§2.3), now argued rather than merely exhibited, and it lands
on the same question `gates/channel-gate.md` and `GOALS.md:82` disagree about internally.

## P6. `minimax-m3`: "push cannot be an extension" — the relocation attack, stated concretely

The sharpest attack in pass 2, and it targets `GOALS.md:73` directly. Its step 5 is the one that
does the work:

> Alice's device must put this Move somewhere readers will find it. **There is no inbox in the
> core.** The only place to put a signed item is at a location: either the old one (the hostile hub)
> or the new one (where nobody knows to look). … The hostile hub … just needs to *withhold*.
> Withholding is enough. … Readers who come back later fetch Alice's profile from
> `family.example`. … **The reader's "remember every location the profile has ever named" rule is
> satisfied because the profile has only ever named `family.example`.** The reader has no basis to
> look anywhere else.
>
> The other team's text says push is an extension. **It cannot be an extension.** … The other team's
> design has made the wrong primitive optional.

This is the same mechanism `gates/channel-gate.md` found from the other side — *"suppression is not
a corner case: it is the adversary's cheapest move"* — arrived at independently, with no repo
access, and aimed at the relocation path rather than the messaging path. `GOALS.md:82`'s "Retires"
list does not answer it.

## P7. One attack that does not land, and why it was raised

`minimax-m3` calls audience sealing *"hand-waving that probably does not survive contact with the
threat model"*:

> In any realistic construction, the recipient list is a set of `(key_id, ephemeral_pub,
> wrapped_key)` triples… If `key_id` is a hash of the public key (the only plausible "sealing"), the
> hub still knows the audience if it knows the recipients' public keys — which it does if any of
> them are on the same hub… I would not advertise this as a property the design delivers.

**It does not land against the shipped construction.** `src/enc.js:140` computes the slot tag as
`SHA-256("…" ‖ z)` truncated, where `z` is the X25519 shared secret between the per-item ephemeral
and the recipient's key — not a hash of the public key. `open-feed-spec.md:882`: *"computing it
requires one of the two private halves — an observer holds every recipient's published encryption
key (§15.1) and the ephemeral public key and **can still derive nothing** — and it is unlinkable
across items, because the ephemeral is fresh per item."* A hub holding every recipient's public key
learns nothing from the tag.

**Reported anyway, because the cause is on our side.** The pass-2 summary said only *"encrypted to a
chosen set of keys with the recipients' identities sealed inside"* and never said how. minimax
enumerated the plausible constructions, found the naive one broken, and concluded the claim was
unearned — correct reasoning from what it was given. This is the one place where the summary being
a summary produced a false negative, and it is worth knowing that "sealed inside" reads as
hand-waving to a competent reader who is not told the mechanism.

## P8. `minimax-m3` on sign-the-bytes: a cost `GOALS.md` does not name

Endorses the decision, then names the bill:

> It is **not** good if the file is JSON served by a hub that controls serialization… A hub that
> re-encodes the JSON before serving breaks the signature. A hub that doesn't re-encode, but adds a
> trailing newline, breaks the signature… the brief's claim that this is simpler than
> canonicalization is **partially wrong: it trades canonicalization-spec work for
> byte-fidelity-spec work**, plus the work of defining the file format.

`gates/bytes-gate.md` reaches the same place from the other direction and names the residue: strict
base64url spelling plus a four-item parse-hygiene list. Its verdict — *"the deletion is safe under
one carried-over rule"* — is a narrower claim than "no canonicalization" and survives this. What is
not recorded anywhere is the hub-side obligation minimax names: whether a hub MUST serve the exact
bytes it was given, and what a reader does about transfer encodings that alter them.

## P9. `qwen3.8-max`: social recovery as a takeover vector — priced by a card `GOALS.md` reintroduced past

`GOALS.md:65`: *"'key B succeeds key A,' valid when signed by A (rotation) or by **enough peers a
reader already trusts** (social recovery — at family scale, identity continuity *is* social, and
**the ex cannot fool the sister's own mother**)."*

qwen attacks the parenthetical:

> The other team's stated reasoning is that "a hostile operator cannot fool the subject's own
> mother." **But the protocol does not ask the mother.** The protocol checks a cryptographic
> threshold. The mother's judgment is not in the specification.

Its sequence: Alice's 3-of-5 trust set was configured during the marriage — Bob, her mother, her
sister, a shared "family" key generated on Bob's hub, and Bob's brother. After the separation Bob
holds three of the five. He signs *"Key C succeeds Alice's key A,"* publishes it, and posts as
Alice. The mother's app checks the threshold, finds it met, and accepts — *"It does this
automatically… The cryptographic check is the check."* qwen calls it *"the hardest open problem in
their design"* and declines to offer a clean fix, noting that unanimity does not help if the
adversary holds every share, that requiring the old key to co-sign defeats the purpose, and that
updating the trust set requires the key whose loss triggered recovery.

**Routed: ALREADY PRICED, and the pricing is why §4.5 bans the mechanism.**
`tmp/prototypes/threshold.md` Q3 is a capability table for 1-of-1 / 1-of-n / 2-of-3 against §13.2's
hostile custodian, and its verdict is:

> Q3 is why the ban survives on different grounds: k-of-n trades a theft risk for a coordination
> risk at the moment §14 requires an exit needing nobody's cooperation, and **a custodian holding
> two shares can both migrate alone and block.**

*"A custodian holding two shares can migrate alone"* is qwen's attack, recorded in this repo on
2026-08-17. `rejections.md` §9 carries the ban forward: *"k-of-n stays out for the recorded Q3
reason (coordination risk at the exit)."*

**What is new is not the attack but its target.** `GOALS.md:65` makes peer-threshold attestation the
*only* recovery mechanism, having retired recovery keys at `GOALS.md:69`. It does not cite Q3, and
`rejections.md` — whose stated job is that *"a reversal must answer the recorded reasoning in
writing and be surfaced plainly"* — has no entry reversing it. The one thing qwen adds beyond the
card is a critique of the *justification* rather than the mechanism: the defense named in
`GOALS.md:65` is a social claim about a check that is never social at runtime, because no reader's
app consults a human.

## P10. `qwen3.8-max` answers `GOALS.md`'s open questions 3, 4, and 5 directly

Reported as answers offered, not as answers adopted.

- **Open question 3** (how many peers, and is a trust set ever published): *"Do not specify a number
  in the protocol… The trust set is never published. If it were published, the hostile operator
  would know exactly which keys to compromise… 'keys X, Y, and Z co-signed this rotation.' The
  reader checks whether they trust X, Y, and Z. This is a reader-side judgment."* Note this sits in
  tension with its own P9 attack, which turns on the check being automatic.
- **Open question 4** (what is the head): *"The head is a third tiny signed file, separate from the
  generated feed view… the sequence number, the ordered list of item IDs, the list of tombstoned
  item IDs, and the author's signature… This is the one stateful object the author must maintain.
  Everything else is a file."*
- **Open question 5** (should push exist): *"No. Not in the core… fixed-cadence polling means a
  fetch proves nothing about who sent what. A push channel breaks this."* Its DMs are *"encrypted
  items stored at a path not listed in the head, fetched by the recipient's app during its regular
  poll — a minor path convention, not a delivery mechanism."* A ping may exist as an extension but
  *"the reader's endpoint is a webhook, not a fediverse inbox."*

This puts qwen opposite `minimax-m3` (§P6) on question 5, with both arguing from the same scenario.

## P11. `hy3`: the "frozen primary" attack — the freeze attack, rediscovered against `GOALS.md:80`

`hy3` attacks relocation from a third angle: not withholding the Move (§P6), not never learning a
second location (§P3), but **the primary never going stale in the first place**.

> "Stale" is never defined — there is "deliberately no freshness deadline." The hostile hub operator
> does not need to forge a signature or block the new hub. He simply **continues serving the old
> profile at sequence N** … forever, correctly signed, never updating. … The direction says readers
> "check the others when the primary goes stale." But the primary is **not stale** — it is serving
> bytes correctly. It is merely *frozen*. … **Why it is invisible to them: they treated relocation
> as a signed statement problem, not a liveness problem. Signature validity does not imply
> currency.**

Its step 3 is the one that matters: a cousin who *never saw* sequence N+1 has no lower-sequence
comparison to make and no trigger to look elsewhere.

**Routed: ALREADY PRICED, and the mechanism is retired at `GOALS.md:80`.**
`tmp/prototypes/freshness.md` opens on the identical attack, and names it:

> Every attack the two chains detect is a *mutation*… One mutation was left: **the null one.** A
> host serving the last honest version forever passed every signature, every invariant, and every
> pin check, and "the host stopped publishing you" read exactly like "you had nothing to say" —
> which, for §13.2's hostile custodian, is precisely the impression to give the family. **This is
> TUF's freeze attack**, and the pre-§9.1.2 spec did not name it.

Its verdict adopted §9.1.2 — *"a publisher-declared freshness deadline inside the signed bytes,
capped by the consumer's own ceiling — `min(declared, updated + ceiling)`"* — with the note that
this *"is why a first-contact consumer gets a real deadline on its first read,"* which is exactly
hy3's cousin.

`GOALS.md:80` retires *"freshness deadlines"* in the same list as the verdict lattice and item pins.

**The card also states the limit, and it cuts toward `GOALS.md`.** Its own verdict records what
§9.1.2 does *not* buy: *"a key custodian advances an empty manifest — same items, fresh `updated`,
fresh `_next_update` — and stays perfectly punctual while suppressing every new post (Q6); the bound
defeats a host that cannot sign, and §13.2's terminal adversary is not that host."* In the divorce
scenario the ex does not hold Alice's key, so he is the host that cannot sign, and the bound does
bind him — but the card's Q6 case is the reason the mechanism was never claimed as a full answer.

## P12. `hy3` on what neither design considered

> **Key rotation visibility for strangers.** Both assume followers poll. Neither specifies a
> *dead-man's switch* or "last-seen" gossip among readers so a frozen hub is detected without the
> user acting. A reader-to-reader "I saw seq=N+1 at X" ping (private, not protocol-core) is missing.

Reader-to-reader comparison of observed positions is §5.3.1's compare rule plus §16.1's item-carried
pins, and `rejections.md` §4 records the standing foreclosure on any *aggregate* of it: *"no pins
document, no log, no witness network — permanently — because a standing published record of
who-observed-whom is a reading graph with timestamps."* `gates/sealed-pins-gate.md` is the version
that survives that foreclosure by carrying pins inside encrypted content. `GOALS.md:81` retires
*"item-carried pins as a mechanism."* hy3's framing is narrower than the foreclosed aggregate — a
private reader-to-reader exchange, explicitly "not protocol-core" — which is closer to the sealed
form than to the pins document.

## P13. `hy3` reverses its own two worst pass-1 choices

Both were things this repo also decided, and hy3 concedes them without prompting:

> **I used canonical JSON.** Brief banned canonicalizer libs; rolling your own is the #1 interop
> killer. Their "sign the file bytes" fixes this. **I was wrong to include it.**

> **I published recipient count.** My `boxes` array length reveals N. … I should use a deterministic
> search or **constant-size padding**.

The second is the §2.2 slot-count question, arrived at by a model auditing its own design rather
than ours — and `src/enc.js:185` has the same property hy3 is calling a defect in its own work.

---

## P14. Completeness of the run

All twelve responses landed: six pass 1 and six pass 2, one model per lab.

| model | pass 2 | how |
|---|---|---|
| `gpt-5.6-luna` | 2,484 words | streamed, first attempt |
| `minimax-m3` | 4,922 words | streamed, first attempt |
| `glm-5.3` | 3,780 words | `--no-stream`, `effort: high` |
| `qwen3.8-max` | 3,236 words | `--no-stream`, `effort: medium` |
| `kimi-k3` | 3,105 words | `--no-stream`, `effort: low` — after three failures |
| `hy3` | 960 words | `--no-stream`, `effort: medium` |

Every streamed pass-2 attempt except two came back with `finish_reason: null` — the gateway cutting
the connection, which reads as a finished answer unless the last sentence is checked. `qwen3.8-max`
and `hy3` were cut mid-sentence; `kimi-k3` and `glm-5.3` returned a reasoning trace and a one-word
body. The `--no-stream` path fixed all four. The pre-fix answers are kept in
`responses/pass2-streaming-truncated/` for comparison, and the streaming and effort settings are
stamped per response because both changed what was produced.

## P15. Things every model assumed that this repo does not, and no card covers

Not attacks, and not proposals — shared blind spots between them and us, which is the one category
this exercise is structurally good at surfacing.

**Multi-device — and this one is sharper than the models could know.** `minimax-m3`: *"Real users
have phones and laptops. **Neither design specifies how Alice publishes from two devices.**"*
`kimi-k3`'s pass-1 cost sheet is blunter: *"Multi-device is punted… **This will be the first thing
real users demand.**"*

`GOALS.md:59` reads *"**The device is the only signer**; the hub is storage and serving"* — singular
— and `GOALS.md` never says what happens when there are two.

The repo does have an answer, and it is in `gates/writer-gate.md`, whose verdict is:

> The feared "client must re-sign on sync under delegated custody" corner dissolves once authorship
> and ordering are split between two signatures — **authorship lives in the blob (member key),
> ordering in the entry (delegated key)** — which is also **LOG+URL's multi-device answer** and
> makes **§4.6-style custody load-bearing rather than recommended for multi-device deployments.**

So the only multi-device answer this repo has worked out **requires delegated keys** — and
`GOALS.md:60` retires them by name, in the same bullet that makes the device the only signer:
*"*Retires:* **delegated keys**, cadence batching, the export bundle…"*. The gate makes delegated
custody *load-bearing* for multi-device; `GOALS.md` deletes it. Neither document mentions the other.

**Inbox spam, conditional on push existing.** `minimax-m3` lists four mitigations (HTTP-signature
requirement, hub rate limits by IP and by key, reader-side allow-lists, a hub-computable
spam signal) and notes *"neither design addresses this."* `gates/channel-gate.md`'s residue names
*"IP-then-author rate ladder"*, so the repo has half of it in a gate but not in `GOALS.md`.

**Whether a hub must serve back the exact bytes it was given.** Raised by `minimax-m3` (§P8). Under
sign-the-bytes this is load-bearing, and neither `GOALS.md:92` nor `gates/bytes-gate.md` states it as
an obligation on the hub — the gate reasons about mutation by an attacker, not about a
well-meaning hub that re-encodes or appends a newline.

## P16. `glm-5.3`: the recovery attack, and a fix that re-derives a mechanism `GOALS.md` retired

The strongest form of §P9, because it attacks the defense rather than the mechanism:

> The reasoning contains its own refutation. The brief's adversary is *inside the family* — which
> means, **by construction, the hostile operator is a peer the mother already trusts.** Bob isn't an
> outsider trying to fool grandma; he's her son-in-law of twenty years, his key is pinned in her
> reader, his feed is one she polls daily. He is *exactly* what "a peer a reader already trusts"
> denotes.
>
> … The mother isn't fooled *despite* the mechanism, she is fooled *by* it. The mechanism was
> designed for "your peers vouch that you lost your key"; its validity predicate as written is
> "anyone the **observer** likes." **Delegation anchored in the observer is not delegation.**

**The corollary is the part with no counterpart anywhere in this repo — identity becomes
viewer-relative:**

> The sister who never followed Bob's feed doesn't trust him, rejects the attestation, and keeps the
> old key. Now the family holds two incompatible verdicts about who Alice is, **each locally
> valid.** My design, at its worst, produces a *visible* fork ("identity contested, two live
> chains"). Theirs produces a **silent, inconsistent one — resolved-looking, resolved differently
> per reader.** That's worse, because nothing prompts anyone to make the phone call.

Everything in §5.3.1, §5.5, and `gates/subchain-gate.md` assumes a fork is a *disagreement about
bytes* that comparison surfaces. A reader-relative trust predicate produces divergence with no
disagreement about bytes at all — both readers see the same attestation and reach different verdicts
correctly. No card covers it.

**glm's fix is §4.5's design, re-derived, plus two things §4.5 does not have.**

> The attesting peers must have been **designated by the key being succeeded**, recorded in the
> identity, not in the reader.

That is what the current spec does. `open-feed-spec.md:168`: a recovery co-signature is by *"a
**recovery key** (§4.5) committed in a pinned ancestor of the predecessor."* Designated in advance,
committed in the chain, resolved against a pin. `GOALS.md:69` retires *"recovery keys held outside
the home, `_recovery_sig`."*

Two pieces of glm's version are genuinely not in the spec:

1. **The recovery set as a hash commitment, revealed only at use** — `sha256(pubkey₁ ‖ … ‖ pubkeyₙ)`
   in the chain, the members disclosed inside the recovery event and checked against the commitment.
   *"Pre-recovery, the hub and strangers learn nothing about who the recoverers are… Grandma
   designates her daughter at onboarding and the designation is invisible until used."* The spec
   commits recovery keys **in cleartext**: `open-feed-spec.md:104` shows
   `{ "kid": "recovery-1", …, "use": "recovery" }` in the published identity document, so today a
   hostile custodian reads the recovery arrangement off the wire. glm's commitment also answers
   `GOALS.md`'s open question 3 (*"whether a reader's trust set is ever published — today's answer:
   never"*) with a construction rather than a policy.
2. **A veto window.** *"A recovery-signed succession is provisional for a fixed window (default 14
   days). During the window, the superseded key may sign a `contest` event; any reader who sees one
   displays 'identity contested' and trusts neither branch."* The spec has no provisional state:
   `open-feed-spec.md:170` handles the collision by refusing to resolve — *"Two recovery-based
   migrations claiming the same predecessor are unresolvable, and a consumer MUST NOT follow either
   without out-of-band confirmation"* — which fires only once a second claim exists. A veto window
   gives the victim a defined interval and a signed way to use it.
3. **No entrenchment.** *"A recovery-signed event may change `key` and nothing else. Not locations,
   not the recovery commitment, not the name… Alice's escape routes survive the attack."* The spec
   places no such restriction on what a recovery-co-signed migration may carry.

## P17. `glm-5.3` on staleness: a heartbeat built out of `GOALS.md`'s own scheduled-posts decision

Its second attack is §P11 again — *"Stale is the trigger for failover, and with no freshness
semantics, a hostile hub serving a frozen-but-valid head is byte-for-byte indistinguishable from an
author who stopped posting. The trigger condition is undefinable, so the failover never fires…
Bob gets to narrate the silence ('she's gone dark, poor thing'). The relocation mechanism — the part
of their design that's genuinely good — is dead code without a staleness definition."*

Its repair reuses a decision `GOALS.md` already took for a different purpose. `GOALS.md:59`:
*"Scheduled posts are pre-signed by the device and released by the hub."* glm turns that into
freshness:

> The author's app **pre-signs sparse heartbeat events** — their scheduled-post insight,
> repurposed: one tiny "still here" event per week for the next six months, released on schedule by
> the hub. A hostile hub can withhold them, but any reader who checks a second location — mandatory
> behavior — sees the heartbeat there.

It flags its own third component as heuristic: *"it detects frozen hubs for readers who remember a
second location and for no one else."* `tmp/prototypes/freshness.md` reached a comparable limit from
the other side — its Q6 case is a custodian who *stays punctual* while suppressing content — but the
constructions differ: §9.1.2 is a declared deadline the publisher promises, glm's is pre-signed
content the hub must either release or visibly withhold. Nothing in the repo prices the pre-signed
variant.

## P18. `kimi-k3`: relocation stated as a graph-reachability problem

The most precise formulation of what §P3, §P6, §P11 and §P17 each reach differently. kimi states it
as three facts and observes there is no edge between them:

> 1. The new location is named only in the **new profile**.
> 2. The new profile is fetchable only **at a location the reader already knows**.
> 3. The reader knows only locations named in profiles it has **already fetched**.
>
> There is no edge in this graph from the reader's knowledge to the new location.

Its step 4 sharpens what `GOALS.md`'s scenario 1 actually promises:

> The frozen copy does not merely read as stale. It reads as **her, currently, not posting**. That
> is strictly worse than the brief's requirement ("reads as stale rather than as her") — **the
> design cannot even reach *stale*.**

And its step 5 names the cost in a way none of the others do:

> Her actual escape is a telephone… The other team has silently downgraded **relocation**, a routine
> event (scenario 4: the domain lapses for ten thousand people at once), to the recovery posture my
> design reserves for **total key loss**… "Nobody's identity changes" is technically true and
> operationally hollow: **the identities survive but the graph does not.**

It also isolates the conjunction rather than blaming one decision — *"the root cause is not the
missing resolver. It is the conjunction of two choices that each looked clean in isolation:
locations live only inside signed profiles, and there is no push path"* — and lists three
independent repairs, any one of which suffices: a push channel used only for relocation, gossip of
profiles between readers, or a fallback location reachable outside the current profile's own list.

**Its concession on the freshness lattice is the most calibrated sentence in pass 2**, and it is a
partial defense of `GOALS.md`:

> **Refusing the freshness lattice is correct as far as it goes.** A withheld/stale verdict system is
> out of scope for a weekend implementer. **Their error was not refusing the lattice; it was
> refusing the lattice *and* the push channel, leaving nothing.**

## P19. `kimi-k3`: pull-only removes the split-view detector

> My design gets cross-checking for free because readers already receive pushed envelopes from each
> other and can compare heads inside them. Their readers are isolated pollers; a hub serving head_40
> to mother and head_47 to sister is detectable only if mother and sister compare notes *outside the
> protocol*. **A design whose adversary is a hostile insider should not strip the one channel that
> lets his victims corroborate.**

This is §5.3.1's compare rule and §16.1's item-carried pins — the mechanism whose entire purpose is
supplying a second observation — and `GOALS.md:81` retires *"item-carried pins as a mechanism, the
compare-rule apparatus."* `gates/sealed-pins-gate.md` is the version that survives §16.1's
aggregator foreclosure by carrying pins inside encrypted content, and its verdict scopes it to
exactly the population kimi describes: *"this reaches parties who exchange encrypted items — the
two-self-hosting-families persona exactly."*

kimi arrives at the same place from the opposite direction: it has the pins because it has the push
channel, and observes that removing the channel removes the corroboration with it.

## P20. The count

Five of the six models attacked **relocation against a hostile hub**, each from a different angle,
without seeing each other's answers:

| model | the angle |
|---|---|
| `minimax-m3` | the hub withholds the Move; *"push cannot be an extension"* |
| `gpt-5.6-luna` | readers who never learned a second location have nothing to fall back to |
| `hy3` | the primary never becomes *stale*; *"signature validity does not imply currency"* |
| `glm-5.3` | the failover trigger is undefinable, so *"the failover never fires"* |
| `kimi-k3` | no edge in the reachability graph; *"the identities survive but the graph does not"* |

The sixth, `qwen3.8-max`, spent its attack on social recovery instead (§P9) — where `glm-5.3` also
landed (§P16). So the six answers hit exactly two targets, and both are `GOALS.md` decisions rather
than anything inherited from the current spec.

Each angle maps to a mechanism the current specification has and `GOALS.md` retires:
`open-feed-spec.md:242` (fingerprint comparison, retired at `GOALS.md:70`), §9.1.2 freshness
(retired at `GOALS.md:80`), §5.3.1 and §16.1 comparison (retired at `GOALS.md:81`), §4.5 recovery
keys (retired at `GOALS.md:69`), and a delivered channel (`gates/channel-gate.md`'s verdict, against
`GOALS.md:82`).

**This is a count, not a verdict.** Five models converging says the seam is where a competent
designer looks first; it does not say the retired mechanisms were the right answers, and two of
those mechanisms carry recorded limits of their own — `freshness.md`'s Q6 punctual custodian, and
`threshold.md`'s Q3, which is the reason §4.5 bans the k-of-n shape `GOALS.md:65` reintroduces.
