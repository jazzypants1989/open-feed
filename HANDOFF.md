# Handoff

Delete this file when you have consumed it. It is what is still open, plus the traps that have
already bitten someone. `tmp/review-findings.md` is the permanent record; this is orientation.

**Baseline:** `npm run check` → 266 tests pass, test vectors regenerate clean, the rules gate
passes. `npm run prototypes` → all 17 hold (~5 min; it writes `tmp/prototype-results.json`, so
read that before paying for a rerun). Working tree clean.

---

## Read this first, if you read nothing else

This project keeps finding the same bug in different costumes: **something was written down once,
nobody ever checked it again, and it quietly stopped being true.** Four instances so far.

| What went stale | How long | What caught it |
| --- | --- | --- |
| A prototype that had been failing every check while printing "ok" | 4 commits | adding an assertion to it |
| §3.3.1, a rule `src/` never implemented — with a live security bug underneath | life of the reader | `tmp/rules.js`, by accident |
| "Appendix C is ~15% of the spec" — it is 4.5%, and the number nearly deleted the appendix | 4 passes | recomputing it |
| §5.2 contradicting §4.3 about key retention | unknown | `tmp/rules.js`'s echo check |

So the working rule here is: **if you are about to act on a number or a claim, re-derive it
first.** Most of the tooling in `tmp/` exists because someone didn't.

---

## The owner's decisions — settled, do not reopen

