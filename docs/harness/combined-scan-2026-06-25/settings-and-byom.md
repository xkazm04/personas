# Settings & BYOM — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: settings-and-byom | Group: Onboarding, Home & Settings
> Total: 5 | Critical: 1 | High: 2 | Medium: 2 | Low: 0

## 1. BYOM compliance rules never match — silent compliance bypass (fails open)
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: compliance-bypass / silent-failure
- **File**: src-tauri/src/engine/byom.rs:483-507 (consumed at src-tauri/src/engine/runner/mod.rs:1271-1273)
- **Scenario**: An admin opens Settings → BYOM → Compliance and adds a rule "HIPAA workflows → only `claude_code`" with `workflow_tags: ["hipaa"]`. The policy saves cleanly (no UI warning). Every subsequent persona execution still routes through any/all providers — the HIPAA restriction is never applied.
- **Root cause**: `evaluate()` computes `matches = persona_tags.iter().any(...)`, but the only production caller (`runner/mod.rs:1273`) passes `byom_policy.evaluate(&[], None)` — `persona_tags` is hardwired to `&[]` because `Persona` has no tag/category field feeding it yet. With an empty tag slice, `matches` is **always false**, so the `for rule in &self.compliance_rules` body that injects the restricted `blocked` set never runs. Compliance rules with any non-empty `workflow_tags` are dead code.
- **Impact**: An organization configures provider restrictions for sensitive workflows (PHI, data-sovereignty), the UI accepts them, the audit log records "compliance rule active," yet zero enforcement occurs. The restriction fails **open** — the worst direction for a security control. The gap is documented only in Rust doc comments; nothing surfaces it to the admin in the UI.
- **Fix sketch**: Either (a) feed a real tag source into `evaluate` (persona `template_category` / explicit tags) so configured rules actually match, or (b) until that lands, surface a blocking/error-level `PolicyWarning` in `validate()` whenever an enabled compliance rule has non-empty `workflow_tags`, so the UI shows "this rule will never match — tag routing is not wired up" instead of silently accepting a no-op security control.
- **Value**: impact=9 effort=6

## 2. Management API authenticates but never authorizes — scopes ignored, credential proxy reachable by any key
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: broken-function-level-authorization / credential-misuse
- **File**: src-tauri/src/engine/management_api.rs:167-197 (middleware) + :337-358 (proxy); scopes created at :233-237, stored at src-tauri/src/db/repos/resources/external_api_keys.rs:53-86
- **Scenario**: The process "system" key is minted with `scopes: ["personas:read","personas:execute"]`. A holder of that key (or any key created via the API Keys UI, including a forgotten/stale one) sends `POST /api/proxy/{credential_id}` for a stored Slack/GitHub/SendGrid credential, or `POST /api/execute/{id}`, `POST /api/versions/{id}/rollback`, `POST /api/build`. All succeed regardless of the key's scopes.
- **Root cause**: `require_api_key` validates only that the bearer token resolves to an enabled, non-revoked row (`find_by_token`) and then calls `next.run(req)`. The `scopes` column is persisted but **never checked** anywhere — there is no per-route scope guard. The code itself flags this: `:109` "V2 may add a `personas:build` scope check" and `:1258-1263` "scope-based filtering arrives with… per-key scopes." The credential proxy injects stored secrets server-side (`api_proxy::execute_api_request`), so any valid key can drive any stored credential against that credential's API (host is constrained to the per-credential `well_known_base_url`, so not arbitrary SSRF, but full credential misuse).
- **Impact**: A read-only-intended key is effectively root: it can execute personas, roll back prompt versions, start builds, and use every stored 3rd-party credential. A single leaked/stale token (the UI even has a "stale key" concept, implying keys linger) is enough.
- **Fix sketch**: Enforce scopes in `require_api_key` (or a per-route layer): map each route to a required scope and 403 when the matched key lacks it. At minimum gate `/api/proxy/*`, `/api/build/*`, and version rollback behind an explicit scope the read-only system key does not hold.
- **Value**: impact=8 effort=4

