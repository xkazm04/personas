# Team Builder & Workspace — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: team-builder-and-workspace | Group: Teams & Fleet Orchestration
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. Preset adoption silently produces a non-cascading team when handoff wiring fails
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / partial-team
- **File**: src-tauri/src/engine/team_preset_adopter.rs:541 (mirror at :825 in `retry_failed_members`)
- **Scenario**: A user adopts a preset (or auto-team) that creates N members + connections. Step 5 calls `team_handoff::wire_team_handoff` to create the `chain`/`event_listener` triggers that make S→T edges actually fire. If that call returns `Err` (a trigger insert conflicts, a persona row was mutated concurrently, integrity check trips), the error is only `tracing::warn!`-logged and swallowed. `adopt_preset` returns `Ok(AdoptedTeamPresetResult{ members, created_connections, … })` — which the modal renders as full success (green "Team created", correct member/connection counts).
- **Root cause**: Handoff wiring is best-effort and its outcome is not represented anywhere in `AdoptedTeamPresetResult`. The comment at :538-540 even acknowledges "it IS the difference between a team that can cascade and one that stalls after the entry member," yet there is no success flag, no failure surfaced to the UI, and no automatic retry. The canvas shows nodes + edges, so the team *looks* wired.
- **Impact**: The team executes only its entry member; every downstream member never fires. The failure is invisible until the user runs the pipeline and notices nothing happened past node 1. Recovery requires knowing the hidden `repair_team_handoff` command exists. This is exactly the "partial-team / silent partial adoption" failure class.
- **Fix sketch**: Add a `handoff_wired: bool` (or `handoff_error: Option<String>`) field to `AdoptedTeamPresetResult`; set it from the `wire_team_handoff` result and have the modal show a "Team built but handoff wiring failed — click Repair" affordance (wired to `repair_team_handoff`) instead of an unqualified success.
- **Value**: impact=8 effort=4

## 2. Node success-rate denominator counts non-executing statuses → false "remove agent" / "reorder" advice
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: optimizer-from-incomplete-data
- **File**: src-tauri/src/engine/optimizer.rs:162-169 (`compute_node_analytics`)
- **Scenario**: A run is created with every member seeded as `"idle"` (teams.rs:301-310). On a cancelled, failed-early, or conditional-branch pipeline, members that never executed stay `"idle"`/`"skipped"` in the persisted `node_statuses`. `compute_node_analytics` does `stats.0 += 1` (total) for **every** entry but only credits `successes` on `"completed"` and `failures` on `"failed"`. A member that completed in 2 runs but sat idle in 3 cancelled runs gets total=5, successes=2 → `success_rate = 0.40`.
- **Root cause**: The per-node denominator is "runs in which the member appeared in any status," not "runs in which the member actually executed." Non-executions (idle/skipped/running) deflate the rate.
- **Impact**: `generate_suggestions` then fires "Underperforming Agent — consider removing or replacing it" (`success_rate < 0.5`, :212) and "Reorder Pipeline" (`success_rate < 0.6`, :326) against perfectly healthy agents. The user is advised to delete an agent that never once failed.
- **Fix sketch**: Compute `na.total_runs`/`success_rate` from executed runs only: `let executed = successes + failures;` and divide by `executed` (guarding `executed > 0`); base the `total_runs >= 2`/`>= 3` gates on `executed`, not raw entry count.
- **Value**: impact=6 effort=2

