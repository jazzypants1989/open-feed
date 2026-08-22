# Intent map — the 267 tests in `test/`, mapped onto the design in `SKETCH.md`

**Written 2026-08-21 for `HANDOFF-final-review.md` §2.J, owed since `CANDIDATES.md`.** One section
per test file; one row per *distinct intent* (tests that protect the same thing share a row), so
the rows add up to 267 tests but there are far fewer rows than tests. Counts are from
`node --test <file>` run today, not from grep.

Verdicts: **kept** — the guarantee and its mechanism survive, possibly renamed; **transformed** —
the guarantee survives under a different mechanism, which is named; **dropped** — the guarantee
goes, with its mechanism, and the reason is given. **Sign-off Y** means dropping or transforming it
loses something a *person* could rely on, not merely a mechanism; "ruled" means the owner already
took that decision by name in `RULINGS.md` and the row only records where.

Section references: old-spec `§n` is `open-feed-spec.md`; `S§n` is `SKETCH.md`; `R§11.n` /
`R§12.n` is `RULINGS.md`.

## Summary

| file | tests | kept | transformed | dropped | sign-off |
|---|---|---|---|---|---|
| `addresses.test.js` | 6 | 6 | 0 | 0 | — |
| `chain.test.js` | 45 | 2 | 21 | 22 | — (item-carried pins: ruled, R§11.1) |
| `cli.test.js` | 10 | 4 | 5 | 1 | — |
| `e2e.test.js` | 9 | 5 | 1 | 3 | — |
| `enc.test.js` | 12 | 8 | 4 | 0 | **1** (relay binding, pending §2.A) |
| `export.test.js` | 8 | 0 | 1 | 7 | **1** (offline archive) |
| `fetch.test.js` | 23 | 10 | 7 | 6 | — |
| `inbox.test.js` | 31 | 0 | 8 | 23 | — (delivered channel: ruled, R§11.8) |
| `manifest.test.js` | 19 | 2 | 7 | 10 | **1** (staleness) |
| `migration.test.js` | 12 | 0 | 7 | 5 | **1** (the frozen copy — ruled, confirm) |
| `negative.test.js` | 41 | 9 | 12 | 20 | — |
| `reader.test.js` | 41 | 6 | 8 | 27 | — (staleness counted under manifest) |
| `vectors.test.js` | 10 | 0 | 5 | 5 | — |
| **total** | **267** | **52** | **86** | **129** | **4** |

Half the old suite goes with its mechanism. Almost all of that is four things: the version walk
(§5), the manifest lattice (§9), the inbox and its delivered stream (§10), and the export bundle
(§14). What is *kept* outright is smaller than it looks and mostly lives in two places: the fetch
policy (which the sketch does not mention at all) and the strict JSON scan (which `S§9` says goes,
and does not — see the last section).

---

## `addresses.test.js` — 6 tests

**Intent.** A reader never opens a socket to a non-public address on somebody else's say-so: the
blocked ranges are exact, malformed and octal-looking addresses are refused rather than guessed
at, and the IPv6 parser is round-trip honest. This is the server-side request forgery guard.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| no connection to a non-public, malformed, or ambiguous address (6) | `addresses.js` range tables consulted by `fetch.js` before any dial | **kept** | unchanged in kind and *more* exposed: the rumor rule (`S§5` step 4) fetches `target.at`, a URL the *replier* chose, so the guard now sits in front of attacker-supplied addresses by design. The sketch says nothing about it. | N |

## `chain.test.js` — 45 tests

