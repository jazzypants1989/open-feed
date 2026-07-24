# Hand-off: Open Feed v0.2.0 — remaining questions, with a focus on interoperability

> Paste this whole file to a fresh agent as its opening prompt. It is written to be
> self-contained. The human (repo owner) will work **with** you — this is collaborative,
> not fire-and-forget.

---

You are picking up the **Open Feed Protocol** in `/Users/jessepence/repos/open-feed`. The core spec is at **v0.2.0** (`open-feed-spec.md`), committed on branch `v0.2.0-privacy-and-exit`. Two extensions are drafted: `open-feed-conventions.md` (v0.2.0, follows + pins) and `open-feed-encrypted-content.md` (v0.1.0, new). `README.md`, `DISTRIBUTION-MODEL.md`, and `CLAUDE.md` all match.

Your job is to work through the **remaining open questions** with the owner, **with an added focus on interoperability with other platforms** — currently the largest unaddressed area in the project, and deliberately your headline (§3).

## Your mandate — question everything

This hand-off is a set of *suggestions*, not a spec of your work. The owner has explicitly asked, across sessions, that you:

- **Challenge what's here.** v0.2.0 made large, opinionated calls — deleting an entire extension, adding an exit story, reversing a scope boundary on encryption. They were argued, but arguments can be wrong. A well-reasoned "this is wrong here" beats faithful implementation of a flaw. `CLAUDE.md` has a "Decisions taken — do not relitigate without new information" list; *new information is exactly what you should hunt for.*
- **Hunt for missed connections.** These documents interlock (two chains + one pin-and-walk discipline, one object model, one signing construction, `_feed_url` canonical/copy, migration = recovery, exit = three parts that only work together). The best findings in this project's history came from noticing that a proposal in one document had unnoticed consequences in another.
- **Ask the owner as many questions as you like**, including ones this hand-off never raises — naming, philosophy, scope, threat model, whether an item belongs at all. The owner *wants* questions and has said so repeatedly. Do not ration them. Propose, then write.

The invariants in §5 are the one thing not to discard casually — but even those are open to challenge if you have a real argument; flag an invariant-level change loudly and get explicit buy-in.

## Step 0 — Orient before doing anything

1. Read `open-feed-spec.md` in full, then `open-feed-encrypted-content.md`, `open-feed-conventions.md`, and `CLAUDE.md`. Skim `README.md` and `DISTRIBUTION-MODEL.md`.
2. Run `node tmp/regen.js`. It regenerates and self-verifies core Appendix D and conventions Appendix C, **and** reads both published docs to confirm every vector string appears verbatim. It exits non-zero on failure. That script is your signing/canonicalization reference implementation.
3. Run `node tmp/enc-prototype.js` (CLAIM 5 is the ciphertext-relay attack and its rejection) and `node tmp/circles-prototype.js` (rollback only — see §2.1).
4. Read spec **Appendix E** — it records what was removed and why, including the tests that justify the removals. Several questions you might be tempted to reopen are answered there.
5. **Do not start drafting.** Confirm priority order with the owner first, then present a short design proposal for the chosen work and get their calls before writing normative text.

## 1. What v0.2.0 decided (context, not instructions)

Two facts drove the release, and you should hold both:

**The threat model.** The operator of a family hub may be a loved one who is an abuser. That adversary controls the serving path, the inbox, and — by default in the reference product — the keys. No confidentiality mechanism defeats them. What the protocol can offer is **exit**: a device-generated recovery key the host never held (§4.5), a migration that needs no cooperation from the old host (§3.4), and a complete signed export bundle on demand (§15). All three are Level 3 MUSTs and **only work together**.

**The missing persona, finally named: two self-hosting family members.** Passes 6, 8, and 9 each asked for a host-trusted cross-hub audience and each concluded none existed. It is the modal case for a URL-native protocol. It makes cross-hub `family` visibility a launch requirement, answered by **published + encrypted** content — a public, manifested, CORS-`*` file of ciphertext — rather than by an authorization gate.

The two rules that replaced the deleted machinery:

- **Existence-privacy, not confidentiality, is what a completeness proof excludes.** A completeness proof is public; content whose *existence* must be private cannot have one. Content whose *bytes* are opaque still can.
- **Any audience larger than one requires a membership document.** DMs need no roster; groups do. This holds identically whether content is encrypted or cleartext — it is a membership problem, not a cryptography problem.

## 2. The open questions, in rough priority order

The owner sets priority; this is a starting proposal, not a decision.

### 2.1. Circle rosters are specified but NOT shippable — the live gap

`open-feed-encrypted-content.md` §6 specifies rosters; §6.2 says plainly they must not ship yet. This blocks **group replies to encrypted family content**, which is the one thing the owner's chosen design cannot yet do. Cross-hub family *posts* work; cross-hub family *replies* do not.

Before rosters can be offered, a second prototype must model:

