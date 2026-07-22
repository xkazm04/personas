# overview/realtime — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 1 high / 5 medium / 0 low)
> Context group: Observability & Monitoring | Files read: 24 | Missing: 0

## 1. Entire sub_realtime feature is orphaned — zero importers outside the folder
- **Severity**: High
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_realtime/index.ts:1
- **Scenario**: A repo-wide grep for `sub_realtime`, the barrel exports, and `RealtimeVisualizerPage` finds no importer anywhere in `src/` (only README/DESIGN docs mention the folder). `DashboardWithSubtabs.tsx` explicitly says the Realtime subtab was consolidated into `DashboardHome`, and `DashboardHome` re-exports `sub_missionControl` only.
- **Root cause**: The dashboard subtab consolidation removed the only entry point (`RealtimeVisualizerPage`) but left all 24 files (~2,500 LOC), the barrel, and the full i18n string block (`overview.realtime_page/realtime_stats/realtime_idle/realtime_viz` in 15+ locales) behind.
- **Impact**: No runtime/bundle cost (tree-shaken), but a large maintenance hazard: every design-system/i18n/hook refactor sweeps through 24 files that ship nothing, and the docs (`overview/README.md`) still direct new work into this dead folder. All other findings in this report are inside unreachable code.
- **Fix sketch**: Decide product intent first. If the visualizer is gone for good, delete `src/features/overview/sub_realtime/` wholesale, prune the `realtime_*` keys from the locale catalogs, and update `overview/README.md`/`sub_incidents/DESIGN.md`. If it is meant to return, re-wire `RealtimeVisualizerPage` into a route/subtab so the code is reachable again. Verification needed: confirm no dynamic string-path import in a route registry (none found in `src/**/*.ts{,x}`).

## 2. Second-layer dead files inside the feature: parseEventQuery, VisualizationNodes/Particles, BusLane, EventParticle, RealtimeWelcomeOverlay
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/overview/sub_realtime/libs/parseEventQuery.ts:32
- **Scenario**: Even if the feature were revived via its current entry point, these files still would not execute: `parseEventQuery.ts` (~130 LOC structured-query parser) has zero importers — `EventLogSidebar` uses its own plain substring filter instead; `VisualizationNodes.tsx` and `VisualizationParticles.tsx` are imported by nothing (the views use `EventBusNodeRenderers`/`EventBusParticleRenderers`); `BusLane.tsx` and `EventParticle.tsx` are referenced only by the unused barrel; `RealtimeWelcomeOverlay.tsx` has no importer, and its intended wiring point (`Props.onTestFlow` in `EventBusTypes.ts:18`, passed by `RealtimeVisualizerPage.tsx:117`) is never destructured in `EventBusVisualization`.
- **Root cause**: Iterated visualizer redesigns (radial vs. swim-lane, parser vs. plain search, welcome overlay vs. inline idle state) kept the losing variants on disk.
- **Impact**: ~500 additional LOC of dead weight that duplicates live code (two parallel node/particle renderer sets, two search implementations), confusing anyone who edits the feature.
- **Fix sketch**: Delete `parseEventQuery.ts`, `VisualizationNodes.tsx`, `VisualizationParticles.tsx`, `BusLane.tsx`, `EventParticle.tsx`, `RealtimeWelcomeOverlay.tsx`, drop the `BusLane`/`EventParticle` lines from `index.ts`, and remove the unused `onTestFlow`/`droppedCount` fields from `Props` in `EventBusTypes.ts` (`droppedCount` is also never read by either view). Folded into finding 1 if the whole folder is deleted.

## 3. Leftover motion-library markup: position-less particles and radius-less rings render at (0,0)/invisible
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: leftover-debug
- **File**: src/features/overview/sub_realtime/components/renderers/EventBusParticleRenderers.tsx:29
- **Scenario**: In `InboundCometTrails`, the comet-tail/head circles have `r` but no `cx`/`cy` (all stack at SVG origin 0,0), and the delivery "impact rings" (lines 46-52) have `cx`/`cy` but no `r` (defaults to 0 — invisible). The same pattern repeats in `ReturnFlowComets`, `VisualizationParticles.tsx:33-47/58-72`, `SwimLaneVisualization.tsx:213-240` (trail `<line>` with no coordinates, particles/label with no position), and `EventParticle.tsx:55` (burst ring with no `r`). The `position` computed in `EventParticle.tsx:19-31` is used only by the invisible burst.
- **Root cause**: A previous animation-library removal (the `animate-fade-slide-in` class replaced per-frame animated attributes) stripped the animated `cx/cy/r` props without re-adding static ones; the ignored `_getSrc`/`_getSourcePos` parameters and the computed-but-barely-used `tx/ty` are the residue.
- **Impact**: The core "particles flying source→hub→agent" visual cannot work — everything renders in the top-left corner or not at all — while the code still computes source/target geometry every frame. Dead computation plus misleading structure for whoever revives the feature.
- **Fix sketch**: If reviving: set `cx/cy` from the phase-based `tx/ty` (or a tween), give impact rings an explicit `r`, and delete the unused `getSrc`/`getSourcePos` props. If not reviving: covered by finding 1's deletion.