**Intent.** The identity chain is walked, version by version, from the pinned one to the tip, and
every way a hostile host or a stolen key could splice, roll back, skip, or rewrite history is
refused; a recovery co-signature resolves a fork; item-carried pins let readers corroborate each
other; pins never move backwards and evidence about them is bounded. Most of this is the walk,
and the new design has no walk.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| derived version URLs, `.json` rule, skip anchors (3) | §5.1–5.3 `/{seq}.json`, anchors at powers of two | **dropped** | no retained versions: the profile is one file overwritten under compare-and-swap (`S§1`). Nothing to derive. | N |
| first contact is trust-on-first-use, then pin (1) | §4.4 observation record | **transformed** | first contact is not trust-on-first-use: the genesis key is learned off the host's path (link, scanned code; R§11 ruling 1, `firstcontact-exp`). The pin is the profile/head the reader verified (`S§5`). | N |
| the walk verifies every hop; versions per update capped; skipping walk reports gaps (3) | §5.3 walk, history byte budget | **dropped** | no walk. A reader compares the served `pseq`/`hseq` with its pin and nothing in between (R§12.4). | N |
| at the pin, no walk but bytes must match (1) | pinned hash compared at equal seq | **transformed** | same `pseq` with a different address is *contested* (`weekend-reader.js:122`). | N |
| rollback below the pin refused; pin never moves backwards (2) | §5.3 step 2 | **kept** | `pseq`/`hseq`/`top` never go back against the pin; a bad read leaves the pin untouched (`S§5`, weekend-gate "older head" row). | N |
| a broken `prev` link is refused (1) | every hop's `prev` checked | **transformed** | `prev` is checkable only by a reader that saw the version immediately before (R§12.4). The weekend reader does not check it at all — see the last section. | N |
| an unverifiable pin is never silently re-pinned (1) | §5.3 "unverifiable" outcome | **transformed** | a head that will not verify is not an accusation: the reader keeps the pin it holds and says nothing (R§12.7). | N |
| `seq` contiguous — a skipped number is not a chain (1) | §5.3 step 3 | **transformed** | gaps are not judged; only direction is (`pseq`/`hseq` never back). R§12.4 says the spec must not imply the chain is walked. | N |
| a version signed by an unlisted key, a recovery key, or a stolen key un-revoking itself is refused; a `kid` cannot be rebound (4) | §5.4 key lists, revocation timestamps, `kid` binding | **transformed** | the chain is hops: a rotation is signed by the key it replaces, a restore by `k` vouchers against the committed leaves (`S§2`, `weekend-reader.js walk()`). There is no revocation: a stolen old key is closed because the head must be signed by the key the chain *currently* ends on (R§12.7). | N |
| two hashes at one seq is equivocation and freezes; equal hashes corroborate (2) | §5.3.1 | **transformed** | two profiles at one `pseq` → identity in question; two heads at one `hseq` → host misbehaving (`S§5`). Nothing freezes: the verdict is per read. | N |
| a peer pin is a claim and cannot freeze anybody (1) | §16.2 peer pins | **dropped** | there are no peer pins. The replacement signal is a reply's own target (R§11.1). | ruled |
| item-carried pins: scoped by travel, owned chains, emitted from the store (3) | §16.1 | **dropped** | R§11.1 and `rejections.md` §11: the carried pin is gone; `splitview-gate` prices what the target-as-rumor catches instead. | ruled |
| deliberate re-pinning discards disagreeing observations (1) | §4.4 re-pin | **dropped** | one pin per identity, replaced only by an `ok` read at a higher `hseq`/`pseq`. | N |
| a walk reaching the pinned seq with different bytes surfaces equivocation (1) | §5.3.1 | **transformed** | contested at equal `pseq` (same row as above; listed separately because the old test walked to get there). | N |
| skip links followed, anchors absolute, forged anchor caught, relative anchor ignored, identity chain never skips (5) | §5.3 skip map | **dropped** | no skip map. | N |
| a forged tip cannot be spliced onto an honest history with a copied anchor (1) | §5.3 anchor check | **transformed** | the chain must walk from `genesis` and the file must be signed by the key it ends on; a spliced tip either fails `walk()` or is a second profile at one `pseq`. | N |
| a manifest is walked identically, must name its signer's identity, commits one feed (3) | §9 manifest chain | **dropped** | no manifests. The head lives at the name, is signed by the current key, and there is one per identity (`S§3`). | N |
| recovery co-signature against the pinned ancestor's committed key; only a committed recovery key; a fork resolves to the co-signed branch (3) | §4.5 recovery pin, §5.5 | **transformed** | restore hop vouchers are checked against the leaves committed in the profile (`walk()`); a fork is settled by a majority of the recovery list *as it stood at the split* (R§11.3, `forkcourt-gate`). **The composed reader does not run the court** — it says contested and stops (§2.D, open). | N |
| a pin store threaded through a walk catches equivocation mid-hop (1) | §5.3.1 | **transformed** | same as contested; no hops to be mid-way through. | N |
| an unusable shape is rejected before anything is trusted (1) | §5.3 step 1 | **kept** | strict scan, then `walk()`, then signature; a head that does not fold is `host` before any post is fetched. | N |
| the continuity rule is four checks, each fails on its own (1) | §5.3 | **transformed** | `S§5`'s ordered list: genesis, chain, current-key signature, pin comparison. Each is a revert row in `weekend-gate`. | N |
| a skip map keyed by anything but a canonical seq is ignored (1) | §5.3 | **dropped** | no skip map. | N |
| a manifest tip signed by a revoked key is rejected and its history is not; a future revocation does not refuse today; §5.5 resolution runs before "compromise" (3) | §5.4 revocation clocks | **transformed** (2) / **dropped** (1) | no clock gates any verdict (`S§7`). A head from a rotated-out key is simply not the current head; posts signed by any chain key count when listed. The future-dated revocation test has no analogue. Fork resolution is the court (above). | N |
| observation history compacts toward shared seqs; re-pin evidence is bounded (2) | §4.4 store bounds | **dropped** | the pin is one record per identity: `pseq, phash, hseq, hhash, top, live`. It grows with the live set, not with history. | N |

## `cli.test.js` — 10 tests

