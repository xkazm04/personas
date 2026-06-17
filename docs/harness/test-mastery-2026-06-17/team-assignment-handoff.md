# Test Mastery — Team Assignment & Handoff
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

Context covers the team-assignment orchestrator (step DAG drive loop, QA fix-loop, cascade-skip/restore, retry), the assignee matching/decompose layer, team-handoff event wiring, KPI bindings, and two read-only React surfaces (KPIDashboard, RedRoomPane). The Rust engine here is the autonomous-team execution heart: it spawns real persona executions, opens/merges PRs, and writes goal progress — yet of the 7 source files, only `kpi_binding.rs` carries any tests at all. The orchestrator (`team_assignment_orchestrator.rs`, 1565 lines), matching (`team_assignment_matching.rs`, 548 lines), and handoff (`team_handoff.rs`, 243 lines) have **zero** `#[cfg(test)]` modules, despite 124/157 engine files following the convention and a working `init_test_db()` DB-backed test helper (see `db/repos/dev_tools.rs`). The highest blast-radius gaps are in the orchestrator's pure decision helpers, which decide whether a goal counts as "done" and whether duplicate PRs get launched.

## 1. Cascade-skip / restore-skipped DAG logic is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:284-320 (`restore_cascade_skipped_dependents`), :462-484 (cascade-skip in tick_loop), :940-943 (`parse_depends_on`)
- **Current test state**: none
- **Scenario**: When a step fails, every transitive dependent is cascade-skipped (marked with the marker error_message "Dependency was skipped or failed"). On auto-resume/orphan-recovery, `restore_cascade_skipped_dependents` must put exactly the *cascade*-skipped subtree back to `pending` while never touching a *user*-skip. The fixed-point loop distinguishes the two solely by an exact-string match on `error_message`. A regression that changes that marker string, mis-parses `depends_on` JSON, or breaks the transitive-closure loop silently lets the QA/merge tail stay `skipped` — the assignment completes WITHOUT its merge gate (the exact F1 bug the code comments describe: "implement retried fine, QA never ran", PR stranded open while goal marked done).
- **Root cause**: The whole restore + cascade-skip + depends-on parsing path is DB-and-loop logic with no unit test; the marker-string coupling is invisible and brittle.
- **Impact**: A goal is reported "done" with its work never merged — silent data/work loss and a broken autonomy contract; the most expensive failure mode in the team engine.
- **Fix sketch**: DB-backed unit test using `init_test_db()`: build an assignment with steps A→B→C (C depends on B, B on A), fail A, tick once, assert B and C become `skipped` with the cascade marker; then call `restore_cascade_skipped_dependents` with root={A} and assert B+C return to `pending` AND restored count == 2. Add a sibling case: a *user*-skipped step (different/empty error_message) is NEVER restored. Pure-function test for `parse_depends_on` on malformed/empty/valid JSON (invariant: never panics, returns `[]` on garbage).

## 2. QA fix-loop "changes_requested" bounce + done-vs-failed verdict is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:983-1069 (`step_emitted_changes_requested`, `trigger_qa_rework`), :825-916 (completed-execution verdict branch), :970-977 (MAX_QA_FIX_ROUNDS)
- **Current test state**: none
- **Scenario**: A "completed" QA execution that emitted `qa.pr.changes_requested` is a BOUNCE, not a done step — the loop must re-queue the implementer + QA (capped at MAX_QA_FIX_ROUNDS=2), forward the verdict as `rework_feedback`, and only mark the step `failed` (human gate) when the cap is hit. Code comments record the prior bug: "all 13 changes_requested events produced ZERO re-works… every bounced PR stranded open while the goal was still marked done." A regression in the round-cap arithmetic (`retry_count < MAX_QA_FIX_ROUNDS`), the "no done predecessor → leave done" fallback, or the verdict-forwarding lets a goal complete on an unmerged/rejected PR.
- **Root cause**: Money-path control flow (PR merge gating) lives in `run_step`/`trigger_qa_rework` with no isolation seam and no test.
- **Impact**: Goals counted complete with rejected PRs; wasted token spend re-running uncapped; or conversely an infinite rework loop if the cap regresses. Directly hits the "work only counts on main branch" business invariant.
- **Fix sketch**: Refactor the rework decision into a thin pure helper (e.g. `fn qa_rework_decision(retry_count, emitted_changes_requested, has_done_predecessor) -> Rework|EscalateToHuman|Done`) and table-test all branches incl. boundary `retry_count == MAX_QA_FIX_ROUNDS`. Add a DB-backed test for `trigger_qa_rework`: assert done predecessors reset to `pending` carrying the `REWORK_MARKER`, QA step requeued with retry incremented, and `Err` (step left done) when no done predecessor exists.

