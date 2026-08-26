# Plan: documents, distribution, and interop

**The mechanism.** An example script proves a rule with an assertion, then prints it with `rule()`
(`tools/rule.js`). `tools/spec.js` runs every example in reading order and assembles the printed
rules, under a hand-held list of section headings, into `open-feed-spec.md`; `tools/regen.js`
generates `test-vectors.md` the same way. A rule no script proves is not in the spec. Hand-written
content in the spec is the Summary, §1 Terms, and the headings — nothing else. `node tools/spec.js`
fails on drift; `--write` regenerates.

## What is done

The rewrite session is complete: spec generation, wire-format rename, vocabulary rename, voice
cleanup, structural spec changes, and stale reference cleanup. The spec is 58 rules across 10
sections, generated from examples, verified by two independent readers.

| done | detail |
|------|--------|
| §2–§10 generated | one `rule()` per spec rule, proved by an assertion |
| Wire-format rename | `n`→`number`, `loc`→`location`, `epk`→`ephemeral`, `ct`→`ciphertext`, `sig`→`signature`, `top`→`highest` |
| Vocabulary rename | `fold`→`replay`, `pin`→`checkpoint`, `carrier`→`postBinding`, `split`→`divergence point`, `host`/`identity` verdicts→`tampered`/`contested` |
| Voice cleanup | unified to three roles: publisher, reader, hub |
| Structural | §8.7 CORS separated from hub autonomy; §7.1 step 8 broken into steps 8–11; adversary named in Summary; §10 `<link rel="alternate">` SHOULD rule added |
| Stale references | ~20 §12/§13/§14 refs rephrased in example `.md` files; GOALS.md section refs removed |
| Dead tooling | `tools/examples.js`, `tools/revert.js`, `_seeds/`, `.out.txt` → `archive/` |
| Contrast | moved to `COMPARISON.md`; weekend-publisher Contrast section removed |

### Interop — complete

Four-protocol bridge in `bridge/`, stdlib-only, 156 tests, no spec changes needed.

| protocol | modules | what it does |
|----------|---------|--------------|
| **ActivityPub** | actor, outbox, webfinger, signatures, inbox, deliver, server | AP Actor, Follow/Undo, signed delivery, WebFinger with AP link |
| **IndieWeb** | webmention; h-card improvements in `src/views.js` | Webmention discovery + outbound sending; `p-author`, `u-in-reply-to`, per-post HTML pages |
| **Nostr** | schnorr, nostr | BIP-340 Schnorr signing (stdlib via ECDH trick), NIP-01 events with NIP-48 proxy tags, NIP-05 serving |
| **AT Protocol** | base58, base32, dag-cbor, did-plc, atproto | DID:PLC creation (P-256), DAG-CBOR encoding, XRPC client with session management |
| **Unified** | unified | One server serving all protocols: WebFinger, NIP-05, AP endpoints, per-post HTML, Nostr event generation |

**Bridge key design.** Each protocol bridge uses its own stable key, not the identity's. This
decouples all protocols from Open Feed key rotation and social recovery. The bridge re-reads the
identity; the protocol-facing identity is unchanged. The bridge IS the protocol identity, backed
by the Open Feed identity.

**No spec changes needed.** All bridges layer cleanly on top of §10. No new rules, no new wire
members, no protocol modifications.

**Integration test** (`test/interop.test.js`) proves: one Open Feed identity with public posts,
a reply, and an encrypted post → WebFinger returns Open Feed + AP + feed links; NIP-05 returns
the Nostr pubkey; AP outbox has 3 public posts with correct `inReplyTo`; Nostr events have NIP-48
proxy tags; per-post HTML has full h-entry microformats; encrypted content never appears in any
protocol; all protocols see exactly the same public posts.

### Live testing — complete

Every question the in-memory bridges could not answer, answered against something real.

**Mastodon.** The legacy `publicKey` PEM works — with **RSA-2048**, not Ed25519. An Ed25519 key in
that field is rejected silently: no error, the Actor simply never verifies. RSA is what
`bridge/actor.js` uses and what works everywhere; FEP-521a (`assertionMethod`/`Multikey`) would
avoid it but only on Mastodon 4.7+, so the base58btc encoder stays unused for now.
`@alice@bridge.jovialpenguin.com` resolves, shows its three posts, and completes Follow → Accept.

**Nostr.** BIP-340 signatures verify against a real relay: event `07b18ad…` accepted by
`relay.damus.io`.

**Bluesky.** App-password auth and the XRPC client work end to end:
`at://did:plc:qwwvkiocc2g7rsvbcj4zsxrs/app.bsky.feed.post/3mtyvq5or3a2m`.

**The origin has to be a real domain.** `trycloudflare.com` is blocklisted by mastodon.social, so a
tunnel cannot stand in for a hostname you control. The bridge runs at `bridge.jovialpenguin.com`;
`deploy/` holds the Dockerfile and the reverse-proxy configuration.

**Feed readers.** Both generated views subscribe and render in NetNewsWire — `feed.json` as JSON
Feed and `feed.xml` as Atom.

