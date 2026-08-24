# audience-gate — can a reply to a sealed post be sealed at all?

**Review gate** (2026-08-23 review, findings A6 and A9). Substrate: weekend reader, weekend
publisher and `envelope.js` (§7 verbatim), over two loopback hubs.

**Question.** §7.5 seals the audience inside "so a recipient learns who else can answer", as a
list of reading keys. §4.8: a publisher MUST seal only to a `read` key taken from a profile it
verified. A replier who knows a member only from the envelope holds an X25519 key. What does he do?

**Method.** Mom and Sis on one hub, Jesse on his own; Jesse has read Mom and never Sis. Mom seals
to all three. Jesse opens it, classifies each audience key by what he holds, and replies under
§4.8 as written; Sis tries to open the reply. Then the same sealed to the audience as received.
Then the repair — entries `{key, read, at}` like §6.4's target — with Jesse resolving the
unknown entry to a profile, checking its `read`, and replying; plus an entry whose `at` serves
someone else's profile. Then A9: a 70,000-byte sealed text.

**Numbers** (stale if §7.5, §4.8 or `envelope.js` change):

- What the three keys are to Jesse: *a profile he verified · himself · an X25519 key and nothing
  else*. Nothing he holds maps a reading key to a genesis or a location.
- Under §4.8 he seals to **2 of 3**; Sis opens his reply and gets **nothing** — the thread split
  §7.5 says the inside audience exists to prevent, with no error anywhere. Sealing to the audience
  as received works cryptographically; only the rule forbids it.
- Repaired: the third entry leads to Sis's profile (`ok`), whose verified `read` is the one in the
  audience; Sis opens the reply. An entry pointing at the wrong profile is `identity` by the
  genesis check. The three-entry audience seals to the same 704-char `ct` as the three-key one
  (same bucket).
- A9: 70,000 bytes → `RangeError` from `writeUInt16BE`; 65,535 bytes of plaintext, audience
  included, is the ceiling as built. The spec states no maximum.

**Kill criterion.** The replier able to reach the third member's profile from what §7.5 gives him
(he cannot); a sealed body above 65,535 bytes accepted (it is not). **Not triggered.**

**Revert-checked** (`revert.js`): removing `at` from the repaired entries makes the resolve step
unable to fetch; dropping the genesis check in the reader makes the wrong-profile row read `ok`.

**Verdict.** §7.5's audience must name people, not keys: `{key, read, at}`, exactly §6.4's
target shape, so a recipient can find and verify every member before sealing and §4.8 stands
unchanged. (`twohubs-gate.js:63` already sealed genesis keys inside — the repo had two audience
shapes.) For A9, state the 65,535-byte ceiling in §7.1, or drop the prefix for trailing-zero
stripping (JSON never ends in a NUL byte).

**Run:** `node tmp/redesign/gates/audience-gate.js`
