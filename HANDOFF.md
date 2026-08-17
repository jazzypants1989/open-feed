# Handoff — after the wire change

Delete this file when it has been consumed. It is a list of what is still open plus the traps;
none of it belongs in `CLAUDE.md` or the spec. `tmp/review-findings.md` is the durable register.

**Baseline:** `npm test` → **255 pass, 0 fail**. `node tmp/regen.js` → all checks pass.
`npm run prototypes` → **all 17 hold**; see `tmp/prototype-results.json` (gitignored; read it
before paying for a rerun, the full suite costs ~5 min). Working tree clean.

## The owner's decisions — SETTLED, do not relitigate

1. **Group messages → the delivered column is an audience of one, by rule.** DONE.
2. **Timestamps → milliseconds. WITHDRAWN**, by the owner, on the ground below. Superseded by
   `(updated, seq)` with `updated` non-decreasing, which is DONE and closes 1.8. **The reason is
   load-bearing and is why this must not come back:** `iat` on a JWK is not an Open Feed
   invention borrowing a JWT convention — it is a *registered* JOSE parameter (IANA "JSON Web
   Key Parameters"; change controller OpenID Foundation; OpenID Federation 1.0 §8.7.2), defined
   as RFC 7519's `iat`, a NumericDate, **in seconds**. Milliseconds there is a registered public
   parameter carrying the wrong unit, which no library that knows the name would catch. Scoping
   the move to Open Feed's own fields is worse in a different way: it puts the unit seam exactly
   on §6.5's revocation comparison and §16.1's `observed` check. One unit protocol-wide.
3. **`_`-field rename → a single namespacing object.** DONE — `_openfeed`, items and attachments
   only, `_sig` staying at top level in every kind. See `d5ddc03` for the scope argument.
4. **§15 review → three foundation-model adversarial reviews** (human cryptographer later, at
   public launch). The owner uses OpenCode Go; the key is in `.env` (gitignored) as
   `OPENCODE_KEY`. Requested models: **GLM-5.3, Kimi K3, Qwen3.8 Max**. NOT DONE — this is the
   *last* step, run over the finished state. It is a shake-out, not a substitute for a
   cryptographer's pass; say so.
5. **Audience → the owner's family first, but the spec is for anyone; 2–3 reference
   implementations planned.** Context, not a task.

## What this pass was

The batched wire change, the previous handoff's item 1, in three commits on `55afd48`:
`updated` stops being an ordinal (1.8), `_openfeed` (decision 3), and `typ` (1.17's last
clause). Vectors were regenerated twice — once per wire commit — which is a script run and was
never the thing worth batching; the *decision* was. `git log` has the reasoning per change; each
lands with a test verified to fail without it.

## Status

**Stage 0 (`src/` defects): CLOSED**, except the store-growth item — see "Open, 2".

**Stage 1 (spec corrections): CLOSED.** 1.1–1.18 all landed. 1.8 is closed by decision 2's
replacement, not by decision 2. 1.17's `typ` clause is landed.

**Stage 2: DONE.** S2.9 (§12 checklists + Appendix B coverage) is partly absorbed — Level 1 now
carries the `typ` check — and the rest is "Open, 3".

**Stage 3 (surface-area cuts), Stage 4 (publication readiness), Stage 5 (prototype gates):**
untouched, except Stage 4's `_`-field namespace item, which is decision 3 and is done.

## Open, in the order I would take it

**1. Docs (S2.11), now unblocked — the wire has stopped moving.** README and
DISTRIBUTION-MODEL are stale against Stage 2 and three passes since, **and this pass added a
lot**: they use `_version`, `_feed_url`, `_rel`, `_enc`, `_pins`, `_sha256` throughout and every
one of those moved into `_openfeed`. The register's S2.11 entry enumerates the pre-existing
contradictions with line numbers; on top of those, the spec has since gained a URL-comparison
rule (§3.1), caching (§3.3.1), an RFC 3339 profile (§7.2), a graded §9.3 response, a keyword on
§13.4's caps, `typ` (§6.2, §6.5 step 3, Appendix A's second table), and `_openfeed` (§7.2).
README's verification recipe at :455 is wrong twice over now.

**2. The store-growth item, the last thing open from Stage 0.** `MigrationStore` and
`ObservationStore` still grow without bound, though §13.4 sanctions eviction. `PinStore` already
has `compact`/`MAX_OBSERVATIONS_PER_CHAIN` and is fine. `ObservationStore` is the one that
matters: it holds a record per `(author, id, _openfeed.version)` forever, so a hub polling a few
thousand members accumulates one entry per revision of every item it has ever seen. Note the
constraint before writing an evictor — §4.4's value is *older* observations, so evicting the
oldest inverts the mechanism. Evict by identity (the whole of a chain nothing else references),
never by age.

**3. §12 conformance checklists (S2.9), the remainder.** No freshness item at any level; Level 1
missing §7.6's consumer MUST and §13.17, and it should also carry §7.2's RFC 3339 profile,
§3.1's URL-comparison rule, §7.4's pagination bounds, and §13.4's "enforce *a* bound". Appendix
B still carries no vector with `items: true`, `_next_update`, or `_openfeed.delivery`. One
editing pass, cheap, and it does not touch the wire.

