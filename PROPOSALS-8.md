# PROPOSALS-8.md — Eighth pass: the layer split — privacy is (mostly) not a protocol problem

> **Audience:** the agent who wrote `PROPOSALS-7.md`, and the owner. Read after the chain:
> `PROPOSALS.md` (P1–P6) · `PROPOSALS-2.md` (A1–A2, B, C, D1–D2) · `PROPOSALS-3.md` (three shapes,
> Option E) · `PROPOSALS-4.md` (JWE, key-custody caveat) · `PROPOSALS-5.md` (per-hop, E-only) ·
> `PROPOSALS-6.md` (the empirical turn: two prototypes) · `PROPOSALS-7.md` (**the skeptic's rebuttal**
> — the strongest pass; it killed E-only). Supporting: `open-feed-spec.md`, `DISTRIBUTION-MODEL.md`,
> `ENCRYPTED-CONTENT-FINDINGS.md`, `tmp/enc-prototype.js`, `tmp/circles-prototype.js`.
>
> **What's new here.** Between passes 7 and 8 the owner and I stopped debating the *spec* and looked at
> the *app*. That reframed everything. PROPOSALS-7 argued the fork is "E-only vs a thin gate (its §7.3
> config)." **I think both are still solving privacy at the wrong layer.** This pass (a) accepts 7's
> concrete findings (they're right), (b) turns 7's own skepticism onto 7's §7.3 recommendation as the
> owner asked, (c) introduces the consolidation the whole thread was circling: **separate the public
> transparency protocol from the private client layer, and privacy stops being a core-protocol problem
> almost entirely,** and (d) adversarially attacks my own proposal. Challenge everything.

## TL;DR

- **Concede to 7, fully, on facts:** the ciphertext-relay defect (real; my prototype has it), the
  per-hop confidentiality overclaim (wrong for the hub-managed default), the two personas (photos as
  cleartext static siblings; the metadata/reply graph), the unverifiable wrap-list, the enc-key
  lifecycle with no recovery, circles-are-v3-not-v2, D2-must-be-feed-level-and-couples-to-D1, and the
  seven-touch count. These stand. Verified against `DISTRIBUTION-MODEL.md` (hub-managed keys are the
  default, line 1267; the hub "can read everything," line 1180; photos are static siblings, 1140–1157).
- **But 7's §7.3 recommendation (encrypt content + gate blobs + capability-URL) is three mechanisms,
  not one,** and two of them fail 7's *own* tests (blob-gating is "a mechanism for one topology";
  capability-URL is a bearer credential — the thing pass-C was killed for). It's a pragmatic patchwork,
  not the consolidation the owner is chasing.
- **The consolidation: the trust layer authenticates *structure* and is *agnostic to content*.** Open
  Feed's job is signed, single-valued, public envelopes (id, author, `_feed_url`, `_rel`, `_version`,
  `_sig`, manifest-commitment). What fills the content-shaped hole — plaintext, HTML, or ciphertext —
  the protocol never needed to care. Privacy is a **client layer** over the same identities and keys,
  not a feature of the feed protocol. The core's *entire* contribution to privacy is **one optional
  additive key type.** Everything 7 audited as "core touches" is really **Layer-2** and belongs in a
  deferred, separately-prototyped `open-feed-encrypted-content.md`.
- **The radical simplification this licenses:** **delete the restricted-feeds extension outright**
  (not slim it), **delete conventions §5 self-commitments**, and add **nothing** to the core but the
  enc-key hook. No gated manifest, no fetch assertion (so **P1/A1 become moot — the assertion is
  deleted, not unified**), no revocation chain, no reader lists, no §7.3 gate. Privacy for the vulnerable
  cohort is served by **product architecture** (split custody + a private delivery channel), which the
  protocol already permits.
- **Split custody is the ergonomic key nobody stated:** the hub keeps the **signing** key (custodial,
  invisible, recoverable via the recovery key); the client holds **only the enc key.** Non-technical
  survivors manage one decryption key, identity/authorship survives device loss, and only *readability*
  is at risk — the least-bad failure mode, and a real softening of 7 §1.4.

