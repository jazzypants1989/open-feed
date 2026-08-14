# Handoff — after `60d36f0`

Delete this file when it has been consumed. It is a review of two commits and a list of what
is still open; none of it belongs in `CLAUDE.md` or the spec.

Both commits are on `main`, matching this repo's pattern. `npm test` → 156 pass.
`node tmp/regen.js` → all checks pass.

- `b9f0703` — your four in-flight prototypes (migration, export, inbox, enctags) and the spec
  text their findings forced. Committed separately and first so it kept its own message; I
  split my two spec hunks and two `CLAUDE.md` line edits out of the working tree to do it.
- `60d36f0` — the `__proto__` defect, the wire-canonicality rule, and `src/migration.js`.

---

## 1. Skeptical review of `60d36f0`

### 1.1 The `__proto__` fix: I settled a design question I should have asked

Two answers were available and I took the second without putting the first to you.

**Treat `__proto__` as an ordinary member.** This is what `JSON.parse` does, what every
non-JavaScript implementation does by default, and therefore what a Python or Go verifier will
do whether or not the spec says so. It is the *more* interoperable answer. Its cost lands
entirely on JavaScript implementations, and it is not one check: the parser must build with
`Object.create(null)` or `defineProperty`, **and every copy loop anywhere in the stack** must
preserve the member. `{...doc}` is safe; `for (const k of keys) out[k] = v` is not. That trap
is exactly the one this repo just stepped on, and a third-party implementer will step on it
again with no test to catch them.

**Reject the member name.** One check, implementable identically in any language, fails closed,
and requires no care anywhere else — which is why I took it. Its cost is that it is a genuine
protocol wart: a restriction on JSON that no neighbouring protocol has, and a Python publisher
emitting `__proto__` in an extension field now produces a document a conforming verifier must
refuse. It converts a *silent* disagreement into a *loud* one, which is better, but only
because the spec now says so.

I also let test ergonomics push me: `Object.create(null)` broke `assert.deepStrictEqual` in two
existing tests, because that assertion compares prototypes. That is a bad reason to shape a
protocol and I should not have weighed it. The argument that stands on its own is the copy-loop
trap — but it is a close call and it is yours. **Question 1 below.**

One thing I did check: `__proto__` is the only member name with this behaviour. It is the only
accessor on `Object.prototype`; `constructor`, `toString` and the rest are plain data
properties, so `out.constructor = v` creates an own property normally. There is no second name
to reserve.

### 1.2 The wire-canonicality rule is a much bigger hammer than its diff suggests

`assertCanonicalBytes` is nine lines, and it raises the conformance bar for every publisher in
the protocol. Before it, §5.4 required *retained* versions byte-identical and nobody checked;
the **tip** was under no byte-level constraint at all. Now `openfeed.json` and `manifest.json`
must be byte-exact RFC 8785 on the wire or they are unreadable — not cosmetically
non-conforming, unreadable. A static-site generator writing `JSON.stringify(obj, null, 2)`, a
proxy that pretty-prints, a host that appends a trailing newline: each is now a hard failure.

I still think it is right, because without it the pin commits a normalization of what you were
served rather than what you were served, and every remaining parser divergence lives in that
gap. But there is a middle setting I did not consider before implementing: **MUST for retained
versions** (where §5.4 already demands byte-identity, so nothing new is being asked) and
**SHOULD-with-a-finding for the tip**. That keeps the strict guarantee where a chain is walked
and degrades to a conformance warning at first contact. It is weaker, and I am not sure it is
weaker in a way that matters. **Question 2.**

Two smaller things about it:

- **It doubles canonicalization work on a walk.** Every chained document is now canonicalized
  once by `assertCanonicalBytes` and again by `documentHash`. Against §13.4's budget — up to
  1000 versions of a manifest at up to 1 MB — that is real. It is also free to fix: once the
  body is *proven* canonical, `documentHash` is just `b64u(sha256(fetched.bytes))`, and the
  fetch layer already has those bytes. I did not wire that through because it means threading
  bytes into `walkToPin`, which currently takes parsed documents only. Worth doing.
