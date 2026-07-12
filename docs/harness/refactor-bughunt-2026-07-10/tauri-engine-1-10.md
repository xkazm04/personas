> Context: tauri:engine [1/10]
> Total: 9
> Critical: 0  High: 0  Medium: 5  Low: 4

## 1. Master-key / cipher OnceLock caches a startup failure permanently
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/crypto.rs:476-524, 1250-1260
- **Scenario**: `get_master_key` stores `Result<ProtectedKey,String>` in a `OnceLock` (`KEY_STORE`), and `get_cipher` stores `Result<Aes256Gcm,String>` in `CIPHER`. If the very first credential operation runs while the OS keychain is transiently unavailable (locked session, keyring daemon not yet up, DBus not ready) and `PERSONAS_ALLOW_FALLBACK_KEY` is not set, the fail-closed `Err` is cached. Every later `encrypt_for_db`/`decrypt_from_db`/healthcheck/rotation call for the rest of the process returns that same cached error even after the keychain becomes available. `try_upgrade_to_keychain` cannot help — it calls `get_master_key`, which returns the cached `Err`.
- **Root cause**: `OnceLock::get_or_init` memoizes the first outcome, but a keychain probe is not idempotent-in-availability — it can legitimately go from unavailable→available within one session.
- **Impact**: A one-time boot-timing race silently bricks all credential encryption for the whole app session; user sees persistent "master key not available" with no recovery short of restart.
- **Fix sketch**: Only cache the `Ok(ProtectedKey)`; on `Err` do not seal it in the `OnceLock` (e.g. use a `Mutex<Option<ProtectedKey>>` and retry on miss, or a small retry/backoff before caching). Same for `CIPHER`.

## 2. PostgREST SELECT parser slices the original string with offsets found in the uppercased copy
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/db_query.rs:893-1036
- **Scenario**: `parse_select_to_postgrest` computes `remainder_upper = after_from_upper[table_end..]` and then repeatedly does `remainder_upper.find("LIMIT ")` / `find("ORDER BY ")` / `find("WHERE ")` and slices the **original** `remainder` at those byte offsets. `str::to_uppercase()` is not byte-length-preserving for some Unicode (e.g. the `ﬀ` ligature 3 bytes → `FF` 2 bytes). A query like `SELECT * FROM t WHERE x = 'ﬀoo' ORDER BY id` shifts the uppercased offsets relative to the original, so the extracted clause is mis-sliced — and if the offset lands mid-UTF-8-codepoint, `&remainder[..end]` panics (caught by the subscription panic boundary, but the query silently fails).
- **Root cause**: Two parallel strings (original + uppercased) indexed by shared offsets, assuming byte-length parity that `to_uppercase` does not guarantee.
- **Impact**: Wrong REST query (silently dropped WHERE/ORDER) or a panic on adversarial/i18n SQL against Supabase-backed connectors.
- **Fix sketch**: Do case-insensitive keyword search on a single string (e.g. find on the original with an ASCII-casefold matcher, or carry `(char_offset)` consistently), or uppercase in place per-slice rather than maintaining a parallel copy.

## 3. `.and(None)` makes the oauth_scope provider fallback a permanent no-op
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/healthcheck.rs:698-702
- **Scenario**: In `resolve_connector_healthcheck` the OAuth-provider fallback reads:
  `f.get("oauth_provider").or_else(|| f.get("oauth_scope").and(None))`.
  `Option::and(None)` always evaluates to `None`, so the `oauth_scope` arm can never contribute a value — the `.or_else(...)` closure is dead. A credential that carries only `oauth_scope` (not `oauth_provider`, and no `oauth_type` in connector metadata) resolves to no provider and silently skips the OAuth healthcheck fallback, reporting "credentials stored" instead of actually probing.
- **Root cause**: Almost certainly a typo for `.and_then(...)` or a presence check; as written it is a guaranteed no-op that masks the intended fallback.
- **Impact**: Healthcheck success theater for scope-only OAuth credentials; a dead/misconfigured key looks "stored/ok".
- **Fix sketch**: Replace `.and(None)` with the intended logic (e.g. `f.get("oauth_scope").map(|_| /* provider */ ...)`), or drop the arm entirely if oauth_scope was never meant to name a provider.

## 4. Structured CLI collector calls `driver.wait()` after a collect-timeout without killing the child
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/test_runner.rs:1265-1410
- **Scenario**: The coordinator path `spawn_cli_and_collect` uses `?` on `collect_lines_with_timeout`, so a 300s timeout bubbles up and `driver.finish()` runs. The per-model path `spawn_cli_and_collect_structured` instead captures `stream_err` and then unconditionally awaits `driver.wait().await`. If the child CLI is hung (the reason the stream timed out), `wait()` blocks until the process exits on its own — the 300s timeout no longer bounds total time, and the lab run/task can wedge indefinitely holding a tokio task.
- **Root cause**: Asymmetric timeout handling — the structured path does not kill/`finish` the child on the timeout branch before waiting for exit.
- **Impact**: A single unresponsive CLI child hangs a lab scenario task (and its results row) with no upper time bound.
- **Fix sketch**: On `stream_err.is_err()`, kill/`finish` the driver before/instead of `wait()`, or wrap `driver.wait()` in a bounded `tokio::time::timeout` and force-kill on expiry.

