# Code-refactor scan — OAuth, Discovery, Foraging & API Proxy

> Total: 10 findings (2 high, 5 medium, 3 low)
> Scope: src/ + src-tauri/, full-stack
> Date: 2026-05-12

> **Note on scope mismatch**: The requested paths assumed a `src/features/vault/{oauth,discovery,foraging,proxy}/`, `src/api/vault/{oauth,discovery,foraging,proxy}.ts`, `src/stores/slices/vault/{oauthSlice,discoverySlice,foragingSlice,proxySlice}.ts`, and `src-tauri/.../commands/vault/...` layout. In the actual codebase, these features live under `src-tauri/src/commands/credentials/{oauth,discovery,foraging,api_proxy,connectors,auto_cred_browser,negotiator}.rs`, `src/api/vault/{oauthGatewayApi,foraging,autoCredBrowser,negotiator}.ts`, `src/api/auth/connectors.ts`, `src/api/system/apiProxy.ts`, and `src/hooks/design/oauth/` plus `src/features/vault/shared/hooks/`. There are no dedicated oauth/discovery/foraging/proxy zustand slices (the relevant slice is `credentialSlice.ts`). Findings below cover the actual modules.

---

## 1. Two parallel OpenAPI/Swagger parsers in the proxy stack

- **Severity**: high
- **Category**: duplication
- **File**: `src-tauri/src/engine/api_definition.rs:49` and `src-tauri/src/commands/credentials/openapi_autopilot.rs:141`
- **Scenario**: `engine::api_definition::parse_openapi_spec` (used by `parse_api_definition` / `save_api_definition` / `load_api_definition` for the API Explorer) and `commands::credentials::openapi_autopilot::parse_openapi_spec` (used by the autopilot generator) each parse OpenAPI 3.x / Swagger 2.x JSON or YAML, walk `paths`, filter the same `["get","post","put","patch","delete","head","options"]` method list, extract parameters from path-level + operation-level `parameters`, and pull request bodies out of `requestBody.content.application/json.schema`. The two implementations duplicate ~120 LOC of nearly identical traversal logic (`api_definition.rs:49-204` vs `openapi_autopilot.rs:141-397`), differing mainly in which subset of fields they retain (`ApiEndpoint`/`ApiParameter`/`ApiRequestBody` vs `OpenApiEndpoint`/`OpenApiParameter`/`OpenApiAuthScheme`).
- **Root cause**: Two features (API Explorer playground, OpenAPI autopilot connector generator) added their own parser instead of layering a richer extractor on top of the existing one.
- **Impact**: Bug fixes to OpenAPI handling (e.g., `$ref` resolution, parameter location defaults, Swagger 2 fallbacks) must land twice; the two extractors already drift on details (e.g., `required` default in `api_definition.rs:138` defaults to `location == "path"` while `openapi_autopilot.rs:375` always defaults to `false`).
- **Fix sketch**: Promote `engine::api_definition::parse_openapi_spec` to return a richer common AST (endpoints + auth_schemes + models + spec_format) or extract a shared `extract_endpoints`/`extract_parameters` helper into `engine::api_definition` and have `openapi_autopilot.rs` consume it for endpoint walking, keeping only the autopilot-specific connector synthesis on top.

---

## 2. Three near-duplicate Google OAuth consent hooks share one backend pair

