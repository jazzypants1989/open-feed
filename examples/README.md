# Examples

One directory per concept, in the order the spec introduces them. Each is a small program you can
read in a few minutes and the document that explains what it shows. **The spec is generated from
them**: a script proves a rule with an assertion and then prints it with `rule()` (`tools/rule.js`);
`tools/spec.js` runs every example and assembles the printed rules, in section order, into
`open-feed-spec.md`. A rule no script proves is not in the spec.

## The contract

`examples/<slug>/` holds exactly two files:

- **`<slug>.js`** — imports `src/` (the reference implementation), uses seeded keys so its output
  reproduces byte for byte, prints a narration of what it is doing, **asserts every claim it
  makes**, exiting non-zero on surprise, and prints each spec rule with `rule()` only after the
  assertion that proves it. One concept per script; comments of one line; no dependency
  beyond Node's standard library. **Length: about 120 lines.** The examples that take a whole chapter
  rather than one rule — `the-reader` (§7) and `publish-interface` (§8) — run to roughly 200, and the
  extra is printed narration, not machinery. If yours is long for any other reason it is two examples.
- **`<slug>.md`** — the concept in plain words: the spec section it illustrates, what the output
  shows, and any contrast with how other protocols do it. This is where supporting prose lives when
  it leaves the spec. It should read well beside the script and its output on a docs page.

Every example illustrates the **current spec only**. Designs that were considered and not adopted
belong in `archive/`, or in a `.md` as a contrast — never in a script.

## Reading order

The list follows the spec's sections. Read them in order and you have read the protocol; each one
runs in well under a second, and `npm run spec` runs all of them.

| # | example | spec | shows |
| - | ------- | ---- | ----- |
| 01 | [files](files/) | §2 | body + `\n` + signature; the address; the four paths; bytes served are bytes signed; the four JSON hazards; unknown members |
| 02 | [identity](identity/) | §3 | the anchor key, the profile, the chain, the recovery list, the reading key, first contact |
| 03 | [contests](contests/) | §3.4–3.5 | two profiles claiming one identity; locations and moving |
| 04 | [the-index](the-index/) | §4 | entries and the fold, `top`, media, who signs the index, rewriting |
| 06 | [posts](posts/) | §5 | the number inside the bytes; `at`, `rel`, the full target hash; private messages |
| 07 | [envelope](envelope/) | §6 | slots, blinded tags, and the carrier bound as associated data |
| 08 | [reading](reading/) | §7 | the steps in order; three verdicts; the pin; the rumor rule and its bounds |
| 16 | [publish-interface](publish-interface/) | §8 | compare-and-swap, create-once, reclaim, the media twin |
| 17 | [fetching](fetching/) | §9 | non-public addresses, redirects, and caps that are no verdict |
| 18 | [your-copy](your-copy/) | §10 | rebuilding from the bytes and your own last index |
| 19 | [views](views/) | §11 | JSON Feed, Atom, and an h-card generated from the index |
| — | [weekend-reader](weekend-reader/) | §7 | **capstone**: the whole reader in one file, standard library only |
| — | [weekend-publisher](weekend-publisher/) | §8 | **capstone**: the whole publisher in one file |

`GOALS.md`'s seven scenarios are staged as tests (`test/scenarios.test.js`), not as examples; each
example's `.md` names the scenario it serves.
