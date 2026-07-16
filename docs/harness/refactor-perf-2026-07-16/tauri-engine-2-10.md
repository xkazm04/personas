# tauri:engine [2/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 2 high / 3 medium / 1 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Raw byte-index string slicing in LLM eval can panic on multi-byte UTF-8 output
- **Severity**: High
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/engine/eval.rs:543 (also eval.rs:693)
- **Scenario**: `build_llm_eval_prompt` truncates the agent's output with `&input.output[..3000]` when `len() > 3000`. Agent output routinely contains emoji, smart quotes, or non-Latin text; if byte 3000 lands mid-codepoint, the slice panics and the whole eval task dies instead of degrading to the heuristic fallback. Same pattern at line 693: `&trimmed[..trimmed.len().min(500)]` in the parse-failure message.
- **Root cause**: Byte-index slicing used where a char-boundary-safe truncation is required; the codebase already has `crate::utils::text::truncate_on_char_boundary` (used in desktop_bridges.rs:547 and tool_runner.rs:728) and `engine::str_utils::truncate_str` (used by healing.rs / ai_healing.rs), but eval.rs rolls its own raw slices.
- **Impact**: A panic in the eval path aborts scoring for that test run entirely — worse than the designed fallback path. Also a consistency/duplication smell: three truncation idioms exist and the one unsafe idiom lives in the two spots handling arbitrary LLM text.
- **Fix sketch**: Replace both raw slices with `crate::utils::text::truncate_on_char_boundary(s, N)` (or `str_utils::truncate_str`). Two-line change per site; add a test with a 4-byte emoji straddling the boundary.

## 2. ~150-line per-member adoption loop duplicated between adopt_preset and retry_failed_members
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/team_preset_adopter.rs:318 (vs. :636)
- **Scenario**: Any change to the member-adoption pipeline (e.g. a new failure arm, a new post-adopt step like the `bind_persona_home_team` follow-up, changed progress statuses) must be applied twice; the two copies have already begun to drift stylistically (adopt path emits `queued` first, retry path skips it — intentional, but buried).
- **Root cause**: `adopt_preset` and `retry_failed_members` each inline the identical sequence: `load_template_design_by_id` → `instant_adopt_template_inner` → `persona_id_from_adopt_value` → `bind_persona_home_team` → `add_member` → push member/failure → `emit_progress`, with four structurally identical error arms (push failure + emit `failed` + continue) in each copy.
- **Impact**: ~150 duplicated lines in one file; classic drift hazard for a flow with partial-success semantics where a missed edit in one copy silently changes retry behavior.
- **Fix sketch**: Extract `fn adopt_single_member(state, app, preset_id, manifest_member, home_team_id, team_id, overrides) -> Result<AdoptedTeamPresetMember, AdoptedTeamPresetFailure>` that owns the load→adopt→bind→add_member→emit sequence (emitting `adopting`/`done`/`failed` internally). Both callers reduce to a filter + loop + bookkeeping. Connection-wiring differences stay in the callers.

## 3. Bridge result-wrapping boilerplate repeated across all four desktop bridges
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/desktop_bridges.rs:58 (vscode), :168 (docker), :434 (terminal), :774 (obsidian)
- **Scenario**: Adding a fifth bridge (or changing how `action_name` is derived / how errors map to `BridgeActionResult`) requires touching four near-identical blocks.
- **Root cause**: Each bridge's `execute` repeats the same prologue/epilogue: `action_name` via `format!("{:?}", &action).split_whitespace().next()`, `Instant::now()` timing, and the identical `match result { Ok → BridgeActionResult{success:true,…}, Err → BridgeActionResult{success:false,…} }` differing only in the `bridge:` literal.
- **Impact**: ~25 duplicated lines × 4 sites; low regression risk but easy consolidation with clear benefit for the stated "more bridges in later phases" roadmap.
- **Fix sketch**: Add `fn wrap_bridge_result(bridge: &'static str, action_name: String, start: Instant, result: Result<String, AppError>) -> BridgeActionResult` plus a small `action_name_of(debug_repr)` helper at module level; each bridge's `execute` becomes the action match plus one wrap call.

