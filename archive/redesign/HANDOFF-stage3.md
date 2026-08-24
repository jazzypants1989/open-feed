# Handoff — Stage 3, Session A. Read this before PLAN.md.

**Written by the agent that failed Session A, at the owner's instruction, for a fresh agent.**

## 1. What happened, and why you should distrust everything below

Session A was supposed to draft **Open Feed 2** — a radical straw-man, judged on the balance of
simplicity, flexibility, and capability. The owner's standing invitation was to build *anything*
that serves the same goals more simply.

What I produced instead was the current spec with two sections deleted and one field renamed. It is
in `tmp/redesign/SKETCH-rejected-2026-08-19.md` — **moved out of the repo root deliberately so you do
not mistake it for a baseline.** It is not a starting point. Read it only to see what timid looks
like, or skip it entirely; nothing in this handoff depends on you having read it.

Concretely, the failure has a shape worth knowing so you can avoid it:

- I accepted the current spec's **section skeleton** (16 sections, same order, same names) and asked
  only "what can be deleted from each." That guarantees the answer is the same protocol.
- I accepted every constraint `PLAN.md` listed as "held fixed" without testing whether the reasons
  behind them still held.
- I treated the 267 existing tests as a set of intents to *preserve*, which is a conservatism engine:
  every test is an argument that the thing it tests should exist.
- I let `src/` (7,413 lines, implementing the current design) act as gravity.
- The one move I labelled "R1 — the manifest becomes an append-only event log" changed a document's
  **encoding** (`{id: [version, hash]}` map → `["add", id, version, hash]` array) and nothing about
  the architecture. I then wrote 21,000 words around it.

The owner's verdict: *"basically made the exact same thing with some tiny little tweaks."* That is
accurate. Do not repeat it.

## 2. Your instruction, which supersedes `PLAN.md` where they conflict

**Question everything.** Every document, every mechanism, every rule, every stated rejection, every
"held fixed" — including the ones in this file. Nothing I suggest below is a recommendation; the
questions are there because they are unanswered, not because I know the answers. I demonstrably do
not. Where a question of mine points at an answer, treat the pointing as noise and re-ask the
question from scratch.

**You are explicitly not bound by:**

- `PLAN.md`'s three moves (R1 / R2 / R3). They are one agent's guesses. Discard them, invert them,
  or replace them wholesale.
- `PLAN.md`'s "held fixed in every candidate" list — the exit triad's *shape*, §6 + §6.3 + §3.1
  verbatim, the §15 envelope, `feed.json` as a JSON Feed view. Every one of those is a question, not
  a constraint. (The *goals* those things serve — see §3 below — are the constraint.)
- The current section numbering, document set, artifact count, or vocabulary.
- The existing 267 tests, `src/`, and Appendix B's vectors. They implement a design that is on
  trial. A test whose intent does not survive is evidence, not a cost.
- Anything in `tmp/prototypes/*.md`, `tmp/review-findings.md`, or the "previously settled decisions"
  register. Owner ruling 2026-08-17 item 1 already reopened all of it: a reversal must *answer the
  recorded reasoning in writing and be surfaced plainly*, never adopted silently. That is the only
  procedural obligation, and it is not a bar to reversing anything.

**What actually is fixed** (`PLAN.md`, owner ruling 2026-08-17 item 2) is a floor of **assurances,
not mechanisms**:

1. **Exit** — a person can leave a host that does not want them to, taking their identity's
   continuity and a verifiable copy of their content.
2. **Cross-hub family visibility** — two families self-hosting on separate hubs can see each other's
   content.
3. **Audience-restricted content** — content readable by a chosen set and by nobody else.

Read §13.2 of `open-feed-spec.md` before touching anything security-relevant. The driving adversary
is **a loved one who operates the hub**: inside the audience, entitled to look, controlling the exit.

Everything else in the protocol exists to serve those three, and any mechanism that cannot be traced
to one of them is a cut candidate — including mechanisms the current spec spends thousands of words
defending.

## 3. Verified state of the repo (re-derived this session, 2026-08-19)

- `npm run check` → **exit 0**. Tests, `tmp/regen.js`, `tmp/rules.js --gate`, and all 11 prototype
  gates pass. That was the state at session start and it is the state now.
- `node tmp/measure/tldr-check.js` → green (200 / 97 / 10) against the current `TLDR.md`.
- Working tree changes made this session, both hygiene, neither a design act:
  - `tmp/measure/tldr-check.js` now takes an optional path argument
    (`node tmp/measure/tldr-check.js SOME.md`), defaulting to `TLDR.md` as before. Three lines.
  - `tmp/redesign/` created; the rejected sketch and this file live there.
- **`PLAN.md` was deliberately not updated.** Stage 3 Session A's checkbox stays unchecked, because
  Session A was not completed. Update it when you finish, per the campaign's own rule.

