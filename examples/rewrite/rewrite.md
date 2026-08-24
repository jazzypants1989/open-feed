# Rewriting

**Spec:** §4.7 rewriting, over §4.2 the fold and §7.2 a pinned reader across versions; §8.8 and
§13.1 for what withdrawal is not.
**Run:** `node examples/rewrite/rewrite.js`

Withdrawing a post is an appended line: `[n, null]`. The line that listed the post stays exactly
where it was, because appending is the only edit that leaves every earlier byte alone — which is
what lets a reader fetch the tail of an index it already holds (§4). So a withdrawal costs two
lines, and both of them are about a post nobody can read: the number that went, and the hash it
had. Rewriting is the author writing the whole file out again from the fold — the live set, in
order, and nothing else. Version `version` goes up by one and the lines are gone.

The reason to do it is privacy, and the honest version of that claim is smaller than it sounds.
Open Feed is a protocol in which readers keep what they fetched: that is not a leak, it is the
whole of §10 and the reason leaving a hub costs nothing. **The publisher forgets; readers
remember.** There is no permanent deletion record, no retained-version history, and no way to reach
into a copy someone else holds — and no verb that would let an author try. A rewrite changes what
the *next* person to fetch the index can see. It says nothing at all about the people who already
fetched it, and nothing at all about the host operator, who fetched every version by definition
(§13.1). Pretending otherwise would be the dishonest design, so §8.8 states the limit as a MUST
NOT: an app **MUST NOT** tell a user that withdrawing erased anything.

## What the output shows

**A withdrawal is an appended line, and a rewrite is what takes it away.** The example prints the
entries of Appendix B.10 and then of B.11 — the spec's own before and after, asserted byte for byte
including the signature line. Two of version 2's seven lines are about post 2, which is not there
any more: the listing and the withdrawal. Version 3 has neither. This is the one place the protocol
overwrites history rather than appending to it, and it is safe for exactly one reason, which the
next block is.

**The rewrite changes the file and never the live set.** Fold version 2's entries and fold the
lines a rewrite keeps: the same posts, the same media file, the same `top`. A rewrite is a
re-spelling of the answer the fold already gives, so no reader can tell the difference except by
looking at the byte count. `top` in particular does not move, because it is the highest number ever
issued and not the highest number listed (§4.3) — a rewrite that recomputed it from the live
entries would silently turn every reply to a withdrawn newest post into a rumor (§7.5).

**A reader that last saw version 1 returns at version 6.** This is the strongest form of "readers
are indifferent": in between are two rewrites and three appends, four of the six versions this
reader never fetched and never will. It reads `ok`. It is told `withdrawn: 3` — the one thing it is
owed, because post 3 is a post it held and no longer has — and that is a **note on an ok read**,
never a verdict (§7.3). Its pin quietly keeps the hash post 3 had, which is what makes the next
block possible.

**A number that comes back.** Appendix B.11 re-lists post 2 at the hash it had. That is legal, and
it is the *only* legal repeat: §4.2 allows a withdrawn number back at the identical hash and
nothing else. The example shows the pinned reader accepting it and then shows the illegal twin —
the same number back at a different hash — coming back as **host**, because the pin remembered.
The rule exists for the restore: a thief who held the current key and withdrew everything is
undone by the owner re-listing her own posts at their own hashes, and that has to work whether or
not he happened to rewrite first. The fold's half of the same rule — one hash per number *inside* a
single index — belongs to `the-index/`.

**Six per cent, measured.** The example builds a year of a family feed — 150 posts, one in twenty
withdrawn some weeks after it was published — and measures the lines a rewrite would drop as a
fraction of the signed file. It comes to **5.5%**, which is what the spec means by "about 6%".
Half a kilobyte off an eight-kilobyte file. Nobody should schedule a rewrite to save that, and a
publisher who reasons about it as a size problem has already misread it; the reason to rewrite is
that the withdrawn line stops being public.

**What it buys, and what it does not.** After the rewrite the index carries no line about post 3 at
all, and a reader arriving now sees a feed in which it never existed. Three things do not change.
Post 3's bytes are still served at `/posts/3` and still verify — there is no DELETE verb, an author
cannot overwrite her own post, and the fold refuses a withdrawal of something that was never listed
(§8.8). An honest hub **MAY** remove a file the current index does not list, which is how it can
honour a deletion request, and it is a MAY because no reader depends on it either way. And an
operator who kept every version he ever served still holds version 4, which contains `[3,null]` —
the line, the hash, and the hour he served it. That is `GOALS.md` scenario 1, the divorce, and
scenario 5, the same operator at commercial scale: against him the protocol's answer is never
confidentiality after the fact, it is **exit** (§10, §13.1).

## Contrast

Every protocol that lets people publish has to answer "what does delete mean," and the honest
answers are all smaller than users expect.

- **Mastodon's `Delete` activity** is a message sent to the instances the server believes have a
  copy. It is best-effort in every direction: an instance that was down misses it, an instance that
  never received the original ignores it, an instance running modified software may keep the row,
  and caches, bridges, and search indexes retain what they scraped. It is a request to cooperating
  peers, which is a reasonable design — but it produces the belief that deletion propagated, which
  is the belief §8.8 forbids an app from creating.
- **The "right to be forgotten"** is a claim against a data controller, enforced by a regulator. It
  is a real remedy and it does not survive translation into a signed-file protocol, because there
  is no controller: the bytes are signed, self-verifying, and already on other people's disks.
  Open Feed cannot honour an erasure demand against a holder who declines, and does not offer to.
  What it can do is make leaving cost nothing, which is the remedy that fits the adversary in
  §13.1 — a person, not a company, who will not cooperate and cannot be sued into it.
- **Signal's disappearing messages** are the closest analogue to a rewrite: a timer that
  cooperating clients honour. Signal is careful to say so. A modified client, a screenshot, or a
  second phone in the room defeats it entirely, and the feature's value is that it makes forgetting
  the default between people who are not attacking each other. A rewrite has exactly that shape and
  exactly that limit.
- **Git** is the closest structural analogue. `rebase` or a history rewrite produces a new
  history, and the old objects stay reachable by hash — in the reflog, in dangling objects, in
  every clone — until somebody prunes them, which no other clone will do for you. An Open Feed
  index is the same trade at a smaller scale: the new version is authoritative, the old one is
  still whatever anyone kept.

The one thing a rewrite does buy is worth stating carefully, because it is easy to oversell.
Withdrawal removes a post from the live set immediately, for everyone, on the next fetch of the
index — that part is not best-effort, because the index is signed and the fold is arithmetic. What
the rewrite adds is that the *record of the withdrawal* stops being served: a stranger arriving
next month reads a feed with no gap in it, and does not learn that on some Tuesday there was a post
at number 3 and the author took it down. That is a real privacy gain against the public and against
future readers, and it is the entire gain. It buys nothing back from anyone who already looked.
