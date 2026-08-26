# Review of Stages B and C (commits ebfdd0a..fbd873a)

Report-only, per the owner. Nothing tracked was changed. Detail is in the sibling files in
`tmp/review/`; this is the digest, most serious first. Baseline `npm run check` green
(54 tests, 49 vector checks, 22 examples, seeds); `npm run revert` green (129/129) after the review.

## A. Security (act on these)

1. **Both `k` defects confirmed independently** (`k-defects.md`, `k-repro.js`). (a) `{k:0,leaves:[]}`
   lets a thief append an unsigned, unvouched link; (b) `commit(1,[mum,sis,ex])` lets the ex
   self-vouch a restore with none of Alice's keys. New facts beyond the handoff: the **weekend reader
   accepts both too** (identical `walk` test, `weekend-reader.js:84`), **`src/hub.js` stores the forged
   profile with 200**, and a **1-of-2 list falls the same way**, so "MUST k >= 1" alone is not a fix.
   The fault is in the spec text (§3.3 "at least k" + §3.4 "MAY be empty" + §3.6 only at a split).
   Fix `vouchers >= k AND 2*vouchers > leaves.length` closes all three, leaves Appendix B unchanged.
   Ripple: spec §3.3/§3.4/§3.6/§13.3, `src/profile.js:62`, `weekend-reader.js:84`, revert rows
   54-55/193/331-332, `examples/contest` restaged, prose in recovery-list/the-chain/README.
2. **`examples/contest` asserts the false thing** (`contest.md`, `contest-probe.mjs`). Its centrepiece
   line — the listed abuser "cannot, alone, ever" win — is defeated by its own `k = 1` list (this is
   FINDINGS §1.1(b), which names the example; the example never cites it). Also: the attacker is
   given less than the threat model (holds the *live* key in block 2, never withholds); §7.1 step 6's
   "follow the branch the list chose" arm never runs in any block; 134 lines vs the ~120 contract.
   Under the §3.3 fix, assertions at contest.js:62, :75, :85, :101 flip and :105 throws.
3. **New for FINDINGS §1: ephemeral reuse in §6** (`crypto.md`). §6.1 says "one ephemeral per message"
   with no MUST; `knonce` derives from `Z`, so reusing an ephemeral is a two-time pad over the content
   keys (`wrapped_a XOR wrapped_b == ck_a XOR ck_b`, proved in `padding-rederive.mjs`) and un-blinds
   tags. Neither example shows it. Medium: §6.1 never says whether `salt`/`aad` use raw or base64url
   `epk` (code uses raw 32 bytes; `carrier` is ASCII).
