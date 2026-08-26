# Padding

**Spec:** §6.4, leaning on §6.1's length prefix and §6.3's slots.
**Run:** `node examples/padding/padding.js`

An encrypted post gives the host nothing to read (§6.1–6.3). What it still gives him is a *shape*:
how many slots the envelope carries, and how long the ciphertext is. The slot count is the size of
the audience. So a hub operator who cannot read a single word can still see that this post went to
one person and that one went to five — which, in the family the threat model is written around
(`CLAUDE.md`, `GOALS.md` scenario 1), is most of what he wanted. A direct message that is visibly a
direct message tells him there is somebody she talks to alone.

§6.4 answers with one small function and two numbers. `bucket(n, floor)` is the greater of `floor`
and the next power of two at or above `n`. Slots are padded up to `bucket(slot count, slot floor)`
with dummies; the body is padded up to `bucket(length + 2, body floor)`. A publisher **SHOULD** use
a floor of 8 slots and 512 bytes, and then a message to one person is the same size as a message to
the family. It is a SHOULD because it is paid for in bytes, and the spec would rather state the
price than pretend there isn't one.

## What the output shows

**`bucket(n, floor)`, including the edges.** Exactly a power of two stays where it is: `bucket(8,
8)` is 8 and `bucket(512, 512)` is 512. One more doubles: 9 becomes 16, 513 becomes 1024. Anything
under the floor is the floor. That is the whole function, and the fact that it is one line is the
reason padding is not a policy engine.

**Slots are padded to `bucket(slot count, slot floor)` with dummies.** Two recipients plus six
dummies, six recipients plus two dummies: both come out at eight slots. Under the recommended floor
every audience from one person to eight looks the same on the wire, which is the range a family
lives in. A ninth recipient doubles to sixteen — the coarseness is the trade, and it is discussed
below.

**A dummy MUST be indistinguishable in width from a real slot.** A real slot is an 8-byte tag and a
48-byte wrapped content key — 32 bytes of key plus a 16-byte AEAD tag — which is 11 and 64 base64url
characters in the file. A dummy is 56 random bytes cut the same way, so the widths are identical
across every slot of both envelopes. Mum scans, matches her own tag, opens the post, and learns
nothing at all about the other seven; the number of people on the post reaches her from §6.5's
`audience` list *inside* the plaintext, never by counting slots.

**And it MUST NOT be derived from anything a recipient holds.** The example builds two
non-conformant envelopes to make the rule concrete. In the first, the dummies come from a stream
keyed by the content key — a plausible shortcut for an implementer who does not want a second source
of randomness. Mum holds that key, because it is exactly what her slot wraps (§6.1), so she
regenerates six of the eight slots, subtracts them, and is left with two: she has counted the true
audience, and the padding has become a channel rather than a cover. In the second the stream is
keyed by `epk`, which the post carries in the clear, and the host does the same subtraction. Padding
anyone can recompute is not padding; it is a longer file.

**The body is padded to `bucket(length + 2, body floor)`.** The `+ 2` is §6.1's two-byte big-endian
length prefix, which is padded along with the plaintext rather than added on top of the bucket, so
the last plaintext that fits a 512-byte bucket is 510 bytes and 511 lands in 1024. A short direct
message (332 bytes of plaintext) and the same words to two people (471) sit in the same bucket and
therefore produce ciphertext of the same length.

**A message to one person is the same size as a message to the family.** This is the centre. The
same sentence — Appendix B.8's, from `GOALS.md` scenario 1 — is encrypted to mum alone and to mum
and sis, signed into posts 5 and 6, and the two published files are **1574 bytes each**. Turn the
floor off, keeping only the power-of-two rule, and the same two posts are 1076 and 1242 bytes: the
bodies still share a bucket, but the slot counts are 2 and 4, and the host reads the audience size
off the file size without touching a key.

**How far that goes.** The floor hides the audience size for as long as §6.5's audience list fits
underneath it, and that list is itself content. Six named entries — anchor key, reading key and
location apiece — are 847 bytes here, so the six-recipient post lands in the 1024-byte bucket and
2257 bytes on the wire while the direct message stays at 512 and 1574. The eight-slot floor is doing
its job; the 512-byte body floor runs out somewhere around three or four people. It is worth knowing
that the guarantee has an audience-size horizon rather than assuming it is unconditional.

