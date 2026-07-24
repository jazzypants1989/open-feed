# Hand-off: Open Feed — remaining questions

> Paste this whole file to a fresh agent as its opening prompt. It is written to be
> self-contained. The human (repo owner) will work **with** you — this is collaborative,
> not fire-and-forget.

---

You are picking up the **Open Feed Protocol** in `/Users/jessepence/repos/open-feed`. The core spec
is `open-feed-spec.md`; two OPTIONAL extensions are drafted, `open-feed-conventions.md` (follows +
pins) and `open-feed-encrypted-content.md`. `README.md`, `DISTRIBUTION-MODEL.md`, and `CLAUDE.md`
all match as of this writing.

## 0. Read this before you touch a version number

Everything is **v0.1.0, unreleased**. Nothing here has had a reader outside this repository and
nothing implements it. An earlier `CLAUDE.md` rule said "update the version number on any normative
change," so every editing session bumped it — producing a "0.2.0" whose own first line claimed to
be "the second public draft" of a document nobody had read. That was renumbered back and the rule
was replaced.

**Record changes in spec Appendix E and in `CLAUDE.md`. Do not move the version number.** It moves
at a release someone outside this repo can depend on, and there has not been one. The body of work
formerly called "v0.2.0" is now referred to by name — *the privacy-and-exit pass* — which is also
what the branch is called.

## Your mandate — question everything

This hand-off is a set of *suggestions*, not a spec of your work. The owner has explicitly asked,
across sessions, that you:

- **Challenge what's here.** The strong, opinionated calls (deleting an entire extension, adding an
  exit story, reversing a scope boundary on encryption) were argued, but arguments can be wrong. A
  well-reasoned "this is wrong here" beats faithful implementation of a flaw. `CLAUDE.md` has a
  "Decisions taken — do not relitigate without new information" list; *new information is exactly
  what you should hunt for.*
- **Hunt for missed connections.** These documents interlock, and the best findings in this
  project's history came from noticing that a rule in one document had unnoticed consequences in
  another. The two most recent findings were both of that kind — see §1.
- **Ask the owner as many questions as you like**, including ones this hand-off never raises. The
  owner *wants* questions and has said so repeatedly. Do not ration them. Propose, then write.

The invariants in §5 are the one thing not to discard casually — but even those are open to
challenge with a real argument; flag an invariant-level change loudly and get explicit buy-in.

## Step 0 — Orient before doing anything

1. Read `open-feed-spec.md` in full, then `open-feed-encrypted-content.md`,
   `open-feed-conventions.md`, and `CLAUDE.md`. Skim `README.md` and `DISTRIBUTION-MODEL.md`.
2. Run `node tmp/regen.js`. It regenerates and self-verifies core Appendix D and conventions
   Appendix C, **and** reads both published docs to confirm every vector string appears verbatim.
   It exits non-zero on failure. That script is your signing/canonicalization reference.
3. Run `node tmp/enc-prototype.js` (CLAIM 5 is the ciphertext-relay attack and its rejection) and
   `node tmp/circles-prototype.js` (rollback only — see §2.1).
4. Read spec **Appendix E**. Several questions you might be tempted to reopen are answered there.
5. **Do not start drafting.** Confirm priority order with the owner, then present a short design
   proposal and get their calls before writing normative text.

## 1. What the last two sessions settled

**The privacy-and-exit pass.** Two facts drove it, and you should hold both. *The threat model:* the
operator of a family hub may be a loved one who is an abuser — an adversary controlling the serving
path, the inbox, and by default the keys. No confidentiality mechanism defeats them; what the
protocol offers is **exit** (§4.5 device-generated recovery key, §3.4 uncooperative migration, §14
export bundle — three Level 3 MUSTs that only work together). *The missing persona:* two
self-hosting family members, the modal case for a URL-native protocol, which makes cross-hub
`family` visibility a launch requirement answered by **published + encrypted**, not by an
authorization gate.

**Receiver-side republication (§11.1.1).** Extension §7 routes group interactions down the
*delivered* path so the reply graph never lands in a world-readable file — but core §12 defines a
world-readable projection of the inbox and did not say what it may contain. A hub implementing both
would publish exactly the graph the extension exists to hide. Fixed by one rule: **publication is
the author's decision, and only the author's**; a receiver holds a delivered item as a *custodian,
not an author* and MUST NOT place it in any publicly-readable artifact.

**Interoperability (Appendix F, rewritten).** Net effect: **no new fields, and one branch of a MUST
deleted.** Details in `CLAUDE.md`; the parts that matter here:

- **FEP-8b32 does not converge.** Earlier drafts claimed it did, in three files. Same curve and
  canonicalization, different signing input; no signature crosses in either direction.
- **The OR in §7.5 is gone.** Everything ingested is `_unverified`, without exception. That single
  deletion collapsed the three-lane trust structure and dissolved a conformance collision with §12.
