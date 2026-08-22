# envelope-gate — the envelope, run for the first time

**Candidate gate** (`../HANDOFF-final-review.md` §2.A; GOALS floor item 2, "still open" 2; rulings 8
and 9). Substrate: `weekend-reader.js` and `weekend-publisher.js`, **unchanged and imported**, with
the candidate envelope built inside the gate because it is on trial. Today's construction is
imported from `src/enc.js` for the size column only.

**Today's construction, in five lines** (`src/enc.js`, spec §15): a JWE JSON serialization,
`ECDH-ES+A256KW` per slot over one shared X25519 ephemeral, `A256GCM` for the content, RFC 7518's
Concat KDF; each slot found by a blinded 8-byte tag `SHA-256("openfeed-slot-tag" ‖ Z)` with `kid`
forbidden; the audience sealed inside the plaintext, never in a header; carrier binding by
*fields in the plaintext* (`id`, `authors[0].url`, `feed_url`) compared by the decrypting client;
no padding of any kind.

**Question.** Two outside models said the library is not the question, only the construction's
shape. Nobody had built the HPKE/NIP-44-shaped candidate, nobody had test vectors, nobody had
priced the padding floor against a real envelope, and — the half that matters most — nobody had
run a sealed post through the unchanged reader on this substrate. "No new signing construction"
is falsifiable, and `test/enc.test.js` falsifies it only for the old one.

**Method.** The candidate, standard library only: one X25519 ephemeral per message; per slot
`tag(8) ‖ kek(32) ‖ nonce(12) = HKDF-SHA256(Z, salt = epk, info = "openfeed/v1/slot")` and the
content key wrapped under ChaCha20-Poly1305 with `epk` as associated data; the content under
ChaCha20-Poly1305 with a zero nonce (the key is single-use, as in HPKE), a 2-byte length prefix,
zero padding to a bucket, and **`epk ‖ carrier` as associated data**, where the carrier is the
post's author genesis key and number; the audience is the first member of the sealed plaintext;
dummy slots to the bucket are the width of a real one. Two padding policies: power-of-two only,
and a floor of 8 slots and a 512-byte body. Then three reproducible vectors; who opens; an
observer's 24 public-only tag derivations; tag linkage across two posts; a size table against
`src/enc.js`; and over a loopback socket, Alice's sealed posts 5 and 6 published by
`weekend-publisher.js`, read by the unchanged `weekend-reader.js`, and lifted by a thief who cannot
read them into posts 1 and 2 of his own, on his own hub — one envelope bound, one not.

**Numbers** (stale if the envelope's field names, KDF info, or padding buckets change):
- Vectors: `DM, floor` 1,439 B · `family, floor` 1,439 B · `family, pow2` 1,107 B, each
  reproducible byte-for-byte from fixed keys, ephemeral, content key and plaintext, and each
  round-trips with the audience inside. Printed as base64url by the gate.
- **A slot costs 160 B today and 83 B in the candidate.** Observer: 0 of 24 derivations match a
  tag; the same four recipients across two posts share 0 tags; every slot is 8/48 bytes, real or
  dummy.
- 200-byte plaintext, bytes as served:

  | recipients | today | today + 2^k slots | candidate 2^k | candidate floor |
  |---|---|---|---|---|
  | 1 | 782 | 782 | 858 | 1,439 |
  | 2 | 942 | 942 | 941 | 1,439 |
  | 5 | 1,438 | 1,828 | 1,439 | 1,439 |
  | 20 | 3,977 | 5,537 | 5,479 | 5,479 |

  At one recipient the candidate is 76 B *larger*, because it pads the body to a bucket and today's
  envelope pads nothing. **Power-of-two alone tells a DM (346 B) from a family post (766 B); the
  floor makes them 1,439 and 1,439.** The floor is what `dm-metadata-exp.js` asked for, and it
  costs a DM about 1.1 KB.
- Over the socket: Alice reads `ok`, two posts, the `sealed` field an opaque object; Mum opens post
  5 after the reader returned; the host opens nothing. The signature line of a sealed post is 86
  characters over the body like any other — **nothing about signing changed.**

**The carrier-binding result.** The thief's two posts read `ok` — they *are* his, validly signed
and listed, and the reader is right to accept them. Mum's client then opens each against the
carrier it was served in. **Bound as associated data: the lifted envelope does not open, and a
client that passes no carrier cannot open it either** — with AAD there is no "forgot to compare".
**Unbound: her words render under his name**, from an envelope he could not read. The attack
§15.2.1 existed for is alive on this substrate, and `SKETCH.md` §9 saying "§15's carrier binding
goes" is wrong as written. What goes is the *old shape* of it — three plaintext fields compared by
hand at the client, two of which (`id`, `feed_url`) no longer exist. What stays is one line of
associated data.

**Kill criterion.** A vector that does not reproduce or round-trip; a non-recipient who opens; an
observer who derives a tag; a recipient whose tags link across posts; the unchanged reader needing
to know the field exists; a lifted envelope that opens under the bound shape; a DM the floor does
not hide. **Not triggered.**

**Revert-checked** (by hand, 3 rows, all caught by the claim they target): dropping the carrier
from the associated data (the lifted-envelope row goes red); setting the floor to 1 slot / 32 B
(the DM-vs-family row goes red); fixing the ephemeral across posts (the tag-linkage row goes red).
A fourth mutation — disabling the tag comparison so every slot is tried — was **not caught**, and
that is correct: the tag is a hint that saves work, never a decision, and removing it changes cost
and not who opens. It is not a revert row.

**Verdict.** The candidate is the old construction's shape with the JOSE taken out: one ephemeral,
blinded slots, the audience inside, and now a padding floor and carrier binding as AAD, in about
35 lines of standard library. It holds every property the old one claimed and is cheaper per slot.
Three sentences the spec owes. **The content's associated data MUST include the carrier author's
genesis key and the post's number; an envelope lifted into another post does not open.** **A
publisher SHOULD pad the audience to a floor of eight slots and the body to a floor, so that a
message to one person is the size of a message to the family** — a SHOULD, because it is a
privacy-against-the-host choice with a stated byte price. **A slot tag is a hint: a match whose
unwrap fails is a collision and the reader keeps scanning.**

**Run:** `node tmp/redesign/gates/envelope-gate.js`
