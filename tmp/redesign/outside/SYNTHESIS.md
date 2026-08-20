# Outside perspectives — v3: decision briefs

**2026-08-20, third draft.** Six frontier models from six labs, no repo access, two passes: design
the protocol from the brief (`PROMPT-pass1.md`), then attack a summary of our direction
(`PROMPT-pass2.md`). Twelve answers in `responses/`. This draft replaces `SYNTHESIS-v2-superseded.md`,
whose errors are itemized in Appendix A — read that appendix before trusting anything v2 said.

**What this document is for.** The owner is not ready to rule on the open design questions without
more context than v2 gave. So Part I is organized by **decision**, not by model: for each open
question it states what `GOALS.md` says today, the attack the models found, what this repo has
already measured about it, and every option on the table with its price. Mechanisms are explained
in plain language first and cited second, so the briefs can be read without the spec open. Part I
is neutral. Part II is the corrected per-model record. Part III is one agent's leanings, clearly
labeled and skippable. Nothing here is a ruling.

**Rules this draft follows, because v2 broke each of them.** Quotations are written “like this”
followed by their source (`file:line`), and `check-citations.js` now verifies the quoted words occur
within three lines of the cited line — not merely that the line exists. Quotes come only from the
six shipped pass-1 and six shipped pass-2 answers; the quarantined `v1-defective-brief/` and
`pass2-streaming-truncated/` directories are never quoted except in a sentence that says so. Every
count names its denominator (six). Every cut inside a quote is marked `…`. Every claim about
`GOALS.md`, the spec, or `src/` was read at the cited line before being written.

**One fact that colors every relocation brief.** `PROMPT-pass2.md:17-20` summarized `GOALS.md`'s
relocation bullet and dropped one clause: “the departing client offers "send this link to your
people."” (`GOALS.md:73`). Five models then attacked relocation. Where an attack is answered by the
omitted clause, the brief says so; where it survives the clause, the brief says that too.

---

## Part I — Decision briefs

### A. Staleness and relocation: can a frozen copy ever read as stale?

**The question.** When Alice leaves the ex's hub, his copy of her profile and posts stays
byte-valid forever. Scenario 1 promises that copy “reads as stale, not as her” (`GOALS.md:101`).
What, if anything, tells a reader the difference between *she left* and *she went quiet*?

**What GOALS.md says today.** “Readers remember every location a profile ever named and check the
others when the primary goes stale; a new location statement with a higher sequence wins; the
departing client offers "send this link to your people." Strangers who only knew the old location
may be lost; a resolver is an extension slot, not a mechanism.” (`GOALS.md:71`). And the completeness
bullet retires “the lag/withheld/violation/stale lattice, freshness deadlines” (`GOALS.md:80`). So
"stale" is the trigger for checking other locations, and nothing defines it.

**The attack, in the models' words.** hy3 names the mechanism: the ex “simply **continues serving
the old profile at sequence N** from `family.example`, forever, correctly signed, never updating”
(`responses/pass2-hy3.md:19`); a cousin who never saw N+1 has no lower sequence to compare and “the
cousin's app has no trigger to check `newhub.net`” (`responses/pass2-hy3.md:25`); “They treated
relocation as a *signed statement* problem, not a *liveness* problem. Signature validity does not
imply currency.” (`responses/pass2-hy3.md:28`). glm: “*Stale* is the trigger for failover, and with
no freshness semantics, a hostile hub serving a frozen-but-valid head is byte-for-byte
indistinguishable from an author who stopped posting. The trigger condition is undefinable, so the
failover never fires.” (`responses/pass2-glm-5.3.md:43`). kimi sharpens the promise: “The frozen copy
does not merely read as stale. It reads as **her, currently, not posting**. That is strictly worse
than the brief's requirement … the design cannot even reach *stale*.” (`responses/pass2-kimi-k3.md:34`),
and states the reachability problem as three facts — the new location is named only in the new
profile; the new profile is fetchable only at a location the reader already knows; the reader knows
only locations named in profiles it has already fetched — concluding “There is no edge in this graph
from the reader's knowledge to the new location.” (`responses/pass2-kimi-k3.md:27`). minimax runs
the withholding version: “It just needs to *withhold*. Withholding is enough.”
(`responses/pass2-minimax-m3.md:26`) and “The other team's text says push is an extension. **It
cannot be an extension.**” (`responses/pass2-minimax-m3.md:32`). gpt states the limit for scenario 4:
“Remembering every location ever named does not solve this: the new location was never learned.”
(`responses/pass2-gpt-5.6-luna.md:45`).

**What the omitted clause answers, and what it does not.** The models were not told about the
out-of-band link. For the family, the link is the relocation mechanism: Mom taps it, learns the new
location and the higher sequence, and is done. minimax's step 6 — Mom “has to manually type
`newhub.example/actor/alice` into her reader” (`responses/pass2-minimax-m3.md:28`) — is the
omitted clause described as a failure. kimi saw this from the other side: “Her actual escape is a
telephone … That works — families have phones — but it is **out-of-band**” (`responses/pass2-kimi-k3.md:35`).
What the link does **not** answer: (1) any reader Alice does not reach — hy3's cousin, glm's “every
relative who never learns of the move” (`responses/pass2-glm-5.3.md:43`) — sees a valid frozen copy
with no signal; (2) scenario 1's *promise* is about exactly those readers, since readers who got the
link do not need the copy to read as stale; (3) scenario 4 at ten thousand people is ten thousand
rounds of the same telephone call, though that hub is not hostile and can serve the new statement
until the domain lapses. kimi's own pass-1 cost sheet conceded the residue before seeing our
direction: “The stale-not-her property is social, not absolute … A reader who only ever polls his hub
and has no contacts in common sees a frozen journal with no signal.” (`responses/pass1-kimi-k3.md:260`).

