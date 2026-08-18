---
layer: application
subject: client-state
technique: singleton-lifecycle
stack: react
---

# Singleton lifecycle — React/Vite application

This repo has been measured wall to wall for this technique: the legacy
golden path `docs/concepts/golden-paths/hmr-safe-singletons.md` (2026-08-14)
AST-classified every module-scope binding in 4,829 files — 25 `globalThis`
keys of which 13 are state across 8 owner modules, 13 one-way latches, and
a census rule (`module-scope-install-latch`) ratcheting the latch count.
This Application names the exemplars each rung of the technique's ladder
maps to.

## Rung 1 — refcounting: `src/hooks/utility/timing/relativeTimeTicker.ts:44-83`

One shared interval drives every relative-time label in the app. Acquired
on the first subscriber; `reschedule()` clears and nulls the handle the
moment the subscriber set empties. Under HMR the old module copy's
subscribers unmount, its count drains, and the orphan releases itself —
replacement-safe with zero global names and zero HMR-specific code.
`src/features/plugins/fleet/relativeAgo.ts:15-30` is the same shape in
eight lines. The legacy path's verdict stands: *a refcounted resource is
HMR-safe for free; a latched one never is.*

The counter-example is `src/lib/documentVisibility.ts:14` — a module-scope
`let installed = false` latching a `document.addEventListener` that is
never removed. Every HMR re-evaluation resets the latch while the listener
lives on: silently additive, one extra permanent listener per edit. Same
file-shape as the ticker; opposite lifecycle discipline.

## Rung 2 — generation token: `src/lib/execution/executionSink.ts`

The high-frequency execution output buffer — deliberately a **plain module
const** (`export const executionSink = new ExecutionSink()`, `:339`), not
a `globalThis` slot. Its replacement safety comes from a generation
counter: `reset()` increments `this.generation`; every scheduled flush
captures `const gen = this.generation` at schedule time (`:305`) and
returns early on mismatch (`:309`) — stale copies' callbacks are inert,
not prevented. The consumer completes the pattern at
`src/stores/slices/agents/executionSlice.ts:189-192`: on store creation it
calls `executionSink.reset()` then `bind(...)`, so HMR/store re-creation
automatically invalidates stale flushes.

Historical note worth keeping: project docs once misnamed this object
`executionBuffers` and called it a `globalThis` singleton; four source
comments still cite that fiction as precedent. It is the opposite — the
repo's best answer to the technique, needing no global at all.

## Rung 3 — the global slot done properly: `src/lib/eventBridge.ts:130-146`

The one slot in the repo that meets the full standard: a `declare global`
block typing the key, `globalThis.__personasEventBridge ??= {…}` for
idempotent init, and a comment naming the exact failure it prevents
(module-local `attached` resets under HMR while Tauri listeners stay
registered until their unlisten functions run) — an externally held
resource, which is precisely what a generation token cannot make inert,
so the slot is earned. `src/api/companion.ts:21-31` has the best
justification comment (enumerating StrictMode double-effects, HMR, and
remounts as the three duplicate-init sources); `fleetTerminalManager.ts:198-206`
shows the re-entrancy detail (set the slot eagerly before the `await`).

## The reset hatch

`src/stores/util/dedupedStorage.ts:15-17` (`_resetDedupCacheForTests`) and
`src/lib/polling/pollingCoordinator.ts:279-283` (which also `destroy()`s
the outgoing instance) are the shape. The measured deficit: 9 modules
export a reset hatch, but only 2 of the 8 `globalThis` owners do —
`tourSlice.test.ts:36-38` consequently re-implements teardown by assigning
`undefined` to four global keys by hand, the exact smell the technique
predicts.

## The boundary, measured

`globalThis` here survives module re-evaluation only: 6 `location.reload()`
sites (including `ErrorBoundary.tsx:109`'s recovery path) each build a
fresh realm that drops every slot, and multiple Tauri WebView windows are
separate realms sharing nothing. Durability belongs to the persistence
contract (`persist()` + `app_settings`), never to a global slot — the
legacy path records a sibling repo's brute-force throttle documenting its
lifetime along the wrong axis as the cautionary case.

## Open backlog (reported, not fixed here)

The legacy path's proposal for a shared `hmrSingleton()` factory
(Symbol-keyed slot + inferred typing + non-optional reset hatch) remains
unbuilt; the four Tier-1 latches (`documentVisibility.ts`,
`storeBusWiring.ts`, `ThinkingLoader.tsx`, `throttledStorage.ts`) remain
latched rather than refcounted; the census ratchet holds the line at 13.
