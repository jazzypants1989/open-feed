# Open Feed — Restricted Feeds (Extension)

**Extension version 0.1.0 — Draft.** Targets the Open Feed core specification **v0.1.0** (`open-feed-spec.md`). This is an OPTIONAL extension; it is not part of the core and MUST NOT be required for core conformance. Pre-1.0, breaking changes are permitted to fix correctness or security defects; after 1.0, changes are additive. RFC 2119 keywords (MUST, SHOULD, MAY, …) apply.

## Abstract

The core protocol assumes every published document is world-readable (`Access-Control-Allow-Origin: *`, core §3.3, §7.1). A **restricted feed** is a feed served only to an audience the owner chooses — a family-only or friends-only feed. This extension specifies how a reader proves control of its Open Feed identity to a serving host (a self-signed, short-lived **fetch assertion**), and how an owner tells the host which readers are authorized (three mechanisms of increasing simplicity: owner-issued **capability grants**, a published **reader list**, and unguessable **capability URLs**).

Restricted feeds are **audience control, not confidentiality.** The serving host reads the content in the clear. Nothing here provides end-to-end encryption; §2 states the limits plainly before anything else.

## 1. Relationship to the Core

This extension adds exactly one thing the core forbids itself: a **second signing construction.** The fetch assertion (§4) is a standard *encoded*-payload EdDSA JWT (RFC 7519), deliberately different from the core's single detached-JWS construction (core §6.1). Quarantining it here is why the core keeps exactly one construction. This extension introduces **no third construction**: the capability grant (§6.2) reuses the core detached-JWS construction unchanged.

Everything else is reuse:

- The reader signs assertions with the **same Ed25519 keys** already published in its identity document (core §4). No new key material, no new key type.
- A restricted feed carries its **own signed, chained manifest** (§7) — the core §9 manifest, gated behind the same authentication as the feed.
- Key resolution, author binding, pinning, revocation, and the SSRF/amplification discipline are the core's (core §5, §6.5, §6.6, §14.5, §14.9), reused verbatim.

A restricted feed is a Level 3 capability (core §13); a Level 3 host serving restricted feeds SHOULD implement this extension.

## 2. Scope and Non-Goals (read this first)

- **Audience control, not confidentiality.** The serving host can read every restricted item. This is the same honest-trust model as the rest of the protocol (core §14.2): a host you rely on to serve content can read that content. If you need the host *not* to read it, you need end-to-end encryption, which is **out of scope**.
- **A malicious host can equivocate across readers — unless the owner opts into public commitments.** Because restricted content is audience-varying by design, a compromised or dishonest host holding the owner's key **can serve different content to different authorized readers**, and this is *softer* to detect than public-feed equivocation (§8.1, §8.2). The per-reader manifest chain catches **rollback** against a single reader; by default it does not catch **cross-reader divergence**, because readers cannot publicly gossip restricted bytes without leaking the content itself. An **existence-public** feed can restore full detection by publishing **self-commitments** (`open-feed-conventions.md` §5, referenced from §8.2); an **existence-private** feed forgoes that and keeps only the per-reader guarantee.
- **CDN caching of restricted responses is unsafe.** A restricted `200` response is authorized for one reader at one moment. Caching it at a shared edge and replaying it to a different client defeats the authorization check. Restricted responses MUST be served with `Cache-Control: private, no-store` (§3) and MUST NOT be placed on a shared cache.
- **Authorized readers can re-share.** Any reader who can fetch restricted content can copy it elsewhere. No audience-control scheme prevents this, and this one does not claim to. Restriction limits *who the host serves*, not what an authorized human then does.

## 3. The Restricted Feed

A feed (and its manifest, §7) MAY be restricted. A restricted resource:

- MUST return `401 Unauthorized` to a request that carries no valid fetch assertion (§4), with a challenge header:

  ```
  WWW-Authenticate: OpenFeed-Sig
  ```

  The challenge MAY carry `error` and `error_description` parameters in the style of RFC 6750 — e.g. `WWW-Authenticate: OpenFeed-Sig error="expired_assertion"`. Defined `error` values: `invalid_assertion`, `expired_assertion`, `assertion_replayed`. No other challenge parameters are defined.
