# Candidate gates — two substrates, do not mix them

Every gate here tests a design **on trial**, never shipped `src/` (those live in `tmp/prototypes/`).
A gate is `<name>-gate.js` + a verdict card `<name>-gate.md` (Question · Method · Numbers with
"stale if" · Kill criterion · Revert-checked · Verdict · Run). Exit 0 when every claim holds, exit
1 naming the one that did not. Revert-checks are rows in `revert.js`; `node tmp/redesign/gates/revert.js`
re-runs all of them (≈75 s, most of it `splitview-gate`).

**The substrate matters.** A green gate proves something about the construction it imports.
Citing a gate from one substrate for a claim about the other is the mistake
`HANDOFF-fresh-start.md` §2 warns about.

## Old substrate — `lib.js`: compact-JWS events, content-addressed tokens, checkpoints (2026-08-19)

The LOG+KEY / LOG+URL / GIT candidates of `CANDIDATES.md`. What transfers to the new substrate is
the *convention*, not the number: bytes-gate's strict-spelling rule, sealed-pins' idea, writer's CAS.

| gate | one line |
|---|---|
| `bytes-gate` | Encoded-payload signing deletes canonicalization: 2,635 byte mutations, 0 verify, under a strict-spelling rule |
| `log-gate` | One append-only log + checkpoints at family scale; first contact 1.1 MB / 4 fetches |
| `subchain-gate` | A sparse self-keyed key subchain inside the content log; keys-only read = 3 fetches |
| `writer-gate` | CAS appends serialize racing devices; authorship in the blob, ordering in the entry |
| `sealed-pins-gate` | Pins ride inside encrypted content with zero public reading-graph bytes |
| `channel-gate` | The delivered-channel axis priced; keep a minimal delivered channel |
| `git-gate` | Open Feed as a git repo convention; the whole verifier is 137 lines |

## New substrate — `lastline.js`: last-line signed files, the `[n, hash]` head, the profile chain (2026-08-21)

The fresh-start design of `TLDR-new.md`, attacked per `HANDOFF-fresh-start.md` §3. Findings are
collected in `../REVIEW-fresh-start.md`.

| gate | claim | one line |
|---|---|---|
| `lastline-gate` | 1 | Body and separator: 1,544 mutations, 0 verify. Signature line: **638 distinct files verify** under the lenient decoder every experiment uses — the strict-spelling rule was lost in transit |
| `headrange-gate` + `tmp/measure/headrange.js` | 2 | Tail reconstruction is sound and a wrong one is always detected; the scaling story **collapses at e=5%** (79% of always-full at journal scale) and rests on an edit rate nobody stated |
| `persig-gate` | 6 | Admission and the per-post signature do different jobs; the signature is <1% of head traffic beyond family scale; a signed DM is non-repudiable |
| `splitview-gate` | 3 | Over sockets. 4 of 63 captive strategies undetected, 0 of 511 with an interacting outsider; **a forged pin makes an honest host read as withholding or an honest author as forked**; two repairs priced |
| `salt-custody-gate` | 4 | No salt custody both restores Grandma and blocks a listed member; under the model where Grandma gets in, Issue 4's premise is false; the per-member leaf is the repair |
| `forkcourt-gate` | 4 | The contest never settles, k=1 is met on both sides, a restorer relocates inside the window, a key-holding thief gets zero days; the fork-point court is the rule that works |
| `scheduled-gate` | A1 | 0 of 4 host-release options are admissible, collision-free, early-visible, and clock-free at once |
| `kinds-gate` | 5 | Edit in place is indistinguishable from a compromised-key rewrite and reopens ruling 3's race; an edit is a new number; a photo is a fourth, unsigned, file kind |

Run all: `for f in tmp/redesign/gates/*-gate.js; do node "$f" || echo "RED: $f"; done`