**Intent.** The reader is usable as a command: exit codes map to verdicts, pins persist across
runs so the second run is not first contact, a rewritten history is caught on the second run and
stays caught, and a host that forgets its cross-origin headers is reported rather than refused.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| one command over the reader; exit code per outcome; `--json`; usage errors (4) | `cli.js` taking argv and its reader as arguments | **transformed** | three states, so three exit codes (`S§5`). GOALS "still open" 5 recommends a CLI client as the second implementation; nothing is built. | N |
| pins persisted and round-tripped; a run without pins says it cannot give §13.2's guarantees (3) | `--pins FILE`, observation record | **kept** | the pin must serialize (it holds a `Map`); a reader with no pin cannot tell a rollback from the truth — `aohead-gate`: "not caught at all cold". | N |
| a rewritten history is caught on the second run and stays caught (1) | §5.3.1 freeze, persisted | **transformed** | the pin's `live` map: a post at or below the old `top` that changed or appeared is `host` (`S§5` step 2). "Stays caught" no longer applies — the verdict is per read, and an honest head at a higher `hseq` clears it. | N |
| an equivocating *archive* feed draws the same verdict as the headline one (1) | §3.2.1 feeds list | **dropped** | one head per identity; there is no archive feed. | N |
| an identity served without cross-origin headers is reported as non-conforming (1) | §13 conformance note | **transformed** | now a host MUST (`S§6`, ruling 3); what a reader *reports* about a host that forgets is unwritten. | N |

## `e2e.test.js` — 9 tests

**Intent.** Everything verifies over a real TLS socket, because §3.1 made HTTPS part of the
identity; retained versions are served byte-identically; rollback, rewrite, pruning, withholding
and a swapped item are each caught over the wire; a rotated key keeps the back catalog readable.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| a published identity verifies end to end over the wire (1) | `helpers/site.js` TLS origin | **kept** | `weekend-gate`, `pubif-gate` over loopback HTTP. TLS is no longer part of identity (the key is), so the socket is transport — see `fetch.test.js` for what that leaves open. | N |
| retained versions served byte-identically; a pruned intermediate is unverifiable (2) | §5.2 retention | **dropped** | no retained versions. | N |
| a rollback to a pinned consumer is refused over the wire (1) | §5.3 | **kept** | `hseq`/`pseq` against the pin (weekend-gate "host serves an older head"). | N |
| a rewritten retained version is equivocation (1) | §5.3.1 | **transformed** | two heads at one `hseq`, or two profiles at one `pseq`. | N |
| withholding is withholding, not content that never existed (1) | §9.3 | **kept** | a listed post not served is `host` (weekend-gate). | N |
| a swapped item body is caught by the manifest, not by its signature (1) | §9.2 entry hash | **kept** | the head's entry is the body hash; a post signed by her but not what the head lists is `host` (weekend-gate "swaps a post"). `persig-gate`: admission and the signature are two jobs. | N |
| the history byte budget is carried across a walk (1) | §13.4 | **dropped** | no walk. | N |
| a rotated key keeps the back catalog verifiable (1) | §5.4 key list | **kept** | posts verify under *any* key in the chain; only the head needs the current one (R§12.7). | N |

## `enc.test.js` — 12 tests

**Intent.** An encrypted item is an ordinary signed item to the unchanged verifier; every recipient
opens it and nobody else; the envelope discloses nothing about who (one ephemeral, blinded tags);
a relayed ciphertext is refused by the carrier binding; the audience travels inside the sealed
bytes; the recipient's key comes from their own document; metadata leakage is stated out loud.
The envelope is the one floor item (GOALS 2) with no gate on the new substrate (§2.A).

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| an encrypted item is an ordinary signed item to the unchanged verifier (1) | §15 inside a §6 JWS | **kept** | a sealed post is a post; `S§4`. **Never run through `weekend-reader.js`** — §2.A's second half. | N |
| every recipient opens it and nobody else; a tag match whose unwrap fails keeps scanning and fails closed (2) | §15.2 per-recipient slots | **kept** | the construction is on trial (`S§8`) but the property is fixed. | N |
| one ephemeral, no `kid`, tags disclose nothing (1) | §15.2 blinded tags | **kept** | R§11 ruling 9 keeps the blinded per-recipient slot tags. | N |
| a relayed ciphertext is refused; every field of the binding is checked (2) | §15.2.1 carrier binding (`_feed_url`, id, author) | **transformed** | `S§9` drops the carrier binding with nothing named in its place. What it stopped: the ex re-signs her sealed post into *his* feed and her recipients decrypt her words under his name. The cheap replacement is the author's genesis and `n` as associated data in the envelope. **Decided in §2.A or lost.** | **Y** |
| the audience travels inside the sealed bytes (1) | §15.3 | **kept** | ruling 9; `audience-exp` prices dropping it. | N |
| the recipient's key is resolved from their own document, never a list (1) | §15.1 `use: enc` key | **kept** | `read` in the profile (`S§2`). | N |
| an encrypted attachment's hash is over the ciphertext (1) | §15.5 `_sha256` | **transformed** | media is a fourth file kind addressed by hash and listed in the head (R§11.6). Never fetched in any gate (§2.E). | N |
| metadata is cleartext by construction and the test says so (1) | §11.4 | **kept** | glossary "seal": the host learns that, when, and roughly how big — with the padding *floor* (`dm-metadata-exp`) still to be built. | N |
| the envelope is §5.1-strict on spelling (1) | JWE base64url canon | **transformed** | no JWE; the new envelope's encoding strictness is §2.A's to state. | N |
| a hostile ephemeral key fails inside the module contract (1) | `EncError` | **kept** | implementation contract, not spec text. | N |

