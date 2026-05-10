# Bug Hunt — Webhooks, Smee Relay & Dead Letter

> Group: Triggers & Events
> Files scanned: 8 (file paths from brief differed; resolved to actual files: CloudWebhooksTab.tsx, SmeeRelayTab.tsx, DeadLetterTab.tsx, LiveStreamTab.tsx, TestTab.tsx, RateLimitDashboard.tsx, events.rs, shared_events.rs — plus supporting smee_relay.rs / events.rs repo / rate_limiter.rs / smee_relays.rs repo for cross-cut analysis)
> Total: 3C / 6H / 4M / 2L = 15 findings

---

## 1. Smee relay performs zero authenticity check on inbound payloads

- **Severity**: critical
- **Category**: signature-bypass
- **File**: `src-tauri/src/engine/smee_relay.rs:301-355`
- **Scenario**: Anyone who learns the user's smee.io channel URL (it is in plaintext in the DB, copied/pasted into UI, copyable from `relay.channelUrl` and shown in toasts) can `POST` arbitrary JSON to `https://smee.io/<id>` and have it parsed, decorated as `event_type = github_<x-github-event>`, and `event_repo::publish`-ed into the local persona event bus as a fully-trusted event with `source_type = "smee_relay"`. There is no GitHub webhook HMAC (`X-Hub-Signature-256`) verification, no shared-secret comparison, and no origin checking. Attacker can fire `event_type = "github_push"` events into a persona that auto-runs builds, exfiltrating secrets via that persona's tool calls.
- **Root cause**: The relay treats smee.io as a trusted transport. Smee.io is a public broadcast bus — channel IDs are guessable/leakable and the service explicitly does not authenticate POSTers.
- **Impact**: Privilege escalation to whatever the listener persona can do (run shell, call APIs, send messages). Single highest-risk finding in this surface.
- **Fix sketch**: Require the user to attach a `webhook_secret` to each relay row, read `x-hub-signature-256` from the smee envelope, and reject events whose HMAC over the raw body does not match. Drop unsigned events when a secret is configured. Optionally: only accept events whose envelope `host` matches the configured GitHub repo.

## 2. DLQ manual retry bypasses event-source rate limiter

