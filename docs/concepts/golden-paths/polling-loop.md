# Golden path — Polled read: client cadence, server cache

> Situation node: `client-runtime/data-fetching/polling-loop` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of every `setInterval(` site
> under `src/` (84 grep hits, all read individually), every `usePolling` call
> site, all four competing cadence primitives, the `PollingCoordinator`, a full
> `npx eslint` run over all 4,829 `src/**/*.{ts,tsx}` files, and — for the
> server half — all 1,666 `#[tauri::command]` definitions across the five
> `src-tauri/` crates, the 100 snapshot/status commands among them, and all 39
> in-process caches. Against `master` @ `f7676ab82`.
> Every count below was produced by reading the source, not estimated.
> `.claude/worktrees/**` excluded.
> This leaf is **two-sided and fused**: the client cadence and the server read
> cost are one contract, and the document states both halves plus the contract.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> in `workspace_practice_context_state` when this path is ingested.

**Adjacent leaves — cross-reference, do not absorb.**
`client-runtime/data-fetching/backend-to-frontend-events` owns the *push*
transport (`app.emit` → `listen`) — the alternative to polling entirely; §"When
NOT to poll" points at it and stops there.
`client-runtime/data-fetching/shared-fetch-cache` owns request dedupe and the
module-scope warm cache that makes a *remount* paint warm.
`client-runtime/data-fetching/stale-response-guard` owns the sequence guard that
keeps a superseded response from clobbering a newer one — a poll needs one, but
the rule belongs there.
`client-runtime/data-fetching/snapshot-plus-stream` owns opening a running
entity with a snapshot + a stream.
`frontend/motion/page-loading` ([page-loading.md](./page-loading.md)) owns what
the surface *shows*; §"The contract" states the one rule where the two meet.

## Trigger

- "This panel should auto-refresh" / "keep this dashboard live" / "refresh every N seconds"
- "Poll until the job finishes" / "watch the status until it's done" / "wait for the build to go healthy"
- "The badge count is stale until I reload" / "this number stops moving"
- "The app is busy doing nothing" / "why is it hitting the backend in the background?"
- "This keeps fetching while the window is minimised"
- "Add a `lastRefreshed` / 'updated 5s ago' indicator to this card"

If you are about to type `setInterval(`, `window.setInterval(`, a `setTimeout`
that re-arms itself from inside its own callback, `pollTimerRef`, `POLL_MS`,
`REFRESH_INTERVAL_MS`, or a `useEffect` whose cleanup is `clearInterval` — you
are in this situation.

## The one way

First ask whether the backend can just **tell** you (see *When NOT to poll*). If
it genuinely cannot, decide which of two shapes you have, because they are
different situations wearing one word. A **steady-freshness poll** keeps a
mounted surface current forever: use `usePolling(fetchFn, { ...POLLING_CONFIG.<name>, enabled })`
and nothing else — it registers one ticker on the shared `PollingCoordinator`
heartbeat so N surfaces on the same cadence cost one timer and one IPC burst,
pauses every bucket while the document is hidden and re-fires immediately on
return, refuses to re-enter a ticker that is still in flight, and holds your
`fetchFn` in a ref so an unstable callback identity can never restart the clock.
Draw the cadence from `POLLING_CONFIG`, never a literal — the registry's six
entries are exactly the cadences that land on a coordinator bucket, and an
off-bucket number is silently rounded. Gate `enabled` on the narrowest true
condition you have (`hasRunning`, `isConnected && activeTab === 'status'`), pass
a stable `name` for coordinator stats, and let the `fetchFn` **reject** on
failure or the built-in exponential backoff does nothing. A **terminal poll**
watches one job until it reaches a final state and then stops: use
`useBackgroundSnapshot`, which decays its own interval while the job stays
`running`, stops dead on `completed`/`failed`, and gives up after a bounded
failure budget — and memoise every callback you hand it. Never hand-roll either
shape; never let the interval outlive the surface; never let a poll set a
loading flag. Then write the **server half in the same change**: open the
command your poll calls, and make repeated reads cheap by putting the answer in
warm process state on `AppState` — the shape `get_scheduler_status`,
`get_circuit_breaker_status` and `get_network_snapshot` already use to serve a
poll with zero SQLite — falling back to a short TTL memo only when the read must
touch the database, and wiring that memo's `invalidate_*` into every mutation
that stales it in the same commit that introduces it (`api_proxy.rs`'s
`CONNECTOR_CACHE` is the pattern; four of the repo's five invalidators have zero
callers, which is how a cache becomes a correctness bug).

## Mandated primitives

- **`src/hooks/utility/timing/usePolling.ts`** — `usePolling(fetchFn, { interval, enabled, maxBackoff?, name? })` → `{ isPolling, lastRefreshed }`. The steady-freshness primitive. Registers on the coordinator (`:88-93`), holds `fetchFn` in a ref refreshed every render (`:63-64`) so the effect deps `[enabled, interval, runFetch, name]` are all stable, and gates re-entry with a `shouldRun` predicate driven by `nextEligibleAtRef` (`:91`). Backoff is `min(interval * 2^errors, maxBackoff)` with `maxBackoff` defaulting to `interval * 4` (`:66`, `:76-82`).
- **`src/hooks/utility/timing/usePolling.ts:6-19` — `POLLING_CONFIG`** — the six named cadences: `runningExecutions` 5s/30s · `cloudReviews` 15s/60s · `dashboardRefresh` 30s/120s · `cloudStatus` 12s/60s · `cloudHistory` 15s/60s · `pipelineRefresh` 5s/30s. All six land exactly on a coordinator bucket; that is what the registry is for. Spread it (`...POLLING_CONFIG.cloudStatus`) so you get `maxBackoff` too.
- **`src/lib/polling/pollingCoordinator.ts`** — `getPollingCoordinator()`, one `PollingCoordinator` per `globalThis` (HMR-safe, `:267-278`). Buckets `[5s, 12s, 15s, 30s, 60s]` (`:26`); `pickBucket` rounds to nearest (`:61-72`). `register(name, fn, { interval, shouldRun?, runWhileHidden?, fireOnRegister? })` → `{ id, bucket, dispose }`. `onVisibilityLost` clears every bucket with no `runWhileHidden` ticker (`:240-249`); `onVisibilityRegained` fires all eligible tickers immediately then re-arms (`:251-262`). `inFlight` re-entry guard at `:218`. Errors are swallowed per-ticker into a Sentry breadcrumb so one failure cannot poison the bucket (`:227-238`). **Use it directly only for the two things `usePolling` cannot express** — see Gaps #2.
- **`src/hooks/utility/data/useBackgroundSnapshot.ts`** — the terminal-poll primitive. `{ snapshotId, getSnapshot, onLines, onPhase, onDraft, onCompletedNoDraft, onFailed, onSessionLost, onQuestions?, onSections?, interval?, maxFailures?, epoch? }`. Self-rescheduling `setTimeout` (`:88-93`), interval decays ×1.5 up to 10s after two consecutive `running` reads (`:140-151`), clears on `completed`/`failed` (`:135-138`), pauses on `awaiting_answers` (`:113-122`), calls `onSessionLost` after `maxFailures` (default 3) consecutive rejections (`:156-161`), and cleans up on unmount twice over (`:168-170`, `:174-181`).
- **`src/hooks/utility/useDocumentVisibility.ts`** + **`src/lib/documentVisibility.ts`** — `useSyncExternalStore` over one shared `visibilitychange` listener. The *only* correct visibility source; the coordinator already subscribes to it, so inside `usePolling` you need nothing.
- **`src/hooks/design/oauth/useOAuthPolling.ts`** — the sanctioned domain specialisation: bounded-attempt consent polling with an `AbortController` + generation guard, `MAX_POLL_ATTEMPTS = 120` at 1.5s. Three wrappers (`useOAuthConsent`, `useOAuthProtocol`, `useUniversalOAuth`). Do not generalise it; do not copy it for non-OAuth work.
- **`@/lib/tauriInvoke`'s `invokeWithTimeout`** — the transport. `DEFAULT_TIMEOUT_MS = 90_000` (`tauriInvoke.ts:37`) is the number that makes the coordinator's `inFlight` guard load-bearing: at a 2s cadence a hung command can stack ~45 concurrent requests before the first one gives up.

