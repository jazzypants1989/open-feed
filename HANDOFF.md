# Open work

Read `CLAUDE.md` first; it says how to work here. This file says what is *left*, and nothing else —
what happened is in `git log`, and what is settled is in `docs/RETROSPECTIVE.md`. **Delete this file
when its jobs are done.**

## Where it stands

`npm run check` is green: 174 tests, 58 machine-checked rules, 71 vector checks under two readers, 30
conformance checks, prose refs, word budgets. There is a live hub at `https://pence.page` running
`openfeed hub` behind Traefik, and one live identity, `pence.page/jesse`, whose key has never been on
the server. `tools/conform.js hub https://pence.page --claim <name>` passes 15/15 against it.

Both open questions in `docs/RETROSPECTIVE.md` are answered. Nothing in the spec is unproven.

## The method that is working

Three of this project's last five real defects were found the same way, and it is worth doing again
before it is worth doing anything else: **take a claim the project makes, stage it against the
adversary in `docs/GOALS.md`, and let the script decide.** Not a review, not an argument — a file in
`test/` that sets the scene and asserts what is true today. `test/setup.test.js`, `test/freeze.test.js`
and `test/archive.test.js` are the three worked examples; copy their shape, including asserting the
*current* behaviour first and making **both** readers agree.

Two of the three claims turned out to be defects. The third turned out to be free. That ratio is why
this comes before feature work.

---

## 1. The reader has no memory — start here

`openfeed verify` calls the reader with no checkpoint, every time. §7.3's checkpoint **is** the
tamper-detection mechanism: without one, `checkAgainstCheckpoint` and every fork rule in §3.4 never
run. So outside the test suite, **this protocol currently cannot detect tampering at all.** The
central claim of the README's guarantees paragraph has no runnable demonstration.

What to build, in `src/cli.js`:

- `openfeed follow <anchor-key> <location>` — first contact (§3.7), verify, keep the checkpoint.
- `openfeed read` — a pass over everything followed: read each identity against its stored
  checkpoint, print the verdict and the notes, then run §7.4's rumor pass across the whole set and
  print the rumor lines.
- `openfeed unfollow <anchor-key>`.

The real work is a stable on-disk form for the checkpoint, which holds `Map`s (`live`, `withdrawn`,
`recoveryLists`). **This format is the CLI's business and must never become a wire object** — see
`CLAUDE.md`'s traps. Say so in the file that defines it, or somebody will standardise it.

The rumor pass is the part that has never run outside `test/` and `examples/reading/`:
`reader.rumors(seen, posts, replier)` wants `seen` as anchor key → checkpoint, which is exactly the
set of files on disk.

**How you know it works:** follow the live hub, tamper with a served file, and watch the second read
say `tampered` where the first said `ok`. That demonstration does not exist today.

## 2. The docs make guarantees nothing stages

`docs/DISTRIBUTION-MODEL.md:182` says a hub serving one thing and claiming another is "exactly the
equivocation the reading rules catch (§7.1)". `docs/COMPARISON.md:257` says Open Feed has "no proofs,
no auditors, and no gossip between readers". Both can be true in different senses — a single reader
catches a hub contradicting *itself* over time; nothing catches a hub telling two readers different
internally-consistent stories except §7.4 — but the wording invites the wrong reading, and **no
script settles it either way.**

Stage it: a hub that serves Mom one index and Sis another, both valid, both consistent. Find out what
the readers actually do. Then fix whichever document is lying, or the rule, depending on what the
script says. The README's own sentence is carefully hedged ("once one of them replies to something the
other cannot see") and may well survive; the two docs above are less careful.

The rest of the README's "What it guarantees" is worth the same treatment, claim by claim.

## 3. §3.2 and §3.3 have no tooling

The most safety-critical mechanisms in the spec — the recovery list, rotation, restore — have running
code in `src/profile.js` and no way for a human to reach it. There is no verb that sets a recovery
list, rotates a key, or mints a restore.

This is also why the one live identity has an empty recovery list, which means a lost key is a lost
identity (§3.3). That is the honest state and the CLI says so at `key` time, but it is not a state to
leave standing once there is anyone to name.

Note what §3.3 now asks for and why: a backup key **beside at least three other members**, because a
member holding the backup key and one leaf of their own carries any list of three or fewer.
`test/setup.test.js` has the arithmetic.

## 4. §6 has never crossed a network

Encrypted posts are fully implemented in `src/envelope.js`, proven in `examples/envelope/`, and
completely unreachable from `src/cli.js`. No encrypted post has ever been published to a real hub and
opened by a real recipient on another machine. Media (§4.3, §8.6) is in the same position:
`publishMedia` exists in `src/publish.js` and no verb calls it.

`docs/GOALS.md` floor item 2 and scenario 3 both live here, and the "What gets published" section of
`docs/DISTRIBUTION-MODEL.md` says what the UI must disclose — the audience is a claim no recipient
can check, and adding someone is prospective.

## 5. A second person

Scenarios 1 and 3 need two humans on two hubs, and the protocol has never had two. Both people who
have read the spec said they could build it, and `tools/conform.js` now exists to tell them whether
what they built is right.

The steps, smallest first:

1. **As a reader.** Hand them the anchor key and the six words (§3.7) and have them run
   `npx . verify <key> https://pence.page/jesse` from their own machine. Proves first contact.
2. **As a publisher.** Claim them a name on `pence.page`, or help them self-host — the two are
   indistinguishable to a reader on purpose ("How it sits on the protocol", in
   `docs/DISTRIBUTION-MODEL.md`).
3. **One thread, two hubs.** A reply crossing origins, resolved by §7.1 step 13 and §7.4. This is
   scenario 3, and staging it between two real machines is the first genuinely social test.
4. **As an implementer, if they want it.** `node tools/conform.js reader ./theirs.mjs`. What they
   report is worth more than anything this repository can check about itself.

## 6. Smaller, and clear

- **Publisher conformance.** `tools/conform.js` covers readers and hubs. A publisher suite — does it
  write the post before the index (§8.3), does it keep its copy (§8.9), does it handle 412 — was
  deferred as the hardest to adapt and the least likely thing an outsider builds first.
- **`fileStore` is O(total bytes) per write.** Correct and atomic for a family hub, wrong for
  `docs/GOALS.md` scenario 5. The bound is stated in `src/hub.js`; the fix is one file per path, and
  it changes the on-disk format, so the live hub needs a migration.
- **No CI.** `README.md` says a pull request here is code, and nothing runs `npm run check` on push.
  One workflow file.
- **POSSE.** `bridge/` and the live identity now both exist and have never been connected.
  The notes for future development in `docs/DISTRIBUTION-MODEL.md` call this the natural first use of
  the bridge, and it is additive: nothing about it touches the four kinds of file.

---

## Two traps this session hit

- **The vectors are byte-stable, and that is the point.** `tools/corpus.js` holds definitions whose
  every byte reaches `test-vectors.md`. Retyping one from memory instead of copying it changes
  published vectors. `npm run vectors` catches it; believe it rather than regenerating past it.
- **`tools/conform.js` must not grow rules.** A check with no `rule()` behind it is a spec proposal
  wearing a conformance test. One got written this session — that the ETag equals the address of the
  body — and §8.1 says only that a hub exposes `ETag` and honours `If-Match`. It was removed, not
  promoted. The spec is generated so that this cannot happen quietly in the spec; nothing protects
  `tools/` but attention.
