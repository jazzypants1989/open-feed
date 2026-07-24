# PROPOSALS-6.md — Sixth pass: the empirical turn, the owner's north-star, and the questions fresh eyes should attack

> **Audience:** a *fresh* reviewing agent (the owner will load **only this file + `open-feed-spec.md`**
> into your context — so this doc is written to stand alone) and the owner. This is the sixth turn
> in a simplification debate. The prior five passes are on disk and you SHOULD read them if you want
> the full chain of reasoning, but everything load-bearing is restated here.
>
> **The chain so far (all in the repo root):**
> - `PROPOSALS.md` — pass 1 (P1–P6: unify the signing construction, cut auth mechanisms, cut the
>   revocation list, cut existence-private mode, cut self-commitments, and the provocation "do
>   restricted feeds belong at all?")
> - `PROPOSALS-2.md` — pass 2 (A1 `typ`-in-header, the two-primitive frame, **C: bearer tokens**,
>   D1 one-`feeds`-array, D2 manifest-exempt reactions)
> - `PROPOSALS-3.md` — pass 3 (rejects C; **three-shape frame**; introduces **Option E: encrypt to
>   published keys**)
> - `PROPOSALS-4.md` — pass 4 (Option E = "just JWE"; the key-custody caveat; circles = "research frontier")
> - `PROPOSALS-5.md` — pass 5 (per-hop correction of the caveat; argues for **E-only**; circles = "shippable v2")
> - `ENCRYPTED-CONTENT-FINDINGS.md` — **the new thing: two working prototypes** (`tmp/enc-prototype.js`,
>   `tmp/circles-prototype.js`) that turn the last three passes' central claim from argument into code.
>
> **What makes this pass different:** passes 1–5 were pure analysis. This one has **running code**.
> The owner asked for two prototypes before committing to anything, and both pass. That moves several
> "I claim…" assertions to "verified," and — more usefully — exposes three concrete limitations the
> armchair passes never named. Your job is to be the skeptic the owner wants: the owner is **not**
> sold on the headline (reversing "E2E encryption is out of scope") and explicitly wants fresh eyes.
> **Steelman the NO.**

---

## 0. The owner's decisions this session (treat as inputs, not open)

Three things the owner settled in the session that produced this doc:

1. **North-star, stated verbatim:** *"Ideally, it would be one elegant concept that naturally scales
   up."* This was the answer to "is cross-hub family-only a real requirement, or is single-hub
   (a login wall) enough?" The owner didn't pick a deployment — they picked a **design criterion**:
   whatever the privacy story is, it should be *one mechanism that works identically at every scale*,
   not a bolt-on that only earns its keep in one topology. §2 argues this criterion is the sharpest
   lever in the whole debate and it cuts a specific way.

2. **D2 is LOCKED as "optional-default."** Content-less relation items (`like`, `repost`) are
   manifest-exempt **by default**, but a publisher MAY commit them in a manifested feed if they want
   the completeness proof. (Rationale: the anti-omission proof is a property of *content of record*;
   a like is an acknowledgment, not a record — a *type* distinction the spec already draws in §8,
   not a value judgment. This kills a whole second chain+history per active identity in the common
   case, while preserving an escape hatch for a public-virality user.) Do not reopen; do sanity-check
   the §9.4 interaction (see Q7).

3. **Prototype-before-commit.** The owner will not reverse a stated scope decision ("E2E out of
   scope") on the strength of a clever argument alone. Hence the code. Hence this pass. The bar for
   the encryption direction is not "is it elegant" but "does it survive being built and adversarially
   poked."

---

## 1. What five passes LOCKED — the "do-regardless" cohesion spine (do not reopen)

These are pure cohesion (mental model, not capability), agreed across passes and walked through with
the owner item-by-item. Restated so you don't have to reconstruct them. **One honest caveat up front,
which the earlier passes glossed:** this set is *not* uniformly "zero capability change and
fork-independent." I mark each.

| # | Item | What it does | Independent of the encryption fork? |
|---|------|--------------|-------------------------------------|
| **Three-shape frame** | State the system as **one primitive + two modifiers**: a *signed document* (construction #1, author-bound), which may be *chained* (`seq`/`prev`/`history`, pinned-and-walked) and/or *contained* (an **unsigned** wrapper of signed things). | **Yes.** Pure framing. |
| **Membership-chain principle** | A container self-verifies **iff its entries are chain-linked.** History does (entries carry `seq`/`prev`); a **feed does not** (items are independent leaves, spec §7.2) — so it needs a companion membership-chain, **and that companion is exactly the manifest.** Turns the manifest from "an extra doc" into "the necessary consequence of the container pattern." | **Yes.** |
| **P1 + A1** | Fetch assertion becomes a construction-#1 signed doc (embedded `_sig`, base64url'd in a header like the grant); `typ:"openfeed-fetch"` in the **protected** header (no `crit`), with a mandatory bidirectional check (assertion requires it; core docs require it absent). One construction, one verifier. | **NO — conditional on the fork.** If encryption replaces the fetch assertion (Option E), there is *nothing to unify* and P1/A1 are moot. Earlier passes filed these under "do-regardless"; that was wrong. Hold until the fork resolves. |
| **A2** | One author-binding rule: every signed doc binds via `url` == the `kid` identity, **except items** (bind via `authors[0].url`, forced by JSON Feed). | Coupled to P1 (removing the assertion's `iss` is the third case it eliminates). |
| **D1** | Collapse identity-doc `feed` + `manifest` + `feeds` into **one `feeds` array**, each `{url, manifest, rel}`; `rel:"primary"` authoritative, order display-only. Closes the F4 activity-feed-discovery gap. | **Yes** — but it is a **breaking wire change** to the identity document (fine pre-1.0; call it out, don't pretend it's a no-op). |
| **D2** | (see §0.2 — locked optional-default) | **Yes.** A genuine, small **capability trade** (you lose the provable-completeness of reactions), not pure cohesion. |
| **One token-vocabulary rule** | Hoist "registered token OR namespaced absolute URL; unknown preserved & ignored" to core once; `_rel.type`, feed `rel`, key `use` reference it. | **Yes.** |
| **Part C (bearer tokens): WITHDRAWN** | Reintroduces the shared secret the protocol exists to abolish; off-model. Rejected in pass 3, conceded in pass 4. | Settled. |

**If you do nothing else, this spine is safe to draft** — with P1/A1/A2 gated on the fork below.
Attack it if you can (pass 3/4 Part-B challenges: is there any signed artifact that is *neither* a
signed document nor a container? I claim no), but the owner has reviewed it and it's close to
decided.

---

## 2. The north-star cuts the fork — and it cuts toward encryption

The one unresolved question across all six passes: **what happens to restricted feeds?** The options,
compressed:

- **Slim-only** — apply P1–P5 to the existing authorized-fetch extension (assertion + grants + gated
  manifest), keep "host reads plaintext," keep "E2E out of scope."
- **Option E (encrypt-to-published-keys)** — a "restricted" item is an ordinary signed item whose
  content is a JWE envelope wrapped to the audience's published X25519 keys. Host serves ciphertext
  it can't read. Feed stays world-readable, CORS-`*`, statically hostable.
- **E-only** — Option E *replaces* the extension; existence/bandwidth become an operational note.
- **E-complement** — ship both (encryption + a thin audience-control gate).

Here is why the owner's criterion (*one concept that naturally scales up*) is decisive rather than
decorative:

- **Authorized-fetch does not scale as one concept.** At single-hub it is pure overkill (a login wall
  suffices). Its machinery — fetch assertions, grants, gated manifest, `401`s, replay cache — *only*
  earns its keep cross-hub. It is a **second mechanism switched on for one topology.** Even fully
  slimmed, it remains "the thing you turn on when you go cross-hub."
- **Encryption-as-content-encoding IS one concept that scales trivially.** An encrypted item is *just
  an item* — same signing, `_feed_url`, manifest, tombstones. **Single-hub, cross-hub, and dumb-CDN
  are identical**: the host always just serves signed bytes it may or may not be able to read. "Who
  can read this" is a property of the *item's recipient list*, not of the *serving path*. There is no
  "restricted mode" to enter.

So the owner's stated criterion, followed honestly, favors **E-forward** and points past
E-complement toward **E-only** (E-complement keeps exactly the "second mechanism for one topology"
the criterion rejects). Five passes reached E-forward by a different road (pass 5's per-hop analysis);
the owner's criterion is an independent argument for the same destination.

**This is also the strongest thing you (fresh agent) should attack.** See §5.

---

## 3. The empirical turn: two prototypes, what they proved, what they exposed

The owner required working code before committing. Both scripts reuse the *exact* canonicalizer and
`sign()`/`verify()` from `tmp/regen.js`, and use JWE JSON Serialization, `alg:ECDH-ES+A256KW`,
`enc:A256GCM`, X25519 (RFC 8037). Full writeup in `ENCRYPTED-CONTENT-FINDINGS.md`.

### 3.1 Broadcast — `tmp/enc-prototype.js` (4/4 claims pass)

An encrypted item = an ordinary signed item, `content_text:""`, with an `_enc` JWE wrapped to two
recipients. Verified: (1) signs with construction #1 — **no new signing path**; (2) verifies with the
**unchanged** verifier — signer/host never touch plaintext; (3) an ordinary manifest commits the
ciphertext; (4) both recipients decrypt, a stranger is locked out, and untagged recipients (no `kid`)
hide *who* the audience is.

**Structural claim confirmed: encryption is a client-side content-encoding, not a new trust
construction.** The one-signing-construction invariant is untouched (JWE is *encryption*; the item is
still a plain JWS over the encrypted bytes).

**Two corrections to the five-pass hype (both real):**
- **"Two additive hooks, zero core-text change" is oversold.** The passes claimed an X25519 enc key
  slides in free under §4.1's "ignore unrecognized `crv`" clause. That clause only buys
  *backward-compatibility* (an old verifier won't choke); it does **not** *define* the key. The §4.1
  table says `crv` MUST be `Ed25519` and `use` ∈ {sig, recovery}, so specifying an enc key is a real
  **edit to §4.1** plus **one sentence in §7**. Two *small additive edits*, not an untouched core.
- **Metadata stays cleartext by design:** `id`, `date_published`, `_feed_url`, `authors`, `_version`.
  Only content is opaque. Encryption hides *what* you said, not *that/when* you posted or *in reply to
  what*. It therefore does **not** serve a "hide the feed's existence" persona (see Q2).

### 3.2 Circles / encrypted interaction — `tmp/circles-prototype.js` (12/12 checks pass)

This is the part broadcast couldn't do and the passes disagreed on. Roster = a **chained, signed,
encrypted** document: the owner wraps the member list `[{identity, x25519}]` to each member's
published X25519 key, versioned `seq`/`prev`. Verified:
- roster is an encrypted signed doc — members decrypt, non-members locked out (**no chicken-and-egg**:
  same trial-decrypt as a post; owner wraps to *published* keys);
- **a reader learns the audience from the roster and wraps a reply the whole audience reads** — the
  capability broadcast lacked;
- churn is coherent: a member added at v2 can't read a v1 reply (no history access); a member removed
  at v3 can't read v3 content but keeps the v1 content already fetched (no retroactive revoke —
  *identical to the §2 "readers can re-share" concession*);
- **roster rollback is detectable** (host serving stale v2 to re-add a removed member is rejected —
  because the roster is a chain, same pin-and-walk as identity/manifest).

**Verdict: circles are pass-5's "shippable v2," not pass-4's "research frontier."** They reuse pieces
already on the table (encrypt-to-published-keys + a chained/pinned doc).

**Three residual limits the code exposed (name them; do not let the extension pretend they're solved):**
1. **Roster-freshness race (genuinely new — no prior pass named it).** A replier wraps to *their*
   current roster version. If the owner removed Dad at v3 but the replier still holds v2, the reply
   includes Dad. Rollback detection does **not** catch this — the replier honestly holds a
   stale-but-valid pin. A just-removed member can catch in-flight replies during the propagation
   window. Eventual-consistency tax of any no-PFS group; bounded, but must be stated. **Is this
   acceptable, or does it need a mechanism (e.g. wrap to `roster.seq ≥ N`, or an owner-re-encrypt
   sweep)? — Q4.**
2. **Enc-key ↔ identity binding is mandatory wiring.** Each member's X25519 key MUST be the
   `use:"enc"` key in *their own published identity document*, so a replier can cross-check a roster
   entry against the member's identity doc — else the owner could substitute a key it controls. Not
   optional; a required integration point.
3. **No forward secrecy.** Compromise of a member's long-term X25519 key decrypts all past ciphertext
   wrapped to it. Standard no-PFS limitation; disclose it.

### 3.3 The key-custody boundary (pass 4 claim / pass 5 correction), now concrete

Encryption is confidential against **every party except (1) the plaintext's author and (2) a holder of
a recipient's private enc key.** The author needs no secret to encrypt (they encrypt to recipients'
*public* keys), so the author's own key custody is irrelevant. For the family-hub product: encryption
protects your content on the CDN, the network, and **every other family's hub** — even for hub-managed
users. It is "theater" against exactly one hop — **your own authoring hub, for your own posts** (which
it wrote, so it holds the plaintext regardless). This is the honest scope. See Q3.

---

## 4. What's decided vs. open (the map for a fresh agent)

**Decided (owner-confirmed):** the cohesion spine (§1, with P1/A1/A2 gated on the fork); D2
optional-default; bearer tokens dead; prototype-before-commit.

**Open (the owner explicitly wants fresh, skeptical eyes here):** the restricted/private fork — how
far to go on encryption, and whether to reverse "E2E out of scope" at all.

---

## 5. Open questions, clarified — attack these

**Q1 — Steelman the NO on encryption (the owner's actual hesitation).** The whole project brand is
"minimal surface, builds only on existing standards, E2E explicitly out of scope." Option E adds:
X25519 key lifecycles, multi-recipient JWE, roster/circle distribution, the freshness race, and
forward-secrecy caveats. **Does encryption *reduce* complexity or merely *relocate* it** — out of the
serving path and into client-side crypto + key management? For the spec's *trust core* it's a
simplification (dumb host, public ciphertext); for the *implementer* it may not be. Make the strongest
case that the honest move is **slim-only** (keep authorized-fetch, keep E2E out of scope) and that the
"one concept scales" elegance is not worth reversing a deliberate scope boundary. If this case is
strong, the prototypes are a nice research spike and nothing more.

**Q2 — E-only vs E-complement hinges on one unfound persona.** After encryption exists, host-gated
audience control's *only* unique remaining jobs are **feed-existence/metadata privacy** (hide *that*
the feed exists / its cadence — which encryption does NOT provide) and **host-trusted *unencrypted*
cross-hub audiences** (large media you won't encrypt, served to named identities on a hub you trust).
Is either a real family-scale requirement? Nobody has named the persona in six passes. If it's real →
E-complement (keep a thin gate). If not → E-only (existence/bandwidth become an operational note:
"serve the encrypted feed at an unguessable ≥128-bit capability URL; a host MAY keep a private
allowlist"). **Find the persona or confirm its absence.**

**Q3 — Is the key-custody boundary good enough for *this* product?** The family-journaling hub
(`DISTRIBUTION-MODEL.md`) has the hub *draft and sign* your entries — so for your *own* posts the hub
holds plaintext no matter what. Encryption's value is therefore specifically about protecting your
content *on other people's hubs* and about **inbound** content (keep your X25519 enc key client-side
and your own hub can't read what others send you, even while it signs your outbound posts). Is that
asymmetric guarantee ("protected against every host except the one that authored it") a *feature the
owner wants to sell*, or too subtle to be worth the machinery? This is the crux for the AI-consent
story: encryption turns "who can read this" from a policy promise into a wrap-list — but if the AI
companion is a wrapped recipient, its provider *can* read. Is "consent = membership in the wrap-list"
the right model, or does the hub-authors-your-entries reality collapse it?

**Q4 — The roster-freshness race (new, from the circles prototype).** Is "a just-removed member may
catch in-flight replies until repliers refresh the roster" acceptable at family scale, or does it need
a mechanism? Candidate mitigations to evaluate: (a) accept it (it equals the §2 re-share concession);
(b) repliers MUST fetch the current roster before replying and wrap to `seq ≥ their last-seen`;
(c) the owner periodically re-encrypts the live thread to the current roster. Does any of these avoid
reintroducing a shared secret or a synchronous coordination point?

**Q5 — Prove or refute the "two small additive edits" claim.** The prototypes suggest the core touch
is exactly (a) an X25519 `use:"enc"` key defined in §4.1 and (b) one §7 sentence that content MAY be a
JWE envelope in `_enc`. Audit the spec for a *third* touch: does anything in the manifest
(§9.4 invariants), canonical/copy (§7.5), migration (§3.4), or verification (§6.5) assume content is
cleartext or break on `content_text:""`? (I found none, but I built the prototype — you didn't.)

**Q6 — Migration × encryption (raised here for the first time).** Migration (§3.4) ends in **bulk
re-signing** the back catalog at the new feed. For encrypted items, does that also mean **re-wrapping**
to every past audience (whose rosters may have changed)? Re-signing preserves the *ciphertext*
unchanged (the signature is over the encrypted bytes, so `_feed_url` changes but `_enc` need not), so
migration should be *unaffected* — the re-signed item carries the same opaque `_enc`. Confirm this
holds and that a migrated encrypted item is still decryptable by its original audience.

**Q7 — D2 × manifest invariants.** With reactions manifest-exempt by default, re-check §9.4
invariant 1 ("an id, once in `items`, MUST appear in every later manifest") and the §7.5 liveness/
canonical-copy rule: a *retracted* like on a manifest-less activity feed can't be proven-deleted to a
poller (un-liking must flow through the inbox tombstone path). Is the spec text that lands D2 careful
about this, or does it create a soundness gap?

**Q8 — Did the empirical turn miss a *core* simplification?** Six passes now claim the core (minus the
spine's D1/D2 and the three-shape reframe) is minimal. Last chance to falsify. In particular: does
encryption's arrival make any *existing* core mechanism redundant (e.g. does "private messages = a
restricted feed of two" in the README FAQ collapse into "an encrypted item to an audience of one," and
does that ripple anywhere else)?

---

## 6. My recommendation (for the owner to weigh against your rebuttal)

Coming out of the prototypes, I lean: **lock the cohesion spine now** (it's fork-independent except
P1/A1/A2); **adopt E-forward, E-only** (broadcast + DM as v1, circles as an explicit v2 with the three
residual limits written in plainly); **demote existence/bandwidth to an operational note.** The
owner's north-star and the working code both point there, and no persona for the surviving gate has
appeared in six passes.

**But the owner is deliberately unsold, and rightly wants this challenged.** The single most valuable
thing you can do is Q1 — make the *best* case that reversing "E2E out of scope" is the wrong call and
that slim-only (or even the pass-6-unmentioned "login-wall + capability-URL, no extension at all") is
the honest minimal answer. If that case survives contact with the prototypes' evidence, encryption
stays a spike and the extension slims instead. If it doesn't, E-only is the destination and the next
artifact is `open-feed-encrypted-content.md` + test vectors folded into `tmp/regen.js`.

**Do not** treat the passing prototypes as a decision. They prove the mechanism *works*; they do not
prove it *belongs*. That last step is the owner's, and your rebuttal is the input they asked for.