### Server half

Reach for these **in this order**. Warm state beats a cache; a cache beats a raw
fan-out; a fan-out at least beats N separate commands.

1. **A warm struct on `AppState`** — the canonical answer, and the one the repo
   is already good at. `AppState` (`src-tauri/src/lib.rs:369-499`) carries ~40
   fields, four of them separately `manage`d for direct `State<'_, T>` injection
   (`lib.rs:1189-1192`). A poll target that reads one of these costs zero SQLite:
   - **`SystemMetricsSampler`** (`lib.rs:414`; impl `commands/infrastructure/system_metrics.rs:52-95`) — **copy this one.** One `sysinfo::System` refreshing CPU + RAM *only*, never the process list (the expensive part). `get_system_metrics` (`:106-115`) is `require_auth` + one mutex lock + one `sample()`. Its comment records *why* the state must persist: CPU% is a delta between samples, so a fresh `System` per call would always read 0%. This is what makes a 2s client cadence defensible.
   - **`SchedulerState`** (`lib.rs:375`) → `get_scheduler_status` (`commands/execution/scheduler.rs:16`) is 11 `AtomicU64::load(Relaxed)` + `subscription_health()` (`src/engine/background.rs:224-239`).
   - **`ExecutionEngine.circuit_breaker`** (`lib.rs:374`) → `get_circuit_breaker_status` (`commands/execution/executions.rs:797`).
   - **`get_network_snapshot`** (`commands/network/discovery.rs`) — **the "one snapshot replaces N calls" reference**: eight in-memory reads (`is_running`, `listening_port`, connected count, mDNS peers, connection health, message metrics, connection metrics, manifest-sync metrics) fused into one command with a single DB read for the peer id.
   - Also warm and poll-readable: `AmbientContextHandle` (`:423`), `DevServerRegistry` (`:487`), `ActiveProcessRegistry` (`:378`), `tier_config`/`rate_limiter` (`:397`,`:401`), `RadioServiceHandle` (`lib.rs:1328`), the fleet PTY registry (`fleet_monitor_stats`, `commands/fleet/monitor_stats.rs:171`).
2. **A TTL memo** when the read genuinely must hit SQLite. `get_tier_usage` (`commands/infrastructure/tier_usage.rs:15` TTL = 3s, read `:63-67`, write `:126`) is the **only** polled command in the repo with one.
3. **`invalidate_*` wired into every staling mutation.** **`engine/api_proxy.rs`'s `CONNECTOR_CACHE` (`:34` TTL 30s, `:41` static) is the reference implementation** — `invalidate_connector_cache()` (`:133`) is called from `create_connector` (`commands/credentials/connectors.rs:36`), `update_connector` (`:49`), `delete_connector` (`:58`) and `openapi_autopilot.rs:777`. Two other correct patterns worth knowing: `session_pool` (`engine/src/session_pool.rs:20`, 30min) invalidated from five persona/use-case mutations; and **content-addressed keys that need no invalidator at all** — `SMART_SEARCH_CACHE` folds the whole candidate set into its key (`commands/design/smart_search.rs:171`), `PREPARED_RUN_CACHE` SHA256s its full input (`engine/src/prepared_run_cache.rs:30-60`). Prefer a content-addressed key; it cannot go stale.
4. **One bundled read, in one transaction.** `get_overview_bundle` (`commands/communication/observability/metrics.rs:140`) runs three repo calls inside a single `BEGIN DEFERRED … COMMIT` (`:150`, `:161`) with `prepare_cached` — the best bundling in the codebase. It still has no memo (see Deviations), but the transaction shape is right.
- **The push spine — read this before choosing to poll at all.** `src-tauri/db/src/cdc.rs` turns SQLite `update_hook` writes into Tauri emits (`create_cdc_channel` `:119`, `spawn_cdc_drain_task` `:282`, drop counter `:38`); wired in `src-tauri/src/lib.rs:650`, `:656`, `:1332-1340`. Typed emit helpers: `emit_event` / `emit_event_bus` (`src-tauri/engine/src/event_registry.rs:36`, `:44`). This is not hypothetical — CDC has **already deleted polls**: `commands/communication/events.rs:17` removed its manual emits, and `engine/subscription.rs:370-371` records that "dispatch latency is bounded by CDC delivery (~ms), not the poll." Owned by the `backend-to-frontend-events` leaf; named here so nobody adds a timer for a table CDC already watches.

## Steps

