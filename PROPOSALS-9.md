# PROPOSALS-9.md — Ninth pass: publish vs. deliver — the map that makes privacy free, and the two documents that shouldn't exist

> **From the author of `PROPOSALS-7.md`, replying to `PROPOSALS-8.md`.** Chain: `PROPOSALS.md` →
> `-2` → `-3` → `-4` → `-5` → `-6` (prototypes) → `-7` (killed E-only) → `-8` (**the layer split**) →
> this.
>
> **8 is right, and it stopped one step short.** The layer split is the correct consolidation. But 8
> still treats privacy as a *thing the protocol provides at some layer*. It isn't. Privacy is a
> **publication decision** the protocol already models — and once you draw the map (§2), the core's
> contribution to privacy is not "one optional key type." It is **zero**: three edits that are
> corrections the spec needs anyway, one of which fixes a claim in §6.6 that is **currently false**.
>
> Then, because the surface just changed, I took 8's Q5 seriously ("did the layer split miss a Layer-1
> simplification? I claim no"). **It missed a big one.** Two of the protocol's five documents exist
> only to solve a problem a single field solves better (§7.1). Open Feed goes from five document types
> to three.

## TL;DR

| | Verdict |
|---|---|
| 8's layer split (trust layer authenticates envelopes; content is an opaque hole) | **Accepted — headline is right** |
| 8's critique of my §7.3 capability-URL as a bearer credential | **Conceded.** Withdrawn; §4 replaces it with something already in the spec |
| 8's "delete restricted-feeds + conventions §5" | **Accepted**, with the test that proves it's safe (§8.6) |
| 8's split custody (hub signs, client holds enc key) | **Accepted — best idea in 8** — but it is *unsafe without* the companion rule in §6.1 |
| 8's "the core's privacy contribution is one enc-key hook" | **Improved: it's zero** (§3) |
| **[NEW] The publish/deliver × cleartext/encrypted map** | The consolidation (§2) |
| **[NEW] Private = *delivered*, not gated** — already in the spec, costs nothing | (§4) |
| **[NEW] Encrypted blobs need no gate and no streaming AEAD** (answers 8's Q4) | (§5) |
| **[NEW] Self-monitoring (§5.6)** — makes split custody safe; fork-independent | (§6.1) |
| **[NEW] Delete `history.json` + `manifest-history.json`**; 5 documents → 3 | (§7.1) |
| **[NEW] Chain↔container duality** — derives the document set; makes D2 principled | (§7.2) |
| **[NEW] `GET {inbox}` *is* the replies endpoint** — the abstract's "one endpoint" becomes true | (§7.4) |

---

## 1. What I concede to 8

**The capability URL was a bearer credential and I shouldn't have crowned it.** 8 §2 is correct: you
cannot kill Part C for reintroducing a shared secret and then hand back a ≥128-bit secret in a URL
path (where it lands in logs, referrers, and history sync), especially when it is load-bearing for
exactly the persona it was summoned to serve. My §7.3 config was three mechanisms wearing one coat.
Withdrawn. §4 below is what I should have written: the protocol already has a private channel, it is
not a bearer secret, and it costs nothing.

**The layer split is the right frame** and it is stronger than 8 claims, because it is not really
about layers — it's about a distinction the spec already draws (§2).

**Split custody is the best new idea in eight passes.** It directly answers my §1.2 (hub-held keys
erase the guarantee): hub-custodial *signing* + client-only *encryption* keeps onboarding invisible,
keeps identity recoverable, and makes the failure mode "lost readability" instead of "lost identity."
It also converts `DISTRIBUTION-MODEL.md`'s cross-user AI-consent problem from a policy promise into a
cryptographic fact: **your hub cannot feed another member's private content to your AI, because it
cannot read it.** That is a real, marketable, *true* guarantee. It needs one companion rule to be safe
(§6.1).

---

## 2. The map: **publish vs. deliver** — and where restricted feeds actually went wrong

The core already contains the distinction the last nine passes have been groping for, and it isn't a
layer. §1 principle 3 states it ("the feed is the source of truth; the inbox is a push cache") and
§8 already permits its consequence: *"[interaction items] MAY be inbox-only, in which case
`_feed_url` is omitted."* Cross it with content encoding and everything lands:

|  | **Cleartext content** | **Encrypted content (`_enc`)** |
|---|---|---|
| **Published** (in a feed, committed by a manifest, `_feed_url` present) | The public web. Full transparency: pin, walk, gossip, completeness proof. **Today.** | Host-blind archive on a dumb CDN. Content opaque; **metadata public** (id, time, `authors`, `_rel`). The E-only mistake — useful, but narrow. |
| **Delivered** (POSTed to an inbox, no `_feed_url`) | Private from everyone but the two hosts. **No new mechanism — this works today.** | Host-blind DM/group. The only cell that needs Layer 2. |

Restricted feeds tried to occupy a **fifth cell that isn't on the grid: *published but not public*.**
That is why it needed a `401` dance, an assertion, grants, a revocation chain, a gated manifest, a
CORS carve-out, timing equalization, and then §8.2 — a documented hole — and then conventions §5
self-commitments to patch the hole, and then §5.1 to patch the patch ("commitment lag"). **Every one
of those artifacts is a consequence of putting private content on the published axis.** Move it to
the delivered axis and all of them evaporate at once, which is a much better explanation for why
deleting the extension feels right than "it's the wrong layer."

**And it yields an impossibility statement worth putting in the spec:** a completeness proof is a
*public* artifact — its whole power is that strangers can compare it (§9.1, §14.2). Content whose
existence is private cannot have one. §8.2 was not a defect in the extension; it was the extension
discovering a theorem. State it once, in the core, and stop patching:

> **Transparency and confidentiality trade off along the publication axis.** Published content gets
> the completeness proof and the cross-observer equivocation check. Delivered content gets
> confidentiality and forgoes both. There is no third option, and any mechanism that appears to offer
> one is hiding the trade.

**The three privacy needs, three answers, zero new mechanisms:**

1. **Hide it from the public** → don't publish it. Deliver it. *(Layer 1, today.)*
2. **Hide it from your host** → encrypt it. *(Layer 2, deferred.)*
3. **Hide it from an authorized reader** → impossible. *(Stated, never solved — restricted-feeds §2
   already concedes this.)*

This is also the sharpest answer to 8's Q2 that I can give without knowing the cohort's threat model,
so make it parametric — it's more useful than a guess: **if the adversary is an outsider (an ex, a
stalker, a search engine, an employer), need #1 applies and they ship in v1 with no cryptography at
all.** Encryption is only load-bearing when the *host itself* is the adversary. That single sentence
de-urgentizes Layer 2 without abandoning anyone, and it should be the first line of whatever privacy
section gets written.

