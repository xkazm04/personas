# Test Mastery — OAuth, API Proxy & Foraging
> Total: 8 findings (3 critical, 3 high, 2 medium, 0 low)

## 1. API-proxy base-URL resolution + header allow/block list is wholly untested
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/api_proxy.rs:536-672, 559-595, 813-833
- **Current test state**: none
- **Scenario**: `execute_api_request` decides where an *authenticated* outbound request goes and which headers the user may inject. The pure, side-effect-free pieces that drive this — `dynamic_base_url` (telegram `bot{token}`, azure_devops `/{org}`), the `base_url`/`project_url`/`url`/`host`/`domain` precedence ladder, the `https://` prefixing of bare hosts, and `validate_header_name` + the `BLOCKED_HEADERS` filter (authorization/cookie/host/proxy-authorization) — have zero tests. A regression that (a) lets `host`/`domain` win over `base_url`, (b) drops the `https://` default so a bare host becomes a relative URL, (c) lets a user override `Authorization` via `custom_headers`, or (d) accepts a header name containing CRLF (`X-Foo\r\nAuthorization: ...`) would ship silently. (c)/(d) are credential-leak / request-smuggling vectors.
- **Root cause**: All this logic is private and only exercised through the full async `execute_api_request`, which needs a DB pool + live HTTP, so nobody wrote unit tests for the extractable helpers.
- **Impact**: An agent's credential gets sent to the wrong host, or a caller smuggles its own `Authorization`/`Cookie` header onto an authenticated proxy call — silent credential exfiltration or auth confusion.
- **Fix sketch**: Make `well_known_base_url`, `dynamic_base_url`, `validate_header_name`, and the BLOCKED_HEADERS check unit-testable (already `fn`s in the module — add a `#[cfg(test)] mod tests`). Assert invariants: header name with `\r`/`\n`/`:`/null/space is rejected; every BLOCKED_HEADERS entry is filtered case-insensitively; `dynamic_base_url("telegram", {bot_token:"X"})` == `https://api.telegram.org/botX`; a bare `host:"foo.com"` resolves to `https://foo.com` and `base_url` outranks `host`. Several of these (header-name, base-URL) are llm-generatable table tests.

