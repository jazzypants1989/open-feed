# Recorded rejections, answered by name — DRAFT (Stage 3, 2026-08-19)

Owner ruling 2026-08-17 item 1: everything is reopenable, but a reversal must **answer the
recorded reasoning in writing and be surfaced plainly**. This file does that for every rejection
PLAN.md's Session A names, plus the ones the candidates implicate. "The candidates" below means
the designs in `CANDIDATES.md`; gate references are runnable evidence in `tmp/redesign/gates/`.
Finalize alongside the sketch; entries marked ⚠ are reversals or part-reversals the owner must
see, not silent adoptions.

## 1. §9.2's Merkle paragraph (spec:601)

**Recorded:** committing a Merkle root would need inclusion-or-deletion proofs per id per
version; detecting omission of a never-seen item still needs the whole set; serving proofs needs
a dynamic endpoint or O(n log n) files, costing "every Level 2 artifact is a file."

**Answered, not reversed.** The log candidates commit no Merkle root. Checkpoints keep **the
plain map**, moved from every version to every Kth event: invariant checks stay map reads
(log-gate), detecting omission of a never-seen item is one checkpoint fetch + map lookup, and
static hosting improves (immutable segments + one growing file). The one objection the checkpoint
answer had to earn separately — never-seen omission *between* checkpoints — is covered by the
windowed audit (optional, resumable, O(live set) memory; log-gate stages a lying checkpoint and
catches it).

## 2. The deltamanifest card (fold objection + the circular-defense trap)

**Recorded:** deltas rejected because §9.3's invariants become "a fold over a range instead of a
map lookup," invariant 1 checkable only against reconstructed state the consumer must hold, and
§5.3.1's observers end up comparing reconstructed state rather than published bytes. Plus
review-findings' trap: `_skip` is O(log versions) *because* versions carry full maps — the
full-map design is defended by the mechanism it necessitates.

**Dissolved, with the instrument re-run.** In the log shape the fold *defines* the live set and
is consulted by **no integrity check** (per-hop checks are hash + contiguity + O(1) content
rules); observers compare **published checkpoint bytes** at shared positions; the any-two-
checkpoints map diff catches every violation class the per-version diff catches (log-gate stages
all of them). The circle breaks because both of its halves are deleted: no full map per version,
no `_skip`. Re-running `tmp/measure/deltamanifest.js` live inside log-gate: the log shape beats
Model A's retained storage 28–130× and beats A+`_skip`'s own best case (1-year lapse, hourly
scenario: 1.1 MB vs 3.9 MB) — *with the design consequence that checkpoint events must be
individually addressable*, which the gate discovered by first failing without it.

## 3. Delivery-chain card Q4 + the two rejected receipt designs

**Recorded:** no multi-recipient placement of per-pair state survives (named array broadcasts the
audience; item-per-recipient breaks `(author, id, version)`; a JWE slot header entry is cleartext
and re-links blinded slots). Receipt designs rejected: a recipient-published receipt map (the hub
countersigns its own drops; a public receipt for a private message) and a sender-side
`delivered:[hash]` commitment (the recipient cannot know what it never received).

