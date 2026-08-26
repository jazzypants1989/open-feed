# Where this has been

Written 2026-08-26, at the point where `archive/` was about to be deleted. It is the archive's
replacement and nothing more: the shape of five generations, the decisions that are settled and the
reasoning that settled them, and an honest account of what the simplifications cost. `COMPARISON.md`
already argues the trades against other protocols; this document is internal history only.

It is a snapshot, not a maintained file. When it stops being true, delete it — `git log` is the
record.

---

## 1. The shape of it

Five generations in about five weeks. The curve is not a slow simplification; it is a sawtooth with
one enormous inflation and two collapses.

| | Gen 0 | Gen 1 | Gen 2 | Gen 3 | Gen 4 (now) |
|---|---|---|---|---|---|
| current | pre-repo | 07-23 | 07-23 → 08-24 | 08-21 → 08-25 | 08-25 → |
| bytes | 17 KB | 82 KB | **271 KB** | 67 KB | **26 KB** |
| words | 2,229 | ~13,000 | **41,245** | 10,502 | **4,400** |
| sections | 10 + 2 app. | 10 + app. | **16 + 3 app.** | 13 + 2 app. | **10, none** |
| MUST | 0 | — | **293** | 98 | 78 |
| signed wire objects | 3 | 4 | **6** | 3 | 3 (+1 unsigned) |
| hash chains on the wire | 0 | 1 | **3** | 1 | 1 |
| reference impl. | none | none | **7,413 lines** | ~2,100 | **1,338** |
| machine-checked rules | — | — | — | — | **58** |

**Gen 0** believed an identity was an HTTPS URL serving an HTML page. Discovery was IndieWeb
`<link rel="pubkey"/"feed"/"inbox">` sniffing, content was JSON Feed with `_sig` extension fields,
interactions were a second wire schema POSTed to an inbox, and authentication was OAuth 2.0 plus
IndieAuth with five scopes. Private content was an explicit non-goal. It already said "small enough
to implement in a weekend," and it had zero RFC 2119 keywords — it was a sketch wearing a spec's
clothes.

**Gen 2** is the one worth staring at. 271 KB, 293 MUSTs, three independent hash chains, four
conformance levels. Almost none of that growth was decoration: each new MUST answered an attack
found on the previous draft. The `kid` rebinding rule, the `typ` kind-binding, the `_recovery_sig`
ordering rule, the anchor-confirmation fetch, `_next_update` — every one is a patch. By its section 13 it
carried seventeen numbered security items and needed a whole new chapter, section 16, item-carried
pins, purely to supply the second observations its compare rule demanded. **That is what a
design looks like when it is defending a bad premise.**

**Gen 3** changed the premise, and 271 KB became 67 KB in one commit (`6791a91`).

**Gen 4** compressed 2.6× further while losing almost no mechanism — MUSTs only fell 98 → 78. What
went was prose: rationale, worked examples, the conformance section, the security section, both
appendices. And the spec stopped being written: `tools/spec.js` now assembles it from `rule()`
strings the runnable examples print after the assertions that prove them.

## 2. The one change

**Identity is a key, not a URL.**

That single inversion deleted, simultaneously and without any of them being argued separately: URL
normalization and its six clauses, percent-encoding rules, migration links, `successor`/`predecessor`
chains, predecessor equivalence "and its seven sites", author binding, `kid` naming and rebinding,
the `feeds[]` array, and a manifest per feed. None of those mechanisms was wrong. They were all
correct answers to "what happens when the thing that identifies you can change or be taken," and
that question stops existing when the identifier is a key you hold.

Six of six outside models, given the brief cold and no access to the repo, made identity a key and
rejected domain identity. Three of the six independently named their design "Hearth."

The generalisation worth keeping: **every mechanism whose correctness depended on the hub keeping
history was replaced by one that depends on the reader keeping state.** Gen 2 retained every prior
version of the identity document and the manifest at derived URLs forever, and a reader walked
`prev` links back to its pin. Gen 4 overwrites both files and the reader remembers a checkpoint
(§7.3). That is the same trade in nine different places.

## 3. Settled, and why — do not re-litigate without answering these

Each of these was decided against a specific alternative for a specific reason. Reversing one means
answering the reason.

**Identity and keys**

- *Recovery is named-in-advance, not social.* "Enough peers a reader already trusts" was rejected
  because the hostile operator **is** a peer the mother already trusts, and because it makes identity
  viewer-relative — mother and sister end up disagreeing about who Alice is, both certain, no
  warning, identical bytes on both phones.
- *The recovery list is committed as salted hashes, revealed only on vouching.* Cleartext lists leak
  the family; a Merkle root hides the size, and a majority needs the size.
- *A restore changes the key and nothing else* (§3.2). One sentence, and it converts a permanent
  takeover into one the owner's own people can undo.
- *No revocation mechanism.* A key rotated away from keeps its posts valid but cannot sign an index
  (§4.4) or hold a number (§8.5). Eleven words that prevent an entire feature being invented.
