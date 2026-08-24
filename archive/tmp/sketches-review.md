# The three sketches, reviewed against this session's measurements

`HANDOFF.md` offers Sketches A/B/C as material for decision 7 — "what the ambitious answer to
length is." This pass produced numbers that bear directly on all three. Two of the sketches close;
one improves; and the measurement that closed them points somewhere none of them go.

Nothing here is proposed as done. It is input, same as the sketches.

---

## Sketch C — CLOSED by reading §9.1, no prototype needed

The claim: "§5 and §9 are a large fraction of the document and much of §9 is §5 restated under
[the §9.1 substitution table]. A single 'chained document' section with the differences as the
table … is a real design change." The handoff called this the riskiest item in the file and said
to prototype it.

**It does not need a prototype, because the unification it proposes already exists.** §9.1 opens:

> Producing and verifying a manifest version follow §5.2 and §5.3 **exactly**, with these
> substitutions:

— followed by a four-row table. That *is* Sketch C, already built, and §9 measured:

| §9 subsection | words | has a §5 analog? |
| --- | --- | --- |
| §9 intro | 626 | no — what a manifest is |
| **§9.1 Chain Mechanics** | **630** | **yes — and it is the substitution table itself** |
| §9.1.1 Skip links | 741 | no |
| §9.1.2 Freshness | 471 | no |
| §9.2 Cadence and Retention | 865 | no |
| §9.3 Invariants | 1,679 | no — feed↔manifest reconciliation |

**87% of §9 has no §5 counterpart.** The premise "much of §9 is §5 restated" is false; §9 is long
because the manifest carries four mechanisms the identity chain does not have. Sketch C would
save at most part of 630 words and would put the §9.1 per-hop `_sig` relaxation — which §9.1
explicitly forbids carrying to §5.3 — inside a section that no longer distinguishes the two
chains. All of the risk, none of the saving. **Do not spend a pass on it.**

## Sketch B — its shortlist is one item long, and it was just examined and kept

Sketch B proposes cutting *conformance surface*, "using the weight table to aim." Two problems,
one fatal to the instrument and one to the target list.

**The weight table is the wrong instrument, and this pass proved it on the sketch's own example.**
Appendix C ranked #2 by absolute MUST count and was described as ~15% of binding weight; measured,
it is 4.5% of MUSTs and 4.5% of words — exactly proportional. Its rank was an artifact of
sectioning: it is one large section where comparable material elsewhere is split, and §3.2 + §3.2.1
are 22 MUSTs between them. Ranking by *density* is a different bad instrument — it surfaces
§15.6 and §16.2, which are terse conformance lists and are dense because that is what a good rule
list looks like.

**The right question is which sections bind a subject no conformance level requires**, and it has
exactly three answers: Appendix C (gateways), §15 (deployments offering audience-restricted
content), §16 (heeding pins). The owner has already settled two of them — §15 promoted, §16
emission promoted to a Level 3 MUST — and the third is Appendix C, examined this pass and kept,
with a 9-word cut taken. **Sketch B is therefore finished, not open.**

Note the distinction it was conflated with: Stage 3's five candidates (§9.1.1 skip links, §4.4's
revocation heuristics, `_recovery_sig`'s dual role, §2.1, §16.1's `observed`) are *mechanism* cuts,
not conformance-surface cuts. Stage 3 is still the open lever. Sketch B is not a second route to it.

## Sketch A — the right idea, with the wrong discriminator

Sketch A's surviving half: promote `tmp/rules.js`'s UNBACKED column to a gate — every binding
section must be cited by one `src/` comment and one test, or CI fails. This pass is the argument
for it: **§3.3.1 was UNBACKED, and under it was a live security defect that had been there for the
life of the reader.** The gate would have caught it the day it was written.

The problem noted at the time was that UNBACKED conflates *forgotten* (§3.3.1) with *out of scope*
(Appendix C, which `src/` cannot cite because it implements no gateway), so the gate's first act
is to fail on Appendix C forever. The obvious fix — exempt sections §12 does not name — **does not
work**, and measuring it is what produced the finding in the next section.

The discriminator that does work is one line and needs no list: **a section is in scope for the
gate when it binds a subject §12 defines.** Today exactly one section fails that test — Appendix C,
whose subject is a gateway, and §12 defines no gateway. That is an exemption of one, derived rather
than curated, and it stops being an exemption the day a Bridge level exists.

---

## The finding the sketches did not anticipate

Trying to scope Sketch A's gate by "sections §12 names" produced this:

> **§12 names 28 section numbers. Prefix-matched, they reach 143 of the specification's 282
> MUSTs — 51%. The other half is not reachable from any conformance level.**

The unreachable half is not dead weight. It is: §3.2 (Identity Document, 11), §15.1 (11), §3.4
(9), §4.1 (7), §13 (6), §9 (5), §5.4 (5), §5.1 (4), §3.3 (4), §7.1 (3), §4.2 (3)… These are the
**object definitions** — what an identity document *is*, what a key entry *is*, how a chain field
is shaped. §12 says "fetch and parse identity documents" and never cites §3.2, because §3.2 is
what an identity document is.

So the split is real and nothing states it: **§12 is a checklist of behaviors, and half the
specification's MUSTs are object shapes that §12 silently assumes.** Consequences:

- **§12 cannot be used as a conformance checklist on its own, though that is exactly what it looks
  like.** An implementer who satisfies every line of §12 has not necessarily satisfied §3.2's
  eleven MUSTs. S2.9 treated this as a list of six missing rules and closed it; the measurement
  says the gap is structural, and closing it by enumeration would triple §12 — the one thing the
  owner has ruled out.
- **It explains why §12 reads as a shadow copy.** It is a *partial* one, which is the worst kind:
  complete enough to be trusted, incomplete in a way nothing announces.
- **It re-scopes Sketch A's gate.** "Every section §12 names" would gate half the document and
  miss §3.3.1's neighbours.

**The cheap fix is one sentence in §12**, and it adds a sentence rather than a section: *this list
names behaviors; the object definitions in §3–§9 bind whoever produces or consumes those objects,
and conformance to a level includes them.* That closes a structural gap at the cost of ~25 words,
and it makes "which rules bind me?" answerable, which is what Stage 4's first item was asking for
before it was declined for expanding the document.

---

## Three alternatives none of the sketches contain

**1. Cross-document echo detection.** `rules.js` scans the spec only, at an 0.42 within-document
overlap threshold. This pass found two echoes it structurally cannot see: Appendix C's [1]
restating §11.1.1 in different words, and a sentence the spec and README shared **verbatim**
("Those last two are where implementers improvise…"). S2.11 was an entire finding about drift
across these three documents, and the fifth pass was spent on it. Running the echo detector over
the spec × README × DISTRIBUTION-MODEL triple would catch the class that has cost the most passes,
and `CLAUDE.md`'s "README explains; the spec defines" is already the rule it would enforce.
Cheapest item here.

**2. The claims ledger — generalize the doctrine the repo already has.** `CLAUDE.md` says *"a
prototype nobody re-runs is a claim, not evidence."* Three failures in two passes were the same
shape, and only one of them was a prototype:

| what failed | kind of claim | who caught it |
| --- | --- | --- |
| `inbox-prototype.js` green for 4 commits while every scene failed | executable | the gate, once added |
| §3.3.1 unimplemented for the life of `reader.js` | normative | `rules.js`, by accident |
| "~15% of binding weight" | **numeric** | recomputing it, this pass |
| §5.2 vs §4.3 permanent-retention contradiction | **structural** ("X is stated once") | `rules.js`'s echo pass |

Executable claims are gated. Normative ones are gateable (Sketch A). **Numeric and structural
claims are gated by nothing at all**, and those are the two that nearly cost the most — a number
nobody recomputed almost bought the deletion of the protocol's third-party chapter. A ledger of
every number and every uniqueness claim in the repo, each with a one-line derivation CI re-runs,
adds nothing to the specification and closes the two ungated rows. This is Sketch A's idea taken
past normative text, which is where its value actually is.

**3. Level 4 (Bridge) in §12.** From the Appendix C memo, restated because it belongs on this list.
Appendix C looks like an essay because no conformance level names its subject — a fact about §12,
not about its thirteen rules. A Bridge level adds a §12 row and a heading and no rules; it makes
gateways a conformance subject, and it is what makes Sketch A's gate exemption of one go to zero.

---

## What I would do, in order

1. **One sentence in §12** naming the behavior/shape split. Smallest change with the largest effect
   on "which rules bind me?", and it is the honest close of what S2.9 half-closed.
2. **Cross-document echo detection** in `rules.js`. Cheap, and aimed at the class that has cost
   the most passes.
3. **Sketch A's gate, scoped by "binds a subject §12 defines."** One derived exemption, no curated
   list.
4. **The claims ledger**, starting with the numbers already in `HANDOFF.md` and this register.
5. **Stage 3** remains the only mechanism lever, and is untouched. Sketches B and C are closed and
   should be struck from `HANDOFF.md` so a later pass does not re-cost them.
