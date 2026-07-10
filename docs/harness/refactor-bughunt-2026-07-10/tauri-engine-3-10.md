> Context: tauri:engine [3/10]
> Total: 9
> Critical: 0  High: 1  Medium: 5  Low: 3

## 1. Byte-boundary panic when truncating unparseable LLM output
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/auto_triage.rs:205-209 ; src-tauri/src/engine/genome.rs:150-155
- **Scenario**: An LLM verdict/objective response fails to parse and the error path builds a preview via `&trimmed[..trimmed.len().min(500)]` (auto_triage) / `&raw[..raw.len().min(200)]` (genome). These slice by **bytes**. If the response is longer than the cap and byte 500/200 lands in the middle of a multi-byte UTF-8 char (very plausible for non-ASCII model output — emoji, CJK, accented text), the slice panics with "byte index is not a char boundary".
- **Root cause**: `str.len()` returns byte length; slicing a `&str` at an arbitrary byte offset is only valid on char boundaries. The `.min(N)` guard bounds length but not boundary alignment.
- **Impact**: Panic. In auto_triage this fires inside `spawn_evaluator_task`'s tokio task (review silently never finalized past pending); in genome it aborts the fitness-objective parse. Both are reachable on normal degraded-model paths.
- **Fix sketch**: Use a char-safe truncation, e.g. `trimmed.chars().take(500).collect::<String>()` (matches the existing `truncate`/`clamp_chars` helpers already in these files) instead of raw byte slicing.

## 2. Memory-reflection CLI spawn lacks kill_on_drop — orphaned billing process
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: reliability
- **File**: src-tauri/src/engine/memory_reflection.rs:288-322
- **Scenario**: `run_claude_oneshot` builds a `tokio::process::Command` by hand instead of going through `CliProcessDriver`. It only kills the child on its *own* timeout branch. If the owning future is dropped for any other reason — app shutdown, task cancellation, the caller's `timeout` firing higher up — the `claude` child is not killed and keeps streaming/billing until the desktop app restarts.
- **Root cause**: The unified driver sets `.kill_on_drop(true)` precisely as the safety net for cancel/panic/timeout drops (see cli_process.rs:339 doc). This ad-hoc spawn bypasses the driver and never sets that flag.
- **Impact**: Orphaned Claude CLI process consuming the subscription/credits after a dropped reflection; contradicts the app-wide "no spawned CLI outlives its owner" invariant.
- **Fix sketch**: Add `.kill_on_drop(true)` to the `Command`, or (better) route reflection through `CliProcessDriver::spawn_temp_no_stderr` like the other headless judges so it inherits the guarantee.

## 3. Webhook body stored in plaintext log while the event payload is encrypted
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/webhook.rs:243-267 (log) vs 577-586 (encrypt)
- **Scenario**: `mark_triggered_and_publish` deliberately encrypts the webhook payload with `crypto::encrypt_for_db` before writing it to `persona_events`. But `handle_webhook` also writes the *raw* request body verbatim into `webhook_request_logs` (`body: body_for_log`). Any secret an inbound webhook carries (GitHub payloads, third-party tokens, PII) is at-rest plaintext in the log table even though the primary event row is sealed.
- **Root cause**: Two persistence sites for the same content with divergent handling; the request-logging path predates / ignores the payload-encryption decision.
- **Impact**: The event-payload encryption is undermined — the identical data sits unencrypted one table over. Data-exposure risk on DB theft/backup.
- **Fix sketch**: Encrypt the logged body the same way, or redact/omit the body in `webhook_request_logs` (keep headers + status only), or gate body logging behind an explicit debug flag.

## 4. Discord inbound message permanently dropped on transient dispatch failure
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/engine/discord_poller.rs:201-283
- **Scenario**: In `poll_channel`, `newest_id` is advanced for every fetched message before dispatch, and the cursor is written to `newest_id` at the end of the loop. When `execute_persona_inner` returns `Err` (queue full, DB blip, momentary lock), the message is logged with an `error` and the loop continues — but the cursor has already moved past it. Because the next fetch uses `after={cursor}`, that message is never re-fetched and never retried, so the user's Discord message gets no reply, ever.
- **Root cause**: Cursor advancement is decoupled from successful processing; there is no retry / dead-letter for `error IS NOT NULL` rows (the reply pass explicitly filters them out at line 618).
- **Impact**: A transient failure silently eats an inbound user message. UX: the bot appears to ignore the user with no recovery.
- **Fix sketch**: Don't advance the cursor past a message whose dispatch failed transiently, or add a bounded retry that re-picks `discord_inbound_messages` rows with `execution_id IS NULL AND error IS NOT NULL`.

