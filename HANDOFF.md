# Handoff

**This file is scaffolding, not a record.** It exists to get one fresh agent productive on the
work in flight. When that work lands, delete it — the repo keeps design history in `git log`
rather than in documents (see `CLAUDE.md`, "Rules for this file").

---

## 1. The mandate, from the owner — read this before forming a plan

The owner's goal is **the best balance of simplicity, flexibility, and capability — the shortest
spec that still covers its bases.** The owner has said, verbatim: *"I'm not married to any
particular aspect of the spec."* Churn is explicitly not a cost.

The last pass was judged **good but too incremental** — it trimmed mechanisms one at a time
inside the existing architecture, when the owner was hoping for proposals at a larger scale.
Take that as your calibration: you are free to question the architecture itself, not just its
parts. Nothing is pre-blessed — not the document set, not the object model, not the layering,
not the conformance shape, not anything this file or `git log` treats as decided. A past
decision, however well-argued, was made *within a frame*, and the owner is inviting proposals
that change the frame.

Two things still deserve their weight, not as constraints but as the measures of any proposal:

- **The threat model** (§13.2, and `CLAUDE.md`'s summary). A proposal is judged by whether the
  people the protocol exists for end up better served — which includes being served by
  something *simpler*, even at some cost elsewhere. Say what your proposal gives up as plainly
  as what it gains.
- **The prior reasoning is input, not authority.** `git log` records why things are the way
  they are; read it so your bigger idea engages the strongest version of the current design
  rather than a strawman — and then feel free to conclude the whole approach should be
  different.

If you see a fundamentally better shape for this protocol, propose it to the owner before
spending effort on incremental work. Big proposals are wanted, not tolerated.

## 2. Where things stand

| | |
|---|---|
| Branch | `main` (old branches historical) |
| License | Apache-2.0 |
| Tests | `npm test` → 118 passing |
| Vectors | `node tmp/regen.js` → all pass, exits non-zero on drift |
| Spec | `open-feed-spec.md`, ~1045 lines, v0.1.0 draft, no outside readers, nothing implements it |

That last cell is the important one: **there are no compatibility obligations of any kind.**
No users, no implementations, no external readers. This is the cheapest a redesign will ever be.

The most recent pass (four commits beginning "Cut checkpointing and the derived lag bound")
removed several mechanisms and redesigned pins; the commit messages record the arguments and
measurements. Treat them as the current state of the design conversation, not its end.

Not built: the CLI, `src/consumer.js`, the inbox (§10, Level 3), pagination (§7.4), §15, §16,
Appendix E bridges, the export bundle (§14).

## 3. Orientation, in this order

1. `CLAUDE.md` — short, and its rules bind you.
2. `open-feed-spec.md` §13.2. The threat model is a family hub whose operator may be an abuser;
   it drives more of the design than it looks.
3. `git log` — long messages on purpose, recording reasoning and rejected alternatives.
4. `npm test` and `node tmp/regen.js`. Both green before you change a line.
5. `test/e2e.test.js` — currently the only place the layers are composed the way a real
   consumer composes them.

## 4. Answer everything, now

These questions were carried in `CLAUDE.md` as "deferred, not forgotten." The owner's
instruction is that they stop being carried: **the next pass resolves every one of them, one way
or another.** Each gets a decision — designed into the spec, drafted, rejected, or declared
permanently out of scope — with the reasoning in the commit, and none of them survives as an
open question afterwards. A frame-level proposal (§1) may well answer several at once; that is
one of its virtues. The notes attached below are the state of prior thinking, offered as input —
a decision that overturns them is as welcome as one that ratifies them.

- **Group audiences / membership documents** — cut from the spec, not solved. §11.2 states the
  boundary: broadcast to an author-held list works today; group *replies* need a published
  membership document, and anything defining one must answer staleness **and withholding**, use
  identity-document-published encryption keys, exercise §15.2.1 carrier binding on wrapped
  replies, and measure the identity-doc fetches one reply implies.
- **Threshold (k-of-n) recovery** — cut to single-key. Re-adding it after anything implements
  the spec fails **open**: an old verifier ignores the unknown `recovery_threshold` field and
  accepts one co-signature against a threshold of two, handing a key thief the choice of
  verifier — the same fail-open shape as the delegation `use` argument below.
- **`_syndication` shape** — `tmp/syndication-prototype.js` measured the candidates. Leading
  candidate: a §16-mold document, probably unchained (the `follows` precedent). Field and
  receipt shapes are measured and disfavored.
- **`_rel` type registry governance** — decide jointly with Appendix B.2's `proof` tokens; both
  are §2.1 vocabularies and deserve one answer.
- **Key delegation** — the highest-value trust upgrade available; the *shape* was settled even
  though the text is undrafted. The member holds a root key the hub never sees; the hub holds a
  key that may sign items and manifests but not identity-chain versions; revocation is an
  ordinary chain version, so the pinned chain is exactly the revocation substrate whose absence
  limited Nostr's NIP-26. Mark the delegated key with `use: "delegated"`, not an extension
  field: §4.1 already requires implementations to ignore keys with an unrecognized `use`, so an
  old verifier cannot find the key and fails **closed**, where an extension field on an
  ordinary `sig` key fails **open**. Enforcement is one clause beside the recovery-key
  exclusion in `assertContinuityKey`. The flag-day cost is zero while nothing implements this
  and rises monotonically after.
- **Normative bridge profiles** — framework in Appendix E, template in README. Prior thinking:
  start with the syndication class, not Webmention.
- **Author-side dual signing** — the only route to verified cross-protocol authorship. Taking
  it up means deciding whether "one construction" governs this protocol's artifacts or
  everything a publisher signs.
- **External time anchoring** (transparency log / witness network) beyond §16.1's family-scale
  item-carried pins. A published pins *document* (aggregator-readable) would be purely additive
  if that scale ever arrives.
- **Split custody** (hub holds the signing key, client holds only the encryption key) —
  deliberately *not* claimed in the spec: the guarantee holds only when the client is not
  distributed by the custodian, which the reference product does not satisfy. Decide whether
  that stays a silence or becomes a stated non-claim.

And the ones only the owner can answer — put them to the owner rather than deciding around them:

1. Client-held encryption keys vs. server-side AI — `DISTRIBUTION-MODEL.md` says not to ship
   the pair undecided.
2. Who is the first real user, and when? Identity URLs are permanent and §12's custody
   obligations bind from member one.
3. Is this going public, and when? It changes how much §15's "never independently reviewed"
   status matters.

## 5. If you are continuing the current design

The items below are real work under the architecture as it stands. They are deliberately listed
*after* the mandate: do not let this queue substitute for the bigger thinking §1 asks for, and
if a redesign would obsolete an item, that is a point in the redesign's favor, not a cost.

- **A defect class to keep hunting**: a consumer acting on bytes before they are
  chain-connected or key-authenticated (two prior security defects shared that root cause —
  see `git log`). Unexercised sites: §10.2/§10.3's read-before-verify boundary, and
  `assertRelocationCarriesForward` / `resolveFork`, pure functions whose preconditions no
  caller enforces yet.
- **Delegation** (`use: "delegated"`) — decided in §4, drafted here if adopted.
- **`src/consumer.js`** — the composition layer, reporting per-check results; the CLI is a
  formatter over it. Where the verified-input wrappers above belong.
- **The exit walkthrough as an executable adversarial scenario** — the protocol's central claim
  (§3.4 + §4.5 + §14 composing against an uncooperative hub) and nothing tests it end to end.
- **Storage measurement** (§9.2's claims), **pagination** (§7.4), **the inbox** (§10), **a
  language-neutral conformance corpus** (Appendix D is positive-only and repo-bound).
- **The product spike** — none of this matters if the family will not use the app, and that is
  knowable in a week with throwaway code.

## 6. Traps already paid for

These are facts about the *current* code and spec — they bind only as long as the mechanisms
they describe exist.

- **Revocation rejects signing times strictly after `revoked_at`, never equal** — §5.2's normal
  rotation revokes the continuity key in the very version it signs, so `<=` breaks every
  rotation. `assertContinuityKey`'s comment explains the direction.
- **Skip links are manifest-only and the reason is security, not size** (§9.1.1).
- **`walkToPin` buffers observations and commits them only on an anchored walk** — an
  unanchored range proves nothing, since one forger can make it internally consistent.
- **A pin arriving on an item is a claim, not an observation** — `admissibleItemPins` then
  `reconcilePeerPin`, never `observe`; `untracked` chains are ignored outright (§13.9).
- **`PinStore` keeps `observed` per `seq` and `firstPinned` per URL** — different questions.
- **An identity URL is inside every signed byte** — nothing can be signed before its serving
  URL is known.
- **§9.3 invariant 3's stronger test needs no history** — a manifest whose `updated` postdates
  an item's signing time has demonstrably passed it over; the consumer ceiling is the fallback.
- **`claimedAuthor` selects the binding carrier by document kind, not field presence** (§6.6).
