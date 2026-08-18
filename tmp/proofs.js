// The proof table. Deliberately contains NO rule text.
//
// This is the half of the owner's proposal that does not collapse into a shadow copy. Each entry
// says: for this spec section, here is a one-line edit to `src/` that breaks the rule, and here
// is the test that MUST start failing when it does. It carries no prose, no restatement, and no
// justification — all of that stays in the spec, where the argument lives. There is nothing here
// to drift out of agreement with the specification, because there is nothing here that says what
// the specification says.
//
// `tmp/prove.js` runs it. What it produces is the claim the repo cannot currently make: not
// "§5.3.1 is cited by chain.js" (a wire being connected) but "§5.3.1 is enforced by chain.js,
// and here is the test that fails the moment it stops being" (current actually flowing).
//
// Writing a good `break`:
//   - it must leave valid JavaScript, or the test fails for the wrong reason and proves nothing
//   - it must break the RULE, not the function — neutralize the guard, don't delete the feature
//   - `from` must appear exactly once in the file, so the runner can refuse an ambiguous edit
//
// A rule with no entry is not a failure. Plenty of MUSTs bind producers this repo does not
// implement, or bind display, or are prohibitions on things `src/` never does. `prove.js`
// reports what is unproven and why; the gap is the finding, not the entries.

export const proofs = [
  // OPEN FINDING, and the second thing this method produced. This throw is `chain.js`'s
  // *stateless* report of the compare rule — the `pins: null` case §12 carves out. Its own
  // comment says "with a `PinStore` ... the throw below is unreachable", and no test appears to
  // reach it without one either: neutralize it and the suite stays green. Either a test is
  // missing or the line is dead, and deciding which needs a human reading §12's stateless
  // carve-out. Left failing on purpose. Suppressing it would make this file the fourth
  // instrument in this repo that someone tuned until it passed.
  {
    section: '5.3.1',
    what: 'a second version at a pinned seq is equivocation (stateless verifier)',
    file: 'src/chain.js',
    from: '    commit();\n    throw new EquivocationError(\n      `${url} served a different version at the pinned seq ${pin.seq}',
    to: '    commit();\n    if (0) throw new EquivocationError(\n      `${url} served a different version at the pinned seq ${pin.seq}',
    test: 'a chain already at the pin needs no walk, and its bytes must still match',
  },
  {
    section: '5.3.1',
    what: 'rewritten retained history is equivocation, found by walking back to the pin',
    file: 'src/chain.js',
    from: '    pins?.observe(url, pin.seq, reachedHash);\n    throw new EquivocationError(',
    to: '    pins?.observe(url, pin.seq, reachedHash);\n    if (0) throw new EquivocationError(',
    test: 'a walk that reaches the pinned seq with different bytes surfaces equivocation',
  },
  {
    section: '6.3',
    what: 'duplicate member names are rejected rather than last-wins',
    file: 'src/canonical.js',
    from: 'if (seen.has(key)) throw this.error(`duplicate member name ${JSON.stringify(key)}`);',
    to: 'if (false) throw this.error(`duplicate member name ${JSON.stringify(key)}`);',
    test: 'duplicate member names are rejected',
  },
  {
    section: '11.1.1',
    what: 'a delivered item carries no _openfeed.feed_url',
    file: 'src/publish.js',
    from: "    if (fields._openfeed?.feed_url !== undefined) {\n      throw new PublishError(`${id} supplies _openfeed.feed_url;",
    to: "    if (false) {\n      throw new PublishError(`${id} supplies _openfeed.feed_url;",
    test: 'a delivered item may not name a feed',
  },
  {
    section: '3.3.1',
    what: 'a co-author identity is re-observed at each read, never answered from a cache',
    file: 'src/reader.js',
    from: '    const memo = new Map();\n    return async function resolveIdentity(author) {',
    to: '    const memo = crossReadLeak;\n    return async function resolveIdentity(author) {',
    prelude: {
      from: '  function readScopedIdentityResolver() {',
      to: '  const crossReadLeak = new Map();\n  function readScopedIdentityResolver() {',
    },
    test: 'a co-author is observed once per read, and observed again at the next read',
  },
];
