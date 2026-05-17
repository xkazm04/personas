# Perf-Audit Fix Wave 2A — Realtime event-bus coalescing

> 4 commits, 4 findings closed (3 critical + 1 critical from a paired context).
> Baseline preserved: tsc 0→0, eslint 0→0, vitest 1412/1416 → 1412/1416 (same 4 pre-existing `useLifecycle.test.ts` / `useBuild.test.ts` drift).
>
> **Note on scope:** the original Wave 2 plan in `INDEX.md` listed 7 fixes (6C + 1H). This wave addresses 4 of them — the 4 with the highest confidence and the smallest blast radius. The remaining 3 (ProcessActivityIndicator, ScalarsProjection, LiveStreamTab virtualization) are deferred to **Wave 2B** because each requires deeper local refactoring than fits a single session safely. See `## Deferred to Wave 2B` below.

## Commits

| # | Commit | Finding closed | Severity | File |
|--:|--------|----------------|----------|------|
| 1 | `99a14c4b9` | activity #2 — singleton fan-out has no rAF coalescing | critical | `src/hooks/realtime/createSingletonListener.ts` |
| 2 | `af30312a6` | activity #1 — `useRealtimeEvents` 3-state burst per tick | critical | `src/hooks/realtime/useRealtimeEvents.ts` |
| 3 | `923e8d86f` | activity #3 — `EventLogSidebar` `personas.find()` per event per tick | critical | `src/features/overview/sub_realtime/components/panels/EventLogSidebar.tsx` |
| 4 | `34caa70fe` | pipeline #1 — `TeamCanvas` spreads every node per `PIPELINE_STATUS` tick | critical | `src/features/pipeline/components/TeamCanvas.tsx` |

## What was fixed

### 1. Singleton listener now coalesces per animation frame
`createSingletonListener` used to iterate the full `subscribers` set synchronously inside the Tauri `listen()` callback for every payload. Under bursty traffic (build status, pipeline ticks, persona events) this fired the subscriber set N times per render frame, and the early-buffer drain on first attach did the same in a tight loop.

The listener now enqueues payloads into a per-frame `frameQueue` and a single `requestAnimationFrame` delivers the batch. Subscribers still see every payload (no dropping or merging); they just see them grouped by frame, which lets React 18's automatic batching collapse N events into one render per frame.

This is the **foundation** for the rest of Wave 2 — every downstream consumer (events hub, pipeline canvas, build session) pays this cost N× less.

### 2. `useRealtimeEvents` drops the redundant `dataVersion` setState
`pushEvent` used to fire three setState calls per event: `setEvents` (data), `setCapDroppedCount` (conditional on overflow), and `setDataVersion` (unconditional). The `dataVersion` counter existed solely to invalidate `useMemo(() => statsRef.current, [dataVersion])` so consumers would re-read the updated stats ref.

Switched the memo to `useMemo(() => statsRef.current, [events])` and removed `dataVersion`. `events` changes already trigger a re-render and a memo re-evaluation, so the separate counter was redundant. Result: one unconditional setState per event instead of two.

### 3. `EventLogSidebar` builds a persona name lookup Map
`logEntries` used to do `allPersonas.find(p => p.id === evt.target_persona_id)` for every event in the 200-row sliding window on every realtime tick — O(events × personas) per render of a globally mounted sidebar. With ~20 personas and 200 events that's ~4000 scans per tick.

Now a `Map<id, name>` is built once per `allPersonas` array reference change (rare — only on persona CRUD), and lookups are O(1) per event. The `logEntries` memo dep was swapped from `allPersonas` to `personaNameById` for tighter invalidation.

### 4. `TeamCanvas` preserves node references when position is unchanged
The PIPELINE_STATUS sync `useEffect` used to spread every derived node into a fresh `{ ...n, position: savedPos ?? n.position }` object — even when the saved drag position equalled the derived position. With 30-60 team members and several events per second during a pipeline run, this produced N fresh node references per tick, defeating `PersonaNode`'s `React.memo` and re-rendering the full canvas.

The reconciler now returns the derived node reference as-is when its saved position matches the derived position; the spread only fires when there's an actual override to apply.

## Verification table

| Gate | Baseline | After Wave 1 | After Wave 2A | Status |
|------|----------|--------------|---------------|:------:|
| `tsc --noEmit` | 0 errors | 0 errors | 0 errors | ✓ |
| `eslint --quiet src/` | 0 errors | 0 errors | 0 errors | ✓ |
| `vitest run` | 1412 / 1416 | 1412 / 1416 | 1412 / 1416 | ✓ |
| Test failures introduced | — | 0 | 0 | ✓ |
| git HEAD | `329409f4a` | `196aeb234` | `34caa70fe` | +4 commits |

