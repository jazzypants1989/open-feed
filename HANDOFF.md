# Handoff

**This file is scaffolding, not a record.** It exists to get one fresh agent productive on the
work in flight. When that work lands, delete it — the repo keeps design history in `git log`
rather than in documents (see `CLAUDE.md`, "Rules for this file").

---

## 1. Where things stand

| | |
|---|---|
| Branch | `main` (the old `spec/review-fixes` fully merged; `v0.2.0-privacy-and-exit` is historical) |
| License | Apache-2.0 |
| Tests | `npm test` → 118 passing |
| Vectors | `node tmp/regen.js` → all pass, exits non-zero on drift |

**The §4 cut decision this file used to exist for is DECIDED and LANDED**, owner-confirmed, in
four commits starting at "Cut checkpointing and the derived lag bound". Read those commit
messages before re-litigating any of it; each records the argument and the measurements. The
shape of the outcome:

- **Cut**: checkpointing; the derived (median) lag bound, replaced by a consumer ceiling;
  rosters (group audiences now out of scope, §11.2); threshold recovery (single-key now — the
  re-add caveat is recorded in `CLAUDE.md` open questions); the pins *document*.
- **Kept, against the prior handoff's advice**: skip links (§9.1.1) — `tmp/skiplinks-prototype.js`
  showed linear walking breaches §13.4's byte cap ~150 days into a reader lapse at daily cadence,
  while `_skip` costs +0.3%; and §5.5 fork resolution — without the prefer-the-recovery-cosigned
  branch rule, a hostile hub publishing a competing `successor` manufactures an unresolvable fork
  and re-acquires the exit veto by doing nothing but contesting.
- **Redesigned**: pins now ride items only (§16.1), scoped by travel axis — published items pin
  only the identities they address; delivered-only items may carry third-party pins. Recovery
  propagation, timestamping, and first-contact corroboration survive pairwise; the aggregator is
  the one loss, re-addable additively.

### Not built

The CLI, `src/consumer.js`, the inbox (§10, Level 3), pagination (§7.4), §15, §16, Appendix E
bridges, and the export bundle (§14).

## 2. Orientation, in this order

1. `CLAUDE.md` — short, and its rules bind you.
2. `open-feed-spec.md` §13.2 before anything security-relevant. The threat model is a family hub
   whose operator may be an abuser; it drives more of the design than it looks.
3. `git log` — the messages are long on purpose and record reasoning, including alternatives
   rejected with reasons.
4. `npm test` and `node tmp/regen.js`. Both green before you change a line.
5. `test/e2e.test.js` last, as the worked example: it is currently the only place the layers are
   composed the way a real consumer composes them.

## 3. The defect class to keep hunting

The last review pass found two security defects with one root cause: **a consumer acting on
bytes before they are chain-connected or key-authenticated** (the skip-link takeover; the
false-alarm freeze — both fixed, see `git log`). Assume there are more of this class at the
sites not yet exercised because the code does not exist: §10.2/§10.3's read-before-verify
boundary in the inbox, and the callers of `assertRelocationCarriesForward` and `resolveFork` —
both pure functions that verify nothing about their inputs and currently have no non-test
caller, so their preconditions are unenforced rather than met. Wrap them before they acquire a
real caller (that work belongs with `src/consumer.js`).

## 4. Queue

**a. Delegation, `use: "delegated"`.** Design settled, text undrafted; the argument is recorded
in `CLAUDE.md`. Its central claim — the pinned chain is the revocation substrate — survives the
cuts intact.

**b. `src/consumer.js`.** The only statement of how the layers compose into a §12 Level 1 reader
is `walkChain(...)` inside `e2e.test.js`, and a test is the wrong place for it. Make it a class
that reports **per-check results rather than a boolean**; the CLI is then a formatter over it and
`e2e.test.js` shrinks. This is also where `admissibleItemPins` and `reconcilePeerPin` get their
real caller, and where §3's verified-input wrappers land. Do this before the CLI.

**c. Measure the storage claims.** §9.2 gives a ten-year example in gigabytes and SHOULDs two
mechanisms. The publisher makes it measurable: vary cadence and rotation, put a real table in
the README.

