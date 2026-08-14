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

## 4. Questions only the owner can answer

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
- **Delegation** (`use: "delegated"`) — design argument recorded in `CLAUDE.md`, text undrafted.
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
