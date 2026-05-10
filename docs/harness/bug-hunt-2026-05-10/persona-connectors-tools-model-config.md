# Bug Hunt — Persona Connectors, Tools & Model Config

> Group: Personas Workspace
> Files scanned: 16
> Total: 2C / 5H / 5M / 2L = 14 findings

---

## 1. Cloud auto-sync race writes stale persona data when two updates land in quick succession

- **Severity**: high
- **Category**: race-condition
- **File**: `src-tauri/src/commands/core/personas.rs:114-177` and `:222-281`
- **Scenario**: User saves persona A (rename + prompt change). `update_persona` returns and spawns Task#1 = invalidate session, Task#2 = cloud upsert (using the captured `result`). Before Task#2 grabs the cloud client mutex, the user (or an automation) saves again with a different change set — Task#3 (cloud upsert from second update) starts and races. Tokio gives no ordering guarantee between two `tauri::async_runtime::spawn` futures both awaiting `cloud_client.lock().await`. Whichever finishes the upsert *last* wins on the cloud — which can be Task#2 (the older snapshot), silently overwriting the newer save.
- **Root cause**: Background sync tasks are spawned per-call with no serialization key per persona, and the mutex held inside `cloud_client.lock()` is only over the *client*, not over the upsert order.
- **Impact**: Cloud and local DB drift silently. Users believe their latest edit is deployed, but the older snapshot is what the engine fetches via `list_deployments`. Same race exists in `update_persona_parameters`. Surfaces only when two edits happen within the same tick — easy to hit when the UI saves on debounce while the user keeps typing.
- **Fix sketch**: Serialize cloud syncs per `persona_id` (e.g. a `Mutex<HashMap<String, JoinHandle>>` that aborts the prior task before spawning a new one), or use a single channel + worker that always upserts the *latest* state read fresh from DB. Stop relying on a captured snapshot to "avoid stale reads" — it actually causes them.