1. **Group messages:** a delivered item goes to exactly one recipient, by rule. Done.
2. **Timestamps stay in whole seconds.** Milliseconds was proposed and the owner withdrew it.
   *Why it must not come back:* `iat` on a key is a **registered** JOSE parameter (IANA "JSON Web
   Key Parameters"), defined as RFC 7519's `iat` — a NumericDate, in seconds. Using milliseconds
   there means publishing a standard field with the wrong unit, which no library would catch.
   Using milliseconds only in Open Feed's own fields is worse in a different way: it puts a
   unit boundary right on the revocation comparison in §6.5. One unit everywhere.
3. **Extension fields are namespaced** under a single `_openfeed` object on items and
   attachments. `_sig` stays at top level in all three document kinds. See `d5ddc03`.
4. **The §15 encryption review** is three adversarial reviews by foundation models, then a human
   cryptographer at public launch. The owner uses OpenCode Go; the key is in `.env` (gitignored)
   as `OPENCODE_KEY`. Models: GLM-5.3, Kimi K3, Qwen3.8 Max. **Not done — do this last**, over
   the finished spec, and say plainly that it is a shake-out and not a cryptographer's review.
5. **Audience:** the owner's family first, but the spec is for anyone. 2–3 reference
   implementations planned. Context, not a task.
6. **DISTRIBUTION-MODEL's phases are not a release schedule.** Everything gets built before
   anyone outside sees the spec, so "which phase does feature X land in" is moot. Don't rearrange
   them again.
7. **Three ways of extracting the spec's rules were all rejected** — an index appendix, a
   requirements table, and a blockquote convention. The owner's words: *"the spec has gotten
   really bloated at this point, and I definitely don't want to do anything that expands that
   bloat in any way."* **Do not implement any of the three.** What the ambitious alternative is
   remains open; see "Where the length question actually stands" below.

---

## Status

- **Stage 0 (bugs in `src/`): closed** — but read that as "the list we wrote down is done", not
  "`src/` is clean". A Stage 0-class bug was found *after* the close (register 0.13), by a tool
  built to measure something else.
- **Stage 1 (spec corrections): closed.**
- **Stage 2 (design changes): closed.**
- **Stage 3 (removing mechanisms): untouched, and it is the only remaining way to make the spec
  meaningfully shorter.** Five candidates are listed in the register with what each one breaks.
  None has been measured. Each needs a prototype or a real argument, not a preference.
- **Stage 4 (publication readiness):** its first item is blocked by decision 7. Its other items
  (a consumer-state section, a fetch-order section, discovery, README honesty notes) all *add*
  text, so they wait.
- **Stage 5 (evidence): partly done.** See "What's open", item 2.

---

## What's open, in the order I would take it

**1. Stage 3 — removing mechanisms.** The spec is long because it has a lot of distinct content,
not because it repeats itself (measured: 427 RFC 2119 keywords, 336 rule-bearing sentences, one
echo pair, and that pair is the Abstract summarizing §11.3, which is what an abstract does). So
compression has nothing to take and an index would be a second copy of things stated once. The
only thing that shortens the document is deleting a mechanism. The five candidates are in the
register. **This is the whole game and nobody has measured any of it.**

**2. Stage 5's leftovers.** `syndication-prototype.js` recommends a design it never measured —
its verdict is an *unchained* signed document, but the option it priced was chained, and the
chaining is what its cost numbers measured. Separately, six prototypes hand-roll their own
canonicalization and signing instead of importing `src/`, so they can agree with each other while
disagreeing with the shipped code.

**3. Decision 4** — the three-model review, last, over the finished spec.

**4. The claims ledger, if you want the ambitious answer.** See below.

---

## Where the length question actually stands (decision 7)

Three ideas were sketched for "what the ambitious answer to length is." Two are now closed by
measurement — see `tmp/sketches-review.md`, and don't re-cost them:

- **Merging §5 and §9 into one "chained document" section: dead.** §9.1 already opens *"Producing
  and verifying a manifest version follow §5.2 and §5.3 exactly, with these substitutions"* and
  gives the table. That *is* the merge. And 87% of §9 has no §5 counterpart — skip links,
  freshness, cadence, and §9.3's invariants are manifest-only. All of the risk, none of the gain.
- **Cutting "conformance surface" by aiming with the weight table: dead.** The weight table ranks
  by absolute count, so one big section outranks the same material split in three — that is how
  Appendix C got called 15% when it is 4.5%. The real question is which sections bind somebody no
  conformance level requires, and that has three answers: Appendix C, §15, §16. The owner settled
  two; Appendix C was examined this pass and kept (`tmp/appendix-c-case.md`).
- **The third idea survived and is now built**: `npm run rules:gate` fails if a section carrying a
  MUST is cited by neither `src/` nor `test/`. It would have caught §3.3.1 the day it was written.

**The finding those three missed**, and the most useful thing to come out of the pass: **§12's
conformance checklist reaches only about half the spec's MUSTs.** It lists *behaviors* ("fetch and
parse identity documents") and never restates the *shapes* those behaviors act on — §3.2, §4.1,
§5.1, §5.4. An implementer could satisfy every line of §12 and not be conformant. §12 now says so
in a short paragraph, which is the cheap fix; whether anything more is wanted is open.

### The owner's idea, which was dismissed and should not have been

**Building the spec from the code, by first proving each fact from the code.** This is the
owner's proposal. It appears in the record exactly once — the previous pass's handoff, written up
anonymously as "the tempting inversion", rejected in the same paragraph, ending *"so nobody
re-proposes it."* Then the pass after that deleted the paragraph and reinvented a weaker piece of
it under a new name. **If you find yourself about to reject an owner suggestion in the document
that is supposed to carry it forward, don't.**

The rejection answered a weak reading — *generate the spec's prose from rule objects* — and that
reading does deserve to fail: the spec's value is its argument, why this rule and not the weaker
one, and arguments don't decompose into data. But the owner's framing is **prove each fact from
code first**, which is not about generating prose at all. It is about what earns the right to be
written down. Under that reading, every failure this repo has catalogued is a claim the code never
supported, and it is the only proposal on the table that addresses all four rows of the table at
the top of this file.

**`tmp/prove.js` is the first working slice of it.** For each rule: a one-line edit to `src/` that
breaks it, and the test that must start failing. Run `npm run prove`. It proves a transition —
the test passes on clean code, then fails on broken code — because either half alone is worthless.

`tmp/proofs.js` holds the table, and it holds **no rule text at all**: a section number, an edit,
a test name. There is nothing in it to drift out of agreement with the spec, which is what the
original objection was actually about.

What it has already found, from five entries:

- §11.1.1's producer-side guard had **no test**. `Publisher` refused to deliver an item carrying
  `_openfeed.feed_url`, and deleting that guard kept the whole suite green. Test written.
- `chain.js`'s stateless report of the compare rule is **not exercised by anything**, and its own
  comment says it is unreachable when a `PinStore` exists. Either a test is missing or the line is
  dead. Left failing on purpose — see the note in `tmp/proofs.js`.
- The first version of `prove.js` reported **four false proofs**, because a `--test-name-pattern`
  matching nothing still exits non-zero, so "nothing ran" and "the test caught it" looked
  identical. Fixed by requiring the named test to exist and to pass first.

**Not yet wired into `npm run check`**, deliberately: one entry is legitimately failing, and a
gate that ships red gets ignored or suppressed. Resolve the §5.3.1 question, then wire it.

**Where to take it next**, in rough order of value:
1. Cover the enforceable MUSTs. `rules.js --gate` says which sections are cited; this says which
   are *held*. The honest output is a fraction — proven / enforceable — and nobody can currently
   state it.
2. Extend past normative rules to **numbers and uniqueness claims**, which is what nearly deleted
   Appendix C and what nothing checks today.
3. Decide what a rule that cannot be proven from this code means. Appendix C's bind gateways;
   §10.5's bind display. Those are not failures, and the report should say so by name.

**Things not to try**, each having already cost a pass: a line budget (deliberately retired),
splitting the document into several, cutting the reasoning that sits next to a MUST, or adding an
index.

---

## Traps — things that will bite you

Newest first.

- **`tmp/rules.js`'s weight table is a ranking, never a proportion.** It ranks by absolute MUST
  count, so a large section outranks the same material split across three smaller ones. Do not
  convert a rank into a percentage; that mistake nearly deleted Appendix C.
- **`--gate` is the only part of `rules.js` that can fail a build, and keep it that way.** The
  other three columns are heuristics over prose, and a threshold that fails a build is a
  threshold somebody will tune until it passes. "Is this rule connected to the code at all?" has
  no threshold in it, which is why it is the one that gates.
- **The reader looks up a co-author's identity once per read, and fetches it again next read.**
  That is §3.3.1, not performance tuning. Do not add a cache that spans reads: checking a
  co-author's item walks and pins *their* chain, so a stale cache means fork detection silently
  stops. Measured, the cache saved one conditional GET per co-author per poll. `inbox.js` keeps
  its one-hour cache and is right to — it caches a *document* to check one signature, never a
  chain walk.
- **A prototype with no assertions is only checking that the file still runs.** If you add one,
  make it assert, then break the thing it claims and confirm it fails.
- **`_openfeed` is merged into an item, never replaced.** `{ ...item, _openfeed: { rel } }` drops
  `version` and everything downstream fails for a reason that looks unrelated. `publish.js` has
  `withOpenFeed`; `tmp/` has no equivalent, which is how `inbox-prototype.js` broke.
- **Both consumer stores evict whole identities and never old entries.** §4.4's record is a
  *lower* bound on when a key could have signed, so the oldest observations are the strongest and
  an age-ranked evictor destroys the thing it is bounding. §13.4 states it.

Older, still true:

- **`sign()`, `buildHeader()` and `verifyDocument` all require an explicit `kind`** —
  `'identity'`, `'manifest'` or `'item'`. There is no default, and `'document'` no longer exists.
- **`_sig` stays at top level in all three document kinds**, despite `_openfeed`. §6.3's strip
  rule is defined on that; §7.2 states the exception and why.
- **`policy.verifySignature(doc, { url })` requires the chain URL** and throws without it.
- **`identityDocumentUrl` lives in `jws.js`** (re-exported from `fetch.js`) so `chain.js` can use
  §3.2's path convention without importing the module that opens sockets.
- **`parseTimestamp` in `jws.js` is the only content-timestamp parser.** Not `Date.parse`, which
  accepts `2025-02-30` and `24:00:00` and reads `Jan 15 2025` as *local* time.
- **Invariant 3's "passed over" test only applies to items the manifest's owner signed.**
  Unscoped, it convicts a board owner over a timestamp a contributor chose. There is a test named
  for that.
- **`reconcileFeed` violations carry `retryable`**, and `reader.js` maps those to a
  `feed_behind_manifest` finding rather than `invariant` — exit 1, not 2.
- **`fetchDocument` refuses cross-origin redirects for every kind except `'json'`.**
- **`_sig` covers `_recovery_sig`, so order matters: co-sign first, then sign.** Prefer
  `advanceIdentity(changes, { recoverySigner })`. `coSignIdentity` retrofits onto the current tip
  and is only safe before those bytes have been served to anyone.
- **`_openfeed.delivery` only ever appears at top level**, is ignored on published items, and
  `Publisher.retractDelivered` tombstones a delivered item.
- **`ObservationStore` keys on `(author, id, _openfeed.version)`.** The revocation check *bounds*
  the self-reported time with `Math.max`; it never replaces it. Don't "simplify" it back to `??`.
- **`effectiveSigningTime` and `claimedAuthor` both require an explicit `{ kind }`** — no
  field-sniffing, because an item may legitimately carry a numeric `updated` as unknown data.
- **`createInbox`'s `ownsItem` is owner-authored only.** "Previously accepted here" is
  `DedupStore.knows`, wired automatically. A blocked author writes neither store.
- **A two-feed identity needs no `Publisher` change.** `advanceIdentity({ feeds: [...current, e] })`
  merges over the tip; a second `Publisher` on the same identity supplies the feed and manifest
  files — serve everything it emits *except* `openfeed*`.
- **`_next_update` strictness binds the manifest tip only**; in retained history a malformed value
  reads as absent.
- **§13's list is numbered and cross-referenced from four files.** Append, never insert.
- **`tmp/regen.js` checks that every hash-shaped literal in Appendix B is from the current run.**
  If you add a vector shape quoted twice — once alone, once nested — check the rule reaches both.
  That class of stale literal has survived a passing run twice.
- **The spec, README and DISTRIBUTION-MODEL are consistent.** Any wire change breaks three files.
  `npm run rules` now reports sentences the spec shares near-verbatim with the other two, which is
  where that consistency rots first.

---

## Questions nobody has answered

1. **§3.1's percent-encoding rule** — the one place two conforming implementations could split
   one identity into two chains. No prototype; longest-standing open question. §3.1 now states a
   second URL comparator beside it, which shares the hazard.
2. **Where a real §15 review comes from.** Decision 4 is an interim answer and does not retire
   the "never independently reviewed" caveat.
3. **Adoption asymmetry.** Publishing is expensive and buys the publisher nothing until verifying
   readers exist in numbers. This is a product and distribution problem and no amount of spec work
   touches it. See the last section of the register.
4. **What the ambitious answer to length is** (decision 7). The claims ledger is the current best
   candidate; it is the owner's call.
