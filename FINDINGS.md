# What writing the examples found

**Status: nothing here is fixed.** This file is the defect list Stage B produced and Stage D's input.
Every entry was found by writing a program that asserts what the spec says and watching it disagree,
so each one is reproducible; where a number is quoted it was re-derived, not copied.

The two at the top are security defects in the mechanism the whole design turns on. Both want a
ruling from the owner before the spec rewrite, because the fix is a protocol change and the examples'
committed output is pinned to the current behaviour.

---

## 1. Security

### 1.1. `k` is trusted in two places where a majority is meant

Two findings, one cause. §3.3 makes a link valid when "the number of **distinct** voucher keys that
count is at least `recovery.k`", and §3.6 settles a *contest* by majority — so a `k` below a majority
is a second, weaker door into the same room, and it is the door §3.6 never watches.

**(a) `k` of 0 is a total identity takeover.** Reproduced against `src/profile.js`: with
`recovery = {"k":0,"leaves":[]}`, a thief appends an unsigned, unvouched link to a key of his own,
"at least `recovery.k`" is satisfied by zero vouchers, and `verifyProfile` returns `ok` with
`chain.current` set to the thief's key — **to a pinned reader, not just a cold one**. The spec
permits it: §3.3's rule plus §3.4's "the list MAY be empty" leave `k` unbounded below.
`test/helpers/site.js:52` and `test/reader.test.js:45` write `{"k":0,"leaves":[]}` today.

**(b) Any `k` below a majority hands the identity to `k` colluding members, with no contest.**
Reproduced: with `k = 1` on a three-member list, a listed member holding **no key of Alice's** extends
the pinned chain with a self-vouched restore and the reader returns `ok`, now following his key. No
split, no contest, no majority anywhere — §3.6's rule never runs, because there is nothing to
contest. §3.4 warns about a *one-member* list and §13.3 repeats it, but neither states the general
form. This is the threat model's own case: the abuser is on the list because he is family.

It also makes §3.6's strongest sentence — "Under a majority he cannot, ever, alone" — true only
*at a split*.

**One change closes both.** Make §3.3's validity rule read: a link with no `sig` is valid when the
counted distinct voucher keys are at least `k` **and** more than half of `leaves`. Then `k = 0` is
never enough (0 is not more than half of anything, and an empty list can never restore), a lone
listed member never suffices, and §3.3 and §3.6 use one bar instead of two. The visible price is
already in the spec: §3.6's "a one-of-two restore against a bare rotation stays contested until a
second member vouches" becomes "is not valid until a second member vouches", stated once instead of
twice, and the repair stays the same — the owner's people add vouchers to the link she already made.

Ripple if adopted: `src/profile.js`, `examples/weekend-reader/weekend-reader.js` (both readers must
agree or the vectors diverge), the two test helpers above, and `examples/contest/`, whose centrepiece
stages `k = 1` on purpose to show majority-versus-`k` and would need restaging.

### 1.2. §2.4 does not apply inside the envelope

`src/envelope.js`'s `decrypt` parses the decrypted plaintext with a bare `JSON.parse`, and §6 never
says §2.4's rules reach inside. So a duplicate member, an integer past 2^53, a lone surrogate, or
`__proto__` inside an envelope is reachable by a hostile author — exactly the class §2.4 exists to
close on the outside of the file, and the envelope's plaintext carries the `audience`, the `target`
and the `media` keys. A gap in both the spec and the reference implementation.

---

## 2. The spec says one thing and the code does another

- **§3.3's "a restore changes the key and nothing else" is enforced narrowly.** The spec says a link
  with no `sig` MUST NOT be accompanied *in the same profile version* by a change to `locations`,
  `recovery`, `name` or `read`. `verifyProfile` checks it only when the chain grew by exactly one
  link and the last link is unsigned, so a version that appends a restore **and** a rotation carries
  the forbidden change past a pinned reader. The practical impact is small — whoever can mint the
  restore holds the current key — but the sentence and the check are not the same rule.
- **§9's identity cap is declared and never enforced.** `MAX_IDENTITIES_PER_PASS` appears once, at
  `src/fetch.js:32`; `src/reader.js` has no identity budget. It is the one §9 bound the reference
  implementation states and does not implement.
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
- **`src/views.js` drops media-only posts.** `items()` filters on `typeof p.text === 'string'`, so a
  post with `media` and no `text` (§4.4) is absent from all three views, though §11 authorizes
  absence only for withdrawn and encrypted posts.

## 3. The spec does not say something an implementer needs