- **`accept-encoding: identity` was already set**, so HTTP compression does not interact with
  this. Good, but it is now load-bearing rather than a nicety, and nothing says so.

### 1.3 `src/migration.js`: the state I chose to keep is larger than the state that is needed

`MigrationStore.noteIdentity` retains the **whole identity document** per identity, and I
argued for it in the spec (§4.5 now makes it a MUST). The argument is sound — a pin is a
`(seq, hash)` and the recovery key is in the bytes, so a pin-only consumer cannot verify a
recovery migration once the domain is gone. But the conclusion is too broad. What §4.5 actually
needs from the predecessor is:

- the **recovery keys** committed at the verified version (~130 bytes per key), and
- the predecessor's **feed URLs**, for §7.5's exception — which I already store separately.

Everything else in a 100 KB identity document is dead weight, held forever, for every identity
a consumer has ever read. A hub polling a few thousand external members would hold hundreds of
megabytes to answer a question a few kilobytes answers. The right shape is a *recovery pin* —
`(url, seq, hash, recoveryKeys[], feedUrls[])` — and both the spec sentence and the module
should say that instead. This is the clearest improvement available on what I built, and it
also narrows the spec MUST from "retain the identity document" to something a minimal consumer
will actually do. **Question 3.**

### 1.4 Rough edges I know about and left

- **`reconcileMigration` can throw about a different identity than the one you asked for.**
  Reading a successor triggers a read of the predecessor, which walks the predecessor's chain.
  I catch `ReaderError` and `FetchError` there but deliberately not `EquivocationError` — an
  equivocating predecessor *should* surface — so `read(successor)` can reject with an error
  naming the predecessor's URL. Correct, and confusing. It wants a wrapper that says which
  identity the finding is about.
- **There is no way to settle a contested migration.** Once two claims collide, `record` throws
  for *both* successors forever, which is exactly §3.4's "MUST NOT follow either without
  out-of-band confirmation" — but there is no API for the confirmation. `PinStore` has `rePin`
  for the analogous situation; `MigrationStore` needs `settle(predecessor, successor)`.
- **`read()` now follows migrations by default**, so `read(A)` can return B's content. I added
  `result.followed` to say so, but it is a surprising default for a function that took one URL.
  Defensible (it is what §3.4 asks of a consumer) and worth a second look.
- **`memoizeByAuthor` is per-read, not per-reader.** A thousand-item family board costs one
  fetch per distinct author per poll. There is no positive identity-document cache anywhere in
  `src/`, though §12 asks for one (≤1 h). Separate gap, listed below.
- **`retiredChainUrls()` rebuilds a Set on every `walkAndPin`.** Trivial today, sloppy anyway.

### 1.5 On the spec text I wrote

The `__proto__` bullet in §6.3 is longer and more implementation-specific than the two bullets
beside it — the duplicate-member rule gets one sentence, mine gets five. The JavaScript
mechanics may be justification-next-to-a-MUST (which `CLAUDE.md` says stays) or may be
archaeology in disguise. I lean toward trimming it to the rule plus one sentence on why it
fails *open*, and letting `src/canonical.js`'s comment carry the mechanism.

And I did not touch **§12**. The canonical-bytes rule is a consumer MUST that is not a signature
check, so "verify signatures (§6)" does not obviously carry it. It should be named in Level 1's
list or it will be missed by anyone reading §12 as the conformance checklist.

---

## 2. Two alternatives worth putting on the table

**A. Let the successor's genesis manifest commit the predecessor's final state.**
§9.3 invariant 5 requires every id live in the predecessor's last manifest to appear in the
successor's — but only "the last manifest *the consumer observed*", so it is checkable by
someone who was already watching and by nobody else. If the successor's genesis manifest
carried `predecessor_manifest: {url, seq, hash}`, invariant 5 would become checkable **from the
successor's bytes alone**: fetch that retained version from its derived URL, confirm the hash,
compare the id sets. It does not fix first-contact TOFU (a stranger still cannot verify the
recovery key), but it converts "you had to be there" into "you can go and look", which is the
same move §5.4's derived URLs already make for chain history. One optional field, no new
construction.

