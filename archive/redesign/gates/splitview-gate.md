# splitview-gate — does the split-view detector cover what it claims?

**Candidate gate** (tests the fresh-start design on trial; see `../HANDOFF-fresh-start.md` §3
claim 3 and `decisions/inventory-head-exp.js` Issue 5). Substrate: `lastline.js`; the hubs are
real `node:http` servers for the socket rows.

**Question.** TLDR-new promises the host "cannot show two people different histories without their
replies colliding." Issue 5 shows the mechanism in one process: a reply carries the pin
`(hseq, hash)` of the target's head as the replier saw it; a reader seeing a higher pin re-fetches
and names withholding; the same hseq with a different hash is a fork. Staged across hubs, which
fork classes does it miss, and what can a lying *replier* do with it?

**Method.** Three hubs — HOSTILE (hosts Alice, mom, cousin), OUTSIDE (jesse, and the ex with his
own valid key), HONEST (Alice, for the forgery rows). A hub serves each reader the newest head
under a per-(reader, author) cap, and only the posts that head lists. Readers pin verified
heads, check the highest pin per author once per poll, and every participant replies to every
author it follows carrying the pin it holds. Rows 1–4 run over sockets with the access log as
proof of path; the strategy enumeration (63 cap maps for the captive family, 511 with an
outsider) and the forgery rows run in-process through the same hub code. The "author echo" —
Alice noticing a pin about herself lower than her own head — is scored against her hseq before
the reply round, which the simulation knows and a real reader does not.

**Numbers** (stale if the reader rules, the participant set, or the reply topology change):
- F1 over sockets: the capped cousin reads mom's pin from OUTSIDE's socket and names HOSTILE.
- **Uniform stale** (everyone but Alice capped at 40): all readers agree, no verdict, Alice's
  seven CAS writes all land. The only signal is the echo, read by her own device off OUTSIDE.
- Captive family, no outsider: **4 of 63** strategies escape readers and echo — each isolates one
  member in both directions (e.g. cousin sees Alice and mom stale, Alice and mom see cousin
  stale) or everyone pairwise. 28 of 63 escape the readers alone.
- One interacting outsider, cousin follows him: **0 of 511** escape. The same outsider, cousin not
  following him: 1 of 511 escapes. The path does the work, not the pin.
- Forged pin `(999, junk)` about Alice on an honest host: the naive rule convicts the honest host
  of WITHHELD. `(47, junk)`: the naive rule reports a **FORK** — an honest Alice reads as
  compromised. Two fields in a reply anyone can sign.
- Repair A (a pin is a hint; convict only on a verified head): both forgeries become
  `unverified-claim` — and so does the genuine F1 case, because nobody can hand cousin head 47.
- Repair B (the head's signature covers `hseq\nH(body)`, so `(hseq, hash, sig)` verifies alone):
  the forgery names the replier, F1 convicts HOSTILE again. Signing the hash alone is not
  enough — `(999, h47, sig)` then verifies. Pin cost ≈ 150 B vs ≈ 60 B.
- Griefing: 1,000 pins above the known hseq in one poll cost one re-fetch.
- Sealed replies: withholding one is the same cap entry as withholding any reply; no new class.
- Detection latency with jesse replying every D days and cousin polling him daily: 1.0 / 2.0 /
  4.0 / 15.5 days for D = 1 / 3 / 7 / 30; all-captive: never.

**Kill criterion.** A strategy with one interacting outsider and a social path to the stale
reader that neither the reader rule nor the echo flags; a forgery that either repair fails to
neutralize. **Not triggered.**

**Revert-checked** (`revert.js`): the hub ignoring the reader (no attack is possible, so the F1
and enumeration rows go red — the staging is real); repair B skipping the pin signature; repair A
convicting on the pin alone.

**Verdict.** Issue 5's mechanism works exactly where it says — against an honest-but-hostile host
and between readers who interact across a hub the host does not control. Three things it does
not say: (1) **the detector is floor item 4 and bring-your-own-client doing the work** — a captive
family detects nothing, and a hub-served web app that proxies mom's fetch of jesse's feed kills
the echo too; (2) **uniform stale is undetectable by readers by design** — the echo is a freshness
judgement ruling 7 retired, and to a real author a low pin is indistinguishable from honest lag,
so it can only ever be UX; (3) **the pin as specified is a forgery vector**: two unverifiable
fields let any replier make an honest host read as withholding or an honest author read as
forked. Repair A keeps the pin but demotes every verdict it produces; repair B keeps the verdicts
by changing what the head signs — which reopens `lastline-gate`'s bytes question for the head and
should be decided together with it. The owner must choose one; the naive rule is not shippable.

**Run:** `node tmp/redesign/gates/splitview-gate.js` (≈16 s)