- **Severity**: high
- **Category**: duplication
- **File**: `src/hooks/design/oauth/useOAuthConsent.ts:26`, `src/features/vault/shared/hooks/useGoogleOAuth.ts:32`, `src/features/vault/shared/hooks/useCredentialOAuth.ts:23`
- **Scenario**: All three hooks ultimately invoke the same backend pair (`startGoogleCredentialOAuth` + `getGoogleCredentialOAuthStatus`) and wire `extractValues` to populate identical fields (`refresh_token`, `scopes`, `OAUTH_FIELD.SCOPE`, `OAUTH_FIELD.COMPLETED_AT`, `OAUTH_FIELD.CLIENT_MODE='app_managed'`). `useOAuthConsent` (68 LOC) uses `useOAuthPolling`; `useGoogleOAuth` (69 LOC) uses `useOAuthProtocol` (a layer above `useOAuthPolling`); `useCredentialOAuth` (84 LOC) wraps `useGoogleOAuth` adding pending-values ref. The result-shaping logic for `effectiveScope` / `scopes` fallback / `client_mode='app_managed'` is repeated across all three (`useOAuthConsent.ts:34-43`, `useCredentialOAuth.ts:41-52`).
- **Root cause**: Incremental migration from `useOAuthPolling` → `useOAuthProtocol` left both generations live; `useCredentialOAuth` was added later as a third wrapper for the design flow without retiring the others.
- **Impact**: Three hooks to keep in sync for every Google OAuth field/scope change. `useOAuthConsent` and `useGoogleOAuth` are direct competitors — both export `OAuthConsentState`/`GoogleOAuthState` shapes that differ only cosmetically (`isAuthorizing`, `completedAt`, `message`, `getValues`, `valuesVersion`, `startConsent`, `reset`).
- **Fix sketch**: Pick `useOAuthProtocol` as the canonical low-level hook. Delete `useOAuthConsent` (its only caller is `useCredentialDesignOrchestrator.ts`, which can switch to `useGoogleOAuth` directly). Fold `useCredentialOAuth`'s pending-values-ref behaviour into a tiny helper (`useOAuthSuccessWithPending`) instead of a third hook layer.

---

## 3. `OAuthSession::extra` and `provider_id` flagged `#[allow(dead_code)]`

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/commands/credentials/oauth.rs:1095-1109`
- **Scenario**: The `OAuthSession` struct is annotated `#[allow(dead_code)]` at line 1096. The struct holds `provider_id`, `extra`, and several token fields that are only written but never read after the JSON serialization in `get_session_status` (line 1235). The session is removed from the map on terminal status (`oauth.rs:1247`), so the stored fields exist only for one read cycle — yet `provider_id` is stored on insert (lines 408, 1429) and serialized (line 1237) but never used by Rust logic; same for `extra` (lines 414, 1435, 1243). The `#[allow(dead_code)]` mask hides the fact from the compiler.
- **Root cause**: The struct was carrying fields for an earlier multi-flow design; once serialization moved to `serde_json::json!()` on every read, the Rust struct fields became write-only.
- **Impact**: Hides whether new fields are actually consumed; obscures whether the entire struct could shrink. Encrypts/decrypts more state than necessary (every `get_session_status` decrypts both `access_token` and `refresh_token` even though only the success path needs them).
- **Fix sketch**: Remove `#[allow(dead_code)]`. Either (a) consume the fields directly in `get_session_status` instead of round-tripping through `serde_json::Value` (lossy and re-encodes), or (b) collapse `OAuthSession` to only the fields actually re-read (status, created_at, error, access_token, refresh_token) and inline the rest into a one-shot JSON blob on insert.

---

## 4. ForageSource has two dead variants (`AwsConfig`, `GitConfig`) — never emitted but UI/i18n exist