## 3. "Parallel Execution" suggestion targets already-parallel siblings; accepting it serializes them
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: heuristic comment-vs-behavior mismatch / harmful suggestion
- **File**: src-tauri/src/engine/optimizer.rs:240-257 + `find_parallelizable_nodes` :403-433
- **Scenario**: Team has fan-out P→A and P→B (A and B independent). `find_parallelizable_nodes` groups by `children_of` (same predecessor), finds A,B with no mutual reachability, and emits a "parallelize" suggestion with `suggested_source=A`, `suggested_target=B`, `connection_type="parallel"`. But A and B are *already* parallel — both depend only on P.
- **Root cause**: The function's comment claims it finds nodes "currently in a sequential chain," but it actually enumerates siblings of a shared parent, which are by definition already parallel. Worse, the executor's dependency DAG excludes only `"feedback"` edges (pipeline_executor.rs:120; teams.rs:263-266). So the suggested A→`parallel`→B edge is treated as a real dependency — accepting the suggestion makes B wait for A, i.e. it *serializes* the two nodes it claims to parallelize.
- **Impact**: Confusing false-positive advice on every fan-out team (≥2 runs), and if accepted it degrades the exact duration metric it promises to improve. Repeated accept builds spurious cross-branch edges.
- **Fix sketch**: Either (a) only flag pairs that are currently sequential (one reaches the other through non-feedback edges) and suggest *removing* the ordering edge, or (b) if siblings are the target, make the suggestion informational ("already parallel") with no `suggested_*` edge. Also reconcile the comment with the implementation.
- **Value**: impact=6 effort=3

## 4. Auto-team "seeded" memories are written as manual (`run_id: null`) → permanently exempt from eviction
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource leak / cap-not-enforced
- **File**: src/features/teams/sub_teamWorkspace/useAutoTeam.ts:205-218 (`run_id: null` at :208) + src-tauri/src/db/repos/resources/team_memories.rs:474-482
- **Scenario**: On every auto-team build, up to 10 high-importance memories are copied from overlapping teams via `createTeamMemory({ run_id: null, … })`. `evict_excess` only deletes rows `WHERE run_id IS NOT NULL` (:477) — i.e. it treats `run_id IS NULL` as "manually curated, never evict." Seeded memories are auto-derived but stored in the manual class.
- **Root cause**: The seeded copies inherit the manual classification (`run_id: null`), so they bypass the per-team cap forever. Combined with the fact that `create` never triggers eviction and `evict_excess` is only ever called via the explicit `evict_team_memories` command (confirmed: no internal caller), the advertised 200-memory cap (`DEFAULT_MAX_MEMORIES_PER_TEAM`, reported in `get_stats`) is purely advisory.
- **Impact**: Auto-built teams accumulate un-evictable seeded rows that crowd the manual pool and inflate `total`/`avg_importance` stats; a team re-seeded across many auto-builds grows without bound. (Prompt-injection is separately limit-capped, so the harm is storage/stat drift, not injection blow-up.)
- **Fix sketch**: Tag seeded rows so they are evictable — e.g. give them a synthetic `run_id` (or add a `source='seeded'` predicate to `evict_excess`'s eligibility filter) and/or trigger `evict_excess` after a seed batch. Document that `run_id IS NULL` == "user-curated, immortal."
- **Value**: impact=5 effort=3

## 5. Pipeline `success_rate` + suggestion gate count still-running, cancelled, and zero-member runs in the denominator
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: metric-from-incomplete-data
- **File**: src-tauri/src/engine/optimizer.rs:73-86 (and the `total_runs >= 2` gate at :206)
- **Scenario**: `total_runs = runs.len()`, including runs still in the `running` state, cancelled runs, and "No members in team"/cycle-refused runs that failed before executing. `success_rate = completed_runs / total_runs`. Right after a user kicks off a run, the OptimizerPanel stat bar shows a depressed success rate (the in-flight run is in the denominator but not yet completed), and the `>= 2` gate can flip on from runs that never executed.
- **Root cause**: The denominator is "all run rows ever created," not "terminal runs that actually executed." Running/cancelled/empty runs are not comparable to completed/failed outcomes.
- **Impact**: Misleading "X% success" in the panel and premature/odd suggestion gating; transient and self-correcting once runs reach a terminal state, hence Low.
- **Fix sketch**: Define the denominator as terminal executed runs (`completed + failed`), exclude `running`/`cancelled`/zero-member runs, and gate suggestions on that count.
- **Value**: impact=3 effort=2