## 3. Matching/decompose hallucination guards (LLM-id validation) untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/team_assignment_matching.rs:288-304 (`parse_llm_match_response`), :349-367 (candidate-id validation in `match_via_llm_eval`), :521-539 (decompose persona-id cleaning), :89-137 (`extract_candidates`)
- **Current test state**: none (these are pure / near-pure and explicitly marked "Public for testability")
- **Scenario**: Sonnet routinely wraps JSON in prose and sometimes hallucinates a `persona_id` that isn't on the roster. `parse_llm_match_response` must extract the first/last-brace JSON; `match_via_llm_eval` must reject an off-roster id; `decompose_goal` must null out suggestions whose persona_id isn't in the candidate set. A regression that drops the membership check assigns work to a non-existent/ineligible persona → step fails pre-flight and cascade-skips the rest. `extract_candidates` must also emit exactly one fallback candidate for a persona with zero enabled use_cases (so it stays matchable) and skip `enabled == Some(false)` use_cases.
- **Root cause**: These are the cheapest, highest-value pure functions in the context and are completely untested despite a testability comment inviting it.
- **Impact**: Mis-routed assignments, silent loss of eligible candidates, or accepting fabricated ids — wrong agent does the work or the whole assignment wedges.
- **Fix sketch**: LLM-generatable pure-function batch. For `parse_llm_match_response`: assert it parses bare JSON, JSON-with-leading/trailing-prose, and returns `Err` on no-brace input (invariant: only returns Ok when a persona_id field is present). For the id-validation invariant, construct a `MatchResponse` with an off-roster id and assert `match_via_llm_eval`'s validity check rejects it (extract the check into a pure helper to avoid spawning the CLI). For `extract_candidates`: invariant "every input persona yields ≥1 candidate; a use_case with enabled=Some(false) is excluded; capability_summary wins over description as corpus." For decompose cleaning: invariant "no emitted suggested_persona_id is outside the candidate set."

