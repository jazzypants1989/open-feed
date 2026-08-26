# Cryptographic review: examples/envelope/ and examples/padding/

Scope: §6 and §13 of `open-feed-spec.md`, `src/envelope.js`, `FINDINGS.md` §4, and the `.js`, `.md`
and `.out.txt` of `examples/envelope/` and `examples/padding/`. Both examples run green under
`node tools/examples.js envelope` and `node tools/examples.js padding`. `npm run revert` was not run.
Re-derivation script: `tmp/review/padding-rederive.mjs` (formula from the spec's stated sizes,
cross-checked against `src/envelope.js`, no code reused from `examples/padding/`).

Verdict up front: neither example contains a cryptographic error. Every construction statement in
both `.md` files and in the printed narration matches §6.1–6.6 and `src/envelope.js` line for line.
The padding numbers in FINDINGS §4 reproduce exactly. What follows is what is missing or imprecise,
by severity.

---

## High

### H1. Ephemeral reuse is a two-time pad on the content keys, and nothing says MUST NOT

§6.1 line 517 says "One X25519 ephemeral key pair per message" with no RFC 2119 keyword. The only
MUST NOT in §6.1 (line 536) is on the *content key*. But the wrap nonce is deterministic:
`knonce = HKDF(Z, salt = epk, ...)`, and `Z` depends only on (ephemeral private, R). Reuse the
ephemeral across two posts to the same recipient and every one of that recipient's slots is
ChaCha20-Poly1305 under the same `(kek, knonce)` with a different plaintext (the content key).

Proved in the script (`== probe: same ephemeral ==`): with the same `ephemeral` seam and two random
content keys, `wrapped_a[0..32] XOR wrapped_b[0..32] === ck_a XOR ck_b` is `true`. One content key
known (the recipient knows both; the *host* knows neither, but any one leaked key then yields every
other under that ephemeral for every recipient), and Poly1305 key recovery follows from two tags
under one key. The recipient's tag is also identical across the two posts (`true`), which defeats
§6.3's "tags are blinded per message" outright.

