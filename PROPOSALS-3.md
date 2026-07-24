# PROPOSALS-3.md — Third pass: adjudication + the radical alternative

> **Audience:** the two prior agents and the owner. Read after `PROPOSALS.md` (P1–P6) and
> `PROPOSALS-2.md` (A1–A2, B, C, D1–D2). This pass (a) adjudicates PROPOSALS-2's cruxes and
> answers its Part G, (b) **expands its best idea** (the two-primitive frame → a *three*-shape
> frame that finally explains why the feed is unsigned), (c) registers **one reversal** (I think
> Part C is wrong, and I say why), and (d) introduces the item neither pass reached: **Option E —
> replace audience-control with content encryption that reuses the keys identities already
> publish.** Nothing here is committed. Same rules: challenge everything; a good rebuttal wins.

## TL;DR

- **Endorse and lock:** A1 (header `typ`, no `crit`), A2 (author-bind by `url`), B (name the
  primitives), D1 (one `feeds` array), plus all of `PROPOSALS.md`'s P1/P2/P3/P5. These are the
  "do regardless" spine.
- **Expand B → three shapes.** The system isn't two things, it's **signed document → chain →
  container**, and naming the third (*container*) is what turns "why is the feed unsigned?" and
  "why does the feed need a manifest but history doesn't?" into one answer. This is the deepest
  cohesion win available and it costs nothing.
- **Endorse D2, reground it.** Manifest-exempt activity feeds are right, but the principled line
  is *content-bearing vs. content-less relations*, not *primary vs. auxiliary*.
- **Reverse Part C.** Bearer tokens are simpler *for restricted feeds in isolation* but **reintroduce
  the shared secret the entire protocol was built to abolish** — they are the *least* cohesive
  option with the core, and the agent's own P5 logic ("don't add a mechanism that fights the
  spec's philosophy") condemns them. Keep identity-bound assertions (P1+A1).
- **The radical alternative (Option E).** The cross-hub case is the *only* one that justifies
  restricted feeds at all — and it is exactly the case where "host reads the plaintext" is worst.
  So stop asking the host not to peek and **encrypt the content to the audience's published
  keys.** This deletes the assertion, the grants, the gated manifest, the revocation list, the
  existence modes, *and* self-commitments; keeps feeds world-readable and static-hostable; keeps
  one signing construction; and delivers **real confidentiality** — a thing the current extension
  explicitly cannot. It **dissolves** restricted feeds rather than shrinking them.

| Item | Verdict | Why it matters |
|------|---------|----------------|
| A1 header `typ` | **Lock in** | closes P1's one hole cryptographically, still one construction |
| B → **container** | **Expand & lock** | explains the unsigned feed/history; the true cohesion frame |
| A2 `url` binding | **Lock in** | one author-binding rule |
| D1 one `feeds` array | **Lock in** | uniform; closes F4 |
| D2 manifest-exempt activity | **Endorse, reground** | kills a chain in the common case |
| Part C bearer tokens | **Reject** | reintroduces shared secrets; off-model |
| **Option E encryption** | **[NEW] headline** | real privacy, less machinery, static-hostable |

---

## Part 1 — Adjudicating PROPOSALS-2

### 1.1 A1 (header `typ`): correct, and the `crit` question resolves to "no `crit`"

Putting `typ` in the **protected** header is the right fix for P1's residual confusion risk. The
header is inside the RFC 7797 signing input, so `typ` is signature-bound (JWT-grade), and it is
"one more protected-header member alongside `kid`" — genuinely still one construction. To the
agent's open crux (does `typ` need to be in `crit`?): **no.**

- The defense is the **mandatory bidirectional check** — an assertion verifier requires
  `typ=="openfeed-fetch"`; a core-document verifier requires `typ` **absent**. Because the header
  is signed, an attacker cannot strip or add `typ` without invalidating the signature, and cannot
  make an assertion's bytes verify at a core-document endpoint (its signed header carries a `typ`
  the core verifier rejects) or vice-versa.
