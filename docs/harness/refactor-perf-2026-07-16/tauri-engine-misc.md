# tauri:engine (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 2 medium / 3 low)
> Context group: Backend Engine & Runtime | Files read: 15 | Missing: 0

## 1. `sanitize_runtime_variable` compiles ~10 regexes on every call
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: hot-path-regex-compile
- **File**: src-tauri/src/engine/prompt/runtime_safety.rs:113
- **Scenario**: Every persona execution runs `replace_variables`, which calls `sanitize_runtime_variable` once per user-provided `input_data` key. Each call does `regex::Regex::new(...).unwrap()` four times (section, heading, delimiter, `{{var}}`) plus once per entry of `DANGEROUS_TAGS` (6 more) — ~10 fresh regex compilations per variable, per prompt assembly. `variables.rs:76` compiles its `\{\{([^}]+)\}\}` regex per call too.
- **Root cause**: Regexes are constructed inline instead of via `static LazyLock<Regex>`, which is the established convention in this codebase (used in `utils/sanitization.rs`, `engine/redact.rs`, `engine/db_query.rs`, and 9 other files). The `DANGEROUS_TAGS` loop additionally rebuilds the same 6 patterns from `format!` strings each time.
- **Impact**: Regex compilation is orders of magnitude more expensive than matching; with several input variables this is dozens of avoidable compiles per execution and per chat turn. Bounded per run (hence Medium, not High), but it is pure waste on a path that fires on every execution, and it diverges from the repo's own LazyLock pattern.
- **Fix sketch**: Hoist the four fixed patterns into `static RE_SECTION/RE_HEADING/RE_DELIMITER/RE_VAR: LazyLock<Regex>` at module scope. For the tag strip, precompute one combined alternation regex once — `(?i)</?(system|instruction|prompt|role|override|ignore)\b[^>]*>` — in a `LazyLock`, replacing the per-call loop. Do the same for the `{{([^}]+)}}` regex in `variables.rs::replace_variables`.

## 2. Google-connector family detection duplicated 3× with drifting membership
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/runner/credentials.rs:558
- **Scenario**: The "is this a Google-family connector" predicate is hand-written three times in the same file: the token-endpoint match in `try_refresh_oauth_token` (:558-563), the `override_client` resolution in `inject_credential` (:680-683), and the `is_google_family` alias block (:803-807). The third set adds `google_sheets`; the first two don't list it (it happens to be covered by the `starts_with("google")` clause, while `gmail` never is — the reader must re-derive that per site).
- **Root cause**: Copy-paste of the connector-name predicate instead of one named helper; each copy also carries redundant clauses (`google_calendar`/`google_drive` are subsumed by `starts_with("google")`).
- **Impact**: Adding a new Google-family connector (or a Microsoft one — the same pattern is half-duplicated at :684-686) requires finding and updating three call sites; a missed one produces the exact class of silent refresh-skip / missing-alias bug this file's own comments document at length. Pure maintenance hazard, no behavior change needed.
- **Fix sketch**: Add `fn is_google_family(name: &str) -> bool { name.starts_with("google") || name == "gmail" }` (and a sibling `is_microsoft_family`) near the top of `credentials.rs`; use it at all three sites. Keep the token-endpoint match keyed off the helper: `n if is_google_family(n) => "https://oauth2.googleapis.com/token"`.

## 3. Connector `services` JSON re-parsed per (tool × connector); connectors loaded twice per execution
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: redundant-parse
- **File**: src-tauri/src/engine/runner/credentials.rs:74
- **Scenario**: `resolve_credential_env_vars` loops `for tool in tools { for connector in &connectors { serde_json::from_str(&connector.services) ... } }` — the same connector's `services` JSON is deserialized once per tool, so a persona with 10 tools against 20 connectors does 200 parses of the same 20 strings. Separately, `inject_design_context_credentials` (:374) calls `connector_repo::get_all(pool)` again, re-reading the full connector table already loaded at :62 in the same execution setup.
- **Root cause**: The parse lives inside the inner loop instead of being hoisted; the design-context pass is a later addition that reloads rather than receiving the already-fetched list.
- **Impact**: Bounded — small JSON blobs, tens of entries — so this is waste rather than user-visible latency, but it runs on every persona execution and grows multiplicatively with tools × connectors.
- **Fix sketch**: Before the tool loop, build `Vec<(Connector, Vec<serde_json::Value>)>` (or a `HashMap<toolName, &Connector>` extracted from all services) once, and iterate that. Pass the loaded `connectors` slice into `inject_design_context_credentials` instead of re-querying. `force_refresh_credentials_for_tool` (:199) can reuse the same pre-parsed shape.

## 4. Project-id resolution duplicated between `gather_active_goals` and `resolve_standards_policy` (double DB query per prompt)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/runner/team_context.rs:232
- **Scenario**: `build_team_alignment_block` calls `gather_active_goals` and then `resolve_standards_policy`; each independently runs the identical resolution chain — `persona.parsed_design_context().dev_project_id.filter(...)` falling back to `SELECT id FROM dev_projects WHERE team_id = ?1 LIMIT 1` (:232-245 and :330-343 are byte-for-byte the same logic).
- **Root cause**: The standards-policy section was added later and copied the goal-gathering's project resolution instead of resolving once in the caller.
- **Impact**: One redundant SQLite query per team-member execution (cheap), plus two copies of fallback logic that can drift — if the fallback rule changes (e.g. multiple projects per team), one site will be missed.
- **Fix sketch**: Extract `fn resolve_team_project_id(pool, persona, team_id) -> Option<String>`, call it once in `build_team_alignment_block`, and pass the resolved id into both `gather_active_goals` and `resolve_standards_policy`.

## 5. ~4,500-char standards-policy prose embedded as a single inline `format!` literal
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/engine/runner/team_context.rs:299
- **Scenario**: `resolve_standards_policy` ends in one `format!` call whose template is a single source line of roughly 4,500 characters of operational doctrine (QA merge authority, git discipline, release cadence, ...) with five positional `{}` slots interleaved mid-prose.
- **Root cause**: Prompt copy grew in place; it was never split from the code that computes the interpolated values.
- **Impact**: The line is effectively un-diffable and un-reviewable — every wording tweak shows as a full-line change, and it is easy to break a positional argument when editing prose. Sibling constants in `prompt/templates.rs` show the established pattern (named `const` raw-string blocks).
- **Fix sketch**: Move the static prose into a `const STANDARDS_POLICY_TEMPLATE: &str = r#"..."#` (multi-line raw string, one sentence per line) with named placeholders, and render via a small substitution (or split into a few `push_str` sections around the dynamic `pr_base`/`gates_str`/`automerge_str` values). No behavior change; snapshot the output in a test first.
