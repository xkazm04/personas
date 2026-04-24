# `engine::runner` — persona execution orchestrator

**Entry point:** [`run_execution`](./mod.rs) — a long-lived async task that
spawns the Claude Code CLI as a subprocess, streams its `stream-json` output,
and persists results. The other modules in this directory are helpers the
orchestrator drives during the four pipeline stages; they don't expose any
behavior on their own.

## Module map

| File | Responsibility | Public to |
|---|---|---|
| [`mod.rs`](./mod.rs) | `run_execution` orchestrator + `DEFAULT_EXECUTION_TIMEOUT_MS` + tests. Calls every helper below. | engine, callers of `engine::runner::run_execution` |
| [`env.rs`](./env.rs) | Env-var name sanitation (`BLOCKED_ENV_NAMES`, `sanitize_env_name`) + per-credential OAuth refresh mutex pool (`credential_refresh_lock`). | `sanitize_env_name` is `pub(crate)` (used by `engine::mcp_tools`); the rest is `pub(super)`. |
| [`globals.rs`](./globals.rs) | Global-settings fallback when a `ModelProfile` field is empty + canonical `default_result()` zero-value for early-error returns. | `pub(super)` only. |
| [`credentials.rs`](./credentials.rs) | Tool → connector → credential matching, OAuth refresh, env-var injection. `resolve_credential_env_vars`, `inject_design_context_credentials`, `inject_connector_credentials`, `inject_credential`. | `resolve_credential_env_vars`, `inject_connector_credentials`, `inject_credential` are `pub(crate)` (used by `engine::build_session`, `engine::tool_runner`). |

## Pipeline stages inside `run_execution`

The orchestrator reads top-to-bottom as four labelled sections. The headers
inside `mod.rs` match this table exactly — grep for `// -- Pipeline Stage`.

| Stage | What happens | Key helpers called |
|---|---|---|
| **Validate** | Log setup, group/workspace cascade, parse `ModelProfile`, detect ops/simulation mode, expand use-case, honour per-UC `model_override`, capability-contract pre-check, credential resolution. | `globals::resolve_global_provider_settings`, `credentials::resolve_credential_env_vars`, `credentials::inject_design_context_credentials`, `capability_contract::check_contract`. |
| **SpawnEngine** | BYOM policy eval, failover chain assembly, `assemble_prompt` + memory injection, `ExecutionConfig` snapshot, `.claude/settings.json` sidecar (hooks + MCP), `CliProcessDriver::spawn`. | `prompt::assemble_prompt`, `prompt::build_cli_args`, `hooks_sidecar::install_sidecar`, `cli_mcp_config::install_mcp_sidecar`, `CliProcessDriver::spawn`. |
| **StreamOutput** | Read `stream-json` lines from the child stdout, dispatch protocol messages (user_message / agent_memory / manual_review / emit_event / …) mid-stream, track cost + session id. | `parser::parse_stream_line`, `dispatch::DispatchContext::dispatch_message`, `logger::ExecutionLogger`. |
| **FinalizeStatus** | Wait for child exit, post-mortem parse for missed protocol messages, outcome assessment, drive-sync diff, persist final status + cost + duration, emit completion events, close log. | `parser::extract_execution_flows`, `parser::parse_outcome_assessment`, `drive::diff_and_emit_drive_events`, `exec_repo::update_status`. |

## Invariants

* **Failover chain** — `run_execution` never throws on provider failure. Every
  retryable error (binary not found, rate limited, session limit) records a
  failure with the circuit breaker and tries the next candidate in
  `failover_chain`. Only when every candidate is exhausted does the execution
  fail.

* **Credential decryption is a hard gate** — if
  `resolve_credential_env_vars` returns any `failures`, the execution aborts
  before spawn. Users must rotate or re-enter the named credential before
  retrying. No partial fallback.

* **Post-exec drive sync** — every execution snapshots the managed drive
  root before spawn and diffs it after. Any file the persona wrote via the
  standard CLI tools into the sandbox surfaces as a `drive.document.*` event
  even when the LLM didn't call `drive_write_text` directly.

* **Exec dir is per-persona, stable** —
  `std::env::temp_dir()/personas-workspace/<persona.id>` persists across
  executions so `.claude/settings.json` (hooks + MCP config) and any work
  the persona does on disk isn't wiped between runs.

* **Timeout floor** — `DEFAULT_EXECUTION_TIMEOUT_MS = 660_000` (11 min) is
  deliberately above the Claude CLI 2.1.113 subagent-stall cutoff (10 min)
  so the CLI's clearer mid-stream error surfaces before the outer process
  timeout fires. There is a test that guards this invariant.

## Callers (cross-module surface)

* `engine::ExecutionEngine::run_execution_with_ceiling` — wraps
  `run_execution` with the 20-minute engine ceiling.
* `engine::build_session::run_session` — calls
  `credentials::resolve_credential_env_vars` when preparing build-time tool
  tests.
* `engine::tool_runner::invoke_tool_direct` — calls
  `credentials::resolve_credential_env_vars` for direct (no-LLM) tool
  invocation.
* `engine::mcp_tools::execute_tool_stdio_inner` — calls
  `env::sanitize_env_name` when building the MCP child env map.
* `commands::gitlab::converter` — comment reference only; mirrors the env
  naming convention.

## How to extend

1. **Adding a new credential type** — add the OAuth token endpoint in
   `credentials::try_refresh_oauth_token`'s match, and add the provider
   prefix to the Google-family alias block in `inject_credential` if it
   needs alias env vars.
2. **Adding a new blocked env var** — append to `BLOCKED_ENV_NAMES` in
   `env.rs`. The denylist is intentionally the single source of truth.
3. **Adding a new pipeline stage helper** — if the helper is self-contained
   and used from only one stage, put it in a new file under
   `runner/` and make it `pub(super)`. Don't add to `globals.rs` unless it's
   truly a cross-stage utility.
4. **Splitting a pipeline stage into its own file** — see the "Deferred
   work" section below.

## Deferred work

`run_execution` itself is still a ~1900-line function. Splitting it into
four stage modules (`validate.rs`, `spawn.rs`, `stream.rs`, `finalize.rs`)
requires introducing an `ExecutionContext` struct to thread the 30+ local
state values between stages without a 50-parameter function call. That is
a separate refactor — this module boundary (extracting the self-contained
helpers) is a deliberately smaller first pass.

When the stage split lands, the ExecutionContext should live in
`mod.rs` and each stage module should take `&mut ExecutionContext` as its
sole argument. Keep the same section headers so `grep "-- Pipeline Stage"`
still works as a navigation landmark.

## For future LLM CLIs reading this file

If you're another Claude / Codex / Cursor agent opening this directory
cold, the cheapest entry points are:

1. **Read this README first.** The module map + pipeline stages give you a
   mental model in <5 minutes.
2. **`grep "// -- Pipeline Stage" mod.rs`** to jump between the four
   sections without scrolling.
3. **`resolve_credential_env_vars` in `credentials.rs`** is the most
   invoked public helper; start there when debugging credential issues.
4. **Never change `env::BLOCKED_ENV_NAMES` without a security rationale.**
   Items leaving that list become attack surface on every persona
   execution. Add, don't remove.
