# enc — is an encrypted item just an ordinary signed item?

**Question.** Can audience-restricted content ride the existing construction unchanged — an
ordinary signed item whose content is a JWE envelope, signed by the same construction, verified
by the same verifier, committed by an ordinary manifest the host cannot read? And two questions
the envelope alone does not answer: what stops a ciphertext relay, and can a recipient reply to
the other recipients without a published roster?

**Method.** A hand-rolled JWE JSON Serialization (ECDH-ES+A256KW, A256GCM, X25519) with one
shared ephemeral and §15.2's blinded slot tags — no `kid`, so an observer holding every published
key learns nothing about the audience. A three-party scene: Mom seals a journal entry to Dad and
Kid; a stranger tries to open it; Eve — who cannot read the entry — lifts the sealed blob
verbatim into her own freshly-signed item; Dad reads the audience out of the sealed plaintext
and wraps a reply to it.

**Numbers.** None load-bearing — the findings are boolean. The scene's item is 1,295 B with two
recipients (stale if the envelope shape or §6 serialization changes; `tmp/prototypes/enctags.js`
carries the priced envelope comparison). Documents published to make the reply thread work: 0.

**Verdict.** ADOPTED (§15.2, §15.2.1, §15.2.2). The envelope claims all held: same signing
construction, unchanged verifier, ordinary manifest, recipients decrypt and the stranger is
locked out cheaply. The relay is the finding that became §15.2.1: Eve's relayed item is a
**validly signed item** that passes every core check — signature, author binding, `_feed_url`,
fresh id, manifest commitment — and only the carrier binding sealed inside the plaintext, checked
at the decrypting client, rejects it before Mom's words render under Eve's name. The declared
audience (§15.2.2) dissolved the case a published roster was wrongly thought necessary for: Dad
wraps his reply to the sealed audience plus the author, Kid and Mom read it, the stranger stays
out, and the reply is delivered rather than published (§15.4).

**No gate exists for this experiment**, deliberately. It hand-rolled its own JWE and its own
Ed25519 signing even though `src/enc.js` ships — exactly the failure mode this folder replaces:
it stays green whatever regresses. The shipped behavior is guarded where it should be:
`test/enc.test.js` runs the **unchanged** verifier over encrypted items, exercises the §15.2.1
relay rejection against the shipped `openEnvelope` ("a relayed ciphertext is refused, and the
relayer never had to be in the audience") plus every binding field individually, and drives the
§15.2.2 reply-to-audience case; `tmp/prototypes/enctags.js` (the successor gate) pins the shipped
envelope's shape.

**Original:** `tmp/archive/enc-prototype.js` (the full scene, the relay build, and the roster
argument in place).
