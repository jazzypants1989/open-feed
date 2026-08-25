# Open Feed — TL;DR

## How it works

Your identity is a signing key. A profile at your address names your current keys, your locations,
and a recovery list, and chains every key change back to your first key — so a reader who
learned that key, from a link or a scanned code, follows you through every rotation and move.

Every file is signed, and the bytes served are the bytes signed — no reformatting. Beside it sits a
index: a signed list saying which posts exist now. A post counts as yours when the index lists its
hash; withdrawing it appends a line taking it back, gone when the file is next rewritten. A post
signs itself, so anyone holding a copy can prove you wrote it.

A reply, reaction, or private message is a post in its author's feed naming its target by key,
number, hash, and location. Readers pull; a newer location in any verified post is where a reader
looks next. A reply naming a number above the index's top makes a reader look again, then say only
that it cannot see what was answered. Private content is encrypted to chosen keys with the audience
inside; a direct message is that, to one.

## What it guarantees

The host cannot speak for you: nothing verifies as yours unless your key signed it, and that key
was never the host's. It cannot read what you encrypted to others. It cannot keep you — your key and
your copy are yours, and your readers hold the rest, so you leave by writing the same files
elsewhere. It cannot drop or swap a post without a reader who saw it noticing, nor show two people
different histories once one of them replies to something the other cannot see. Losing your key is
survivable: the people you named restore it.

## Glossary

- **profile** — the signed file naming your keys, locations, and recovery list
- **index** — the signed list saying which posts exist now, and the highest number you have used
- **post** — one immutable signed file; a reply or DM is a post naming a target
- **anchor key** — your first key; a link or scanned code carries it, and readers follow the chain from it
- **recovery list** — the people or keys you named to restore you, committed privately in advance
- **pin** — an index a reader verified itself and remembers, which is what catches a lying host later
- **withdraw** — take a post out of the index; the line saying so goes when the file is next rewritten
- **encrypted** — encrypt to chosen keys with the audience inside; the host learns only that, when, and roughly how big

