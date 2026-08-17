# Handoff — after the register pass

Delete this file when it has been consumed. It is a list of what is still open plus the traps;
none of it belongs in `CLAUDE.md` or the spec. `tmp/review-findings.md` is the durable register.

**Baseline:** `npm test` → **265 pass, 0 fail**. `node tmp/regen.js` → all checks pass.
`npm run prototypes` → **all 17 hold**, re-run this pass; see `tmp/prototype-results.json`
(gitignored; read it before paying for a rerun, the full suite costs ~5 min). Working tree clean.

## The owner's decisions — SETTLED, do not relitigate

1. **Group messages → the delivered column is an audience of one, by rule.** DONE.
2. **Timestamps → milliseconds. WITHDRAWN**, by the owner. Superseded by `(updated, seq)` with
   `updated` non-decreasing, which is DONE and closes 1.8. **The reason is load-bearing and is
   why this must not come back:** `iat` on a JWK is not an Open Feed invention borrowing a JWT
   convention — it is a *registered* JOSE parameter (IANA "JSON Web Key Parameters"; change
   controller OpenID Foundation; OpenID Federation 1.0 §8.7.2), defined as RFC 7519's `iat`, a
   NumericDate, **in seconds**. Milliseconds there is a registered public parameter carrying the
   wrong unit, which no library that knows the name would catch. Scoping the move to Open Feed's
   own fields is worse in a different way: it puts the unit seam exactly on §6.5's revocation
   comparison and §16.1's `observed` check. One unit protocol-wide.
3. **`_`-field rename → a single namespacing object.** DONE — `_openfeed`, items and attachments
   only, `_sig` staying at top level in every kind. See `d5ddc03` for the scope argument.
4. **§15 review → three foundation-model adversarial reviews** (human cryptographer later, at
   public launch). The owner uses OpenCode Go; the key is in `.env` (gitignored) as
   `OPENCODE_KEY`. Requested models: **GLM-5.3, Kimi K3, Qwen3.8 Max**. NOT DONE — this is the
   *last* step, run over the finished state. It is a shake-out, not a substitute for a
   cryptographer's pass; say so.
5. **Audience → the owner's family first, but the spec is for anyone; 2–3 reference
   implementations planned.** Context, not a task.
6. **DISTRIBUTION-MODEL's phase boundaries are not a release schedule.** Asked whether the
   `{audience}` tier should wait for §15 in Phase 3 or move §15 forward, the owner's answer was
   that **all phases will be built before anyone outside sees the specification**. So the
   question is moot and the document's current text stands: no audience tier until the layer
   ships. Do not spend another pass rearranging phases.
7. **Stage 4's extraction mechanisms are REJECTED — all three.** An index appendix, a
   requirements table, and finishing the blockquote convention were each put to the owner and
   each declined: *"we need to be more ambitious… the spec has gotten really bloated at this
   point, and I definitely don't want to do anything that expands that bloat in any way."* The
   owner is still working out what the ambitious version is. **Do not implement any of the
   three.** The sketch below is what this pass could contribute to that thinking.

## What this pass was

Four items off the previous handoff's list, in its order. `git log` has the reasoning per change.

1. **§12's checklists and Appendix B's coverage** (closes S2.9). Six rules Level 1 was relying on
   without naming; `_next_update` at Level 2; and Appendix B stopped publishing a publisher that
   was non-conformant with its own document — no vector carried `items: true`.
2. **The store-growth evictor** (closes Stage 0). `ObservationStore` and `MigrationStore` bound
   themselves now, by identity and never by age, with §13.4 stating the rule.
3. **Prototype gates** for `enctags`, `inbox`, `deltamanifest`.
4. **`tmp/rules.js`**, a normative inventory — the instrument for Stage 4 rather than an answer
   to it, since every proposed answer made the document longer.

**The thing worth carrying forward from 3:** `inbox-prototype.js` had been failing every scene
since the `_openfeed` rename and reporting `ok`, because nothing in it asserted anything. Its
`signItem` replaced `_openfeed` instead of merging it, so every item failed §10.2 step 2 and the
"happy path" returned 400. Four commits of "all 17 prototypes hold" covered it. That is the
third time this class has survived a green run.

## Status

**Stage 0 (`src/` defects): CLOSED.**
**Stage 1 (spec corrections): CLOSED.**
**Stage 2: CLOSED**, S2.9 included.
**S2.11 (docs): DONE.** README and DISTRIBUTION-MODEL both match the spec.
**Stage 5 (prototype gates):** the three named gates are DONE. Its other bullets are open —
see "Open, 3".
**Stage 3 (surface-area cuts):** untouched, and now the highest-value stage — see the sketch.
**Stage 4 (publication readiness):** its first item is BLOCKED on decision 7. Its other items
(consumer-state section, fetch-order section, discovery, README honesty bullets) are untouched
and every one of them *adds* text, so hold them until decision 7 resolves.

## Open, in the order I would take it

**1. Stage 3, which is now the whole game.** The owner's concern is length; `tmp/rules.js` says
the length is not repetition (below), so the only lever that shortens the document is removing
mechanisms. Stage 3's five candidates are in the register with what each one breaks. Nothing has
been measured for any of them and each needs a prototype or an argument, not a preference.

