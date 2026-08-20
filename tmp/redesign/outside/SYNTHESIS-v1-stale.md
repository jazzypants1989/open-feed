# Outside perspectives — routed synthesis

> **⚠ STALE — do not act on this file.** It was written against pass-1 answers produced by a
> defective brief (`PROMPT-pass1-DEFECT.md`), and in a style the owner has since ruled out. It is
> kept only so the retraction in §1.2 has somewhere to live. The replacement is written against the
> corrected re-run and follows two owner rulings of 2026-08-20:
>
> 1. **Report and flag; do not rank.** State what each model said, verify every claim against the
>    actual line in the repo before writing it down, and route it. No "headline finding," no
>    ordering by importance, no recommendations. The owner decides what matters.
> 2. **No claim about `GOALS.md`, the spec, or `src/` goes in without reading and quoting the
>    line first.** Every failure in this file's first draft came from paraphrasing instead of
>    reading.

**2026-08-20. DRAFT — pass 1 only; pass 2 pending.** Five non-Anthropic models, no repo access, the
brief in `PROMPT-pass1.md` and nothing else. Read `README.md` for how they were prompted and why.

**How to read this.** A suggestion from a model is not a finding. Every distinct claim below is
routed to exactly one verdict:

| | |
|---|---|
| **CONVERGENT** | three or more models reached it independently. The strongest signal this exercise produces — but convergence on something we already decided is *confirmation*, not news, and is marked as such. |
| **NEW** | not priced anywhere in this repo. Carries a falsifier: what a gate would have to show. |
| **ALREADY PRICED** | cites the card or rejection that answers it. |
| **WRONG** | contradicts the floor, the adversary, or a measured number, with the reason. |

Citations point at real files. `tmp/redesign/rejections.md`, `tmp/prototypes/*.md`, and
`tmp/redesign/gates/*.md` are the ledgers; a claim routed ALREADY PRICED without a section that
actually contains the answer is the campaign's own documented failure mode and must not appear here.

---

## 0. What actually came back — provenance and reliability

Read this before weighting anything below. The roster did not survive contact with the gateway.

| model | lab | pass 1 | notes |
|---|---|---|---|
| `gpt-5.6-luna` | OpenAI | **complete** | 58s, 5,543 completion tokens, no reasoning phase. The tersest and most conservative answer. |
| `glm-5.3` | Zhipu | **complete** | 753s, 41,586 reasoning + ~7,400 answer tokens. The most ambitious answer; argues prior art section by section and names its design. |
| `deepseek-v4-pro` | DeepSeek | **truncated, then retried** | First attempt cut mid-sentence in scenario 4.3 after 843s / 173k reasoning chars. Retried with `reasoning_effort: medium`. |
| `kimi-k3` | Moonshot | **failed twice** | 510s/60k and 88s/11k of reasoning, then the stream ended with **no answer both times**. Traces kept as `*-reasoning-only.md` and cited below as traces, never as answers. |
| `qwen3.8-max` | Alibaba | pending | still generating at the time of writing. |
| `grok-4.5` | xAI | **HTTP 503** | added as a substitute for kimi; the upstream endpoint was unavailable. |

**The failure mode is structural, not random.** Heavy reasoning models blow past the gateway's
stream limit during the thinking phase and the connection ends before any answer is emitted.
`glm-5.3` finished with little margin. This is why `ask.js` grew a recorded `--effort` flag: it is a
change to what produced the answer, so it is stamped in each response header rather than left
implicit.

**Weighting consequence:** "three or more models independently" below counts *sources*, and a kimi
reasoning trace counts as a source only where it reaches an explicit conclusion. Two complete
answers plus a trace is not the same evidence as four complete answers, and CONVERGENT rows say
which.

---

## 1. CONVERGENT — what the outside agrees on

### 1.1 Confirmations (they agree with decisions `GOALS.md` already took)

These are worth exactly one thing: they retire the worry that `GOALS.md`'s big reversals are an
artifact of one lab's house style. Four labs, cold, reached the same three places.

