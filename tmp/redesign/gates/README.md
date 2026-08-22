# Candidate gates — two substrates, do not mix them

Every gate here tests a design **on trial**, never shipped `src/` (those live in `tmp/prototypes/`).
A gate is `<name>-gate.js` + a verdict card `<name>-gate.md` (Question · Method · Numbers with
"stale if" · Kill criterion · Revert-checked · Verdict · Run). Exit 0 when every claim holds, exit
1 naming the one that did not. Revert-checks are rows in `revert.js`; `node tmp/redesign/gates/revert.js`
re-runs all of them (≈3 min, most of it `splitview-gate`).

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
| `aohead-gate` | §11.2 | The append-only head keeps every reader rule the flat list has: the live set as a fold, a tail that survives a withdrawal, a compaction that is visible, chained and checkable — and it surfaces the hole **both** shapes have, that withdrawing the newest post turns a reply to it into a rumor unless the head declares `top` |
| `pubif-gate` | §2.C | The publish interface over real sockets: a forced two-device collision on the head, a replay that buys nothing without any account existing, and the finding that **create-once and "the host MAY check stamps" do not compose** — a griefer burns Alice's numbers permanently on a hub that does not check, repaired by letting the owner reclaim a number held by a file that is not hers, which works only because a post declares its own number |
| `weekend-gate` + `weekend-reader.js` + `weekend-publisher.js` | §2.H, §2.G | The whole reader (**161 lines**) and publisher (**50**) written from the TL;DR with the standard library alone, driven over a socket through thirteen moments. **Exactly three reader states.** Three sentences the TL;DR did not say: the head must be signed by the *current* key, an unverifiable head is not an accusation, and the rumor rule needs two bounds or it is a griefing amplifier |
| `kinds-gate` | 5 | Edit in place is indistinguishable from a compromised-key rewrite and reopens ruling 3's race; an edit is a new number; a photo is a fourth, unsigned, file kind |
| `envelope-gate` | final §2.A | The HPKE-shaped envelope built and run: one ephemeral, blinded 83-B slots, audience inside, a padding floor that makes a DM the size of a family post, three reproducible vectors; a sealed post through the unchanged reader is ok with the field opaque; and **the lifted-envelope attack is alive unless the carrier (author key + number) is AAD** — SKETCH §9's "carrier binding goes" is wrong as written |
| `twohubs-gate` | final §2.B | Floor item 4 over two hostile hubs with the reader unchanged: a sealed thread crosses origins with nothing but GET and If-Match, neither operator reads it, the cross-hub rumor fetches the author's hub, a reader follows a relocation through a reply's `at` (which is also a one-hit beacon); the target of a sealed post should go inside the envelope; **a new identity with no head reads as a misbehaving host**, and `read()` must return the verified `read` key or sealers seal to the host |
| `gapless-gate` | final §2.C | Numbering under failure: a crash burns one number and reads as nothing; a device that comes back must abandon, never list late, because the same reader check catches the custodian backdating; `top` tells the truth through a reclaim; **the publisher needed the fold** (the rewrite was confirming every pending post) and **the pin needed the pending flag**; withdrawal is not deletion and there is no verb that is |
| `court-gate` | final §2.D | The contest rule inside the composed reader: **as written, a thief with a rotated-out key who picked a higher `pseq` was followed by every reader**; the court takes 18 lines and needs the pinned chain and the first list seen per chain length; a restore carries the list it satisfied; majority is the only rule under which a listed adversary never wins alone; a cold reader's court is whatever its first profile carried |
| `media-gate` | final §2.E | The fourth file kind end to end: `[hash]` lists a photo, 48 B, withheld and swapped are both `host`, withdrawal is not deletion, a sealed post's photo is ciphertext at a listed hash; **a griefer's junk at her hash makes her own readers accuse her host** unless the hub replaces a file that does not hash to its name — §12.5's content-addressed twin |

**`envelope.js` is not a gate.** It is the §7 envelope, lifted verbatim out of `envelope-gate.js`
once the construction stopped being on trial, so the gate and `tmp/regen2.js` (which generates
`open-feed-spec-2.md`'s Appendix B) share one implementation. Its three revert rows live in
`revert.js` under `envelope-gate` and point at this file.

Run all: `for f in tmp/redesign/gates/*-gate.js; do node "$f" || echo "RED: $f"; done`
