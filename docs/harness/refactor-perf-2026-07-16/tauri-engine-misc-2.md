# tauri:engine (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 4 medium / 2 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Retry/dead-letter/healing-event logic triplicated across persist helpers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/execution_engine/persist.rs:21
- **Scenario**: `persist_status_update` (lines 21-106) and `persist_status_if_not_final` (lines 138-225) each hand-roll the same retry-with-exponential-backoff loop, the same dead-letter force-fail write, and a byte-for-byte identical 15-field `HealingEventPayload` emission; `persist_status_if_running` (109-134) carries a third copy of the retry loop. They have already drifted: the first logs the dead-letter failure (`tracing::error!` at line 77), the second silently discards it (`let _ =` at line 189).
- **Root cause**: The conditional variants were added by copying the unconditional function instead of extracting the retry loop and the failure tail (dead-letter + healing event) into shared helpers.
- **Impact**: ~130 duplicated lines on the execution-status hot path; any change to retry policy, dead-letter shape, or the healing payload must be made in 2-3 places and has already been missed once (the swallowed dead-letter error).
- **Fix sketch**: Extract `async fn retry_persist<F: Fn() -> Result<T, E>>(op: F) -> Result<T, E>` for the backoff loop, and a `fn emit_persist_lost(app, exec_id, title, err_msg)` + `fn dead_letter(pool, exec_id, update, err_msg)` pair for the failure tail. Each public function becomes ~10 lines of composition; restore error logging on both dead-letter paths.

## 2. deploy.rs create_and_activate / create_with_error are near-identical 60-line twins
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/platforms/deploy.rs:468
- **Scenario**: Both helpers (468-527 and 532-592) take the same fifteen positional arguments, build an identical `CreateAutomationInput`, insert, then issue an `UpdateAutomationInput` where the only differences are `deployment_status` (Active vs Error) and `error_message`. Both update structs spell out all 16 `None` fields by hand.
- **Root cause**: The error variant was cloned from the success variant when activation-failure handling was added, and `UpdateAutomationInput` isn't being constructed via `..Default::default()`.
- **Impact**: ~120 lines that must stay in lockstep; the fifteen-positional-arg call sites in `deploy_n8n` (168-205) are easy to mis-order since most parameters are `Option<&str>` of the same type.
- **Fix sketch**: Collapse into one `fn create_with_status(pool, params: NewAutomationParams, status: AutomationDeployStatus, error_msg: Option<&str>)` where `NewAutomationParams` is a small struct built once in each deploy fn (also fixing the positional-arg hazard). Use `UpdateAutomationInput { deployment_status: Some(status), error_message: error_msg.map(|m| Some(m.into())), ..Default::default() }` if the type derives Default (add the derive if not).

## 3. apply_provider_env is a no-op kept alive with a wildcard match
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/prompt/cli_args.rs:19
- **Scenario**: `apply_provider_env` matches `profile.provider` with a single `_ =>` arm whose body is `let _ = (cli_args, profile);` — it does literally nothing, and its own doc comment says the Ollama/LiteLLM/Custom paths were removed. It is still called from `build_cli_args_inner` (line 158) and, per the comment, test_runner.
- **Root cause**: When non-Anthropic provider support was removed, the function body was emptied but the function and its call sites were left in place as a seam "in case providers come back."
- **Impact**: Dead indirection on every CLI-args build; readers must open the function to learn it does nothing, and the empty `match` with a bound-then-discarded tuple is confusing.
- **Fix sketch**: Delete the function and its call sites (grep for `apply_provider_env` in test_runner and any tests first — cross-context callers need verification). If the seam is intentionally reserved, reduce it to a one-line documented stub without the fake `match`, or gate it behind a comment pointing at the removal rationale only at the (single) call site.

## 4. New reqwest Client built per execution in the HTTP engine (streaming + tool loop)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: resource-reuse
- **File**: src-tauri/src/engine/http_engine/openai.rs:92
- **Scenario**: Every remote-HTTP execution calls `Client::builder().timeout(...).build()` — once in `run_streaming` (openai.rs:92) and again in `run_tool_loop` (tools.rs:38). Each fresh client gets its own connection pool, so every persona execution (and every one of up to 6 tool-loop round-trips shares within, but never across, executions) pays a new TCP + TLS handshake to DashScope.
- **Root cause**: The module predates the shared-client pattern the codebase already adopted elsewhere (`GITHUB_HTTP` in platforms/github.rs:71, `ZAPIER_HTTP` in platforms/zapier.rs:11, `crate::SHARED_HTTP` used by n8n.rs:122).
- **Impact**: Extra ~100-300 ms TLS setup latency per execution and redundant sockets on a path that runs for every Qwen persona execution; also inconsistent with the established shared-client convention.
- **Fix sketch**: Add a `static HTTP_ENGINE_CLIENT: LazyLock<reqwest::Client>` in http_engine/config.rs with the 600 s timeout, and have both `run_streaming` and `run_tool_loop` clone it (clones share the pool). The per-request 10 s override in `http_get_guarded` (tools.rs:241) already shows per-call timeouts work fine on a shared client.

## 5. deploy_n8n decrypts the same credential twice (double DB work + duplicate audit rows)
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/platforms/deploy.rs:140
- **Scenario**: `deploy_n8n` calls `n8n::build_client_from_credential` (line 104), which does `get_by_id` + `get_decrypted_fields` + writes an audit-log row — then at lines 140-141 fetches and decrypts the exact same credential a second time just to read `base_url`, writing a second `log_decrypt` audit row for one logical deploy.
- **Root cause**: `build_client_from_credential` keeps the decrypted fields private inside `N8nClient`, so the caller re-derives them instead of the builder returning (client, fields) or the client exposing `base_url()`.
- **Impact**: Two decrypt operations and two credential queries where one suffices, and — worse for trust — the credential audit trail records two decrypts per deploy, inflating and distorting the security log this app treats as a feature.
- **Fix sketch**: Add `pub fn base_url(&self) -> &str` to `N8nClient` (it already stores `base_url`) and use it in `deploy_n8n`, deleting lines 140-152's second fetch/decrypt/audit. Alternatively have `build_client_from_credential` return `(N8nClient, HashMap<String,String>)`; either way one decrypt, one audit row.

## 6. Transcript reader accumulates every turn in memory before tailing
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: unbounded-buffer
- **File**: src-tauri/src/engine/cli_session_awareness/transcript.rs:79
- **Scenario**: `read_recent_turns` pushes every user/assistant turn in the whole JSONL file into `turns`, then drains all but the last `max_turns` (lines 93-96). A long-lived Claude Code session transcript can hold thousands of turns; at up to 500 chars each (plus role Strings and Vec overhead), a 10k-turn transcript allocates megabytes to return ~5 turns, on every daemon-fired prompt assembly while the session is active.
- **Root cause**: Simplest-thing-first implementation; the inline comment claims "the memory cost is bounded" but it is O(turns in file), only each turn's text is bounded.
- **Impact**: Bounded-per-call but avoidable allocation churn on prompt assembly; scales with the user's session length, which is exactly when this feature is most active.
- **Fix sketch**: Keep a `VecDeque<TranscriptTurn>` capped at `max_turns`: `if buf.len() == max_turns { buf.pop_front(); } buf.push_back(turn);` inside the read loop, then `buf.into_iter().collect()`. Same chronological output, O(max_turns) memory, no other behavior change (the existing tests should pass unmodified).
