# CLAUDE.md

## Rules for this file

**This file is orientation, not a record. The spec is the source of truth; `git log` is the history.**

Do not add to this file:

- Anything the spec already says. If a rule is in `open-feed-spec.md`, read it there. A shadow copy
  here goes stale and then contradicts the spec.
- Anything that happened. What a previous draft got wrong, what a pass fixed, what was proposed and
  rejected, what you just changed — that is the commit message. Write it there instead.
- A changelog, a "recent changes" section, or a bullet per session.

Add something only if a future agent would make a **worse decision** without it *and* it is not
already in the repo. That is a narrow gate. This file should get shorter more often than longer.

## What this is

Open Feed: a small protocol for publishing from a place you control with an identity that is a key,
aimed at families and small groups first. Everything on the wire is a signed file built from a
standard library's primitives (Ed25519, X25519, SHA-256, ChaCha20-Poly1305, HKDF, JSON, HTTP).
`PLAN.md` is the current multi-session plan and its state; read it before starting work.

| Where | What |
| ----- | ---- |
| `open-feed-spec.md` | **The specification.** Normative; the only source of truth. §2 files, §3 identity, §4 the index, §5 posts, §6 encrypted content, §7 the reader, §8 the publish interface, §9 fetching, §10 your copy, §11 views, §12 conformance, §13 security; Appendix A media types, Appendix B test vectors |
| `src/` | **The reference implementation**, zero dependencies, one module per spec chapter: `file.js` §2 (the strict JSON parser lives here — `JSON.parse` cannot enforce §2.4), `profile.js` §3, `index.js` §4, `envelope.js` §6 (+ encrypted media), `spoken.js` + `wordlist.js` §3.1 (BIP-39 as data), `reader.js` §7 over an injected fetcher, `publish.js` §8-client + §10, `hub.js` §8-server as a pure handler, `addresses.js` + `fetch.js` §9, `views.js` §11, `cli.js`. `openfeed.js` is the barrel. **`fetch.js` is the only module that opens a socket — keep it that way** |
| `test/` | `npm test`. One file per module plus `scenarios.test.js`, which stages `GOALS.md`'s scenarios end to end. `helpers/site.js` is the shared TLS origin (certificate hand-encoded in `helpers/tls.js`) |
| `examples/` | **The teaching material**, one directory per concept in spec order: `<slug>.js` (prints and asserts), `<slug>.md` (the prose the spec sheds), `<slug>.out.txt` (committed output, diffed by the runner). Contract in `examples/README.md`. `weekend-reader/` and `weekend-publisher/` are the capstones: a whole reader and publisher written from the text alone, and the **second reader** that vector regeneration checks against. `_seeds/` holds the gates Stage B is still converting; it empties as it goes |
| `tools/` | `regen.js` regenerates Appendix B and verifies it with **both** readers (`npm run vectors`; `--write` to regenerate); `examples.js` runs the examples against their outputs (`npm run examples`); `revert.js` is the mutation table — every rule an example proves, the edit that must turn it red (`npm run revert`, minutes) |
| `FINDINGS.md` | **What writing the examples found**: two security defects in `k` (§3.3/§3.4/§3.6), and a couple of dozen smaller disagreements between the spec and the code. Nothing in it is fixed. Read it before touching identity or the envelope, and before the spec rewrite |
| `README.md` · `TLDR.md` · `GOALS.md` | Human-facing docs. `GOALS.md` is the live statement of values and scenarios — the floor the spec is judged against |
| `archive/` | Everything the redesign superseded, verbatim, never run by CI: the old spec and its implementation, the prototype fleet, and the redesign record (rulings, rejections, reviews, outside review). `archive/README.md` is the index. Consult it before re-litigating a design choice — most near-misses are already priced there |
| `tmp/` | Gitignored scratch. Nothing here is tracked |

`npm run check` = tests + vectors + examples + seeds. Run it before every commit.

## The threat model that drives the design

**The operator of a family hub may be a loved one who is an abuser** — he controls the serving path,
supplies the client if he can, and will not cooperate. No confidentiality mechanism defeats him for
anything he was an audience of; the protocol answers with **exit** (§10, §13.1) and with verification
he cannot forge (§7). The second driver is two self-hosting family members on separate domains, who
must reply and react to each other's family-only content as if on one hub (`GOALS.md` scenario 3).

Read §13 before touching anything security-relevant.

## Version policy

**0.1.0 — Draft, unreleased.** Nothing here has had a reader outside this repo. The spec is checked
against running code, and its vectors are verified by two independent readers (`src/reader.js` and
the weekend reader), which is the closest thing to somebody else's reading it has had.

**Do not bump the version for ordinary changes.** The number marks a release someone outside this
repository can depend on, not an edit counter. Pre-1.0, breaking changes ARE allowed to fix
correctness or security defects; post-1.0, additive only.

## Editing the spec

1. **RFC 2119 keywords** — MUST, MUST NOT, SHOULD, SHOULD NOT, MAY.
2. **Guard the simplicity.** The spec's value is how little of it there is: one way of doing each
   thing, stated once. Resist a second construction, a second model, or a second document growing
   up beside the first. Supporting prose belongs in an example's `.md`, not in the spec.
3. **Keep the rule, cut the archaeology.** Justification sitting next to a MUST is load-bearing —
   it is what stops the next implementer weakening it, so it stays. A paragraph about what an
   earlier draft got wrong does not.
4. **Run `node tools/regen.js`** after any change touching signing, document shape, the envelope, or
   the vectors. It self-verifies with both readers and confirms every vector appears verbatim in the
   spec. Exits non-zero on drift.
5. **Vocabulary is fixed**: anchor key, chain, link, recovery list, profile, index, post, media,
   encrypted, pin, withdraw, hub. Code, tests, examples, and docs use the spec's words and its
   section numbers; a rename is a spec change first.
6. **No changelog appendix, no version bump.** Record the change in the commit.
7. **There is no line budget. Do not reintroduce one.** The target is the shortest spec that still
   covers its bases, and the lever that moves it is design, not compression.

## Editing the README

README explains; the spec defines. Keep the TL;DR under a page, link spec section numbers, use no
RFC 2119 keywords, and keep examples consistent with the spec's object model.

## Traps

- A pin is the reader's own state, not a wire object: `profileVersion`/`profileHash`,
  `indexVersion`/`indexHash`, `recoveryLists` per chain length, `live`, `withdrawn`, `top`. The wire
  members are both just `version`.
- The reader re-fetches a target's profile on a look-again (§7.5) — that is the rumor rule, not a
  missing cache; a cross-read cache silently stops fork detection.
- `tools/regen.js` checks every hash-shaped literal in Appendix B against the current run; a vector
  quoted twice needs the rule to reach both.
- Never edit `src/`, the spec, or an example while `npm run revert` is in flight: it mutates files
  in place and restores them, and a half-landed edit reads as a failure.
