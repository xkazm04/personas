# Test Mastery — Research Lab
> Total: 7 findings (1 critical, 3 high, 2 medium, 1 low)

Context: the "Research Lab" plugin lets users run multi-source research projects (literature, hypotheses, experiments, findings, reports) and mirror them to an Obsidian vault. The data layer is `src-tauri/src/db/repos/research_lab.rs` + the command layer `src-tauri/src/commands/infrastructure/research_lab.rs`; the front end is thin React panels plus three pure helper modules (`graphLayout.ts`, `compileReport.ts`, `parseHypotheses.ts`, `arxivClient.ts`). **No test currently exists anywhere for this context** — neither a `#[cfg(test)]` module in either Rust file, nor a `*.test.ts` beside any helper. Meanwhile the repo layer already has an established, easy in-memory test harness (`crate::db::init_test_db()`, used by 30+ sibling repos and `test_fixtures.rs`), so the absence of tests here is a gap, not an infrastructure limitation.

Note on paths: the manifest lists `src/api/researchLab/index.ts`, but the real file in this checkout is `src/api/researchLab/researchLab.ts`. Findings reference the real path.

## 1. Experiment-run sequencing CAS has no regression test
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/research_lab.rs:668-705 (`create_experiment_run`)
- **Current test state**: none
- **Scenario**: `create_experiment_run` computes `run_number = MAX(run_number)+1` and INSERTs it inside a `BEGIN IMMEDIATE` transaction specifically so two concurrent runs (double-click, or engine + manual run) cannot both read the same MAX and write a duplicate `run_number`. The inline comment even cites the original bug (bug-hunt 2026-06-07 research #2). A future refactor that drops `transaction_with_behavior(Immediate)`, reuses `pool.get()` for the read and the write, or reorders the SELECT/INSERT would silently reintroduce duplicate run numbers — and nothing would fail.
- **Root cause**: the concurrency invariant lives only in a comment; there is no test asserting (a) sequential numbering 1,2,3 for serial calls, and (b) that N concurrent calls on the same experiment produce N distinct, contiguous run_numbers.
- **Impact**: duplicated `run_number`s corrupt the experiment-run history that the Obsidian sync renders ("Run 2", "Run 2") and that the runs drawer lists; lost/overwritten observations in a research log are silent data loss in the product's core value loop.
- **Fix sketch**: add a `#[cfg(test)]` module using `crate::db::init_test_db()`. Test 1 (serial): create project+experiment, call `create_experiment_run` 3x, assert run_numbers == [1,2,3]. Test 2 (concurrency): spawn N threads sharing the same pool (an `r2d2`/Arc pool clone) each calling `create_experiment_run` on one experiment; collect results and assert the set of run_numbers has no duplicates and equals 1..=N. Invariant: **run_number is unique and gapless per experiment under concurrency**.

## 2. Source dedup guard (DOI/URL) is untested — duplicate-paper invariant unprotected
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/research_lab.rs:172-239 (`create_source`)
- **Current test state**: none
- **Scenario**: `create_source` is supposed to be idempotent on a normalized DOI (case-insensitive + trimmed), falling back to a normalized URL when there's no DOI, returning the existing row instead of inserting a duplicate. A regression in the normalization (e.g. dropping `lower(trim(...))`, or matching across projects instead of within `project_id`) would either re-duplicate papers or, worse, collapse two different projects' sources together. None of this is asserted.
- **Root cause**: the dedup branch logic (DOI present → DOI match; DOI absent → URL match; both absent → always insert) has four paths and a normalization contract, all verified only by reading the SQL.
- **Impact**: duplicate sources inflate `total_sources` dashboard stats and the literature list, and break citation keys in compiled reports; cross-project collapse would leak one project's sources into another.
- **Fix sketch**: repo test module. Cases: (a) same DOI with different casing/whitespace → second `create_source` returns the first row's id, list_sources length stays 1; (b) no DOI, same URL normalized → dedups; (c) same DOI in a *different* project → both inserted (no cross-project collapse); (d) neither DOI nor URL → always a new row. Invariant: **within one project a source is unique by normalized DOI, else normalized URL; never deduped across projects**.

## 3. `strip_id_from_finding_lists` cascade-scrub on delete is untested
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/db/repos/research_lab.rs:247-286, 386-393, 449-456 (`strip_id_from_finding_lists` + the three delete callers)
- **Current test state**: none
- **Scenario**: findings store denormalized JSON id-lists (`source_ids`, `hypothesis_ids`, `source_experiment_ids`) that SQLite's FK cascade can't reach. When a source/hypothesis/experiment is deleted, this helper removes the dangling id from every finding's JSON list, inside the same transaction as the delete. The comment cites bug-hunt 2026-06-07 research #1 ("broken citations or crash a later dereference"). A regression — wrong column name passed, JSON re-encode skipped, the LIKE prefilter mismatching — would leave dangling ids that crash `buildGraph`/report dereferences. Nothing asserts the scrub happens or that it's atomic with the delete.
- **Root cause**: three call sites each pass a hardcoded column constant; correctness depends on (a) the right column being scrubbed per entity type, (b) only the deleted id being removed (siblings preserved), (c) non-array / non-matching JSON left untouched, (d) commit atomicity.
- **Impact**: dangling references in findings produce broken citations in compiled reports and can crash the knowledge graph render (`parseJsonIdList` survives, but downstream edge targets point at deleted nodes).
- **Fix sketch**: repo test. Create project, 2 sources, a finding whose `source_ids` = `["s1","s2"]`; `delete_source("s1")`; assert the finding's `source_ids` == `["s2"]` (sibling kept) and that a finding referencing only `s1` ends with `[]` not a dangling id. Repeat per delete kind (hypothesis_ids, source_experiment_ids). Add a negative case: a finding with malformed JSON in the column is left byte-for-byte unchanged. Invariant: **deleting an entity removes exactly its id from finding id-lists, preserves siblings, and is atomic with the row delete**.

## 4. Pure report/graph/parse helpers have zero tests — prime LLM-generatable batch
- **Severity**: high
- **Category**: llm-generatable
- **File**: src/features/plugins/research-lab/sub_reports/compileReport.ts:24-239; sub_graph/graphLayout.ts:59-214; sub_hypotheses/parseHypotheses.ts:6-53
- **Current test state**: none
- **Scenario**: these are deterministic, dependency-light pure functions that drive user-visible output (the exported report markdown, the knowledge-graph node/edge wiring, and the parsing of LLM hypothesis output into discrete statements). `parseHypothesesOutput` in particular has four input shapes (JSON array, numbered/bulleted list, blank-line split, dedup) and is the seam between raw LLM text and persisted hypotheses — a mis-parse silently drops or merges hypotheses.
- **Root cause**: no `*.test.ts` beside them; vitest is configured (`vitest.config.ts`, `include: src/**/*.test.{ts,tsx}`) so a generated batch drops straight in.
- **Impact**: regressions here corrupt exported research artifacts (the product's deliverable) and the graph users navigate by, with no signal.
- **Fix sketch**: an LLM-generatable batch (one `*.test.ts` per file). Assert *business invariants*, not snapshots:
  - `parseHypothesesOutput`: JSON array of objects with `statement` → those statements; numbered/bulleted list → one entry per item; near-duplicate lines (case/first-80-char) collapse to one; empty/whitespace → `[]`; non-list prose lines under length 10 are dropped. Invariant: **every distinct hypothesis statement survives exactly once; noise is dropped**.
  - `compileReport`: each `reportType` routes to its template and unknown type falls back to `full_paper`; `executive_summary` Top Findings are sorted by confidence desc and capped at 5; empty collections render the `_No …_` stubs (no crash on empty project). Invariant: **report type → correct sections; findings ranked by confidence; empty inputs degrade gracefully**.
  - `buildGraph`: an experiment with `hypothesisId` links to that hypothesis ("tests" edge) else to project; a finding with parsed `sourceExperimentIds` links to experiments else falls back to a project edge; `visible` flags gate node/edge emission; malformed JSON id-lists yield no edges (not a throw). Invariant: **edges reflect real parent links and respect visibility; bad JSON never throws**.

## 5. arXiv Atom-feed parsing & error-kind classification untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src/features/plugins/research-lab/sub_literature/arxivClient.ts:53-162
- **Current test state**: none
- **Scenario**: `parseAtomFeed` distinguishes a real empty result from arXiv's HTTP-200 "error" Atom feed (single entry pointing at `/api/errors`) and throws `ArxivSearchError('feed', …)` for the latter; it also extracts DOI from a namespaced tag, strips the version suffix from ids, and picks pdf/abs links. `searchArxiv` maps timeout vs. caller-abort vs. network vs. http into distinct `ArxivErrorKind`s the UI relies on. A regression that treats the error feed as "0 results" would silently hide that the query was rejected.
- **Root cause**: XML parsing + error-kind mapping is logic, but it's only exercised by live network calls today (none mocked); `DOMParser` is available under the jsdom test env already configured.
- **Impact**: users see "no papers found" when arXiv actually rejected the query (rate-limit/error), eroding trust in literature search; mis-classified errors surface the wrong actionable message.
- **Fix sketch**: vitest with canned XML strings (no network): (a) a normal multi-entry feed → correct count, id without `vN`, comma-joined authors, parsed year, DOI when present/null when absent; (b) the single error-entry feed → throws `ArxivSearchError` with `kind === 'feed'`; (c) a `parsererror` document → `kind === 'parse'`; (d) a truly empty feed → `[]`. For `searchArxiv`, stub `fetch`: non-ok status → `kind:'http'` with `.status`; an aborted caller signal → re-throws the AbortError; the internal timeout firing → `kind:'timeout'`. Invariant: **an error feed is never silently rendered as zero results, and each failure mode maps to its declared ArxivErrorKind**.

## 6. Obsidian daily-note append/dedup logic has no test for its concurrency + idempotency contract
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/infrastructure/research_lab.rs:355-443 (`research_lab_sync_daily_note`), 478-490 (`slug`)
- **Current test state**: none
- **Scenario**: `sync_daily_note` is guarded by a process-wide `daily_note_lock()` mutex and a marker check (`existing.contains(&marker)`) so two near-simultaneous syncs can't double-append today's check-in to the shared daily note. It also early-returns when there are no active experiments and resolves the vault two different ways (mirror vs. legacy). The `slug` helper (lowercase, non-alphanumeric→`-`, trim dashes) builds the note file path. None of this is asserted; the marker-dedup is exactly the kind of string-matching that breaks on a format tweak.
- **Root cause**: the command function is hard to unit-test directly (needs `State`/vault FS), but the two testable units — `slug` and the marker-idempotency rule — are reachable. `slug` is a free fn that can take a `#[cfg(test)]` directly; the marker/append decision can be extracted to a pure helper to make it testable.
- **Impact**: a broken marker check duplicates research check-ins in the user's Obsidian daily note on every sync; a `slug` regression collides distinct experiments onto one note path, overwriting research notes.
- **Fix sketch**: (a) `#[cfg(test)]` for `slug`: `"My Exp / v2!"` → `my-exp---v2` (and assert leading/trailing dashes trimmed, unicode alphanumerics handled). Invariant: **slug is lowercase, path-safe, and stable for the same name**. (b) Extract the "given existing content + marker, should we append and what content results" decision into a pure fn and test: existing already contains marker → no change; empty file → frontmatter + section; non-empty without marker → appended once. Invariant: **today's check-in is appended at most once per day per project**.

## 7. No quality gate / new-code ratchet pins these repo invariants once added
- **Severity**: low
- **Category**: quality-gate
- **File**: src-tauri/src/db/repos/research_lab.rs (whole file); vitest.config.ts:17 (include globs)
- **Current test state**: none
- **Scenario**: even after findings 1-3 add Rust tests, nothing keeps them from being deleted or keeps new repo functions (e.g. a future `create_citation`) test-free. Sibling repos demonstrate the convention (`#[cfg(test)]` in 30+ files) but it's enforced by habit, not a gate.
- **Root cause**: there is no per-area coverage threshold or new-code ratchet for `db/repos`, and the TS vitest config has no coverage thresholds at all.
- **Impact**: the concurrency/dedup/cascade protections (each tied to a prior production bug) can silently lose their tests in a refactor, re-opening those bugs.
- **Fix sketch**: lightweight, non-bypassable: add a `cargo test` invocation for `db::repos::research_lab` to CI once tests exist, and consider an advisory `--lib` coverage report (cargo-llvm-cov) gating only *new* code in `db/repos/**` (new-code ratchet, not a backfill mandate). On the TS side, enable `coverage` with a low global floor and a per-file threshold on the three pure helpers in finding 4 so they can't regress to 0%. Keep gates advisory-then-blocking to avoid bypass.
