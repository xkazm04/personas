# OAuth, API Proxy & Foraging — bug-hunter + ui-perfectionist scan

> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Proxy's inline OAuth exchange discards the rotated refresh_token — bricks the credential
- **Severity**: High
- **Category**: bug
- **File**: src-tauri/src/engine/api_proxy.rs:803 (also :906)
- **Scenario**: A proxied request runs while the stored access_token is expired but the proactive refresher hasn't caught it yet (credential in refresh backoff, tick hasn't fired since wake-from-sleep, or the startup sweep is still running). `strategy.resolve_auth_token(...)` then performs a real refresh_token exchange inline (connector_strategy.rs:589-630, `resolve_oauth_token` falls through to `exchange_oauth_refresh_token`), and the provider rotates the refresh_token (RFC 6749 §6 — Google in some configs, Microsoft, X/Twitter do this).
- **Root cause**: `api_proxy.rs` consumes the exchange result with `.map(|r| r.token)`, discarding `resolved.refresh_token` and `expires_in_secs`. The atomic persist block in `oauth_refresh.rs:495-558` exists precisely because "the provider has ALREADY invalidated the old refresh_token the moment it returned the new one" — but this resolve path bypasses that persistence entirely. The design assumption "resolve_auth_token is read-only" is false: it can mutate provider-side state.
- **Impact**: The DB keeps the now-dead old refresh_token; the next refresh (tick or 401-retry) gets `invalid_grant` and the credential is permanently broken until manual re-auth. Secondary effect even without rotation: the new access_token is never persisted either, so *every* proxied request during the expired window performs a full token exchange (exchange storm, provider quota burn, latency).
- **Fix sketch**: When `resolved.refresh_token.is_some() || resolved.expires_in_secs.is_some()` after `resolve_auth_token` in the proxy path, persist via the same transactional upsert used in `refresh_single_credential_inner` (or better: route the expired-token case through `force_refresh_single_credential` and re-read fields, keeping the strategy resolve as a pure cache read).

## 2. Foraged Twilio credentials are created with a service_type that matches no connector
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/foraging.rs:106
- **Scenario**: User has `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` in env or `.env`, runs the foraging scan, and imports the discovery. The credential row is written with `service_type = "twilio-sms"` (hyphen).
- **Root cause**: The registered connector is named `twilio_sms` (builtin_connectors.rs:1774), and every consumer keys on that exact string: `well_known_base_url` (api_proxy.rs:510 matches `"twilio_sms"`), connector lookup `c.name == credential.service_type`, strategy registry, and healthcheck config. ENV_PATTERNS is the only place using the hyphenated spelling.
- **Impact**: The imported credential is dead on arrival — `execute_api_request` finds no connector, no metadata/strategy, and no well-known base URL, so it errors with "no base URL field and no well-known API URL"; healthcheck and templates can't use it either. `mark_existing` also never flags it against an existing `twilio_sms` vault credential, so re-scans keep offering a duplicate import.
- **Fix sketch**: Change both ENV_PATTERNS entries to `"twilio_sms"`, and add a one-time migration (or import-time normalization map) for already-imported `twilio-sms` rows.

## 3. Dotenv foraging splits multi-field services into unusable one-field credentials
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/foraging.rs:364 (scan) and :806-853 (DotenvResolver)
- **Scenario**: A `~/.env` contains `SUPABASE_URL` and `SUPABASE_KEY` (or Twilio SID+token, Upstash URL+token, AWS key pair). The scan emits one `ForagedCredential` per matched key (`id = "dotenv:{label}:{KEY}"`), and `DotenvResolver::resolve` returns exactly one field per import.
- **Root cause**: `scan_env_vars` groups all matched vars per service into a single discovery (`id = "env:{service}"`, EnvResolver re-reads all of them), but `parse_dotenv_content` never got the same grouping — one row and one resolved field per env key. Additionally, `deduplicate` keys on `"{service_type}:{id}"` where the id already encodes the source, so the documented "prefer env vars over dotenv" preference can never fire — the keys never collide.
- **Impact**: Importing "supabase from ~/.env" yields a credential holding only `project_url` (no api_key) or only `api_key` (no URL) — the proxy/healthcheck then fails on the half that's missing. The vault UI also shows N near-duplicate rows for one service and duplicate env+dotenv discoveries the dedup pass was supposed to collapse.
- **Fix sketch**: Group dotenv matches by service_type per source file (mirroring `scan_env_vars`), make `DotenvResolver` return all matched keys for that service from the file, and change the dedup key to `service_type` + a canonical field-set (or at least strip the source from the key so the confidence preference works).

## 4. Netlify CLI probe reports "authenticated, high confidence" on any error output
- **Severity**: Medium
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/auth_detect.rs:387
- **Scenario**: `netlify status` exits non-zero with output like an update notice, a proxy/network error ("TypeError: fetch failed"), or a config warning — anything non-empty that doesn't contain the literal phrase "not logged in".
- **Root cause**: `probe_cli_tools` deliberately parses output even when `status` is non-zero (correct for `gh auth status`), but `parse_netlify_identity`'s fallback branch treats "any output without 'not logged in'" as proof of authentication and the caller stamps every CLI detection `confidence: "high"` / `authenticated: true`. The failure mode (error text) is indistinguishable from the success mode (status text) under this heuristic.
- **Impact**: The AI Setup wizard pre-selects Netlify for batch provisioning for users who have the CLI installed but are logged out or offline — a false trust signal that leads to a failing connector setup downstream, and the 5-minute `auth_detect_cache` keeps serving the wrong answer.
- **Fix sketch**: Delete the permissive fallback: only return `Some` from `parse_netlify_identity` when an `Email:` line or an explicit "logged in" marker is present, and require `status.success()` for the fallback-less parsers (keep the non-zero parse only for gh, which needs it).

## 5. "Already imported" badge keys on service_type alone, hiding genuinely new credentials
- **Severity**: Low
- **Category**: bug
- **File**: src-tauri/src/commands/credentials/foraging.rs:543
- **Scenario**: User already has one GitHub credential in the vault (say a fine-grained PAT for work), then the foraging scan finds a *different* token in `GH_TOKEN` and a third in GitHub CLI's `hosts.yml` for a second account/host.
- **Root cause**: `mark_existing` marks every discovery whose `service_type` appears in the vault's distinct service types — it never compares the actual value (even a masked prefix/suffix), source, or host. The assumption "one credential per service" doesn't hold for exactly the services foraging targets (multiple GitHub hosts, multiple AWS profiles — every `aws:profile:*` row is flagged once any single AWS credential exists).
- **Impact**: The UI shows "already imported" on credentials that were never imported; users reasonably skip them and the second AWS profile / second GitHub account silently never makes it into the vault. It's the inverse failure of a duplicate: a false-negative discovery.
- **Fix sketch**: Mark per-discovery, not per-service: compare a non-reversible fingerprint (e.g. first/last-4 mask or an HMAC of the raw value computed at scan time) against decrypted vault fields of the same service_type, or at minimum scope the check to `service_type + profile/host` and soften the label to "a {service} credential already exists".
