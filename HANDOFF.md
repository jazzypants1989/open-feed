# Handoff

Written 2026-08-26 by the agent that did the retrospective session (commits `66788ea`–`d855502`).
Delete this file when the work in it is done.

Two jobs: finish three things that were left undone, and rewrite `RETROSPECTIVE.md`, which is badly
written.

---

## Job 1: rewrite RETROSPECTIVE.md

I wrote it. It is not good. The owner's diagnosis, which is correct:

> **Gen 3** changed the premise, and 271 KB became 67 KB in one commit (`6791a91`).
>
> "Like, I know you explain it later, but a reader wouldn't fucking know that then, would they?
> That's not a cliffhanger, that's just shitty writing."

That is section 1. Section 2 is where "the premise" is finally named. So the reader meets a pronoun
with no referent and is expected to wait a section for it. That is the whole problem in one line, and
it is not the only instance — section 1's table and commentary assume everything section 2 explains.

The general faults, so the rewrite does not reproduce them:

1. **It withholds information for effect.** Sentences are built as reveals. The reader is a person
   who has not read this repo and wants to know what happened. Tell them, in order, up front.
2. **Too many aphorisms.** "That is what a design looks like when it is defending a bad premise."
   "The same trade in nine different places." "A directory nothing reads is not a record." One of
   these might earn its place. There are about a dozen, and they crowd out the facts.
3. **Em-dash pileups and long appositive chains.** Sentences run 40+ words with three clauses hanging
   off them.
4. **The structure is backwards.** It opens with a table of numbers, then explains what the numbers
   mean. It should open with the thesis.

The thesis, which belongs in the first paragraph: **the protocol used to say your identity was a
URL. Changing that to a key is what made the spec small.** Everything else — the 271 KB peak, the
293 MUSTs, the deleted mechanisms — is evidence for that one sentence. State it first, then support
it.

Keep the content. The research is sound and it is expensive to redo. Specifically keep:

- The five-generation table (the numbers are all verified).
- Section 3, the settled-decisions ledger. This is the part that actually replaces `archive/`, it is
  the reason the file exists, and it is the least damaged by the bad prose.
- Section 4, the things decided twice.
- Section 5's results, but see Job 2 — one claim in it is currently unsupported by any code.
- Section 7, the two open questions from the outside review.

Cut or compress hard: section 1's commentary, section 2 (move its content into the opening), and
section 6, which is a changelog of one session and belongs in `git log`, where it already is.

---

## Job 2: three things left undone

### 2a. §3.6's new rule is not proven by anything

`examples/identity/identity.js`, the `rule('3.6', ...)` call around line 191. It now says a publisher
MUST encrypt to the `read` of the highest profile `version` it has verified. The three assertions
above it check that the key decodes to 32 bytes, that a profile without `read` has none, and that a
failed verification yields nothing. **None of them tests the rule.**

This matters more than the other two items. This repo's rule is that a rule no script proves is not
in the spec, and there are now 58 rules of which 57 are proven and one is not, with nothing marking
which. It reads exactly like the others.

What to stage, from the demo described in 2b: a publisher holds a checkpoint of a profile at version
1, the owner publishes version 2 with a different `read`, and the publisher encrypts from the stale
checkpoint. Assert that the old key opens it and the new key does not. Then the rule can print.

### 2b. Three demonstration scripts were lost

They were written in `tmp/`, which is gitignored, so they are not in any commit. They may still be on
disk at `tmp/limit-*.js` when you read this — look there first. If they are gone, here is what each
staged, in enough detail to rebuild.

**`limit-freeze.js`** — Sis publishes posts 1–5 on the ex's hub, moves to her own origin (new
publisher with `last` set to her kept index bytes so the version continues), republishes 1–5 and adds
6–10. The ex's hub is then left alone: it serves a valid, correctly signed, frozen index. Findings: a
cold reader gets `ok`, 5 posts, no notes. A checkpointed reader re-reading gets `ok` and no notes,
because a freeze moves nothing and no rollback rule has anything to compare. Then Jesse, whom the
reader also follows, replies to sis's post 8 at her real location; driving `rumors()` advances the
reader's checkpoint for sis to `highest: 10` silently. With nobody replying, the freeze stays
invisible. The owner ruled this into §7.4's text and did **not** ask for it as a test, so rebuilding
it is optional.

**`limit-stale-reading-key.js`** — described in 2a. This one should become the assertion behind the
§3.6 rule.

**`limit-offline-archive.js`** — Sis publishes three posts, withdraws one, adds a media file. Her
`pub.copy` (§8.9) is written to a real directory. A file-backed `get()` over that directory is passed
to both readers — note they take different fetcher shapes: `src/reader.js` wants
`{bytes, etag}`, the weekend reader wants raw bytes. Both return `ok` with posts 1 and 3 live, post 2
withdrawn, and the media file present. Flipping one byte in post 3 makes both return `tampered`.
The anchor key is supplied out of band, as §3 requires.

**This one should become a test**, because `RETROSPECTIVE.md` section 5 says the offline-archive
guarantee is true today and that "the cheapest way to keep it true is a test that fails if it stops
being true" — and then no such test was written. Right now the retrospective asserts a guarantee that
nothing defends. Either write the test or cut the claim.

### 2c. Three decisions waiting on the owner

None of these should be changed without asking.

- **§8.6 weakened between generations.** The Gen 3 spec made a hub MUST refuse media bytes that do
  not hash to the name it was offered them under. The current §8.6 says MAY. This looks like drift
  rather than a decision. It is recorded in `RETROSPECTIVE.md` §6.
- **`GOALS.md`'s staging table is wrong about scenario 7.** It points at `test/scenarios.test.js`,
  where only the views half lives. The bridge half is in `test/interop.test.js` and
  `test/bridge.test.js`; the re-meeting-after-key-loss half is in `test/views.test.js`. The scenario
  is covered; the table is wrong. `GOALS.md` is the owner's document — report, do not edit.
- **`DISTRIBUTION-MODEL.md` has five retired words** (`genesis` at :99 and :364, `sealed` at :156,
  :305, :389). `npm run refs` prints these as notes on every `npm run check` and never fails on them,
  because it is an owner document. Also carries the old "a static file server is a fully conforming
  hub" claim at :41, which the spec and README no longer make.

---

## State of the repo

`npm run check`: 162 tests, 58 rules with no drift, 67 vector checks, prose current, budgets ok.

Spec is 4,400 words against a **4,500-word ceiling** the owner set this session. `tools/refs.js`
enforces it. There are 100 words of headroom, so anything added has to come out somewhere.

New this session and worth knowing about:

- `tools/refs.js` — gates §-references, appendix references, dead links and `Run:` paths, retired
  vocabulary, `package.json` version agreement, and the spec word ceiling. Wired into `npm run
  check`. It found 83 defects on its first run. Owner documents (`GOALS.md`,
  `DISTRIBUTION-MODEL.md`) are reported as notes and never fail the build.
- `tools/regen.js` gained nine **negative vectors** — failure cases both readers must reject with the
  same verdict. Before this, every vector was well-formed, so the two-reader check only ever proved
  the readers agreed on acceptance. Verified it bites by reverting one line in the weekend reader.
- `archive/` is deleted (`d855502`). Everything is in history; `git show 66788ea:archive/<path>`
  retrieves any of it. `archive/old-spec-1.md` was in no commit anywhere before `66788ea`, which is
  why the archive was committed first and deleted second.
