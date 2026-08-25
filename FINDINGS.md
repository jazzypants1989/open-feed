# What writing the examples found

**Status: the open list.** Items that have been fixed are removed from this file when they are fixed;
`git log` has each one. What remains is Stage D's input.
Every entry was found by writing a program that asserts what the spec says and watching it disagree,
so each one is reproducible; where a number is quoted it was re-derived, not copied.

---

## 1. Security

Nothing open.

## 2. The spec says one thing and the code does another

Nothing open.

## 3. The spec does not say something an implementer needs

Nothing open.

## 4. Numbers the measurement disagrees with

Nothing open.

## 5. Cosmetic

- `src/index.js`'s `checkAgainstPin` tests "two indexes at one version" before `top`, so an index
  that both holds its version and drops `top` reports the version message. That is the order §7.2
  step 9 lists them in; left as is.
- `adoptRecoveryLists`'s per-link `!(j in recoveryLists)` guard looks unreachable from `src/`'s
  call sites. Harmless; left as is.
