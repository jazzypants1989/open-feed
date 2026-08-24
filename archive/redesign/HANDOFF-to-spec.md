# Handoff — from the rulings to a spec that replaces the main documents

**Written 2026-08-21 by the agent that walked `REVIEW-fresh-start.md` with the owner, at the owner's
instruction, for a fresh agent. Your job, in order: (1) write the few experiments that still
separate the open choices, (2) bring each open question to the owner with the number in hand,
(3) write the new spec small, from the TL;DR down, and carry it through until it *replaces*
`open-feed-spec.md`, `README.md`, `DISTRIBUTION-MODEL.md`, `src/`, and `test/`.**

**Distrust this file.** Three handoffs before it each opened by admitting their author was wrong
(§6 records where I was). Re-run every experiment before quoting a number; they are illustrations,
and a number is stale the moment a constant moves.

## 0. Read these, in this order, before anything else

1. `tmp/redesign/TLDR-new.md` — the whole protocol in a page. Passes `tmp/measure/tldr-check.js`
   at 199 / 92 / 8. **One sentence is owed** (ruling 11.1): "It cannot drop or swap a post without a
   reader who saw it noticing, nor show two people different histories without their replies
   colliding" → "…nor show two people different histories once one of them replies to something
   the other can't see." The glossary's **pin** narrows to the head a *reader* remembers.
2. `tmp/redesign/GOALS.md` — the floor (four items) and the priorities. Fixed. Note lines 44–47:
   what is deliberately *not* a priority. Two lines are stale and wait for the fold-in: 65–70
   ("enough peers a reader already trusts", rejected by ruling 6) and 80 (item-carried pins —
   retired, then re-adopted, then rejected again; it stands as written).
