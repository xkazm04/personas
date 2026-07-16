# api/agents — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Core Libraries & State | Files read: 18 | Missing: 0

## 1. Eleven exported IPC wrappers have zero consumers anywhere in src/
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/api/agents/automations.ts:62
- **Scenario**: Repo-wide grep (all of `src/`, including `import * as api` aliased call sites) finds only the definitions for: `n8nListWorkflows`, `n8nActivateWorkflow`, `n8nDeactivateWorkflow`, `n8nCreateWorkflow`, `n8nTriggerWebhook`, `zapierCreateZap` (automations.ts:62-83), `searchExecutions` (executions.ts:44), `getDreamReplay` (executions.ts:123), `getMcpPoolMetrics` (mcpTools.ts:34), `getOutputAssertion` (outputAssertions.ts:14), `getTestSuite` (testSuites.ts:8). Anyone maintaining these files keeps them in sync with the Rust commands for nothing.
- **Root cause**: Wrappers were added speculatively alongside Rust commands (n8n/Zapier platform suite, dream-replay, MCP pool metrics) but the UI either never consumed them or migrated to other paths (e.g. `zapierTriggerWebhook` is used via `automationSlice`; its n8n twin is not).
- **Impact**: ~60 lines of dead API surface plus their imported binding types; misleads readers into thinking these flows are frontend-reachable; every rename/refactor of the Rust side drags dead code along.
- **Fix sketch**: Delete the eleven wrappers and any binding-type imports that become unused (`N8nWorkflow`, `N8nActivateResult`, re-exports at automations.ts:15-18, `DreamReplaySession`, `ExecutionSearchResult`, `StdioPoolMetrics`). Verification needed only for the Rust commands themselves (other frontends/tests) — the TS wrappers are statically imported everywhere in this codebase, so grep coverage is conclusive. Keep the Rust commands; this is frontend-only cleanup.

## 2. Hand-rolled interfaces duplicate Rust structs the bindings generator already covers — the drift pattern that already bit ExecutionPreview
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/api/agents/useCases.ts:10
- **Scenario**: `UseCaseToggleResult` (useCases.ts:10, doc says "Mirrors `UseCaseToggleResult` in use_cases.rs"), `UseCaseGenerationSettings` (useCases.ts:84), `EventListenerCounts`, `RenameEventListenersResult`, plus `SimulatedExecution`/`SimulationArtefacts` (buildSession.ts:171/186) and `ActiveLabProgress` (lab.ts:198) are hand-typed mirrors of Rust structs. A Rust-side field change (rename, type widening, new required field) compiles cleanly and silently mismatches at runtime.
- **Root cause**: The corresponding Rust types lack `#[derive(TS)]`/ts-rs export, so authors typed them by hand instead of importing from `@/lib/bindings/*` like the other ~40 types in this context.
- **Impact**: executions.ts:137-141 documents exactly this failure mode already happening once (hand-rolled `ExecutionPreview` drifted: token counts typed `number` where Rust `u64` generates `bigint`). Six more mirrors carry the same latent hazard, and two (`SimulatedExecution`, `SimulationArtefacts.reviews`) paper over it with `[key: string]: unknown` escape hatches.
- **Fix sketch**: Add ts-rs derives to `UseCaseToggleResult`, `UseCaseGenerationSettings`, `EventListenerCounts`, `RenameEventListenersResult` in use_cases.rs and to the simulation artefact structs in build_simulate.rs; regenerate bindings; replace the hand-rolled interfaces with `export type { X } from "@/lib/bindings/X"` re-exports (the pattern executions.ts:141 already uses).

