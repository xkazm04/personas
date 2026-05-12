# Code-refactor scan — Automations & Deployment

> Total: 10 findings (3 high, 5 medium, 2 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: Listed below

## Path drift

None of the listed paths existed verbatim. Confirmed actual locations:
- `src/features/automations` does NOT exist. Automation UI lives at `src/features/agents/sub_connectors/components/automation/` and `src/features/deployment/components/cloud/CloudSchedulesPanel.tsx` + helpers.
- `src/features/deployment/targets` and `src/features/deployment/rollout` do NOT exist. Deployment UI is flat at `src/features/deployment/components/` with `cloud/` subfolder.
- `src/api/automations` and `src/api/deployment.ts`/`src/api/rollout.ts` do NOT exist. Frontend API surface lives at `src/api/agents/automations.ts` and `src/api/system/cloud.ts` / `src/api/system/gitlab.ts`.
- `src/lib/automations`, `src/lib/deployment` do NOT exist. Only TS bindings under `src/lib/bindings/`.
- `src/stores/slices/automation` and `src/stores/slices/deployment` do NOT exist. Actual: `src/stores/slices/vault/automationSlice.ts`, `src/stores/slices/system/cloudSlice.ts`, `src/stores/slices/system/gitlabSlice.ts`, `src/stores/slices/system/deployTarget.ts`.
- `src-tauri/src/commands/automations`, `deployment.rs`, `rollout.rs` do NOT exist. Actual: `src-tauri/src/commands/tools/automations.rs`, `automation_design.rs`, `deploy_automation.rs`, `n8n_platform.rs`, `github_platform.rs`.
- `src-tauri/src/db/models/automation.rs` exists. `deployment.rs` does NOT — there's only `db/repos/resources/deployment_history.rs`.
- `src-tauri/src/db/repos/automation` does NOT exist as a directory. Actual: `db/repos/resources/automations.rs` (single file).

There is no separate "rollout" pipeline anywhere in the codebase — deploy is one-shot via `cloudDeployPersona` / `deployAutomation`.

## 1. Frontend Zapier API wrappers call Tauri commands that don't exist on the backend
- **Severity**: high
- **Category**: dead-code
- **File**: `src/api/agents/automations.ts:79-86`
- **Scenario**: `zapierListZaps`, `zapierCreateZap`, and `zapierTriggerWebhook` invoke Tauri commands `"zapier_list_zaps"`, `"zapier_create_zap"`, `"zapier_trigger_webhook"`. A full-tree grep for these strings in `src-tauri/` returns zero hits — no `#[tauri::command]` registration, no handler. The only Rust Zapier code is `engine/platforms/zapier.rs` (`ZapierClient::validate_catch_hook`), used internally by `engine/platforms/deploy.rs:388` but never exposed via IPC.
- **Root cause**: Frontend stubs created in anticipation of backend wiring that never landed (or was removed). `automationSlice.fetchZapierZaps` and `automationSlice.zapierTestWebhook` (`src/stores/slices/vault/automationSlice.ts:132-149`) call these wrappers; both slice actions have no consumers (grep for `fetchZapierZaps`/`zapierTestWebhook` outside the slice = 0 hits). `zapierListZaps` is also referenced in `src/features/agents/sub_connectors/libs/useAutomationSetup.ts:151` — that path would 500 at runtime.
- **Impact**: ~30 LOC of dead frontend wrappers + ~20 LOC of dead store actions + one runtime-broken UI path (Zapier connector setup). `zapierCreateZap`/`zapierTriggerWebhook` types pollute the public `automations.ts` export surface.
- **Fix sketch**: Delete `zapierListZaps`, `zapierCreateZap`, `zapierTriggerWebhook` from `src/api/agents/automations.ts:79-86` and the corresponding `export type { ZapierZap }` / `ZapierWebhookResult` re-exports. Remove `fetchZapierZaps`, `zapierTestWebhook`, `zapierZaps`, `zapierZapsLoading` from `AutomationSlice` (vault). Fix `useAutomationSetup.ts:151` (replace with a TODO or drop the branch). If Zapier list/test is still on the roadmap, file an issue — leaving broken IPC stubs is worse than no surface.

## 2. n8n CRUD frontend wrappers are entirely unused (4 functions, paired Rust commands also orphaned)
- **Severity**: high
- **Category**: dead-code
- **File**: `src/api/agents/automations.ts:62-75`
- **Scenario**: `n8nListWorkflows`, `n8nCreateWorkflow`, `n8nTriggerWebhook`, `n8nDeactivateWorkflow` (and likely `n8nActivateWorkflow`) have zero call sites outside `automations.ts` itself (verified via grep). The matching Rust commands (`n8n_list_workflows`, `n8n_create_workflow`, `n8n_trigger_webhook` in `src-tauri/src/commands/tools/n8n_platform.rs:11,46,58`) are registered in `src-tauri/src/lib.rs:1873-1877` but unreachable from the UI.
- **Root cause**: An n8n management UI was planned but never built; only the deploy path (`engine/platforms/n8n::deploy_workflow`, invoked by `deploy_automation`) and `n8n_activate_workflow`/`n8n_deactivate_workflow` are actually used (via `automationSlice` and `useAutomationSetup`).
- **Impact**: ~14 LOC dead in frontend, ~50 LOC dead in `n8n_platform.rs` + matching code in `engine/platforms/n8n.rs:127,194,213` (`list_workflows`, `create_workflow`, `trigger_webhook` methods on `N8nClient`). Drags 3 unused command names through `commandNames.generated.ts:829-832`.
- **Fix sketch**: Delete the 4 frontend wrappers and their re-exported types (`N8nWorkflow` export at line 15, etc., keep only what `useAutomationSetup` needs). On Rust side, delete `n8n_list_workflows`, `n8n_create_workflow`, `n8n_trigger_webhook` `#[tauri::command]` blocks, their `lib.rs:1873-1877` registrations, and the corresponding `N8nClient` methods. Regenerate `commandNames.generated.ts`.

## 3. `useDeploymentTest` hook duplicates inline `handleAction(setBusyId)` pattern from DeploymentCard
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/deployment/components/UnifiedDeploymentDashboard.tsx:39,107-110` and `src/features/deployment/components/cloud/DeploymentCard.tsx:41,46-49`
- **Scenario**: Both files inline the identical `useState<string|null>` busy-tracker plus a wrapper that does `setBusyId(id); try { await action(); } finally { setBusyId(null); }`. The dashboard wires it through to `DeploymentTable`; the card uses its own copy. Same 4-line pattern, two implementations.
- **Root cause**: When `DeploymentCard` was extracted from the original cloud panel, the busy-state logic was copied rather than lifted.
- **Impact**: ~10 LOC duplicated; bug-risk if one site adds an error toast / abort signal / disabled-stack and the other doesn't.
- **Fix sketch**: Extract a `useBusyAction<T = string>()` hook returning `{ busyId, run: (id: T, fn: () => Promise<void>) => Promise<void> }` to `src/hooks/utility/interaction/useBusyAction.ts` (next to `useKeyedCopyFlag` which follows the same shape). Use it in both spots.

## 4. Status-color/badge color maps duplicated 4+ times across the deployment area
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/deployment/components/deploymentTypes.ts:94-102` (`statusBadge`), `src/features/deployment/components/cloud/cloudDeploymentHelpers.ts:25-36` (`statusColor`), `src/features/deployment/components/cloud/CloudStatusPanel.tsx:136-140` (`WorkerBadge.colorMap`), `src/features/deployment/components/DeploymentTable.tsx:153-155` (inline pass/fail string), `src/features/deployment/components/cloud/DeploymentCard.tsx:179-180` (inline pass/fail string)
- **Scenario**: The same string literal `'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'` (and amber/red counterparts) is repeated as Tailwind class triples in at least 9 files (per grep). Within the deployment area alone there are 5 distinct lookup sites doing essentially `status -> {bg, border, text}` mapping with no shared type, leading to inconsistencies (e.g. `paused` uses `border-amber-500/25` in `statusBadge` and `cloudDeploymentHelpers.statusColor`, but other places omit the `/25` suffix).
- **Root cause**: No shared status-color registry; the team has been copying the triple inline because the existing `statusBadge` returns a single string and is keyed on `DeployStatus`, not generic.
- **Impact**: 5+ duplicated sites, ~25 LOC, latent drift risk (already drifted on the `/25` suffix).
- **Fix sketch**: Define a `STATUS_TOKENS: Record<'active'|'paused'|'failed'|'success'|'error'|'warning'|'info'|'unknown', { bg: string; border: string; text: string; combined: string }>` in `src/lib/utils/designTokens.ts` (which already exports `INPUT_FIELD`). Replace `statusBadge`, `statusColor`, `WorkerBadge.colorMap`, and inline pass/fail spans with `STATUS_TOKENS.<key>.combined`.

## 5. `deriveConnectionPhase` + `DeployConnectionPhase` type are exported but never imported
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/stores/slices/system/deployTarget.ts:92-106`
- **Scenario**: `deriveConnectionPhase()` (10 LOC) plus its `DeployConnectionPhase` union type are public exports. Repo-wide grep returns only the declaration lines — zero call sites in `src/`, `src-tauri/`, or `tests/`.
- **Root cause**: Added speculatively during the cloud/gitlab unification refactor; the consuming code (a status-pill component, presumably) was never wired up. The rest of the file (`translateCloudError`, `isAuthError`) IS used.
- **Impact**: ~16 LOC dead in a high-traffic shared module.
- **Fix sketch**: Delete lines 90-106 of `deployTarget.ts`. If a downstream needs phase logic, derive it inline in `<ConnectionStatusBadge>` — that's the only component currently rendering connection state.

## 6. Dead aliased imports in `CloudHistoryPanel` (`_statusIcon`, `_timeAgo`)
- **Severity**: low
- **Category**: cruft
- **File**: `src/features/deployment/components/cloud/CloudHistoryPanel.tsx:12`
- **Scenario**: Imports `statusIcon as _statusIcon` and `timeAgo as _timeAgo` from `./CloudHistoryHelpers`. Underscore-prefix renames typically mark "intentionally unused" — and indeed neither is referenced anywhere else in the file. The actual usages of `statusIcon`/`timeAgo` happen in `CloudExecutionRow.tsx`.
- **Root cause**: Refactor leftover — these were probably used directly in `CloudHistoryPanel` before being moved into `CloudExecutionRow`. The author lint-silenced rather than removing.
- **Impact**: 2 dead imports; noise for readers trying to understand panel dependencies.
- **Fix sketch**: Change import to `import { formatDuration, formatCost } from './CloudHistoryHelpers';` (drop `statusIcon` and `timeAgo` entirely).

## 7. `CloudSchedulesPanelProps` interface exported but never imported
- **Severity**: low
- **Category**: dead-code
- **File**: `src/features/deployment/components/cloud/cloudSchedulesHelpers.tsx:18-21`
- **Scenario**: `export interface CloudSchedulesPanelProps { deployments; onRefresh }` lives in the helpers module. `CloudSchedulesPanel.tsx:19-22` defines its own private `interface Props` with the same shape rather than consuming the exported one. Grep for `CloudSchedulesPanelProps` returns only the declaration.
- **Root cause**: Type was hoisted "for reuse" then forgotten, and the panel was written against an inline `Props`.
- **Impact**: 4 LOC dead + minor type drift risk.
- **Fix sketch**: Delete the interface from `cloudSchedulesHelpers.tsx`, or alternatively delete the inline `Props` in `CloudSchedulesPanel.tsx:19-22` and import `CloudSchedulesPanelProps`. Prefer the former (helpers files shouldn't own props types).

## 8. Bulk-action implementation duplicated 3× inside cloudSlice
- **Severity**: medium
- **Category**: duplication
- **File**: `src/stores/slices/system/cloudSlice.ts:349-413`
- **Scenario**: `cloudBulkPause`, `cloudBulkResume`, `cloudBulkRemove` are three near-identical 20-line `Promise.allSettled` + result-mapping + event-emit + state-set blocks. The only varying axes are: the per-id API call, the `eventType`, and "update map" vs "remove set" state semantics.
- **Root cause**: Pattern was hand-rolled three times rather than parameterized.
- **Impact**: ~65 LOC for what should be ~25.
- **Fix sketch**: Extract a `runBulk<TKey>({ ids, apiCall, eventType, applyUpdate })` helper inside cloudSlice (or a sibling `cloudBulkOps.ts`). Pause/resume share `applyUpdate = (state, updates) => map d -> updates[d.id] ?? d`; remove uses `(state, removedSet) => filter d -> !removedSet.has(d.id)`. Cuts repetition while keeping the single-vs-multi action distinction explicit.

## 9. `getAutomation` Tauri command is exposed but unused on the frontend
- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/commands/tools/automations.rs:72-79` + `src/api/agents/automations.ts:28-29`
- **Scenario**: `getAutomation(id)` (frontend wrapper) and `get_automation` (Tauri command) form a complete read-by-id pair. Grep across `src/` for `getAutomation\b` (word boundary, excluding `getAutomationBlastRadius`/`getAutomationRuns`) shows the export but no callers — the codebase always fetches via `listAutomations(personaId)` and filters client-side (`automationSlice.deleteAutomation:69`, etc.).
- **Root cause**: Built proactively to round out the CRUD surface; never needed because the slice keeps a full list cached.
- **Impact**: ~10 LOC frontend + ~10 LOC Rust + 1 registered command name (memory + IPC surface area).
- **Fix sketch**: Either delete both ends (frontend wrapper, Rust command, lib.rs registration) or document that `get_automation` is for future direct-link routes. Recommend deletion until a concrete consumer exists.

## 10. `useDeploymentHealth` and `useCloudHealthMonitor` collocated with unrelated lifecycles
- **Severity**: low
- **Category**: structure
- **File**: `src/features/deployment/hooks/useCloudHealthMonitor.ts` (156 LOC) and `src/features/deployment/hooks/useDeploymentHealth.ts` (104 LOC)
- **Scenario**: The two "health" hooks measure completely different things despite identical naming: `useCloudHealthMonitor` polls `cloudGetConfig` and runs reconnect backoff (a connection-state machine), while `useDeploymentHealth` fetches per-persona `cloudExecutionStats` and produces sparkline data for the dashboard. The shared `/health` prefix obscures this.
- **Root cause**: Both were added to the same `hooks/` directory because they both touch "deployment health" semantically, but they share zero code and have orthogonal responsibilities.
- **Impact**: Discovery confusion; future devs naming a third "health" thing will pick one of these accidentally. Not strictly dead but a structure smell.
- **Fix sketch**: Rename `useCloudHealthMonitor` → `useCloudReconnectMonitor` (it's a reconnection state machine, not a health check) and leave `useDeploymentHealth` as the sparkline-stats hook. Optionally extract reconnect state machine into `stores/slices/system/cloudReconnect.ts` since it's pure store mutation with no DOM dependency.
