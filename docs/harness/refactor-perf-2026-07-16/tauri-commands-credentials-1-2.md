# tauri:commands/credentials [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 2 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. `blocking_lock()` on a tokio Mutex inside async KB-ingest commands (panic/thread-stall hazard)
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: blocking-in-async
- **File**: src-tauri/src/commands/credentials/vector_kb.rs:424
- **Scenario**: `spawn_ingest_job` is a sync fn called directly from the async commands `kb_ingest_files` (line 513) and `kb_ingest_directory` (line 592), i.e. on a tokio runtime worker thread. It registers the cancellation token via `ingest_jobs.blocking_lock()` — but `kb_ingest_jobs` is a `tokio::sync::Mutex` (locked with `.lock().await` at lines 181 and 451).
- **Root cause**: `tokio::sync::Mutex::blocking_lock` calls `block_on` internally, which panics when invoked from within an async execution context; even if it did not panic it would park a runtime worker thread while a delete holds the lock.
- **Impact**: Every file/directory ingestion request risks a runtime panic (command fails, ingestion never starts) or a blocked tokio worker. This is the entry point for the whole KB ingestion feature, so it is a hot path. Needs a quick runtime verification (start one ingest) — the code as written should panic per tokio's documented contract.
- **Fix sketch**: Make `spawn_ingest_job` async and use `ingest_jobs.lock().await`, or move the token registration into the spawned task before calling `ingest_files`, or switch `kb_ingest_jobs` to a `std::sync::Mutex` (all usages are short critical sections) and use plain `.lock()` everywhere.

