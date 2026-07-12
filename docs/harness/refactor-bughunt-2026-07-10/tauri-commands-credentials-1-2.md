> Context: tauri:commands/credentials [1/2]
> Total: 10
> Critical: 0  High: 1  Medium: 5  Low: 4

## 1. `openapi_parse_from_url` is a server-side request forgery (SSRF) sink
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/commands/credentials/openapi_autopilot.rs:640-682
- **Scenario**: A privileged caller passes `url = "https://169.254.169.254/latest/meta-data/iam/security-credentials/"` (or `https://10.0.0.5/...`, `https://192.168.1.1/...`). The only gate is the scheme match (`"https" => {}`, or `http` for `localhost`/`127.0.0.1`); host IP ranges are never checked, and the fetch uses `crate::SHARED_HTTP` — the plain client, **not** the SSRF-safe one. The link-local/private host passes the `https` arm and the request is issued to the internal address.
- **Root cause**: The sibling command `openapi_playground_test` (same file, line 817) deliberately uses `crate::SSRF_SAFE_HTTP` after the identical scheme check; `openapi_parse_from_url` was never migrated and keeps `SHARED_HTTP`. There is also no `.timeout()` on the `.send()`, so a hostile/slow endpoint can also hang the call indefinitely.
- **Impact**: security — cloud-metadata credential theft, internal port scanning, intranet spec exfiltration (the fetched body is parsed and errors echo it back). Blind + partial-oracle SSRF from a desktop app running on a corporate/cloud host.
- **Fix sketch**: Switch to `crate::SSRF_SAFE_HTTP` (matches `openapi_playground_test`), and/or run the URL through the same private/link-local/reserved-IP validator used in `oauth.rs::validate_issuer_url`. Add `.timeout(Duration::from_secs(10))` to the request.

## 2. `MAX_TOOL_INVOCATIONS` guard is cosmetic — it never stops a runaway browser session
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/credentials/auto_cred_browser.rs:966-1010, 1066-1089
- **Scenario**: A misbehaving Playwright MCP loop keeps emitting `AssistantToolUse`. The streaming callback increments `ctx.tool_call_count`; once it hits `MAX_TOOL_INVOCATIONS` (500) it only `queue_progress`-es a "Stopping session." warning. Nothing cancels the CancellationToken or kills the CLI child. `spawn_claude_and_collect` keeps reading lines until the model stops on its own or the 600s `BROWSER_TIMEOUT_SECS` fires. The `hit_tool_limit` branch is evaluated **after** the spawn returns, so it merely relabels an already-finished outcome as a `tool_limit` error.
- **Root cause**: The limit check lives in a read-only streaming callback that has no handle to the process/registry; the constant's doc-comment ("prevent infinite loops") describes behavior the code doesn't implement.
- **Impact**: UX / resource — a stuck session burns up to 10 minutes of wall-clock and unbounded LLM/Chromium spend before the "limit" takes effect; the warning text misleads maintainers into thinking it's enforced.
- **Fix sketch**: When `tool_call_count >= MAX_TOOL_INVOCATIONS`, actively kill the child (take PID from `registry` and taskkill/SIGTERM as the cancel path does) or trip a shared `CancellationToken` the read loop checks, so the session is torn down at the boundary rather than post-hoc.

## 3. Railway CLI capture stores `whoami` identity text into the `api_token` secret field
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/credentials/cli_capture.rs:418-438
- **Scenario**: The `railway` `CaptureSpec` declares a sensitive field `api_token` whose capture step is `railway whoami`. `railway whoami` prints identity text ("Logged in as user@example.com"), not a token. `run_step` returns that trimmed stdout and it is persisted verbatim as `api_token`. Any downstream healthcheck/agent HTTP call that sends `api_token` as a bearer/API token then authenticates with a human-readable identity string and fails.
- **Root cause**: Copy-paste from the `auth_check`/`verify_step` (also `railway whoami`) into a value-capture field. Contrast `fly_io` directly above, which correctly captures `api_token` via `flyctl auth token`; `railway`'s real token is not exposed by `whoami`.
- **Impact**: data correctness — the saved Railway credential contains garbage in its secret field; connections silently "save" but never work, and the value is marked sensitive so it's hard to eyeball.
- **Fix sketch**: If Railway's CLI exposes the token (e.g. a `railway ...` token subcommand / config file), capture that; otherwise make Railway verify-only (`fields: &[]`, like vercel/netlify) and let the user paste the token via the API-token tab.

