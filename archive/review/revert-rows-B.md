# Audit of `tools/revert.js`, rows 66–129 (second half)

`M` has **129 rows**. ceil(129/2)+1 = 66, so this covers **rows 66 through 129** (row = position in
`M`, 1-based). Rows 1–65 are the other reviewer's.

Method: no tracked file was touched and `node tools/revert.js` was not run. `src/` and `examples/`
were copied to `tmp/review/sandbox/`, each row was applied there and its gate run, and the first
failing line was recorded (`tmp/review/sandbox/results.tsv`). Candidate missing rows were probed the
same way (`tmp/review/sandbox/probes.tsv`). The rows carry no per-row comment — the "rule the
mutation is supposed to break" is the gate's section header plus the `.js` line the edit sits on,
so the label I judged against is the spec rule that line implements.

Verdict counts: **RIGHT 55 · RIGHT-BUT-MISLABELED 4 · INCIDENTAL 1 · WEAK 2 · plus 2 RIGHT with a
caveat worth reading** (crash before assertion, or caught by a vector rather than by the rule's own
assertion). Every row in the range is caught; the question was only ever *why*.

## Table

| # | gate | file · what the edit does | rule | red at | class |
|---|------|---------------------------|------|--------|-------|
| 66 | top-and-rumors | reader.js: drop `!out.includes(line)` dedupe | §7.5 one line per person | :108 `G.out` has 1000 lines | RIGHT |
| 67 | media | reader.js: media hash check → `false` | §4.4 reader MUST verify bytes hash | :48 TypeError (`swapped.why` undefined) before assert :52 | RIGHT (crash, right cause) |
| 68 | media | reader.js: unserved listed file → `continue` | §7.4 listed-not-served is host | :49 TypeError before :53 | RIGHT (crash, right cause) |
| 69 | media | index.js: fold rejects `[hash]` entries outright | §4.4 "what admits it is being listed" | :47 whole read is host (does not fold) | **WEAK** |
| 70 | media | envelope.js: `encryptMedia` hashes plaintext not ciphertext | §4.4 listed hash = hash of ciphertext | :93 TypeError (read went host) before :101 | RIGHT (crash, right cause) |
| 71 | rewrite | index.js: `liveEntries` keeps withdrawal lines | §4.7 rewrite = the fold's answer | :50 `orphaned.length` | RIGHT |
| 72 | rewrite | index.js: fold no longer deletes on `[n,null]` | §4.2 fold (withdrawal leaves live set) | :64 `fold(e2)` ≠ `fold(kept)` | RIGHT-BUT-MISLABELED → §4.2 |
| 73 | rewrite | index.js: withdrawn hash not kept in pin | §7.2 step 9 "the pin keeps their hashes" | :82 | RIGHT |
| 74 | rewrite | index.js: "changed after the reader saw it" off | §7.2 step 9 / §4.2 one hash per number | :97 twin | RIGHT |
| 75 | padding | envelope.js: `bucket` ceil→floor | §6.4 bucket definition | :34 | RIGHT |
| 76 | padding | envelope.js: floor policy = {1,32} | §6.4 SHOULD 8 slots / 512 B | :43 | RIGHT |
| 77 | padding | envelope.js: dummy 56→40 bytes | §6.4 dummy indistinguishable in width | :54 | RIGHT |
| 78 | padding | envelope.js: body bucket of `len` not `len+2` | §6.4 bucket(length+2) | :82 at the 510/511 edge | RIGHT |
| 79 | padding | envelope.js: dummies derived from epk | §6.4 MUST NOT derive from what a recipient holds | :70 | RIGHT |
| 80 | moving | reader.js: pin keeps only the latest `locations` | §3.7 MUST remember every location | :59 | RIGHT |
| 81 | moving | reader.js: rumors never try the reply's `loc` | §3.7/§7.5 follow the address in a verified reply | :100 pin did not move | RIGHT |
| 82 | moving | profile.js: unsigned profile accepted | §7.1 step 5 signature under chain end | :135 beacon reads ok | RIGHT |
| 83 | moving | reader.js: unverifiable post handed on as `{n}` | §7.4 any failure is host | :134 | RIGHT (see note) |
| 84 | moving | profile.js: older `version` accepted | §3.6/§7.1 step 6 version MUST NOT go back | :69 frozen copy reads ok | RIGHT |
| 85 | fetching | addresses.js: 169.254/16 unblocked | §9 blocked IPv4 list | :24 | RIGHT |
| 86 | fetching | addresses.js: leading-zero octet accepted | §9 leading zero MUST be refused | :37 | RIGHT |
| 87 | fetching | addresses.js: `::ffff:0:a.b.c.d` no longer unwrapped | §9 embedded-IPv4 forms | :29 | RIGHT |
| 88 | fetching | fetch.js: `guardedLookup` stops filtering | §9 check on the resolved address | :53 innocent.example connects | RIGHT |
| 89 | fetching | fetch.js: one extra redirect allowed | §9 at most 5 | :77 `saw.length` (the count, not the error code) | RIGHT |
| 90 | views | views.js: item id = URL | §11 ids are `urn:openfeed:` | :49 | RIGHT |
| 91 | views | views.js: encrypted posts rendered with ciphertext as text | §11 MUST NOT carry ciphertext | :49 (id list) before :79 | RIGHT |
| 92 | views | views.js: h-card ignores `name` | §11 h-card name is the profile's `name` | :91 | RIGHT |
| 93 | views | views.js: h-card link drops the `#anchor` fragment | §11 "MAY carry the anchor key in its fragment" | :91 | RIGHT-BUT-MISLABELED → enforces a MAY |
| 94 | views | index.js: fold no longer deletes on `[n,null]` | §11 withdrawn absent from views | :49 | RIGHT-BUT-MISLABELED → §4.2 (views.js has no withdrawal logic to break) |
| 95 | contest | profile.js: split never found | §3.6 rule 1 | :51 r1 | RIGHT |
| 96 | contest | profile.js: strict-prefix split off | §3.6 rule 1 second half | :51 r1b | RIGHT |
| 97 | contest | profile.js: profile `recovery` overwrites the held list | §3.6 rule 2 MUST NOT overwrite | :19 TypeError (r2a went identity) before :62 | RIGHT (crash, right cause) |
| 98 | contest | profile.js: served link judged by its carried list | §3.6 rule 3 | :62 | RIGHT |
| 99 | contest | profile.js: majority → `>= k` | §3.6 rule 4 "majority, not k" | :62 | RIGHT |
| 100 | contest | profile.js: tie no longer contested | §3.6 rule 4 both/neither → contested | :75 reader follows the thief | RIGHT |
| 101 | envelope | envelope.js: ct AAD = epk only | §6.2 AAD MUST be epk‖carrier | :68 ct ≠ hand-built ct (vector), before :80 lifted-envelope test | RIGHT (caught by vector first) |
| 102 | envelope | envelope.js: tag collision → give up | §6.3 MUST keep scanning | :104 TypeError before :107 | RIGHT (crash, right cause) |
| 103 | envelope | envelope.js: `audience` left out of plaintext | §6.5 audience MUST be inside | :68 (vector) before :127 | RIGHT (caught by vector first) |
| 104 | envelope | envelope.js: wrap AAD = empty | §6.1 wrapped aad = epk | :58 slot ≠ hand-built slot | RIGHT |
| 105 | envelope | envelope.js: HKDF info string | §6.1 info = "openfeed/v1/slot" | :163 B.8 vector only | RIGHT (see note) |
| 106 | the-reader | profile.js: anchor check dropped | §7.1 step 2 | :80 | RIGHT |
| 107 | the-reader | reader.js: index verified under any chain key | §4.6/§7.2 step 7 | :104 mid-rotation note vanishes | RIGHT |
| 108 | the-reader | reader.js: post address/`n` check dropped | §7.4 | :178 battery rows 3–4 go ok | RIGHT |
| 109 | the-reader | reader.js: media hash check off | §7.4/§4.4 | :178 battery row 6 | RIGHT |
| 110 | the-reader | profile.js: older `version` accepted | §7.1 step 6 / §7.3 frozen copy | :145 | RIGHT |
| 111 | the-reader | reader.js: "recently restored" never said | §7.3 note on an ok read | :104 | RIGHT |
| 112 | your-copy | publish.js: `kept` stores nothing | §10 MUST keep the bytes | :42 TypeError | RIGHT (crash, right cause) |
| 113 | your-copy | publish.js: kept bytes gain a trailing `\n` | §10 "the bytes, with the signature line" / §2.3 | :50 | RIGHT — the best row in the range |
| 114 | your-copy | index.js: fold no longer deletes on `[n,null]` | §10 last index is the table of contents | :107 withdrawn post 2 gets rebuilt | RIGHT-BUT-MISLABELED → §4.2 |
| 115 | your-copy | reader.js: post address/`n` check dropped | §7.4 (via §10 "those bytes verify") | :67 lying hub reads ok | RIGHT |
| 116 | publish-interface | hub.js: missing `If-Match` no longer 412 | §8.1 "or carries no If-Match at all" | :58 | RIGHT |
| 117 | publish-interface | publish.js: `amendIndex` ignores the served index entirely | §8.1 loser MUST re-read and fold | :86 TypeError — read went **host: version went backwards** | **INCIDENTAL** |
| 118 | publish-interface | hub.js: owner may overwrite the owner's own file | §8.2 create-once / §8.5 "cannot overwrite their own" | :93 `publish(4)` returns 4 not 5 | RIGHT |
| 119 | publish-interface | hub.js: reclaim accepts any chain key | §8.5 "not any chain key" | :148 (via :23) | RIGHT |
| 120 | publish-interface | hub.js: profile PUT skips chain+signature | §8.4 hub MUST check the proof | :131 | RIGHT |
| 121 | publish-interface | hub.js: media never replaced | §8.6 MUST replace | :163 | RIGHT |
| 122 | publish-interface | hub.js: index PUT skips signature | §8.4 index must verify under current key | :134 | RIGHT |
| 123 | publish-interface | hub.js: `Access-Control-Expose-Headers` dropped | §8.7 expose ETag | :169 | RIGHT |
| 124 | publish-interface | publish.js: claim writes no index | §8.4 publisher MUST write an index on claim | :53 | RIGHT |
| 125 | posts-and-targets | reader.js: post address/`n` check dropped | §5.1 reader checks `n` | :84 genuine 2 served at 6 | RIGHT |
| 126 | posts-and-targets | hub.js: `ownersFile` ignores `n` | §5.1/§8.5 hub checks `n` | :92 replay blocks her post 9 | RIGHT |
| 127 | posts-and-targets | reader.js: unresolved marking off | §5.4 MUST treat mismatched hash as another post | :153 | RIGHT |
| 128 | posts-and-targets | index.js: withdrawn hash not kept | §5.4 "now, or when it was withdrawn" | :128 | RIGHT |
| 129 | posts-and-targets | reader.js: unserved listed file → `continue` | §7.4 / §5.6 withholding is host | :178 | RIGHT |

