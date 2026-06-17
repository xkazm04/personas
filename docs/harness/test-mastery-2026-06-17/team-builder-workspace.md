# Test Mastery — Team Builder & Workspace
> Total: 7 findings (2 critical, 3 high, 1 medium, 1 low)

## 1. Team-preset adoption orchestration has zero coverage of its data-write & partial-failure semantics
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/team_preset_adopter.rs:207-521 (`adopt_preset`), 539-805 (`retry_failed_members`)
- **Current test state**: exists-but-weak — the `#[cfg(test)] mod tests` (lines 807-831) only covers the trivial `member_semantic_role` helper; the entire `adopt_preset` / `retry_failed_members` orchestration (DB writes to teams, members, connections, home_team binding, handoff wiring) is untested.
- **Scenario**: `adopt_preset` is the primary "Adopt a team preset" data-write path — it creates a team shell, adopts N personas, stamps `home_team_id`, wires connections, and fires handoff triggers. A regression that (a) wires a connection whose endpoint role failed adoption, (b) double-creates a team because the `ADOPT_INFLIGHT` single-flight guard breaks, (c) drops the `preset_role` config stash so `retry_failed_members` can no longer match existing members (causing duplicate re-adoption), or (d) mis-maps `role_to_member_id` so connections point at the wrong members — all slip through today. `retry_failed_members`' idempotent-skip (line 608) and "swallow only duplicate-edge error" (line 771) are exactly the kind of subtle branch that silently rots.
- **Root cause**: The orchestrator needs an `AppState` + real template files on disk, so it was never unit-tested; only the pure helper got a test. The author even designed `app: Option<AppHandle>` (line 192) specifically so tests could call it without Tauri — that affordance is unused.
- **Impact**: Silent duplicate personas/teams on double-click; orphaned half-built teams; connections pointing at wrong/failed members → a team that looks adopted but cascades to the wrong agent or stalls. Blast radius = every preset adoption.
- **Fix sketch**: Add integration tests using `init_test_db()` + a temp `scripts/templates/_team_presets/` fixture (or inject a tiny 2-member preset). Assert invariants: (1) double-call of the same preset id returns `RateLimited` and creates exactly one team; (2) a member whose `template_id` is missing lands in `failed_members` while the rest succeed and the team shell survives; (3) a connection is created only when BOTH endpoint roles succeeded; (4) `retry_failed_members` skips already-present roles (no duplicate persona) and recovers the semantic role from config; (5) every adopted member's `home_team_id == team.id` when the preset declares a group.

## 2. Single-pipeline-per-team concurrency guard (`create_pipeline_run`) is untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/teams.rs:714-753 (`create_pipeline_run`), 686-696 (`has_running_pipeline`)
- **Current test state**: none — `test_team_crud` (lines 823-953) covers CRUD/members/connections but never touches pipeline_runs at all.
- **Scenario**: `create_pipeline_run` is the *authoritative* race-free guard documented to re-check `status='running'` inside a `BEGIN IMMEDIATE` transaction so two concurrent `execute_team` calls can't both start a pipeline (duplicate LLM calls, conflicting status events, cost burn). If a refactor drops the in-transaction re-check, downgrades the transaction behavior, or changes the status string, the duplicate-pipeline bug returns invisibly — the fast-path pre-check in `execute_team` (teams.rs cmd:235) is explicitly NOT the guarantee.
- **Root cause**: Concurrency guards are awkward to assert and the run lifecycle was added after the original CRUD test; the guard is enforced only by a code comment, not a test.
- **Impact**: Double pipeline execution = duplicated paid LLM calls and corrupted team-memory (the cycle-refusal comment at cmd:287 notes garbage poisons team memory). Directly a cost/billing + data-integrity path.
- **Fix sketch**: Add a Rust test: insert a `running` pipeline_run, assert a second `create_pipeline_run` returns `AppError::Validation` ("already has a pipeline running"); assert `has_running_pipeline` flips true/false across `update_pipeline_run("completed"/"cancelled"/"failed")`. Optionally spawn two threads sharing the pool to assert exactly one of two concurrent `create_pipeline_run` calls succeeds. Assert `update_pipeline_run` sets `completed_at` for `cancelled` (the regression noted at line 769).