**What this repo already measured.** The current spec names this attack and answers it with a
declared deadline. §9.1.2, in plain words: a publisher may write into its signed manifest a time by
which it promises to have published again (`_next_update`); a reader treats the chain as *stale*
once that time or its own ceiling (recommended 7 days) passes, whichever is sooner; stale means
"hold what you verified, advance nothing, accuse nobody" (`open-feed-spec.md:588`). It costs 26 bytes
per manifest version (`freshness.md:19`). Its limit is stated beside it: it “closes the freeze against
an attacker who **cannot sign**” (`open-feed-spec.md:592`) — a key custodian can keep advancing an
empty manifest on schedule (freshness.md's Q6, `freshness.md:31`). In the divorce the ex does not
hold Alice's key, so he *is* the attacker who cannot sign, and the deadline binds him. The second
repo answer is comparison between readers: §13.2 concedes per-reader equivocation is “detectable
rather than detected” because one reader alone has nothing to compare against, and supplies the
second observation by item-carried pins (§16.1) or, in the candidates, pins sealed inside encrypted
replies (`sealed-pins-gate.md:25`). `GOALS.md:81` retires both. The third is PLAN.md's R3, mutual
family witnesses — each hub periodically publishes what it saw of the chains it reads
(`PLAN.md:208`) — never gated, and not mentioned in v2 though gpt re-derived it (below).

**Options on the table.**

1. *Keep GOALS.md as written; drop the "reads as stale" promise.* Reword scenario 1 honestly:
   readers reached by the link follow her; others see an old valid copy. Price: nothing. Loses: the
   scenario-1 sentence, and hy3's cousin. Who: no model chose this for family; qwen endorsed the
   location list as “strictly more resilient” than its own design (`responses/pass2-qwen3.8-max.md:47`)
   without addressing the freeze.
2. *A declared next-update deadline on the head* (the §9.1.2 shape, transplanted). Adds one signed
   field and one reader rule. Price: 26 bytes and ~two sentences; the reader ceiling number returns.
   Buys: the ex's frozen copy reads as stale after the deadline for every reader, link or not.
   Does not buy: anything against a hub holding the key (not the divorce case). Who: gpt wants views
   labeled valid, “stale relative to a known sequence” (`responses/pass2-gpt-5.6-luna.md:443`), or
   incomplete; no model proposed the exact field, and kimi endorses
   “Refusing the freshness lattice” as “correct as far as it goes” (`responses/pass2-kimi-k3.md:47`)
   — a single deadline is not the lattice, but the owner should decide whether it is the thin end of it.
3. *Pre-signed heartbeats* (glm, built from our scheduled-post decision): “the author's app
   **pre-signs sparse heartbeat events** — their scheduled-post insight, repurposed: one tiny "still
   here" event per week for the next six months, released on schedule by the hub. A hostile hub can
   withhold them, but any reader who checks a second location — mandatory behavior — sees the
   heartbeat there” (`responses/pass2-glm-5.3.md:106`). glm flags it: “it detects frozen hubs for
   readers who remember a second location and for no one else” (`responses/pass2-glm-5.3.md:106`).
   Price: items that exist only to exist; interacts with brief H. Note it needs a second location
   the reader already knows, which is the thing a frozen primary denies.
4. *"Contested, not stale"* (hy3): the profile carries a signed `move_to`; “if primary omits it but a
   mirror has it, primary is flagged "contested" not "stale."” (`responses/pass2-hy3.md:52`). Same
   precondition as 3: a second location.
5. *Gossip through interaction targets.* Not proposed by any model and not in any repo document,
   but implied by a decision already in `GOALS.md:82`: an interaction is an item in its *author's*
   feed naming its target. If the target reference carries the target's key **and current
   location**, then Mom's first reply after the move publishes Alice's new location to everyone who
   reads Mom — the cousin included. kimi names the class: “gossip of profiles between readers” is one
   of three repairs “any *one* of” which breaks the attack (`responses/pass2-kimi-k3.md:37`). Price:
   a field in a reference that must exist anyway; a reader rule ("a higher-sequence location seen in
   any verified item counts"). Does not reach: readers with no social path to Alice (strangers —
   already conceded).
6. *Mirrors / witnesses.* gpt: “independent witness/mirror replication. A few trusted relatives could
   automatically retain signed heads and relocation statements … It is simply redundant custody of
   signed data.” (`responses/pass2-gpt-5.6-luna.md:439`); glm's optional “notary mirrors”
   (`responses/pass2-glm-5.3.md:144`); PLAN.md's R3. Price: a deployment profile, not spec text, if
   §13.10's claim holds; a published who-reads-whom record otherwise (the aggregator foreclosure,
   `rejections.md:59`).
7. *A minimal push channel for relocation* — brief F.

**What a gate would stage.** A frozen primary and one reader who never received the link, under each
option, asserting whether and when that reader's verdict changes; then the same with a key
custodian advancing empty heads, to keep option 2's limit honest.

### B. Recovery: who gets to say "key B succeeds key A"?

**The question.** Grandma loses her phone and is “back by calling her daughter” (`GOALS.md:103`).
Who may sign the statement that a new key succeeds the lost one, and who decides whether to
believe it?

**What GOALS.md says today.** “"key B succeeds key A," valid when signed by A (rotation) or by enough
peers a reader already trusts (social recovery — at family scale, identity continuity *is* social, and
the ex cannot fool the sister's own mother).” (`GOALS.md:65`), retiring “recovery keys held outside
the home, `_recovery_sig`, fork resolution, the genesis-fingerprint ceremony” (`GOALS.md:69`).
Open question 3 asks how many peers, and whether a trust set is ever published (“today's answer:
never”, `GOALS.md:121`).

**The attack.** Two models aimed at the parenthetical, from different sides. qwen: “But the protocol
does not ask the mother. The protocol checks a cryptographic threshold. The mother's judgment is not
in the specification.” (`responses/pass2-qwen3.8-max.md:19`). Its sequence: a 3-of-5 trust set
configured during the marriage — Bob, Alice's mother, Alice's sister, a shared family key generated on
Bob's hub, Bob's brother — of which Bob holds three after the separation; he signs “"Key C succeeds
Alice's key A."” and posts as her; Mom's app “does this *automatically*, because the threshold is met
and the protocol defines this as sufficient” (`responses/pass2-qwen3.8-max.md:23`,
`responses/pass2-qwen3.8-max.md:27`, `responses/pass2-qwen3.8-max.md:31`). glm attacks the predicate
itself: “by construction, the hostile operator is a peer the mother already trusts … He is *exactly*
what "a peer a reader already trusts" denotes.” (`responses/pass2-glm-5.3.md:21`), then the
corollary no repo document has: “**identity becomes viewer-relative.** The sister who never followed
Bob's feed doesn't trust him, rejects the attestation, and keeps the old key. Now the family holds two
incompatible verdicts about who Alice is, each locally valid … Theirs produces a *silent, inconsistent*
one — resolved-looking, resolved differently per reader.” (`responses/pass2-glm-5.3.md:35`). Every fork
mechanism the current spec has (§5.3.1, §5.5, `subchain-gate.md`) assumes a fork is a disagreement
about *bytes*; a reader-relative trust predicate produces divergence with identical bytes.

**What this repo already measured.** The current spec's recovery is one designated key: committed in
the chain, held offline where the operator cannot reach it (`open-feed-spec.md:226`), producing one
co-signature. `threshold.md` asked whether k-of-n must be banned and found the stated reason false but
kept the ban on a different ground: “k-of-n trades a theft risk for a coordination risk at the moment
§14 requires an exit needing nobody's cooperation, and a custodian holding two shares can both migrate
alone and block.” (`threshold.md:23`). v2 routed qwen's attack as already priced by that card. **Half of
it is.** The *takeover* half (a custodian holding enough shares moves the identity alone) is qwen's
attack. The *coordination* half is about recovery-as-*exit*; under `GOALS.md:59` exit needs nobody
(the key is on the device) and recovery serves only *loss*, so that objection no longer applies —
`HANDOFF-review.md:80` already noted “key LOSS may price differently.” The spec also carries the
genesis-comparison requirement `GOALS.md:69` retires: multi-tenant hosts “MUST present the member, at
onboarding, with the `(seq, hash)` of their **genesis** identity document and a fingerprint of their
**recovery key**” (`open-feed-spec.md:242`) — a display obligation on hosts, not a ceremony, and
retired without an argument in `GOALS.md`.

**Options.**

1. *Keep "peers a reader already trusts."* Who: nobody, including in pass 1. minimax's reconciled
   design is the nearest — a per-reader policy, default “any one attester whose public key the reader
   already trusts” (`responses/pass2-minimax-m3.md:171`) — and it has glm's reader-relative property.
2. *Reader-side, but human.* qwen: “Do not specify a number in the protocol … The reader learns the
   co-signing keys only when a rotation is presented: "keys X, Y, and Z co-signed this rotation." …
   This makes the divorce attack I described much harder, because Bob's three signatures are presented
   to the mother as *Bob's three signatures*, and she can reject them.”
   (`responses/pass2-qwen3.8-max.md:108`); “The cost is that recovery is not automatic. I think this
   is the right trade.” (`responses/pass2-qwen3.8-max.md:79`). kimi's default is the same with one
   structural rule: “one voucher suffices if the voucher is a *mutual* contact of reader and subject …
   require human confirmation always; never publish trust sets” (`responses/pass2-kimi-k3.md:99`).
   Price: a UI step the spec cannot enforce; verdicts still per reader.
3. *Subject-designated recoverers.* The people who may vouch are named in advance **by the key being
   replaced**, in the profile. This is the current spec's shape with peers instead of an offline key
   card, and glm's “one sentence” fix (`responses/pass2-glm-5.3.md:37`). Three refinements glm adds,
   none in the spec: (a) commit the set as a hash — “`sha256(pubkey₁ ‖ … ‖ pubkeyₙ)` — and revealed
   only inside a recovery event. Pre-recovery, the hub and strangers learn nothing about who the
   recoverers are” (`responses/pass2-glm-5.3.md:100`), which answers open question 3's "never
   published" with a mechanism (today the spec publishes recovery keys in cleartext,
   `open-feed-spec.md:104`); (b) a veto window — “A recovery-signed succession is *provisional* for a
   fixed window (default: 14 days). During the window, the superseded key may sign a `contest` event;
   any reader who sees one displays "identity contested" prominently and trusts neither branch”
   (`responses/pass2-glm-5.3.md:101`); (c) no entrenchment — “A recovery-signed event may change `key`
   and nothing else. Not locations, not the recovery commitment, not the name.”
   (`responses/pass2-glm-5.3.md:102`). glm's threshold default is 1 (`responses/pass2-glm-5.3.md:160`);
   hy3's is “1-of-N (mother suffices)” (`responses/pass2-hy3.md:68`); gpt wants 2-of-3 or 2-of-5 and
   is the one dissent on publication: “The recovery policy should be public. Existing readers need it
   to validate a recovery they did not personally witness.” (`responses/pass2-gpt-5.6-luna.md:321`).
   Price: a commitment field, a recovery event type, optionally a contest event and a provisional
   reader state. Residue: threshold.md's takeover half — whoever Alice designates can take the key;
   the veto window is the only defense if she still holds hers, and none if she does not.
