# Team Assignment & Handoff — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: team-assignment-and-handoff | Group: Teams & Fleet Orchestration
> Total: 5 | Critical: 0 | High: 2 | Medium: 3

## 1. Manual review "Edit"/"Reassign" never restores the cascade-skipped pipeline tail
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent incomplete delivery / orchestration
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:182, 197 (vs. the fix already present at :248–:320)
- **Scenario**: A chained assignment (implement → review → QA-merge) fails the implement step. The tick loop cascade-skips review + QA-merge ("Dependency was skipped or failed") and pauses at `awaiting_review`. The user opens the review modal and picks **Edit requirement** (or **Reassign**). `resolve_review_edit` resets only the failed step to `pending` and calls `resume_assignment`. The implement step now re-runs and succeeds → all steps are terminal with none `failed` → the assignment is marked **done**. Review and QA-merge never ran; the PR is left open and the linked goal's to-dos are checked off as if delivered.
- **Root cause**: `restore_cascade_skipped_dependents` (the existing F1 fix) is invoked only from `auto_resume_retryable_steps` (:271) and orphan-recovery (:367). The two **manual** resolvers — `resolve_review_edit` (:182) and `resolve_review_reassign` (:197) — re-queue the failed step but leave its previously cascade-skipped dependents in terminal `skipped`. The cascade-skip pass (:465–:484) only acts on `pending` steps, so a `skipped` dependent is never re-evaluated.
- **Impact**: The most expensive failure mode the team already documented (PR stranded open, goal falsely "done", merge gate silently bypassed) recurs through the primary human path, even though it was fixed for the autonomous path.
- **Fix sketch**: In both `resolve_review_edit` and `resolve_review_reassign`, call `restore_cascade_skipped_dependents(&pool, &step.assignment_id, &HashSet::from([step_id]))` before `resume_assignment`, exactly as `auto_resume_retryable_steps` does.
- **Value**: impact=8 effort=2

## 2. Lost resume: single-flight slot is released only after the loop fully exits
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race / lost wakeup → work silently never runs
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:149–157 (release) vs :134 (claim); tick exit at :498–:514
- **Scenario**: A step fails. Inside `tick_loop`, the assignment is set to `awaiting_review` and `emit_progress(... "awaiting_review")` fires at :506 — **before** the loop returns at :514 and before the spawn wrapper removes the id from `live_assignments()` at :154. `AssignmentAutoResumeSubscription` reacts to that transition, classifies the step as retryable, resets it `failed→pending` (:262), and calls `resume_assignment → run_assignment`. Because the loop has not yet released the slot, `live.insert(...)` returns `false` (:134) and the spawn is **skipped as a duplicate**. Moments later the original loop returns and removes the slot — but no live tick task remains. The step now sits `pending` under status `running` (set by `resume_assignment` :395) with nothing ticking it.
- **Root cause**: Check-then-act gap. The guard at :119–:120 assumes "a resume that arrives while the loop still runs is absorbed by the running loop (it re-reads status each tick)", which is false during the loop's **exit** window: the loop has already committed to returning and will not re-scan. The slot release happens strictly after the loop body finishes, so resumes landing in that window are dropped with no retry.
- **Impact**: Assignment wedged in `running` with runnable work and no executor until the next app restart's orphan-recovery — i.e. the whole remaining pipeline silently never runs.
- **Fix sketch**: After releasing the slot (:154–:157), re-read the assignment; if it is non-terminal and has any `pending`/runnable steps, re-spawn once. Or have `run_assignment`'s "already live" branch set a "re-tick requested" flag the loop checks before returning, so a dropped resume is retried instead of lost.
- **Value**: impact=8 effort=4

