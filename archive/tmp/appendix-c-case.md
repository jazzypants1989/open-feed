# Appendix C: the case both ways

Requested by the owner in place of acting on `HANDOFF.md`'s shortlist entry, which proposed
Appendix C as "the single largest reduction available." Nothing in the spec was edited to produce
this. Read §3 first if you read only one part — it is the finding that changes the question.

---

## 1. The number the argument rested on is wrong

`HANDOFF.md` and `tmp/review-findings.md` both say Appendix C carries "**~15% of the
specification's binding weight**." Measured over the same corpus `tmp/rules.js` uses (whole
document, Appendix B excluded as a vector corpus):

| | MUST | MUST/SHOULD/MAY | words |
| --- | --- | --- | --- |
| Whole specification | 289 | 418 | 41,161 |
| Appendix C | 13 | 19 | 1,845 |
| **Appendix C's share** | **4.5%** | **4.5%** | **4.5%** |

Appendix C is **exactly proportional** — it carries binding weight in precise proportion to the
space it occupies, which is what an ordinary section looks like. It ranks second in `rules.js`'s
per-section table for a reason that is an artifact of sectioning, not of density: it is one large
section where comparable material elsewhere is split. §3.2 and §3.2.1 are 22 MUSTs between them
and would top the table if merged; §15's six subsections are 30.

The `~15%` figure appears to have been derived from the per-section rank rather than computed.
It should be struck from both documents whatever is decided here, because it is the sentence
doing the persuading, and cutting 4.5% of a document described as bloated is not a lever.

## 2. What the 13 MUSTs actually bind

Extracted verbatim (12 sentences, 13 keywords — [12] carries two).

| # | Rule | Protects | Stated anywhere else? |
| --- | --- | --- | --- |
| 1 | Delivered-only items MUST NOT be emitted | OF author | **Yes — §11.1.1 verbatim**, which enumerates "a gateway emission to a foreign network" among the forbidden artifacts |
| 2 | MUST NOT emit content it cannot read, including as a placeholder | OF author (§15) | No. §13.8 item 10 cites *this* as the enforcement |
| 3 | MUST NOT claim a completeness guarantee for bridged content | OF consumer | No, but §9.3 already bounds what a manifest proves |
| 4 | Backfeed MUST NOT be published into any feed or publicly-readable artifact | foreign author | No. §11.1.1 defines **its own only exception** by pointing here |
| 5 | MUST retain foreign-object → `(author, id)` mapping across restarts | foreign author | No. §7.3's allowlist is justified by the deletion duty this serves |
| 6 | Displayed backfeed MUST NOT enter any signed/manifested/retained artifact | foreign author | Overlaps [4]; it is the bound priced against the `MAY` render beside it |
| 7 | Non-public foreign content MUST NOT be ingested | **foreign non-participant** | No. Nothing in core |
| 8 | Ephemeral/withdrawable foreign content MUST NOT be ingested | **foreign non-participant** | No. Nothing in core |
| 9 | Proxy identity MUST disclose it is a gateway-operated mirror | **foreign non-participant** | No |
| 10 | MUST never claim exit (§14) for a proxy identity | §14's coherence | No. §12/§14's hosted-identity model depends on the carve-out |
| 11 | MUST withdraw the proxy on the foreign actor's request | **foreign non-participant** | No |
| 12 | A profile MUST fix [seven slots], and objects with no item representation MUST NOT be invented into `_openfeed.rel` types | future profile authors | No |

**Five of the thirteen protect people who are not party to this protocol at all** — [7], [8], [9],
[11], and [4] in effect. That is the honest description of what Appendix C is, and it is not
visible in a keyword count: every other section of this specification protects a participant.
`rules.js` measures where the load sits and says nothing about who bears the risk, which is a
limit of the instrument worth remembering before using it to aim again.

## 3. The finding: six core sections cite Appendix C, four for their own scoping

Appendix C is **UNBACKED** (nothing in `src/`/`test/` cites it) but it is **not an ORPHAN** — and
`rules.js` correctly kept it out of that column. Reading the citations is what changes the
question:

