# lastline-gate — is last-line signing as safe as compact-JWS?

**Candidate gate** (tests the fresh-start design on trial, not shipped `src/`; see
`../HANDOFF-fresh-start.md` §3 claim 1). Substrate: last-line signed files over `lastline.js`.

**Question.** The design signs a file as *JSON bytes, one `\n`, base64url Ed25519 over the bytes*
and verifies by splitting at the last `\n`. `bytes-gate.md` proved the compact-JWS analog safe
*under one carried-over rule* — strict base64url spelling — and a four-item parse-hygiene list.
The handoff argues last-line inherits that result; the reference verifier in both
`decisions/inventory-*-exp.js` uses `Buffer.from(sig, 'base64url')`, which is lenient. Did the rule
survive the move, and if not, what does its absence cost?

**Method.** Every byte of the body, the separator, and the signature is replaced (12 characters),
has each inserted before it, and is deleted — under a strict decoder (86 alphabet characters whose
canonical re-encoding is themselves) and the lenient one. The signature region additionally gets
every byte value 1–255 appended and inserted mid-signature, six whitespace/padding forms, the
other 15 spellings of the last character's unused bits, and the standard-alphabet spelling. Then
the helpful-host transforms (`writing-exp.js`'s three plus CRLF, BOM, tab-indent), the Ed25519
S+L malleation, five parse-divergence texts against `parseStrict` and `JSON.parse`, and a
cross-key check.

**Numbers** (stale if `lastline.js`'s sign/decode, the sample payload, or `makeKey`'s seed change):
- File 148 B = body 61 + separator 1 + signature 86.
- Body sweep: **1,520 mutations, 0 verify** under either decoder. Separator sweep: **24, 0**.
- Signature sweep: **2,658 mutations, 0 verify under strict, 645 verify under lenient** —
  **638 distinct files** for one signature, every one with the same body address and a different
  file hash. Node's decoder skips every non-alphabet byte and ignores the last character's four
  unused bits; only length-changing alphabet edits and an embedded `\n` fail.
- Helpful hosts: 6 of 6 transforms fail closed under both decoders (trailing `\n` moves the
  split; CRLF, BOM, pretty-print, key-sort, tab-indent alter the body).
- S+L malleation: rejected by Node's verifier.
- Hygiene: `parseStrict` rejects 5 of 5 (duplicate member, `__proto__`, integer past 2^53, lone
  surrogate, leading BOM); `JSON.parse` accepts 4 of 5. "No canonicalization" removes the
  *serialization* question, not the *two-readers-disagree* question — the spec owes the sentence.
- A file with no separator: the reference `parse` computes `lastIndexOf → -1 → subarray(0, -1)`,
  silently dropping the last byte and reading the whole file as the signature. It fails closed
  only because the decoded junk is never a valid signature; `split` rejects it outright.

**Kill criterion.** Any body or separator mutation verifying under either decoder; any signature
mutation verifying under strict; any lenient survivor whose body address changes; any host
transform verifying. **Not triggered.**

**Revert-checked** (`node tmp/redesign/gates/revert.js`, four rows, all caught): disabling the
canonical re-encode check (the 15 last-character spellings pass strict); making `verify` default
to the lenient decoder (645 survivors pass); hashing the file instead of the body (addresses
diverge across survivors); disabling the duplicate-member rejection.

**Verdict.** The body is not malleable and no honest-host transform survives; that half of the
handoff's argument holds. The signature line is **unboundedly malleable under the decoder every
experiment uses**, which `bytes-gate.md` already named as the framing attack and answered with
the strict-spelling rule. The rule was dropped in transit. Two sentences restore it, and both are
MUSTs the design does not yet state: *the signature line is exactly 86 base64url characters whose
canonical re-encoding is themselves*, and *a file's address is the hash of its body*. Without the
second, an implementer who hashes "the file" — the natural reading of "hash-addressed" — gives
one post 638 addresses at a host's whim. The four-item hygiene list transfers unchanged.

**Run:** `node tmp/redesign/gates/lastline-gate.js`
