# Hand-off: Open Feed extensions & open questions

> Paste this whole file to a fresh agent as its opening prompt. It is written to be
> self-contained. The human (repo owner) will work **with** you — this is collaborative,
> not fire-and-forget.

---

You are picking up the **Open Feed Protocol** in `/Users/jessepence/repos/open-feed`. The core spec is frozen at **v0.1.0** (`open-feed-spec.md`); `README.md`, `DISTRIBUTION-MODEL.md`, and `CLAUDE.md` match it. `tmp/regen.js` regenerates and self-verifies the test vectors — core **Appendix D** *and* the restricted-feeds **Appendix R**. The first extension, **restricted feeds** (`open-feed-restricted-feeds.md` v0.1.0), is now drafted (see the P0 entry below for what was decided). Your job is to work through the **remaining documents and open questions** the spec defers — **and to skeptically re-examine everything already proposed or drafted, including this hand-off itself** — collaboratively with the owner.

## Your mandate — question everything (read before Step 0)

This hand-off is a set of *suggestions*, not a spec of your work. Treat it — the already-drafted restricted-feeds extension, and every design call recorded below — with **active skepticism**. The owner has explicitly asked that you:

- **Challenge the suggestions.** For each backlog item and each decision already made (including the restricted-feeds calls under P0), ask: is this actually right? What did it miss? Where does it conflict with another part of the system? Is there a simpler, safer, or more *innovative* alternative? A well-argued "the hand-off is wrong here" is a better outcome than faithfully implementing a flaw.
- **Hunt for missed connections.** These documents interlock (two chains + one pin-and-walk discipline, one object model, one signing construction, the honest trust model, `_feed_url` canonical/copy, migration=recovery). Look for places where a proposal in one doc has unnoticed consequences in another — or where two open questions actually share one answer.
- **Surface issues and improvements in what's already written**, the just-drafted restricted-feeds extension included. Re-run and re-derive its vectors, stress its threat model (esp. §8.2 cross-reader equivocation, the grant revocation story, the `htu`/replay bounds), look for gaps or overclaims. "Signed off" does **not** mean "correct."
- **Ask the owner as many questions as you like — including ones this hand-off never raises.** The owner *wants* questions: clarifying, challenging, or entirely off-script (naming, philosophy, scope, threat model, whether an item belongs at all). Do **not** ration them or default to guessing when a call is genuinely the owner's. Propose, then write — but question first, and keep questioning throughout.

The invariants below are the one thing not to discard casually — but even those are open to challenge if you have a real argument; just flag an invariant-level change loudly and get the owner's explicit buy-in.

## Step 0 — Orient before doing anything

1. Read `open-feed-spec.md` in full, then `open-feed-restricted-feeds.md` and `CLAUDE.md`. Skim `README.md` and `DISTRIBUTION-MODEL.md`.
2. Run `node tmp/regen.js` and confirm all vectors self-verify (item, both manifests, both identity docs, plus R.1 assertion / R.2 grant / R.3 gated manifest) — that's your signing/canonicalization reference implementation.
3. **Skeptically review the drafted restricted-feeds extension** against the core and the invariants before moving on — it's the freshest surface and the most likely place to find a real problem. Bring anything you find to the owner.
4. Do **not** start drafting the next doc. First confirm priority order with the owner (a default order is below), then for the chosen document present a short **design proposal** — surfacing the decisions listed under that item *and* any you think were missed — and get the owner's calls **before** writing normative text. Propose, then write. Iterate.

## Invariants you MUST NOT break (these are why the design is good)

- **One signing construction in the core.** Detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes, signing header **and** payload. The restricted-feed token (an *encoded* JWT) is the **only** sanctioned second construction and it lives in an **extension**, never the core. **Delegation must reuse construction #1** — it adds a key-resolution step, not new crypto. Do not introduce a third construction anywhere.
- **One object model.** Everything publishable is a signed JSON Feed item; interactions are items carrying `_rel`. Don't reintroduce standalone interaction objects.
- **Byte-exact signing.** No verify-time Unicode normalization (producers emit NFC); reject duplicate JSON keys (I-JSON). Item `authors` is a single signed entry; `_feed_url` drives canonical-vs-copy.
- **Two chains, one pin-and-walk discipline.** Identity document (§5) and manifest (§9) are both hash-chained, retain+serve history, and are pinned TOFU. Anything you add that needs tamper-evidence should reuse this discipline, not invent another.
- **Honest, family-scale-first trust model** (§14.2). Audience control ≠ confidentiality. Static-hosting (Level 0–2) must keep working. Extensions must not force core changes; if one does, that's a spec change to call out explicitly.
- **Every normative document** uses RFC 2119 keywords and ships **reproducible, self-verifying test vectors** (extend `tmp/regen.js`; never hand-write a signature or hash).

## Definition of done for any new document

