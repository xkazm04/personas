# Research Lab — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: research-lab | Group: First-Party Plugins
> Total: 5 | Critical: 0 | High: 1 | Medium: 3 | Low: 1

## 1. `create_source` dedup is a check-then-insert race → duplicate sources
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition / data-duplication
- **File**: src-tauri/src/db/repos/research_lab.rs:172-240 (SELECT 195-219, INSERT 226-230)
- **Scenario**: User double-clicks "Add" in `AddSourceForm`, or adds the same arXiv paper from two windows, or a DOI-lookup add overlaps a batch arXiv add. Two `research_lab_create_source` invocations for the same normalized DOI/URL run on two independent pool connections. Both run the dedup `SELECT … LIMIT 1`, both find nothing (neither has committed yet), and both fall through to `INSERT`. Two rows for the same paper now exist.
- **Root cause**: The dedup guard is purely application-level SELECT-then-INSERT with **no enclosing transaction and no UNIQUE constraint** on `(project_id, lower(trim(doi)))` / `(project_id, lower(trim(url)))`. Contrast `create_experiment_run` (line 683) which deliberately uses `BEGIN IMMEDIATE` to serialize its `MAX(run_number)+1` read+insert "because DbPool hands out independent connections" — the exact hazard here, left unguarded.
- **Impact**: Duplicate sources in the library and as duplicate nodes in the graph; the comment at 178-183 promises "should resolve to the same row instead of silently duplicating," so the stated invariant is violated. Citation counts and dedup-aware "added vs duplicate" toasts (ArxivSearchModal:122) become wrong.
- **Fix sketch**: Add a partial UNIQUE index on the normalized keys and use `INSERT … ON CONFLICT DO NOTHING` then re-select; or wrap the SELECT+INSERT in a `transaction_with_behavior(Immediate)` like `create_experiment_run`.
- **Value**: impact=6 effort=3

## 2. Finding/hypothesis link columns are never written → graph edges, provenance, and the dangling-ref scrubber are all inert
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: silent-no-results / dead-feature
- **File**: src-tauri/src/db/repos/research_lab.rs:489-512 (`create_finding` INSERT omits link cols); consumer src/features/plugins/research-lab/sub_graph/graphLayout.ts:172-185
- **Scenario**: Open the Graph tab after creating findings. `buildGraph` reads `f.sourceExperimentIds`, `f.hypothesisIds`, `f.sourceIds`, parses them as JSON id-lists, and draws "result"/source/hypothesis edges. In practice `parseJsonIdList` always receives `null`, returns `[]`, `linked` stays false, and every finding gets only a fallback `project → finding` edge. The "Findings column (link to their sources, hypotheses, experiments)" feature shows nothing.
- **Root cause**: No code path anywhere in the backend ever populates `research_findings.source_ids / hypothesis_ids / source_experiment_ids` or `research_hypotheses.linked_experiments`. `create_finding` inserts only title/description/confidence/category/generated_by; there is no `update_finding`. A grep of `src-tauri` finds these columns referenced only by migrations (column adds), SELECT mappings, and `strip_id_from_finding_lists` (which only *removes* ids). The schema, models, read-mappings, and delete-time scrubber all assume a writer that does not exist.
- **Impact**: Knowledge-graph provenance never connects findings to their evidence; the elaborate `strip_id_from_finding_lists` cleanup (lines 248-278, motivated by "bug-hunt 2026-06-07 research #1") is a permanent no-op. Users see an always-empty relationship view with no error — classic success-theater.
- **Fix sketch**: Either add a write path (extend `CreateResearchFinding` + an `update_finding` that sets the id-lists, and have synthesis/persona generation populate them), or document the columns as not-yet-wired and hide the finding-link edges in the graph until then.
- **Value**: impact=5 effort=5

