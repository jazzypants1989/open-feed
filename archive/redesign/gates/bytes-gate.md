# bytes-gate — does encoded-payload signing delete canonicalization?

**Candidate gate** (tests a design on trial, not shipped `src/`; see `../CANDIDATES.md`).

**Question.** Both LOG candidates stake their core economy on carrying every signed artifact as a
compact-JWS token with *encoded* payload (RFC 7515 without RFC 7797), so the token's bytes are the
artifact's identity and nothing is ever canonicalized. Is that deletion safe — can no two distinct
byte strings verify as one event, and does no verification step ever re-serialize a parsed value?

**Method.** `lib.js` implements the candidate construction over `src/hash.js` + `src/canonical.js`'s
`parseIJSON` (payload hygiene only). The gate: (1) verifies an ordinary event; (2) shows two
encodings of one logical object are two events (bytes are the identity; meaning-equality is never
consulted); (3) sweeps every byte position × 9 replacement characters plus append/truncate forms,
asserting zero mutations verify; (4) constructs a trailing-bit base64url variant whose *decode* is
identical and asserts the strict-spelling rule rejects it; (5) asserts the four surviving parse
rejections; (6) cross-key/cross-kid failures.

**Numbers** (stale if the token shape or `lib.js` changes):
- Event token 294 B for a 102 B raw payload (+1.88× envelope overhead — base64 of payload + header + sig).
- Kill sweep: **2,635 byte mutations, 0 verified.**
- Canonical-spelling variant found (`…D0Ch` vs `…D0Cg`, identical decode) and rejected.
- Hygiene residue: **4 parse rejections** survive from §6.3 (duplicate members, `__proto__`,
  integer beyond ±2⁵³, lone surrogate) — each is semantic-divergence hygiene on a *verified*
  payload, not signature integrity. Everything else in §6.3 (~2,400 words) has no analog here.

**Kill criterion.** Any two distinct byte strings that verify as one event, or any check that
must parse-then-reserialize. **Not triggered.** (The no-reserialize half is structural: the only
`JSON.stringify` in `lib.js` runs at signing time; the only hash is over token bytes.)

**Verdict.** The deletion is safe under one carried-over rule: strict base64url spelling
(alphabet + canonical re-encode), without which a lenient decoder reads two spellings of one
signature while the served bytes differ — the §5.1 framing attack transplanted. The candidates'
signing chapter is this construction + the strict-spelling rule + the 4-item hygiene list.

**Run:** `node tmp/redesign/gates/bytes-gate.js`