**2. The shortlist `tmp/rules.js` produced.** Run `node tmp/rules.js` — it is a report, it
changes nothing, and it takes a second:
- **Appendix C carries 13 MUSTs and nothing in `src/` or `test/` cites it.** That is ~15% of the
  specification's binding weight, for gateways, required by no conformance level, and it says
  itself that it defines no profile and never will. The honest question — not mine to answer —
  is whether it is a specification or an essay, and README is where essays live. It is the
  single largest reduction available and it costs no rule any level requires.
- **§3.3.1 (Caching) is the only section that is both orphaned and unbacked.** Its MUST is real
  ("a consumer deciding a verdict MUST revalidate rather than answer from a stale cached copy"),
  and **nothing in `src/` claims to implement it** — `reader.js` caches identity documents and
  cites §12 and §13.9 for the ceiling, never §3.3.1's revalidation rule. Worth an hour: can the
  shipped reader answer a §5.3.1 or §9.3 verdict out of its identity cache? If it can, that is a
  Stage 0 defect that outlived Stage 0.
- **§10.1 is orphaned but backed** — nothing points at it, everything implements it. Benign.

**3. Stage 5's remainder.** `syndication-prototype.js` still recommends a shape it never measured
(the verdict is an *unchained* signed document; the B it priced was chained). Six prototypes
still re-derive `canon`/`sign` by hand rather than importing `src/`. `inbox-prototype.js`'s
supersession markers were fixed this pass; `enctags`'s were too.

**4. Decision 4** — the three-model adversarial review, last, over the finished state.

## Sketch — what "more ambitious" could mean (decision 7)

Offered as material for the owner's thinking, not as a plan. The one hard input is a
measurement, so start there.

**The measurement changes the problem.** `tmp/rules.js` on the current text: **431 RFC 2119
keywords across 338 rule-bearing sentences and 64 sections, with two echo pairs** — and one of
those two was a live contradiction, now fixed, while the other is the Abstract summarising §11.3,
which is what an abstract is for. **The document does not repeat itself.** Its length is distinct
content. Three consequences, and they are what rule out the easy answers:

- *Compression has nothing to take.* There is no fat to trim; every paragraph is carrying a
  different rule or the reason one is not weaker.
- *Any index, table, or extraction appendix is pure addition.* You would be indexing a document
  with no duplication, so the index is a second copy of things stated exactly once — the shadow
  copy CLAUDE.md warns goes stale and then contradicts its source. This is the measured argument
  against the three mechanisms decision 7 rejected, and it agrees with the rejection.
- *The only levers that shorten it are removing mechanisms and removing conformance surface.*

**Sketch A — generate the coverage claim, not the prose.** The tempting inversion is to make each
rule a first-class object in `src/` (keyword, section, the check that enforces it, the test that
falsifies it) and assemble the document from them. It fails for a reason worth stating so nobody
re-proposes it: the spec's value is its *argument* — why this rule and not the weaker one — and
arguments do not decompose into rule objects. You would get a generated catalogue plus a
hand-written companion holding all the reasoning, which is the split CLAUDE.md forbids, with
extra machinery. **What survives the objection is the checkable half.** Promote `tmp/rules.js`'s
UNBACKED column from a report to a gate: every binding section must be cited by at least one
`src/` comment and one test, or CI fails. That adds *nothing to the document*, makes "is this
rule real?" answerable mechanically, and would have caught §3.3.1 the day it was written. It is
the tractable piece of the ambitious idea and it is cheap.

**Sketch B — cut conformance surface, using the weight table to aim.** The inventory ranks
sections by binding weight: §12 (14), Appendix C (13), §16.1 (12), then §3.2, §3.2.1, §9.3,
§7.6, §15.1 at 11 each. Two of the top three are questions rather than facts of nature —
Appendix C above, and §16.1, which carries 12 MUSTs for a mechanism §16.2 makes optional to heed.
Note also that **§12 is already a shadow copy by design**: its 14 MUSTs are restatements of rules
that live elsewhere, which is exactly the extraction surface Stage 4 asks for, already built and
already maintained by hand. Leaning into it and deleting it are both coherent; maintaining it
while adding a second one is not.

**Sketch C — the long shot, named so it can be dismissed properly.** The identity chain and the
manifest chain are one mechanism, and §9.1 says so in a substitution table. §5 and §9 are a large
fraction of the document and much of §9 is §5 restated under that substitution. A single "chained
document" section with the differences as the table — rather than the table as a mapping between
two full treatments — is a real design change of the kind "more ambitious" might mean. It is also
the riskiest thing in this file: the two chains differ in *which* checks apply per hop (§9.1's
relaxation of the per-hop `_sig`, which it explicitly forbids carrying to §5.3), and a unification
that blurs that is a security regression. Prototype before believing it.

**What not to do**, since each has already cost a pass: a line budget (retired deliberately),
splitting the document (forbidden), cutting justification that sits beside a MUST (forbidden),
and adding an index (measured against, above).

