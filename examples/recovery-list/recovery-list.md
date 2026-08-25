# The recovery list

**Spec:** §3.4, with §3.3 for the link that spends it and Appendix B.2 for the vector.
**Run:** `node examples/recovery-list/recovery-list.js`

A recovery list is two members wide: a threshold `k`, and one hash per person you would trust to
say "yes, that is her, and this is her new key". The hash is `SHA-256(salt ‖ "|" ‖ member key)` in
base64url, with a distinct random salt per member, so publishing the list publishes nothing about
who is on it — only how many. When a member vouches, they reveal their own salt and their own key
and sign the move, and the link in your chain (§3.3) carries that voucher forever.

Nothing is shared out, and nothing is reconstructed. Your people do not hold pieces of your key;
they hold their own keys, and what they can do with them is sign one sentence about *you* — that
the identity anchored at this key now uses that one. The key they move you to is a key you made
yourself. This is the mechanism behind `GOALS.md` scenario 2: Grandma loses her phone, calls her
daughter, and is back — without ever having been shown a key or asked to store a file.

## What the output shows

**One leaf per member, each under its own salt.** The three members, their salts, their keys, and
the leaf each pair hashes to, laid out as Appendix B.2 lays them out, and then the committed object
`{"k":2,"leaves":[…]}` that goes in the profile. The example asserts the three leaves and the
committed JSON against the spec's own vector, character for character.

**A voucher reveals only itself.** sis vouches, and what goes on the wire is one object: her key,
her salt, her signature. The example makes the disclosure argument concrete instead of asserting it.
An attacker who holds the three leaves and knows the whole family's public keys — they are public,
they are in everyone's own profile — is run three times: with `saltsis` revealed he identifies sis
and nobody else, with no salt he identifies nobody, and against a hypothetical bare `SHA-256(key)`
leaf he identifies all three at once. A family is a small guessable space; the salt is the entire
reason a leaf does not fall to a scan of it.

**The count of leaves is public, and MUST be.** Three leaves are three leaves to anyone who fetches
the profile. That is not a leak the design tolerates, it is a requirement: §3.6 counts a majority
against the list, and a majority needs a denominator every reader can see. `examples/contest/` is
where that rule is worked out; this example only shows the number it needs.

**`k` is the threshold the author set for a restore to be valid.** With `k` of 2 over three
members, sis alone leaves the link invalid at one counted voucher; mum joining makes it two and the
link stands; and mum's key submitted under sis's salt counts zero, because a leaf binds the salt and
the key together and either half alone hashes to nothing. Then the whole profile is read and comes
back **ok**, ending on the key Alice made. What `k` is *not* — the test that settles a contested
identity — is `examples/contest/`, and so is what a `k` below a majority costs (`FINDINGS.md` §1.1).

**The list MAY be empty.** An empty list is a real choice with an exact price: no leaf can ever
match, so no voucher can ever count, so no restore is possible and a lost key is a lost identity.
Where the list is not empty, a member can be a person, a backup key you keep in a drawer, or your
host. A leaf does not say which, and nothing outside your own app knows.

**A list with one other person hands that person the identity.** The example stages it: Alice lists
bro and nobody else, bro restores to a key of his own, one of one counted against a `k` of one, and
the chain walks to his key. Then the half that makes it worse. Alice replaces the list with the
three and rotates so the change reaches readers at all (§3.5), and her new link at chain length 1
carries the new list — but a reader that already saw the list of one there keeps it (§3.6 rule 2,
staged in `examples/contest/`). Bro's ability to restore at that length does not expire with the
list; it lasts as long as that reader does. That is why §3.4 says an app SHOULD require two or more
members, or the owner alone: a majority of one is one.

**"Recently restored" is presentation, not a verdict.** The read is **ok**; `restored` is a fact
about the chain, and reading apps SHOULD show it for seven days. The vouchers stay in the chain and
stay readable a year later — who moved this identity is part of the record, not a transient notice.
The three verdicts (§7.3) are ok, this host is misbehaving, and this identity is in question; a
fourth state that cried "restored" would be a state users learn to click past.

## Contrast

**Shamir secret sharing, and the wallets built on it.** The usual shape of social recovery splits a
secret — a seed phrase, a private key — into shares, and recovery means gathering enough shares to
reassemble it. That design has a moment where the secret exists again, on one machine, and it means
your friends are custodians of a fragment of you. Open Feed recovers *nothing*. There is no share,
no reconstruction, and no moment where anything sensitive is assembled: the vouchers are public
signatures over the ASCII bytes `<previous key>-><new key>`, and the new key was generated by the
owner before she asked anybody. A voucher is a statement, not a piece of a secret.

**Guardian-based smart accounts** (Argent, and the ERC-4337-era accounts that followed) are much
closer — guardians approve a change of the controlling key rather than hand back a seed — and the
difference is where the decision is settled. Those systems have a shared ledger to settle it on: the
contract counts approvals once, and everyone reads the same answer. Open Feed has no ledger, so
every reader settles it locally against what it saw first, which is why so much of §3.6 is about
*which* copy of the list a reader is allowed to believe. The other difference is disclosure: a
guardian set is typically visible on chain, whereas a recovery list publishes only its size.

**Why not a Merkle tree.** A Merkle root would prove membership in about `log n` hashes and would
hide the size of the set — and hiding the size is precisely what this design cannot afford, since
§3.6 counts a majority against it. The list is a handful of members, so the compactness a tree buys
is worth nothing here, and the property actually wanted is per-member disclosure, which a salted
leaf gives directly. A flat array of salted hashes is the smaller construction, and §2 has no room
for a second one.

**Why the salt, and not a bare hash.** `SHA-256(key)` would commit to the member just as well, and
would be scanned in a second: the candidate set is a family, their keys are already published in
their own profiles, and an attacker only has to hash each one and look for it. The salt turns the
scan into a scan the attacker cannot run without the very disclosure it is trying to avoid. It costs
one short string per member, stored beside the member's key in the owner's own app.

**The abuser on the list.** The threat model this protocol is built against is a hub operator who is
a loved one, and he is exactly the sort of person who ends up on a recovery list — that is scenario
1 in `GOALS.md`, the divorce. §3.4 is not the answer to him; it commits to the list and no more. The
answer, and its open defect, is `examples/contest/`.

**What a restore does not return.** The reading key is not socially recoverable (§3.8). Your people
can give you back your name, your chain and your posts; what was encrypted to you alone is gone
unless your app kept the key. The list is about identity, not about an archive.