- **Severity**: medium
- **Category**: dead-code
- **File**: `src-tauri/src/commands/credentials/foraging.rs:44`, `:52`
- **Scenario**: `ForageSource` (foraging.rs:42-53) declares 10 variants. Grepping for `ForageSource::` in the scanner shows only 8 are ever constructed: `EnvVar` (line 197), `AwsCredentials` (236), `KubeConfig` (313), `DotEnv` (374), `Npmrc` (409), `DockerConfig` (443), `GitHubCli` (496), `SshKey` (532). `AwsConfig` and `GitConfig` are never produced by any scanner function. The TS binding `src/lib/bindings/ForageSource.ts:3` includes both, the UI `ForagingResultCard.tsx:29,37` maps icons/colors for them, and `src/i18n/locales/en.json` has `source_aws_config: "AWS Config"` and `source_git_config: "Git Config"` translations — all of which can never appear because the backend never produces those variants.
- **Root cause**: Variants were added speculatively (probably planning `~/.aws/config` and `~/.gitconfig` scanners) but the scanner functions were never written; the dead UI/i18n entries were generated from the enum optimistically.
- **Impact**: ~3 UI/i18n entries that can never fire, an enum that lies about its surface area, and `ForageSource` matches that look exhaustive but cover unreachable arms.
- **Fix sketch**: Either implement `scan_aws_config()` (for `[profile xxx]` blocks in `~/.aws/config`) and `scan_gitconfig()` (for `[credential] helper = ...` and `[url "https://token@host"]`), OR drop the two variants from `ForageSource` and remove the corresponding `ForagingResultCard` rows and `source_aws_config` / `source_git_config` translations.

---

## 5. `GoogleCredentialOAuthStartResult` / `OAuthStartResult` (and Status variants) are near-duplicates

- **Severity**: medium
- **Category**: duplication
- **File**: `src/lib/bindings/GoogleCredentialOAuthStartResult.ts:3`, `src/lib/bindings/OAuthStartResult.ts:3`, `src/lib/bindings/GoogleCredentialOAuthStatusResult.ts:4`, `src/lib/bindings/OAuthStatusResult.ts:4`
- **Scenario**: `GoogleCredentialOAuthStartResult = { session_id, auth_url, redirect_uri, credential_source? }` vs `OAuthStartResult = { session_id, auth_url, redirect_uri, provider_id, pkce_used }` — overlap is 3 of 4-5 fields. Status variants are even closer: both have `status, provider_id?, refresh_token, access_token, scope, token_type, expires_in, extra, error` with only `provider_id`/`token_type`/`expires_in`/`extra` differing in optionality. Both flows funnel through the same backend session map (`oauth.rs:1111`). Frontend hooks (`useOAuthPolling`, `useOAuthProtocol`) require generic parameters because the types are nominally distinct.
- **Root cause**: Google flow was implemented first with a Google-shaped response; the universal gateway was added later and chose to expose `provider_id`/`pkce_used` in its own DTO instead of widening the Google one.
- **Impact**: Frontend hooks need parallel generics for each variant; the two Tauri commands `start_google_credential_oauth` and `start_oauth` exist in tandem (oauth.rs:377 and oauth.rs:1295) doing 85% the same work because the response types diverged.
- **Fix sketch**: Unify to a single `OAuthStartResult { session_id, auth_url, redirect_uri, provider_id, pkce_used?: bool, credential_source?: string }` and a single `OAuthStatusResult`. Mark `start_google_credential_oauth` as a thin shim over `start_oauth` with `provider_id = "google_credential"` (or deprecate it once the Google flow migrates to the universal command).

---

## 6. Two near-identical session-bootstrap blocks in `start_google_credential_oauth` / `start_oauth`

