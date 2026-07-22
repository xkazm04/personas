# tauri:engine [3/10] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 3 medium / 3 low)
> Context group: Backend Engine & Runtime | Files read: 18 | Missing: 0

## 1. `spawn_temp_no_stderr` duplicates `spawn_temp`; `take_stderr` can never return Some, leaving the runner's stderr-collection branch dead
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/cli_process.rs:367
- **Scenario**: Every spawn constructor (`build_and_spawn_core` line 332 and `spawn_temp_no_stderr` line 378) sets `stderr(Stdio::null())`, so the two "variants" are behaviorally identical — yet `spawn_temp_no_stderr` re-implements ~40 lines of the spawn body (temp dir, CREATE_NO_WINDOW, env removals/overrides, `force_subscription_auth`, kill_on_drop). A future fix to the shared spawn path (e.g. a new reserved env var) applied to only one copy silently diverges the other's billing/orphan guarantees.
- **Root cause**: `spawn_temp_no_stderr` was added when `spawn_temp` presumably piped stderr; the base path later switched to `Stdio::null()` (Windows deadlock prevention) and the variant was never folded back in. Consequence: `take_stderr()` (line 465) always returns `None`, so `runner/mod.rs:1908`'s `take_stderr()` + the entire 100KB background stderr collector at runner/mod.rs:1922 is dead code that can never execute.
- **Impact**: Two copies of the security-sensitive spawn contract (the subscription-auth strip is a pinned user directive) plus a dead stderr pipeline in the runner that misleads readers into thinking CLI stderr is captured — it never is.
- **Fix sketch**: Delete `spawn_temp_no_stderr` and repoint its 6 callers (test_runner.rs:1230/1269, genome_critique.rs:171, team_assignment_matching.rs:330/483, eval.rs:627, auto_triage.rs:284) at `spawn_temp`. Either remove `take_stderr` + the runner's dead collector, or (if stderr capture is actually wanted) switch `build_and_spawn_core` to `Stdio::piped()` and keep the collector — one deliberate decision instead of two contradictory ones.

## 2. OAuth refresh computes the token expiry timestamp twice with drifting `Utc::now()`, persisting two different values for the same expiry
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/oauth_refresh.rs:443
- **Scenario**: `refresh_single_credential_inner` derives `expiry_secs_for_field` + `expires_at_rfc3339` (lines 443–447), then immediately re-derives the identical `expiry_secs` + `new_expiry` (lines 451–457) with a second `Utc::now()` call. The first pair lands in the encrypted credential field `oauth_token_expires_at`; the second lands in the metadata patch under the same key name `oauth_token_expires_at`.
- **Root cause**: Copy-paste during the atomic-persist refactor — the "compute values before opening the transaction" block was added without deleting the older computation feeding the ledger patch.
- **Impact**: The credential field and the metadata ledger record slightly different expiry instants for the same refresh (ms drift today, but any future edit to one computation and not the other diverges the two consumers — `extract_expires_at` reads metadata, the strategy resolve path reads the field). Pure noise for anyone auditing token lifetimes.
- **Fix sketch**: Compute once: `let expiry_secs = resolved.expires_in_secs.unwrap_or(DEFAULT_FALLBACK_LIFETIME_SECS) as i64; let expires_at = (Utc::now() + Duration::seconds(expiry_secs)).to_rfc3339();` and use `expiry_secs`/`expires_at` for the field upsert, the metadata patch, the metric insert, and the audit detail. Delete the duplicate pair.

