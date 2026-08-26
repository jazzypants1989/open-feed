# Review: README.md (2026-08-25)

Read-only review of `README.md` (598 lines, 6,232 words) against `open-feed-spec.md`, `GOALS.md`,
`FINDINGS.md`, the examples, and the repo's own tooling. Every number was re-derived; every relative
link was resolved; other-system claims were spot-checked against primary sources.

**Headline:** the README is factually in good shape — no RFC 2119 caps, no dead links, every
quantitative claim reproduces from the repo. The problems are (a) three spec contradictions in the
"How it works" section, (b) the section is a ~3,500-word shadow of the spec that has already drifted
once, and (c) the thing a first-time reader most needs — that there is no app to install and the
status is "draft with two unfixed security defects" — is on line 547 of 598.

---

## Severity: HIGH

### H1. Reader step order is stated wrong — README.md:310-312
> "profile, then chain, then recovery lists, then the file's signature, then the pin"

Spec §7.1 (open-feed-spec.md:619-628) is: fetch profile (1), check anchor (2), **record recovery
lists (3)**, **walk the chain (4)**, signature (5), pin (6). The chain is judged *by* the lists
recorded in step 3, so the order matters — the sentence right before it says "each step supplies what
the next one checks", and then gets the one dependency that motivates the rule backwards.
Fix: "profile, then the recovery lists, then the chain, then the file's signature, then the pin."

### H2. The status and "what exists" are buried — README.md:547-571, 575-190
A technical family member deciding whether to run this needs, in the first screen: it is a draft
(0.1.0, unreleased), there is **no client app** (GOALS.md scenario 2 says "installs an app"; nothing
in the repo is one — `src/` is a library plus `cli.js`), and `FINDINGS.md` holds two unfixed security
defects in the identity mechanism. Today the first mention of any of this is line 547, after ~5,000
words. The README never states plainly that there is nothing to install. Move a 3–4 line status block
above the TL;DR, or into it.

---

## Severity: MEDIUM

### M1. "It replaced a canonicalizer plus a strict parser" — README.md:132-135
Contradicted by the repo: §2.4 is enforced *by* a strict JSON parser (`src/file.js`; CLAUDE.md:
"the strict JSON parser lives here — `JSON.parse` cannot enforce §2.4"). The protocol replaced a
canonicalizer, and kept a strict parser. Also archaeology ("it replaced …") of the kind CLAUDE.md
asks to keep out. Same paragraph: "a reader rejects them" — spec §2.4 (open-feed-spec.md:100) is
SHOULD for readers, MUST NOT only for producers. Say "a reader should reject them" or "a reader that
does not reject `__proto__` must at least not inherit from it".

### M2. A private message is not "a post with a different `rel`" — README.md:70-72
> "A reply, a reaction, a repost, an edit and a private message are all posts with a different `rel`"

Spec §5.3 lists the `rel` values; a DM is not one of them. §5.6 / §6: a DM is an *encrypted* post
whose audience has one member — the distinction is the envelope, not `rel`. Replies/reactions/edits
are `rel`-distinguished; the DM is not.

### M3. "The same four rules" as I-JSON — README.md:523
I-JSON (RFC 7493) has three of the four: unique names, integers within ±(2^53−1), no surrogates. It
says nothing about `__proto__` (verified against the RFC). The example the row points at says so
itself (`examples/json-hygiene/json-hygiene.md:60-61`: "covers three of these four"). Change to
"three of the same four rules" or "the same rules, plus `__proto__`".

### M4. "How it works" is a second copy of the spec — README.md:104-415
~3,500 words, one subsection per spec chapter, restating §2–§12 in near-spec detail (the file table,
the index example, the post example, the PUT table, the verdict table, the eleven-step order, the
§9 address rules, the §10 three consequences). CLAUDE.md's README rule is "README explains; the spec
defines … point at the example that argues a thing rather than re-arguing it." This section is
already showing the drift that rule exists to prevent: H1 above, and README.md:238 ("5.5%") vs spec
§4.7 ("about 6%") — the README quietly carries a different number from the spec it says is the only
source of truth (the README's number is the measured one; the spec is the one that is stale, per
FINDINGS.md §4 — but a reader sees two numbers). Recommend cutting this section to roughly a third:
keep the file-format walkthrough (README.md:106-135, it is genuinely explanatory and uses a real
vector), keep the "why majority" and "why no revocation" paragraphs, and replace the rest with the
"A reading path" list, which already covers it in spec order.

### M5. Re-argued where an example already argues it (item 4 of the brief)
- README.md:171-172 — why there is no revocation message. Argued at
  `examples/the-chain/the-chain.md:95-100`. Point there.
- README.md:183-186 — majority over `k`. Spec §3.6 states it and `examples/contest/` stages it
  (including the abuser-on-the-list case). The README paragraph is a third telling.