**It is a SHOULD, and the reason is a number.** Measured against these staged messages, the floor
costs **498 bytes** on a direct message: six dummy slots at 83 bytes each, the body being already in
the 512-byte bucket either way. The spec says "about 1.1 KB", which is the more conservative figure;
the difference is that §6.5's audience list has since grown, and a plaintext that already exceeds
the body floor pays only for the dummy slots. Either way it is a fraction of a kilobyte to a
kilobyte per message, once, on content that is already small — and a minimal implementation that
skips it is still conformant (§12). Nothing about opening an envelope depends on the padding.

**What padding does not hide.** The host still reads, off the file, that an encrypted post exists,
when it appeared, and which bucket it is in — and off his own logs, who fetched it and how often.
He does not get the text, the audience, or whether it went to one person or six. §13.3 states the
same limit in the spec's own voice: "the shape of a correspondence is visible even when its contents
are not… §6.4's floor hides one distinction — a message to one person from a message to the group —
and nothing hides the rest."

## Contrast

**The threat here is traffic analysis, and the adversary owns the server.** He has four channels
left once the content is sealed: size, timing, frequency, and who fetched what. Padding takes one of
them — size, and only within a bucket. It does nothing about the other three, and the protocol says
so rather than implying otherwise. `GOALS.md`'s decision that "clients poll on a fixed cadence so a
fetch proves nothing" is the answer aimed at the fourth, and it is an app-level habit, not a rule in
the spec.

**Length is content.** This is the general lesson behind CRIME and BREACH, where an attacker
recovered secrets from a TLS connection purely from how long the compressed-then-encrypted records
were. Nothing in Open Feed compresses, so that particular oracle does not exist, but the underlying
fact does: a ciphertext's length is plaintext that was never encrypted.

**How other protocols pad.** Tor uses fixed-size cells, so every hop carries the same shape and
there is nothing to measure; the cost is that a fixed size is either wasteful for small messages or
too small for large ones, which is exactly what a bucket avoids. TLS 1.3 moved padding inside the
record (RFC 8446 §5.4) and made it entirely optional, with no guidance on how much — the same
SHOULD-shaped hole Open Feed has, minus the stated default. (TLS's older `padding` extension, RFC
7685, is unrelated to privacy: it works around implementations that choke on certain ClientHello
lengths.) Signal pads message plaintext to fixed increments and, with sealed sender, removes the
sender identifier from what the server sees — the closest analogue to a floor whose purpose is to
make two different messages look alike.

**Why powers of two.** A fixed size has to be chosen for the largest message anyone will send.
Random padding costs a random amount, leaks under repetition, and needs an argument about its
distribution. A power-of-two bucket is one line of arithmetic, deterministic, and bounds the
overhead at under 2× — and the price is honest: an observer learns roughly the log of the size, and
learns when a message crossed a boundary. Combined with the floor, everything short is one bucket,
which is where family messages live.

**Why 8 and 512.** They are sized for the case the threat model cares about: a family, and a message
short enough to be a sentence. Eight slots covers a household; 512 bytes covers a note plus §6.5's
audience for two or three people. Larger floors would hide more and cost every publisher more, and
the numbers were priced against a real envelope rather than chosen for their looks.

**Why SHOULD, not MUST.** Two reasons, and both are arguable. The honest one is the price: a MUST
would put a byte cost on every implementation regardless of what its users are exposed to. The
structural one is that this MUST could not be tested from the outside — a reader cannot tell a
publisher that padded from a publisher whose audience really was eight people, which is precisely
the property the padding provides. A rule no conformance test can check is a rule that reads as
advice whatever keyword it carries. The countervailing argument is real too: a publisher who skips
the floor exposes his *recipients*, not himself, and rules that protect third parties are usually
the ones spelled MUST. `GOALS.md` floor item 2 — "the host cannot read what wasn't meant for it" —
is satisfied without any padding at all; scenario 1, the divorce, is the case where the shape of the
correspondence is the harm rather than its contents, and it is served only by the SHOULD.
