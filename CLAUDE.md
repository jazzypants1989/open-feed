# CLAUDE.md

## Rules for this file

**This file is orientation, not a record. The spec is the source of truth; `git log` is the history.**

Do not add to this file:

- Anything the spec already says. If a rule is in `open-feed-spec.md`, read it there. A shadow copy
  here goes stale and then contradicts the spec.
- Anything that happened. What a previous draft got wrong, what a pass fixed, what was proposed and
  rejected, what you just changed — that is the commit message. Write it there instead.
- A changelog, a "recent changes" section, or a bullet per session.

Add something only if a future agent would make a **worse decision** without it *and* it is not
already in the repo. That is a narrow gate. This file should get shorter more often than longer.

## What this is

Open Feed Protocol: a minimal specification for decentralized publishing and interaction, aimed at
families and small groups first but designed to scale across identities. Built entirely on existing
standards (JSON Feed, JOSE/JWS/JWK, RFC 8785 canonicalization), with a deliberately small surface.

| File | Purpose |
| ---- | ------- |
| `open-feed-spec.md` | **The specification.** Core §1–§14; OPTIONAL layers §15 (encrypted content) and §16 (item-carried pins); Appendices A (media types), B (test vectors), C (gateways) |
| `README.md` | Human-facing docs: examples, protocol comparisons, interop routes, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference implementation plan: a family AI-journaling hub |
| `src/` | **Reference implementation**, zero dependencies: Level 1 verifier, Level 2 publisher, Level 3 inbox, plus §14 export and the OPTIONAL §15 layer. `canonical.js` is RFC 8785 + a hand-written I-JSON parser, because §6.3's duplicate-member rejection is not something `JSON.parse` can do; `jws.js` is the §6 construction; `chain.js` is §5.3's walk for both chained documents; `manifest.js` is §9.3; `migration.js` is §3.4 — predecessor equivalence held once and asked by every site that needs it, plus §4.5's **recovery pin** — `(url, seq, hash)` and the keys committed there, which is what a co-signature resolves against and what §7.5's exception needs, rather than the whole document; `publish.js` emits every artifact as bytes; `reader.js` composes the lot into the Level 1 consumer, and the *order* is its content — identity chain before manifest, manifest before items; `cli.js` is that reader as a command; `inbox.js` is §10 as a function rather than a server, because §10.2's *ordering* is the security property and a socket hides it — it reports its own outbound fetch count for that reason; `export.js` is §14, and it deliberately contains no verifier: `restoreFetcher` is a fetcher over a bundle's contents and `verifyBundle` is `createReader` unchanged, which is how §14's "nothing about verification changes" is checked rather than asserted; `enc.js` is §15, OPTIONAL, and touches nothing else — one shared ephemeral, blinded per-recipient tags, and §15.2.1's carrier binding at the decrypting client. **`fetch.js` is the only module that opens a socket — keep it that way.** Node's `crypto` has Ed25519 natively — no `jose`, no `@noble`, no `canonicalize` |
| `bin/openfeed.js` | `openfeed verify <identity-url> [--pins FILE]`. A shim over `src/cli.js`, which takes argv, streams, and its reader as arguments so the command is testable as a function |
| `test/` | `npm test`. `vectors.test.js` extracts vectors from the spec document itself and resolves keys structurally (§4.2); `negative.test.js` is the must-fail corpus Appendix B has none of; `migration.test.js` drives §3.4 through the composed reader across two origins, and its last case pins the false accusation the module exists to stop — a verifier ignorant of migration reports a carried back catalog as *withheld*; `e2e.test.js` drives the layers against each other over a real TLS socket and `reader.test.js` drives the composed reader the same way — most of it **twice**, because pinning is what §12 makes a MUST and one run proves nothing. `inbox.test.js` asserts on outbound fetch counts and on the dedup store rather than on status codes, because §10.2's ordering and §10.3's write-before-verify rule return the same code whether obeyed or not; `export.test.js` restores with no network and its last case is the whole exit — migrate, export, restore, with the host refusing to help; `enc.test.js` runs the *unchanged* verifier over encrypted items, since "no new signing construction" is falsifiable. `helpers/site.js` is the shared origin (certificate hand-encoded in `helpers/tls.js`, since §3.1 makes HTTPS part of the identity) |
| `tmp/regen.js` | Regenerates and validates Appendix B test vectors |
| `tmp/check-prototypes.js` | `npm run prototypes`. Runs every `*-prototype.js` and fails if any no longer holds. It exists because the convention decayed silently: `src/` drifted out from under three of them, one had been exiting 1 for several commits, and `HANDOFF.md` went on arguing §7.6's case from a number that no longer reproduced. **A prototype nobody re-runs is a claim, not evidence** |
| `tmp/freshness-prototype.js` | ADOPTED (§9.1.2). The one mutation of a chain nothing detected: doing nothing to it. Freezes a manifest for ninety days and measures the shipped reader with the rule off and on. Verdict: a declared deadline capped by the consumer's own ceiling — and Q6 is the half that must ship with it, since a key custodian advances an empty manifest and stays punctual |
| `tmp/withholding-capability-prototype.js` | ADOPTED (§3.2.1 `items`). §7.6's "consumers MUST NOT require it" let a hostile host 404 the `/items/` tree and switch off §9.3's only pull-path verdict. Measures the same withholding CAUGHT from a serving host and SILENT from a declining one. Verdict: a signed per-feed declaration, 13 bytes, unstrippable by anyone who cannot sign |
| `tmp/delivery-chain-prototype.js` | ADOPTED (§10.6). Prices the delivered column's integrity gap and the two mechanisms rejected before it — a published receipt map (the hub signs it; and a public receipt for a private message is a worse disclosure than the drop) and a sender-side commitment (cannot detect what the recipient never knew to expect). Q4 is the load-bearing one: where a per-pair entry can live when one signed item reaches several inboxes |
| `tmp/feedbinding-prototype.js` | Can canonicality stop naming a location? Measures `_feed_owner` (an identity URL, defaulting to `authors[0].url`) against today's `_feed_url` test. Verdict: **keep `_feed_url`** — the candidate works and deletes ~106 words of migration exception, but `_feed_url` names one feed where an identity may own twenty, so a board owner could move a contributor's item into their primary feed and keep it canonical. The exception text is the price of *precision*, not an accident |
| `tmp/manifestindex-prototype.js` | Should the manifest be the index and the feed a Level 0 compatibility surface? Verdict: **split** — promote §7.6 to a Level 2 MUST (its storage is a rounding error beside retained manifest history), but reject manifest-as-index. Cold reads cost 48× the requests; warm reads save 55 KB out of 163 because the manifest is 65% of the poll under both designs; and it cannot work at all, since an item the manifest has not yet committed **has no §7.6 URL** and §9.2's batching guarantees such a window always exists |
| `tmp/threshold-prototype.js` | Does k-of-n recovery have to fail open? Runs the *shipped* `verifyMigration`. Verdict: §4.5's stated reason was **false as a generalization** — reusing `_recovery_sig` does fail open (confirmed), but `_recovery_sigs` plus a `use` token §4.1 hides fails closed at every stage. The scope decision stands on different grounds now in the text: k-of-n trades a theft risk for a coordination risk at the moment §14 requires an exit needing nobody's cooperation |
| `tmp/enc-prototype.js` | Encrypted items; demonstrates the ciphertext-relay attack and §15.2.1's rejection of it, and §15.2.2's declared audience — a recipient wrapping a reply to the other recipients, which is the case a published roster was thought to be needed for |
| `tmp/syndication-prototype.js` | Compares `_syndication` shapes (field / document / receipt) on routing, retraction, retained history. Verdict: a signed **unchained** document (README's convention) — the measured document shape was chained, and the chaining is what its costs priced; a map nobody verifies has nothing for a pin to protect, and deletability is the point |
| `tmp/skiplinks-prototype.js` | Manifest skip links on a 365-version chain; forged-anchor attack |
| `tmp/deltamanifest-prototype.js` | Snapshot+delta manifest versions vs today's full-map-per-version, measured. Verdict: keep the current shape — deltas win 40–60× on storage and *lose* on a long walk, because `_skip` is O(log versions) and a delta chain is O(changes); the same storage win is available at rest with no wire change |
| `tmp/itempins-prototype.js` | `_pins` on items — the disclosure and byte measurements behind §16.1 |
| `tmp/migration-prototype.js` | §3.4 end to end: both migration paths, byte-verbatim back catalog, an abandoned host tombstoning it afterwards, and a stolen recovery key minting a *competing* migration. Imports `src/` — the question is whether existing mechanisms compose into an exit, which re-deriving them cannot answer |
| `tmp/export-prototype.js` | §14 produced and restored with no network and no bundle-specific verifier; what decomposition costs; and why a successor's bundle needs the predecessor's chain |
| `tmp/inbox-prototype.js` | §10.2's ordering made observable — outbound fetches counted and placed, §10.3's write-before-verify denial run both ways, and dedup across a migration |
| `tmp/enctags-prototype.js` | §15.2's envelope measured three ways. The cost driver was the per-recipient ephemeral, not the missing tag; shared ephemeral and blinded tags only work together |
| `tmp/canonicality-prototype.js` | §6.3's wire rule three ways. Verdict: keep "MUST everywhere" — §14 nests documents as JSON *values*, so hashing served bytes cannot reproduce them, and exempting the tip forks §5.4 rather than relaxing it, making an honest publisher read as equivocating |
| `tmp/itemurls-prototype.js` | Derived item URLs, id-addressed vs hash-addressed vs walking `next_url`. Verdict: hash-addressed (§7.6) — id-addressing needs the percent-encoding normalizer §3.1 refuses to write, and the do-nothing fix is a multi-megabyte poll |

## The threat model that drives the design

**The operator of a family hub may be a loved one who is an abuser** — an adversary who controls the
serving path, the inbox, and (by default) the keys. No confidentiality mechanism defeats them; the
protocol answers with **exit** (§3.4, §4.5, §14), and its three parts must hold together. The second
driver is the **two self-hosting family members** persona, which is what makes cross-hub `family`
visibility a launch requirement.

Read §13.2 before touching anything security-relevant.

## Version policy

**0.1.0 — Draft, unreleased.** Nothing here has had a reader outside this repo. `src/` implements
it, which means the text is checked against running code and against nobody else's reading of it.

**Do not bump the version for ordinary changes.** The number marks a release someone outside this
repository can depend on, not an edit counter. Pre-1.0, breaking changes ARE allowed to fix
correctness or security defects; post-1.0, additive only.

## Editing the spec

1. **RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Guard the simplicity.** The spec's value is how little of it there is: one way of doing each
   thing, stated once, whatever the current shape of those things happens to be. Resist a second
   construction, a second model, or a second document growing up beside the first. If it can live
   in README, it should.
3. **Keep the rule, cut the archaeology.** Justification sitting next to a MUST is load-bearing —
   it is what stops the next implementer weakening it, so it stays. A paragraph about what an
   earlier draft got wrong does not.
4. **Run `node tmp/regen.js`** after any change touching canonicalization, signing, document shape,
   or the vectors. It self-verifies signatures and manifest hashes and confirms every vector string
   appears verbatim in the spec. Exits non-zero on drift.
5. **Timestamps** — key/chain fields in Unix seconds (JOSE); content fields in ISO 8601 (JSON Feed).
6. **No changelog appendix, no version bump.** Record the change in the commit.
7. **There is no line budget. Do not reintroduce one.** It was retired deliberately: a line count
   measures the wrong thing, and chasing it pushes toward exactly the two edits this file forbids —
   splitting the document up, and cutting the justification that sits next to a MUST. The real
   target is **the shortest spec that still covers its bases**, and the lever that actually moves
   it is design, not compression. Removing an equivocation between two sections is worth more than
   removing fifty lines.

## Editing the README

README explains; the spec defines. Keep the TL;DR under a page, link spec section numbers, use no
RFC 2119 keywords, and keep examples consistent with the spec's object model.

## Extension conventions

- **Fields**: prefix with `_` (`_content_warning`, `_sha256`). Unknown `_` fields MUST survive
  re-serialization — signatures depend on it.
- **Relation types** (`_rel[].type`): a registered token (`reply`/`root`/`like`/`repost`/`quote`/
  `mention`) or an absolute URL for custom relations. These are values, not field names.
