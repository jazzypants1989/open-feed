# Handoff — after `49f4f7f`

Delete this file when it has been consumed. It is a list of what is still open; none of it
belongs in `CLAUDE.md` or the spec.

`npm test` → 202 pass. `node tmp/regen.js` → all checks pass. All eleven `tmp/` prototypes exit 0.

The previous handoff's four questions are closed. Q1 (`__proto__`) you settled: the rejection
stays. Q2 (wire canonicality) went to `tmp/canonicality-prototype.js` and came back "MUST
everywhere", for a reason neither the question nor the answer had — §14 nests chained documents as
JSON *values*, so hashing served bytes cannot reproduce them, and the middle setting forks §5.4
rather than relaxing it. Q3 (the recovery pin) is implemented. Q4 (build order) is done: the
withholding defect, `src/inbox.js`, `src/export.js`, and `src/enc.js`, in that order.

---

## 1. Open, in the order I would take them

**1. §16 emission and heeding.** `admissibleItemPins`, `PinStore.observationsFor`, and
`reconcilePeerPin` all exist and are tested; nothing on the read or write path emits `_pins` or
looks at them on an arriving item. §16.1 says emission is a SHOULD for a publisher that already
tracks a recipient's chains, and calls a compare rule nobody feeds "evidence collected and thrown
away" — which is what this is. `Publisher` would need to know which chains it tracks (it tracks
none today, so this probably wants the reader and publisher composed in a way nothing yet does),
and the read path would need to run `reconcilePeerPin` over `item._pins` and surface `check`
verdicts. The scoping rule is already implemented and already tested, so the risky half is done.

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
forms, five different results across three ordinary encoders — and the spec now leans on that
argument in §7.6. It does not fix §3.1, which is about identity URLs rather than item ids.

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
   of it there is. The argument for it is that §9.3's withholding verdict is otherwise unreachable
   on the pull path — measured at 7.6 MB per poll for a ten-year family journal, with 1018 false
   accusations from a single page if a reader skips it. The argument against is that it is a fourth
   URL convention, and that a verdict nobody can afford to assert might simply be a verdict the
   protocol should not have made a MUST.

2. **Should `verifyBundle` read the predecessor's chain automatically?** It does, and without it a
   member's own bundle reads their byte-verbatim back catalog as copies and reports every item as
   withheld. The reasoning is that §3.4's restriction exists to stop fetch amplification and there
   is no network inside a file — but it does mean a bundle can talk a restorer into verifying a
   migration that a live reader would have refused to verify.

3. **Where does the §15 review come from?** The layer has an implementation and vectors now, and
   still says "never independently reviewed" — which is still true and is the one claim in the
   specification that no amount of work in this repository can retire.
