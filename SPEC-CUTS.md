# What `open-feed-spec.md` may now drop

**What this is.** Stage C's last output and Stage D's only input: a section-by-section audit of the
spec against the twenty-two example `.md`s that landed today, saying which sentences are now
redundant with that material and which are not.

**How to read it.** Each section gets up to four headings.

- **Drop** — goes, and the file that now carries it. Named exactly. Every drop was tested against
  one question: *could a reader holding only `open-feed-spec.md` still implement a conforming
  publisher, reader and hub without it?* If not, it is not here.
- **Keep, and why** — what I was tempted to cut and did not. This half is the point. A MUST without
  its reason gets weakened by the next implementer, and the examples can carry the *argument* but
  not the *warning*.
- **Move, don't drop** — leaves the spec, has no home yet, and where it should go.
- **Missing** — what the spec needs and does not have. `FINDINGS.md` already lists two dozen; those
  are not repeated. Only new ones are here.

**The headline, stated first so nothing below oversells itself.** The drops below come to about
**520 net words of 10,277 — five per cent.** The spec is already tight; the Cutting Campaign got the
archaeology out, and what remains is mostly rule, reason or limit. The material that would actually
make it shorter is not a cut at all, and it is in the last section — **"Shorter by design"** — which
is worth about another 570 words *and* is where the "a novice reads it in an hour" goal is won or
lost. Read that section first if you read only one.

---

## Abstract (145 words)

### Keep, and why

Nothing to drop. Four sentences of "what is this", one of "who is it against". It duplicates §12's
"static hosting is a conforming hub" and §13.1's threat model in one clause each, which is what an
abstract is for.

---

## §1. Conventions and terminology (405 words)

### Drop

- **The non-goals, §1 paragraph 2, last two sentences**: *"This protocol does not pursue
  human-readable wire bytes, continuity for strangers across key loss, or millions of items per
  identity. It scales across identities — many people on a few large hubs is the case that must
  work."* (38 words). This is `GOALS.md`'s "Deliberately *not* priorities" paragraph, restated. It
  is scope-setting for the *project*, not a rule for an implementer, and no conforming behaviour
  turns on it. `GOALS.md` is a kept root document, so nothing is lost. **Lower confidence than most
  drops here**: the "millions of items" clause quietly tells an implementer that an O(n) fold of the
  whole index is acceptable, which is a real design permission. If Stage D wants to keep one clause,
  keep that one.

### Keep, and why

- **The four priorities themselves** ("When this document doesn't settle a question, four priorities
  do, in order"). This is the only *tiebreaker rule* in the spec — it tells an implementer facing an
  underspecified corner which way to lean. `GOALS.md` states the same four, but `GOALS.md` is
  explicitly non-normative, and a stand-alone spec cannot outsource its own interpretation rule.
- **The base64url paragraph and its three lengths** (43 / 43 / 86). Every field in the protocol is
  read against it. `signed-file.md` explains the strict re-encode rule at length, but the *lengths*
  are wire facts.
- **The terminology table.** Nine rows, one line each, and the vocabulary is fixed. The `pin` row is
  the only definition of a pin in the whole document (see "Shorter by design", item B).

### Move, don't drop

- The **Roles** paragraph's second half — *"None is more of the protocol than another (§12)"* — is
  §12's opening sentence said twice. Delete it here, keep §12's. See item A.

---

## §2. Files (572 words: §2 94, §2.1 139, §2.2 77, §2.3 82, §2.4 124, §2.5 33)

### Drop

- **§2.1, last clause of the third bullet**: *"A compact JSON serializer never emits one."* (7
  words). Reassurance, not a rule. `signed-file.md` ("No raw newline in the body") shows a post
  whose text contains a line break and prints the body with no `0x0a` in it, which is the same claim
  demonstrated.

That is the whole of what §2 can shed. 572 words for the entire wire format is not where the fat is.

### Keep, and why

- **§2.1's "Base64 admits multiple spellings of the same bytes, and accepting more than one means
  accepting a file that isn't byte-identical to what the author signed."** A warning, not an
  argument. An implementer who decodes with a lenient base64 and skips the re-encode has a
  signature-malleability hole and no test that shows it. `signed-file.md` builds the respelling and
  watches it fail — but a reader of the spec alone must be told *why* the extra step exists or they
  will optimise it away.
- **§2.1's "A verifier splits at the last `\n`"** is not commentary; it is the parsing algorithm.
- **§2.2's CryptoKit sentence.** *"Some standard libraries (Apple's CryptoKit among them) produce
  randomized Ed25519 signatures."* The instinct on reading "the address is the hash of the body,
  never of the whole file" is that hashing the whole file is simpler and equivalent. It is not, and
  the counter-example is a shipping standard library. Naming it is what stops the change.
