# skiplinks — can a lapsed reader reconnect a pin without walking every version?

**Question.** §5.3's pin-and-walk is linear in versions, every manifest version carries its whole
`items` map, and §13.4 caps history bytes fetched per update at 10 MB — so reconnecting a pin
costs O(versions × items), and cadence and rotation shorten nothing for the consumer. Does an
anchor field (`_skip`) on the manifest chain rescue the lapsed reader, and which anchor encoding
is safe?

**Method.** A hand-built 365-version chain (daily cadence, 3 items/version). Linear and skipping
walkers both enforcing §5.3; three readers with different pins and heads, visited-set overlap
under absolute anchors (largest multiple of each 2^k) versus relative offsets (head−2, head−4, …);
a forged-anchor attack — an honest linear chain with one anchor in the head pointed at a fake
version, aimed only at skippers — and a rollback below the pin.

**Numbers — every one is stale-prone, and this file's own history proves it.** Its headline
number was HALVED once already: the first draft priced the skip walk without the companion fetch,
the spec hardened that spot-check from the file's recommended SHOULD into a MUST (§9.1, §9.1.1;
§13.4 now prices a jump at two full versions), and the repriced walk roughly doubled. The
conclusion survived; the margin it survived by was half what was reported. As re-run: linear
breaches the cap at ~150 days lapsed (12.33 MB); worst checked skip walk 0.84 MB / 10 fetches —
still an order of magnitude of headroom. Anchors cost +270 B on the head (+0.3%), 0.07 MB of
retained history. Overlap: absolute, 3 readers share 2 of 15 visited seqs; relative, 0 of 16.
All of it depends on this fixture's cadence and manifest shape; nothing re-verifies it.

**Verdict.** ADOPTED (§9.1.1). The load-bearing choice is **absolute anchors**: relative offsets
walk just as fast and fragment the §5.3.1 witness network to zero shared observations. The forged
anchor is invisible to a plain skipper and caught by the `seq+1` companion's `prev` — fabricating
it undetectably means fabricating the whole chain above it, which only a key custodian can do
(§13.2). Rollback stays rejected. Identity chain excluded: 5–20 lifetime versions never repay it.

**No gate exists for this experiment**, deliberately. It hand-rolls its entire model —
canonicalization, signing, both walkers — and imports nothing from `src/`, so a gate here would
guard nothing shipped and could stay green while `src/chain.js` regressed. The shipped behavior
is guarded where it should be: `test/chain.test.js` covers the absolute-anchor set, a walk
following skip links, the forged anchor caught by the companion, a relative anchor ignored, the
identity chain refusing `_skip` outright, gap reporting, non-canonical skip keys, and rollback.

**Original:** `tmp/archive/skiplinks-prototype.js` (both anchor encodings, the attack build, and
the mispricing narrated in place).