## 4. Foraged-env import re-reads *every* env var mapped to a service, last-writer-wins
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/credentials/foraging.rs:746-764 (and ENV_PATTERNS 73-132)
- **Scenario**: The user reviews the scan and imports `env:github`. `EnvResolver::resolve` loops **all** `ENV_PATTERNS` where `service_type == "github"` — `GITHUB_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `GH_TOKEN` — all of which use `field_key = "api_key"`, and inserts each into the same `fields` map. Whichever pattern is iterated last silently overwrites the earlier ones, so which of several present tokens actually gets stored is non-deterministic (array order). Same collision for `supabase` (`SUPABASE_KEY` vs `SUPABASE_ANON_KEY`).
- **Root cause**: The foraged id (`env:{service_type}`) discards which specific env var the displayed entry represented; resolution re-derives from service_type instead of the concrete variable.
- **Impact**: data correctness / trust — the user may believe they imported a specific token (e.g. a fine-scoped PAT) but get a different one; no error surfaces.
- **Fix sketch**: Encode the concrete env var name into the foraged id (`env:{service_type}:{ENV_KEY}`) and have `EnvResolver` resolve exactly that variable, or dedupe by field_key with an explicit, documented precedence.

## 5. `detect_authenticated_services` cache is check-then-recompute — concurrent calls stampede
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src-tauri/src/commands/credentials/auth_detect.rs:765-806
- **Scenario**: The wizard mounts two panels that both call `detect_authenticated_services` within the same tick. Both take the cache lock, see it empty/stale, **release** it, then each independently runs `probe_cli_tools()` (spawns ~8 CLI subprocesses) and `probe_browser_cookies()` (copies Chrome + Edge cookie DBs to temp). The 5-minute cache is only written at the end, so it prevents nothing for in-flight duplicates.
- **Root cause**: The cache guards read and write in separate critical sections with no "in-progress" state, so overlapping callers each do the full work.
- **Impact**: resource / UX — duplicated subprocess spawns and cookie-DB copies (and the associated audit-log noise) on parallel wizard loads; harmless but wasteful.
- **Fix sketch**: Hold a single-flight primitive (e.g. `tokio::sync::Mutex<Option<JoinHandle>>` or an `OnceCell` future) so concurrent callers await the same probe run, or store an `InProgress` marker in the cache.

## 6. `extract_explanation` is duplicated verbatim across two job modules
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/nl_query.rs:456-483 and schema_proposal.rs:392-420
- **Scenario**: Both files define `fn extract_explanation(text: &str) -> Option<String>` with byte-for-byte identical bodies (same "find first fenced block, collect trailing non-block lines" logic). Verified by direct comparison of the two ranges. `schema_proposal.rs` even carries its own unit test for it (lines 428-440).
- **Root cause**: Both modules were cloned from the same NL→SQL scaffold; the shared helper was never lifted into `engine::ai_helpers` alongside `extract_fenced_block`.
- **Impact**: maintainability — a fix to one (e.g. handling multiple code blocks) silently diverges from the other.
- **Fix sketch**: Move the function to `engine::ai_helpers` (next to `extract_fenced_block`), call it from both, and keep the single existing test there.

## 7. AI-CLI background-job scaffold triplicated (nl_query / schema_proposal / query_debug)
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/nl_query.rs, schema_proposal.rs, query_debug.rs
- **Scenario**: All three share the same skeleton: a `static X_JOBS: BackgroundJobManager<...>`, `start_/get_snapshot/cancel_` command trio, a `RunParams` struct destructured 1:1, an `emit_line` wrapper, and the identical CLI-arg build (`prompt::build_cli_args(None,None)` + push `--model claude-sonnet-4-6` + `--max-turns 1`) fed to `run_claude_prompt_text_inner(..., 120)`. `ai_artifact_flow.rs` already proves the "one generic runner, many instantiations" pattern works for the design/negotiator flows.
- **Root cause**: These three DB-query AI flows predate (or were not migrated onto) the `AiArtifactParams`/`run_ai_artifact_task` generalization used by `credential_design`.
- **Impact**: maintainability — three copies of the model pin, timeout, and status-transition logic drift independently (e.g. only some emit on cancel).
- **Fix sketch**: Extract a shared helper for the CLI-arg build + single-turn spawn, and consider expressing the three flows through a small parameterized runner analogous to `AiArtifactMessages`/`run_ai_artifact_task`.

## 8. `extract_sql_block` reimplements `ai_helpers::extract_fenced_block`
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/nl_query.rs:398-453
- **Scenario**: `nl_query.rs` hand-rolls fenced-code-block extraction (tag detection, sql-dialect allowlist, unclosed-block handling), while the sibling `schema_proposal.rs:273` and `query_debug.rs:333` both call `ai_helpers::extract_fenced_block(&output, "sql"/language)` for the same purpose.
- **Root cause**: Divergent evolution — one module kept its bespoke extractor while the others adopted the shared helper.
- **Impact**: maintainability — inconsistent block-selection semantics for the same "get the SQL out of the LLM reply" task.
- **Fix sketch**: Replace `extract_sql_block` with `ai_helpers::extract_fenced_block`; if the "prefer sql-tagged, fall back to first block, accept several dialect tags" behavior is genuinely needed, fold those options into the shared helper.

## 9. Dead `invalidate_auth_detect_cache` while callers inline-duplicate its body
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/commands/credentials/auth_detect.rs:755-759
- **Scenario**: `invalidate_auth_detect_cache(state)` is `#[allow(dead_code)]` and is not called anywhere — the two OAuth success paths in `oauth.rs` (lines 559-560 and 1724-1725) instead inline the exact one-liner `*auth_detect_cache.lock().await = None;`. Verified: the helper is the only defined invalidator, yet the invalidation is open-coded at both real call sites.
- **Root cause**: The helper was written as the intended API but the OAuth flows reached into the field directly, leaving the helper stranded.
- **Impact**: maintainability — the `#[allow(dead_code)]` masks an unused pub fn; the tracing/logging inside the helper never runs for the two invalidations that matter.
- **Fix sketch**: Call `invalidate_auth_detect_cache(&state)` from the two OAuth success blocks and drop the `#[allow(dead_code)]`, or delete the helper if the inline form is preferred.

## 10. Prompt-builder field-description block duplicated across four builders
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/credentials/auto_cred_browser.rs:351-368, 440-457 (and 534/609 for service defaulting)
- **Scenario**: `build_browser_prompt` and `build_guided_prompt` contain an identical `fields_desc` construction loop (format `- \`{key}\` ({label})`, append `[REQUIRED]`/placeholder/help_text). The two universal builders (`build_universal_browser_prompt`, `build_universal_guided_prompt`) likewise repeat the same `service_url`/`service_description` unwrap-or-default preamble.
- **Root cause**: Four prompt variants grew by copy-paste from a common ancestor; only the surrounding template text differs.
- **Impact**: maintainability — a change to how fields are rendered (e.g. new field attribute) must be made in two places and can silently skew the browser vs guided prompts.
- **Fix sketch**: Extract `fn render_fields_desc(&[AutoCredField]) -> String` and a small `service_targets(&req) -> (&str,&str)` helper, and call them from all four builders.
