# Review of SPEC-CUTS.md — the "Shorter by design" consolidations

Read-only review, 2026-08-25. Sources: `CLAUDE.md`, `GOALS.md`, `open-feed-spec.md` (whole),
`FINDINGS.md`, `SPEC-CUTS.md`, `archive/README.md`, `archive/redesign/RULINGS.md` and
`rejections.md` (searched, not read whole), `src/`, `test/`, `tools/revert.js`, `examples/`.

## Housekeeping first

- **There are thirteen consolidations, A–M, not twelve.** The brief says twelve; the file has A
  through M.
- **Two dangling cross-references.** The §4.5 entry says "see item N" and the Appendix A entry says
  "see item O". Neither exists; they mean K and L. Stage D will be misdirected by both.
- **Word counts are right.** I re-derived every row of the summary table with `wc -w` over the
  line ranges between `## ` headings (headings included, the ten-word title excluded): Abstract 145,
  §1 405, §2 572, §3 2,052, §4 1,101, §5 536, §6 905, §7 1,027, §8 1,029, §9 386, §10 197, §11 211,
  §12 257, §13 765, Appendix A 93, Appendix B 586; file total 10,277. All sixteen match.

## The thirteen consolidations

Verdict key: SOUND = do it as written. SOUND-WITH-CAVEAT = the idea is right, the stated shape or
saving is not. UNSOUND = the "two rules are one" claim is false, or the merged rule gives a
different answer on some input.

### A. §12 as a table

1. **Proposes** converting §12's three prose paragraphs into a role / requirement / MUST-or-SHOULD /
   section table, and deleting §1's "None is more of the protocol than another (§12)".
2. **Really one?** Yes — it is a restructure, not a merge; no rule changes. But three sentences in
   §12 are not of the shape *role + MUST + rule*: "Static hosting is a conforming hub", "It MAY do
   anything else it likes about who may write", and the opening "none of them is a level of the
   others". A table drops them unless they become notes. The two-tier hub ("a hub" / "a hub that
   accepts writes MUST additionally") must survive as two row groups, not as a column.