- **Severity**: critical
- **Category**: rate-limit-bypass
- **File**: `src-tauri/src/commands/communication/events.rs:200-209` (`retry_dead_letter_event`)
- **Scenario**: `publish_event` and `test_event_flow` go through `state.rate_limiter.check("event:<source_type>", …)`. `retry_dead_letter_event` calls `repo::retry_dead_letter` directly with no rate-limit check. A user (or a buggy script) can mass-click "Retry" on 100 DLQ items and instantly inject 100 `pending` events into the dispatcher in <1s, blowing past `event_source_max` per minute and starving genuine traffic.
- **Root cause**: Manual retries were treated as "user actions" rather than as event publishes, but they hit the same downstream queue.
- **Impact**: A frustrated user repeatedly clicking retry on a stuck batch can DoS their own event dispatcher; an attacker with IPC access can do the same intentionally. Tier-quota accounting also under-counts.
- **Fix sketch**: In `retry_dead_letter_event`, before calling the repo, do `state.rate_limiter.check("event:dlq_retry", event_source_max, EVENT_SOURCE_WINDOW)` (or the original event's source_type after a SELECT). Return `RateLimited` on rejection and surface it in the DLQ UI.

## 3. Cloud webhooks: secret rendered into clipboard from React state with no scope check

- **Severity**: critical
- **Category**: validation-gap
- **File**: `src/features/triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx:303-315`
- **Scenario**: `handleCopy(row.deployment.webhookSecret!, …)` writes the deployment's webhook secret to the OS clipboard whenever the user clicks the "Secret" button, no confirm, no auto-clear. Combined with `cloudListDeployments()` returning all deployments the cloud account can see, any cross-account leakage in the cloud RLS layer is amplified by this UI: any visible deployment's secret is exposed in plaintext on the screen via clipboard inspection apps. There is also no rotation flow — secret is a permanent token printed verbatim.
- **Root cause**: The UI assumes the cloud API only ever returns secrets that belong to this user; copy is silent and persistent.
- **Impact**: Webhook secret leaks into clipboard history (Windows clipboard sync to OneDrive, macOS Universal Clipboard, third-party paste managers). One-click full compromise of HMAC verification on the cloud edge if listed deployments aren't strictly own-only.
- **Fix sketch**: Reveal-then-copy modal with a 30-second auto-clear (use existing `useKeyedCopyFlag`'s timer to also call `navigator.clipboard.writeText('')`). Show only last-4 by default. Add a `rotateWebhookSecret` IPC for re-generation.

## 4. Smee SSE relay never deduplicates → reconnect-replay creates duplicate events

- **Severity**: high
- **Category**: reconnect-race
- **File**: `src-tauri/src/engine/smee_relay.rs:469-532` (reconnect loop) + `:339` (publish call)
- **Scenario**: When the SSE connection drops mid-stream (network blip, server restart, user toggles status), `relay_sse_core` returns `Err`, the loop sleeps `backoff`, then reconnects. smee.io's server has retransmission semantics — depending on its own restart it may resend recent events. There is **no idempotency key**: `event_repo::publish` mints a fresh UUID and INSERTs unconditionally. Same `delivery` from GitHub can be relayed and persona-fired twice (or N times across N reconnects within smee's replay window).
- **Root cause**: The Smee envelope contains a `x-github-delivery` UUID (per webhook, stable across replays); the relay ignores it.
- **Impact**: Persona runs a `deploy` action twice from one git push, posts duplicate Slack messages, charges a customer twice — silent and persistent. Worse during flaky networks.
- **Fix sketch**: Extract `payload_json["x-github-delivery"]` (or fall back to a SHA256 of the canonicalised body) and store it in a `dedupe_key` column with a UNIQUE index. On INSERT conflict, drop. Hold a small in-memory LRU of recent dedupe keys to avoid hitting the DB every event.

## 5. SSE chunk decoding via `from_utf8_lossy` corrupts multibyte payloads

- **Severity**: high
- **Category**: edge-case
- **File**: `src-tauri/src/engine/smee_relay.rs:264`
- **Scenario**: `let text = String::from_utf8_lossy(&chunk);` is applied per-chunk. TCP can split a UTF-8 payload mid-codepoint (any non-ASCII char — emoji in commit message, accented author name, CJK in a webhook body). The first chunk ends with a partial sequence; `from_utf8_lossy` replaces it with `U+FFFD`. The next chunk starts with the rest of the sequence, also yielding `U+FFFD`. The buffer accumulates two replacement chars where one valid codepoint should have been, JSON parse may fail (or worse, succeed with corrupted data), and the persona sees a mojibake'd webhook body.
- **Root cause**: SSE streaming requires an incremental decoder that holds back partial bytes between chunks, not a per-chunk lossy decode.
- **Impact**: Silent payload corruption; signature verification (when added per finding #1) over the corrupted body would also fail mysteriously.
- **Fix sketch**: Buffer raw bytes (`Vec<u8>`), use `std::str::from_utf8` after each push and split at the last valid UTF-8 boundary, or use `encoding_rs::UTF_8.new_decoder()` for streaming decode.

## 6. `MIN_STABLE_CONNECTION_SECS` only resets backoff on Ok path, not after errors

- **Severity**: high
- **Category**: reconnect-race
- **File**: `src-tauri/src/engine/smee_relay.rs:485-494`
- **Scenario**: The backoff reset to 1s only triggers in `Ok(())` arm when `connected_at.elapsed() >= 30s`. The `Err` arm always doubles backoff, with no consideration of how long the connection was alive. So a relay that has been stably running for hours and finally hits a transient `Stream error: …` will jump straight to 2s, then 4s, … 30s on subsequent retries, never resetting because the `Err` path is taken. Effectively after any error wave the relay is permanently in long-backoff mode until the user toggles the status.
- **Root cause**: Stable-connection backoff reset must occur in both terminal arms.
- **Impact**: After one bad night, relays silently relay only every 30s — user sees "active" but events take half a minute longer; persona triggers feel laggy, hard to diagnose.
- **Fix sketch**: Move the `if connected_at.elapsed() >= MIN_STABLE_CONNECTION_SECS { backoff = …; }` block above the `match` so it runs on both `Ok` and `Err` paths.

## 7. LiveStreamTab paused-queue is unbounded → OOM on long pauses during burst

- **Severity**: high
- **Category**: backpressure
- **File**: `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:87-95`
- **Scenario**: User clicks Pause (e.g. to read an event). A burst of 50k events arrives. Code path: `if (isPaused) { … pausedQueueRef.current.push(evt); … return; }` — no cap. The ref grows to 50k+ `PersonaEvent` objects (each 1-50 KB depending on payload). Renderer process memory balloons; eventually browser kills the tab.
- **Root cause**: Unlike `events` (capped at 200) and `recvTimestamps` (capped at `STREAM_TIMESTAMP_CAP`), the paused queue has no cap.
- **Impact**: Whoever leaves the panel paused over a webhook-heavy night returns to a crashed UI / OOM-killed renderer. Lost diagnostic data.
- **Fix sketch**: Apply a cap mirroring the live-buffer (e.g. 1000) with FIFO eviction: `if (pausedQueueRef.current.length >= 1000) pausedQueueRef.current.shift();` then push. Surface a "events dropped while paused: N" indicator.

## 8. SmeeRelayTab refetches relay list on every relayed event → IPC/DB storm

- **Severity**: high
- **Category**: backpressure
- **File**: `src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:62-67`
- **Scenario**: ```useEffect(() => { if (globalStatus.events_relayed > 0) { fetchRelays(); } }, [globalStatus.events_relayed, fetchRelays]);```. `globalStatus.events_relayed` is the **aggregate** counter emitted by `emit_status` after every published smee event (smee_relay.rs:348). At 100 events/sec across all relays, the panel calls `smeeRelayList()` 100 times/sec, each invocation a Tauri IPC + SQLite SELECT. Once the user opens the tab, the IPC channel saturates, Rust's `require_auth_sync` mutex is hammered, and other panels' IPCs queue behind it.
- **Root cause**: Effect uses raw counter as a "did anything happen" trigger, but the counter changes per event, not per state-relevant transition.
- **Impact**: UI stalls, CPU spikes when smee panel is open during traffic spikes; symptoms most visible on slower machines or during onboarding demos.
- **Fix sketch**: Throttle/debounce the refetch (e.g. lodash `useDebouncedCallback(fetchRelays, 1000)`), or only refetch when `last_event_at` crosses a 5-second threshold, or — simplest — drop the effect entirely and rely on the existing initial fetch + the user-driven manual refresh.

## 9. Smee channel-URL allowlist ignores port → off-allowlist target connection

- **Severity**: high
- **Category**: signature-bypass
- **File**: `src-tauri/src/db/repos/communication/smee_relays.rs:21-48`
- **Scenario**: `validate_channel_url` only inspects `parsed.host_str()` against `["smee.io", "www.smee.io"]`. A URL like `https://smee.io:8443/abc123` passes validation because `host_str()` returns `"smee.io"` regardless of port. The HTTP client then connects to `smee.io:8443`, which (1) may resolve to a different operator entirely if smee.io ever delegates non-standard ports, or (2) is exploited via a clever DNS+CDN config to route the SSE stream to attacker infra. Combined with finding #1 (no payload auth) this enables full event injection.
- **Root cause**: Host-only check; the SSRF-safe DNS resolver mitigates IP-level rebinding but not port-level routing to non-canonical services.
- **Impact**: Attacker convinces user to paste a "valid-looking" smee.io URL with a port; relay opens an SSE stream to attacker, who streams synthetic webhooks.
- **Fix sketch**: After hostname check, also enforce `parsed.port_or_known_default() == Some(443)` (https default).

## 10. Optimistic remove in DLQ retry loses the event when downstream re-fails

- **Severity**: medium
- **Category**: optimistic-update
- **File**: `src/features/triggers/sub_dead_letter/DeadLetterTab.tsx:64-79`
- **Scenario**: `handleRetry`: `await retryDeadLetterEvent(id); setEvents(prev => prev.filter(e => e.id !== id));`. The Rust side flips status to `pending` and increments `retry_count`. The dispatcher picks it up, fails again, and `increment_retry_or_dead_letter` (events.rs:663) moves it back to `dead_letter`. The UI has already removed it — and the panel doesn't refresh until the user clicks "Refresh". Side effect: when the dispatcher re-DLQs, the row's `retry_count` is `previous + 1`. After a few cycles the displayed `retry_count/maxManualRetries` is stale by multiple. User believes "retry succeeded" when in reality it bounced.
- **Root cause**: Optimistic local removal isn't paired with a re-poll or a CDC subscription to `persona_events` updates for `dead_letter` status changes.
- **Impact**: Operator gives up on a failing event prematurely (thinking retry "worked"), or quietly hits the retry cap without realising; events that need attention stay broken.
- **Fix sketch**: Don't optimistically remove. Instead show the row with a spinner and refetch via `listDeadLetterEvents` after retry — or wire a `useEventBusListener` that picks up `persona_events` UPDATE CDC and reconciles.

## 11. `cancel_relay_task` detaches the cancellation grace task → tokio task leak

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src-tauri/src/engine/smee_relay.rs:361-382`
- **Scenario**: Each relay-config change cancels the existing task and spawns a *detached* `tokio::spawn` to wait 2s and abort. Under rapid config churn (user mass-edits 50 relays via a bulk update, or a script CRUDs them in a loop), 50 detached cancellation tasks pile up, each holding the `JoinHandle` and waiting on its grace period. If the underlying SSE drop is slow (TLS shutdown), aborts queue. Memory grows; on app shutdown there is no graceful-flush.
- **Root cause**: Detached supervision has no upper bound and no explicit lifetime.
- **Impact**: Long-lived sessions accumulate zombie tasks; debug logs show stale `relay_id` JoinErrors after the relay is long deleted.
- **Fix sketch**: Track grace handles in a `Vec<JoinHandle<()>>` on the manager state, periodically drain finished ones, and `abort_all` on shutdown.

## 12. Smee relay: `events_relayed` double-source-of-truth between in-memory state and DB

- **Severity**: medium
- **Category**: silent-failure
- **File**: `src-tauri/src/engine/smee_relay.rs:340-348` + `src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:141`
- **Scenario**: After `event_repo::publish` succeeds, the relay does `smee_relay_repo::record_event(pool, relay_key)` (DB increment) AND `r.events_relayed += 1` (in-memory). The aggregate `total_relayed` shown in the banner is summed from `relays.reduce(…, r.eventsRelayed)` which is the DB-sourced value loaded by `fetchRelays`. The per-relay metric in `globalStatus.events_relayed` is the in-memory sum from `emit_status`. If `record_event` fails (DB lock, disk full, transient error — its return value is ignored with `let _ = …`), DB lags in-memory; UI numbers diverge silently and the user can't tell which is correct.
- **Root cause**: Two counters incremented independently, with the DB write being non-fatal.
- **Impact**: Metric drift confuses debugging — "I see 1000 relayed in the banner but the DB says 800". Doesn't affect functionality but undermines trust in the DLQ/relay diagnostics.
- **Fix sketch**: On `record_event` Err, log and decrement the in-memory counter, or treat DB as canonical only and remove the in-memory increment.

## 13. SmeeRelayTab `setTimeout` after delete fires after unmount

- **Severity**: medium
- **Category**: cleanup-gap
- **File**: `src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:108-122`
- **Scenario**: `handleDelete` calls `smeeRelayDelete` then schedules a 300ms `setTimeout` that does `setRelays(...)`. If the user navigates away (`SmeeRelayTab` unmounts) within 300ms, the timeout still fires and React warns about state-update on unmounted component (or, post-React-18 with strict reconciliation, silently no-ops but the timer is still alive). With many in-flight deletes during a rapid trash-spam, multiple stale timers accumulate.
- **Root cause**: No cleanup ref tracking the timer ID or AbortController for the delete flow.
- **Impact**: Devtools warnings, marginal memory; under aggressive use can mask real bugs.
- **Fix sketch**: Track the timer id in a `useRef<number[]>`, clear all in a `useEffect(() => () => …)` cleanup, or skip the setTimeout entirely and reconcile via AnimatePresence + an `exitingIds` set without the prefilter.

## 14. TestTab fires events without rate-limit guard surfacing in UI

- **Severity**: low
- **Category**: silent-failure
- **File**: `src/features/triggers/sub_test/TestTab.tsx:184-207` + `src-tauri/.../events.rs:144-180`
- **Scenario**: `test_event_flow` IPC enforces `state.rate_limiter.check("event:test", event_source_max, …)` and returns `AppError::RateLimited` on exceed. The frontend's `catch {}` block discards the error silently — no toast, button just re-enables. User mashing the publish button hits the limit and is left wondering why nothing fired.
- **Root cause**: `catch {}` swallows all errors; comment claims "surfaced via toast/silent layers upstream" but `testEventFlow` IPC doesn't go through such a layer.
- **Impact**: Confusing UX for power users testing flows; rate-limit visibility is absent.
- **Fix sketch**: Replace `catch {}` with `catch (err) { addToast(humanizeIpcError(err), 'error'); }`, distinguishing `RateLimited` from validation failures.

## 15. RateLimitDashboard divides by zero on degenerate config

- **Severity**: low
- **Category**: edge-case
- **File**: `src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx:114-117`
- **Scenario**: `width: ${Math.min(100, stats.rateLimitedCount > 0 ? ((stats.throttledCount / stats.rateLimitedCount) * 100) : 0)}%`. The ternary guards `rateLimitedCount === 0`, but the empty-state early return at line 47 already handles that case. Meanwhile if `throttledCount > rateLimitedCount` (shouldn't happen but the trigger map / state keys could drift, e.g. trigger deleted while still in store), the inner expression exceeds 100 — clamped fine. Real issue: when `rateLimitedCount === 1` and `throttledCount === 1` the bar is 100% red even when the throttled trigger is unrelated to the configured-rate-limit trigger.
- **Root cause**: `throttledCount` and `rateLimitedCount` count different sets (`extractRateLimit` config-presence vs runtime store state); the ratio is meaningless when sets differ.
- **Impact**: Misleading red "100% throttled" indicator. Cosmetic but erodes trust.
- **Fix sketch**: Either restrict `throttledCount` to triggers that are also in `rateLimitedCount`, or display "N throttled, M configured" without the ratio bar.