## 2. Playwright availability check runs a blocking `npx` subprocess on the async runtime, uncached
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: blocking-in-async
- **File**: src-tauri/src/commands/credentials/auto_cred_browser.rs:1406
- **Scenario**: `check_playwright_available()` synchronously executes `npx --yes @playwright/mcp@latest --help` via `std::process::Command::status()` inside the async commands `start_auto_cred_browser` (line 717) and `check_auto_cred_playwright_available` (line 1498). `npx --yes @latest` can hit the npm registry and download the package — seconds to minutes on a cold cache or slow network.
- **Root cause**: A blocking, network-capable subprocess is spawned directly on a tokio worker thread with no `spawn_blocking`, no timeout, and no result caching; it re-runs on every session start even though the answer rarely changes within a session.
- **Impact**: One tokio worker is pinned for the full npx duration, stalling other async work (events, other IPC commands sharing the runtime); the auto-cred UI appears frozen before the session even starts. Repeated invocations pay the cost each time.
- **Fix sketch**: Wrap the probe in `tokio::task::spawn_blocking` plus a `tokio::time::timeout` (e.g. 15s), and cache the boolean in a `OnceLock`/timestamped cell (like `auth_detect`'s 5-minute cache) so `start_auto_cred_browser` and the upfront UI check share one probe per session. Consider probing `npx --version` + a local package check instead of `@latest`, which forces a registry round-trip.

## 3. Duplicated LLM-output extraction helpers across nl_query and schema_proposal
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/nl_query.rs:456
- **Scenario**: `extract_explanation` in nl_query.rs (lines 456-483) is byte-identical to `extract_explanation` in schema_proposal.rs (lines 393-420). Additionally, nl_query.rs carries its own 55-line `extract_sql_block` (lines 399-453) even though the sibling flows (schema_proposal.rs:273, query_debug.rs:333) already standardized on `ai_helpers::extract_fenced_block` — both files even contain the comment "code block extraction tests have moved to engine::ai_helpers::tests".
- **Root cause**: The fenced-block extraction was consolidated into `engine::ai_helpers`, but the explanation extractor and nl_query's SQL extractor were left behind in the command modules.
- **Impact**: Three near-copies of the same markdown-parsing logic drift independently — a fix to one (e.g. unclosed-block handling, new dialect tags) silently misses the others.
- **Fix sketch**: Move `extract_explanation` into `engine::ai_helpers` and call it from both files. Extend `ai_helpers::extract_fenced_block` (or add a tag-list variant) to cover nl_query's multi-dialect preference ("sql", "sqlite", "mysql", "postgres", untagged fallback), then delete the local `extract_sql_block`.

## 4. Sequential per-table column introspection when building NL-query schema context (N+1)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/commands/credentials/nl_query.rs:357
- **Scenario**: `build_db_schema_context` calls `db_query::introspect_columns(...)` once per table in a sequential `for` loop with an `.await` per iteration. Against a remote database (Supabase/Neon/PlanetScale are first-class here), a schema with 50-100 tables costs 50-100 network round-trips before the AI prompt is even built — every NL-query run pays it.
- **Root cause**: Column introspection is issued table-by-table instead of one bulk query (e.g. `information_schema.columns` for the whole schema) or concurrent requests.
- **Impact**: Multi-second "Analyzing your question..." stalls proportional to table count and network latency; the identical pattern presumably lives in `ai_helpers::build_schema_context` used by query_debug/schema_proposal, so a shared fix pays off three times.
- **Fix sketch**: Add a bulk `introspect_all_columns` in `engine::db_query` that fetches `table_name, column_name, data_type` for every table in one query and group in memory; where a driver cannot do bulk, run the per-table calls concurrently with `futures::stream::iter(...).buffer_unordered(8)`. Optionally cap the context at N tables to bound prompt size.

## 5. Double deep-clone of selected endpoints in `openapi_generate_connector`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/commands/credentials/openapi_autopilot.rs:725
- **Scenario**: `generate_tool_definitions(&endpoints.iter().cloned().cloned().collect::<Vec<_>>())` and the identical expression on line 727 for `find_healthcheck_endpoint` each materialize a full owned `Vec<OpenApiEndpoint>` (every path, parameter list, description string cloned) from the `Vec<&OpenApiEndpoint>` selection — twice, back to back.
- **Root cause**: The two helpers take `&[OpenApiEndpoint]` while the selection filter produces `Vec<&OpenApiEndpoint>`, so the call sites bridge with the awkward `.cloned().cloned()` double-deref-clone instead of adjusting a signature.
- **Impact**: Bounded but pointless allocation on large specs (hundreds of endpoints × parameter vectors), and the `.cloned().cloned()` idiom is a readability trap that invites copy-paste. One-shot command path, so cost is modest — this is primarily a cleanliness fix.
- **Fix sketch**: Clone once into a local `let selected: Vec<OpenApiEndpoint> = ...` and pass `&selected` to both helpers, or change the helpers to accept `&[&OpenApiEndpoint]` / `impl Iterator<Item = &OpenApiEndpoint>` and drop the clones entirely.

## 6. Duplicated field-description prompt builders and a stale timeout message in auto_cred_browser
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/auto_cred_browser.rs:351
- **Scenario**: `build_browser_prompt` (lines 351-367) and `build_guided_prompt` (lines 441-456) contain an identical 16-line `fields_desc` mapping closure (key/label/REQUIRED/placeholder/help_text formatting). Separately, the timeout error guidance at line 1100 says "The browser session exceeded 5 minutes" while `BROWSER_TIMEOUT_SECS`/`GUIDED_TIMEOUT_SECS` are 600s (10 minutes, per the constants' own doc comments).
- **Root cause**: The prompt builders were forked for guided mode without extracting the shared field-rendering; the timeout constant was later doubled without updating the user-facing string.
- **Impact**: Field-format changes must be made twice or the two modes drift; the stale "5 minutes" message actively misinforms users diagnosing a timed-out session.
- **Fix sketch**: Extract `fn describe_fields(fields: &[AutoCredField]) -> String` and call it from both builders. Replace the hardcoded "5 minutes" with a string formatted from `BROWSER_TIMEOUT_SECS / 60` so the message can never drift again.
