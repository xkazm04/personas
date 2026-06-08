# Bug Hunter — research-lab
> Total: 6
> Critical: 1 · High: 3 · Medium: 2 · Low: 0

## 1. Findings retain dangling source/experiment/hypothesis IDs after the referenced rows are deleted
- **Severity**: Critical
- **Category**: referential-integrity
- **File**: `src-tauri/src/db/models/research_lab.rs:225` (and `repos/research_lab.rs:469`, `commands/.../research_lab.rs:184`)
- **Scenario**: A finding is created and later linked to sources/experiments/hypotheses, so `research_findings.source_ids`, `source_experiment_ids` and `hypothesis_ids` hold JSON arrays of those IDs (these columns exist precisely for that — `models/research_lab.rs:225-227`). The user then deletes one of those sources (`research_lab_delete_source` → `delete_source`, `repos/research_lab.rs:241`), a hypothesis (`delete_hypothesis:345`) or an experiment (`delete_experiment:405`). The DB-level `ON DELETE CASCADE` only protects rows that have a real FK column (`research_sources.project_id`, `research_experiment_runs.experiment_id`, etc. — `initial.rs:348-468`). The denormalized ID lists inside `research_findings` are plain `TEXT`, so nothing scrubs them.
- **Root cause**: Cross-entity relationships were modeled as JSON ID arrays in TEXT columns instead of a join table with a real FK. SQLite cannot enforce or cascade references that live inside an opaque string, so the integrity guarantee the rest of the schema relies on silently does not apply here.
- **Impact**: silent corruption — findings permanently point at non-existent rows. When a report is later compiled or a future "show linked evidence" feature dereferences these IDs, it will render broken/empty citations or (if a lookup `unwrap`s) crash. The corruption is invisible until read.
- **Fix sketch**: Replace the JSON-array columns with junction tables (`finding_sources(finding_id, source_id)`, etc.) each carrying `REFERENCES ... ON DELETE CASCADE`, making dangling references structurally impossible. If the denormalized columns must stay short-term, add a deletion hook in `delete_source`/`delete_hypothesis`/`delete_experiment` that runs inside a transaction and strips the id from every finding's JSON array.

## 2. `create_experiment_run` computes `run_number` non-atomically → duplicate run numbers under concurrent runs
- **Severity**: High
- **Category**: race-condition
- **File**: `src-tauri/src/db/repos/research_lab.rs:624`
- **Scenario**: `DbPool` is an r2d2 pool of independent SQLite connections (`db/mod.rs:24`). `create_experiment_run` does `SELECT COALESCE(MAX(run_number),0)+1` (line 633) and then a separate `INSERT` (line 639) on the same connection but with no surrounding transaction. If a user double-clicks "Run experiment", or the engine triggers a run while a manual run is in flight, two invocations land on two pool connections, both read the same `MAX` (e.g. 3), and both insert `run_number = 4`. There is no `UNIQUE(experiment_id, run_number)` constraint in the schema (`initial.rs:410-422`) to reject the collision.
- **Root cause**: Read-modify-write of a derived sequence value treated as if it were serialized, when the pool guarantees no such serialization between connections.
- **Impact**: silent corruption — two distinct runs share `run_number`. The runs list (`list_experiment_runs` orders by `run_number ASC`, line 604) shows duplicate "Run 4" cards, and the Obsidian sync writes two `### Run 4` blocks (`commands/.../research_lab.rs:314`). Downstream metrics keyed on run number double-count.
- **Fix sketch**: Wrap the MAX-then-INSERT in a single immediate transaction (`BEGIN IMMEDIATE`) so the read and write are atomic, AND add a `UNIQUE(experiment_id, run_number)` index as a hard backstop so any residual race fails loudly instead of corrupting silently.

## 3. Experiment run records `passed=false` on timeout — silent false-failure while the persona is still running
- **Severity**: High
- **Category**: silent-failure
- **File**: `src/features/plugins/research-lab/shared/runPersona.ts:49` (consumed at `sub_experiments/ExperimentsPanel.tsx:70`)
- **Scenario**: A user runs an experiment whose persona takes longer than the 120s default deadline (`runPersona.ts:33`). The polling loop exits at the deadline with the execution still in a non-terminal status; `runPersonaAndWait` returns `passed: latest.status === 'completed'` → `false` (line 60-62), with no signal that it timed out vs. genuinely failed. `ExperimentsPanel.handleRun` then unconditionally calls `createExperimentRun(exp.id, output ?? undefined, metrics, passed)` (line 84) persisting a `passed=0` run, and shows the "run failed" toast (line 85). Meanwhile the real persona execution keeps running in the backend and may later complete successfully.
- **Root cause**: The design conflates "I stopped waiting" with "it failed." Timeout is not distinguished from a terminal `failed`/`error` status, and the loop swallows poll errors (`silentCatch`, line 55) so a flaky `getExecution` also looks like a slow run.
- **Impact**: silent corruption of experiment results — a successful experiment is recorded as failed, polluting findings/confidence reasoning built on run outcomes. UX degradation: user sees a false failure and may re-run, spawning a second orphaned execution.
- **Fix sketch**: Have `runPersonaAndWait` return a discriminated outcome (`completed | failed | timed_out`) and make `handleRun` skip writing a run (or write a `status='running'/'unknown'` row that is later reconciled by polling the execution id) on timeout, rather than asserting a definitive `passed=false`.

