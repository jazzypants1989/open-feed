# subchain-gate — a sparse self-keyed key subchain inside the content log

**Candidate gate** (LOG+URL's answer to PLAN.md's held-fixed "the identity chain stays small and
self-keyed"; also load-bearing for LOG+KEY's spine).

**Question.** If key events thread through the one log by `kprev` links (dense `kseq`, full key
set per event), can a keys-only reader resolve current keys in O(key events) fetches without
handing a serving-path attacker the splice that §9.1.1 forbids skip links on the identity chain
to prevent?

**Method.** Key events over `lib.js`; the keys-only walk re-checks §5.2-step-3 continuity at
every `kprev` hop (signer valid — listed, non-revoked, non-delegated — in the *previous* key
event's set) plus `kseq` contiguity. Attacks: forged tip (attacker key), forged intermediate
(served in place of the real `kprev` target), a custodian branch signed by a *revoked* key that
hides its own revocation, and a delegated key advancing the subchain.

**Numbers** (stale if the walk or event shape changes): honest keys-only read = **3 fetches**
(head + tip key event; `kprev` landed on the pin) — kill bound was 2 + events-since-pin = 3.

**Kill criteria.** Any no-key forgery verifying on the keys-only walk; fetch count over the
bound. **Not triggered.** Forged tip and forged intermediate both refused (continuity), and the
intermediate also fails content-addressing (fetched bytes don't hash to the id `kprev` names).

**Verdict.** Sound, with the custodian case priced honestly rather than claimed away: a **revoked
key's holder** can mint a competing key event at an already-spent `kseq` that verifies against a
pin older than the revocation — which is **exactly today's post-theft fork class** (§5.5), no
weaker and no stronger; it is detected by comparison (two ids at one `kseq`) and refused outright
by any reader pinned at or past the revocation. The prohibition §9.1.1 states for identity-chain
skip links does not transfer, because every hop here keeps full continuity verification — the
thing manifest anchors replace. Delegated keys cannot advance the subchain (fails closed).

**Run:** `node tmp/redesign/gates/subchain-gate.js`
