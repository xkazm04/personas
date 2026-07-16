# tauri:cloud (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Core Libraries & State | Files read: 7 | Missing: 0

## 1. Non-sargable `datetime()` wrapper forces a full table scan on every sync pass, for every synced table
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: full-table-scan
- **File**: src-tauri/src/cloud/sync/rows.rs:507
- **Scenario**: Every incremental sync pass runs `WHERE datetime({cursor_col}) > datetime(?1)` (and the resync variant adds `OR datetime(created_at) > datetime(?2)`) against ~11 tables, including append-heavy ones like `persona_events`, `persona_executions`, and `persona_messages`. Wrapping the column in `datetime()` makes the predicate non-sargable, so SQLite cannot use any index on `created_at`/`updated_at` and scans (and datetime-parses) every row of every table on every pass — even when zero rows changed.
- **Root cause**: The `datetime()` call normalizes timestamp formats defensively, but the app writes RFC3339 (`to_rfc3339()`) consistently, and RFC3339 strings with a fixed offset compare correctly lexicographically. The same pattern is repeated in `fetch_tombstones` (rows.rs:827).
- **Impact**: Sync cost grows O(total rows) instead of O(changed rows). On a long-lived install with tens of thousands of events/executions, each recurring sync pass (plus the 15s remote-command poll loop sharing the same pool) burns CPU and holds a pooled connection for a scan that should be an index seek returning nothing.
- **Fix sketch**: Compare raw strings (`WHERE {cursor_col} > ?1`) since all writers stamp RFC3339 UTC, and add indexes on the watermark columns where missing. If mixed legacy formats are a real concern, add an expression index per table (`CREATE INDEX ... ON persona_events(datetime(created_at))`) so the existing predicate becomes indexable, or do a one-time normalization migration.

## 2. Sync fetch materializes an unbounded result set in memory (no LIMIT / paging)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: unbounded-query
- **File**: src-tauri/src/cloud/sync/rows.rs:492-533
- **Scenario**: `fetch` collects every changed row into a `Vec` before the writer chunks the upload. On the first sync, full-backfill tables start at the epoch and log tables at 90 days back — a heavy user's `persona_events`/`persona_executions` window can be tens of thousands of rows, each carrying `input_data`/`output_data`/payload strings, all resident at once. The event path additionally runs AES-GCM decrypt + JSON parse + recursive redaction per row inside the same pass.
- **Root cause**: The upload side is bounded (`CHUNK = 500` in sync/client.rs:15) but the read side has no `LIMIT`/keyset paging, so memory is proportional to the whole changed set, not the chunk size.
- **Impact**: A first backfill (or a cursor reset) can spike memory by hundreds of MB and stall the pass; the observed-max-cursor design already supports resumability, so the unbounded read is unnecessary risk.
- **Fix sketch**: Add `ORDER BY {cursor_col} ASC LIMIT 500` (or 1000) to the SELECT and loop: fetch page → upsert → advance cursor to the page's max → repeat until a short page. The existing `(rows, max_cursor)` contract already fits this shape; the writer's cursor-advance logic needs no semantic change.

## 3. Four copies of the same PostgREST request/status/error boilerplate in SyncClient
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/cloud/sync/client.rs:64-164
- **Scenario**: `upsert`, `get`, `patch`, and `delete` each hand-roll the identical sequence: build request with `apikey` header + `bearer_auth(jwt)` + optional `Prefer`, send, check `status().is_success()`, read the body text, and format an `AppError::Cloud("cloud {VERB} {path} failed: {status} {body}")`. Any change (e.g. adding a timeout, retry, or a new header) must be applied in four places.
- **Root cause**: Each verb method was written independently instead of sharing a `send(method, path, prefer, body)` core the way `cloud/client.rs` does with `authed`/`send_json`/`send_ok`.
- **Impact**: ~60 lines of copy-paste; drift risk is real — the error-message verb strings and Prefer headers already vary slightly per method, and a future fix (e.g. capping the error body echo) would likely land in only some of them.
- **Fix sketch**: Extract a private `async fn send(&self, method: Method, path: &str, prefer: Option<&str>, body: Option<&impl Serialize>) -> Result<reqwest::Response, AppError>` that applies auth headers and the status/error check once; keep the four public methods as thin wrappers (upsert keeps its chunk loop, get keeps `.json()` decode).

## 4. `SURFACED` remote-command set grows for the process lifetime and is never pruned
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/cloud/remote_commands.rs:30
- **Scenario**: Every remote command surfaced to the UI inserts its id into the static `SURFACED` `HashSet`, and nothing ever removes ids — not on approve, reject, or expiry. A desktop app left running for weeks with active remote-run usage accumulates entries indefinitely.
- **Root cause**: The set exists only to de-duplicate the 15s poll's emit, but it has no eviction tied to command resolution.
- **Impact**: Bounded in practice by how many commands a user's dashboard creates, so this is slow-growth memory only — but it is a true unbounded-lifetime structure on a long-running loop.
- **Fix sketch**: Remove the id from `SURFACED` in `remote_command_approve`/`remote_command_reject` and when a poll pass expires a command; alternatively, rebuild the set each poll pass from the ids currently returned (drop any id no longer pending), which also self-heals after dashboard-side deletion.

## 5. `CloudClient::new` returns an infallible `Result` and carries a stale "30-second timeout" doc comment
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/cloud/client.rs:384-396
- **Scenario**: The constructor's doc says "The underlying `reqwest::Client` is configured with a 30-second timeout", but the body just clones `crate::SHARED_HTTP` — whatever timeout that pool has (or none) is what applies. The function also returns `Result<Self, AppError>` yet has no failure path (always `Ok`), forcing every call site to propagate an error that cannot happen.
- **Root cause**: Leftover from an earlier version that built its own `reqwest::Client::builder().timeout(...)` and could fail; the switch to the shared pool didn't update the signature or the doc.
- **Impact**: The doc actively misleads about request timeout behavior on cloud calls (relevant when debugging the runner's poll loop), and the phantom `Result` adds `?`/`map_err` noise at each construction site.
- **Fix sketch**: Change the signature to `pub fn new(base_url: String, api_key: String) -> Self`, update callers (verify cross-context call sites in commands/infrastructure), and rewrite the doc to state that the shared HTTP pool's configuration applies — or, if a 30s cap is actually intended for cloud calls, apply `.timeout()` per-request in `authed`.
