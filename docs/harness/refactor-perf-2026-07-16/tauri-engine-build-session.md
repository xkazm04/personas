# tauri:engine/build_session — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Backend Engine & Runtime | Files read: 12 | Missing: 0

## 1. KNOWN_FALLBACK connector list duplicated verbatim in two gate-seed entry points
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/build_session/gates.rs:660 (and gates.rs:796)
- **Scenario**: `intent_implies_connectors` and `gate_seed_for_intent_with_context` each carry their own ~48-entry fallback service list ("gmail" … "gemini"). Adding a new connector keyword to one list and forgetting the other makes the connectors gate auto-open in one code path (runner uses `_with_context`) and stay Closed in another (test/legacy `gate_seed_for_intent`), producing divergent question behavior that is very hard to trace back.
- **Root cause**: The 2026-05-05 ambiguity-aware variant copy-pasted the fallback array instead of hoisting it to a shared `const`.
- **Impact**: Silent drift hazard on a list that the file's own doc comment says must be "kept synced with the connector_definitions catalog" — two places to sync instead of one.
- **Fix sketch**: Hoist a single module-level `const KNOWN_FALLBACK_SERVICES: &[&str]` and reference it from both `intent_implies_connectors` and `gate_seed_for_intent_with_context`. The combining logic (registry ∪ fallback) can also become one small helper `combined_registry_keywords(registry: &[String]) -> Vec<String>` used by both.

## 2. CLI single-turn read loop duplicated four times in fanout.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/build_session/fanout.rs:149
- **Scenario**: `resolve_one_capability` (149-168), `run_cli_turn` (299-319), `resolve_persona_wide` (432-454), and `resolve_clarify` (663-684) each contain the same block: `take_stdout_reader()` → `loop { read_line_limited … extract_result_usage → usage.add(…) … per-line handler }` → `finish()/wait()`. Any fix to the loop (e.g. a read-timeout, a byte cap, error logging) must be applied in four places; today `run_cli_turn` calls `driver.wait()` while the other three call `driver.finish()` — an inconsistency that already exists.
- **Root cause**: Each sub-agent flavor was added incrementally and re-inlined the drain loop instead of extracting the shared shape.
- **Impact**: Four-way maintenance burden on the module that owns the multi-agent fan-out; drift already visible (wait vs finish). ~80 duplicated lines.
- **Fix sketch**: Extract `async fn drain_turn(driver: &mut CliProcessDriver, mut on_line: impl FnMut(&str)) -> TurnUsage` that owns the read loop and usage accumulation; each caller passes a closure that does its per-line extraction (`parse_build_line`, `extract_persona_wide`, `extract_clarify_questions`). Behavior-preserving; keep the existing wait/finish choice as a parameter or standardize on `finish()`.

## 3. Dead `parse_agent_ir` helper in parser.rs
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/build_session/parser.rs:781
- **Scenario**: `parse_agent_ir` is a private, `#[allow(dead_code)]`-suppressed function with no callers anywhere in the module and no tests. Agent-IR extraction now happens via the `agent_ir` branch of `parse_json_object` (parser.rs:367) and, for the fix-pass, via `fix_pass::extract_agent_ir_json`.
- **Root cause**: Superseded by the event-based parse path; the `allow` attribute silenced the compiler instead of the function being removed.
- **Impact**: 22 lines of misleading surface — a reader hunting for "how agent_ir is extracted" can land on the wrong (unused, weaker) implementation. (Contrast: `intent_is_simple_periodic_report` in gates.rs is also `allow(dead_code)` but is deliberately kept, documented, and still exercised by tests — do not remove that one.)
- **Fix sketch**: Delete `parse_agent_ir` and its `#[allow(dead_code)]`. `cargo check` confirms no callers.

## 4. connectors::get_all() re-queried inside the required_connectors loop
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/build_session/tool_tests.rs:132
- **Scenario**: In `run_tool_tests`, the connector-driven credential-injection pass iterates `agent_ir.required_connectors` and calls `crate::db::repos::resources::connectors::get_all(pool)` on every iteration — a full-table SQLite read (plus a pool checkout) per connector, even though the catalog cannot change mid-call.
- **Root cause**: The 2026-05-04 injection pass fetched the catalog where it was needed (inside the per-connector body) instead of hoisting the invariant query above the loop.
- **Impact**: N identical full-table queries per test pass; the test pass runs on every build and up to 3 more times in the one-shot fix-retry loop. Bounded (a persona has a handful of connectors) but pure waste, and it holds pool connections on a path that also runs OAuth refreshes.
- **Fix sketch**: Fetch `let connectors = connector_repo::get_all(pool).unwrap_or_default();` once before the `for ir_conn in &agent_ir.required_connectors` loop and do `connectors.iter().find(...)` inside. One-line move, no behavior change.

## 5. Test-plan curl commands execute serially while the scripted path is already parallel
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: serial-io
- **File**: src-tauri/src/engine/build_session/tool_tests.rs:474
- **Scenario**: Step 4 of `run_tool_tests` awaits `execute_test_curl` one entry at a time inside a `for` loop. Each entry is a real network round-trip (external API healthcheck, seconds each, 10s-class worst case); a persona with 4-5 connectors pays the sum. The env-gated scripted path in the same file (`run_scripted_connector_tests`, line 686) already dispatches the equivalent work through `run_lanes(3, …)` in parallel.
- **Root cause**: The LLM-plan execution loop predates the Phase 2 lane scheduler and was never migrated when `run_lanes` landed.
- **Impact**: Wall-clock stacking on the default (non-env-gated) test pass — the pass the one-shot orchestrator re-runs up to 3 times, so a slow connector multiplies. The per-tool progress events (`BUILD_TEST_TOOL_RESULT`) still work with parallel execution since they carry `tested`/`total`.
- **Fix sketch**: Build a `Vec<LaneTask<…>>` from `test_plan` (curl entries only; cli_native/builtin auto-passes stay synchronous), run through `run_lanes(3, tasks)`, then fold outcomes into `results`/counters in input order — mirroring `run_scripted_connector_tests`. Emit the per-tool event as each lane result is folded.

## 6. Early behavior_core delta buffer grows unbounded and is re-scanned per delta line
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: quadratic-scan
- **File**: src-tauri/src/engine/build_session/runner.rs:674
- **Scenario**: With `--include-partial-messages`, every `content_block_delta` line appends to `early_delta_buf` and then calls `extract_early_behavior_core`, which does `find("\"behavior_core\"")` plus a string-aware brace walk over the whole buffer. On turns where behavior_core never streams — i.e. every turn after turn 0, because `early_core_emitted` is reset to `false` at the top of each turn (runner.rs:646) even though the core was already resolved — the buffer keeps growing for the full 50-155s turn and the entire accumulated text is re-scanned on every delta: O(n²) over the turn's output.
- **Root cause**: The B2 early-emit optimization scopes its "done" flag per turn instead of per session, and the scan restarts from offset 0 each call instead of remembering how far it has searched.
- **Impact**: Tens of MB of redundant scanning per follow-up turn on the hot streaming read loop (the same loop that must keep the pipe drained), plus retained memory equal to each turn's full delta text. Bounded per turn, but pure waste on 11 of 12 possible turns.
- **Fix sketch**: Hoist `early_core_emitted` above the turn loop (or set it when `resolved_cells` already contains `behavior_core`), so follow-up turns skip the accumulation entirely. Additionally, short-circuit `extract_early_behavior_core` with a cheap incremental check (only rescan when the buffer newly contains `behavior_core`, tracking the last searched offset) and cap `early_delta_buf` (e.g. 256 KB) as a safety bound.