- **Severity**: medium
- **Category**: duplication
- **File**: `src-tauri/src/commands/credentials/oauth.rs:377-511` and `oauth.rs:1295-1505`
- **Scenario**: Both commands do the same dance: `cleanup_oauth_sessions()` → format `session_id = format!("…_{}_{}", now_unix_secs(), uuid::Uuid::new_v4())` → `TcpListener::bind("127.0.0.1:0")` → resolve `port`/`redirect_uri` → insert `OAuthSession { status: Pending, ... created_at: now_unix_secs() }` into `oauth_sessions()` → audit `"oauth_initiated"` → `tokio::spawn` running `run_oauth_callback_server` → `apply_oauth_outcome` → invalidate `auth_detect_cache`. Lines 388-419 ≈ lines 1314-1440 with provider-specific scope/PKCE logic in between. Both build the auth URL via the same `url::Url::parse(...).query_pairs_mut()` pattern with `client_id`/`redirect_uri`/`response_type`/`state`/`scope`.
- **Root cause**: Google flow predated the universal flow; when universal was added, the listener-spawn-audit-await scaffold was copy-pasted instead of refactored into a helper.
- **Impact**: ~60 lines of structural boilerplate maintained in two places. Future security/observability changes (e.g., adding telemetry per session-start, swapping the listener bind to a randomised range) require touching both.
- **Fix sketch**: Extract a `bootstrap_oauth_session(state, provider_id, audit_subject) -> Result<(session_id, listener, redirect_uri, oauth_state), AppError>` helper that handles cleanup, listener bind, session insert, audit log, and state generation. Both commands then call this and only specialize the auth-URL-building and the `tokio::spawn` exchange closure.

---

## 7. `dynamic_base_url` for `azure_devops` and provider routing fragmented across multiple sites

- **Severity**: medium
- **Category**: structure
- **File**: `src-tauri/src/engine/api_proxy.rs:466-549`
- **Scenario**: Connector→base-URL mapping is split across three places that all encode connector knowledge: `well_known_base_url()` (api_proxy.rs:466 — 50+ static `service_type` → URL mappings), `dynamic_base_url()` (api_proxy.rs:533 — 2 dynamic variants), and the `execute_api_request` body resolution chain (api_proxy.rs:637-659 — falls back to `fields.get("base_url")`, `project_url`, `url`, `deployment_url`, `redis_url`, `host`, `domain`). Adding a new connector with a non-trivial base URL pattern requires editing 2-3 of these. Also, `ENV_PATTERNS` in foraging.rs:73 (60+ env vars) and `PROVIDER_REGISTRY` in oauth.rs:650 (13 OAuth providers) and `well_known_base_url` (50+ APIs) all enumerate the same provider universe with different fragments of metadata — there's no single connector catalogue.
- **Root cause**: Each subsystem (proxy, OAuth, foraging) grew its own provider lookup table because they evolved independently.
- **Impact**: A new connector requires touching `well_known_base_url`, optionally `dynamic_base_url`, possibly `ENV_PATTERNS`, possibly `PROVIDER_REGISTRY`, plus the DB-stored `connector_definitions` row. Drift is inevitable (e.g., `linkedin` and `reddit` appear in both `PROVIDER_REGISTRY` (oauth.rs:738, 748) and `well_known_base_url` (api_proxy.rs:517, 518), but most providers appear in only one).
- **Fix sketch**: Move the static parts of `well_known_base_url`, `PROVIDER_REGISTRY`, and `ENV_PATTERNS` into a single compiled-in `connector_catalog::ENTRIES: &[ConnectorEntry]` table with optional fields (`base_url`, `oauth: Option<OAuthSpec>`, `env_vars: &[(&str, &str)]`). Keep the dynamic resolutions (`telegram`, `azure_devops`) as separate hooks. This is a structural refactor — high-impact but mechanical.

---

## 8. `ENV_PATTERNS` iterated linearly in 4 hot paths (no HashMap index)

- **Severity**: low
- **Category**: structure
- **File**: `src-tauri/src/commands/credentials/foraging.rs:73-132`
- **Scenario**: `ENV_PATTERNS` (~60 entries) is iterated linearly four times: `scan_env_vars` (line 164 — once per scan, calling `std::env::var(env_key)` per pattern), `parse_dotenv_content` (line 365 — inner loop, O(lines × patterns)), `EnvResolver::resolve` (line 747 — O(patterns)), `DotenvResolver::resolve` (lines 808 + 837 — twice). Particularly `parse_dotenv_content` is O(dotenv_lines × 60) per .env file.
- **Root cause**: A flat const array is convenient for declaration; lookup-by-env-name and lookup-by-service-type were both added later as ad-hoc iterations.
- **Impact**: Currently fast (~60 entries, small .env files), but mostly a structural smell — adding a `HashMap<&str, (&str, &str)>` keyed by env name would make `parse_dotenv_content` O(lines) and `DotenvResolver::resolve` O(1).
- **Fix sketch**: Build two `LazyLock<HashMap>` indexes alongside the array — one keyed by env name (`OPENAI_API_KEY → (svc, field)`), one keyed by service type (`"github" → [(env, field), ...]`). Have all four sites query the appropriate index.

