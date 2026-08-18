# export — is §14 an exit, or a backup with an exit's vocabulary?

**Question.** §14 sets its own bar — "on demand, without operator approval," "byte-verbatim,"
and the sentence worth testing: "a consumer restores from a bundle by verifying it exactly as it
would verify live documents. Nothing about verification changes because the bytes arrived in a
file." Is that literally true of this repository — a bundle produced and verified with NO network
and NO bundle-specific verifier — and does the bundle, ALONE, on a machine the host cannot reach,
re-establish everything its owner had, including a migrated identity?

**Method.** Restore a bundle using only the **shipped** generic verifier — `walkToPin` over both
chains from genesis, `identityChainPolicy`/`manifestChainPolicy`, `assertHistoryInvariants`,
`reconcileFeed` — with an array lookup standing in for the fetch function, so the claim "no
bundle-specific logic" is exercised rather than asserted (in `src/`, `restoreFetcher` is that
fetch and `verifyBundle` is `createReader` unchanged — a property that decays silently, which is
why the gate re-proves it from the primitives). Then: (S2) serialize, parse, restore again, with
an extension field no schema has a column for; (E1) migrate the identity to an owned domain
(§3.4), back catalog byte-verbatim, genesis co-signed by the recovery key, and resolve the
co-signature against what the successor's bundle holds vs against the predecessor's chain.

**Numbers.** Decomposition's blast radius is **one field**: an item rebuilt from columns, dropping
only the member the schema never heard of, neither hashes to its manifest entry nor verifies its
signature — nothing warns, the JSON is well-formed (stale if §7.2's preserve-unknown-members rule
or §6.3's canonicalization change). Attachments, modelled at 2,400 photos × 2.4 MB: inlined
base64 **7.50 GB** in one JSON value that must be parsed whole, archive container **5.62 GB**
streamable, url+hash fallback a few KB and **0 photos** — every URL pointing back at the host
being left (stale if §14's attachment forms change; the photo counts are modelled constants, not
measurements of a deployment).

**Verdict.** §14's central claim is literally true — the restorer needed only a different fetch
function — and JSON round-tripping is safe because canonicalization is a function of the parsed
value; what kills a bundle is decomposition, and `received` items are the unanswerable case,
since their fields belong to a schema the exporter will never have. Both gaps found were adopted:
**E1**, a successor's bundle verified every signature, both chains, and every item, and could not
prove the one claim that made it a successor's bundle — the recovery co-signature resolves in the
PREDECESSOR's chain, which no slot held, and the successor listing the same key itself proves
nothing (§4.2). §14 now requires `identity.history` to carry the predecessor's retained versions,
and `buildBundle` refuses assembly without them. **E2**, SHOULD-inline steered implementers at
33% inflation and a multi-GB single parse; §14 now makes the archive container the ordinary form.

**What the gate guards** (`export.js`, revert-checked 2026-08-17: each proposed mutation was applied in turn, the gate failed naming the broken claim, and the tree was restored green (runner: the mutations recorded above)): a bundle still restores through the
generic verifier alone — both chains walked from genesis out of the file, items reconciled with
their tombstone intact — surviving a serialize/parse round trip byte-verbatim, extension field
and all; and the E1 asymmetry, the only test of §14's predecessor-versions rule: the successor's
own keys cannot verify its recovery co-signature (`withoutAncestor.valid === false`) while the
predecessor's retained chain can (`withAncestor.valid === true`). Proposed revert-checks:

- `src/chain.js`: `if (identityUrl !== identity) throw new VerifyError(` →
  `if (identityUrl === identity) throw new VerifyError(` — both E1 assertions should fail (the
  self-blessing §4.2 rules out is accepted, the genuine ancestor is refused).
- `src/manifest.js`: `record(id, gone ? 'deleted' : 'live', { version, hash });` →
  `record(id, 'live', { version, hash });` — assertion 1 should fail (the restored feed's
  tombstone collapses into `live`, the state-merging §13.13 forbids).

**Original:** `tmp/archive/export-prototype.js` (scene narration, the hand-rolled bundle shape
predating `buildBundle`, the delivered/received/unpublished slots, and the S4 container
arithmetic).