4. *Countersigned Move* (minimax, pass 1): relocation carries a `notary` list of contacts who
   co-signed it — “It is the family vouching for each other, signed.” (`responses/pass1-minimax-m3.md:365`)
   with its limit “do not make your hostile ex your recovery contact” (`responses/pass1-minimax-m3.md:367`).
   Same designation logic as 3, applied to moves rather than keys.
5. *No rotation at all* (hy3, pass 1): “key rotation means new identity. We allow *key replacement*
   only via guardians” (`responses/pass1-hy3.md:128`). Collapses two cases into one; strangers lose
   continuity, which `GOALS.md:44` already does not promise.

**Two things every option must also carry.** gpt: “A replacement signing key does not decrypt old
private posts. Recovery must separately preserve the old encryption private key, in an encrypted
recovery package, or old private history is lost.” (`responses/pass2-gpt-5.6-luna.md:103`). And kimi's
rejection of KERI-style pre-rotation on the scenario rather than on taste: “Grandma loses her phone,
and the pre-rotated key was *on the phone*. Total device loss defeats pre-rotation exactly when a
non-technical user needs recovery.” (`responses/pass1-kimi-k3.md:105`).

**What a gate would stage.** qwen's 3-of-5 and glm's son-in-law under each option: does Mom's app
accept, does the sister's app agree with Mom's, and can Alice (still holding her key) make the
takeover visible within a bounded time.

### C. First contact: how does Mom's app get Alice's key the first time?

**The question.** Identity is a key, and “Apps show a name and an address; the key is an
implementation detail users never see.” (`GOALS.md:55`). On first contact the app has no prior key
to compare. If it fetches Alice's profile from the ex's hub, what stops him serving a profile with
his own key under her name?

**The attack.** minimax: “Both designs assume the URL is honest. The threat model says the hub is the
adversary from the first interaction.” (`responses/pass2-minimax-m3.md:235`); its fix: “**Public key as
part of the address.** The address becomes `alice#a1b2c3d4@hub.example`, where `a1b2c3d4` is the
first 4 bytes of the public key, displayed in the UI. On first contact, the reader verifies that the
key in the profile matches the fingerprint in the address.” (`responses/pass2-minimax-m3.md:68`). glm
proposes the same primitive, from the contested-fork side, and ranks it first: “a **verbal
fingerprint**, the first 40 bits of the genesis hash rendered as eight digits or three words
("marble-violet-72"). Families compare it by phone … I think it's the single highest-value addition in
this whole reply.” (`responses/pass2-glm-5.3.md:142`). glm's pass-1 answer had already named the
boundary: “first contact is trust-on-first-use … Families mitigate this with the invite/QR flow (the
invite link carries the genesis hash). Strangers accept TOFU, as they do with SSH today.”
(`responses/pass1-glm-5.3.md:86`). hy3's layout makes the key the path: every artifact lives under
`/u/<pubkey>/` (`responses/pass1-hy3.md:28`). glm also names a root-of-trust gap one step earlier:
“Whoever chooses her app — the daughter, or in a worse family, the son-in-law "helping her set it up"
— is her undeclared root of trust, and the spec is silent about it.” (`responses/pass2-glm-5.3.md:47`).

**What this repo already has.** `CANDIDATES.md`'s LOG+KEY row: first contact “**authenticated**
(genesis hash = the QR at dinner); TOFU deleted” (`CANDIDATES.md:75`) — the same answer, arrived at
on 2026-08-19, which v2 did not cite. The current spec's version is §4.5's onboarding display
(brief B) plus TOFU for everyone else (§5.3).

**Options.**

1. *The address carries the key.* The link Alice sends ("send this link to your people",
   `GOALS.md:73`) embeds her full key or a fingerprint; the app checks the fetched profile against it
   and never shows the user a key. Shapes: key-in-path (hy3), fingerprint-in-handle (minimax),
   words-for-phone (glm). Price: a URL grammar rule and one comparison. `GOALS.md:55`'s "never see"
   survives — the user sees a link or a QR, not a key.
2. *Name + URL, TOFU, fingerprint available on request.* The current spec's posture for non-hosted
   identities. Price: zero. Loses: scenario 1's first contact through the ex's hub.
3. *Both, with the verbal fingerprint as the contested-fork tool* (glm): the same 40 bits serve the
   QR, the phone call, and brief B's "identity contested" display.

**What a gate would stage.** A hostile hub serving a substituted profile to a first-time reader
holding (a) a bare URL, (b) a key-bearing link.

### D. The local copy: is "you always had the copy" a rule or a hope?

**The question.** Floor item 3 rests on the copy being on the device: “You can leave at any moment
with your identity and everything you wrote, without asking, because the key and the copy were always
on your device.” (`GOALS.md:26`). The export bundle is retired on that ground — “the export bundle
(you always had the copy)” (`GOALS.md:61`). Does anything require a client to keep one?

**The attack.** gpt walks it: “3. The application deletes local copies after successful upload, as
the direction permits. 4. Her ex notices the divorce and deletes the stored objects. 5. He refuses
all export requests and refuses further uploads.” … “She still has her signing key, but not
"everything she wrote." The hub was the only copy.” (`responses/pass2-gpt-5.6-luna.md:23`,
`responses/pass2-gpt-5.6-luna.md:28`). Precision matters here, because v2 got it wrong: the pass-2
summary never says local copies may be deleted — gpt inferred "permits" from silence — and
`GOALS.md:67`'s "mandates none" is about *key-backup UX*, not content. The finding survives the
correction in weaker form: nothing in `GOALS.md` obliges a client to retain what it published, and
the sentence that deletes §14 assumes it does. gpt's remedy: “The specification must require at least
one user-controlled durable copy, even if the application hides the fact that it is a cryptographic
backup.” (`responses/pass2-gpt-5.6-luna.md:32`), and in its reconciled design a vault of keys, objects,
attachments, head history, recovery package, and known relocation statements — “"No file outside the
house" means no manual file handling, not no durable local storage.”
(`responses/pass2-gpt-5.6-luna.md:299`). kimi had made it a conformance rule in pass 1: “"an
implementation that does not retain a local copy of every entry it publishes is non-conformant."
Exit is therefore not an export procedure; it is re-upload of what you already have. The hub's copy
is a cache of your device, not the reverse.” (`responses/pass1-kimi-k3.md:145`). minimax makes the
parallel point about keys: “The "market" framing is a fig leaf unless the spec actually demands
on-device key storage and on-device signing.” (`responses/pass2-minimax-m3.md:42`).

**What this repo already has.** §14's export bundle is the current answer, and its cards concede the
bundle carries no completeness proof. The current spec already contains requirements it cannot
enforce on clients — the recovery key “MUST be stored offline, not on the hub” (`open-feed-spec.md:226`)
— so an unenforceable client MUST is not new to this design; `HANDOFF-stage3.md:197` asked whether
exit should rest on something the protocol can check instead.

