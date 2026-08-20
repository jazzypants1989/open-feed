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
