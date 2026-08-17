# Handoff — after the Stage-2 second-pass repairs

Delete this file when it has been consumed. It is a list of what is still open plus the traps;
none of it belongs in `CLAUDE.md` or the spec. `tmp/review-findings.md` is the durable register.

**Baseline:** `npm test` → **246 pass, 0 fail**. `node tmp/regen.js` → all checks pass.
`npm run prototypes` → all 17 hold (and now write `tmp/prototype-results.json`, gitignored —
read it before paying for a rerun; the full suite costs ~5 min). Working tree clean.

## What this pass was

A four-agent skeptical review of the *previous* pass's Stage 2 work, then the owner settled the
five decisions it surfaced, then I worked the resulting queue. 13 commits on top of `dae5c76`.
`git log` has the reasoning; `git log --stat dae5c76..HEAD` the shape.

## The owner's five decisions — SETTLED, do not relitigate

1. **Group messages → the delivered column is an audience of one, by rule.** A delivered-only
   item (no `_feed_url`) MUST go to exactly one recipient; group content is §15.4's
   published-encrypted case. This deleted the unsolved multi-recipient `_delivery` placement
   (S2.1) instead of building a fix for it. Landed: spec §11.2/§10.6, `inbox.js`/`publish.js`,
   prototype, tests.
2. **Timestamps → milliseconds.** NOT YET DONE. See "Open, decision 2" below. This is a wire
   change; do it with decision 3 and regenerate vectors once.
3. **`_`-field rename → yes, move to a single namespacing object (`_openfeed: {...}` or
   similar).** NOT YET DONE. Wire change; pairs with decision 2. This is Stage 4's
   "namespace collision" item, now approved rather than "worth pricing".
4. **§15 review → three foundation-model adversarial reviews for now** (human cryptographer
   later, at public launch). The owner uses OpenCode Go; the key is in `.env` (gitignored) as
   `OPENCODE_KEY`. Requested models: **GLM-5.3, Kimi K3, Qwen3.8 Max** (three labs, three
   blind spots). NOT YET DONE — this is the *last* step, run over the finished state so the
   models review a settled artifact, not a moving target. It is a shake-out, not a substitute
   for a cryptographer's pass; say so.