This is the same shape as the media-key finding already in FINDINGS §3 ("§4.4's rule that a media
key MUST NOT be reused has no stated consequence"), but worse, because here the rule is not stated
at all. `src/envelope.js` line 36 draws a fresh ephemeral unless the `ephemeral` seam is passed, so
the reference implementation is safe; a second implementer who caches an ephemeral "for
performance" ships a two-time pad. Neither example demonstrates it — `envelope.md` lines 38–42
explain nonce reuse only for the content key.

**Ask:** §6.1 needs "MUST be fresh per message" on the ephemeral, with the reason (the wrap nonce is
derived from it). `examples/envelope/` should show it, since the script already has the seam.

---

## Medium

### M1. `epk` is defined as base64url text, but `salt`, `aad = epk` and `aad = epk || carrier` use its raw 32 bytes

§6.1 line 535: "`epk` is the ephemeral public key, base64url." Lines 521–530 then use `epk` as the
HKDF salt and in both AADs. `src/envelope.js` lines 37, 44–45, 48 use the *decoded* 32 bytes in all
three places. The carrier, by contrast, is explicitly "the ASCII bytes `<author anchor key>:<post
number>`" (§6.2 line 542), where the anchor key is its base64url *text*. So one AAD mixes 32 raw
bytes with 43 characters of base64url, and the spec never says which encoding `epk` takes in the
derivation. A second implementer reading §6.1 literally (salt = the 43-byte string) produces a
different tag, kek, knonce and ct, and cannot open B.8.

`envelope.md` line 30 and `envelope.out.txt` lines 17, 22, 28 print `salt = epk`, `aad = epk`,
`aad = epk || carrier` verbatim from the spec, inheriting the ambiguity. The example does compute the
right thing (`envelope.js` line 47 `epk = unb64(eph.x)`), so anyone who reads the code learns the
answer, but the prose never states it. Not in FINDINGS.

**Ask:** one clause in §6.1 — "wherever `epk` appears in a derivation it is the 32 raw bytes; the
carrier is ASCII text" — and the example's narration should say so once.

### M2. `padding.md` says the body floor "runs out somewhere around three or four people". It is exactly three, and can never be four

Re-derived (script, `== headline claim ==` and `== can four entries ever fit 512? ==`):

| k (author included) | plain + 2 | body bucket | wire bytes |
|---|---|---|---|
| 1 | 195 | 512 | 1574 |
| 2 | 334 | 512 | 1574 |
| 3 | 473 | 512 | 1574 |
| 4 | 612 | 1024 | 2257 |
| 5–6 | 753–898 | 1024 | 2257 |
| 7–8 | 1039–1182 | 2048 | 3622 |
| 9 | 1321 | 2048, 16 slots | 4286 |

A §6.5 entry is `{"key":"<43>","read":"<43>","loc":"<L>"}` = 115 + L bytes before its comma.
Four entries with an *empty* text and a 13-character `loc` (`https://a.b/c`) are already 542 > 512.
So the boundary is not "about three or four" and not dependent on text length in any practical
case: **the 512-byte body floor equalises audiences of at most three including the author** — the
author plus two — and a fourth entry cannot fit under any `loc` that is a URL. `padding.md` line 66
should say three, and say why (4 x 115 = 460 bytes of keys and punctuation before a single `loc`).
FINDINGS §4's "beyond about three people" is correct but can be made exact. The "2,048-byte floor
covers about fourteen" claim also reproduces: k=14 is 2032, k=15 is 2171.

**The headline claim, stated exactly:** "a message to one person is the same size as a message to
the family" (§6.4 line 570) means: under the SHOULD floors, the signed post's wire length is
independent of audience size. That holds for the slot component up to eight members, and for the
body component up to three members. Since the wire length is the sum, it holds for **k ≤ 3**. A
"family" of author + mum + sis is the largest family it covers; the six-person family in
`padding.md` is 683 bytes larger than a DM, which the host can read off.

### M3. "About 1.1 KB" is wrong for every audience, not only the DM

FINDINGS §4 and `padding.md` line 70 give 498 bytes, measured on a DM. My script agrees: 498 = 6 x 83,
body cost zero because a two-entry audience is already in the 512 bucket. But the reason it is zero
is the DM's *two* entries. The maximum the floor can cost is the smallest possible post — a note to
self, one entry, empty text — where the body would otherwise sit in the 256 bucket:
922 bytes = 581 (7 dummies) + 341 (ct grows from 272 to 528 bytes, base64url). So the spec's figure
overstates the cost in every case, by 20% at the worst case and 2x at the DM. "Costs between 500
bytes and about 900" is the accurate sentence; `padding.md` line 71–73 calls 1.1 KB "the more
conservative figure" as though it were reachable, and it is not.

### M4. Neither example shows tampering being *detected*, only wrong-carrier failing to open

§6.2's demo (`envelope.js` 71–82) is the right one for lifting. But nothing shows that a flipped
byte in `ct`, in a slot's `wrapped`, or in `epk` is rejected (and that the last one changes every
recipient's `Z` so no slot opens at all). Nothing shows that a real slot's tag replaced with garbage
still opens by the §6.3 blind path (which the `openBlind` at line 86 could do in one line). A
reader of `envelope.md` line 138–141 is told the archived JWE header "was not covered by the JWE's
own AEAD"; the natural question is what covers the slots *here*, and the answer — nothing in the
AEAD; the file signature, §2 — is never stated. A slot is authenticated only by the Ed25519
signature over the whole post. That is fine (the author is the only one who can sign), but it is a
statement about what the AEAD does and does not cover, and the example does not make it.

### M5. Nothing shows a later post with a smaller audience, or a rotated reading key

The task asked for "a recipient removed from a later version". The design's answer (`envelope.md`
lines 174–182: no group, each post names its own audience) is correct, but the example never shows
its consequence: post 6 to four; post 7 to three; bro opens 6 and not 7, and *keeps* 6 forever
(§13.3 "no forward secrecy"). Likewise §3.8's "a new profile version can change `read`, and nothing
re-encrypts the past" has no line in either example: old post still opens with the old private
key, new post does not open with it. Both are one `decrypt` call each and they are the two facts a
family app author most needs to internalise.

---

## Low

### L1. The §6.2 "unbound" demo reuses (content key, zero nonce) with a second AAD

`envelope.js` line 78 `aead(key5, Z12, padded, epk)` encrypts the same `padded` under the same
content key and the same all-zero nonce that produced `dm.ct`, differing only in AAD. Script probe:
the 512-byte ciphertext bodies are **identical** and only the tags differ. Because the plaintext is
the same nothing leaks, but it is the exact pattern the `.md` (line 40) warns will "XOR to a readable
difference", performed in the teaching script six lines after the warning. Either derive a second
key for the counterfactual, or say in the narration that this is a deliberate reuse on an identical
plaintext to show the AAD is the only thing separating the two.

### L2. `assert.deepEqual(Object.keys(seen.obj.encrypted), ['epk', 'slots', 'ct'])` asserts member order that §2.3 explicitly does not mandate

