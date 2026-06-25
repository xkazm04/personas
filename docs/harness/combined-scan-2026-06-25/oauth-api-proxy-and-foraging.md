# OAuth, API Proxy & Foraging — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: oauth-api-proxy-and-foraging | Group: Credential Vault & Connectors
> Total: 5 | Critical: 1 | High: 1 | Medium: 3 | Low: 0

## 1. API-proxy SSRF DNS filter misses CGNAT (Tailscale 100.64.0.0/10) and IPv4-mapped-IPv6 private addresses
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: SSRF / allowlist bypass
- **File**: src-tauri/src/engine/ssrf_safe_dns.rs:13,33 (filters with `super::healthcheck::is_private_ip`); root weakness at src-tauri/src/engine/healthcheck.rs:1279-1304
- **Scenario**: `execute_api_request` sends every proxied call through `crate::SSRF_SAFE_HTTP` = `ssrf_safe_dns::build_ssrf_safe_client()`. That client's connect-time resolver rejects a resolved IP only if `healthcheck::is_private_ip` is true. That function checks loopback/RFC1918/link-local/unspecified/broadcast only — it does **not** cover `100.64.0.0/10` (CGNAT, which is exactly the range Tailscale assigns to tailnet nodes) nor IPv4-mapped IPv6 (`::ffff:10.0.0.1`, `::ffff:127.0.0.1`). A hostname with an A record of `100.64.x.x` (attacker-controlled DNS, a malicious/compromised upstream issuing `Location: http://host-resolving-to-100.64.x.x/`, or a hostile credential/template `base_url`) is resolved, passes the filter, and reqwest connects to the internal/tailnet host. The redirect policy's IP-literal check (`url_safety::is_url_target_private`) *does* block these, but a redirect to a **hostname** is re-resolved through the same weak filter, so the redirect vector is also open.
- **Root cause**: Three divergent private-IP predicates exist. `url_safety::is_private_ip` (url_safety.rs:15-36) correctly blocks CGNAT (`is_v4_shared`) and v4-mapped-v6 (`to_ipv4_mapped`) and is even unit-tested (`test_blocks_shared_cgn`, `test_blocks_v4_mapped_v6`). The live proxy client instead wires in the weaker `healthcheck::is_private_ip`, so the project's own stated denylist is not enforced on the highest-risk path.
- **Impact**: SSRF into CGNAT/Tailnet/internal services using the credential's authenticated request — the exact class this module exists to prevent. Reaches hosts that the standalone validator already classifies as private.
- **Fix sketch**: Make `ssrf_safe_dns`'s resolver (and `healthcheck::is_private_ip`) delegate to the single strongest predicate (`url_safety::is_private_ip`), adding the `100.64.0.0/10` and `to_ipv4_mapped` cases; collapse the three copies into one shared function so they cannot drift again.
- **Value**: impact=8 effort=1

## 2. Telegram `bot_token` (and other path-embedded secrets) leak via reqwest error strings
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: secret leakage
- **File**: src-tauri/src/engine/api_proxy.rs:538-541 (token baked into URL), 839 & 869 (`format!("API request failed: {e}")` / retry)
- **Scenario**: `dynamic_base_url` builds `https://api.telegram.org/bot{token}` — the full bot credential lives in the URL path. When the request errors (connect failure, timeout, TLS, DNS, the retry path), the handler returns `AppError::Internal(format!("API request failed: {e}"))`. `reqwest::Error`'s `Display` includes the request URL (it redacts a userinfo password but **not** the path), so the bot token is embedded in the error returned to the caller and into any log/Sentry capture of that `AppError`. The same applies to any future connector that embeds a secret in the path.
- **Root cause**: Secret-in-URL connectors combined with verbatim interpolation of a reqwest error that carries the URL. No redaction of `full_url` before it enters an error/log string.
- **Impact**: A live Telegram bot token can be exfiltrated through an error message / log line, defeating the at-rest encryption of that credential.
- **Fix sketch**: Strip the URL from proxy errors (use `e.without_url()` before formatting, or map to a fixed "upstream request failed" message), and/or move path-embedded secrets out of the logged surface; scrub `api.telegram.org/bot<...>` in the logging layer.
- **Value**: impact=7 effort=2

