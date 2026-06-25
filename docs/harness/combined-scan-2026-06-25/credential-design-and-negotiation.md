# Credential Design & Negotiation — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: credential-design-and-negotiation | Group: Credential Vault & Connectors
> Total: 5 | Critical: 0 | High: 2 | Medium: 3 | Low: 0

## 1. Blast-radius severity ignores affected events → user told "safe to delete" a credential that still powers live event triggers
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: under-counting / state-corruption (delete-in-use)
- **File**: src/features/vault/sub_dependencies/credentialGraph.ts:193 (and src/features/vault/sub_dependencies/BlastRadiusPanel.tsx:91-97)
- **Scenario**: A credential whose only consumers are credential-events (e.g. a webhook/poller credential with several enabled `credentialEvents` but no persona tool-binding and no audit history). `analyzeBlastRadius` collects `affectedEvents` correctly, but `severity = severityForAgentCount(affectedAgents.length)` is computed **only** from the agent count. With 0 agents the severity is `'low'`, and `BlastRadiusPanel` then renders `dep.impact_low` ("minimal impact"). The user deletes the credential and silently breaks every event that depended on it.
- **Root cause**: Severity is a pure function of `affectedAgents.length`; `affectedEvents` never feeds the bucket. The threshold doc (credentialGraph.ts:60-72) explicitly says "zero dependents is the only low state" but defines "dependents" as agents only, so events are structurally invisible to the risk signal.
- **Impact**: Misleading low-risk verdict on a credential with real downstream consumers → accidental deletion of an in-use credential; the most direct realization of the "under-count so a user deletes a still-in-use credential" failure mode.
- **Fix sketch**: Fold events into severity, e.g. `severityForAgentCount(affectedAgents.length) ` then bump to at least `'medium'` when `affectedEvents.length > 0`; or pass `affectedEvents.length` into a combined scorer. Mirror the same change in `simulateRevocation`. Update BlastRadiusPanel so the impact copy reflects events when agents are zero.
- **Value**: impact=7 effort=2

## 2. Healthcheck error message echoes the resolved URL — leaks secret field values templated into the endpoint
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: secret leakage (logs/UI)
- **File**: src-tauri/src/commands/credentials/credential_design.rs:265-269 (resolution at :195, success path at :246-263)
- **Scenario**: `test_credential_design_healthcheck` resolves `{{field}}` placeholders in the AI-chosen endpoint via `resolve_template(endpoint, &values_map)` using the **actual credential values**. Many real APIs key off a query param (e.g. `https://api.service.com/v1/data?apikey={{api_key}}`), so the resolved URL embeds the live secret. On any transport error (DNS failure, timeout, refused connection) the code returns `format!("Claude healthcheck request failed: {}", e)`. `reqwest::Error`'s `Display` includes the request URL verbatim, so the secret-bearing URL is surfaced in the command result (and any toast/log that captures it). The success and HTTP-status branches only echo the status code — this leak is unique to the error branch.
- **Root cause**: reqwest errors carry the URL by default; the error is stringified without redaction or `.without_url()`, and `validate_field_values` only blocks SSRF (private IPs), not secrets-in-URL.
- **Impact**: Plaintext credential value escapes the encrypted-value boundary into an error string that may be logged/persisted. Trivial to trigger for any query-param-keyed API by toggling the network off mid-test.
- **Fix sketch**: Use `e.without_url()` before formatting, or run the message through `crate::utils::sanitization::sanitize_secrets`, or build the failure message from `e.status()`/`e.is_timeout()` etc. without the URL.
- **Value**: impact=6 effort=1

