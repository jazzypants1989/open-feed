# The final review — what was found, and the questions for the owner

**Written 2026-08-21 by the agent that took `HANDOFF-final-review.md`.** Everything in §2 of that
handoff was built: five new gates (`envelope`, `twohubs`, `gapless`, `court`, `media`), three new
experiments (`freezehead`, `views`, `headbytes`), and the intent map (`INTENT-MAP.md`). The reader
and publisher on trial were changed — `weekend-reader.js` 141 → 161 lines, `weekend-publisher.js`
47 → 51 — and every change is a rule the spec owes, each with a revert row. **Nothing in `src/`,
the spec, `README.md` or `GOALS.md` was touched. Nothing is committed.**

Every number below was produced by a run today. Re-run before quoting.

```
npm test                                                                     # 267
npm run prototypes                                                           # 11
for f in tmp/redesign/gates/*-gate.js; do node "$f" || echo RED $f; done     # 23
for f in tmp/redesign/decisions/*-exp.js; do node "$f" >/dev/null || echo RED $f; done   # 33
node tmp/redesign/gates/revert.js                                            # 56 rows, ≈4 min
node tmp/measure/tldr-check.js tmp/redesign/TLDR-new.md                      # 200/99/8
```

## 1. The three findings that change the design

These are not sentences the spec owes; they are places where what the sketch says does not hold.

### 1.1 The contest rule as written caught only a careless thief — `court-gate`

`SKETCH.md` §2 and §5: "two different profiles at one `pseq` is a contest." The reader did exactly
that, and nothing else. So a thief holding Alice's rotated-out key who publishes a *higher* `pseq`
with a plain rotation to his own key — after she has restored with two of three vouchers — **is
followed by a pinned reader and a cold reader alike**. The chain walks from the genesis; that was
the whole test. Staged over a socket, both orders, nine forks.

The court (RULINGS §11.3) fits in the composed reader in 18 lines, and needs four rules:

1. The pin holds the chain, and a served chain must extend it key for key; where it does not is the
   split. A newer profile whose chain is a *prefix* of the pinned one is a split too.
2. A court per chain length: the **first** list the reader saw there, never overwritten. So the
   thief who rewrites the list before forking changes nothing for a reader that already held one.
3. A restore hop **carries the list it satisfied**. Without it a cold reader cannot walk a chain
   after the list changed — and an author who edits her list after a restore breaks her own chain.
4. A pinned reader judges a restore by the list *it* holds, never by the carried copy. A majority
   of that list on exactly one side wins; otherwise contested.

Two limits to state plainly: a cold reader's court is whatever its first profile carried (a reader
that first meets an identity on the thief's branch will reject the real one later — §11.3's limit,
now measured); and a list change reaches readers' courts only through a hop, so an app SHOULD
rotate when the list changes.

### 1.2 Carrier binding does not go — `envelope-gate`

`SKETCH.md` §9: "§15's carrier binding all go, with their mechanisms." The *shape* goes. The
*attack* is alive on this substrate: the thief lifts Alice's sealed envelope out of her post and
into one of his own, signed by his key, listed in his head; her family decrypts it and **her words
render under his name**. With the carrier — author's genesis key and post number — as associated
data, it does not open, at zero bytes. `rejections.md` §15. `INTENT-MAP.md` flags the same from the
old `enc.test.js` side.

### 1.3 Two gaps only the publisher interface could have

- **A number held by junk at a photo's hash** (`media-gate`). The content-addressed twin of §12.5:
  a stranger PUTs 100 bytes at `/media/<her photo's hash>` before she does; on a hub that refuses
  every taken name, her bytes are 409 and **her own readers accuse her host** (`photo … is not
  what the head lists`). The rule: a host MUST replace a file at a hash it does not hash to when
  offered bytes that do. Five requests, and it is her readers who turn on her host.