## 4. Slack poller builds a fresh reqwest::Client per poll and per reply on a 5-second loop
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: resource-management
- **File**: src-tauri/src/engine/slack_poller.rs:485 (also :563)
- **Scenario**: With inbound Slack polling enabled, `tick` runs every 5s and calls `fetch_new_messages` per (persona, channel), which does `reqwest::Client::builder().build()` each time; `post_reply` builds another client per reply. Every tick therefore pays client construction (TLS config, pool setup) and — because the pool is dropped immediately — a full fresh TCP+TLS handshake to slack.com per request, forever.
- **Root cause**: Clients are constructed inside the per-call functions instead of being reused; the crate already maintains shared clients (`crate::SSRF_SAFE_HTTP`, `crate::HTTP_ALLOW_PRIVATE`) and connection pooling is the entire point of a long-lived `reqwest::Client`.
- **Impact**: Constant background CPU + network waste and added per-tick latency (handshake every 5s per channel) on a loop that runs for the app's whole lifetime; also N×tick allocator churn. Only bites when Slack inbound polling is configured, but then it bites continuously.
- **Fix sketch**: Create one `static SLACK_HTTP: LazyLock<reqwest::Client>` (timeout `HTTP_TIMEOUT`) in the module — or reuse `crate::SSRF_SAFE_HTTP` with a per-request timeout — and pass/reference it from `fetch_new_messages`, `fetch_history_page`, and `post_reply`. Keep-alive then reuses one connection across ticks.

## 5. Scraper constructs a new SSRF-safe client (and Fetcher) per fetch call
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: resource-management
- **File**: src-tauri/src/engine/scraper.rs:100
- **Scenario**: `fetch_readable`, `fetch_html_snippet`, `run_extract`, and `preview_extract` each call `fetcher()`, which calls `url_safety::build_ssrf_safe_client(...)` — a brand-new reqwest client per invocation. A cron-scheduled pipeline (`scraper_schedule_tick`) or an MCP `fetch_readable` burst re-pays client construction and loses connection reuse across runs of the same config (same hosts every run).
- **Root cause**: `fetcher()` is a convenience constructor with no caching; nothing memoizes the client even though it is configuration-free (fixed 30s timeout).
- **Impact**: Bounded (calls are user- or schedule-driven, and `run_extract` at least shares one fetcher across its URL list), but scheduled scrapes against the same hosts re-handshake every run and pay client-build cost per tick with multiple due configs.
- **Fix sketch**: Hoist the client into a `static SCRAPER_HTTP: LazyLock<reqwest::Client>` (or a `LazyLock<Fetcher>` if `Fetcher` is `Sync`) and have `fetcher()` clone the shared client into the `SsrfSafeHttpClient` wrapper. reqwest clients are cheap to clone (Arc internally).

## 6. Connector cache clones the entire connector list on every proxied API request
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: caching
- **File**: src-tauri/src/engine/api_proxy.rs:70
- **Scenario**: `execute_api_request` calls `get_all_connectors_cached` per request; on a cache hit it returns `entry.connectors.clone()` — a deep clone of every `ConnectorDefinition` (each carrying `fields`/`services`/`events`/`metadata` JSON strings) — only for the caller to `.find()` a single connector by name and read one metadata pointer.
- **Root cause**: The cache API returns an owned `Vec` instead of a shared handle, so the TTL cache eliminates the DB hit but not the per-request allocation cost.
- **Impact**: Tens of KB of string allocations per proxied request (and per `cached_connector_keywords` call), proportional to registry size. Bounded, but it is pure waste on the proxy hot path that agents drive in loops.
- **Fix sketch**: Store `Arc<Vec<ConnectorDefinition>>` in `ConnectorCache` and return `Arc` clones (`fn get_all_connectors_cached(...) -> Result<Arc<Vec<ConnectorDefinition>>, _>`). Call sites only iterate/find, so they compile unchanged apart from the type; `cached_connector_keywords` maps over the borrowed slice.
