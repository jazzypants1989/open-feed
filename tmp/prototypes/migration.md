# migration — does §3.4's exit compose from mechanisms that already exist?

**Question.** §13.2 ends every adversary tier at the same place: what the protocol offers is
**exit**, real only if §3.4, §4.5, and §14 hold at once. At the time, none of §3.4 was exercised
anywhere — `verifyRecoverySignature` and `resolveFork` sat in `src/chain.js` with no migration
consuming them, and §9.3 invariant 5 had never seen a relocation. Do the existing mechanisms
compose into a working exit, and what does the text fail to say about it?

**Method.** Compose the **shipped** modules (never a model of them) into five scenes: (S1) a
cooperative migration carrying a back catalog byte-verbatim; (S2) a recovery migration against a
host that declines — including the two readings of the co-signature's `kid`; (S3) the abandoned
host tombstoning the back catalog afterwards; (S4) a stolen recovery key minting a *competing*
migration from the same predecessor; (S5) inbound replies addressed to the old feed. This was the
only exerciser of `verifyRecoverySignature`, `resolveFork`, and invariant 5 under a real
relocation; the gate keeps exactly those compositions and drops what `test/migration.test.js` now
drives through the composed reader across two origins (S3's retirement, the contest through
`MigrationStore`, S5's id-half matching).

**Numbers.** None load-bearing — every finding is a boolean verdict of shipped code (the printed
3/3 hash counts illustrate, they do not decide). What would make them stale: any change to
`src/chain.js`'s recovery-key resolution or fork preference, to `src/manifest.js`'s invariant 5
walk, to `src/publish.js`'s co-sign-then-sign order, or to §6.3's asymmetric signature stripping
in `src/jws.js`.

**Verdict.** The mechanisms compose, and every gap found was in the text, not the code — all
since absorbed. The `kid` on a migration's `_recovery_sig` names the **predecessor** (§3.4 path 3,
with §6.6's author binding scoped to `_sig`); a verified migration **retires** the predecessor's
chains (§3.4, shipped as `MigrationStore.isRetired`); the predecessor-feed-URL table fell to
id-half matching in the inbox. The record's B1 — two competing recovery migrations are
unadjudicated — is **now answered**, not open: §3.4 states outright that two recovery-based
migrations claiming one predecessor are unresolvable and a consumer MUST NOT follow either
without out-of-band confirmation, naming it §5.5's "both branches carry one" verdict arriving by
another route; §13.2 states the consequence — a stolen recovery key denies its owner an exit
rather than granting anyone an impersonation, so the recovery key's location *is* the exit — and
`MigrationStore` voids both claims and takes `settle()` as the confirmation. The root-key contest
S2 surfaced is likewise now plain text in §12/§13.2: a custodian holding the root key can contest
a departure, and delegated custody removes the capability outright.

**What the gate guards** (`migration.js`, revert-checked — the mutations below are rows in `tmp/revert-gates.js`, and `npm run prototypes:revert` re-applies each one and requires the gate to fail): the byte-verbatim carriage keeps every held hash; invariant 5 carries every id across
a relocation and trips on a dropped one; a recovery migration verifies against a declining host
while a self-naming `kid` stays refused; a competing claim by the stolen key verifies identically
and `resolveFork` refuses to adjudicate the pair; and §6.3's asymmetry keeps a stripped
co-signature breaking the document. Revert-check mutations (rows in `tmp/revert-gates.js`), each matching exactly once:

1. `src/chain.js`: `if (identityUrl !== identity) throw new VerifyError(\`kid names ${identityUrl}, not ${identity}\`);`
   → `if (identityUrl !== identityUrl) throw new VerifyError(\`kid names ${identityUrl}, not ${identity}\`);`
   — expected: "a kid naming the successor is refused" fails.
2. `src/manifest.js`: `for (const id of Object.keys(lastObserved.items)) {`
   → `for (const id of Object.keys(lastObserved.items).slice(0, 0)) {`
   — expected: "carries every id across the relocation" and "drops one id trips invariant 5" fail.

**Original:** `tmp/archive/migration-prototype.js` (scene narration, the S3 retirement argument,
S5's id-half analysis with its existence-oracle cost, and the S2 root-key-contest finding in
full).