3. **Security.** None, provided the "hold no signing key of any user" row and the two-tier hub
   structure survive. A "level" column would reverse RULINGS §13 Q10 ("three roles … and no
   levels").
4. **Ripple.** Nothing in `src/`, `test/`, `tools/revert.js` or Appendix B; §12 is cited by
   `examples/publish-interface`, `weekend-publisher`, `padding`, `views`, `your-copy` and two seeds
   as a section number only. No vector changes.
5. **Archive.** `rejections.md` §7 item 5 records that a "requirements table" was rejected as a
   rule-extraction mechanism "because nothing may expand the document". That rejection was of a
   table *added beside* prose; replacing the prose is the opposite move and not a re-litigation.
   Worth one sentence in the commit.
6. **Verdict: SOUND-WITH-CAVEAT.** Keep the three non-row sentences as prose under the table; no
   level column; about 100 words is plausible.

### B. One normative definition of the pin

1. **Proposes** a single normative list in §7 of what a pin holds, with §1, §3.6, §7.1, §7.2 and
   §13.1 citing it instead of re-enumerating.
2. **Really one?** The diagnosis is right and understated. The four enumerations are each
   incomplete, and the union is still short of what the reference reader keeps: `src/reader.js`
   lines 61–67 pin `profileVersion`, `profileHash`, `chain`, `recoveryLists`, **`fields`** (the
   `locations`/`recovery`/`name`/`read` snapshot that §3.3's "a restore changes the key and
   nothing else" check needs), **`restoredAt` per chain length** (§3.4's seven-day flag),
   **`locations` ever named** (§3.7's "MUST remember every location"), `indexVersion`, `indexHash`,
   `top`, `live`, `withdrawn`. No enumeration in the spec mentions `fields`, `restoredAt` or the
   location memory. So a correct list is *longer* than any current one and the "~70 words" saving
   is unlikely; the clarity gain is real and larger than the file claims. Not a merge of rules, so
   no divergent input — as long as §7.1 step 3 and §3.6 rule 2 keep their *recording* rules (when a
   list is adopted, never overwritten); those are rules, not enumerations.
3. **Security.** Strengthens §13.1: "he cannot alter it … because he cannot sign" is only checkable
   against a defined pin. One caution: the pin must be stated as reader state that is never
   serialized on the wire. RULINGS §11.1 dropped the *carried* pin and narrowed the word to "the
   head a reader remembers of a head it verified itself"; a definition that reads like a wire
   object re-opens that.
4. **Ripple.** None in code if the list documents what `src/reader.js` and
   `examples/weekend-reader/weekend-reader.js` already keep; `CLAUDE.md`'s "Traps" bullet on pin
   fields becomes deletable (that is the correct direction per its own rules). No vectors.
5. **Archive.** RULINGS §11.1 / rejections §11 — the carried pin. Compatible if worded as above.
6. **Verdict: SOUND-WITH-CAVEAT.** Do it, as reader state, include the three fields the spec
   currently omits, and do not book it as a word saving.

### C. §3.6 trailer vs §7.1 step 6

1. **Proposes** §3.6 owns the rule, §7 owns the order, and step 6 becomes "apply §3.6".
2. **Really one?** No — step 6 carries verdict assignments §3.6 does not. Exact texts: §3.6:
   "*Against a pin, and outside a split: `version` MUST NOT go backwards, and the same `version`
   with a different address is contested.*" §7.1 step 6: "*A split is settled by the recovery
   list's majority, and the reader either follows the branch the list chose, reports **host** for a
   branch the list rejected, or stops at **identity: contested**. With no split, a lower `version`
   than the pin is **identity**, and an equal `version` at a different address is **identity:
   contested**.*" Three things exist only in step 6: (a) a backwards `version` is **identity** (§3.6
   only says MUST NOT); (b) the branch the majority rejected is **host** (§3.6 rule 4 says who wins
   and when it is contested, never what the losing branch reads as); (c) the winning branch is
   followed. `src/profile.js:91–100` implements exactly step 6's three outcomes. Divergent input: a
   served profile on the majority-rejected branch — under "apply §3.6" alone a reader has no verdict
   word for it.
3. **Security.** (b) matters to the threat model: the ex serving his losing branch must read as
   `host`, not silently as nothing. Losing that sentence weakens §13.1's "he cannot … roll it back".
4. **Ripple.** None if the verdict words move into §3.6 rule 4 and the trailer; `test/profile.test.js`
   and `examples/contest` assert the strings, which do not change. No vectors.
5. **Archive.** None.
6. **Verdict: SOUND-WITH-CAVEAT.** Merge in the *other* direction from the one proposed — move step
   6's three verdict assignments into §3.6, then step 6 can say "apply §3.6". Also gated by standing
   caution 1: FINDINGS 1.1 rewrites §3.6's majority paragraph first.

### D. The rotation window "narrated three times"

1. **Proposes** telling the window once in §4.6, with §3.5 and §7.2 pointing.
2. **Really one?** No. The three are three different rules for three roles. §3.5 does not mention
   the window at all — it is the publisher's write-order rule ("write the profile **and** the index
   again, in that order") with its hub-side reason (§8.4 checks the index against the held
   profile). §4.6's sentence is the consequence ("*The consequence is a window …*"). §7.2 step 8
   lists mid-rotation as one of four causes a reader "cannot tell apart" — and SPEC-CUTS's own §7
   entry keeps that list as "the price of having three verdicts". Removing the fourth cause from
   the list falsifies "cannot tell them apart". Only §4.6's last sentence and §7.2's four words
   overlap; the saving is about ten words, not forty.
3. **Security.** None if the write order stays in §3.5.
4. **Ripple.** None.
5. **Archive.** None.
6. **Verdict: UNSOUND** as a consolidation; acceptable as a ten-word trim of §4.6.

### E. §2.4 as a table

1. **Proposes** replacing §2.4's two paragraphs with one three-column table.
2. **Really one?** The four hazards are the same four items twice, yes. But the second paragraph
   carries two things a what/`JSON.parse`/problem table cannot: the producer-MUST-NOT /
   reader-SHOULD asymmetry with its reason ("only the author can sign"), and the `__proto__`
   exception ("a reader that does not reject it MUST at least parse into an object it does not
   inherit from"). SPEC-CUTS's own §2 entry says keep both. So the table replaces paragraph one and
   the *list* in paragraph two; the asymmetry sentence and the `__proto__` MUST stay as prose. The
   file's "neutral on words" is right.
3. **Security.** None. Note FINDINGS 1.2 (§2.4 does not reach the envelope plaintext) — a table is
   the natural place for a "where it applies" column, but that is a rule change and belongs with
   the FINDINGS ruling, not here.
4. **Ripple.** None; `examples/json-hygiene` already leads with the same table.
5. **Archive.** None.
6. **Verdict: SOUND-WITH-CAVEAT.** Table for the four items; keep the asymmetry sentence and the
   `__proto__` clause verbatim.

### F. §4.1 shapes and §4.2 legality as one table

1. **Proposes** a line / means / legal-when table replacing §4.1 and §4.2's four bullets.
2. **Really one?** Mostly. §4.2's bullets are not one-per-shape: "a number has one hash, ever"
   spans `[n,hash]` and the re-listing case; "a withdrawal MUST refer to something live" spans
   `[n,null]` and `[hash,null]`; "numbers start at 1" and "`top` ≥ highest number" are not per-line
   at all; and the pinned-reader cross-index rule (remembered withdrawn hashes) inside the first
   bullet belongs to §7.2, not to the fold. A table carries the four per-line legality rules; the
   `n ≥ 1`, `top` floor, and the sentence "*Re-listing at the identical hash is allowed because it
   is harmless — and because it is the way back from a thief*" (which SPEC-CUTS's §4 entry keeps)
   stay as prose. Divergent input: none — the fold in `src/index.js` is unchanged.
3. **Security.** None if the re-listing reason survives (it is the recovery path in §3.4's own
   scenario).
4. **Ripple.** None in code; `examples/the-index` and `rewrite` cite §4.1/§4.2 by number, which do
   not move. No vectors.
5. **Archive.** RULINGS §14.2 (re-list at identical hash) — the reason must not be lost.
6. **Verdict: SOUND-WITH-CAVEAT.** About 30 words, not 50, once the non-per-line rules stay.

### G. "This is not a fourth verdict" four times

1. **Proposes** saying the rule once in §7.3 and making §4.2, §9 and §13.3 citations.
2. **Really one?** No. The file says "a reader currently has to check whether the four statements
   differ, and they do not" — they do. §7.3 is the rule (a reader MUST NOT invent a fourth). §4.2's
   sentence answers a different question: *which of the three* a fold failure is charged to, and
   why the wrong party (the author signed it) — a verdict assignment, not a restatement. §9's
   sentence answers a third question: a cap or transport failure is **no verdict at all**, "the
   absence of one", and an app shows "could not check" — that is a case §7.3 alone does not settle
   (is "could not check" a fourth state? §9 says it is not a state). §13.3's is a MUST NOT aimed at
   apps for staleness specifically. Divergent input: a reader that hits §9's byte cap. Under §7.3
   alone an implementer picks one of three; §9 says pick none. `test/cli.test.js:31` ("a transport
   failure is no verdict", exit code 3) and `test/fetch.test.js:61` assert exactly that.
3. **Security.** §9's rule is what stops a reader accusing a hub for the reader's own timeout —
   the family-accusation failure mode. Reducing it to a citation weakens it.
4. **Ripple.** Tests above would still pass, but the text that justifies them would be gone.
5. **Archive.** RULINGS §12.8 — "exactly three states … notes on an ok read, not states".
6. **Verdict: UNSOUND** as stated. Each of the three sites may add "(§7.3)" and lose a few words;
   none may become a bare citation.

### H. "Everything is a post" four times; fold §5.6 into §5.3

1. **Proposes** one statement in §5's opening, and §5.6 reduced to a `rel`-agnostic clause in §5.3
   plus "no inbox, no dead-drop, no push", with its consequences moved to §13.3.
2. **Really one?** Two of the four are not the same claim. §5's opening does not say "everything is
   a post" (it says a post is immutable, created once, signed by any chain key — the file may mean
   §1's terminology row). §6's "*Three visibilities, one mechanism*" is a claim about *visibility
   tiers* (public / encrypted / DM) — GOALS.md lists it as a separate decision ("Three tiers, one
   mechanism") — not about replies being posts. So the true duplicates are §1's `post` row, §5.3's
   sentence and §5.6's title; §6's opening stays. Folding §5.6: its two remaining sentences carry a
   rejection fence (see 5) and must survive verbatim. No divergent input.
3. **Security.** None, provided "no inbox, no dead-drop, and no push" stays; it is the sentence that
   keeps the ex from being handed a delivery channel to control.
4. **Ripple.** §5.6 is cited by number fourteen times in `examples/posts-and-targets`
   (`.js` and `.md`), `your-copy` (`.js` and `.md`) and `media.md`, and in `FINDINGS.md` §2. All
   need the new anchor. No code or vectors.
5. **Archive.** RULINGS around line 201–216: push channel (~1,000 words) and full inbox (~2,000)
   rejected by name; "No dead-drop, no inbox, no push" is the ruling's own sentence.
6. **Verdict: SOUND-WITH-CAVEAT.** Drop §6's opening from the merge list; keep the three-absence
   sentence; budget the fourteen citation edits.

### I. §8.5 and §8.6 as one rule

1. **Proposes** one section "a collision is resolved, not refused", with two rows for what "the
   owner's file" means (numbered post; media), and the asymmetry paragraph covering both.
2. **Really one?** Same principle, two different tests, and the file says so honestly. Differences
   that a merged section must keep visible: (a) the post test needs the profile's current key
   (§8.5's "not *any* chain key") — the media test needs nothing but a hash; `src/hub.js` implements
   them as separate branches (lines 66–70 and 71–78). (b) The asymmetries read differently — for
   media "the owner cannot overwrite their own" is vacuous (identical bytes → 409) and "the squatter
   cannot take back what was reclaimed" becomes "junk cannot displace bytes that hash correctly",
   which `hub.js:67` and `test/hub.test.js:73` enforce. (c) The unresolved 400-vs-409 status for
   junk at an empty media address (FINDINGS §3) would surface in the merged status rows. No
   divergent input if both rows are stated.
3. **Security.** None; the reclaim asymmetry is what keeps the ex from displacing a genuine post,
   and both rows preserve it.
4. **Ripple.** Renumbering: §8.7 and §8.8 become §8.6 and §8.7 — 14 and 16 citations respectively
   across `src/hub.js`, `test/`, `examples/`, plus §8.6's own 6. `examples/publish-interface.md`
   headings name §8.5/§8.6. `tools/revert.js` rows are keyed by code strings, not section numbers.
   No vectors.
5. **Archive.** None.
6. **Verdict: SOUND-WITH-CAVEAT.** The saving (~50) is real; the cost is ~36 renumbered citations.
   Keep both tests as separate rows and state the media form of the asymmetry explicitly.

### J. One `version` rule "in §2 or §1"

1. **Proposes** a single rule, early in the document, that `version` MUST NOT go backwards on either
   overwritable file, with the profile/index collision asymmetry (identity: contested vs host) stated
   once.
2. **Really one?** The asymmetry observation is correct and valuable — it is nowhere stated as an
   asymmetry today. The proposed *home* produces a divergent input. §3.6's trailer is scoped
   "*Against a pin, and outside a split*", and `src/profile.js:91` checks the split before the
   version. Input: a reader pinned Alice at chain `[A,B]`, `version` 3; the thief holding `B`
   publishes `version` 4 with chain `[A,B,T]`, which extends the pin and is accepted; Alice's people
   vouch a restore `[A,B,C]` at `version` 4. Under the current rules there is a split at length 2,
   the majority settles it, and Alice's branch is followed at an equal (or even lower) `version`.
   Under a §1/§2 rule "MUST NOT go backwards" with no split carve-out, Alice's recovery is
   `identity: contested` or rejected — the thief wins by incrementing a counter. The carve-out
   cannot be stated in §1/§2 because "split" and "pin" are defined in §3.6 and §7. The rule also
   needs the third monotone member, `top` (§4.3), which has its own reason.
3. **Security.** As placed, it breaks the restore path in exactly the threat-model case. As a §7
   or §3.6 rule with the carve-out, it is neutral and the asymmetry sentence is a gain.
4. **Ripple.** None in code if the carve-out is kept. FINDINGS §3's "index `version` does not
   survive a relocation" is a related gap the consolidated rule would be the right place to close,
   but that is a rule addition.
5. **Archive.** RULINGS §13 Q3 (`prev` cut; rollback caught by version and chain-prefix) — the
   version rule and the prefix rule are designed to work together, which is why they live in §3.6.
6. **Verdict: UNSOUND** at §1/§2. SOUND if the one rule lives in §7 (or §3.6) with "outside a split"
   intact and both verdicts stated; then the two table rows and §7.2 step 9 become citations.

### K. One "what this protocol does not have" list

1. **Proposes** collecting the five no-mechanism statements (§3.3 revocation, §4.5 scheduling,
   §5.3 in-place revision, §5.6 inbox/push, §8.8 DELETE) into one list near §1 or §12, with each
   site keeping one clause and §4.5 disappearing.
2. **Really one?** They are five different absences, each sitting beside the rule that makes the
   feature unnecessary: §3.3's clause is the *reason* a rotated key cannot sign an index or hold a
   number (SPEC-CUTS's §3.3 entry itself says keep it); §4.5's four sentences are the fence against
   a `pending` line (see 5) and say *how* scheduling works without a mechanism, which the list
   cannot; §8.8's sits beside the MAY-remove rule and the MUST NOT about telling users. Since every
   site "keeps one clause", the list is a *duplicate*, and the net word change is about zero, not
   −60. The novice argument is real, and it is the file's strongest.
3. **Security.** None, if the site clauses stay.
4. **Ripple.** Deleting §4.5 renumbers §4.6 and §4.7 (16 and 26 citations). `examples/_seeds/
   pending-gate.md` cites §4.5 for the rejected `pending` line; it is a seed, not run by the
   examples runner, but PLAN.md governs its deletion.
5. **Archive.** `rejections.md` §17 (`pending`, cut 2026-08-23) and `examples/_seeds/pending-gate`.
   §4.5's "There is no mechanism" is the residue of that ruling; a list row must keep it.
6. **Verdict: SOUND-WITH-CAVEAT.** Do it as a short paragraph, keep every site's reason, expect no
   word saving, and mind CLAUDE.md's rule against a second document beside the first — five rows is
   fine, a growing "non-features" section is not.

### L. Appendix A folds into §2's file table

1. **Proposes** adding a media-type column to §2's table and keeping the MUST NOT as a note.
2. **Really one?** Not quite. Appendix A has five rows; §2's table has four kinds. Three Appendix A
   rows are the generated views, which are not "on the wire" kinds in §2's sense — §2 opens with
   "*Everything on the wire is one of four kinds*", and §11 is built on "*a view is never the
   index*". Adding view rows to §2 blurs the signed/unsigned line the spec draws deliberately. So the
   fold is: signed kinds → a §2 column; media "whatever the bytes are" → the same column; the three
   view types → §11; the MUST NOT and its reason → a note under §2's table (SPEC-CUTS keeps it).
3. **Security.** None. `src/fetch.js:13–14` never looks at the media type, and cites Appendix A for
   why.
4. **Ripple.** `src/hub.js:17` (`TYPES`), the `fetch.js` comment, `examples/media` (`.js` and `.md`)
   and `examples/README.md` cite "Appendix A". **Do not renumber Appendix B**: `tools/regen.js:24`
   keys on the literal `'## Appendix B: Test Vectors'` and every vector citation (B.1–B.12) in
   FINDINGS, the examples and `weekend-reader.md` uses that letter. Leave B as B with no A, or accept
   a regen marker change plus a sweep.
5. **Archive.** None.
6. **Verdict: SOUND-WITH-CAVEAT.** Fold in two places, not one; keep Appendix B's name.

### M. "What the host learns" in four places

1. **Proposes** §13.3 as the single home, other sites citing it.
2. **Really one?** Close, but the four sentences enumerate different things and the merged one must
   be the union. §6.5: exists, when, roughly how big. §4.4: a blob of some size exists (media). §5.6:
   how many, how often, how big, **fetched by whom**. §13.3: how many, when, roughly how big,
   **fetched by which address**. "Fetched by whom" is an access-pattern leak the §6.5 sentence
   omits. Also §6.5's first half — "*The audience is never in a header, and the slot tags never
   name a key*" — is a constraint on the construction, not a "what the host learns" statement; it is
   the only sentence forbidding a recipients header, and it should stay in §6.5.
3. **Security.** None if the union is stated.
4. **Ripple.** None.
5. **Archive.** None.
6. **Verdict: SOUND-WITH-CAVEAT.** Twenty words is honest; keep §6.5's "never in a header" clause.

### The two standing cautions

1. **FINDINGS 1.1 first** — agreed, and it also gates **C** (step 6's contest wording) and **B** (a
   pin definition after the majority rule changes reads differently). Not just §3.3/§3.6.
2. **regen.js rewrites from the marker** — confirmed at `tools/regen.js:24,248`. Correct, and it is
   the reason **L** must not rename Appendix B.

## Per-section drops that cut justification beside a MUST

CLAUDE.md: "Justification sitting next to a MUST is load-bearing … it stays." The audit is careful
about this, and most drops are flourishes or worked instances. Five to reconsider:

- **§4.2 wrong-party paragraph, first two sentences** ("*It is reported as `host` anyway, because a
  fourth reader state for this case isn't worth the complexity*"). This is the reason a fold failure
  is `host` and not `identity`, and `identity` is what an implementer would choose (the author
  signed it). The proposed "compress to one clause" is acceptable only if the clause keeps
  "charged to `host` because a fourth state is not worth it". Medium.
- **§6.5 last paragraph** ("*The audience is never in a header, and the slot tags never name a
  key*"). Filed as a duplicate of §6.3 and §13.3, but §6.3 covers only tag blinding; nothing else
  in the spec forbids a recipients header. It is a construction rule beside §6.5's MUSTs. Keep the
  first sentence; the second may go under item M. Medium.
- **§6.4's "about 1.1 KB per direct message"**. The number is the stated justification for the
  floor being a SHOULD, and RULINGS §13 Q7 records the ruling as "a SHOULD, with the ~1.1 KB per DM
  stated". The number is wrong (FINDINGS §4: 498 bytes). The right action is to correct it, or to
  record in the commit that Q7's "stated" clause is being reversed — not to drop it as dead weight.
  Low-medium.
- **§2.1 "A compact JSON serializer never emits one"**. Sits beside "The body MUST NOT contain a
  `\n` byte" and is what tells an implementer the MUST costs nothing — the alternative reading is
  that an escaping step is needed. Seven words; I would keep them. Low.
- **§7.3 frozen-copy paragraph**. The verdict string moves to §13.3, but "*It is not a misbehaving
  host: the host is serving exactly what it has*" — the reason the verdict is `identity` and not
  `host` — is not in §13.3 bullet 2. Carry that clause with it. Low.

Not a MUST-justification but worth a note: §3.4's "*Members can be people, a backup key you keep
yourself, or your host*" is the only place the spec says the **host** may be a recovery member —
which is the threat model's own configuration and the case §13.3's one-other-person bullet is
about. The example carries it; the spec's warning would be stronger with it.

## Bottom line for Stage D

Do B, A, I, L, K, H, E, F, M with the caveats above (in roughly that order of value). Reshape C so
the verdict words move *into* §3.6. Do not do D, G, or J as written: D is three rules for three
roles; G's four sentences answer four different questions (and §9's "no verdict" is a rule the tests
assert); J at §1/§2 loses the split carve-out and hands the identity to whoever increments
`version` first. The realistic saving from the whole section is nearer 300 words than 570, and B
probably adds words. Fix the N/O cross-references and the "twelve" count before handing the file on.