- Consistent with the spec's model, terminology, and section-numbering conventions; cross-references resolve.
- Test vectors added to `tmp/regen.js` and self-verifying; any `_sig`/hash in the doc is reproduced by the script.
- When a planned doc graduates from stub to real: update the spec's forward-reference (e.g. §11, Appendix H) from "planned — not yet drafted" to a real link, and update `CLAUDE.md`'s file-structure table and "Open Questions" list.
- Owner has signed off on the design decisions before normative text was written.
- Do not commit unless the owner asks; when they do, follow the repo's commit-message trailer convention (see prior commits).

---

## The backlog (default priority order)

### P0 — `open-feed-restricted-feeds.md` — ✅ DRAFTED v0.1.0 (review it skeptically)

**Status: done, and the first thing you should try to break.** The extension is written, cross-referenced into the core (spec §11 now links it; `CLAUDE.md` file table + Open Questions updated), and its vectors self-verify in `tmp/regen.js` (Appendix R: R.1 assertion, R.2 grant, R.3 gated manifest).

**What was decided (with the owner):**
- **Fetch assertion** = the one sanctioned *second* signing construction (encoded EdDSA JWT, DPoP-modeled), quarantined to the extension. `htu` normalization recovered verbatim from git history (path byte-exact; do NOT apply the trailing-slash identity normalization). Bounds: `exp − iat ≤ 300s`, ≤60s skew each side, replay cache keyed `(iss, htu, jti)`. Cheap checks run before the outbound identity-doc fetch (SSRF/amplification discipline).
- **Authorization = capability grants (PRIMARY)** — an owner-issued, identity-bound, inbox-delivered **detached-JWS** document (core construction #1 reused, *not* a new construction). The host holds no audience list and is authorization-stateless; revoke by not-renewing (short `exp`) + optional `_grant_revocations`. This was chosen over the hand-off's original plaintext-`readers.json` plan specifically to avoid publishing the audience.
- **Fallbacks:** private server-side allowlist (interface-only); optional plaintext signed `readers` list *with a loud audience-leak warning*; unguessable **capability URLs** as the static-hosting tier. Hashed/Bloom reader lists are documented as a **rejected anti-pattern** (identity URLs are low-entropy → brute-forceable).
- **Limits stated plainly:** audience control ≠ confidentiality (host reads all); CDN caching of restricted responses unsafe; **cross-reader equivocation is NOT caught** (§8.2) — readers can't gossip restricted pins without leaking content.

**Skeptical-review checklist for the next agent (find the holes):**
- Is the **grant** model actually sound? Bearer-but-identity-bound — but scrutinize: grant + assertion presented together, is there a confused-deputy or grant-reuse-across-feeds path? Is `feed`→manifest authorization (a grant for the feed also covers its manifest) too loose? Should `scope` be defined now rather than reserved?
- **Revocation latency** rides on short `exp` + re-issuance. Is that operationally real for a static/low-power hub? Does `_grant_revocations` need to be in the *signed, chained* identity doc (tamper-evidence) rather than a loose field?
- **§8.2 cross-reader equivocation** — is the "out-of-band private pin comparison" mitigation honest, or hand-wavy? Any cryptographic way to give restricted feeds *some* transparency without leaking content (e.g. commitments to a private set)?
- Does introducing the **encoded JWT** anywhere risk cross-protocol confusion with the core detached-JWS (are the `typ`/header differences enough)? Re-check the "no third construction" invariant holds.
- Does the extension force **any** core change it didn't declare? (It shouldn't — verify.)
- Are the **CORS / `Cache-Control: private, no-store`** rules correct and complete for the browser-reader story?
- Innovative alternatives worth raising with the owner: macaroon-style attenuable grants? Per-reader manifest *witnessing* by a family peer? Something better than capability URLs for the static tier?

### P1 — `open-feed-delegation.md` (moves hub deployments off the key-custodian tier)

**Problem.** Let a hub or extra device hold a scoped, revocable **delegated** key while the root key stays offline/client-side. Appendix H has the core idea; the mechanics need pinning down.

**Design space / ameliorations:**
- **Location = identity document.** Delegations live *in* `openfeed.json` (e.g. a `delegations` array), so the identity chain is the authoritative revocation ledger — the exact substrate NIP-26 lacked. Revoking = an ordinary chain version. This is the whole point; don't put them in a side document.
- **Resolution.** A delegate signs with construction #1; its `kid` resolves to the delegation entry in the pinned identity doc (define precedence vs `keys`). Verifier confirms the delegation is unexpired (`exp`) and unrevoked at the content's effective signing time.
- **Scope — the load-bearing safety design.** A delegate MUST be allowed to sign **items and manifests**, and MUST be **forbidden from advancing the identity chain or acting as a continuity/recovery key** (else a leaked delegate rewrites identity or keys). Define the `scope` vocabulary (e.g. feed-scoped, interactions-only, all-content) and the hard prohibitions. Recovery/migration remain root-only.
- **Multi-device** falls out: one delegation per device; lose a device → revoke that one delegation via a chain version.

