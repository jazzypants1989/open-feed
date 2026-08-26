# Generated views

**Spec:** §11, with §8's path table for where the three files are written and §12's publisher
paragraph for the SHOULD that requires them.
**Run:** `node examples/views/views.js`

A publisher SHOULD write three ordinary web files beside its signed ones: a JSON Feed 1.1 document
at `/<name>/feed.json`, an Atom feed at `/<name>/feed.xml`, and an h-card page at
`/<name>/index.html`. They are generated from the index and the posts, they are unsigned and
overwritable, and a hub MAY generate them itself instead. **They are how this protocol reaches
readers that have never heard of it** — a feed reader written in 2005 subscribes to alice's journal
without one line of Open Feed code in it.

That reach is bought with a second surface, and the second surface is one the host controls
completely. So §11 spends most of its words on what a view is *not*: **nothing in a view is signed,
and a view is never the index.** A view is something a host can regenerate; the index is something
only the author's key can produce (§4.6). An implementation MUST NOT treat a view as evidence of
anything.

## What the output shows

**Three views, generated from the index and the posts.** The example builds four posts — two public,
one encrypted, one withdrawn — reads them back through `src/reader.js` (§7), and prints all three
documents in full. They are real: the JSON Feed carries `version`,
`https://jsonfeed.org/version/1.1`, `title`, `home_page_url`, `feed_url`, `authors` and `items`; the
Atom feed carries the `id`/`title`/`updated`/`author` a feed needs and one `entry` per post; the
page is microformats2, an `h-card` with `p-name u-url` and an `h-feed` of `h-entry`s with
`dt-published` and `e-content`. Post 2's text contains `<b>Not</b> HTML & such.` and comes out
escaped in both the Atom feed and the page: a view escapes what it prints, because the text inside a
signed post is the author's and is not markup.

**Item ids are `urn:openfeed:<anchor key>:<n>`, not the URL.** The example prints the feed twice —
once at `https://alice.example/alice`, once after alice has moved to `https://pence.family/alice`
(§3.7). The URLs change; the ids do not, because the anchor key is the identity and the number is
the post (§3, §5.1). JSON Feed 1.1 says an id is ideally the item's full URL, since URLs make good
unique identifiers; here they make a bad one, because the URL is where alice lives and not who she
is. Give a plain feed reader URL ids and every post reappears as unread on the day the author
relocates — the one day a reader most needs to not be shouted at. Atom asks the same question at
feed level, and gets the same answer: the feed's own `<id>` is `urn:openfeed:<anchor key>`.

**Withdrawn posts are absent; encrypted posts are omitted; no view carries ciphertext.** Post 4 is
withdrawn (§4.2), so the reader never fetched it and no view mentions it. Post 3 is encrypted (§6):
the reader has it, the audience can open it, and it appears in none of the three documents. §11
allows either omission or an empty placeholder item at the encrypted post's number, and
`src/views.js` omits; the example asserts what matters under both readings, which is that the
envelope's `epk`, its slots and its `ct` appear nowhere in the three documents. A view MUST NOT
carry ciphertext. It would be an easy mistake — the envelope is JSON and it would round-trip through
a feed generator without complaint — and the result would be an unauthenticated blob served to
everybody who ever subscribed, sitting in feed-reader caches, for an audience of two.

**The h-card's name is the profile's `name`.** `name` is a signed member of the profile (§3.2), so
no hub chooses it; with no `name` the view falls back to the last segment of the location, which is
the hub's to choose and is therefore only a label. The link on that page carries the anchor key in
its fragment, `https://alice.example/alice/#pukq6VMQ…`, and a fragment is never sent in a request
(RFC 3986 §3.5) — the server sees `GET /alice/`. **But the page itself came from the host.** A
reader that scrapes the key out of a page the host served has learned the key from the host, and
§3.1 still applies: the key has to arrive by a route the host does not control. The fragment on a
generated page is a convenience for the person who copies the link into a message, not a first
contact. `examples/first-contact/` is the example for what does count.

