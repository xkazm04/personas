> Context: tauri:engine (misc 2)
> Total: 9
> Critical: 0  High: 1  Medium: 4  Low: 4

## 1. Byte-boundary panic truncating persona prompt content in advisory mode
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/engine/prompt/advisory.rs:50-54, 66-72
- **Scenario**: If a persona's `structured_prompt.identity`/`instructions` exceeds 2000 bytes (or another section exceeds 500), and the byte at that index falls inside a multibyte UTF-8 char (emoji, CJK, accented text — common in real prompts), then `&val[..max_len]` panics (`byte index N is not a char boundary`). Same for `&persona.system_prompt[..max_len]` on line 68. A panic in the advisory execution task aborts that run and produces no output.
- **Root cause**: Raw byte slicing (`&s[..n]`) on arbitrary user/LLM-authored text, assuming ASCII. Note transcript.rs already has the correct pattern (`truncate_for_prompt` uses `char_indices`/`chars().take`).
- **Impact**: crash / execution failure whenever an advisory-mode persona has non-ASCII content longer than the caps.
- **Fix sketch**: Replace the four `&text[..max]` slices with a char-safe helper, e.g. `text.chars().take(max_len).collect::<String>()`, or reuse a shared `truncate_for_prompt`-style util.

## 2. Byte-boundary panic truncating provider HTTP error bodies
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/http_engine/openai.rs:108; src-tauri/src/engine/http_engine/tools.rs:81
- **Scenario**: On a non-2xx response from the remote model API, both paths build the error message with `&text[..text.len().min(300)]`. If the error body is >300 bytes and byte 300 lands mid-multibyte-char (localized error JSON from DashScope-intl is plausibly non-ASCII), the slice panics — turning a recoverable "API error" into a task-aborting panic.
- **Root cause**: Same raw byte-slice assumption as finding 1, in the error-reporting path (ironically the failure handler itself can fail).
- **Impact**: crash on the error path; the user loses the actual upstream error text and the run dies uncleanly.
- **Fix sketch**: Use `text.chars().take(300).collect::<String>()` (or a shared helper). Both call sites are identical — good place to introduce one `truncate_chars(&str, usize)` util.

## 3. SSRF egress guard bypassable via IPv4-mapped / link-local IPv6
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/http_engine/tools.rs:252-261 (`is_blocked_ip`)
- **Scenario**: The `http_get` built-in is exposed to a remote (prompt-injectable) model. A hostname that resolves to `::ffff:127.0.0.1` (IPv4-mapped IPv6 loopback) passes the guard: `Ipv6Addr::is_loopback()` is true only for `::1`, `is_unspecified()` false, and `segments()[0] & 0xfe00 != 0xfc00`. So the request reaches loopback/private services. IPv6 link-local (`fe80::/10`) is likewise not checked.
- **Root cause**: The V6 arm only covers `::1`, `::`, and `fc00::/7`; it doesn't canonicalize IPv4-mapped addresses or block `fe80::/10`. The V4 arm is thorough, but a mapped address never reaches it.
- **Impact**: security — remote-model-driven SSRF to internal/loopback endpoints (including the local :9420 credential bridge).
- **Fix sketch**: In the V6 arm, first `if let Some(v4) = v6.to_ipv4_mapped() { return is_blocked_ip(&v4.into()) }`, and add `v6.segments()[0] & 0xffc0 == 0xfe80` (link-local) to the block list.

## 4. Zapier catch-hook validation POSTs to an unvalidated (AI-supplied) URL
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/platforms/zapier.rs:33-52; caller deploy.rs:373-389
- **Scenario**: `deploy_zapier` takes `hook_url` from `design.workflow_definition["catch_hook_url"]` or `design.webhook_url` — both originate in LLM-generated design output — and `validate_catch_hook` sends a POST to it with no scheme allow-list, no host/IP filtering. A design result naming `http://localhost:9420/...` or an internal address triggers an app-initiated POST to an internal service (unlike n8n's `trigger_webhook`, which enforces https + origin match, and unlike `http_get_guarded`'s IP checks).
- **Root cause**: The Zapier path trusts the design payload's URL directly; the SSRF discipline applied elsewhere in the engine wasn't applied here.
- **Impact**: security — SSRF via a crafted/hallucinated design result during deploy.
- **Fix sketch**: Before the POST, parse the URL, require `https`, and reject hosts resolving to loopback/private/link-local (reuse the `is_blocked_ip` helper, once finding 3 is fixed).

