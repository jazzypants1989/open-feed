# PROPOSALS-5.md — Fifth pass (closing): encryption is more central than pass 4 concluded, because confidentiality follows key custody *per hop*, not globally

> **Audience:** the four prior agents and the owner. Read after `PROPOSALS.md` (P1–P6),
> `PROPOSALS-2.md` (A1–A2, B, C, D1–D2), `PROPOSALS-3.md` (three shapes, Option E), `PROPOSALS-4.md`
> (JWE, key-custody caveat, circles). This is the **last round**: it (a) locks everything the four
> passes converged on, (b) **corrects pass 4's load-bearing caveat** — encryption is *not* a
> client-side-key-only niche; its boundary excludes every host **except the author of the
> plaintext**, which makes it broadly valuable even to hub-managed users, (c) follows that
> correction to a **cleaner end state than E-complement**: host-gating likely shouldn't survive as
> an extension at all, and (d) **upgrades circles** from "research frontier" to "shippable v2" via
> owner-curated encrypted rosters. Then it closes with a build-ready architecture and the two
> decisions that are actually the owner's. Nothing committed.

## TL;DR

- **The do-regardless spine is settled** across all five passes — three-shape frame + the
  membership-chain principle, P1+A1, A2, D1, D2-regrounded, one token vocabulary. Part 1 restates
  it and does **not** reopen it.
- **Pass 4's caveat is half-right and the wrong half is decisive.** "Encrypting to your published
  key is theater if your host holds that key" conflates *author-hop* with *every hop*. Correct
  statement: **encryption is confidential against every party except (1) the plaintext's author and
  (2) holders of a recipient's private enc key.** The author needs *no* private key to encrypt (you
  encrypt to recipients' **public** keys), so **the author's key custody is irrelevant to
  confidentiality** — only each *recipient's* custody is, and only for *that recipient's* copy.
  Consequence: encryption protects your family's content from the CDN, the network, and **every
  other family member's host**, for hub-managed and client-side users alike. It is theater against
  exactly one hop — *your own authoring hub, for your own content* — and nowhere else.
- **That reshapes the end state.** Once encryption is broadly applicable, host-gated audience
  control's *only* surviving jobs are **bandwidth** and **existence/metadata privacy** — and both
  are served by an **unguessable capability URL + a private server allowlist**, i.e. operational
  notes, not a fetch-assertion/grant/gated-manifest extension. So the honest end state is likely
  **not** pass 4's "encryption extension + slimmed audience-control extension," but **one small
  encryption extension, and no audience-control extension at all.** I argue this and mark where it's
  the owner's call.
- **Circles are tractable, not research.** The owner is the roster authority for its own audience,
  so it can distribute an **encrypted roster** to members; encrypted group threads become a v2, not
  a frontier. Broadcast + DM ship in v1.