Same `from` string used under several gates (fine — each gate is a separate claim): the fold's
`[n,null]` line (72, 94, 114); the post address/`n` check (108, 115, 125); the listed-not-served
line (68, 129); withdrawn-hash-kept (73, 128); older-profile (84, 110); anchor check (106).

## Notable rows

**69 — WEAK.** Making the fold reject `[hash]` proves only that the fold *parses* a media entry:
the whole read goes `host: the index does not fold`. The example's actual claim — "a media file
referenced by a post but not listed in the index is simply not there" (§4.4, `media.js:55–68`) — has
no row. The subtler violation is a reader that honours a post's `media` array regardless of the
index. Probed and caught at `media.js:68`:

```
src/reader.js
from: posts.set(n, post.obj);
to:   posts.set(n, post.obj); for (const h of post.obj.media ?? []) { const mf = await get(`${at}/media/${h}`); if (mf) media.set(h, mf.bytes); }
```

**117 — INCIDENTAL.** The edit makes `amendIndex` forget the served index wholesale, so the next
write carries `version: 1`, `top: 1`; the pinned reader refuses it as *an index older than the one
this reader saw* and `won.posts` is undefined. The row is caught by §7.2's rollback check, not by
the rule the example stages (the naive retry silently drops the other device's post and reads as a
withdrawal). The subtler edit keeps the hub's version and tag and drops only the entries — exactly
the naive retry — and is caught at `publish-interface.js:86` by the `won.note` / posts assertion:

```
src/publish.js
from: const next = change({ entries: obj.entries, version: obj.version + 1, top: obj.top });
to:   const next = change({ entries: [], version: obj.version + 1, top: obj.top });
```

**93 — enforces a MAY.** §11: "A link on that page MAY carry the anchor key in its fragment." The
row (and `views.js:91`) pins `src/views.js`'s choice, not a spec rule. Harmless, but the table's
premise is "a rule an example proves"; either relabel it as the implementation's choice or drop it.

**72, 94, 114 — the fold's withdrawal line under three gates.** All three are really §4.2. Under
`rewrite` it is defensible (the rewrite's safety argument *is* live-set identity). Under `views`
nothing in `views.js` can be mutated for "withdrawn posts are absent" because the view never sees
them — the property holds by construction, which is worth saying in the `.md` rather than pretending
a row tests it. Under `your-copy` the claim is downstream of the fold too.

**101, 103, 105, 114 — caught by a vector, not by the rule's own assertion.** 101 and 103 go red at
`envelope.js:68` (the hand-built `ct` disagrees) before the lifted-envelope test (:80) or the
audience check (:127) runs. Both later assertions would also fail, so the rows are sound, but the
first red line is a vector mismatch and reads as "drift", not "§6.2 broken". 105 is weaker: the
example imports `INFO` from `src/` and uses it in its own derivation (lines 49, 54, 88, 109), so the
by-hand derivation follows the mutation and only the hard-coded B.8 body at :163 catches it. If
Appendix B were ever regenerated with the mutation in place, 105 would go green. The fix is one
literal: derive with `'openfeed/v1/slot'` spelled out in the example, and assert `INFO` equals it.

**83 — RIGHT, but the example's narration overclaims.** The row breaks §7.4 (an unverifiable post is
host) and `moving.js:134` catches it. The example's headline claim, "a post that does not verify never
reaches the rumor step", is illustrated by `forgedHits === 0` measured during a `read()` — which
never calls `rumors()`, so that number is 0 regardless. The verdict assertion carries the row; the
fetch count carries nothing.