---

## 3. The core's contribution to privacy is **zero** (improving 8's "one hook")

8 says the core needs one `use:"enc"` key hook plus an `_enc` sentence plus a tombstone clause. Check
each against the actual spec text — none of them needs to mention encryption, and two of them are
corrections the spec needs whether or not encryption ever ships.

**3.1 The enc key needs no hook — it needs an existing contradiction resolved.** §4.1 currently says
`crv` **MUST** be `Ed25519` and, four lines later, *"Implementations MUST ignore keys with
unrecognized `kty`/`crv` (future algorithms slot in additively)."* Those two sentences contradict each
other today: a document containing a future-algorithm key is simultaneously non-conformant and
required to be tolerated. The fix is one word-level edit — *"`crv`: the key's curve. **Signing keys**
MUST use `Ed25519`"* — after which any key type, including X25519, is defined **entirely in the
extension that uses it.** The core never says "encryption."

Confirming 8's Q3 ("can the core carry a key it never uses?"): **yes, and the guard already exists.**
§6.2 requires verifiers to reject a signature "where the referenced key's `crv` is not `Ed25519` (the
`alg` alone does not fix the curve)" — so an X25519 key can never be pressed into service as a signing
key. Algorithm-confusion is closed by text already written. The only genuine ambiguity is
`revoked_at`, which is defined in the same table and would otherwise inherit signature semantics; the
extension (not the core) states: *for a non-signing key, `revoked_at` means senders MUST NOT wrap new
content to it; it has no verification effect and does not invalidate existing ciphertext.*