3. `tmp/redesign/RULINGS.md` — rulings 1–10 from the outside review, **§11 from this session**.
   §11 is the record you are writing the spec from. Everything in it is the owner's decision except
   **§11.2 (the head's shape), which is open** — see §2 below.
4. `tmp/redesign/REVIEW-fresh-start.md` — the eight candidate gates and their findings, with a
   footer pointing at the rulings. `tmp/redesign/gates/README.md` labels every gate's substrate;
   **do not cite an old-substrate gate for a new-substrate claim.**
5. `tmp/redesign/rejections.md` — the reversal ledger. §11–13 are answered. Anything you reverse
   gets an entry *before* you build on it.
6. `tmp/redesign/decisions/README.md` — every experiment, one line each. The four from this session
   (`headage`, `targetrumor`, `scheduled5`, `forkcold`) were built *after* the rulings to check them.
7. `CLAUDE.md` at the repo root — the spec-editing rules (no line budget, keep the justification
   beside a MUST, `tmp/regen.js` after any byte-level change, no changelog, no version bump).

Run first: `npm test` (267), `npm run prototypes` (11), `for f in tmp/redesign/gates/*-gate.js; do
node "$f" || echo RED $f; done` (15), `node tmp/redesign/gates/revert.js` (18/18, ≈75 s),
`for f in tmp/redesign/decisions/*-exp.js; do node "$f" >/dev/null || echo RED $f; done` (28).
All green on 2026-08-21. **Most of `tmp/redesign/` is untracked** — ask the owner to commit before
you touch anything, so a revert has somewhere to go.

## 1. The design, as ruled (one paragraph per kind; §11 has the rest)

**Profile** — signed by the current key, fixed path, overwritten under compare-and-swap, `pseq` +
`prev`-hash so a rollback is a visible fork. Names the genesis key, the current signing key and a
separate X25519 reading key, location(s), and the succession chain from genesis: hops are a
*rotation* (signed by the previous key) or a *restore* (vouched by members of the committed
recovery list). The list is committed as **per-member leaves** `H(salt_i || key_i)` with threshold
`k` and the leaf count in the clear; a voucher reveals only its own salt. A restore changes the
key and nothing else. A contest (two valid profiles at one `pseq`) is settled by a **majority of
the list as it stood at the split**; only a reader that pinned the pre-fork profile can run that
rule; cold readers show "contested." Apps SHOULD name at least one recoverer; the owner's own
backup key counts. The reading key is not socially recoverable. Seven-day "recently restored" is UX.

**Head** — signed by the current key, fixed path, CAS, `hseq` + `prev`. Lists every live post as
`[n, hash]` and every photo/attachment the posts reference; the live set *is* the list; admission
= the head lists the post's hash. A `pending` entry (a scheduled post) is never convicted on a
reader's clock and becomes ordinary when the device next publishes. **Shape open** (§2): flat
list vs append-only-with-compaction; 32- vs 16-byte hashes.

**Post** — immutable, signed by a chain key, addressed by the hash of its *body*. Numbered,
create-once at the host (ruling 3), gapless; numbering is load-bearing (create-once and the
"above the top" rule both depend on it). A reply/reaction/DM is a post with a target
`(author genesis, n, hash, location)`; `supersedes` is one more relation type; an edit posts the
new number and withdraws the old; a DM is a post sealed to one. **No carried pin.** A reader that
sees a reply to a number above the top of the head it holds re-fetches and, if still short, says
"X replied to something I can't see" — a rumor naming X, never an accusation.

**Signing** — body bytes, one `\n`, then exactly 86 base64url characters that re-encode to
themselves (MUST). Address = hash of body (MUST; some libraries randomize Ed25519). Producer MUST
NOT emit duplicate members / `__proto__` / integers past 2^53 / lone surrogates; reader SHOULD
reject. No canonicalization anywhere. A signed DM is non-repudiable, stated.

**Everything else** from GOALS/RULINGS 1–10 stands: identity = genesis key, links and scanned
codes carry it; pull only; three tiers on one envelope with the audience sealed inside; the app
keeps the stamped bytes of what it publishes; the host serves exact bytes and allows cross-origin
reads; the contact list is the app's.

## 2. Open — the owner's rulings still owed, each with the experiment that should precede it

Ranked by how much of the spec text waits on each.

**A. The head's shape** (RULINGS §11.2; the owner stopped here). `decisions/headage-exp.js`
shows: the review's "collapse" reproduces only with both of its modelling flaws, **and fixing
them does not rescue the flat list** at the journal scale (100k posts, 10k daily readers, 5%
withdrawals): 14% of always-full when edits land within the hour, 65% at a one-day half-life, 75%
at a week. The append-only head — a withdrawal is an appended `[n, null]`, the author rewrites the
file occasionally — costs 0.01 TB/year rewriting once a decade or 0.59 TB rewriting monthly,
against 17.7 TB always-full; the owner has accepted a *temporary* trace. 16-byte hashes halve every
column. At family scale every shape is noise. **Build before asking:** a candidate gate for the
append-only head — the live set as a fold, admission under the fold, a reader-relative tail, a
compaction as a visible full rewrite that still verifies, the `prev` chain across a compaction, and
what a pinned reader sees when a retraction line is *removed* by a hostile host (it cannot be — the
file is signed — but prove it). Then put four options to the owner: append-only monthly /
append-only when noisy / flat list with a stated scale / paged. Do not recommend paging; nothing
measured needs it.

**B. Hash width in the head.** 16-byte prefixes suffice for admission (second-preimage only) and
halve the head. Price the one cost: a reply's target carries the full 32-byte hash and the head
carries a prefix, so "listed" is a prefix match — write the row that shows no two live posts can
share a prefix by accident at any scale tried, and that a stolen old key cannot mint a collision.

**C. The publish interface** (GOALS "still open" 1; ruling 3 + 5). Signed PUT at conventional
paths, CAS on the two fixed-path files, create-once on numbered files, first-come naming with the
profile as proof, host MAY check stamps. `gates/writer-gate` proved CAS on the *old* substrate.
**Build:** a port to `lastline.js` over real sockets (`test/helpers/site.js` is the only real
transport harness; it is `node:test`-bound) — two devices racing on the head and on a number, a
host that checks stamps, a host that does not. This is scenario 6's "dumb hub."

**D. The spoken code** (`decisions/spokencode-exp.js`: ~14.6 bits as written, brute-forced in a
second). Decide between 5–6 words from a 2,048-word list (55–66 bits) and a slow hash. A UX
ruling; one experiment row on the keygen rate is already there.

**E. The envelope** (commissioned twice, never run). The current `src/enc.js` construction against
an HPKE/NIP-44-shaped one — X25519 + ChaCha20-Poly1305 + HKDF, padded — keeping the blinded
per-recipient slot tags and the sealed audience, **with test vectors**. Include the padding
*floor* (`decisions/dm-metadata-exp.js`: a DM must be the size of a family post), not just
power-of-two slot padding. Two outside models said the library is not the question, only the
construction shape. Scope it to that and stop.

**F. Time discipline.** One list: every place a clock appears in the ruled design (the seven-day
flag; a scheduled post's own stamp; "served early"; nothing else should be on it), each marked
UX. The rule stays: a wall clock never gates a security verdict.

**G. Reader states.** Count them from the rulings. Target is three (fine / this host is
misbehaving / identity in question). Rumors and hints are not states. `contested` and
`recently restored` are the two recovery adds; `pending` is an entry flag, not a state. If you
find yourself at five, something above is wrong.

**H. The weekend.** The minimality measure that has never been taken on this substrate: write
the *whole* reader — profile walk, head, admission, posts, the target rumor — in one file from
the TL;DR and count the lines (git-gate's 137 is the bar). Then the publisher. If either needs a
thing the TL;DR does not say, the TL;DR is wrong, not the code.

**I. Interop** (GOALS priority 3, scenario 7). The generated JSON Feed / Atom view and h-card from
the head + posts; a plain feed reader consumes it; nothing signed in it. One experiment.

**J. Two hubs, one thread** (scenario 3) on the new substrate over real sockets: a family-only
post, a sealed reply, a reaction, across two origins, the *unchanged* verifier reading both. This
is the e2e that `test/e2e.test.js` is for the old spec.

Smaller, unruled, from `rejections.md` §10: the conformance-level taxonomy (levels vs roles —
the design suggests *roles*: publisher / reader / hub, no levels); §2.1's token vocabulary
meta-rule (likely dissolves — no JSON Feed namespace to defend); the archive/rotation successor
(answered by A if append-only wins).

## 3. The path to the spec — stop points marked ⏸

1. **Experiments for A–C** (§2), each in `decisions/` house style: plain comments, a table, a
   reading, a printed revert-check; `< ~120` lines; imports `../gates/lastline.js`. Promote to
   `gates/` with kill criteria + a `revert.js` row when a ruling comes to rest on one. ⏸ Bring A
   and B to the owner together with their numbers.
2. **`tmp/redesign/SKETCH.md`** — written *small*, from `TLDR-new.md` down: the three kinds'
   schemas as JSON with every field justified in one clause, the reader's order of operations
   (profile chain → head → posts; the target rule; the contest rule), the publish interface, the
   envelope, the generated views. Every section points at a GOALS line or a RULINGS item or is
   cut. ⏸ Owner reads it before any spec text exists.
3. **D–J** as they come up while writing; each is a short ruling, not a redesign.
4. **`tmp/redesign/intent-map.md`** (owed since `CANDIDATES.md`): the 267 test intents in
   `test/` mapped kept / transformed (mechanism named) / dropped (owner sign-off flagged). Most
   of §5/§6/§9/§10/§14 intents drop *with their mechanism*; say so per file, not per test.
5. **The spec.** Write `open-feed-spec-2.md` beside the old one, not over it, until the owner says
   swap. RFC 2119; the justification stays beside each MUST; no archaeology; Appendix B vectors
   generated by a new `tmp/regen.js` that self-verifies last-line files (the old one canonicalizes
   — it cannot be reused). `tmp/rules.js` counts keywords; keep it honest.
6. **`src/`** — a rewrite, not a patch. Keep the module discipline CLAUDE.md records: one module
   opens sockets; the verifier composes the order (profile, head, posts); the export module stays
   deleted (the app always had the copy). Expect ~half the modules and far fewer tests.
7. **README / DISTRIBUTION-MODEL / CLAUDE.md** last. CLAUDE.md's table shrinks; its rules do not.
8. ⏸ **The swap.** `git mv` the old spec to `tmp/archive/open-feed-spec-0.1.md`; the new one
   takes the name; version stays 0.1.0 — draft, unreleased, no bump (CLAUDE.md).

## 4. Procedure — the campaign's standing rules, unchanged

- **Question everything, including this file.** Reversals answer the recorded reasoning in
  `rejections.md`. The floor and §13.2's hostile custodian are fixed; everything else reopens.
- **Doubt with code.** An objection with a runnable experiment beats ten of prose. Every
  assertion revert-checked — turn the defense off, watch the attack land, print it.
- **Re-derive before acting on a number.** `decisions/` are illustrations; `gates/` carry kill
  criteria; the old-substrate gates prove conventions, not the new head.
- **Plain language with the owner.** The owner asked for every open question in plain words,
  one at a time, with full context, no jargon, no stacked acronyms — and answered faster for it.
  A recommendation marked as such, then the question. Never "should I proceed?"
- **Do not touch** `src/`, `open-feed-spec.md`, or `GOALS.md` until step 5 of §3, and then beside,
  not over. `npm test` and `npm run prototypes` stay green throughout — a red there means you
  edited something the old spec still owns.
- **No files in the harness scratchpad; no reads outside the repo.** `tmp/` for everything.

## 5. Where things are

| path | what |
|---|---|
| `tmp/redesign/TLDR-new.md` | the design in a page; one sentence owed (§0.1) |
| `tmp/redesign/RULINGS.md` §11 | this session's rulings; §11.2 open |
| `tmp/redesign/REVIEW-fresh-start.md` | the eight-gate review, findings untouched, rulings footer |
| `tmp/redesign/gates/lastline.js` | the *reference* for the new substrate: strict decode, hash-of-body, `parseStrict`, head, chain, CAS store. Every new gate imports it |
| `tmp/redesign/gates/*-gate.{js,md}` + `revert.js` | 15 gates on two substrates (README labels which); 18 revert rows |
| `tmp/redesign/decisions/*-exp.js` + `README.md` | 28 illustrations; the four from 2026-08-21 check §11 |
| `tmp/measure/headrange.js`, `tldr-check.js` | the review's head measurement (both flaws noted in `decisions/headage-exp.js`); the TL;DR budgets |
| `tmp/redesign/CANDIDATES.md`, `HANDOFF-stage3.md`, `HANDOFF-fresh-start.md` | the lineage: LOG+KEY is the ancestor; read §4 of the fresh-start handoff for the failure mode to avoid (re-accepting the old skeleton) |
| `tmp/redesign/outside/SYNTHESIS.md` | the six outside models' briefs A–K that rulings 1–10 answer |
| `tmp/redesign/SKETCH-rejected-2026-08-19.md` | what "basically the same thing with tiny tweaks" looks like; do not produce another |

## 6. What I got wrong this session — so you do not inherit it

- I predicted that realistic edit ages would flip the review's head-growth verdict. They do not
  (§2.A). The flaw I found in the model was real; the conclusion I drew from it was not. The
  append-only shape is what changes the answer, and the owner has not yet chosen.
- I argued the 100k-post journal was out of scope. The handoff had asked for that exact number
  and GOALS scenario 7 names a public journal. The scale is fair; only the model was not.
- `splitview-gate.md`'s "0 of 511" counted the author echo. Readers alone: 44 of 511, under the
  pin and under the target alike (`decisions/targetrumor-exp.js`). The card is not wrong; it is
  easy to misread.
- I nearly recommended "whoever still holds the key beats a vouched restore" as the fork rule.
  Under ruling 5 a stolen phone means the thief holds the key; he would veto the real restore.
  The owner saw it put to rest in writing; keep it rested (RULINGS §11.3).