- **A brand-new identity with no head reads as `host: no head served`** (`twohubs-gate`) — "this
  host is misbehaving" on an honest hub, at the moment Grandma signs up. The publisher writes an
  empty head when it claims the name, or the spec accepts no-head as empty and reopens whole-head
  withholding. The gate does the former.

## 2. Bugs in the files on trial, all fixed, all revert-checked

| where | what it did | found by |
|---|---|---|
| `weekend-publisher.js` `rewrite` | took the live list from the reader's pin, which has no flags, and **confirmed every pending post** at the monthly rewrite — readers fetched bytes the device had not sent, `host` | `gapless-gate` |
| `weekend-reader.js` pin | dropped `pending`, so the rotation fallback fetched the pending post and accused the host | `gapless-gate`, `freezehead-exp` independently |
| `weekend-reader.js` `read()` | never returned the verified profile's `read` key; a sealer taking it off the raw profile seals to whatever the host substituted | `twohubs-gate` |
| `weekend-reader.js` `walk()` | verified every restore hop against the profile's *current* list, so editing the list after a restore broke the author's own chain | `court-gate` |

## 3. Green claims that never ran their own path

The handoff asked for these specifically.

- **`prev`, on both files, is written by the publisher and read by nobody.** §12.4 says it is
  "checkable only by a reader that saw the version immediately before" — and no reader checks it,
  adjacent or not. What it would catch on the head (a different history with the same live set) has
  no observable consequence; what it would catch on the profile (a one-step skip over a contest) is
  defeated by a thief publishing two versions, and is now covered by the chain-prefix rule.
  **Recommendation: cut `prev` from both schemas.** Minimality, and a field nobody reads is a field
  implementers will get wrong.
- **A reply's `target.hash` is written by repliers and compared by nobody in the reader.** §12.2's
  argument for 32 bytes in the head rests on "a reply's target carrying all 32" closing the author's
  equivocation — a check the reader does not perform. `twohubs-gate` assembles the thread by hash
  *in the gate*, and its revert row shows a wrong-hash reply slipping in without that. The spec
  should say: a reply whose target hash does not match the listed hash is a reply to something
  else. One sentence, and then the 32-byte argument is true.
- **"Numbering stays gapless" (SKETCH §6) is false under a crash, and it does not matter** — a
  crash between the post write and the head write burns one number; the reader is indifferent to
  gaps. What matters is the rule that falls out: a device that comes back must *abandon* a number
  it cannot prove it listed, never list it late — because the pinned reader's rewrite check is
  exactly what catches the custodian backdating a post, and cannot tell the two apart.
- **`canonical.js` does not "go entirely"** (SKETCH §9). The RFC 8785 serializer goes; the I-JSON
  parser half — duplicate members, `__proto__`, integers past 2^53, lone surrogates — is a quarter
  of the weekend reader and keeps five `negative.test.js` intents.

## 4. What held

- **§12.7's fallback holds** (`freezehead-exp`): the unverifiable-head freeze is `splitview`'s
  per-reader cap with the reader-identification cost removed, never moves a pin, leaves a note
  ordinary withholding does not, and breaks on the social path after one re-fetch. Two wordings:
  the note should read *"no head I can verify"* (a garbled file, a 404, a stale-key head and an
  honest mid-rotation all produce it); and a cold reader mid-rotation is told `host` under
  **either** write order — one request wide, closed only by a reader-side retry, so the spec says
  a cold reader retries once before reporting.
- **Every ruled head number holds** (`headbytes-exp`): 25 real signed heads at 10–100,000 entries,
  worst ratio 0.9983 against the arithmetic; never / yearly / monthly / flat = 0.005 / 0.051 / 0.587
  / 17.7 TB/yr, unchanged to three decimals; dead lines 6.4% / 6.0%.
- **Floor item 4** (`twohubs-gate`): a sealed thread crosses two hostile hubs through the unchanged
  reader with nothing but GET and `If-Match`; neither operator opens anything; the cross-hub rumor
  fetches the *author's* hub.