## Things that will bite you

New this pass, above the rule:

- **A prototype with no assertion gate is checking that the file still runs.** All three fixed
  this pass had drifted or broken without saying so, and `inbox` had been broken for four
  commits. If you add a prototype, gate it, and revert-check the gate by breaking the claim.
- **`_openfeed` is merged, never replaced — and prototypes are where this keeps happening.**
  `{ ...item, _openfeed: { rel } }` drops `version` and every downstream check fails for a
  reason that reads as unrelated. `publish.js`'s `withOpenFeed` is the helper; `tmp/` has no
  equivalent, which is how `inbox-prototype.js` broke.
- **Both consumer stores now evict, and the rule is not "keep it fresh".** `ObservationStore` and
  `MigrationStore` drop **whole identities** and never old entries: §4.4's record is a *lower*
  bound, so the oldest observations are the strongest and an age-ranked evictor destroys the
  mechanism. §13.4 states it. Retained without asking: an identity owning a tracked feed, and
  either side of a recorded or contested migration.
- **`tmp/rules.js` is a report and deliberately has no gate.** Do not add one casually — its
  ECHOES and ORPHANS columns are heuristics over prose and a threshold that fails a build is a
  threshold somebody will tune until it passes. UNBACKED is the column worth promoting.

Everything below the rule was already true:

- **`sign()` and `buildHeader()` require an explicit `kind`** — `'identity'`, `'manifest'` or
  `'item'` — and have no default. `verifyDocument` requires one too and checks it against `typ`.
- **The `kind` vocabulary is three values, not two.** `'document'` is gone; anything passing it throws.
- **`_sig` stays at top level in all three document kinds**, `_openfeed` notwithstanding, and
  §6.3's strip rule is defined on that. §7.2 states the exception and the reason.
- **`policy.verifySignature(doc, { url })` — the chain URL is required by `identityChainPolicy`**
  and it throws without one. `walkToPin` threads it.
- **`identityDocumentUrl` lives in `jws.js`** (re-exported from `fetch.js`), so `chain.js` can
  name §3.2's path convention without importing the module that opens sockets.
- **`parseTimestamp` (`jws.js`) is the only content-timestamp parser.** Not `Date.parse`, which
  accepts `2025-02-30`, accepts `24:00:00`, and reads `Jan 15 2025` as **local** time.
- **Invariant 3's passed-over test requires the item's signer to own the manifest.** Unscoped it
  convicts a board owner on a timestamp a contributor chose; there is a test named for that.
- **`reconcileFeed` violations carry `retryable`**, and `reader.js` maps those to a
  `feed_behind_manifest` finding rather than `invariant` (so exit 1, not 2).
- **`fetchDocument` refuses cross-origin redirects for every `kind` except `'json'`.**
- **`_sig` covers `_recovery_sig` (§6.3), so order matters: co-sign first, then sign.** Prefer
  `advanceIdentity(changes, { recoverySigner })`. `coSignIdentity` retrofits onto the tip and is
  only safe before the tip's bytes are first served.
- **The delivered column is an audience of one.** `_openfeed.delivery` lives only at top level,
  is ignored (and MUST NOT appear) on published items, and `Publisher.retractDelivered`
  tombstones a delivered item.
- **`ObservationStore` keys `(author, id, _openfeed.version)`.** The revocation check *bounds* the
  self-reported time (`Math.max`), never replaces it; don't "simplify" it back to `??`.
- **`effectiveSigningTime` and `claimedAuthor` both require an explicit `{ kind }`** — no
  field-sniffing, because an item can carry a numeric `updated` as conformant unknown data.
- **`createInbox`'s `ownsItem` is owner-authored only**; "previously accepted here" is
  `DedupStore.knows`, wired automatically. A **blocked** author writes neither store.
- **A two-feed identity needs no `Publisher` change.** `advanceIdentity({ feeds: [...current, e] })`
  merges over the tip, and a second `Publisher` on the same identity supplies the feed and
  manifest files — serve everything it emits *except* `openfeed*`.
- **`_next_update` strictness binds the manifest tip only**; in retained history a malformed value
  is read as absent.
- **§13's list is numbered and cross-referenced from four files.** Append, don't insert.
- **`tmp/regen.js`'s staleness check covers detached-JWS literals and scans fenced blocks.** If
  you add a vector shape quoted twice — once alone, once nested — check the rule reaches its
  literal. That class has survived a green run twice.
- **The docs and the spec are consistent.** Any wire change from here breaks three files.

## Questions still unanswered

1. **§3.1's percent-encoding** — the one place two conforming implementations can split one
   identity into two chains. No prototype; longest-standing open question. §3.1 now states a
   *second* comparator beside it, which shares the hazard and inherits the question.
2. **Where the §15 review comes from** — decision 4 is the interim answer; it does not retire the
   "never independently reviewed" caveat, and §15's promotion raised what rides on it.
3. **Adoption asymmetry** — decision 5 reframes it, does not close it. Product question.
4. **What the ambitious answer to length is** — decision 7, open by the owner's choice. The
   sketch above is input, not an answer.
