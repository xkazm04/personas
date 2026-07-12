> Context: tauri:commands (misc 2)
> Total: 8
> Critical: 0  High: 1  Medium: 5  Low: 2

## 1. `test_automation_webhook` bypasses both the runnable-status check and the in-flight guard
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition / trust-boundary
- **File**: src-tauri/src/commands/tools/automations.rs:170-192 (vs. 137-168)
- **Scenario**: `trigger_automation` (a) refuses to run when `!automation.deployment_status.is_runnable()` and (b) acquires `INFLIGHT_TRIGGERS.guard(&id)` so the same automation can't fire twice concurrently. `test_automation_webhook` — a UI-reachable command (registered lib.rs:2424) — calls `automation_runner::invoke_automation` directly with NEITHER guard. So: clicking "Test" fires a real external webhook POST for an automation that is in `draft`/`failed`/`disabled` state; and a Test can run concurrently with a live `trigger_automation` (or another Test) on the same id, producing overlapping real outbound requests that the guard exists specifically to prevent.
- **Root cause**: The concurrency/runnable invariants are enforced at the `trigger_automation` call site rather than inside `invoke_automation`, so the second entry point silently omits them.
- **Impact**: Duplicate/unexpected external side effects (real POSTs) + defeated double-fire protection.
- **Fix sketch**: In `test_automation_webhook`, acquire `INFLIGHT_TRIGGERS.guard(&id)` (same as trigger path) before invoking. Decide deliberately whether a non-runnable automation may be test-fired; if not, add the `is_runnable()` check. Better: move both guards inside `invoke_automation` so every path is covered.

## 2. `list_cron_agents` execution/failure counts are persona-wide, not schedule-scoped, and duplicate per trigger
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure / success-theater
- **File**: src-tauri/src/commands/tools/triggers.rs:1481-1490
- **Scenario**: The `recent_executions` / `recent_failures` correlated subqueries filter only on `e.persona_id = p.id` — they count EVERY execution of that persona in the last 24h (manual runs, chain fires, other triggers), not runs from the `schedule` trigger the row represents. Additionally, a persona with two schedule triggers yields two rows, each showing the identical persona-wide count. The "Cron Agents" panel therefore reports a schedule's health using unrelated activity.
- **Root cause**: The stats subqueries were not joined to `e.trigger_id = t.id`.
- **Impact**: Misleading dashboard — a healthy cron can look busy/failing due to unrelated executions.
- **Fix sketch**: Add `AND e.trigger_id = t.id` to both COUNT subqueries so counts reflect the specific schedule trigger. Compare with `list_recent_schedule_runs` (line 1597) which already joins on `t.id = e.trigger_id`.

## 3. `extract_automation_design_result` brace matcher ignores string context
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case / silent-failure
- **File**: src-tauri/src/commands/tools/automation_design.rs:151-195
- **Scenario**: After the direct-parse attempt fails (LLM wrapped JSON in prose), the fallback scans chars counting `{`/`}` with no awareness of string literals. Any single unbalanced brace inside a *string value* — e.g. a regex `"^\\{"`, a text field mentioning `{`, or a truncated `input_schema` — shifts the depth count, so `depth` reaches 0 mid-object (parse fails on the truncated candidate) or never returns to 0. The valid design JSON is then dropped and the user gets the generic `extraction_failed_error`.
- **Root cause**: Structural brace counting on text that legitimately contains braces inside quoted strings.
- **Impact**: Sporadic "Failed to extract automation design" failures on otherwise-valid LLM output; UX + wasted LLM spend.
- **Fix sketch**: Track in-string / escape state while scanning (skip braces between unescaped `"`), or attempt a tolerant JSON extraction (e.g. `serde_json::Deserializer::from_str(...).into_iter().next()`).

