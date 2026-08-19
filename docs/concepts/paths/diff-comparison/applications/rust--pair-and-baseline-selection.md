---
layer: application
subject: diff-comparison
technique: pair-and-baseline-selection
stack: rust
---

# Pair & baseline selection — the competition slot diff that picks its baseline by byte length

`src-tauri/src/commands/infrastructure/dev_tools/competitions.rs::compute_slot_diff`
(`:520`) is the repo's clearest instance of a baseline *selected by the
data* — the failure the technique names as "an accident dressed as a
decision" — and it is worth reading whole because every step is
locally reasonable.

## Two legitimate baselines

A competition slot is a worktree branch where an agent worked. There are
two honest answers to "what did this slot change":

1. **Committed work** — `git diff --unified=3 HEAD...worktree-<name>` from
   the project root (`:531-539`). Baseline: the merge base with `HEAD`.
   Candidate: the branch tip.
2. **Uncommitted work** — `git diff --unified=3 HEAD` from inside the
   worktree directory (`:543-553`). Baseline: the worktree's own `HEAD`.
   Candidate: its working tree.

These are *different pairs* answering *different questions* — "what has
this slot committed" vs "what has this slot done since its last commit" —
and both are legitimate, because (per the code's own comment, `:544`)
agents "sometimes make changes but don't commit them".

## The selection

```rust
// Use whichever diff is larger (more informative).
let use_branch_diff = branch_diff.len() >= uncommitted_diff.len();   // :562
```

The displayed diff is whichever string is longer in bytes. The comment
calls the longer one "more informative"; the technique calls this the
baseline flipping silently as the data moves. Concretely: a slot that
committed a large refactor and then made a one-line uncommitted fix
shows the refactor and hides the fix; a slot that committed one line and
then rewrote a file uncommitted shows the rewrite and hides the commit.
Which pair the reader is looking at is not surfaced anywhere downstream —
the result flows into a single `diff_text` (`:563-567`), a SHA-256
`diff_hash` for duplicate detection (`:585-587`), and numstat counts
computed "for the same source we picked" (`:590`, correctly consistent
with the choice, which is the one thing done right here). On the client
the text lands in one `<pre>`
(`src/features/plugins/dev-tools/sub_lifecycle/competitions/CompetitionSlotRow.tsx:290-292`)
with no `+`/`-` colouring and no marker of which baseline it came from.

The `diff_hash` inherits the problem: two slots with byte-identical
committed work but different uncommitted tails may hash equal or unequal
depending on which side won the length contest in each — a duplicate
detector whose input is chosen by an accident.

## What the technique prescribes here

Either baseline is fine; the choice is not. Three shapes would satisfy the
technique, in ascending cost:

- **Fix the default by the question and label it.** Competitions judge
  what was *delivered*; a defensible default is "committed, else
  uncommitted, and say which" — the fallback is a *disclosed* second
  choice, not a length race.
- **Return both, roles named.** `{ committed: …, uncommitted: … }` and let
  the surface show the two pairs as two pairs.
- **Compose them.** `git diff HEAD...<branch>` plus the worktree's
  uncommitted delta relative to the branch tip is a single pair "merge
  base → working tree" — one baseline, one candidate, everything the
  slot did — which is what "more informative" was reaching for.

Cited in the golden path's `counter_evidence:`; measured first in
`docs/concepts/golden-paths/version-diff-view.md` §7 D6.
