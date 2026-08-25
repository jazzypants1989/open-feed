# Fetching

**Spec:** §9 fetching, with §7.5 the rumor rule and the beacon, and §7.3 the three verdicts.
**Run:** `node examples/fetching/fetching.js`

Every rule in §9 binds a reader's outbound requests, and none of it is optional politeness. The
rumor rule (§7.5) follows a URL that a **replier** chose: someone writes a reply naming a target,
puts a `loc` on it, and a reader that holds a pin for the targeted identity goes and fetches it. So
a reader's fetch layer sits in front of attacker-supplied addresses **by design**, not by accident,
and it is the one part of the protocol where a miss is a vulnerability rather than a bug.

That is why §9 reads like a security chapter rather than a transport chapter. HTTPS only. At most
five redirects, never to a different origin. Refuse non-public addresses — checked on the
**resolved** address, before the socket connects. Bound the timeout, the body, the sockets and the
identities. And when a bound is hit, say nothing about the publisher: a reader that could not
complete a read has **no verdict**, which is not the same thing as a bad one.

## What the output shows

**HTTPS only, because the address came from a stranger.** `assertUrlAllowed` is the whole scheme
rule: `https:` is the only member of the default `protocols` list, so `http:`, `file:` and `ftp:`
all come back `bad_scheme` before anything opens a socket. Certificate validation is the other half
of "HTTPS only" and does not print here, because it is the platform's: `createFetcher` passes no TLS
options by default, so the system CA store and hostname verification apply unchanged. The only place
in the repository that overrides them is `test/helpers/site.js`, which pins the CA for the
hand-encoded loopback certificate.

**Every range in the blocked table, judged on the address.** The example walks the whole §9 list —
all fourteen IPv4 CIDRs and the IPv6 forms — through `isPublicAddress` in `src/addresses.js`, with
two ordinary public addresses at the end so the table proves it can still say yes. `169.254/16` is
the row to look at twice: link-local is where cloud metadata services live, and "fetch this URL for
me" pointed at `169.254.169.254` is the single most productive SSRF payload there is.

**Every embedded-IPv4 form is judged as the IPv4 address it carries.** `::ffff:127.0.0.1`, the
deprecated `::127.0.0.1`, the translated `::ffff:0:127.0.0.1`, NAT64's `64:ff9b::/96` and
`64:ff9b:1::/48`, and 6to4's `2002::/16` all reach an IPv4 destination through an address that
passes a naive IPv6 check. Seven forms is exactly the kind of list a second implementer gets wrong,
which is why the spec enumerates them and why the example prints them as a table with verdicts. The
last row is `::ffff:93.184.216.34`, allowed: the same unwrapping has to say yes to a public address,
or the rule is just "no IPv6."

**A dotted quad with a leading zero is refused, not guessed at.** `0177.0.0.1` is `127.0.0.1` to a
resolver that reads a leading zero as octal (`inet_aton` does) and `177.0.0.1` to one that does not.
The disagreement is itself the bypass — a checker that reads it one way and a resolver that reads it
the other is a hole with no bug in either half — so `parseIPv4` refuses to pick a side and returns
`null`, and what is not an address is not public. `177.0.0.1`, the same digits without the zero, is
an ordinary public address and stays allowed.

**The check is on the resolved address, and runs before the socket connects.** This is the heart of
the chapter. A hostname tells you nothing: `innocent.example` is a name whose zone the attacker
owns, and it can answer `127.0.0.1` any time it likes. So `src/fetch.js` installs a `lookup` hook
(`guardedLookup`) that resolves the name, drops every answer the policy refuses, and hands the
socket only what survived. The example injects a resolver instead of using real DNS, so the block
runs offline: a name answering only loopback is `blocked_address` with no connection attempted, a
mixed answer is *filtered* down to the public address rather than rejected outright, and
`0177.0.0.1` — which `net.isIP` does not recognise as a literal at all — is caught on the way back
from the resolver. The last row is the other half: `https://169.254.169.254/x` is refused on the
URL, and the example asserts the resolver was never called, because Node never calls `lookup` for a
host that is already an IP literal.

**At most 5 redirects, and never to a different origin.** These five rows and the byte cap below run
against a throwaway HTTP origin on `127.0.0.1` — no DNS, nothing off this machine — because a
redirect rule can only be shown by following one. A same-origin `302` is followed. A `302` to
`elsewhere.example` is `cross_origin_redirect`: **a cross-origin redirect is never identity
equivalence**, because moving is expressed in the profile's location list (§3.7), signed by the
person moving, and not in a `Location` header written by whoever holds the socket. A `302` to
`169.254.169.254` is `blocked_address` and a `302` to `gopher:` is `bad_scheme` — every link is
re-checked for scheme and address, not just the first, which is what turns "the first URL was safe"
into "every URL was safe." And a `302` that points at itself stops at five: the origin counts six
requests, the initial one and five follows.

**Bound everything.** The timeout (10 s) covers connect, redirects and body read *together*, under
one deadline rather than one per step — three ten-second steps is a thirty-second read. The body cap
is per fetch, 1 MB for the profile, the index and a post, larger for media, and the last row shows
one being hit: a 64 KiB body under a 1 KiB cap is `too_large`, and the transfer is destroyed rather
than buffered and then measured. `MAX_SOCKETS_PER_ORIGIN` bounds concurrency per origin, and
`MAX_IDENTITIES_PER_PASS` bounds how many identities one pass will resolve — the bound that keeps a
reply storm from turning one reader's pass into a thousand fetches aimed at somebody else's host.

