# triggers (misc 2) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 1 medium / 4 low)
> Context group: Execution & Orchestration | Files read: 5 | Missing: 0

## 1. Relay list refetched on every relayed webhook event, unthrottled
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: refetch-storm
- **File**: src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:67-71
- **Scenario**: `useSmeeRelayStatus` is a Tauri event listener that emits a status object per relayed event (`events_relayed` increments each time). The effect keyed on `globalStatus.events_relayed` calls `fetchRelays()` — a full `smeeRelayList()` IPC + SQLite query — once per relayed event while the tab is open. A webhook burst (e.g. a busy GitHub repo pushing to smee) turns into N back-to-back list fetches and N full-list re-renders.
- **Root cause**: The refresh is coupled 1:1 to the monotonically increasing counter with no debounce/throttle, so refresh frequency scales with inbound event rate instead of UI needs.
- **Impact**: Redundant IPC/DB round-trips and re-renders proportional to relay traffic on the hot path of the feature; the stats shown (`eventsRelayed`, `lastEventAt`) don't need per-event fidelity.
- **Fix sketch**: Throttle the stats refresh: keep the effect but route it through a trailing-edge debounce/throttle (~1-2s), e.g. store `events_relayed` in a ref and schedule one `fetchRelays()` per window via `setTimeout` cleared in the effect cleanup. Alternatively, patch counts locally from `globalStatus` (`events_relayed`, `last_event_at`) and only refetch on visibility/mount.

## 2. Delete flow duplicates AnimatePresence's exit mechanism with a manual setTimeout state machine
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:110-122
- **Scenario**: `handleDelete` adds the id to `exitingIds` (which immediately removes the row from the rendered list because of the `filter` at line 335 — that alone triggers the `AnimatePresence` exit animation), then a 300ms `setTimeout` prunes `relays` and `exitingIds` again.
- **Root cause**: Two mechanisms doing one job: the `exitingIds` filter already unmounts the item for AnimatePresence; the delayed `setRelays` prune is redundant bookkeeping. The timeout is also never cleared, so deleting and quickly unmounting the tab calls setState on an unmounted component (harmless in React 18+, but stale).
- **Impact**: Extra state (`exitingIds`), an extra render pass per delete, and a hand-rolled duration (300ms) that must be kept in sync with the motion `transition.duration` (0.25s — already drifted).
- **Fix sketch**: Drop `exitingIds` and the `setTimeout` entirely: after `smeeRelayDelete(id)` succeeds, `setRelays(prev => prev.filter(r => r.id !== id))`. `AnimatePresence` + the existing `exit` variant handles the animation with no timer.

## 3. Create-relay enablement duplicates a weaker validity check than the displayed validation
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_smee_relay/SmeeRelayTab.tsx:75,303
- **Scenario**: `handleCreate` (line 75) and the Create button's `disabled` prop (line 303) both re-derive validity as `addLabel.trim() && addUrl.startsWith('https://smee.io/')`, while the field-level validation computes stricter `labelValid`/`urlValid` (line 127-128, which also requires a path after the prefix). Typing exactly `https://smee.io/` shows the red "Enter the full channel URL" error yet the Create button is enabled and submits.
- **Root cause**: The validity predicate exists in three places; the two submit-path copies drifted from the canonical one.
- **Impact**: Inconsistent UX (error message visible + enabled submit) and a maintenance trap — any future rule tightening must be applied in three spots.
- **Fix sketch**: Use the already-computed booleans: `const formValid = labelValid && urlValid;` gate both the button `disabled={isCreating || !formValid}` and the early return in `handleCreate` on it.

## 4. useSubscribedFeeds re-implements useSharedEvents' fetch with a divergent join key
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_shared/useSubscribedFeeds.ts:14-27
- **Scenario**: Both hooks fetch `listSubscriptions()` + `browseCatalog()`. `useSharedEvents` joins subscriptions to catalog entries via `catalogEntryId` (subByEntryId, line 89-93), while `useSubscribedFeeds` joins via `slug`. Consumers are different surfaces (SharedEventsTab vs StudioRails), so the fetch duplication is defensible, but the join-key divergence is not.
- **Root cause**: The smaller hook was written independently for Chain Studio and picked `slug` as the correlation key instead of the id-based mapping the marketplace hook uses.
- **Impact**: Two definitions of "which catalog entries am I subscribed to" that can disagree if slugs are ever non-unique or renamed while ids stay stable; future editors must know both exist.
- **Fix sketch**: Extract one shared helper, e.g. `async function fetchSubscribedCatalogEntries()` in sub_shared that does the Promise.all and joins by `catalogEntryId`, and have `useSubscribedFeeds` (and optionally `subByEntryId` derivation) consume it. Keeps the two hooks but with a single join definition.

## 5. RateLimitDashboard re-parses every trigger's JSON config on each rate-limit store tick
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/triggers/sub_speed_limits/RateLimitDashboard.tsx:23-46
- **Scenario**: The single `stats` useMemo depends on both `triggers` and `rateLimits`. `triggerRateLimits` in the pipeline store updates on live throttle/queue ticks, and each update re-runs `parseConfig` (JSON.parse) + `extractRateLimit` for every trigger even though trigger configs haven't changed.
- **Root cause**: Static per-trigger derivation (config parse → has rate limit) is fused with live-state aggregation (queue depth / throttled counts) in one memo.
- **Impact**: Bounded — trigger counts are small — but it's repeated JSON parsing on a component that re-renders with realtime store updates; cost grows linearly with trigger count times tick rate.
- **Fix sketch**: Split the memo: `const rateLimitedIds = useMemo(() => triggers.filter(t => hasActiveRateLimit(extractRateLimit(parseConfig(t.config)))).map(t => t.id), [triggers]);` then a second memo over `[rateLimitedIds, rateLimits]` that sums queue/concurrent/throttled. Config parsing then happens only when triggers change.
