> Context: tauri:commands/core
> Total: 8
> Critical: 0  High: 1  Medium: 4  Low: 3

## 1. `generate_persona_icon` decrypts vault secrets and bills an external API with no auth gate
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: trust-boundary
- **File**: src-tauri/src/commands/core/persona_icon_gen.rs:69-129 (also list_image_gen_credentials:69-84)
- **Scenario**: Every other command in this module calls `require_auth_sync`/`require_auth` or carries `#[requires(privileged/auth)]`, and privileged commands are additionally gated by the IPC-token wrapper via `PRIVILEGED_COMMANDS`. `generate_persona_icon` and `list_image_gen_credentials` have **neither** an in-body guard nor an entry in `PRIVILEGED_COMMANDS` (verified: `grep` of `ipc_auth.rs` shows only commented `export_credentials`/`import_credentials`, not these). So any code that can reach the invoke bridge (malicious/compromised webview content, injected script) can call `generate_persona_icon` → `cred_repo::get_decrypted_fields` decrypts a Leonardo/Higgsfield API key and spends it, entirely outside the app's auth/lock model.
- **Root cause**: The command was added to `lib.rs`'s handler list (lines 1689/1691) but the module-wide "every command re-asserts auth" convention was not applied, and it was never registered as privileged.
- **Impact**: security — credential-secret decryption + unauthorized API spend from an unauthenticated caller; `list_image_gen_credentials` also leaks which vault credentials exist.
- **Fix sketch**: Add `require_auth_sync(&state)?` (or `require_privileged`) at the top of both commands, matching siblings. Since `generate_persona_icon` decrypts secrets, prefer the privileged tier and add it to `PRIVILEGED_COMMANDS` (or `#[requires(privileged)]`).

## 2. Credential-import dedup checks the un-suffixed name but stores the suffixed name → duplicate shells on every re-import
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/commands/core/data_portability.rs:1560-1597
- **Scenario**: Phase 3 of `import_bundle` guards with `SELECT COUNT(*) ... WHERE name = ?1 AND service_type = ?2` using `c.name` (the raw export name), but then inserts the row as `format!("{} (imported)", c.name)`. Because the stored name never equals the checked name, the guard can never see a previously-imported shell. Import the same bundle twice (or re-run a failed import) and every credential produces another `"X (imported)"` row. KPIs (Phase 6) and the personas/teams paths do this correctly; only credentials mismatch.
- **Root cause**: Existence check queries the pre-mutation name; the insert applies the `(imported)` suffix.
- **Impact**: data cruft / UX — unbounded duplicate credential shells accumulate across re-imports; also multiplies the field rows `apply_encrypted_credentials` writes.
- **Fix sketch**: Check existence against the value actually stored: `WHERE name = ?1` with `format!("{} (imported)", c.name)`, or drop the suffix and rely on a real uniqueness key.

## 3. Skipped-persona import leaves team members pointing at a non-existent persona id
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/commands/core/data_portability.rs:1614-1628, 1781-1807
- **Scenario**: In Phase 4, a persona whose `notification_channels` fail to encrypt (keyring unavailable) is `continue`d **before** `id_mapping.insert(old→new)`, and a warning is pushed. In Phase 5, each team member resolves its persona via `result.id_mapping.get(&m.persona_id).cloned().unwrap_or_else(|| m.persona_id.clone())` — so a member of that skipped persona falls back to the **old** exported id, which exists nowhere in the new DB. The member row is then inserted referencing a dangling persona_id (or fails the FK, surfacing only a generic "member" warning).
- **Root cause**: The member remap treats "no mapping" as "use the source id" without distinguishing "not exported" from "export was skipped/failed".
- **Impact**: data integrity — imported teams can contain members bound to a missing persona; the connection graph built from `member_id_map` then also silently drops those members' edges.
- **Fix sketch**: When `id_mapping` has no entry for `m.persona_id`, skip the member and push an explicit warning instead of falling back to the raw source id.

## 4. `apply_encrypted_credentials` silently drops secrets when no matching `(imported)` shell exists
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/core/data_portability.rs:2270-2312
- **Scenario**: Secrets are applied only to a shell named `"{name} (imported)"`. If Phase 3 skipped creating that shell (a same-name credential already existed) or the name/service_type differs by case, `matching_cred` is `None` and the loop `continue`s with no record. The caller only warns when `count > 0` ("N applied"); credentials whose secrets were *not* applied produce no per-item warning, so the user believes all embedded secrets were imported.
- **Root cause**: Match-or-skip with no accounting of the skip; success reporting is a single aggregate count.
- **Impact**: UX / trust — imported personas silently lack credential secrets; failures are invisible.
- **Fix sketch**: Track unmatched entries and append a warning (e.g. "3 credential secret(s) had no matching shell and were not applied"), mirroring the decrypt-failure warning already present.

