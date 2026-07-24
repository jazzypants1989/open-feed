# Hand-off: Open Feed extensions & open questions

> Paste this whole file to a fresh agent as its opening prompt. It is written to be
> self-contained. The human (repo owner) will work **with** you — this is collaborative,
> not fire-and-forget.

---

You are picking up the **Open Feed Protocol** in `/Users/jessepence/repos/open-feed`. The core spec is frozen at **v0.1.0** (`open-feed-spec.md`); `README.md`, `DISTRIBUTION-MODEL.md`, and `CLAUDE.md` match it. `tmp/regen.js` regenerates and self-verifies **all** the test vectors — core **Appendix D**, restricted-feeds **Appendix R**, and conventions **Appendix C**. **Two extensions are drafted:** restricted feeds (`open-feed-restricted-feeds.md` v0.1.0) and the follows/pins conventions (`open-feed-conventions.md` v0.1.0). **A skeptical-review pass landed nine fixes and two new vectors across both extensions, and a follow-up patch has since closed the two known-open correctness gaps (F2/F3) in the restricted-feeds extension** (see "What recent sessions did"). Your job is to work through the **remaining documents and open questions** the spec defers — **and to skeptically re-examine everything already proposed or drafted, including the fixes just made and this hand-off itself** — collaboratively with the owner.

## Your mandate — question everything (read before Step 0)

This hand-off is a set of *suggestions*, not a spec of your work. Treat it — the two drafted extensions, the fixes recorded below, and every design call — with **active skepticism**. The owner has explicitly asked that you:

- **Challenge the suggestions and the fixes.** For each backlog item, each decision already made, and each fix landed last session, ask: is this actually right? What did it miss? Where does it conflict with another part of the system? Is there a simpler, safer, or more *innovative* alternative? A well-argued "the hand-off is wrong here" — or "that fix is incomplete" — is a better outcome than faithfully implementing a flaw. The last session's fixes were **not** independently reviewed; they are exactly the kind of thing to re-derive.
- **Hunt for missed connections.** These documents interlock (two chains + one pin-and-walk discipline, one object model, one signing construction, the honest trust model, `_feed_url` canonical/copy, migration=recovery). Look for places where a proposal in one doc has unnoticed consequences in another — or where two open questions share one answer. (Examples already found: (1) the conventions doc's **self-commitments** turned out to be the fix for the restricted-feeds §8.2 cross-reader-equivocation gap; (2) last session found that a **hub-held delegate signing a self-commitment gives no cross-reader guarantee** — a live constraint the not-yet-written delegation doc must honor.)
- **Surface issues and improvements in what's already written**, both extensions included. Re-run and re-derive their vectors, stress their threat models, look for gaps or overclaims. "Signed off" does **not** mean "correct."
- **Ask the owner as many questions as you like — including ones this hand-off never raises.** The owner *wants* questions: clarifying, challenging, or entirely off-script (naming, philosophy, scope, threat model, whether an item belongs at all). Do **not** ration them or default to guessing when a call is genuinely the owner's. Propose, then write — but question first, and keep questioning throughout.

The invariants below are the one thing not to discard casually — but even those are open to challenge if you have a real argument; just flag an invariant-level change loudly and get the owner's explicit buy-in.

## Step 0 — Orient before doing anything

1. Read `open-feed-spec.md` in full, then `open-feed-restricted-feeds.md`, `open-feed-conventions.md`, and `CLAUDE.md`. Skim `README.md` and `DISTRIBUTION-MODEL.md`.
2. Run `node tmp/regen.js` and confirm **all** vectors self-verify: core (item, both manifests, both identity docs), restricted-feeds (R.1 assertion / R.2 grant / R.3 gated manifest / **R.3b chained gated manifest seq 2**), and conventions (C.1 observer pins / C.2 self-commitment / **C.2b chained commitment log seq 1→2** / C.3 follows). That's your signing/canonicalization reference implementation. The script also cross-checks that every canonical vector string printed matches what's embedded in the docs.
3. **Skeptically review both drafted extensions AND recent sessions' fixes** (the nine review fixes *and* the F2/F3 patch — all uncommitted, none independently verified) against the core and the invariants before moving on. Bring anything you find to the owner.
4. Do **not** start drafting the next doc. First confirm priority order with the owner (a default order is below), then for the chosen work present a short **design proposal** — surfacing the decisions listed *and* any you think were missed — and get the owner's calls **before** writing normative text. Propose, then write. Iterate.

## What recent sessions did (re-challenge freely)

Two waves of uncommitted work sit in the working tree. **None of it was independently verified — treat every item as a claim to re-derive, not a settled fact.** All changes are in `open-feed-restricted-feeds.md`, `open-feed-conventions.md`, `tmp/regen.js`, and the `.md` context files; nothing was committed until the commit that also introduced this note.

### Most recent — the F2/F3 patch (restricted-feeds)

The two known-open correctness gaps are now **closed** (they are *not* open work; do not re-implement them). Re-derive freely.

- **F2 — existence-private grant→manifest authorization + discovery.** Every grant now carries an explicit **`manifest` field** (restricted-feeds §6.2), so authorization and manifest-URL discovery no longer depend on a public identity-document `feed`→`manifest` mapping that existence-private mode (§9) omits. This also retired the imprecise "sibling manifest URL" derivation in existence-public mode. Grant-verification step 5 now resolves feed ownership via the public identity doc **or** the host's own private routing, and confirms `manifest` really is the manifest the host serves for `feed` (so a grantor can't bind an unrelated manifest). *Fast-revocation face:* the grant-revocation list is public-only and therefore **incompatible with existence-private** — folded into the conventions §5.3 tradeoff triangle.
- **F3 — `_grant_revocations` placement.** The old inline `_grant_revocations` array in the identity document is replaced by a **chained `grant_revocations` side-document** (restricted-feeds §6.2.2): manifest-§9 discipline (`seq`/`prev`/`history`, pin-and-walk by the enforcing host), referenced by URL from the identity doc, signed with core construction #1. So a revocation advances the *revocation* chain, not the identity chain (which must stay short). Consumed by the host at grant-verification step 6.
- **New vectors:** **R.4** (grant-revocation list genesis) and **R.4b** (`seq: 2`, chained); **R.2** regenerated to carry `manifest`. All self-verify in `tmp/regen.js`.
- **Consistency sweep done:** `CLAUDE.md` file-table/Open-Questions updated; conventions §5.3 triangle names the grant-revocation list. **Deferred within this patch:** `scope` still reserved (not defined); the CORS/browser-reader limitation (R-7) is still documented-only, not solved; the `_grant` carrier-item encoding is still under-specified with no vector (see the review backlog below).

