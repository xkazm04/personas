# api (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 4 findings (0 critical / 0 high / 3 medium / 1 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. devTools.ts is a 1161-line god module spanning ~15 command domains
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/api/devTools/devTools.ts:1
- **Scenario**: Any change to one dev-tools domain (goals, competitions, triage, portfolio, skills…) means navigating a single 1161-line file that also carries hand-typed interfaces (`CrossProjectMetadataMap`, `ContextAuditReport`, `RepoEvidence`, `PortfolioHealthSummary`, etc.) interleaved with wrappers; merge conflicts and accidental cross-domain edits become routine.
- **Root cause**: Wrappers accreted in one file while sibling domains were already split out (`kpis.ts`, `useCases.ts`, `autopilot.ts` live next to it and prove the intended pattern).
- **Impact**: Real maintenance hazard on a file touched by many features (stores, hooks, dev-tools plugin all import from it); no runtime cost since exports are tree-shakeable consts.
- **Fix sketch**: Split along the existing `// ===` section banners into `projects.ts`, `goals.ts`, `contexts.ts`, `ideas.ts`, `scans.ts`, `tasks.ts`, `competitions.ts`, `triage.ts`, `portfolio.ts`, `skills.ts`, and re-export everything from `devTools.ts` (or an `index.ts`) so no caller changes. Pure mechanical move; a matching moonshot idea (split-commandhandlers/god-module) already exists in the backlog.

## 2. `startBatch` is a dead duplicate of `startBatchExecution` with divergent error semantics
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/api/devTools/devTools.ts:889
- **Scenario**: Both `startBatch` (line 889, `safeInvoke` with a `{ batch_id: "", started: 0 }` silent fallback) and `startBatchExecution` (line 904, throwing `invoke`, adds `maxParallel`) call the same Rust command `dev_tools_start_batch`. A future caller picking `startBatch` gets silent-failure semantics and no parallelism cap, diverging from the store path.
- **Root cause**: The CLI-execution rework added `startBatchExecution` without removing the older wrapper; `devToolsTaskSlice.ts:103` and `NewCompetitionModal.tsx:60` use only `startBatchExecution` — repo-wide grep shows zero callers of the api-level `startBatch` (the `startBatch` in `useDevToolsActions`/`TaskRunnerPage` is the store action, not this export).
- **Impact**: Dead export plus a trap: two wrappers for one command with opposite failure behavior (swallow vs throw).
- **Fix sketch**: Delete `startBatch` (devTools.ts:889-890). Optionally rename `startBatchExecution` → `startBatch` in a follow-up if the shorter name is preferred; keep the throwing semantics.

## 3. Dead frontend wrappers: cross-project relations + superseded design-message append
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/api/devTools/devTools.ts:932
- **Scenario**: `upsertCrossProjectRelation` (devTools.ts:932) and `listCrossProjectRelations` (devTools.ts:945) have zero callers anywhere in the repo. `appendDesignConversationMessage` (src/api/design/design.ts:46) is likewise uncalled — its own sibling `appendSingleDesignMessage` is documented as the O(1)-payload replacement and is the only variant `useDesignConversation.ts` uses.
- **Root cause**: Features evolved (cross-project map reads come via `getCrossProjectMap`/`getCrossProjectMetadata`; design chat moved to single-message append) but the old wrappers were left behind.
- **Impact**: Noise and a stale full-array-payload API that invites the exact IPC bloat the replacement was written to avoid. Frontend-only removal; the Rust commands can stay registered (external/CLI callers unaffected).
- **Fix sketch**: Delete the three exports. Verified by repo-wide grep; re-verify nothing constructs the names dynamically (none found — all invokes here use string literals, and these are TS identifiers, not command strings).

## 4. Scan-status polling re-transfers the full `lines[]` log every 3s with no cursor
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/api/devTools/kpis.ts:128
- **Scenario**: `getKpiScanStatus`, `getUseCaseScanStatus` (useCases.ts:88) and `getScanCodebaseStatus` (devTools.ts:577) return the scan's entire accumulated `lines: string[]` on every call. `KpiProposalsPanel.tsx:70-75` and `FactoryOverviewTab.tsx:319` poll every 3s for up to 40 iterations, and the codebase-scan UI does the same for multi-minute LLM scans — so a scan emitting N log lines ships O(N²) cumulative bytes over Tauri IPC (serialize in Rust, deserialize in JS, re-render) across its lifetime.
- **Root cause**: The status endpoints have no incremental contract — no `sinceLine` cursor or `rev` change-gate — even though the codebase already has the pattern (`fleet_terminal_previews` takes `knownRevs` and omits unchanged sessions, fleet.ts:75).
- **Impact**: For long codebase/KPI scans with verbose CLI output the poll payload grows to the full log every tick; measurable IPC + JSON churn and jank in the log-tail UI while a scan runs (a hot, user-watched path).
- **Fix sketch**: Add an optional `sinceLine: number` (or `rev`) param to the three status commands and their wrappers; return only new lines plus the new cursor, and have pollers accumulate locally. Backward compatible: omitted cursor keeps returning the full log.