**Options.**

1. *One sentence: a client MUST retain the signed bytes of everything it publishes; the hub's copy
   is a cache.* Who: kimi, gpt. Price: one MUST no verifier can check. Makes the publish interface's
   direction of authority explicit.
2. *Make it structural: the client is the store, the hub mirrors.* The publish interface is defined
   as "sync my local store to the hub," so a conforming client has the copy by construction. Price:
   constrains client architecture; interacts with brief E (multi-device) and J.
3. *Say nothing; keep §14-style export as the fallback.* Price: the words `GOALS.md:61` retires come
   back, and the hostile hub can decline to serve the export.

**What a gate would stage.** Nothing runnable distinguishes 1 from 3 — which is itself the finding:
this assurance is delivered by client conformance or not at all.

### E. Multi-device: GOALS.md says "the device"

**The question.** “**The device is the only signer; the hub is storage and serving.**” (`GOALS.md:59`)
— singular. Alice has a phone and a laptop. What signs from the second one?

**The attack.** minimax: “Real users have phones and laptops. Neither design specifies how Alice
publishes from two devices. The natural answer is "the actor profile lists multiple signing keys, each
tagged with a device id …" This is a 5-paragraph addition to the spec, and neither design has it.”
(`responses/pass2-minimax-m3.md:181`). kimi, pass 1: “Key sync between a user's phone and laptop
needs either export/import (a file the brief says Grandma must never be told to store) or a
device-linking sub-protocol … This will be the first thing real users demand.”
(`responses/pass1-kimi-k3.md:257`). glm rejected per-device keys for v1 and flagged it: “It is the
first revision I'd make, and I flag my uncertainty: this cut is defensible for families and wrong for,
say, journalists.” (`responses/pass1-glm-5.3.md:175`). Three of six named it; v2 reported it as a
shared blind spot and then misread the repo's answer.

**What this repo already measured — stated correctly this time.** `writer-gate.md` stages two
devices racing to append to one log with compare-and-swap: the loser “rebases and re-signs — it holds
its own key” (`writer-gate.md:11`). That is a multi-device answer needing no delegated key. The
delegated-key split the card also describes — authorship in the blob, ordering in the entry
(`writer-gate.md:25`) — is for the *offline member plus delegated hub* corner, and it is that corner,
not multi-device in general, that makes §4.6-style custody load-bearing. Under GOALS.md the head is a
single signed file rather than a log, so the race is simpler still: two devices with the same key CAS
on one head. `GOALS.md:68` already lists keychain sync among app-level backup UX, which is one
multi-device answer stated as something else.

**Options.**

1. *One key, synced by the app.* Keychain sync or QR-to-QR transfer; the spec says nothing beyond
   "the head has a sequence; the publish interface rejects a stale sequence" (brief J). Price: nothing
   in the spec; theft of any device is theft of the key. Who: glm's v1 posture; kimi's "export/import"
   branch.
2. *Per-device keys authorized by the identity key.* The profile lists device keys; items are signed
   by a device key; revoking a lost phone revokes only it. Price: glm's “one more artifact layer and one
   more verification rule” (`responses/pass1-glm-5.3.md:175`); the identity key must live somewhere
   that is not any device, which reopens custody. Who: minimax, glm as "first revision."
3. *Leave it to an extension and say so in GOALS.md.* Price: the sentence. Risk: kimi's prediction.

**What a gate would stage.** Two devices publishing concurrently under options 1 and 2; a lost phone
under option 2 with the rest of the family's readers.

### F. Push and private messages: is pull-only worth what it makes public — and what it loses?

**The question.** “**Everything is pull.** An interaction is an item in its *author's* feed naming its
target. Push (a ping endpoint), inbound interop, and DMs that must not exist on a feed are extensions,
each a few restrictions: rate-limit by IP before fetching, fetch only from the author's known
location, never republish what was delivered.” (`GOALS.md:82`). Open question 5 asks whether the
push/delivered channel should exist at all.

**Where six models landed.** Against a core push channel, four: gpt — “Pull handles posts, replies,
and reactions and preserves the hub-independence property. A later push extension can be defined as
an optimization, never as the only delivery path.” (`responses/pass2-gpt-5.6-luna.md:424`); qwen —
“fixed-cadence polling means a fetch proves nothing about who sent what. A push channel breaks this.
Direct messages are encrypted items stored at a path not listed in the head, fetched by the
recipient's app during its regular poll.” (`responses/pass2-qwen3.8-max.md:112`); hy3 — “Refuse it.
Pull-only protects metadata (Assurance 2). Push adds inbox risk.” (`responses/pass2-hy3.md:70`); glm —
“Kill the push ping” and replace the DM extension with a **dead-drop box**: “the head names a box URL —
which *need not be the content hub*, letting a user decorrelate the two. The sender blind-PUTs one
instance of the standard construction (single recipient envelope) to `{box}/{client-chosen random
token}`. The recipient polls their own box” (`responses/pass2-glm-5.3.md:138`). For, two: minimax —
“Push must exist, as a first-class mechanism, not an extension. The reason: relocation against a
hostile hub requires it.” (`responses/pass2-minimax-m3.md:220`); kimi, who changed its mind after
writing the relocation attack — “push carries envelopes (relocation, succession, private items) and
nothing else; it is rate-limited by the spam rule (receivers fetch only from known locations); and
public replies/comments stay pull-plus-ping.” (`responses/pass2-kimi-k3.md:103`). kimi also names the
second loss: “pull-only removes the split-view detector … a hub serving head_40 to mother and head_47
to sister is detectable only if mother and sister compare notes *outside the protocol*.”
(`responses/pass2-kimi-k3.md:39`).

**What this repo already measured.** `channel-gate.md` compared published-only (a) against a
minimal delivered channel (b) and found that under (a) “**Suppression is not a corner case under (a):
it is the adversary's cheapest move**, and detection (staleness, day 7+) is not delivery — the covert
outbound path ("tell grandma I'm leaving") only exists under (b), because a device-to-recipient POST
never transits the hostile hub.” (`channel-gate.md:24`), and that (b) needs about a thousand words —
relevance, “IP-then-author rate ladder, response hygiene” (`channel-gate.md:31`) — rather than §10's
two thousand, because content-addressed dedup removes the version-poisoning class. `GOALS.md:84`
already carries the IP half of that ladder. The sealed-pins gate shows split-view detection can ride
inside encrypted replies with no public reading-graph bytes (`sealed-pins-gate.md:25`) — which is
kimi's "gossip heads inside envelopes" with the envelopes pulled rather than pushed. Spam: minimax
lists four mitigations and says “Neither design addresses this.” (`responses/pass2-minimax-m3.md:189`);
kimi's pass-1 hub-local bearer token — “a per-recipient bearer token in the URL (`POST /inbox/{token}`), issued by the user to their contacts”
(`responses/pass1-kimi-k3.md:161`) — is a fifth.

**Options.**

1. *Pull only, DMs as unlisted items on the author's own hub* (qwen). Price: DM existence, timing and
   size are public on the sender's feed path; the hostile hub owns the sender's outbound path
   (channel-gate's finding 1). Buys: no inbox, no spam surface, `GOALS.md` as written.
2. *Pull only, DMs via a dead-drop box the recipient names* (glm). The sender writes one blind
   ciphertext to a URL the recipient chose, which may be a different host; the recipient polls it.
   Price: a box URL in the head; per-IP rate limit, size cap, TTL; the hostile hub sees a write of
   some size from some IP. Buys: the outbound path no longer transits the sender's hub — this is
   channel-gate's (b) with the POST replaced by a PUT and no inbox semantics.
3. *A minimal push channel for three things* (kimi): relocation, succession, private items. Price:
   the ~1,000-word residue channel-gate priced, plus kimi's honest paragraph on envelope metadata at
   the recipient's hub. Buys: brief A's relocation fix and the split-view channel.
4. *Mandatory inbox* (minimax). Price: HTTP-signed POSTs, ordering, dedup, retention, spam — §10
   regrown. Buys: the same as 3 with more machinery.

**What a gate would stage.** Alice's "I'm leaving" to Mom under each option with the ex controlling
Alice's hub: does it arrive, when, and what does the ex learn.

### G. Encryption refinements: small changes the construction needs regardless

**What GOALS.md says.** “Three tiers, one mechanism: public; encrypted to a chosen set of keys with the
names sealed inside; a DM is that with one recipient.” … “The envelope is re-chosen for simplicity
(audited primitives, box-per-recipient), not kept for JWE's sake.” (`GOALS.md:87`,
`GOALS.md:90`). The NIP-44-class evaluation is commissioned (`GOALS.md:120`).

