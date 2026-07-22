# tauri:engine [6/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 2 medium / 2 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. Polling triggers fetched strictly sequentially — one slow endpoint delays every other due trigger by up to 30s
- **Severity**: High
- **Lens**: perf-optimizer
- **Category**: serial-io
- **File**: src-tauri/src/engine/polling.rs:184
- **Scenario**: `poll_due_triggers` iterates due triggers in a plain `for` loop and `await`s each HTTP GET before starting the next. The shared client is built with a 30s timeout (`background.rs:412`, `build_ssrf_safe_client(Duration::from_secs(30))`). With N polling triggers where one endpoint is down/hanging, every trigger behind it in the list fires up to 30s late per stall; several dead endpoints compound linearly and can push the whole tick past the subscription interval.
- **Root cause**: Serial `req.send().await` + `response.text().await` inside the trigger loop; no concurrency between independent triggers.
- **Impact**: Trigger firing latency becomes hostage to the slowest configured URL; a user with 10 polling triggers and 2 unreachable hosts waits ~60s extra every cycle. Wasted wall-clock on an always-on background loop.
- **Fix sketch**: Split the loop: compute the per-trigger work (config parse, SSRF check) synchronously, then run the HTTP fetch + hash-compare + CAS phase per trigger as a future and drive them with bounded concurrency, e.g. `futures_util::stream::iter(jobs).for_each_concurrent(4, ...)`. The CAS in `mark_triggered_with_hash` already makes concurrent completion safe (it exists precisely to dedupe racing cycles), so no new locking is needed; keep the per-trigger DB writes as they are.

## 2. Share-link download clones the whole bundle (up to 50 MB) while holding the global store mutex
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: lock-contention
- **File**: src-tauri/src/engine/share_link.rs:364
- **Scenario**: `handle_share_download` marks the entry consumed and then does `entry.bytes.clone()` before `drop(store)`. Bundles are bounded by MAX_DECOMPRESSED_SIZE = 50 MB, so a large-bundle download copies tens of MB while `SHARE_STORE` is locked, blocking concurrent `create_share_link`, `revoke`, and other downloads (and it's a std `Mutex` inside an async handler, so the axum worker thread stalls too).
- **Root cause**: The entry is consumed-forever after this request, yet the code mutates it in place and clones the bytes instead of taking ownership.
- **Impact**: Memory spike (2× bundle size transiently) plus mutex hold time proportional to bundle size on the P2P share path; a second peer clicking a link at the same moment waits behind the memcpy. Also, consumed entries linger in the map (bytes retained) until the next `evict_expired` call.
- **Fix sketch**: After validating not-consumed/not-expired, `let entry = store.remove(&token)` and serve `entry.bytes` by value — zero clone, entry memory freed immediately, and the "consumed" state is represented by absence (NOT_FOUND on replay is acceptable, or keep a small tombstone map of token → consumed_at for the nicer 410 message).

## 3. `engine/capability.rs` is a 360-line abstraction with zero production callers
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/capability.rs:48
- **Scenario**: The `Capability` trait plus its three adapters (`DbQueryCapability`, `ApiProxyCapability`, `McpToolsCapability`) are referenced nowhere outside this file — grep across `src-tauri/src` finds only self-references (the `capability_contract` hits elsewhere are a different module). Every type/impl in the file carries `#[allow(dead_code)]`, which permanently silences the compiler's own dead-code detection.
- **Root cause**: The module was written as a "formalise the pattern" template (its own doc comment says so) but nothing was ever migrated onto the trait; call sites still use the free functions in `db_query`, `api_proxy`, and `mcp_tools` directly.
- **Impact**: 363 lines of unused indirection that must be kept in sync with three real subsystems' signatures by hand (e.g. `execute_query` gained a 6th arg that had to be threaded here for no consumer). It also misleads readers into thinking capability dispatch goes through this trait. No test coverage exercises it.
- **Fix sketch**: Delete the file and its `mod capability;` registration, or — if the team wants to keep the template — move the design into `engine/README.md` prose and delete the code. Verification needed only for the re-exports at the top (`QueryResult`, `ApiProxyResponse`, etc.): confirm no external module imports them via `capability::` (grep found none).

## 4. `PersonaCompiler` struct + `CompilationPipeline` impl are dead wiring; only the free functions are used
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/compiler.rs:90
- **Scenario**: `commands/design/analysis.rs` calls the free functions `compiler::assemble_prompt`, `compiler::parse_output`, `compiler::run_feasibility` directly at every stage; the `PersonaCompiler` struct (marked `#[allow(dead_code)]`) and its `CompilationPipeline` trait impl are instantiated only inside this file's own test. Same story for `ParseOutcome::from(PipelineOutcome)` — the conversion has no non-test caller.
- **Root cause**: The pipeline-trait refactor added the trait shell but the command layer was never migrated onto it; the "backward-compatible free functions" became the permanent API.
- **Impact**: Two parallel APIs for the same three operations; the trait impl duplicates `parse_output` line-for-line (lines 105-113 vs 155-163). Anyone extending parsing must remember to change both. The README documents the trait as the real path, which is now inaccurate.
- **Fix sketch**: Either migrate `analysis.rs` to construct a `PersonaCompiler` and call through the trait (then delete the free functions), or delete the struct/trait impl and the `ParseOutcome` From-conversion, keeping the free functions. The second option is smaller; make the trait-impl `parse_output` and the free `parse_output` a single function either way. Verify `CompilationPipeline` has other implementors (IntentCompiler) before touching the trait itself.

## 5. `genome_critique::truncate` re-implements `utils::text::truncate_on_char_boundary` used 20 lines away
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/genome_critique.rs:242
- **Scenario**: The file defines a private char-safe `truncate(s, max_chars)` (with its own unicode test) and uses it at line 125 for pattern_data, while line 223 in the same file already calls the shared `crate::utils::text::truncate_on_char_boundary` for the identical job.
- **Root cause**: Local helper written before (or in ignorance of) the shared util; both are char-boundary-safe truncators differing only in whether the "..." suffix is appended.
- **Impact**: Two implementations of the same primitive in one module invites drift (the local one appends `...`, the shared one may not — a future fix to one silently misses the other) and duplicates its unicode test.
- **Fix sketch**: Replace the local `truncate` with `crate::utils::text::truncate_on_char_boundary` (append `"..."` at the call site if the shared helper doesn't, or add an ellipsis variant to `utils::text`), delete the local fn and its `truncate_handles_unicode_safely` test if the shared util already covers it.
