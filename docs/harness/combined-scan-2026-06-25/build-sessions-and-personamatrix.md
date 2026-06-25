# Build Sessions & PersonaMatrix — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: build-sessions-and-personamatrix | Group: Templates & Recipes
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. WorkflowCompiler persists the *unvalidated* blueprint — validation runs on a throwaway clone (panic + dead drop-invalid recovery)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dead code / out-of-bounds panic / success theater
- **File**: src-tauri/src/engine/workflow_compiler.rs:177-180, 280-282, 334-335
- **Scenario**: The LLM topology step emits a `connections[]` entry whose `source_index`/`target_index` is `>= members.len()` (or a self-loop `source == target`). `persist_blueprint` clones the blueprint into `blueprint_clone`, calls `WorkflowCompiler.validate(&mut blueprint_clone)` (which `retain`s away the bad edges and logs warnings), then **discards the clone** and iterates the ORIGINAL `&blueprint.connections` at line 280, indexing `member_ids[bc.source_index]` (line 281). An out-of-bounds index panics the command thread; a self-loop is silently written to `persona_team_connections`.
- **Root cause**: The validated value (`blueprint_clone`) is never used for persistence — the loop reads `blueprint`, not the cleaned clone. The comment at line 274-275 ("Indices are already validated so indexing is safe") is false for the data actually iterated. Consequently the `warnings`/`dropped_connections` fields are hardcoded to `Vec::new()` / `0` (lines 334-335) regardless of what was dropped, so the entire graceful-degradation path the `validate()` doc describes is dead.
- **Impact**: Either a hard panic/crash on team compose, or a structurally broken team (self-loop edge persisted) reported back to the user as `dropped_connections: 0` with no warnings — the caller believes a clean topology compiled. The recovery feature is fully defeated.
- **Fix sketch**: Iterate the validated value: `for bc in &blueprint_clone.connections`, and build `member_ids` from `blueprint_clone.members`. Populate `warnings`/`dropped_connections` from the `before - after` delta computed in `validate` (return it, or recompute). Keep the `member_count == 0` early-return.
- **Value**: impact=7 effort=1

## 2. simulate_build_draft's RAII `DesignContextRestore` clobbers a concurrent promote's design_context
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: cross-command race / broken-persona-shipped
- **File**: src-tauri/src/commands/design/build_simulate.rs:211-221, 257-261, 370-379
- **Scenario**: User starts a dry-run on a `draft_ready` session. `simulate_build_draft` captures `prior_design_context` (often `None` for a never-promoted draft, line 221), writes a stripped snapshot onto `personas.design_context` (line 257), and begins `execute_persona_inner` — which spawns the real agent CLI and can run for many seconds. During that window the user (or the companion/headless path) clicks Promote: `promote_build_draft_inner` validates `draft_ready -> Promoted`, runs its transaction, and commits the REAL design_context. When the simulation finishes, `DesignContextRestore::drop` (line 371) unconditionally writes `prior` back, overwriting the freshly-promoted design_context with the stale/`None` value.
- **Root cause**: `sim_lock_for` (line 211, doc 340-345) serializes simulations against each other for the same persona, but promote takes no such lock and never reads/respects the snapshot. Simulation mutates a shared, persistent column (`personas.design_context`) and restores it blindly, with no guard that the value hasn't changed underneath it. The phase machine is deliberately not advanced by simulate, so nothing blocks a concurrent promote.
- **Impact**: A just-promoted, "ready" persona silently loses its design_context (use cases, triggers→UC links, channels, policies) — the matrix renders empty and the runtime can't resolve capabilities. A broken persona is shipped with no error surfaced.
- **Fix sketch**: Make the restore conditional — only write `prior` back if the current `design_context` still equals the snapshot this command wrote (compare-and-restore). Better: have promote acquire the same `sim_lock_for(persona_id)` so simulate and promote are mutually exclusive per persona.
- **Value**: impact=8 effort=3

