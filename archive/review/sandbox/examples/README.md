# Examples

One directory per concept, in the order the spec introduces them. Each is a small program you can
read in a few minutes, the document that explains what it shows, and the output it produces. They
are the teaching material for `open-feed-spec.md`; the spec itself stays normative and stands alone.

## The contract

`examples/<slug>/` holds exactly three files:

- **`<slug>.js`** — imports `src/` (the reference implementation), uses seeded keys so its output
  reproduces byte for byte, prints a narration of what it is doing, and **asserts every claim it
  makes**, exiting non-zero on surprise. One concept per script; comments of one line; no dependency
  beyond Node's standard library. **Length: about 120 lines.** The examples that take a whole chapter
  rather than one rule — `the-reader` (§7) and `publish-interface` (§8) — run to roughly 200, and the
  extra is printed narration, not machinery. If yours is long for any other reason it is two examples.
- **`<slug>.md`** — the concept in plain words: the spec section it illustrates, what the output
  shows, and any contrast with how other protocols do it. This is where supporting prose lives when
  it leaves the spec. It should read well beside the script and its output on a docs page.
- **`<slug>.out.txt`** — the script's stdout, committed. `npm run examples` re-runs every script and
  diffs; a difference is a failure.

Every example illustrates the **current spec only**. Designs that were considered and not adopted
belong in `archive/`, or in a `.md` as a contrast — never in a script.

`tools/revert.js` holds a row for each rule an example proves: the edit to `src/` (or to the
example) that must turn it red. `npm run revert` applies each in turn and checks. An example that
survives every mutation of the thing it claims to test is a claim, not evidence — add the row.

## Reading order

The list follows the spec's sections. Read them in order and you have read the protocol; each one
runs in well under a second, and `npm run examples` runs all of them.

| # | example | spec | shows |
| - | ------- | ---- | ----- |
| 01 | [signed-file](signed-file/) | §2.1–2.2, §2.5 | a file is body + `\n` + signature; the address is the hash of the body; unknown members ride inside it |
| 02 | [no-canonicalization](no-canonicalization/) | §2.3, §8.7 | pretty-printing, sorting, or a trailing newline reads as forged |
| 03 | [json-hygiene](json-hygiene/) | §2.4 | the four ways `JSON.parse` lets two readers disagree |
| 04 | [first-contact](first-contact/) | §3.1, §3.2 | the link fragment and the six-word spoken code |
| 05 | [the-chain](the-chain/) | §3.3, §3.5 | rotating, restoring, and vouchers added to a link later |
| 06 | [recovery-list](recovery-list/) | §3.4 | salted leaves: a voucher reveals only itself |
| 07 | [contest](contest/) | §3.6 | the split, majority over `k`, the abuser on the list |
| 08 | [moving](moving/) | §3.7, §5.4, §13.3 | locations, and relocation riding along in a reply |
| 09 | [the-index](the-index/) | §4–4.2, §4.6 | entries, the fold, one hash per number, and who may sign |
| 10 | [top-and-rumors](top-and-rumors/) | §4.3, §7.5 | why `top` outlives its post; both bounds of the rumor rule |
| 11 | [media](media/) | §4.4 | listed by the index, checked by the hash; encrypted media |
| 12 | [rewrite](rewrite/) | §4.7 | withdrawal lines vanish and readers are indifferent |
| 13 | [posts-and-targets](posts-and-targets/) | §5 | the number inside the bytes; the full target hash |
| 14 | [envelope](envelope/) | §6.1–6.3, §6.5–6.6 | slots, blinded tags, and the carrier bound as associated data |
| 15 | [padding](padding/) | §6.4 | a message to one person is the size of a message to the family |
| 16 | [the-reader](the-reader/) | §7 | the order of steps; three verdicts and the notes on an ok read |
| 17 | [publish-interface](publish-interface/) | §8 | compare-and-swap, create-once, reclaim, the media twin |
| 18 | [fetching](fetching/) | §9 | non-public addresses, redirects, and caps that are no verdict |
| 19 | [your-copy](your-copy/) | §10 | rebuilding from the bytes and your own last index |
| 20 | [views](views/) | §11 | JSON Feed, Atom, and an h-card generated from the index |
| — | [weekend-reader](weekend-reader/) | §7 | **capstone**: the whole reader in one file, standard library only |
| — | [weekend-publisher](weekend-publisher/) | §8 | **capstone**: the whole publisher in one file |

`GOALS.md`'s seven scenarios are staged as tests (`test/scenarios.test.js`), not as examples; each
example's `.md` names the scenario it serves.

What writing these found is in `FINDINGS.md` at the repo root — two security defects and a couple of
dozen smaller disagreements between the spec and the code. None of it is fixed; it is Stage D's input.

`_seeds/` holds the gates from the redesign that stage the current spec. Each is raw material for one
or more of the examples above, and is deleted when the example that consumes it lands. They run under
`npm run seeds` until then so they cannot rot.
