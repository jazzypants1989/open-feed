# Fetching

**Spec:** §9 fetching, with §7.4 the rumor rule and the beacon, and §7.2 the three verdicts.
**Run:** `node examples/fetching/fetching.js`

Every rule in §9 binds a reader's outbound requests, and none of it is optional politeness. The
rumor rule (§7.4) follows a URL that a **replier** chose: someone writes a reply naming a target,
puts a `location` on it, and a reader that holds a checkpoint for the targeted identity goes and fetches it. So
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
equivalence**, because moving is expressed in the profile's location list (§3.5), signed by the
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
reply storm from turning one reader's pass into a thousand fetches aimed at somebody else's hub.

**A cap is no verdict, not an accusation.** The most important block in the example, and the easiest
one to get wrong in an app rather than in a protocol. The first row is a hub that answered and
answered wrongly: no profile at the location, verdict **tampered**, and that is evidence about a hub.
The next three are a body over the cap, a timeout, and a name that does not resolve — and each one
comes back out of `read()` as a thrown `FetchError` with no `verdict` on it at all. §7.2 has three
verdicts and this is not a fourth; it is the **absence** of one. The read did not complete and the
publisher may have done nothing, so an app shows "could not check", never a state of the identity.
The `transient` flag carries the rest of the rule: a reader SHOULD retry before reporting **tampered**,
and SHOULD distinguish "I could not reach this" from "this was answered, and wrongly."

**Following a reply's `location` is both the feature and the beacon.** The last block runs the rumor rule
with a reader whose fetches all fail, purely to watch the order of addresses it tries. Two replies
from dad name post 9 of mum, above the `highest` of 4 this reader checkpointed, so the reader looks again —
and it tries the two locations it already holds **first**, and the address dad wrote **last**, which
is the permission §7.4's last paragraph grants: "a reader MAY try the locations it already holds
before the address in the reply." Two replies cost three fetches, not six: look again at most
once per identity per pass. And one line comes out, not two: say one line per person, however many
replies they wrote. The beacon is what is left over after all of that. Fetching an address a replier
chose tells that replier the address and the moment of every reader that holds a checkpoint for the name
they targeted. §9's caps bound what it costs; they do not make it private. The spec names the price
rather than hiding it, because the alternative — not following `location` — is the reader who never finds
someone who moved.

