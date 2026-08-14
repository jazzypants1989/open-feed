# Handoff

**This file is scaffolding, not a record.** It exists to get one fresh agent productive on the
work in flight. When that work lands, delete it — the repo keeps design history in `git log`
rather than in documents (see `CLAUDE.md`, "Rules for this file").

**§4 is the live decision and the reason this file still exists.** Everything else is context for
it.

---

## 1. Where things stand

| | |
|---|---|
| Branch | `spec/review-fixes`, ahead of `main` |
| License | Apache-2.0 |
| Tests | `npm test` → 120 passing |
| Vectors | `node tmp/regen.js` → all pass, exits non-zero on drift |
| Spec | 1110 lines total, 684 core (§1–§14). **There is no line budget** — see `CLAUDE.md` |

The protocol has a reference implementation that goes end to end: a Level 1 verifier, a Level 2
publisher, and a test that runs one against the other over a real TLS socket. Nothing outside this
repo has read the spec or implemented it. `src/` is zero-dependency; `src/fetch.js` is the only
module that opens a socket, and that is a property worth keeping.

### Not built

The CLI, `src/consumer.js`, the inbox (§10, Level 3), pagination (§7.4), §15, §16, Appendix E
bridges, and the export bundle (§14).

---

## 2. Orientation, in this order

1. `CLAUDE.md` — short, and its rules bind you.
2. `open-feed-spec.md` §13.2 before anything security-relevant. The threat model is a family hub
   whose operator may be an abuser; it drives more of the design than it looks.
3. `git log` and read the messages. They are long on purpose and record reasoning, including
   alternatives rejected with reasons.
4. `npm test` and `node tmp/regen.js`. Both green before you change a line.
5. `test/e2e.test.js` last, as the worked example: it is currently the only place the layers are
   composed the way a real consumer composes them.

---

## 3. What the last pass found, and the shape of it

Two defects, one root cause, and the root cause is what to look for next.

**The skip-link takeover** (fixed earlier): `_skip` anchors were followed on the identity chain,
and the skip path never checked the tip's own `prev`, so a serving-path attacker holding no key
could splice a forged tip onto an honest history.

**The false-alarm freeze** (fixed this pass): §5.3.1's compare rule fired on bytes nothing had
verified. A serving-path attacker holding **no key at all** served one self-signed document at the
identity URL and the consumer permanently froze that identity — refusing every later version,
including honest ones, until a human deliberately re-pinned. §16.6 made the same freeze reachable
by any peer publishing one false pin; §16.5 made it reachable by any stranger who could POST to an
inbox. To the reader it was indistinguishable from their family member's publisher attacking them.

Both are the same mistake: **a consumer acting on bytes before they are chain-connected or
key-authenticated.** An identity document is its own key source (§5.3 step 1), so a freshly-fetched
tip is authenticated by *nothing* until a walk connects it to a pin. `src/chain.js` said so in a
comment and then violated it ninety lines later.

