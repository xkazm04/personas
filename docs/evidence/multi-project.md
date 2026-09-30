---
subject: multi-project
evidence:
  - src-tauri/db/src/repos/dev_tools.rs                                # identity minted (UUID v4) at the ONE create door; name/root_path validated, re-bindable fields
  - src/lib/milestone/shipDerive.ts               # the ID-keyed-join doctrine in code: "resolves by context ID, never by display name" + the measured name-join defect
  - src/features/teams/sub_factory/passport/ProjectsPassportWall.tsx   # the L1 wall: overview covers + compare matrix, two views of one population, gap-sort triage
  - src/features/teams/sub_factory/passport/passportDerive.ts          # normalized dimensions with explicit-gap honesty ("never an invented value — that honesty is the whole point of the comparison")
  - src/features/studio/StudioTabBar.tsx                               # browser-style tab strip, per-tab live status dot, narrowest-projection subscriptions
  - src/features/studio/studioHistory.ts                               # the persisted open-tab set + restore-and-reattach rationale (H10)
  - src-tauri/src/engine/project_tracking/scheduler.rs                 # hourly baseline tick, per-project failure isolation, event pruning
  - src-tauri/src/engine/project_tracking/push.rs                      # push acceleration with per-project debounce protecting the consolidation budget
  - src/features/teams/sub_factory/passport/populateDispatch.ts        # the metadata-contract populate door: lanes, freshness gates surfaced at consent, out-of-scope honesty
  - .claude/CLAUDE.md                                                  # "Two different maps currently claim this file" — the foreign-snapshot 5×-mis-sizing warning; the registry (DB) is the authority
counter_evidence:
  - src-tauri/src/engine/project_tracking/watchers/git.rs              # watcher failure returns Ok(vec![]) — could-not-observe spelled identically to observed-quiet past the log line
deviations:
  - w11-multi-project   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Multi Project - evidence

How this codebase measures against the [`multi-project`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