## 2. Token-bucket rate limiter has no test — the throttle that bounds API spend
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/api_proxy.rs:177-306
- **Current test state**: none
- **Scenario**: `TokenBucket::try_acquire`, `parse_rate_limit_from_metadata`, and `check_rate_limit` are the only thing stopping a compromised/looping automation from hammering a paid third-party API (and the user's bill / their API quota). Today nothing asserts that: a fresh bucket allows exactly `max_tokens` then returns `Err(retry_after)`; tokens refill at `max/60` per second; `parse_rate_limit_from_metadata` clamps to `1..=10_000` and falls back to 60 on absent/garbage JSON; a mid-flight limit change re-caps `max_tokens` without resetting current tokens; LRU eviction fires at `MAX_BUCKET_ENTRIES`. A refill-math or clamp regression (e.g. `clamp(1,10_000)` → no clamp, letting `rate_limit_rpm: 0` divide-by-zero or `u64::MAX` disable the limiter) would silently remove the guardrail.
- **Root cause**: `try_acquire` uses `Instant::now()` directly, so it isn't deterministically testable as written; the registry behaviour is behind an async global `LazyLock<Mutex<…>>`.
- **Impact**: Runaway/abusive API consumption goes unthrottled — direct cost blowup and third-party rate-limit bans, the exact business risk the module docstring claims to prevent.
- **Fix sketch**: `parse_rate_limit_from_metadata` is a pure function — add llm-generatable table tests now (invariant: result always in `1..=10_000`, default 60 on None/invalid). For `TokenBucket`, add a seam (e.g. `try_acquire_at(now: Instant)` / inject a clock) and assert: N successive acquires on a bucket of N succeed, the (N+1)th fails with a positive `retry_after`, and after `refill_rate` seconds one token returns. Don't snapshot timings — assert the count/clamp invariants.

## 3. OAuth refresh staleness/backoff decision logic untested — silent daily-401 regressions
- **Severity**: critical
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/oauth_refresh.rs:34-99, 148-258, 315-344
- **Current test state**: none
- **Scenario**: The "should I refresh this credential now?" decision is pure arithmetic over `expires_at`, `REFRESH_THRESHOLD_SECS` (900), the startup threshold (300), and `STALENESS_CEILING_SECS` (7 days), plus `extract_expires_at` RFC3339 parsing and the post-lock freshness short-circuit (`remaining > THRESHOLD → skip`). The module's own comments describe two prior production bugs here (un-seeded freshly-connected creds skipped for 24h → daily 401s; a credential expired beyond the ceiling silently never refreshed). None of this branch logic is tested. A sign-flip or off-by-one on the staleness window, or `extract_expires_at` silently returning `None` on a valid timestamp variant, brings the daily-401 bug straight back with no test to catch it.
- **Root cause**: Decision logic is inlined inside async functions that require a `DbPool` + live OAuth provider, so the testable predicate ("needs_refresh given expires_at and now") was never extracted.
- **Impact**: Every OAuth connector (Google, etc.) silently stops working ~1h after launch; users hit 401s on automations with no signal until support tickets arrive.
- **Fix sketch**: Extract a pure `fn needs_refresh(expires_at: Option<DateTime>, now, threshold, ceiling) -> bool` and unit-test the boundaries: expiring in 901s (skip) vs 899s (refresh); already expired 6 days (refresh) vs 8 days (skip → needs reauth); `None` expiry handled per OAuth-vs-non-OAuth path. Separately test `extract_expires_at` against valid RFC3339 (with/without offset, Z) and malformed strings (invariant: round-trips a value produced by `to_rfc3339()`). All llm-generatable once the predicate is extracted.

## 4. Per-credential OAuth refresh lock — concurrency invariant never asserted
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/oauth_refresh_lock.rs:32-53
- **Current test state**: none
- **Scenario**: This mutex is the sole defense against the documented refresh-token-rotation race (two paths exchange the same refresh_token; the second invalidates the first's result → credential permanently bricked). Nothing asserts the core invariant: while `acquire(id)` is held, a second `acquire(id)` for the *same* id blocks, but `acquire(other)` proceeds; and `try_acquire(id)` returns `None` when held. A refactor that, say, keyed the lock map by `service_type` instead of `credential_id`, or accidentally cloned a fresh mutex per call, would compile and pass CI while reopening the brick-the-credential race.
- **Root cause**: It's a global `OnceLock<Mutex<HashMap<…>>>` with async guards — easy to test with `tokio::test` but never was.
- **Impact**: Concurrent refresh (startup sweep vs periodic tick vs 401-retry) double-spends the rotating refresh_token and permanently disables the credential; only re-auth recovers.
- **Fix sketch**: `#[tokio::test]`: spawn task A holding `acquire("c1")`, assert `try_acquire("c1")` is `None` and `try_acquire("c2")` is `Some`; drop A's guard and assert a pending `acquire("c1")` now resolves. Invariant: same-id mutual exclusion, different-id independence.

## 5. Foraging parsers / masking / dedup / path-safety are pure and entirely untested
- **Severity**: high
- **Category**: llm-generatable
- **File**: src-tauri/src/commands/credentials/foraging.rs:143-152, 210-585, 716-721, 806-854
- **Current test state**: none
- **Scenario**: A pile of pure, security-relevant functions with no tests: `mask_value` (must never reveal a short secret in full — today `<=12` chars returns only asterisks, `>12` shows 4+4), the AWS-credentials INI parser, the `.env`/npmrc/kube/gh-CLI parsers, `deduplicate` (keep-higher-confidence), `mark_existing`, and the import-path guards `is_safe_path_component` + `ALLOWED_DOTENV_SOURCES`. The import path (`resolve_real_values` → resolvers) reads *raw* secrets off disk by reconstructing paths from a user-influenced `foraged_id`; `is_safe_path_component` rejecting `..`/`/`/`\`/null is the traversal guard. A regression that lets `mask_value` echo a 13-char token's middle, or lets `is_safe_path_component("..")` pass, is a direct secret-exposure / arbitrary-file-read bug.
- **Root cause**: All logic lives in `#[tauri::command]`-adjacent free functions in a module with no `mod tests`; the filesystem-scanning framing discouraged unit testing the string logic.
- **Impact**: Plaintext secret leaked to the UI via a bad mask, or an attacker-crafted `foraged_id` reading an arbitrary file as a "credential".
- **Fix sketch**: llm-generatable batch asserting invariants (not snapshots): `mask_value` never contains a contiguous substring of length > 8 of the input and never returns the full secret for any length; `is_safe_path_component` rejects `..`, `/`, `\`, `\0` and accepts plain names; `deduplicate` keeps the highest-confidence entry per key; AWS/dotenv parsers extract expected `(service_type, field_key)` from sample fixtures and ignore comments/blank lines. Parser tests can use string literals — no real files needed.

## 6. CLI auth-detection output parsers untested (the high-confidence identity claims)
- **Severity**: high
- **Category**: coverage-gap
- **File**: src-tauri/src/commands/credentials/auth_detect.rs:330-391
- **Current test state**: exists-but-weak (only Windows verbatim-path tests + one `#[ignore]` machine-local probe; zero parser tests)
- **Scenario**: `parse_gh_identity`, `parse_aws_identity`, `parse_simple_identity`, `parse_docker_identity`, `parse_netlify_identity` turn raw CLI stdout/stderr into a "you are authenticated as X" claim with `confidence: high`, which the AI Setup wizard uses to pre-select connectors for batch provisioning. These are pure `fn(&str) -> Option<String>` with no tests. `parse_netlify_identity`'s fallback ("any non-empty output that doesn't say 'not logged in' ⇒ authenticated") is exactly the kind of loose heuristic that yields false positives; `parse_aws_identity` must reject output not starting with `arn:`. A regression here makes the wizard claim auth that doesn't exist (or miss real auth).
- **Root cause**: The module has a `mod tests`, but it only covers the Windows path-prefix fix; the parsers were never added.
- **Impact**: Onboarding wizard pre-selects/skips connectors based on a wrong authentication picture — user provisions the wrong creds or is told they're not logged in when they are.
- **Fix sketch**: Add table tests to the existing `mod tests` (llm-generatable). Feed real-shaped fixtures: `gh auth status` ("Logged in to github.com account octocat") → `gh:octocat`; an AWS `arn:aws:iam::…` line → that arn, a non-arn error → `None`; netlify "Email: a@b.com" → that, "Not logged in" → `None` (assert the loose fallback does NOT fire on an error string). Invariant: a non-authenticated / error output never yields `Some(identity)`.

## 7. Google/Microsoft OAuth env-credential resolution precedence untested
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/google_oauth.rs:5-151
- **Current test state**: none
- **Scenario**: `dotenv_var_first_nonempty`, `env_var_first_nonempty`, `resolve_env_value` (compile-time → runtime env → .env precedence), and the Desktop→Web client fallback decide which OAuth client credentials are used for the whole Google reconnect + refresh flow. `dotenv_var_first_nonempty` does its own `.env` parsing (strips quotes, ignores `#`/blank) duplicating logic elsewhere. A regression in precedence (e.g. `.env` winning over a runtime env override) or in quote-stripping would point OAuth at the wrong client and produce confusing `redirect_uri_mismatch`/`invalid_client` failures with no test signal.
- **Root cause**: Reads process env, so perceived as untestable — but `dotenv_var_first_nonempty` operates on file content and `resolve_env_value` is parametric; both are straightforwardly testable (the latter with `std::env::set_var` in a serial test, or by refactoring the parse step out).
- **Impact**: OAuth connector setup/refresh silently breaks app-wide when env wiring changes; hard to diagnose in the field.
- **Fix sketch**: Extract the `.env` line-parsing into a pure `fn parse_dotenv(content: &str) -> HashMap<String,String>` and unit-test quote-stripping, comment/blank skipping, and `=` in values. For precedence, test `resolve_env_value(Some("ct"), …)` returns the compile-time value and that an empty compile-time string falls through. Assert the invariant, not specific machine env.

## 8. Residual SSRF gap: `is_url_target_private` trusts redirect Location domains without DNS
- **Severity**: medium
- **Category**: coverage-gap
- **File**: src-tauri/src/engine/url_safety.rs:172-179 (and ssrf_safe_dns.rs:57-79 redirect policy)
- **Current test state**: exists-but-weak (literal-IP and known-internal-hostname redirect cases are tested; the DNS-resolving-domain redirect case is not, and is in fact not handled)
- **Scenario**: The redirect policy in both SSRF clients calls the *synchronous, no-DNS* `is_url_target_private`. For a redirect `Location` whose host is an arbitrary **domain** (not a literal IP, not `.internal`/`.local`), `is_url_target_private` returns `false` even if that domain resolves to `169.254.169.254` / `10.x` — the DNS-rebinding-via-redirect case. The DNS resolver attached to the client *does* re-validate domain redirects at connect time, so this is defense-in-depth rather than a hole, but the asymmetry (IP-literal redirects blocked synchronously, domain redirects relying solely on the resolver) is undocumented in tests and a future change to the redirect policy could turn it into a real bypass. There is no test asserting that a domain-redirect to a private-resolving host is ultimately blocked end-to-end.
- **Root cause**: `is_url_target_private` is deliberately DNS-free for use in a sync redirect callback; the limitation is commented but not pinned by a test, so the "the resolver covers this" assumption is unverified.
- **Impact**: If the resolver coverage ever regresses (or a new outbound client uses `is_url_target_private` alone), authenticated requests could follow a redirect to cloud-metadata/internal services.
- **Fix sketch**: Add a test documenting the contract: `is_url_target_private` returns `false` for a public-looking domain (pinning that it is NOT a standalone SSRF guard for domains), plus a regression test asserting the resolver path rejects a hostname resolving to a private IP (the existing `test_resolver_blocks_loopback` is the template — extend with a comment tying the two layers together). Lower priority than 1–6 because the resolver currently backstops it; the value is preventing a silent future regression.