| Item | Verdict |
|------|---------|
| Do-regardless spine (passes 1–4) | **Locked** (Part 1) |
| Pass-4 key-custody caveat | **Corrected** — confidentiality is per-hop; encryption is broad (Part 2) |
| Split-custody (pass-4 Challenge #1) | **Resolved** — protects *inbound* from your hub; author-hop is unavoidable (Part 2) |
| End state | **Sharpened** — likely *no* audience-control extension; encryption + operational notes (Part 3) |
| Circles | **Upgraded** to shippable v2 (Part 4) |

---

## Part 1 — Locked (no reopening)

Five passes agree on these; treat them as decided and skip straight to drafting when the time comes:

- **Three shapes + membership-chain principle (pass 2 B → pass 3 → pass 4 2.1).** One primitive
  (signed document, author-bound by `url` / items' `authors[0].url`); two modifiers — *chained*
  (`seq`/`prev`/`history`, pinned-and-walked) and *contained* (unsigned wrapper; self-verifying iff
  its entries are chain-linked, else paired with a membership-chain). **The manifest is the feed's
  membership-chain** — inevitable, because items are independent leaves by design (so multi-author
  feeds and independent editing work). State once in core §1/§2.
- **P1 + A1:** one signing construction, one verifier; fetch assertion becomes a construction-#1
  document; `typ:"openfeed-fetch"` in the **protected** header (no `crit`), mandatory bidirectional
  presence/absence check.
- **A2:** one author-binding rule (`url`; items use `authors[0].url`).
- **D1:** one `feeds` array, `{url, manifest, rel}`; `rel:"primary"` authoritative, order
  display-only; closes F4.
- **D2 (regrounded):** content-less relations are manifest-exempt as a *type* distinction, not a
  value judgment; OPTIONAL manifested-activity escape for a public-virality user.
- **One token-vocabulary rule:** registered token or absolute URL; unknown preserved & ignored;
  referenced by `_rel.type`, feed `rel`, key `use`.
- **Part C (bearer tokens): withdrawn.** Reintroduces shared secrets; off-model. Settled twice.

The rest of this document is only about the **restricted/encrypted** fork, where the five passes
have *not* yet converged.

---

## Part 2 — Correcting the caveat: confidentiality is per-hop, and the author needs no key

Pass 4's Part 3 is the pivot the whole thread now turns on, and it's stated too strongly:

> *(pass 4)* "encrypting to your published key gives you nothing if your host holds that key… For
> the hub-managed-key default, 'encrypt to my key' is theater."

The error is treating "your host holds your key" as one fact with one consequence. Encryption has
**two** keys and **many** hops, and they don't collapse:

1. **Encrypting requires only the recipients' *public* keys.** The author holds no secret to
   encrypt — so **the author's own key custody is irrelevant to confidentiality.** A hub-managed
   author whose hub holds their *signing* key still produces ciphertext only the *recipients* can
   open. Pass 4's "the hub holds the key so it can decrypt" is true only if the hub holds a
   **recipient's** private *enc* key — a different key, a different party.

2. **Confidentiality is decided per-recipient, per-hop.** Whether Mom's copy is readable by Mom's
   hub depends on **Mom's** enc-key custody, not the author's. So the correct, precise statement:

   > **Encrypted content is confidential against every party except (1) the author of the plaintext
   > and (2) any holder of a recipient's private enc key.**

Apply that to the family-hub product and the "theater" claim mostly evaporates:

| Party in the delivery path | Reads your *own* encrypted post? | Reads posts *others* encrypt to you? |
|---|---|---|
| **Your authoring hub** (drafts + signs, hub-managed) | **Yes** — it wrote the plaintext | only if it holds **your** enc key |
| Your serving host / CDN (if distinct from author) | No (ciphertext) | No |
| **Every *other* member's hub** (cross-hub) | **No** (unless that member put their enc key on it) | n/a |
| Network / serving-path attacker | No | No |

Encryption is theater against **exactly one hop — your own authoring hub, for your own content** —
because you delegated authoring to it (the email model, already accepted, §14.2). Against *every
other* host in the path — the CDN, the network, and **crucially every other family's hub** — it
delivers real confidentiality **regardless of key custody.** Since the entire reason restricted
feeds exist is the **cross-hub** case (single-hub = login wall, established four passes ago), and
cross-hub means "your content sitting on *other people's* hosts," **encryption's boundary lands
exactly where the threat is** — and it does so for hub-managed users, not just the client-side
cohort pass 4 restricted it to.

**This resolves pass 4's Challenge #1 (split custody), which pass 4 called possibly the most
important question in the thread.** Split custody *is* coherent, but asymmetric, and the asymmetry
is the whole point:

- **Your outbound content:** if your hub drafts it (the AI product), your hub sees your plaintext,
  full stop — no key split changes that, because the *drafter* needs cleartext. Encrypting your own
  entries hides them from *everyone downstream of your hub*, not from your hub.
- **Your inbound content:** keep **your X25519 enc key client-side** and your hub **cannot read what
  others send you**, even while it still signs your outbound content. This is the valuable split,
  and it is exactly the axis the DISTRIBUTION-MODEL §825 AI-consent problem lives on: an author
  wraps to the recipients they choose; the recipient's *hub-AI* can read a family post **iff the
  author wrapped to it.** Consent stops being a policy promise and becomes a recipient in the wrap
  list. (Corollary to state loudly: if the AI companion is a wrapped recipient, its provider *can*
  read — encryption makes that visible, not magic.)

So the split-custody model **holds up**, with the honest boundary named: encryption protects
content *from every host except the one that authored it.* For a family journaling hub that writes
your entries, that host is your own hub for your own posts — and nobody else's infrastructure for
anybody's posts. That is a *stronger and more honest* guarantee than the current extension's "every
serving host reads everything," and it is available to **all** users, which is the correction that
matters.

---

## Part 3 — The end state pass 4 stopped one step short of: probably *no* audience-control extension

Pass 4 recommended **E-complement**: an encrypted-content extension *plus* a slimmed
(assertion+grant) audience-control extension for the key-custodian tier. Part 2 pushes past that.
Once encryption is broadly applicable (not a client-side niche), tally what host-gated audience
control still *uniquely* does that neither encryption nor a capability URL covers:

- **Confidentiality?** No — that's encryption's job now, and encryption does it *better* (host-blind
  vs host-reads-plaintext) and *more widely* (Part 2).
- **Existence/metadata privacy** (the A4 abuse persona)? An **unguessable capability URL** hides the
  feed's existence (nothing links to it) — and if the feed is *also* encrypted, the URL leaking
  costs you only metadata, not content. So "encrypt + serve at an unguessable URL" covers this with
  **no fetch assertion, no grant, no gated manifest.**
- **Bandwidth** (don't serve big media to strangers)? A **private server-side allowlist** (§6.1, the
  "interface only" one) — the host's own business, needs no document format.
- **Per-reader cryptographic *attribution* of reads** (the host proves *which* identity fetched)?
  This is the *one* thing only the identity-bound assertion provides. Ask honestly: does a
  family-scale protocol need the serving host to hold cryptographic proof of who *read* a post? I
  can't find the use case. Audience *control* (who *may* read) is delivered by encryption + URL;
  read *auditing* is a surveillance feature, not a family requirement.

So the fetch-assertion/grant/gated-manifest apparatus — even fully slimmed — survives only for
"cross-hub, host-trusted, unencrypted, existence-private, with cryptographic read-attribution," an
intersection persona I don't believe is real at family scale. The cleaner end state:

> **One extension: `open-feed-encrypted-content.md`** (JWE in `_enc`, X25519 enc keys, broadcast +
> DM; Part 4 adds circles later). **No audience-control extension.** The residual host-gating jobs
> (existence privacy, bandwidth) become a **one-paragraph operational note** in the core or the
> encryption doc: *"To hide a feed's existence, serve it (encrypted) at an unguessable ≥128-bit
> capability URL and link it from nothing; a host MAY keep a private allowlist to limit who it
> serves. Neither needs protocol machinery."*

This deletes, relative to today: the second construction (already gone via P1), **and now the fetch
assertion, all four §6 authorization mechanisms, the gated manifest, the grant-revocation list, the
existence-mode branching, and self-commitments — the entire restricted-feeds extension** — replaced
by one small client-side encoding + a note. That is the maximal, and I think correct, realization of
the owner's "cleanest, most cohesive" ask.

**Where this is genuinely the owner's call, not mine:** if cryptographic **read-attribution** or a
host-trusted **unencrypted** cross-hub audience (e.g. large media you won't encrypt, served only to
named identities on a hub you trust) is a real product need, then pass 4's **E-complement** is
right and the slimmed assertion extension earns its keep. Absent that, **E-only + operational note**
is cleaner. My lean: **E-only.** State the two residual jobs as a note; don't keep an extension
alive for an intersection persona nobody has named in five passes.

---

## Part 4 — Circles are shippable v2, not a research frontier

Pass 4 scoped encrypted *interactive threads* out as "a genuine research edge" because a *reader*
replying to an encrypted item doesn't know the audience to re-wrap to (worsened by untagged
recipients hiding it). That's true for *ad-hoc* groups, but restricted feeds are **owner-curated**,
and that assumption cracks the problem:

> The **owner is the roster authority for its own audience.** It already knows every member (it
> chose them and wrapped every post to them). So the owner can distribute a **circle roster** —
> `[{identity, x25519_pub}, …]` — **encrypted to each member.** A member then knows exactly whom to
> wrap a reply to; outsiders learn nothing (the roster is ciphertext); members learning each other
> is fine (a circle is a group chat — members knowing the group is definitional).

Mechanics, all reusing pieces already on the table:

- The roster is an ordinary **signed item** (or a small signed document) whose `_enc` wraps the
  member list to each member's X25519 key. It is itself **contained/chained** like anything else, so
  membership changes are versioned and walkable (pin-and-walk catches roster rollback — the same
  discipline that killed the self-commitment special-case).
- A reply wraps to the current roster version. **Churn:** add a member → new roster version wrapped
  to all; **no forward secrecy, no retroactive revocation** — the identical concession
  restricted-feeds §2 already makes ("authorized readers can re-share"), so E introduces *no new*
  weakness, it just makes the existing concession cryptographic.

That is exactly how no-PFS group messaging works, and at family N≈10 it is a modest v2, not a
research program. **Scope v1 = single-author encrypted broadcast + audience-of-one DMs** (the
journaling spine and the true-E2E DM unification pass 4 identified); **v2 = circles** for encrypted
group threads. Naming circles as tractable-but-later is the honest scope, and it means E can
eventually own the *whole* interaction surface, which further strengthens "E-only" over
E-complement.

---

## Part 5 — Closing the remaining technical questions (pass-4 Part 6)

- **#1 split custody / the caveat** — resolved in Part 2: coherent, asymmetric; protects inbound
  from your hub, cannot protect your own content from a hub that authors it. The correct scope is
  "encryption protects against every host except the author's."
- **#2 JWE profile** — use **`alg:"ECDH-ES+A256KW"`, `enc:"A256GCM"`, JWE JSON Serialization**
  (multi-recipient needs JSON, not Compact), X25519 per RFC 8037. Stay on JOSE: "built on existing
  standards" is the brand, and a libsodium `crypto_box_seal` profile, while smaller, forks off the
  JOSE family the rest of the protocol commits to. Envelope overhead at N≈10 is a few hundred bytes
  — negligible against post + media. Keep sealed-boxes as a possible *future* alternative profile,
  not the default.
- **#3 trial-decryption cost** — untagged recipients cost the reader N key-unwrap attempts per item
  (AES-KW, microseconds). The AI-companion worry (N recipients × M authors) is items-total × N
  unwraps — for a family, thousands of trivial ops, done once at ingest and cached. **Trivial
  confirmed.** If ever hot, add an *outsider-opaque* hint (a per-item ephemeral recipient tag that
  only the holder can correlate) — but don't; untagged is simpler and N is small.
- **#4 circles roster** — solved in Part 4: owner-as-roster-authority distributes an **encrypted**
  roster; no shared secret, no public membership list. Upgrades encrypted threads from frontier to
  v2.
- **#5 core touch surface** — exactly **two additive hooks**, confirmed: (a) permit an X25519
  `{"kty":"OKP","crv":"X25519","use":"enc"}` entry in the identity `keys` array (already additive
  under §4.1's "ignore unrecognized `kty`/`crv`"); (b) one sentence that an item's content MAY be
  carried as a JWE envelope in `_enc` with `content_text:""`. Nothing else in the core changes; the
  manifest, canonical/copy, tombstones, and author binding all operate on the (encrypted) item bytes
  unmodified. The encryption extension is otherwise pure client-side encoding.
- **#6 existence/metadata privacy (A4)** — folds into "encrypt + unguessable capability URL +
  private allowlist" (Part 3). It does **not**, by itself, justify keeping a whole assertion/grant
  extension. If the owner wants it as protocol rather than operational note, that's the single
  decision that revives E-complement.

---

## Part 6 — The build-ready end state, and the two decisions left

**Adopt now (five-pass consensus, zero capability change):** the Part 1 do-regardless spine. This
is safe to start drafting into the core and the (surviving) docs immediately — it's all cohesion.

**The restricted/private story, recommended architecture:**

```
Confidentiality      → open-feed-encrypted-content.md   (JWE in _enc, X25519 keys; v1 broadcast+DM, v2 circles)
                       · host-blind, static-hostable (L2), public manifest commits the ciphertext
                       · protects content from every host except the author's own hub
Existence/bandwidth  → operational note (unguessable capability URL + private allowlist)   [no extension]
Single-hub family    → login wall   [no protocol]
```

...which **deletes the restricted-feeds extension entirely** in favor of one small encoding
extension plus a note.

**Two decisions are genuinely yours; everything else follows from them:**

1. **Is host-blind confidentiality (real E2E) a goal for the cross-hub / client-side cohort?**
   Almost certainly **yes** — it's on-brand (JOSE), high-value, small (two core hooks), and it turns
   your AI-consent problem from policy into cryptography. If yes → **ship the encryption extension,
   broadcast-first.** This is the headline of the whole five-pass effort.
2. **Does anyone need cryptographic *read-attribution*, or a host-trusted *unencrypted* cross-hub
   audience?** If **no** (my strong lean) → **delete the audience-control extension**; existence and
   bandwidth become an operational note (**E-only**). If **yes** → keep pass 4's slimmed
   assertion+grant extension alongside encryption (**E-complement**). Nobody has named the persona
   that needs it in five passes; I'd delete it and let a real request revive it pre-1.0.

**Deferred, honestly, not pretended-solved:** encrypted group **circles** (v2, tractable per Part 4)
and feed-**existence** privacy beyond an unguessable URL (the A4 persona — small, and only revives
an extension if decision #2 is "yes").

If you want, the natural first artifacts are (a) the **three-shape core reframe** (pure cohesion,
no fork dependency) and (b) a **sketch + test vectors for the encrypted-content extension** (one
encrypted item with a 2-recipient JWE, proving the item still signs/verifies/manifests unchanged),
so the headline idea is concrete before any deletion is committed.

---

## Challenge me (if there's ever a sixth pass)

1. **The per-hop correction (Part 2) is the crux now.** Is there a hop I mislabeled — e.g. does a
   pull-through cache or a WebSub hub (Appendix C) ever see plaintext of an encrypted item? I claim
   no (they carry ciphertext bytes), but verify the WebSub and copied-item (§7.5) paths.
2. **E-only vs E-complement (decision #2).** Construct the strongest real family-scale case for
   cryptographic read-attribution or host-trusted unencrypted cross-hub audience. If it survives,
   the assertion extension lives; if not, delete it.
3. **Circles roster rollback/PFS (Part 4).** Does versioning the roster as a chain actually give
   clean membership semantics, or does "reply wrapped to roster v3 read by a v4 member" create gaps?
   Work a concrete churn sequence.
4. **Two-hook claim (Part 5 #5).** Prove the encryption extension needs *only* the X25519 key and
   the `_enc` sentence — or find the third core touch.
5. **Did five passes miss anything in the *core* itself** beyond the three-shape framing and D1/D2?
   Last chance to falsify "the core is minimal."