`envelope.js` line 165. §2.3: "there is no canonical form, no member ordering rule". The assertion
is true of `src/` and of B.8 but is not a spec rule; a conformant envelope with `ct` first is fine.
Similarly `envelope.js` line 58 asserts mum's slot is `dm.slots[1]` and the narration says "finds
slot 2 of 8" and "2 unwraps here" (`.out.txt` 48–49): real slots in audience order followed by
dummies is `src/` behaviour (line 43–47), not §6.4, which says nothing about placement. Appendix B.8
fixes it for the vector only. A conformant publisher MAY shuffle. Not wrong, but the example should
say "in this implementation" or drop the positional claims, because "the tag saves work" is the
lesson and the index is not.

### L3. "as in HPKE" for the all-zero nonce is loose

§6.1 line 536 and `envelope.md` lines 38, 149. HPKE does not use an all-zero nonce; it uses
`base_nonce XOR seq` with `base_nonce` derived from the key schedule. The security argument is the
same (one message per key in the single-shot API), but the precedent named is not the construction
used. `age`'s file-key wrap (zero nonce, single-use key) is the exact precedent if one is wanted.
Spec wording, so out of the example's hands, but the example repeats it twice.

### L4. `envelope.md` line 155: "a future cipher change is a change to that string, not a parameter"

The `info` string domain-separates HKDF output; it does not select a cipher. Changing the AEAD
would change the spec text and the string both. The sentence reads as though the string carries
suite-agility, which it does not, and that is the wrong thing to leave in a second implementer's
head. Cut the clause.

### L5. B.1 publishes no ephemeral or reading private material, so B.8 is not reproducible from the spec alone

Appendix B.1 lists public keys only; the seeds live in `tools/regen.js`. `envelope.md` line 15–17
promises "a second implementer can follow every intermediate value and know when they have it
right", and the output truncates `Z` and `kek` to 16 bytes (`envelope.js` line 55–56). The
truncation is cosmetic — a wrong derivation would show in the first 16 bytes — but the promise is
only kept if the implementer runs this repository's script. Worth a sentence in the `.md`, or full
values in the output.

### L6. Two figures in `envelope.md` that should be checked against the tree

Line 14 "about fifty lines" vs the table at line 129 "76 lines". Line 128 "spec words 905" was not
verified by me and will drift; it is the sort of number CLAUDE.md says to keep out of prose.

---

## Confirmed correct (so the caller need not re-check)

- HKDF-SHA256, ikm = Z, salt = raw epk, info `openfeed/v1/slot`, 52 bytes split 8/32/12: `src/envelope.js` line 19, `envelope.js` line 49–50, `.md` line 30. Match.
- Wrap: ChaCha20-Poly1305(kek, knonce, content key, aad = raw epk): `src` line 45, example line 51. Match. 48-byte output; slot widths 8/48 asserted (`padding.js` 54).
- Content: zero nonce, aad = raw epk || ASCII carrier, plaintext = 2-byte BE length + JSON + zeros to bucket: `src` lines 41–42, 48; example lines 59–62. Match, and `assert.equal(b64(ct), dm.ct)` at line 68 is a byte-exact check against B.8.
- `bucket()` semantics and the eight edge rows (`padding.js` 32–34) match §6.4.
- Dummies: 56 random bytes, split 8/48, from the `random` seam, never from Z, ck or epk (`src` line 47). The "MUST NOT be derived from anything a recipient holds" demo (`padding.js` 57–72) is a genuine demonstration, and the epk case correctly extends it to the host.
- Tag collision handling: `src` line 59–60 `continue` on unwrap failure; the `collided` test (`envelope.js` 98, 104) exercises exactly that path. Constant-time compare via `timingSafeEqual` satisfies §13.4.
- Wrong or missing carrier returns null (`src` line 61 `return null` after a successful unwrap — correct: a good unwrap means the ck is right, so a failing ct is a carrier or tamper failure, not a collision).
- What a recipient learns about other recipients: the `audience` list, by design; nothing from the slots (cannot derive others' tags without the ephemeral private or their private key; cannot distinguish a real slot from a dummy without its kek). `padding.out.txt` 28–30 states this correctly.
- What the operator learns: `n`, `at`, `epk`, slot count (a bucket, ≤ 8 means audience ≤ 8), ct bucket; not the audience, not `rel`/`target`/`media`. `padding.md` 77–82 and `envelope.md` 106–110 are accurate, and the latter correctly says a *large* audience shows in the body bucket.
- The X25519 all-zero-output point is already filed in FINDINGS §3 and `src` line 55's try/catch covers it in Node.
- §3.8's "MUST encrypt only to a `read` key taken from a profile it verified" exists and says what `envelope.md` line 79 attributes to it.
- FINDINGS §4's 498 bytes, 1,574 / 1,076 / 2,257, 83 bytes per slot, and "about fourteen" at a 2,048 floor all reproduce from formula alone.
