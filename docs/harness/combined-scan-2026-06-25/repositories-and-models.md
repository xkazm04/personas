# Repositories & Models — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: repositories-and-models | Group: Data & Persistence
> Total: 5 | Critical: 0 | High: 1 | Medium: 4

## 1. Idempotency check-then-insert is a TOCTOU race; concurrent same-key creates hard-error instead of deduping
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race condition
- **File**: src-tauri/src/db/repos/execution/executions.rs:435
- **Scenario**: `create_with_idempotency` does `get_by_idempotency_key(...)` (line 436) and, only if it returns `None`, runs the `INSERT` (lines 450-465). Two calls with the same key racing (e.g. the Discord poller's deterministic `discord:{channel}:{msg.id}` key in `engine/discord_poller.rs:239`, a timeout-retry, or a double-delivered webhook) can both observe `None`, then both attempt the INSERT. The column has a `CREATE UNIQUE INDEX ... idx_pe_idempotency ... WHERE idempotency_key IS NOT NULL` (migrations/incremental.rs:1932), so the loser's INSERT fails with a UNIQUE-constraint error returned as `AppError::Database(...)`.
- **Root cause**: Read and write are not atomic and there is no conflict handling on the INSERT; the unique index turns the lost race into an error rather than the intended dedup.
- **Impact**: The documented guarantee ("Returning existing execution for idempotency key (dedup)") is violated under exactly the concurrency it exists to absorb. A legitimately-idempotent retry/redelivery surfaces a spurious DB error (failed user action / noisy poller error) instead of returning the existing row. No duplicate rows (index prevents that), so no corruption — but the operation fails.
- **Fix sketch**: Make it insert-first: `INSERT ... ON CONFLICT(idempotency_key) DO NOTHING`, then if `rows_changed == 0` re-`get_by_idempotency_key` and return that row. Or catch `SqliteFailure(.. ConstraintViolation ..)` from the INSERT and fall back to the existing-row lookup.
- **Value**: impact=7 effort=2

## 2. `count_all_global` buckets the obsolete `"pending"` string but not the live `"queued"` status — Running badge undercounts every new run
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: wrong status mapping / silent miscount
- **File**: src-tauri/src/db/repos/execution/executions.rs:302
- **Scenario**: The match arms are `"running" | "pending" => running`, `"completed" => completed`, `"failed" => failed`, `_ => {}`. But executions are created with status `'queued'` (line 453), and the canonical `ExecutionState::Queued` serialises to `"queued"` (engine/types.rs:25); `"pending"` is only a backwards-compat alias for old rows (types.rs:34). So a freshly created/enqueued execution counts toward `total` but lands in **no** bucket.
- **Root cause**: The bucket mapping was written against the legacy `"pending"` string and never updated for the `queued` rename, even though the struct doc claims "running includes both running and pending — the UI bucket is Running."
- **Impact**: The Activity filter "Running" badge undercounts by the number of queued-but-not-yet-running executions; the badges no longer sum to `total`, and a just-submitted run appears to vanish from the Running view until it flips to `running`. Affects every execution at creation time (high frequency).
- **Fix sketch**: Add `"queued"` to the running arm: `"running" | "pending" | "queued" => counts.running += n`. Audit `cancelled`/`incomplete`/`timeout` for whether they also need surfacing.
- **Value**: impact=5 effort=1

## 3. Memory-review proposal row mapper swallows corrupt `proposal_json` into empty entries — apply silently no-ops while reporting success
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent failure / row mapped wrong
- **File**: src-tauri/src/db/repos/core/memory_review_proposal.rs:195
- **Scenario**: `map_row` does `let entries: Vec<ProposalEntry> = serde_json::from_str(&entries_json).unwrap_or_default();`. If `proposal_json` is malformed or schema-drifted (a field rename in `ProposalEntry`, partial write, manual DB edit), the row maps to an **empty** `entries` vec while `reviewed_count` / `proposed_changes` (separate columns, lines 196-204) still read non-zero. The proposal renders as "N proposed changes" but with zero actionable entries; the apply path iterates the (empty) entries, mutates nothing, then `mark_applied` (line 168) flips the row to `'applied'`.
- **Root cause**: The authoritative entries column is decoded with `unwrap_or_default()`, hiding deserialization failure instead of surfacing it.
- **Impact**: A curation batch the user "applies" silently does nothing to the live `persona_memories` rows yet reports success, and the proposal can never be retried because its status is now terminal. Loss of an intended data-mutation operation with false positive confirmation.
- **Fix sketch**: Propagate the parse error (`serde_json::from_str(...).map_err(|e| rusqlite::Error::FromSqlConversionFailure(...))?`) or, at minimum, `tracing::error!` with the proposal id + raw snippet and skip/flag the row so an empty-entries proposal can't be silently applied.
- **Value**: impact=6 effort=2

## 4. Ops-chat executions are partitioned by a substring `LIKE '%"_ops"%'` on `input_data` — a false positive silently hides real runs from every list and count
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: fragile data contract / silent omission
- **File**: src-tauri/src/db/repos/execution/executions.rs:124
- **Scenario**: Every execution list/count filters with `(input_data IS NULL OR input_data NOT LIKE '%"_ops"%')` — see lines 124, 164, 200, 278, 342. The "is this a conversational ops-chat row?" distinction is inferred by sniffing for the literal substring `"_ops"` (with quotes) anywhere in the free-text `input_data` JSON. A genuine agent execution whose input happens to contain that substring (e.g. a field named `"my_ops"`, embedded code/JSON, or a prompt mentioning `"_ops"`) is silently excluded from `get_by_persona_id`, `get_all_global`, `count_all_global`, and `search`.
- **Root cause**: Ops-chat membership is a content heuristic rather than a typed column/flag — unlike the sibling `is_simulation`, which got a real column. The contract is undocumented and order-dependent on input formatting.
- **Impact**: Silent under-reporting: affected real executions disappear from the activity feed and are undercounted in the status badges, with no error. Also a minor perf cost (non-sargable leading-wildcard LIKE on every list query).
- **Fix sketch**: Add an `is_ops_chat` (or `kind`) boolean column written at insert time, backfill it once from the current substring rule, and filter on the column. Removes both the false-positive risk and the full-scan LIKE.
- **Value**: impact=5 effort=3

## 5. Credential `metadata` has two un-coordinated writer styles (non-transactional `json_set` vs whole-blob DEFERRED read-modify-write) — concurrent writers lose updates or throw SQLITE_BUSY
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: concurrent write race / undocumented transaction contract
- **File**: src-tauri/src/db/repos/resources/credentials.rs:866
- **Scenario**: `record_usage` (line 866) updates `metadata` with an in-place, non-transactional single-statement `json_set(...)` that bypasses `sanitize_ledger_json`. Meanwhile `update_ledger` (942), `append_healthcheck_metadata` (797), `increment_refresh_backoff_atomic` (741) and `patch_metadata_on_conn` (662) each do SELECT-parse-the-whole-ledger → mutate → rewrite-the-whole-blob inside a `conn.transaction()` (DEFERRED — no `BEGIN IMMEDIATE`). When an OAuth/healthcheck RMW reads the blob, then `record_usage` bumps `usage_count`/`last_used_at`, then the RMW commits its snapshot-derived whole blob, `record_usage`'s increment is overwritten; two concurrent RMWs likewise clobber each other's section. Because the transactions are DEFERRED, SQLite cannot serialise them cleanly, so depending on `busy_timeout` the loser either loses its write or fails with SQLITE_BUSY propagated as `AppError::Database`.
- **Root cause**: Methods named `*_atomic` are atomic only against themselves, not against the other writer paths to the same column; the RMW transactions never take an upfront write lock, and `record_usage` is an entirely separate non-transactional writer the "_atomic" paths implicitly assume doesn't exist.
- **Impact**: Lost usage counters / healthcheck or OAuth-backoff ledger fields, or intermittent failed credential operations (refresh-backoff bump, healthcheck append) under the realistic concurrency of a background healthcheck sweep + OAuth refresh + live credential use on the same row.
- **Fix sketch**: Make every metadata RMW open with `BEGIN IMMEDIATE` (rusqlite `transaction_with_behavior(TransactionBehavior::Immediate)`) so the first reader takes the write lock, and route `record_usage` through the same `update_ledger` closure (or an `ON CONFLICT`/`json_set` inside that transaction) so there is exactly one serialized writer per credential's metadata. Document the "single-writer per credential metadata" invariant on the module.
- **Value**: impact=5 effort=4
