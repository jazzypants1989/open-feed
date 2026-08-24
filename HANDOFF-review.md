# Hand-off: reviewing Stage B and Stage C

**Temporary. Delete this file once the review is done** — nothing in it belongs in the repo long
term. `PLAN.md` is the plan, `FINDINGS.md` is the defect list, `SPEC-CUTS.md` is Stage D's input;
this is only the context those three do not carry, written for whoever reviews the work rather than
continues it.

Scope: commits `ebfdd0a..6a2a20f` (8 commits, 85 files, +9,641 / −952), on `main`, on top of
`325e71b`.

---

## 1. What is machine-checked, and what is nobody's evidence

This is the first thing to get straight, because the work looks more verified than it is.

**Checked by something that fails:**

- Every example runs and its stdout matches a committed `.out.txt` byte for byte (`npm run examples`,
  22 of them).
- Every example asserts every claim it *prints*. A wrong number in the output is a failing script.
- 129 mutation rows: break the rule in `src/`, the example that claims it must go red
  (`npm run revert`, ~4 minutes).
- Appendix B verified by two independent readers (`npm run vectors`, 49 checks).
- 54 tests, including `GOALS.md`'s seven scenarios end to end.

**Checked by nobody:**

- **Every `.md` file.** The prose is not executed. In particular, the `## Contrast` sections make
  factual claims about Signal, Matrix, ActivityPub, Nostr, Bluesky/AT, IPFS, git, HPKE, NIP-44,
  RFC 8785, RFC 7493, Argent/ERC-4337, Tor, TLS, MMS and Bridgy Fed. **I spot-checked perhaps a third
  of them and read six `.md` files closely.** They are the highest-risk artifact in the whole
  delivery, and they are the part a reader will quote. If you review one thing, review these.
- The narration *around* the asserted lines. A script can assert `x === 3` and print a sentence
  beside it that misdescribes why.
- Whether a mutation row is the *right* mutation. "Caught" proves the example is sensitive to that
  edit; it does not prove the edit corresponds to the rule the row claims. Most rows were proposed by
  the same agent that wrote the example, i.e. self-graded. I verified every `from` string occurs
  exactly once and that all 129 are caught; I did not independently re-derive that each row targets
  the rule its comment says.

## 2. How this was produced, and where the seams are

The twenty examples were written by parallel subagents, one per example, from briefs I wrote — not by
one author in sequence. House style was enforced by pointing every brief at the three §2 examples I
wrote by hand (`signed-file`, `no-canonicalization`, `json-hygiene`) as the template, and by a
structural check I ran afterwards (`**Spec:**` / `**Run:**` / `## What the output shows` /
`## Contrast` / a named `GOALS.md` scenario — all 22 conform).

Consequences worth looking for:

- **Tone drift** between examples. I removed one first-person sentence I caught; there may be more.
- **Duplicated argument.** Neighbouring examples were told to cross-reference rather than duplicate,
  and mostly do, but §3.4/§3.6 (`recovery-list` / `contest`) and §4.2/§4.7 (`the-index` / `rewrite`)
  are the pairs most likely to overlap.
- **Length.** The contract says about 120 lines. Five exceed it: `publish-interface` 201,
  `the-reader` 185, `posts-and-targets` 180, `envelope` 167, `moving` 147. I amended
  `examples/README.md` to permit ~200 for the two chapter-wide examples (§7, §8) rather than force
  cuts; the other three were not covered by that amendment and are simply over. That was a judgement
  call and it is reversible.
- **`examples/fetching/` opens a socket** — `http.createServer` on `127.0.0.1:0`, closed before the
  last three blocks. It is the only example that does. Justified in its report (the redirect rules
  and one body cap cannot be shown by a pure function), but it is a deviation from every other
  example and from the repo's "only `fetch.js` opens a socket" habit, so it deserves a look.

## 3. The two security findings — reproduce them yourself

`FINDINGS.md` §1 states them. I reproduced both by hand against `src/`; those scratch scripts are
deleted, so here are the recipes. Both take a minute.

**(a) `k` of 0.** Build a profile with `recovery: { k: 0, leaves: [] }`, read it to get a pin, then
have a thief sign a version 2 whose chain is `[{key: alice}, {key: thief, recovery: {k:0,leaves:[]}}]`
— no `sig`, no vouchers. `verifyProfile(forged, { learned: alice.x, pin })` returns `ok` with
`chain.current === thief.x`. §3.3's "at least `recovery.k`" is satisfied by zero vouchers.
`test/helpers/site.js:52` and `test/reader.test.js:45` write `{k:0,leaves:[]}` today.

**(b) `k` below a majority.** `commit(1, [mum, sis, ex])` — the ex is on the list because he is
family. Pin a reader at chain length 1. The ex, **holding no key of Alice's**, publishes version 2
with `restore(A1, EX, [EX], REC)` — he vouches for himself, alone. The pinned reader returns `ok` and
follows his key. There is no split, so §3.6 never runs.