**DID:PLC.** Validated against `plc.directory` without registering anything. The encoder reproduces
the digest inside the published CIDs of real genesis operations; the derivation re-derives their
`did:plc` identifiers; three real signatures verify over our encoding of the unsigned operation,
which also pins the signature format as unpadded base64url over raw r||s; and `p256DidKey`
reproduces a real P-256 rotation key string exactly. Each is a fixture in `test/atproto.test.js`.
Posting a well-formed operation with a deliberately corrupted signature draws
`400 Invalid signature on op` with the operation echoed back fully parsed — so the schema and the
`did:key` encoding are accepted and only the signature, the part broken on purpose, is refused.

**No DID was created.** `plc.directory` is append-only: an identifier can be tombstoned but never
removed, and nothing here runs a PDS to serve the repo one would name. The `fetch` in `publishDid`
is the only line of the path never run against a success.

**Three defects the live test exposed**, all fixed:

1. `bridge/dag-cbor.js` sorted map keys by byte value; AT Protocol uses the RFC 7049 canonical rule,
   shortest key first. The two orderings disagree completely for a PLC operation's keys, so every
   `did:plc` this code could have minted was a different identifier than the one its own signature
   covered. The test that should have caught it compared the keys `a` and `b` — same length.
2. The AP inbox never read its request body off the socket, so a real Follow returned 500 and no
   Accept was ever delivered. Nothing drove HTTP into the inbox; every test called the handler with
   an already-parsed activity.
3. Every restart minted a fresh identity and AP key, which is unusable once a remote instance has
   cached the Actor. `bridge/state.js` persists the keys, the hub's files, and the follower list.

None of the three was reachable from in-memory tests. That is the argument for this section.

## What remains — in order

### 1. The document layer: README, TLDR, and the spec Summary

The README is the first thing anyone sees — it is the natural home for the concise explanation of
the protocol. TLDR.md's content moves to the README's opening sections; `tools/tldr.js` adapts
to check those sections instead (same budgets: ≤200 words "how it works", ≤100 words "what it
guarantees", ≤10 glossary terms). `npm run check` keeps the gate.

**README.md — full rewrite.** The current README has a stale-content banner and describes the old
protocol (identity as a URL, `openfeed.json`, manifests, JOSE, conformance levels). Rewrite layered
for two audiences — curious people first, then developers:

*Opening sections (budget-checked, absorbs TLDR):*
- How it works (≤200 words)
- What it guarantees (≤100 words)
- Glossary (≤10 terms)

*Developer section (no budget):*
- Architecture: profile + index + posts, signed files, the encryption model
- The threat model: the adversary is a loved one who controls the family hub
- Publisher/reader/hub roles; a static file server is a conforming hub
- WebFinger for discovery; JSON Feed and Atom for interop; the bridge
- `npm run check`, the example contract, how to add a rule
- Reference the spec for definitions, examples for explanations

### 2. DISTRIBUTION-MODEL.md — phased rewrite

The current document (20K words) describes a family journaling app with AI assistance built on the
**old** protocol. It has a stale-content banner. The product vision is current; the technical
architecture is not. Phase the rewrite to respect the owner-document constraint:

1. Structural outline (section headings + one-sentence summaries) → owner approves
2. Technical sections (low owner-sensitivity): publish interface, encryption, views, checkpoints
3. Product/vision sections (need owner voice): onboarding, AI assistant, business model, privacy
4. Integration pass: update spec references, remove stale machinery

**This is an owner document.** Agents may edit it, but must clarify changes with the owner first —
especially product vision, business model, or privacy guarantees.

### 3. GOALS.md — rewrite

The five "Still open" questions are all resolved by the completed spec:
1. Publish interface → signed PUT to conventional paths (§8)
2. Encryption construction → per-recipient slots, audience inside (§6)
3. Recovery peer count / trust set → recovery list, never published (§3)
4. "Head" file shape → the index IS the head (§4)
5. Second implementation → the weekend capstones exist

Rewrite from a speculative document to a descriptive statement of what the project accomplishes
and why. Keep the owner's values and scenarios; update the framing from "what we're deciding" to
"what we decided and why."

## Verification

After each batch of changes:
```
npm run spec -- --write
npm run vectors -- --write   # after any change to signing, document shape, or the envelope
npm test
```

Final: `npm run check` (tests + vectors + whatever word-budget gate survives).

## Traps

- `tools/spec.js --write` rewrites all of `open-feed-spec.md` and `tools/regen.js --write` all of
  `test-vectors.md`. Anything hand-typed into either is lost on the next `--write` — edit the
  `rule()` in the script instead.
- `GOALS.md` is the owner's document. Do not edit without an instruction that names the file.
- `DISTRIBUTION-MODEL.md` is an owner document. Agents may edit it, but must clarify changes with
  the owner first — especially product vision, business model, or privacy guarantees.
- The `n` → `number` rename taught a lesson: a batch script that renames wire-member patterns
  (`{n:`, `.n`) misses function parameters and callback variables that carry the same name. Verify
  every example runs (`npm run spec`) before declaring a rename done.
- The AP bridge uses Ed25519 with the legacy `publicKey` PEM format. Mastodon 4.7+ may require
  FEP-521a for Ed25519. Test against a real instance before committing to one format.
