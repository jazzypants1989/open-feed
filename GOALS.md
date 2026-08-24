# Open Feed — goals and scenarios

**The floor the spec is judged against, in plain words.** Written from the owner's answers, before
any rule was written, and kept because a spec cannot tell you whether it is solving the right
problem. Nothing below is normative — `open-feed-spec.md` is — but every rule in the spec should
point back at a line here, and a rule that points at nothing is a rule to argue with.

## Why this exists

The first prompt was about Tim Berners-Lee's SOLID: self-hosting and data privacy, done more
pragmatically than Mastodon or Bluesky, which are busy replacing Twitter. The project's real
adversary arrived later, from life: **if my sister had been on her abusive ex-husband's hub, he
would have controlled her words, her inbox, her archive, and her ability to leave — during a
divorce.** Everything the protocol guarantees is judged against that person. He is inside the
family, entitled to look, runs the server, and will not cooperate.

## What it must do — the floor

Stated as what a person can rely on, not as mechanisms:

1. **The host cannot speak for you.** Nothing it serves as yours verifies unless you signed it,
   and the key that signs was never the host's.
2. **The host cannot read what wasn't meant for it.** Content for chosen people is unreadable by
   anyone else, the host included.
3. **The host cannot keep you.** You can leave at any moment with your identity and everything
   you wrote, without asking, because the key and the copy were always on your device.
4. **Family on other hubs are first-class.** Two relatives self-hosting on separate domains
   share, reply, and react to each other's family-only content as if they were on one hub.

Everything else is negotiable.

## Priorities, in order

1. **No dependencies.** Implementable from a language's standard library: Ed25519, SHA-256, HTTP,
   JSON, base64url. No canonicalizer, no JOSE library, no git binary.
2. **Easy to implement.** A second implementer finishes a publisher or a reader in a weekend from
   the text alone. Pushing on the tension between this and #1 is the intellectual point of the
   project.
3. **Interop.** Our content reaches existing feed readers and the fediverse/Bluesky with nothing
   built; their replies coming back is an extension.
4. **Minimal.** A goal, not a description. The shortest text that delivers the floor.

Deliberately *not* priorities: human-readable wire bytes (nobody reads them); strangers' continuity
across key loss (they are strangers by definition); millions of items per identity (the design
scales across identities — many people on a few big hubs is the case that must work, and it is
the sister's case at commercial scale).

## The decisions this rests on

Each of these reversed something an earlier design did. What each one retired, and why the old
position was held, is in `archive/` — consult `archive/README.md` before re-litigating one.

- **Identity is a key.** A signed profile names current location(s), keys, and recovery
  arrangement. The URL is where you live, not who you are. Apps show a name and an address; the
  key is an implementation detail users never see.
- **The device is the only signer; the hub is storage and serving.** Scheduled posts are
  pre-signed by the device and released by the hub.
- **Bring-your-own-client is the security property**, since a hub that ships the app can take the
  key. Therefore **the spec gains a small publish interface** — how any client writes signed files
  to any hub — so clients and hubs are a market, not a pairing.
- **One attestation shape for key change:** "key B succeeds key A," valid when signed by A
  (rotation) or by enough peers a reader already trusts (social recovery — at family scale,
  identity continuity *is* social, and the ex cannot fool the sister's own mother). Backup UX —
  keychain sync, passphrase-locked backup, recovery contacts, printed code — is app-level and
  the spec mandates none.
- **Relocation is a signed location list.** Readers remember every location a profile ever named
  and check the others when the primary goes stale; a new location statement with a higher
  `version` wins; the departing client offers "send this link to your people." Strangers who only
  knew the old location may be lost; a resolver is an extension slot, not a mechanism.
- **The publisher forgets; readers remember.** No retained versions, no permanent deletion
  record. Withdrawal is a signed line; what a reader already fetched is the reader's.
- **The completeness story is one paragraph.** A signed, versioned index lists what exists; a
  reader may pin it and notice when something it saw vanishes without a withdrawal.
- **Everything is pull.** An interaction is a post in its *author's* feed naming its target. Push
  (a ping endpoint), inbound interop, and DMs that must not exist on a feed are extensions, each a
  few restrictions: rate-limit by IP before fetching, fetch only from the author's known
  location, never republish what was delivered.
- **Three tiers, one mechanism:** public; encrypted to a chosen set of keys with the names encrypted
  inside; a DM is that with one recipient. Comments and reactions are posts, encrypted if the
  parent was. The hub learns that an encrypted post exists, when, roughly how big, and nothing
  about whom; clients poll on a fixed cadence so a fetch proves nothing. The envelope is
  re-chosen for simplicity (audited primitives, box-per-recipient), not kept for JWE's sake.
- **Signed posts are files, signed as the bytes served.** No canonicalization. The JSON Feed /
  Atom feed and the h-card page are *generated views* — the interop surface, required of
  publishers, never the signed object.

## The scenarios

Code defends scenarios, not rules. These seven are staged end to end in `test/scenarios.test.js`,
and every example's `.md` names the one it serves.

1. **The divorce.** Sister on the ex's hub: he cannot post as her, read her family-only posts,
   alter or backdate what she wrote, or stop her leaving; after she leaves, Mom's app follows her
   with one tap and reads his frozen copy as an older version of her, not as her. *(Reworded
   2026-08-21, the owner's ruling on `REVIEW-final.md` Q8 / intent-map sign-off 4: the original said
   "reads as stale", and it does not for a reader with no social path to her — that reader sees an
   unmarked page. Location-through-replies (§3.7, §5.4) is how people learn; every mechanism that
   would tell everyone else was priced and rejected. §13.3 states the limit.)*
2. **Grandma onboards.** Installs an app, picks a name, is never shown a key, never told to store
   a file outside the house. Loses her phone a year later and is back by calling her daughter.
3. **Two hubs, one thread.** Jesse on `jessepence.com`, Mom on the family hub; a family-only post,
   a reply, and a reaction cross hubs with no access control anywhere.
4. **The domain goes.** `pence.family` becomes unaffordable; everyone relocates; nobody's identity
   changes; existing readers find them from the location list.
5. **The big lazy hub.** Ten thousand people on one commercial hub; the operator is the ex at
   scale; every floor item holds; per-identity cost stays flat.
6. **The weekend.** A second implementer writes a publisher, then a reader, from the text, with
   no library beyond the standard one; a third writes a dumb hub that serves both.
7. **The stranger.** Someone follows a public journal in a plain feed reader, sees it on Mastodon
   via a bridge with nothing built, and — after the author's key loss — re-meets them.

## What was open here, and where it was answered

All five questions this document left open have answers in the spec now. They are listed so that a
reader can check the answer against the question rather than taking it on trust.

1. The publish interface's shape — §8: signed PUT at conventional paths, four paths and two verbs.
2. The encryption construction — §6: box-per-recipient from an ephemeral X25519, built from
   primitives a standard library already has. The NIP-44-class comparison is in `examples/envelope/`.
3. How many peers constitute social recovery, and whether a reader's trust set is ever published —
   §3.4 and §3.6: a committed list of salted leaves, settled by a majority and not by `k`, and never
   published beyond its size. `FINDINGS.md` records that `k` is still trusted in two places where a
   majority is meant.
4. The index's shape — §4: a third small signed file, and never the feed. §11 makes the feed a view.
5. Which implementation comes second — the weekend reader and publisher
   (`examples/weekend-reader/`, `examples/weekend-publisher/`), written from the text alone, plus a
   hub small enough to fit in eleven lines of an example.