- README.md:286-296 — the three envelope properties (carrier AAD, tag-is-a-hint, audience inside)
  restate §6.2/§6.3/§6.5 at spec length; `examples/envelope/` proves each one.
- README.md:322-327 — "the count is a UI budget, not a correctness budget"; `examples/the-reader/`
  is listed as the place that shows "three verdicts and the notes on an ok read".
- README.md:494-496 — "There is no version of 'signed per post' that gives the first without the
  second." An argument, not a pointer; §5.6/§13.3 already state the limit.
- README.md:369-376 — the §9 address-blocking rules in full; `examples/fetching/` is the argument.

### M6. The TL;DR is not a TL;DR — README.md:41-100
It is ~600 words and a table — a compressed spec (identity, four files, file format, profile, index,
post, encrypted, reader, publishing, leaving, floor, vocabulary). A TL;DR for the stated reader
should answer: what is it, who is it for, what state is it in, what can I do with it today, where do
I go next. Half of that is absent (see H2), and the file table at :50-55 is reproduced again nowhere
else, so it is not a summary of something below — it is the only copy, which is the spec's job
(§2, open-feed-spec.md:52-57). Suggest: 6–8 sentences, no table, ending with the status line and a
pointer to "A reading path".

---

## Severity: LOW

### L1. Publish table omits the views line — README.md:346-352
Spec §8's table (open-feed-spec.md:714-719) has a fifth `PUT /<name>/feed.json | feed.xml |
index.html` line. The README says "Four paths" (so does the spec, so this is the spec's own
inconsistency), but the README's table drops the views row entirely, then "Generated views"
(README.md:398) says the publisher "writes" them without saying where or that it is a PUT.

### L2. "Encrypted posts are omitted" from views — README.md:405
Spec §11 (open-feed-spec.md:879-880): omitted **or rendered as an empty placeholder item**. The
README states only one branch.

### L3. "Exactly one file is re-signed, and only to name the new location" — README.md:393-394
Not in §10 or §3.7. True in the simple case (new profile version with new `locations`), but not a
spec statement, and false when the move coincides with a rotation (§3.5: profile *and* index).

### L4. Vocabulary "(§1)" — README.md:99-100
§1's table (open-feed-spec.md:33-43) defines nine terms; it does not define *link*, *media*, or
*encrypted*. The README's twelve-word list is CLAUDE.md's, not §1's. Cite CLAUDE.md or drop the
section reference.

### L5. TL;DR overstates the index's guarantee — README.md:67-68
"a host cannot quietly drop a post, because the author signed a statement that it exists" — only
against a **pinned** reader; a cold reader sees whatever index it is shown (§13.3, and the README's
own :508-510). Add "to a reader that has seen the index".

### L6. "safe for exactly the reason it is safe in HPKE, because the key is used once" — README.md:281-282
HPKE's nonce is `base_nonce XOR seq`, not zero (`examples/envelope/envelope.md:156` says so). The
spec's own "as in HPKE" (§6.1) is equally loose; the README adds "exactly", which is more than the
example supports. Drop "exactly".

### L7. Minor wording vs spec
- README.md:52 — profile signed by "the key the chain ends on": spec says "the current key (the key
  the chain ends on)". Fine. But :53 cites §4.6 for the index and nothing for the profile (§3.2).
- README.md:195-196 "tries the others" — spec SHOULD (open-feed-spec.md:290). Acceptable in prose.
- README.md:400 "a feed reader written in 2005" — Atom is 2005 (RFC 4287); JSON Feed is 2017. The
  sentence is about Atom so it holds; copied from `examples/views/views.md:11`.

---

## Item 2 — every number, re-derived

| README line | claim | derived | status |
|---|---|---|---|
| :115 | B.6 body 66 bytes, 86-char sig, 153 on the wire | 66 + 1 + 86 = 153 | ok |
| :122 | B.6 body hashes to `hURWhg38…` | sha256 base64url = `hURWhg38Wl033FFA1HeqvE5bZQiPnEOREVbvIJij9kY`; B.9 lists it at 1 | ok |
| :147-148 | indices `923 1951 1851 172 1664 898` = *inflict view trash better source icon* | `src/wordlist.js` (2048 words) yields exactly that | ok |
| :148 | six words = 66 bits | 6 × 11 | ok |
| :152 | address is 43 characters | 32 bytes base64url unpadded = 43 | ok |
| :237-238 | one post in twenty withdrawn → 5.5% | `examples/rewrite/rewrite.out.txt:57-60`: 150 posts, 7 withdrawn, 5.5% | ok (spec §4.7 says ~6%; see M4) |
| :299-302 | floor costs 498 B; DM 1,574 B; six-recipient 2,257 B; horizon ~3–4 recipients | `examples/padding/padding.out.txt:57,67,74`; FINDINGS §4 "beyond about three" | ok |
| :310 | eleven steps | §7 numbers 1–11 | ok |
| :337-339 | 1,000 replies → 1 look-again, 4 fetches, 1 line; naive 4,000 / 1,000 | `examples/top-and-rumors/top-and-rumors.out.txt:33-34` | ok |
| :371 | at most five redirects | §9: 5 | ok |
| :421 | "twenty examples" + :460 "two capstones" | 20 numbered rows + 2 in `examples/README.md:37-58`; 22 dirs | ok, but see :584 |
| :461 | weekend-reader 170 non-blank non-comment lines | 170 above the `// ====` marker (306 whole file) | ok — say "above the demo marker" or a reader counting the file gets 306 |
| :462 | weekend-publisher 51 | 51 above marker (132 whole file) | ok, same caveat |
| :464 | "Three rules in the spec exist because writing them found…" | `examples/weekend-reader/weekend-reader.md:52-68` lists the same three | ok |
| :554-555 | nothing fixed "beyond a handful of cosmetic items" | FINDINGS.md:3 "except four cosmetic items" | ok |
| :566 | "four places the spec's own numbers were wrong" | FINDINGS.md §4 has five bullets; four are numbers, the fifth is a testability note | ok |
| :577 | src ~1,300 lines | `wc -l src/*.js` = 1,279 | ok |
| :582 | 54 tests | `npm test`: tests 54, pass 54 | ok |
| :583 | 49 vector checks | `npm run vectors`: "all 49 vector checks hold" | ok |
| :584 | 22 examples | `node tools/examples.js`: "22 example(s) match" | ok |
| :6-8 / :43 | 32-byte key, 86-char signature | §1, §2.1 | ok |