## `export.test.js` — 8 tests

**Intent.** A bundle verifies offline with the unchanged reader, survives serialization, dies on
decomposition, says which halves it cannot prove complete, carries received items verbatim, and
cannot vouch for its own predecessor; the last test is the whole exit — migrate, export, restore,
with the host refusing to help.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| a bundle verifies with no network and no bundle-specific verifier; survives serialization, dies on decomposition; the container is self-verifying (3) | §14 bundle, `restoreFetcher` | **dropped** | GOALS: the device always had the copy. **But nothing in the sketch says what the device's copy is or that a reader can verify it offline.** The old guarantee a person could rely on — "hand someone the archive and they can check it with no host" — has no sentence. | **Y** |
| a successor's bundle without the predecessor's chain is refused; a bundle cannot vouch for its own predecessor (2) | §3.4 | **dropped** | no migration; identity is a key. | N |
| the bundle says which halves it cannot prove complete (1) | §14.2 | **dropped** | no published/delivered split. | N |
| received items carried verbatim (1) | §14.3 | **dropped** | no delivered channel (below). | ruled |
| the exit: migrate, export, restore, host refusing (1) | §3.4 + §14 | **transformed** | GOALS scenario 1: the same files written at a new location, the locations list, readers' pins, a restore by vouchers. Staged only in `decisions/freeze-exp.js` (an illustration) — **no gate on the new substrate stages the whole exit**. | N |

## `fetch.test.js` — 23 tests

**Intent.** The fetcher refuses plaintext and non-public addresses, follows only same-origin
redirects, caps bodies per kind, treats 5xx as transient with a negative cache that is bounded
because it is attacker-driven, and never takes the identity URL from input. The sketch does not
mention any of this; it is substrate-independent and still owed.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| plaintext HTTP refused (1) | §3.1 | **transformed** | HTTPS is no longer part of identity. Integrity is the signature's; what HTTPS still buys is *who reads what* not being visible on the wire, which matters most for sealed posts. Needs a sentence (MUST or SHOULD) the sketch does not have. | N |
| non-public addresses refused; DNS guard before connect; a name resolving only to non-public is refused; guard shape; the loopback hatch weakens exactly one thing (5) | `addresses.js` + DNS guard | **kept** | unchanged; see `addresses.test.js`. | N |
| a document is fetched and reported with its cross-origin state (1) | `fetch.js` | **transformed** | host MUST allow cross-origin reads (`S§6`). | N |
| non-JSON content types refused; media type rule matches Appendix A (2) | Appendix A | **dropped** | files are body bytes plus a signature line; there is no JSON media type to check. The sketch names no content type at all. | N |
| a non-I-JSON document is refused at the fetch path (1) | `canonical.js` parser | **transformed** | the strict scan in `weekend-reader.js parse()` — same four checks. | N |
| body caps per document kind, declared or not (2) | §13.4 | **transformed** | still needed and unwritten: a head at journal scale is ~8.6 MB (`headage-exp`), so the old per-kind numbers do not transfer. | N |
| the history byte budget bounds a walk (1) | §13.4 | **dropped** | no walk. | N |
| same-origin redirects followed to a cap; cross-origin never; no scheme/address escape (3) | §12 | **kept** | policy, unchanged. A move across origins is the signed `locations` list, not a redirect. | N |
| non-200 refused, 5xx transient; deadline (2) | `fetch.js` | **kept** | implementation; but see `reader.test.js` on what "transient" means to the verdict. | N |
| negative cache ladder; transient vs policy refusals; bounded because attacker-driven (3) | §12, §13.9 | **dropped** | retry policy is the reader's; the attacker-driven bound that mattered is now the rumor rule's once-per-identity-per-pass (R§12.7). | N |
| identity URL derived, never taken from input; the document must claim the identity it was fetched under (2) | §3.2 | **transformed** | `genesis` must equal the key the reader learned (`weekend-reader.js:35`); the URL is where you live, not who you are. | N |

## `inbox.test.js` — 31 tests

