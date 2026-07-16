# tauri:engine [10/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 1 high / 1 medium / 3 low)
> Context group: Backend Engine & Runtime | Files read: 8 | Missing: 0

## 1. Two divergent SSRF-safe client builders (and two resolver structs) — the widely-used one is missing the redirect hardening and silently degrades to an unprotected client
- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/ssrf_safe_dns.rs:57 (vs src-tauri/src/engine/url_safety.rs:238)
- **Scenario**: `ssrf_safe_dns::build_ssrf_safe_client` (used once, `lib.rs:68` LazyLock) carries a redirect policy that re-validates every hop's target IP — its own comment explains that without it, a `Location: http://169.254.169.254/...` redirect skips DNS and reaches cloud-metadata/internal services. The *other* builder, `url_safety::build_ssrf_safe_client`, is the one used at 4+ call sites (`background.rs:412`, `scraper.rs:102`, `kpi_binding.rs:302`, `build_session/reference.rs:160`) and has NO redirect policy, so reqwest auto-follows up to 10 hops with no IP re-check. It also ends in `.unwrap_or_default()`, so if the builder ever fails it silently returns a stock `reqwest::Client` with the system resolver — no SSRF protection at all.
- **Root cause**: The SSRF client-builder logic was implemented twice (`SsrfSafeDnsResolver` in ssrf_safe_dns.rs, `SsrfSafeResolver` in url_safety.rs) and the redirect-policy fix was applied to only one copy. Classic duplication drift.
- **Impact**: The majority of user-influenced outbound HTTP (scraper, KPI polling, build-session reference fetch, background polling) runs on the weaker copy — a real maintenance hazard and a residual redirect-based SSRF gap; the `unwrap_or_default()` fallback is a silent fail-open.
- **Fix sketch**: Keep one resolver + one builder (in `url_safety.rs`, since both already delegate to shared `is_private_ip`), take `timeout` as a param, include the redirect re-validation policy from ssrf_safe_dns.rs, and replace `unwrap_or_default()` with `.expect(...)` (fail closed, as ssrf_safe_dns.rs already does). Delete `ssrf_safe_dns::build_ssrf_safe_client` and one of the two resolver structs; update the 5 call sites. Note: `SsrfSafeDnsResolver` is also instantiated directly in triggers.rs/credential_design.rs/healthcheck.rs/resource_listing.rs/smee_relay.rs, so consolidate the struct name carefully.

## 2. Steady-state N-queries-per-tick in the shared-event local relay
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src-tauri/src/engine/shared_event_local_relay.rs:48
- **Scenario**: Every relay tick runs `list_enabled_subscriptions` (1 query) then a separate `list_firings_after` per subscription — each acquiring a pool connection — even in steady state where firings only ever change on an app upgrade (they are baked/seeded). With one subscription per persona/slug this is N+1 SQLite round-trips per tick, forever, to almost always find nothing.
- **Root cause**: The per-subscription cursor check is expressed as a per-row query instead of one set-based query joining subscriptions to firings.
- **Impact**: Bounded but recurring waste on a periodic background path; grows linearly with subscription count and competes for pool connections with hot paths.
- **Fix sketch**: Replace the loop's read side with one query: `SELECT f.* , s.id AS sub_id FROM shared_event_subscriptions s JOIN shared_event_firings f ON f.slug = s.slug AND f.seq > CAST(s.last_cursor AS INTEGER) WHERE s.enabled = 1 ORDER BY s.id, f.seq LIMIT ...`, then group in Rust. Alternatively (cheaper): cache `MAX(seq)` of the firings table once per tick and skip subscriptions whose cursor already equals it — one query total in steady state. The per-firing `exists_by_source_id` dedup inside the delivery loop can also be batched with `WHERE source_id IN (...)`, though it only runs during catch-up.

## 3. Dead function `emit_process_activity_via` (never adopted after the emitter refactor)
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/process_activity.rs:61
- **Scenario**: The function is `#[allow(dead_code)]` with a comment saying the runner "currently calls emit_process_activity directly"; a repo-wide grep confirms zero callers.
- **Root cause**: Written ahead of a runner refactor that was never completed; the `allow` hides it from the compiler's dead-code lint.
- **Impact**: Speculative API kept alive by an `allow`, misleading readers into thinking two emit paths exist.
- **Fix sketch**: Either finish the runner migration to `ExecutionEventEmitter` (the stated intent) or delete the function and its `allow`. If keeping, add a tracking reference; the `// pending:` comment has no owner.

## 4. Dead `oauth_refresh_lock::try_acquire` duplicating `acquire`'s lock-map lookup
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src-tauri/src/engine/oauth_refresh_lock.rs:45
- **Scenario**: `try_acquire` is `#[allow(dead_code)]` and grep shows no callers (other `try_acquire` hits are unrelated modules: leadership, failover, api_proxy). Its body duplicates `acquire`'s map-entry-or-insert block verbatim.
- **Root cause**: Speculative non-blocking variant added alongside `acquire` but never wired up.
- **Impact**: Minor: dead surface plus a copy of the lookup logic that must be kept in sync if the map strategy changes.
- **Fix sketch**: Delete `try_acquire`. If a non-blocking variant is later needed, extract the shared lookup into a private `fn mutex_for(credential_id: &str) -> Arc<AsyncMutex<()>>` so both variants share it.

## 5. OAuth refresh LOCK_MAP never evicts entries for deleted credentials
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src-tauri/src/engine/oauth_refresh_lock.rs:20
- **Scenario**: The global `credential_id → Arc<AsyncMutex>` map only ever inserts. In a long-lived desktop session where credentials are created, rotated, and deleted, entries for dead credential IDs accumulate for the process lifetime.
- **Root cause**: No eviction path; the map has no hook into credential deletion.
- **Impact**: Slow, bounded-by-usage growth — small per entry, but a textbook process-lifetime leak in an app designed to run for days.
- **Fix sketch**: After acquiring, callers could remove the entry when `Arc::strong_count(&mutex) == 1` under the outer `Mutex` (drop-guard pattern), or simply expose `pub fn forget(credential_id)` called from the credential-delete command. Given low cardinality this is polish, not urgent.
