# Follow-ups — 2026-04-28

## W1.2 deferred — sub_executions duplicate trees migration

**Why deferred from Wave 1:** The audit finding (`agent-chat-tool-runner.md` #1) framed this as a cleanup-by-deletion. Investigation showed it's actually a multi-step migration: the old `sub_executions/detail/` tree has live external consumers in three different feature trees:

- `features/execution/components/ExecutionMiniPlayer.tsx:27` → `detail/views/ExecutionSummaryCard`
- `features/shared/components/modals/ExecutionDetailModal/ExecutionDetailModal.tsx:2` → `detail/ExecutionDetail`
- `features/shared/components/modals/ExecutionDetailModal/ExecutionDetailContent.tsx:9-12` → 4 deep paths in `detail/inspector/` and `detail/views/`

The new `components/list/ExecutionDetail.tsx` is itself a thin re-export of `../detail/DetailSteps` (`components/list/ExecutionDetail.tsx:2`), and the old `detail/ExecutionDetail.tsx` cross-references the old `replay/` tree (`detail/ExecutionDetail.tsx:5-6`).

**What this actually is:** a 5–10 commit pairwise migration that should be its own wave:
1. Identify which files in old vs new are diff'd; merge unique fixes into the canonical copy.
2. Migrate the 7+ external consumer imports to point at the new tree.
3. Delete the loser tree.
4. Add `no-restricted-imports` ESLint rule banning the dead paths.

**Recommended next session:** `gsd-plan` a dedicated "sub_executions tree consolidation" wave, with each pairwise migration as its own atomic commit.

## Open

(none yet)
