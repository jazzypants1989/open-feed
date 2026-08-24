# coldcourt-gate — the court at a chain length the reader never observed

**Review gate** (2026-08-23 skeptical review of `open-feed-spec-2.md`, finding A1). Substrate: the
weekend reader and publisher, unchanged, over a loopback socket against `hub.js` (§9 as written).

**Question.** §4.6 keeps a court per chain length — "the first recovery list the reader ever saw at
that length" — and §8.1 step 5 records one for every length a profile carries a list for. A
rotation hop carries no list. So what does a reader hold at the lengths *below* the one it met
Alice at, and who can fork there?

**Method.** Alice at chain `[G, K2, K3]` (two rotations), a list of three with the ex on it. A
reader pins her there. The ex — holding his own key and **nothing of hers** — copies her public
rotation hop and forks at index 2 (and, separately, at index 1, from the genesis itself) with a
restore to his own key, vouched by himself, carrying a court of one. Then Alice's real profile is
served again, at her `pseq` and at a higher one. Then the same self-vouched restore at index 3,
the one length the reader does hold a court for. Then the rule as a pure function under four
modes, with Alice's remedies and what a hijacked reader does with them.

**Numbers** (stale if the reader's court lines or §4.6 change):

| | as written | guard only | every hop carries its list | + unified hop |
|---|---|---|---|---|
| forger at index 2 | **FOLLOWED** | contested | contested | contested |
| forger at index 1 | **FOLLOWED** | contested | contested | contested |
| her 2-of-3 restore at 2, then the forger again | followed → rejected | contested → **contested** | followed → rejected | followed → rejected |
| vouchers added to her existing K2→K3 hop | — | — | — | accepted → forger rejected; **K3 and its posts survive** |
| her restore, at a reader already hijacked | **rejected forever** | (no hijack) | (no hijack) | (no hijack) |
| bytes per rotation hop | 164 | 164 | 329 | 329 |

Over the socket, as written: the pinned reader **follows the forger at index 2 and at index 1**,
and thereafter reports Alice's real profile as `host: serves a branch the court rejected` — at her
`pseq` and at a higher one. The restore hop is never signed by the key it replaces, so the forger
needed no key of hers. §4.6's "only a reader that pinned before the split can run the rule
correctly" and §14.1's "what a reader already verified is pinned, and he cannot alter it" are
false as written.

**A second hole, found by the control row.** The same self-vouched restore at index 3 — where the
reader *does* hold the real court — is **followed too**: it extends the pin, so no split and no
contest; the chain walk (§8.1 step 3) judges the hop by the court it carries. Rule 3 ("a pinned
reader judges a restore by the list it holds, never by the copy the hop carries") is applied only
inside a split. `court-gate`'s row 2 shows the same thing as "followed, then switched" once
Alice's branch is seen; this gate names it.

**Kill criterion.** The forger refused by the reader as written. **Not triggered** — the finding
stands. A repair under which Alice cannot recover a reader: **guard-only triggers it** (row 3).

**Revert-checked** (`revert.js`): turning the guard mode's court filter off in the pure function
makes the guard row follow the forger; removing the forger's own head makes the socket rows read
`host: post 1 is not what the head lists` instead.

**Verdict.** The court must exist at every length a pinned chain reaches, or the pin is not a pin.
Two repairs price the same: a pinned reader MUST NOT adopt a carried court at a length its chain
already reaches (closes the hole; Alice cannot recover that reader), and **every hop carries the
list in force before it** (165 bytes per rotation, closes the hole, and Alice's two-of-three
restore recovers every reader). The unified hop — `{key, court, sig?, vouchers?}`, valid by
signature or by vouchers, weighed in a contest by its vouchers — adds nothing in bytes and lets
Alice repair a rotation she already made instead of abandoning K3. Separately, a reader holding a
court at a hop's length MUST judge the hop's validity by it, extension or split. **The hop shape
is the owner's to rule** (plan-mode answer 2026-08-23: decide after this gate).

**Held to the ruling (2026-08-23, RULINGS §14.4 — the unified hop).** Part 1 now drives the reader
as ruled: the reader holds a court at every length from its first read; the forger at index 2 and
at index 1, and the self-vouched restore at index 3, are each `identity: the chain of key changes
does not hold` — the hop is judged by the held court and is not even valid under it. A thief who
really holds K2 and forks with a rotation is contested; Alice republishes with mum's and sis's
vouchers added to the K2→K3 hop she already made, reads `ok` with her posts, and the thief's
branch is thereafter `host: serves a branch the court rejected`. A cold reader handed the thief's
branch still follows it — the stated limit. Part 2 keeps the pricing table over the text as it
was first written.

**Run:** `node tmp/redesign/gates/coldcourt-gate.js`