**3.2 `_enc` needs no blessing — it is already legal.** §7.2 requires "at least one of
`content_text`/`content_html`" and explicitly blesses `content_text: ""` as the marker for "no
displayable content" (already used by relation items and tombstones), and §7.2 requires consumers to
preserve unknown `_` fields. An item with `content_text:""` and an `_enc` field is a conformant item
**today**. The extension defines the field; the core says nothing.

**3.3 The tombstone clause should not mention `_enc` — it should be generalized.** §7.3 says content
fields are "removed (`content_text` set to `""`)". It doesn't say whether `attachments` go — a live
ambiguity: today a conformant tombstone can retain a 10 MB photo and its URL. The right rule is
type-independent: *"every content-bearing field — `content_text`, `content_html`, `attachments`, and
any extension content field — MUST be removed."* That fixes an existing gap and makes encrypted
tombstones correct as a side effect.

**3.4 The relay defect is a *general* binding gap, and §6.6 currently overclaims.** This is the one I
most want the owner to see. §6.6 asserts: *"This prevents republishing someone's signed content under
a different name: the binding travels with the bytes."* **That is false for any content the envelope
carries by reference or as an opaque blob.** Eve copies Mom's `attachments: [{url, mime_type,
_sha256}]` into her own signed item with a fresh `id` — signature valid, author binding valid,
`_feed_url` valid, §7.5 not triggered (fresh id) — and Mom's photo is now published as Eve's. The
ciphertext-relay attack I found in §2 of PROPOSALS-7 is **the same bug**, with encryption merely
making it worse (the relayer needn't be able to read what they misattribute).

So the fix belongs in the core, once, in the vocabulary the core already has. §7.5 gives us
*an item is canonical only in the feed its signed `_feed_url` names.* The missing dual is:

> **Binding symmetry.** Content the item carries **by value** (inside the signed bytes) is bound to
> it by the signature. Content carried **by reference** (`attachments`) or **as an opaque payload**
> (any extension content field) is bound only if it **names its carrier** — i.e. the content
> self-attributes to `(author, id)`. Unbound carried content is a **copy** in the sense of §7.5:
> render it as "via …", attribute it to no one on the strength of this item, and never treat it as
> original.

One rule, existing vocabulary, covers attachments and encryption and every future content type.
Layer 2 then satisfies it trivially and cheaply — the JWE plaintext is a content object that
*includes* `id`, `authors`, `_feed_url`, and the decrypting client rejects any mismatch — which is
exactly the fix 8 accepted, now derived from a core principle instead of bolted on.

**Net: three core edits, all fork-independent, none mentioning encryption.** One resolves a
self-contradiction, one closes a tombstone gap, one repairs a false claim. That is a strictly better
result than "one hook," and it means the core can be finalized **before** anyone decides about Layer 2.

---

## 4. Private = **delivered**. What that actually takes (I worked it, not just sloganeered)

Replacing my withdrawn capability-URL. Private content is an ordinary signed item with **no
`_feed_url`**, POSTed to each recipient's inbox. Nothing is published; there is no feed to crawl, no
manifest, no roster, no gate, no bearer secret, no CORS carve-out. **Three things have to be true, and
two of them already are.**

**4.1 A real gap: the `to` reference model breaks for delivered items — and the fix is one line.**
§8 says a relation's `to` is `{feed_url}#{item_id}` or a permalink. A delivered item has **no**
`feed_url`, so *nothing in the spec can address a reply to a private item.* Nine passes debated
rosters and nobody hit this, because everyone kept private content on a feed. Fix, consistent with
everything around it: **`to` MAY be `{identity_url}#{item_id}`**. Verifiers already split at the last
`#` (§4.2); ids already never contain `#` (§7.2); and §10.2's relevance check already accepts "their
identity URL" as a valid reference to the inbox owner, so **routing works unchanged**. Generalized
statement: *`to` is `{feed-or-identity URL}#{id}` — the feed URL when the target is published, the
author's identity URL when it is delivered.*

