# Handoff — the fresh-start design, for a skeptical review

**Written 2026-08-21 by the agent that helped the owner converge it, at the owner's instruction,
for a fresh agent. Your job is to doubt this, then write code that makes the doubt reproducible —
not to implement it.**

## 0. What this is, in one breath

Walking the owner's `RULINGS.md` (its decisions on `outside/SYNTHESIS.md`) turned up conflicts
*between* rulings that the per-decision experiments could not see. Resolving them, the design walked
back to the shape `CANDIDATES.md` called **LOG+KEY** — which was never rejected, only bypassed when
`GOALS.md` reset to goals-first (see §4). It now fits a TL;DR under the same checker the main spec's
passes (`tmp/measure/tldr-check.js tmp/redesign/TLDR-new.md`, three budgets green, zero RFC 2119
keywords). The owner thinks this is the most promising start in a while and wants it attacked before
believing it.

**Do not trust the paragraph above. Verify every claim in it before building on it.** The prior two
handoffs each opened by telling you their author had been wrong; assume the same here.

## 1. The design as it currently stands

Read `tmp/redesign/TLDR-new.md` first (it is the whole protocol in a page), then this.

**Three signed file kinds, plus one generated view** (`inventory-keys-exp.js` prints the table):

- **profile** — signed by the current key, at a fixed path, overwritten under compare-and-swap.
  Names current keys (a signing key and a separate X25519 reading key), location(s), a recovery
  commitment, and the **succession chain**: hops from the genesis key to the current one, each hop
  either a *rotation* (signed by the previous key) or a *restore* (a k-subset of a committed
  recovery list vouches). Carries `pseq` + `prev`-hash so rollbacks are a visible fork.
- **head** — signed by the current key, overwritten under CAS. A sequenced (`hseq`) list of
  `[number, hash]` for every live post. The live set *is* this list. Withdrawal removes a line;
  nothing records that a post existed (satisfies `GOALS.md:75`). Intended to be range-fetchable
  (sorted, append-stable, signature on the last line).
- **post** — immutable, hash-addressed, signed by a chain key. A reply/reaction/DM is a post naming
  a target by `(genesis, number, hash, location)` plus a **pin** `(hseq, hash)` of the target's
  head as the author last saw it. A DM is a post sealed to one recipient.

**Signing: last-line.** A signed file is its JSON bytes, one `\n`, then the base64url Ed25519
signature over those bytes. Verify = split at the last `\n`, check, then parse. No canonicalization.
Chosen over compact-JWS for a smaller verifier and a readable wire (the owner ranks weekend-
implementability and zero-dependency above wire opacity).

**Identity = the genesis key** (or its hash). Links, scanned codes, and the pin's target-key all
name the genesis; a reader walks the chain to the current key. This is what makes a link survive a
key change (`genesis-exp.js`).

**Admission.** A post is Alice's only if the current head lists its hash. Free (the head is already
a hash list), and it is what closes the stolen-key hole without revocation timestamps.

**Recovery.** A named list, committed as `H(secret salt || full member set)` with a threshold `k`
(default 1) in the clear; the salt stays secret until a restore reveals `{salt, members}` and a
k-subset signs. A restore changes the key only; relocation is a later, separate profile version by
the new key. The same list is the court for the two-devices-one-key fork (`theft-exp.js`).

**Everything else** from `GOALS.md`/`RULINGS.md` stands: pull-only; three encryption tiers on one
envelope with the audience sealed inside; the owner's store retains what its head declares.

## 2. What is settled, and the runnable evidence (verify each before trusting it)

Run any of these: `node tmp/redesign/decisions/<name>-exp.js`. They are **illustrations, not gates**
(no kill criteria, not run by CI) — treat them as arguments with code attached, and re-run before
relying on a number. The revert-checks inside them (turn a defense off, watch the attack land) are
the part worth trusting.

- **Last-line signing is viable, admission and per-post-sig are distinct jobs** — `inventory-head-exp.js`
  (Issue 2: injection lands with admission off; a withdrawn post stays provable only via its own sig).
- **The stolen-key injection is closed at the author's location without revocation timestamps** —
  `inventory-keys-exp.js` (Issue 1).
- **Restore/relocation do not conflict once the hop carries no location** — same file (Issue 3).
- **The recovery salt defends enumeration and naive rollback; the residual needs a prior restore and
  is caught by the profile prev-hash** — same file (Issue 4), and `commitment-exp.js` (unsalted list
  recovered in 22 guesses; salted, not).
- **The split-view attack requires key compromise; the pin's seq vs hash fields defend different
  adversaries** — `inventory-head-exp.js` (Issue 5).
- **The list head beats the counter** — `substitution-exp.js` (the counter passes a stolen-key
  substitution to cold readers), `inventory-head-exp.js` Issue 6 (the counter false-alarms on a
  reply to a withdrawn post).
- **Genesis identity survives a restore where a current-key link does not** — `genesis-exp.js`.
- **First-contact needs a key learned off the host's path** — `firstcontact-exp.js`; and the spoken
  code as written is ~14.6 bits, brute-forced in under a second — `spokencode-exp.js`.

`CANDIDATES.md` + the seven cards in `gates/` are the LOG+KEY ancestor and its gates. **Caveat that
matters: those gates ran on the OLD substrate** (hash-addressed events + checkpoints, per-item URLs).
They prove the *substrate-independent* conventions (bytes-gate → last-line's malleability argument;
sealed-pins-gate → the pin idea; writer-gate → CAS multi-device). They do **not** prove the new
`[n,hash]` list head. Do not cite them as if they did.

