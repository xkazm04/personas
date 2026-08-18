---
layer: application
subject: release-pipeline
technique: version-single-truth
stack: node
---

# Version single truth — Node bump tool + CI release workflow

How this repo applies (and where it undershoots) the
[version-single-truth](../techniques/version-single-truth.md) technique, in
`scripts/bump-version.mjs` and `.github/workflows/release.yml`.

## The propagation tool

`scripts/bump-version.mjs` is the one bumper. It derives the increment from
conventional commits since the last tag (`feat:` → minor, `BREAKING CHANGE:`
/ `type!:` → major, else patch, via the shared
`scripts/lib/git-tags.mjs::getCommitsSinceLastTag()` — the same "since last
release" definition the changelog generator uses, so the two can never
disagree about the range), then writes **four replicas in one pass**:

- `package.json` — the declared source of truth (read at `:44-45`);
- `src-tauri/tauri.conf.json` (`:83-86`);
- `src-tauri/Cargo.toml` — regex replace of the first `^version = "…"` line
  (`:90-93`);
- `src-tauri/Cargo.lock` — the `personas-desktop` package block (`:104-112`).

The lock update is the technique's "replica everyone forgets" clause,
implemented, with the comment at `:97-102` narrating exactly the deferred
failure the technique predicts: bump the manifest, leave the lock, and every
later build dirties the tree while `--locked` builds fail. The bump job runs
on a Node-only runner (no cargo), so the lock is patched textually — with a
**refusal** if the expected block is missing (`:107-110`), so the lock can
fail loudly rather than drift silently.

## The refusals (both earned by incidents)

- `:52-57` — refuses to bump when the current version does not parse.
  Earned: `split(".").map(Number)` on a pre-release suffix once produced
  the version `0.1.NaN.1`, which shipped as a tag and is still on origin —
  the technique's "garbage arithmetic becomes a permanent public fossil"
  case, measured.
- `:107-110` — refuses when `Cargo.lock` lacks the package block, "so the
  lockfile can't silently drift."

`release.yml` adds the ordering-side guard: a **tag-collision check**
(`release.yml:119-134`) that fails in seconds — before the 45-minute build
matrix — when version files lag the tag history, with a message naming the
remedy.

## Where it undershoots the technique

1. **No drift gate.** Nothing in CI asserts that `package.json`,
   `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock` agree between bumps. A
   hand edit to any one of them is invisible until the next release.
2. **Unreachable replicas.** The workspace has five `version = "…"`
   literals under `src-tauri/` (root plus `core/`, `db/`, `engine/`,
   `macros/`); the bumper writes only the root. `macros` has already
   diverged to `0.1.0`. The technique's strong form — inheritance — is
   available here (`[workspace.package] version` + `version.workspace =
   true`) and would delete the four unreachable spellings outright.
3. **A second hand-maintained file list.** `release.yml:151` `git add`s the
   four files by name — a list the bumper already owns. The tool should
   emit the set it wrote and the workflow should stage exactly that.

All three are reported as deviations on the golden path; the standard
stands.
