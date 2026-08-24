# Sketch — the design as it now stands, before any spec text exists

**Written 2026-08-21 from `TLDR-new.md` down, after the experiments in `HANDOFF-to-spec.md` §2.A–C
and §2.G–H.** Every section points at a `GOALS.md` line or a `RULINGS.md` item, or it is cut.
Nothing here is normative and nothing here is prose for the spec — this is the shape, for the owner
to argue with. Where a rule exists because code found it, the gate is named.

**Every schema below is running code.** `gates/weekend-publisher.js` writes these files and
`gates/weekend-reader.js` reads them, over a socket, in `weekend-gate.js`.

---

## 1. Three signed files, and one unsigned one

| kind | where | overwritten? | signed by |
|---|---|---|---|
| profile | `/<name>/profile` | yes, compare-and-swap | the key the chain currently ends on |
| head | `/<name>/head` | yes, compare-and-swap | the same key — *always the current one* (§12.7) |
| post | `/<name>/posts/<n>` | no, created once | any key in the chain |
| media | `/<name>/media/<hash>` | no | nothing — admitted by being listed (§11.6) |

A file is **body bytes, one `\n`, then 86 base64url characters that re-encode to themselves**
(§11.7). Its address is the hash of its **body**, never of the whole file — some standard libraries
randomise Ed25519, so two honest signings of the same bytes differ in the last line. No
canonicalisation anywhere: the bytes served are the bytes signed, and a host that pretty-prints,
sorts keys or adds a trailing newline makes every file read as forged (ruling 3).

## 2. The profile

```json
{"genesis":"<key>","pseq":3,"prev":"<hash>","chain":[…],
 "recovery":{"k":1,"leaves":["<hash>","<hash>"]},
 "locations":["https://alice.example"],"read":"<x25519 key>"}
```

- **`genesis`** — who you are. Identity is a key, not a URL (GOALS). A link or a scanned square
  carries it, and a reader that learned it any other way is accepting whatever the host says
  (ruling 1).
- **`pseq`** — the version. It never goes back; two different profiles at one `pseq` is a
  **contest**, settled by a majority of the recovery list *as it stood at the split* (§11.3).
- **`prev`** — the previous profile's address, checkable only by a reader that saw that one (§12.4).
- **`chain`** — hops from `genesis` to the key in use now. A **rotation** is signed by the key it
  replaces; a **restore** carries `k` vouchers, each revealing only its own salt (§11.4).
- **`recovery`** — `{k, leaves}` where each leaf is `H(salt‖key)`. The leaf *count* is public,
  because a majority has to be counted against something. The list may be empty; an app SHOULD name
  at least one recoverer and the owner's own backup key counts, and whoever declines has no court,
  stated plainly (§11.3).
- **`locations`** — every place you live. Readers remember all of them and try the others when one
  goes stale (GOALS).
- **`read`** — the X25519 key others seal to. Separate from the signing key by necessity, not by
  taste: deriving one from the other is field arithmetic no standard library exposes (ruling 9).
  **It is not socially recoverable** — a restore returns the name, not the archive (§11.4).

## 3. The head

```json
{"entries":[[1,"<hash>"],[2,"<hash>"],[2,null],[3,"<hash>","pending"]],
 "hseq":9,"top":3,"prev":"<hash>"}
```

- **`entries` first**, so appending leaves every earlier byte where it was and a reader that cached
  the file fetches only the tail — *including across a withdrawal*, which is the whole reason this
  shape won (§12.1, `aohead-gate`).
- **The live set is a fold**, not a list: `[n, hash]` admits, `[n, hash, "pending"]` admits a post
  the device has not released (§11.5), `[n, null]` takes one back. A number is issued once, so the
  only legal second line for it is a pending entry confirmed with the identical hash, or its
  withdrawal; anything else makes the head invalid.
- **`hseq`** — the version, never backwards. Two heads at one `hseq` is the host forking.
- **`top`** — the highest number ever issued, and it **never decreases**. Without it, withdrawing
  your newest post lowers the highest number listed and a reply to it reads as *above the top*,
  raising a rumor naming the replier over a post you deliberately deleted (§12.3).
- **`prev`** — the immediately previous head's address. Across a gap it is not checkable, and the
  spec must say so: `hseq` and the rewrite check are what carry a reader that polls slowly (§12.4).
- **A withdrawal is an appended line**, and the lines it leaves behind go when the author next
  rewrites the file. **How often is the publisher's setting** — the reader is indifferent — with a
  suggested default of once a month (§12.1). It is a privacy choice and never a size one: the
  leftover lines are ~6% of the file (`tracelife-exp.js`).
- **The head carries the whole 32-byte hash** (§12.2), and it lists media as well as posts, so
  retention is one rule and reaches sealed posts whose references the host cannot read (§11.6).

## 4. The post

```json
{"n":7,"at":"2026-08-01T09:00:00Z","text":"…",
 "rel":"reply","target":{"key":"<genesis>","n":3,"hash":"<hash>","at":"https://mom.example/mom"},
 "media":["<hash>"]}
```

- **`n`** — the post declares its own number, and this is checked **at the host as well as at the
  reader**. Recorded as a habit riding along free (ruling 3); it is load-bearing, and without it a
  stranger replays a genuine post into a number you have not reached and locks you out of it
  (§12.5).
