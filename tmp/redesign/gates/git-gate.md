# git-gate — Open Feed 2 as a git repo convention

**Candidate gate** (the PROFILE brief's surviving candidate: the commit DAG is the chain, tree
membership at the pinned commit is the manifest, `git clone` is the standing export).

**Question.** Is the git substrate real at the weekend-implementer bar: clone over **dumb HTTP
from a stock static server**, verify ssh-ed25519 commit signatures, pin heads, catch a history
rewrite and a silent drop, and open a sealed item — without libgit2-scale machinery?

**Method.** Shells out to stock `git` (2.39) and `ssh-keygen`. Publisher: a repo with
`identity.json`, items, and one `src/enc.js`-sealed item; signed commits (`gpg.format=ssh`);
published as a bare mirror + `update-server-info`, served by a ~10-line static file server that
ignores query strings and knows nothing about git. Reader: `git clone` over that server;
`verify-commit` against an `allowed_signers` file; pin = commit hash; fast-forward =
`merge-base --is-ancestor`; silent drop = `git diff --name-status pin..head` with no tombstone
entry; rewrite = amend + force-push → non-fast-forward, with the replaced bytes still in the
reader's own object store as evidence; sealed item opened and a relocated envelope refused;
shallow clone shown unable to verify ancestry.

**Numbers** (stale if git's dumb-HTTP behavior or ssh-signing UX changes):
- **Whole gate — publisher, server, and verifier included: 137 lines.** (Kill bound: 200.)
- Dumb-HTTP clone from a static server: works. Force-pushed refs also fetch over dumb HTTP.
- Every verification is one stock git command: `verify-commit`, `merge-base --is-ancestor`,
  `diff --name-status`, `cat-file -e`.

**Kill criteria.** Verification needing libgit2-scale machinery; dumb-HTTP unreliability;
shallow/partial clones breaking pin walks in a way the profile cannot forbid cheaply. **None
triggered.** Shallow clones cannot *fake* ancestry (they fail closed), so the profile forbids
them in one sentence and full clones of a family repo are small.

**Verdict.** The substrate holds at this bar. What the gate deliberately does not test (the
sketch must): the SHA-1→SHA-256 object-format pin, linear-`main` enforcement (merge commits
forbidden by the profile), freshness (a dated heartbeat commit), multi-writer (git natively
CAS-es on refs — the writer-gate's property for free), and the `git` binary as a trusted
dependency (the one real cost the 137 lines are silent about).

**Run:** `node tmp/redesign/gates/git-gate.js`
