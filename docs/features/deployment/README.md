# Deployment

Deployment is the operational view over personas that have been pushed to a remote runtime — currently Personas Cloud and (via the [GitLab plugin](../gitlab.md)) GitLab CI/CD agents. The `src/features/deployment/` feature owns the dashboard, the cloud-specific panels, and the unified table that mixes deployment targets.

> Cloud is the canonical remote runtime; GitLab agents surface here for at-a-glance visibility, but their authoritative panel lives in the GitLab plugin.

## Page hosts

Two top-level entry points:

- `UnifiedDeploymentDashboard.tsx` — the all-targets dashboard, lazy-mounted into the personas section. It mixes Cloud and GitLab deployments through a `DeployTarget` discriminator.
- `cloud/CloudDeployPanel.tsx` — the cloud-only deployment panel, also lazy-mounted; consumed for the dedicated Cloud sub-view.

Both pages are wired in `src/features/personas/PersonasPage.tsx`.

## Top-level surface

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Unified dashboard | Mixed Cloud + GitLab deployments with sort/filter/bulk actions | `UnifiedDeploymentDashboard.tsx`, `DeploymentTable.tsx`, `DeploymentFilters.tsx`, `BulkActionsToolbar.tsx`, `DeploymentSubComponents.tsx` (SummaryCard etc.), `DeploymentHealthSparkline.tsx`, `ExecutionProgressBar.tsx` |
| Tokens / typing | Per-target tokens (status, color, icon) and shared `DeploymentTypes` | `deploymentTokens.ts`, `deploymentTypes.ts` |
| Hooks | Health rollup, manual test, cloud health monitor | `hooks/useDeploymentHealth.ts`, `hooks/useDeploymentTest.ts`, `hooks/useCloudHealthMonitor.ts` |

`deploymentTypes.ts` defines `DeployTarget`, `DeployStatus`, `SortKey`, `SortDir`, `UnifiedDeployment`, `compareValues`, and the per-target status mappers (`mapCloudStatus`, `mapGitlabStatus`) that normalize each target into a single status enum.

## Cloud surface — `components/cloud/`

| Component | Behavior |
| --- | --- |
| `CloudDeployPanel.tsx` | Deploy a persona to cloud with a budget preset, see deployments list, deploy/pause/resume/remove actions |
| `CloudDeploymentsPanel.tsx` | The deployments list view (also embedded in CloudDeployPanel) |
| `DeploymentCard.tsx` | Per-deployment card — status, base URL, budget, run, sync |
| `CloudConnectionForm.tsx` | Connect to a cloud control-plane URL with API key, run diagnostics |
| `CloudOAuthPanel.tsx` | OAuth-based connect / refresh / disconnect (alternative to API key) |
| `CloudStatusPanel.tsx` | High-level cloud status — connected / not, worker counts, base URL |
| `CloudHistoryPanel.tsx` | Per-deployment execution history with `CloudExecutionRow.tsx` and `CloudHistoryHelpers.tsx` |
| `CloudSchedulesPanel.tsx` | Schedule list for cloud-deployed personas (`cloudSchedulesHelpers.tsx`, `CreateTriggerForm.tsx`, `TriggerListItem.tsx`) |
| `ApiPlayground.tsx` | Inline API tester against the deployed persona's endpoints |
| `DailyBreakdownChart.tsx` | Daily executions / cost chart |
| `StatCard.tsx` | KPI card primitive |
| `cloudDeploymentHelpers.ts` | `BUDGET_PRESETS` and other cloud-specific helpers |

## State and store integration

Cloud state lives in `useSystemStore`:

| Store field | Purpose |
| --- | --- |
| `cloudConfig`, `cloudBaseUrl` | Connection config + base URL |
| `cloudDeployments` | Deployments list cache |
| `cloudFetchDeployments`, `cloudPauseDeploy`, `cloudResumeDeploy` | Action thunks |
| `gitlabConfig`, `gitlabAgents`, `gitlabSelectedProjectId` | GitLab side surfaced into the unified dashboard |

The unified dashboard derives a single sortable list by mapping each target's deployments through `mapCloudStatus`/`mapGitlabStatus` into `UnifiedDeployment`.

## Backend command surface

Frontend wrappers live in `src/api/system/cloud.ts`. Backend modules are under `src-tauri/src/cloud/`.

| Family | Wrappers | Backend |
| --- | --- | --- |
| Connect / config | `cloudConnect`, `cloudDiagnose`, `cloudReconnectFromKeyring`, `cloudDisconnect`, `cloudGetConfig`, `cloudStatus` | `cloud/client.rs`, `cloud/config.rs` |
| OAuth | `cloudOAuthAuthorize`, `cloudOAuthCallback`, `cloudOAuthStatus`, `cloudOAuthRefresh`, `cloudOAuthDisconnect` | `cloud/client.rs` |
| Deploy | `cloudDeployPersona`, `cloudSyncPersona`, `cloudListDeployments`, `cloudPauseDeployment` (+ resume/remove) | `cloud/runner.rs` |
| Execute | `cloudExecutePersona`, `cloudCancelExecution` | `cloud/runner.rs` |

Bindings (`src/lib/bindings/Cloud*`) keep the TS shapes in sync with the Rust types.

## Engine — `src-tauri/src/cloud/`

| File | Concern |
| --- | --- |
| `mod.rs` | Module wiring |
| `config.rs` | Persisted config (URL, API key reference, OAuth state) |
| `client.rs` | HTTP client against the cloud control plane (connect, status, deploy, execute) |
| `runner.rs` | Cloud-execution orchestration — kicks off remote runs, polls status, threads diagnostics back to the UI |

## Health monitoring

`hooks/useCloudHealthMonitor.ts` polls `cloudStatus` on a cadence and surfaces connectivity transitions; `useDeploymentHealth.ts` aggregates per-deployment health for the dashboard health sparkline; `useDeploymentTest.ts` powers the manual-test action on a deployment row.

## Known gaps

- The unified dashboard mixes Cloud + GitLab targets, but extending to a third target requires a new `mapXyzStatus` mapper in `deploymentTypes.ts` and a new path in the row renderer; there is no plugin contract for "deployment target."
- The schedules panel inside cloud is a separate surface from [schedules.md](../schedules.md) (which covers local cron-driven personas). Cross-environment unification is not yet a thing.
- The cloud OAuth flow assumes a redirect handled by the local HTTP server — the UI dialog labels mention the desktop app must be running during the redirect; we don't currently surface that as a first-class precondition state.