**Nothing in a view is signed.** This is the centre of the example. The host rewrites
`/alice/feed.json` in place: it changes post 2's text to something alice did not write, and adds an
item at number 5 saying she has moved to his hub. The doctored file is still valid JSON Feed, still
parses, still renders. Read as a signed file (§2.1) it is `null` — there is no signature in it to
break. And the reader's verdict on the identity is still `ok`, because a §7 reader never fetches a
view at all.

Then the same three edits are made to the files the view was generated from, and the output puts
them side by side. Inventing a post takes an index entry, and an index the host signs is not signed
by the key the profile ends on. Changing post 2's text changes its address, and the index no longer
lists that post. Dropping post 1 leaves a number the index lists and the host does not serve. Three
`host` verdicts, and the reader names each one. Nothing about the view resisted; nothing about the
signed files gave way. That is the whole distinction §11 draws, in six lines of output.

**The stranger.** The last block runs both readers over the same origin at the same moment. The
plain feed reader parses the host's rewritten `feed.json` and shows three items, one of which never
existed. The Open Feed reader returns `host` and names the reason. The stranger is protected against
a network attacker, because §9 makes every fetch HTTPS to a public address, and against nobody else:
the host he is reading can invent, edit, backdate and unpublish anything on that page, and he has no
way to know. He has no key, does no verification, and runs no protocol code — which is exactly the
deal. This is `GOALS.md` scenario 7, the stranger, and priority 3, interop ("our content reaches
existing feed readers and the fediverse/Bluesky with nothing built"). Scenario 7's other two halves
— a bridge to Mastodon, and re-meeting the author after key loss — are not this example's; the
second is §3.4 and §3.6.

## Contrast

**A feed is a view, not the object.** `GOALS.md` records the decision in one line: "the JSON Feed /
Atom feed and the h-card page are *generated views* — the interop surface, required of publishers,
never the signed object." Earlier drafts of this project did the other thing. They made the JSON
Feed document *the* wire format: every extension field lived under an `_openfeed` member of a JSON
Feed item, the signature lived beside it as `_sig`, and a manifest listed the item ids and their
versions. `README.md` in the repo root still describes that design — it is queued for rewrite in
`PLAN.md`, so read it for the contrast and not as current.

What went wrong with it is instructive. Signing JSON Feed items means the *interop* format is also
the *security* format, so every question about one becomes a question about the other: which members
are inside the signature, what a bridge may add, what a tombstone may keep, how a feed reader that
knows nothing is supposed to survive a member it cannot parse. It also imports JSON Feed's own
requirements into the signed bytes — an item must carry a content field, so a "like" had to be an
item with `content_text: ""`. Splitting the two makes each one small: the signed files answer only
to §2, and the view answers only to whatever a feed reader wants this year. If JSON Feed 2.0 lands
tomorrow, `src/views.js` changes and nothing else does.

**ActivityPub** goes the opposite way: the wire object *is* the vocabulary, and interop means
agreeing about ActivityStreams types, JSON-LD contexts, and — for signing — RDF dataset
canonicalization before there are any bytes to sign at all. **Microformats and the IndieWeb** go
further still: the HTML page *is* the data, which is where the h-card this example generates comes
from, and a consumer parses your presentation to learn your facts. Open Feed generates both kinds of
surface and trusts neither. The h-card here is output, never input.

**Why "MUST NOT treat a view as evidence" earns a MUST.** Because the shortcut works. An implementer
who has to build a reader will find `feed.json` easier to parse than an index — no folding (§4.2),
no signature check, no chain walk (§3.3), no pin — and a reader built on it will display posts
correctly for every honest host, forever. It will simply provide none of the guarantees the protocol
exists for, and there is no test that shows the difference until the host is the one in §13.1 who
controls the serving path and does not cooperate. A SHOULD would be read as advice about tidiness.

**What interop buys, and what it costs.** It buys the stranger: reach into every feed reader and,
through a bridge, into networks nobody here has to build. It costs a second copy of the content that
the host can rewrite at will, which readers will find first, and which looks authoritative because
it is served from the author's own address. §11's answer is not to make the view trustworthy — it
cannot be — but to say so once, plainly, in the sentence next to the SHOULD that requires it.