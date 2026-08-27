# Open Feed — goals and scenarios

## Why this exists

The first prompt was about Tim Berners-Lee's SOLID: self-hosting and data privacy, done more
pragmatically than Mastodon or Bluesky, which are busy replacing Twitter. The project's real
adversary arrived later, from life: **if my sister had been on her abusive ex-husband's hub, he
would have controlled her words, her inbox, her archive, and her ability to leave — during a
divorce.** Everything the protocol guarantees is judged against that person. He is inside the
family, entitled to look, runs the server, and will not cooperate.

## What it must do — the floor

Stated as what a person can rely on, not as mechanisms:

1. **The hub cannot speak for you.** Nothing it serves as yours verifies unless you signed it,
   and the key that signs was never the hub's.
2. **The hub cannot read what wasn't meant for it.** Content for chosen people is unreadable by
   anyone else, the hub included.
3. **The hub cannot keep you.** You can leave at any moment with your identity and everything
   you wrote, without asking, because the key and the copy were always on your device.
4. **Family on other hubs are first-class.** Two relatives self-hosting on separate domains
   share, reply, and react to each other's family-only content as if they were on one hub.

Everything else is negotiable.

## Priorities, in order

1. **No dependencies.** Implementable from a language's standard library: Ed25519, X25519, SHA-256,
   ChaCha20-Poly1305, HKDF, HTTP, JSON, base64url. No canonicalizer, no JOSE library, no git binary.
2. **Easy to implement.** A second implementer finishes a publisher or a reader in a weekend from
   the text alone. Pushing on the tension between this and #1 is the intellectual point of the
   project.
3. **Interop.** Our content reaches existing feed readers and the fediverse/Bluesky with nothing
   built; their replies coming back is an extension.
4. **Minimal.** A goal, not a description. The shortest text that delivers the floor.

## Scenarios the gates must stage

Code defends scenarios, not rules. Every gate in this repository answers one of these, and a
scenario with nothing staging it is a claim rather than a result.

1. **The divorce.** Sister on the ex's hub: he cannot post as her, read her family-only posts,
   alter or backdate what she wrote, or stop her leaving; after she leaves, Mom's app follows her
   with one tap and reads his frozen copy as an older version of her, not as her. _The limit, stated
   rather than papered over: a reader with no social path to her sees an unmarked page. People learn
   where she went through the replies of people who know, and every mechanism that would tell
   everyone else was priced and rejected._
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

## Where each scenario is staged

| #   | scenario             | staged by                                                                                                                                  |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | the divorce          | `test/scenarios.test.js`                                                                                                                   |
| 2   | Grandma onboards     | `test/scenarios.test.js`                                                                                                                   |
| 3   | two hubs, one thread | `test/scenarios.test.js`                                                                                                                   |
| 4   | the domain goes      | `test/scenarios.test.js`                                                                                                                   |
| 5   | the big lazy hub     | `test/scenarios.test.js`                                                                                                                   |
| 6   | the weekend          | `examples/weekend-publisher/`, `examples/weekend-reader/` — and the weekend reader is one of the two readers that verify `test-vectors.md` |
| 7   | the stranger         | `test/scenarios.test.js`                                                                                                                   |
