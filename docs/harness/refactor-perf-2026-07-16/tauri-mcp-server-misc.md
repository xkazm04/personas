# tauri:mcp_server (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 5 | Missing: 0

## 1. `personas_list` group_id filter is dead code that silently returns an empty list
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/mcp_server/tools.rs:1618
- **Scenario**: A caller passes `group_id` (advertised in the tool schema at tools.rs:710). The SELECT at tools.rs:1596-1599 never selects a `group_id` column, so every row's `p.get("group_id")` is `None` and `retain` drops ALL personas — the tool returns `[]` for any group filter.
- **Root cause**: Post-query in-memory filter references a JSON key that the row mapper never emits; the filter was likely written against an older query shape and is now unreachable-in-effect.
- **Impact**: An advertised filter parameter is silently broken — any MCP client using it gets a wrong (empty) answer with no error; the retain block is effectively dead code that masquerades as a feature.
- **Fix sketch**: Either select the real column (`SELECT ..., group_id FROM personas` — verify the column exists in the app schema) and filter in SQL with `WHERE group_id = ?`, or drop the `group_id` property from the tool's inputSchema and delete the retain block. SQL-side filtering is preferable since `enabled_only` already branches the SQL.

## 2. Duplicated HTTP-bridge plumbing across `bridge_proxy`, `scrape_bridge`, and `handle_llm_delegate`
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/mcp_server/tools.rs:1435 (also 651, 153)
- **Scenario**: `bridge_proxy` (tools.rs:1435-1466) and `scrape_bridge` (tools.rs:651-681) are near-identical: read `PERSONAS_BRIDGE_URL`/`PERSONAS_API_KEY`, build a current-thread tokio runtime, POST JSON with bearer auth, check status, return body text. `handle_llm_delegate` re-implements the runtime-build + client-build + send/status/text sequence a third time.
- **Root cause**: Each tool family grew its own copy of the "blocking HTTP call from a sync MCP handler" scaffold instead of sharing one helper.
- **Impact**: Three copies of error-message wording, timeout policy, and auth handling that can drift (e.g. only llm_delegate has a timeout; the bridges use reqwest's default of none — a hung desktop app blocks the tool forever). ~80 duplicated lines in an already 2300-line file.
- **Fix sketch**: Extract one `fn bridge_post(url: &str, api_key: Option<&str>, body: &Value, timeout: Duration) -> Result<String, String>` that owns the runtime/client/send/status logic; have `bridge_proxy`, `scrape_bridge`, and the delegate's chat POST call it. Apply a consistent timeout while consolidating.

## 3. Misplaced doc comments and an unused `pool` parameter on `list_tools`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/mcp_server/tools.rs:92 (also 645, 701)
- **Scenario**: The doc block at tools.rs:92-98 ("Offload a simple, self-contained subtask to the local delegate model…") is attached to `strip_think_blocks`, not `handle_llm_delegate`; the doc line at tools.rs:645 ("Return the list of available MCP tools with their schemas.") is attached to `scrape_bridge`. Separately, `list_tools(pool: &McpDbPool)` never uses `pool` in any build (the `cfg_attr(allow(unused_variables))` only papers over the non-scraper case; scraper builds don't use it either).
- **Root cause**: Functions were inserted between doc comments and their original targets during growth of the file; `list_tools` lost its DB usage at some refactor but kept the parameter.
- **Impact**: rustdoc/IDE hover shows the wrong documentation for two functions; the phantom parameter forces callers to thread a pool for nothing and the allow-attribute hides the smell.
- **Fix sketch**: Move each doc block onto its intended function (or delete the orphaned "Return the list…" line). Drop the `pool` parameter from `list_tools` and the `cfg_attr` allow; update the one call site in the server loop.

## 4. `obsidian_vault_search` re-reads and re-tokenizes the entire vault on every query
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: full-rescan-per-query
- **File**: src-tauri/src/mcp_server/tools.rs:1330 (vault.rs:21, vault.rs:77)
- **Scenario**: Each `obsidian_vault_search` call runs `walk_vault` — recursively reading every `.md` file's full body into memory — then `tfidf_scores` tokenizes every body and builds a document-frequency map over ALL tokens of all notes, just to score a handful of query terms. A persona doing 5 searches over a 3,000-note / 50MB vault does 5 full disk sweeps and 5 full-corpus tokenizations.
- **Root cause**: The sidecar deliberately avoids the app's index (no AppState), so search was implemented as a stateless scan with no per-process caching.
- **Impact**: Latency scales linearly with vault size per call (seconds on large vaults, plus transient memory equal to the whole vault text). Personas often issue several searches per run, multiplying the cost.
- **Fix sketch**: Cache `(NoteEntry list + per-note term-frequency maps)` in a process-level `OnceLock`/`Mutex` keyed by vault path, invalidated by a cheap staleness check (e.g. re-scan only if root mtime/newest-file changed or after a TTL of ~30s). Also restrict `doc_freq` accumulation in `tfidf_scores` to the query terms instead of every token — that alone removes the dominant hashmap churn with no caching at all.

## 5. Per-call tokio runtime + fresh reqwest Client in every bridge/delegate tool call
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: resource-churn
- **File**: src-tauri/src/mcp_server/tools.rs:1443 (also 658, 153)
- **Scenario**: Every `gmail_*`, `gdrive_*`, `gcalendar_*`, `query_dataset`, and `llm_delegate` call builds a brand-new current-thread tokio runtime and a brand-new `reqwest::Client`. A persona listing 10 Gmail messages then fetching each one constructs 11 runtimes and 11 clients, with zero connection reuse (new TCP handshake to the bridge each time; new TLS session if a remote delegate URL is configured).
- **Root cause**: Each sync handler bootstraps its own async context instead of sharing a lazily-initialized runtime/client pair.
- **Impact**: Measurable per-call overhead (runtime construction + connection setup) on the most-chained tools in the server, and it compounds with finding #2's missing timeout. Bounded, but it runs on every connector call.
- **Fix sketch**: Add a `static RT: OnceLock<tokio::runtime::Runtime>` and `static CLIENT: OnceLock<reqwest::Client>` (client built with a sane timeout), and use `RT.get_or_init(...).block_on(...)` in the shared `bridge_post` helper from finding #2. reqwest's internal pool then reuses the loopback connection across calls.

## 6. `context_neighbors` runs one prepared-from-scratch query per neighbor (N+1)
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/mcp_server/tools.rs:610
- **Scenario**: For each name in `cross_refs`, the loop calls `conn.query_row` with the same SQL text, re-preparing the statement every iteration and issuing N separate lookups while holding the pool mutex.
- **Root cause**: Per-name hydration was written as independent `query_row` calls instead of a prepared statement or a single `IN (...)` query.
- **Impact**: Bounded — cross_refs lists are typically under ~15 names — so this is prepare-overhead rather than a scaling hazard; the hallucination-flagging behavior does require knowing which names missed.
- **Fix sketch**: Prepare the statement once before the loop (`let mut stmt = conn.prepare(...)`) and call `stmt.query_row` per name; or fetch all matches with one `WHERE name IN (...)` query into a HashMap and mark absent names `resolved: false`.
