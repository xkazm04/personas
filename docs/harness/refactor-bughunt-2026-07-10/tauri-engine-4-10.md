> Context: tauri:engine [4/10]
> Total: 9
> Critical: 0  High: 1  Medium: 5  Low: 3

## 1. KPI procedure execution has no SSRF protection
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/engine/kpi_binding.rs:286-317 (execute_procedure)
- **Scenario**: `execute_procedure` builds a bare `reqwest::Client::builder()` and fires `procedure.http.url` with no URL validation and no SSRF-safe DNS resolver. That URL comes from `compose_procedure` (LLM-authored, line 424) or a stored "frozen" procedure that is replayed mechanically. Callers `commands/infrastructure/dev_tools.rs:3114` (wire/test-run) and `engine/kpi_eval.rs:69` (scheduled measurement) do not validate it either. An LLM that emits `http://169.254.169.254/latest/meta-data/`, `http://localhost:2375/...`, or `http://10.0.0.1/...` — or a poisoned recipe/credential-field host — makes personas fetch internal/cloud-metadata endpoints, and since the procedure is frozen the SSRF persists on every future tick.
- **Root cause**: This path skips the codebase's established outbound-HTTP safety pattern. Every other outbound fetch (`automation_runner.rs:38` `validate_url_safety` + `SSRF_SAFE_HTTP`, `resource_listing.rs:283` `SsrfSafeDnsResolver` + `validate_healthcheck_url`, `credential_design.rs:210`, `triggers.rs:419`) validates; `execute_procedure` was written without it.
- **Impact**: security (SSRF to internal services / cloud metadata, credential exfil via attacker-controlled host).
- **Fix sketch**: Call `crate::engine::url_safety::validate_url_safety(&url)` after `render_template`, and build the client with the `SsrfSafeDnsResolver` DNS override (as `resource_listing::fetch_all_pages` does) to defeat DNS-rebind. Apply on both the compose-time test-run and the replay path.

## 2. Context-rule `app_filter` is silently ignored for non-app events
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/context_rules.rs:256-273 (pattern_matches)
- **Scenario**: When a rule sets `app_filter` (e.g. "only when Slack is focused") and an incoming event has no `app_name` (clipboard, file_watcher), control enters the `else` branch, which is an empty `if event.source != "app_focus" { }` block (comment only, no effect). The function then falls through to `return true`. So a rule authored as "act only when App X is focused" also fires on every clipboard/file event that carries no app info — the filter is a no-op for those sources rather than a mismatch.
- **Root cause**: The `else` branch was meant to decide match/skip but was left as a documented no-op; the default `return true` at the end then leaks the event through.
- **Impact**: UX / correctness (rules trigger executions/events the user believes are app-scoped; spurious persona runs).
- **Fix sketch**: In the `None` (no app_name) arm, `return false` when `!pattern.app_filter.is_empty()` unless the author explicitly opts into non-app sources; delete the dead empty `if`.

## 3. Imported MCP server duplicates args into `command` and `args`
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/engine/desktop_discovery.rs:429-444 (import_claude_desktop_mcp_servers)
- **Scenario**: `full_command` is built as `"{command} {args joined}"`, then the struct stores `command: full_command` **and** `args: entry.args` separately. A consumer that spawns `command` split on spaces plus appends `args` (the natural interpretation of a `command`+`args[]` pair) runs every argument twice, e.g. `npx -y server -y server`. Args containing spaces are also mangled by the naive `join(" ")`.
- **Root cause**: Two representations of the same data were populated without deciding which is authoritative; `command` was overloaded to be both the bare binary and the full line.
- **Impact**: latent bug (double-invoked / malformed MCP server launch) for any downstream that trusts both fields.
- **Fix sketch**: Store `command: entry.command` (bare) alongside `args`, OR keep the joined line and set `args: vec![]`. Document which field callers should use.

## 4. Retry classification substring-matches echoed response bodies
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/engine/automation_runner.rs:319-337, 412-418
- **Scenario**: On HTTP >= 400, the error string embeds up to 500 chars of the response body (`"Webhook returned HTTP {status}: {body}"`). `is_retryable_error` then does `msg.contains("HTTP 5")` and `msg.contains("HTTP 401")`, and `is_auth_failure` does `msg.contains("HTTP 401")`. A non-retryable 4xx whose body text happens to contain "HTTP 5xx" (docs, error copy) is retried; a 400 whose body mentions "HTTP 401" triggers a needless credential re-decrypt on every retry.
- **Root cause**: Retry/auth classification parses a formatted message that includes untrusted body content, instead of the numeric status.
- **Impact**: UX / minor waste (spurious retries + extra decrypt/audit-log writes).
- **Fix sketch**: Return the `u16` status through the `Err` variant (or a typed error) and branch on `status/100 == 5` / `status == 401` rather than substring-scanning the body-bearing message.

