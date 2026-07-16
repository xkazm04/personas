# tauri:engine [1/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 4 medium / 0 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. `quota_cooldown_active` full-table LIKE scan runs synchronously on the async worker from ~10 subscription ticks
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/subscription.rs:1481
- **Scenario**: Every tick of GoalAdvance/AssignmentAutoResume/BacklogToGoal/IdeaReplenish/BacklogTriage/DirectorStorm/AthenaChannelReaction/KpiGoalDerivation/KpiEvaluation/FleetLivenessWatchdog plus `deliberation.rs` (120s cadence) calls `quota_cooldown_active(&self.pool)` first thing. The query wraps `datetime(created_at)` (non-sargable — no index can be used) and applies five `LIKE '%…%'` patterns over `LOWER(COALESCE(output_data,''))` — `output_data` holds full CLI transcripts that can be tens of KB per row — so SQLite scans and lowercases the whole `persona_executions` table on every call.
- **Root cause**: The recency filter is expressed as `datetime(created_at) > datetime('now', ?1)` instead of a sargable lexical compare against a pre-formatted RFC3339 cutoff, the blob LIKEs run over unfiltered rows, and the check is a plain sync-rusqlite call executed directly inside `async fn tick()` (unlike the candidate queries in the same file, which are carefully offloaded via `spawn_blocking`). Each subscription also re-runs the identical check independently within the same minute.
- **Impact**: With months of execution history (retention keeps ≥50/persona for 60 days) this is a repeated full-table scan + blob lowercase every ~2 minutes at best, holding a tokio async worker thread and a pool connection for the duration; it grows linearly with execution history and multiplies with the number of enabled autonomy loops.
- **Fix sketch**: (1) Compute the cutoff in Rust as RFC3339 (`(now - 15min).to_rfc3339()`) and compare `created_at > ?1` directly — both are `T`-separated RFC3339, so the lexical compare is correct AND index-usable (add `idx_persona_executions_created_at` if absent); the LIKEs then only touch the last 15 minutes of rows. (2) Wrap the call in `spawn_blocking` (or make callers pass a cached value). (3) Memoize the result in a `LazyLock<Mutex<(Instant, bool)>>` with a ~30s TTL so the ten loops share one probe per window.

## 2. `run_test` is a hand-rolled duplicate of `run_lab_loop` and has already drifted (no completeness gate, no cancellation-overwrite guard)
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/test_runner.rs:187
- **Scenario**: `run_test` (lines 187–549) re-implements the whole scenario×model fan-out that `run_lab_loop` (1610–1906) provides generically: generate scenarios, spawn per-model tasks, the 17-field cancelled/error `ScoreResult` literal (repeated verbatim 4× at ~326, ~352, ~1730, ~1756), progress emits, tracker, and summary. `build_summary` (1119–1198) and `build_arena_summary` (1941–2001) are byte-for-byte the same ranking logic.
- **Root cause**: The lab modes were later generalized into `run_lab_loop` + `LabCallbacks`, but the original standard-test path was never migrated onto the abstraction.
- **Impact**: The drift is no longer hypothetical: `run_lab_loop` gained the completeness gate (panicked cells ⇒ run finalized `Failed` with a count, 1865–1880) and the "don't overwrite `cancelled` with `completed`" guard (1856–1863); `run_test` has neither, so a standard test run with lost/panicked task cells still finalizes `Completed` and averages over missing data, and a late cancellation can be overwritten. Every future fix has to be made twice (or, as here, gets made once).
- **Fix sketch**: Migrate `run_test` onto `run_lab_loop` with a single unlabeled variant and callbacks writing to `test_runs`/`repo::batch_create_results` (arena mode already demonstrates the shape; per-scenario batch-write can live in `persist_result`). Collapse `build_summary` into `build_arena_summary`. Add a `ScoreResult::from_error(msg)` constructor to kill the four repeated literals. The completeness + cancellation guards then apply to standard runs for free.

## 3. Event-bus tick re-queries the source persona (and trigger) per match despite its own batch pre-fetch
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/background.rs:1207
- **Scenario**: Inside `event_bus_tick`'s `for m in matches` loop, `source_persona_id` is resolved via `personas::get_by_id(pool, sid)` and the dry-run check via `trigger_repo::get_by_id(pool, sid)` (line ~1129) — both per **match**, even though both depend only on the enclosing `event`. A trigger event fanning out to 5 personas performs 5 identical persona lookups + 5 identical trigger lookups, on the hottest loop in the app (2s active cadence, up to 50 events/tick).
- **Root cause**: The tick's own header advertises "~3 queries instead of ~350" and step 5 even adds source-persona ids into the bulk `persona_map` fetch — but the dispatch loop ignores the map and re-queries per match, and the per-event lookups were placed inside the per-match loop.
- **Impact**: Reintroduces O(events × matches) point queries on the hot dispatch path the batching was built to eliminate; under a burst (50-event claim, multi-subscriber events) this is hundreds of avoidable queries per 2s tick competing for pool connections with the executions themselves.
- **Fix sketch**: Hoist both lookups to once-per-event before the match loop. For `source_persona_id`, consult the already-populated `persona_map` first (`persona_map.contains_key(sid)`), falling back to one `get_by_id` only for non-`persona:` sources. For dry-run, resolve the trigger once per event (`event.source_type == "trigger"`), or bulk-fetch the distinct trigger ids alongside the other step-3 batch queries.

