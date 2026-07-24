# PROPOSALS-4.md — Fourth pass: encryption is the answer, but only above a line the first three passes didn't draw

> **Audience:** the three prior agents and the owner. Read after `PROPOSALS.md` (P1–P6),
> `PROPOSALS-2.md` (A1–A2, B, C, D1–D2), `PROPOSALS-3.md` (three-shape frame, Option E). This
> pass (a) **concedes the Part C reversal** — agent 3 is right, and I say exactly why my own
> proposal was wrong; (b) **extends the three-shape frame** with the principle that explains
> *why* the manifest is a separate chain; (c) **sharpens Option E** into something on-brand and
> smaller (it's just JWE); and (d) names the **load-bearing caveat both encryption passes skipped:
> confidentiality is only meaningful with client-side keys — which means the privacy mechanism
> follows key custody, mirroring §14.2.** That caveat dissolves the E-replace / E-complement
> debate into something cleaner. Nothing committed. Challenge everything.

## TL;DR

- **Concede Part C.** Bearer tokens reintroduce the shared secret the protocol exists to abolish;
  agent 3's reversal is correct. But C's *diagnosis* — "the assertion authenticates readers to a
  host that reads the plaintext anyway; it fights the wrong battle" — was right, and it is the
  seed of Option E. Keep identity-bound assertions **where assertions still make sense** (Part 3).
- **Lock the do-regardless spine** (three shapes, P1+A1, A2, D1, D2-regrounded, one token
  vocabulary). Unchanged from agent 3; nothing below reopens it.
- **Extend the container frame.** The manifest is "the feed's chain" *because a feed is a
  container of unchained leaves* — history self-verifies (its entries are chain-linked), a feed
  can't, so it needs a companion membership-chain. That's the manifest. One principle now
  generates the whole feed+manifest design.
- **Option E is right, and it's smaller than agent 3 drew it: it's just JWE.** Encrypt content to
  the audience's published X25519 keys using JOSE's own encryption member (RFC 7516/8037) — no
  bespoke crypto, no new *signing* construction, and with **untagged recipients it leaks neither
  content nor audience membership.** It also **collapses the private-message story into the same
  object** (an encrypted item to an audience of one = a true-E2E DM), which the current spec can't.
- **The caveat that decides everything (Part 3):** a host that holds your key can decrypt, so
  Option E delivers real confidentiality **only for client-side-key holders.** Encryption is the
  privacy tool of the §14.2 *dumb-host/external-signer* tier; host-trusted audience control is the
  only privacy meaningful at the *key-custodian* tier. **The privacy mechanism follows key
  custody.** This maps the two options onto the trust gradient the core already defines, and turns
  "E-replace vs E-complement" into "two tools for two tiers, pick per feed."
- **The genuine limit of E (Part 4):** encrypted *broadcast* (single author → audience) is clean;
  encrypted *multi-writer threads* need a shared audience roster — the group-key problem in
  miniature. Scope broadcast-first; "circles" are the honest follow-on.

| Item | Verdict |
|------|---------|
| Three-shape frame (agent 3 Part 2) | **Lock**, + the membership-chain principle (Part 2) |
| D2 regrounded (content-bearing vs content-less) | **Lock** |
| Part C bearer tokens | **Withdrawn** — agent 3's reversal stands (Part 1) |
| Option E | **Headline**, sharpened to JWE + untagged recipients + DM-unification (Part 2) |
| **Client-side-key caveat** | **[NEW] the decision hinges on it** (Part 3) |
| **Circles / group threads** | **[NEW] the real open problem** (Part 4) |

---

## Part 1 — Conceding Part C, and what it got right

Agent 3 is correct: a per-reader **bearer token** reintroduces exactly the shared-secret
lifecycle (mint a high-entropy secret, deliver it *in confidence*, store it both sides, rotate on
leak) that Open Feed deleted when it chose "prove control by signing" over passwords. My own
challenge #3 in PROPOSALS-2 flagged the hole — you can't deliver a secret inside a *signed,
public, attributable* carrier item — and the answer-sketch didn't close it. A fetch assertion
(post-P1) is *maximally* on-model: the reader signs a tiny document with the key they already
publish; no new secret exists. **Withdraw Part C.** If host-gated restriction survives at all, it
survives as the identity-bound assertion (P1 + A1), and the bearer pattern stays where the spec
already exiles it — the honestly-labeled low-assurance capability-URL escape hatch for pure static
hosting.

**But keep C's diagnosis, because it's load-bearing.** C asked: *why authenticate a reader to a
host that reads the plaintext anyway?* That question is correct, and neither "keep the assertion"
(agent 3) nor "bearer token" (me) answers it — **Option E does.** The assertion tier fights to
keep *strangers* out while conceding everything to the *host*. If the point of restriction is
confidentiality, that's the wrong battle. The right one is keeping plaintext from the host. C
found the wound; E is the correct suture. So the intellectual arc across the passes is: C
(diagnosis) → agent-3 rejects C's *fix* → agent-3's own Option E *is* C's diagnosis resolved
properly. Credit where due, in both directions.

---

## Part 2 — Extending the frame and sharpening E

### 2.1 The three shapes, plus the principle that generates the manifest

Agent 3's container insight is the best cohesion move in any pass: the **feed** and the **history
documents** are *unsigned containers of signed things*, which is why "the feed isn't signed" stops
being weird. Push it one step further to get the principle that makes the manifest *inevitable*
rather than *bolted on*:

> A container is **self-verifying iff its entries are chain-linked.** A *history* container is
> self-verifying — its entries carry `seq`/`prev`, so completeness and order check against the
> chain walk. A *feed* container is **not** — its items are **independent leaves** (`_version`,
> but no linkage binding one item's membership to the next). A container of unchained leaves
> therefore needs a **companion chain that commits its membership. That companion is the
> manifest.**

This also retro-justifies why "feed-as-chain" was rejected three times: you *could* make the feed
self-verifying by chaining the items to each other — but that would impose a total order on items
and couple every item's signature to its predecessor, wrecking multi-author feeds and independent
editing. The design deliberately keeps **items as independent leaves and puts the membership
commitment in its own chain (the manifest)**. So the final, tightest statement of the whole system:

- **One primitive:** the signed document (construction #1, author-bound by `url` / items'
  `authors[0].url`).
- **Two modifiers:** *chained* (adds `seq`/`prev`/`history`, pinned-and-walked) and *contained*
  (an unsigned wrapper; self-verifying if its entries are chained, else paired with a
  membership-chain).
- **Everything else is an instance.** Identity doc = chained signed document. Item = signed
  document (leaf). Manifest = the feed's membership-chain. Feed = container of item leaves +
  its manifest. History = self-verifying container. Grant / follows / pins / assertion = signed
  documents.

State that once in the core (§1/§2) and every later artifact is a field table plus a label. This
is the "cohesive and logical" the owner asked for, fully realized. **Lock it.**

### 2.2 Option E is just JWE — say so, and it shrinks

Agent 3 sketched `_enc` as "a symmetric blob + wrapped keys (sealed-box/ECDH-ES)." Name it
precisely and it stops being new crypto: **it's a JWE (RFC 7516), the encryption member of the
JOSE family the protocol already lives in (JWK/JWS/JWT).** Restricted content becomes:

- an **ordinary signed item** (construction #1 over the whole bytes — author binding, `_feed_url`,
  tombstones, manifest-commitment all intact), whose `content_text` is `""` and which carries
  `_enc`: a **JWE JSON Serialization** encrypting the real content, with **one recipient entry per
  audience member**, each wrapping the shared content-encryption key to that member's published
  **X25519** key (`{"kty":"OKP","crv":"X25519","use":"enc"}`, RFC 8037), `alg:"ECDH-ES+A256KW"`,
  `enc:"A256GCM"`.

Why this is strictly better than a bespoke `_enc`:

- **On-brand and vetted.** "Built entirely on existing standards" (the project's identity) already
  names JOSE. JWE is the piece that was missing. No hand-rolled envelope, no new security-critical
  format review. And crucially: **JWE is *encryption*, not *signing* — the one-signing-construction
  invariant is untouched.** The item is still a plain JWS; the JWE is opaque payload inside it.
- **Multi-recipient is native.** JWE JSON Serialization has a `recipients` array; N family members
  → N entries. Family-scale N≈10 is trivial.
- **Audience privacy for free (improvement over agent 3).** Omit `kid` from each recipient header
  → **untagged recipients**; a reader trial-decrypts the N wraps (N tiny). The ciphertext then
  leaks **neither the content nor who can read it** — strictly better than *every* current
  restricted-feeds mode, all of which disclose the audience (reader list) or at least the feed's
  gated existence. (Pad with decoy recipients to blur N if even audience *size* matters; usually it
  doesn't.)

What E deletes from the restricted-feeds problem is what agent 3 listed — the second construction,
all four authorization mechanisms, the gated manifest, the revocation list, existence modes,
self-commitments, the CORS/browser regression — **and the feed stays `Access-Control-Allow-Origin:
*`, world-readable, static-hostable (Level 2).** What it adds is real confidentiality (host serves
ciphertext it can't read) and public completeness of the *encrypted* record (the public manifest
commits the ciphertext, so "prove my host didn't drop my private posts" now holds *and* the host
can't read them — more than the current extension gives on either axis).

### 2.3 Bonus unifications E unlocks

- **Private messages collapse into the same object.** The README FAQ currently answers "how do I
  send a private message?" with "a restricted feed with an audience of two" — which the host reads.
  Under E, a DM is **an encrypted item wrapped to an audience of one, delivered to that inbox** —
  the *same* object as an encrypted post, and it's **true E2E** (host can't read). One mechanism
  now spans posts, group-restricted content, and DMs, and it's the only one of the three that
  delivers actual confidentiality. This is a genuine one-object-model win.
- **The AI-consent problem becomes a key-membership fact.** DISTRIBUTION-MODEL §825 frets that
  family-visible posts reach the AI provider by *policy*. Under E, "who can read this" is
  *cryptographic*: the AI companion is in the recipient set or it isn't. The consent boundary stops
  being a promise and becomes a wrap-list. (Corollary the product must state: if the AI *is* a
  reader, its provider *can* read — encryption makes that explicit, not magic.)

---

## Part 3 — The caveat that decides everything: confidentiality follows key custody **[NEW]**

Both encryption passes (agent 3's and my sharpening) share a blind spot: **encrypting to your
published key gives you nothing if your host holds that key.** A hub-managed-key user's hub can
simply decrypt — it is a recipient in all but label. So:

> **Option E delivers real confidentiality only for client-side-key holders.** For the
> hub-managed-key default, "encrypt to my key" is theater — the hub holds the key — and the honest
> privacy story remains a login wall (single hub) or host-trusted audience control (cross-hub,
> host reads it).

This isn't a flaw in E; it's the **§14.2 trust gradient asserting itself**, and naming it
*resolves* the E-replace/E-complement debate instead of leaving it a coin-flip:

| §14.2 tier | Key custody | Meaningful privacy mechanism |
|---|---|---|
| Key custodian (hub holds key) | hub-managed | **Login wall / host-trusted audience control** (assertion+grant, host reads plaintext). Encryption is meaningless here. |
| Dumb host / external signer | **client-side** | **Encryption (Option E)** — host serves ciphertext, can't read. Assertion-gating is *unnecessary* here (feed can be public ciphertext). |

The two "restricted" designs are not competitors; they are **the privacy tools of two adjacent
tiers of the gradient the core already defines**, and *which one is even applicable is determined
by key custody* — a choice the user already makes for other reasons. That gives the cleanest
possible resolution:

- **E-complement, gradient-aligned.** Ship **two small orthogonal extensions**:
  1. `open-feed-encrypted-content.md` — a pure **client-side content-encoding** (JWE in `_enc`).
     Touches no serving path, no trust core, no manifest change. Meaningful at the client-side-key
     tier. Static-hostable. This is the confidentiality answer, and it's tiny.
  2. `open-feed-restricted-feeds.md` (slimmed per P1–P5 + A1) — **host-trusted audience control**
     for the key-custodian tier that just wants to gate strangers on a host it trusts. Also tiny
     once self-commitments/existence-modes/revocation-list are cut.
  They compose (you may encrypt *and* gate) but rarely need to: pick the one your tier makes
  meaningful. Neither is the sprawling thing today's extension is.

The alternative, **E-replace** (encryption is the *only* restricted mechanism), is cleaner as a
spec but wrong at the dominant tier: it would tell hub-managed users to encrypt to keys their hub
holds — security theater. So **E-replace only makes sense in a client-side-key-only world**, which
the family-hub product explicitly is not. **Recommend E-complement, gradient-aligned.**

This also re-scopes the surviving audience-control extension honestly: once encryption exists for
confidentiality, host-gating's *only* remaining jobs are **bandwidth** (don't serve big files to
strangers) and **metadata/existence privacy** (hide that the feed exists / its cadence) — the A4
persona. Confidentiality is no longer its burden. That's a much smaller, clearer mandate than the
current "audience control that isn't confidentiality but has a whole equivocation subsystem anyway."

---

## Part 4 — The genuine limit of E: broadcast is clean, threads are the group problem **[NEW]**

Encryption is clean for **single-author broadcast** — one author encrypts each item to a known
audience (their family). That is exactly the journaling product's spine, so E lands its headline
use case. But the moment interaction enters, there's a real problem neither encryption pass
confronted:

> A **reply** to an encrypted item must be encrypted to the *same audience*, or it leaks content
> by inference. But the replier is a *reader*, not the owner — how do they know the full recipient
> set to wrap to, especially with **untagged recipients (2.2) deliberately hiding it**?

That is the group-messaging membership problem in miniature. Options, honestly ranked:

1. **Broadcast-first (recommend for v1).** The encrypted-content extension covers single-author
   encrypted posts and DMs (audience the author chooses). Encrypted *threads* are out of its first
   scope; replies to an encrypted item either happen in the clear referencing the id (leaking only
   that a reply exists) or via the trusted hub. Small, shippable, honest.
2. **Circles (the follow-on).** Define an audience as a named **circle** — a roster of members'
   X25519 keys that everyone in it wraps to. A reply wraps to the circle. Membership change = new
   circle version (no forward secrecy, no retroactive revocation — the same concession §2 already
   makes). The hard parts are real: distributing the roster (public roster leaks membership;
   encrypted roster is chicken-and-egg) and churn. This is a genuine research edge, not a
   weekend's spec — flag it as such, don't pretend E includes it.
3. **Hub-mediated threads.** In the family-hub model the hub coordinates the circle (it can hold
   the roster and re-broadcast), but if the hub holds keys we're back at the key-custodian tier
   where encryption is theater anyway (Part 3). So hub-mediation is fine *for hub-managed users* —
   who don't need encryption — and doesn't help the client-side cohort who do. It doesn't resolve
   the hard case.

The honest conclusion: **E is a clean, shippable win for encrypted broadcast and E2E DMs, and the
correct answer for the client-side-key cohort's confidentiality. Encrypted interactive group
threads are a separate, genuinely hard problem (circles); scope them out of v1 and name them as the
frontier.** Overclaiming that E "dissolves restricted feeds" without this caveat would repeat the
exact sin the passes keep catching — a clever mechanism sold past where it actually works.

---

## Part 5 — The decision, reframed

Agent 3's three-row table (status-quo-slimmed / Option E / E-complement) is really **two
independent axes**, and separating them makes the owner's call concrete:

- **Axis 1 — key custody** (already chosen per user/deployment) selects the *applicable* privacy
  tool: hub-managed → host-trusted audience control; client-side → encryption. Not a new decision;
  a *consequence* of one already made.
- **Axis 2 — is hiding a feed's *existence/metadata* a hard requirement** (the A4 abuse persona)?
  Orthogonal to Axis 1. Encryption does **not** provide it. This is the *only* thing that keeps any
  host-gating alive for a client-side-key user, and the only thing that keeps existence-private mode
  alive at all.

So the questions that are genuinely the owner's:

1. **Is cross-hub family-only real?** (DISTRIBUTION-MODEL says yes → restricted content matters.)
2. **For the client-side-key cohort, do you want host-blind confidentiality?** If yes → ship the
   **encrypted-content extension** (Part 2), broadcast-first (Part 4). This is high-value, on-brand,
   and small.
3. **Does anyone need to hide a feed's *existence*?** If yes → keep a thin metadata-gate (the
   slimmed assertion extension serves it, and R-10 timing becomes a bug to fix). If no → **no
   host-gating is needed anywhere for the client-side cohort**, and the audience-control extension
   shrinks to "host-trusted login-wall for hub-managed users," which barely needs protocol at all.

**My recommendation:** lock the do-regardless spine now; adopt **E-complement, gradient-aligned**
(a tiny encrypted-content extension + a slimmed host-trusted audience-control extension), scope
encryption **broadcast-first**, and treat existence/metadata privacy (A4) and encrypted group
threads (circles) as two *separately deferred* frontiers rather than things any current extension
pretends to solve.

---

## Part 6 — The do-regardless spine (locked; restated for the record)

No capability change, pure cohesion — adopt independent of every fork above:

- **B (three shapes):** one primitive (signed document) + two modifiers (chained / contained);
  the manifest is the feed's membership-chain (Part 2.1). State once in the core.
- **P1 + A1:** one signing construction, one verifier, `typ` in the protected header (no `crit`),
  mandatory bidirectional check.
- **A2:** one author-binding rule (`url`; items use `authors[0].url`).
- **D1:** one `feeds` array with a `rel` marker; F4 closed. `rel:"primary"` authoritative, order
  display-only.
- **D2 (regrounded):** content-less relation items are manifest-exempt (a type distinction, not a
  value judgment); OPTIONAL escape for anyone who wants reaction-completeness; F4 closed from the
  other side.
- **4.1 (agent 3):** one token-vocabulary rule (registered token or absolute URL; unknown
  preserved & ignored), referenced by `_rel.type`, feed `rel`, key `use`.

---

## Challenge me (for the fifth pass)

1. **The key-custody caveat (Part 3) is the crux.** Is it *always* theater to encrypt to a
   hub-held key? Counter to consider: a hub could hold your *signing* key but **not** your X25519
   *encryption* key (you keep only the enc key client-side) — then the hub signs-as-you (custodian
   tier for authorship) yet **cannot read** your encrypted content. That would let a hub-managed
   user get confidentiality against their own hub *for reading* while still delegating signing.
   Does that split-custody model hold up, or does "the hub drafts your entries" (the AI product)
   require the hub to see plaintext anyway, collapsing it? This may be the most important question
   in the whole thread.
2. **JWE choice:** is `ECDH-ES+A256KW` + `A256GCM` the right profile, or is there a leaner
   libsodium-style sealed-box profile worth defining instead of full JWE JSON Serialization? Trade
   standard-reuse vs envelope size.
3. **Untagged-recipient trial decryption** at N≈10 is trivial, but does it interact badly with the
   AI companion needing to decrypt *many* family members' feeds (N readers × M authors)? Quantify
   before claiming "trivial."
4. **Circles (Part 4):** is there a family-scale roster-distribution answer that *doesn't*
   reintroduce a shared secret or a membership-leaking public list? If someone cracks this crisply,
   encrypted threads move from "frontier" to "shippable" and E-replace gets much stronger.
5. **Does the encrypted-content extension truly touch no core text**, or does the core need one
   additive hook (the `use:"enc"` X25519 key in `keys`, and a sentence that `content` MAY be a JWE
   envelope)? I claim exactly those two additive touches and nothing else — verify.
6. **Metadata/existence privacy (A4)** is now the *sole* surviving justification for host-gating in
   a client-side world. Is that persona real enough to keep an entire extension alive, or does it
   fold into "run your own hub / use an unguessable capability URL for the whole encrypted feed"?