## 5. PageParam pagination hardcodes the `per_page` query key
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src-tauri/src/engine/resource_listing.rs:313-330 (Pagination::PageParam)
- **Scenario**: The page number uses the configurable `page_param`, but the page-size is emitted under a literal `"per_page"` key. A connector whose API expects `pageSize`, `limit`, or `count` sends `per_page` (ignored by the server) and gets the API default page size, silently under- or over-fetching resource picker items with no error.
- **Root cause**: The per-page key was inlined as a constant while the page key was parameterized — asymmetric config surface.
- **Impact**: correctness (truncated/incomplete picker lists for some connectors).
- **Fix sketch**: Add an optional `per_page_param` field to the `PageParam` variant (default `"per_page"`) and use it for the query tuple.

## 6. Duplicate LLM-envelope brace-matching parsers
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/kpi_binding.rs:380-395 (parse_procedure) and src-tauri/src/engine/kpi_derivation.rs:187-202 (parse_kpi_goal)
- **Scenario**: Both functions are structurally identical: loop `blob[from..].find(marker)`, `blob[..pos].rfind('{')`, `athena_reaction::match_braces`, then `serde_json::from_str::<Envelope>` and keep the last match. Only the marker string and envelope type differ. Verified by direct diff of the two loops.
- **Root cause**: The "extract the last `{...}` object carrying key K from noisy LLM output" pattern was copied per call site.
- **Impact**: maintainability (a fix to the brace/marker logic must be made in two places; they can drift).
- **Fix sketch**: Extract `fn extract_json_envelope<T: DeserializeOwned>(blob: &str, marker: &str) -> Option<T>` (in `athena_reaction` next to `match_braces`) and call it from both.

## 7. Duplicate "full-parse-else-brace-slice" JSON extraction
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/team_assignment_matching.rs:288-304 (parse_llm_match_response) and 503-514 (inline in decompose_goal)
- **Scenario**: Both do the same tolerant parse: `serde_json::from_str(trimmed)`, else `(trimmed.find('{'), trimmed.rfind('}'))` slice and re-parse, else error with a 300-char excerpt. Same idiom also recurs in the two-arm parse in kb/other modules.
- **Root cause**: Copy-paste of the "Claude wraps JSON in prose" tolerance pattern.
- **Impact**: maintainability (inconsistent error messages, drift risk).
- **Fix sketch**: A small `fn parse_lenient_json<T: DeserializeOwned>(raw: &str) -> Result<T, AppError>` shared by both call sites (and reusable by future LLM-JSON parsers).

## 8. `validate_save_path` and `validate_file_access_path` are ~80% identical
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/engine/path_safety.rs:182-278 and 299-405
- **Scenario**: The two functions share: empty check, `/../` traversal rejection, extension allowlist check, parent-canonicalize + re-append filename, `//?/` prefix strip, block Unix prefixes, block Windows prefixes, block app-data dir, and enforce under-home. They diverge only in whether they canonicalize the file-if-exists (file_access does; save doesn't) and the error wording.
- **Root cause**: `validate_file_access_path` was added later mirroring `validate_save_path` by copy rather than sharing a core.
- **Impact**: maintainability (a security hardening — e.g. a new blocked prefix or a Windows edge — must be applied to both; easy to patch one and miss the other).
- **Fix sketch**: Extract a private `fn resolve_and_guard(path, allowed_exts: Option<&[&str]>, canonicalize_file: bool) -> Result<PathBuf, String>` holding the shared body; keep the two public fns as thin wrappers.

## 9. Divergent duplicate `humanize` title-case helpers
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/engine/desktop_discovery.rs:505-521 (humanize_mcp_name) and src-tauri/src/engine/recipe_parameters.rs:61-68 (humanize)
- **Scenario**: Both convert a `snake_case`/`kebab-case` identifier into a human label. `humanize_mcp_name` capitalizes every whitespace-split word; `recipe_parameters::humanize` capitalizes only the first char. The subtle behavioral difference (per-word vs first-word) is exactly the kind of thing that surprises a caller reaching for "the humanize function".
- **Root cause**: Two independent implementations of the same intent with unstated differing semantics.
- **Impact**: maintainability (minor; risk of picking the wrong variant).
- **Fix sketch**: Move a single `humanize_identifier(&str, per_word: bool)` into a shared `utils::text` module; have both call it with the intended flag.