- *One key per person, synced between devices by the app.* Per-device keys need a vouching key, and
  every home for it contradicts something already decided: at the hub, the hub can vouch for a device
  of its own and post as her; on paper in a drawer, it is the file Grandma was promised she would
  never have to keep. Recorded caveat: **defensible for families and wrong for journalists, and the
  first thing to revisit if the audience widens.**
- *A separate X25519 reading key*, not one derived from the signing key. Deriving means hand-written
  Edwards-to-Montgomery arithmetic, which no mainstream standard library exposes. Settled by priority
  1, not really a choice.

**The index**

- *The generated feed view is never the index.* Unanimous across all six outside models. A view is
  something the hub can regenerate; the index must be producible only by the author's key.
- *`highest` never decreases* (§4.2). Without it, withdrawing your newest post turns every reply to
  it into a rumor about a post the author deliberately deleted.
- *The index is signed by the key the chain currently ends on* (§4.4). A thief holding a rotated-away
  key can otherwise sign an index, and the index is what admits posts. Re-signing the index is what a
  restore actually restores.
- *Posts are immutable; an edit is a new post that withdraws the old.* In-place editing is
  indistinguishable from a compromised-key rewrite, leaves two files claiming one number that the
  family archive cannot order, and strands every old reply.
- *The full 32-byte hash, not a 16-byte prefix.* Rejected on minimality, not safety: two widths must
  be kept in step forever.

**Encryption**

- *The audience list goes inside the ciphertext* (§6.4). Taken as a bug fix, not a choice — without
  it a reply to a family-only post reaches the original author and nobody else, silently, and the
  thread splits in half with no error anywhere.
- *The post binding is associated data, not fields compared afterwards* (§6.2). A thief lifts her
  envelope into a post of his own, signed by his key, listed in his index; her family decrypts it and
  her words render under his name. As AAD there is no "forgot to compare."
- *Audience entries are `{key, read, location}`.* Reading keys alone leave a replier holding an
  X25519 key and nothing that leads to a profile.

**Publishing**

- *No accounts, tokens or sessions.* The request is the signed file; claiming a name is first-come
  with the profile as proof. A hub MAY require more — that is the market, not the protocol.
- *Serve back the exact bytes.* Pretty-printing, sorting keys, or adding a trailing newline each make
  every post read as forged, and all three are things ordinary servers do unasked.
- *A collision is reclaimed, not refused* (§8.5). Flat refusal lets a griefer PUT five files under
  Alice's next five numbers and lock her out forever, for five requests.
- *Publishing is "put this file here," not "make your state match mine."* The sync-shaped version
  means a device with a partial copy erases the hub, and the loss reads to every reader as censorship.

**Scope**

- *Everything is pull. There is no inbox* (§5.6). A dead-drop inbox was built and demonstrated over
  real HTTP in ~25 server lines. It works — and it costs the recipient the ability to be a plain
  static file server.
- *No global resolver.* The moment you add a resolver you have a registry, and the moment you have a
  registry you have a central authority.
- *No canonicalization.* The design signs served bytes. RFC 8785's serializer went; its hygiene
  residue is §2.4.
- *Three roles, no conformance levels.*

## 4. What was decided twice

Worth keeping because each is a case of the design arguing back at its own record.

- **Contests** and **first contact** were both retired by the redesign as complexity, and the spec
  reinstated both — two branches need a tiebreak, and nothing else stops a hub introducing an
  identity it also publishes. The goals document was wrong in the productive direction.
- **Item-carried pins** were retired, re-adopted by the fresh-start design as a split-view detector,
  then dropped for good: as specified they were a forgery vector, letting any replier make an honest
  hub read as withholding.
- **The tiny counter** (138 bytes, `{sequence, top, withdrawn, prev}`) was chosen over a list, then
  reversed for the append-only entries list — the counter cannot express an edit.
- **`prev`** was added to both overwritten files and then cut: a field only checkable by the reader
  that saw the version immediately before is a field no reader can rely on, and a member nobody reads
  is a member implementers get wrong.
- **Scheduled posts** were kept, rescued by a `pending` mechanism, and then both were cut. Removing
  `pending` removed eighteen spec lines.
- **`k`**, the author-set recovery threshold, survived three reviews and then fell: a threshold below
  a majority was a second door into the identity that the contest rule never watched.
- **Padding** — dummy slots and a 512-byte floor — was wanted by five of six outside models, adopted
  as a SHOULD, and then cut outright on the ruling that hiding the size of an audience from the hub
  is not a goal.

## 5. What it cost, tested

The four candidate regrets were not argued. Each got a script that staged it against the adversary in
`GOALS.md`, and an item whose script showed no harm was struck rather than softened. Three showed
harm and produced spec changes in this session; one was struck.

