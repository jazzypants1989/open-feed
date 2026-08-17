# Handoff — after the Stage-1 spec/code reconciliation

Delete this file when it has been consumed. It is a list of what is still open plus the traps;
none of it belongs in `CLAUDE.md` or the spec. `tmp/review-findings.md` is the durable register.

**Baseline:** `npm test` → **253 pass, 0 fail**. `node tmp/regen.js` → all checks pass.
`npm run prototypes` → see `tmp/prototype-results.json` (gitignored; read it before paying for a
rerun, the full suite costs ~5 min). Working tree clean.

## The owner's five decisions — SETTLED, do not relitigate

1. **Group messages → the delivered column is an audience of one, by rule.** DONE (previous pass).
2. **Timestamps → milliseconds.** NOT DONE. Wire change; do it with decision 3 and regenerate
   vectors once. See "Open, 1" below — it has grown a third component since it was written.
3. **`_`-field rename → a single namespacing object (`_openfeed: {...}` or similar).** NOT DONE.
   Wire change; pairs with decision 2.
4. **§15 review → three foundation-model adversarial reviews** (human cryptographer later, at
   public launch). The owner uses OpenCode Go; the key is in `.env` (gitignored) as
   `OPENCODE_KEY`. Requested models: **GLM-5.3, Kimi K3, Qwen3.8 Max**. NOT DONE — this is the
   *last* step, run over the finished state. It is a shake-out, not a substitute for a
   cryptographer's pass; say so.
5. **Audience → the owner's family first, but the spec is for anyone; 2–3 reference
   implementations planned.** Context, not a task.

## What this pass was

Handoff item 1 (the Stage 1 spec corrections paired with landed code) plus everything else in
Stage 1 and the rest of Stage 0's backlog. Seven commits on `8703ea4`. `git log` has the
reasoning per change; each one lands with a test that fails without it.

## Status

**Stage 0 (`src/` defects): CLOSED.** 0.1–0.10 all DONE with revert-checked tests. 0.11's list is
DONE except the store-growth item — see "Open, 3". One 0.11 entry (`export.js` dropping
`requireCanonical` on restore) was **not a defect**; the reason is in `d746c7f`'s message and in
the register.

**Stage 1 (spec corrections): CLOSED.** 1.1–1.18 all landed. 1.8 (whole-second `updated` as a
publishing lock) is the exception and is **subsumed by decision 2** — milliseconds is its fix, so
do not treat it as separately open.

**Stage 2: DONE** (previous pass). **S2.1–S2.8 DONE**; S2.9 (§12 checklists + Appendix B
coverage) and S2.11 (doc drift) remain and are items 3 and 4 below. S2.10's nits are partly
absorbed.

**Stage 3 (surface-area cuts), Stage 4 (publication readiness), Stage 5 (prototype gates):**
untouched, except that Stage 4's `_`-field namespace item is now decision 3.

## Open, in the order I would take it

**1. Decisions 2 + 3, plus `typ`, as one wire change.** Then `node tmp/regen.js` regenerates
every vector against the final wire. Three components, deliberately batched so the vectors are
regenerated once:

- **Milliseconds** (decision 2, closes 1.8). Scope it explicitly before starting: the argument in
  1.8 is about `updated` on chained documents — three tombstones in one second, or an NTP step
  back, and `#assertDated` refuses to advance either chain. JOSE's `iat`/`revoked_at` are seconds
  by convention and §4.1 says so. **Decide and write down whether those move too.** My reading:
  move everything numeric to milliseconds and restate §4.1's convention, because two numeric time
  units in one document is the kind of thing a second implementer gets wrong silently — but that
  is a judgement, not a settled decision. `parseTimestamp` (new this pass, `jws.js`) returns
  seconds today and is the single place the content-side conversion lives.
- **`_openfeed: {...}`** (decision 3). The hazard is §6.3: `_sig` is stripped from the payload at
  the **top level only**, and that rule is load-bearing (a recursive strip is the §14 attack
  written up in §6.3). If `_sig` moves inside `_openfeed`, decide what "top-level" now means and
  whether an emptied `_openfeed` stays as `{}` — the answer changes the signing construction, so
  it needs to be written into §6.3 rather than left to `canonical.js`.
