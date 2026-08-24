# `PROMPT-pass1.md` §4 is defective. Read this before trusting any pass-1 answer about encryption.

**Written 2026-08-20, after the owner caught the error.**

The defective brief is kept **byte-identical** as `PROMPT-pass1-v1-defective.md` — its SHA-256 is
stamped in every quarantined response header, and editing it would break the only provenance chain
this directory has. `PROMPT-pass1.md` is the corrected brief. The account of the defect lives here.

## The misconception

`PROMPT-pass1.md` §4 rendered priority 1 as:

> **No dependencies.** Implementable from a language's standard library: Ed25519, SHA-256, HTTP,
> JSON, base64. No JSON canonicalizer, no JOSE library, no git binary, no blockchain, no DHT, no
> global registry or directory service.

Presented as a bulleted prohibition list, that reads as a **closed allowlist of five primitives**.
It is not one, and `GOALS.md` never said it was.

`tmp/redesign/GOALS.md:35` reads:

> **No dependencies.** Implementable from a language's standard library: Ed25519, SHA-256, HTTP,
> JSON, base64url. No canonicalizer, no JOSE library, no git binary.

The list is **illustrative of what a standard library provides**. The constraint is the sentence
after it: **no third-party dependencies**. X25519, AES-KW, and AES-GCM are in Node's standard
library — which is exactly why `src/enc.js` has zero dependencies today — and in Go's and Java's.
Nothing about the current encryption layer violates priority 1.

The tension `GOALS.md` calls the intellectual point of the project is between **priority 1 (no
dependencies)** and **priority 2 (a second implementer finishes in a weekend)**. It is not a
primitive budget.

**This was an authoring error in the brief, not a finding about the design.** An earlier draft of
`SYNTHESIS.md` promoted it to the headline result. That section is retracted; see §1.2 there.

## What it actually affected — measured, and my first two estimates of this were both wrong

I initially reported the blast radius as "one section of one model." Then as "two of three
unaffected." Both were produced by checking whether a model used X25519 and not checking what
**symmetric** cipher it chose. The corrected count:

| model | affected? | evidence |
|---|---|---|
| `gpt-5.6-luna` | **no** | chose X25519 + ChaCha20-Poly1305 and called the constraint unrealistic rather than designing around it |
| `glm-5.3` | **yes, cipher section** | invented a SHA-256 counter-mode stream cipher with no MAC; *"mandating an AEAD breaks priority 1 in several mainstream stdlibs"* |
| `qwen3.8-max` | **yes, cipher section** | SHA-256 keystream + HMAC-SHA256 instead of an AEAD; lists its primitives as Ed25519 / X25519 / SHA-256 / HMAC only |
| `kimi-k3` | **yes, cipher section** | SHA-256 stream cipher + HMAC, and a full paragraph headed *"The one deviation from priority 1"* justifying adding X25519 as a deliberate, argued exception — a paragraph that exists only because of the framing |

So **three of four complete answers converged on a hash-only symmetric construction**, and the brief
is a sufficient explanation for that convergence. It cannot be read as independent agreement that a
standard AEAD should be avoided. Whether a hash-only construction is *preferable* on simplicity
grounds is a live question — but it is one the corrected pass-1 re-run has to answer, not this one.

**Not affected in any answer:** identity primitive, byte-exact signing, the chain and sequence
numbers, rotation pinning, the root/active key split, the recovery designs, the scenario
walk-throughs, the audience-size leak, interop, and the cost sheets.

**Consequence:** pass 1 was re-run against a corrected `PROMPT-pass1.md` (SHA-256
`ba5166e3…`). The defective-brief answers are kept under
`responses/v1-defective-brief/` — they are still the only evidence for anything non-cryptographic
that the re-run happens to miss, and `gpt-5.6-luna`'s is clean throughout.

## How it is corrected downstream

Pass 1 was re-run in full against the corrected brief, and pass 2 replays each model's *corrected*
pass-1 answer as conversation history. `PROMPT-pass2.md` therefore carries no correction text — an
earlier version of this note said it did; `ask.js` sends none and never did. On the corrected brief
all six models chose a standard AEAD.

## The rule this violated

The campaign's own working rule, in `PLAN.md`: *if you are about to act on a number or a claim,
re-derive it first.* The claim "priority 1 is a five-primitive palette" was never re-derived against
`GOALS.md:35`. It was paraphrased into a prompt, sent to five models, and then read back out of
their answers as though it were their finding.