- **`at`** — content time, ISO 8601. Displayed, never a verdict (§7 below).
- **`rel`** — `reply` / `root` / `like` / `repost` / `quote` / `mention` / `supersedes`, or an
  absolute URL for anything else. An edit is a new number that withdraws the old, with `supersedes`
  pointing back (§11.6).
- **`target`** — the whole address of what this answers: author's `genesis`, the number, **all 32
  bytes** of the hash, and where they live. The location is how a reader follows someone who moved
  (ruling 7). The full hash is what makes an author's own equivocation detectable (§12.2).
  **There is no carried pin** (§11.1).
- A reply, a reaction and a private message are all this. A DM is a post sealed to one person, and
  **it is provable by its recipient forever**, withdrawn or not (§11.8).

## 5. What a reader does, in order

Straight out of `weekend-reader.js` — 141 lines, standard library only.

1. **Profile.** Fetch it, check `genesis` is the key this reader learned, walk the chain, then check
   the file is signed by the key the chain ends on. Against a pin: `pseq` never back; the same
   `pseq` with a different address is **contested**.
2. **Head.** Fetch it and verify it **under the current key**. Fold the entries; `top` must cover
   every number listed. Against a pin: `hseq` never back, `top` never back, and every post the
   reader saw either survived unchanged or was withdrawn — a number at or below the old top cannot
   appear that was never there. **A head that will not verify is not an accusation:** a reader
   holding one it verified itself keeps that one and says nothing, and only a reader with none
   reports the host (§12.7).
3. **Posts.** For each live entry: fetch, verify under any key in the chain, check the address is
   what the head lists, and check the post declares the number it was served at. A post signed by a
   key that was hers but not listed is simply not there — which is how a stolen old key is closed
   without revocation.
4. **Targets.** A reply naming a number **above the top** of the head the reader holds for that
   author makes it look again — **once per identity per pass** — and if the number is still above
   the top, say *"X replied to something I can't see"*, **one line per person** (§12.7). A number at
   or below the top is a withdrawal, and says nothing.

**Three states, and only three** (§12.8, measured across thirteen moments): fine · this host is
misbehaving · this identity is in question. `recently restored`, `withdrawn: n`, `pending: n` and
`no head newer than the one I hold` are **notes on a fine read**. That distinction is what holds the
count at three, and the spec should say it out loud.

## 6. The publish interface

Three paths, two verbs, one conditional header, **no accounts, tokens or sessions** — the request
*is* the signed file (`pubif-gate`).

- **`PUT` a post**: created once. A losing device retries at the next number, and numbering stays
  gapless.
- **`PUT` the head or the profile**: `If-Match` on what the writer read. **A writer that loses the
  race re-reads the file the host is serving and folds its own line into that** — the naive retry
  re-sends its own idea of the list, silently drops the other device's post, and the loss reads to
  every reader as a withdrawal, so nothing anywhere reports it (§12.6).
- **A replay buys nothing**: create-once refuses a repeated post, the stale etag refuses a repeated
  head. Both fall out of rules that exist for other reasons.
- **Claiming a name** is first-come with the profile as the proof; later writes must carry the same
  `genesis` and a higher `pseq`.
- **A number held by a file that is not the owner's may be reclaimed by the owner, and by nobody
  else** — "the owner's" meaning signed by a key in her chain *and* declaring that number. Without
  this, a stranger burns every number you have not reached, for five requests and your address
  (§12.5). A host may check nothing on the ordinary path; it cannot ignore a collision.
- **The host MUST serve back the exact bytes it was given, and MUST allow cross-origin reads**, or
  no browser-based reader works across hosts (ruling 3).

## 7. Where a clock appears — the whole list

Four places, all of them display or publisher policy. **A wall clock never gates a security
verdict**, and this list is the check on that claim.

| where | whose clock | what it decides |
|---|---|---|
| `at` on a post | the author's | what is displayed, and ordering in a UI |
| a pending post's release | the author's device | when the device confirms the entry — never the reader (§11.5) |
| "recently restored", 7 days | the reader's | a flag beside a name; no verdict attached (ruling 6) |
| the rewrite cadence | the publisher's | how long a withdrawal's leftover lines live (§12.1) |

## 8. Still open — short rulings, not redesigns

- **The spoken code's bits.** ~14.6 as written, brute-forced in a second
  (`spokencode-exp.js`). 5–6 words from a 2,048-word list is 55–66 bits; a slow hash is the other
  lever. A UX ruling.
- **The envelope.** The commissioned evaluation: today's `src/enc.js` construction against an
  HPKE/NIP-44-shaped one, keeping the blinded per-recipient tags and the sealed audience, **with
  test vectors** and a padding **floor** so a DM is the size of a family post
  (`dm-metadata-exp.js`). Two outside models said the library is not the question, only the shape.
- **The generated views.** JSON Feed / Atom and an h-card from the head and the posts; nothing in
  them is signed, and the feed view is never the head (ruling 4). One experiment (GOALS priority 3).
- **Two hubs, one thread** on this substrate over real sockets — a family-only post, a sealed reply
  and a reaction across two origins, read by the unchanged reader (GOALS scenario 3).
- **The conformance taxonomy.** The design suggests *roles* — publisher, reader, hub — not levels.

## 9. What this replaces

`open-feed-spec.md` §5 (chains), §9 (manifests), §10 (inbox), §14 (export) and §15's carrier
binding all go, with their mechanisms. `src/canonical.js` goes entirely — there is no
canonicalisation left to do. The intent map owed since `CANDIDATES.md` is the next document, and it
is written per file, not per test.