- **One organizing rule:** *a gateway may not change the terms under which content was published* —
  not the **audience**, not the **durability**, not the **verification status**. Symmetric in both
  directions. That is the test for any future protocol.
- **Appendix F.1 is the actionable part.** The cheapest interop is not a bridge at all.

**The simplification pass (most recent).** Triggered by a comparison against IndieWeb / ActivityPub /
atproto / Nostr asking how much unique utility the core provides. Net: **four core document types
instead of six, one fewer endpoint**, and the guarantee claimed against a key-holding host became
true rather than nearly true. Spec Appendix E.1 has the full table; the parts that matter here:

- **History-index documents are gone.** Prior versions live at a derived URL — strip `.json`, append
  `/{seq}.json` (§5.4). The index's hashes carried no authority by its own admission.
- **Every listed feed is manifested** (§3.2.1). Paid for by §9.2: a manifest MAY advance on a
  *cadence* rather than per publication, so version count tracks time, not activity.
- **The manifest commits `[version, hash]`**, not just a version. A version-only manifest is fully
  sufficient against a serving-path attacker and *undetectably* insufficient against a key
  custodian, who can sign one `(id, version)` as two different things for two readers and produce
  byte-identical manifests. That was a false claim in §13.2, not a missing nicety.
- **Pinning is a Level 1 MUST** (stateless-verifier carve-out stated), and the **compare rule is
  core** (§5.3.1). It had been living in an optional extension while the whole transparency claim
  rested on it.
- **The replies endpoint moved to conventions §6**, carrying §11.1.1's guard with it.
- **Exit had two holes, both closed.** `_rel` targets dangled across a migration (§3.4, §10.2), and
  §4.5's device-generated recovery key could be honored to the letter and defeated in full by a host
  that equivocates on the *genesis* document — the member's own view stays correct, so §5.2's
  self-record sees nothing. Level 3 now MUST disclose the genesis `(seq, hash)` and recovery-key
  fingerprint for out-of-band comparison. **Exit's root of trust is a TOFU event the adversary
  mediates**; that is the thing to keep in view.

## 2. The open questions, in rough priority order

The owner sets priority; this is a starting proposal.

### 2.1. Circle rosters are specified but NOT shippable — the live gap

`open-feed-encrypted-content.md` §6 specifies rosters; §6.2 says plainly they must not ship yet.
This blocks **group replies to encrypted family content** — the one thing the chosen design cannot
do. Cross-hub family *posts* work; cross-hub family *replies* do not.

Before rosters can be offered, a second prototype must model:

- **Withholding, not just rollback.** `tmp/circles-prototype.js` tests rollback (host serves a stale
  roster) and passes. The real attack: a host simply **declines to serve the newest version** to a
  chosen replier, and pin-and-walk cannot distinguish that from "no new version exists." §6.1
  proposes that a member seeing others cite a higher `seq` treats it as a compromise signal — that
  needs testing and may not be enough.
- **Identity-document-published encryption keys**, not the freestanding ones the spike uses. This is
  the check that stops a roster owner substituting a key they control, and it is exactly what the
  spike skips.
- **Carrier binding on roster-wrapped replies** (extension §4.1).
- **The real fetch cost:** N identity-document fetches and pins per reply.

Worth putting to the owner early: **is the roster the right shape at all?** It was inherited from a
prototype built when the audience was assumed secret. The owner has since chosen a hidden audience
for association-graph reasons, so the constraint stands — but "encrypted chained roster" was never
independently derived, only inherited.

### 2.2. Bridge profiles — now cheap, and possibly unnecessary

The framework and the template exist (Appendix F.2, F.5), so a profile is a filled-in table rather
than a fresh trust argument. **But do F.1 first.** An Atom mirror discoverable from the identity
page, plus an h-card, is enough for a third-party service such as Bridgy Fed to bridge a site into
the fediverse — no gateway operated, nothing in this repo implemented, and the bridged handle is
`@yourdomain.com`, which is already the identity URL. For the product's actual requirement
("relatives on Mastodon") that may be the whole feature, in which case the Webmention profile stops
being the starting point and becomes optional.

### 2.3. Key delegation extension (`open-feed-delegation.md`, planned, not drafted)

The highest-value trust upgrade available. A delegation is a statement signed by a root identity key
— `{delegate: {JWK}, kid, exp, scope}` — published in the identity document; a hub or extra device
holds only the *delegated* key while the root stays client-side or offline. The pinned chain is
exactly the revocation substrate whose absence killed Nostr's NIP-26.

Three constraints that must survive into the draft:

- **`scope` must fail closed.** An unrecognized scope grants nothing.
- **Delegation interacts with the exit story.** §4.5 requires the recovery key to be
  device-generated and never transmitted. A design letting a hub-held delegate touch anything
  exit-related silently undoes that. Check explicitly.
- **Delegation is where split custody resurfaces** (`CLAUDE.md` open question): attractive product
  pattern, deliberately not claimed, because its guarantee holds only when the client is not
  distributed by the custodian — which the reference product does not satisfy.

