# Fact-check: `## Contrast` sections of eight examples (the-reader, fetching, publish-interface, moving, your-copy, views, weekend-reader, weekend-publisher)

Read-only audit, 2026-08-25. Every claim about an outside system was checked against a primary source
(spec text, RFC, vendor docs, project security advisories) — sources are named per item. Claims about
Open Feed itself were checked against `open-feed-spec.md`. Ordered by severity. Items marked CORRECT
get one line.

Verdict key: WRONG · MISLEADING · OVERSTATED · UNVERIFIABLE · CORRECT (simplified-but-fair is noted as
CORRECT with a parenthetical).

---

## 1. Wrong or stale (fix these)

### 1.1 `examples/views/views.md:92-93` — WRONG (stale, internal)
> "`README.md` in the repo root still describes that design — it is queued for rewrite in `PLAN.md`, so read it for the contrast and not as current."

The README was rewritten (`PLAN.md:139`, commit `8f2054b`). The current README mentions the
`_openfeed`/`_sig` design only as archived history (`README.md:540`). Suggested wording: "That design
is preserved verbatim in `archive/` (`archive/README.md` is the index); read it there for the
contrast." This is the only claim in the eight files that is flatly false today.

### 1.2 `examples/weekend-publisher/weekend-publisher.md:60` — MISLEADING (date)
> "**Compare-and-swap over `If-Match` and `ETag`** is a 1999 mechanism"

`ETag` (§14.20) and `If-Match` (§14.25) are in RFC 2068, January 1997 (rfc-editor.org/rfc/rfc2068).
RFC 2616 (June 1999) is the revision, not the origin. `publish-interface.md:128-129` says "RFC 2616,
1999; now RFC 9110", which is defensible as "the RFC most people cite", but "a 1999 mechanism" is
just off by two years. Suggested: "a 1997 mechanism (RFC 2068, then 2616, now RFC 9110 §13.1.1)".

### 1.3 `examples/views/views.md:105-107` and the template `examples/signed-file/signed-file.md` — MISLEADING
> "**ActivityPub** goes the opposite way: ... interop means agreeing about ActivityStreams types, JSON-LD contexts, and — for signing — RDF dataset canonicalization before there are any bytes to sign at all."

The ActivityPub spec (w3.org/TR/activitypub) does not require Linked Data Signatures; it mentions
them once, as one option "if ... being used". In practice fediverse signing is HTTP Signatures over
the request (Mastodon: "requires the use of HTTP signatures", and as of 4.5 RFC 9421). Mastodon's own
docs say LD Signatures "are not used widely within Mastodon" and "it is not advised to implement
support for LD Signatures" (docs.joinmastodon.org/spec/security). So "for signing — RDF dataset
canonicalization" describes a niche, deprecated path as if it were the interop requirement. The same
sentence appears in the signed-file template's Contrast, so this is inherited. Suggested: "and, for
the one object-level signature scheme it ever had (Linked Data Signatures, now deprecated even by
Mastodon), RDF dataset canonicalization; day-to-day the fediverse authenticates the HTTP request, not
the object, which is why an object cannot be re-verified once it has left the wire." That last clause
is actually a stronger point for Open Feed than the current one.

---

## 2. Overstated (true in spirit, too strong as written)

### 2.1 `examples/publish-interface/publish-interface.md:107-110` — OVERSTATED
> "Micropub, the Mastodon API and AT Protocol's `com.atproto.repo.*` all put an authorization layer between a client and a repository: an app registration, an OAuth flow, a bearer token with a lifetime, a scope model, a refresh path, and revocation."