## 3. Lab/evolution/genome read commands bypass the read-only auto-dedup, so mount races hit SQLite twice
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: missing-dedup
- **File**: src/api/agents/lab.ts:42
- **Scenario**: `invokeWithTimeout` folds duplicate concurrent read IPC calls into one Rust round-trip, but only for commands starting with `list_`/`get_`/`fetch_` (tauriInvoke.ts:157). The whole Lab surface (`lab_list_arena_runs`, `lab_get_arena_results`, `lab_get_versions`, `lab_get_version_ratings`, `lab_get_active_progress`, ...), evolution (`evolution_get_policy`, `evolution_list_cycles`), genome (`genome_list_breeding_runs`, `genome_get_breeding_results`), and `count_executions`/`search_executions` all use domain-prefixed names, so React StrictMode double-mounts and parallel panel mounts each fire a real IPC + SQLite query.
- **Root cause**: `isReadOnlyCommand` is prefix-based and the dedup infrastructure was added after these command names were established; nobody extended the prefix list to the `lab_`/`evolution_`/`genome_` namespaces.
- **Impact**: The Lab tab hydrates several of these on mount (runs list + versions + ratings + economics + active progress); in dev/StrictMode every one doubles, and in prod any two components sharing a query still pay 2× IPC serialization + query cost. Bounded but systematic waste on a frequently opened surface.
- **Fix sketch**: In tauriInvoke.ts, extend `READ_ONLY_PREFIXES` with `"lab_list_"`, `"lab_get_"`, `"evolution_list_"`, `"evolution_get_"`, `"genome_list_"`, `"genome_get_"`, `"count_"` (all verifiably read-only on the Rust side). Alternatively add an explicit read-only allowlist set next to `BLOCKING_MUTATION_TIMEOUTS` for non-conforming names like `search_executions`.

## 4. Hot activity surfaces fetch 50 full PersonaExecution rows where the lean summary projection exists
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/api/agents/executions.ts:21
- **Scenario**: `ActivityTab.tsx:47` and `useQuickStats.ts:32` call `listExecutions(personaId, 50)`, which returns full `PersonaExecution` rows — including `input_data`, `output_data`, `tool_steps`, `execution_config` (frozen JSON snapshot), and `director_review_md` (rendered markdown) blobs — even though `listExecutionsSummary` (executions.ts:27) exists precisely as the lean `ExecutionListItem` projection for list views.
- **Root cause**: The summary endpoint was added later; existing callers were never migrated, and the fat wrapper gives no hint it serializes multi-KB blobs per row.
- **Impact**: Every open of the editor's Activity tab / quick-stats panel deserializes up to 50× (input+output+config+review) payloads across the IPC boundary just to render status/duration/cost chips — easily hundreds of KB of JSON per view for chatty personas, on one of the most-visited editor tabs.
- **Fix sketch**: Migrate `ActivityTab` and `useQuickStats` to `listExecutionsSummary` (both only consume list-level fields; verify `ExecutionListItem` carries status/cost/duration/created_at — it does by design). Then audit remaining `listExecutions` callers and add a doc comment on executions.ts:21 warning that it returns full blobs.

## 5. Pervasive redundant `key: key` self-assignments in invoke arg objects
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/api/agents/executions.ts:24
- **Scenario**: Dozens of call sites write `limit: limit`, `useCaseFilter: useCaseFilter`, `status: status`, `inputData: inputData`, etc. (executions.ts, lab.ts, automations.ts, tests.ts, testSuites.ts, chat.ts) instead of ES shorthand.
- **Root cause**: Copy-paste of an older style, possibly a leftover from when args were renamed between TS camelCase and wire names — but these keys are identical to the variable names.
- **Impact**: Pure noise; slightly higher diff churn and reader friction. No runtime cost.
- **Fix sketch**: Mechanical sweep replacing `x: x` with `x` across the directory (safe, semantics-identical; `undefined` coercion is handled inside `invokeWithTimeout` either way).

## 6. Stray mid-file import breaks the import-block convention in automations.ts and personas.ts
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src/api/agents/automations.ts:40
- **Scenario**: `import type { BlastRadiusItem } from "@/api/agents/personas"` sits at line 40 between function definitions; personas.ts similarly imports `ImportResult`/`GalleryPublishResult`/`PresetPublishResult`/`ReferralStats` at lines 125-129 and `ToolInvocationResult` at tools.ts:78, mid-file.
- **Root cause**: Imports were appended next to the feature block they served instead of hoisted to the header when the features landed.
- **Impact**: Cosmetic/consistency only (ES imports hoist), but it defeats at-a-glance dependency review and invites duplicate imports.
- **Fix sketch**: Hoist the three mid-file import groups to the top of their files; keep the adjacent `export type` re-exports with them.
