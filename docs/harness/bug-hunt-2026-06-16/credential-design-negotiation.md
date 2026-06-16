# Bug Hunter — Credential Design & Negotiation

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: credential-design-negotiation | Group: Credential Vault & Connectors

## 1. Negotiator overwrites a richer Design recipe with an empty stub at session start
- **Severity**: Critical
- **Category**: Silent failure / data corruption (wrong recipe silently bound)
- **File**: `src/hooks/design/credential/useCredentialNegotiator.ts:162`
- **Scenario**: User runs the Design flow for `slack`, producing a recipe with full `setup_instructions`, `summary`, and `docs_url`. Later they open the Negotiator for the same connector. `start()` immediately fires `saveRecipeFromDesign({ match_existing: null, connector, setup_instructions: '', summary: '' }, 'negotiator')` *before* the negotiation runs — passing empty strings for instructions/summary derived only from the input connector object.
- **Root cause**: `saveRecipeFromDesign` maps `setup_instructions: result.setup_instructions || null` → `null`, and the repo `upsert` (`src-tauri/src/db/repos/resources/credential_recipes.rs:65`) uses `ON CONFLICT(connector_name) DO UPDATE SET setup_instructions = excluded.setup_instructions, summary = ..., docs_url = ..., source = ...`. The conflict update unconditionally clobbers every column with the stub values; there is no "only overwrite if richer" guard. `docs_url` is also recomputed from the empty instructions → `null`.
- **Impact**: A high-quality cached recipe is silently downgraded to a stub on every Negotiator open. Subsequent AutoCred (`lookupRecipeAsDesignResult`) and the `RecipeConfidenceBanner` ("Verified setup") now serve empty setup instructions and a null docs URL while still showing the green "verified" badge — success theater over degraded data. The save happens even if the user immediately cancels the negotiation.
- **Fix sketch**: Do not write a recipe on negotiator *start*. Only persist after a successful plan, and merge rather than clobber: in `upsert`, use `COALESCE(excluded.setup_instructions, setup_instructions)` for nullable enrichment columns, or gate the upsert so `source='negotiator'` never overwrites a `source='design'` row's instructions.

## 2. `get_dependents` substring join inflates blast radius with false-positive dependents
- **Severity**: High
- **Category**: Latent failure (blast-radius miscalculation / eligibility false positive)
- **File**: `src-tauri/src/db/repos/resources/audit_log.rs:235`
- **Scenario**: A credential's structural dependents are computed by joining every persona that owns *any* tool to the connector, filtered only by `WHERE cd.services LIKE '%' || ptd.name || '%'`. The `connector_definitions cd ON cd.name = ?1` join is unconstrained to the persona's tools — it is effectively a cross join of all personas-with-tools against the single target connector, narrowed by a substring test of the tool name appearing anywhere in the connector's `services` JSON text.
- **Root cause**: `LIKE '%' || ptd.name || '%'` does unanchored substring matching against a serialized JSON blob with no key/boundary awareness. A short or common tool name (`get`, `list`, `read`, `user`, `search`) matches almost any connector's `services` payload, and there is no join predicate tying the tool to the credential's connector beyond the name fragment.
- **Impact**: `credential_dependents` (and the `dependentsMap` feeding `buildCredentialGraph` → `analyzeBlastRadius`) reports personas that never use the credential. Blast-radius severity (3+ agents = "high"/rotate-now) and the revocation simulator's revenue/executions-lost estimates are inflated, eroding trust and masking which credentials are *actually* safe to rotate. Conversely, a persona whose tool name is not a literal substring of the JSON is missed entirely (false negative hiding real impact).
- **Fix sketch**: Replace the substring `LIKE` with a structural join: parse `cd.services` JSON and match tool definitions by id/exact name, or maintain an explicit `persona_tool ↔ connector` linkage. At minimum anchor on JSON-array element equality (`json_each`) rather than raw `LIKE '%...%'`.