## 3. Topology heuristic (keyword fallback that drives auto-team) is completely untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/engine/topology_heuristic.rs:81-368 (`score_persona`, `infer_role`, `suggest_topology`, `build_blueprint`)
- **Current test state**: none.
- **Scenario**: This is the deterministic fallback the auto-team flow uses whenever the LLM is unavailable or returns empty (`suggest_topology` / `compile_workflow` both fall back here). It is a pure function over `&[Persona]` — ideal for a generated test batch. Today a regression could: select disabled personas (the `p.enabled` filter at line 163/183), emit a self-loop or a non-feedback cycle (orchestrator→worker→reviewer→orchestrator is intentionally `feedback`, line 294 — flip that to `sequential` and the team can never execute, since `execute_team` *refuses non-feedback cycles*), produce >1 orchestrator (the de-dup at line 217), or generate connection indices out of range for `compute_dag_layout`.
- **Root cause**: Pure heuristic written without tests; its output silently feeds a hard execution gate (cycle refusal) so a bad blueprint becomes an un-runnable team rather than a visible error.
- **Impact**: A wrong role assignment or accidental non-feedback back-edge yields teams that the executor refuses to run — "built but can't run." High blast radius: every auto-team and workflow-compile that hits the fallback.
- **Fix sketch**: LLM-generatable batch asserting *business invariants*, not snapshots: (i) never selects a disabled persona; (ii) at most one orchestrator in the output; (iii) the only cycles produced are `feedback`-typed (feed the result into `topology_graph` filtering out feedback edges and assert acyclic — the exact check `execute_team` runs); (iv) every connection's `source_index`/`target_index` < `members.len()` and source≠target; (v) empty/no-match query yields empty members + the documented description. Use 3-4 fixture personas with known names/roles.

## 4. Pipeline optimizer suggestion engine has no tests for its risk-ranking logic
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/engine/optimizer.rs:67-455 (`analyze_pipeline`, `compute_node_analytics`, `generate_suggestions`, `find_parallelizable_nodes`, `compute_avg_duration`)
- **Current test state**: none.
- **Scenario**: `analyze_pipeline` is pure (over runs/members/connections) and feeds the OptimizerPanel that users act on (accept/dismiss "remove underperformer", "parallelize", "add feedback"). A regression in the success-rate math (divide-by-zero at line 82/177 is guarded — keep it that way), the `total_runs < 2` gate (line 206), or the parallelizable-pair reachability BFS (line 359) would surface wrong/misleading advice. `compute_avg_duration` silently drops negative durations (line 132) — a clock-skew or column-swap regression that flips the sign would zero out duration analytics with no test to catch it.
- **Root cause**: Analytics output is "advisory" so it was treated as low-stakes; but users restructure real pipelines based on it.
- **Impact**: Bad optimizer advice (e.g. recommending parallelizing two nodes that actually have a dependency, or flagging a healthy agent as underperforming) erodes trust and can break working pipelines. Medium-high blast radius.
- **Fix sketch**: LLM-generatable batch with hand-built `PipelineRun`/member/connection fixtures asserting invariants: (i) `success_rate == completed/total` and 0.0 when `total_runs==0`; (ii) no suggestions when `total_runs < 2`; (iii) `remove_underperformer` fires only for nodes with `total_runs>=2 && success_rate<0.5`; (iv) `find_parallelizable_nodes` never returns a pair where one reaches the other (build a chain A→B→C and assert B,C are NOT a pair); (v) isolated-node suggestion only when `members.len()>1`; (vi) `compute_avg_duration` ignores `completed_at<started_at`.