**4.2 Threading works as-is.** `_rel` `reply` + `root` (§8.1) are unchanged; senders already SHOULD
deliver a nested reply to both the parent's and the root's inbox. Dedup (§10.3, `(author, id) →
version`), edits, and tombstones (§8.2) all work on delivered items today — the inbox path never
required `_feed_url`.

**4.3 What is genuinely lost, stated honestly.** Principle 3 says *"nothing exists only in transit."*
**For delivered-only content that is false, and the spec must say so.** Consequences: no completeness
proof (the theorem in §2), no backfill for a member added later (which is *correct* for privacy — it
is the "no history access" property the circles prototype demonstrated, obtained here for free), and
delivery failure is content loss unless the sender retries or re-delivers. §10.4 already mandates 24 h
retry; the sender's own hub retains the item, so re-delivery is a product feature, not a protocol one.
Fan-out is sender-side: N POSTs per item instead of one file. At family N≈10 that's nothing; it is
another reason encryption-to-large-audiences was never the scaling story (PROPOSALS-7 §1.1).

**4.4 One clean conformance consequence.** Receiving private content requires an inbox — **Level 3 on
the receiving side.** A Level 2 static publisher can *send* private content and cannot *receive* it.
That's consistent with the existing table (L2 can send interactions, not receive them) and it makes
the privacy story a property of conformance level rather than of a new extension.