**d. The exit walkthrough, as an executable adversarial scenario.** The protocol's central claim
and nothing tests it: §3.4 migration, §4.5 recovery, §14 export, and the claim that they
compose. Hub A serves Mom; Mom re-establishes at hub B with `predecessor` co-signed by a
recovery key committed in a pinned ancestor; hub A keeps serving an unchanged chain and declines
to publish a `successor`. Then the parts that are easy to get wrong — back catalog byte-verbatim
rather than re-signed, invariant 5 binding the successor's genesis to the predecessor's final
state, predecessor equivalence resolving relation targets, §4.4's `(author, id)` record
surviving the move. Then the adversarial variants: a competing `successor` from hub A (§5.5 must
separate them); a recovery key hub A generated at onboarding (§4.5 says there is then no exit —
demonstrate it); the genesis-equivocation attack, whose defence is one relative comparing one
hash; and recovery propagation via a third-party pin on a delivered item (§16.1), which no test
exercises yet.

**e. Pagination (§7.4).** `reconcileFeed` takes `partial`, but nothing exercises it because no
caller paginates.

**f. The inbox (§10),** Level 3, the first thing here that accepts input from strangers. Three
places will bite, all documented and none implemented: §10.3's read-before-verify /
write-after-verify rule; §10.4's three existence oracles; §11.1.1 (§13.14 calls it "the failure
mode most likely to be introduced by an implementer being *helpful*"). Plus the new one: item
`_pins` from strangers route through `admissibleItemPins` + `reconcilePeerPin`, never `observe`.

**g. A language-neutral conformance corpus.** Appendix D is positive-only and `negative.test.js`
lives inside this repo's test framework, so neither proves anything about anyone else's
implementation. Extract both into `conformance/` — a directory of cases, each carrying the
documents, the identity document to resolve against, and the expected verdict and error class —
with a thin runner here. This is the artifact that turns a specification into a protocol.

**h. The product spike, still untaken.** None of this matters if the family will not use the
app, and that is knowable in a week with throwaway code. Protocol work compounds; the product
question is a coin flip that invalidates all of it if it lands wrong.

## 5. Ask the owner

1. **Client-held encryption keys vs. server-side AI.** `DISTRIBUTION-MODEL.md` is explicit: do
   not ship the pair undecided, because the default outcome is "we recommended client-held keys
   and quietly gave those members a worse app."
2. **Who is the first real user, and when?** Identity URLs are permanent, §12's custody
   obligations bind from member one, and the `family`-visibility call is irreversible. §4d's
   exit walkthrough should pass with the hub deliberately refusing to help *before* anyone real
   is onboarded.
3. **Is this going public, and when?** It changes how much §15's "never independently reviewed"
   status matters.

## 6. Traps already paid for

- **Revocation rejects signing times strictly after `revoked_at`, never equal.** §5.2's normal
  rotation revokes the continuity key in the very version it signs, so `<=` breaks every
  rotation, D.5 included. In `assertContinuityKey` the comparison runs the other way, and the
  comment there explains why.
- **Skip links are manifest-only and the reason is security, not size** (§9.1.1).
  `identityChainPolicy.allowSkipLinks` is `false` and a caller cannot override it.
- **`walkToPin` buffers observations and commits them only on an anchored walk.** Recording as
  you go is what created the freeze defect; a range of versions is internally consistent
  whenever one party forged all of it, so an unanchored range proves nothing.
- **A pin arriving on an item is a claim, not an observation.** It goes through
  `admissibleItemPins` and then `reconcilePeerPin`, which mutates nothing; `untracked` chains
  are ignored outright (fetch-amplification, §13.9). Feeding one to `observe` restores the
  remote-freeze vector.
- **`PinStore` keeps `observed` per `seq` and `firstPinned` per URL.** They are different
  questions, and sharing the second as §16.1's `observed` asserts you witnessed a version
  before it existed.
- **An identity URL is inside every signed byte.** Nothing can be signed before the URL it will
  be served under is known, which is why `test/e2e.test.js` binds its server before it publishes.
- **§9.3 invariant 3's stronger test needs no history**: a manifest whose `updated` is later
  than an item's signing time has demonstrably advanced past it. The consumer ceiling is the
  fallback, not the lead.
- **`claimedAuthor` selects the binding carrier by document kind, not field presence** (§6.6).
