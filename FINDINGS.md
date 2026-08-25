# What writing the examples found

**Status: the open list.** Items that have been fixed are removed from this file when they are fixed;
`git log` has each one. What remains is Stage D's input.
Every entry was found by writing a program that asserts what the spec says and watching it disagree,
so each one is reproducible; where a number is quoted it was re-derived, not copied.

---

## 1. Security

Nothing open. (The `k` threshold and §2.4-inside-the-envelope defects were ruled on and fixed on
2026-08-25: a restore is valid only when more than half of the recovery list vouches, `k` is gone
from the wire, and the envelope's plaintext is parsed under §2.4.)

---

## 2. The spec says one thing and the code does another

- **§3.7's "SHOULD try the others when one stops answering" has no code behind it** outside the rumor
  path. `createReader().read()` takes a single `at`; the only multi-location behaviour is inside
  `rumors()`'s look-again, so an app writes the fallback loop itself.
- **§7.2's "a cold reader SHOULD retry the whole read once" is unimplemented.** `src/reader.js`
  returns `host` immediately, and nothing in `src/`, `test/` or the examples exercises a retry. It may
  be intended as an app-level SHOULD, but nothing says so and no code demonstrates it.
- **`src/reader.js` mislabels a shape failure as a fold failure.** When `checkIndex` rejects
  `version`, `top`, or `entries`-first, the `why` is built as `` `the index does not fold: ${why}` `` —
  those are §4 shape rules, not §4.2's fold.
- **§7.4's unresolved-target marking lives in step 11, not step 10.** §7.4 says a post whose
  `target.hash` is not what that author's index lists "is returned with the target marked unresolved",
  but `src/reader.js` implements it only in `rumors()` (§7.5), because the check needs the
  cross-identity `seen` map that only step 11 has. A caller using `read()` alone never marks any
  target. Either the rule belongs in §7.5, or §7.4 must say the marking happens when the reader holds
  a pin for the target's author.

## 3. The spec does not say something an implementer needs

- **§2's file table and §8.4 disagree about who names you.** The table says the paths are "under a
  name the hub assigns"; §8.4 says a name is claimed first come, with the profile as the proof, by
  the writer. One of the two is wrong.
- **The spec never joins `locations` to the `/<name>/…` paths.** `src/reader.js` fetches
  `${location}/profile`; no sentence says a location *is* the name-prefixed base. A second
  implementer has to guess the one thing every fetch depends on.

- **Teredo, and the rest of `src/fetch.js`'s IPv6 list.** §9 names the unspecified address, loopback,
  link-local, unique-local and the embedded-IPv4 forms. `isPublicIPv6` additionally refuses `ff00::/8`,
  `100::/64`, `2001:db8::/32`, `2001::/32` (Teredo) and `2001:10::/28` + `2001:20::/28`. Teredo is the
  load-bearing one — it tunnels an arbitrary, possibly private, IPv4 destination behind a
  routable-looking prefix, so it belongs in the same sentence as NAT64 and 6to4 — and a second
  implementer reading only §9 would ship without it. Either add them or mark the extras as beyond the
  floor. The IPv4 side matches exactly: all fourteen CIDRs, none extra.
- **§6.1 does not require rejecting an all-zero X25519 output** (RFC 7748's optional contributory
  check). Node's `diffieHellman` throws, so the reference implementation is safe by accident; another
  standard library may not be. Low impact, since the sender chooses `epk` — but unstated.
- **§4.2's "a number has one hash, ever" reads stronger than the fold can enforce.** After a rewrite
  drops the `[n, null]` line, an index re-listing `n` at a *different* hash folds cleanly; only a
  pinned reader catches it. A cold reader arriving after such a rewrite has nothing to compare
  against. The limit is real and worth one clause.
- **§4.4's rule that a media key MUST NOT be reused has no stated consequence.** Under the fixed
  all-zero nonce, reuse is a two-time pad *and* forges the authenticator. `examples/media/` shows it;
  the spec asserts the rule without the reason, which is the one shape of MUST implementers weaken.
- **§10's "ask a named relative for a named list" is only half available for encrypted posts.** The
  index gives the number and the address; the audience is inside the envelope (§6.4), which a
  rebuilding app no longer holds. So it can name the numbers it needs and not who to ask for them.
- **§7.1 step 1's two cases share one message.** A body that does not parse and a substituted anchor
  both return `'not the identity this reader learned'`. The spec says a reader cannot *distinguish*
  them, which makes it defensible — but the wording asserts substitution rather than the
  indistinguishability the spec describes.
- **§8 says "four paths, two verbs" and then prints a table with five `PUT` rows**, the fifth being
  §11's views. `examples/publish-interface/publish-interface.md` repeats the phrasing without
  reconciling it. Either the views are a fifth path or the sentence should say so.
- **§8's status table does not admit the 400 a hub returns for junk at an empty media address.**
  `src/hub.js` answers `{ status: cur ? 409 : 400 }` when the offered bytes do not hash to the name;
  the table lists only `201 | 200 | 409`. Either list it, or say what a hub does with such bytes.
- **§8.1's "not re-send its own version" is ambiguous** between *the file version it holds* and *the
  `version` member*. The genuinely damaging retry re-reads the tag and bumps `version` while keeping
  its own `entries`; a retry that literally re-sends the same bytes at the same `version` is caught by
  §7.2's "two indexes at one version" instead, which is a different and louder failure. Naming
  `entries` explicitly would close it.
- **`at` has no stated requirement.** §5.2 says it is an RFC 3339 timestamp, but no MUST makes it
  present or well-formed and `src/` never inspects it: a post with no `at`, or `at: "yesterday"`,
  verifies and reads `ok`. That is probably deliberate given §13.2 — but saying so would stop the next
  implementer adding a validation that turns into a verdict.
- **§11 fixes the item id and says nothing about the feed-level id.** `src/views.js` invents
  `urn:openfeed:<anchor key>` for Atom's required `<feed><id>`.
- **The recovery list has no vector for the words.** Appendix B.12 publishes the six spoken-code
  indices but not the six words they select (`inflict view trash better source icon`), so the
  wordlist mapping — the part a second implementer is most likely to get wrong, and the only part a
  user ever sees — is the one step with no test vector.

## 4. Numbers the measurement disagrees with

- **§4.7's "about 6%" is a property of an unstated withdrawal rate, not of the file.** Measured 5.5%
  at one withdrawal in twenty posts (agreeing with the spec), 6.0% at one in eighteen, 2.9% at one in
  forty. A parenthetical would make it checkable.
- **§4.7's arithmetic.** "A reader that last saw `version` 1 and returns at `version` 6, across two
  rewrites and an append it never saw" names three intervening changes; 1 → 6 is five.

## 5. Cosmetic

- `src/index.js`'s `checkAgainstPin` orders the "two indexes at one version" check before the `top`
  check, so an index that both holds its version and drops `top` never reports the `top` message.
  Both are `host`; only a test expecting the wording would notice.
- `src/reader.js`'s `rumors()` marks a reply's target unresolved, which §7.4 makes step 10's job, so a
  second pass over the same posts sees already-marked targets.
- `adoptRecoveryLists`'s per-link `!(j in recoveryLists)` guard looks unreachable: every call site
  passes a `from` at or above the highest held index.

**Struck and fixed** (2026-08-24): the `head` → `index` rename left `'a index older than the one this
reader saw'` in a verdict string and in five other places; `src/reader.js` labelled a §4 *shape*
failure as a §4.2 *fold* failure; `src/wordlist.js`'s header cited §4.1 for the spoken code, which is
§3.1; and `verifyProfile`'s JSDoc documented a `switched` member it never returns.
