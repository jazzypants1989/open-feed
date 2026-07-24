# Hand-off: Open Feed extensions & open questions

> Paste this whole file to a fresh agent as its opening prompt. It is written to be
> self-contained. The human (repo owner) will work **with** you — this is collaborative,
> not fire-and-forget.

---

You are picking up the **Open Feed Protocol** in `/Users/jessepence/repos/open-feed`. The core spec is frozen at **v0.1.0** (`open-feed-spec.md`); `README.md`, `DISTRIBUTION-MODEL.md`, and `CLAUDE.md` match it. `tmp/regen.js` regenerates and self-verifies **all** the test vectors — core **Appendix D**, restricted-feeds **Appendix R**, and conventions **Appendix C**. **Two extensions are now drafted:** restricted feeds (`open-feed-restricted-feeds.md` v0.1.0) and the follows/pins conventions (`open-feed-conventions.md` v0.1.0). Your job is to work through the **remaining documents and open questions** the spec defers — **and to skeptically re-examine everything already proposed or drafted, including this hand-off itself** — collaboratively with the owner.

## Your mandate — question everything (read before Step 0)

This hand-off is a set of *suggestions*, not a spec of your work. Treat it — the two drafted extensions, and every design call recorded below — with **active skepticism**. The owner has explicitly asked that you:

