# Open Feed — TL;DR (design from the rulings, 2026-08-21)

## How it works

Your identity is a signing key. A profile file at your address names your current keys, your
location(s), and a recovery list, and carries the chain of key changes back to your first key — so a reader who once learned it, from a link or a scanned code, follows you through every rotation and move.

Everything is a signed file, and the bytes served are what the signature covers, with no
reformatting. Beside the profile sits a head: a signed, numbered list of (number, hash) for every
post you have live. A post counts as yours when the current head lists its hash; withdrawing it
removes the line, and nothing records that it existed. A post also signs itself, so anyone who kept
a copy can still prove you wrote it.

A reply, reaction, or private message is a post in its own author's feed naming its target by key,
number, hash, and location, plus the head position the author last saw. Readers pull; a newer
position seen in any verified item is where a reader looks next. Private content is sealed to
chosen keys with the audience named inside; a direct message is that, sent to one.

## What it guarantees

The host cannot speak for you: nothing verifies as yours unless your key signed it, and that key
was never the host's. It cannot read what you sealed to others. It cannot keep you — your key and
your copy are yours, and your readers hold the rest, so you leave by writing the same files
elsewhere. It cannot drop or swap a post without a reader who saw it noticing, nor show two people
different histories without their replies colliding. Losing your key is survivable: the people you
named restore it.

## Glossary

- **profile** — the signed file naming your keys, locations, and recovery list
- **head** — the signed list of (number, hash) saying which posts exist now
- **post** — one immutable signed file; a reply or DM is a post naming a target
- **genesis key** — your first key; a link or scanned code carries it, and readers follow the chain from it
- **recovery list** — the people or keys you named to restore you, committed privately in advance
- **pin** — a head's (sequence, hash) a reader remembers, and interactions carry, to catch a lying host
- **withdraw** — remove a post's line from the head; leaves no permanent record
- **seal** — encrypt to chosen keys with the audience inside; the host learns only that, when, and roughly how big

