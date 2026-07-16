# Refactor+Perf Fix Wave 1 — Unbounded loops & runaway refetch (Theme A)

> 11 commits, 10 findings closed (1 Critical + 9 High), 13 source files touched.
> Baseline preserved: tsc 0 → 0; vitest 2303-2304/2304 → **2304/2304** (0 regressions, known-flaky useDesignReviews passed); eslint clean per-commit (lefthook eslint-staged).

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `d5f60482f` | recipes-playground #1 | **Critical** | useRecipeTestRunner.ts |
| 2 | `d4b6c871a` | agents-design #1 | High | useDesignTabState.ts |
| 3 | `72ca51617` | triggers-triggers-1-3 #1 | High | WebhookRequestInspector.tsx |
| 4 | `eb9c4d85c` | triggers-triggers-1-3 #2 | High | TriggerExecutionHistory.tsx |
| 5 | `408bd2a74` | vault-credentials-3-4 #1 (+ sibling site) | High | CredentialDeleteDialog.tsx, AutomationsSection.tsx |
| 6 | `27cbc6f07` | overview-leaderboard #1 | High | LeaderboardPage.tsx |
| 7 | `2b6c940f1` | home-cockpit #1 (3 sites) | High | CockpitPanel.tsx, PersonaOverviewWidget.tsx, ConnectedServicesWidget.tsx |
| 8 | `3fd1fb744` | agents-deployment #1 | High | useDeploymentHealth.ts |
| 9 | `73f1012ea` | overview-activity #1 | High | GlobalExecutionList.tsx |
| 10 | `d990e2250` | agents-model-config #1 | High | ModelABCompare.tsx |
| 11 | `29d2e171b` | teams-misc #4 | High | useTeamDeliberations.ts |

## What was fixed (grouped by sub-pattern)

1. **Merge-effect without idempotency (the Critical).** useRecipeTestRunner's completion merge re-fired on its own setResult (result in deps, fresh object per pass) → "Maximum update depth exceeded" after every successful playground run. Guard: skip when `result.llm_output` already equals `execution.output`.
2. **Empty-result-as-"unfetched" sentinel (5 sites).** WebhookRequestInspector, TriggerExecutionHistory, LeaderboardPage, CockpitPanel/PersonaOverviewWidget/ConnectedServicesWidget: guarding auto-fetch on `list.length === 0` loops forever when the fetch legitimately returns empty (fresh array identity re-fires the effect). Fix: one-shot ref guard per (open/target id).
3. **Unstable fetcher/array identity in effect deps (3 sites).** useBlastRadius inline-arrow fetchers (both dialogs) and useDeploymentHealth's per-render `uniquePersonaIds` array made effects re-run every render; combined with unconditional fresh-object setState this spun continuously. Fix: useCallback-stable fetchers; key effects on string keys only.
4. **Effect that consumes its own dependency.** useDesignTabState's auto-start nulls the store trigger it depends on, so its cleanup-flag cancellation aborted the in-flight chain — auto-start silently no-oped and orphaned a conversation row per attempt. Fix: live persona-id checks at each async hop instead of a cleanup flag; delete the orphan on real aborts.
5. **Store-write feedback loops.** ModelABCompare (fetch writes a fresh arenaResultsMap that the trigger effect depended on) and GlobalExecutionList (fallback fetch replaces the array it scans, no attempt bound, filter clobbered). Fix: split trigger from data sync; one attempt per focused id, preserving the status filter.
6. **Long-poll without unmount cancellation.** useTeamDeliberations.approveAction could poll IPC every 2s for 20 minutes after navigation; runToBudget/runAllTracks only stopped on teamId change. Fix: mountedRef gates loop + post-loop refreshes; unmount clears runningRef.

## Patterns established (catalogue items 1–5 for this campaign)

1. **Never use `items.length === 0` as "never fetched".** An empty success re-produces the guard state with a fresh array identity → infinite refetch. Use a one-shot ref keyed on the fetch target.
2. **An effect that mutates one of its own deps (consuming a store trigger) cannot use cleanup-flag cancellation.** Check live store identity at each async hop instead.
3. **Fetcher functions consumed by effect-driven hooks must be identity-stable.** Audit every call site of such hooks for inline arrows.
4. **setState inside an effect whose deps include that state needs an idempotency comparison** (or drop the state from deps and read via ref).
5. **Every hand-rolled poll/advance loop in a hook needs a mountedRef check in its loop condition and after each await.**

## What remains

Themes B–I per INDEX.md: B broken caches (6), C IPC chattiness (18), D SQLite efficiency (4), E Rust runtime hygiene (13), F render/stream churn (26), G UI/logic correctness (13), H dead code (23), I duplication w/ drift (19) — plus 926 Medium/Low backlog.
