# PROPOSALS.md — Simplification pass (for peer review)

> **Audience:** the parallel agent (and the owner). The owner ran the same "look for
> simplification without sacrificing capability, big changes welcome" prompt in two
> sessions; this is one session's output, written to be **adversarially reviewed** by the
> other. Nothing here is committed or applied. Challenge every claim — especially the two
> that touch stated invariants (P1) and landed-but-unreviewed work (P3/P4).
>
> **How to review this:** for each proposal I give the claim, the argument, exactly what
> gets deleted, the capability trade, the blast radius across docs, my confidence, and
> explicit "where I might be wrong" prompts. Treat a well-argued rebuttal as the win.

## TL;DR

The **core spec is tight** — I found nothing there worth cutting (I examined the manifest and
kept it; see "Considered and rejected"). The complexity crept back into the **two extensions**,
and it compounds: restricted-feeds carries **four** authorization mechanisms and **two** discovery
modes, and cross-reader-equivocation detection for restricted feeds is an
extension-of-an-extension living in a *third* document (conventions §5) with a self-admitted
under-specified evasion rule.

The single highest-leverage change removes a whole *class* of complexity rather than a feature:

- **P1 — Delete the second signing construction.** Make the restricted-feed fetch assertion a
  construction-#1 signed document (like the capability grant already is), transported
  identically. The entire protocol — core + every extension — then has **exactly one signing
  construction and one verifier.** This *strengthens* the invariant the HANDOFF is proudest of.

Then a set of cuts, each of which also unlocks the next:

| # | Proposal | Deletes | Capability trade | Confidence |
|---|----------|---------|------------------|-----------|
| **P1** | Unify fetch assertion → construction #1 | 2nd construction, JWT format, cross-construction confusion analysis | none (DPoP interop already absent) | **High** |
| **P2** | Grants become the *only* real auth mechanism | reader list (§6.3) + allowlist-as-section (§6.1) | ~none (grants dominate reader lists) | **High** |
| **P3** | Cut the chained grant-revocation list | §6.2.2, `grant_revocations` endpoint, vectors R.4/R.4b | fast public revocation → private host denylist | **Med-High** |
| **P4** | Cut existence-private mode | §9 second mode, timing-attack section, grant `manifest` field (undoes F2) | hiding a feed's *existence* | **Medium** |
| **P5** | Cut self-commitments | conventions §5, C.2/C.2b, tradeoff triangle, withholding rule | in-band cross-reader equivocation detection for restricted feeds | **Medium** |
| **P6** | (Radical) reconsider whether restricted feeds belong at all | the whole extension, in favor of an operational note + deferred real-encryption ext | cross-hub authorized fetch | **Low / provocation** |

The cuts compound (see "Compounding effects"). P4 undoes the F2 patch; P5 removes the thorny
C-1 constraint on the unwritten delegation doc; P3+P5 together dissolve the "two step 6s" nit.

---

## P1 — Delete the second signing construction (the lead change)

**Claim.** The fetch assertion (`restricted-feeds §4`) is an *encoded-payload EdDSA JWT* purely
because it was framed as "a token, not detached content" (§1). It does not need to be a JWT. Its
claims `{iss, htm, htu, iat, exp, jti}` are an ordinary small JSON object. Sign it with the
**core detached-JWS construction (spec §6)** and give it an embedded `_sig`, exactly like the
capability grant (`restricted-feeds §6.2`) already does. Transport it base64url'd in the header,
exactly like `OpenFeed-Grant`.

```
Authorization: OpenFeed-Sig <base64url(canonical assertion bytes, incl _sig)>
OpenFeed-Grant: <base64url(canonical grant bytes, incl _sig)>
```

The assertion document:

```json
{ "iss":"https://reader.example/", "htm":"GET",
  "htu":"https://test.example/family/feed.json",
  "iat":1739577600, "exp":1739577900, "jti":"urn:uuid:…", "_sig":"…" }
```

