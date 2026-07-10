> Context: tauri:engine [6/10]
> Total: 8
> Critical: 0  High: 2  Medium: 3  Low: 3

## 1. Project-local `.claude/settings.json` MCP servers are auto-spawned with no consent/allowlist
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/cli_mcp_config.rs:230-234, 259-290
- **Scenario**: A user adopts/points a persona at a repository (or clones one) whose `<project_root>/.claude/settings.json` contains an `mcpServers` entry, e.g. `{"evil":{"command":"/tmp/x.sh","args":["--pwn"]}}`. `merge_project_local_mcp_servers` copies that entry verbatim into the `--mcp-config` file the runner hands to `claude -p`. When the persona runs, the CLI spawns that `command` as a child process with the persona's privileges — arbitrary code execution off attacker-supplied repo data.
- **Root cause**: The merge is described as a convenience to "surface project-local MCP servers … without requiring the user to configure each one through the credential-managed `mcp_gateways` flow" — i.e. it deliberately bypasses the vetted/consented path. Only the reserved `personas` name is guarded (against shadowing); every other project-supplied `command` is trusted implicitly.
- **Impact**: security — RCE via a hostile repo/project the persona operates on.
- **Fix sketch**: Gate project-local server import behind explicit per-server user approval (persist an allowlist keyed by project_root + command hash), or drop the merge entirely and require registration through `mcp_gateways`. At minimum, log each imported server command and refuse absolute/relative filesystem `command`s that aren't on a known-tools allowlist.

## 2. `body_preview` byte-slice panics on non-ASCII poll responses
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: edge-case
- **File**: src-tauri/src/engine/polling.rs:305
- **Scenario**: `"body_preview": &body[..body.len().min(2000)]`. `body` comes from `response.text()` (valid UTF-8, arbitrary content). When the body is ≥2000 bytes and byte offset 2000 lands in the middle of a multi-byte UTF-8 character (routine for any page with emoji/accented/CJK text near that offset), the string slice panics ("byte index 2000 is not a char boundary"). This fires on the content-changed path of a normal poll against any non-ASCII endpoint.
- **Root cause**: Byte-index slicing used where a char-boundary-safe truncation is required (the module even hashes bytes elsewhere but previews as a `&str`).
- **Impact**: crash — panics the poll cycle, aborting processing of all remaining due triggers for that tick; recurs every cycle the endpoint stays changed.
- **Fix sketch**: Use a char-safe truncation, e.g. `body.char_indices().nth(2000).map_or(body.as_str(), |(i,_)| &body[..i])`, or `body.chars().take(2000).collect::<String>()`.

## 3. `fetch_share_link` follows redirects, bypassing the LAN-only host check (SSRF)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/share_link.rs:230-262
- **Scenario**: `is_safe_share_host` validates only the *initial* URL's host (localhost/private/LAN), then the request runs on a plain `reqwest::Client::builder().timeout(...)` with the default redirect policy (follows up to 10). A malicious peer at an allowed LAN IP returns `302 Location: http://169.254.169.254/latest/meta-data/…` (or an internal service); reqwest follows it, and the response is imported as a bundle. Unlike the polling client (which uses `build_ssrf_safe_client` with a connect-time private-IP resolver), this client has no such guard.
- **Root cause**: Host safety is enforced pre-request only; redirect targets are never re-validated.
- **Impact**: security — SSRF to cloud-metadata / internal hosts triggered by importing a hostile share link.
- **Fix sketch**: Build the fetch client with `build_ssrf_safe_client(...)` (as polling does) or set `.redirect(reqwest::redirect::Policy::none())` and re-run `is_safe_share_host` on any `Location` before following.

## 4. Parse-failure diagnostic byte-slices the raw response and can panic
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/genome_critique.rs:223
- **Scenario**: On a JSON parse failure, `let head = &trimmed[..trimmed.len().min(500)];` slices the raw LLM output at byte 500. If the model emitted multi-byte characters (very common: “smart quotes”, code, non-Latin text) and byte 500 isn't a char boundary, formatting the error message panics — turning a recoverable "fall back to mechanical mutation" into a crash of the evolution tick. Note the file's own `truncate()` helper (line 242) does this correctly by chars; line 223 doesn't reuse it.
- **Root cause**: Byte slicing instead of the existing char-safe `truncate`.
- **Impact**: crash on the error path (exactly when input is already malformed/adversarial).
- **Fix sketch**: Replace with `truncate(trimmed, 500)`.