### 2.4. Export bundle: specified, unbuilt, load-bearing

§14 defines it and Level 3 MUSTs it. `DISTRIBUTION-MODEL.md` requires it at launch. Nobody has built
one and no vector exercises it. Is the shape right, does "byte-verbatim as published" survive a real
implementation, and what happens with a 10 GB family photo archive?

### 2.5. Author-side dual signing (parked, Appendix H)

A publisher's client emitting both an Open Feed `_sig` and a foreign-format signature (FEP-8b32)
over the same Ed25519 key — the only known route to *verified* cross-protocol authorship. The two
signing inputs are structurally unconfusable, so it is technically clean. It is also a second
signing construction in all but name, which §6.1 forbids. Taking it up means deciding whether that
invariant governs *this protocol's artifacts* or *everything an Open Feed publisher signs*. Parked
deliberately; not blocking anything.

### 2.6. Smaller deferred items

- `_rel` type registry governance pre-1.0.
- External time anchoring (transparency log / witness network) beyond the family-scale `pins`
  convention.
- Whether content warnings / moderation need anything at the protocol level (currently: barely
  addressed).

## 3. Working agreements the owner has established

- **Prototype before committing** to anything cryptographic. Both encryption prototypes exist
  because the owner refused to reverse a scope decision on argument alone — and adversarial review
  then found real defects in them. Hold that bar.
- **Adversarial review of unreviewed work.** Draft, then have a fresh agent attack it blind from
  first principles. The biggest corrections came from exactly that.
  **`open-feed-encrypted-content.md` has still never been independently reviewed**, and neither has
  the rewritten Appendix F.
- **Honesty over marketing.** The owner repeatedly chose the weaker true claim over the stronger
  convenient one. If a mechanism does not deliver what its name implies, say so in the spec text.
- **Simplicity is a real constraint.** The owner's words: *"we don't need to go too far if it will
  sacrifice any simplicity. The protocol is called 'open feed' after all."* The interop work above
  is the model: it ended with *fewer* primitives than it started with. Prefer solutions that delete.

## 4. Invariants (challenge loudly, don't erode quietly)

1. **One signing construction**, core and extensions: detached JWS, RFC 7797 unencoded payload,
   Ed25519, over RFC 8785 canonical bytes, signing header *and* payload. Encryption is not a second
   construction. (Author-side dual signing, in section 2.5 of this hand-off, is the live question at
   this boundary.) Likewise **one hashing rule**: base64url SHA-256 of a document's full published
   canonical bytes, signature fields included — `prev`, manifest item commitments, `checkpoint_hash`,
   and pins are all the same value (§5.1).
2. **One object model** — every content object is a signed JSON Feed item; interactions are items
   with `_rel`.
3. **Two chains, one pin-and-walk discipline** — identity and manifest, pinned on first observation,
   walked to the pin thereafter, with **the compare rule (§5.3.1) applied to any second observation**.
   Pinning without comparing is evidence collected and discarded, which is why both are core MUSTs.
4. **Single-valued documents** — no artifact is ever served in audience-varying forms. This is what
   the deleted restricted-feeds extension violated.
5. **The core has no privacy mechanism.** Privacy is a publication decision; confidentiality is an
   optional extension bounded by recipient key custody.
6. **Exit is three parts that only work together** (§4.5, §3.4, §14).
7. **Publication is the author's decision, and only the author's** (§11.1.1). Receivers and gateways
   are custodians, not publishers.

## 5. Repo map

| File | What it is |
|---|---|
| `open-feed-spec.md` | Normative core, **v0.1.0, unreleased** |
| `open-feed-encrypted-content.md` | OPTIONAL extension — **never independently reviewed** |
| `open-feed-conventions.md` | OPTIONAL extension — follows + pins + the `replies` endpoint |
| `README.md` | Human-facing docs, examples, FAQ |
| `DISTRIBUTION-MODEL.md` | Reference product plan (family AI-journaling hub) |
| `CLAUDE.md` | Agent context; carries the "decisions taken" list |
| `tmp/regen.js` | Vector generator + validator + doc cross-check (also checks manifest↔item hash commitment) |
| `tmp/enc-prototype.js` | Encrypted item; CLAIM 5 = relay attack and rejection |
| `tmp/circles-prototype.js` | Roster spike — **rollback only, not withholding** |
| `PROPOSALS*.md` | The nine-pass debate record |
| `ENCRYPTED-CONTENT-FINDINGS.md` | Prototype findings, with three corrections marked in place |

**Note on `PROPOSALS*.md` and `ENCRYPTED-CONTENT-FINDINGS.md`:** these are a *record*, not a plan.
Several conclusions were adopted, several rejected with reasons, and pass 9's central "theorem" is
false. `CLAUDE.md` and spec Appendix E carry the authoritative outcomes — read those first, and use
the proposals only to understand *why* something was decided before reopening it. Do not renumber or
rewrite them to match later decisions; rewriting a record to match a later decision is the thing
records exist to prevent.
