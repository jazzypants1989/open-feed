# canonicality — does §6.3's wire rule have to be MUST everywhere?

**Question.** §6.3 requires every chained document to arrive as its own canonicalization, and
`HANDOFF.md` argued against the rule as soon as it shipped: it raises the conformance bar for every
publisher, and a middle setting was never tried. Three regimes: (A) MUST everywhere — what shipped;
(B) MUST for retained history, SHOULD at the tip; (C) drop canonicality, hash the served bytes
verbatim.

**Method.** Run the **shipped** `assertCanonicalBytes`/`documentHash`/`Publisher` (never a model of
canon) against: (Q1) both readings of B — a pin records a hash and a `prev` names one, so B must
pick which byte string the tip hashes to, and both picks are run against an honest publisher who
pretty-printed a tip; (Q2) §14's bundle shape, which nests whole chained documents as JSON *values*
and needs their published bytes back; (Q3) A's cost, enumerated as serialization paths rather than
asserted as a bar; (Q4) the double-canonicalization waste HANDOFF named, timed at §13.4's ceiling.

**Numbers.**

- One seq-1 identity document: **582 B** canonical, **709 B** pretty-printed — the two byte strings
  B forces one `seq` to have. Stale if: the reference `Publisher`'s document shape changes.
- C's only §14 repair is carrying documents base64-wrapped instead of nested: 709 B → **946 B
  (+33%)**, plus a second representation in every §14 consumer for documents it already parses.
  Stale if: §14 stops nesting documents as JSON values.
- Q4 (an **open optimization, not yet taken**): once `assertCanonicalBytes` has proven the served
  bytes canonical, `documentHash`'s second canonicalization is waste — `sha256(bytes)` is the same
  value. The archived original timed canonicalize-twice vs hash-proven-bytes over 100/1000/10000-item
  manifests at §13.4's 1000-versions-per-update walk; taking it needs the fetched bytes threaded
  into `walkToPin`, which today takes parsed documents only. Stale if: `walkToPin`'s signature
  changes, or `documentHash` stops re-canonicalizing. Re-run the archive for current timings.

**Verdict.** Keep A, and the deciders are sections the argument never named. B is not a middle
setting but a fork of §5.4: a version's tip bytes and retained bytes must be the same string, so
exempting the tip makes an honest publisher either unwalkable (B-canon — its `prev` names bytes no
pin matches) or reported as equivocating (B-bytes — one `seq`, two hashes, and §5.3.1 accepts
nothing further without a human re-pin). C fails at §14: a bundle nests signed documents as JSON
values and requires them byte-verbatim, which only closes when published bytes ARE the
canonicalization — under C nothing downstream can reproduce them and the restored chain does not
link. A's cost is not the feared bar: signing already computes the exact bytes, so serving them is
keeping a string, and the one reachable failure is serializing twice — which is why §6.3 names the
trailing newline explicitly.

**What the gate guards** (`canonicality.js`, revert-checked — the mutations below are rows in `tmp/revert-gates.js`, and `npm run prototypes:revert` re-applies each one and requires the gate to fail): B-bytes stays read as
equivocation by the shipped code — `assertCanonicalBytes` accepts the canonical retained copy whose
hash contradicts a tip pin over pretty bytes; the shipped code keeps refusing a pretty-printed body
and canonical-bytes-plus-trailing-newline; a §14-nested value keeps reproducing published bytes
under A and keeps being irreproducible under C; and the reference publisher keeps emitting only
canonical files. Revert-check mutations (rows in `tmp/revert-gates.js`; each one line, matching exactly once):

1. `src/canonical.js`: `if (!served.equals(expected)) {` →
   `if (!served.equals(expected) && !served.equals(Buffer.concat([expected, Buffer.from('\n')]))) {`
   — tolerating a trailing newline should fail the trailing-newline claim.
2. `src/publish.js`: `out.set(url.slice(this.identity.length), canonicalBytes(doc));` →
   `out.set(url.slice(this.identity.length), Buffer.from(JSON.stringify(doc, null, 2), 'utf8'));`
   — a publisher that serializes twice should fail the every-file-canonical claim.

**Original:** `tmp/archive/canonicality-prototype.js` (scene narration, the four-regime consumer
model, Q3's serializer table, and Q4's timing harness).
