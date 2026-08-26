# audience-gate — can a reply to a encrypted post be encrypted at all?

**Review gate** (2026-08-23 review, findings A6 and A9). Substrate: weekend reader, weekend
publisher and `envelope.js` (§6 verbatim), over two loopback hubs.

**Question.** §6.5 seals the audience inside "so a recipient learns who else can answer", as a
list of reading keys. §3.8: a publisher MUST encrypt only to a `read` key taken from a profile it
verified. A replier who knows a member only from the envelope holds an X25519 key. What does he do?

**Method.** Mom and Sis on one hub, Jesse on his own; Jesse has read Mom and never Sis. Mom seals
to all three. Jesse opens it, classifies each audience key by what he holds, and replies under
§3.8 as written; Sis tries to open the reply. Then the same encrypted to the audience as received.
Then the repair — entries `{key, read, at}` like §5.4's target — with Jesse resolving the
unknown entry to a profile, checking its `read`, and replying; plus an entry whose `at` serves
someone else's profile. Then A9: a 70,000-byte encrypted text.

**Numbers** (stale if §6.5, §3.8 or `envelope.js` change):

- What the three keys are to Jesse: *a profile he verified · himself · an X25519 key and nothing
  else*. Nothing he holds maps a reading key to a anchor or a location.
- Under §3.8 he seals to **2 of 3**; Sis opens his reply and gets **nothing** — the thread split
  §6.5 says the inside audience exists to prevent, with no error anywhere. Sealing to the audience
  as received works cryptographically; only the rule forbids it.
- Repaired: the third entry leads to Sis's profile (`ok`), whose verified `read` is the one in the
  audience; Sis opens the reply. An entry pointing at the wrong profile is `identity` by the
  anchor check. The three-entry audience seals to the same 704-char `ct` as the three-key one
  (same bucket).
- A9: 70,000 bytes → `RangeError` from `writeUInt16BE`; 65,535 bytes of plaintext, audience
  included, is the ceiling as built. The spec states no maximum.

**Kill criterion.** The replier able to reach the third member's profile from what §6.5 gives him
(he cannot); a encrypted body above 65,535 bytes accepted (it is not). **Not triggered.**

**Revert-checked** (`revert.js`): removing `at` from the repaired entries makes the resolve step
unable to fetch; dropping the anchor check in the reader makes the wrong-profile row read `ok`.

**Verdict.** §6.5's audience must name people, not keys: `{key, read, at}`, exactly §5.4's
target shape, so a recipient can find and verify every member before sealing and §3.8 stands
unchanged. (`twohubs-gate.js:63` already encrypted anchor keys inside — the repo had two audience
shapes.) For A9, state the 65,535-byte ceiling in §6.1, or drop the prefix for trailing-zero
stripping (JSON never ends in a NUL byte).

**Run:** `node examples/_seeds/audience-gate.js`