**4. Prototype gate hardening (register Stage 5).** `enctags`, `inbox`, `deltamanifest` still
lack assertion gates on their substantive claims. `enctags` also never exercises `src/enc.js`
and quotes spec sections that no longer exist.

**5. Decision 4** — the three-model adversarial review, last, over the finished state.

## Things that will bite you

Everything below the rule was already true; the items above it are new this pass.

- **`sign()` and `buildHeader()` require an explicit `kind`** — `'identity'`, `'manifest'` or
  `'item'` — and have no default. That is deliberate: a default is a guess about what is being
  signed, made in the one place that is supposed to be asserting it. `verifyDocument` requires
  one too and checks it against the header's `typ`.
- **The `kind` vocabulary is three values now, not two.** `'document'` is gone; it used to mean
  "identity document or manifest". Anything still passing it throws.
- **`_openfeed` must be *merged*, never replaced.** `{ ...item, _openfeed: { version: 2 } }`
  silently drops `feed_url`, `rel` and everything else, and the result is a validly-signed item
  that means something different. This caused several test failures during the move and one
  prototype bug that had been mutating its own fixture through a shared object reference
  (`delete { ...reply }._pins` reaches the original). `publish.js`'s `withOpenFeed` is the helper.
- **`tmp/regen.js` now has an Appendix B staleness check, and it earns its keep.** The old
  cross-check only asked "does this string appear somewhere", which a hash quoted in prose
  satisfies via the manifest vector that commits it — four stale prose hashes passed that way.
  If you change a vector, trust the new check over the old one.
- **`_sig` stays at top level in all three document kinds**, `_openfeed` notwithstanding, and
  §6.3's strip rule is defined on that. Do not "finish the job" by moving it: §7.2 states the
  exception and the reason, and moving it forks §6.3 by document kind.
- **`policy.verifySignature(doc, { url })` — the chain URL is required by `identityChainPolicy`**
  and it throws without one. Any new direct caller must pass it. `walkToPin` threads it.
- **`identityDocumentUrl` lives in `jws.js`** (re-exported from `fetch.js`), so `chain.js` can
  name §3.2's path convention without importing the module that opens sockets.
- **`parseTimestamp` (`jws.js`) is the only content-timestamp parser.** Do not reach for
  `Date.parse` — it accepts `2025-02-30` and rolls it forward, accepts `24:00:00`, and falls back
  to an implementation-defined reading where `Jan 15 2025` is **local** time.
- **Invariant 3's passed-over test requires the item's signer to own the manifest.** Do not
  "simplify" that scope away: unscoped it convicts a board owner on a timestamp a contributor
  chose, and there is a test named for exactly that.
- **`reconcileFeed` violations carry `retryable`**, and `reader.js` maps those to a
  `feed_behind_manifest` finding rather than `invariant` (so exit 1, not 2).
- **`fetchDocument` refuses cross-origin redirects for every `kind` except `'json'`.** `'json'` is
  the unclassified default and keeps the permissive behaviour.
- **`_sig` covers `_recovery_sig` (§6.3), so order matters: co-sign first, then sign.** Prefer
  `advanceIdentity(changes, { recoverySigner })`, which co-signs atomically. `coSignIdentity`
  retrofits onto the tip and is only safe before the tip's bytes are first served.
- **The delivered column is an audience of one.** `_openfeed.delivery` lives only at top level of
  that object, is ignored (and MUST NOT appear) on published items, and
  `Publisher.retractDelivered` tombstones a delivered item.
- **`ObservationStore` keys `(author, id, _openfeed.version)`.** The revocation check *bounds* the
  self-reported time (`Math.max`), never replaces it; don't "simplify" it back to `??`.
- **`effectiveSigningTime` and `claimedAuthor` both require an explicit `{ kind }`** — no
  field-sniffing, because an item can carry a numeric `updated` as conformant unknown data. That
  is now also what `typ` enforces on the wire.
- **`createInbox`'s `ownsItem` is owner-authored only**; "previously accepted here" is
  `DedupStore.knows`, wired automatically. Pointing `ownsItem` at a whole item store reopens the
  fetch oracle (0.5). A **blocked** author writes neither store.
- **A two-feed identity needs no `Publisher` change.** `advanceIdentity({ feeds: [...current, e] })`
  merges over the tip, and a second `Publisher` on the same identity supplies the feed and manifest
  files — serve everything it emits *except* `openfeed*`. `test/cli.test.js`'s archive-equivocation
  test is the worked example.
- **`_next_update` strictness binds the manifest tip only**; in retained history a malformed value
  is read as absent.
- **§13's list is numbered and cross-referenced from four files.** Append, don't insert.

## Questions still unanswered

1. **§3.1's percent-encoding** — the one place two conforming implementations can split one
   identity into two chains. No prototype; longest-standing open question. §3.1 now states a
   *second* comparator beside it (for feeds and manifests), which shares the same hazard and
   inherits the same open question.
2. **Where the §15 review comes from** — decision 4 is the interim answer; it does not retire the
   "never independently reviewed" caveat.
3. **Adoption asymmetry** — decision 5 reframes it, does not close it. Product question.