1. **Try not to poll.** If the backend already emits on the state change, subscribe instead — `client-runtime/backend-to-frontend-events`. Polling is for state the backend changes without telling anyone (an external API, an OS process table, a `sysinfo` sample, a row a *different* process writes).
2. **Classify the shape.** Does it stop? A job/build/scan/consent flow that reaches `completed`/`failed` is a **terminal poll** → step 8. A dashboard, badge, gauge or list that must stay current for as long as it is mounted is a **steady-freshness poll** → step 3.
3. **Pick the cadence from `POLLING_CONFIG`.** If none fits, add a named entry — and pick a value that is exactly one of `5_000 / 12_000 / 15_000 / 30_000 / 60_000`. Anything else is silently rounded to the nearest of those (Gaps #1). Never inline a literal.
4. **Write the `fetchFn` so it rejects on failure.** If it is a store action, it almost certainly swallows into store state — wrap it, or the entire backoff mechanism is inert (the single most common defect at otherwise-correct call sites; see Deviations P0).
5. **Compute `enabled` as the narrowest true condition.** `hasRunning`, `isConnected && activeTab === 'status'`, `!!projectId && !!activePipelineId && isRunning`. `enabled: true` is a claim that this surface must poll for its entire mounted lifetime — make it deliberately, not by default.
6. **Call it**: `usePolling(fetchFn, { ...POLLING_CONFIG.<name>, enabled, name: '<feature>:<what>' })`. The `name` is what makes `coordinator.stats()` readable when someone is chasing background IPC load.
7. **Stop.** No `useEffect`, no `setInterval`, no `clearInterval`, no `visibilitychange` listener, no `document.hidden` check, no in-flight ref, no retry counter, no `useDocumentVisibility` call of your own. If you want a freshness label, render `lastRefreshed` through `display/RelativeTime`.
8. **For a terminal poll**, call `useBackgroundSnapshot` with the job id and a `getSnapshot`. **Memoise every callback** you pass — all eleven inputs are in its dep array (`useBackgroundSnapshot.ts:171`), so one unstable callback restarts the effect, resets the backoff and re-fires `syncSnapshot()` on every render.
9. **Now do the server half — open the command and count its queries.** Zero SQLite (a warm `AppState` read)? Done. Otherwise: can the state live warm on `AppState` instead? If not, add a TTL memo — **and in the same commit wire its `invalidate_*` into every mutation that stales it, then grep that the invalidator has at least one caller.** An uninvalidated cache is a correctness bug that is strictly worse than no cache: it guarantees a confidently-wrong value for a full TTL. If the command issues several queries, fuse them into one `BEGIN DEFERRED` transaction (`metrics.rs:150`) before reaching for a cache.
10. **Set the cadence from what step 9 costs, not from what feels live.** 2s against a warm in-memory sampler is fine. 30s against six uncached `SELECT COUNT(*)` round trips — which is what the sidebar badge does today — is not.
11. **Never add a second poller for data an existing poll already fetches.** Fuse it into the existing command as an extra field (the `get_network_snapshot` shape) or read it from the same store slice. Two tickers on one bucket reading two overlapping commands is the single most expensive mistake available here, and the repo makes it (Deviations, server P0).

## When NOT to poll

- **The backend already emits the change.** Subscribe. Polling on top of an event stream is the most expensive possible way to be second. **Check `db/src/cdc.rs` first**: every SQLite INSERT/UPDATE on a watched table already emits, and `subscription.rs:370-371` records that CDC delivery is ~ms against a poll's seconds. If your data is a table row this app writes, you probably do not need a timer at all.
- **The state only changes because *this* client changed it.** Refetch after the mutation resolves; a timer is a workaround for not having wired the write path.
- **The surface is not visible.** Not a cadence question — an `enabled` question. A collapsed accordion, an inactive tab, a row below the fold: gate `enabled`, or use `useElementVisible` for viewport gating (`ScheduleTimeline.tsx:129` and `CompositePartialMatchIndicator.tsx:32` both do this correctly).
- **You are polling per row.** N rows means N timers. Lift one poll to the list and fan the result down.

## The contract (client ↔ server)

Four rules bind the two halves. Every one of them is violated somewhere in this repo.

1. **The client may not choose a cadence without reading the command.** The cadence is a budget drawn against the server read's cost. `SystemLoadFooterIcon` at 2s is correct *because* `get_system_metrics` is a warm in-memory sample; the same cadence against an uncached SQLite fan-out is a defect. Cite the command in a comment when the cadence is faster than 5s.
2. **The server may not cache without invalidating.** If a poll reads through a TTL memo, every mutation that changes the underlying data must clear or bump it. Otherwise the poll is *worse* than no poll: it guarantees the user stares at a value that has already changed, for up to one TTL, with full confidence. Five caches in this repo fail this rule, one of them for a full hour.
3. **A poll must never set a loading flag.** The loading flag means "there is nothing on screen yet". A refetch that flips it makes a live surface flicker into its cold-load state on every tick — law 1 of [page-loading](./page-loading.md). The correct pair is `isLoading` for the first fetch and `lastRefreshed` for every one after.
4. **The failure signal must survive the trip.** The backoff only exists if `fetchFn` rejects; the error banner only exists if the store records it. Doing both is fine — swallowing into store state *and* resolving is the shape that kills backoff silently.
5. **Every poll in this app is a full re-read, so size it that way.** Of **1,666** Tauri commands, **zero** accept a since/cursor/etag/version parameter with delta semantics and zero return a change token. (Eight commands *look* like they do: five are absolute analytics windows — `events.rs:33-36`, `tools/tools.rs:114,123,133,144`; three are keyset *pagination* cursors — `reviews.rs:1027`, `dev_tools.rs:646`, `:1300`; and `fetch_roadmap`'s ETag is HTTP-to-GitHub and never crosses IPC.) There is no cheap incremental tick available to you. Until that changes, cadence is the only cost lever you have — which is exactly why steps 5 and 10 matter more here than in an app with delta reads.

## Anti-patterns

- **`setInterval` in a `useEffect` for a data fetch.** 41 of the 84 `setInterval` sites in `src/` do this. Every one of them re-implements some subset of {shared heartbeat, visibility pause, in-flight guard, backoff, cleanup} and none implements all five.
- **A `setTimeout` that re-arms itself from its own callback.** Nine remote-poll loops do this. It reads as "safer than `setInterval`" and is not: it has the same stacking hazard with none of the coordinator's guards.
- **Putting the polled data in the effect's dep array.** `useTeamDeliberations.ts:118-133` polls `refreshDetail(selectedId)` from an effect whose deps include `detail` — the very object the poll replaces. Every successful tick tears the interval down and rebuilds it, restarting the 6s clock. The same restart-storm shape from unmemoised deps appears at `useHarvestAutoIngest.ts:114`, `ExtractionMenu.tsx:137`, and `useRemediationEvaluator.ts:150` (where a new `credentials` array identity restarts a **30-minute** timer from zero, so the evaluator may never fire at all). `usePolling` is structurally immune to this: `fetchFn` lives in a ref.
- **Allocating the timer outside a `useEffect`.** `ExtractionMenu.tsx:212` starts a 3s `getVerifyStatus` interval inside a click handler; it is cleared only when the job self-reports terminal. Unmount does not stop it, and a job that never settles polls forever. `studioStore.ts:280` and `:318` do the same from module-scoped `Map`s. These are the only three genuine leaks in the repo — and they are exactly the three the lint rule cannot see (see The missing gate).
- **A raw literal cadence.** `NetworkDashboard.tsx:251` — `usePolling(fetchNetworkSnapshot, { interval: 30_000, enabled: true })`. It happens to land on a bucket; the next one won't.
- **`enabled: true`.** `CloudHistoryPanel.tsx:123` and `NetworkDashboard.tsx:251`. A permanently-true gate says this surface must poll for its whole mounted life; usually there is a real condition available.
- **A `fetchFn` that cannot fail.** See Deviations P0 — this is the defect that makes 6 of 6 `POLLING_CONFIG.maxBackoff` values dead configuration.
- **Setting a loading flag from the poll.** `useStatusPageData.ts:81` (`setLoading(true)` every 60s), `CloudHistoryPanel.tsx:43` (every 15s), `cloudSlice.ts:213` (`cloudIsLoadingStatus: true` every 12s).
- **Hand-rolling the visibility pause.** `useStatusPageData.ts:123-157` — 35 lines reimplementing `usePausableInterval`, which already exists, in a different feature folder, with a test. Ten of the 41 raw sites hand-roll some visibility gate; the other 31 poll a hidden window forever.
- **One timer per rendered row.** `CompositePartialMatchIndicator.tsx:32` (4s × N trigger rows) and `RecentChangeChip.tsx:42` (30s × N settings sections). Both are visibility-gated, which is the right instinct applied at the wrong altitude.
- **Two timers for one job in one module.** `studioStore.ts` runs a 1.5s boot poll *and* a 6s liveness watch per studio tab, both in module-level `Map`s: N tabs → up to 2N live `webbuildStatus` pollers with no React lifecycle attached at all.
- **Inventing a fourth cadence hook.** There are already four. Adding a fifth is how this situation reached `diverged`.

**Server-side:**

- **Adding a TTL cache and its `invalidate_*` in the same file, then never calling the invalidator.** Four of the repo's five invalidators have **zero callers workspace-wide**; two are papered over with `#[allow(dead_code)]`, which silences the one signal that would have caught it. The lint attribute is the anti-pattern: it converts "nobody wired this up" into "this is intentional".
- **Making the invalidator private.** `obsidian_brain/graph.rs:106`'s `invalidate_vault_index_cache` is a private `fn`, so the five vault writers in the sibling module *physically cannot* call it. Its single caller is a file-watcher callback — so correctness depends on a watcher being alive.
- **A `SELECT COUNT(*)` per badge.** `dev_tools_pending_counts` (`db/src/repos/dev_tools.rs:1350`) issues six separate counts on one connection with no transaction, uncached, every 30 seconds — and is polled by *two* registrations at once (see server P0).
- **Reading SQLite when the warm authority is right there.** `get_build_status` (`commands/design/build_sessions.rs:608`) is polled throughout a live build and goes to the `build_sessions` row, while `AppState.build_session_manager` (`lib.rs:460`) holds that session in memory.
- **A cache seeded once at construction that a settings write does not re-seed.** `skills_sidecar/mod.rs:42` and `skill_scratchpad.rs:74` are seeded only from `src/engine/mod.rs:505,:508`; `set_app_setting` (`commands/infrastructure/settings.rs:121`) hot-applies exactly one key (`MAX_PARALLEL_EXECUTIONS`, `:149`) and emits `settings-changed` for the frontend without re-seeding either. The user toggles a setting, the UI updates, and the backend keeps the old value until restart.

## Evidence

**Adoption:** 11 `usePolling` call sites across 9 files; 2 further files register on the coordinator directly. Against 41 raw `setInterval` data-polls and 9 self-rescheduling `setTimeout` poll loops. **Adoption ratio: 11 / 61 ≈ 18%.** In `src/features/vault/**` + `src/features/plugins/**` specifically: 20 raw `setInterval` sites, **1** `usePolling` call site.

- **`plugins/gitlab/components/GitLabPipelineViewer.tsx:59` — copy this one.** The complete steady-freshness shape in four lines: `...POLLING_CONFIG.pipelineRefresh` spread (so `maxBackoff` comes along), a memoised `refreshActivePipeline`, and `enabled` narrowed to three real conditions (`!!projectId && !!activePipelineId && isRunning`). It is also the *only* adopter in the entire vault+plugins surface.
- `fleet/monitor/useMonitorData.ts:362-382` — **the only file that names its tickers**, four of them (`monitor:reviews`, `monitor:messages`, `monitor:personaHealth`, `monitor:cloudReviews`), each with its own `enabled` gate. Copy the naming convention from here.
- `overview/sub_activity/components/GlobalExecutionList.tsx:231` — exemplary `enabled: hasRunning`: the list polls at 5s only while something is actually running, and goes silent otherwise.
- `agents/sub_deployment/components/cloud/CloudDeployPanel.tsx:130` — `enabled: isConnected && activeTab === 'status'`, the tab-scoped gate.
- `commands/infrastructure/system_metrics.rs:52-115` — **the exemplary server half.** Warm `AppState` struct, refresh-only-what-you-need, zero SQLite, and a module comment that explains why the state must persist across calls. Paired with the app's fastest client cadence (2s), it is the whole contract in one file.
- `engine/api_proxy.rs:34,:41,:133` + `commands/credentials/connectors.rs:36,:49,:58` — **the exemplary cache-plus-invalidation pair.** A 30s TTL on the connector list (read on every proxied request) with the invalidator called from all three mutations and the autopilot. This is what the other four caches should look like.
- `commands/network/discovery.rs` (`get_network_snapshot`) — the exemplary *bundled* poll target: eight in-memory reads fused into one command so the client needs one ticker, not eight.
- `commands/design/smart_search.rs:161-171` and `engine/src/prepared_run_cache.rs:30-60` — **caches that cannot go stale**, because the key is content-addressed over the whole input. The best kind of invalidation is the kind you don't have to remember.
- `commands/communication/observability/metrics.rs:140-161` — three repo calls in one `BEGIN DEFERRED` with `prepare_cached`; the right transaction shape even though it still wants a memo.
- `commands/infrastructure/tier_usage.rs:15,:63-67,:126` — the only TTL-cached poll target in the repo (3s), and correct: the value derives purely from live in-memory state, so nothing external can stale it.
- `db/src/cdc.rs` + `engine/subscription.rs:370-371` — the push spine that has already retired polls. Read before adding a timer.
- `shared/chrome/useTitleBarTray.tsx:79-101` — the legitimate direct-coordinator escape hatch, with the reasoning written down: two badges deliberately kept as *separate* registrations on one 30s bucket because summing them would produce a number that answers neither question. Its comment also records the bug this path prevents — a raw `setInterval` beside it that "ticked on its own offset and made SQLite warm its cache a second time for a badge".
- `hooks/sidebar/useBadgeCounts.ts:54-67` — direct registration because the effect must `await import()` the store first; correct `dispose` threading through the async boundary.
- `hooks/utility/data/useBackgroundSnapshot.ts:88-164` — the terminal-poll reference. Consumers: `useCreateTemplateSnapshot.ts:146`, `useN8nTransform.ts:278`, `useBackgroundRebuild.ts:94`.
- `schedules/components/ScheduleTimeline.tsx:129` — the best *hand-rolled* poll in the repo (viewport visibility via `useElementVisible`, in-flight dedupe, 500ms event coalescing). It should still be `usePolling` + `enabled`, but it is the one hand-roll that understood the problem.
- `lib/__tests__/pollingCoordinator.test.ts` — 10 tests: bucket rounding, bucket co-location, fire-on-register, `shouldRun` skip, bucket teardown, in-flight re-entry, error isolation, singleton stability.

## Deviations found

### P0 — the root cause: the backoff is dead at every single call site

`usePolling`'s error backoff engages only when `fetchFn` **rejects**. All 11 call
sites pass a function that resolves on failure — every one catches internally and
writes the error into store state or a log:

| Call site | `fetchFn` | Where the rejection dies |
|---|---|---|
| `GlobalExecutionList.tsx:231` | `fetchGlobalExecutions` + `fetchGlobalExecutionCounts` | `overviewSlice.ts:405` `reportError(...)`; `:433-436` `log.warn` |
| `useObservabilityData.ts:77` | `Promise.all` of 4 store actions | `overviewSlice.ts:556-563` and siblings, all `catch → set({ ...Error })` |
| `ManualReviewList.tsx:125` | `fetchCloudReviews` | `overviewSlice.ts:510-512` `catch → log.warn + set({ cloudReviews: [] })` |
| `NetworkDashboard.tsx:251` | `fetchNetworkSnapshot` | `networkSlice.ts:573-574` `catch → bumpFailure(...)` |
| `CloudDeployPanel.tsx:130` | `cloudFetchStatus` | `cloudSlice.ts:217-218` `catch → set({ cloudError })` |
| `CloudHistoryPanel.tsx:121` | local `fetchData` | `CloudHistoryPanel.tsx:52` `catch → silentCatch(...)` |
| `GitLabPipelineViewer.tsx:59` | `gitlabRefreshPipeline` | `gitlabSlice.ts:448` `catch` |
| `useMonitorData.ts:362,367,372,377` | `reloadReviews` / `reloadMessages` / `fetchPersonaSummaries` / `fetchCloudReviews` | `useMonitorData.ts:321,335`; `personaSlice.ts:202-206`; `overviewSlice.ts:510` |

**Consequence:** `errorCountRef` never increments, `nextEligibleAtRef` is never
set, and all six `POLLING_CONFIG.maxBackoff` values (`30_000`, `60_000`,
`120_000`, `60_000`, `60_000`, `30_000`) are dead configuration. A backend that
is failing every request is polled at full cadence forever. **11 of 11 call
sites; 6 of 6 registry entries.** Fix at the call site (wrap so it rethrows), not
in the hook.

### P0 — the bucket floor and ceiling exclude 29% of real cadences

`pickBucket` (`pollingCoordinator.ts:61-72`) rounds to the nearest of
`[5s, 12s, 15s, 30s, 60s]` **silently**. This is not a style problem; it is why
adoption failed. Twelve POLL-DATA sites cannot adopt `usePolling` without a
cadence change, and three of them would be amplified by more than an order of
magnitude:

| Site | Real cadence | Bucket it would get | Effect |
|---|---|---|---|
| `useAutoUpdater.ts:158` | 6 h | 60s | **360× faster** |
| `useRemediationEvaluator.ts:150` | 30 min | 60s | **30× faster** |
| `home/sub_releases/useLiveRoadmap.ts:82` | 1 h | 60s | **60× faster** |
| `ChatTab.tsx:92` | 800 ms | 5s | 6× slower |
| `RadioFooter.tsx:481` | 1 s | 5s | 5× slower |
| `useSchemaProposal.ts:103` · `composeTask.ts:75` · `studioStore.ts:280` | 1.5 s | 5s | 3.3× slower |
| `SystemLoadFooterIcon.tsx:86` · `useUseCases.ts:81` | 2 s | 5s | 2.5× slower |
| `ExtractionMenu.tsx:137` | 2.5 s | 5s | 2× slower |
| `ExtractionMenu.tsx:212` | 3 s | 5s | 1.7× slower |

The three fast/slow outliers explain the two competing primitives: `usePausableInterval`
exists in `features/home/lib/` because the roadmap needs an hour, and
`useBackgroundSnapshot` exists because job polls need sub-second-to-2s. **Neither
author was being lazy — the primitive had no room for them.** See Gaps #1.

### Competing primitives (4 where there should be 2)

| Path | What's wrong |
|---|---|
| `features/home/lib/usePausableInterval.ts` | A second steady-freshness hook: `document.hidden` + caller `active` gating, refresh-on-reactivate, its own `visibilitychange` listener. **No coordinator, no backoff, no in-flight guard.** Lives in a *feature* folder while being domain-agnostic. Exactly one consumer (`useLiveRoadmap.ts:82`) — and only because its 1h cadence is outside the coordinator's ceiling. Has a test (`usePausableInterval.test.ts`); `usePolling` does not. |
| `overview/sub_health/libs/useStatusPageData.ts:123-157` | Reimplements `usePausableInterval` **from scratch** in a third feature folder — 35 lines of start/stop/`visibilitychange`/refresh-on-return. Nothing combines visibility pausing with backoff, which is precisely what a status page needs. Also violates contract rule 3 (`setLoading(true)` on every 60s tick, `:81`). |
| `hooks/design/oauth/useOAuthPolling.ts` | **Legitimate** — a bounded-attempt consent poll with abort + generation guards, 3 wrappers. Named here so nobody "consolidates" it. Untested. |

### Raw `setInterval` data-polls — migrate (41)

Aggregate: cleanup present **38/41**; visibility gating **10/41**; error backoff
**0/41** (4 have a stop-on-N-failures circuit break, which is not backoff); an
in-flight guard **≈5/41**, against a 90s IPC timeout.

**No cleanup at all — fix first (3):**

| Path | What's wrong |
|---|---|
| `overview/sub_patterns/ExtractionMenu.tsx:212` | 3s `getVerifyStatus` interval allocated in a click handler, outside any effect. Cleared only on `completed`/`failed`/`not_found`. Survives unmount; a job that never settles polls for the process lifetime. |
| `studio/studioStore.ts:280` | 1.5s `webbuildStatus` boot poll in a module-level `Map<id, number>`, no React lifecycle. A build that never reports `healthy` polls at 1.5s forever. Errors go to `silentCatch` and it keeps going. |
| `studio/studioStore.ts:318` | 6s liveness watch, same module-level pattern. With `:280` this is **up to 2N live pollers for N open studio tabs.** |

**Restart-storm dep arrays (4):** `teams/sub_deliberations/useTeamDeliberations.ts:121` (polls `detail`, depends on `detail`; 3 backend calls/tick) · `overview/sub_patterns/useHarvestAutoIngest.ts:114` (`onIngested`/`addToast`/`tx`/`tw` in deps behind an `exhaustive-deps` disable) · `overview/sub_patterns/ExtractionMenu.tsx:137` · `vault/shared/hooks/health/useRemediationEvaluator.ts:150` (new `credentials` identity restarts a 30-minute timer).

**Always-mounted app chrome — ~7 concurrent background pollers before the user opens any page:**
`shared/chrome/SystemLoadFooterIcon.tsx:86` (**2s — the fastest always-mounted backend poll in the app**; correctly visibility-gated, correctly cheap on the server, still hand-rolled) · `teams/sub_collab/useChannelService.ts:34` (15s) · `overview/sub_observability/libs/useGlobalAlertEvaluator.ts:60` (60s, **3 backend calls per tick**, no visibility gate) · `plugins/fleet/useFleetOrphanScan.ts:38` (60s OS process-table scan) · `shared/chrome/FleetActivityStrip.tsx:83` (60s) · `agents/sub_executions/components/ActiveChainsBadge.tsx:40` (5s) · `agents/sub_executions/components/CircuitBreakerIndicator.tsx:81` (10s).

**Per-row fan-out (2):** `triggers/sub_triggers/CompositePartialMatchIndicator.tsx:32` (4s × N trigger rows — the comment acknowledges it) · `settings/shared/RecentChangeChip.tsx:42` (30s × N settings sections).

**Terminal polls that should be `useBackgroundSnapshot` (9):** `hooks/database/useSchemaProposal.ts:103` · `vault/sub_databases/tabs/ChatTab.tsx:92` · `plugins/dev-tools/sub_context/useUseCases.ts:81` · `teams/sub_factory/composeTask.ts:75` · `templates/sub_generated/gallery/cards/useAdoptionCompletionNotifier.ts:99` · `plugins/dev-tools/sub_lifecycle/competitions/CompetitionCard.tsx:92` · `overview/sub_patterns/ExtractionMenu.tsx:137,:212` · `studio/studioStore.ts:280`.

**Steady-freshness polls that should be `usePolling` (remaining ~24):** `overview/sub_health/libs/useStatusPageData.ts:130` · `overview/sub_incidents/libs/useIncidentsData.ts:67` · `overview/sub_missionControl/cards/UpcomingRoutinesCard.tsx:72` · `overview/sub_observability/libs/useGlobalAlertEvaluator.ts:60` · `vault/sub_credentials/manager/VaultTrustBadge.tsx:39` · `schedules/components/ScheduleTimeline.tsx:129` · `schedules/components/ScheduleRecentRuns.tsx:44` · `triggers/hooks/usePendingTriggerFires.ts:43` · `plugins/radio/hooks/useSomafmMetadata.ts:51` · `plugins/fleet/useFleetDebugLog.ts:78` · `plugins/fleet/sub_monitor/useMonitorStats.ts:35` · `plugins/fleet/sub_grid/FleetTokenSummaryBar.tsx:53` · `plugins/companion/fleet/FleetStatsSidePanel.tsx:96` · `plugins/companion/sub_setup/BrowserBridgePanel.tsx:33` · `teams/sub_teamWorkspace/teamStudio/boardShared.tsx:161` · `teams/sub_kpis/KpiSimControl.tsx:88` · `teams/sub_collab/useChannelService.ts:34` · `fleet/monitor/channels/ReviewsRail.tsx:88` · `settings/components/AmbientContextPanel.tsx:76` · `settings/sub_api_keys/components/McpServerInfoPanel.tsx:72` · `agents/sub_executions/components/ActiveChainsBadge.tsx:40` · `agents/sub_executions/components/CircuitBreakerIndicator.tsx:81` · `shared/chrome/SystemLoadFooterIcon.tsx:86` · `plugins/radio/components/RadioFooter.tsx:481`.

### Self-rescheduling `setTimeout` poll loops (9 remote)

`hooks/design/oauth/useOAuthPolling.ts:139` (legitimate — bounded + aborted) ·
`hooks/utility/data/useBackgroundSnapshot.ts:90` (the primitive itself) ·
`agents/sub_deployment/hooks/useCloudHealthMonitor.ts:57,:80,:102,:130,:142` —
**five re-arm sites sharing one `timerRef`**, two of them on a stepped
`CLOUD_BACKOFF_STEPS` ladder. Not stacked today, but a single missed staleness
guard makes them stack, and it is the only place in the repo where reconnect
backoff is implemented — it should be a primitive, not a hook body ·
`settings/sub_account/components/CloudSyncCard.tsx:66` — an effect-driven poll
whose dep array (`[status?.syncing, status?.lastSyncAt, pollTick, refresh]`)
is mutated by its own `refresh()`, so the effect re-fires itself.

### Contract rule 3 violations (poll sets a loading flag)

`overview/sub_health/libs/useStatusPageData.ts:81` (60s) ·
`agents/sub_deployment/components/cloud/CloudHistoryPanel.tsx:43` (15s) ·
`stores/slices/system/cloudSlice.ts:213` (12s, via `usePolling`).

### Call-site hygiene at otherwise-correct sites

- **No `name` at 7 of 11 call sites** — only `useMonitorData.ts` names its tickers. Everything else registers as `"polling"`, so `coordinator.stats()` reports a bucket holding N indistinguishable entries. `name` is free and is the only debugging affordance the coordinator has.
- **Literal cadence:** `settings/sub_network/components/NetworkDashboard.tsx:251` — `{ interval: 30_000, enabled: true }`, bypassing `POLLING_CONFIG` entirely.
- **`enabled: true`:** `CloudHistoryPanel.tsx:123`, `NetworkDashboard.tsx:251`.
- **`maxBackoff` dropped** by not spreading the registry entry: `GlobalExecutionList.tsx:232-234`, `ManualReviewList.tsx:126-128`, `useObservabilityData.ts:78-80`, `useMonitorData.ts:362-376` (3 of 4) all restate `interval` field-by-field. Moot today (P0), live the moment P0 is fixed.

---

### Server P0 — five TTL caches whose invalidator is never called

Each of these serves a value that a mutation in this same app changes. The TTL
is the only thing that eventually corrects them, so the user sees a confidently
wrong number for up to the full window.

| Cache | Defined at | TTL | Invalidator | Callers |
|---|---|---|---|---|
| Execution heatmap (contribution graph, per `days\|persona_id\|tz`) | `db/src/repos/execution/metrics.rs:2039`, `:2047` | **3600s** | `invalidate_heatmap_cache()` `:2079`, `#[allow(dead_code)]` | **0.** Every execution insert stales it. A run that finishes at T+1s is invisible on the heatmap **for up to an hour**. Its own doc comment says invalidation is "optional currently — the 1h TTL is the safety net." |
| MCP tools list, per credential | `engine/mcp_tools.rs:169` (TTL `:41`) | 60s (5s degraded `:59`) | `invalidate_tools_cache(credential_id)` `:212` | **0.** Should fire from credential update/delete (`commands/credentials/crud.rs`) and MCP gateway mutations (`commands/credentials/mcp_gateways.rs`). |
| Connector resource listing (dropdown options) | `engine/resource_listing.rs:140`, put `:164` | per-entry | `invalidate_credential(credential_id)` `:179` | **0.** |
| Auth detection (9 CLI probes + browser cookie DB copies) | `commands/credentials/auth_detect.rs:747`; field `lib.rs:432` | **300s** | `invalidate_auth_detect_cache(state)` `:756`, `#[allow(dead_code)]` | **0 of the named fn.** Two sites null the field inline instead (`credentials/oauth.rs:693`, `:1892`), so OAuth is covered by copy-paste; **no other auth-state mutation clears it** — a CLI login capture is invisible for 5 minutes. |
| Obsidian vault index (full body of every `.md`) | `commands/obsidian_brain/graph.rs:98`, TTL `:100` | 30s | `invalidate_vault_index_cache()` `:106` — **private `fn`** | **1**, and it is the `notify` file-watcher callback (`:760`). The five vault writers in the sibling module (`obsidian_brain/mod.rs:528`, `:867`, `:460`, `:1636`, `:1258`) cannot reach it; neither do the two writers **in the same file** (`graph.rs:530/:566`, `:602`). Correctness depends on the watcher being alive. |

Bonus, same class: `skills_sidecar/mod.rs:42` and `skill_scratchpad.rs:74` are
seeded once at engine construction (`src/engine/mod.rs:505`, `:508`) and
`set_app_setting` (`commands/infrastructure/settings.rs:121`) never re-seeds
them — toggling those settings needs an app restart while the UI says otherwise.

### Server P0 — two registrations poll the same six-count fan-out on the same bucket

`dev_tools_pending_counts` (`commands/infrastructure/dev_tools/goals.rs:462` →
`db/src/repos/dev_tools.rs:1350`) issues **six separate `SELECT COUNT(*)`
statements** on one connection, **no transaction, no cache**. It is polled by
`sidebarBadges` (`useBadgeCounts.ts:60`) *and* `titleBarPendingCounts`
(`useTitleBarTray.tsx:80`) — both on the coordinator's 30s bucket, so both fire
in the same tick. **Twelve count queries every 30 seconds, forever, to render
two badges.** The coordinator did its job (one timer); the redundancy is above
it. Fix: one registration, one store slice, both badges reading it — plus either
a single `SELECT` with six subqueries or a TTL memo.

### Server — polled commands with no cache and a real SQLite cost

Of the **100** commands matching `*_status | *_snapshot | *_state | *_summary | *_stats | *_health | get_*_counts` (91 read-shaped, 98 referenced from the frontend), **57 touch SQLite** and exactly **one** (`get_tier_usage`) has a TTL cache.

| Command | Path | Per-tick cost |
|---|---|---|
| `get_overview_bundle` | `commands/communication/observability/metrics.rs:140` | 3 repo calls in one txn, incl. a `personas LEFT JOIN (SELECT … persona_executions GROUP BY)` (`:191-203`). Correct shape, **zero memoization** — re-scanned every 30s by `useObservabilityData`. Best memo candidate in the repo. |
| `dev_tools_pending_counts` | `db/src/repos/dev_tools.rs:1350` | 6 × `SELECT COUNT(*)`, ×2 pollers. See above. |
| `get_audit_incidents_summary` | `db/src/repos/execution/audit_incidents.rs:331` | 3 prepares (status / severity / source_table `GROUP BY`), polled at 30s by `useIncidentsData.ts:67` alongside `listAuditIncidents` — **2 commands per tick**. |
| `get_event_skipped_stats` | `commands/communication/events.rs:122` | 2 queries. |
| `get_build_status` | `commands/design/build_sessions.rs:608` | Reads the `build_sessions` **row** during a live build while `AppState.build_session_manager` (`lib.rs:460`) is the warm authority for that exact session. |
| `get_manual_review_counts` · `get_team_counts` | `commands/design/reviews.rs`, `commands/teams/teams.rs:24` | 1 query each; fine, listed for completeness. |

Already free (zero SQLite) and correctly so — **do not "optimise" these**:
`get_scheduler_status`, `get_circuit_breaker_status`, `get_webhook_status`,
`fleet_monitor_stats`, `get_tier_usage`, and `get_network_snapshot` (1 read).

### Server — no delta reads exist

**0 of 1,666** commands accept a change token or return one (see contract rule 5).
Not a defect to fix in one PR; recorded because it bounds every cost argument in
this document — there is no incremental tick to migrate to.

## Gaps in the primitive

1. **The bucket set is closed at `[5s, 12s, 15s, 30s, 60s]` and rounds silently — the headline gap.** No cadence below 5s and none above 60s can be expressed, and a caller asking for 6h gets 60s with no error, no warning, no type-level signal. This single limitation accounts for **12 of the 41** unmigrated sites and for the existence of two of the three competing primitives. Minimum fix: `pickBucket` should refuse (or `console.warn` + Sentry breadcrumb) when `|interval - bucket| / interval > 0.5`. Real fix: add a `300_000` bucket and an opt-out `exact: true` path for sub-5s job polls.
2. **`usePolling` does not expose `runWhileHidden` or `fireOnRegister`.** The coordinator supports both (`TickerOptions:34-37`); the hook's `PollingOptions` (`:21-33`) omits them. Any surface that must keep polling while hidden — or must *not* fire immediately on enable — has to drop to `getPollingCoordinator()` directly. Two-line fix.
3. **Nothing combines visibility pausing with error backoff *and* a lifecycle-safe terminal stop.** `usePolling` has visibility + backoff but never stops on its own; `useBackgroundSnapshot` has decay + terminal stop but **no visibility awareness at all** (a hidden window keeps polling a running job at up to 10s forever) and no coordinator registration. A keep-alive dashboard wants the first; a job watcher wants both. The clean shape is one hook with a `stopWhen?: (result) => boolean` predicate.
4. **`usePolling` has zero tests.** No test for the backoff, none for the visibility pause, none for the ref-held `fetchFn`. The only test that touches it (`useMonitorData.test.ts:47`) **mocks it out**. `PollingCoordinator` has 10 tests but **none covers `onVisibilityLost` / `onVisibilityRegained`** — the single most important behaviour, and the one every hand-roll gets wrong.
5. **`usePolling` returns `isPolling` by subscribing to `useDocumentVisibility()`**, so every consuming component re-renders on every tab focus change whether or not it reads the field. The coordinator already owns visibility; the hook should derive `isPolling` lazily or drop it.
6. **The `POLLING_CONFIG` registry is keyed by consumer, not by cost class.** `cloudStatus` / `cloudHistory` / `pipelineRefresh` name *who* polls; a new surface must either invent an entry or borrow a semantically wrong one. Keys like `liveJob` / `activeDashboard` / `backgroundBadge` would let the next author pick correctly instead of adding a seventh entry.
7. **No `runWhileHidden` cost story.** The coordinator keeps a whole bucket alive if *any* ticker in it opts in (`bucketHasHiddenTickers`, `:193-198`), so one hidden-runner drags every co-bucketed ticker's timer along. Currently harmless (zero users), a trap the moment gap #2 is closed.
8. **`useBackgroundSnapshot`'s eleven-input dep array** (`:171`) makes the primitive fragile by construction: three consumers must each memoise eight callbacks correctly or the effect restarts every render. Collapsing the callbacks into one ref-held handler object would remove the whole failure class.
9. **No documentation surface.** `usePolling` appears in no `docs/` page, no `.claude/Design.md` entry, and no `CATALOG.md` row (the catalog covers components only). `conventions.json`'s `codeRules.effects` says "clean up listeners, timers and subscriptions" — it does not say "don't write a timer". A developer following every documented rule in this repo writes a hand-rolled `setInterval` and passes review. **This is the most probable single cause of the 18% adoption rate**, and it is the cheapest gap to close.

### Server-side gaps

10. **There is no server-side caching primitive at all.** All 39 in-process caches are hand-rolled: a bare `Lazy`/`OnceLock`/`LazyLock<Mutex<HashMap<K, (V, Instant)>>>` with an open-coded `elapsed() < TTL` check and, sometimes, an `invalidate_*` free function. There is no `TtlCache<K, V>` type, no registry, and therefore nothing that can enumerate caches, report hit rates, or assert that a cache has a live invalidator. The five broken invalidators are the predictable consequence — the pattern gives you no place to notice. A `TtlCache` in `personas-core` that takes its invalidation keys at construction would make the whole class checkable.
11. **No cache is per-window or per-caller.** Tauri has no connection concept, so every one of the 39 is a process-wide static or an `AppState` field shared by all windows. Fine today; worth knowing before anyone caches a per-user or per-workspace value in one.
12. **`#[allow(dead_code)]` is load-bearing in the wrong direction.** Two of the five orphaned invalidators carry it (`metrics.rs:2079`, `auth_detect.rs:756`). The attribute is doing exactly the job it is designed for — silencing the compiler — and in doing so it silences the *only* automatic signal that a cache has no invalidation path. Any `invalidate_*` / `clear_*` fn is a case where the dead-code warning is the feature.
13. **Cache invalidation is untested.** `src-tauri/tests/` holds 8 files (all codegen / render-plan); `grep -rl "cache" src-tauri/tests/` returns **nothing**. Inline coverage exists for TTL *expiry* in three places (`connector_readiness.rs:1809`, `mcp_tools.rs:2008-2023`, `session_pool.rs:155-165` — the last is the only one that tests invalidation at all), and `api_proxy.rs`'s reference invalidation pattern has **zero** tests. `tier_usage.rs`, `graph.rs`, `resource_listing.rs`, `smart_search.rs`, `prepared_run_cache.rs` have zero tests each.
14. **The typed emit helper covers ~13% of emit sites.** `event_registry.rs` documents `emit_event_bus` as preferable to raw `app.emit()`, but there are ~31 typed calls against **200 `.emit(` + 40 `.emit_to(`** raw calls in `src-tauri/src/`. Relevant here only because "just use events instead" is this path's primary escape hatch, and the escape hatch is itself diverged. Owned by `backend-to-frontend-events`.

## The missing gate

**Nothing gates this today, and the one rule that appears to is worse than nothing.**

`conventions.json` → `codeRules.effects` advertises `custom/no-unmanaged-effect-resources` as the enforcement for "clean up listeners, timers and subscriptions". A full `npx eslint` run over all **4,829** `src/**/*.{ts,tsx}` files produces **3** findings from that rule:

- `agents/sub_glyph/GlyphCinemaLayout.tsx:60` — **false positive** (`return () => clearTimeout(h)` at `:63`)
- `agents/sub_glyph/GlyphDialogueCinemaLayout.tsx:72` — **false positive** (cleanup at `:74`)
- `overview/sub_observability/components/AiHealingStreamOverlay.tsx:25` — **false positive** (cleanup at `:30`)

All three return a cleanup **inside an `if` block**, and `findCleanupFunction`
(`eslint-rules/no-unmanaged-effect-resources.cjs:160-168`) scans only the
*top-level* statements of the effect body. Meanwhile the rule's visitor fires
only on a `useEffect` / `useLayoutEffect` callee (`:203-209`), so all **three
real leaks** — a click handler and two module-scoped store functions — are
invisible to it by construction. **Precision 0/3, recall 0/3.** It is a museum
piece of the exact failure the golden-path contract warns about: a gate running
green while checking nothing, and a `conventions.json` entry manufacturing
confidence in it.

### Proposed gate — `custom/prefer-polling-primitive` (ESLint, `warn` → `error` after the P0 wave)

**Signal.** Three AST shapes, all near-perfect discriminators measured against the corpus:

1. `setInterval` / `window.setInterval` **anywhere** in `src/features/**` or `src/hooks/**` whose callback body transitively contains an `await`, a `.then(`, or a call to an identifier matching `/^(fetch|get|list|load|refresh|reload|poll|probe|sync|check)[A-Z_]/`. Measured: separates the 41 POLL-DATA sites from the 33 UI-TICK sites with no manual allowlist — every UI-tick callback is a pure `setState` over local values (`setNow`, `setElapsed`, `setTick`), and every data-poll awaits or `.then`s.
2. `setTimeout` whose callback transitively references the enclosing function's own name — the self-rescheduling loop. Catches all 9 remote loops.
3. `setInterval` / `setTimeout` in a `src/**` module at module scope or inside a non-`useEffect` function that also assigns to a `Map`/`Ref` — catches the 3 real leaks the current rule cannot see. **This is the sub-rule that closes the actual bug.**

**Mechanism.** A new `eslint-rules/prefer-polling-primitive.cjs` registered in
`eslint.config.js` beside the other 21 custom rules — the repo's proven vehicle
(the contract's own finding: where a custom rule exists, convergence is
measurably better). Message names the primitive by shape: *"data poll — use
`usePolling` with a `POLLING_CONFIG` cadence"* / *"terminal poll — use
`useBackgroundSnapshot`"* / *"timer allocated outside an effect — it will
outlive the surface"*.

Two companion checks, both cheap:

- **`usePolling` call-shape check** in the same rule: flag a numeric literal `interval` not read from `POLLING_CONFIG` (catches `NetworkDashboard.tsx:251`), and a missing `name` property (catches 7 of 11 sites).
- **`scripts/check-polling-backoff.mjs`** for P0, which no AST rule can see: for each `usePolling` call site, resolve the `fetchFn` identifier to its definition and fail if every path through it ends in a `catch` with no `throw`. Ship it seeded with the 11 known-bad sites as a **shrink-only baseline** — the count may go down, never up.

**Allowlist (named, not a pattern).**
`src/hooks/utility/timing/usePolling.ts` · `src/lib/polling/pollingCoordinator.ts` ·
`src/hooks/utility/data/useBackgroundSnapshot.ts` · `src/hooks/design/oauth/useOAuthPolling.ts` ·
`src/features/home/lib/usePausableInterval.ts` (until gap #1 is closed and it is deleted) ·
`src/hooks/utility/timing/relativeTimeTicker.ts` and `src/features/plugins/fleet/relativeAgo.ts`
(shared refcounted tickers) · `src/lib/debug/**` (`freezeWatchdog`, `callbackTracker`) ·
`src/lib/tauriInvoke.ts:105` (bounded IPC-token readiness gate) ·
`src/lib/idlePrefetch.ts` · `src/test/**` and `**/*.test.ts` · everything classified UI-TICK,
which sub-rule 1 already excludes without naming it.

**How it fails loudly if its own precondition is absent.** Three explicit
self-checks, because every one of them has a real precedent in this repo's CI:

1. **The rule asserts its own registration.** `src/test/eslint-rules/customRules.test.ts` already carries `setInterval` fixtures — add a `prefer-polling-primitive` block with one valid and one invalid fixture per sub-rule. If the rule is unregistered, renamed, or set to `"off"`, `RuleTester` throws rather than silently passing, and `npm run test` fails. This is the check the *current* timer rule lacks, and is exactly why its 100%-false-positive rate has gone unnoticed.
2. **The baseline script fails on a missing corpus.** `check-polling-backoff.mjs` exits **non-zero** if it resolves **zero** `usePolling` call sites — the "gitleaks isn't installed, exit 0" failure mode. Zero call sites means the glob broke or the hook was renamed, not that the repo is clean.
3. **A canary fixture.** Commit `src/test/fixtures/polling-canary.ts.txt` containing one raw `setInterval` data-poll, and assert in the same test file that linting it produces exactly one report. If a config change ever silences the rule repo-wide, the canary goes green-with-zero-findings and the assertion fails.

### Proposed gate, server half — `scripts/check-cache-invalidation.mjs`

**Signal.** A Rust free function whose name matches `/^invalidate_|^clear_.*_cache$/`
in `src-tauri/**`. Measured against the corpus this is near-perfect: it finds
exactly the 5 orphaned invalidators plus the 3 healthy ones, with no false
positives.

**Mechanism.** A node script in `scripts/`, run from `npm run check`. For each
match, count call sites of that identifier across the whole workspace excluding
its own definition. **Zero callers → fail**, naming the file and the TTL. Second
sub-check, same script: flag any `invalidate_*` / `clear_*_cache` carrying
`#[allow(dead_code)]` — for this one family the attribute is never legitimate,
because a dead invalidator *is* the bug (gap #12). Third: flag a private
(non-`pub`) invalidator in a module that also exposes `#[tauri::command]`
writers, which is the `obsidian_brain/graph.rs:106` shape.

Ship it as a **shrink-only baseline** seeded with the 5 known offenders so it
gates the next one without blocking today's tree.

**Allowlist (named).** `commands/design/smart_search.rs` and
`engine/src/prepared_run_cache.rs` — content-addressed keys, no invalidator is
correct by construction; annotate each with a `// cache-key: content-addressed`
comment the script greps for, so the exemption is declared in the code rather
than in the script. `engine/oauth_refresh.rs:995-1001` — TTL-only *by documented
design*, same comment convention.

**How it fails loudly if its own precondition is absent.** The script exits
non-zero if it discovers **zero** `invalidate_*` definitions, or if the parsed
cache count drops below the 39 recorded here without a matching baseline edit.
A rename of the convention, a moved crate, or a broken glob then reads as a
failure rather than as a clean tree — the `cargo test` -without- `--features desktop`
failure mode this repo already has a scar from.

**And a fourth thing a linter cannot do, so say it here:** the *cadence-vs-cost*
half of the contract (rule 1) is not machine-checkable — no static rule can know
whether the command behind a 2s poll is a warm sampler or a SQLite fan-out. That
is a **review** obligation: any new `POLLING_CONFIG` entry faster than 15s, or
any new poll of an uncached command, is a security-sensitive-equivalent change
and gets a human read. Recording it as unenforceable is the honest finding.