### The skeptical-review pass (nine fixes + two vectors)

A skeptical review of both extensions surfaced ten findings; nine were fixed and landed (the tenth, F2/F3, became the patch above). **Not independently verified.**

**Correctness / security fixes:**
- **R-6** (restricted-feeds §6.2) — `scope` now **fails closed**: a host that doesn't recognize a *present* `scope` value MUST reject the grant. Previously it "ignored unrecognized scope conservatively (no broader than default)," which fails *open* — since scope only ever narrows, an old host would serve the whole feed to a reader a future narrowing-scope grant meant to restrict.
- **R-9** (restricted-feeds §6.2.1) — grant delivery fixed. A grant is **not** a JSON Feed item (no `id`/`authors`/`_feed_url`/`content_text`), so the old "the grant *is* the inbox item whose `_rel` references the reader" was impossible — the inbox (core §10.2) would reject it. Now the grant is delivered **inside a carrier item**: a signed item with a `_rel` mention of the reader carrying the grant bytes in a `_grant` field.
- **C-1** (conventions §5.2) — removed the overclaim that "delegated signing" keeps the commitment key off the serving host. A **hub-held** delegate does not: if one host can sign both the restricted manifest and its commitment, it can equivocate on both together. Only a key the serving host does not hold (client-side, or an off-host delegate) gives the self-commitment its external-check property. *This is the forward hook for the delegation doc.*
- **C-5** (conventions §5.1 + restricted-feeds §8.2) — named the **commitment-withholding evasion**: a key-custodian host can equivocate at `seq: N` and then simply never publish any commitment for `seq: N`, claiming perpetual "commitment lag," leaving §4.1 nothing to compare. The "reduces restricted-feed equivocation to public-feed equivocation" claim is now scoped to *versions the owner actually commits to*, with a reader detection rule (flag a served version that stays uncommitted while other versions of the same chain get committed).

