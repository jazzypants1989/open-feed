# Open Feed in 300 words

**DRAFT — a Stage 2 diagnostic instrument, not yet documentation.** The budgets (200 words how,
100 words guarantees, 10 glossary terms) are enforced by `node tmp/measure/tldr-check.js`.
Everything that did not fit is recorded in PLAN.md's complexity ledger, which is this document's
real product: each mechanism the budget excluded is a named simplification candidate.

## How it works

Your identity is an HTTPS URL. At a fixed path under it sits one signed JSON file — the identity
document — holding your profile, public keys, and endpoints. Your content is a feed of
individually signed items: posts, replies, and likes are all the same object, and an interaction
is just an item carrying a relation naming its target. Interactions arrive fast because senders POST
signed items to the recipient's inbox; they stay complete because anything important is also
published in a feed.

A separately signed manifest lists every live item's exact bytes, so a host cannot drop, rewrite,
or resurrect content unnoticed. The identity document and each manifest form a chain: every
version names the hash of the one before it, and old versions stay served forever. A reader
stores a pin — the last version and hash it verified — and every later read must walk back to it;
two readers comparing pins catch a host telling each a different story.

Everything is signed one way: a detached signature over canonical JSON bytes. If your host turns
hostile, a recovery key it never held proves your identity moved, and an export bundle carries
every signed byte elsewhere.

## What it guarantees

Nobody can alter, forge, or misattribute what you signed. A host cannot silently delete, rewrite,
or roll back what you published: removal requires a signed deletion notice every reader sees, and
readers who compare notes catch a host lying differently to each of them. You can always leave —
prove your identity's move, and republish your verified archive anywhere without your old host's
permission. None of this is privacy: who posts, when, and to whom is public forever. An optional
layer encrypts content for a chosen audience, and is exactly as private as that audience's key
custody.

## Glossary

- **item** — a signed JSON Feed entry; the one content object (post, reply, like, deletion alike)
- **identity document** — the signed file at your URL: profile, keys, endpoints
- **feed** — a JSON Feed of items, listed in the identity document, owned by one identity
- **manifest** — the signed document committing a feed's exact contents; its completeness proof
- **chain** — versions of a document, each naming the previous version's hash; history retained forever
- **pin** — a reader's stored (version, hash) of a chain; later reads must connect to it
- **relation** — the entry that makes an item a reply, like, repost, quote, or mention of a target
- **inbox** — the HTTPS endpoint where signed items are POSTed to reach an identity
- **recovery key** — an offline key the host never held; co-signs the proof that an identity moved
- **export bundle** — one archive of every signed byte an identity published, sent, and received; verifiable anywhere

## What did not fit

That is the point. See **PLAN.md → The complexity ledger** for every mechanism and guarantee the
budget excluded, with word costs and what each serves.