---

## 9. `scan_aws_credentials`, `scan_kube_config`, `scan_github_cli`, `scan_dotenv_files` repeat the same `home_dir() → read_to_string → return early` skeleton

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/credentials/foraging.rs:210-541`
- **Scenario**: `scan_aws_credentials` (line 210), `scan_kube_config` (270), `scan_dotenv_files` (324), `scan_npmrc` (388), `scan_docker_config` (422), `scan_github_cli` (456), `scan_ssh_keys` (509) each open with `let Some(home) = home_dir() else { return results; }; let path = home.join(...); let content = match std::fs::read_to_string(&path) { Ok(c) => c, Err(_) => return results, };`. That's a 6-line preamble repeated 6 times. Meanwhile, `read_home_file` in the resolver section (line 721) does almost exactly that — but the resolver function returns `Result<String, String>` while the scanners want `Option`/early-return, so neither uses the other.
- **Root cause**: Resolver helper was added after the scanners; nobody refactored the scanners to use it.
- **Impact**: Small but real noise. ~36 LOC of boilerplate. Two slightly different error policies (resolver fails loudly, scanners fail silently) for the same I/O operation.
- **Fix sketch**: Add `fn try_read_home_file(relative: &[&str]) -> Option<String>` returning `None` on home-missing or read-failure. Refactor each scanner to start with `let content = try_read_home_file(&[".aws", "credentials"])?` (with `let Some(content) = ... else { return results; }` for the early-return pattern). Reduces 6 boilerplate blocks to 1 line each.

---

## 10. `GitHubCliResolver` re-implements the YAML parsing already done by `scan_github_cli`

- **Severity**: low
- **Category**: duplication
- **File**: `src-tauri/src/commands/credentials/foraging.rs:456-506` and `:851-880`
- **Scenario**: `scan_github_cli` (line 456) walks `~/.config/gh/hosts.yml` looking for `oauth_token:` lines under host headers. `GitHubCliResolver::resolve` (line 851) does the same walk on the same file with the same `let mut current_host` state machine — only differing in that it filters to a specific host and returns the unmasked token. The two YAML walkers (lines 479-503 vs 861-876) are character-for-character similar except for the final action. Similarly `scan_aws_credentials` (lines 243-260) and `AwsProfileResolver::resolve` (lines 769-794) duplicate the `[profile]` / `key = value` walk for the same `~/.aws/credentials` file. And `parse_dotenv_content` (line 344) vs `DotenvResolver::resolve` (line 823) both parse .env lines.
- **Root cause**: Scanners (which mask values) and resolvers (which return raw values) were written as separate state machines instead of sharing a parser that returns raw values + a single masking step.
- **Impact**: Three parsers in two flavours each = 6 parse routines for what should be 3 (one per file format). Bug fixes (e.g., handling YAML comments, supporting quoted profile names) need to land in both flavours to avoid the scan/import results disagreeing.
- **Fix sketch**: Extract three pure parsers: `parse_aws_credentials_file(content: &str) -> Vec<(profile, HashMap<key, value>)>`, `parse_gh_hosts_yml(content: &str) -> Vec<(host, token)>`, `parse_dotenv(content: &str) -> Vec<(key, value)>`. Have each scanner call the parser and then apply `mask_value()`; have each resolver call the same parser and filter by ID. Eliminates ~80 LOC of duplicated state machines.