## 5. Panicked scenario task is logged and silently dropped from results
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src-tauri/src/engine/test_runner.rs:376-384
- **Scenario**: When collecting per-model handles, `handle.await` `Err` (task panic) only logs `"Test task panicked"` and pushes nothing. That model×scenario cell produces no `lab_results` row and no progress emit, yet `total = scenario_count * model_configs.len()` still counts it — so `current` never reaches `total` and the summary silently omits the cell rather than marking it errored.
- **Root cause**: Panic path has no fallback `ScoreResult` (unlike the cancellation/error paths, which synthesize one).
- **Impact**: Progress bar never completes; a crashed cell disappears instead of surfacing as a failure.
- **Fix sketch**: On `Err(join_err)`, push a synthetic `(mi, "error", ScoreResult{ error_message: Some(panic msg), .. })` mirroring the existing error branch.

## 6. Duplicate HealthcheckEntry / LedgerHealthEntry structs + mirror conversion functions
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/rotation.rs:180-188, 386-415
- **Scenario**: `HealthcheckEntry` (engine) and `crate::db::models::LedgerHealthEntry` are field-for-field identical (`success, status_code, error_class, message, timestamp`), requiring `ledger_entries_to_engine` and `engine_entries_to_ledger` to copy each field both ways at every ledger read/write in `evaluate_due_rotations` / `detect_anomalies`. Verified: both conversions only clone the same five fields; no transformation happens.
- **Root cause**: Two layers each defined their own identical struct, then bridged them with hand-written mappers.
- **Impact**: Maintainability — any new field must be added in three places (both structs + both mappers) or the ledger silently drops it.
- **Fix sketch**: Use one type across both layers (re-export the model type, or `impl From` in one direction and delete the manual mappers), collapsing the four functions/structs to one.

## 7. Dead `resolve_tolerance` free function and its two tolerance constants
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/rotation.rs:92-98, 367-382
- **Scenario**: The standalone `pub fn resolve_tolerance(metadata: &serde_json::Value) -> f64` is `#[allow(dead_code)]` and superseded everywhere by the `ledger.resolve_tolerance()` method (used in `evaluate_due_rotations`, `detect_anomalies`, `get_rotation_status`, `evaluate_healthcheck_event`). Its only readers of `PRODUCTION_TOLERANCE` / `DEVELOPMENT_TOLERANCE` (also `#[allow(dead_code)]`) are inside this dead function. Grep shows no non-test caller of the free function.
- **Root cause**: Logic moved onto the typed ledger; the old free-function copy + constants were left behind under `allow(dead_code)`.
- **Impact**: Maintainability / dead surface that can drift from the live `ledger.resolve_tolerance()`.
- **Fix sketch**: Delete the free `resolve_tolerance` and the two now-unreferenced constants, keeping the ledger method as the single source.

## 8. Near-duplicate status-emit builders `emit_status` / `emit_lab_status`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/test_runner.rs:1426-1491
- **Scenario**: `emit_status` and `emit_lab_status` build the identical `TestRunStatusEvent { run_id, phase, error, ..all-None }` payload; the only difference is that `emit_lab_status` takes the event name as a parameter while `emit_status` hardcodes `event_name::TEST_RUN_STATUS`. Both fully spell out the same ~12 `None` fields.
- **Root cause**: Second emitter added for the generic lab executor without folding the first into it.
- **Impact**: Cosmetic maintainability; two spots to update when the event shape changes.
- **Fix sketch**: Make `emit_status` delegate: `emit_lab_status(app, event_name::TEST_RUN_STATUS, run_id, phase, error)`.

## 9. `extract_protocol_message` is dead outside tests
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/parser.rs:546-564
- **Scenario**: `extract_protocol_message(line: &str)` is `#[allow(dead_code)]` and superseded by `extract_protocol_message_from_value` (the doc comment itself says "Prefer `extract_protocol_message_from_value`"). The runner path parses once and calls the `_from_value` variant; the string variant's only live callers are the module's own unit tests.
- **Root cause**: Redundant-parse variant kept after callers migrated to the pre-parsed-Value form.
- **Impact**: Dead public surface + a redundant `serde_json::from_str` path that can diverge from the canonical parser.
- **Fix sketch**: Either delete `extract_protocol_message` (moving the prefix-fast-path test coverage onto `_from_value`), or gate it `#[cfg(test)]` if kept purely as a test convenience.
