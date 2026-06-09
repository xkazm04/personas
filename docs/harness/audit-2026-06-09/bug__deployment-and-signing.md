# Bug Hunter — deployment-and-signing
> Total: 5
> Severity: 2 critical, 2 high, 1 medium

## 1. Backend `sign_document` does not enforce the sensitive-path allowlist — credential files can be signed via any IPC caller
- **Severity**: critical
- **Category**: secret-leak
- **File**: src-tauri/src/commands/signing/mod.rs:35-79 (vs src/api/signing/index.ts:63-96)
- **Scenario**: The only guard against signing `~/.ssh/id_ed25519`, `~/.aws/credentials`, `~/wallet.dat`, `~/.npmrc`, etc. is the `SENSITIVE_PATH_PATTERNS` regex list in the TS `signDocument` wrapper. The Rust command `sign_document` calls only `validate_file_access_path(&file_path, None)` (line 43), which blocks path traversal / system dirs / non-home paths but explicitly passes `None` for the extension allowlist and has zero knowledge of the sensitive-credential patterns. A persona tool, a future feature, or any code that does `invoke("sign_document", { filePath: "~/.ssh/id_ed25519" })` directly bypasses the frontend guard entirely. The signing command then reads the private-key bytes into memory and produces a signature/sidecar over them.
- **Root cause**: Defense was implemented in the renderer (untrusted, bypassable) and never mirrored in the privileged backend, even though `src/api/signing/index.ts:42-56` warns in a TRUST STATEMENT comment that "backend enforcement of the same allowlist has NOT been verified … treat this guard as the PRIMARY gate, not defense in depth." The audit confirms that warning: there is no backend allowlist.
- **Impact**: security — a malicious/compromised persona tool can coerce the app into reading and emitting derived artifacts over SSH keys, cloud credentials, and wallets; the signing flow becomes an oracle/exfil primitive for files the UI explicitly refuses to touch.
- **Fix sketch**: Move the sensitive-path denylist into Rust (a shared `path_safety` function) and call it inside `sign_document` BEFORE `std::fs::read`. The TS guard becomes redundant defense-in-depth. Add a contract test pairing the two lists so they cannot drift.

## 2. Credential provisioning pushes secrets to GitLab unmasked when a value fails GitLab masking rules, then can leave them stranded on a partial deploy
- **Severity**: critical
- **Category**: secret-leak
- **File**: src-tauri/src/gitlab/converter.rs:97-119; src-tauri/src/commands/infrastructure/gitlab.rs:258-275
- **Scenario**: `resolve_credentials_for_gitlab` blindly sets `masked: true` on every decrypted field "even if a value can't be masked" (comment lines 100-104) and pushes the raw `field_val.clone()` as the variable value. GitLab's masking contract requires the value to be ≥8 chars, single-line, and within a restricted charset. A short API key, a value with a `=`/`@`, or a multi-line token (PEM/JSON) violates this. GitLab then either (a) returns 400 (`Value cannot be masked …`) — in which case `try_join_all` (gitlab.rs:259-273) aborts mid-flight leaving the credentials that already succeeded as plaintext-eligible variables on the remote with no cleanup/rollback, or (b) on older instances creates the variable with masking silently dropped. Either way a secret value ends up resident on an external project that can surface in CI job logs.
- **Root cause**: The code assumes "set masked=true and GitLab will sort it out," and treats credential provisioning as best-effort concurrent fire-and-forget with no pre-validation of maskability and no compensating delete on partial failure.
- **Impact**: security + state-corruption — secrets exposed in an external system's CI logs; a half-provisioned project with orphaned credential variables and no record of what was pushed.
- **Fix sketch**: Validate each value against GitLab's masking regex before upload; refuse (or chunk/encode) values that cannot be masked rather than uploading them anyway. Make provisioning transactional: collect successfully-created keys and, on any failure, delete them before returning Err so the remote is never left partially seeded with secrets.