### Numbers re-derived this session (method: `## `-delimited sections, fenced code dropped)

| | words |
|---|---|
| `open-feed-spec.md`, §1 → end of Appendix C | **40,470** |
| The rejected sketch, same method | 21,285 (−47.4%) |
| `PLAN.md`'s Session A target | 8,000–12,000 |

Per-section, current spec (§1→end): Principles 404 · Terminology 478 · §3 Identity 3,652 ·
§4 Keys 3,161 · §5 Chain 2,695 · §6 Signatures 2,950 · §7 Feeds/Items 3,422 · §8 Interactions 938 ·
§9 Manifest 4,981 · §10 Inbox 2,084 · §11 Privacy 1,708 · §12 Conformance 1,397 ·
§13 Security 2,685 · §14 Export 1,031 · §15 Encryption 3,556 · §16 Pins 1,603 · App A 182 ·
App B 1,707 · App C 1,836.

Reproduce with:

```
node -e 'const fs=require("fs");const t=fs.readFileSync("open-feed-spec.md","utf8").replace(/```[\s\S]*?```/g,"");
let on=false,w=0,sec=null,per={};for(const l of t.split("\n")){if(/^## /.test(l)){if(/^## 1\. /.test(l))on=true;sec=l.replace(/^##\s*/,"");per[sec]??=0;}
if(!on)continue;const n=l.split(/\s+/).filter(Boolean).length;w+=n;if(sec)per[sec]+=n;}
console.log(w);for(const[k,v]of Object.entries(per))if(v)console.log(String(v).padStart(6),k);'
```

Test intent inventory (267 across 13 files) — extract mechanically, do not trust a transcription:

```
for f in test/*.test.js; do echo "=== $f"; grep -n "^\s*test(" "$f"; done
```

**Every number in `PLAN.md` is stale-prone and the campaign's own working rule applies to all of
them: if you are about to act on a number, re-derive it first.** That rule exists because of four
documented instances of exactly that bug, one of which was found inside the campaign's own
instruments.

## 4. Claims I made this session — attack these, do not inherit them

Each is a claim I asserted without a gate. They are here so you can kill them cheaply, not so you
can build on them.

1. **"Deletion forces the permanently-retained structure to contain hashes, not content."** My
   argument: §5.4 requires retained versions byte-identical forever, so items carried by value in a
   retained version can never be deleted. Attack routes: redactable or elidable hashing (hash a
   skeleton in which each item is replaced by its own hash, so bytes can be dropped without breaking
   the chain); accepting that deletion is not real and saying so; dropping permanent retention
   entirely. **This is load-bearing for a lot of the current architecture and I never tested it.**
2. **"Killing the delivered column removes the tl;dr's most painful omission."** The single piece of
   checkable evidence I produced: a tl;dr written for a protocol with one publication channel fits
   200 / 98 / 10 while naming the concept explicitly, where the current spec's fits 200 / 97 / 10
   only by never mentioning published-vs-delivered at all. It is in the rejected sketch and it is
   one data point about one paragraph.