5. **Audience → for the owner's family, but the spec is meant to be picked up by anyone; the
   owner plans 2–3 full reference implementations, so "early publishers" get an off-the-shelf
   start.** This reframes the adoption-asymmetry question (register's last section) but does not
   close it; it is context, not a task.

## Status of the review's findings

**Stage 2 self-review (S2.1–S2.11, in `tmp/review-findings.md`):**
- **DONE:** S2.1 (one-recipient rule), S2.2 (`probeItems` false accusation), S2.3 (§16.2
  OPTIONAL contradiction), S2.4 (`enc.js`/`jws.js` lenient base64url), S2.5 (tombstone allowlist
  + `retractDelivered`), S2.6 (malformed `_next_update` bricking the chain), S2.7 (delivery
  stream: late arrivals, restart persistence, sender-side migration), S2.8 (atomic co-sign).
- **PARTIAL / rolled into other work:** S2.9 (conformance-surface propagation — §12 checklists,
  Appendix B vectors carrying `items`/`_next_update`/`_delivery` — NOT done, see below), S2.10
  (assorted nits, some fixed in passing), S2.11 (doc drift — NOT done, see below).

**Old backlog (Stage 0):**
- **DONE, revert-checked test:** 0.1 (prior pass), 0.2, 0.3, 0.4, 0.5, 0.6.
- **Code DONE, test incomplete — FIX THESE FIRST, they are cheap:**
  - **0.8** (rate-limiter eviction): fix is `delete`-then-`set` on both paths in
    `inbox.js`'s `defaultRateLimit`, matching the module's own comment. The included test
    (`test/inbox.test.js`, "churning fresh keys") does **not** reliably reproduce the eviction
    under its parameters — Map insertion-order reasoning is subtle and the attacker's one allowed
    delivery repositions its bucket to the tail. Either find parameters that make it bite on
    revert, or replace it with a direct unit test of the limiter's bucket Map.
  - **0.9** (equivocation on a listed feed downgraded to `unreadable_feed`): code fixed in
    `reader.js` (keeps the severe `invariant` kind) and `cli.js` (maps `invariant` → exit 2).
    **No test** — a faithful one needs a two-feed identity, and the reference `Publisher` only
    builds a single `feeds` entry (`publish.js:132`). Either add multi-feed support to
    `Publisher` (small, and Stage 4's "consumer-state / fetch-order" work wants it anyway) or
    hand-assemble a two-feed identity document in the test.

**Still OPEN from Stage 0:** 0.7 (walked identity versions not bound to the chain's identity —
pairs with spec 1.13), 0.10 (no upper bound on self-reported signing time — pairs with 1.4),
and 0.11's list (unbounded store growth on `PinStore`/`MigrationStore`/`ObservationStore`;
`export.js` dropping `requireCanonical` on restore; skip-hop undercount; `timingSafeEqualString`
coercing non-strings; §13.4 slot caps; blocked authors writing the dedup store; non-`EncError`
escaping `enc.js` — some of these last two may have been incidentally closed this pass, verify
before acting).

## Open, in the order I would take it

**1. Finish 0.8 and 0.9's tests** (above). Cheap, and they close the "every fix lands with a
test that fails without it" gap this pass left.

**2. Stage 1 spec corrections that pair with landed code**, so text and code stop disagreeing:
1.2↔0.3 (DONE in text this pass — verify), 1.3↔0.5 (DONE), 1.4↔0.10 (OPEN both), 1.13↔0.7 (OPEN
both). Then the standalone-high-value ones: 1.5 (URL comparison rule — `normalizeUrlForCompare`
implements what the spec never states), 1.6 (RFC 3339 time profile), 1.7 (`seq` contiguity).

**3. Decisions 2 + 3 together** (milliseconds + `_openfeed:` namespace), then
`node tmp/regen.js` to regenerate every vector against the final wire. Do these near-last: they
touch every signed document, and doing them before the other spec work means regenerating twice.
S2.9's Appendix B gap (vectors carry no `items`/`_next_update`/`_delivery`) closes naturally
when you regenerate after adding those to the canonical example.

**4. Docs (S2.11).** README and DISTRIBUTION-MODEL are stale against *both* the previous Stage 2
and this pass. The register's S2.11 entry enumerates every concrete contradiction with line
numbers — the sharpest is `README.md:455`, whose verification recipe ("signature fields removed",
plural) fails on every co-signed document under §6.3. Do this after the wire has settled
(decisions 2/3), per the previous handoff's own warning: don't edit the human docs before the
shape they describe is final.

**5. §12 conformance checklists (S2.9).** No freshness item at any level; Level 1 missing §7.6's
consumer MUST and §13.17. One editing pass.

**6. Prototype gate hardening.** `enctags`, `inbox`, `deltamanifest` still lack real assertion
gates on their substantive claims (register Stage 5). `enctags` also never exercises
`src/enc.js` and quotes spec sections that no longer exist.

**7. Decision 4** — the three-model adversarial review, last, over the finished state.

## Things that will bite you

- **`npm run prototypes` takes ~5 minutes and several prototypes read `src/`/the spec mid-run.**
  Never edit those files while a run is in flight — a half-landed edit reads as a prototype
  failure (this bit me: a stray concurrent run reported a phantom failure). Read
  `tmp/prototype-results.json` instead of rerunning.
- **`_sig` covers `_recovery_sig` (§6.3), so order matters: co-sign first, then sign.** New this
  pass: `advanceIdentity(changes, { recoverySigner })` co-signs *atomically*, before the version
  exists to serve — prefer it for every post-genesis case. `coSignIdentity` retrofits onto the
  tip and is only safe before the tip's bytes are first served (else self-equivocation); it
  carries the warning now, and exists for the genesis case.
- **The delivered column is an audience of one now.** `_delivery` lives only at top level, is
  ignored (and MUST NOT appear) on published items, and `Publisher.retractDelivered` is how a
  delivered item is tombstoned (`tombstone()` reaches only the published store).
- **`ObservationStore` keys `(author, id, _version)` now**, not `(author, id)`. It bumped to
  serialization version 2 with a new `idsSeen` map; `fromJSON` reads v0/v1/v2. The revocation
  check *bounds* the self-reported time (`Math.max`), never replaces it — the inversion is
  written into §4.4 and the docstrings; don't "simplify" it back to `??`.
- **`effectiveSigningTime` and `claimedAuthor` both require an explicit `{ kind }`** — no
  field-sniffing, because an item can carry a numeric `updated` as conformant unknown data.
- **`verifyBundle` returns `predecessorTofu` and downgrades a bundle-anchored migration to
  unverified** unless the caller passes `pins` holding the predecessor from outside the bundle.
- **`createInbox` renamed `holdsItem` → `ownsItem`** (owner-authored only); "previously accepted
  here" is answered by `DedupStore.knows`, wired automatically. A deployment pointing `ownsItem`
  at its whole item store reopens the fetch-oracle (0.5).
- **`_next_update` strictness binds the manifest tip only**; in retained history a malformed
  value is read as absent (`assertManifestShape(doc, url, { tip })`).
- **§13's list is numbered and cross-referenced from four files** (`§13.12–14`, `§13.16` from
  README, DISTRIBUTION-MODEL, `src/manifest.js`, `test/inbox.test.js`). Append, don't insert.
- **`node tmp/regen.js` after anything touching canonicalization, signing, document shape, or
  vectors** — CLAUDE.md rule 4, not optional.

## Questions still unanswered (unchanged from before)

1. **§3.1's percent-encoding** — the one place two conforming implementations can split one
   identity into two chains. No prototype, longest-standing open question.
2. **Where the §15 review comes from** — decision 4 is the interim answer (three models now,
   cryptographer at launch); it does not fully retire the "never independently reviewed" caveat.
3. **Adoption asymmetry** — decision 5 reframes it (off-the-shelf reference implementations) but
   does not close it. Product/distribution question.
