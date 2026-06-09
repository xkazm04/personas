# Bug Hunter — credential-recipes-oauth-rotation
> Total: 5
> Severity: 0 critical, 2 high, 3 medium

## 1. Gateway `refresh_oauth_token` returns `refresh_token: null` on no-rotation, inviting credential bricking
- **Severity**: high
- **Category**: state-corruption
- **File**: src-tauri/src/commands/credentials/oauth.rs:1698-1704 (with consumer-shape risk in src/api/vault/oauthGatewayApi.ts:59-74)
- **Scenario**: Many providers (Google with `access_type=offline` after the first grant, GitHub, Slack, most non-rotating providers) return a refresh response **without** a `refresh_token` field — the caller is expected to keep reusing the old one (RFC 6749 §6). `refresh_oauth_token` builds its result as `"refresh_token": value.get("refresh_token").and_then(|v| v.as_str())`, which serializes to `null`. The command hands this `OAuthRefreshResult { refresh_token: null, ... }` straight to the frontend with no preserve-old semantics. Any consumer that persists `data.refresh_token` directly (the pattern already used in `useCredentialOAuth.ts:47` for the start flow, vs. the safe `poll.refresh_token ?? prev.refresh_token` used in `useGoogleOAuth.ts:39`) overwrites the live refresh_token with empty — the credential can no longer refresh and is permanently bricked, requiring full re-auth.
- **Root cause**: The command leaks the provider's "field absent" into a `null` that is indistinguishable, on the wire, from "the refresh token was cleared." Unlike the engine path (`oauth_refresh.rs:526` only writes `refresh_token` when `resolved.refresh_token.is_some()`), the gateway command pushes the null-vs-keep decision onto every individual frontend caller.
- **Impact**: data loss / credential lockout (permanent, silent).
- **Fix sketch**: Make the impossible-to-misuse shape: omit `refresh_token` from the response entirely when the provider returned none (so the frontend literally cannot persist an empty value), or have the command itself persist the rotated token atomically (like `refresh_single_credential_inner`) and return only a status. Never surface a bare `null` refresh_token to callers.

## 2. Decrypted OAuth refresh/access tokens crossing IPC and rendered into the DOM
- **Severity**: high
- **Category**: secret-leak
- **File**: src-tauri/src/commands/credentials/oauth.rs:1326-1338 (`get_session_status`) and src/features/agents/sub_deployment/components/cloud/CloudOAuthPanel.tsx:170
- **Scenario**: `get_session_status` decrypts the at-rest `EncryptedToken`s and serializes the plaintext `access_token` and `refresh_token` into the JSON returned by `get_oauth_status` / `get_google_credential_oauth_status`. The session map carefully zeroizes and encrypts at rest, but the IPC boundary returns them in clear. `CloudOAuthPanel.tsx:170` then renders `{dt.refresh_token}` directly into the DOM. A long-lived refresh token (the most powerful secret in the system — it mints access tokens indefinitely) is exposed to React devtools, screenshots, screen-share, accessibility trees, and any XSS in the renderer.
- **Root cause**: The token hand-off design treats "needed by the frontend to persist" as license to render it; the secret has no display masking and no "fetch once, never echo" contract.
- **Impact**: security (refresh-token theft → full account takeover of the connected provider).
- **Fix sketch**: Never render refresh tokens; mask in UI. Better, eliminate the round-trip entirely — persist the token server-side keyed by session_id and have the frontend reference it by id, so plaintext secrets never cross IPC or reach the DOM.

## 3. User `extra_params` appended after security-critical params can override `state` / `redirect_uri` / PKCE
- **Severity**: medium
- **Category**: state-corruption
- **File**: src-tauri/src/commands/credentials/oauth.rs:1505-1533
- **Scenario**: The authorize URL is built by appending, in order, `client_id`, `redirect_uri`, `response_type`, `state`, `scope`, the PKCE `code_challenge`, provider `extra_auth_params`, and finally the caller-supplied `extra_params` (lines 1528-1532) with no key filtering. Providers differ on duplicate-query-param handling: those that take the **last** occurrence let a caller silently override `redirect_uri` (token exfiltration to an attacker endpoint), `state` (defeating the CSRF echo check, since the session still expects the server-minted state but the browser now carries the attacker's), or `code_challenge` (downgrading PKCE).
- **Root cause**: No allowlist/denylist on `extra_params`; security parameters and untrusted free-form params share one flat namespace with append-order as the only (provider-dependent) tiebreak.
- **Impact**: security (CSRF / redirect hijack / PKCE downgrade) when the caller is influenced or buggy.
- **Fix sketch**: Reject or strip reserved keys (`state`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `client_id`, `response_type`, `client_secret`) from `extra_params` before appending; make injecting them an explicit validation error.

## 4. OAuth callback read loop treats a socket read *error* as clean EOF, then parses a truncated request
- **Severity**: medium
- **Category**: silent-failure
- **File**: src-tauri/src/commands/credentials/oauth.rs:167-184
- **Scenario**: The header-accumulation loop does `let n = socket.read(&mut buffer[total_read..]).await.unwrap_or(0); if n == 0 { break; }`. A transient read error (RST, partial TLS-less HTTP from a confused browser, connection reset mid-request) is collapsed to `0` and treated identically to a graceful close, so the loop breaks **before** `\r\n\r\n` is seen. The code then parses whatever partial bytes arrived: the `state`/`code` query params may be absent, producing a spurious "No authorization code returned" or a false CSRF rejection on a callback that actually succeeded at the provider. The user sees "Authorization failed" and retries, but the provider has already consumed the one-time code.
- **Root cause**: `unwrap_or(0)` conflates "error" with "EOF," and the loop has no "headers never completed" terminal state distinct from a normal close.
- **Impact**: UX degradation / flaky OAuth completion (intermittent, hard to reproduce).
- **Fix sketch**: Match on `read()` explicitly — on `Err`, return `OAuthCallbackOutcome::Error("callback read failed")`; on `Ok(0)` before the terminator was found, return a distinct "incomplete request" error rather than parsing the partial buffer.

## 5. Anomaly scorer silently drops entries with unparseable timestamps, skewing remediation and suppressing rotation
- **Severity**: medium
- **Category**: edge-case
- **File**: src-tauri/src/engine/rotation.rs:267-335
- **Scenario**: `compute_anomaly_score` counts a failure toward `total_failures` unconditionally (line 268-270), but every windowed counter (`count_5m/1h/24h`, perm/transient) is only incremented inside `if let Some(t) = ts` (line 276). An entry whose `timestamp` fails `parse_from_rfc3339` (clock-skew artifact, a future migration changing the format, a corrupted-but-still-deserializable row) contributes to neither `count_1h` nor any failure window. If all recent failures have bad timestamps, `count_1h == 0` forces `Remediation::Healthy` (line 338) — a credential that is actually 100% failing is scored healthy and never rotated. Separately, when `latest_ts` stays `None`, `data_stale` defaults to `true` (line 333-335), and `detect_anomalies` skips stale windows (line 891), so even a correctly-scored anomaly is suppressed.
- **Root cause**: Timestamp-parse failure is handled as "ignore this sample" instead of "treat as recent/now" or "flag corruption," so bad-timestamp failures become invisible to the windowed scorer that drives all remediation.
- **Impact**: silent failure of the rotation safety net — revoked/failing credentials never trigger preemptive rotation or disable.
- **Fix sketch**: When `timestamp` is unparseable, either treat the entry as `now` (counting it into all windows conservatively) or surface a corruption signal like the `HealthcheckParseResult::Corrupted` path already does for the whole buffer; never let an unparseable timestamp silently zero out the window denominators.