## 3. Test-lifecycle store actions always target the *active* session, not the tested one — results misattributed across drafts
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: concurrent-build state clobber
- **File**: src/stores/slices/agents/matrixBuildSlice.ts:996-1069 (handleStartTest:996, handleTestComplete:1007, handleTestFailed:1021, appendTestOutput:1043, setToolTestResults:1053)
- **Scenario**: Multi-draft is a first-class feature (header docblock; build events route via `event.session_id`). The test-lifecycle actions, however, all call `updateSessionInState(state, null, …)` — `null` resolves to `activeBuildSessionId`. User starts a test on draft A, then switches the active draft to B (`setActiveBuildSession`) while the test is still running. When the awaited `test_build_draft` promise resolves and dispatches `handleTestComplete(passed, …)`, it writes `testPassed`/`phase: "test_complete"` onto draft **B**, which was never tested.
- **Root cause**: Unlike the `handleBuild*` event handlers, the test actions carry no session id and implicitly bind to whatever is active at resolution time, silently violating the per-session routing contract the rest of the slice upholds.
- **Impact**: Draft B shows a green "test passed" it never earned (and draft A loses its result); the user can promote an untested draft believing it was verified — success theater. Also strands draft A in `testing`.
- **Fix sketch**: Thread the originating `sessionId` (captured when the test was launched) through `handleStartTest`/`handleTestComplete`/`handleTestFailed`/`appendTestOutput`/`setToolTestResults` and pass it to `updateSessionInState`, exactly as the event handlers pass `event.session_id`.
- **Value**: impact=6 effort=3

## 4. Empty / contradictory intent is never rejected — the build fabricates a persona from no requirements
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: missing input validation / uncovered edge case
- **File**: src-tauri/src/commands/design/build_sessions.rs:112-146 (start_build_session) → src-tauri/src/engine/build_session/mod.rs:136-184
- **Scenario**: `start_build_session(persona_id, intent, …)` accepts `intent` with no emptiness/whitespace check, creates the DB row, and spawns the CLI with `build_session_prompt(&intent, …)`. An empty or whitespace-only intent (or a degenerate "do nothing"/contradictory one) produces a prompt with a blank "User Intent" section; the LLM hallucinates an arbitrary persona or burns a turn on a clarifying question, and a session is persisted either way.
- **Root cause**: No trust-boundary guard on `intent` at the command, in `start_session`, or in the prompt assembler — contrast with `create_adoption_session`/`save_adoption_answers`, which validate their JSON payloads up front. The pipeline assumes intent is meaningful but never enforces it; the "empty intent" semantics are undocumented.
- **Impact**: Wasted CLI spend and a confusing fabricated draft for an obvious no-op input; the user gets a persona unrelated to anything they asked for, with no immediate, retryable error.
- **Fix sketch**: Reject `intent.trim().is_empty()` (and enforce a small minimum length) at the top of `start_build_session`/`start_build_session_headless` with an `AppError::Validation`, before creating the row or spawning the task.
- **Value**: impact=5 effort=2

## 5. Intent-compiler cost guidance is mislabeled by 1000× ("per 1K tokens" vs per-million) — corrupts model recommendation + cost estimate
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: magic numbers / wrong tribal knowledge in an LLM-facing prompt
- **File**: src-tauri/src/engine/intent_compiler.rs:215-218 (and the `estimated_cost_per_run_usd` field at :183)
- **Scenario**: `INTENT_EXTENSION_SCHEMA` instructs the model to choose the cheapest model and emit `estimated_cost_per_run_usd`, anchoring it with "haiku (~$0.25/1K tokens)", "sonnet (~$3/1K tokens)", "opus (~$15/1K tokens)". Those magnitudes are real Anthropic *per-million-token* figures (≈ Haiku $0.25–$0.80/M in, Sonnet $3/M in / $15/M out, Opus $15/M in / $75/M out) but the prompt labels them "per 1K tokens" — a 1000× unit error. The LLM either propagates the wrong unit into `estimated_cost_per_run_usd` or anchors its model pick on a distorted haiku:sonnet ratio (0.25:3 understates Haiku's true relative cost).
- **Root cause**: Per-million pricing copied into the prompt with a "/1K tokens" label; never reconciled against actual Anthropic pricing tiers. The numbers are also stale relative to current tiers (e.g. Haiku 3.5 input is ~$0.80/M, output ~$4/M).
- **Impact**: Cost estimates shown to users (and any downstream budgeting on `estimated_cost_per_run_usd`) are wrong by orders of magnitude; model recommendations are skewed. Low blast radius but high frequency (every intent compile).
- **Fix sketch**: Correct the unit to "per 1M tokens", split input vs output rates, and refresh to current Anthropic pricing; or drop absolute numbers and give only the relative ordering plus a worked `estimated_cost_per_run_usd` example so the model can't misapply the unit.
- **Value**: impact=4 effort=1