## 2. `delete_persona` reports `executions_force_cancelled` count that mixes real IDs with synthetic placeholders

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/core/personas.rs:563-573`
- **Scenario**: After `DELETION_DRAIN_TIMEOUT` elapses, the code calls `force_cancel_all_for_persona` and then pushes `format!("post-timeout-{i}")` placeholder IDs into `force_cancelled` so "the count is accurately reported". But these strings are never real execution IDs — they leak into `DeletePersonaResult.executions_force_cancelled` (length-of-vec), and any caller that introspects `cancel_failures` later (or any audit log that captures the result) will store fake IDs.
- **Root cause**: Conflating "count" and "id list" in the same Vec.
- **Impact**: Misleading audit trail and any UI that lists IDs of force-cancelled executions will display "post-timeout-0", "post-timeout-1" placeholders. If a future change reads the IDs to reconcile DB rows (e.g. cleanup), it would query for non-existent rows.
- **Fix sketch**: Track a separate `post_timeout_count: usize` field; keep `force_cancelled: Vec<String>` only for real IDs. Compute `executions_force_cancelled = force_cancelled.len() + post_timeout_count`.

## 3. `cron_fire_times_in_range` `from -= 1s` shift can double-emit a fire time exactly on `start`

- **Severity**: low
- **Category**: edge-case
- **File**: `src-tauri/src/commands/tools/triggers.rs:847-857`
- **Scenario**: `start = "2026-05-10T12:00:00Z"`, cron is `0 12 * * *` (daily at 12:00). The loop sets `from = start_utc - 1s = 11:59:59Z`. `next_fire_time_*` returns 12:00:00Z, which is `< end_utc` ✓ → push. Now `from = 12:00:00Z`. The next call returns the *next* day's 12:00 — fine. But if the cron is `* * * * *` (every minute) and `start = "12:00:00Z"`, the first call returns 12:00:00 ✓, the second returns 12:01:00 ✓, etc. No actual double-emit here. **However**, if a *different* cron lib version returns "next time `>= from`" instead of strictly `>`, the current code would emit `start` twice. The contract of `next_fire_time_*` is encoded in the comment but not asserted at the call site.
- **Root cause**: Asymmetric off-by-one workaround that depends on an implicit "strictly greater than" contract.
- **Impact**: Latent — silently works today but breaks if the cron helper's semantics shift. Calendar UI would show duplicate slots.
- **Fix sketch**: After `next` is returned, advance `from` to `next + chrono::Duration::nanoseconds(1)` and dedupe. Or assert the helper's contract in tests with a `start`-aligned fire time.

## 4. `validate_trigger` `file_watcher` check trusts user-supplied filesystem paths and calls `Path::exists()` on the IPC thread

- **Severity**: medium
- **Category**: silent-failure / edge-case
- **File**: `src-tauri/src/commands/tools/triggers.rs:516-548`
- **Scenario**: A trigger is configured with `watch_paths: ["//remote-server/share/dir", "/mnt/slow-network-fs/foo"]`. `validate_trigger` runs synchronously on the Tauri command thread and calls `std::path::Path::new(p).exists()` for each entry. On Windows, hitting a dead UNC path or a stalled NFS mount can block for tens of seconds (default SMB timeout is ~60s). Users see the trigger validation modal hang the whole Tauri command runtime; concurrent commands queue up waiting for the executor.
- **Root cause**: Filesystem stat on possibly-network paths inside a sync handler. No timeout or `tokio::task::spawn_blocking`.
- **Impact**: UI freeze; cascading IPC backpressure. An attacker who tricks a user into loading a persona JSON with a malicious UNC path can hang the app on every persona reload that triggers validation.
- **Fix sketch**: Wrap the `exists()` calls in `tokio::time::timeout(Duration::from_secs(2), spawn_blocking(...))`. Treat timeouts as `false` with an explanatory message. Make `validate_trigger` async (it already is — but the file-watcher branch runs on the calling thread).

## 5. `trigger_automation` in-flight guard is keyed by automation `id` only — guard is held only for the duration of the awaited task, so the second click silently no-ops without UX feedback discrimination between "running" vs "validation rejected"

- **Severity**: low
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/tools/automations.rs:154-159`
- **Scenario**: Two concurrent `trigger_automation` calls for the same id come in (e.g. from two open windows). The second gets `AppError::Validation("…already being triggered")`. The frontend's automation card likely treats validation errors and other validation errors uniformly — user sees an error even though their click was actually correct, just lost the race.
- **Root cause**: Using `AppError::Validation` to communicate "rate limit / dedup" is a category mismatch — validation usually means "fix your input."
- **Impact**: User confusion. Also, telemetry that treats Validation errors as "user mistakes" will inflate.
- **Fix sketch**: Introduce `AppError::Conflict` or `AppError::AlreadyInProgress` and surface it in the frontend with a benign toast ("Already triggered — wait or cancel"), distinct from genuine config errors.

## 6. `useToolRunner` 120s timeout fires `reject` but the underlying Tauri IPC call is never cancelled — it keeps running, can return a stale result against a new persona

- **Severity**: high
- **Category**: cleanup-gap / race-condition
- **File**: `src/features/agents/sub_tool_runner/libs/useToolRunner.ts:92-128`
- **Scenario**: User clicks Run on tool T under persona A. The Tauri-side `invoke_tool_direct` runs a long script (>120s). Frontend rejects with timeout, the persona-id ref is still A, so the timeout error is written to `states[T]`. Meanwhile the Tauri call is still executing on the backend, and **a second click (or auto-test) on tool T** is now *unblocked* because the `finally` block deletes T from `runningRef`. A second invocation kicks off in parallel; both eventually write to the DB / call external APIs. The user thinks one timed-out run failed; actually two ran.
- **Root cause**: `Promise.race` wins the race in JS only — there is no `AbortController` propagating into Rust to cancel the in-flight tool. `runningRef.delete(toolId)` runs in `finally` which fires on the JS-side timeout while the IPC is still in flight.
- **Impact**: Duplicate side effects on long-running tools (e.g. a deploy tool, an external API call). Silent — the duplicate run never surfaces in the UI because its result is overwritten.
- **Fix sketch**: Don't release `runningRef` until the *real* IPC promise resolves/rejects; keep a separate "displayed timeout" flag for UI. Better, plumb a cancellation token to the backend so `invoke_tool_direct` honours abort.

