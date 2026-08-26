# Plan: documents, distribution, and interop

**The mechanism.** An example script proves a rule with an assertion, then prints it with `rule()`
(`tools/rule.js`). `tools/spec.js` runs every example in reading order and assembles the printed
rules, under a hand-held list of section headings, into `open-feed-spec.md`; `tools/regen.js`
generates `test-vectors.md` the same way. A rule no script proves is not in the spec. Hand-written
content in the spec is the Summary, §1 Terms, and the headings — nothing else. `node tools/spec.js`
fails on drift; `--write` regenerates.

## What is done

The rewrite session is complete: spec generation, wire-format rename, vocabulary rename, voice
cleanup, structural spec changes, and stale reference cleanup. The spec is 58 rules across 10
sections, generated from examples, verified by two independent readers.

| done | detail |
|------|--------|
| §2–§10 generated | one `rule()` per spec rule, proved by an assertion |
| Wire-format rename | `n`→`number`, `loc`→`location`, `epk`→`ephemeral`, `ct`→`ciphertext`, `sig`→`signature`, `top`→`highest` |
| Vocabulary rename | `fold`→`replay`, `pin`→`checkpoint`, `carrier`→`postBinding`, `split`→`divergence point`, `host`/`identity` verdicts→`tampered`/`contested` |
| Voice cleanup | unified to three roles: publisher, reader, hub |
| Structural | §8.7 CORS separated from hub autonomy; §7.1 step 8 broken into steps 8–11; adversary named in Summary; §10 `<link rel="alternate">` SHOULD rule added |
| Stale references | ~20 §12/§13/§14 refs rephrased in example `.md` files; GOALS.md section refs removed |
| Dead tooling | `tools/examples.js`, `tools/revert.js`, `_seeds/`, `.out.txt` → `archive/` |
| Contrast | moved to `COMPARISON.md`; weekend-publisher Contrast section removed |

## What remains — in order

### 1. The document layer: README, TLDR, and the spec Summary

The README is the first thing anyone sees — it is the natural home for the concise explanation of
the protocol. TLDR.md was a forcing function to keep the protocol explainable in few words; that
constraint moves to the README's opening section. The spec Summary (~100 words) stays as-is.

**Retire TLDR.md.** Delete the file. Adapt `tools/tldr.js` to check the README's opening sections
instead (≤200 words "how it works", ≤100 words "what it guarantees", ≤10 glossary terms — the same
budget, applied to the README). `npm run check` keeps the gate.

**README.md — full rewrite.** The current README has a stale-content banner and describes the old
protocol (identity as a URL, `openfeed.json`, manifests, JOSE, conformance levels). Rewrite layered
for two audiences — curious people first, then developers:

*Opening sections (budget-checked, replaces TLDR):*
- How it works (≤200 words)
- What it guarantees (≤100 words)
- Glossary (≤10 terms)

*Developer section (no budget):*
- Architecture: profile + index + posts, signed files, the encryption model
- The threat model: the adversary is a loved one who controls the family hub
- Publisher/reader/hub roles; a static file server is a conforming hub
- WebFinger for discovery; JSON Feed and Atom for interop
- `npm run check`, the example contract, how to add a rule
- Reference the spec for definitions, examples for explanations

### 2. DISTRIBUTION-MODEL.md — full rewrite

The current document (20K words) describes a family journaling app with AI assistance built on the
**old** protocol — openfeed.json, manifests, conformance levels, delegated keys, the inbox pipeline.
It has a stale-content banner. The product vision is current; the technical architecture is not.

Rewrite for the current protocol:

- Identity is a key, not a URL; the device is the only signer
- Profile + index + posts; the hub is storage and serving
- The publish interface (§8): signed PUT, compare-and-swap, no account/token/session
- Encryption (§6): per-recipient slots, the audience inside, post binding
- Views (§10): JSON Feed, Atom, h-card, WebFinger — generated, not the signed object
- The checkpoint model: readers verify and remember; the publisher forgets
- Cross-hub threads (scenario 3): replies and reactions across hubs with no access control
- Hub autonomy (§8): a hub MAY require a pass, account, rate limit, or bill

Keep the app/product framing: onboarding, the AI assistant, the family-hub business model, the
privacy story. Update every spec reference. Remove conformance levels (there is one level: the
spec). Remove delegated keys, the inbox pipeline, delivery chains, and everything else the redesign
retired — `archive/redesign/` records the decisions.

**This is an owner document.** `CLAUDE.md` says so. An agent may edit it, but must clarify changes
with the owner before making them — especially any change to the product vision, the business model,
or the privacy guarantees. The technical architecture is what changed; the goals did not.

### 3. Interop — scenario 7

`GOALS.md` scenario 7: "The stranger. Someone follows a public journal in a plain feed reader, sees
it on Mastodon via a bridge with nothing built, and — after the author's key loss — re-meets them."

The protocol already serves the first half:

| done | mechanism |
|------|-----------|
| JSON Feed 1.1 view | `/<name>/feed.json`, generated from the index and posts (§10) |
| Atom view | `/<name>/feed.xml` (§10) |
| h-card page | `/<name>/index.html` with `<link rel="alternate">` to both feeds (§10) |
| WebFinger | `/.well-known/webfinger` → profile + h-card (§10) |
| `<link rel="alternate">` | SHOULD rule for h-card and WebFinger entries (§10) |

What remains:

**3a. Feed reader testing.** Verify that the generated views work end-to-end with real feed readers
(NetNewsWire, Miniflux, Feedly, or similar). Identify any gaps — missing fields, wrong media types,
discovery failures. This is testing, not spec work; the views code is `src/views.js`.

**3b. ActivityPub bridge sketch.** A bridge that presents an Open Feed identity as an ActivityPub
Actor so Mastodon users can follow public journals. Scope:

- An Actor endpoint serving the profile's name and the anchor key as the AP public key
- A followers collection and an outbox translating index entries to Create/Note activities
- Handling Follow/Undo from Mastodon
- Translating Mastodon replies/boosts/likes into Open Feed posts (or noting them)
- The key-loss story: how the Actor survives a key rotation or restore

This is likely an extension service, not a spec change — but if it surfaces a missing rule (e.g.,
a SHOULD for the Actor endpoint URL in the WebFinger response), that goes back to the spec.

**3c. The re-meeting.** After key loss and social recovery, the stranger's feed reader still has the
old feed URL. The views at that URL are regenerated from the new index under the new key. The Atom
feed's `<id>` is `urn:openfeed:<anchor key>`, which does not change across key rotations — the
anchor *is* the identity. Verify this works: the stranger's reader should see continuity, not a
new feed. If the stranger used the AP bridge, the Actor's key changes — document how that handoff
works.

## Verification

After each batch of changes:
```
npm run spec -- --write
npm run vectors -- --write   # after any change to signing, document shape, or the envelope
npm test
```

Final: `npm run check` (tests + vectors + whatever word-budget gate survives).

## Traps

- `tools/spec.js --write` rewrites all of `open-feed-spec.md` and `tools/regen.js --write` all of
  `test-vectors.md`. Anything hand-typed into either is lost on the next `--write` — edit the
  `rule()` in the script instead.
- `GOALS.md` is the owner's document. Do not edit without an instruction that names the file.
- `DISTRIBUTION-MODEL.md` is an owner document. Agents may edit it, but must clarify changes with
  the owner first — especially product vision, business model, or privacy guarantees.
- The `n` → `number` rename taught a lesson: a batch script that renames wire-member patterns
  (`{n:`, `.n`) misses function parameters and callback variables that carry the same name. Verify
  every example runs (`npm run spec`) before declaring a rename done.