**Decisions to bring to the owner:** the `scope` vocabulary and defaults; whether a delegate may publish the manifest (needed for a hub to publish on the user's behalf — almost certainly yes); precedence/ID rules when a `kid` could match both `keys` and `delegations`.

### P1 — `pins` + `follows` conventions (highest value-per-byte; Appendix G)

**Problem.** Both are sketched but unspecified. `pins` is the family-scale substitute for a transparency log, DID directory, and timestamp authority all at once.

**Design space / ameliorations:**
- Fully specify the `pins` document: `(identity, seq, hash)` for identity docs *and* manifests; publication cadence; how a consumer *consumes* peers' pins to (1) cross-check chains for equivocation, (2) propagate recovery-based migrations, (3) get informal witnessed timestamps, (4) soften first-contact TOFU.
- **Privacy:** publishing pins/follows reveals your social graph and reading habits — document it; both MAY be kept client-local.
- Decide: one `open-feed-conventions.md`, or keep in the spec's Appendix G and just deepen it? (These are non-normative conventions, so a companion doc or an expanded appendix both work.)

**Decisions to bring to the owner:** companion doc vs expanded appendix; whether to define a minimal gossip/consumption algorithm or just the document format.

### P2 — Small spec gaps (fold into the spec, not new docs)

- **Activity-feed discovery.** Nothing in `feeds` (§3.2) marks *which* additional feed is the activity feed; an implementer had to invent a filename. Add an optional marker (e.g. a `"rel": "activity"` on the `feeds` entry) or a documented convention.
- **Checkpointing worked example.** §9.3 describes the mechanics abstractly; add a concrete worked example (with vectors) showing a checkpoint that prunes old `deleted` entries while preserving the anti-omission proof.

### P2 — `open-feed-webmention-bridge.md` (recover prior art)

**Problem.** Appendix F names Webmention as the cheapest bridge. Much of the design already exists in the superseded spec (git history, old §7.2).

**Design space / ameliorations:**
- **Recover the security rule verbatim from git history:** an unsigned source's claimed author identity URL (normalized, trailing slash intact) MUST be a **string prefix of the `source` URL** — same-origin is insufficient on shared/path-scoped hosts (`~dad` could impersonate `~mom`). This is the crux; don't reinvent it.
- Inbound: fetch source, parse mf2 (h-entry/h-card), synthesize an `_unverified` item with an appropriate `_rel`, route to moderation. Outbound: publish h-entry HTML, send Webmention on `_rel` targets that are external URLs.
- Everything ingested is `_unverified` (§7.5) and displayed distinctly. The gateway is a disclosed trusted intermediary, never a transparent adapter.

### P3 — Research / backlog (scope with the owner before investing)

- **`_rel` type registry governance** — likely a short `REGISTRY.md` + lightweight process; or defer to post-1.0 and lean on namespaced-URL types.
- **External time anchoring** beyond `pins` — options: an OpenTimestamps/RFC-3161 `_timestamp_proof` extension on manifests; a formal witness-network protocol (co-signed `(identity, seq, hash)` observations — essentially `pins` promoted to a gossip protocol). Genuinely research-grade; defer unless the owner wants it.
- **Signed export bundle** — archive format (identity history + feed + manifest + manifest history) for backup/migration; ties into the migration story (§3.4).
- **ActivityPub / atproto bridge profiles** — heavier; the convergence seams are FEP-8b32 (`eddsa-jcs-2022`, same primitive) for AP and did:web ↔ Open Feed URL for atproto (Appendix F).
- **Conformance & schemas** — JSON Schemas per document type; a conformance test harness; and hardening `tmp/regen.js` (its inline canonicalizer is a stand-in — a real implementation should use a vetted RFC 8785 library and cover the number/Unicode edge cases the old spec's Appendix F.6/F.7 enumerated).

---

## Suggested first move

Restricted-feeds (P0) is **done**. Two equally good openings — let the owner pick, and ask freely:

1. **Skeptically review the drafted restricted-feeds extension** (Step 0.3 + the P0 checklist above). Re-run its vectors, stress its threat model, bring the owner every issue, missed connection, or better idea you find. This is the freshest surface and the likeliest place to find a real problem.
2. **Move to the next document** — the remaining P1s are `open-feed-delegation.md` and the `pins`/`follows` conventions (the "highest value-per-byte" item, and one that interlocks with the restricted-feeds §8.2 equivocation gap — a possible missed connection worth raising). Confirm priority with the owner, then present a design proposal (surfacing the listed decisions *and* any you think were missed) before writing normative text.

Either way: **question first, propose second, write third — and ask the owner as many questions as you need, on or off the script below.**