**What `src/enc.js` does today (verified).** One X25519 ephemeral per item (`src/enc.js:175`), one
slot per recipient with no padding (`src/enc.js:185`), a slot tag that is a hash of the X25519 shared
secret — not of the recipient's public key — so a hub holding every public key learns nothing
(`src/enc.js:140`), and a separate published X25519 key chosen by `use === 'enc'` (`src/enc.js:77`).
minimax's pass-2 claim that sealing is “hand-waving that probably does not survive contact with the
threat model” (`responses/pass2-minimax-m3.md:38`) assumed a hashed-public-key tag; the shipped tag is
not that. The cause is ours — `PROMPT-pass2.md:51` said "sealed inside" and never said how.

**Five refinements the models converge on, each separable.**

1. *Pad the slot count.* Raised by five of six (gpt, qwen, kimi, hy3, glm; minimax publishes the
   audience). kimi built it: “apps SHOULD pad slot count to the next power of two with garbage slots
   (random bytes). Spec'd as SHOULD, not MUST” (`responses/pass1-kimi-k3.md:240`); qwen: “Pad the slots
   to 8 entries with random bytes to hide recipient count. The cost is roughly 300 bytes of dummy
   ciphertext per item” (`responses/pass2-qwen3.8-max.md:106`); glm would not chase it: “the envelope
   count leaks, both designs leak it, and chasing it costs real complexity for metadata the family
   adversary mostly has anyway” (`responses/pass2-glm-5.3.md:150`). The repo never treats slot count as
   disclosure — `open-feed-spec.md:940` discusses it only as a cost — and `GOALS.md:88`'s "roughly how
   big, and nothing about whom" leaves it ambiguous.
2. *Put the recipient list inside the plaintext.* kimi found a bug in both designs: “when B replies to
   A's family-only post, B knows the author … and **cannot enumerate the rest of the audience** … B's
   reply goes to {A, B}, and the rest of the family never sees it. Scenario 3 … fails at the reply. The
   fix is small … **the audience list goes inside the ciphertext.**” (`responses/pass2-kimi-k3.md:57`).
   glm's pass-1 construction already encrypts “body, audience list, photo references, any mentions”
   (`responses/pass1-glm-5.3.md:207`). The current spec's §15.2.2 declared audience is the same idea;
   the sketch must keep it.
3. *Keep a separate X25519 key; do not derive it from Ed25519.* kimi: deriving “requires every
   implementer to write Edwards→Montgomery field arithmetic correctly, which is exactly the kind of
   subtle, unglamorous code that breeds interoperability bugs” (`responses/pass1-kimi-k3.md:214`);
   minimax first agreed — “the conversion requires a KDF and is fiddly” (`responses/pass1-minimax-m3.md:78`)
   — then listed derivation as its fourth cut (`responses/pass1-minimax-m3.md:554`). No mainstream
   standard library exposes the conversion, so under priority 1 it is hand-written field arithmetic;
   that is the price.
4. *Adopt a standard construction shape, not a library.* glm: “*Don't* adopt an off-the-shelf
   **library** — it violates priority 1 and the interop story. *Do* adopt the off-the-shelf
   **construction shape**: X25519 → HKDF-SHA256 → AEAD is ECIES” (`responses/pass2-glm-5.3.md:158`);
   minimax names HPKE (RFC 9180) with `DHKEM-X25519-HKDF-SHA256` + ChaCha20-Poly1305
   (`responses/pass2-minimax-m3.md:209`); gpt: “I would refuse to approve an in-house construction.”
   and wants test vectors and exact domain separation (`responses/pass2-gpt-5.6-luna.md:380`); qwen
   argues the opposite — its X25519 → HMAC → AES-GCM is already it: “The "audited off-the-shelf construction" the other
   team is considering *is* this construction … Do not go looking for a different construction.” (`responses/pass2-qwen3.8-max.md:106`). glm's one refusal: it would
   not finalize without knowing the target languages, because Python's standard library has none of
   this (`responses/pass2-glm-5.3.md:158`). The repo's `enctags.md` settled the *layout* (shared
   ephemeral + blinded tags, `enctags.md:31`); the primitives inside it are what the commissioned
   evaluation is for.
5. *Recovery preserves the old encryption key* — brief B.

**What a gate would stage.** The unchanged `enc.test.js` intents over a padded, audience-in-plaintext
envelope; size deltas per recipient count; the reply-to-all scenario across two hubs.

### H. Scheduled posts released by the hub

**What GOALS.md says.** “Scheduled posts are pre-signed by the device and released by the hub.”
(`GOALS.md:59`).

**The attack.** qwen alone: “if the hub is hostile, it can release the scheduled posts early, or
withhold them, or release them after the author has left. The posts are validly signed. The author can
issue tombstones, but the damage is done. The mitigation is: do not store pre-signed content on the
hub. Schedule it on the device.” (`responses/pass2-qwen3.8-max.md:91`). glm, by contrast, builds
brief A's heartbeats *out of* hub release (`responses/pass2-glm-5.3.md:106`).

**Options.** (1) Drop hub release; the device publishes at the scheduled time or late (qwen). Price:
scheduled posts need the device online. (2) Keep it, bounded: a pre-signed item carries its own
`published` time so early release is visible; late release is ordinary withholding; release after
exit is bounded by the head's sequence and location. Price: one sentence. (3) Keep it and also use it
for heartbeats (glm), accepting that a hostile hub withholds both.

### I. The head: what exactly is the small signed thing a reader pins?

**The question.** “The completeness story is one paragraph. A signed, sequenced head lists what
exists; a reader may pin it and notice when something it saw vanishes without a tombstone.”
(`GOALS.md:79`). Open question 4: “whether a feed view is also the head, or the head is a third tiny
signed file” (`GOALS.md:123`).

**Where six models landed.** Unanimous on one point — the generated feed is never the head. glm makes
it a MUST: “a third tiny signed file, and the generated feed is *never* the head — normative MUST. A
generated view is regenerable by the hostile hub; the head must be producible only by the author's
key.” (`responses/pass2-glm-5.3.md:162`). They split on what the head *contains*:

| model | contents | cite |
|---|---|---|
| qwen | “the sequence number, the ordered list of item IDs, the list of tombstoned item IDs, and the author's signature … This is the one stateful object the author must maintain.” | `responses/pass2-qwen3.8-max.md:110` |
| minimax | a sequence, “The IDs of items currently in the outbox, in canonical order”, signature; pinned, so a backward sequence or a missing listed item is detected | `responses/pass2-minimax-m3.md:215` |
| gpt | “The head lists object IDs and tombstones. It is authoritative only as the publisher's signed current declaration.” and elsewhere “not a proof of global completeness.” | `responses/pass2-gpt-5.6-luna.md:410`, `responses/pass2-gpt-5.6-luna.md:253` |
| kimi | “identity id, head sequence, timestamp, hash of the previous head file (this one addition gives them the chain property for ~free), and the count of live items. Fifty bytes of JSON. Refuse to make it enumerate items” | `responses/pass2-kimi-k3.md:101` |
| hy3 | “Third tiny signed file `head.json`, separate from generated feed. Feed is view; head is truth.” | `responses/pass2-hy3.md:69` |
| glm (pass 1) | a signed index with an admission rule: “An item **counts** — is admitted to a reader's view — only if referenced by a validly signed index … This closes the stale-key hole: a key stolen before rotation can't sneak items in, because the current key's index won't list them.” | `responses/pass1-glm-5.3.md:57` |