## 3. The load-bearing claims to attack — each is falsifiable, each wants a gate

A real review breaks these or promotes an experiment to a gate (`tmp/prototypes/`, kill criteria,
revert-checked). Ranked by how much rests on them:

1. **Last-line signing is as safe as compact-JWS.** Argued (same base64url malleability, no
   re-serialization), never swept. *Write* a bytes-gate analog for the last-line format: every-byte
   mutation × the split point, a signature-spelling variant that decodes identically, and the
   "helpful host" transforms from `writing-exp.js` (pretty-print, CRLF, BOM, key-sort) — assert zero
   verify. If any honest-host transform survives, the readable-wire choice is in question.
2. **The head is cheaply range-fetchable and that tames its linear growth.** Asserted with mental
   arithmetic. *Measure*: a real serializer's append-stability, the per-post range delta, the
   full-fetch fallback rate at a 5% edit rate, and the public-journal case (10k followers, 10 years,
   100k posts) — the number I never ran. If range-fetch does not hold under a real JSON serializer,
   the list head's scaling story collapses to the counter's size objection.
3. **The split-view detector actually covers what it claims.** `inventory-head-exp.js` shows the
   mechanism in one process. *Stage it cross-hub over real sockets* (as `e2e`/`reader` tests do):
   two families, a hostile host serving stale to one, gossip via a real reply, detection latency as
   a function of interaction frequency. Find the fork class it misses.
4. **Recovery-as-the-fork-court is coherent and safe.** New this session, ungated. *Attack*: the
   veto window against a determined restorer who also holds a device; "restore changes key only"
   against an attacker who relocates one version later; the contested state's interaction with the
   two-devices-one-key fork (`theft-exp.js`) and with cold readers who never saw the contest.
5. **Three kinds really cover every operation.** Find one that does not fit — a board/aggregation
   view, a follow, a mute, a profile-picture blob, a scheduled post (see §5, item A1).
6. **Admission + per-post-sig is the right split, not head-only-sig.** The owner leaned "keep
   per-post sig for archive portability." *Price the alternative honestly*: head-only signing size
   at scale vs the deniability/portability it trades.

## 4. Why this is not the sketch that was rejected on 08-19

The `SKETCH-rejected-2026-08-19.md` kept the current spec's sixteen sections, URL identity, the
manifest, and the export triad, and called a re-encoding of the manifest map "a log." The owner's
verdict was *"basically the same thing with tiny tweaks."* What came *after* it the same day was
`CANDIDATES.md` (three genuinely different architectures, seven green gates) — **that** was the log,
and it was never rejected. `GOALS.md` then reset to goals-first and landed on "a signed, sequenced
head," a softer thing than the log, never compared against it. This design admits the head is a log
and picks up what the candidate had worked out (genesis first-contact, the key subchain, CAS
multi-device). If you find yourself re-accepting the sixteen-section skeleton, `src/` as gravity, or
the 267 tests as intents-to-preserve, stop — that is exactly the failure mode `HANDOFF-stage3.md`
records.

## 5. Genuinely open — the owner still owes rulings on these

- **A1 (scheduled posts).** `scheduled-exp.js` shows host-released scheduling cannot coexist with
  gapless numbers + author-only head without a clock-gated verdict. Recommendation on the table:
  drop host release (device posts at time or late). **Owner has not ruled.**
- **The contact list** (kimi's, `SYNTHESIS.md` brief K). Recovery list, gossip scope, and reply
  audience are all defined over "your contacts," and nothing says what a contact is on the wire,
  where the list lives, or how it survives phone loss. Largest un-designed hole.
- **Time discipline** (glm's). The veto window and a "recently restored" flag use wall clocks;
  the rule is "wall clock never gates a security decision." Write once which verdicts are UX and
  which are security.
- **Reader states.** Count them (the review's D3): fine / this-host-misbehaving / identity-in-
  question is the target; the current set is drifting back toward the lattice `GOALS.md:80` retired.
- **Spoken-code bits** (`spokencode-exp.js`): pick 5–6 words from a 2,048-word list, or a slow hash.
- **Encryption**: the NIP-44 evaluation is still commissioned; the padding *floor* (not just
  power-of-two, so a DM matches a family post — `dm-metadata-exp.js`) is a new recommendation.
- **Under the list head, numbering is no longer load-bearing** (the hash admits the post); "a post
  declares its own number" drops from a MUST to a convenience. Confirm.

## 6. Procedure (the campaign's standing rules)

- **Question everything, including this file.** Reversals answer the recorded reasoning in writing
  (`rejections.md` is the ledger). The floor (`GOALS.md` "What it must do") and §13.2's hostile-
  custodian adversary are fixed; everything else is reopenable.
- **Doubt with code.** An objection with a runnable experiment (house style: plain-language comments,
  a table, a reading, a revert-check) is worth ten of prose. Promote one to `tmp/prototypes/` with
  kill criteria when a decision comes to rest on it.
- **Re-derive before acting on a number.** Every `-exp.js` is illustrative; the gates' numbers are on
  the old substrate.
- **Do not touch** `src/`, `open-feed-spec.md`, or `GOALS.md` without its own justification — this is
  still design, not implementation. `npm test` and `npm run prototypes` stay green (they cover the
  *current* spec, which is untouched; a red there means you edited something you should not have).
- **The deliverable when the axes settle** (owed since `CANDIDATES.md`): a `SKETCH.md` written small
  from `TLDR-new.md` down through the three kinds' schemas; a fresh gate set for the new head;
  `rejections.md` finalized; the owner's open rulings in §5 closed.
