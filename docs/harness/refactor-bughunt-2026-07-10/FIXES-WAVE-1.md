# Fix Wave 1 — Security & Trust Boundary (2026-07-10)

Commit `c84e1a55b`. Gates: `cargo check --features desktop,ml` clean · ipc_auth tests 7/0 · tsc 0.
Branch `vibeman/refactor-bughunt-2026-07-10` (unmerged).

## Closed (7 findings)

| # | Finding | File | Fix |
|---|---|---|---|
| 1 | `openapi_parse_from_url` SSRF sink | `commands/credentials/openapi_autopilot.rs` | `SHARED_HTTP` → `SSRF_SAFE_HTTP` (sibling `openapi_playground_test` already used it) |
| 2 | KPI `execute_procedure` no SSRF | `engine/kpi_binding.rs` | plain `reqwest::Client::builder()` → `url_safety::build_ssrf_safe_client` |
| 3 | `generate_persona_icon` no auth gate | `commands/core/persona_icon_gen.rs` + `ipc_auth.rs` | `#[requires(privileged)]` + `PRIVILEGED_COMMANDS` entry |
| 4 | Artist persistence commands no privileged gate | `ipc_auth.rs` | added `artist_save/load/autosave_composition` to `PRIVILEGED_COMMANDS` (wrapper-level gate = the primary mechanism protecting sibling ffmpeg/transcribe path commands) |
| 5 | Gmail `send_message` CRLF header injection | `companion/jobs/connector_use.rs` | strip `\r`/`\n` from model-supplied `to`/`subject` before RFC-822 assembly |
| 6 | `driveRename` `..` path traversal | `api/drive.ts` | `validateRenameTarget` now rejects `.` / `..` |
| 7 | `test_automation_webhook` bypasses in-flight guard | `commands/tools/automations.rs` | take the shared `INFLIGHT_TRIGGERS` guard (real outbound webhook must not race a live trigger) |

## Verify-before-fix notes
- **#4 artist persistence**: used the wrapper-level allowlist (no signature change) rather than the `#[requires(privileged)]` macro, because the macro needs a `state` param these commands don't have. The allowlist is the mechanism that actually protects the sibling artist path commands; adding the body macro (defense-in-depth for audit) is a follow-up.
- **#7**: added only the in-flight guard, NOT `is_runnable()` — testing a not-yet-active automation is plausibly intended (the gate would be a behavior change / product decision).

## Deferred (need decisions)

| Finding | File | Why deferred |
|---|---|---|
| Bundle import hardcodes `signature_verified: true` | `engine/bundle.rs:391-508` | `apply_import` never verifies `sig` against the signer's key or `expected_bundle_hash`. The honest minimal fix (flip to `false`) changes provenance semantics; the real fix implements signature verification. **Recommendation:** implement verification and set the flag to its true result; until then, `false` is more honest than `true`. |
| Project-local `.claude/settings.json` MCP servers auto-spawned | `engine/cli_mcp_config.rs:259-290` | `merge_project_local_mcp_servers` copies any `mcpServers.*` (incl. `command`) from an untrusted repo with no allowlist/consent → RCE when a persona targets a hostile repo. **Recommendation:** drop the auto-merge, or gate behind explicit per-project user consent / a known-server allowlist. |
| Redis `TYPE ${key}` raw interpolation | `vault/sub_databases/tabs/TablesTab.tsx:37` | Keys with spaces break; CR/LF can inject a second Redis command. A TS-side escape is fragile — needs the backend `executeDbQuery` Redis command path examined so the key is passed as a discrete argument, not spliced into a command string. |
| IPv4-mapped IPv6 loopback SSRF bypass + Zapier catch-hook | `engine/prompt/…` (from `tauri-engine-misc-2`) | Verify against `url_safety.rs` resolver — may already be covered; needs a targeted check before touching the shared SSRF guard. |

## Remaining W1-adjacent Highs still open
See INDEX theme A. Not in this wave: `fetch_share_link` follows redirects past its LAN-only host check (SSRF), and the IPv6-loopback bypass above — both live in the sharing/url_safety layer and want a single coherent pass over the SSRF resolver.