## 4. outerNodes/sourceNodes useMemo reads a mutable ref with [] deps — discovered-source topology never renders, discovery effect is pure waste
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: stale-memo
- **File**: src/features/overview/sub_realtime/components/views/EventBusVisualization.tsx:53
- **Scenario**: `outerNodes` (`useMemo(..., [])`) reads `discoveredRef.current` exactly once at mount, when the map is always empty, so it permanently returns `DEFAULT_TOOLS`. Meanwhile the effect at lines 28-51 walks the entire `events` array on every realtime tick, maintaining counts, TTL eviction, and an LRU sort over up to 500 entries — output that nothing ever reads again. `SwimLaneVisualization.tsx:86-101` has the identical bug for `sourceNodes`.
- **Root cause**: Discovery state was moved into a ref (to avoid re-render loops) but the memo that consumes it was never given a change signal (tick counter/state version).
- **Impact**: Continuous O(events) work plus map/sort churn per tick with zero visual payoff; discovered sources, traffic-weighted sizing, and staleness fading are all dead features. Position lookups (`getSrc`) fall through to hash-based pseudo-positions for every real source.
- **Fix sketch**: Keep discovery in state (or bump a `useState` version counter inside the effect after the map changes) and add it to the memo deps of `outerNodes`/`outerMap` and `sourceNodes`/`srcMap`. Alternatively compute discovered sources directly inside a `useMemo([events])` and drop the ref+effect entirely — the events window is already bounded upstream.

## 5. SwimLane discoveredRef map grows without bound — no TTL, no cap
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: leak
- **File**: src/features/overview/sub_realtime/components/views/SwimLaneVisualization.tsx:75
- **Scenario**: A long-running session in the Lanes variant with ephemeral source IDs (per-PR webhook IDs, commit SHAs — exactly the case `EVENT_BUS_LIMITS.maxDiscoveredSources` documents) inserts a new map entry per unique key and never removes any.
- **Root cause**: `EventBusVisualization` got TTL eviction (`discoveredSourceEvictMs`) and a 500-entry LRU cap; the parallel discovery effect in `SwimLaneVisualization` was never given either.
- **Impact**: Unbounded memory growth in a desktop app that can stay open for days; every tick's discovery loop also gets slower as the map grows.
- **Fix sketch**: Extract the discovery-map maintenance (insert + TTL eviction + LRU cap) from `EventBusVisualization.tsx:28-51` into a shared `useDiscoveredSources(events)` hook in `libs/` and use it in both views — this also deduplicates the sizing logic (`EVENT_BUS_NODE_SIZING` vs. the identical `SWIM_LANE_NODE_SIZING`).

## 6. Discovery effect re-counts the entire rolling events window every tick — source counts inflate quadratically
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: redundant-recompute
- **File**: src/features/overview/sub_realtime/components/views/EventBusVisualization.tsx:31
- **Scenario**: Each time the `events` array reference changes (every realtime arrival), the effect iterates all events currently in the window and does `existing.count++` for each — so an event still in the window is re-counted on every subsequent tick. With a 200-event window that is ~200 spurious increments per arrival, and a source's `count` reflects (occurrences × ticks survived), not traffic.
- **Root cause**: The effect treats the cumulative `events` window as a delta stream; there is no per-event dedupe or high-water mark. Same defect in `SwimLaneVisualization.tsx:76-84`.
- **Impact**: O(window) wasted work per tick in both views, and the traffic-weighted `sizeFactor` (count/maxC) is computed from meaningless numbers — recently-arrived busy sources are undersized relative to old idle ones.
- **Fix sketch**: Track processed event IDs (bounded Set) or remember the previous newest-event ID and only fold in the prefix of new events since it. Fits naturally into the shared `useDiscoveredSources` hook from finding 5.