## 3. Cost-routing rules for Simple/Critical silently no-op — executions run on the unintended provider/model
- **Severity**: High
- **Lens**: bug-hunter / ambiguity-guardian
- **Category**: wrong-routing / silent-failure
- **File**: src-tauri/src/engine/byom.rs:515-547 (consumed at src-tauri/src/engine/runner/mod.rs:1271-1273)
- **Scenario**: An admin adds a routing rule "Simple tasks → cheap model X" expecting formatting/lint personas to hit the cheap provider. Every execution instead routes through the `Standard` rule (or, if none, the account default) — the Simple rule never fires. Same for any `Critical` rule.
- **Root cause**: The runner passes `complexity = None`; `evaluate` does `effective_complexity = complexity.unwrap_or(TaskComplexity::DEFAULT)` (= `Standard`) and only matches `rule.task_complexity == Standard`. No source classifies task complexity, so `Simple`/`Critical` branches are unreachable. The UI dropdown (`ByomRoutingRules.tsx`) offers all three complexities with no indication that two of them are inert.
- **Impact**: Requests are routed to a different provider/model than the admin configured — directly the "request routed to the wrong/unintended provider" case. Concretely a cost-control contract ("cheap model for trivial edits") is silently broken, causing cost overruns; a `Critical → strongest model` rule silently downgrades security-sensitive work to the Standard model.
- **Fix sketch**: Wire an actual complexity source (per-execution override → persona default → heuristic → Standard, per the documented precedence), and/or add a `validate()` warning when enabled routing rules use a complexity the runner can never produce, so the UI flags inert rules instead of implying they work.
- **Value**: impact=6 effort=6

## 4. `/api/personas` endpoints bypass the exposure gate and leak local_only/sensitive system prompts
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: information-disclosure / inconsistent-authorization
- **File**: src-tauri/src/engine/management_api.rs:364-401
- **Scenario**: A holder of any valid API key calls `GET /api/personas` then `GET /api/personas/{id}` and reads the name, description, and first 500 chars of `system_prompt` for **every** persona — including ones marked `gateway_exposure = local_only` or `sensitive`.
- **Root cause**: `list_personas`/`get_persona` use `persona_repo::get_all` / `get_by_id` directly, while the A2A surface in the same file deliberately uses `find_by_id_if_exposed` (`:1138`, `:1229`) precisely so it "never leak[s] their existence to external consumers." The list/get endpoints were not given the same exposure filter, so the gating is inconsistent and the unexposed personas' prompt content leaks.
- **Impact**: Internal/sensitive persona prompts (which often embed instructions, internal process details, occasionally secrets) are readable by any external MCP/CLI client with a token, contradicting the `local_only` exposure contract enforced elsewhere.
- **Fix sketch**: Route `list_personas`/`get_persona` through the exposure-gated repo helpers (filter to exposed personas; 404 unexposed ones), matching the A2A handlers. Consider dropping `system_prompt` from the management summary entirely.
- **Value**: impact=5 effort=2

## 5. Deleting an external API key writes no audit-log entry (most destructive op is the untracked one)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: audit-gap / missing-tribal-knowledge
- **File**: src-tauri/src/commands/credentials/external_api_keys.rs:82-91
- **Scenario**: A privileged caller deletes an API key. Unlike `create` (`:37-47`) and `revoke` (`:68-78`), `delete_external_api_key` performs the DB delete and an `info!` log but never calls `settings_audit_log::insert`. The Settings → History feed shows the key was created and possibly revoked, but never that it was hard-deleted — and the row itself is gone, so there is no residual trace in `external_api_keys` either.
- **Root cause**: The audit-log write was added to create/revoke but omitted from delete; the row-removal semantics mean delete is the one action with no recoverable record. The "delete removes the row / revoke keeps an audit trail" split (documented in `ApiKeysSettings.tsx:16-18`) makes the missing settings-history entry the only remaining record — and it isn't written.
- **Impact**: An attacker or careless admin can erase API keys (e.g., to cover tracks after issuing one) with zero entry in the settings history. Combined with finding #2, a leaked key can be used then deleted leaving minimal trail.
- **Fix sketch**: Add a best-effort `settings_audit_log::insert(..., "delete", Some(&before), None, Some("ui"))` to `delete_external_api_key`, capturing the key name/prefix/scopes in the `before` snapshot before the row is removed, mirroring `revoke`.
- **Value**: impact=4 effort=1