**4.5 The optional Layer-2 upgrade, named and deferred.** If a delivered audience later wants
omission-detection, the answer is *not* a manifest: it is a **chain per audience** — each delivered
item carries a hash link to the previous item sent to that same audience. Identical bytes for every
member (so it doesn't fork the `(author, id, _version)` = exact-bytes rule), it reconstructs the
membership-chain principle from pass 2 inside the private channel, and cross-member comparison is the
out-of-band compare of §14.2 done properly. **Note what this proves about the layering:** conventions
§5 self-commitments can be re-derived, from first principles, exactly where they belong — in Layer 2,
opt-in, for people who have decided their existence is disclosable. That is the strongest argument for
deleting them from the core conventions now.

---

## 5. 8's Q4 answered: encrypted blobs need **no gate and no streaming AEAD**

8 relocated the photo problem to Layer 2 and conceded it "kills CDN thumbnails just as much." It
doesn't have to, and the answer needs **no protocol change at all**:

- Encrypt the blob with a per-blob symmetric key. Publish the **ciphertext** at an ordinary public
  URL. It is opaque bytes; CDNs cache it, `Access-Control-Allow-Origin: *` stays, static hosting
  stays.
- The attachment entry (§7.4) is unchanged: `url` + `_sha256`, where **`_sha256` is the hash of the
  ciphertext** — so integrity is verifiable *by anyone, without keys*, from a signed item, and a host
  that swaps bytes is caught. (AEAD gives plaintext integrity on top.)
- The **per-blob key travels inside the item's already-encrypted content** — the audience that can
  read the caption can decrypt the photo. No key-distribution mechanism, no per-blob authorization,
  no reader list, nothing new.
- **No streaming AEAD.** A 10 MB photo (`DISTRIBUTION-MODEL.md:1157`) is a single-shot AES-GCM decrypt
  in WebCrypto (tens of ms) into a blob URL for `<img src>`. Streaming matters for video, which the
  product doesn't ship in v1.
- **Thumbnails move client-side at upload** — each thumbnail is just another encrypted attachment.
  That's the one real cost, it is the standard pattern in every E2E product, and it buys the deletion
  of an entire authorization mechanism.

This also retires my own blob-gate from PROPOSALS-7 §7.3. **There is now no gate anywhere in the
protocol, for anything.**

---

## 6. Split custody: the missing rule that makes it safe, and one alternative worth rejecting in writing

**6.1 [NEW, fork-independent] Self-monitoring — the rule the whole trust model has been missing.**
Split custody has a hole 8 didn't name: if the hub holds your signing key, **the hub can publish a
chain version that adds an encryption key it controls**, and thereafter every sender wraps to the hub.
The chain records it — perfectly, transparently — and *nobody is looking*. This is not an encryption
problem: the same hub can add a **signing** key today, and §14.2's "transparency with teeth" quietly
assumes an auditor who is never specified.

> **§5.6 Self-monitoring (proposed).** An identity's own client SHOULD pin its **own** identity chain
> and manifest chain and verify, on each fetch, that every version is one it produced. A version it
> did not produce — or any key it did not add — MUST be surfaced as a compromise signal. The recovery
> key (§4.5) is the response: co-sign the next version (§5.5) so the honest branch is
> distinguishable.

Cheap (one pin, one comparison), fork-independent, and it converts §14.2's central claim from a
property of the *data* into a property of *practice*. It is also what makes split custody deliverable:
the client that holds the enc key is exactly the client that can audit the hub that holds the signing
key. **I'd land this regardless of how the privacy fork resolves.**

**6.2 The alternative I want on the record as rejected: derive X25519 from Ed25519.** There is a
standard birational map from an Ed25519 key to an X25519 key (libsodium's
`crypto_sign_ed25519_pk_to_curve25519`; `age` uses exactly this to encrypt to `ssh-ed25519`
recipients). Adopt it and the core's privacy surface isn't zero-by-generalization — it's zero because
**every identity that publishes a signing key already has an encryption key.** No key type, no
lifecycle, no `revoked_at` question, no `keys`-array growth, no discovery. It is genuinely the most
elegant thing available, so it deserves an explicit rejection rather than silence:

- **It is incompatible with split custody (§6.1/8 §5), and split custody is worth more.** If
  `enc = f(sign)` and the hub holds the signing key, the hub holds the decryption key by
  construction. The single best product idea in the thread dies to save one table row.
- **It couples two lifecycles that must move in opposite directions.** Signing keys rotate forward and
  may be dropped after 30 days (§4.3); encryption keys must be retained forever (PROPOSALS-7 §1.4).
  Derivation makes signing-key rotation silently destroy readability, or freeze signing keys forever.
- **It merges two blast radii.** One compromise then costs both future impersonation *and* past
  confidentiality.

Verdict: **rejected — and it belongs in Appendix E**, because "we considered deriving the enc key and
here is exactly why not" is the kind of recorded reasoning that stops the question being re-asked
every year.

---

## 7. 8's Q5, answered: **yes, the layer split missed Layer-1 simplifications — including a large one**

8 asked whether removing privacy from the core lets anything else consolidate, and claimed no. Five
things do. The first is the biggest simplification available anywhere in the spec.

### 7.1 Delete both history documents. Five document types → three.

The protocol currently defines `history.json` and `manifest-history.json` (§5.4, §9.2): containers
holding **every prior version**, plus a resource cap on how much of one you may fetch (§14.4), plus
§9.3's checkpoint-and-prune machinery largely existing to bound the manifest one. A consumer walking
`prev` from its pin — **typically one or two versions** — must fetch a document containing *the entire
history of the identity or feed* to obtain them.

Replace the container with a link. A chained document carries its predecessor's **hash** (`prev`, the
security-critical identifier, unchanged) **and its URL**:

```json
{ "seq": 412, "prev": "Jq3l73-…", "prev_url": "https://pence.family/~mom/manifest/411.json", … }
```

Walking becomes a linked-list traversal: fetch `prev_url`, hash it, compare to `prev`, repeat to the
pin. What this deletes:

- **Two document types**, their `history` fields, §5.4, §9.2, and the "history size fetched" cap.
- **The pathological fetch.** Cost becomes O(gap-since-your-pin), normally 1–2 fetches, instead of
  O(entire history). This is *strictly better* in the common case, and the worst case (a consumer
  returning after hundreds of versions) is precisely what checkpointing already exists for.
- **The pruning story simplifies** to "versions at or below a checkpoint MAY 404," and §5.3's "cannot
  connect its pin ⇒ treat as unverifiable, don't silently re-pin" carries over verbatim.

What it costs: an archival consumer that genuinely wants everything at once now makes N requests —
served by the signed **export bundle** already deferred in Appendix H, which is the right home for it.
Two guards to write down: `prev_url` **MUST be same-origin** with the document (it is inside signed
bytes, but a walker follows it, so the §3.3/§14.5 discipline must be explicit), and producers MUST
serve prior versions **byte-identically** — which §5.1 already recommends as "the simplest correct
implementation," and which is *more* natural as static files at their own URLs than as entries
re-serialized into a container.

This one change makes the abstract's promise — "a few conventional documents and one endpoint" —
literally true: `openfeed.json`, `feed.json`, `manifest.json`, `inbox`. (Vectors D.4/D.5 and the R./C.
sets need regeneration; `tmp/regen.js` covers it.)

### 7.2 The chain↔container duality — the document set stops being a design choice

Pass 2's membership-chain principle, completed: *a container self-verifies iff its entries are
chain-linked.* Apply it and the whole document set is **derived, not chosen**:

- A **chain** (identity document, manifest) self-verifies — its entries link. It needs no companion.
  **(Which is precisely why §7.1's history containers were never necessary: they were containers of
  things that already linked. A container with no job.)**
- A **container** (the feed) does not self-verify — items are independent leaves (§7.2) — so it needs
  a companion chain. **That companion is the manifest.**

Three documents, one principle, no leftovers. And it makes **D2 principled instead of pragmatic**: a
manifest-exempt activity feed is *a container without a chain*, which in this vocabulary means exactly
"no completeness guarantee" — the trade stated in the model's own terms rather than as an exception.
The same sentence covers the delivered channel (a stream with no container and no chain ⇒ no
completeness, §2's theorem) and the optional per-audience chain of §4.5 (add the chain, get the
proof). **One principle now explains every document in the protocol and every privacy trade in it.**
That is the cohesion the owner has been asking nine passes for; it should open §1 or §2 of the spec.

### 7.3 State the chain mechanics once

§9.1 already admits it — *"Producing and verifying a manifest version follow §5.2 and §5.3 exactly"* —
and then restates them, and §9.5 restates them again. With §7.1 removing the history documents, define
**one chained-document mechanism** in §5 (`seq`/`prev`/`prev_url`/`updated`/`_sig`, produce, pin,
walk, equivocation) and let §9 be: *"the manifest is a chained document per §5; its payload is
`items`/`deleted`; its invariants are §9.4."* §9.1/§9.2/§9.5 collapse to a few lines. Layer 2's roster,
if it ever ships, inherits the mechanism by reference instead of re-specifying it — which is the test
that the abstraction is real.

### 7.4 `GET {inbox}` **is** the replies endpoint — one endpoint, and the abstract becomes true

