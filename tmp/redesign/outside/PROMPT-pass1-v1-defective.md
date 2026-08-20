# Design brief

You are a protocol designer. Below is a design brief. Design the protocol it describes, from first
principles. Assume nothing about how such a system "usually" works. You are not being asked to
profile, extend, or patch an existing protocol — though if you believe an existing one already
solves this, say so and make the case.

## 1. What is being built

A specification for decentralized personal publishing and interaction. A person publishes writing,
photos, and short posts; other people read them, reply, and react. There is no central service.
Anyone can run a "hub" — a server that stores and serves one or more people's content over HTTPS. A
hub may be a person's own domain, a relative's box in a closet, or a commercial host with ten
thousand customers on it.

The initial audience is families and small groups. The design must scale across many identities
(many people on a few large hubs), not to millions of items per person.

## 2. The adversary

This is the design's center of gravity, and every answer is judged against it.

The operator of the hub may be an abusive family member. Picture a divorce: one spouse runs the
family hub; the other spouse's identity, writing, photos, private messages, and archive all live on
it. The hostile operator is *inside* the family — entitled to see family-only content, holding
legitimate credentials, controlling storage, serving, any inbound message path, and the exit. They
will not cooperate. They are technically capable and motivated.

No confidentiality mechanism defeats someone who is inside the audience. The question is what
remains true anyway.

## 3. The floor — four assurances, as what a person can rely on

1. **The host cannot speak for you.** Nothing it serves as yours verifies unless you signed it, and
   the key that signs was never the host's.
2. **The host cannot read what wasn't meant for it.** Content addressed to chosen people is
   unreadable by anyone else, the host included.
3. **The host cannot keep you.** You can leave at any moment with your identity and everything you
   wrote, without asking permission, because the key and a copy were always on your device.
4. **People on other hubs are first-class.** Two relatives self-hosting on separate domains share,
   reply, and react to each other's family-only content as if they were on one hub, with no
   access-control agreement between the hubs.

Everything else is negotiable. If you think one of these four is unachievable, or achievable only at
a price not worth paying, say so explicitly and argue it — that is a useful answer.

## 4. Priorities, in order

1. **No dependencies.** Implementable from a language's standard library: Ed25519, SHA-256, HTTP,
   JSON, base64. No JSON canonicalizer, no JOSE library, no git binary, no blockchain, no DHT, no
   global registry or directory service.
2. **Easy to implement.** A second implementer finishes a publisher or a reader in a weekend, from
   the text alone. The tension between this and #1 is the intellectual point of the project.
3. **Interop.** The content reaches existing feed readers (RSS / Atom / JSON Feed) and the
   fediverse / Bluesky with nothing extra built. Their replies coming back is an extension, not a
   requirement.
4. **Minimal.** The shortest text that delivers the floor. A goal, not a description.

## 5. Explicit non-goals

- Human-readable wire bytes. Nobody reads them.
- Continuity of a stranger's view of you across total key loss.
- Millions of items per identity.
- Global consensus, tokens, or any shared ledger.
- Anonymity or traffic-analysis resistance beyond hiding *who* an encrypted message is for.

## 6. Scenarios the design must survive

1. **The divorce.** A woman's account lives on her hostile ex-partner's hub. He cannot post as her,
   read her family-only posts, alter or backdate what she wrote, or stop her leaving. After she
   leaves, her mother's app follows her with one tap, and his frozen copy of her old content reads
   as stale rather than as her.
2. **Grandma onboards.** She installs an app, picks a name, is never shown a key, and is never told
   to store a file outside the house. A year later she loses her phone. She is back by calling her
   daughter.
3. **Two hubs, one thread.** A on `a.example`, B on `family.example`. A family-only post, a reply,
   and a reaction cross the hub boundary, with no access-control configuration on either hub.
4. **The domain goes.** `family.example` becomes unaffordable. Everyone moves. Nobody's identity
   changes. Existing readers find them.
5. **The big lazy hub.** Ten thousand people on one commercial hub. The operator is hostile at
   scale. Every floor item still holds and the hub's per-identity cost stays flat.
6. **The weekend.** A second implementer writes a publisher, then a reader, from the text, with no
   library beyond the standard one. A third writes a dumb hub that serves both.
7. **The stranger.** Someone follows a public journal in an ordinary feed reader and sees it on
   Mastodon through a bridge with nothing built. After the author's key loss, they re-meet the
   author.

## 7. What we want back

Not a finished RFC. A design, argued:

1. **The architecture in one page.** What artifacts exist, what each is for, what is signed, and
   what a reader fetches on first contact and on a poll.
2. **The identity primitive**, and why. What *is* a person, to this protocol? Argue against the
   alternatives you rejected.
3. **How each of the four floor assurances is delivered**, mechanism by mechanism, with the failure
   mode named.
4. **Scenario walk-throughs** for at least 1, 2, 3, and 4.
5. **Key change and recovery** — rotation, loss, theft, and a contested departure in which the
   hostile operator claims the departure is the forgery.
6. **The encryption construction** for assurance 2, in enough detail to implement: what is
   encrypted, to whom, how recipients are addressed without publishing the audience, and what the
   hub learns anyway.
7. **The honest cost sheet.** What your design is bad at, what it cannot deliver, where it is more
   complex than it looks, and which of your choices you are least sure of.
8. **What you would cut** if forced to halve the specification.

Where you make a nonobvious choice, name the alternative you rejected and why. Where you are
uncertain, say so — a flagged uncertainty is worth more than a confident sentence. Be concrete; show
the shape of the bytes where it matters. Length: as long as it needs to be. We would rather read
4,000 words of argued design than 800 words of outline.
