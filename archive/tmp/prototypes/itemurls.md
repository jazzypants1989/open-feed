# itemurls — derived item URLs: addressed by what, and priced against doing nothing?

**Question.** Can an individually-addressable item make §9.3's withholding verdict reachable at
all, and if so, addressed by id (human-meaningful, mutable) or by hash (the §5.1 value the
manifest already commits)? The do-nothing alternative — walk `next_url` to the end on every
poll — had to be priced first.

**Method.** Build a family journal with the **shipped** `Publisher`, reconcile one §7.4 page
against its manifest with the shipped `reconcileFeed` at both `partial` settings, then again with
§7.6 probes against a publisher that commits bytes and refuses to serve them. Derive URLs for
§7.2-shaped ids with the two encoders every implementer has to hand. Round-trip a standalone item
body through `parseIJSON`/`assertCanonicalBytes` (§6.3 under test) and compare its hash to the
same item parsed out of the feed's byte stream and to the manifest's committed value.

**Numbers.**

- **0 withheld** at either `partial` setting from a feed read alone, against dozens of committed
  revisions the reader cannot obtain — all `absent`, the state that accuses nobody. *This count is
  read out of shipped `src/manifest.js` and went stale once already: before commit 932404c the
  same read produced thousands of false `withheld` accusations, and this file is what caught the
  rewrite. Stale against any change to `reconcileFeed`'s `absent`/`withheld` split or the
  `unobtainable` probe semantics.*
- **3 of 3** refused §7.6 probes convict — the only path to the verdict. *Stale with the above.*
- **5 of 5** sampled ids derive a *different* URL under `encodeURIComponent` vs `encodeURI`, and
  **2 of 5** escape their path segment entirely — the normalizer §3.1 refuses to write. *Stale
  only if §7.2's id shapes or §3.1's never-decode rule change.*
- The do-nothing baseline, measured in the archived original on a ten-year catalog (10,950 items):
  a **multi-megabyte, ~200-fetch complete pass per poll**, which §13.4 budgets nothing for, vs one
  ~500 B fetch per suspected item. *Stale against item sizes in `src/publish.js` and §13.4's caps;
  exact figures in the original's output.*

**Verdict.** Adopt **hash-addressed** (§7.6, `{feed minus .json}/items/{hash}.json`). Without it
the withholding verdict is not weak but unreachable — the reader is not wrong, it is blind — and
the only core alternative is the multi-megabyte pass. Id-addressing needs exactly the
percent-encoding normalizer §3.1 declines to specify, at a place where getting it wrong is a 404
that reads as withholding. Hash-addressing needs no encoding rule, is self-verifying on arrival,
is the value the manifest already commits, and incidentally keeps superseded revisions fetchable,
which §7.3 otherwise makes impossible.

**What the gate guards** (`itemurls.js`, revert-checked — the mutations below are rows in `tmp/revert-gates.js`, and `npm run prototypes:revert` re-applies each one and requires the gate to fail): the shipped reconcile keeps
`withheld` reachable only through a refused §7.6 probe (the 932404c behavior, both directions);
the encoder divergence that disqualifies id-addressing; every committed hash staying URL-safe and
the shipped derivation staying under `/items/` unencoded; and §6.3's parser equivalence — a
standalone body round-trips to its own bytes and hashes identically to the feed-parsed item.
Revert-check mutations (rows in `tmp/revert-gates.js`):

1. `src/manifest.js`: `const probed = unobtainable.has(id);` → `const probed = true;`
   (assertions 1 and 3 should fail — a feed read alone starts accusing).
2. `src/chain.js`: `` return `${base}/items/${hash}.json`; `` → `` return `${base}/item/${hash}.json`; ``
   (assertion 7 should fail — the §7.6 derivation leaves its reserved prefix).

**Original:** `tmp/archive/itemurls-prototype.js` (scene narration, the ten-year corpus and its
byte measurements, the three-encoder table including the `new URL(id, base)` resolver mistake, and
the Q4 capability table).