## 5. Active-window path swallows `mark_triggered` errors and skips backoff bookkeeping
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src-tauri/src/engine/polling.rs:191-195
- **Scenario**: When a trigger is outside its active window, the code advances the schedule via `let _ = trigger_repo::mark_triggered(...)`, discarding the result. Every other advance in the loop goes through `try_mark_triggered`, which records failures into the in-memory backoff map. If `mark_triggered` fails here (e.g. version CAS miss / SQLITE_BUSY), `next_trigger_at` stays in the past, so `get_due` re-returns the trigger every cycle with no backoff — the exact storm the backoff machinery exists to prevent, just gated by the active-window check.
- **Root cause**: Inconsistent use of the backoff-aware helper; the active-window branch predates/ignores it.
- **Impact**: UX/perf — tight re-query loop on a persistently failing trigger; error is invisible in logs.
- **Fix sketch**: Route this advance through `try_mark_triggered(pool, &trigger.id, next, trigger.trigger_version)` too.

## 6. `PersonaCompiler` pipeline impl is dead; free functions are the real API
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: dead-code
- **File**: src-tauri/src/engine/compiler.rs:89-123
- **Scenario**: Production (`commands/design/analysis.rs:115,176,418`) calls only the free functions `compiler::assemble_prompt` / `compiler::parse_output` / `run_feasibility`. The `PersonaCompiler` struct and its `impl CompilationPipeline` are `#[allow(dead_code)]` and instantiated only in the test at line 326. `parse_output` and `assemble_prompt` bodies are duplicated between the trait impl and the free functions. Verified via grep: no non-test caller constructs `PersonaCompiler`.
- **Root cause**: A generic pipeline trait was introduced but the call sites were never migrated onto it, leaving two parallel copies of the logic.
- **Impact**: maintainability — edits must be mirrored in two places; the "pipeline" abstraction gives a false impression of being wired in.
- **Fix sketch**: Either migrate `analysis.rs` to drive `PersonaCompiler` through the trait and delete the free-fn duplicates, or delete the unused struct/impl and keep the free functions as the documented API.

## 7. `capability.rs` is an unused (363-line) speculative abstraction
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/capability.rs:1-363
- **Scenario**: The `Capability` trait and all three adapters (`DbQueryCapability`, `ApiProxyCapability`, `McpToolsCapability`) are `#[allow(dead_code)]`; grep for their names across `src-tauri/src` returns only `capability.rs` itself — nothing constructs or calls them. The doc-comment concedes the purpose is merely to "make the shared shape explicit … so contributors see the pattern." It adds a compiled `async_trait` surface and TS export (`CapabilityHealth`) that no runtime path exercises.
- **Root cause**: Abstraction added ahead of any consumer ("generic capability composition becomes possible").
- **Impact**: maintainability — carrying cost + misleading discoverability; the three subsystems still use their free-function APIs directly.
- **Fix sketch**: Delete the module until a real second consumer needs the trait, or actually route one subsystem (e.g. db_query) through it to justify keeping it.

## 8. `SharedBundle.bundle_hash` / `resource_count` are write-only
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/engine/share_link.rs:42-50, 128-137
- **Scenario**: `SharedBundle` is `#[allow(dead_code)]`; `bundle_hash` and `resource_count` are populated in `create_share_link` but never read by `handle_share_download` (which only serves `bytes`) or anywhere else — the deep-link hash/count come from `export_result`, not the stored struct. So these two fields are pure write-only state on the in-memory entry.
- **Root cause**: Fields kept "for completeness" on the store entry though the serving path doesn't need them.
- **Impact**: maintainability — minor; the `#[allow(dead_code)]` masks the unused fields from the compiler.
- **Fix sketch**: Drop the two fields (and the struct-level `allow(dead_code)`), or expose them via a debug/status endpoint if a use is intended.