## 4. Optimistic store inserts on create are never rolled back when the list is later refetched mid-flight / and create has no failure rollback path symmetry
- **Severity**: Medium
- **Category**: state-corruption
- **File**: `src/stores/slices/system/researchLabSlice.ts:145` (same pattern: `:109`, `:171`, `:197`, `:223`, `:249`)
- **Scenario**: `createResearchSource` (and every sibling create) prepends the server-returned row to the *global* flat array: `set((s) => ({ researchSources: [source, ...s.researchSources] }))`. These arrays are not keyed by project. If the user creates a source in project A and, before the awaited create resolves, switches to project B (which triggers `fetchResearchSources(B)` in the panel `useEffect`), the two async operations race: when the create resolves last, it prepends project-A's row onto the now project-B array. The panel filters by `projectId` so it is hidden in B, but the dashboard stats and any unfiltered consumer see a stale cross-project row until the next refetch. Conversely, `create_source`'s server-side dedup (`repos:195-223`) can return an *existing* row; the slice still prepends it, producing a duplicate entry in the array for the same id.
- **Root cause**: A single global array per entity type is used as if it were scoped to the active project; create blindly prepends without de-duplicating by id or verifying the row still belongs to the currently loaded project.
- **Impact**: UX degradation / transient wrong counts — duplicate or cross-project rows appear until a refetch; React `key` collisions are possible when the deduped existing row is prepended next to its already-present copy.
- **Fix sketch**: Scope each entity collection by `projectId` (a `Record<projectId, Row[]>`) or, minimally, make the create reducer upsert-by-id (`[row, ...rest.filter(r => r.id !== row.id)]`) and ignore rows whose `projectId !== activeResearchProjectId`.

## 5. Report compiles from partial/empty data during the fetch window and while experiment runs are still in flight
- **Severity**: Medium
- **Category**: race-condition
- **File**: `src/features/plugins/research-lab/sub_reports/ReportPreviewDrawer.tsx:60` and `:88`
- **Scenario**: Opening the preview drawer fires four independent un-awaited fetches in a `useEffect` (`fetchSources/Hypotheses/Experiments/Findings`, lines 60-65) while `markdown` is computed synchronously via `useMemo` over the current store arrays (lines 88-99). On first paint — and after each individual fetch resolves at a different time — `compileReport` runs against whatever subset has arrived. A user who clicks "Download" or "Copy" in that window exports a report missing entire sections (`renderFindingsList` emits "_No findings recorded._" when the findings fetch hasn't landed, `compileReport.ts:93`). The same applies if an experiment run launched from ExperimentsPanel is still executing: the report is generated from pre-run findings with no indication runs are pending.
- **Root cause**: The compile step assumes the four datasets are present and mutually consistent, but they load asynchronously and independently with no "all loaded" gate and no awareness of in-flight runs.
- **Impact**: UX degradation / data loss in the exported artifact — the user can save/share a report that silently omits sections that exist in the DB.
- **Fix sketch**: Track per-dataset loading flags (the slice already exposes `researchSourcesLoading` etc.) and disable Copy/Download (and show a skeleton) until all four resolve; optionally surface a "N experiment runs in progress" warning before allowing export.

## 6. `delete_*` repo calls ignore the affected-row count — deleting a stale/already-removed id silently "succeeds"
- **Severity**: Medium
- **Category**: silent-failure
- **File**: `src-tauri/src/db/repos/research_lab.rs:104` (and `:241`, `:345`, `:405`, `:469`, `:525`)
- **Scenario**: Every delete (`delete_project`, `delete_source`, `delete_hypothesis`, `delete_experiment`, `delete_finding`, `delete_report`) runs `conn.execute("DELETE ... WHERE id = ?1")` and returns `Ok(())` regardless of the returned row count. If two browser tabs / two rapid clicks delete the same row, or the row was already cascade-removed by a parent project deletion, the second `DELETE` affects 0 rows but still resolves successfully. The frontend slice then optimistically removes it from state and shows no error (`researchLabSlice.ts:120-126`, `:151-154`). `get_project` distinguishes missing rows (`repos:63`) but the deletes never check existence.
- **Root cause**: Treating "statement executed without SQL error" as "the intended entity was deleted," ignoring `execute`'s `usize` rows-affected result.
- **Impact**: UX degradation / masking of bugs — a delete that targeted the wrong/stale id reports success, hiding state-desync between the UI and DB and making concurrent-edit conflicts invisible.
- **Fix sketch**: Capture the `usize` from `execute` and return `AppError::NotFound` when it is 0 (mirroring `get_project`'s NotFound contract), so the UI can reconcile (refetch) instead of silently diverging.
