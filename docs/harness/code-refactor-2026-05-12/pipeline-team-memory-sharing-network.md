# Code-refactor scan — Pipeline, Team Memory, Sharing & Network

> Total: 10 findings (3 high, 5 medium, 2 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: heavy — `src/features/team-memory`, `src/features/network` (as feature dirs), `src/api/pipeline.ts`/`teamMemory.ts`/`sharing.ts`/`network.ts` (as flat files), `src/lib/pipeline`, `src/lib/teamMemory`, `src/stores/slices/pipelineSlice.ts`/`teamMemorySlice.ts`/`sharingSlice.ts`, `src-tauri/src/commands/pipeline.rs`/`team_memory.rs`/`sharing.rs`/`network.rs` (flat files), `src-tauri/src/db/models/pipeline.rs`/`sharing.rs`, `src-tauri/src/db/repos/pipeline`/`team_memory` (as dirs) do not exist. Actual layout:
> - Pipeline UI: `src/features/pipeline/{components,sub_canvas,sub_teamMemory}`
> - Team memory UI: nested under `src/features/pipeline/sub_teamMemory`
> - Sharing UI: `src/features/sharing/components` (includes peer/network/bundle/enclave/exposure/identity together)
> - Network feature dir: does not exist on the UI side (folded into `sharing/`)
> - Frontend API: `src/api/pipeline/{teams,teamMemories,groups,scheduler,triggers,workflows}.ts`, `src/api/network/{bundle,discovery,enclave,exposure,identity}.ts`
> - Frontend store: `src/stores/slices/pipeline/{teamSlice,groupSlice,recipeSlice,triggerSlice}.ts`, `src/stores/slices/network/networkSlice.ts`
> - Rust commands: `src-tauri/src/commands/teams/{teams,team_memories}.rs`, `src-tauri/src/commands/network/{bundle,discovery,enclave,exposure,identity}.rs`
> - Rust models: `src-tauri/src/db/models/{team,team_memory,identity,exposure,...}.rs`
> - Rust repos: `src-tauri/src/db/repos/resources/{teams,team_memories,exposure,identity,...}.rs`

## 1. Workflow compiler module is orphaned — Rust command never invoked from frontend
- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/engine/workflow_compiler.rs:1` (396 LOC); `src-tauri/src/commands/teams/teams.rs:508` (40 LOC `compile_workflow` Tauri command); `src-tauri/src/lib.rs:1831` (registration)
- **Scenario**: `compile_workflow` is registered as a Tauri command and exists in the generated command-name union (`src/lib/commandNames.generated.ts:207`), but no `invoke("compile_workflow", …)` call exists in `src/`. The only frontend topology entry points are `suggestTopology` / `suggestTopologyLlm` (`src/api/pipeline/teams.ts:131-135`), which call different commands and re-use `run_llm_topology_request` directly. `useAutoTeam.ts` orchestrates team creation manually via `createTeam` + `addTeamMember` + `createTeamConnection`, bypassing `compile_workflow` entirely.
- **Root cause**: `compile_workflow` is a parallel codepath that was superseded by the heuristic + LLM topology pair plus client-side team assembly. The README still references it (`src-tauri/src/engine/README.md:25`) under the non-existent name `compose_team_from_workflow`, confirming the path drifted.
- **Impact**: ~440 LOC dead Rust (`workflow_compiler.rs` + `compile_workflow` command + `CompiledWorkflow` TS-RS export + `persist_blueprint` helper); ongoing compile cost and Tauri command-table bloat; misleading docs.
- **Fix sketch**: Delete `src-tauri/src/engine/workflow_compiler.rs`, the `compile_workflow` command in `commands/teams/teams.rs:508-546`, the registration in `lib.rs:1831`, the `engine/README.md` row, and the generated TS binding. Re-run `cargo build` and regenerate `commandNames.generated.ts`. Heuristic + LLM topology + `useAutoTeam.apply()` already cover the use-case.

## 2. `snapToGrid` / `GRID_SIZE` redefined in pipeline canvas, ignoring shared util
- **Severity**: high
- **Category**: duplication
- **File**: `src/features/pipeline/components/canvas/useCanvasHandlers.ts:17-20`; shared canonical at `src/lib/canvas/gridUtils.ts:3-7`
- **Scenario**: `src/lib/canvas/gridUtils.ts` was created as the single source of truth (and trigger studio uses it correctly via `src/features/triggers/sub_builder/libs/eventCanvasConstants.ts:101` and `sub_studio/libs/triggerStudioConstants.ts:16`). The pipeline canvas instead re-declares `GRID_SIZE = 24` and an identical `snapToGrid` in `useCanvasHandlers.ts`, then 4 other pipeline files (`canvasAutoLayout.ts:4`, `useCanvasDragDrop.ts:6`, `CanvasFlowLayer.tsx:24`, `TeamCanvas.tsx:19`) import from the local re-export — bypassing the shared util at 5 import sites.
- **Root cause**: Local re-declaration predates `src/lib/canvas/gridUtils.ts`; never migrated when the shared util landed.
- **Impact**: Two sources of truth for grid spacing across the canvas system; a future change to `GRID_SIZE` in the shared util silently fails to propagate to the pipeline canvas (visual snap drift between trigger studio and team canvas).
- **Fix sketch**: Delete lines 17-20 of `useCanvasHandlers.ts`; re-export `snapToGrid`/`GRID_SIZE` from `@/lib/canvas/gridUtils` if the existing four importers prefer a local namespace, or update those 4 imports to `@/lib/canvas/gridUtils` directly. Match the trigger-studio pattern.

## 3. Relative-time formatter re-implemented 4 times across sharing & pipeline
- **Severity**: high
- **Category**: duplication
- **File**: `src/features/sharing/components/PeerCard.tsx:44-54` (`lastSeen`); `src/features/sharing/components/PeerList.tsx:12-26` (`useRelativeTime`); `src/features/pipeline/sub_teamMemory/components/timeline/TimelineItem.tsx:4-16` (`formatTime`); shared canonical at `src/lib/utils/formatters.ts:10-31` (`formatRelativeTime`)
- **Scenario**: A canonical `formatRelativeTime` exists in `src/lib/utils/formatters.ts` and is correctly used by `PeerDetailDrawer.tsx:9` and `TeamConfigPanel.tsx:8`. Yet three sites inside the same feature group reinvent the same `just now`/`Xm ago`/`Xh ago` ladder with subtly different thresholds: `PeerList` uses 10_000 / 60_000 / 3_600_000 ms, `PeerCard` uses 60_000 / 3_600_000 ms, `TimelineItem` adds a 7-day cutoff. Behavior diverges in the first 10 seconds, the days-ago tier, and `Never` vs empty-string fallback.
- **Root cause**: Each component author rolled their own when adding the feature; the shared util landed later (note in formatters.ts:39 says "previously redefined inline in 4 different deployment helpers" — the same pattern persists here).
- **Impact**: 4 maintenance points for one widget; 3 divergent timeline labels presented to the same user across the Sharing/Pipeline pages erodes trust in "freshness" semantics.
- **Fix sketch**: Replace all three locals with `formatRelativeTime(iso)` from `@/lib/utils/formatters`. The polling `useRelativeTime` re-render hook in `PeerList.tsx:12` can be kept as a thin wrapper (`setInterval` tick → `formatRelativeTime`), but the date arithmetic must be deleted.

## 4. Peer-ID `head…tail` truncation duplicated at 5 sites
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/sharing/components/PeerCard.tsx:40-42`; `src/features/sharing/components/PeerDetailDrawer.tsx:121-123`; `src/features/sharing/components/NetworkDashboard.tsx:351`; `src/features/sharing/components/BundlePreviewContent.tsx:58`; `src/features/sharing/components/EnclaveVerificationView.tsx:67`
- **Scenario**: The same `${id.slice(0,8)}...${id.slice(-8)}` (or 12/12 in EnclaveVerificationView) appears at 5 sites. The "long IDs are truncated head-tail" is a UX policy worth one helper; the 12/12 variant in EnclaveVerificationView is silent drift on the same policy.
- **Root cause**: No shared `truncatePeerId(id, head=8, tail=8)` helper exists.
- **Impact**: 5 identical (or near-identical) inline expressions; changing the truncation length (e.g. for the new wider PeerDetailDrawer) requires a 5-site sweep with one variant already drifted.
- **Fix sketch**: Add `formatPeerId(id: string, head = 8, tail = 8): string` to `src/lib/utils/formatters.ts` (next to `formatRelativeTime`). Replace all 5 sites; let EnclaveVerificationView pass `12, 12` explicitly so the drift is intentional, not accidental.

## 5. `fetchDiscoveredPeers` & `fetchNetworkStatus` slice actions are component-orphans
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/stores/slices/network/networkSlice.ts:419-426` (`fetchDiscoveredPeers`), `:481-488` (`fetchNetworkStatus`); their backing API endpoints `src/api/network/discovery.ts:92` (`getDiscoveredPeers`), `:118` (`getNetworkStatus`)
- **Scenario**: Both actions are still exported from the slice and exercised by tests (`networkSlice.test.ts:51,52,78-100`), but no React component subscribes to them — `PeerList.tsx:33` and `NetworkDashboard.tsx:246` both consume `fetchNetworkSnapshot` (which already returns `discoveredPeers` + `status` inside `NetworkSnapshot`). The only runtime callers are `connectToPeer` (line 437) and `disconnectPeer` (line 453) refreshing peers after state changes — both could call `fetchNetworkSnapshot` instead since the surrounding code already maintains the snapshot via polling.
- **Root cause**: `fetchNetworkSnapshot` (line 490-506) was added as a single-call replacement, but the older granular fetchers were never removed; the per-endpoint failure-counting docstring (line 24-56) was also rewritten around 3 endpoints when in practice only one (`networkSnapshot`) ever fires from real UI code.
- **Impact**: ~30 LOC of unused slice actions + 2 unused IPC endpoints + 2 unused Rust commands (`get_discovered_peers`, `get_network_status` in `src-tauri/src/commands/network/discovery.rs`). Failure-counter machinery for the two unused endpoints (`ENDPOINT_DISCOVERED_PEERS`, `ENDPOINT_NETWORK_STATUS` constants on lines 60-61) is also dead in the production path; the per-endpoint reset semantics that the long docstring justifies only ever cycles a single slot.
- **Fix sketch**: Either (a) replace the two `fetchDiscoveredPeers()` calls inside `connectToPeer`/`disconnectPeer` with `fetchNetworkSnapshot()`, then delete both actions + the unused endpoint constants + the now-dead tests; or (b) keep only `fetchDiscoveredPeers` (cheaper IPC for the post-connect refresh) and delete `fetchNetworkStatus` + simplify the failure-counter to 2 slots. Option (a) is cleaner — the snapshot poll is already running.

## 6. `ProvenanceBadge` + `provenance` slice state are dead
- **Severity**: medium
- **Category**: dead-code
- **File**: `src/features/sharing/components/ProvenanceBadge.tsx:1-25` (24 LOC component); `src/stores/slices/network/networkSlice.ts:69` (state field), `:139` (default), `:265-266` (write); `src/api/network/exposure.ts:67-68` (`listProvenance`); `src-tauri/src/commands/network/exposure.rs` (`list_provenance` command)
- **Scenario**: `ProvenanceBadge` is exported (`export function ProvenanceBadge`) but no file in `src/` imports it. The `provenance` field on `NetworkSlice`, the `listProvenance` API binding, the slice action that writes it, and the Rust command are all live wiring with zero consumer. Grep `ProvenanceBadge|state\.provenance|provenance:` returns only the definitions themselves.
- **Root cause**: Provenance UI was scaffolded but never wired into the bundle-import success path; the `imported_at` / `bundle_hash` row coming back from `apply_bundle_import` would be the natural attach point.
- **Impact**: Whole vertical slice (UI component + slice state + API call + Rust command) is dead until someone wires the badge into a list view. Hides a UX gap (users can't see which peer a persona came from after import).
- **Fix sketch**: Either wire `ProvenanceBadge` into the persona list / import-success celebration (it's the intended consumer judging by `ImportSuccessCelebration.tsx`), or delete the badge + slice field + the action that writes it (keep the API + Rust command if other consumers are imminent). Don't leave the half-wired version.

## 7. Double round-trip on memory load: `getTeamMemoryCount` is redundant when `getTeamMemoryStats` returns `total`
- **Severity**: medium
- **Category**: duplication
- **File**: `src/stores/slices/pipeline/teamSlice.ts:290-294` (`fetchTeamMemories` triple-fetch); `src-tauri/src/db/repos/resources/team_memories.rs:303-330` (`get_total_count`) vs `:332-401` (`get_stats` already returns `total: i64`)
- **Scenario**: `fetchTeamMemories` fires `Promise.all([listTeamMemories, getTeamMemoryCount, getTeamMemoryStats])`. The stats query (`get_stats`) already includes the same `COUNT(*)` over the same `team_id + category + search` WHERE clause (line 358-366). The only delta is that `get_total_count` also takes `run_id` — but the slice always passes the same filters as it does to `get_stats`, except when `runId` is set (in which case stats is computed without the run filter, which is a separate UX choice).
- **Root cause**: Two SQL endpoints calculate overlapping aggregates; the slice was wired against the more granular count endpoint before stats existed.
- **Impact**: One extra SQL query and one extra IPC round-trip on every memory-panel open + every filter change. For teams with thousands of memories this doubles the cold-load tail.
- **Fix sketch**: When `runId` is undefined, drop `getTeamMemoryCount` from the parallel batch and use `stats.total`. When `runId` is set, keep the count call as a single extra (since stats deliberately ignores `run_id`). Even simpler: extend `get_stats` to accept `run_id: Option<&str>` and remove `get_total_count` entirely; the dead Rust function is ~30 LOC.

## 8. `PersonaAvatar` exists in two non-interoperable variants
- **Severity**: medium
- **Category**: duplication
- **File**: `src/features/pipeline/sub_canvas/libs/teamConstants.tsx:38-70` (pipeline-local, 33 LOC); `src/features/shared/components/display/PersonaAvatar.tsx:1-102` (shared, 101 LOC)
- **Scenario**: Two components both exported as `PersonaAvatar`. Shared version handles theme-aware agent-icon PNGs, name-initial fallback, Bot icon fallback, and an emoji heuristic; pipeline version is a simpler emoji-or-img renderer with the bot fallback hardcoded to `\u{1F916}` and no `name` prop. `TeamDragPanel.tsx:5` and `TeamConfigPanel.tsx:4` use the pipeline variant; `PersonaEditorHeader.tsx:5` and `PersonaHealthIndicator.tsx:2` use the shared variant. Both render persona icons against a `color`-tinted background, so a persona viewed in the pipeline canvas vs. the persona editor can render differently for the same input (theme-aware PNG fallback only fires in shared).
- **Root cause**: Pipeline avatar predates the shared util.
- **Impact**: ~70 LOC duplicated; theme-aware agent icons silently degrade on the pipeline canvas; bot fallback differs (`🤖` literal vs. `lucide Bot`).
- **Fix sketch**: Add `size: 'sm'` to the shared variant's `SIZE_CONFIG` to match the pipeline `sm` (`w-7 h-7`), make `name` optional with fallback to empty initial, then re-export from `sub_canvas/index.ts` so existing pipeline import paths still resolve. Delete the local component; verify the four call sites still pass color/icon correctly.

## 9. `debuggerMocks.ts` mock generators are scaffolding kept past the dry-run cutover
- **Severity**: low
- **Category**: cruft
- **File**: `src/features/pipeline/sub_canvas/libs/debuggerMocks.ts:1-60` (60 LOC); consumer `src/features/pipeline/sub_canvas/libs/useDebugger.ts:5,87`
- **Scenario**: `generateMockInput`/`generateMockOutput` synthesize fake `task: 'Coordinate pipeline execution'`, `confidence: 0.92`, etc. for the in-canvas dry-run debugger. The backend has a real `dry_run_trigger` command (`src/api/pipeline/triggers.ts:219`) that returns `DryRunResult` with actual simulated event data — but `useDebugger` uses the mocks instead of calling the real backend.
- **Root cause**: Mocks landed first when the dry-run was UI-only; never replaced with real backend output when `dry_run_trigger` shipped.
- **Impact**: Users see plausible-but-fake "agent output" during dry-run, which is a trust-eroding pattern (looks real, isn't); 60 LOC of throwaway data tables maintained per-role.
- **Fix sketch**: Either (a) replace `generateMockOutput` with a stable placeholder string `[Dry-run preview — output not simulated]` and `generateMockInput` with `{ note: "Mock upstream payload" }`, then delete the lookup tables; or (b) wire `useDebugger` to call the real `dry_run_trigger` per node (requires backend support for team-node dry-runs, not just trigger dry-runs — bigger lift). Pick (a) unless backend work is already planned.

## 10. `cancel_pipeline` and `reject_pipeline_node` are near-identical
- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/teams/teams.rs:333-338` (`cancel_pipeline`); `:363-372` (`reject_pipeline_node`)
- **Scenario**: Both call `state.process_registry.cancel_run("pipeline", &run_id)` and return `Ok(true)`. Only difference is the `tracing::info!` message. Two separate Tauri commands + two frontend bindings (`cancelPipeline`, `rejectPipelineNode` in `src/api/pipeline/teams.ts:115,121`) for what is one operation with two reasons.
- **Root cause**: The approval/rejection UX was modeled symmetrically with `approve_pipeline_node`, but rejection semantically equals cancellation in this codepath.
- **Impact**: Minor — two Tauri commands and bindings instead of one. Defensible as a "different audit trail per reason" stability boundary, so this is borderline-intentional.
- **Fix sketch**: Either keep both (the log messages do carry intent and the audit trail is the point), or merge into `cancel_pipeline(run_id, reason: Option<String>)` and let the frontend pass `"rejected_approval"` or `"user_cancelled"`. If keeping, add a code comment at line 363 saying "intentional twin of `cancel_pipeline` for audit-trace clarity" so a future reader doesn't dedupe it.
