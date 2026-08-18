# freshness — what does a conforming consumer say about a host that simply stops?

**Question.** Every attack the two chains detect is a *mutation* — drop an item and §9.3
invariant 1 fires, roll back and `seq` decreases, rewrite and a hash mismatches. One mutation was
left: the null one. A host serving the last honest version forever passed every signature, every
invariant, and every pin check, and "the host stopped publishing you" read exactly like "you had
nothing to say" — which, for §13.2's hostile custodian, is precisely the impression to give the
family. This is TUF's freeze attack, and the pre-§9.1.2 spec did not name it.

**Method.** Freeze a six-day family hub's snapshot for ninety days and run the **shipped** reader
over it, rule off (`lagCeiling: Infinity`, the pre-§9.1.2 protocol, run rather than recalled) and
rule on (Q1); run the same host mutating instead — item withheld, manifest rolled back against a
pin — to show "stop" was uniquely silent (Q2); show §9.3 invariant 3 cannot reach it, since it
bounds uncommitted items and a frozen host serves none (Q3); drive the shipped `freshness()` and
`Publisher`'s signed `_next_update` through a declared 1-day rhythm that freezes, an honest
declared 5-day window, a ten-year greedy declaration (Q4/Q5), and a key custodian who advances an
EMPTY manifest on schedule (Q6).

**Numbers.** `_next_update` costs **26 bytes** per retained manifest version (945 vs 919 on the
six-day hub) — stale if the manifest wire shape or RFC 8785 serialization of the field changes.
The consumer ceiling is §9.3's RECOMMENDED **7 days** reused, so the rule adds no second number —
stale if `LAG_CEILING_SECONDS` changes. Everything else is a boolean verdict of the shipped
reader.

**Verdict.** ADOPTED as §9.1.2: a publisher-declared freshness deadline inside the signed bytes,
capped by the consumer's own ceiling — `min(declared, updated + ceiling)`, and the asymmetry is
the design. A publisher may promise to be *faster* than the ceiling and be held to it, never
slower, which is why a declared bound does not inherit §9.3's objection to a *derived* one (a
greedy declaration buys a hostile host nothing, Q5) and why a first-contact consumer gets a real
deadline on its first read. The verdict is STALE — unverified, the pin held and not advanced —
never equivocation. What it does NOT buy ships beside the rule: a key custodian advances an empty
manifest — same items, fresh `updated`, fresh `_next_update` — and stays perfectly punctual while
suppressing every new post (Q6); the bound defeats a host that cannot sign, and §13.2's terminal
adversary is not that host.

**What the gate guards** (`freshness.js`, revert-checked 2026-08-17: each proposed mutation was applied in turn, the gate failed naming the broken claim, and the tree was restored green (runner: the mutations recorded above)): the freeze stays silent with the
rule off and reported with it on; mutations keep their verdicts while invariant 3 keeps not
reaching the freeze; a declared deadline keeps firing early and staying quiet in an honest
window; the consumer ceiling keeps capping a greedy declaration; and the Q6 caveat stays true —
the punctual empty-advancing custodian must keep evading the rule, because §9.1.2's text claims
no more than that. Proposed revert-check mutations (perform, observe the gate fail, revert):

1. `src/manifest.js`: `const deadline = Math.min(declared, manifest.updated + ceiling);` →
   `const deadline = Math.max(declared, manifest.updated + ceiling);` — assertions 2, 5, and 7
   should fail (with no declaration the deadline becomes Infinity and the freeze goes silent
   again; a greedy declaration outruns the ceiling).
2. `src/reader.js`: `const stale = freshness(manifest.manifest, { now: now(), ceiling: lagCeiling });`
   → `const stale = null;` — assertions 2 and 5 should fail (the reader stops surfacing §9.1.2's
   verdict at all).

**Original:** `tmp/archive/freshness-prototype.js` (scene narration, the pre-adoption modelled
`freshness()`, the false-positive sweep prose, and the full cost argument against §13.4's 1 MB
ceiling).
