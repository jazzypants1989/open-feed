# hubwrite-gate — the two overwritable files on a hub that checks nothing

**Review gate** (2026-08-23 review, finding A3). Substrate: weekend reader and publisher,
unchanged, over a loopback socket against `hub.js` with its `verifyWrites` knob.

**Question.** §8.5: "A hub MAY check nothing on the ordinary path." §8.4 asks a later profile
write for the same anchor and a higher `version`; §8.1's entity tag is what any GET returns; §12's
hub MUSTs never say *verify*. What can a stranger do with one GET and one PUT?

**Method.** Alice claims a name and posts once; a reader pins her. A stranger PUTs (1) a profile
with her anchor, `version` 2, the right shape and his own signature; (2) her real bytes with
`version` bumped — the signature no longer matches; (3) a index signed by nobody. Each with the
`If-Match` a GET gave him. Then Alice's one-PUT repair, then the honest case the repair must
survive: a real rotation and the index re-signed under the new key. Under both knob settings.

**Numbers** (stale if §8.4, §8.5 or the reader's profile step change):

| | as written | hub verifies on write |
|---|---|---|
| stranger's profile | **200** → pinned and cold readers: `identity: the profile is not signed by the key it ends on` | 403, readers `ok` |
| her bytes, version bumped | **200** → `identity` | 403, `ok` |
| a index signed by nobody | **200** → cold `host: the index is not signed…`, pinned `ok` with a note | 403, `ok` |
| Alice writes herself back | 200 — and his next PUT is 200 again | — |
| her real rotation + re-signed index | 200 · ok · cold `ok` | 200 · ok · cold `ok` |

Floor 1 holds throughout — nothing verifies as hers — but on the hub as written a stranger holds
the operator's delete power over her identity for the price of a GET, and the only remedy is a
write war at one PUT each.

**Kill criterion.** The clobber refused by the text as written; the repair refusing an honest
rotation or an honest index. **Not triggered.**

**Revert-checked** (`revert.js`): turning the profile check off in `hub.js`'s `verifyWrites`
branch makes the repaired run store the stranger's profile.

**Verdict.** §8.5's own principle — check nothing on the ordinary path, never ignore a collision —
applied to the profile and the index, where every overwrite *is* a collision: a hub that accepts
writes MUST refuse a profile whose chain does not walk or whose signature fails under its tip,
and a index not signed by the key the held profile ends on. Add it to §12's hub list, and split
that list: a *serving* hub (exact bytes, CORS — static hosting qualifies) from one that accepts
writes. Consequence for §3.5: a rotation writes the profile before the index.

**Run:** `node examples/_seeds/hubwrite-gate.js`