- **All of §2.3.** Eighty-two words, and the second paragraph (*"a host that pretty-prints, sorts
  members, or adds a trailing newline makes every file it touches read as forged. Ordinary servers
  and proxies do all three unasked. §8.7 makes serving the exact bytes a MUST for that reason"*) is
  the load-bearing justification for a MUST three chapters away. `no-canonicalization.md` is the
  best example in the set and it still cannot carry this: without it §8.7 reads like fussiness.
- **All of §2.4, including the asymmetry sentence.** *"The rule is asymmetric: only the author can
  sign, so for three of the four a producer that never emits one closes the ambiguity."* Without it,
  MUST-NOT-for-producers-and-SHOULD-for-readers reads as an oversight and an implementer will "fix"
  it in one direction or the other. The `__proto__` fallback clause is normative and stays.
- **All of §2.5.** Thirty-three words, three rules.

### Missing

- **§2's table says the files sit "under a name the hub assigns", and §8.4 says a name is claimed
  first-come by the writer.** Those are two different parties choosing. One of them is wrong.

---

## §3. Identity (2,052 words) — the largest chapter and the least cuttable

### §3.1 First contact (279)

**Drop:** nothing.

**Keep, and why.** *"Six words is 66 bits of entropy — enough that brute-forcing a match takes
centuries on a GPU. Five words (55 bits) would not be enough."* `first-contact.md` does the
arithmetic properly (2,048× the work, 73 quintillion keys). The spec's version is not the argument;
it is the fence. An implementer shortening a phone-call code to four words for usability is exactly
the change this sentence exists to stop, and they will never read the example. Likewise *"A reader
that learns your key from the host it is reading has learned nothing"* — it is the reason for the
MUST directly under it, and `first-contact.md`'s SSH-TOFU contrast is the elaboration, not the
substitute.

The contested-exit paragraph is normative (`MAY carry the current key`, `MUST follow the branch`)
and stays whole.

### §3.2 The profile (166)

**Drop:** nothing. Schema, table, two rules about `name`, both normative.

### §3.3 The chain (427)

**Drop**

- **The worked instance in the "every link carries its recovery list" paragraph**: *"A reader that
  first sees the chain at length three has no recovery list at lengths one and two."* (19 words).
  The sentence before it states the reason in full, and `the-chain.md` ("Every link carries the
  recovery list as it stood before it") walks the length-three reader through the actual failure —
  the walk returning `null` and then succeeding once the carried lists are adopted. A worked example
  in the spec beside a working example in the repo is one too many.

**Keep, and why**

- **The rest of that paragraph.** *"Every link carries its recovery list because a reader meeting
  this identity for the first time holds no other copy"* is the reason `recovery` is REQUIRED on
  every link, which otherwise looks like redundant payload a publisher would drop. And *"The carried
  copy is what a reader with no list at that length adopts; a reader already holding one ignores
  it"* is the rule §3.3's own validity test needs — §3.6 rule 3 says it again, and that repetition
  should be resolved in §3.6's favour only if §3.3 keeps a pointer (item C).
- **"A key rotated away from stays in the chain … That is how a stolen old key is closed without a
  revocation mechanism."** Eleven words that prevent an entire feature being invented.
  `the-chain.md`'s "Revocation, and its absence" is four paragraphs on this; the spec's one clause
  is what the implementer actually reads.
- **"A restore changes the key and nothing else"** and its pinned-reader check. Normative, and
  `FINDINGS.md` already records that the reference implementation enforces it narrowly.
- **"Vouchers MAY be added to a link after it was made"** *including* its because-clause. The MAY
  alone reads as a curiosity; the clause is what tells an implementer that links are not immutable
  records and a profile may be republished with more vouchers on an old link. `contest.md` calls
  this "the price, and the repair" — but a publisher that does not implement it leaves its users
  stuck at contested with no way out, and that is a warning, not an argument.

### §3.4 The recovery list (183)

**Drop**

- ***"Members can be people, a backup key you keep yourself, or your host."*** (13 words).
  Illustration. `recovery-list.md` ("The list MAY be empty") carries it, with the point that a leaf
  does not say which and nothing outside your own app knows.

**Keep, and why**

- **"The count of leaves is public and MUST be, because a majority has to be counted against
  something (§3.6)."** A publisher told only that the list is committed hashes will reach for a
  Merkle root, which hides the size. `recovery-list.md` prices exactly that ("Why not a Merkle
  tree"). The spec needs the one clause.
- **The one-other-person warning**, in full. It is repeated in §13.3, which is correct: §3.4 is
  where the SHOULD is, §13.3 is the list of undefended things. Neither copy is the archaeology.
- **"That flag is presentation, not a verdict (§7.3)."** Seven words standing between a reading app
  and a fourth verdict.

### §3.5 Rotating and restoring in practice (64)

**Drop:** nothing — 64 words, both sentences normative-consequential.

### §3.6 Contests (581) — the largest section in the spec

**Drop**

- **The second half of "The price"**: *"What the single link shape (§3.3) buys here is that Alice
  does not restore *again* to pay it — her people add their vouchers to the link she already made,
  and the keys and posts after it stand."* (38 words). §3.3 already states, normatively, that
  vouchers MAY be added to a link after it was made and why. This sentence is the same fact told a
  second time as a story, and `contest.md` tells it a third with the run staged. Keep *"The price: a
  one-of-two restore against a bare rotation stays contested until a second member vouches"* — that
  is the limit and it stays.

**Move, don't drop**

- **"Two limits a reader cannot escape and an app MUST NOT hide:" and both bullets** (96 words).
  Both already exist elsewhere: the cold-reader limit is §13.3 bullet 3 nearly verbatim, and the
  list-change limit is §3.5's second sentence. **Move the "an app MUST NOT hide" obligation into
  §13.3** — where it belongs anyway, since §13.3 already carries "MUST NOT be reported as one" for
  staleness — and replace the block here with a single cross-reference. Net saving about 76 words,
  and the spec stops having two lists of limits. `contest.md`'s "Two limits, and the only exit"
  stages the cold reader turning away the real Alice, which is the version worth reading.

**Keep, and why**

- **All four rules, and the opening paragraph.** *"Checking that the chain walks is therefore not a
  test of anything"* is the sentence the whole section hangs from. `contest.md` prints `true` for
  the thief's chain to make it concrete, which is illustration of a claim the spec must still make.
- **"A link's `sig` is not a vote: it proves only that whoever held the previous key moved, and the
  thief held it too."** The single most weakenable sentence in the document.
- **"Majority, and not `k`", first three sentences.** *"They differ on one case, and it is the case
  the protocol exists for … Under a majority he cannot, ever, alone."* This is justification sitting
  next to a MUST in its purest form. `contest.md` runs both rules side by side and prints both
  outcomes, and that is better teaching — but an implementer who reads only the spec and sees `k`
  sitting right there in the profile will use it. Note that `FINDINGS.md` 1.1 proposes changing
  §3.3's validity rule so that §3.3 and §3.6 share one bar; **if that ruling is taken, this
  paragraph gets shorter as a side effect and this entry should be re-read then, not before.**

### §3.7 Locations and moving (147)

**Drop**

- ***"Someone with any social path to the departing person finds them; a reader with none does
  not."*** (17 words). The next sentence is *"§13.3 states what that reader sees"*, and §13.3 does,
  in a bullet of its own. `moving.md` ("The reader who never learns the new location is the honest
  limit") stages sis reading an unmarked page. Keep the pointer, drop the summary of the thing
  pointed at.

**Keep, and why**

- **"Because an encrypted post's target is inside the envelope (§6.6), relocation rides along in
  public replies only."** A limit, and one an implementer would not derive.
- **The mechanism sentence** (a reply carries its target's location; a reader that sees a newer one
  in a verified post follows it). That is the relocation protocol, stated nowhere else in normative
  form except as a member description in §5.4.

### §3.8 The reading key (119)

**Drop:** nothing.

**Keep, and why.** The Edwards-to-Montgomery clause is not history — it is the answer to "why two
keys, can't I derive one?", which every implementer asks and some will answer wrongly. *"The reading
key is not socially recoverable"* is a limit. *"An implementation that takes the key from whatever
the host served is encrypting to the host"* is the reason for a MUST, and `envelope.md` shows the
refusal working but cannot supply the warning.

---

## §4. The index (1,101 words)

### §4 opening (150)

**Drop:** nothing. The `entries`-first rule and its "this is not a canonicalization rule" clause
both stay — the clause exists to stop a reader concluding §2.3 has an exception, and
`no-canonicalization.md` closes with the same reassurance for the same reason.

### §4.1 What the entries mean (51) / §4.2 The fold (282)

**Drop**

- **§4.2's "That verdict names the wrong party" paragraph, first two sentences** (43 words): *"That
  verdict names the wrong party: an index that verifies but does not fold was produced by the
  author's own key, not a misbehaving hub. It is reported as `host` anyway, because a fourth reader
  state for this case isn't worth the complexity."* Compress to one clause and keep the SHOULD.
  `the-reader.md` has a whole subsection on this ("There is one case where the label is charged to
  the wrong party") and `the-index.md` narrates it beside a live run. Net saving about 25 words.
  **Do not drop the SHOULD** — *"An app SHOULD word it as the files at this address do not make
  sense rather than as an accusation against the operator"* is the only thing standing between this
  case and a false accusation in a family.

**Keep, and why**

- **"Re-listing at the identical hash is allowed because it is harmless — and because it is the way
  back from a thief who held the current key and withdrew everything the owner wrote."** Every
  instinct says a withdrawn number should stay withdrawn. Without this sentence an implementer
  tightens the fold and closes the recovery path in §3.4's own scenario. `rewrite.md` says the same
  thing better; the spec still needs the fence.
- **All four bullets.** They are the fold algorithm.

### §4.3 `top` (79)

**Drop / compress**

- **The "This matters because" paragraph** (57 words) restates §7.5's rumor rule in full before
  drawing the consequence. Compress to the consequence alone: *"Without it, withdrawing your newest
  post lowers the highest number listed, and every reply to it becomes a rumor (§7.5) raised over a
  post the author deliberately deleted."* Net saving about 29 words. `top-and-rumors.md` stages both
  worlds against the same reply and counts the fetches, which is the version worth reading; but the
  consequence sentence must stay in the spec, because "recompute `top` from the live entries" is the
  natural implementation and it is wrong.

### §4.4 Media and attachments (207)

**Drop:** nothing.

**Keep, and why.** *"Media files are listed in the index rather than left to the posts that
reference them, so that retention is one rule and reaches encrypted posts, whose references the host
cannot read"* is the reason for a design that otherwise looks like duplication — `media.md` calls it
"the whole argument" and it is. *"A media file referenced by a post but not listed in the index is
simply not there"* is a behaviour rule, not a remark.

**Missing** — see `FINDINGS.md` §3, which already records that "the key MUST NOT be reused" has no
stated consequence. Nothing to add.

### §4.5 Scheduled posts (51)

**Move, don't drop.** No example covers this — `pending-gate` was consumed by `your-copy`, and
`your-copy.md` says nothing about scheduling. Keep the *fact* and move it: see "Shorter by design",
item N, where it becomes one line of a single "what this protocol does not have" list along with the
other four no-mechanism statements scattered through the document. It is also filed under the wrong
chapter — it is about posts, not the index.

### §4.6 The index is signed by the current key (119)

**Drop:** nothing. This is the section `weekend-reader.md` names as finding #1 — *"Re-signing the
index is what a restore actually restores"* — and the paragraph explaining why any-chain-key would
be catastrophic is the reason a MUST that costs a publisher a second write is worth paying.

The rotation-window paragraph stays as *content* but is told three times across the spec; see item
D.

### §4.7 Rewriting (123)

**Drop**

- **The worked example**: *"A reader that last saw `version` 1 and returns at `version` 6, across
  two rewrites and an append it never saw, accepts and is told what was withdrawn."* (28 words).
  `rewrite.md` runs exactly this ("A reader that last saw version 1 returns at version 6") as its
  strongest block, with the reader's actual output. It is also the arithmetic slip `FINDINGS.md` §4
  records; dropping the sentence retires the defect.
- ***"the leftover lines are about 6% of the file"*** (9 words). `FINDINGS.md` §4 shows the figure
  is a property of an unstated withdrawal rate (5.5% at 1-in-20, 2.9% at 1-in-40). `rewrite.md`
  carries the measurement with its rate stated. Keep **"It is a privacy decision and never a size
  one"** — the claim survives without the number, and it is the claim that matters.

**Keep, and why.** *"What it does not buy is anything against a host operator who kept every version
they ever served (§13.1)"* — a limit, and the one an app is most likely to misrepresent to a user.

---

## §5. Posts (536 words)

### §5.1 `n` (89)

**Drop**

- ***"The number in the bytes is what makes the file *this* post."*** (12 words). A closing flourish
  restating the two sentences above it. `posts-and-targets.md` proves it by hashing the same content
  at number 2 and number 6 and showing the addresses diverge.

**Keep, and why.** Both reasons above it — the reader's (a host serving post 2 at the path for 7)
and the hub's (half of the reclaim rule). §8.5 depends on the second and would be unimplementable
without it.

### §5.2 `at` (36)

**Drop:** nothing. Thirty-six words, and *"It is never a verdict"* is load-bearing against every
implementer's instinct to sort or gate by time.

### §5.3 `rel` (88)

**Drop**

- ***"A reply, a reaction, and a private message are all posts; there is no separate mechanism for
  any of them."*** (~20 words) — but only as part of item H, which resolves this sentence, §5's
  opening, §5.6's title and §6's opening into one statement. Do not drop it standalone; drop it in
  the merge.

**Keep, and why.** *"or every edit orphans its thread"* is the reason for the SHOULD, and the SHOULD
is only implementable because §7.2 makes the pin keep withdrawn hashes — a dependency
`posts-and-targets.md` spells out and the spec assumes.

### §5.4 `target` (135)

**Drop**

- ***"Without that check the full hash is decoration."*** (8 words). Rhetorical restatement; the
  sentence after it gives the actual attack.

**Keep, and why.** *"an author cannot show one person one post and another person a different post
at the same number and have both threads look right"* — the attack, and the reason the whole hash is
required rather than a prefix. `posts-and-targets.md` stages it with two signed files that both say
"post 12".

### §5.5 `media` (23)

**Drop:** nothing.

### §5.6 Private messages are posts (91)

**Drop**

- **The whole "Two consequences worth stating" paragraph** (66 words). Both consequences are already
  in §13.3, which is the spec's own list of undefended things and which cites §5.6 for one of them:
  *"The shape of a correspondence is visible even when its contents are not"* and *"A signed private
  message is provable by its recipient forever (§5.6)."* §13.3 should absorb the clause *"that is
  what per-post signatures mean"* (~10 words in) and §13.3's citation should then point at §5.6's
  remaining two sentences. `posts-and-targets.md` ("A private message is a post") and `your-copy.md`
  ("The uncomfortable half") both carry the full argument, including the ledger for the sister in
  scenario 1.

  Net saving about 56 words, and see **Missing** below — one clause of this paragraph is also wrong.

**Keep, and why.** *"There is no inbox, no dead-drop, and no push."* Three facts an implementer will
otherwise look for.

### Missing (new — not in `FINDINGS.md`)

- **§5.6's "it can withhold any of them, which to the recipient looks like the sender going quiet"
  contradicts §7.4.** A private message is a numbered post listed in the sender's index; §7.4 makes
  a listed file that is not served **host**, and `posts-and-targets.md` measures exactly that
  (`host` … `post 4 is listed and not served`, and the example is emphatic that "that verdict is
  real, and it does not give mum the message"). Withholding looks like silence only if the host also
  freezes the index, which is §13.3's staleness bullet and a different move. The sentence overstates
  the host's power and understates the reader's. Dropping the paragraph retires the error; if any of
  it is kept, this clause must be reworded.

---

## §6. Encrypted content (905 words)

### §6 opening (110), §6.1 The envelope (147), §6.2 Carrier binding (116), §6.3 Slots (106)

**Drop:** nothing in any of the four.

**Keep, and why**

- **§6's "There is no second signing construction in this protocol."** The sentence that stops the
  next person adding one.
- **§6.1's "the all-zero nonce is safe for exactly that reason, as in HPKE."** Nine words carrying
  the entire safety argument for a fixed nonce. An implementer who caches a content key across two
  posts has built a two-time pad; `envelope.md` and `media.md` both demonstrate the XOR, and neither
  can be relied on to have been read.
- **§6.2, both paragraphs.** The attack paragraph is the warning (*"recipients' clients decrypt it
  and render the original author's words under the new name"*), and the second paragraph (*"Binding
  it as associated data rather than as fields compared afterwards means there is no 'forgot to
  compare'"*) is the reason for the *shape* of the rule, not just its existence. `envelope.md`
  prices the archived JWE version, which needed three fields compared by the client plus a rule
  about absent-versus-present — that history is correctly in the example and correctly not in the
  spec, but the one-sentence design reason must stay.
- **§6.3's "An implementation that ignores the tags entirely and tries every slot is conformant and
  merely slower."** A conformance statement, not a remark.

### §6.4 Padding (153)

**Drop**

- ***"the floor costs about 1.1 KB per direct message, and"*** (10 words). `FINDINGS.md` §4 records
  the measurement at 498 bytes; `padding.md` re-derives it and explains why the old figure predates
  `{key, read, loc}` audience entries. Keep the sentence's frame — *"It is a SHOULD and not a MUST …
  and a minimal implementation that skips it is still conformant"* — and drop the number. A wrong
  number in a spec is worse than no number, and the right number lives in a file that recomputes it
  on every `npm run examples`.

**Keep, and why.** *"Without it, the host can tell a DM from a group post by file size alone."* The
whole justification for the SHOULD, in fourteen words. And the `bucket` definition, the
indistinguishable-width MUST and the not-derived-from-recipient-state MUST NOT — `padding.md` builds
two non-conformant envelopes to show a recipient counting the true audience, which is the best
argument for that MUST NOT anywhere, and the spec still has to state it.

### §6.5 The audience is inside (168)

**Drop / compress**

- **The counterfactual sentence** (51 words): *"Without the entry naming a person, a recipient who
  knows a member only from the envelope holds an X25519 key and nothing that leads to a profile, so
  it cannot encrypt a reply to them: the reply reaches everyone else, silently, and the thread
  splits in half with no error anywhere."* Compress to one clause — *"Without the anchor key and the
  location, a recipient cannot verify a co-recipient's profile, and its reply silently reaches only
  the members it already knew"* — for a net saving of about 26 words. `envelope.md` ("The
  counterfactual is the point") runs it. **Do not drop it outright**: it is the reason all three
  members are required rather than just `read`, and an implementer trimming the audience entry to
  reading keys breaks scenario 3 with no error anywhere, which is precisely the failure mode that
  produces no bug report.
- **The last paragraph** (30 words): *"The audience is never in a header, and the slot tags never
  name a key. What the host learns is that an encrypted post exists, when, and roughly how big."*
  The first half restates §6.3's blinding rule; the second half is §13.3's shape-of-correspondence
  bullet and §6.4's own justification. `envelope.md`'s "What the host learns" carries it.

**Keep, and why.** *"a publisher MUST include itself in the audience or it cannot read its own
outbox"* — a MUST whose reason is the entire content of the MUST.

### §6.6 An encrypted post's target (70)

**Drop:** nothing standalone. Its last sentence overlaps §3.7's closing sentence; resolve in §3.7's
favour only if §6.6 keeps a pointer.

---

## §7. The reader (1,027 words)

### §7 opening (52), §7.1 (192), §7.2 (229)

**Drop:** nothing.

**Keep, and why**

- **"The order of operations below is normative — each step supplies what the next one checks, and a
  reader that reorders them is checking something else."** `the-reader.md` demonstrates two adjacent
  pairs (step 2 before 4; step 4 before 5) and is much more convincing. The spec's sentence is what
  makes the order *binding*, which no example can do.
- **§7.1 step 1's "the reader cannot tell a garbled file from a substituted one."** The reason a
  parse failure is `identity` and not `host` — a verdict assignment nobody would guess.
- **§7.2 step 8's second paragraph.** *"A garbled file, a 404, an index signed by a rotated-out key,
  and an honest host caught mid-rotation all produce exactly this, and the reader cannot tell them
  apart."* This is a limit and the price of having three verdicts, stated where the cost is paid.
  `the-reader.md` calls it "the trade §7.2 makes on purpose". Keep.
- **§7.2 step 9's media exemption.** Normative and easy to get wrong.

### §7.3 Three verdicts, and notes (182)

**Drop**

- **The frozen-copy paragraph** (60 words): *"A frozen copy — an old profile served forever by a
  host the author has left — reads as identity: an older profile than the one this reader saw,
  because two claims about one identity are in play and this reader has seen the newer one. It is
  not a misbehaving host: the host is serving exactly what it has."* Three reasons it can go: the
  rule is already normative in §7.1 step 6 (*"a lower `version` than the pin is identity"*); §13.3
  bullet 2 already carries the verdict string verbatim, in context, as a limit; and `moving.md` and
  `the-reader.md` each stage it end to end, including the point that it is emphatically not `host`.
  Replace with a pointer to §13.3 (~8 words). Net saving about 52 words.

**Keep, and why**

- **The three-row table, and "a conforming reader MUST NOT invent a fourth."**
- **"An implementation that promotes a note to a state has four states and one of them cries
  wolf."** Seventeen words. `the-reader.md` has a section called "Why three, and not more" that says
  it better and longer, and this sentence is still the thing that stops the change.

### §7.4 Posts (125)

**Drop:** nothing. `FINDINGS.md` §2 already records that the unresolved-target marking is
implemented in step 11.

### §7.5 Targets, and the rumor rule (217)

**Drop:** nothing.

**Keep, and why.** *"Without them, a thousand replies naming numbers that never existed cost a
thousand fetches aimed at somebody else's host and print a thousand messages."* This is the
strongest case in the whole audit for keeping a reason. `top-and-rumors.md` measures it — 4 fetches
and 1 line bounded, 4,000 and 1,000 unbounded — and `weekend-reader.md` records that the naive
per-reply implementation is what a second implementer wrote first, *from the text*, before the bound
existed. The bound is unnatural; the sentence is why anyone implements it. Likewise the beacon
paragraph, which is a limit and a MAY.

---

## §8. The publish interface (1,029 words)

**Drop: nothing in the entire chapter.** This surprised me, and I checked it twice against
`publish-interface.md` and `weekend-publisher.md`, which are 2,900 words between them. §8 is nine
sections of interface plus, in each, one sentence saying what breaks without it, and every one of
those sentences describes a failure that is silent:

- **§8.1** — *"The naive retry silently drops the other device's post, and the loss reads to every
  reader as an ordinary withdrawal."* `weekend-publisher.md` calls this "the single easiest thing to
  get wrong in the whole protocol". It works perfectly until two devices are used at once.
- **§8.2** — *"A pinned reader's check that a number at or below the old top cannot appear that was
  never there (§7.2) is the same check that catches a host backdating a post."* The reason a
  publisher's rule has to be strict is that a reader cannot tell a sloppy device from a hostile
  host. Drop it and the MUST looks like pedantry.
- **§8.3** — thirty-six words, both halves normative.
- **§8.4** — *"Otherwise a brand-new identity on a perfectly honest hub reads as `host: no index
  served` at the moment someone signs up."* Without it nobody writes the empty index.
- **§8.5** — the subtlest rule in the spec, and every clause is doing work: *"Not any chain key"*
  (with its reason), *"Without this, create-once turns an unchecked write into a permanent block"*,
  and *"The rule does not turn around"* with its three asymmetries. `publish-interface.md` puts it
  well: the repair "must be asymmetric or it stops being a repair".
- **§8.6** — sixty-seven words including the attack it prevents.
- **§8.7** — *"or no browser-based reader can read across hosts"* is why CORS is a MUST and not
  operational advice. *"Whatever a hub does, it can never write as you"* is the ceiling, stated at
  the one place a hub implementer is reading.
- **§8.8** — *"an app MUST NOT tell a user that withdrawing erased anything."*

**Move, don't drop.** §8's opening clause *"bring-your-own-client is a security property, because a
hub that ships the app can take the key"* is the one candidate. It is `GOALS.md`'s decision and
`publish-interface.md` devotes a section to it. I am **not** proposing the drop: it is twenty-five
words, and it is the only thing in §8 that explains why the chapter exists at all rather than being
left to each hub. If Stage D wants it gone, it goes to `publish-interface.md`, which already has it.

**Missing:** `FINDINGS.md` §3 already covers the 400 status and the §8.1 "own version" ambiguity.

---

## §9. Fetching (386 words)

**Drop: nothing.** Every sentence is either a rule, a range, or the reason a rule takes the shape it
does — *"a hostile hostname tells you nothing … Checking after connecting leaves a rebinding
window"*, *"that disagreement is itself the bypass"*, *"A reader that hits a cap has no verdict, not
an accusation."* `fetching.md` is 2,158 words on the same material and is the right place for the
SSRF frame, the pingback history and the DNS-rebinding walkthrough. It is not a substitute for a
single line of the section: this is the one chapter where a miss is a vulnerability, and it is the
chapter a second implementer reads *instead of* knowing the field.

The enumerated ranges in particular must stay enumerated. `fetching.md` says why better than I can:
two implementers who agree on the sentence "block private addresses" and disagree on the list have
produced a bypass, and the one with the shorter list is the one whose users get hurt.

**Missing:** `FINDINGS.md` §3 already records Teredo and the rest of the IPv6 list. One addition
below, under §13.4.

---

## §10. Your copy (197 words)

**Drop**

- **The second bullet** (48 words): *"Anyone you published to is a backup nobody set up on purpose.
  Your readers hold what they were allowed to see and can hand it back; it verifies as yours. It
  covers only what they could see and proves nothing about completeness — a fallback, not a
  guarantee."* It is an emergent property, not a rule: no publisher, reader or hub behaviour depends
  on it, and nothing is unimplementable without it. `your-copy.md` stages it completely — mum hands
  five files back, all five verify, and the example is scrupulous about the limit (her index is
  version 4 where alice's is 7; post 4 was a message she was never in the audience for). **The one
  repair Stage D must make**: the third bullet ends *"can ask a named relative for a named list"*,
  which loses its antecedent. Add three words to it ("… can ask a relative who was reading for a
  named list"). **This is one of the drops I expect argument about** — see the report.

**Keep, and why**

- **"There is no export format and no bundle to define, because the file on the wire is already the
  archive format."** This is the sentence that stops the next person specifying an export bundle,
  and `your-copy.md` shows exactly what a bundle would have cost by comparison with AT Protocol's
  CAR files.
- **"Leaving is therefore writing the same files somewhere else. The host is asked for nothing, and
  there is nothing for it to refuse."** Floor item 3, and §13.1's promise depends on it.

**Missing:** `FINDINGS.md` §3 already covers the index `version` not surviving a relocation and the
audience being unavailable to a rebuilding app.

---

## §11. Generated views (211 words)

**Drop: nothing.**

**Keep, and why.** The section is 211 words for a whole interop surface, and its longest sentences
are all fences:

- **"An implementation MUST NOT treat a view as evidence of anything."** `views.md` explains why
  this earns a MUST rather than a SHOULD better than the spec does — *the shortcut works*, a reader
  built on `feed.json` displays posts correctly for every honest host forever and provides none of
  the guarantees — but the MUST has to be in the spec.
- **The `urn:openfeed:` id rule with its reason** (*"a URL id makes every post reappear as unread …
  on the day the author relocates"*). Without the reason, JSON Feed 1.1's own guidance says to use
  the URL, and an implementer following the more specific spec will use the URL.
- **The h-card fragment caveat.** *"a reader that learned the key from a page the host served has
  learned it from the host, and §3.1 still applies."* This is the trap the section itself creates.

---

## §12. Conformance (257 words)

**Drop: nothing as prose — restructure instead.** See "Shorter by design", item A: every sentence in
§12 is "role X MUST do Y (§n)", which is a table wearing paragraphs. The conversion is worth about
100 words and turns the section into something a second implementer can tick off, which is what a
conformance section is for. `publish-interface.md` and `weekend-reader.md` both effectively use it
as a checklist already.

Its opening sentence duplicates §1's Roles paragraph; keep this one, drop §1's second half.

---

## §13. Security considerations (765 words)

### §13.1 The adversary this is built against (217)

**Drop: nothing.** This is the section `CLAUDE.md` says to read before touching anything
security-relevant. The "what it does not give them" paragraph ends in a MUST NOT about marketing,
which is the only rule in the spec aimed at a product decision and is worth more than its length.
The pinned-state paragraph (*"Every rewriting attack he can mount is against what a reader has not
yet seen"*) is the one place the whole security claim is stated as a claim.

### §13.2 Where a clock appears — the whole list (83)

**Drop: nothing.** Eighty-three words, and its value is that it is *complete* — a table that can be
falsified by adding a clock anywhere. `contest.md` and `posts-and-targets.md` both lean on it.
Keeping a claim that can be checked is cheap.

### §13.3 What is not defended, stated plainly (331)

**Drop: nothing, and it grows slightly.** As the brief anticipated, this is limits, and it stays. It
should **absorb** three things moved out of other sections:

- the *"an app MUST NOT hide"* obligation from §3.6 (attach it to bullet 3, the cold reader);
- the *"that is what per-post signatures mean"* clause from §5.6 (bullet 5);
- nothing from §7.3 — bullet 2 already carries the frozen-copy verdict string.

Net effect: +20 words here, −188 elsewhere.

### §13.4 Implementation notes (100)

**Drop: nothing.** Five bullets, all imperative, none carried by any example in normative form.

**Missing (new — not in `FINDINGS.md`)**

- **Nothing bounds attacker-supplied work inside one profile.** §9 bounds bytes, sockets, redirects
  and identities; §13.4 bounds *stores*. But `chain` and `recovery.leaves` are arrays inside a body
  that only has to fit the 1 MB cap, and a reader verifies one Ed25519 signature per link plus one
  per voucher, and hashes one leaf per voucher check. A 1 MB profile is on the order of ten thousand
  links, each with vouchers. `src/profile.js` has no length bound of any kind. The natural home is a
  sixth §13.4 bullet — *"bound the number of links in a chain and members in a recovery list a
  reader will process"* — or a clause in §9's "Bound everything". No example covers this, so it is a
  Move as well: it wants a paragraph in `fetching.md` or `the-chain.md`.

---

## Appendix A: Media types (93 words)

**Drop: nothing as prose.** The MUST NOT and its reason (*"A reader that refuses on a header is
refusing on something the author never signed and the host chose"*) is a fence, and `media.md` notes
that nothing the protocol checks reads that header.

**Move, don't drop.** The five-row table is a column of §2's file table. Folding it there retires an
appendix and about 30 words. See item O.

---

## Appendix B: Test Vectors (586 words, of which ~250 is narration)

**Drop: nothing.** The narration per vector is one to three sentences and each one names the section
the vector proves. `tools/regen.js` owns this appendix and rewrites it from its marker to the end of
the file, so Stage D should treat it as generated, not edited.

**Missing:** `FINDINGS.md` §3 already records that B.12 gives the six indices and not the six words.

---

## Summary table

Word counts re-derived, not estimated. Per-chapter counts come from an awk pass that sums
the words between `## ` headings, headings included; the ten words of the title and version line
are excluded from the rows and included in the totals. The counts of the individual passages
proposed for dropping were taken by piping each quoted passage to `wc -w`.

| section | words now | after the drops | note |
| --- | ---: | ---: | --- |
| Abstract | 145 | 145 | nothing to cut; it is five sentences |
| §1 Conventions | 405 | 367 | non-goals go to `GOALS.md`; the priorities stay as a tiebreaker |
| §2 Files | 572 | 565 | one clause. 572 words for the whole wire format is not the fat |
| §3 Identity | 2,052 | 1,889 | biggest chapter; two worked examples and one repeated limit list |
| §4 The index | 1,101 | 1,010 | one worked example, one wrong number, two compressions |
| §5 Posts | 536 | 460 | §5.6's consequences move to §13.3, which states one of them correctly |
| §6 Encrypted content | 905 | 839 | a wrong number, a duplicated privacy claim, one compression |
| §7 The reader | 1,027 | 975 | only the frozen-copy paragraph; §13.3 and §7.1 both carry it |
| §8 Publish interface | 1,029 | 1,029 | **no cuts.** Every explanation describes a silent failure |
| §9 Fetching | 386 | 386 | **no cuts.** The one chapter where a miss is a vulnerability |
| §10 Your copy | 197 | 149 | the readers-as-backup bullet is an emergent property, not a rule |
| §11 Generated views | 211 | 211 | **no cuts.** A whole interop surface, all of it fences |
| §12 Conformance | 257 | 257 | no prose cut — restructure as a table (item A), worth ~100 |
| §13 Security | 765 | 785 | grows: absorbs the moved limits from §3.6 and §5.6 |
| Appendix A | 93 | 93 | no prose cut — fold the table into §2 (item O), worth ~30 |
| Appendix B | 586 | 586 | generated by `tools/regen.js`; not Stage D's to edit by hand |
| **total** | **10,277** | **9,756** | **−521, or −5.1%** |

Then the structural work below, which is worth about another 570 words:

| | words |
| --- | ---: |
| now | 10,277 |
| after the drops | 9,756 |
| after the drops and "shorter by design" | **~9,190 (−10.6%)** |

**The honest reading of that table.** Five per cent is what is left after a cutting campaign that
already ran. The spec is not padded. If Stage D's target is a *much* shorter document, it will not
be reached by deleting sentences — it will be reached by the section below, and by asking whether
any *rule* can go, which is a different and larger question than this file was asked.

---

## Shorter by design — where two rules could be one

`PLAN.md` says the lever that moves length is design, not compression. These are the places where
the spec says one thing more than once, or says in three paragraphs what a table says in six rows.
Every one of them also makes the document easier for a novice, which is the goal the word count is
only a proxy for. Ordered by value, not by size.

### A. §12 is a table wearing paragraphs (~100 words, and much more usable)

Every clause in §12 has the shape *role* + *MUST* + *rule* + *(§n)*. Three columns — role,
requirement, section — with a MUST/SHOULD column, is shorter, is checkable line by line, and is what
a second implementer actually wants at the end. It would also make the publisher/reader/hub split
visible at a glance, which is currently three prose paragraphs a reader has to diff by hand.

Delete §1's *"None is more of the protocol than another (§12)"* at the same time: §12's opening says
it, better.

### B. The pin is described in five places and defined nowhere (~70 words, big clarity gain)

A pin is the reader's entire state machine, and today it is assembled from: §1's terminology row,
§3.6 rules 1–2 (chain, per-length recovery lists), §7.1 step 3 (recording lists), §7.2 step 9
(version, address, top, live set, withdrawn hashes), and §13.1's summary (*"the chain with a
recovery list at every length it reaches, the index, the live set and the withdrawn hashes"*). That
is four enumerations of one structure, none of them normative, none complete.

**Give §7 one short normative list of what a pin holds**, and let §3.6, §7.1, §7.2 and §13.1 stop
re-enumerating. `CLAUDE.md`'s "Traps" section already has to warn agents that the pin's fields are
distinct from the wire members (`profileVersion`/`profileHash` versus `version`) — which is a sign
the spec never says it. This is the single highest-value structural change in the list: it shortens
four sections, it makes the reader chapter implementable in one pass, and `FINDINGS.md` §3's "the
index `version` does not survive a relocation" is exactly the kind of gap a defined pin would have
caught.

### C. §3.6 and §7.1 step 6 state the contest outcome twice (~45 words)

§3.6 ends: *"Against a pin, and outside a split: `version` MUST NOT go backwards, and the same
`version` with a different address is contested."* §7.1 step 6 says: *"With no split, a lower
`version` than the pin is identity, and an equal `version` at a different address is identity:
contested"*, plus a restatement of the majority outcome. Pick a home. The natural split is: §3.6
owns the *rule*, §7 owns the *order*, and step 6 becomes "apply §3.6".

### D. The rotation window is narrated three times (~40 words)

§3.5 (write the profile then the index), §4.6 (*"The consequence is a window"*), §7.2 step 8 (*"an
honest host caught mid-rotation"*). Three tellings of one event across three chapters. State it once
in §4.6 — which is where the MUST that creates it lives — and have §3.5 and §7.2 point.

### E. §2.4's four hazards want a table (neutral on words, large on reading speed)

`json-hygiene.md` opens with a four-row table (what / what `JSON.parse` does / the problem) and it
is instantly legible. §2.4's first paragraph is the same four items as a run-on sentence, and the
second paragraph is the four items again as producer/reader rules. A single table with three columns
would replace both paragraphs and make the `__proto__` exception visible as an exception rather than
as a trailing clause.

### F. §4.1's shapes and §4.2's legality rules are one table (~50 words)

§4.1 gives four line shapes; §4.2's four bullets give the legality rule for each of those shapes,
plus `top`'s floor. Merging them into one table — *line* / *means* / *legal when* — puts the fold's
rules beside the grammar they constrain, and removes the need to hold §4.1 in your head while
reading §4.2. §4.2's remaining prose is then just the fold definition, the wrong-party clause and
the re-listing reason.

### G. "This is not a fourth verdict" is said four times (~35 words)

§7.3 (*"a conforming reader MUST NOT invent a fourth"*), §4.2 (*"a fourth reader state for this case
isn't worth the complexity"*), §9 (*"That is not a fourth verdict (§7.3) — it is the absence of
one"*), §13.3 (*"it is not a protocol state and MUST NOT be reported as one"*). Say it once, in
§7.3, as the rule; the other three become citations. A reader currently has to check whether the
four statements differ, and they do not.

### H. "Everything is a post" is said four times, and §5.6 could stop being a section (~40 words)

§5's opening, §5.3 (*"A reply, a reaction, and a private message are all posts; there is no separate
mechanism for any of them"*), §5.6's title and first line, §6's opening (*"Three visibilities, one
mechanism"*). Once, in §5's opening. With the "two consequences" paragraph moved to §13.3 (above),
§5.6 is down to two sentences and folds into §5.3 as a `rel`-agnostic clause plus "there is no
inbox, no dead-drop, and no push".

### I. §8.5 and §8.6 are the same rule twice (~50 words)

§8.6 opens by saying so: *"This is the content-addressed twin of §8.5."* One section — "a collision
is resolved, not refused" — with two rows for what "the owner's file" means (a numbered post:
declares its number *and* is signed by the current chain key or listed at that number and address; a
media file: hashes to the name it is offered at) would state the shared principle once and the two
tests once each. The asymmetry paragraph (*"The rule does not turn around"*) then covers both.

### J. `version` is a rule stated in five places (~40 words)

The profile's table row, the index's table row, §3.6's trailer, §7.1 step 6, §7.2 step 9. And a
reader must notice for themselves, from two distant sections, that the same `version` at a different
address is `identity: contested` on a profile and `host` on an index — a genuine asymmetry, never
stated as one. **One rule, in §2 or §1**: what `version` is, that it MUST NOT go backwards on either
overwritable file, and what a same-version-different-address collision means for each. The five
places become citations, and the asymmetry becomes visible instead of derivable.

### K. One "what this protocol does not have" list (~60 words, and best for a novice)

The spec currently scatters five no-mechanism statements: §3.3 (no revocation), §4.5 (no scheduling
mechanism), §5.3 (no in-place revision, no version history), §5.6 (no inbox, no dead-drop, no push),
§8.8 (no DELETE verb). Each is a paragraph or a section in the chapter where somebody would look for
the feature.

Collect them into one short list near §1 or §12 — *"what this protocol does not have, and where the
absence is explained"* — and each site keeps one clause or disappears. §4.5 disappears entirely,
which also fixes its filing: it is a section about posts sitting inside the index chapter.

This is the item I would do first if the goal is "a novice reads it in an hour or two". A reader's
biggest cost in a small protocol is not understanding what is there; it is repeatedly discovering
that something they expected is absent, three chapters after they started looking.

### L. Appendix A folds into §2's file table (~30 words, one fewer appendix)

Five rows mapping kind to media type, where §2 already has a table whose first column is exactly
those kinds. Add the column; keep the MUST NOT sentence as a note under §2's table. The spec loses
an appendix and a cross-reference.

### M. Two sections carry "what the host learns" (~20 words)

§6.5's closing sentence, §4.4's closing clause, §5.6's paragraph, §13.3's bullet. §13.3 is the right
home for all of it — it is the list of undefended things — and each other site keeps a citation.

---

## Two standing cautions for Stage D

1. **`FINDINGS.md` 1.1 changes §3.3 and §3.6 before any of this applies to them.** If the owner
   takes the proposed fix (a link with no `sig` is valid at `k` **and** a majority), §3.3's validity
   rule and §3.6's "Majority, and not `k`" paragraph both get shorter as a consequence, and the
   "one-of-two restore stays contested" price is stated once instead of twice. **Rule on that first;
   re-read the §3.3 and §3.6 entries above afterwards.** Cutting them now and fixing the defect
   later means doing §3 twice.

2. **`tools/regen.js --write` rewrites Appendix B from its marker to the end of the file.** Anything
   Stage D places after Appendix B is lost. This file proposes no additions there, but the summary
   table's Appendix B row should be read as "leave it alone", not as "it survived the audit".
