> Context: tauri:engine/build_session
> Total: 9
> Critical: 0  High: 1  Medium: 5  Low: 3

## 1. Fan-out sub-agent lanes have no timeout and no mid-fan-out cancellation — a hung CLI stalls the whole multi-agent build forever
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: reliability / silent-hang
- **File**: src-tauri/src/engine/build_session/fanout.rs:108-183, 407-440, 727-767
- **Scenario**: In `run_multiagent_oneshot`, `tokio::join!(fan_out_resolution(...), resolve_persona_wide(...))` awaits every lane to completion. Each lane (`resolve_one_capability` / `resolve_persona_wide`) spawns a `CliProcessDriver`, writes the prompt, then loops on `read_line_limited(&mut reader)` until EOF. If one sub-agent CLI hangs (network stall, suspended child, prompt overflow — the exact failure the sibling `fix_pass.rs` guards against), the reader never returns `Ok(None)`, the lane never completes, `tokio::join!` never resolves, and the build sits in `Resolving` indefinitely. The `cancel_flag` is only checked at phase boundaries (lines 700-702, 765-767) — never inside a lane — so even a user-requested cancel cannot break out.
- **Root cause**: `fix_pass::invoke_claude_print` wraps its child in `tokio::time::timeout(FIX_PASS_CLI_TIMEOUT=300s, child.wait())` plus a kill path; the fan-out lanes were written without importing that discipline. `run_lanes` isolates panics but has no per-lane timeout.
- **Impact**: A single wedged CLI child hangs an entire autonomous build with no recovery and no terminal notification — the session never reaches `Failed`, so BuildWatcher can't finalize it either.
- **Fix sketch**: Wrap each lane's read loop in `tokio::time::timeout` (mirror the 300s bound in fix_pass), and on elapse `driver.kill().await` and return a `CapabilityResolution { error: Some("lane timed out") }`. Additionally poll `cancel_flag` inside the read loop (as `runner::run_session` does via `tokio::select!`) so cancellation is observed mid-lane.

## 2. Multi-agent fan-out drops the per-capability model recommendation (Rule 28) that the sequential path produces
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: correctness / feature-parity
- **File**: src-tauri/src/engine/build_session/fanout.rs:86-92 (field list in `build_capability_prompt`); contrast session_prompt.rs:651-681 (Rule 28)
- **Scenario**: The sequential build prompt mandates every capability emit `model_override` + `model_rationale` (Rule 28) so the runtime tiers Haiku/Sonnet/Opus per capability. The fan-out sub-agent prompt enumerates the fields to resolve as "suggested_trigger, connectors, tool_hints, event_subscriptions, input_schema, sample_input, review_policy, memory_policy, notification_channels, error_handling" — `model_override`/`model_rationale` are absent. `assemble_agent_ir` only routes fields the events actually carry, so a `multiagent`-built persona ships with no model override on any use-case and silently defaults every capability to the runtime's fallback model.
- **Root cause**: `build_capability_prompt`'s field list was authored before Rule 28 landed and never re-synced; the module's own doc admits "prompt grounding … need live iteration."
- **Impact**: Multi-agent personas lose deliberate cost/latency tiering (e.g. a digest capability that should run Haiku instead runs the default) — a real behavioral divergence between the two orchestration modes for the same intent.
- **Fix sketch**: Add `model_override` + `model_rationale` to the sub-agent field list and the Rule-28 tier guidance to `build_capability_prompt`, and ensure `assemble_agent_ir` passes them through (the `_ =>` arm already would).

## 3. `resolved_count >= 8` on a legacy-dimension-keyed map can trip DraftReady before every capability is resolved
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / state-machine
- **File**: src-tauri/src/engine/build_session/runner.rs:1244-1247, 1320-1321, 1520-1543
- **Scenario**: `resolved_cells` is a `Map` keyed by the ~9 legacy dimension keys (`triggers`, `connectors`, `messages`, `human-review`, `memory`, `events`, `error-handling`, `use-cases`, `behavior_core`) that `map_capability_field_to_legacy_dimension` collapses ALL capabilities onto. So a persona with 3 capabilities, of which only capability A is fully resolved, can already have `resolved_cells.len() >= 8` and trip the `resolved_count >= 8` DraftReady branch even though capabilities B and C have zero resolutions. The capability-gate guard (`any_closed`) partially catches this — but only for the 5 gated fields, and it is explicitly bypassed in `one_shot` mode (line 1543/1568), and a capability whose gates were intent-auto-opened but whose fields were never emitted slips straight through.
- **Root cause**: The v3 capability framework produces per-capability resolutions, but the completion heuristic is still the pre-v3 "8 of 9 flat dimensions" count from the legacy matrix; there is no per-capability completeness check tied to the enumeration.
- **Impact**: A multi-capability draft can enter DraftReady / auto-test with capabilities silently unresolved, producing an agent_ir missing use-cases the user asked for.
- **Fix sketch**: Gate DraftReady on enumeration coverage (every enumerated `capability_id` has its required fields resolved or explicitly skipped) rather than a flat legacy-dimension count; keep the `>= 8` count only as a legacy fallback when no enumeration was emitted.

