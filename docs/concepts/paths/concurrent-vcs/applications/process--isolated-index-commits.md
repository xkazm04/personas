---
layer: application
subject: concurrent-vcs
technique: isolated-index-commits
stack: process
---

# Isolated-index commits — this repo's ritual, and the evidence that forged it

This repo runs multiple Claude Code sessions concurrently on one checkout, on
`master`, without branching for isolation. The isolated-index commit ritual is
codified in `.claude/CLAUDE.md` § "Parallel-safety primitives" #5, and every
clause of it was paid for by a measured incident.

## The working form (as of the 2026-08-18 correction)

```bash
IDX="$(git rev-parse --git-dir)/tmp-index-$$"          # session-unique name (primitive #6)
GIT_INDEX_FILE="$IDX" git read-tree HEAD                # seed FROM THE HEAD — never cp .git/index
GIT_INDEX_FILE="$IDX" git add <your paths>              # per-path; git apply --cached for co-mingled files
GIT_INDEX_FILE="$IDX" git diff --cached --name-only     # exactly your paths — diagnostic, not guard
GIT_INDEX_FILE="$IDX" git commit -m "<msg>"
rm -f "$IDX"
git log --oneline -1                                    # readback — the only detector
git show --name-status --format= HEAD                   # file list AND status letters (catches D/reverts)
```

## The evidence chain, in order

1. **2026-08-13 — the pathspec forms failed in production.** Four agents on
   one checkout: `git commit -- <paths>` swept three pre-staged sibling files;
   later the same day `git commit --only` printed "no changes added to commit",
   silently no-oped, and all 12 staged files went into a sibling's commit.
   Recorded in `.claude/CLAUDE.md` primitive #5 and `.claude/active-runs.md:7`.
2. **2026-08-17 — the mechanism was isolated by experiment.**
   `docs/concepts/golden-paths/parallel-session-coordination.md` §0 drove six
   questions through a throwaway `git init` repo with no hooks and no
   concurrency: both pathspec forms commit the **working tree** (Q1/Q2); the
   isolated `GIT_INDEX_FILE` is the only form that scopes the file set AND
   commits staged content AND survives a sibling `git add` mid-flight
   (Q3/Q4/Q5); the staged-count guard is TOCTOU (Q6). The earlier diagnosis
   ("lefthook re-stages") was refuted — no hooks were present.
3. **The correct form was already in the checkout and had not traveled.**
   `.claude/skills/mvp/state/calibration.md:54` (run 2) states the defect and
   the fix independently; `:84` (run 4) reports it holding — "zero swept
   commits across 8 builders plus the orchestrator", four consecutive runs.
   Zero SKILL.md specifications mention `GIT_INDEX_FILE`; nine still prescribe
   the defeated pathspec forms. Census rule `defeated-pathspec-commit`
   (baseline 6 files / 11 matches over `.claude/skills`) ratchets the defeated
   form; its positive control counts `GIT_INDEX_FILE`.
4. **2026-08-18 — the seeding rule.** The original recipe seeded by
   `cp .git/index`. Measured the same day the corpus session used it twice:
   after the ritual's own first commit, the shared index is stale relative to
   the new HEAD, so the copied seed made the *second* commit record the first
   commit's 4 new docs as **deleted** and revert a 181-line checker extension
   — invisible in hook output, surfaced only by `git show --stat`. Recovery:
   amend through a `read-tree HEAD`-seeded index. `.claude/CLAUDE.md`
   primitive #5 now mandates `git read-tree HEAD` seeding, plus an
   end-of-session shared-index resync (`git reset` mixed) gated on
   `git diff --cached --stat` showing no sibling-staged files.

## Standing limits, stated in the doctrine

- `GIT_INDEX_FILE` + lefthook untested *together* here
  (`parallel-session-coordination.md` §8 G3) — the throwaway-repo experiment
  ran hook-free.
- The readback (`git log --oneline -1`) remains mandatory: the private index
  protects content, not attribution or head placement. Push-side analogue:
  after a rejected push, `git fetch` +
  `git merge-base --is-ancestor <sha> origin/master` per commit
  (the 2026-08-17 §13 field incident — the work was already published by a
  sibling's push during 487 s of pre-push hooks).