**Crash-before-assert rows (67, 68, 70, 97, 102, 112).** Each goes red for the right reason, but as a
`TypeError` on a `console.log` line rather than at the assertion that states the rule. `npm run
revert` only checks the exit status, so this is cosmetic today; it will matter the day someone reads
the failure output to learn which rule broke.

**118 — right, first red line is §8.2 not §8.5.** Removing the "current file is the owner's → 409"
half lets the owner overwrite her own unlisted post 4, so `publish(4)` returns 4 instead of 5 (:93).
That *is* create-once for the owner; the §8.5 lines (:149, :151) would also catch it later. Fine.

## Spec MUSTs in these sections with no row

Each was probed in the sandbox; "no example catches it" means every relevant example stayed green
with the rule disabled in `src/` — a row cannot be added until an example stages the case.

**No row, and no example catches it (gaps in the examples, not just the table):**

- **§5.4 `hash` MUST be the full 43-character address.** `reader.js` compares `listed !== t.hash`
  (full equality), but an implementation matching a prefix passes every example: `posts-and-targets`,
  `top-and-rumors`, `moving` all green with `!listed.startsWith(t.hash)`. No example replies with a
  truncated hash. Also nothing in `src/` requires all four `target` members (§5.4 "REQUIRED").
- **§7.2 step 9: index `version` MUST NOT go backwards.** `the-reader`'s battery row "serves an older
  index" is actually caught by the `top` check (the old index also has a lower `top`), and the
  battery asserts only the verdict word. A rollback that keeps `top` passes. Same for **"the same
  `version` at a different address is host"** for the index — no example stages it.