## 4. `delete_automation` in-flight guard is a windowed check with a TOCTOU gap
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src-tauri/src/commands/tools/automations.rs:117-135
- **Scenario**: The guard reads only the 50 most-recent runs (`Some(50)`) and then deletes with no lock held. Two gaps: (a) if >50 runs exist and a Pending/Running row is older than the newest 50, it is missed; (b) between the `any(...)` check and `repo::delete`, a concurrent `trigger_automation` can create a fresh run (it holds `INFLIGHT_TRIGGERS`, not any lock shared with delete), so the automation is deleted out from under an active run.
- **Root cause**: Check-then-act across two independent statements plus a capped scan, instead of a single authoritative predicate.
- **Impact**: An automation can be deleted mid-run, orphaning the in-flight execution.
- **Fix sketch**: Replace with a repo query that asks the DB directly `EXISTS(pending|running run for id)` (unbounded) and perform the existence-check + delete inside one transaction, or take the `INFLIGHT_TRIGGERS` guard for `id` during delete.

## 5. Triplicated "verify ownership" block across trigger commands
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/tools/triggers.rs:110-117, 155-162, 217-224
- **Scenario**: `update_trigger`, `set_trigger_unattended_mode`, and `delete_trigger` each repeat the identical pattern: `let existing = repo::get_by_id(..)?;` then `if existing.persona_id != persona_id { return Err(Validation("Trigger {} does not belong to persona {}")) }`. Verified all three are byte-identical except variable use.
- **Root cause**: Ownership enforcement copy-pasted rather than extracted.
- **Impact**: Maintainability — three sites to keep in sync; easy to add a fourth command and forget the check (a trust-boundary regression risk).
- **Fix sketch**: Extract `fn ensure_trigger_owned(db, id, persona_id) -> Result<PersonaTrigger, AppError>` returning the loaded trigger, and call it from all three (reuse the returned row).

## 6. Stale comment: `seed_mock_cron_agent` documented as "unwired" but it is registered
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code (comment rot)
- **File**: src-tauri/src/commands/tools/triggers.rs:1628-1629
- **Scenario**: The banner comment reads "pending: seed command unwired in invoke_handler; cascade flags the table." But `seed_mock_cron_agent` IS registered in the invoke handler (lib.rs:1994), so the command is live (debug builds only). The comment misleads a reader into thinking it's dead code; `MOCK_CRON_EXPRESSIONS` also carries a now-unnecessary `#[allow(dead_code)]` (it is used at line 1682).
- **Root cause**: Command was wired up after the "pending/unwired" note was written; note never updated.
- **Impact**: Maintainability — misleading provenance; a cleanup pass might wrongly delete a live debug command.
- **Fix sketch**: Delete/replace the stale note, and drop the `#[allow(dead_code)]` on `MOCK_CRON_EXPRESSIONS` (it is referenced).

## 7. Inline schedule-description logic in `list_cron_agents` duplicates existing helpers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/tools/triggers.rs:1507-1519
- **Scenario**: The per-row `description` fallback re-implements the interval-to-text formatting (`"Every {} hours"` / `"Every {} minutes"`) inline while also calling `cron_to_human`. The same interval-format shape appears in the seed path and could diverge from `cron_to_human`'s style over time.
- **Root cause**: One-off inline formatting instead of a shared `describe_schedule(cron, interval)` helper.
- **Impact**: Minor maintainability / consistency drift between panels.
- **Fix sketch**: Extract a small `fn describe_schedule(cron: Option<&str>, interval: Option<u64>) -> String` and reuse it here (and anywhere else building schedule text).

## 8. `webhook_request_to_curl` emits headers without value escaping
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/commands/tools/triggers.rs:1838-1841
- **Scenario**: The body is single-quote-escaped for shell safety (line 1849), but header values are interpolated raw into `-H '{key}: {v}'`. A captured header value containing a single quote (attacker- or client-controlled, since these are logged inbound webhook requests) produces a malformed/mis-quoted curl string. This is a copy-paste convenience string, not executed by the app, so blast radius is limited to whoever pastes it into a shell.
- **Root cause**: Escaping applied to the body path only, not the header path.
- **Impact**: Malformed curl output; a footgun if a user runs the generated command verbatim.
- **Fix sketch**: Apply the same `replace('\'', "'\\''")` escaping to header keys/values (or skip/warn on values containing quotes).
