# Code-refactor scan — Build Sessions & PersonaMatrix

> Total: 11 findings (2 high, 6 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12
> Path drift: every listed path drifted — see "Path drift" section below

## Path drift

None of the scope paths listed in the task brief exist verbatim. Build Sessions / PersonaMatrix is implemented under a different feature root entirely (`agents/components/matrix`, not `features/builds` / `features/PersonaMatrix`). Mapping used for this scan:

| Listed path                                                  | Actual location                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `src/features/builds` / `src/features/PersonaMatrix`         | `src/features/agents/components/matrix/`                                |
| `src/api/builds/sessions.ts` / `matrix.ts` / `iterations.ts` | `src/api/agents/buildSession.ts` (single file)                          |
| `src/lib/builds` / `src/lib/matrix`                          | `src/lib/types/buildTypes.ts` + `src/lib/constants/dimensionMapping.ts` |
| `src/stores/slices/builds/{session,matrix,iteration}Slice`   | `src/stores/slices/agents/matrixBuildSlice.ts` (single slice)           |
| `src-tauri/src/commands/builds/{sessions,matrix,iterations}` | `src-tauri/src/commands/design/build_sessions.rs` (single file)         |
| `src-tauri/src/db/models/{build_session,matrix,iteration}`   | `src-tauri/src/db/models/build_session.rs` (no matrix/iteration model)  |
| `src-tauri/src/db/repos/builds/...`                          | `src-tauri/src/db/repos/core/build_sessions.rs`                         |
| `src-tauri/src/commands/builds/...`                          | `src-tauri/src/commands/design/build_sessions.rs`                       |

There is no "PersonaMatrix" feature as a stand-alone surface today — the matrix visualization is the persona build composer (`UnifiedBuildEntry.tsx` + Glyph layouts). There is no `iteration` concept and no separate "matrix" iteration store; everything funnels through one `BuildSessionState` per-session record.

## 1. `savedBuildSnapshot` slice state is fully orphaned

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:186-187, 549, 553`
- **Scenario**: The `MatrixBuildSlice` declares `savedBuildSnapshot: BuildSessionState | null` and a `setSavedBuildSnapshot(snap)` action with a TSDoc explaining a "read-only snapshot for MatrixTab viewing promoted agents", but `setSavedBuildSnapshot` is never invoked anywhere in `src/`, and `savedBuildSnapshot` is never read by any selector / component. Confirmed via repo-wide grep — only the four definition sites in this file.
- **Root cause**: The MatrixTab read-only viewer was retired during the unified-build refactor (see the v3 comments at the top of the slice), but the slice plumbing for its isolated snapshot stayed behind.
- **Impact**: ~6 LOC of state + TS-RS-typed surface area kept alive on every store update. Misleads new contributors into thinking there's a separate snapshot pathway to consider.
- **Fix sketch**: Delete the 4 lines and the comment block. Also remove `BuildSessionState` import if it falls dead (it doesn't — still exported elsewhere).

## 2. v3 BuildEvent dispatch switch is duplicated verbatim across Channel + EventBridge

- **Severity**: high
- **Category**: duplication
- **File**: `src/hooks/build/useBuildSession.ts:211-254` AND `src/lib/eventBridge.ts:386-417`
- **Scenario**: The 10-arm switch (`cell_update | question | progress | error | session_status | behavior_core_update | capability_enumeration_update | capability_resolution_update | persona_resolution_update | clarifying_question_v3`) that dispatches each BuildEvent to its matching `store.handle*` slice action exists in two places with identical bodies. The only differences: useBuildSession.ts has a `default` arm with `logger.warn`; eventBridge.ts silently drops. Both must be edited in lockstep on every new event variant, with no compile-time link.
- **Root cause**: The EventBridge variant was added as the "background resilience" path after Channel was chosen as the winner (see SESS-03 doc block in useBuildSession.ts). The fan-out logic was copy-pasted instead of factored into a shared `dispatchBuildEvent(store, event)` helper.
- **Impact**: ~40 LOC duplicated. Adding a new v3 event (e.g. a future `tool_test_update`) requires three edits today (BuildEvent type, useBuildSession switch, eventBridge switch). One of the two is silently asymmetric: eventBridge swallows unknown variants — useBuildSession logs.
- **Fix sketch**: Extract `function dispatchBuildEventToStore(store: AgentStore, event: BuildEvent): void` into `src/lib/types/buildTypes.ts` (or a new `src/lib/buildEventDispatch.ts`). Both call sites become `dispatchBuildEventToStore(store, event)`. Keep the useBuildSession default-warn behavior in the helper.

## 3. Three overloads of `gate_seed_for_intent` — bare + `_with_registry` variants are tests-only

- **Severity**: high
- **Category**: dead-code
- **File**: `src-tauri/src/engine/build_session/gates.rs:747, 763, 787`
- **Scenario**: Three near-identical seed factories coexist:
  - `gate_seed_for_intent(intent)` — no registry, no ambiguity awareness
  - `gate_seed_for_intent_with_registry(intent, registry_keywords)` — marked `#[allow(dead_code)]` "pending: build session still uses the static-keyword variant"
  - `gate_seed_for_intent_with_context(intent, registry_keywords, ambiguous_services)` — the only production caller (runner.rs:776, 804)
  
  The bare version is only invoked from gates.rs's own `init_gates_from_enumeration` and `ensure_capability_in_coverage` — which are themselves test-only (runner uses the `_with_context` siblings: runner.rs:34-35, 589, 627, 651). Same pattern for `intent_implies_connectors` (bare) vs `intent_implies_connectors_with_registry` vs `intent_implies_connectors_with_ambiguity`.
- **Root cause**: 3-step evolution: bare → registry-aware → ambiguity-aware. Each step kept the older signatures alive so existing tests would keep compiling rather than rewriting them against the new entry point.
- **Impact**: ~120 LOC of redundant API surface in gates.rs (the three seed fns + the three connector fns + their internal callers), plus ~80 LOC of tests pinned to the obsolete signature. `gates.rs` is 2159 lines and the duplicated branches make changes risky — a fix to `intent_implies_connectors_with_ambiguity` doesn't automatically fix `_with_registry`.
- **Fix sketch**: Make `_with_context` the single entry point. Update the 7 in-file test sites to pass `&[]` for registry and an empty `HashSet` for ambiguous. Delete the bare + `_with_registry` siblings and `init_gates_from_enumeration` / `ensure_capability_in_coverage` (keep only the `_with_context` variants). Refresh the README §"gates" row accordingly.

## 4. `__BUILD_CHANNEL_ACTIVE__` legacy global is write-only

- **Severity**: low
- **Category**: dead-code
- **File**: `src/hooks/build/useBuildSession.ts:84, 91, 535` (comment)
- **Scenario**: `useBuildSession` maintains a `__BUILD_CHANNEL_ACTIVE__` boolean on `window` "kept true while ANY session is active, for any external code that still checks it". Repo-wide grep finds zero readers — only the docs/architecture page mentions it and that doc is stale (the live path is `__BUILD_CHANNEL_ACTIVE_SESSIONS__`, which eventBridge.ts:371 reads).
- **Root cause**: When the per-session `Set<string>` replaced the global boolean, the legacy flag was kept "just in case" for unknown external consumers.
- **Impact**: 6 LOC of misdirection — readers will spend time looking for where this gets consumed.
- **Fix sketch**: Drop the two `__BUILD_CHANNEL_ACTIVE__` lines and the comment. Also remove the stale `docs/architecture/persona-matrix-build.md:136` line.

## 5. `BuildPhase::Completed` enum variant is unreachable

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/db/models/build_session.rs:17, 33, 45, 58, 86`
- **Scenario**: The `BuildPhase` enum carries a `Completed` variant alongside `DraftReady`, `TestComplete`, `Promoted`, `Failed`, `Cancelled`. No code path writes `BuildPhase::Completed` anywhere in `src-tauri/` (verified by grep — zero hits). The runner's final-checkpoint sets `Failed` or `DraftReady`; oneshot sets `Promoted` or `Failed`; tests set `TestComplete`. The variant exists only for the `is_terminal()` matcher and `from_str_value` reverse parser.
- **Root cause**: Legacy phase from an earlier lifecycle design where `Completed` was a distinct terminal phase between `Promoted` and `Failed`. The v3 capability-framework refactor superseded it but left the variant.
- **Impact**: Misleads readers of the enum — it suggests a non-existent state. TS-RS exports it to TypeScript so the frontend type also carries the dead member.
- **Fix sketch**: Remove the `Completed` variant + its three match arms. If any DB row in the wild has phase=`"completed"`, add a one-line migration to coerce it to `failed` (best fit for "old, non-promoted, non-cancelled terminal").

## 6. Unused edit-state slice actions never wired to UI

- **Severity**: medium
- **Category**: dead-code
- **File**: `src/stores/slices/agents/matrixBuildSlice.ts:267-271, 1144-1167, 1169-1233`
- **Scenario**: The `MatrixBuildSlice` exposes `setEditingCell`, `updateEditState`, `markEditDirty`, `initEditStateFromDraft`, plus the entire `MatrixEditState` shape. Repo-wide grep finds:
  - `setEditingCell` / `updateEditState` / `markEditDirty` — zero production callers (slice itself + featureParity test only)
  - `initEditStateFromDraft` — invoked only by the slice and its `featureParity.test.ts` test
  - `clearEditDirty` — invoked by `ChronologyAdoptionView.tsx` (so this one is real)
  - `buildEditState` mirror — same: read by no real consumer
- **Root cause**: Inlined comment "All UI consumers (the *EditCell components) were deleted with the matrix retirement; the slice still exposes editState for any future build-flow edit surface to wire into without redefining the shape."
- **Impact**: ~100 LOC of slice state + actions + `initEditStateFromDraft`'s 65-line projection logic kept alive only for a future-tense use case. A WeakMap-cached scalar projection (lines 433, 539) carries the `buildEditState` field on every mutation.
- **Fix sketch**: Inline-decide whether the "future edit surface" is on the roadmap. If not, delete `setEditingCell` / `updateEditState` / `markEditDirty` / `initEditStateFromDraft` (and their tests). Keep `clearEditDirty` and `editDirty` flag since they have one real consumer. Trim the `MatrixEditState` shape down to the fields `clearEditDirty` actually clears.

## 7. `start_build_session_headless` orphaned — declared but never called

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/commands/design/build_sessions.rs:160-197`
- **Scenario**: `start_build_session_headless` is a full 38-line `#[tauri::command]` registered in `lib.rs:1395`, documented as "for callers that have no frontend Channel (build-mcp HTTP endpoints, e2e drivers, future external MCP clients)". Cross-repo grep shows it's only referenced from a comment in `test_automation.rs:881` ("`start_build_session_headless` substitutes a no-op") — never actually invoked from any caller. The docstring's "build-mcp HTTP endpoints" and "future external MCP clients" both still future-tense.
- **Root cause**: Speculative external-MCP feature that didn't ship.
- **Impact**: 38 LOC of command + IPC binding + the `commandNames.generated.ts` export it produces. The command requires-auth and constructs a no-op Channel — non-trivial dead surface.
- **Fix sketch**: Delete the command, the `lib.rs:1395` registration, and let the codegen drop the IPC binding. If/when build-mcp ships, re-add behind that PR.

## 8. `parse_agent_ir` walker function is dead

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/engine/build_session/parser.rs:720-740`
- **Scenario**: 20-line `parse_agent_ir(output: &str) -> Option<String>` marked `#[allow(dead_code)]` walks backwards through accumulated output looking for the last complete JSON object that "looks like an agent IR". No production caller — the live path is `parse_build_line` + `parse_json_object` (which handle agent_ir via its `cell_key`).
- **Root cause**: Pre-stream-json fallback strategy; superseded when the parser switched to per-line envelope unwrapping.
- **Impact**: Dead code with no test. The `allow(dead_code)` lint suppression hides it from cargo's warnings.
- **Fix sketch**: Delete the function. If a future reload-from-raw-stdout path is needed, it can be re-added with tests.

## 9. `PromotePreparation` / `PromoteCounters` structs annotated dead

- **Severity**: low
- **Category**: dead-code
- **File**: `src-tauri/src/commands/design/build_sessions.rs:795-813`
- **Scenario**: Two structs (`PromotePreparation` with 7 fields, `PromoteCounters` with 4 fields) carry `#[allow(dead_code)]` annotations indicating they're not constructed anywhere. Repo grep confirms zero `PromotePreparation { ... }` / `PromoteCounters { ... }` literal sites. The actual promote flow in the same file uses inline variables instead.
- **Root cause**: Vestigial struct-extraction refactor that was abandoned mid-flight (intent was likely to pass these between helper fns; ended up keeping the inlined approach).
- **Impact**: ~19 LOC of type declarations the compiler explicitly ignores. Misleads readers exploring the promote pipeline.
- **Fix sketch**: Delete both struct definitions. If the future "carve promote helpers" refactor wants them back, they're cheap to re-add.

## 10. `intent_is_simple_periodic_report` heuristic kept "just in case"

- **Severity**: low
- **Category**: cruft
- **File**: `src-tauri/src/engine/build_session/gates.rs:406-538`
- **Scenario**: 132-line `intent_is_simple_periodic_report` function marked `#[allow(dead_code)]` "no longer wired into the gate heuristics — kept around so the existing test suite around the keyword combinations still compiles. If we revive the auto-open later we can wire it back in one line." Function holds ~140 keyword tokens across three const arrays (`SCHEDULE_KW`, `INFORMATIONAL_KW`, `EXTERNAL_PUBLISH_KW`).
- **Root cause**: Heuristic was retired during the gate-suppression refactor; kept alive to avoid breaking tests that assert keyword-matching behavior.
- **Impact**: 132 LOC of dead heuristic + the test fixtures pinned to it. The compiler can't help when the keyword lists drift from current intent semantics because the function is unreachable.
- **Fix sketch**: Decide whether the "revive auto-open later" plan is live. If not, delete the function and its dependent tests. If yes, document the revival path in the runner.rs gate-init site so the next refactor knows where to call it from.

## 11. Three near-identical phase-update plumbings (oneshot vs events vs commands)

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/engine/build_session/events.rs:42-55`, `src-tauri/src/engine/build_session/oneshot.rs:527-540`, `src-tauri/src/commands/design/build_sessions.rs:391-407`
- **Scenario**: Three different functions named some variant of "update_phase" exist:
  - `events::update_phase(pool, session_id, phase)` (synchronous, runner uses it)
  - `oneshot::update_phase(state, session_id, phase)` (async, takes `Arc<AppState>` — runs the same `UpdateBuildSession { phase: Some(...), ..Default::default() }`)
  - `commands::design::build_sessions::reset_build_session_phase` (async tauri command, hardcoded to `DraftReady` but otherwise the same shape)
  
  All three open the same `build_session_repo::update` call with `UpdateBuildSession { phase: Some(...), ..Default::default() }`. Inside `build_sessions.rs` alone there are >20 inline copies of the same `UpdateBuildSession { phase: Some(X.as_str().to_string()), ..Default::default() }` literal — search for `phase: Some(BuildPhase` in that file.
- **Root cause**: Each new caller wrote its own helper rather than reaching for the existing one. The oneshot orchestrator picked async + `AppState`; the runner uses sync + `DbPool`; the command picked async + `State`.
- **Impact**: ~60 LOC of redundant wrappers + the >20 inline literals make a phase-update audit (e.g. "every phase write should also bump `updated_at`") manual rather than mechanical.
- **Fix sketch**: Standardize on `events::update_phase(pool, session_id, phase)` (sync, takes only what's needed). Have `oneshot::update_phase` delegate to it via `tokio::task::spawn_blocking` (or just call it directly — SQLite updates are quick). Inline `reset_build_session_phase` either delegates or just calls the shared helper with `DraftReady`. Then sweep the >20 inline copies in `build_sessions.rs` to call the helper. Net delete: ~40 LOC, single audit surface.