**New vectors:**
- **C-3** — added restricted-manifest **R.3b** (`seq: 2`, chained to R.3) and a two-version chained **C.2b** commitment log, giving coverage to the conventions doc's own `SHOULD` that commitment logs be chained (§5.2). Demonstrates a reader walking `prev` to its pin to catch commitment rollback.

**Clarifications (low-risk doc text):**
- **C-2** (conventions §4.1) — the compare rule flags a legitimate post-theft §5.5 fork as same-`seq`/different-`hash`; added that this is correct (it *is* a fork) and that core §5.5 is how a consumer picks the honest (`_recovery_sig`) branch.
- **R-10** (restricted-feeds §9) — existence-private `404` equalizes status but not *timing*: an authenticated-but-unauthorized reader triggers the step-6 outbound fetch that an absent path skips. Note added; suggested equalizing timing against authenticated probers.
- **C-4** (conventions §2) — a published `follows` with `name` petnames leaks your private labels; called out.
- **R-7** (restricted-feeds §3) — a **browser** reader of a restricted feed is effectively same-origin-only (the `Authorization` header forces a preflight and `ACAO: *` is forbidden with credentials), dropping the core's zero-proxy browser-reader property. Server-to-server readers are unaffected. Documented.

**Checked and cleared (no change):** cross-protocol confusion between the fetch-assertion JWT and core detached-JWS (R-4: the `b64:false`+`crit` vs `typ` header differences and `header..sig` vs `header.payload.sig` structures don't collide); grant reuse across feeds/readers (R-5: bound to `grant`==`iss` and one `feed`). Re-challenge these too if you disagree.

## Invariants you MUST NOT break (these are why the design is good)

- **One signing construction in the core.** Detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes, signing header **and** payload. The restricted-feed fetch assertion (an *encoded* JWT) is the **only** sanctioned second construction and it lives in an **extension**, never the core. The conventions doc (follows/pins/self-commitments) reuses construction #1 unchanged. **Delegation must reuse construction #1** — it adds a key-resolution step, not new crypto. Do not introduce a third construction anywhere.
- **One object model.** Everything publishable is a signed JSON Feed item; interactions are items carrying `_rel`. Don't reintroduce standalone interaction objects. (Note the R-9 fix keeps this: a grant rides *inside* an item, it does not become a new inbox object type.)
- **Byte-exact signing.** No verify-time Unicode normalization (producers emit NFC); reject duplicate JSON keys (I-JSON). Item `authors` is a single signed entry; `_feed_url` drives canonical-vs-copy.
- **Two chains, one pin-and-walk discipline.** Identity document (§5) and manifest (§9) are both hash-chained, retain+serve history, and are pinned TOFU. Anything you add that needs tamper-evidence should reuse this discipline, not invent another. (Pins/commitment documents that carry self-commitments are RECOMMENDED to reuse it too — conventions §3.3; C.2b now demonstrates it.)
- **Honest, family-scale-first trust model** (§14.2). Audience control ≠ confidentiality. Static-hosting (Level 0–2) must keep working. Extensions must not force core changes; if one does, that's a spec change to call out explicitly.
- **Every normative document** uses RFC 2119 keywords and ships **reproducible, self-verifying test vectors** (extend `tmp/regen.js`; never hand-write a signature or hash).

## Definition of done for any new document

- Consistent with the spec's model, terminology, and section-numbering conventions; cross-references resolve. (Watch bare `§N.M` refs that actually live in a *different* doc — write "restricted-feeds §8.2", not "§8.2".)
- Test vectors added to `tmp/regen.js` and self-verifying; any `_sig`/hash in the doc is reproduced by the script (and the script cross-checks that the doc-embedded strings match — keep that passing).
- When a planned doc graduates from stub to real: update the spec's forward-reference (e.g. §11, Appendix G/H) from "planned — not yet drafted" to a real link, and update `CLAUDE.md`'s file-structure table and "Open Questions" list. **Also sweep `README.md` and `DISTRIBUTION-MODEL.md` for stale "planned/not yet drafted" language.**
- Owner has signed off on the design decisions before normative text was written.
- Do not commit unless the owner asks; when they do, follow the repo's commit-message trailer convention (see prior commits).

---

## The backlog (updated priority order)

> **F2/F3 are DONE** (the restricted-feeds patch above) — no longer a backlog item. Their residual, still-open pieces (`scope` still reserved, `_grant` encoding, CORS) live under the review item below, not here.

### P1 — `open-feed-delegation.md` (moves hub deployments off the key-custodian tier)

**The top remaining *new-document* item.** Let a hub or extra device hold a scoped, revocable **delegated** key while the root key stays offline/client-side. Appendix H has the core idea; the mechanics need pinning down.

**Design space / ameliorations:**
- **Location = identity document.** Delegations live *in* `openfeed.json` (e.g. a `delegations` array), so the identity chain is the authoritative revocation ledger — the substrate NIP-26 lacked. Revoking = an ordinary chain version. (Note the tension with "identity chain stays short" — same shape as F3; the answer should be consistent across both.)
- **Resolution.** A delegate signs with construction #1; its `kid` resolves to the delegation entry in the pinned identity doc (define precedence vs `keys`). Verifier confirms the delegation is unexpired (`exp`) and unrevoked at the content's effective signing time.
- **Scope — the load-bearing safety design.** A delegate MUST be allowed to sign **items and manifests**, and MUST be **forbidden from advancing the identity chain or acting as a continuity/recovery key** (else a leaked delegate rewrites identity or keys). Define the `scope` vocabulary (feed-scoped, interactions-only, all-content, …) and the hard prohibitions. Recovery/migration remain root-only.
- **⚠ Load-bearing decision — self-commitments (from last session's C-1).** May a delegate sign a `pins`/self-commitment document (conventions §5)? A hub-held delegate signing a self-commitment provides **no cross-reader equivocation guarantee** (the host controls both the manifest and the commitment — conventions §5.2 as amended). So the scope design should either forbid a hub-held delegate from signing self-commitments, or state loudly that a commitment so signed is worthless for its purpose. This ties the delegation `scope` vocabulary directly to the conventions doc — get it right or the two docs contradict.
- **Multi-device** falls out: one delegation per device; lose a device → revoke that one delegation via a chain version.

**Decisions to bring to the owner:** the `scope` vocabulary and defaults; whether a delegate may publish the manifest (almost certainly yes) and pins/commitments (see the ⚠ above); precedence/ID rules when a `kid` could match both `keys` and `delegations`.

### P1 — Finish/re-open the skeptical review of the conventions & restricted-feeds docs

Recent sessions covered a lot but not exhaustively, and their fixes (including the F2/F3 patch) are unreviewed. Worth a fresh pass if the owner prefers consolidating before new-doc work:
- Re-derive the **R-6 fail-closed** and **R-9 carrier-item** changes — are they complete and consistent with the rest of each doc?
- **`_grant` carrier-item encoding is under-specified and has no vector (from R-9).** Restricted-feeds §6.2.1 says the grant rides "in a `_grant` field" as "the grant's canonical bytes" but never says whether `_grant` is a **base64url string** of those bytes or a **nested JSON object**. It matters: the grant's `_sig` is byte-exact over its own canonical bytes, so a string is unambiguous while a nested object forces the reader to re-canonicalize (RFC 8785 is deterministic, so it works, but the requirement is unstated). No test vector exercises a carrier item. Recommend: specify base64url string (matches the `OpenFeed-Grant` header transport, §6.2) and add a carrier-item vector to `tmp/regen.js`. **Touches normative text — get owner sign-off.**
- **Two distinct "step 6"s in restricted-feeds (readability nit).** §5 step 6 = the outbound identity-document fetch; the §6.2 grant-variant's own sub-step 6 = the revocation-list check. Both are correct and §-qualified, but "grant-verification step 6" (§6.2.2) and "step-6 … (§5)" (§9) are easy to conflate. Optional: renumber the grant-variant sub-steps (e.g. 7a–7f) so only §5 owns a "step 6".
- **F2/F3 residuals still open** (deferred within that patch, not fixed): should **`scope` be *defined*** now rather than reserved (R-6 made it fail-closed but left it reserved)? Are the **CORS / `Cache-Control: private, no-store`** rules complete for the browser-reader story (R-7 documented the limitation, did not solve it)? Re-confirm grant soundness against **confused-deputy / grant-reuse-across-feeds** (last session cleared this as R-5 — recheck against the new explicit `manifest` binding at step 5).
- Stress the **C-5 withholding** rule: is the "flag a version uncommitted while others are committed" heuristic actually implementable/soundly-specified, or does it need a concrete staleness bound?
- Re-examine the **self-commitment ↔ delegation** interaction (C-1) end to end.
- **§4.1 compare-rule** other false positives beyond the recovery fork (C-2)?
- Does anything in either extension force a **core** change? (It shouldn't.)

### P2 — Small spec gaps (fold into the spec, not new docs)

- **Activity-feed discovery (F4, confirmed real).** Nothing in `feeds` (§3.2) marks *which* additional feed is the activity feed; an implementer had to invent a filename. Add an optional marker (e.g. a `"rel": "activity"` on the `feeds` entry) or a documented convention.
- **Checkpointing worked example.** §9.3 describes the mechanics abstractly; add a concrete worked example (with vectors) showing a checkpoint that prunes old `deleted` entries while preserving the anti-omission proof.

### P2 — `open-feed-webmention-bridge.md` (recover prior art)

**Problem.** Appendix F names Webmention as the cheapest bridge. Much of the design already exists in the superseded spec (git history, old §7.2).

**Design space / ameliorations:**
- **Recover the security rule verbatim from git history:** an unsigned source's claimed author identity URL (normalized, trailing slash intact) MUST be a **string prefix of the `source` URL** — same-origin is insufficient on shared/path-scoped hosts (`~dad` could impersonate `~mom`). This is the crux; don't reinvent it.
- Inbound: fetch source, parse mf2 (h-entry/h-card), synthesize an `_unverified` item with an appropriate `_rel`, route to moderation. Outbound: publish h-entry HTML, send Webmention on `_rel` targets that are external URLs.
- Everything ingested is `_unverified` (§7.5) and displayed distinctly. The gateway is a disclosed trusted intermediary, never a transparent adapter.

### P3 — Research / backlog (scope with the owner before investing)

- **`_rel` type registry governance** — likely a short `REGISTRY.md` + lightweight process; or defer to post-1.0 and lean on namespaced-URL types.
- **External time anchoring** beyond `pins` — the conventions doc's informal timestamping (§4.3) is the family-scale answer; a true witness network (co-signed `(url, seq, hash)` observations gossiped as a protocol — essentially `pins` promoted to a transport) is still genuinely research-grade. Defer unless the owner wants it.
- **Signed export bundle** — archive format (identity history + feed + manifest + manifest history) for backup/migration; ties into the migration story (§3.4).
- **ActivityPub / atproto bridge profiles** — heavier; convergence seams are FEP-8b32 (`eddsa-jcs-2022`, same primitive) for AP and did:web ↔ Open Feed URL for atproto (Appendix F).
- **Conformance & schemas** — JSON Schemas per document type; a conformance test harness; and hardening `tmp/regen.js` (its inline canonicalizer is a stand-in — a real implementation should use a vetted RFC 8785 library and cover the number/Unicode edge cases the old spec's Appendix F.6/F.7 enumerated).

---

## Suggested first move

Both extensions are **drafted and reviewed, and the F2/F3 gaps are patched** (all uncommitted-until-the-note-commit, all unverified). The two strongest openings — let the owner pick, and ask freely:

1. **Draft `open-feed-delegation.md`** (P1) — the top remaining new document; moves hub deployments off the key-custodian tier. Present a design proposal (scope vocabulary, precedence, whether delegates may sign manifests and — critically — pins/self-commitments, per the C-1 hook) before writing normative text.
2. **Consolidate: re-run the skeptical review** of both extensions and every recent fix (the nine review fixes *and* the F2/F3 patch), starting with the concrete residuals now logged under the P1 review item — the `_grant` encoding gap, the two-"step 6"s nit, and the still-reserved `scope`. Bring the owner anything you find before starting new-doc work.

A lighter third option: pick a **P2 spec gap** (activity-feed discovery F4, or the checkpointing worked example) — small, self-contained, and independent of the extensions.

Either way: **question first, propose second, write third — and ask the owner as many questions as you need, on or off the script above.**