## 7. `useToolRunner` reset effect on persona switch races against a result-write that lands one tick later

- **Severity**: medium
- **Category**: race-condition
- **File**: `src/features/agents/sub_tool_runner/libs/useToolRunner.ts:33-47, 104-121`
- **Scenario**: User on persona A, clicks Run. Backend resolves *immediately* (cached fast tool). The `setStates` resolution lands. The user navigates to persona B. React schedules: (a) personaIdRef = 'B' (sync in render body), (b) the `useEffect` cleanup → resets `setStates({})`. But if the backend resolution settled *before* the effect runs (and uses the OLD rendered ref because runTool's closure captured `personaId='A'` and reads `personaIdRef.current` — now 'B'), the guard `runPersonaId !== personaIdRef.current` correctly drops the write. **However**, the dedupe `runningRef` was cleared by the persona-switch effect, so a click on the same tool under persona B is allowed — and concurrent with the still-flying A-side call. Both backends now race writes to the same toolId key.
- **Root cause**: `runningRef.current.clear()` on persona switch invalidates the dedupe semaphore for tool runs that are still pending in the backend.
- **Impact**: Duplicate tool invocations (one for persona A, one for persona B) for the same `toolId` if the user switches and clicks fast.
- **Fix sketch**: Make `runningRef` a `Map<string, Set<toolId>>` keyed by personaId, or move the dedupe to a per-(personaId,toolId) tuple so persona switches don't drop in-flight slots.

## 8. `bulkAssignTools` / `bulkRemoveTools` mark cache stale and refetch persona detail even on backend failure — UI shows "tools were assigned" because optimistic cache invalidation runs in `finally`

- **Severity**: high
- **Category**: optimistic-update / silent-failure
- **File**: `src/stores/slices/agents/toolSlice.ts:90-110`
- **Scenario**: User multi-selects 12 tools and clicks "Assign". The Rust `bulk_assign_tools` returns `Err(AppError)` after assigning 0 (DB constraint failed). `reportError` writes to store (toast?), but `finally` block STILL calls `invalidateToolDefCache()` and `fetchDetail(personaId)`. The detail fetch returns the unchanged persona — which is correct — but the *toast says failure* while the tool list refresh implies success-noop and the cache invalidation is wasted. Worse, if the Rust call partially succeeded (some inserts before a `?`-bubbled error), the UI now shows a partial state with no warning.
- **Root cause**: Rust `bulk_assign_tools` is not transactional in a way that's communicated to the frontend (returns `u32` count when ok, single AppError when bad). On failure, the count of successful inserts is lost.
- **Impact**: Partial assigns leave persona in inconsistent state without a warning. User assumes "it failed → nothing changed" but tools may be partly bound.
- **Fix sketch**: Make the Rust handler transactional (rollback all on first failure) OR return `BulkAssignResult { succeeded: Vec<String>, failed: Vec<(String, String)> }` and surface the partial-failure list in the toast.

## 9. `getRoleForConnector` returns the *first* role that contains a connector, but `gitlab` and `azure_devops` appear in BOTH `source_control` AND `ci_cd` — silently mis-grouping in the swap UI

- **Severity**: medium
- **Category**: edge-case / validation-gap
- **File**: `src/lib/credentials/connectorRoles.ts:79-80, 263-265`
- **Scenario**: User has a `gitlab` connector linked. The connectors panel calls `getRoleForConnector('gitlab')` → returns `source_control` role (first match). The Swap UI shows alternatives = `['github', 'azure_devops']` — fine. But a user looking at the *CI/CD* purpose group expects `gitlab` to appear there; instead the `_connectorPurposeMap` (built at 236-248) only maps each connector to its FIRST-encountered purpose group's first matching role. So `gitlab` → purpose `devops` via `source_control`, but the same connector serving "CI/CD" purpose is invisible.
- **Root cause**: Many-to-many relationship (connector → multiple roles) is collapsed to one-to-one by "find first" + "set if not present".
- **Impact**: Connectors that legitimately serve two roles (gitlab, azure_devops) appear in only one swap pool; users can't swap their gitlab credential to a github_actions one when they intend the CI/CD slot. Also, `getAlternatives('gitlab')` returns the source_control sister set only.
- **Fix sketch**: Either deduplicate the role registry so each connector lives in exactly one role, or change `getRoleForConnector` to take a *purpose* hint (`getRoleForConnector(name, purpose?)`) and return the role aligned with the requested purpose.

## 10. `extract_automation_design_result` advances `start` only when `depth == 0`, but assigns `start = Some(i)` *before* incrementing depth — works for a single object, but a malformed string with stray `}`s prior to the real object resets `start` and never recovers

- **Severity**: low
- **Category**: edge-case
- **File**: `src-tauri/src/commands/tools/automation_design.rs:151-195`
- **Scenario**: LLM emits `\`\`\`Here is some text } and the JSON: {"name":"foo", ...}\`\`\``. The stray `}` enters the `'}'` branch with `depth == 0` → guarded out, ok. Now real `{`: depth becomes 1, start = i. Real `}`: depth → 0, parse candidate. ✓ — works. But if the LLM emits `{"oops":"unbalanced }} { stuff ..."}` truncated, the depth tracker sees depth go 1→2 (inside string!) → 1 → 0 prematurely, picks a bogus candidate. The brace counter doesn't honor JSON string boundaries.
- **Root cause**: The brace-matching state machine doesn't handle string literals. `{"name": "}{"}` would mis-balance.
- **Impact**: Rare. LLM output is usually well-formed. But adversarial / truncated outputs cause the extractor to silently miss the real JSON or pick wrong segments → "extraction failed" error, user blames the LLM.
- **Fix sketch**: Track `inside_string` state with `\\` escape handling, or use a streaming JSON parser (e.g. `serde_json::Deserializer::from_str(...).into_iter::<Value>()`) and pick the first object containing a `name` field.

## 11. `EffectiveConfigPanel` masks `authToken` only on display — but the full token is leaked through `title` attribute on other rows if `value` is non-null

- **Severity**: high
- **Category**: secret-leak
- **File**: `src/features/agents/sub_model_config/components/EffectiveConfigPanel.tsx:30-34`
- **Scenario**: `FieldRow` for `authToken` is called with `mask={true}`. The displayed value is `••••••••` ✓. **But** the title attribute logic is `field.value != null && !mask ? String(field.value) : undefined` — this is correct for the `authToken` row (mask is true → no title). However, *every other row* renders the raw value as a tooltip. If a future field (e.g. `baseUrl` containing `https://user:secret@host`) accidentally embeds credentials, they're exposed via `title=...` on hover/screenshot/DOM-inspector even though the visible text is truncated by `max-w-[140px]`.
- **Root cause**: Mask flag is per-field, but no canonical list of "secret" fields exists; future additions easily forget the flag.
- **Impact**: Future-proofing failure. Today only `authToken` is sensitive, but the moment someone adds `apiKey`, `webhookSecret` etc. without setting `mask=true`, the value lands in screenshots / accessibility trees / dev-tools without warning.
- **Fix sketch**: Centralize the secret-field list (e.g. `const SECRET_FIELDS = new Set(['authToken', 'apiKey', ...])`) and have `FieldRow` derive `mask` from it. Better, never set `title` to the raw value when `field.source === 'workspace' | 'global'` — those values cross workspace boundaries.

## 12. `ModelABCompare` on persona switch best-effort cancels the *previous* run, but does **not** wait for cancel to complete before allowing a new run — second run can collide with a still-cancelling first run

- **Severity**: medium
- **Category**: race-condition / cleanup-gap
- **File**: `src/features/agents/sub_model_config/components/compare/ModelABCompare.tsx:85-95, 52-68`
- **Scenario**: User starts a comparison on persona A (`runId = X`). They switch to persona B. The `useEffect` fires `cancelArena(X)` (fire-and-forget), `setActiveRunId(null)`, `setLastResults(null)`, collapses panel. **But `isLabRunning`** — sourced from `useAgentStore` — is still `true` because the store hasn't yet processed the cancel. User clicks Run on persona B before cancel completes; `canRun` checks `!isLabRunning` → blocked, fine. **However**, if cancel completes fast and `isLabRunning` flips to `false` while X is still emitting results, those results land in `arenaResultsMap[X]`. The `useEffect` at line 33 then writes them to `lastResults` of persona B (since `activeRunId` is `null`, the effect early-returns; safe). But if the user clicks Run very fast and gets `runId = Y` before X's results arrive, `arenaResultsMap[X]` becomes stale and `arenaResultsMap[Y]` is empty — the metrics shown are blank, and no error is surfaced.
- **Root cause**: Async cancel semantics aren't awaited; UI can transition through inconsistent states.
- **Impact**: Stale or empty comparison results displayed with no indication; user thinks "the comparison ran and produced nothing" when actually the cancel torpedoed it.
- **Fix sketch**: Make persona-switch effect `await cancelArena(prevId)` before `setActiveRunId(null)`. Or, surface a "Cancelling…" UI state while the cancel is pending.

## 13. `seed_mock_cron_agent` modulo by `personas.len()` panics when the slice is empty due to `.max(1)` — but writes to `personas` table without checking conflicting `id` collisions

- **Severity**: low
- **Category**: edge-case
- **File**: `src-tauri/src/commands/tools/automations.rs` is the wrong file — actual location is `triggers.rs:1487-1525`
- **Scenario**: First seed call with no personas: inserts persona `mock-persona`, trigger row OK. Second seed call: `idx = 0`, picks the freshly-seeded `mock-persona`. INSERT INTO persona_triggers proceeds with a UUID — fine. **But** if a user manually creates a persona with id `mock-persona` (uuid collision is very unlikely; user-created IDs aren't possible in normal flow — verify), the `INSERT OR IGNORE` silently no-ops. In debug builds this is harmless. Also, `MOCK_CRON_EXPRESSIONS[t % len]` with `t = timestamp_millis() as usize` — on 32-bit Windows builds `usize` is 32-bit, `i64` truncation could change `t` unexpectedly. The cast `t as usize` from `i64` silently truncates.
- **Root cause**: Cross-arch `as` casts of millisecond timestamps; INSERT OR IGNORE swallows the "row already exists" case so seeding is not idempotent in a meaningful way.
- **Impact**: Debug-only. Rare. Mostly UX-noise — repeated seeds pile up triggers without obvious feedback.
- **Fix sketch**: Use `(timestamp_millis() as u64) as usize` with explicit modulo on a known-good range, or `rand`. Track previously-seeded `trigger_id`s in a set and clean up in a `seed_clear_mock_cron_agents` companion.

## 14. `fetchToolUsage` slices the ISO date with `.slice(0, 10)` — silently produces wrong cutoff in non-UTC timezones near midnight

- **Severity**: critical
- **Category**: timezone
- **File**: `src/stores/slices/agents/toolSlice.ts:114`
- **Scenario**: User is in `America/Los_Angeles` (UTC-8), clock shows `2026-05-09 22:00 PDT`. `Date.now() - 30*86400000` → 30 days ago in epoch ms → `new Date(...).toISOString()` → `2026-04-09T05:00:00.000Z`. `.slice(0, 10)` → `'2026-04-09'`. The backend `getToolUsageSummary(since)` uses this as a date string. **But** the user expected "last 30 days from *my* local view", which would start `2026-04-10` (because in their tz the rollover hasn't happened). For users east of UTC, the bug is even worse: a Berlin user at 01:30 CEST sees the cutoff one day *later* than they expect, dropping a full day of usage data.
- **Root cause**: Building a DATE from `toISOString()` (UTC) and using it as a local-time cutoff conflates timezones.
- **Impact**: Tool usage charts and tables miss/include a full extra day depending on tz and time-of-day. Persistent silent inaccuracy. Users east of UTC at low local hours see "yesterday's" data wiped.
- **Fix sketch**: Compute the cutoff in user-local time: ``new Date(Date.now() - days*86400000).toLocaleDateString('en-CA')`` (en-CA gives YYYY-MM-DD) — or pass an epoch millis number to the backend and let SQL do the date math in a known timezone (UTC or app-configured).

---