**All stand, unchanged.** Under the candidates' minimal delivered channel (channel-gate), the
one-recipient rule transplants as a rule of the channel, so no multi-recipient placement is ever
needed; `dseq`/`dprev` (+75 B, the card's own accepted shape) carries selective-drop evidence.
Both receipt designs stay rejected for their recorded reasons — and the sender-side commitment is
now *worse* than when first rejected, because the log is the identity and the commitment would
publish the DM's existence into the permanent record.

## 4. §16.1's aggregator foreclosure (spec:985, §13.10)

**Recorded:** no pins document, no log, no witness network — permanently — because a standing
published record of who-observed-whom is a reading graph with timestamps, and the aggregate leaks
by existing.

**Stands; the supply side gets quieter.** The candidates define no aggregate. Pins move *inside
encrypted content* (sealed-pins-gate, driving shipped `src/enc.js`): zero public reading-graph
bytes, strictly less disclosure than today's cleartext pins on delivered items. Cleartext pins on
public interactions keep §16.1's exact scoping. R3's family-witness profile remains what §13.10
already says it is — a deployment profile consuming existing artifacts, not spec text.

## 5. §11.2's roster foreclosure (spec:735)

**Stands, unchanged.** No candidate defines a membership document; audiences stay sealed
(§15.2.2's declared audience transplants verbatim, and its six-of-seven-costs argument is
untouched by the substrate change).

## 6. §15.4's history (the delivered-replies reversal) ⚠ part-new-evidence

**Recorded:** an earlier draft sent every interaction down the delivered column; reversed because
that handed the hostile custodian the cheapest attack (dropping uncommitted replies) on the
channel families actually use. Posts and replies to an audience: published, encrypted; only
content-free reactions delivered.

**The reversal stands for audience conversations — and the channel-gate adds the evidence the
recorded reasoning was missing for DMs proper.** For one-recipient content whose existence is the
secret, published-only routes the victim's speech *through the hostile hub's append path*
(suppression undetectable for a ceiling-width window, and never delivery), while a delivered blob
bypasses the hub entirely. So the candidates keep §15.4's split for audiences and keep a minimal
delivered channel for the audience-of-one — with §10 shrunk to ~1,000 words because
content-addressed dedup kills the version-poisoning class (channel-gate). This is a refinement of
the recorded position, surfaced here plainly.

## 7. PLAN.md register items 1–5

1. **One-recipient delivery** — stands (see 3).
2. **Whole-second timestamps** — stands; the candidates keep Unix seconds everywhere; no unit
   boundary is introduced (`ts` in events, `iat` in keys).
3. **`_openfeed` namespacing / `_sig` top-level** — ⚠ dissolves rather than stands: the
   candidates' items are their **own object model** (blobs), not residents of JSON Feed's
   namespace, so there is no shared extension space to defend; the generated `feed.json` view is
   unsigned and carries no protocol members. The recorded reasoning (d5ddc03) was about living in
   somebody else's namespace, and the candidates stop doing that — the reasoning is answered by
   removing its premise, which is a reversal of the *situation*, not of the argument.
4. **§15/§16 promotion; §7.6 capability flag; freshness bound** — §15's promotion logic
   transplants (audience restriction still MUSTs the full layer). §7.6 generalizes from a flag to
   the substrate (every artifact hash-addressed), so `items:true` dissolves *with its
   fail-open-against-legacy problem*: there is no legacy shape in a new protocol, so blob serving
   is unconditional and the withholding verdict is structurally reachable (the withholding card's
   own logic, carried to its conclusion). Freshness transplants (`next` on checkpoints /
   heartbeat commits), key-custodian limit restated verbatim.
5. **Rejected receipt designs + rejected rule-extraction mechanisms** — receipts: see 3. The
   three rule-extraction mechanisms (index appendix, requirements table, blockquote convention)
   were rejected because nothing may expand the document; the candidates do not propose them.

## 8. The held-fixed list itself (PLAN.md Stage 3)

- **"Identity chain stays small and self-keyed; merging content volume into it stands
  rejected"** — ⚠ answered, not defied: in both log candidates the key events form a sparse
  self-keyed subchain (dense `kseq`, `kprev` links, full continuity per hop), so a keys-only
  reader fetches O(key events), never content volume (subchain-gate: 3 fetches; serving-path
  splices refused; the custodian fork is exactly today's §5.5 class, no weaker).
- **"§6 + §6.3 + §3.1 verbatim"** — reversed with evidence: bytes-gate (2,635 mutations, 0
  verified) for §6/§6.3; §3.1 either dissolves (hash identity) or is fixed by construction
  (unreserved-charset paths — priced honestly in CANDIDATES.md: non-ASCII paths become
  unmintable).
- **"§15 envelope held fixed"** — kept, with the NIP-44-swap evaluation flagged as the answer to
  its unreviewed status.
- **"feed.json as a JSON Feed view"** — kept in every candidate (unsigned, generated, Level 0).

## 9. Cards the candidates implicate but do not reverse

- **canonicality card** (regimes B/C rejected): the candidates are *not* regime C. C hashed
  served bytes while still nesting documents as JSON values (§14 broke). The candidates give
  every signed artifact its own byte range and their export is a directory of those files —
  nothing nests, so the recorded failure case cannot arise. Regime A's argument ("serving is
  keeping a string") becomes the whole design.
- **feedbinding card** (`_feed_owner` rejected for precision loss — an owner of twenty feeds
  could move a contributor's item between them): the candidates delete the feed concept, and an
  item's location *is* its author's log — there is no second feed of the same owner to move it
  to; a board is a client-side view over contributors' own logs (the card's own recommended
  shape). The recorded attack has no object. Copies of a blob elsewhere carry no liveness — that
  standing lives in the author's log alone, as §7.5 always wanted.
- **manifestindex card** (manifest-as-index rejected: 48× cold fetches; the uncommitted-window
  blindness): the log *is* the index, but neither number transfers — items are fetched by blob
  hash only when wanted (the feed view carries content for Level 0), and there is no
  uncommitted-window blindness because publishing IS appending: an event exists from the moment
  it is served, and the lag state collapses to "not yet fetched." The 48× figure priced fetching
  one URL per item on every poll, which nothing here does (a poll is tip + new segment).
- **skiplinks card**: `_skip` dissolves with its subject (see 2). The card's absolute-anchors
  lesson survives as the checkpoint cadence being fixed arithmetic (every Kth event), so
  observers land on shared positions.
- **threshold card**: §4.5's one-key recovery scope transplants unchanged into `recover` events
  / recovery co-signatures; k-of-n stays out for the recorded Q3 reason (coordination risk at
  the exit).

## 10. Not yet answered (owed by the sketch)

- §12's conformance-level taxonomy (levels vs roles) — unexamined this session.
- §2.1's token-vocabulary meta-rule — likely dissolves with the namespace problem (see 7.3);
  confirm in the sketch.
- The archive/rotation successor (checkpoint-blob growth at 100k-item scale) — log-gate names
  it; the sketch must bound it or scope it out.

## 11. ⚠ Item-carried pins (GOALS.md:80–81) — re-adopted by the fresh-start design

**Recorded:** GOALS.md's completeness bullet retires "item-carried pins as a mechanism" along
with the compare-rule apparatus; the head alone, pinned by a reader, is the completeness story.

**⚠ Part-reversed, unruled.** `TLDR-new.md` and `decisions/inventory-head-exp.js` Issue 5 make a
pin `(hseq, hash)` carried in every reply and reaction the split-view detector. `gates/splitview-gate.md`
measures what it buys and what it costs: it catches every captive-family strategy once one
interacting outsider with a social path exists (0 of 511), catches nothing in an all-captive
family (4 of 63 escape), cannot see uniform staleness at all, and **as specified is a forgery
vector** — two unverifiable fields let any replier make an honest host read as withholding or an
honest author as forked. Adopting it requires choosing repair A (pins are hints) or repair B (the
head signs `hseq\nhash`). The owner has not ruled on the re-adoption or the repair.

**Resolved 2026-08-21 (RULINGS §11.1): not re-adopted, and the surface removed.** The carried pin
is dropped. A reply already names its target (author key, number, hash), and *that* is the signal:
a reply to a number above the head's declared top makes a reader re-fetch and, if still short, say
"X replied to something I can't see" — a rumor naming X, never an accusation
(`decisions/targetrumor-exp.js`: strategy for strategy it catches what the pin caught, and the
forgery vector is gone because there is nothing unverifiable left to forge). GOALS.md:80 stands as
written. The word "pin" narrows to the head a *reader* remembers of a head it verified itself.

## 12. ⚠ The tiny counter (RULINGS.md ruling 4) — superseded by the `[n, hash]` list

**Recorded:** ruling 4 chose the 138-byte counter `{sequence, top, withdrawn, prev}` over a list
of names (6.8 KB) or names plus fingerprints (33 KB) at ten years of three posts a week.

**⚠ Reversed, unruled.** `decisions/substitution-exp.js` (the counter passes a stolen-key
substitution to cold readers) and `inventory-head-exp.js` Issue 6 (the counter false-alarms on a
reply to a withdrawn post) argue the list wins on correctness; the design adopted it without a
ruling. `gates/headrange-gate.md` prices it: 81.6 KB at family scale, 5.39 MB at 100k posts; under
range-fetch the reader cost is small at family scale at any edit rate, and at a 10k-follower
journal it collapses to 79% of always-full at a 5% edit rate — a rate the design never states.
The counter's own number is stale too: 178 B with a prev-hash, 337 B at 5% withdrawals, and it
cannot express an edit. A paged head (fixed-size pages, the head listing page hashes) keeps the
list's correctness at 0.49 TB/year in the worst case tried. Owner to rule on the reversal and
the edit-rate assumption.

**Resolved 2026-08-21 (RULINGS §11.9, §12.1): the reversal is the owner's, and the shape is the
append-only list.** The counter is superseded on correctness. The edit-rate question is answered
not by stating a rate but by changing the shape: a withdrawal is an appended `[n, null]` line, so a
reader's tail fetch survives it, and the four candidate shapes collapse into one dial — how often
the author rewrites the file — which the reader is indifferent to (`gates/aohead-gate.md`) and which
is therefore the publisher's setting, suggested default once a month. The paged head is not needed
at any scale measured.

## 13. ⚠ Host-released scheduled posts (RULINGS.md ruling 10) — incompatible with admission

**Recorded:** ruling 10 keeps host release: the pre-stamped post carries its release time, so
early release is visible and withholding is ordinary withholding.

**⚠ Contradicted, unruled (handoff §5 A1).** Only the author's key writes the head, and a post
is Alice's only when the head lists it, so a host-released file is never admitted.
`gates/scheduled-gate.md` tries every way around it: pre-signing Friday's head forks Alice's
own identity against her Tuesday post (or rolls it back); listing #8 as pending makes the
withholding verdict depend on the reader's wall clock, which convicts an honest host from a
clock one day fast. 0 of 4 options pass. The choice is between dropping host release and
accepting a clock-gated verdict declared as UX.

**Resolved 2026-08-21 (RULINGS §11.5, §11.9): the mechanism is reversed, the feature kept.** A
fifth option the gate's table omitted — the head lists the post as `pending`, a reader never
convicts a pending entry on its clock, and it becomes ordinary when the device next publishes —
passes all four columns (`decisions/scheduled5-exp.js`). Ruling 10's "bounded withholding" story is
replaced by "uncalled until the author next publishes," stated as the cost.

## 14. ⚠ "The host MAY check stamps" (RULINGS.md ruling 3 continued)

**Recorded:** the host may verify a file's stamp before storing it or not; readers check
regardless, so this is *disk hygiene, not a floor question* — "whatever the host does, it can never
write as you, because it cannot make your stamp. The worst any of them permits is refusing you or
deleting things, which the host can do anyway."

**⚠ Part-reversed, ruled 2026-08-21 (RULINGS §12.5).** The floor half is confirmed over real
sockets: an outsider's post lands on a hub that checks nothing, and the reader refuses it either
way (`gates/pubif-gate.md`). What the recorded reasoning missed is that "refusing you" is not only
the host's own option once create-once exists. A stranger PUTs `/alice/posts/30…34` signed by his
own key, is stored five times, and **Alice's own post at 30 is then refused permanently — by the
rule that exists to stop her being overwritten**. Five requests, from anyone who knows her address.
So the repair: a write to a number that is already taken must be *resolved*, not refused flatly —
if the file sitting there is not the owner's, the owner's write replaces it. The MAY survives on the
ordinary path and stops being true on a collision. Ruling 3's "every post declares its own number
inside its stamped bytes," recorded as a habit that rides along free, is what makes the repair work
at all: without it a replayed genuine post locks the author out of a number she has not reached.

## 15. ⚠ "§15's carrier binding goes" (SKETCH.md §9)

**Recorded:** the sketch lists §15's carrier binding among what the redesign retires with its
mechanism — three plaintext fields compared at the decrypting client, two of which no longer exist.

**⚠ Reversed in part, 2026-08-21 (`gates/envelope-gate.md`).** The *shape* goes; the *binding*
stays. Staged on this substrate: the thief, who cannot read Alice's sealed post, lifts its envelope
into a post of his own, signed by his key, listed in his head. With an empty associated-data field
her family decrypts it and **her words render under his name**. With the carrier — the author's
genesis key and the post's number — as associated data, the lifted envelope does not open, and it
costs zero bytes on the wire. One sentence the spec owes: the content's associated data MUST include
the carrier author's genesis key and the post's number. `INTENT-MAP.md` flags the same thing from
the old `enc.test.js` side as a sign-off.


## 16. ⚠ `prev` on the two overwritten files (RULINGS.md §12.4, SKETCH.md §2 and §6)

**Recorded position.** §12.4 (2026-08-21): "`prev` is only checkable by a reader that saw the
version immediately before — write it that way." SKETCH.md and HANDOFF-to-spec.md §3 specify
`prev` on both the profile and the head.

**Reversed** by final-review Q3 (RULINGS §13.3), without an entry here until 2026-08-23. The
answer to the recorded reasoning: a field only checkable by the reader that saw the version
immediately before is a field no reader can rely on, and every rollback it would catch is caught
by `pseq`/`hseq` not going backwards and by §4.6's chain-prefix rule (a newer profile whose chain
is a strict prefix of the pinned one is a split). A member nobody reads is a member implementers
get wrong. Cost of the reversal: nothing measured; the publisher lost one line.

## 17. ⚠ `pending` (RULINGS.md §11.5, ruling 16) — cut 2026-08-23

**Recorded position.** §11.5 kept scheduled posts as a `[n, hash, "pending"]` line with one cost
stated ("a host sitting on a scheduled post is uncalled until the author next publishes"), after
`scheduled-gate` found 0 of 4 host-release options admissible, collision-free, early-visible and
clock-free at once — `pending` was the option that failed only the clock column, and §5.5 rescued
it by removing the clock.

**Reversed** on `pending-gate`'s measurement: nothing any reader observes before the device
confirms depends on the line (the same reads against the same head with the line deleted are
identical but for the note); the hub cannot confirm (the head is signed by the current key, and a
hub-appended line reads as *no head I can verify* / `host`); and the device can publish the
scheduled post at release time at the next number with nothing it lacks — it holds the key and
the bytes, and §6.1 signs the number in. The line's one effect is that a scheduled post keeps the
number reserved for it, which no reader needs and §5.5 never stated. Cost removed: an entry kind,
§5.5, the fold's confirmation clause, the rewrite's carry-through, §8.4's exemption, a note, a
§14.2 row, a pin field, and B.10/B.11's pending entry — 18 spec lines. What §11.5's cost sentence
described (a host sitting on a post) no longer exists, because the host never holds an
unreleased post.