**B. Derived item URLs** — still the open wire proposal from the review, and it is now more
attractive than it was, because §1.2's canonicality rule cannot cover items and derived URLs
would give a consumer a way to *request* an individual item's bytes and compare them. It is
also the only credible fix for the withholding defect below.

---

## 3. Still open, in the order I would take them

Nothing here is started.

1. **The withholding false-positive is still live.** `reader.js` passes
   `partial: feed.nextUrl !== null`, so an ordinary publisher serving a 50-item window with
   10,000 committed items has every older item reported as **withheld**. The migration work
   fixed a *different* cause of false withholding and left this one. §9.3 scopes the verdict to
   bytes a consumer actually tried to obtain, and absence of `next_url` is not knowledge that
   you made a complete pass — so today no conformant consumer can honestly assert withholding
   from a feed read at all, which makes the state nearly dead on the pull path.
2. **`src/inbox.js`** — §10.2's normatively-ordered pipeline, dedup on the id half so it
   survives a migration, the write-before-verify guard, §10.4's responses.
3. **§15 encryption in `src/` + Appendix B vectors** — an OPTIONAL layer marked "never
   independently reviewed", with no reference implementation and no vectors, that
   `DISTRIBUTION-MODEL.md` treats as a launch dependency.
4. **`src/export.js`** — §14 produced and restored, including the predecessor-chain requirement
   and the archive container.
5. **Derived item URLs prototype** — `tmp/`, measured like skiplinks and deltamanifest were.

Smaller, from the review, none addressed:

- **Multi-feed reads.** `read()` takes one `feeds` entry; §3.2.1 says a consumer wanting the
  whole catalog reads every one, so a rotated archive feed is invisible to the reference reader.
- **No positive identity-document cache** (§12 asks for ≤1 h).
- **Identity-chain length is an unbounded denial.** Skip links are forbidden there for a sound
  reason and §13.4 caps the walk at 1000 versions, so a custodian holding a root key can advance
  the chain past the cap between polls and make the identity permanently unverifiable to every
  pinned consumer. Delegated custody removes the capability; nothing says so.
- **§14 never states that bundle completeness is unverifiable** for `delivered`, `received`, and
  `unpublished` — the unmanifested half, which is exactly what a hostile operator would degrade.
- **§3.1's percent-encoding rule has no single answer.** `normalizeIdentityUrl` delegates to
  WHATWG `URL`, which never decodes but *does* re-encode raw characters (`/a^b/` → `/a%5Eb/`).
  A different URL library encodes a different set, and one identity becomes two.
- **`updated` is Unix seconds and must strictly increase**, so publish-then-tombstone inside one
  second is refused by `Publisher`. Real at a hub batching with tombstone preemption.
- **§15.2's `_tag` is 8 bytes** and the spec does not say what a reader does when a tag matches
  but the unwrap fails.

---

## 4. Questions

1. **`__proto__`: keep the rejection, or make it an ordinary member?** (§1.1) Rejection is one
   language-independent check that fails closed; ordinary-member is more interoperable and puts
   a permanent copy-loop trap in front of every JavaScript implementer.
2. **Wire-canonicality: MUST everywhere, or MUST for retained versions and SHOULD for the tip?**
   (§1.2) The stricter form is what I shipped; the looser form keeps first contact tolerant of
   ordinary infrastructure.
3. **Shrink the retained predecessor state to a recovery pin?** (§1.3) `(url, seq, hash,
   recoveryKeys, feedUrls)` instead of the whole identity document, in both the module and the
   §4.5 MUST.
4. **Build order.** I proposed inbox → §15 → export → derived item URLs, with the withholding
   defect fixed first because it is a live false accusation in shipped code. Say if you want a
   different order, or want the withholding fix to wait for the derived-item-URL prototype
   rather than getting an interim consumer-side tightening.