- **Withholding, not just rollback.** `tmp/circles-prototype.js` tests rollback (host serves a stale roster) and passes. The real attack is different: a host simply **declines to serve the newest version** to a chosen replier, and pin-and-walk cannot distinguish that from "no new version exists." §6.1 proposes that a member seeing others cite a higher `seq` treats it as a compromise signal — that needs testing, and it may not be enough.
- **Identity-document-published encryption keys**, not the freestanding ones the current spike uses. This is the check that stops a roster owner substituting a key they control, and it is exactly the part the spike skips.
- **Carrier binding on roster-wrapped replies** (extension §4.1).
- **The real fetch cost**: N identity-document fetches and pins per reply.

Worth putting to the owner early: **is the roster the right shape at all?** It was inherited from a prototype built when the audience was assumed secret. The owner has since chosen a hidden audience for association-graph reasons, so the constraint stands — but "encrypted chained roster" was never independently derived, only inherited.

### 2.2. Interoperability — your headline; see §3

### 2.3. Key delegation extension (`open-feed-delegation.md`, planned, not drafted)

The highest-value trust upgrade available. A delegation is a statement signed by a root identity key — `{delegate: {JWK}, kid, exp, scope}` — published in the identity document; a hub or extra device holds only the *delegated* key while the root stays client-side or offline. The pinned chain is exactly the revocation substrate whose absence killed Nostr's NIP-26.

Two constraints from prior sessions that must survive into the draft:

- **`scope` must fail closed.** An unrecognized scope grants nothing. (This was a real finding from an earlier review of a now-deleted extension; the reasoning carries over.)
- **Delegation interacts with the exit story.** §4.5 requires the recovery key to be device-generated and never transmitted. A delegation design that lets a hub-held delegate touch anything exit-related would silently undo that. Check explicitly.

Related: `CLAUDE.md`'s open question on **split custody** (hub holds the signing key, client holds only the encryption key). Attractive product pattern, deliberately *not* claimed in the spec, because its guarantee holds only when the client is not distributed by the custodian — which the reference product does not satisfy. Delegation is where that tension resurfaces.

### 2.4. Export bundle: specified, unbuilt, load-bearing

§15 defines it and Level 3 MUSTs it. `DISTRIBUTION-MODEL.md` now requires it at launch. Nobody has built one and no vector exercises it. Worth an early sanity pass: is the shape right, does "byte-verbatim as published" survive a real implementation, and what happens with a 10 GB family photo archive?

### 2.5. Smaller deferred items

- `_rel` type registry governance pre-1.0.
- External time anchoring (transparency log / witness network) beyond the family-scale `pins` convention.
- Whether content warnings / moderation need anything at the protocol level (currently: barely addressed).

## 3. Interoperability — the focus area

The largest genuinely unaddressed part of the project. Today it is **Appendix F**: one page, three sketches, no normative text. The owner wants it taken seriously this session.

### 3.1. Where it stands

Appendix F states the honest frame and little else: bridges are **trusted intermediaries, never transparent adapters**, because each target protocol has a different trust primitive and no bridge can hold a foreign author's Open Feed key. A gateway may (1) ingest foreign content as an `_unverified` copy (§7.5), (2) sign a claim *about* it under its own identity, or (3) proxy the foreign actor as a gateway-hosted Open Feed identity with disclosed key custody. All three are the §14.2 honest-hub-trust model extended across a boundary.

Sketched targets, ascending difficulty:

- **Webmention / IndieWeb** — cheapest, half-built. Outbound rides on published h-entry HTML; inbound synthesizes `_unverified` items from mf2. No core changes. Named as the place to start.
- **ActivityPub** — the brid.gy model: a stateful actor proxy polls the feed and fans out `Create`/`Like`/`Announce`, mirroring AP replies into the inbox. The one real convergence seam is **FEP-8b32** (`eddsa-jcs-2022` = Ed25519 over RFC 8785 — *the same primitive Open Feed already uses*), where a near-transparent object-level bridge becomes conceivable.
- **atproto** — heaviest: a mirror PDS (DID + DAG-CBOR + MST), no transparent path. The clean seam is **did:web ↔ Open Feed URL**, both domain-bound.

### 3.2. What v0.2.0 changed that interop has not caught up with

**This is the part nobody has thought through, and it is why interop is timely rather than merely next.** Four things moved under Appendix F's feet:

1. **The identity document changed shape** — `feed` + `manifest` + `feeds` collapsed into one `feeds` array of `{url, manifest?, rel}` (§3.2.1), and `history` became an index. Any bridge that discovers feeds from an identity document is reading a different document than Appendix F assumed.
2. **Encrypted content exists** (§11.3). What does a bridge do with an item it cannot read? Skipping it silently is an omission a completeness proof would otherwise catch; forwarding ciphertext is meaningless to the target network; announcing "there is content here you can't see" may itself be the leak. **No answer is written down.** Probably the sharpest new interop question.
3. **The delivered axis exists** (§11.1). Delivered-only content has no `_feed_url` and appears in no feed or manifest. A polling bridge will never see it, which is correct — but the *rule* should be stated so no bridge author "helpfully" republishes inbox content to a public network.
4. **Exit exists** (§15, §3.4). If a gateway proxies a foreign actor as a gateway-hosted identity, that identity is captive by construction: the gateway holds its keys and there is no device to generate a recovery key on. §4.5 now requires disclosure in exactly this situation. **Check whether Appendix F's option (3) is still conformant as written** — it likely needs an explicit carve-out or disclosure requirement, and that is a real finding if so.