- **The envelope** (`envelope-gate`): three reproducible vectors; 83-B slots against today's 160;
  0 of 24 public-only tag derivations match; a padding floor of 8 slots / 512 B makes a DM (1,439 B)
  the size of a family post; the unchanged reader returns a sealed post `ok` with the field opaque.
- **The views** (`views-exp`): JSON Feed, Atom, h-card from head and posts, consumed by three
  no-library consumers; nothing signed; an edit inside the feed passes the feed consumer and the
  same edit as a file is caught by the reader.
- **Media** fits the head as `[hash]` at 48 B (ruling 6 said ~55); withheld and swapped are both
  `host`; a sealed post's photo is ciphertext at a listed hash and the hub learns the size.

## 5. Questions for the owner — one at a time, with the number

Each is a recommendation marked as such, then the question. None is "should I proceed."

**Q1. Majority, or at least *k*?** RULINGS §11.3 says majority; `forkcourt-gate` used ≥ *k*. They
differ on exactly one row: *the ex, on the list, vouches for himself; Alice merely rotates.*
Majority says contested; ≥ *k* hands the ex her identity. The price of majority is the other row:
a one-of-two restore against a bare rotation stays contested until a second member vouches.
*Recommendation: majority, as ruled — it is the only rule under which a listed adversary never
wins alone.* Do you want the price stated in the spec, or only the rule?

**Q2. Is withdrawal ever deletion on an honest host?** The orphan from a crash, every withdrawn
post, every withdrawn photo: the bytes stay served at their number or hash forever. There is no
`DELETE`, she cannot overwrite her own file, and the fold refuses a withdrawal of what was never
listed. Against the custodian this is moot. *Recommendation: a host MAY remove a numbered or
hashed file the head does not list, after a grace window for the post-before-head write order.* Or
the spec says plainly that withdrawal is not deletion. Which?

**Q3. Cut `prev`?** Nobody reads it; §3 above. *Recommendation: cut it from both files.* The only
argument for keeping it is future-proofing a history walk the design has explicitly renounced.

**Q4. The target of a sealed reply: in the clear, or inside the envelope?** In the clear, the rumor
rule works for everyone and Jesse's hub operator learns that Jesse replied to Mom's post 3 — the
reading graph `sealed-pins-gate` was built to keep off the wire. Sealed, only recipients can raise
the rumor — and they are the only ones for whom it is a reply. *Recommendation: inside the
envelope; `rel`/`target` in the clear for public posts only.*

**Q5. The spoken code's bits.** As written ~14.6 bits, brute-forced in 0.46 s on one laptop core
(37,000 keygens/s). Five words from a 2,048-word list is 55 bits — 31,000 years on a core, 31 on a
GPU; six words is 66 bits. Or keep 40 bits and derive with scrypt (N=2^14): the honest verifier
pays 24 ms once; the ex pays 840 core-years. *Recommendation: six words from a 2,048-word list — no
new primitive, readable down a phone.* Pick one and state the number.

**Q6. A display name on the profile.** GOALS says "apps show a name and an address"; the profile
has no name field, so the h-card's name is the path segment and every hub decides what Alice is
called. *Recommendation: one optional `name` field, signed like everything else.*

**Q7. The padding floor: SHOULD or MUST?** A DM the size of a family post costs ~1.1 KB per DM.
*Recommendation: SHOULD, with the price stated.*

**Q8. The frozen copy reads as `ok` to a reader that never learned the new address** (and as
`identity: an older profile` to one that did). GOALS scenario 1 says "his frozen copy reads as
stale, not as her." `INTENT-MAP.md` flags this as the one ruled sign-off to confirm. *Recommendation:
reword the scenario — "stale" is what a reader with the social path sees, and the design has no
other way to know.* Confirm, or revisit ruling 7.