| finding | sources | our position |
|---|---|---|
| **Identity is an Ed25519 public key, not a URL.** Every one of them rejected domain/URL/handle identity explicitly and by name, on the divorce scenario. | gpt, glm, deepseek, kimi-trace | `GOALS.md` "Identity is a key." **Confirmed.** |
| **Sign the exact bytes of an encoded payload; no canonicalization anywhere.** Three produced almost the same envelope — `{payload: b64, signature, signer}` — and gpt used a length-prefixed byte string instead. glm's reason is the one to steal: *"the bugs are invisible until two implementations disagree at 2 a.m."* | gpt, glm, deepseek, kimi-trace | `GOALS.md` "signed as the bytes served"; `gates/bytes-gate.md`. **Confirmed.** |
| **Recipient slots carry no recipient identifier; readers trial-decrypt.** Reached independently as the only way to encrypt to a set without publishing the set. | gpt, glm, deepseek | `tmp/prototypes/enctags.md` (§15.2 blinded tags). **Confirmed** — and glm's "no stable tag, because a stable tag lets the hub cluster same-circle items" is our blinded-tag argument re-derived, since its `chk` is a per-nonce blinded tag by another name. |

### 1.2 The palette anxiety — an artifact of the brief, retracted

**See `PROMPT-pass1-DEFECT.md` for the full statement.** In short: §4 of the pass-1 brief rendered
`GOALS.md`'s "no dependencies" priority as a closed list of five allowed primitives. It is not one.
The list is illustrative; the constraint is "no third-party packages." X25519, AES-KW, and AES-GCM
are in Node's standard library — which is why `src/enc.js` has zero dependencies today.

An earlier draft of this file promoted that to the headline finding. It was an authoring error in
the brief, not a finding about the design. **Three of the four complete answers chose a hash-only
symmetric construction, and the brief explains that convergence**, so it must not be read as
independent agreement. Pass 1 was re-run against a corrected brief.

---

## 2. NEW — unpriced, ranked by how much they would move the design

### 2.1 Symmetric "circle" keys instead of per-recipient public-key encryption ⚠ largest

**glm-5.3.** Drop per-recipient key wrapping entirely. An audience is a **random 256-bit symmetric
key** handed to chosen people out of band (a QR across a kitchen table, or a link over a channel the
family already trusts). Content is encrypted under that key before the hub sees it. Admitting
someone to a circle is a small encrypted grant riding your own log, under a per-pair channel key
derived from the pairing secret. Revocation is rotation: new circle key, new grants to the members
who remain.

Its argument, which is the part worth attacking:

> *per-recipient public-key encryption is wrong for this adversary.* Against an insider it buys
> nothing (he's a recipient); against the hub it costs the audience list; and it needs a DH
> primitive off-palette. Symmetric circle keys with out-of-band pairing are not the consolation
> prize — they are the correct semantics: *the audience is a shared secret among exactly the people
> chosen.*

**What it would buy.** X25519 leaves the palette (see 1.2). The recipient-slot array disappears, so
the audience-size leak (2.2) disappears with it. §15's whole envelope becomes: nonce, check value,
ciphertext.

**What it costs, in its own words:** no forward secrecy of any kind; every confidentiality property
routes through a 16-byte secret exchanged over a channel the family trusts, so a compromised
introduction channel compromises the circle from birth; and a departing member keeps the old key and
the old archive until everyone rotates.

**Routing: NEW.** `tmp/prototypes/enc.md` asked whether audience-restricted content could ride the
*existing signing construction* unchanged and answered yes; it never asked whether the audience
should be a shared secret rather than a set of public keys. `rejections.md` §5 forecloses a
*published membership roster*, which this is not — a circle key is never published.

**Falsifier — and it is a scenario, not a benchmark.** Scenario 3 (two hubs, one thread) with a
*late-joining* relative. Per-recipient encryption lets A add a cousin to the next post by fetching
the cousin's published key: zero coordination. A circle key requires A to have paired with the
cousin out of band first. Stage the family graph from scenario 3 and count the pairing ceremonies
before the first cross-hub reply is readable. If it exceeds what a family will actually do, the
finding dies on UX and the palette problem must be solved another way.

### 2.2 The audience *size* leaks, and nothing pads it

**gpt, glm, deepseek — all three flagged it; deepseek proposed the fix** (a *fixed* number of key
slots, so the count carries no information).

`src/enc.js` emits exactly one slot per recipient. The spec discusses slot count twice —
`open-feed-spec.md:940` treats it as a DoS-and-bytes question and concludes "neither needs an
arbitrary cap" — and **never as a metadata leak**. So a hostile custodian counting slots reads the
size of every audience on the hub, and watches it change: a post that drops from 6 slots to 5 the
week of a separation is a signal, and `GOALS.md` says the hub learns "nothing about whom."

**Routing: NEW.** `GOALS.md`'s privacy tier claims the hub learns "that an encrypted item exists,
when, roughly how big, and nothing about whom." Slot count is not *whom*, but it is not *nothing*
either, and the current text does not admit it.

**Falsifier:** cheap. Padding to a bucket (4/8/16/32 slots) costs bytes per item; measure the wire
cost against a family-scale audience distribution and decide whether it is a MUST, a SHOULD, or an
admitted leak stated plainly. The cheapest honest outcome may be the last one.

### 2.3 Three different recoveries, none of them ours

`GOALS.md` chose **peer attestation**: "key B succeeds key A," signed by enough peers a reader
already trusts. That creates a *new* key. All three models instead escrowed the *old* one:

| | mechanism | restores | price it names |
|---|---|---|---|
| gpt-5.6-luna | Shamir 3-of-5 shares, each encrypted to a contact, none on the hub | the same key | a quorum can resurrect you |
| glm-5.3 | the whole keyring wrapped under the pairing secret, pushed app-to-app to a guardian; 1-of-N | the same key, **and every circle key** | *"whoever can restore you can impersonate you"* — the daughter could have seized Gran's identity at any time. glm flags this as genuinely uncertain and chose availability because "families mostly do not coup their grandmothers" |
| deepseek-v4-pro | root seed encrypted to the recovery agent's key; root deleted from the phone after onboarding | the root key | the agent can take over |

**The distinction our record does not draw.** `tmp/prototypes/threshold.md` and `rejections.md` §9
rejected **k-of-n recovery co-signature** on coordination risk *at the exit*. That is an argument
about a contested departure — a race the victim must win alone and fast. None of it is an argument
about **key escrow for the loss case**, which is a different event with different timing and a
different adversary posture. `HANDOFF-review.md` §4 already suspected this: *"key LOSS may price
differently."* Three models, cold, priced it differently.

**And the thing escrow buys that attestation cannot.** Attestation gives you a new key. Your old
encrypted archive was encrypted to the *old* key, so it stays unreadable — forever. Escrow restores
the old key and the archive with it.

**Routing: NEW** (escrow-vs-attestation was never the question asked). The k-of-n *co-signature*
rejection stands untouched.

**One caveat the models could not know, and it does not close the row.** `open-feed-spec.md:234`
already prices **1-of-n recovery keys** and lands on glm's own worry from the other side: *"Every
holder can move the identity alone, so a second holder is a second unilateral takeover… Where one key
is not protection enough, the answer is usually custody of that one key rather than more keys."* That
is an argument about *recovery-key holders*, and it transfers to guardians almost verbatim. What it
does not reach is escrow of the **encryption** key, which is what 2.4 turns on and what §4.5
explicitly does not do.

### 2.4 Grandma's archive — the spec knows; `GOALS.md` dropped it ⚠ regression

Reached independently by **kimi-k3's trace** and **glm-5.3**, and this one routes differently from
the rest: **the current specification already states it, in the strongest language it uses anywhere.**

`open-feed-spec.md:873`:

> §4.5's recovery key restores *identity continuity*; it cannot restore *readability*. A user who
> loses their encryption private key loses every encrypted item ever sent to them, irreversibly, with
> a perfect backup of every byte on disk. **This is the only failure mode in Open Feed that destroys
> content**, and it is user-triggered. Any implementation offering encryption MUST provide key backup
> and MUST state this consequence plainly at the moment the user opts in.

`GOALS.md` scenario 2 ends *"Loses her phone a year later and is back by calling her daughter,"* and
its recovery decision — peer attestation of a **new** key — makes the spec's warning bite harder, not
softer: attestation cannot restore an old private key, so Gran comes back to an identity whose entire
family-only past is unreadable. `GOALS.md` mentions none of this. It also retires "the export bundle
(you always had the copy)" on the grounds that the copy is on the device — and in scenario 2 the
device is in the lake.

kimi's trace works out the only repair available without escrow: *the daughter's app, which holds the
content keys for the posts she received, re-wraps them to Gran's new key and hands them over.* Partial
by construction — it recovers what the daughter received, not what Gran wrote to others.

**Routing: REGRESSION in `GOALS.md`, not a new discovery.** The finding is that a decision taken in
the goals conversation silently deleted a MUST the spec spends a paragraph defending. That is exactly
the failure mode this campaign exists to catch, and it took an outside reader to see it.

**Owed: an owner ruling**, not a gate. Three options, and the sketch cannot be written without one:
escrow the encryption key (2.3), specify the re-wrap dance, or carry the spec's warning into
`GOALS.md` and say plainly that recovery returns your name and not your history.

### 2.5 Rotation pinning — the reason `seq` exists, stated better than we state it

**glm-5.3.** *"Once a reader has seen a rotate at old-key seq n, it rejects any old-key item with
seq > n."* And the justification:

> This is why the log needs sequence numbers at all: a key thief holding the old key can sign items
> with arbitrary *timestamps*, so timestamps cannot bound the theft — monotonic position can.

**Routing: NEW as a justification, not as a mechanism.** `gates/subchain-gate.md` stages the
post-theft fork and prices it honestly as "exactly today's §5.5 class," detected by comparison. It
does not state the positional rule as the thing that *bounds* the theft window for a reader who
saw the rotation. That is a sharper, cheaper property than "detected by comparison," and it is one
sentence.

### 2.6 Root/active key split, root kept off the device

**deepseek-v4-pro.** The root Ed25519 key signs a key document delegating to an active signing key
and an active encryption key, and is then **deleted from the phone**, surviving only encrypted with
recovery agents. Day-to-day signing uses the active key.

This directly contests `GOALS.md`'s *"the device is the only signer."* Under that rule, a stolen or
seized phone is a stolen identity — and in the divorce scenario a phone is exactly what a hostile
partner can get at. The split makes phone theft recoverable: the root revokes the active key.

**Routing: NEW.** `GOALS.md` retires delegated keys as a *hub* affordance (the hub must never sign).
deepseek's split is delegation *within the user's own control* — a different thing, and the reason
`GOALS.md` gives for the retirement does not reach it.

### 2.7 Witness items as notarization of a contested departure

**glm-5.3.** When she leaves, relatives' apps embed her signed move record into *their own* logs, on
hubs the ex does not control, signed by people he cannot impersonate. This timestamps the departure
and makes his frozen copy provably a truncation to anyone who compares.

**Routing: mostly ALREADY PRICED, with one new edge.** This is `PLAN.md`'s R3 family-witness profile
and `rejections.md` §4 already permits it (a deployment profile consuming existing artifacts, no new
field or endpoint). What is new is the *target*: our R3 witnesses freshness and chain tips
generically. glm points it at one artifact — the move record — where the value is highest and the
reading-graph disclosure of §16.1's foreclosure is lowest, because witnessing a departure discloses
a relationship the family is announcing anyway.

### 2.8 Circle keys decoupled from the identity key

**glm-5.3**, in one clause: *"Circle keys and channel secrets are independent of the identity key, so
rotation breaks no audiences — a quiet but important decoupling."*

Worth checking against `src/enc.js`, where §15.1 ties encryption keys to the identity document's
published key set. If rotation forces re-encryption or re-grant, that is a cost of the current
design nobody has measured.

**Routing: NEW** (as a question). **Falsifier:** trace what a key rotation costs a reader's ability
to decrypt already-published encrypted items under the current §15. If the answer is "nothing," the
decoupling already holds and this row closes.

---

## 3. ALREADY PRICED — suggestions this repo has answered

None of these is a criticism of the models: they were given the goals and nothing else, so
re-deriving a priced decision is the exercise working. They are listed so nothing here gets adopted
twice or re-argued from scratch.

| suggestion | who | where it is answered |
|---|---|---|
| Recipient slots must carry no `kid`; readers trial-decrypt against a per-item blinded value | gpt, glm, deepseek | `tmp/prototypes/enctags.md` — adopted as §15.2; the card also establishes the *cost driver* was the per-recipient ephemeral, which none of them noticed |
| Sign an encoded payload so no canonicalizer exists | gpt, glm, deepseek | `tmp/redesign/gates/bytes-gate.md` — 2,635 byte mutations, 0 verified, with strict base64url spelling as the one carried-over rule |
| Reject ActivityPub (server-mediated identity), Nostr (no rotation, no completeness), atproto/`did:plc` (a shared ledger) | glm, explicitly and section by section | `CANDIDATES.md` "The eliminations" — same three verdicts, same reasons, reached here in July and by glm cold. Strong independent confirmation |
| Relatives' logs carry your move record as third-party notarization | glm | `rejections.md` §4 permits it; `PLAN.md` R3 is the profile. See 2.7 for the one new edge |
| 1-of-n recovery holders trade availability for unilateral-takeover risk | glm (as the guardian worry) | `open-feed-spec.md:234` reaches the same conclusion from the other side |
| A stolen current key produces a fork that only comparison resolves | glm, gpt | `tmp/redesign/gates/subchain-gate.md` — priced as "exactly today's §5.5 class, no weaker and no stronger" |
| Deletion against a hostile host is best-effort | glm, gpt | known; `GOALS.md` "the publisher forgets; readers remember" already concedes it |
| Plain feed readers verify nothing, so projections are cosmetic | glm, gpt | `GOALS.md` "generated views — the interop surface, never the signed object" |

## 4. Contested — claims to treat carefully rather than adopt

**glm-5.3's cipher has no MAC, and the reasoning for that is the weakest link in an otherwise
strong design.** Its construction is a SHA-256 counter-mode keystream with *no authentication tag*,
justified as: *"There is no MAC: every ciphertext lives inside a signed payload, so malleability by
the hub dies against the signature."*

Encrypt-then-sign is defensible when the signature covers the ciphertext and is **verified first**.
But glm's key-check value is `chk = SHA-256("hearth-chk" || K || n)[0:8]` — it depends on the circle
key and the nonce and **not on the ciphertext at all**. So the check identifies which key to use and
supplies no integrity whatsoever; all integrity rests on an ordering rule that lives in prose. An
implementer who trial-decrypts before verifying — the natural order, since you must decrypt to know
whether the item concerns you — has built a malleability oracle, and nothing in the format will tell
them. This is the same class §15.2.1's carrier binding exists to close, and it lands hardest against
priority 2: the weekend implementer is exactly who gets this order wrong.

To glm's credit it names the cipher as its own least comfortable load-bearing choice. The *idea*
behind it — keep the palette closed (1.2) — survives the objection; **encrypt-then-MAC with
HMAC-SHA256, which kimi's trace proposed instead, gets the same palette with none of this problem.**
If a hash-only construction is pursued, that is the shape to pursue.

**deepseek's root-key escrow points the wrong way under this threat model.** Deleting the root key
from the phone and leaving it encrypted to a recovery agent means the recovery agent can seize the
identity at any time. In `GOALS.md`'s driving scenario the plausible recovery agent *is* the
spouse. The root/active split (2.6) is worth taking seriously on its own merits — phone seizure is
real — but "root lives only with an agent" must not be the default, and no model priced who that
agent is when the family contains the adversary.