## 4. Handoff wiring: feedback-edge exclusion & condition building untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/team_handoff.rs:63-198 (`wire_team_handoff`), :203-214 (`build_condition`), :216-242 (idempotency guards)
- **Current test state**: none
- **Scenario**: `wire_team_handoff` translates the team connection graph into runtime triggers. Two invariants carry real risk: (a) `feedback` edges must NEVER be wired as forward handoff (they are revision loops; the chain-cycle guard would reject them and the team would mis-cascade or error), and (b) it must be idempotent — re-running creates no duplicate triggers (duplicate chain triggers = the same downstream persona fired twice per upstream completion = doubled executions/PRs, the same duplication class the orchestrator's single-flight guards against). `build_condition` must only honor a JSON-object condition for `conditional` edges and default everything else to `{"type":"success"}`.
- **Root cause**: All wiring logic is DB-side with no test; the feedback-skip and idempotency are one-line conditions easy to regress.
- **Impact**: Either broken autonomous cascade (chain dies after entry member — the exact baseline-health failure cited in the module doc) or duplicate triggers doubling spend.
- **Fix sketch**: Pure-function test for `build_condition`: `conditional` + valid object-JSON returns it verbatim; `conditional` + non-object/garbage falls back to success; `sequential`/`parallel`/unknown return success. DB-backed test (`init_test_db()` + seed `persona_team_members` / `persona_team_connections`): wire a 3-member graph with one `feedback` edge; assert feedback edge NOT counted in `edges_total`/wired, then re-run and assert `skipped_existing` covers all edges and zero new triggers created (idempotency invariant).

## 5. delete-active-assignment guard & title-derivation are untested invariants
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/teams/assignments.rs:253-279 (`assignment_is_active` + `delete_team_assignment`), :437-450 (`derive_title_from_goal`)
- **Current test state**: none
- **Scenario**: `assignment_is_active` is the guard that blocks deleting a `queued|running|awaiting_review` assignment; the comment documents that deleting mid-run "orphans the in-flight LLM execution and can crash the orchestrator" (next tick's `get_by_id` → NotFound → loop panic). If the status set regresses (e.g. `paused` slips through, or `awaiting_review` is dropped), a delete crashes the live orchestrator and orphans a running execution. `derive_title_from_goal` must truncate at 60 chars on a char boundary (it uses `.chars().take(57)`) — a byte-slice regression would panic on multibyte goals.
- **Root cause**: Both are pure helpers with documented failure modes and no tests; the command itself is thin enough that the guard is the only real logic.
- **Impact**: Orchestrator crash + orphaned persona execution (and its token spend) on a mistimed delete; or a panic on a non-ASCII goal title.
- **Fix sketch**: LLM-generatable pure-function batch. `assignment_is_active`: assert true for each of queued/running/awaiting_review and false for done/failed/aborted/paused (invariant: active set == states where the tick task may still be live). `derive_title_from_goal`: invariant "result ≤ 60 chars, takes first clause before `.`/`;`/newline, never panics on multibyte input (e.g. an emoji- or CJK-heavy goal)."

## 6. KPIDashboard chart-math (`distancePct`, `normValue`) + shared `kpiMath` are untested
- **Severity**: medium
- **Category**: llm-generatable
- **File**: src/features/teams/sub_kpis/KPIDashboard.tsx:25-44 (`distancePct`, `normValue`); src/features/teams/sub_kpis/kpiMath.ts:19-131 (whole module)
- **Current test state**: none (no test files anywhere under src/features/teams)
- **Scenario**: `kpiMath.kpiTrack` is documented as "the single source of truth for is-this-KPI-off-track" and an explicit port of `engine/kpi_derivation.rs::kpi_is_off_track` ("keep the two in sync"). It drives the needs-attention strip, the off-track count, and downstream autopilot. The dashboard's local `distancePct`/`normValue` are direction-aware ratio math with divide-by-zero and overshoot-clamp edge cases. A regression in the `direction === 'down'` branches, the floor-breach rule, or the baseline==target null-guard silently mis-classifies KPIs (shows on-track when off-track) and the frontend/backend off-track verdicts drift apart undetected.
- **Root cause**: Pure, deterministic, dependency-free math with documented business invariants and a stated parity contract — yet no test exists; the parity with the Rust side has nothing enforcing it.
- **Impact**: Off-track KPIs hidden from the operator; autopilot decisions made on wrong track state; silent FE/BE divergence.
- **Fix sketch**: LLM-generatable vitest batch (deterministic — inject a fixed `now` via the `target_date`/`created_at` inputs rather than mocking Date, or wrap Date.now). For `kpiTrack`: invariants — met wins over all (up: cur≥target; down: cur≤target); floor breach for traffic/value up at ≤0; crit_at crossing fires off-track independent of pace; pace lag respects tolerance; unmeasured when current==null. For `distancePct`/`normValue`: divide-by-zero (target===0 / baseline===target → null), direction-aware ratios, 115% overshoot clamp. Assert business invariants, not snapshots.

## 7. RedRoomPane variant tab logic has no render/interaction test
- **Severity**: low
- **Category**: coverage-gap
- **File**: src/features/teams/sub_redRoom/RedRoomPane.tsx:29-76
- **Current test state**: none
- **Scenario**: Read-only prototype surface; the only behavior is the loaded/loading gate and switching between `transcript`/`relay` variants (which mount different children). Low blast radius — no writes, no money path — but a default-variant or loaded-gate regression would blank the panel.
- **Root cause**: New prototype component, no test; legitimately low priority versus the engine gaps above.
- **Fix sketch**: Lightweight RTL test: render with `loaded=false` → asserts the "Tuning in…" gate; with `loaded=true` → default renders the Transcript child; clicking the Relay tab swaps to the Relay child. Keep it behavior-level (assert child presence via `data-testid`/role), not snapshot — this is a deliberately temporary scaffold so don't over-invest.

---

### Quality-gate recommendation (cross-cutting)
The Rust engine has a strong `#[cfg(test)]` convention (124/157 files) but the team-assignment trio opted out entirely. Rather than a giant backfill, apply a **new-code ratchet on `src-tauri/src/engine/team_assignment_*.rs` and `team_handoff.rs`**: any change to these files must add/extend a `#[cfg(test)]` module (advisory in CI first, blocking once findings 1–4 land). The pure decision helpers (cascade decision, QA-rework decision, id-validation, build_condition, assignment_is_active) should be extracted behind small seams precisely so the ratchet is cheap to satisfy — this also makes the money-path branches testable without spawning the CLI or the full tokio tick loop.
