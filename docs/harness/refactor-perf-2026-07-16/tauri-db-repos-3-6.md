# tauri:db/repos [3/6] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 3 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Index-defeating `datetime()`/`strftime()` wrappers on `created_at` in team_channel queries
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: index-defeating-query
- **File**: src-tauri/src/db/repos/communication/team_channel.rs:88-92 (also 111-115, 169-175)
- **Scenario**: `list_injectable_for_persona` runs at every orchestrator step boundary and `list_for_team` backs the channel read-model UI. Both wrap `created_at` in per-row SQL functions: `strftime('%Y-%m-%dT%H:%M:%SZ', datetime(created_at)) < ?2`, `datetime(created_at) > datetime('now','-14 days')`, and `ORDER BY datetime(created_at) DESC`.
- **Root cause**: Applying a function to the column in WHERE/ORDER BY prevents SQLite from using any index on `created_at` (or `(team_id, created_at)`); every row for the team is materialized, has two function calls applied, and is sorted in a temp b-tree.
- **Impact**: `team_channel_messages` is append-only and grows without bound; the hottest read (per persona, per step) degrades linearly with total channel history instead of being a LIMIT-bounded index scan.
- **Fix sketch**: Rows are inserted with `datetime('now')`, so `created_at` is already a lexically sortable `YYYY-MM-DD HH:MM:SS` string. Compare and order on the raw column (`created_at < ?2`, `ORDER BY created_at DESC, id DESC`), normalizing the cursor/cutoff once on the parameter side (`datetime(?2)` / `datetime('now','-14 days')` applied to the constant, not the column). Ensure an index on `(team_id, created_at)` exists.

## 2. Row-mapping errors silently dropped via `filter_map(|r| r.ok())` — duplicated anti-pattern where `collect_rows` already exists
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/communication/smee_relays.rs:61 (also 205, 230; lab/ratings.rs:68; resources/oauth_token_metrics.rs:81)
- **Scenario**: If one row fails mapping (schema drift, NULL in a newly non-null field), it silently vanishes from `smee_relays::list`, `list_active_urls`, `list_active_configs`, `ratings::get_ratings_for_run`, and `oauth_token_metrics::get_by_credential` — e.g. an active relay simply stops being started by the relay engine with no error anywhere.
- **Root cause**: Five call sites hand-roll `.filter_map(|r| r.ok())` while the codebase already standardized on either `collect::<Result<Vec<_>,_>>().map_err(AppError::Database)` (most repos in this context) or the `collect_rows(rows, tag)` helper in `db::repos::utils` (used by build_sessions, chat) which at least logs skipped rows.
- **Impact**: Inconsistent error contract across the repo layer plus invisible data loss on read; the `list_active_urls`/`list_active_configs` cases feed the relay engine, so a dropped row means a webhook relay silently never connects.
- **Fix sketch**: Replace the five `filter_map(|r| r.ok())` sites with `collect_rows(rows, "…")` (logging variant) or strict `collect::<Result<Vec<_>,_>>()?` to match the rest of this directory. Mechanical, ~5 lines each.

## 3. `chat::list_sessions` runs a correlated COUNT(*) subquery per session (N+1)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/db/repos/communication/chat.rs:57-70
- **Scenario**: Opening a persona's chat/session list executes the outer query plus up to 50 correlated `SELECT COUNT(*) FROM chat_messages WHERE session_id = … AND persona_id = …` scans — one per returned session, re-counting full message history each render.
- **Root cause**: The comment says the correlated subquery was chosen over a GROUP BY, but SQLite still executes the COUNT once per output row, and each COUNT walks every message of that session (long-lived sessions can hold thousands of rows; the per-session fetch itself caps at 200 but the count does not).
- **Impact**: Session-list latency grows with total message volume of the 50 most recent sessions; on a chat-heavy install this is a repeated multi-thousand-row scan on a UI hot path.
- **Fix sketch**: Replace the correlated subquery with a single LEFT JOIN against a pre-aggregated derived table: `LEFT JOIN (SELECT session_id, persona_id, COUNT(*) c FROM chat_messages WHERE persona_id = ?1 GROUP BY session_id) mc ON …` — one pass over the persona's messages instead of 50. Alternatively maintain a `message_count` column on `chat_session_context` bumped in `chat::create`.

## 4. `team_channel::record_delivery` re-implements append-to-JSON-array as a racy read-modify-write; atomic pattern already exists in build_sessions
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/resources/team_channel.rs:187-225
- **Scenario**: Two personas hitting a step boundary concurrently both read `deliveries`, both append, and the second UPDATE overwrites the first receipt; the idempotence check also races (same step+persona delivered twice records twice).
- **Root cause**: The repo does SELECT → parse JSON in Rust → push → UPDATE, while `build_sessions::append_phase_timing` (same directory tree) already solved the identical "append one entry to a JSON-array column" problem with a single atomic `json_insert(COALESCE(col,'[]'), '$[#]', json(?))` UPDATE and documents why.
- **Impact**: Duplicate/lost delivery receipts under concurrency, plus two round-trips where one suffices; two divergent idioms for the same concern make the next JSON-array column likely to copy the wrong one.
- **Fix sketch**: Collapse to one UPDATE using `json_insert` guarded by a NOT EXISTS on `json_each(deliveries)` matching step_id+persona_id (all in SQL), mirroring `append_phase_timing`. Optionally extract a shared `append_json_array_entry` helper in `repos/utils`.

## 5. `owned_devices.rs` re-implements rusqlite's `OptionalExtension` as a private trait
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/repos/resources/owned_devices.rs:154-177
- **Scenario**: Anyone maintaining this file must understand two bespoke traits (`OptionalRow`, `OptionalFlatten`) that exist nowhere else in the repo layer; sibling repos (identity.rs, memory_review_proposal.rs) already import `rusqlite::OptionalExtension` for the same behavior.
- **Root cause**: A local trait duplicating library functionality was added instead of the standard `use rusqlite::OptionalExtension`; `OptionalFlatten` additionally swallows real DB errors via `.ok()` (an error on the fast-path SELECT is treated as "no group id yet").
- **Impact**: ~25 lines of redundant abstraction and one error-swallowing path; purely local, no cross-context callers (both traits are private).
- **Fix sketch**: Delete both traits, `use rusqlite::OptionalExtension`, and replace `optional_flatten()` with `.optional()?.flatten()` so genuine DB errors propagate instead of being read as `None`.