**Q9. Four sign-offs from the intent map**, each one sentence in `INTENT-MAP.md`: the relay guard
(closed by 1.2 if you take it); the offline archive ("the device always had the copy" says nothing
about what the copy is or whether a reader can verify it with no host); staleness (the old reader
could say a host stopped serving updates; the new one cannot tell that from a quiet author — that
is §12.7 by design); the frozen copy (Q8).

## 6. Sentences the spec now owes, collected

From this review, beyond the three findings in §1 — each names its gate:

- A pending entry is confirmed by a bare line and survives a rewrite pending (`gapless`).
- A device abandons a number it cannot prove it listed; it never lists one late (`gapless`).
- The post is written before the head that lists it (`gapless`).
- A served chain must extend the pinned one; where it does not is a split (`court`).
- A restore carries the list it satisfied; a pinned reader ignores that copy (`court`).
- The court at a split is the first list the reader saw at that length; a majority wins (`court`).
- The content's associated data includes the carrier author's genesis key and number (`envelope`).
- A slot tag is a hint; a match whose unwrap fails is a collision (`envelope`).
- A photo is listed by its hash; the bytes are what the hash says or the host is misbehaving;
  a host replaces a file that does not hash to its name when offered one that does (`media`).
- A publisher writes an empty head when it claims a name (`twohubs`).
- Seal only to a `read` key from a profile you verified (`twohubs`).
- A reply whose target hash does not match the listed hash is a reply to something else (§3).
- The unverifiable-head note is "no head I can verify"; a cold reader retries once (`freezehead`).
- `rumors` follows a reply's `at` — it is the relocation mechanism and a one-hit beacon, once per
  identity per pass (`twohubs`).
- JSON Feed ids are `urn:openfeed:<genesis>:<n>`; sealed posts are omitted from views (`views`).

## 7. What I got wrong, so you do not inherit it

- **I wrote three gate rows that were my own staging, not the design.** The custodian's backdate
  needed his disk, not just her key (create-once refused him); the ex's one-of-three restore did
  not walk under *k*=2 (a real thief carries a forged court); and a claim that *asserted* the reader
  lacked the `read` key went red the moment I fixed the reader. Each is now the honest claim.
- **My first revert row for the "never there" check was not caught** — the hash comparison on the
  next line fires on `undefined`. The rule is the pair; the guard is what turns it off. The
  handoff's own lesson, repeated by me within the hour.
- **A revert row was "caught" by a crash in a print line**, not by a red claim. Fixed the print.
  A crash counts for `revert.js` and proves nothing about the claim.
- **The weekend reader was never "unchanged" in this review**, despite what four gate headers say
  — `envelope`, `twohubs`, `freezehead` and `views` imported it as it stood when they ran, and it has
  since grown the court, the pending flag, the `read` key and media. All four still pass against
  the current file; their cards say "unchanged" meaning *not edited by that gate*.

## 8. Where things are

| path | what |
|---|---|
| `gates/envelope-gate.{js,md}` | §2.A — the envelope, vectors, the padding floor, carrier binding |
| `gates/twohubs-gate.{js,md}` | §2.B — floor item 4 over two hostile hubs |
| `gates/gapless-gate.{js,md}` | §2.C — numbering under failure, the pending lifecycle |
| `gates/court-gate.{js,md}` | §2.D — the contest rule in the composed reader |
| `gates/media-gate.{js,md}` | §2.E — the fourth file kind |
| `decisions/freezehead-exp.js` | §2.F — the fallback against splitview's strategies |
| `decisions/views-exp.js` · `headbytes-exp.js` | §2.G, §2.I |
| `INTENT-MAP.md` | §2.J — 52 kept / 86 transformed / 129 dropped, 4 sign-offs |
| `rejections.md` §15 | carrier binding, part-reversed |
| `gates/weekend-reader.js` · `weekend-publisher.js` | 161 and 51 lines; the diff against `HEAD` is every rule found |
| `gates/revert.js` | 56 rows, all caught |