**Intent.** The §10 inbox: rate limits per bucket, relevance before any outbound fetch, forged
deliveries that cannot pin a victim, tombstones and revocation judged against receipt time, the
republication gate, §16.1 pins judged locally, and the delivered stream with its gaps, retries,
and migration rules. GOALS retires the whole pipeline: everything is pull.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| one delivery costs one hit per bucket; irrelevant costs zero fetches; malformed refused before dialling; a stranger's id is not a routing token; a blocked source cannot churn keys (5) | §10.2 ordering, §13.9 | **transformed** | the pull-side equivalent: a reply names its target; the reader looks again at most once per identity per pass and only at identities it already follows (`weekend-reader.js rumors()`; R§12.7, measured 0 / 5 fetches for 1,000 replies). | N |
| a forged delivery cannot pin a victim's item (1) | §10.4 | **dropped** | no pins are carried (R§11.1). | ruled |
| version ordering, stale vs update, a stranger reusing an id (2) | §10.5 records | **dropped** | ids are numbers under a key; nothing is delivered. | N |
| a verified migration makes two authors one record (1) | §3.4 | **dropped** | no migration. | N |
| relevance matches the id half whatever feed the other half names (1) | §10.2 | **dropped** | no feeds. | N |
| a tombstone that kept its content is refused; one that dropped its relation is not (1) | §7.3 | **transformed** | a withdrawal is `[n, null]` in the head, with no content to keep (`S§3`). | N |
| revocation judged against receipt time (1) | §10.3 | **dropped** | no revocation, no clock in a verdict (`S§7`). | N |
| a blocked author gets 202 and the content is discarded (1) | §10.2 | **dropped** | blocking is the app's (the contact list is not on the wire, R§11.6). | N |
| the cross-origin headers cannot be forgotten (1) | §10.1 | **transformed** | host MUST (`S§6`). | N |
| the republication gate is one field (1) | §10.6 | **dropped** | "never republish what was delivered" is an extension restriction in GOALS; nothing is delivered in the core. | N |
| §16.1 pins: judged locally, owned chains only on published items, declared manifests, heeded after verification, end to end, emitted by construction (6) | §16.1 | **dropped** | R§11.1. | ruled |
| a target splits at the last `#` and untrusted content is escaped (1) | §10.5 | **dropped** | a target is `{key, n, hash, at}`; nothing to split. Escaping is the app's. | N |
| a dropped delivery is visible to its victim and names the bytes (1) | §10.6 stream | **transformed** | a reply lives in the *replier's* feed, listed by the replier's head; the person replied to pulls it from there, so the only party that can drop it is the replier's own host, which the replier's readers catch as withholding. | N |
| the delivered stream: not advanced by an unverified sender; `_delivery` on a published item ignored; a delivered item may not name a feed; a delivered retraction carries its place; late delivery fills its gap; a forged gap-filler is caught; first contact deep into a stream; migration does not restart it (8) | §10.6 | **dropped** | no delivered channel. A DM is a sealed post in its author's feed (R§11.8); what the host learns is stated, and a padding floor is owed (§2.A). | ruled |

## `manifest.test.js` — 19 tests

**Intent.** The manifest's four invariants and the lag / withholding / violation / stale lattice:
content cannot vanish without a tombstone, versions never decrease, a tombstone cannot be undone,
the consumer ceiling bounds pending, a future-dated item is a violation, a chain that stops
advancing becomes stale, and a `_next_update` declaration can only tighten. Most of the lattice
goes; three invariants survive as head rules.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| the consumer ceiling bounds pending; an advance converts lag into violation; a future-dated item is a violation; lag/withholding/violation are three states; a tombstone-only advance convicts the morning's posts; stale only when it stops advancing; a declaration only tightens; `_next_update` shape, and a malformed one in history (9) | §9.3 invariants 1–3, §9.1.2 cadence, the lattice | **dropped** | no clock gates a verdict (`S§7`); `pending` is the *device's* mark and a reader never convicts it on its own clock (R§11.5). **What is lost:** the old reader could say a host had gone *stale*. The new one cannot tell a quiet author from a host that stopped serving updates — R§12.7 calls that "the same fallback as a host that quietly stops updating", and §2.F asks whether that is acceptable. | **Y** |
| the passed-over test needs the owner's own signature, or it frames them (1) | §9.3 | **transformed** | the head is signed by the author, so every withholding is judged against her own list; a host cannot add a line. | N |
| content cannot vanish without a signed tombstone (1) | §9.3 invariant 2 | **transformed** | a listed post the host will not serve is `host`; what vanished from the list between two reads is a withdrawal, named (`S§5` step 2). | N |
| versions never decrease; one revision has one hash (1) | §9.3 invariant 1 | **transformed** | `hseq` never back; a number is issued once and the fold rejects a second line with a different hash (`aohead-gate`). | N |
| a tombstone cannot be undone by resurrecting the id (1) | §9.3 | **transformed** | within one head, `[n,null]` then `[n,hash]` fails the fold. **Across a rewrite it is caught only by a reader holding the previous head** (`aohead-gate` compaction rows); from cold, a re-admitted number is invisible. | N |
| a skipping walk checks the endpoints and says so (1) | §9.1 | **transformed** | R§12.4: only endpoints are ever compared. | N |
| invariant 4 is over the bytes, so a re-serialized copy does not reconcile (1) | §9.2 | **kept** | the address is the hash of the body as served; a host that re-formats makes every file read as forged (`S§1`). | N |
| a tombstone served as live content is a violation (1) | §9.3 | **dropped** | no tombstone object. A withdrawn post's file may still sit at `/posts/n`; the reader ignores what the head does not list (weekend-gate "smuggled"). | N |
| relocation does not reset the chain (1) | §3.4 | **transformed** | the same `pseq`/`hseq` continue at the new location (`S§2` `locations`). | N |
| a malformed manifest is refused before any invariant (1) | §9.1 | **kept** | a head that does not fold is `host` before any post is fetched. | N |
| a manifest is bound to the identity and feed that named it (1) | §9.1 | **transformed** | the head lives at the name and must be signed by the current key; there is one. | N |

## `migration.test.js` — 12 tests