## 5. Dead-letter write clobbers a concurrently-set terminal status
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src-tauri/src/engine/execution_engine/persist.rs:188-202
- **Scenario**: `persist_status_if_not_final` deliberately uses the conditional writer to avoid overwriting a terminal state. But when all conditional retries fail, its dead-letter path calls the *unconditional* `exec_repo::update_status(... Failed ...)`. If another writer set the row to `Completed`/`Cancelled` in the interim, this forces it back to `Failed`, defeating the "if not final" guarantee this function exists to provide.
- **Root cause**: The recovery path drops the conditional predicate it was built around (narrow — only reachable after repeated DB errors).
- **Impact**: data (final execution status corrupted Completed→Failed) in a rare error+race window.
- **Fix sketch**: Use `update_status_if_not_final` for the dead-letter write too (or re-check current status before forcing Failed).

## 6. Duplicated retry + dead-letter + healing-event logic across two persist fns
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/execution_engine/persist.rs:21-106 vs 138-225
- **Scenario**: `persist_status_update` and `persist_status_if_not_final` share a near-verbatim exponential-backoff loop, the `if !matches!(update.status, Failed)` dead-letter block, and the ~20-line `HealingEventPayload{..}` emit (only the differing bits: which repo fn is called and one log message). Verified by side-by-side: the dead-letter + emit blocks are byte-identical apart from the "conditional" wording.
- **Root cause**: Copy-paste growth of three persist variants that never had their common tail factored out.
- **Impact**: maintainability — a fix like finding 5 or any change to the healing payload must be made in two/three places and can drift.
- **Fix sketch**: Extract `fn dead_letter_and_alert(pool, app, exec_id, update, err_msg)` and a small `retry_with_backoff(op)` closure runner; have all three variants call them.

## 7. `create_and_activate` and `create_with_error` are near-identical
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/platforms/deploy.rs:468-527 vs 531-592
- **Scenario**: Both build the exact same 16-field `CreateAutomationInput`, call `automation_repo::create`, then `update` with an `UpdateAutomationInput` that differs only in `deployment_status` (Active vs Error) and `error_message`. ~60 lines duplicated verbatim, each carrying the same 14-arg `#[allow(clippy::too_many_arguments)]` signature.
- **Root cause**: Two success/failure variants written separately instead of parameterizing the final status.
- **Impact**: maintainability — any new automation field must be added to two long argument lists and two identical construction blocks.
- **Fix sketch**: One helper taking a `status: AutomationDeployStatus` + `error_message: Option<&str>`; or pass a small `CreateAutomationInput` struct rather than 14 positional args.

## 8. `apply_provider_env` is a no-op with a vestigial single-arm match
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/prompt/cli_args.rs:19-28
- **Scenario**: After the Ollama/LiteLLM/Custom provider removal (per the doc comment), the function is `match profile.provider { _ => { let _ = (cli_args, profile); } }` — it reads its inputs, matches everything to one arm, and does nothing. It's still called from `build_cli_args_inner` and `test_runner`, so it can't be deleted blindly, but the match and the discard are pure ceremony.
- **Root cause**: An extension point left behind after all real branches were deleted.
- **Impact**: maintainability — reads as if it does provider-specific work when it does not; misleads future edits.
- **Fix sketch**: Collapse to an empty body with a one-line comment (drop the `match` and the `let _ =`), or remove the fn and its call sites if no provider env is foreseen.

## 9. Structurally identical A2A message/response types
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/a2a/types.rs:141-148 vs 202-209; 131-160 vs 237-269
- **Scenario**: `A2AResultMessage` and `A2AStatusMessage` have identical fields (`kind`, `role`, `parts`, `messageId`) and identical serde. Separately, `A2AResponse` and `A2ATaskResponse` share the `jsonrpc`/`id`/`result`/`error` envelope and have byte-identical `success`/`error` associated fns differing only in the `result` type. Verified by direct field comparison.
- **Root cause**: Per-method wire structs grown independently rather than sharing a generic envelope/message type.
- **Impact**: maintainability (low) — spec/shape changes must be mirrored across pairs.
- **Fix sketch**: Alias `A2AStatusMessage = A2AResultMessage` (single struct), and make the response envelope generic over the result payload (`A2AEnvelope<T>`), collapsing the two `success`/`error` impls into one.