## 3. `get_dependents` never emits `event_trigger` dependents — event-subscription-only personas are absent from the blast radius
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: under-counting / documented-but-unwired
- **File**: src-tauri/src/db/repos/resources/audit_log.rs:218-305 (consumed via src/features/vault/sub_dependencies/CredentialRelationshipGraph.tsx:47; precedence declared at src/features/vault/sub_dependencies/credentialGraph.ts:131-135)
- **Scenario**: `dependentsMap` is populated **solely** from `credential_dependents` → `get_dependents`, which returns only two `link_type`s: `tool_connector` (structural) and `audit_log` (observed). The frontend graph, however, defines a third precedence rank `event_trigger` (credentialGraph.ts:131-135) and its tests exercise it — implying a class of dependents the backend never produces. A persona bound to a credential only through an event subscription, that has not yet executed (no audit row) and whose tool name is not an exact element of the connector's `services` array, appears in **zero** dependent rows → not counted in `affectedAgents` → blast radius / severity under-reports.
- **Root cause**: The dependency derivation enumerates tool→connector→services and audit history but has no event-subscription→credential query, despite the frontend contract anticipating one.
- **Impact**: A still-referenced credential can read as lower-severity (or empty) blast radius, again enabling a delete-in-use mistake; also leaves a dead, misleading precedence constant in the shared graph code.
- **Fix sketch**: Add a third query to `get_dependents` that joins event subscriptions/triggers to the credential and emits `link_type = "event_trigger"`, merged with the existing two; or, if event-trigger dependence is genuinely impossible, delete the `event_trigger` rank/tests to remove the false contract.
- **Value**: impact=5 effort=4

## 4. Recipe upsert MERGE guard is incomplete — a negotiator stub can still clobber `fields_json`/`healthcheck_json`/`oauth_type` of a verified Design recipe
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / recipe-eligibility false-positive
- **File**: src-tauri/src/db/repos/resources/credential_recipes.rs:65-82
- **Scenario**: The `ON CONFLICT(connector_name) DO UPDATE` was hardened (comment at :72-77) so a negotiator "stub" upsert can't wipe a richer Design recipe — but the protection only `COALESCE(NULLIF(...,''))`-guards `setup_instructions`, `summary`, `docs_url`. The functional columns `oauth_type`, `fields_json`, and `healthcheck_json` are still overwritten unconditionally with `excluded.*`, and `source = excluded.source`. If any caller (the doc explicitly names the negotiator's session-start stub) upserts with an empty `fields_json` (`"[]"`) or null healthcheck, it downgrades a verified recipe to a hollow stub — the exact regression the guard was added to prevent, just on the columns it forgot.
- **Root cause**: Merge semantics applied to only 3 of the enrichment columns; the credential-defining columns retained clobber semantics.
- **Impact**: `get_by_connector` (consumed by negotiator/AutoCred to "skip redundant AI discovery") then returns a recipe with no fields → discovery is skipped yet the user is offered a connector with empty/incorrect credential fields, i.e. an eligibility false-positive (recipe "exists" but is unusable).
- **Fix sketch**: Apply the same merge to the functional columns, e.g. `fields_json = CASE WHEN excluded.fields_json IN ('','[]','null') THEN fields_json ELSE excluded.fields_json END`, and `healthcheck_json/oauth_type = COALESCE(NULLIF(excluded.*, ''), ...)`; or have the negotiator never upsert a stub that lacks fields.
- **Value**: impact=5 effort=3

## 5. `sanitize_secrets` misses unprefixed/unlabeled tokens — a raw secret pasted into a design instruction is persisted verbatim in the audit log
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: secret leakage (at rest)
- **File**: src-tauri/src/utils/sanitization.rs:27,36 (sink at src-tauri/src/commands/credentials/credential_design.rs:67-80)
- **Scenario**: `start_credential_design` truncates the user instruction to 120 chars and writes it as the audit `detail`, which is sanitized by `sanitize_secrets`. That sanitizer only masks values that are (a) label→value pairs (`api_key:`, `token:`, `password:`…), (b) `Bearer/Basic …`, or (c) known vendor prefixes (`ghp_`, `sk_live_`, `AKIA`, `xox…`). A raw high-entropy token with no recognizable prefix and no preceding label — e.g. a 40-char hex OAuth/PAT pasted as `connect github ab0123…ef` — matches none of the patterns and is stored in plaintext in `credential_audit_log.detail`.
- **Root cause**: Pattern-based denylist with no entropy/length fallback; the design instruction is free text that can plausibly contain a pasted secret.
- **Impact**: Plaintext credential material at rest in the audit DB and visible in the global security-dashboard log (`credential_audit_log_global`), outside the encrypted-credential boundary.
- **Fix sketch**: Add an entropy/length heuristic to `sanitize_secrets` (mask standalone tokens ≥ ~24 chars with high charset diversity), and/or avoid storing the raw instruction as audit detail — store a fixed label and keep the full text only in the (already-redacted) prompt path.
- **Value**: impact=6 effort=3