## 5. `clone_team` deep-copy (members + remapped connections + memories) is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/resources/teams.rs:149-290 (`clone_team`)
- **Current test state**: none — `test_team_crud` never calls `clone_team`.
- **Scenario**: A transactional deep-clone that remaps `member_id` across connections AND memories, and deliberately nulls `run_id` on cloned memories (lines 261-265) so cross-team run queries don't mix. Regressions that slip through today: connection endpoints pointing at the *source* team's member ids (broken remap), cloned memories carrying the source `run_id` (corrupting `list_team_memories_by_run`), or a connection silently dropped when only one endpoint remaps (the `if let (Some, Some)` at line 207).
- **Root cause**: Added after the original CRUD test; the remap/null-run-id logic is subtle and entirely comment-enforced.
- **Impact**: A forked team whose connections point at the wrong team, or whose memories leak into another team's run view. Data-integrity bug on a user-facing "fork team" action.
- **Fix sketch**: Rust test: build a team with 2 members + 1 connection + 2 memories (one with `run_id`, one manual). Clone it, then assert: new team name == "<src> (fork)" with `parent_team_id == source`; cloned members count matches but ids differ; the cloned connection's source/target are the *new* member ids (not source's); all cloned memories have `run_id IS NULL`; `member_id` on a cloned memory is remapped to the new member id.

## 6. `useAutoTeam` apply()/removeMember() — multi-step team build + rollback + index re-mapping have no frontend tests
- **Severity**: medium
- **Category**: test-structure
- **File**: src/features/teams/sub_teamWorkspace/useAutoTeam.ts:94-244 (`apply`, `removeMember`)
- **Current test state**: none — there are zero `*.test.ts(x)` files anywhere under `src/features/teams/` (confirmed by glob), despite this hook owning real failure-handling logic.
- **Scenario**: `apply()` creates a team, adds members, rolls back the whole team on partial member-add failure (line 147), guards re-entrant double-submit via `applyingRef` (line 96), and honors a cancellation ref. `removeMember()` re-indexes connections after a member is dropped — drop index `i`, filter edges touching `i`, decrement indices `> i` (lines 235-241). An off-by-one in that re-index, a broken re-entry guard (orphaned teams on Enter+click), or a dropped rollback are pure-logic regressions the project's vitest setup is already equipped to catch.
- **Root cause**: The `teams` feature area was never given a test file even though sibling features (artist, drive, companion, twin) have many; the index-remap logic is the most test-worthy pure reducer in the context and lives inside a hook.
- **Impact**: Connections wired to the wrong member after an edit, or orphaned half-built teams from a double-submit. Moderate — recoverable but user-visible.
- **Fix sketch**: Extract the connection re-index out of `removeMember` into a pure helper (`reindexConnectionsAfterRemoval(connections, removedIndex)`) and unit-test it: removing a middle member drops its edges and shifts later indices down by one; removing the last member leaves earlier edges intact; refuse removal at length 1. Add a `renderHook` test for `apply()` with mocked `createTeam`/`addTeamMember`: assert that an `addTeamMember` returning `null` triggers `deleteTeam(team.id)` rollback and ends in `phase==='error'`, and that two synchronous `apply()` calls only run the flow once.

## 7. `team_preset_loader::is_overlay_filename` documents a known false-positive with no asserting guard around the consequence
- **Severity**: low
- **Category**: missing-assertion
- **File**: src-tauri/src/engine/team_preset_loader.rs:232-245 (`is_overlay_filename`), 254-319 (`list_presets`)
- **Current test state**: adequate for the helper itself (tests at lines 596-624 cover locale detection), but the *interaction* — a canonical preset named like `foo.bar.json` being silently skipped from the gallery — is only described in a comment (lines 608-616), never asserted, and `list_presets`/`get_preset`/`validate` have no tests at all.
- **Scenario**: The validate-and-skip path in `list_presets` (a bad manifest is logged + skipped so one broken file doesn't blank the gallery) and the role-uniqueness / unknown-role-reference checks in `validate` (lines 189-225) are business rules with no test. A regression that makes `validate` accept a duplicate role would let connections silently bind to the wrong member at adoption time — the exact failure `validate` exists to prevent.
- **Root cause**: Loader validation was added with a doc-comment rationale but the gallery-skip and validation rules weren't pinned by tests.
- **Fix sketch**: Add tests over a temp presets dir: a manifest with `schema_version=2` is skipped by `list_presets` but the rest still load; a manifest with a duplicate member role fails `validate` (and is skipped by `list_presets`); a connection referencing an unknown role fails `validate`; `get_preset` with an id containing `..`/`/` returns `Validation` (path-traversal guard at line 332).
