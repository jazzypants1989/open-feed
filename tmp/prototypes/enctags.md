# enctags — what does §15.2's multi-recipient envelope actually cost, and where?

**Question.** The original §15.2 gave every recipient slot its own ephemeral (`epk`) and no label,
so a reader trial-decrypted slots, and §15.5.7 existed to cap that (RECOMMENDED 1024 attempts,
"SHOULD attempt keys newest-`iat` first"). Was the cost the missing tag, or the per-recipient
ephemeral — and can either fix be adopted alone?

**Method.** Three envelopes re-derived and measured side by side: (A) per-recipient `epk`,
untagged — the original §15.2; (B) one shared `epk`, untagged — isolating the ephemeral change;
(C) shared `epk` plus a blinded 8-byte `_tag` per slot, domain-separated from the KEK derivation.
Correctness first (opens for recipients, shut for strangers, tags unlinkable across items), then
wire size and decrypt cost at N = 10/30/1024 recipients × K = 1/10 reader keys — K matters because
§15.1 makes a reader's key count grow and never shrink. A final section ran the **shipped**
`seal`/`open` and gated on the shipped envelope actually being C.

**Numbers** (from the archived original's run; wall-clock rows drift with hardware — re-run
`tmp/archive/enctags-prototype.js` for fresh ones; all go stale if §15.2's envelope shape or
`src/enc.js`'s slot construction changes):

- ECDH per open: A pays up to N×K key agreements; B and C pay K — one per reader key, flat in
  audience size.
- But B alone inverts the loop (keys outer, slots inner), so a wrong key costs a full sweep of
  unwraps: at N=1024, K=10 that is ~9,200 AES unwraps and hundreds of milliseconds for a
  recipient in slot 1, where A stays under a millisecond. B wins at family scale (N=30) and
  loses at N=1024.
- C stays under a millisecond in every measured case, including the common one — a
  non-recipient, who under A pays the full N×K and never exits early.
- Wire: the shared ephemeral removes a 43-char X25519 key (~60 B of JSON) from every slot; the
  8-byte `_tag` costs ~20 B back. Net: C is ~30% *smaller* than A at family scale.

**Verdict.** Adopted wholesale as §15.2 (and §15.5.7 deleted with its magic number). The cost
driver was the **per-recipient ephemeral**, not the missing tag — and the two halves are welded:
a shared ephemeral **without** tags forces keys-outer/slots-inner, so every wrong key costs a
full sweep of unwraps and B is worse than A at large N; tags **without** a shared ephemeral are
uncomputable until the reader has already done the per-slot ECDH they were meant to skip, saving
only the cheap unwrap. Neither half is adoptable alone — a future edit that keeps one and drops
the other reintroduces the cost the pair removed. Privacy is unchanged: computing a tag needs one
of the two private halves, and tags are per-item because the ephemeral is, which is the property
§15.2's `kid` ban protects. The known weakening: one leaked ephemeral *secret* exposes the CEK
path for every recipient, not one — same in-process exposure the CEK already has. And no quantity
of measurement substitutes for a cryptographer; nobody outside this repo has reviewed §15.

**What the gate guards** (`enctags.js`, revert-checked — the mutations below are rows in `tmp/revert-gates.js`, and `npm run prototypes:revert` re-applies each one and requires the gate to fail): the shipped envelope stays scheme
C — one shared `epk` and none per slot, every slot tagged, no `kid` sealed or tolerated at open,
tags per-item and computable only from a private half, no recipient roster on the wire, an
outsider refused, and §15.1's revoked-key refusal for new senders. Revert-check
mutations to `src/enc.js` (rows in `tmp/revert-gates.js`):

1. Reintroduce a per-slot `kid`:
   from `return { header: { alg: ALG, _tag: slotTag(z) }, encrypted_key: wrapped.toString('base64url') };`
   to `return { header: { alg: ALG, kid: jwk.kid, _tag: slotTag(z) }, encrypted_key: wrapped.toString('base64url') };`
2. Drift the tag's domain separator:
   from `export const TAG_LABEL = 'openfeed-slot-tag';`
   to `export const TAG_LABEL = 'openfeed-slot-tag-v2';`

**Original:** `tmp/archive/enctags-prototype.js` (the three re-derived envelopes, the size and
speed tables, and the full adoption narrative).
