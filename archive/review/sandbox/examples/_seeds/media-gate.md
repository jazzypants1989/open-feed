# media-gate — the fourth file kind, end to end

**Candidate gate** (`../HANDOFF-final-review.md` §1.E; RULINGS §10.6). Substrate: the weekend reader
and publisher over a real loopback socket.

**Question.** §10.6 puts media in the index "so retention is one rule and reaches encrypted posts." A
blob is the only unsigned file. It had never been listed, fetched, withheld or swapped in any gate —
and the index's entry shape, `[n, hash]`, had no room for it. What admits it, what a reader does when
a listed blob is withheld or swapped, and whether a griefer can do to a hash what §11.5 found he
could do to a number.

**The shape on trial.** An entry `[hash]` lists a media file; `[hash, null]` withdraws it; the bytes live
at `/<name>/media/<hash>`. What admits the blob is being listed; what checks it is the hash. A post
names media by hash in `media`; a encrypted post names them inside the envelope, so the clear post
carries no `media` field and the hub learns only that a blob of some size exists.

**Method.** Seven claims: a media file listed and referenced, read pinned and cold; withheld; swapped; a
post naming an unlisted hash; withdrawn, then rewritten, then a second media file through a second
rewrite; a griefer putting junk at her media file's hash before she does, on a hub that checks content on
a collision and one that does not; a encrypted post's media file.

**Numbers** (stale if the entry shape changes):
- A media file costs **48 B** in the index (`,["<43 chars>"]`). Ruling 6 said ~55.
- Withheld: `host — media file … is listed and not served`. Swapped: `host — media file … is not what the index
  lists`. A post naming an unlisted hash: `ok`, the post present, the media file absent, nothing said.
- Withdrawn: `withdrawn: <hash>` on a pinned read; the rewrite drops the lines; the bytes are still
  served — **withdrawal is not deletion**, as for posts (`gapless-gate`).
- The griefer: junk at her hash is 201 on both hubs. On the hub that checks content on a collision
  her real bytes land (200) and her readers read `ok`; on the one that does not, her bytes are
  refused (409) and **her own readers accuse her host** — `media file … is not what the index lists`.

**What the reader needed** (+2 lines, 159 → 161): a media file is new whenever it appears, because it
has no number and so no `top` — the rewrite check must skip string keys or every media file is "listed
now and was not before". And the hash check on the bytes is the whole verifier for this kind.

**Kill criterion.** A withheld or swapped blob the reader does not catch; a new media file a pinned
reader calls an insertion; a griefer who can make the author's readers accuse her host; an entry
wider than ~55 bytes; a media file's reference visible beside a encrypted post. **Not triggered** — but the
third one is triggered on a hub that does not check content on a collision, which is the finding.

**Revert-checked** (`revert.js`, 3 rows): dropping the hash check on fetched bytes (the swapped row
goes red); treating media under the numbered rewrite check (the first row goes red — a new media file
reads as an insertion); the hub refusing every taken hash (the griefer row goes red).

**Verdict.** Media fit the index as one-element entries and cost the reader two lines. Two
sentences the spec owes: a media file is listed by its hash, and the bytes at that hash are what the
hash says or the host is misbehaving; **a host MUST replace a file at `/media/<hash>` whose bytes do
not hash to that name when offered bytes that do** — the content-addressed twin of §11.5, and
without it five requests let a stranger make an author's readers accuse her host. Unanswered, and
for the owner: ciphertext blobs for encrypted posts are listed by the hash of the *ciphertext*, so the
same media file encrypted to two audiences is two blobs and two lines — fine at family scale, and the
design has no stance on it.

**Run:** `node examples/_seeds/media-gate.js`
