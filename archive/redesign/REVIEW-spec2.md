# The skeptical review of `open-feed-spec-2.md` — 2026-08-23

**Written by the agent the owner asked to review the spec before it becomes the spec.** Every
finding below that code can stage has a gate in `tmp/redesign/gates/` that stages it against the
text *as written* — the weekend reader and publisher, which implement the text faithfully, over a
socket against `hub.js` (§9 as written, with knobs for each proposed repair). The gate proves the
defect and prices the repair in the same run; its card carries the numbers. Findings that are
text-only are listed with the line. Three explorers first mapped the rulings record, the gates,
and `src/`; a fourth was told to *refute* the five headline findings and confirmed all five, one
of them worse than stated.

Re-run before quoting: `for f in tmp/redesign/gates/*-gate.js; do node "$f" || echo RED $f; done`
and `node tmp/redesign/gates/revert.js`.

## A. Protocol defects — each touches a recorded ruling

| # | finding | gate | repair | ruling it touches |
|---|---|---|---|---|
| A1 | **The court has no entry at any chain length the reader never observed, and a restore hop is signed by nobody but its vouchers** — so anyone holding Alice's *public* chain forks below the length a reader met her at, with a self-vouched restore carrying a court of one; the reader adopts that court (§8.1 step 5), follows the forger, deletes her real court, and thereafter reports the real Alice as `host` forever. Needs no key of hers. | `coldcourt-gate` | every hop carries the list in force before it (165 B per rotation) — or a unified hop `{key, court, sig?, vouchers?}` that additionally lets her add vouchers to a rotation she already made | RULINGS §11.3, §12; `court-gate` |
| A1b | **Rule 3 is applied only inside a split.** A self-vouched restore at the length the reader *does* hold a court for extends the pin, so the walk judges it by its carried court and follows it — until Alice's branch happens to be seen. | `coldcourt-gate` (control row) | a reader holding a court at a hop's length judges the hop by it, extension or split | same |
| A2 | **§9.5's "the owner's file" — signed by *any* chain key — lets a rotated-out key squat every number she has not reached**, one PUT each, 409 to her forever, and readers see nothing. The rule fails the test it was added for. | `oldkey-gate` | "the owner's file": declares `n`, and is signed by the key the chain *currently* ends on or is listed at that number and address | RULINGS §12.5 |
| A3 | **A hub that "checks nothing" stores a stranger's profile or head** given only a GET's ETag; every reader then says `identity`; the only remedy is a write war at one PUT each. | `hubwrite-gate` | a hub that accepts writes MUST verify the profile (chain walks, signed by its tip) and the head (signed by the current key); split §13's hub into *serving* and *accepting writes* | RULINGS §11 ruling 3 continued, §12.5 |
| A4 | **`pending` releases nothing.** Nothing any reader sees before the device confirms depends on the line; the hub cannot confirm; the device can publish the post at the next number with nothing it lacks. Its one purpose — a scheduled post keeps Monday's number — is stated nowhere, and it costs 18 spec lines across seven sections. | `pending-gate` | cut it, or keep it and state the purpose | RULINGS §11.5 — **owner rules** |
| A5 | **"A number is issued once" reaches only one head.** After a rewrite the fold accepts a withdrawn number at *any* hash; with the withdrawal lines still present it accepts none — so whether Alice may re-list what a thief withdrew depends on whether he happened to rewrite, and a reader pinned during his withdrawals falsely accuses her host on an honest restore. | `oldkey-gate` | re-listing only at the identical hash; the pin remembers withdrawn hashes | §5.2 — **owner adopted** (plan mode) |
| A6 | **A reply to a sealed post cannot lawfully be sealed.** The audience is reading keys; §4.8 allows sealing only to keys from verified profiles; a replier who knows a member only from the envelope holds an X25519 key and nothing leading to a profile. Under the rule he seals to 2 of 3 and the thread splits silently — the failure §7.5 says the inside audience exists to prevent. | `audience-gate` | audience entries `{key, read, at}`, §6.4's target shape; §4.8 unchanged | RULINGS §10 (ruling 10) |
| A7 | **The spoken code cannot tell two versions of one identity apart**: both share the genesis, both speak the same six words. | `spoken-gate` | define the code over a key; the out-of-band route may carry the *current* key; a reader given one follows the branch containing it | RULINGS §1, Q5 |
| A8 | **Sealed photos have no construction.** §5.4 says "the bytes at the listed hash are ciphertext" and stops: which key, which cipher, which nonce, where the key travels. Two implementations cannot interoperate. | — (text) | one paragraph: random 32-byte key per photo, ChaCha20-Poly1305, zero nonce, listed hash = hash of the ciphertext, `media: [{hash, key}]` inside the envelope | RULINGS §11.6 |
| A9 | **The 2-byte length prefix caps a sealed plaintext at 65,535 bytes**, unstated; the reference envelope refuses by exception. | `audience-gate` §4 | state the ceiling, or strip trailing zeros (JSON never ends in NUL) | Q7 |

## B. The reference disagrees with the text (fix in code; no ruling)

- `envelope.js:54-57` derives dummy slots from the content key: any recipient regenerates them and
  counts the true audience. §7.4: "a tag nobody can derive." Use random bytes (B.8 changes).
- `envelope.js:66` `timingSafeEqual` throws on a tag of the wrong length: a hostile slot crashes
  the client; §7.3 says keep scanning.
- `weekend-reader.js:160` says *no head newer than the one this reader holds*; §8.2's note is *no
  head I can verify*, and the difference is §8.2's whole point. `:141` emits a fifth note §8.3
  does not list.