## 5. `extract_json_array` duplicated in `memory_compile.rs` despite an exported reuse helper
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: duplication
- **File**: src-tauri/src/commands/core/memory_compile.rs:344-378 vs src-tauri/src/commands/core/memories.rs:1211-1243
- **Scenario**: `memories.rs` already exposes `pub(crate) fn extract_json_array_from` (line 651) specifically "for cross-module reuse", yet `memory_compile.rs` re-implements the identical string-scanning parser (comment: "Mirror of the helper in commands::core::memories … to keep this file self-contained"). Verified byte-for-byte equivalent logic. Two copies means a future fix (e.g. handling code-fences) must be made twice.
- **Root cause**: Convenience copy taken instead of calling the already-public helper.
- **Impact**: maintainability — divergence risk in JSON extraction used by both LLM pipelines.
- **Fix sketch**: Delete the local copy and call `crate::commands::core::memories::extract_json_array_from`.

## 6. `MAX_INSTRUCTIONS_CHARS` + `validate_instructions` duplicated across modules
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/core/persona_jobs.rs:20-31 vs src-tauri/src/commands/core/memories.rs:267 (+ inline checks at memories.rs:706-712, 1080-1086)
- **Scenario**: `persona_jobs.rs` defines its own `MAX_INSTRUCTIONS_CHARS = 4096` and a `validate_instructions` helper, explicitly commented as "mirrored from … commands::core::memories". `memories.rs` exports `pub(crate) const MAX_INSTRUCTIONS_CHARS` and open-codes the same char-count check in two commands. The cap can drift out of sync between enqueue-time and run-time validation.
- **Root cause**: The shared constant is re-declared and the validation is copy-pasted rather than centralized.
- **Impact**: maintainability — a cap change must be made in 3 places to stay consistent.
- **Fix sketch**: Reuse `memories::MAX_INSTRUCTIONS_CHARS` in `persona_jobs.rs` and lift the char-count check into one shared `validate_instructions`.

## 7. Dead export-schema migration scaffolding
- **Lens**: code-refactor
- **Severity**: low
- **Category**: dead-code
- **File**: src-tauri/src/commands/core/import_export.rs:97-127
- **Scenario**: `CURRENT_SCHEMA_VERSION = 1`, so the `while version < CURRENT_SCHEMA_VERSION` loop never executes; its `1 => migrate_export_bundle_v1_to_v2(value)?` arm is unreachable, and `migrate_export_bundle_v1_to_v2` is `#[allow(dead_code)]` and always returns an error. Verified: nothing else calls the v1→v2 migrator.
- **Root cause**: Forward-looking migration harness added before any second schema version exists.
- **Impact**: maintainability — dead branch + always-erroring function read as if live.
- **Fix sketch**: Either keep as an intentional documented stub (add a `// scaffolding for the first major bump` note) or remove `migrate_export_bundle_v1_to_v2` and the unreachable arm until a v2 lands.

## 8. Near-duplicated Claude-CLI spawn/timeout/env-strip block
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src-tauri/src/commands/core/memories.rs:440-520 vs src-tauri/src/commands/core/memory_compile.rs:179-265
- **Scenario**: Both build args via `claude_cli_invocation()`, spawn with the same `CREATE_NO_WINDOW` flag, strip `CLAUDECODE`/`CLAUDE_CODE`/`CLI_SUBSCRIPTION_RESERVED_ENV`, pipe stdin, and read stdout under a 180s timeout with an identical kill-on-timeout dance. `memory_compile.rs` even documents it as "intentionally a near-mirror". The subscription-only env-strip (a billing-safety invariant) is the kind of logic that must not drift between copies.
- **Root cause**: The compile pipeline was cloned from the review pipeline rather than sharing a spawn helper.
- **Impact**: maintainability — a fix to the CLI-safety wiring (e.g. a new reserved env var, or a stderr drain to avoid pipe deadlock) must be applied twice.
- **Fix sketch**: Extract a shared `run_claude_cli(prompt, timeout) -> Result<String>` helper into `engine::cli_process` and have both commands call it.