## 3. Fourth-and-fifth reimplementation of char-safe truncation instead of the canonical `utils::text` helper
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/engine/auto_triage.rs:558
- **Scenario**: `auto_triage::truncate` (chars().take(max) + "...[truncated]") and `memory_reflection::clamp_chars` (line 84, chars().take(max) + "…[truncated]") are the same function with different markers, while the codebase already ships `crate::utils::text::truncate_on_char_boundary` — which auto_triage itself uses eleven lines away (line 206) for another string.
- **Root cause**: Each engine module grew its own clamp when it needed a marker suffix; nobody widened the shared helper to take a marker.
- **Impact**: Five truncation idioms across this one context (the two above plus `discord_poller::truncate_for_discord` and `team_preset_loader::truncate_description`, which have genuinely distinct semantics — Discord cap and word-boundary — and can stay). Divergent markers ("..." vs "…") leak into stored notes/prompts, and the next contributor has to guess which clamp is current.
- **Fix sketch**: Add `truncate_chars_with_marker(s, max, marker)` to `utils::text` (or give `truncate_on_char_boundary` a marker-appending sibling), and replace `auto_triage::truncate` and `memory_reflection::clamp_chars` with it. Leave the Discord and word-boundary variants alone.

## 4. Discord poller builds a fresh `reqwest::Client` for every HTTP request on a 5-second loop
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: connection-reuse
- **File**: src-tauri/src/engine/discord_poller.rs:372
- **Scenario**: `fetch_new_messages` (line 372) and `post_reply` (line 469) each call `reqwest::Client::builder().build()` per invocation. The poller runs every 5s per (persona, channel) forever, plus up to 25 replies per tick — so with inbound Discord enabled, a new client is constructed (TLS root-store load, connection-pool alloc) and a fresh TCP+TLS handshake to discord.com is performed for every single request, indefinitely.
- **Root cause**: Client construction was inlined into each helper instead of being shared; reqwest's connection pooling only works when the `Client` is reused.
- **Impact**: Constant background CPU (root-cert parsing per build) and added per-request latency (full handshake instead of keep-alive) on a hot loop; scales linearly with channels. Bounded for a desktop app, but it is the steady-state cost of the feature.
- **Fix sketch**: `static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| reqwest::Client::builder().timeout(HTTP_TIMEOUT).build().expect("client"));` at module scope and use it in both helpers (pattern already used elsewhere in the app for shared clients). One client, pooled keep-alive connections, zero per-tick construction.

## 5. Discord poller decrypts the bot-token credential on every 5-second tick even when no messages arrive
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: hot-loop-io
- **File**: src-tauri/src/engine/discord_poller.rs:173
- **Scenario**: `poll_channel` calls `load_bot_token` → `credential_repo::get_by_id` + `get_decrypted_fields` (DB reads + AES unseal) unconditionally before each fetch, i.e. every 5s per channel, 17k+ times/day per channel, almost always to fetch an empty message list. `process_pending_replies` repeats the same decrypt per pending row.
- **Root cause**: No short-TTL cache for the decrypted token; each tick treats the credential as cold.
- **Impact**: Steady-state DB + crypto work on the tick path that dwarfs the actual (usually empty) poll result. Bounded, but pure overhead.
- **Fix sketch**: Cache `(credential_id → token)` in a `Mutex<HashMap<..,(String, Instant)>>` with a ~60s TTL, mirroring `oauth_refresh::get_connector_metadata_cached` in this same context (same staleness rationale: a rotated token is picked up within the TTL). Invalidate on a 401 response so re-auth takes effect immediately.

## 6. Webhook handler clones the request body an extra time before logging
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: allocation
- **File**: src-tauri/src/engine/webhook.rs:244
- **Scenario**: `handle_webhook` does `String::from_utf8_lossy(&body).to_string()` and then `Some(body_str.clone())` — two full copies of a body that can be up to the 1MB `DefaultBodyLimit`, on every webhook delivery (including hostile/rate-limited ones, since logging happens regardless of outcome). `body_str` is not used after building `body_for_log`.
- **Root cause**: `body_for_log` was built from a clone instead of moving the already-owned string.
- **Impact**: Up to ~2MB of transient allocation per webhook where ~1MB suffices; trivial for small payloads but on the unauthenticated ingress path where bursts land.
- **Fix sketch**: Move instead of clone: `let body_for_log = { let s = String::from_utf8_lossy(&body); if s.is_empty() { None } else { Some(s.into_owned()) } };` and drop the separate `body_str`. (`process_webhook` already takes `&body`, so nothing else needs the string.)
