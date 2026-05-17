# Perf-Audit Fix Wave 2B — Deferred realtime/build/triggers fixes

> 3 commits, 3 findings addressed (1 full + 2 partial closures).
> Baseline preserved: tsc 0→0, eslint 0→0, vitest 1412/1416 → 1412/1416.

Wave 2A deferred 3 fixes from the original Wave 2 plan because each needed a deeper local refactor than fit alongside the realtime-hub work. Wave 2B picks them up — landing one full fix and two pragmatic partial fixes that close the immediate cost while explicitly documenting what's still owed.

## Commits

| # | Commit | Finding closed | Severity | File |
|--:|--------|----------------|----------|------|
| 1 | `a8edbb9de` | execution-engine #1 — Titlebar re-renders on every telemetry tick (FULL) | critical | `src/stores/slices/processActivitySlice.ts`, `src/features/shared/components/layout/ProcessActivityIndicator.tsx` |
| 2 | `0a903b3c2` | build-sessions #1 — ScalarsProjection churn (PARTIAL — no-op short-circuit) | critical | `src/stores/slices/agents/matrixBuildSlice.ts` |
| 3 | `a51db6ecf` | trigger-studio #1 — LiveStream rebuild per event (PARTIAL — rAF ingest batching) | critical | `src/features/triggers/sub_live_stream/LiveStreamTab.tsx` |

## What was fixed

### 1. Derived `activeProcessCount` in processActivitySlice (FULL CLOSURE)
The titlebar `ProcessActivityIndicator` is always mounted and used to read `Object.keys(s.activeProcesses).length` inside a `useShallow` selector. Two problems:
- `useShallow` over a primitive (number) return provides no benefit; the underlying number is already `Object.is`-comparable.
- The selector still **runs** on every store mutation. `enrichProcess` (per tool call) and `updateProcessStatus` (per status change) fire dozens of times per second during a run, each mutating an inner ActiveProcess field without changing the count. Every one re-ran `Object.keys(...).length` for nothing.

Added `activeProcessCount: number` to the slice, maintained by the four mutators that actually change the set: `processStarted` (+1 when new key), `processEnded` (-1), `processQueued` (+1 when new key), `clearNonActive` (recomputed from kept entries). `enrichProcess` and `updateProcessStatus` deliberately don't touch the count — they're inner-field mutations only.

The indicator now selects the primitive directly: `useOverviewStore((s) => s.activeProcessCount)`. With Object.is equality on numbers, it re-renders only when the count transitions.

### 2. `updateSessionInState` no-op short-circuit (PARTIAL CLOSURE)
The full finding asks for three things: (a) batch the RAF flush into a single `set()`, (b) replace `useShallow` with selector-per-field on `useBuild`, (c) memoize `scalarsFromSession` on content hash. All three require reshaping `useBuildSession`'s event-handler pipeline — out of scope for this session.

Landed the cheap-and-safe slice: when an event-handler updater returns the same session reference unchanged (conditional bail-outs in `cell_update` / `persona_resolution_update` / etc. when the event doesn't apply to current phase), `updateSessionInState` now returns `{}` so Zustand skips the `set()` entirely. Without this, every conditional-bail-out event allocated a fresh `buildSessions` map plus a 32-key `ScalarsProjection` that consumers had to compare against — pure churn for zero state change.

**Still owed for full closure:** RAF-flush batching in `useBuildSession`; selector-per-field on `useBuild`; content-hash memoization in `scalarsFromSession`. Tracked in `INDEX.md` as a follow-up wave.

### 3. `LiveStreamTab` rAF-batched event ingest (PARTIAL CLOSURE)
The full finding asks for four things: (a) rAF-throttled batched ingest, (b) `React.memo` on row cells with primitive props, (c) replace `DataGrid` with virtualized list, (d) hoist `newEventIds` to row data.

Landed (a). Under CDC bursts of 50-200 evt/s, the listener used to run a separate `setEvents` updater per event — each doing a `.map()` or `[evt, ...prev]` against the rolling 200-item buffer. React 18's automatic batching collapsed the commits, but each updater still ran its prev→next transform serially.

Now: events enqueue into `pendingEventsRef` and a single `requestAnimationFrame` flushes the whole batch in one `setEvents` call. Status-update events still replace in place, new events still prepend, cap-at-200 still trims, the highlight timer still schedules per-event. Per-frame work collapses from N updater functions to 1.

**Still owed for full closure:** row-level `React.memo`, virtualized list, primitive-prop row data. DataGrid's existing pagination keeps the rendered row count bounded at ~20, so virtualization is lower-priority than it would be on a fully visible list — moved to a polish-grade follow-up.

## Verification table

| Gate | Baseline | After W1 | After W2A | After W2B | Status |
|------|----------|----------|-----------|-----------|:------:|
| `tsc --noEmit` | 0 errors | 0 | 0 | 0 | ✓ |
| `eslint --quiet src/` | 0 errors | 0 | 0 | 0 | ✓ |
| `vitest run` | 1412 / 1416 | 1412 / 1416 | 1412 / 1416 | 1412 / 1416 | ✓ |
| Test failures introduced | — | 0 | 0 | 0 | ✓ |

## Cumulative status (Waves 1 + 2A + 2B)

| Wave | Theme | Findings closed | Commits |
|------|-------|-----------------|---------|
| 1 | i18n / `useTranslation` triad | 5 (3C + 2H) | 5 |
| 2A | Realtime event-bus coalescing | 4 (4C) | 4 |
| 2B | Deferred realtime/build/triggers | 3 (1C full + 2C partial) | 3 |
| — | — | — | — |
| **Total** | | **12 / 201** (10 of 25 criticals) | **12** |

## Patterns established (catalogue items 11-12)

11. **Maintain derived primitives alongside their source maps in store slices.** When a primitive (count, sum, max) is read by always-mounted components, computing it via `Object.keys/values/entries` inside the selector means the selector runs on every store mutation — including unrelated ones. Maintain the primitive as a sibling field in the slice and update it only at the points where it can change. The selector becomes a plain field read with `Object.is` equality, eliminating per-tick re-evaluations.

12. **No-op short-circuit in conditional store updaters.** When a Zustand `set` updater can bail out without changing state (conditional event handlers, phase guards), check `updated === existing` and return an empty patch `{}`. Without this, every bail-out still allocates fresh outer maps + projection objects that downstream consumers' shallow comparators have to walk. The check is one line and saves real work on heavily-conditional event pipelines.

## What remains

- **15 criticals** across 13 contexts (after Waves 1 + 2A + 2B)
- **77 highs**, **73 mediums**, **21 lows** — 189 findings to go

### Recommended next wave: **Wave 3 — Keystroke-rate editors**
3 criticals + 3 highs (~6 commits):
- persona-editor #1 — `preparationFingerprint` JSON.stringify per keystroke
- persona-editor #2 — `useEffectivePersona` reallocation per keystroke
- connector-catalog #1 — Catalog filter pipeline no debounce
- Plus 3 paired highs (recipes lowercase-on-keystroke, etc.)

Smaller blast radius than the rest of Wave 2's deferred items; user-visible jank class.

### Long-tail follow-ups carried forward
- **Build-session deeper refactor** (batched RAF flush + per-field selectors + content-hash memo in `scalarsFromSession`) — open from W2B
- **LiveStream virtualization + row memo** — open from W2B
- **`ProcessActivityDrawer` filter-pass memoization** (execution-engine #2 high) — drawer-open case
- **Tests #1 hotfix** (`usePersonaTests` never mounted → Test button stuck 30 min) — correctness, not just perf

See `INDEX.md` for the full 7-wave plan and remaining findings.