- **Challenge the suggestions.** For each backlog item and each decision already made, ask: is this actually right? What did it miss? Where does it conflict with another part of the system? Is there a simpler, safer, or more *innovative* alternative? A well-argued "the hand-off is wrong here" is a better outcome than faithfully implementing a flaw.
- **Hunt for missed connections.** These documents interlock (two chains + one pin-and-walk discipline, one object model, one signing construction, the honest trust model, `_feed_url` canonical/copy, migration=recovery). Look for places where a proposal in one doc has unnoticed consequences in another — or where two open questions share one answer. (Example already found and shipped: the conventions doc's **self-commitments** turned out to be the fix for the restricted-feeds §8.2 cross-reader-equivocation gap — pins and §8.2 were the same problem.)
- **Surface issues and improvements in what's already written**, both extensions included. Re-run and re-derive their vectors, stress their threat models, look for gaps or overclaims. "Signed off" does **not** mean "correct."
- **Ask the owner as many questions as you like — including ones this hand-off never raises.** The owner *wants* questions: clarifying, challenging, or entirely off-script (naming, philosophy, scope, threat model, whether an item belongs at all). Do **not** ration them or default to guessing when a call is genuinely the owner's. Propose, then write — but question first, and keep questioning throughout.

The invariants below are the one thing not to discard casually — but even those are open to challenge if you have a real argument; just flag an invariant-level change loudly and get the owner's explicit buy-in.

## Step 0 — Orient before doing anything

1. Read `open-feed-spec.md` in full, then `open-feed-restricted-feeds.md`, `open-feed-conventions.md`, and `CLAUDE.md`. Skim `README.md` and `DISTRIBUTION-MODEL.md`.
2. Run `node tmp/regen.js` and confirm **all** vectors self-verify: core (item, both manifests, both identity docs), restricted-feeds (R.1 assertion / R.2 grant / R.3 gated manifest), and conventions (C.1 observer pins / C.2 self-commitment / C.3 follows). That's your signing/canonicalization reference implementation.
3. **Skeptically review both drafted extensions** against the core and the invariants before moving on. The conventions doc is the freshest surface (see its checklist under P1 below); the restricted-feeds extension still has two known-open holes (F2/F3, under P0). Bring anything you find to the owner.
4. Do **not** start drafting the next doc. First confirm priority order with the owner (a default order is below), then for the chosen work present a short **design proposal** — surfacing the decisions listed *and* any you think were missed — and get the owner's calls **before** writing normative text. Propose, then write. Iterate.

## Invariants you MUST NOT break (these are why the design is good)

- **One signing construction in the core.** Detached JWS, RFC 7797 unencoded payload (`b64:false`, `crit:["b64"]`), Ed25519, over RFC 8785 canonical bytes, signing header **and** payload. The restricted-feed fetch assertion (an *encoded* JWT) is the **only** sanctioned second construction and it lives in an **extension**, never the core. The conventions doc (follows/pins/self-commitments) reuses construction #1 unchanged. **Delegation must reuse construction #1** — it adds a key-resolution step, not new crypto. Do not introduce a third construction anywhere.
- **One object model.** Everything publishable is a signed JSON Feed item; interactions are items carrying `_rel`. Don't reintroduce standalone interaction objects.
- **Byte-exact signing.** No verify-time Unicode normalization (producers emit NFC); reject duplicate JSON keys (I-JSON). Item `authors` is a single signed entry; `_feed_url` drives canonical-vs-copy.
- **Two chains, one pin-and-walk discipline.** Identity document (§5) and manifest (§9) are both hash-chained, retain+serve history, and are pinned TOFU. Anything you add that needs tamper-evidence should reuse this discipline, not invent another. (Pins documents that carry self-commitments are RECOMMENDED to reuse it too — conventions §3.3.)
- **Honest, family-scale-first trust model** (§14.2). Audience control ≠ confidentiality. Static-hosting (Level 0–2) must keep working. Extensions must not force core changes; if one does, that's a spec change to call out explicitly.
- **Every normative document** uses RFC 2119 keywords and ships **reproducible, self-verifying test vectors** (extend `tmp/regen.js`; never hand-write a signature or hash).

## Definition of done for any new document

- Consistent with the spec's model, terminology, and section-numbering conventions; cross-references resolve.
- Test vectors added to `tmp/regen.js` and self-verifying; any `_sig`/hash in the doc is reproduced by the script.
- When a planned doc graduates from stub to real: update the spec's forward-reference (e.g. §11, Appendix G/H) from "planned — not yet drafted" to a real link, and update `CLAUDE.md`'s file-structure table and "Open Questions" list. **Also sweep `README.md` for stale "planned/not yet drafted" language** (this was missed for restricted-feeds and had to be cleaned up later — don't repeat it).
- Owner has signed off on the design decisions before normative text was written.
- Do not commit unless the owner asks; when they do, follow the repo's commit-message trailer convention (see prior commits).

---

## The backlog (updated priority order)

### P0 — Patch the restricted-feeds extension: F2 + F3 (known-open correctness gaps)

The restricted-feeds extension is drafted, but a skeptical review surfaced two real holes that were **logged, not fixed** (see `CLAUDE.md` Open Questions). These are the most concrete immediate work — F2 is a genuine correctness gap, not a nitpick. Bring a design proposal, then patch the extension + vectors.

- **F2 — existence-private mode (§9) quietly breaks two features.**
  - *Manifest authorization + discovery.* §6.2 says a grant authorizes "that feed's manifest at the sibling manifest URL **the identity document lists**." But existence-private mode (§9) omits the feed *and its manifest* from the identity document — so (a) the authorization rule points at a mapping that isn't there, and (b) the reader has no specified way to even **learn** the manifest URL (the grant names only `feed`). Likely fix: let the grant name the manifest explicitly (or carry the mapping), and/or define the host's own feed→manifest routing as the authority instead of the identity doc.
  - *Fast revocation.* `_grant_revocations` naming `(grant, feed, iat)` in the public identity document leaks the feed URL and a former reader — contradicting existence-private. So "fast revocation" and "existence-private" are **mutually exclusive** as written, and that isn't stated. (The conventions doc §5.3 now frames the general "existence-private forgoes public mechanisms" tradeoff triangle — F3's fix should slot into that framing.)
- **F3 — where `_grant_revocations` lives is an unmade decision.** If it's a signed field in the identity doc (tamper-evident — good), every revocation **advances the identity chain**, contradicting "the identity chain versions identity state, advances rarely, stays 5–20 versions over a lifetime" (§5, §3.2). If it's a loosely-referenced side document, it's not chained and a host can drop it. Decide revocation-as-identity-op vs revocation-as-content-op explicitly. (Consider: a *chained* side document, same discipline as a manifest — parallels the conventions §3.3 chained-pins choice.)

**Also worth a skeptical pass while you're in there** (from the original P0 checklist, still unverified): is the grant model sound against confused-deputy / grant-reuse-across-feeds? Is `feed`→manifest authorization too loose? Should `scope` be defined now rather than reserved? Does the encoded JWT risk cross-protocol confusion with the core detached-JWS (are the `typ`/header differences enough)? Are the CORS / `Cache-Control: private, no-store` rules complete for the browser-reader story?

### P1 — Skeptically review the just-drafted conventions doc (`open-feed-conventions.md`)

Freshest surface; most likely place to find a new real problem. Try to break it:

- **§4.1 compare rule soundness.** "Same `(url, seq)`, different `hash` ⇒ equivocation." Check for false positives — e.g. how does it interact with a **legitimate** fork resolved by `_recovery_sig` (§5.5), where two branches carry the same `seq` with different hashes *by design* after key theft? (That's a real fork and flagging it is arguably correct — but the doc should say so.) Any other case where one `seq` legitimately maps to two byte strings?
- **Self-commitment (§5) — does it *really* reduce restricted-feed equivocation to public-feed equivocation?** Stress the claim that a key-custodian host must "publish two conflicting public commitments." A host can equivocate on *any* document across readers, including the public commitment doc itself (by IP/fingerprint). The argument's honesty rests on the commitment doc being world-readable/gossipable so aggregators catch the fork — i.e. it inherits *exactly* public-feed transparency, no more. Verify the doc doesn't overclaim beyond that, and that the "chained commitment log" requirement (§3.3, §5.2) actually closes the rollback-of-commitments hole. Consider adding a **chained** commitment vector (C.2 is currently unchained).
- **Missed connections.** Self-commitments interlock with delegation (P2 below): should a delegate key be allowed to sign pins/commitments, and does that belong in the delegation `scope` vocabulary? Does anything in the conventions doc force a core change? (It shouldn't — it reuses the existing §3.2 `follows`/`pins` fields; verify.)
- **Does the doc's privacy accounting hold?** `observed` leaks online times; follows leaks the reading graph; commitments leak restricted-feed cadence. All stated — check nothing else leaks that isn't called out.

### P1 — `open-feed-delegation.md` (moves hub deployments off the key-custodian tier)

**Problem.** Let a hub or extra device hold a scoped, revocable **delegated** key while the root key stays offline/client-side. Appendix H has the core idea; the mechanics need pinning down. This is the top remaining *new-document* item.

**Design space / ameliorations:**
- **Location = identity document.** Delegations live *in* `openfeed.json` (e.g. a `delegations` array), so the identity chain is the authoritative revocation ledger — the exact substrate NIP-26 lacked. Revoking = an ordinary chain version. (Note the tension with "identity chain stays short" — same shape as F3; the answer should be consistent across both.)
- **Resolution.** A delegate signs with construction #1; its `kid` resolves to the delegation entry in the pinned identity doc (define precedence vs `keys`). Verifier confirms the delegation is unexpired (`exp`) and unrevoked at the content's effective signing time.
- **Scope — the load-bearing safety design.** A delegate MUST be allowed to sign **items and manifests**, and MUST be **forbidden from advancing the identity chain or acting as a continuity/recovery key** (else a leaked delegate rewrites identity or keys). Define the `scope` vocabulary (feed-scoped, interactions-only, all-content, …) and the hard prohibitions. Recovery/migration remain root-only. **Also decide:** may a delegate sign a `pins`/self-commitment document (conventions §5)? — this ties scope to the freshly-drafted conventions doc.
- **Multi-device** falls out: one delegation per device; lose a device → revoke that one delegation via a chain version.

**Decisions to bring to the owner:** the `scope` vocabulary and defaults; whether a delegate may publish the manifest (almost certainly yes) and pins/commitments; precedence/ID rules when a `kid` could match both `keys` and `delegations`.

### P2 — Small spec gaps (fold into the spec, not new docs)

- **Activity-feed discovery.** Nothing in `feeds` (§3.2) marks *which* additional feed is the activity feed; an implementer had to invent a filename. Add an optional marker (e.g. a `"rel": "activity"` on the `feeds` entry) or a documented convention. **(Confirmed real during review — F4.)**
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
- **ActivityPub / atproto bridge profiles** — heavier; the convergence seams are FEP-8b32 (`eddsa-jcs-2022`, same primitive) for AP and did:web ↔ Open Feed URL for atproto (Appendix F).
- **Conformance & schemas** — JSON Schemas per document type; a conformance test harness; and hardening `tmp/regen.js` (its inline canonicalizer is a stand-in — a real implementation should use a vetted RFC 8785 library and cover the number/Unicode edge cases the old spec's Appendix F.6/F.7 enumerated).

---

## Suggested first move

Restricted-feeds (P0-original) and pins/follows (P1-original) are both **drafted**. The two strongest openings — let the owner pick, and ask freely:

1. **Patch F2/F3 into the restricted-feeds extension** (P0 above). F2 is a real correctness gap (existence-private mode breaks grant→manifest authorization and manifest discovery); F3 is an unmade placement decision for `_grant_revocations`. Both now have a cleaner frame to slot into, because the conventions doc §5.3 established the "existence-private forgoes public mechanisms" tradeoff triangle. Propose the fix, get sign-off, then patch doc + vectors.
2. **Draft `open-feed-delegation.md`** (P1 above) — the top remaining new document; moves hub deployments off the key-custodian tier. Present a design proposal (scope vocabulary, precedence, whether delegates may sign manifests and pins/commitments) before writing normative text.

A lighter third option: **skeptically review the just-drafted conventions doc** (P1 review checklist above) and bring the owner anything you find before starting new work.

Either way: **question first, propose second, write third — and ask the owner as many questions as you need, on or off the script above.**
