# Team Assignment & Handoff — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

> Note: the context map lists `src/features/teams/sub_redRoom/RedRoomPane.tsx`, but no RedRoom file exists anywhere under `src/` (only "red room" strings in fleet-monitor lens/i18n). Context-map drift — the audit covered the six files that exist.

## 1. QA bounce detection is keyed on persona + wall-clock, so a concurrent run by the same QA persona falsely bounces an unrelated step
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:1079 (call site :926)
- **Scenario**: If the same QA persona is on two teams (or two parallel steps in one assignment — `max_parallel_steps` defaults to 3) and assignment A's QA step emits `qa.pr.changes_requested` while assignment B's QA step for a *clean* PR is still polling, B's completion check runs `count_by_type_and_source_since(pool, "qa.pr.changes_requested", persona_id, exec_created_at)` and counts A's event — it matches by event type + emitting persona + timestamp only, with no execution/assignment scoping.
- **Root cause**: The design assumes one QA persona runs at most one execution inside any `created_at`-bounded window. `persona_events` rows carry no execution or assignment id usable here, so the window is a proxy for "this run" that breaks under any concurrency.
- **Impact**: A passing step is treated as a bounce: `trigger_qa_rework` resets its done implementer predecessors to `pending`, re-runs the implementation (duplicate PR work, doubled token spend), burns a round of the `MAX_QA_FIX_ROUNDS` cap, and forwards the *other assignment's* verdict as `rework_feedback` — the implementer "fixes" a PR it never touched.
- **Fix sketch**: Scope the check to the execution: stamp the emitted event with `execution_id` (or assignment/step id) in its payload when the QA protocol event is recorded, and match on that instead of persona+time; minimally, also require the event's payload to reference the step's own PR/branch.

## 2. Step timeout marks the step failed but never cancels the live execution — retry launches a second concurrent execution of the same work
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:905-1025 (timeout write at :1018)
- **Scenario**: If a Dev Clone step legitimately runs past `STEP_EXECUTION_TIMEOUT_TICKS` (600 × 1s ≈ 10 min — routine for an implement step that writes code + tests + opens a PR), `run_step` writes `failed: "Step execution timed out"` and returns, but the underlying `ExecutionEngine` execution is never cancelled and keeps running. The assignment lands in `awaiting_review`; the user (or `AssignmentAutoResumeSubscription`, since a timeout may classify as retryable) requeues the step, which creates a brand-new execution while the first is still alive.
- **Root cause**: The poll loop assumes "I stopped watching" equals "the work stopped." There is no `engine.cancel_execution(exec.id)` on the timeout path, and the retry path never checks whether the step's previous `execution_id` is still non-terminal.
- **Impact**: Two personas implementing the same step against the same repo — duplicate/conflicting PRs and pushes, doubled spend. The orphaned execution's eventual completion is silently discarded (success theater inverted: real success recorded nowhere), and if it is a QA step, its late `qa.pr.changes_requested` event poisons the finding-#1 window of the retry.
- **Fix sketch**: On timeout, cancel the execution via the engine before writing `failed` (or keep polling in a detached low-frequency reaper). Before launching a retried step, refuse/absorb if its recorded `execution_id` is still `pending`/`running`.

## 3. Conditional handoff edges silently degrade to fire-on-success when the condition isn't a JSON object
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/engine/team_handoff.rs:203-214
- **Scenario**: If a user draws a `conditional` connection in the team designer and its stored `condition` is anything but a parseable JSON object (plain-text like "only if review fails", an empty string, a JSON string/array, or NULL), `build_condition` falls through to `{"type": "success"}` with no log and no error, and `wire_team_handoff` freezes that into the chain trigger's config.
- **Root cause**: The wiring layer assumes conditions are always well-formed JSON objects by the time they reach it, and treats "can't interpret" as "unconditional" instead of "invalid" — the least-safe default for a gating construct.
- **Impact**: The downstream persona fires on every upstream success even though the user explicitly gated the edge — silent unwanted executions (token spend, actions taken) whenever the source completes, with nothing in `HandoffWireResult` or the logs indicating the condition was discarded. Because wiring is idempotent-skipped afterwards, fixing the condition later never rewires the existing trigger.
- **Fix sketch**: Treat an unparseable/non-object condition on a `conditional` edge as a wiring error: skip the edge, count it in a new `HandoffWireResult.edges_invalid`, and `tracing::warn!` — or propagate a validation error to the repair command so the UI can surface it.

## 4. KPI trend timestamps are parsed as local time, shifting every measurement by the UTC offset
- **Severity**: Medium
- **Category**: bug
- **File**: src/features/teams/sub_kpis/KPIDashboard.tsx:128
- **Scenario**: If measurements are stored in SQLite's usual UTC `"YYYY-MM-DD HH:MM:SS"` format, `new Date(m.measured_at.replace(' ', 'T')).getTime()` produces an ISO-like string with *no timezone designator*, which JS parses as **local** time. For a user at UTC−8, a measurement taken 2026-07-16 02:00 UTC renders as July 16 02:00 local — 8 hours late; going the other way (UTC+9), late-evening measurements jump to the *next day* on the X axis and tooltip.
- **Root cause**: The design assumes a timezone-less timestamp round-trips faithfully through `Date`, but ECMAScript treats date-time forms without an offset as local time — so a UTC wall-clock string gets re-interpreted in the viewer's zone.
- **Impact**: Every point on the Trend chart (axis ticks via `toLocaleDateString`, tooltip via `toLocaleString`) is displaced by the user's UTC offset; day boundaries misattribute measurements, and cross-referencing a chart point against the KPI detail modal's raw timestamps shows contradictory times — eroding trust in the KPI data itself.
- **Fix sketch**: Append the designator when none is present: `new Date(m.measured_at.replace(' ', 'T') + 'Z')` (guarded for strings that already carry an offset), or centralize on the app's existing SQLite-timestamp parse helper if one exists.

## 5. Project filter can strand the dashboard on a stale project with no visible way out
- **Severity**: Medium
- **Category**: ui
- **File**: src/features/teams/sub_kpis/KPIDashboard.tsx:56, 74, 173-184
- **Scenario**: If the user filters to project X and X's active KPIs then disappear (all met/archived elsewhere, KPIs deleted, or the project's last KPI flips to `proposed`), `kpiProjects` shrinks. When it drops to 1, the filter-chip row is hidden entirely (`kpiProjects.length > 1` gate) while `projectFilter` still holds X — `filtered` becomes empty even though `active` is not.
- **Root cause**: `projectFilter` is free-floating component state with no reconciliation effect against `kpiProjects`; the chip row is both the control *and* the only escape hatch, and its visibility condition ignores whether a filter is currently applied.
- **Impact**: The dashboard renders all-zero StatCards, an empty signal board, and no trend — with zero affordance explaining why or letting the user clear the filter (the chips are gone). Worse, `autopilotProject` falls back to `projectFilter`, so the autopilot switch shown now controls the *stale* project rather than the sole remaining one.
- **Fix sketch**: Add an effect (or render-time guard) that resets `projectFilter` to `null` when it's not in `kpiProjects`; also show the chip row whenever `projectFilter !== null` even with ≤1 project, so an applied filter always has a visible "All projects" escape.
