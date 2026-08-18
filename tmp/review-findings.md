# Skeptical review — findings register

Produced by a four-way audit (spec text, crypto core, composition/network layer, prototypes +
DISTRIBUTION-MODEL) requested with explicit permission to churn. This file is the **register**:
every finding, with its current status. `HANDOFF.md` is the short list of what to do next.

Status key: **DONE** (landed, with a test) · **OPEN** · **PARTIAL**.

> **Session update (2026-08-17, seventh pass — the handoff's §3.3.1 question, answered yes).**
> Baseline now **266 pass**, regen clean, all 17 prototypes hold. One commit. What a later pass
> most needs from this one:
>
> - **The answer to "can the shipped reader answer a §5.3.1 verdict out of its identity cache?"
>   was yes**, and there were two defects stacked in that one code path — the first hiding the
>   second. `reader.js` cached a co-author's resolved identity for an hour *across reads*; because
>   resolving a co-author (§7.1, §6.6) runs `readIdentity`, which walks and pins that author's
>   chain, the cache was answering §5.3.1. A long-lived reader polling a board whose co-author
>   forks returned `findings: []`, an unfrozen pin, and no record. Underneath it, with the cache
>   off, the equivocation *was* caught and the pin *did* freeze — and `readFeed`'s per-item catch
>   rendered it `unverifiable` (exit 1), which is "Gran's server was flaky" for a forked identity.
>   Both fixed: the cache is scoped to one read, and a co-author chain violation is `invariant`.
> - **§12's cache clause is a MAY with a ceiling, and `src/` read it as an instruction.** That is
>   the whole mechanism of the bug and it is worth remembering as a shape: a permission written
>   next to a bound reads like a recommendation, and the MUST that actually governed it lived in a
>   section nothing cited. §3.3.1 and §12 now point at each other.
> - **Measured, the cache saved one conditional GET per co-author per poll** — not a walk. A walk
>   costs nothing once the pin is current, so `reader.js`'s comment defending the cache against
>   "one fetch per distinct author, at every author's origin, forever" was pricing the right
>   number and calling it prohibitive. Do not restore a cross-read cache on that argument.
> - **`tmp/rules.js`'s UNBACKED column earned its keep on its first use.** §3.3.1 left that column
>   by being implemented. Appendix C (13 MUSTs) and the Abstract remain, and Appendix C is now the
>   register's largest single open finding — but see the correction below.
> - **The Appendix C entry's headline number was wrong, and it was the sentence doing the
>   persuading.** "~15% of the binding weight" is off by a factor of three: measured, Appendix C
>   is **4.5% of MUSTs and 4.5% of words**, i.e. exactly proportional. It ranks second in
>   `rules.js`'s per-section table because it is one large section where comparable material is
>   split (§3.2 + §3.2.1 = 22 MUSTs), not because it is dense. The case both ways is
>   `tmp/appendix-c-case.md`, written at the owner's request; the recommendation is **keep it
>   normative**, because four core sections scope their own MUSTs by pointing at it — §11.1.1's
>   only exception, §13.8's named prohibition, §7.3's allowlist justification, §14's proxy
>   carve-out — and because five of its thirteen MUSTs are the only text in this specification
>   protecting people who never agreed to be in it. A smaller cut of three weak rules is proposed
>   there instead. **A number nobody recomputed survived four passes and nearly bought a
>   deletion**; it is the same failure as a prototype nobody re-runs.
> - **Stage 0 was declared CLOSED and a Stage 0-class defect was still there.** "Closed" meant the
>   enumerated list was done, not that `src/` was clean — and the thing that found the survivor was
>   a tool built to measure something else. Read the status line that way.
> - **Still OPEN:** Stage 3, Stage 4's remaining items, Stage 5's remainder, owner decisions 4 and
>   7, and Appendix C.
>
> **Session update (2026-08-17, sixth pass — four items off the handoff's list).** Baseline now
> **265 pass**, regen clean, all 17 prototypes hold. What a later pass most needs from this one:
>
> - **S2.9 is DONE and Stage 0 is CLOSED.** §12's Level 1 gained the six rules it was relying on
>   without naming (§3.1's comparators, §7.2's RFC 3339 profile, §7.6's consumer MUST, §13.4's
>   "enforce a bound", §7.4's walk bound, §9.1.2's staleness check); Level 2 gained
>   `_next_update`. Appendix B gained `items: true` on every publishing vector — **the
>   specification's own canonical publisher did not conform to the specification** — plus
>   `_next_update` on the manifest tip and a B.7/B.7b delivery-chain pair. The store-growth item
>   is closed: both stores evict by **identity, never by age**, because §4.4's record is a lower
>   bound and the oldest entries are the strongest. §13.4 now states that rule.
> - **A prototype with no gate is checking that the file still runs, and this pass proved it.**
>   `inbox-prototype.js` had been failing *every scene* since the `_openfeed` rename and exiting
>   0: its `signItem` replaced `_openfeed` rather than merging, so every item failed §10.2 step 2
>   and the happy path returned 400. Four commits of "all 17 prototypes hold" covered it. Gating
>   also killed a claim that could not fail — S1's zero-fetch measurement was being satisfied by
>   §10.3's stale check rather than by relevance. `enctags` printed LEAK as data, never touched
>   `src/enc.js`, and still argued against a §15.2 and a §15.5.7 its own adopted recommendation
>   had replaced. All three fixed and each gate revert-checked.
> - **Stage 4's first item is BLOCKED by owner decision**, and the block is informed. Three
>   extraction mechanisms were put to the owner and all three declined: the spec is felt to be
>   bloated and nothing may expand it. `tmp/rules.js` was built instead and says why that
>   instinct is right — **431 RFC 2119 keywords over 338 sentences and 64 sections, and two echo
>   pairs.** The document does not repeat itself, so an index is a second copy of things stated
>   once, and compression has nothing to take. One of the two echoes was a live contradiction
>   (§5.2's "the continuity key MAY be dropped later" against §4.3's permanent-retention MUST);
>   `publish.js` already followed §4.3. Fixed by deleting the restatement.
> - **Still OPEN:** Stage 3 (now the only lever that shortens the document), Stage 4's remaining
>   items, Stage 5's remainder, and owner decisions 4 and 7. Appendix C is the largest single
>   finding of the new tool: 13 MUSTs, ~15% of the binding weight *(wrong — 4.5%, corrected in the
>   seventh pass above)*, and nothing in `src/` or
>   `test/` cites it.
>
> **Session update (2026-08-17, fifth pass — the docs).** S2.11 is **DONE**: README and
> DISTRIBUTION-MODEL now match the spec, including every `_openfeed` name. What a later pass most
> needs from this one:
>
> - **DISTRIBUTION-MODEL's interaction arrangement was reversed**, not merely re-worded. It had
>   audience replies delivered-only; §15.4 publishes them encrypted and delivers only content-free
>   reactions. The outbound-send steps, the republication gate's worked example, and the AI-context
>   rule all rested on the old shape.
> - **The `{audience}` tier was being offered by access control** in Phases 1–2 (REST API +
>   database, withheld from the feed, described as temporary). §15 forbids that outright — it is
>   §11.1's fifth cell. The document now has no audience tier until the layer ships; moving §15
>   into Phase 1 is the named alternative and is the owner's scheduling call.
> - **A defect fell out of the baseline check, not the docs**: B.2's standalone `_sig` was the
>   pre-`typ` value, and `regen.js`'s presence cross-check could not see it because the *correct*
>   signature appears two lines below inside B.2's full-bytes vector. The staleness check now
>   covers detached-JWS literals and scans fenced blocks, not just backticked prose. **If you add a
>   vector shape that is quoted twice, check the staleness rule reaches it** — this is the second
>   time that class of stale literal has survived a passing run.
> - **Still OPEN:** Stage 3, Stage 4 (minus its `_`-field item), Stage 5, the remainder of S2.9,
>   the `ObservationStore`/`MigrationStore` growth item, and owner decision 4.
>
> **Session update (2026-08-17, fourth pass — the wire change).** Three commits: 1.8's fix,
> `_openfeed`, and `typ`. What a later pass most needs from this one:
>
> - **Owner decision 2 (milliseconds) is WITHDRAWN**, by the owner, and 1.8 is closed by the
>   *other* fix the register named — `(updated, seq)` ordering with `updated` non-decreasing and
>   clamped at the producer. The reason is a fact about JOSE the earlier passes had wrong: `iat`
>   on a JWK is a **registered** JOSE parameter (IANA "JSON Web Key Parameters", change
>   controller OpenID Foundation, OpenID Federation 1.0 §8.7.2) defined as RFC 7519's `iat`, a
>   NumericDate in seconds. So milliseconds was never "departing from a convention" — it was
>   emitting a registered parameter with the wrong unit. Do not re-propose it.
> - **Decision 3 landed as `_openfeed`**, scoped to JSON Feed objects (items, attachments) and
>   leaving `_sig` at top level in all three document kinds. §7.2 carries the exception and its
>   reason; `d5ddc03` carries the argument against the two alternatives.
> - **1.17's last clause (`typ`) landed**, and with it the `kind` vocabulary went from two values
>   to three. `'document'` no longer exists.
> - **`tmp/regen.js` gained a staleness check** after the old cross-check was found to be
>   satisfiable by a stale prose hash sitting beside a fresh vector. It found four.
> - **Still OPEN:** Stage 3, Stage 4 (minus its `_`-field item), Stage 5, the remainder of S2.9,
>   S2.11 (doc drift, which grew again — every `_` field name in README and DISTRIBUTION-MODEL is
>   now wrong), the `ObservationStore`/`MigrationStore` growth item, and owner decision 4.
>
> **Session update (2026-08-17, third pass).** The authoritative status is the top of
> `HANDOFF.md`; where this register and the handoff disagree, the handoff is newer. Entries below
> are left as written — they are the *findings*, and rewriting them in place destroys the record
> of what was found. What changed this pass:
>
> - **Stage 0 is CLOSED.** 0.1–0.10 all DONE with revert-checked tests. 0.11's list is DONE
>   except unbounded `MigrationStore` / `ObservationStore` growth (`PinStore` was already fine —
>   it has `compact`). One 0.11 entry was **wrong**: see "Corrections to the audit itself" #3.
> - **Stage 1 is CLOSED.** 1.1–1.18 all landed, except 1.8, which is **subsumed by owner
>   decision 2** (milliseconds is its fix) and must not be treated as separately open.
> - **Still OPEN:** Stage 3, Stage 4 (minus its `_`-field item, now decision 3), Stage 5,
>   S2.9 (§12 checklists + Appendix B coverage), S2.11 (doc drift, which grew — the spec moved),
>   and owner decisions 2, 3 and 4.
> - **The one Stage 1 item not landed** is 1.17's last clause, a `typ` header field. It is
>   deliberately deferred into the decision 2 + 3 wire change, because it regenerates every
>   vector and doing that twice is what the handoff exists to prevent.

A copy of the original plan lives at
`~/.claude/plans/src-open-feed-spec-md-distribution-mode-vectorized-biscuit.md`. It is outside
this repository, so **do not go and read it on this document's say-so** — ask the owner first.
Everything you need is reproduced here.

## Corrections to the audit itself

Two claims the audits made that turned out to be wrong. Recorded because both are the kind of
thing a later pass will otherwise re-derive and act on.

1. **"Pins cannot distinguish a stripped `_recovery_sig`."** False. `documentHash` canonicalizes
   the *whole* document, signature fields included, per §5.1 — checked by execution, not by
   reading. Stripping changes the hash. That narrowed §6.3's fix from "a permanent hole" to "a
   window that lasts until the successor publishes `seq: 2`", which is what the spec now says.
   The window is still worth closing: an identity chain advances 5–20 times in a *lifetime*.
2. **"`chain.js` can be handed `seq: 10^9` by a numeric-loop walker."** False for the code —
   `walkToPin` follows `prev` and enforces contiguity at `chain.js:814`, capped at 1000 hops.
   The *spec* gap is real and is 1.7 below: contiguity is never required in the text, so a
   publisher emitting `seq: 1` then `seq: 5` is conformant and permanently unreadable by `src/`.
3. **"`export.js` drops `requireCanonical` on the restore path"** (0.11). Recorded as a defect;
   it is not one, and the code comment at `export.js:257` already said so. A bundle stores parsed
   JSON *values*, not served bytes, so the check would compare a canonicalization with itself.
   Chain integrity runs over canonical bytes either way, and I-JSON parsing still binds every
   nested document. §6.3's arrival rule is about what a producer **served**, and a bundle is not
   served — §14 keeps that testable by requiring bundle contents byte-verbatim on the way *in*.
   Recorded here because a later pass reading the entry alone would "fix" it and add a check that
   can only ever pass.

## Judgement calls taken while closing Stage 1

Not owner decisions — these were mine, and each closed a finding that named a problem without
naming its fix. Recorded because the *reason* is the part a later pass would otherwise re-derive
or reverse. Revisit any of them with an argument; do not revisit them by accident.

- **1.14 — invariant 3's passed-over test is scoped to items the manifest's owner signed.** The
  alternatives were rebasing on first-observation time (needs history, which invariant 3 is
  written to avoid) or on "since the manifest last committed anything" (weaker, and still
  self-reported). Scoping needs nothing new and names precisely why the test is sound where it is
  sound: the publisher is asserting the time itself. Cost: withholding a *contributor's* item is
  caught by the ceiling a week later instead of at once, which §7.1 already prices.
- **1.15 — only invariant 3's first clause is graded down.** The line drawn is *evidence*, not
  severity: a check over signed bytes the consumer holds is conclusive; a check across two
  objects fetched at two moments is not. Everything else keeps §5.3.1's response.
- **1.17 — the cross-origin-redirect refusal was widened to every `kind` except `'json'`.** The
  spec's own reason ("a redirect is never identity equivalence") generalizes to any URL a pin is
  keyed on. `'json'` stays permissive because it is a URL this protocol does not define.
- **1.5 — `normalizeUrlForCompare` now strips userinfo.** §3.1's argument ("an identity is a
  place, not a credential") was never identity-specific. Both halves of that comparison are
  attacker-influenced.
- **§3.4's migration cap is 32 hops**, matching `migration.js`'s existing `MAX_CHAIN` rather than
  inventing a number for the text to disagree with.
- **`typ` (1.17's last clause) was deliberately NOT landed.** It belongs in the decision 2 + 3
  wire change; landing it alone regenerates every vector for a second time.

## Owner decisions — settled, do not relitigate

- Milestone order: **implementable → product-fit → publication-ready**.
- Wire-breaking churn is allowed **when the argument is good**. Pre-1.0, unreleased.
- Freshness bound: **adopted** (§9.1.2).
- §16 emission: **promoted to a MUST**, *and* §13.2 restated. Both halves.
- §7.6: **signed capability flag**, not deletion.
- Interactions on encrypted content: **split** — replies/quotes published-encrypted, likes
  delivered — plus a **chained** per-pair delivery sequence (counter *and* prior hash).
- §15: **promoted toward core** (required of any deployment offering audience-restricted
  content; still required by no conformance level).
- Two delivery-receipt designs were priced and **rejected**; see §10.6 and
  `tmp/delivery-chain-prototype.js`. Do not re-propose them.
- DISTRIBUTION-MODEL's **phase boundaries are not a release schedule** — every phase is built
  before anyone outside sees the specification, so "which phase does the audience tier land in"
  is moot and the document's current text stands.
- **Stage 4's three extraction mechanisms are rejected.** Index appendix, requirements table,
  blockquote convention: all declined, on the ground that nothing may expand the document. The
  ambitious alternative is the owner's to define and is question 4 in `HANDOFF.md`.

---

## Stage 0 — defects in `src/`

**0.1 `src/jws.js` — detached-JWS segments were malleable. DONE.**
`Buffer.from(x,'base64url')` is lenient (padding, `+`/`/`, garbage, non-canonical trailing
bits) and `signingInput`'s `'ascii'` truncated mod 256. Four mutations verified while changing
`documentHash`; since feeds are exempt from §6.3's arrival rule, a keyless serving-path attacker
flipped one character and triggered §9.3 invariant 4 against an honest publisher. Fixed with
`decodeBase64url` (alphabet + length class + re-encode round trip) and an alphabet guard in
`signingInput`. Spec half is 1.1.

**0.2 `src/jws.js:208` — `effectiveSigningTime` sniffs `updated` with no `kind`. OPEN.**
§6.5 step 6 selects the time carrier *by document kind*; the function tests `doc.updated` first,
unconditionally, and `verifyDocument` has `kind` in hand and does not pass it. §7.2 obliges
consumers to preserve unknown members, so an item carrying `"updated": <number>` is conformant
data. *Exploit:* holder of a key revoked at `T` signs an item with `date_published` after `T`
plus `"updated": T-1`; the revocation check reads `T-1` and passes. `claimedAuthor`
(`jws.js:187`) was already hardened for exactly this; its sibling was not. Test to add: an item
carrying `updated`, mirroring the `authors` analogue at `negative.test.js:400`.

**0.3 `src/reader.js:664-686` + `jws.js:281` — first-observation time *replaces* the
self-reported check instead of bounding it. OPEN.**
`observed` is passed as `signedAt`; `verifyDocument` does `signedAt ?? effectiveSigningTime(doc)`.
The store keys `(author, id)` per §4.4. *Exploit:* a thief of a key revoked at `T` publishes
`_version: 4` of an id first observed years ago; the old observation is substituted and the check
passes — §4.4's mechanism makes revocation **weaker** for every `_version > 1`. Fix:
`Math.max(observed, effectiveSigningTime())`, and key the record on `(author, id, _version)`.
The manifest already commits per-revision `[version, hash]`, so the per-revision receipt is free.
Spec half is 1.2. Highest-value missing test in the suite.

**0.4 `src/export.js:301-311` — `verifyBundle` TOFU-pins the predecessor from inside the bundle.
OPEN.** It calls `readIdentity(predecessor)` against `restoreFetcher(bundle)` with no caller
`pins`; `migrations.noteIdentity` records that as `pinnedAncestorFor(predecessor)`, and
`verifyMigration` then resolves `_recovery_sig` against keys the bundle itself supplied.
*Exploit:* fabricate a predecessor history containing your own recovery key, set `predecessor`
in your genesis, co-sign, carry a "back catalog" — `verifyBundle` returns
`migration.verified: true, via: 'recovery'`. §3.4 is explicit that a consumer with no prior pin
can only treat this as unverified. Fix: refuse `verified: true` unless the caller supplied pins
the bundle's predecessor history anchors to; surface `predecessorTofu`. The code comment at
`export.js:295-300` argues the restriction is "right there and wrong here" — it is about
*authority*, not network availability. (This was HANDOFF question 2 from the prior session;
the answer is yes, it is a hole.)

**0.5 `src/inbox.js:264` — relevance matches *any* item the receiver holds. OPEN.**
`if (id && holdsItem(id)) return true;` — including items polled from strangers' feeds.
*Exploit:* scrape any public feed the victim follows, take an id, sign your own item with a
`_rel.to` naming it; steps 1–6 pass, step 7 fetches your identity document at an attacker-chosen
origin, delivery accepted `202`. Fix: scope to items the owner **authored** plus items previously
accepted into this inbox — still needs no migration state. Spec half is 1.3, and the spec
contradicts itself in consecutive sentences there. `test/inbox.test.js:59` only ever holds the
owner's own item, so the divergent case is untested.

**0.6 `src/reader.js:602` — one malformed `authors[0].url` aborts the entire read. OPEN.**
`normalizeIdentityUrl(author)` sits outside the per-item `try`. A single `"url":"http://x/"` —
injectable by any co-author on a §7.1 family board, or by the serving path — propagates to
`cli.js` exit code 2. Every other per-item failure is correctly classified into `rejected`.

**0.7 `src/chain.js:523-541` — walked identity versions are not bound to the chain's identity.
OPEN.** `assertIdentityMatches` is called only from `fetchIdentityDocument` (tip only). Retained
versions go through plain `fetchDocument` with no `url` check, and `identityChainPolicy` passes
the document as its own key source, so a mid-walk version claiming a different identity
self-verifies and still anchors to the pin. `manifestChainPolicy` *does* check this
(`chain.js:561`); the identity policy does not. Related: 1.13 (the spec's `url` rule breaks
retained versions as written, which is why the check was never applied to them).

**0.8 `src/inbox.js:237` — the rate limiter preferentially evicts over-limit buckets. OPEN.**
`buckets.delete(key)` runs only on the *allowed* path, so `Map` insertion order drifts blocked
buckets to the head — where the eviction loop deletes from. Under ≥8192 distinct attacker-chosen
`author:` keys the blocked source's budget resets. The module's own comment at `inbox.js:184`
describes this failure and the code implements it. Fix: `delete` before the over-limit `set` too.

**0.9 `src/reader.js:1029` — equivocation on a non-primary `feeds` entry is downgraded. OPEN.**
`catch (e) { rest.push({entry, error: e}) }` catches `EquivocationError` and `InvariantViolation`
and renders them as `unreadable_feed`, indistinguishable from a 404, CLI exit 1 not 2. A
publisher lists an equivocating chain as `rel: "archive"` and it reads as a flaky host. Pins
*are* still frozen inside the walk; only the classification is lost.

**0.10 No upper bound on self-reported signing time. OPEN.** (`manifest.js`, `describeLag`.)
Both of invariant 3's bounds invert under a future-dated item: `manifest.updated > signedAt` is
false and `now - signedAt > ceiling` is negative, so a publisher stamping a year ahead holds its
whole feed in permanent `pending` and can serve an item to one reader and not another
indefinitely. Needs a clock-skew guard plus the spec sentence at 1.4.

**0.13 The identity cache answered a §5.3.1 verdict, and a co-author's fork was graded as a
fetch failure. DONE (seventh pass).** Found by the handoff's §3.3.1 question, which `tmp/rules.js`
raised by listing §3.3.1 as the one section both orphaned and unbacked. `reader.js` held a
co-author's resolved identity for an hour across reads on §12's authority — but §12's clause is a
MAY with a ceiling, and resolving a co-author runs `readIdentity`, so the cache was answering the
compare rule. Second poll of a forked co-author: `findings: []`, pin unfrozen, nothing recorded.
With the cache off the fork *was* caught and the pin *did* freeze, and the finding came out
`unverifiable` (exit 1) rather than `invariant` (exit 2) — the co-author instance of 0.9, whose
fix sits one screen below in the same file. Cache scoped to one read (memoizing within it,
failures included); violations collected by author and surfaced under the severe kind. Measured
cost of conformance: one conditional GET per distinct co-author per poll. §3.3.1 and §12 now
cross-reference. Two tests, each revert-checked.

**0.11 Smaller. DONE.**
- `publish.js` could not emit `_recovery_sig` at all — **DONE**, `Publisher.coSignIdentity`.
- **DONE (sixth pass):** unbounded `PinStore` / `MigrationStore` / `ObservationStore` growth
  despite §13.4 explicitly sanctioning eviction. `PinStore` already had `compact`; the other two
  now do, and both evict **whole identities and never by age** — §4.4's record is a *lower*
  bound on when a key could have signed, so the oldest observations are the strongest and an
  age-ranked evictor destroys what it is bounding. Retained without being asked: an identity
  owning a feed the observation store tracks, and either side of a recorded or contested
  migration (§3.4's inventory is written before the event because there is no second chance).
  §13.4 carries both rules now. Six tests, each revert-checked against the policy it names.
- **OPEN:** `export.js:256` drops `requireCanonical` on the restore path.
- **OPEN:** skip hops undercount against the version cap — a skip iteration is two fetches but
  one `++hops` (`chain.js:791`); `followSkipAnchor` never checks `above.updated < current.updated`.
- **OPEN:** `hash.js:17` `timingSafeEqualString` coerces non-strings, so
  `String(undefined) === String(undefined)` returns `true` — latent fail-open. All current
  callers are guarded by `assertVersionShape`.
- **OPEN:** §13.4's 100-key and 1000-items-per-page slot caps unenforced (byte and fan-out caps
  are enforced).
- **OPEN:** blocked authors still write the dedup store (`inbox.js:432` vs `456`).
- **OPEN:** non-`EncError` exceptions escape `enc.js:206-219` (`parseIJSON` on the decoded
  protected header, `publicFromJwk` on an attacker-chosen `epk`, `diffieHellman` on a low-order
  point) from a function whose contract is `EncError`.
- **OPEN:** `reader.js` never surfaces `_unverified`, though §10.5 makes distinct display a MUST.
- **OPEN:** `addresses.js:112` misses Teredo `2001::/32`, ORCHID `2001:10::/28` and
  `2001:20::/28`, and `::ffff:0:0/96` where `g4 !== 0`.

**0.12 Missing negative tests. PARTIAL.** Done: base64url strictness; `_recovery_sig` stripped
from a signed document (both directions). Still to add: item carrying `updated` (0.2); revocation
against a *revision* of an already-observed id (0.3); fabricated predecessor chain in a bundle
(0.4); malformed author URL in a feed (0.6); `holdsItem` true for a third party's id (0.5);
rate-limit bucket eviction under churn (0.8); equivocating non-primary feed (0.9); astral-plane
key sort; future-dated item (0.10); hostile `epk` (0.11).

---

## Stage 1 — spec corrections with no design decision

**1.1 base64url was never defined. DONE.** Stated once beside §5.1's hashing rule: unpadded,
RFC 4648 §5 alphabet, no non-canonical trailing bits, reject anything else.

**1.2 §4.4 keys the wrong tuple. OPEN.** Change to `(author, id, _version)`, and say the
observation **bounds** the self-reported time rather than replacing it. §7.5 already says
`(author, id, _version)` "names one exact revision"; §4.4 is the odd one out. Pairs with 0.3.

**1.3 §10.2 step 3 contradicts itself in consecutive sentences. OPEN.** "an item **of theirs**"
vs "an item **the receiver holds**". Pick the first. Pairs with 0.5.

**1.4 No upper bound on content timestamps. OPEN.** §10.2 bounds inbox items to 24 h future;
nothing bounds a *published* item. Add the same bound to §9.3 invariant 3. Pairs with 0.10.

**1.5 No URL comparison rule for anything but identity URLs. OPEN.** §3.1's normalization is
explicitly for identity URLs and its "trailing slash appended" rule is nonsense for `feed.json`
— yet §7.5, §9, §10.2 and §16.1 all compare feed/manifest/pin URLs "after normalization" at a
security boundary (canonical vs copy). `src/jws.js` already has `normalizeUrlForCompare` doing
the right thing; the spec never defines it. Write the rule the code implements.

**1.6 No time format profile. OPEN.** §7.2 says "ISO 8601", which admits `24:00`, comma decimals,
ordinal and week dates, and `+01`. This value drives revocation (§6.5), invariant 3, and §10.2's
window. Pin it to RFC 3339 with `Z` or a numeric offset.

**1.7 `seq` contiguity is never required. OPEN.** §5.3 rejects only "if `seq` decreased"; §9 says
`prev` names "the immediately preceding" version but §5 does not. A publisher emitting `seq: 1`
then `seq: 5` is conformant per the text and permanently unreadable by `src/`, which *does*
enforce contiguity. Also breaks §9.1.1's absolute anchors and §5.4's derived URLs. State it.

**1.8 `updated` in whole seconds is a publishing lock. OPEN.** §9.2 requires advancing
immediately for a tombstone; three deletions in one second, or an NTP step backwards, and the
publisher cannot advance either chain. `Publisher.#assertDated` already refuses it, and
`rotateKey` now emits three versions in a row, tightening the window further. Options:
milliseconds, or `(updated, seq)` as the ordering key with `updated` non-decreasing.

**1.9 §3.4 and §10.3 cannot both be followed. OPEN.** §3.4: relevance and dedup "need no recorded
state at all, and **MUST NOT** be built as though they did." §10.3: an id-half match across two
*different* authors is an update **only** under a verified migration. Deciding that is recorded
state, and dedup runs at step 5, before the author is authenticated at step 7. `inbox.js`
resolves it by injecting an `equivalent` predicate the deployment must supply — defensible, but
undocumented as a requirement and unwired by default. Recommend keeping §10.3's bound (it closes
a real attack) and rewriting §3.4's absolutism into "no state beyond the migration record you
already keep."

**1.10 §14's "byte-verbatim" MUST is unsatisfiable for feeds. OPEN.** §6.3 excludes feeds from
canonicality and §14 nests the feed as a JSON *value*, so its served bytes are unrecoverable from
a bundle. `export.js` cannot satisfy it and does not try; nothing depends on it. Scope the MUST
to chained documents and items.

**1.11 §7.5's "a cached copy still verifies when your host is down" is false as written. OPEN.**
§6.5 step 5 resolves keys against the *current* identity document on the same down host, and §12
caps the identity cache at 1 h. `reader.js` needs a live identity fetch: `readFeed` requires
`identityDocument`, supplied only via `readIdentity`. The ingredients for an offline path exist
(`cachedIdentity`, `migrations.pinnedAncestorFor`) and are not wired. Either scope the claim or
define retained versions as a key source for archived content.

**1.12 §7.3's tombstone allowlist excludes `_unverified`. OPEN.** §7.5 says the marker travels
"wherever it goes — no exception and no second form", and Appendix C requires gateways to deliver
tombstones. A conformant gateway tombstone cannot carry the marker.

**1.13 §3.2's `url` rule breaks retained versions as written. OPEN.** "`url` MUST match the URL
the document was fetched under" — a retained version fetched at `openfeed/3.json` says
`https://x/`. A literal implementer can never complete a walk. Add the carve-out. `src/`
sidesteps it by never applying the check to retained versions, which is 0.7.

**1.14 §9.3 invariant 3's "passed over" test convicts honest publishers. OPEN.** Effective
signing time is self-reported by the *item's author*, who on a family board is not the manifest
publisher. Backfill, offline signing (§4.6's recommended architecture), contributor clock skew,
and §3.4's byte-verbatim back catalog all trip it — and a contributor can **frame the board
owner** with a backdated item. Rebase on "since the manifest last committed anything", or on
first-observation time.

**1.15 §9.3's response is undifferentiated and maximal. OPEN.** "Violations MUST be treated like
chain equivocation", whose response is to stop accepting the chain until a human intervenes.
Invariant 3's stale direction has no lag tolerance, and a stale edge copy of the feed against a
fresh manifest is the ordinary steady state of a multi-POP CDN mid-publish. Grade the responses.
(§9.1.2's `stale` is now a worked example of a non-equivocation finding kind.)

**1.16 No HTTP caching guidance at all. OPEN.** Zero occurrences of `Cache-Control`, `ETag`,
`max-age`, `Vary`. Tip URLs are mutable and derived/§7.6 URLs are immutable; §5.4 mandates a
write ordering across two objects; 1.15 convicts on a stale feed. One short subsection:
`immutable` on derived and item URLs, short revalidation on tips, "the manifest must not lead
the feed."

**1.17 Smaller, each a line. OPEN.** §13.4's caps carry no RFC 2119 keyword yet nine places treat
them as normative, and two consumers with different caps reach different *security verdicts*;
§12 says "SHOULD cache ≤1 h" and §13.9 treats it as binding; §3.2.1's "exactly one entry SHOULD
carry `primary`" vs "Default `primary`"; §10.4 has no status or code for body-too-large or
timestamp-out-of-bounds — the two checks that run *first* — and puts `key_revoked` under `401`
with `invalid_signature`; §10.2 step 6's "by author (once known)" reads as *after* the fetch,
which makes it useless and contradicts §13.9; §6.2's "all four fields with exactly these values"
does not say whether *extra* header parameters are rejected (`jws.js` accepts and ignores them);
nothing forbids a `feeds` entry's `manifest` colliding with `openfeed.json`, two entries naming
one manifest, or a manifest's `feed_url` changing across versions; §3.3's same-origin-redirect
rule binds identity documents only (`fetch.js` matches the spec, so feeds and manifests can be
redirected cross-origin); §4.2's key-material comparison MUST states no verdict; no
migration-chain depth cap or loop rule; `next_url` walking is unbounded, unordered, and
cycle-free by nobody; §6.6's "MUST contain exactly one entry" silently forbids JSON Feed 1.1
co-authorship and says so nowhere; nothing in the signed bytes names the document *kind*, so
identity/manifest type confusion is closed only accidentally — a `typ` header field would close
it in one line.

**1.18 §11.1.1 promotion breaks §15.2.1 carrier binding. OPEN.** Promoting a delivered-only
encrypted item adds `_feed_url` to the outer item; the sealed plaintext has none, so carrier
binding fails at every recipient and the item renders as nothing, permanently, with no signal to
the author. Say whether promotion requires re-encryption (it does), and what sealed-absent +
outer-present means. **Note:** §15.4's split reduces how often this arises but does not close it.

---

## Stage 2 — design changes. ALL DONE.

§9.1.2 freshness · §3.2.1 `items` capability flag · §6.3 `_sig` covers `_recovery_sig` ·
§16 emission a Level 3 MUST + §13.2 restated · §10.6 delivery chain + the published/delivered
split · §15 promoted. See `git log` for the reasoning of each; see the three new prototypes for
the evidence.

---

## Stage 3 — surface-area cuts to evaluate. OPEN.

Named with what breaks. All still open; none were touched.

- **§9.1.1 skip links** — ~700 words of OPTIONAL mechanism existing only because every manifest
  version carries the whole `items` map. `deltamanifest-prototype` rejected deltas *because*
  `_skip` is O(log versions) — the full-map design is defended by the mechanism it necessitates.
  Cutting it strands readers absent longer than §13.4's budget (~20 versions against a 1 MB
  manifest).
- **§4.4's two revocation heuristics** — two SHOULDs, two scoping rules each, and 0.3 shows the
  pull-path one does not work. §4.4 concedes revocation "limits damage from honest rotation far
  more than it stops an active thief."
- **`_recovery_sig`'s dual role** — migration attestation (§3.4) and fork tiebreaker (§5.5). The
  second is a SHOULD a first-contact consumer cannot run.
- **§2.1's "one rule governs them all"** — governs one genuine vocabulary (`_rel[].type`), one it
  immediately inverts (`use`), and one nothing normative consumes (`feeds[].rel`).
- **§16.1's `observed` field** — supports only "informal timestamping", which §16.1 calls
  evidential and §13.10 declines to build on.

---

## Stage 4 — publication readiness. OPEN.

- **Normative/rationale separation. BLOCKED — owner decision 7, and the block is informed.**
  Three mechanisms were put to the owner (an index appendix, a requirements table, finishing the
  half-applied `>` blockquote convention) and all three were declined: the specification is felt
  to be bloated and nothing may expand it. `tmp/rules.js` was built instead of guessing, and it
  supports the instinct — **431 RFC 2119 keywords across 338 rule-bearing sentences and 64
  sections, with two echo pairs.** The document does not repeat itself, so an index would be a
  second copy of things stated exactly once, and compression has nothing to take. The only levers
  that shorten it are removing mechanisms (Stage 3) and removing conformance surface. See
  `HANDOFF.md`'s sketch. Original finding, whose count was ~240 and is now measured at 431:
- **A consumer-state section.** Pin store, recovery pins, first-observation records, dedup store,
  delivery streams (§10.6), migration records, identity cache, frozen/retired chain state —
  specified in seven places with different keying rules and no summary. An implementer cannot
  currently enumerate what they must persist.
- **A fetch-order and partial-failure section.** The spec never states
  identity-before-manifest-before-items (CLAUDE.md does), nor what a verifier does when one item
  fails, when the identity chain is in an unresolved §5.3.1 state, when one `feeds` entry is
  unreachable, or when a §13.4 cap is breached.
- **Discovery.** No handle→identity-URL mechanism anywhere in the spec. README mentions WebFinger
  as a convention; nothing normative exists.
- **`_`-field namespace collision.** Open Feed squats the most generic possible names in JSON
  Feed's shared extension namespace: `_version`, `_deleted`, `_sig`, `_rel`, `_enc`, `_pins`, and
  now `_delivery` and `_next_update`. JSON Feed 1.1 *recommends* a single namespacing object.
  Worth pricing a move to `_openfeed: {...}` now, while nothing external depends on the wire.
- **Interop friction to state honestly in README:** RFC 7797 `b64:false` + `crit:["b64"]` is the
  least-supported corner of JOSE and several popular libraries cannot produce it; §6.3's
  duplicate-member rejection means every implementer writes a strict parser; the live-item
  ceiling is *thousands*, and `deleted` counts against it permanently.
- **Level 0 reality:** tombstones (`content_text: ""`, no `title`, ≥30 days in the feed) and
  encrypted items render as blank entries in NetNewsWire/Feedbin/Inoreader, and existing clients
  dedupe by `id` so §7.3 edits are invisible. "Strictly additive to the existing feed ecosystem"
  needs a caveat.
- **ACAO as a producer MUST vs "fully static-hostable":** GitHub Pages, S3 website endpoints and
  default Netlify/Vercel do not send `Access-Control-Allow-Origin` on JSON without per-host
  config that is not a file, while §12 claims every Level 2 artifact is a file.
- **§14's export container is "any archive format"** with no media type in Appendix A — a
  degradation channel in the one mechanism whose point is that a hostile operator cannot degrade
  it.

---

## Stage 5 — evidence base and DISTRIBUTION-MODEL. PARTIAL.

- **Gates. DONE.** `migration-prototype.js` and `export-prototype.js` gained real gates in an
  earlier pass; `enctags`, `inbox` and `deltamanifest` in the sixth, each revert-checked by
  breaking the claim it names. **What the gates found is the finding.** `inbox-prototype.js` had
  been failing every scene since the `_openfeed` rename and exiting 0 — `signItem` replaced
  `_openfeed` instead of merging it, so every item failed §10.2 step 2 as `missing_field` and the
  "happy path" returned 400 through four commits of "all 17 prototypes hold". Gating also killed
  a claim that *could not* fail: S1's "an irrelevant sender buys zero fetches" reused an accepted
  id, so §10.3's stale check stopped it at step 5 and the measurement passed with relevance
  switched off entirely. `enctags` printed `LEAK` as data and never touched `src/enc.js` at all;
  it now runs `seal`/`open` and gates on the shipped envelope *being* scheme C.
- **Supersession markers. DONE (sixth pass).** `enctags-prototype.js` now opens ADOPTED (§15.2)
  and says what its own recommendation replaced, including the deleted §15.5.7 it still measures
  against on purpose — the three-scheme table is the reason the shared ephemeral and the tags are
  welded together, which is not visible from the shipped construction. `inbox-prototype.js`'s I1
  and I2 are marked CLOSED with what closed them, and S4's scene still runs the failure because
  the clause is a rule about the receiver's own store. `itemurls-prototype.js`'s header block was
  the template.
- **OPEN: `syndication-prototype.js` recommends a shape it never measured** — the verdict is an
  *unchained* signed document; the B it priced was chained, and chaining is what its costs
  measured.
- **OPEN:** six prototypes re-derive `canon`/`sign` with a hand-rolled `.sort()` rather than
  importing `src/`, and `enctags` never exercises `src/enc.js` at all — the shipped §15
  implementation has no prototype behind it, only `test/enc.test.js`.
- **OPEN — unprototyped questions worth adding:** §3.1's percent-encoding, the one place two
  implementations can split one identity into two chains (the prior handoff's item 4, still the
  cleanest open question in the repo); §5.5 fork resolution running automatically and re-pinning
  onto a recovery-co-signed branch — which is exactly the branch a custodian who took the recovery
  card produces; RFC 7797 support across real JOSE libraries.
- **DONE (fifth pass) — DISTRIBUTION-MODEL concrete errors**, all of the below: the key-custody table says the delegated key
  signs tombstones and eleven lines later the prose says use the root key; the canonical
  `openfeed.json` example carries neither the `delegated` nor the `enc` key its own custody model
  requires at genesis; the `rel: "archive"` rotation direction is inverted vs §9.2/§3.2.1; the
  file tree gives the primary feed a `/items/` tree and the activity feed none, though §7.6 binds
  every listed feed; Phases 1–2 ship the `{audience}` tier — the product — only in the REST API
  and the database, contradicting "never a divergent source of truth"; Phase 3 is eight features
  any two of which are a quarter. **All of it also predates Stage 2** — see `HANDOFF.md`.
- **DONE (fifth pass) — README overclaims:** "your host can't make a post disappear without leaving a signed,
  attributable trace" and "Content completeness (**solved**)" were stronger than §9.3 + §7.6
  delivered. §3.2.1's `items` flag makes the first *true* for a declaring publisher; README has
  not been updated to say which publisher it is talking about.
- **DONE:** the `_recovery_sig` construction change was propagated to both prototypes that built
  the old shape — and neither had noticed, which is finding F1 demonstrating itself.

---

## Second-pass review of Stage 2 itself (2026-08-17)

A four-way audit of the Stage 2 commits (crypto core; freshness + items flag; delivery layer;
bookkeeping/consistency). Baseline re-verified: 228/228, regen clean, all 17 prototypes hold,
tree clean. The mechanisms hold where tested; what follows is what the pass itself introduced or
left dangling. Status key as above.

**S2.1 The multi-recipient `_delivery` placement does not exist, and its privacy claim is false.
OPEN — the sharpest finding; needs an owner decision.** spec:661 says a wrapped item's per-pair
entry rides in that recipient's JWE header "beside `_tag`, which §15.2 has already built and
already blinded" — but only the *tag* is blinded; a cleartext `{seq, prev}` in the per-recipient
header re-links recipient slots across items (`prev` in item B equals the hash of what that slot
last received), which is the exact unlinkability §15.2 cites to rule out `kid`. Nothing
implements it on either end: `seal()` emits only `{alg, _tag}` (enc.js:169), `open()` neither
returns nor checks a slot `_delivery`, `DeliveryStore.check` reads only the top-level field
(inbox.js:109), no test covers a multi-recipient delivered item's chain, and
`delivery-chain-prototype.js:214-229` asserts the *sentence* exists, not the property. Related:
§8 permits cleartext delivered items relevant to two inboxes via multiple `mention`s (spec:479 vs
§11.2's "exactly one counterparty", spec:694), which have no valid placement at all. Two exits:
(a) define per-slot encryption of the entry under the recipient's already-derived shared secret —
a new construction §15.2 must then own, killing §10.6's "no new mechanism" claim; or (b) restrict
delivered-only items to exactly one recipient (promote §11.2's description to a rule; group
content must be published-encrypted), which deletes the problem instead of building the fix —
post-split the multi-recipient delivered case is nearly empty anyway (likes have one counterparty;
group DMs would move to published-encrypted). (b) is the recommendation; it touches the settled
split decision's edge, so it is the owner's call.

**S2.2 `probeItems` asserts withheld about bytes it never requested. OPEN — defect in new code.**
reader.js:737-748: the declared-then-declined branch marks up to `maxItemProbes` missing ids
withheld after fetching only the *control* URL — and when the feed serves zero committed ids,
after zero item-URL requests; `probed` also over-reports. §9.3 (spec:591) scopes withholding to
"an item it requested and did not get." Fix: fall through to the existing per-id loop. The
docstring at reader.js:860-866 is currently false for this branch; test/reader.test.js:270-292
pins the wrong behavior.

**S2.3 §16.2 still contradicts the §16 Level 3 MUST. OPEN — one-line spec fix.** The heading is
still "Item-Carried Pins (OPTIONAL)" (spec:908) and §16.2 still says "a peer that neither emits
nor heeds pins is fully conformant" (spec:946), against spec:732/:926. fa45fb8 updated §16's
opening and §16.1 but missed these. Also §16.1's "Delivery reaches exactly one counterparty"
(spec:931) is falsified by §10.6's multi-recipient case — resolved by whichever way S2.1 goes.

**S2.4 `enc.js` retains the lenient base64url the §5.1 rule now forbids. OPEN.** Lenient
`Buffer.from(x,'base64url')` at enc.js:206,234,241,243,247,321 and `'ascii'` AAD at :242 — the
exact patterns d406fb1 purged from jws.js. The protected header is parsed from a lenient decode
while the GCM tag authenticates the truncated string, so parsed header and authenticated bytes
can diverge. Low practical exploitability; clear violation of §5.1's "everywhere". Route through
`decodeBase64url`. Similarly `publicKeyFromJwk` (jws.js:225) accepts padded/standard-alphabet
`x`, violating the MUST at spec:250.

**S2.5 A delivered tombstone cannot carry `_delivery`. OPEN — new instance of 1.12's shape.**
§7.3's allowlist (spec:411-412) excludes `_delivery`, but §8.2 retracts a delivered reaction by
delivering a tombstone and §10.6 says delivered items SHOULD carry `_delivery` — so a conformant
retraction forcibly breaks the sender's delivery chain. inbox.js:333-336 matches the spec, same
gap. Fix alongside 1.12 (`_unverified`).

**S2.6 Malformed `_next_update` bricks the whole chain, and only for strict readers. OPEN.**
`assertManifestShape` (manifest.js:112-115) rejects the version outright and runs on every
historical version in the walk (manifest.js:277); the spec (spec:522/:561) never says what a
consumer does with a malformed value. One float from a foreign implementation → entire chain and
back catalog unreadable here, fine elsewhere. Spec must state the verdict; candidates: strict
everywhere (state it), or strict at the tip / ignored-as-absent in history.

**S2.7 §10.6 loose ends in `src/`. OPEN, several small.** (a) Out-of-order redelivery (5 then 4,
legitimate under §10.4's 24 h retry) yields a permanent `delivery_gap` plus a `delivery_replay`
for the benign late item — no fill-a-gap path (inbox.js:114-116). (b) First contact skips the
`prev`-names-an-item-it-holds check entirely (inbox.js:112), so a dropped *prefix* is invisible;
and `DeliveryStore` has no `toJSON`/`fromJSON` (unlike `DedupStore`), so a receiver restart
resets every stream to first contact. (c) Sender-side predecessor equivalence is unimplemented:
`Publisher.deliveries` keys a plain `Map` on `normalizeIdentityUrl(to)` (publish.js:85,:344,
:372-373), so a recipient who migrates gets a seq-1 restart the receiver reports as replay —
spec:657 says both halves are subject to equivalence. Receiver-side hook exists (inbox.js:88)
but is untested across a migration.

**S2.8 `coSignIdentity` replaces the tip in place. OPEN — API hazard.** publish.js:200-201: if
the un-co-signed tip was already served to anyone, the replacement is a second document at the
same `(url, seq)` — §5.3.1 equivocation committed by the honest producer. Nothing enforces
"co-sign before first serve"; the docstring warns only about later versions' `prev`. Also
chain.js:932-935's docstring still describes the pre-fix symmetric construction ("sign identical
bytes") — a future editor matching code to comment reintroduces the strip attack.

**S2.9 Conformance surface not fully propagated. DONE (sixth pass).** Level 1 gained six rules
it was relying on without naming — §3.1's two comparators, §7.2's RFC 3339 profile, §7.6's
consumer MUST, §13.4's "enforce a bound" with the unverifiable/violation distinction, §7.4's walk
bound next to the pagination SHOULD it is conditional on, and §9.1.2's staleness check (§13.17's).
Level 2 gained the `_next_update` SHOULD. Appendix B gained `items: true` on B.4/B.5/B.9/B.10's
author, `_next_update` on B.3b, and a B.7/B.7b pair for §10.6 — a lone `seq: 1` shows the field
and proves nothing, since §10.6's own argument is that a counter is what a sender can silently
restart. Gated in `regen.js` and in `vectors.test.js` against the spec's own bytes. Original
finding follows. §12 has no freshness item at any level
(Level 2 SHOULD "emit `_next_update`", Level 1 staleness handling — spec:720-744); Level 1's
list also omits §7.6's new consumer MUST (spec:448) and §13.17's check. Appendix B vectors carry
no `items: true` though §3.2.1 makes it a Level 2 MUST — the spec's own canonical publisher is
non-conformant with itself (B.4/B.5, spec:1037/:1046); no vector carries `_next_update` or
`_delivery` either. §15.2's header description (spec:839) never mentions the `_delivery` §10.6
places there (one-way cross-reference; moot under S2.1(b)). §15's conformance subject wobbles
("implementation" / "deployment" / neither defined in §2) — spec:812/:708/:906.

**S2.10 Prototype and message nits. OPEN.** `freshness-prototype.js` runs Q4–Q6 against a local
`freshness()` (lines 241-251) while its header claims it imports `src/` — the shipped
equivalents are covered by tests, but the prototype overstates itself. `negative.test.js`'s
trailing-bits sub-case is conditional on the fixture's final char (274-309) and could silently
skip. migration.test.js:343-345 asserts `.verified === false` without pinning the distinct
reason strings. reader.js:900 labels a ceiling-derived deadline "(declared)". spec:522 cites
§9.2 where §9.1.2 defines. `enc.js:1` still opens with the superseded "OPTIONAL … at any level"
wording; CLAUDE.md's table header still calls §15 an "OPTIONAL layer". §14 (spec:797) still says
a trimmed `received` slot "verifies as nothing at all" — now overbroad in the safe direction,
§10.6 being a partial trim-detector.

**S2.11 Doc drift, enumerated (supersedes the vaguer Stage 5 bullets). DONE** — every line below,
plus the whole `_openfeed` rename, plus the Stage 5 bullets on README overclaims and
DISTRIBUTION-MODEL's concrete errors. Two went further than "update the citation": §15.4's
reversal and the `{audience}`-by-access-control contradiction. The enumeration is left as written
because it is the finding; the line numbers are pre-fix. Original text follows. README: :455
verification recipe says signature field*s* removed (breaks on every co-signed doc under new
§6.3); :99/:517 "§15 optional"; :73 "§16 optional"; :418/:601 recovery-by-polling with no §10.6
carve-out; :758 cleartext delivery to plural recipients vs §11.2; :38/:575 completeness claims
still unscoped to a declaring publisher; :145-146/:183 §7.6 explainer and example identity lack
`items`. DISTRIBUTION-MODEL: :406/:422/:423/:883 (also :180/:808-811) cite §15.4 for the
delivered-replies arrangement §15.4 now rejects, and :5 half-contradicts them; :156/:306
`{audience}` via authenticated API is access-control audience restriction, now forbidden by
spec:812; :402 recovery-by-polling; :644-648 example `openfeed.json` lacks `items: true`;
:1241-1243 activity feed has no `/items/` tree; Phase checklists (:1012-1041) lack §16.1
emission and §10.6. Confirmed: no `_next_update` *contradictions* in either doc, only omission.

**Corrections to this register from the same audit:** line numbers drifted — 0.2 is now
jws.js:273-274 (verifyDocument kind-blind at :346), 0.3 is reader.js:667-687 (store keying at
:111), 0.5 is inbox.js:350 (`holdsItem` default at :249), 0.8 is inbox.js:322-327. All four
confirmed still present as described. 1.18 confirmed still open: spec:430/:686 vs spec:854 +
enc.js:279-283; test/enc.test.js:246-260 demonstrates the exact byte-shape, framed as an attack
rejection.

---

## The biggest thing this review did not resolve

**Adoption asymmetry**, from the ecosystem audit. Publishing (Level 2) is expensive and buys the
publisher nothing directly: manifest chains, retained history in gigabytes, a file per revision
forever, a strict JSON parser, an unsupported JWS variant. The guarantee exists only when someone
runs a Level 1 verifier that pins, walks two chains, enforces five invariants, applies §5.3.1,
and probes §7.6 URLs. Until such readers exist in numbers, a publisher pays the full conformance
cost for a property nobody is checking — ActivityPub's cold start is worse technically and better
socially, because you get reach on day one. Every other adoption objection is downstream of this
one, and no amount of Stage 0–5 work addresses it. It is a product and distribution question.