**A cap is no verdict, not an accusation.** The most important block in the example, and the easiest
one to get wrong in an app rather than in a protocol. The first row is a hub that answered and
answered wrongly: no profile at the location, verdict **host**, and that is evidence about a hub.
The next three are a body over the cap, a timeout, and a name that does not resolve — and each one
comes back out of `read()` as a thrown `FetchError` with no `verdict` on it at all. §7.3 has three
verdicts and this is not a fourth; it is the **absence** of one. The read did not complete and the
publisher may have done nothing, so an app shows "could not check", never a state of the identity.
The `transient` flag carries the rest of the rule: a reader SHOULD retry before reporting **host**,
and SHOULD distinguish "I could not reach this" from "this was answered, and wrongly."

**Following a reply's `loc` is both the feature and the beacon.** The last block runs the rumor rule
with a reader whose fetches all fail, purely to watch the order of addresses it tries. Two replies
from dad name post 9 of mum, above the `top` of 4 this reader pinned, so the reader looks again —
and it tries the two locations it already holds **first**, and the address dad wrote **last**, which
is the permission §7.5's last paragraph grants: "a reader MAY try the locations it already holds
before the address in the reply." Two replies cost three fetches, not six: look again at most
once per identity per pass. And one line comes out, not two: say one line per person, however many
replies they wrote. The beacon is what is left over after all of that. Fetching an address a replier
chose tells that replier the address and the moment of every reader that holds a pin for the name
they targeted. §9's caps bound what it costs; they do not make it private. The spec names the price
rather than hiding it, because the alternative — not following `loc` — is the reader who never finds
someone who moved.

## Contrast

**SSRF is the frame.** Server-Side Request Forgery is normally a bug: an application accidentally
lets a user steer an outbound fetch. Here it is the *normal operation* — the protocol's rumor rule
deliberately fetches a URL a stranger wrote — so the defence has to be in the specification rather
than in a code review. The concrete attack is DNS rebinding: an attacker registers a name, points it
at a public address, and the reader's checker approves it. Between that approval and the connection,
the same name resolves again — a one-second TTL, a second answer in the same record set, a resolver
cache that expires between the two calls — and the socket goes to `127.0.0.1`, or to
`169.254.169.254`, or to a printer on the reader's LAN. Nothing in the URL changed. This is why §9
says the check is on the resolved address *before the socket connects*, and why `src/fetch.js` uses
a custom `lookup` rather than a validate-then-fetch pair: the address that was checked is the
address that is connected to, with no second resolution in between. It is also why hostname
allow/deny lists do not work at all. `localtest.me` resolves to `127.0.0.1` and is on nobody's deny
list; an attacker controls their own zone and can mint an unlimited supply of names that do the
same. A name is not a destination.

**Other federated systems fetch arbitrary URLs too, and mostly leave the rules to the
implementation.** ActivityPub servers dereference remote object URLs as a matter of course, and SSRF
has been a recurring bug class in fediverse software as a result — Mastodon alone has shipped
advisories for the WebFinger fetch, for missing IP ranges, for the IPv6 `::` form and for the
IPv4-compatible and IPv4-mapped forms, the last three being exactly the embedded-IPv4 cases §9 spells
out. The protocol says what to fetch, offers a sentence of advice about localhost, and leaves the
list to each implementation, so every implementation gets to have the bug separately. Pingback is
the sharper historical case: an endpoint that accepts a URL and fetches it
was used at scale for reflected DDoS and for port-scanning from the inside of other people's
networks, and the amplification came from exactly the property Open Feed's rumor rule has — one
attacker-supplied address, many servers willing to fetch it. RSS aggregators have the same shape
whenever they fetch a feed URL, an enclosure, or a favicon on a user's say-so. What §9 changes is
not the exposure but where the rules live: in the normative text, with the ranges written out, so
that the second implementer from `GOALS.md` scenario 6 gets them right without having to already
know they exist.

**Why the spec enumerates the ranges instead of saying "block private addresses."** Because
"private" is not a definition anyone implements identically. Is CGNAT private? Is `0.0.0.0`? Is the
6to4 form of `10.0.0.0/8`? Two implementers who agree on the sentence and disagree on the list have
produced an interoperability gap that is also a bypass — and the reader with the shorter list is the
one whose users get hurt. The leading-zero dotted quad is the sharpest example of the same principle
one level down: even the parse of an address is somewhere two implementations can disagree, so the
spec refuses the ambiguous form outright rather than standardising a reading of it.

**"No verdict is not a verdict."** This is the piece of §9 that is a user-interface rule wearing a
protocol rule's clothes, and it is worth stating plainly: if a failure to reach a host is reported
as evidence about the host, then every flaky coffee-shop connection becomes an accusation against
somebody's aunt. The verdicts in §7.3 are strong claims — **this host is misbehaving** is a thing
you would tell a family about a person's hosting provider — and they are only worth anything if they
are never raised by a timeout. So §9 makes the distinction structural rather than advisory: a
transport failure is a thrown `FetchError` with no verdict field on it, and there is no code path
that turns one into a verdict. An implementation that displays a fourth state has four states, and
one of them cries wolf.

**The scenarios this serves.** `GOALS.md` scenario 5, the big lazy hub, is the one the caps are for:
ten thousand identities on one commercial hub, per-identity cost flat, which only holds if a pass
has a ceiling on identities, redirects, bytes and sockets. Scenario 1, the divorce, is what the
address guard and the beacon paragraph are for: the operator of the hub may be the abuser, he can
write replies too, and a reader that follows `loc` first instead of last hands him a list of
everyone who still watches for his ex. Scenario 4, the domain goes, is why `loc` is followed at all
— the location list in the profile is how existing readers find someone who relocated, and the reply
is the path for the reader who has fallen behind. 