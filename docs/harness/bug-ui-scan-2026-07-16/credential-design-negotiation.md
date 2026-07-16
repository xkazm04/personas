# Credential Design & Negotiation — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 2, Low: 2)

## 1. Negotiator stub upsert silently wipes a verified Design recipe's healthcheck and provenance
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/db/repos/resources/credential_recipes.rs:65-82 (with src/hooks/design/credential/useCredentialNegotiator.ts:162 and src/lib/credentials/credentialRecipeRegistry.ts:96-108)
- **Scenario**: User runs Credential Design for GitHub — a recipe is saved with `source="design"`, a verified `healthcheck_json`, and `oauth_type`. Later they open the Negotiator for the same connector; `startNegotiation` unconditionally calls `saveRecipeFromDesign({connector, setup_instructions: '', summary: ''}, 'negotiator')` before generating the plan. If the connector object in that flow lacks `healthcheck_config` (catalog/picker shapes often do), `healthcheckJson` is `null`.
- **Root cause**: The `ON CONFLICT` update merges only three enrichment columns (`setup_instructions`, `summary`, `docs_url` via `COALESCE(NULLIF(...))`) — its own comment says "MERGE, never clobber" — but `healthcheck_json`, `oauth_type`, `fields_json`, and `source` are still overwritten unconditionally by the stub row.
- **Impact**: A design-verified recipe is silently downgraded: `healthcheck_json` becomes NULL (subsequent AutoCred/recipe consumers skip credential verification entirely), `oauth_type` can be nulled (OAuth flow demoted to plain fields), and `source` flips to `"negotiator"`, misrepresenting provenance in RecipeConfidenceBanner. No error, no event — the loss is only visible when a future healthcheck never runs.
- **Fix sketch**: Extend the merge policy to `healthcheck_json` and `oauth_type` (`COALESCE(excluded.x, x)`), and only overwrite `source` when the incoming row actually enriches the recipe (e.g. `CASE WHEN excluded.setup_instructions IS NOT NULL ...`), or have the negotiator skip the stub upsert when a recipe already exists.

## 2. `upsert_credential_recipe` persists unvalidated JSON strings; corrupt recipes then fail silently downstream
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/credential_recipes.rs:29-60
- **Scenario**: Any caller passes a `fields_json` that is not valid JSON (or not an array of field objects) — a renderer bug, a hand-crafted invoke, or a schema drift between `CredentialDesignConnector` and the stored shape. The command inserts it verbatim; there is no `serde_json::from_str` check, no shape check, and no size cap on any of the six free-text columns.
- **Root cause**: The Tauri command is the persistence trust boundary but delegates all integrity to the (assumed well-behaved) frontend. On read-back, `recipeToDesignResult` catches the parse error with `silentCatch` and returns `fields: []` while still setting `match_existing: recipe.connector_name`.
- **Impact**: Success theater: Negotiator/AutoCred believe a cached recipe exists, skip AI discovery, and drive the user into a credential form with zero fields (or a healthcheck that never parses). The recipe is "used" (`usage_count` incremented) so it ranks higher in `list_all`, entrenching the corrupt row. Nothing ever surfaces the corruption to the user.
- **Fix sketch**: In the command, parse `fields_json` (must be a JSON array) and `healthcheck_json` (must be a JSON object) before upserting, rejecting with `AppError::Validation`; optionally cap column sizes. On the read side, treat unparseable `fields_json` as "no recipe" instead of returning a hollow design result.

## 3. Negotiation, step-help, and design-healthcheck Claude calls never record spend
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/negotiator.rs:99 (also negotiator.rs:141, credential_design.rs:154)
- **Scenario**: User runs several credential negotiations (300s CLI budget each), asks step-help questions, and tests design healthchecks (each spawns a Claude CLI run). They then check the LLM spend/usage dashboard.
- **Root cause**: The spend-ledger plumbing exists (`ArtifactSpend`, `run_claude_prompt_tracked` in ai_artifact_flow.rs) and the design flow uses it, but `start_credential_negotiation` passes `spend: None`, and both `get_negotiation_step_help` and `test_credential_design_healthcheck` call the untracked `run_claude_prompt` — inconsistent adoption of the "tiger #1" ledger.
- **Impact**: The `dev_llm_spend` ledger systematically under-reports credential-flow token cost; users making budgeting decisions from the dashboard see design runs but a blind spot for negotiation/help/healthcheck runs, which can dominate (healthcheck-generation runs on every design verification attempt).
- **Fix sketch**: Pass an `ArtifactSpend { source: "negotiation", ... }` in `start_credential_negotiation`, and switch the two `run_claude_prompt` call sites to `run_claude_prompt_tracked` with appropriate `SpendCtx` values.

## 4. Healthcheck runner silently coerces unknown HTTP methods to GET and cannot send a body
- **Severity**: Low
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/credential_design.rs:223-228
- **Scenario**: Claude's generated healthcheck config specifies `"method": "DELETE"` or `"HEAD"` (nothing in `CREDENTIAL_HEALTHCHECK_OUTPUT_SCHEMA` restricts the method), or picks a POST endpoint that requires a JSON body (the schema has no `body` field at all, so a body-requiring endpoint can't even be expressed).
- **Root cause**: The `match method.as_str()` arm maps every method other than POST/PUT/PATCH to `client.get(...)` via the `_` catch-all — a silent fallback instead of a rejection — and POST/PUT/PATCH requests are sent with an empty body.
- **Impact**: The healthcheck exercises a different request than the one Claude designed: a HEAD/DELETE becomes a GET, a body-requiring POST is sent empty and typically 400s. The user sees "healthcheck failed (HTTP 400/405)" against a valid credential — a false negative that undermines trust in the design flow — or in the GET-coercion case a check that "passes" without actually validating what was intended.
- **Fix sketch**: Whitelist explicitly (GET/HEAD/POST/PUT/PATCH) and return a validation error for anything else instead of coercing; add an optional templated `body` field to the healthcheck schema and send it on write-methods, or constrain the prompt schema to GET-only and enforce that.

## 5. BlastRadiusPanel icon-only controls: untranslated toggle label and unnamed close button
- **Severity**: Low
- **Category**: ui
- **File**: src/features/vault/sub_dependencies/BlastRadiusPanel.tsx:42,72
- **Scenario**: A screen-reader user (or any user in one of the 13 non-English locales) opens the blast-radius panel from the dependency graph. The simulation switch announces "Enable simulation mode" in hardcoded English regardless of locale, and the header X button exposes no accessible name at all — it reads as an unlabeled button.
- **Root cause**: The component otherwise sources every string from `t.vault.dependencies`, but the toggle's `aria-label` is an inline English literal and the close button relies solely on the `X` icon (lucide icons render `aria-hidden` content), so no name reaches the accessibility tree.
- **Impact**: WCAG 4.1.2 (name/role/value) failure on the close button; inconsistent localization on the toggle. Both are interactive controls in a security-relevant panel (revocation simulation), where mis-operation matters more than average.
- **Fix sketch**: Add `aria-label={dep.close ?? t.common.close}` to the X button and move the toggle's two label strings into `t.vault.dependencies` (seed all locale files per the i18n-no-gaps hook), keeping `role="switch"`/`aria-checked` as-is.
