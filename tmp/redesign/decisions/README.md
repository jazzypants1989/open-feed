# Decision experiments — staging the briefs in `outside/SYNTHESIS.md`

Written 2026-08-20 while walking the owner through SYNTHESIS.md's Part I; the rows marked "review" were added 2026-08-21 by `../RULINGS-review.md` and stage the holes it found in the rulings. Each file stages the
scenario that brief's "What a gate would stage" paragraph asks for, and prints a table plus a
reading. These are **illustrations, not gates**: they have no kill criteria and `check-prototypes.js`
does not run them. Promote one to `tmp/prototypes/` if a decision comes to rest on it.

| file | brief | what it shows |
| ---- | ----- | ------------- |
| `freeze-exp.js` | A | The cousin's verdict at day 90 under the location list alone, a declared deadline, and location gossiped through interaction targets — plus the deadline's stated limit against a hub that holds the key |
| `firstcontact-exp.js` | C | A hostile hub's substituted profile is byte-valid and self-consistent; only a key obtained off the hub's path turns it into a rejection |
| `audience-exp.js` | G.1, G.2 | Against the shipped `src/enc.js`: a reply to a family-only post reaches one person without the audience sealed inside, and the whole family with it; and the real byte cost of padding the slot count |
| `recovery-exp.js` | B | Two readers, identical bytes, opposite verdicts under "peers a reader already trusts"; the same events under subject designation; glm's hash commitment and veto window; and what a new key cannot decrypt |
| `head-exp.js` | I | Five events × three head shapes, including a genuinely-signed item injected with a stolen key that only the admission rule refuses |
| `deaddrop-exp.js` | F.2 | glm's dead-drop box as **real HTTP over a socket**: a ~25-line box on the hub Grandma already has, a token-gated PUT from Alice's device, a stranger refused, and the ex's access log empty because his hub was never in the path |
| `channel-exp.js` | F | A **decision table, not a simulation** — what the ex observes and whether "I'm leaving" arrives, under four channel shapes. The measured version of the axis is `../gates/channel-gate.js` |
| `dm-metadata-exp.js` | ruling 8 (review A7, B9) | **Rewritten 2026-08-21.** Ruling 8's cost under rulings 3+4: every follower fetches every numbered file, so the correspondent is not in the log; withholding is caught by the index; a DM and a family post are the same size only with a padding *floor* (measured against shipped `src/enc.js`) |
| `scheduled-exp.js` | ruling 10 vs 3+4 (review A1) | An honest host and an honest Alice: a host-released post under gapless numbers and an author-only index reads as withheld, smuggled, or a rollback depending on what the index says; the `pending` fix makes the verdict depend on the reader's clock |
| `substitution-exp.js` | ruling 4 (review B2, D2) | The attack `index-exp.js` omitted: the host swaps #5 for a #5 stamped by a stolen-then-rotated key. Cold vs warm reader under the tiny counter, `[n,hash]`, and per-post `prev`; head sizes per *change* rather than per poll |
| `spokencode-exp.js` | ruling 1 (review B1) | Brute-forces `firstcontact-exp.js`'s code (~14.6 bits, about a second); expected time at 40/55/66 bits at the measured keygen rate; a scrypt-derived code as the other lever |
| `commitment-exp.js` | ruling 6 (review B4, B5) | The unsalted recovery-list fingerprint recovered from the family's known keys in 22 guesses; salted, not found; `.some` is 1-of-N and what an explicit `k` costs |
| `genesis-exp.js` | rulings 1 vs 6 (review A2) | Last year's link after a restore: a link over the current key refuses the real Alice; a link over the genesis id walks the succession chain and still refuses the ex |
| `theft-exp.js` | rulings 5 vs 6 (review A6) | One key on two devices, phone stolen: two valid successions from A, two valid objections, the host picks; the named recoverers as the tie-break |
| `inventory-keys-exp.js` | holistic pass 1 (2026-08-21) | The three-kind artifact inventory; the stolen-key injection closed by head admission without revocation timestamps; restore/relocation decoupled; the recovery-list rollback failing at the secret salt except after a prior restore, caught by the profile prev-hash chain |
| `inventory-head-exp.js` | holistic pass 1 (2026-08-21) | Post-signature and head-admission proven to be two different jobs; a reply to a withdrawn post false-alarming under a counter head but not a list; the split-view attack shown to require key compromise, and the pin's seq vs hash fields each earning their place |
| `headage-exp.js` | review row 4 (RULINGS §11.2) | **Built after the rulings, 2026-08-21.** `tmp/measure/headrange.js` with both of its pessimisms fixed — edits age like real edits, and the reader pays full price only when a post it had cached was touched. The flat list still loses at journal scale under any realistic edit age; the append-only head with occasional compaction wins without paging; 16-byte fingerprints halve every column |
| `targetrumor-exp.js` | review rows 5–6 (RULINGS §11.1) | **Built after the rulings.** The carried pin dropped; a reply's own target is the rumor, raised only for a number above the head's top. Strategy for strategy it catches what the pin caught; an edit stays quiet; a forgery names its forger |
| `scheduled5-exp.js` | review row 10 (RULINGS §11.5) | **Built after the rulings.** Option 5 — pending, never clock-judged, ordinary when the device next publishes — passes all four of `scheduled-gate`'s columns; the cost is a withholding uncalled until the author next publishes |
| `forkcold-exp.js` | review rows 8–9 (RULINGS §11.3) | **Built after the rulings.** The fork-point court from cold: the two branches disagree about the list, history does not help because the thief re-signs it, and only the reader who pinned the pre-fork profile names Alice |

Run all: `for f in tmp/redesign/decisions/*-exp.js; do node "$f"; done`

**Superseded helper (2026-08-21).** The `sign` / `parse` / `fileOK` one-liners in the two
`inventory-*-exp.js` files decode the signature leniently and split without checking for a
separator; `../gates/lastline-gate.md` shows what that admits. The reference for the last-line
format is `../gates/lastline.js`. The experiments are left as written — they are the record of
what was argued, and `../gates/` is where the claims became kill criteria.
