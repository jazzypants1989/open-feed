# Open Feed 2 — the candidates (Stage 3, 2026-08-19)

**What this is.** Stage 3 Session A, replanned per the owner's instruction ("prototype several
different things; don't put all simplification eggs in one basket"). Three candidate
architectures were designed in parallel and a fourth emerged from the profile study; the
load-bearing assumptions of each are now **runnable gates** in `tmp/redesign/gates/` (all seven
green; each has a verdict card). This file is the comparison and the decision sheet. The full
design briefs live in the session transcript; everything decision-relevant is here.

**Held fixed throughout** (owner ruling): the floor — exit, cross-hub family visibility,
audience-restricted content — as *assurances*; §13.2's hostile custodian as the driving
adversary; RFC 2119 discipline; zero-dependency Node implementability; static hostability.

---

## The convergent findings (all candidates, independently)

1. **One append-only log of content-addressed signed artifacts is the right shape.** The
   complexity ledger's five patch mechanisms (~9,000 words) collapse into it; §9.3 invariants
   1/2/5 become true by construction (there is no removal operation but the tombstone event).
   *Gate: log-gate — 68×/28×/130× retained-storage win over Model A on the deltamanifest
   scenarios, re-run live; first contact 1.1 MB / 4 fetches; every violation class caught.*
2. **Encoded-payload signing deletes §6.3 wholesale** (~2,400 of §6's 2,950 words): RFC 8785,
   I-JSON numbers, parser equivalence, the arrival rule, the trailing-newline trap — all gone,
   because a signed artifact's bytes are its identity. Residue: strict base64url spelling + a
   4-item parse-hygiene list. *Gate: bytes-gate — 2,635 byte mutations, 0 verified.*
3. **Deletion becomes more real than today.** The permanently-retained structure carries hashes,
   never content; item and ciphertext bytes are removable after a delete event. HANDOFF claim 1
   answered by construction; §13.8's `tag:…:hospital` self-incrimination becomes impossible
   (deleted ids are event hashes).
4. **§15 is the incompressible block** (~2,600 words in every candidate) and every candidate
   leans on it at least as hard as today. The cheapest answer to its "never independently
   reviewed" status is **swapping the envelope's construction for NIP-44's Cure53-audited one**
   (X25519 + ChaCha20 + HKDF, padded) while keeping the blinded-slot-tag layout — an evaluation
   worth running whichever candidate wins.
5. **Keep a minimal delivered channel.** Under published-only, the hostile hub owns the victim's
   outbound path — suppression is the adversary's cheapest move and staleness detection is not
   delivery. A device-to-recipient POST bypasses the hub entirely, and content-addressed dedup
   kills §10.3's version-poisoning class, shrinking §10 to ~1,000 words instead of deleting it.
   *Gate: channel-gate.* (This partially re-answers §15.4's history with new evidence — see
   rejections.md.)
6. **Per-consumer equivocation detection gets quieter**: pins sealed inside encrypted content
   supply §5.3.1's second observation with zero public reading-graph bytes — less disclosure
   than today's §16.1. *Gate: sealed-pins-gate, driving shipped `src/enc.js`.*
7. **New costs no candidate escapes**: one log = one writer surface (CAS-append; *gate:
   writer-gate*, which also dissolved the offline+delegated-hub re-sign fear by splitting
   authorship into the blob and ordering into the entry); a human-opaque wire (base64 payloads;
   the generated JSON Feed view compensates for content, not chain forensics); a full rewrite of
   `src/` and the 267 tests.

## The eliminations

**Ecosystem profiles are out.** Each misses a floor item by architectural conviction, the patch
delta is 60–100% of a fresh spec and invisible to the ecosystem's own readers, and profiles bind
to moving targets at trust boundaries (nostr deprecated its DM encryption once already; atproto
removed the commit `prev` field in repo v3):
- **Nostr** — no key rotation or recovery (identity exit fails permanently for any hub-onboarded
  member); no completeness commitment of any kind; relays not static-hostable; secp256k1 breaks
  zero-dep. Salvage: NIP-44's audited cipher suite (finding 4).
- **ActivityPub** — no signed data model, no completeness, no encryption, exit is
  server-mediated: fails every floor item *at the adversary*. Its installed base is already
  reachable via Bridgy Fed/RSS for zero normative words.
- **atproto** — the best exit on paper (user-held PLC rotation keys, contested departures
  actually adjudicated) and native completeness (MST), but the exit runs through a
  Bluesky-operated directory, a PDS is not static files + cron, and DAG-CBOR/MST/XRPC ends
  zero-dep. Re-run this scorecard first if "no global infrastructure" is ever relaxed.

---

## The three live candidates

| | **LOG+KEY** | **LOG+URL** | **GIT** |
|---|---|---|---|
| Identity | hash of a signed genesis event; URLs are unsigned hints | HTTPS URL, path restricted to unreserved charset (kills the §3.1 bug by construction) | repo URL + committed keys file |
| First contact | **authenticated** (genesis hash = the QR at dinner); TOFU deleted | TOFU, socially anchored in a domain | TOFU; pin = commit hash a relative can read aloud |
| Chain | one event log; spine (key events) threaded by `kprev` | same log; key subchain answers "identity chain stays small and self-keyed" (*gate: subchain-gate, 3 fetches keys-only*) | the commit DAG; linear `main`; heartbeat commits for freshness |
| Signing | compact-JWS events + blobs (*bytes-gate*) | same | git object model + ssh-ed25519 commit signatures (*git-gate: whole verifier 137 lines*) |
| Exit | **structural**: copy files anywhere, the name never changes; migration/predecessor-equivalence/recovery-pin machinery deleted (~2.9k words); recovery key only resolves post-theft forks | migration shrinks to pointer pair + recovery co-sig (~1.5–2.5k words kept); predecessor equivalence 7 sites → 3; **a root-key custodian can still contest a departure** | `git clone` = the §14 bundle, held by every relative *before* the exit; migration = new repo + predecessor pointer + recovery co-sig |
| Withholding | structural (blobs hash-addressed; `items:true` flag deleted) | same | `diff --name-status` from the pin |
| Est. normative words | **~16.5k** (~12–13k after Stage 4 rationale split) | **~14–16k** | **~5–6.5k** (git carries §5/§6/§9/§14) |
| Worst honest regressions | hash identifier (permanent adoption cost); total key loss = identity death; everything is new | keeps the exit machinery *and* its worst failure mode; non-ASCII paths unmintable; JSON Feed demoted to a view | `git` binary as trusted dependency; zero stock readers; SHA-1→SHA-256 transition must be pinned; repo semantics constrain the spec's vocabulary |

**What LOG+URL's brief established either way:** ~60% of the current spec (canonicalization, two
chains, tombstone allowlist, `items:true`, the second URL comparator, most of §9) **was never the
price of URL identity** and goes regardless of the identity decision. The identity axis is worth
~1.5–2.5k words plus one failure mode (a contested departure), against "grandma can be texted a
link, no resolver, no out-of-band hash merely to read."

