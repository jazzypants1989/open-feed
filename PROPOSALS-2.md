# PROPOSALS-2.md — Second simplification pass (for peer review)

> **Audience:** the agent that wrote `PROPOSALS.md`, and the owner. The owner ran the
> "simplify without sacrificing capability, big changes welcome" prompt in two sessions.
> This document is written to be read **alongside `PROPOSALS.md`** and **adversarially
> reviewed**. Nothing here is committed or applied. Where I extend or sharpen a proposal
> from `PROPOSALS.md` I say so (P1–P6 refer to that document); where I add something new I
> flag it **[NEW]**. Treat a well-argued rebuttal as the win — especially on the two radical
> items (Part C, Part D2).
>
> **How to review:** each proposal gives the claim, the argument, what gets deleted, the
> capability trade, the blast radius, my confidence, and explicit "challenge me" prompts.

## TL;DR

`PROPOSALS.md` is right about the shape of the problem: the core is tight, the sprawl is in
the extensions, and it compounds. I agree with **P1, P2, P3, P5**, agree **conditionally**
with **P4**, and reframe **P6**. I add three things that pass did not have:

1. **A unifying frame (Part B).** The entire system — core *and* every extension — is **two
   primitives**: a *signed document* and a *chain* (a signed document that also carries
   `seq`/`prev`/`history` and is pinned-and-walked). Naming those two things once, in the
   core, turns the extensions from bespoke formats into three-word references. This is the
   direct answer to the owner's ask for something "more cohesive and logical." **P1 is what
   makes this frame true** (the fetch-assertion JWT was the one artifact that broke "every
   signed thing is one shape"), so P1 and this frame reinforce each other.

2. **An upgrade to P1 (Part A).** P1's admitted weak point — that unifying the assertion onto
   construction #1 downgrades JWT `typ` domain-separation to "distinct field sets" — is fixed
   properly by putting `typ` in the **protected JWS header**, which is already signed. That is
   cryptographic domain separation at *zero* cost to "one construction."

3. **Two new core consolidations (Part D), independent of the restricted-feeds debate**, that
   also resolve the long-standing activity-feed-discovery gap (HANDOFF F4):
   - **D1:** collapse the identity document's `feed` + `manifest` + `feeds` into **one
     `feeds` array** with a `rel` marker.
   - **D2 [radical]:** make a feed's manifest **optional for auxiliary (activity) feeds** —
     reactions become manifest-exempt. Kills an entire per-identity chain in the common case.

And one deeper lever (Part C) that sits between P1 and P6:

- **Per-reader bearer capability tokens.** The fetch assertion exists *only* to make a grant
  non-transferable — but restricted-feeds §2 already concedes readers can re-share. If you
  accept that concession, a per-reader bearer token deletes the assertion, the replay cache,
  the second construction (P1 becomes moot), and the auth-time identity fetch, in one stroke.

| # | Proposal | Relationship | Deletes | Confidence |
|---|----------|-------------|---------|-----------|
| **A1** | `typ` in the protected header | **sharpens P1** | P1's residual confusion risk | **High** |
| **B** | Name two primitives (signed doc / chain) | **[NEW] frame** | ~5 restatements of "§9 mechanics"; per-extension format prose | **High** |
| **C** | Per-reader bearer tokens | **[NEW] reframes P1+P6** | fetch assertion (§4), replay cache (§5.1), 2nd construction, auth-time fetch | **Medium** |
| **D1** | One `feeds` array with `rel` | **[NEW] core** | `feed`/`manifest` top-level fields; the F4 gap | **High** |
| **D2** | Manifest optional for activity feeds | **[NEW] core, radical** | a whole feed's chain+history per identity; the F4 gap (other half) | **Medium** |
| **A2** | Unify author-binding field to `url` | **[NEW] tidy under P1** | the `iss`/`url` split | **Med-High** |

---

## Part A — Endorsing and sharpening `PROPOSALS.md`

### A1 — P1 is the best move in either pass; fix its one hole with header `typ` **[sharpens P1]**

**Endorse P1 fully.** Making the fetch assertion a construction-#1 detached-JWS document
(embedded `_sig`, transported base64url'd in the header exactly as `OpenFeed-Grant` already
is) gives the whole protocol **one construction and one verifier code path**, and *strengthens*
the invariant the design is proudest of instead of trading it away. The DPoP properties
(`htm`/`htu`/`iat`/`exp`/`jti`, replay cache) are not JWT-specific and all survive.

**The hole.** P1 concedes that once the assertion, grant, item, and manifest all sign
canonical JSON with construction #1, the *only* thing separating an assertion-signature from
the others is the **field set** of the signed payload — "domain separation by schema," weaker
than the JWT's `typ`. P1's fix ("distinct field sets, or belt-and-suspenders a `purpose`
field") relies on payload-schema hygiene, which the spec does not otherwise enforce (unknown
`_` fields are *preserved*, not rejected).

**The fix — put `typ` in the protected JWS header.** The header is covered by the signature
(RFC 7797 signs `ASCII(BASE64URL(header) || '.') || payload`, spec §6.1), so a header field is
**cryptographically** bound — JWT-`typ`-grade — while the *construction stays byte-identical*
(it is one more header field alongside `kid`, which already varies). Rule:

- The fetch assertion's header MUST carry `"typ":"openfeed-fetch"`.
- Core signed documents (items, manifests, identity docs, grants, follows, pins) MUST NOT
  carry `typ`, and their verifiers MUST reject a document whose header carries an unexpected
  `typ`.
- The assertion verifier MUST reject an assertion whose header `typ` is not `openfeed-fetch`.

This closes the cross-context confusion P1 opens without reintroducing a second construction.

**Challenge me.**
- Is "add `typ` to some construction-#1 headers but not others" honestly *one* construction,
  or a second one wearing a trenchcoat? My claim: one — same algorithm, same canonicalization,
  same detached b64:false framing; `typ` is an optional protected-header member exactly like
  `kid`. If you think this is cheating, say why the varying `kid` isn't.
- `typ` is not in `crit`, so a maximally-naive verifier ignores it. Is the *mandatory
  bidirectional check* (assertion requires it present; core docs require it absent) enough, or
  does `typ` need to go in `crit:["b64","typ"]`? I lean "no crit needed" because the check is
  contextual at the application layer, but attack the edge.

### A2 — Unify the author-binding field to `url` **[NEW, tidy under P1]**

Today "the identity this signed document belongs to" has **three** field names: items use
`authors[0].url` (forced by JSON Feed), everything else uses `url`, and the assertion JWT uses
`iss` (forced by JWT/DPoP convention). Once P1 drops the JWT, the assertion should bind via
**`url`** like every other non-item signed document, not `iss`. Then the rule is uniform:
*every signed document is author-bound by `url` == the `kid` identity, except items, which are
bound by their single `authors[0].url` because JSON Feed owns that field.* Two cases, stated
once, instead of three field names. Trivial, but it is exactly the kind of incidental
inconsistency that makes the system feel more complex than it is.

### A3 — P2, P3, P5: endorse, with P3 and P5 strengthened

- **P2 (grants become the only real auth mechanism): endorse.** Cutting the published reader
  list (§6.3, a mechanism whose spec text is mostly a warning against using it, plus the
  hashed-list anti-pattern subsection) and demoting the private allowlist (§6.1) to one
  sentence loses ~no capability. (Part C may cut deeper still.)

- **P3 (cut the chained grant-revocation list): endorse, and here is the decisive argument P3
  gestures at.** Frame it by *who the adversary is*:
  - *Honest host:* will honor a private server-side denylist. No public chained artifact
    needed.
  - *Malicious serving host:* reads the plaintext and serves whom it likes — **no** revocation
    mechanism, chained or not, constrains it. The list is worthless here.
  - The chain's *only* teeth are in a narrow slice: an **honest** enforcing host fetching the
    owner's revocation list across a **serving-path-compromised** transport that rolls the list
    back to re-authorize a cut reader. Real, but narrow, and the family-scale answer (short
    `exp`, stop renewing) already covers it. Cut §6.2.2, the `grant_revocations` endpoint, and
    R.4/R.4b; keep one sentence: *"to revoke faster than `exp`, shorten `exp`; a host MAY keep
    a private denylist."*

- **P5 (cut self-commitments): endorse, and lead with the philosophical argument, not the
  mechanics.** The core's trust story (§14.2) is deliberately an **honest gradient**: it names
  three adversary tiers and states plainly which properties hold at each, rather than
  engineering every risk away. A restricted feed is *definitionally* key-custodian tier (the
  host reads plaintext). Cross-reader equivocation by a key-custodian host is the
  **tier-appropriate residual risk**, and the honest-gradient answer is "documented, mitigated
  by client-side keys and out-of-band compare, not fully solved." Self-commitments try to
  *engineer away* a tier-appropriate residual with a bespoke public-commitment protocol — and
  **still cannot close it** (the commitment-withholding evasion, C-5, remains open; the HANDOFF
  itself doubts the heuristic is soundly specifiable). A clever mechanism that fights the
  spec's own stated philosophy *and* doesn't fully work is the textbook thing to cut. Shrink
  restricted-feeds §8.2 to the out-of-band-compare fallback it already offers existence-private
  feeds; delete conventions §5 (+ C.2/C.2b + the tradeoff triangle). Bonus: this un-overloads
  the `pins` document (it stops meaning both "observations of others" and "commitments about
  myself") and dissolves the C-1 constraint on the unwritten delegation doc.

### A4 — P4 (cut existence-private): endorse **conditionally** on one product question

The simplification is large (the 403-vs-404 timing subsection, the explicit-`manifest`-on-grant
requirement from F2, the incompatibility clauses) and the property is weak (§9/R-10 admits
timing leaks existence to *authenticated* probers anyway). **But** before cutting, answer one
persona: a family member hiding a support-group / estrangement feed from an abuser who *can*
read the public identity document. If that is a real requirement for the family-journaling
product (DISTRIBUTION-MODEL leans on `family` visibility), existence-private stays and R-10
becomes a **bug to fix** (equalize timing), not a reason to cut. If it isn't, cut it and the
F2 explicit-`manifest` binding largely unwinds with it. **This is the owner's call, not ours.**

### A5 — Reject folding the manifest into the feed: confirmed, on *two* independent grounds

`PROPOSALS.md` rejected this on **pagination** grounds (a `next_url`-paginated feed has no
single "full bytes" to hash-chain, §7.4). This pass independently rejected it on
**history-retention** grounds (chaining the full feed makes every retained historical version
carry all past item *content*, where the manifest's `id→version` map keeps walk-back cheap).
Two unrelated reasons, same conclusion: **keep the manifest and the two-chain design.** Log
this as settled.

---

## Part B — The unifying frame: two primitives **[NEW]**

Strip the prose and the whole system — core *and* both extensions — is exactly two things:

1. **A signed document.** Construction #1 (detached JWS, RFC 7797 unencoded payload, Ed25519,
   over RFC 8785 canonical bytes, header+payload covered, §6), author-bound by `url` == the
   `kid` identity (items: `authors[0].url`; see A2). *Instances:* identity document, item,
   manifest, capability grant, follows, pins, and — after P1 — the fetch assertion.

2. **A chain.** A signed document that additionally carries `seq` / `prev` / `history` and is
   **pinned on first observation and walked back to the pin on every later fetch** (§5.2–§5.3).
   *Instances:* the identity chain, the manifest chain (and any others that survive the cuts).

The spec *defines* "Chain" in §2 terminology but the **generic mechanics live inside §5**
(specific to the identity document), are re-imported by reference in §9 ("follow §5.2/§5.3
exactly"), and are then re-imported **by string** — *"the identical mechanics of core §9"* — in
restricted-feeds §6.2.2, §7 and conventions §3.3, §5.2. That phrase appears ~five times; each
occurrence pays the full explanatory cost again, which is a large part of why the extensions
*feel* heavy.

**The change.** Promote the chain mechanics into **one standalone core section that names no
specific document** — "An Open Feed *chain* is a signed document with `seq`/`prev`/`history`,
produced per §5.2 and enforced per §5.3." The identity document and the manifest become its two
core *instances*. Every other artifact in the system then reduces to a field table plus one of
two sentences: *"X is an Open Feed signed document (§6)"* or *"X is an Open Feed chain (§5)."*
The extensions stop re-deriving mechanics and start *referencing* them.

**Why this is the answer to the owner's ask.** "Cohesive and logical" is precisely: fewer
primitives, each named once, everything else an instance. This change adds no capability, moves
no bytes on the wire, and makes the mental model *two things*. It is the highest-cohesion,
lowest-risk item in either document. **Do it regardless of every other decision** — and note it
composes with P1: the assertion being a plain signed document is what lets primitive #1 be
described as *universal* with no "except the JWT" asterisk.

**Challenge me.** Is there any signed artifact in core-or-extensions that is *neither* a signed
document nor a chain, once P1 lands? I claim none. Find the counterexample (the two history
*documents* are containers of chain versions, not themselves signed — is that a third thing, or
just "not a signed document"? I say the latter: history is unsigned because every entry is
independently verifiable and chain-linked, §5.4).

---

## Part C — The deep lever: per-reader bearer capability tokens **[NEW, radical; reframes P1 & P6]**

**The question under restricted feeds that neither pass asked: what is the fetch assertion
actually *for*?** Its sole job is to make a capability **non-transferable** — a captured grant
is useless to anyone who doesn't also hold the reader's key. But restricted-feeds §2 *already
concedes* **"authorized readers can re-share"**, and §2's headline is **"audience control, not
confidentiality"** (the host reads the plaintext). So the assertion enforces a **hard**
per-request cryptographic identity check on top of a boundary the extension itself declares
**soft**. That is an impedance mismatch — the same "disproportionate mechanism" smell P5 pins
on self-commitments, aimed now at the load-bearing core of the extension.

**Follow it through.** If you accept the re-sharing concession, the size-matched primitive is a
**per-reader bearer capability token** — an unguessable high-entropy string the owner issues to
each reader, presented in an `Authorization` header, revoked by dropping it from the host's
accept-set. That single substitution deletes:

- the **fetch assertion** (§4) entirely — **and with it the whole second-construction question
  (P1 becomes moot; there is nothing to unify)**;
- the **replay cache** (§5.1) and all of `jti`/`exp`/skew;
- the **auth-time outbound identity-document fetch** (§5 step 6) and its SSRF + timing
  side-channel (R-10);
- **capability URLs (§6.4) as a separate tier** — a bearer token *is* a per-reader capability
  URL, but carried in a header instead of the path, so it is strictly *less* leaky (no referer,
  no history sync, not in server logs by default) **and** per-reader-revocable (which §6.4 is
  not).

Restricted feeds would collapse to roughly: *"Serve only to a request bearing a valid,
unrevoked per-reader token. The owner issues tokens out-of-band or via a signed inbox item, and
revokes by dropping them. Contents gated; the host reads plaintext; audience control, not
confidentiality."* One mechanism, no second construction, no replay state — perhaps a third of
the current extension. It also **simplifies the cross-hub pull** in DISTRIBUTION-MODEL: today
the hub must sign an assertion *"as the reading member,"* which *"is possible only because the
hub holds Mom's key"*; with bearer tokens the hub just presents Mom's token and **need not hold
her key to read** (only to sign her own content).

**The honest cost (this is genuinely the owner's call).** You lose cryptographic *reader-
identity binding*. The host learns "a valid token was presented," not "identity X is reading."
Two consequences:
1. Weaker **audit/attribution** — the host can't cryptographically prove which family member
   read what. (It can still associate a token with a reader in its own records.)
2. A token **leaked to a stranger** (vs. deliberately re-shared to another family member) grants
   access until revoked. Identity-bound assertions resist *accidental leakage to third parties*;
   the re-sharing concession only gave up *deliberate* sharing among the audience. This is the
   real, narrow thing the assertion buys.

So the sharp version of P6 is **not** "do restricted feeds belong?" — it is: **does the
*identity-bound* tier earn its machinery, or is a per-reader bearer token the right size for
family-scale audience control?** My lean: bearer tokens by default; keep identity-bound
assertions only if attributable reads or stranger-leak resistance is a stated requirement. If
you keep assertions, apply A1 (header `typ`) and they cost you one construction anyway.

**Relationship to P1/P6.** This is the middle path P1 and P6 straddle: P1 keeps the assertion
and merely re-encodes it; P6 deletes the whole extension. Bearer tokens **keep cross-hub
restricted feeds** but delete the assertion apparatus — more capability than P6, far less
machinery than P1-on-top-of-the-status-quo.

**Challenge me.**
- Is stranger-leak resistance actually worth a second signing act *per request* plus a replay
  cache, for a family feed whose content any member can re-share and whose host reads it anyway?
  Steelman "yes": a security-conscious member with client-side keys reading across hubs is
  exactly the cohort that benefits, and a leaked bearer token is a real (if narrow) exposure.
- Does *any* part of the system need to know reader identity for **abuse/rate-limiting**? Inbox
  rate-limiting keys on author identity (§10.2/§14.9); does restricted *reading* have an
  analogous need I'm missing?
- Token delivery: a bearer token has no signature to verify, so how does the reader know it came
  from the owner and not an attacker who wants to fingerprint them? (Answer sketch: deliver it
  inside the same signed inbox carrier item §6.2.1 already uses; the *carrier* is signed, the
  token is its payload. Verify this doesn't reintroduce what it removed.)

---

## Part D — New core consolidations **[NEW]** (independent of restricted feeds)

These two stand on their own and, together, **close the HANDOFF F4 activity-feed-discovery gap
from both ends.**

### D1 — One `feeds` array with a `rel` marker **[High confidence]**

The identity document today points at feeds with **three** fields: `feed` (primary),
`manifest` (its manifest), and `feeds` (additional, each `{url, manifest}`). That is a
special-cased primary plus a general array — two shapes for one concept.

**Consolidate to a single `feeds` array**, each entry `{ "url", "manifest", "rel" }`, with
`rel` a small token: `"primary"`, `"activity"`, … (default/first = primary). Drop top-level
`feed` and `manifest`. This is uniform, and it **solves F4 for free**: the activity feed is the
entry with `rel:"activity"`, so an implementer no longer has to invent a filename convention.

- Pre-1.0, breaking changes are allowed to fix a defect (§ status note); F4 is a real defect.
- The manifest still self-identifies via its own `url` + `feed_url` (§9), so the reverse binding
  is intact.

**Challenge me.** Does "first entry, or the one with `rel:primary`" create an ambiguity if both
signals disagree? (Fix: `rel:"primary"` is authoritative; ordering is display-only — state it.)
Any consumer code that hard-codes `feed`/`manifest`? (Pre-1.0; acceptable churn.)

### D2 — Manifest is OPTIONAL for auxiliary (activity) feeds **[Medium confidence, radical]**

The spec currently requires **every** feed to carry its own chained manifest (§3.2: `manifest`
MUST if `feed`; each `feeds` entry has its own manifest). Combined with §8's rule that
content-less relations (likes, reposts) SHOULD live in a **separate activity feed**, the common
case is **two feeds, two manifests, two chains, two history documents per identity** — half of
that machinery dedicated to committing an anti-omission proof over people's ❤️ reactions.

Notice the tension the spec is already carrying: *"one object model"* (a like **is** an item,
so it needs a manifest like any item) versus *"don't let likes dominate the manifest"* (so they
get shunted to a second feed+manifest). The second feed+manifest is complexity spent almost
entirely on low-value data.

**Proposal: a manifest is REQUIRED for the primary content feed and OPTIONAL for auxiliary
feeds.** An activity feed becomes an ordinary JSON Feed of *signed* items (one object model
intact — each like is still a signed item, verifiable, tombstoneable) **that simply carries no
completeness guarantee.** A host could silently drop one of your likes; you lose the ability to
*prove* it didn't. Ask: **who needs a cryptographic proof that all of their reactions are
present?** The completeness guarantee is precious for **posts and replies** (content, and the
thing Nostr can't do); it is near-worthless for bare reactions.

This deletes an entire per-identity chain (+ its history document) in the overwhelmingly common
case, and — like D1 — **resolves F4**: the activity feed is now definitionally "the auxiliary
feed with no manifest," so there is nothing to discover-and-verify-as-complete.

**Interaction with D1:** clean. An activity entry is just `{ "url", "rel":"activity" }` with no
`manifest` key. D1 makes the absence expressible; D2 makes it meaningful.

**Challenge me — this is the one most likely to be wrong.**
- Is there a real scenario wanting completeness over reactions — e.g. "prove my host didn't
  suppress the 200 likes on my controversial post"? If yes, D2 is wrong *for that user*.
  Counter: the *replies* (which carry content and argument) are in the **primary** manifest and
  keep their proof; only the bare like-counts lose it, and like-counts are soft social signals,
  not records.
- Does making completeness *optional per feed* muddy the clean "the manifest proves presence"
  story the README sells? (Mitigation: state it as "presence is proven for content; reactions
  are best-effort activity" — arguably *more* honest than implying ❤️-completeness matters.)
- Does anything in the manifest-lag / canonical-copy machinery (§7.5, §9.4) assume *every* feed
  has a manifest? Audit before adopting.

---

## Part E — Considered and kept (so the reviewer knows these were examined)

- **The manifest / two chains.** Kept — Part A5 (two independent rejections of folding it in).
- **Timestamp duality** (Unix seconds for key/chain fields, ISO 8601 for content). Kept: each
  borrowed standard (JOSE, JSON Feed) keeps its native convention; unifying would *fight* the
  standards Open Feed is built on. The cognitive tax is real but principled.
- **The inbox.** Kept. It is the *notification* path; without it, reply-discovery degrades to
  "poll every possible replier," which fails even at family scale. It already carries the full
  signed item (self-contained, verifiable, works for inbox-only items) rather than a bare
  Webmention-style ping — the right call.
- **`follows` vs `pins` as separate documents.** Kept, but flagged: they overlap (you generally
  hold a pin for anyone you follow). `follows` is human-meaningful (a reading list, MAY be
  private) and `pins` is machine-meaningful (observations with `seq`/`hash`/`observed`).
  Merging them would conflate two audiences; the cost of keeping both is one test vector. Low
  priority; mention to owner only if cutting hard.
- **`_feed_url` / canonical-copy rule (§7.5).** Kept — load-bearing (exclusivity proof,
  migration, cached-copy availability), and elegant.
- **The manifest's `deleted` map** (vs. folding deletion into `items`). Kept: the separate map
  is what lets checkpointing (§9.3) prune *old* deletion history without touching the live set.
- **Two history documents.** Kept — minimal (unsigned containers), and the cuts (P3, P5) reduce
  the *number* of chains that need one anyway.

**Flagged as friction, not proposed (open question):** migration ends in **bulk re-signing** the
back catalog (§3.4), because items carry `_feed_url` in their signed bytes. A signed "feed
continues feed" alias statement would avoid the re-sign, but it adds a construct *and* weakens
the clean "`_feed_url` proves exclusivity" invariant (exclusivity would become modulo alias
chains). At family scale catalogs are small, so the re-sign is cheap and the invariant stays
crisp — I lean keep, but it is the one ergonomic wart worth naming to the owner.

---

## Part F — What the system looks like after

**Do-regardless (no capability change):**
- **B** — two named primitives; extensions reference rather than re-derive.
- **A1 + P1** — one signing construction, one verifier, `typ`-in-header domain separation.
- **A2** — one author-binding rule (`url`, except items' `authors[0].url`).
- **D1** — one `feeds` array; F4 gap closed.

**Owner opts in (each trades a narrow, family-scale-invisible capability):**
- **P2** — grants are the only published auth mechanism.
- **P3** — revocation = short `exp` (+ optional private denylist); no chained public list.
- **P5** — no self-commitments; restricted cross-reader equivocation is honest-gradient
  residual + out-of-band compare.
- **P4** — no existence-private mode *(pending the abuse-persona check, A4)*.
- **D2** — reactions are manifest-exempt; one chain per identity in the common case.

**The fork that reshapes the rest (Part C):**
- **Identity-bound assertions** (P1 + A1 applied) **vs. per-reader bearer tokens** (C, which
  makes P1 moot). Pick one before drafting restricted-feeds v0.2.

Net, taking the do-regardless set + the opt-ins + bearer tokens: the protocol has **two
primitives, one signing construction, one verifier**; the identity document has **one feed
list**; the common identity has **one chain**; the conventions doc is **follows + pins-as-
observations**; and restricted feeds are **a per-reader token, a gated feed, and the honest §8
limits** — no assertion, no second construction, no replay cache, no self-commitment tower, one
discovery mode.

---

## Part G — Open questions for the reviewing agent (the cruxes)

1. **A1 header-`typ`:** is "vary `typ` in the protected header" genuinely one construction, or a
   second in disguise? If the latter, P1's whole "one construction" payoff is softer than both
   passes claim — attack it.
2. **Part C bearer tokens:** construct the strongest case that cryptographic *reader-identity
   binding* is worth the assertion machinery at family scale. If stranger-leak resistance or
   attributable reads is a real requirement, C is wrong and P1+A1 is the right answer instead.
   Also verify the "deliver the token inside a signed carrier item" story doesn't reintroduce
   what C removes.
3. **D2 manifest-exempt reactions:** find a family-scale scenario that genuinely needs a
   completeness proof over reactions. If none survives, D2 is a clean win; if one does, it
   bounds D2.
4. **Part B completeness:** name any signed artifact (post-P1) that is neither a signed document
   nor a chain. I claim none.
5. **A4 existence-private:** is hiding a feed's *existence* (not just its contents) a hard
   product requirement for the family-journaling app? This single answer decides P4.
6. **Did I miss a core simplification?** Both passes now claim the core (minus D1/D2) is
   minimal. Falsify it.
7. **Does any proposal here force a change to *another* proposal's premise?** (Known: C makes P1
   moot; D1 and D2 compose; P4 unwinds F2. Find others.)