- MUST serve the resource only to readers the owner has authorized (§6).
- MUST set `Cache-Control: private, no-store` on any restricted `2xx` response, and MUST NOT be placed behind a shared/CDN cache (§2).
- MUST NOT be served with `Access-Control-Allow-Origin: *`. Cross-origin browser access to a restricted feed, if supported, requires an origin-scoped CORS policy and `Access-Control-Allow-Credentials`-style handling that is deployment-specific and out of scope here. (The core's blanket `*` rule, core §3.3, applies only to public documents.)

  **Consequence for browser readers.** The core sells a zero-proxy browser reader (core §3.3, §14.3): because every public document carries `Access-Control-Allow-Origin: *`, browser JavaScript on *any* origin can read it. A restricted feed deliberately drops that. Two browser-only CORS mechanics bite: the `Authorization: OpenFeed-Sig` request header is non-safelisted, so the browser fires a preflight the host must answer with `Access-Control-Allow-Headers`/`-Methods` and an origin-specific `Access-Control-Allow-Origin`; and because `*` is forbidden (and disallowed with credentials by the Fetch standard), the host must echo a *specific* allowlisted reader-app origin to let the script read the body. Absent that per-origin policy, a **browser** reader of a restricted feed is effectively **same-origin only** (or must route through a server-side reader that holds its key). **Server-to-server readers are unaffected** — CORS is enforced by browsers alone. Restriction therefore trades away the core's zero-proxy browser-reader property for cross-origin readers.

A restricted feed is otherwise an ordinary JSON Feed (core §7.1) and its items are ordinary signed items (core §7.2). Restriction is a property of *serving*, not of the item bytes: the same signed item could in principle appear in a public feed too, subject to the canonical/copy rule (core §7.5).

## 4. The Fetch Assertion

To fetch a restricted resource, the reader presents a short-lived, self-signed EdDSA JWT (RFC 7519) in the `Authorization` header, using the `OpenFeed-Sig` scheme:

```
GET /family/feed.json HTTP/1.1
Host: test.example
Authorization: OpenFeed-Sig eyJhbGciOiJFZERTQSIsInR5cCI6Im9wZW5mZWVkLWZldGNoK2p3dCIsImtpZCI6...
```

The assertion uses standard JWS Compact Serialization with an **encoded** payload — `base64url(header) || '.' || base64url(payload) || '.' || base64url(signature)`. This is a token, not detached content; it is the one place this extension departs from the core's detached-JWS construction (§1).

### 4.1. Header

```json
{ "alg": "EdDSA", "typ": "openfeed-fetch+jwt", "kid": "https://reader.example/#reader-key-1" }
```

- `alg` MUST be `EdDSA`. Verifiers MUST reject any other value.
- `typ` MUST be `openfeed-fetch+jwt`. This prevents an assertion from being confused with any other JWT the reader's key might sign.
- `kid` is the reader's full key identifier, `{identity_url}#{kid}`, exactly as in the core (core §4.2).

### 4.2. Claims

| Claim | Required | Description |
|-------|----------|-------------|
| `iss` | MUST | The reader's identity URL, normalized (core §3.1). The identity being authenticated. MUST equal the `kid`'s identity URL (author binding). |
| `htm` | MUST | HTTP method, uppercase (`GET`). Binds the assertion to a method. |
| `htu` | MUST | Target URL, **resource-normalized** (§4.3). Binds the assertion to a resource. |
| `iat` | MUST | Issued-at (Unix seconds). |
| `exp` | MUST | Expiry (Unix seconds). `exp − iat` MUST be ≤ 300. |
| `jti` | MUST | Unique token identifier (nonce) for replay detection (§5). |

The `htm`/`htu` binding prevents a captured assertion from being replayed against a different method or resource; the short `exp` plus `jti` bound replay within the same resource. Modeled on OAuth 2.0 DPoP (RFC 9449) — `htm`, `htu`, `jti`, `iat` carry DPoP's semantics — but the key is bound via `kid` resolving to the identity document (core §4.2, §6.5), not an embedded `jwk`, because Open Feed identities already publish their keys.

### 4.3. Resource-URL Normalization (`htu`)

Applied to both the assertion's `htu` and the host's view of the requested URL before comparison:

- Lowercase the scheme and host.
- Remove the default port (`:443`).
- **Strip the query string and fragment.**
- **Preserve the path byte-for-byte.**

The identity-URL normalization of core §3.1 (which appends a trailing slash) MUST NOT be applied — it would corrupt resource paths such as `/~mom/feed.json` or `/family/feed.json`.

Because `htu` excludes the query string, **one assertion covers all query-string variants of a path** within its validity window — e.g. every page of a paginated feed (`?page=2`, `next_url`, `since=…`). This is intentional: pagination and `since` polling of one restricted resource is one authorization, not many.

## 5. Assertion Verification

To verify a fetch assertion, the serving host MUST perform these steps **in order**. Steps 1–4 are cheap and local and MUST run **before** any outbound network fetch — the `iss`/`kid` are attacker-controlled until step 6 succeeds, so the same fetch-amplification and SSRF discipline as the inbox (core §10.2, §14.9) applies:

1. Parse the JWT. Confirm `alg` is `EdDSA` and `typ` is `openfeed-fetch+jwt`. Reject duplicate JSON member names (I-JSON, core §6.3).
2. Confirm `htm` equals the request method, and `htu` equals the requested URL after resource-normalization (§4.3).
3. Confirm `iat ≤ now < exp`, allowing at most 60 seconds of clock skew on each bound (accept `iat` up to 60 s in the future), and confirm `exp − iat ≤ 300`.
4. Confirm `jti` has not been seen before within this assertion's validity window. The replay cache MUST be keyed by `(iss, htu, jti)` and entries MUST be retained until at least the assertion's `exp` (§5.1).
5. Confirm `iss` equals the `kid`'s identity URL (split at the last `#`, core §4.2), both normalized. Reject otherwise (author binding).
6. Fetch the reader's identity document at `{iss}openfeed.json` (fixed path only — never an arbitrary URL from `kid`, core §14.9), enforce pinning (core §5.3), and find the key named by `kid`. Verify the JWT signature. Reject if the key's `iat` is after the assertion's `iat`, or if the key was revoked at or before the assertion's `iat` (core §6.5, §4.4).
7. Confirm `iss` is authorized for this resource (§6).

On failure the host returns `401` for steps 1–6 (bad, absent, expired, or replayed assertion; unverifiable identity) and `403` for step 7 (valid assertion, but `iss` is not authorized). A host MAY instead return `404` for an unauthorized reader when the *existence* of the resource is itself sensitive (§9).

### 5.1. Replay Cache

The `jti` replay cache defends only within an assertion's ≤ 300 s window; entries older than the longest allowed `exp + skew` MAY be evicted. Because `htu` is part of the key, an assertion minted for the feed cannot be replayed against the manifest, and vice versa. A host that cannot maintain a replay cache (e.g. a stateless edge worker) MUST NOT serve restricted feeds — the short `exp` alone does not prevent replay within the window.

## 6. Authorizing Readers

Verification step 7 asks one question: **is this `iss` authorized for this resource?** How the owner answers is deployment policy. This section defines three mechanisms. A host MUST support at least one; **capability grants (§6.2) are RECOMMENDED** as the primary mechanism because they publish nothing about the audience.

The **interface** is fixed regardless of mechanism: the host receives an authenticated `iss` from step 6 and MUST make a yes/no authorization decision for `(iss, resource)`. Storage of the underlying policy is otherwise implementation-specific.

### 6.1. Private Allowlist (interface only)

The simplest deployment keeps a **private, server-side allowlist** of authorized identity URLs, consulted at step 7. It leaks nothing (the list is never served) and needs no new document format. Its limitation is that it is **not portable and not static-hostable**: the authorization lives in the host's private state, so moving hosts (or migrating, core §3.4) means re-provisioning it out of band. This is the default when neither §6.2 nor §6.3 is used.

### 6.2. Capability Grants (RECOMMENDED)

Instead of the host holding a list, the **owner issues each authorized reader a signed grant**. The host holds no audience list at all; it is authorization-*stateless*, verifying two signatures per request.

A grant is an ordinary Open Feed signed document — the **core detached-JWS construction (core §6), reused unchanged** (this is *not* a new construction):

```json
{
  "url": "https://test.example/",
  "grant": "https://reader.example/",
  "feed": "https://test.example/family/feed.json",
  "manifest": "https://test.example/family/manifest.json",
  "iat": 1739577600,
  "exp": 1742169600,
  "_sig": "..."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `url` | MUST | The **grantor** — the identity that owns the restricted feed. Author binding (core §6.6): the `_sig` `kid`'s identity MUST equal this. |
| `grant` | MUST | The authorized **reader** identity URL, normalized (core §3.1). |
| `feed` | MUST | The restricted feed this grant authorizes. Resource-normalized (§4.3). To authorize an unrelated feed, issue a separate grant. |
| `manifest` | MUST | The restricted feed's **gated manifest** (§7), resource-normalized (§4.3). A grant authorizes both `feed` and `manifest`. Naming it **explicitly** (rather than deriving it from the identity document) is required because an **existence-private** feed (§9) is omitted from the identity document entirely, leaving no public `feed`→`manifest` association for the reader to follow or the host to check; it is stated on every grant so the rule is uniform and mode-independent. The grantor asserts this manifest belongs to `feed`; the host confirms it against its own feed-ownership routing at step 5. |
| `iat`, `exp` | MUST | Validity window (Unix seconds). A host MUST reject a grant outside `iat ≤ now < exp` (≤ 60 s skew each side). Grants SHOULD be short-lived (days, not years) so revocation is prompt (§6.2.2). |
| `_sig` | MUST | Detached JWS by a key valid in the grantor's identity chain (core §6). |
| `scope` | MAY | Reserved for future **narrowing** (e.g. read-only vs. specific item ranges). Absent = full fetch authorization for `feed`. A host that does not recognize a *present* `scope` value MUST **reject the grant (fail closed)**, not ignore it. Because `scope` only ever narrows, ignoring an unrecognized value would serve the whole feed to a reader the grantor meant to restrict — over-authorization. Fail-closed keeps future narrowing scopes safe to deploy: an old host either enforces the stated scope or refuses the grant, never silently widens it. |

Unknown `_`-prefixed fields MUST be preserved when re-serializing (signatures depend on it, core §7.2).

**Presentation.** The reader presents the grant alongside its fetch assertion, in an HTTP header carrying `base64url(canonical grant bytes)`:

```
Authorization: OpenFeed-Sig <assertion>
OpenFeed-Grant: <base64url(canonical grant JSON, including _sig)>
```

**Host verification (step 7, grant variant).** After step 6 has authenticated `iss`:

1. Base64url-decode `OpenFeed-Grant`; reject duplicate JSON keys (I-JSON).
2. Confirm `grant` equals the authenticated `iss` (both normalized). A grant is useless without a matching assertion: it is **bound to the reader's identity**, so a leaked or copied grant cannot be used by anyone who does not also control `iss`'s key.
3. Confirm the requested resource resource-normalizes (§4.3) to the grant's `feed` **or** its `manifest`.
4. Confirm `now` is within `[iat, exp)` (± 60 s skew).
5. Verify the grant's `_sig` per core §6.5: the `kid`'s identity MUST equal `url`; `url` MUST be the identity the host recognizes as the **owner of `feed`/`manifest`** — established via the public identity document (existence-public: `url` lists this feed and manifest) or via the host's own private feed-ownership routing (existence-private, §9, where the feed is absent from all public documents); and the signing key MUST be valid in that identity's pinned chain at the grant's `iat`. A host MUST also confirm that `manifest` is in fact the manifest it serves for `feed` (per that same routing), so a grantor cannot bind an unrelated manifest.
6. If the owner publishes a grant-revocation list (§6.2.2), confirm the presented grant — identified by `(grant, feed, iat)` — does not appear on it.

If all pass, `iss` is authorized. The host holds no per-reader **authorization** state (it still maintains the replay cache of §5.1 and, like any consumer, pins the identities and revocation list it fetches); it MAY cache a verified grant until its `exp` to skip re-verification.

#### 6.2.1. Grant Delivery Doubles as Discovery

The core (core §11) already anticipates delivering a restricted feed's URL to authorized readers as a signed inbox item when the URL itself is sensitive (§9). Grant delivery reuses that path. A grant is **not itself a JSON Feed item** — it is a separate signed document (§6.2) with no `id`/`authors`/`_feed_url`/`content_text`, so posting it to the inbox bare would fail the required-field validation of core §10.2. Instead the owner delivers it **inside a carrier item**: an ordinary signed item (core §7.2) authored by the owner, carrying a `_rel` entry that references the reader (a `mention`, or a custom relation type) so it passes the inbox relevance check (core §10.2), with the grant's canonical bytes in a `_grant` field on that item (an extension field, preserved per core §7.2). The reader extracts `_grant`, verifies it per §6.2, and presents it on subsequent fetches. One inbox delivery thus accomplishes both **discovery** (the reader learns the feed URL from the grant's `feed`) and **authorization** (the reader gains the capability) — two signatures (the carrier item's and the grant's), one delivery, consistent with the core's one-object-model principle (core §1).

#### 6.2.2. Revocation

A grant is a **bearer-but-identity-bound** capability: to revoke a single reader, the owner **stops re-issuing** its grant, and it self-expires at `exp`. For a hub this is automatic — grants are re-minted and re-delivered on a schedule for readers still in the audience; dropping a reader means not renewing. This makes short `exp` the **primary** revocation control and is strictly stronger than a static bearer token, which cannot be revoked at all. Prefer short `exp`; the list below is a fallback, not the mechanism.

**Faster-than-`exp` revocation — the grant-revocation list (chained side-document).** For revocation sooner than a grant's `exp`, the owner MAY publish a **grant-revocation list**: a signed, **chained** document with the identical mechanics of the manifest (core §9) — its own monotonic `seq`, `prev` hash-linkage, retained `history`, and the pin-and-walk enforcement of core §9.1 — signed with the core detached-JWS construction (core §6, **no new construction**). It is referenced from the identity document by a **`grant_revocations` URL field** (a first-class extension endpoint, like `readers` in §6.3). Using a *URL reference* rather than an inline array is deliberate: **a revocation advances the revocation chain, not the identity chain**, so revoking a reader does not perturb the identity document, which must stay short and rarely-advanced (core §5, §3.2).

```json
{
  "url": "https://test.example/",
  "revocations": [
    { "grant": "https://gran.example/~gran/", "feed": "https://test.example/family/feed.json", "iat": 1739577600 }
  ],
  "seq": 1,
  "updated": 1739577600,
  "_sig": "..."
}
```

- `url` is the owner (author binding, core §6.6). `revocations` is an array of `(grant, feed, iat)` tuples; that triple uniquely names an issued grant (a re-issued grant with a fresh `iat` is a distinct entry). `seq`/`prev`/`history` follow core §9 (`prev` and `history` MUST be present once `seq > 1`).
- The list leaks only **former** members, never the full current audience. This is the same disclosure class as a self-commitment (`open-feed-conventions.md` §5): it is available only to **existence-public** feeds and is **incompatible with existence-private** feeds (§9), whose only revocation control is short `exp` — the tradeoff triangle of conventions §5.3.
- The **consumer** of this document is the enforcing **host**, not the reader: the host fetches it, pins it, walks `prev` to its pin (so a serving-path attacker cannot silently roll back a revocation, core §9.1), and rejects any presented grant whose `(grant, feed, iat)` appears in the current version (grant-verification step 6, §6.2).
- Growth is naturally bounded: an entry need only be retained until the revoked grant's own `exp` has passed (after which the grant is dead regardless), so stale entries MAY be pruned and the chain checkpointed exactly as a manifest is (core §9.3).

Vectors: R.4 (genesis) and R.4b (`seq: 2`, chained) in Appendix R.

### 6.3. Published Reader List (`readers`, simple fallback)

The dead-simple mechanism: the owner publishes a signed reader list and references it from the identity document via a `readers` field. The host fetches it and checks `iss` for membership at step 7.

```json
{
  "url": "https://test.example/",
  "feed": "https://test.example/family/feed.json",
  "readers": ["https://reader.example/", "https://gran.example/~gran/"],
  "updated": 1739577600,
  "_sig": "..."
}
```

Signed with the core detached-JWS construction; `url` is the owner (author binding, core §6.6). A per-feed list uses `feed`; a host applying one list to several feeds MAY omit it by convention.

> **⚠ SECURITY — publishing a reader list publishes your audience.** A `readers` document names, in cleartext, exactly who is in the audience — for a family feed, *who is in the family*. That membership list is often as sensitive as the content it gates. Therefore:
>
> - Reader lists **SHOULD** be kept **private/server-side (§6.1)** or issued as **capability grants (§6.2)** by default. A published `readers` document is an **opt-in** for owners who have accepted publishing their social graph.
> - This mirrors how the core treats `follows`/`pins` (core Appendix G): social-graph documents are outside the trust core and MAY be kept client-local. A reader list is the same kind of data and carries the same caution.
> - A published reader list MUST still be served with restrictive caching and SHOULD itself be access-controlled where practical; publishing it world-readable is the maximally-leaky configuration.

**Rejected anti-pattern — hashed or Bloom-filter reader lists.** Publishing `H(identity_url)` (or a Bloom filter of the audience) instead of cleartext URLs does **NOT** provide privacy and MUST NOT be relied on for it. Identity URLs are low-entropy and guessable (a family's handful of domains), so any observer can brute-force-test candidate identities against the published digests; a public salt does not help, because it must be published to be usable. Implementers reaching for a hashed list to "hide" the audience are getting false privacy — use §6.1 or §6.2 instead.

### 6.4. Capability URLs (static-hosting tier)

The only mechanism that needs **no dynamic host at all**: publish the restricted feed at an **unguessable URL** and serve it to anyone who knows that URL, with no assertion and no authorization check. Authorization collapses into knowledge of the URL.

- The unguessable path component MUST carry at least **128 bits** of entropy (e.g. a random 22-character base64url token) and MUST NOT be linkable from any public document.
- The feed and its manifest are served as ordinary static files; there is no `401`, no assertion, no grant.
- This is the **lowest-assurance** tier: possession of the URL *is* the capability, so a single leak (a referrer header, a shared link, a browser-history sync) grants permanent access, and **per-reader revocation is impossible** — the only remedy is rotating the URL and re-distributing it to everyone. CDN caching is acceptable here *only because there is no per-reader authorization to defeat*, but the URL's secrecy then depends on the cache not exposing it.
- Capability URLs MUST NOT be advertised in the identity document or any public feed. Distribute them the same way as grants (out of band, or via a signed inbox item, §6.2.1).

Capability URLs suit purely-static deployments (Level 2 hosting with no request-time logic). Owners who can run assertion checks SHOULD prefer §6.2.

## 7. The Gated Manifest

A restricted feed carries its **own signed, chained manifest** with the identical mechanics of core §9 — `seq`, `prev`, `history`, `items`/`deleted`, checkpointing, and the pin-and-walk enforcement of core §9.1. The only difference is that the manifest, its history document, and the feed pages are all **gated**: fetched with a fetch assertion (§4) whose `htu` names the manifest (or history) URL, and authorized by the same mechanism as the feed (§6). Every grant carries an explicit `manifest` field (§6.2) that both authorizes the manifest and, in existence-private mode, is **how the reader learns the manifest URL at all** — the public identity document does not list it.

The manifest is listed for an **existence-public** restricted feed the same way any feed's manifest is (core §3.2 `feeds` entries). For an **existence-private** feed the owner omits it from the public identity document entirely; the reader then learns the feed URL and the manifest URL from the grant's `feed`/`manifest` fields (delivered via inbox/out-of-band, §6.2.1, §9), and the host resolves feed ownership from its own private routing rather than from a public `feeds` entry (§6.2 step 5).

## 8. Consumer Enforcement and Its Limits

A reader consuming a restricted feed enforces everything it would for a public feed: verify each item's signature (core §6.5), pin and walk the manifest chain (core §9.1), enforce the canonical/copy rule (core §7.5), apply the manifest-membership and manifest-lag checks (core §9.4). The gate changes *how bytes are fetched*, not *how they are verified*.

Two guarantees are **weaker** than for public feeds, and consumers and implementers MUST understand them:

### 8.1. Rollback Is Still Caught (per reader)

Against a *single* reader, the manifest chain works exactly as in the core: the reader pins `(seq, hash)` on first observation and rejects any later manifest whose `seq` decreased or whose `prev` fails to chain to the pin (core §9.1). A host cannot silently roll a reader back to un-delete content or drop an item, because the reader remembers its pin.

### 8.2. Cross-Reader Equivocation Is NOT Caught

For a **public** feed, two observers (or a `pins` aggregator, core Appendix G) can reconstruct the manifest at a shared `seq` and compare hashes; divergence surfaces as same-`seq`/different-hash equivocation (core §9.1, §14.2). This is the certificate-transparency bargain the core relies on.

**By default a restricted feed loses this.** Authorized readers cannot publicly gossip their pins of a restricted manifest without leaking *that the content exists and what its shape is* — the very thing restriction protects. So a malicious host holding the owner's key **can** serve reader A a manifest at `seq: 10` with items `{X}` and reader B a *different* manifest at `seq: 10` with items `{Y}`, both internally consistent and correctly chained, and — absent the opt-in mechanism below — no public mechanism reveals the divergence. (The equivocation requires the owner's key: only genuinely-signed versions exist at one `seq`, so a host holding no key can do no worse than per-reader rollback, §8.1. The residual threat is the key-custodian tier, core §14.2.)

This is **not** inherent and unfixable, as earlier drafts of this section claimed. It is inherent only to content whose *existence* stays entirely private. An owner who can disclose that the feed exists can restore full cross-reader equivocation detection via **self-commitments** (`open-feed-conventions.md` §5): the owner publicly and signed-ly pins the `(seq, hash)` of its own restricted manifest. A key-custodian host wanting A and B to see different `seq: 10` manifests must then publish two conflicting *public* commitments, which forks a world-readable, gossipable chain and is caught by the ordinary cross-observer compare rule (conventions §4.1). This reduces restricted-feed equivocation to public-feed equivocation **for versions the owner actually commits to** — the residual is that a self-commitment, unlike a public manifest, is a *separate* act the owner can decline, so a host can equivocate at `seq: 10` and simply never commit `seq: 10`, claiming perpetual "commitment lag." The reader-side detection rule for that evasion lives in conventions §5.1. Its cost is disclosing the feed's existence and publish cadence (never its content), so it is available only in the existence-public mode (§9); an existence-private feed forgoes it — the tradeoff triangle of conventions §5.3.

Mitigations:

- **Self-commitments (RECOMMENDED for existence-public feeds)** — the owner publishes public signed commitments to each restricted manifest version (conventions §5), restoring cross-reader detection as above. Readers that fetch them apply the reader-side check (conventions §5.1).
- Authorized readers who trust each other MAY also compare restricted pins **out of band** (privately), recovering equivocation detection within that trusting subset — the manual analog of core §9.1's cross-observer check, and the only option for an existence-private feed.
- Client-side signing keys (core §14.2) keep the *signing* boundary off the host even when the *serving* boundary is gated, so a serving-path compromise cannot forge manifests — and, combined with self-commitments, denies the key-custodian equivocation entirely (the strongest available posture for a restricted feed).

## 9. Discovery

The existence of a restricted feed is metadata; its contents are gated. An owner chooses how much of that metadata to expose:

- **Existence public, contents gated.** List the restricted feed in the identity document (`feeds`, core §3.2). Anyone learns the feed exists and its URL; only authorized readers get `2xx`. Simplest; appropriate when the audience's *existence* is not secret.
- **Existence private.** Omit the restricted feed **and its manifest** from all public documents and deliver both URLs only to authorized readers — via the grant's `feed`/`manifest` fields (§6.2), carried in a capability-grant delivery (§6.2.1) or a signed inbox item (core §10). Use when even *"this identity has a family-only feed"* is sensitive. In this mode the host SHOULD return `404` (not `403`) to unauthorized or unauthenticated requests (§5), so probing cannot confirm the resource exists. Existence-private feeds forgo the two public transparency mechanisms — self-commitments (`open-feed-conventions.md` §5) and the grant-revocation list (§6.2.2) — because both would disclose the feed's existence; short-`exp` non-renewal is their only revocation control (§6.2.2), and their only cross-reader-equivocation defense is the out-of-band private compare of §8.2.

  A `404` equalizes the response *status* but not its *timing*. An authenticated-but-unauthorized reader triggers the step-6 outbound identity-document fetch (§5) before the host reaches the authorization decision, whereas a genuinely-absent path is rejected by the local steps alone — so response latency can distinguish "exists but you're not authorized" from "does not exist." (An unauthenticated prober cannot exploit this: with no valid assertion it is rejected at steps 1–5, before any fetch.) A host that needs existence-privacy against *authenticated* probers SHOULD equalize timing — e.g. by deferring or dummy-running the outbound fetch, or by rate-limiting probes — since the constant-time / uniform-timing discipline of core §14.8 otherwise does not extend across the assertion-verification fetch.

The identity document itself MUST NOT be served in audience-varying forms: two different views at one `seq` would be equivocation (core §5.3). Restriction gates *feeds*, never the identity document, which stays public and single-valued.

## 10. Conformance

This extension defines no new conformance level. It refines core Level 3 (core §13):

- A Level 3 host that serves restricted feeds MUST implement §3 (the `401`/challenge), §4–§5 (assertion verification, including the replay cache, §5.1), §7 (the gated manifest), and at least one authorization mechanism of §6.
- Such a host SHOULD implement capability grants (§6.2) as its primary mechanism.
- A restricted-feed **reader** (a Level 1+ consumer that reads restricted feeds) MUST mint assertions per §4, present grants when it holds them (§6.2), and enforce §8's manifest checks, understanding the §8.2 limit.
- Static-only (Level 2) deployments MAY offer restricted feeds solely via capability URLs (§6.4).

A host or reader MUST NOT require this extension of a peer: a peer that does not implement it simply cannot serve or read restricted feeds, and all public-feed behavior is unaffected.

## Appendix R: Test Vectors

All vectors are computed and self-verifying, regenerated by `tmp/regen.js` alongside the core Appendix D vectors. Keys are the same deterministic, testing-only Ed25519 keys as core Appendix D, plus one reader key. **Not for any real identity.**

Identities: feed owner `https://test.example/` (key `test-key-1`, as in core D.1); reader `https://reader.example/` (key `reader-key-1`).

| `kid` | role | `x` (base64url) |
|-------|------|-----|
| `test-key-1` | feed owner / grantor | `EJCQMfAAiRcCJPeshSuCgQeEOSmcG6OL0xbMJGcuwf0` |
| `reader-key-1` | reader | `X1ImihHt5syI0lgZfDFRh3UIQTMUh5RYH4OAb-b52zc` |

### R.1. Fetch Assertion (§4)

Header:

```json
{"alg":"EdDSA","typ":"openfeed-fetch+jwt","kid":"https://reader.example/#reader-key-1"}
```

Claims (`exp − iat` = 300 s):

```json
{"iss":"https://reader.example/","htm":"GET","htu":"https://test.example/family/feed.json","iat":1739577600,"exp":1739577900,"jti":"urn:uuid:6b3a...c0ffee"}
```

Compact JWT (as sent in `Authorization: OpenFeed-Sig <this>`), signed by `reader-key-1`:

```
eyJhbGciOiJFZERTQSIsInR5cCI6Im9wZW5mZWVkLWZldGNoK2p3dCIsImtpZCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvI3JlYWRlci1rZXktMSJ9.eyJpc3MiOiJodHRwczovL3JlYWRlci5leGFtcGxlLyIsImh0bSI6IkdFVCIsImh0dSI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2ZhbWlseS9mZWVkLmpzb24iLCJpYXQiOjE3Mzk1Nzc2MDAsImV4cCI6MTczOTU3NzkwMCwianRpIjoidXJuOnV1aWQ6NmIzYS4uLmMwZmZlZSJ9.cQwOZBAdQJmC8RNjnYjDq7Gh_UWmnznssep1K9PIj0G0EpPBYHTs-0f2yPYrWBJ39-78pE8OupXXVXsrcjHtCA
```

This assertion authorizes `GET` of any query-string variant of `https://test.example/family/feed.json` (§4.3) until `exp`.

### R.2. Capability Grant (§6.2)

Owner `https://test.example/` (key `test-key-1`) authorizes reader `https://reader.example/` to fetch the restricted feed. The grant carries an explicit `manifest` (§6.2, F2). Full published canonical bytes (core detached-JWS construction — note the header segment is the core's `b64:false` header, *not* the R.1 JWT header):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..BdXFw58GNmUCbRtW3SaOgXyDswqJ12CZOezPqePADmcd4Lt1GVCWWpOox-LMYdZkmwC6R4-NK_KeX05xyC96Aw","exp":1742169600,"feed":"https://test.example/family/feed.json","grant":"https://reader.example/","iat":1739577600,"manifest":"https://test.example/family/manifest.json","url":"https://test.example/"}
```

As sent in the `OpenFeed-Grant` header, this is `base64url` of those exact bytes:

```
eyJfc2lnIjoiZXlKaGJHY2lPaUpGWkVSVFFTSXNJbUkyTkNJNlptRnNjMlVzSW1OeWFYUWlPbHNpWWpZMElsMHNJbXRwWkNJNkltaDBkSEJ6T2k4dmRHVnpkQzVsZUdGdGNHeGxMeU4wWlhOMExXdGxlUzB4SW4wLi5CZFhGdzU4R05tVUNiUnRXM1NhT2dYeURzd3FKMTJDWk9lelBxZVBBRG1jZDRMdDFHVkNXV3BPb3gtTE1ZZFprbXdDNlI0LU5LX0tlWDA1eHlDOTZBdyIsImV4cCI6MTc0MjE2OTYwMCwiZmVlZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2ZhbWlseS9mZWVkLmpzb24iLCJncmFudCI6Imh0dHBzOi8vcmVhZGVyLmV4YW1wbGUvIiwiaWF0IjoxNzM5NTc3NjAwLCJtYW5pZmVzdCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlL2ZhbWlseS9tYW5pZmVzdC5qc29uIiwidXJsIjoiaHR0cHM6Ly90ZXN0LmV4YW1wbGUvIn0
```

The reader presents R.1 (proving it controls `https://reader.example/`) and R.2 (proving the owner authorized that identity for this feed and its manifest) together; `grant` in R.2 equals `iss` in R.1.

### R.3. Gated Restricted Manifest (§7)

The restricted feed's own §9 manifest (genesis, `seq: 1`), signed by the owner, fetched with an assertion whose `htu` is `https://test.example/family/manifest.json`:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..pEAPhltYP6dznUc_vsU5aNcrF1zc68jTXCh6DjsNT1GSjOp2kDAl6u4BsAvAj7gh3ztZ1isfk4RScD-Z4RiBCw","feed_url":"https://test.example/family/feed.json","items":{"urn:uuid:aabbccdd-eeff-0011-2233-445566778899":1},"seq":1,"updated":1739577600,"url":"https://test.example/"}
```

Base64url SHA-256 of these bytes (this is `seq: 2`'s `prev`, and the value the owner commits to in conventions C.2 / C.2b): `q1mbSP0wZm9IEkQwh5Y98iR8e5tzxgiaJ7n1HOXXvuQ`

### R.3b. Gated Restricted Manifest, `seq: 2` (chained)

The restricted manifest advances exactly like a public one (core §9.1): a second restricted item is added and `prev` chains to R.3. Signed by the owner, `updated` = 1742169600:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..lX4FTVpj1Zjs4NNM8kxi0IvXGdJ3egf1KRP883oSkojjFAVfPjOnh8OudLH9wQ9uy5LaTCfhM7JuAF6mLB28Dg","feed_url":"https://test.example/family/feed.json","history":"https://test.example/family/manifest-history.json","items":{"urn:uuid:aabbccdd-eeff-0011-2233-445566778899":1,"urn:uuid:bbccddee-ff00-1122-3344-556677889900":1},"prev":"q1mbSP0wZm9IEkQwh5Y98iR8e5tzxgiaJ7n1HOXXvuQ","seq":2,"updated":1742169600,"url":"https://test.example/"}
```

Its `prev` equals R.3's full-bytes hash (manifest chaining, core §9.1); the base64url SHA-256 of R.3b's own bytes is `lhbzlfkKcX0wgO1PSOLt8wIJUXHxshtd1RWoXi0iVsw`, the value committed at `seq: 2` of the conventions C.2b commitment log.

### R.4. Grant-Revocation List (genesis, `seq: 1`) (§6.2.2)

The owner's chained grant-revocation list (F3). Genesis revokes one reader's grant, identified by `(grant, feed, iat)`. Signed by the owner with the core detached-JWS construction (no new construction — same discipline as a manifest):

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..WIqEx-SkhaGSY04mU-te3R2-A8jLIXuV_w4aWWsussqUhtzaq1Ue1M5M_iGA0aKT3V71XxDPO8u_spSpWat9Cg","revocations":[{"feed":"https://test.example/family/feed.json","grant":"https://gran.example/~gran/","iat":1739577600}],"seq":1,"updated":1739577600,"url":"https://test.example/"}
```

Base64url SHA-256 of these bytes (this is `seq: 2`'s `prev`): `U62LvxMFkKTZ3COi38yjlEc7y58UP4UM8_vDJq0-jWY`

### R.4b. Grant-Revocation List, `seq: 2` (chained)

A second grant is revoked; `prev` chains to R.4 and `history` appears (core §9, present once `seq > 1`). A host that pinned `seq: 1` walks `prev` back to its pin, so a serving-path attacker cannot silently drop the `seq: 1` revocation to re-authorize a cut reader. Signed by the owner, `updated` = 1742169600:

```
{"_sig":"eyJhbGciOiJFZERTQSIsImI2NCI6ZmFsc2UsImNyaXQiOlsiYjY0Il0sImtpZCI6Imh0dHBzOi8vdGVzdC5leGFtcGxlLyN0ZXN0LWtleS0xIn0..PkV881Mou2FxPJ5UCrEiCqMSsYSHrE-7Rmy-uLP8qkY695VWeFb8gnNcJTiyrYGBsbz8FYD2tyTN4breO0dTDA","history":"https://test.example/family/grant-revocations-history.json","prev":"U62LvxMFkKTZ3COi38yjlEc7y58UP4UM8_vDJq0-jWY","revocations":[{"feed":"https://test.example/family/feed.json","grant":"https://gran.example/~gran/","iat":1739577600},{"feed":"https://test.example/family/feed.json","grant":"https://old-friend.example/","iat":1739577600}],"seq":2,"updated":1742169600,"url":"https://test.example/"}
```

Its `prev` equals R.4's full-bytes hash (revocation-list chaining, core §9.1).

**Validation recipe:** verify R.1 against `reader-key-1` and confirm `iss` = `kid` identity and `exp − iat ≤ 300`; verify R.2's `_sig` against `test-key-1` and confirm `grant` (R.2) = `iss` (R.1), `url` (R.2) = the `kid` identity, and that R.2 carries an explicit `manifest`; verify R.3's and R.3b's `_sig` against `test-key-1` as listed in the owner's (pinned) identity document, and confirm R.3b's `prev` equals R.3's full-bytes hash (restricted-manifest chaining); verify R.4's and R.4b's `_sig` against `test-key-1` and confirm R.4b's `prev` equals R.4's full-bytes hash (revocation-list chaining). `tmp/regen.js` performs all of these checks.