## 3. Stale-response race on rapid project switch shows the wrong project's data
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition / wrong-results
- **File**: src/stores/slices/system/researchLabSlice.ts:134-143 (and the parallel `fetchResearchHypotheses/Experiments/Findings/Reports/Sources`); trigger src/features/plugins/research-lab/sub_literature/LiteratureSearchPanel.tsx:52-54
- **Scenario**: User selects project A (slow `listSources`), then quickly selects project B (fast `listSources`). B resolves first and `set({ researchSources })`; then A resolves and overwrites with A's sources while B is the active project. The list now shows A's sources under B.
- **Root cause**: `fetchResearchSources` (and siblings) await the IPC call and unconditionally `set()` the result with **no staleness guard** — no request token, no "is `projectId` still `activeResearchProjectId`?" check, no AbortController. The `useEffect` re-fires on every `activeProjectId` change, so overlapping in-flight fetches are expected, not exceptional.
- **Impact**: Wrong-project sources/hypotheses/experiments/findings/reports rendered after fast project switching; a delete or ingest then acts on a stale list. Silent — no error surfaces.
- **Fix sketch**: Capture a per-fetch token (or the `projectId`) and ignore the response in `set()` if `get().activeResearchProjectId !== projectId`; or store data keyed by project id.
- **Value**: impact=5 effort=3

## 4. List queries silently drop rows that fail to map (`filter_map(|r| r.ok())`)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / data-loss
- **File**: src-tauri/src/db/repos/research_lab.rs:38 (`list_projects`); same pattern at 142, 319, 424, 486, 544, 666
- **Scenario**: A single `research_*` row becomes unmappable — e.g. a future migration adds a NOT NULL column without a backfill (existing rows read NULL), an externally edited/Obsidian-synced row stores an unexpected type, or a numeric overflow vs the `i32` mapping (`run_number`, `citation_count`). `query_map` yields `Err` for that row; `filter_map(|r| r.ok())` discards it.
- **Root cause**: Every list collects with `rows.filter_map(|r| r.ok()).collect()`, swallowing per-row deserialization errors instead of propagating them. The project/source/finding simply disappears from the returned `Vec` with no error and no count discrepancy reported to the UI (the slice's `logPassiveFetchFailure` never fires because the call "succeeds").
- **Impact**: A research project/session can become invisible in the UI while still present in the DB — the user cannot see, open, or delete it, and `get_dashboard_stats` (which counts via `COUNT(*)`) disagrees with the visible list with no explanation. Likelihood is low under the current all-NOT-NULL schema, but the failure is silent and unbounded when it does occur.
- **Fix sketch**: Collect into `Result<Vec<_>, _>` and propagate the first error (or at minimum `tracing::warn!` each dropped row id) so corruption/drift surfaces instead of silently shrinking the list.
- **Value**: impact=6 effort=2

## 5. Unconstrained `status` free-text + exact-match `'complete'` sentinel makes finished projects count as "active" forever
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: undocumented-constant / semantics
- **File**: src-tauri/src/db/repos/research_lab.rs:584-588 (`active_projects`); writer at 80-101 (`update_project`); schema `status TEXT NOT NULL DEFAULT 'scoping'` (migrations/initial.rs:337)
- **Scenario**: A project's `status` is set to `"Complete"`, `"completed"`, or `"done"` (any value other than the exact lowercase literal `complete`). `get_dashboard_stats` computes `active_projects` as `COUNT(*) … WHERE status NOT IN ('complete')`, so the project is counted as active indefinitely; the dashboard "active" number never decrements.
- **Root cause**: `status` is free TEXT with no CHECK/enum and no documented taxonomy (`scoping`/.../`complete` are scattered as defaults across tables), yet a single hardcoded, case-sensitive sentinel `'complete'` drives the active/inactive split. Nothing enforces that callers use that exact token.
- **Impact**: Misleading dashboard counts; no functional corruption, but the "active vs complete" semantics are undocumented and brittle. The same opacity affects every `status`-driven badge (`sourceStatusLabel`, experiment status, etc.).
- **Fix sketch**: Define and document the allowed status values (constant/enum shared by Rust + TS), add a CHECK constraint or validate on write, and compare case-insensitively in the dashboard query.
- **Value**: impact=3 effort=3