## 3. GitLab deploy is recorded and reported as "success" even when version tagging fails — and credentials are provisioned before the agent deploy, so a failed deploy leaves orphaned secrets
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/commands/infrastructure/gitlab.rs:599-797 (esp. 617-643, 722-794)
- **Scenario**: In `gitlab_deploy_persona_versioned`, credentials are upserted to the project FIRST (617-640), then the agent deploy is attempted. If the Duo Agent API fails AND the AGENTS.md fallback also fails (`upsert_agents_md` returns Err at 698-700), the function `?`-returns — but the credentials pushed at 626-640 are already on the remote with no cleanup. Separately, when the deploy lands but all 3 tag-creation attempts fail (752-771), the code logs a warn and proceeds to write a deployment_history row with hardcoded `"success"` (line 781) while `tag_created=false`. The history therefore claims success for a version that has no tag — and a later `gitlab_rollback_persona` has nothing to target.
- **Root cause**: The deployment_history status is a literal `"success"` constant rather than derived from the actual outcome, and credential provisioning is not unwound when later steps fail. The `GitLabDeployResult.tag_created` flag is the only signal, and it is advisory.
- **Impact**: UX degradation + recovery-gap + secret-leak — operators trust a "success" record that cannot be rolled back; failed deploys silently strand provisioned secrets on the remote.
- **Fix sketch**: Derive the recorded status from outcome (`success` only when deploy AND tag both landed; otherwise `partial`/`failed`). Wrap the whole versioned-deploy in a compensating cleanup that revokes provisioned variables if the agent/AGENTS.md step fails.

## 4. GitLab rollback creates a new release tag, then records "success" even when re-tagging silently failed — caught-and-forgotten error
- **Severity**: high
- **Category**: silent-failure
- **File**: src-tauri/src/commands/infrastructure/gitlab.rs:931-983 (esp. 949-953, 957-969)
- **Scenario**: `gitlab_rollback_persona` redeploys the historical snapshot, then tries to create a rollback audit tag. If `create_tag` fails (931-939), the error is swallowed into `new_tag = None` with only a `warn!` (949-952). The function then writes a deployment_history row hardcoded as `"success"` (line 963) and returns `GitLabRollbackResult { new_tag: None, … }`. The TS `gitlabRollbackPersona` slice (gitlabSlice.ts:498-519) shows a green "Rolled back … to {targetTag}" toast unconditionally and never inspects `new_tag`. So a rollback whose audit tag never persisted is reported as fully successful, and the audit trail for the rollback is missing with no user-visible signal.
- **Root cause**: Tag creation is treated as non-essential and its failure is logged but not surfaced; the success path is hardcoded rather than reflecting `new_tag.is_some()`.
- **Impact**: UX degradation + recovery-gap — incident responders believe a rollback was fully recorded; the missing tag breaks the audit chain and future version listing.
- **Fix sketch**: Return the `new_tag: None` condition as a warning in the result and have the UI surface it (same pattern already used for `tagCreated` in `gitlabDeployPersonaVersioned`, gitlabSlice.ts:477-482). Do not hardcode `"success"` when a required side effect failed.

## 5. Unified dashboard renders every GitLab agent as healthy "active" — failed/broken agents shown green with a working "Test" action
- **Severity**: medium
- **Category**: success-theater
- **File**: src/features/agents/sub_deployment/components/deploymentTypes.ts:63-65; src/features/agents/sub_deployment/components/UnifiedDeploymentDashboard.tsx:73-80
- **Scenario**: `mapGitlabStatus` unconditionally returns `'active'` for every agent row the API returns. The list endpoint `list_duo_agents` returns any agent record regardless of whether its last deploy errored, its credentials were revoked, or the underlying AGENTS.md is corrupt. The dashboard paints all of them emerald-green "active" (statusBadge), counts them in `activeCount`, and exposes "Test"/"Open" actions. There is no GitLab health probe equivalent to `useDeploymentHealth` (which only fetches cloud stats and skips GitLab rows, useDeploymentHealth.ts:13-14). An operator looking at the dashboard cannot distinguish a live agent from a stale/broken one.
- **Root cause**: GitLab's list API has no lifecycle field, and the mapper papers over that by asserting health rather than representing "unknown." The documented contract even forbids using `unknown` here, institutionalizing the optimistic lie.
- **Impact**: UX degradation — false confidence; broken external deployments masquerade as healthy, delaying incident detection.
- **Fix sketch**: Map GitLab agents to `'unknown'` (neutral) until an actual health/last-invocation signal exists, or add a lightweight GitLab health probe (e.g. last pipeline status / agent fetch) feeding the same `healthMap` the cloud rows use. Reserve green strictly for verified-live state.