| Item | Verdict |
|------|---------|
| 7's factual findings (relay, per-hop, personas, lifecycle, circles, D2, touch-count) | **Accepted** |
| 7's §7.3 config (E-complement: encrypt + gate + cap-URL) | **Rejected as the answer** — 3 mechanisms, 2 self-defeating (§2) |
| **Layer split** (public protocol / private client layer) | **[NEW] headline** (§3) |
| **Delete restricted-feeds + self-commitments; one enc-key hook** | **[NEW] the simplification** (§4) |
| **Split custody** (hub signs, client holds only enc key) | **[NEW]** ergonomic + failure-mode fix (§5) |
| Do-regardless spine | **Locked**, minus P1/A1 (now moot) (§6) |

---

## 1. Accepting PROPOSALS-7 (so we don't relitigate what's settled)

7 is the best pass in the series because it *falsified* instead of elaborating, and I verified its two
load-bearing facts against the repo. Treat all of this as decided:

- **Ciphertext-relay is a real MUST-fix.** The `_enc` blob isn't bound to its carrier; anyone can
  re-sign someone else's ciphertext under their own envelope and have an audience member decrypt it
  misattributed. The fix (the plaintext must self-attribute `id`/`author`/`_feed_url`, checked on
  decrypt) is correct — **and note it lives at the decrypting client, i.e. Layer 2, not the core
  verifier** (see §3; this actually *rescues* "no new core construction," contra 7's touch #7).
- **The per-hop "protects against every other family's hub" claim is wrong** for hub-managed
  recipients (their hub holds their enc key). Correct in `ENCRYPTED-CONTENT-FINDINGS.md` regardless of
  the fork: *encryption's value tracks how many recipients hold their own keys — a product variable.*
- **The personas are real** (photos, metadata graph) and they killed E-only. Accepted.
- **Enc-key lifecycle ≠ signing-key lifecycle; no decryption recovery** (7 §1.4). Accepted, and §5
  gives the least-bad mitigation.
- **Circles are v3 behind a second prototype** (withholding ≠ rollback; my prototype tested only
  rollback). Accepted.
- **D2 is feed-level and lands with D1** (7 §5). Accepted into the spine (§6).

I will not re-argue these. The disagreement is only about **what to build**, and it starts with 7's
own recommendation.

## 2. Turning 7's skepticism onto 7's §7.3 (as the owner requested)

7 stress-tested Option E ruthlessly and then proposed, almost in passing, its own answer: *encrypt
content + gate the attachment blobs + host the encrypted feed at a capability URL, delete everything
else.* Held to 7's own standards it doesn't survive:

- **It is three mechanisms, not "one concept."** Content encryption (Layer 2), blob authorization
  (host-side), and capability-URL hosting (operational). 7 §1.1 convicts encryption of being "a
  mechanism for one topology" — **blob-gating is exactly that**, host-side request-time authz that
  only exists cross-hoster. The criterion 7 wielded against §2 of PROPOSALS-6 cuts its own §7.3.
- **The capability URL is a bearer credential.** Pass C (bearer tokens) was killed — by 7's lineage —
  for reintroducing the shared secret the protocol abolished. A ≥128-bit unguessable URL *is* a bearer
  secret (in the path, in logs, in referrers). 7 waves this off because "with encryption a leaked URL
  leaks only metadata" — but that concedes the URL is protecting *metadata*, i.e. it's load-bearing
  for the very persona (7 §7.2) it was summoned to serve. You cannot both kill bearer tokens and crown
  capability URLs.
- **It doesn't actually give the cohort what they need** (next section): it leaves the *reply graph*
  public unless the whole feed is behind the capability URL, at which point you've lost the
  single-valued public gossip that was 7's entire stated prize (§1.1). §7.3 quietly trades away the
  prize to get metadata privacy and doesn't say so.

So 7 is right that E-only is dead and right about *why*, but its constructive answer is the same
"ship all of them" smell pass 1 (P2) diagnosed. There's a cleaner cut.

## 3. The consolidation: the trust layer is content-agnostic

Step back from crypto entirely. Look at what the core actually authenticates: a **signed envelope** —
`id`, `authors`, `_feed_url`, `_rel`, `_version`, `_sig`, and its manifest commitment. The *content*
is already polymorphic (`content_text`, `content_html`, `attachments`) and the trust layer treats it
as an opaque hole it commits to but never interprets. **Encryption is not a new feature; it is one
more content encoding the trust layer was always agnostic to.**

That reframes the whole fork as a **layer split**:

- **Layer 1 — Open Feed (unchanged): the public transparency protocol.** Signed, single-valued,
  world-readable envelopes; dumb-host-friendly; the manifest completeness proof; gossip and pin-walk.
  This is Open Feed's *distinctive* value — the thing ActivityPub and Nostr don't have — and it is
  **inherently public.** Do not contaminate it with audience-varying serving (that's what forced
  §8.2, self-commitments, gated manifests — all patches for making a public protocol pretend to be
  private).
- **Layer 2 — an optional client-side private layer.** Encrypted content, DMs, the vulnerable cohort.
  It **reuses Layer-1 identities and keys** but is otherwise the *client's* business: envelope format,
  wrapping, rosters, recovery, the relay-binding check — all Layer 2, enforced by the *decrypting
  client*, invisible to the Layer-1 verifier.

**What this does to 7's seven touches:** almost all of them evaporate *from the core* because they
were never Layer-1 concerns:

| 7's touch | Where it actually lives |
|---|---|
| Recipient-count DoS cap (#5) | **Layer 2** — only a trial-decrypting client cares; the core stores an opaque blob |
| Relay-binding verifier rule (#7) | **Layer 2** — the decrypting client checks self-attribution; core verifier untouched (**rescues "no new construction"**) |
| Enc-key lifecycle / rotation / no-recovery (#4) | **Layer 2** — see §5; the core neither verifies with nor reasons about the enc key |
| No-PFS, wrap-list-unauditable, §14.2 new row (#6) | **Layer 2** security-considerations doc |
| Tombstone must drop `_enc` (#3) | tiny **Layer-1** touch (one clause: `_enc` is a content field) |
| §4.1 admit `use:"enc"` X25519 key (#1) | the **one** real Layer-1 hook |
| §7.2 content MAY be an `_enc` payload (#2) | one Layer-1 sentence, format punted to Layer 2 |

**The core's entire contribution to privacy is one optional key type** (`use:"enc"`) plus a one-line
"content MAY be opaque `_enc`, tombstones drop it." Everything hard, unsolved, or dangerous (rosters,
recovery, the relay fix, the DoS cap, circles) is quarantined in a **deferred** Layer-2 doc that gets
its own prototype before it ships — so the relay-defect class of footgun can't reach anyone's archive
through the core.

**Bonus security win the split hands you for free:** because the enc key lives in the **chained**
identity document, a host that *substitutes* your published enc key forks the chain and is caught by
the same pin-and-walk as a signing-key swap. So enc keys inherit Layer-1 key transparency — a
**partial** answer to 7 §1.3 (substitution is detectable; wrap-to-wrong-audience still isn't, because
that happens client-side and is never published — state this honestly).

## 4. The radical simplification the split licenses

If privacy is Layer 2, then **Layer 1 needs no privacy machinery at all**, and the accumulated
apparatus is deletable rather than slimmable:

- **Delete the restricted-feeds extension entirely** (`open-feed-restricted-feeds.md`): fetch
  assertion, the `401`/`OpenFeed-Sig` dance, capability grants, gated manifest, grant-revocation
  chain, reader lists. Rewrite §11 from "here's the intended authorized-fetch design" to a short
  pointer: *"Restricted/private content is not a Layer-1 concern. Single-hub audience control is host
  authorization (software). Host-blind confidentiality is the OPTIONAL encrypted-content layer
  (`open-feed-encrypted-content.md`, deferred). Hiding a feed's existence is operational (serve it at
  an unguessable capability URL)."*
- **Delete conventions §5 (self-commitments)** and its vectors: they existed *only* to give public
  equivocation-detection to a feed whose existence should be private — solving a problem the layer
  split dissolves (a public feed is already single-valued; a private feed shouldn't be gossiped
  publicly at all — its small trusting audience does out-of-band pin compare, the honest §14.2-tier
  answer). The `pins` document un-overloads back to "observations of others."
- **Add to the core:** the single `use:"enc"` key hook + the one `_enc`-content clause. Nothing else.

**Net:** the protocol *shrinks* (a whole extension and a conventions section gone) while the vulnerable
cohort is served *better* (host-blind, not host-reads-everything) — because their privacy moved to the
layer that can actually deliver it. This is more deletion than E-only claimed and none of E-complement's
new gate.

## 5. Split custody — the ergonomic answer, and the least-bad failure mode

The reason the product defaults to hub-held keys is that non-technical users can't manage keys, and
the hub needs to sign-and-AI-draft. Split the two keys and both concerns survive:

- **Signing key: hub-custodial** (invisible, recoverable via the offline recovery key, §4.5). Grandma
  and the survivor manage nothing here; identity continuity is hub + recovery-key business as today.
- **Encryption key: client-only.** The one thing the user's device holds. The hub can sign-and-publish
  on their behalf but **cannot read** their private content.

Consequences:
- **Ergonomics:** the "institute it yourself" surface shrinks to a single decryption key the app can
  device-sync and back up transparently (passkey/keychain/social-recovery) — no PGP literacy.
- **Failure mode softens (answers 7 §1.4):** losing the enc key loses *readability*, not *identity*.
  The archive's *authorship and continuity* survive (hub + recovery key); only the ability to decrypt
  private content is lost — and for family **broadcast** even that is N-redundant (any co-recipient's
  key recovers shared content; §3-of-PROPOSALS-8-conversation). The irrecoverable case narrows to
  audience-of-one DMs, where the user already understands "lose the key, lose the message."
- **Collision to state loudly:** host-blind reading and **server-side AI are mutually exclusive on the
  same content.** So "make private" necessarily means "AI runs client-side (on-device or the client
  calls the model directly) for this content." That's coherent — and it makes the AI-consent story
  *cryptographic* (the provider sees a private entry iff the client sent it) instead of a hub policy
  promise. But it means encryption is never a global default; it's a per-entry/per-circle mode. The
  user's only action is a checkbox; the layering does the rest.

Split custody is a *product* pattern, but it has exactly one Layer-1 implication, already satisfied:
the `keys` array distinguishes `use` and permits different custody per key. Nothing to add.

## 6. The do-regardless spine, updated

Unchanged from six passes **except P1/A1 are now moot** (the fetch assertion is *deleted*, not
unified, so there is no second construction to fold in — the goal is reached by subtraction):

- **Three-shape frame** + membership-chain principle (the manifest is the feed's membership-chain).
  Now generalizes further: *Layer 1 authenticates envelopes; content is an opaque hole.* State once in
  core §1/§2.
- **A2** — one author-binding rule (`url`; items use `authors[0].url`). (The `iss` third case vanishes
  with the assertion, simplifying A2 rather than requiring it.)
- **D1 + D2 together, feed-level** — one `feeds` array `{url, manifest?, rel}` with **`manifest`
  OPTIONAL** (7 §5); content-less-relation feeds are manifest-exempt as a *type* distinction;
  `rel:"primary"` authoritative. Closes F4.
- **One token-vocabulary rule.**
- **Bearer tokens: dead.** (And capability-URLs are *operational*, never a Layer-1 mechanism — §2.)

**Do regardless of the fork:** fix the ciphertext-relay defect in `tmp/enc-prototype.js` and re-run
(it's a Layer-2 rule, but the prototype should demonstrate the fix); correct the per-hop and
touch-count claims in `ENCRYPTED-CONTENT-FINDINGS.md`.

## 7. Attacking my own proposal (the part 7 would write)

- **"Content-agnostic trust layer" is too clean by half.** The core *does* peek at content today:
  §8's relevance check reads `_rel` to route inbox items; the README renders `content_html`; §7.4
  hashes attachments. So the layer isn't perfectly agnostic — `_rel` in particular must stay cleartext
  for threading/inbox to work, which is *exactly* the metadata-graph leak (7 §7.2). **The layer split
  does not solve metadata privacy** — it relocates it to "keep private items off the public feed
  entirely (private delivery channel), so there's no public `_rel` to leak." Is a private *channel*
  (inbox-delivered or capability-URL) rich enough for the cohort's threaded family conversations, or
  does keeping metadata private cost them the interaction model? **Genuine open question (Q1).**
- **Deferring Layer 2 might defer the cohort indefinitely.** "Privacy is a deferred optional layer"
  can become "privacy never ships." If the vulnerable cohort is a real v1 commitment, a *deferred*
  layer is a broken promise. The honest counter: the cohort's v1 need is **single-hub host-side**
  (authz + at-rest + split-custody), which needs no Layer-2 spec at all — only cross-hub host-blind
  does. So "defer Layer 2" ≠ "defer the cohort," **if** single-hub is an acceptable v1 boundary for
  them (Q2).
- **One enc-key hook still commits the core to a direction.** Publishing a `use:"enc"` key in the
  identity doc *is* a normative statement that encrypted content is coming, with lifecycle questions
  (7 §1.4) the core now can't fully punt (an enc key that's rotated/revoked/lost still needs *some*
  documented core semantics, even if "the core ignores it"). Is "the core stores it and ascribes it no
  meaning" actually coherent, or does an unverifiable, never-checked key in a signed transparency
  document invite exactly the "unauditable" critique (7 §1.3) at Layer 1? (Q3.)
- **Blob privacy is unaddressed here too.** I criticized 7's blob-gating but the photos persona is
  real and the layer split doesn't magically encrypt a JPEG. Under my model, private photos are
  Layer-2 encrypted attachments (opaque blobs at a URL) — which needs streaming AEAD and kills CDN
  thumbnails just as much. I've relocated the blob problem to Layer 2, not solved it (Q4).

## 8. Open questions for the reviewer

1. **Is a private *delivery channel* (no public `_rel`) rich enough for the cohort**, or do they need
   threaded family interaction that forces metadata onto a public feed? This decides whether the layer
   split actually serves them or just relocates the leak.
2. **Is single-hub an acceptable v1 boundary for the vulnerable cohort?** If yes, they ship in v1 on
   software alone and Layer 2 is a clean defer. If their safety *requires* distrusting their own hub,
   Layer 2 is v1-critical and "defer" is a broken promise.
3. **Can the core coherently carry an enc key it never uses?** Or does an unverifiable key in a signed
   transparency doc reintroduce 7 §1.3's unauditability *inside Layer 1*? Specify the minimal core
   semantics for a `use:"enc"` key (my claim: "listed, chain-transparent for substitution-detection,
   otherwise opaque; all lifecycle in Layer 2" — verify that's sound).
4. **Blobs.** Is there any answer to encrypted attachments that isn't "streaming AEAD + no server
   thumbnails"? If not, private photos are a heavy Layer-2 item and the cohort's *flagship* content is
   the hardest part — bounding v1 to text may be necessary.
5. **Did the layer split miss a Layer-1 simplification** now that privacy is gone from the core? E.g.
   does deleting restricted-feeds + self-commitments let the `replies` endpoint, the `follows`/`pins`
   split, or the two history docs consolidate further? (I claim no, but the surface just changed.)
6. **Is "delete the restricted-feeds extension" too aggressive** — is there a real cross-hop
   *host-trusted, unencrypted* audience (large public-ish media served only to named identities) that
   genuinely wants authorized-fetch and can't use encryption or a capability URL? Nobody has named it
   in eight passes; last chance.

## 9. Recommendation

1. **Lock the spine** (§6): three-shape/content-agnostic framing, A2, D1+D2 feed-level, token rule.
   P1/A1 retired as moot.
2. **Adopt the layer split.** Reframe §11, **delete the restricted-feeds extension and conventions
   §5**, add the single `use:"enc"` core hook + the one `_enc`-content clause. Privacy is Layer 2.
3. **Serve the cohort via product architecture** (split custody + a private delivery channel), which
   Layer 1 already permits — targeting single-hub for v1 (pending Q2).
4. **Defer `open-feed-encrypted-content.md`** (Layer 2): envelope format, relay-binding, rosters,
   recovery, DoS cap, blobs — with its own prototype before it ships. Fix the relay defect in the
   existing prototype now as a down payment.
5. **Do-regardless corrections:** the per-hop and touch-count claims in the findings doc.

**What would change my mind:** Q1 answered "the cohort needs public threaded interaction" (then
metadata can't be hidden by a channel, and 7's capability-URL-whole-feed is back on the table), or Q2
answered "they must distrust their own hub in v1" (then Layer 2 is v1-critical, not deferrable). Both
are the owner's calls — but they're now *small, named* calls, not "is E2E worth it," which is the
progress of this pass.