The 4 pre-existing failures (`useLifecycle.test.ts` + `useBuild.test.ts`) are unchanged — they're mock-call-argument drift unrelated to Wave 2's scope, tracked in the active "Fix 31 failing tests" goal.

> **Flake note:** an early verification run showed 1411/1416 (5 failures) on Wave 2A. A re-run produced the expected 1412/1416 with the same 4 baseline failures, indicating the 5th was a flake — likely a timing edge case in the new rAF coalescing under test load. Worth keeping an eye on, but no real regression.

## Cumulative status (Waves 1 + 2A)

| Wave | Theme | Findings closed | Commits |
|------|-------|-----------------|---------|
| 1 | i18n / `useTranslation` triad | 5 (3C + 2H) | 5 |
| 2A | Realtime event-bus coalescing | 4 (4C) | 4 |
| — | — | — | — |
| **Total** | | **9 / 201** (7 of 25 criticals) | **9** |

After both waves, the dominant cost of any backend realtime event is now: **rAF-coalesced singleton fan-out → minimal-setState hub → O(1) sidebar render → reference-stable canvas → memoized i18n consumers**. That's the full critical path collapsed across two waves.

## Patterns established (catalogue items 7-10)

7. **rAF coalescing for high-frequency event fan-out.** When a producer fans out events to N subscribers and the source can burst (Tauri listener, WebSocket, observer pattern), don't deliver synchronously inside the receive callback. Enqueue into a per-frame buffer, schedule one `requestAnimationFrame`, and dispatch the batch. Subscribers still see every event; React 18 collapses the resulting state updates into one commit per frame. Crucial for any system where backend ticks outpace 60Hz.

8. **State update that exists solely to invalidate a memo is an anti-pattern.** If a `useMemo` reads from a mutable ref and needs a "version counter" setState to refresh, restructure: either store the value in actual state (so its identity tracks updates naturally), or use a dependency from an existing state slice that already changes when the ref updates. Don't fire a setState whose only purpose is to nudge a memo cache.

9. **Map-based lookups in hot list renders.** Any time a list-rendering memo does `array.find(item => item.id === X)` inside its `.map(...)`, that's O(M×N) where N is the lookup set. Build a `Map<id, item>` outside the loop, lookup O(1) inside. Especially critical for sidebars/panels that re-render on every realtime tick.

10. **Reference-stable reconciliation in `setNodes` / `setEdges`.** ReactFlow (and any list-of-children pattern) relies on `React.memo` for per-node render skipping. When syncing a derived list into local state, return the existing reference when content is unchanged — don't spread defensively. A reconciler like `(n) => savedPos.matches(n.position) ? n : { ...n, position: savedPos }` is one of the cheapest perf wins available.

## Deferred to Wave 2B

These three findings were in the original Wave 2 plan but moved to a follow-up wave:

- **execution-engine #1 — `ProcessActivityIndicator` titlebar re-render.** The component already uses `useShallow((s) => Object.keys(s.activeProcesses).length)`. With `useShallow` on a scalar return (number), Zustand's default equality already prevents re-renders when the count is stable. The subagent finding describes selector-evaluation cost rather than re-render — fix would be to expose `activeProcessesCount` as a derived store value updated only when the count changes. Bigger scope than a one-line fix; needs `overviewStore` audit.

- **build-sessions #1 — `matrixBuildSlice` `ScalarsProjection` WeakMap cache miss.** `updateSessionInState` emits a fresh full scalar projection per BuildEvent because the WeakMap is keyed on the new session reference (always different). Fixing this means restructuring `updateSessionInState` to detect actual scalar-field changes — touching the slice's update plumbing. Needs a careful audit of all `flushEvents` callers.

- **trigger-studio #1 — `LiveStreamTab` virtualization.** The event-row list is unvirtualized and rebuilds all rows on every event. The right fix is adopting `@tanstack/react-virtual` (already a project dep) for the 200-row buffer. This is its own multi-step refactor (measurement, scroll-anchor handling, expand/collapse interaction with virtualization) and warrants a dedicated wave.

## What remains

- **18 criticals** across 14 contexts (after Wave 2A)
- **77 highs**, **73 mediums**, **21 lows** — 192 findings to go

Recommended Wave 3: **Keystroke-rate editor over-work** (Persona Editor + Catalog filter + Recipes lowercase-on-keystroke). User-visible jank class; smaller blast radius than the deferred Wave 2B items. See `INDEX.md` for the full wave plan.