**What this repo already has, and a v2 correction.** The current manifest is the enumerating shape
(ids → version + hash), and `log-gate.md` priced the append-only variant. v2 called glm's admission
rule “the existing canonicality rule.” It is not: §9.3 invariant 3 treats an item the manifest has
not yet listed as *lag*, “unverified-pending rather than as a violation” (`open-feed-spec.md:613`),
and §9.3 forbids a reader from abandoning the feed for the listed set (`open-feed-spec.md:625`). glm's
rule is stronger — unlisted means not admitted — and its anti-theft benefit is delivered today by
revocation timestamps instead (§4.4). Under a head that is re-signed on every publish, glm's rule
costs nothing and the lag window disappears; under a batched head, it re-creates the lag state.

**Options.** (1) *Enumerating head* — ids plus tombstones (qwen, minimax, gpt): completeness by
listing; grows with the live set; batching reintroduces lag. (2) *Non-enumerating head* — sequence,
previous-head hash, live count (kimi): constant size and a chain for free; vanishing detection needs
the directory listing, which the hub controls. (3) *Enumerating head + admission rule* (glm): the
stolen-key hole closes and the feed view is demoted to decoration; the reader must fetch the head
before rendering anything. Each is a sketch-level decision; none changes the floor.

### J. The publish interface: how any client writes to any hub

**The question.** “the spec gains a small publish interface — how any client writes signed files to
any hub — so clients and hubs are a market, not a pairing.” (`GOALS.md:64`). Open question 1: its
shape; “signed PUT of files at conventional paths is the candidate” (`GOALS.md:118`).

**What six models offered.** All six endorse the interface as such; glm calls open question 1 “a
better question than my answer” (`responses/pass2-glm-5.3.md:53`). The proposals differ in three
places — authentication, path addressing, and whether the hub verifies signatures.

- *Authentication.* glm specifies a challenge-response session: `GET {base}/.pub/nonce`, `POST
  {base}/.pub/session` signed over the nonce, then bearer-token PUTs — “The hub binds the path prefix
  to the identity that opened the session; the token is a revocable capability that cannot forge
  content; the hub stores no key, ever. There is no `DELETE` — deletion is a new head … Server side is
  ~50 lines.” (`responses/pass2-glm-5.3.md:121`). qwen leaves it to the hub: “API key, OAuth, mTLS —
  this is a hub implementation detail, not a protocol concern” (`responses/pass2-qwen3.8-max.md:97`).
  kimi: the hub “verifies the signature against the current key in the identity's own profile *file*
  (not any hub-held account record — the hub is a verifier, not an authority)” and “*claiming* an id
  on a hub is first-come with the profile as proof, so no account system exists. Refuse to specify:
  quota and payment. That is the market.” (`responses/pass2-kimi-k3.md:95`).
- *Addressing.* gpt: “Use immutable, hash-addressed PUTs for objects, profiles, and heads. Do not use
  mutable conventional filenames as the authoritative upload target.”
  (`responses/pass2-gpt-5.6-luna.md:365`). kimi: “the path embeds the identity id and sequence so
  overwrites are impossible (`PUT /p/{id}/items/{seq}` — a new seq is a new file, tombstones are files
  too)” (`responses/pass2-kimi-k3.md:95`). hy3: “Hub verifies sig, rejects if seq exists.”
  (`responses/pass2-hy3.md:66`). minimax: six endpoints — PUT/GET on items, profile, head, plus POST to
  the inbox (`responses/pass2-minimax-m3.md:207`).
- *Does the hub check signatures?* qwen: “The hub does not inspect the signature. It stores the bytes.
  It serves the bytes. The signature is for readers.” (`responses/pass2-qwen3.8-max.md:104`). hy3 and
  kimi: it verifies, to keep its disk clean. minimax: “may verify”.

**Two hub obligations nobody had written down.** minimax: “A hub that re-encodes the JSON before
serving breaks the signature. A hub that doesn't re-encode, but adds a trailing newline, breaks the
signature. The design needs to be specific about whether the hub is required to serve the exact
bytes” (`responses/pass2-minimax-m3.md:36`) — `bytes-gate.md` reasons about a mutating attacker, not a
well-meaning re-encoder, so this is a sentence the sketch owes. And glm: browser readers fetching
across hubs need `Access-Control-Allow-Origin: *` (`responses/pass1-glm-5.3.md:114`) — the current
spec already requires it (§3.3), and a dumb-hub spec must keep it. Two more from the margins: hy3's
poll sizing — “If 10k users poll every 60s, hub dies. Neither sized the poll or suggested
`Retry-After`.” (`responses/pass2-hy3.md:59`) — and minimax's optional `hub_key` pinning the hub's TLS
key in the profile (`responses/pass2-minimax-m3.md:191`).

**What a gate would stage.** A dumb hub of ~50 lines accepting the chosen interface from two
independent clients; a re-encoding hub breaking signatures; a stale-sequence PUT refused.

### K. Problems the models say should not be solved

Reported because `PROMPT-pass2.md:86` asked for exactly this, and because each names a pile of
current-spec words.

- *A global resolver.* qwen: “*this protocol does not define, anticipate, or accommodate a resolver.*
  The protocol is for people who already know each other … The moment you add a resolver, you have a
  registry, and the moment you have a registry, you have a central authority”
  (`responses/pass2-qwen3.8-max.md:93`); hy3: “Maybe it shouldn't be solved—brief says strangers may
  be lost. I accept that; the other team was right to leave it.” (`responses/pass2-hy3.md:60`); glm
  lists “the universal resolver (agreed non-goal)” (`responses/pass2-glm-5.3.md:150`). `GOALS.md:74`
  already says this; the models say it harder.
- *The verdict lattice.* glm: “the verdict lattice (their refusal was right; my scenario-1 rhetoric was
  half-building one, and I retract it)” (`responses/pass2-glm-5.3.md:150`); kimi: “Refusing the
  freshness lattice is correct as far as it goes … Their error was not refusing the lattice; it was
  refusing the lattice *and* the push channel, leaving nothing.” (`responses/pass2-kimi-k3.md:47`).
- *Audience-cardinality hiding* — glm only (`responses/pass2-glm-5.3.md:150`); brief G.1 is the
  counter-count.
- *Freshness and ordering both* — kimi's framing challenge: “the other team is solving freshness and I
  am solving ordering, and the floor requires neither … A genuinely minimal design might ship neither
  and accept "the hub can serve a stale prefix, detectable only socially" as the price of a spec half as
  long … The chain defends the archive; the push channel defends the person. If forced to choose, the
  floor needs the person.” (`responses/pass2-kimi-k3.md:91`). This is the sharpest statement in either
  pass of the trade the campaign exists to make, and it cuts against brief A's options 2–4 as much as
  against the current spec.
- *Two things neither design had.* kimi: “**The contact list is the load-bearing artifact, and
  neither design specified it.** … every critical operation — relocation notification, social recovery,
  reply audience derivation, vouch propagation — is defined over "your contacts," and neither of us
  said what a contact *is* on the wire, where the list lives, how it is backed up, or how it survives
  device loss.” (`responses/pass2-kimi-k3.md:87`) — proposing the address book as a first-class
  encrypted, self-addressed item. glm: “**Time discipline, stated once.** … sequence and `prev` are the
  only ordering and validity inputs; signed `at` fields gate UX-level heuristics (staleness, veto
  windows) only; wall clock is never trusted for a security decision.”
  (`responses/pass2-glm-5.3.md:146`).

---

## Part II — The corrected per-model record

Corrected round only. Nothing below comes from `v1-defective-brief/` or `pass2-streaming-truncated/`.

### II.1 What each built (pass 1)