## 5. Digest success_rate divides by all-status row count, skewing the metric
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/engine/digest.rs:170-179, 214-231
- **Scenario**: `query_period_summary` sets `total = COUNT(*)` over `persona_executions` in the window but only counts `status='completed'` as success and `status='failed'` as failed. `success_rate = success / total`. Rows in `queued`, `running`, `incomplete`, or `cancelled` states inflate the denominator without ever being success or failure, so `successful + failed != total` and the reported success rate reads artificially low whenever in-flight/cancelled runs exist in the window.
- **Root cause**: Denominator uses raw row count instead of the completed+failed universe the rate is meant to describe.
- **Impact**: Misleading digest sent to Slack/Telegram/OS (e.g. "40% success" when 40% completed, 5% failed, 55% still running). Cost/trend numbers are unaffected.
- **Fix sketch**: Divide by `completed + failed` (or filter the summary query to terminal statuses), consistent with `ExecutionState::TERMINAL`.

## 6. `spawn_temp_no_stderr` fully duplicates `spawn_temp` with identical behavior
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/cli_process.rs:278-293 vs 367-409
- **Scenario**: `spawn_temp` calls `build_and_spawn` → `build_and_spawn_core`, which already sets `.stderr(Stdio::null())`. `spawn_temp_no_stderr` re-implements the whole temp-dir + Command build inline and *also* sets `.stderr(Stdio::null())`. The two now produce byte-for-byte identical children — the "no_stderr" distinction that once justified the copy no longer exists. ~35 duplicated lines (env loop, creation_flags, kill_on_drop, temp-dir setup).
- **Root cause**: The variant predates `build_and_spawn_core` centralizing the stderr-null default; the copy was never re-collapsed.
- **Impact**: Maintainability — any spawn-hardening change (a new env strip, a flag) must be made in two places or silently diverges. Verified identical by reading both bodies.
- **Fix sketch**: Make `spawn_temp_no_stderr` delegate to `spawn_temp` (or have both call a shared temp-dir helper that calls `build_and_spawn`). Keep the public name for call-site stability.

## 7. Duplicated "parse-or-extract embedded JSON" block in output_assertions
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/output_assertions.rs:245-273 and 332-359
- **Scenario**: `eval_json_path` and `eval_json_schema` contain the same ~18-line pattern: try `serde_json::from_str(output)`, else find first `{` / last `}` and re-parse the slice, else return a "not valid JSON" failure. The two copies are identical except the error string.
- **Root cause**: Two evaluators independently needed "coerce output to a JSON value" and each inlined it.
- **Impact**: Maintainability — a fix to the embedded-JSON heuristic (e.g. handling arrays or fenced blocks) must be applied twice.
- **Fix sketch**: Extract `fn parse_output_json(output: &str) -> Option<serde_json::Value>` and have both evaluators call it, formatting their own error on `None`.

## 8. Brace-balanced JSON extraction reimplemented across engine modules
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/memory_reflection.rs:185-215 ; src-tauri/src/engine/auto_triage.rs:196-203 ; src-tauri/src/engine/output_assertions.rs:245-273
- **Scenario**: Three different "pull a JSON object out of prose/fenced LLM output" implementations coexist. `memory_reflection::extract_json_object` is the robust string/escape-aware brace matcher; `auto_triage::parse_verdict_response` uses a naive first-`{`/last-`}`; `output_assertions` uses first-`{`/last-`}` too. The doc comment in auto_triage even claims it "mirrors `genome_critique::parse_rewrite_response` and `eval::parse_llm_eval_response`" — i.e. at least five copies exist fleet-wide.
- **Root cause**: No shared LLM-JSON-extraction utility; each headless judge rolled its own, and the naive variants are strictly weaker than the string-aware one (they mis-cut on a `}` inside a string).
- **Impact**: Maintainability + correctness drift — the naive copies can extract a truncated object when a brace appears inside a string value.
- **Fix sketch**: Promote `memory_reflection::extract_json_object` to a shared `engine::json_extract` util and route the other parsers through it.

## 9. `match_event_listeners` is dead outside tests
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/bus.rs:298-305
- **Scenario**: `match_event_listeners` is annotated `#[allow(dead_code)]`. A workspace grep finds it referenced only within bus.rs itself (its own unit tests). No production dispatcher call-site uses it — the real dispatch path builds `ParsedTrigger`s and calls the generic `match_event` directly.
- **Root cause**: Convenience wrapper kept "in case", now only exercised by the tests written for it.
- **Impact**: Maintainability — a public-looking helper that misleads readers into thinking it's a live entry point. Low risk to remove (Tauri-invoke check n/a; it's a plain internal fn).
- **Fix sketch**: Either delete it and fold its logic into the tests, or wire the dispatcher through it to justify its existence. If kept, drop the `#[allow(dead_code)]` note explaining it's test-only.