The abstract says "a few conventional documents and one endpoint," then §12 adds a second. But look at
what `replies` returns: *a JSON Feed of the items this identity received that reference a given id* —
i.e. **a read view of the inbox**. Same data, same store, same verbatim-bytes rule. Collapse it:
`POST {inbox}` delivers; `GET {inbox}?item={id}` returns the public subset referencing that id, as a
JSON Feed, exactly as §12 specifies today. This deletes an identity-document field, deletes a
conformance row, and stops implementers from building a second store. (Caveat to write down: §10.1
reserves authenticated `GET {inbox}` for reading one's own inbox; the `?item=` form is the public
projection and MUST expose only items the owner would publish. If that overloading bothers the owner,
keep the separate URL but re-describe §12 as *a view over the inbox* rather than an independent
concept — most of the win is in the framing.)

### 7.5 Merge `follows` and `pins` into one document

With self-commitments deleted (8 §4), `pins` shrinks back to "observations of others" — and a pin and
a follow are the same statement about the same subject at different resolutions: *"I read
`https://gran.example/`"* and *"I saw it at `(seq 12, hash …)`."* One document — entries
`{url, rel, seq?, hash?, observed_at}`, reusing the one-token-vocabulary rule for `rel` — halves the
conventions doc, removes an identity-document field, and makes anti-equivocation gossip a **byproduct
of publishing your reading list** rather than a separate discipline nobody will adopt. Same privacy
caveat as today, now stated once instead of twice.

### 7.6 Say `content_text: ""` once

It appears three times as a special case (relation items §7.2/§8, tombstones §7.3, and — under Layer 2
— opaque content). One clause: *"JSON Feed requires a content field; `content_text: \"\"` is the
canonical 'no displayable content' marker,"* referenced from each. Small, but it is the difference
between three exceptions and one rule.

**Net effect of §7 on the identity document:** `feed` + `manifest` + `feeds` + `history` + `replies` +
`follows` + `pins` (+ the deleted `readers`/`grant_revocations`) become **`feeds[]` + `inbox` +
`observations`**. Three endpoint-ish fields, down from eight.

---

## 8. 8's open questions, answered

1. **Is a private delivery channel rich enough for threaded family conversation?** **Yes**, with the
   one-line `to` fix (§4.1) — threading, edits, tombstones, dedup, and relevance routing all work
   unchanged. What it costs is the completeness proof, and that cost is a theorem (§2), not a defect
   of the channel.
2. **Is single-hub an acceptable v1 boundary for the cohort?** **The question resolves on the
   adversary, not the topology** (§2). Outsider adversary ⇒ they ship in v1, cross-hub, with no
   cryptography — delivered content is never published. Host adversary ⇒ Layer 2 is genuinely
   v1-critical and "defer" is a broken promise. This is the one call the owner must make, and it is
   now a single, crisp question.
3. **Can the core carry an enc key it never uses?** Yes — and it shouldn't even name it (§3.1). The
   algorithm-confusion guard already exists in §6.2; the only ambiguity is `revoked_at`, which the
   extension resolves.
4. **Blobs.** Solved without a gate and without streaming AEAD (§5). The residual cost is client-side
   thumbnails.
5. **Did the layer split miss a Layer-1 simplification?** Yes — five (§7), one of which deletes two of
   the five document types.
6. **Is deleting restricted-feeds too aggressive?** No, and here is the test that settles it: **it can
   be re-added later as a pure extension with zero core changes** — a `401` challenge is host
   behavior, the assertion is extension-local, and a reader list is an extension field. A layering is
   only real if the thing you removed can come back without touching what remains. This one can. Keep
   §11 as a four-line pointer, add an Appendix E row, and let git hold the rest. (I also have no
   persona for the host-trusted unencrypted cross-hub audience; the nearest candidate — a
   several-hundred-member club or school newsletter — is served by single-hub authorization, which is
   software, not protocol.)

---

## 9. Attacking my own proposals

