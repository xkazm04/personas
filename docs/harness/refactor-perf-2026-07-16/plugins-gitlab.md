# plugins/gitlab — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 4 medium / 1 low)
> Context group: Plugins & Companion | Files read: 14 | Missing: 0

## 1. Toggle switch markup triplicated inside PipelineNotificationPrefs despite a local Toggle component existing
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/gitlab/components/PipelineNotificationPrefs.tsx:66
- **Scenario**: The file defines a `Toggle` component (lines 11-41) and uses it for the three per-status prefs, but the master "enabled" switch (lines 66-83) and the "sound" switch (lines 114-131) inline the exact same ~15-line switch markup (same rounded-full track, translate-x knob, focus ring classes) verbatim.
- **Root cause**: The local `Toggle` bakes in a `label`-wrapped row layout, so the two switches that needed a slightly different row (icon in header / Volume2 icon) were copy-pasted instead of the component being parameterized.
- **Impact**: Any styling tweak to the switch (color token, size, focus ring) must be made in three places in one file; they will inevitably drift. Pure maintenance cost, no runtime effect.
- **Fix sketch**: Split `Toggle` into a bare `Switch` (just the `role="switch"` button + knob, taking `checked`, `onChange`, `id`, optional `aria-label`) and keep `Toggle` as `Switch` wrapped in the labeled row. Replace the two inlined switches with `<Switch />`. Net ~30 LOC removed from this file.

## 2. Two-stage rollback confirm row duplicated between DeploymentRow and VersionRow
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/gitlab/components/DeploymentHistoryTab.tsx:257
- **Scenario**: `DeploymentRow` (DeploymentHistoryTab.tsx:257-292) and `VersionRow` (GitOpsVersionHistory.tsx:300-335) render a near-identical confirm/cancel rollback action cluster: same red confirm button with spinner/AlertTriangle, same cancel button, same amber hover rollback trigger, same class strings. The parent components also duplicate the same `confirmRollback` string-state + first-click-arms/second-click-fires `handleRollback` state machine (DeploymentHistoryTab.tsx:48-58 vs GitOpsVersionHistory.tsx:56-66).
- **Root cause**: The GitOps version history and deployment history tabs were built separately and each grew its own copy of the confirm-then-execute rollback UI.
- **Impact**: ~70 duplicated LOC across the two files; a fix to one confirm flow (e.g. adding an Escape-to-cancel or timeout auto-disarm) has to be applied twice and can drift — the confirm button labels already differ slightly (`t.common.confirm` vs `t.gitlab.confirm_rollback_version`).
- **Fix sketch**: Extract a `RollbackActions` component (props: `isConfirming`, `busy`, `confirmLabel`, `onRollback`, `onCancel`, `title`) into the gitlab components folder, and optionally a tiny `useConfirmAction<T>()` hook wrapping the armed-key state. Both rows and both parents consume it.

## 3. Bottom-of-file imports and thin re-export wrappers in pipelineHelpers
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/plugins/gitlab/components/pipelineHelpers.tsx:56
- **Scenario**: Lines 56-60 place two `import` statements after all the code, each immediately followed by a one-line re-export wrapper (`formatDuration`, `formatRelative`) around `@/lib/utils/formatters`.
- **Root cause**: Wrappers were appended during a formatter consolidation pass without moving the imports to the top or questioning whether the aliases still earn their keep.
- **Impact**: Imports below code are a readability trap (easy to miss when scanning dependencies) and the `formatRelative` alias adds an indirection layer over an identical call. Cosmetic only — bundlers hoist imports, so no runtime cost.
- **Fix sketch**: Move both imports to the file header. Keep `formatDuration` (it bakes in `{ unit: 's' }` for two callers) but consider inlining `formatRelative` at its single call site (PipelineRow.tsx:36) and dropping the alias.

## 4. PipelineStatusBadge fires one gitlabFetchPipelines per rendered agent when the pipeline cache is empty
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/plugins/gitlab/components/GitLabAgentList.tsx:134
- **Scenario**: `GitLabAgentList` renders one `PipelineStatusBadge` per agent inside the `agents.map`. Each badge instance runs `useEffect(() => { if (pipelines.length === 0) fetchPipelines(projectId); })`. On first mount with an empty pipeline cache, all N effects run in the same commit before any fetch resolves, so N identical GitLab API requests are issued for one piece of data (the latest pipeline, which is the same for every badge anyway).
- **Root cause**: The fetch-if-empty responsibility was placed inside the per-row badge instead of once in the list (or the store), and the emptiness check cannot see in-flight requests.
- **Impact**: N duplicate network round-trips to the GitLab REST API on every visit to the Agents tab (and again whenever the cache is cleared), plus N redundant store writes. Agent lists are small today, so it is waste rather than breakage — but it also renders the identical badge N times, which is misleading UI.
- **Fix sketch**: Hoist the fetch into `GitLabAgentList`'s existing mount effect (it already calls `onFetchAgents(projectId)`; add a single `fetchPipelines(projectId)` guarded by emptiness), and make `PipelineStatusBadge` a pure reader of `gitlabPipelines[0]`. Alternatively add an in-flight guard in the store's `gitlabFetchPipelines`. Also consider rendering the badge once in the list header since it is per-project, not per-agent.

## 5. JobLogViewer renders the entire raw CI log into the DOM with no size cap
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/plugins/gitlab/components/JobRow.tsx:40
- **Scenario**: Expanding a job renders `gitlabJobLog` — the full raw trace from GitLab — as a single text node inside a `<pre>` with `whitespace-pre-wrap break-all`. Real CI job traces routinely reach hundreds of KB to several MB (GitLab's own trace limit is far above that); wrapping + break-all layout on a megabyte-scale text node causes a multi-hundred-ms layout stall and a large retained DOM/string, inside a Tauri webview.
- **Root cause**: The viewer assumes short logs; there is no truncation at either the fetch layer (`gitlabFetchJobLog`) or the render layer.
- **Impact**: Expanding a verbose job (e.g. a test suite with dumped output) freezes the panel during layout and keeps the whole log string alive in the store even after collapse. Bounded — it only bites on expand — but it is the hot interaction of the pipelines tab when debugging failures.
- **Fix sketch**: Cap what is rendered: show only the last ~500 lines (tail is what users want for CI failures) with a "showing last N lines — open in GitLab for full log" notice reusing the existing `webUrl` link; slice with `log.split('\n').slice(-500)` memoized on `log`. Optionally have the Rust/store side truncate the stored trace to a fixed byte budget so collapsed logs don't sit in memory.