**A recovery list of one — fixed.** A list of one is not a weak configuration; it is a complete,
silent, permanent transfer of the identity to that member. He mints a restore to his own key,
re-signs the index, and every reader in the family reads `ok` with the note `recently restored` — the
same note an honest rescue shows. The owner, still holding her key, cannot win it back, because §3.4
rule 4 says `signature` is not a vote. She cannot outrun it either: rule 2 keeps the first list a
reader saw at each chain length, so that length stays his permanently. §3.3 had SHOULDed against this
since the beginning, which meant a SHOULD was the only thing between Grandma and whoever set up her
phone — and `test/scenarios.test.js` staged her scenario in exactly that arrangement. §3.2 now
refuses a restore under fewer than two leaves. It cost one leaf and the scenario survives intact.

**A stale reading key — fixed.** §3.6 said "a `read` taken from a profile it verified" and said
nothing about *when*. So a publisher doing everything the spec asked would keep sealing new content
to a key its owner had replaced, indefinitely, with no signal to either party; the recipient could
not read her own family's messages and could not tell why. That was a defect, not a limit. §3.6 now
names the highest verified version. The back-catalogue loss is real and stays: rotation is
prospective only, nothing re-seals, and a restore does not recover the key.

**A hub that freezes — stated.** Serving the last index she ever wrote there, unchanged, is invisible
to a reader on its own: cold or checkpointed, first read or hundredth, every rule in §7 passes,
because every rule in §7 asks what was *served* and not whether it is *current*. §7.4 was already the
answer and never said so — one reply from one person the reader also reads, naming a number above the
frozen `highest`, and the reader finds her. The rule now names that job and its precondition. This is
the closest thing to an answer the record has for kimi's challenge (section 7 below).

**The offline archive — struck.** The record signed this off as lost: "hand someone the archive and
they can check it with no host has no sentence." It is true today. Both readers verify a directory of
kept bytes with no hub and no network, and both catch a single flipped byte, because §2.1 makes every
file self-checking and §8.9 hands her the files. The directory *is* the export bundle Gen 2 spent a
chapter defining. Nothing was written down, because there was nothing to write down.

**Still uncosted, by design.** No forward secrecy and no removal from a past audience. No metadata
privacy — who published, when, at what number, and from any reply's `target` who replied to whom, are
public on every tier. No deletion. No discovery. No push, so latency is polling latency. No moderation
layer. No scale into items-per-identity: the index is one file that grows by a line per post.

## 6. What this session's survey found

Defects that were live, none of which any existing gate could see:

- **§6.1's "One X25519 ephemeral key pair per message" carried no RFC 2119 keyword.** Reuse one
  across two posts to the same recipient and both slots derive the same `(kek, knonce)`, so the
  wrapped content keys are a two-time pad. A review found this and the fix never reached the text.
- **§7.4 fixed a location order and unmade it two sentences later with a `MAY`** — and the two
  readers had genuinely diverged there, which matters because two independent readers agreeing is the
  repo's headline evidence.
- **"A static file server is a fully conforming hub"** contradicted §8.5's "MUST NOT ignore a
  collision," which needs an index parser.
- **32 references to appendices deleted three weeks earlier**, in twelve files including `src/` and
  both capstones.
- **A comment claiming a code path the assertion beneath it disproved** — floor item 4's most
  interesting half, documented and unstaged.

Four gates now exist so these cannot recur, all in `npm run check`:

- `tools/refs.js` fails on a `§N` that is not a heading, an appendix reference, a link or `Run:` line
  naming a file that does not exist, retired vocabulary in our own prose, a `package.json` version
  that disagrees with the spec, and a spec over its word ceiling. It found 83 defects on its first
  run — including one this session had introduced an hour earlier.
- `tools/regen.js` gained **negative vectors**: nine failure cases both readers must reject, with the
  same verdict. Previously every vector was well-formed, so the two-reader check proved they agreed
  on acceptance and nothing about refusal — which is exactly how the `k` defects and an earlier
  reader divergence both got through.

Two things are reported and not changed, because they are the owner's:

- `GOALS.md`'s staging table sends scenario 7 to `test/scenarios.test.js`, where only the views half
  lives; the bridge and re-meeting halves are in `test/interop.test.js`, `test/bridge.test.js` and
  `test/views.test.js`. The scenario is covered; the table is wrong about where.
- §8.6 weakened between generations. Gen 3 made a hub MUST refuse media bytes that do not hash to the
  name; Gen 4 says MAY. It reads like drift rather than a decision.

## 7. Still open

**kimi's challenge**, the sharpest thing the outside review produced, which the record flags as
deserving a written answer and never gets one:

> The chain defends the archive; the push channel defends the person. If forced to choose, the floor
> needs the person. Their error was not refusing the lattice; it was refusing the lattice *and* the
> push channel, leaving nothing.

The freeze demonstration is a partial answer and the first evidence anyone has offered: something did
remain, it is §7.4, and it works — but only when someone the reader already reads has replied. That
precondition is now written into the rule rather than assumed. Whether it is enough is still a live
question, and it is the one to reopen first if any of this is reopened.

**glm's root-of-trust gap**, also unanswered:

> Whoever chooses her app — the daughter, or in a worse family, the son-in-law "helping her set it
> up" — is her undeclared root of trust, and the spec is silent about it.

This session narrowed it by exactly one notch: that person can no longer be a recovery list of one.
Everything else about it stands.
