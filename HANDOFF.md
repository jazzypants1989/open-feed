# Handoff — after `49f4f7f`

Delete this file when it has been consumed. It is a list of what is still open; none of it
belongs in `CLAUDE.md` or the spec.

`npm test` → 217 pass. `node tmp/regen.js` → all checks pass. `npm run prototypes` → all fourteen
hold. That last one is now a command rather than a claim: three had drifted out from under the
spec they justify, one had been exiting 1 for several commits, and nothing re-ran them. See
`tmp/check-prototypes.js`.

The previous handoff's four questions are closed. Q1 (`__proto__`) you settled: the rejection
stays. Q2 (wire canonicality) went to `tmp/canonicality-prototype.js` and came back "MUST
everywhere", for a reason neither the question nor the answer had — §14 nests chained documents as
JSON *values*, so hashing served bytes cannot reproduce them, and the middle setting forks §5.4
rather than relaxing it. Q3 (the recovery pin) is implemented. Q4 (build order) is done: the
withholding defect, `src/inbox.js`, `src/export.js`, and `src/enc.js`, in that order.

---

## 1. Open, in the order I would take them

**1. §16 emission and heeding — DONE.** Both halves are wired and tested end to end. Heeding:
`createInbox` takes a `PinStore` and reconciles an accepted delivery's admissible `_pins` locally
(no fetch — §16.1 forbids acting on a stranger's word), and `reader.resolvePeerPin` is the fetch
a `check` verdict earns, gated on the frozen and retired chains `walkAndPin` also refuses.
Emission: `Publisher.publishItem` and the new `Publisher.deliverItem` take `{ recipients, pins }`
and draw entries through `pinsForRecipients`, so §16.1's publication rule holds by construction
rather than by check. `test/inbox.test.js`'s last case runs the loop with no hand-written `_pins`
anywhere. What is left is a *client* concern rather than a library one: deciding whose documents
to pass as `recipients`, and what to do with a `check` verdict when it arrives.

**2. §8 beyond the inbox.** `src/inbox.js` splits `_rel` targets and judges relevance, and that is
all the `_rel` handling in the repository. There is no thread walk, no `root` resolution on the
read side, and no §13.12 depth cap — "`_rel` `reply` graphs from malicious parties may contain
cycles; cap walk depth". A client is the natural home for it, but the cap is a security rule and
belongs somewhere a client can borrow it from.

**3. `reconcileMigration` still throws about a different identity than the one asked for.**
Reading a successor triggers a read of the predecessor, which walks the predecessor's chain.
`EquivocationError` is deliberately not caught there — an equivocating predecessor *should*
surface — so `read(successor)` can reject with an error naming the predecessor's URL. Correct, and
confusing. It wants a wrapper that says which identity the finding is about.

**4. §3.1's percent-encoding rule still has no single answer.** `normalizeIdentityUrl` delegates
to WHATWG `URL`, which never decodes but *does* re-encode raw characters (`/a^b/` → `/a%5Eb/`); a
different URL library encodes a different set, and one identity becomes two.
`tmp/itemurls-prototype.js` Q2 is new evidence about how bad the disagreement is — five sampled id
forms, and `encodeURIComponent` and `encodeURI` alone disagree on all five — and the spec leans on
that argument in §7.6. (Q2 also counts a third "encoder", `new URL(id, base)`, which is a
*resolver* rather than an encoder and produces garbage for an id carrying its own scheme. The file
now reports both numbers and rests the argument on the two-encoder one; the count happens to be
the same, but an argument that needed the strawman would not have been an argument.) None of this
fixes §3.1, which is about identity URLs rather than item ids.

**5. `updated` is Unix seconds and must strictly increase**, so publish-then-tombstone inside one
second is refused by `Publisher.#assertDated`. Real at a hub batching with tombstone preemption,
and `rotateKey` now emits three versions in a row (§9.1's revoked-tip rule), which makes the
window tighter rather than looser.

**6. Appendix C has no code at all** — no `_unverified` handling on the read path, no
`external_url` non-dereference rule, no backfeed shape. Arguably correct: it governs gateways
rather than this verifier. But `_unverified` is a §10.5 display MUST that `renderable` reports and
nothing enforces.

---

## 2. Things I changed that you may want to look at twice

**`Publisher.rotateKey` now advances the manifest.** §9.1's revoked-tip rule made a rotation that
does not re-sign its manifest into a chain nobody can advance, and the first thing the rule caught
was a test fixture in exactly that state. Doing it inside `rotateKey` is the difference between a
rotation and one that strands every reader silently — the publisher's own files stay on disk and
stay internally consistent — but it is a behaviour change in a method whose name does not mention
manifests.

**`read()` now returns `feeds`, and reads every entry.** The named `rel` is still the headline
result and `items` still means that feed, so nothing that existed broke. But a reader pointed at an
identity with a rotated archive now makes several times as many requests as it used to, and there
is no way to ask for one feed. If that is wrong, the option belongs on `createReader`.

**§5.5 fork resolution now runs automatically** and re-pins onto a branch carrying a valid recovery
co-signature. §5.5 says SHOULD prefer, so this is what the text asks for, and it is reported as a
finding rather than done silently. It is still the one place this reader makes a consequential
choice on its own rather than surfacing and stopping.

**The withholding verdict is now close to unreachable without §7.6.** That is deliberate and §9.3
says so, but it means a reader pointed at a conformant publisher that does not serve item URLs will
never assert withholding from a feed read — which is the honest outcome and also a quieter verifier
than the one you had.

---

## 3. Questions

1. **Is §7.6 the right shape?** It is new wire surface in a specification whose value is how little
   of it there is. **The argument has changed since this was written, and got stronger.** It used
   to be "1018 false accusations from a single page if a reader skips it" — that number is dead,
   because `932404c` made `src/manifest.js` assert withholding only from a §7.6 probe, so a feed
   read now accuses nobody. Re-measured in `tmp/itemurls-prototype.js`: **0 withheld against 1018
   committed revisions a one-page reader cannot obtain**, at either `partial` setting. The reader
   is not wrong today, it is blind, and the only alternative the core offers is a 7.61 MB complete
   pass per poll that §13.4 budgets nothing for. So the case for §7.6 is no longer "it stops a
   misfire" but "it is the only thing that makes a Level 1 MUST reachable at all" — which points
   at promoting it rather than at cutting it. The argument against is unchanged: a fourth URL
   convention.

2. **Should `verifyBundle` read the predecessor's chain automatically?** It does, and without it a
   member's own bundle reads their byte-verbatim back catalog as copies and reports every item as
   withheld. The reasoning is that §3.4's restriction exists to stop fetch amplification and there
   is no network inside a file — but it does mean a bundle can talk a restorer into verifying a
   migration that a live reader would have refused to verify.

3. **Where does the §15 review come from?** The layer has an implementation and vectors now, and
   still says "never independently reviewed" — which is still true and is the one claim in the
   specification that no amount of work in this repository can retire.