**Intent.** §3.4: a cooperative migration verifies and retires the predecessor; a recovery
migration needs nothing from the old host; a cold reader sees it as unverified, not a fork; two
claims on one predecessor resolve to neither; a one-sided claim is not a migration; the carried
back catalog is not accused of withholding; the migration store bounds itself. Identity is now a
key, so "migration" is a location change and none of this survives as written.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| moving hosts: cooperative and recovery migrations verify; the predecessor is retired; a one-sided claim is not a migration; the carried catalog is not "withheld" (5) | §3.4 successor/predecessor, `migration.js` | **transformed** | the `locations` list in the signed profile; the same files at the new address; the old copy is just older (`S§2`; GOALS scenario 1 and 4). "Retired" has no analogue: **nothing marks the old location as dead**, and a reader that never learned the new one reads the frozen copy as `ok` (`freeze-exp`). Ruling 7 chose location-through-targets for this. | **Y** (ruled — confirm that "ok at the old address" is the accepted reading of scenario 1's "reads as stale") |
| a cold reader sees a recovery migration as unverified, not a fork; two migrations claiming one predecessor resolve to neither (2) | §3.4 + §5.5 | **transformed** | a cold reader shows *contested*; only a reader holding the pre-fork profile can run the court (R§11.3, `forkcold-exp`). | N |
| the retained predecessor state is a recovery pin; `advanceIdentity` co-signs atomically (2) | §4.5 | **dropped** | no recovery pin; a restore is a chain hop with vouchers. | N |
| the migration store evicts whole chains, never a party to a recorded migration, bounds itself (3) | `migration.js` store | **dropped** | no store. | N |

## `negative.test.js` — 41 tests

**Intent.** The must-fail corpus: JSON hygiene, URL normalization, every JWS header and signature
deviation, author binding, timestamp strictness, revocation clocks, key kinds, chain dating, and
delegated keys. The hygiene half survives nearly verbatim; the JWS and clock halves go.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| duplicate members, malformed JSON, `__proto__`, lone surrogates, integers past 2^53 rejected (5) | §6.3 `canonical.js` I-JSON parser | **kept** | the strict scan in `weekend-reader.js parse()` (and `lastline.js parseStrict`) does exactly these, plus a leading BOM. R§11.7: a producer MUST NOT emit them, a reader SHOULD reject. | N |
| keys sort by UTF-16 code unit; non-representable values rejected (2) | RFC 8785 | **dropped** | no canonicalization: the bytes signed are the bytes served. | N |
| identity URL normalization matches the table (1) | §3.2 | **dropped** | identity is a key. | N |
| `kid` splits at the last `#`; header deviations; protected header held to I-JSON; rewritten header does not verify (4) | §6 JWS | **dropped** | no JWS, no header: body, newline, signature line (`S§1`). | N |
| an item signed as an item cannot be read as a chained document, or the reverse (1) | §6.2 `typ` | **transformed** | kinds are told apart by path and shape: a post must declare the `n` it was served at; a head must fold; a profile must walk. A file of one kind served at another's path fails the shape test for that path. Not staged in any gate. | N |
| malformed signatures rejected; `_sig` not malleable; a key `x` with non-canonical spelling refused (3) | §5.1 strict base64url | **transformed** | the signature line is exactly 86 base64url characters that re-encode to themselves (`lastline-gate`: 638 lenient spellings, 0 strict). **The same rule for a key's `x` is not in the reader** — a non-canonical spelling of the genesis key would be a second identity for one key. Owed. | N |
| deleting a recovery co-signature breaks the `_sig` over it (1) | §4.5 | **transformed** | vouchers sit inside the signed profile body. | N |
| author binding failures; a permalink is not a binding; the identity document must be the one the `kid` names (3) | §7.1 | **transformed** | `genesis` equals the learned key; a post counts when signed by a chain key *and* listed by the head. | N |
| content timestamps are RFC 3339 and lenient readings refused (1) | §7.2 | **dropped** | `at` is displayed, never a verdict (`S§7`); strictness is the app's. | N |
| tampering with any signed field breaks the signature; unknown extension fields are covered (2) | §6 | **kept** | every byte of the body is signed (`lastline-gate`: 1,544 body mutations, 0 verify). | N |
| a key revoked before signing time; receipt time bounds self-reported time; a smuggled numeric `updated`; an old observation cannot stand in for a fresh revision; backdating before the key existed; a key issued after signing (6) | §6.5 revocation clocks, §4.4 | **dropped** | no revocation and no clock in a verdict. A stolen old key is closed by head admission under the current key (`inventory-keys-exp`, weekend-gate "smuggled"). The "old observation" case is the pin's `live` hash check. | N |
| non-Ed25519 keys refused; a key absent from the identity document refused (2) | §5.1 | **kept** | the reader constructs only Ed25519 keys; a post must verify under a chain key. | N |
| an `authors` field on a chained document does not displace its binding (1) | §7.1 | **dropped** | no such field. | N |
| a walked version must belong to its chain; a forged tip does not freeze the chain against its owner; rewriting a retained version still freezes (3) | §5.3 | **dropped** (1) / **transformed** (2) | no walk; a forged or rewritten profile is *contested* for a pinned reader, never a freeze. | N |
| a delegated key signs items and cannot sign the identity document (2) | §5.4 `use` | **dropped** | the device is the only signer (GOALS). | N |
| a chain version dated before its predecessor; one sharing its second (2) | §5.2 `iat` | **dropped** | no timestamps in the chain. | N |
| a manifest hop whose `updated` goes backward (1) | §9.3 | **transformed** | `hseq` never back. | N |
| a publisher raises a regressing clock instead of refusing to publish (1) | `publish.js` | **dropped** | no clock anywhere in publishing. | N |

## `reader.test.js` — 41 tests

**Intent.** The composed Level 1 consumer: both chains pinned, the manifest's verdicts, item
URLs and pagination, transient failure deferred rather than accused, first-observation records
keyed so migration cannot reset them, co-authors, peer pins, staleness and cadence, and a bounded
observation store. Two thirds goes with feeds, pages, and the lattice.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| `read()` verifies end to end and pins both chains; follows an honest publisher forward (2) | `reader.js` | **kept** | `weekend-reader.js read()`; the pin holds `pseq/phash` and `hseq/hhash` (`S§5`). | N |
| an item dropped without a tombstone is a violation (1) | §9.3 | **transformed** | a live post missing is `host`; a withdrawn one is named. | N |
| a rolled-back manifest is refused and the pin stays (1) | §9.3 | **kept** | `hseq` against the pin; a bad read does not replace it. | N |
| a rewritten identity history is equivocation and freezes (1) | §5.3.1 | **transformed** | contested; no freeze. | N |
| an item the manifest commits but the feed never yields is withholding (1) | §9.3 | **kept** | listed and not served is `host`. | N |
| item URLs: missing from the page but served at §7.6 is obtained; probing inert without URLs; declared-then-none is withholding; an empty page over a serving tree is not withheld (4) | §7.6 derived item URLs | **dropped** | every post is its own file at `/posts/n`; there is no page to be missing from. | N |
| an item uncommitted past the ceiling stops being lag (1) | §9.3 | **dropped** | no ceiling, no lag. | N |
| an item whose `_feed_url` names another feed is a copy, verified and unrejected (1) | §7.1 | **dropped** | a repost is a post with `rel: repost` and a target; files are never copied between feeds. | N |
| a transient failure defers rather than rejects, and clears; a host that never comes back is rejected only after every rung (2) | retry ladder | **transformed** | `weekend-reader.js` treats a fetch that returns nothing as `host: listed and not served` on the first miss. A 503 or a timeout reads as misbehaving. **The spec must say what a `host` verdict requires** (a served wrong answer, or a definite not-found — not a timeout); nothing stages it. | N |
| first-observation time keyed on (author, id); a key revoked before first seen; feed URL comparison; an identity listing no feeds (4) | §4.4, §6.5, §3.2 | **dropped** | no observation record, no revocation, no feeds. | N |
| a chained document served non-canonically is refused (1) | §6.3 | **transformed** | the bytes served are the bytes signed; re-formatting fails the signature (`S§1`). | N |
| an attachment with no `_sha256` is unverified content inside a verified item (1) | §7.5 | **transformed** | media is listed in the head by hash (R§11.6) — so unlisted media is *not there*, the same as an unlisted post. Unbuilt (§2.E). | N |
| pagination to the end; a `next_url` off-origin; every `feeds` entry read; an unreadable archive; renaming a manifest URL cannot shed content (5) | §7, §3.2.1 | **dropped** | no pages, no feeds, one head. | N |
| a forked chain is resolved by the co-signature; one with none stays frozen (2) | §5.5 | **transformed** | the fork-point court (R§11.3). **Not in the composed reader** (§2.D). | N |
| a co-author is observed once per read; a co-author's chain equivocating is a violation (2) | §7.1 `authors` | **dropped** | a post has one signer. | N |
| an item that fails verification writes nothing into the record (1) | §4.4 | **kept** | a `host`/`identity` read returns no pin. | N |
| peer pins: resolved locally, dial nobody on a stranger's word; a disagreeing one resolved at the derived URL; can fire §5.3.1 on own evidence (3) | §16.2 | **dropped** | R§11.1; the reply's target is the rumor and its two bounds are the dial guard (R§12.7). | ruled |
| a host that stops advancing is reported stale after two reads; a declared cadence is a promise (2) | §9.1.2 | **dropped** | see `manifest.test.js` — the staleness sign-off. | (counted there) |
| one malformed author URL is one rejected item, not a dead read (1) | §7.1 | **kept** | a reply whose target is missing or unknown is skipped (`rumors()` first line). | N |
| the observation store evicts whole identities, never the oldest; a tracked feed's owner is never evicted; an evicted identity is first contact; bounds itself as written; round-trips its index (5) | §4.4 store | **dropped** | one pin per identity; bounding the set of identities followed is the app's. | N |

## `vectors.test.js` — 10 tests

**Intent.** Appendix B's vectors are extracted from the spec text itself, verify against their
key, were signed inside the key's validity window, commit exact item bytes, chain by `prev`, and
re-canonicalize to themselves. The new spec has no vectors yet.

| intent | old mechanism | verdict | new mechanism / reason | sign-off |
|---|---|---|---|---|
| the spec contains the vectors it claims; every one verifies against its author (2) | Appendix B + `tmp/regen.js` | **transformed** | owed for the new format: a profile, a head, a post, a sealed post, with deterministic keys (`lastline.js makeKey`) so the bytes reproduce. No vector exists. §2.A asks for envelope vectors specifically. | N |
| the canonicalizer reproduces B.2; re-canonicalizing a vector reproduces its bytes (2) | RFC 8785 | **dropped** | no canonicalization. | N |
| every vector was signed inside its key's validity window (1) | §5.2 | **dropped** | no validity windows. | N |
| manifest entries commit the exact published bytes (1) | §9.2 | **transformed** | head entries are body hashes (`S§3`). | N |
| manifest chain, identity chain link by `prev`; the delivered pair by `delivery.prev` (3) | §5, §9, §10.6 | **transformed** (2) / **dropped** (1) | `prev` on head and profile, adjacent-only (R§12.4); no delivered pair. | N |
| every `feeds` entry declares `items: true` (1) | §3.2.1 | **dropped** | no feeds. | N |

---

## Sign-offs, in plain words

1. **The relay guard (enc).** Today a sealed post is tied to the feed and author that carried it,
   so the ex cannot copy your sealed words into his own feed and have your family read them under
   his name. The sketch drops that tie and names nothing in its place. Either §2.A's envelope binds
   the author's key and the post number into the sealed bytes, or this is lost.
2. **The offline archive (export).** Today you can hand someone a bundle and they can verify it
   with no host anywhere. The new design says "the device always had the copy" and stops. There is
   no sentence about what the copy is or whether a reader can check it without a host.
3. **Staleness (manifest, reader).** Today a reader can say "this host has stopped serving
   updates." The new reader cannot tell that from an author who has gone quiet; R§12.7 accepts
   this and §2.F is the question of whether a hostile host can hide behind it for ever.
4. **The frozen copy (migration) — ruled, confirm.** GOALS scenario 1 says the ex's old copy
   "reads as stale, not as her." Under the design it reads as *ok* to anyone who never learned
   her new address; ruling 7 chose location-through-targets as the way they learn it. That is a
   softer claim than the scenario's sentence, and the scenario should be reworded or the ruling
   revisited.

Already ruled by name and only recorded here: item-carried and peer pins (R§11.1), the delivered
channel and the DM-on-feed consequence (R§11.8).

## What the new gates do not yet cover

Every kept-or-transformed intent above that no file in `tmp/redesign/gates/` exercises. This is
the list the new `test/` will owe.

- **The fetch policy, whole.** Address blocking, the DNS guard, same-origin-only redirects,
  body caps, plaintext refused. No gate opens a socket to anything but loopback, and the rumor
  rule now fetches replier-chosen URLs.
- **Transient failure versus withholding.** A null fetch is `host` on the first miss in
  `weekend-reader.js`. What a `host` verdict requires is unwritten and unstaged.
- **The pin's persistence** — serializing the `live` map and reading it back — and a CLI over the
  reader with exit codes (GOALS "still open" 5).
- **`prev`, checked.** R§12.4 says it is checkable by an adjacent reader; `aohead-gate` checks it
  inside the gate; the weekend reader never reads the field on either file. Either the reader owes
  the check or the schema owes the cut.
- **The fork-point court inside the composed reader** (chain 598/612/638, reader 777/835). Only
  `forkcourt-gate` and `forkcold-exp`, in isolation. §2.D.
- **The exit and the frozen copy on this substrate** (export 226, migration 101–368). Only
  `freeze-exp`, an illustration.
- **A key's `x` in canonical spelling** (negative 357). The 86-character rule covers the
  signature line, not the key.
- **One kind served at another's path** (negative 241). Covered by shape checks in principle,
  never staged.
- **A withdrawn number re-admitted across a rewrite, read cold** (manifest 209). `aohead-gate`
  covers the pinned reader only.
- **Everything encrypted** (enc, all 12): the unchanged reader over a sealed post, recipient-only
  opening, blinded tags, the relay binding, the padding floor. §2.A.
- **Media** (enc 317, reader 576): listed, fetched, withheld, swapped. §2.E.
- **Test vectors** for the four file kinds (vectors 63/86/124/145/156).

## Where this contradicts `SKETCH.md` §9

- **"`src/canonical.js` goes entirely — there is no canonicalisation left to do."** Half true.
  The RFC 8785 *serializer* goes. The I-JSON *parser* half — duplicate members, `__proto__`,
  integers past 2^53, lone surrogates — does not go: it is a quarter of `weekend-reader.js`
  (`parse()`, lines 36–65) and all of `lastline.js parseStrict`. Five `negative.test.js` intents
  are kept by it. The sentence should say the serializer goes and the strict parse stays.
- **"§15's carrier binding goes"** with nothing named in its place — sign-off 1 above.
- **§9 lists what goes and not what stays silent.** The fetch policy (§12, §13.4, the address
  tables) is neither replaced nor mentioned; it is substrate-independent and the spec still owes
  every line of it. Likewise Appendix B: the vectors go with the format, and new ones are owed.
