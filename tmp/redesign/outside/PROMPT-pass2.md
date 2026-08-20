Thank you. That design is now one of two on the table.

Independently, another team has been working from the same brief for some time and has arrived at
the direction summarized below. It is a *direction*, not a finished specification — several
questions inside it are still open, and it is presented here without advocacy so you can attack it
freely. Nothing in it is settled.

---

## The other team's direction

**Identity is a key, not a location.** A person is a public key. A small signed profile names the
current serving location(s), the current keys, and the recovery arrangement. A URL is where you
live, not who you are; apps show a name and an address, and the key is an implementation detail
users never see.

**Relocation is a signed location list.** Readers remember every location a profile has ever named
and check the others when the primary goes stale; a location statement with a higher sequence wins.
Strangers who only knew the old location may simply be lost — a resolver is an extension slot, not a
mechanism.

**The device is the only signer; the hub is storage and serving.** A hub never holds a signing key.
Scheduled posts are pre-signed on the device and released by the hub. Because a hub that ships the
app can take the key, *bring-your-own-client is treated as the security property*, so the
specification includes a small **publish interface** — how any client writes signed files to any hub
— so clients and hubs form a market rather than a pairing.

**Signed items are files, signed as the bytes served.** No canonicalization anywhere. The JSON Feed
/ Atom feed and the profile page are *generated views* — required of publishers as the interop
surface, never the signed object.

**One attestation shape for key change:** "key B succeeds key A," valid when signed by A (ordinary
rotation) or by enough peers a reader already trusts (social recovery). The reasoning is that at
family scale identity continuity already *is* social, and a hostile operator cannot fool the
subject's own mother. Backup UX — keychain sync, passphrase-locked backup, recovery contacts, a
printed code — is left to applications and the specification mandates none.

**The publisher forgets; readers remember.** No retained version history, no permanent public record
of deletions. Deletion is a signed tombstone; what a reader already fetched is the reader's.

**The completeness story is meant to fit in one paragraph.** A signed, sequenced head lists what
exists; a reader may pin it and notice when something it saw vanishes without a tombstone. That is
the whole of it — there is deliberately no freshness deadline, no withheld/lag/stale verdict
lattice, and no per-item commitment machinery.

**Everything is pull.** An interaction — a reply, a reaction — is an item in *its own author's* feed
naming its target. There is no inbox in the core. A push ping, inbound interop, and direct messages
that must not appear on any feed are extensions, each a few restrictions: rate-limit by IP before
fetching, fetch only from the author's known location, never republish what was delivered.

**Three tiers, one mechanism:** public; encrypted to a chosen set of keys with the recipients'
identities sealed inside; a direct message is that with one recipient. Comments and reactions are
items, encrypted if the parent was. The hub is meant to learn that an encrypted item exists, when,
roughly how big, and nothing about whom; clients poll on a fixed cadence so a fetch proves nothing.

**Questions this direction has not answered, in its own words:**

1. The exact shape of the publish interface (a signed PUT of files at conventional paths is the
   candidate).
2. The encryption construction. The current one was written in-house and has never been reviewed by
   a cryptographer; swapping it for an audited off-the-shelf construction is under evaluation.
3. How many trusted peers constitute social recovery, and whether a reader's trust set is ever
   published. The current answer to the second is: never.
4. When items are separate files, what exactly is "the head"? Is the generated feed view also the
   head, or is the head a third tiny signed file?
5. Whether the push/delivered channel should exist at all, or whether everything genuinely being
   pull is worth the metadata it makes public.

---

## Your task now, in three parts

**A. Attack this direction.** Find the failure its authors did not see. Be specific: name the
mechanism, name which of the seven scenarios breaks, and describe the concrete sequence of actions
the hostile operator takes. Prefer one attack you can spell out end to end over five you can only
gesture at. Then say which of its choices you think are *right* and why — a critique that finds
nothing good is not calibrated.

**B. Attack your own design.** Now that you have seen a second answer to the same brief, what did
you get wrong, leave out, or hand-wave? Be concrete and specific. Where the other direction is
better than yours, say so plainly and say why.

**C. Reconcile.** Given both designs, describe the best one you can. It may be either, a hybrid, or
a third thing neither of us reached. Most valuable of all: **name what neither design considered** —
an approach, a primitive, or a framing that is absent from both. If you think one of us is solving a
problem that should not be solved at all, that is the answer we most want.

Finally, answer as many of the five open questions above as you have a real opinion about — and say
which ones you would refuse to answer without more information, and what information.