No stale numbers. Two presentation notes: :421 says "twenty" and :584 says "22" for the same
directory — both are right (20 + 2 capstones) but a reader will trip; say "twenty, plus the two
capstones" at :584 or "22" at :421. And the 170/51 counts are only reproducible if the reader knows
about the marker.

## Item 3 — RFC 2119 keywords
`grep -nE '\b(MUST|SHOULD|MAY|REQUIRED|SHALL)\b' README.md` → no matches. Clean.

## Item 6 — claims about other systems
The comparison table (README.md:520-537) names topics rather than making claims, so there is little
to verify; the arguments live in the examples (out of scope here). Spot-checked against primary
sources:
- Nostr "replaceable events by timestamp" — NIP-01: latest `created_at` wins, lowest id on a tie. ok.
- AT Protocol "a signed repo and its CAR export" — atproto.com/specs/repository: signed commits, CAR v1
  export. ok.
- ActivityPub/Mastodon `Move`, `Delete` — docs.joinmastodon.org/spec/activitypub: both supported. ok.
- RFC 7493 I-JSON "the same four rules" — **wrong**, three of four (M3).
- Signal (safety numbers, sealed sender, key-change notifications, disappearing messages), Matrix
  cross-signing, HPKE RFC 9180, NIP-44, MLS, JOSE `b64:false` (RFC 7797), RFC 8785 JCS,
  Micropub, `com.atproto.repo.*` — all real features/specs correctly named; no overstatement in the
  README's wording.
- README.md:21-22 (quoting GOALS) "SOLID … Mastodon or Bluesky" — a quote, accurately reproduced.

## Item 7 — links and anchors
All 30 relative link targets resolve (`open-feed-spec.md`, `GOALS.md`, `FINDINGS.md`, `LICENSE`,
`archive/`, `archive/README.md`, `examples/`, `examples/README.md`, and all 22 example directories).
`LICENSE` is Apache 2.0 as claimed (:596). No in-document `#anchor` links exist. Archive claims at
:539-541 (`b64:false`, RFC 8785, `_openfeed`, delegated keys, identity as a URL) all appear in
`archive/README.md:12-13`. No dead links.

## Item 5 — structure, in one paragraph
Order is Why → TL;DR → How it works (3,500 w) → Reading path → Limits → Comparisons → Status →
Running → License. For the stated first reader, the right order is closer to: what it is + status +
"nothing to install yet" (one screen) → Why → the floor and the limits (the honesty is the pitch;
"What it does not defend" at :471 is the best section in the file and should not be 4,700 words in)
→ Reading path → Running → Comparisons. "How it works" should shrink into the reading path (M4).
The "Why" section is good and earns its place near the top. "Three roles" (:407-415) and "Generated
views" (:396-405) are spec restatements a first reader does not need.

## What is fine and should stay
The opening four paragraphs (:1-13); "Why" (:17-37); the file walkthrough on a real vector
(:106-130); "What this is not, and what it does not defend" (:471-510); the comparison table as an
index into examples rather than a summary (:514-537); Status (:547-571) once moved; Running (:575-590).