Both are one change to §3.3 (valid when vouchers are at least `k` **and** more than half the leaves).
I did **not** make it: it is a protocol change, it restages `examples/contest/` — whose centrepiece
deliberately uses `k = 1` on a three-member list to contrast majority with `k` — and the ripple
reaches `src/profile.js`, `examples/weekend-reader/weekend-reader.js` (both readers must agree or the
vectors diverge), and two test helpers. Deciding it is the owner's call, not a reviewer's, but a
reviewer should confirm the reproduction before it is acted on.

## 4. Judgement calls I made that a reviewer might reverse

Each of these was mine, not the owner's, and each is cheap to undo.

1. **Did not fix the `k` defects.** Reasons above. The alternative — fix them and restage `contest` —
   is defensible and I would not argue hard against it.
2. **Kept `_seeds/`.** `PLAN.md`'s Stage B closes when `_seeds/` is empty. I measured instead of
   assuming: retargeting the fourteen rows whose subject is the weekend reader at the capstone caught
   1 of 14 before I strengthened the capstone's battery, and 10 of 14 after. The seeds are still the
   only thing proving the *second* reader. `PLAN.md` records three ways out.
3. **Applied four cosmetic fixes to `src/` mid-stage** rather than leaving them in `FINDINGS.md`:
   `'a index'` → `'an index'` in a verdict string and five other places; `src/reader.js` no longer
   labels a §4 *shape* failure as a §4.2 *fold* failure; `src/wordlist.js` cites §3.1; a JSDoc
   member that was never returned. The second of those changes an app-visible `why` string, so it is
   the one to check. `FINDINGS.md` §5 records them as struck.
4. **Capstone design: a `// ====` marker.** The demo sits below it and the measurement is the
   implementation above it — that is what lets the capstone print under `npm run examples` without
   corrupting the line count that is the whole point of it. `court-gate` and `weekend-gate` were
   patched to slice on the same marker. If you dislike the marker, the alternative is a separate
   driver file, which breaks `examples/README.md`'s three-files rule.
5. **Accepted the subagent's call to archive `DISTRIBUTION-MODEL.md`** rather than rewrite it. Its
   evidence is in the commit and in `archive/README.md`. Six things it carried have no home; the list
   is in `PLAN.md`'s traps and is the only record of them.
6. **Accepted folding `TLDR.md` into the README** and deleting it.

## 5. Things I did not do

- I did not read all 22 `.md` files end to end. Six closely, the rest structurally.
- I did not re-derive most of the numbers the examples print — the scripts assert them, which is a
  different guarantee: it means the number matches the run, not that the run models the right thing.
- I did not touch `open-feed-spec.md`. Not one character. Everything spec-shaped is a *proposal* in
  `SPEC-CUTS.md` or a *report* in `FINDINGS.md`.
- I did not act on the four §5 cosmetics still open in `FINDINGS.md`, nor on anything in §2–§4.
- `npm run revert` takes about four minutes and mutates `src/` in place. I never ran it while
  subagents were running scripts. **Do not run it concurrently with anything else**, and do not edit
  `src/`, the spec, or an example while it is in flight.

## 6. Specific things worth auditing, in priority order

1. **The `## Contrast` sections of all 22 `.md` files** — see §1. Unverified factual claims about
   other systems, in the most quotable part of the deliverable.
2. **`examples/contest/`** — the most important example in the repo, it stages the threat model's
   central case, and it uses `k = 1` on purpose in a way the §3.3 fix would invalidate.
3. **`examples/envelope/` and `examples/padding/`** — the only examples where a mistake is a
   cryptographic mistake. `padding` also re-derived the spec's "about 1.1 KB" as 498 bytes and found
   that §6.4's headline claim stops holding past about three recipients; both are in `FINDINGS.md`
   §4 and both are numbers someone should check independently.
4. **The 89 new mutation rows** in `tools/revert.js` — specifically whether each targets the rule its
   section comment claims.
5. **`README.md`** — 6.2k words written by one agent in one pass. Its numbers were re-derived, but
   its structure and emphasis have had one reader.
6. **`SPEC-CUTS.md`'s "Shorter by design" section** — the twelve consolidations are where the spec's
   remaining length actually is, and they are design proposals, not cuts, so they carry the most risk
   of being wrong.

## 7. Commands

```
npm run check      # tests + vectors + examples + seeds        (~10 s)
npm run revert     # 129 mutations, one at a time              (~4 min, mutates src/ in place)
npm run examples   # all 22, diffed against committed output
node tools/examples.js contest        # one example
node tools/revert.js contest          # one example's rows
```

## 8. Traps that bit me, beyond the ones in `CLAUDE.md`

- `tools/revert.js` resolves a row's gate as `examples/<gate>/<gate>.js` first and
  `examples/_seeds/<gate>.js` second. It used to be the other way round, and because
  `examples/_seeds/envelope.js` exists as a *helper* rather than a gate, all five `envelope` rows
  silently ran a module that does nothing and reported "not caught".
- `examples/_seeds/*.md` cards quote numbers from before several repairs. Every one I checked was
  stale. Re-derive anything you take from them.
- Adding the capstone demos broke `weekend-gate` and `court-gate`, which assert the reader is under
  200 lines by counting the whole file. Both now slice at the marker.
