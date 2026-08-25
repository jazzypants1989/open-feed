# Archive

Everything here was superseded by the redesign that produced the current `open-feed-spec.md`. It is
kept verbatim because the owner is not yet ready to rely on git history alone, and because the
record of what was tried and why it was rejected is the cheapest way to avoid re-litigating it.
**Nothing here is run by CI.** The layout mirrors the old repository root, so the archived scripts
still resolve their relative imports (`archive/tmp/regen.js` finds `archive/src/`, and so on) and
can be run by hand.

| Path | What | Belongs to |
| ---- | ---- | ---------- |
| `open-feed-spec.md` | The first specification: URL identities, JWS/JOSE signing, RFC 8785 canonicalization, chained manifests, an inbox, conformance levels | Spec 1 |
| `src/` · `test/` · `bin/` | Its reference implementation (7.4k lines), suite (7.9k lines), and CLI shim | Spec 1 |
| `tmp/regen.js` · `tmp/rules.js` · `tmp/prove.js` · `tmp/proofs.js` | Its vector regenerator, normative-inventory report, and rule-proving harness | Spec 1 |
| `tmp/prototypes/` · `tmp/archive/` · `tmp/measure/` · `tmp/check-prototypes.js` · `tmp/revert-gates.js` | The Cutting Campaign's prototype fleet: gates over the old `src/`, verdict cards (the question, method, numbers, and verdict for each experiment), the original prototypes, and measurement scripts | Spec 1 |
| `tmp/review-findings.md` · `tmp/sketches-review.md` · `tmp/appendix-c-case.md` · `tmp/TLDR.md` | Review records and the old 300-word tl;dr | Spec 1 |
| `redesign/GOALS.md` → now at the repo root | — | — |
| `redesign/CANDIDATES.md` · `SKETCH*.md` · `HANDOFF-*.md` · `REVIEW-*.md` · `INTENT-MAP.md` | The redesign's candidates, sketches, handoffs, and reviews, in order: candidates → skeptical review → goals → outside review → fresh start → final review → the spec → the skeptical review of the spec | Redesign |
| `redesign/RULINGS.md` · `redesign/rejections.md` | **The owner's decisions and every recorded rejection answered by name.** A reversal of anything in the current spec must answer the reasoning recorded here | Redesign |
| `redesign/outside/` | Six non-Anthropic models designing from the brief and attacking it; `SYNTHESIS.md` is the decision briefs | Redesign |
| `redesign/decisions/` | 34 illustrations staging those briefs (never gates) | Redesign |
| `redesign/gates/` | The candidate gates that did not survive as examples: the JWS-substrate gates (`lib.js`), the `lastline.js` gates (superseded by the rulings — the cards say which), and the old revert table. The twelve that staged the current spec were consumed by the examples and deleted | Redesign |