- **gpt-5.6-luna — "Signed Personal Objects."** Identity is the signing key, id = hash of it,
  separate X25519 key. Signing input is length-prefixed fields — `uint32_be(length) || bytes`
  (`responses/pass1-gpt-5.6-luna.md:161`) — not JSON. Pull; cross-hub private delivery is “B's
  application fetches A's object directly, or A's application copies the ciphertext to B's hub.”
  (`responses/pass1-gpt-5.6-luna.md:344`). Recovery: trustees who can authorize a replacement key, “The
  policy can require two of three signatures.” (`responses/pass1-gpt-5.6-luna.md:478`) — not Shamir,
  not 3-of-5; those were v1. Opens by stating that discovery after every endpoint vanishes is
  impossible without a rendezvous point (`responses/pass1-gpt-5.6-luna.md:19`).
- **qwen3.8-max — "Hearth."** Three artifacts: identity document, item, feed. Two keypairs — “Each
  person generates an X25519 keypair alongside their Ed25519 keypair.”
  (`responses/pass1-qwen3.8-max.md:196`) — and **one** shared ephemeral per item
  (`responses/pass1-qwen3.8-max.md:203`). Pure pull. Signing over a fixed-field-order, sorted-key
  serialization, which it later calls canonicalization in disguise. Its unsigned feed is its own
  least-sure choice (`responses/pass1-qwen3.8-max.md:251`).
- **kimi-k3 — "Hearth."** Five artifacts: card, log, blobs, envelopes, feeds. Inception key plus
  rotation chain; hash-chained log. POSTs envelopes to the recipient's hub inbox and calls that “the
  load-bearing decision behind assurance 4” (`responses/pass1-kimi-k3.md:91`). Per-recipient
  ephemerals **with** a 2-byte HMAC slot tag (`responses/pass1-kimi-k3.md:227`) — the both-halves
  construction `enctags.md` measured — plus SHOULD-padding. A `vouch` entry type; a local-replica MUST.
- **minimax-m3 — "Persona."** ActivityPub-shaped: WebFinger, `name@hub`, actor, inbox/outbox,
  HTTP-signed POSTs, with an Ed25519 key as the identity. Signs **canonical JSON** under a seven-rule
  subsection (`responses/pass1-minimax-m3.md:464`). Publishes the audience. A countersigned `notary`
  Move.
- **hy3 — "Latch."** Static files under `/u/<pubkey>/`; hub checks signatures on PUT; guardian
  escrow; no rotation. Signs canonical JSON without noticing the brief's constraint
  (`responses/pass1-hy3.md:72`). Shortest answer.
- **glm-5.3 — "Hearth."** Opens with nostr as nearest relative and rejects ActivityPub and atproto by
  name (`responses/pass1-glm-5.3.md:19`). Four artifacts: chain head, signed index, items, blobs.
  Line-delimited envelope with a `.` terminator. No inbox, no federation, no delivery. Shared
  ephemeral, no tag; misstates its own recipient cost as “averaging N/2 ECDHs”
  (`responses/pass1-glm-5.3.md:209`) when the shared ephemeral makes it one ECDH and N/2 unwraps.
  Admission rule (brief I).

Three of six named their design "Hearth." Six of six made identity a key and rejected domain
identity. Three of six — gpt, kimi, glm — genuinely sign bytes with no canonicalization; minimax and
hy3 canonicalize; qwen's fixed order is canonicalization by another name. Five of six state which
language standard libraries clear the dependency bar (all but gpt, which states the rule without
naming languages); all five name Python as the one that does not.

### II.2 The owner's five open questions × six models (pass 2)

| | publish interface | encryption | recovery threshold / trust set | the head | push |
|---|---|---|---|---|---|
| **gpt** | immutable hash-addressed PUTs; four mandatory verbs (`:365`) | refuses in-house; X25519 + HKDF + AEAD + Ed25519 with vectors (`:380`) | public 2-of-3 or 2-of-5 in the profile (`:393`) | separate signed file of ids + tombstones; a declaration, not a proof (`:410`) | omit from core (`:414`) |
| **qwen** | dumb store; hub auth is hub's business; four paths (`:97`) | keep its own; pad slots to 8 (`:106`) | no number; app shows co-signers; never published (`:108`) | ids + tombstones + seq, re-signed per publish (`:110`) | no; DMs as unlisted items (`:112`) |
| **kimi** | hub verifies against profile file; id+seq paths; first-come claim; refuses quota (`:95`) | standard composition, audience inside ciphertext, vectors (`:97`) | refuses a number without contact-graph data; mutual-contact voucher; human confirm (`:99`) | seq + prev-head hash + count; no enumeration (`:101`) | yes, three purposes only (`:103`) |
| **minimax** | six endpoints; hub may verify (`:207`) | HPKE, one seal per recipient, hashed key ids (`:209`) | per-reader policy; attestations public (`:211`) | seq + ordered ids; pinned (`:215`) | mandatory inbox (`:220`) |
| **hy3** | signed PUT; reject if seq exists (`:66`) | X25519 + AEAD, trial-decrypt (`:67`) | 1-of-N; never published (`:68`) | third file; “Feed is view; head is truth.” (`:69`) | refuse (`:70`) |
| **glm** | nonce → session → bearer PUT; no DELETE (`:110`) | shape not library; refuses to finalize without target languages (`:158`) | subject-designated, hash-committed, default 1 (`:160`) | third file, normative MUST (`:162`) | no ping; dead-drop box (`:164`) |

Line numbers are within each model's `responses/pass2-<model>.md`.

### II.3 What each would cut to halve the specification (pass 1)

- gpt: manifest chains, multi-device conflict handling, anonymous envelopes (“accept recipient
  identifiers”), the recovery quorum, built-in RSS/Atom (`responses/pass1-gpt-5.6-luna.md:665`).
- qwen: first, encryption entirely — “This removes Assurance 2 … This is implementable in an
  afternoon.” (`responses/pass1-qwen3.8-max.md:279`) — the only proposal to drop a floor item; failing
  that, the feed, reply/reaction types, rotation (`responses/pass1-qwen3.8-max.md:283`).
- kimi: the rotation chain first, then Atom, slot padding, multi-hub redundancy, head gossip; would
  not cut “sign-the-bytes envelopes, the hash-chained log, per-item content keys with recipient-hidden
  slots, and the local-replica MUST” (`responses/pass1-kimi-k3.md:274`).
- minimax: reactions, follower collections, image upload, the separate encryption keypair (derive
  instead), multi-recipient encryption, the KeyRotation type, HTTP signatures
  (`responses/pass1-minimax-m3.md:548`).
- hy3: reactions and guardian recovery (“make key loss fatal but simpler”), JSON Feed
  (`responses/pass1-hy3.md:176`).
- glm: the ActivityPub bridge, reactions, mirror support, photo encryption (“a visible wound”),
  pagination (`responses/pass1-glm-5.3.md:242`).

### II.4 What each conceded it cannot deliver

gpt: discovery after total endpoint loss (`responses/pass1-gpt-5.6-luna.md:604`). kimi: “The
stale-not-her property is social, not absolute.” (`responses/pass1-kimi-k3.md:260`). minimax: hiding
the audience from the hub (`responses/pass1-minimax-m3.md:516`). glm: a contested key fork is “not
cryptographically resolvable without a global ordering service” (`responses/pass1-glm-5.3.md:171`).
qwen: split views (`responses/pass2-qwen3.8-max.md:89`). hy3: none stated.

---

## Part III — One agent's leanings (skippable)

Labeled as opinion; the briefs above do not depend on any of it.

- **A.** The out-of-band link is the family's relocation mechanism and should be restored to the
  center of the GOALS.md bullet rather than left as its last clause. Of the signals that reach
  readers the link does not, option 5 (location carried in interaction targets) costs least and
  falls out of a decision already taken; option 2 (a declared deadline) is 26 bytes and binds exactly
  the divorce adversary. I would gate both before choosing, and I would reword scenario 1's promise
  to whatever the gates show rather than the other way round. kimi's framing challenge (brief K) is
  the strongest argument against doing anything here at all, and it deserves a written answer.
