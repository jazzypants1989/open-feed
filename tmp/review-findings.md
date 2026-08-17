# Skeptical review — findings register

Produced by a four-way audit (spec text, crypto core, composition/network layer, prototypes +
DISTRIBUTION-MODEL) requested with explicit permission to churn. This file is the **register**:
every finding, with its current status. `HANDOFF.md` is the short list of what to do next.

Status key: **DONE** (landed, with a test) · **OPEN** · **PARTIAL**.

> **Session update (2026-08-17, second pass).** A large batch landed. Rather than rewrite every
> entry below in place, the authoritative status is now the table at the top of `HANDOFF.md`;
> where this register and the handoff disagree, the handoff is newer. Quick index of what
> changed this pass: owner settled all five open decisions (see the handoff); Stage 2 self-review
> findings S2.1–S2.11 are recorded in the section near the bottom of this file, most now DONE;
> and from the old backlog 0.2, 0.3, 0.4, 0.5, 0.6, 0.8 and 0.9 are DONE with revert-checked
> tests. Still OPEN: 0.7, 0.10, 0.11's list, most of Stage 1, Stage 3/4, and the doc rewrites.

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

**0.11 Smaller. PARTIAL.**
- `publish.js` could not emit `_recovery_sig` at all — **DONE**, `Publisher.coSignIdentity`.
- **OPEN:** unbounded `PinStore` / `MigrationStore` / `ObservationStore` growth despite §13.4
  explicitly sanctioning eviction (`chain.js:141`, `migration.js:179`, `reader.js:79`).
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

- **Normative/rationale separation.** ~240 MUSTs across 1175 dense lines with rules and
  justification interleaved sentence by sentence. Keep the justification (CLAUDE.md is right that
  it is load-bearing) but make the rules extractable. Biggest lever on "an outside implementer
  reads it cold"; deletes nothing.
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

- **Gates.** `migration-prototype.js` and `export-prototype.js` **DONE** (both gained real gates,
  both verified by breaking a claim). **OPEN:** `enctags`, `inbox`, and `deltamanifest` still have
  no assertion gate on their substantive claims — `enctags-prototype.js:155` literally prints
  `LEAK` as data and exits 0, so a regression breaking §15.2's blinded-tag scheme would still
  report "ok". `deltamanifest`'s two `process.exit` calls are inside `selfCheck()` and cover byte
  arithmetic only.
- **Supersession markers. PARTIAL.** The three new prototypes and `migration`/`export` are
  current. **OPEN:** `enctags-prototype.js`'s entire framing quotes §15.2 text and a `§15.5.7`
  that no longer exist — it is a proposal against a superseded spec, and its recommendation was
  adopted wholesale. `inbox-prototype.js` I1/I2 still narrate as open what spec:730 and
  spec:611-613 closed. `itemurls-prototype.js`'s header block is the right template.
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
- **OPEN — DISTRIBUTION-MODEL concrete errors:** the key-custody table says the delegated key
  signs tombstones and eleven lines later the prose says use the root key; the canonical
  `openfeed.json` example carries neither the `delegated` nor the `enc` key its own custody model
  requires at genesis; the `rel: "archive"` rotation direction is inverted vs §9.2/§3.2.1; the
  file tree gives the primary feed a `/items/` tree and the activity feed none, though §7.6 binds
  every listed feed; Phases 1–2 ship the `{audience}` tier — the product — only in the REST API
  and the database, contradicting "never a divergent source of truth"; Phase 3 is eight features
  any two of which are a quarter. **All of it also predates Stage 2** — see `HANDOFF.md`.
- **OPEN — README overclaims:** "your host can't make a post disappear without leaving a signed,
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

**S2.9 Conformance surface not fully propagated. OPEN.** §12 has no freshness item at any level
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

**S2.11 Doc drift, enumerated (supersedes the vaguer Stage 5 bullets). OPEN.** README: :455
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
