# tauri:gitlab (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Core Libraries & State | Files read: 4 | Missing: 0

## 1. GitLab list endpoints cap at per_page=100 with no pagination — silent truncation
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: data-layer
- **File**: src-tauri/src/gitlab/client.rs:138 (also :294 list_tags, :335 list_branches)
- **Scenario**: A user with >100 GitLab projects sees an incomplete project picker; a project whose persona version tags exceed 100 (one tag per versioned deploy, across all personas, accumulating forever) gets a version-history list that silently drops the newest-or-oldest entries, so rollback targets go missing.
- **Root cause**: `list_projects`, `list_tags`, and `list_branches` all pass `per_page=100` and never follow GitLab's `x-next-page`/Link pagination headers, so page 2+ is never fetched.
- **Impact**: Silent data incompleteness that grows over time — tags are append-only, so the version-history feature degrades permanently once the cap is crossed, with no error surfaced.
- **Fix sketch**: Add a private `send_json_paginated<T>` helper that loops while the response carries an `x-next-page` header (or until a page returns fewer than `per_page` items), accumulating into a `Vec<T>` with a sane hard cap (e.g. 10 pages). Route the three list methods through it. The `search` prefix filters already narrow tag/branch queries, so page counts stay small in practice.

## 2. Identical status-check/error-format block copy-pasted 5 times in client.rs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/gitlab/client.rs:87-96 (also :98-108, :110-120, :255-270, :405-418)
- **Scenario**: Any change to GitLab error reporting (e.g. redacting response bodies, adding status-specific mapping, or rate-limit retry) must be made in five places; `upsert_variable` and `upsert_agents_md` already re-inline the block by hand because the helpers don't expose the status code.
- **Root cause**: `send_json`, `send_ok`, and `send_text` each repeat the `!status.is_success() { text().await.unwrap_or_default(); Err(GitLab(...)) }` pattern, and the two upsert methods can't reuse them since they need to branch on 409/404 first.
- **Impact**: ~50 lines of duplicated error plumbing; a real drift hazard since two of the copies live inside business logic.
- **Fix sketch**: Extract `async fn check_response(resp: reqwest::Response) -> Result<reqwest::Response, AppError>` that consumes the error case and returns the response on success, plus an `error_from(status, resp)` for the upsert paths that inspect status themselves. `send_json/send_ok/send_text` become one-liners over it; `upsert_variable`/`upsert_agents_md` call `error_from` in their fall-through arms.

## 3. connector.services JSON re-parsed inside the tools × connectors loop
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-work
- **File**: src-tauri/src/gitlab/converter.rs:55-62
- **Scenario**: Deploying a persona with many tools against a workspace with many connectors re-runs `serde_json::from_str(&connector.services)` for every (tool, connector) pair — e.g. 20 tools × 15 connectors = 300 parses of the same 15 JSON strings, on the deploy hot path that also does network I/O.
- **Root cause**: The parse lives inside the inner `for connector` loop, which itself is inside `for tool`, so each connector's services string is deserialized `tools.len()` times instead of once.
- **Impact**: Bounded but pure waste (CPU + allocations) on every GitLab deploy; also duplicates the same inefficiency mirrored from `engine::runner::resolve_credential_env_vars`, so fixing here sets the pattern.
- **Fix sketch**: Before the loops, map connectors once into `Vec<(&Connector, Vec<serde_json::Value>)>` (or a `HashMap<toolName, &Connector>` built from all services entries), then iterate tools against the pre-parsed index. That also turns the O(tools × connectors × services) scan into O(tools) lookups and keeps the per-connector `get_by_service_type` DB query at most once per connector (already guaranteed by `seen_connectors`, but the lookup structure makes it explicit).

## 4. Leftover duplicate section-header comment with no content
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src-tauri/src/gitlab/client.rs:284-287
- **Scenario**: A reader scanning for the AGENTS.md file APIs lands on an empty "AGENTS.md fallback (Repository Files API)" banner at line 284 (the real section is at line 199 and the actual file-write method is under "Repository Files API" at line 366), wasting a grep hop.
- **Root cause**: A section banner was duplicated when the Tags API section was inserted, leaving an empty header block immediately followed by the Tags banner.
- **Impact**: Cosmetic only, but it is dead scaffolding that misleads navigation in a 430-line file.
- **Fix sketch**: Delete lines 284-287 (the empty "AGENTS.md fallback (Repository Files API)" banner). Optionally move `upsert_agents_md` up next to `get_agents_md` so both AGENTS.md methods live under one banner.

## 5. get_agents_md duplicates get_file_at_ref
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/gitlab/client.rs:203-213
- **Scenario**: Any tweak to raw-file fetching (encoding, ref handling, error mapping) has to be applied to both `get_agents_md` and `get_file_at_ref`, which build the identical `/repository/files/:path/raw?ref=` request.
- **Root cause**: `get_agents_md` predates the generic `get_file_at_ref` and was never rewritten as a delegation.
- **Impact**: Ten lines of redundant request-building; low but free to remove.
- **Fix sketch**: Replace the body of `get_agents_md` with `self.get_file_at_ref(project_id, "AGENTS.md", branch).await` (or drop the method entirely if callers can pass the constant — verify callers in commands/infrastructure/gitlab.rs before removing).
