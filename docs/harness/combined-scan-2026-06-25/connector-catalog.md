# Connector Catalog — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: connector-catalog | Group: Credential Vault & Connectors
> Total: 5 | Critical: 0 | High: 1 | Medium: 4 | Low: 0

## 1. Substring strategy match mis-routes the API-key `google_gemini` connector to GoogleOAuthStrategy
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: strategy-selection / wrong-connector
- **File**: src-tauri/src/engine/connector_strategy.rs:231
- **Scenario**: A user adds a Google Gemini credential (builtin connector `google_gemini`, `db/builtin_connectors.rs:780`, `auth_type:"api_key"`, no `oauth_type`, secret in `api_key`). The strategy registry resolves it: exact match `google_gemini` → none; metadata `oauth_type` → none; **substring `service_type.contains("google")` → returns `google-oauth` (GoogleOAuthStrategy)**. GoogleOAuthStrategy hardcodes `is_oauth()==true` and its `resolve_auth_token` calls `resolve_oauth_token(...)`, which finds no `access_token` and no `refresh_token` and returns `Err(Validation("Google credential is missing refresh_token"))`.
- **Root cause**: Step-3 substring fallback (line 231) assumes every `service_type` containing "google" is Google OAuth. `google_gemini` is the one shipped Google connector that authenticates with a query-param API key, so it is misclassified. The fallback runs *after* the metadata check but never consults `auth_type`.
- **Impact**: Both `engine/healthcheck.rs:408/425` and `engine/api_proxy.rs:748/771` resolve the strategy the same way, so (a) the Gemini healthcheck errors out → `connector_readiness.credential_is_usable` sees `healthcheck_last_success == Some(false)` → the connector is reported **NeedsSetup even when correctly configured** (readiness false-negative, persona can't be promoted); and (b) every live Gemini API call fails with "missing refresh_token" instead of using the api_key. Gemini is explicitly marketed as the cross-family "second-opinion LLM," so this fully breaks a recommended connector.
- **Fix sketch**: Gate the substring arm on the connector actually being OAuth, e.g. only fall through to `google-oauth` when `auth_type`/`oauth_type` indicates OAuth, or exclude API-key google connectors. Simplest: register `google_gemini` explicitly to DefaultStrategy, or change the substring rule to require `oauth_type=="google"` (which the legit OAuth google_* connectors already carry) and drop the bare-name substring match.
- **Value**: impact=8 effort=2

## 2. Readiness collapses "no credential" and "ambiguous (2+) credentials" into one verdict with a misleading remediation
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: readiness false-signal / wrong-remediation
- **File**: src-tauri/src/commands/design/connector_readiness.rs:283 (and `resolve_one_credential` 409-414, remediation 67)
- **Scenario**: A persona declares connector `notion`. The user has two Notion credentials in the vault (personal + work). `resolve_one_credential` returns `None` because `exact.len() > 1` (line 412-413), exactly as it does when there are zero candidates. `connector_readiness` therefore returns `NeedsSetup{ kind: VaultCredential }`, whose remediation string is "add the credential in Settings → Vault".
- **Root cause**: The resolver flattens two distinct states — absent (0 candidates) and ambiguous (2+ candidates) — into a single `VaultCredential` blocker. There is no `SetupKind` (e.g. `DisambiguateCredential`) for "you have several, pick one", so the UI routes the user to add *another* credential.
- **Impact**: A persona that genuinely has the required credential is reported not-ready and can never be promoted; the remediation actively makes it worse (the user adds a 3rd credential, still ambiguous). Common whenever a user keeps two accounts for one service. The `credential_connector_with_ambiguous_candidates_needs_setup` test asserts not-ready but never checks that the *remediation* is correct, so the gap is untested.
- **Fix sketch**: Have `resolve_one_credential` distinguish 0 vs 2+ (e.g. return an enum), and add a `SetupKind::DisambiguateCredential` whose remediation is "you have multiple matching credentials — pick which one this persona uses," routing to a picker rather than the add-credential flow.
- **Value**: impact=5 effort=3

## 3. Token-refresh is implemented only for Google/Microsoft; other catalog OAuth connectors silently fall to a non-refreshing Default
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented strategy allowlist / latent auth failure
- **File**: src-tauri/src/engine/connector_strategy.rs:209-213 (oauth_type map) + 256-264 (default fallback) + 67-73 (Default `resolve_auth_token`)
- **Scenario**: The catalog ships OAuth connectors with `oauth_type:"linkedin"` (`builtin_connectors.rs:999`) and `oauth_type:"meta"` (`:1069`). `registry().get()` has no exact strategy for them; the metadata `oauth_type` map only handles `"google"`/`"microsoft"` (line 209-213); no substring matches → DefaultStrategy. Default's `resolve_auth_token` just returns the stored `access_token` via `find_auth_token` — it never exchanges the refresh token. On 401, `api_proxy.rs:849-863` calls `resolve_auth_token` again, which returns the *same* expired token.
- **Root cause**: The provider→strategy allowlist is hand-maintained and undocumented (only Google + Microsoft refresh logic exists), while the catalog declares more OAuth providers. Default is treated as a safe catch-all but cannot refresh access tokens for an arbitrary provider (no token endpoint).
- **Impact**: LinkedIn/Meta (and any future non-Google/MS OAuth) credentials work until their short-lived access token expires, then fail with no automatic recovery during a run — presenting as intermittent connector outages that "fix themselves" only on manual rotation. The supported-provider set is nowhere documented, so adding such a connector looks complete but is half-wired.
- **Fix sketch**: Either (a) document the OAuth providers with real refresh support and refuse/flag catalog OAuth connectors outside it, or (b) make Default's `resolve_auth_token`/refresh path generic by reading the provider token URL from connector metadata so any declared `oauth_type` can refresh.
- **Value**: impact=6 effort=4

## 4. Recipe-eligibility tool matching is case-sensitive with no normalization (undocumented assumption)
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: eligibility heuristic / undocumented invariant
- **File**: src-tauri/src/engine/recipe_eligibility.rs:106-124
- **Scenario**: `persona_names`/`catalog_names` are built from `PersonaToolDefinition.name` and compared with `HashSet::contains(name)` against the raw `tool_hints` strings. A recipe whose serialized UC declares `tool_hints:["WebSearch","File_Read"]` while the catalog/persona use `web_search`/`file_read` finds neither in `persona_names` nor `catalog_names` → both land in `missing_tools_uncatalogued` → state `Incompatible`.
- **Root cause**: The module doc states scoring is "name-based" but never states the names must match byte-for-byte; there is no `to_ascii_lowercase()`/trim normalization on either side (contrast `connector_readiness.rs`, which lowercases everything). Casing/format drift between the recipe-derivation pipeline and the tool catalog silently flips a recipe to the dimmed, un-adoptable "Incompatible" bucket.
- **Impact**: Valid, fully-supportable recipes are presented as permanently incompatible with a "no setup path resolves this" reason — a confusing dead end for the user and a false catalog signal. Likelihood scales with how disciplined the derivation pipeline is about lowercase tool names; any single non-normalized emitter triggers it.
- **Fix sketch**: Normalize both sides once (e.g. lowercase + trim) when building the `HashSet`s and when pushing into the result vectors, and document the canonical tool-name form as the matching contract. Add a test with mixed-case `tool_hints`.
- **Value**: impact=5 effort=2

## 5. `find_auth_token` does not trim, unlike `find_nonempty` — a copy-pasted token with whitespace is reported unhealthy
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: readiness false-negative / input robustness
- **File**: src-tauri/src/engine/connector_strategy.rs:316-341 (used by Default `resolve_auth_token`, line 72)
- **Scenario**: A user pastes an API key with a trailing newline or surrounding spaces (extremely common from web consoles). For any DefaultStrategy connector, `find_auth_token` returns the value verbatim (`!val.is_empty()`, no trim), `apply_auth` emits `Authorization: Bearer <token>\n`, the provider rejects it, the healthcheck fails, and `credential_is_usable` then reports the connector as not-ready.
- **Root cause**: Inconsistency within the same file: the sibling helper `find_nonempty` (line 303-313) trims before returning, but `find_auth_token` (the one feeding the default token path) checks only `!val.is_empty()` and clones the raw value.
- **Impact**: A correctly-obtained credential is reported unhealthy/not-ready, sending the user to re-enter a secret that was actually right — a hard-to-diagnose papercut across the large majority of connectors that use DefaultStrategy. Readiness false-negative driven purely by invisible whitespace.
- **Fix sketch**: Trim in `find_auth_token` (return `trimmed.to_string()` when non-empty), mirroring `find_nonempty`; ideally also trim secrets at save time so stored values are clean.
- **Value**: impact=5 effort=2
