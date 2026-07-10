> Context: tauri:db
> Total: 6
> Critical: 0  High: 1  Medium: 2  Low: 3

## 1. `AUTONOMOUS_DELIBERATION` key is read by the engine but absent from `ALLOWED_KEYS` — the feature can never be turned on
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary / silent-failure
- **File**: src-tauri/src/db/settings_keys.rs:319-321, 538-606
- **Scenario**: `engine/deliberation.rs:798` reads `settings::get(pool, AUTONOMOUS_DELIBERATION)` to gate the whole autonomous-deliberation loop, and `docs/features/deliberations.md` describes a user toggle for it. But the generic setter `repos::core::settings::set` calls `validate_key` first (settings.rs:41), and `AUTONOMOUS_DELIBERATION` (`"autonomous_deliberation"`) is NOT in `ALLOWED_KEYS`. When the UI toggle writes the key, `validate_key` returns `Err("unknown settings key")` and the write is rejected — so `get` always falls back to the `false` default and deliberation never runs. The value also has no `validate_value` bool branch (712-730).
- **Root cause**: New settings key constant added (with a `_DEFAULT`, a doc-comment, a reading subscription) but never appended to `ALLOWED_KEYS`. `test-mastery-2026-06-17/database-schema-migrations.md:45` predicted exactly this class of omission; no test enumerates key-constants against the allowlist.
- **Impact**: A shipped, documented autonomy feature is silently un-activatable; the toggle appears to fail or no-op.
- **Fix sketch**: Add `AUTONOMOUS_DELIBERATION` to `ALLOWED_KEYS` and add it to the `"true"|"false"` arm of `validate_value`. Add a test that asserts `validate_key(K).is_ok()` for every exact key constant the module exposes.

## 2. CDC drain task sleeps 6s before draining a 512-slot channel — boot-time write bursts silently drop change events
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / race-condition
- **File**: src-tauri/src/db/cdc.rs:198-233 (sleep 204, reader spawn 213), lib.rs:659
- **Scenario**: The bounded sync channel is created with capacity 512 (`create_cdc_channel(512)`). The update hook `try_send`s and silently drops on a full channel (cdc.rs:129). But the reader thread that drains `receiver` is only spawned AFTER `tokio::time::sleep(6s)` (line 204) inside the drain task. During those first 6 seconds nobody drains the channel, so any startup write storm (incremental migrations, seeding/backfill, first-sync writes to tracked tables) fills the 512 slots and every event past 512 is dropped. The frontend then shows stale rows until the next unrelated mutation of that table.
- **Root cause**: The 6s delay (added to avoid "send before connect" IPC warnings) gates the *consumer start*, not just the *emit*, so producers run unbuffered-past-capacity while the consumer is asleep.
- **Impact**: Lost UI notifications for early-boot DB changes; hard-to-reproduce "row didn't update" UX.
- **Fix sketch**: Spawn the sync reader thread immediately (buffer into the tokio mpsc / a Vec) and only gate the `app_handle.emit()` calls behind the 6s readiness wait; or drain-and-hold events until the webview is ready instead of dropping them.

## 3. `CdcCustomizer` pragma block has already drifted from `SqlitePragmaCustomizer` despite the "same as" comment
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/db/cdc.rs:106-115 vs src-tauri/src/db/mod.rs:137-146
- **Scenario**: cdc.rs:107 comments "Set standard pragmas (same as SqlitePragmaCustomizer)" and copy-pastes the PRAGMA batch. They are NOT the same: the canonical `SqlitePragmaCustomizer` also sets `PRAGMA page_size = 4096;` and `PRAGMA analysis_limit = 1000;`, both absent from the CDC copy. Since the pool picks ONE customizer (mod.rs:214 `None => SqlitePragmaCustomizer` — i.e. the CDC path replaces it), every connection on a CDC-enabled pool silently runs without `analysis_limit` (which bounds `PRAGMA optimize` cost in the idle-maintenance task) and without the `page_size` hint.
- **Root cause**: Two hand-maintained copies of the pragma set with no shared constant; the copy already fell behind an edit to the original — proving the drift risk is live, not theoretical.
- **Impact**: Maintainability + subtle correctness (CDC pool connections get a different tuning profile than the rest of the app).
- **Fix sketch**: Extract the pragma batch into a single `const STANDARD_PRAGMAS: &str` (or a shared `apply_standard_pragmas(conn)` helper) and have both customizers call it, appending only their extra step (the CDC hook).

## 4. `QueryBuilder::offset()` without a paired `limit()` drops the clause but keeps a dangling bound param
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/db/query_builder.rs:224-228, 269-291
- **Scenario**: `offset()` sets `has_offset=true` and pushes a param, but `build_clauses` only emits an `OFFSET ?N` fragment when BOTH `has_limit && has_offset` (285). If a future caller calls `offset()` without `limit()`, the OFFSET clause is silently omitted while the pushed value still lives in `self.params` — so `params_ref()` returns one more param than the SQL has placeholders, yielding a rusqlite "wrong number of parameters" error (or a mis-indexed bind). All current callers happen to pair `.limit().offset()` (e.g. memories.rs:175-176), so it's latent, but the API invites the trap.
- **Root cause**: OFFSET emission is coupled to LIMIT presence (SQLite requires LIMIT before OFFSET) but the param push is unconditional, breaking the params↔placeholders invariant in the offset-only case.
- **Impact**: Latent runtime query failure if a new caller uses offset without limit.
- **Fix sketch**: In the `has_offset && !has_limit` case, emit `LIMIT -1 OFFSET ?N` (SQLite idiom for "all rows after offset"), or make `offset()` a no-op unless a limit is set, or debug-assert the pairing.

## 5. Several allowlisted bool keys have no `validate_value` contract — garbage values persist and silently read as `false`
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: trust-boundary
- **File**: src-tauri/src/db/settings_keys.rs:386-388, 712-730
- **Scenario**: `AUTONOMOUS_REVIEW_TRIAGE_HIGH` is in `ALLOWED_KEYS` and is a `"true"`/`"false"` boolean per its doc, but it is missing from the boolean arm of `validate_value` (712-730). So `set("autonomous_review_triage_high", "maybe")` passes validation and stores garbage; the reader compares against `"true"` and silently treats anything else as off. Same gap applies to `AUTONOMOUS_DELIBERATION` (see #1).
- **Root cause**: The `validate_value` bool list is maintained by hand in parallel with the key definitions and misses entries.
- **Impact**: A typo'd or stale value silently disables a high-risk autonomy opt-in with no error to the writer.
- **Fix sketch**: Add both keys to the bool arm; better, derive the bool-typed key set from a single table so key + default + validator stay in sync.

## 6. `CdcNotification` is a field-for-field duplicate of `CdcEvent`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/db/cdc.rs:52-58, 62-68, 293-297
- **Scenario**: `CdcNotification { action, table, rowid }` has the identical three fields, identical types, and identical `#[serde(rename_all = "camelCase")]` derive as `CdcEvent`. The drain loop rebuilds a `CdcNotification` from an existing `CdcEvent`'s moved-out fields (293-297) purely to emit it — no field is added, removed, or transformed.
- **Root cause**: Two structs modelling the same wire payload; the second adds no shape over the first.
- **Impact**: Maintainability — a future field on the CDC payload must be added in two places.
- **Fix sketch**: Emit the `CdcEvent` directly (it already derives `Serialize`) and delete `CdcNotification`, or make `CdcNotification` a type alias.