## 4. `cleanup_session` unregisters the process-registry entry without the generation guard that protects the map removal
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/engine/build_session/events.rs:329-345
- **Scenario**: The `sessions_map.remove` is guarded by `handle.generation == generation` so a stale old-generation task won't evict a newer handle for the same `session_id`. But `registry.unregister_run("build_session", session_id)` immediately below runs unconditionally. If a session was restarted (new generation registered a fresh run/PID) while the previous generation's task is still unwinding, the old task's `cleanup_session` call unregisters the NEW generation's active run from `ActiveProcessRegistry`.
- **Root cause**: The generation-versioning was applied to the in-memory handle map but not carried through to the sibling registry unregister on the same code path.
- **Impact**: The live build's process registration is dropped by a defunct predecessor — cancellation/kill for the running build can then no-op (registry has no PID), and process bookkeeping desyncs.
- **Fix sketch**: Move `registry.unregister_run(...)` inside the `if should_remove` block so it only fires when this task actually owns the current generation.

## 5. Duplicated ~50-entry `KNOWN_FALLBACK` connector list (drift risk)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/build_session/gates.rs:660-720 (`intent_implies_connectors`) and 796-847 (`gate_seed_for_intent_with_context`)
- **Scenario**: The same ~50-service fallback keyword array (gmail…gemini) is written out verbatim in two functions. I confirmed both are live (the first feeds the registry-empty path, the second feeds cold-start callers). The lists are already at risk of silent divergence — a service added to one but not the other changes gate behavior depending on which entry point runs.
- **Root cause**: Copy-paste when the ambiguity-aware seed variant was added (2026-05-05) rather than extracting a shared `const`.
- **Impact**: Maintainability — a connector added to the catalog must be remembered in two places or the connectors gate misbehaves inconsistently across call paths.
- **Fix sketch**: Hoist a single `const KNOWN_FALLBACK_SERVICES: &[&str]` at module scope and reference it from both functions.

## 6. `intent_is_simple_periodic_report` is dead code kept alive only for its tests, and triplicates SCHEDULE_KW
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code / duplication
- **File**: src-tauri/src/engine/build_session/gates.rs:406-538 (fn), plus SCHEDULE_KW copies at 184-232, 411-459
- **Scenario**: The function is `#[allow(dead_code)]` and its own doc says it is "no longer wired into the gate heuristics." It survives solely so the `simple_periodic_report_*` tests still compile (they now only assert that `intent_implies_review`/`memory` return `Closed`). Its `SCHEDULE_KW` array is a third verbatim copy of the schedule keywords already in `intent_implies_trigger`.
- **Root cause**: 2026-05-04 unwiring removed the caller but not the function or its ~130 lines of keyword tables; the tests were repurposed instead of deleted.
- **Impact**: Maintainability — ~130 lines of unreachable logic plus a triplicated keyword table that a reader must reconcile with the two live copies.
- **Fix sketch**: Either delete the function and rewrite the two tests to assert `intent_implies_review/memory` directly (no dependence on the dead detector), or wire it back into the heuristics if the fast-path is wanted; extract the shared `SCHEDULE_KW` const either way.

## 7. Dead `parse_agent_ir` in parser.rs, fully superseded
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/build_session/parser.rs:779-801
- **Scenario**: `parse_agent_ir` is `#[allow(dead_code)]` and has no callers — agent_ir extraction now lives in `fix_pass::extract_agent_ir_json` and `fanout::extract_persona_wide`/`assemble_agent_ir`. Grep confirms no in-module or cross-module use.
- **Root cause**: Leftover from the pre-v3 line-scan approach.
- **Impact**: Maintainability — misleading second "how we find agent_ir" implementation.
- **Fix sketch**: Delete the function.

## 8. Stale "NOT yet wired" status + module-wide `#![allow(dead_code)]` on fanout.rs now masks future dead code
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code / doc-drift
- **File**: src-tauri/src/engine/build_session/fanout.rs:13-27
- **Scenario**: The module header says "STATUS — first draft, NOT yet wired, NOT runtime-verified" and lists remaining wiring steps, but `runner.rs:471-487` now calls `super::fanout::run_multiagent_oneshot` behind `multiagent && one_shot`. The blanket `#![allow(dead_code)]` was appropriate when nothing was wired; now that the module is live, it suppresses dead-code warnings for any helper that later falls out of use.
- **Root cause**: The status banner and lint suppression weren't revisited when Phase 3 was wired.
- **Impact**: Maintainability — a reader is told the module is inert when it drives real autonomous builds; genuine future dead code goes unflagged.
- **Fix sketch**: Update the status block to "wired for `multiagent && one_shot`", and drop the module-wide allow in favor of per-item `#[allow(dead_code)]` on anything still genuinely unused.

## 9. Dead `gate_seed_for_intent_with_registry` variant
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/build_session/gates.rs:762-775
- **Scenario**: `#[allow(dead_code)] // pending: build session still uses the static-keyword variant`. The runner uses `gate_seed_for_intent_with_context` (ambiguity-aware) everywhere; this registry-only intermediate variant has no live caller.
- **Root cause**: Superseded by the `_with_context` variant but left in place "pending" a migration that already happened.
- **Impact**: Maintainability — three near-identical `gate_seed_for_intent*` functions where two suffice.
- **Fix sketch**: Delete it (and fold any test coverage into the `_with_context` path), or document why the intermediate is retained.