- `weekend-reader.js:103` reads a repeated `[n, hash, "pending"]` as a confirmation; §5.5 says a
  *bare* line.
- `weekend-publisher.js:60,72` computes the entity tag as SHA-256 rather than reading the header;
  §9.1 says the tag is opaque. `amendHead` also folds a head it never verified.
- "recently restored for seven days" (§4.4, §14.2) has no clock in code: the flag is permanent.
- §6.4's target-hash MUST lives only inside `twohubs-gate.js`, not in the reader.
- §4.3's "a restore changes the key and nothing else" is checked nowhere; `forkcourt-gate.js:45`
  stages the violation and calls it valid.
- `lastline.js` still carries the single-salt commitment spec-2 forbids and a `prev` member the
  spec deleted; nine green gates run on it. Substrate drift — note it on the cards, do not rewrite
  history.
- `tmp/regen2.js` and every gate are absent from `npm run check`; `package.json` still describes
  the spec-1 verifier.

## C. Text defects (editorial)

- §4.1: "at 40 bits a laptop core finds a colliding key in under a second" — measured: about a
  year on a core, 4 days with the point-addition shortcut, 0.1 h on a GPU; eight orders of
  magnitude off. Six words hold at ~760 GPU-years under the most aggressive model; five would
  not. Quote the table (`spoken-gate`).
- §3.2: RFC 8032 does not *permit* randomized signing; some libraries (Apple CryptoKit) do it.
- §10: `unverifiable` is a fourth verdict word against §8.3's MUST; say the read returns no
  verdict because it did not complete.
- §4.4: a one-member list is a court of one — that member owns the identity at that length, for
  every reader that saw it, even after she rotates away. Say so; apps SHOULD require two or more,
  or the owner alone.
- §4.1 never defines the link (`https://hub/name#<genesis>` appears only in §12's h-card note).
- `target.at` (a URL) collides with the post's `at` (a time). Rename to `loc`.
- §12's views have no path in the publish interface, and a dumb hub cannot generate them: add
  `/<name>/feed.json`, `/<name>/feed.xml`, `/<name>/` as unsigned overwritable files.
- §9.7: a browser *publisher* needs CORS preflight for PUT with `If-Match`, and `ETag` exposed.
- §9.1: a hub MUST refuse an overwrite of an existing profile or head that carries no `If-Match`.
- §14.3: no forward secrecy — a leaked reading key opens every sealed post ever addressed to it;
  `read` can be rotated by a new profile version and nothing re-seals the past.
- §6.3/§6.4: a reader MAY attach replies targeting a superseded `(n, hash)` to the superseding
  post, or every edit breaks its thread.
- §3.4's asymmetry argument is wrong for `__proto__` — there the reader is the victim.
- §6.1: say `n ≥ 1` and `top = 0` when none. §6.2: RFC 3339, not "ISO 8601".
- §5's tail-fetch sentence asserts unconditionally what `headrange-gate` measured as collapsing
  at a 5% edit rate; qualify with §1's "scales across identities" and name `If-Range`.
- §4.6's "only a reader that pinned before the split can run the rule correctly" and §14.1's
  "what a reader already verified is pinned, and he cannot alter it" — false until A1 is closed.

## D. What the review did not find wrong (so it is not re-litigated)

The file format and its two MUSTs (§3.1–3.2); no canonicalization (§3.3); the per-member leaf
(§4.4); majority over *k* (§4.6) — the price is real and stated; `top` (§5.3); the head signed by
the current key (§5.6); the rumor rule's two bounds (§8.5); create-once and CAS (§9.1–9.2); the
photo-replace rule (§9.6); carrier binding as AAD (§7.2); the blinded tags (§7.3); the padding
floor as a SHOULD (§7.4); the three verdicts (§8.3); pull-only and DMs as posts (§6.6); "the
publisher forgets" (§5.7, §9.8); the 6% and 1.1 KB figures (re-derived, hold).

## E. The record

The eleven rulings of commit `6791a91` were never written into `RULINGS.md`; they are now §13
there. Cutting `prev` reversed RULINGS §12.4 with no `rejections.md` entry; it has one now (§16).

## F. How it closed (the same day)

The owner ruled on every A-finding (RULINGS §14): the **unified hop** for A1/A1b; **cut** for A4;
the identical-hash re-listing for A5; the current-key reclaim for A2; verified writes and the
split hub role for A3; `{key, read, loc}` audience entries for A6; the code-over-any-key and the
current-key-out-of-band exit for A7; the one-paragraph sealed-photo construction for A8; the
stated 65,535-byte ceiling for A9. The spec was edited to all of it, plus the B and C lists;
Appendix B regenerated (`node tmp/regen2.js` — 49 checks, including a **two-implementation
agreement**: `src2/reader.js` and the weekend reader read every vector to the same verdicts, and
the two envelope constructions produce identical bytes). The weekend instruments were held to the
rulings and every gate re-run: 28 green, 64 mutation rows caught. The review gates' "as written"
claims now assert the ruled behaviour; their cards keep the before-and-after.

**`src2/` + `test2/` exist**: the modular reference implementation (file, profile, head, envelope,
spoken+wordlist, reader, fetch+addresses, publish, hub, views, cli) and 54 tests, including §10's
fetch layer over a TLS socket — the section that had no code — and GOALS.md's scenarios end to
end. `npm test` runs both suites (320); `npm run check` runs both regens and every gate.

