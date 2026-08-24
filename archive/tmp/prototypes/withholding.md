# withholding — does §9.3's verdict reach the adversary it was built for?

**Question.** §9.3's withholding state is the one pull-path attack the manifest exists to detect,
and §12 makes §7.6 a Level 2 MUST specifically to make that verdict reachable. But §7.6 also says
"consumers MUST NOT require it" — so a hostile host that 404s the whole `/items/` tree is
non-conformant in a way no consumer is permitted to notice, indistinguishable from a static host
that never heard of the rule. Does the mechanism reach the adversary, and can a signed per-feed
declaration close the gap without breaking the publishers §7.6's ban protects?

**Method.** Run the **shipped** reader (never a model of it) against one withholding — an item the
manifest commits, removed from the feed page and the `/items/` tree — served four ways: (Q2) a
declaring host that serves the tree; (Q1) a host that genuinely declares nothing and serves no
tree; (Q3) the same declining host after its signed identity document gains `items: true` on the
feed entry, plus the counterfactual undeclared publisher read again; (Q4) a serving-path attacker
stripping the declaration from the served bytes, checked with `verifyDocument`.

**Numbers.** **13 bytes** — the identity-document cost of `items: true` on one feed entry, paid
once per feed on a chain §3.2.1 says runs 5–20 versions over a lifetime (stale if §3.2.1's field
name or the feed-entry shape changes; the gate does not re-measure it). Everything else is a
boolean verdict of the shipped reader. What would make those stale: any change to
`src/reader.js`'s `probeItems` control-probe logic or to how `readFeed` reads `entry.items`.

**Verdict.** ADOPTED as §3.2.1's `items` declaration. Without it, §7.6 fails open against the
only adversary it was built for: the identical withholding is CAUGHT from a serving host and
SILENT from a declining one, so the whole mechanism turns on a choice the attacker makes. The
declaration says which kind of publisher this is, and says it where it cannot be walked back off
the record: inside the signed identity document, unstrippable by anyone who cannot sign,
withdrawable only by advancing the identity chain in front of every pinned reader. §7.6's
"consumers MUST NOT require it" stays — an undeclared publisher is read exactly as before,
accusing nobody — and a host that never declares still cannot be accused, which is itself a
signal a reader can show a user.

**What the gate guards** (`withholding.js`, revert-checked — the mutations below are rows in `tmp/revert-gates.js`, and `npm run prototypes:revert` re-applies each one and requires the gate to fail): a serving, declaring host
cannot hide a committed item; a declining, undeclared host still suppresses the verdict (the
safe reading, kept deliberately); the signed declaration makes the verdict reachable against
the declining host; an undeclared publisher is read exactly as before (§7.6's normative
backwards-compatibility promise); and the declaration cannot be stripped without the signing
key. Revert-check mutations (rows in `tmp/revert-gates.js`), each matching exactly once:

1. `src/reader.js`: `itemUrlsDeclared: entry.items === true,` → `itemUrlsDeclared: false,`
   — the reader ignores the signed declaration; assertion 3 should fail.
2. `src/reader.js`: `if (!controlServed && !declared) return idle;` → `if (false) return idle;`
   — the benefit of the doubt is revoked; assertions 2 and 4 should fail.

**Original:** `tmp/archive/withholding-capability-prototype.js` (scene narration, the pre-adoption
framing where Q3 modelled the declaration, and the full cost discussion).
