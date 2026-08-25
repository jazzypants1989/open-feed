# Moving

**Spec:** §3.7 locations and moving, §5.4 `target.loc` for the mechanism, §13.3 for the limit.
**Run:** `node examples/moving/moving.js`

Your identity is your anchor key (§3), so a location is only where the files happen to sit. Moving
is therefore not an identity event: you write the same signed files somewhere else and publish a
profile with a higher `version` naming the new place. Nothing has to be signed by the old host,
asked of it, or served from it — which matters, because the host you are leaving is often the one
this protocol is built against (§13.1).

What that buys is exact, and worth stating in both directions. **Identity survives the move without
anyone's cooperation; reach survives only through people who reply to you.** A reader that holds a
location you no longer answer at, and has no social path to you, is not reached. §13.3 says so
rather than papering over it.

## What the output shows

**Where she is hosted changed; who she is did not.** alice is on `pence.family`, which becomes
unaffordable (`GOALS.md` scenario 4). She writes her files to `alice.example` and publishes a
profile at `version` 2 naming both places; the anchor key printed under before and after is the same
43 characters, and it signed both files. The posts she carried across are the *same bytes* she
signed (§2.3), so post 1 keeps its address and the index entry that lists it is unchanged — a
relocation is not a re-publication. The last line of the block is the other half of how people are
told: the §3.1 link, the location with the anchor key in its fragment, which is what "send this to
your people" means (see `first-contact/`).

**A reader remembers every location a verified profile has ever named.** Three reads with the
remembered set beside each: `pence.family`, then both, then both again — because her `version` 3
names only `alice.example`, and the reader does not forget. That is the MUST in §3.7, and it is what
makes the next block work. The set lives in the reader's pin, which is the reader's own state and
never a wire member.

**The reader who never learns the new location is the honest limit.** `pence.family` goes on serving
the last profile alice wrote there, and can do so forever. sis, whose pin is that profile and who
has no social path to alice, reads `ok`: `version` 1, `top` 1, one post, no notes. An unmarked page.
Not an error, not a redirect, not a "moved" marker — there is nowhere for a marker to come from that
she would have any reason to believe. The identical bytes read against mum's pin, which has followed
alice, are refused as `identity — an older profile than the one this reader saw`. Only a reader that
has been somewhere else can read the frozen copy as old, which is why `GOALS.md` scenario 1 was
reworded to say exactly that.

**When one location stops answering, the reader tries the others.** The domain finally lapses.
mum's app is still pointed at it, gets a transport failure — **no verdict at all** (§9), not an
accusation about anybody — and tries the other location it remembers. Two lines later she is reading
alice again, against the pin she already held, and no third party was asked anything.

**The address rides along in other people's posts.** sis has no social path to alice until mum
writes a public reply. §5.4 makes all four members of `target` REQUIRED, and `loc` is where the
replier last knew that author to live. The fetch trace is the whole mechanism in five lines: sis's
reader tries the location she already holds first (§7.5), finds nothing answering there, then tries
the address in the reply — and comes back holding `version` 3 and `top` 2. No rumor is raised,
because having followed she can now see the post the reply names.

**A `loc` aims a fetch, and only what verifies there moves anybody.** bro's own post names alice at
an address he controls, signed by him and listed in his own index. It verifies, and the reader does
fetch the address it names — once, after the locations it already holds (§7.5). What is served there
is a profile carrying alice's anchor and bro's signature, and the verdict is `identity — the profile
is not signed by the key it ends on`. The pin does not move. What is at the far end still has to
verify under the anchor key the reader learned out of band (§3.1, §7.1); without that check this
would be an open redirect for the whole network. The fetch itself is the price, and §7.5 names it:
following a reply's `loc` is both the feature and a beacon, which is why it is bounded to once per
identity per pass. (A reply that does not verify never reaches the rumor step at all — that is §7.4,
and `examples/the-reader/` stages it.)

**Relocation rides along in public replies only.** The `rel`, the `target` and its `loc` of an
encrypted reply are inside the envelope (§6.5; `examples/envelope/` shows the public members are
`n`, `at` and `encrypted` and nothing else), so an encrypted reply moves nobody who was not already
in its audience. That is a real cost of keeping the reply graph off the wire, and §3.7 states it
rather than pretending the mechanism is universal.

## Contrast

Every other design answers "how do people find you after you move" by asking somebody to cooperate.

- **Mastodon / ActivityPub.** Migration is `alsoKnownAs` on the new account plus a `Move` activity
  issued *from the old one*: you must still be able to log in to the server you are leaving, and it
  must be willing to emit the activity. Followers transfer; posts do not. Open Feed's adversary is a
  host that will not cooperate, so a migration whose first step is an action by the old host is not
  available at all.
- **AT Protocol / Bluesky.** The closest comparison, and a good design: identity is a DID that
  survives a move between hosts, and a holder of the rotation key can repoint the DID document
  without the old host's blessing. The cost is the resolution layer everyone must consult —
  `did:plc` is a directory, `did:web` is a domain you have to keep paying for. Open Feed's
  `locations` is the cheap version of the same idea: no directory and no log, and the price is that
  the list is only as current as the last profile a given reader verified.
- **HTTP 301 and `Link rel=canonical`.** The redirect is served by the host you left. It is the
  right answer when you own both ends and useless in exactly the case this protocol cares about.
  §9 refuses cross-origin redirects for the same reason: a `Location` header is not identity
  equivalence, and moving is expressed in the profile.
- **Changing your email address.** The baseline everybody already knows: you tell people one at a
  time, and some never hear. §3.7 is that, made mechanical — the telling happens inside public
  replies written by people who already know where you are, so it reaches everyone with a social
  path to you and nobody else.

This example is `GOALS.md` scenario 4 — *"`pence.family` becomes unaffordable; everyone relocates;
nobody's identity changes; existing readers find them from the location list"* — staged end to end,
with scenario 1 (the divorce) as the reason the old host can never be asked to redirect, to serve a
marker, or to say anything at all.