- **`prev_url` trades one fetch for K fetches**, and a consumer whose pin is far behind pays K round
  trips serially. Mitigations exist (checkpoints; parallel fetch once you know the URL pattern), but a
  publisher with a fast-advancing manifest and a slow-polling reader is a real case worth measuring
  before committing. Also, deleting the history document removes the one artifact an archival gossip
  aggregator could fetch atomically — I've pushed that onto the export bundle, which does not yet
  exist.
- **The 2×2 is clean but the delivered column has a real operational hole:** no completeness proof
  means a *sender's* host can silently drop deliveries and nobody can tell. §4.5's per-audience chain
  fixes it and is deferred, so v1 private content is trust-the-sender's-host. That is strictly better
  than restricted feeds (which had the same hole plus §8.2) but it is not nothing, and the spec should
  say it in the same breath as the theorem.
- **"Private = delivered" moves work into product reliability.** Retry, retention, re-delivery on
  request, and multi-device fan-in are now the app's problem, and the protocol offers no help beyond
  §10.4's 24-hour retry. A hub that loses an inbox delivery loses content permanently — a failure mode
  the published path doesn't have.
- **Self-monitoring (§6.1) is a SHOULD that nobody will implement** unless the reference client does.
  If it stays unimplemented, split custody's hole (§6.1) is open in practice while looking closed in
  the spec — the same "transparency nobody audits" critique I aimed at §14.2, now aimed at my own fix.
- **Merging `follows`+`pins` conflates two disclosure decisions.** Some people would publish
  observations (useful, low-stakes) but not their reading list (social graph). One document with
  optional fields permits the split, but the merge nudges toward over-disclosure; the caveat has to be
  loud.

---

## 10. Recommendation

1. **Lock the spine** as 8 restated it (three-shape/content-agnostic framing, A2, D1+D2 feed-level
   with `manifest` OPTIONAL, one token-vocabulary rule; P1/A1 retired as moot), **plus** the
   chain↔container duality (§7.2) as the opening frame.
2. **Adopt the publish/deliver map (§2)** as the spec's privacy section: the 2×2, the three needs,
   and the transparency/confidentiality theorem. It replaces §11 entirely.
3. **Delete `open-feed-restricted-feeds.md` and conventions §5** (per 8), with the re-addability test
   (§8.6) recorded in Appendix E.
4. **Make private-by-delivery real in the core:** the `to` addressing generalization (§4.1), the
   Principle-3 qualifier and completeness theorem (§4.3), and the L3-to-receive conformance line
   (§4.4). This is the entire privacy feature, and it is three paragraphs.
5. **Land the three fork-independent core corrections** (§3): the `crv` contradiction, the generalized
   tombstone rule, and **binding symmetry** — which repairs a claim §6.6 makes today and is false.
6. **Land self-monitoring, §5.6** (§6.1). Fork-independent; it is what makes split custody safe and
   §14.2 honest.
7. **Take the §7 consolidations**, in order of value: delete the two history documents (§7.1); state
   chain mechanics once (§7.3); merge `follows`+`pins` (§7.5); reframe `replies` as an inbox view
   (§7.4); one `content_text:""` clause (§7.6). Regenerate all vectors.
8. **Defer `open-feed-encrypted-content.md`** with its scope now genuinely small: the JWE profile, the
   self-attributing plaintext (satisfying binding symmetry), the enc-key lifecycle and `revoked_at`
   semantics, the recipient-count cap, blob encryption per §5, and — later — rosters and the
   per-audience chain. Fix the relay defect in `tmp/enc-prototype.js` now as a down payment, and
   correct the per-hop and touch-count claims in `ENCRYPTED-CONTENT-FINDINGS.md`.

**Where this lands the protocol:** three document types and one endpoint; one signing construction;
one chained-document mechanism; one container rule that derives the document set; one binding rule
that covers every content type; and a privacy story that is a *publication decision* rather than a
mechanism. The core stops having a privacy feature — and, for the first time, actually delivers
privacy to the person who needs it most, on the day it ships, with no cryptography they have to
understand.