## 3. In-flight double-launch: launch guard trusts DB status, not the in-flight map
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race / double assignment
- **File**: src-tauri/src/engine/team_assignment_orchestrator.rs:584 (guard) and :645 (insert); status flip at :668
- **Scenario**: The launch loop skips a step only when `step.status != "pending"` (:584). After a step is spawned and inserted into `in_flight` (:645), its DB status is still `pending` until the spawned task runs its first line `update_step_status(... "matching")` (:668), which executes asynchronously. If the next tick (1 s later) reads the steps before that write lands — plausible under DB-lock contention with multiple parallel steps/executions writing — the same step is launched **again**: a second `exec_repo::create`, a second persona execution, a second PR, doubled token spend. The per-loop `in_flight` map is never consulted by the launch loop.
- **Root cause**: The launch guard derives "is this step already running?" from a lagging DB field instead of the authoritative in-process `in_flight` set the loop already maintains.
- **Impact**: Exactly the duplicate-execution / duplicate-PR / doubled-spend failure the cross-loop `live_assignments()` guard was built to prevent — but reachable within a single loop. Narrow window, so likelihood is low, but the fix is trivial and the blast radius is real money + repo state.
- **Fix sketch**: Add `if in_flight.contains_key(&step.id) { continue; }` to the launch loop before the status check.
- **Value**: impact=7 effort=1

## 4. Fan-in handoff fires per-upstream with only that upstream's payload (no join)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: handoff context loss / unclear semantics
- **File**: src-tauri/src/engine/team_handoff.rs:57–59 (per-target event), :104–:186 (wiring), comment :54–:56
- **Scenario**: A team graph fans two upstreams into one merge/release node: edges S1→T and S2→T (both non-feedback). `wire_team_handoff` creates two `chain` triggers (keyed on S1 and on S2) plus one `event_listener` on T for `team_handoff.<T>`. When S1 completes it publishes `team_handoff.<T>` carrying **only S1's** forwarded output; T runs. When S2 later completes it publishes the same event type carrying **only S2's** output; T runs **again**. T never receives S1+S2 combined — the merge node acts on partial context (and executes redundantly).
- **Root cause**: The wiring models fan-in purely as N independent triggers sharing one per-target receiver (the doc at :54–:56 only addresses receiver dedup). There is no join/quorum — the event bus has no "wait for all inbound edges" concept, so the carried context of all-but-one upstream is lost on each firing.
- **Impact**: A "combine/release after review + security" style node integrates only one predecessor's work, or runs once per predecessor with conflicting partial context — silent context loss in exactly the handoff path this module exists to wire. Severity scales with how common fan-in graphs are in the SDLC roster.
- **Fix sketch**: Either document fan-in as unsupported and reject it at wiring time, or gate T's listener on a join condition (e.g. require all inbound `source_persona_id`s to have completed within the run before T fires), forwarding a merged payload.
- **Value**: impact=6 effort=6

## 5. KPI procedures may freeze a single-page/approximate count and report it as ground truth
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: wrong attribution / undocumented measurement caveat
- **File**: src-tauri/src/engine/kpi_binding.rs:463 (prompt sanctions approximation), :280–:281 (`count:` = `array.len()`), :352–:369 (`check_invariants`)
- **Scenario**: For a paginating connector, the composer prompt explicitly permits "a count capped at one page of results" and the `count:` extractor returns `array.len()` of whatever single response page comes back. A metric like `api_requests` or `unique_visitors` whose true value is in the millions can freeze a binding that returns e.g. `100` (one page). `check_invariants` only validates finiteness, `>= min (0)`, and integer-ness — all of which `100` satisfies — so the measurement records and the Trend/Distance charts plot the capped number as the real KPI, driving off-track/autopilot decisions on a value that is wrong by orders of magnitude.
- **Root cause**: The deterministic-replay design trades correctness for a single request, and the only signal that a value is an approximation lives in the free-text `plan` string — it is not surfaced on the measurement, not bounded by any plausibility/“suspiciously round/at-page-limit” check, and not distinguishable from an exact count at read time.
- **Impact**: Silently wrong KPI attributions feed the KPI→goal→team autopilot loop; an off-track product can read as on-track (or vice versa) with full confidence and no caveat in the UI.
- **Fix sketch**: Carry an `approximate: bool` / `page_capped` flag from the procedure into the measurement + evidence and render it on the charts; optionally add an invariant/heuristic that flags values equal to a known page size for review before freezing. (Related, same file: `execute_procedure` stores the fully-rendered `url` in evidence at :339–:346 — redact `{{field:...}}`-substituted spans so a credential placed in a query string does not leak into persisted evidence.)
- **Value**: impact=6 effort=5