- **`typ` in the JWS protected header** (register 1.17's last item, the only one I did not land).
  Identity/manifest/item type confusion is closed today only *accidentally*, by shape checks that
  happen to disagree. §6.2's "all four fields" becomes five, `buildHeader` takes the kind, and
  §6.6's "the verifier takes the kind from context" gains a second, cheaper enforcement. It is
  one line of construction and it must not be done on its own — it regenerates every vector.

**2. Docs (S2.11).** README and DISTRIBUTION-MODEL are stale against Stage 2, the previous pass,
*and* this one. The register's S2.11 entry enumerates the pre-existing contradictions with line
numbers; **this pass added more**, because the spec moved: §3.1 gained a URL-comparison rule,
§3.3.1 is new (caching), §7.2 pins RFC 3339, §9.3's response is now graded, and §13.4's caps
carry a keyword. Do this after the wire has settled — don't edit the human docs before the shape
they describe is final.

**3. The store-growth item, the last thing open from Stage 0.** `MigrationStore` and
`ObservationStore` still grow without bound, though §13.4 sanctions eviction. `PinStore` already
has `compact`/`MAX_OBSERVATIONS_PER_CHAIN` and is fine. `ObservationStore` is the one that
matters: it holds a record per `(author, id, _version)` forever, so a hub polling a few thousand
members accumulates one entry per revision of every item it has ever seen. Note the constraint
before writing an evictor — §4.4's value is *older* observations, so evicting the oldest inverts
the mechanism. Evict by identity (the whole of a chain nothing else references), never by age.

**4. §12 conformance checklists (S2.9).** No freshness item at any level; Level 1 missing §7.6's
consumer MUST and §13.17. **This grew this pass**: Level 1 should now also carry §7.2's RFC 3339
profile, §3.1's URL-comparison rule, §7.4's pagination bounds, and §13.4's "enforce *a* bound".
One editing pass, cheap, and it does not touch the wire — it could be done before item 1.

**5. Prototype gate hardening (register Stage 5).** `enctags`, `inbox`, `deltamanifest` still lack
assertion gates on their substantive claims. `enctags` also never exercises `src/enc.js` and
quotes spec sections that no longer exist.

**6. Decision 4** — the three-model adversarial review, last, over the finished state.

## Things that will bite you

- **`npm run prototypes` takes ~5 minutes and several prototypes read `src/` and the spec
  mid-run.** Never edit those while a run is in flight — a half-landed edit reads as a prototype
  failure. Read `tmp/prototype-results.json` instead of rerunning.
- **`node tmp/regen.js` after anything touching canonicalization, signing, document shape, or
  vectors** — CLAUDE.md rule 4, not optional.
- **`policy.verifySignature(doc, { url })` — the chain URL is now required by
  `identityChainPolicy`** and it throws without one. That is deliberate (a policy whose check is
  skipped when a caller forgets an argument is a check nobody notices the absence of), but it
  means any new direct caller must pass it. `walkToPin` threads it everywhere.
- **`identityDocumentUrl` moved to `jws.js`** (re-exported from `fetch.js`, so every importer
  still works). It is there so `chain.js` can name §3.2's path convention without importing the
  module that opens sockets.
- **`parseTimestamp` (`jws.js`) is the only content-timestamp parser.** Do not reach for
  `Date.parse` — it accepts `2025-02-30` and rolls it forward, accepts `24:00:00`, and falls back
  to an implementation-defined reading where `Jan 15 2025` is **local** time.
- **Invariant 3's passed-over test now requires the item's signer to own the manifest.** Do not
  "simplify" that scope away: unscoped it convicts a board owner on a timestamp a contributor
  chose, and there is a test named for exactly that.
- **`reconcileFeed` violations carry `retryable`**, and `reader.js` maps those to a
  `feed_behind_manifest` finding rather than `invariant` (so exit 1, not 2). §9.3's response is
  graded now; a feed behind its manifest is two non-atomic reads, not an attack.
- **`fetchDocument` refuses cross-origin redirects for every `kind` except `'json'`.** `'json'` is
  the unclassified default and keeps the permissive behaviour.
- **`_sig` covers `_recovery_sig` (§6.3), so order matters: co-sign first, then sign.** Prefer
  `advanceIdentity(changes, { recoverySigner })`, which co-signs atomically. `coSignIdentity`
  retrofits onto the tip and is only safe before the tip's bytes are first served.
- **The delivered column is an audience of one.** `_delivery` lives only at top level, is ignored
  (and MUST NOT appear) on published items, and `Publisher.retractDelivered` tombstones a
  delivered item.
- **`ObservationStore` keys `(author, id, _version)`.** The revocation check *bounds* the
  self-reported time (`Math.max`), never replaces it; don't "simplify" it back to `??`.
- **`effectiveSigningTime` and `claimedAuthor` both require an explicit `{ kind }`** — no
  field-sniffing, because an item can carry a numeric `updated` as conformant unknown data.
- **`createInbox`'s `ownsItem` is owner-authored only**; "previously accepted here" is
  `DedupStore.knows`, wired automatically. Pointing `ownsItem` at a whole item store reopens the
  fetch oracle (0.5). A **blocked** author now writes neither store — that is what stops their ids
  becoming routing tokens.
- **A two-feed identity needs no `Publisher` change.** `advanceIdentity({ feeds: [...current, e] })`
  merges over the tip, and a second `Publisher` on the same identity supplies the feed and manifest
  files — serve everything it emits *except* `openfeed*`. `test/cli.test.js`'s archive-equivocation
  test is the worked example.
- **`_next_update` strictness binds the manifest tip only**; in retained history a malformed value
  is read as absent.
- **§13's list is numbered and cross-referenced from four files.** Append, don't insert.

## Questions still unanswered

1. **§3.1's percent-encoding** — the one place two conforming implementations can split one
   identity into two chains. No prototype; longest-standing open question. Note that §3.1 now
   states a *second* comparator beside it (for feeds and manifests), which shares the same
   hazard and inherits the same open question.
2. **Where the §15 review comes from** — decision 4 is the interim answer; it does not retire the
   "never independently reviewed" caveat.
3. **Adoption asymmetry** — decision 5 reframes it, does not close it. Product question.
