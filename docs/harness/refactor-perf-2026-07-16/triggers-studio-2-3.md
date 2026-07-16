# triggers/studio [2/3] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Execution & Orchestration | Files read: 18 | Missing: 0

## 1. Unmemoized buildActivityMap in RoutingView duplicates the memoized one already computed in useRoutingFilters
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/triggers/sub_studio/routing/layouts/routing/RoutingView.tsx:57
- **Scenario**: Every render of RoutingView — including every search keystroke, filter toggle, row expand/collapse, and group collapse (all of which set state in this component or its hook) — re-runs `buildActivityMap(recentEvents)` over up to 1000 events, each iteration calling `Date.parse`.
- **Root cause**: `const activity = buildActivityMap(recentEvents);` is a bare call in the component body. `useRoutingFilters` (useRoutingFilters.ts:65) already computes the exact same map inside a `useMemo` keyed on `recentEvents`, but does not expose it, so the view rebuilds it redundantly. The docstring in activity.ts even says "Kept pure so it can be memoised in the view" — the memoization never happened.
- **Impact**: ~1000 `Date.parse` calls plus a fresh `Map` identity per keystroke; the new identity is passed as the `activity` prop to every `GroupPanel`, defeating any `React.memo` below and forcing PulseDot/row re-renders even when activity data is unchanged.
- **Fix sketch**: Add `activity: Map<string, ActivityEntry>` to the `RoutingFilters` return type in useRoutingFilters.ts (it is already computed at line 65), delete line 57 and the `buildActivityMap` import in RoutingView.tsx, and use `filters.activity` in the GroupPanel props.

## 2. listEvents(1000) ships full event rows over IPC just to derive per-type count/lastTs
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: payload
- **File**: src/features/triggers/sub_studio/routing/EventCanvas.tsx:33 (also useRoutingState.ts:78 on every reload)
- **Scenario**: Opening the Dispatch view fetches the 1000 most recent `PersonaEvent` rows (including their payload/body columns) across the Tauri IPC boundary; `reload()` in useRoutingState re-fetches the same 1000 rows after every single link/unlink/rename action.
- **Root cause**: The frontend only needs `{event_type, max(created_at), count(*)}` per type (activity.ts) plus the distinct set of event types/sources for row derivation, but the generic `listEvents` API is the only aggregation source, so the raw rows are transferred and reduced client-side.
- **Impact**: On a busy bus this serializes hundreds of KB of event payloads through IPC and JSON parse on mount and after every mutation, to produce a map that SQLite could compute in one `GROUP BY event_type` query. Cost is bounded (limit 1000) but paid on a hot interaction path.
- **Fix sketch**: Add a Rust command like `list_event_activity()` returning `SELECT event_type, source_id, COUNT(*), MAX(created_at) FROM persona_events GROUP BY event_type, source_id`, and use it in EventCanvas/useRoutingState in place of `listEvents(1000)`; keep `listEvents` for surfaces that actually display event bodies. Note buildEventRows/routingHelpers also consumes `recentEvents` — verify it only needs type/source/timestamp before swapping.

## 3. Option-card shell triplicated across TriggerOptionCard, PersonaOptionCard, and SystemOpOptionCard
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/triggers/sub_studio/StudioOptionCards.tsx:25 (also :59, and system_ops/SystemOpOptionCard.tsx:19)
- **Scenario**: Any styling tweak to the studio rail cards (active state, hover, padding, dense sizing) must be repeated in three places; SystemOpOptionCard's docstring already admits it "mirrors" the other two.
- **Root cause**: All three components repeat the identical `Tooltip` wrapper + `<button>` with the same ~6-line className expression (`active ? 'bg-primary/10 border-primary/40 shadow-elevation-1' : 'bg-background/80 border-border hover:…'`) and the same icon-box + truncated-label row; only the icon/label/tooltip content differs.
- **Impact**: Three copies of non-trivial conditional class strings are already at risk of drifting (SystemOpOptionCard hardcodes the dense variant while the others take a `dense` prop); this is the exact drift pattern that produced the app's earlier 6-way chrome divergence.
- **Fix sketch**: Extract an `OptionCardShell({ active, dense, tooltip, onPick, icon, children })` in sub_studio (e.g. next to StudioOptionCards) that owns the Tooltip + button + icon-box markup; reduce the three cards to thin wrappers supplying `PersonaIcon`/lucide icon and label. Pure presentational consolidation, no behavior change.

## 4. EventCanvas mirrors its allTriggers prop into redundant local state
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: cleanup
- **File**: src/features/triggers/sub_studio/routing/EventCanvas.tsx:21
- **Scenario**: Whenever the parent passes a new `allTriggers` array, EventCanvas renders once with the stale mirror, then the sync effect (`useEffect(() => setTriggers(initialTriggers))`, line 24) fires and renders again.
- **Root cause**: `const [triggers, setTriggers] = useState(initialTriggers)` has no other writer — `setTriggers` is only called from the prop-sync effect, so the state is a pure pass-through copy of the prop (useRoutingState already owns the post-reload trigger state downstream).
- **Impact**: One wasted extra render of the whole routing subtree per trigger-list change, plus misleading indirection suggesting EventCanvas manages trigger state when it doesn't.
- **Fix sketch**: Delete the `triggers` state and the sync effect; pass `initialTriggers` (the prop) directly as `initialTriggers` to `UnifiedRoutingView`. useRoutingState.ts:63 already handles prop→state sync.

## 5. Dead re-export of buildActivityMap from useRoutingFilters
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/triggers/sub_studio/routing/layouts/routing/useRoutingFilters.ts:161
- **Scenario**: `export { buildActivityMap } from './activity';` at the bottom of the hook file has no importers — the only external consumer (RoutingView.tsx:24) imports it directly from `./activity` (grep across src/ confirms; no dynamic use plausible for a named util).
- **Root cause**: Leftover from an earlier refactor when the activity logic lived in (or was consumed via) the filters hook.
- **Impact**: Cosmetic — a misleading extra public surface on the hook module; if finding #1 is fixed by exposing `activity` from the hook, this line becomes doubly redundant.
- **Fix sketch**: Delete line 161. Optionally also refresh the useRoutingState.ts header comment that still describes "routing-view variants (Dispatch / Switchboard / Baseline)" — only the single RoutingView consumer remains after the consolidation noted in TriggerStudioCanvas.tsx.