## 4. Consensus lab mode is ~170 lines of unwired dead code
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/test_runner.rs:2134
- **Scenario**: `run_consensus_test`, `compute_agreement_rate`, and `build_consensus_summary` (2134–2296) are all `#[allow(dead_code)]` with the author's own note "pending: consensus mode unwired in commands::execution; standard lab loop is the only entry today". The dedicated repos (`consensus_repo`) and `CreateConsensusResultInput` are exercised only through this dormant path; `run_consensus_test` even carries an unused `_sample_counter`.
- **Root cause**: The mode was scaffolded ahead of a frontend/command surface that never landed; the allow-attributes keep the compiler quiet so it never surfaces.
- **Impact**: ~170 lines (plus the consensus repo/model surface) must be kept compiling and mentally accounted for on every refactor of `run_lab_loop`/`LabCallbacks` — the exact code most likely to be reshaped (see finding 2) — with zero runtime users. Verification needed for cross-context callers, but the module's own annotation asserts none exist.
- **Fix sketch**: Decide the feature's fate: either wire a `start_consensus` command/route (the arena handler in `management_api.rs` is a 30-line template), or delete the three functions + `_sample_counter` and leave the DB tables/migrations alone. If keeping, at minimum add a tracking issue reference next to the `allow(dead_code)` so it can't silently rot further.

## 5. Neon and PlanetScale executors are copy-pasted pairs differing only in the `params` field
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/db_query.rs:1117
- **Scenario**: `execute_neon` (1117–1158) vs `execute_neon_parameterized` (1161–1200) are identical — same field lookup, host extraction, URL, headers, status/body handling, parser — except one sends `"params": []` and the other `"params": params`. `execute_planetscale` (1259–1303) vs `execute_planetscale_parameterized` (1306–1372) repeat the same pattern (the parameterized one adds bind-var substitution).
- **Root cause**: The parameterized variants were added for introspection SQL-injection safety by cloning the originals instead of threading a `params: &[&str]` argument through.
- **Impact**: ~80 duplicated lines per connector; any fix to error sanitization, timeout, or response handling must be applied in four places (the SSRF-client and trim-fields hardening waves in this file already had to touch these blocks in parallel).
- **Fix sketch**: Make `execute_neon_parameterized(fields, sql, params)` the single implementation and have `execute_neon` call it with `&[]` (Neon's endpoint already accepts an empty params array — the non-param version literally sends `"params": []`). Same for PlanetScale: the parameterized body with an empty `bind_vars` map degenerates to the plain call; keep the `?`→`:vN` rewrite gated on `!params.is_empty()`.

## 6. Clipboard KB search re-prepares a per-chunk statement inside a nested loop and block-on's the embedder
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/subscription.rs:664
- **Scenario**: On every clipboard change that looks like an error (3s tick + hash diff), `ClipboardSubscription::search_kb` iterates ALL ready KBs and, for each of up to 3 vector hits per KB, calls `user_conn.prepare("SELECT c.content, d.source_path …")` + `query_row` — a fresh statement compile per chunk, N×3 point queries total. The query vector itself is produced via `block_in_place` + `Handle::current().block_on(em.embed_query(...))` on the subscription's async task.
- **Root cause**: The statement is prepared inside the innermost loop instead of once (or `prepare_cached`), chunk fetches aren't batched, and the whole sync/async bridge runs on the tick path rather than a blocking task.
- **Impact**: For a user with many KBs, each detected clipboard error costs one embedding inference (blocking a worker via `block_in_place`) plus O(KBs×3) statement compiles + queries, all to produce a top-3 list. Copy-pasting error logs repeatedly (the target workflow) multiplies this.
- **Fix sketch**: Prepare the chunk-lookup statement once before the KB loop (or use `conn.prepare_cached`), or collect all `chunk_id`s and fetch them in one `WHERE c.id IN (…)` query. Since `search_kb` is only called from the async tick, make it `async`, move the rusqlite work into `spawn_blocking`, and await `embed_query` directly instead of `block_in_place`+`block_on`.