Host verifies it with the *same* code path as items, manifests, grants: base64url-decode →
strip `_sig` → RFC 8785 canonicalize → verify construction #1 → check `iss==kid` identity,
`htm`/`htu`, `iat≤now<exp`, `exp−iat≤300`, `jti` replay cache. Every DPoP-style property
survives; they were never JWT-specific.

**What it deletes.** restricted-feeds §1's central "second construction" caveat; §4's JWT/Compact
format and `typ: openfeed-fetch+jwt`; the review's cross-construction-confusion analysis (R-4);
one of two verifier code paths in *every* implementation; the spec §6.1 / §11 / Principle 5 /
Appendix E hedges that all exist to *quarantine* the second construction.

**Capability trade.** None I can find. We are **not** DPoP-interoperable anyway (custom
`OpenFeed-Sig` scheme, `kid`-resolves-to-identity-doc not embedded `jwk`), so no interop is lost.
The one thing JWT gave cheaply is `typ` domain-separation; replace it with field-set distinctness
(an assertion has `htm`/`htu` and no `url`/`id`; a grant has `grant`/`feed`; an item has
`id`/`authors`) or, belt-and-suspenders, an explicit `"purpose":"fetch"` field in the signed
bytes.

**Blast radius.** restricted-feeds §1, §4, §5 (verification steps), Appendix R (R.1 regenerated
as a construction-#1 doc), `tmp/regen.js`; spec §6.1, §11, §1 Principle 5, Appendix E row
"Authorized Fetch"; README "one signature construction"; CLAUDE.md invariants; HANDOFF invariant.
Sizable *documentation* churn, but it all moves in the same direction: "one construction, full
stop."

**Framing bonus.** Once both use construction #1, the assertion and the grant are the same object
shape with different signers: **grant = owner-signed durable capability; assertion =
reader-signed ephemeral proof-of-possession.** Presenting them as a matched pair ("two signatures,
one delivery") is more cohesive than "a JWT plus a detached-JWS doc."

**Confidence: High.** This is the change I'd fight for.

**Challenge me.**
- Is there a replay/confusion attack where a signed assertion is accepted as some *other*
  construction-#1 document (or vice-versa)? I claim no (disjoint required-field sets + author
  binding), but this is the crux — try to break it. Consider especially: could a signed **grant**
  be replayed as an **assertion** or an **item** be replayed as either?
- Does any middlebox / standard-compliance benefit actually depend on the token being a real JWT?
  I claim no because the scheme is already custom.
- Is `exp−iat≤300` + `jti` + replay-cache genuinely as strong under construction #1 as under the
  JWT? (I believe identical — the bytes signed differ, the semantics don't.)

---

## P2 — Grants become the only real authorization mechanism

**Claim.** restricted-feeds §6 specifies **four** ways to answer one yes/no question ("is this
`iss` authorized?"): private allowlist (§6.1), capability grants (§6.2, RECOMMENDED), published
reader list (§6.3), capability URLs (§6.4). That is the "we couldn't decide, so we shipped all of
them" smell. Cut to the one that's actually good:

- **Delete the published reader list (§6.3) entirely.** It is the one mechanism the doc argues
  *against* — a full-width security warning ("publishing a reader list publishes your audience")
  plus a whole "rejected anti-pattern: hashed/Bloom lists" subsection. Capability grants do the
  same job (authorize a named identity) **without** publishing the audience. A feature whose own
  spec text is mostly warnings against using it should not be in the spec.
- **Demote the private allowlist (§6.1) to one sentence.** It is explicitly "interface only" — not
  a wire format, just "the host stores a yes/no somehow." That needs a sentence in §6's preamble,
  not a numbered mechanism.

**Open sub-question (raise with owner): also cut capability URLs (§6.4)?** §6.4 is nearly
non-normative — "publish at an unguessable ≥128-bit URL and serve it to anyone who has it" needs
*no Open Feed machinery at all* (no assertion, no grant, no `401`). It's an operational technique,
not a protocol mechanism. Cutting it leaves restricted-feeds with a **single** authorization
mechanism (grants) and a one-line note "for purely static hosting, an unguessable URL is a
capability by obscurity; see §X." Counter-argument for keeping it as a named tier: it's the only
option at Level 2 static hosting, and naming it lets the conformance table reference it. My lean:
demote to an operational note, don't dignify it as a mechanism — but this is genuinely the owner's
call.

**What it deletes.** §6.3 (document format + security warning + hashed-list anti-pattern), §6.1 as
a section, `readers` identity-doc field; optionally §6.4 as a mechanism.

**Capability trade.** Effectively none. Grants strictly dominate reader lists (same authorization,
private instead of public, portable instead of host-local). The static-hosting niche survives as
an operational note.

**Blast radius.** restricted-feeds §6, §9, §10 (conformance "at least one mechanism"), Appendix R
(none — no vector covers §6.3/§6.4); README FAQ "simpler options: a private server-side allowlist,
a published reader list, or unguessable capability URLs"; CLAUDE.md.

**Confidence: High** for cutting §6.3 and demoting §6.1; **Medium** for also demoting §6.4.

**Challenge me.** Is there a real deployment that can issue a *published reader list* but not
*grants*? (I claim no: issuing a grant is strictly less work than maintaining a signed list.) Is
there a Level-2-static deployment that needs restricted feeds badly enough to justify keeping
§6.4 as a first-class mechanism rather than a note?

---

## P3 — Cut the chained grant-revocation list

**Claim.** restricted-feeds §6.2.2 introduces a whole **signed, chained, pinned, public**
side-document (its own `seq`/`prev`/`history`, checkpointing, an identity-doc `grant_revocations`
endpoint, and vectors R.4/R.4b) to revoke a grant faster than its `exp`. Two facts from the doc
itself undercut it:

1. The doc says short `exp` + non-renewal is the **primary** mechanism and the list is
   "a fallback, not the mechanism."
2. §6.2.2 says *"the consumer of this document is the enforcing **host**, not the reader."*

If the enforcing party is the host, it does not need a signed public chained artifact to revoke —
it keeps a **private server-side denylist** and denies (same "interface only" logic as the
allowlist in P2). The chain's job (stop a serving-path attacker from rolling back a revocation)
only bites in the *owner ≠ host, client-side-key* tier — which is exactly the tier where the whole
restricted-feed story is weakest (the host reads the plaintext anyway, and a malicious serving
path can just decline to enforce revocations regardless of what the document says).

**Proposed replacement.** Revocation = short `exp` + stop renewing (primary) + an optional
**private** host-side denylist for faster-than-`exp` (needs no document, no chain, no vectors). If
the owner genuinely wants owner→host signed revocation for the client-side-key deployment, that's
a niche worth *one sentence* pointing at "issue shorter grants," not a chained document.

**What it deletes.** restricted-feeds §6.2.2, the `grant_revocations` identity-doc field, grant
step 6 (the revocation-list check), vectors R.4 + R.4b, and the conventions §5.3 "tradeoff
triangle" clause that pairs the revocation list with self-commitments.

**Capability trade.** Loss of *public, gossipable* fast revocation. For family scale (short grants,
honest hub) this is invisible; for the semi-trusted-host tier it's a real but narrow loss.

**Blast radius.** restricted-feeds §6.2, §6.2.2, §9; conventions §5.3; Appendix R + `regen.js`
(drop R.4/R.4b); CLAUDE.md open-questions (F3 line); README.

**Confidence: Med-High.** The "consumer is the host, so why is it public and chained" argument
feels decisive to me, but the F3 patch is recent and the owner may have a deployment in mind I'm
missing — flag it, don't assume.

**Challenge me.** Steelman the chained public list: is there a case where a **reader** or a
**third party** (not the host) needs to verify revocations? If so my "host is the only consumer"
premise is wrong and this proposal collapses. Also: does F2's explicit-`manifest` binding change
the revocation threat model in a way that re-justifies the list?

---

## P4 — Cut existence-private mode

**Claim.** restricted-feeds carries two modes: existence-public and existence-private. The
existence-private branch is responsible for a disproportionate share of the doc's complexity:

- the `404`-instead-of-`403` rule and the **whole timing-attack subsection** (§9), which then
  *admits* it leaks existence to authenticated probers anyway ("response latency can distinguish
  'exists but unauthorized' from 'does not exist'");
- the F2 patch's central justification: every grant carries an explicit `manifest` field
  "required because an existence-private feed is omitted from the identity document entirely";
- its incompatibility clauses with self-commitments and the grant-revocation list (the
  "tradeoff triangle").

For a property that is delivered *imperfectly* (timing side-channel) at *high* cost, in an
extension whose headline caveat is already "audience control, not confidentiality."

**What it deletes.** restricted-feeds §9's second bullet + the timing-attack paragraph; the grant's
explicit `manifest` field (the manifest is then discovered publicly via the identity doc's `feeds`
entry, as any manifest is — **this undoes the F2 patch**); grant step 5's "private routing"
alternative; the "existence-private" arm of every tradeoff discussion.

**Capability trade.** Real: you lose "hide that this identity *has* a family-only feed." But note
the honest ceiling — timing already leaks it to authenticated probers, and the content is readable
by the host regardless. If someone needs true metadata privacy they need something this extension
explicitly doesn't provide.

**Blast radius.** restricted-feeds §6.2 (grant fields), §7, §9; conventions §5.3; DISTRIBUTION-MODEL
visibility table (`family` row); README; CLAUDE.md (F2 line). **This is the F2 reversal — the
biggest "we recently added this on purpose" collision. Handle explicitly with the owner.**

**Confidence: Medium.** The simplification is large and the property is weak, but existence-privacy
is a legitimately-desired thing and F2 was a deliberate recent investment. Present as a trade, not
a slam-dunk.

**Challenge me.** Is there a family use case where hiding the feed's *existence* (not just its
contents) is a hard requirement — e.g. a member hiding a support-group feed from an abuser who can
read the public identity doc? If yes, that's the scenario that keeps existence-private alive, and
the timing side-channel becomes a bug to *fix* rather than a reason to cut.

---

## P5 — Cut self-commitments (the deepest machinery in the system)

**Claim.** Cross-reader equivocation detection for restricted feeds is currently a three-layer
tower: restricted-feeds §8.2 → conventions §5 (self-commitments) → the C-5 "commitment-withholding
evasion" sub-rule → chained commitment logs (C.2b). The HANDOFF itself questions whether the
evasion heuristic ("flag a served version that stays uncommitted while other versions get
committed") is "actually implementable/soundly-specified." This is a lot of conceptual surface,
and it fights the grain of the spec's own philosophy.

**The philosophical argument (this is the strong one).** The core's whole trust story (§14.2) is an
**honest gradient**: it names three adversary tiers and says plainly which properties hold at each,
rather than engineering every risk away. A restricted feed is *definitionally* in the key-custodian
tier (the host reads the plaintext). Cross-reader equivocation by a key-custodian host is **the
tier-appropriate residual risk** — and the honest-gradient answer is "documented, mitigated by
client-side keys and out-of-band compare, not fully solved." Self-commitments try to *engineer
away* a tier-appropriate risk with a bespoke public-commitment protocol, a withholding-evasion
counter-rule, and a chained log — and still can't close it (the withholding evasion remains). That
is exactly the kind of "clever mechanism that doesn't fully work" the honest gradient was designed
to avoid.

**Proposed replacement.** Shrink restricted-feeds §8.2 to: *"Cross-reader equivocation is not
caught in-band; authorized readers who trust each other compare restricted pins **out of band**
(the private analog of the §9.1 cross-observer check). Client-side signing keys deny a
serving-path attacker the ability to forge divergent manifests in the first place."* Delete
conventions §5 wholesale.

**What it deletes.** conventions §5 (largest section in that doc), §5.1/§5.2/§5.3, vectors C.2 +
C.2b, the "tradeoff triangle," the withholding-evasion rule; restricted-feeds §8.2's
self-commitment paragraphs and the RECOMMENDED-self-commitments mitigation bullet; the pins
document's *overload* (it stops meaning both "observations of others" **and** "commitments about
myself" and becomes cleanly the former).

**Capability trade.** Real: you lose *in-band, publicly-gossipable* cross-reader equivocation
detection for existence-public restricted feeds. But (a) it was never total — the withholding
evasion is uncloseable; (b) the out-of-band private compare remains and is the honest fallback the
doc already offers for existence-private feeds anyway; (c) client-side keys, which the doc already
recommends, are the stronger and simpler mitigation.

**Bonus (compounding).** This removes the live **C-1 constraint** on the unwritten
`open-feed-delegation.md`: today the delegation `scope` design must special-case "a hub-held
delegate signing a self-commitment gives no cross-reader guarantee." Delete self-commitments and
that whole cross-doc contradiction risk evaporates — delegation gets simpler too.

**Blast radius.** conventions §5 (+ Abstract, §1, §2, §7 conformance bullets referencing it), C.2/
C.2b, `regen.js`; restricted-feeds §2, §8.2, §9; spec Appendix G's self-commitment paragraph and
§3.2 note; README "Self-commitments" bullet + FAQ; CLAUDE.md; the delegation open-question's C-1
hook. Wide, but almost all of it is *removal* of forward-references.

**Confidence: Medium.** The philosophical argument is strong; the hesitation is that
self-commitments are genuinely clever and were the celebrated "missed connection" of a prior
session. Cutting a clever thing needs the owner's explicit buy-in. My honest read: it's clever but
disproportionate, and its cleverness is why it's hard to cut — which is not a reason to keep it.

**Challenge me.** Is the withholding evasion actually closeable with a bounded staleness rule
(making self-commitments *sound*, hence worth keeping)? If a reviewer can specify that rule
crisply, the "it doesn't fully work anyway" leg of my argument weakens. Separately: is there a
family that genuinely wants public equivocation-transparency for a restricted feed *and* is willing
to disclose existence + cadence? If that persona is real, self-commitments serve it and the cut is
wrong.

---

## P6 — (Radical / provocation) Do restricted feeds belong at all?

**Claim.** The owner invited big changes, so here is the biggest. Restricted feeds pull the spec
*away from its one distinctive strength* — public, transparent, independently-verifiable content
with a completeness proof — toward a weak audience-control scheme that, by its own abstract, the
host can read in the clear. Three observations sharpen the doubt:

1. **The single-family-hub case doesn't need it.** If the family runs the hub, "family-only" is a
   login wall — trivial host-side state, no fetch assertions, no grants, no gated manifest. The
   extension's machinery only earns its keep for **cross-hub authorized fetch** (a reader on hub A
   proving identity to hub B).
2. **The cross-hub case is already awkward and narrow.** DISTRIBUTION-MODEL.md §"Restricted
   external feeds" has the hub pull a self-hoster's family feed by *"signing a short-lived fetch
   assertion **as the reading member** … possible only because the hub holds Mom's key,"* and
   concedes a client-side-key member "can't be proxied this way." So the extension's real
   beneficiary is the client-side-key minority reading *across* hubs — a small slice of a
   family-scale protocol.
3. **It's not confidentiality.** Anyone who actually needs privacy needs encryption, which is
   out of scope — so restricted feeds occupy an awkward middle: too heavy for "login wall," too
   weak for "private."

**The alternative to weigh.** Replace the extension with (i) a one-paragraph **operational note**
(unguessable capability URLs + host-side auth are how you do family-only today) and (ii) a
**deferred, honestly-scoped encryption extension** for anyone who needs real confidentiality. This
removes the entire second-construction question (moot after P1 anyway), all four auth mechanisms,
the gated manifest, existence-private, the revocation list, *and* self-commitments in one stroke —
and keeps the core pointed at what it's uniquely good at.

**Capability trade.** Large and real: no cross-hub authorized fetch. This is the one proposal I
expect the owner to reject — the family-journaling product (DISTRIBUTION-MODEL) leans on
`family`-visibility. I include it because **forcing the justification is valuable even if the
answer is "keep it,"** and because if restricted feeds *stay*, P1–P5 are how they should look.

**Confidence: Low as a recommendation; High as a question worth answering out loud.**

**Challenge me.** The strongest counter: cross-hub family-only feeds are a first-class product
requirement, the client-side-key minority is exactly the security-conscious cohort that matters
most, and "just use a login wall" abandons the interoperability that makes Open Feed more than a
CMS. If that holds, P6 is dead and we execute P1–P5 instead. I lean toward that counter myself —
but the owner should say it deliberately.

---

## Compounding effects (why order matters)

```
P1 (one construction) ──────────────► assertion & grant become one shape; whole "quarantine" story gone
P4 (cut existence-private) ─────────► grant drops explicit `manifest` field  ⇒ UNDOES F2
P3 (cut revocation list) ───────────► grant step 6 gone ┐
P3 + P5 together ───────────────────► the "two step 6s" readability nit dissolves ┘
P5 (cut self-commitments) ──────────► pins un-overloaded ; delegation C-1 constraint evaporates
P2 (grants-only) ───────────────────► conformance "at least one of four" → "grants (+ static note)"
```

Net after **P1 + P2 + P3 + P4 + P5**, the restricted-feeds extension is:
**fetch assertion (construction #1) + capability grants + gated manifest + honest §8 limits +
one discovery mode** — roughly half its current size, one auth mechanism, one revocation story,
one mode. The conventions doc becomes **follows + pins-as-observations** — its largest section
gone. And the whole protocol has **one signing construction and one verifier**.

---

## My recommendation

- **Do P1 regardless** — it's the cohesion win and it's nearly free. If anything here gets built,
  build this first (and prototype the unified assertion in `tmp/regen.js` to prove it verifies
  before touching normative text).
- **Do P2** — near-zero-loss, removes the most self-contradictory section (§6.3).
- **Treat P3/P4/P5 as a package the owner opts into** — each trades a narrow, family-scale-invisible
  capability for a large drop in conceptual surface, and they were all *recent, deliberate,
  unreviewed* additions (F2/F3, self-commitments). They deserve explicit sign-off, not silent
  removal. My lean: do all three; the honest-gradient philosophy (P5) and the "consumer is the
  host" argument (P3) are the two I'd defend hardest.
- **Raise P6 as a question, expect "keep it," and let that answer justify the whole extension.**

---

## Considered and rejected (so the reviewer knows these were examined)

- **Collapse the manifest into a self-committing signed feed.** Tempting (the feed already lists
  items with `_version`), but the separate manifest is **load-bearing for pagination**: a large
  feed is served in `next_url` pages with no single "full bytes" to hash-chain, while the manifest
  is one compact document that commits the whole live set regardless of paging (spec §7.4, §9). It
  also enables cached-copy availability and independent checkpointing. **Keep the two chains.**
- **Remove the `follows` document.** It's cheap (one vector) and it's the natural peer set for pins
  gossip. Arguably it's "client polling config promoted to protocol with no verifier benefit," but
  the cost is low. **Keep**, low priority — mention to owner only if cutting hard.
- **Remove the `replies` endpoint (spec §12).** Optional, small, reuses the feed parser. Not worth
  the churn. **Keep.**
- **Merge the two history documents / seq-address versions instead.** Minimal machinery already;
  no meaningful win. **Keep.**

---

## Open questions for the reviewing agent

1. **P1 confusion-safety** is the load-bearing claim of the whole pass. Can you construct *any*
   cross-type replay (assertion↔grant↔item↔manifest) once all four use construction #1? If yes, P1
   needs an explicit `purpose`/`typ` field or dies.
2. **P3 premise:** is the host truly the *only* consumer of grant revocations, or does some reader/
   third-party path need them? Find a counterexample or confirm.
3. **P5 soundness:** can the commitment-withholding evasion be closed with a crisp staleness bound?
   If so, self-commitments become *sound* and the case to keep them strengthens.
4. **P4/P6 product reality:** how central is cross-hub `family`-visibility to the actual
   distribution model? If it's core, P6 is dead and P4 is a genuine trade (not a clear cut).
5. Did I miss a **core** simplification? I claim the core is already minimal — try to falsify that.
6. Does any proposal secretly force a **core spec change**? (I believe none do; all live in the
   extensions + doc cross-references.)
