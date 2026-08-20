# Open Feed — goals and scenarios

**Draft, 2026-08-20. Written by an agent from the owner's answers in one long conversation, for the
owner to argue with.** This is the document every previous rewrite was missing: the floor the spec
is judged against, in plain words, before anyone writes a rule. Nothing below is normative. When
this survives the owner, the sketch is written *from* it, and every section of the sketch must
point back at a line here or be cut.

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

## Decisions taken in this conversation

Each reverses or retires something the current spec spends thousands of words on. The recorded
reasoning for the old position is answered in `rejections.md` as the sketch lands.

- **Identity is a key.** A signed profile names current location(s), keys, and recovery
  arrangement. The URL is where you live, not who you are. Apps show a name and an address; the
  key is an implementation detail users never see. *Retires:* URL normalization and its
  percent-encoding question, migration/successor/predecessor links, predecessor equivalence and
  its seven sites, recovery pins.
- **The device is the only signer; the hub is storage and serving.** Scheduled posts are
  pre-signed by the device and released by the hub. *Retires:* delegated keys, cadence batching,
  the export bundle (you always had the copy), on-demand-export custody rules.
- **Bring-your-own-client is the security property**, since a hub that ships the app can take the
  key. Therefore **the spec gains a small publish interface** — how any client writes signed files
  to any hub — so clients and hubs are a market, not a pairing.
- **One attestation shape for key change:** "key B succeeds key A," valid when signed by A
  (rotation) or by enough peers a reader already trusts (social recovery — at family scale,
  identity continuity *is* social, and the ex cannot fool the sister's own mother). Backup UX —
  keychain sync, passphrase-locked backup, recovery contacts, printed code — is app-level and
  the spec mandates none. *Retires:* recovery keys held outside the home, `_recovery_sig`, fork
  resolution, the genesis-fingerprint ceremony.
- **Relocation is a signed location list.** Readers remember every location a profile ever named
  and check the others when the primary goes stale; a new location statement with a higher
  sequence wins; the departing client offers "send this link to your people." Strangers who only
  knew the old location may be lost; a resolver is an extension slot, not a mechanism.
- **The publisher forgets; readers remember.** No retained versions, no permanent deletion
  record. Deletion is a signed tombstone; what a reader already fetched is the reader's. *Retires:*
  derived version URLs, skip links, history budgets, the walk, the `deleted` map, §13.8's leak.
- **The completeness story is one paragraph.** A signed, sequenced head lists what exists; a
  reader may pin it and notice when something it saw vanishes without a tombstone. *Retires:*
  derived item URLs, `items: true`, the lag/withheld/violation/stale lattice, freshness deadlines,
  item-carried pins as a mechanism, the compare-rule apparatus.
- **Everything is pull.** An interaction is an item in its *author's* feed naming its target. Push
  (a ping endpoint), inbound interop, and DMs that must not exist on a feed are extensions, each a
  few restrictions: rate-limit by IP before fetching, fetch only from the author's known
  location, never republish what was delivered. *Retires:* the inbox pipeline, dedup/oracle rules,
  delivery chains, the published/delivered split.
- **Three tiers, one mechanism:** public; encrypted to a chosen set of keys with the names sealed
  inside; a DM is that with one recipient. Comments and reactions are items, encrypted if the
  parent was. The hub learns that an encrypted item exists, when, roughly how big, and nothing
  about whom; clients poll on a fixed cadence so a fetch proves nothing. The envelope is
  re-chosen for simplicity (audited primitives, box-per-recipient), not kept for JWE's sake.
- **Signed items are files, signed as the bytes served.** No canonicalization. The JSON Feed /
  Atom feed and the h-card page are *generated views* — the interop surface, required of
  publishers, never the signed object.

## Scenarios the gates must stage

Code defends scenarios, not rules. Every gate in the redesign answers one of these:

1. **The divorce.** Sister on the ex's hub: he cannot post as her, read her family-only posts,
   alter or backdate what she wrote, or stop her leaving; after she leaves, Mom's app follows her
   with one tap and his frozen copy reads as stale, not as her.
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

## Still open (the sketch must answer, in this order)

1. The publish interface's shape — signed PUT of files at conventional paths is the candidate.
2. The encryption construction — the NIP-44-class evaluation stands commissioned.
3. How many trusted peers constitute social recovery, and whether a reader's trust set is ever
   published (today's answer: never).
4. The head's shape when items are separate files: whether a feed view is also the head, or the
   head is a third tiny signed file.
5. Which implementation comes second — recommended: a dumb hub plus a CLI client, because that
   pair proves bring-your-own-client and static hosting at once.