## 3. Concurrent design/negotiation starts race the registry guard and silently discard a result
- **Severity**: High
- **Category**: Race condition (negotiation state corruption / success theater)
- **File**: `src-tauri/src/commands/credentials/negotiator.rs:66`
- **Scenario**: Two `start_credential_negotiation` (or two `start_credential_design`) calls arrive close together — e.g. a double-click, or a retry before the prior task settled. Both call `registry.set_id(domain, new_id)`. The second `set_id` overwrites the first's id. When task A finishes and runs `is_cancelled = registry.get_id(&domain).as_deref() != Some(&task_id)` (`ai_artifact_flow.rs:255`), it sees task B's id, concludes it was "cancelled," and returns *without emitting any status* — the UI listening on the first id never gets `completed` or `failed`.
- **Root cause**: These two commands still use the legacy `set_id` pattern. The registry already added `begin_run` / `try_begin` specifically to fix this exact race (documented at `src-tauri/src/lib.rs:168-185`, "bug-hunt 2026-06-07 recipes #2: a `get_id()`-then-`set_id()` pair … lets both pass the guard, spawning duplicate tasks and silently discarding a result"), but `credential_design.rs:58` and `negotiator.rs:66` were never migrated to it.
- **Impact**: Duplicate CLI processes spawn (double token spend), and one valid provisioning plan / connector design is silently dropped — the spinner can hang until timeout, or the user gets a stale result. Cancel also only kills one PID since `set_pid` is overwritten.
- **Fix sketch**: Replace `registry.set_id(domain, id)` with `registry.try_begin(domain, id)` (reject the second start) or `begin_run` (preempt + cancel the prior run and kill its PID), mirroring the migrated recipe/automation commands.

## 4. Healthcheck `headers` skips non-string values, letting auth headers vanish silently
- **Severity**: Medium
- **Category**: Silent failure (success theater on binding validation)
- **File**: `src-tauri/src/commands/credentials/credential_design.rs:202`
- **Scenario**: Claude returns a `headers` object where a value is not a JSON string (e.g. a number, an object, or an accidentally-nested `{ "value": "..." }`). The loop does `if let Some(raw) = val.as_str() { ... } ` and silently drops any non-string header. If the (only) `Authorization` header is malformed this way, the healthcheck request is sent with *no* auth header.
- **Root cause**: `as_str()` returns `None` for non-string JSON values and the code has no `else`/error branch — it just omits the header. There is no validation that required template placeholders (e.g. `{{api_key}}`) were actually resolved into a sent header.
- **Impact**: An unauthenticated request may still return the `expected_status` (many APIs return 200 on a public/identity endpoint), so `test_credential_design_healthcheck` reports `success: true` even though the credential was never exercised. The user binds a credential believing it was validated when it wasn't — a wrong/invalid credential passes the "verified" gate.
- **Fix sketch**: Treat a non-string header value as a hard error (return a `Validation` AppError naming the bad header), and assert that every `{{placeholder}}` referenced in the config resolved to a non-empty value before sending; fail the healthcheck if an auth-bearing header is empty.

## 5. Docs-URL extraction grabs the first URL anywhere in setup instructions
- **Severity**: Low
- **Category**: Edge case (recipe metadata wrong, mildly misleading)
- **File**: `src/lib/credentials/credentialRecipeRegistry.ts:84`
- **Scenario**: `saveRecipeFromDesign` derives `docsUrl` via `result.setup_instructions.match(/https?:\/\/[^\s)]+/)` — the *first* URL found. AI-generated markdown often opens with a non-canonical link (a status page, a blog post, an `https://example.com` schema placeholder copied from the prompt, or an OAuth `redirect_uri` literal) before the real developer-portal URL.
- **Root cause**: First-match heuristic with no notion of which URL is the canonical docs/portal link, and `[^\s)]+` stops at `)` but still captures trailing punctuation like `.` or `,` when the URL is followed by them without a paren.
- **Impact**: The cached recipe and any "open docs" affordance point at the wrong page; combined with finding #1, a stub recipe gets a misleading `docs_url`. Low severity because it is advisory UI, not a binding decision.
- **Fix sketch**: Prefer a URL on a line/bullet whose text mentions "docs", "portal", "settings", or "developer"; strip trailing punctuation; or let the design prompt emit an explicit `docs_url` field instead of regex-scraping the markdown.