3. **"A published encrypted item hides more than a delivered cleartext one."** §15.2's blinded slot
   tags hide *who* an item was wrapped to, so moving private messages onto the published axis exposes
   existence / time / size / slot-count and hides the recipient. Unmeasured, and it is a claim about
   an **unreviewed** cipher layer (§15's own status line).
4. **"~4,500 words of the 19,000-word reduction were design-driven; the rest was rationale
   compression."** Eyeballed from the per-section deltas, not measured. If it is true, it means the
   8–12k target is unreachable by design alone and Stage 4's rationale split has to happen inside
   the sketch. If it is false, design has much more room than I found.

## 5. Questions. Ask these and many more.

Organized only to be readable. None is rhetorical, none has a preferred answer, and the list is
deliberately wider than one session can answer — pick the ones that could move the design most, and
add the ones I failed to think of.

### 5.1 The artifact set — the questions I never asked

1. Why are there **three** content documents (feed, manifest, retained history) and **two** chains?
   What is the smallest artifact set that delivers the floor?
2. Why is the manifest a separate document from the feed at all? What breaks if they are one?
3. Why is the identity chain separate from the content chain? The recorded reason is that a manifest
   version carries the whole live set, so merging would make the identity chain enormous — does that
   reason survive any encoding where a version is O(changes)?
4. Does an identity need a *document*? Could keys live somewhere that already exists (DNS, TLS, a
   `.well-known` key set, an existing standard) and delete §3.2 and §4 wholesale?
5. Does the protocol need **items** as a distinct object, or is a feed of opaque signed blobs plus a
   rendering convention enough?
6. Does it need a **feed** in the JSON Feed sense? What does JSON Feed compatibility measurably buy,
   and who has actually consumed one of these feeds? (`PLAN.md`'s third open question — adoption
   asymmetry — is relevant and unresolved.)
7. Are conformance **levels** load-bearing, or are they a taxonomy invented to describe a design that
   grew? What would one level look like?
8. Is `_openfeed` as an extension namespace the right call, or is riding somebody else's object model
   the thing that generates §7.2's whole argument?

### 5.2 Signing and canonicalization — §6 is 2,950 words and I never questioned a line of it

9. **Why is there any canonicalization at all?** Sign and hash the bytes as served, and RFC 8785,
   I-JSON, duplicate-member rejection, `__proto__`, lone surrogates, the ±(2⁵³−1) rule, parser
   equivalence, `canonical.js`'s hand-written parser, and the "must arrive as its own
   canonicalization" rule all evaporate. The stated blocker is that an item has no byte range of its
   own because it sits inside a feed array. Is that blocker real, or is it an artifact of choosing to
   carry items inside arrays?
10. Would carrying each item as an **opaque string** (or a JWS with an encoded payload, RFC 7515
    without RFC 7797) give every item a byte range and delete the answer to question 9?
11. Why detached JWS? Why JOSE at all, rather than Ed25519 over a length-prefixed byte string with a
    two-field header?
12. Is `typ` kind-binding (§6.2, §6.5 step 3, §6.6) solving a problem that only exists because three
    document kinds share one signing construction and one shape space?
13. `_sig` covers `_recovery_sig` and the co-sign-then-sign order (§6.3). Is a co-signature the right
    primitive, or does the whole recovery story want a different shape?

### 5.3 Identity, migration, exit

14. Is a **URL** the right identity primitive? §13.15 concedes that durable identity across domain
    loss is what atproto buys with DID indirection, and that Open Feed trades it away. Re-price that
    trade: key-based identity would delete §3.4's migration, most of §4.5, predecessor equivalence
    and its five consumer sites, and invariant 5 — roughly 3,500 words and the single most
    cross-cutting concept in the spec. What does the resolution layer actually cost?
15. §3.1's percent-encoding rule is the **longest-standing open question in the project** and has
    never had a prototype: two conforming implementations can split one identity into two chains. Is
    it a bug in the rule or a symptom that URLs are the wrong primitive?
16. **Predecessor equivalence** reaches §4.4, §7.5, §9, §9.3 inv. 5, §10.2, §10.3, §16.1. Is a design
    where migration needs no equivalence rule available?
17. Recovery keys deliver exit only if the host never held them (§4.5, §12 req. 1) *and* the genesis
    commitment is compared out-of-band (§12 req. 2). Both are onboarding-UX requirements that a spec
    cannot enforce. Is exit better delivered by something the protocol can actually check?
18. §14's export bundle is a JSON document with slots that carry no completeness proof. Is a bundle
    the right shape, or is exit just "your content was always at URLs you can copy"?

### 5.4 The transparency machinery — the largest pile, and possibly the least earned

19. §13.2 concedes that per-consumer equivocation is **detectable, not detected**, because the core
    supplies nothing to compare. Pinning, walking, retained versions, derived URLs, skip links, fork
    resolution, the compare rule, and item-carried pins are all built to serve a property that no
    single reader can ever exercise alone. **Is that pile worth its price?** What is honestly lost by
    deleting it and saying so?
20. If the answer is "keep it," what is the minimum that delivers it? Is pinning a burden correctly
    placed on every consumer, or should detection be a *role* somebody opts into?
21. Is **permanent retention** (§5.4) right, given §13.8 says the permanent public record of
    deletions and cadence is *precisely the leak that matters* for the driving persona? Retention and
    the threat model point in opposite directions and the spec says so out loud.
22. Could deletion be **real**? What exactly breaks, and is what breaks something the floor needs?
23. Is **TOFU** acceptable? A family has a real out-of-band channel (they are in the same room). Does
    a bootstrap that uses it — a fingerprint, a QR code, a shared secret — delete a whole class of
    attack and a whole class of text?
24. §9's five invariants, three verdict states (lag / withheld / violation), a fourth (stale), and
    §13.13's instruction not to collapse them: is that lattice inherent, or is it the shape of having
    two documents that can disagree?
25. §7.6's derived item URLs plus §3.2.1's `items: true` capability flag exist so that one verdict is
    reachable at all. Is a design where withholding is structurally visible available?
26. §9.1.1 skip links and §13.4's history-byte budget exist because retained manifest history is
    O(versions × items). Is that complexity a consequence of one encoding choice?
27. §9.1.2 and §13.17: the freeze attack is answered by a field a key custodian defeats by advancing
    an empty manifest on schedule. Does a mechanism that only binds an attacker who cannot sign earn
    its section, given the driving adversary *can* sign?

### 5.5 Privacy, interaction, encryption

28. Should the protocol have a private channel at all? (I said no; that is one answer, and I did not
    price the alternative.) If it should, is the inbox the right shape?
29. §15 is **unreviewed** by its own status line and the layer is already required of any deployment
    offering audience-restricted content. Any design that increases its load must say so loudly. Any
    design that *removes* the need for it deserves serious consideration.
30. §11.2 permanently forecloses a membership roster and §15.2.2 admits a declared audience as the
    nearest available thing. Is audience restriction a job for this protocol, or for a layer that
    does not have to be verifiable by strangers?
31. Are **interactions** (§8's relation vocabulary, threading, `to` fragment form, §8.1's `root`
    entries) protocol machinery or application convention?
32. §11.4 and §13.8: the interaction graph, posting cadence, and deletion record are permanently
    public. For an adversary who is a family member, is that acceptable *at all*, and if not, does the
    whole publish-everything model survive?

### 5.6 Scope, and the questions about the project rather than the protocol

33. "Families and small groups first, designed to scale across identities" — are those one product or
    two? What does the family-only protocol look like with the scaling requirement deleted?
34. Could this be a **profile of an existing protocol** rather than a new one? The current answer is
    Appendix C plus README's comparisons; it has never been tested as a serious alternative.
35. `DISTRIBUTION-MODEL.md` (20,091 words) describes a family AI-journaling hub. Which of the spec's
    mechanisms does that product actually consume, and which are there for a hypothetical second
    deployment?
36. What is the smallest thing a second implementer could build in a weekend, and is that the target?
    Nobody outside this repo has read the spec (§ version policy), so there is no installed base to
    protect. That is a freedom, not a gap.
37. Does the reference implementation shape the spec? `src/` is 7,413 lines implementing the current
    design and the spec is checked against it. Is that a correctness win or a conservatism engine?
38. Is the 267-test suite a specification of behavior or a specification of *this* behavior?

### 5.7 Meta

39. `CLAUDE.md`'s "guard the simplicity" rule and its "keep the rule, cut the archaeology" rule both
    assume the current shape. If the shape changes, which of the repo's own editing rules become
    wrong?
40. Stage 4 plans a wholesale rationale split into `RATIONALE.md`. Should that happen *first*, so the
    spec's real size is visible before anyone redesigns against it?
41. Is a word count the right target at all, or does it repeat the line-budget mistake `CLAUDE.md`
    records retiring? The stated real target is *the shortest spec that still covers its bases*.

**Add your own.** The list above is one failed agent's imagination and its blind spots are exactly the
ones that produced the rejected sketch.

## 6. What Session A still owes

Per `PLAN.md`, unchanged and unstarted:

- [ ] A straw-man draft, written small from the start. Missing the 8–12k target is itself a finding —
      but so is hitting it by writing the same protocol shorter.
- [ ] `tmp/redesign/intent-map.md` — all 267 test intents mapped kept / transformed (mechanism named)
      / dropped (owner sign-off flagged). A silent gap here is the stage failing. Note that the map is
      an *accounting* instrument: use it to prove nothing was lost by accident, never as a design
      constraint that stops you dropping something on purpose.
- [ ] `tmp/redesign/rejections.md` — every recorded rejection answered by name: §9.2's Merkle
      paragraph, the deltamanifest card, the delivery-chain card's Q4 and its two rejected receipt
      designs, §16.1's aggregator foreclosure, §11.2's roster foreclosure, §15.4's history, and the
      five "previously settled decisions" in `PLAN.md`.
- [ ] The draft's tl;dr through `node tmp/measure/tldr-check.js <file>`, and published/delivered's
      fate stated in plain words.

Do not treat that list as the order of work. Answering §5's questions may make some of those
artifacts describe something that no longer exists.

## 7. Where things are

| | |
|---|---|
| The spec on trial | `open-feed-spec.md` (§1–§16, Appendices A–C) |
| The campaign and its state | `PLAN.md` — read the owner rulings and the floor; treat the three moves as discardable |
| Orientation, repo rules, traps | `CLAUDE.md` — the traps list is the part worth reading twice |
| The rejected sketch | `tmp/redesign/SKETCH-rejected-2026-08-19.md` — not a baseline |
| Verdict cards (what is already priced) | `tmp/prototypes/*.md` — read before re-litigating, then feel free to re-litigate |
| Runnable gates | `tmp/prototypes/*.js`, contract in `tmp/prototypes/README.md`; `npm run prototypes`, `npm run prototypes:revert` |
| Measurement scripts | `tmp/measure/` — numbers that could invert; re-run |
| Prior review record | `tmp/review-findings.md`, `tmp/sketches-review.md`, `tmp/appendix-c-case.md` |
| Everything green | `npm run check` |