- **§11.1.1** (`spec:721`) — "the missing `_openfeed.feed_url` is overloaded by exactly one other
  case … a gateway-**delivered** foreign response (Appendix C's backfeed rule)". §11.1.1 is, in
  its own words, "the **only** enforcement the delivered column has." **Its single exception is
  scoped by Appendix C.**
- **§13.8** (`spec:937`) — "which is why Appendix C **forbids** a gateway from emitting content it
  cannot read in any form, including a placeholder." A security consideration naming a
  prohibition that would no longer exist.
- **§7.3** (`spec:439`) — the tombstone allowlist admits `_openfeed.unverified` *because*
  "Appendix C obliges a gateway to convey deletions." The allowlist's design is justified by C.
- **§7.5** (`spec:459`) — "Appendix C states the rule governing both directions, and §11.1.1 is
  the case the core enforces directly." An explicit division of normative labour.
- §6.6 (`spec:397`) and §8 (`spec:506`) cite it for attribution and for the bare-URL `to` form —
  weaker dependencies, but real.

**Moving Appendix C to README makes four core MUSTs point at non-normative prose for their own
scoping.** That is the shadow-copy failure `CLAUDE.md` warns about, inverted and worse: not a
second copy that goes stale, but a MUST whose extent is defined in a document that has no MUSTs
in it by construction. §11.1.1 is the load-bearing case — it is the delivered column's only
enforcement, and the threat model turns on the delivered column.

## 4. Where a real reduction is available

Three of the thirteen are weak, and none of them is in the group protecting non-participants.

- **[1] is redundant.** §11.1.1 already binds it and enumerates the gateway case by name. This is
  a genuine echo that `rules.js` missed because the wording differs — the same class as the
  §5.2/§4.3 contradiction the sixth pass found, and worth the same treatment: delete the
  restatement, keep the rule where it lives. **Cut.**
- **[3] is truth-in-advertising, and §9.3 already does the work.** A gateway is an ordinary
  identity; its manifest proves exactly what it committed and no more, which is §9.3 for everyone.
  "Don't claim more than that" is not a rule a protocol can hold anyone to. **Cut or demote to
  SHOULD, and note that §9.3 is what actually bounds the claim.**
- **[12] is a MUST binding documents this specification says it will never contain** — "No profile
  is defined here, and none will be," and README is named as carrying the template. A requirements
  list for a document that lives elsewhere is a template. **Move the seven slots to README**,
  keeping one sentence: a profile must answer the audience and durability tests, which are [7] and
  [8] and are the safety-critical pair C already flags.

**Taken, and measured afterwards — the estimate in this paragraph was wrong.** Predicted: 3 of 13
MUSTs and a third of the appendix's prose. Actual: **2 of 13 MUSTs and 9 words.** [12] kept both
its keywords in reduced form (a profile MUST still fix the two safety-critical tests, and the
`_openfeed.rel` prohibition binds gateways rather than profiles), and the slot enumeration it shed
was a run-on list that cost almost nothing to carry. Appendix C moves from #2 to joint-#2 in
`rules.js`'s weight table.

So the cut is worth taking and it is **a duplication cut, not a length cut** — it deletes a
verbatim shadow copy of README's seven-slot template and two MUSTs that restate §11.1.1 and §9.3.
Nine words is the finding: there is no length lever in Appendix C, and §1's proportionality result
already said so. Anyone re-proposing the deletion should start from this number.

## 5. What a gateway implementer loses under each option

**Move it all to README.** They lose nothing they would obey — a gateway operator reads the whole
document either way, and the three tests (audience, durability, verification) are memorable prose
that survives the move intact. What is lost is elsewhere: §11.1.1's exception, §13.8's named
prohibition, §7.3's justification, and §14's proxy carve-out all become citations of an essay. And
the five non-participant protections stop being requirements anyone can be held to — the
followers-only post ingested into a manifested feed becomes a thing a gateway *shouldn't* do,
permanently and world-readably.

**Keep and back it.** The UNBACKED status is real but it is **scope, not neglect**: `src/`
implements no gateway, so no comment cites C because nothing in the reference implementation is
one. This is the opposite of §3.3.1, which was UNBACKED because it had been forgotten — the
seventh pass found a live defect under it. Backing C means writing a gateway, which is a project,
not a pass. Worth doing only if a gateway is on the roadmap; `DISTRIBUTION-MODEL.md` does not
plan one.

**The middle (§4 above).** They lose the profile checklist from the normative text and find it in
README, which is where C already says it lives.

## 6. Recommendation

**Keep Appendix C normative; take the §4 cut.** The reasons, in order of weight:

1. The 15% figure was wrong; at 4.5% the appendix is proportional and is not a length lever.
2. Four core sections scope their own MUSTs by pointing at it, §11.1.1 among them.
3. Five of its thirteen rules are the only text in this specification protecting people who never
   agreed to be in it — which is the same asymmetry `CLAUDE.md`'s threat model is built on, at a
   boundary one hop further out.

The question "is it a specification or an essay?" has a sharper answer than either: it is the
protocol's **third-party chapter**, and it looks like an essay because no conformance level
requires it — which is a fact about §12, not about the rules. If it is worth changing anything
structural, the candidate is the reverse of deletion: a **Level 4 (Bridge)** in §12 that makes a
gateway a conformance subject like everyone else, so the thirteen MUSTs bind someone by name. That
adds a §12 row and a heading and no rules. It is not proposed here — it is the owner's call and
it is decision 7's territory — but it is the option the measurement actually points at.

## 7. Corrections owed to the register whatever is decided

- Strike "~15% of the specification's binding weight" from `HANDOFF.md` and
  `tmp/review-findings.md`. Measured: 4.5% of MUSTs, 4.5% of words.
- `rules.js`'s UNBACKED column conflates two things: **forgotten** (§3.3.1, which hid a live
  defect) and **out of scope** (Appendix C, which `src/` cannot cite because it implements no
  gateway). Promoting that column to a gate — `HANDOFF.md`'s Sketch A — needs the distinction
  first, or the gate's first act is to fail on Appendix C forever.