4. **SPEC-CUTS consolidation J is unsound** (`spec-cuts.md`): a single `version` rule in §1/§2 drops
   §3.6's "outside a split" carve-out — a thief who bumps `version` first would defeat a majority
   restore (`src/profile.js:91` checks split before version). D and G also unsound; C is backwards
   (move §7.1 step 6's verdicts into §3.6, not the reverse). There are 13 consolidations, not 12;
   "item N/O" references mean K/L. Word counts all verified exact. Five per-section cuts would remove
   justification beside a MUST (§4.2 fourth-state, §6.5 "never in a header", §6.4's 1.1 KB — correct
   to 498, don't drop). Realistic saving ~300 words, not 570.

## B. The two readers no longer agree (`seams.md`)

The "cosmetic" `src/reader.js:33` edit is spec-correct (shape §4 vs fold §4.2), but
`weekend-reader.js:165` still says "does not fold" for a bad `top` and never checks entries-first
or `version` at all. No vector or test drives a shape failure through either reader, so the
divergence is invisible to `npm run vectors`. `src/index.js:42` `'an index'` is a second app-visible
`why` change. Spec byte-identical across the range (blob a79c73d); only CLAUDE.md and deleted
TLDR.md changed outside the named set. `fetching.js`'s socket is justified (`src/fetch.js` has no
transport seam), loopback-only, deterministic output.

## C. Contrast sections — factual errors (`contrast-A/B/C.md`)

Outright wrong:
- `envelope.md:38,148-150` — attributes zero-nonce + box-per-recipient to HPKE; RFC 9180 derives
  nonces and has no multi-recipient mode. The real relative is **age**.
- `envelope.md:166` — NIP-44 uses secp256k1 ECDH, not X25519.
- `the-index.md:87-90` — Atom can declare completeness (RFC 5005 `fh:complete`) and be signed
  (RFC 4287 §5.1 XML-DSig).
- `views.md:92-93` — says the README "still describes" the old design and is "queued for rewrite";
  it was rewritten in 8f2054b.
- `json-hygiene.md:76` — parser is ~30 of ~237 weekend-reader lines (an eighth), not "a quarter".
Misattributed/misleading:
- `signed-file.md:70` LD Signatures are a Mastodon/Pleroma convention, not ActivityPub; `views.md:105-107`
  same (Mastodon docs call them "not advised"; fediverse signing is HTTP Signatures).
- `the-chain.md:126`, `contest.md:115` — Matrix master key signs the self-signing key, which signs devices.
- `weekend-publisher.md:60` — `If-Match`/`ETag` date from RFC 2068 (1997), not 1999.
Overstated (nine): MMS "no say/no name" (`media.md:105`), Tor "nothing to measure" (`padding.md:98`),
Micropub/Mastodon/AT "all" have registration+refresh (`publish-interface.md:107`), Signal "cannot
rewrite a ratchet" (`the-reader.md:126`), PDS migration "supported" (`your-copy.md:109`), GnuPG
trust level "none" (`the-reader.md:117`), SSH prompt text (`first-contact.md:84`), "no standard
library" catches JSON cases (`json-hygiene.md:64`), "real authorization bypasses" (`:66`).
Everything else checked against primary sources holds. Tone: one first-person (`envelope.md:137`),
two process-narrative blocks (envelope:114-144, top-and-rumors:97-100), views spends 16 lines on
project archaeology; envelope's Contrast is 89 lines vs the template's 22.

## D. Padding numbers (`crypto.md`)

498 / 1574 / 1076 / 2257 / 83-per-slot all reproduce. Corrections: the floor equalises audiences of
**exactly <= 3 including the author**, never four — `padding.md`'s "three or four" is wrong; and the
floor's worst case is 922 bytes, so "about 1.1 KB" overstates everywhere, not just the DM.
`padding` asserts member order and slot position the spec does not mandate.

## E. README (`readme.md`)

All 20 numbers reproduce; no RFC 2119 caps; all 30 links resolve. HIGH: `:310-312` states the §7.1
order wrong (lists in step 3, chain in step 4, chain judged by the lists). HIGH: status buried at
`:547` — a first reader is never told there's no app, it's an unreleased draft, or that FINDINGS
holds two unfixed identity defects; the TL;DR (`:41-100`) is a 600-word compressed spec. MEDIUM:
`:132-135` "replaced a strict parser" (src/file.js *is* one); `:70-72` private message is "a post with
a different rel" (it is an encrypted post); `:523` I-JSON "same four rules" (three). "How it works"
(`:104-415`, ~3,500 words) is a shadow spec already drifted (5.5% vs 6%) and re-argues six things
examples own.

## F. Mutation table (`revert-rows-A.md`, `revert-rows-B.md`)

**Coverage gap: rows 23–65 were not audited** (the two halves used different counts). Rows 1–22
(seed/capstone rows): 13 right, 3 bundled/mislabeled, 4 weak (8 deletes a whole check — `n > top` →
`n >= top` slips every gate; 20 edits the assertion itself); weekend reader's §5.4 target-hash line
is unobservable by any gate. Rows 66–129: 55 right, 4 mislabeled (72/94/114 are §4.2 fold; 93
enforces a MAY), 1 incidental (117), 2 weak (69). MUSTs with no row and no example that catches
them (verified green with the rule disabled): §5.4 full 43-char hash (prefix match passes), §7.2
index version-backwards and same-version-different-address, §8.4 hub profile version must advance,
§7.2 media exemption. A list of cheap rows the examples already catch is in `revert-rows-B.md` §5.

## G. Duplication and length (`seams.md`, `contest.md`)

`the-index.md:53-63,109` restates rewrite's cross-version rule (should point at rewrite);
`recovery-list.md:32-45,57-64,94-99` reconstructs contest's centrepiece three times with the same
"ever" overstatement. Over the contract: publish-interface 201, the-reader 185 (amended),
posts-and-targets 180, envelope 167, moving 147; concrete no-loss cuts listed in `seams.md` §4.

## H. Handoff judgement calls — verdicts

1 (didn't fix k): right call, but the finding is worse than stated (hub, second reader, 1-of-2).
2 (kept `_seeds/`): unreviewed. 3 (src cosmetics): one caused reader divergence — see B.
4 (marker): confirmed sound; 170/51 recomputed; capstones lack the gates' missing-marker fallback.
5/6 (archive DISTRIBUTION-MODEL, fold TLDR): unreviewed beyond `views.md`'s stale reference.
