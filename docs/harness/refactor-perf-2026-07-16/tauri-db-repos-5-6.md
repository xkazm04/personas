# tauri:db/repos [5/6] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Hand-rolled duplicate row mappers in artist/ocr/signing repos ignore the repo-wide `row_mapper!` convention
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/resources/artist.rs:45 (also ocr.rs:28/54, signing.rs:39/65)
- **Scenario**: Each of these three files contains the same 11–12 column struct-mapping closure written out twice (once in `list_*`, once in `get_*`), while sibling repos in the same context (test_suites.rs:9, saved_views.rs:9, webhook_log.rs:12, policy_events.rs:9) use the shared `row_mapper!` macro with `SELECT *`. Adding a column to `artist_assets`/`ocr_documents`/`document_signatures` requires editing 2 SQL strings + 2 mapping closures per file, and a missed index shift silently maps the wrong column.
- **Root cause**: These repos predate (or ignored) the `row_mapper!` + `collect_rows` utilities the rest of `db/repos` standardized on.
- **Impact**: ~120 lines of pure duplication across three files and a real column-drift hazard on schema changes; inconsistent style makes the repo layer harder to scan.
- **Fix sketch**: Define one `row_mapper!(row_to_asset -> ArtistAsset { ... })` (and equivalents for `OcrDocument`, `DocumentSignature`) per file, switch queries to named-column or `SELECT *` form matching the macro, and reuse the mapper in both list and get. Mirrors exactly what test_suites.rs already does.

## 2. `versions.rs` swallows DB errors — `.unwrap_or(1)` can mint a duplicate version_number, `filter_map(r.ok())` drops corrupt rows silently
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: error-swallowing
- **File**: src-tauri/src/db/repos/lab/versions.rs:16
- **Scenario**: If the `MAX(version_number)+1` query fails transiently (pool contention, locked DB), `.unwrap_or(1)` inserts the snapshot as version 1 even when versions 1..N already exist — the history list (`ORDER BY version_number DESC`) then shows a brand-new snapshot as the oldest version. Similarly `get_versions` (line 66) uses `.filter_map(|r| r.ok())`, so a row that fails to map simply vanishes from the version list with no error, and `get_version_tool_count` (line 85) returns 0 on any DB error.
- **Root cause**: Error paths were papered over with `unwrap_or`/`filter_map(ok)` instead of propagating, and every rusqlite error is blanket-wrapped into `AppError::Internal(e.to_string())` instead of the `AppError::Database` variant used everywhere else in this directory.
- **Impact**: Wrong version numbering under rare-but-real failure conditions, invisible data loss in listings, and loss of the structured Database error variant for diagnostics.
- **Fix sketch**: Replace `.unwrap_or(1)` with `?` propagation; replace `.filter_map(|r| r.ok())` with `.collect::<Result<Vec<_>,_>>()?` (or `collect_rows` if lossy-with-logging is intended); drop the `map_err(Internal)` wrappers in favor of the file-standard `AppError::Database` conversion. Also worth wrapping the create_version triple (insert version, insert tools, read-back) in one transaction while there.

## 3. `traces.rs` duplicates the ExecutionTrace row-mapping closure in two queries
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/execution/traces.rs:49
- **Scenario**: `get_by_execution_id` (lines 49–63) and `get_by_chain_trace_id` (lines 112–128) contain byte-identical 15-line mapping closures (spans JSON parse, duration cast, evicted default). A future column addition must be applied in two places or the two read paths diverge.
- **Root cause**: Closure written inline twice instead of extracted, unlike the `map_row`/`row_to_*` helper pattern used by every other file in this context.
- **Impact**: Maintenance-only; no runtime cost.
- **Fix sketch**: Extract `fn row_to_trace(row: &rusqlite::Row) -> rusqlite::Result<ExecutionTrace>` and pass it to both `query_row` and `query_map`, matching `row_to_record` in run_budget.rs.

## 4. `ocr::list_documents` ships full `extracted_text` + `structured_data` blobs for every document, unbounded
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src-tauri/src/db/repos/resources/ocr.rs:21
- **Scenario**: The listing query has no LIMIT and selects `extracted_text`, `structured_data`, and `prompt` — the largest columns in the table (full OCR output of a document can be tens/hundreds of KB each). A user with a few hundred processed documents pays for materializing every blob into a Vec and serializing it across the Tauri IPC boundary every time a list view opens, when the list UI needs only file name/provider/timestamps.
- **Root cause**: Get-by-id and list share one column set; no summary projection was carved out for the listing path.
- **Impact**: List latency and memory grow linearly with total OCR corpus size (rows × blob size), on a path that runs on every visit to the OCR screen; the detail fetch (`get_document`) already exists to load the heavy fields.
- **Fix sketch**: Change `list_documents` to select metadata only (id, file_name, file_path, provider, model, duration_ms, token_count, created_at — plus e.g. `length(extracted_text)` if the UI shows size) into a lighter summary struct, and add a sane `LIMIT`/pagination. Detail panel keeps using `get_document`. Verify the frontend list component's actual field usage first.

## 5. `webhook_log` cap enforcement uses a single global counter — low-traffic triggers can grow past the 100-row cap indefinitely
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: unbounded-growth
- **File**: src-tauri/src/db/repos/resources/webhook_log.rs:74
- **Scenario**: The prune DELETE fires only when the process-global `INSERT_COUNTER % 10 == 0`, and it prunes only the trigger of *that* insert. With several active triggers interleaving, a given trigger's inserts may rarely (or, with an unlucky periodic pattern, never) land on a multiple of 10, so its log accumulates far beyond 100 rows. The counter also resets to 0 on every app restart, further decoupling prune frequency from per-trigger volume.
- **Root cause**: The amortization key (global insert count) does not match the cap's scope (per trigger).
- **Impact**: Table grows unbounded on disk for unlucky triggers; reads stay bounded by the LIMIT 100, so this is storage + prune-DELETE-cost creep rather than user-visible slowdown, but it defeats the cap's stated contract. The DELETE's `id NOT IN (subselect)` also gets slower the more backlog accumulates.
- **Fix sketch**: Key the amortization per trigger (e.g. `static COUNTERS: Mutex<HashMap<String, u32>>` or a small DashMap), or make it deterministic and cheap: run the prune when `rowid % 10 == 0`-style sampling per trigger, or simply always prune but with an indexed cutoff (`DELETE ... WHERE received_at < (SELECT received_at ... ORDER BY received_at DESC LIMIT 1 OFFSET 100)`), which is a no-op scan when under cap.

## 6. `insert_events_batch` clones every payload string before truncating
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: allocation
- **File**: src-tauri/src/db/repos/lab/events.rs:77
- **Scenario**: For each event the batch insert calls `truncate_preview(ev.tool_args_preview.clone())` (×3 fields). When an upstream tool result is large (the whole reason PAYLOAD_PREVIEW_BYTES exists), the full untruncated string is cloned only for all but 2KB of the copy to be thrown away — per field, per event, for the whole batch.
- **Root cause**: `truncate_preview` takes `Option<String>` by value, forcing a full clone even though only the first 2KB is kept.
- **Impact**: Bounded per run but pure waste on the lab-run hot path (a scenario with many events and chatty tools does N×3 needless large allocations inside a write transaction).
- **Fix sketch**: Make the helper borrow: `fn preview(s: Option<&str>) -> Option<Cow<'_, str>>` that returns a slice up to a char boundary near 2048 bytes plus the suffix only when truncation occurs, and bind params from that. Note `v.truncate(2048)` can also panic mid-UTF-8 char today — slicing on `floor_char_boundary`-style logic fixes both.