### 3.3. Questions to work through with the owner

- **Which bridge, and how normative?** Appendix F says start with Webmention. Is that still right given the product is a family hub, where ActivityPub reach (relatives on Mastodon) may matter more than IndieWeb correctness? And is the deliverable a normative profile, or a non-normative implementation note?
- **What is the minimum honest bridge?** The `_unverified` mechanism (§7.5) already exists and needs no new machinery. Is a bridge that *only* ingests `_unverified` copies and never proxies identities the right v1 — smaller, honest, impossible to misuse?
- **Does FEP-8b32 actually converge?** Both use Ed25519 over RFC 8785. If the primitive genuinely matches, how close to a transparent object-level AP bridge can you get, and what breaks first — the actor model, addressing, or delete semantics? Deserves real investigation rather than Appendix F's one sentence. Likely blocker: Open Feed binds authorship to an HTTPS identity URL serving a signed document; AP binds to an actor URL with an inline public key. Close enough to tempt, different enough to be dangerous.
- **What does a bridge do about the manifest?** Open Feed's completeness proof has no analog in AP or Webmention, so bridged content loses it. Should bridged content be marked as carrying no completeness guarantee, the way §3.2.1 marks manifest-less feeds?
- **Reverse direction: is Open Feed a good bridge *target*?** Everything above is Open Feed reaching out. Static-hostability plus a single signing construction might make it an unusually good *archival* target for content originating elsewhere. Nobody has considered this.

## 4. Working agreements the owner has established

- **Prototype before committing** to anything cryptographic. Both encryption prototypes exist because the owner refused to reverse a scope decision on argument alone — and adversarial review then found real defects in them. Hold that bar.
- **Adversarial review of unreviewed work.** The pattern that works: draft, then have a fresh agent attack it blind from first principles. v0.2.0's biggest corrections came from exactly that. Everything in v0.2.0 has been through it **once**; `open-feed-encrypted-content.md` has **not** been independently reviewed at all.
- **Honesty over marketing.** The owner repeatedly chose the weaker true claim over the stronger convenient one. Match that: if a mechanism does not deliver what its name implies, say so in the spec text.
- **Simplicity is a real constraint.** The owner's words: *"we don't need to go too far if it will sacrifice any simplicity. The protocol is called 'open feed' after all."* Weigh additions against it.

## 5. Invariants (challenge loudly, don't erode quietly)

1. **One signing construction**, core and extensions: detached JWS, RFC 7797 unencoded payload, Ed25519, over RFC 8785 canonical bytes, signing header *and* payload. Encryption is not a second construction.
2. **One object model** — every content object is a signed JSON Feed item; interactions are items with `_rel`.
3. **Two chains, one pin-and-walk discipline** — identity and manifest, pinned on first observation, walked to the pin thereafter.
4. **Single-valued documents** — no artifact is ever served in audience-varying forms. This is what the deleted extension violated.
5. **The core has no privacy mechanism.** Privacy is a publication decision; confidentiality is an optional extension bounded by recipient key custody.
6. **Exit is three parts that only work together** (§4.5, §3.4, §15). Do not let a design weaken one in isolation.

## 6. Repo map

| File | What it is |
|---|---|
| `open-feed-spec.md` | Normative core, **v0.2.0** |
| `open-feed-encrypted-content.md` | OPTIONAL extension v0.1.0 — **never independently reviewed** |
| `open-feed-conventions.md` | OPTIONAL extension v0.2.0 — follows + pins |
| `README.md` | Human-facing docs, examples, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference product plan (family AI-journaling hub) |
| `CLAUDE.md` | Agent context; carries the "decisions taken" list |
| `tmp/regen.js` | Vector generator + validator + doc cross-check |
| `tmp/enc-prototype.js` | Encrypted item; CLAIM 5 = relay attack and rejection |
| `tmp/circles-prototype.js` | Roster spike — **rollback only, not withholding** |
| `PROPOSALS*.md` | The nine-pass debate record |
| `ENCRYPTED-CONTENT-FINDINGS.md` | Prototype findings, with three corrections marked in place |

**Note on `PROPOSALS*.md`:** these are a *record*, not a plan. Several conclusions were adopted, several rejected with reasons, and pass 9's central "theorem" is false. `CLAUDE.md` and spec Appendix E carry the authoritative outcomes — read those first, and use the proposals only to understand *why* something was decided before reopening it.