## 3. `detect_authenticated_services` performs sensitive local probing behind a no-op auth gate
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: authorization / privilege inconsistency
- **File**: src-tauri/src/commands/credentials/auth_detect.rs:765-769 (`require_auth(&state)`); `require_auth` body at src-tauri/src/ipc_auth.rs:414-416 (`Ok(())`)
- **Scenario**: This command copies the user's Chrome/Edge cookie databases to temp and spawns up to nine CLI subprocesses, yet it is gated only by `require_auth`, which is literally `async fn require_auth(_state) -> Result<(),_> { Ok(()) }`. Its credential-handling siblings in the same module (`execute_api_request`, foraging) use `#[requires(privileged)]` / `require_privileged_sync`, which enforce the IPC-validated flag. The intended elevation is silently absent here.
- **Root cause**: A privileged-by-nature operation was tagged with the weaker (and currently no-op) auth helper rather than the `privileged` macro; the asymmetry is undocumented, so it reads as intentional.
- **Impact**: Local cookie-DB reads and subprocess spawning are reachable without the elevated check applied to other credential operations; relies entirely on whatever global invoke wrapper exists, not on a per-command privilege assertion.
- **Fix sketch**: Apply `#[requires(privileged)]` to `detect_authenticated_services` (and audit other `require_auth`-only commands), or document why this probe is deliberately lower-privilege.
- **Value**: impact=5 effort=2

## 4. CLI auth probes report `authenticated: true` (confidence "high") from error text
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: heuristic correctness / false positive
- **File**: src-tauri/src/commands/credentials/auth_detect.rs:330-345 (`parse_gh_identity`), 356-363 (`parse_simple_identity`), 460-465 (parses output on success **and** failure), 476-483
- **Scenario**: After running a probe, the result of `parse()` is taken regardless of exit status. `parse_simple_identity` returns `Some(output)` for *any* non-empty text, so a logged-out `vercel whoami` / `az account show` that prints an error to stderr yields `authenticated: true, confidence: "high", identity: <error text>`. Worse, `parse_gh_identity` matches `lower.contains("logged in")`, and gh's logged-OUT message "You are not logged **into** any GitHub hosts" contains the substring "logged in" → reported as authenticated. The error text also becomes the user-visible `identity`.
- **Root cause**: Substring heuristics with no exit-code gating and no negative-match guard ("not logged in"); combined stdout+stderr fed to parsers that treat presence-of-output as success.
- **Impact**: The AI setup wizard pre-selects connectors the user is not authenticated to, and surfaces raw CLI error strings as identities — eroding trust and potentially provisioning the wrong credentials.
- **Fix sketch**: Only treat `status.success()` output as authenticated for the simple/identity parsers; add explicit negative checks ("not logged in"/"not logged into"/"error"); for `gh`, require the `account ` token rather than a loose "logged in" substring.
- **Value**: impact=4 effort=2

## 5. 7-day staleness ceiling silently abandons recoverable OAuth credentials
- **Severity**: Medium
- **Lens**: ambiguity-guardian
- **Category**: undocumented assumption / edge case
- **File**: src-tauri/src/engine/oauth_refresh.rs:46-49 (`STALENESS_CEILING_SECS`), 92-93 (startup sweep), 174-175 (proactive tick)
- **Scenario**: Both the startup sweep and the periodic tick skip a credential whose access token expired more than `STALENESS_CEILING_SECS` (7 days) ago (`remaining >= -STALENESS_CEILING_SECS`). The implicit assumption is "expired > 7 days ⇒ refresh token is dead, needs re-auth." That is false for Google (refresh tokens for published apps do not expire) and many providers. After the app is closed for over a week, such credentials are never proactively refreshed and never marked `needs_reauth` either — they sit in limbo until a request happens to 401 and triggers the on-demand force-refresh.
- **Root cause**: A single magic constant conflates "access token long expired" with "grant unrecoverable," with no comment justifying 7 days and no provider-specific awareness.
- **Impact**: Connectors appear broken (no pre-warmed token, no re-auth prompt) after extended downtime; the first agent run after a long gap eats an avoidable 401 round-trip, and headless flows that never hit the proxy stay silently stale.
- **Fix sketch**: Don't drop refresh-eligible credentials at the ceiling — attempt the refresh and let an `invalid_grant` response drive the `needs_reauth`/backoff path that already exists; document the constant's intent and make it per-provider if a ceiling is truly needed.
- **Value**: impact=4 effort=3
