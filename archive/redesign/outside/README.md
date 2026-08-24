# Outside perspectives — six non-Anthropic models, two passes

> **⚠ Read `PROMPT-pass1-DEFECT.md` first.** The first version of the pass-1 brief misstated
> `GOALS.md`'s "no dependencies" priority as a closed list of five allowed primitives. Pass 1 was
> re-run against a corrected brief; the defective brief and everything produced under it are kept,
> quarantined, so their hashes still resolve.

**2026-08-20.** Every agent that has ever worked this repo has been an Anthropic model, and the two
failed redesign attempts failed the same way: they inherited the current spec's shape. This
directory is the correction — six frontier models from six different labs, none of which has seen
this repository, designing the protocol from the goals alone and then attacking a summary of ours.

## Why the raw HTTP API and not the `opencode` CLI

`opencode run` gives the model tools and a working directory. That is exactly what we did not want:
the owner's instruction was *"the less the other agents know about the current repo, the better."*
`ask.js` posts to OpenCode Go's OpenAI-compatible endpoint directly, so each model sees the prompt
bytes and nothing else — no filesystem, no `src/`, no spec, no tests, no vocabulary.

Note that the installed `opencode` CLI's model list is stale: it stops at `glm-5.2`, while the raw
endpoint serves `glm-5.3`. Trust `GET /zen/go/v1/models`, not `opencode models`.

The Chinese-hosted models (`deepseek-*`, and others) return HTTP 403 `RegionError` until the
workspace opts in at `https://opencode.ai/workspace/<id>/go`. That opt-in is a one-time account
setting, not something the script can do.

## The two passes

| | contents | what it is for |
|---|---|---|
| **Pass 1** | `PROMPT-pass1.md` alone — the floor, the priorities, the non-goals, the seven scenarios, the adversary. No mention of Open Feed, JSON Feed, JOSE, manifests, chains, or pins. | An uncontaminated independent architecture. This is the artifact whose value depends on the models *not* knowing what we built. |
| **Pass 2** | pass 1 replayed as real conversation history, then `PROMPT-pass2.md` — a summary of our direction plus three tasks: attack ours, attack your own, reconcile. | Targeted critique. Anchoring is real here and intended; that is why the two passes live in separate files. |

Pass 2 replays the model's own pass-1 answer as an `assistant` turn rather than quoting it, so each
model critiques its own design as its own rather than as somebody else's text. No other text is
sent: the corrected pass-1 answer *is* the correction, so `PROMPT-pass2.md` carries none.

**`PROMPT-pass2.md` is a paraphrase of `GOALS.md`, and it dropped one clause** — the departing
client's "send this link to your people" (`GOALS.md:73`). Five of six models attacked relocation;
`SYNTHESIS.md` brief A says which parts of those attacks the omitted clause answers. Any future pass
should send the document verbatim. This is the second time a paraphrase in a prompt became a
"finding" in this directory.

The adversary is stated genericized — "an abusive family member during a divorce" — never with a
relation named. These are six external APIs that may log and retain prompts.

## Running it

```
node tmp/redesign/outside/ask.js --dry-run --pass 1   # print the exact bytes, spend nothing
node tmp/redesign/outside/ask.js --pass 1             # all six models, concurrent
node tmp/redesign/outside/ask.js --pass 2             # needs pass 1 responses on disk
node tmp/redesign/outside/ask.js --pass 1 --model glm-5.3   # re-roll one
node tmp/redesign/outside/check-citations.js          # every cite resolves; every “quote” (`file:line`) matches
```

`OPENCODE_KEY` is read from the gitignored `.env` and never printed, logged, or written to a
response file. A model that fails is recorded as an `**ERROR**` body in its own file and does not
abort the others.

Every response file carries the SHA-256 of the prompt that produced it, so "which bytes produced
this answer" stays checkable rather than assumed — the campaign's own working rule, applied here.

Reasoning traces are kept in a collapsed `<details>` block at the end of each file. They are noisy,
but rejected alternatives frequently appear only there. A trace is never quoted as an answer.

## Reading the results

**`SYNTHESIS.md` (v3) is the product; the twelve response files are the evidence.** It is organized
by *decision*, not by model: one brief per open design question, each stating what `GOALS.md` says,
the attack the models found, what this repo already measured, and every option with its price.
Part II is the corrected per-model record; Part III is one agent's leanings, labeled; Appendix A
lists what the previous draft got wrong.

Two earlier drafts are kept because their retractions live in them: `SYNTHESIS-v1-stale.md` was
written against the defective brief; `SYNTHESIS-v2-superseded.md` quoted the quarantined v1 answers as
the corrected round and passed a citation check that only tested whether a cited line existed.
`check-citations.js` now verifies quoted text. **A suggestion is not a finding until it has been read
at its line** — and the models confidently re-propose things this project already killed with recorded
reasoning (`tmp/redesign/rejections.md`, `tmp/prototypes/*.md`, `tmp/redesign/gates/*.md`).

## Gateway behavior, learned the hard way

- **`finish_reason: null` usually means the stream was cut** — check it on every response; a cut
  answer looks complete until you read its last sentence. Exception: `gpt-5.6-luna` returns `null` on
  every run, streamed or not, and both of its shipped answers end on complete closing sections. For
  that model the field is uninformative; read the tail.
- **Heavy reasoning models overrun the stream limit.** `deepseek-v4-pro` and `kimi-k3` each produced
  60k–173k characters of reasoning and then died before emitting a word of answer. `--effort medium`
  fixes most of it by bounding the thinking phase; `glm-5.3` rejects `medium` outright and needs
  `low`, `high`, or `max`.
- **Pass 2 needs `--no-stream`.** It replays the whole pass-1 answer as context, so the request is
  large and the streamed response is much likelier to be cut mid-sentence. The single-response form
  survives. `reasoning_effort` is stamped in each response header; whether a run was streamed is not
  (the superseded streamed attempts are in `responses/pass2-streaming-truncated/`).
- **`ask.js` has a 20-minute `AbortSignal.timeout`.** Without it a stalled stream hangs the driver
  indefinitely — one run sat at 75 minutes with no bytes and no error.
- **Two models could not be made to work at all.** `deepseek-v4-pro` truncated on every attempt;
  `grok-4.5` returned upstream HTTP 503 every time. They were replaced by `minimax-m3` and `hy3`
  rather than retried further, keeping one model per lab.

## Directory contents

| | |
|---|---|
| `PROMPT-pass1.md` | the corrected brief, SHA-256 `ba5166e3…` — what all six pass-1 answers were generated from |
| `PROMPT-pass1-v1-defective.md` | the original, SHA-256 `eab38988…`, kept so the hashes in the quarantined responses still resolve |
| `PROMPT-pass1-DEFECT.md` | what was wrong with it, which answers it touched, measured per model |
| `PROMPT-pass2.md` | our direction summarized from `GOALS.md`'s decision bullets (one clause dropped — see above), plus the three tasks |
| `responses/` | six pass-1 and six pass-2 answers, each with a provenance header |
| `responses/v1-defective-brief/` | everything produced under the defective brief — quarantined, excluded from all counts, never quoted without saying so |
| `responses/pass2-streaming-truncated/` | pass-2 answers cut by the stream, kept for comparison against the `--no-stream` retries — same rule |
| `SYNTHESIS.md` | v3, the decision briefs |
| `SYNTHESIS-v2-superseded.md`, `SYNTHESIS-v1-stale.md` | earlier drafts, kept for their retractions |
| `ask.js`, `check-citations.js` | the driver and the citation/quotation checker |