---

## The decision axes (owner's call; any mix is coherent unless noted)

1. **Identity primitive** — genesis-hash (exit structural, TOFU deleted, hash identifier) vs
   URL (visitable name, migration machinery + contested-departure failure mode kept) vs hybrid
   (hash identity + signed home-URL claim rendered by UIs; ~200 extra words, most of the
   deletion kept). The gates are silent on this axis by design — it is a values call about what
   an identity *is*, and both sides' machinery now has a green gate behind it.
2. **Substrate** — bespoke events (full control of vocabulary; everything from scratch) vs git
   (5–6.5k words and a 137-line verifier; a binary dependency and repo semantics as the
   vocabulary). Note: GIT + hash-identity does not compose naturally (a repo URL is the
   identity's address); GIT effectively bundles a URL-ish identity with clone-based exit strong
   enough that the contested-departure case matters less (every relative already holds the
   archive).
3. **Delivered channel** — keep minimal (channel-gate's verdict: the ~1,000-word §10 residue
   buys the only custodian-bypassing outbound path, and the poisoning class dies) vs
   published-only (R2 completed; simpler by ~700 more words; the covert channel dies and DM
   existence becomes permanent public metadata).
4. **§15 envelope** — keep the current unreviewed construction vs evaluate the NIP-44 swap
   (audited primitives under the same blinded-tag layout). Orthogonal to everything above.

**Recommendation, held loosely:** GIT is the strongest simplicity-per-assurance buy and the only
candidate under the 8–12k target; LOG+KEY is the strongest *design* (first contact authenticated,
exit structural) at the highest adoption and rewrite cost. If the owner wants one sketch next
session, sketch GIT and carry LOG+KEY's sealed-pins + minimal-delivered-channel conventions into
it (they are substrate-independent, both gated green). If two sketches are affordable, add
LOG+KEY and let the tl;dr checker and intent map arbitrate.

## What the next session owes (PLAN.md Session A, continued)

- `SKETCH.md` of the chosen candidate(s), written small; its tl;dr through
  `node tmp/measure/tldr-check.js <file>`; published/delivered's fate in plain words.
- `tmp/redesign/intent-map.md` — all 267 test intents mapped kept / transformed (mechanism
  named) / dropped (owner sign-off flagged), using this session's per-file inventory.
- `tmp/redesign/rejections.md` finalized (draft exists; every recorded rejection answered by
  name).
- PLAN.md checkboxes updated.