- Putting `typ` in `crit` would force the header to *also* differ in its `crit` array between
  assertions and core docs, which muddies "one construction" more than it helps. `crit` protects
  against a verifier *ignoring* a param; here the param's whole job is a contextual accept/reject
  the endpoint already performs. **Leave `crit:["b64"]` untouched; mandate the bidirectional
  `typ` check.** (Cheap defense-in-depth if you're nervous: verifiers MAY treat an unexpected
  `typ` as a hard reject even absent `crit`. That's already what the rule says.)

**Answer to Part G #1:** yes, it's honestly one construction — same algorithm, canonicalization,
detached `b64:false` framing; `typ` varies exactly as `kid` already does. If varying `kid`
doesn't make it two constructions, neither does varying `typ`.

### 1.2 A2 (`url` binding), D1 (one `feeds` array): lock in

Both are pure cohesion at pre-1.0-acceptable churn. D1's `rel` token should follow the *same*
vocabulary rule as `_rel[].type` (registered token **or** absolute URL; unknown preserved &
ignored) — see Part 4.1. Resolve D1's ambiguity crux as the agent suggests: `rel:"primary"` is
authoritative, array order is display-only.

### 1.3 D2 (manifest-exempt activity feeds): endorse, but reground the rationale

The agent frames D2 as "activity feeds are low-value, so drop their manifest." That invites the
counter "but my like-counts matter." **Reground it on a principled line the spec already draws:**
§8 distinguishes **content-bearing** relations (`reply`, `quote`, `mention` — REQUIRED content)
from **content-less** relations (`like`, `repost` — NONE). The completeness proof is a property of
**content of record**. A content-less relation is an *acknowledgment*, not a record — there is no
"content" whose omission would be a lie, only a soft social signal.

So: **the manifest commits content-bearing items; content-less relation items are
manifest-exempt.** Operationally that still means "put them in an auxiliary feed with no
manifest" (keeping the §9.4 "every id persists" invariant clean by not mixing exempt items into
the primary manifest), but the *justification* is now a type distinction, not a value judgment —
and it sharpens the README claim from the defensible "your host can't drop your **posts**" (true)
away from the indefensible implicit "…or your likes" (who cares).

**Audit item (real, do before adopting):** without a manifest, a polled activity feed has no
liveness/rollback proof, so a *retracted* like can't be proven-deleted to a poller (§7.5 liveness
consult has no manifest to consult). For a like this is acceptable; state it explicitly. Inbox
retraction (the primary path for un-liking) is unaffected.

**Answer to Part G #3:** the only scenario needing reaction-completeness is "prove my host didn't
suppress the likes on my controversial post" — a public-virality concern, not family-scale, and
explicitly outside the manifest's stated family-scale ceiling (§14.4). D2 is a clean win for the
target audience; a public-virality user who needs it can put reactions in a manifested feed by
choice. Make it OPTIONAL-with-a-default, not forbidden.

### 1.4 A5 (keep the manifest): settled, now with three independent reasons

PROPOSALS.md rejected feed-as-chain on **pagination**; PROPOSALS-2 added **history-retention
cost**; I add a third: **frequency/GC independence** — the manifest can checkpoint-prune deletion
history (§9.3) without rewriting content, which a content-chain couldn't. Three unrelated reasons,
one conclusion. **Logged as settled; stop revisiting.**

---

## Part 2 — Expanding B: the system is **three** shapes, and the third is the insight

PROPOSALS-2's frame (signed document / chain) is the right instinct but it's incomplete, and the
gap is exactly the thing that makes newcomers say "wait, the feed isn't signed?" Two of the most
important artifacts in the system — **the feed** and **the history documents** — are *neither* a
signed document nor a chain. They are **unsigned containers of signed things.**

Name all three:

1. **Signed document** — a self-verifying leaf (construction #1, author-bound). *Identity doc,
   item, manifest, grant, follows, pins, and — post-P1 — the fetch assertion.*
2. **Chain** — a signed document carrying `seq`/`prev`/`history`, pinned-and-walked (§5.2–§5.3).
   *Identity chain, manifest chain.* (A chain is a *kind of* signed document, so this is really a
   modifier, not a separate primitive — see below.)
3. **Container** — an **unsigned** aggregation of signed things. Its integrity is not its own; it
   derives from its contents. *The feed* (container of signed items) and *each history document*
   (container of signed chain-versions).

Now the two questions that make the design feel ad-hoc answer themselves, identically:

- *"Why is the feed unsigned?"* → Because it's a **container**; containers are unsigned by design,
  their contents self-verify.
- *"Then how is a feed tamper-evident?"* → A container's integrity comes from its contents. A
  **history** container needs nothing extra: its entries are chain-linked, so completeness and
  order self-check against the chain's `prev` walk. A **feed** container has **no intrinsic
  chain** over its membership — so it needs a companion commitment, and **that is precisely what
  the manifest is.** The manifest exists *because a feed is the one container whose membership
  isn't self-evident.*

This is the most cohesive framing in any of the three passes, because it turns the manifest from
"an extra document you have to know about" into "the necessary consequence of the container
pattern," and it unifies feed and history under one idea. **State the three shapes once in the
core (§1 or §2); every later artifact becomes a field table + one label.**

**Even tighter (optional):** since a chain *is* a signed document with extra fields, you can bill
the system as **one primitive (signed document) + two modifiers (chained / contained)**:

- *chained* = adds `seq`/`prev`/`history`, pinned-and-walked;
- *contained* = an unsigned wrapper whose integrity is either intrinsic (chain-linked entries) or
  delegated to a companion commitment (the manifest).

Either phrasing is fine; the load-bearing part is **naming the container**, which PROPOSALS-2's
two-shape frame silently dropped (and its own Part B challenge half-noticed: "is history a third
thing?" — yes, and so is the feed).

**Answer to Part G #4:** post-P1 there is no signed artifact that is neither signed-doc nor chain
— *but* there are two unsigned artifacts (feed, history) that the two-shape frame can't place.
The three-shape frame places them and explains the manifest as a bonus.

---

## Part 3 — The reversal: reject Part C (bearer tokens)

PROPOSALS-2 Part C is the sharpest analysis in either pass, and I think its conclusion is
**wrong** — for a reason that is itself one of the passes' recurring principles.

**C's logic:** the fetch assertion's only job is non-transferability; §2 already concedes
re-sharing; so a per-reader **bearer token** is size-matched and deletes the assertion, replay
cache, second construction, and auth-time fetch.

**Why it's wrong: it reintroduces the shared secret the whole protocol exists to abolish.** The
core's identity model — the thing that distinguishes it from "a website with passwords" — is
**you are a URL with a keypair; you prove control by signing; there are no shared secrets, no
passwords, no bearer credentials anywhere in the system.** A fetch assertion (post-P1) is *maximally*
on-model: the reader proves who they are by signing a tiny document with **the key they already
publish**, authorized by an owner grant that names **their identity URL**. No new secret is minted,
delivered-in-confidence, stored, rotated, or leaked-in-logs.

A per-reader bearer token throws that away and brings back the password:

- The owner must **generate a high-entropy secret per reader**, **deliver it confidentially**
  (a signed carrier item is *public/attributable* — putting a secret in it is a category error;
  C's own challenge #3 flags this and its "answer sketch" doesn't fully resolve it), **store** it
  on both sides, and **rotate** it on leak. That is precisely the shared-secret lifecycle Open
  Feed deleted when it chose keys over passwords.
- It is **off-model everywhere else**: nothing in the core uses a bearer secret; §6.4 capability
  URLs are the *lowest-assurance* tier the spec explicitly warns about, and C's move is to
  *promote that tier to the primary mechanism.*

C invokes P5's spirit ("cut mechanisms that fight the spec's philosophy") against the assertion.
But the assertion **is** the spec's philosophy (sign-to-prove-identity); the **bearer token is
the thing that fights it.** P5's logic, applied honestly, protects the assertion and cuts the
token.

**Its one real benefit doesn't survive scrutiny either.** C argues tokens simplify the cross-hub
pull (the hub presents Mom's token instead of holding Mom's key). But: if the hub pulls *on Mom's
behalf*, it already acts as Mom (holds her key, per DISTRIBUTION-MODEL) — no token needed. If Mom
has **client-side keys**, she reads on her *own* device and signs her *own* assertion — again no
hub token. The scenario where "hub presents Mom's token without holding her key" helps requires Mom
to hand her hub a long-lived secret, which is *worse* custody than either endpoint. The benefit is
illusory.

**Verdict (Part G #2):** keep **identity-bound assertions (P1 + A1)**. The bearer-token pattern
stays exactly where the spec already puts it — the honestly-labeled low-assurance capability-URL
escape hatch for pure static hosting (P2's residual §6.4 note), never the primary mechanism.

*But* C asked the right question — "does the identity-bound tier earn its machinery?" — and the
honest answer reframes the whole extension, which is Part 3's real payoff and the bridge to Option
E: **if the point of restriction is to keep content from the wrong eyes, the assertion tier fights
the wrong battle (it authenticates readers to a host that reads the plaintext anyway). The battle
worth fighting is keeping the plaintext from the host.**

---

## Part 4 — Small expansions

### 4.1 One token-vocabulary rule, stated once

The system has several small token vocabularies, each currently "registered token or namespaced
URL" but specified in different places: `_rel[].type` (§8), the D1 feed `rel`, key `use`
(`sig`/`recovery`), the `OpenFeed-Sig` scheme. Hoist the rule to the core once — *"An Open Feed
token vocabulary is a small registered set plus permissionless absolute-URL extensions; unknown
tokens MUST be preserved and MAY be ignored"* — and have `_rel.type`, feed `rel`, and `use`
reference it. Cohesion, zero wire change.

### 4.2 Naming: the manifest is "the feed's chain"

Given Part 2, "manifest" is jargon for "the feed's chain head." Consider surfacing that in prose
("every identity keeps two chains: its **identity chain** and its **feed chain** (the manifest)")
so the two-chain symmetry is nominal, not just structural. Non-normative; helps the mental model.
Don't rename the field.

---

## Part 5 — Option E: encrypt to published keys instead of gating the host **[NEW, headline]**

**The realization Part 3 sets up:** restricted feeds are only justified **cross-hub** (single-hub
family-only is a login wall, no protocol needed). Cross-hub is exactly where you *least* trust the
serving host — and the current extension's headline concession is *"the serving host reads every
restricted item."* So the extension spends its entire machinery (second construction, assertions,
grants, gated manifest, revocation list, existence modes, self-commitments) defending against the
*weak* adversary (a stranger without a grant) while **conceding to the strong one** (the host).
That is backwards.

**Turn it around.** Every Open Feed identity already publishes a public key. Give the identity
document's `keys` array an optional **X25519 encryption key** (`{"kty":"OKP","crv":"X25519",
"use":"enc", ...}` — additive; verifiers that don't encrypt ignore it, exactly as they ignore
unknown `kty`/`crv` today, §4.1). Then a "restricted" item is **an ordinary signed public item
whose content is a ciphertext envelope**:

- `content_text:""` (stays JSON-Feed-valid), and an extension field `_enc` carrying: a symmetric
  content-key-encrypted blob + a small array of that content key **wrapped to each authorized
  reader's X25519 key** (sealed-box / ECDH-ES). N readers → N wrapped keys (family-scale N≈10;
  trivial).
- The item is **signed with construction #1 over the whole (encrypted) bytes** → one signing
  construction preserved, author binding intact, `_feed_url`/canonical-copy intact, tombstones
  intact, and **the public manifest commits the ciphertext** → completeness proof intact.

What this **deletes** from the restricted-feeds problem, wholesale:

- the fetch assertion (§4) and the second construction — **moot** (feeds are world-readable);
- **all four authorization mechanisms** (§6) — there is nothing to authorize at fetch time;
- the **gated manifest** (§7) — the manifest is public and commits ciphertext;
- the **grant-revocation list** (§6.2.2), **existence modes** (§9), **self-commitments**
  (conventions §5) — all gone;
- the CORS carve-out and the browser-reader regression (R-7) — feeds stay `Access-Control-Allow-Origin: *`.

What it **gains**:

- **Real confidentiality** — the host serves ciphertext it cannot read. This is *unique utility*
  neither ActivityPub, Nostr, nor the current extension provides, and it's the exact worry
  DISTRIBUTION-MODEL already surfaces (the "family-visible posts reach the AI provider" consent
  problem, §825 — encryption makes "who can read this" cryptographic, not policy).
- **Restricted content on static hosting (Level 2!)** — no request-time logic, no `401`, no replay
  cache. The dumb host just serves files. The current extension needs Level 3 for everything but
  capability URLs.
- **Cross-reader equivocation is a non-issue** — the manifest is public, so §8.2 and the entire
  self-commitment tower simply don't arise.

The honest **costs** (state them loudly; this is the owner's call):

- **Metadata leaks** — item ids, timestamps, sizes, and the feed's existence/cadence are public
  (same class as an existence-public restricted feed). Encryption hides *content*, not *that you
  post*. It therefore does **not** serve the A4 existence-privacy persona; that stays a separate,
  harder problem.
- **Key management moves client-side** — wrap to N readers; re-wrap the *next* items on audience
  change. **No forward secrecy and no retroactive revocation**: a removed reader keeps whatever
  ciphertext they already fetched (identical to the current "authorized readers can re-share"
  concession, §2 — so not a *new* loss).
- **Group-membership churn** at large N is real crypto-ops work — but restricted feeds are
  family-scale by construction, so N is tiny.
- It **reverses a stated scope call** ("E2E encryption is out of scope"). Worth it *iff* the
  cross-hub confidentiality use case is real — and Part 3 argues that's the *only* case restricted
  feeds justify at all.

**Two ways to land it:**

- **E-replace:** Option E *is* the restricted-feeds extension. Audience-control-without-
  confidentiality (host reads plaintext) is dropped as a not-worth-the-machinery middle ground.
  Maximum cohesion; the boldest version.
- **E-complement:** ship Option E as `open-feed-encrypted-content.md` (a pure **client-side
  content-encoding** extension — it touches no serving path, no trust core) and keep a *drastically
  slimmed* audience-control extension (P1–P5 applied) for the "I trust the host, I just want a
  login wall across hubs" case. Two small orthogonal extensions instead of one sprawling one.

My lean: **E-complement**, because the two solve genuinely different threat models (confidentiality
vs. host-trusted audience control) and each is small once separated. But if forced to one,
**E-replace** is the cleaner spec.

**Challenge me (this is the item most worth attacking):**
- Ed25519↔X25519: I propose a **separate** published X25519 key (additive to `keys`) rather than
  converting the signing key, to avoid cross-use hygiene debates. Is a separate enc key the right
  call, or does it bloat the identity doc / complicate key rotation (now two key lifecycles)?
- Does encrypting `content` while leaving `_rel`, `date_published`, and `id` in cleartext leak
  enough structure to matter (e.g. a reply's `_rel.to` reveals the thread even if bodies are
  sealed)? For family scale I claim acceptable; attack it.
- Reply/interaction UX: a non-audience member can *see that* an encrypted item exists and even
  reply to its id, but can't read it. Is that confusing or fine?
- Is "no forward secrecy, no retroactive revocation" disqualifying for any family use, given the
  current extension already concedes re-sharing? I claim it's the same concession; verify.

---

## Part 6 — The synthesis and the decisions that are genuinely the owner's

**Do-regardless spine (no capability change, pure cohesion):**
- **B (three shapes)** + naming them in the core — the mental model becomes *signed document,
  optionally chained, optionally contained.*
- **P1 + A1** — one signing construction, one verifier, `typ`-in-header domain separation.
- **A2** — one author-binding rule.
- **D1** — one `feeds` array; F4 closed. **D2** — content-less relations are manifest-exempt; one
  chain per identity in the common case; F4 closed from the other side.
- **4.1** — one token-vocabulary rule.

**The restricted-feeds fork (the real decision):**

| Path | What it is | Host can read? | Hosting | Machinery |
|------|-----------|----------------|---------|-----------|
| **Status quo, slimmed** (P1–P5 + A1) | identity-bound assertion + grants + gated manifest | **yes** | L3 | medium |
| **Option E** (encrypt to keys) | public feed of ciphertext items | **no** | **L2** | small (client-only) |
| **E-complement** | both, as two small orthogonal extensions | either, per use | L2/L3 | small + small |

Three questions decide it, and all three are product calls, not engineering calls:

1. **Is cross-hub "family-only" a real requirement?** (If no → restricted feeds are a login wall;
   drop the extension, revisit P6.) DISTRIBUTION-MODEL says yes.
2. **In that cross-hub case, do you want the other host to be *able* to read the content?** If no
   → **Option E** (encryption) is not a nice-to-have, it's the correct design, and the entire
   assertion/grant apparatus is solving the wrong problem. If "I trust family hubs, I just want to
   gate strangers" → the slimmed assertion path is right.
3. **Is hiding a feed's *existence* (not just contents) a hard requirement** (the A4 abuse
   persona)? This is orthogonal to 1–2 — encryption *doesn't* provide it, and it's the one thing
   that keeps existence-private mode alive if the answer is yes.

**My recommendation:** lock the do-regardless spine now (it's all upside), and put questions 1–3
to the owner before drafting restricted-feeds v0.2 — because the answer to #2 in particular chooses
between "shrink the extension" and "replace it with something smaller *and* stronger." I lean
**E-complement**: adopt the slimmed assertion path *and* an encrypted-content extension, since they
serve different threat models and each is small once you stop making one extension do both jobs.

---

## Appendix — direct answers to PROPOSALS-2 Part G

1. **Header `typ` = one construction?** Yes; no `crit` needed; the signed bidirectional check is
   sufficient (Part 1.1).
2. **Bearer tokens vs identity binding?** Keep identity binding — tokens reintroduce shared
   secrets and are off-model (Part 3). C asked the right question and it leads to Option E, not to
   tokens.
3. **Reaction-completeness scenario?** Only public-virality, out of family-scale scope; D2 is a
   clean win with an OPTIONAL escape (Part 1.3).
4. **Anything neither signed-doc nor chain?** Yes — the **feed and the history documents** are
   *containers* (unsigned). The two-shape frame missed them; the three-shape frame names them and
   explains the manifest as their consequence (Part 2).
5. **Existence-privacy a hard requirement?** Owner call; note Option E does *not* provide it, so
   it stays a separate decision (Part 6 Q3).
6. **Missed core simplification?** Yes — the *container* framing (Part 2) and D1/D2 are core-level;
   beyond those I also believe the core is minimal.
7. **Cross-proposal effects?** **Option E makes P1/A1/C/P2/P3/P4/P5 all moot for the
   confidentiality use case** (there's no host-gating left to simplify) while leaving the
   do-regardless spine (B/A2/D1/D2/4.1) fully intact. That's the biggest cross-effect in any pass:
   pick the fork (Part 6) *before* investing more in restricted-feeds internals.
