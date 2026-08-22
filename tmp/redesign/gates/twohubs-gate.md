# twohubs-gate — two hubs, one thread, the unchanged reader

**Candidate gate** (`../HANDOFF-final-review.md` §2.B; GOALS scenario 3, **floor item 4**). Substrate:
`weekend-reader.js` and `weekend-publisher.js`, imported and **not edited**. The sealing is a
stand-in built inside the gate — one ephemeral X25519, a blinded slot per recipient, chacha20-poly1305,
a 1,024-byte padding floor, the audience inside — and the construction itself is `envelope-gate`'s
question, not this one's. Every claim here is about the reader and the two hubs.

**Question.** Floor item 4 says two relatives self-hosting on separate domains share, reply and
react to family-only content as if they were on one hub. It was the last floor item with no gate on
this substrate. Does the reader written for one origin do it for two, with no access control on
either, and what does each hostile operator hold afterwards?

**Method.** Two hubs on two loopback ports — Mom's (the ex runs it, and Cousin lives there too) and
Jesse's own — plus a third Mom moves to. Mom publishes two sealed family posts; Jesse publishes a
sealed reply from his hub, once with the target in the clear and once with it inside the envelope;
Cousin publishes a sealed reaction and a reply carrying the wrong hash. Jesse's reader reads all
three identities across both hubs and assembles the thread. Then the rumor rule cross-hub: a reply
above Mom's top, one to a post she withdrew, one sealed. Then Mom writes her files to a third hub
at `pseq 2` and a reader that only knew the ex's hub has to find her. Then a griefer's `at`, the
ex's frozen copy against a moved pin, and a sealer that takes the read key off an unverified
profile. Fourteen claims.

**Numbers** (stale if the reader, the publisher or the hub's rules change):
- Jesse's read of three people on two hubs: **11 GETs**, 7 on Mom's hub and 4 on his own. The only
  request header any hub ever saw beyond what Node's `fetch` adds on its own is **`If-Match`**, on
  writes. There is no access control anywhere and nothing to put one on.
- **5 of 5 sealed posts locked** to a stranger holding the identical bytes; **0** openable by either
  operator from his own disk.
- A reply naming Mom#99 from Jesse's hub: **3 fetches to Mom's hub, 0 to Jesse's**, one line. A
  reply to her withdrawn #2: **0 fetches, nothing said**. A sealed-target reply above the top: a
  non-recipient raises **nothing**; a recipient who opened it raises the same one line.
- Mom's move: Cousin's reader, holding `pseq 1 / top 2` from the ex's hub, reads one reply of
  Jesse's and holds `pseq 2 / top 3` from the new hub — **followed, and nothing raised**.
- 50 griefer replies naming Mom at a beacon URL: **1 hit** on the beacon (the profile 404s and the
  read stops), one line naming the griefer.

**What each operator holds.** From his disk, Mom's hub operator (the ex) has her profile (genesis,
locations, read key), her head (`[1, 2, 2]`, top 2 — the withdrawal line), two sealed posts at
**3 slots, 1,399 B each** with a time, and Cousin's reaction and reply. From his log, he has that
one address fetched `mom/*` and `cousin/*`. Jesse's operator has the same shape for Jesse. What the
**target** gives away is the decision SKETCH.md §4 does not make:

| Jesse's sealed reply | his operator learns | the rumor rule works for |
|---|---|---|
| target in the clear | *Jesse answered Mom's post 1* — the reading graph, per post | every reader, including strangers |
| target inside the envelope | *a sealed post exists, when, 1,399 B* — nothing about whom | recipients only, after opening |

Cousin's reaction carried its target in the clear, so the ex's disk says *Cousin liked Mom's
post 1* even though he cannot read either. **Recommendation: the target of a sealed post goes
inside the envelope**, and the spec says so in one sentence. `sealed-pins-gate` was built to keep
exactly this graph off the wire, GOALS says the hub learns "nothing about whom", and the cost is
only that the rumor about a sealed reply is raised by its recipients — who are the only people for
whom a sealed reply is a reply at all. A clear `rel`/`target` stays the rule for public posts.

**Four sentences the unchanged reader and the sketch owe.**

1. **A claimed name with no head yet reads as `host: no head served`** — *this host is
   misbehaving*, for a brand-new identity on an honest hub. A publisher MUST write an (empty) head
   when it claims the name, before anyone looks; or the reader must treat no-head-at-all as an
   empty head, which reopens "withholding the whole head is free". The gate takes the first.
2. **`read()` does not hand back the profile's `read` key.** A sealer that takes it off the profile
   without checking seals to whatever the host served: the ex substitutes a profile with the same
   genesis, his own read key and his own signature, and **opens the "for mom only" post**. The gate
   goes round it by re-fetching the profile and checking its body hashes to the `phash` the reader
   pinned. The reader should return the verified profile (or its `read` key); the spec should say
   the key you seal to comes from a profile you verified, which is the substitution attack of
   ruling 1 in another coat.
3. **The ex's frozen copy, read against a pin that moved, is refused as `identity: an older
   profile than the one this reader saw`** — filed under *this identity is in question*, not *this
   host is misbehaving*. GOALS scenario 1 wants it to read as stale. The pin is untouched, so
   nothing is lost, but the verdict class is the wrong one of the three and the spec text should
   say which it is.
4. **`rumors` follows the replier's `at` unconditionally.** That is the relocation feature — it is
   the only way Cousin found Mom — and it is a beacon: a replier learns the address and moment of
   every reader who holds a pin for the name he targets, once per identity per pass. Bounded, named
   after the griefer, and the spec should state both halves. A reader could try its own pinned
   `locations` first and the reply's `at` second; this gate did not need that.

**Kill criterion.** A sealed post the reader refuses; a thread the reader cannot assemble across
origins; a hub that needs a header beyond `If-Match`; an operator who opens a sealed post; a
cross-hub rumor that fetches the replier's hub instead of the author's; a rumor over a withdrawn
post; a relocation a reader cannot follow. **Not triggered.**

**Revert-checked by hand** (4 rows; not in `revert.js` yet): dropping the hash from the thread's
target match (`p.target.n === 1 && p.target.hash === momRead.pin.live.get(1)` → `p.target.n === 1`;
the thread row goes red — **and this row was not caught until the wrong-hash reply was staged**,
which is how that reply got in); taking the read key off the unverified profile
(`checkedKey = await readKeyOf(mom, momAfter.pin)` → `checkedKey = await naiveReadKeyOf(mom)`;
the substitution row goes red); counting the rumor's re-fetch on the replier's hub
(`rumorFetches.M === 3 && rumorFetches.J === 0` → `rumorFetches.J === 3 && rumorFetches.M === 0`;
goes red); Jesse's reply naming Mom at the hub she left (`at: momNew }, text: 'welcome home' }` →
`at: mom.at }, text: 'welcome home' }`; the follow row and the frozen-copy row both go red — the
reply's `at` is the whole relocation mechanism for a reader with no other path).

**Verdict.** Floor item 4 holds on this substrate with the reader unchanged: the thread crosses
two hostile hubs with nothing but GET and a conditional PUT, and neither operator reads a word of
it. The target of a sealed post should go inside the envelope. Four sentences are owed, and the
first two are sharper than they look — one makes every new identity read as a misbehaving host,
the other lets the host read sealed content if the sealer trusts an unverified profile.

**Run:** `node tmp/redesign/gates/twohubs-gate.js`

**Changed by the final review (2026-08-21).** `read()` now returns the verified profile's `read` key (`weekend-reader.js`), so the last claim above is inverted: the sealer no longer has to go round the reader. The substitution attack it guards against is unchanged.