- **B.** "Peers a reader already trusts" should go; subject-designated recoverers are what every
  model that thought hardest reached, and it is the current spec's own shape. glm's hash commitment
  answers open question 3 mechanically and is cheap. The veto window is worth a gate before deciding:
  it is the only defense against a designated recoverer who turns, and it introduces a provisional
  reader state — the kind of lattice cell brief K warns about.
- **C.** The address should carry the key. `GOALS.md:55` survives unchanged — a link is not a key.
- **D.** One sentence (kimi's). The structural version is attractive but belongs to brief J.
- **E.** Same key everywhere for v1, stated in GOALS.md as a decision with glm's journalist caveat.
- **F.** glm's dead-drop is the most interesting new shape: it is channel-gate's (b) with the inbox
  deleted, and it composes with pull. I would gate it against channel-gate's scenarios before
  reopening §10 in any form.
- **G.** Padding: yes, as SHOULD, power of two. Audience inside the plaintext: yes, non-negotiable
  for scenario 3. Separate key: yes. Construction: the commissioned evaluation should compare the
  current envelope against an HPKE-shaped one and stop there; qwen and glm are right that the
  library is not the question.
- **H.** Option 2; one sentence.
- **I.** Enumerating head with glm's admission rule, re-signed per publish, which makes the lag
  state vanish — but only if brief E's concurrency answer makes "re-signed per publish" cheap.
- **J.** kimi's three rules plus minimax's exact-bytes obligation. Authentication can be glm's
  session or hub-chosen; the spec should fix the *paths and verbs* and leave auth to the hub.
- **K.** kimi's contact list as a first-class encrypted item is the one new artifact I would add to
  the sketch's inventory. glm's time-discipline paragraph should be written once, early.

---

## Appendix A — Errata on v2 (`SYNTHESIS-v2-superseded.md`)

Verified 2026-08-20 by three independent re-reads: every pass-1 claim against the six pass-1
answers, every pass-2 claim against the six pass-2 answers, and every repo citation against its line.
No quotation in v2 was fabricated. The errors:

1. **Quarantined answers presented as the corrected round.** v2 §1/§2 described gpt's
   `uint64_be` length prefix, "content-free notification," and "Shamir 3-of-5" and qwen's
   "Hearthwire," Ed→X25519 derivation, and per-recipient ephemerals. All are from
   `responses/v1-defective-brief/`; none occurs in the shipped answers (see Part II.1 for what they
   actually built). v2 P4's qwen block quote (“canonicalization scheme wearing a disguise”) is from
   `responses/pass2-streaming-truncated/pass2-qwen3.8-max.md`; the shipped wording is “This is a
   canonicalization scheme in disguise, and it is fragile” (`responses/pass2-qwen3.8-max.md:41`).
   This is the contamination v2's own rule 2 claimed to have eliminated.
2. **False attribution rows.** "Sign exact bytes; no JSON canonicalization — gpt, qwen, kimi,
   minimax": minimax signs canonical JSON under a seven-rule subsection
   (`responses/pass1-minimax-m3.md:464`); qwen's fixed-order serialization is canonicalization.
   "hy3 … the only one of the six that did this": false — minimax did, knowingly. Row 4 credited
   minimax and hy3 with nostr/atproto verdicts neither makes, and dated glm's to v1 when the
   corrected glm opens with them (`responses/pass1-glm-5.3.md:19`). "All five" in a six-model table;
   glm missing from the channel table.
3. **An elision that manufactured a finding.** v2 P15 said IP rate-limiting is in a gate "but not
   in GOALS.md." It is: “rate-limit by IP before fetching” (`GOALS.md:84`), inside the twenty words v2
   cut from its own `GOALS.md:82` quote without an ellipsis. The old `check-citations.js` tested only
   that a cited line existed, so this passed.
4. **A wrong routing.** v2 §5 called glm's index-admission rule "the existing canonicality rule."
   §9.3 invariant 3 treats an unlisted item as lag (`open-feed-spec.md:613`); glm's rule rejects it.
   Brief I has the corrected reading.
5. **Overstatements.** P2: `open-feed-spec.md:242` is a display requirement on multi-tenant hosts,
   and its elided second half is a consumer compare-rule MUST; "ceremony" is GOALS.md's word, not
   the spec's. glm independently proposed the same fingerprint and ranked it first
   (`responses/pass2-glm-5.3.md:142`) — v2 named minimax alone. P9: qwen "declines to offer a clean
   fix" — it offers one twice (`responses/pass2-qwen3.8-max.md:79`, `responses/pass2-qwen3.8-max.md:108`).
   P10: qwen's Q3 answer was called "in tension" with its own attack; it is presented as the fix for
   it. P16: "two pieces" followed by three numbered items. P1: gpt's "as the direction permits" was
   an inference — `PROMPT-pass2.md` never permits deleting local copies — and `GOALS.md:67-69` is
   about key-backup UX, not content copies; gpt's and kimi's remedies went unreported. P15: the
   repo's "only multi-device answer requires delegated keys" — `writer-gate.md:11` stages two devices
   with the member's own key; delegation was the offline-member corner. P9's ALREADY-PRICED via
   `threshold.md:23`: half the card's reason (exit coordination) does not apply to loss-only recovery.
   The channel-gate quote dropped “under (a)” (`channel-gate.md:24`), the gate's axis. Subchain-gate's
   “post-theft fork class” became "§5.5 class"; threshold.md's “both migrate alone and block” lost
   "both … and block."
6. **The pass-2 prompt repeated the pass-1 defect.** `PROMPT-pass2.md:17-20` dropped `GOALS.md:73`'s
   out-of-band link. v2's P20 counted five relocation attacks and never noted that the design they
   attacked was missing its family-case answer.
7. **Unreported material.** Five of six models' answers to the owner's five open questions (v2
   reported qwen's only); kimi's local-replica MUST, audience-inside-ciphertext bug, and contact-list
   artifact; qwen's scheduled-posts attack; glm's root-of-trust gap, publish-interface spec, dead-drop
   box, time discipline; minimax's notary, HPKE, `hub_key`; gpt's encryption-key recovery, immutable
   PUTs, mirror replication; hy3's "contested, not stale" and poll sizing; KERI rejected on scenario 2;
   every "what to cut" list but two.
8. **Provenance notes.** Both gpt files carry `finish_reason: null`, which v2's own P14 defines as a
   cut stream, yet were tabulated "complete"; their tails are complete closing sections — the field is
   uninformative for that model. v2's P14 "one-word body" for the truncated kimi/glm runs: both are
   zero-word bodies. "After three failures" for kimi: one superseded file exists. The README's "five
   models" and its routing vocabulary described v1, not v2.

## Appendix B — Provenance

All twelve shipped answers: pass 1 against `PROMPT-pass1.md`, SHA-256
`ba5166e38c0b3d0269bcd2c5d208a88baabfa78d03315c23fb1a0391107ade1d`; pass 2 against
`PROMPT-pass2.md`, SHA-256 `e808057730fa1e8528c594da5513c840a16897c944e6bf2b03a576244d5ed8f5`, with
the model's shipped pass-1 answer replayed as history (`ask.js:31`).

| model | lab | pass 1 effort / finish | pass 2 effort / finish |
|---|---|---|---|
| gpt-5.6-luna | OpenAI | medium / `null` (complete on read) | medium / `null` (complete on read) |
| qwen3.8-max | Alibaba | medium / stop | medium / stop |
| kimi-k3 | Moonshot | medium / stop | low / stop |
| minimax-m3 | MiniMax | medium / stop | medium / stop |
| hy3 | Tencent | medium / stop | medium / stop |
| glm-5.3 | Zhipu | high / stop | high / stop |

`deepseek-v4-pro` (truncated on every attempt) and `grok-4.5` (upstream 503) were replaced, not
retried. Everything produced under the defective brief is in `responses/v1-defective-brief/`; the four
streamed pass-2 attempts the gateway cut are in `responses/pass2-streaming-truncated/`.
