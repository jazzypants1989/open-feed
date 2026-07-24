# PROPOSALS-7.md — Seventh pass: the skeptic's rebuttal to the empirical turn

> **Written in response to `PROPOSALS-6.md`**, by a reviewer given only that document, the spec, and
> the repo. I read the spec end-to-end, `ENCRYPTED-CONTENT-FINDINGS.md`, both prototypes
> (`tmp/enc-prototype.js`, `tmp/circles-prototype.js`), `open-feed-restricted-feeds.md`,
> `open-feed-conventions.md`, and the relevant parts of `DISTRIBUTION-MODEL.md` and `README.md`.
>
> The brief was: **steelman the NO**, attack Q1–Q8, don't treat passing prototypes as a decision.
>
> **Verdict up front.** The prototypes are sound as far as they go, and one pro-encryption argument
> is *stronger* than six passes have made it. But **the argument actually deployed in §2 of
> PROPOSALS-6 — "one concept that naturally scales up" — does not hold**, the central per-hop
> confidentiality claim is **factually wrong for the reference product**, "two small additive edits"
> is really **seven touches** including two the passes never considered, the prototyped construction
> has **one genuine security defect**, and Q2's "unfound persona" is **findable in two minutes** — it
> is the family photo and the reply graph. E-only is not the destination. **E-complement is**, and
> there is a configuration of it (§7 below) that nobody has stated across seven passes and which
> dissolves most of the dilemma.

---

## 1. Q1 — the steelman NO, in seven parts

Not "encryption is bad." The case is that **reversing "E2E out of scope" buys less than it appears,
costs more than it appears, and the specific costs land hardest on exactly this product.**

### 1.1 The scaling argument in §2 is unsound as stated

PROPOSALS-6 §2 convicts authorized-fetch of being "a second mechanism switched on for one topology"
and acquits encryption as "one concept that scales trivially." Both halves fail:

- **Encryption is *also* a mechanism for one topology.** It is used for private content and not used
  for public content. Public posts are not encrypted; a solo blogger encrypts nothing; a single-hub
  family behind a login wall gains nothing (the hub holds the key either way — for its own users'
  posts encryption there is literally theater, by the passes' own per-hop analysis). So encryption is
  *precisely as* topology-specific as the gate: it is the private-content mechanism. The criterion,
  applied evenly, does not discriminate between the options. Something else has to.
- **Under the literal reading of "scales up," encryption scales the wrong way.** Cost per item is
  **O(audience)** — one wrapped CEK + one ephemeral public key per recipient, ~150 bytes each. At
  N=10 that is the "negligible" the findings doc measured. At N=1,000 it is ~150 KB of envelope on
  every post, and at N=10,000 it is ~1.5 MB per post against a 10 MB feed-page cap (§14.4) — you can
  hold ~6 items per page. Reading is worse: **untagged recipients force every reader to trial-decrypt
  every slot**, so a reader does O(N) X25519 operations *per item*. Host-gated authorization is O(1)
  per item and one check per request. Encryption scales *down* beautifully and *up* badly; the
  membership problem (rosters, churn, no PFS) also gets monotonically worse with N. "Naturally scales
  up" is the one thing it does not do.
- **A corollary the passes should note:** an audience-size cap becomes a *normative* requirement, not
  a nicety. An item with 100,000 recipient slots is a cheap DoS against every reader that opens it
  (100k ECDH ops to discover you are not in the audience). §14.4 would need a recipient cap. That is
  core-text touch #5 (see §3).

**What survives of the north-star.** The owner's criterion is worth keeping, but it needs restating
in a form that actually discriminates. The property the owner is reaching for is not *scale* — it is
**single-valuedness: every artifact is byte-identical for every reader.** That is the property the
whole trust model rests on (§5.3, §9.1, §14.2: pin, walk, gossip, compare). Audience-varying serving
is the *only* thing in the protocol that breaks it, which is why restricted-feeds §8.2 exists, why
conventions §5 self-commitments had to be invented to patch it, and why the patch is admittedly
incomplete ("commitment lag"). **Encryption's real virtue is that it keeps every signed document
single-valued.** That argument is correct, it is not the argument §2 makes, and it survives every
objection in this document. Use it instead — but note it points at a *narrower* conclusion (§7).

### 1.2 The per-hop confidentiality claim is wrong for the reference product

PROPOSALS-6 §3.3 and the findings doc both assert encryption protects your content on "the CDN, the
network, and **every other family's hub** — even for hub-managed users."

The stated rule is right: confidential against everyone except the author and **a holder of a
recipient's private enc key**. The conclusion drawn from it is wrong, because in the product being
built the recipient's hub *is* a holder of the recipient's private enc key.
`DISTRIBUTION-MODEL.md:917` — "Per-user keypair generation; **hub-managed keys encrypted at rest**";
`:1087` — `keys(... private_key_encrypted ...)`; `:1267` — "hub-managed is the default." Grandma
reads on an iPad through her hub's web UI. Something has to decrypt server-side to render that page.

So for two hub-managed families the delivered guarantee is: **hub A cannot read hub B's outbound
posts in transit or at rest on the CDN** — which TLS plus a non-public bucket already substantially
provide — and nothing more. The "protected against every other family's hub" line only holds when the
*receiving* family is client-side-keyed, which is the minority configuration the product explicitly
does not default to. The honest statement is: *encryption's value tracks exactly how many recipients
hold their own enc keys*, which is a **product/UX** variable, not a protocol one. That is a much
weaker sell than the passes have been making, and it should be corrected in
`ENCRYPTED-CONTENT-FINDINGS.md` regardless of which way the fork goes.

### 1.3 Encryption creates the protocol's first unverifiable security rule

Every rule in the core today is checkable from bytes by a third party: signatures, author binding,
chain linkage, manifest invariants, canonical/copy. That is the source of the "transparency with
teeth" claim in §14.2 — misbehavior *surfaces*.

Encryption is different in kind: **whether the author wrapped to the right people is unverifiable by
anyone**, including the other members of the audience. With untagged recipients, a ciphertext's
audience is opaque; only slot *count* is visible. Consequences:

- Nobody can detect a wrap to a stale, revoked, or hub-substituted key.
- Nobody can detect an *extra* recipient beyond count-mismatch — and the count only helps if the
  intended audience is publicly known, which is the thing untagged recipients deliberately hide.
- A key-custodian hub that *reads* leaves **no trace at all**. Contrast the existing tiers: a
  custodian that rewrites history forks a chain and gets caught. Encryption adds a custodian power
  with **no transparency analog**. §14.2's tier table would need a new row saying so.

This matters most for Q3 (below): "consent = membership in the wrap-list" is only meaningful if
membership is auditable, and it isn't.

### 1.4 Key lifecycle: the spec's key machinery does not carry over, and there is no recovery path

§4.3 (rotation), §4.4 (revocation), and §4.5 (recovery keys) are all designed for **signing** keys.
None of them means what it says for a decryption key:

- **`revoked_at` is meaningless.** §4.4's rule is verifier-side: reject signatures dated after
  revocation. You cannot un-decrypt. Revoking an enc key stops nothing retroactively (no PFS) and its
  only forward effect is an obligation on *other people's encryptors* — an obligation no verifier can
  check (§1.3).
- **Rotation is not forward-only.** A rotated-out signing key can be dropped after 30 days (§4.3). A
  rotated-out *enc* key must be retained **forever** by its owner or the content wrapped to it becomes
  permanently unreadable. Rotation hygiene inverts.
- **There is no recovery key for decryption.** `_recovery_sig` (§3.4, §4.5, §5.5) restores *identity
  continuity*. It cannot restore *readability*. A user who loses their enc private key loses their
  entire archive — irreversibly, cryptographically, with a correct backup of every byte on disk.
- **Migration acquires a must-survive secret.** Today (§3.4) migration needs no secret to survive
  except the offline recovery key; everything else is public state plus attestations. Add encryption
  and the enc private key must migrate as a secret *and* be retained indefinitely, because every item
  anyone ever wrapped to it — including items in *other people's* feeds — is frozen against it.

For a **decades-long family memory archive**, "one lost key = the baby photos are noise forever" is a
product risk of a different class than anything currently in the spec. The spec today has no failure
mode that destroys content; encryption introduces one, and it is user-triggered.

### 1.5 The gate's failure mode is recoverable; encryption's is not

Restricted-feeds' worst case is a **policy** failure: the wrong person read something, or a host
equivocated (§8.2). Bad, bounded, fixable, and — with self-commitments — partly detectable.
Encryption's worst cases are **cryptographic**: unreadable archive, undetectable over-wrap, no
retroactive revocation, no PFS. Symmetrically: the gate is revocable (grants expire; the revocation
chain of §6.2.2 is faster still), encryption is **not revocable at all** — once wrapped, forever
readable by that key-holder. PROPOSALS-6 waves this off as "identical to the §2 re-share concession."
It isn't identical: re-sharing requires a *human decision by an authorized reader*; no-retroactive-
revocation applies automatically to *every* past item for anyone who ever held the key, including a
compromised device recovered from a landfill.

### 1.6 Complexity is relocated, not reduced — and it lands on the party least able to carry it

The honest ledger (I did the count; see §6 for the pro-E side, which is real):

| Removed by E-only | Added by E-only |
|---|---|
| Fetch assertion + replay cache (restricted-feeds §4, §5) | X25519 `use:"enc"` key: definition, lifecycle, rotation-with-retention, no-recovery caveat |
| Capability grants + delivery + revocation chain (§6.1–6.3, §6.2.2) | Multi-recipient JWE profile (untagged recipients, recipient cap, trial-decrypt) |
| Gated manifest (§7) | AEAD-binding rule to stop ciphertext relay (§4 below — new) |
| §8.2 cross-reader equivocation caveat | Roster/circle chain: a **third** chained document type, with its own pin/walk/history |
| Conventions §5 self-commitments (its whole reason to exist) | Roster freshness protocol + staleness detection (Q4) |
| Restricted CORS carve-out + timing equalization (§9) | Client-side key custody, multi-device sync, backup/escrow UX |

The spec's surface shrinks. The **implementer's** surface grows, and the growth is in the hardest
category in the field — group key management — which the passes correctly identify as
"the group-membership problem in miniature" and then treat as solved because a 210-line prototype
with deterministic keys and no network ran green. Every E2E messenger in existence is mostly this
problem. Answer to Q1's literal question: **encryption relocates complexity from the serving path
into client-side key management, and the relocation is net-negative for a family hub whose users
cannot manage keys** — which is why the product defaults to hub-held keys, which is what erases the
guarantee (§1.2). That circularity is the strongest single argument for NO.

### 1.7 Brand and scope discipline

"E2E is out of scope" is currently load-bearing in three published places (spec §11, README FAQ ×2,
restricted-feeds §2). Reversing it on the strength of two probes invites the reading that scope
boundaries move when a clever mechanism appears. **A narrower reversal costs nothing and claims
nothing false**: "the core is not an E2E messenger; encrypted content is an OPTIONAL extension for
those who hold their own keys." That is defensible forever and is what §7 recommends.

**Where the steelman ends.** I cannot make the NO *total*. Two things genuinely justify some
encryption: true DMs (§6.2) and single-valuedness (§1.1). The NO defeats **E-only**, not **E**.

---

## 2. A real defect in the prototyped construction: ciphertext relay

Neither prototype tests this, and it is not a nitpick.

In both scripts, the JWE's AAD is the protected header (`{"enc":"A256GCM"}`) and the plaintext is
`{"content_text": "..."}`. **Nothing inside the sealed envelope binds it to the item that carries
it.** The outer `_sig` binds `_enc` to *an* item — the attacker's item.

**Attack.** Under E-only the feed is world-readable. Eve fetches Mom's encrypted item, copies the
`_enc` blob verbatim into a new item with a fresh `id`, her own `authors`, her own `_feed_url`, her
own `_rel`, signs it with her own key, and posts/delivers it. Every check passes: signature valid,
author binding valid, `_feed_url` matches, canonical (fresh `id`, so §7.5's exclusivity rule is not
triggered), manifest commits it. Any audience member's client decrypts it and renders Mom's private
words **attributed to Eve, in a context Eve chose** — e.g. as a `reply` to a question Mom never
answered.

Note what makes this new: **Eve does not need to be in the audience.** She relays content she cannot
read. In the cleartext world, a copier can only misattribute what they could already read; here the
capability is strictly broader, and it works against exactly the people the encryption was for.

**Fix (cheap, standards-native).** Bind the envelope to its carrier. Simplest: make the plaintext a
content object that *includes* the binding fields —
`{"id": ..., "authors": [...], "_feed_url": ..., "content_text": ...}` — and require clients to
**reject the item if the decrypted `id`/`authors` do not equal the outer ones**. Alternative: put the
binding in the JWE `aad` member (JWE JSON Serialization supports it) or in the protected header, so
the AEAD covers it. Either way this is a **MUST**, and it is a design decision the "just JWE, it's a
content-encoding" framing hid. It also refutes the cleanest form of the elegance claim: the envelope
is not context-free; it has to know what item it lives in.

Secondary note: in JWE JSON Serialization the **per-recipient** headers (`alg`, `epk`) are *not*
covered by the AEAD. Here the item's `_sig` covers them, so they are safe — but only because of the
outer signature. Any spec text should say so explicitly, because a reader who lifts `_enc` out of its
item (e.g. into a cache or a bridge) loses that protection.

---

## 3. Q5 — "two small additive edits" is seven touches, and two are semantic

I audited the spec for the third touch as asked. There are five more, and #4 and #7 are not
mechanical:

1. **§4.1** — admit `crv:"X25519"` and `use:"enc"`. (Known; correctly downgraded from "zero-touch" in
   the findings doc.)
2. **§7.2** — content MAY be a JWE envelope in `_enc` with `content_text:""`. (Known.)
3. **§7.3 (tombstones) — NEW, and a live bug.** §7.3 says delete = "content fields removed
   (`content_text` set to `""`)". `_enc` is an underscore-prefixed extension field, and §7.2 says
   consumers **MUST preserve** unknown `_` fields. Read literally, **a conformant tombstone of an
   encrypted item retains the ciphertext and deletes nothing.** §7.3 must name `_enc` as a content
   field that MUST be removed on tombstoning.
4. **§4.3/§4.4/§4.5 — NEW, semantic, not additive.** Rotation, revocation, and recovery all mean
   something different (or nothing) for a decryption key (§1.4). This is not one table row; it is a
   sub-section defining a *second key lifecycle* with inverted retention rules and no recovery path.
   This is the biggest under-counted cost in PROPOSALS-6.
5. **§14.4 — NEW.** Recipient-count cap, or every reader is trial-decrypting an attacker-chosen number
   of slots (§1.1).
6. **§14 (security considerations) — NEW.** At minimum: no PFS; enc-key loss is unrecoverable; the
   wrap-list is unverifiable; §14.2's tier table gains a custodian power that leaves no trace (§1.3).
7. **§6.6/§7.2 — NEW, from §2 above.** The inner/outer binding check for `_enc`. A *verification*
   rule, i.e. it touches the verifier — which is precisely what "no new trust construction" promised
   it would not.

Everything else I checked is clean, and PROPOSALS-6 was right about these: §9 manifest invariants,
§7.5 canonical/copy, §6.5 verification order, §9.4 lag rule, §12 replies (byte-verbatim works fine on
ciphertext), §10 inbox (relevance is judged on cleartext `_rel`, so encrypted items route correctly).
`content_text:""` is already blessed by §7.2 for content-less relation items and tombstones, so it
needs nothing.

---

## 4. Q6 — migration: the ciphertext claim is right; the *key* claim is missing

Confirmed as far as it goes. §3.4's bulk re-signing changes `_feed_url`, `_version`, and
`date_modified`; `_enc` is opaque bytes the signature covers but does not depend on, so the re-signed
item carries the identical envelope and the original audience still decrypts it. **No re-wrapping is
required, and nothing in §3.4 breaks.** PROPOSALS-6's reasoning is sound.

But it asked the wrong half of the question. What migration *does* break is **key continuity**:

- The migrating identity must carry its X25519 **private** key across the migration and retain it
  indefinitely (§1.4), because every past item — and every item *other people* wrapped to that key,
  in *their* feeds — is frozen against it. Migration today requires no such secret.
- **Recovery-based migration (§3.4, domain loss) recovers the name and not the archive.** The
  recovery key attests continuity; it cannot decrypt. A recovered identity is readable-by-others and
  unreadable-by-itself.
- A migrated identity that publishes a *new* enc key has silently partitioned its archive into
  old-key and new-key eras, with no protocol-visible marker. If enc keys are specified, §3.4 needs a
  sentence, and §4.1 needs enc keys to be **cumulative and never dropped**.

---

## 5. Q7 — D2 is sound, but only if the exemption is a **feed-level** property

Three findings:

1. **Make exemption a property of the feed, not the item.** §9.4 invariant 3 says a served feed MUST
   NOT contain live items absent from its manifest. Per-item exemption inside a manifested feed makes
   that invariant conditional on a verifier branch (`is this a content-less relation item?`) and turns
   a bright-line rule into a judgment call. Feed-level ("this activity feed has no manifest") keeps
   invariant 3 exactly as written and is trivially checkable. The escape hatch in the locked D2
   decision still works: a publisher who wants the completeness proof publishes the activity feed
   **with** a manifest, and then invariant 3 applies in full.
2. **§7.5's copy rule needs an explicit clause, or it dangles.** §7.5 says "to determine whether a
   copied item is live or deleted, consult the manifest at its `_feed_url`." For a manifest-less feed
   there is nothing to consult, so a copied like is **permanently uncheckable** — it can never be
   shown to be retracted. Required text: *an item whose `_feed_url` names a manifest-less feed carries
   no liveness authority ever; consumers MUST NOT cache it as live and MUST treat retraction as
   conveyable only by inbox tombstone.*
3. **The real gap is fresh consumers, and it is acceptable.** A consumer that saw the retraction
   rejects the replay by dedup (§10.3, higher `_version` wins). A consumer that *never* saw it can
   never learn the like was withdrawn — a host can serve a retracted like forever. At family scale the
   party that matters (the target's hub) gets the tombstone by inbox, so the residual is small. State
   it; don't paper over it. And note the coupling: **D1's `feeds` entry must make `manifest`
   OPTIONAL**, which contradicts the current §3.2 rule that additional feeds are "each committed by
   its **own** signed manifest." D1 and D2 have to land together.

---

## 6. Q8 and the honest pro-E ledger — what encryption genuinely deletes

Yes, encryption makes existing mechanisms redundant, and PROPOSALS-6 *undersells* this. It is the
best argument in the file and it is not the one §2 makes:

- **restricted-feeds §8.2 stops existing.** An encrypted feed is a *public* feed: byte-identical for
  every reader, gossipable, CORS-`*`, pinnable. Cross-reader equivocation detection comes back for
  free, by construction, with no opt-in.
- **conventions §5 (self-commitments) loses its purpose.** That whole section — plus §5.1's
  commitment-withholding rule, §5.2's operational requirements, §5.3's tradeoff triangle, and vectors
  C.2/C.2b — exists solely to patch §8.2. It becomes dead weight for encrypted feeds.
- **The grant-revocation chain (§6.2.2, last session's F3 work, vectors R.4/R.4b) becomes moot**, as
  do reader lists (§6.3) and the gated manifest (§7).
- **README's "private message = a restricted feed of two"** collapses into "an item wrapped to one
  recipient" — and unlike today's answer, that one is *actually* private, which is a real capability
  gain, not a reshuffle.

Sunk-cost warning in both directions: a large fraction of the deleted machinery was built in the last
two sessions. That should not make it survive, and it should not make deleting it feel like progress.

The residual after all that deletion: **metadata**. Which is Q2.

---

## 7. Q2 — the persona is not missing. It is the photo and the reply graph.

PROPOSALS-6 asks for a persona justifying a surviving gate and says none appeared in six passes. Two
are in the repo:

**7.1 The attachment. `_enc` does not encrypt photos.** §7.4: attachments are JSON Feed
`attachments` — URLs, with `_sha256` for integrity; the bytes are not signed and are not inside
`_enc`. `DISTRIBUTION-MODEL.md:1157` budgets **10 photos per entry at 10 MB each**, and `:1143` shows
them served as static siblings: `/2025/12/07/cookies.jpg`. Under E-only that is a **world-readable
JPEG of your kid next to an encrypted entry about her**. For a family journal, the photo *is* the
content. Encrypting blobs is not "one more sentence": streaming AEAD, per-blob key distribution and
rotation, no CDN transforms or server-side thumbnails, and no plain `<img src>` in a browser without
a service worker or blob URLs. Q2 lists "large media you won't encrypt" in a subordinate clause and
then declares the persona unfound. It is the flagship content type.

**7.2 The interaction graph.** Encryption leaves `id`, `date_published`, `authors`, `_feed_url`,
`_version`, and — critically — **`_rel` with its `to` targets** in cleartext, on a world-readable,
`Access-Control-Allow-Origin: *`, statically-crawlable, permanently-archivable file. That publishes
*who is in this family, who talks to whom, how often, at what hours, and when the volume spikes.*
"Grandma's diagnosis" is legible as a burst of 3 a.m. replies without decrypting one byte. A restricted
feed leaks **none** of this to a non-reader. So E-only is not strictly stronger than the gate: it is
much stronger on content and **materially weaker on metadata**, and for a family the metadata graph
is not a lesser concern — it is most of what "private" means colloquially.

**7.3 Therefore: E-complement — but not the version PROPOSALS-6 imagined.** The doc frames
E-complement as "encryption plus a thin audience-control gate," and rightly worries that re-imports
the §8.2 problem. It doesn't have to. **Gate the blobs; encrypt the content; keep every signed
document public and single-valued:**

- **Signed documents** (identity, feed, manifest, histories, rosters) stay **public, CORS-`*`, byte-
  identical for everyone.** No audience-varying serving of any signed artifact ⇒ **§8.2 never arises,
  self-commitments stay deleted, gated manifests stay deleted.**
- **Attachment bytes** are gated or encrypted at rest. Gating *blobs* creates no equivocation surface
  at all, because a blob is not a chained document and its integrity is already pinned by `_sha256`
  inside a signed item. A host that serves the wrong bytes is caught by the hash, not by a chain.
- **Metadata privacy, if wanted, costs zero mechanism:** publish the encrypted feed at an
  **unguessable ≥128-bit capability URL** (restricted-feeds §6.4 — the one authorization tier that
  needs no assertion, no grant, no dynamic host, and no revocation chain). Encryption and capability
  URLs are exact complements: §6.4's fatal flaw today is that a leaked URL means **full content
  disclosure forever**; with encryption, a leaked URL leaks only metadata, and the feed stays
  single-valued so readers who have the URL can still gossip pins normally.

That configuration — **encrypted content + capability-URL hosting + gated/encrypted blobs, everything
else deleted** — keeps every property the owner is actually chasing, deletes more of the extension
than E-only claims to (assertions, replay cache, grants, revocation chain, reader lists, gated
manifest, CORS carve-out, timing equalization, self-commitments), answers both personas, and needs no
new authorization concept. It is not in any of the six passes. It is my recommendation.

---

## 8. Q3 — the consent story does not survive contact with §1.3

"Consent = membership in the wrap-list" is a genuinely attractive reframing of an AI-provider consent
promise into a cryptographic fact. It has a hole: **the wrap-list is not auditable** (§1.3). With
untagged recipients, no family member can verify that the AI *was* a recipient or that it *wasn't*.
So "consent = membership" degrades to "consent = a claim about membership" — a policy promise again,
with more machinery. Tagged recipients would make it auditable at the cost of publishing the audience,
which is the one strict improvement the findings doc claims over every current restricted mode. Pick
one; you cannot market both.

`DISTRIBUTION-MODEL.md:771–860` makes it harder still. The AI *drafts* the entry, so the provider has
the plaintext pre-encryption for your own posts. The cross-user consent problem the doc already names
("family posts enter this user's AI context and are sent to the provider, which those authors never
agreed to") is about **inbound** content — and there encryption *does* help, but only if the reading
member's enc key is client-side, which by default it is not (§1.2). So the AI-consent argument for
encryption reduces to: *it works for members who hold their own keys.* True, worth having, far below
the billing.

The one unambiguous win: `ai_exclude` becomes enforceable rather than advisory for client-keyed
members, since exclusion means "not in the wrap-list" rather than "the hub promises to filter."

**A cheap, auditable middle path worth considering:** commit the *claimed* audience in cleartext —
`"_circle": {"url": ..., "seq": 3, "hash": "..."}` — inside the signed item. The roster's contents
stay encrypted, but its `(seq, hash)` is publicly gossipable (the roster is single-valued ciphertext),
so a reader can verify *which* circle version an item claims and detect staleness. It does not prove
the wrap-list matches, but it converts an invisible property into a checkable claim — and it is also
the fix for Q4.

---

## 9. Q4 — the roster-freshness race, and why it is worse than named

PROPOSALS-6 states it correctly but under-scopes it. Three additions:

1. **Rollback detection is not the relevant defense; withholding is the attack.** A host does not need
   to roll back — it simply **declines to serve the newest roster version** to a chosen replier.
   Pin-and-walk cannot distinguish "no new version" from "new version withheld." This is exactly the
   "commitment lag" evasion already named in restricted-feeds §8.2 / conventions §5.1, reappearing
   inside Option E. The circles prototype tests rollback (`walkToPin`) and not withholding.
2. **The window is unbounded, not "in-flight."** A replier who never refreshes wraps to a stale
   roster indefinitely. There is no protocol pressure to refresh; nothing fails.
3. **It is undetectable after the fact** (§1.3) — nobody can see who a reply was wrapped to.

Evaluating the three candidate mitigations, plus one more:

- **(a) Accept it.** Not equivalent to the §2 re-share concession, which requires an authorized human
  to act. This is automatic, silent, and unbounded. Weakest option.
- **(b) "Fetch the roster before replying; wrap to `seq ≥ last-seen`."** Necessary but insufficient
  alone — it does not defeat withholding, and it introduces a synchronous coordination point (you
  cannot reply offline). Reintroduces no shared secret, though.
- **(c) Owner re-encrypts the live thread.** Rejected: O(threads × members) work, requires the owner
  to hold plaintext of *others'* replies (which they do, as an audience member, but it makes the owner
  a de facto re-encryption service), and it does not stop the already-delivered copy.
- **(d) RECOMMENDED — commit the roster version in the signed item (the `_circle {url, seq, hash}`
  of §8), plus a reader-side freshness rule:** a member who holds roster `seq: N` and sees an item
  claiming `seq < N` **flags it as stale-audience** and warns before rendering/replying. This turns an
  invisible race into a visible, gossipable one, using the pin machinery that already exists, with no
  shared secret and no synchronous requirement (you can reply offline; staleness is detected on the
  *reader* side, where the removed member's presence actually matters). It does not eliminate the
  window — nothing short of PFS-with-rekeying does — but it makes the window **observable**, which is
  the standard this protocol holds everything else to.

**And the honest conclusion for circles: not v2-ready.** The prototype is a good spike, but it does
not model withholding, does not bind ciphertext to carrier (§2), uses freestanding enc keys rather
than identity-doc-published ones (the findings doc flags this as "required integration," and it is the
part where a hub can substitute a key it controls), and does not model N identity-doc fetches and pins
per reply. Circles are a **v3 research item behind a second prototype**, not a promised v2.

---

## 10. Recommendation

1. **Lock the cohesion spine (§1 of PROPOSALS-6), with D1 and D2 landing together** (§5.3 above) and
   P1/A1/A2 still gated — under my recommendation the fetch assertion is *deleted*, not unified, so
   P1/A1 stay moot.
2. **Do not adopt E-only.** The metadata graph and the attachment persona defeat it (§7).
3. **Do not keep the full gate either.** Adopt **§7.3's configuration**: encrypted content +
   capability-URL hosting + gated-or-encrypted blobs; delete assertions, grants, the revocation chain,
   reader lists, the gated manifest, the CORS carve-out, and conventions §5. Every signed document
   stays public and single-valued — which is the property the north-star was actually reaching for.
4. **Ship v1 as broadcast + true DM only.** Circles behind a second prototype (§9).
5. **Do not reverse the scope statement as a headline.** Narrow it: *"the core is not an E2E
   messenger; encrypted content is an OPTIONAL extension, and its guarantee is exactly as strong as
   the recipient's key custody."* That sentence is true in every deployment, including the hub-managed
   default.
6. **Correct two published claims** regardless of the fork: the per-hop "every other family's hub"
   line (§1.2) and the "two small additive edits" count (§3).
7. **Before any spec text**, fix the ciphertext-relay defect (§2) in the prototype and re-run it — the
   fix is ~10 lines and it is a MUST in whatever gets drafted.

**What would change my mind toward E-only:** a credible answer for attachment bytes that does not
require a second mechanism, and a decision that the family interaction graph is acceptable to publish.
Both are the owner's calls, not mine — but they should be made explicitly, not inherited from an
elegance argument that does not survive its own criterion.