"All" plus that six-item list is not true of each system:
- Micropub/IndieAuth: bearer token + scopes, yes (micropub.spec.indieweb.org). But IndieAuth
  explicitly has **no app registration** ("Client registration at the authorization endpoint is not
  necessary, since client IDs are resolvable URLs") and refresh tokens are "at the discretion of the
  authorization server" (indieauth.spec.indieweb.org).
- Mastodon: app registration (`POST /api/v1/apps`) and OAuth, yes; the client-token guide does not
  describe token expiry or refresh (docs.joinmastodon.org/client/token). Mastodon access tokens are
  long-lived by default.
- AT Protocol: `createSession` gives a short-lived `accessJwt` plus `refreshJwt`, and OAuth is now
  primary (atproto.com/specs/xrpc) — this one fits the whole list.
The point (a server-issued credential sits between client and store) is right for all three.
Suggested: "all put an authorization layer between a client and a repository — some mix of app
registration, an OAuth flow, bearer tokens, scopes, refresh and revocation".
`weekend-publisher.md:53-55` makes the same comparison with the softer "a token, a scope, a refresh, a
server that decides who you are", which is fine.

### 2.2 `examples/the-reader/the-reader.md:123-127` — OVERSTATED
> "Signal's 'safety number changed' ... is deliberately binary ... Open Feed adds one state Signal has no need for, `host`, because Open Feed's serving path is untrusted by design and a hub can withhold and roll back where a Signal server cannot rewrite a ratchet."

The binary-notice half is fair: Signal shows a single in-conversation notice and (since the
"advisory mode" change) lets you continue (signal.org/blog/safety-number-updates; support article
360007060632). The last clause is the problem. Signal's server is *also* untrusted by design — a
safety-number change is precisely the detector for a server substituting keys — and it can withhold
messages just as a hub can. What it cannot do is *roll back* a conversation, because there is no
shared, re-fetchable history for it to serve an older version of. Suggested: "because Open Feed's
reader re-fetches a history a hub could withhold or roll back, while a Signal server relays messages
it cannot replay or reorder into an earlier state."

### 2.3 `examples/your-copy/your-copy.md:109-110` — OVERSTATED (mildly)
> "account migration between PDSes is a supported, working operation rather than a promise."

It works and is documented with tooling (atproto.com/guides/account-migration), but the guide says
"these specific mechanisms are not a formal part of the protocol, and may evolve", and the easy path
assumes both PDSes participate; an offline/uncooperative old PDS is a listed harder case with possible
data loss. Suggested: "a documented, working operation" (drop "supported", which reads as "in the
spec").

### 2.4 `examples/the-reader/the-reader.md:117-119` — OVERSTATED (vocabulary)
> "**PGP's trust levels** — unknown, none, marginal, full, ultimate, plus separate validity"

GnuPG's named values are unknown, undefined, never, marginal, full, ultimate (plus expired/revoked/err
on the validity side) (gnupg.org/documentation/manuals/gnupg/Trust-Values.html). "None" is not one of
them; "never" is the nearest. The lattice-collapse claim ("almost nobody ever set the values") is
opinion and I did not find a source either way — UNVERIFIABLE but widely believed. Suggested:
"unknown, undefined, never, marginal, full, ultimate".

### 2.5 `examples/fetching/fetching.md:120-124` — CORRECT, one overstatement
> "the protocol says what to fetch and leaves what-not-to-fetch to each implementation"

The SSRF-as-recurring-bug-class claim is well supported: Mastodon GHSA-hcqf-fw2r-52g4 /
CVE-2023-42450 (SSRF to RCE via WebFinger), GHSA-xfrj-c749-jxxq / CVE-2026-22245 (missing IP ranges,
Jan 2026), GHSA-xx55-4rrg-8xg6, GHSA-crr4-7rm4-8gpw (IPv6 `::` bypass, May 2026),
GHSA-vwhj-3g83-v276 (IPv4-compatible IPv6, Jul 2026). Note the last three are exactly the
embedded-IPv4 cases §9 spells out — worth citing. The one nit: ActivityPub §B.3 does say localhost
fetches "can be dangerous" and suggests scheme allow-listing, so "leaves what-not-to-fetch to each
implementation" is slightly strong; "offers a sentence of advice and leaves the list to each
implementation" is exact.

---

## 3. Correct (one line each, with the source checked)

- `the-reader.md:109-114` TLS interstitial vocabulary and single "Advanced" click-through — CORRECT; Akhawe & Felt, USENIX Security 2013, 70.2% click-through on Chrome SSL warnings.
- `fetching.md:108-116` DNS rebinding mechanics, TTL/second-answer/cache-expiry windows, check-the-resolved-address-at-connect — CORRECT (matches §9 and CWE-918 literature).
- `fetching.md:116` "`localtest.me` resolves to `127.0.0.1`" — CORRECT; the whole zone and wildcards point at 127.0.0.1 (blogs.iis.net/owscott).
- `fetching.md:124-127` Pingback used for reflected DDoS and internal port-scanning — CORRECT; Sucuri, March 2014, 162k WordPress sites; Bitdefender/Trustwave on internal scanning.
- `fetching.md:134-135` CGNAT (`100.64/10`), `0.0.0.0`, 6to4 `2002::/16` embedding — CORRECT; RFC 3056 embeds V4ADDR in `2002:V4ADDR::/48`.
- `publish-interface.md:131-133` conditional PUT less widely implemented; object stores only recently grew it — CORRECT; S3 added `If-Match` on PUT in November 2024 (aws.amazon.com whats-new 2024/11).
- `publish-interface.md:133` CDNs rewrite/weaken `ETag` — CORRECT; Cloudflare converts strong to weak or strips them depending on compression and Rocket Loader/Email Obfuscation (developers.cloudflare.com/cache/reference/etag-headers).
- `moving.md:78-81` Mastodon: `alsoKnownAs` on the new account, `Move` issued from the old one, followers move, posts do not — CORRECT (docs.joinmastodon.org/user/moving: "Your posts will not be moved"). `Move` is an ActivityStreams 2.0 activity type, not defined by ActivityPub itself; "Mastodon / ActivityPub" as a label is fine.
- `moving.md:83-86` did:plc is a directory, rotation-key holder can repoint without the PDS, did:web is a domain — CORRECT (web.plc.directory/spec/v0.1/did-plc; w3c-ccg did-method-web).
- `moving.md:89-92` 301 is served by the host you left; §9 refuses cross-origin redirects — CORRECT (spec §9).
- `your-copy.md:95-97` GDPR Art. 20 is a right against a controller — CORRECT.
- `your-copy.md:98-100` Mastodon archive: request in Settings, once every 7 days, ActivityStreams 2.0 JSON, server-generated — CORRECT ("tar" is right: Mastodon ships `archive-*.tar.gz`; the docs page does not name the container, so UNVERIFIABLE from the page alone).
- `your-copy.md:101-102` X data download: request, delay (24-48h+), ZIP of JSON — CORRECT (simplified: files are `.js`-wrapped JSON).
- `your-copy.md:107-113` AT repo is a signed commit over an MST, exported by `com.atproto.sync.getRepo` as CAR, DAG-CBOR vs JSON API — CORRECT (atproto.com/specs/repository; the spec now calls the encoding "DRISL CBOR", a DAG-CBOR subset — fine).
- `your-copy.md:119` MST gives efficient sync and proofs of absence — CORRECT (atproto docs: proofs of inclusion and non-inclusion).
- `views.md:99-100` JSON Feed items must carry `content_html` or `content_text` — CORRECT (jsonfeed.org/version/1.1: "one or both must be present").
- `views.md:107-110` microformats: the HTML page is the data — CORRECT.
- `weekend-reader.md:74` "49 vectors" — CORRECT (`node tools/regen.js`: "all 49 vector checks hold").
- `weekend-reader.md:85-87` 200-line kill criterion — CORRECT as measured (non-blank, non-comment lines above the `// ====` marker; reader.js has 236 raw lines above it, so the measurement method matters and the .md should say "non-blank, non-comment" once).
- `weekend-publisher.md:70-71` "a hub in eleven lines" — CORRECT (the demo says so at `weekend-publisher.js:115`; not independently counted).

---

## 4. Open Feed claims in these sections vs the spec

All checked; none contradict `open-feed-spec.md`:
- "eleven steps in an order the spec makes normative" (`the-reader.md:7,22`) — §7.1-§7.5 number 1-11. CORRECT.
- Three verdicts, notes on ok (`the-reader.md:8-10`) — §7.3 verbatim. CORRECT.
- "§4.2 for the one verdict charged to the wrong party" — §7.3's table says exactly that. CORRECT.
- Resolved-address check before connect; leading-zero quads refused; 5 redirects same-origin (`fetching.md`) — §9. CORRECT.
- "transport failure is a thrown `FetchError` with no verdict field" — `src/fetch.js:22-26` has `code/url/status/transient`, no verdict. CORRECT.
- `loc` in public replies is the relocation path (`fetching.md:154-156`, `moving.md:94-97`) — §3.7. CORRECT.
- Static hosting is a conforming hub; preflight + expose `ETag` for writers (`publish-interface.md:146-148`, `weekend-publisher.md:61-63`) — §12, §8.7. CORRECT.
- No DELETE verb, no retained versions, no permanent deletion record (`weekend-publisher.md:65-66`) — §8.8. CORRECT (spec: "an app MUST NOT tell a user that withdrawing erased anything").
- Keep-the-bytes is a publisher MUST; serve-exact-bytes is a hub MUST (`your-copy.md:91-93`) — §12, §8.7, §10. CORRECT.
- Signed private message provable by recipient forever (`your-copy.md:126-128`) — §5.6. CORRECT.
- §13.1 "makes it a MUST" (`your-copy.md:80`) — §13.1 has one MUST NOT (no marketing encryption as protection from the operator). CORRECT.
- "MUST NOT treat a view as evidence" (`views.md:111`) — §11 verbatim. CORRECT.
- `GOALS.md` priority 1 = no dependencies, 2 = weekend (`weekend-reader.md:78-79`) — `GOALS.md:34-36`. CORRECT.
- "the reader's `why` strings distinguish a dozen" (`the-reader.md:132`) — `src/reader.js` composes `why` from several helpers; I did not enumerate the distinct strings. UNVERIFIABLE as a count; harmless.

---

## 5. Style: first person, tone drift from `examples/signed-file`

- **First person:** none in prose. Every "I" is inside the quoted note `no index I can verify`, which is spec vocabulary (§7.3).
- **Template shape:** signed-file's Contrast is one framing sentence, a bulleted list of four systems each with a one-clause verdict, and a closing "the trade Open Feed makes" paragraph — about 20 lines. Drift, most to least:
  - `fetching.md:105-156` is five bold-led paragraphs (~50 lines). Only the second is a contrast with other systems; the first is a threat explainer, the third and fourth restate §9's own rationale, and the fifth is a scenarios map that other examples put under `## Scenarios`. Recommend keeping the SSRF/Pingback/ActivityPub paragraph as the Contrast and moving the rest up into "What the output shows" or a `## Scenarios` heading.
  - `publish-interface.md:105-153` similar: five paragraphs, of which "Bring-your-own-client", "Squatting" and "Static hosting" contrast nothing external.
  - `your-copy.md:83-137` five paragraphs; "The uncomfortable half" and "Scenarios" are not contrasts.
  - `views.md:88-104` opens with project archaeology ("Earlier drafts of this project did the other thing ... What went wrong with it is instructive") — sixteen lines on a superseded design. `CLAUDE.md` bars that from the spec, not from examples, but the template's version of the same move is one clause ("Open Feed's earlier drafts used exactly this ... the header disappeared when ...") and that is the right length.
  - `moving.md` matches the template well (bullets, one system per bullet, closing paragraph). `weekend-reader.md` and `weekend-publisher.md` are short and honest that their contrast is internal.
- **Register:** `fetching.md:141` "becomes an accusation against somebody's aunt" and `publish-interface.md:151` "the operator being the ex at scale" are more colloquial than the template, but consistent with `GOALS.md`'s voice. Not flagged.

---

## 6. Not found in these eight files

The brief lists Matrix, Nostr, IPFS, git, RSS/Atom internals, WebSub, Tor, Bridgy Fed, Solid and `Content-Length`. None of the eight Contrast sections (or the rest of these eight .md files) make claims about them, so there was nothing to check. Nostr and JWS/JCS claims live in the signed-file template and were only checked incidentally (Nostr: NIP-01 id is sha256 of a serialized array with its own seven-character escape table — the template's sentence is CORRECT).