- **The 65,535-byte cap on an encrypted plaintext** that §6.1's two-byte length prefix imposes.
  `src/envelope.js` enforces it as `MAX_PLAIN`; §6.1 never mentions it. (Found twice, independently.)
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
- **The index `version` does not survive a relocation, and nothing says it must.** A publisher
  claiming its name at a new hub gets a fresh empty index at `version` 1; the next write lands on 2 —
  very likely a version its readers already pinned elsewhere with *different* bytes, so every pinned
  reader gets `host — two indexes at one version` (§7.2). §3.7 mentions only the profile's higher
  `version`; §10 does not say the index version is part of the copy that must carry across.
- **§4.2's "a number has one hash, ever" reads stronger than the fold can enforce.** After a rewrite
  drops the `[n, null]` line, an index re-listing `n` at a *different* hash folds cleanly; only a
  pinned reader catches it. A cold reader arriving after such a rewrite has nothing to compare
  against. The limit is real and worth one clause.
- **§4.4's rule that a media key MUST NOT be reused has no stated consequence.** Under the fixed
  all-zero nonce, reuse is a two-time pad *and* forges the authenticator. `examples/media/` shows it;
  the spec asserts the rule without the reason, which is the one shape of MUST implementers weaken.
- **§10's "ask a named relative for a named list" is only half available for encrypted posts.** The
  index gives the number and the address; the audience is inside the envelope (§6.5), which a
  rebuilding app no longer holds. So it can name the numbers it needs and not who to ask for them.
- **§7.1 step 1's two cases share one message.** A body that does not parse and a substituted anchor
  both return `'not the identity this reader learned'`. The spec says a reader cannot *distinguish*
  them, which makes it defensible — but the wording asserts substitution rather than the
  indistinguishability the spec describes.
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

- **§6.4's "the floor costs about 1.1 KB per direct message" is roughly 2× the truth: 498 bytes.**
  Measured on the current envelope (Alice → herself and mum, §6.5 entries, a 26-byte message): 1,574
  bytes floored, 1,076 unfloored, all of the difference in six dummy slots at 83 bytes each. The body
  is in the 512-byte bucket either way, because §6.5's two-entry audience already makes the plaintext
  332 bytes. The 1.1 KB figure predates the repair that made audience entries `{key, read, loc}`.
- **§6.4's headline claim no longer covers a family.** "A message to one person is the same size as a
  message to the family" holds at the *slot* level for any audience of 8 or fewer, but the 512-byte
  *body* floor is now smaller than §6.5's audience list beyond about three people: a DM is a
  1,574-byte post and a six-recipient post is 2,257 — 683 bytes apart, which a host can read off. A
  2,048-byte body floor would cover a family of about fourteen. Owner's decision.
- **§4.7's "about 6%" is a property of an unstated withdrawal rate, not of the file.** Measured 5.5%
  at one withdrawal in twenty posts (agreeing with the spec), 6.0% at one in eighteen, 2.9% at one in
  forty. A parenthetical would make it checkable.
- **§4.7's arithmetic.** "A reader that last saw `version` 1 and returns at `version` 6, across two
  rewrites and an append it never saw" names three intervening changes; 1 → 6 is five.
- **§6.4's SHOULD cannot be conformance-tested**, by construction: from outside, a padded envelope is
  indistinguishable from one whose audience really was eight. §12 lists it as a publisher SHOULD.

## 5. Cosmetic

- **"a index"** — user-facing verdict strings and comments left over from the `head` → `index`
  rename: `src/index.js`'s `'a index older than the one this reader saw'`, `test/index.test.js:41`,
  `test/reader.test.js:65` and `:85`, `examples/weekend-reader/weekend-reader.js:172`,
  `examples/weekend-publisher/weekend-publisher.js:43`, and several seeds. Changing the verdict string
  means rebuilding any example output that quotes it.
- `src/wordlist.js`'s header cites §4.1 for the spoken code; it is §3.1.
- `src/profile.js`'s `verifyProfile` JSDoc documents a `switched` member of the ok return that is
  never set or returned.
- `src/index.js`'s `checkAgainstPin` orders the "two indexes at one version" check before the `top`
  check, so an index that both holds its version and drops `top` never reports the `top` message.
  Both are `host`; only a test expecting the wording would notice.
- `src/reader.js`'s `rumors()` marks a reply's target unresolved, which §7.4 makes step 10's job, so a
  second pass over the same posts sees already-marked targets.
- `adoptRecoveryLists`'s per-link `!(j in recoveryLists)` guard looks unreachable: every call site
  passes a `from` at or above the highest held index.