- **§7.2 step 9: a number at or below the old top that was never there is host.** `publish-interface`
  :98–100 ("listing 4 late") stays red with the check disabled, but only because the *next* line
  fires (`changed after the reader saw it`, since `was` is undefined); the example asserts the verdict
  word only. A row would be "caught" for the wrong reason.
- **§8.4: later profile writes MUST carry a `version` that has advanced.** `hub.js` checks it;
  disabling it leaves `publish-interface`, `the-reader`, `moving`, `your-copy` all green. No example
  PUTs a profile at an equal or lower version. (The same-`anchor` half *is* caught, at :133.)
- **§7.2 "media files are exempt" from the at-or-below-top check.** Removing the `typeof n !==
  'number'` guard is caught only by `rewrite.js:78` (a media file listed after the pin), and there
  by a crash. `the-reader`, `media`, `views`, `posts-and-targets` stay green. Worth a row under
  `rewrite` at least.

**No row, but an example already catches it (cheap rows; verified red in the sandbox):**

- §3.6 outside a split: same `version`, different address is contested (`contest.js:51`,
  `the-reader.js:178`). And `host` for a branch the list rejected (`contest.js:51`).
- §7.4 post signature under **any** key in the chain: `chain.keys` → `chain.current` is red in
  `the-reader`, `posts-and-targets`, `rewrite`. The current table has this mutation only for the
  index (107) and the hub (119); the post-side rule is the *opposite* direction and has no row.
- §9 never a cross-origin redirect (`fetching.js:76`); HTTPS only (`:19`); each redirect re-checked
  for scheme and address (:76 covers both); the literal-in-URL check (:53); body cap (:83);
  transport failure is no verdict (:93). Only 169.254/16 and the translated-IPv6 form have rows;
  the other twelve IPv4 ranges and the NAT64 / 6to4 / `::a.b.c.d` / `::ffff:` forms are asserted by
  the table at :24/:29 and have none. Sampling is defensible; say so in a comment.
- §6.1: HKDF salt = epk (`envelope.js:58`); 2-byte big-endian length prefix (`:68`, `padding.js:51`);
  `carrierOf` format `<anchor>:<n>` (only the B.8 vector at :163 catches it — same fragility as 105).
- §6.4 dummies derived from the **content key** (the example asserts it at `padding.js:69`; row 79
  covers only epk).
- §8.2 create-once against a stranger (`||` → `&&` in the reclaim line; `publish-interface.js:93`).
  §8.5 the "listed at that number and address" half (`:151`). §8.6 bytes that do not hash to the name
  → 400/409 (`:160`, `:164`). §8.7 `Access-Control-Allow-Origin: *` and the preflight (`:169–170`).
- §7.1 step 1 no profile → host (`the-reader.js:178`, "serves no profile at all"). §7.2 step 8 a pinned
  reader keeps its own index on an unverifiable one (`the-reader.js:104`; mutation: always `host`).

**No row possible as `src/` stands (the rule is not enforced or not reachable):**

- §6.5 "a publisher MUST include itself in the audience" — `encrypt()` does not check; examples add
  self by hand.
- §6.6 `rel`/`target`/`media` MUST go inside the envelope — `signFile` signs whatever it is given;
  nothing in `src/` refuses a public `target` beside `encrypted`.
- §6.1 content key MUST be 32 random bytes and never reused; §4.4 media key MUST NOT be reused —
  every example injects the key, so the default draw is invisible to them.
- §4.4 encrypted media: nonce = 12 zero bytes, aad = "" — `media.js` round-trips through `src/` on
  both sides and Appendix B has no encrypted-media vector, so a symmetric change (e.g. a nonzero
  nonce) survives every example.
- §8.3 post before index — `publish()` does it in order, but `publish-interface` stages §8.3 with hand
  PUTs, so swapping the order inside `src/publish.js` is unobservable (no read is interleaved).
- §9 identities-per-pass cap — declared, never enforced (already in `FINDINGS.md`).
- §7.2 step 8 a cold reader SHOULD retry once — `reader.js` does not retry.