The fix that generalizes: §5.3.1 now defines what an *observation* is — a version obtained from
that `seq`'s derived URL, or one a walk connected to the pin. Anything else is a claim. Where a tip
conflicts with a pin, one fetch of the retained copy settles it: still matching the pin means the
tip is forged (noise, §12's retry ladder); a retained copy that has *moved* is itself the §5.4
violation and is equivocation. `walkToPin` now buffers observations and commits them only once the
walk anchors, and `PinStore.reconcilePeerPin` is the path a peer's assertion takes instead of
`observe`.

**Assume there are more of this class.** Sites not yet exercised because the code does not exist:
§10.2/§10.3's read-before-verify boundary in the inbox, and the callers of
`assertRelocationCarriesForward` and `resolveFork` — both are pure functions that verify nothing
about their inputs and currently have no non-test caller, so the precondition is unenforced rather
than met.

---

## 4. THE DECISION: what to cut

The owner's stated goal is **the shortest spec that still covers its bases**, balancing simplicity,
flexibility, and capability. This section is the proposal for that, and nothing below is decided.

The test for each candidate is **"does the guarantee survive without this?"** — not "is this
useful?", because everything here is useful, which is how it all got added.

### What is not on the table

Two chains, pin-and-walk, the compare rule, a manifest that commits item **bytes**, the recovery
key, migration, export. Without these, *"our hub deleted Mom's posts and pretended she never wrote
them"* is indistinguishable from *"Mom left"* — and that distinction is the entire protocol. Cut
anything here and there is no reason to prefer this over RSS with signatures.

### Candidates, strongest first

**1. Skip links (§9.1.1) — cut.** They buy O(log n) pin reconnection against §13.4's history-bytes
cap. They cost: one identity takeover already; a `contiguous` flag that propagates into
`assertHistoryInvariants` and degrades it to an endpoints-only check; a "weaker witness" caveat in
§16.2; anchor-legitimacy rules; and 15 references in `chain.js` alone. A family manifest on a daily
cadence is ~365 versions a year and walks linearly without trouble. The lapsed-reader problem they
partly address is better answered by §9.3's checkpoint or by accepting a peer's pin as a starting
point. **This is the single largest simplification available and the guarantee does not depend on
it.**

**2. The derived lag bound (§9.4 invariant 3) — cut the median, keep a ceiling.** It is the only
rule in §9 that can report a violation against an honest publisher. It only catches a publisher
*deviating* from its own rhythm — one that simply declares a slow cadence is unbounded by it — so
the load-bearing rule is already the consumer's own absolute ceiling, today a trailing SHOULD.
Promote the ceiling, delete `lagBound`, the 10-version window, and the MUST-NOT-fall-back-to-the-floor
rule with it. Also fixes the hole that a first-contact consumer has *no* deadline indefinitely.

**3. Rosters (§15.4) — cut.** The spec says outright that they are not ready and lists four unmet
conditions. Carrying unshippable normative text is worse than a stated gap: it reads as available.
§11.2's rule (any audience larger than one needs a membership document) survives as the statement
of why group audiences are not in scope.

**4. The pins document (§16.1) — cut, keep §16.5.** The spec already says "reach for §16.5 first."
§16.1 publishes a reading graph *and* was the doorway to the lockout above. Item-carried pins ride
traffic that already exists and disclose nothing an interaction has not. The cost is real and
should be stated when deciding: §16.2.2's recovery propagation, §16.2.3's timestamping, and
§16.2.4's first-contact corroboration all need third-party pins, which §16.5 deliberately cannot
carry. This one is a genuine trade, not a free win.

**5. Threshold recovery (§4.5, the k-of-n part) — defer.** Nobody has used it. It adds an array
where a scalar would do, plus the read-the-threshold-from-the-pinned-ancestor subtlety, which is
the kind of rule that gets implemented wrong. Single-key recovery keeps the exit story whole.

**6. Checkpointing (§9.3) — defer.** It strands lapsed readers, and the spec spends a paragraph
apologizing for it. It does not raise the live-set ceiling (§13.4 says so), because feed rotation
is the real bound. Its escape clause also complicates invariants 1 and 2.

**7. Fork resolution (§5.5) — defer.** Surfacing a fork is the MUST; automatically picking a branch
is a nice-to-have that depends on candidate 5. `resolveFork` also has no verified-input contract.

### What this adds up to

Roughly: the core keeps every property §13.2 claims, and loses most of the machinery that produced
the bugs. Candidates 1, 2, 5, 6 and 7 are all *optimizations for scale this protocol does not have
and explicitly does not target* — §13.4 already says Open Feed scales across identities, not in
items-per-identity, and a global-scale aggregator is out of scope. They were built for a size the
design says it will never be.

Before cutting anything, `tmp/skiplinks-prototype.js` and §9.2's storage claims should be measured
rather than argued (see §5c) — the numbers may defend candidate 1, and if they do, that is worth
knowing.

---

## 5. Queue, after the decision

**a. Delegation, `use: "delegated"`.** Design settled, text undrafted; the argument is recorded in
`CLAUDE.md`. Deliberately sequenced after §4, because its central claim — the pinned chain is the
revocation substrate — depends on what survives.

**b. `src/consumer.js`.** The only statement of how the layers compose into a §12 Level 1 reader is
`walkChain(...)` inside `e2e.test.js`, and a test is the wrong place for it. Make it a class that
reports **per-check results rather than a boolean**; the CLI is then a formatter over it and
`e2e.test.js` shrinks. Do this before the CLI.

**c. Measure the storage claims.** §9.2 gives a ten-year example in gigabytes and SHOULDs three
mechanisms. The publisher makes it measurable: vary cadence and rotation, put a real table in the
README. This is also input to §4's candidate 1.

**d. The exit walkthrough, as an executable adversarial scenario.** The protocol's central claim
and nothing tests it: §3.4 migration, §4.5 recovery, §14 export, and the claim that they compose.
Hub A serves Mom; Mom re-establishes at hub B with `predecessor` co-signed by a recovery key
committed in a pinned ancestor; hub A keeps serving an unchanged chain and declines to publish a
`successor`. Then the parts that are easy to get wrong — back catalog byte-verbatim rather than
re-signed, invariant 5 binding the successor's genesis to the predecessor's final state, relation
targets resolving transitively, §4.4's `(author, id)` record surviving the move. Then the
adversarial variants: a competing `successor` from hub A (§5.5 must separate them); a recovery key
hub A generated at onboarding (§4.5 says there is then no exit — demonstrate it); and the
genesis-equivocation attack, whose defence is one relative comparing one hash.

**e. Pagination (§7.4).** `reconcileFeed` now takes `partial`, but nothing exercises it because no
caller paginates.

**f. The inbox (§10),** Level 3, the first thing here that accepts input from strangers. Three
places will bite, all documented and none implemented: §10.3's read-before-verify /
write-after-verify rule; §10.4's three existence oracles; and §11.1.1, which §13.14 calls "the
failure mode most likely to be introduced by an implementer being *helpful*."

**g. A language-neutral conformance corpus.** Appendix D is positive-only and `negative.test.js`
lives inside this repo's test framework, so neither proves anything about anyone else's
implementation. Extract both into `conformance/` — a directory of cases, each carrying the
documents, the identity document to resolve against, and the expected verdict and error class —
with a thin runner here. This is the artifact that turns a specification into a protocol, and it is
the honest answer to "nobody outside this repo has read it": a corpus is reviewable in a way 1100
lines of prose is not. Worth much more now that the repo has a license.

**h. The product spike, still untaken.** None of this matters if the family will not use the app,
and that is knowable in a week with throwaway code. Protocol work compounds; the product question
is a coin flip that invalidates all of it if it lands wrong.

---

## 6. Still open, not yet argued

- **`_rel` type registry governance**, jointly with Appendix B.2's `proof` tokens. Both are §2.1
  vocabularies and deserve one answer.
- **`_syndication` shape**, pending a call on `tmp/syndication-prototype.js`. Leading candidate: a
  §16-mold document, probably unchained (the `follows` precedent).
- **Author-side dual signing**, parked. The only route to verified cross-protocol authorship.
  Taking it up means deciding whether "one signing construction" governs this protocol's artifacts
  or everything a publisher signs.
- **Normative bridge profiles** — framework in Appendix E, template in README. Start with the
  syndication class, not Webmention.
- **Missing resource caps.** §15.6.6 caps trial decryptions and §13.4 caps keys, items, and bytes,
  but nothing caps `_recovery_sig` entries (one Ed25519 verify each, from an attacker-supplied
  array — 5000 entries measured at ~460 ms), `_skip` map size, or `_pins` array length. The
  100 KB identity-document cap bounds the first only incidentally, and nothing says so.
- **Duplicated normative statements.** Predecessor-equivalence is stated independently in §3.4,
  §4.4, §7.5, §9.4 invariant 5, and §10.2. The delivered-only republication rule is stated in
  §11.1.1, §13.14, §15.5, and §16.4.1. §14 contradicting §3.4 on re-signing the back catalog —
  fixed this pass — is what drift looks like once it has happened, and is the argument for
  consolidating both into one rule the other sites reference.

---

## 7. Ask the owner

1. **§4 — what to cut.** The one thing blocking the queue.
2. **Client-held encryption keys vs. server-side AI.** `DISTRIBUTION-MODEL.md` is explicit: do not
   ship the pair undecided, because the default outcome is "we recommended client-held keys and
   quietly gave those members a worse app."
3. **Who is the first real user, and when?** Identity URLs are permanent, §12's custody obligations
   bind from member one, and the `family`-visibility call is irreversible. §5d's exit walkthrough
   should pass with the hub deliberately refusing to help *before* anyone real is onboarded.
4. **Is this going public, and when?** It changes how much §15's "never independently reviewed"
   status matters.

---

## 8. Traps already paid for

- **Revocation rejects signing times strictly after `revoked_at`, never equal.** §5.2's normal
  rotation revokes the continuity key in the very version it signs, so `<=` breaks every rotation,
  D.5 included. In `assertContinuityKey` the comparison runs the other way, and the comment there
  explains why.
- **Skip links are manifest-only and the reason is security, not size** (§9.1.1).
  `identityChainPolicy.allowSkipLinks` is `false` and a caller cannot override it.
- **`walkToPin` buffers observations and commits them only on an anchored walk.** Recording as you
  go is what created the freeze defect; a range of versions is internally consistent whenever one
  party forged all of it, so an unanchored range proves nothing.
- **A peer's pin is a claim, not an observation.** It goes through `reconcilePeerPin`, which
  mutates nothing. Feeding one to `observe` restores the remote-freeze vector.
- **`PinStore` keeps `observed` per `seq` and `firstPinned` per URL.** They are different
  questions, and publishing the second as §16.1's `observed` asserts you witnessed a version before
  it existed.
- **An identity URL is inside every signed byte.** Nothing can be signed before the URL it will be
  served under is known, which is why `test/e2e.test.js` binds its server before it publishes.
- **§9.4 invariant 3 has two tests and the stronger one needs no history.** A manifest whose
  `updated` is later than an item's signing time has demonstrably advanced past it. The spec
  presents these the other way round.
- **`claimedAuthor` selects the binding carrier by document kind, not field presence** (§6.6).
- **Two Appendix D defects are characterized, not fixed**, in `test/appendix-d.test.js`: D.2b is
  signed nine hours after D.5 revokes the key, and D.6/D.7 are signed by an identity the spec
  publishes nowhere. Both are the spec author's call, and both would move vector bytes and hashes.
